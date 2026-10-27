---
title: 'Day 440 · 第 63 周复习:毕业项目(Day 434–439)'
description: '把这一周六天收成一张图:每天都在把一件靠感觉的事变成能被脚本检查的文件。默写两段容易写错的代码(滑动窗口限流、相对 import 的换算)并用测试证明,再写一个只用本周知识的 review63.py,让 PRD、方块表、排期、成本估算互相对账,故意弄坏五处看它抓到。最后用本周的数字算一笔账:限流到底能不能挡住花钱。'
pubDate: 2026-10-27
regime: none
tags: ['review', 'capstone', 'supportpilot', 'rate-limit', 'ast', 'agent-zero']
series: 'agent-zero'
day: 440
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 439](/blog/agent-zero/day-439-schedule-cost/) 把方块表排成了 Day 441 到 497 的日历,写了两条检查规则(方块不能落在复习日,文件不能排在它依赖的文件前面),第一次跑就抓到我自己排的两处顺序错(`llm.py` 和 `nodes.py`);然后量了 token 比例,估出平均每张工单约 ¥0.014,含评审 ¥0.019,比 PRD 里 M13 的 ¥0.05 红线有 2.7 倍余量。

这一周的六天,表面上很散:部署和故障演练、选题、访谈、PRD、架构、排期。其实后五天是同一个动作:**把一件靠感觉的事,写成一个能被脚本检查的文件**。今天不学新东西,把这六天收拢,默写两段最容易写错的代码,再做一个只用本周知识的小项目:让前几天写的几份文件互相检查。明天 Day 441 就要开始建真正的仓库,今天先确认手上的东西对得上。

## 今天要解决的问题

复习日的目标是确认这一周的东西真的长在你手上了。今天结束时你应该能:

1. 不看文章,画出本周六天的主线(从预发演练到选题、访谈、PRD、架构、排期成本),说出每一天产出的那个「能被检查的文件」叫什么。
2. 默写 Day 434 的滑动窗口限流 `too_many()` 和 Day 438 的相对 import 换算 `resolve()`、`imported_modules()`,并分别用 4 个和 6 个测试证明默写对了。
3. 跑通本周小项目 `part08/review63.py`:五个检查把 PRD、方块表、排期、成本估算互相对账,再故意弄坏五处,看每个检查各抓到哪一处。
4. 能解释本周三个最容易混的地方:限流不等于挡住花钱;脚本检查通过不等于内容是对的;估算不能回头凑实测数。

今天不调模型,不花钱。预计用时 3–4 小时,大头在默写和练习。前置:[Day 434](/blog/agent-zero/day-434-prod-project-2/) 到 [Day 439](/blog/agent-zero/day-439-schedule-cost/) 全部;默写一的测试用到 [Day 74](/blog/agent-zero/day-074-pytest-4/) 的 monkeypatch。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

先看全貌:

<figure>
<svg viewBox="0 0 640 262" role="img" aria-label="第 63 周知识地图:从预发演练到选题、访谈、PRD、架构、排期成本,每一步产出一个能被脚本检查的文件,最后由 review63.py 互相对账">
  <g font-family="var(--font-mono)" font-size="12">
    <text x="14" y="24" fill="var(--ink-soft)">每一天都产出一个「能被脚本检查」的东西(第二行脚本名,第三行产出)</text>
    <rect x="14" y="40" width="98" height="52" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="63" y="60" text-anchor="middle" fill="var(--ink-faint)">Day 434</text>
    <text x="63" y="80" text-anchor="middle" fill="var(--ink)">预发和演练</text>
    <text x="63" y="112" text-anchor="middle" fill="var(--ink-soft)" font-size="10">smoke.py</text>
    <text x="63" y="128" text-anchor="middle" fill="var(--ink-faint)" font-size="10">7 项演练表</text>
    <rect x="118" y="40" width="98" height="52" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="167" y="60" text-anchor="middle" fill="var(--ink-faint)">Day 435</text>
    <text x="167" y="80" text-anchor="middle" fill="var(--ink)">选题</text>
    <text x="167" y="112" text-anchor="middle" fill="var(--ink-soft)" font-size="10">judge()</text>
    <text x="167" y="128" text-anchor="middle" fill="var(--ink-faint)" font-size="10">4 条标准</text>
    <line x1="112" y1="66" x2="118" y2="66" stroke="var(--ink-faint)"/>
    <rect x="222" y="40" width="98" height="52" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="271" y="60" text-anchor="middle" fill="var(--ink-faint)">Day 436</text>
    <text x="271" y="80" text-anchor="middle" fill="var(--ink)">访谈</text>
    <text x="271" y="112" text-anchor="middle" fill="var(--ink-soft)" font-size="10">requirements.py</text>
    <text x="271" y="128" text-anchor="middle" fill="var(--ink-faint)" font-size="10">12 行需求</text>
    <line x1="216" y1="66" x2="222" y2="66" stroke="var(--ink-faint)"/>
    <rect x="326" y="40" width="98" height="52" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="375" y="60" text-anchor="middle" fill="var(--ink-faint)">Day 437</text>
    <text x="375" y="80" text-anchor="middle" fill="var(--ink)">PRD</text>
    <text x="375" y="112" text-anchor="middle" fill="var(--ink-soft)" font-size="10">prd_check.py</text>
    <text x="375" y="128" text-anchor="middle" fill="var(--ink-faint)" font-size="10">16 个指标</text>
    <line x1="320" y1="66" x2="326" y2="66" stroke="var(--ink-faint)"/>
    <rect x="430" y="40" width="98" height="52" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="479" y="60" text-anchor="middle" fill="var(--ink-faint)">Day 438</text>
    <text x="479" y="80" text-anchor="middle" fill="var(--ink)">架构</text>
    <text x="479" y="112" text-anchor="middle" fill="var(--ink-soft)" font-size="10">check_arch.py</text>
    <text x="479" y="128" text-anchor="middle" fill="var(--ink-faint)" font-size="10">53 个方块</text>
    <line x1="424" y1="66" x2="430" y2="66" stroke="var(--ink-faint)"/>
    <rect x="534" y="40" width="98" height="52" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="583" y="60" text-anchor="middle" fill="var(--ink-faint)">Day 439</text>
    <text x="583" y="80" text-anchor="middle" fill="var(--ink)">排期成本</text>
    <text x="583" y="112" text-anchor="middle" fill="var(--ink-soft)" font-size="10">schedule.py</text>
    <text x="583" y="128" text-anchor="middle" fill="var(--ink-faint)" font-size="10">57 天 + ¥65</text>
    <line x1="528" y1="66" x2="534" y2="66" stroke="var(--ink-faint)"/>
    <line x1="167" y1="136" x2="167" y2="176" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
    <line x1="271" y1="136" x2="271" y2="176" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
    <line x1="375" y1="136" x2="375" y2="176" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
    <line x1="479" y1="136" x2="479" y2="176" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
    <line x1="583" y1="136" x2="583" y2="176" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
    <rect x="14" y="176" width="612" height="44" rx="5" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
    <text x="320" y="196" text-anchor="middle" fill="var(--ink)">review63.py:PRD ↔ 方块表 ↔ 排期 ↔ 成本估算</text>
    <text x="320" y="212" text-anchor="middle" fill="var(--ink-soft)" font-size="11">五个检查,让这几份文件互相对账</text>
    <text x="14" y="244" fill="var(--ink-faint)" font-size="11">蓝:弄清做什么(435–437) · 琥珀:落到文件、日历、预算(438–439) · 白:上一部分的收尾(434)</text>
  </g>
</svg>
<figcaption>这一周的主线是同一个动作重复六次:把一件靠感觉的事,变成一个能被脚本检查的文件。最后一步是让这些文件互相检查。</figcaption>
</figure>

读图时留意两件事。第一,**第二行的脚本名是一条线索**:`requirements.py` 检查需求有验收办法,`prd_check.py` 检查 PRD 的目标有指标,`check_arch.py` 检查方块有文件、依赖没反,`schedule.py` 检查排期不矛盾。每一份文件单独都能通过,可它们之间有没有对上,没人检查,今天的 `review63.py` 就补这一环。第二,Day 434 不在这条线上,它是上一部分(生产化)的收尾,但它给后面留了东西:限流和每日预算的思路,会在 Day 487 到 490 的安全和上线那几天用到。

