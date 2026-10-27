---
title: 'Day 517 · 第 74 周复习:求职(Day 511–516)'
description: '这一周讲了渠道和薪资口径、海外远程和 FDE、谈薪避坑和投递漏斗、行业迁移、普通篇自检。今天不加新概念:画一张本周知识地图,计时默写年包折算、offer 拆分、自检判定三个函数并用判卷脚本打分,再把整周的脚本拼成一份求职周报:岗位筛选、薪资、offer 对比、投递漏斗、能力自检,一个命令出一页。'
pubDate: 2026-10-27
regime: none
tags: ['job-search', 'review', 'salary', 'funnel', 'agent-zero']
series: 'agent-zero'
day: 517
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 516](/blog/agent-zero/day-516-basic-graduation/) 是普通篇的结业。九个部分各留给你一个产出,你写了 `selfcheck.py`,让每个「会」都得指到一个真实的文件或链接,又写了 `jd_match.py` 拿一条虚构的 JD 逐条对照,分出有证据、证据不足、没证据和课程没覆盖四类。

这一周六天的内容是连着的。[Day 511](/blog/agent-zero/day-511-job-channels/) 到 [Day 513](/blog/agent-zero/day-513-offer/) 讲怎么找岗位、能拿多少、投出去以后怎么走;[Day 514](/blog/agent-zero/day-514-industry-1/) 和 [Day 515](/blog/agent-zero/day-515-industry-2/) 讲岗位不全是 SaaS 客服,换行业要换什么;昨天把这一切收成一张自检表。今天把它们再过一遍,确认你能不看文章把核心的东西拿出来,然后拼成一份每周能跑一次的「求职周报」。

## 今天要解决的问题

复习日不学新东西,目标是确认这一周的东西你能不看文章拿出来。今天结束时你应该能:

1. 不看文章,说出这一周每天的核心产出:哪个脚本、哪个数字、防的是哪种错。
2. 关掉 AI 补全,计时默写三个函数:`annual_mid`(挂牌薪资折年包)、`breakdown`(offer 拆成现金、公积金、期权期望)、`judge`(自检的打勾规则),用判卷脚本 `check_week74` 打到 11/11。
3. 跑通本周小项目 `part09/review/weekly.py`:一份求职周报,把岗位筛选、薪资、offer 对比、投递漏斗、能力自检拼成一页。
4. 说得出这一周最隐蔽的几个坑:CSV 里的逗号把列挤歪、样本小的时候报警靠不住、关键词太泛导致误匹配、规则命中不等于有问题。

预计用时 3–4 小时,大头在默写和周报。前置:[Day 511](/blog/agent-zero/day-511-job-channels/) 到 [Day 516](/blog/agent-zero/day-516-basic-graduation/) 全部,尤其是 `salary.py`、`offer.py`、`funnel.py`、`red_flags.py` 和昨天的 `selfcheck.py`。今天不调模型,花费 ¥0。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="第 74 周知识地图:左边六天按先后分成找岗位、算清楚、换行业、自检,右边汇入今天的周报 weekly.py">
  <rect x="0" y="0" width="640" height="320" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">从「去哪找」到「我准备好了没」,六天一条线</text>
  <rect x="20" y="40" width="130" height="66" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="28" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">511 渠道与薪资</text>
  <text x="28" y="78" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">annual_mid</text>
  <text x="28" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">中位数 / 口径</text>
  <rect x="160" y="40" width="130" height="66" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="168" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">512 远程与 FDE</text>
  <text x="168" y="78" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">classify</text>
  <text x="168" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">公开接口 / 规则</text>
  <rect x="300" y="40" width="130" height="66" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="308" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">513 谈薪避坑漏斗</text>
  <text x="308" y="78" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">breakdown / flags</text>
  <text x="308" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">funnel / MIN_N</text>
  <rect x="20" y="128" width="130" height="66" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="28" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">514 行业五项</text>
  <text x="28" y="166" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">IndustryProfile</text>
  <text x="28" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">validate</text>
  <rect x="160" y="128" width="130" height="66" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="168" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">515 四个行业</text>
  <text x="168" y="166" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">四个小演示</text>
  <text x="168" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">迁移讲稿</text>
  <rect x="300" y="128" width="130" height="66" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="308" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">516 普通篇自检</text>
  <text x="308" y="166" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">judge / jd_match</text>
  <text x="308" y="182" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">证据四档</text>
  <rect x="470" y="70" width="150" height="110" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="480" y="92" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">517 weekly.py</text>
  <text x="480" y="114" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">① 岗位筛选</text>
  <text x="480" y="130" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">② 薪资 ③ offer</text>
  <text x="480" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">④ 漏斗 ⑤ 自检</text>
  <text x="480" y="166" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">⑥ 下周做什么</text>
  <line x1="430" y1="73" x2="470" y2="105" stroke="var(--ink-faint)"/>
  <line x1="430" y1="161" x2="470" y2="140" stroke="var(--ink-faint)"/>
  <text x="20" y="232" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">本周共同的教训:数字要问口径,样本小别下结论,规则命中只是线索。</text>
  <text x="20" y="252" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">年包中位 vs 平均;回复率 5/40 但二面只有 4 个样本;医疗准确率 95% 召回率 0;</text>
  <text x="20" y="272" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">自检 15/16 改规则后 0/16;JD 8 条里 1 条课程没覆盖。</text>
</svg>
<figcaption>本周六天:蓝色三天是「找岗位和算清楚」,琥珀色三天是「换行业和自检」,右边是今天把它们串起来的周报。底部三行是这一周反复出现的同一件事:任何一个数字,先问它是怎么来的。</figcaption>
</figure>

这张图底部那几个数是我最想让你记住的。这一周每个结论背后都有一个「看着对、其实不对」的数字:平均数被少数高薪岗拉高,中位数才是中间那个人;回复率 12% 看着低,但二面那一步分母只有 4,这时候说「我二面过不了」站不住;医疗模型准确率 95%,召回率却是 0,一条真风险都没抓到;自检表第一版 16 项勾了 15 项,换成「要有证据」的规则以后一项都勾不上。面试官和招聘方追问的,恰恰是这些地方。

## 本周每天一句话

[Day 511](/blog/agent-zero/day-511-job-channels/):渠道和薪资口径。`annual_mid` 把「30-60K·16薪」折成年包中点 72 万,「面议」「150-200元/天」认不出就返回 `None`,不崩也不乱猜;中位数、P25、P75 比平均数诚实,因为高薪岗位少而高,会一直往上拽平均数;挂牌价不是成交价。

[Day 512](/blog/agent-zero/day-512-remote-fde/):海外远程和 FDE。用 `httpx` 调 Ashby 公开的职位接口,抓下 104 条标了「远程」的 FDE 类岗位,用规则判断范围,不排除中国的只剩 1 条;FDE 比普通 Agent 工程师多出面向客户和出差,适合什么样的人要自己想清楚。

[Day 513](/blog/agent-zero/day-513-offer/):面试流程、谈薪、避坑和漏斗。`Offer` 加 `breakdown` 把一个 offer 拆成现金、公积金、期权期望三类钱,`__post_init__` 把 `hf_rate=12` 这种手滑拦在门口;一组正则筛培训贷这类坑,但命中只是线索;漏斗 `funnel.py` 在分母小于 5 的那一步拒绝下结论,状态写成「已拒绝」会被报出是第几行。

