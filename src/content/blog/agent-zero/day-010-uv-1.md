---
title: 'Day 10 · uv(一):init、add、run,对照 npm'
description: '装上 uv,用 uv init 建这门课的练习仓库 agent-zero-lab,uv add 装第一个第三方库 rich,uv run 把它跑起来。每条命令都和 npm 对照,顺带撞一遍「没装就 import」「在项目外面跑」「包名拼错」三个坑。'
pubDate: 2026-10-22
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 10
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 9](/blog/agent-zero/day-009-editor-setup/) 给编辑器接上了 basedpyright 和 Ruff:红线是语言服务器画的,`console`、`prnt` 这种没定义的名字不用跑就能看出来,字符串减数字也会提前标红,但除以零这种「值不对」的错还是要跑了才知道。我们还打开了保存时格式化。

到目前为止,我们写的 `.py` 文件只用了 Python 自带的东西:`print`、`round`、`sys`。前端没有人只用浏览器自带的 API 写项目,总要 `npm install` 一堆别人写的包。Python 也一样,后面要用的 openai SDK、FastAPI、LangGraph 全是第三方库。今天就学怎么装、怎么用,工具叫 uv。

## 今天要解决的问题

学完今天,你应该能:

1. 装好 uv,用 `which uv`、`uv --version` 确认;知道它把自己装在了哪,改了哪个配置文件。
2. 用 `uv init --no-package` 建出这门课的练习仓库 `~/agent-zero-lab`,说出生成的每个文件大致对应前端的什么。
3. 用 `uv add` 装一个第三方库、`uv add --dev` 装一个开发工具、`uv remove` 删掉,用 `uv run` 运行脚本;能把这几条命令和 `npm install`、`npm i -D`、`npm uninstall`、`npx` 一一对上。
4. 看到 `ModuleNotFoundError: No module named 'rich'`,知道是「没装」还是「装了但没用对 Python」。

预计用时:2.5 小时。装 uv 和 Python 20 分钟,建项目 30 分钟,装库、跑脚本 1 小时,剩下做练习。

前置:[Day 7](/blog/agent-zero/day-007-terminal-4/)(PATH、`.zshrc`、`which -a`)、[Day 8](/blog/agent-zero/day-008-python-vs-node/)(已经装好 python.org 的 Python 3.12.10、`ModuleNotFoundError` 之前见过 `NameError`)、[Day 9](/blog/agent-zero/day-009-editor-setup/)(Zed 里看红线)。今天要联网下载 uv、Python 和几个库,一共几十 MB;不调任何大模型 API,花费 0 元。

学法提示:先对照文章逐条敲一遍(命令和代码都自己敲,不复制粘贴)并跑通;第二天合上文章,默写出「npm 对照 uv」那张表,再从空目录开始把 `agent-zero-lab` 重建一遍;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

和前几天一样,输出是我 2026-10-22 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`。演示家目录接着 Day 8、Day 9 的状态:`~/bin` 在 PATH 里,`~/terminal-practice/` 里有前几天的练习。uv 的安装脚本、下载 Python、装库,全部是在演示家目录里实际执行的。

有一处和你不同:Day 8 说过,我的演示家目录里 `python3` 是一个指向 3.12.13 的符号链接,你那边是 python.org 装的 3.12.10。今天的输出里凡是出现这个 3.12.13 的地方,我都会标出来,你那边对应的是 `/Library/Frameworks/Python.framework/...` 那个 3.12.10。

## uv 是什么,为什么不用 pip

先用前端的话说清楚 uv 是干什么的。写前端项目,你至少要用到这几样:nvm 管 Node 版本,npm(或 pnpm)装依赖、生成 lock 文件,`node_modules` 放装好的包,npx 临时跑一个命令行工具。

Python 的老办法是每件事一个工具:pyenv 管版本,pip 装包,venv 建「每个项目自己的依赖目录」,pip-tools 或 poetry 锁版本,pipx 跑命令行工具。这一套组合起来是出了名的乱,网上教程五花八门,新手经常装到错的地方。

uv 是 Astral 公司(就是做 Ruff 的那家)用 Rust 写的,2024 年发布以后很快成了 Python 社区的主流选择,它一个工具把上面这些全包了。装包比 pip 快得多,命令的手感也很像 pnpm。这门课从今天起所有 Python 项目都用 uv 管,你不需要学 pip。

| 前端 | uv | 做什么 |
| --- | --- | --- |
| nvm install 22 | `uv python install 3.12` | 装一个语言版本 |
| `npm init` | `uv init` | 新建项目 |
| `npm install rich` | `uv add rich` | 装一个依赖,写进配置文件 |
| `npm install -D eslint` | `uv add --dev ruff` | 装一个只在开发时用的工具 |
| `npm uninstall rich` | `uv remove rich` | 删掉依赖 |
| `node index.js` / `npm exec` | `uv run main.py` / `uv run ruff check` | 在项目自己的环境里运行 |
| `npx cowsay hi` | `uvx cowsay -t hi` | 不装进项目,临时跑一个命令行工具 |
| `package.json` | `pyproject.toml` | 项目说明和依赖清单 |
| `package-lock.json` | `uv.lock` | 锁定精确版本(明天讲) |
| `node_modules/` | `.venv/` | 装好的包放在这(明天讲) |

后三行今天只露个面,[Day 11](/blog/agent-zero/day-011-uv-2/) 专门讲。

## 装 uv

uv 官方推荐的装法是一条命令,和装 nvm 那条差不多:下载一个安装脚本,交给 `sh` 执行。

```text
$ which uv
uv not found
$ curl -LsSf https://astral.sh/uv/install.sh | sh
downloading uv 0.13.5 x86_64-apple-darwin
skipping sha256 checksum verification (it requires the 'sha256sum' command)
installing to /Users/你/.local/bin
  uv
  uvx
everything's installed!

To add $HOME/.local/bin to your PATH, either restart your shell or run:

    source $HOME/.local/bin/env (sh, bash, zsh)
    source $HOME/.local/bin/env.fish (fish)
```

<div class="line-notes">

- `$ which uv` 装之前先确认没有。
- `$ curl -LsSf https://astral.sh/uv/install.sh | sh` `curl` 下载网址上的内容,`-L` 跟着跳转走,`-s` 不显示进度条,`-S` 但出错时还是要说,`-f` 服务器报错时别把错误页面当脚本。下载到的是一段 shell 脚本,`|` 把它交给 `sh` 执行,Day 5 的管道。这种「下载就执行」的写法只对你信任的网址用,uv 的官方安装文档给的就是这一条。
- `downloading uv 0.13.5 x86_64-apple-darwin` 2026 年 10 月我装到的是 0.13.5(10 月 21 日发布)。`x86_64-apple-darwin` 是 Intel 芯片 Mac 的版本,Apple 芯片的 Mac 这里是 `aarch64-apple-darwin`,脚本会自己判断。
- `skipping sha256 checksum verification (it requires the 'sha256sum' command)` 安装脚本想校验下载文件的指纹,但 macOS 上没有 `sha256sum` 这个命令(Mac 上叫 `shasum -a 256`,Day 8 用过),所以跳过了。这行是提示,不是错误。
- `installing to /Users/你/.local/bin` 装到你家目录下的 `.local/bin`,不需要管理员密码,也不碰系统目录。
- `uvx` 一共两个程序:`uv` 和 `uvx`。`uvx` 相当于 npx,后面练习里用。
- `source $HOME/.local/bin/env (sh, bash, zsh)` 它提示:新目录要加进 PATH,要么重开终端,要么在当前窗口执行这一句。

