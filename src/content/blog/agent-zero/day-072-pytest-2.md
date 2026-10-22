---
title: 'Day 72 · pytest(二):pythonpath、目录结构和只跑一个测试'
description: '把测试挪进 tests/ 目录,当场撞上 ModuleNotFoundError。弄清 Python 和 pytest 是怎么找模块的,用 pyproject.toml 里的 pythonpath 一行修好;再学 node id、-k、-x、--lf,测试多了只跑想跑的那几个。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'pytest', 'testing', 'agent-zero']
series: 'agent-zero'
day: 72
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 71](/blog/agent-zero/day-071-pytest-1/) 我们认识了 `assert`,装了 pytest,在 `part01/` 里写了 `test_cost.py` 和 `test_cost_more.py`,一共 7 个用例,测的是 `part01/cost.py` 里算调用花费的 `total_cost`。学会了读 `.F.` 和失败报告,知道小数要用 `pytest.approx`,报错要用 `pytest.raises`。昨天测试文件和被测代码挤在同一个目录,文件一多就分不清哪个是代码、哪个是测试。今天按正规项目的习惯把测试搬进 `tests/`,顺便把 pytest 找模块的规矩弄明白。

## 今天要解决的问题

学完今天,你应该能做到:

1. 把测试挪到 `tests/` 后遇到 `ModuleNotFoundError: No module named 'part01'`,能说出原因,并用 `pyproject.toml` 里的 `pythonpath` 修好。
2. 知道 `sys.path` 是什么,会打印它来排查「找不到模块」。
3. 会用 `testpaths` 告诉 pytest 只去哪里找测试。
4. 会只跑一部分测试:指定文件、node id、`-k` 关键字、`-x` 遇错即停、`--lf` 只重跑上次失败的。

预计用时:2 小时。

前置:[Day 7](/blog/agent-zero/day-007-terminal-4/) 的 PATH(命令是怎么被找到的)、[Day 32](/blog/agent-zero/day-032-modules/) 的 import、[Day 33](/blog/agent-zero/day-033-packages/) 的包和 `__init__.py`、[Day 71](/blog/agent-zero/day-071-pytest-1/) 的全部内容。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `pyproject.toml` 里那三行 pytest 配置和五条常用命令默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么要有一个 tests/ 目录

前端项目里你见过两种放测试的方式:`sum.test.ts` 紧挨着 `sum.ts`,或者统一放进 `__tests__/`、`tests/` 目录。Python 社区主流是第二种,仓库根目录一个 `tests/`,里面的文件结构大致对着被测代码。我们的练习仓库也从今天起这样约定:

```text
agent-zero-lab/
├── pyproject.toml
├── uv.lock
├── src/agent_zero_lab/   # uv init 生成的,课程里暂时不用
├── part01/               # 被测代码
│   ├── __init__.py
│   ├── cost.py
│   └── assert_demo.py
└── tests/                # 所有测试都放这里
    ├── test_cost.py
    └── test_cost_more.py
```

<div class="line-notes">

- `src/agent_zero_lab/` 2026 年 10 月的 uv 0.13 执行 `uv init` 时默认生成这个目录,把项目当成一个可安装的包。我们的练习代码放在 `part01/` 这些目录里,不放进 `src/`,所以它和今天的问题无关,先别管。
- `part01/` 被测代码。`__init__.py` 让它成为一个包,可以 `from part01.cost import ...`。
- `tests/` 测试目录。注意它里面**没有** `__init__.py`,这一点等会儿很关键。

</div>

好处很实在:代码和测试一眼分开;以后要只跑测试,告诉 pytest 去 `tests/` 找就行,不用扫描整个仓库;面试官看仓库时也是先找这个目录。

## 第 1 步:搬家,然后撞上报错

在仓库根目录执行:

```bash
cd ~/agent-zero-lab
mkdir tests
mv part01/test_cost.py part01/test_cost_more.py tests/
```

<div class="line-notes">

- `cd ~/agent-zero-lab` 换成你自己的仓库路径。今天所有命令都在这里跑。
- `mkdir tests` 建测试目录,[Day 4](/blog/agent-zero/day-004-terminal-2/) 学过。
- `mv part01/test_cost.py part01/test_cost_more.py tests/` 一次移动两个文件到 `tests/`。移完顺手把两个文件第一行的路径注释改成 `# agent-zero-lab/tests/test_cost.py` 和 `# agent-zero-lab/tests/test_cost_more.py`。文件内容不用改,`from part01.cost import total_cost` 保持原样。

</div>

然后不带任何参数,直接跑:

```bash
uv run pytest
```

实跑输出(路径换成了 `/Users/你/`,下同):

```text
============================= test session starts ==============================
platform darwin -- Python 3.12.13, pytest-9.1.1, pluggy-1.7.0
rootdir: /Users/你/agent-zero-lab
configfile: pyproject.toml
collected 0 items / 2 errors

==================================== ERRORS ====================================
_____________________ ERROR collecting tests/test_cost.py ______________________
ImportError while importing test module '/Users/你/agent-zero-lab/tests/test_cost.py'.
Hint: make sure your test modules/packages have valid Python names.
Traceback:
~/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python3.12/importlib/__init__.py:90: in import_module
    return _bootstrap._gcd_import(name[level:], package, level)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
tests/test_cost.py:2: in <module>
    from part01.cost import total_cost
E   ModuleNotFoundError: No module named 'part01'
___________________ ERROR collecting tests/test_cost_more.py ___________________
...(和上面一样,省略)
E   ModuleNotFoundError: No module named 'part01'
=========================== short test summary info ============================
ERROR tests/test_cost.py
ERROR tests/test_cost_more.py
!!!!!!!!!!!!!!!!!!! Interrupted: 2 errors during collection !!!!!!!!!!!!!!!!!!!!
============================== 2 errors in 0.23s ===============================
```

