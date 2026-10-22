---
title: 'Day 503 · 第 72 周复习:求职(Day 497–502)'
description: '这一周从代码审查 Agent 走到简历和第一套面试题。今天不加新概念:画一张本周知识地图,默写关键词匹配、数字收集和门槛判断三段核心代码并用检查脚本验收,再把整周的脚本拼成一个「投递前体检」:给一份简历和一份 JD,一次查完关键词覆盖、要点数字、门槛和 PDF。'
pubDate: 2026-10-22
regime: none
tags: ['resume', 'job-search', 'review', 'regex', 'agent-zero']
series: 'agent-zero'
day: 503
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 502](/blog/agent-zero/day-502-interview-1/) 刷了第一套面试基础题:写了计时出声答题的 `quiz.py` 和挑回炉题的 `weak.py`,跑了四个几分钱的小实验,让 token、temperature、前缀缓存、schema 重试这几类题都有自己测出来的数字。

这一周其实是一条线:[Day 497](/blog/agent-zero/day-497-code-review-3/) 把第二个作品升级成 Agent,两个作品到此全部完工;Day 498 到 501 用四天把作品和经历写成一份能投的简历;Day 502 开始准备面试。今天不学新东西,把这条线从头走一遍,确认每个脚本你都能不看文章写出来。

## 今天要解决的问题

复习日的目标是确认这一周的东西长在你手上了。今天结束时你应该能:

1. 不看文章,画出「JD → 关键词表 → 三段式要点 → 诚实改写 → 门槛判断 → 一页 PDF → 面试题」这条线,说出每一步是哪一天、用哪个脚本、防的是什么错。
2. 默写 `has_alias`、`numbers_in`、`min_years` 和 `gate` 四个函数,用检查脚本跑出 10/10。
3. 跑通本周小项目 `part09/review/preflight.py`:给一份简历 JSON、一份 JD 和一份 PDF,一次出体检报告,有问题时退出码是 1。
4. 说得出本周所有检查脚本共同的盲区,以及为什么每一步最后都要人看一遍。

预计用时 3–4 小时,大头在默写和练习。前置:[Day 498](/blog/agent-zero/day-498-resume-1/) 到 [Day 502](/blog/agent-zero/day-502-interview-1/) 全部。今天不调用模型,花费 ¥0。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="本周知识地图:左列是输入材料 JD、记录表、事实清单;中间是简历流水线的四天;右边是面试准备;底部是所有检查脚本的共同盲区">
  <rect x="0" y="0" width="640" height="340" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一份简历从材料到投出去</text>
  <rect x="20" y="40" width="140" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="30" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">jds.json</text>
  <text x="30" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">五份真实 JD</text>
  <rect x="20" y="96" width="140" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="30" y="116" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">results.md</text>
  <text x="30" y="132" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">作品的数字和口径</text>
  <rect x="20" y="152" width="140" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="30" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">work_facts.json</text>
  <text x="30" y="188" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">工作事实 + 角色</text>
  <rect x="200" y="40" width="200" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="210" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">498 关键词表 count_skills</text>
  <rect x="200" y="86" width="200" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="210" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">499 三段式 lint + 对账</text>
  <rect x="200" y="132" width="200" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="210" y="154" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">500 诚实改写 + gate</text>
  <rect x="200" y="178" width="200" height="36" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="210" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">501 一页 PDF + 英文版</text>
  <rect x="440" y="86" width="180" height="82" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="450" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">502 面试题库一</text>
  <text x="450" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">quiz / weak</text>
  <text x="450" y="144" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">四个小实验找证据</text>
  <text x="450" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">追问回到简历每一行</text>
  <rect x="440" y="40" width="180" height="36" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="450" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">497 两个作品完工</text>
  <line x1="160" y1="62" x2="200" y2="58" stroke="var(--ink-faint)"/>
  <line x1="160" y1="118" x2="200" y2="104" stroke="var(--ink-faint)"/>
  <line x1="160" y1="174" x2="200" y2="150" stroke="var(--ink-faint)"/>
  <line x1="300" y1="76" x2="300" y2="86" stroke="var(--ink-faint)"/>
  <line x1="300" y1="122" x2="300" y2="132" stroke="var(--ink-faint)"/>
  <line x1="300" y1="168" x2="300" y2="178" stroke="var(--ink-faint)"/>
  <line x1="400" y1="196" x2="440" y2="150" stroke="var(--ink-faint)"/>
  <line x1="530" y1="76" x2="530" y2="86" stroke="var(--ink-faint)"/>
  <rect x="200" y="236" width="420" height="40" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="210" y="260" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">本周小项目 preflight.py:① 关键词 ② 要点 ③ 门槛 ④ PDF</text>
  <line x1="300" y1="214" x2="300" y2="236" stroke="var(--ink-faint)"/>
  <text x="20" y="306" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">共同盲区:所有脚本只查字面(词在不在、数在不在、格式对不对),</text>
  <text x="20" y="324" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">查不了意思(因果搭错、关键词硬贴、行话不对)。每一步最后一道都是你自己读</text>
</svg>
<figcaption>本周六天在一条线上的位置。左边琥珀色是你手里的原始材料,中间蓝色是简历流水线,右边是面试准备。底部那两行是这一周反复出现的同一个教训。</figcaption>
</figure>

这张图里我最想让你记住的是底部那两行。这一周写了七八个检查脚本,几乎每一个都在「全部通过」之后,被我人工读出了问题:Day 499 的「搭九个节点让成功率涨了」是因果搭错;Day 500 的「三个面向客户的业务模块」是关键词硬贴;Day 501 的「LLM review」是行话不对;Day 502 的「温度 0 时 5 次都是 other」是稳定但错。面试官追问的,恰恰是这些脚本查不出来的地方。

## 本周每天一句话