</div>

安装脚本改了什么?Day 7 学过怎么查:

```text
$ tail -3 ~/.zshrc
export PATH="$HOME/bin:$PATH"

. "$HOME/.local/bin/env"
$ cat ~/.local/bin/env
#!/bin/sh
# add binaries to PATH if they aren't added yet
# affix colons on either side of $PATH to simplify matching
case ":${PATH}:" in
    *:"$HOME/.local/bin":*)
        ;;
    *)
        # Prepending path in case a system-installed binary needs to be overridden
        export PATH="$HOME/.local/bin:$PATH"
        ;;
esac
```

<div class="line-notes">

- `export PATH="$HOME/bin:$PATH"` 这是 Day 7 我们自己加的那一行。
- `. "$HOME/.local/bin/env"` 安装脚本往 `.zshrc` 末尾**追加**了一行。开头的 `.` 和 `source` 是同一个意思:在当前 shell 里执行那个文件。它还往 `~/.profile` 里加了同样一行,那是给 bash 等别的 shell 用的,zsh 不读它。
- `case ":${PATH}:" in` `env` 文件的内容。`case` 是 shell 的分支语句,这里在检查 PATH 里是不是已经有 `$HOME/.local/bin`:两头补上冒号,是为了让「整段匹配」更容易写。
- `*:"$HOME/.local/bin":*)` 已经有了,就什么都不做(下一行的 `;;` 表示这个分支结束)。这样你重复 `source` 也不会把同一个目录加两遍。
- `export PATH="$HOME/.local/bin:$PATH"` 没有就加到**最前面**。还是 Day 7 那个拼法。

</div>

关掉终端,重开一个,确认:

```text
$ which -a uv
/Users/你/.local/bin/uv
$ uv --version
uv 0.13.5 (46776a95d 2026-10-21 x86_64-apple-darwin)
$ echo $PATH | tr ":" "\n" | head -3
/Users/你/.local/bin
/Users/你/bin
/Users/你/.nvm/versions/node/v24.22.0/bin
```

<div class="line-notes">

- `/Users/你/.local/bin/uv` 只有一个,就是刚装的。
- `uv 0.13.5 (46776a95d 2026-10-21 x86_64-apple-darwin)` 版本号、代码版本、发布日期、平台。uv 更新很勤,差不多每周一个小版本,你装到的多半更新。今天用的命令在新版本里都一样。
- `$ echo $PATH | tr ":" "\n" | head -3` 把 PATH 按冒号拆成一行一个,看前三个。`tr` 是「把一种字符换成另一种」。
- `/Users/你/.local/bin` uv 的目录排在第一,因为 `.zshrc` 里它那行在最后执行,又是往前面加的。

</div>

以后升级 uv,用 `uv self update`。用 Homebrew 的同学也可以 `brew install uv`,效果一样,但课里统一按上面的装法写,出问题时路径对得上。

## 让 uv 装一个 Python

你已经有 Day 8 装的 3.12.10 了,为什么还要 uv 再装一个?两个原因。第一,Day 8 说过,python.org 不再给 3.12 出新的 Mac 安装包,3.12.10 之后的安全修复你拿不到;uv 下载的是社区编译好的 Python(一个叫 python-build-standalone 的项目),能拿到最新的 3.12 小版本。第二,也是更重要的:**交给 uv 管的 Python,每个项目可以各用各的版本**,就像 nvm 让每个项目用不同的 Node。

先看 uv 能找到哪些 Python:

```text
$ uv python list
cpython-3.16.0a1-macos-x86_64-none                 <download available>
cpython-3.16.0a1+freethreaded-macos-x86_64-none    <download available>
cpython-3.15.1-macos-x86_64-none                   <download available>
...
cpython-3.13.17-macos-x86_64-none                  <download available>
cpython-3.12.15-macos-x86_64-none                  <download available>
cpython-3.12.13-macos-x86_64-none                  bin/python3 -> ...
cpython-3.11.17-macos-x86_64-none                  <download available>
cpython-3.8.2-macos-x86_64-none                    /usr/bin/python3
...
```

<div class="line-notes">

- `$ uv python list` 列出两类:你机器上已经有的,和可以下载的。我删掉了一些行(pypy、graalpy 这些别的实现),用 `...` 表示。
- `cpython-3.16.0a1-macos-x86_64-none                 <download available>` CPython 是官方的 Python 实现,就是你从 python.org 下载的那个。`3.16.0a1` 是 3.16 的第一个测试版(a 是 alpha),别用。
- `+freethreaded` 一种实验性的、去掉了「全局解释器锁」的版本,这门课用不到。
- `cpython-3.12.15-macos-x86_64-none                  <download available>` 3.12 目前最新的是 3.12.15,可以下载。
- `cpython-3.12.13-macos-x86_64-none                  bin/python3 -> ...` 这一行是我演示家目录里那个链接。你那边会在这个位置看到 `cpython-3.12.10-macos-x86_64-none` 和一个 `/Library/Frameworks/Python.framework/Versions/3.12/bin/python3` 的路径,也就是 Day 8 装的那个,uv 认得它。
- `cpython-3.8.2-macos-x86_64-none                    /usr/bin/python3` 苹果自带的那个,uv 也找到了。

</div>

装最新的 3.12:

```text
$ uv python install 3.12
Downloading cpython-3.12.15-macos-x86_64-none (download) (23.6MiB)
 Downloaded cpython-3.12.15-macos-x86_64-none (download)
Installed Python 3.12.15 in 26.28s
 + cpython-3.12.15-macos-x86_64-none (python3.12)
$ uv python list --only-installed
cpython-3.12.15-macos-x86_64-none    .local/bin/python3.12 -> .local/share/uv/python/cpython-3.12-macos-x86_64-none/bin/python3.12
cpython-3.12.15-macos-x86_64-none    .local/share/uv/python/cpython-3.12-macos-x86_64-none/bin/python3.12
cpython-3.12.13-macos-x86_64-none    bin/python3 -> ...
cpython-3.8.2-macos-x86_64-none      /usr/bin/python3
```

<div class="line-notes">

- `$ uv python install 3.12` 只写 `3.12`,uv 会挑这个系列里最新的小版本。
- `(23.6MiB)` 下载 23.6 MB。我这里走了代理,用了 26 秒。
- `+ cpython-3.12.15-macos-x86_64-none (python3.12)` 括号里的 `python3.12` 是说,它还放了一个叫 `python3.12` 的命令。
- `$ uv python list --only-installed` 只看本机已经有的。
- `.local/bin/python3.12 -> .local/share/uv/python/cpython-3.12-macos-x86_64-none/bin/python3.12` 真正的 Python 装在 `~/.local/share/uv/python/` 下面,uv 又在 `~/.local/bin/` 里放了一个叫 `python3.12` 的符号链接指向它。路径前面省掉了 `~/`。

</div>

这里有一个 Day 7 的知识点会冒出来:`~/.local/bin` 在 PATH 最前面,现在里面又多了一个 `python3.12`。

```text
$ which -a python3.12
/Users/你/.local/bin/python3.12
/Users/你/bin/python3.12
```

<div class="line-notes">

