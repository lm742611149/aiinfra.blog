---
title: 'Day 511 · 求职(一):数据从哪来,渠道和薪资'
description: '去哪儿找 Agent 岗、能拿多少钱。用 2026 年 10 月抓到的 880 条 JD 说话:每个招聘平台能看到什么、看不到什么;写一个脚本把「30-60K·16薪」这种挂牌薪资折成年包,在 557 条国内样本上算出中位 48 万,再按年限、城市、公司规模拆开。重点是口径:挂牌价不是成交价,平均数不是中位数,网上「AI 岗平均月薪 6 万」和你能谈到的数为什么差这么多。'
pubDate: 2026-10-23
regime: none
tags: ['job-search', 'salary', 'statistics', 'python', 'agent-zero']
series: 'agent-zero'
day: 511
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 510](/blog/agent-zero/day-510-week73-review/) 是第 73 周复习:默写了 `run` 和四个小函数,用判卷脚本打到 8/8,又把整周的脚本拼成一场三轮模拟面试 `mock.py`,题目优先抽回炉题,编码自动判卷,成绩分两份日志记。

到这里,简历([Day 498](/blog/agent-zero/day-498-resume-1/) 到 501)和面试(Day 502 到 510)都准备了。还剩两个很现实的问题:去哪儿找岗位,能拿多少钱。这两个问题网上的答案又多又乱,有「Agent 工程师年薪百万」的营销号,也有「AI 岗都是骗人的」的吐槽帖。接下来三天讲求职:今天讲数据从哪来、渠道和薪资,明天讲海外远程和 FDE 岗,后天讲面试流程、谈薪和投递节奏。

## 今天要解决的问题

今天结束时你应该能:

1. 说出国内外主要招聘渠道各自能看到什么岗位、薪资透明度怎样,定下你自己的一个主渠道、一两个辅助渠道。
2. 写出 `annual_mid`,把「30-60K·16薪」「25-30k」「1.5-2.5万」这类挂牌薪资折成年包中点,认得出折不了的(面议、日薪)。
3. 用 `statistics` 算中位数、P25、P75,并按年限、城市分组;解释为什么报中位数不报平均数,为什么要找「和你同一格」的数。
4. 讲清楚口径:一个薪资数字至少要问清来源、挂牌还是成交、平均还是中位、算没算年终和股票。

预计用时 2.5 小时,之后是持续几周的收藏和投递。前置:[Day 145](/blog/agent-zero/day-145-prompt-lab/) 用过的 `statistics.median` 和 `quantiles`;[Day 498](/blog/agent-zero/day-498-resume-1/) 的关键词表(读 JD 的方法);[Day 503](/blog/agent-zero/day-503-week72-review/) 练习 3 按技能覆盖率给 JD 排序。今天不调模型,花费 ¥0。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `parse_salary` 和 `annual_mid`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 数据从哪来

这一节先讲今天所有数字的来源,因为**一个数字值多少,取决于它是怎么来的**。

站长在 2026 年 10 月 12 日抓了一批 Agent 岗位的 JD,一共 880 条:国内 695 条,海外 185 条(新加坡 52、香港 23、海外远程 46、美国本土 40、欧洲日韩澳印等 24)。国内分两批:第一批 120 条主要来自腾讯、字节、美团、百度、网易、京东的招聘官网和智联招聘,不登录就能看;第二批 575 条是用站长自己的账号登录以后抓的,Boss 直聘 435 条、猎聘 140 条。今天的国内薪资全部来自第二批。

这批数据的局限要先说清楚,后面每个数字都带着它们:

- **薪资是招聘方挂出来的区间,不是谈下来的成交价。** 招聘方写「30-50K」,大多数人谈下来落在区间的中下段,能拿到上沿的是很强的候选人。
- **只抓了每个搜索的第一页。** 关键词(AI Agent、大模型应用开发、LLM 应用开发、智能体开发、Agent 工程师)乘四个城市(北京、上海、深圳、杭州),每组只看第 1 页。排在第一页的是谁,取决于平台的推荐算法和站长账号的画像,不是随机抽样。
- **Boss 435 条里只有 74 条抓到了正文。** 连续打开七十多个职位详情页以后,Boss 弹出「您的账户存在异常行为」,就停了。所以薪资、年限、学历、公司规模这些列表字段是全的,技能统计靠的是有正文的那部分。
- 拉勾、前程无忧被人机验证挡住,没有数据;脉脉要登录,没试。
- 技能比例是正则关键词匹配,不是人工一条条标的。

所以这不是一份行业薪资报告,是一份**能核对的样本**:每条都有平台、链接和抓取日期。原始数据没有公开(里面有招聘方信息,而且抓的时候用的是个人账号),文章里会给你其中 22 条脱敏后的样本,你在自己的电脑上跑同一份代码;全部 575 条的结果是我在原始数据上跑的,标明了出来。

顺带一个提醒,和你自己找工作直接相关:Boss 和猎聘都要登录才能看全,Boss 对短时间内大量打开职位详情很敏感。你正常浏览不会有问题,但**不要用脚本批量刷,也不要装来源不明的「自动投递」插件**,账号被限制会直接影响你求职。今天的代码只处理你自己手里已经有的数据,不去抓任何网站。

## 渠道:每个平台能看到什么

| 平台 | 地区 | 样本数 | 能看到什么 | 适合用来 |
| --- | --- | --- | --- | --- |
| Boss 直聘 | 国内 | 435 | 要登录;列表全部带薪资;和招聘方直接聊 | 主力投递渠道,中小公司和大厂业务团队都在 |
| 猎聘 | 国内 | 140 | 要登录;带薪资和完整 JD;猎头多 | 中高端岗位、被猎头找 |
| 智联招聘 | 国内 | 27 | 公开搜索,有薪资(写成「1.5-2.5万」),中小公司多 | 补充渠道 |
| 大厂招聘官网 | 国内 | 74 | 公开,JD 写得最细,**不写薪资** | 研究大厂要求、直接投递 |
| 脉脉 | 国内 | 未抓 | 要登录,有内推和职言区 | 找内推、打听团队情况 |
| 拉勾、前程无忧 | 国内 | 0 | 被人机验证挡住 | 这次没有数据 |
| V2EX 招聘节点 | 国内 | 3 | 公开,技术圈小团队 | 小团队,偶尔有远程 |
| LinkedIn | 新加坡、香港、远程 | 64 | 公开职位页;香港岗**一条都没写薪资** | 外企、新港岗位 |
| MyCareersFuture | 新加坡 | 29 | 新加坡政府职位库,**每条都写月薪** | 新加坡薪资行情 |
| 公司官网(Ashby、Greenhouse、Lever) | 海外 | 50 | OpenAI、Anthropic、Sierra、Decagon 等,美国岗大多写年薪区间 | 头部 AI 公司 |
| Hacker News「Who is hiring」 | 海外 | 39 | 每月一帖,创业公司在帖子下回复招人 | 海外创业公司、部分远程 |
| Remote OK、We Work Remotely | 远程 | 3 | 公开 | 远程岗,Agent 相关很少 |