[Day 514](/blog/agent-zero/day-514-industry-1/):行业分布和换行业的五样东西。数 JD 里提到哪些行业,抽样发现统计里有四分之一到三成是误判(福利里的「补充医疗保险」被当成了金融);`IndustryProfile` 的 `validate` 专门拦「红线只写在提示词里」。

[Day 515](/blog/agent-zero/day-515-industry-2/):四个行业各一个演示。客服里换一种「什么算解决」的定义,解决率从 75% 掉到 50%;金融里回答里的每个数字都要在工具返回里找得到;医疗里准确率 95% 的模型召回率可以是 0;电商里 `search` 不传店铺参数就根本调不通。

[Day 516](/blog/agent-zero/day-516-basic-graduation/):普通篇结业。自检脚本把「证据」分成文件、链接、数字、无四档,同一份「做过」的证据文件在第一版是 15/16,在第二版是 0/16;`jd_match` 对一条虚构的 JD 逐条打分,4/8 有证据,其中一条(K8s 和 Terraform)是课程没讲的。

哪一句读着觉得「好像是这样,但说不清为什么」,先回那一天把对应小节重看一遍,再往下。

## 准备环境

今天的代码放在 `agent-zero-lab/part09/review/`,和 [Day 510](/blog/agent-zero/day-510-week73-review/) 的复习文件同目录。先确认本周需要的文件都在:

```bash
cd agent-zero-lab
for f in jobs/salary.py jobs/offer.py jobs/red_flags.py jobs/flag_samples.py jobs/funnel.py jobs/funnel_log.csv grad/caps.py grad/selfcheck.py grad/jd_match.py; do [ -e part09/$f ] && echo "有 $f" || echo "缺 $f"; done
```

```text
有 jobs/salary.py
有 jobs/offer.py
有 jobs/red_flags.py
有 jobs/flag_samples.py
有 jobs/funnel.py
有 jobs/funnel_log.csv
有 grad/caps.py
有 grad/selfcheck.py
有 grad/jd_match.py
```

`[ -e 路径 ] && A || B` 是 [Day 503](/blog/agent-zero/day-503-week72-review/) 用过的写法:路径存在就做 A,否则做 B。我只列了今天要 `import` 的九个文件,[Day 512](/blog/agent-zero/day-512-remote-fde/) 的 `ashby.py`、`remote_scope.py` 和 [Day 514](/blog/agent-zero/day-514-industry-1/)、[Day 515](/blog/agent-zero/day-515-industry-2/) 的 `industry/` 下面的文件今天用不到,但你的仓库里也应该有。有缺的先回那一天补。

还要有两样东西在 `agent-zero-lab` 旁边:昨天的 `me/evidence.json`(小林的证据文件,放在文章里了)和 `me/` 下面那十几个文件。你用自己的仓库就把路径换成自己的。另外 `README.md` 要在仓库根目录里,`uv init` 默认会建一个,下面的判卷脚本要拿它当「一个真实存在的文件」用。

## 默写:三个函数

### 判卷脚本

跟 [Day 507](/blog/agent-zero/day-507-live-coding/) 和 [Day 510](/blog/agent-zero/day-510-week73-review/) 一样先放判卷脚本。这次三个函数放在同一个模块里默写,判卷脚本对一个模块名跑十一条用例:

```python
# agent-zero-lab/part09/review/check_week74.py
import importlib
import sys
from collections.abc import Callable


def mod_of(name: str):
    return importlib.import_module(name)


def run_cases(cases: list[tuple[str, Callable[[], bool]]]) -> int:
    ok = 0
    for name, fn in cases:
        try:
            passed = fn()
            detail = ""
        except Exception as e:  # 用例自己崩了也要报出来,不能让整个脚本停
            passed, detail = False, f"  {type(e).__name__}: {e}"
        ok += passed
        print(f"{'PASS' if passed else 'FAIL'}  {name}{detail}")
    print(f"{ok}/{len(cases)}")
    return ok


def close(a, b, eps=1e-6) -> bool:
    return a is not None and abs(a - b) < eps


def cases_for(m) -> list[tuple[str, Callable[[], bool]]]:
    return [
        ("annual_mid 16 薪", lambda: close(m.annual_mid("30-60K·16薪"), 72.0)),
        ("annual_mid 不写薪数按 12", lambda: close(m.annual_mid("6-10K"), 9.6)),
        ("annual_mid 单位是万", lambda: close(m.annual_mid("1.5-2.5万"), 24.0)),
        ("annual_mid 面议返回 None", lambda: m.annual_mid("面议") is None),
        ("annual_mid 日薪返回 None", lambda: m.annual_mid("150-200元/天") is None),
        ("breakdown 试用期扣钱", lambda: close(m.breakdown(m.Offer("B", monthly=45000, probation_months=3, probation_ratio=0.7, equity_grant=1_000_000))["现金"], 499500.0)),
        ("breakdown 期权按概率和年限折", lambda: close(m.breakdown(m.Offer("B", monthly=45000, equity_grant=1_000_000))["期权期望"], 50000.0)),
        ("breakdown 公积金默认按月薪", lambda: close(m.breakdown(m.Offer("A", monthly=40000, hf_rate=0.12))["公积金"], 57600.0)),
        ("judge 4 分加文件才勾", lambda: m.judge({"score": 4, "evidence": "README.md"}, m.ROOT)[0] == "x"),
        ("judge 3 分只给问号", lambda: m.judge({"score": 3, "evidence": "README.md"}, m.ROOT)[0] == "?"),
        ("judge 没证据一律叉,哪怕 5 分", lambda: m.judge({"score": 5, "evidence": "做过"}, m.ROOT)[0] == " "),
    ]


if __name__ == "__main__":
    run_cases(cases_for(mod_of(sys.argv[1])))
```

<div class="line-notes">

- `def mod_of(name: str):` 按字符串导入一个模块。`importlib.import_module("part09.review.mine74")` 相当于 JS 里的动态 `import()`。这样判卷脚本可以对你写的任何一个文件跑,不用改代码。
- `def run_cases(cases: list[tuple[str, Callable[[], bool]]]) -> int:` 参数是「用例名加一个无参函数」的列表。把用例写成函数而不是写成值,是 [Day 510](/blog/agent-zero/day-510-week73-review/) 踩过的坑:写成值的话,函数名写错时整个脚本在构造用例的那一刻就崩了,一条也跑不了。
- `passed = fn()` 真正调你写的函数是在这里,放在 `try` 里面。
- `except Exception as e:  # 用例自己崩了也要报出来,不能让整个脚本停` 用例抛异常算这一条失败,把异常类型和消息贴在后面,然后继续跑下一条。
- `ok += passed` 布尔值直接加到整数上。
- `print(f"{'PASS' if passed else 'FAIL'}  {name}{detail}")` `detail` 是空字符串或者异常信息。
- `def close(a, b, eps=1e-6) -> bool:` 浮点数不能用 `==` 比,比的是差的绝对值小不小。
- `return a is not None and abs(a - b) < eps` 先判断不是 `None`,否则 `abs(None - 72.0)` 会抛 `TypeError`。
- `("annual_mid 16 薪", lambda: close(m.annual_mid("30-60K·16薪"), 72.0)),` 一条用例:`lambda:` 是没有参数的匿名函数,和 JS 的 `() => ...` 一个意思。(30000 + 60000) ÷ 2 × 16 ÷ 10000 = 72.0。
- `("annual_mid 面议返回 None", lambda: m.annual_mid("面议") is None),` 认不出就返回 `None`,不抛异常。
- `("breakdown 试用期扣钱"` 这条用 [Day 513](/blog/agent-zero/day-513-offer/) 的 B 创业公司:月薪 45000,试用期 3 个月拿 70%,现金应该是 45000 × 12 − 45000 × 0.3 × 3 = 499500。
- `("judge 没证据一律叉,哪怕 5 分"` 这是昨天那条规矩:证据栏只有「做过」,自评 5 分也得到空格(叉)。
- `run_cases(cases_for(mod_of(sys.argv[1])))` 模块名从命令行传。