- `/Users/你/.local/bin/python3.12` 排第一的是 uv 刚放的那个,3.12.15。
- `/Users/你/bin/python3.12` 第二个是我演示家目录的链接(3.12.13)。你那边第二、三个是 `/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12` 和 `/usr/local/bin/python3.12`,Day 8 装的 3.12.10。

</div>

所以从现在起,你敲 `python3.12` 得到的是 uv 的 3.12.15,敲 `python3` 得到的还是 Day 8 的 3.12.10(uv 只放了带版本号的名字,没有放 `python3`)。这不会出问题,因为下面你会看到:**在项目里,我们几乎不直接敲 `python3`**,都交给 `uv run`,它用哪个 Python 由项目说了算。

## uv init:建 agent-zero-lab

先犯一个错。在家目录里直接装库:

```text
$ cd ~
$ uv add rich
error: No `pyproject.toml` found in current directory or any parent directory
```

<div class="line-notes">

- `$ uv add rich` 想装一个库。
- `error: No `pyproject.toml` found in current directory or any parent directory` 「当前目录和所有上级目录里都找不到 `pyproject.toml`」。这和在一个没有 `package.json` 的目录里 `npm install xxx` 不一样:npm 会在当前目录随手建一个 `node_modules`,uv 不会,它要求你先说清楚「这是哪个项目」。`pyproject.toml` 就是项目的身份证,相当于 `package.json`。

</div>

那就建一个项目。这门课从今天到第一部分结束的所有练习代码,都放在一个叫 `agent-zero-lab` 的仓库里。按 uv 的默认方式建:

```text
$ uv init agent-zero-lab --python 3.12
Initialized project `agent-zero-lab` at `/Users/你/agent-zero-lab`
$ cd agent-zero-lab
$ ls -a
.
..
.git
.gitignore
.python-version
README.md
pyproject.toml
src
$ cat pyproject.toml
[project]
name = "agent-zero-lab"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.12"
dependencies = []

[project.scripts]
agent-zero-lab = "agent_zero_lab:main"

[build-system]
requires = ["uv_build>=0.13.5,<0.14.0"]
build-backend = "uv_build"
```

<div class="line-notes">

- `$ uv init agent-zero-lab --python 3.12` 在当前目录下建一个叫 `agent-zero-lab` 的新目录,`--python 3.12` 说这个项目用 3.12。
- `src` 多了一个 `src` 目录,里面是 `src/agent_zero_lab/__init__.py`。
- `[project.scripts]` 这一段的意思是「把这个项目装好以后,提供一个叫 `agent-zero-lab` 的命令」。
- `[build-system]` 这一段说「这个项目要被打包」,用的打包工具是 uv 自带的 `uv_build`。

</div>

这和网上大多数 uv 教程里看到的不一样:教程里 `uv init` 出来的是一个 `main.py`,没有 `src`,也没有 `[build-system]`。我去查了 uv 的更新日志:**uv 0.12(2026 年 7 月 28 日)把 `uv init` 的默认行为改了**,从此默认建一个「可以被打包发布」的项目,代码放进 `src/项目名/`。这适合你要写一个库、或者一个要发布给别人安装的命令行工具;对这门课来说用不上,反而多了一层目录。所以这门课的仓库加上 `--no-package`,要回原来那种平铺的结构。更新日志里也写了,想要以前的样子就用这个参数。

删掉重建:

```text
$ cd ~
$ rm -rf agent-zero-lab
$ uv init --no-package agent-zero-lab --python 3.12
Initialized project `agent-zero-lab` at `/Users/你/agent-zero-lab`
$ cd agent-zero-lab
$ ls -a
.
..
.git
.gitignore
.python-version
README.md
main.py
pyproject.toml
```

<div class="line-notes">

- `$ rm -rf agent-zero-lab` Day 4 学的,删目录要 `-r`。删之前确认你在 `~`,而且删的是刚建的这个。
- `$ uv init --no-package agent-zero-lab --python 3.12` 加上 `--no-package`,不要打包那一套。
- `.git` uv 顺手 `git init` 了一个空的 git 仓库。git 是 [Day 56](/blog/agent-zero/day-056-git-1/) 的内容,在那之前你不用管它,也别删。
- `.gitignore` 告诉 git 哪些文件不要管,里面有 `.venv`,明天讲。
- `.python-version` 记着这个项目用哪个 Python 版本,相当于前端的 `.nvmrc`。
- `README.md` 空的说明文件,和前端项目里的一样。
- `main.py` 一个示例程序。
- `pyproject.toml` 项目配置。

</div>

一个个看:

```text
$ cat pyproject.toml
[project]
name = "agent-zero-lab"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.12"
dependencies = []
$ cat .python-version
3.12
$ cat main.py
def main():
    print("Hello from agent-zero-lab!")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `[project]` TOML 格式的一个「段」,方括号里是段名。TOML 是一种配置文件格式,比 JSON 好手写:不用引号包键名,可以写 `#` 注释。下面的 `name = "..."` 就是 JSON 里的 `"name": "..."`。
- `name = "agent-zero-lab"` 项目名,对应 `package.json` 的 `name`。
- `version = "0.1.0"` 版本号,对应 `version`。
- `requires-python = ">=3.12"` 这个项目要求 Python 3.12 或更新,相当于 `package.json` 里的 `"engines": { "node": ">=22" }`,但 uv 是真的会检查的。
- `dependencies = []` 依赖列表,现在是空的。对应 `dependencies`。
- `3.12` `.python-version` 只有一行。uv 给这个项目建环境时,用这里写的版本。
- `def main():` `main.py` 用了两个还没学的东西,先大概认识:`def` 定义一个函数,相当于 JS 的 `function main() {`,冒号加缩进代替花括号([Day 28](/blog/agent-zero/day-028-functions-1/) 讲)。
- `print("Hello from agent-zero-lab!")` 函数体,缩进 4 个空格。
- `if __name__ == "__main__":` 「当这个文件是被直接运行的时候」,才调用下面的 `main()`。为什么要这样写,[Day 32](/blog/agent-zero/day-032-modules/) 讲模块时讲清楚。今天你只要知道:直接运行 `main.py`,会打印那句话。

</div>

## uv run:在项目自己的环境里跑

用 `uv run` 运行它:

```text
$ uv run main.py
Using CPython 3.12.15
Creating virtual environment at: .venv
Hello from agent-zero-lab!
$ ls -a
.
..
.git
.gitignore
.python-version
.venv
README.md
main.py
pyproject.toml
uv.lock
$ uv run main.py
Hello from agent-zero-lab!
```

<div class="line-notes">

- `$ uv run main.py` 第一次在这个项目里运行。
- `Using CPython 3.12.15` uv 按 `.python-version` 的 `3.12` 去找 Python,挑中了刚装的 3.12.15。本机同时有 3.12.10(或我的 3.12.13)和 3.12.15 时,uv 优先用它自己装的那个。
- `Creating virtual environment at: .venv` 建了一个叫 `.venv` 的目录,这是**这个项目自己的 Python 环境**:项目的库都装在这里,和别的项目互不干扰,就像每个前端项目有自己的 `node_modules`。明天细讲。
- `Hello from agent-zero-lab!` 程序的输出。
- `.venv` `ls -a` 多出两样东西,一个是 `.venv`,
- `uv.lock` 另一个是 lock 文件,也是明天讲。
- `Hello from agent-zero-lab!` 第二次运行,环境已经有了,uv 不再打印那两行,直接跑。

</div>

