---
title: 'Day 518 · 进阶开学(一):资深岗贵多少,中级和资深差在哪'
description: '进阶篇第一天。用 Ashby 公开的职位接口抓 600 多条带薪资区间的工程师岗位,按标题分成「未标级、senior、staff+」三档:第一版直接比中位数,结果是资深反而更便宜,查下去发现是一家公司占了大半;改成同一家公司内部配对比较才看到 staff 下限高出约三成、senior 只高一成、同一个区间常常盖着好几个级别。再数 JD 正文里的词,最后给你一张八个维度的能力对照表,自己打分找最低的三项,对上进阶篇该先补的几天。'
pubDate: 2026-10-27
regime: none
tags: ['senior', 'career', 'statistics', 'httpx', 'agent-zero']
series: 'agent-zero'
day: 518
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 517](/blog/agent-zero/day-517-week74-review/) 是第 74 周复习,默写了年包折算、offer 拆分和自检的打勾规则,把整周的脚本拼成一份求职周报。再往前一天([Day 516](/blog/agent-zero/day-516-basic-graduation/))是普通篇的结业:每一项能力都要指到真实的文件或链接才算打勾。

从今天起进入进阶篇,一共 131 天(Day 518 到 648)。普通篇教你把东西做出来,进阶篇教的是判断:选哪个、为什么、证据是什么、什么时候该换。所以第一天不写 Agent,先弄清楚「资深」到底是个什么东西:它在招聘市场上值多少钱,它跟中级的差别落在哪几件事上。这两个问题我都想用数据回答,而不是凭感觉说「资深就是更有经验」。

## 今天要解决的问题

今天结束时你应该能:

1. 用公开的招聘数据量出「资深」在薪资区间上的差别,并说出这份数据的三个口径问题(只有基本工资、区间覆盖多个级别、不同公司没法直接比)。
2. 写出 `levels.py` 和 `paired.py`:从标题里认出职级,用区间中点算中位数,再按公司分组做配对比较;说出为什么第一版的「资深比普通便宜」是错的。
3. 用 `wants.py` 数 JD 正文里的词,看 senior 和 staff 的要求在文字上和普通岗差在哪,同时知道这类关键词统计能说明什么、说明不了什么。
4. 用八个维度的对照表给自己打分,找出最低的三项,对应到进阶篇的哪几天。

预计用时 3–4 小时,一半在跑脚本读结果,一半在填自己的能力表。前置:[Day 512](/blog/agent-zero/day-512-remote-fde/) 用 `httpx` 调 Ashby 公开接口的写法,[Day 511](/blog/agent-zero/day-511-job-channels/) 的口径意识(挂牌价不是成交价、中位数和平均数),[Day 516](/blog/agent-zero/day-516-basic-graduation/) 的证据规矩。今天会发约 15 次公开接口的请求,不调模型,花费 ¥0。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `paired.py` 里的配对比较;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先说今天的数据从哪来,缺什么

[Day 511](/blog/agent-zero/day-511-job-channels/) 讲过国内的挂牌薪资:Boss、猎聘上能看到年限分档(1–3 年、3–5 年……)的统计,但是**按职级分档**的、我能放心给你的干净数据没有。国内岗位标题里写不写「资深」「高级」全凭公司习惯,而且 Boss 和猎聘我们不去碰(要登录,有人机验证)。所以今天换一个能自己验证的数据源:海外招聘系统 Ashby 的公开职位接口,就是 [Day 512](/blog/agent-zero/day-512-remote-fde/) 用过的那个。

为什么这个数据源能看到薪资?美国有几个州(加州、纽约、科罗拉多、华盛顿等)要求招聘广告写明薪资区间,所以很多公司的职位页上有一行类似「$180K – $225K • Offers Equity」的字。接口里把它放在 `compensation` 字段,请求时加 `includeCompensation=true`。

先把这份数据的局限说在前面,后面读数字时要一直记着:

- **只是基本工资的区间。** 后面那个「Offers Equity」只是标记有股权,股权值多少没写。资深以上的人,股权往往比基本工资的差距更大,这里完全看不到。
- **区间很宽。** 同一个职位的区间下限和上限常常差一倍,因为公司把几个级别、几个城市档位放进同一个区间里。我们取区间下限和中点来比,都只是粗略的代理。
- **样本不是随机抽的。** 我挑的是 15 家在招 AI 和工程岗位的公司,有大有小,大部分在旧金山和纽约。它们不代表全市场,更不代表国内。

所以今天的数字只拿来看「职级对薪资区间的影响是什么形状」,不拿来回答「你该拿多少钱」。

## 第一步:抓数据

```bash
cd agent-zero-lab
uv add httpx
```

`httpx` 在 [Day 64](/blog/agent-zero/day-064-httpx-1/) 装过,已经有了的话这一行不会有变化。

```python
# agent-zero-lab/part09/senior/fetch_levels.py
import json
import re
from datetime import date
from pathlib import Path

import httpx

API = "https://api.ashbyhq.com/posting-api/job-board/{}?includeCompensation=true"
COMPANIES = ["openai", "cohere", "decagon", "sierra", "cognition", "livekit", "ramp", "perplexity",
             "replit", "harvey", "modal", "anyscale", "pinecone", "deepgram", "writer"]
ENG = re.compile(r"engineer(?!ing)", re.I)
NOT_ENG = re.compile(r"manager|director|head of|sales|solutions|support|field|customer|recruit", re.I)
OUT = Path("part09/senior/postings.json")


def fetch(client: httpx.Client, company: str) -> list[dict]:
    r = client.get(API.format(company))
    r.raise_for_status()
    return r.json()["jobs"]


if __name__ == "__main__":
    kept = []
    with httpx.Client(timeout=30) as client:
        for c in COMPANIES:
            jobs = fetch(client, c)
            eng = [j for j in jobs if ENG.search(j["title"]) and not NOT_ENG.search(j["title"])]
            priced = [j for j in eng if (j.get("compensation") or {}).get("compensationTierSummary")]
            print(f"{c:<11} 全部 {len(jobs):>4}  工程师岗 {len(eng):>3}  写了薪资 {len(priced):>3}")
            for j in priced:
                kept.append({"company": c, "title": j["title"].strip(), "location": j["location"],
                             "comp": j["compensation"]["compensationTierSummary"],
                             "text": (j.get("descriptionPlain") or "")[:8000]})
    OUT.write_text(json.dumps(kept, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{date.today()} 一共留下 {len(kept)} 条 → {OUT}")
```

<div class="line-notes">

- `API = "https://api.ashbyhq.com/posting-api/job-board/{}?includeCompensation=true"` 和 [Day 512](/blog/agent-zero/day-512-remote-fde/) 同一个接口,`{}` 是公司名的占位符,`includeCompensation=true` 让每个职位带上薪资摘要。
- `COMPANIES = ["openai", "cohere", "decagon", "sierra", "cognition", "livekit", "ramp", "perplexity",` 十五家用 Ashby 的公司,名字就是它们招聘页地址里的那一段。我先试了二十多个名字,有的返回 404(公司不用 Ashby),有的接口通但一条薪资都没写,留下的是有薪资可看的。
- `ENG = re.compile(r"engineer(?!ing)", re.I)` 标题里含 `engineer` 的才要。`(?!ing)` 是「后面不能紧跟 ing」,这一句是踩了坑以后加的,下面讲。
- `NOT_ENG = re.compile(r"manager|director|head of|sales|solutions|support|field|customer|recruit", re.I)` 排掉经理、销售、售前、支持这类标题里虽然带 engineer 但不是软件工程师的岗位。
- `r.raise_for_status()` 公司名写错时接口返回 404,这一行让你立刻知道,而不是拿到空列表以为人家没在招。
- `priced = [j for j in eng if (j.get("compensation") or {}).get("compensationTierSummary")]` 只留下写了薪资摘要的。`or {}` 是 `compensation` 缺失时的兜底,和 JS 的 `?.` 相似。
- `kept.append({"company": c, "title": j["title"].strip(), "location": j["location"],` 每个岗位只留公司、标题、地点、薪资摘要和正文。标题要 `.strip()`,有的标题末尾带空格。
- `"text": (j.get("descriptionPlain") or "")[:8000]})` JD 正文的纯文本版,前 8000 个字符。后面的 `wants.py` 要数里面的词。