[Day 497 · 第二作品(三)](/blog/agent-zero/day-497-code-review-3/):代码审查机器人从固定流程升级成 Agent,能自己决定要不要翻相关代码;同时讲了它和 Coding Agent 的关系,以及审 AI 写的代码该盯哪些地方。到这里两个作品都完工了,它们的数字就是这周简历的原材料。

[Day 498 · 简历(一)](/blog/agent-zero/day-498-resume-1/):先读 JD 再写简历。用 `count_skills` 数关键词,踩了子串误伤(cross-functional 里的 function)和中文 `\b` 失效两个坑,最后生成「JD 关键词 → 我的证据 → 简历哪一行」的对照表,空着的格子分「会但没写」和「真不会」。

[Day 499 · 简历(二)](/blog/agent-zero/day-499-resume-2/):项目要点三段式,做了什么、结果数字、口径。`lint` 查空话和缺口径,`check` 把要点里每个数字拿去记录表对账,抓到了 78% 写成 87% 的笔误。脚本全绿之后还读出了因果搭错。

[Day 500 · 简历(三)](/blog/agent-zero/day-500-resume-3/):工作经历只换角度不编造。事实清单带参与、负责、主导三级角色,`honesty_check` 抓职责升级和凭空多出来的数字、技术词;`gate` 用正则读年限和学历门槛,踩了 en dash 的坑,判断顺序是从最硬的门槛往下。

[Day 501 · 简历(四)](/blog/agent-zero/day-501-resume-4/):四问代表项目说明(数据、处理、效果、再来一次),简历内容放 JSON、排版用 HTML、Chrome 打 PDF,`pdf_check` 查一页、链接能点、抽出来的是正常汉字(苹方会抽出康熙部首)。证书作品优先,英文版过去式动词开头、数字不丢。

[Day 502 · 面试(一)](/blog/agent-zero/day-502-interview-1/):四步答题法(定义、机制、取舍、我测过或我做过),计时出声答题加回炉,四个小实验给答案找证据:DeepSeek 上中文反而比英文省 token,温度 0 也不完全确定,前缀缓存把成本降到约九分之一,pydantic 报错喂回去一次改对。

哪一句你读着觉得「好像是这样,但说不清为什么」,先回那一天把对应小节重看一遍再往下。

## 准备环境

今天的代码放在 `agent-zero-lab/part09/review/`。本周前几天的文件都要在,先建目录,再用一行 shell 循环挨个确认:

```bash
cd agent-zero-lab
mkdir -p part09/review
touch part09/review/__init__.py
for f in jds.json kw_count_v2.py results.md results_review.md bullet_lint.py number_check.py work_facts.json jd_gate.py resume_zh.json resume_bad.json pdf_check.py out/resume_zh.pdf out/resume_bad.pdf; do [ -e part09/$f ] && echo "有 $f" || echo "缺 $f"; done
```

```text
有 jds.json
有 kw_count_v2.py
有 results.md
有 results_review.md
有 bullet_lint.py
有 number_check.py
有 work_facts.json
有 jd_gate.py
有 resume_zh.json
有 resume_bad.json
有 pdf_check.py
有 out/resume_zh.pdf
有 out/resume_bad.pdf
```

`[ -e 路径 ]` 是 shell 里「这个路径存在吗」的判断,`&&` 后面是存在时做的事,`||` 后面是不存在时做的事,相当于 JS 里 `exists ? a : b` 的写法。这 13 个文件分别来自 Day 498(`jds.json`、`kw_count_v2.py`)、Day 499 和它的练习 2(两份结果表、`bullet_lint.py`、`number_check.py`)、Day 500(`work_facts.json`、`jd_gate.py`)、Day 501(两份简历 JSON、`pdf_check.py`、两个 PDF)。

缺哪个就回那一天补上。PDF 如果没有,按 Day 501 第五步用 Chrome 重新打一份。今天不调模型,不需要网络。

## 默写:四个函数,一个检查脚本

本周脚本里最常用、也最容易写错的是四个函数:`has_alias`(Day 498)、`numbers_in`(Day 499)、`min_years` 和 `gate`(Day 500,今天用一个简化版,只返回建议)。合上文章,把它们写进 `part09/review/mine.py`。

先给你检查脚本,它不关心你怎么写,只看结果对不对。十个用例里每一个都对应本周踩过的一个坑:

```python
# agent-zero-lab/part09/review/check_dictation.py
from part09.review.mine import gate, has_alias, min_years, numbers_in

CASES = [
    ("has_alias 中英混排", has_alias("熟悉go语言", "go"), True),
    ("has_alias 不误伤", has_alias("cross-functional", "function"), False),
    ("has_alias 中文子串", has_alias("评测集与回归", "评测"), True),
    ("numbers_in 小数和百分号", numbers_in("从 55% 到 77.5%,40 条"), {"55%", "77.5%", "40"}),
    ("min_years 减号", min_years("3-5 年开发经验"), 3),
    ("min_years en dash", min_years("1–3 年开发工作经验"), 1),
    ("min_years 以上", min_years("2 年以上大模型经验"), 2),
    ("gate 硬门槛", gate("硕士及以上学历,1 年以上经验"), "走内推,不然放弃"),
    ("gate 年限太高", gate("5-10 年后端经验"), "能投,但别指望"),
    ("gate 硕士优先", gate("本科及以上,硕士优先"), "投"),
]

bad = 0
for name, got, want in CASES:
    ok = got == want
    bad += not ok
    print(f"{'✓' if ok else '✗'} {name}" + ("" if ok else f"  得到 {got!r},应该是 {want!r}"))
print(f"\n{len(CASES) - bad}/{len(CASES)} 通过")
```

<div class="line-notes">

