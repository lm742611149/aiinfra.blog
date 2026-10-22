---
title: 'Day 73 · pytest(三):fixture 和 parametrize'
description: '用 fixture 把每个测试都要做的准备工作抽出来(对照 beforeEach/afterEach),用 parametrize 让一个测试函数配一张数据表,一口气生成 6 条用例。顺带认识 tmp_path、conftest.py 和 scope。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'pytest', 'testing', 'agent-zero']
series: 'agent-zero'
day: 73
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 72](/blog/agent-zero/day-072-pytest-2/) 我们把测试搬进了 `tests/`,弄清了 `sys.path` 和 pytest 往上找 `__init__.py` 的规则,在 `pyproject.toml` 里用 `pythonpath = ["."]` 和 `testpaths = ["tests"]` 修好了 `ModuleNotFoundError`,还学了 node id、`-k`、`-x`、`--lf`。现在 `tests/test_cost.py` 和 `tests/test_cost_more.py` 里一共 7 个用例。回头看这两个文件,重复的地方很扎眼:高峰价 `2.0, 8.0` 每个用例都抄一遍;两个负数用例除了数字几乎一模一样。今天学的两样东西就是专门去重复的。

## 今天要解决的问题

学完今天,你应该能做到:

1. 写一个 fixture,让多个测试通过「参数名」拿到同一份准备好的数据;会用 `yield` 写清理步骤。
2. 会用 pytest 自带的 `tmp_path`,在临时目录里造文件做测试;知道 `conftest.py` 是放共享 fixture 的地方。
3. 用 `@pytest.mark.parametrize` 把一个测试函数变成 6 条用例,并给每条起一个看得懂的 id。
4. 能把 fixture 和 parametrize 组合在一个测试里用。

预计用时:2.5 小时。