</div>

```bash
uv run python -m part09.senior.fetch_levels
```

```text
openai      全部  796  工程师岗 325  写了薪资 280
cohere      全部  116  工程师岗  34  写了薪资  28
decagon     全部  133  工程师岗  34  写了薪资  34
sierra      全部  210  工程师岗  52  写了薪资  45
cognition   全部  105  工程师岗  33  写了薪资   4
livekit     全部   30  工程师岗  17  写了薪资  17
ramp        全部  173  工程师岗  30  写了薪资  30
perplexity  全部  132  工程师岗  48  写了薪资  34
replit      全部   36  工程师岗  14  写了薪资  14
harvey      全部  365  工程师岗  93  写了薪资  80
modal       全部   43  工程师岗   8  写了薪资   8
anyscale    全部   21  工程师岗  15  写了薪资  12
pinecone    全部    8  工程师岗   5  写了薪资   5
deepgram    全部   82  工程师岗  19  写了薪资  18
writer      全部   46  工程师岗  17  写了薪资  11
2026-10-27 一共留下 620 条 → part09/senior/postings.json
```

这是 2026 年 10 月 27 日的结果,你跑的那天数字会不一样。OpenAI 一家就有 325 个工程师岗位、280 个写了薪资,占了全部 620 条里的将近一半。这件事先记着,它是下面「资深反而更便宜」那个怪现象的来源。

关于 `engineer(?!ing)`:我最开始写的是 `engineer`,抽样看留下来的标题时,发现里面混进了 `Senior HR Business Partner - Engineering, Product, and Design` 这种,因为 `Engineering` 里面包含 `engineer`。它是一个 HR 岗位,标题里只是写了服务的部门。加上 `(?!ing)` 以后这类就不会进来。这个坑和 [Day 498](/blog/agent-zero/day-498-resume-1/) 的正则误伤是同一回事,正则越短越容易碰到不相干的东西。

## 第二步:把区间折成数,把标题分档

薪资摘要是一段文字,比如 `$200K – $400K • Offers Equity`。先写一个最直觉的版本:用正则把所有「数字加 K」抽出来,取前两个当下限和上限,算中点;标题里有 `senior` 的算资深,有 `staff` 或 `principal` 的算 staff 以上,其余算「未标级」。

```python
# agent-zero-lab/part09/senior/levels.py  (第一版)
import json
import re
import statistics
from collections import defaultdict
from pathlib import Path


def level_of(title: str) -> str:
    t = title.lower()
    if "staff" in t or "principal" in t:
        return "staff+"
    if "senior" in t:
        return "senior"
    return "未标级"


def mid_k(comp: str) -> float | None:
    nums = re.findall(r"([\d.]+)K", comp)
    if len(nums) < 2:
        return None
    return (float(nums[0]) + float(nums[1])) / 2


if __name__ == "__main__":
    jobs = json.loads(Path("part09/senior/postings.json").read_text(encoding="utf-8"))
    groups: dict[str, list[float]] = defaultdict(list)
    for j in jobs:
        v = mid_k(j["comp"])
        if v is not None:
            groups[level_of(j["title"])].append(v)
    for lv in ["未标级", "senior", "staff+"]:
        vals = groups[lv]
        print(f"{lv:<6} n={len(vals):<4} 中位 {statistics.median(vals):.0f}K")
```

<div class="line-notes">

- `def level_of(title: str) -> str:` 从标题认职级,只有三档:`staff+`、`senior`、`未标级`。注意「未标级」不等于「中级」,只是标题里没写。
- `if "staff" in t or "principal" in t:` 用最简单的子串判断。这一版有个隐患:`Member of Technical Staff`(很多 AI 公司用这个头衔)里有 `staff`,会被误判成 staff+。真实数据里这种标题有,留到后面再说。
- `if "senior" in t:` 同理。
- `def mid_k(comp: str) -> float | None:` 返回区间中点,单位千美元。认不出就返回 `None`。
- `nums = re.findall(r"([\d.]+)K", comp)` 抽出所有「数字加 K」,`$200K – $400K` 得到 `['200', '400']`。注意这一行根本没看货币符号。
- `if len(nums) < 2:` 抽不够两个数的(比如 `$257,800 – $354,550` 这种不带 K 的写法)直接放弃。
- `return (float(nums[0]) + float(nums[1])) / 2` 中点。`$200K – $400K` 是 300.0。
- `groups: dict[str, list[float]] = defaultdict(list)` 按职级分组,`defaultdict(list)` 访问不存在的键时自动给一个空列表。
- `print(f"{lv:<6} n={len(vals):<4} 中位 {statistics.median(vals):.0f}K")` `statistics.median` 取中位数,`:.0f` 不留小数。

</div>

```bash
uv run python -m part09.senior.levels_v1
```

```text
未标级    n=455  中位 295K
senior n=51   中位 242K
staff+ n=104  中位 300K
```

**这个结果不对劲:** senior 的中位数是 242K,比「未标级」的 295K 低了五万多美元。如果你信了它,结论就是「标题里写 Senior 的岗位更便宜」,简历上把 Senior 去掉还能多拿钱,这显然是荒唐的。结果不对劲的时候,先查数据,再查代码,最后才怀疑世界。

先查第一个嫌疑:货币。`re.findall(r"([\d.]+)K", comp)` 不看货币符号,Cohere 在多伦多的岗位写 `CA$215K – CA$295K`,伦敦的写 `£`,它们的数字被当成美元算了。数一下摘要开头是什么货币:

```bash
uv run python -c "
import json, re
from collections import Counter
jobs = json.load(open('part09/senior/postings.json', encoding='utf-8'))
print(Counter((re.match(r'^([^\d]*)[\d.]+', j['comp']) or [None, '其他'])[1] for j in jobs))"
```

```text
Counter({'$': 566, 'CA$': 25, '£': 18, 'SGD\xa0': 4, '€': 4, 'A$': 2, '₩': 1})
```

`$` 开头的有 566 条,剩下 54 条是加元(`CA$`)、英镑、新加坡元、欧元、澳元和韩元,约占 9%。它们的数字被当成了美元混进来。`$` 开头的里面还有几条写法特殊,比如 `$257,800 – $354,550` 带逗号不带 K,`$195 – $415,000` 的下限明显写错了,第一版要么悄悄丢掉,要么算错。

第二个嫌疑:标题。第一版用 `"staff" in t` 判断 staff 级,而 AI 公司里很常见一种头衔叫 `Member of Technical Staff`,简称 MTS,它是个通用头衔,不是级别。数一下有多少:

```bash
uv run python -c "
import json, re
from collections import Counter
jobs = json.load(open('part09/senior/postings.json', encoding='utf-8'))
print(Counter(j['company'] for j in jobs if re.search('technical staff', j['title'], re.I)))"
```

```text
Counter({'perplexity': 31, 'cohere': 3})
```

34 条,其中 Perplexity 一家 31 条,第一版把它们全算成了 staff+。Perplexity 在表里的 staff+ 几乎全是这个头衔,不是真的 staff 级。所以第二版要做三件事:只认以美元符号开头的区间,逗号分隔的数字也认,把 Member of Technical Staff 单独标出来、不参与比较。