- `from part09.review.mine import gate, has_alias, min_years, numbers_in` 从你的默写版导入。函数名、参数顺序要和原版一样,这本身就是默写的一部分。
- `("has_alias 中英混排",` Day 498 的坑:`\b` 在汉字旁边不成立。文本已经是小写,因为原版 `count_skills` 在调用前先 `.lower()`。
- `("has_alias 不误伤", has_alias("cross-functional", "function"), False),` 子串判断会误伤,只用 `in` 的写法过不了这一条。
- `("has_alias 中文子串", has_alias("评测集与回归", "评测"), True),` 中文别名要用子串判断,「评测集」里的「评测」算提到评测。
- `("numbers_in 小数和百分号",` Day 499 的正则要把 `77.5%` 当成一个数,不能拆成 77、5%。
- `("min_years en dash", min_years("1–3 年开发工作经验"), 1),` Day 500 的坑:这里的横线是 U+2013。
- `("gate 硕士优先", gate("本科及以上,硕士优先"), "投"),` 「硕士优先」是软门槛,不该拦。
- `bad += not ok` `not ok` 是 True 或 False,加到整数上就是 1 或 0。Python 的 bool 是 int 的子类,JS 里 `true + 0` 也是 1,一个意思。
- `print(f"{'✓' if ok else '✗'} {name}" + ("" if ok else f"  得到 {got!r},应该是 {want!r}"))` 错的才打印期望值。`!r` 把字符串带引号打出来,None 和 "None" 能分清。

</div>

### 我第一次默写的版本

下面是我隔了一天、不看文章写出来的版本,原样贴出来,里面有两个本周踩过的坑又踩了一遍:

```python
# agent-zero-lab/part09/review/mine.py  (默写版,第一次)
import re

NUM = re.compile(r"\d+(?:\.\d+)?%?")
YEARS = re.compile(r"(\d+)\s*-\s*(\d+)\s*年|(\d+)\s*年以上")
HARD_MASTER = re.compile(r"(硕士|研究生)(及以上|以上)")


def has_alias(text: str, alias: str) -> bool:
    return re.search(rf"\b{re.escape(alias)}\b", text) is not None


def numbers_in(text: str) -> set[str]:
    return set(NUM.findall(text))


def min_years(text: str) -> int | None:
    m = YEARS.search(text)
    if not m:
        return None
    return int(m.group(1) or m.group(3))


def gate(text: str, my_years: int = 3) -> str:
    if HARD_MASTER.search(text):
        return "走内推,不然放弃"
    y = min_years(text)
    if y is not None and y > my_years + 1:
        return "能投,但别指望"
    return "投"
```

<div class="line-notes">

- `YEARS = re.compile(r"(\d+)\s*-\s*(\d+)\s*年|(\d+)\s*年以上")` 中间只写了键盘上的减号,en dash 的坑忘了。
- `return re.search(rf"\b{re.escape(alias)}\b", text) is not None` 图省事,中英文一律用 `\b`,把 Day 498 第三步整个忘了。
- `def gate(text: str, my_years: int = 3) -> str:` 简化版:只返回建议,不返回理由列表,也没有 AI 年限那一档。`my_years: int = 3` 是带默认值的参数,相当于 JS 的 `function gate(text, myYears = 3)`。
- `if HARD_MASTER.search(text):` 判断顺序还记得:硬门槛最先判。

</div>

```bash
uv run python -m part09.review.check_dictation
```

```text
✗ has_alias 中英混排  得到 False,应该是 True
✓ has_alias 不误伤
✗ has_alias 中文子串  得到 False,应该是 True
✓ numbers_in 小数和百分号
✓ min_years 减号
✗ min_years en dash  得到 None,应该是 1
✓ min_years 以上
✓ gate 硬门槛
✓ gate 年限太高
✓ gate 硕士优先

7/10 通过
```

三个 ✗ 正好是两个坑。第三条「中文子串」也挂了,是 `\b` 的同一个问题:「评测」后面紧跟着「集」,汉字是单词字符,两个汉字之间没有词边界。这一点 Day 498 的演示里没出现过,今天的用例把它补上了。

改两处。`YEARS` 的横线换成字符集合,`has_alias` 按是不是纯英文分两路:

```python
YEARS = re.compile(r"(\d+)\s*[-–—~至]\s*(\d+)\s*年|(\d+)\s*年以上")


def has_alias(text: str, alias: str) -> bool:
    if alias.isascii():
        pattern = rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])"
        return re.search(pattern, text) is not None
    return alias in text
```

<div class="line-notes">

- `YEARS = re.compile(r"(\d+)\s*[-–—~至]\s*(\d+)\s*年|(\d+)\s*年以上")` 方括号里五个字符任意一个都行。几种横线从这一行复制,别手打。
- `if alias.isascii():` 纯英文别名才用正则。
- `pattern = rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])"` 环视只看英文字母和数字,汉字不算,所以「熟悉go语言」能匹配,`cross-functional` 不能。
- `return alias in text` 中文别名用子串。

</div>

```bash
uv run python -m part09.review.check_dictation
```

```text
✓ has_alias 中英混排
✓ has_alias 不误伤
✓ has_alias 中文子串
✓ numbers_in 小数和百分号
✓ min_years 减号
✓ min_years en dash
✓ min_years 以上
✓ gate 硬门槛
✓ gate 年限太高
✓ gate 硕士优先

10/10 通过
```

没到 10/10 之前别往下走。你的版本和我的写法不一样没关系,只要用例全过。

## 本周小项目:投递前体检

这一周写的检查散落在七八个文件里,每投一份简历都挨个跑一遍太麻烦,而且一定会漏。小项目把它们串成一个命令:给简历 JSON、JD 编号、PDF 路径,输出一份四项体检报告;有任何问题,退出码是 1。

退出码这个设计是从 CI 门禁学来的。第六部分你把评测接进 GitHub Actions 时用过同一个约定:命令返回 0 表示通过,非 0 表示失败,CI 看到非 0 就把这次构建标红。以后你如果把简历放在 git 仓库里(很多人这么做),就能让 CI 每次改动都自动体检一遍。

