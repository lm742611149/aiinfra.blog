---
title: 'Day 512 · 求职(二):海外远程和 FDE 岗'
description: '「给海外公司远程干活、拿美元」现实里有多少机会?先看两次调研:46 条远程岗里写明全球可做的 3 条,88 条里 5 条。再自己调一次海外公司招聘系统的公开接口,把今天在招的 FDE 类岗位抓下来,用规则判断「标了远程」的到底能不能从中国投:104 条里只剩 1 条。后半讲 Forward Deployed Engineer:它和普通 Agent 工程师差在哪,多八成面向客户、四成多要出差,适合什么样的人。'
pubDate: 2026-10-23
regime: none
tags: ['job-search', 'remote', 'fde', 'httpx', 'agent-zero']
series: 'agent-zero'
day: 512
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 511](/blog/agent-zero/day-511-job-channels/) 讲了国内找工作的渠道和薪资:写了 `annual_mid` 把「30-60K·16薪」折成年包,在 557 条 Boss 和猎聘的样本上算出挂牌年包中位 48 万,再按年限、城市、公司规模拆开,讲清楚口径:挂牌不是成交,平均不是中位,要找和你同一格的数。

昨天最后留了海外远程没讲。很多人学 Agent 就是冲着「给海外公司远程工作、拿美元」去的,这个方向的营销内容又特别多,值得单独一天用数据过一遍。同一天讲 FDE,是因为海外 Agent 岗里有一半是这一类,而远程岗里它的比例更高。

## 今天要解决的问题

今天结束时你应该能:

1. 说出海外「远程」岗的几种限制(只限美国、只限欧洲、限某一个国家、全球),以及为什么人在中国境内能投的极少;知道 EOR 和 contractor 是什么。
2. 用 `httpx` 调 Ashby 的公开职位接口,抓下几家 AI 公司今天在招的 FDE 类岗位,用规则判断每条的远程范围,并说出规则会在哪里判错。
3. 讲清 FDE(Forward Deployed Engineer)是什么、和普通 Agent 工程师的要求差在哪,判断自己适不适合。

预计用时 2.5 小时。前置:[Day 511](/blog/agent-zero/day-511-job-channels/) 的口径;[Day 64](/blog/agent-zero/day-064-httpx-1/) 和 [Day 65](/blog/agent-zero/day-065-httpx-2/) 学的 `httpx`(发请求、超时、`raise_for_status`);[Day 498](/blog/agent-zero/day-498-resume-1/) 的正则环视和误伤。今天不调模型,只调几个公开的招聘接口,花费 ¥0。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `classify`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 海外远程:先看数字

站长做过两次调研,口径不同,结论一样。

**第一次,2026 年 10 月 12 日**,在 880 条 Agent 岗里,海外远程 46 条:限美国、加拿大或美洲的 18 条,限欧洲或英国时区的 6 条,限印度、巴西、沙特、韩国等某一个国家的 8 条,没写清的 11 条,**明确写「全球任意地点」的只有 3 条**。写了薪资的 8 条远程岗,年薪区间中位 $180K–$250K,基本都在限美加的那一类里。

**第二次,10 月 15 日**,专门找 FDE 和相近岗位(Solutions Engineer、Applied AI Engineer),从 LinkedIn、Ashby、Greenhouse、Lever、Hacker News 等地方筛出 88 条能远程的:只限美国 36 条,只限欧洲或英国 16 条,亚太 14 条(大多数锁死在印度、新加坡、韩国、澳洲中的一个),美洲 11 条,中东等其他组合 4 条,没写清 2 条,**写明全球都能做的 5 条**。对中国境内来说,只有这 5 条全球岗「字面上没拦」,而且 88 条里**没有一条**提到 EOR、Deel、contractor 这类全球雇佣方式。标了美元年薪的 26 条,区间中点的中位数是 $218,750,其中 19 条只限美国,所以这其实是美国远程价。

还有一个细节:Palantir 是 FDE 这个名字的发源地,它在 Lever 上挂了 77 个 FDE 类岗位,**一条远程都没有**。

换句话说,面向中国境内求职者的海外远程 Agent 岗**非常少**。原因不是你技术不够,是雇佣合规:跨国雇一个人,公司要处理对方所在国的劳动法、社保、个税、数据出境,大多数公司不愿意为一个人去做这些。所以「Remote」后面几乎总跟着一个国家或地区名,意思是「在这个国家境内,你可以不来办公室」。

前端对照一下就好理解:一个网站写「支持全国配送」,不代表它能寄到国外。海外 JD 的「Remote」就是「支持本国范围内远程」,跨国是另一回事。

### 能走的几条路

- **EOR(名义雇主)**:Deel、Remote.com 这类平台在你所在国有法律实体,由它在法律上雇你,再把你「借」给海外公司干活。前提是海外公司愿意走这条路、愿意付平台的费用。薪资一般会按你所在地重新定价,远低于美国本土那些数字。
- **contractor(独立承包人)**:你不是员工,按合同交付工作,对方按月付款,税务和收款合规你自己处理,没有社保和劳动法保护。
- **先进外企或出海公司**:在国内的外企或出海公司做一两年,积累英文工作环境和跨时区协作经验,再找内部转远程或外派的机会。
- **去新加坡或香港**:签证路径相对清楚,Day 511 讲过新加坡的 Employment Pass 门槛。

我不劝你放弃远程,但别把它当成近期的主要目标。把它当长期选项,同时认真投国内和新加坡的岗位。遇到「远程、全球、高薪、门槛低」四个词同时出现的岗位,先往骗局的方向怀疑,后天讲避坑时细说。

## 第一步:调一次公开的职位接口

数字是站长调研的,今天你自己验一遍。不用登录、不用爬网页:很多海外公司的招聘页面挂在 Ashby、Greenhouse、Lever 这几家招聘系统(ATS)上,它们都提供**公开的职位列表接口**,本来就是给公司在自己官网上展示职位用的,返回 JSON,和你前端调任何一个 REST 接口一样。

Ashby 的接口长这样:`https://api.ashbyhq.com/posting-api/job-board/{公司名}`,加上 `includeCompensation=true` 会带薪资。你可以先在浏览器地址栏里打开 `https://api.ashbyhq.com/posting-api/job-board/langchain` 看一眼,它就是一大段 JSON,`jobs` 数组里每个元素是一个职位。

几条规矩先说清楚:只调这种公开、给官网展示用的接口;一家公司调一次,不要循环狂刷;需要登录或有人机验证的网站(LinkedIn、Boss)不要用脚本去碰。今天总共不到 20 次请求。

```bash
cd agent-zero-lab
uv add httpx
```

`httpx` 是 Day 64 装过的,已经装了的话这一行不会有变化。