| 天 | 回答的问题 | 能被检查的文件 | 抓到过什么 |
| --- | --- | --- | --- |
| 434 | 服务坏了会怎样 | 演练表、`smoke.py` | 库打不开整轮崩、审计写不进流无声断开 |
| 435 | 做什么题 | `judge()` 判卷函数 | 「不能全额退款」被判成对 |
| 436 | 客户到底要什么 | `requirements.py` | 访谈里漏掉企业版(F07) |
| 437 | 做到什么程度算做完 | `prd_check.py` | 目标没指标、非目标没理由 |
| 438 | 每个方块在哪个文件 | `check_arch.py` | 层表定错两处 |
| 439 | 哪天做、花多少钱 | `schedule.py`、`cost.py` | `llm.py`、`nodes.py` 排反 |

## 本周每天一句话

[Day 434 · 小项目(二):部署到公网和故障演练](/blog/agent-zero/day-434-prod-project-2/):在本机用 Caddy 搭了和线上同样结构的预发,按 IP 限流用滑动窗口,实测直连 uvicorn 时伪造 `X-Forwarded-For` 能绕过限流、经过 Caddy 就不能;七项故障演练先写预期再动手,其中库打不开和审计写不进两项对不上,当场修好。

[Day 435 · 开题:为什么做智能客服工单](/blog/agent-zero/day-435-capstone-why/):选题标准四条(覆盖高频技能、有对错、有风险、对接企业系统),「有对错」最要紧,因为有对错才写得出判卷函数,有判卷函数才有评测;关键词统计只能排除方向,不能当结论。

[Day 436 · 像 FDE 那样拆需求](/blog/agent-zero/day-436-fde-requirements/):问意见得到客套,问过去得到事实,同一个模拟客户,前者问出 0 条事实后者 10 条;访谈原话拆成「真实问题、需求、验收办法」的需求表,检查每条要做的需求都有验收办法、每条事实都有去处;模拟客户只练手法,不是事实来源。

[Day 437 · 一页 PRD](/blog/agent-zero/day-437-prd/):六块(背景、用户、目标、非目标、指标、风险),目标有编号有来源,非目标每条有理由,指标写四要素(数字、口径、测试集合、对应目标);脚本能抓格式和对账,抓不到内容好不好。

[Day 438 · 架构:每个方块后面是哪个文件](/blog/agent-zero/day-438-architecture/):图写成「方块 → 文件 → 哪天建 → 应该有什么名字」的表,再用六层加两条禁令规定谁能引用谁,用 `ast` 读 import 来检查;业务函数不许引用 `llm`,因为确定性要靠结构拦,不靠提示词。

[Day 439 · 排期和成本估算](/blog/agent-zero/day-439-schedule-cost/):日历里「用到的不能排在被用的前面」,第一次跑抓到两处;落后时按 PRD 指标决定砍哪几天;先量 token 比例(中文 1.6 字符/token),再估每类工单的成本,拿 M13 的红线对账,估算偏差 0.5–2 倍,不回头凑实测数。

## 准备环境

今天的代码全部在 `agent-zero-lab/part08/` 里,在仓库根目录运行。确认几样东西还在:

```bash
cd ~/agent-zero-lab
ls part08/arch.py part08/check_arch.py part08/schedule.py part08/cost.py part08/docs/PRD.md
uv run python -m part08.make_skeleton > /dev/null
uv run pytest part08/test_schedule.py -q
```

<div class="line-notes">

- `cd ~/agent-zero-lab` 练习仓库根目录,下面所有命令都在这里跑。
- `ls part08/arch.py` 应该看到 Day 438 的 `arch.py`、`check_arch.py`,Day 439 的 `schedule.py`、`cost.py`,Day 437 的 `docs/PRD.md`。缺哪个就回那一天补,`ls` 缺的文件会直接报 `No such file or directory`。
- `uv run python -m part08.make_skeleton > /dev/null` 重新生成 Day 438 那份只有空壳的目录骨架(`part08/arch_skeleton/`),今天的测试要拿它当样本。`> /dev/null` 把它打印的目录树丢掉。
- `uv run pytest part08/test_schedule.py -q` 跑 Day 439 的三个排期测试,确认 `arch.py` 里那两处修改(`llm.py` 改成 448、补了 `_ticket_text` 方块)还在。

</div>

```text
...                                                                      [100%]
3 passed in 0.02s
```

## 默写一:Day 434 的滑动窗口限流

先合上文章,凭记忆写出 `too_many(ip)`:每个 IP 一个队列,记最近每次请求的时间;新请求来了,先扔掉一分钟以前的记录,剩下的还有 10 条就拒绝,**被拒绝的不记进去**。写好以后再对照:

```python
# agent-zero-lab/part08/review63_ratelimit.py
"""默写一:Day 434 的滑动窗口限流。一个文件,不依赖 FastAPI,方便单独测。"""
import time
from collections import defaultdict, deque

RATE_PER_MINUTE = 10
hits: dict[str, deque[float]] = defaultdict(deque)


def too_many(ip: str) -> bool:
    now = time.monotonic()
    q = hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= RATE_PER_MINUTE:
        return True
    q.append(now)
    return False
```

<div class="line-notes">

- `import time` 用它的 `monotonic()`,单调时钟,只往前走,不受系统改时间影响。
- `from collections import defaultdict, deque` `deque` 是双端队列,从队头扔旧记录用 `popleft()` 很快;`defaultdict` 第一次见到某个 IP 时自动建一个空队列。
- `RATE_PER_MINUTE = 10` 原来在 `config.py` 里,今天为了让这个文件自己能测,写成模块常量。
- `hits: dict[str, deque[float]] = defaultdict(deque)` IP → 它最近每次请求的时间。存在进程内存里,重启就清零,这是 Day 434 写进 README 的已知限制。
- `def too_many(ip: str) -> bool:` 返回 `True` 就是该拒绝这次请求(调用方要回 429)。
- `now = time.monotonic()` 取当前时间一次,下面比较都用它。
- `q = hits[ip]` 取这个 IP 的队列,没有就建。比如 `hits["1.1.1.1"]` 第一次是空的 `deque([])`。
- `while q and now - q[0] > 60:` 队头是最早的一次。`q and` 先确认队列非空,再比较。它距离现在超过 60 秒就扔。
- `q.popleft()` 扔掉队头,然后回到 `while` 再看新队头。
- `if len(q) >= RATE_PER_MINUTE:` 窗口里已经有 10 条了。
- `return True` 拒绝,而且**不执行下面的 `append`**,被拒的请求不记进去,刷脚本不会把自己永远锁死,正常用户等一分钟就能恢复。
- `q.append(now)` 没超就记下这一次。
- `return False` 放行。

</div>

对着它写测试,而且要**不真的等一分钟**。办法是 [Day 74](/blog/agent-zero/day-074-pytest-4/) 的 monkeypatch:把 `time.monotonic` 换成一个我能拨的假时钟。

```python
# agent-zero-lab/part08/test_review63_ratelimit.py
import time

import pytest

from part08 import review63_ratelimit as rl


@pytest.fixture(autouse=True)
def clean():
    rl.hits.clear()


def fake_clock(monkeypatch: pytest.MonkeyPatch, start: float = 1000.0):
    now = [start]
    monkeypatch.setattr(time, "monotonic", lambda: now[0])
    return now


def test_first_ten_pass_eleventh_blocked(monkeypatch):
    fake_clock(monkeypatch)
    assert [rl.too_many("1.1.1.1") for _ in range(11)] == [False] * 10 + [True]


def test_blocked_requests_are_not_recorded(monkeypatch):
    now = fake_clock(monkeypatch)
    for _ in range(10):
        rl.too_many("1.1.1.1")
    for _ in range(50):  # 刷的脚本一直被拒
        assert rl.too_many("1.1.1.1") is True
    assert len(rl.hits["1.1.1.1"]) == 10  # 被拒的不记,队列没有变长
    now[0] += 61  # 一分钟后,最早的十条都过期
    assert rl.too_many("1.1.1.1") is False  # 正常用户恢复


def test_ips_are_independent(monkeypatch):
    fake_clock(monkeypatch)
    for _ in range(10):
        rl.too_many("1.1.1.1")
    assert rl.too_many("2.2.2.2") is False


def test_window_slides(monkeypatch):
    now = fake_clock(monkeypatch)
    for _ in range(5):
        rl.too_many("1.1.1.1")
    now[0] += 30
    for _ in range(5):
        rl.too_many("1.1.1.1")
    assert rl.too_many("1.1.1.1") is True  # 10 条都在窗口里
    now[0] += 31  # 前 5 条过期(距今 61 秒),后 5 条还在
    assert [rl.too_many("1.1.1.1") for _ in range(6)] == [False] * 5 + [True]
```

