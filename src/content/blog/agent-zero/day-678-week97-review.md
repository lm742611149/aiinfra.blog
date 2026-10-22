---
title: 'Day 678 · 第 97 周复习:作品(Day 672–677)'
description: '这一周把作品一 Agent Loupe 收了尾(评测用例、演示站防滥用、部署、开源包装),又给作品二 BillSleuth 开了题。今天不学新东西:画一张知识地图把六天串起来,默写 Day 677 的 prorate 和 Day 676 发布自查里最容易写错的三条检查,各用一个检查脚本证明默写对了,再用 Loupe 的评测思路给折算函数做一次回归,抓出「分母写死 30」。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'billsleuth', 'agent-loupe', 'python', 'agent-zero']
series: 'agent-zero'
day: 678
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 677](/blog/agent-zero/day-677-bs-why/) 给作品二 BillSleuth 开了题:为什么选计费争议(招聘方看得懂、出错代价高、能严格评测),然后补了两个计费基本功。计费周期左闭右开,6 月 5 日到 7 月 5 日是 30 天;按天折算是「整月金额 × 剩余天数 / 周期天数」,舍入到分。最后把「分母写死 30」在三种长度的周期里各跑了一遍:30 天的月份看不出来,31 天多收 2.58,28 天少收 4.64。

这一周的六天跨了两个作品。前四天还在给 Loupe 收尾,后两天(其实是一天半)已经在讲订阅计费。看起来是两件事,其实有一条线把它们穿起来:**一个数字能不能信,要看它是怎么来的**。Loupe 的评测通过率要先排除基础设施错误才可信,README 里的性能数字要测过才敢写,BillSleuth 的每一分钱都要能复算。今天把这条线画出来,把最容易写错的两段代码默写一遍。

## 今天要解决的问题

复习日不加新概念。今天结束时你应该能:

1. 不看文章画出本周知识地图,说出每一天留下来的那一样东西(一个文件、一个函数或一条规则),以及它后面在哪里还会用到。
2. 默写 Day 677 的 `prorate` 和 `net`,用一个「整数分」写的独立算法在 732 组输入上证明默写版一分不差。
3. 默写 [Day 676](/blog/agent-zero/day-676-loupe-showcase/) `release_check.py` 里最容易写错的三条检查(性能表空格子、像 key 的字符串、不该提交的文件),用 9 个「该过/该拦」的输入证明它们没有误报也没有漏报。
4. 跑通本周小项目 `scratch/review97.py`:把 Loupe 的评测用例思路(冻结的快照、断言、基础设施错误单独算、pass^k、逐条回归对比)搬到折算函数上,让它自己抓出「分母写死 30」那个候选版本。

预计用时 3 到 4 小时,大头在默写和练习。前置:[Day 672](/blog/agent-zero/day-672-loupe-eval-1/) 到 [Day 677](/blog/agent-zero/day-677-bs-why/) 全部。今天不调模型,花费 0 元。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