`uv run` 每次都做三件事,画出来是这样:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="uv run 的三步:找 pyproject.toml 确定项目;检查 .venv 和依赖是否齐全,不齐就先装;用 .venv 里的 python 运行脚本">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-faint)">$ uv run part01/hello_rich.py</text>
<rect x="20" y="44" width="186" height="100" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="32" y="68" fill="var(--ink)">1. 找项目</text>
<text x="32" y="92" fill="var(--ink-soft)">往上找 pyproject.toml</text>
<text x="32" y="114" fill="var(--ink-soft)">找不到就报错</text>
<line x1="206" y1="94" x2="222" y2="94" stroke="var(--ink-soft)"/><polygon points="222,89 232,94 222,99" fill="var(--ink-soft)"/>
<rect x="234" y="44" width="186" height="100" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="246" y="68" fill="var(--ink)">2. 对齐环境</text>
<text x="246" y="92" fill="var(--ink-soft)">没有 .venv 就建</text>
<text x="246" y="114" fill="var(--ink-soft)">缺的库先装上</text>
<line x1="420" y1="94" x2="436" y2="94" stroke="var(--ink-soft)"/><polygon points="436,89 446,94 436,99" fill="var(--ink-soft)"/>
<rect x="448" y="44" width="172" height="100" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="460" y="68" fill="var(--ink)">3. 运行</text>
<text x="460" y="92" fill="var(--ink-soft)">用 .venv 里的</text>
<text x="460" y="114" fill="var(--ink-soft)">python 跑脚本</text>
<line x1="20" y1="168" x2="620" y2="168" stroke="var(--rule)"/>
<text x="20" y="192" fill="var(--ink-soft)">对照 npm:相当于每次 node 之前自动 npm install 一下,</text>
<text x="20" y="214" fill="var(--ink-soft)">而且用的是项目自己的 node,不是 PATH 里碰巧排第一的那个</text>
</g>
</svg>
<figcaption>uv run 的三步。第 2 步是它和直接敲 python3 最大的区别。</figcaption>
</figure>

## uv add:装第一个第三方库

拿一个看得见效果的库来练手:**rich**,在终端里打印带颜色、带表格的漂亮输出,作用类似前端在 Node 里用的 chalk 加 cli-table。

先建一个放练习代码的目录。这门课的约定是每一部分一个目录,第一部分(Day 0–105)叫 `part01`,代码一律从仓库根目录运行:

```text
$ mkdir part01
```

<div class="line-notes">

- `$ mkdir part01` 在 `agent-zero-lab` 里建 `part01`。以后第一部分的文件都放这里,文件第一行注释写完整路径。

</div>

用 Zed 打开整个仓库(`zed ~/agent-zero-lab`),在 `part01` 里新建 `hello_rich.py`,把 Day 6 周报里的三张计费工单打成一张表:

```python
# agent-zero-lab/part01/hello_rich.py
from rich import print
from rich.table import Table

print("[bold]hello agent[/bold],今天有 [red]3[/red] 张计费工单")

table = Table(title="计费工单")
table.add_column("工单号")
table.add_column("客户")
table.add_column("问题")
table.add_row("T001", "C023", "被扣了两次")
table.add_row("T003", "C015", "月付改年付")
table.add_row("T006", "C007", "Refund request")
print(table)
```

<div class="line-notes">

- `from rich import print` 从 `rich` 这个库里拿出它的 `print`,相当于 JS 的 `import { print } from "rich"`。拿进来以后,这个文件里的 `print` 就是 rich 的版本了,它能认方括号里的样式标记。`import` 的细节 [Day 32](/blog/agent-zero/day-032-modules/) 讲。
- `from rich.table import Table` `rich.table` 是 rich 里面的一个子模块,`Table` 是用来画表格的东西,相当于 `import { Table } from "rich/table"`。
- `print("[bold]hello agent[/bold],今天有 [red]3[/red] 张计费工单")` `[bold]...[/bold]` 加粗,`[red]...[/red]` 红色,写法像 HTML 标签换成了方括号。
- `table = Table(title="计费工单")` 新建一张表,标题是「计费工单」。`table = ...` 是 Day 9 见过的变量,把这张表存起来。`title="计费工单"` 这种「名字=值」的传参方式叫关键字参数,有点像 JS 里传一个 `{ title: "计费工单" }` 对象,[Day 29](/blog/agent-zero/day-029-functions-2/) 讲。
- `table.add_column("工单号")` 加一列。`table.add_column(...)` 和 JS 里调用对象的方法 `table.addColumn(...)` 一样。Python 的习惯是名字用小写加下划线(`add_column`),JS 是驼峰(`addColumn`)。
- `table.add_row("T001", "C023", "被扣了两次")` 加一行,三个值对应三列。
- `print(table)` 用 rich 的 `print` 把整张表画出来。

</div>

还没装 rich,先跑一下,看清楚这个错长什么样:

```text
$ uv run part01/hello_rich.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/hello_rich.py", line 2, in <module>
    from rich import print
ModuleNotFoundError: No module named 'rich'
```

<div class="line-notes">

- `File "/Users/你/agent-zero-lab/part01/hello_rich.py", line 2, in <module>` 第 2 行出事。
- `ModuleNotFoundError: No module named 'rich'` 「找不到叫 rich 的模块」。这是一个运行时错误,对应 Node 的 `Error: Cannot find module 'rich'`。在 Zed 里,`rich` 下面其实早就画上红线了,下一节看。

</div>

装上它:

```text
$ uv add rich
Resolved 5 packages in 6.20s
Downloading pygments (1.2MiB)
 Downloaded pygments
Prepared 4 packages in 5.65s
Installed 4 packages in 39ms
 + markdown-it-py==4.2.0
 + mdurl==0.1.2
 + pygments==2.21.0
 + rich==15.0.0
```

<div class="line-notes">

- `$ uv add rich` 相当于 `npm install rich`:下载、装进项目的环境、写进配置文件。
- `Resolved 5 packages in 6.20s` 「解析」就是算出要装哪些包、各装哪个版本。5 个里有一个是你的项目本身,另外 4 个是要装的。
- `Downloading pygments (1.2MiB)` 只有比较大的包才会单独显示下载进度。
- `Installed 4 packages in 39ms` 下载花了几秒,真正装进去只用了 39 毫秒。uv 快就快在这里。
- `+ markdown-it-py==4.2.0` 你只要了 rich,为什么装了 4 个?因为 rich 自己依赖别的库(处理 Markdown 的 markdown-it-py、给代码上色的 pygments),它们又可能依赖别的(mdurl)。和 npm 装一个包带进来一串一样。这些叫**间接依赖**。
- `+ rich==15.0.0` rich 本身,2026 年 4 月发布的 15.0.0,写这篇时的最新版。`==` 在 Python 版本号里表示「正好是这个版本」。

</div>

`pyproject.toml` 被改了:

```text
$ cat pyproject.toml
[project]
name = "agent-zero-lab"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
    "rich>=15.0.0",
]
```

<div class="line-notes">

- `dependencies = [` 空列表变成了一个有一项的列表。TOML 的列表和 JSON 数组一样用方括号,允许最后一项后面跟逗号。
- `"rich>=15.0.0",` 只记了你直接要的 rich,没有那 3 个间接依赖。`>=15.0.0` 是「15.0.0 或更新」,相当于 npm 默认写的 `^15.0.0`,但不完全一样(npm 的 `^` 不允许升到 16,`>=` 允许),明天细说。间接依赖的精确版本记在 `uv.lock` 里。