前置:[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 的元组解包、[Day 30](/blog/agent-zero/day-030-functions-3/) 的 `*args`、[Day 37](/blog/agent-zero/day-037-pathlib/) 的 pathlib、[Day 39](/blog/agent-zero/day-039-json/) 的 JSON、[Day 71](/blog/agent-zero/day-071-pytest-1/) 和 [Day 72](/blog/agent-zero/day-072-pytest-2/) 的全部内容。还要用到一点装饰器的写法(`@` 开头的那一行),装饰器要到后面专门一天才讲原理,今天你只需要知道「`@xxx` 写在 `def` 上面,给这个函数贴一个标签」就够用了,和前端 TypeScript 里的 `@Component(...)` 看起来很像。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把最后那个 `test_cost_param.py` 和 `conftest.py` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 重复在哪里

先看一眼 [Day 71](/blog/agent-zero/day-071-pytest-1/) 写的 `tests/test_cost.py` 的样子(节选):

```python
# agent-zero-lab/tests/test_cost.py(节选,不用改)
def test_input_only():
    assert total_cost(1_000_000, 0, 2.0, 8.0) == 2.0


def test_output_only():
    assert total_cost(0, 500_000, 2.0, 8.0) == 4.0


def test_real_call():
    assert total_cost(8, 29, 2.0, 8.0) == 0.000248
```

<div class="line-notes">

- `def test_input_only():` 三个函数结构完全一样:调 `total_cost`,比一个期望值。
- `assert total_cost(1_000_000, 0, 2.0, 8.0) == 2.0` `2.0, 8.0` 是高峰价。哪天 DeepSeek 调价,你得改每一行。
- `assert total_cost(0, 500_000, 2.0, 8.0) == 4.0` 同上,只有 token 数和期望值在变。
- `assert total_cost(8, 29, 2.0, 8.0) == 0.000248` 同上。

</div>

这里有两种重复。一种是「准备工作」重复:每个测试都要拿到同一组单价。另一种是「测试逻辑」重复:代码一样,只是输入数据和期望值不同。pytest 给前一种准备了 **fixture**,给后一种准备了 **parametrize**。前端里对应的大概是:

| 前端(Jest / Vitest) | pytest | 解决什么 |
| --- | --- | --- |
| `beforeEach(() => { price = ... })` | `@pytest.fixture` 返回一个值 | 每个测试前做准备 |
| `afterEach(() => { cleanup() })` | fixture 里 `yield` 之后的代码 | 每个测试后清理 |
| `test.each([...])('...', ...)` | `@pytest.mark.parametrize` | 同一逻辑跑多组数据 |

有一个关键区别要先说:Jest 的 `beforeEach` 是把值塞进外层变量,所有测试共享这个变量;pytest 的 fixture 是**测试函数在参数里写上 fixture 的名字,pytest 就把值传进来**,谁要谁写,不要就不写。这个机制叫依赖注入,听着唬人,用起来就是「参数名对上了就给你」。

## 第 1 步:第一个 fixture

新建 `tests/test_fixture_intro.py`:

```python
# agent-zero-lab/tests/test_fixture_intro.py
import pytest

from part01.cost import total_cost


@pytest.fixture
def flash_peak():
    print("\n[fixture] 准备高峰价")
    return (2.0, 8.0)


def test_input_peak(flash_peak):
    price_in, price_out = flash_peak
    assert total_cost(1_000_000, 0, price_in, price_out) == 2.0


def test_output_peak(flash_peak):
    price_in, price_out = flash_peak
    assert total_cost(0, 500_000, price_in, price_out) == 4.0
```

<div class="line-notes">

- `import pytest` 要用 `pytest.fixture` 这个装饰器。
- `@pytest.fixture` 贴在下面这个函数上的标签,告诉 pytest:「`flash_peak` 不是测试,是一个 fixture,谁要就调用它,把返回值给谁」。
- `def flash_peak():` fixture 的名字就是函数名。名字要能看出是什么数据,`flash_peak` 是「deepseek-flash 的高峰价」。
- `print("\n[fixture] 准备高峰价")` 只是为了看清它什么时候被调用,正式代码里不需要。开头的 `\n` 是换行,让打印内容另起一行,不和 pytest 自己的输出挤在一起。
- `return (2.0, 8.0)` 返回一个元组:输入单价 2.0、输出单价 8.0(2026 年 10 月 DeepSeek 官方价格页查到的高峰价,单位元/百万 token)。
- `def test_input_peak(flash_peak):` 测试函数的参数名写 `flash_peak`,和 fixture 同名。pytest 运行这个测试前,会先调用 `flash_peak()`,把返回的 `(2.0, 8.0)` 作为这个参数传进来。你自己从来不调用 `flash_peak()`。
- `price_in, price_out = flash_peak` [Day 22](/blog/agent-zero/day-022-tuples-unpack/) 的元组解包,`price_in` 得到 2.0,`price_out` 得到 8.0。注意这里的 `flash_peak` 已经是元组本身,不是函数。
- `assert total_cost(1_000_000, 0, price_in, price_out) == 2.0` 代入就是 `total_cost(1_000_000, 0, 2.0, 8.0)`,得 2.0。
- `def test_output_peak(flash_peak):` 第二个测试也要这个 fixture,同样写在参数里。
- `assert total_cost(0, 500_000, price_in, price_out) == 4.0` `500_000 × 8.0 / 1_000_000 = 4.0`。

</div>

加 `-s` 跑,看 fixture 什么时候被调用:

```bash
uv run pytest tests/test_fixture_intro.py -s -v
```

实跑输出(中间部分):

```text
collecting ... collected 2 items

tests/test_fixture_intro.py::test_input_peak 
[fixture] 准备高峰价
PASSED
tests/test_fixture_intro.py::test_output_peak 
[fixture] 准备高峰价
PASSED

============================== 2 passed in 0.17s ===============================
```

`[fixture] 准备高峰价` 打印了两次,每个测试之前各一次。这是 fixture 的默认行为:**每个测试拿到的都是新调用一次得到的值**,和 `beforeEach` 一样。好处是测试之间互不影响,一个测试改了数据,下一个测试拿到的还是干净的。

单价以后要改,只改 fixture 里那一行。

### 名字写错会怎样

fixture 靠名字匹配,名字写错是最常见的错误。我故意把参数写成 `flash_peek`(peak 拼成 peek),放在一个新文件 `tests/test_typo.py` 里:

```python
# agent-zero-lab/tests/test_typo.py(演示完删掉)
from part01.cost import total_cost


def test_typo(flash_peek):
    price_in, price_out = flash_peek
    assert total_cost(1_000_000, 0, price_in, price_out) == 2.0
```

<div class="line-notes">

- `def test_typo(flash_peek):` pytest 会去找一个叫 `flash_peek` 的 fixture,找不到就报错,测试函数本身一行都不会执行。

</div>

```bash
uv run pytest tests/test_typo.py -q
```

实跑输出:

```text
E                                                                        [100%]
==================================== ERRORS ====================================
_________________________ ERROR at setup of test_typo __________________________
file /Users/你/agent-zero-lab/tests/test_typo.py, line 5
  def test_typo(flash_peek):
E       fixture 'flash_peek' not found
>       available fixtures: cache, capfd, capfdbinary, caplog, capsys, capsysbinary, capteesys, doctest_namespace, monkeypatch, pytestconfig, record_property, record_testsuite_property, record_xml_attribute, recwarn, subtests, tmp_path, tmp_path_factory, tmpdir, tmpdir_factory
>       use 'pytest --fixtures [testpath]' for help on them.

/Users/你/agent-zero-lab/tests/test_typo.py:5
=========================== short test summary info ============================
ERROR tests/test_typo.py::test_typo
1 error in 0.06s
```

结果是 `E`(ERROR),不是 `F`。`ERROR at setup` 的意思是「在准备阶段就出错了」,测试本体没跑。报错信息很友好:`fixture 'flash_peek' not found`,下面还列出了所有能用的 fixture。

仔细看这个列表,会发现一件怪事:**里面没有 `flash_peak`**。我们明明在 `test_fixture_intro.py` 里定义了它。原因是定义在某个测试文件里的 fixture,只有这个文件能用。想跨文件共享,要放进 `conftest.py`,第 4 步讲。列表里那些 `tmp_path`、`capsys`、`monkeypatch` 是 pytest 自带的,下一步就用 `tmp_path`。

演示完删掉:`rm tests/test_typo.py`。

## 第 2 步:用 yield 写清理步骤

有些准备工作做完要收尾:开了的文件要关,建的临时数据要删,连上的数据库要断开(后面课程里会大量遇到)。Jest 用 `afterEach`,pytest 把准备和清理写在同一个 fixture 里,中间用 `yield` 隔开。

`yield` 这个关键字以后讲生成器时会细讲,今天只用它最简单的意思:**「先把这个值交出去,等测试跑完,再回来接着执行下面的代码」**。新建 `tests/test_yield.py`:

```python
# agent-zero-lab/tests/test_yield.py
import pytest


@pytest.fixture
def notebook():
    print("\n[setup] 打开记录本")
    lines: list[str] = []
    yield lines
    print(f"[teardown] 收起记录本,里面有 {len(lines)} 行")


def test_write_one(notebook):
    notebook.append("第一次调用 0.000248 元")
    assert len(notebook) == 1


def test_fresh_each_time(notebook):
    assert notebook == []


def test_fails_but_teardown_runs(notebook):
    notebook.append("这条会失败")
    assert len(notebook) == 2
```

<div class="line-notes">

- `def notebook():` 一个假装的「记录本」,用列表模拟一份需要开和关的资源。
- `print("\n[setup] 打开记录本")` `yield` 之前的代码是准备阶段,相当于 `beforeEach`。
- `lines: list[str] = []` 建一个空列表,`list[str]` 是 [Day 46](/blog/agent-zero/day-046-type-hints-2/) 学的容器类型标注。
- `yield lines` 把列表交给测试。到这里 fixture 暂停,pytest 去运行测试函数。
- `print(f"[teardown] 收起记录本,里面有 {len(lines)} 行")` 测试跑完(不管过没过)才执行这一行,相当于 `afterEach`。它能看到测试往列表里加了几行,因为测试拿到的就是这同一个列表对象。
- `def test_write_one(notebook):` 往记录本里写一行。
- `notebook.append("第一次调用 0.000248 元")` 测试里改的是 fixture 交出来的那个列表。
- `assert len(notebook) == 1` 写了一行,长度是 1。
- `def test_fresh_each_time(notebook):` 验证每个测试拿到的都是新的。
- `assert notebook == []` 上一个测试写过一行,但这里拿到的是重新调用 fixture 得到的新空列表,所以成立。
- `def test_fails_but_teardown_runs(notebook):` 故意失败,看清理代码还跑不跑。
- `assert len(notebook) == 2` 只加了一行,长度是 1,断言失败。

</div>

```bash
uv run pytest tests/test_yield.py -s -v
```

实跑输出(中间部分):

```text
tests/test_yield.py::test_write_one 
[setup] 打开记录本
PASSED[teardown] 收起记录本,里面有 1 行

tests/test_yield.py::test_fresh_each_time 
[setup] 打开记录本
PASSED[teardown] 收起记录本,里面有 0 行

tests/test_yield.py::test_fails_but_teardown_runs 
[setup] 打开记录本
FAILED[teardown] 收起记录本,里面有 1 行


=================================== FAILURES ===================================
_________________________ test_fails_but_teardown_runs _________________________

notebook = ['这条会失败']

    def test_fails_but_teardown_runs(notebook):
        notebook.append("这条会失败")
>       assert len(notebook) == 2
E       AssertionError: assert 1 == 2
E        +  where 1 = len(['这条会失败'])

tests/test_yield.py:24: AssertionError
```

三件事都对上了。每个测试前打印 `[setup]`、后打印 `[teardown]`;第二个测试拿到的是空列表(`里面有 0 行`);第三个测试失败了,`[teardown]` 照样执行。最后这点很重要:清理代码不会因为测试失败被跳过,这和 [Day 36](/blog/agent-zero/day-036-exceptions-2/) 学的 `finally` 是一个道理。

失败报告开头多了一行 `notebook = ['这条会失败']`,pytest 会把测试用到的每个 fixture 的值都打印出来,排查时很方便。

看完把第三个故意失败的用例删掉(或者整个 `test_yield.py` 删掉,它只是演示),免得以后 `uv run pytest` 一直有一个红的。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="fixture 的生命周期和 parametrize 的展开">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">fixture:每个测试走一遍</text>
<rect x="20" y="40" width="270" height="34" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="32" y="62" fill="var(--ink)">yield 之前:准备(beforeEach)</text>
<line x1="155" y1="74" x2="155" y2="90" stroke="var(--rule)" stroke-width="2"/>
<rect x="20" y="90" width="270" height="34" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="32" y="112" fill="var(--ink)">测试函数(参数名 = fixture 名)</text>
<line x1="155" y1="124" x2="155" y2="140" stroke="var(--rule)" stroke-width="2"/>
<rect x="20" y="140" width="270" height="34" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="32" y="162" fill="var(--ink)">yield 之后:清理(afterEach)</text>
<text x="20" y="200" fill="var(--ink-soft)">测试失败也会执行清理</text>
<text x="20" y="218" fill="var(--ink-soft)">scope="module":整个文件只准备一次</text>
<text x="340" y="26" fill="var(--ink)">parametrize:一张表 → 多条用例</text>
<rect x="340" y="40" width="280" height="34" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="352" y="62" fill="var(--ink)">def test_total_cost_peak(...)</text>
<line x1="480" y1="74" x2="480" y2="90" stroke="var(--rule)" stroke-width="2"/>
<rect x="340" y="90" width="135" height="26" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="350" y="108" fill="var(--ink)">[input-1m]</text>
<rect x="485" y="90" width="135" height="26" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="495" y="108" fill="var(--ink)">[output-500k]</text>
<rect x="340" y="122" width="135" height="26" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="350" y="140" fill="var(--ink)">[real-call]</text>
<rect x="485" y="122" width="135" height="26" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="495" y="140" fill="var(--ink)">[zero]</text>
<rect x="340" y="154" width="135" height="26" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="350" y="172" fill="var(--ink)">[small-chat]</text>
<rect x="485" y="154" width="135" height="26" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="495" y="172" fill="var(--ink)">[long-chat]</text>
<text x="340" y="200" fill="var(--ink-soft)">每一行数据是一条独立用例</text>
<text x="340" y="218" fill="var(--ink-soft)">一条失败不影响其他五条</text>
<text x="20" y="246" fill="var(--ink-soft)">两者可以一起用:parametrize 的每条用例都会各自拿到一份新的 fixture</text>
</g>
</svg>
<figcaption>左边:fixture 以 yield 为界,前面是准备、后面是清理,每个测试各走一遍。右边:parametrize 把一个测试函数按数据表展开成多条用例,方括号里是用例 id。</figcaption>
</figure>

## 第 3 步:pytest 自带的 fixture,tmp_path

测读写文件的代码时,你不想往真实目录里写东西,写完还得记得删。pytest 自带一个叫 `tmp_path` 的 fixture,每个测试都会拿到一个**全新的、专属的临时目录**(一个 [Day 37](/blog/agent-zero/day-037-pathlib/) 学的 `Path` 对象),测完不用你管。

先给被测代码加一个读文件的函数。Agent 跑起来以后,每次调用模型的 token 用量会被记进一个 JSON 文件,我们要能从文件算出总花费。打开 `part01/cost.py`,改成下面这样(上半部分是 [Day 71](/blog/agent-zero/day-071-pytest-1/) 练习 3 改好的样子,新增的是顶部两行 import 和最后的 `total_from_file`):

```python
# agent-zero-lab/part01/cost.py
import json
from pathlib import Path


def total_cost(prompt_tokens: int, completion_tokens: int, price_in: float, price_out: float) -> float:
    """算一次模型调用花多少钱。单价单位:元 / 百万 token。"""
    if prompt_tokens < 0 or completion_tokens < 0:
        raise ValueError(f"token 数不能是负数: {prompt_tokens}, {completion_tokens}")
    return (prompt_tokens * price_in + completion_tokens * price_out) / 1_000_000


def total_from_file(path: Path, price_in: float, price_out: float) -> float:
    """读一份用量记录 JSON(列表,每条有 prompt_tokens 和 completion_tokens),算总花费。"""
    calls = json.loads(path.read_text(encoding="utf-8"))
    return sum(total_cost(c["prompt_tokens"], c["completion_tokens"], price_in, price_out) for c in calls)
```

<div class="line-notes">

- `import json` [Day 39](/blog/agent-zero/day-039-json/) 的 JSON 模块。
- `from pathlib import Path` 只为了类型标注 `path: Path`。
- `def total_cost(prompt_tokens: int` 和 Day 71 结束时一样,没改。
- `if prompt_tokens < 0 or completion_tokens < 0:` Day 71 练习 3 加的负数检查。
- `def total_from_file(path: Path, price_in: float, price_out: float) -> float:` 新函数:传入文件路径和单价,返回总花费。
- `calls = json.loads(path.read_text(encoding="utf-8"))` `read_text` 一次读出整个文件的字符串,`json.loads` 把它变成 Python 列表。文件内容是 `[{"prompt_tokens": 8, "completion_tokens": 29}, ...]` 时,`calls` 就是装着三个字典的列表。
- `return sum(total_cost(c["prompt_tokens"], c["completion_tokens"], price_in, price_out) for c in calls)` 每条记录 `c` 取出两个 token 数算一次花费,再全部加起来。代入 Day 71 练习 2 那三次调用,结果是 0.017848。

</div>

新建 `tests/test_usage_file.py`,先不用自定义 fixture,直接用 `tmp_path`:

```python
# agent-zero-lab/tests/test_usage_file.py(第一版)
import json
from pathlib import Path

import pytest

from part01.cost import total_from_file


def test_total_from_file(tmp_path: Path):
    calls = [
        {"prompt_tokens": 8, "completion_tokens": 29},
        {"prompt_tokens": 1200, "completion_tokens": 350},
        {"prompt_tokens": 3000, "completion_tokens": 800},
    ]
    path = tmp_path / "usage.json"
    path.write_text(json.dumps(calls), encoding="utf-8")
    assert total_from_file(path, 2.0, 8.0) == pytest.approx(0.017848)
```

<div class="line-notes">

- `def test_total_from_file(tmp_path: Path):` 参数名写 `tmp_path`,pytest 就把一个临时目录传进来。`: Path` 是类型标注,写上后编辑器能补全 `Path` 的方法,不写也能跑。
- `calls = [` 三条用量记录,和 Day 71 练习 2 的数据一样,方便核对。
- `path = tmp_path / "usage.json"` 用 `/` 拼路径,Day 37 学的。此时文件还不存在。
- `path.write_text(json.dumps(calls), encoding="utf-8")` 把列表转成 JSON 字符串写进文件。
- `assert total_from_file(path, 2.0, 8.0) == pytest.approx(0.017848)` 用真文件测读文件的函数,期望值 `0.000248 + 0.0052 + 0.0124 = 0.017848`。

</div>

这样能跑,但「造一份用量文件」这几行以后别的测试也会要。把它抽成一个自己的 fixture,而这个 fixture 本身又要用 `tmp_path`。**fixture 也可以在参数里要别的 fixture**,规则和测试函数一模一样。这一步我们直接写进 `conftest.py`。

## 第 4 步:conftest.py,放共享 fixture 的地方

第 1 步看到,写在某个测试文件里的 fixture 只有这个文件能用。pytest 约定:**`tests/` 目录下名叫 `conftest.py` 的文件里定义的 fixture,这个目录下所有测试文件都能直接用,不用 import**。名字是写死的,一个字母都不能错。

新建 `tests/conftest.py`:

```python
# agent-zero-lab/tests/conftest.py
import json
from pathlib import Path

import pytest


@pytest.fixture
def flash_peak() -> tuple[float, float]:
    return (2.0, 8.0)


@pytest.fixture
def usage_file(tmp_path: Path) -> Path:
    calls = [
        {"prompt_tokens": 8, "completion_tokens": 29},
        {"prompt_tokens": 1200, "completion_tokens": 350},
        {"prompt_tokens": 3000, "completion_tokens": 800},
    ]
    path = tmp_path / "usage.json"
    path.write_text(json.dumps(calls), encoding="utf-8")
    print(f"\n[usage_file] 写到 {path}")
    return path
```

<div class="line-notes">

- `import json` 下面造文件要用。
- `def flash_peak() -> tuple[float, float]:` 第 1 步那个 fixture 搬到这里,加了返回值标注:两个浮点数组成的元组。去掉了 `print`。
- `return (2.0, 8.0)` 高峰价。
- `def usage_file(tmp_path: Path) -> Path:` 自定义 fixture 要了内置 fixture `tmp_path`。pytest 会先准备 `tmp_path`,再调用 `usage_file`,最后把 `usage_file` 的返回值交给测试。这条依赖链是 pytest 自动理顺的。
- `path = tmp_path / "usage.json"` 每个测试的 `tmp_path` 都不同,所以每个测试拿到的 `usage.json` 也是各自独立的一份。
- `path.write_text(json.dumps(calls), encoding="utf-8")` 写入三条记录。
- `print(f"\n[usage_file] 写到 {path}")` 看看临时目录到底在哪,看完可以删掉。
- `return path` 测试拿到的是一个已经写好内容的文件路径。

</div>

然后把 `tests/test_usage_file.py` 改成第二版,测试函数变得非常短:

```python
# agent-zero-lab/tests/test_usage_file.py
import pytest

from part01.cost import total_from_file


def test_total_from_file(usage_file, flash_peak):
    price_in, price_out = flash_peak
    assert total_from_file(usage_file, price_in, price_out) == pytest.approx(0.017848)


def test_file_is_fresh(usage_file):
    assert usage_file.name == "usage.json"
    assert len(usage_file.read_text(encoding="utf-8")) > 0
```

<div class="line-notes">

- `from part01.cost import total_from_file` 被测代码照常导入。注意这里**没有**从 `conftest` 导入任何东西,fixture 是 pytest 按名字自动找到的。
- `def test_total_from_file(usage_file, flash_peak):` 一次要两个 fixture,参数顺序随意。
- `price_in, price_out = flash_peak` 解包得 2.0 和 8.0。
- `assert total_from_file(usage_file, price_in, price_out) == pytest.approx(0.017848)` `usage_file` 是 fixture 写好的那个文件路径。
- `def test_file_is_fresh(usage_file):` 第二个测试只要文件,不要单价。
- `assert usage_file.name == "usage.json"` `Path.name` 是文件名部分。
- `assert len(usage_file.read_text(encoding="utf-8")) > 0` 文件确实有内容。

</div>

第 1 步的 `tests/test_fixture_intro.py` 里也定义了一个 `flash_peak`,和 `conftest.py` 里的重名了。测试文件自己的定义会优先,不会报错,但两份定义迟早改漏一份,删掉这个演示文件:`rm tests/test_fixture_intro.py`。

```bash
uv run pytest tests/test_usage_file.py -s -v
```

实跑输出(中间部分,临时目录前缀我缩写成了 `...`):

```text
tests/test_usage_file.py::test_total_from_file 
[usage_file] 写到 /private/var/folders/.../T/pytest-of-minliu/pytest-10/test_total_from_file0/usage.json
PASSED
tests/test_usage_file.py::test_file_is_fresh 
[usage_file] 写到 /private/var/folders/.../T/pytest-of-minliu/pytest-10/test_file_is_fresh0/usage.json
PASSED

============================== 2 passed in 0.18s ===============================
```

两个测试的文件路径不一样,一个在 `test_total_from_file0/`,一个在 `test_file_is_fresh0/`,目录名就是测试名。`pytest-10` 是第几次运行,按 pytest 文档,它只保留最近 3 次运行的临时目录,更早的自动删,所以不用担心把硬盘写满。目录前面的 `pytest-of-minliu` 里是你的系统用户名。

想看现在有哪些 fixture 可用:

```bash
uv run pytest --fixtures tests/test_usage_file.py
```

输出很长(pytest 自带的那些都会列出来),拉到最底下有一段:

```text
------------------------ fixtures defined from conftest ------------------------
usage_file -- tests/conftest.py:14
    no docstring available
```

后面紧跟着 `flash_peak` 那一条,格式一样。`no docstring available` 是说这个 fixture 没写 docstring,写上一行三引号说明,这里就会显示出来,项目大了以后建议写。

## 第 5 步:scope,让慢的准备工作只做一次

默认每个测试都重新调用一次 fixture。如果准备工作很慢(比如后面课程里要连数据库、加载一个大文件),每个测试都来一遍就太浪费了。`@pytest.fixture(scope="module")` 表示「这个文件里所有测试共用一份」。

```python
# agent-zero-lab/tests/test_scope.py
import pytest


@pytest.fixture(scope="module")
def price_table():
    print("\n[price_table] 读价格表(假装很慢)")
    return {"flash_peak": (2.0, 8.0), "flash_idle": (1.0, 4.0)}


def test_peak(price_table):
    assert price_table["flash_peak"] == (2.0, 8.0)


def test_idle(price_table):
    assert price_table["flash_idle"] == (1.0, 4.0)


def test_idle_is_half(price_table):
    peak_in, peak_out = price_table["flash_peak"]
    idle_in, idle_out = price_table["flash_idle"]
    assert (idle_in, idle_out) == (peak_in / 2, peak_out / 2)
```

<div class="line-notes">

- `@pytest.fixture(scope="module")` 带参数的写法。`scope` 可选 `"function"`(默认,每个测试一次)、`"module"`(每个文件一次)、`"session"`(整次 pytest 运行一次)等。
- `print("\n[price_table] 读价格表(假装很慢)")` 用来数它被调用了几次。
- `return {"flash_peak": (2.0, 8.0), "flash_idle": (1.0, 4.0)}` 一个字典,键是档位名,值是 `(输入价, 输出价)`。空闲价是高峰价的一半,这是 DeepSeek 价格页写明的规则。
- `def test_peak(price_table):` 取高峰价比较。元组可以直接用 `==` 比,逐个元素比较。
- `def test_idle(price_table):` 取空闲价比较。
- `def test_idle_is_half(price_table):` 验证「空闲价是高峰价的一半」这条规则。
- `peak_in, peak_out = price_table["flash_peak"]` 解包得 2.0 和 8.0。
- `idle_in, idle_out = price_table["flash_idle"]` 解包得 1.0 和 4.0。
- `assert (idle_in, idle_out) == (peak_in / 2, peak_out / 2)` 右边算出 `(1.0, 4.0)`,和左边相等。这里用 `==` 没问题,因为 2.0/2 和 8.0/2 都能被浮点数精确表示。

</div>

```bash
uv run pytest tests/test_scope.py -s -v
```

实跑输出(中间部分):

```text
tests/test_scope.py::test_peak 
[price_table] 读价格表(假装很慢)
PASSED
tests/test_scope.py::test_idle PASSED
tests/test_scope.py::test_idle_is_half PASSED
```

三个测试,打印只出现一次。我把 `(scope="module")` 删掉再跑,实跑打印了三次 `[price_table] 读价格表(假装很慢)`。

代价是:共用一份就意味着一个测试改了它,后面的测试会看到改过的版本。练习 4 专门让你观察这个坑。我的经验是,只有「准备起来确实慢,而且测试只读不改」的东西才用 `module` 或 `session`,其他一律用默认。

## 第 6 步:parametrize,一个函数配一张数据表

回到第二种重复:逻辑一样、数据不同。`@pytest.mark.parametrize` 让你把数据写成一张表,pytest 按表的每一行生成一条独立的用例。新建 `tests/test_cost_param.py`,先写最朴素的版本:

```python
# agent-zero-lab/tests/test_cost_param.py(第一版)
import pytest

from part01.cost import total_cost


@pytest.mark.parametrize(
    ("prompt_tokens", "completion_tokens", "expected"),
    [
        (1_000_000, 0, 2.0),
        (0, 500_000, 4.0),
        (8, 29, 0.000248),
        (0, 0, 0.0),
        (1200, 350, 0.0052),
        (3000, 800, 0.0124),
    ],
)
def test_total_cost_peak(prompt_tokens, completion_tokens, expected):
    assert total_cost(prompt_tokens, completion_tokens, 2.0, 8.0) == pytest.approx(expected)
```

<div class="line-notes">

- `@pytest.mark.parametrize(` `pytest.mark` 下面是各种「标记」,`parametrize` 是其中一个。它接收两个参数:参数名,和数据表。
- `("prompt_tokens", "completion_tokens", "expected"),` 第一个参数:一个字符串元组,写这张表每一列叫什么。这些名字必须和下面测试函数的参数名一一对上。也可以写成一个逗号分隔的字符串 `"prompt_tokens,completion_tokens,expected"`,效果一样。
- `[` 第二个参数:一个列表,每个元素是一行数据。
- `(1_000_000, 0, 2.0),` 第一行:100 万输入、0 输出,期望 2.0 元。三个值按顺序对应三个列名。
- `(0, 500_000, 4.0),` 只有输出:`500_000 × 8 / 1e6 = 4.0`。
- `(8, 29, 0.000248),` 一次真实的小调用:`(16 + 232) / 1e6`。
- `(0, 0, 0.0),` 边界:什么都没用。
- `(1200, 350, 0.0052),` `(2400 + 2800) / 1e6 = 0.0052`。
- `(3000, 800, 0.0124),` `(6000 + 6400) / 1e6 = 0.0124`。
- `def test_total_cost_peak(prompt_tokens, completion_tokens, expected):` 测试函数只写一个,三个参数接收每一行的三个值。
- `assert total_cost(prompt_tokens, completion_tokens, 2.0, 8.0) == pytest.approx(expected)` 期望值有小数,统一用 `approx`。以第三行为例代入:`total_cost(8, 29, 2.0, 8.0) == approx(0.000248)`。

</div>

```bash
uv run pytest tests/test_cost_param.py -v
```

实跑输出(中间部分):

```text
collecting ... collected 6 items

tests/test_cost_param.py::test_total_cost_peak[1000000-0-2.0] PASSED     [ 16%]
tests/test_cost_param.py::test_total_cost_peak[0-500000-4.0] PASSED      [ 33%]
tests/test_cost_param.py::test_total_cost_peak[8-29-0.000248] PASSED     [ 50%]
tests/test_cost_param.py::test_total_cost_peak[0-0-0.0] PASSED           [ 66%]
tests/test_cost_param.py::test_total_cost_peak[1200-350-0.0052] PASSED   [ 83%]
tests/test_cost_param.py::test_total_cost_peak[3000-800-0.0124] PASSED   [100%]

============================== 6 passed in 0.04s ===============================
```

一个函数,`collected 6 items`。每条用例的名字后面多了方括号,里面是这一行的数据用 `-` 连起来,这叫 **用例 id**。node id 也因此变成了 `test_total_cost_peak[8-29-0.000248]` 这样。

看看其中一行算错时报告长什么样。我把最后一行的期望值故意写成 `0.0142`(数字颠倒,很真实的手误):

```text
            (1200, 350, 0.0052),
            (3000, 800, 0.0142),
        ],
    )
    def test_total_cost_peak(prompt_tokens, completion_tokens, expected):
>       assert total_cost(prompt_tokens, completion_tokens, 2.0, 8.0) == pytest.approx(expected)
E       assert 0.0124 == 0.0142 ± 1.4e-08
E         
E         comparison failed
E         Obtained: 0.0124
E         Expected: 0.0142 ± 1.4e-08

tests/test_cost_param.py:19: AssertionError
=========================== short test summary info ============================
FAILED tests/test_cost_param.py::test_total_cost_peak[3000-800-0.0142] - asse...
1 failed, 5 passed in 0.10s
```

`1 failed, 5 passed`,只有出错的那一行红,其他五行不受影响。`FAILED` 那一行的 id `[3000-800-0.0142]` 直接告诉你是哪组数据。`Obtained` 是实际值,`Expected` 是期望值和允许误差(`± 1.4e-08`,就是 0.0142 的百万分之一)。看完改回 `0.0124`。

### 给每一行起个名字:pytest.param 和 id

`[1000000-0-2.0]` 这种自动生成的 id 还能看,数据一复杂(比如一行是一段文本、一个字典)就没法读了。用 `pytest.param(..., id="名字")` 给每行起名,顺便把单价换成 conftest 里的 `flash_peak` fixture。把 `test_cost_param.py` 改成最终版,这也是今天的「大代码」:

```python
# agent-zero-lab/tests/test_cost_param.py
import pytest

from part01.cost import total_cost


@pytest.mark.parametrize(
    ("prompt_tokens", "completion_tokens", "expected"),
    [
        pytest.param(1_000_000, 0, 2.0, id="input-1m"),
        pytest.param(0, 500_000, 4.0, id="output-500k"),
        pytest.param(8, 29, 0.000248, id="real-call"),
        pytest.param(0, 0, 0.0, id="zero"),
        pytest.param(1200, 350, 0.0052, id="small-chat"),
        pytest.param(3000, 800, 0.0124, id="long-chat"),
    ],
)
def test_total_cost_peak(prompt_tokens, completion_tokens, expected, flash_peak):
    price_in, price_out = flash_peak
    assert total_cost(prompt_tokens, completion_tokens, price_in, price_out) == pytest.approx(expected)


@pytest.mark.parametrize(
    ("prompt_tokens", "completion_tokens"),
    [(-1, 0), (0, -5), (-3, -3)],
)
def test_negative_tokens(prompt_tokens, completion_tokens, flash_peak):
    price_in, price_out = flash_peak
    with pytest.raises(ValueError, match="不能是负数"):
        total_cost(prompt_tokens, completion_tokens, price_in, price_out)
```

<div class="line-notes">

- `@pytest.mark.parametrize(` 第一组参数化,测正常值。
- `("prompt_tokens", "completion_tokens", "expected"),` 列名和第一版一样。
- `pytest.param(1_000_000, 0, 2.0, id="input-1m"),` `pytest.param` 包住一行数据,`id=` 给这一行起名。id 里别用空格,后面用 node id 点名时会方便很多。
- `pytest.param(0, 500_000, 4.0, id="output-500k"),` 只有输出的情况。
- `pytest.param(8, 29, 0.000248, id="real-call"),` 一次真实的小调用。
- `pytest.param(0, 0, 0.0, id="zero"),` 边界值。
- `pytest.param(1200, 350, 0.0052, id="small-chat"),` 一轮普通聊天。
- `pytest.param(3000, 800, 0.0124, id="long-chat"),` 上下文较长的一轮。
- `def test_total_cost_peak(prompt_tokens, completion_tokens, expected, flash_peak):` 前三个参数来自 parametrize 的表,最后一个 `flash_peak` 来自 `conftest.py` 的 fixture。pytest 看参数名就知道谁该从哪来,两种来源可以混用。
- `price_in, price_out = flash_peak` 每条用例都会单独拿到一份 `flash_peak`,6 条用例就调用 6 次 fixture。
- `assert total_cost(prompt_tokens, completion_tokens, price_in, price_out) == pytest.approx(expected)` 以 `long-chat` 为例代入:`total_cost(3000, 800, 2.0, 8.0)` 得 `0.0124`,和期望相等。
- `@pytest.mark.parametrize(` 第二组参数化,测异常情况。Day 71 写的两个负数用例在这里合成了一个。
- `("prompt_tokens", "completion_tokens"),` 这组没有期望值列,因为期望就是「抛异常」。
- `[(-1, 0), (0, -5), (-3, -3)],` 三行数据:输入为负、输出为负、两个都为负。没写 id,用自动生成的。
- `def test_negative_tokens(prompt_tokens, completion_tokens, flash_peak):` 同样混用参数化和 fixture。
- `with pytest.raises(ValueError, match="不能是负数"):` Day 71 学的,块里必须抛 `ValueError`,错误信息里要有「不能是负数」。
- `total_cost(prompt_tokens, completion_tokens, price_in, price_out)` 以 `(0, -5)` 为例,错误信息是 `token 数不能是负数: 0, -5`,符合要求。

</div>

```bash
uv run pytest tests/test_cost_param.py -v
```

实跑输出(中间部分):

```text
collecting ... collected 9 items

tests/test_cost_param.py::test_total_cost_peak[input-1m] PASSED          [ 11%]
tests/test_cost_param.py::test_total_cost_peak[output-500k] PASSED       [ 22%]
tests/test_cost_param.py::test_total_cost_peak[real-call] PASSED         [ 33%]
tests/test_cost_param.py::test_total_cost_peak[zero] PASSED              [ 44%]
tests/test_cost_param.py::test_total_cost_peak[small-chat] PASSED        [ 55%]
tests/test_cost_param.py::test_total_cost_peak[long-chat] PASSED         [ 66%]
tests/test_cost_param.py::test_negative_tokens[-1-0] PASSED              [ 77%]
tests/test_cost_param.py::test_negative_tokens[0--5] PASSED              [ 88%]
tests/test_cost_param.py::test_negative_tokens[-3--3] PASSED             [100%]

============================== 9 passed in 0.10s ===============================
```

两个函数、9 条用例。自动 id `[0--5]` 是 `0` 和 `-5` 用 `-` 连起来,看着别扭但能读懂。

有了 id,[Day 72](/blog/agent-zero/day-072-pytest-2/) 学的挑着跑也更顺手了:

```bash
uv run pytest "tests/test_cost_param.py::test_total_cost_peak[real-call]" -q
uv run pytest tests/test_cost_param.py -k chat -q
```

<div class="line-notes">

- `uv run pytest "tests/test_cost_param.py::test_total_cost_peak[real-call]" -q` 带方括号的 node id 要用引号括起来,zsh 会把方括号当成通配符,不加引号会报 `no matches found`。
- `uv run pytest tests/test_cost_param.py -k chat -q` `-k` 也匹配用例 id,`small-chat` 和 `long-chat` 都含 chat。

</div>

实跑输出依次是:

```text
.                                                                        [100%]
1 passed in 0.05s
```

```text
..                                                                       [100%]
2 passed, 7 deselected in 0.09s
```

### 列名和参数名对不上会怎样

parametrize 的列名写错是第二常见的错误。我把列名写成 `tokens`,函数参数写成 `token`:

```python
# agent-zero-lab/tests/test_bad_param.py(演示完删掉)
import pytest


@pytest.mark.parametrize(("tokens", "expected"), [(1, 2)])
def test_bad(token, expected):
    assert token + 1 == expected
```

<div class="line-notes">

- `@pytest.mark.parametrize(("tokens", "expected"), [(1, 2)])` 列名是 `tokens`,多了个 s。
- `def test_bad(token, expected):` 参数名是 `token`,和列名对不上。

</div>

实跑 `uv run pytest tests/test_bad_param.py -q`:

```text
==================================== ERRORS ====================================
___________________ ERROR collecting tests/test_bad_param.py ___________________
In tests/test_bad_param.py::test_bad: function uses no argument 'tokens'
=========================== short test summary info ============================
ERROR tests/test_bad_param.py - Failed: In tests/test_bad_param.py::test_bad:...
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
1 error in 0.17s
```

在收集阶段就报错了:`function uses no argument 'tokens'`,函数没有叫 `tokens` 的参数。看到这句就去对列名。演示完删掉:`rm tests/test_bad_param.py`。

## 零件和成品的对照

今天最后留在仓库里的文件,每一块来自哪一步:

| 成品里的这一段 | 来自 | 做什么 |
| --- | --- | --- |
| `conftest.py` 的 `flash_peak` | 第 1 步 + 第 4 步 | 共享单价,改价只改一处 |
| `conftest.py` 的 `usage_file` | 第 3 步 + 第 4 步 | 用 `tmp_path` 造一份用量文件 |
| `test_usage_file.py` | 第 3、4 步 | 测 `total_from_file` |
| `test_scope.py` 的 `scope="module"` | 第 5 步 | 慢的准备只做一次 |
| `test_cost_param.py` 第一组 | 第 6 步 | 6 条正常值用例,带 id |
| `test_cost_param.py` 第二组 | 第 6 步 + Day 71 的 `pytest.raises` | 3 条异常用例 |

`tests/test_cost.py` 和 `tests/test_cost_more.py` 里的用例和 `test_cost_param.py` 有重叠。我建议先留着,它们是你 Day 71 亲手写的「原始版本」,明天复习时可以对比;等你看熟了 parametrize 的写法,可以自己决定删掉重复的。做完下面的练习后,`uv run pytest -q` 我这里实跑是 `30 passed`。

## 动手练习

**练习 1:空闲价 fixture。** 在 `tests/conftest.py` 里加一个 `flash_idle` fixture,返回空闲价 `(1.0, 4.0)`。新建 `tests/test_ex73.py`,写一个测试同时要 `flash_peak` 和 `flash_idle` 两个 fixture,验证同一次调用 `(3000, 800)` 在空闲时段的花费正好是高峰时段的一半。

<details><summary>参考答案</summary>

`conftest.py` 末尾追加:

```python
# agent-zero-lab/tests/conftest.py(末尾追加)
@pytest.fixture
def flash_idle() -> tuple[float, float]:
    return (1.0, 4.0)
```

<div class="line-notes">

- `def flash_idle() -> tuple[float, float]:` 和 `flash_peak` 写法一样,名字不同。
- `return (1.0, 4.0)` 空闲价,高峰价的一半。

</div>

`tests/test_ex73.py`:

```python
# agent-zero-lab/tests/test_ex73.py
import pytest

from part01.cost import total_cost


def test_idle_is_half_of_peak(flash_peak, flash_idle):
    peak = total_cost(3000, 800, *flash_peak)
    idle = total_cost(3000, 800, *flash_idle)
    assert idle == pytest.approx(peak / 2)
```

<div class="line-notes">

- `def test_idle_is_half_of_peak(flash_peak, flash_idle):` 同时要两个 fixture,pytest 两个都准备好再调用测试。
- `peak = total_cost(3000, 800, *flash_peak)` `*flash_peak` 把元组 `(2.0, 8.0)` 拆开当作两个位置参数传进去,等于 `total_cost(3000, 800, 2.0, 8.0)`。这是 [Day 30](/blog/agent-zero/day-030-functions-3/) 学的 `*` 在调用时的用法,相当于 JS 的展开运算符 `...`。实测 `peak` 是 `0.0124`。
- `idle = total_cost(3000, 800, *flash_idle)` 等于 `total_cost(3000, 800, 1.0, 4.0)`,实测 `0.0062`。
- `assert idle == pytest.approx(peak / 2)` `0.0124 / 2 = 0.0062`,相等。

</div>

实跑 `uv run pytest tests/test_ex73.py -v`,输出里有:

```text
tests/test_ex73.py::test_idle_is_half_of_peak PASSED                     [ 11%]
```

(百分比是 11%,因为练习 2、3 的用例也在这个文件里,全部做完一共 9 条。)

</details>

**练习 2:两个 parametrize 叠在一起。** 在 `test_ex73.py` 里写一个测试 `test_cost_positive`,验证「只要 token 数不全为 0,花费一定大于 0」。用两个 `@pytest.mark.parametrize` 叠着写:一个给出两档价格 `("peak", 2.0, 8.0)`、`("idle", 1.0, 4.0)`,一个给出三组 token `(8, 29)`、`(1200, 350)`、`(3000, 800)`。先猜一共会生成几条用例,再跑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_ex73.py(追加)
@pytest.mark.parametrize(("tier", "price_in", "price_out"), [("peak", 2.0, 8.0), ("idle", 1.0, 4.0)])
@pytest.mark.parametrize(("prompt_tokens", "completion_tokens"), [(8, 29), (1200, 350), (3000, 800)])
def test_cost_positive(tier, price_in, price_out, prompt_tokens, completion_tokens):
    assert total_cost(prompt_tokens, completion_tokens, price_in, price_out) > 0
```

<div class="line-notes">

- `@pytest.mark.parametrize(("tier", "price_in", "price_out"), [("peak", 2.0, 8.0), ("idle", 1.0, 4.0)])` 第一张表 2 行。`tier` 这一列只是给人看的档位名,测试里没用它,但它会出现在用例 id 里,读报告时一眼知道是哪档。
- `@pytest.mark.parametrize(("prompt_tokens", "completion_tokens"), [(8, 29), (1200, 350), (3000, 800)])` 第二张表 3 行。两个装饰器叠在一起,pytest 会做「每一行配每一行」的组合,也就是 2 × 3 = 6 条。
- `def test_cost_positive(tier, price_in, price_out, prompt_tokens, completion_tokens):` 五个参数分别来自两张表。
- `assert total_cost(prompt_tokens, completion_tokens, price_in, price_out) > 0` 比如 `idle` 档配 `(8, 29)`:`(8×1 + 29×4) / 1e6 = 124 / 1e6 = 0.000124 > 0`。

</div>

答案是 6 条。实跑输出:

```text
tests/test_ex73.py::test_cost_positive[8-29-peak-2.0-8.0] PASSED         [ 22%]
tests/test_ex73.py::test_cost_positive[8-29-idle-1.0-4.0] PASSED         [ 33%]
tests/test_ex73.py::test_cost_positive[1200-350-peak-2.0-8.0] PASSED     [ 44%]
tests/test_ex73.py::test_cost_positive[1200-350-idle-1.0-4.0] PASSED     [ 55%]
tests/test_ex73.py::test_cost_positive[3000-800-peak-2.0-8.0] PASSED     [ 66%]
tests/test_ex73.py::test_cost_positive[3000-800-idle-1.0-4.0] PASSED     [ 77%]
```

注意 id 的顺序:离 `def` 最近的那个装饰器(token 表)的值排在 id 前面。叠加很省事,但用例数是乘出来的,三张 10 行的表叠在一起就是 1000 条,用之前先算一下。

</details>

**练习 3:用 tmp_path 测两种异常文件。** 在 `test_ex73.py` 里写两个测试:①文件内容是空列表 `[]` 时,`total_from_file` 返回 0;②某条记录缺了 `completion_tokens` 字段时,会抛 `KeyError`。

<details><summary>参考答案</summary>

文件顶部的 import 要补上 `json`、`Path` 和 `total_from_file`,完整的顶部是:

```python
# agent-zero-lab/tests/test_ex73.py(顶部 import 的最终样子)
import json
from pathlib import Path

import pytest

from part01.cost import total_cost, total_from_file
```

<div class="line-notes">

- `import json` 造缺字段的文件要用。
- `from pathlib import Path` 给 `tmp_path` 参数写类型标注用。
- `from part01.cost import total_cost, total_from_file` 一行导入两个函数,逗号分隔。

</div>

两个测试追加在文件末尾:

```python
# agent-zero-lab/tests/test_ex73.py(末尾追加)
def test_empty_file(tmp_path: Path):
    path = tmp_path / "empty.json"
    path.write_text("[]", encoding="utf-8")
    assert total_from_file(path, 2.0, 8.0) == 0


def test_missing_key(tmp_path: Path):
    path = tmp_path / "bad.json"
    path.write_text(json.dumps([{"prompt_tokens": 8}]), encoding="utf-8")
    with pytest.raises(KeyError):
        total_from_file(path, 2.0, 8.0)
```

<div class="line-notes">

- `def test_empty_file(tmp_path: Path):` 这次直接用内置的 `tmp_path`,因为文件内容特殊,不适合用通用的 `usage_file`。
- `path.write_text("[]", encoding="utf-8")` 文件内容是空的 JSON 数组。
- `assert total_from_file(path, 2.0, 8.0) == 0` `calls` 是空列表,`sum(...)` 对空序列求和得 `0`。这个行为值得有一个测试钉住,不然哪天有人把 `sum` 改成别的写法,空文件可能就炸了。
- `def test_missing_key(tmp_path: Path):` 测坏数据。
- `path.write_text(json.dumps([{"prompt_tokens": 8}]), encoding="utf-8")` 只有一条记录,而且缺了 `completion_tokens`。
- `with pytest.raises(KeyError):` 字典取不存在的键会抛 `KeyError`,这里断言它确实被抛出。
- `total_from_file(path, 2.0, 8.0)` 执行到 `c["completion_tokens"]` 时抛异常,被 `pytest.raises` 接住。

</div>

实跑输出:

```text
tests/test_ex73.py::test_empty_file PASSED                               [ 88%]
tests/test_ex73.py::test_missing_key PASSED                              [100%]

============================== 9 passed in 0.08s ===============================
```

</details>

**练习 4(观察题):module 级 fixture 被改了会怎样。** 新建 `tests/test_scope_leak.py`,写一个 `scope="module"` 的 fixture,返回一个空列表。两个测试各往列表里 `append` 一个数,然后各自断言列表长度是 1。跑一下,看哪个失败、为什么;再把 `scope="module"` 去掉跑一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/tests/test_scope_leak.py
import pytest


@pytest.fixture(scope="module")
def calls():
    return []


def test_first(calls):
    calls.append(0.000248)
    assert len(calls) == 1


def test_second(calls):
    calls.append(0.0052)
    assert len(calls) == 1
```

<div class="line-notes">

- `@pytest.fixture(scope="module")` 整个文件只调用一次,两个测试拿到的是同一个列表对象。
- `return []` 返回一个空列表。
- `calls.append(0.000248)` 第一个测试往里加一个数,列表变成 `[0.000248]`。
- `assert len(calls) == 1` 第一个测试里成立。
- `calls.append(0.0052)` 第二个测试拿到的还是那个列表,里面已经有第一个测试加的数,再加一个变成 `[0.000248, 0.0052]`。
- `assert len(calls) == 1` 长度是 2,失败。

</div>

实跑输出(末尾):

```text
    def test_second(calls):
        calls.append(0.0052)
>       assert len(calls) == 1
E       assert 2 == 1
E        +  where 2 = len([0.000248, 0.0052])

tests/test_scope_leak.py:17: AssertionError
=========================== short test summary info ============================
FAILED tests/test_scope_leak.py::test_second - assert 2 == 1
1 failed, 1 passed in 0.19s
```

去掉 `(scope="module")` 后实跑 `2 passed`,因为每个测试各自拿到一个新列表。更麻烦的是,共享状态的测试结果还依赖执行顺序:单独跑 `test_second` 它是能过的。这种「单独跑能过、一起跑就挂」的测试,先怀疑共享的 fixture。看完删掉这个文件。

</details>

**验收标准:** `tests/conftest.py` 里有 `flash_peak`、`flash_idle`、`usage_file` 三个 fixture;`tests/test_cost_param.py` 用 parametrize 生成 9 条用例并带 id;`uv run pytest -q` 全部通过(我这里是 `30 passed`,你的数字可能因为删没删演示文件而不同,用 `uv run pytest --co -q` 核对);你能说出 fixture 和 `beforeEach` 的一个相同点和一个不同点。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| fixture | 给测试准备数据或资源的函数,用 `@pytest.fixture` 标记,测试在参数里写它的名字就能拿到返回值 |
| 依赖注入 | 测试不自己造依赖,由框架按参数名把准备好的东西传进来 |
| 装饰器(写法) | 写在 `def` 上一行、以 `@` 开头的标记,今天只用到它「给函数贴标签」的效果 |
| `yield`(在 fixture 里) | 把值交给测试,测试结束后回到这里执行后面的清理代码 |
| setup / teardown | 测试前的准备 / 测试后的清理 |
| `ERROR at setup` | 测试在准备 fixture 时出错,测试本体没运行 |
| `tmp_path` | pytest 自带的 fixture,给每个测试一个独立的临时目录(`Path` 对象) |
| `conftest.py` | 放共享 fixture 的文件,同目录及子目录的测试都能直接用,不用 import |
| scope | fixture 的复用范围:`function`(默认,每个测试一次)、`module`(每个文件一次)、`session`(整次运行一次) |
| parametrize | 用 `@pytest.mark.parametrize` 给测试函数配一张数据表,每行生成一条用例 |
| 用例 id | 参数化用例方括号里的名字,如 `[real-call]`,默认由数据拼成 |
| `pytest.param` | 包住参数化的一行数据,可以用 `id=` 给它起名 |
| `pytest.mark` | pytest 的「标记」集合,`parametrize` 是其中之一 |
| `--fixtures` | 列出当前能用的所有 fixture 及其定义位置 |

## 常见误区

**在测试里直接调用 fixture 函数。** 有人会写 `from tests.conftest import flash_peak`,然后 `flash_peak()`。我实测 pytest 9.1.1 直接让测试失败,报 `Fixture "flash_peak" called directly. Fixtures are not meant to be called directly, but are created automatically when test functions request them as parameters.` fixture 只能通过参数名去要,不能当普通函数调用。

**fixture 名字拼错。** 报 `fixture 'xxx' not found`,结果显示为 `E` 不是 `F`。报错下面列出了所有可用的 fixture,对着找就行。如果你确定写对了还是找不到,检查它是不是定义在别的测试文件里,该放进 `conftest.py`。

**conftest.py 名字写错或放错地方。** 写成 `conftests.py`、`conf_test.py`,或者放在 `part01/` 里而测试在 `tests/` 里,pytest 都不会认。名字一个字母不能错,放在测试所在的目录(或它的上级目录)。

**以为 fixture 只执行一次。** 默认每个测试都重新执行。想复用要显式写 `scope`,而且 `module`、`session` 级的 fixture 如果是可变对象(列表、字典),一个测试改了它,后面的测试都受影响,练习 4 演示过。

**parametrize 的列名和函数参数名对不上。** 收集阶段直接报 `function uses no argument 'xxx'`。列名是字符串,编辑器帮不了你检查,多一个 s 少一个 s 都会出错。

**叠了好几个 parametrize 没算用例数。** 叠加是乘法,2 × 3 = 6 还好,三张 10 行的表就是 1000 条。加之前先算。

**node id 里的方括号没加引号。** zsh 会把 `test_x[real-call]` 里的方括号当通配符,报 `zsh: no matches found`。整个 node id 用双引号括起来。

**清理代码写在 return 后面。** `return` 之后的代码永远不会执行。要清理就用 `yield` 代替 `return`。

## 学习资料

### 文档与文章

- [pytest 文档 · How to use fixtures](https://docs.pytest.org/en/stable/how-to/fixtures.html):fixture 的完整用法,`yield` 清理、`scope`、`conftest.py` 都在这一页,先读前三节。
- [pytest 文档 · How to parametrize fixtures and test functions](https://docs.pytest.org/en/stable/how-to/parametrize.html):`parametrize`、`pytest.param`、叠加的说明和例子。
- [pytest 文档 · How to use temporary directories and files in tests](https://docs.pytest.org/en/stable/how-to/tmp_path.html):`tmp_path` 目录放在哪、保留几次。
- [pytest 文档 · API Reference](https://docs.pytest.org/en/stable/reference/reference.html):查 `pytest.fixture`、`pytest.param` 的全部参数时用,不用通读。
- [Vitest 文档 · API](https://vitest.dev/api/):对照看 `beforeEach`、`afterEach`、`test.each`,把两边的概念对上号。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vu4y1j79r&autoplay=0&high_quality=1" title="Python单元测试-09.PyTest fixture基础" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟峰哥学编程 · Python单元测试-09.PyTest fixture基础 · 15 分钟。正好接着 Day 71 推荐的第 08 集,讲 fixture 的定义和注入,和今天第 1、2 步对着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EC4y1273B&autoplay=0&high_quality=1" title="Python单元测试-10.conftest.py" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟峰哥学编程 · Python单元测试-10.conftest.py · 11 分钟。专讲 conftest.py 的作用范围,对应今天第 4 步。同系列第 11 集「参数化测试用例」(BV1z64y177VF)对应第 6 步,可以接着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aQH7hyJn-No" title="pytest's parametrize (beginner - intermediate) anthony explains #027" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>anthonywritescode · pytest's parametrize (beginner - intermediate) anthony explains #027 · 作者是 pytest 核心维护者之一,英文,讲 parametrize 的写法和 id,短。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ScEQRKwUePI" title="pytest: everything you need to know about fixtures (intermediate) anthony explains #487" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>anthonywritescode · pytest: everything you need to know about fixtures (intermediate) · 同一作者讲 fixture,难度比今天高一档,看到 scope 部分就可以停,剩下的以后再回来看。</figcaption>
</figure>

### 书籍

- Brian Okken,《Python Testing with pytest》第 2 版,Pragmatic Bookshelf,2022。第 3、4 章讲 fixture(含内置 fixture 如 `tmp_path`),第 5 章讲参数化,和今天的内容一一对应。

### 开源项目与代码

- [pytest-dev/pytest](https://github.com/pytest-dev/pytest):在仓库里搜 `conftest.py`,能看到大型项目怎么分层放 fixture。
- [encode/httpx 的 tests 目录](https://github.com/encode/httpx/tree/master/tests):打开里面的 `conftest.py`,看一个真实的网络库都准备了哪些共享 fixture(比如起一个本地测试服务器),再搜 `parametrize` 看它怎么一次测多种请求。

## 自测

1. fixture 和 Jest 的 `beforeEach` 有什么相同点、什么不同点?

<details><summary>答案</summary>

相同点:默认都是每个测试前执行一次,让每个测试拿到干净的准备数据。不同点:`beforeEach` 是对一组测试统一执行,把值放进外层变量;fixture 是测试在参数里写上名字才执行,按需注入,不要的测试不会触发它;而且一个 fixture 可以再依赖别的 fixture。

</details>

2. 下面这个 fixture,`print("清理")` 在什么时候执行?测试失败时还执行吗?

```python
@pytest.fixture
def res():
    print("准备")
    yield 42
    print("清理")
```

<details><summary>答案</summary>

在用到它的测试运行结束之后执行;测试失败时也照样执行,和 `finally` 一样。

</details>

3. 为什么定义在 `tests/test_a.py` 里的 fixture,`tests/test_b.py` 用不了?怎么办?

<details><summary>答案</summary>

测试文件里定义的 fixture 只对这个文件可见。要共享就把它挪到 `tests/conftest.py`,同目录下所有测试文件都能直接按名字用,不需要 import。

</details>

4. 一个测试函数上叠了两个 parametrize,一个 4 行、一个 5 行,会生成几条用例?

<details><summary>答案</summary>

4 × 5 = 20 条,每一行和另一张表的每一行组合一次。

</details>

5. 面试题:你写的测试单独跑能过,和整个测试集一起跑就失败,你会先怀疑什么?怎么验证?

<details><summary>答案</summary>

先怀疑测试之间共享了可变状态,常见来源是 `scope="module"` 或 `"session"` 的 fixture 返回了列表、字典这类可变对象,或者测试改了全局变量、写了同一个文件。验证办法:用 `-k` 或 node id 单独跑它和它前面的几个测试,找出是哪个测试改了共享状态;把相关 fixture 改回默认的 function 级别,或者在 fixture 里每次返回新的副本,文件类的改用 `tmp_path`。

</details>

## 明天预告

Day 74 · pytest(四):假对象和 monkeypatch。今天测的 `total_cost` 和 `total_from_file` 都不碰网络。可 [Day 70](/blog/agent-zero/day-070-weather-project/) 的天气工具每次都要真的去请求 Open-Meteo,以后的 Agent 还要请求模型 API,测试总不能每跑一次就花一次钱、等一次网络。明天学怎么用假的 HTTP 客户端顶替真的,以及 pytest 自带的 `monkeypatch` fixture(相当于 `jest.mock`),让这类代码也能离线、免费、稳定地测。