<div class="line-notes">

- `from part08 import review63_ratelimit as rl` 给模块起个短名 `rl`,下面写 `rl.too_many(...)`。
- `@pytest.fixture(autouse=True)` 每个测试开始前自动执行下面这个函数,不用在测试里显式引用它。
- `rl.hits.clear()` 清空全局字典。`hits` 是模块级的,不清的话前一个测试留下的记录会污染后一个。
- `def fake_clock(monkeypatch: pytest.MonkeyPatch, start: float = 1000.0):` 造一个假时钟,返回一个可以拨的「当前时间」。
- `now = [start]` 用一个只有一个元素的列表装时间,原因是下面的 lambda 要读它的最新值。如果直接写 `now = start`,lambda 里读到的是定义时的那个数,以后改不了。
- `monkeypatch.setattr(time, "monotonic", lambda: now[0])` 把 `time.monotonic` 换成「返回 `now[0]`」的函数。测试结束 pytest 自动还原。
- `assert [rl.too_many("1.1.1.1") for _ in range(11)] == [False] * 10 + [True]` 连发 11 次,前 10 次放行,第 11 次拒绝。`[False] * 10` 是十个 `False` 的列表。
- `for _ in range(50):  # 刷的脚本一直被拒` 再刷 50 次,每次都被拒。
- `assert len(rl.hits["1.1.1.1"]) == 10  # 被拒的不记,队列没有变长` 这条断言守住「被拒的不记」这个设计。
- `now[0] += 61  # 一分钟后,最早的十条都过期` 拨快时钟 61 秒。
- `assert rl.too_many("1.1.1.1") is False  # 正常用户恢复` 过期以后又放行了。
- `def test_ips_are_independent(monkeypatch):` 一个 IP 被限了,另一个不受影响。
- `def test_window_slides(monkeypatch):` 窗口是「滑动」的,不是「每分钟整点清零」:前 5 条在 0 秒,后 5 条在 30 秒,到 61 秒时前 5 条过期、后 5 条还在,所以还能再放行 5 个。
- `assert [rl.too_many("1.1.1.1") for _ in range(6)] == [False] * 5 + [True]` 再发 6 次,5 次放行,第 6 次拒绝。

</div>

```bash
uv run pytest part08/test_review63_ratelimit.py -q
```

```text
....                                                                     [100%]
4 passed in 0.02s
```

四个绿点。但**测试能抓错吗**,要弄坏一次才知道。把 `if` 和 `append` 的顺序反过来(先记再判断,是最容易写出来的错版本),也就是把函数最后几行换成:

```python
    q.append(now)
    return len(q) > RATE_PER_MINUTE
```

```bash
uv run pytest part08/test_review63_ratelimit.py -q
```

```text
>       assert len(rl.hits["1.1.1.1"]) == 10  # 被拒的不记,队列没有变长
E       assert 60 == 10
E        +  where 60 = len(deque([1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, ...]))
>       assert [rl.too_many("1.1.1.1") for _ in range(6)] == [False] * 5 + [True]
E       assert [False, False...e, True, True] == [False, False..., False, True]
E         
E         At index 4 diff: True != False
E         Use -v to get more diff
FAILED part08/test_review63_ratelimit.py::test_blocked_requests_are_not_recorded
FAILED part08/test_review63_ratelimit.py::test_window_slides - assert [False,...
2 failed, 2 passed in 0.05s
```

两个测试红了:被拒的也记进去了,队列从 10 涨到 60;滑动窗口那条里,前一次被拒的请求占着位置,该恢复的时候没恢复。另外两个测试没红,因为表面行为(前 10 个放行、第 11 个拒绝、IP 互不影响)在错版本里也成立。这就是为什么「被拒的不记」要单独写一条测试:它只在「持续被刷」的情景里才显现,正常用户永远碰不到。改回原版,又是 `4 passed`。

## 默写二:Day 438 的相对 import 换算

第二段要默写的是 `check_arch.py` 的核心:`from ..llm import X` 这样一行,怎么知道它引用的是 `supportpilot.llm`。先合上文章写 `resolve(current, level, module)`:当前模块名去掉最后 `level` 段,再接上 `module`。再写 `imported_modules`:用 `ast.walk` 走遍语法树,找出每一条 import。

```python
# agent-zero-lab/part08/review63_imports.py
"""默写二:Day 438 的相对 import 换算,和用 ast 读出一个文件 import 了谁。"""
import ast


def resolve(current: str, level: int, module: str | None) -> str:
    """把 from ..llm import X 里的相对路径,换算成 supportpilot.llm。"""
    if level == 0:
        return module or ""
    base = current.split(".")[:-level]
    return ".".join(base + ([module] if module else []))


def imported_modules(tree: ast.AST, current: str) -> list[str]:
    found: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            base = resolve(current, node.level, node.module)
            if base == "supportpilot" or (node.level and not node.module):
                found += [f"{base}.{a.name}" for a in node.names]
            else:
                found.append(base)
        elif isinstance(node, ast.Import):
            found += [a.name for a in node.names]
    return [m for m in found if m.startswith("supportpilot")]
```

<div class="line-notes">

- `import ast` Python 自带的「把源码读成语法树」模块,`ast.parse` 只读不运行。
- `def resolve(current: str, level: int, module: str | None) -> str:` `current` 是当前模块的完整名,比如 `supportpilot.kb.ingest`;`level` 是 `from` 后面有几个点;`module` 是点后面的名字,`from . import x` 时是 `None`。
- `if level == 0:` 没有点,是绝对 import(`from pathlib import Path`),原样返回。
- `return module or ""` `module` 是 `None` 时返回空字符串,保证类型是 `str`。
- `base = current.split(".")[:-level]` 把 `supportpilot.kb.ingest` 按点切开得到 `['supportpilot', 'kb', 'ingest']`,去掉最后 `level` 段。一个点(`.`)是「同一个包」,去掉文件自己;两个点(`..`)再往上一层。所以 `level=2` 得到 `['supportpilot']`。
- `return ".".join(base + ([module] if module else []))` 接上 `module`:`from ..llm import X` 得到 `supportpilot.llm`;没有 `module`(`from .. import db`)就只有包本身。
- `def imported_modules(tree: ast.AST, current: str) -> list[str]:` 一个文件的语法树 → 它引用了哪些 `supportpilot` 内部的模块。
- `for node in ast.walk(tree):` `ast.walk` 会走遍树上每个节点,包括函数里面的 import。
- `if isinstance(node, ast.ImportFrom):` 处理 `from ... import ...` 这一种。
- `base = resolve(current, node.level, node.module)` 算出它指向的位置。
- `if base == "supportpilot" or (node.level and not node.module):` 特殊情况:`from .. import db` 里 `db` 是个模块,不是 `supportpilot` 里的某个名字。这时真正引用的是 `supportpilot.db`,要把 `import` 后面的名字接上。`node.level and not node.module` 意思是「有点而且点后面没有模块名」。
- `found += [f"{base}.{a.name}" for a in node.names]` 每个名字各接一个。
- `else:` 普通情况(`from ..llm import LLMClient`),引用的就是 `base` 这个模块。
- `found.append(base)` 把它收进结果。
- `elif isinstance(node, ast.Import):` 处理 `import supportpilot.config` 这种写法。
- `return [m for m in found if m.startswith("supportpilot")]` 只留项目内部的,`json`、`pathlib` 这类标准库不检查。

</div>

测试里有两部分:五个 `resolve` 的具体例子,和一个「默写的版本要和 Day 438 的原版对着每个骨架文件比」的总检查。