</div>

用 `README.md` 当「一定存在的文件」是为了判卷脚本不依赖你的其他文件。`judge` 的两条用例会在当前目录(仓库根目录)里找它。

### 第一次默写

计时 15 分钟,关掉 AI 补全,只看判卷脚本和上面的一句话说明,不看文章,新建 `part09/review/mine74.py`,写三个函数:`annual_mid(s)`、`breakdown(o)`(还要有 `Offer` 这个 `dataclass`,字段名和 [Day 513](/blog/agent-zero/day-513-offer/) 一致)、`judge(entry, root)`。

下面是一份典型的第一次默写稿。我故意按这类默写最常出的错来写,不是我自己真默写出来的:

```python
# agent-zero-lab/part09/review/mine74.py  (默写稿,第一次)
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(".")


def annual_mid(s):
    lo, hi = s.split("-")
    unit = hi[-1]
    months = 12
    if "薪" in s:
        months = int(s.split("·")[1][:-1])
    lo = float(lo)
    hi = float(hi.split("·")[0][:-1])
    return (lo + hi) / 2 * months / 10


@dataclass
class Offer:
    name: str
    monthly: float
    months: int = 12
    bonus: float = 0.0
    signing: float = 0.0
    hf_rate: float = 0.0
    hf_base: float = 0.0
    equity_grant: float = 0.0
    vest_years: int = 4
    equity_prob: float = 0.2
    probation_months: int = 0
    probation_ratio: float = 1.0


def breakdown(o):
    cash = o.monthly * o.months + o.bonus + o.signing + o.monthly * (1 - o.probation_ratio) * o.probation_months
    hf = o.hf_base * o.hf_rate * 12
    equity = o.equity_grant * o.equity_prob / o.vest_years
    return {"现金": cash, "公积金": hf, "期权期望": equity, "合计": cash + hf + equity}


def judge(entry, root):
    ev = entry.get("evidence", "")
    ok_file = any((root / w).is_file() for w in ev.split())
    if ok_file and entry.get("score", 0) > 4:
        return "x", "文件"
    if ev:
        return "?", "无"
    return " ", "无"
```

用判卷脚本跑:

```bash
uv run python -m part09.review.check_week74 part09.review.mine74_try1
```

```text
PASS  annual_mid 16 薪
PASS  annual_mid 不写薪数按 12
FAIL  annual_mid 单位是万
FAIL  annual_mid 面议返回 None  ValueError: not enough values to unpack (expected 2, got 1)
FAIL  annual_mid 日薪返回 None  ValueError: could not convert string to float: '200元/'
FAIL  breakdown 试用期扣钱
PASS  breakdown 期权按概率和年限折
FAIL  breakdown 公积金默认按月薪
FAIL  judge 4 分加文件才勾
PASS  judge 3 分只给问号
FAIL  judge 没证据一律叉,哪怕 5 分
4/11
```

4/11。七条失败背后是五个错。

**一,把 K 当成唯一的单位。** `annual_mid("30-60K·16薪")` 能过,是因为这份默写稿的最后一步写成了 `/ 10`:K 是 1000,除以 10000 就是除以 10 再乘 1000,碰巧对。到了「1.5-2.5万」,`hi[-1]` 取出来的 `万` 根本没参与换算,结果是 2.4 不是 24。[Day 511](/blog/agent-zero/day-511-job-channels/) 的最终版用 `UNIT` 字典把 K、k、万 各自对应到数字,就是为了不靠巧合。

**二,认不出的写法直接崩。** 「面议」没有 `-`,`s.split("-")` 只得到一段,解包成两个变量时抛 `ValueError: not enough values to unpack (expected 2, got 1)`。「150-200元/天」更好玩,它有 `-`,切完以后 `hi.split("·")[0][:-1]` 得到 `'200元/'`,再 `float(...)` 就是 `ValueError: could not convert string to float: '200元/'`。这两个都是「没想过会有这种输入」。[Day 511](/blog/agent-zero/day-511-job-channels/) 用一条整串匹配的正则,不匹配就返回 `None`。

**三,试用期扣钱的符号写反。** `cash = ... + o.monthly * (1 - o.probation_ratio) * o.probation_months` 这里应该是减号:试用期拿 70%,是少拿 30%。写成加号,现金变成 58.05 万而不是 49.95 万,多出 8 万多,而且不报错。这就是 [Day 513](/blog/agent-zero/day-513-offer/) 说的「数字离谱但程序不崩」。

**四,公积金基数没填就乘 0。** `hf = o.hf_base * o.hf_rate * 12` 里 `hf_base` 默认是 0,A 大厂只填了比例没填基数,公积金就算成 0。[Day 513](/blog/agent-zero/day-513-offer/) 的写法是 `(o.hf_base or o.monthly)`:没填基数就按月薪。

**五,打勾的边界。** `judge` 里写成了 `score > 4`,自评恰好 4 分的打不上勾;「没证据」那条用例也失败了,因为只要证据字符串非空就进了 `?` 分支,「做过」两个字照样能拿到问号。昨天的规矩是:能核对的才算证据。

### 改完以后

改法写在下面,跟 [Day 510](/blog/agent-zero/day-510-week73-review/) 一样,只列改动的地方在注释里,完整的文件贴出来:

```python
# agent-zero-lab/part09/review/mine74.py  (默写稿,改过以后)
import re
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(".")


PAT = re.compile(r"^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)([Kk万])(?:·(\d+)薪)?$")
UNIT = {"K": 1000, "k": 1000, "万": 10000}


def annual_mid(s):
    m = PAT.match(s.strip())
    if m is None:
        return None
    lo, hi, unit, months = m.groups()
    return (float(lo) + float(hi)) / 2 * UNIT[unit] * int(months or 12) / 10000


@dataclass
class Offer:
    name: str
    monthly: float
    months: int = 12
    bonus: float = 0.0
    signing: float = 0.0
    hf_rate: float = 0.0
    hf_base: float = 0.0
    equity_grant: float = 0.0
    vest_years: int = 4
    equity_prob: float = 0.2
    probation_months: int = 0
    probation_ratio: float = 1.0


def breakdown(o):
    cash = o.monthly * o.months + o.bonus + o.signing - o.monthly * (1 - o.probation_ratio) * o.probation_months
    hf = (o.hf_base or o.monthly) * o.hf_rate * 12
    equity = o.equity_grant * o.equity_prob / o.vest_years
    return {"现金": cash, "公积金": hf, "期权期望": equity, "合计": cash + hf + equity}


PATH_RE = re.compile(r"[\w./-]+\.(?:py|md|json|jsonl|csv|sql|txt)")


def judge(entry, root):
    ev = entry.get("evidence", "")
    if any((root / p).is_file() for p in PATH_RE.findall(ev)):
        return ("x", "文件") if entry.get("score", 0) >= 4 else ("?", "文件")
    if re.search(r"\d", ev):
        return "?", "数字"
    return " ", "无"
```

