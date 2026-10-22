---
title: 'Day 650 · 第 93 周复习:作品(Day 644–649)'
description: '这一周从 Staff 系统设计的最后两道真题,走到带人推动、开源贡献、自己的项目和写作、资深结业谈薪,最后开了作品篇的头。今天不学新东西:画一张图把六天串起来,默写 pass^k 和薪资折算两段最容易写错的代码,用穷举和原版对照证明默写对了,再拼一个只用本周知识的小工具,从竞品表生成一段 30 秒的面试回答并检查它真的只要 30 秒。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'agent-loupe', 'career', 'python', 'agent-zero']
series: 'agent-zero'
day: 650
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 649](/blog/agent-zero/day-649-loupe-why/) 开了第十一部分的头。一个查三城气温的小 Agent 跑了 15.9 秒,终端日志看不出慢在哪;给每一步记下起止时间画成瀑布图,才看到三次工具调用首尾相接占了 89%。做减法量出第 0 步 310 个输入 token 里 272 个是工具定义。最后五家竞品放进一张带出处的表,结果和预期不一样:逐步对比和中途重跑都已经有人做到,只有「上下文构成」五家都没查到。

这一周跨度很大,前五天还在第十部分讲面试、影响力和谈薪,最后一天已经在给新作品做调研。其实它们说的是同一件事:**你做过的东西,要能被别人看见、被别人验证。** 今天把这条线画出来,把两段最容易写错的代码默写一遍,再用本周学的东西做一个小工具,给 Loupe 准备一段面试回答。

## 今天要解决的问题

复习日不加新概念。今天结束时你应该能:

1. 不看文章画出本周知识地图,说出每一天解决的是「答、推、公开、定位、开新」里的哪一件,以及每一天留下了哪个后面还会用的脚本。
2. 默写 [Day 644](/blog/agent-zero/day-644-staff-sd-2/) 的 `pass_at_k` / `pass_hat_k` 和 [Day 648](/blog/agent-zero/day-648-senior-graduation/) 的 `annual_wan`,并用两个检查脚本证明默写版和标准答案在几百组输入上一致。
3. 跑通本周小项目 `part11/review93.py`:从 Day 649 的竞品表生成「为什么不直接用 LangSmith」的 30 秒回答,用 [Day 647](/blog/agent-zero/day-647-open-source-2/) 的语速估算检查时长,用 Day 644 的三条标准检查内容。
4. 说出本周最容易犯的几个错:评测只报 pass@k、按团队数报采用率、把模型写的 PR 描述原样贴、删掉 `.env` 就以为安全、拿年限对标薪资、把「没查到」写成「没有」。

预计用时 3 到 4 小时,大头在默写和练习。前置:[Day 644](/blog/agent-zero/day-644-staff-sd-2/) 到 [Day 649](/blog/agent-zero/day-649-loupe-why/) 全部。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

先看全貌。上面一行是五件事,下面一行是每件事留下来、今天会用到的零件:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="第 93 周知识地图:答、推、公开、定位、开新五段,对应 Day 644 到 649">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">第 93 周:做过的东西,要能被别人看见、被别人验证</text>
<rect x="20" y="40" width="108" height="110" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="74" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">答:面试</text>
<text x="30" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">644 并发估算</text>
<text x="30" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">644 pass^k</text>
<text x="30" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">644 30 秒快答</text>
<rect x="140" y="40" width="108" height="110" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="194" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">推:公司内</text>
<text x="150" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">645 一页纸</text>
<text x="150" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">645 采用率</text>
<text x="150" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">645 Wilson</text>
<rect x="260" y="40" width="120" height="110" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">公开:对外</text>
<text x="270" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">646 PR 四段</text>
<text x="270" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">647 开源前检查</text>
<text x="270" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">647 讲稿字数</text>
<rect x="392" y="40" width="108" height="110" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="446" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">定位:结业</text>
<text x="402" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">648 自检表</text>
<text x="402" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">648 分位数</text>
<text x="402" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">648 先谈职级</text>
<rect x="512" y="40" width="108" height="110" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="566" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">开新:Loupe</text>
<text x="522" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">649 看不清</text>
<text x="522" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">649 瀑布图</text>
<text x="522" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">649 竞品表</text>
<line x1="128" y1="95" x2="140" y2="95" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="248" y1="95" x2="260" y2="95" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="380" y1="95" x2="392" y2="95" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="500" y1="95" x2="512" y2="95" stroke="var(--ink-soft)" stroke-width="1.5"/>
<rect x="20" y="190" width="108" height="46" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="74" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">passk.py</text>
<text x="74" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">默写一</text>
<rect x="140" y="190" width="108" height="46" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="194" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">wilson.py</text>
<text x="194" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">错题</text>
<rect x="260" y="190" width="120" height="46" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">talk_time.py</text>
<text x="320" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">小项目</text>
<rect x="392" y="190" width="108" height="46" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="446" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">pay_stats.py</text>
<text x="446" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">默写二</text>
<rect x="512" y="190" width="108" height="46" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="566" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">competitors</text>
<text x="566" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">小项目</text>
<line x1="74" y1="150" x2="74" y2="190" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="194" y1="150" x2="194" y2="190" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="320" y1="150" x2="320" y2="190" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="446" y1="150" x2="446" y2="190" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="566" y1="150" x2="566" y2="190" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="320" y="272" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">小项目 = 649 的竞品表 + 647 的语速 + 644 的三条标准</text>
</svg>
<figcaption>本周知识地图。上面一行是五件事,下面一行是今天要用的零件。琥珀色和蓝色两个零件会在小项目里拼到一起。</figcaption>
</figure>

这张图从左往右读,是一个人的视角在往外扩:Day 644 在面试的 45 分钟里说服一个面试官;Day 645 在公司里花几周说服一群同事;Day 646、647 面对不认识你的维护者和读者,能被他们看见的只有公开的东西;Day 648 回头看自己手里到底有多少能拿出来的证据;Day 649 开始做一个新的、能被所有人点开的作品。

每一段都有一个共同的动作:**把「我觉得」换成一个能检查的东西。** pass^k 把「这个 Agent 还行」换成连续五次都对的概率;Wilson 区间把「好三倍」换成两个区间;`pr_lint.py` 把「描述写得挺清楚」换成四段齐不齐;`talk_time.py` 把「开场写了挺多」换成 183 个字;`self_check.py` 把「我学过」换成文件在不在;竞品表把「没人做过」换成每一格的出处。

