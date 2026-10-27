---
title: 'Day 447 · 第 64 周复习:毕业项目(Day 441–446)'
description: '把这一周六天收成一张图:每天都在给仓库的一个角落立规矩并配一个检查。默写两段容易写错的代码(给日期加月份、每条 CREATE 带 IF NOT EXISTS)并用测试证明,再写一个 review64.py,让造数脚本、schema.sql、README、.env.example、测试标记、pre-commit 互相对账,故意弄坏六处看它抓到,其中一处还抓出了检查自己的漏洞。'
pubDate: 2026-10-27
regime: none
tags: ['review', 'capstone', 'supportpilot', 'pytest', 'regex', 'agent-zero']
series: 'agent-zero'
day: 447
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 446](/blog/agent-zero/day-446-makefile-readme/) 给仓库补上了命令和说明:Makefile 把 `uv run python scripts/...` 收成 `make data`、`make test`,pytest 标记把测试分成「不连库」和「连库」两层,README 有测试守着、又在新克隆加新库上被真走了一遍。到那一步,第 64 周的骨架就搭完了:SupportPilot 仓库从一个空目录变成了能一条命令建库、造数、跑测试的项目。

这一周六天表面上是六件事:建仓库、配置、数据库、帮助中心、业务数据、命令。其实每一天做的是同一个动作:**给仓库的一个角落立一条规矩,再配一个检查,让这条规矩不靠记忆也能守住**。今天不学新东西,把六天收拢,默写两段最容易写错的代码,再写一个脚本,让这一周造出来的几份文件互相对账。明天 Day 448 开始做知识库的切块,到时候你会发现,骨架这一周的检查就是后面每一步的安全网。

## 今天要解决的问题

复习日的目标,是确认这一周的东西真的长在你手上了。学完你应该能:

1. 不看文章,画出本周六天的主线,说出每一天立的规矩和对应的检查是什么。
2. 默写 Day 445 的 `add_months()` 和 `next_invoice_id()`、Day 443 的「每条 CREATE 都带 IF NOT EXISTS」检查,并用 9 个测试证明默写对了。
3. 跑通本周小项目 `part08/review64.py`:六个检查让造数脚本、`schema.sql`、README、`.env.example`、帮助中心、测试标记、pre-commit 互相对账。故意弄坏六处,看每个检查各抓到哪一处。
4. 能解释本周三个最容易混的地方:「每份文件单独通过」不等于「它们对得上」;检查脚本自己也会有漏洞(今天亲眼看到一个);测试要先看它红过,才能相信它绿。

今天不调模型,不花钱(¥0)。预计用时 3–4 小时,大头在默写和练习。前置:[Day 441](/blog/agent-zero/day-441-repo-init/) 到 [Day 446](/blog/agent-zero/day-446-makefile-readme/) 全部;默写二用到 [Day 443](/blog/agent-zero/day-443-database/) 的正则;小项目的练习用到 [Day 444](/blog/agent-zero/day-444-kb-generate/) 学的 `tmp_path`。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="第 64 周知识地图:建仓库、配置、数据库、帮助中心、业务数据、命令六个角落,各立一条规矩并配一个检查,最后由 review64.py 互相对账">
  <g font-family="var(--font-mono)" font-size="12">
    <text x="14" y="22" fill="var(--ink-soft)">每天给仓库的一个角落立规矩,再配一个能自动跑的检查</text>
    <rect x="14" y="36" width="94" height="64" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="61" y="56" text-anchor="middle" fill="var(--ink-faint)" font-size="11">Day 441</text>
    <text x="61" y="76" text-anchor="middle" fill="var(--ink)">仓库工具</text>
    <text x="61" y="92" text-anchor="middle" fill="var(--ink-soft)" font-size="10">ruff pre-commit</text>
    <rect x="114" y="36" width="94" height="64" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="161" y="56" text-anchor="middle" fill="var(--ink-faint)" font-size="11">Day 442</text>
    <text x="161" y="76" text-anchor="middle" fill="var(--ink)">配置</text>
    <text x="161" y="92" text-anchor="middle" fill="var(--ink-soft)" font-size="10">Settings 今天</text>
    <rect x="214" y="36" width="94" height="64" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="261" y="56" text-anchor="middle" fill="var(--ink-faint)" font-size="11">Day 443</text>
    <text x="261" y="76" text-anchor="middle" fill="var(--ink)">数据库</text>
    <text x="261" y="92" text-anchor="middle" fill="var(--ink-soft)" font-size="10">schema 约束</text>
    <rect x="314" y="36" width="94" height="64" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="361" y="56" text-anchor="middle" fill="var(--ink-faint)" font-size="11">Day 444</text>
    <text x="361" y="76" text-anchor="middle" fill="var(--ink)">帮助中心</text>
    <text x="361" y="92" text-anchor="middle" fill="var(--ink-soft)" font-size="10">事实源 渲染</text>
    <rect x="414" y="36" width="94" height="64" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="461" y="56" text-anchor="middle" fill="var(--ink-faint)" font-size="11">Day 445</text>
    <text x="461" y="76" text-anchor="middle" fill="var(--ink)">业务数据</text>
    <text x="461" y="92" text-anchor="middle" fill="var(--ink-soft)" font-size="10">剧情客户</text>
    <rect x="514" y="36" width="112" height="64" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="570" y="56" text-anchor="middle" fill="var(--ink-faint)" font-size="11">Day 446</text>
    <text x="570" y="76" text-anchor="middle" fill="var(--ink)">命令 测试</text>
    <text x="570" y="92" text-anchor="middle" fill="var(--ink-soft)" font-size="10">Makefile README</text>
    <g stroke="var(--ink-faint)" stroke-dasharray="4 3">
      <line x1="61" y1="102" x2="61" y2="150"/>
      <line x1="161" y1="102" x2="161" y2="150"/>
      <line x1="261" y1="102" x2="261" y2="150"/>
      <line x1="361" y1="102" x2="361" y2="150"/>
      <line x1="461" y1="102" x2="461" y2="150"/>
      <line x1="570" y1="102" x2="570" y2="150"/>
    </g>
    <rect x="14" y="150" width="612" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="320" y="170" text-anchor="middle" fill="var(--ink)">review64.py:六个检查让这些文件互相对账</text>
    <text x="320" y="186" text-anchor="middle" fill="var(--ink-soft)" font-size="11">列 今天 数字 价格 标记 钩子</text>
    <text x="14" y="224" fill="var(--ink-faint)" font-size="11">每个角落自己的检查只管自己;跨角落的矛盾,只有对账才看得见</text>
  </g>
</svg>
<figcaption>琥珀色三块(数据库、帮助中心、业务数据)是数据层,这一周的重头;蓝灰色的是工程层。review64.py 站在所有角落上面,检查它们之间对不对得上。</figcaption>
</figure>

## 本周每天一句话

[Day 441 · 建仓库,uv、ruff、pytest、pre-commit](/blog/agent-zero/day-441-repo-init/):`uv init --package` 建出 src 布局,依赖分运行时和开发两组,ruff 选 E、F、I、UP、B 五类规则,pytest 第一个测试是「七个子包都能 import」;pre-commit 在提交时跑快检查、推送时跑完整测试;我的 git 是 2.24.3,装新版 pre-commit 会报 `unknown option`,所以锁了 `pre-commit<4.6.1` 并把原因写进 README。

[Day 442 · 配置管理](/blog/agent-zero/day-442-config/):所有可变的东西进 `Settings`(pydantic-settings),优先级是真环境变量高于 `.env` 高于默认值;密钥用 `SecretStr` 防打印泄露;`get_settings()` 加 `lru_cache` 后进程里改环境变量看不见(实测 5、5、9);「今天」做成配置 `SP_TODAY`,同一份数据用系统时钟算是第 33 天、用配置算是第 7 天。