几个要读出来的信息:`collected 0 items / 2 errors`,一个测试都没收集到,两个文件在**收集阶段**就出错了,这和昨天的 `F`(测试跑了但断言失败)是两回事,所以这里叫 `ERROR` 不叫 `FAILED`。中间那句 `Hint: make sure your test modules/packages have valid Python names` 是 pytest 的通用提示,和我们的问题没关系,别被它带偏。真正的原因在 `E` 那一行:`No module named 'part01'`。

奇怪的地方在于:代码一个字没改,`part01/` 目录明明就在仓库根目录下,文件挪了个位置就找不到了。要弄明白这件事,得先知道 Python 是怎么找模块的。

## 第 2 步:Python 去哪找模块,sys.path

你写 `import part01` 时,Python 会按顺序翻一个目录清单,在每个目录下找有没有叫 `part01` 的包或 `part01.py` 文件,找到第一个就停。这个清单叫 **`sys.path`**,是一个字符串列表。

拿前端来类比:Node 遇到 `import x from 'lodash'`,会从当前文件所在目录开始一层层往上找 `node_modules/lodash`。Python 不按「当前文件位置」往上找,它只看 `sys.path` 这张固定的清单。和 [Day 7](/blog/agent-zero/day-007-terminal-4/) 讲的 PATH 很像:终端按 PATH 里的目录顺序找命令,Python 按 `sys.path` 里的目录顺序找模块。

清单里有什么,取决于你怎么启动 Python。先看我们平时用的 `uv run python -c`:

```bash
uv run python -c "import sys; print(sys.path[:2])"
```

<div class="line-notes">

- `uv run python -c "import sys; print(sys.path[:2])"` 打印 `sys.path` 的前两项。`[:2]` 是 [Day 15](/blog/agent-zero/day-015-strings-1/) 学的切片,列表也能这么切。

</div>

实跑输出:

```text
['', '~/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python312.zip']
```

第一项是空字符串 `''`,意思是「当前目录」。我们在仓库根目录跑,当前目录就是 `agent-zero-lab/`,下面有 `part01/`,所以 `from part01.cost import ...` 能找到。昨天的 `uv run python -m part01.assert_demo` 也是靠这个。

那 pytest 跑测试时,清单里是什么?写一个专门打印它的测试:

```python
# agent-zero-lab/tests/test_where.py
import sys


def test_show_path():
    for p in sys.path[:4]:
        print(p)
```

<div class="line-notes">

- `import sys` 标准库模块,`sys.path` 就在它里面。
- `def test_show_path():` 这个「测试」没有断言,纯粹借 pytest 的环境打印东西,看完就删。
- `for p in sys.path[:4]:` 只看前 4 项,后面是标准库和第三方库的目录,今天不关心。
- `print(p)` pytest 默认会把测试里的 `print` 输出吞掉(只在失败时显示),所以运行时要加 `-s` 才能看到。

</div>

```bash
uv run pytest tests/test_where.py -s -q
```

<div class="line-notes">

- `uv run pytest tests/test_where.py -s -q` `-s` 关掉输出捕获,让 `print` 直接显示在终端里,调试时很常用;`-q` 是安静模式,少打印几行头信息。

</div>

实跑输出:

```text
/Users/你/agent-zero-lab/tests
/Users/你/agent-zero-lab/.venv/bin
~/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python312.zip
~/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python3.12
.
1 passed in 0.02s
```

真相在这里:**清单里没有仓库根目录**。第一项是 `tests/`,第二项是 `.venv/bin`。

`.venv/bin` 是怎么来的?`uv run pytest` 运行的 `pytest` 其实是 `.venv/bin/pytest` 这个小脚本文件。Python 运行一个脚本文件时,会把**脚本所在的目录**放进 `sys.path`,而不是你敲命令时的当前目录。所以根目录没进来,`.venv/bin` 进来了。

`tests/` 又是怎么来的?这是 pytest 自己加的。它导入每个测试文件之前,会从测试文件所在目录开始**往上找,找到第一个不含 `__init__.py` 的目录**,把它插到 `sys.path` 最前面(pytest 文档里把这叫 rootdir 之外的 basedir,导入模式叫 `prepend`)。`tests/` 里没有 `__init__.py`,所以第一步就停在 `tests/` 自己,把它插了进去。