## 本周每天一句话

- [Day 644](/blog/agent-zero/day-644-staff-sd-2/):真题二用两次利特尔定律算出十万并发需要 3.3 万个在途模型请求、人工只扛得住 6% 的转人工率;真题三讲 pass@k 和 pass^k,两个版本要配对比较;八条追问各准备 30 秒。
- [Day 645](/blog/agent-zero/day-645-influence/):影响力大部分是把别人担心的东西提前算清楚,一页纸第一句写要的决定,采用率按调用量算,「AI 不靠谱」用 Wilson 区间和人工基线回应。
- [Day 646](/blog/agent-zero/day-646-open-source-1/):国内 JD 真在说开源贡献的约 17%;几个 Agent 框架最近 50 个关闭的 PR 里首次贡献者一个没合;PR 描述四段并用 `pr_lint.py` 检查,模型写的「How I verified」会编东西。
- [Day 647](/blog/agent-zero/day-647-open-source-2/):开源前 `release_check.py` 查出 7 个问题,修好后历史里还有两个假 key;写作要有数据;20 分钟的分享要四千多字,开场 183 字不到一分钟。
- [Day 648](/blog/agent-zero/day-648-senior-graduation/):自检表每行要有能打开的证据;资深职位名的挂牌中位 66 到 72 万,年限不怎么决定薪资;offer 拆到四年比,先谈职级,期权按 0 计。
- [Day 649](/blog/agent-zero/day-649-loupe-why/):调 Agent 痛在看不清每一步,瀑布图看出 89% 在等顺序执行的工具;五家竞品表里只有上下文构成没人做到。

## 准备环境

今天要用到这一周的几个文件。在 `agent-zero-lab/` 根目录确认它们都在,并且跑出来和当天文章一致:

```bash
cd /Users/你/agent-zero-lab
uv run python -m part10.passk
uv run python -m part10.pay_stats
uv run python -m part10.talk_time part10/samples/talk.md | tail -2
uv run python -m part11.check_competitors part11/competitors.json | tail -3
```

```text
k=1:pass@k 0.67   pass^k 0.67
k=3:pass@k 0.90   pass^k 0.43
k=5:pass@k 0.97   pass^k 0.36
改日期格式:10 次成功 10 次,pass^5 = 1.000
修分页越界:10 次成功 7 次,pass^5 = 0.083
加缓存失效:10 次成功 3 次,pass^5 = 0.000
16 条,P25 54 万,中位 70 万,P75 93 万
最低 21 万,最高 243 万,80 万以上 7 条
只写「高级」的 4 条:[21.0, 36.0, 66.5, 82.5]
问答     预算  3 分钟  稿子    0 字 ≈  0.0 分钟  (没写稿,临场讲)
总预算 20 分钟
逐步对比:已有 LangSmith
中途重跑整条:已有 LangSmith、Laminar
上下文构成:没有一家完整做到 ← 空白点
```

`part10/passk.py` 是 Day 644 建的,`part10/pay_stats.py` 和 `part10/samples/senior_pay.json` 是 Day 648 建的,`part10/talk_time.py` 和 `part10/samples/talk.md` 是 Day 647 建的,`part11/competitors.json` 和 `check_competitors.py` 是 Day 649 建的。哪个文件没有,回到那一天把它补上;数字对不上,先别往下走,说明你那天的代码和文章不一样。

## 默写一:`pass_at_k` 和 `pass_hat_k`

为什么挑这两个函数:它们只有五行,但公式里四个变量 n、c、k 和组合数的位置很容易写乱,而且写错了不会报错,只会给出一个看起来合理的小数。面试里被要求现场写的也常常是这种。

合上 Day 644,在 `part10/passk_mine.py` 里写出两个函数。下面是我第一次默写的样子,`pass_at_k` 对了,`pass_hat_k` 凭直觉写成了「每次成功率的 k 次方」:

```python
# agent-zero-lab/part10/passk_mine.py(默写版,第一次写错的样子)
from math import comb


def pass_at_k(n: int, c: int, k: int) -> float:
    if n - c < k:
        return 1.0
    return 1 - comb(n - c, k) / comb(n, k)


def pass_hat_k(n: int, c: int, k: int) -> float:
    return (c / n) ** k
```

<div class="line-notes">

- `if n - c < k:` 失败次数比 k 还少,挑 k 次一定能挑到一次成功,直接返回 1。
- `return 1 - comb(n - c, k) / comb(n, k)` 「从 n 次里随机挑 k 次,全挑到失败」的概率取反。这一行我默写对了。
- `return (c / n) ** k` 错的那一行。`(c / n) ** k` 是「每次独立地以 c/n 的概率成功,连续 k 次都成功」,相当于**有放回**地抽;Day 644 的公式是从已经跑出来的 n 次结果里**不放回**地挑 k 次。两者在 n 很大时接近,n 小时差很多。

</div>

怎么证明默写对没对?不要和自己的记忆比,和定义比。pass@k 的定义是「从 n 次结果里挑 k 次,至少有一次成功」,那就真的把所有挑法列出来数一遍。这叫**穷举**:n 只到 10,所有挑法加起来也就几千种,电脑一眨眼就数完了。

```python
# agent-zero-lab/part10/check_passk.py
from itertools import combinations

from part10.passk_mine import pass_at_k, pass_hat_k


def brute(n: int, c: int, k: int) -> tuple[float, float]:
    runs = [True] * c + [False] * (n - c)
    picks = list(combinations(runs, k))
    at = sum(any(p) for p in picks) / len(picks)
    hat = sum(all(p) for p in picks) / len(picks)
    return at, hat


bad = 0
cases = 0
for n in range(1, 11):
    for c in range(n + 1):
        for k in range(1, n + 1):
            cases += 1
            want_at, want_hat = brute(n, c, k)
            got_at, got_hat = pass_at_k(n, c, k), pass_hat_k(n, c, k)
            if abs(got_at - want_at) > 1e-9 or abs(got_hat - want_hat) > 1e-9:
                bad += 1
                if bad <= 3:
                    print(f"n={n} c={c} k={k}:pass@k {got_at:.3f}/{want_at:.3f}  pass^k {got_hat:.3f}/{want_hat:.3f}")
print(f"{cases} 组,{bad} 组不一致")
```