先看全貌。上面一排是六天各自解决的问题,下面一排是每一天留下来、后面还会反复用到的东西:

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="第 97 周知识地图:Loupe 收尾四天(评测用例、防滥用、部署、包装)和 BillSleuth 开题一天,下面是每天留下的文件和规则">
  <rect x="0" y="0" width="640" height="320" fill="var(--paper-raised)" rx="6"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="24" font-size="12" fill="var(--ink)">第 97 周:一个数字能不能信,看它是怎么来的</text>
    <rect x="20" y="40" width="190" height="112" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="115" y="60" text-anchor="middle" font-size="12" fill="var(--mem)">评测:失败变用例</text>
    <text x="30" y="82" fill="var(--ink-soft)">672 步级/端到端、快照</text>
    <text x="30" y="100" fill="var(--ink-soft)">672 断言同名、只看往后</text>
    <text x="30" y="118" fill="var(--ink-soft)">673 infra 错误单独算</text>
    <text x="30" y="136" fill="var(--ink-soft)">673 pass^k、回归对比</text>
    <rect x="225" y="40" width="190" height="112" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="320" y="60" text-anchor="middle" font-size="12" fill="var(--compute)">上线:不被刷、不白屏</text>
    <text x="235" y="82" fill="var(--ink-soft)">674 只读、脱敏、限流</text>
    <text x="235" y="100" fill="var(--ink-soft)">674 按花费的每日上限</text>
    <text x="235" y="118" fill="var(--ink-soft)">675 彩排、SPA 回退</text>
    <text x="235" y="136" fill="var(--ink-soft)">675 单进程、性能表</text>
    <rect x="430" y="40" width="190" height="112" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="525" y="60" text-anchor="middle" font-size="12" fill="var(--ink)">讲清楚 + 新开题</text>
    <text x="440" y="82" fill="var(--ink-soft)">676 README、ADR</text>
    <text x="440" y="100" fill="var(--ink-soft)">676 发布前自查脚本</text>
    <text x="440" y="118" fill="var(--ink-soft)">677 左闭右开、锚点日</text>
    <text x="440" y="136" fill="var(--ink-soft)">677 按天折算、Decimal</text>
    <line x1="210" y1="96" x2="225" y2="96" stroke="var(--ink-soft)"/>
    <line x1="415" y1="96" x2="430" y2="96" stroke="var(--ink-soft)"/>
    <line x1="115" y1="152" x2="115" y2="182" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
    <line x1="320" y1="152" x2="320" y2="182" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
    <line x1="525" y1="152" x2="525" y2="182" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
    <rect x="20" y="182" width="190" height="78" rx="4" fill="none" stroke="var(--mem)"/>
    <text x="30" y="202" fill="var(--ink)">evalcases.py</text>
    <text x="30" y="220" fill="var(--ink-soft)">grade / run_batch</text>
    <text x="30" y="238" fill="var(--ink-soft)">batch_summary / compare</text>
    <rect x="225" y="182" width="190" height="78" rx="4" fill="none" stroke="var(--compute)"/>
    <text x="235" y="202" fill="var(--ink)">guard.py  redact.py</text>
    <text x="235" y="220" fill="var(--ink-soft)">start.sh  smoke.py</text>
    <text x="235" y="238" fill="var(--ink-soft)">_redirects: /* / 200</text>
    <rect x="430" y="182" width="190" height="78" rx="4" fill="none" stroke="var(--rule)"/>
    <text x="440" y="202" fill="var(--ink)">release_check.py</text>
    <text x="440" y="220" fill="var(--ink-soft)">scratch/prorate.py</text>
    <text x="440" y="238" fill="var(--ink-soft)">denominator_bug.py</text>
    <text x="20" y="288" fill="var(--ink-faint)">今天默写:右下两样。小项目:用左下那一套思路去测右下的 prorate。</text>
    <text x="20" y="306" fill="var(--ink-faint)">BillSleuth 后面的评测(Day 693 起)会把这一套原样再用一遍。</text>
  </g>
</svg>
<figcaption>六天三段:先把失败变成可复跑的用例,再让演示站扛得住陌生人,最后把项目讲清楚,顺手开了第二个作品的题。虚线下面是每段留下的文件。</figcaption>
</figure>

这张图你自己画的时候,不用追求和我一模一样。关键是每一格都能说出一个具体的文件或函数名,说不出来就回去翻那一天。

## 本周每天一句话

- [Day 672](/blog/agent-zero/day-672-loupe-eval-1/):从 Loupe 里看到的失败步骤存成**步级用例**,用例里冻结一份快照(那一步的 messages、tools 和全部工具结果),断言字段和端到端评测集同名,而且只看快照那一步往后的步骤。
- [Day 673](/blog/agent-zero/day-673-loupe-eval-2/):`evalcases.py` 把用例批量跑 k 次,模型服务 503、限流、超时记成基础设施错误不进通过率,算 pass^k,两批结果逐条比出变差的用例,再导出成端到端评测集的 JSONL。
- [Day 674](/blog/agent-zero/day-674-loupe-deploy-1/):演示站只开放读和少数会花钱的接口;样例脱敏后再扫一遍残留;`guard.py` 按 IP 和全站滑动窗口限流、按当天实际花费设上限,只信任确定存在的那一层代理加的头。
- [Day 675](/blog/agent-zero/day-675-loupe-deploy-2/):本机按线上的样子彩排,发现 `/* /index.html 200` 会被静默忽略、uvicorn 自己会读 `X-Forwarded-For`、开两个 worker 限流就漏;后端只跑一个进程,数据库放在持久卷上,`smoke.py` 八项全过。
- [Day 676](/blog/agent-zero/day-676-loupe-showcase/):README 第一屏一句话加动图,ADR 写被放弃的方案和代价,发布前自查脚本抓出被提交的 `.env` 和测试里的假 key,还抓出了它自己正则里的 bug。
- [Day 677](/blog/agent-zero/day-677-bs-why/):BillSleuth 开题,计费周期左闭右开、锚点日限定 1 到 28、按天折算记到下一张发票,金额用 Decimal 从字符串造、用 `quantize` 舍入。

有一点要提醒:Day 672 到 674 讲的 `evalcases.py`、`guard.py` 依赖 Loupe 的整套服务端(数据库、`Step` 模型、FastAPI 应用),今天的默写和小项目故意不 import 它们,只把思路拿出来,在几十行的独立脚本里重写一遍。这样你在任何一台机器上都能跑,也能检验自己是不是真的懂了,而不是只记住了文件名。

## 准备环境

今天的文件放在两个作品仓库里已有的目录下,不新建仓库:

| 文件 | 放在哪 | 是什么 |
| --- | --- | --- |
| `recall_prorate.py`、`check_recall_prorate.py` | `billsleuth/scratch/` | 默写一和它的检查脚本 |
| `recall_release.py`、`check_recall_release.py` | `agent-loupe/scripts/` | 默写二和它的检查脚本 |
| `review97.py` 和四个 `ex*.py` | `billsleuth/scratch/` | 本周小项目和练习答案 |

`billsleuth/` 是 Day 677 建的,已经有 `.python-version`(3.12)和 `pyproject.toml`。今天的脚本只用标准库,不需要 `uv add` 任何东西。脚本之间会互相 import(比如检查脚本 import 默写版),所以都在 `scratch/` 目录里面运行:

```bash
cd billsleuth/scratch
uv run --project .. python recall_prorate.py
```

<div class="line-notes">

- `cd billsleuth/scratch` 进到脚本所在的目录。Python 运行一个脚本时,会把**脚本所在的目录**加进模块搜索路径,所以 `check_recall_prorate.py` 里的 `from recall_prorate import prorate` 能找到同目录的文件。相当于 Node 里 `require('./recall_prorate')` 的相对查找。
- `uv run --project .. python recall_prorate.py` `--project ..` 告诉 uv 用上一级的 `pyproject.toml` 和 `.venv`,也就是 billsleuth 项目的 Python 3.12。不加的话 uv 在 `scratch/` 里找不到项目文件,会往上找到同一个项目,结果一样,但写清楚更不容易糊涂。这个文件只定义函数,没有输出。

</div>

`agent-loupe/scripts/` 下的两个文件只用 `re`,本机自带的 `python3` 就能跑,也可以照样 `uv run --project ../server python ...`。

## 默写一:`prorate` 和 `net`

先合上 Day 677,只看这一句要求,自己写:

> 写 `prorate(full, days_left, period_days)`:整月金额乘剩余天数除以周期天数,四舍五入到分,只舍入一次。再写 `net(old, new, days_left, period_days)`:收新减退旧的折算净额。

我的默写版:

```python
# billsleuth/scratch/recall_prorate.py  默写:Day 677 的 prorate 和 net
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def prorate(full: Decimal, days_left: int, period_days: int) -> Decimal:
    return (full * days_left / period_days).quantize(CENT, rounding=ROUND_HALF_UP)


def net(old: Decimal, new: Decimal, days_left: int, period_days: int) -> Decimal:
    return prorate(new, days_left, period_days) - prorate(old, days_left, period_days)
```

<div class="line-notes">

- `from decimal import ROUND_HALF_UP, Decimal` 两样东西都来自标准库。`ROUND_HALF_UP` 是四舍五入的名字,不写的话 `quantize` 用默认的逢五取偶。
- `CENT = Decimal("0.01")` 「精确到分」的模板,用字符串造。写成 `Decimal(0.01)` 就是 Day 677 常见误区里那个坑。
- `(full * days_left / period_days)` 先乘后除,整个分数算完再舍入。7 月升级那次:267 × 16 / 31 = 137.806…,后面的 `.quantize(CENT, rounding=ROUND_HALF_UP)` 把它舍入成 137.81。整个函数只在这里舍入一次。
- `def net(old: Decimal, new: Decimal, days_left: int, period_days: int) -> Decimal:` 比 Day 677 的 `net` 多了两个参数:那边旧价和新价写死在模块常量里,这里改成传进来,检查脚本和小项目都能复用。
- `return prorate(new, days_left, period_days) - prorate(old, days_left, period_days)` 两行各自舍入再相减。Day 677 练习 3 说过,「先舍入再相减」和「先相减再舍入」能差一分钱,我们定的规则是前者。

</div>

### 怎么证明默写对了

和自己的记忆比没意义,你可能记错了还觉得对。和原文逐字比也不好,写法不同但结果相同完全没问题。我的办法是**换一种完全不同的算法独立算一遍**,在一大批输入上逐个对结果。

这里的「另一种算法」用整数分来算,全程没有小数。把金额换成分(117.00 美元是 11700 分),四舍五入「a × b / c」到整数可以写成 `(2ab + c) // 2c`:分子加上半个分母再整除,就是逢半进一。`//` 是 Python 的整除,相当于 JS 的 `Math.floor(a / b)`(对正数而言)。

```python
# billsleuth/scratch/check_recall_prorate.py  用「整数分」独立算一遍,和默写版逐个比
from decimal import Decimal

from recall_prorate import prorate


def prorate_cents(full_cents: int, days_left: int, period_days: int) -> int:
    # 四舍五入到整数:(2ab + c) // 2c,全程整数,没有小数
    return (2 * full_cents * days_left + period_days) // (2 * period_days)


prices = [117_00, 267_00, 39_00, 195_00, 1_00, 99_99]
checked, bad = 0, []
for full_cents in prices:
    for period_days in (28, 29, 30, 31):
        for days_left in range(0, period_days + 1):
            mine = prorate(Decimal(full_cents) / 100, days_left, period_days)
            ref = Decimal(prorate_cents(full_cents, days_left, period_days)) / 100
            checked += 1
            if mine != ref:
                bad.append((full_cents, days_left, period_days, mine, ref))
print(f"比了 {checked} 组,不一致 {len(bad)} 组")
for row in bad[:5]:
    print("  不一致:", row)
```

<div class="line-notes">

- `from recall_prorate import prorate` 被检查的是默写版。同目录 import,前面「准备环境」讲过为什么能找到。
- `def prorate_cents(full_cents: int, days_left: int, period_days: int) -> int:` 参照算法,输入输出都是整数分,和 Decimal 一点关系都没有。两种完全不同的实现得出同一个答案,才说明两边都对。
- `return (2 * full_cents * days_left + period_days) // (2 * period_days)` 代入 7 月退团队版:(2 × 11700 × 16 + 31) // 62 = 374431 // 62 = 6039,也就是 60.39 美元,和 Day 677 手算的一样。
- `prices = [117_00, 267_00, 39_00, 195_00, 1_00, 99_99]` 六个价格,单位是分。`117_00` 里的下划线只是分隔,写成这样一眼看出是 117.00 美元。99.99 是故意挑的,它最容易落在半分上。
- `for period_days in (28, 29, 30, 31):` 四种周期长度都要覆盖。29 天是闰年 2 月,Day 677 没出现过,但现实里 2028 年就会遇到。
- `for days_left in range(0, period_days + 1):` 剩余天数从 0 到整个周期,包括两个端点。`range(0, n + 1)` 相当于 JS 的 `for (let d = 0; d <= n; d++)`。
- `mine = prorate(Decimal(full_cents) / 100, days_left, period_days)` 分换回美元交给默写版。`Decimal(11700) / 100` 是精确的 117,整数造 Decimal 没有浮点问题。
- `ref = Decimal(prorate_cents(full_cents, days_left, period_days)) / 100` 参照答案也换成美元,两边才能直接 `!=` 比较。
- `bad.append((full_cents, days_left, period_days, mine, ref))` 不一致时把输入和两边的结果都记下来,方便看是哪种情况错了。
- `for row in bad[:5]:` 最多打印 5 条,错的时候不至于刷屏。

</div>

```bash
uv run --project .. python check_recall_prorate.py
```

```text
比了 732 组,不一致 0 组
```

6 个价格 × (29 + 30 + 31 + 32) 种剩余天数 = 6 × 122 = 732 组,全部一致。

### 故意写错一次:先算日价

默写时我最想走的捷径是先算「每天多少钱」,再乘天数,看起来更像人话。把 `prorate` 的函数体换成这两行试试:

```python
    daily = (full / period_days).quantize(CENT, rounding=ROUND_HALF_UP)  # 先算日价
    return daily * days_left
```

<div class="line-notes">

- `daily = (full / period_days).quantize(CENT, rounding=ROUND_HALF_UP)` 先把日价舍入到分。117 / 28 = 4.178…,舍成 4.18。
- `return daily * days_left` 再乘天数,4.18 × 4 = 16.72。舍入误差被乘了 4 倍。

</div>

再跑检查脚本,真实输出:

```text
比了 732 组,不一致 546 组
  不一致: (11700, 4, 28, Decimal('16.72'), Decimal('16.71'))
  不一致: (11700, 5, 28, Decimal('20.90'), Decimal('20.89'))
  不一致: (11700, 6, 28, Decimal('25.08'), Decimal('25.07'))
  不一致: (11700, 7, 28, Decimal('29.26'), Decimal('29.25'))
  不一致: (11700, 8, 28, Decimal('33.44'), Decimal('33.43'))
```

732 组里错了 546 组,将近四分之三。每组只差一两分钱,但正确答案是 117 × 4 / 28 = 16.714…,舍入后 16.71。这种一分钱的差异,在 Day 677 的单个例子里很可能看不出来(117 / 30 = 3.9 正好除尽,6 月的例子先算日价也不会错),只有放到几百组输入上才藏不住。改回只舍入一次,再跑一遍确认回到 0。

## 默写二:发布自查里最容易写错的三条检查

[Day 676](/blog/agent-zero/day-676-loupe-showcase/) 的 `release_check.py` 有十几条检查,大部分是「某个小节在不在」这种不会写错的。真正容易错的是三条:性能表里有没有空格子、文件里有没有像 key 的字符串、哪些文件不该提交。把它们抽成三个小函数默写:

```python
# agent-loupe/scripts/recall_release.py  默写:Day 676 release_check.py 里最容易写错的三条检查
import re


def perf_section(readme: str) -> str:
    return readme.split("## 性能", 1)[-1].split("\n## ", 1)[0]


def has_empty_cell(text: str) -> bool:
    return re.search(r"\|[ \t]*\|", text) is not None


def looks_like_key(text: str) -> bool:
    return re.search(r"\bsk-[A-Za-z0-9]{20,}", text) is not None


def should_not_commit(path: str) -> bool:
    return path.endswith((".db", ".env"))
```

<div class="line-notes">

- `import re` 标准库的正则模块,相当于 JS 的 `RegExp`。
- `return readme.split("## 性能", 1)[-1].split("\n## ", 1)[0]` 截出「## 性能」到下一个二级标题之间的文字。第一刀切在标题处取后半段,第二刀切在下一个 `\n## ` 处取前半段。不截这一段的话,「已知局限」里的表格空格子也会被算进来。
- `return re.search(r"\|[ \t]*\|", text) is not None` 两根竖线中间只有空格或制表符,就是一个空格子。方括号里**只写空格和 `\t`**,不能写 `\s`,原因下面马上演示。`re.search` 找不到返回 `None`,相当于 JS 的 `match` 返回 `null`。
- `return re.search(r"\bsk-[A-Za-z0-9]{20,}", text) is not None` `\b` 是单词边界,保证 `sk-` 前面不是字母数字,`task-...` 这种词里的 `sk-` 不算。后面跟 20 个以上字母数字才像一个 key。
- `return path.endswith((".db", ".env"))` 传一个元组,任意一个后缀匹配就返回 True。`.env.example` 以 `.example` 结尾,不会被拦。

</div>

检查脚本给每条规则各喂「应该通过」和「应该拦住」的输入,这是 Day 676 最后那句话的落实:检查脚本本身也要测。

```python
# agent-loupe/scripts/check_recall_release.py  每条检查各喂「该过」和「该拦」的输入
from recall_release import has_empty_cell, looks_like_key, perf_section, should_not_commit

FULL = "## 性能\n| 指标 | 数值 |\n| --- | --- |\n| 轻步骤 | 89 ms |\n\n## 已知局限\n| a |  |\n"
HOLE = "## 性能\n| 指标 | 数值 |\n| --- | --- |\n| 线上首屏 |  |\n"

cases = [
    ("填满的性能表不报", has_empty_cell(perf_section(FULL)), False),
    ("有空格子的性能表要报", has_empty_cell(perf_section(HOLE)), True),
    ("别的小节的空格子不算", has_empty_cell(perf_section(FULL)), False),
    ("完整假 key 要报", looks_like_key('key = "sk-' + 'abcdefghijklmnop1234"'), True),
    ("拆开写的假 key 不报", looks_like_key('fake = "sk-" + "abcdefghijklmnop1234"'), False),
    ("ask-xxx 这种词不报", looks_like_key("task-abcdefghijklmnopqrstuv"), False),
    (".env 不能提交", should_not_commit("deploy/rehearsal.env"), True),
    (".env.example 可以提交", should_not_commit("deploy/rehearsal.env.example"), False),
    ("loupe.db 不能提交", should_not_commit("server/loupe.db"), True),
]
fails = [name for name, got, want in cases if got != want]
for name, got, want in cases:
    print(f"{'ok ' if got == want else 'BAD'} {name}:得到 {got},应该 {want}")
print(f"{len(cases) - len(fails)}/{len(cases)} 通过")
```

<div class="line-notes">

- `FULL = "## 性能\n| 指标 | 数值 |` 一份性能表全部填满的 README 片段。注意它后面跟了一个「## 已知局限」小节,里面故意有一个空格子 `| a |  |`,用来测 `perf_section` 有没有截对。
- `HOLE = "## 性能\n| 指标 | 数值 |` 性能表里「线上首屏」那一格空着,这是应该被拦住的情况。
- `cases = [` 每条是 `(说明, 实际结果, 期望结果)`,一个元组列表就是一张最简单的测试表,和 [Day 73](/blog/agent-zero/day-073-pytest-3/) 的 parametrize 是同一个想法。
- `("完整假 key 要报", looks_like_key('key = "sk-' + 'abcdefghijklmnop1234"'), True),` 测试数据本身也拆成两段写,不然这个检查脚本自己就会被 `release_check.py` 报「疑似有 API key」。Day 676 踩过这个坑。
- `("拆开写的假 key 不报", looks_like_key('fake = "sk-" + "abcdefghijklmnop1234"'), False),` 源码里 `sk-` 后面紧跟的是引号,不是字母数字,所以不像 key。
- `("ask-xxx 这种词不报", looks_like_key("task-abcdefghijklmnopqrstuv"), False),` 验证 `\b` 起作用:`task-` 里的 `sk-` 前面是字母 `a`,不在单词边界上。
- `fails = [name for name, got, want in cases if got != want]` 列表推导式加解包,挑出不符合期望的。相当于 JS 的 `cases.filter(([, got, want]) => got !== want).map(([name]) => name)`。
- `print(f"{'ok ' if got == want else 'BAD'} {name}` 每条都打印,对的写 `ok`,错的写 `BAD`,一眼能扫出来。

</div>

```bash
cd agent-loupe/scripts
python3 check_recall_release.py
```

```text
ok  填满的性能表不报:得到 False,应该 False
ok  有空格子的性能表要报:得到 True,应该 True
ok  别的小节的空格子不算:得到 False,应该 False
ok  完整假 key 要报:得到 True,应该 True
ok  拆开写的假 key 不报:得到 False,应该 False
ok  ask-xxx 这种词不报:得到 False,应该 False
ok  .env 不能提交:得到 True,应该 True
ok  .env.example 可以提交:得到 False,应该 False
ok  loupe.db 不能提交:得到 True,应该 True
9/9 通过
```

### 故意写错一次:`\s`

把 `has_empty_cell` 里的 `[ \t]*` 改回 Day 676 我第一次写的 `\s*`,再跑:

```text
BAD 填满的性能表不报:得到 True,应该 False
ok  有空格子的性能表要报:得到 True,应该 True
BAD 别的小节的空格子不算:得到 True,应该 False
ok  完整假 key 要报:得到 True,应该 True
ok  拆开写的假 key 不报:得到 False,应该 False
ok  ask-xxx 这种词不报:得到 False,应该 False
ok  .env 不能提交:得到 True,应该 True
ok  .env.example 可以提交:得到 False,应该 False
ok  loupe.db 不能提交:得到 True,应该 True
7/9 通过
```

注意第二条还是 `ok`。只用「应该拦住」的输入测,`\s*` 这一版看起来完全正常,它确实拦住了有空格子的表。问题出在「应该通过」的那两条:`\s` 也匹配换行,上一行末尾的 `|`、换行、下一行开头的 `|` 被当成一个空格子,填满的表也报。**只测「该拦的拦住了」不够,一定要同时测「该过的放过了」**,这就是检查脚本里每条规则都配一对输入的原因。

## 本周小项目:用 Loupe 的评测思路给折算函数做回归

Day 672 和 673 在 Loupe 里搭了一套「失败变用例 → 批量跑 → 逐条比」的流程,测的是模型。这套思路其实不挑被测对象。今天把它搬到 Day 677 的折算函数上,模拟这样一个场景:有人觉得「一个月按 30 天算更简单」,提了一个候选版本,我们要用评测回答「这个改动能不能合进去」。

为了让场景更像真的,我还加了一个干扰:两个版本运行时都有 20% 的概率「上游超时」,模拟 Day 673 实测时遇到的 DeepSeek 503。被测函数本身没有错,但评测得能分清「被测对象错了」和「环境出问题了」。

```python
# billsleuth/scratch/review97.py  本周小项目:用 Loupe 的评测思路给折算函数做回归
import random
from collections.abc import Callable
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
Version = Callable[[dict], Decimal]

# 用例 = 冻结的输入快照 + 断言。期望值是手算的,不是拿某个版本跑出来的
CASES = [
    {"id": "jun-upgrade", "snapshot": {"start": date(2026, 6, 5), "end": date(2026, 7, 5), "change": date(2026, 6, 20),
                                       "old": "117.00", "new": "267.00"}, "expect": {"net_equals": "75.00"}},
    {"id": "jul-upgrade", "snapshot": {"start": date(2026, 7, 5), "end": date(2026, 8, 5), "change": date(2026, 7, 20),
                                       "old": "117.00", "new": "267.00"}, "expect": {"net_equals": "77.42"}},
    {"id": "feb-upgrade", "snapshot": {"start": date(2027, 2, 5), "end": date(2027, 3, 5), "change": date(2027, 2, 20),
                                       "old": "117.00", "new": "267.00"}, "expect": {"net_equals": "69.64"}},
    {"id": "jul-seats", "snapshot": {"start": date(2026, 7, 5), "end": date(2026, 8, 5), "change": date(2026, 7, 30),
                                     "old": "117.00", "new": "195.00"}, "expect": {"net_equals": "15.09"}},
]


def prorate(full: Decimal, days_left: int, period_days: int) -> Decimal:
    return (full * days_left / period_days).quantize(CENT, rounding=ROUND_HALF_UP)


def net_with(denominator: Callable[[dict], int]) -> Version:
    def run(s: dict) -> Decimal:
        left, days = (s["end"] - s["change"]).days, denominator(s)
        return prorate(Decimal(s["new"]), left, days) - prorate(Decimal(s["old"]), left, days)
    return run


baseline = net_with(lambda s: (s["end"] - s["start"]).days)  # 分母用周期实际天数
candidate = net_with(lambda s: 30)  # 有人「优化」成写死 30


def flaky(version: Version, rate: float, seed: int) -> Version:
    rng = random.Random(seed)
    def run(s: dict) -> Decimal:
        if rng.random() < rate:
            raise TimeoutError("上游超时")  # 模拟 Day 673 里的 503:不是被测对象的错
        return version(s)
    return run


def grade(case: dict, version: Version) -> str:
    try:
        got = version(case["snapshot"])
    except TimeoutError:
        return "infra"
    return "pass" if got == Decimal(case["expect"]["net_equals"]) else f"fail:{got}"


def run_batch(version: Version, k: int) -> dict[str, list[str]]:
    return {c["id"]: [grade(c, version) for _ in range(k)] for c in CASES}


def summarize(name: str, batch: dict[str, list[str]]) -> None:
    trials = [t for ts in batch.values() for t in ts]
    real = [t for t in trials if t != "infra"]
    passed = sum(t == "pass" for t in real)
    complete = {cid: ts for cid, ts in batch.items() if "infra" not in ts}
    all_pass = sum(all(t == "pass" for t in ts) for ts in complete.values())
    print(f"[{name}] 通过率 {passed}/{len(real)}(另有 {len(trials) - len(real)} 次基础设施错误不计),"
          f"pass^k {all_pass}/{len(complete)}(只算 k 次都跑完的用例)")


def regressions(old: dict[str, list[str]], new: dict[str, list[str]]) -> list[str]:
    def ok(ts: list[str]) -> bool:
        return all(t in ("pass", "infra") for t in ts) and "pass" in ts
    return [f"{cid}: {old[cid]} -> {new[cid]}" for cid in old if ok(old[cid]) and not ok(new[cid])]


if __name__ == "__main__":
    k = 3
    base = run_batch(flaky(baseline, rate=0.2, seed=1), k)
    cand = run_batch(flaky(candidate, rate=0.2, seed=8), k)
    summarize("基线 实际天数", base)
    summarize("候选 写死 30", cand)
    print("变差的用例:")
    for line in regressions(base, cand):
        print("  " + line)
```

<div class="line-notes">

- `from collections.abc import Callable` 「可调用的东西」的类型,`Callable[[dict], Decimal]` 就是「接收一个 dict、返回 Decimal 的函数」,相当于 TS 的 `(s: Record<string, unknown>) => Decimal`。[Day 45](/blog/agent-zero/day-045-type-hints-1/) 起讲过类型标注。
- `Version = Callable[[dict], Decimal]` 给这个函数类型起个名字,后面「一个被测版本」都写 `Version`。这是类型别名,相当于 TS 的 `type Version = ...`。
- `CASES = [` 四条用例,每条有 `id`、`snapshot`、`expect` 三个字段,形状照搬 Day 672 的评测用例:快照是冻结的输入,断言是期望。
- `"expect": {"net_equals": "75.00"}` 期望值**是手算的**,来自 Day 677 的正文和练习,不是拿某个版本跑出来再抄进去。拿被测代码的输出当期望,等于让它自己给自己判卷,Day 682 造数据集时这条规矩还会出现。
- `{"id": "jul-seats"` 第四条来自 Day 677 练习 3:7/30 从 3 席加到 5 席,195 是团队版 5 席的整月价。
- `def net_with(denominator: Callable[[dict], int]) -> Version:` 一个「造版本」的函数:传进去「分母怎么算」,返回一个完整的折算函数。两个版本只有分母不同,其他代码完全共用,对比才公平。这种「函数返回函数」在 JS 里也很常见,比如 `const makeAdder = n => x => x + n`。
- `left, days = (s["end"] - s["change"]).days, denominator(s)` 剩余天数总是按实际日期算,只有分母交给传进来的函数决定。
- `baseline = net_with(lambda s: (s["end"] - s["start"]).days)` 基线:分母是周期实际天数。`lambda` 是 Python 的单表达式匿名函数,相当于 JS 的箭头函数 `s => ...`。
- `candidate = net_with(lambda s: 30)` 候选:不管周期多长都是 30。
- `def flaky(version: Version, rate: float, seed: int) -> Version:` 给任意版本包一层「会随机超时」的外壳,返回的还是一个 `Version`。这是一个手写的装饰器,包装的思路和 [Day 96](/blog/agent-zero/day-096-decorators/) 一样。
- `rng = random.Random(seed)` 带种子的随机数生成器。种子固定,每次跑出来哪几次超时都一样,结果可以复现。这里的 `rate` 是概率,只参与 `random()` 的比较,不涉及金额,用 float 没问题。
- `raise TimeoutError("上游超时")` 模拟环境故障。`TimeoutError` 是 Python 内置的异常类型。
- `except TimeoutError:` 只接住超时,记成 `"infra"`。被测函数自己抛的其他异常(比如除以 0)不在这里接,会直接炸出来,因为那是被测对象的错,不能被藏起来。
- `return "pass" if got == Decimal(case["expect"]["net_equals"]) else f"fail:{got}"` 失败时把实际值带上,报告里直接能看到 `fail:80.00`,不用再去查。这对应 Day 672 `grade` 返回失败原因列表的做法。
- `return {c["id"]: [grade(c, version) for _ in range(k)] for c in CASES}` 字典推导式套列表推导式:每条用例跑 k 次,结果按用例 id 收起来。形状是 `{"jun-upgrade": ["infra", "pass", "pass"], ...}`。
- `real = [t for t in trials if t != "infra"]` 通过率的分母里去掉基础设施错误。
- `complete = {cid: ts for cid, ts in batch.items() if "infra" not in ts}` pass^k 只算 k 次都真正跑完的用例。有一次超时的用例,我们不知道那一次如果跑完会不会对,不能当成「k 次全对」,也不能当成「没全对」。
- `all_pass = sum(all(t == "pass" for t in ts) for ts in complete.values())` pass^k:k 次全过才算这条用例稳定。`True` 在求和时当 1 算。
- `def ok(ts: list[str]) -> bool:` 「这条用例算好的」:没有任何一次失败,而且至少真正通过过一次。全是 infra 的用例不知道好坏,不算好。
- `return [f"{cid}: {old[cid]} -> {new[cid]}" for cid in old if ok(old[cid]) and not ok(new[cid])]` 回归 = 基线里是好的、候选里不好了。对应 Day 673 `compare` 里 `regressed` 那个列表,门禁就看它是不是空的。
- `base = run_batch(flaky(baseline, rate=0.2, seed=1), k)` 基线跑一批,每条 3 次,20% 概率超时。
- `cand = run_batch(flaky(candidate, rate=0.2, seed=8), k)` 候选跑一批,换一个种子,模拟两批是不同时间跑的。

</div>

```bash
cd billsleuth/scratch
uv run --project .. python review97.py
```

```text
[基线 实际天数] 通过率 9/9(另有 3 次基础设施错误不计),pass^k 1/1(只算 k 次都跑完的用例)
[候选 写死 30] 通过率 2/10(另有 2 次基础设施错误不计),pass^k 0/2(只算 k 次都跑完的用例)
变差的用例:
  jul-upgrade: ['pass', 'pass', 'pass'] -> ['fail:80.00', 'infra', 'fail:80.00']
  feb-upgrade: ['pass', 'pass', 'infra'] -> ['fail:65.00', 'fail:65.00', 'fail:65.00']
  jul-seats: ['infra', 'pass', 'pass'] -> ['fail:15.60', 'fail:15.60', 'fail:15.60']
```

逐行读一下。

基线通过率 9/9,另外 3 次超时不计。如果把超时算成失败就是 9/12 = 75%,看上去基线就有问题,你会去怀疑一个完全正确的函数。这正是 Day 673 用 DeepSeek 实测时遇到的:第一批 1/3 里没有一条是 Agent 真正的失败。

基线的 pass^k 只有 1/1,这一行很别扭。四条用例里三条都碰上过一次超时,只剩 `jul-upgrade` 三次都跑完了。规则本身没错(不知道的不乱算),但样本被基础设施错误吃掉了一大半,这个 pass^k 几乎没有信息量。练习 2 会用「超时重试」修它。

候选那批的三条回归和 Day 677 的结论一一对上:7 月(31 天)期望 77.42 得到 80.00,多收 2.58;2 月(28 天)期望 69.64 得到 65.00,少收 4.64;7 月底加席位期望 15.09 得到 15.60。`jun-upgrade` 没出现在回归列表里,因为 6 月周期正好 30 天,候选版在它上面也是对的。**如果评测集只有 6 月那条,这个改动会被绿灯放行。** 用例要覆盖不同长度的周期,这句话 Day 677 说过一次,今天被评测结果自己证明了一次。

### 零件和小项目的对照

| 本周的零件 | 在 review97.py 里对应哪一段 |
| --- | --- |
| Day 672 用例存快照,不存引用 | `CASES` 里每条的 `snapshot`,期望值手算 |
| Day 672 断言字段同名 | `expect.net_equals`,`grade` 只认这一个字段 |
| Day 673 基础设施错误单独算 | `flaky` 抛 `TimeoutError`,`grade` 记成 `"infra"`,`summarize` 不计入 |
| Day 673 pass^k | `summarize` 里的 `complete` 和 `all_pass` |
| Day 673 两批逐条比 | `regressions` |
| Day 677 `prorate`、分母 bug | `prorate`、`baseline` 和 `candidate` |

## 本周错题与坑清单

这一周踩的坑我按「在哪一天」「什么现象」「怎么修」列一张表。考自己的时候遮住后两列,看到第一列能不能说出来。

| 哪天 | 现象 | 原因和修法 |
| --- | --- | --- |
| 672 | 用例只存 `(run_id, step_idx)`,一个月后原运行被清理,用例跑不了 | 用例存完整快照:那一步的 messages、tools、全部工具结果 |
| 672 | 断言「必须调用 get_weather」,原运行第 1 步调过,用例从第 3 步存,结果判失败 | 断言只看快照那一步往后,这是对的;用例测的是「模型在这个位置会怎么做」 |
| 673 | 第一批 1/3 通过,其中一次是 DeepSeek 503,一次是磁带没录到计算器的输入,模型来回绕 | 5xx/429/超时记基础设施错误不计;纯函数工具真实执行,不回放 |
| 673 | 一条用例跑三次,新旧提示词都是 3/3,分不出好坏 | 样本太少,先攒十几二十条来自真实失败的用例 |
| 674 | 固定窗口限流,10:59 发 5 次、11:00 再发 5 次全放过 | 用滑动窗口:只数最近一小时内的时间戳 |
| 674 | `X-Forwarded-For` 取第一个值,客户端随便写一个就绕过限流 | 只信确定存在的那层代理;自己的反代追加在最后,取最后一个 |
| 674 | 被限流时前端只看到「跨域失败」,读不到「请求太频繁」 | 拦截的中间件在 CORS 外层,拒绝的响应要自己补 CORS 头和 `Retry-After` 的暴露 |
| 675 | 深层链接能打开,以为 `/* /index.html 200` 生效了 | 实际被当成死循环忽略,是默认 SPA 行为在兜底;改成 `/* / 200`,smoke 每次测深层链接 |
| 675 | `TRUST_PROXY` 为空,伪造 8 次请求全放行 | uvicorn 默认对 127.0.0.1 开着 proxy headers;启动加 `--no-proxy-headers` |
| 675 | `--workers 2` 时每小时 5 次的限额放过了 8 次 | 限流计数在进程内存里,只跑一个进程;多进程要换 Redis |
| 675 | 改了 Pages 的 `VITE_API_BASE`,前端还连旧地址 | 这个值构建时写进 JS,要重新构建部署 |
| 676 | `.gitignore` 加了 `deploy/*.env`,`git ls-files` 里还有它 | 已跟踪的文件不受影响,`git rm --cached` |
| 676 | 测试里的假 key 被自查脚本报出来 | 拆成 `"sk-" + "..."` 两段写 |
| 676 | 性能表填满了还报「有空格子」 | `\s` 匹配换行;用 `[ \t]*`,并给检查脚本配「该过」的输入 |
| 677 | `Decimal(0.1)` 得到一长串 | 不精确在构造前就发生了,一律从字符串造 |
| 677 | `round(Decimal("2.665"), 2)` 得 2.66 | 默认逢五取偶;用 `quantize(CENT, rounding=ROUND_HALF_UP)` |
| 677 | 分母写死 30,测试一直是绿的 | 测试数据都在 30 天的月份;同一类故障放进 28、30、31 天的周期 |
| 677 | 上海凌晨 0:30 升级,按 UTC 取日期多算一天,多收 5.00 | 日期按客户本地算 |
| 678 | 默写 `prorate` 先算日价,732 组错 546 组 | 整个分数算完只舍入一次 |

最后一行是今天自己新踩的。复习日也会踩坑,踩了就补进表里。

## 动手练习

**练习 1:把基础设施错误算成失败,会得出什么结论?** 用 `review97.py` 的基线那一批,分别按「infra 不计」和「infra 算失败」算通过率。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex1_infra_as_fail.py  练习 1:把基础设施错误算成失败,会得出什么结论
from review97 import baseline, flaky, run_batch

base = run_batch(flaky(baseline, rate=0.2, seed=1), k=3)
trials = [t for ts in base.values() for t in ts]
print("infra 不计:", sum(t == "pass" for t in trials), "/", sum(t != "infra" for t in trials))
print("infra 算失败:", sum(t == "pass" for t in trials), "/", len(trials))
```

<div class="line-notes">

- `from review97 import baseline, flaky, run_batch` 直接复用小项目里的函数。`review97.py` 的运行代码在 `if __name__ == "__main__":` 下面,被 import 时不会跑,[Day 32](/blog/agent-zero/day-032-modules/) 讲过这个用法。
- `base = run_batch(flaky(baseline, rate=0.2, seed=1), k=3)` 和小项目用同一个种子,所以结果和上面那批一模一样:12 次里 3 次超时。
- `trials = [t for ts in base.values() for t in ts]` 把字典里的四个列表摊平成一个 12 个元素的列表。两层 `for` 的顺序和写嵌套循环时一样,外层在前。
- `sum(t != "infra" for t in trials)` 分母只数真正跑完的次数,9。
- `len(trials)` 分母数全部次数,12。

</div>

```text
infra 不计: 9 / 9
infra 算失败: 9 / 12
```

一个完全正确的函数,按第二种算法只有 75%。如果你拿这个数和候选版本比,候选那批里超时少一次,数字就会偏向它。环境的噪声直接混进了「哪个版本更好」的结论。真实的 Agent 评测里这更严重:服务商忙的那几分钟,所有用例同时掉分,看起来像是你的改动搞坏了一切。

</details>

**练习 2:超时重试。** 给 `grade` 加上「遇到基础设施错误最多重试 2 次」,两批各再跑一次,看 pass^k 变成多少,回归列表变没变。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex2_retry_infra.py  练习 2:基础设施错误最多重试 2 次,再算 pass^k
from review97 import CASES, Version, baseline, candidate, flaky, grade, regressions, summarize


def grade_retry(case: dict, version: Version, retries: int = 2) -> str:
    for _ in range(retries + 1):
        result = grade(case, version)
        if result != "infra":
            return result
    return "infra"


def run_batch_retry(version: Version, k: int) -> dict[str, list[str]]:
    return {c["id"]: [grade_retry(c, version) for _ in range(k)] for c in CASES}


base = run_batch_retry(flaky(baseline, rate=0.2, seed=1), k=3)
cand = run_batch_retry(flaky(candidate, rate=0.2, seed=8), k=3)
summarize("基线 重试后", base)
summarize("候选 重试后", cand)
print("变差:", len(regressions(base, cand)), "条")
```

<div class="line-notes">

- `def grade_retry(case: dict, version: Version, retries: int = 2) -> str:` 包在原来的 `grade` 外面,不改它。`retries: int = 2` 是带默认值的参数,相当于 JS 的 `retries = 2`。
- `for _ in range(retries + 1):` 第一次加两次重试,最多跑 3 次。
- `if result != "infra":` 只有基础设施错误才重试。`pass` 和 `fail` 都直接返回,**真失败绝不重试**,不然你会把一个十次错三次的不稳定版本重试成「通过」。
- `return "infra"` 三次都超时,如实记成 infra。
- `def run_batch_retry(version: Version, k: int) -> dict[str, list[str]]:` 和 `run_batch` 一样,只是把 `grade` 换成 `grade_retry`。
- `print("变差:", len(regressions(base, cand)), "条")` 回归列表的长度,和不重试时对比。

</div>

```text
[基线 重试后] 通过率 12/12(另有 0 次基础设施错误不计),pass^k 4/4(只算 k 次都跑完的用例)
[候选 重试后] 通过率 3/12(另有 0 次基础设施错误不计),pass^k 1/4(只算 k 次都跑完的用例)
变差: 3 条
```

重试以后两批都没有 infra 了。基线 pass^k 从 1/1 变成 4/4,这才是一个有信息量的数;候选 pass^k 1/4,那唯一的 1 是 30 天的 6 月。回归还是那 3 条,说明原来的结论没有被超时带偏,只是样本少。

这也是真实评测框架的通用做法:对 5xx、429、超时做有限次重试(通常带退避等待),重试完还失败的单独记账,比例太高就整批作废重跑。

</details>

**练习 3:为什么一开两个进程限流就漏?** Day 675 实测 `--workers 2` 时,每小时 5 次的限额放过了 8 次。用一个最小的 `SlidingWindow` 模拟 1、2、4 个进程,各发 12 次请求,看分别放过几次。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex3_two_workers.py  练习 3:内存限流计数为什么一开两个进程就漏
class SlidingWindow:
    def __init__(self, limit: int, window_s: float = 3600) -> None:
        self.limit, self.window = limit, window_s
        self.hits: dict[str, list[float]] = {}

    def allow(self, key: str, now: float) -> bool:
        q = [t for t in self.hits.get(key, []) if now - t < self.window]
        if len(q) >= self.limit:
            self.hits[key] = q
            return False
        q.append(now)
        self.hits[key] = q
        return True


def simulate(workers: int, n: int = 12) -> str:
    procs = [SlidingWindow(limit=5) for _ in range(workers)]
    marks = []
    for i in range(n):
        w = procs[i % workers]  # 轮流分给各个进程,真实情况是操作系统随缘分
        marks.append("放" if w.allow("127.0.0.1", now=float(i)) else "拦")
    return f"{workers} 个进程:{''.join(marks)},共放过 {marks.count('放')} 次"


print(simulate(1))
print(simulate(2))
print(simulate(4))
```

<div class="line-notes">

- `class SlidingWindow:` Day 674 `guard.py` 里那个类的简化版:去掉了线程锁和「还要等几秒」的返回值,只留判断逻辑。
- `self.hits: dict[str, list[float]] = {}` 每个 key(比如 IP)对应一串请求时间戳。**它存在这个对象里,也就是这个进程的内存里**,这是今天要看的重点。
- `q = [t for t in self.hits.get(key, []) if now - t < self.window]` 只留最近一小时内的时间戳,更早的扔掉。这一行就是「滑动」。
- `if len(q) >= self.limit:` 一小时内已经有 5 次,拒绝。
- `q.append(now)` 放行,并记下这次的时间。
- `procs = [SlidingWindow(limit=5) for _ in range(workers)]` 每个进程各有一个自己的限流器,互相看不见对方的计数。uvicorn 开 `--workers 2` 时就是这样:两个独立的 Python 进程,各自 import 一遍 `guard.py`。
- `w = procs[i % workers]` 第 i 个请求分给第 `i % workers` 个进程,两个进程时就是一人一个轮流。
- `w.allow("127.0.0.1", now=float(i))` 同一个 IP,第 i 秒发请求,12 次都在一小时内。
- `marks.count('放')` 列表的 `count` 数某个元素出现几次,相当于 JS 的 `arr.filter(x => x === '放').length`。

</div>

```text
1 个进程:放放放放放拦拦拦拦拦拦拦,共放过 5 次
2 个进程:放放放放放放放放放放拦拦,共放过 10 次
4 个进程:放放放放放放放放放放放放,共放过 12 次
```

进程数是几,实际限额就接近原来的几倍,每个进程都认为「我这里才 5 次」。Day 675 实测放过了 8 次而不是 10 次,是因为真实请求不是严格轮流分配的,有的进程分到得多、有的少。修法 Day 675 讲过两条:演示站只跑一个进程(`fly scale count 1`,systemd 不开 workers),或者把计数放进所有进程共享的地方,比如 Redis。

</details>

**练习 4:有人把 `quantize` 换成了 `round()`,现有用例抓得到吗?** 写一个用 `round(x, 2)` 舍入的候选版本,先用小项目原来的 4 条用例跑回归,再补一条能抓住它的用例。

<details><summary>参考答案</summary>

先想一下该补什么样的用例。`round()` 对 Decimal 是逢五取偶,它和四舍五入只在**正好落在半分上**的时候不同。所以要找一个「整月价 × 剩余天数 / 周期天数」末位正好是 5 的组合:99.99 × 5 / 30 = 16.665,四舍五入是 16.67,逢五取偶是 16.66。剩 5 天、周期 30 天,就是 6 月 30 日升级。

```python
# billsleuth/scratch/ex4_round_candidate.py  练习 4:有人把 quantize 换成 round(),现有用例抓得到吗
from datetime import date
from decimal import Decimal

from review97 import CASES, baseline, regressions, run_batch


def net_round(s: dict) -> Decimal:
    left, days = (s["end"] - s["change"]).days, (s["end"] - s["start"]).days
    return round(Decimal(s["new"]) * left / days, 2) - round(Decimal(s["old"]) * left / days, 2)


new_case = {"id": "half-cent", "snapshot": {"start": date(2026, 6, 5), "end": date(2026, 7, 5), "change": date(2026, 6, 30),
                                            "old": "0.00", "new": "99.99"}, "expect": {"net_equals": "16.67"}}

print("只用原来 4 条:", regressions(run_batch(baseline, 1), run_batch(net_round, 1)))
CASES.append(new_case)
print("加上 half-cent:", regressions(run_batch(baseline, 1), run_batch(net_round, 1)))
```

<div class="line-notes">

- `def net_round(s: dict) -> Decimal:` 候选版:分母是对的,只是舍入改成了 `round(..., 2)`。它的签名和 `Version` 一致,所以能直接交给 `run_batch`。
- `round(Decimal(s["new"]) * left / days, 2)` 对 Decimal 调 `round` 返回的还是 Decimal,但用的是默认的逢五取偶。
- `new_case = {"id": "half-cent"` 新用例。旧套餐写 `0.00`,让净额就等于新套餐那一行,答案好验证。期望 16.67 是手算的:99.99 × 5 / 30 = 16.665,逢半进一。
- `run_batch(baseline, 1)` 这里不包 `flaky`,没有超时干扰,每条只跑 1 次就够了,舍入是确定性的。
- `CASES.append(new_case)` 往 `review97` 模块里的那个列表追加。`run_batch` 读的就是这个列表对象,所以追加以后下一次调用会带上新用例。模块级的列表是共享的,这个写法在练习里方便,正式代码里别这么改别人模块的全局变量。

</div>

```text
只用原来 4 条: []
加上 half-cent: ["half-cent: ['pass'] -> ['fail:16.66']"]
```

原来 4 条用例全部放行了这个改动,因为它们没有一条落在半分上。补了一条专门构造的用例,立刻抓到。评测集的覆盖面不是条数决定的,是**每条用例瞄准了哪一种错**决定的。BillSleuth 后面造场景时,12 类根因每类都要有专门针对它的场景,道理一样。

</details>

**验收标准:** 合上文章能画出知识地图的三段和每段留下的文件;`check_recall_prorate.py` 输出 `比了 732 组,不一致 0 组`;`check_recall_release.py` 输出 `9/9 通过`,并能解释换成 `\s` 时为什么是「该过的」两条失败;`review97.py` 报出 3 条回归,能说清为什么 6 月那条不在里面;四道练习都跑出和上面一致的输出。

## 名词解释

今天没有新术语。下面是本周出现过、复习时最容易混的几个,每个都链回首次出现的那一天。

| 名词 | 意思 |
| --- | --- |
| 步级用例 | 从某次运行的第 N 步开始重跑的评测用例,前面的状态冻结在快照里([Day 672](/blog/agent-zero/day-672-loupe-eval-1/)) |
| 快照 | 用例自带的一份完整输入(messages、tools、工具结果),原运行删了也能跑([Day 672](/blog/agent-zero/day-672-loupe-eval-1/)) |
| 基础设施错误 | 模型服务 5xx、限流 429、超时这类不是被测对象造成的失败,不进通过率([Day 673](/blog/agent-zero/day-673-loupe-eval-2/)) |
| pass^k | 同一条用例跑 k 次全部通过的比例,衡量稳定性([Day 344](/blog/agent-zero/day-344-eval-concepts/),Day 673 再用) |
| 回归 | 基线里好的用例,在新版本里变差了 |
| 滑动窗口限流 | 只数最近一段时间内的请求,不按整点清零([Day 674](/blog/agent-zero/day-674-loupe-deploy-1/)) |
| SPA 回退 | 静态托管对找不到的路径返回首页,交给前端路由([Day 675](/blog/agent-zero/day-675-loupe-deploy-2/)) |
| ADR | 架构决策记录,写选了什么、放弃了什么、代价是什么([Day 640](/blog/agent-zero/day-640-design-docs-1/),Day 676 再用) |
| 左闭右开 | 区间含起点不含终点,计费周期 `[period_start, period_end)`([Day 677](/blog/agent-zero/day-677-bs-why/)) |
| 按天折算 | 周期中途改配置,按剩余天数退旧收新([Day 677](/blog/agent-zero/day-677-bs-why/)) |
| 参照算法 | 检查默写或重构时,用一种完全不同的实现独立算一遍,逐个比结果(今天的 `prorate_cents`) |

## 常见误区

**拿被测代码的输出当期望值。** 小项目的期望值全是手算的。如果先跑一遍基线、把结果抄进 `expect`,基线本身有 bug 也会被当成标准答案,以后改对了反而报回归。

**检查脚本只喂「该拦的」输入。** `\s*` 那一版拦住了有空格子的表,看起来没问题;是「填满的表也报」这条该过的输入暴露了它。每条规则配一对输入。

**默写完和原文逐字对照。** 写法不同不代表错,写法一样也可能是背下来没懂。换一种算法在几百组输入上对结果,比逐字对照可靠。

**把超时算进失败率。** 一个完全正确的函数在 20% 超时下只有 75%,两个版本谁超时少谁占便宜。超时单独记账,有限次重试。

**以为 pass^k 跟通过率差不多。** 基线没重试时通过率 9/9,pass^k 却只有 1/1 条用例可算,信息量完全不同。看 pass^k 要先看分母是几。

**真失败也重试。** 重试只给基础设施错误。对 `fail` 重试等于让一个不稳定的版本多掷几次骰子,直到掷出通过。

**用例条数多就以为覆盖够了。** 4 条用例全部放过了 `round()` 版本,1 条瞄准半分的用例就抓住了它。

**限流计数放在进程内存里还开多个 worker。** 几个进程就差不多是几倍限额。演示站只跑一个进程,或者换成共享存储。

## 学习资料

### 文档与文章

- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):Day 672 说的「先看数据,把真实失败变成测试」就出自这篇的思路,复习时重读「Level 1: Unit Tests」那一段,20 分钟。
- [τ-bench 论文(arXiv 2406.12045)](https://arxiv.org/abs/2406.12045):pass^k 的出处,看摘要和正文里 pass^k 的定义就够,15 分钟。
- [Cloudflare Pages · Redirects](https://developers.cloudflare.com/pages/configuration/redirects/):Day 675 那条被静默忽略的规则,看文档里对 `_redirects` 匹配和死循环的说明,10 分钟。
- [Uvicorn · Settings](https://uvicorn.dev/settings/):找 `--proxy-headers` 和 `--forwarded-allow-ips` 两项,对照 Day 675 的坑,5 分钟。
- [Python 文档 · re](https://docs.python.org/zh-cn/3.12/library/re.html):看「正则表达式语法」里 `\s` 和 `\b` 的定义,中文,10 分钟。
- [Python 文档 · decimal](https://docs.python.org/zh-cn/3.12/library/decimal.html):把舍入模式那张表再看一遍,明后两天还要用,中文,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1k4HZ6xEHR&autoplay=0&high_quality=1" title="一口气学会AI Agent可观测性与Evals/LLM Ops/Tracing/成本追踪/开源实测" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>肖恩君Sean · 一口气学会AI Agent可观测性与Evals/LLM Ops/Tracing/成本追踪/开源实测 · 21 分钟,2026 年 10 月的视频,把 tracing、评测、成本放在一起讲,正好对应 Loupe 这几周做的东西,复习时当总览看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1BH4y1g7ad&autoplay=0&high_quality=1" title="动画学Redis分布式限流算法，面试必考，令牌桶、漏桶、计数器、滑动窗口你学会了吗？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>熊老板i · 动画学Redis分布式限流算法,面试必考,令牌桶、漏桶、计数器、滑动窗口你学会了吗? · 10 分钟,用动画对比四种限流算法,看完能讲清 Day 674 为什么选滑动窗口、练习 3 为什么最后要上 Redis。</figcaption>
</figure>

- Web3天空之城《为什么AI评估是产品构建者最热门的新技能 | Hamel Husain & Shreya Shankar [附文稿]》(BV1WPnuzPEzD,106 分钟):评测领域两位作者的长访谈中文字幕版,有空当播客听。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hd-LmPwfrVc" title="Turn Flagged Traces Into a Dataset in 3 Minutes with the LangSmith CLI" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Turn Flagged Traces Into a Dataset in 3 Minutes with the LangSmith CLI · 4 分钟,官方演示把标记过的 trace 变成评测数据集,和 Loupe「存成用例」按钮是同一个想法,看看商业工具怎么做。</figcaption>
</figure>

- ArjanCodes《Representing Monetary Values in Python》(YouTube `0kzjD6jvfnk`):float、整数分、Decimal 三种表示金额的方式,今天的参照算法用的就是「整数分」那一种。

### 书籍

- Martin Fowler《Patterns of Enterprise Application Architecture》(Addison-Wesley, 2002):Day 677 推荐过的 Money 一节,今天做完默写一再读,会更明白为什么书里强调「分摊时除不尽的分要有规则」。
- Michael Feathers《Working Effectively with Legacy Code》(Prentice Hall, 2004;人民邮电出版社有中译本《修改代码的艺术》):第 13 章讲 characterization test(先用测试把现有行为钉住再改)。今天的「参照算法逐个对比」和它是一个思路,只是对照物换成了另一种实现。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看它怎么在同一个任务上跑多次、怎么汇总 pass^k,和小项目的 `summarize` 对照。
- [getlago/lago](https://github.com/getlago/lago):明天开始写 BillSleuth 的 PRD 和表结构,可以先翻翻它的 README 和数据模型,看一个真实的开源计费系统分了哪些模块。

## 自测

1. 为什么评测用例要存快照,而不是只存 `(run_id, step_idx)`?说出两条理由。

<details><summary>答案</summary>

原运行会被清理(演示站定期清理,trace 平台通常只留 30 到 90 天),用例的寿命比 trace 长得多;原运行可能被重新导入或修改,用例的含义就悄悄变了,用例应该是不可变的;快照还能单独脱敏,不影响原运行的排查。任意两条都算对。

</details>

2. 小项目里基线没重试时 pass^k 是 1/1,重试后是 4/4。为什么前一个数几乎没有信息量?

<details><summary>答案</summary>

pass^k 只算 k 次都真正跑完的用例。20% 超时下,四条用例里三条都碰上过一次超时,只剩一条可算,分母是 1。一个分母为 1 的比例说明不了「这个版本稳不稳」。重试以后四条都跑完了,分母回到 4,才能和候选版的 1/4 比较。看 pass^k 先看分母。

</details>

3. 默写 `prorate` 时先算日价再乘天数,为什么 6 月的例子看不出错,检查脚本却报了 546 组不一致?

<details><summary>答案</summary>

6 月例子的整月价 117、周期 30 天,117 / 30 = 3.9 正好除尽,先算日价没有舍入误差。换成 28 天,117 / 28 = 4.178…,舍成 4.18,再乘 4 天得 16.72,而正确的 117 × 4 / 28 = 16.714… 舍入是 16.71。舍入误差被天数放大了。只有在大量不同的价格和周期组合上比,才能暴露这种只在部分输入上出现的错。

</details>

4. 检查脚本 `has_empty_cell` 为什么用 `[ \t]*` 而不是 `\s*`?怎么写测试才能抓住这个错?

<details><summary>答案</summary>

`\s` 包括换行,表格上一行末尾的 `|`、换行符、下一行开头的 `|` 会被当成一个空格子,任何有两行以上的表都会被报。抓住它要用「应该通过」的输入:一张完全填满的表,期望不报。只用「应该拦住」的输入测,`\s*` 版本也能通过。

</details>

5. 面试题:面试官问「你说你的 Agent 评测通过率从 70% 提到了 90%,你怎么确定这不是噪声?」结合本周的内容回答。

<details><summary>答案</summary>

先说数字怎么来的,再说怎么排除噪声。第一,通过率的分母里排除了基础设施错误:模型服务 5xx、429、超时单独记账、有限次重试,比例太高的批次整批重跑,不然服务商忙的那几分钟就能让任何版本看起来变差或变好。第二,每条用例跑 k 次,同时报 pass^k,区分「每条都不太稳」和「少数几条总是挂」。第三,不只看总数,看逐条回归:哪几条从好变坏、哪几条从坏变好,打开变化的那几条 trace 看具体原因,确认改进来自我改的那个地方。第四,样本量:一条用例三次分不出两个版本,用例要够多,而且每条瞄准一种具体的失败;条数够了再用置信区间判断差异是否显著。最后补一句,用例的期望值是手工定的或来自独立的标准答案,不是拿某个版本跑出来抄进去的。

</details>

## 明天预告

明天是 Day 679 · BillSleuth 开题(二):客户会问的问题,PRD、架构、排期、指标。Day 677 只讲了计费周期和折算,明天先补优惠券、税和贷记单三个名词,然后把客户的抱怨整理成 13 类根因,写一页 PRD(非目标比功能清单更重要),画架构图,排出 Day 680 到 Day 701 的进度,在开工前就把六个验收指标定死。今天小项目里「期望值手算、基础设施错误单独算、pass^k」这几条,明天会原样写进 PRD 的验收指标。
