---
title: 'Day 446 · 搭骨架(六):Makefile、测试、README'
description: '把散落的 uv run python scripts/... 收进一个 Makefile(make data 一条建好全部,make test 不连库不花钱),用 pytest 的 db、llm 标记把测试分成两层并开启 --strict-markers,写一份能照着做的 README,再用测试守住 README 和 Makefile 对得上,最后在全新克隆加全新数据库上从头走一遍。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'supportpilot', 'makefile', 'pytest', 'readme', 'agent-zero']
series: 'agent-zero'
day: 446
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 445](/blog/agent-zero/day-445-bizdata/) 造好了业务库:200 个客户、459 张账单,其中 12 个剧情客户各对应一个退款场景。到这里 SupportPilot 仓库里有了配置、表结构、帮助中心、业务数据、54 个测试。可是要把它们拼起来,得记住一串命令:`uv run python scripts/init_db.py`、`scripts/seed_db.py`、`scripts/gen_kb.py`、`scripts/check_kb.py`……三周后你自己都想不起顺序。

今天把这些收口:一个 Makefile 给每件事起个名字,测试分层让最常跑的那组不连库不花钱,一份 README 让别人(或者三个月后的你)能照着从零跑起来。骨架这一周(Day 441–446)就到今天结束。

## 今天要解决的问题

今天的新东西是两个:**Makefile**(给命令起名字)和 **pytest 标记**(把测试分层)。README 不算新概念,但今天要像对待代码一样对待它:有测试守着,并且真的有人照着它走一遍。学完你应该能:

1. 写出一个 Makefile,`make data` 一条命令建表、造数、生成帮助中心,`make help` 列出所有命令。
2. 用 `db`、`llm` 两个标记把测试分层,`make test` 只跑不连库、不调模型的那一层,并解释 `--strict-markers` 防的是什么。
3. 写一份 README,并写测试保证里面提到的每个 `make` 命令都存在、Makefile 里每个命令都有说明。
4. 在一个全新的克隆和全新的数据库上,只照 README 把项目跑起来。

今天不调模型,不花钱(¥0)。预计用时 3 小时。前置:[Day 441](/blog/agent-zero/day-441-repo-init/) 到 [Day 445](/blog/agent-zero/day-445-bizdata/) 的仓库;[Day 73](/blog/agent-zero/day-073-pytest-3/) 的 fixture;[Day 72](/blog/agent-zero/day-072-pytest-2/) 的 pyproject 里配 pytest;终端命令([Day 3](/blog/agent-zero/day-003-terminal-1/))。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 Makefile 里 `help` 以外的所有命令和 `pyproject.toml` 里的标记配置;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:这就是 package.json 的 scripts

你的前端项目里一定有:

```json
"scripts": { "dev": "vite", "test": "vitest", "lint": "eslint ." }
```

新同事克隆项目,敲 `npm run dev`,不用知道背后是 vite。Makefile 做的是同一件事:**把命令起个名字,让人记名字不记命令**。

| 前端 | 今天 |
| --- | --- |
| `package.json` 的 `scripts` | `Makefile` |
| `npm run test` | `make test` |
| `npm run` 不带参数,列出所有脚本 | `make help`(要自己写一小段) |
| `"pretest": "..."` 先跑某个脚本 | `data: init seed kb` 冒号后面的「前置命令」 |
| `package.json` 里 `scripts` 只能写一行 shell | Makefile 一个命令可以写多行 |

为什么不直接用 `package.json` 那一套?Python 项目没有通用的等价物(`pyproject.toml` 不管命令),`make` 是 macOS 和 Linux 上现成的,不用多装东西。有人偏爱 `just` 之类的新工具,语法更友好,但那是多一个要装的依赖;今天选 make 就是图它到处都有。我也不喜欢它的老脾气,下面马上会撞上两个。

## 第一步:最小的 Makefile,和两个老脾气

在仓库根目录建 `scratch/Makefile.v1`(先在 `scratch/` 里试,不污染仓库):

```makefile
init:
	uv run python scripts/init_db.py
seed:
	uv run python scripts/seed_db.py
test:
	uv run pytest -m "not db and not llm" -q
```

结构只有一种:`目标名:` 一行,下面缩进的几行是它要执行的命令。运行用 `make -f scratch/Makefile.v1 init seed`,`-f` 指定文件(不指定时 make 找当前目录的 `Makefile`),后面可以写多个目标,按顺序执行:

```bash
make -f scratch/Makefile.v1 init seed
```

```text
uv run python scripts/init_db.py
schema ready
uv run python scripts/seed_db.py
customers: 200
subscriptions: 200
invoices: 459
tickets: 152
```

make 默认会把每条命令在执行前打印出来(第 1、3 行),再显示命令自己的输出。这能用了。下面是两个老脾气。

**脾气一:缩进必须是 Tab。** 网页复制过去的代码,Tab 常常变成空格:

```bash
printf 'init:\n    uv run python scripts/init_db.py\n' > scratch/Makefile.spaces
make -f scratch/Makefile.spaces init
```

```text
scratch/Makefile.spaces:2: *** missing separator.  Stop.
```

`missing separator` 的意思是 make 在第 2 行没找到它期待的 Tab 分隔。编辑器里显示不出 Tab 和空格的区别,所以这个报错很容易让人懵。改回 Tab 就好;Zed 里可以打开「显示空白字符」看。

**脾气二:目标名碰上同名文件或目录。** make 本来是编译 C 程序用的:目标 `foo` 的意思是「生成文件 `foo`」,如果文件已经在、而且比它依赖的东西新,就不用再生成。我们的「目标」不是文件,只是命令名,可仓库里正好有个 `docs/` 目录。假如你想加一个 `make docs`:

```bash
printf 'docs:\n\t@echo "生成文档..."\n' > scratch/Makefile.docs
make -f scratch/Makefile.docs docs
```