```python
# agent-zero-lab/part09/jobs/ashby.py
import json
import re
from datetime import date
from pathlib import Path

import httpx

API = "https://api.ashbyhq.com/posting-api/job-board/{}?includeCompensation=true"
COMPANIES = ["openai", "cohere", "elevenlabs", "langchain", "decagon", "sierra", "cognition", "livekit"]
FDE = re.compile(r"forward deployed|deployment engineer|deployed engineer|solutions engineer|applied ai engineer", re.I)
OUT = Path("part09/jobs/fde_today.json")


def fetch(client: httpx.Client, company: str) -> list[dict]:
    r = client.get(API.format(company))
    r.raise_for_status()
    return r.json()["jobs"]


if __name__ == "__main__":
    kept = []
    with httpx.Client(timeout=30) as client:
        for c in COMPANIES:
            jobs = fetch(client, c)
            fde = [j for j in jobs if FDE.search(j["title"])]
            remote = [j for j in fde if j.get("isRemote") or j.get("workplaceType") == "Remote"]
            print(f"{c:<11} 全部 {len(jobs):>4}  FDE 类 {len(fde):>3}  标了远程 {len(remote):>2}")
            for j in remote:
                kept.append({"company": c, "title": j["title"], "location": j["location"],
                             "secondary": [s["location"] for s in j.get("secondaryLocations") or []],
                             "comp": (j.get("compensation") or {}).get("compensationTierSummary") or "",
                             "url": j["jobUrl"], "text": (j.get("descriptionPlain") or "")[:6000]})
    OUT.write_text(json.dumps(kept, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{date.today()} 一共留下 {len(kept)} 条标了远程的 FDE 类岗位 → {OUT}")
```

<div class="line-notes">

- `API = "https://api.ashbyhq.com/posting-api/job-board/{}?includeCompensation=true"` `{}` 是占位符,下面用 `.format(公司名)` 填进去,相当于 JS 的模板字符串 `` `.../job-board/${company}?...` ``。
- `COMPANIES = ["openai", "cohere", "elevenlabs",` 八家用 Ashby 的 AI 公司,名字就是它们招聘页地址里的那一段。挑的都是在招 Agent 落地岗的公司,不是全市场抽样。
- `FDE = re.compile(r"forward deployed|deployment engineer|` 按职位名筛 FDE 和相近的岗位。`re.I` 忽略大小写,`Forward Deployed` 和 `forward deployed` 都算。
- `def fetch(client: httpx.Client, company: str) -> list[dict]:` 一家公司一次请求,返回职位列表。
- `r.raise_for_status()` 状态码是 4xx、5xx 就抛异常。公司名写错时 Ashby 返回 404,这一行会让你马上知道,而不是拿到一个空列表还以为人家没在招。相当于 `fetch` 之后检查 `res.ok`。
- `return r.json()["jobs"]` 接口返回的 JSON 里,职位在 `jobs` 这个键下面。
- `with httpx.Client(timeout=30) as client:` 一个客户端复用连接发完 8 次请求,每次最多等 30 秒。
- `remote = [j for j in fde if j.get("isRemote") or j.get("workplaceType") == "Remote"]` Ashby 的职位有两个和远程有关的字段:`isRemote` 是真假,`workplaceType` 是 Remote、Hybrid、OnSite 之一。任意一个说远程就先留下。`.get` 在键不存在时返回 None,不会报错。
- `"secondary": [s["location"] for s in j.get("secondaryLocations") or []],` 有些职位挂了好几个地点,主地点之外的在 `secondaryLocations` 里,判断范围时要一起看。
- `"comp": (j.get("compensation") or {}).get("compensationTierSummary") or "",` 薪资摘要,形如「$180K – $225K • Offers Equity」。没写薪资时 `compensation` 可能不存在,`or {}` 先换成空字典再 `.get`,和 JS 的 `j.compensation?.compensationTierSummary ?? ""` 一个意思。
- `"text": (j.get("descriptionPlain") or "")[:6000]})` JD 正文的纯文本版,只留前 6000 个字符,够判断办公方式了。
- `OUT.write_text(json.dumps(kept, ensure_ascii=False, indent=1), encoding="utf-8")` 存下来,后面的分析只读这个文件,不用每次都重新请求。

</div>

```bash
uv run python -m part09.jobs.ashby
```

```text
openai      全部  808  FDE 类  76  标了远程 64
cohere      全部  113  FDE 类   9  标了远程  9
elevenlabs  全部  159  FDE 类   9  标了远程  8
langchain   全部  104  FDE 类  18  标了远程 10
decagon     全部  135  FDE 类  21  标了远程  2
sierra      全部  191  FDE 类   0  标了远程  0
cognition   全部  105  FDE 类  18  标了远程  7
livekit     全部   26  FDE 类   4  标了远程  4
2026-10-23 一共留下 104 条标了远程的 FDE 类岗位 → part09/jobs/fde_today.json
```

这是 2026 年 10 月 23 日的结果,你跑的那天数字会不一样,职位每天都在变。

先看一眼就有两个疑点。OpenAI 76 个 FDE 类岗位里 64 个「标了远程」?OpenAI 的 FDE 岗出了名地要求坐班。Sierra 全部 191 个岗位,FDE 类是 0?Sierra 是做客服 Agent 的公司,不可能没有落地岗,只是它们叫别的名字(比如 Agent Engineer、Agent Development),我们的标题正则没覆盖到。**接口的字段和你的规则,都要先怀疑一遍**。

## 第二步:「标了远程」到底能不能远程

### 第一版:找 global 这个词

最直接的想法:正文里有「global」就算全球可做。

```python
# agent-zero-lab/part09/jobs/remote_scope.py  (第一版)
import json
from collections import Counter
from pathlib import Path

jobs = json.loads(Path("part09/jobs/fde_today.json").read_text(encoding="utf-8"))
scope = Counter("global" if "global" in j["text"].lower() else "限地区" for j in jobs)
print(scope)
```

<div class="line-notes">

- `scope = Counter("global" if "global" in j["text"].lower() else "限地区" for j in jobs)` 每条岗位贴一个标签,`Counter` 数每种标签有几条。`.lower()` 转小写再查,`Global` 也算。

</div>

```bash
uv run python -m part09.jobs.remote_scope
```

```text
Counter({'global': 57, '限地区': 47})
```

104 条里 57 条「全球可做」?太好了,好得不像真的。把这些「global」前后的文字打出来看(查看用的几行代码很简单,不贴了):

```text
cohere   | We are a global technology company headquartered in Toronto with key office…
elevenlabs | - Global team: We prioritize your talent, not your location.
cognition | you agree to our Global Applicant and Job Candidate Privacy Notice…
cognition | enable services partners such as Global Systems Integrators to…
```

「我们是一家全球化的公司」「全球团队」「全球求职者隐私声明」「全球系统集成商」,没有一句在说「这个岗位可以在全球任何地方做」。这和 [Day 498](/blog/agent-zero/day-498-resume-1/) 的子串误伤是同一个坑:`function` 命中 `cross-functional`,`global` 命中「global technology company」。英文 JD 开头常有一大段公司介绍,公司介绍里的词会污染你的匹配。

真正说「全球可做」的句子长什么样?今天的 104 条里只找到一句:ElevenLabs 的「This role is remote, so it can be executed globally.」。所以规则要匹配**整句的说法**,不能匹配单个词。

