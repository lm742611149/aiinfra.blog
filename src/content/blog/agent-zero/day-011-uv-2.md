---
title: 'Day 11 · uv(二):虚拟环境、pyproject.toml 和 uv.lock'
description: '打开昨天一闪而过的 .venv 和 uv.lock:.venv 是 Python 的 node_modules,还多装了一个解释器;activate 背后就是 Day 7 的 PATH;pyproject.toml 写「要什么」,uv.lock 记「装了什么」。最后把 .venv 整个删掉,用 uv sync 原样恢复,再模拟一次同事拿到你的项目。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 11
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 10](/blog/agent-zero/day-010-uv-1/) 装上了 uv,用 `uv init --no-package` 建了这门课的仓库 `~/agent-zero-lab`,`uv add rich` 装了第一个第三方库,`uv add --dev ruff` 装了开发工具,用 `uv run python part01/hello_rich.py` 打印出一张工单表。我们还撞了一个坑:装好的 rich,用 `python3` 直接跑就找不到,加上 `uv run` 才行。

那天有两样东西只露了个面:第一次 `uv run` 时冒出来的 `.venv` 目录,和 `uv.lock` 文件。为什么 `python3` 看不见 rich,答案就在 `.venv` 里;为什么换一台电脑还能装出一模一样的环境,答案在 `uv.lock` 里。今天把这两样打开看清楚。

## 今天要解决的问题

学完今天,你应该能:

1. 说清楚**虚拟环境**是什么:`.venv` 里有哪几样东西,它和 `node_modules` 哪里一样、哪里不一样;用 `source .venv/bin/activate` 激活一次,并用 Day 7 学的 `which` 和 PATH 解释激活到底改了什么。
2. 读懂 `pyproject.toml` 和 `uv.lock` 的每一段,说出哪个是你写的「要什么」、哪个是 uv 算出来的「装了什么」,哪些文件要交给同事(以后提交进 git)、哪些不要。
3. 删掉 `.venv`,用 `uv sync` 恢复;手动改了 `pyproject.toml` 以后,看懂 `uv sync --locked` 的报错并用 `uv lock` 修好。
4. 用 `.python-version` 换 Python 版本,看到 `requires-python` 拦住不合要求的版本。

预计用时:2.5 小时。看 `.venv` 和激活 50 分钟,读两个配置文件 40 分钟,删了重建、模拟同事 30 分钟,剩下做练习。

前置:[Day 7](/blog/agent-zero/day-007-terminal-4/)(PATH、`which`、`source`、符号链接)、[Day 10](/blog/agent-zero/day-010-uv-1/)(`~/agent-zero-lab`、rich、ruff、`uv run`)。今天第 4 个目标会下载 Python 3.11 和 3.13 各二十几 MB;不调任何大模型 API,花费 0 元。

学法提示:先对照文章逐条敲一遍(命令自己敲,不复制粘贴)并跑通;第二天合上文章,画出「pyproject.toml → uv.lock → .venv」那张图,写出每一步用哪条命令;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-22 在演示家目录里真跑的(2019 款 Intel MacBook Pro、macOS 14、zsh、uv 0.13.5),家目录显示成 `/Users/你`。`~/agent-zero-lab` 接着 Day 10 的状态:`dependencies` 里有 rich,`dev` 组里有 ruff,`part01/hello_rich.py` 能跑。

和前两天一样,演示家目录里的 `python3` 是 3.12.13,你那边是 Day 8 装的 3.12.10,出现时我会标出来。

## 打开 .venv 看看

在仓库根目录:

```text
$ cd ~/agent-zero-lab
$ ls -a .venv
.
..
.gitignore
.lock
CACHEDIR.TAG
bin
lib
pyvenv.cfg
```

<div class="line-notes">

- `$ ls -a .venv` `.venv` 以点开头,`ls` 不加 `-a` 看不到它(Day 3)。里面的东西同理。
- `.gitignore` `.venv` 自己带了一个 `.gitignore`,下面看内容。
- `.lock` uv 用来防止两个 uv 命令同时改这个环境的「锁」,和 `uv.lock` 不是一回事,不用管。
- `CACHEDIR.TAG` 一个约定俗成的标记文件,告诉备份软件「这个目录是可以重新生成的缓存,不用备份」。
- `bin` 可执行文件,包括 Python 解释器本身。
- `lib` 装好的库都在这里面。
- `pyvenv.cfg` 这个环境的说明书。

</div>

一样一样看。先看 `bin`:

```text
$ ls .venv/bin
activate
activate.bat
activate.csh
activate.fish
activate.nu
activate.ps1
activate.xsh
activate_this.py
deactivate.bat
markdown-it
pydoc.bat
pygmentize
python
python3
python3.12
ruff
$ ls -l .venv/bin/python*
lrwxr-xr-x  1 minliu  staff  162 10 22 19:13 .venv/bin/python -> /Users/你/.local/share/uv/python/cpython-3.12-macos-x86_64-none/bin/python3.12
lrwxr-xr-x  1 minliu  staff    6 10 22 19:13 .venv/bin/python3 -> python
lrwxr-xr-x  1 minliu  staff    6 10 22 19:13 .venv/bin/python3.12 -> python
```

<div class="line-notes">

- `activate` 一组 `activate` 开头的脚本,下面马上用。`.fish`、`.ps1`、`.bat` 这些是给别的 shell(fish、Windows 的 PowerShell 和 cmd)准备的,zsh 用的是不带后缀的这个。
- `markdown-it` 装库时,库自带的命令行程序也会放进这里:markdown-it-py 带了 `markdown-it`,pygments 带了 `pygmentize`。
- `python` 这个环境的 Python。注意它叫 `python`,不只是 `python3`,虚拟环境里两个名字都有。
- `ruff` Day 10 装的 Ruff。`uv run ruff` 找到的就是它。对照前端:`node_modules/.bin/eslint`,Day 7 讲过。
- `.venv/bin/python -> /Users/你/.local/share/uv/python/cpython-3.12-macos-x86_64-none/bin/python3.12` `python` 是一个符号链接,指向 Day 10 用 `uv python install` 装的那个 3.12.15。所以 `.venv` 里并没有复制一整个 Python,只是放了一个「指路牌」。
- `.venv/bin/python3 -> python` `python3`、`python3.12` 又都链到同一个 `python`。三个名字,一个解释器。

</div>

再看说明书和装好的库:

```text
$ cat .venv/pyvenv.cfg
home = /Users/你/.local/share/uv/python/cpython-3.12-macos-x86_64-none/bin
implementation = CPython
uv = 0.13.5
version_info = 3.12
include-system-site-packages = false
prompt = agent-zero-lab
$ ls .venv/lib/python3.12/site-packages
markdown_it
markdown_it_py-4.2.0.dist-info
mdurl
mdurl-0.1.2.dist-info
pygments
pygments-2.21.0.dist-info
rich
rich-15.0.0.dist-info
ruff
ruff-0.17.1.dist-info
$ du -sh .venv
 31M	.venv
$ cat .venv/.gitignore
*
```

<div class="line-notes">