```python
# agent-zero-lab/part09/senior/levels.py
import json
import re
import statistics
from collections import defaultdict
from pathlib import Path

USD = re.compile(r"^\$([\d,.]+)(K?)\s*–\s*\$([\d,.]+)(K?)")


def level_of(title: str) -> str:
    t = title.lower()
    if "member of technical staff" in t:
        return "mts"  # 一种头衔,不是级别,下面分析时不要
    if re.search(r"\b(staff|principal|distinguished)\b", t):
        return "staff+"
    if re.search(r"\b(senior|sr\.?)\b", t):
        return "senior"
    return "未标级"


def to_k(num: str, k: str) -> float:
    v = float(num.replace(",", ""))
    return v if k else v / 1000


def mid_k(comp: str) -> float | None:
    """只认以美元符号开头的区间,返回区间中点,单位千美元。别的货币一律不要。"""
    m = USD.match(comp)
    if m is None:
        return None
    lo, hi = to_k(m[1], m[2]), to_k(m[3], m[4])
    if lo < 50 or hi < lo:  # 低于 5 万美元的年薪区间多半是填错或不是年薪
        return None
    return (lo + hi) / 2


def load() -> list[dict]:
    jobs = json.loads(Path("part09/senior/postings.json").read_text(encoding="utf-8"))
    out = []
    for j in jobs:
        v, level = mid_k(j["comp"]), level_of(j["title"])
        if v is not None and level != "mts":
            out.append({**j, "level": level, "mid": v})
    return out


if __name__ == "__main__":
    jobs = load()
    print(f"能用的 {len(jobs)} 条(只算美元)")
    by_level: dict[str, list[float]] = defaultdict(list)
    for j in jobs:
        by_level[j["level"]].append(j["mid"])
    for lv in ["未标级", "senior", "staff+"]:
        vals = by_level[lv]
        q1, mid, q3 = statistics.quantiles(vals, n=4)
        print(f"{lv:<6} n={len(vals):<4} 中位 {mid:.0f}K  P25 {q1:.0f}K  P75 {q3:.0f}K")
```

<div class="line-notes">

- `USD = re.compile(r"^\$([\d,.]+)(K?)\s*–\s*\$([\d,.]+)(K?)")` 只匹配以 `$` 开头的区间。`^\$` 保证 `CA$`、`A$` 都不匹配,因为它们的 `$` 前面还有字母。四个捕获组:下限的数字、下限的 `K`(可能没有)、上限的数字、上限的 `K`。中间那个 `–` 是一个长破折号字符,不是键盘上的减号。
- `def level_of(title: str) -> str:` 返回四种之一:`mts`、`staff+`、`senior`、`未标级`。
- `if "member of technical staff" in t:` 先判断这个头衔,放在 staff 的判断前面。顺序很重要:先放行的先生效,放在后面它就会被 `staff` 那一条抢走。返回 `mts` 的岗位在 `load()` 里会被丢掉。
- `if re.search(r"\b(staff|principal|distinguished)\b", t):` 改成正则加 `\b`(单词边界),`staff` 前后都得是边界。`Sr.` 这类缩写和 `Distinguished` 也一并考虑了。
- `def to_k(num: str, k: str) -> float:` 把「数字加可选的 K」统一成千美元。
- `v = float(num.replace(",", ""))` `257,800` 先去掉逗号再转浮点。
- `return v if k else v / 1000` 有 `K` 就是已经按千算的,没有 `K` 的(`257,800`)要除以一千。
- `if lo < 50 or hi < lo:` 年薪下限不到 5 万美元的、或者上限比下限还小的,基本是写错了或者是时薪、月薪。数据里有一条是 `$195 – $415,000`,下限是 195 美元,被这一句丢掉。
- `return (lo + hi) / 2` 区间中点。
- `def load() -> list[dict]:` 读 `postings.json`,每条加两个字段:`level` 和 `mid`,折不出来的丢掉。
- `v, level = mid_k(j["comp"]), level_of(j["title"])` 一次算出中点和职级。右边是个元组,左边同时拆成两个变量。
- `if v is not None and level != "mts":` 折不出数的、MTS 头衔的,都不放进结果。
- `q1, mid, q3 = statistics.quantiles(vals, n=4)` 四等分的三个切点,和 [Day 511](/blog/agent-zero/day-511-job-channels/) 同样的写法。

</div>

```bash
uv run python -m part09.senior.levels
```

```text
能用的 530 条(只算美元)
未标级    n=417  中位 308K  P25 247K  P75 356K
senior n=46   中位 242K  P25 216K  P75 290K
staff+ n=67   中位 286K  P25 260K  P75 300K
```

货币和头衔这两个问题修掉了,有用的样本是 530 条(美元区间 561 条,去掉 MTS 的 31 条)。staff+ 的中位数从 300K 变成了 286K,但怪现象还在:senior 的中位数 242K,「未标级」是 308K,还是资深的更便宜。所以货币和头衔只是两个小问题,真正的原因在别处。

## 第三步:这个数字被谁拉高了

整体的数字是被「谁贡献了多少条」决定的。把每家公司的每一档数一下,同时算每档的区间下限中位数(用下限是因为它比中点更接近「这个级别的起步价」,但这只是我的选择,练习 1 会换成上限看结论变不变):

```python
# agent-zero-lab/part09/senior/paired.py
import re
import statistics
from collections import defaultdict

from part09.senior.levels import USD, load, to_k

MIN_N = 3  # 一个公司里某一档少于 3 条,不拿来比


def lo_k(comp: str) -> float:
    m = USD.match(comp)
    assert m is not None
    return to_k(m[1], m[2])


if __name__ == "__main__":
    jobs = load()
    g: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for j in jobs:
        g[j["company"]][j["level"]].append(lo_k(j["comp"]))
    ratios: dict[str, list[float]] = {"senior": [], "staff+": []}
    print(f"{'公司':<11}{'未标级':>12}{'senior':>12}{'staff+':>12}   区间下限的中位数(千美元),括号里是条数")
    for company, d in sorted(g.items()):
        cells = []
        for lv in ("未标级", "senior", "staff+"):
            v = d.get(lv, [])
            cells.append(f"{statistics.median(v):>6.0f}({len(v):>2})" if v else f"{'-':>10}")
        print(f"{company:<11}" + "".join(f"{c:>12}" for c in cells))
        base = d.get("未标级", [])
        if len(base) < MIN_N:
            continue
        for lv in ("senior", "staff+"):
            if len(d.get(lv, [])) >= MIN_N:
                ratios[lv].append(statistics.median(d[lv]) / statistics.median(base))
    for lv, rs in ratios.items():
        shown = ", ".join(f"{r:.2f}" for r in rs)
        print(f"\n{lv} 对 未标级:能比的公司 {len(rs)} 家,下限比值 [{shown}],中位 {statistics.median(rs):.2f}" if rs else f"{lv}: 没有够条数的公司")
```

<div class="line-notes">

- `MIN_N = 3  # 一个公司里某一档少于 3 条,不拿来比` 一家公司里只有 1 条 senior,不能拿它代表这家公司的 senior 水平。这个 3 是我定的,[Day 513](/blog/agent-zero/day-513-offer/) 的 `MIN_N = 5` 也是同一类取舍。
- `def lo_k(comp: str) -> float:` 取区间下限(单位千美元)。
- `assert m is not None` `load()` 已经保证过能解析,这里用 `assert` 告诉类型检查器:`m` 不是 `None`。
- `g: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))` 两层字典:公司 → 职级 → 下限的列表。外层的默认值是一个「会自动建空列表的字典」,所以 `g[公司][职级].append(...)` 一句话就够。
- `g[j["company"]][j["level"]].append(lo_k(j["comp"]))` 每条岗位放进对应的格子。
- `for company, d in sorted(g.items()):` 按公司名字母序打印。
- `cells.append(f"{statistics.median(v):>6.0f}({len(v):>2})" if v else f"{'-':>10}")` 每一格打印「下限中位数(条数)」,没有这一档的打 `-`。
- `base = d.get("未标级", [])` 这家公司的「未标级」作为基准。
- `if len(base) < MIN_N:` 基准不够 3 条,这家公司整个跳过。
- `if len(d.get(lv, [])) >= MIN_N:` 这一档也要够 3 条才比。
- `ratios[lv].append(statistics.median(d[lv]) / statistics.median(base))` **配对比较的核心**:同一家公司内部,senior 的下限中位数除以未标级的下限中位数,得到一个比值。比值是 1.27 就是「高出 27%」。
- `print(f"\n{lv} 对 未标级:能比的公司 {len(rs)} 家,下限比值 [{shown}],中位 {statistics.median(rs):.2f}" if rs else f"{lv}: 没有够条数的公司")` 把每家的比值列出来,再取中位数,一眼看得出是不是被某一家带偏。

</div>

```bash
uv run python -m part09.senior.paired
```

