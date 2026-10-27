---
title: 'Day 441 · 搭骨架(一):建仓库,uv、ruff、pytest、pre-commit'
description: '毕业项目第一次真正动手:用 uv init --package 建 supportpilot 仓库,装运行依赖和开发工具,配好 ruff 和 pytest 并各让它们抓一次错,再装 pre-commit 让每次 git commit 前自动检查。过程中真的撞到一个坑:最新版 pre-commit 在老 git 上直接报错。最后按 Day 438 的方块表建目录、把 PRD 复制进 docs/,用 check_arch.py 检查仓库和架构图是不是一个东西,并从新克隆验证同事拿到仓库能不能一键跑起来。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'supportpilot', 'uv', 'ruff', 'pytest', 'pre-commit', 'agent-zero']
series: 'agent-zero'
day: 441
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 440](/blog/agent-zero/day-440-week63-review/) 是第 63 周复习:默写了滑动窗口限流和相对 import 的换算,写了 `review63.py` 让 PRD、方块表、排期、成本四份文件互相对账,又算出一个让人意外的数字:限流挡不住总花费,一个 IP 在限流以内一天也能让你花近 200 块,所以每日预算那一层不能少。

纸上的东西到此为止。需求、PRD、架构表、日历、预算都有了,今天第一次建**真正的仓库**。这一天不写任何业务代码,只做一件事:让后面 56 天每次提交的代码,都自动经过同一套检查。仓库刚建好、还是空的时候装检查最便宜,等代码写了两周再补,会一次冒出几百条报错。

## 今天要解决的问题

今天的新东西是两个:**ruff**(一个同时管查错和排版的工具)和 **pre-commit**(在 `git commit` 前自动跑检查)。uv 和 pytest 前面学过([Day 10](/blog/agent-zero/day-010-uv-1/)、[Day 71](/blog/agent-zero/day-071-pytest-1/)),今天只是把它们配进一个新项目。学完你应该能:

1. 用 `uv init --package` 建出 `~/supportpilot`,说清 `pyproject.toml`、`uv.lock`、`.venv`、`src/` 各管什么,以及为什么毕业项目要建成「可安装的包」。
2. 用 `uv add` 装运行依赖、用 `uv add --dev` 装开发工具,说出两者的区别,并知道为什么今天只装现在要用的依赖。
3. 配好 ruff 和 pytest,让它们各抓一次故意写错的代码。
4. 装好 pre-commit,让违规的提交被拦下;遇到「最新版 pre-commit 在老 git 上报错」时知道怎么诊断、怎么绕。
5. 按 Day 438 的方块表建出目录,把 PRD 复制进 `docs/PRD.md`,用 `check_arch.py --day 441` 证明建出来的仓库和架构图对得上。

今天会调模型 0 次,不花钱;要联网下载依赖和 pre-commit 的钩子仓库(GitHub),如果你在国内要确认终端能访问 GitHub,我自己是靠代理才下载成功的。预计用时 3 小时。前置:[Day 10](/blog/agent-zero/day-010-uv-1/)、[Day 11](/blog/agent-zero/day-011-uv-2/) 的 uv;[Day 53](/blog/agent-zero/day-053-env-secrets/) 的 `.env` 和 `.gitignore`;[Day 56](/blog/agent-zero/day-056-git-1/) 到 [Day 58](/blog/agent-zero/day-058-git-3/) 的 git;[Day 71](/blog/agent-zero/day-071-pytest-1/) 到 [Day 74](/blog/agent-zero/day-074-pytest-4/) 的 pytest;[Day 437](/blog/agent-zero/day-437-prd/) 的 PRD;[Day 438](/blog/agent-zero/day-438-architecture/) 的 `arch.py`、`check_arch.py`,以及 [Day 439](/blog/agent-zero/day-439-schedule-cost/) 对 `arch.py` 的两处修改。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `pyproject.toml` 里 ruff 和 pytest 两段配置、`.pre-commit-config.yaml` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:新项目开工第一天

你开一个新前端项目的第一天,大概会做这些:`npm init`,装 `eslint`、`prettier`、`typescript`、`vitest`,写 `.eslintrc`,再装 `husky` 加 `lint-staged`,让每次 `git commit` 前自动跑 lint,不合规的提交过不去。这一天不产出功能,但它决定了以后三个月代码的下限。

Python 这边是同一套,工具换了名字:

| 前端 | Python(今天) | 管什么 |
| --- | --- | --- |
| `package.json` | `pyproject.toml` | 项目名、依赖、各个工具的配置 |
| `package-lock.json` | `uv.lock` | 锁定每个包的确切版本 |
| `node_modules` | `.venv` | 装依赖的目录,不进 git |
| `devDependencies` | `[dependency-groups]` 里的 `dev` | 只在开发时用的包 |
| `npm` / `pnpm` | `uv` | 装包、跑命令 |
| ESLint | `ruff check` | 查错 |
| Prettier | `ruff format` | 统一排版 |
| `tsc` | `basedpyright` | 类型检查 |
| Vitest / Jest | `pytest` | 测试 |
| husky + lint-staged | `pre-commit` | commit 前自动跑检查 |

ruff 一个工具顶了 ESLint 加 Prettier 两个,而且是 Rust 写的,跑起来很快,所以大家习惯让它在每次保存和提交时都跑一遍。

## 第一步:建项目

在家目录下建,和 `~/agent-zero-lab` 并排,**不要建在练习仓库里面**:毕业项目是一个独立仓库,要有自己的 git 历史,最后要放到 GitHub 上给面试官看。

```bash
cd ~
uv init --package supportpilot --python 3.12
cd supportpilot
```

```text
$ uv init --package supportpilot --python 3.12
Initialized project `supportpilot` at `/Users/你/supportpilot`
$ ls -a
.
..
.git
.gitignore
.python-version
README.md
pyproject.toml
src
$ find src
src
src/supportpilot
src/supportpilot/__init__.py
```

三件事值得停一下。

第一,`--package`。Day 10 建练习仓库时用的是 `--no-package`:那里只是一堆脚本,从仓库根目录运行就行。毕业项目不一样,后面的 `scripts/`、`tests/`、`scratch/` 里到处要写 `from supportpilot.agent.graph import build_graph`,要让 `supportpilot` 在任何目录下都能 `import`,就得把它当成一个**可安装的包**。新版 uv 默认就是这种项目,写 `--package` 是把意图写明白,和 Day 10 的 `--no-package` 对着看。

第二,`src/supportpilot/` 这个目录结构叫 **src 布局**:代码放在 `src/包名/` 下面,不放在仓库根目录。好处是测试跑的一定是「装好的包」,不会因为当前目录碰巧能 import,把打包问题盖住。前端里对应的是:你不会从 `src/` 里 `import '../../utils'` 然后期望发布到 npm 之后还能用。

第三,`uv init` 没有建 `main.py`,而是建了包目录加一个 `README.md`、`.python-version`、`pyproject.toml` 和一个 `.git`。`.git` 是它顺手 `git init` 的,所以后面不用再 `git init`。

`pyproject.toml` 现在长这样(`authors` 那一行是 uv 从你的 git 配置里读的名字和邮箱,所以你看到的是你自己的):

```toml
[project]
name = "supportpilot"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
authors = [
    { name = "Xiao Ming", email = "xiaoming@example.com" }
]
requires-python = ">=3.12"
dependencies = []

[project.scripts]
supportpilot = "supportpilot:main"

[build-system]
requires = ["uv_build>=0.13.0,<0.14.0"]
build-backend = "uv_build"
```

<div class="line-notes">

- `name = "supportpilot"` 包名。`import supportpilot` 用的就是这个名字,所以要和 `src/` 下的目录同名。
- `requires-python = ">=3.12"` 要求 Python 3.12 以上,uv 会据此挑解释器,和 `.python-version` 里的 `3.12` 对应。
- `dependencies = []` 运行时依赖,现在是空的,下一步 `uv add` 会往里写。相当于 `package.json` 里的 `dependencies`。
- `[project.scripts]` 声明命令行入口:装好以后敲 `supportpilot` 就会执行 `supportpilot` 包里的 `main()`。我们的 Agent 不是命令行程序,所以下面把这一段删掉。
- `[build-system]` 告诉工具怎么把这个项目打成包。`uv_build` 是 uv 自己的构建后端,零配置,够用。

</div>

先跑一下 uv 给的样板,顺便撞一个坑:

```bash
uv run supportpilot
python3 -c "import supportpilot"
uv run python -c "import supportpilot; print(supportpilot.__file__)"
```

```text
$ uv run supportpilot
Using CPython 3.12.13
Creating virtual environment at: .venv
   Building supportpilot @ file:///Users/你/supportpilot
      Built supportpilot @ file:///Users/你/supportpilot
Installed 1 package in 3ms
Hello from supportpilot!
$ python3 -c "import supportpilot"
ModuleNotFoundError: No module named 'supportpilot'
$ uv run python -c "import supportpilot; print(supportpilot.__file__)"
/Users/你/supportpilot/src/supportpilot/__init__.py
```

看三处。`uv run` 先做了一件事:创建 `.venv`、构建项目、把它**装进** `.venv`(`Installed 1 package`),然后才运行,所以 `Hello from supportpilot!` 出来了。第二条用系统的 `python3` 去 import,报 `ModuleNotFoundError`,因为系统 Python 没装它,和你在项目外面直接 `node -e "require('left-pad')"` 一样。第三条用 `uv run python` 就能 import,而且 `__file__` 指向的是 `src/supportpilot/__init__.py` 本身,不是复制出来的一份,这叫**可编辑安装**:你改源码,不用重新安装就生效。

(上面输出里的路径,在你电脑上是 `/Users/你/supportpilot/...`。)

我们不需要那个命令行入口。把 `[project.scripts]` 那两行连同空行一起删掉,`description` 改成一句话,再把 `src/supportpilot/__init__.py` 换成下面这样:

```toml
description = "云簿 CloudLedger 的智能客服工单 Agent(毕业项目)"
```

<div class="line-notes">

- `description = "云簿 CloudLedger 的智能客服工单 Agent(毕业项目)"` 替换原来的 `Add your description here`。以后推到 GitHub 或打包,这句话就是项目简介。

</div>

```python
# supportpilot/src/supportpilot/__init__.py
"""SupportPilot:云簿 CloudLedger 的智能客服工单 Agent。"""

__version__ = "0.1.0"
```

<div class="line-notes">

- `"""SupportPilot:云簿 CloudLedger 的智能客服工单 Agent。"""` 模块文档字符串,放在文件第一行。`help(supportpilot)` 或编辑器悬停时会显示它。
- `__version__ = "0.1.0"` 约定俗成的版本号变量,和 `pyproject.toml` 里的 `version` 保持一致。Day 434 里 `/healthz` 返回版本号,就是为了部署后一眼看出新代码有没有上去,这里先把位置留好。

</div>

## 第二步:装依赖

分两类。**运行依赖**是程序跑起来必须有的,装进 `dependencies`;**开发依赖**只在写代码、测试、检查时用,线上不需要,装进单独的一组。

先装运行依赖。原则是**只装今天到后面几天要用的**,别的哪天用到哪天装:

| 包 | 为什么装 | 哪天开始用 |
| --- | --- | --- |
| `langgraph` | 主工作流的图 | Day 457–462 |
| `langgraph-checkpoint-postgres` | 会话状态存进 Postgres | Day 464 |
| `psycopg[binary]` | 连 Postgres,`binary` 是带预编译库的版本,不用另外装 libpq | Day 443 |
| `pydantic-settings` | 读 `.env` 和环境变量的配置类 | Day 442 |
| `openai` | 调模型,`LLMClient` 底下用它 | Day 448 起 |

```bash
uv add langgraph langgraph-checkpoint-postgres "psycopg[binary]" pydantic-settings openai
```

`"psycopg[binary]"` 要加引号:`zsh` 会把方括号当成通配符,不加引号会报 `no matches found`。

```text
$ uv add langgraph langgraph-checkpoint-postgres psycopg[binary] pydantic-settings openai
Resolved 49 packages in 17ms
   Building supportpilot @ file:///Users/你/supportpilot
      Built supportpilot @ file:///Users/你/supportpilot
Prepared 1 package in 5ms
Uninstalled 1 package in 0.96ms
Installed 47 packages in 160ms
 ...(中间的依赖省略)
 + langgraph==1.2.18
 + langgraph-checkpoint==4.3.1
 + langgraph-checkpoint-postgres==3.2.0
 + langgraph-prebuilt==1.1.1
 + langgraph-sdk==0.4.10
 + openai==3.39.0
 + psycopg==3.3.6
 + pydantic-settings==2.16.1
 + python-dotenv==1.2.4
 ~ supportpilot==0.1.0 (from file:///Users/你/supportpilot)
```

输出里我删掉了中间的几十行(完整输出一共 47 个包)。几点:一共装了 47 个,包括你点名的 5 个、它们依赖的包,和项目自己,比如 `langgraph` 带来 `langchain-core`,`pydantic-settings` 带来 `python-dotenv`;`langgraph-checkpoint-postgres==3.2.0` 这个包 Day 464 要用,今天装上就省得到时候再停下来装;`~ supportpilot==0.1.0` 的 `~` 表示「项目自己被重新装了一遍」,因为 `pyproject.toml` 变了。

**哪些不装。** Day 467 要用的 `fastapi` 和 `uvicorn`,那天再装;Day 462 的预置 agent 对比实验要 `langchain` 和 `langchain-openai`,那只是个对比用的练习,在练习仓库里装,不进毕业项目的依赖。依赖越少,以后每一次部署越轻,也越不容易冒出版本冲突。

版本我是 2026 年 10 月 27 日在 PyPI 上查到的:`langgraph 1.2.18`、`langgraph-checkpoint-postgres 3.2.0`、`psycopg 3.3.6`、`pydantic-settings 2.16.1`、`openai 3.39.0`。你装到的小版本可能比我新,没关系,只要大版本一样,后面的代码都能跑(Day 462 里我锁到的是 `langgraph 1.2.16`,同一个大版本)。

再装开发依赖,加 `--dev`:

```bash
uv add --dev pytest ruff pre-commit basedpyright
```

```text
$ uv add --dev pytest ruff pre-commit basedpyright
Resolved 66 packages in 24ms
   Building supportpilot @ file:///Users/你/supportpilot
      Built supportpilot @ file:///Users/你/supportpilot
Prepared 1 package in 6ms
Uninstalled 1 package in 1ms
Installed 17 packages in 342ms
 ...(中间的依赖省略)
 + basedpyright==1.40.2
 + pre-commit==4.7.0
 + pytest==9.1.1
 + ruff==0.17.3
 ~ supportpilot==0.1.0 (from file:///Users/你/supportpilot)
```

`pyproject.toml` 里多了一段 `[dependency-groups]`:

```toml
[dependency-groups]
dev = [
    "basedpyright>=1.40.2",
    "pre-commit>=4.7.0",
    "pytest>=9.1.1",
    "ruff>=0.17.3",
]
```

<div class="line-notes">

- `[dependency-groups]` 依赖组,是 Python 的一个新标准(PEP 735),uv 用它存开发依赖。相当于 `package.json` 里的 `devDependencies`。
- `dev = [` 一个叫 `dev` 的组。以后可以再加 `docs`、`lint` 这类别的组。
- `"basedpyright>=1.40.2",` 类型检查器。[Day 9](/blog/agent-zero/day-009-editor-setup/) 配 Zed 时你已经见过它;这里装进项目,命令行也能跑,CI 也能跑。
- `"pre-commit>=4.7.0",` 提交前检查的框架,第六步用。**这一行后面会改**,因为我撞到了坑。
- `"pytest>=9.1.1",` 测试。
- `"ruff>=0.17.3",` 查错加排版。

</div>

开发依赖和运行依赖的区别,在你打包 Docker 镜像时才会真正用上:线上只需要 `uv sync --no-dev`,不装 pytest、ruff 这些。练习 4 会演示它。

## 第三步:按方块表建目录

Day 438 的表里,凡是 Day 441 或更早该存在的,加上后面各天要往里放文件的子包,今天先建好目录。目的是让仓库的样子和架构图一眼对得上。

```bash
mkdir -p src/supportpilot/{kb,tools,memory,agent,api,obs,security} tests scripts db data/kb evals/datasets docs scratch
for d in kb tools memory agent api obs security; do touch src/supportpilot/$d/__init__.py; done
for d in scripts db data/kb evals/datasets scratch; do touch $d/.gitkeep; done
cp ~/agent-zero-lab/part08/docs/PRD.md docs/PRD.md
```

<div class="line-notes">

- `mkdir -p src/supportpilot/{kb,tools,memory,agent,api,obs,security}` `-p` 让上级目录不存在时一起建;花括号 `{a,b,c}` 是 shell 的展开语法,一条命令建七个子包目录。
- `for d in kb tools memory agent api obs security; do touch src/supportpilot/$d/__init__.py; done` 每个子包放一个空的 `__init__.py`,Python 才认它是一个包([Day 32](/blog/agent-zero/day-032-modules/) 讲过)。`touch` 建空文件。**api 这一个包,要到 Day 467 才有第一个文件**,今天提前建好,是为了让目录和架构图一眼对上;`obs/`、`security/` 同理。
- `for d in scripts db data/kb evals/datasets scratch; do touch $d/.gitkeep; done` git 不跟踪空目录,所以在这些暂时没有文件的目录里放一个空的 `.gitkeep`,让它们能被提交。名字只是约定,没有特殊含义。`tests/` 和 `docs/` 不需要,因为它们今天就有文件。
- `cp ~/agent-zero-lab/part08/docs/PRD.md docs/PRD.md` Day 437 写的 PRD 从练习仓库复制进来。以后改 PRD(比如 Day 478 跑出第一份分数后调指标)就改这一份,练习仓库里的是历史版本。

</div>

`.gitignore` 里 uv 已经写了 `.venv`、`__pycache__` 这些。再加三类:密钥、缓存、macOS 的垃圾文件。注意 `.env.example` 要**例外**,它是给别人看的模板,必须提交([Day 53](/blog/agent-zero/day-053-env-secrets/) 讲过为什么 `.env` 不能进 git):

```gitignore
# 密钥和本地配置(.env.example 是模板,要提交)
.env
.env.*
!.env.example

# 工具缓存
.pytest_cache/
.ruff_cache/
.DS_Store
```

<div class="line-notes">

- `.env` 真正存密钥的文件,永远不提交。
- `.env.*` 也忽略 `.env.local`、`.env.rc` 这类变体。
- `!.env.example` 感叹号表示**排除**忽略:`.env.example` 虽然匹配上一行的 `.env.*`,但这一行把它放回来。顺序不能反,后面的规则覆盖前面的。Day 442 会建这个文件。
- `.pytest_cache/` 和 `.ruff_cache/` 两个工具自己建的缓存目录,不该进仓库。
- `.DS_Store` macOS 访达自动在每个目录里建的文件。

</div>

README 先写个雏形,Day 446 会补全。里面把 pre-commit 的版本限制和原因也写上:

```markdown
# SupportPilot

云簿 CloudLedger 的智能客服工单 Agent(毕业项目)。需求和指标见 [docs/PRD.md](docs/PRD.md)。

## 开发

    uv sync                       # 装依赖
    uv run pytest                 # 跑测试
    uv run ruff check && uv run ruff format --check
    uv run pre-commit install     # 每次 git commit 前自动检查

pre-commit<4.6.1:4.6.1 起要求 git>=2.31。

本文件今天只是个雏形,Day 446 补全。
```

(命令前面空四格,是 Markdown 里「缩进代码块」的写法,这样 README 里不用再嵌套三个反引号。)

现在目录是这样(按 `find` 的结果整理,没有列 `.git`、`.venv`):

```text
supportpilot/
├── .gitignore
├── .pre-commit-config.yaml
├── .python-version
├── README.md
├── pyproject.toml
├── uv.lock
├── data/kb/.gitkeep
├── db/.gitkeep
├── docs/PRD.md
├── evals/datasets/.gitkeep
├── scratch/.gitkeep
├── scripts/.gitkeep
├── src/supportpilot/
│   ├── __init__.py
│   ├── agent/__init__.py
│   ├── api/__init__.py
│   ├── kb/__init__.py
│   ├── memory/__init__.py
│   ├── obs/__init__.py
│   ├── security/__init__.py
│   └── tools/__init__.py
└── tests/test_smoke.py
```

## 第四步:ruff

ruff 的配置写在 `pyproject.toml` 的 `[tool.ruff]` 下面,不需要单独的配置文件。在文件末尾加:

```toml
[tool.ruff]
line-length = 120
target-version = "py312"
extend-exclude = ["scratch"]

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]
```

<div class="line-notes">

- `[tool.ruff]` 所有工具都用 `[tool.工具名]` 的格式,往 `pyproject.toml` 里放自己的配置。
- `line-length = 120` 每行最长 120 个字符,`ruff format` 会按这个折行。默认是 88,但 Day 438 的方块表里有些一行就超过 100 个字符,中文注释也占宽,120 更合适。
- `target-version = "py312"` 告诉 ruff 代码要跑在 Python 3.12 上,它才知道可以建议用 3.12 的新写法。
- `extend-exclude = ["scratch"]` `scratch/` 是后面几天放试验脚本的地方(Day 462 起),随手写的,不进检查,也不会拦住提交。
- `[tool.ruff.lint]` 查错部分的配置,排版(`format`)另算。
- `select = ["E", "F", "I", "UP", "B"]` 开哪几类规则。`E` 是 pycodestyle 的错误(缩进、空格),`F` 是 pyflakes(没用到的 import、没定义的变量),`I` 是 import 排序,`UP` 是提醒你用新语法(比如 `list[str]` 代替 `typing.List[str]`),`B` 是 bugbear,抓一些「看着对其实是 bug」的写法。

</div>

这五类我是挑出来的,不是 ruff 默认。**我没开的一类是 `RUF`**,原因下面实测。先故意写一个违规的文件:

```bash
printf 'import os\nimport sys\nfrom supportpilot import kb\n\ndef f(x = []):  \n    return x\n' > tests/bad.py
uv run ruff check --output-format concise
uv run ruff format --check tests/bad.py
```