<div class="line-notes">

- `from itertools import combinations` `combinations(列表, k)` 列出从列表里不放回地挑 k 个的所有挑法,和 `comb(n, k)` 是同一件事,一个给你清单,一个只给你个数。
- `runs = [True] * c + [False] * (n - c)` 造出 n 次运行的结果:c 个成功、n−c 个失败。n=3、c=1 时是 `[True, False, False]`。列表乘整数是重复,≈ JS 的 `Array(c).fill(true)`。
- `picks = list(combinations(runs, k))` n=3、c=1、k=2 时有 3 种挑法:`(True, False)`、`(True, False)`、`(False, False)`。两个 False 位置不同,算两种。
- `at = sum(any(p) for p in picks) / len(picks)` `any(p)` 是「这一挑里至少一个 True」,≈ JS 的 `p.some(Boolean)`。上面的例子是 2/3。
- `hat = sum(all(p) for p in picks) / len(picks)` `all(p)` 是「全是 True」,≈ `p.every(Boolean)`。上面的例子一次都没有,是 0:只有 1 次成功,挑 2 次不可能全成功。
- `for n in range(1, 11):` 三层循环把 n 从 1 到 10、c 从 0 到 n、k 从 1 到 n 全跑一遍,一共 440 组。
- `if abs(got_at - want_at) > 1e-9 or abs(got_hat - want_hat) > 1e-9:` 小数比较不用 `==`,差得足够小就算相等,≈ JS 里比较浮点数时用 `Math.abs(a - b) < 1e-9`。
- `if bad <= 3:` 只打印前三组不一致,看个样子就够,不然 284 行刷屏。

</div>

```bash
uv run python -m part10.check_passk
```

```text
n=2 c=1 k=2:pass@k 1.000/1.000  pass^k 0.250/0.000
n=3 c=1 k=2:pass@k 0.667/0.667  pass^k 0.111/0.000
n=3 c=1 k=3:pass@k 1.000/1.000  pass^k 0.037/0.000
440 组,284 组不一致
```

第一组就把问题说清楚了:跑了 2 次成功 1 次,问「挑 2 次全成功」的概率。从这 2 次结果里挑 2 次,只能把两次都挑上,其中一次是失败,所以是 0。我写的 `(1/2) ** 2 = 0.25`,是在假设还能再跑出新的成功。把最后一行改回 Day 644 的 `comb(c, k) / comb(n, k)` 再跑:

```text
440 组,0 组不一致
```

这个检查方法值得记住,不只是复习用:**公式写不准时,写一个慢但一看就对的穷举版本,在小范围里和公式逐个比。** 面试里写完公式,补一句「我会用穷举在 n ≤ 10 上验证」,通常比把公式背得滚瓜烂熟更打动人。

## 默写二:`annual_wan`

第二段挑 Day 648 的薪资折算。它的难点不在算式,在正则:JD 上的薪资字符串格式不统一,漏一种写法,那一条就会悄悄变成 `None`,被后面的分位数计算静默丢掉,你拿到的中位数就偏了,还不知道。

合上 Day 648,在 `part10/pay_mine.py` 里默写。我第一次的版本:

```python
# agent-zero-lab/part10/pay_mine.py(默写版,第一次写错的样子)
import re

SALARY = re.compile(r"(\d+)-(\d+)K(?:·(\d+)薪)?")


def annual_wan(text: str) -> float | None:
    m = SALARY.search(text)
    if not m:
        return None
    lo, hi = int(m.group(1)), int(m.group(2))
    months = int(m.group(3)) if m.group(3) else 12
    return (lo + hi) / 2 * months / 10
```

<div class="line-notes">

- `SALARY = re.compile(r"(\d+)-(\d+)K(?:·(\d+)薪)?")` 错在这一行:只写了大写 `K`。Day 648 专门讲过 Boss 写大写、猎聘写小写,原版是 `[kK]`。
- `if not m:` 没匹配上就返回 `None`。正是这一行让写错的正则不报错。
- `months = int(m.group(3)) if m.group(3) else 12` 「·16薪」那一段没写时按 12 薪。
- `return (lo + hi) / 2 * months / 10` 月薪中点乘薪数,千元换算成万元。`35-60K·14薪` 是 66.5 万。

</div>

检查脚本拿 Day 648 的 16 条真实样本,再加几条边界情况,逐条和原版 `pay_stats.annual_wan` 比:

```python
# agent-zero-lab/part10/check_pay.py
import json
from pathlib import Path

from part10 import pay_mine, pay_stats

jobs = json.loads(Path("part10/samples/senior_pay.json").read_text(encoding="utf-8"))
texts = [j["salary"] for j in jobs] + ["面议", "8-12K", "100-150K·13薪", "40-70k"]
bad = 0
for t in texts:
    want, got = pay_stats.annual_wan(t), pay_mine.annual_wan(t)
    if want != got:
        bad += 1
        print(f"{t!r}:原版 {want},默写版 {got}")
print(f"{len(texts)} 条,{bad} 条不一致")
```

<div class="line-notes">

- `from part10 import pay_mine, pay_stats` 把两个模块整个导进来,用 `pay_stats.annual_wan` 和 `pay_mine.annual_wan` 区分同名函数。`pay_stats.py` 的打印代码在 main guard 下面,导入时不会跑。
- `texts = [j["salary"] for j in jobs] + ["面议", "8-12K", "100-150K·13薪", "40-70k"]` 16 条真实样本加 4 条边界:匹配不上的「面议」、个位数下限、三位数月薪、小写 k 不带薪数。边界情况是故意挑的,真实样本里不一定每种都有。
- `if want != got:` 两边都是 `None` 时 `None != None` 是 False,算一致,这正是我们要的:「面议」两边都该返回 `None`。
- `print(f"{t!r}:原版 {want},默写版 {got}")` `!r` 打印带引号的原样字符串,≈ JS 的 `JSON.stringify(t)`,空格和特殊字符看得清。

</div>

```bash
uv run python -m part10.check_pay
```

```text
'40-70k·15薪':原版 82.5,默写版 None
'70-100k·18薪':原版 153.0,默写版 None
'20-40k':原版 36.0,默写版 None
'40-70k':原版 66.0,默写版 None
20 条,4 条不一致
```

4 条小写 k 全丢了,其中 3 条是真实样本。如果这是在跑 Day 648 的完整 557 条数据,猎聘来的那一批会整体消失,而分位数函数一声不吭。把 `K` 改成 `[kK]` 再跑:

```text
20 条,0 条不一致
```

两段默写有一个共同点:**写错的版本都能跑,都不报错,都给出看起来合理的数字。** 所以默写完不能只看「能跑」,一定要有一个能对答案的东西。

## 本周小项目:30 秒回答「为什么不直接用 LangSmith」

Day 649 说过,面试官十有八九会问这句。本周正好学了三样能用上的东西:Day 649 的竞品表(事实)、Day 647 `talk_time.py` 的语速估算(时长)、Day 644 对 30 秒回答的要求(有数字、有代价、有边界)。今天把它们拼成一个小工具:从竞品表里读出谁做到了什么、空白在哪,填进回答模板,再检查时长和内容。

为什么不直接手写一段?因为竞品表会变。下个月你重查一遍,LangSmith 可能加了上下文视图,表一改,回答跟着变,不用担心面试时说出一句过期的话。

```python
# agent-zero-lab/part11/review93.py
import json
import re
import sys
from pathlib import Path

from part10.talk_time import CJK, RATE

data = json.loads(Path("part11/competitors.json").read_text(encoding="utf-8"))
caps: list[str] = data["capabilities"]
tools: dict[str, dict[str, dict[str, str]]] = data["tools"]
has = {cap: [t for t, cells in tools.items() if cells[cap]["level"] == "有"] for cap in caps}
gaps = [cap for cap in caps if not has[cap]]
strong = sorted({t for names in has.values() for t in names})
FACT = "比如我的天气 Agent 第 0 步 310 个输入 token 里,272 个是工具定义。"


def draft(long: bool) -> str:
    parts = [f"生产监控我会直接用 {'、'.join(strong)},它们记录和看 trace 比我做得全。"]
    if long:
        parts.append("Loupe 只管开发时的调试:不绑框架,直接导入 trace 文件;重跑时工具结果走回放,带写操作的 Agent 也能安全地从中间重跑。")
    else:
        parts.append("Loupe 只管开发时调试,不绑框架,重跑时工具走回放。")
    parts.append(f"它还画出每一步的{gaps[0]},我查了 {len(tools)} 家文档都没找到。")
    parts.append(FACT)
    return "".join(parts)


def check(text: str) -> tuple[int, float, list[str]]:
    chars = len(CJK.findall(text))
    seconds = chars / RATE * 60
    problems: list[str] = []
    if seconds > 30:
        problems.append(f"约 {seconds:.0f} 秒,超过 30 秒")
    if not re.search(r"\d", text):
        problems.append("没有一个具体数字")
    if not any(t in text for t in tools):
        problems.append("没提竞品,听起来像没调研")
    if not any(g in text for g in gaps):
        problems.append("没说出真正的空白点")
    return chars, seconds, problems


if __name__ == "__main__":
    print(f"空白点:{gaps};已有人做到的:{strong}")
    for name, long in (("长版", True), ("短版", False)):
        text = draft(long)
        chars, seconds, problems = check(text)
        print(f"\n[{name}] {text}\n  {chars} 个汉字 ≈ {seconds:.0f} 秒 " + ("通过" if not problems else ";".join(problems)))
    sys.exit(0)
```

<div class="line-notes">

- `from part10.talk_time import CJK, RATE` 复用 Day 647 的汉字正则和语速假设(每分钟 220 字)。`talk_time.py` 的运行代码在 main guard 下面,只导入两个常量。
- `tools: dict[str, dict[str, dict[str, str]]] = data["tools"]` 三层字典:工具名 → 能力名 → 那一格的 `level/note/source`。标注写全,下面 `cells[cap]["level"]` 编辑器才知道是字符串。
- `has = {cap: [t for t, cells in tools.items() if cells[cap]["level"] == "有"] for cap in caps}` 字典推导式套列表推导式:每项能力对应「做到了的工具名单」。实测 `{"逐步对比": ["LangSmith"], "中途重跑整条": ["LangSmith", "Laminar"], "上下文构成": []}`。
- `gaps = [cap for cap in caps if not has[cap]]` 名单为空的能力就是空白点,实测只有「上下文构成」。
- `strong = sorted({t for names in has.values() for t in names})` 集合推导式去重:LangSmith 在两项里都出现,只留一次。`sorted` 让顺序固定,每次生成的回答一样。
- `FACT = "比如我的天气 Agent 第 0 步 310 个输入 token 里,272 个是工具定义。"` 能验证的那个例子,来自 Day 649 的实测,不是从表里读的。
- `def draft(long: bool) -> str:` 生成长短两个版本,看时长差多少。
- `parts.append(f"它还画出每一步的{gaps[0]},我查了 {len(tools)} 家文档都没找到。")` 空白点和「查了几家」都从表里读。表里加一行,这里自动变成 6 家。
- `chars = len(CJK.findall(text))` 只数汉字,和 `talk_time.py` 一样。这里有个口径问题,练习 2 会把它挖出来。
- `seconds = chars / RATE * 60` 每分钟 220 字,换算成秒。
- `if not any(t in text for t in tools):` 回答里至少点名一家竞品。`any(...)` 里是生成器,≈ JS 的 `tools.some(t => text.includes(t))`。

</div>

```bash
uv run python -m part11.review93
```

```text
空白点:['上下文构成'];已有人做到的:['Laminar', 'LangSmith']

[长版] 生产监控我会直接用 Laminar、LangSmith,它们记录和看 trace 比我做得全。Loupe 只管开发时的调试:不绑框架,直接导入 trace 文件;重跑时工具结果走回放,带写操作的 Agent 也能安全地从中间重跑。它还画出每一步的上下文构成,我查了 5 家文档都没找到。比如我的天气 Agent 第 0 步 310 个输入 token 里,272 个是工具定义。
  104 个汉字 ≈ 28 秒 通过

[短版] 生产监控我会直接用 Laminar、LangSmith,它们记录和看 trace 比我做得全。Loupe 只管开发时调试,不绑框架,重跑时工具走回放。它还画出每一步的上下文构成,我查了 5 家文档都没找到。比如我的天气 Agent 第 0 步 310 个输入 token 里,272 个是工具定义。
  80 个汉字 ≈ 22 秒 通过
```

两版都「通过」了,但别急着拿去用。我把长版念出来读了一遍,发现两个问题,检查器一个都没抓到:

第一,**第一句话说错了。** 「生产监控我会直接用 Laminar、LangSmith」:Laminar 在表里是「有」,是因为它能中途重跑,不是因为它是我会选的生产监控平台。模板把「在某一项上做到了」的工具,塞进了一句讲「生产监控」的话里。数据是对的,句子是错的。这是 Day 646 里模型写 PR 描述时编东西的另一种形态:不是模型编,是模板拼的时候换了意思。

第二,**28 秒是估少了。** 长版里有 Laminar、LangSmith、trace、Agent、310 这些英文词和数字,念起来都要时间,`CJK` 一个都没数。

这两个问题留给练习 2 和练习 3。小项目真正要你练的是这个习惯:**脚本检查过了,也要用人的眼睛和嘴再过一遍。** Day 644 的 `drill.py` 给「每小时」答成「每月」的回答打满分,是同一件事。

### 零件和小项目的对照

| 小项目里的哪一段 | 来自哪一天的哪个零件 |
| --- | --- |
| `has`、`gaps` 从竞品表算出谁做到了、空白在哪 | Day 649 `check_competitors.py` 最后那段统计 |
| `CJK`、`RATE`、`chars / RATE * 60` | Day 647 `talk_time.py` |
| 「有数字、点名竞品、说出空白」三条检查 | Day 644 30 秒回答的三样东西(数字或机制、代价、边界),换成这道题的版本 |
| 先承认对方强项、再说前提和取舍 | Day 645 回应质疑的顺序:先听完对方的担心,再用数据回应 |
| 整段回答本身 | Day 649 自测第 5 题 |

## 本周错题与坑清单

按「写代码时的坑」和「判断上的坑」分两类。每条后面括号里是出处,忘了就回去看那一天。

**写代码时:**

- `pass_hat_k` 写成 `(c / n) ** k`:有放回和不放回搞混,n 小时差很多,不报错(今天默写一)。
- 薪资正则只写大写 `K`:小写 k 的条目静默变成 `None`,分位数照算不误(今天默写二,Day 648)。
- `waterfall.py` 把各步时长直接相加:一并行就算出 191%(Day 649 练习 2,今天练习 1 修)。
- `drill.py` 在模块顶层直接跑代码、没有 main guard:别的文件想 `import` 它的 `GRADER` 就会把整个练习跑一遍,所以今天练习 4 自己写了一份提示词(Day 644)。
- 用文件路径跑带 `from common...` 的脚本:`ModuleNotFoundError: No module named 'common'`,要在根目录用 `-m`(Day 649)。
- 删掉 `.env` 再提交:当前文件干净,历史里的 key 还在,要先作废 key(Day 647)。
- 在 `os.environ.get` 里写默认 key:便利的代价是 key 跟着代码一起公开(Day 647)。

**判断上:**

- 评测只报 pass@k:pass@5 = 0.97 很好看,pass^5 = 0.36 才是用户每天的体验(Day 644)。
- 两个版本比两个百分比:同一批任务要配对比较(Day 644)。
- 按团队数报采用率:「接入 3/5」和「43% 的调用经过平台」是同一个月(Day 645)。
- 只报点估计:0.4% 对 1.2% 两个区间是重叠的,不能说好三倍(Day 645)。
- 把模型写的 PR 描述原样贴上去:它在「How I verified」里编过不存在的文件(Day 646)。
- 用 coding agent 批量刷 PR:2026 年最快毁掉信誉的办法(Day 646)。
- 写观点不写数据:「数据」那一节是空的,文章和演讲都卡在那(Day 647)。
- 拿年限对标薪资:5–10 年中位 54 万,和整体 48 万差不多,资深职位名才 72 万(Day 648)。
- 把期权当现金:纸面 100 万要 46% 的概率兑现才打平(Day 648)。
- 把「没查到」写成「没有」,以及竞品调研只查自己知道的那几家:不查就不会知道 Laminar(Day 649)。

## 动手练习

**练习 1:修好瀑布图的百分比。** Day 649 练习 2 发现 `waterfall.py` 把并行的三段工具时间加成了 15.34 秒、191%。写 `part11/ex650_union.py`,把同一类步骤的时间区间合并重叠部分后再算总长,对顺序版和并行版两条 trace 都跑一遍。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part11/ex650_union.py
import json
import sys
from pathlib import Path


def busy(intervals: list[tuple[float, float]]) -> float:
    merged: list[list[float]] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return sum(e - s for s, e in merged)


steps = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["steps"]
wall = max(s["end"] for s in steps)
for kind in ("llm", "tool"):
    spans = [(s["start"], s["end"]) for s in steps if s["kind"] == kind]
    naive = sum(e - s for s, e in spans)
    real = busy(spans)
    print(f"{kind:<4} 直接相加 {naive:5.2f}s({naive / wall:.0%})  合并重叠 {real:5.2f}s({real / wall:.0%})")
```

<div class="line-notes">

- `merged: list[list[float]] = []` 合并后的区间。用列表而不是元组,因为下面要改它的结束时间,元组不能改(Day 647 `talk_time.py` 里讲过)。
- `for start, end in sorted(intervals):` 元组排序先比第一个元素,所以按开始时间从早到晚处理。并行版三段实测是 `(1.22, 6.14)`、`(1.22, 5.77)`、`(1.23, 7.1)`,开始时间相同时再比结束时间,所以 5.77 结束的那段排在最前。
- `if merged and start <= merged[-1][1]:` 这一段的开始不晚于上一段的结束,说明重叠(或首尾相接),合并。`merged and` 先确认列表不空,空列表当假。
- `merged[-1][1] = max(merged[-1][1], end)` 合并就是把上一段的结束时间延长到两者中更晚的那个。三段合并完是一段,从 1.22 到 7.1,长 5.88 秒。
- `merged.append([start, end])` 不重叠就开一个新区间。顺序版的三段首尾相接,`start <= end` 成立,也会被合并,但长度不变。
- `return sum(e - s for s, e in merged)` 合并后每段的长度加起来。
- `naive = sum(e - s for s, e in spans)` 原来 `waterfall.py` 的算法,留着对比。

</div>

```bash
uv run python -m part11.ex650_union part11/runs/weather_parallel.json
uv run python -m part11.ex650_union part11/runs/weather_run.json
```

```text
llm  直接相加  2.17s(27%)  合并重叠  2.17s(27%)
tool 直接相加 15.34s(191%)  合并重叠  5.88s(73%)
llm  直接相加  1.81s(11%)  合并重叠  1.81s(11%)
tool 直接相加 14.10s(89%)  合并重叠 14.10s(89%)
```

并行版的工具时间从 191% 变成 73%,27% + 73% = 100%,和总时长对上了。顺序版两种算法结果一样,所以 Day 649 正文里那个 89% 没有错,只是算法碰巧对。Day 662 画正式时间轴时要统计「这一类步骤占了多少时间」,用的就是这种合并后的口径。

</details>

**练习 2:把英文词也算进时长。** 小项目只数汉字,念的时候 Laminar、trace、310 都要花时间。写 `part11/ex650_speech.py`,把每个英文单词和每串数字按一个汉字的时间算,重新估算长版和短版。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part11/ex650_speech.py
import re

from part10.talk_time import CJK, RATE
from part11.review93 import draft

WORD = re.compile(r"[A-Za-z]+|\d+")

for name, long in (("长版", True), ("短版", False)):
    text = draft(long)
    chars = len(CJK.findall(text))
    words = len(WORD.findall(text))
    old = chars / RATE * 60
    new = (chars + words) / RATE * 60
    flag = "超时" if new > 30 else "通过"
    print(f"{name}:汉字 {chars},英文词和数字 {words};只数汉字 {old:.0f} 秒,算上英文 {new:.0f} 秒 {flag}")
```