<div class="line-notes">

- `ROOT = Path(".")` 判卷脚本里 `m.ROOT` 用不到,但留着不碍事;`judge` 的 `root` 参数才是真正起作用的。
- `PAT = re.compile(` 整串匹配的正则,和 [Day 511](/blog/agent-zero/day-511-job-channels/) 的写法一样:`^` 到 `$` 之间必须全部是「数字-数字-单位-可选的·N薪」。正则里的 `(?:...)` 是不捕获的分组,`[Kk万]` 是三选一。
- `return (float(lo) + float(hi)) / 2 * UNIT[unit] * int(months or 12) / 10000` 「1.5-2.5万」:(1.5 + 2.5) ÷ 2 = 2.0,乘 10000 = 20000,乘 12(没写几薪就当 12)= 240000,除以 10000 = 24.0。`months or 12`:`months` 是 `None` 或空字符串时用 12。
- `cash = o.monthly * o.months + o.bonus + o.signing - o.monthly * (1 - o.probation_ratio) * o.probation_months` 改了符号。B 创业公司:540000 减 40500 等于 499500。
- `hf = (o.hf_base or o.monthly) * o.hf_rate * 12` `hf_base` 是 0(没填)时用月薪。A 大厂如果不填基数,40000 × 0.12 × 12 = 57600,判卷里那条「公积金默认按月薪」要的就是这个数。
- `def judge(entry, root):` 返回 `(记号, 档位)`。这份默写版少了「链接」那一档,只留文件和数字,够过判卷;完整版是昨天的 `selfcheck.py`。
- `if any((root / p).is_file() for p in PATH_RE.findall(ev)):` 先从证据字符串里抽出像文件名的片段,有一个真在磁盘上就算文件。
- `return ("x", "文件") if entry.get("score", 0) >= 4 else ("?", "文件")` 条件表达式写在 `return` 后面,相当于 JS 的三元 `a ? b : c`。注意 `>= 4`。
- `if re.search(r"\d", ev):` 没有文件的话,看有没有数字,有就给问号。「做过」没有数字,走到最后一行返回空格。

</div>

```bash
uv run python -m part09.review.check_week74 part09.review.mine74
```

```text
PASS  annual_mid 16 薪
PASS  annual_mid 不写薪数按 12
PASS  annual_mid 单位是万
PASS  annual_mid 面议返回 None
PASS  annual_mid 日薪返回 None
PASS  breakdown 试用期扣钱
PASS  breakdown 期权按概率和年限折
PASS  breakdown 公积金默认按月薪
PASS  judge 4 分加文件才勾
PASS  judge 3 分只给问号
PASS  judge 没证据一律叉,哪怕 5 分
11/11
```

11/11。过了以后关掉,再默写一遍,这次不看改好的版本。**过得去不等于记得住**,第二天的第二遍比今天的第一遍更重要。

判卷脚本还有一个顺手的用法:对着别的模块跑,看它报什么。把 `part09.jobs.offer`([Day 513](/blog/agent-zero/day-513-offer/) 的模块,没有 `judge` 也没有 `annual_mid`)喂给它:

```text
FAIL  annual_mid 16 薪  AttributeError: module 'part09.jobs.offer' has no attribute 'annual_mid'
FAIL  annual_mid 不写薪数按 12  AttributeError: module 'part09.jobs.offer' has no attribute 'annual_mid'
FAIL  annual_mid 单位是万  AttributeError: module 'part09.jobs.offer' has no attribute 'annual_mid'
FAIL  annual_mid 面议返回 None  AttributeError: module 'part09.jobs.offer' has no attribute 'annual_mid'
FAIL  annual_mid 日薪返回 None  AttributeError: module 'part09.jobs.offer' has no attribute 'annual_mid'
PASS  breakdown 试用期扣钱
PASS  breakdown 期权按概率和年限折
PASS  breakdown 公积金默认按月薪
FAIL  judge 4 分加文件才勾  AttributeError: module 'part09.jobs.offer' has no attribute 'judge'
FAIL  judge 3 分只给问号  AttributeError: module 'part09.jobs.offer' has no attribute 'judge'
FAIL  judge 没证据一律叉,哪怕 5 分  AttributeError: module 'part09.jobs.offer' has no attribute 'judge'
3/11
```

这个模块只有 `breakdown` 和 `Offer`,所以三条 `breakdown` 的用例过了,别的全是 `AttributeError`,每条指出缺的是哪个名字,没有一条把整个脚本弄崩。这是把用例写成函数、再包进 `try` 的好处。

## 本周小项目:一份求职周报

### 先踩一个坑:CSV 里的逗号

周报的输入之一是一份岗位清单,每行一个岗位:公司、岗位名、挂牌薪资、JD 摘要。我编了十条放在 `part09/review/board.csv`(公司和岗位全是虚构的,里面有几条故意写成 [Day 513](/blog/agent-zero/day-513-offer/) 里会被规则标出来的样子)。第一次我是这样存的,JD 摘要里直接用逗号分隔几个关键词:

```csv
公司,岗位,薪资,JD 摘要
星河智能,AI Agent 开发工程师,30-50K·15薪,Python、LangGraph、RAG,评测经验优先,五险一金
```

用 `csv.DictReader` 读第一行:

```bash
uv run python -c "import csv; rows = list(csv.DictReader(open('../board_bad.csv', encoding='utf-8'))); print(rows[0])"
```

```text
{'公司': '星河智能', '岗位': 'AI Agent 开发工程师', '薪资': '30-50K·15薪', 'JD 摘要': 'Python、LangGraph、RAG', None: ['评测经验优先', '五险一金']}
```

注意末尾那个键是 `None`:JD 摘要只拿到了「Python、LangGraph、RAG」,后面的「评测经验优先」「五险一金」被挤出了列,统统塞进了一个键为 `None` 的列表里。`DictReader` 不报错,只是悄悄把多出来的字段放到这里。如果你这时直接用 `r['JD 摘要']` 去过避坑规则,等于拿一半的文字去匹配,漏报没有任何提示。

修法是 CSV 的标准做法:**含逗号的字段用双引号整个括起来**。

```csv
公司,岗位,薪资,JD 摘要
星河智能,AI Agent 开发工程师,30-50K·15薪,"Python、LangGraph、RAG,评测经验优先,五险一金"
云岚科技,Agent 平台工程师,35-60K·16薪,"Go 或 Python,模型网关,可观测,试用期 3 个月,薪资 80%"
北辰数据,大模型应用工程师,25-40K,"RAG、评测集、FastAPI"
青禾软件,智能体工程师(零基础可入职),8-15K,"先培训后上岗,从工资中分期扣除,包就业"
远山AI,Agent 工程师(远程),2-3万,"Python,远程办公;入职需缴纳设备押金 1000 元"
明湖科技,AI 工程师,面议,"Python、提示词、结构化输出"
速达服务,AI Agent 训练师,12-18K,"整理对话数据、标注、审核输出,需熟悉 Excel"
知行学堂,AI 应用开发,150-200元/天,"实习,Python"
海棠网络,大模型应用开发(派遣),20-30K·13薪,"用人单位:某人力资源有限公司,驻场,需 Python、LangChain"
烛光智能,Agent 后端工程师,28-45K·14薪,"Python、FastAPI、PostgreSQL、MCP,评测与上线经验优先"
```