</div>

再跑:

```text
$ uv run part01/hello_rich.py
hello agent,今天有 3 张计费工单
             计费工单             
┏━━━━━━━━┳━━━━━━┳━━━━━━━━━━━━━━━━┓
┃ 工单号 ┃ 客户 ┃ 问题           ┃
┡━━━━━━━━╇━━━━━━╇━━━━━━━━━━━━━━━━┩
│ T001   │ C023 │ 被扣了两次     │
│ T003   │ C015 │ 月付改年付     │
│ T006   │ C007 │ Refund request │
└────────┴──────┴────────────────┘
```

<div class="line-notes">

- `hello agent,今天有 3 张计费工单` 在真终端里,`hello agent` 是粗体、`3` 是红色。我这里的输出是存进文件的,颜色没了;rich 发现输出不是直接显示在屏幕上时,会自己关掉颜色(Day 8 讲 `ls` 时也碰到过同样的事)。
- `计费工单` 表格标题自动居中。
- `┃ 工单号 ┃ 客户 ┃ 问题           ┃` 表头。中文占两个字符宽,rich 都替你算好了对齐。
- `│ T006   │ C007 │ Refund request │` 每列宽度按最长的内容自动调整。

</div>

### 不走 uv run 会怎样

很多人第一次用 uv 都会掉进这个坑:装完了,还是习惯性地敲 `python3`。

```text
$ python3 part01/hello_rich.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/hello_rich.py", line 2, in <module>
    from rich import print
ModuleNotFoundError: No module named 'rich'
$ uv run python part01/hello_rich.py
hello agent,今天有 3 张计费工单
             计费工单             
$ uv run python --version
Python 3.12.15
$ python3 --version
Python 3.12.13
```

<div class="line-notes">

- `$ python3 part01/hello_rich.py` 直接用 PATH 里的 `python3`。
- `ModuleNotFoundError: No module named 'rich'` rich 明明装了,还是找不到。因为 rich 装在项目的 `.venv` 里,而 `python3` 是 Day 8 装的那个全局 Python,它根本不知道 `.venv` 的存在。这和你在一个项目里 `npm install` 了某个包,却跑到另一个目录用全局的 node 去 require 它,是一个道理。
- `$ uv run python part01/hello_rich.py` `uv run` 后面也可以先写 `python` 再写文件,效果一样,这是课里以后统一的写法(和 Day 33 之后的 `-m` 运行方式配套)。我只截了前两行。
- `Python 3.12.15` `uv run python` 用的是项目环境里的 Python。
- `Python 3.12.13` 直接敲 `python3` 是另一个 Python(我这里是 3.12.13,你那边是 3.12.10)。两个版本号不一样,就是「不是同一个 Python」最直接的证据。

</div>

记住一句话:**在 uv 项目里,运行任何东西前面都加 `uv run`**。`ModuleNotFoundError` 的第一反应是问自己两个问题:装了没有(`pyproject.toml` 里有没有它)?用的是不是项目的 Python(前面有没有 `uv run`)?

### Zed 里的红线也要「选对 Python」