[Day 443 · 数据库](/blog/agent-zero/day-443-database/):`schema.sql` 建 9 张表,CHECK、外键、`numeric(10,2)` 把坏数据挡在门外,`vector(1024)` 和配置里的 `emb_dim` 要一致;`db.py` 的 `connect()` 注册 vector 类型,空库上它会报「vector type not found」,所以 `init_db.py` 用裸连接;连库的测试连不上就跳过。

[Day 444 · 造帮助中心 60+ 篇](/blog/agent-zero/day-444-kb-generate/):62 篇文章不让模型写(同一个提示词写三遍政策数字三次不同),数字只在事实源 `kb_facts.py` 写一次,`gen_kb.py` 确定性渲染,`check_kb.py` 抓断链,第一次跑就抓到我写的《E4001 支付失败》少了半句。

[Day 445 · 造业务库](/blog/agent-zero/day-445-bizdata/):12 个剧情客户各对应一个退款场景(徐丽第 14 天、孙浩第 15 天夹住边界),188 个随机客户用 `random.Random(42)`;`build()` 只在内存里造、`write()` 才写库;价格和期限从事实源取;f-string 拼 SQL 会被类型检查器拦,要用 `sql.Identifier`;写库顺序要对外键。

[Day 446 · Makefile、测试、README](/blog/agent-zero/day-446-makefile-readme/):Makefile 给命令起名字(Tab 缩进、`.PHONY`),`make -j` 会让 `seed` 抢在 `init` 前面;`db`、`llm` 标记加 `--strict-markers` 把测试分层,`make test` 52 个不连库;README 由 `test_docs.py` 对账,并在新克隆新库上真走了一遍。

## 准备环境

今天的代码放在 `agent-zero-lab/part08/`,在练习仓库根目录运行。SupportPilot 仓库按 Day 446 结束时的样子放在 `~/supportpilot`,并且已经 `make data` 过(库里有数据,`data/kb/` 有 62 篇文章):

```bash
cd ~/agent-zero-lab
ls ~/supportpilot/Makefile ~/supportpilot/README.md ~/supportpilot/scripts/seed_db.py
(cd ~/supportpilot && make test | tail -1)
```

```text
/Users/你/supportpilot/Makefile
/Users/你/supportpilot/README.md
/Users/你/supportpilot/scripts/seed_db.py
52 passed, 7 deselected in 0.17s
```

最后一行如果不是 `52 passed`,说明哪一天的文件没对上,先回去补。`(cd ... && ...)` 括号里的 `cd` 只对括号里生效,运行完你还在 `agent-zero-lab`。

## 默写一:Day 445 的 add_months 和账单号

合上文章,在 `part08/dictation64.py` 里默写两个函数。题目:

- `add_months(d, n)`:日期 `d` 加 `n` 个月,日子超出当月天数时取月底。要求不用 `timedelta`,用整除和取余。
- `next_invoice_id(seq, issued)`:账单号格式 `INV-年月-当月第几张`,序号补零到 4 位;`seq` 是一个字典,记着每个月已经发了几张,每个月单独从 1 数。

下面是我的参考答案,**写完再看**:

```python
# agent-zero-lab/part08/dictation64.py(第一部分)
import calendar
from datetime import date


def add_months(d: date, n: int) -> date:
    """Day 445 的 add_months:月份加 n,日子超出当月天数时取月底。"""
    index = d.month - 1 + n
    year, month = d.year + index // 12, index % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def next_invoice_id(seq: dict[str, int], issued: date) -> str:
    """Day 445 的账单号:INV-年月-当月第几张,每个月单独从 1 数。seq 记着每个月已经发了几张。"""
    ym = issued.strftime("%Y%m")
    seq[ym] = seq.get(ym, 0) + 1
    return f"INV-{ym}-{seq[ym]:04d}"
```

<div class="line-notes">

- `import calendar` 查某个月有几天用它。默写时想不起来 `calendar.monthrange` 也可以自己写月份天数表,只要结果对。
- `index = d.month - 1 + n` 这一行最容易写错,错在漏掉 `- 1`。月份从 1 数起,先减一变成从 0 数起,取整除和余数才对得上年的边界。代入 `d = 2026-12-05, n = 1`:`11 + 1 = 12`。
- `year, month = d.year + index // 12, index % 12 + 1` 接上例:`year = 2026 + 12 // 12 = 2027`,`month = 12 % 12 + 1 = 1`,得到 2027 年 1 月。
- `return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))` 日子取「原来的日子」和「当月天数」里小的那个。漏掉 `min` 时 1 月 31 日加一个月会抛 `ValueError: day is out of range for month`。
- `ym = issued.strftime("%Y%m")` 把日期变成 `"202609"` 这种年月字符串。
- `seq[ym] = seq.get(ym, 0) + 1` 这个月还没发过时键不存在,`get(ym, 0)` 给 0,加一就是第 1 张。
- `return f"INV-{ym}-{seq[ym]:04d}"` `:04d` 补零到 4 位。

</div>

再默写 Day 443 的那条检查,题目:读 `schema.sql` 的文本,找出所有**没有** `IF NOT EXISTS` 的 `CREATE EXTENSION/SCHEMA/TABLE/INDEX` 语句,返回有问题的那几句(只返回前几个词即可)。如果文本里一条 `CREATE` 都没有,要报错,不能算通过。

## 默写二:每条 CREATE 都带 IF NOT EXISTS

```python
# agent-zero-lab/part08/dictation64.py(第二部分,接在上面)
import re


def creates_without_guard(sql_text: str) -> list[str]:
    """Day 443 的「每条 CREATE 都带 IF NOT EXISTS」,不过这次返回有问题的那几句,方便看。"""
    kinds = r"CREATE (?:EXTENSION|SCHEMA|TABLE|INDEX)"
    found = re.findall(kinds, sql_text)
    assert found, "一条 CREATE 都没找到,正则或者文件有问题"
    return re.findall(rf"{kinds}\s+(?!IF NOT EXISTS)\S+", sql_text)
```

<div class="line-notes">

- `import re` 正则。放在文件开头更规范,这里为了对应「接在上面」分开写,实际一个文件里 `import` 都在最前。
- `kinds = r"CREATE (?:EXTENSION|SCHEMA|TABLE|INDEX)"` 四类要检查的语句。`(?:...)` 是「分组但不捕获」,`|` 是「或」。
- `found = re.findall(kinds, sql_text)` 先找出所有 `CREATE` 语句。
- `assert found, "一条 CREATE 都没找到,正则或者文件有问题"` 防空转:如果文件读错了、正则写坏了,下面的检查什么也找不到,会「通过」。这个习惯 Day 443 就讲过,今天的 `review64.py` 里也到处用。
- `return re.findall(rf"{kinds}\s+(?!IF NOT EXISTS)\S+", sql_text)` `(?!IF NOT EXISTS)` 是「后面不能紧跟」的否定向前断言;`\S+` 多取一个词,让返回值是 `CREATE TABLE biz.b` 这样能看懂的片段。

</div>

测试(`part08/test_dictation64.py`,先写测试,再跑你的默写):