```python
# agent-zero-lab/part08/test_review63_imports.py
import ast
from pathlib import Path

import pytest

from part08 import check_arch, review63_imports as mine

CASES = [
    ("supportpilot.kb.ingest", 2, "llm", "supportpilot.llm"),  # from ..llm import X
    ("supportpilot.kb.ingest", 1, "chunker", "supportpilot.kb.chunker"),  # from .chunker import X
    ("supportpilot.kb.ingest", 1, None, "supportpilot.kb"),  # from . import chunker
    ("supportpilot.api.app", 2, "agent.graph", "supportpilot.agent.graph"),
    ("supportpilot.config", 0, "pathlib", "pathlib"),  # 绝对 import,原样返回
]


@pytest.mark.parametrize(("current", "level", "module", "expected"), CASES)
def test_resolve(current, level, module, expected):
    assert mine.resolve(current, level, module) == expected


def test_matches_day438_on_every_skeleton_file():
    root = Path("part08/arch_skeleton/supportpilot")
    files = [f for f in (root / "src").rglob("*.py") if f.name != "__init__.py"]
    assert len(files) >= 20
    for f in files:
        current = check_arch.module_name(root, f)
        tree = ast.parse(f.read_text(encoding="utf-8"))
        assert mine.imported_modules(tree, current) == check_arch.imported_modules(tree, current), f
```

<div class="line-notes">

- `from part08 import check_arch, review63_imports as mine` 同时导入原版 `check_arch` 和你默写的版本,后者起别名 `mine`。
- `CASES = [` 五个例子,每个是 `(当前模块, 点数, 点后的模块名, 期望结果)`。
- `("supportpilot.kb.ingest", 2, "llm", "supportpilot.llm"),  # from ..llm import X` 两个点,往上退两层到 `supportpilot`,再接 `llm`。
- `("supportpilot.kb.ingest", 1, None, "supportpilot.kb"),  # from . import chunker` 一个点、没有模块名:只退一层,得到 `supportpilot.kb`。
- `("supportpilot.config", 0, "pathlib", "pathlib"),  # 绝对 import,原样返回` 零个点就是绝对 import。
- `@pytest.mark.parametrize(("current", "level", "module", "expected"), CASES)` 同一个测试函数,用五组参数各跑一次,报告里是五个测试。
- `root = Path("part08/arch_skeleton/supportpilot")` Day 438 生成的骨架,里面每个文件都有设计好的 import 行。
- `assert len(files) >= 20` 先确认真的找到了文件,免得目录不对时「空循环」白白通过。
- `current = check_arch.module_name(root, f)` 用原版的函数把文件路径换算成模块名。
- `assert mine.imported_modules(tree, current) == check_arch.imported_modules(tree, current), f` 对每个文件,你的结果必须和原版一致;最后的 `, f` 让断言失败时把文件名也打出来。

</div>

```bash
uv run pytest part08/test_review63_imports.py -q
```

```text
......                                                                   [100%]
6 passed in 0.03s
```

再手动试一个会让人犯糊涂的例子,`from .. import db` 和 `import supportpilot.config` 混在一起:

```bash
uv run python -c "
import ast
from part08.review63_imports import imported_modules
src = 'from ..llm import LLMClient\nfrom . import business\nfrom .. import db\nimport supportpilot.config\nimport json'
print(imported_modules(ast.parse(src), 'supportpilot.tools.registry'))
"
```

```text
['supportpilot.llm', 'supportpilot.tools.business', 'supportpilot.db', 'supportpilot.config']
```

`json` 被滤掉了,其他四条都换算成了绝对的模块名。`from . import business` 在 `tools/registry.py` 里,一个点是同一个包 `supportpilot.tools`,所以得到 `supportpilot.tools.business`。

## 本周小项目:四份文件互相对账

默写过了,最后做今天的主菜。前面每一天都有一个自己的检查:需求表、PRD、方块表、排期各管各的。但它们之间有五条「该对得上」的关系,没人看管:

- PRD 里有 M1 到 M16 十六条指标;Day 439 的排期里有一张「指标在哪几天落地」的表。**两边的指标编号是不是同一批?**
- 一条指标落地的那几天,**是不是真的在写代码的日子**(不是复习日)?
- 指标落地的那几天里,**方块表里是不是至少有一个方块**在这几天建?如果没有,说明这条指标没有对应的文件可以测。
- PRD 里 M13 写的 ¥0.05,Day 439 估出来的数,**是不是真的在红线以内**?
- PRD 风险表「在哪里验证」里写的 Day N,**是不是复习日**?

这些都是「跨文件」的关系。人读的时候,眼睛一次只看一份,很容易漏。写成脚本,五个检查各管一条。

```python
# agent-zero-lab/part08/review63.py(接着上一段,追加在文件里)
# agent-zero-lab/part08/review63.py
"""第 63 周小项目:PRD、方块表、排期、成本估算,四份文件互相对账。不调模型,不花钱。"""
import re
import sys
from pathlib import Path

from part08 import arch, cost, schedule

PRD = Path("part08/docs/PRD.md")
NON_CODING_DAYS = {440} | schedule.REVIEW_DAYS  # 复习日不写新功能


def prd_rows(text: str, prefix: str) -> list[list[str]]:
    """取出 PRD 里以 M、K 这类编号开头的表格行,每行拆成格子。"""
    rows = []
    for line in text.splitlines():
        if re.match(rf"\| {prefix}\d+ \|", line):
            rows.append([c.strip() for c in line.strip().strip("|").split("|")])
    return rows


def check_metrics_have_days(prd: str) -> list[str]:
    """PRD 的每个指标,在排期里都要有落地的日子;反过来排期里的指标,PRD 里也要有。"""
    in_prd = {r[0] for r in prd_rows(prd, "M")}
    in_plan = set(schedule.METRIC_DAYS)
    return [f"PRD 有 {m},排期没有安排它在哪天落地" for m in sorted(in_prd - in_plan)] + [
        f"排期里有 {m},PRD 里没有这条指标" for m in sorted(in_plan - in_prd)
    ]


def check_landing_days_are_working_days() -> list[str]:
    problems = []
    for m, ranges in schedule.METRIC_DAYS.items():
        bad = sorted(schedule.expand(ranges) & NON_CODING_DAYS)
        if bad:
            problems.append(f"{m} 落在复习日 {bad} 上")
    return problems


def check_landing_days_have_boxes() -> list[str]:
    """指标落地那几天里,方块表至少有一天建了东西,否则指标没有对应的文件可测。"""
    built = {b.day for b in arch.BOXES}
    return [
        f"{m} 落地的 {sorted(schedule.expand(r))} 里,方块表一个方块也没有"
        for m, r in schedule.METRIC_DAYS.items()
        if not schedule.expand(r) & built
    ]
```

<div class="line-notes">

- `import re` 用正则从 PRD 的表格行里取格子。
- `import sys` 最后用退出码告诉外面「通过还是不通过」。
- `from part08 import arch, cost, schedule` 本周四份东西里的三份:方块表(Day 438)、排期(Day 439)、成本(Day 439)。PRD 是文本文件,下面直接读。
- `PRD = Path("part08/docs/PRD.md")` Day 437 写的 PRD,Day 441 会把它复制进 SupportPilot 仓库。
- `NON_CODING_DAYS = {440} | schedule.REVIEW_DAYS  # 复习日不写新功能` `|` 是集合并集。`schedule.REVIEW_DAYS` 从 447 开始,不含 440(那在第 63 周),所以要手动加上 440。
- `def prd_rows(text: str, prefix: str) -> list[list[str]]:` 从 PRD 文本里取出以某个字母开头的编号行(`M` 是指标,`K` 是风险),拆成格子。
- `if re.match(rf"\| {prefix}\d+ \|", line):` 匹配 `| M13 |` 这种开头。`rf"..."` 是「原始字符串加 f-string」,原始字符串让 `\|`、`\d` 里的反斜杠原样交给正则。
- `rows.append([c.strip() for c in line.strip().strip("|").split("|")])` 去掉行首尾的 `|`,按 `|` 切开,每个格子去掉空白。`| M13 | 单张工单平均成本 | ≤ ¥0.05 | ... |` 得到 `['M13', '单张工单平均成本', '≤ ¥0.05', ...]`。
- `in_prd = {r[0] for r in prd_rows(prd, "M")}` PRD 里所有指标编号的集合。
- `in_plan = set(schedule.METRIC_DAYS)` 排期里所有指标编号。`set(字典)` 取的是字典的键。
- `[f"PRD 有 {m},排期没有安排它在哪天落地" for m in sorted(in_prd - in_plan)]` 集合差:PRD 有、排期没有的。
- `f"排期里有 {m},PRD 里没有这条指标" for m in sorted(in_plan - in_prd)` 反过来也查,两个方向都要,不然 PRD 删了一条指标、排期里还留着,没人发现。
- `bad = sorted(schedule.expand(ranges) & NON_CODING_DAYS)` 指标的落地日集合和复习日集合取交集,非空就有问题。
- `built = {b.day for b in arch.BOXES}` 方块表里「有方块建出来」的所有日子。
- `if not schedule.expand(r) & built` 这条指标的落地日和「有方块的日子」没有交集,说明那几天里什么文件都没建。