Day 9 说过,basedpyright 要知道你的 Python 在哪,才能知道有哪些库。用 `zed ~/agent-zero-lab` 打开仓库时,[Zed 的 Python 文档](https://zed.dev/docs/languages/python)说它对大多数项目会自动选对环境,也就是项目里的 `.venv`。选错了会怎样?我用 Zed 下载的那个 basedpyright,分别指定两个不同的 Python 检查 `hello_rich.py`:

```text
指定全局的 python3:
hello_rich.py:2:6 - error: Import "rich" could not be resolved (reportMissingImports)
hello_rich.py:3:6 - error: Import "rich.table" could not be resolved (reportMissingImports)
2 errors, 0 warnings, 0 notes
指定 .venv/bin/python:
0 errors, 0 warnings, 0 notes
```

<div class="line-notes">

- `Import "rich" could not be resolved (reportMissingImports)` 「找不到 rich 这个 import」。用全局 Python 的视角看,rich 确实不存在,这条红线和运行时的 `ModuleNotFoundError` 是同一件事。
- `0 errors, 0 warnings, 0 notes` 换成项目环境的 Python,一条都没有。

</div>

所以在 Zed 里看到 `Import "xxx" could not be resolved`,而你确定已经 `uv add` 过,多半是 Zed 选错了 Python:看一眼状态栏上显示的 Python 环境,点它可以换成项目的 `.venv`。另一个常见原因是你是在 `uv add` 之前打开的项目,刚建出来的 `.venv` 编辑器还没发现,在命令面板里重启一下语言服务器(搜 `restart language server`)或者重开窗口就好。

## uv add --dev 和 uv remove

前端项目里,ESLint、Prettier、TypeScript 这种「写代码时用、程序运行时不需要」的东西,装成 devDependencies。Python 一样。Day 9 用的 Ruff 是 Zed 自己下载的,现在把它也装进项目,这样在命令行、在以后的自动检查里,用的都是同一个版本:

```text
$ uv add --dev ruff
Resolved 6 packages in 8.56s
Downloading ruff (9.8MiB)
 Downloaded ruff
Prepared 1 package in 22.93s
Installed 1 package in 7ms
 + ruff==0.17.1
$ tail -6 pyproject.toml
]

[dependency-groups]
dev = [
    "ruff>=0.17.1",
]
```

<div class="line-notes">

- `$ uv add --dev ruff` `--dev` 相当于 npm 的 `-D`。
- `+ ruff==0.17.1` 0.17.1,和 Day 9 里 Zed 下载的是同一个版本。
- `[dependency-groups]` 新出现的一段:依赖分组。
- `dev = [` 一个叫 `dev` 的组,对应 `package.json` 里的 `devDependencies`。

</div>

装进项目的命令行工具,也用 `uv run` 运行:

```text
$ uv run ruff --version
ruff 0.17.1
$ uv run ruff check
All checks passed!
$ uv run ruff format
3 files left unchanged
$ ruff --version
zsh: command not found: ruff
```

<div class="line-notes">

- `$ uv run ruff --version` `uv run` 后面可以跟任何命令,它会在项目环境里找这个命令。相当于 `npx ruff` 或 `npm exec ruff`(用项目 `node_modules/.bin` 里的那个,Day 7 讲过)。
- `$ uv run ruff check` 不写文件名,就检查整个项目。
- `All checks passed!` `main.py` 和 `hello_rich.py` 都没问题。
- `3 files left unchanged` 格式化检查了 3 个文件:两个 `.py`,还有 `pyproject.toml`,新版本的 Ruff 也会排 TOML 文件。都已经是整齐的,没改。
- `zsh: command not found: ruff` 不加 `uv run` 就找不到,因为 `ruff` 装在 `.venv/bin/` 里,那个目录不在 PATH 上。这和前端里项目装了 eslint,直接敲 `eslint` 也找不到是一回事。

</div>

删依赖用 `uv remove`。装一个试试再删掉,顺便看看间接依赖会不会一起走:

```text
$ uv add requests
Resolved 11 packages in 7.54s
Prepared 5 packages in 4.06s
Installed 5 packages in 40ms
 + certifi==2026.10.19
 + charset-normalizer==3.5.2
 + idna==3.20
 + requests==2.34.2
 + urllib3==2.8.0
$ uv remove requests
Resolved 6 packages in 14ms
Uninstalled 5 packages in 24ms
 - certifi==2026.10.19
 - charset-normalizer==3.5.2
 - idna==3.20
 - requests==2.34.2
 - urllib3==2.8.0
```

<div class="line-notes">

- `$ uv add requests` requests 是 Python 最老牌的 HTTP 客户端库,相当于前端的 axios。这门课后面用的是另一个叫 httpx 的,这里只是拿它演示。
- `+ requests==2.34.2` 一个 requests 带进来 4 个间接依赖。
- `$ uv remove requests` 相当于 `npm uninstall requests`。
- `Uninstalled 5 packages in 24ms` requests 和它带来的 4 个一起删了,因为没有别的包再需要它们。`pyproject.toml` 也改回了原样。

</div>

## 拼起来:从零建好这门课的仓库

把今天的步骤按顺序串成一份清单。如果你中间哪一步弄乱了,删掉 `~/agent-zero-lab` 照着这份从头来一遍,也就两分钟:

```text
$ cd ~
$ uv init --no-package agent-zero-lab --python 3.12
$ cd agent-zero-lab
$ mkdir part01
$ uv add rich
$ uv add --dev ruff
$ uv run main.py
Hello from agent-zero-lab!
$ uv run python part01/hello_rich.py
```

<div class="line-notes">

- `$ cd ~` 仓库放在家目录下,以后课里写 `~/agent-zero-lab` 就是它。
- `$ uv init --no-package agent-zero-lab --python 3.12` 别忘了 `--no-package`。
- `$ mkdir part01` 第一部分的代码目录。
- `$ uv add rich` 今天的第三方库。
- `$ uv add --dev ruff` 开发工具。
- `$ uv run python part01/hello_rich.py` 从仓库根目录运行。`hello_rich.py` 要你自己在编辑器里写好。

</div>

| 今天的零件 | 在上面哪一步 |
| --- | --- |
| 装 uv,`~/.local/bin` 进 PATH | `curl ... \| sh`、`.zshrc` 末尾那行 |
| uv 管 Python 版本 | `uv python install 3.12` |
| `uv init --no-package` ≈ `npm init` | 建 `agent-zero-lab` |
| `pyproject.toml` ≈ `package.json` | `dependencies`、`requires-python` |
| `uv add` ≈ `npm install` | `uv add rich` |
| `uv add --dev` ≈ `npm i -D` | `uv add --dev ruff` |
| `uv run` = 找项目 + 对齐环境 + 运行 | `uv run python part01/hello_rich.py` |
| 不加 `uv run` 就是别的 Python | `python3 part01/hello_rich.py` 报 `ModuleNotFoundError` |
| `uv remove` ≈ `npm uninstall` | 装了又删的 requests |

## 动手练习

### 练习 1:一个只为好玩的小项目

在 `~/terminal-practice/day10/` 下面建一个独立的 uv 项目 `moo`,装上 `cowsay` 这个库,写一个 `moo.py`,让一头牛说「工单 T001 已处理」。cowsay 的用法:`import cowsay` 之后调用 `cowsay.cow("要说的话")`。

<details><summary>参考答案</summary>

```text
$ mkdir -p ~/terminal-practice/day10 && cd ~/terminal-practice/day10
$ uv init --no-package moo --python 3.12
Initialized project `moo` at `/Users/你/terminal-practice/day10/moo`
$ cd moo
$ uv add cowsay
Using CPython 3.12.15
Creating virtual environment at: .venv
Resolved 2 packages in 4.92s
Prepared 1 package in 2.74s
Installed 1 package in 7ms
 + cowsay==6.1
```

<div class="line-notes">

- `$ mkdir -p ~/terminal-practice/day10 && cd ~/terminal-practice/day10` `&&` 表示前一条成功了才执行后一条(Day 5)。
- `$ uv init --no-package moo --python 3.12` 每个项目一个目录,每个目录一份 `pyproject.toml`。练习项目和 `agent-zero-lab` 互不相干。
- `Creating virtual environment at: .venv` 这次是 `uv add` 时顺手建了环境,因为装库总得有地方放。
- `+ cowsay==6.1` cowsay 不依赖别的库,只装了它自己。

</div>

```python
# terminal-practice/day10/moo/moo.py
import cowsay

cowsay.cow("工单 T001 已处理")
```

<div class="line-notes">

- `import cowsay` 这次用的是 `import 库名`,不是 `from 库 import 名字`。整个库拿进来,用的时候写 `cowsay.xxx`,相当于 JS 的 `import * as cowsay from "cowsay"`。
- `cowsay.cow("工单 T001 已处理")` 调用库里的 `cow` 函数。

</div>

```text
$ uv run moo.py
  ___________
| 工单 T001 已处理 |
  ===========
           \
            \
              ^__^
              (oo)\_______
              (__)\       )\/\
                  ||----w |
                  ||     ||
```

<div class="line-notes">

- `| 工单 T001 已处理 |` 气泡的边框没对齐,因为 cowsay 按「一个字一格」算宽度,而中文在终端里占两格。rich 处理了这个问题(上面的表格是齐的),cowsay 没处理。这是第三方库质量不一的一个小例子,不影响什么。

</div>

</details>

### 练习 2:在哪个目录跑,结果不一样

在 `agent-zero-lab` 里装好 rich 之后,分别在下面三个位置运行,先猜哪个会成功,再跑:

1. `cd ~/agent-zero-lab/part01`,然后 `uv run hello_rich.py`
2. `cd ~`,然后 `uv run agent-zero-lab/part01/hello_rich.py`
3. `cd ~`,然后 `uv run python agent-zero-lab/part01/hello_rich.py`

<details><summary>参考答案</summary>

```text
$ cd ~/agent-zero-lab/part01
$ uv run hello_rich.py | head -1
hello agent,今天有 3 张计费工单
$ cd ~
$ uv run agent-zero-lab/part01/hello_rich.py | head -1
hello agent,今天有 3 张计费工单
$ uv run python agent-zero-lab/part01/hello_rich.py
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/hello_rich.py", line 2, in <module>
    from rich import print
ModuleNotFoundError: No module named 'rich'
```

<div class="line-notes">

- `$ uv run hello_rich.py | head -1` 第 1 种成功。在 `part01` 里,uv 往上一级找到了 `agent-zero-lab/pyproject.toml`。和 npm 在子目录里也能找到上层的 `package.json` 一样。
- `$ uv run agent-zero-lab/part01/hello_rich.py | head -1` 第 2 种也成功,这个我第一次也猜错了。`uv run 文件.py` 这种写法,uv 会**从脚本所在的目录**往上找项目,所以站在哪都行。用 `uv run -v` 能看到它的日志里写着 `Found project root: /Users/你/agent-zero-lab`。
- `$ uv run python agent-zero-lab/part01/hello_rich.py` 第 3 种失败。这次 `uv run` 后面跟的命令是 `python`,uv 不知道后面那个文件和项目有什么关系,只能从**当前目录**往上找。家目录里没有 `pyproject.toml`,uv 就不进任何项目环境,用了一个没有 rich 的 Python。

</div>

这就是课里约定「永远在仓库根目录运行」的原因:规矩简单,不用记 uv 在哪种写法下从哪找项目。

</details>

### 练习 3:uvx,不装进项目临时用一下

前端里你可能用过 `npx create-vite` 这种「用一次就走」的命令。uv 对应的是 `uvx`。在**家目录**(不在任何项目里)让牛说一句 `hello uvx`。cowsay 库自己带了一个命令行程序,用法是 `cowsay -t "要说的话"`。

<details><summary>参考答案</summary>

```text
$ cd ~
$ uvx cowsay -t "hello uvx"
Installed 1 package in 37ms
  _________
| hello uvx |
  =========
         \
          \
            ^__^
            (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||
```

<div class="line-notes">

- `$ uvx cowsay -t "hello uvx"` `uvx` 是 `uv tool run` 的简写:临时建一个只给这个工具用的环境,把 cowsay 装进去,运行它的命令行程序。家目录里没有项目也没关系。
- `Installed 1 package in 37ms` 只用了 37 毫秒,因为练习 1 已经下载过 cowsay,uv 有缓存(明天讲)。第一次用的话会先下载。

</div>

`uvx` 不会改任何项目的 `pyproject.toml`。什么时候用 `uvx`,什么时候用 `uv add --dev`?只是自己临时用一下,用 `uvx`;项目要靠它(比如 Ruff 要检查这个项目的每次改动),就装进项目,让所有人用同一个版本。

</details>

### 练习 4:包名拼错会怎样

在 `agent-zero-lab` 里,故意把 rich 拼错装一下:`uv add rihc`,再试 `uv add ritch`。读懂报错,然后想一想:如果某个拼错的名字**恰好有人注册了**,会发生什么?

<details><summary>参考答案</summary>

```text
$ uv add rihc
error: Failed to add dependencies
  cause: No solution found when resolving dependencies
  cause: Because rihc was not found in the package registry and your project depends on rihc, we can conclude that your project's requirements are unsatisfiable.

hint: If you want to add the package regardless of the failed resolution, provide the `--frozen` flag to skip locking and syncing
$ uv add ritch
error: Failed to add dependencies
  cause: No solution found when resolving dependencies
  cause: Because ritch was not found in the package registry and your project depends on ritch, we can conclude that your project's requirements are unsatisfiable.

hint: If you want to add the package regardless of the failed resolution, provide the `--frozen` flag to skip locking and syncing
```

<div class="line-notes">

- `error: Failed to add dependencies` 加依赖失败。uv 的报错是一层层 `cause` 往下说原因,最底下那层最具体。
- `Because rihc was not found in the package registry` 「在包仓库里没找到 rihc」。Python 的包仓库叫 PyPI(pypi.org),相当于 npm 的 registry。
- `we can conclude that your project's requirements are unsatisfiable` 「所以你的项目需求无法满足」。这句是 uv 的依赖求解器在说话,措辞像数学证明,以后版本冲突时你会经常看到这种「Because ... and ..., we can conclude ...」的句式。
- `hint: If you want to add the package regardless` 提示你可以强行写进配置。别这么做。失败的时候 `pyproject.toml` 没有被改,可以 `cat` 一下确认。

</div>

这两个名字恰好没人注册,所以只是报错。危险的是另一种情况:有人专门注册和热门库名字很像的包(比如把字母调换一下),里面放上偷密钥的代码,等你手滑。这种攻击叫 typosquatting(抢注错拼名),npm 和 PyPI 上都发生过很多次。养成习惯:`uv add` 之前看一眼拼写,装完看一眼 `+` 开头的那几行是不是你预期的包。第七部分讲供应链安全时会再回来讲这件事。

</details>

验收标准:`which uv` 打印 `~/.local/bin/uv`;`~/agent-zero-lab` 里有 `pyproject.toml`、`main.py`、`.python-version`、`part01/hello_rich.py`,**没有** `src` 目录;`pyproject.toml` 里 `dependencies` 有 rich、`dev` 组有 ruff;在仓库根目录 `uv run python part01/hello_rich.py` 能打印出那张表;能说出 `python3 part01/hello_rich.py` 为什么报 `ModuleNotFoundError`;不看文章能写出「npm 对照 uv」表里的前七行。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| uv | Astral 用 Rust 写的 Python 项目管理工具,装 Python、建环境、装依赖、锁版本、运行都管,相当于 nvm + npm + npx |
| uvx | `uv tool run` 的简写,不装进项目,临时跑一个 Python 命令行工具,相当于 npx |
| 第三方库 / 包(package) | 别人写好、发布出来给大家用的代码,如 rich、requests。Python 里「库」和「包」常混着说 |
| PyPI | Python 的公共包仓库(pypi.org),相当于 npm registry。`uv add` 默认从这里下载 |
| `pyproject.toml` | Python 项目的配置文件,写项目名、Python 版本要求、依赖,相当于 `package.json` |
| TOML | 一种配置文件格式,`键 = 值`,`[段名]` 分段,可以写 `#` 注释 |
| `.python-version` | 记录项目用哪个 Python 版本的文件,相当于 `.nvmrc` |
| `uv init --no-package` | 建一个不打包的项目(平铺结构、有 `main.py`)。uv 0.12 起默认建打包项目,这门课用这个参数 |
| 依赖(dependency) | 项目运行需要的第三方库,写在 `dependencies` 里 |
| 开发依赖(dev dependency) | 只在写代码、检查、测试时用的工具,写在 `[dependency-groups]` 的 `dev` 里,相当于 devDependencies |
| 间接依赖 | 你要的库自己又依赖的库,如 rich 带来的 pygments。uv 自动装,不写进 `pyproject.toml` |
| `uv run` | 找到项目、把环境对齐(没有就建、缺了就装)、再用项目的 Python 运行命令 |
| 虚拟环境(`.venv`) | 项目自己的 Python 环境,项目的库都装在里面。今天露面,明天细讲 |
| `ModuleNotFoundError` | import 一个找不到的模块时的运行时错误。要么没装,要么用错了 Python |
| `from 库 import 名字` | 从库里拿出指定的东西,相当于 `import { 名字 } from "库"`(Day 32 细讲) |
| python-build-standalone | 社区编译好的、可以直接解压使用的 Python,uv 下载的就是它 |
| typosquatting | 抢注和热门包名字很像的包名、在里面放恶意代码的攻击方式 |

## 常见误区

**照着老教程敲 `uv init`,得到一个 `src` 目录。** uv 0.12(2026-07-28)把默认改成了打包项目。这门课的仓库要 `uv init --no-package`。已经建错了,`rm -rf` 掉重建最省事。

**装完 uv 在原来的窗口里敲 `uv`,报 command not found。** 安装脚本改的是 `.zshrc`,已经开着的窗口不会重读。重开终端,或者在当前窗口执行 `source ~/.local/bin/env`。和 Day 7、Day 8 是同一件事。

**在家目录里 `uv add`。** 报 `No pyproject.toml found`。uv 要先有项目。先 `cd` 进项目目录。

**装好了库,用 `python3` 跑,报 `ModuleNotFoundError`。** 库装在项目的 `.venv` 里,全局的 `python3` 看不见。前面加 `uv run`。

**在项目外面 `uv run python 某个项目里的文件`。** `uv run python ...` 从当前目录找项目,不从文件所在的目录找。课里统一在仓库根目录运行。

**Zed 里 import 标红,以为没装上。** 先确认 `pyproject.toml` 里有这个库、命令行 `uv run` 能跑;能跑就是编辑器选错了 Python 或者没发现新建的 `.venv`,在状态栏切到项目环境,或重启语言服务器。

**想用 `pip install`。** 网上很多教程写 `pip install rich`,在 uv 项目里别这么做:pip 装的东西不会写进 `pyproject.toml`,换台机器就没了,而且很可能装到全局 Python 里去。一律 `uv add`。明天会实际演示 pip 在 uv 的环境里是什么情况。

**包名拼错不当回事。** 报 `not found` 是运气好。拼错的名字如果被人抢注了,装进来的就是别人的代码。装完看一眼 `+` 开头那几行。

## 学习资料

### 文档与文章

- [uv 官方文档](https://docs.astral.sh/uv/):英文,首页一张表列了 uv 能替代的工具,和今天的对照表一个思路。
- [uv 文档 · 安装](https://docs.astral.sh/uv/getting-started/installation/):英文,今天那条 `curl ... | sh` 的出处,还有 Homebrew 等其他装法、怎么卸载。
- [uv 文档 · Working on projects](https://docs.astral.sh/uv/guides/projects/):英文,`uv init`、`uv add`、`uv run` 的官方入门,今天的正文基本就是这一页的展开。
- [uv 文档 · Creating projects](https://docs.astral.sh/uv/concepts/projects/init/):英文,讲 `uv init` 的几种项目类型(application、packaged application、library),以及 `--no-package` 是什么意思。
- [uv 0.12 更新日志](https://github.com/astral-sh/uv/blob/main/changelogs/0.12.x.md):英文,第一条「Define build systems by default with `uv init`」就是正文那个坑的出处。
- [uv 中文文档](https://uv.doczh.com/):社区翻译的中文版,读英文吃力时用。是非官方翻译,可能比英文版落后,命令行为以英文文档和你实际看到的为准。
- [PyPI · rich](https://pypi.org/project/rich/):rich 在 PyPI 上的页面。每个 Python 包都有这样一页,`uv add` 之前可以先来看看:名字对不对、最近什么时候更新、下载量多少,和你在 npmjs.com 上看包是一个习惯。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13WGHz8EEz&autoplay=0&high_quality=1" title="从pip到uv：一口气梳理现代Python项目管理全流程！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · 从pip到uv:一口气梳理现代Python项目管理全流程! · 16 分钟,2025 年 7 月,播放 26 万多。从 pip、venv 讲到 uv,讲清楚「为什么 Python 以前那么乱、uv 解决了什么」。视频里的 uv 是 0.12 之前的,`uv init` 生成的是 `main.py`,和我们加了 `--no-package` 之后一样。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HLGN6DEQj&autoplay=0&high_quality=1" title="新手必看！Python包管理神器 UV" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · 新手必看!Python包管理神器 UV · 24 分钟,2026 年 7 月。手把手演示安装、建项目、装包、运行,节奏慢,适合跟着敲。今天看前半段就够,后面讲虚拟环境的部分明天再看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/AMdG7IjgSPM" title="Python Tutorial: UV - A Faster, All-in-One Package Manager to Replace Pip and Venv" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: UV - A Faster, All-in-One Package Manager to Replace Pip and Venv · 英文,可开自动字幕。Day 8 推荐过他的 Python 入门系列,这期专讲 uv,先用老办法(pip + venv)做一遍,再用 uv 做一遍,对比很清楚。视频里也是 0.12 之前的版本。</figcaption>
</figure>

### 书籍

- Claudio Jolowicz《Hypermodern Python Tooling》,O'Reilly,2024。讲现代 Python 项目的整套工具链:装 Python、虚拟环境、pyproject.toml、依赖管理、测试、检查,书里也写到了 uv。适合把这几天学的东西串起来理解。uv 变化很快,书里的具体命令以官方文档为准。
- uv 太新了,还没有专门讲它的中文书。中文入门书里的「用 pip 安装第三方库」一章,读的时候把 `pip install xxx` 换成 `uv add xxx` 就行。

### 开源项目与代码

- [astral-sh/uv](https://github.com/astral-sh/uv):uv 的源代码和问题跟踪。遇到奇怪的报错,把报错原文贴到 issues 里搜,常能找到别人问过的。`changelogs/` 目录是每个版本改了什么。
- [Textualize/rich](https://github.com/Textualize/rich):rich 的源代码。README 里有一张效果截图,能看到 rich 除了表格还能画进度条、语法高亮、树形结构,以后课里做命令行小工具会用到其中一些。

## 自测

1. 你在 `~/agent-zero-lab` 里 `uv add httpx` 成功了,然后 `python3 part01/demo.py` 报 `ModuleNotFoundError: No module named 'httpx'`。为什么?怎么改?

<details><summary>答案</summary>

httpx 装在项目的 `.venv` 里,`python3` 是全局的 Python(Day 8 装的 3.12.10),看不到项目环境里的库。改成 `uv run python part01/demo.py`,让 uv 用项目的 Python 运行。

</details>

2. 下面每条 npm 命令,对应的 uv 命令是什么?`npm init`、`npm install rich`、`npm install -D ruff`、`npm uninstall rich`、`npx cowsay hi`。

<details><summary>答案</summary>

`uv init --no-package 项目名`(这门课的写法)、`uv add rich`、`uv add --dev ruff`、`uv remove rich`、`uvx cowsay -t hi`。

</details>

3. 同事照着一篇 2025 年的教程 `uv init demo`,发现目录里没有 `main.py`,多了 `src/demo/__init__.py`,问你是不是 uv 装坏了。你怎么解释?

<details><summary>答案</summary>

没坏。uv 0.12(2026 年 7 月)把 `uv init` 的默认改成了「可打包的项目」:代码放在 `src/项目名/`,`pyproject.toml` 里多了 `[build-system]` 和 `[project.scripts]`。教程是旧版本的行为。想要旧的平铺结构,用 `uv init --no-package demo`。

</details>

4. `pyproject.toml` 的 `dependencies` 里只有 `"rich>=15.0.0"` 一行,可 `uv add rich` 的输出装了 4 个包。另外 3 个是什么?记在哪?

<details><summary>答案</summary>

是 rich 自己依赖的库(markdown-it-py、pygments,以及 markdown-it-py 依赖的 mdurl),叫间接依赖。`pyproject.toml` 只记你直接要的;所有包(含间接依赖)的精确版本记在 `uv.lock` 里,明天讲。

</details>

5. 面试题:为什么 Python 社区这两年普遍从 pip 换到了 uv?说两三点你自己的理解。

<details><summary>答案</summary>

一是一个工具管完全部:装 Python 版本、建虚拟环境、装依赖、锁版本、运行命令,以前要 pyenv、venv、pip、pip-tools/poetry、pipx 好几个工具配合,新人很容易装错地方。二是快:Rust 写的,有全局缓存,装依赖比 pip 快很多,CI 里省时间。三是默认就可复现:`uv add` 自动更新 `pyproject.toml` 和 `uv.lock`,`uv run` 每次运行前都对齐环境,不容易出现「我这能跑你那不能跑」。可以补一句代价:它是一家商业公司主导的项目,版本变化快(比如 0.12 改了 `uv init` 的默认),团队要锁定 uv 版本、留意更新日志。

</details>

## 明天预告

Day 11 · uv(二):虚拟环境、pyproject.toml 和 uv.lock。今天两次一闪而过的 `.venv` 和 `uv.lock`,明天打开看:`.venv` 里到底装了什么、为什么它就是 Python 的 `node_modules`、`source .venv/bin/activate` 背后又是 Day 7 的 PATH;`uv.lock` 和 `package-lock.json` 一样锁住了每个包的精确版本。最后把 `.venv` 整个删掉,用 `uv sync` 一秒钟原样恢复,这是你以后换电脑、拉别人项目时每次都要做的事。