```python
# agent-zero-lab/part08/test_dictation64.py
from datetime import date

import pytest

from part08.dictation64 import add_months, creates_without_guard, next_invoice_id


@pytest.mark.parametrize(
    ("start", "n", "expected"),
    [
        (date(2026, 11, 15), 3, date(2027, 2, 15)),  # 跨年
        (date(2026, 1, 31), 1, date(2026, 2, 28)),  # 月底截断
        (date(2024, 1, 31), 1, date(2024, 2, 29)),  # 闰年
        (date(2025, 9, 27), 12, date(2026, 9, 27)),  # 整年
        (date(2026, 12, 5), 1, date(2027, 1, 5)),  # 12 月 + 1:index % 12 == 0 的情况
    ],
)
def test_add_months(start: date, n: int, expected: date):
    assert add_months(start, n) == expected


def test_invoice_ids_count_per_month():
    seq: dict[str, int] = {}
    ids = [
        next_invoice_id(seq, date(2026, 9, 5)),
        next_invoice_id(seq, date(2026, 9, 24)),
        next_invoice_id(seq, date(2026, 10, 5)),
        next_invoice_id(seq, date(2026, 9, 12)),
    ]
    assert ids == ["INV-202609-0001", "INV-202609-0002", "INV-202610-0001", "INV-202609-0003"]


GOOD = "CREATE EXTENSION IF NOT EXISTS vector;\nCREATE TABLE IF NOT EXISTS biz.a (id text);\n"


def test_guarded_creates_pass():
    assert creates_without_guard(GOOD) == []


def test_unguarded_create_is_reported():
    bad = GOOD + "CREATE TABLE biz.b (id text);\nCREATE INDEX ix ON biz.b (id);\n"
    assert creates_without_guard(bad) == ["CREATE TABLE biz.b", "CREATE INDEX ix"]


def test_no_create_at_all_is_an_error_not_a_pass():
    with pytest.raises(AssertionError, match="一条 CREATE 都没找到"):
        creates_without_guard("SELECT 1;")
```

<div class="line-notes">

- `import pytest` 要用 `parametrize` 和 `raises`。
- `from part08.dictation64 import add_months` 从你默写的文件里导入三个函数。在 `agent-zero-lab` 根目录用 `uv run pytest part08` 运行。
- `(date(2026, 11, 15), 3, date(2027, 2, 15)),  # 跨年` 五组参数里每组各卡一个容易错的地方。
- `(date(2026, 12, 5), 1, date(2027, 1, 5)),` 12 月加 1 个月:`index % 12 == 0` 这种情况是漏写 `- 1` 的人最先被抓到的。
- `def test_invoice_ids_count_per_month():` 第四张 9 月账单排在 10 月那张之后发出,编号仍然是 9 月的第 3 张,证明每个月的计数器是分开的。
- `GOOD = "CREATE EXTENSION IF NOT EXISTS vector;` 一段合规的 SQL 当样本。
- `assert creates_without_guard(bad) == ["CREATE TABLE biz.b", "CREATE INDEX ix"]` 两条不合规的语句各被报告一次。
- `with pytest.raises(AssertionError, match="一条 CREATE 都没找到"):` 期待代码抛出特定异常,`match` 检查报错文字里包含这句话。「没有 CREATE」要报错而不是返回空列表,是防空转。

</div>

```bash
uv run pytest -q part08/test_dictation64.py
```

```text
.........                                                                [100%]
9 passed in 0.02s
```

9 个全绿。默写对不对,看它们**怎么红**。弄坏第一处,把 `index = d.month - 1 + n` 的 `- 1` 去掉:

```text
>       assert add_months(start, n) == expected
E       assert datetime.date(2027, 3, 15) == datetime.date(2027, 2, 15)
>       assert add_months(start, n) == expected
E       assert datetime.date(2026, 3, 31) == datetime.date(2026, 2, 28)
>       assert add_months(start, n) == expected
E       assert datetime.date(2024, 3, 31) == datetime.date(2024, 2, 29)
>       assert add_months(start, n) == expected
E       assert datetime.date(2026, 10, 27) == datetime.date(2026, 9, 27)
>       assert add_months(start, n) == expected
E       assert datetime.date(2027, 2, 5) == datetime.date(2027, 1, 5)
```

五组全红,每组都差一个月,这是漏写 `- 1` 的指纹。再弄坏第二处,把 `min(d.day, ...)` 换成 `d.day`:

```text
E       ValueError: day is out of range for month
part08/dictation64.py:13: ValueError
E       ValueError: day is out of range for month
part08/dictation64.py:13: ValueError
FAILED part08/test_dictation64.py::test_add_months[start1-1-expected1] - Valu...
```

1 月 31 日加一个月,去构造「2 月 31 日」,Python 直接抛 `ValueError`。这两种红色长得不一样,所以你知道自己错在哪。两处都改回,9 个全绿。

## 本周小项目:六个文件互相对账

这一周每一天的检查都只管自己那一摊:`test_schema.py` 管 `schema.sql`,`test_kb.py` 管帮助中心,`test_seed.py` 管造数,`test_docs.py` 管 README 和 Makefile。可是**跨文件**的矛盾没人管。比如造数脚本往 `tickets` 表里多写了一列、`schema.sql` 里没有这一列:造数脚本的测试(不连库)全绿,`schema` 的测试全绿,直到真连库才炸。

所以今天写 `part08/review64.py`,站在这些文件上面,做六个对账:

1. **列对账**:造数写的每一列,`schema.sql` 的表里都有;表里要求必须有值(`NOT NULL` 且没有默认值)的列,造数都给了。
2. **「今天」对账**:`config.py` 的默认值、`.env.example`、README、造数实际用的,四处的日期一致。
3. **README 数字对账**:README 写的 200 个客户、459 张账单、62 篇文章,和真造出来的、真生成的一致。
4. **价格对账**:造数用的每个价格,帮助中心文章里都出现过。
5. **标记对账**:测试里用了的 pytest 标记,`pyproject.toml` 里都登记了。
6. **钩子对账**:`.pre-commit-config.yaml` 里调用的 `make xxx`,Makefile 里真有。

它要 `import` SupportPilot 的 `seed_db`,所以必须在 SupportPilot 的 Python 环境里运行。`uv run --project 路径` 可以做到:用另一个项目的虚拟环境,运行当前目录的脚本。