这也解释了昨天为什么没问题。昨天测试文件在 `part01/test_cost.py`,`part01/` 里有 `__init__.py`,pytest 继续往上一层,到了 `agent-zero-lab/`,这里没有 `__init__.py`,于是插入的是仓库根目录,`part01` 自然找得到。昨天能跑通靠的是这条规则,只是你没察觉。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="pytest 插入 sys.path 的规则:昨天和今天的对比">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">昨天:part01/test_cost.py</text>
<text x="340" y="28" fill="var(--ink)">今天:tests/test_cost.py</text>
<rect x="20" y="44" width="280" height="30" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="32" y="64" fill="var(--ink)">agent-zero-lab/  (无 __init__)</text>
<rect x="40" y="86" width="260" height="30" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="52" y="106" fill="var(--ink)">part01/  (有 __init__.py)</text>
<rect x="60" y="128" width="240" height="30" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="72" y="148" fill="var(--ink)">test_cost.py  从这里往上找</text>
<line x1="30" y1="143" x2="30" y2="80" stroke="var(--mem)" stroke-width="2"/>
<text x="20" y="182" fill="var(--ink-soft)">第一个无 __init__ 的目录 = 根目录</text>
<rect x="20" y="196" width="280" height="44" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="32" y="215" fill="var(--ink)">sys.path[0] = agent-zero-lab/</text>
<text x="32" y="232" fill="var(--ink)">import part01 → 找到</text>
<rect x="340" y="44" width="280" height="30" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="352" y="64" fill="var(--ink)">agent-zero-lab/  (无 __init__)</text>
<rect x="360" y="86" width="260" height="30" fill="var(--paper-raised)" stroke="var(--rule)" rx="4"/>
<text x="372" y="106" fill="var(--ink)">tests/  (无 __init__)</text>
<rect x="380" y="128" width="240" height="30" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="392" y="148" fill="var(--ink)">test_cost.py  从这里往上找</text>
<line x1="350" y1="143" x2="350" y2="110" stroke="var(--mem)" stroke-width="2"/>
<text x="340" y="182" fill="var(--ink-soft)">第一个无 __init__ 的目录 = tests/</text>
<rect x="340" y="196" width="280" height="44" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="352" y="215" fill="var(--ink)">sys.path[0] = tests/</text>
<text x="352" y="232" fill="var(--ink)">import part01 → 找不到</text>
<text x="20" y="276" fill="var(--ink-soft)">修法:pyproject.toml 里 pythonpath = ["."],把根目录明确加进 sys.path</text>
</g>
</svg>
<figcaption>pytest 导入测试文件前,从文件所在目录往上找第一个没有 __init__.py 的目录,把它插进 sys.path。昨天插的是根目录,今天插的是 tests/,part01 就找不到了。</figcaption>
</figure>

## 第 3 步:一个更隐蔽的坑,能不能过要看顺序

搬家时如果只复制、没删干净,会出现一个让人摸不着头脑的现象。为了演示,我临时把 `tests/test_cost.py` 再复制一份回 `part01/`,然后用两种顺序跑:

```bash
cp tests/test_cost.py part01/test_cost.py
uv run pytest part01 tests -q
uv run pytest tests part01 -q
rm part01/test_cost.py
```

<div class="line-notes">

- `cp tests/test_cost.py part01/test_cost.py` 模拟「搬家没搬干净」,`part01/` 里还留着一份测试。
- `uv run pytest part01 tests -q` 先给 `part01`,再给 `tests`,pytest 按这个顺序收集。
- `uv run pytest tests part01 -q` 顺序反过来。
- `rm part01/test_cost.py` 演示完删掉。

</div>

实跑输出:

```text
...........                                                              [100%]
11 passed in 0.04s
```

```text
ERROR tests/test_cost_more.py
!!!!!!!!!!!!!!!!!!! Interrupted: 2 errors during collection !!!!!!!!!!!!!!!!!!!!
2 errors in 0.22s
```

同样的文件,先收集 `part01` 时全过,先收集 `tests` 时全挂。原因是:先收集 `part01/test_cost.py` 时,pytest 把根目录插进了 `sys.path`(第 2 步那条规则),之后再导入 `tests/` 里的文件,根目录已经在清单里了,`part01` 也就顺带能找到。顺序一反,`tests/` 先被导入,那时根目录还不在清单里,直接报错。

这种「换个顺序、换台机器、换个启动方式就挂」的测试最折磨人。我们要的是不靠运气、怎么跑都一样的配置。

## 第 4 步:一个看起来能用的办法,python -m pytest

网上搜这个报错,常见回答之一是「改用 `python -m pytest`」。试试:

```bash
uv run python -m pytest -q
uv run python -m pytest tests/test_where.py -s -q
```

<div class="line-notes">

- `uv run python -m pytest -q` `-m pytest` 是把 pytest 当成模块来运行,[Day 33](/blog/agent-zero/day-033-packages/) 学 `-m` 时说过,这种方式会把**当前目录**放进 `sys.path`。
- `uv run python -m pytest tests/test_where.py -s -q` 再看一次清单。

</div>

实跑输出:

```text
........                                                                 [100%]
8 passed in 0.04s
```

```text
/Users/你/agent-zero-lab/tests
/Users/你/agent-zero-lab
~/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python312.zip
~/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python3.12
.
1 passed in 0.01s
```

真的过了(8 个是因为 `test_where.py` 也算一个)。清单第二项变成了仓库根目录。

我不推荐靠它。它能不能过,取决于「谁启动 pytest、用什么命令、在哪个目录」。你自己记得敲 `python -m pytest`,编辑器里的测试按钮、CI 脚本、同事的习惯可不一定。配置应该写进项目文件里,对所有启动方式都生效。

另一个网上常见的办法是在 `tests/` 里放一个空的 `__init__.py`。我试过,也能过:按第 2 步的规则,pytest 会越过 `tests/` 往上找到根目录。但这样 `tests` 本身变成了一个包,测试文件的模块名会变成 `tests.test_cost`,以后又会牵出别的规则。对初学者来说,下面这种显式写配置的办法最好理解。