- `home = /Users/你/.local/share/uv/python/cpython-3.12-macos-x86_64-none/bin` 「我是基于哪个 Python 建的」。Python 启动时会读这个文件,发现自己在一个虚拟环境里,就去这个环境的 `lib` 里找库,而不是去全局的地方找。
- `include-system-site-packages = false` 「不要看全局 Python 装过的库」。这一行保证了隔离:就算你哪天往全局 Python 里装了什么,这个项目也看不见,项目只认自己 `.venv` 里的。
- `prompt = agent-zero-lab` 激活后提示符前面显示的名字,下面会看到。
- `$ ls .venv/lib/python3.12/site-packages` `site-packages` 是 Python 放第三方库的目录名。这个目录就是 Python 版的 `node_modules`。
- `markdown_it` 目录名和包名不一定一样:包名是 `markdown-it-py`,代码里 import 的名字是 `markdown_it`。Python 的 import 名里不能有 `-`。
- `rich` 每个库两样东西:一个是代码目录(`rich/`),
- `rich-15.0.0.dist-info` 一个是「装了哪个版本、有哪些文件」的记录(`.dist-info`),相当于 `node_modules/rich/package.json` 里的那些信息。
- ` 31M	.venv` 整个环境 31 MB,和小前端项目的 `node_modules` 差不多大。
- `*` `.venv` 自带的 `.gitignore` 只有一个 `*`,意思是「这个目录里的所有东西都别交给 git」。外面仓库根目录的 `.gitignore` 里也写了 `.venv`,双保险。

</div>

### 和 node_modules 比

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="node_modules 只装包,node 解释器用全局的;.venv 里既有包(site-packages),也有一个指向某个 Python 的链接,所以项目连解释器版本也是自己的">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="290" height="160" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="34" y="44" fill="var(--ink)">前端项目/</text>
<rect x="40" y="58" width="250" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="52" y="85" fill="var(--ink)">node_modules/ 只有包</text>
<text x="40" y="128" fill="var(--ink-soft)">node 用 PATH 里那个</text>
<text x="40" y="150" fill="var(--ink-soft)">(nvm 当前选的版本)</text>
<rect x="330" y="20" width="290" height="160" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="344" y="44" fill="var(--ink)">agent-zero-lab/.venv/</text>
<rect x="350" y="58" width="250" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="362" y="85" fill="var(--ink)">lib/.../site-packages/ 包</text>
<rect x="350" y="114" width="250" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="362" y="141" fill="var(--ink)">bin/python → 3.12.15</text>
<text x="20" y="212" fill="var(--ink-soft)">区别:.venv 连「用哪个解释器」也一起定死了。</text>
<text x="20" y="234" fill="var(--ink-soft)">换项目就换了解释器,不用像 nvm 那样手动切版本。</text>
</g>
</svg>
<figcaption>.venv 比 node_modules 多一样东西:它自己的 python。</figcaption>
</figure>

一样的地方:都是「每个项目一份,装在项目目录里」,都不交给别人(不提交进 git),都可以删了重装。不一样的地方是图里蓝色那一块。前端项目用的 `node` 是 PATH 里那一个,你 `nvm use 20` 切一下,所有项目都跟着变;Python 的虚拟环境里带着自己的 `python`,它指向哪个版本是建环境时定死的。这就是为什么 Day 10 里 `uv run python --version` 是 3.12.15,`python3 --version` 是另一个版本:两条命令用的根本不是同一个解释器。

**虚拟环境**(virtual environment)这个名字听着玄乎,其实就是这么一个目录:一个指向某个 Python 的链接,加一个专门放库的 `site-packages`,加一张写着「别看全局的库」的说明书。没有任何「虚拟机」的意思。

## 激活:其实就是改 PATH

既然 `.venv/bin/python` 就是项目的 Python,不用 `uv run`,直接写全路径 `.venv/bin/python part01/hello_rich.py` 也能跑。每次写全路径太长,老办法是**激活**(activate)这个环境:

```text
$ which python
python not found
$ which ruff
ruff not found
$ source .venv/bin/activate
$ echo $PATH | tr ":" "\n" | head -3
/Users/你/agent-zero-lab/.venv/bin
/Users/你/.local/bin
/Users/你/bin
$ which python
/Users/你/agent-zero-lab/.venv/bin/python
$ which ruff
/Users/你/agent-zero-lab/.venv/bin/ruff
$ python part01/hello_rich.py | head -1
hello agent,今天有 3 张计费工单
$ echo $VIRTUAL_ENV
/Users/你/agent-zero-lab/.venv
$ deactivate
$ which python
python not found
```

<div class="line-notes">

- `$ which python` macOS 上默认没有叫 `python`(不带 3)的命令,Day 7 说过。
- `$ which ruff` `ruff` 也找不到,它在 `.venv/bin` 里,不在 PATH 上。
- `$ source .venv/bin/activate` `source` 在**当前** shell 里执行一个脚本(Day 7 用它重读过 `.zshrc`)。必须用 `source`,不能 `./.venv/bin/activate` 直接运行,那样改的是一个子进程的 PATH,它一结束改动就没了。
- `/Users/你/agent-zero-lab/.venv/bin` PATH 最前面多了这一项。**激活做的事就是这个**,下面看脚本原文。
- `/Users/你/agent-zero-lab/.venv/bin/python` 现在 `python` 能找到了,就是 `.venv` 里那个。
- `/Users/你/agent-zero-lab/.venv/bin/ruff` `ruff` 也直接能敲了。
- `$ python part01/hello_rich.py | head -1` 不用 `uv run`,直接 `python` 也能跑,因为现在 PATH 里排第一的 `python` 就是项目的。
- `$ echo $VIRTUAL_ENV` 激活脚本还设了一个环境变量,记着当前激活的是哪个环境。有些工具靠它判断。
- `$ deactivate` 退出激活。`deactivate` 是激活脚本顺便定义的一个 shell 函数,把 PATH 改回原样。
- `python not found` 改回去了。

</div>

你在终端里实际敲的时候,激活之后提示符前面会多出 `(agent-zero-lab)`,提醒你现在在哪个环境里;`deactivate` 之后消失。这个名字就是 `pyvenv.cfg` 里的 `prompt`。

激活脚本里真正改 PATH 和提示符的就这几行(原文):

```text
$ sed -n '102,104p;120,122p' .venv/bin/activate
_OLD_VIRTUAL_PATH="$PATH"
PATH="$VIRTUAL_ENV/bin:$PATH"
export PATH
    _OLD_VIRTUAL_PS1="${PS1-}"
    PS1="(${VIRTUAL_ENV_PROMPT}) ${PS1-}"
    export PS1
```

<div class="line-notes">

- `$ sed -n '102,104p;120,122p' .venv/bin/activate` `sed -n '起,止p'` 只打印指定的行,两段用分号隔开。行号是我在这个版本的脚本里数的,不同版本的 uv 可能略有不同。
- `_OLD_VIRTUAL_PATH="$PATH"` 先把原来的 PATH 存起来,`deactivate` 时要用它恢复。和 Day 7 改 `.zshrc` 之前先 `cp` 一份备份是同一个习惯。
- `PATH="$VIRTUAL_ENV/bin:$PATH"` 新目录 + 冒号 + 原来的 PATH。Day 7 的 `export PATH="$HOME/bin:$PATH"`、Day 8 Python 安装包改 `.zprofile`、Day 10 uv 的 `env` 文件,都是这一个拼法。到今天你已经见了四次了。
- `export PATH` 导出,让这个 shell 里之后运行的程序都看到新的 PATH。
- `PS1="(${VIRTUAL_ENV_PROMPT}) ${PS1-}"` `PS1` 是 shell 的提示符。在原来的提示符前面加上 `(agent-zero-lab) `。

</div>

那要不要激活?**这门课不激活,一律 `uv run`**。激活的问题是它只对当前这个终端窗口有效,开了新窗口要重新激活,忘了就用到别的 Python 上去了;同时开着两个项目时更容易乱。`uv run` 每次都从 `pyproject.toml` 出发找环境,不依赖你记得做过什么。你在网上教程里看到 `source .venv/bin/activate`,知道它在干什么就行。

### pip 去哪了

很多老教程会让你在激活之后 `pip install xxx`。在 uv 建的环境里试一下:

```text
$ .venv/bin/python -m pip --version
/Users/你/agent-zero-lab/.venv/bin/python: No module named pip
```

<div class="line-notes">

- `$ .venv/bin/python -m pip --version` `python -m 模块名` 是「把这个模块当程序运行」,`python -m pip` 是运行 pip 最稳妥的写法,能保证用的是这个 Python 的 pip。`-m` 以后课里会经常用([Day 33](/blog/agent-zero/day-033-packages/) 起用它运行包里的模块)。
- `No module named pip` uv 建的虚拟环境里**默认不装 pip**,因为装依赖这件事交给 uv 了。

</div>

这是故意的设计,不是坏了。真需要 pip 的命令格式,uv 提供了一个兼容的 `uv pip`,下面练习里会用一次,看看它和 `uv add` 的区别。

### uv run 到底用了哪个环境

用 Python 自己告诉你:

```text
$ uv run python -c "import sys; print(sys.prefix)"
/Users/你/agent-zero-lab/.venv
$ python3 -c "import sys; print(sys.prefix)"
/Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none
$ uv run python -c "import rich; print(rich.__file__)"
/Users/你/agent-zero-lab/.venv/lib/python3.12/site-packages/rich/__init__.py
```

<div class="line-notes">

- `$ uv run python -c "import sys; print(sys.prefix)"` `-c` 执行一行代码(Day 8)。分号可以在一行里写两句,前面 Day 9 格式化时说过平时别这么写,`-c` 里是例外。`sys.prefix` 是「当前这个 Python 环境的根目录」。
- `/Users/你/agent-zero-lab/.venv` `uv run` 用的是项目的虚拟环境。
- `/Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none` 直接 `python3`,根目录是另一个地方。这是我演示用的 3.12.13;你那边会是 `/Library/Frameworks/Python.framework/Versions/3.12`,Day 8 装的那个。
- `$ uv run python -c "import rich; print(rich.__file__)"` `__file__` 是「这个模块是从哪个文件加载的」。以后怀疑「到底用的是哪个版本的库」,就这样查。
- `/Users/你/agent-zero-lab/.venv/lib/python3.12/site-packages/rich/__init__.py` 就在刚才 `ls` 过的 `site-packages` 里。`__init__.py` 是一个目录作为「包」被 import 时运行的文件,[Day 33](/blog/agent-zero/day-033-packages/) 讲。

</div>

## pyproject.toml:你写的「要什么」

现在的 `pyproject.toml`:

```toml
[project]
name = "agent-zero-lab"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
    "rich>=15.0.0",
]

[dependency-groups]
dev = [
    "ruff>=0.17.1",
]
```

<div class="line-notes">

- `[project]` 这一段的格式是 Python 官方定的标准(PEP 621),所以不只 uv,别的工具也读得懂。相当于 `package.json` 的那些基础字段。
- `description = "Add your description here"` 项目描述,uv 生成的占位文字。想改就改成「AI Agent 课程练习仓库」之类,不影响运行。
- `readme = "README.md"` 说明文件是哪个。
- `requires-python = ">=3.12"` 项目要求的 Python 版本范围。练习 3 会看到它真的会拦人。
- `"rich>=15.0.0",` 一条**版本约束**:包名 + 版本范围。`uv add rich` 时,uv 查到最新是 15.0.0,就替你写了「至少 15.0.0」。
- `[dependency-groups]` 依赖分组,这也是一个 Python 官方标准(PEP 735)。`dev` 组 uv 默认会装,别的组名要你明确要求才装。
- `"ruff>=0.17.1",` 开发工具也一样写约束。

</div>

版本范围的写法和 npm 不一样,是最容易搞混的地方。对照一下:

| 想表达 | npm(`package.json`) | Python(`pyproject.toml`) |
| --- | --- | --- |
| 正好这个版本 | `"15.0.0"` | `"rich==15.0.0"` |
| 至少这个版本,可以升大版本 | `">=15.0.0"` | `"rich>=15.0.0"`(uv 默认写这个) |
| 同一个大版本内随便升 | `"^15.0.0"` | `"rich>=15.0.0,<16"` 或 `"rich~=15.0"` |
| 低于某个版本 | `"<15"` | `"rich<15"` |

注意第二行:npm 默认写的 `^15.0.0` 不会升到 16,uv 默认写的 `>=15.0.0` 是会的。那会不会哪天突然装上一个不兼容的 rich 16?不会,因为真正装哪个版本不看这里,看 `uv.lock`。

## uv.lock:uv 算出来的「装了什么」

`pyproject.toml` 只说了「rich 至少 15.0.0」,可「至少 15.0.0」可能是 15.0.0,也可能是半年后发布的 15.3.2。如果你和同事各自装,装到的版本就可能不一样,出现「我这能跑你那不能跑」。`package-lock.json` 解决的就是这个问题,`uv.lock` 也是。

```text
$ wc -l uv.lock
      90 uv.lock
$ grep -c "^\[\[package\]\]" uv.lock
6
$ head -30 uv.lock
version = 1
revision = 5
requires-python = ">=3.12"

[[package]]
name = "agent-zero-lab"
version = "0.1.0"
source = { virtual = "." }
dependencies = [
    { name = "rich" },
]

[package.dev-dependencies]
dev = [
    { name = "ruff" },
]

[package.metadata]
requires-dist = [{ name = "rich", specifier = ">=15.0.0" }]

[package.metadata.requires-dev]
dev = [{ name = "ruff", specifier = ">=0.17.1" }]

[[package]]
name = "markdown-it-py"
version = "4.2.0"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "mdurl" },
]
```

<div class="line-notes">

- `$ wc -l uv.lock` 90 行。也是 TOML 格式,人能读,但**不要手改**,它是 uv 生成的。
- `6` 一共 6 个包:你的项目本身、rich、它的三个间接依赖、ruff。
- `version = 1` lock 文件格式的版本,给 uv 自己看的。
- `requires-python = ">=3.12"` 从 `pyproject.toml` 抄过来的。uv 算版本时要保证每个包在 3.12 及以上都能用。
- `[[package]]` 双方括号在 TOML 里表示「一个列表里的又一项」,每个 `[[package]]` 是一个包。相当于 JSON 里 `"package": [ {...}, {...} ]` 的一个元素。
- `source = { virtual = "." }` 第一项是你的项目自己,`virtual` 表示它不会被打包安装(因为 Day 10 用了 `--no-package`)。
- `[package.metadata]` 这一段记着 `pyproject.toml` 里写的约束原文。uv 每次运行时拿它和 `pyproject.toml` 比,对不上就知道 lock 过期了。
- `version = "4.2.0"` 从这里开始是真正被锁住的包。markdown-it-py **就是 4.2.0**,不是范围。
- `source = { registry = "https://pypi.org/simple" }` 从哪下载的:PyPI。

</div>

再往下看 rich 那一项:

```text
[[package]]
name = "rich"
version = "15.0.0"
source = { registry = "https://pypi.org/simple" }
dependencies = [
    { name = "markdown-it-py" },
    { name = "pygments" },
]
sdist = { url = "https://files.pythonhosted.org/packages/c0/8f/0722ca900cc807c13a6a0c696dacf35430f72e0ec571c4275d2371fca3e9/rich-15.0.0.tar.gz", hash = "sha256:edd07a4824c6b40189fb7ac9bc4c52536e9780fbbfbddf6f1e2502c31b06...", ... }
wheels = [
    { url = "https://files.pythonhosted.org/packages/82/3b/64d4899d73f91ba49a8c18a8ff3f0ea8f1c1d75481760df8c68ef5235bf5/rich-15.0.0-py3-none-any.whl", hash = "sha256:33bd4ef74232fb73fe9279a257718407f169c09b78a87ad3d296f5...", ... },
]
```