```python
# agent-zero-lab/part08/review64.py
import importlib
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any

BUILTIN_MARKS = {"parametrize", "skip", "skipif", "xfail", "usefixtures", "filterwarnings"}


def table_columns(schema: str) -> dict[str, dict[str, bool]]:
    """读 schema.sql:{表名: {列名: 这一列是不是必须给值}}。必须给值 = 不允许空、也没有默认值。"""
    tables: dict[str, dict[str, bool]] = {}
    for m in re.finditer(r"CREATE TABLE IF NOT EXISTS biz\.(\w+) \((.*?)\n\);", schema, re.DOTALL):
        cols: dict[str, bool] = {}
        for line in m.group(2).splitlines():
            line = line.split("--")[0].strip().rstrip(",")
            col = re.match(r"(\w+)\s+(?:text|int|numeric|boolean|date|timestamptz|jsonb|bigserial)", line)
            if not col:
                continue  # 表级约束之类不是列
            has_value = "DEFAULT" in line or "bigserial" in line
            not_null = "NOT NULL" in line or "PRIMARY KEY" in line
            cols[col.group(1)] = not_null and not has_value
        tables[m.group(1)] = cols
    return tables


def check_columns(repo: Path, built: Any, tables_order: list[str]) -> list[str]:
    schema = table_columns((repo / "db" / "schema.sql").read_text(encoding="utf-8"))
    rows = {
        "customers": built.customers,
        "subscriptions": built.subs,
        "invoices": built.invoices,
        "tickets": built.tickets,
    }
    problems = []
    for table in tables_order:
        seed_cols = set(rows[table][0])
        extra = seed_cols - set(schema[table])
        missing = {c for c, required in schema[table].items() if required} - seed_cols
        if extra:
            problems.append(f"{table}:造数多了表里没有的列 {sorted(extra)}")
        if missing:
            problems.append(f"{table}:表要求必须有值、造数没给的列 {sorted(missing)}")
    return problems


def check_today(repo: Path, built_today: date) -> list[str]:
    """「今天」写在四个地方:config 默认值、.env.example、README、造数实际用的。四处要一样。"""
    found: dict[str, date] = {"造数": built_today}
    m = re.search(r"sp_today: date = date\((\d+), (\d+), (\d+)\)", (repo / "src/supportpilot/config.py").read_text())
    if m:
        found["config.py"] = date(*map(int, m.groups()))
    for name in (".env.example", "README.md"):
        m = re.search(r"SP_TODAY=(\d{4}-\d{2}-\d{2})", (repo / name).read_text(encoding="utf-8"))
        if m:
            found[name] = date.fromisoformat(m.group(1))
    problems = [f"{name} 里没找到「今天」" for name in (".env.example", "README.md", "config.py") if name not in found]
    if len(set(found.values())) > 1:
        problems.append(f"「今天」不一致:{ {k: str(v) for k, v in found.items()} }")
    return problems


def check_readme_numbers(repo: Path, built: Any) -> list[str]:
    readme = (repo / "README.md").read_text(encoding="utf-8")
    m = re.search(r"(\d+) 个客户、(\d+) 条订阅、(\d+) 张账单、(\d+) 张历史工单", readme)
    if not m:
        return ["README 里没找到「N 个客户、N 条订阅、N 张账单、N 张历史工单」那句"]
    claimed = tuple(map(int, m.groups()))
    actual = (len(built.customers), len(built.subs), len(built.invoices), len(built.tickets))
    problems = [] if claimed == actual else [f"README 写 {claimed},造出来是 {actual}"]
    m = re.search(r"(\d+) 篇 markdown", readme)
    articles = len(list((repo / "data" / "kb").glob("*.md")))
    if not m or int(m.group(1)) != articles:
        problems.append(f"README 写 {m.group(1) if m else '没写'} 篇文章,data/kb/ 里有 {articles} 篇")
    return problems


def check_prices_in_kb(repo: Path, prices: dict[tuple[str, str], int]) -> list[str]:
    """造数用的每个价格,帮助中心里都要出现过,否则客服嘴里的价格和账单对不上。"""
    kb_text = "\n".join(p.read_text(encoding="utf-8") for p in (repo / "data" / "kb").glob("*.md"))
    problems = []
    for (plan, cycle), price in prices.items():
        # 前面不能紧挨着数字或逗号:否则「3,540 元」会被当成出现过「40 元」
        if price and not re.search(rf"(?<![\d,.]){price} 元", kb_text):
            problems.append(f"{plan}/{cycle} 的价格 {price} 在帮助中心里没出现过")
    return problems


def check_marks(repo: Path) -> list[str]:
    config = (repo / "pyproject.toml").read_text(encoding="utf-8")
    block = re.search(r"markers = \[(.*?)\]", config, re.DOTALL)
    registered = set(re.findall(r'"(\w+):', block.group(1))) if block else set()
    used: dict[str, str] = {}
    for f in sorted((repo / "tests").glob("*.py")):
        for name in re.findall(r"pytest\.mark\.(\w+)", f.read_text(encoding="utf-8")):
            if name not in BUILTIN_MARKS and name not in registered:
                used[name] = f.name
    return [f"{f} 用了没登记的标记 {name}" for name, f in used.items()]


def check_hooks(repo: Path) -> list[str]:
    makefile = (repo / "Makefile").read_text(encoding="utf-8")
    targets = set(re.findall(r"^([a-z][a-z-]*):", makefile, re.MULTILINE))
    hooks = (repo / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    return [
        f"pre-commit 里调用了 make {t},Makefile 里没有这个命令"
        for t in re.findall(r"entry: make ([\w-]+)", hooks)
        if t not in targets
    ]


def main(repo: Path) -> int:
    sys.path[:0] = [str(repo / "scripts"), str(repo / "src")]
    seed_db = importlib.import_module("seed_db")  # 要在 supportpilot 的环境里才 import 得到

    built = seed_db.build(date(2026, 10, 1))
    checks = {
        "列对账(造数 vs schema.sql)": check_columns(repo, built, seed_db.TABLES),
        "「今天」对账": check_today(repo, built.today),
        "README 数字对账": check_readme_numbers(repo, built),
        "价格对账(造数 vs 帮助中心)": check_prices_in_kb(repo, seed_db.PRICE),
        "测试标记对账": check_marks(repo),
        "pre-commit 调用的命令对账": check_hooks(repo),
    }
    bad = 0
    for name, problems in checks.items():
        print(f"{name}: " + ("通过" if not problems else f"{len(problems)} 个问题"))
        for p in problems:
            print(f"  - {p}")
        bad += len(problems)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]).expanduser().resolve()))
```

<div class="line-notes">