```text
公司                  未标级      senior      staff+   区间下限的中位数(千美元),括号里是条数
anyscale        208( 6)     200( 1)     240( 3)
cognition       180( 4)           -           -
cohere          160( 5)           -     222( 4)
decagon         180(11)     200(11)     200( 5)
deepgram        155(10)     180( 5)     197( 3)
harvey          220(24)     193(20)     231(31)
livekit         168(10)     135( 2)     135( 1)
modal           178( 8)           -           -
openai         266(263)     272( 1)     347( 9)
perplexity      180( 1)     150( 1)     175( 1)
pinecone        178( 2)           -     190( 3)
ramp            187(26)     204( 3)           -
replit          180( 6)     145( 2)     258( 6)
sierra          230(31)           -           -
writer          132(10)           -     183( 1)

senior 对 未标级:能比的公司 4 家,下限比值 [1.11, 1.16, 0.88, 1.09],中位 1.10

staff+ 对 未标级:能比的公司 7 家,下限比值 [1.16, 1.39, 1.11, 1.27, 1.05, 1.30, 1.43],中位 1.27
```

先看表。OpenAI 一家在「未标级」里有 263 条,而别的公司大多是个位数到二三十条。全部「未标级」417 条里,OpenAI 占了六成多,它的区间下限中位数是 266K,比表里大多数公司高出一截。所以整体的「未标级中位数 308K」,说的其实是「OpenAI 的普通工程师岗位大概多少」,而 senior 那 46 条几乎全是别家的小公司。拿一家大公司的一堆岗位去比一堆小公司的少数岗位,当然比出荒唐的结果。

这在统计里叫**混杂**([Day 511](/blog/agent-zero/day-511-job-channels/) 讲「在校生比 1–3 年还高」时提过):你想看的因素是职级,但还有一个因素(公司)同时在变,而且变得更厉害。破法就是不跨公司比,只在同一家公司内部比,再看这个「内部差距」在各家公司里是不是同一个方向。这一步叫配对比较,后面 [Day 548](/blog/agent-zero/day-548-eval-stats-2/) 会从统计角度再讲一遍为什么它更可靠。

看表下面的两行结果。能配得上(未标级和 senior 各有至少 3 条)的只有 4 家公司,比值是 1.11、1.16、0.88、1.09,中位 1.10:senior 的区间下限比未标级高大概一成,但有一家反过来(Harvey,0.88)。staff+ 能配上 7 家,比值从 1.05 到 1.43,中位 1.27:下限高出约 27%,方向一致,没有一家低于 1。

所以在这份数据里,**staff 以上的下限比普通岗位明显高,senior 只高一点点,而且 4 家里有一家是反的。** 这个差距小到让人不安,原因在下一节。

### 同一个区间盖着好几个级别

[Day 517](/blog/agent-zero/day-517-week74-review/) 的周报让你习惯了「看一眼具体的数」。现在看两家公司具体长什么样:

<figure>
<svg viewBox="0 0 640 290" role="img" aria-label="Decagon 和 Harvey 两家公司的未标级、senior、staff+ 岗位的区间下限和上限的中位数,横轴是千美元。Decagon 的 senior 和 staff+ 区间完全一样,都是 200K 到 400K,而未标级是 180K 到 230K;Harvey 的三档互相重叠很多">
  <rect x="0" y="0" width="640" height="290" fill="var(--paper-raised)"/>
  <text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">区间下限到上限的中位数(千美元)</text>
  <text x="8" y="50" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Decagon</text>
  <text x="8" y="72" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">未标级 11</text>
  <rect x="230" y="60" width="68" height="16" fill="var(--paper)" stroke="var(--ink-soft)"/>
  <text x="8" y="94" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">senior 11</text>
  <rect x="257" y="82" width="274" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="8" y="116" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">staff+ 5</text>
  <rect x="257" y="104" width="274" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="540" y="94" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">200–400</text>
  <text x="540" y="116" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">200–400</text>
  <text x="8" y="156" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Harvey</text>
  <text x="8" y="178" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">未标级 24</text>
  <rect x="285" y="166" width="137" height="16" fill="var(--paper)" stroke="var(--ink-soft)"/>
  <text x="8" y="200" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">senior 20</text>
  <rect x="248" y="188" width="127" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="8" y="222" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">staff+ 31</text>
  <rect x="300" y="210" width="149" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <line x1="120" y1="240" x2="600" y2="240" stroke="var(--rule)"/>
  <text x="108" y="258" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">100</text>
  <text x="245" y="258" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">200</text>
  <text x="382" y="258" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">300</text>
  <text x="519" y="258" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">400</text>
  <text x="20" y="280" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">每条横条是该档岗位下限的中位数到上限的中位数;2026-10-27 抓的数据</text>
</svg>
<figcaption>Decagon 的 senior 和 staff 岗位挂的是完全相同的区间,200K 到 400K,「未标级」则是 180K 到 230K;Harvey 的三档互相叠得很厉害,senior 的区间甚至比未标级还靠左。公司不按标题前缀定区间。</figcaption>
</figure>

Decagon 的 senior 和 staff 挂的是同一个区间 200K 到 400K,一个字不差。这个区间的意思是:「我们愿意给这个岗位 200K 到 400K,你在里面落在哪,由面试时给你评的级别决定。」同一个公司「未标级」的岗位中位区间是 180K 到 230K,窄得多,上限也低得多,但它们里面也有一条是 `200K – 400K`(这就是配对比较的数据里能看到「未标级」和「senior」的区间有重合的原因)。

这件事对你的意义是:**别靠标题前缀猜自己能拿多少。** 标题上有没有 Senior,区间可能一样;区间的下限高低只部分取决于标题,更大程度取决于公司的档次和你被定在哪一级。「资深」这个词的价值,不是标题上那六个字母,而是面试结束时你被评在哪一级。

## 第四步:JD 正文里,资深岗要的东西不一样吗

薪资区间说不清,换个角度,看 JD 的文字。`text` 字段里存了每个岗位的正文。我挑了几类词来数,看 senior 和 staff 的 JD 里出现得比未标级多还是少。词是我按「资深」常被描述的特征选的,**这一步选词本身就是一个有主观性的决定**,换一批词结论可能不同,练习 2 会让你换。这一步把 OpenAI 排除了,因为它的 JD 模板特别整齐(几百条正文差不多),留着会把比例拉平。