<div class="line-notes">

- `version = "15.0.0"` 锁死的版本。同事拿到这个文件,装的就是 15.0.0,哪怕那时 PyPI 上已经有 15.3。
- `dependencies = [` rich 依赖谁,uv 记下来了。`uv tree` 就是按这个画树的。
- `sdist = { url = "https://files.pythonhosted.org/packages/c0/8f/0722ca900cc807c13a6a0c696dacf35430f72e0ec571c4275d2371fca3e9/rich-15.0.0.tar.gz"` sdist 是「源码包」(source distribution),一个 `.tar.gz`。行太长,我把 hash 后面截掉了,用 `...` 表示。<br>同一行的 `hash = "sha256:..."` 是文件的 SHA-256 指纹,Day 8 校验安装包时用过同样的东西。下载下来的文件指纹对不上,uv 会拒绝安装,防止有人在中间把包换掉。`package-lock.json` 里的 `integrity` 字段是同一个作用。
- `wheels = [` wheel(轮子)是「已经准备好、解压就能用」的安装包,`.whl` 后缀。有 wheel 时 uv 用 wheel,不用从源码构建。
- `rich-15.0.0-py3-none-any.whl` 文件名里的 `py3-none-any` 是说「任何 Python 3、任何平台都能用」,因为 rich 是纯 Python 写的。

</div>

ruff 那一项更有意思,它的 `wheels` 有十几行,`macosx_10_12_x86_64`、`macosx_11_0_arm64`、`manylinux_2_17_x86_64`、`win_amd64`……每个平台一个。Ruff 是 Rust 编译出来的程序,每个系统和芯片要一个单独的文件。`uv.lock` 把所有平台的都记下了,所以**同一个 `uv.lock`,你在 Intel Mac 上用、同事在 Apple 芯片的 Mac 上用、以后部署到 Linux 服务器上用,都锁得住**。uv 文档管这个叫「universal lockfile」。

用树的形式看依赖关系,相当于 `npm ls`:

```text
$ uv tree
Resolved 6 packages in 9ms
agent-zero-lab v0.1.0
├── rich v15.0.0
│   ├── markdown-it-py v4.2.0
│   │   └── mdurl v0.1.2
│   └── pygments v2.21.0
└── ruff v0.17.1 (group: dev)
```

<div class="line-notes">

- `agent-zero-lab v0.1.0` 根是你的项目。
- `├── rich v15.0.0` 直接依赖 rich。
- `│   │   └── mdurl v0.1.2` 缩进越深,离你越远:mdurl 是 markdown-it-py 要的,markdown-it-py 是 rich 要的。
- `└── ruff v0.17.1 (group: dev)` ruff 标着「属于 dev 组」。

</div>

把三样东西的关系画出来:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="pyproject.toml 你写的要什么,uv lock 算出 uv.lock 装了什么,uv sync 按 uv.lock 装出 .venv;前两个交给同事,.venv 不交">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="170" height="80" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="32" y="54" fill="var(--ink)">pyproject.toml</text>
<text x="32" y="76" fill="var(--ink-soft)">要什么</text>
<text x="32" y="96" fill="var(--ink-soft)">rich>=15.0.0</text>
<line x1="190" y1="70" x2="228" y2="70" stroke="var(--ink-soft)"/><polygon points="228,65 238,70 228,75" fill="var(--ink-soft)"/>
<text x="192" y="60" fill="var(--ink-faint)">uv lock</text>
<rect x="240" y="30" width="170" height="80" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="252" y="54" fill="var(--ink)">uv.lock</text>
<text x="252" y="76" fill="var(--ink-soft)">装了什么</text>
<text x="252" y="96" fill="var(--ink-soft)">rich 15.0.0 + 指纹</text>
<line x1="410" y1="70" x2="448" y2="70" stroke="var(--ink-soft)"/><polygon points="448,65 458,70 448,75" fill="var(--ink-soft)"/>
<text x="412" y="60" fill="var(--ink-faint)">uv sync</text>
<rect x="460" y="30" width="160" height="80" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="472" y="54" fill="var(--ink)">.venv/</text>
<text x="472" y="76" fill="var(--ink-soft)">真的装在这</text>
<text x="472" y="96" fill="var(--ink-soft)">31 MB</text>
<line x1="20" y1="140" x2="410" y2="140" stroke="var(--mem)"/>
<text x="20" y="162" fill="var(--ink)">交给同事 / 以后提交进 git</text>
<line x1="460" y1="140" x2="620" y2="140" stroke="var(--compute)"/>
<text x="460" y="162" fill="var(--ink)">不交,随时重建</text>
<text x="20" y="200" fill="var(--ink-soft)">uv add / uv remove / uv run 会自动把三步都做了;</text>
<text x="20" y="222" fill="var(--ink-soft)">手改 pyproject.toml 之后,要靠 uv lock 和 uv sync 把后两样追上。</text>
</g>
</svg>
<figcaption>三样东西,两条命令。前端的对应是 package.json → package-lock.json → node_modules。</figcaption>
</figure>

## 删掉 .venv,一秒恢复

既然 `.venv` 能按 `uv.lock` 重建,那就删了它:

```text
$ rm -rf .venv
$ .venv/bin/python --version
zsh: no such file or directory: .venv/bin/python
$ uv sync
Using CPython 3.12.15
Creating virtual environment at: .venv
Resolved 6 packages in 7ms
Installed 5 packages in 31ms
 + markdown-it-py==4.2.0
 + mdurl==0.1.2
 + pygments==2.21.0
 + rich==15.0.0
 + ruff==0.17.1
$ uv run part01/hello_rich.py | head -1
hello agent,今天有 3 张计费工单
```

<div class="line-notes">

- `$ rm -rf .venv` 删掉整个环境。删它很安全,里面没有一行你写的代码。
- `zsh: no such file or directory: .venv/bin/python` 确实没了。
- `$ uv sync` 「同步」:让 `.venv` 和 `uv.lock` 完全一致。没有 `.venv` 就新建。
- `Resolved 6 packages in 7ms` 7 毫秒,没有联网去算,直接读的 `uv.lock`。
- `Installed 5 packages in 31ms` 5 个包 31 毫秒装完,整个 `uv sync` 我计时是 0.08 秒。这么快是因为 uv 有全局缓存,Day 10 下载过的包都在缓存里,这次直接从缓存拿,不用再下载。
- `+ ruff==0.17.1` 版本和删之前一模一样,dev 组的 ruff 也装回来了。

</div>

缓存在哪、多大:

```text
$ uv cache dir
/Users/你/.cache/uv
$ du -sh $(uv cache dir)
 36M	/Users/你/.cache/uv
```

<div class="line-notes">

- `$ uv cache dir` 缓存目录。所有项目共用这一份,同一个版本的包只下载一次。
- `$ du -sh $(uv cache dir)` `$(命令)` 是「先运行括号里的命令,把输出填到这里」,这里等于 `du -sh /Users/你/.cache/uv`。
- ` 36M	/Users/你/.cache/uv` 36 MB。和 pnpm 的全局 store 是一个思路。哪天硬盘紧张,`uv cache clean` 能清掉,代价是下次装包要重新下载。

</div>

### uv sync 会把多余的东西删掉

`uv sync` 的「同步」是双向的:缺的装上,**多的删掉**。演示一下。用 uv 提供的 pip 兼容命令,绕过 `pyproject.toml` 往环境里塞一个包:

```text
$ uv pip install cowsay
Resolved 1 package in 4ms
Installed 1 package in 7ms
 + cowsay==6.1
$ uv run python -c "import cowsay; print(cowsay.__version__)"
6.1
$ uv sync
Resolved 6 packages in 7ms
Uninstalled 1 package in 3ms
 - cowsay==6.1
$ uv run python -c "import cowsay"
Traceback (most recent call last):
  File "<string>", line 1, in <module>
ModuleNotFoundError: No module named 'cowsay'
```

<div class="line-notes">

- `$ uv pip install cowsay` `uv pip` 是 uv 模仿 pip 的一组命令,往当前项目的 `.venv` 里装东西,但**不改 `pyproject.toml`,也不改 `uv.lock`**。
- `6.1` 装上了,能用。`uv run` 不会因为环境里多了个包就删掉它。
- `$ uv sync` 一同步,uv 发现 `.venv` 里有一个 `uv.lock` 里没有的包,
- `- cowsay==6.1` 删了。
- `ModuleNotFoundError: No module named 'cowsay'` 没了。

</div>

这个实验说明了一件事:**`.venv` 里有什么,最终由 `pyproject.toml` 和 `uv.lock` 说了算**。手动往环境里塞的东西,下一次 `uv sync`(或者同事那边)就没了。所以装依赖只用 `uv add`,这也是 Day 10 说「别用 `pip install`」的原因。

`uv sync` 还能只装生产依赖,不装 dev 组,以后部署到服务器上时会用:

```text
$ uv sync --no-dev
Resolved 6 packages in 9ms
Uninstalled 1 package in 2ms
 - ruff==0.17.1
$ uv sync
Resolved 6 packages in 8ms
Installed 1 package in 4ms
 + ruff==0.17.1
```

<div class="line-notes">

- `$ uv sync --no-dev` 相当于 `npm ci --omit=dev`。服务器上跑程序不需要 Ruff。
- `- ruff==0.17.1` 删掉了 dev 组的 ruff。
- `$ uv sync` 再普通地同步一次,ruff 回来了。

</div>

## 手改 pyproject.toml 之后

`uv add` 会同时改 `pyproject.toml`、更新 `uv.lock`、装进 `.venv`,三步一起做。但你也可以直接在编辑器里改 `pyproject.toml`(比如合并别人的改动时)。这时候 `uv.lock` 就过期了。用 Zed 打开 `pyproject.toml`,在 `dependencies` 里加一行:

```toml
dependencies = [
    "rich>=15.0.0",
    "cowsay>=6.1",
]
```

<div class="line-notes">

- `"cowsay>=6.1",` 手动加的一行,注意上一行末尾要有逗号。

</div>

然后用「严格模式」同步:

```text
$ uv sync --locked
Resolved 7 packages in 14ms
error: The lockfile at `uv.lock` needs to be updated, but `--locked` was provided.

hint: To update the lockfile, run `uv lock`.
$ uv lock
Resolved 7 packages in 12ms
Added cowsay v6.1
$ uv sync --locked
Resolved 7 packages in 7ms
Installed 1 package in 6ms
 + cowsay==6.1
```

<div class="line-notes">

- `$ uv sync --locked` `--locked` 的意思是「`uv.lock` 必须和 `pyproject.toml` 对得上,对不上就报错,不许偷偷改 lock」。相当于 npm 的 `npm ci`:lock 文件和 `package.json` 不一致时 `npm ci` 也会直接失败。
- `error: The lockfile at `uv.lock` needs to be updated, but `--locked` was provided.` 「lock 文件需要更新,但你说了 `--locked`」。uv 拿 `uv.lock` 里记的 `[package.metadata]` 和 `pyproject.toml` 一比,发现多了 cowsay。
- `hint: To update the lockfile, run `uv lock`.` 提示得很直接。
- `$ uv lock` 只更新 `uv.lock`,不碰 `.venv`。相当于 `npm install --package-lock-only`。
- `Added cowsay v6.1` lock 里加了 cowsay 6.1。
- `$ uv sync --locked` 这回对得上了,正常装。

</div>

不加 `--locked` 的普通 `uv sync`(和 `uv run`)遇到这种情况会自动先 `uv lock` 再装,不报错。那为什么要有 `--locked`?因为在「自动检查」的场合(以后的 CI,第七部分讲),你希望**发现** lock 过期,而不是被悄悄修好:lock 过期说明有人改了依赖却没把新的 lock 交上来,这是要提醒的事。

试完把 cowsay 删掉,恢复原样:

```text
$ uv remove cowsay
Resolved 6 packages in 13ms
Uninstalled 1 package in 4ms
 - cowsay==6.1
$ uv lock --check
Resolved 6 packages in 6ms
```

<div class="line-notes">

- `$ uv remove cowsay` `uv remove` 会同时改 `pyproject.toml` 和 `uv.lock`,并从 `.venv` 里删掉。
- `$ uv lock --check` 只检查 lock 是不是最新的,不改任何东西。没报错、退出码是 0,就是最新的(Day 5 讲过退出码,`echo $?` 能看)。

</div>

## 拼起来:模拟同事拿到你的项目

以后你会把 `agent-zero-lab` 用 git 交给别人(或者自己换电脑)。git 是 Day 56 的事,今天用 `cp` 模拟一下:只复制该交出去的文件,**不复制 `.venv`**,看看在新地方能不能原样跑起来。

```text
$ mkdir -p ~/terminal-practice/day11/lab-copy
$ cd ~/agent-zero-lab
$ cp -R pyproject.toml uv.lock .python-version main.py part01 ~/terminal-practice/day11/lab-copy/
$ cd ~/terminal-practice/day11/lab-copy
$ ls -a
.
..
.python-version
main.py
part01
pyproject.toml
uv.lock
$ uv sync --locked
Using CPython 3.12.15
Creating virtual environment at: .venv
Resolved 6 packages in 8ms
Installed 5 packages in 51ms
 + markdown-it-py==4.2.0
 + mdurl==0.1.2
 + pygments==2.21.0
 + rich==15.0.0
 + ruff==0.17.1
$ uv run part01/hello_rich.py | head -1
hello agent,今天有 3 张计费工单
```

<div class="line-notes">

- `$ cp -R pyproject.toml uv.lock .python-version main.py part01 ~/terminal-practice/day11/lab-copy/` `cp` 一次复制多个,最后一个参数是目标目录;`-R` 是因为 `part01` 是目录(Day 4)。复制的正是「交给同事」的那些:两个配置文件、版本文件、代码。`.venv` 故意不复制。
- `$ ls -a` 新目录里没有 `.venv`,也没有 `.git`(那个今天用不上)。
- `$ uv sync --locked` 同事拿到项目后第一件事。用 `--locked` 是确认「我装的和你锁的完全一样」。
- `Using CPython 3.12.15` 按 `.python-version` 选的 Python。如果同事机器上没有 3.12,uv 会先自动下载一个。
- `+ rich==15.0.0` 每个版本都和原项目一模一样,一个字节都不差(有指纹校验)。
- `hello agent,今天有 3 张计费工单` 跑起来了。

</div>

所以给别人一个 Python 项目,需要交出去的是这几样,和前端几乎一样:

| 文件 | 前端对应 | 交不交 |
| --- | --- | --- |
| `pyproject.toml` | `package.json` | 交 |
| `uv.lock` | `package-lock.json` / `pnpm-lock.yaml` | 交 |
| `.python-version` | `.nvmrc` | 交 |
| 你写的代码 | `src/` 等 | 交 |
| `.venv/` | `node_modules/` | 不交,对方 `uv sync` 重建 |