- `import importlib` 按字符串名字动态导入模块,下面 `main()` 里用。原因:`seed_db` 在 SupportPilot 仓库里,不是这个练习仓库的东西,写成普通 `import seed_db` 的话类型检查器会报「找不到」。
- `BUILTIN_MARKS = {"parametrize", "skip"` pytest 自带的标记,不需要登记。第五个检查要把它们排除。
- `def table_columns(schema: str) -> dict[str, dict[str, bool]]:` 读 `schema.sql`,返回「表名 → {列名 → 是否必须给值}」。
- `re.finditer(r"CREATE TABLE IF NOT EXISTS biz\.(\w+) \((.*?)\n\);", schema, re.DOTALL)` 找每张 `biz` 表的整个定义:捕获组 1 是表名,捕获组 2 是括号里的内容,以单独成行的 `);` 结束。`.*?` 是「非贪婪」匹配,尽量少吃,否则一口吞掉后面所有表。`re.DOTALL` 让 `.` 也能匹配换行。
- `line = line.split("--")[0].strip().rstrip(",")` 去掉行内的 SQL 注释(`--` 后面的部分)、两头空白和行尾逗号。
- `col = re.match(r"(\w+)\s+(?:text|int|numeric|boolean|date|timestamptz|jsonb|bigserial)", line)` 一行是「列名 类型」才算列。`UNIQUE (doc_id, chunk_index)` 这种表级约束第一个词后面不是类型名,匹配不上。
- `continue  # 表级约束之类不是列` 不是列就跳过。
- `has_value = "DEFAULT" in line or "bigserial" in line` 有默认值,或者类型是自增的 `bigserial`,插入时可以不给。
- `not_null = "NOT NULL" in line or "PRIMARY KEY" in line` 不允许空的列。主键隐含不允许空,但 `id text PRIMARY KEY` 这一行里没写 `NOT NULL`,所以要单独认。
- `cols[col.group(1)] = not_null and not has_value` 「必须给值」= 不允许空、又没有默认值。代入 `customers.id`:`PRIMARY KEY` 在行里,没有 `DEFAULT`,所以是 `True`;`company text` 两样都没有,`False`;`is_vip boolean NOT NULL DEFAULT false` 不允许空但有默认值,`False`。
- `def check_columns(repo: Path, built: Any, tables_order: list[str]) -> list[str]:` 第一个检查。`built` 是 `seed_db.build()` 返回的对象,类型写 `Any`,因为它的类型定义在另一个仓库里。
- `rows = {` 四张表对应的行列表。
- `seed_cols = set(rows[table][0])` 取第一行字典的键,当作「造数写了哪些列」。`write()` 就是这么取列名的([Day 445](/blog/agent-zero/day-445-bizdata/))。
- `extra = seed_cols - set(schema[table])` 造数有、表里没有的列。集合相减。
- `missing = {c for c, required in schema[table].items() if required} - seed_cols` 表要求必须给、造数没给的列。
- `def check_today(repo: Path, built_today: date) -> list[str]:` 第二个检查,「今天」写在四处。
- `m = re.search(r"sp_today: date = date` 从 `config.py` 里抠出 `date(2026, 10, 1)` 三个数字。这个正则很脆,练习 2 会专门弄坏它。
- `found["config.py"] = date(*map(int, m.groups()))` `m.groups()` 是三个字符串,`map(int, ...)` 转成整数,`*` 把它们拆开当三个参数传给 `date`。
- `m = re.search(r"SP_TODAY=` `.env.example` 和 README 里都写成 `SP_TODAY=2026-10-01`,用同一个正则。
- `problems = [f"{name} 里没找到「今天」"` 三处里任何一处没找到,都算问题:找不到 ≠ 一致,这是防空转。
- `if len(set(found.values())) > 1:` 把四个日期放进集合,去重后超过一个,说明有不一致。
- `problems.append(f"「今天」不一致:{ {k: str(v) for k, v in found.items()} }")` f-string 花括号里套了字典推导式。外面一层 `{ }` 之间有空格,是为了不和 f-string 的 `{{` 转义混淆。
- `def check_readme_numbers(repo: Path, built: Any) -> list[str]:` 第三个检查。
- `m = re.search(r"(\d+) 个客户、(\d+) 条订阅、(\d+) 张账单、(\d+) 张历史工单", readme)` 抠出 README 里那句话的四个数字。
- `claimed = tuple(map(int, m.groups()))` 转成整数元组,下面直接和 `actual` 比较。
- `actual = (len(built.customers)` 造数真实产出的数量。
- `m = re.search(r"(\d+) 篇 markdown", readme)` 抠出 README 里「62 篇 markdown」的数字。
- `articles = len(list((repo / "data" / "kb").glob("*.md")))` 帮助中心目录里真有几个 `.md`。
- `def check_prices_in_kb(repo: Path, prices: dict[tuple[str, str], int]) -> list[str]:` 第四个检查。`prices` 就是 `seed_db.PRICE`。
- `kb_text = "\n".join(p.read_text(encoding="utf-8")` 把 62 篇文章拼成一大段文本,一起搜。
- `if price and not re.search(rf"(?<![\d,.]){price} 元", kb_text):` `price and` 排除免费版的 0。`(?<![\d,.])` 是「前面不能是数字、逗号或小数点」的否定向后断言。这一行有个故事:我的第一版写成 `f"{price} 元" in kb_text`,把标准版月付改成 40 以后检查居然通过了,因为文章里有「3,540 元」,字符串里包含「40 元」。下面「故意弄坏它」会重现。
- `def check_marks(repo: Path) -> list[str]:` 第五个检查。
- `block = re.search(r"markers = \[(.*?)\]", config, re.DOTALL)` 从 `pyproject.toml` 里取出 `markers = [...]` 方括号里的内容。
- `registered = set(re.findall(r'"(\w+):', block.group(1))) if block else set()` 每项形如 `"db: 说明"`,抠出冒号前的名字。
- `for name in re.findall(r"pytest` 每个测试文件里所有 `pytest.mark.xxx` 的 `xxx`。
- `if name not in BUILTIN_MARKS and name not in registered:` 既不是自带的,也没登记,就是问题。
- `def check_hooks(repo: Path) -> list[str]:` 第六个检查。
- `targets = set(re.findall(r"^([a-z][a-z-]*):", makefile, re.MULTILINE))` Makefile 里的命令名。和 `test_docs.py` 里同样的正则。
- `for t in re.findall(r"entry: make ([\w-]+)", hooks)` 钩子配置里 `entry: make xxx` 调用的命令。
- `def main(repo: Path) -> int:` 总入口,返回退出码。
- `sys.path[:0] = [str(repo / "scripts"), str(repo / "src")]` 把仓库的 `scripts` 和 `src` 放进 Python 搜索路径最前面([Day 445](/blog/agent-zero/day-445-bizdata/) 的 `conftest` 做过类似的事)。
- `seed_db = importlib.import_module("seed_db")` 动态导入,`scripts/seed_db.py` 里 `from supportpilot.config import ...` 要靠 SupportPilot 自己的环境,所以要用 `uv run --project` 运行。
- `built = seed_db.build(date(2026, 10, 1))` 显式传「今天」,不读 `.env`,和测试里的做法一致。
- `checks = {` 六个检查的名字和结果放进字典,下面统一打印。
- `print(f"{name}: " + ("通过" if not problems else f"{len(problems)} 个问题"))` 每个检查一行总结,再缩进列出具体问题。
- `return 1 if bad else 0` 有任何问题,退出码是 1,以后接进 CI 或 pre-push 钩子也能用。
- `sys.exit(main(Path(sys.argv[1]).expanduser().resolve()))` 从命令行第一个参数取仓库路径,`expanduser()` 把 `~` 换成家目录。

</div>

```bash
uv run --project ~/supportpilot python part08/review64.py ~/supportpilot
```

```text
列对账(造数 vs schema.sql): 通过
「今天」对账: 通过
README 数字对账: 通过
价格对账(造数 vs 帮助中心): 通过
测试标记对账: 通过
pre-commit 调用的命令对账: 通过
```

六项一次全过。照 Day 440 的经验,一次全过反而该警惕:要么文件真的一致,要么检查太松。分辨办法只有一个,故意弄坏。

### 故意弄坏它

在 `~/supportpilot` 的一份拷贝上(别动真仓库)改六处,每处对应一个检查:

1. `scripts/seed_db.py` 的 `ticket()` 字典里多写一列 `"phone": "13800000000"`;
2. `.env.example` 里 `SP_TODAY` 改成 `2026-10-02`;
3. README 里 `459 张账单` 改成 `460 张账单`;
4. `tests/test_smoke.py` 末尾加一个标了 `@pytest.mark.slow` 的测试;
5. `.pre-commit-config.yaml` 里 `entry: make test` 改成 `entry: make tests`;
6. 另一份拷贝里,`seed_db.py` 的标准版月付价改成 40(这一处单独放一份,第六处单独说)。

前五处放在同一份拷贝里跑:

```text
列对账(造数 vs schema.sql): 1 个问题
  - tickets:造数多了表里没有的列 ['phone']
「今天」对账: 1 个问题
  - 「今天」不一致:{'造数': '2026-10-01', 'config.py': '2026-10-01', '.env.example': '2026-10-02', 'README.md': '2026-10-01'}
README 数字对账: 1 个问题
  - README 写 (200, 200, 460, 152),造出来是 (200, 200, 459, 152)
价格对账(造数 vs 帮助中心): 通过
测试标记对账: 1 个问题
  - test_smoke.py 用了没登记的标记 slow
pre-commit 调用的命令对账: 1 个问题
  - pre-commit 里调用了 make tests,Makefile 里没有这个命令
```

五处各被各自的检查抓到,而且报错说的就是我弄坏的那一处;价格那项通过,因为我没动价格。第六处:

```bash
sed -i '' 's/("standard", "monthly"): STD_MONTH/("standard", "monthly"): 40/' scripts/seed_db.py
```

**我第一次写价格检查时用的是子串判断:`f"{price} 元" in kb_text`。** 这一次它的结果是:

```text
列对账(造数 vs schema.sql): 通过
「今天」对账: 通过
README 数字对账: 通过
价格对账(造数 vs 帮助中心): 通过
测试标记对账: 通过
pre-commit 调用的命令对账: 通过
```

**六项全过。** 价格明明改成了 40,帮助中心里没有哪篇说标准版月付 40 元,检查却说通过。查了一下原因:

```bash
grep -rl '40 元' data/kb | head
grep -h -o '.\{4\}40 元' data/kb/KB-plans-001.md data/kb/KB-plans-005.md
```

```text
data/kb/KB-plans-005.md
data/kb/KB-plans-001.md
 3,540 元
 3,540 元
```

企业版最低年费是 `3,540 元`,字符串里正好包含「40 元」。子串判断是个漏洞:价格 40 在文章里「出现过」,出现的却是别的数字的后半截。修法就是你在代码里看到的那条正则,`(?<![\d,.])` 要求前面不能紧挨着数字、逗号或小数点:

```text
列对账(造数 vs schema.sql): 通过
「今天」对账: 通过
README 数字对账: 通过
价格对账(造数 vs 帮助中心): 1 个问题
  - standard/monthly 的价格 40 在帮助中心里没出现过
测试标记对账: 通过
pre-commit 调用的命令对账: 通过
```

这次抓到了。**这是本周最值得带走的一课:检查自己也会有漏洞,而且它漏的时候,输出是和「一切正常」一模一样的「通过」。** 所以每写一个检查,都要先看它红一次。练习 4 会给这个检查本身写测试,把「3,540 元」这个漏洞永远钉住。

## 本周错题与坑清单

这些都是这一周六天里真实出现过的报错或现象,按我觉得最容易再犯的顺序排:

1. **漏写 `index = d.month - 1 + n` 里的 `- 1`。** 五组测试全红,每组都差一个月(Day 445,今天默写里重现)。
2. **f-string 拼 SQL。** 运行没问题,类型检查器报 `str` 不能赋给 `QueryNoTemplate`;正确做法是 `sql.SQL` 加 `sql.Identifier`(Day 445)。
3. **全局 `random.seed(42)` 当成固定了。** 中间别的代码用了一次全局随机数,同一个 42 得到 `[82, 15, 4]` 和 `[4, 95, 36]`(Day 445)。
4. **写库顺序反了。** 订阅先于客户,`ForeignKeyViolation`(Day 445)。
5. **`make -j` 并行跑 `data`。** `seed` 抢在 `init` 前面,报「vector type not found」(Day 446)。
6. **空库上直接 `connect()`。** `register_vector` 找不到 `vector` 类型。建表要先有连接,连接要先有 `vector` 类型,所以 `init_db.py` 用裸连接(Day 443)。
7. **Makefile 用空格缩进。** `missing separator`,看起来和 Tab 一模一样(Day 446)。
8. **目标名撞上同名目录。** `make docs` 打印 `is up to date` 什么也不做,要 `.PHONY`(Day 446)。
9. **pytest 标记拼错没开 `--strict-markers`。** 本该被筛掉的连库测试悄悄跑了(Day 446)。
10. **`get_settings()` 的缓存。** 进程里改了环境变量看不见,第二个 5 才是 9(Day 442)。
11. **用 `date.today()` 算期限。** 同一张订单,系统时钟算第 33 天,配置里的「今天」算第 7 天(Day 442)。
12. **帮助中心的交叉引用写成「大概的标题」。** 《E4001 支付失败》少了「,卡被拒绝」,人眼看不出,检查脚本一下抓出(Day 444)。
13. **新版 pre-commit 配老 git。** `git ls-files --deduplicate` 在 2.24.3 上不认识,锁 `pre-commit<4.6.1`(Day 441)。
14. **检查自己有漏洞。** 子串判断被「3,540 元」骗过,今天亲眼看到(Day 447)。
15. **「一次过」就以为检查没问题。** `review64.py` 一次六项全过,才要故意弄坏,而且弄坏第六处时才发现价格检查是松的。

## 动手练习

### 练习 1:再加两个对账

给 `review64.py` 加两个检查(写在新文件 `part08/review64_extra.py` 里,不动原文件):(a) Makefile 里引用的每个 `scripts/xxx.py` 都真有这个文件;(b) 用了 `conn` 夹具的测试文件,必须标 `pytest.mark.db`,否则 `make test` 会去碰数据库。各弄坏一次验证。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part08/review64_extra.py
import re
import sys
from pathlib import Path


def check_make_scripts_exist(repo: Path) -> list[str]:
    """Makefile 里每个 `scripts/xxx.py` 都要真有这个文件。"""
    makefile = (repo / "Makefile").read_text(encoding="utf-8")
    return [
        f"Makefile 引用了 {name},仓库里没有这个文件"
        for name in sorted(set(re.findall(r"scripts/[\w]+\.py", makefile)))
        if not (repo / name).exists()
    ]


def check_live_tests_are_marked(repo: Path) -> list[str]:
    """用了 conn 这个 fixture 的测试文件,必须标 pytest.mark.db,否则 make test 会去碰数据库。"""
    problems = []
    for f in sorted((repo / "tests").glob("test_*.py")):
        text = f.read_text(encoding="utf-8")
        uses_db = re.search(r"def test_\w+\((?:[^)]*, )?conn\b", text) is not None
        if uses_db and "pytest.mark.db" not in text:
            problems.append(f"{f.name} 用了 conn,却没有 pytestmark = pytest.mark.db")
    return problems


if __name__ == "__main__":
    repo = Path(sys.argv[1]).expanduser().resolve()
    for check in (check_make_scripts_exist, check_live_tests_are_marked):
        problems = check(repo)
        print(f"{check.__name__}: " + ("通过" if not problems else f"{len(problems)} 个问题"))
        for p in problems:
            print(f"  - {p}")
```

<div class="line-notes">

- `import sys` 读命令行参数用。
- `re.findall(r"scripts/[\w]+\.py", makefile)` 找 Makefile 里所有 `scripts/xxx.py`。`\.` 是字面意义的点。外面的 `sorted(set(...))` 去重再排序,输出顺序稳定。
- `if not (repo / name).exists()` 路径拼出来,不存在就是问题。
- `uses_db = re.search(r"def test_\w+\((?:[^)]*, )?conn\b", text) is not None` 找「测试函数参数里有 `conn`」:函数名后的括号里,`conn` 要么是第一个参数,要么前面有别的参数加逗号。`\b` 保证是单词 `conn` 而不是 `conn2` 的前缀。
- `if uses_db and "pytest.mark.db" not in text:` 用了连库夹具,却没有标记,就是问题。
- `for check in (check_make_scripts_exist, check_live_tests_are_marked):` 函数也是对象,可以放进元组里循环调用;`check.__name__` 是函数的名字。

</div>

先在干净的仓库上跑,再在一份拷贝上弄坏(把 `tests/test_seed_live.py` 里的 `pytestmark = ...` 一行删掉、把 Makefile 里 `scripts/gen_kb.py` 改成 `scripts/gen_kb2.py`):

```text
check_make_scripts_exist: 通过
check_live_tests_are_marked: 通过
```

```text
check_make_scripts_exist: 1 个问题
  - Makefile 引用了 scripts/gen_kb2.py,仓库里没有这个文件
check_live_tests_are_marked: 1 个问题
  - test_seed_live.py 用了 conn,却没有 pytestmark = pytest.mark.db
```

两个都抓到。第二个检查值得留着:忘了标 `db` 时 `make test` 不会红,只是悄悄变慢、变得依赖数据库,没有它根本发现不了。

</details>

### 练习 2:正则太脆,什么时候会误报

`check_today` 用 `sp_today: date = date\((\d+), (\d+), (\d+)\)` 去抠 `config.py` 里的默认日期。把 `config.py` 里那一行改写成 `sp_today: date = date.fromisoformat("2026-10-01")`(值一样,写法不同),再跑 `review64.py`。会发生什么?这算「检查对了」还是「检查错了」?

<details><summary>参考答案</summary>

```bash
sed -i '' 's/sp_today: date = date(2026, 10, 1)/sp_today: date = date.fromisoformat("2026-10-01")/' src/supportpilot/config.py
uv run --project ~/supportpilot python part08/review64.py ~/supportpilot
```

```text
「今天」对账: 1 个问题
  - config.py 里没找到「今天」