### 第二版:先排除坐班,再看地点

另一个疑点是 OpenAI 那 64 条。打开其中一条的正文:

```text
This role is based in New York City We use a hybrid work model of 3 days in the office per week and offer relocation assistance to new employees. This role also will require travel up to 25%.
```

「混合办公,一周三天在办公室」,接口里 `isRemote` 却是 true。结构化字段和正文对不上的时候,**以正文为准**:字段是招聘人员在后台勾的,可能勾错,可能是「这个团队部分人远程」,正文才是写给候选人的。

所以第二版分三步:去掉经理、总监这类管理岗;正文写了坐班或混合办公的,不算远程;剩下的按地点归类。我第一次写的「坐班」正则是这样的:

```python
OFFICE = re.compile(r"hybrid|days (a|per) week in|in[- ]office|in the office|on[- ]?site", re.I)
```

跑出来「正文写了坐班或混合办公 76 条,真远程 17 条」,又太狠了。打出匹配到的上下文:

```text
cohere     | experience deploying enterprise software in private/hybrid cloud environments
cohere     | Travel up to 20–40% to work on-site with customers and partners
elevenlabs | Expect regular travel for customer onsites.
langchain  | flexible vacation, a 401(k) plan, meals on in-office days in the US and more.
```

「混合云」「去客户现场」「在办公室那几天管饭」,都不是在说你要坐班。尤其是第二、三条:FDE 的正文里「on-site」大多是**去客户那里**,恰恰是这个岗位的特点,不是办公方式。这一版把很多真远程的岗位误杀了。

改成只匹配明确的说法:「hybrid work / hybrid model」「一周几天」「我们是坐班公司」「这个岗位在我们某某办公室」。地点那边,每个地区一串关键词,命中一个地区就是那个地区,命中多个算「多地区」,一个都不中算「没写清」。中途我又补了两处:爱尔兰一开始漏在欧洲的词表外,一条 LiveKit 的岗位被判成「没写清」;OpenAI 有几条写的是「This role is based in our San Francisco HQ」,一开始没被算作坐班。最后的版本:

```python
# agent-zero-lab/part09/jobs/remote_scope.py
import json
import re
from collections import Counter
from pathlib import Path

SKIP_TITLE = re.compile(r"manager|director|head of|lead\b|intern", re.I)
OFFICE = re.compile(r"hybrid (work|model|in[- ]office)|days (a|per) week|in[- ]office (company|role)|based in our [^.]*(hq|office)", re.I)
GLOBAL = re.compile(r"executed globally|work from anywhere|anywhere in the world|location[- ]agnostic", re.I)
REGIONS = {
    "us": r"san francisco|new york|nyc|washington|seattle|chicago|charlotte|raleigh|atlanta|united states|\bus\b",
    "eu_uk": r"london|united kingdom|munich|paris|madrid|zurich|sweden|europe|germany|france|spain|dublin|ireland",
    "americas": r"mexico|colombia|são paulo|ottawa|toronto|canada|brazil|argentina",
    "apac": r"singapore|tokyo|sydney|seoul|korea|india|japan|australia",
    "other": r"middle east|abu dhabi|uae",
}


def classify(job: dict) -> str:
    if GLOBAL.search(job["text"]):
        return "global"
    places = " ".join([job["location"], *job["secondary"]]).lower()
    hits = [name for name, pat in REGIONS.items() if re.search(pat, places)]
    return hits[0] if len(hits) == 1 else ("multi" if hits else "unclear")


def open_to_cn(scope: str) -> str:
    return {"global": "字面没拦", "unclear": "要问"}.get(scope, "不行")


if __name__ == "__main__":
    jobs = json.loads(Path("part09/jobs/fde_today.json").read_text(encoding="utf-8"))
    jobs = [j for j in jobs if not SKIP_TITLE.search(j["title"])]
    office = [j for j in jobs if OFFICE.search(j["text"])]
    real = [j for j in jobs if not OFFICE.search(j["text"])]
    print(f"去掉管理岗剩 {len(jobs)} 条;正文写了坐班或混合办公 {len(office)} 条,真远程 {len(real)} 条")
    scopes = Counter(classify(j) for j in real)
    print("远程范围:", dict(scopes.most_common()))
    print("对中国境内:", dict(Counter(open_to_cn(classify(j)) for j in real)))
    for j in real:
        if classify(j) in ("global", "unclear"):
            print(f"  [{classify(j)}] {j['company']} · {j['title']} · {j['location']} · {j['comp'] or '没写薪资'}")
```

<div class="line-notes">

- `SKIP_TITLE = re.compile(r"manager|director|head of|lead\b|intern", re.I)` 管理岗和实习不在今天的范围里。`lead\b` 要求 lead 后面是词边界,所以「Team Lead」会被排除,含 `leading` 的职位名不会被误伤。英文里 `\b` 是好用的,Day 498 那个坑只发生在汉字旁边。
- `OFFICE = re.compile(r"hybrid (work|model|in[- ]office)|days (a|per) week|in[- ]office (company|role)|based in our [^.]*(hq|office)", re.I)` 只认明确说「你要来办公室」的几种说法。`[^.]*` 是「同一句话里任意不是句号的字符」,让「based in our」和「HQ/office」必须在同一句里。
- `GLOBAL = re.compile(r"executed globally|work from anywhere|anywhere in the world|location[- ]agnostic", re.I)` 只认整句说法,单个 global 不算。
- `REGIONS = {` 每个地区一串关键词,用 `|` 连起来就是「任意一个」。只覆盖了今天数据里出现的地名,换一批公司要补。
- `"us": r"san francisco|new york|nyc|washington|` 最后的 `\bus\b` 要带边界,不然会命中 `focus`、`campus` 这些词里的 us。
- `if GLOBAL.search(job["text"]):` 正文明说全球可做,优先级最高,地点写的是哪儿都不管。ElevenLabs 那条地点写的是 Mexico,正文说可以全球做。
- `places = " ".join([job["location"], *job["secondary"]]).lower()` 主地点和其他地点拼成一个字符串再匹配。`*job["secondary"]` 把列表展开,相当于 JS 的 `[loc, ...secondary].join(" ")`。
- `hits = [name for name, pat in REGIONS.items() if re.search(pat, places)]` 命中了哪几个地区。
- `return hits[0] if len(hits) == 1 else ("multi" if hits else "unclear")` 正好一个地区就是它;多个是 multi,比如同时挂了美国和加拿大的;一个都没有是 unclear,比如地点只写了「Remote」。
- `return {"global": "字面没拦", "unclear": "要问"}.get(scope, "不行")` 对中国境内能不能投:全球岗只是「字面没拦」,公司在中国能不能雇人要问;没写清的要问;其余一律不行。字典 `.get(键, 默认值)` 当一个小查找表用,相当于 JS 的 `map[scope] ?? "不行"`。
- `real = [j for j in jobs if not OFFICE.search(j["text"])]` 正文没提坐班的才算真远程。注意这是「没提」,不是「确认能远程」,下面会说。