## 第 5 步:正确修法,pyproject.toml 里的 pythonpath

打开仓库根目录的 `pyproject.toml`,在末尾加三行:

```toml
[tool.pytest]
pythonpath = ["."]
testpaths = ["tests"]
```

<div class="line-notes">

- `[tool.pytest]` `pyproject.toml` 里 `[tool.xxx]` 这类表是留给各个工具放配置的,pytest 读 `[tool.pytest]`。这是 pytest 9.0(2025 年 11 月)开始支持的新写法,值直接用 TOML 的原生类型(列表就写列表)。
- `pythonpath = ["."]` 让 pytest 启动时把这些目录加进 `sys.path`。`"."` 是相对于 rootdir 的路径,也就是仓库根目录。这一行就是今天要修的那个问题的答案。
- `testpaths = ["tests"]` 不带参数运行 `uv run pytest` 时,只去 `tests/` 里找测试,不再扫描整个仓库。仓库大了以后能省时间,也能避免把 `part01/` 里某个碰巧叫 `test_` 的演示脚本当成测试。

</div>

再跑一次:

```bash
uv run pytest
```

实跑输出:

```text
   Building agent-zero-lab @ file:///Users/你/agent-zero-lab
      Built agent-zero-lab @ file:///Users/你/agent-zero-lab
Uninstalled 1 package in 1ms
Installed 1 package in 5ms
============================= test session starts ==============================
platform darwin -- Python 3.12.13, pytest-9.1.1, pluggy-1.7.0
rootdir: /Users/你/agent-zero-lab
configfile: pyproject.toml
testpaths: tests
collected 8 items

tests/test_cost.py ....                                                  [ 57%]
tests/test_cost_more.py ...                                              [ 87%]
tests/test_where.py .                                                    [100%]

============================== 8 passed in 0.06s ===============================
```

全绿了。开头那四行 `Building ... Installed 1 package` 不是报错:我们的项目是 uv 当作「包」初始化的,`pyproject.toml` 一改,`uv run` 就会把项目自己重新装一遍,只在改完配置后的第一次出现。头信息里多了一行 `testpaths: tests`,说明配置生效了。

用 `test_where.py` 验证一下清单:

```bash
uv run pytest tests/test_where.py -s -q
```

实跑输出:

```text
/Users/你/agent-zero-lab/tests
/Users/你/agent-zero-lab
/Users/你/agent-zero-lab/.venv/bin
~/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none/lib/python312.zip
.
1 passed in 0.01s
```

第二项就是 `pythonpath` 加进来的仓库根目录。现在不管用 `uv run pytest` 还是 `uv run python -m pytest`,不管先收集哪个目录,结果都一样了。看完删掉这个演示文件:`rm tests/test_where.py`。删完再跑 `uv run pytest -q`,应该是 `7 passed`。

### 你会在老教程里看到的另一种写法

搜 pytest 配置,很多教程(包括 2025 年以前的大部分文章)写的是:

```toml
[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

<div class="line-notes">

- `[tool.pytest.ini_options]` 老写法,pytest 6.0 起就支持,pytest 9 仍然认。名字里的 `ini_options` 是因为它沿用了 `pytest.ini` 文件的规则:值本质上按字符串处理。
- `pythonpath = ["."]` 两种写法里这一行长得一样。

</div>

两种都能用,但**不能同时写**。我故意两个表都写上,pytest 9.1.1 直接拒绝启动:

```text
ERROR: /Users/你/agent-zero-lab/pyproject.toml: Cannot use both [tool.pytest] (native TOML types) and [tool.pytest.ini_options] (string-based INI format) simultaneously. Please use [tool.pytest] with native TOML types (recommended) or [tool.pytest.ini_options] for backwards compatibility.
```

新项目用 `[tool.pytest]`;接手的老项目里已经是 `ini_options` 的,就别动它,往里面加就行。

### 配置写错了会怎样

配置写错时 pytest 的反应不一样,有的报错有的只警告。我试了两种常见手误。

把 `pythonpath` 拼成 `pythonpaths`(多了个 s),pytest 不认识这个选项,只给一个警告,然后照常运行,结果 `ModuleNotFoundError` 又回来了:

```text
PytestConfigWarning: Unknown config option: pythonpaths
```

这个警告混在一大堆报错的最下面,很容易看漏。遇到「明明配了还是找不到模块」,先往输出末尾翻,看有没有 `Unknown config option`。

把 `testpaths = ["tests"]` 写成 `testpaths = "tests"`(少了方括号),在新写法 `[tool.pytest]` 下直接报类型错误,一个测试也不跑:

```text
TypeError: /Users/你/agent-zero-lab/pyproject.toml: config option 'testpaths' expects a list for type 'args', got str: 'tests'
```

这正是新写法的好处之一:类型不对当场就说。

## 第 6 步:测试多了,只跑想跑的那几个

现在 7 个用例跑一遍不到 0.1 秒,看不出差别。等到后面课程里测试几百个、有的要起数据库,改一个函数就全跑一遍很浪费。pytest 提供了好几种「挑着跑」的办法,我按平时用得多少排个序。

### 先看看有哪些:--co

```bash
uv run pytest --co -q
```

<div class="line-notes">

- `--co` 是 `--collect-only` 的缩写:只收集,不运行。用来确认 pytest 到底看到了哪些用例,也能顺便拿到每个用例的 node id。

</div>

实跑输出:

```text
tests/test_cost.py::test_input_only
tests/test_cost.py::test_output_only
tests/test_cost.py::test_real_call
tests/test_cost.py::test_zero_tokens
tests/test_cost_more.py::test_three_calls_sum
tests/test_cost_more.py::test_negative_tokens_raise
tests/test_cost_more.py::test_negative_message