```text
make: `docs' is up to date.
```

命令没有执行。make 看到当前目录已经有叫 `docs` 的东西,认为目标「已经是最新的」。解法是声明它是「假目标」:

```bash
printf '.PHONY: docs\ndocs:\n\t@echo "生成文档..."\n' > scratch/Makefile.docs2
make -f scratch/Makefile.docs2 docs
```

```text
生成文档...
```

`.PHONY` 告诉 make:这些名字不对应文件,每次都执行。所以我们的 Makefile 开头会把所有命令名都列进去,哪怕现在没有同名的目录,以后加了也不出事。后面的测试会检查「每个命令都在 `.PHONY` 里」。

## 第二步:先把测试分好层

完整的 Makefile 里 `make test` 会写成 `pytest -m "not db and not llm"`,意思是「跑没有标 `db`、也没有标 `llm` 的测试」。所以先把标记做出来。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="测试分层:不连库的 52 个由 make test 跑,连库的 7 个标了 db,由 make test-all 一起跑;llm 标记还没有测试">
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="14" y="30" width="290" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="159" y="56" text-anchor="middle" fill="var(--ink)">不连库、不调模型:52 个</text>
    <text x="159" y="78" text-anchor="middle" fill="var(--ink-soft)" font-size="11">make test,每次提交前跑</text>
    <rect x="324" y="30" width="150" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="399" y="56" text-anchor="middle" fill="var(--ink)">@db:7 个</text>
    <text x="399" y="78" text-anchor="middle" fill="var(--ink-soft)" font-size="11">要连 Postgres</text>
    <rect x="494" y="30" width="132" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="560" y="56" text-anchor="middle" fill="var(--ink)">@llm:0 个</text>
    <text x="560" y="78" text-anchor="middle" fill="var(--ink-soft)" font-size="11">Day 463 起有</text>
    <line x1="14" y1="130" x2="474" y2="130" stroke="var(--ink-soft)"/>
    <text x="244" y="152" text-anchor="middle" fill="var(--ink)">make test-all:前两层一起跑,共 59 个</text>
    <line x1="14" y1="122" x2="14" y2="138" stroke="var(--ink-soft)"/>
    <line x1="474" y1="122" x2="474" y2="138" stroke="var(--ink-soft)"/>
    <text x="14" y="182" fill="var(--ink-faint)" font-size="11">越往右,越慢、越依赖外部服务、越可能花钱</text>
  </g>
</svg>
<figcaption>三层测试按「依赖什么」分:纯代码、数据库、模型。make test 只跑最左边那层,所以敢每次提交都跑。</figcaption>
</figure>

为什么要分层?看现状。仓库里现在有 54 个测试,其中 7 个要连真数据库(Day 443 的 `test_db.py` 4 个、`test_schema_live.py` 1 个、Day 445 的 `test_seed_live.py` 2 个)。它们在没起数据库时会**跳过**而不是失败,这个设计没问题,但问题有两个:每次都要先尝试连一次库(连不上要等超时),而且「跳过」会让输出里多一堆提示。更要紧的是,以后还会有第三类:真的调模型、真的花钱的测试(Day 463 之后)。这三类的运行成本差十万倍,应该能分开跑。

pytest 的做法叫**标记**(marker):在测试上贴标签,运行时用 `-m` 按标签筛选。先给 `test_db.py` 贴上(文件开头,import 之后):

```python
pytestmark = pytest.mark.db  # make test 会跳过这个文件里的所有测试
```

`pytestmark` 是 pytest 认的特殊变量名,放在模块顶层,整个文件里的测试都被贴上这个标签。用 `-m` 筛选:

```bash
uv run pytest -m "not db and not llm" -q
```

```text
..................................................                       [100%]
=============================== warnings summary ===============================
tests/test_db.py:10
  /Users/你/supportpilot/tests/test_db.py:10: PytestUnknownMarkWarning: Unknown pytest.mark.db - is this a typo?  You can register custom marks to avoid this warning - for details, see https://docs.pytest.org/en/stable/how-to/mark.html
    pytestmark = pytest.mark.db

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
50 passed, 4 deselected, 1 warning in 0.60s
```

筛选生效了:4 个 `test_db.py` 里的测试被 `deselected`(取消选择),其余 50 个跑了。但有一条警告:pytest 不认识 `db` 这个标签,问你是不是拼错了。解决办法是在 `pyproject.toml` 里**登记**标记,顺便打开 `--strict-markers`。先说为什么要打开,做个实验:把标签故意拼成 `dbb`,并把 `DATABASE_URL` 指向一个不存在的端口(模拟没起库的机器):

```bash
sed -i '' 's/pytest.mark.db$/pytest.mark.dbb/' tests/test_db.py
DATABASE_URL=postgresql://minliu@localhost:5999/nope uv run pytest -m "not db and not llm" -q 2>&1 | tail -12
```

```text
    pytestmark = pytest.mark.dbb

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
=========================== short test summary info ============================
SKIPPED [1] tests/test_db.py:34: 连不上数据库:connection failed: connection to server at "127.0.0.1", port 5999 failed: could not receive data from server: Connection refused
SKIPPED [1] tests/test_db.py:39: 连不上数据库:connection failed: connection to server at "127.0.0.1", port 5999 failed: could not receive data from server: Connection refused
SKIPPED [1] tests/test_db.py:47: 连不上数据库:connection failed: connection to server at "127.0.0.1", port 5999 failed: could not receive data from server: Connection refused
SKIPPED [1] tests/test_db.py:53: 连不上数据库:connection failed: connection to server at "127.0.0.1", port 5999 failed: could not receive data from server: Connection refused
SKIPPED [1] tests/test_schema_live.py:23: 数据库没就绪:connection failed: connection to server at "127.0.0.1", port 5999 failed: could not receive data from server: Connection refused
SKIPPED [1] tests/test_seed_live.py:24: 数据库没就绪:connection failed: connection to server at "127.0.0.1", port 5999 failed: could not receive data from server: Connection refused
SKIPPED [1] tests/test_seed_live.py:37: 数据库没就绪:connection failed: connection to server at "127.0.0.1", port 5999 failed: could not receive data from server: Connection refused
47 passed, 7 skipped, 1 warning in 0.28s
```

标签拼错成 `dbb` 以后,`-m "not db"` 筛不掉它们,四个测试照样去连库,最后「跳过」。只剩一条容易被忽略的警告。在 CI 或同事的机器上,这就是「本来不该碰数据库的测试碰了数据库」。`--strict-markers` 把「标签没登记」从警告升级成错误。在 `pyproject.toml` 的 `[tool.pytest.ini_options]` 里改成:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra --strict-markers"
pythonpath = ["scripts"]
markers = [
    "db: 需要连真数据库(先 make data)",
    "llm: 会真的调用大模型,花钱",
]
```

<div class="line-notes">

- `testpaths = ["tests"]` 不带路径运行 pytest 时,只在 `tests/` 里找([Day 441](/blog/agent-zero/day-441-repo-init/) 配的)。
- `addopts = "-ra --strict-markers"` `addopts` 是每次运行都自动加上的命令行参数。`-ra` 是 Day 441 加的,在结尾列出所有跳过、失败的原因,上面那几行 `SKIPPED [1] ...` 就是它打的。`--strict-markers` 是今天加的:标签没登记就报错。
- `pythonpath = ["scripts"]` Day 444 加的,让测试能 `import seed_db`。
- `markers = [` 登记标签,每项是「名字: 说明」。`db` 是给要连库的测试的;`llm` 现在没人用,先登记好,Day 463 起会有测试要用它。说明写在这里,`uv run pytest --markers` 能列出来。

</div>

再跑一次拼错的版本:

```bash
uv run pytest -m "not db and not llm" -q 2>&1 | tail -8
```

```text
==================================== ERRORS ====================================
______________________ ERROR collecting tests/test_db.py _______________________
'dbb' not found in `markers` configuration option
=========================== short test summary info ============================
ERROR tests/test_db.py - Failed: 'dbb' not found in `markers` configuration o...
!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
1 error in 0.28s
```

整个运行在收集阶段就停了,报错一句话指向 `dbb`。把它改回 `db` 就恢复:

```bash
sed -i '' 's/pytest.mark.dbb/pytest.mark.db/' tests/test_db.py
uv run pytest -m "not db and not llm" -q 2>&1 | tail -3
```

```text
..................................................                       [100%]
50 passed, 4 deselected in 0.54s
```

### 把连库的夹具搬进 conftest.py

三个连库的测试文件(`test_db.py`、`test_schema_live.py`、`test_seed_live.py`)现在各写了一遍「连不上就跳过」的代码,三份几乎一样。pytest 有个约定:放在 `tests/conftest.py` 里的夹具,同目录下所有测试文件不用 import 就能用。新建:

```python
# supportpilot/tests/conftest.py
"""所有测试共用的零件。conftest.py 里的 fixture 不用 import,pytest 自己会找到。"""

from collections.abc import Iterator

import psycopg
import pytest
from psycopg.rows import DictRow

from supportpilot.db import connect


@pytest.fixture
def conn() -> Iterator[psycopg.Connection[DictRow]]:
    """一条连真库的连接。连不上、或者库里还没建表,就跳过用到它的测试,不让 make test-all 变红。"""
    try:
        c = connect()
    except psycopg.OperationalError as e:
        pytest.skip(f"连不上数据库:{str(e).splitlines()[0]}")
    except psycopg.ProgrammingError as e:
        pytest.skip(f"库里还没建表(先 make init):{e}")
    with c:
        yield c
```

<div class="line-notes">

- `from collections.abc import Iterator` 夹具里用了 `yield`,它是个生成器,返回类型写 `Iterator[...]`([Day 99](/blog/agent-zero/day-099-generators/))。
- `import psycopg` 要捕获它的两种异常。
- `from psycopg.rows import DictRow` 连接的行类型。
- `from supportpilot.db import connect` Day 443 的连接函数。
- `@pytest.fixture` 一个夹具:测试函数的参数里写 `conn`,pytest 自动调用它,把 `yield` 出去的东西传进来([Day 73](/blog/agent-zero/day-073-pytest-3/))。
- `def conn() -> Iterator[psycopg.Connection[DictRow]]:` 返回的是「行是字典的连接」,所以测试里 `row["n"]` 不会被类型检查器报红。
- `c = connect()` 真的去连。
- `except psycopg.OperationalError as e:` 库没起、端口不对、密码错都是这个异常。
- `pytest.skip(f"连不上数据库:{str(e).splitlines()[0]}")` 跳过用到这个夹具的测试,并把原因的第一行带上,上面那几行 `SKIPPED` 的文字就是这么来的。
- `except psycopg.ProgrammingError as e:` Day 443 的「vector type not found」就是这个异常:库连上了但还没建表。
- `pytest.skip(f"库里还没建表(先 make init):{e}")` 提示里的 `make init` 是今天的命令名,不再写那一长串 `uv run python scripts/...`。
- `with c:` 测试结束后自动关连接。
- `yield c` 把连接交给测试,测试跑完再回到这里继续往下走,`with` 才结束。

</div>

三个测试文件各删掉自己的 `conn` 夹具(`test_schema_live.py` 里原来是函数内部的 `try`),把参数写成 `conn: psycopg.Connection[DictRow]`,并各加一行 `pytestmark = pytest.mark.db`。比如 `test_schema_live.py` 改完是这样:

```python
# supportpilot/tests/test_schema_live.py
"""每张表都得有主键:没有主键的表,Agent 重试时就会悄悄插进重复行。"""

import psycopg
import pytest
from psycopg.rows import DictRow

pytestmark = pytest.mark.db

ALL_TABLES = """
...(不变)
"""


def test_every_table_has_primary_key(conn: psycopg.Connection[DictRow]):
    all_tables = {r["name"] for r in conn.execute(ALL_TABLES)}
    with_pk = {r["name"] for r in conn.execute(WITH_PK)}
    assert all_tables, "一张表都没找到,先 make init"
    assert all_tables - with_pk == set()
```

改完确认:

```bash
uv run ruff check . --fix && uv run ruff format .
uv run basedpyright | tail -1
uv run pytest -m "not db and not llm" -q | tail -1
uv run pytest -q | tail -1
```

```text
0 errors, 0 warnings, 0 notes
47 passed, 7 deselected in 0.16s
54 passed in 0.59s
```

不连库那层 47 个,连库的 7 个,合起来还是 54。`ruff check --fix` 顺手删掉了两个文件里不再用的 import。

## 第三步:完整的 Makefile

标记就位,写真正的 Makefile,放在仓库根目录:

```makefile
# supportpilot/Makefile
# 缩进必须是 Tab,不是空格。
.PHONY: help up down init seed kb data test test-all lint check api
.DEFAULT_GOAL := help

help:       ## 列出所有命令
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-9s %s\n", $$1, $$2}'

up:         ## 用 Docker 起本地 Postgres(用 Postgres.app 的人跳过)
	docker compose up -d db
down:       ## 关掉本地 Postgres 容器(数据卷保留)
	docker compose down
init:       ## 建表(可重复运行)
	uv run python scripts/init_db.py
seed:       ## 重新造业务数据(会清空 biz 里所有表,也会先清对话快照)
	@if [ -f src/supportpilot/memory/checkpoint.py ]; then uv run python -m supportpilot.memory.checkpoint; fi
	uv run python scripts/seed_db.py
kb:         ## 生成帮助中心文章并检查
	uv run python scripts/gen_kb.py
	uv run python scripts/check_kb.py
data: init seed kb  ## 建表 + 造业务数据 + 生成帮助中心
test:       ## 单元测试:不连库、不调模型、不花钱
	uv run pytest -m "not db and not llm" -q
test-all:   ## 全部测试,包括要连数据库的
	uv run pytest -q
lint:       ## ruff 检查、格式检查、类型检查
	uv run ruff check .
	uv run ruff format --check .
	uv run basedpyright
check: lint test    ## 提交前的完整检查:lint + test
api:        ## 启动 HTTP 接口(Day 467 之后才有)
	uv run uvicorn supportpilot.api.app:app --reload --port 8000
```

<div class="line-notes">