</div>

```bash
uv run python -m part09.jobs.remote_scope
```

```text
去掉管理岗剩 93 条;正文写了坐班或混合办公 50 条,真远程 43 条
远程范围: {'us': 15, 'eu_uk': 12, 'apac': 7, 'americas': 5, 'other': 2, 'multi': 1, 'global': 1}
对中国境内: {'不行': 42, '字面没拦': 1}
  [global] elevenlabs · Forward Deployed Engineer - Software Engineer - Mexico · Mexico · 没写薪资
```

<figure>
<svg viewBox="0 0 640 280" role="img" aria-label="从 104 条标了远程的 FDE 类岗位,到对中国境内字面没拦的 1 条:每一步筛掉了什么">
  <rect x="0" y="0" width="640" height="280" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">8 家公司、2026-10-23:「Remote」一层层剥开</text>
  <rect x="20" y="40" width="600" height="32" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="30" y="61" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">104 条 · 接口字段说远程(isRemote / workplaceType)</text>
  <rect x="60" y="82" width="520" height="32" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="70" y="103" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">93 条 · 去掉经理、总监、实习</text>
  <rect x="120" y="124" width="400" height="32" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="130" y="145" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">43 条 · 正文没说混合办公或坐班</text>
  <rect x="190" y="166" width="260" height="32" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="200" y="187" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">42 条 · 限美国/欧洲/某国</text>
  <rect x="270" y="208" width="100" height="32" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="282" y="229" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">1 条全球</text>
  <text x="20" y="266" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">琥珀:接口说的;蓝:正文说的。规则只能证明「没写」,不能证明「能」</text>
</svg>
<figcaption>今天这次抓取的筛选过程。最大的一刀是「正文写了混合办公」,砍掉一半;剩下的几乎都锁在某个国家或地区里。</figcaption>
</figure>

读这几行:

**104 条「标了远程」,真远程 43 条,对中国境内字面没拦的 1 条。** 这 1 条就是 ElevenLabs 的 FDE,正文写「This role is remote, so it can be executed globally」,和 10 月 15 日那次调研里找到的是同一个岗位(那次挂在阿根廷和墨西哥两个地点,今天只挂在墨西哥)。它没写薪资。

**43 条也不全是真远程。** 规则只能证明正文**没写**坐班,不能证明能远程。剩下的 6 条 OpenAI 岗(巴黎、慕尼黑、华盛顿等)正文压根没提办公方式,我算进了远程,但按 OpenAI 其他岗位的写法,它们大概率也要进办公室。规则判断之后,值得投的那几条一定要人工读原文,这和 Day 503「脚本全绿之后人读一遍」是一个道理。

**亚太 7 条,一条都不对中国开放。** 新加坡、韩国、印度、悉尼,每一条都要求你能在那个国家合法工作。LangChain 有一条写着「Remote - Singapore」,意思是「在新加坡境内远程」。

**写了薪资的都是美国价。** 43 条里写了美元区间的 7 条,区间中点从 $197K 到 $256.5K,中位 $250K,另有几条写的是加元和韩元。对你的意义还是「知道天花板在哪」。

和 10 月 15 日 88 条的调研比,今天样本小(8 家公司),比例会有出入,但结论一模一样:**真正全球可做的,一只手数得过来**。

## Forward Deployed Engineer:一种越来越多的 Agent 岗

FDE 这个名字来自 Palantir,意思是「部署到前线的工程师」:不坐在公司里做产品,而是嵌进客户的团队,把公司的平台在客户的真实业务里落地。AI 公司把这个角色发扬光大了,因为企业客户买了模型或 Agent 平台以后,最大的难题是怎么用进自己的业务。岗位名五花八门:Forward Deployed Engineer、Deployed Engineer、Applied AI Engineer、Agent Deployment Engineer,带售前性质的叫 Solutions Engineer。

数量上,10 月 12 日那批样本里,美国本土 Agent 岗有 52% 提到面向客户或交付,新加坡和香港也是 52%,国内是 33%。国内也开始出现 FDE 岗:智联上有一家军工数字化公司的「AI 智能体(FDE)工程师」(月薪 1.5–2.5 万,1–3 年经验,其中至少 1 年 AI 相关)和一家智能制造公司的「FDE 专家」(1.8–3.5 万,5–10 年,要懂制造业 MES 系统),百度也有数字人方向的 FDE 岗。

### 和普通 Agent 工程师差在哪

10 月 15 日的调研把 60 条远程 FDE 岗和 10 月 12 日的 185 条海外 Agent 工程师岗做了对比(两次规则版本不完全一样,只看差距大的):

| 项目 | 远程 FDE(60 条) | 海外 Agent 工程师(185 条) |
| --- | --- | --- |
| 面向客户 | 80%(严格规则) | 46%(宽松规则) |
| 部署、Docker、K8s、云 | 65% | 53% |
| TypeScript/JS | 47% | 34% |
| 评测 | 52% | 62% |
| RAG / 检索 | 25% | 54% |
| 工具调用 | 10% | 39% |
| 多 Agent | 10% | 22% |
| Agent 框架 | 18% | 36% |
| 年限中位 | 5 年 | 5 年 |

再加两个数:提到出差的 FDE 岗占 43%,写了具体比例的大多在 20% 到 50% 之间(Cohere 统一写 40%,Databricks 写 20%–25%);今天抓的数据里,ElevenLabs、Anthropic 的 FDE 正文也都写着要经常去客户现场。

从这张表能读出三件事:

**FDE 不怎么考 Agent 内部机制。** RAG、多 Agent、工具调用、框架,FDE 的比例只有普通 Agent 工程师的一半左右。它的 JD 写的是「把我们的平台接进客户的系统」,要的是集成、数据、权限,不是从头写 Agent 框架。第三部分到第五部分学的东西,对 FDE 来说是「必须懂」,不是「天天写」。

**FDE 更看重部署和企业环境。** 部署和云 65%,不少岗位要在客户的私有云、甚至断网环境里装东西。

**TypeScript 比例更高。** 很多 FDE 要给客户搭演示和内部工具。这一条对只会前端的你是好消息:你最熟的语言在这类岗位上是加分项。

软性要求才是最大的分水岭:八成面向客户,四成多要出差,还有不少要求你能在客户高管面前讲方案。