这张表从前端的角度很好理解。每个招聘平台都是一个网站,职位列表是它的接口返回的 JSON,渲染成你看到的卡片。区别在于**接口愿意给谁看、给看多少**:大厂官网的接口对谁都开放,但字段里压根没有薪资;Boss 的接口要登录态,有薪资,但会盯着你的访问频率;MyCareersFuture 是政府办的,公开而且强制写月薪;Ashby、Greenhouse、Lever 是海外公司常用的招聘系统(ATS,下面名词表有),很多公司的职位列表直接挂在它们的公开接口上。明天讲海外岗时会真的调一次这种公开接口。

我的建议:**国内以 Boss 为主,大厂官网直投加脉脉找内推为辅**;想去新加坡看 LinkedIn 和 MyCareersFuture;想去头部海外 AI 公司直接看它们官网的职位页。

关于 Boss 有一个实际的技巧。Boss 上是招聘方先看到你的在线简历,再决定要不要回你,所以在线简历的「个人优势」和「项目经历」要放 Day 498 关键词表里那些词;打招呼的第一句别用默认模板,写一句和这个 JD 有关的话,比如「看到贵司在做客服场景的 Agent,我做过一个带评测和人工审批的客服工单 Agent,演示链接……」。

## 薪资的口径:一个数字要问四个问题

先看一个反差。2026 年 3 月,每日经济新闻报道了脉脉发布的数据:2026 年前两个月,AI 岗位**平均月薪 60738 元**。而今天这批 557 条 Agent 岗的挂牌月薪,区间中点的**中位数是 3.5 万**。两个数差了将近一倍,哪个是错的?

都没错,是**口径**不一样。口径就是「这个数是怎么算出来的」,包括数据从哪来、算的是哪一类岗位、用的是什么统计量。前端的类比是:同一个页面,「首屏时间 1.2 秒」和「首屏时间 3.5 秒」可能都是真的,一个是 P50,一个是 P95,一个在公司 Wi-Fi 下测,一个在 3G 网络下测。不问清楚口径就比较,结论一定是错的。

看到一个薪资数字,至少问四个问题:

1. **哪来的?** 哪个平台、哪类岗位、什么时候。脉脉的数字包括算法研究员、大模型算法这类薪资很高的岗位,样本是脉脉上的中高端岗位;今天的数字只有 Agent 应用类岗位,来自 Boss 和猎聘的第一页。
2. **挂牌还是成交?** 招聘方挂出来的区间,还是候选人实际拿到的。网上几乎所有「平均薪资」都是挂牌价。
3. **平均还是中位?** 平均数会被少数特别高的岗位拉高,下面会实跑看到。
4. **包括哪些?** 月薪还是年包,年包算了几个月,年终奖、股票、公积金算没算。「30-60K·16薪」和「30-60K」差了 4 个月。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="从 880 条 JD 到和你同一格的几十条:每一步筛掉什么,数字怎么变">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一个「中位 48 万」是怎么筛出来的,以及你该看哪一格</text>
  <rect x="20" y="40" width="600" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="30" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">880 条 JD(国内 695 + 海外 185)</text>
  <rect x="70" y="84" width="500" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="80" y="106" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">575 条:Boss 435 + 猎聘 140(大厂官网不写薪资,不算)</text>
  <rect x="120" y="128" width="400" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="130" y="150" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">557 条能折算(去掉面议、日薪)</text>
  <text x="130" y="180" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">中位 48 万 · P25 35.7 · P75 67.5 · 平均 54.9</text>
  <rect x="200" y="196" width="240" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="210" y="218" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">你的那一格:城市 × 年限 × 规模</text>
  <text x="20" y="256" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每往下一层,数字更像你,样本也更少;一格里少于 10 条,只看大概</text>
  <text x="20" y="276" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">全程都是挂牌价;成交价通常落在区间中下段</text>
</svg>
<figcaption>今天所有国内薪资数字的筛选过程。琥珀色是原始样本,蓝色是能算的部分。真正对你有用的是最下面那一格,而不是中间那个总体中位数。</figcaption>
</figure>

下面一步步把这个过程用代码做一遍。

## 第一步:把挂牌薪资折成年包

先建今天的目录,放样本数据。在 `agent-zero-lab/` 下:

```bash
cd agent-zero-lab
mkdir -p part09/jobs
touch part09/jobs/__init__.py
```

`part09/jobs/salary_sample.json` 是从 575 条里挑的 22 条,去掉了公司名,保留平台、城市、职位名、挂牌薪资、年限要求和公司规模。前 21 条来自 Boss 和猎聘,第 22 条是智联的,用来演示「万」这种写法。可以直接复制:

```json
[
{"id": 1, "src": "boss", "city": "上海", "title": "AI智能体开发", "salary": "6-10K", "exp": "经验不限", "scale": "100-499人"},
{"id": 2, "src": "boss", "city": "北京", "title": "大模型应用开发工程师", "salary": "30-40K", "exp": "3-5年", "scale": "1000-9999人"},
{"id": 3, "src": "boss", "city": "北京", "title": "AI-Agent后训练(27届校招)", "salary": "面议", "exp": "在校/应届", "scale": "1000-9999人"},
{"id": 4, "src": "boss", "city": "上海", "title": "大模型与 Agent 平台全栈工程师", "salary": "40-70K", "exp": "3-5年", "scale": "1000-9999人"},
{"id": 5, "src": "boss", "city": "杭州", "title": "AI AGENT专家", "salary": "35-45K·14薪", "exp": "5-10年", "scale": "10000人以上"},
{"id": 6, "src": "liepin", "city": "北京", "title": "AI 智能体工程师", "salary": "25-30k·16薪", "exp": "3-5年", "scale": "5000-10000人"},
{"id": 7, "src": "liepin", "city": "杭州", "title": "AI Agent 开发工程师", "salary": "25-45k", "exp": "2年以上", "scale": "100-499人"},
{"id": 8, "src": "boss", "city": "上海", "title": "AI Agent 研发工程师(Harness)", "salary": "30-40K·14薪", "exp": "3-5年", "scale": "1000-9999人"},
{"id": 9, "src": "boss", "city": "深圳", "title": "大模型应用开发工程师 AI Agent", "salary": "26-50K·14薪", "exp": "3-5年", "scale": "20-99人"},
{"id": 10, "src": "boss", "city": "北京", "title": "大模型应用开发工程师", "salary": "40-70K·16薪", "exp": "经验不限", "scale": "1000-9999人"},
{"id": 11, "src": "boss", "city": "上海", "title": "大模型评测", "salary": "40-60K·16薪", "exp": "3-5年", "scale": "100-499人"},
{"id": 12, "src": "boss", "city": "杭州", "title": "AI Agent开发工程师", "salary": "25-50K·14薪", "exp": "3-5年", "scale": "0-20人"},
{"id": 13, "src": "boss", "city": "上海", "title": "AI Agent", "salary": "90-110K·16薪", "exp": "10年以上", "scale": "10000人以上"},
{"id": 14, "src": "boss", "city": "上海", "title": "AI/Agent测评", "salary": "150-200元/天", "exp": "", "scale": "0-20人"},
{"id": 15, "src": "liepin", "city": "北京", "title": "Agent研发工程师", "salary": "30-60k", "exp": "经验不限", "scale": "500-999人"},
{"id": 16, "src": "boss", "city": "上海", "title": "大模型算法工程师(电商)", "salary": "35-65K·16薪", "exp": "经验不限", "scale": "500-999人"},
{"id": 17, "src": "boss", "city": "深圳", "title": "企业智能体全栈开发工程师", "salary": "40-70K·15薪", "exp": "3-5年", "scale": "10000人以上"},
{"id": 18, "src": "boss", "city": "杭州", "title": "AI 应用开发工程师(LLM/RAG)", "salary": "20-25K·13薪", "exp": "3-5年", "scale": "1000-9999人"},
{"id": 19, "src": "boss", "city": "上海", "title": "Agent应用开发", "salary": "60-85K", "exp": "经验不限", "scale": "100-499人"},
{"id": 20, "src": "liepin", "city": "深圳", "title": "AI开发工程师", "salary": "15-20k", "exp": "2-4年", "scale": "100-499人"},
{"id": 21, "src": "liepin", "city": "上海", "title": "AI应用工程师", "salary": "30-55k", "exp": "5-10年", "scale": ""},
{"id": 22, "src": "zhaopin", "city": "北京", "title": "AI应用工程师", "salary": "1.5-2.5万", "exp": "", "scale": ""}
]
```