<div class="line-notes">

- `from part11.review93 import draft` 复用小项目的回答生成函数。`review93.py` 的打印在 main guard 里,导入时不会跑。
- `WORD = re.compile(r"[A-Za-z]+|\d+")` 一串连续的英文字母算一个词,一串连续的数字也算一个。`|` 是「或」。`310` 算一个,`LangSmith` 算一个。
- `new = (chars + words) / RATE * 60` 每个英文词、每串数字按一个汉字的时间算。这也是假设,「LangSmith」实际念起来比一个汉字长,真准的办法是自己念一遍掐表(Day 647 练习 4)。

</div>

```bash
uv run python -m part11.ex650_speech
```

```text
长版:汉字 104,英文词和数字 12;只数汉字 28 秒,算上英文 32 秒 超时
短版:汉字 80,英文词和数字 10;只数汉字 22 秒,算上英文 25 秒 通过
```

长版其实超时了。技术类的回答英文词特别多,只数汉字会系统性地估少。用短版,或者自己念一遍掐表。

</details>

**练习 3:修好那句说错的话。** 小项目第一句把 Laminar 说成了「我会直接用的生产监控」。写 `part11/ex650_accurate.py`,生成一个新版本:按能力说清楚谁做到了哪一项,再说 Loupe 的取舍和空白,仍然要通过 `check()`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part11/ex650_accurate.py
from part11.review93 import FACT, caps, check, gaps, has


def draft_v2() -> str:
    done = [f"{'、'.join(has[c])} 能{c}" for c in caps if has[c]]
    return (f"{','.join(done)},生产监控我也会用现成平台。"
            "Loupe 只管开发时调试,不绑框架,重跑时工具走回放。"
            f"它还画出每一步的{gaps[0]},这个我没查到有人做。" + FACT)


if __name__ == "__main__":
    text = draft_v2()
    chars, seconds, problems = check(text)
    print(text)
    print(f"{chars} 个汉字 ≈ {seconds:.0f} 秒 " + ("通过" if not problems else ";".join(problems)))
```

<div class="line-notes">

- `from part11.review93 import FACT, caps, check, gaps, has` 导入的是模块里已经算好的变量和函数。导入时模块顶层那几行(读 JSON、算 `has`)会执行一次,这是我们要的;打印在 main guard 里,不会跑。
- `done = [f"{'、'.join(has[c])} 能{c}" for c in caps if has[c]]` 只对有人做到的能力生成一小句,实测是 `["LangSmith 能逐步对比", "LangSmith、Laminar 能中途重跑整条"]`。
- `f"它还画出每一步的{gaps[0]},这个我没查到有人做。"` 「没查到」而不是「都没有」,和竞品表的口径一致。
- `if __name__ == "__main__":` 练习 4 要导入 `draft_v2`,打印放进 main guard。我第一次没加,练习 4 一跑,这段回答被打印了两遍。

</div>

```bash
uv run python -m part11.ex650_accurate
```

```text
LangSmith 能逐步对比,LangSmith、Laminar 能中途重跑整条,生产监控我也会用现成平台。Loupe 只管开发时调试,不绑框架,重跑时工具走回放。它还画出每一步的上下文构成,这个我没查到有人做。比如我的天气 Agent 第 0 步 310 个输入 token 里,272 个是工具定义。
83 个汉字 ≈ 23 秒 通过
```

每一句话现在都能对回表里的某一格。读起来没有原来顺,但面试官追问「Laminar 能做什么」时,你不会被自己的第一句话绊倒。真正上场前,把它改成自己的口语,意思别变。

</details>

**练习 4:让模型当面试官听一遍。** 照 Day 644 `drill.py` 的写法,写 `part11/ex650_grade.py`:系统提示词设定面试官和三条打分标准(承认现有工具强项、说清前提和取舍、有能验证的例子),把练习 3 的回答发过去,要它给分数、最缺的一点、下一句追问。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part11/ex650_grade.py
import json

from common.llm import LLMClient
from part11.ex650_accurate import draft_v2

GRADER = """你是资深 Agent 工程师岗位的面试官。你问候选人:「这不就是 LangSmith 吗?你为什么要自己做一个?」
候选人用 30 秒回答。按三条打分:有没有承认现有工具的强项、有没有说清自己的前提和取舍、有没有一个能验证的具体例子。
只输出 JSON:{"score": 1到3的整数, "missing": "最缺的一点,一句话", "follow_up": "你接下来最想追问的一句话"}"""

llm = LLMClient()
r = llm.chat([{"role": "system", "content": GRADER}, {"role": "user", "content": draft_v2()}],
             temperature=0, response_format={"type": "json_object"})
verdict = json.loads(r.content)
print(f"{verdict['score']} 分;缺:{verdict['missing']}\n追问:{verdict['follow_up']}")
print(llm.ledger)
```

<div class="line-notes">