| 今天的零件 | 在上面哪一步 |
| --- | --- |
| `.venv` = 指向某个 Python 的链接 + `site-packages` + `pyvenv.cfg` | `ls .venv`、`cat .venv/pyvenv.cfg` |
| 激活 = 往 PATH 前面加 `.venv/bin` | `source .venv/bin/activate`、`which python` |
| 课里不激活,一律 `uv run` | `sys.prefix` 对比 |
| `pyproject.toml` 写约束,`uv.lock` 锁版本加指纹 | `head -30 uv.lock`、`uv tree` |
| `uv sync`:缺的装,多的删 | 删 `.venv` 重建、`uv pip install cowsay` 被删 |
| `--locked` 发现 lock 过期,`uv lock` 更新 | 手改 `pyproject.toml` 之后 |
| 交出去的文件 | `cp` 到 `lab-copy` 再 `uv sync --locked` |

## 动手练习

### 练习 1:激活前后,`python` 是谁

在 `~/agent-zero-lab` 里,按顺序敲下面几条,每条之前先猜输出,再看结果:`which -a python3`,`source .venv/bin/activate`,`which -a python3`,`python3 --version`,`deactivate`,`python3 --version`。说出激活前后 `python3` 分别是哪个文件、哪个版本。

<details><summary>参考答案</summary>

```text
$ cd ~/agent-zero-lab
$ which -a python3
/Users/你/bin/python3
/usr/bin/python3
$ source .venv/bin/activate
$ which -a python3
/Users/你/agent-zero-lab/.venv/bin/python3
/Users/你/bin/python3
/usr/bin/python3
$ python3 --version
Python 3.12.15
$ deactivate
$ python3 --version
Python 3.12.13
```

<div class="line-notes">

- `/Users/你/bin/python3` 激活前,排第一的是我演示家目录里的 3.12.13。你那边排第一的是 `/Library/Frameworks/Python.framework/Versions/3.12/bin/python3`(3.12.10),后面还会有 Day 8 见过的 `/usr/local/bin/python3`。
- `/Users/你/agent-zero-lab/.venv/bin/python3` 激活后,`.venv/bin` 被放到了 PATH 最前面,它里面的 `python3` 抢到了第一。后面几个都还在,只是被挡住了。Day 7 练习 3 那个「冒充」,激活就是这么干的,只不过这次是好意。
- `Python 3.12.15` `.venv` 里的 `python3` 链到 uv 装的 3.12.15。
- `Python 3.12.13` `deactivate` 之后又回到原来那个(你那边是 3.12.10)。

</div>

</details>

### 练习 2:换一个旧版本的 rich,再换回来

在 `~/terminal-practice/day11/lab-copy` 里(别在正式仓库里折腾),把 rich 换成 15 以下的最新版本,用 `uv tree --depth 1` 确认,然后再换回 15。每一步之后看看 `pyproject.toml` 里 rich 那一行变成了什么。

<details><summary>参考答案</summary>

```text
$ cd ~/terminal-practice/day11/lab-copy
$ uv add "rich<15"
Resolved 6 packages in 1.58s
Prepared 1 package in 3.12s
Uninstalled 1 package in 23ms
Installed 1 package in 7ms
 - rich==15.0.0
 + rich==14.3.4
$ grep rich pyproject.toml
    "rich<15",
$ uv tree --depth 1
Resolved 6 packages in 8ms
agent-zero-lab v0.1.0
├── rich v14.3.4
└── ruff v0.17.1 (group: dev)
$ uv add "rich>=15"
Resolved 6 packages in 13ms
Uninstalled 1 package in 15ms
Installed 1 package in 7ms
 - rich==14.3.4
 + rich==15.0.0
$ uv tree --outdated --depth 1
Resolved 6 packages in 8ms
agent-zero-lab v0.1.0
├── rich v15.0.0
└── ruff v0.17.1 (group: dev)
```

<div class="line-notes">

- `$ uv add "rich<15"` 对已经有的依赖再 `uv add`,就是改它的约束。约束要加引号,不然 zsh 会把 `<` 当成 Day 5 学的输入重定向,去找一个叫 `15` 的文件。
- `+ rich==14.3.4` 在「小于 15」的范围里,uv 选了最新的 14.3.4。
- `"rich<15",` `pyproject.toml` 里的约束变成了你写的样子,uv 不会自作主张改成别的。
- `├── rich v14.3.4` `--depth 1` 只看第一层,不展开间接依赖。
- `+ rich==15.0.0` 换回来了。
- `$ uv tree --outdated --depth 1` `--outdated` 会在有新版本的包后面标出最新版本号,相当于 `npm outdated`。两个包后面都没有标注,说明都已经是最新的。

</div>

这里 rich 的约束最后写成了 `"rich>=15"`,和原来的 `"rich>=15.0.0"` 意思一样。

</details>

### 练习 3:`.python-version` 和 `requires-python` 谁说了算

还是在 `lab-copy` 里。依次把 `.python-version` 改成 `3.11`、`3.13`、`3.12`,每次改完都 `uv run python --version`。先猜三次分别会怎样。

<details><summary>参考答案</summary>

```text
$ echo 3.11 > .python-version
$ uv run python --version
Downloading cpython-3.11.17-macos-x86_64-none (download) (25.4MiB)
 Downloaded cpython-3.11.17-macos-x86_64-none (download)
Using CPython 3.11.17
error: The Python request from `.python-version` resolved to Python 3.11.17, which is incompatible with the project's Python requirement: `>=3.12` (from `project.requires-python`)
Use `uv python pin` to update the `.python-version` file to a compatible version
$ echo 3.13 > .python-version
$ uv run python --version
Downloading cpython-3.13.17-macos-x86_64-none (download) (23.9MiB)
 Downloaded cpython-3.13.17-macos-x86_64-none (download)
Using CPython 3.13.17
Removed virtual environment at: .venv
Creating virtual environment at: .venv
Installed 5 packages in 54ms
Python 3.13.17
$ echo 3.12 > .python-version
$ uv run python --version
Using CPython 3.12.15
Removed virtual environment at: .venv
Creating virtual environment at: .venv
Installed 5 packages in 46ms
Python 3.12.15
```

<div class="line-notes">

- `$ echo 3.11 > .python-version` 用 `>` 覆盖这个文件,它本来就只有一行,覆盖没关系(Day 5)。
- `Downloading cpython-3.11.17-macos-x86_64-none (download) (25.4MiB)` 机器上没有 3.11,uv 自动下载了一个。这一点比 nvm 省事。
- `error: The Python request from `.python-version` resolved to Python 3.11.17, which is incompatible with the project's Python requirement: `>=3.12`` 下载完却拒绝用:`.python-version` 要 3.11,但 `pyproject.toml` 的 `requires-python` 要求至少 3.12。**`requires-python` 是硬规定,`.python-version` 只是在规定范围内挑一个**。
- `Use `uv python pin` to update the `.python-version` file to a compatible version` 它建议用 `uv python pin 3.12` 这样的命令来改版本文件,效果和我们 `echo` 一样。
- `Removed virtual environment at: .venv` 3.13 在范围内。但 `.venv` 是用 3.12 建的,解释器版本变了,uv 只能把整个环境删掉重建。这再次说明 `.venv` 里的 Python 是建环境时定死的。
- `Python 3.13.17` 用上了 3.13。
- `Python 3.12.15` 改回 3.12,又重建一次。

</div>

做完这一题,`~/.local/share/uv/python/` 里多了 3.11 和 3.13 两个 Python,一共五十来 MB。不想留可以 `uv python uninstall 3.11 3.13`。

</details>

### 练习 4:哪些能删,哪些不能

下面五样东西,哪些删了能用一条命令恢复?分别是哪条命令?哪样删了就真没了?先回答,再在 `lab-copy` 里挑能恢复的实际删一次验证。

1. `.venv/`
2. `uv.lock`
3. `~/.cache/uv`
4. `pyproject.toml`
5. `part01/hello_rich.py`