- `# 缩进必须是 Tab,不是空格。` 写在文件第二行,下一个动手改它的人会感谢这一句。
- `.PHONY: help up down init seed kb data test test-all lint check api` 第一步讲过:这些都是命令名,不是文件,每次都执行。新增命令时这一行也要加,后面有测试盯着。
- `.DEFAULT_GOAL := help` 只敲 `make` 不带目标时执行哪个。默认是文件里第一个目标;这里明确指定成 `help`,敲 `make` 就看到命令列表。
- `help:       ## 列出所有命令` 冒号后面的 `## ...` 是普通注释,make 不认,但下面那条命令会把它读出来当说明。这是社区里很流行的「自带说明的 Makefile」写法。
- `@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST)` 行首的 `@` 让 make 不要把这条命令本身打印出来(只显示它的输出)。`$(MAKEFILE_LIST)` 是 make 自带的变量,值是正在读的 Makefile 文件名。`grep` 找出形如「目标名:……## 说明」的行,再交给后面的 `awk` 切开:用「冒号开头、`## ` 结尾」的一段做分隔,切出目标名和说明两个字段,按「make 目标名 说明」打印,`%-9s` 是目标名左对齐占 9 格。注意 awk 里的 `$$1`:在 Makefile 里 `$` 有特殊含义(变量),要传一个真正的 `$` 给 awk,必须写成 `$$`。
- `up:         ## 用 Docker 起本地 Postgres(用 Postgres.app 的人跳过)` 对应 Day 443 的 `docker-compose.yml`。我本机没有 Docker,这条和下一条没实跑。
- `docker compose up -d db` 只起 `db` 这一个服务,`-d` 放后台。
- `down:       ## 关掉本地 Postgres 容器(数据卷保留)` 对应 `docker compose down`,不带 `-v`,所以数据还在。
- `init:       ## 建表(可重复运行)` Day 443 的 `init_db.py`,每条 SQL 都带 `IF NOT EXISTS`,所以能反复跑。
- `seed:       ## 重新造业务数据` 说明里提到「也会先清对话快照」,下一行解释。
- `@if [ -f src/supportpilot/memory/checkpoint.py ]` 这是 shell 的 if:如果文件 `memory/checkpoint.py` 存在,就先运行它。这个文件是 Day 464 才建的(会话快照),Day 464 做实验时发现:重新造数后工单号又从 `T000001` 编起,旧快照里还留着上一轮的对话,会串到新工单上,所以造数之前要先清快照。现在这个文件不存在,这一行什么都不做;Day 464 之后自动生效,不用回来改 Makefile。
- `uv run python scripts/seed_db.py` 然后才造数。
- `kb:         ## 生成帮助中心文章并检查` 两条命令:生成、再检查,检查不通过时 make 在第二条就停下。Day 449 做完导入后,这里会再加一条。
- `data: init seed kb  ## 建表 + 造业务数据 + 生成帮助中心` 冒号后面的 `init seed kb` 是「前置目标」:执行 `data` 之前,先按顺序执行这三个。`data` 自己没有命令,它只是三个命令的组合。
- `test:       ## 单元测试:不连库、不调模型、不花钱` 日常用得最多的一条。
- `uv run pytest -m "not db and not llm" -q` 第二步做好的筛选。`-q` 让输出简短。
- `test-all:   ## 全部测试,包括要连数据库的` 不筛选,连库的也跑,前提是库已经起了、已经 `make init`。
- `lint:       ## ruff 检查、格式检查、类型检查` 三条命令,任何一条不通过 make 就停下。
- `check: lint test    ## 提交前的完整检查:lint + test` 又是一个只有前置、自己没命令的组合。
- `api:        ## 启动 HTTP 接口(Day 467 之后才有)` Day 467 的 `app.py` 建好之前这条会报找不到模块,先写上,这样 README 里的命令表不用以后再改。我没有实跑这一条。
- `uv run uvicorn supportpilot.api.app:app --reload --port 8000` `--reload` 让改了代码自动重启。

</div>

```bash
make
```

```text
  make help      列出所有命令
  make up        用 Docker 起本地 Postgres(用 Postgres.app 的人跳过)
  make down      关掉本地 Postgres 容器(数据卷保留)
  make init      建表(可重复运行)
  make seed      重新造业务数据(会清空 biz 里所有表,也会先清对话快照)
  make kb        生成帮助中心文章并检查
  make data      建表 + 造业务数据 + 生成帮助中心
  make test      单元测试:不连库、不调模型、不花钱
  make test-all  全部测试,包括要连数据库的
  make lint      ruff 检查、格式检查、类型检查
  make check     提交前的完整检查:lint + test
  make api       启动 HTTP 接口(Day 467 之后才有)
```

真正执行之前,先用 `-n`(dry run,只打印不执行)看一下 `make data` 会做什么:

```bash
make -n data
```

```text
uv run python scripts/init_db.py
if [ -f src/supportpilot/memory/checkpoint.py ]; then uv run python -m supportpilot.memory.checkpoint; fi
uv run python scripts/seed_db.py
uv run python scripts/gen_kb.py
uv run python scripts/check_kb.py
```

顺序是 `init → seed → kb`,和冒号后面写的一致。这个 `-n` 值得养成习惯,改 Makefile 之后先看它,比直接跑安全。然后真跑:

```bash
make data
```

```text
uv run python scripts/init_db.py
schema ready
uv run python scripts/seed_db.py
customers: 200
subscriptions: 200
invoices: 459
tickets: 152
uv run python scripts/gen_kb.py
wrote 62 articles to /Users/你/supportpilot/data/kb
uv run python scripts/check_kb.py
检查 62 篇文章: 通过
```

一条命令,四个脚本。`seed` 里那个条件分支,Day 464 之前走不到,我用一个临时的假文件试过它能触发:建 `src/supportpilot/memory/checkpoint.py`,里面只有 `if __name__ == "__main__": print("cleared 0 checkpoints")`,再 `make seed`:

```text
cleared 0 checkpoints
uv run python scripts/seed_db.py
customers: 200
subscriptions: 200
```

假文件试完就删了。真正的清快照逻辑是 Day 464 的事,这里只验证了「文件在就先运行它」这个机制。

### 前置目标的顺序,在并行时不保证

`data: init seed kb` 看起来是「按顺序」,其实只在默认的串行模式下成立。make 有个 `-j` 选项,让没有依赖关系的目标**并行**执行。`init`、`seed`、`kb` 三者之间在 Makefile 里没有声明依赖,`-j` 就会同时开跑。在一个全新的空库上试:

```bash
createdb agentzero_w446b
DATABASE_URL=postgresql://minliu@localhost:5432/agentzero_w446b make -j3 data 2>&1 | tail -16
```

```text
uv run python scripts/init_db.py
uv run python scripts/gen_kb.py
uv run python scripts/seed_db.py
wrote 62 articles to /Users/你/supportpilot/data/kb
uv run python scripts/check_kb.py
检查 62 篇文章: 通过
Traceback (most recent call last):
  ...
    raise psycopg.ProgrammingError('vector type not found in the database')
psycopg.ProgrammingError: vector type not found in the database
schema ready
make: *** [seed] Error 1
make: *** Waiting for unfinished jobs....
```

`seed` 在 `init` 还没建好表时就启动了,撞上 Day 443 讲过的「vector type not found」(扩展还没装)。注意 `schema ready` 打在报错之后:建表是慢了一步。串行就没有这个问题,所以别给这个 Makefile 加 `-j`。要在 `-j` 下也正确,需要让 `seed` 声明自己依赖 `init`(写成 `seed: init`),那样 `make seed` 会每次都先建一遍表,可重复运行的 `init` 不介意,代价是多几十毫秒。我没有这么改,因为大家默认串行,而且「`seed` 不带 `init`」更干净。

## 第四步:README,和测试守住它

README 是最容易过期的文件:代码改了,没人想起它。办法有两个:有测试守住它和 Makefile 的一致,以及让一个没有上下文的人(或者新克隆的目录)真的照着做一遍。先写 README:

```markdown
# SupportPilot

云簿 CloudLedger(一家虚构的在线记账 SaaS)的智能客服工单 Agent。政策类问题查帮助中心、带出处回答;账户类问题调工具查订阅和账单;退款按规则计算,人工审批后才执行;高风险工单转人工。需求和指标见 [docs/PRD.md](docs/PRD.md)。

## 快速开始

需要:Python 3.12 的管理工具 [uv](https://docs.astral.sh/uv/)、一个带 pgvector 的 PostgreSQL 17(Docker 或 Postgres.app 二选一)、`make`。

    cp .env.example .env          # 然后打开 .env,填 LLM_API_KEY 和 EMB_API_KEY;数据库地址按你的环境改
    uv sync                       # 装依赖
    make up                       # 用 Docker 起 Postgres;用 Postgres.app 的人跳过,先自己建一个库
    make data                     # 建表、造业务数据、生成帮助中心文章
    make test                     # 单元测试,不连库,几秒钟

`make data` 在一个新库上从头跑完,是这份 README 的验收标准。任何一步跑不通,说明 README 或代码需要改。

## 命令

| 命令 | 做什么 |
| --- | --- |
| `make help` | 列出所有命令 |
| `make up` / `make down` | 起、关本地 Postgres 容器 |
| `make init` | 建表,可以重复运行 |
| `make seed` | 重新造业务数据。会清空 `biz` 里所有表,工单号从 `T000001` 重新编 |
| `make kb` | 生成帮助中心文章到 `data/kb/` 并检查 |
| `make data` | `init` + `seed` + `kb` |
| `make test` | 单元测试:不连库、不调模型、不花钱,每次提交前跑 |
| `make test-all` | 全部测试,包括要连数据库的 |
| `make lint` | ruff 检查、格式检查、basedpyright 类型检查 |
| `make check` | `lint` + `test`,推送前跑 |
| `make api` | 启动 HTTP 接口(Day 467 之后才有) |

## 数据

所有数据都是虚构的,没有任何真实客户信息。

- 业务库 `biz`:200 个客户、200 条订阅、459 张账单、152 张历史工单。前 12 个客户(C0001–C0012)是手工设计的「剧情客户」,每个对应一类评测场景;其余是固定随机种子生成的。造数脚本 `scripts/seed_db.py`,用 `python scripts/story_report.py` 看 12 个剧情客户的现状。
- 帮助中心 `data/kb/`:62 篇 markdown,由 `scripts/kb_facts.py`(事实源)经 `scripts/gen_kb.py` 渲染出来。**不要手改 `data/kb/` 里的文件**,改 `kb_facts.py` 再 `make kb`。
- 「今天」固定为 `SP_TODAY=2026-10-01`。退款规则按日期算,用系统时钟的话,同一份数据每过一天标准答案就变。

## 目录

    src/supportpilot/   业务代码:config.py、db.py,以及 kb/ tools/ agent/ memory/ api/ obs/ security/ 七个子包
    scripts/            造数、建表、检查脚本(不属于包)
    db/schema.sql       表结构
    data/kb/            帮助中心文章(生成的)
    tests/              pytest 测试;标了 db 的要连真数据库
    docs/               PRD 等文档
    scratch/            练习和实验用的草稿,不提交

## 开发

    uv run pre-commit install     # 每次 git commit 前自动检查

pre-commit<4.6.1:4.6.1 起要求 git>=2.31。你的 git 够新就不用管这个限制。

约定:

- `.env` 不提交,新增配置项时同时改 `config.py` 和 `.env.example`(测试会检查两边对得上)。
- 新增 `make` 命令时,在 Makefile 里写上 `## 说明`,并把命令加到上面的表里(测试会检查)。
- 重新造数前要清掉对话快照:`make seed` 在有快照模块后会自动做这件事。
```

<div class="line-notes">

- `云簿 CloudLedger(一家虚构的在线记账 SaaS)的智能客服工单 Agent。` 开头第一段只回答三件事:这是什么、给谁、做了什么。读者没有别的上下文,不要假设他知道 Day 435 的选题。
- `需要:Python 3.12 的管理工具 [uv]` 前置条件先列出来。命令里的 `make` 在 macOS 和 Linux 上是现成的。
- `cp .env.example .env` 缩进四格是 Markdown 的「缩进代码块」写法,README 里不用嵌套三个反引号。第一步复制配置模板,并提醒要填的两个密钥和数据库地址。
- `make up` 用 Docker 的人才需要;Postgres.app 的人要自己先建库。这一行的注释把两种情况都说了。
- `` `make data` 在一个新库上从头跑完,是这份 README 的验收标准。`` 把「怎么算这份 README 没过期」写进 README 自己,谁改了流程就知道要来验。
- `| 命令 | 做什么 |` 命令表。每个 Makefile 里的命令都要在这里出现一行,后面的测试会检查。
- `所有数据都是虚构的,没有任何真实客户信息。` 数据一节第一句,写给第一次看到它的人。
- `:200 个客户` 业务库一行里的这几个数字(200/200/459/152)和 62 篇文章在 Day 445、444 里都固定了,今天的测试会拿它们和真实造出来的数对账。
- `里的文件**` 「不要手改 data/kb/ 里的文件」是加粗的,最重要的一条约定放进加粗,Day 444 的测试会抓手改。
- `「今天」固定为` 同样是 Day 442 的约定,以后谁想改要先看到这句。
- `src/supportpilot/   业务代码` 目录一节用缩进块,每行一个目录加一句话。
- `pre-commit<4.6.1:4.6.1 起要求 git>=2.31。` Day 441 写进 README 的那一句,留下来。
- `在 Makefile 里写上` 「新增 make 命令时在 Makefile 里写上说明」这一条把「测试会检查」告诉后来的人,免得他被红灯吓一跳。

</div>

然后是测试。新建 `tests/test_docs.py`:

```python
# supportpilot/tests/test_docs.py
"""文档测试:README 里提到的 make 命令都存在,Makefile 里每个命令都有说明、都写进了 README 的表。"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = (ROOT / "README.md").read_text(encoding="utf-8")
MAKEFILE = (ROOT / "Makefile").read_text(encoding="utf-8")


def targets() -> dict[str, str]:
    """Makefile 里每个命令和它那行冒号后面的部分,例如 {"data": " init seed kb  ## 建表 + ..."}。"""
    return {m.group(1): m.group(2) for m in re.finditer(r"^([a-z][a-z-]*):(.*)$", MAKEFILE, re.M)}


def readme_mentions() -> set[str]:
    """README 里所有写成 `make xxx` 的命令,正文和表格里的都算。"""
    return set(re.findall(r"\bmake ([a-z][a-z-]*)", README))


def readme_table() -> set[str]:
    """只看命令表那几行。"""
    rows = [line for line in README.splitlines() if line.startswith("| `make")]
    return {name for row in rows for name in re.findall(r"make ([a-z][a-z-]*)", row)}


def test_makefile_has_the_basics():
    assert {"help", "init", "seed", "data", "test", "lint", "check"} <= set(targets())


def test_every_target_has_a_description():
    assert [name for name, rest in targets().items() if "## " not in rest] == []


def test_readme_only_mentions_real_targets():
    assert readme_mentions()  # 先确认真的找到了,免得正则写错时测试空转
    assert readme_mentions() - set(targets()) == set()


def test_every_target_is_in_the_readme_table():
    assert set(targets()) - readme_table() == set()


def test_phony_lists_every_target():
    """少写一个 .PHONY,这个命令就会在某天被同名的文件或目录悄悄顶替(比如 data/)。"""
    match = re.search(r"^\.PHONY:(.*)$", MAKEFILE, re.M)
    assert match is not None
    assert set(targets()) <= set(match.group(1).split())
```

<div class="line-notes">

- `import re` 用正则从文本里抽命令名。
- `ROOT = Path(__file__).resolve().parent.parent` 测试在 `tests/` 里,往上一级是仓库根目录。
- `README = (ROOT / "README.md").read_text(encoding="utf-8")` 两个文件在模块顶层读一次,下面几个测试共用。
- `def targets() -> dict[str, str]:` 把 Makefile 里每个命令和它那行冒号后面的部分读成字典。
- `re.finditer(r"^([a-z][a-z-]*):(.*)$", MAKEFILE, re.M)` 找行首是「小写字母开头的名字加冒号」的行。`re.M` 让 `^` 和 `$` 按行匹配。注意它不会匹配 `.PHONY:`(点开头)和 `.DEFAULT_GOAL :=`。
- `def readme_mentions() -> set[str]:` README 里所有写成 `make xxx` 的命令,正文和表格里的都算。
- `re.findall(r"\bmake ([a-z][a-z-]*)", README)` `\b` 是单词边界,避免匹配到别的词的尾巴。后面必须是小写字母开头,所以「`make` 命令」(后面跟中文)不会误报。
- `def readme_table() -> set[str]:` 只看命令表那几行,用来检查「每个命令都列出来了」。
- `rows = [line for line in README.splitlines() if line.startswith("| `make")]` 命令表里每行以 ``| `make`` 开头。
- `def test_makefile_has_the_basics():` 先确认最基本的几个命令在,免得 `targets()` 的正则写坏了、返回空字典,后面所有测试都空转通过。
- `def test_every_target_has_a_description():` 没有 `## ` 说明的命令算问题,因为 `make help` 会漏掉它。
- `assert readme_mentions()  # 先确认真的找到了` 同样的防空转写法,Day 443 学的。
- `assert readme_mentions() - set(targets()) == set()` README 里提到、Makefile 里没有的命令:一个也不能有。
- `assert set(targets()) - readme_table() == set()` Makefile 里有、README 表里没有的命令:一个也不能有。
- `def test_phony_lists_every_target():` 每个命令都在 `.PHONY` 里。
- `match = re.search(r"^\.PHONY:(.*)$", MAKEFILE, re.M)` 找 `.PHONY:` 那一行。`.` 在正则里是「任意字符」,所以前面要加反斜杠。
- `assert match is not None` 没找到就是 Makefile 没写 `.PHONY`,同时让类型检查器知道下面的 `match` 不是 `None`。
- `assert set(targets()) <= set(match.group(1).split())` 所有命令名是 `.PHONY` 列出名字的子集。

</div>

这些测试能不能抓到东西,得弄坏一次看。往 Makefile 末尾加一个没有说明、没进 `.PHONY`、没进 README 的命令:

```bash
printf 'clean:\n\trm -rf .pytest_cache\n' >> Makefile
uv run pytest -q tests/test_docs.py 2>&1 | tail -12
```

```text
>       assert set(targets()) <= set(match.group(1).split())
E       AssertionError: assert {'api', 'chec..., 'help', ...} <= {'api', 'chec..., 'init', ...}
E         
E         Extra items in the left set:
E         'clean'

tests/test_docs.py:49: AssertionError
=========================== short test summary info ============================
FAILED tests/test_docs.py::test_every_target_has_a_description - AssertionErr...
FAILED tests/test_docs.py::test_every_target_is_in_the_readme_table - Asserti...
FAILED tests/test_docs.py::test_phony_lists_every_target - AssertionError: as...
3 failed, 2 passed in 0.08s
```

同一个坏改动触发了三条,各说各的:没说明、没进 README 表、没进 `.PHONY`。恢复 Makefile(练习 1 会正经加一个 `clean`)。

## 第五步:pre-push 钩子换成 make test

[Day 441](/blog/agent-zero/day-441-repo-init/) 在 `.pre-commit-config.yaml` 里把 pytest 放在推送(pre-push)时跑,当时命令是 `uv run pytest -q`,并说「Day 446 的 `make test` 会换掉这一行」。换:

```yaml
  - repo: local
    hooks:
      - id: pytest
        name: pytest
        entry: make test
        language: system
        pass_filenames: false
        always_run: true
        stages: [pre-push]
```

只改了 `entry` 一行。好处是钩子和你手敲的命令永远是同一个,不会出现「钩子跑的和我跑的不一样」。pre-push 阶段手动触发一次:

```bash
uv run pre-commit run pytest --hook-stage pre-push --all-files
```

```text
pytest...................................................................Passed
```

## 第六步:在新克隆、新库上照 README 走一遍

最后一步最重要。我把仓库提交,克隆到另一个目录,建一个全新的空库,然后**只**照 README 的快速开始操作,不凭记忆:

```bash
git add -A
git commit -m "feat: Makefile、测试分层、README 和 README 对账测试"
cd ~
git clone supportpilot clone446 && cd clone446
createdb agentzero_w446
cp .env.example .env     # 然后把 DATABASE_URL 改成指向 agentzero_w446
uv sync
make data
make test
make check
```

`make data` 的输出和上面完全一致(建表、200/200/459/152、62 篇文章通过)。后两条:

```text
uv run pytest -m "not db and not llm" -q
....................................................                     [100%]
52 passed, 7 deselected in 0.26s
```

```text
All checks passed!
uv run ruff format --check .
90 files already formatted
uv run basedpyright
0 errors, 0 warnings, 0 notes
uv run pytest -m "not db and not llm" -q
....................................................                     [100%]
52 passed, 7 deselected in 0.16s
```

(`make check` 的输出我只留了后半截。)52 个不连库的测试,比上一步的 47 多的 5 个就是 `test_docs.py`。提交时的钩子输出:

```text
trim trailing whitespace.................................................Passed
fix end of files.........................................................Passed
check yaml...............................................................Passed
check toml...............................................................Passed
check for added large files..............................................Passed
detect private key.......................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
```

这次 `check yaml` 和 `check toml` 是 `Passed`,因为提交里有被改过的 `.pre-commit-config.yaml` 和 `pyproject.toml`。这个输出是我在整个仓库上手动跑 `pre-commit run --all-files` 得到的,不是 `git commit` 触发的。

走完这一遍,README 没有缺步骤:只有一处我得「知道」的东西,就是 `.env` 里的 `DATABASE_URL` 要按自己的库改,README 已经在 `cp` 那行旁边写了。如果你在新克隆上卡住了,先怀疑 README,不要怀疑自己。

架构表对账(Day 438 的 `check_arch.py`)今天**没有跑**:它在 `agent-zero-lab/part08/` 里,我这次的环境里没有那份练习仓库。表里「常用命令 Makefile」「测试 tests/」两个方块今天都有了对应文件。

## 动手练习

### 练习 1:加一个 `make clean`

加一个命令 `clean`,删掉 `.pytest_cache` 和 `.ruff_cache`。要求:Makefile 有说明、进 `.PHONY`、README 表里有一行,`tests/test_docs.py` 全绿。先故意只改 Makefile 看测试怎么红,再补全。

<details><summary>参考答案</summary>

在 Makefile 里:`.PHONY` 那一行末尾加 `clean`,文件末尾加:

```makefile
clean:      ## 删掉工具缓存(.pytest_cache、.ruff_cache)
	rm -rf .pytest_cache .ruff_cache
```

README 命令表末尾加一行:

```markdown
| `make clean` | 删掉 `.pytest_cache`、`.ruff_cache` |
```

先只改 Makefile、不改 README 和 `.PHONY` 时,`test_docs.py` 红两条(README 表缺、`.PHONY` 缺),就是第四步演示的样子。三处都补全以后:

```bash
ls -d .pytest_cache .ruff_cache
make clean
ls -d .pytest_cache .ruff_cache 2>&1 | head -2
make | tail -3
uv run pytest -q tests/test_docs.py | tail -2
```

```text
.pytest_cache
.ruff_cache
rm -rf .pytest_cache .ruff_cache
ls: .pytest_cache: No such file or directory
ls: .ruff_cache: No such file or directory
  make check     提交前的完整检查:lint + test
  make api       启动 HTTP 接口(Day 467 之后才有)
  make clean     删掉工具缓存(.pytest_cache、.ruff_cache)
.....                                                                    [100%]
5 passed in 0.02s
```

`rm -rf` 对不存在的文件不报错,所以连续 `make clean` 两次也没事。注意 `rm -rf` 后面只写了两个具体的目录名,别写成 `rm -rf *` 或者带变量的路径:变量为空时它会变成删掉你不想删的东西。

</details>

### 练习 2:预测标记筛选的结果

当前一共 59 个测试,其中 7 个标了 `db`,没有任何测试标 `llm`。先在纸上预测这五条命令各会跑几个、取消选择几个,再实跑核对:`-m db`、`-m "not db"`、`-m "db or llm"`、`-m "not llm"`、`-m llm`。

<details><summary>参考答案</summary>

预测:`db` 跑 7、取消 52;`not db` 跑 52、取消 7;`db or llm` 等于 `db`,跑 7;`not llm` 因为没人标 `llm`,所以全部 59 个都跑;`llm` 一个都选不中。实跑:

```text
-m 'db'
7 passed, 52 deselected in 0.47s
-m 'not db'
52 passed, 7 deselected in 0.19s
-m 'db or llm'
7 passed, 52 deselected in 0.45s
-m 'not llm'
59 passed in 0.58s
-m 'llm'
59 deselected in 0.03s
```

最后一条值得留意:`-m llm` 选中 0 个,pytest 也没有报错,只是 59 个都取消选择。所以「`make test-llm` 跑了零个测试却显示绿色」是一种会悄悄发生的假象:Day 463 之后真的有 `llm` 测试时,要记得看一眼它到底跑了几个。用 `uv run pytest --collect-only -q -m db` 能列出被选中的测试名,当前输出是那 7 个连库的测试。

</details>

### 练习 3:没起数据库时,`make test-all` 是什么样

把 `DATABASE_URL` 指向一个没人监听的端口(比如 5999),运行 `make test-all`。有几个测试跳过?每个跳过的原因是什么?这个结果算「绿」还是「红」?

<details><summary>参考答案</summary>

```bash
DATABASE_URL=postgresql://minliu@localhost:5999/nope make test-all 2>&1 | tail -9 | cut -c1-150
```

```text
=========================== short test summary info ============================
SKIPPED [1] tests/test_db.py:20: 连不上数据库:connection failed: connection to server at "127.0.0.1", port 5999 failed: could not receive data from server: 
SKIPPED [1] tests/test_db.py:25: 连不上数据库:...(同上)
SKIPPED [1] tests/test_db.py:33: 连不上数据库:...
SKIPPED [1] tests/test_db.py:39: 连不上数据库:...
SKIPPED [1] tests/test_schema_live.py:20: 连不上数据库:...
SKIPPED [1] tests/test_seed_live.py:14: 连不上数据库:...
SKIPPED [1] tests/test_seed_live.py:27: 连不上数据库:...
52 passed, 7 skipped in 0.19s
```

(中间几行我用「...」缩短了,原样每行后面都是 `Connection refused` 一类的连接错误。)结果:7 个跳过(正好是标了 `db` 的那 7 个),原因都是连不上库,其余 52 个不连库的全部通过,整次运行是绿的。

这是一个有意的取舍:没有数据库的机器上,`test-all` 不应该变红,否则在没装数据库的 CI 里它永远红。代价是「跳过」会掩盖「库本来应该在、却没起来」的情况。所以日常用 `make test`(根本不碰库),要验证库相关的东西时,先 `make data` 再 `make test-all`,并且看一眼输出里有没有 `skipped`。

</details>

### 练习 4:给 `data` 加上 `-j` 保护

第三步看到 `make -j3 data` 会让 `seed` 抢在 `init` 前面。改 Makefile,让并行也安全,并回答:代价是什么?

<details><summary>参考答案</summary>

让 `seed` 声明自己依赖 `init`,`kb` 保持独立(它不碰库):

```makefile
seed: init  ## 重新造业务数据(会清空 biz 里所有表,也会先清对话快照)
	@if [ -f src/supportpilot/memory/checkpoint.py ]; then uv run python -m supportpilot.memory.checkpoint; fi
	uv run python scripts/seed_db.py
```

注意说明注释 `##` 仍然要写在这一行,`make help` 才读得到。`data: init seed kb` 不用动:并行时 make 会先跑 `init`,等它结束再跑 `seed`,`kb` 可以同时跑。

代价:`make seed` 单独跑时,每次都会先执行一遍 `init`(建表)。`init` 是可重复运行的(每条 SQL 都有 `IF NOT EXISTS`),所以结果相同,只多出几十毫秒和一行输出。好处是「依赖关系写在 Makefile 里」,而不是靠大家记得顺序。对这个项目我自己没有这么改:没人会开 `-j`,`make seed` 想要的是纯粹地造数。但如果你的 Makefile 有一天变得很长、很慢,声明依赖是正路。

我没有把这个改动实跑一遍,只验证了 `-j3` 在原版 Makefile 上确实会失败(第三步的输出)。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Makefile | 一个文本文件,里面写「目标:前置目标」加一串命令。`make 目标` 就是执行它。最初是编译 C 程序用的 |
| 目标 target | Makefile 里冒号前面的名字,这里就是命令名,比如 `test`、`data` |
| 前置目标 | `data: init seed kb` 冒号后面的名字,执行 `data` 前先执行它们 |
| `.PHONY` | 声明某些目标不是文件名,每次都执行,不会因为恰好有同名文件或目录就被跳过 |
| 配方 recipe | 目标下面缩进的那些命令行。必须用 Tab 缩进 |
| dry run `make -n` | 只打印会执行什么,不真的执行 |
| pytest 标记 marker | 贴在测试上的标签,用 `-m` 筛选,比如 `-m "not db"` |
| `pytestmark` | 模块顶层的特殊变量,给整个文件里的测试一起贴标签 |
| `--strict-markers` | 用了没登记的标记就报错,而不是只给一条警告 |
| `conftest.py` | pytest 自动加载的文件,里面的夹具所有同目录下的测试都能用,不用 import |
| deselected | pytest 输出里的词:被 `-m` 筛掉、没有运行的测试 |
| 冒烟验收 | 在全新环境上只照文档走一遍,看能不能跑起来。这里指新克隆加新库 |

## 常见误区

**Makefile 里用空格缩进。** 报 `missing separator`,而且看上去和 Tab 一模一样。让编辑器显示空白字符,或者在 `.editorconfig` 里给 Makefile 指定用 Tab。

**忘了 `.PHONY`。** 今天没有碰上现成的冲突,但 `docs/` 目录加 `make docs` 的实验里命令被静默跳过,只留下一句 `is up to date`。

**以为前置目标的顺序在并行时也成立。** `make -j3 data` 那次,`seed` 在建表前启动,报「vector type not found」。要并行安全,必须声明依赖。

**`$` 在 Makefile 里不是普通字符。** `awk` 里的 `$1` 必须写成 `$$1`,否则 make 会把它当变量展开成空字符串,`make help` 打出一堆空行。

**测试标记不开 `--strict-markers`。** 拼错一个字母,测试悄悄逃出筛选,只剩一条没人读的警告。

**把「测试分层」当成「少写测试」。** 分层的目的是让最常跑的那层又快又稳,而不是少跑。`make test-all` 和连库的 2 条 `test_seed_live.py` 仍然要在合适的时候跑。

**README 写完就不管了。** 代码变了它不会报错,所以要么有测试(今天的 `test_docs.py`),要么定期在新克隆上走一遍。只有第二种能发现「缺了一步」这类测试想不到的问题。

**把假数据库连接串提交进仓库。** `.env.example` 里的默认值是给 Docker 用的(用户名密码都是 `supportpilot`),这没问题;`.env` 里你改成自己的库,它在 `.gitignore` 里,不会被提交。

## 学习资料

### 文档与文章

- [GNU Make 手册](https://www.gnu.org/software/make/manual/make.html):官方,什么都有。今天读「Phony Targets」和「Rule Syntax」两节。这个网站对 curl 返回 403,需要在浏览器里打开。40 分钟。
- [Makefile Tutorial](https://makefiletutorial.com/):用例子讲 Makefile 的网站,从最简单的规则讲起,很快。读前三节就够。30 分钟。
- [Self-Documenting Makefile(marmelab)](https://marmelab.com/blog/2016/02/29/auto-documented-makefile.html):今天 `make help` 那一小段 `grep` + `awk` 的来源思路。5 分钟。
- [pytest 文档 · 标记](https://docs.pytest.org/en/stable/how-to/mark.html):`pytest.mark`、自定义标记、`-m` 表达式的语法。20 分钟。
- [pytest 文档 · conftest.py 共享夹具](https://docs.pytest.org/en/stable/reference/fixtures.html):找到「conftest.py: sharing fixtures across multiple files」那一节。15 分钟。
- [casey/just](https://github.com/casey/just):一个专门做「命令名」的小工具,语法比 Makefile 友好,没有 Tab 和 `.PHONY` 的问题。需要多装一个东西,所以我们没选它。READme 看十分钟,知道有这个选择就好。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1tyWWeeEpp&autoplay=0&high_quality=1" title="20分钟Makefile光速入门教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>GeekHour · 20分钟Makefile光速入门教程 · 约 19 分钟,2024 年,播放 13 万多。例子是编译 C 程序,依赖关系那几段和我们不一样,重点看规则的写法、变量和 `.PHONY` 那一节,跳过编译细节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1j14y1v7hL&autoplay=0&high_quality=1" title="十分钟入门 MakeFile" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>古月有三木 · 十分钟入门 MakeFile · 约 9 分钟,2022 年。更短的一个,同样是编译场景,看规则的三要素(目标、前置、命令)。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cQ4y1E7xM&autoplay=0&high_quality=1" title="Pytest07-pytest.ini配置文件" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>测试老宅男扶摇 · Pytest07-pytest.ini配置文件 · 约 9 分钟。讲 `pytest.ini` 里的 `markers` 和 `addopts`,位置不同(我们写在 `pyproject.toml` 的 `[tool.pytest.ini_options]` 里),配置项是同一套。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/HmbByRhh3Sk" title="How To Make a Makefile for Beginners!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>HenrikM Dev · How To Make a Makefile for Beginners! · 英文,可开自动字幕。给初学者的一个入门。我没有逐分钟核对内容,按标题当补充看。</figcaption>
</figure>

### 书籍

- Robert Mecklenburg《Managing Projects with GNU Make》第 3 版(O'Reilly,2004,[出版社页面](https://www.oreilly.com/library/view/managing-projects-with/0596006101/)):make 的专门书。偏 C/C++ 项目,我们只用到它最基础的部分,看第一部分「基础」几章就够了。我没确认有没有这一版的中译本,只写英文原版。

### 开源项目与代码

- [astral-sh/uv](https://github.com/astral-sh/uv):今天 Makefile 里几乎每条命令都以 `uv run` 开头,这是它的仓库。看它的 `CONTRIBUTING.md` 里怎么写「开发者怎么跑测试」,对照我们的 README。

## 自测

1. `make data` 里的 `init seed kb` 是什么?执行顺序是怎么定的?

<details><summary>答案</summary>

它们是前置目标:执行 `data` 之前,先执行这三个。默认串行时按从左到右的顺序。但顺序只在串行模式下有保证,加 `-j` 并行时 make 会同时启动没有声明依赖的目标,实测 `-j3` 下 `seed` 在 `init` 建好表之前就跑起来,报「vector type not found」。

</details>

2. 为什么要写 `.PHONY`?不写会怎样?

<details><summary>答案</summary>

make 把目标名当成文件名:如果当前目录里有同名的文件或目录,并且目标自己没有前置依赖,make 认为它「已经是最新的」,不执行命令,只打印一句 `is up to date`。实验里仓库有 `docs/` 目录,`make docs` 什么都没做。`.PHONY` 声明这些名字不是文件,每次都执行。

</details>

3. `make test` 为什么用 `pytest -m "not db and not llm"`?只写 `pytest` 不行吗?

<details><summary>答案</summary>

只写 `pytest` 会把要连数据库的测试也跑一遍,连不上时它们跳过,还要等连接尝试;以后有会真的调用模型的测试,更会花钱。`-m "not db and not llm"` 只跑既不连库也不调模型的那一层,不依赖任何外部服务,几分之一秒跑完,可以每次提交前都跑。

</details>

4. `--strict-markers` 防的是什么?

<details><summary>答案</summary>

防标记拼错。没开时,`pytest.mark.dbb`(拼错的 `db`)只产生一条警告,`-m "not db"` 筛不掉这些测试,它们照样去连数据库。开了以后,没登记的标记在收集阶段就报错,整个运行中断,错误指向拼错的名字。

</details>

5. 为什么要写 `test_docs.py` 去对账 README 和 Makefile?写了测试还需要在新克隆上走一遍 README 吗?

<details><summary>答案</summary>

README 不会在代码变化时报错,最容易悄悄过期。测试能抓到「命令改了名」「新增命令没写进 README」这类机械的不一致。但测试想不到所有问题,比如缺少了某个前置步骤、没说要先建库。只有在全新环境里真的照着做一遍,才能发现这类问题。两者互补。

</details>

6. **面试题**:「你接手一个新项目,怎么判断它的 README 靠不靠谱?」

<details><summary>答案</summary>

我会把它当成一份要执行的文档:新克隆一份、新建一个干净的环境,只照 README 的步骤走,不凭经验补。能不能一条命令起来、测试能不能跑绿,是验收标准。卡住的地方就是 README 的缺口。如果团队愿意,我会把可检查的部分写成测试,比如 README 里写的命令在 Makefile 里都存在、环境变量模板和配置类对得上。再把「没有数据库也能跑的那层测试」单独拎出来,这样新人第一天就能看到一个绿色的结果。

</details>

## 明天预告

明天是 Day 447 · 第 64 周复习:毕业项目(Day 441–446)。这一周六天都在搭同一个仓库的骨架:建仓库、配置、数据库、帮助中心、业务数据、命令和测试。明天不学新东西,把这六天收成一张图,默写两段最容易写错的代码,再写一个小脚本,让这一周造出来的几份文件(造数脚本、`schema.sql`、README、`.env.example`、测试标记)互相对账。