7 tests collected in 0.01s
```

### 只跑一个文件

```bash
uv run pytest tests/test_cost_more.py -q
```

实跑输出:

```text
...                                                                      [100%]
3 passed in 0.01s
```

### 只跑一个用例:node id

把 `--co` 打出来的任意一行原样贴在 `pytest` 后面:

```bash
uv run pytest tests/test_cost.py::test_real_call -v
```

<div class="line-notes">

- `tests/test_cost.py::test_real_call` [Day 71](/blog/agent-zero/day-071-pytest-1/) 见过的 node id,`::` 前面是文件路径,后面是函数名。

</div>

实跑输出的关键几行:

```text
collecting ... collected 1 item

tests/test_cost.py::test_real_call PASSED                                [100%]

============================== 1 passed in 0.01s ===============================
```

这是我改 bug 时用得最多的方式:先把复现 bug 的那一个用例反复跑到绿,再跑全部。

### 按名字里的关键词挑:-k

```bash
uv run pytest -k negative -q
uv run pytest -k "negative and not message" -v
uv run pytest -k "Real or ZERO" -q
```

<div class="line-notes">

- `uv run pytest -k negative -q` 名字里含 `negative` 的用例才跑。
- `uv run pytest -k "negative and not message" -v` `-k` 后面可以写表达式,支持 `and`、`or`、`not` 和括号。有空格就要用引号括起来,不然终端会把它拆成好几个参数。
- `uv run pytest -k "Real or ZERO" -q` 匹配不区分大小写,`Real` 能匹配到 `test_real_call`,`ZERO` 能匹配到 `test_zero_tokens`。

</div>

三条的实跑输出依次是:

```text
..                                                                       [100%]
2 passed, 5 deselected in 0.01s
```

```text
collecting ... collected 7 items / 6 deselected / 1 selected

tests/test_cost_more.py::test_negative_tokens_raise PASSED               [100%]

======================= 1 passed, 6 deselected in 0.02s ========================
```

```text
..                                                                       [100%]
2 passed, 5 deselected in 0.01s
```

`deselected` 是「收集到了但被 `-k` 筛掉、没跑」的数量。

`-k` 有个容易误会的地方:它不只匹配函数名,文件名(模块名)也参与匹配。我跑 `uv run pytest -k cost -q`,本以为只会挑出名字带 cost 的几个,结果 `7 passed`,因为两个文件名 `test_cost.py`、`test_cost_more.py` 都含 cost,里面的用例全被选中了。反过来,这也能用:`-k cost_more` 实跑是 `3 passed, 4 deselected`,正好是那个文件里的 3 个。

### 遇到第一个失败就停:-x

先故意弄坏两个用例:把 `tests/test_cost.py` 里 `test_input_only` 的期望值改成 `2.5`,`test_output_only` 的改成 `3.0`。正常跑是 `2 failed, 5 passed`。加 `-x`:

```bash
uv run pytest -x -q
```

<div class="line-notes">

- `-x` 是 `--exitfirst` 的缩写:遇到第一个失败或错误立刻停下,后面的不跑了。

</div>

实跑输出的末尾:

```text
=========================== short test summary info ============================
FAILED tests/test_cost.py::test_input_only - assert 2.0 == 2.5
!!!!!!!!!!!!!!!!!!!!!!!!!! stopping after 1 failures !!!!!!!!!!!!!!!!!!!!!!!!!!!
1 failed in 0.05s
```

一大堆测试一起挂的时候(比如你改了一个所有人都依赖的函数),先 `-x` 盯住第一个修,比看满屏红字强。

### 只重跑上次失败的:--lf

```bash
uv run pytest --lf
```

<div class="line-notes">

- `--lf` 是 `--last-failed` 的缩写:只跑上一次失败的用例。pytest 每次运行都会把失败的 node id 记在仓库根目录的 `.pytest_cache/` 里,`--lf` 就是读这个记录。

</div>

紧接着上面坏掉两个用例的状态,实跑输出的头几行:

```text
testpaths: tests
collected 2 items
run-last-failure: rerun previous 2 failures (skipped 1 file)