</div>

后半段:成本对账、风险验证日、汇总、入口:

```python
# agent-zero-lab/part08/review63.py(接着上一段,追加在文件里)
def check_cost_under_redline(prd: str) -> list[str]:
    """PRD 里 M13 的红线,和 cost.py 估出来的数对账。"""
    row = next(r for r in prd_rows(prd, "M") if r[0] == "M13")
    redline = float(re.search(r"¥\s*([\d.]+)", row[2]).group(1))  # type: ignore[union-attr]
    est = cost.avg_ticket() + cost.price(cost.JUDGE.in_tokens(), cost.JUDGE.out_tokens)
    return [] if est <= redline else [f"M13 估算 ¥{est:.4f} 超过 PRD 红线 ¥{redline}"]


def check_risk_days_exist(prd: str) -> list[str]:
    """风险表「在哪里验证」里写的 Day N,不能落在复习日上。"""
    problems = []
    for r in prd_rows(prd, "K"):
        for n in re.findall(r"Day (\d+)", r[3]):
            if int(n) in NON_CODING_DAYS:
                problems.append(f"{r[0]} 说在 Day {n} 验证,那天是复习日")
    return problems


def run_all(prd: str) -> dict[str, list[str]]:
    return {
        "指标都有落地日": check_metrics_have_days(prd),
        "落地日不在复习日": check_landing_days_are_working_days(),
        "落地日有方块": check_landing_days_have_boxes(),
        "成本不超红线": check_cost_under_redline(prd),
        "风险的验证日": check_risk_days_exist(prd),
    }


if __name__ == "__main__":
    results = run_all(PRD.read_text(encoding="utf-8"))
    for name, problems in results.items():
        print(f"{name}:", "通过" if not problems else f"{len(problems)} 个问题")
        for p in problems:
            print("  -", p)
    sys.exit(1 if any(results.values()) else 0)
```

<div class="line-notes">

- `def check_cost_under_redline(prd: str) -> list[str]:` PRD 里的红线和 `cost.py` 的估算对账。
- `row = next(r for r in prd_rows(prd, "M") if r[0] == "M13")` 从指标行里找 `M13` 那一行。`next(生成器)` 取第一个匹配的。
- `redline = float(re.search(r"¥\s*([\d.]+)", row[2]).group(1))  # type: ignore[union-attr]` 从「≤ ¥0.05」这一格里取出数字 `0.05`。`re.search` 找不到时返回 `None`,类型检查器因此警告 `.group` 可能出错;这里 M13 那一格我们知道有金额,所以用 `# type: ignore` 告诉它别管。
- `est = cost.avg_ticket() + cost.price(cost.JUDGE.in_tokens(), cost.JUDGE.out_tokens)` 和 Day 439 的 M13 口径一样:工作流平均成本加一次评审。
- `return [] if est <= redline else [f"M13 估算 ¥{est:.4f} 超过 PRD 红线 ¥{redline}"]` 没超返回空列表。
- `for n in re.findall(r"Day (\d+)", r[3]):` `r[3]` 是风险表的第四格「在哪里验证」,比如 `Day 481、Day 483,M12`。`findall` 把所有 `Day 数字` 里的数字都找出来。
- `if int(n) in NON_CODING_DAYS:` 验证日不能是复习日。
- `def run_all(prd: str) -> dict[str, list[str]]:` 五个检查的名字和结果收进一个字典,方便统一打印,以后加第六个检查只需要加一行。
- `sys.exit(1 if any(results.values()) else 0)` 只要有一个检查有问题,就以退出码 1 结束,以后能挂进 CI 或 pre-commit,和 Day 438 的 `check_arch.py` 一样。

</div>

```bash
uv run python -m part08.review63
```

```text
指标都有落地日: 通过
落地日不在复习日: 通过
落地日有方块: 通过
成本不超红线: 通过
风险的验证日: 通过
```

五个全过。**我事先预期它会抓到几处不一致**:五份文件是六天里陆续写的,我以为总有对不上的。结果一次过了,这是个有用的信息:它说明 Day 437 到 439 三天里,我对指标和日子的记录是前后一致的。但「一次过」也有可能是「检查太松」,所以和前几天一样,要故意弄坏。

### 故意弄坏它

下面这个脚本在内存里做五处改动,每处对应一个检查:PRD 多一条排期不知道的指标 M17;把 M3 的落地日挪到复习日 454;把 M16 挪到 Day 445(那天方块表里没有任何方块);把 PRD 里 M13 的红线从 ¥0.05 收紧到 ¥0.01;把 K4 的验证日改成 Day 447。

```python
# agent-zero-lab/part08/review63_break.py
"""故意弄坏五处,看 review63 的五个检查各抓到哪一处。"""
from pathlib import Path

from part08 import review63, schedule

prd = Path("part08/docs/PRD.md").read_text(encoding="utf-8")
original = dict(schedule.METRIC_DAYS)

# 1. PRD 里多一条排期不知道的指标
prd = prd.replace("| M16 |", "| M17 | 新指标 | ≥ 1% | 随便 | dev | G1 |\n| M16 |")
# 2. M3 的落地日改到复习日 454
schedule.METRIC_DAYS["M3"] = [(454, 454)]
# 3. M16 的落地日改到 Day 445(那天方块表里一个方块也没有)
schedule.METRIC_DAYS["M16"] = [(445, 445)]
# 4. 把 PRD 里 M13 的红线从 ¥0.05 收紧到 ¥0.01
prd = prd.replace("≤ ¥0.05", "≤ ¥0.01")
# 5. K4 的验证日改成 Day 447(复习日)
prd = prd.replace("Day 439 成本算式", "Day 447 成本算式")

for name, problems in review63.run_all(prd).items():
    print(f"{name}:", "通过" if not problems else f"{len(problems)} 个问题")
    for p in problems:
        print("  -", p)

schedule.METRIC_DAYS.update(original)
schedule.METRIC_DAYS.pop("M17", None)
print("还原后:", [n for n, p in review63.run_all(Path("part08/docs/PRD.md").read_text(encoding="utf-8")).items() if p] or "全部通过")
```

<div class="line-notes">

- `prd = Path("part08/docs/PRD.md").read_text(encoding="utf-8")` 读原文,但只在内存里改,不动文件。
- `original = dict(schedule.METRIC_DAYS)` 先复制一份排期的指标表,最后要还原。`dict(...)` 做的是浅拷贝,够用,因为下面是整体替换某个键的值,不是改值里面的列表。
- `prd = prd.replace("| M16 |", "| M17 | 新指标 | ≥ 1% | 随便 | dev | G1 |\n| M16 |")` 在 M16 前面插一整行 M17,格式和别的指标行一样。
- `schedule.METRIC_DAYS["M3"] = [(454, 454)]` 直接改模块里的字典,`review63` 里 `schedule.METRIC_DAYS` 读到的就是改后的。这是 `from part08 import schedule` 而不是 `from part08.schedule import METRIC_DAYS` 的好处,后者拿到的是同一个字典也行,但整体换掉名字就拿不到了,按模块访问最稳。
- `prd = prd.replace("≤ ¥0.05", "≤ ¥0.01")` 收紧红线。PRD 里 `≤ ¥0.05` 只出现在 M13 那一行,所以不会改到别处。
- `prd = prd.replace("Day 439 成本算式", "Day 447 成本算式")` 只改 K4 那一格里的天数。
- `for name, problems in review63.run_all(prd).items():` 把改过的 PRD 文本交给五个检查。
- `schedule.METRIC_DAYS.update(original)` 还原:把原来的值写回去。
- `schedule.METRIC_DAYS.pop("M17", None)` 这次其实没有给 `METRIC_DAYS` 加过 M17(它只加在 PRD 文本里),所以 `pop` 的第二个参数 `None` 是默认值:键不存在时不报错。多写这一行是防以后改成往字典里也加 M17 时忘了还原。
- `print("还原后:"` 还原后重新对着原来的 PRD 跑一遍,确认没有残留。