README 数字对账: 通过
价格对账(造数 vs 帮助中心): 通过
```

日期的值没变,检查却红了:这是**误报**。它不是在检查「日期一致」,而是在检查「`config.py` 里这一行的写法恰好是 `date(年, 月, 日)`」。好在它红的方式是「没找到」而不是「悄悄通过」,这是我在检查里特意留的:找不到算问题,而不是跳过。如果当初写成「找到才比较,找不到就跳过」,改了写法之后这个检查会安静地失效,比误报糟糕得多。

两种修法:一是放宽正则,同时认两种写法;二是改用真的 `import`:`from supportpilot.config import Settings`,直接读 `Settings.model_fields["sp_today"].default`,不再靠文本匹配。第二种更可靠,代价是要在 SupportPilot 的环境里 `import`(我们本来就是这样运行的)。这里留作你的选择,我没有再改 `review64.py`。

取舍的结论:对「文本里的数字」做正则检查,脆是正常的,要接受它偶尔误报,但绝不能接受它漏报,所以每个检查都要有「没找到就报问题」的出口。

</details>

### 练习 3:一个检查要同时抓住哪几种错

`check_prices_in_kb` 现在会抓「价格没出现过」。想一想:如果帮助中心里写的是「标准版 39 元/月」,而造数里的价格被改成了 `39.0`(浮点数),检查会怎样?如果改成 `"39"`(字符串)呢?先预测,再在 Python 里验证。

<details><summary>参考答案</summary>

检查里用的是 `rf"(?<![\d,.]){price} 元"`,价格是被 f-string 格式化进去的。验证:

```python
import re

for price in (39, 39.0, "39"):
    print(repr(price), bool(re.search(rf"(?<![\d,.]){price} 元", "标准版 39 元/月")))
```

```text
39 True
39.0 False
'39' True
```

整数 39 和字符串 `"39"` 格式化出来都是 `39`,能匹配;浮点数 `39.0` 格式化出来是 `39.0`,文章里没有「39.0 元」,所以检查会报「价格 39.0 在帮助中心里没出现过」。这一次它报对了:数据库里金额列是 `numeric(10,2)`,Python 里用浮点数传价格不是好习惯,金额最好用整数(分)或者 `Decimal`。但换个角度,这个检查给出的提示文字是「没出现过」,没有说「类型不对」,读报错的人要自己想到浮点格式。要更清楚,可以在检查前先 `assert isinstance(price, int)`,让错误信息直接说类型。

</details>

### 练习 4:给检查自己写测试

把今天弄坏价格检查时发现的「3,540 元」漏洞写成测试,永远钉住。用 pytest 的 `tmp_path`(临时目录夹具),不需要真的 SupportPilot 仓库。再给 `table_columns` 写一个测试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part08/test_review64.py
from pathlib import Path

import pytest

from part08.review64 import check_prices_in_kb, table_columns

PRICES = {("standard", "monthly"): 40, ("free", "monthly"): 0}


def kb_with(tmp_path: Path, text: str) -> Path:
    (tmp_path / "data" / "kb").mkdir(parents=True)
    (tmp_path / "data" / "kb" / "KB-plans-001.md").write_text(text, encoding="utf-8")
    return tmp_path


def test_price_found(tmp_path: Path):
    repo = kb_with(tmp_path, "标准版 40 元/月")
    assert check_prices_in_kb(repo, PRICES) == []


def test_price_missing(tmp_path: Path):
    repo = kb_with(tmp_path, "标准版 39 元/月")
    assert check_prices_in_kb(repo, PRICES) == ["standard/monthly 的价格 40 在帮助中心里没出现过"]


@pytest.mark.parametrize("text", ["最低 3,540 元/年", "共 140 元", "约 0.40 元"])
def test_price_is_not_a_suffix_of_a_bigger_number(tmp_path: Path, text: str):
    """「40 元」不能靠「3,540 元」「140 元」「0.40 元」蒙混过关(第一版用子串判断,被 3,540 骗过)。"""
    repo = kb_with(tmp_path, text)
    assert len(check_prices_in_kb(repo, PRICES)) == 1


def test_table_columns_marks_required():
    schema = """CREATE TABLE IF NOT EXISTS biz.t (
    id text PRIMARY KEY,
    name text NOT NULL,
    note text,
    flag boolean NOT NULL DEFAULT false,
    UNIQUE (id, name)
);"""
    assert table_columns(schema) == {"t": {"id": True, "name": True, "note": False, "flag": False}}
```

<div class="line-notes">

- `from part08.review64 import check_prices_in_kb, table_columns` 这两个函数不需要 `seed_db`,所以能在练习仓库的普通环境里导入、测试。
- `PRICES = {("standard", "monthly"): 40, ("free", "monthly"): 0}` 一个迷你价格表,免费版的 0 用来确认被跳过。
- `def kb_with(tmp_path: Path, text: str) -> Path:` 测试辅助:在临时目录里造一个只有一篇文章的帮助中心。
- `(tmp_path / "data" / "kb").mkdir(parents=True)` `tmp_path` 是 pytest 给每个测试的全新临时目录(Day 444 用过),`parents=True` 把上级目录一起建。
- `.write_text(text, encoding="utf-8")` 写入文章内容。
- `assert check_prices_in_kb(repo, PRICES) == []` 价格 40 在文章里,没有问题。
- `def test_price_missing(tmp_path: Path):` 文章里写的是 39,检查要报告 40 没出现。
- `@pytest.mark.parametrize("text", ["最低 3,540 元/年", "共 140 元", "约 0.40 元"])` 三种「40 元」只是别人后半截的情形:带千分位逗号、前面还有数字、前面是小数点。每一种都要报问题,第一版的子串判断三种全都放过。
- `assert len(check_prices_in_kb(repo, PRICES)) == 1` 每种情形都报 1 个问题。
- `assert table_columns(schema) == {"t"` 一张迷你表:`id` 是主键必须给,`name` 是 `NOT NULL` 必须给,`note` 可以空,`flag` 有默认值,`UNIQUE (...)` 那行不是列,不出现在结果里。

</div>

```bash
uv run pytest -q part08
```

```text
...............                                                          [100%]
15 passed in 0.06s
```

15 个是 9 个默写测试加这 6 个(价格检查 5 个,`table_columns` 1 个)。想验证它真的钉住了漏洞:把 `check_prices_in_kb` 里的正则换回 `f"{price} 元" in kb_text` 这种子串判断,`test_price_is_not_a_suffix_of_a_bigger_number` 的三个参数会全红。我写文章时没有再去重现这一步,只验证了正则版是绿的。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 对账 | 让两份应该一致的文件互相检查。每份单独通过,不代表它们之间对得上 |
| 误报 / 漏报 | 检查把正常的东西报成有问题(误报),或者该报的没报(漏报)。误报会磨掉人对检查的信任,漏报更危险,因为输出和「一切正常」一模一样 |
| 防空转 | 检查里先断言「真的找到了东西」,免得正则写坏、文件读错时找不到任何东西、于是什么问题也没报,最后「通过」 |
| 否定向后断言 `(?<!...)` | 正则里「前面不能是……」的写法,本身不占字符。`(?<![\d,.])40 元` 要求「40 元」前面不是数字、逗号、小数点 |
| 否定向前断言 `(?!...)` | 「后面不能紧跟……」。`CREATE TABLE\s+(?!IF NOT EXISTS)` 找没有 `IF NOT EXISTS` 的 `CREATE TABLE` |
| 非贪婪 `.*?` | 正则里尽量少匹配。`\((.*?)\n\);` 在遇到第一个 `\n);` 就停,不会吞掉后面所有表 |
| `importlib.import_module` | 按字符串名字动态导入模块,类型检查器不会因为找不到静态 `import` 而报错 |
| `uv run --project` | 用另一个项目的虚拟环境运行当前位置的脚本。要 `import` 别的项目的代码时用 |
| 退出码 | 程序结束时返回给 shell 的数字,0 是成功,非 0 是失败。`sys.exit(1)` 让检查脚本能接进 CI 或钩子 |
| 默写 | 合上文章凭记忆把核心代码写出来再对照。写不出来的地方,就是没有真正掌握的地方 |