tests/test_cost.py FF                                                    [100%]
```

只跑了那 2 个,另一个全是绿的文件直接跳过(`skipped 1 file`)。这时打开 `.pytest_cache/v/cache/lastfailed` 能看到记录本身:

```text
{
  "tests/test_cost.py::test_input_only": true,
  "tests/test_cost.py::test_output_only": true
}
```

把 `test_input_only` 改回 `2.0` 再 `--lf`,实跑 `1 failed, 1 passed`;再把 `test_output_only` 改回 `4.0`,`--lf` 只跑剩下那 1 个,变绿。这时候记录清空,再跑 `--lf` 会看到 `run-last-failure: no previously failed tests, not deselecting items.`,意思是「没有上次失败的了,全部跑」。

`.pytest_cache/` 要不要提交进 git?不用。pytest 建这个目录时会在里面自动放一个 `.gitignore`,内容就是 `*`,git 会自动忽略它。

### 一张速查表

| 想做的事 | 命令 | 前端里的近似 |
| --- | --- | --- |
| 跑全部 | `uv run pytest` | `npx vitest run` |
| 看有哪些用例 | `uv run pytest --co -q` | `vitest list` |
| 只跑一个文件 | `uv run pytest tests/test_cost.py` | `npx vitest run sum.test.ts` |
| 只跑一个用例 | `uv run pytest tests/test_cost.py::test_real_call` | `test.only` 或 `-t` |
| 按关键词 | `uv run pytest -k "negative and not message"` | `npx vitest -t "negative"` |
| 遇错即停 | `uv run pytest -x` | `--bail 1` |
| 只重跑失败的 | `uv run pytest --lf` | Jest 的 `--onlyFailures` |
| 显示 print | `uv run pytest -s` | 默认就显示 |

## 今天结束时的仓库

| 文件 | 变化 |
| --- | --- |
| `pyproject.toml` | 末尾多了 `[tool.pytest]` 三行 |
| `tests/test_cost.py` | 从 `part01/` 搬来,4 个用例,首行注释改了路径 |
| `tests/test_cost_more.py` | 从 `part01/` 搬来,3 个用例 |
| `part01/cost.py` | 没变 |

`uv run pytest -q` 结果是 `7 passed`。从今天起,课程里所有测试都放 `tests/`,都从仓库根目录用 `uv run pytest` 跑。

## 动手练习

**练习 1:node id 和 -k 各用一次。** 只跑 `test_cost_more.py` 里的 `test_three_calls_sum`,用 node id 写一次,用 `-k` 写一次,对比两者输出里 `deselected` 的区别。

<details><summary>参考答案</summary>

```bash
uv run pytest tests/test_cost_more.py::test_three_calls_sum -q
uv run pytest -k three_calls -q
```

<div class="line-notes">

- `uv run pytest tests/test_cost_more.py::test_three_calls_sum -q` 用 node id 精确点名。pytest 只收集这一个,不会去碰别的文件。
- `uv run pytest -k three_calls -q` 用关键词。pytest 先把 `testpaths` 里的 7 个都收集了,再筛掉不匹配的。

</div>

实跑输出依次是:

```text
.                                                                        [100%]
1 passed in 0.01s
```

```text
.                                                                        [100%]
1 passed, 6 deselected in 0.01s
```

区别就在 `6 deselected`:`-k` 是「全收集再筛」,node id 是「只收集这一个」。测试多、收集慢的时候,node id 更快。

</details>

**练习 2(观察题):把 pythonpath 注释掉,两种启动方式各跑一次。** 在 `pyproject.toml` 里给 `pythonpath = ["."]` 那行前面加 `#` 注释掉,分别运行 `uv run pytest -q` 和 `uv run python -m pytest -q`,记下结果,解释为什么不一样。做完把注释去掉。

<details><summary>参考答案</summary>

注释掉以后 `[tool.pytest]` 里只剩 `testpaths = ["tests"]`。

```bash
uv run pytest -q
uv run python -m pytest -q
```

<div class="line-notes">

- `uv run pytest -q` 运行 `.venv/bin/pytest` 脚本,`sys.path` 里是脚本所在的 `.venv/bin`,加上 pytest 按规则插入的 `tests/`,没有根目录。
- `uv run python -m pytest -q` 以模块方式运行,Python 会把当前目录(根目录)加进 `sys.path`。

</div>

实跑现象:第一条两个文件都是 `ModuleNotFoundError: No module named 'part01'`,结尾 `2 errors`;第二条 `7 passed`。解释就是上面 line-notes 里那两句:能不能找到 `part01`,完全取决于根目录在不在 `sys.path` 里,而不配置的时候,这又取决于你怎么启动。配置 `pythonpath` 后两种方式结果一致。

</details>

**练习 3:用 -x 和 --lf 走一遍修 bug 的流程。** 把 `part01/cost.py` 里的 `/ 1_000_000` 故意改成 `/ 1_000`(单位搞错,这种 bug 真实存在)。然后按这个顺序操作:①`uv run pytest -q` 看有几个失败;②`uv run pytest -x -q` 看第一个失败是谁;③把 `cost.py` 改回来;④`uv run pytest --lf -q` 只重跑刚才失败的;⑤`uv run pytest -q` 全部跑一遍。写下每一步的最后一行输出。

<details><summary>参考答案</summary>

改坏后的那一行:

```python
# agent-zero-lab/part01/cost.py(故意改坏的那一行)
    return (prompt_tokens * price_in + completion_tokens * price_out) / 1_000
```

<div class="line-notes">

- `/ 1_000` 本该除以一百万,写成了一千,所有非零结果都大了 1000 倍。`total_cost(1_000_000, 0, 2.0, 8.0)` 会变成 `2000.0`。

</div>

我实跑的五步结果:

```text
① 4 failed, 3 passed in 0.11s
② FAILED tests/test_cost.py::test_input_only - assert 2000.0 == 2.0
   1 failed in 0.24s
④ 4 passed in 0.07s
⑤ 7 passed in 0.03s
```

① 的失败清单是这样的:

```text
FAILED tests/test_cost.py::test_input_only - assert 2000.0 == 2.0
FAILED tests/test_cost.py::test_output_only - assert 4000.0 == 4.0
FAILED tests/test_cost.py::test_real_call - assert 0.248 == 0.000248
FAILED tests/test_cost_more.py::test_three_calls_sum - assert 17.848 == 0.017...
```