</div>

```bash
uv run python -m part08.review63_break
```

```text
指标都有落地日: 1 个问题
  - PRD 有 M17,排期没有安排它在哪天落地
落地日不在复习日: 1 个问题
  - M3 落在复习日 [454] 上
落地日有方块: 2 个问题
  - M3 落地的 [454] 里,方块表一个方块也没有
  - M16 落地的 [445] 里,方块表一个方块也没有
成本不超红线: 1 个问题
  - M13 估算 ¥0.0187 超过 PRD 红线 ¥0.01
风险的验证日: 1 个问题
  - K4 说在 Day 447 验证,那天是复习日
还原后: 全部通过
```

五处改动,五类问题都抓到了,而且 M3 同时触发了两个检查(「落在复习日」和「那天没有方块」),因为 454 既是复习日也没有方块,两个问题都是真的。

最后同样要说它抓不到什么。它能抓的是**两份文件对不上**。它抓不到「两份文件都错得一致」:如果 PRD 和排期里 M7 都写成了 Day 453 落地,可其实 Day 453 根本没讲到闸门,它也过。这个只能靠人读。

### 零件和大代码的对照

| 检查 | 来自哪一天的什么 |
| --- | --- |
| `prd_rows` 取 PRD 表格行 | Day 437 的 `prd_check.py` 解析 PRD 的做法 |
| `check_metrics_have_days` | Day 437 的「指标由谁来测」表,变成 Day 439 的 `METRIC_DAYS` |
| `check_landing_days_are_working_days` | Day 439 的 `REVIEW_DAYS` |
| `check_landing_days_have_boxes` | Day 438 的方块表 `BOXES` |
| `check_cost_under_redline` | Day 439 的 `cost.py` 和 Day 437 的 M13 |
| `run_all` 返回字典、`sys.exit` | Day 438 的 `check_arch.py` 入口写法 |

## 本周错题与坑清单

这些都是这一周六天里真实出现过的报错或现象,按我觉得最容易再犯的顺序排:

1. **直连 uvicorn 时伪造 `X-Forwarded-For`。** 每次换一个假 IP,限流形同虚设;经过 Caddy 才不行。应用端口不能对公网开放(Day 434)。
2. **容器里没配 `--forwarded-allow-ips`。** 所有用户被当成 Caddy 的内网 IP,共用一个限流桶,第 11 个访客就被拒(Day 434,这条没在本机复现,是按文档推出来的)。
3. **兜底 `except` 里又调了会出错的函数。** 写审计抛了同样的错,流无声断开,连 error 事件都没发(Day 434)。
4. **健康检查只查库。** 审计日志写不进时它一直返回 200(Day 434)。
5. **工具报错原样交给模型。** 模型把 `OperationalError` 念给客户听(Day 434)。
6. **判卷函数只查关键词。** 「不能全额退款」里也有「全额退款」,被判对(Day 435)。
7. **凭印象猜关键词出现次数。** 我猜 3 次,代码数出来 2 次(Day 435)。
8. **问意见,不问过去。** 同一个模拟客户,五个问题问出 0 条事实,换成「最近一次」问出 10 条;而且漏了「企业版不适用」那一条(Day 436)。
9. **听到了但没落到表里。** 删掉 R6 以后 F08 就没人用了,事实和需求靠编号挂钩才能被脚本发现(Day 436)。
10. **拿脚本检查当内容评审。** PRD 检查通过,只说明格式和对账没问题,指标合不合理它不知道(Day 437)。
11. **层定错了以为是代码错。** `db` 引用 `config` 被报「同层引用」,其实是层表把它们放同一层了(Day 438)。
12. **只看每一行,不看行与行之间。** `llm.py` 排 Day 457、`ingest.py` 排 Day 449,每一行单独看都合理(Day 439)。
13. **回头改参数去凑实测数。** 估算和实测永远对得上,也永远没有信息量(Day 439)。
14. **「一次过」就以为检查没问题。** 今天 `review63.py` 第一次就五项全过,所以才要故意弄坏五处,看它到底抓不抓得到。

## 动手练习

### 练习 1:没有 monkeypatch 的限流测试怎么写

默写一的测试用 monkeypatch 把时钟换成假的。如果不用,直接测 `too_many`,要怎么证明「一分钟后恢复」?写出来,算算要花多久,说说为什么我选 monkeypatch。

<details><summary>参考答案</summary>

不用的话,只能真的等:

```python
# 不推荐:真的等一分钟
import time
for _ in range(10):
    rl.too_many("1.1.1.1")
assert rl.too_many("1.1.1.1") is True
time.sleep(61)
assert rl.too_many("1.1.1.1") is False
```

这段是我按逻辑写的对比,没有实跑它的 61 秒,但耗时不用跑也知道:一条测试要 61 秒,四条类似的加起来四分钟,每次提交前的测试集都会因此慢下来,慢到你不想跑,就等于没有测试。时间相关的测试还天生不稳:机器忙的时候,「刚好 60.0 秒」可能差几毫秒就过不了线。

monkeypatch 把「时间」变成一个我能手拨的变量:`now[0] += 61` 一行就是「过了 61 秒」,四条测试合起来 0.02 秒,而且结果每次一样。**凡是依赖时钟、随机数、网络的逻辑,先想办法把这个依赖换成可控的,再写测试。** Day 74 讲假对象的时候说过同样的道理,今天换成了时间。

</details>

### 练习 2:去掉 `from .. import db` 的特殊分支

`imported_modules` 里有一个 `if base == "supportpilot" or (node.level and not node.module):` 的特殊分支。写一个不带这个分支的简化版,拿 `from .. import db` 试,看结果变成什么;再想想对 Day 438 的依赖方向检查会有什么后果。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part08/ex2_nomodule.py
"""练习 2:去掉「from .. import db」的特殊分支,看结果变成什么。"""
import ast

from part08.review63_imports import imported_modules, resolve

SRC = "from .. import db\nfrom ..llm import LLMClient"
tree = ast.parse(SRC)
print("原版  :", imported_modules(tree, "supportpilot.tools.sql_tool"))


def imported_modules_naive(tree: ast.AST, current: str) -> list[str]:
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            found.append(resolve(current, node.level, node.module))  # 不管 import 后面的名字
    return [m for m in found if m.startswith("supportpilot")]


print("去特殊:", imported_modules_naive(tree, "supportpilot.tools.sql_tool"))
```

<div class="line-notes">

- `from part08.review63_imports import imported_modules, resolve` 原版和换算函数,简化版要复用 `resolve`。
- `SRC = "from .. import db\nfrom ..llm import LLMClient"` 两条 import:一条特殊(`db` 是模块),一条普通。
- `print("原版  :", imported_modules(tree, "supportpilot.tools.sql_tool"))` 在 `tools/sql_tool.py` 里,两个点是退到 `supportpilot`。
- `def imported_modules_naive(tree: ast.AST, current: str) -> list[str]:` 去掉特殊分支的简化版。
- `found.append(resolve(current, node.level, node.module))  # 不管 import 后面的名字` 只看「点和模块名」,不看 `import` 后面接的名字。
- `return [m for m in found if m.startswith("supportpilot")]` 同样只保留项目内部的。

</div>

```text
原版  : ['supportpilot.db', 'supportpilot.llm']
去特殊: ['supportpilot', 'supportpilot.llm']
```

简化版对 `from .. import db` 返回的是 `supportpilot`(包本身),不是 `supportpilot.db`。后果比看上去严重:Day 438 的 `check_layers` 里,`top("supportpilot")` 取不到第二段,返回空字符串,而 `LAYERS` 里没有空字符串这个键,`if mine in LAYERS and theirs in LAYERS` 这一条直接判假,于是**整条依赖被悄悄跳过**。一个 `tools/` 里的文件写成 `from .. import agent`(引用上层的 agent),检查不会报错。这是「漏报」,比报错更危险。这条特殊分支看着多余,其实是在保护这个检查不被一种写法绕过。

</details>

### 练习 3:给 review63 加第六个检查

成本估算那份预算表(`cost.budget()`)里,每一步的名字里都写了「Day N」或「Day N–M」。加第六个检查:这些日子的起止不能落在复习日上。先写第一版跑一遍,再给一个故意写错的预算项,看它抓不抓。

<details><summary>参考答案</summary>

第一版我是这样写的:检查 `first` 到 `last` 之间的**每一天**都不是复习日。它在原预算表上就报了:

```text
原预算表: ['「Day 480–483 迭代」跨过了复习日 [482]', '「Day 481–483 test 集」跨过了复习日 [482]']
  - 「Day 480–483 迭代」跨过了复习日 [482]
  - 「Day 481–483 test 集」跨过了复习日 [482]
  - 「Day 489 补跑评测」跨过了复习日 [489]
  - 「补跑一次」没有写 Day
```

这是**误报**。「Day 480–483 迭代」说的是「在这几天里反复迭代」,中间夹着复习日 482 是正常的,迭代不会在复习日停。我写第一版时把「一段日子」当成了「每一天都要写代码」,错了。改成只检查**起止两天**:

```python
# agent-zero-lab/part08/ex3_budget.py
"""练习 3:review63 的第六个检查:成本预算表里每一步写的 Day,都得是能写代码的日子。"""
import re

from part08 import cost, review63


def check_budget_days(items: list[tuple[str, str, float]]) -> list[str]:
    problems = []
    for step, _how, _yuan in items:
        m = re.search(r"Day (\d+)(?:–(\d+))?", step)
        if not m:
            problems.append(f"「{step}」没有写 Day")
            continue
        first = int(m.group(1))
        last = int(m.group(2) or first)
        bad = sorted({first, last} & review63.NON_CODING_DAYS)  # 只看起止两天;中间夹着复习日是正常的
        if bad:
            problems.append(f"「{step}」的起止落在复习日 {bad} 上")
    return problems


if __name__ == "__main__":
    print("原预算表:", check_budget_days(cost.budget()) or "通过")
    broken = [*cost.budget(), ("Day 489 补跑评测", "dev 100 例 × 1 次", 1.87), ("补跑一次", "x", 1.0)]
    for p in check_budget_days(broken):
        print("  -", p)
```

<div class="line-notes">

- `from part08 import cost, review63` 复用上面的 `NON_CODING_DAYS` 和 Day 439 的 `budget()`。
- `def check_budget_days(items: list[tuple[str, str, float]]) -> list[str]:` 输入是预算表(三元组列表),返回问题列表。
- `m = re.search(r"Day (\d+)(?:–(\d+))?", step)` 取出「Day 480–483」里的两个数字。`(?:...)?` 是不捕获的可选组,`–` 是全角的连接号(预算表里用的就是这个字符)。只写「Day 478」时第二个数字是 `None`。
- `if not m:` 没写 Day 的预算项也要报,不然「忘了写是哪天」会悄悄通过。
- `last = int(m.group(2) or first)` 第二个数字缺失时,起止是同一天。
- `bad = sorted({first, last} & review63.NON_CODING_DAYS)  # 只看起止两天;中间夹着复习日是正常的` 起止两个数放进集合,和复习日集合取交集。用集合是为了「Day 489」这种起止相同的情况只出现一次。
- `broken = [*cost.budget(), ("Day 489 补跑评测"` 在原预算表后面追加两个故意写错的项:一个起止落在复习日 489,一个没写 Day。

</div>

```text
原预算表: 通过
  - 「Day 489 补跑评测」的起止落在复习日 [489] 上
  - 「补跑一次」没有写 Day
```

原预算表通过,两个故意写错的都抓到了。**写检查最常见的错不是漏报,是误报**:一个常常乱叫的检查,用的人很快就学会无视它,最后真问题来了也被无视。

</details>

### 练习 4:限流能不能挡住花钱

Day 434 加了每 IP 每分钟 10 次的限流。用 Day 439 的成本数字算一算:一个 IP 刷一小时、一天,最多让你花多少钱?100 个不同 IP 同时刷呢?这说明限流和每日预算各自管什么?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part08/ex4_burn.py
"""练习 4:限流能不能挡住花钱?一个 IP 一小时、一天最多能让你花多少。"""
from part08 import cost, review63_ratelimit