后面所有脚本都读这份。

### 拼周报

周报用到的零件:

| 零件 | 来自 | 在 `weekly.py` 里用在哪 |
| --- | --- | --- |
| `annual_mid` | [Day 511](/blog/agent-zero/day-511-job-channels/) | `salary_line`:把剩下的岗位折成年包 |
| `statistics.quantiles` | [Day 511](/blog/agent-zero/day-511-job-channels/) | `salary_line`:中位和分位数 |
| `flags` | [Day 513](/blog/agent-zero/day-513-offer/) | `screen`:避坑规则筛一遍 |
| `Offer`、`compare` | [Day 513](/blog/agent-zero/day-513-offer/) | `main` 第 3 步:两个 offer 的对比 |
| `load`、`report`、`MIN_N` | [Day 513](/blog/agent-zero/day-513-offer/) | `main` 第 4 步和 `next_steps`:漏斗 |
| `check`、`gaps` | [Day 516](/blog/agent-zero/day-516-basic-graduation/) | `main` 第 5 步和 `next_steps`:自检和补课顺序 |

```python
# agent-zero-lab/part09/review/weekly.py
import csv
import json
import statistics
import sys
from pathlib import Path

from part09.grad.selfcheck import check, gaps
from part09.jobs.funnel import MIN_N, STAGES, load, report
from part09.jobs.offer import Offer, compare
from part09.jobs.red_flags import flags
from part09.jobs.salary import annual_mid


def screen(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], list[tuple[str, list[str]]]]:
    """把岗位分成「没命中避坑规则」和「命中了」两堆。"""
    keep, dropped = [], []
    for r in rows:
        hit = flags(f"{r['岗位']}。{r['JD 摘要']}")
        if hit:
            dropped.append((r["公司"], hit))
        else:
            keep.append(r)
    return keep, dropped


def salary_line(keep: list[dict[str, str]]) -> str:
    vals = [v for r in keep if (v := annual_mid(r["薪资"])) is not None]
    skipped = len(keep) - len(vals)
    if len(vals) < 4:
        return f"能折年包的只有 {len(vals)} 条,太少,不算分位数:{sorted(round(v, 1) for v in vals)}"
    q1, mid, q3 = statistics.quantiles(vals, n=4)
    return f"n={len(vals)}(另有 {skipped} 条面议或日薪)  中位 {mid:.1f} 万  P25 {q1:.1f}  P75 {q3:.1f}"


def next_steps(reached: dict[str, int], todo: list) -> list[str]:
    steps = []
    n, k = reached["已投"], reached["已回复"]
    if n >= MIN_N and k / n < 0.15:
        steps.append(f"回复率 {k}/{n} 低于 15%:回看 Day 498 到 501 的简历和 Day 511 的渠道")
    for cap, mark, _ in todo[:2]:
        days = "、".join(f"Day {d}" for d in cap.days[:2])
        steps.append(f"自检[{mark}] {cap.name.split('(')[0]}:回看 {days},补出一个文件或链接当证据")
    return steps


def main(board: Path, funnel_log: Path, evidence: Path, root: Path) -> None:
    rows = list(csv.DictReader(board.open(encoding="utf-8-sig", newline="")))
    keep, dropped = screen(rows)
    print(f"== 求职周报 ==\n1) 岗位:{len(rows)} 条,避坑规则标出 {len(dropped)} 条,剩 {len(keep)} 条")
    for company, hit in dropped:
        print(f"     {company}: {'、'.join(hit)}")
    print("2) 薪资(年包中点,万元):" + salary_line(keep))
    print("3) 手里的两个口头 offer:")
    compare(Offer("云岚", monthly=47500, months=16, probation_months=3, probation_ratio=0.8),
            Offer("烛光", monthly=36500, months=14, hf_rate=0.12, hf_base=30000))
    print("4) 投递漏斗:")
    reached = load(funnel_log)
    report(reached)
    mine = json.loads(evidence.read_text(encoding="utf-8"))
    rows_chk = check(mine, root)
    todo = gaps(rows_chk)
    print(f"5) 能力自检:打勾 {sum(1 for _, m, _, _ in rows_chk if m == 'x')}/{len(rows_chk)}")
    print("6) 下周做:")
    for s in next_steps({s: reached[s] for s in STAGES}, todo):
        print("   -", s)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]))
```

<div class="line-notes">

- `def screen(rows: list[dict[str, str]]) -> tuple[list[dict[str, str]], list[tuple[str, list[str]]]]:` 返回两样东西:没被规则标出来的岗位列表,和被标出来的 `(公司, 命中的规则名)` 列表。类型标注很长,读的时候从外往里:一个二元组,左边是「岗位字典的列表」,右边是「(字符串, 字符串列表) 的列表」。
- `hit = flags(f"{r['岗位']}。{r['JD 摘要']}")` 把岗位名和摘要拼成一段文字喂给 [Day 513](/blog/agent-zero/day-513-offer/) 的 `flags`。岗位名一起拼进去,是因为「智能体工程师(零基础可入职)」这类标题本身就是线索。
- `def salary_line(keep: list[dict[str, str]]) -> str:` 把保留下来的岗位折成一行文字。
- `vals = [v for r in keep if (v := annual_mid(r["薪资"])) is not None]` 对每个岗位调 `annual_mid`,海象运算符 `:=` 把结果存进 `v`,不是 `None` 才保留。
- `skipped = len(keep) - len(vals)` 面议和日薪这类折不了的,单独数出来,不悄悄丢掉。
- `if len(vals) < 4:` 少于 4 条不算分位数,只列原值。[Day 511](/blog/agent-zero/day-511-job-channels/) 的 `describe` 同一个规矩。
- `q1, mid, q3 = statistics.quantiles(vals, n=4)` 四等分的三个切点:P25、中位数、P75。
- `def next_steps(reached: dict[str, int], todo: list) -> list[str]:` 把漏斗和自检两边的结论,变成「下周做什么」的几句话。
- `if n >= MIN_N and k / n < 0.15:` 先看样本够不够(`MIN_N` 来自 [Day 513](/blog/agent-zero/day-513-offer/) 的 `funnel.py`),够了才用 15% 的线判断回复率。顺序不能反。
- `for cap, mark, _ in todo[:2]:` 自检的补课顺序里只取前两项,一周补不了更多。
- `rows = list(csv.DictReader(board.open(encoding="utf-8-sig", newline="")))` 读岗位清单。`utf-8-sig` 兼容 Excel 存出来带 BOM 的 CSV,不带也能读。
- `compare(Offer("云岚", monthly=47500, months=16, probation_months=3, probation_ratio=0.8),` 把「手里的两个口头 offer」摆出来对比。这里我偷了个懒:月薪取的是挂牌区间的中点(云岚 35–60K 的中点是 47.5K),真实的 offer 通常会低一点,你要用自己拿到的数。
- `reached = load(funnel_log)` [Day 513](/blog/agent-zero/day-513-offer/) 的 `load` 返回每个阶段「到过」的数量。
- `rows_chk = check(mine, root)` 昨天的 `check`,返回十六项的 `(能力, 记号, 档位, 自评分)`。
- `todo = gaps(rows_chk)` 没勾的项按「叉在前、问号在后、自评低在前」排好。
- `for s in next_steps({s: reached[s] for s in STAGES}, todo):` 把 `Counter` 转成普通字典传进去。这行里的 `s` 在字典推导式里和 `for s in` 里是两个不同的作用域,不冲突。
- `main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]))` 四个参数依次是岗位清单、漏斗记录、证据文件、仓库根目录。