动手前我先猜了一下哪些会挂,写出来再对答案,这个习惯很有用。挂的 4 个都和除法有关,结果全大了 1000 倍。没挂的 3 个各有原因:`test_zero_tokens` 算的是 0,0 除以什么都是 0;两个负数用例在 `if` 那一行就抛了异常,根本走不到除法。② 的 `-x` 只跑到第一个失败就停了。④ 有个细节:② 那次只跑了 1 个,但 `--lf` 记得的仍然是 ① 里失败的 4 个(没跑到的用例,pytest 会保留它上次的失败记录),所以修好后 `--lf` 跑的是 4 个,全过。

</details>

**练习 4:故意拼错配置,找出警告。** 把 `pythonpath` 改成 `pythonpath_dirs`,跑 `uv run pytest -q`,在输出里找到说明原因的那一行。改回来。

<details><summary>参考答案</summary>

```toml
[tool.pytest]
pythonpath_dirs = ["."]
testpaths = ["tests"]
```

<div class="line-notes">

- `pythonpath_dirs = ["."]` pytest 不认识这个选项名,不会报错退出,只会警告,然后当它不存在。

</div>

实跑现象:两个文件又是 `ModuleNotFoundError`,在输出末尾的 `warnings summary` 里有一行 `PytestConfigWarning: Unknown config option: pythonpath_dirs`。这就是线索。改回 `pythonpath` 后恢复 `7 passed`。

</details>

**验收标准:** `tests/` 目录下两个测试文件,`uv run pytest -q` 和 `uv run python -m pytest -q` 都是 `7 passed`;你能不看文章写出 `[tool.pytest]` 那三行;能用 node id、`-k`、`-x`、`--lf` 各跑一次并说出它们的区别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `sys.path` | Python 找模块时按顺序翻的目录清单,是个字符串列表 |
| 模块搜索路径 | 同上,`sys.path` 的中文叫法 |
| `ModuleNotFoundError` | `import` 时在 `sys.path` 的所有目录里都找不到这个模块 |
| `ImportError` | 导入失败的总类,`ModuleNotFoundError` 是它的一种 |
| rootdir | pytest 认定的项目根目录,通常是 `pyproject.toml` 所在目录 |
| 收集错误(collection error) | 测试文件在导入阶段就出错,测试根本没跑,显示为 `ERROR` |
| `pythonpath`(pytest 配置) | 让 pytest 启动时把指定目录加进 `sys.path` |
| `testpaths` | 不带参数运行 pytest 时去哪些目录找测试 |
| `[tool.pytest]` | pytest 9.0 起在 `pyproject.toml` 里的原生配置表 |
| `[tool.pytest.ini_options]` | pytest 6.0 起的老配置表,值按字符串规则处理 |
| node id | 用例编号 `文件::函数名`,可以直接拿来只跑这一个 |
| `-k` | 按名字关键词挑用例,支持 and/or/not,不区分大小写,文件名也参与匹配 |
| deselected | 收集到但被筛掉、没有运行的用例数 |
| `-x` / `--exitfirst` | 遇到第一个失败就停 |
| `--lf` / `--last-failed` | 只重跑上次失败的用例 |
| `.pytest_cache/` | pytest 记录上次失败等信息的缓存目录,自带 `.gitignore` |
| `-s` | 关闭输出捕获,让测试里的 `print` 显示出来 |

## 常见误区

**以为 `ModuleNotFoundError` 是代码写错了。** 代码一个字没改,文件换了个目录就报错,问题在 `sys.path` 而不在代码。排查时先写个测试打印 `sys.path`,看根目录在不在里面。

**用 `python -m pytest` 当修复。** 它能过是因为启动方式恰好把当前目录放进了 `sys.path`。换成编辑器里的测试按钮或者 CI 里直接调 `pytest`,问题就回来了。修复要写进 `pyproject.toml`。

**在 `tests/` 目录里面跑 pytest。** `cd tests` 之后再 `uv run pytest`,rootdir 还是会往上找到 `pyproject.toml`,配置能读到,测试也能过,但 node id 会跟着变。我实测在 `tests/` 里跑 `-v`,显示的是 `test_cost.py::test_input_only`,少了 `tests/` 前缀,和文章、CI 日志里的都对不上,复制来复制去很容易出错。永远在仓库根目录跑。

**`[tool.pytest]` 和 `[tool.pytest.ini_options]` 一起写。** pytest 9 会直接报 `Cannot use both ...` 拒绝启动。照着老教程往新项目里加配置时最容易出这个错,二选一。

**配置名拼错没发现。** `pythonpaths`、`testpath` 这种手误只会得到一个 `Unknown config option` 警告,藏在输出末尾。配置不生效时先翻到底看警告。

**`-k` 选中了意料之外的用例。** 它连文件名也一起匹配,`-k cost` 会把 `test_cost.py` 里的全选上。想精确,用 node id。

**搬家时复制了没删。** 第 3 步演示过,同名测试同时留在两个地方时,能不能过取决于收集顺序。搬完用 `uv run pytest --co -q` 看一眼收集到的列表,确认没有重复。

## 学习资料

### 文档与文章