```text
$ uv run ruff check --output-format concise
tests/bad.py:1:1: I001 [*] Import block is un-sorted or un-formatted
tests/bad.py:1:8: F401 [*] `os` imported but unused
tests/bad.py:2:8: F401 [*] `sys` imported but unused
tests/bad.py:3:26: F401 [*] `supportpilot.kb` imported but unused
tests/bad.py:5:11: B006 Do not use mutable data structures for argument defaults
Found 5 errors.
[*] 4 fixable with `--fix` (1 unsafe fix available with `--fix --unsafe-fixes`).
$ uv run ruff format --check tests/bad.py
unformatted: File would be reformatted
 --> tests/bad.py:5:1
  |
4 |
  - def f(x = []):  
5 +
6 + def f(x=[]):
7 |     return x
  |

1 file would be reformatted
```

逐条看:

- `I001` import 没排序。标准库、第三方、自己的包,中间要空行,按字母排。
- `F401` 三条,`os`、`sys`、`supportpilot.kb` 引入了没用。
- `B006` 最值得记:**函数的默认参数 `x=[]` 是在定义函数时算一次的**,以后每次调用不传参数,用的都是同一个列表,里面的东西会越攒越多。JS 里默认参数每次调用重新求值,没有这个坑,Python 有。ruff 建议写成 `x=None`,函数里再 `if x is None: x = []`。
- 方括号 `[*]` 表示能自动修:`uv run ruff check --fix` 会删掉没用的 import、排好序,但 `B006` 标了「unsafe fix」,因为它会改程序行为,默认不自动改。
- `ruff format --check` 说这个文件需要重新排版:`x = []` 要变成 `x=[]`(默认参数的等号两边不留空格),行尾的两个空格要去掉,函数前要空两行。

看完把它删掉,`rm tests/bad.py`。再看我没开的 `RUF`,拿一个带全角标点的文件试:

```bash
printf 'def f():\n    # 查客户，再查订阅（两步）\n    s = "您好，请提供注册邮箱"\n    return s\n' > tests/zh.py
uv run ruff check --select RUF --output-format concise tests/zh.py
rm tests/zh.py
```

```text
$ uv run ruff check --select RUF --output-format concise tests/zh.py
tests/zh.py:2:10: RUF003 Comment contains ambiguous `，` (FULLWIDTH COMMA). Did you mean `,` (COMMA)?
tests/zh.py:2:15: RUF003 Comment contains ambiguous `（` (FULLWIDTH LEFT PARENTHESIS). Did you mean `(` (LEFT PARENTHESIS)?
tests/zh.py:2:18: RUF003 Comment contains ambiguous `）` (FULLWIDTH RIGHT PARENTHESIS). Did you mean `)` (RIGHT PARENTHESIS)?
tests/zh.py:3:12: RUF001 String contains ambiguous `，` (FULLWIDTH COMMA). Did you mean `,` (COMMA)?
Found 4 errors.
```

`RUF001` 到 `RUF003` 是「别把全角标点当成英文标点」,防的是英文代码里混进长得很像的字符。我们的项目里中文注释和给客户的中文回复到处是全角逗号和括号,开了会满屏报错。所以不开。**规则不是越多越好,是和你的项目相配。**

## 第五步:pytest 和类型检查

pytest 的配置同样在 `pyproject.toml`:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra"

[tool.basedpyright]
typeCheckingMode = "standard"
include = ["src", "tests", "scripts"]
```

<div class="line-notes">

- `[tool.pytest.ini_options]` pytest 读这个名字的配置段,`ini_options` 是历史原因,实际内容是 TOML。
- `testpaths = ["tests"]` 不带参数运行 `pytest` 时,只去 `tests/` 里找测试,不会误入 `scratch/` 或 `.venv`。
- `addopts = "-ra"` 每次运行都自动带上 `-ra`:测试结束后,把所有不是「通过」的(失败、跳过、预期失败)原因汇总打印一遍。以后有人用 `skip` 跳过一个测试,汇总里会看到,不会悄悄丢掉。
- `[tool.basedpyright]` 类型检查器的配置段。
- `typeCheckingMode = "standard"` 检查严格度。Day 9 配编辑器时说过,`standard` 能抓到真问题、又不至于满屏报警。本课程所有代码按这个档保持 0 报错。
- `include = ["src", "tests", "scripts"]` 只检查这三个目录,`scratch/` 不管。

</div>

写第一个测试。仓库刚建好,没有业务代码,所以它只做两件事:确认包装得上、确认后面要用的几个子包都能 import。这看起来很傻,但它会真的抓到一类错:建目录时漏建 `__init__.py`,`import` 就失败。

```python
# supportpilot/tests/test_smoke.py
"""冒烟:包装得上、每个子包都能 import。仓库刚建好时,这就是全部的测试。"""

import importlib

import pytest

import supportpilot

SUBPACKAGES = ["kb", "tools", "memory", "agent", "api", "obs", "security"]


def test_version():
    assert supportpilot.__version__ == "0.1.0"


@pytest.mark.parametrize("name", SUBPACKAGES)
def test_subpackage_importable(name: str):
    assert importlib.import_module(f"supportpilot.{name}")
```

<div class="line-notes">

- `# supportpilot/tests/test_smoke.py` 第一行写完整路径,和本课所有文件一样。
- `"""冒烟:包装得上、每个子包都能 import。仓库刚建好时,这就是全部的测试。"""` 「冒烟测试」的名字来自硬件:通电,看冒不冒烟。
- `import importlib` Python 自带,`importlib.import_module("a.b")` 按字符串名字导入模块,相当于 JS 的动态 `import()`。
- `import pytest` 要用它的 `parametrize`。
- `import supportpilot` 注意这里写的是包名,不是 `src.supportpilot`:包已经以可编辑方式装进 `.venv`,所以能直接按包名导入。
- `SUBPACKAGES = ["kb", "tools", "memory", "agent", "api", "obs", "security"]` Day 438 方块表里的七个子包。
- `def test_version():` 名字以 `test_` 开头,pytest 才会收。
- `assert supportpilot.__version__ == "0.1.0"` 确认刚才写进 `__init__.py` 的版本号读得到。
- `@pytest.mark.parametrize("name", SUBPACKAGES)` 同一个测试函数,对列表里每个值各跑一次,报告里是七个测试。相当于 `it.each(["kb", "tools", ...])`。
- `def test_subpackage_importable(name: str):` 每次运行,`name` 依次是 `"kb"`、`"tools"`……
- `assert importlib.import_module(f"supportpilot.{name}")` 导入成功就返回模块对象(真值),失败抛 `ModuleNotFoundError`,测试就红。

</div>

把四个检查都跑一遍,看「全绿」是什么输出:

```bash
uv run pytest
uv run ruff check
uv run ruff format --check
uv run basedpyright
```

```text
$ uv run pytest
   Building supportpilot @ file:///Users/你/supportpilot
      Built supportpilot @ file:///Users/你/supportpilot
Uninstalled 1 package in 0.95ms
Installed 1 package in 1ms
============================= test session starts ==============================
platform darwin -- Python 3.12.13, pytest-9.1.1, pluggy-1.7.0
rootdir: /Users/你/supportpilot
configfile: pyproject.toml
testpaths: tests
plugins: langsmith-0.14.12, anyio-4.15.1, platformdirs-4.13.5
collected 8 items

tests/test_smoke.py ........                                             [100%]

============================== 8 passed in 0.04s ===============================
$ uv run ruff check
All checks passed!
$ uv run ruff format --check
11 files already formatted
$ uv run basedpyright
0 errors, 0 warnings, 0 notes
```

第一条:`8 passed`,一个版本测试加七个子包。`configfile: pyproject.toml`、`testpaths: tests` 说明配置真的被读到了。后三条:`All checks passed!`、`11 files already formatted`、`0 errors, 0 warnings, 0 notes`。ruff 的输出风格 2026 年 10 月是这样,版本升了措辞可能变。

## 第六步:pre-commit

前面三个检查都要你**记得去跑**。人会忘,尤其赶进度的时候。pre-commit 把它们挂在 `git commit` 上:每次提交前自动运行,有一项不过,提交就失败。

它的原理很简单:git 有一个机制叫 **hook(钩子)**,在 `.git/hooks/` 目录里放一个叫 `pre-commit` 的可执行文件,`git commit` 之前会先运行它,返回非零就取消提交。pre-commit 这个工具负责两件事:读一份 YAML 配置,按配置去下载各个检查工具;再生成那个 `.git/hooks/pre-commit` 文件。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="提交和推送要经过的检查:commit 前跑六个快检查,push 前跑 pytest,推到远程后 CI 再跑一遍">
  <g font-family="var(--font-mono)" font-size="12">
    <text x="14" y="22" fill="var(--ink-soft)">一次提交、一次推送,各经过哪些检查</text>
    <rect x="14" y="40" width="86" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="57" y="64" text-anchor="middle" fill="var(--ink)">git add</text>
    <rect x="124" y="40" width="96" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="172" y="64" text-anchor="middle" fill="var(--ink)">git commit</text>
    <rect x="248" y="30" width="270" height="146" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="262" y="50" fill="var(--ink)">pre-commit 钩子(秒级)</text>
    <rect x="262" y="62" width="118" height="26" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="321" y="79" text-anchor="middle" fill="var(--ink-soft)" font-size="11">行尾空格</text>
    <rect x="388" y="62" width="118" height="26" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="447" y="79" text-anchor="middle" fill="var(--ink-soft)" font-size="11">文件末尾换行</text>
    <rect x="262" y="96" width="118" height="26" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="321" y="113" text-anchor="middle" fill="var(--ink-soft)" font-size="11">YAML/TOML 语法</text>
    <rect x="388" y="96" width="118" height="26" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="447" y="113" text-anchor="middle" fill="var(--ink-soft)" font-size="11">大文件</text>
    <rect x="262" y="130" width="118" height="26" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="321" y="147" text-anchor="middle" fill="var(--ink-soft)" font-size="11">私钥</text>
    <rect x="388" y="130" width="118" height="26" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="447" y="147" text-anchor="middle" fill="var(--ink-soft)" font-size="11">ruff 查错+排版</text>
    <rect x="544" y="40" width="82" height="40" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="585" y="64" text-anchor="middle" fill="var(--ink)">提交成功</text>
    <line x1="100" y1="60" x2="124" y2="60" stroke="var(--ink-soft)"/>
    <line x1="220" y1="60" x2="248" y2="60" stroke="var(--ink-soft)"/>
    <line x1="518" y1="60" x2="544" y2="60" stroke="var(--ink-soft)"/>
    <text x="262" y="164" fill="var(--ink-faint)" font-size="10">任何一个失败 → 提交取消</text>
    <rect x="14" y="204" width="86" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="57" y="228" text-anchor="middle" fill="var(--ink)">git push</text>
    <rect x="124" y="204" width="150" height="40" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="199" y="228" text-anchor="middle" fill="var(--ink)">pytest(慢,只在这里)</text>
    <rect x="298" y="204" width="96" height="40" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="346" y="228" text-anchor="middle" fill="var(--ink)">远程仓库</text>
    <line x1="100" y1="224" x2="124" y2="224" stroke="var(--ink-soft)"/>
    <line x1="274" y1="224" x2="298" y2="224" stroke="var(--ink-soft)"/>
    <rect x="418" y="204" width="208" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
    <text x="522" y="222" text-anchor="middle" fill="var(--ink-soft)" font-size="11">CI 再跑一遍同样的检查</text>
    <text x="522" y="237" text-anchor="middle" fill="var(--ink-faint)" font-size="10">钩子能被跳过,CI 不能</text>
    <line x1="394" y1="224" x2="418" y2="224" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  </g>