</div>

```bash
uv run python -m part09.review.weekly part09/review/board.csv part09/jobs/funnel_log.csv ../me/evidence.json ../me
```

```text
== 求职周报 ==
1) 岗位:10 条,避坑规则标出 4 条,剩 6 条
     青禾软件: 培训贷
     远山AI: 要你先付钱
     速达服务: 可能不是开发岗
     海棠网络: 派遣外包
2) 薪资(年包中点,万元):n=4(另有 2 条面议或日薪)  中位 55.5 万  P25 42.0  P75 72.0
3) 手里的两个口头 offer:
                  云岚          烛光
现金            73.2 万      51.1 万
公积金            0.0 万       4.3 万
期权期望           0.0 万       0.0 万
合计            73.2 万      55.4 万
4) 投递漏斗:
 已投 -> 已回复  5/40 =  12%  <-- 回复率低:简历关键词、渠道或岗位选得不对,回 Day 498 到 501 和 Day 511
已回复 -> 一面   4/5  =  80%
 一面 -> 二面   1/4  =  25%  样本太少(n=4),先不下结论
 二面 -> offer  0/1  =   0%  样本太少(n=1),先不下结论
5) 能力自检:打勾 12/16
6) 下周做:
   - 回复率 5/40 低于 15%:回看 Day 498 到 501 的简历和 Day 511 的渠道
   - 自检[ ] 上下文工程与记忆:回看 Day 262、Day 263,补出一个文件或链接当证据
   - 自检[ ] 需求拆解与客户沟通:回看 Day 436、Day 437,补出一个文件或链接当证据
```

一页纸能读出的东西:

十条岗位里避坑规则标出四条(培训贷、要你先付钱、可能不是开发岗、派遣外包),剩六条。六条里有两条折不了年包(「面议」和「150-200元/天」),所以薪资那行只有 4 条,中位 55.5 万、中间一半在 42 到 72 万。**这个 4 是个很小的样本**,脚本也没有拒绝算,因为 `statistics.quantiles` 对 4 个数可以算,但它的意义很弱,在周报里你应该把「n=4」当成「还不算数」读。

两个 offer 对比:云岚 73.2 万、烛光 55.4 万,合计差 17.8 万。云岚现金高,公积金是 0,现金里还扣掉了试用期 3 个月拿 80% 的部分(4.75 万 × 0.2 × 3 = 2.85 万);烛光现金低,但有 4.3 万公积金。再回头想想 [Day 513](/blog/agent-zero/day-513-offer/) 的提醒:挂牌价不是成交价,这里两个「offer」的月薪是挂牌区间中点,不是谈出来的数字。

漏斗回复率 12% 触发了报警,下面二面和 offer 两行因为分母小(4 和 1)没有下结论。能力自检打勾 12/16,最低的两项是「上下文工程」和「需求拆解」。所以「下周做」里有三条:回看简历和渠道,补上下文,补客户沟通。**报警和自检各自独立,没有哪条是脚本替你做的决定**,它只是把你本周该看的几个数摆在同一页。

## 本周错题与坑清单

下面是这一周踩得最多的几个地方,每一条都是前面某一天真出现过的:

**挂牌价不是成交价,平均数不是中位数。** [Day 511](/blog/agent-zero/day-511-job-channels/) 在样本上和全量上都看到,平均数比中位数高,因为高薪岗少而高,会一直往上拽。报「大概多少钱」时报中位数加一个范围。

**CSV 里有逗号的字段要加引号。** 今天刚踩的,`DictReader` 不报错,只是悄悄把多出来的字段塞进键为 `None` 的列里,摘要被截掉一半,后面的规则就漏报了。

**数字离谱但程序不崩的错最难发现。** `hf_rate=12`(忘了写成 0.12)会算出 496 万的总包;试用期扣钱的符号写反,现金变成 58.05 万而不是 49.95 万。两个都不会报错,靠 `__post_init__` 校验和判卷用例才拦得住。

**规则命中不等于有问题,没命中也不等于安全。** [Day 513](/blog/agent-zero/day-513-offer/) 的规则会误伤「培训期间不收费」,会漏掉「设备先垫付后报销」。规则是把你的注意力拉到该多问一句的地方,不是裁判。

**样本小的时候百分比反而会误导你。** 二面 1/4 看着是 25%,但那是 4 个样本里的 1 个。`MIN_N = 5` 也只是个起码的线,练习 2 会让你看到分母 12 的时候,多一条回复就能把报警变没。

**行业统计里有四分之一到三成是误判。** [Day 514](/blog/agent-zero/day-514-industry-1/) 抽 20 条看,福利里的「补充医疗保险」被算成了金融。改规则能降低误判不能清零,抽样看误判率这一步不能省。

**准确率不是医疗模型的指标。** 95 条没风险、5 条有风险,什么都不提醒的模型准确率 95%,召回率 0%([Day 515](/blog/agent-zero/day-515-industry-2/))。先和医生定「哪些错不能接受」,再定阈值。

**「做过」不是证据。** 第一版自检 15/16,换成「要指到文件或链接」就是 0/16。面试官问的就是证据。

**关键词太泛会误匹配。** 「落地」把「RAG 系统落地」匹配成了「客户沟通」,要把泛词删掉。

**课程没覆盖的要求别硬凑。** K8s 和 Terraform 这门课没讲,诚实地说没用过,比写进简历再被追问强。

## 动手练习

### 练习 1:给周报加一条「门槛线」

周报里薪资只报了中位数。你有自己的底线(比如年包 45 万),想直接看每条保留下来的岗位是「过线」「低于」还是「要问」(面议和日薪折不了的)。写 `ex517_floor.py`,接受门槛作为命令行参数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex517_floor.py
import csv
import sys
from pathlib import Path

from part09.jobs.salary import annual_mid
from part09.review.weekly import screen

if __name__ == "__main__":
    floor = float(sys.argv[1])  # 你的门槛,单位万元/年
    rows = list(csv.DictReader(Path("part09/review/board.csv").open(encoding="utf-8-sig", newline="")))
    keep, _ = screen(rows)
    for r in keep:
        v = annual_mid(r["薪资"])
        if v is None:
            print(f"要问  {r['公司']}  薪资写的是「{r['薪资']}」,折不了")
        elif v < floor:
            print(f"低于  {r['公司']}  {v:.1f} 万 < {floor:g} 万")
        else:
            print(f"过线  {r['公司']}  {v:.1f} 万")
```

<div class="line-notes">

- `from part09.review.weekly import screen` 直接复用周报里的 `screen`,不再写一遍筛选。
- `floor = float(sys.argv[1])  # 你的门槛,单位万元/年` 门槛从命令行传。
- `keep, _ = screen(rows)` `screen` 返回两个值,被规则标出的那堆这里不要,用 `_` 接。
- `if v is None:` 先处理折不了的。写成「要问」而不是直接丢掉,因为「面议」常常是愿意当面谈的。
- `elif v < floor:` 低于门槛。中间那个 `f"{v:.1f}"` 保留一位小数。