### 一个 FDE 的日常

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="FDE 的工作循环:和客户梳理流程,找值得做的环节,快速原型,定验收指标,用客户真实数据评测,上线,收集反馈再迭代">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">FDE 的一轮工作(在客户那边)</text>
  <rect x="20" y="44" width="130" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="30" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">1 梳理业务流程</text>
  <text x="30" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">和客户一起</text>
  <rect x="170" y="44" width="130" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="180" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">2 找值得做的</text>
  <text x="180" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">算 ROI(Day 508)</text>
  <rect x="320" y="44" width="130" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="330" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">3 一周内原型</text>
  <text x="330" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">接客户系统</text>
  <rect x="470" y="44" width="150" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="480" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">4 定验收指标</text>
  <text x="480" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">客户签字认可</text>
  <rect x="470" y="130" width="150" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="480" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">5 真实数据评测</text>
  <text x="480" y="166" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">第六部分那一套</text>
  <rect x="320" y="130" width="130" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="330" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">6 分阶段上线</text>
  <text x="330" y="166" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">灰度、回滚</text>
  <rect x="170" y="130" width="130" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="180" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">7 收反馈</text>
  <text x="180" y="166" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">带回产品团队</text>
  <line x1="150" y1="66" x2="170" y2="66" stroke="var(--ink-faint)"/>
  <line x1="300" y1="66" x2="320" y2="66" stroke="var(--ink-faint)"/>
  <line x1="450" y1="66" x2="470" y2="66" stroke="var(--ink-faint)"/>
  <line x1="545" y1="88" x2="545" y2="130" stroke="var(--ink-faint)"/>
  <line x1="470" y1="152" x2="450" y2="152" stroke="var(--ink-faint)"/>
  <line x1="320" y1="152" x2="300" y2="152" stroke="var(--ink-faint)"/>
  <line x1="170" y1="152" x2="85" y2="152" stroke="var(--ink-faint)"/>
  <line x1="85" y1="152" x2="85" y2="88" stroke="var(--ink-faint)"/>
  <text x="20" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">琥珀色几步是和人打交道,蓝色几步是写代码和评测;FDE 两样都得有</text>
</svg>
<figcaption>FDE 的工作循环。和普通 Agent 工程师比,多出来的是琥珀色那几步:在客户那边梳理需求、算账、分阶段上线、把反馈带回自己公司。</figcaption>
</figure>

国内那条 FDE 的 JD 原话说得很清楚:「能把 AI 能力写进现场」「既能写代码也能跑现场」「以能不能让业务团队马上试用为工作节奏」「用真实数据验证效果,不追概念」。

这门课里有不少东西直接对应 FDE 的日常:[Day 508](/blog/agent-zero/day-508-sysdesign-1/) 的需求澄清和 ROI 估算,第六部分的评测和回归门禁,第七部分的权限、灰度和回滚,还有毕业项目 SupportPilot 的人工审批。FDE 的面试通常多一轮:给你一个模拟客户场景,让你现场问需求、提方案、估工作量,有时还要你向「客户」演示,系统设计题里的需求澄清和分阶段上线会被问得更细。

### 适不适合你

适合的信号:你喜欢和人打交道,能把技术方案讲给不懂技术的人听;你对某个行业有了解(金融、制造、医疗、零售);你能接受出差,甚至一段时间驻场;你喜欢「做出来能用」胜过「做得优雅」。如果你做过 B2B 软件的实施、售前、技术支持,FDE 是很自然的转型方向。

不太适合的信号:你最享受的是长时间不被打扰地钻一个技术问题;你很不喜欢出差;你不想对客户的结果负责。这不是能力问题,是工作方式。

对只会前端的读者,FDE 有一个容易被忽略的优势:搭演示、做内部工具、把 Agent 的执行过程做成客户看得懂的界面,这些你比后端出身的人快。海外 FDE 岗 TypeScript 的比例(47%)比普通 Agent 岗高,原因就在这里。劣势是部署和企业环境(私有云、K8s、权限体系),这些要补。

## 动手练习

### 练习 1:换一家招聘系统,Greenhouse

Anthropic 和 Intercom 的职位挂在 Greenhouse 上,公开接口是 `https://boards-api.greenhouse.io/v1/boards/{公司名}/jobs?content=true`,正文在 `content` 字段里,是转义过的 HTML。复用今天的 `FDE`、`SKIP_TITLE`、`OFFICE`、`classify`、`open_to_cn`,对这两家的 FDE 类岗位各打一行:职位、地点、判断结果、对中国境内能不能投。看看规则在新数据上表现怎样。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex512_greenhouse.py
import html
import re

import httpx

from part09.jobs.ashby import FDE
from part09.jobs.remote_scope import OFFICE, SKIP_TITLE, classify, open_to_cn

API = "https://boards-api.greenhouse.io/v1/boards/{}/jobs?content=true"

with httpx.Client(timeout=30) as client:
    for company in ["anthropic", "intercom"]:
        jobs = client.get(API.format(company)).json()["jobs"]
        fde = [j for j in jobs if FDE.search(j["title"]) and not SKIP_TITLE.search(j["title"])]
        print(f"{company}: 全部 {len(jobs)},FDE 类 {len(fde)}")
        for j in fde:
            text = re.sub(r"<[^>]+>", " ", html.unescape(j.get("content") or ""))
            job = {"location": j["location"]["name"], "secondary": [], "text": text}
            where = "坐班/混合" if OFFICE.search(text) else classify(job)
            print(f"  {j['title'][:48]:<48} {job['location'][:34]:<34} {where:<8} 中国:{open_to_cn(where) if where != '坐班/混合' else '不行'}")