per_min = review63_ratelimit.RATE_PER_MINUTE
avg = cost.avg_ticket()
refund = cost.ticket_cost("refund")[2]
print(f"限流:每个 IP 每分钟 {per_min} 次")
print(f"按平均每张 ¥{avg:.4f}:每小时 ¥{per_min * 60 * avg:.2f},一天 ¥{per_min * 60 * 24 * avg:.0f}")
print(f"按每张都是退款类 ¥{refund:.4f}:每小时 ¥{per_min * 60 * refund:.2f},一天 ¥{per_min * 60 * 24 * refund:.0f}")
print(f"100 个不同 IP 同时刷,按平均每张:每小时 ¥{100 * per_min * 60 * avg:.0f}")
```

<div class="line-notes">

- `from part08 import cost, review63_ratelimit` 一边是 Day 439 的成本,一边是今天默写的限流常量。
- `per_min = review63_ratelimit.RATE_PER_MINUTE` 每分钟最多 10 次放行。
- `avg = cost.avg_ticket()` 平均每张工单(不含评审,因为公网上刷的请求不跑评审)。
- `refund = cost.ticket_cost("refund")[2]` 最贵的一类:退款类。攻击者如果发现这类最贵,会专门发这种。
- `print(f"按平均每张` 每分钟 10 次、一小时 60 分钟、每次平均 ¥0.0137,一天再乘 24。
- `print(f"100 个不同 IP 同时刷` 100 个 IP,各自在限流以内刷,每小时的总和。

</div>

```text
限流:每个 IP 每分钟 10 次
按平均每张 ¥0.0137:每小时 ¥8.23,一天 ¥197
按每张都是退款类 ¥0.0265:每小时 ¥15.88,一天 ¥381
100 个不同 IP 同时刷,按平均每张:每小时 ¥823
```

一个 IP 在限流内一小时最多花 ¥8.23,一天 ¥197;如果每张都是退款类,一天 ¥381;100 个 IP 同时来,一小时就是 ¥823。这个数字比我预期的大得多:**限流挡的是「一个人把别人的额度用光」,挡不住总花费。** 限流只限制每个来源的速度,来源可以很多。

所以 Day 434 的服务里还有**每日预算**:一天的总花费到了上限就一律拒绝,不管谁来。这两道是互补的:限流让一个人刷不垮所有人,每日预算让总花费有天花板,第三道是模型厂商后台的月度上限,即使代码挂了也有效。Day 434 的自测第 5 题答的就是这三层。今天把成本数字代进去,你才真的看到了没有预算那一层会怎样。

这里的数字有个前提:假设刷的请求每张都是完整走一遍工作流的。实际中很多会在登录或消息长度那几道闸门就被拦下,不会真的调模型,所以这是上限不是预测。

</details>

**验收标准**:`review63_ratelimit.py` 4 个测试通过,故意把 `append` 提到判断前面会有 2 个红;`review63_imports.py` 6 个测试通过;`review63.py` 五个检查通过,`review63_break.py` 五处都被抓到;练习 3 的第六个检查在原预算表上通过、在故意写错的两项上各抓到一处;你能不看文章画出六天的主线,并解释为什么限流挡不住总花费。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 复习日 | 每六个内容日后面的一天,不写新功能:汇总、默写、做一个只用本周知识的小项目 |
| 默写 | 合上文章,凭记忆把核心代码写出来再对照。写不出来的地方,就是没有真正掌握的地方 |
| 滑动窗口 | 限流算法:记下每个来源最近每次请求的时间,每次先扔掉窗口外的旧记录。不是「每分钟整点清零」,而是「过去 60 秒内」 |
| 单调时钟 `time.monotonic()` | 只会往前走、不受系统改时间影响的时钟,用来算「过了多少秒」 |
| monkeypatch | pytest 的内置工具,临时把某个对象(比如 `time.monotonic`)换成假的,测试结束自动还原 |
| fixture `autouse=True` | 每个测试开始前自动执行的准备函数,不用在测试里显式引用 |
| 相对 import | `from ..llm import X` 这种以点开头的导入,点的个数表示往上退几层包,需要换算成绝对的模块名才知道它指向谁 |
| 误报 / 漏报 | 检查把正常的东西报成有问题(误报),或者该报的没报(漏报)。误报多了没人信,漏报多了不安全 |
| 对账 | 让两份应该一致的文件互相检查。每份单独通过,不代表它们之间对得上 |
| 浅拷贝 `dict(d)` | 复制字典本身,但里面的值如果是列表之类,仍然是同一个对象。整体替换某个键的值时够用 |

## 常见误区

**以为每份文件单独通过,整个项目就对。** 需求表对、PRD 对、方块表对、排期对,四份之间还是可能对不上:PRD 里写了一条指标,排期里没安排它落地。跨文件的关系没人看管,所以要专门写对账。

**测试只测正常情况。** 限流的「被拒的不记进去」,正常用户永远碰不到,只有在持续被刷时才出现。要为这种情形单独写一条测试,今天弄坏它时,恰好是这条测试红了。

**测试里真的 `sleep`。** 和时间有关的测试用 monkeypatch 拨假时钟,一分钟的逻辑 0.02 秒测完。真的等,既慢又不稳。

**限流等于防刷。** 今天算出来,一个 IP 一天能让你花近 200 块;100 个 IP 一小时八百多。限流管单个来源的速度,每日预算和厂商后台上限管总花费,三层缺一不可。

**把「一段日子」当成「每一天」。** 练习 3 的第一版就是这么误报的。「Day 480–483 迭代」中间夹着复习日是正常的,只检查起止。

**检查一次就过了,就觉得没问题。** 今天 `review63.py` 第一次五项全过,我反而更警惕:先故意弄坏五处,确认每个检查真的会抓,再相信它的「通过」。

**复习日当成休息日。** 它的作用是确认没有哪一块只是「看懂了」。默写写不出来的那一段,明天先补它,别往下走。

## 学习资料

### 文档与文章

- [Google SRE Book · Testing for Reliability](https://sre.google/sre-book/testing-reliability/):Day 434 推荐过。今天重读「配置测试」和「压力测试」两节,看看我们今天的限流测试属于它说的哪一类。30 分钟。
- [pytest · How to monkeypatch/mock modules and environments](https://docs.pytest.org/en/stable/how-to/monkeypatch.html):`monkeypatch.setattr` 的官方说明,默写一的测试用的就是它。15 分钟。
- [Python 文档 · ast](https://docs.python.org/3/library/ast.html):`ast.walk`、`ImportFrom` 的 `level` 和 `module` 字段在这里。读 `ImportFrom` 那一小节。10 分钟。
- [import-linter 文档](https://import-linter.readthedocs.io/):Day 438 说过,今天写的 `check_layers` 就是它的简化版。看它的 `layers` 契约怎么写,对照我们的六层。20 分钟。
- [Principles of Chaos Engineering](https://principlesofchaos.org/):Day 434 的故障演练再往前一步。一页纸。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1BH4y1g7ad&autoplay=0&high_quality=1" title="动画学Redis分布式限流算法,面试必考,令牌桶、漏桶、计数器、滑动窗口你学会了吗?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>熊老板i · 动画学Redis分布式限流算法,面试必考,令牌桶、漏桶、计数器、滑动窗口你学会了吗? · 约 10 分钟。Day 434 推荐过,默写完滑动窗口后再看一遍:这次对着你自己写的 `too_many()`,看动画里的窗口怎么滑,以及它为什么要挪到 Redis。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1t44y1a7JA&autoplay=0&high_quality=1" title="从0开始混沌工程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>RanCoder · 从0开始混沌工程 · 37 分钟。故障演练的工业版。看前 15 分钟的概念和做法,对照本周错题清单里 Day 434 的五条,想想哪几条能自动注入。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/1M3m4EwtXb4" title="GameDays: Practice Thoughtful Chaos Engineering" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GOTO Conferences · GameDays: Practice Thoughtful Chaos Engineering · Ho Ming Li · 英文。怎么组织一次 game day:先写假设、控制影响范围、事后复盘。和 Day 434「先写预期再动手」是同一条规矩。</figcaption>
</figure>

### 书籍

- Betsy Beyer 等《Site Reliability Engineering》(O'Reilly,2016,[官网免费在线读](https://sre.google/sre-book/table-of-contents/)):中文版《SRE:Google 运维解密》(电子工业出版社)。本周读「Embracing Risk」那一章,对照今天算出的「限流挡不住花钱」,想想可用性目标和成本是怎么互相换的。
- Rob Fitzpatrick《The Mom Test》(2013):Day 435、436 推荐过。复习日对着你的访谈清单读一遍它讲怎么提问的章节,检查自己有没有偷偷问了意见。我没能确认它有没有正式的中文版,只写英文原版。

### 开源项目与代码

- [seddonym/import-linter](https://github.com/seddonym/import-linter):Python 里「谁能引用谁」的正经工具。今天默写的相对 import 换算,它内部也要做。Day 441 之后可以试着用它替换 `check_layers`。

## 自测

1. 本周六天的主线是什么?每一天产出的「能被检查的文件」各是什么?

<details><summary>答案</summary>

主线是同一个动作重复:把靠感觉的事变成能被脚本检查的文件。Day 434 是演练表和 `smoke.py`(服务坏了会怎样);Day 435 是 `judge()` 判卷函数(有没有对错);Day 436 是 `requirements.py`(需求有验收办法);Day 437 是 `prd_check.py`(目标有指标);Day 438 是 `check_arch.py`(方块有文件、依赖没反);Day 439 是 `schedule.py` 和 `cost.py`(排期不矛盾、成本在红线内)。今天再加 `review63.py` 让它们互相对账。

</details>

2. `too_many()` 里为什么被拒绝的请求不能 `append`?不这样会怎样?

<details><summary>答案</summary>

不然一个持续刷的脚本,每次被拒也往队列里加记录,队列越来越长,窗口永远清不空,这个 IP 永远被锁死,正常用户一分钟后也恢复不了。今天故意把顺序反过来,`test_blocked_requests_are_not_recorded` 红了:队列从 10 涨到 60。

</details>

3. 测试里为什么用 `now = [start]` 装时间,而不是 `now = start`?

<details><summary>答案</summary>

`lambda: now[0]` 是个闭包,读的是变量 `now` 指向的对象。列表是可变的,`now[0] += 61` 改的是同一个列表,lambda 下次调用读到新值。如果 `now` 是个数字,`now += 61` 只是让名字 `now` 指向新数字,lambda 里捕获的还是旧的那个,拨不动时钟。

</details>

4. `from .. import db` 在 `imported_modules` 里为什么要特殊处理?不处理会有什么后果?

<details><summary>答案</summary>

这里 `db` 是个模块,而 `resolve` 只算出「点和模块名」,没有模块名时返回 `supportpilot`(包本身),丢掉了 `db`。特殊分支把 `import` 后面的名字接上,得到 `supportpilot.db`。不处理的话,依赖方向检查里 `top("supportpilot")` 是空字符串,不在 `LAYERS` 里,这条依赖被悄悄跳过,上层被下层反向引用就不会报错(漏报)。

</details>

5. `review63.py` 第一次就五项全过,为什么还要故意弄坏五处?弄坏之后你得到了什么信息?

<details><summary>答案</summary>

「一次过」有两种可能:文件真的一致,或者检查太松。分辨办法只有故意弄坏。弄坏之后五处都被抓到,而且 M3 同时触发了两个检查,说明五个检查各自会抓,也说明它们之间有重叠但不矛盾。这才能相信「通过」的含义。

</details>

6. **面试题**:「你的 Agent demo 做了每分钟 10 次的限流,为什么还要每日预算?」

<details><summary>答案</summary>

限流管的是单个来源的速度,来源可以很多。我拿成本估算算过:一个 IP 在限流内一小时最多让我花约 ¥8,一天约 ¥200;100 个不同 IP 同时来,一小时就是 ¥800 多。所以限流只能保证一个人刷不垮所有人,保证不了总花费。每日预算给总花费一个天花板,超了所有人一律拒绝;再加上模型厂商后台的月度上限,即使我的代码挂了也有效。三层缺一不可。我还要补一句这是上限:很多刷的请求在登录和长度检查那几道闸门就被拦了,不会真的调模型。

</details>

## 明天预告

明天是 Day 441 · 搭骨架(一):建仓库,uv、ruff、pytest、pre-commit。到这里 SupportPilot 的需求、PRD、架构表、日历和预算都有了,明天第一次写真正的仓库:用 `uv init --package` 建项目,装依赖和开发工具,把今天一直在用的 PRD 复制进 `docs/PRD.md`,按 Day 438 的方块表建好目录,再装上 pre-commit,让以后每次提交前都自动跑 ruff 和测试。建完以后用 `check_arch.py` 检查一次,看建出来的仓库和架构图是不是一个东西。