- [pytest 文档 · pytest import mechanisms and sys.path/PYTHONPATH](https://docs.pytest.org/en/stable/explanation/pythonpath.html):今天第 2 步那条「往上找第一个没有 `__init__.py` 的目录」规则的官方说明,也讲了 `python -m pytest` 为什么会多加当前目录。
- [pytest 文档 · Configuration](https://docs.pytest.org/en/stable/reference/customize.html):`[tool.pytest]` 和 `[tool.pytest.ini_options]` 两种写法的说明和 rootdir 的判定规则。
- [pytest 文档 · How to invoke pytest](https://docs.pytest.org/en/stable/how-to/usage.html):node id、`-k`、`-x` 等选择用例的方式都在这页。
- [pytest 文档 · How to re-run failed tests](https://docs.pytest.org/en/stable/how-to/cache.html):`--lf` 和 `--ff` 以及 `.pytest_cache` 的说明。
- [pytest 文档 · Good Integration Practices](https://docs.pytest.org/en/stable/explanation/goodpractices.html):官方推荐的项目目录布局,读「Choosing a test layout」一节。
- [Python 官方教程(中文)· 模块](https://docs.python.org/zh-cn/3/tutorial/modules.html):「模块搜索路径」一节讲 `sys.path` 的初始值是怎么来的。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cQ4y1E7xM&autoplay=0&high_quality=1" title="Pytest07-pytest.ini配置文件" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>测试老宅男扶摇 · Pytest07-pytest.ini配置文件 · 9 分钟。讲的是 pytest.ini 文件,配置项和今天 pyproject.toml 里的一样,看 testpaths 和命令行参数那段;文件格式以今天的 [tool.pytest] 为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1bY411y7dv&autoplay=0&high_quality=1" title="Python单元测试-08.PyTest框架" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟峰哥学编程 · Python单元测试-08.PyTest框架 · 21 分钟。昨天推荐过,今天重看后半段运行参数部分,和 -k、-x 对照着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/cHYq1MRoyI0" title="Pytest Tutorial – How to Test Python Code" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · Pytest Tutorial – How to Test Python Code · 英文长课,今天只看前面项目目录和运行测试的部分,fixture 和 mock 留到 Day 73、74。</figcaption>
</figure>

### 书籍

- Brian Okken,《Python Testing with pytest》第 2 版,Pragmatic Bookshelf,2022。第 1 章讲运行和选择用例,书末附录讲配置文件。书出版时 pytest 还没有 `[tool.pytest]` 新写法,书里用的是 `ini_options`,两者对照着看。

### 开源项目与代码

- [pydantic 的 tests 目录](https://github.com/pydantic/pydantic/tree/main/tests):[Day 51](/blog/agent-zero/day-051-pydantic-1/) 学过的 pydantic,看它的测试是怎么按功能分文件放在根目录 `tests/` 下的。
- [pytest-dev/pytest](https://github.com/pytest-dev/pytest):打开它自己的 `pyproject.toml`,搜 `[tool.pytest`,看 pytest 项目本身是怎么配 pytest 的。

## 自测

1. 测试在 `part01/test_cost.py` 时能跑,挪到 `tests/test_cost.py` 就报 `No module named 'part01'`,一句话说原因。

<details><summary>答案</summary>

pytest 会把「测试文件往上第一个没有 `__init__.py` 的目录」插进 `sys.path`。在 `part01/` 时插的是仓库根目录,在 `tests/` 时插的是 `tests/` 自己,根目录不在 `sys.path` 里,自然找不到 `part01`。

</details>

2. `uv run pytest` 和 `uv run python -m pytest` 在 `sys.path` 上有什么区别?

<details><summary>答案</summary>

`uv run pytest` 运行的是 `.venv/bin/pytest` 脚本,`sys.path` 里加的是脚本所在目录 `.venv/bin`;`python -m pytest` 会把当前目录加进 `sys.path`。所以不配置时后者能找到根目录下的包,前者找不到。

</details>

3. 写出让 `tests/` 里的测试能 `from part01.cost import ...`、并且默认只在 `tests/` 找测试的 pytest 配置(pytest 9 新写法)。

<details><summary>答案</summary>

```toml
[tool.pytest]
pythonpath = ["."]
testpaths = ["tests"]
```

</details>

4. 输出里 `2 passed, 5 deselected` 的 deselected 指什么?

<details><summary>答案</summary>

收集到了、但被 `-k` 之类的筛选条件排除、没有运行的用例。它们既不算通过也不算失败。

</details>

5. 面试题:你接手一个项目,CI 上测试全过,你本地 `pytest` 却报 `ModuleNotFoundError`,你会怎么排查?

<details><summary>答案</summary>

先看两边启动命令是否一样(CI 可能用的是 `python -m pytest`,或者设置了 `PYTHONPATH` 环境变量);在本地写一个打印 `sys.path` 的测试,对比 CI 日志里的 rootdir 和配置文件;检查 `pyproject.toml` 里 pytest 配置有没有拼错(翻输出末尾的 `Unknown config option`)、有没有两种配置表混用;最后把依赖启动方式的部分改成显式配置 `pythonpath`,让本地和 CI 一致。

</details>

## 明天预告

Day 73 · pytest(三):fixture 和 parametrize。今天的测试文件里,高峰价 `2.0, 8.0` 在每个用例里都抄了一遍,三个负数用例几乎一模一样只是数字不同。明天学 fixture(相当于 `beforeEach`,把准备工作抽出来共享)和 parametrize(一个测试函数配一张数据表,一次生成 6 条用例),把这些重复都去掉。