</svg>
<figcaption>琥珀色是自动运行的检查,蓝色是流程的终点。commit 阶段只放几秒内能跑完的,慢的 pytest 放到 push;CI 是最后一道,任何人都绕不开。</figcaption>
</figure>

先写配置:

```yaml
# supportpilot/.pre-commit-config.yaml
default_install_hook_types: [pre-commit, pre-push]

repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v6.0.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-toml
      - id: check-added-large-files
        args: [--maxkb=500]
      - id: detect-private-key

  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.17.3
    hooks:
      - id: ruff-check
      - id: ruff-format

  - repo: local
    hooks:
      - id: pytest
        name: pytest
        entry: uv run pytest -q
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]
```

<div class="line-notes">

- `# supportpilot/.pre-commit-config.yaml` 文件名必须是这个,pre-commit 只认它。
- `default_install_hook_types: [pre-commit, pre-push]` `pre-commit install` 默认只装 commit 这一个时机。这一行让它同时装上 push 的钩子:提交时跑快的检查(秒级),推送时再跑慢的(完整测试)。
- `repos:` 钩子的来源列表,每个来源是一个 git 仓库。
- `- repo: https://github.com/pre-commit/pre-commit-hooks` 官方的一批通用小检查。
- `rev: v6.0.0` 用这个仓库的哪个版本(git tag)。我在 2026 年 10 月 27 日查到它的最新 tag 是 `v6.0.0`。锁死版本是为了所有人拿到同样的检查,不会因为某天上游升级,你的提交突然过不了。
- `- id: trailing-whitespace` 行尾多余的空格,自动删掉。
- `- id: end-of-file-fixer` 文件末尾必须正好有一个换行,自动补。
- `- id: check-yaml` 和 `- id: check-toml` 检查 YAML、TOML 语法能不能解析。`pyproject.toml` 手滑少个引号,提交时就发现。
- `- id: check-added-large-files` 拦住大文件。`args: [--maxkb=500]` 超过 500KB 的新文件不让提交,防止不小心把数据库文件或模型权重提进去。`uv.lock` 要大一点,但它是修改而不是「新增」,不在这条管辖里。
- `- id: detect-private-key` 文件里出现私钥(`-----BEGIN RSA PRIVATE KEY-----`)就拦。下面会实测。
- `- repo: https://github.com/astral-sh/ruff-pre-commit` ruff 官方的 pre-commit 钩子仓库。
- `rev: v0.17.3` 和 `uv.lock` 里的 ruff 版本一致。**两处版本要手动对齐**,这是用这个官方钩子的一个小代价;`uv run pre-commit autoupdate` 会把 `rev` 更新到最新。
- `- id: ruff-check` 和 `- id: ruff-format` 查错和排版两个钩子,读的是 `pyproject.toml` 里的 `[tool.ruff]`。
- `- repo: local` 不从远程拉,用本机已有的命令。
- `entry: uv run pytest -q` 钩子执行的命令。用 `uv run`,保证用的是项目 `.venv` 里的 pytest。
- `language: system` 直接执行系统命令,不让 pre-commit 另建一个环境。
- `pass_filenames: false` 不把「本次改了哪些文件」传给 pytest,让它跑全部测试。
- `always_run: true` 即使这次没改任何 `.py` 文件,也要跑。
- `stages: [pre-push]` 只在 `git push` 时跑,不拖慢每次 commit。

</div>

装钩子并第一次跑。我装的是 PyPI 上当时最新的 pre-commit 4.7.0,然后遇到了一个真实的坑:

```bash
uv run pre-commit install
git add -A
uv run pre-commit run --all-files
```

```text
$ uv run pre-commit --version
pre-commit 4.7.0
$ uv run pre-commit install
pre-commit installed at .git/hooks/pre-commit
pre-commit installed at .git/hooks/pre-push
$ git --version
git version 2.24.3 (Apple Git-128)
$ uv run pre-commit run --all-files
[INFO] Initializing environment for https://github.com/pre-commit/pre-commit-hooks.
[INFO] Initializing environment for https://github.com/astral-sh/ruff-pre-commit.
[INFO] Installing environment for https://github.com/pre-commit/pre-commit-hooks.
[INFO] Once installed this environment will be reused.
[INFO] This may take a few minutes...
[INFO] Installing environment for https://github.com/astral-sh/ruff-pre-commit.
[INFO] Once installed this environment will be reused.
[INFO] This may take a few minutes...
An unexpected error has occurred: CalledProcessError: command: ('/usr/bin/git', 'ls-files', '-z', '--deduplicate')
return code: 129
stdout: (none)
stderr:
    error: unknown option `deduplicate'
    ...(下面是 git ls-files 的用法说明,省略)
Check the log at /Users/你/.cache/pre-commit/pre-commit.log
```

**这个报错的意思:** pre-commit 要列出仓库里所有文件,调用了 `git ls-files --deduplicate`,而我电脑上的 git 是 `2.24.3 (Apple Git-128)`,不认识这个选项。我去查 git 的发布说明,`--deduplicate` 是 git 2.31 才加的。也就是说,**pre-commit 4.7.0 要求 git 不低于 2.31**,而 2019 年那一批 Mac 自带的命令行工具里的 git 可能停在 2.24。

诊断办法只有一条:`git --version` 看一眼。两个解法:

1. **升级 git**(长期正确的做法):`xcode-select --install` 更新命令行工具,或者 `brew install git`。我没有做,因为那会改系统环境,我的练习环境要保持干净。
2. **锁定一个老版本的 pre-commit**:我把 4.5.1、4.6.0、4.6.1、4.7.0 都在这台机器上跑了一遍,4.6.0 及以前能用,4.6.1 起不行。所以:

```bash
uv add --dev "pre-commit<4.6.1"
uv run pre-commit run --all-files
```

```text
$ uv add --dev pre-commit<4.6.1
Resolved 66 packages in 22ms
   Building supportpilot @ file:///Users/你/supportpilot
      Built supportpilot @ file:///Users/你/supportpilot