<details><summary>参考答案</summary>

1. `.venv/`:`uv sync` 恢复,正文做过。
2. `uv.lock`:`uv lock` 重新生成。但要知道,重新生成时 uv 会按 `pyproject.toml` 的约束**重新挑最新的版本**,如果这期间某个包出了新版本,新 lock 里的版本就和原来不一样了。所以 lock 能「重新生成」,不能保证「原样恢复」。这正是要把 `uv.lock` 交出去、而不是让每个人自己生成的原因。
3. `~/.cache/uv`:不用恢复,下次装包时 uv 自己重新下载、重新建缓存,只是慢一点。
4. `pyproject.toml`:删了没有命令能恢复,要靠备份或者以后的 git。它是你写的(`uv add` 帮你写也算你的),是项目的身份证。
5. `part01/hello_rich.py`:你的代码,删了就真没了。

在 `lab-copy` 里验证第 2 条:

```text
$ cd ~/terminal-practice/day11/lab-copy
$ rm uv.lock
$ uv lock
Resolved 6 packages in 1.84s
$ uv tree --depth 1
Resolved 6 packages in 15ms
agent-zero-lab v0.1.0
├── rich v15.0.0
└── ruff v0.17.1 (group: dev)
```

<div class="line-notes">

- `$ rm uv.lock` 删掉 lock。
- `Resolved 6 packages in 1.84s` 这次用了 1.84 秒,比平时的几毫秒慢,因为没有 lock 可读,uv 要去 PyPI 重新查每个包有哪些版本。
- `├── rich v15.0.0` 今天重新生成,版本恰好和原来一样,因为从 Day 10 到今天这几个包都没出新版本。过几个月再这么做,结果就可能不同了。

</div>

验证完记得 `uv run part01/hello_rich.py` 确认还能跑。

</details>

验收标准:能不看文章说出 `.venv` 里 `bin/python`、`site-packages`、`pyvenv.cfg` 各是什么;激活后 `which python` 指向 `.venv/bin/python`,`deactivate` 后找不到;`~/agent-zero-lab` 里 `rm -rf .venv && uv sync` 之后 `uv run python part01/hello_rich.py` 照常打印表格;手改 `pyproject.toml` 后能看懂 `uv sync --locked` 的报错并用 `uv lock` 修好;能说出给同事的项目要包含哪四样、不包含哪一样。做完练习,确认 `~/agent-zero-lab/pyproject.toml` 里只有 rich 和 ruff,`uv lock --check` 不报错。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 虚拟环境(virtual environment) | 一个项目专用的 Python 环境目录,里面有指向某个 Python 的链接、放库的 `site-packages` 和说明书 `pyvenv.cfg`。uv 默认建在项目的 `.venv/` |
| `site-packages` | Python 放第三方库的目录,作用相当于 `node_modules` |
| `pyvenv.cfg` | 虚拟环境的说明书:基于哪个 Python、要不要看全局的库、提示符叫什么 |
| `.dist-info` | 每个装好的库旁边的记录目录:版本、文件清单等 |
| 激活(activate) | `source .venv/bin/activate`,把 `.venv/bin` 加到 PATH 最前面,让 `python` 指向项目的解释器;`deactivate` 改回去 |
| `sys.prefix` | 当前 Python 环境的根目录,用来确认用的是哪个环境 |
| `python -m 模块名` | 把一个模块当程序运行,如 `python -m pip` |
| `uv pip` | uv 模仿 pip 的一组命令,往环境里装东西但不改 `pyproject.toml` 和 `uv.lock`,这门课只用来做实验 |
| 版本约束(version specifier) | `rich>=15.0.0`、`rich<15`、`rich==15.0.0` 这种「包名 + 版本范围」,写在 `pyproject.toml` |
| lock 文件(`uv.lock`) | uv 算出来的每个包(含间接依赖)的精确版本、下载地址和指纹,相当于 `package-lock.json`,不要手改 |
| 指纹(hash) | 文件内容算出来的 SHA-256 值,下载的包对不上就拒绝安装 |
| wheel / sdist | wheel(`.whl`)是解压即用的安装包;sdist(`.tar.gz`)是源码包,没有 wheel 时才用它构建 |
| universal lockfile | uv 的 lock 文件同时记录所有平台的安装包,一份 lock 在 Mac、Linux、Windows 上都能用 |
| `uv sync` | 让 `.venv` 和 `uv.lock` 完全一致:缺的装,多的删 |
| `uv sync --locked` | 要求 lock 和 `pyproject.toml` 对得上,对不上就报错不修,相当于 `npm ci` |
| `uv lock` | 只按 `pyproject.toml` 重新生成或更新 `uv.lock`,不碰 `.venv` |
| `uv tree` | 用树形显示依赖关系,相当于 `npm ls`;`--outdated` 相当于 `npm outdated` |
| uv 缓存 | `~/.cache/uv`,所有项目共用的下载缓存,同一个版本的包只下载一次 |
| `requires-python` | `pyproject.toml` 里项目允许的 Python 版本范围,是硬规定;`.python-version` 只在这个范围里挑 |

## 常见误区

**把 `.venv` 当成项目的一部分去备份、去拷贝。** 它是装出来的东西,和 `node_modules` 一样不交给别人。别人拿到项目 `uv sync` 一下就有了。反过来,`.venv` 坏了也别修,删掉重建最快。

**以为 `uv.lock` 可以不交,反正能重新生成。** 能生成,但生成出来的版本取决于那一刻 PyPI 上有什么。不交 lock,你和同事装到的版本迟早会不一样。`uv.lock` 和 `pyproject.toml` 一起交。

**手改 `uv.lock`。** 它是 uv 算出来的,手改很容易改出指纹对不上、依赖不一致的问题。要换版本就改 `pyproject.toml` 的约束(或者 `uv add "包名<版本"`),让 uv 重新算。

**`./.venv/bin/activate` 直接运行,以为激活了。** 那样它在一个子进程里改了 PATH,子进程结束改动就没了,你的终端毫无变化。要 `source .venv/bin/activate`。不过这门课不需要激活,用 `uv run`。

**激活了一个项目的环境,又 `cd` 到另一个项目里干活。** 激活跟着终端窗口走,不跟着目录走,你在 B 项目里敲的 `python` 还是 A 项目的。这是课里不用激活的主要原因。

**在 uv 的环境里找 pip。** 报 `No module named pip` 是正常的,uv 建的环境默认不带 pip。装依赖用 `uv add`。

**以为 `>=15.0.0` 会让项目哪天自动升到 rich 16。** 只要 `uv.lock` 在,装的永远是锁住的版本。只有你主动 `uv lock --upgrade`(或 `uv add` 改约束)时才会变。

**`uv add rich<15` 不加引号。** zsh 会把 `<15` 当成从文件 `15` 读输入,我实测报的是 `zsh: no such file or directory: 15`,uv 根本没运行。版本约束一律加引号。

**以为改 `.python-version` 就能用任何版本。** 它要落在 `requires-python` 的范围里,否则 uv 直接拒绝。真要支持旧版本,要先改 `requires-python`,而且要确认所有依赖在旧版本上都能装。

## 学习资料

### 文档与文章