```

<div class="line-notes">

- `from part09.jobs.ashby import FDE` 职位名规则复用。`ashby.py` 的请求在 `__main__` 保护下面,import 不会重新抓一遍。
- `jobs = client.get(API.format(company)).json()["jobs"]` Greenhouse 的结构和 Ashby 不同,但职位也在 `jobs` 里。
- `text = re.sub(r"<[^>]+>", " ", html.unescape(j.get("content") or ""))` 正文是转义过的 HTML,`&lt;p&gt;` 这种。先 `html.unescape` 还原成 `<p>`,再用正则把所有标签换成空格,剩下纯文本。前端里你会用 `DOMParser` 或 `textContent`,Python 标准库没有 DOM,简单场景这样够了。
- `job = {"location": j["location"]["name"], "secondary": [], "text": text}` 拼成和 `fde_today.json` 一样的形状,`classify` 就能直接用。这就是统一数据格式的好处。
- `where = "坐班/混合" if OFFICE.search(text) else classify(job)` 先查坐班,再查范围。

</div>

```bash
uv run python -m part09.ex.ex512_greenhouse
```

```text
anthropic: 全部 678,FDE 类 15
  Applied AI Engineer                              Tokyo, Japan                       apac     中国:不行
  Applied AI Engineer, Beneficial Deployments (Cli London, UK                         eu_uk    中国:不行
  Applied AI Engineer, Beneficial Deployments (Lab London, UK                         eu_uk    中国:不行
  Applied AI Engineer, Beneficial Deployments (Lif San Francisco, CA | New York City, us       中国:不行
  Applied AI Engineer, Enterprise                  Munich, Germany                    eu_uk    中国:不行
  Applied AI Engineer, Enterprise                  Paris, France                      eu_uk    中国:不行
  Applied AI Engineer, Enterprise                  San Francisco, CA | New York City, us       中国:不行
  Applied AI Engineer, Public Sector               Washington, DC                     us       中国:不行
  Applied AI Engineer, Startups                    London, UK                         eu_uk    中国:不行
  Applied AI Engineer, Startups (Life Sciences)    San Francisco, CA | New York City, us       中国:不行
  Applied AI Engineer, Startups (Physical AI)      San Francisco, CA                  us       中国:不行
  Forward Deployed Engineer                        Paris, France                      eu_uk    中国:不行
  Forward Deployed Engineer                        Munich, Germany                    eu_uk    中国:不行
  Forward Deployed Engineer                        London, UK                         eu_uk    中国:不行
  Staff Forward Deployed Engineer                  New York City, NY; San Francisco,  us       中国:不行
intercom: 全部 105,FDE 类 8
  Forward Deployed Data Scientist                  Dublin, Ireland; London, England   坐班/混合    中国:不行
  Forward Deployed Data Scientist                  San Francisco, California          坐班/混合    中国:不行
  Forward Deployed Engineer                        Chicago, Illinois; San Francisco,  坐班/混合    中国:不行
  Senior Forward Deployed Engineer                 Chicago, Illinois; San Francisco,  坐班/混合    中国:不行
  Senior Solutions Engineer                        San Francisco, California          坐班/混合    中国:不行
  Senior Solutions Engineer                        Chicago, Illinois                  坐班/混合    中国:不行
  Senior Solutions Engineer- LATAM                 NYC, Remote; San Francisco, Califo 坐班/混合    中国:不行
  Senior Solutions Engineer- LATAM                 Chicago, Illinois                  坐班/混合    中国:不行
```

结论不变,一条都不能从中国投。但有一处可疑:Anthropic 的 15 条没有一条被判成坐班,全都被当成了远程。打开它的 FDE 岗正文:

```text
Location-based hybrid policy:  Currently, we expect all staff to be in one of our offices at least 25% of the time.
```

「混合办公政策:所有员工至少 25% 的时间在办公室」。`OFFICE` 认识 `hybrid work`、`hybrid model`,不认识 `hybrid policy`。今天的规则是照着 Ashby 那八家的写法调出来的,换一批公司就漏。补上这两种说法再比一次:

```python
# agent-zero-lab/part09/ex/ex512_greenhouse2.py
import html
import re
from collections import Counter

import httpx

from part09.jobs.ashby import FDE
from part09.jobs.remote_scope import OFFICE, SKIP_TITLE

OFFICE2 = re.compile(OFFICE.pattern + r"|hybrid policy|in one of our offices", re.I)
API = "https://boards-api.greenhouse.io/v1/boards/{}/jobs?content=true"

with httpx.Client(timeout=30) as client:
    for company in ["anthropic", "intercom"]:
        jobs = client.get(API.format(company)).json()["jobs"]
        fde = [j for j in jobs if FDE.search(j["title"]) and not SKIP_TITLE.search(j["title"])]
        texts = [re.sub(r"<[^>]+>", " ", html.unescape(j.get("content") or "")) for j in fde]
        old = Counter("坐班/混合" if OFFICE.search(t) else "没提" for t in texts)
        new = Counter("坐班/混合" if OFFICE2.search(t) else "没提" for t in texts)
        print(f"{company}: 旧规则 {dict(old)}  新规则 {dict(new)}")
```

<div class="line-notes">

- `OFFICE2 = re.compile(OFFICE.pattern + r"|hybrid policy|in one of our offices", re.I)` `.pattern` 取出原来正则的字符串,后面接上两种新说法,编译成新正则。不改 `remote_scope.py`,新旧可以并排比。

</div>

```bash
uv run python -m part09.ex.ex512_greenhouse2
```

```text
anthropic: 旧规则 {'没提': 15}  新规则 {'坐班/混合': 15}
intercom: 旧规则 {'坐班/混合': 8}  新规则 {'坐班/混合': 8}
```

Anthropic 的 15 条全部变成坐班或混合。这是今天最重要的一课:**关键词规则只在你调过的那批数据上可靠**。每换一批数据,先抽几条读原文,看规则有没有漏判和误判。

</details>

### 练习 2:FDE 和其他工程师岗,技能要求差在哪

用今天八家 Ashby 公司的**全部**工程师岗位(职位名带 engineer 的),分成 FDE 类和其他两组,数一数几项要求在两组里出现的比例:面向客户、出差、K8s/云部署、TypeScript、RAG/检索、评测、多 Agent。和上面 10 月 15 日的对比表比一比,哪些结论在今天的数据上也成立?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex512_skills.py
import re

import httpx

from part09.jobs.ashby import API, COMPANIES, FDE

SKILLS = {
    "面向客户": r"customer-facing|directly with customers|customer sites|with (our )?customers",
    "出差": r"\btravel",
    "K8s/云部署": r"kubernetes|\bk8s\b|aws|gcp|azure|terraform",
    "TypeScript": r"typescript",
    "RAG/检索": r"\brag\b|retrieval",
    "评测": r"\bevals?\b|evaluation",
    "多 Agent": r"multi-agent|multi agent",
}

fde_texts, eng_texts = [], []
with httpx.Client(timeout=30) as client:
    for c in COMPANIES:
        for j in client.get(API.format(c)).json()["jobs"]:
            if "engineer" not in j["title"].lower():
                continue
            (fde_texts if FDE.search(j["title"]) else eng_texts).append(j.get("descriptionPlain") or "")

print(f"FDE 类 {len(fde_texts)} 条,其他工程师 {len(eng_texts)} 条")
for name, pat in SKILLS.items():
    a = sum(bool(re.search(pat, t, re.I)) for t in fde_texts) / len(fde_texts)
    b = sum(bool(re.search(pat, t, re.I)) for t in eng_texts) / len(eng_texts)
    print(f"  {name:<10} FDE {a:>4.0%}   其他工程师 {b:>4.0%}")
```

<div class="line-notes">

- `from part09.jobs.ashby import API, COMPANIES, FDE` 同一批公司、同一个职位名规则,两组才可比。
- `"出差": r"\btravel",` 带左边界,不会命中 `unravel` 这种词。
- `if "engineer" not in j["title"].lower():` 只比工程师岗,销售、招聘这些不算。
- `(fde_texts if FDE.search(j["title"]) else eng_texts).append(` 条件表达式选出要往哪个列表里加,再 `.append`。写成 if/else 两行也一样。
- `a = sum(bool(re.search(pat, t, re.I)) for t in fde_texts) / len(fde_texts)` 有多少比例的正文命中了这项。`bool(...)` 把匹配结果变成 True/False,求和就是命中条数。
- `{a:>4.0%}` 格式化成不带小数的百分比。

</div>

```bash
uv run python -m part09.ex.ex512_skills
```

```text
FDE 类 155 条,其他工程师 537 条
  面向客户       FDE  69%   其他工程师  27%
  出差         FDE  43%   其他工程师  14%
  K8s/云部署    FDE  71%   其他工程师  72%
  TypeScript FDE  24%   其他工程师  20%
  RAG/检索     FDE  10%   其他工程师  11%
  评测         FDE  56%   其他工程师  27%
  多 Agent    FDE   3%   其他工程师   1%
```

成立的:面向客户(69% 对 27%)和出差(43% 对 14%)差距最大,和 10 月 15 日的结论一致,FDE 的分水岭是软性要求。出差 43% 和那次调研的 43% 恰好一样。

不成立或说不准的:K8s/云部署两边都在 70% 左右,因为规则里有 `aws`,几乎所有 JD 的福利或技术栈里都会提一句云厂商,这一项被稀释了,规则太宽;TypeScript 差距很小,这次的对照组是同公司的其他工程师(里面有大量前端和全栈岗),而 10 月 15 日的对照组是 Agent 工程师岗,对照组不一样,结论自然不一样。评测这次 FDE 反而更高,因为对照组里有很多基础设施岗,本来就不提评测。

所以看任何「A 岗位比 B 岗位更要求 X」的说法,先问对照组是谁。这是 Day 511 讲的口径,换了个场景。

</details>

### 练习 3:开放题。一分钟讲清你要不要投 FDE

写两样东西:①三条支持、三条反对你走 FDE 方向的理由,最后一句结论;②给 SupportPilot 的 README 加一段「如果给真实客户落地,我会分三个阶段推进」,每个阶段写清做什么、看什么指标、什么情况下回滚。写完出声讲一遍,控制在一分钟。

<details><summary>参考答案</summary>

示范解法,以「4 年前端、做过两年 B2B 后台、不排斥出差」的人为例。

①自评:

- 支持:做过 B2B 后台,知道企业客户的审批、权限、数据导入是怎么回事;前端快,能当天给客户搭出可点的演示;第八部分的 SupportPilot 本身就是「给一家公司的客服落地 Agent」,能直接讲成案例。
- 反对:没有 K8s 和私有化部署经验,海外 FDE 里这一块占 65%;英文口语还撑不住给客户高管讲方案;国内 FDE 岗还很少,海外的又基本不能从国内投。
- 结论:国内先投「Agent 应用开发」岗里写了「对接业务部门」「落地交付」的那一类,把 FDE 当一年后的方向;这一年补部署和英文口语。

②README 段落,先看一版常见的写法:

```text
上线计划:先小范围试点,然后逐步推广,最后全面上线,过程中持续监控效果。
```

这一段放在任何项目里都成立,也就等于什么都没说。面试官会问「试点多小?看什么?什么时候算失败?」,三个问题都答不上。改过的版本:

```text
如果给真实客户落地,我会分三个阶段:

1. 影子模式(2 周):Agent 只起草不发送,客服照常回复。每天对比 Agent 草稿和客服实际回复,
   指标是草稿可直接采用率(目标 ≥ 60%)和越权操作数(必须为 0)。越权出现一次就停下查原因。
2. 小流量(4 周):只开放「账单查询」一类、10% 的工单,退款类全部走人工审批。
   指标是首次解决率、平均处理时长和客户差评率;差评率比人工高 2 个百分点以上,一个开关切回纯人工。
3. 扩类别:每加一类工单先跑离线评测集(第六部分的回归门禁),通过再开流量;
   每周和客户的客服主管过一次失败案例,带回来补进评测集。
```

前后对比:改过的版本每个阶段都有时长、范围、指标和回滚条件,而且每一项都能在课里找到出处(影子模式和灰度在第七部分,评测门禁在第六部分,人工审批在 SupportPilot)。面试官顺着任何一句追问,你都有东西可讲。我自己出声讲这两段,第一次用了 1 分 40 秒,删掉自评里的细节、只留结论,第二次 58 秒。

</details>

**验收标准**

- `ashby.py` 和 `remote_scope.py` 在你那天跑通了,能说出你那天的数字和今天文章里的差在哪。
- 能说出今天的规则判错过的三种情况:global 误伤、on-site 误伤、hybrid policy 漏判。
- 能不看文章说出 FDE 和普通 Agent 工程师差得最大的两项要求,以及你自己适不适合。
- 练习 3 的一分钟讲稿写好了,讲过一遍。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Remote(海外 JD) | 几乎总是「在某个国家或地区境内可以不来办公室」,不等于全球可做 |
| 远程范围 | 一个远程岗允许你在哪里工作:只限美国、只限欧洲、某一国、全球 |
| 混合办公(hybrid) | 一周几天在办公室、几天在家,比如 OpenAI 写的「3 days in the office」 |
| EOR | Employer of Record,名义雇主:在你所在国有法律实体的平台(如 Deel、Remote.com)替海外公司合法雇你 |
| contractor | 独立承包人,按合同交付工作,不是员工,税务和收款自己处理 |
| FDE | Forward Deployed Engineer,嵌进客户团队、把公司的平台在客户业务里落地的工程师,名字来自 Palantir |
| Solutions Engineer | 解决方案工程师,和 FDE 相近,通常带售前性质 |
| Applied AI Engineer | 海外常见岗位名,把模型能力用到具体产品或客户场景里 |
| 公开职位接口 | Ashby、Greenhouse、Lever 等招聘系统给公司官网展示职位用的接口,返回 JSON,不用登录 |
| 驻场 | 一段时间在客户的办公地点工作 |

## 常见误区

**看到 Remote 就以为能从中国投。** 今天 104 条标了远程的岗位,对中国境内字面没拦的只有 1 条。Remote 后面的国家名才是重点。

**相信结构化字段。** OpenAI 的岗位 `isRemote` 是 true,正文写一周三天在办公室。字段和正文对不上,以正文为准。

**用单个词判断复杂的意思。** 「global」命中了「global technology company」,「on-site」命中了「去客户现场」。匹配整句说法,改完规则拿全量数据抽查。

**规则在一批数据上调好了,就当它通用。** 同一个 `OFFICE` 在 Ashby 八家上表现不错,到 Anthropic 就漏了「hybrid policy」。换数据先抽查。

**把远程当成近期主线。** 两次调研加今天的抓取,全球可做的岗位都是个位数,而且大多不写薪资。远程可以是长期选项,近期主线放在国内和新加坡。

**以为 FDE 是「不用写代码的售前」。** FDE 的 JD 里部署和云 65%、评测 52%,写代码的部分一点不少,只是多了面向客户和出差。真正带售前性质的是部分 Solutions Engineer 岗。

**以为 FDE 远程就不用出门。** 提到出差的 FDE 岗 43%,写了比例的多在 20% 到 50%。远程 FDE 常见的是一年里两到五成时间在客户那边。

**用脚本批量抓需要登录的网站。** 今天只调了给官网展示用的公开接口,一家一次。LinkedIn、Boss 这种需要登录的不要碰。

## 学习资料

### 文档与文章

- [Ashby · Public Job Posting API](https://developers.ashbyhq.com/docs/public-job-posting-api):今天 `ashby.py` 调的接口的官方说明,字段含义(`isRemote`、`workplaceType`、`secondaryLocations`)都在这里。
- [Greenhouse · Job Board API](https://developers.greenhouse.io/job-board.html):练习 1 用的接口,看 `GET /boards/{board_token}/jobs` 那一节。
- [ElevenLabs · Forward Deployed Engineer - Software Engineer](https://jobs.ashbyhq.com/elevenlabs/8a573932-b1fb-4df7-9023-e13a6cecbbbb):今天唯一一条写明全球可做的岗位,读一遍它的职责和要求,看一个远程 FDE 要做什么。
- [Anthropic · Forward Deployed Engineer(伦敦)](https://job-boards.greenhouse.io/anthropic/jobs/5423029008):头部模型公司的 FDE JD,注意出差比例和混合办公那一段。
- [LangChain · Deployed Engineer, Professional Services (APAC)](https://jobs.ashbyhq.com/langchain/0ee73994-b8a3-4a75-9675-da536abd3e10):技能要求和这门课最对口的一条(Python、TypeScript、LangGraph、评测、可观测),但地点是新加坡境内。
- [Palantir · Forward Deployed Software Engineer](https://jobs.lever.co/palantir/5b0f37e6-8569-4a62-9e38-c5a4edc67dcf):FDE 发源地的 JD,职责描述把「一天可能要做的事」列得很具体。
- [Deel · What is an Employer of Record](https://www.deel.com/glossary/employer-of-record/):EOR 是怎么运作的,读完就明白为什么大多数公司不愿意为一个人走这条路。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19QpLzGEGY&autoplay=0&high_quality=1" title="从Palantir到AI时代：Forward Deployed Engineer模式的深度解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>GoldenSpiderAI · 从Palantir到AI时代:Forward Deployed Engineer模式的深度解析 · 50 分钟,Y Combinator 播客里 Bob McGrew(Palantir 早期高管、OpenAI 前首席研究官)讲 FDE 模式的中文搬运。前半段讲 Palantir 为什么发明这个角色,今天的「FDE 是什么」那一节就是它的背景。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19an36kEQT&autoplay=0&high_quality=1" title="远程工作面试诈骗避坑指南" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>张保护Alvan · 远程工作面试诈骗避坑指南 · 13 分钟,讲英文远程岗面试里常见的诈骗套路,只从面试和沟通的表现判断。今天讲了「全球、高薪、门槛低」要先怀疑,这个视频讲具体怎么怀疑,后天避坑那一节还会用到。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/qZgErBZk0GY" title="Forward Deployed Engineer | Role &amp; Interview Overview" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Aced (formerly Exponent) · Forward Deployed Engineer | Role &amp; Interview Overview · 英文,FDE 是做什么的、面试分几轮、各轮考什么。判断自己适不适合之前看,重点听「客户场景模拟」那一轮。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/GtPyXqFbCus" title="How to Get a Remote or International Tech Job (Complete Guide)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Beyond Coding · How to Get a Remote or International Tech Job (Complete Guide) · 英文,讲远程和跨国求职的几条路(直接远程、EOR、先进外企再转、移居),和今天「能走的几条路」对照看,注意它面向的主要是欧洲求职者。</figcaption>
</figure>

### 书籍

- Jason Fried、David Heinemeier Hansson《Remote: Office Not Required》(Crown Business,2013;中文版书名《重来 2:更为简单高效的远程工作方式》):Basecamp 两位创始人讲远程工作,站在雇主角度,能帮你理解公司为什么愿意或不愿意招远程,以及远程工作对沟通的要求。
- David Maister、Charles Green、Robert Galford《The Trusted Advisor》(Free Press,2000):写给咨询顾问的书,讲怎么让客户信任你。FDE 的软性要求说白了就是这本书的主题,前几章讲「可信度、可靠性、亲近感」的那一部分对你最有用。

### 开源项目与代码

今天这组不需要。如果你想长期跟踪海外岗位,今天的 `ashby.py` 加上练习 1 的 Greenhouse 版本,就是一个最小的岗位监控:每周跑一次,和上周的结果对比新增了哪些。别把频率调高,这些接口是给官网展示用的,不是给你刷的。

## 自测

1. 一条 JD 地点写「Remote - Singapore」,正文没提办公方式。人在中国境内的你能投吗?

<details><summary>答案</summary>

基本不能。「Remote - Singapore」的意思是在新加坡境内可以远程,你得有在新加坡合法工作的身份(比如 Employment Pass),公司才能雇你。今天 LangChain 的 APAC 岗就是这种写法。想投的话,先问清楚能不能在新加坡以外,大概率答案是不能。

</details>

2. 今天第一版规则判出 57 条「全球可做」,最后只剩 1 条。中间判错的原因是什么?

<details><summary>答案</summary>

用单个词「global」去匹配正文,命中了公司介绍里的「global technology company」、福利里的「Global team」、隐私声明里的「Global Applicant」等等,这些都不是在说岗位能在全球做。和 Day 498 的子串误伤是同一类错。改成只匹配整句说法(「executed globally」「work from anywhere」),只剩 ElevenLabs 那一条。

</details>

3. OpenAI 的 FDE 岗在接口里 `isRemote` 是 true,你怎么处理?

<details><summary>答案</summary>

以正文为准。正文写的是「hybrid work model of 3 days in the office per week」,一周三天在办公室,不算远程。结构化字段是后台勾的,可能勾错,也可能指团队里部分人远程。判断规则要同时看字段和正文,两者冲突时信正文,值得投的再人工读一遍原文。

</details>

4. FDE 和普通 Agent 工程师的 JD,差得最大的是哪几项?

<details><summary>答案</summary>

面向客户(严格规则下 FDE 80%,Agent 工程师宽松规则 46%;今天同公司对比 69% 对 27%)和出差(43% 对 14%)差得最大;FDE 更看重部署和企业环境(65% 对 53%)和 TypeScript(47% 对 34%);Agent 内部机制(RAG、工具调用、多 Agent、框架)FDE 只有一半左右。两者年限门槛一样,中位都是 5 年。

</details>

5. (面试题)FDE 面试官问:「客户说你们的 Agent 不好用,你第一周做什么?」

<details><summary>答案</summary>

先别改代码。第一周做三件事:①去客户那边看他们实际怎么用,找三五个具体的失败案例,问清「不好用」是指答错了、太慢了,还是不敢用;②把失败案例分类,看是检索没找到、工具调错了、还是流程本身不适合 Agent,这是第六部分错误分析的做法;③和客户一起定一个可量化的验收指标,比如「账单类问题首次解决率从 X 到 Y」,并约定下周用他们的真实工单做一次评测。第二周再按失败类别最多的那一类改。答的时候带上一句「我在 SupportPilot 上做过类似的错误分析,当时最多的一类是……」,就从原则落到了你自己做过的事上。

</details>

## 明天预告

Day 513 · 求职(三):面试流程、谈薪、避坑和投递节奏。渠道和行情清楚了,明天讲投出去以后的事:国内外 Agent 岗的面试一般几轮、每轮考什么;拿到 offer 怎么谈、怎么用一张表比较两个 offer 的总包;怎么识别假 AI 岗、外包派遣和培训贷;以及一周投多少、怎么用漏斗数据找出卡在哪一步。