- `GRADER = """你是资深 Agent 工程师岗位的面试官。` 三条标准写死在提示词里,和 Day 644 一样,比「你觉得怎么样」稳。
- `"follow_up": "你接下来最想追问的一句话"` 比 Day 644 多要了一样东西:下一句追问。分数用处不大,追问才是你要提前准备的。
- `temperature=0, response_format={"type": "json_object"})` 提示词里有「JSON」字样,满足 DeepSeek JSON mode 的要求。
- `verdict = json.loads(r.content)` 解析成字典取三个字段。

</div>

```bash
uv run python -m part11.ex650_grade
```

```text
3 分;缺:没有说明为什么现有平台的上下文可视化不够用、自己做的增量价值边界在哪
追问:如果 LangSmith 下个版本也画出每步的上下文构成,你的 Loupe 还剩下什么不可替代的?
1 次调用 | 输入 213 / 输出 59 tokens | 约 ¥0.0009
```

花了 0.0009 元(`213 × 2 + 59 × 8 = 898`,除以一百万)。我跑了两次,两次都是 3 分,「缺」那一句措辞不一样但意思一样,`temperature=0` 也不保证一字不差,[Day 112](/blog/agent-zero/day-112-sampling-2/) 讲过。

它的追问问到了点子上,这正是 Day 649 自测第 6 题讨论过的风险:空白随时可能被补上。我会这样接:「那它就只剩不绑框架、工具回放这两个取舍,作为产品价值会小很多;但作为作品,我想展示的是我知道每一步上下文怎么构成、怎么量,这个他们加了功能也拿不走。」承认风险,再说清楚你真正想证明的是什么。

</details>

**练习 5(默写):** 合上文章,默写 Day 649 `traced_agent.py` 里记录一次模型调用的那一段(从 `start = time.perf_counter() - t0` 到 `steps.append({...})`),再跑 `traced_agent.py` 和 `waterfall.py`,瀑布图的形状要和 Day 649 一样(三段工具首尾相接)。

<details><summary>参考答案</summary>

标准答案就是 Day 649 正文里那几行:

```python
        start = time.perf_counter() - t0
        r = llm.chat(messages, tools=TOOLS)
        steps.append({"idx": len(steps), "kind": "llm", "name": llm.model,
                      "start": round(start, 2), "end": round(time.perf_counter() - t0, 2),
                      "input_tokens": r.prompt_tokens, "output_tokens": r.completion_tokens})
```

<div class="line-notes">

- `start = time.perf_counter() - t0` 先记开始,再调模型。我见过最多的默写错误是把这一行写到 `llm.chat` 后面,结果每一步的开始和结束几乎一样,瀑布图上所有模型条都缩成一格。
- `"start": round(start, 2), "end": round(time.perf_counter() - t0, 2),` 结束时间要在调用之后**现取**,不能复用 `start`。
- `"input_tokens": r.prompt_tokens, "output_tokens": r.completion_tokens})` 字段名用 `input_tokens/output_tokens`,和后面 Day 652 定的 Step 模型一致,不要写成 `prompt_tokens`。

</div>

这一题要调模型和天气接口,每次运行大约 0.0025 元、15 秒左右。时间每次都不一样(网络在抖),验收看形状:模型两段短、工具三段长且首尾相接。

</details>

**验收标准**:`check_passk.py` 和 `check_pay.py` 对你的默写版都输出 0 组不一致;`review93.py` 两版都能跑,你能指出它通过了检查却仍然有的两个问题;练习 1 并行版工具占比变成 73% 左右;能不看文章说出本周五段各留下了哪个零件;本周错题清单里每一条能说出出处那一天的具体数字。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 穷举 | 把所有可能的情况一个个列出来数,慢但一看就对。今天用来验证 pass@k 公式 |
| 有放回 / 不放回 | 抽完放回去再抽,每次概率不变;抽完不放回,后面的概率跟着变。`(c/n)**k` 是前者,`comb(c,k)/comb(n,k)` 是后者 |
| 区间合并 | 把重叠的时间段合成一段再算长度,并行步骤的总耗时要这么算 |
| 静默失败 | 代码写错了但不报错,只给出一个看起来合理的结果。今天两段默写的错误都是这种 |
| 数据驱动的文案 | 从数据文件生成文字,数据变了文字跟着变。好处是不会过期,坏处是拼句子时可能换了意思 |
| 本周其他术语 | pass@k / pass^k、利特尔定律见 Day 644;一页纸、采用率、Wilson 区间见 Day 645;PR 四段、首次贡献者见 Day 646;LICENSE、技术写作见 Day 647;分位数、职级带宽见 Day 648;trace、瀑布图、竞品表见 Day 649 |

## 常见误区

**默写完能跑就算对。** 今天两段默写的错误版本都能跑、都不报错、都给出合理的小数。一定要有对答案的东西:穷举、原版、真实样本。

**检查器通过了就放心用。** `review93.py` 的长版通过了全部检查,却有一句话说错了意思,时长也估少了。脚本只能查你想到的那几条,剩下的要靠人读一遍、念一遍。

**把复习日当成重看一遍文章。** 重看会让你觉得都懂了,默写才知道哪里没懂。我自己就是默写 `pass_hat_k` 时才发现,Day 644 那天我只是看懂了公式,没有真的理解「不放回」。

**以为第十部分和第十一部分是两件事。** 这一周最后一天开了新作品的头,但它用的是前五天的东西:竞品表是 Day 646 读贡献指南那种查证习惯,30 秒回答是 Day 644 的追问训练,「没查到不等于没有」是 Day 645 回应质疑的态度。

**拿着模型给的 3 分就去面试。** 练习 4 的面试官模型给了满分,但它的追问说明这个回答还有一个大洞(空白被补上怎么办)。分数没用,追问有用。

## 学习资料

### 文档与文章