## 常见误区

**以为每份文件单独通过,整个项目就对。** 造数的测试绿、schema 的测试绿,造数多写一列却没人知道,直到真连库才炸。跨文件的关系没人看管,所以要专门写对账。

**检查通过就相信它。** 价格检查第一版通过了一个明明改错的价格,原因是子串判断被「3,540 元」骗过。「通过」只说明检查没发现问题,不说明没有问题。写检查的人要负责证明它会红。

**用正则抠文本,又想它永不误报。** 把 `date(2026, 10, 1)` 写成 `date.fromisoformat("2026-10-01")`,检查就找不到了。文本匹配是脆的。真正的要求是「找不到时报问题,而不是悄悄跳过」,宁可误报也别漏报。

**默写时只看结果对,不看怎么错。** 漏写 `- 1` 和漏写 `min` 的红色完全不同:前者五组全红、每组差一个月,后者直接 `ValueError`。看得懂这两种红,你才真的会调这段代码。

**在真仓库上弄坏它来试检查。** 今天的六处破坏全在拷贝上做。弄坏的那份别提交,别放进真仓库。

**复习日当成休息日。** 它的作用是确认没有哪一块只是「看懂了」。默写写不出来的那一段,明天先补它,别往下走。

## 学习资料

### 文档与文章

- [Python 文档 · 正则表达式 HOWTO](https://docs.python.org/zh-cn/3.12/howto/regex.html):今天用到的捕获组、非贪婪、前后断言都在这里。读「更多模式功能」一节里的断言。30 分钟。
- [pytest 文档 · tmp_path](https://docs.pytest.org/en/stable/how-to/tmp_path.html):练习 4 的临时目录夹具。10 分钟。
- [Python 文档 · importlib](https://docs.python.org/zh-cn/3.12/library/importlib.html):`import_module` 的说明,读开头和这一个函数就够。
- [Python 文档 · calendar](https://docs.python.org/zh-cn/3.12/library/calendar.html):`monthrange` 在默写一里用。
- [pytest 文档 · 标记](https://docs.pytest.org/en/stable/how-to/mark.html):Day 446 的标记和 `--strict-markers`,第五个对账检查的依据。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1bY411y7dv&autoplay=0&high_quality=1" title="Python单元测试-08.PyTest框架" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>跟峰哥学编程 · Python单元测试-08.PyTest框架 · 约 21 分钟。Day 72 推荐过。复习日重看「运行参数」和「失败报告」两段:今天默写的测试红起来长什么样,这里有讲。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13WGHz8EEz&autoplay=0&high_quality=1" title="从pip到uv:一口气梳理现代Python项目管理全流程!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · 从pip到uv:一口气梳理现代Python项目管理全流程! · 约 16 分钟,播放 26 万多。Day 441 推荐过。本周第一天的工具链,复习时把它和今天 `uv run --project` 的用法对照着看。视频里的 uv 版本比 0.13 早。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/cHYq1MRoyI0" title="Pytest Tutorial – How to Test Python Code" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp.org · Pytest Tutorial – How to Test Python Code · 英文,可开自动字幕。把 pytest 从头讲一遍。我没有逐分钟核对内容,按标题当补充看,重点看夹具和 `parametrize` 的部分。</figcaption>
</figure>

### 书籍

- Harry Percival、Bob Gregory《Architecture Patterns with Python》(O'Reilly,2020,[作者免费在线版](https://www.cosmicpython.com/)):讲怎么用 Python 把业务逻辑和数据库、接口分开,用测试守住,和我们 `build()`/`write()` 分开的思路是同一路。英文原版,我没确认有没有正式中译本。第 1、2 章够用。

### 开源项目与代码

- [pre-commit/pre-commit-hooks](https://github.com/pre-commit/pre-commit-hooks):Day 441 配置里的那批通用检查,每个钩子源码都很短。想想今天的 `review64.py` 如果做成一个钩子,会是什么样。

## 自测

1. 本周六天的主线是什么?每天立的规矩和对应的检查各是什么?

<details><summary>答案</summary>

主线是同一个动作:给仓库的一个角落立规矩,再配一个能自动跑的检查。Day 441:工具链,检查是 ruff 和 pre-commit;Day 442:配置,检查是 `test_config.py`(包括 `.env.example` 和 `Settings` 对账);Day 443:数据库,检查是 `test_schema.py` 和连库的测试;Day 444:帮助中心,检查是 `check_kb.py`;Day 445:业务数据,检查是 `test_seed.py` 里守剧情客户数字的那些;Day 446:命令和 README,检查是 `test_docs.py`。

</details>

2. `index = d.month - 1 + n` 为什么要减一?漏掉会怎样?

<details><summary>答案</summary>

月份从 1 数起,整除和取余要从 0 数起才对得上年的边界(12 个月一整年)。漏掉 `- 1`,每个结果都往后多一个月:五组测试全红,每组都差一个月,12 月加 1 个月会算出 2027 年 2 月而不是 1 月。

</details>

3. 为什么 `creates_without_guard` 在找不到任何 `CREATE` 时要报错,而不是返回空列表?

<details><summary>答案</summary>

返回空列表在调用者眼里就是「没有问题」。如果文件路径读错了、正则写坏了,什么都没找到,检查就会静悄悄地「通过」。让它报错,「检查没在工作」和「检查通过」才分得开。这是本周反复出现的「防空转」。

</details>

4. 价格检查第一版为什么被「3,540 元」骗过?怎么修?

<details><summary>答案</summary>

第一版用 `f"{price} 元" in kb_text` 判断,字符串 `"40 元"` 是 `"3,540 元"` 的后半截,所以价格改成 40 以后检查仍然通过。修法是用正则 `(?<![\d,.])40 元`,要求前面不能紧挨着数字、逗号或小数点。并且要把这个漏洞写成测试,三种前缀情形各一个。

</details>

5. `review64.py` 为什么要用 `uv run --project ~/supportpilot` 运行?

<details><summary>答案</summary>

它要 `import` SupportPilot 仓库里的 `seed_db`,而 `seed_db` 又依赖 `psycopg`、`pydantic-settings` 和 SupportPilot 自己的包。这些在练习仓库的虚拟环境里没有,所以用 `--project` 借 SupportPilot 的虚拟环境来运行当前目录的脚本。

</details>

6. **面试题**:「你的项目里有很多检查脚本和测试,你怎么知道它们自己是对的?」

<details><summary>答案</summary>

检查本身也是代码,会有漏洞,而且最危险的漏洞是漏报:输出和「一切正常」一模一样。我的做法是每写一个检查,先故意弄坏被检查的东西,确认它会红,并且报的就是我弄坏的那一处。我最近一次:写了一个让造数价格和帮助中心文章对账的检查,第一次用子串判断,改错价格后它仍然通过,原因是文章里有「3,540 元」包含了「40 元」。我改成带前后断言的正则,并把这个情形写成三个测试钉住。另外,检查里「没找到」要报问题而不是跳过,这样它在被检查对象改了写法时是误报,而不是悄悄失效。误报烦人但看得见,漏报才会让人以为没事。

</details>

## 明天预告

明天是 Day 448 · 知识库(一):按小标题切块,给每块戴帽子。骨架这一周结束,从明天起往仓库里放真正的功能。第一个是知识库:Day 444 造好了 62 篇帮助中心文章,但 Agent 不会整篇读,要先把每篇按小标题切成块,再给每一块加一顶「帽子」(标题和来源),让检索时能知道这块话出自哪篇、哪一节。明天用到的 `data/kb/` 和 `kb.chunks` 表,就是这一周造的。