读这些字符串,规律很明显:「低-高K·N薪」,K 是千,后面可能跟着几薪。年包怎么折?今天的口径是:**月薪区间取中点,乘以薪数,没写薪数按 12 薪**。比如「30-60K·16薪」,中点 4.5 万,乘 16 个月,年包中点 72 万。这个口径会高估一些(上沿很难拿到),也会低估一些(没算年终奖和股票),但它对每条岗位一视同仁,拿来比较是公平的。

第一版只认最常见的写法:

```python
# agent-zero-lab/part09/jobs/salary.py  (第一版)
import re

PAT = re.compile(r"(\d+)-(\d+)K(?:·(\d+)薪)?")


def parse_salary(s: str) -> tuple[float, float, int]:
    m = PAT.match(s)
    lo, hi, months = m.groups()
    return float(lo) * 1000, float(hi) * 1000, int(months or 12)


if __name__ == "__main__":
    for s in ["30-60K·16薪", "6-10K", "25-30k·16薪"]:
        print(s, "→", parse_salary(s))
```

<div class="line-notes">

- `PAT = re.compile(r"(\d+)-(\d+)K(?:·(\d+)薪)?")` 三个括号分组:低、高、薪数。`(?:...)?` 是「不捕获的分组,整体可有可无」,薪数那一截有就抓,没有就跳过。正则 [Day 498](/blog/agent-zero/day-498-resume-1/) 用了一整天,这里只是同样的写法。
- `m = PAT.match(s)` `match` 从字符串开头匹配,相当于 JS 里带 `^` 的 `regex.exec(s)`。匹配不上返回 None。
- `lo, hi, months = m.groups()` 把三个分组一次拆出来。没写薪数时 `months` 是 None。
- `return float(lo) * 1000, float(hi) * 1000, int(months or 12)` 返回一个三元组,`months or 12`:None 就用 12。

</div>

```bash
uv run python -m part09.jobs.salary
```

```text
30-60K·16薪 → (30000.0, 60000.0, 16)
6-10K → (6000.0, 10000.0, 12)
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File "/Users/你/agent-zero-lab/part09/jobs/salary.py", line 15, in <module>
    print(s, "→", parse_salary(s))
                  ^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part09/jobs/salary.py", line 9, in parse_salary
    lo, hi, months = m.groups()
                     ^^^^^^^^
AttributeError: 'NoneType' object has no attribute 'groups'
```

(终端里 Traceback 可能先于前两行出现,因为它走的是另一条输出通道 stderr,我按逻辑顺序排了。)

前两条对,第三条崩了。从最后一行往上读:`'NoneType' object has no attribute 'groups'`,对 None 调了 `.groups()`,也就是 `match` 没匹配上。原因是猎聘写的是小写的 `k`,而正则里只写了大写 `K`。JS 里同样的错是 `Cannot read properties of null (reading 'groups')`。

这就是口径的第一个坑:**不同平台的写法不一样**。Boss 写 K,猎聘写 k,智联写万,还有面议、日薪。改成认得出常见写法,认不出的老老实实返回 None,由调用方决定怎么办:

```python
# agent-zero-lab/part09/jobs/salary.py
import re

PAT = re.compile(r"^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)([Kk万])(?:·(\d+)薪)?$")
UNIT = {"K": 1000, "k": 1000, "万": 10000}


def parse_salary(s: str) -> tuple[float, float, int] | None:
    m = PAT.match(s.strip())
    if m is None:
        return None
    lo, hi, unit, months = m.groups()
    return float(lo) * UNIT[unit], float(hi) * UNIT[unit], int(months or 12)


def annual_mid(s: str) -> float | None:
    p = parse_salary(s)
    if p is None:
        return None
    lo, hi, months = p
    return (lo + hi) / 2 * months / 10000


if __name__ == "__main__":
    for s in ["30-60K·16薪", "6-10K", "25-30k·16薪", "1.5-2.5万", "面议", "150-200元/天"]:
        print(f"{s:<14} → {parse_salary(s)}  年包中点 {annual_mid(s)} 万")
```

<div class="line-notes">

- `PAT = re.compile(r"^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)([Kk万])(?:·(\d+)薪)?$")` 改了四处:数字允许带小数(`1.5`);单位单独成一个分组,K、k、万三选一;开头 `^` 结尾 `$` 要求整串都符合,「150-200元/天」不会被误认成别的。
- `UNIT = {"K": 1000, "k": 1000, "万": 10000}` 单位换算表。用字典查,比写一串 `if unit == ...` 清楚,加一种单位只加一行。
- `def parse_salary(s: str) -> tuple[float, float, int] | None:` 返回类型多了 `| None`:认不出就返回 None,不再崩。相当于 TS 的 `[number, number, number] | null`。
- `m = PAT.match(s.strip())` `strip()` 去掉首尾空格,相当于 JS 的 `trim()`。
- `if m is None:` 认不出的写法交给调用方处理。在这里抛异常也可以,但那样 575 条里一条怪写法就会让整个统计停下来。
- `return float(lo) * UNIT[unit], float(hi) * UNIT[unit], int(months or 12)` 「25-30k·16薪」得到 (25000.0, 30000.0, 16)。
- `def annual_mid(s: str) -> float | None:` 折成年包中点,单位万元。
- `return (lo + hi) / 2 * months / 10000` 「30-60K·16薪」:(30000 + 60000) / 2 = 45000,乘 16 = 720000,除以 10000 得 72.0 万。