- [Python 文档:itertools.combinations](https://docs.python.org/3/library/itertools.html#itertools.combinations):今天穷举用的函数,看一下它和 `permutations`(排列)的区别,10 分钟。
- [Python 文档:math.comb](https://docs.python.org/3/library/math.html#math.comb):组合数,5 分钟。
- [Codex 论文 Evaluating Large Language Models Trained on Code](https://arxiv.org/abs/2107.03374):pass@k 无偏估计的出处,只看第 2.1 节和那段 numpy 实现,和你的默写版对照,15 分钟。
- [τ-bench 论文](https://arxiv.org/abs/2406.12045):pass^k 的出处,看引言里为什么提出它,10 分钟。
- [Langfuse Playground 文档](https://langfuse.com/docs/prompt-management/features/playground) 和 [Laminar Debugger](https://laminar.sh/docs/debugger):小项目引用的两家,复习时再读一遍,看自己的 30 秒回答有没有说错它们。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV16s9qBuEo8&autoplay=0&high_quality=1" title="面试官问:Agent Benchmark 怎么造?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI深度幻觉 · 面试官问:Agent Benchmark 怎么造? · 7 分钟。Day 644 看过,复习日再看一遍,这次边看边想它讲的东西用 pass^k 怎么量。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1VL6TY7E3V&autoplay=0&high_quality=1" title="高级程序员谈薪技巧!避雷话术!建议收藏!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>极海Channel · 高级程序员谈薪技巧!避雷话术!建议收藏! · 6 分钟。Day 648 嵌过,复习时对照「先谈职级」那一条,看它讲到没有。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LCEmiRjPEtQ" title="Andrej Karpathy: Software Is Changing (Again)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Y Combinator · Andrej Karpathy: Software Is Changing (Again) · 40 分钟。Day 648 推荐过。作品篇开工这一周再看一遍「部分自主的应用」和「给 Agent 做界面」那几段,想想 Loupe 这种给人看 Agent 每一步的工具在里面处在什么位置。</figcaption>
</figure>

### 书籍

- Tanya Reilly,《The Staff Engineer's Path》,O'Reilly,2022。有繁体中文版《Staff 工程師之路》。复习本周时读第 8 章 Good Influence at Scale,讲怎么在团队之外产生影响,和 Day 645 对照。
- Nadia Eghbal,《Working in Public: The Making and Maintenance of Open Source Software》,Stripe Press,2020。讲维护者为什么越来越难接外部贡献,读完你会更理解 Day 646 看到的「首次贡献者一个没合」。

### 开源项目与代码

- 你自己的 `agent-zero-lab/part10/` 和 `part11/`:今天所有默写和小项目都在这两个目录里,按 Day 647 的 `release_check.py` 过一遍,别把 `.env` 带进任何公开仓库。
- [openai/human-eval](https://github.com/openai/human-eval):Codex 论文的评测代码,`human_eval/evaluation.py` 里有 pass@k 估计的官方实现,和你的默写版比一比写法。

## 自测

1. 默写 `pass_hat_k` 时写成 `(c / n) ** k` 错在哪?用一个最小的例子说明。

<details><summary>答案</summary>

`(c/n)**k` 假设每次独立地以 c/n 的概率成功,相当于有放回地抽;pass^k 是从已经跑出来的 n 次结果里不放回地挑 k 次。最小例子:跑 2 次成功 1 次,挑 2 次全成功只能把两次都挑上,其中一次是失败,所以是 0;`(1/2)**2` 却给出 0.25。用穷举在 n ≤ 10 上对比能一次查出 284 组不一致。

</details>

2. 为什么说薪资正则漏了小写 k 是「静默失败」?它会怎样影响 Day 648 的结论?

<details><summary>答案</summary>

匹配失败时 `annual_wan` 返回 `None`,后面的分位数计算先把 `None` 过滤掉,整个流程不报错。今天 16 条样本里有 3 条小写 k 被丢掉。放到完整数据上,猎聘来源(写小写 k)的条目会整体消失,分位数只剩 Boss 的数据,而 Day 648 正好提到两个平台中位数不同(49 万对 42 万),结论会被悄悄带偏。

</details>

3. Day 649 的瀑布图里顺序版工具占 89% 没错,并行版算出 191%,为什么?怎么修?

<details><summary>答案</summary>

原算法把每一步的时长直接相加。顺序执行时各段不重叠,相加正好等于实际占用时间;并行时三段同时进行,重叠的时间被算了三次。修法是先按开始时间排序,把重叠的区间合并,再算合并后的总长度。修完并行版工具占 73%,和模型的 27% 加起来是 100%。

</details>

4. 小项目 `review93.py` 的两个版本都通过了检查,为什么还说不能直接用?

<details><summary>答案</summary>

一是第一句把在「中途重跑」上做到了的 Laminar 塞进了「生产监控我会直接用」这句话里,数据对、句子意思错了;二是只数汉字,英文词和数字不算时长,长版其实要 32 秒左右,超了。检查器只能查你写进去的那几条规则,内容是不是准确、念出来多长,还要人读一遍、念一遍。

</details>

5. 面试题:面试官让你现场写 pass@k 的估计公式,写完后问「你怎么确定它是对的?」你怎么答?

<details><summary>答案</summary>

说两层。第一层是含义:pass@k 是从 n 次结果里不放回地挑 k 次至少一次成功的概率,所以等于 1 减去「挑 k 次全是失败」的概率,`1 - C(n-c, k) / C(n, k)`,n − c < k 时直接是 1。第二层是验证:我会写一个穷举版本,把 n 次结果列成 True/False 列表,用 `itertools.combinations` 列出所有挑法数一遍,在 n ≤ 10 的所有 (n, c, k) 上和公式逐个比,几百组全一致才算对。顺便提一句 pass^k 是 `C(c, k) / C(n, k)`,上生产看它更有意义。

</details>

6. 面试题:你说「上下文构成没人做」,面试官追问「如果 LangSmith 下个版本就加上了呢?」你怎么答?

<details><summary>答案</summary>

先承认:那它作为产品的独特性就只剩不绑框架、工具回放这两个取舍,价值会小很多。再说清楚做这个项目真正想证明的:我知道一次模型调用的输入是怎么构成的、怎么量(比如 DeepSeek 只要传了 tools 就有约 208 个 token 的固定开销),能把复杂的 Agent 运行做成好用的界面,这些能力不会因为别人加了功能就消失。最后说一个动作:竞品表带日期和出处放在仓库里,定期重查,README 里如实更新。

</details>

## 明天预告

明天是 Day 651,Loupe 开题(二):PRD、架构、仓库、里程碑。今天的 30 秒回答说清了 Loupe 和别人的区别,明天把它写成一份正式的 PRD:目标用户、用户故事、非目标、验收指标,再画出架构图,建好 `agent-loupe/` 仓库的空骨架,排出从 Day 652 到 Day 676 的里程碑。后面二十多天都照着这份 PRD 施工,所以它得比今天的回答更经得起追问。