```python
# agent-zero-lab/part09/senior/wants.py
import re
import statistics

from part09.senior.levels import load

WORDS = {
    "design / architect": r"design doc|architect",
    "mentor": r"mentor",
    "cross-team / stakeholder": r"cross-functional|cross-team|stakeholder",
    "ownership / end-to-end": r"ownership|end-to-end|\bown\b",
    "scale": r"\bscal(?:e|ing|able)\b",
    "eval": r"\bevals?\b|evaluation",
    "reliability / on-call": r"reliab|on-call|incident|latency",
}
YEARS = re.compile(r"(\d{1,2})\+?\s*(?:or more )?years", re.I)


def first_years(text: str) -> int | None:
    m = YEARS.search(text)
    return int(m[1]) if m else None


def main() -> None:
    jobs = [j for j in load() if j["company"] != "openai"]  # OpenAI 的 JD 模板太整齐,单独拿出来会把比例拉平
    groups = {"未标级": [], "senior": [], "staff+": []}
    for j in jobs:
        groups[j["level"]].append(j["text"])
    print(f"{'':<26}" + "".join(f"{k}(n={len(v)})".rjust(16) for k, v in groups.items()))
    for name, pat in WORDS.items():
        cells = [sum(1 for t in v if re.search(pat, t, re.I)) / len(v) for v in groups.values()]
        print(f"{name:<26}" + "".join(f"{c:>16.0%}" for c in cells))
    cells = []
    for v in groups.values():
        ys = [y for t in v if (y := first_years(t)) is not None]
        cells.append(f"{statistics.median(ys):.0f} 年({len(ys)} 条写了)")
    print(f"{'第一个出现的年限要求(中位)':<20}" + "".join(c.rjust(16) for c in cells))


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `WORDS = {` 每一类一个名字加一条正则。`"design / architect": r"design doc|architect"` 是「写设计文档」或者「做架构」。
- `"mentor": r"mentor"` 带人。
- `"ownership / end-to-end": r"ownership|end-to-end|\bown\b"` 「负责到底」这一类。`\bown\b` 是整个单词 own,不会匹配 `known`、`owner`。
- `"scale": r"\bscal(?:e|ing|able)\b"` `scale`、`scaling`、`scalable` 都算。
- `"reliability / on-call": r"reliab|on-call|incident|latency"` 稳定性和值班这一类。
- `YEARS = re.compile(r"(\d{1,2})\+?\s*(?:or more )?years", re.I)` 找「5+ years」「8 or more years」这类年限要求。`(\d{1,2})` 取一两位数字。
- `def first_years(text: str) -> int | None:` 取正文里第一个出现的年限要求。第一个出现的通常就是对这个岗位的总体要求。
- `jobs = [j for j in load() if j["company"] != "openai"]` 排除 OpenAI。
- `groups = {"未标级": [], "senior": [], "staff+": []}` 三档各存正文。
- `print(f"{'':<26}" + "".join(f"{k}(n={len(v)})".rjust(16) for k, v in groups.items()))` 表头一行,`rjust(16)` 右对齐占 16 格。
- `cells = [sum(1 for t in v if re.search(pat, t, re.I)) / len(v) for v in groups.values()]` 每一档里,出现这类词的岗位占多少比例。`re.I` 忽略大小写。
- `ys = [y for t in v if (y := first_years(t)) is not None]` 写了年限的岗位收集起来,海象运算符 `:=` 同时赋值和判断。
- `cells.append(f"{statistics.median(ys):.0f} 年({len(ys)} 条写了)")` 年限取中位数,括号里写有多少条真的写了年限。

</div>

```bash
uv run python -m part09.senior.wants
```

```text
                                未标级(n=154)    senior(n=45)    staff+(n=58)
design / architect                     59%             44%             67%
mentor                                  7%             16%             43%
cross-team / stakeholder               45%             31%             34%
ownership / end-to-end                 80%             98%             93%
scale                                  88%             91%             98%
eval                                   21%             29%             29%
reliability / on-call                  60%             73%             72%
第一个出现的年限要求(中位)          5 年(112 条写了)     5 年(35 条写了)     8 年(47 条写了)
```

怎么读这张表,我自己的读法:

**「带人」是最干净的信号。** mentor 从未标级的 7% 升到 senior 的 16%、staff+ 的 43%,逐级上升。资深以上要带人,这一条在文字里得到了印证。

**「负责到底」和「稳定性」在 senior 档就上去了。** ownership 从 80% 到 98%,reliability(稳定性、值班、延迟)从 60% 到 73%,staff+ 是 93% 和 72%,稍低一点点,但仍比未标级高。

**其余几类不是单调的,别硬读。** design / architect 在 senior 里反而最低(44%),cross-team 是先降后略升(45%、31%、34%)。45 条 senior 和 58 条 staff+ 的样本,差几个百分点都在噪声里。scale 三档都在 88% 到 98%,是 AI 公司岗位的共同底色,说明不了级别。

**年限的跳变在 staff,不在 senior。** 第一个出现的年限要求,未标级和 senior 的中位数都是 5 年,staff+ 才是 8 年。Will Larson 在《Staff Engineer》的介绍页上写,多数公司里工程师做到 Senior 大概要五到八年,和这里「senior 写 5 年、staff 写 8 年」大致对得上。也就是说,标题里加了 Senior,JD 并没有要求更长的年限,要的是别的东西。

所以文字里的差别主要落在**带人和负责到底**,不在「会得更多」。这个结论也很粗:关键词计数分不出「负责过 ownership」和「JD 里随手写了一句 ownership」。它能告诉你的是方向,不是资格线。

## 所以「资深」到底贵多少

把前面几步合起来,我会这样回答这个问题,每一句都带着数据的口径:

在这 15 家公司的 620 条公开岗位里(其中 530 条的美元区间能用),同一家公司内部,标题带 staff / principal 的岗位,区间下限的中位数比「未标级」高 27%(7 家公司,从 1.05 倍到 1.43 倍);标题带 senior 的高 10%(只有 4 家公司能比,其中一家反过来)。同一个公司常常用同一个区间盖着好几个级别,你能拿到多少取决于面试时被评在哪一级,不取决于标题前缀。这些数字只是基本工资的区间,不含股权;公司是我挑的 15 家,不是随机样本;国内的情况我没有同口径的数据。

这段话比「资深比普通高 40%」难记,但每个数字都能追到脚本里的某一行,也能被别人复查。这就是进阶篇想让你养成的习惯:一个结论,背后要有「在什么样本、什么口径下」。

还有两点是从这些数字里看不出、但真实存在的:一是年薪之外的部分,级别越高股权占的比重越大,资深以上的人谈 offer,谈的主要是股权和级别([Day 513](/blog/agent-zero/day-513-offer/) 的 `Offer` 里 `equity_prob` 就是为这个设的);二是级别是在面试里定的,所以进阶篇后面专门有「Staff 级系统设计面试」([Day 642](/blog/agent-zero/day-642-staff-sd-1/))和「设计文档和 ADR」([Day 640](/blog/agent-zero/day-640-design-docs-1/)),因为面试官就是通过这些来判断你该被评在哪一级。

## 中级和资深差在哪:八个维度

文字数据只能告诉你「JD 在写什么」,不能告诉你「真正的差别在哪」。下面这张表是我综合几处整理的:公开的职级框架(比如 Dropbox 的 Engineering Career Framework,IC1 到 IC7 都写出来了,里面有一页专门讲「什么是 Impact」)、Will Larson 的《Staff Engineer》,和我自己带过人、面试过人的经验。它不是哪家公司的官方标准,不同公司的说法会不一样,但方向大致相通。

| 维度 | 中级(学完普通篇) | 资深 |
| --- | --- | --- |
| 设计 | 会用一种架构把需求做出来 | 能比较两三种架构,用数据说明为什么选这个,并写清楚什么时候该换 |
| 评测 | 有测试集,会跑分 | 知道分数差多少才算数,能设计线上实验,评测体系能被别人复用 |
| 规模 | 单个服务能上线 | 能估 10 倍流量下的成本、延迟、容量,知道哪里先撑不住 |
| 平台 | 为一个业务写一个 Agent | 把运行时、工具接入、评测做成别的团队能用的东西 |
| 模型 | 会选 API、会写提示词 | 知道什么时候自部署、微调、蒸馏,能算清总成本 |
| 稳定性 | 加了重试和超时 | 能设计持久化执行、降级和熔断,出事故能带着复盘 |
| 信息源 | 看教程、看视频 | 读论文、读源码、读官方工程博客,自己找答案 |
| 影响力 | 把自己的活干好 | 写设计文档说服别人,带新人,推动跨团队采用 |

这张表里没有一项是「会某个新框架」。框架半年一变,上面这些换什么框架都用得上。第四步的数据里,「带人」「负责到底」「稳定性」比「会更多东西」更能区分级别,和这张表是一个方向。

拿一个具体场景感受一下差别。假设 SupportPilot 上线一个月后,运营反馈「最近转人工的工单变多了」。

中级的做法通常是:翻几条转人工的 trace([Day 484](/blog/agent-zero/day-484-obs-langfuse/)),发现分类节点把一些账单问题分成了 other,改一下分类提示词,加几个示例,在测试集上跑一遍分数涨了两个点,提交。

资深的做法是先问几个问题:转人工率涨了多少,是绝对数还是比例,跟工单总量、工单类型的分布变化有没有关系?是不是上周换了模型版本,或者知识库更新了?然后从线上 trace 里按类别抽样做错误分析,把失败分成几类各占多少。改完以后,两个点的提升在 60 条测试集上是不是真的?上线时灰度,盯着转人工率和重问率,准备好回滚。最后写一页复盘,把这次发现的失败类型加进回归测试集,让它不会再悄悄回来。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="同一个问题,中级做法只有改提示词和跑测试集两步,资深做法前后多了定位原因、判断是否真的变好、灰度上线和复盘入库">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">「转人工变多了」,两种做法</text>
  <text x="20" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">中级</text>
  <rect x="120" y="46" width="130" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="130" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">改提示词</text>
  <rect x="270" y="46" width="130" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="280" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">跑测试集 +2 分</text>
  <line x1="250" y1="61" x2="270" y2="61" stroke="var(--ink-faint)"/>
  <text x="20" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">资深</text>
  <rect x="20" y="132" width="90" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="28" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">先定位原因</text>
  <rect x="124" y="132" width="90" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="132" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">改提示词</text>
  <rect x="228" y="132" width="90" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="236" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">跑测试集</text>
  <rect x="332" y="132" width="90" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="340" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">真的变好吗</text>
  <rect x="436" y="132" width="80" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="444" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">灰度上线</text>
  <rect x="530" y="132" width="90" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="538" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">复盘入库</text>
  <line x1="110" y1="147" x2="124" y2="147" stroke="var(--ink-faint)"/>
  <line x1="214" y1="147" x2="228" y2="147" stroke="var(--ink-faint)"/>
  <line x1="318" y1="147" x2="332" y2="147" stroke="var(--ink-faint)"/>
  <line x1="422" y1="147" x2="436" y2="147" stroke="var(--ink-faint)"/>
  <line x1="516" y1="147" x2="530" y2="147" stroke="var(--ink-faint)"/>
  <text x="20" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">中间两步一样,前后多的几步决定这个改动是真的变好,还是碰巧变好。</text>
</svg>
<figcaption>两种做法写的代码可能差不多,差的是前后那一圈:定位原因、判断是不是真的变好、灰度、复盘。</figcaption>
</figure>

两种做法的代码可能差不多,差的是前后那一圈。后面评测统计学([Day 547](/blog/agent-zero/day-547-eval-stats-1/) 到 [Day 550](/blog/agent-zero/day-550-eval-stats-4/))讲的是「两个点的提升是不是真的」,事故复盘([Day 600](/blog/agent-zero/day-600-incident-1/))讲的是出了事以后怎么带着团队走一遍。

## 给自己打分:八个维度的自检

昨天([Day 516](/blog/agent-zero/day-516-basic-graduation/))的自检有一条规矩:自评分要配证据,没有证据最多算 2 分。今天沿用它,把对象换成这八个维度,写一个很小的 `ladder.py`。每一维度有一句话说明、和进阶篇里对应的几天。

```python
# agent-zero-lab/part09/senior/ladder.py
import json
import sys
from pathlib import Path

DIMS = {
    "设计": ("能比较两三种架构,说清什么时候该换", (540, 541, 542, 543)),
    "评测": ("知道分数差多少才算数,会设计线上实验", (547, 548, 550, 554)),
    "规模": ("能估 10 倍流量下的成本、延迟、容量", (583, 586, 638)),
    "平台": ("把运行时、工具接入、评测做成别的团队能用的东西", (583, 584, 624, 625)),
    "模型": ("知道何时自部署、微调、蒸馏,并算清总成本", (563, 565, 567, 577)),
    "稳定性": ("持久化执行、降级、熔断,出事故能带着复盘", (535, 537, 600, 602)),
    "信息源": ("读论文、源码、官方工程博客,自己找答案", (519, 521, 558)),
    "影响力": ("写设计文档说服别人,带新人", (640, 645, 646)),
}


def effective(entry: dict) -> int:
    """没写证据的分数最多算 2,和 Day 516 的自检同一条规矩。"""
    score = entry.get("score", 1)
    return score if entry.get("evidence", "").strip() else min(score, 2)


def weakest(mine: dict, k: int = 3) -> list[tuple[str, int]]:
    scored = [(name, effective(mine.get(name, {}))) for name in DIMS]
    return sorted(scored, key=lambda x: x[1])[:k]


if __name__ == "__main__":
    mine = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    for name, (what, _) in DIMS.items():
        e = mine.get(name, {})
        eff = effective(e)
        flag = "" if eff == e.get("score", 1) else f"(自评 {e.get('score')},没证据按 {eff})"
        print(f"{name:<4} {eff} {flag}  {what}")
    print("\n最低三项,进阶篇先补这几块:")
    for name, s in weakest(mine):
        days = "、".join(f"Day {d}" for d in DIMS[name][1])
        print(f"  {name}({s} 分)  {days}")
```

<div class="line-notes">

- `DIMS = {` 八个维度,每个维度一个二元组:一句话说明和对应的 Day 号。Day 号是我按大纲对号入座的,比如「稳定性」对应 [Day 535](/blog/agent-zero/day-535-durable-1/)(持久化执行)、[Day 537](/blog/agent-zero/day-537-durable-3/)、[Day 600](/blog/agent-zero/day-600-incident-1/)(事故复盘)、[Day 602](/blog/agent-zero/day-602-incident-2/)。
- `"设计": ("能比较两三种架构,说清什么时候该换", (540, 541, 542, 543)),` [Day 540](/blog/agent-zero/day-540-orch-1/) 到 [Day 543](/blog/agent-zero/day-543-design-doc-2/) 是编排取舍和设计文档。
- `def effective(entry: dict) -> int:` 把自评分换算成「有效分」。
- `score = entry.get("score", 1)` 没填就当 1 分。
- `return score if entry.get("evidence", "").strip() else min(score, 2)` 有证据按自评分,没有证据最多 2 分。`min(score, 2)` 取两者中较小的。
- `scored = [(name, effective(mine.get(name, {}))) for name in DIMS]` 八个维度各算一个有效分。
- `return sorted(scored, key=lambda x: x[1])[:k]` 按有效分从低到高排,取前 k 个。同分的保持原来的先后(排序是稳定的),所以平局时排在前面的维度先出现,这个行为练习里不处理。
- `flag = "" if eff == e.get("score", 1) else f"(自评 {e.get('score')},没证据按 {eff})"` 自评和有效分不一致时,打印出来让你知道是为什么被降了。
- `for name, s in weakest(mine):` 打印最低的三项,默认 `k=3`。

</div>

我模拟的学员还是小林,他的八维度自评和证据放在 `me/ladder.json`:

```json
{
 "设计": {"score": 2, "evidence": "SupportPilot 选 pgvector 当时没写原因"},
 "评测": {"score": 4, "evidence": "supportpilot/eval/report.md,一致率 87%"},
 "规模": {"score": 3},
 "平台": {"score": 1},
 "模型": {"score": 2, "evidence": "Day 565 路由实验"},
 "稳定性": {"score": 3, "evidence": "arq 重试加断点续跑,Day 393"},
 "信息源": {"score": 3, "evidence": "读过 Building effective agents"},
 "影响力": {"score": 1}
}
```

```bash
uv run python -m part09.senior.ladder ../me/ladder.json
```

```text
设计   2   能比较两三种架构,说清什么时候该换
评测   4   知道分数差多少才算数,会设计线上实验
规模   2 (自评 3,没证据按 2)  能估 10 倍流量下的成本、延迟、容量
平台   1   把运行时、工具接入、评测做成别的团队能用的东西
模型   2   知道何时自部署、微调、蒸馏,并算清总成本
稳定性  3   持久化执行、降级、熔断,出事故能带着复盘
信息源  3   读论文、源码、官方工程博客,自己找答案
影响力  1   写设计文档说服别人,带新人

最低三项,进阶篇先补这几块:
  平台(1 分)  Day 583、Day 584、Day 624、Day 625
  影响力(1 分)  Day 640、Day 645、Day 646
  设计(2 分)  Day 540、Day 541、Day 542、Day 543
```

小林的「规模」自评 3 分,但证据栏是空的,所以被按 2 分算(第三行括号里写着)。最低的三项是平台(1 分)、影响力(1 分)和设计(2 分,与规模、模型并列,这次取了排在前面的设计)。对照进阶篇,他应该把 [Day 583](/blog/agent-zero/day-583-platform-1/) 起的平台化、[Day 640](/blog/agent-zero/day-640-design-docs-1/) 起的设计文档和带人、[Day 540](/blog/agent-zero/day-540-orch-1/) 起的编排取舍和设计文档排在前面。

这张表是个起点,不是判决。「平台 1 分」不是说他不行,是说他之前没做过,进阶篇正好有这一块。你自己填的时候,每一维度的证据尽量具体到文件路径、数字或者一个你被问住的场景;写不出来的,老实写 1 分或 2 分。

## 动手练习

### 练习 1:换成区间上限,结论变不变

`paired.py` 用的是区间下限。有人会说:公司真正愿意给资深的是区间上端,应该看上限。写一个脚本,同样做公司内部配对比较,这次取区间上限。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex518_hi.py
import statistics
from collections import defaultdict

from part09.senior.levels import USD, load, to_k

if __name__ == "__main__":
    g: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for j in load():
        m = USD.match(j["comp"])
        assert m is not None
        g[j["company"]][j["level"]].append(to_k(m[3], m[4]))  # 这次取区间上限
    for lv in ("senior", "staff+"):
        rs = []
        for d in g.values():
            if len(d.get("未标级", [])) >= 3 and len(d.get(lv, [])) >= 3:
                rs.append(statistics.median(d[lv]) / statistics.median(d["未标级"]))
        print(f"{lv:<7} 上限比值 {[round(r, 2) for r in rs]},中位 {statistics.median(rs):.2f}")
```

<div class="line-notes">

- `from part09.senior.levels import USD, load, to_k` 复用 `levels.py` 里的正则和换算函数。
- `m = USD.match(j["comp"])` 重新匹配一次,拿到四个捕获组。
- `assert m is not None` `load()` 保证过这条能解析,`assert` 是写给类型检查器看的。
- `g[j["company"]][j["level"]].append(to_k(m[3], m[4]))  # 这次取区间上限` `m[3]` 和 `m[4]` 是上限的数字和 `K`;下限是 `m[1]` 和 `m[2]`。
- `if len(d.get("未标级", [])) >= 3 and len(d.get(lv, [])) >= 3:` 和 `paired.py` 同样的门槛。
- `print(f"{lv:<7} 上限比值 {[round(r, 2) for r in rs]},中位 {statistics.median(rs):.2f}")` 先把每家的比值四舍五入再打印。

</div>

```text
senior  上限比值 [1.74, 0.86, 0.89, 0.98],中位 0.94
staff+  上限比值 [1.05, 1.05, 1.74, 1.22, 1.06, 1.11, 1.25],中位 1.11
```

senior 的上限比值中位数是 0.94,也就是 senior 的上限比未标级还略低;staff+ 是 1.11,只高一成。和下限比起来,staff+ 的优势缩小了(1.27 变 1.11),senior 的优势消失了。意思是:**差距主要在下限,上限基本被拉平**,公司的上限是同一个封顶价,谁都碰得到;区别在于你的起步价被定在多高的位置。如果你只看上限会得出「级别不重要」的错误结论。

要说一句:senior 那四个比值里有一个是 1.74(Decagon,上限 400K 对未标级的 230K),另外三个都在 1 以下,四个数拉得很散。中位数不怕这个异常值,所以得到 0.94,但样本只有四家,这个数字不要读太深。

</details>

### 练习 2:换一批词,看结论变不变

`wants.py` 里的七类词是我挑的。换成「和 Agent 本身更相关」的四类:`agent`、`RAG / retrieval`、`fine-tuning / RL`、`prompt`,看 senior 和 staff+ 的 JD 里这些词比未标级多还是少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex518_words.py
from part09.senior import wants

if __name__ == "__main__":
    wants.WORDS.clear()
    wants.WORDS.update({
        "agent": r"\bagent",
        "RAG / retrieval": r"\bRAG\b|retrieval",
        "fine-tuning / RL": r"fine-tun|reinforcement|\bRLHF\b|\bGRPO\b",
        "prompt": r"\bprompt",
    })
    wants.main()
```

<div class="line-notes">

- `from part09.senior import wants` 导入的是整个模块,不是里面的某个名字,因为要改它里面的 `WORDS`。
- `wants.WORDS.clear()` 清空原来的七类词。`WORDS` 是个模块级字典,改它会影响后面 `wants.main()` 的行为。
- `wants.WORDS.update({` 放进新的四类。
- `"agent": r"\bagent",` `\bagent` 能匹配 `agent`、`agents`、`agentic`。
- `"fine-tuning / RL": r"fine-tun|reinforcement|\bRLHF\b|\bGRPO\b",` 微调和强化学习这一类。
- `wants.main()` 直接调 `wants.py` 里的 `main`,打印的表格和原来一样。这就是当初把 `main` 拆成函数的原因。

</div>

```text
                                未标级(n=154)    senior(n=45)    staff+(n=58)
agent                                  86%             89%             88%
RAG / retrieval                        14%             22%             21%
fine-tuning / RL                       10%              2%              2%
prompt                                 27%             20%             16%
第一个出现的年限要求(中位)          5 年(112 条写了)     5 年(35 条写了)     8 年(47 条写了)
```

这一次没有任何一类词随级别稳定上升。agent 三档都是 86% 到 89%,因为这批岗位本来就是 AI 公司的;RAG / retrieval 是 14%、22%、21%;fine-tuning / RL 反而是未标级最高(10%,另两档都只有 2%),可能因为研究型的岗位多半不带 senior 前缀;prompt 随级别往上还在降(27%、20%、16%)。**这正是进阶篇的路线选择的依据之一:「会更多 AI 技术」不是区分资深的信号。** 区分它的是第四步数出来的那几类:带人、负责到底、稳定性,还有 staff 那一档跳到 8 年的年限。

</details>

### 练习 3:换一个人的打分

小林的短板是平台和影响力。写出另一个人的 `ladder_b.json`:一个做了五年后端、刚转 Agent 的人。他在规模、平台、稳定性上很强,在评测、模型、信息源上弱。跑一遍,看最低的三项,再想想他进阶篇该怎么安排。

<details><summary>参考答案</summary>

示范的 `ladder_b.json`(完整的在 `me/ladder_b.json`):设计 4 分有两份 ADR,规模 4 分有压测报告,平台 4 分有内部网关,稳定性 5 分有一份事故复盘,评测只有 2 分(30 条测试集),模型 1 分没有证据,信息源 2 分只写了「偶尔看看」,影响力 3 分带过一个实习生。

```text
设计   4   能比较两三种架构,说清什么时候该换
评测   2   知道分数差多少才算数,会设计线上实验
规模   4   能估 10 倍流量下的成本、延迟、容量
平台   4   把运行时、工具接入、评测做成别的团队能用的东西
模型   1   知道何时自部署、微调、蒸馏,并算清总成本
稳定性  5   持久化执行、降级、熔断,出事故能带着复盘
信息源  2   读论文、源码、官方工程博客,自己找答案
影响力  3   写设计文档说服别人,带新人

最低三项,进阶篇先补这几块:
  模型(1 分)  Day 563、Day 565、Day 567、Day 577
  评测(2 分)  Day 547、Day 548、Day 550、Day 554
  信息源(2 分)  Day 519、Day 521、Day 558
```

最低三项是模型(1)、评测(2)、信息源(2)。这和小林完全不一样:同一个脚本、同一套维度,给不同背景的人排出不同的学习顺序。这个人应该先走 [Day 563](/blog/agent-zero/day-563-model-selection-1/) 起的选模型和 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 起的评测统计学,再补 [Day 519](/blog/agent-zero/day-519-senior-map/)(明天)和 [Day 521](/blog/agent-zero/day-521-harness-sources/) 的读源码、读论文。反过来,他可以把平台、稳定性这些「已经有了」的内容当复习快过,把时间省给最弱的那几块。

对比今天开头:**同样叫资深,每个人缺的东西是不一样的**,所以进阶篇没有「标准的先后」,有的是「你最低的三项在哪」。

</details>

学完以后,验收标准是:

- 你跑通了 `fetch_levels`、`levels`、`paired`、`wants` 四个脚本,能用一句话讲清楚为什么第一版「资深更便宜」是错的(一家公司占了大半,要在公司内部比)。
- 你有一份自己的 `ladder.json`,八个维度每项有自评和一句证据,知道最低的三项对应进阶篇哪几天。
- 你能说出这份数据的三个局限,以及它回答不了的两个问题(股权、国内)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 资深 / Senior | 标题层面是一个职级前缀,实际含义是能独立负责一块系统的设计和交付,在不确定中做取舍 |
| Staff 工程师 | 资深再往上一级,影响范围常常跨多个团队,多见于海外公司的职级体系 |
| Principal | 比 Staff 还高一级的技术职级,有的公司和 Staff 并列 |
| 薪资透明法 | 美国部分州要求招聘广告写明薪资区间的法规,所以公开岗位里能看到区间 |
| 区间下限、区间中点 | 区间的两端和平均,下限更接近「起步价」,中点代表整个区间的中间 |
| 混杂 | 想看的因素(职级)和另一个因素(公司)同时在变,而且后者影响更大,导致结论失真 |
| 配对比较 | 在同一个单位(这里是同一家公司)内部比较两个条件,再看差距在各个单位是不是同方向 |
| IC | Individual Contributor,不带团队的个人贡献者职级线,和管理线并行 |
| 级别评定(leveling) | 公司在面试后决定你该被评在哪一级,同一个岗位区间里的具体位置由它决定 |

## 常见误区

**拿整体中位数比职级。** 第一版的「资深更便宜」就是这么来的。整体数字里谁贡献得多,结论就是谁的,先看每组里是什么构成,再决定能不能比。

**以为标题前缀决定薪资。** Decagon 的 senior 和 staff 挂同一个区间。公司的档次、地点档位、面试评级加起来,比标题前缀影响大得多。

**把区间下限和上限混着读。** 下限是起步价,上限是封顶价。公开区间里上限往往被拉得差不多,级别的差距更多体现在下限和你被定在区间里的位置。

**把关键词计数当成资格线。** JD 里写了 `ownership` 不代表这个岗位真的要你负责到底。数词只能看方向,看不出资格。

**用「资深」代替「具体能力」。** 面试官问的是「你主导过什么决定、证据是什么」,不是「你是不是资深」。进阶篇每一个维度都要落到一个你能拿出来的东西(文档、数字、仓库)上。

**以为进阶篇是把中级的东西学得更深。** 资深和中级的差别不主要在「会更多」,而在前后多出来的那一圈:定位、验证、灰度、复盘、写下来、说服别人。

**拿美国挂牌数据直接对标自己的预期。** 币种、地点、股权、税都不一样,这份数据只用来看形状,不用来定价。

## 学习资料

### 文档与文章

- [Dropbox Engineering Career Framework](https://dropbox.github.io/dbx-career-framework/):公开的职级框架,从 IC1 到 IC7,先读「What is Impact?」一页,再选一个对应你方向的职级看每一级要求什么。
- [Will Larson · Staff Engineer 介绍页](https://staffeng.com/book):书的作者官网,有书的简介、故事和指南,先读指南部分。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):普通篇读过,进阶开学再读一遍,这次留意它怎么论证「先用最简单的方案」,这就是资深的思维方式。
- [Ashby 公开职位接口文档](https://developers.ashbyhq.com/docs/public-job-posting-api):今天用的接口,想换别的公司抓职位先读这个。
- [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents):把生产级 Agent 的原则写成十二条,进阶篇的很多天会和它对上。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zWdfBTEyx&autoplay=0&high_quality=1" title="我们如何构建高效的智能体:How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>全球AI情报局 · 我们如何构建高效的智能体 · 15 分钟带中文字幕的搬运。重点听他讲「什么时候不该做 Agent」和「从 Agent 的视角看问题」两段。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1FAWGzVEWF&autoplay=0&high_quality=1" title="Anthropic构建高效agent的第一性原理:精读《Building effective agents》①" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · 精读《Building effective agents》① · 10 分钟,中文逐段精读,适合配合原文一起看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents: Barry Zhang, Anthropic · 上面 B 站搬运的原版,英文好的直接看这个。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/FqPwHHrN1bg" title="What is Agentic AI Engineering (Meta Staff Engineer Explains)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>John Kim · What is Agentic AI Engineering (Meta Staff Engineer Explains) · 一个 Meta Staff 工程师讲他眼里的 Agent 工程是什么,可以对照今天的八个维度,看他强调的是哪几项。</figcaption>
</figure>

### 书籍

- Will Larson《Staff Engineer: Leadership beyond the management track》(2021),[作者官网](https://staffeng.com/book):讲 Staff 工程师有哪几种类型、日常做什么。今天读开头几章,搞清楚资深之后的路长什么样。
- Tanya Reilly《The Staff Engineer's Path》(O'Reilly,2022):比上一本更偏实操,讲怎么看全局、怎么推动跨团队的事,进阶篇后半(带人和推动)会用到。
- Chip Huyen《AI Engineering》(O'Reilly,2025):普通篇推荐过,进阶篇会反复回到评测和架构两部分。

### 开源项目与代码

- 你自己的 `agent-zero-lab/part09/senior/`:今天四个脚本和 `ladder.py` 都在这里,`postings.json` 是你自己抓的快照,过几个月重跑一次,可以看看分级差距有没有变。
- [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents):今天通读一遍目录,后面几天会逐条用到。

## 自测

1. 第一版比较里,senior 的中位数比「未标级」低,为什么不能得出「资深更便宜」?

<details><summary>答案</summary>

因为「未标级」里 OpenAI 一家就占了六成多,它的区间本来就比别家高,整体中位数反映的是「OpenAI 普通岗位多少钱」,和职级无关。这是混杂:想看的因素(职级)和另一个影响更大的因素(公司)同时变了。要在同一家公司内部比,再看各家公司的差距方向是不是一致。

</details>

2. 配对比较里为什么要设 `MIN_N = 3`?

<details><summary>答案</summary>

一家公司里某一档只有 1 到 2 条的话,中位数就是那一两条的数,不能代表这家公司这一档的水平。设一个最低条数,让「能比的公司」都至少有 3 条支撑。这个 3 是取舍,不是什么标准,数据多了可以提高。

</details>

3. 为什么说「Decagon 的 senior 和 staff 挂同一个区间」对找工作有启发?

<details><summary>答案</summary>

说明区间不是按标题前缀定的,同一个区间覆盖了好几个级别,你最后拿到区间里的哪个位置取决于面试时被评的级别。所以谈薪和准备面试时,盯着的应该是「我会被评在哪一级、证据是什么」,而不是标题上有没有 Senior。

</details>

4. 区间下限和上限,哪个更能体现级别差距?本文的数据怎么说?

<details><summary>答案</summary>

下限更能体现。数据里 staff+ 对未标级,下限比值中位 1.27,上限比值只有 1.11;senior 的下限比值 1.10,上限比值甚至是 0.94。上限往往被各级共用,封顶价差不多,起步价才区分级别。

</details>

5. (面试题)「请讲一个你主导的技术决策,当时有哪些选项,为什么选这个,什么条件下你会推翻它?」

<details><summary>答案</summary>

示范结构:背景(规模、约束)、考虑过的两三个方案、选择和理由(带数据)、代价、以及重新评估的触发条件。比如「SupportPilot 知识库选 pgvector 不用 Milvus:几百个切块用不上专业向量库,业务库本来就在 Postgres,团队只有一个人;向量数超过 500 万或检索 P95 超过 200ms 时重新评估」。重点是最后一句:能说出什么情况下推翻自己的决定,是资深和中级的分界点之一。明天(Day 519)会把它写成第一份 ADR。

</details>

6. 关键词统计里「mentor」从 7% 升到 16% 再到 43%,而「design / architect」没有单调上升。你怎么解读?

<details><summary>答案</summary>

mentor 逐级上升,而且是三档里变化最大的,可以当「资深以上要带人」的一条印证。design / architect 在 senior 档反而最低,样本只有几十条,差几个百分点在噪声里,不能读成「资深不用做设计」。关键词计数只能看方向,分不出 JD 里是真要求还是随手写的一句。

</details>

## 明天预告

明天是 Day 519,进阶开学(二):进阶篇的地图和学习方式,以及你的第一份 ADR。今天找出了自己最低的三项,明天讲进阶篇换一种学法:读论文、读源码、写文档,不再只是跟着敲代码;然后拿 SupportPilot 的一个真实决定,按「背景、选项、决定、代价、什么时候推翻」写一份 ADR,放进仓库的 `docs/adr/`。