```python
# agent-zero-lab/part09/review/preflight.py
import json
import re
import sys
from pathlib import Path

import part09.bullet_lint as bl
from part09.jd_gate import gate
from part09.kw_count_v2 import KEYWORDS, NOISE, has_alias, load_jds
from part09.number_check import check, numbers_in
from part09.pdf_check import pdf_check

bl.SCOPE = re.compile(r"\d+ ?(条|个)|on (a|the) \d+")
RECORDS = ["part09/results.md", "part09/results_review.md", "part09/work_facts.json"]


def skills_in(text: str) -> set[str]:
    t = text.lower()
    for noise in NOISE:
        t = t.replace(noise, " ")
    return {skill for skill, aliases in KEYWORDS.items() if any(has_alias(t, a) for a in aliases)}


def preflight(resume_path: str, jd_id: str, pdf_path: str) -> int:
    d = json.loads(Path(resume_path).read_text(encoding="utf-8"))
    jd = next(j for j in load_jds() if j["id"] == jd_id)
    problems = 0

    want, have = skills_in(jd["text"]), skills_in(json.dumps(d, ensure_ascii=False))
    print(f"① 关键词:JD 要 {len(want)} 项,简历覆盖 {len(want & have)} 项,缺 {sorted(want - have)}")

    known = set().union(*(numbers_in(Path(p).read_text(encoding="utf-8")) for p in RECORDS))
    print("② 要点:")
    before = problems
    for section in ("projects", "work"):
        for item in d[section]:
            for b in item["bullets"]:
                issues = [f"记录里没有 {n}" for n in check(b, known)]
                if section == "projects":
                    issues += bl.lint(b)
                problems += len(issues)
                if issues:
                    print(f"   ✗ {b[:24]}… {issues}")
    if problems == before:
        print("   全部通过")

    verdict, notes = gate(jd["text"])
    print(f"③ 门槛:{verdict} {notes}")

    pdf_problems = pdf_check(pdf_path)
    problems += len(pdf_problems)
    print(f"④ PDF:{pdf_problems or '通过'}")
    return problems


if __name__ == "__main__":
    n = preflight(sys.argv[1], sys.argv[2], sys.argv[3])
    print(f"\n{'可以投' if n == 0 else f'有 {n} 个问题,先改再投'}")
    sys.exit(1 if n else 0)
```

<div class="line-notes">

- `import part09.bullet_lint as bl` 导入整个模块,下面才能替换它的 `SCOPE`。这是 Day 499 练习 2 的写法,`from ... import SCOPE` 再赋值改不到 `lint` 看到的那个。
- `bl.SCOPE = re.compile(r"\d+ ?(条|个)|on (a|the) \d+")` 让口径规则也认「个」,代码审查机器人那两条「20 个 bug」「6 个 PR」才不会被误报。
- `RECORDS = [` 三份记录:两个作品的结果表和工作事实清单。要点里的数字只要在任意一份里出现过就算有出处。
- `def skills_in(text: str) -> set[str]:` 把 Day 498 `count_skills` 的内层逻辑拿出来:一段文字提到了词典里哪几项技能。转小写、抹掉噪音短语、逐项用 `has_alias` 查。
- `return {skill for skill, aliases in KEYWORDS.items() if any(has_alias(t, a) for a in aliases)}` 集合推导式。实跑腾讯那份 JD 得到 9 项。
- `jd = next(j for j in load_jds() if j["id"] == jd_id)` `next` 取生成器的第一个元素,相当于 JS 的 `jds.find(j => j.id === jdId)`。编号写错时这里会抛 `StopIteration`,练习时你可能会撞上。
- `want, have = skills_in(jd["text"]), skills_in(json.dumps(d, ensure_ascii=False))` 简历这边直接把整个 JSON 转成字符串去匹配,标题、技能、要点全算上。`ensure_ascii=False` 不能省,否则中文变成 `评` 这种转义,中文别名一个都匹配不上。
- `缺 {sorted(want - have)}` `&` 是集合交集,`-` 是差集,相当于 JS 里 `new Set([...a].filter(x => b.has(x)))` 那一串。缺的技能只提示、不算问题,因为 Day 498 说过,真不会的就空着。
- `known = set().union(*(numbers_in(` 三份记录里的数字合并成一个集合。`*` 把生成器展开成多个参数,相当于 JS 的展开运算符 `...`。
- `before = problems` 记下这一节开始前的问题数,节末好判断这一节有没有出问题。
- `if section == "projects":` 只对项目要点跑 `lint`。工作经历的写法不一样(「3 年交付」「35 条用例」),`lint` 的口径规则是为项目要点设计的,拿去查工作经历会成片误报。
- `verdict, notes = gate(jd["text"])` 用的是 Day 500 的完整版 `gate`,带理由列表。门槛只提示,不算问题:投不投你自己决定。
- `pdf_problems = pdf_check(pdf_path)` Day 501 的检查,它会自己打印链接和页数那两行。
- `sys.exit(1 if n else 0)` 设置进程退出码。在终端里用 `echo $?` 能看到上一条命令的退出码。

</div>

先拿好简历和中兵数字那份 FDE 岗跑一次:

```bash
uv run python -m part09.review.preflight part09/resume_zh.json zhaopin_fde part09/out/resume_zh.pdf; echo "退出码 $?"
```

```text
① 关键词:JD 要 5 项,简历覆盖 4 项,缺 ['Go']
② 要点:
   全部通过
③ 门槛:投,简历里写清 AI 经验来自个人项目 ['最低 1 年', '另要 AI 方向 1 年']
链接: ['mailto:zhangsan@example.com', 'https://github.com/zhangsan', 'https://demo.example.com/']
1 页,3 个链接,抽出 1098 个字符
④ PDF:通过

可以投
退出码 0
```

缺 Go,是真不会,不写;门槛那一行提醒你这家要 1 年 AI 经验,投的时候在沟通里说清经验来源。其余都过了。

再拿 Day 501 那份坏简历跑腾讯的岗:

```bash
uv run python -m part09.review.preflight part09/resume_bad.json tencent part09/out/resume_bad.pdf; echo "退出码 $?"
```

```text
① 关键词:JD 要 9 项,简历覆盖 8 项,缺 ['Go']
② 要点:
   ✗ 练习 1:用 Python 写的小工具,包括天气… ['有数字但没写口径(在多少条上测的)']
   ✗ 练习 2:用 Python 写的小工具,包括天气… ['有数字但没写口径(在多少条上测的)']
   ✗ 练习 3:用 Python 写的小工具,包括天气… ['有数字但没写口径(在多少条上测的)']
   ✗ 练习 4:用 Python 写的小工具,包括天气… ['有数字但没写口径(在多少条上测的)']
   ✗ 练习 5:用 Python 写的小工具,包括天气… ['有数字但没写口径(在多少条上测的)']
   ✗ 练习 6:用 Python 写的小工具,包括天气… ['有数字但没写口径(在多少条上测的)']
   ✗ 练习 7:用 Python 写的小工具,包括天气… ['记录里没有 7', '有数字但没写口径(在多少条上测的)']
   ✗ 练习 8:用 Python 写的小工具,包括天气… ['有数字但没写口径(在多少条上测的)']
   ✗ 练习 9:用 Python 写的小工具,包括天气… ['记录里没有 9', '有数字但没写口径(在多少条上测的)']
   ✗ 练习 10:用 Python 写的小工具,包括天… ['有数字但没写口径(在多少条上测的)']
   ✗ 练习 11:用 Python 写的小工具,包括天… ['记录里没有 11', '有数字但没写口径(在多少条上测的)']
   ✗ 练习 12:用 Python 写的小工具,包括天… ['记录里没有 12', '有数字但没写口径(在多少条上测的)']
③ 门槛:投 []
链接: []
2 页,0 个链接,抽出 1978 个字符
④ PDF:['2 页,不是一页', '没有可点的 GitHub 链接']

有 18 个问题,先改再投
退出码 1
```

12 条凑数的练习全被拦下,PDF 两页、链接不能点也报了,退出码 1。工作经历里多加的那两条(6 起白屏、40 多个页面)没报,因为它们的数字在事实清单里都有,是真事,只是不该放进一页简历;这一点脚本判断不了,Day 501 是人删的。

有一件事不对劲:为什么练习 7、9、11、12 报了「记录里没有」,练习 1 到 6、8、10 却没报?这些数字明明都是编号,一个都不该在记录表里。练习 2 让你去查。

### 零件和大代码的对照

| 零件 | 来自哪天 | 在 preflight 哪一段 |
| --- | --- | --- |
| `KEYWORDS`、`NOISE`、`has_alias` | Day 498 `kw_count_v2.py` | `skills_in`,第 ① 项 |
| `numbers_in`、`check` | Day 499 `number_check.py` | `known` 和每条要点的对账,第 ② 项 |
| `lint` 和 `SCOPE` 认「个」 | Day 499 `bullet_lint.py` + 练习 2 | 项目要点的空话和口径,第 ② 项 |
| 事实清单 | Day 500 `work_facts.json` | `RECORDS` 的第三份,工作经历的数字出处 |
| `gate` | Day 500 `jd_gate.py` | 第 ③ 项 |
| `pdf_check` | Day 501 `pdf_check.py` | 第 ④ 项 |
| 退出码当门禁 | 第六部分 CI 回归门禁 | `sys.exit` |

## 本周错题与坑清单

这一周真实踩过的坑,按出现的先后排。复习时每一条都问自己:我现在还会不会再踩?

| 坑 | 出在哪天 | 现象 | 怎么防 |
| --- | --- | --- | --- |
| 子串误伤 | 498 | `function` 命中 `cross-functional`,`go` 命中 `go-to-market` | 英文别名用环视;已知误伤短语进 `NOISE` |
| 中文旁边 `\b` 失效 | 498、503 | 「熟悉go语言」「评测集」匹配失败 | 中文别名用子串,英文用 `(?<![a-z0-9])` |
| 修一个词伤另一个词 | 498 | 加了「前后不是字母」后 eval 匹配不到 evaluation | 规则改完拿全量数据抽查 |
| 记错数字 | 499、501 | 78% 写成 87%,77.5% 凭印象写成 80% | 每个数字都对账 |
| 字母里的数字被当成数 | 501 | BM25 的 25 被报「记录里没有」 | 对账前抹掉 `[A-Za-z]+\d+` |
| 记录里的数字太宽 | 499、503 | 「Day 476」的 476、「f1」的 1 都算已知数字 | 知道边界;练习 2 |
| 因果搭错 | 499 | 「搭九个节点」后面接「成功率从 55% 升到 77.5%」 | 人读:这个数是哪件事带来的 |
| 关键词硬贴 | 500 | 管理后台写成「面向客户」 | 对不上的关键词让它空着 |
| en dash | 500 | 「1–3 年」匹配不到 | 横线、逗号、空格都考虑全角和变体 |
| 链接不能点 | 501 | PDF 上有地址但没有 `/Link` 注释 | `pdf_check` 查注释 |
| 康熙部首 | 501 | 苹方打出的 PDF 抽出「⼯程师」 | 换字体,`pdf_check` 查 U+2E80–U+2FDF |
| Chrome 退出码 2 | 501 | PDF 写好了,退出码却不是 0 | 看文件在不在,不只看退出码 |
| `int("两分")` | 502 | 自评敲错整个程序崩 | 先校验再转 |
| 稳定不等于对 | 502 | 温度 0 时模糊工单 5 次都是 other | 改类别定义,不是调温度 |
| 时间戳放 prompt 开头 | 502 | 缓存 0 命中 | 固定部分放最前面 |
| import 了没有 `__main__` 保护的文件 | 502 | 一 import 就把实验的 API 请求又发一遍 | 被别人 import 的文件都加保护 |