</div>

```text
过线  星河智能  60.0 万
过线  云岚科技  76.0 万
低于  北辰数据  39.0 万 < 45 万
要问  明湖科技  薪资写的是「面议」,折不了
要问  知行学堂  薪资写的是「150-200元/天」,折不了
过线  烛光智能  51.1 万
```

门槛 45 万的话:星河智能(60.0)、云岚科技(76.0)、烛光智能(51.1)过线,北辰数据(39.0)低于,明湖科技和知行学堂要问。注意北辰数据只写了「25-40K」没写几薪,按 12 薪折的,如果面试时发现是 14 薪,年包会变成 45.5,刚好过线,这类边界值得当面问一句。

</details>

### 练习 2:观察题。12 条投递里多一条回复,报警会怎样

[Day 513](/blog/agent-zero/day-513-offer/) 的漏斗在分母小于 5 时不下结论。现在假设你只投了 12 家,分别在「1 家回复」和「2 家回复」两种情况下跑 `report`,看会发生什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex517_small.py
from collections import Counter

from part09.jobs.funnel import report

if __name__ == "__main__":
    for replies in (1, 2):
        reached: Counter[str] = Counter({"已投": 12, "已回复": replies, "一面": 0, "二面": 0, "offer": 0})
        print(f"--- 12 条里 {replies} 条回复")
        report(reached)
```

<div class="line-notes">

- `from part09.jobs.funnel import report` 直接拿 [Day 513](/blog/agent-zero/day-513-offer/) 的 `report`,不用从文件读,所以这里手工造一个 `Counter`。
- `for replies in (1, 2):` 外面一层循环跑两种情况。
- `reached: Counter[str] = Counter({"已投": 12, "已回复": replies, "一面": 0, "二面": 0, "offer": 0})` 手工指定每个阶段「到过」的数量:12 家都到过「已投」,`replies` 家到过「已回复」,后面都是 0。

</div>

```text
--- 12 条里 1 条回复
 已投 -> 已回复  1/12 =   8%  <-- 回复率低:简历关键词、渠道或岗位选得不对,回 Day 498 到 501 和 Day 511
已回复 -> 一面   0/1  =   0%  样本太少(n=1),先不下结论
 一面 -> 二面   0/0  =   0%  样本太少(n=0),先不下结论
 二面 -> offer  0/0  =   0%  样本太少(n=0),先不下结论
--- 12 条里 2 条回复
 已投 -> 已回复  2/12 =  17%
已回复 -> 一面   0/2  =   0%  样本太少(n=2),先不下结论
 一面 -> 二面   0/0  =   0%  样本太少(n=0),先不下结论
 二面 -> offer  0/0  =   0%  样本太少(n=0),先不下结论
```

1 家回复时,回复率 8%,低于 15% 的线,脚本报警;2 家回复时是 17%,过线,不报警。同样是 12 条,多一条回复,脚本的结论就从「回头看简历和渠道」变成了「没事」。这说明 `MIN_N = 5` 只是挡掉了最极端的情况,分母 12 的时候一条回复仍然能让结论翻过来。**报警出现时先看分母**:分母不到几十,先当成「值得留意」,别当成「该动手改简历」。分母怎么算才够,是进阶篇评测统计学要讲的东西([Day 547](/blog/agent-zero/day-547-eval-stats-1/) 到 [Day 550](/blog/agent-zero/day-550-eval-stats-4/))。

</details>

### 练习 3:补一条规则,再检查误伤

[Day 513](/blog/agent-zero/day-513-offer/) 说过,正则规则漏掉了「设备需要您先垫付,后期报销」这种说法。给 `RULES` 加一条「垫付」规则,用三句话测:一句真的有问题,一句是正常公司的差旅报销,一句本来就没问题。看加规则前后分别怎样,再想办法减少误伤。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex517_advance.py
from part09.jobs.red_flags import RULES, flags

TEXTS = [
    "AI 工程师。设备需要您先垫付,后期报销,入职后统一退还。",
    "Agent 后端。出差垫付的差旅费 7 个工作日内报销。",
    "Agent 工程师。培训期间免费,设备由公司提供。",
]

if __name__ == "__main__":
    print("加规则以前:", [flags(t) for t in TEXTS])
    RULES["要你先付钱(垫付)"] = r"垫付"
    print("第一版 垫付:", [flags(t) for t in TEXTS])
    RULES["要你先付钱(垫付)"] = r"(?:设备|培训|考证|押金|保证金)[^,。;]{0,6}垫付|垫付[^,。;]{0,6}(?:设备|培训费|考证)"
    print("收窄以后:  ", [flags(t) for t in TEXTS])
```

<div class="line-notes">

- `from part09.jobs.red_flags import RULES, flags` `RULES` 是个模块级的字典,直接往里加一项,`flags` 会立刻用上。
- `"AI 工程师。设备需要您先垫付,后期报销,入职后统一退还。",` 第一句:真的让候选人先出设备钱。
- `"Agent 后端。出差垫付的差旅费 7 个工作日内报销。",` 第二句:正规公司的差旅流程也会写「垫付」「报销」。
- `RULES["要你先付钱(垫付)"] = r"垫付"` 第一版:只要出现这两个字就报。
- `RULES["要你先付钱(垫付)"] = r"(?:设备|培训|考证|押金|保证金)[^,。;]{0,6}垫付|垫付[^,。;]{0,6}(?:设备|培训费|考证)"` 第二版收窄:「垫付」前后 6 个字以内必须有设备、培训、考证这类词才算。`[^,。;]{0,6}` 是「不跨句的任意 0 到 6 个字」。
- `print("收窄以后:  ", [flags(t) for t in TEXTS])` 对三句话各跑一次,结果是三个列表。

</div>

```text
加规则以前: [[], [], []]
第一版 垫付: [['要你先付钱(垫付)'], ['要你先付钱(垫付)'], []]
收窄以后:   [['要你先付钱(垫付)'], [], []]
```

加规则以前三句都不命中,第一句是漏报。第一版规则(只认「垫付」)把前两句都标出来了,第二句是误伤。收窄以后只剩第一句。规则永远这样来回:漏报了就加,误伤了就收窄,收窄又可能漏掉别的写法(比如「先自行购买设备」)。**所以规则能降低风险,不能清零**,最后一步还是你自己查公司主体、问清流程。

</details>

验收标准:

- `check_week74` 对你的默写稿跑到 11/11,第二天合上文章再默写一遍也能过。
- `weekly.py` 在你自己的投递记录和自检证据上跑通,「下周做」里的几条你认同,或者能说出不认同的理由。
- 练习 2 里的两种结果你能用一句话解释清楚为什么不同。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 复习日 | 不学新概念,默写、判卷、串成小项目的一天 |
| 知识地图 | 把一周的内容画成一张图,标出每天的产出和它们之间的关系 |
| 求职周报 | 本周的小项目,把岗位筛选、薪资、offer、漏斗、自检合成一页,每周跑一次 |
| `DictReader` 的 `None` 键 | CSV 一行的字段比表头多时,多出来的值被放进键为 `None` 的列表里,不报错 |
| 海象运算符 `:=` | 在表达式里先赋值再使用,周报里用它避免把 `annual_mid` 算两遍 |
| 门槛线 | 你自己设的底线,比如年包不低于多少,用来给岗位分「过线、低于、要问」 |
| 漏报、误伤 | 规则该报没报、不该报却报了,两类错此消彼长 |