Prepared 1 package in 5ms
Uninstalled 2 packages in 16ms
Installed 2 packages in 5ms
 - pre-commit==4.7.0
 + pre-commit==4.6.0
 ~ supportpilot==0.1.0 (from file:///Users/你/supportpilot)
$ uv run pre-commit --version
pre-commit 4.6.0
$ uv run pre-commit run --all-files
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check toml...............................................................Passed
check for added large files..............................................Passed
detect private key.......................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
```

锁版本之后,`pre-commit` 变成 4.6.0,八个钩子全部 `Passed`。注意输出里没有 `pytest` 一行,因为它被设成 `stages: [pre-push]`,commit 阶段不跑。

还有一个我踩到的小细节:一开始我没有 `git add -A` 就跑 `pre-commit run --all-files`,八个钩子全部显示 `(no files to check) Skipped`。**pre-commit 只检查 git 已经跟踪的文件**,没 `add` 过的文件它看不见,所以「全跳过」不是通过,是它什么都没检查。

`pyproject.toml` 里那一行现在是 `"pre-commit<4.6.1",`。你的 git 如果不老,不需要这个限制;但**写进项目里的版本限制,要写一句为什么**,我把它写在 README 里:`pre-commit<4.6.1:4.6.1 起要求 git>=2.31`。

### 违规的提交会怎样

现在故意提交一个违规的文件,看它被拦下:

```bash
printf 'import os\nimport sys\nfrom supportpilot import kb\n\ndef f(x = []):  \n    return x\n' > tests/bad.py
git add tests/bad.py
git commit -m "chore: 初始化仓库"
```

```text
$ git commit -m chore: 初始化仓库
trim trailing whitespace.................................................Failed
- hook id: trailing-whitespace
- exit code: 1
- files were modified by this hook
Fixing tests/bad.py
fix end of files.........................................................Passed
check yaml...............................................................Passed
check toml...............................................................Passed
check for added large files..............................................Passed
detect private key.......................................................Passed
ruff check...............................................................Failed
- hook id: ruff-check
- exit code: 1
    ...(每条规则下面还有一段带箭头的代码定位,省略)
I001 [*] Import block is un-sorted or un-formatted
F401 [*] `os` imported but unused
F401 [*] `sys` imported but unused
F401 [*] `supportpilot.kb` imported but unused
B006 Do not use mutable data structures for argument defaults
note: This is an unsafe fix and may change runtime behavior
Found 5 errors.
[*] 4 fixable with `--fix` (1 unsafe fix available with `--fix --unsafe-fixes`).
ruff format..............................................................Failed
- hook id: ruff-format
- files were modified by this hook
```

(中间 ruff 每条规则下面还有带箭头的代码定位,我省略了。)

八个钩子里三个失败。看第一个:`trim trailing whitespace` 失败了,但它的说明是 `files were modified by this hook`,「钩子**改了**文件」,`Fixing tests/bad.py` 就是它把行尾空格删了。pre-commit 里的钩子分两种:会自动修的(去空格、排版)和只报告的(`ruff check`)。自动修的钩子只要改了文件,就算「失败」,因为它改的内容**没有在你准备提交的暂存区里**。

所以正确的反应是:看一下它改了什么,`git add` 再提交一次。如果不重新 `add` 就提交,会看到:

```text
--- 再提交一次(没有重新 add)
$ git commit -m chore: 初始化仓库
[WARNING] Unstaged files detected.
[INFO] Stashing unstaged files to /Users/你/.cache/pre-commit/patch1793075485-63312.
[WARNING] Stashed changes conflicted with hook auto-fixes... Rolling back fixes...
[INFO] Restored changes from /Users/你/.cache/pre-commit/patch1793075485-63312.
```

`Unstaged files detected`,它先把没暂存的改动存起来(stash),跑完检查,发现自动修的内容和 stash 冲突,于是回滚了自动修改,把你的改动还原。结果是:提交仍然失败,文件还是脏的。这两行警告第一次看到会吓一跳,其实它在说「我不确定该以哪个版本为准,请你重新 `git add`」。

再试一个更重要的:往仓库里提交一把私钥。

```bash
printf -- '-----BEGIN RSA PRIVATE KEY-----\nMIIFAKEFAKEFAKE\n-----END RSA PRIVATE KEY-----\n' > scripts/notes.txt
git add scripts/notes.txt
git commit -m "oops"
```

```text
$ git commit -m oops
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check toml...............................................................Passed
check for added large files..............................................Passed
detect private key.......................................................Failed
- hook id: detect-private-key
- exit code: 1

Private key found: scripts/notes.txt

ruff check...............................................................Passed
ruff format..............................................................Passed
```

`detect private key...Failed`,`Private key found: scripts/notes.txt`,提交被拦住了。这个文件里的内容是我编的假私钥,只有头尾两行标记,但这就够它认出来了。[Day 56](/blog/agent-zero/day-056-git-1/) 里你亲手提交过一把假 key 并看到它删不掉;现在多了一道在 commit 之前拦住它的门。试完把这两个文件删掉并从暂存区拿出来:

```bash
git rm -q --cached -f tests/bad.py scripts/notes.txt
rm tests/bad.py scripts/notes.txt
```

## 第七步:和架构图对账

仓库是建出来了,但它和 Day 438 的方块表是不是一个东西?昨天写的 `check_arch.py` 就是干这个的,但它有两个地方还不能直接用在这个真仓库上:

- 它假设所有方块的文件都已经存在,而今天只建了 Day 441 及以前的。
- 它扫描整个目录找「不属于任何方块的文件」,真仓库里有 `.git`、`.venv` 这些大目录。

先加一个 `--day N` 参数,只检查这一天及以前该有的方块;再把 `.git`、`.venv` 这些目录排除。改 `part08/check_arch.py` 三处(下面是改完后的完整函数,别的函数不动):

```python
# agent-zero-lab/part08/check_arch.py(接着上一段,追加在文件里)
IGNORE = {"__init__.py", ".gitkeep", ".DS_Store"}
IGNORE_DIRS = {".git", ".venv", "__pycache__", ".ruff_cache", ".pytest_cache", "node_modules"}
```

<div class="line-notes">

- `IGNORE = {"__init__.py", ".gitkeep", ".DS_Store"}` 不属于任何方块也不报的**文件名**。`__init__.py` 和 `.gitkeep` 是昨天就有的,今天加了 `.DS_Store`。
- `IGNORE_DIRS = {".git", ".venv"` 新增:整个目录都跳过。`.venv` 里有几千个文件,`.git` 里有仓库历史,都不该参与检查。

</div>

```python
# agent-zero-lab/part08/check_arch.py(接着上一段,追加在文件里)
def check_boxes(root: Path, day: int | None = None) -> list[str]:
    problems: list[str] = []
    for b in BOXES:
        if day is not None and b.day > day:
            continue  # 还没到这一天,文件不存在是正常的
        target = root / b.path
        if not target.exists():
            problems.append(f"方块「{b.name}」没有文件:{b.path}")
        elif b.symbol and target.suffix == ".py":
            if b.symbol not in defined_names(ast.parse(target.read_text(encoding="utf-8"))):
                problems.append(f"方块「{b.name}」的文件里找不到 {b.symbol}:{b.path}")
    return problems


def check_orphans(root: Path) -> list[str]:
    problems: list[str] = []
    for f in sorted(root.rglob("*")):
        rel = f.relative_to(root).as_posix()
        if not f.is_file() or f.name in IGNORE or IGNORE_DIRS & set(rel.split("/")):
            continue
        owned = any(rel == b.path or (b.path.endswith("/") and rel.startswith(b.path)) for b in BOXES)
        if not owned:
            problems.append(f"文件不属于任何方块:{rel}")
    return problems
```

<div class="line-notes">

- `def check_boxes(root: Path, day: int | None = None) -> list[str]:` 多了一个可选参数 `day`。`int | None` 是类型标注,表示「整数或者没有」,默认 `None`(不限制)。
- `if day is not None and b.day > day:` 给了 `day` 并且这个方块的建造日比它晚,就跳过。`is not None` 比 `if day:` 严谨,后者在 `day=0` 时也会误判。
- `continue  # 还没到这一天,文件不存在是正常的` 跳到下一个方块。
- `def check_orphans(root: Path) -> list[str]:` 孤儿检查:仓库里有文件,但没有方块认领它。
- `rel = f.relative_to(root).as_posix()` 先算相对路径,下一行要用它判断在哪个目录。
- `if not f.is_file() or f.name in IGNORE or IGNORE_DIRS & set(rel.split("/")):` 不是文件、文件名在忽略表、路径里任何一段是被排除的目录,都跳过。`rel.split("/")` 把 `.venv/bin/python` 切成 `['.venv', 'bin', 'python']`,和 `IGNORE_DIRS` 求集合交集,非空就说明在被排除的目录里面。
- `owned = any(rel == b.path or (b.path.endswith("/") and rel.startswith(b.path)) for b in BOXES)` 文件被某个方块认领的两种方式:路径完全相等,或者方块指向一个目录(以 `/` 结尾),文件在这个目录下。
- `problems.append(f"文件不属于任何方块:{rel}")` 没人认领就报。

</div>

```python
# agent-zero-lab/part08/check_arch.py(接着上一段,追加在文件里)
def run_all(root: Path, day: int | None = None) -> dict[str, list[str]]:
    return {"方块有文件": check_boxes(root, day), "文件有归属": check_orphans(root), "依赖方向": check_layers(root)}


if __name__ == "__main__":
    args = sys.argv[1:]
    day = int(args[args.index("--day") + 1]) if "--day" in args else None  # 只检查这一天及以前该有的方块
    if "--day" in args:
        del args[args.index("--day") : args.index("--day") + 2]
    root = Path(args[0] if args else "part08/arch_skeleton/supportpilot").expanduser()
    results = run_all(root, day)
    for name, problems in results.items():
        print(f"{name}:", "通过" if not problems else f"{len(problems)} 个问题")
        for p in problems:
            print("  -", p)
    sys.exit(1 if any(results.values()) else 0)
```

<div class="line-notes">

- `def run_all(root: Path, day: int | None = None) -> dict[str, list[str]]:` 把 `day` 传下去,只有 `check_boxes` 用它。
- `args = sys.argv[1:]` 命令行参数,去掉第 0 个(脚本名)。
- `day = int(args[args.index("--day") + 1]) if "--day" in args else None  # 只检查这一天及以前该有的方块` 找到 `--day`,取它后面那个值转成整数;没有这个参数就是 `None`。
- `if "--day" in args:` 找到后,
- `del args[args.index("--day") : args.index("--day") + 2]` 把 `--day` 和它的值两项从列表里删掉,剩下的第一个就是目录路径。`del 列表[a:b]` 按切片删除。
- `root = Path(args[0] if args else "part08/arch_skeleton/supportpilot").expanduser()` 没给路径就用昨天的骨架;`.expanduser()` 把 `~` 换成家目录,所以可以直接写 `~/supportpilot`。
- `results = run_all(root, day)` 跑三个检查。
- `sys.exit(1 if any(results.values()) else 0)` 昨天写的:有任何问题,退出码是 1。

</div>

先别急着改方块表,直接跑,看它说什么:

```bash
cd ~/agent-zero-lab
uv run python -m part08.check_arch --day 441 ~/supportpilot
```

```text
$ uv run python -m part08.check_arch --day 441 ~/supportpilot
方块有文件: 通过
文件有归属: 5 个问题
  - 文件不属于任何方块:.gitignore
  - 文件不属于任何方块:.pre-commit-config.yaml
  - 文件不属于任何方块:.python-version
  - 文件不属于任何方块:README.md
  - 文件不属于任何方块:uv.lock
依赖方向: 通过
```

「方块有文件」通过(今天该有的只有 `docs/` 和 `pyproject.toml` 两个方块),「依赖方向」通过(还没有任何业务代码)。「文件有归属」报了 5 个:`.gitignore`、`.pre-commit-config.yaml`、`.python-version`、`README.md`、`uv.lock`。这几个文件是真的存在,而且应该存在,**是方块表里漏了它们**。昨天我画架构图时只想着业务代码,没想到工程文件也要有人认领。把它们补进 `arch.py` 的「工程」那一组:

```python
    Box("依赖和工具配置", "pyproject.toml", 441),
    Box("依赖锁定", "uv.lock", 441),
    Box("Python 版本", ".python-version", 441),
    Box("提交前检查", ".pre-commit-config.yaml", 441),
    Box("不进仓库的文件", ".gitignore", 441),
    Box("自述文件", "README.md", 441),
```

<div class="line-notes">

- `Box("依赖和工具配置", "pyproject.toml", 441),` 这一行 Day 438 就有了,今天只是用它定位插入点:新的五行加在它后面。
- `Box("依赖锁定", "uv.lock", 441),` 锁文件。没有 `symbol`(最后一个参数),因为它不是 `.py`。
- `Box("Python 版本", ".python-version", 441),` uv 读它决定用哪个 Python。
- `Box("提交前检查", ".pre-commit-config.yaml", 441),` 今天写的。
- `Box("不进仓库的文件", ".gitignore", 441),` 防止密钥和缓存被提交。
- `Box("自述文件", "README.md", 441),` 今天只是雏形,Day 446 补全,但文件今天就有了。

</div>

方块数从 53 变成 58。再跑,以及不带 `--day` 看看会怎样:

```bash
uv run python -m part08.arch | head -1
uv run python -m part08.check_arch --day 441 ~/supportpilot
uv run python -m part08.check_arch ~/supportpilot | head -5
```

```text
$ uv run python -m part08.arch | head -1
58 个方块,涉及 48 个路径
```

```text
$ uv run python -m part08.check_arch --day 441 ~/supportpilot
方块有文件: 通过
文件有归属: 通过
依赖方向: 通过
```

```text
$ uv run python -m part08.check_arch ~/supportpilot | head -5
方块有文件: 47 个问题
  - 方块「配置」没有文件:src/supportpilot/config.py
  - 方块「数据库连接」没有文件:src/supportpilot/db.py
  - 方块「表结构」没有文件:db/schema.sql
  - 方块「LLM 调用」没有文件:src/supportpilot/llm.py
```

加了 `--day 441`,三个检查都通过,退出码 0。不加 `--day`,它报「方块有文件: 47 个问题」,是后面 56 天要建的文件,一个都还没有。**这 47 个问题就是接下来 56 天的待办清单**,每过一天少几条,到 Day 497 应该降到 0。

**这件事的价值**:昨天的方块表是 Day 438 一个人坐在那里想出来的,今天仓库一建,它就被现实验证了一遍,补出了 5 条。以后每建一天的内容,都可以用同样的办法对账:`check_arch.py --day 当天 ~/supportpilot`。

## 第八步:第一次提交,和新克隆验证

```bash
cd ~/supportpilot
git add -A
git commit -m "chore: 初始化仓库,uv、ruff、pytest、pre-commit"
git branch -m main
git log --stat --format="%h %s"
```

```text
$ git commit -m chore: 初始化仓库,uv、ruff、pytest、pre-commit
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check toml...............................................................Passed
check for added large files..............................................Passed
detect private key.......................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
[master (root-commit) 31289f7] chore: 初始化仓库,uv、ruff、pytest、pre-commit
 21 files changed, 1828 insertions(+)
 create mode 100644 .gitignore
 create mode 100644 .pre-commit-config.yaml
 create mode 100644 .python-version
 create mode 100644 README.md
 create mode 100644 data/kb/.gitkeep
 create mode 100644 db/.gitkeep
 create mode 100644 docs/PRD.md
 create mode 100644 evals/datasets/.gitkeep
 create mode 100644 pyproject.toml
 create mode 100644 scratch/.gitkeep
 create mode 100644 scripts/.gitkeep
 create mode 100644 src/supportpilot/__init__.py
 create mode 100644 src/supportpilot/agent/__init__.py
 create mode 100644 src/supportpilot/api/__init__.py
 create mode 100644 src/supportpilot/kb/__init__.py
 create mode 100644 src/supportpilot/memory/__init__.py
 create mode 100644 src/supportpilot/obs/__init__.py
 create mode 100644 src/supportpilot/security/__init__.py
 create mode 100644 src/supportpilot/tools/__init__.py
 create mode 100644 tests/test_smoke.py
 create mode 100644 uv.lock
```

```text
$ git log --stat --format=%h %s
31289f7 chore: 初始化仓库,uv、ruff、pytest、pre-commit

 .gitignore                            |   20 +
 .pre-commit-config.yaml               |   30 +
 .python-version                       |    1 +
 README.md                             |   14 +
 data/kb/.gitkeep                      |    0
 db/.gitkeep                           |    0
 docs/PRD.md                           |   63 ++
 evals/datasets/.gitkeep               |    0
 pyproject.toml                        |   44 +
 scratch/.gitkeep                      |    0
 scripts/.gitkeep                      |    0
 src/supportpilot/__init__.py          |    3 +
 src/supportpilot/agent/__init__.py    |    0
 src/supportpilot/api/__init__.py      |    0
 src/supportpilot/kb/__init__.py       |    0
 src/supportpilot/memory/__init__.py   |    0
 src/supportpilot/obs/__init__.py      |    0
 src/supportpilot/security/__init__.py |    0
 src/supportpilot/tools/__init__.py    |    0
 tests/test_smoke.py                   |   19 +
 uv.lock                               | 1634 +++++++++++++++++++++++++++++++++
 21 files changed, 1828 insertions(+)
$ git status --short
```

提交时八个钩子全部 `Passed`;一个提交里有 21 个文件,其中 `uv.lock` 占了 1634 行,这就是「锁文件要提交」的意思:它记录的是你这次装到的每一个包的确切版本。(`git branch -m main` 是把默认的 `master` 改名,看你的 git 配置,你的可能已经是 `main`。)

最后一步,模拟同事(或者三个月后的你)拿到这个仓库:克隆到另一个目录,看能不能一键跑起来。

```bash
git clone ~/supportpilot ~/supportpilot-copy
cd ~/supportpilot-copy
ls .git/hooks
uv sync
uv run pytest -q
```

```text
$ git clone -q /Users/你/supportpilot clone_demo/supportpilot
$ ls -a
.
..
.git
.gitignore
.pre-commit-config.yaml
.python-version
README.md
data
db
docs
evals
pyproject.toml
scratch
scripts
src
tests
uv.lock
$ ls .git/hooks
applypatch-msg.sample
commit-msg.sample
fsmonitor-watchman.sample
post-update.sample
pre-applypatch.sample
pre-commit.sample
pre-merge-commit.sample
pre-push.sample
pre-rebase.sample
pre-receive.sample
prepare-commit-msg.sample
update.sample
$ uv sync
Using CPython 3.12.13
Creating virtual environment at: .venv
Resolved 66 packages in 5ms
   Building supportpilot @ file:///Users/你/supportpilot-copy
      Built supportpilot @ file:///Users/你/supportpilot-copy
Prepared 1 package in 6ms
Installed 63 packages in 523ms
 + ...(共 63 个包)
$ uv run pytest -q
........                                                                 [100%]
8 passed in 0.02s
```

`uv sync` 读 `uv.lock`,装上 63 个包(没有 `.venv` 是因为它不进 git),`uv run pytest -q` 8 个全绿,说明仓库自己是完整的。注意 `ls .git/hooks` 里只有 `.sample` 文件:**钩子不会跟着 `git clone` 走**,因为 `.git/` 不属于仓库内容。同事克隆下来之后要自己跑一次 `uv run pre-commit install`,否则他的提交不会被检查。所以 README 里那行 `uv run pre-commit install` 不能省,CI 里也要再跑一遍同样的检查(练习 1 会演示不装钩子会怎样)。

## 拼起来:最后的 `pyproject.toml`

前面是一步步加的,最后的完整文件如下,方便你对照:

```toml
[project]
name = "supportpilot"
version = "0.1.0"
description = "云簿 CloudLedger 的智能客服工单 Agent(毕业项目)"
readme = "README.md"
authors = [
    { name = "Xiao Ming", email = "xiaoming@example.com" }
]
requires-python = ">=3.12"
dependencies = [
    "langgraph>=1.2.18",
    "langgraph-checkpoint-postgres>=3.2.0",
    "openai>=3.39.0",
    "psycopg[binary]>=3.3.6",
    "pydantic-settings>=2.16.1",
]

[build-system]
requires = ["uv_build>=0.13.0,<0.14.0"]
build-backend = "uv_build"

[dependency-groups]
dev = [
    "basedpyright>=1.40.2",
    "pre-commit<4.6.1",
    "pytest>=9.1.1",
    "ruff>=0.17.3",
]

[tool.ruff]
line-length = 120
target-version = "py312"
extend-exclude = ["scratch"]

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra"

[tool.basedpyright]
typeCheckingMode = "standard"
include = ["src", "tests", "scripts"]
```

<div class="line-notes">

- `name = "supportpilot"` 项目名,和 `src/supportpilot` 同名。
- `requires-python = ">=3.12"` 最低 Python 版本。
- `dependencies = [` 五个运行依赖,每个带一个下界(`>=`),这是 `uv add` 自动加的,具体版本由 `uv.lock` 决定。
- `[build-system]` 构建后端,uv 的默认值。
- `dev = [` 四个开发依赖。
- `"pre-commit<4.6.1",` 唯一带上界的一行,理由写在 README 里:新版 pre-commit 要求 git 不低于 2.31。
- `[tool.ruff]` ruff 的全局设置。
- `select = ["E", "F", "I", "UP", "B"]` 五类规则。
- `[tool.pytest.ini_options]` pytest 的设置。
- `[tool.basedpyright]` 类型检查设置。

</div>

零件和结果的对照:

| 文件 / 目录 | 哪一步 | 作用 |
| --- | --- | --- |
| `pyproject.toml` | 一、二、三、四、五 | 依赖、ruff、pytest、basedpyright 配置 |
| `uv.lock` | 二 | 锁定版本,必须提交 |
| `.python-version` | 一 | 告诉 uv 用 Python 3.12 |
| `src/supportpilot/` | 一、六 | 业务代码,七个子包对应架构图 |
| `tests/test_smoke.py` | 四 | 第一个测试,守住「每个子包都能 import」 |
| `.pre-commit-config.yaml` | 五 | 提交前和推送前的检查 |
| `docs/PRD.md` | 六 | Day 437 的 PRD |
| `.gitignore` | 六 | 密钥、缓存不进仓库 |
| `README.md` | 六 | 开发命令的雏形,Day 446 补全 |
| `data/`、`db/`、`evals/`、`scripts/`、`scratch/` | 六 | 后面几十天要放文件的目录 |

## 动手练习

### 练习 1:不装钩子会怎样

在刚才的 `~/supportpilot-copy` 里,不运行 `pre-commit install`,直接提交一个违规的文件,看会不会被拦;再手动运行一次检查,看抓到什么。想一想为什么 CI 里也要跑同样的检查。

<details><summary>参考答案</summary>

```bash
cd ~/supportpilot-copy
printf 'import os\n\ndef f(x = []):\n    return x\n' > tests/bad.py
git add tests/bad.py
git commit -m "feat: 一个不合规的文件"
uv run pre-commit run --all-files
```

<div class="line-notes">

- `cd ~/supportpilot-copy` 刚才克隆出来、没有装过钩子的那个副本。
- `printf 'import os\n\ndef f(x = []):\n    return x\n' > tests/bad.py` 写一个有三处问题的文件:没用的 `import os`、没排序(只有一个也要和后面空两行)、默认参数是 `[]`。
- `git add tests/bad.py` 加进暂存区。
- `git commit -m "feat: 一个不合规的文件"` 提交。没装钩子,不会有任何检查。
- `uv run pre-commit run --all-files` 手动运行全部钩子,`--all-files` 是对仓库里所有文件跑,不只是这次改动的。

</div>

```text
$ git commit -m feat: 一个不合规的文件
[main 4b19a1a] feat: 一个不合规的文件
 1 file changed, 4 insertions(+)
 create mode 100644 tests/bad.py
$ uv run pre-commit run --all-files
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check toml...............................................................Passed
check for added large files..............................................Passed
detect private key.......................................................Passed
ruff check...............................................................Failed
- hook id: ruff-check
- exit code: 1

I001 [*] Import block is un-sorted or un-formatted
 --> tests/bad.py:1:1
  |
1 | import os
  | ^^^^^^^^^
2 |
3 | def f(x = []):
  |
help: Organize imports
  |
2 |
3 +
4 | def f(x = []):
  |

F401 [*] `os` imported but unused
 --> tests/bad.py:1:8
  |
1 | import os
  |        ^^
2 |
3 | def f(x = []):
  |
help: Remove unused import: `os`
  |
  - import os
1 |
  |

B006 Do not use mutable data structures for argument defaults
 --> tests/bad.py:3:11
  |
1 | import os
2 |
3 | def f(x = []):
  |           ^^
4 |     return x
  |
help: Replace with `None`; initialize within function
  |
2 |
  - def f(x = []):
3 + def f(x = None):
4 +     if x is None:
5 +         x = []
6 |     return x
  |
note: This is an unsafe fix and may change runtime behavior

Found 3 errors.
[*] 2 fixable with `--fix` (1 unsafe fix available with `--fix --unsafe-fixes`).

ruff format..............................................................Failed
- hook id: ruff-format
- files were modified by this hook

1 file reformatted, 11 files left unchanged
```

没装钩子,`git commit` 直接成功(`[main 某个哈希]` 那一行,没有任何检查输出),违规文件进了历史。然后手动跑,`ruff check` 报出三条,`ruff format` 还改了文件。

这就是为什么 **CI 里要再跑一遍同样的命令**(`uv run pre-commit run --all-files`,Day 427 的 `ci.yml` 里加一步)。本地钩子是便利,不是保证:有人没装、有人用 `git commit --no-verify` 跳过,都会放行。只有 CI 是任何人都绕不开的那一道。

</details>

### 练习 2:骨架测试,守住「每个子包都有 `__init__.py`」

`test_smoke.py` 里的七个子包名是手写的。再写一个测试:不用手写列表,自动扫 `src/supportpilot/` 下的每个子目录,都必须有 `__init__.py`;另外 `docs/PRD.md` 必须存在,而且第一行是「# SupportPilot PRD」开头。写好以后故意删掉 `obs/__init__.py`,看哪个测试红。

<details><summary>参考答案</summary>

```python
# supportpilot/tests/test_skeleton.py
"""骨架测试:每个子包都有 __init__.py,PRD 在该在的地方。"""

from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
PACKAGES = sorted(p for p in (ROOT / "src" / "supportpilot").iterdir() if p.is_dir() and p.name != "__pycache__")


@pytest.mark.parametrize("pkg", PACKAGES, ids=lambda p: p.name)
def test_has_init(pkg: Path):
    assert (pkg / "__init__.py").exists()


def test_prd_is_in_repo():
    text = (ROOT / "docs" / "PRD.md").read_text(encoding="utf-8")
    assert text.startswith("# SupportPilot PRD")
```

<div class="line-notes">

- `from pathlib import Path` 路径对象([Day 37](/blog/agent-zero/day-037-pathlib/))。
- `ROOT = Path(__file__).resolve().parent.parent` 从当前测试文件往上走两级,得到仓库根目录。`__file__` 是 `tests/test_skeleton.py`,`.parent` 是 `tests/`,再 `.parent` 是根。
- `PACKAGES = sorted(p for p in (ROOT / "src" / "supportpilot").iterdir() if p.is_dir() and p.name != "__pycache__")` 列出所有子目录,排除 Python 自己建的 `__pycache__`。`sorted` 保证每次顺序一样,报告好读。`/` 在 `Path` 上是拼接路径。
- `@pytest.mark.parametrize("pkg", PACKAGES, ids=lambda p: p.name)` 每个子目录跑一次;`ids=lambda p: p.name` 让报告里显示 `test_has_init[obs]` 而不是一长串绝对路径。
- `assert (pkg / "__init__.py").exists()` 目录里要有 `__init__.py`。
- `text = (ROOT / "docs" / "PRD.md").read_text(encoding="utf-8")` 读 PRD 全文。
- `assert text.startswith("# SupportPilot PRD")` 第一行标题没被改坏、文件不是空的。

</div>

```text
$ uv run pytest tests/test_skeleton.py -q
........                                                                 [100%]
8 passed in 0.02s
--- 删掉 obs/__init__.py 以后
$ uv run pytest tests/test_skeleton.py -q
....F...                                                                 [100%]
=================================== FAILURES ===================================
______________________________ test_has_init[obs] ______________________________

pkg = PosixPath('/Users/你/supportpilot-copy/src/supportpilot/obs')

    @pytest.mark.parametrize("pkg", PACKAGES, ids=lambda p: p.name)
    def test_has_init(pkg: Path):
>       assert (pkg / "__init__.py").exists()
E       AssertionError: assert False
E        +  where False = exists()
E        +    where exists = (PosixPath('/Users/你/supportpilot-copy/src/supportpilot/obs') / '__init__.py').exists

tests/test_skeleton.py:14: AssertionError
=========================== short test summary info ============================
FAILED tests/test_skeleton.py::test_has_init[obs] - AssertionError: assert False
1 failed, 7 passed in 0.09s
$ uv run pytest tests/test_skeleton.py -q
........                                                                 [100%]
8 passed in 0.02s
```

把 `obs/__init__.py` 删掉,`test_has_init[obs]` 红了,其他 7 个绿。报告里 `[obs]` 这个编号就是 `ids=` 的作用,一眼知道是哪个包。`git checkout` 恢复之后又是 8 个全绿。注意这里报了 8 个测试,是 7 个子包加 1 个 PRD 检查。

这条测试和 `test_smoke.py` 的分工:`test_smoke.py` 守「清单里的七个能 import」,这条守「目录里实际有的,每个都是合格的包」。以后有人新建 `src/supportpilot/utils/` 却忘了 `__init__.py`,它会抓到;而且和 Day 438 的孤儿检查一个意思:`utils` 没有对应的方块,`check_arch.py` 也会抓到,两道防线。

(这个测试没有放进正式仓库,它在练习用的副本里跑的。你可以决定要不要放进 `tests/`。)

</details>

### 练习 3:推送被拦下

把 `pre-push` 钩子也实际看一次。在副本里装钩子,建一个本地的空仓库当远程(不需要 GitHub),提交一个会红的测试,尝试推送;再修好,再推。

<details><summary>参考答案</summary>

```bash
git init -q --bare ~/remote.git
git remote set-url origin ~/remote.git
uv run pre-commit install
printf 'def test_always_red():\n    assert 1 + 1 == 3\n' > tests/test_red.py
git add tests/test_red.py
git commit -m "test: 一个会红的测试"
git push -u origin main
```

<div class="line-notes">

- `git init -q --bare ~/remote.git` 建一个「裸仓库」当远程。`--bare` 没有工作目录,只有历史,GitHub 服务器上的仓库就是这种。
- `git remote set-url origin ~/remote.git` 副本是从 `~/supportpilot` 克隆来的,`origin` 原来指着它;改成指向裸仓库。如果用 `git remote add` 会报 `remote origin already exists`,我第一次就撞到了。
- `uv run pre-commit install` 装上 commit 和 push 两个钩子(靠配置里的 `default_install_hook_types`)。
- `printf 'def test_always_red():\n    assert 1 + 1 == 3\n' > tests/test_red.py` 一个必红的测试。
- `git commit -m "test: 一个会红的测试"` 能提交成功:commit 阶段不跑 pytest,ruff 也查不出它错在逻辑上。
- `git push -u origin main` 推送时 pre-push 钩子触发,跑 pytest。

</div>

```text
$ uv run pre-commit install
pre-commit installed at .git/hooks/pre-commit
pre-commit installed at .git/hooks/pre-push
$ git commit -m test: 一个会红的测试
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...........................................(no files to check)Skipped
check toml...........................................(no files to check)Skipped
check for added large files..............................................Passed
detect private key.......................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
[main 8eedc55] test: 一个会红的测试
 1 file changed, 2 insertions(+)
 create mode 100644 tests/test_red.py
$ git push -u origin main
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...........................................(no files to check)Skipped
check toml...........................................(no files to check)Skipped
check for added large files..............................................Passed
detect private key.......................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
pytest...................................................................Failed
- hook id: pytest
- exit code: 1

F........                                                                [100%]
=================================== FAILURES ===================================
_______________________________ test_always_red ________________________________

    def test_always_red():
>       assert 1 + 1 == 3
E       assert (1 + 1) == 3

tests/test_red.py:2: AssertionError
=========================== short test summary info ============================
FAILED tests/test_red.py::test_always_red - assert (1 + 1) == 3
1 failed, 8 passed in 0.09s

error: failed to push some refs to '/Users/你/remote.git'
--- 修好再推
$ git commit -m revert: 去掉红的测试
trim trailing whitespace.............................(no files to check)Skipped
fix end of files.....................................(no files to check)Skipped
check yaml...........................................(no files to check)Skipped
check toml...........................................(no files to check)Skipped
check for added large files..........................(no files to check)Skipped
detect private key...................................(no files to check)Skipped
ruff check...........................................(no files to check)Skipped
ruff format..........................................(no files to check)Skipped
[main 7f5c17d] revert: 去掉红的测试
 1 file changed, 2 deletions(-)
 delete mode 100644 tests/test_red.py
$ git push -u origin main
trim trailing whitespace.............................(no files to check)Skipped
fix end of files.....................................(no files to check)Skipped
check yaml...........................................(no files to check)Skipped
check toml...........................................(no files to check)Skipped
check for added large files..........................(no files to check)Skipped
detect private key...................................(no files to check)Skipped
ruff check...........................................(no files to check)Skipped
ruff format..........................................(no files to check)Skipped
pytest...................................................................Passed
To /Users/你/remote.git
 * [new branch]      main -> main
Branch 'main' set up to track remote branch 'main' from 'origin'.
```

commit 成功了(八个 commit 钩子都过,`pytest` 不在其中),push 时才触发 `pytest`:`1 failed, 8 passed`,推送被拒绝(`error: failed to push some refs`)。我把那个红的测试 `git rm` 掉再提交、再推,这次 `pytest...Passed`,推送成功(`* [new branch] main -> main`)。

这就是我把 pytest 放在 `pre-push` 而不是 `pre-commit` 的理由:提交是高频动作,几秒钟的检查没关系,几十秒的完整测试会让人想用 `--no-verify` 绕开;推送频率低得多,等一等是合理的。以后 Day 446 的 `make test` 会换掉这一行里的命令(跳过要连数据库和模型的测试)。

</details>

### 练习 4:`uv sync --no-dev`

线上镜像里不需要 pytest、ruff。在副本里运行 `uv sync --no-dev`,再运行 `uv run --no-sync python -m pytest`,看会发生什么;然后 `uv sync` 恢复。

<details><summary>参考答案</summary>

```bash
uv sync --no-dev
uv run --no-sync python -m pytest
uv sync
uv run pytest -q
```

<div class="line-notes">

- `uv sync --no-dev` 把 `.venv` 同步成「只有运行依赖」的状态,开发依赖组被卸载。
- `uv run --no-sync python -m pytest` `--no-sync` 让 `uv run` 不要自动重新同步环境,否则它会悄悄把 pytest 又装回来,实验就没意义。用 `python -m pytest` 而不是直接 `pytest`,是因为我机器上系统 Python 里恰好也装了 pytest,直接写会跑到那一个(我第一次就是这样,看到的是 Python 3.10 的报告,差点以为实验没生效)。
- `uv sync` 恢复,开发依赖重新装回来。
- `uv run pytest -q` 确认恢复。

</div>

```text
$ uv sync --no-dev
Resolved 66 packages in 5ms
Uninstalled 16 packages in 1.12s
 - basedpyright==1.40.2
 - cfgv==3.5.0
 - distlib==0.4.4
 - filelock==4.2.4
 - identify==2.6.20
 - iniconfig==2.3.1
 - nodeenv==1.11.0
 - nodejs-wheel-binaries==24.19.0
 - platformdirs==4.13.5
 - pluggy==1.7.0
 - pre-commit==4.6.0
 - pygments==2.21.0
 - pytest==9.1.1
 - python-discovery==1.6.4
 - ruff==0.17.3
 - virtualenv==21.14.13
$ uv run --no-sync python -m pytest
/Users/你/supportpilot-copy/.venv/bin/python: No module named pytest
$ uv sync
Resolved 66 packages in 5ms
Installed 16 packages in 347ms
 + basedpyright==1.40.2
 + cfgv==3.5.0
 + distlib==0.4.4
 + filelock==4.2.4
 + identify==2.6.20
 + iniconfig==2.3.1
 + nodeenv==1.11.0
 + nodejs-wheel-binaries==24.19.0
 + platformdirs==4.13.5
 + pluggy==1.7.0
 + pre-commit==4.6.0
 + pygments==2.21.0
 + pytest==9.1.1
 + python-discovery==1.6.4
 + ruff==0.17.3
 + virtualenv==21.14.13
$ uv run pytest -q
........                                                                 [100%]
8 passed in 0.02s
```

`--no-dev` 卸载了 16 个包,包括 `pytest`、`ruff`、`pre-commit`、`basedpyright` 和它们的依赖(输出里我只截了前面一部分),此时运行 pytest 报 `No module named pytest`;`uv sync` 装回 16 个,又是 `8 passed`。线上镜像用 `uv sync --no-dev`(Day 490 Docker 化时会用到),镜像里就不会带测试和检查工具,更小,也少了攻击面。

</details>

**验收标准**:`~/supportpilot` 里 `uv run pytest` 8 个通过、`uv run ruff check` 和 `ruff format --check` 通过、`uv run basedpyright` 0 错误;`uv run pre-commit run --all-files` 八个钩子全 `Passed`;你亲手让一次提交被拦下(ruff 或私钥);`check_arch.py --day 441 ~/supportpilot` 三项都通过;仓库里有 `docs/PRD.md`,第一次提交已经完成;能不看文章默写 `pyproject.toml` 里 ruff 和 pytest 两段、说出每个钩子是干什么的。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 可编辑安装 | 把项目以「指向源码」的方式装进 `.venv`,改了源码立刻生效,不用重装。`uv run` 会自动做 |
| src 布局 | 业务代码放在 `src/包名/` 下面,而不是仓库根目录。好处是测试跑的一定是装好的包 |
| 依赖组 `[dependency-groups]` | `pyproject.toml` 里按用途给依赖分组,`dev` 是开发用的。相当于 `devDependencies` |
| 锁文件 `uv.lock` | 记录实际装到的每个包的确切版本,提交进 git,保证所有人装到一样的 |
| ruff | Rust 写的 Python 工具,同时做查错(`ruff check`)和排版(`ruff format`),相当于 ESLint 加 Prettier |
| lint(静态检查) | 不运行代码,只读源码找问题:没用的 import、可疑的写法。ruff check 做的就是这个 |
| 规则代号(E、F、I、UP、B) | ruff 的规则按字母分类,`select` 里选开哪几类;`F401` 是「F 类第 401 号」,没用的 import |
| basedpyright | 类型检查器,读类型标注找类型错误,相当于 `tsc --noEmit`。`standard` 档是中等严格度 |
| git hook(钩子) | 放在 `.git/hooks/` 里的可执行文件,git 在特定时机(提交前、推送前)自动运行它 |
| pre-commit | 管理 git 钩子的工具:读 `.pre-commit-config.yaml`,下载各个检查,生成钩子文件 |
| 冒烟测试 | 最简单的一层检查:通电看冒不冒烟。这里指「包能 import、版本号读得到」 |
| `.gitkeep` | 放进空目录的空文件,为了让 git 肯跟踪这个目录。名字只是约定 |
| 暂存区(staged) | `git add` 之后、`git commit` 之前文件所在的地方。pre-commit 只检查暂存区里的文件 |
| `--no-verify` | `git commit`/`git push` 的选项,跳过所有钩子。紧急时能用,所以 CI 里必须再检查一遍 |

## 常见误区

**拿 `uv init` 的默认值就开工。** 样板里的 `[project.scripts]` 指向一个你用不上的 `main()`,`description` 是 `Add your description here`。这些现在不改,以后就一直留在你的 GitHub 首页上。

**把所有依赖都装进 `dependencies`。** pytest、ruff 装进运行依赖,线上镜像就会带着它们。开发工具一律 `--dev`。

**规则开得越多越好。** 开了 `RUF` 的全角标点规则,中文项目里满屏报错,最后人人都学会加 `# noqa`。选和项目相配的,每一类能说出为什么开。

**pre-commit 跑出「全跳过」就以为通过了。** `(no files to check) Skipped` 的意思是没有任何文件可查,不是查过了没问题。我第一次就是在没 `git add` 的情况下看到的。

**钩子改了文件,就直接再提交。** 自动修的钩子改的是工作区,不是暂存区。要先 `git add` 把它的改动加进暂存区,再提交,否则 pre-commit 会警告 stash 冲突,把自动修改回滚。

**以为装了钩子,所有人就有钩子。** `.git/hooks` 不属于仓库内容,不会跟着克隆走。每个克隆都要自己 `pre-commit install`,CI 里也要再跑一次。

**最新版 + 老 git。** `pre-commit 4.7.0` 要求 git 不低于 2.31,而不少机器上是更老的版本。碰到 `unknown option` 这类报错,先 `git --version`。

**把 `.env.example` 一起忽略。** `.env.*` 会匹配到它,必须用 `!.env.example` 放回来,而且顺序要在后面,否则新来的同事不知道要配哪些变量。

**一次装完所有以后要用的依赖。** 依赖越多,以后每一次部署越重,冲突越多。哪天用到哪天装;今天装的 5 个都是这一周内要用到的。

## 学习资料

### 文档与文章

- [uv · Creating projects](https://docs.astral.sh/uv/concepts/projects/init/):`uv init` 的 `--app`、`--lib`、`--package` 各建出什么,今天第一步的依据。10 分钟。
- [uv · Managing dependencies](https://docs.astral.sh/uv/concepts/projects/dependencies/):`uv add`、`--dev`、依赖组的完整说明。15 分钟。
- [Ruff · Configuration](https://docs.astral.sh/ruff/configuration/) 和 [Ruff · Rules](https://docs.astral.sh/ruff/rules/):配置项和全部规则的列表。看一眼 `E`、`F`、`I`、`UP`、`B` 各自包含什么。20 分钟。
- [pre-commit 官网](https://pre-commit.com/):怎么写配置、怎么自己写钩子。先读首页的「Quick start」。15 分钟。
- [pytest · Configuration](https://docs.pytest.org/en/stable/reference/customize.html):`pyproject.toml` 里 `[tool.pytest.ini_options]` 能写哪些选项。10 分钟。
- [basedpyright 文档](https://docs.basedpyright.com/):`standard` 和别的档位的区别。10 分钟。
- [PEP 735 · Dependency Groups](https://peps.python.org/pep-0735/):依赖组这个新标准的出处。只看摘要和动机即可。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13WGHz8EEz&autoplay=0&high_quality=1" title="从pip到uv:一口气梳理现代Python项目管理全流程!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · 从pip到uv:一口气梳理现代Python项目管理全流程! · 16 分钟,播放 26 万多。Day 10 推荐过。今天重看后半段,对照你刚做的 `uv init`、`uv add --dev`。视频里的 uv 比 0.13 早,命令行为略有差别,以今天文章里的输出为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1XPj4zpE1a&autoplay=0&high_quality=1" title="Ruff使用指南:最新的超快速代码格式化工具(Python五分钟)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>赛博红兔CyberHongTu · Ruff使用指南:最新的超快速代码格式化工具(Python五分钟) · 10 分钟。Day 9 推荐过。今天带着「我刚选了 E、F、I、UP、B 五类规则」的心思再看,注意视频里的 Ruff 是更早的版本,默认规则比现在少。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/xhg1dJHLqSM" title="Boost Your Python Code Quality: Pre-commit Tutorial (UV & Ruff)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Timnology · Boost Your Python Code Quality: Pre-commit Tutorial (UV & Ruff) · 英文,可开自动字幕。用的就是今天这一套:uv 加 ruff 加 pre-commit,从零配到提交被拦。对照看他配置文件里和我们不同的地方。</figcaption>
</figure>

### 书籍

- Brian Okken《Python Testing with pytest》第 2 版(Pragmatic Bookshelf,2022):讲 pytest 最系统的一本书,配置、参数化、fixture 都有。今天读配置文件和参数化那两章。我没查到可靠的中文版信息,只写英文原版。
- Python Packaging User Guide 里的 [Writing your pyproject.toml](https://packaging.python.org/en/latest/guides/writing-pyproject-toml/):不是书,是官方指南,把 `pyproject.toml` 每个字段讲清楚,「项目元数据」那一段值得读。

### 开源项目与代码

- [astral-sh/ruff](https://github.com/astral-sh/ruff) 和 [astral-sh/uv](https://github.com/astral-sh/uv):今天用的两个工具,都是 Astral 公司开源的。看 README 里的基准测试,理解它们为什么快。
- [pre-commit/pre-commit-hooks](https://github.com/pre-commit/pre-commit-hooks):今天配置里的那批通用检查,每个钩子的源码都很短,读 `detect_private_key.py` 看它是怎么认出私钥的。

## 自测

1. 为什么毕业项目要用 `--package` 建成可安装的包,而 Day 10 的练习仓库用 `--no-package`?

<details><summary>答案</summary>

练习仓库只是一堆脚本,从仓库根目录运行就行。毕业项目里 `scripts/`、`tests/`、`scratch/` 到处要 `from supportpilot.xxx import ...`,需要 `supportpilot` 在任何位置都能被 import,就得把它装进 `.venv`。src 布局加可编辑安装,既能直接按包名导入,改了源码又不用重装;测试跑的也是「装好的包」,不会被当前目录碰巧能 import 盖住打包问题。

</details>

2. `uv add` 和 `uv add --dev` 的区别是什么?线上镜像为什么要 `uv sync --no-dev`?

<details><summary>答案</summary>

前者写进 `dependencies`,是运行必需的;后者写进 `[dependency-groups]` 的 `dev` 组,只在开发和检查时用,相当于 `devDependencies`。线上不需要 pytest、ruff、pre-commit 这些,`--no-dev` 让镜像更小、更少攻击面。练习 4 演示过:`--no-dev` 后 `python -m pytest` 报 `No module named pytest`。

</details>

3. 我没开 ruff 的 `RUF` 规则,为什么?

<details><summary>答案</summary>

`RUF001` 到 `RUF003` 会把中文全角标点(`,` `(` `)`)当成「容易和英文标点混淆」的可疑字符,逐个报警。这个项目的中文注释、给客户的回复到处都是全角标点,开了会满屏报错,最后大家只会习惯性地加 `# noqa`。规则要和项目相配,不是越多越好。今天用一个带全角标点的小文件实测了,4 处报错。

</details>

4. pre-commit 输出 `trim trailing whitespace...Failed`,但说明里写的是 `files were modified by this hook`。这算不算真的有问题?接下来该做什么?

<details><summary>答案</summary>

不是代码有问题,是钩子**替你改了文件**(这里是删了行尾空格),但它改的是工作区,不在你准备提交的暂存区里,所以这次提交被取消。看一眼它改了什么,`git add` 把改动加进暂存区,再提交。如果不重新 `add` 就再提交,pre-commit 会警告 stash 冲突并把自动修改回滚,提交仍然失败。

</details>

5. 同事克隆了仓库,为什么他的提交不会被检查?怎么补救?

<details><summary>答案</summary>

钩子文件在 `.git/hooks/` 里,而 `.git/` 不属于仓库内容,不会跟着克隆走,`ls .git/hooks` 只有 `.sample` 文件。每个克隆都要自己运行 `uv run pre-commit install`,所以 README 里要写这一步;同时 CI 里要再跑一遍 `pre-commit run --all-files`,因为本地钩子能被忘记或被 `--no-verify` 绕开,只有 CI 绕不开。

</details>

6. **面试题**:「你的项目是怎么保证代码质量不随时间变差的?」

<details><summary>答案</summary>

我在仓库建好的第一天就把检查装上了,而不是等代码多了再补。用 uv 管依赖和锁版本,ruff 查错加排版,pytest 做测试,basedpyright 做类型检查,这些都写在 `pyproject.toml` 里。再用 pre-commit 把它们挂在 git 上:每次 commit 前自动跑 ruff 和一批通用检查(行尾空格、大文件、私钥),push 前再跑完整测试;违规的提交直接被拦下,我实测过拦下一个带未使用 import 的文件和一把假私钥。因为钩子不会跟着克隆走,CI 里也跑同一套检查,作为任何人都绕不过的一道。我还写了一个 `check_arch.py` 把仓库目录和我画的架构表对账,发现架构表漏了五个工程文件,当场补上。选规则时我刻意没开会对中文标点报警的 RUF 类规则,因为规则要和项目相配。

</details>

## 明天预告

明天是 Day 442 · 搭骨架(二):配置管理。今天装了 `pydantic-settings`,但还没用它。明天写 `src/supportpilot/config.py` 里的 `Settings` 类,把模型地址、密钥、价格、各种上限都从环境变量和 `.env` 里读进来,并建好 `.env.example`(今天 `.gitignore` 里特意留了位置)。配置是后面每一天都要用到的东西:Day 443 连数据库要它,Day 457 的 `LLMClient` 要它,Day 462 的 `max_revisions`、Day 463 的价格都从它里面取。