</div>

```bash
uv run python -m part09.jobs.salary
```

```text
30-60K·16薪     → (30000.0, 60000.0, 16)  年包中点 72.0 万
6-10K          → (6000.0, 10000.0, 12)  年包中点 9.6 万
25-30k·16薪     → (25000.0, 30000.0, 16)  年包中点 44.0 万
1.5-2.5万       → (15000.0, 25000.0, 12)  年包中点 24.0 万
面议             → None  年包中点 None 万
150-200元/天     → None  年包中点 None 万
```

面议和日薪认不出,返回 None。日薪「150-200元/天」基本是实习或兼职的测评岗,和正式岗放在一起折年包没有意义,跳过是对的。面议的岗位不一定差,只是没给数,统计里只能不算,这本身也是样本的一个偏差:愿意写薪资的公司和不写的公司,可能本来就不一样。

## 第二步:中位数、分位数和分组

折算好了,接下来是统计。[Day 145](/blog/agent-zero/day-145-prompt-lab/) 用过标准库的 `statistics.median` 和 `quantiles`,今天再加一个 `mean`(平均数),专门看它和中位数差在哪。

先看一个小实验,只用样本里的 20 条:

```python
# agent-zero-lab/part09/jobs/mean_vs_median.py
import json
import statistics
from pathlib import Path

from part09.jobs.salary import annual_mid

jobs = json.loads(Path("part09/jobs/salary_sample.json").read_text(encoding="utf-8"))
vals = sorted(a for j in jobs if (a := annual_mid(j["salary"])) is not None)
print("从低到高:", vals)
print(f"20 条   平均 {statistics.mean(vals):.1f}  中位 {statistics.median(vals):.1f}")
print(f"去掉最高 平均 {statistics.mean(vals[:-1]):.1f}  中位 {statistics.median(vals[:-1]):.1f}")
```

<div class="line-notes">

- `vals = sorted(a for j in jobs if (a := annual_mid(j["salary"])) is not None)` 对每条岗位算年包,`:=` 一边赋值给 `a` 一边判断(Day 503 练习 1 讲过的海象运算符),None 的不要,最后排好序。22 条里剩 20 条。
- `statistics.mean(vals)` 平均数:全部加起来除以个数。同一行的 `statistics.median(vals)` 是中位数:排好序站在正中间的那个,偶数个就取中间两个的平均。
- `vals[:-1]` 去掉最后一个,也就是最高的那条。切片和 JS 的 `vals.slice(0, -1)` 一样。

</div>

```bash
uv run python -m part09.jobs.mean_vs_median
```

```text
从低到高: [9.6, 21.0, 24.0, 29.25, 42.0, 42.0, 44.0, 49.0, 51.0, 52.5, 53.2, 54.0, 56.0, 66.0, 80.0, 80.0, 82.5, 87.0, 88.0, 160.0]
20 条   平均 58.6  中位 52.9
去掉最高 平均 53.2  中位 52.5
```

最高那条是第 13 号,「90-110K·16薪」,10 年以上经验,年包中点 160 万。有它没它,中位数只动了 0.4 万,平均数动了 5.4 万。20 个人里只要有一个特别高的,平均数就被拉上去,而它不代表你。所以今天的数字一律报中位数,同时报 P25 和 P75 两个分位数,告诉你「中间那一半人」落在哪个范围。脉脉报的是平均数,这是它比今天的数高的原因之一。

前端对照:看页面性能你不会只看平均加载时间,一两个超时的请求能把平均数拉得很难看,所以看 P50、P75、P95。薪资是同一个道理,只是这次「拉高平均」的是少数特别高的岗位。

接着写正式的统计脚本,顺便按年限和城市分组:

```python
# agent-zero-lab/part09/jobs/salary_stats.py
import json
import statistics
import sys
from collections import defaultdict
from pathlib import Path

from part09.jobs.salary import annual_mid

EXP = ["在校/应届", "1-3年", "3-5年", "5-10年", "10年以上", "经验不限"]


def describe(vals: list[float]) -> str:
    if len(vals) < 4:
        return f"n={len(vals)},太少,只列原值 {sorted(vals)}"
    q1, mid, q3 = statistics.quantiles(vals, n=4)
    return f"n={len(vals):<4} 中位 {mid:5.1f}  P25 {q1:5.1f}  P75 {q3:5.1f}  平均 {statistics.mean(vals):5.1f}"


if __name__ == "__main__":
    jobs = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    vals, skipped = [], []
    by_exp: dict[str, list[float]] = defaultdict(list)
    by_city: dict[str, list[float]] = defaultdict(list)
    for j in jobs:
        a = annual_mid(j["salary"])
        if a is None:
            skipped.append(j["salary"])
            continue
        vals.append(a)
        by_exp[j["exp"] if j["exp"] in EXP else "其他"].append(a)
        by_city[j["city"]].append(a)
    print(f"共 {len(jobs)} 条,能折算 {len(vals)} 条,跳过 {len(skipped)} 条:{sorted(set(skipped))[:6]}")
    print(f"全部  {describe(vals)}  (单位:万元/年)")
    for k in [*EXP, "其他"]:
        if by_exp[k]:
            print(f"  {k:<8}{describe(by_exp[k])}")
    for city in ["北京", "上海", "深圳", "杭州"]:
        print(f"  {city:<8}{describe(by_city[city])}")
```

<div class="line-notes">

- `EXP = ["在校/应届", "1-3年", "3-5年", "5-10年", "10年以上", "经验不限"]` Boss 年限筛选项里的六档。猎聘的写法更散(「2年以上」「2-4年」),不在这六档里的归到「其他」。
- `def describe(vals: list[float]) -> str:` 把一组数描述成一行。分组以后有的组只有一两条,算分位数没有意义,所以少于 4 条只列原值。
- `q1, mid, q3 = statistics.quantiles(vals, n=4)` `n=4` 切成四等份,返回三个切分点:P25、P50(就是中位数)、P75。Day 145 用的是 `n=20` 取 P95,同一个函数。
- `jobs = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))` 数据文件从命令行传进来,同一个脚本可以跑样本,也可以跑全量。
- `by_exp: dict[str, list[float]] = defaultdict(list)` `defaultdict(list)`:访问一个不存在的键时,自动给它一个空列表,所以下面能直接 `.append`。相当于 JS 里先写 `(groups[k] ??= []).push(a)`。
- `skipped.append(j["salary"])` 折算不了的记下来,最后打印出来看一眼都是什么写法。悄悄丢掉的话,你不知道丢了多少、丢的是什么。
- `by_exp[j["exp"] if j["exp"] in EXP else "其他"].append(a)` 年限在六档里就用原值,否则归「其他」。
- `print(f"共 {len(jobs)} 条,能折算 {len(vals)} 条,跳过 {len(skipped)} 条:{sorted(set(skipped))[:6]}")` `set` 去重,`sorted` 排序,只看前 6 种写法。
- `for k in [*EXP, "其他"]:` 按固定顺序打印,`*EXP` 展开六档再接上「其他」。