## 动手练习

### 练习 1:体检加上英文版

给 `preflight` 加第 ⑤ 项:如果 `part09/out/bullets_en.json` 存在,用 Day 501 的 `en_check` 逐条查英文要点,问题也计入总数。不改 `preflight.py`,写一个新脚本包一层,JD 编号从命令行传。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex503_en.py
import json
import sys
from pathlib import Path

from part09.en_check import en_check
from part09.review.preflight import preflight

EN = Path("part09/out/bullets_en.json")

n = preflight("part09/resume_zh.json", sys.argv[1], "part09/out/resume_zh.pdf")
if EN.exists():
    pair = json.loads(EN.read_text(encoding="utf-8"))
    bad = [(i, p) for i, (z, e) in enumerate(zip(pair["zh"], pair["en"], strict=True), 1) if (p := en_check(z, e))]
    n += len(bad)
    print(f"⑤ 英文版:{bad or '通过'}")
else:
    print("⑤ 英文版:没有 bullets_en.json,跳过")
print(f"\n{'可以投' if n == 0 else f'有 {n} 个问题,先改再投'}")
```

<div class="line-notes">

- `from part09.review.preflight import preflight` 复用整个函数。`preflight.py` 有 `__main__` 保护,import 时不会去读 `sys.argv[3]`。
- `n = preflight("part09/resume_zh.json", sys.argv[1], "part09/out/resume_zh.pdf")` 简历和 PDF 写死,只有 JD 从命令行传。
- `if EN.exists():` 没有英文版就跳过,不算问题。投国内岗时本来就不需要。
- `if (p := en_check(z, e))]` `:=` 叫海象运算符,在表达式里一边赋值一边判断:先把 `en_check` 的结果存进 `p`,`p` 非空(有问题)才保留。相当于 JS 里 `if ((p = check()).length)` 那种写法。不用它就得把 `en_check` 调两次。

</div>

```bash
uv run python -m part09.ex.ex503_en intercom_fde
```

```text
① 关键词:JD 要 2 项,简历覆盖 2 项,缺 []
② 要点:
   全部通过
③ 门槛:投 []
链接: ['mailto:zhangsan@example.com', 'https://github.com/zhangsan', 'https://demo.example.com/']
1 页,3 个链接,抽出 1098 个字符
④ PDF:通过
⑤ 英文版:通过

可以投
```

注意 `bullets_en.json` 里存的是 Day 501 的机翻原稿,它 `en_check` 全过,但 Day 501 人工读出了三处问题。所以这一项通过,只说明字面没毛病。更好的做法是把你人工定稿的英文要点也存成同样的 JSON,检查定稿。

</details>

### 练习 2:观察题。练习编号为什么有的报有的不报

坏简历里「练习 1」到「练习 12」的编号,只有 7、9、11、12 被报了「记录里没有」。写个小脚本,查 1、6、7、12 这几个数分别出现在三份记录的哪一行,解释原因,再想想怎么改正则能修掉。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex503_known.py
import re
from pathlib import Path

from part09.number_check import NUM
from part09.review.preflight import RECORDS

for n in ["1", "6", "7", "12"]:
    where = []
    for p in RECORDS:
        for line in Path(p).read_text(encoding="utf-8").splitlines():
            if n in NUM.findall(line):
                where.append(f"{Path(p).name}: {line.strip()[:40]}")
    print(f"{n:>3} 出现 {len(where)} 处", where[:2])
print("f1 里的 1:", NUM.findall("f1"), "| 加上字母前缀限制:", re.findall(r"(?<![A-Za-z])\d+(?:\.\d+)?%?", "f1 Day 476 和 6 起"))
```

<div class="line-notes">

- `from part09.number_check import NUM` 用和对账一模一样的正则,才能复现它看到的东西。
- `if n in NUM.findall(line):` 这一行抽出来的数里有没有 n。注意是整个数相等,`"1" in ["12"]` 是 False。
- `where.append(f"{Path(p).name}: {line.strip()[:40]}")` 记下文件名和那一行的前 40 个字符。
- `print(f"{n:>3} 出现 {len(where)} 处", where[:2])` 只打印前两处,够看出原因了。
- `re.findall(r"(?<![A-Za-z])\d+(?:\.\d+)?%?", "f1 Day 476 和 6 起")` 试一个修法:数字前面不能紧跟字母。

</div>

```bash
uv run python -m part09.ex.ex503_known
```

```text
  1 出现 1 处 ['work_facts.json: {"id": "f1", "role": "负责", "old": "负责管理后']
  6 出现 3 处 ['results_review.md: | 埋 bug 评测集 | 20 个 | 6 个 PR 里人工埋的 bug,五类', 'work_facts.json: {"id": "f2", "role": "参与", "old": "参与线上问']
  7 出现 0 处 []
 12 出现 0 处 []
f1 里的 1: ['1'] | 加上字母前缀限制: ['476', '6']
```

1 是从事实清单的编号 `"f1"` 里抽出来的,`f1` 到 `f6` 让 1 到 6 全成了「已知数字」;8 和 10 也各自在记录里某处出现过(比如 8 条 review 清单)。7、9、11、12 恰好哪里都没有,才被报出来。所以「没报」不等于「有出处」,对账只能证明这个数字在记录里出现过,证明不了它和这条要点说的是同一件事。

加了「前面不能紧跟字母」以后,`f1` 里的 1 不再被收进来,但 `Day 476` 里的 476 照样算已知数字(前面是空格)。这个修法能堵掉一部分,堵不完。更彻底的办法是记录表只收「值」那一列的数字,不收口径和来源列,你可以试着改。不过对简历来说,真正的防线还是:每个数字你都能说出它在记录表的哪一行。

</details>

### 练习 3:五份 JD 排个序