- [Python 官方教程 · 12. 虚拟环境和包](https://docs.python.org/zh-cn/3.12/tutorial/venv.html):中文,官方讲虚拟环境是什么、为什么要用。用的是 Python 自带的 `venv` 和 pip,命令和我们不同,但讲的概念就是今天的 `.venv`。很短,今天读完。
- [Python 官方文档 · venv](https://docs.python.org/zh-cn/3.12/library/venv.html):中文,「venv 是如何工作的」一节讲了 `pyvenv.cfg`、`sys.prefix`、激活脚本改 PATH,正好对照今天打开看的那几样。
- [uv 文档 · Project structure and files](https://docs.astral.sh/uv/concepts/projects/layout/):英文,`.venv`、`uv.lock`、`pyproject.toml` 各自是什么、哪些要提交,官方说法。
- [uv 文档 · Locking and syncing](https://docs.astral.sh/uv/concepts/projects/sync/):英文,`uv lock`、`uv sync`、`--locked`、`--frozen`、什么时候会自动更新 lock。
- [uv 文档 · Managing dependencies](https://docs.astral.sh/uv/concepts/projects/dependencies/):英文,版本约束怎么写、依赖分组、dev 组。
- [uv 文档 · Caching](https://docs.astral.sh/uv/concepts/cache/):英文,缓存放在哪、怎么清、为什么装包快。
- [Python Packaging User Guide · Writing your pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/):英文,Python 官方的 `pyproject.toml` 写法指南,每个字段是什么。今天的 `[project]` 那段在这里有完整解释。
- [npm 文档 · package-lock.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json):英文,对照着看 npm 的 lock 文件记了什么,和 `uv.lock` 比一比,你会发现思路几乎一样。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1MLkmY4E3t&autoplay=0&high_quality=1" title="虚拟环境：你肯定用过，但不一定了解 | Python | venv | pipenv | poetry | vscode" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Hucci写代码 · 虚拟环境:你肯定用过,但不一定了解 · 5 分钟,2024 年 12 月,播放 7 万。讲虚拟环境的原理:激活改了什么、为什么能隔离,和正文「激活其实就是改 PATH」是一个角度。视频里用的工具是 venv 和 poetry,原理通用。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hUNR6dERx&autoplay=0&high_quality=1" title="Python 原生虚拟环境 venv 保姆级教程，创建 / 激活 / 安装 / 退出全流程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · Python 原生虚拟环境 venv 保姆级教程,创建 / 激活 / 安装 / 退出全流程 · 14 分钟,2026 年 7 月。用 Python 自带的 venv 从零建一个环境、激活、装包、退出。看它是为了知道「没有 uv 时大家是怎么做的」,网上的老教程和老项目都是这一套,你以后读得懂就行,自己还是用 uv。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Y21OR1OPC9A" title="Python Virtual Environments - Full Tutorial for Beginners" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Tech With Tim · Python Virtual Environments - Full Tutorial for Beginners · 英文,可开自动字幕。写给初学者的虚拟环境完整讲解,为什么需要它、它解决什么问题。他用的是 venv + pip,概念部分和今天完全对得上。</figcaption>
</figure>

### 书籍

- Claudio Jolowicz《Hypermodern Python Tooling》,O'Reilly,2024。第 2 章专讲 Python 环境(解释器、`site-packages`、虚拟环境是怎么工作的),第 4 章讲依赖管理和 lock 文件,比今天讲得更深。Day 10 推荐过这本。
- 今天这组只推荐这一本。中文入门书讲虚拟环境的部分大多停留在 `python -m venv` + `pip`,可以当背景知识翻一翻,命令以 uv 为准。

### 开源项目与代码

- [astral-sh/uv](https://github.com/astral-sh/uv):在仓库里搜 `uv.lock`,能找到 uv 自己的 lock 文件,我看的时候两千多行,看看一个真实项目的 lock 长什么样。
- [PEP 621 原文](https://peps.python.org/pep-0621/):`[project]` 那一段格式的出处。不用读完,看开头的「Motivation」,讲为什么 Python 社区要统一用 `pyproject.toml`。

## 自测

1. 同事说:「我把你的项目拷过来了,`uv run` 一下就自动装好了,那我为什么还要你把 `uv.lock` 给我?」你怎么回答?

<details><summary>答案</summary>

没有 `uv.lock`,uv 只能按 `pyproject.toml` 里的约束(比如 `rich>=15.0.0`)现场去 PyPI 挑最新的版本,他装到的版本取决于他什么时候装,可能和我的不一样,出了问题很难查。有 `uv.lock`,每个包(包括间接依赖)的精确版本和文件指纹都定死了,他装出来的环境和我的一模一样,下载的文件被篡改也会被发现。

</details>

2. `source .venv/bin/activate` 之后 `which python` 变成了 `.venv/bin/python`。用 Day 7 的知识解释为什么。

<details><summary>答案</summary>

激活脚本执行了 `PATH="$VIRTUAL_ENV/bin:$PATH"`,把 `.venv/bin` 加到了 PATH 最前面。shell 找命令时按 PATH 的顺序找,`.venv/bin` 里有 `python`,排第一,所以找到的是它。`deactivate` 把之前存下的 `_OLD_VIRTUAL_PATH` 还原回去,`python` 就又找不到了。

</details>

3. 下面哪些操作之后,`.venv` 里的内容会和 `uv.lock` 不一致?`uv add httpx`、`uv pip install httpx`、手动在 `pyproject.toml` 里加一行再 `uv sync`、`rm -rf .venv` 之后什么都不做。

<details><summary>答案</summary>

`uv pip install httpx` 之后不一致:httpx 进了 `.venv`,但 `uv.lock` 里没有,下次 `uv sync` 会把它删掉。`rm -rf .venv` 之后也不一致(环境都没了),下次 `uv run` 或 `uv sync` 会重建。`uv add httpx` 会同时改 `pyproject.toml`、`uv.lock` 和 `.venv`,一致;手动改 `pyproject.toml` 后普通的 `uv sync` 会先自动更新 lock 再装,也一致。

</details>

4. CI(自动检查)里应该用 `uv sync` 还是 `uv sync --locked`?为什么?

<details><summary>答案</summary>

用 `uv sync --locked`。它在 `uv.lock` 和 `pyproject.toml` 对不上时直接报错,能发现「有人改了依赖却没提交新的 lock」这种问题;普通 `uv sync` 会悄悄重新生成 lock 再装,CI 里装出来的版本可能和开发者机器上不一样,问题就被掩盖了。相当于前端 CI 里用 `npm ci` 而不是 `npm install`。

</details>

5. 面试题:解释一下 Python 的虚拟环境是什么,它和 Node 的 `node_modules` 有什么异同。

<details><summary>答案</summary>

虚拟环境是一个项目专用的目录(uv 默认是 `.venv`),里面有一个指向某个 Python 解释器的链接、一个放第三方库的 `site-packages` 目录,和一个 `pyvenv.cfg` 说明文件。Python 启动时读到 `pyvenv.cfg`,就只在这个环境的 `site-packages` 里找库,从而和全局以及其他项目隔离。相同点:都是每个项目一份、装在项目里、不提交、能按 lock 文件重建。不同点:`node_modules` 只装包,解释器用 PATH 上的 node;虚拟环境连解释器版本也定死了,所以不同项目可以各用各的 Python 版本。另外 Node 是按目录层级自动找 `node_modules` 的,Python 要么激活环境(改 PATH),要么用 `uv run` 这类工具指定环境,直接敲全局的 `python3` 是看不到项目里的库的。

</details>

## 明天预告

Day 12 · 变量和数字:int、float 和运算。工具准备齐了:编辑器会画红线,uv 管项目和依赖,`agent-zero-lab/part01/` 等着放代码。从明天起开始正式学 Python 语法,第一课是变量和数字。这几天已经偷偷用过 `amount = "299"` 这种变量,也撞见了 `299 / 1` 得到 `299.0`、`299 * 0.13` 得到 `38.870000000000005` 这些怪事,明天把它们讲清楚。JS 只有一种 number,Python 分 int 和 float,算钱的时候这个区别很要紧。