</div>

先在样本上跑:

```bash
uv run python -m part09.jobs.salary_stats part09/jobs/salary_sample.json
```

```text
共 22 条,能折算 20 条,跳过 2 条:['150-200元/天', '面议']
全部  n=20   中位  52.9  P25  42.0  P75  80.0  平均  58.6  (单位:万元/年)
  3-5年    n=9    中位  52.5  P25  43.0  P75  73.0  平均  55.4
  5-10年   n=2,太少,只列原值 [51.0, 56.0]
  10年以上   n=1,太少,只列原值 [160.0]
  经验不限    n=5    中位  80.0  P25  31.8  P75  87.5  平均  63.7
  其他      n=3,太少,只列原值 [21.0, 24.0, 42.0]
  北京      n=5    中位  44.0  P25  33.0  P75  71.0  平均  50.4
  上海      n=8    中位  73.0  P25  49.5  P75  85.2  平均  72.8
  深圳      n=3,太少,只列原值 [21.0, 53.2, 82.5]
  杭州      n=4    中位  47.2  P25  32.4  P75  55.1  平均  44.9
```

22 条的样本,上海中位 73 万,这个数你千万别当真:8 条里有那条 160 万,还有几条 16 薪的高价岗,是抽样抽出来的偶然。样本太小的时候,分组越细越不可信。

同一个脚本,我在 575 条全量数据上跑的结果(原始数据没公开,你跑不了这一步,看结果就行):

```bash
uv run python -m part09.jobs.salary_stats part09/jobs/jobs_full.json
```

```text
共 575 条,能折算 557 条,跳过 18 条:['1000-2000元/天', '150-200元/天', '150-300元/天', '180-200元/天', '210-300元/天', '270-350元/天']
全部  n=557  中位  48.0  P25  35.7  P75  67.5  平均  54.9  (单位:万元/年)
  在校/应届   n=24   中位  45.0  P25  37.8  P75  53.6  平均  48.0
  1-3年    n=75   中位  39.0  P25  24.6  P75  56.0  平均  42.9
  3-5年    n=179  中位  48.0  P25  36.0  P75  67.5  平均  55.2
  5-10年   n=100  中位  54.0  P25  36.0  P75  71.9  平均  58.8
  10年以上   n=7    中位 160.0  P25  49.0  P75 240.0  平均 139.7
  经验不限    n=129  中位  52.5  P25  36.0  P75  77.5  平均  59.7
  其他      n=43   中位  39.0  P25  30.6  P75  54.0  平均  41.6
  北京      n=131  中位  47.2  P25  36.0  P75  61.8  平均  55.7
  上海      n=138  中位  54.0  P25  36.8  P75  75.0  平均  61.3
  深圳      n=150  中位  48.4  P25  35.9  P75  66.0  平均  53.7
  杭州      n=138  中位  42.0  P25  27.2  P75  66.4  平均  49.2
```

全量 557 条,**挂牌年包中位 48 万,中间一半落在 35.7 万到 67.5 万**。几个读法:

**每一组的平均数都比中位数高。** 全部是 54.9 对 48.0,「10 年以上」更是 139.7 对 160(只有 7 条,看个大概)。高薪岗位少而高,一直在往上拽平均数。

**年限之间的差距没你想的大,同一年限里的差距反而很大。** 1-3 年中位 39 万,5-10 年中位 54 万,只差 15 万;而 3-5 年这一档,P25 是 36、P75 是 67.5,中间一半人就差了 30 多万。同样的年限,作品和面试表现能拉开不少。

**「在校/应届」比「1-3 年」还高。** 不是应届生更值钱,是这 24 条几乎都是大厂校招岗,大厂整体开价高。分组看到反常的数,先想是不是组里的岗位构成不一样,这叫混杂,下面练习 2 按公司规模分组会看得更清楚。

**城市里上海最高,杭州最低。** 但四个城市的 P25 都在 27 到 37 万之间,城市之间的差别主要在高的那一端。

分平台看(另一段统计,结果直接贴):Boss 417 条中位 48.75 万(P25 34.4、P75 72.0),猎聘 140 条中位 42 万(P25 36、P75 54)。猎聘的范围窄得多。还有几个比例:年包中点 50 万以上的占 45%,80 万以上的占 15%,低于 30 万的占 18%;薪数最常见的是没写(按 12 薪算,46%),其次 15 薪(19%)、16 薪(14%)、14 薪(11%)。

## 第三步:找到你的那一格

总体中位 48 万,对你有什么用?几乎没用。你要的是**和你同一格**的数:同城市、同年限、同规模的公司。

举个例子。假设你是 1-3 年经验,想去杭州一家 50 人的公司。总体 48 万不能拿来对标:1-3 年这一档中位 39 万,杭州中位 42 万,20-99 人的公司中位 39 万(练习 2 会算出来),三格都低于总体;再考虑挂牌价通常高于成交价,一个现实的参考范围是 30 到 40 万,作品和面试表现好往上谈。

再说一层,对转方向的人更重要。今天这些都是 Agent 岗的挂牌价,而你的 AI 经验来自这门课的个人项目。现实的预期是先拿到「你原来的年限对应的那一档」,而不是直接对标 P75。比如你做了 4 年前端,就看 3-5 年那一格的中位附近,而不是 5-10 年。

格子越细,样本越少,数字越不稳。经验上,一格里少于 10 条就只看大概,少于 5 条就别算分位数了。今天全量数据里「10 年以上」只有 7 条,它的中位 160 万你可以知道,但别引用。

## 新加坡、香港和美国:有样本的和没样本的

海外的薪资今天只简单说一下,币种、税制和来源都不一样,**不要和国内的数直接比高低**,也不要换算成人民币放在一起排。

- **新加坡**:政府职位库 MyCareersFuture 上 29 条,每条都写了月薪,中位区间 SGD 7,500 到 10,000 一个月,范围 3,000 到 21,667。要注意这上面的雇主很多是中介和 IT 外包公司,头部公司高得多,比如 Shopee 两个 Agent 相关的 AI 工程师岗写的是月薪 SGD 10,000–16,000 和 10,000–17,000。外籍员工还要过 Employment Pass 的最低薪资和评分门槛,具体以新加坡人力部当年的规定为准。
- **香港**:LinkedIn 上 23 条,**没有一条写薪资**,这次没有数据。岗位集中在金融和加密货币公司以及咨询公司。
- **美国本土**:26 条写了薪资,年薪区间的中位是 $198K 到 $335K,范围 $150K 到 $445K,另有股权。这些岗位基本都要美国工作身份,对大多数读者的意义是「知道天花板在哪」。