投递前你通常手里有一批 JD。复用 `skills_in` 和 `gate`,对 `jds.json` 里五份 JD 各算一次:简历覆盖了 JD 要求的几项技能、覆盖率多少、缺什么、门槛建议,按覆盖率从高到低打印,结果存成 `part09/out/apply_list.json`。看完排序,说说你会不会照着这个顺序投。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex503_batch.py
import json
from pathlib import Path

from part09.jd_gate import gate
from part09.kw_count_v2 import load_jds
from part09.review.preflight import skills_in

have = skills_in(Path("part09/resume_zh.json").read_text(encoding="utf-8"))
rows = []
for jd in load_jds():
    want = skills_in(jd["text"])
    verdict, _ = gate(jd["text"])
    rate = len(want & have) / len(want) if want else 0
    rows.append((rate, jd["id"], f"{len(want & have)}/{len(want)}", sorted(want - have), verdict))
for rate, jid, cov, miss, verdict in sorted(rows, reverse=True):
    print(f"{jid:<14}{cov:<6}{rate:>5.0%}  缺 {miss!s:<22} {verdict}")
Path("part09/out/apply_list.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
```

<div class="line-notes">

- `have = skills_in(Path("part09/resume_zh.json").read_text(encoding="utf-8"))` 这次直接读 JSON 文件的原文去匹配,文件里本来就是中文原样,效果和 `json.dumps(..., ensure_ascii=False)` 一样。
- `verdict, _ = gate(jd["text"])` 理由列表这里不用,用 `_` 接住。
- `rate = len(want & have) / len(want) if want else 0` JD 一项技能都没匹配到时防止除以 0。
- `rows.append((rate, jd["id"],` 覆盖率放元组第一个,`sorted` 默认按第一个元素排。
- `for rate, jid, cov, miss, verdict in sorted(rows, reverse=True):` `reverse=True` 从高到低。
- `{rate:>5.0%}` `:>5.0%` 把 0.89 格式化成右对齐、不带小数的百分比「  89%」。

</div>

```bash
uv run python -m part09.ex.ex503_batch
```

```text
zhaopin_rag   3/3    100%  缺 []                     投
netease       8/8    100%  缺 []                     投,简历里写清 AI 经验来自个人项目
intercom_fde  2/2    100%  缺 []                     投
tencent       8/9     89%  缺 ['Go']                 投
zhaopin_fde   4/5     80%  缺 ['Go']                 投,简历里写清 AI 经验来自个人项目
```

我不会照这个顺序投。排第一的 zhaopin_rag 覆盖率 100%,但它的 JD 原文里有两条硬要求词典根本没收:「独立完成过至少一次开源模型的轻量微调」和「可在郑州全职到岗」。词典里没有「微调」这一项,所以覆盖率是在 3 项上算的 100%,分母太小。Intercom 同理,英文 JD 只匹配到 2 项。

真实的顺序我会这样排:网易(8 项全中,而且要「集成至智能客服」,和 SupportPilot 几乎一一对应)、腾讯(9 项中 8 项,大厂,缺的 Go 是「之一」)、中兵数字(要 1 年 AI 经验,沟通时说清)、Intercom(英文岗,先把英文版和 FDE 那天的准备做完)、最后才是 zhaopin_rag(先补一次轻量微调再投,地点也要考虑)。覆盖率是一个排序的起点,分母多大、缺的是什么,还得回 JD 原文看。

</details>

**验收标准**

- `check_dictation` 对你的默写版跑出 10/10,而且是合上文章写出来的。
- `preflight` 对你自己的简历和至少两份你真想投的 JD 跑过,退出码 0;对坏简历退出码 1。
- 错题清单里的每一条,你都能说出现象和防法,不用翻表。
- 练习 3 的排序你按自己的判断重排过,每一份都写了一句理由。

## 名词解释

复习日没有新概念,这里列本周最常用、最容易混的几个,每个后面是它首次出现的那一天。

| 名词 | 意思 |
| --- | --- |
| 关键词对照表 | JD 技能词 → 你的证据 → 简历哪一行,空着的格子分「会但没写」和「真不会」(Day 498) |
| 环视 | 正则里的 `(?<!...)` `(?!...)`,只看前后一个字符是不是某类,不吃掉字符(Day 498) |
| 三段式要点 | 做了什么、结果数字、口径(Day 499) |
| 数字对账 | 要点里的每个数字都要在记录表里找得到(Day 499) |
| 职责升级 | 参与写成负责、负责写成主导(Day 500) |
| 硬门槛 / 软门槛 | 「硕士及以上」初筛过滤;「硕士优先」只是加分(Day 500) |
| ATS | 招聘管理系统,先抽 PDF 文字再按关键词搜人(Day 501) |
| 康熙部首 | 和常用汉字长得一样但编码不同的字符,会让搜索失败(Day 501) |
| 四步答题法 | 定义、机制、取舍、我测过或我做过(Day 502) |
| 退出码 | 进程结束时返回的整数,0 表示成功,CI 靠它判断红绿 |
| 海象运算符 | `:=`,在表达式里赋值,Python 3.8 起有(今天练习 1) |

## 常见误区

**脚本全绿就能投。** 本周每一个检查脚本都在全绿之后被人工读出过问题。体检通过只说明字面没毛病,意思对不对要你自己读。

**覆盖率高就先投。** zhaopin_rag 覆盖率 100%,是因为词典没收「微调」,分母只有 3。覆盖率之前先看分母,之后回 JD 原文看硬要求。

**「没报」等于「有出处」。** 练习编号 1 到 6 没报「记录里没有」,是因为 `f1` 到 `f6` 里的数字被收进了已知集合。对账只能证明数字出现过,不能证明它说的是同一件事。

**复习日看一遍就算复习了。** 看懂和写得出是两回事。我隔一天默写,四个函数错了两处,而且是本周刚踩过的坑。

**把检查逻辑复制到新脚本里。** `preflight` 全是 import,没有复制任何一行检查逻辑。复制的话,某天你修了 `has_alias`,体检里那一份还是旧的。

**体检脚本只给自己看,不用管退出码。** 退出码让它能直接接进 CI 或者 git hook,一改简历就自动跑,这比你记得每次手动跑可靠得多。

## 学习资料

### 文档与文章

- [Python 文档 · re 模块](https://docs.python.org/zh-cn/3.12/library/re.html):本周用到的环视、字符集合、非贪婪、`re.split` 带捕获组,全在「正则表达式语法」一节,对照错题清单查,30 分钟。
- [Python 文档 · sys](https://docs.python.org/zh-cn/3.12/library/sys.html):`sys.argv` 和 `sys.exit`,今天体检脚本的两头。
- [JSON Lines](https://jsonlines.org/):Day 502 日志用的格式,一页就讲完了。
- [Tech Interview Handbook · Behavioral Interview](https://www.techinterviewhandbook.org/behavioral-interview/):下周起面试题会越来越多地回到你的项目经历,先看它怎么准备「讲一个你做过的项目」这类问题。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rh41177ga&autoplay=0&high_quality=1" title="跨行业求职的跳槽简历怎么改,HR为什么说你的简历不匹配,HR是怎么看简历的,简历修改技巧" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>念念爸爸聊求职 · 跨行业求职的跳槽简历怎么改,HR为什么说你的简历不匹配 · 13 分钟,从 HR 的角度讲「不匹配」是怎么判出来的,和今天的关键词覆盖率对照看,想想你的简历在 HR 眼里匹配的是哪几项。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15b4y1m7NR&autoplay=0&high_quality=1" title="毫无相关经历/实习经历杂/转行跨行怎么写&投递简历?跨n行,面试50+次的折腾精现身说法!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>王二宝宝宝是个宝 · 转行跨行怎么写&投递简历 · 14 分钟,2021 年的视频,不是技术岗,但「经历和目标岗位怎么接上」「投递节奏」两段对转方向的人仍然有用,配合 Day 500 的换角度改写看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/O-kuHMOdjX4" title="Inside a Real AI Engineer Interview (Mock Interview + Evaluation)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Think in Models · Inside a Real AI Engineer Interview (Mock Interview + Evaluation) · 一场英文的 AI 工程师模拟面试加点评。频道不大,内容当一份参考,重点看面试官怎么从一个概念题追到候选人的项目上,对照你的四步答题法。</figcaption>
</figure>

### 书籍

- Gergely Orosz《The Tech Resume Inside Out》(自出版,2020):本周四天简历课的主要参考书,复习时把「常见错误」那一章和今天的错题清单对一遍,40 分钟。
- Gayle Laakmann McDowell《Cracking the Coding Interview》(第 6 版,CareerCup,2015;中文版《程序员面试金典》,人民邮电出版社):行为面试那一章讲怎么把一个项目讲成故事,下周的面试题会用到。

### 开源项目与代码

- [yangshun/tech-interview-handbook](https://github.com/yangshun/tech-interview-handbook):上面那个网站的源码仓库,简历和面试部分是 Markdown,可以直接在 GitHub 上读。
- [jsonresume/resume-schema](https://github.com/jsonresume/resume-schema):Day 501 提过的简历 JSON 格式,如果你想把 `resume_zh.json` 换成通用格式,对照它的字段改。

## 自测

1. 默写 `has_alias` 时只用 `\b`,哪两个用例会挂?为什么?

<details><summary>答案</summary>

「熟悉go语言」和「评测集与回归」。Python 3 正则默认按 Unicode 算,汉字是单词字符:go 两边是「悉」和「语」,评测后面是「集」,都不存在词边界。英文别名要用 `(?<![a-z0-9])...(?![a-z0-9])`,中文别名用子串判断。

</details>

2. `preflight` 为什么只对项目要点跑 `lint`,不对工作经历跑?

<details><summary>答案</summary>

`lint` 的口径规则是为项目要点设计的:要求有「在 N 条」「N 个」这类评测口径。工作经历的数字是「3 年」「35 条用例」这种规模描述,写法不同,拿去跑会成片误报。工作经历只做数字对账,出处是事实清单。

</details>

3. 体检报告里「缺 Go」为什么不计入问题数,而「PDF 两页」计入?

<details><summary>答案</summary>

缺的技能可能是你真不会的,Day 498 定过规矩:真不会就空着,不能为了凑覆盖率写上去,所以只提示。PDF 两页、链接不能点、要点数字找不到出处,都是简历本身的错,改了就好,所以计入并让退出码变成 1。门槛建议同理只提示,投不投你自己决定。

</details>

4. 体检退出码是 0,你还要做什么才投?

<details><summary>答案</summary>

人工读一遍。脚本查不了意思:因果有没有搭错、关键词有没有硬贴、英文行话对不对、每个数字是不是说的同一件事。再回 JD 原文看词典没收的硬要求(比如微调、地点)。最后自己出声讲一遍每条要点,确认每一条都接得住两层追问。

</details>

5. (面试题)「你简历上写评审与人工一致率 85%,这个数怎么来的?」用这一周的材料答。

<details><summary>答案</summary>

从记录表那一行讲口径:抽了 40 条做人工标注,其中 34 条和 LLM 评审的结论一致,34/40 = 85%。再讲它的局限:40 条样本不大,区间比较宽(第六部分讲过置信区间);一致率高不代表两边都对,还要看判错的那 6 条是假阳性还是假阴性。最后讲你怎么用它:一致率够了才把 LLM 评审接进 CI 当门禁。答到这一步,说明这个数字你是真算过的,不是写着好看。

</details>

## 明天预告

Day 504 · 面试(二):工具调用与 RAG 题。第一套题是模型和提示词,明天第二套,是 JD 里出现频率最高的两块:工具调用和 RAG。还是计时出声答、错题回炉,题库换成 `bank2.json`,实验会从 SupportPilot 的工具和检索里取数字。