## 常见误区

**默写稿一遍过了就当会了。** 第一遍是对照判卷脚本改出来的,真正的检验是第二天不看任何东西再默写一遍。

**把周报里的数字当结论。** 4 条岗位的中位数、12 条投递的回复率,都只是线索。样本小的时候,看一下就好,别据此改变策略。

**CSV 里随手用逗号分隔关键词。** 一个不加引号的逗号,就能让后面所有列错位,而且 `DictReader` 不会报错。含逗号的字段加引号,或者换成别的分隔符。

**只修用例,不修原因。** 判卷里的 `FAIL` 只告诉你哪条错,为什么错要自己想。`annual_mid("1.5-2.5万")` 返回 2.4,根因是单位写死了,不是「这个用例特殊」。

**拿挂牌区间的中点当成 offer。** 周报里的 offer 对比是演示用的,真的拿到 offer 要填的是谈出来的数,试用期、公积金基数、期权归属都要问清楚。

**复习日不跑代码,只看文章。** 这一周的知识都在脚本里,不动手跑,就只是「看懂了」。

## 学习资料

### 文档与文章

- [Python 文档 · statistics](https://docs.python.org/3/library/statistics.html):`median`、`quantiles` 的官方说明,周报里的分位数就是它。
- [Python 文档 · csv](https://docs.python.org/3/library/csv.html):读 CSV 的 `DictReader` 和引号规则,今天踩的坑官方文档里有讲(看 Dialects and Formatting Parameters 一节)。
- [Haseeb Qureshi · My Ten Rules for Negotiating a Job Offer](https://haseebq.com/my-ten-rules-for-negotiating-a-job-offer/):拿到 offer 以后怎么谈,作者的个人经验,美国市场的视角。
- [Ashby 公开职位接口文档](https://developers.ashbyhq.com/docs/public-job-posting-api):[Day 512](/blog/agent-zero/day-512-remote-fde/) 用过的那个接口,想换别的公司抓职位先读它。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1N14y1r7tJ&autoplay=0&high_quality=1" title="HR常见压价话术+谈薪公式！12年HR总监的谈薪宝典" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>HR大婷讲求职 · HR常见压价话术+谈薪公式 · 12 分钟,从 HR 的角度讲压价话术,配合 [Day 513](/blog/agent-zero/day-513-offer/) 的 `Offer` 一起看,想想哪些话对应哪项没算清楚的钱。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19an36kEQT&autoplay=0&high_quality=1" title="远程工作面试诈骗避坑指南" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>张保护Alvan · 远程工作面试诈骗避坑指南 · 12 分钟,和 [Day 513](/blog/agent-zero/day-513-offer/) 的避坑规则对照,看视频里的套路哪些你的正则能抓到,哪些抓不到。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/fyn0CKPuPlA" title="How to Negotiate Your Tech Salary Simulation ft. Levels.fyi" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Aced(原 Exponent)· How to Negotiate Your Tech Salary Simulation ft. Levels.fyi · 一场谈薪的模拟,看谈的人怎么拆总包、怎么问数,和今天默写的 `breakdown` 对着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/u9BoG1n1948" title="Tips for negotiating your salary (from an ex-FAANG recruiter)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>mayuko · Tips for negotiating your salary (from an ex-FAANG recruiter) · 前大厂招聘官的几条谈薪建议,短,适合在拿 offer 前过一遍。</figcaption>
</figure>

### 书籍

这一周的内容以脚本和数据为主,没有单独要读的书。想系统了解统计里「样本小的时候怎么办」,可以留到 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 到 [Day 550](/blog/agent-zero/day-550-eval-stats-4/) 那几天再看对应的参考。

### 开源项目与代码

- 你自己的 `agent-zero-lab/part09/jobs/` 和 `part09/review/`:本周所有脚本都在这里,今天的 `weekly.py` 是对它们的第一次整合,之后可以每周跑一次。
- [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api) 和 Greenhouse 的公开职位接口:不用登录就能拿到的真实岗位数据,[Day 512](/blog/agent-zero/day-512-remote-fde/) 的方法可以换成你关心的公司。

## 自测

1. `annual_mid("1.5-2.5万")` 应该返回多少?第一次默写稿为什么返回 2.4?

<details><summary>答案</summary>

应该是 24.0:(1.5 + 2.5) ÷ 2 × 10000 × 12 ÷ 10000。默写稿最后写死了 `/ 10`,只适用于 K(1000)的情况,单位是「万」时就错了。应该用一个字典把每种单位对应到具体的倍数。

</details>

2. 试用期工资打 7 折、月薪 45000、试用 3 个月,现金怎么算,为什么符号容易写反?

<details><summary>答案</summary>

月薪乘 12 再减去试用期少拿的:45000 × 12 − 45000 × (1 − 0.7) × 3 = 540000 − 40500 = 499500。少拿的是 30%,所以是减号;错写成加号以后程序不报错,只是现金多算了 8 万多,很难发现。

</details>

3. 周报里「薪资」那一行只有 4 条,你会怎么向别人汇报这个数?

<details><summary>答案</summary>

说「4 条里中位数约 55 万,样本太少,仅供参考」,不要说「这类岗位年包中位 55 万」。样本这么小的时候,分位数没有统计意义,值得汇报的是「有这几条、它们大致在这个范围」。

</details>

4. CSV 里一行 JD 摘要含逗号但没加引号,`csv.DictReader` 会怎样?

<details><summary>答案</summary>

不报错。第一个逗号前的部分进了「JD 摘要」,多出来的字段被放进键为 `None` 的列表里。后面如果直接用 `row["JD 摘要"]` 去做规则匹配,只匹配到一半的文字,漏报没有任何提示。修法是含逗号的字段用双引号整个括起来。

</details>

5. (面试题)「你做的这个 Agent,怎么证明它变好了?」请结合这一周的内容,说出三个容易让这个结论站不住的地方。

<details><summary>答案</summary>

一,口径:挂牌价不是成交价、平均数不是中位数,同理「解决率」要说清楚什么算解决([Day 515](/blog/agent-zero/day-515-industry-2/) 里换一种定义,75% 变 50%);二,样本太小:几十条里差几条,结论可能翻过来,所以要看分母和区间,不能只看一个百分比;三,指标本身:准确率很高但漏掉了全部高风险样本(召回率 0),要看对这个场景最贵的错误是哪一类。回答里每一点都带一个你自己量过的数。

</details>

6. 规则筛选(比如避坑正则)命中了一条,你应该做什么?没命中的呢?

<details><summary>答案</summary>

命中的不要直接丢掉,去看原文判断是不是误伤(「培训期间不收费」会被碰到);没命中的也不代表安全(「设备先垫付」就没被原始规则抓到)。规则的价值是缩小你要人工看的范围,不是替你做决定。

</details>

## 明天预告

明天(Day 518)进入进阶篇,开学第一天:资深 Agent 工程师到底贵多少、和中级差在哪。我会用公开的海外招聘数据说话(今天用过的 Ashby 公开接口,换成「按职级看薪资」),再给你一张能力对照表,让你按进阶篇的八个维度给自己打分,找出最低的三项。今天写的 `selfcheck` 的打勾规则,明天会再用一次。