海外远程岗的薪资和地域限制,明天单独讲。

## 动手练习

### 练习 1:认得更多写法

全量数据里有一条「5000-18000元/月」被跳过了。写 `annual_mid_v2`:先用原来的 `annual_mid`,认不出再试「N-N元/月」(按 12 个月折年包),「元/天」依旧返回 None。不改 `salary.py`,新写一个文件。在全量数据上跑,看能折算的条数变成多少,还剩哪些。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex511_yuan.py
import json
import re
import sys
from collections import Counter
from pathlib import Path

from part09.jobs.salary import annual_mid

YUAN = re.compile(r"^(\d+)-(\d+)元/(月|天)$")


def annual_mid_v2(s: str) -> float | None:
    a = annual_mid(s)
    if a is not None:
        return a
    m = YUAN.match(s.strip())
    if m is None or m.group(3) == "天":
        return None
    lo, hi = int(m.group(1)), int(m.group(2))
    return (lo + hi) / 2 * 12 / 10000


if __name__ == "__main__":
    for s in ["5000-18000元/月", "150-200元/天", "30-60K·16薪"]:
        print(f"{s:<14} → {annual_mid_v2(s)}")
    jobs = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    left = Counter(j["salary"] for j in jobs if annual_mid_v2(j["salary"]) is None)
    print(f"能折算 {len(jobs) - sum(left.values())} 条;还剩 {sum(left.values())} 条:", dict(left.most_common(3)), "…")
```

<div class="line-notes">

- `YUAN = re.compile(r"^(\d+)-(\d+)元/(月|天)$")` 第三个分组是月还是天。
- `a = annual_mid(s)` 先走老路。新规则只是补充,不改原来的函数,`salary_stats.py` 和别的地方照样用老的。
- `if m is None or m.group(3) == "天":` 日薪不折:实习和兼职的天数不固定,乘多少天都是瞎猜。
- `return (lo + hi) / 2 * 12 / 10000` 「5000-18000元/月」:(5000 + 18000) / 2 = 11500,乘 12 = 138000,即 13.8 万。
- `left = Counter(j["salary"] for j in jobs if annual_mid_v2(j["salary"]) is None)` `Counter` 数每种写法出现了几次,`most_common(3)` 取最多的三种。

</div>

```bash
uv run python -m part09.ex.ex511_yuan part09/jobs/jobs_full.json
```

```text
5000-18000元/月  → 13.8
150-200元/天     → None
30-60K·16薪     → 72.0
能折算 558 条;还剩 17 条: {'面议': 7, '150-200元/天': 1, '300-450元/天': 1} …
```

从 557 变成 558,剩下 17 条是 7 条面议和 10 条日薪。多认一种写法,中位数不会动(一条 13.8 万加进 557 条里),但你知道了数据里到底有什么。你自己收集岗位时,如果用的是智联,会遇到更多「万」和「元/月」,样本里第 22 条就是智联的写法。

</details>

### 练习 2:按公司规模分组

Boss 的岗位都带公司规模(0-20 人、20-99 人……10000 人以上)。复用 `annual_mid` 和 `describe`,只看 Boss 的岗位,按规模分组输出。先在样本上跑,再看我在全量上的结果,回答:「在校/应届比 1-3 年还高」这件事,和规模有什么关系?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex511_scale.py
import json
import sys
from collections import defaultdict
from pathlib import Path

from part09.jobs.salary import annual_mid
from part09.jobs.salary_stats import describe

ORDER = ["0-20人", "20-99人", "100-499人", "500-999人", "1000-9999人", "10000人以上"]

jobs = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
groups: dict[str, list[float]] = defaultdict(list)
for j in jobs:
    a = annual_mid(j["salary"])
    if a is not None and j["src"] == "boss" and j["scale"] in ORDER:
        groups[j["scale"]].append(a)
for k in ORDER:
    print(f"{k:<12}{describe(groups[k])}")
```

<div class="line-notes">

- `from part09.jobs.salary_stats import describe` 复用描述函数。`salary_stats.py` 的主程序在 `__main__` 保护下面,import 不会去读 `sys.argv[1]`。
- `ORDER = ["0-20人", "20-99人",` 规模从小到大的固定顺序。字典的键顺序是插入顺序,不按这个列表打印的话,哪个规模先出现就先打印哪个。
- `if a is not None and j["src"] == "boss" and j["scale"] in ORDER:` 只要 Boss 的,因为猎聘的规模分档不一样(样本第 6 条是「5000-10000人」),混在一起就是两种口径。

</div>

```bash
uv run python -m part09.ex.ex511_scale part09/jobs/salary_sample.json
```

```text
0-20人       n=1,太少,只列原值 [52.5]
20-99人      n=1,太少,只列原值 [53.2]
100-499人    n=3,太少,只列原值 [9.6, 80.0, 87.0]
500-999人    n=1,太少,只列原值 [80.0]
1000-9999人  n=5    中位  49.0  P25  35.6  P75  77.0  平均  54.9
10000人以上    n=3,太少,只列原值 [56.0, 82.5, 160.0]
```

样本太少,几乎每格都不够算。全量数据的结果:

```text
0-20人       n=34   中位  36.0  P25  22.8  P75  61.9  平均  43.6
20-99人      n=64   中位  39.0  P25  24.0  P75  60.0  平均  44.4
100-499人    n=93   中位  48.0  P25  33.0  P75  68.5  平均  55.8
500-999人    n=26   中位  49.3  P25  34.6  P75  64.1  平均  48.8
1000-9999人  n=88   中位  56.5  P25  42.0  P75  76.0  平均  62.5
10000人以上    n=112  中位  57.0  P25  37.1  P75  80.0  平均  64.8
```

规模越大中位越高,20 人以下 36 万,万人以上 57 万,差 21 万,比年限之间的差距还大。「在校/应届」那 24 条几乎都是大厂校招岗,所以它们的中位(45 万)反映的主要是「大厂」这个因素,不是「应届」这个因素。两个因素搅在一起,单看年限分组就会得出「应届比 1-3 年值钱」的错误结论。这就是混杂:**分组比较之前,先看两组的构成是不是差不多**。

</details>

### 练习 3:你的投递清单

按你自己的条件筛一份投递清单:城市、能接受的年限要求、年包中点的底线。面议的岗位不排除(没写不代表低),但要排在后面。按年包中点从高到低排,写成 `part09/jobs/apply_list.csv`,能用 Excel 或 Numbers 直接打开,多两列「投递日期」「状态」留着以后填。

<details><summary>参考答案</summary>

CSV 是「逗号分隔的表格」文本,一行一条记录,第一行是列名,Excel 和 Numbers 都能直接打开。Python 标准库的 `csv` 模块负责处理引号和逗号这些细节,不用装。

```python
# agent-zero-lab/part09/ex/ex511_apply.py
import csv
import json
from pathlib import Path

from part09.jobs.salary import annual_mid

MY_CITIES = {"北京", "杭州"}
MY_EXP = {"1-3年", "3-5年", "经验不限", "2年以上", "2-4年", ""}
FLOOR = 30.0
OUT = Path("part09/jobs/apply_list.csv")

jobs = json.loads(Path("part09/jobs/salary_sample.json").read_text(encoding="utf-8"))
rows = []
for j in jobs:
    a = annual_mid(j["salary"])
    if j["city"] not in MY_CITIES or j["exp"] not in MY_EXP:
        continue
    if a is not None and a < FLOOR:
        continue
    rows.append({"编号": j["id"], "渠道": j["src"], "城市": j["city"], "岗位": j["title"], "挂牌": j["salary"],
                 "年包中点": "" if a is None else a, "投递日期": "", "状态": "待看 JD"})
rows.sort(key=lambda r: r["年包中点"] if r["年包中点"] != "" else -1, reverse=True)
with OUT.open("w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]))
    w.writeheader()
    w.writerows(rows)
print(f"{len(jobs)} 条里留下 {len(rows)} 条,写进 {OUT}")
print(OUT.read_text(encoding="utf-8-sig"))
```

<div class="line-notes">

- `MY_CITIES = {"北京", "杭州"}` 你的条件写成常量放在最上面,换条件只改这几行。
- `MY_EXP = {"1-3年", "3-5年", "经验不限", "2年以上", "2-4年", ""}` 能接受的年限要求。空字符串表示 JD 没写,先留着。假设你有 3 年左右经验:5-10 年的岗位不是不能投,但先排除,Day 500 的 `gate` 讲过怎么判断。
- `FLOOR = 30.0` 你的底线,年包中点低于 30 万的不看。
- `if a is not None and a < FLOOR:` 有薪资且低于底线才排除。面议的 `a` 是 None,留下来。
- `"年包中点": "" if a is None else a,` 面议的写成空,表格里就是空格子。
- `rows.sort(key=lambda r: r["年包中点"] if r["年包中点"] != "" else -1, reverse=True)` 按年包从高到低。空字符串没法和数字比大小,排序时当成 -1,面议的就排到最后。
- `with OUT.open("w", encoding="utf-8-sig", newline="") as f:` 两个细节:`utf-8-sig` 在文件开头加一个标记(BOM),Excel 靠它认出这是 UTF-8,不加的话 Windows 上的 Excel 打开中文是乱码;`newline=""` 是 `csv` 模块文档要求的写法,不加的话在 Windows 上每行之间会多一个空行。
- `w = csv.DictWriter(f, fieldnames=list(rows[0]))` 按字典写 CSV,列名取第一条记录的键。`list(字典)` 得到键的列表,顺序就是写字典时的顺序。
- `w.writeheader()` 先写列名那一行,再 `writerows` 写全部记录。

</div>

```bash
uv run python -m part09.ex.ex511_apply
```

```text
22 条里留下 6 条,写进 part09/jobs/apply_list.csv
编号,渠道,城市,岗位,挂牌,年包中点,投递日期,状态
10,boss,北京,大模型应用开发工程师,40-70K·16薪,88.0,,待看 JD
15,liepin,北京,Agent研发工程师,30-60k,54.0,,待看 JD
12,boss,杭州,AI Agent开发工程师,25-50K·14薪,52.5,,待看 JD
6,liepin,北京,AI 智能体工程师,25-30k·16薪,44.0,,待看 JD
2,boss,北京,大模型应用开发工程师,30-40K,42.0,,待看 JD
7,liepin,杭州,AI Agent 开发工程师,25-45k,42.0,,待看 JD
```

面议的第 3 条是校招岗,年限不符被筛掉了;第 22 条智联那条年包 24 万低于底线,也被筛掉了,所以这次没有面议的出现在最后。

这份清单只是起点。排第一的 88 万那条,你要回去读 JD 原文,用 Day 498 的关键词表对一遍,用 Day 500 的 `gate` 看门槛,再决定它属于「很想去」还是「练手」。真实使用时,你把自己在 Boss 和猎聘上收藏的岗位按 `salary_sample.json` 的格式记下来,跑同一个脚本就行。

</details>

**验收标准**

- `salary.py` 对样本里的 22 条全部不崩,面议和日薪返回 None。
- 你自己收集了至少 15 条和你城市、年限匹配的真实岗位(手动记,别用脚本抓),用 `salary_stats.py` 算出了你的那一格的中位数和 P25–P75,写下了底线和目标。
- 能说出今天的 48 万和脉脉的 6 万月薪口径差在哪几处。
- `apply_list.csv` 已经建好,第一批岗位在里面。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 口径 | 一个数字是怎么算出来的:数据来源、包括哪些、用的什么统计量。口径不同的数不能直接比 |
| 挂牌价 | 招聘方在 JD 上写的薪资区间,不是候选人最后拿到的成交价 |
| 年包 | 一年的总收入,这里按「月薪 × 薪数」算,没算年终奖和股票 |
| 薪数 | 一年发几个月工资,「16薪」就是 16 个月,多出来的通常是年终 |
| 中位数 | 排好序站在正中间的那个数,不受极端值影响 |
| 平均数 | 全部加起来除以个数,会被少数特别高的值拉高 |
| P25 / P75 | 25% 分位和 75% 分位,中间一半的数落在这两者之间 |
| 分组 | 按城市、年限、规模把样本拆开分别统计,找和你同一格的数 |
| 混杂 | 两个因素搅在一起,把一个因素的作用错当成另一个的(应届岗高其实是大厂岗高) |
| 样本偏差 | 样本不是随机抽的,比如只抓了第一页、只有写了薪资的岗位 |
| ATS | Applicant Tracking System,招聘管理系统;海外公司常用 Ashby、Greenhouse、Lever,职位列表常有公开接口 |
| MyCareersFuture | 新加坡政府的职位库,要求写月薪 |
| `defaultdict` | 访问不存在的键时自动建默认值的字典,分组时省掉「先判断有没有」 |
| CSV | 逗号分隔的表格文本,Excel 能直接打开 |

## 常见误区

**拿网上的「平均薪资」当目标。** 先问口径。脉脉的 AI 岗平均月薪 60738 元和今天 Agent 岗月薪中点的中位数 3.5 万差了将近一倍:一个包括算法研究岗、一个只有应用岗;一个是平均数、一个是中位数;平台和时间也不一样。

**拿总体中位数去谈薪。** 48 万混合了所有城市、年限、规模。1-3 年、杭州、几十人的公司,三格都在 40 万上下。找和你同一格的数。

**把挂牌区间的上沿当成预期。** 「30-60K」不代表你能拿 60K。大多数人落在区间中下段,所以今天用中点,而且中点本身也偏乐观。

**只比月薪。** 「40-60K」和「35-45K·16薪」,后者月薪低,年包中点反而更高(64 万对 60 万)。薪数、年终、股票、公积金都要算进去,谈 offer 时更是这样,后天会细讲。

**分组越细越准。** 格子越细样本越少。样本里上海中位 73 万,是 8 条里碰上了几条高价岗;全量里是 54 万。一格少于 10 条只看大概。

**写脚本批量抓招聘网站。** Boss 连续打开七十多个详情页就提示账号异常。你求职用的就是这个账号,被限制了得不偿失。手动收藏、手动记,一周几十条完全够。

**脚本里悄悄丢掉解析不了的数据。** `salary_stats.py` 把跳过的写法打印出来,才发现有日薪和元/月。悄悄丢掉,你永远不知道样本里少了什么。

## 学习资料

### 文档与文章

- [每日经济新闻 · 脉脉 2026 年前两月 AI 人才报道](https://www.nbd.com.cn/articles/2026-03-09/4285378.html):「平均月薪 60738 元」的出处。读的时候带着今天的四个问题:哪来的、挂牌还是成交、平均还是中位、包括哪些。10 分钟。
- [Python 文档 · statistics](https://docs.python.org/zh-cn/3.12/library/statistics.html):中文,`mean`、`median`、`quantiles` 都在这一页,`quantiles` 的 `method` 参数说明了分位数的两种算法。
- [Python 文档 · csv](https://docs.python.org/zh-cn/3.12/library/csv.html):`DictWriter` 和为什么要 `newline=""`,15 分钟。
- [新加坡人力部 · Employment Pass](https://www.mom.gov.sg/passes-and-permits/employment-pass):打算去新加坡的话,先看外籍专业人士工作签证的门槛。
- 渠道入口:[Boss 直聘](https://www.zhipin.com/)、[猎聘](https://www.liepin.com/)、[智联招聘](https://www.zhaopin.com/)、[脉脉](https://maimai.cn/)、[V2EX 招聘节点](https://www.v2ex.com/go/jobs)、[电鸭](https://eleduck.com/)、[LinkedIn Jobs](https://www.linkedin.com/jobs/)、[MyCareersFuture](https://www.mycareersfuture.gov.sg/)、[Hacker News Who is hiring 历史帖](https://news.ycombinator.com/submitted?id=whoishiring)、[Levels.fyi](https://www.levels.fyi/)(海外公司按职级的薪资数据,以用户自报为主)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Bj411K7PX&autoplay=0&high_quality=1" title="招聘网站上的薪资范围能信吗？HR实话告诉你" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>万万万森说 · 招聘网站上的薪资范围能信吗?HR实话告诉你 · 不到 2 分钟,从 HR 的角度讲挂牌区间是怎么定的、上沿给谁。听完再看今天「挂牌价不是成交价」那一条。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19M411k7Am&autoplay=0&high_quality=1" title="想了解行业岗位薪资，推荐3个小工具" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大鱼Leo · 想了解行业岗位薪资,推荐3个小工具 · 半分钟的短视频,2022 年的,工具可能有变化。当成「还有哪些地方能查到薪资」的线索,每个工具拿来用之前同样问四个口径问题。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/fyn0CKPuPlA" title="How to Negotiate Your Tech Salary Simulation ft. Levels.fyi" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Aced (formerly Exponent) · How to Negotiate Your Tech Salary Simulation ft. Levels.fyi · 英文,和 Levels.fyi 的人一起做的谈薪模拟。今天先看他们怎么用薪资数据给自己定位(哪个公司、哪个职级、哪个城市),谈薪的部分后天再回来看。</figcaption>
</figure>

### 书籍

- Darrell Huff《How to Lie with Statistics》(W. W. Norton,1954):很薄的一本老书,讲平均数、样本偏差、图表怎么误导人。「平均数」和「样本偏差」那两章正好对应今天的两个坑,一个晚上能读完。
- Gergely Orosz《The Tech Resume Inside Out》(自出版,2020):简历课的参考书,讲招聘流程的部分能帮你理解招聘方在每个渠道、每个环节看什么。

### 开源项目与代码

今天这组不需要。如果你想长期跟踪岗位,明天会讲怎么调海外公司 ATS 的公开职位接口;需要登录或有人机验证的平台,不要去绕。

## 自测

1. 「40-60K」和「35-45K·16薪」,按今天的口径哪个年包中点高?各是多少?

<details><summary>答案</summary>

后者。「40-60K」中点 5 万 × 12 = 60 万;「35-45K·16薪」中点 4 万 × 16 = 64 万。月薪低的那个年包反而高,所以只比月薪会看错。

</details>

2. 样本 20 条里加上那条 160 万的岗位,平均数和中位数各变了多少?说明了什么?

<details><summary>答案</summary>

平均数从 53.2 万变成 58.6 万,涨了 5.4 万;中位数从 52.5 万变成 52.9 万,只动了 0.4 万。一个极端值就能把平均数拉高很多,中位数基本不受影响。所以薪资这种少数特别高的数据要报中位数和分位数。

</details>

3. 全量数据里「在校/应届」中位 45 万,比「1-3 年」的 39 万还高。能得出「应届生比 1-3 年的人值钱」吗?

<details><summary>答案</summary>

不能。这 24 条几乎都是大厂校招岗,而按规模分组,万人以上公司中位 57 万、20 人以下 36 万。「应届」这一组高,主要是「大厂」这个因素带来的。两个因素混在一起叫混杂,比较之前要先看两组的构成。

</details>

4. 今天的数据有哪些样本偏差?各会把数字往哪个方向带?

<details><summary>答案</summary>

只抓了每个搜索的第一页,排序受平台推荐和账号画像影响,方向说不准;只统计写了薪资的岗位,面议的没算,如果高端岗更爱写面议,数字偏低;挂牌价本身高于成交价,数字偏高;只有北上深杭四个城市,其他城市一般更低,数字偏高。所以把今天的数当成「一线城市挂牌价的大致范围」,不是你会拿到的数。

</details>

5. (面试题)HR 问:「你的期望薪资是多少?依据是什么?」用今天的方法答依据部分。

<details><summary>答案</summary>

依据要具体到「和我同一格」:我看了这个城市、这个年限、同等规模公司的同类岗位,收集了二十几条写了薪资的,挂牌年包的中位在多少、中间一半在什么范围;再结合我现在的薪资结构(月数、年终、公积金)和这个岗位要求与我作品的匹配程度,报一个区间,下沿是我的目标而不是底线。不要说「网上说 AI 岗平均月薪 6 万」,HR 一问口径就接不住。期望薪资怎么报、怎么谈,后天细讲。

</details>

## 明天预告

Day 512 · 求职(二):海外远程和 FDE 岗。很多人学 Agent 是冲着「给海外公司远程工作、拿美元」去的。明天先看数据:几十条「远程」岗里,真正对中国境内开放的有几条,其余的限在哪里;再讲一类越来越多的 Agent 岗 Forward Deployed Engineer,它和普通 Agent 工程师差在哪、适合什么样的人。还会真的调一次海外公司招聘系统的公开接口,自己数一数今天在招的 FDE 岗。
