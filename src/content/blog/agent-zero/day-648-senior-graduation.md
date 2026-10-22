---
title: 'Day 648 · 进阶结业:资深自检、市场数据、找岗位和谈薪'
description: '第十部分的最后一天。用脚本检查一张十行的资深自检表,每一行都要有能点开的文件或链接;从真实 JD 里算资深档的挂牌年包分位数,看清「高级」两个字怎么把数据拉低;讲资深岗位从哪找;最后用代码比较两个结构不同的 offer,算清楚职级为什么比薪资数字更值得谈、期权要多大概率兑现才划算。'
pubDate: 2026-10-22
regime: none
tags: ['career', 'salary', 'negotiation', 'staff-engineer', 'python', 'agent-zero']
series: 'agent-zero'
day: 648
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 647](/blog/agent-zero/day-647-open-source-2/) 讲了门在自己手里的两种影响力。开源自己的项目之前,`release_check.py` 在演示仓库上查出 7 个问题,修好后变成 0 个,可 `git log -S` 一搜,两个假 key 还躺在第一个提交里,所以 key 进过仓库就要先作废。写作那部分,`adr_outline.py` 把 ADR 扩写成大纲,没编数字,却暴露出「数据」一节是空的;`talk_time.py` 算出我觉得「挺多」的开场只有 183 个汉字,不到一分钟。

这两天攒下的 PR、文章、分享,加上第十部分做的 AgentOps、设计文档和 ADR,今天要变成一张表上的证据。这是第十部分的最后一天,不学新技术,只做一件事:看清楚自己现在能投什么样的岗位,怎么找,怎么谈。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 `self_check.py` 检查一张十行的资深自检表,每一行要么有能打开的文件或链接,要么写清补齐计划。
2. 从 JD 薪资字符串算出 P25、中位、P75,并说清楚这批数字的口径和局限,知道「高级」两个字为什么会把资深档的数据拉低。
3. 说出资深岗位比中级岗位更依赖哪几个渠道。
4. 用代码比较两个结构不同的 offer,解释为什么先谈职级、为什么期权要按 0 计。

预计用时:3 小时。自检那部分要认真做,它直接决定你接下来一个月干什么。前置:[Day 1](/blog/agent-zero/day-001-salary-honest/)(薪资怎么折算、中位数)、[Day 513](/blog/agent-zero/day-513-offer/)(谈薪基本方法)、[Day 516](/blog/agent-zero/day-516-basic-graduation/)(普通篇结业自检)、[Day 518](/blog/agent-zero/day-518-senior-gap/)(中级和资深差在哪)、[Day 498](/blog/agent-zero/day-498-resume-1/) 到 [Day 501](/blog/agent-zero/day-501-resume-4/)(简历)。

学法提示:先对照文章逐行敲一遍代码(不复制粘贴)并跑通;第二天合上文章,把自检表的十行和谈薪的五条原则默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 第十部分走过的路

从 [Day 518](/blog/agent-zero/day-518-senior-gap/) 开始的这一百多天,和普通篇的区别可以用一句话说:普通篇结束时,你能在面试里讲清楚你写的 Agent 每一步在干什么;第十部分结束时,你应该能讲清楚为什么这样设计、怎么证明它是对的、要花多少钱、出了事怎么办、怎么让十个团队一起用。后面这些,就是资深岗位在买的东西。

回头数一下:harness、上下文和记忆、持久化执行、编排取舍,这是架构深水区;Wilson 区间、配对比较、bootstrap、红队、benchmark,这是评测科学;选模型、自部署、微调、DPO、蒸馏、强化学习,这是模型层;平台、网关、MCP 网关、身份、可观测、合规、事故复盘,这是平台化;coding agent、computer use、语音、Deep Research、A2A、支付、生成式 UI,这是前沿形态;然后 AgentOps 十二天把它们拼成一个平台;最后九天讲设计文档、立项、系统设计面试和影响力。

## 资深自检:每一行都要有证据

下面这张表是我从 JD 数据里资深档岗位(职位名带资深、专家、架构师、负责人,或者年限要求 5 年以上)的高频要求整理出来的,对应到这门课的产出。**打勾的标准不是「我学过」,而是「我能拿出一个文件或链接给面试官看」。**

在 `agent-zero-lab/notes/` 下建 `self-check.md`,三列:能力、证据、对应课程。证据写相对 `agent-zero-lab` 根目录的路径,或者一个链接。下面是我在自己的练习目录里填的样子,故意保留了真实的缺口:

```markdown
| 能力 | 证据 | 对应课程 |
| --- | --- | --- |
| 架构设计 | part10/samples/adr | Day 543、603、640 |
| 评测体系 | agentops/evals/report.md | Day 547–550、562、633 |
| 可靠性 | agentops/runtime | Day 535–539、631–632 |
| 成本 | part10/roi.py | Day 588、635、641 |
| 平台化 | agentops/gateway | Day 583–590、626–628 |
| 安全 | | Day 556–557、637 |
| 模型层(加分) | | Day 567–582 |
| 前沿判断 | | Day 604–623 |
| 系统设计面试 | notes/day642/answers.md | Day 642、644 |
| 影响力 | https://github.com/<你的用户名>/<项目>/pull/<编号> | Day 645–647 |
```

每一行在面试里对应什么证据,我多说一句,因为这决定了你填的东西过不过得了追问:

| 能力 | 合格的证据长什么样 |
| --- | --- |
| 架构设计 | AgentOps 设计文档 + 至少 5 条 ADR,每条有「需要重新评估的条件」 |
| 评测体系 | 带样本量和 Wilson 区间的评测报告,两个版本用配对比较,judge 和人工一致率 |
| 可靠性 | 持久化运行器 + 一份事故复盘(哪怕是演练出来的) |
| 成本 | 回本测算 + 成本看板 + 一页纸 |
| 平台化 | 网关 + MCP 代理 + 压测报告(有 P95 和容量结论) |
| 安全 | 红队用例接进 CI 的截图或配置 + 审计日志样例 |
| 模型层 | 一个 LoRA 或蒸馏的路由小模型和它的对比评测,加分项 |
| 前沿判断 | 一份带打分矩阵和敏感性分析的技术选型报告 |
| 系统设计面试 | 三道真题的计时答案 + 一次模拟面试录音 |
| 影响力 | 一页纸提案、一个公开的 issue 或 PR、一篇文章 |

手工对表很容易自我感觉良好,所以写一个检查器 `part10/self_check.py`:

```python
# agent-zero-lab/part10/self_check.py
import sys
from pathlib import Path

def rows(md: str) -> list[list[str]]:
    out = []
    for line in md.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) == 3 and cells[0] not in ("能力", "---"):
            out.append(cells)
    return out

def judge(evidence: str) -> str:
    if not evidence:
        return "空着"
    if "<" in evidence or "TODO" in evidence:
        return "占位符"
    if evidence.startswith(("http://", "https://")):
        return "有(链接)"
    return "有(文件)" if Path(evidence).exists() else "路径不存在"

if __name__ == "__main__":
    table = rows(Path(sys.argv[1]).read_text(encoding="utf-8"))
    gaps = []
    for skill, evidence, days in table:
        verdict = judge(evidence)
        print(f"{skill:<10}{verdict:<8}{days}")
        if not verdict.startswith("有"):
            gaps.append(skill)
    print(f"\n{len(table) - len(gaps)}/{len(table)} 行有证据")
    if len(gaps) >= 3:
        print("缺口 3 行以上:先补这几行,或者先投中高级岗边干边补:" + "、".join(gaps))
```

<div class="line-notes">

- `cells = [c.strip() for c in line.strip().strip("|").split("|")]` 从里往外读:`line.strip()` 去掉行首尾空白,`.strip("|")` 去掉两头的竖线,`.split("|")` 按竖线切成格子,最后每个格子再去空白。`| 安全 | | Day 556–557、637 |` 会变成 `['安全', '', 'Day 556–557、637']`,中间那个空字符串就是空着的证据。≈ JS 的 `line.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim())`。
- `if len(cells) == 3 and cells[0] not in ("能力", "---"):` 跳过表头和分隔行,其他三列的行都算数据。
- `if "<" in evidence or "TODO" in evidence:` 写着 `<你的用户名>` 的链接是模板,不是证据。这一条专门防「先把格子填满再说」。
- `if evidence.startswith(("http://", "https://")):` `startswith` 可以传一个元组,任一开头都算,≈ JS 的 `["http://", "https://"].some(p => s.startsWith(p))`。链接只查格式,不去访问,练习里可以加。
- `return "有(文件)" if Path(evidence).exists() else "路径不存在"` 文件或目录存在才算。写了一个路径但文件不在,比空着更危险,因为你以为自己有。
- `if len(gaps) >= 3:` 三行以上没证据,我的建议是先别投资深岗。

</div>

在 `agent-zero-lab/` 根目录跑:

```bash
uv run python -m part10.self_check notes/self-check.md
```

```text
架构设计      有(文件)   Day 543、603、640
评测体系      路径不存在   Day 547–550、562、633
可靠性       路径不存在   Day 535–539、631–632
成本        有(文件)   Day 588、635、641
平台化       路径不存在   Day 583–590、626–628
安全        空着      Day 556–557、637
模型层(加分)   空着      Day 567–582
前沿判断      空着      Day 604–623
系统设计面试    路径不存在   Day 642、644
影响力       占位符     Day 645–647

2/10 行有证据
缺口 3 行以上:先补这几行,或者先投中高级岗边干边补:评测体系、可靠性、平台化、安全、模型层(加分)、前沿判断、系统设计面试、影响力
```

这是我写这篇时用的练习目录,里面只有第十部分最后这几天的文件,所以只有 2/10。你从头做下来的 `agent-zero-lab` 里有 `agentops/`,应该好得多。

对表要诚实。面试官会顺着简历往下问两三层,一个只做过演示、没有真实数据的「评测平台」,问到「judge 和人工一致率多少」「样本量够不够分出两个版本」时就露馅了。如果三行以上填不上,有两条路:回去把对应的项目补完,或者先按中高级岗位投,入职以后边干边补。这两条路都没问题,不要硬撑着用一张空表去投资深岗,面试失败的打击比晚一个月投要大得多。

## 资深档的市场数据

先说口径,这一节所有国内数字都来自站长 2026 年 10 月 12 日抓的那批 JD,[Day 1](/blog/agent-zero/day-001-salary-honest/) 用过:

- 国内薪资来自 Boss 直聘和猎聘的列表,共 557 条带薪资。用挂牌月薪区间的中点乘薪数(没写按 12 薪)折算成年包,单位万元。**这是招聘方挂的报价,不是成交价。**
- 每个「关键词 × 城市」只抓了第一页,排序受平台推荐和抓取账号的画像影响。
- 海外薪资来自公开的招聘页面,大多是 base 区间,另有股权。

先用一个 16 条的小样本把计算过程跑一遍。`part10/samples/senior_pay.json` 是从那批数据里挑的 16 条职位名带「资深、专家、高级、架构、负责人、总监」的真实岗位,薪资字符串原样保留(公司名是平台上显示的,有的平台本身就打了码):

```json
[
  {"company": "北京前呈无限科技", "title": "高级数据平台AI Agent研发工程师", "salary": "35-60K·14薪"},
  {"company": "上海某大型互联网公司", "title": "AI Agent平台高级技术专家", "salary": "40-70K·16薪"},
  {"company": "上海代码一行科技", "title": "资深AI Agent研发工程师", "salary": "25-50K·15薪"},
  {"company": "火烧云数据", "title": "AI Agent负责人/架构师", "salary": "30-50K"},
  {"company": "阿里巴巴集团", "title": "AI Agent开发工程师/专家-Accio", "salary": "50-65K·16薪"},
  {"company": "涂鸦智能", "title": "资深AI Agent开发工程师", "salary": "20-40K"},
  {"company": "京东集团", "title": "大模型应用/AI agent算法专家", "salary": "40-70K·20薪"},
  {"company": "南伽科技", "title": "AI 大模型应用开发专家", "salary": "40-70K·13薪"},
  {"company": "字节跳动", "title": "LLM算法专家-AI应用与创新", "salary": "50-80K·15薪"},
  {"company": "某大型银行软件公司", "title": "生成式 AI 智能体平台开发专家", "salary": "35-65K"},
  {"company": "网易云音乐", "title": "资深 Agent 平台全栈工程师", "salary": "30-60K·15薪"},
  {"company": "深圳嘉讯", "title": "高级大模型智能体开发工程师", "salary": "15-20K"},
  {"company": "某知名上市集团公司", "title": "AI Agent 平台架构总监", "salary": "110-160K·18薪"},
  {"company": "某北京互联网公司", "title": "高级 Agent 工程师", "salary": "40-70k·15薪"},
  {"company": "某互联网公司", "title": "资深agent开发(有过小团队管理经验)", "salary": "70-100k·18薪"},
  {"company": "沃兰特航空", "title": "高级AI 应用工程师", "salary": "20-40k"}
]
```

[Day 1](/blog/agent-zero/day-001-salary-honest/) 在浏览器 Console 里用 JS 折算过「35-65K·16薪」这种字符串,今天用 Python 写一遍,顺便算分位数。`part10/pay_stats.py`:

```python
# agent-zero-lab/part10/pay_stats.py
import json
import re
import statistics
from pathlib import Path

SALARY = re.compile(r"(\d+)-(\d+)[kK](?:·(\d+)薪)?")

def annual_wan(text: str) -> float | None:
    m = SALARY.search(text)
    if not m:
        return None
    lo, hi = int(m.group(1)), int(m.group(2))
    months = int(m.group(3)) if m.group(3) else 12
    return (lo + hi) / 2 * months / 10

def quartiles(values: list[float]) -> tuple[float, float, float]:
    q1, q2, q3 = statistics.quantiles(values, n=4, method="inclusive")
    return q1, q2, q3

if __name__ == "__main__":
    jobs = json.loads(Path("part10/samples/senior_pay.json").read_text(encoding="utf-8"))
    pay = {j["title"]: annual_wan(j["salary"]) for j in jobs}
    values = sorted(v for v in pay.values() if v is not None)
    q1, q2, q3 = quartiles(values)
    print(f"{len(values)} 条,P25 {q1:.0f} 万,中位 {q2:.0f} 万,P75 {q3:.0f} 万")
    print(f"最低 {values[0]:.0f} 万,最高 {values[-1]:.0f} 万,80 万以上 {sum(v >= 80 for v in values)} 条")
    no_senior = [v for t, v in pay.items() if v is not None and "高级" in t and not re.search("资深|专家|架构|总监|负责人", t)]
    print(f"只写「高级」的 {len(no_senior)} 条:{sorted(no_senior)}")
```

<div class="line-notes">

- `SALARY = re.compile(r"(\d+)-(\d+)[kK](?:·(\d+)薪)?")` 三个捕获组:月薪下限、上限、薪数。`[kK]` 是因为 Boss 写大写 K、猎聘写小写 k。`(?:·(\d+)薪)?` 外层非捕获组加问号,表示「·16薪」这一段可有可无。
- `lo, hi = int(m.group(1)), int(m.group(2))` `m.group(1)` 取第一个捕获组,`35-60K·14薪` 得到 `"35"` 和 `"60"`,再转整数。
- `months = int(m.group(3)) if m.group(3) else 12` 没写薪数时 `group(3)` 是 `None`,按 12 薪算。
- `return (lo + hi) / 2 * months / 10` 月薪中点(千元)乘薪数得到年包千元,除以 10 变成万元。`35-60K·14薪`:`(35 + 60) / 2 × 14 / 10 = 66.5` 万。
- `q1, q2, q3 = statistics.quantiles(values, n=4, method="inclusive")` 把排好序的数切成四等份,返回三个切点,就是 P25、中位数、P75。`method="inclusive"` 是在相邻两个值之间按比例插值,和 Excel 的 `QUARTILE.INC` 一致;不写的话默认是另一种算法,小样本时结果会差一点。
- `pay = {j["title"]: annual_wan(j["salary"]) for j in jobs}` 字典推导式,职位名做键,年包做值,≈ JS 的 `Object.fromEntries(jobs.map(j => [j.title, annualWan(j.salary)]))`。
- `print(f"最低 {values[0]:.0f} 万,最高 {values[-1]:.0f} 万,80 万以上 {sum(v >= 80 for v in values)} 条")` `sum(v >= 80 for v in values)` 在数 True 的个数,Python 里 True 当 1 算。
- `no_senior = [v for t, v in pay.items() if v is not None and "高级" in t and not re.search("资深|专家|架构|总监|负责人", t)]` 挑出职位名只有「高级」、没有其他资深字样的岗位,看它们是不是在拖低整体。

</div>

```bash
uv run python -m part10.pay_stats
```

```text
16 条,P25 54 万,中位 70 万,P75 93 万
最低 21 万,最高 243 万,80 万以上 7 条
只写「高级」的 4 条:[21.0, 36.0, 66.5, 82.5]
```

16 条是我挑的,比例不能当真,但它已经能看出两件事。一是上沿拉得非常开:最高的「AI Agent 平台架构总监」`(110 + 160) / 2 × 18 / 10 = 243` 万,最低的「高级大模型智能体开发工程师」`(15 + 20) / 2 × 12 / 10 = 21` 万,同样是「资深档」,差了十倍多。二是只写「高级」的四条里有两条在 40 万以下,「高级」两个字在国内 JD 里用得很随意,它不一定代表资深。

同一个计算我在完整的 557 条上跑了一遍(用的就是上面的折算公式和 `inclusive` 分位数),结果如下:

| 分组 | 样本 | P25 | 中位 | P75 | 80 万以上 |
| --- | --- | --- | --- | --- | --- |
| 全部 | 557 | 36 | 48 | 68 | 15% |
| 要求 3–5 年 | 197 | 35 | 48 | 66 | 14% |
| 要求 5–10 年 | 107 | 36 | 54 | 68 | 15% |
| 职位名带资深、专家、架构师、高级、负责人等 | 49 | 48 | 66 | 88 | 37% |
| 同上,但去掉只写「高级」的 | 33 | 56 | 72 | 104 | 42% |
| 只写「高级」 | 16 | 36 | 48 | 70 | 25% |

(要求 10 年以上的只有 7 条,中位 160 万,样本太少不放进表里,别当市场价。)

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="国内不同分组的挂牌年包区间对比">
<text x="20" y="20" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">挂牌年包(万元),线段 = P25 到 P75,圆点 = 中位</text>
<line x1="160" y1="200" x2="620" y2="200" stroke="var(--rule)"/>
<text x="160" y="216" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">20</text>
<text x="288" y="216" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">45</text>
<text x="416" y="216" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">70</text>
<text x="543" y="216" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">95</text>
<text x="150" y="54" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">全部 557</text>
<line x1="242" y1="50" x2="405" y2="50" stroke="var(--mem)" stroke-width="6" stroke-linecap="round"/>
<circle cx="303" cy="50" r="6" fill="var(--paper)" stroke="var(--mem)" stroke-width="2"/>
<text x="150" y="94" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">5–10 年 107</text>
<line x1="242" y1="90" x2="405" y2="90" stroke="var(--mem)" stroke-width="6" stroke-linecap="round"/>
<circle cx="334" cy="90" r="6" fill="var(--paper)" stroke="var(--mem)" stroke-width="2"/>
<text x="150" y="134" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">资深职位名 49</text>
<line x1="303" y1="130" x2="508" y2="130" stroke="var(--compute)" stroke-width="6" stroke-linecap="round"/>
<circle cx="395" cy="130" r="6" fill="var(--paper)" stroke="var(--compute)" stroke-width="2"/>
<text x="150" y="174" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">去掉「高级」33</text>
<line x1="344" y1="170" x2="589" y2="170" stroke="var(--compute)" stroke-width="6" stroke-linecap="round"/>
<circle cx="426" cy="170" r="6" fill="var(--paper)" stroke="var(--compute)" stroke-width="2"/>
</svg>
<figcaption>按年限分组几乎看不出差别,5–10 年的中位只比整体高 6 万;按职位名分组差别就出来了,去掉随意使用的「高级」之后,P75 过了 100 万。资深档的差异主要在上沿:谈得好和谈得一般,可能差几十万。</figcaption>
</figure>

这张表最值得记住的一点:**年限不怎么决定薪资,职位(也就是职级和职责)才决定。** 要求 5–10 年的岗位中位只有 54 万,和整体的 48 万差不多;职位名真正带资深字样的,中位 72 万。这个现象后面讲谈薪时还会用到。

其他切法也可以看看:万人以上的公司中位 57 万;分平台的话 Boss 中位 49 万、猎聘中位 42 万。这些在 [Day 1](/blog/agent-zero/day-001-salary-honest/) 链接的那篇《880 条真实 JD 拆解》里有细表。

**新加坡。** MyCareersFuture(新加坡政府的职位库)上 29 条带月薪,中间那一档是每月 SGD 7,500 到 10,000,范围从 3,000 到 21,667。但这批雇主里中介和外包公司占比很高,头部 AI 公司的新加坡岗这次样本里没有一条带薪资的,资深档的真实上限要靠 LinkedIn 和猎头去了解。

**海外 Staff 档**(公开的 base 区间,另有股权):

| 公司 | 职位 | 地点 | 年薪 base |
| --- | --- | --- | --- |
| Harvey | Staff Software Engineer, Agents | 旧金山 | $231K–$340K + 股权 + 奖金 |
| Decagon | Staff Software Engineer, Agent Platform | 旧金山 | $200K–$400K + 股权 |
| Replit | Staff Software Engineer, Agentic Commerce & Payments | Foster City | $290K–$360K + 股权 |
| Perplexity | Member of Technical Staff, Applied AI | 旧金山 | $220K–$405K + 股权 |
| Cohere | Member of Technical Staff, Agent Code | 伦敦 | CA$250K–CA$535K + 股权 |
| GC AI | Member of Technical Staff, Applied AI | 远程(限美加) | $180K–$430K + 股权 |
| Mozilla / Thunderbird | Staff Product Engineer, Enterprise AI | 远程(限美加) | $185K–$220K |

美国本土 26 条带薪资的,中间那一档是 $198K 到 $335K;海外远程 8 条是 $180K 到 $250K。

**远程的现实。** 46 条海外远程岗里,限美国、加拿大或美洲的 18 条,限欧洲或英国时区的 6 条,限其他特定国家的 8 条,没写清的 11 条,明确写「全球任意地点」的只有 3 条(Hacker News 上 Tether 的 AI Harness Engineer,We Work Remotely 上两条)。上表里两个远程 Staff 岗都写了限美加。所以人在国内的话,海外远程 Staff 岗基本不是一条靠投简历能走通的路。更现实的几条:国内资深岗;新加坡或香港的岗位(要搬家);或者通过开源和社区影响力让对方先找到你,以合同工的形式合作。这也是 Day 646、647 花两天讲公开影响力的原因。

## 资深岗位怎么找

中级岗位海投还能撞上几个面试,资深岗位海投效率很低,原因是这类岗位很多根本不挂出来,或者挂出来了也是先走内部推荐。几条更有效的渠道:

**内推。** 资深岗位的内推比例比中级高得多。前三天讲的影响力在这里变现:你帮过的人、一起做过项目的人、在社区里认识的人。直接问他们团队有没有这类岗位,比在招聘网站上投十份有用。

**猎头。** 猎聘和 LinkedIn 上的猎头手里有大量不公开的资深岗位。和两三个专做 AI 方向的猎头保持联系,告诉他们你的目标:职级、方向、城市、最低薪资。猎头的费用由雇主付,对你免费。注意别让多个猎头把你推给同一家公司,有的公司会因此直接放弃。

**主动找用人的人。** 在 GitHub、博客、技术社区里看到某个团队在做你感兴趣的 Agent 方向,直接给负责人发一封短邮件或私信:你是谁、做过什么(附链接)、为什么对他们的方向感兴趣。资深候选人这样做是被欢迎的,好的资深候选人一直稀缺。Day 646 里 Bullish 和 CoinDesk 的 JD 原话是「GitHub, a writeup, a Loom walkthrough, a live URL. All count.」,你的链接就是敲门砖。

**招聘平台用来了解行情。** Boss 和猎聘上的挂牌价是很好的谈薪参考,今天的数据就是从那里来的。正常浏览就好,别用脚本批量抓,站长抓数据时 Boss 账号在第 78 条详情就被提示「账户存在异常行为」。

## 资深怎么谈

[Day 513](/blog/agent-zero/day-513-offer/) 讲过谈薪的基本方法。资深档有几处不一样,我把它们写成代码来算,数字全部是假设的,结构是真的。

### 先比总包,拆开比

国内 offer 常见的构成是月薪、薪数、年终奖、股票、签字费,创业公司还有期权。月薪最高的那个不一定最多。写 `part10/offer_compare.py`:

```python
# agent-zero-lab/part10/offer_compare.py
from dataclasses import dataclass

@dataclass
class Offer:
    name: str
    monthly_k: float          # 月薪,千元
    months: int               # 薪数
    bonus_months: float = 0   # 年终奖按几个月月薪算(假设能拿满)
    stock_wan: float = 0      # 股票授予总价值,万元
    vest_years: int = 4       # 几年归属完
    sign_on_wan: float = 0    # 签字费,只在第一年
    options: bool = False     # 创业公司期权,按 0 计

    def cash(self) -> float:
        return self.monthly_k * (self.months + self.bonus_months) / 10

    def year(self, n: int) -> float:
        stock = self.stock_wan / self.vest_years if n <= self.vest_years else 0
        sign = self.sign_on_wan if n == 1 else 0
        return self.cash() + stock + sign

if __name__ == "__main__":
    offers = [
        Offer("A 大厂", monthly_k=45, months=15, bonus_months=1, stock_wan=80),
        Offer("B 创业公司", monthly_k=60, months=13, sign_on_wan=10, options=True),
    ]
    for o in offers:
        years = [o.year(n) for n in range(1, 5)]
        note = "(期权按 0 计)" if o.options else ""
        print(f"{o.name:<8} 现金 {o.cash():5.1f} 万  前四年 " + " / ".join(f"{y:.1f}" for y in years)
              + f"  合计 {sum(years):.0f} 万{note}")
```

<div class="line-notes">

- `@dataclass` 自动生成构造函数,和 Day 641 的 `Assumptions` 一样。每个字段后面的注释写清单位,钱的单位一乱,比较就全错了。
- `bonus_months: float = 0   # 年终奖按几个月月薪算(假设能拿满)` 年终奖通常和绩效挂钩,不保证。比较时我按能拿满算,真实谈的时候要问清楚「去年这个职级的平均是几个月」。
- `vest_years: int = 4       # 几年归属完` 股票通常分四年归属(vesting),每年拿四分之一,有的公司第一年要满一年才拿第一笔(cliff)。
- `options: bool = False     # 创业公司期权,按 0 计` 期权要等公司上市或被收购才变成钱,很多永远变不成。比较 offer 时先按 0 算,练习 2 再算它要多大概率兑现才划得来。
- `return self.monthly_k * (self.months + self.bonus_months) / 10` A 是 `45 × (15 + 1) / 10 = 72` 万;B 是 `60 × 13 / 10 = 78` 万。只看现金 B 多 6 万。
- `stock = self.stock_wan / self.vest_years if n <= self.vest_years else 0` A 的股票 80 万分四年,每年 20 万。
- `sign = self.sign_on_wan if n == 1 else 0` 签字费只在第一年,第二年开始 B 的年包会掉一截。很多人比 offer 只看第一年,被签字费骗了。
- `years = [o.year(n) for n in range(1, 5)]` `range(1, 5)` 是 1、2、3、4,算前四年。

</div>

```bash
uv run python -m part10.offer_compare
```

```text
A 大厂     现金  72.0 万  前四年 92.0 / 92.0 / 92.0 / 92.0  合计 368 万
B 创业公司   现金  78.0 万  前四年 88.0 / 78.0 / 78.0 / 78.0  合计 322 万(期权按 0 计)
```

B 的月薪高三分之一(60K 对 45K),第一年还有 10 万签字费,可四年下来 A 多 46 万。差距来自两处:A 的 15 薪加年终,和每年 20 万的股票。这就是为什么谈之前一定要把每个 offer 拆开、算到四年:「15 薪和 12 薪的同一个月薪,年包差 25%」这种事,只看月薪数字是看不出来的。

股票也要问清楚:是限制性股票(RSU)还是期权,授予价格,归属节奏,有没有 cliff,离职时没归属的怎么处理,公司股票能不能卖。

### 先谈职级,再谈薪资

很多公司的薪资带宽(band)按职级定,同一个职级里谈出来的差距有限,职级差一档,整个带宽都不一样。上面那张表也说明了这一点:决定薪资的是职位,不是年限。

练习 1 会用代码算一个例子:假设 L5 的带宽是 50 到 70 万,L6 是 70 到 100 万,每年调薪 8%、同一职级封顶。在 L5 里把起薪谈到顶的 70 万,四年后还是 70 万,合计 280 万;以 L6 最低的 70 万入职,四年后到 88 万,合计 315 万。**起薪一样,四年差 35 万**,而且下一次晋升的起点也不同。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="同样 70 万起薪,L5 封顶和 L6 继续上涨的对比">
<text x="20" y="20" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">年包(万元,假设)  · 每年调薪 8%,同一职级封顶</text>
<rect x="80" y="40" width="520" height="60" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="56" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">L6 带宽 70–100</text>
<rect x="80" y="100" width="520" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">L5 带宽 50–70</text>
<polyline points="140,100 290,100 440,100 590,100" fill="none" stroke="var(--mem)" stroke-width="2.5"/>
<polyline points="140,100 290,89 440,77 590,64" fill="none" stroke="var(--compute)" stroke-width="2.5"/>
<circle cx="590" cy="64" r="4" fill="var(--compute)"/>
<circle cx="590" cy="100" r="4" fill="var(--mem)"/>
<text x="580" y="40" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">L6:第四年 88</text>
<text x="580" y="116" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">L5:一直 70</text>
<text x="140" y="165" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">第 1 年</text>
<text x="290" y="165" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">第 2 年</text>
<text x="440" y="165" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">第 3 年</text>
<text x="590" y="165" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">第 4 年</text>
<text x="320" y="195" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">起薪一样,四年合计 280 对 315</text>
</svg>
<figcaption>同样 70 万入职。在 L5 已经是带宽顶部,调薪被封住;在 L6 是带宽底部,每年还能涨。职级被定低时,把力气花在争取重新评估职级上,比在低职级里死磕几万块值得。</figcaption>
</figure>

所以面试结束后的第一件事,是问清楚对方打算给什么职级、依据是什么。如果你认为被低定了,用你的作品和面试表现争取重新评估,而不是在低职级里抠薪资数字。各家职级名称不同,问清楚它在对方体系里对应什么范围的职责。海外公司可以在 levels.fyi 上看职级和总包的对照。

### 用数据锚定,别虚构 offer

**用数据锚定。** 今天的表就是锚点。如果你瞄准的是资深职位名那一档,中位 66 万到 72 万,P75 88 万到 104 万(看你怎么数「高级」)。期望可以落在中位到 P75 之间,并给出理由:你的作品、你解决过的问题的规模、你能带来的结果。说「我希望在 80 到 90 万之间,因为我做过多租户 Agent 网关和带统计检验的评测平台,这正是这个岗位的核心职责」,比单报一个数字有力得多。记住这是挂牌价,上沿往往要很强的候选人才拿得到。

**有竞争 offer 才提,不要虚构。** 手里有别的 offer 是最有力的筹码,但资深圈子小,被拆穿的代价很大。

**问清楚职责和预期。** 入职前半年对方期望你交付什么,你有多少自主权,向谁汇报,团队几个人。这些问题的答案比几万块的差距更影响你接下来两年过得怎么样。

**留在现公司也是一个选项。** 拿着市场数据和外部 offer 和现在的老板谈晋升或调薪,有时比跳槽划算,特别是你在现公司已经积累了信任和上下文。但不要拿一个你并不打算接的 offer 去威胁老板,这通常会伤害信任。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1VL6TY7E3V&autoplay=0&high_quality=1" title="高级程序员谈薪技巧!避雷话术!建议收藏!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>极海Channel · 高级程序员谈薪技巧!避雷话术!建议收藏! · 6 分钟。讲资深候选人谈薪时常见的话术坑,和上面的几条对照着看。</figcaption>
</figure>

## 第十部分之后

明天开始第十一部分,做两个作品:Agent Loupe(给 Agent 用的运行记录调试器)和 BillSleuth(查账的计费争议调查 Agent),两个都是能放在个人网站上让招聘方在线试用的东西。它们正好补自检表上最难补的两行:前沿判断和影响力,因为你会开源它们、给它们写文章。

再往后,值得想一下自己往哪个方向深挖一年。大概有四条路,挑一条:

**专精一个领域。** 评测、安全、语音 Agent、代码 Agent、浏览器 Agent,任选一个做到团队里最懂的人。JD 里这些方向都已经有专门的岗位,比如美团的「Agent 可靠性技术专家」、网易的「LLM Agent Memory 专家」、Cohere 的「Safety and Security for Agents」。

**往平台和基础设施走。** 如果你做 AgentOps 网关、自部署那几周最来劲,可以往 AI 平台工程或推理基础设施方向走。门槛更高,岗位更稀缺,上沿也更高。

**往产品走。** 如果你在 Day 619、620 讲 Agent 产品那两天特别有感觉,可以考虑做 AI 产品的技术负责人。懂工程的 AI 产品经理非常少。

**往管理走。** 如果 Day 645 带人那部分最有成就感,可以考虑技术管理。不过 Staff 这条技术路线也能走得很远,不是只有转管理才算晋升。

保持更新的信息源,每周花两三个小时就够:Simon Willison 的博客(LLM 工具和实践的第一手记录)、Latent Space(AI 工程师的播客和通讯)、Anthropic 和 OpenAI 的工程博客、Hamel Husain 和 Eugene Yan 的博客(评测和 LLM 系统)、Hugging Face Papers(每周扫一眼标题)。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LCEmiRjPEtQ" title="Andrej Karpathy: Software Is Changing (Again)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Y Combinator · Andrej Karpathy: Software Is Changing (Again) · 40 分钟。Karpathy 讲 Software 3.0 和 Agent 时代的软件,适合在第十部分结束这天看,想想你接下来想站在这个变化的哪个位置。B 站有中文字幕版,见学习资料。</figcaption>
</figure>

## 今天的文件

| 文件 | 干什么 | 花钱吗 |
| --- | --- | --- |
| `notes/self-check.md` | 十行资深自检表 | 不花 |
| `part10/self_check.py` | 检查自检表每一行有没有证据 | 不花 |
| `part10/samples/senior_pay.json` | 16 条资深档真实 JD 的薪资 | 不花 |
| `part10/pay_stats.py` | 薪资字符串折算年包,算分位数 | 不花 |
| `part10/offer_compare.py` | 把两个 offer 拆开算到四年 | 不花 |
| `part10/ex648_*.py`(练习) | 练习的参考答案 | 不花 |

今天不调模型,花费 0。

## 动手练习

**练习 1:职级和薪资哪个值钱。** 假设 L5 带宽 50–70 万,L6 带宽 70–100 万,每年调薪 8%,同一职级里调到带宽上限就封顶。比较两种情况的前四年年包:在 L5 把起薪谈到顶 70 万;以 L6 最低的 70 万入职。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex648_level.py
BANDS = {"L5": (50, 70), "L6": (70, 100)}  # 年包带宽,万元(假设)
RAISE = 0.08                               # 每年调薪 8%(假设),同一职级封顶在带宽上限

def path(level: str, start: float, years: int = 4) -> list[float]:
    top = BANDS[level][1]
    out, pay = [], start
    for _ in range(years):
        out.append(round(pay, 1))
        pay = min(pay * (1 + RAISE), top)
    return out

l5_top = path("L5", 70)
l6_low = path("L6", 70)
print("L5 谈到顶 70 万:", l5_top, "合计", round(sum(l5_top)))
print("L6 从底部 70 万:", l6_low, "合计", round(sum(l6_low)))
```

<div class="line-notes">

- `BANDS = {"L5": (50, 70), "L6": (70, 100)}  # 年包带宽,万元(假设)` 字典的值是元组(下限,上限)。真实的带宽各家不同,也不公开,这里只演示结构。
- `top = BANDS[level][1]` 取上限,`[1]` 是元组的第二个元素。
- `for _ in range(years):` 变量名用 `_` 表示「这个循环变量我不用」,≈ JS 里写 `for (let i = 0; ...)` 却不用 i。
- `pay = min(pay * (1 + RAISE), top)` 涨 8%,但不能超过带宽上限。L5 从 70 开始,`70 × 1.08 = 75.6`,被 `min` 压回 70。

</div>

```bash
uv run python -m part10.ex648_level
```

```text
L5 谈到顶 70 万: [70, 70, 70, 70] 合计 280
L6 从底部 70 万: [70, 75.6, 81.6, 88.2] 合计 315
```

起薪一模一样,四年差 35 万。L5 那条路其实更糟:在带宽顶部的人,公司很可能连调薪都给得很少,四年里你一直是「这个职级里最贵的人」,裁员名单上也更显眼。真实情况里,带宽、调薪比例、晋升节奏都要问,但结论的方向不会变:职级定低了,先争职级。

</details>

**练习 2:期权要多大概率兑现才划算。** 假设 B 创业公司的期权按最近一轮估值算,纸面价值 100 万。期权兑现的概率分别是 0、10%、30%、50% 时,B 的四年期望总包是多少?概率要多少才和 A 打平?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex648_options.py
from part10.offer_compare import Offer

a = Offer("A 大厂", monthly_k=45, months=15, bonus_months=1, stock_wan=80)
b = Offer("B 创业公司", monthly_k=60, months=13, sign_on_wan=10, options=True)
paper = 100  # B 的期权按最近一轮估值算的纸面价值,万元(假设)

total_a = sum(a.year(n) for n in range(1, 5))
total_b = sum(b.year(n) for n in range(1, 5))
for p in (0, 0.1, 0.3, 0.5):
    print(f"期权兑现概率 {p:.0%}:B 期望合计 {total_b + paper * p:.0f} 万,A {total_a:.0f} 万")
print(f"打平需要的概率:{(total_a - total_b) / paper:.0%}")
```

<div class="line-notes">

- `from part10.offer_compare import Offer` 复用正文的类。`offer_compare.py` 的打印代码在 `if __name__ == "__main__":` 下面,导入时不会执行。
- `total_b + paper * p` 期望值 = 纸面价值 × 兑现概率。这是最简化的模型,没算行权要花的钱、税和稀释。
- `print(f"打平需要的概率:{(total_a - total_b) / paper:.0%}")` `(368 - 322) / 100 = 0.46`,`:.0%` 格式化成 46%。

</div>

```bash
uv run python -m part10.ex648_options
```

```text
期权兑现概率 0%:B 期望合计 322 万,A 368 万
期权兑现概率 10%:B 期望合计 332 万,A 368 万
期权兑现概率 30%:B 期望合计 352 万,A 368 万
期权兑现概率 50%:B 期望合计 372 万,A 368 万
打平需要的概率:46%
```

纸面 100 万的期权,要有接近一半的概率按这个估值兑现,B 才和 A 打平。创业公司能做到的不多。这不是说不该去创业公司,去那里的理由应该是职责、成长和你相信这件事,而不是期权数字。谈的时候用这个算式和对方聊:「按这个估值,期权要多大概率兑现才能弥补现金差」,比「我觉得期权不值钱」专业得多。

</details>

**练习 3:填你自己的自检表。** 把 `notes/self-check.md` 换成你真实的证据,跑 `self_check.py`。填不上的每一行,在旁边写一个补齐计划:做什么、产出什么文件、哪天之前。

<details><summary>参考答案</summary>

这道题的结果因人而异,我没法替你跑。验收看三点:

一是每一行要么是「有」,要么在表下面有一条补齐计划,比如「安全:把 Day 637 的 promptfoo 红队用例接进 CI,截图存到 `agentops/docs/redteam-ci.png`,11 月 15 日前」。计划要具体到文件名和日期,「多学学安全」不算。

二是「影响力」那一行不能是占位符。如果你还没有被合并的 PR,放 Day 646 准备好的 issue 链接或者 Day 647 的文章链接,都算。

三是对着每个「有」问自己一个追问,看能不能答上来:评测报告的样本量多少、区间多宽;网关压测的 P95 是多少、容量结论是什么;ADR 里哪一条后来被推翻了、为什么。答不上来的,就算文件在,也改成「要补」。

如果「有」不到 7 行,我的建议是先按中高级岗位投,同时按计划补;7 行以上就可以开始投资深岗了,剩下的边面试边补。资深岗位的要求永远没有人能百分之百满足。

</details>

**练习 4:写你的谈薪开场。** 按你的年限、城市、目标职级,从今天的表里找到对应的中位和 P75,写一段不超过 100 字的回答,回应 HR 的「你的期望薪资是多少」。要包含一个区间、一个数据依据、两条和岗位职责对应的成果。

<details><summary>参考答案</summary>

开放题,给一个示范,数字换成你自己的:

> 我希望总包在 80 到 90 万之间。我看了一下目前带资深或专家头衔的 Agent 岗位,挂牌中位大概在 70 万上下,上四分位在 90 到 100 万。我做过多租户的模型网关和带统计检验的评测平台,这两块正好是这个岗位写的核心职责。另外想先确认一下,这个岗位对应你们的哪个职级?

几个要点:给区间不给单点,下限是你真能接受的数;数据依据说清楚是「挂牌」,不要把挂牌价说成市场成交价;成果和对方 JD 的职责对上;最后一句把话题引到职级上,这是今天最重要的一条。不要提你现在的薪资,也不要编一个不存在的竞争 offer。

写完念一遍,控制在 30 秒以内。

</details>

**验收标准**:`self_check.py`、`pay_stats.py`、`offer_compare.py` 跑出和文中一致的结果;你自己的自检表每行都有证据或补齐计划;能说出今天薪资数据的三条局限(挂牌价不是成交价、每组只抓第一页、「高级」两个字用得随意);能解释同样 70 万起薪为什么 L6 四年多 35 万;一段 30 秒以内的谈薪开场。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 挂牌薪资 | 招聘方在 JD 上写的薪资区间,不是最终成交价 |
| P25 / P50 / P75 | 把样本从低到高排好,第 25%、50%、75% 位置的值,P50 就是中位数 |
| 分位数插值 | 切点落在两个样本之间时按比例取中间值,`method="inclusive"` 和 Excel 的 `QUARTILE.INC` 一致 |
| 总包(TC) | Total Compensation,月薪 × 薪数 + 年终 + 股票 + 签字费的总和 |
| 归属(vesting) | 股票或期权分几年、按什么节奏真正归你,常见四年 |
| cliff | 归属的门槛期,常见是满一年才拿到第一笔 |
| RSU | 限制性股票,归属后直接是股票,上市公司常见 |
| 期权 | 以约定价格买公司股票的权利,公司上市或被收购前通常变不成现金 |
| 签字费 | 入职时一次性给的钱,只影响第一年 |
| 职级带宽(band) | 某个职级对应的薪资范围,同职级里能谈的空间有限 |
| 内推 | 公司员工推荐候选人,资深岗位的主要来源之一 |
| EOR / 合同工 | 通过第三方雇佣或以合同形式给海外公司远程工作 |

## 常见误区

**把学过当成会了。** 自检表打勾的标准是能拿出文件或链接,不是看过那几天。今天 `self_check.py` 专门把「路径不存在」和「占位符」挑出来,就是防这个。

**拿年限对标薪资。** 数据里要求 5–10 年的岗位中位 54 万,和整体 48 万差不多;职位名真带资深字样的中位 72 万。决定薪资的是职位和职级,不是你干了几年。

**把「高级」当成资深。** 只写「高级」的 16 条中位 48 万,和整体一样。看到一个「高级 XX 工程师」的 JD,先看职责再判断是不是你要的那一档。

**只比月薪或第一年。** 示例里 B 的月薪高三分之一、第一年还有签字费,四年下来却少 46 万。至少算到四年,把股票和签字费拆开。

**把期权当现金。** 纸面 100 万的期权要接近一半的概率按这个估值兑现,B 才和 A 打平。先按 0 算,再单独算它要多大概率才值得。

**只谈数字不谈职级。** 职级定低了,同一个带宽里怎么谈都有限,晋升也从低处起步。

**对海外远程有不切实际的预期。** 46 条里只有 3 条不限地区,两个远程 Staff 样本都限美加。当成一两年的目标,用公开影响力慢慢接近。

**觉得自己还没准备好。** 资深岗位的要求没人能百分之百满足。自检表七成有证据,就可以开始投了。

## 学习资料

### 文档与文章

- [880 条真实 JD 拆解](/blog/agent-jd-report-2026-10/):今天所有薪资和远程数字的出处,「国内薪资、学历、年限」一节有更细的分组。
- [StaffEng:Getting the title where you are](https://staffeng.com/guides/getting-the-title-where-you-are/):在现公司晋升到 Staff 的方法,如果你打算先在内部争取,先读这篇。
- [StaffEng:Promo packets](https://staffeng.com/guides/promo-packets/):怎么整理晋升材料,思路和今天的自检表一样,每条主张都配证据。
- [levels.fyi](https://www.levels.fyi/):海外和部分国内公司的职级和总包数据,看职级对照和总包构成。对脚本返回 403,需要浏览器打开。
- [MyCareersFuture](https://www.mycareersfuture.gov.sg/):新加坡政府职位库,职位都带月薪区间,看新加坡行情用。
- [Latent Space](https://www.latent.space/)、[Simon Willison 的博客](https://simonwillison.net/)、[Hamel Husain](https://hamel.dev/)、[Eugene Yan](https://eugeneyan.com/):第十部分之后保持更新的几个主要来源。
- [Anthropic Engineering](https://www.anthropic.com/engineering):Agent 相关的工程实践很多出自这里。
- [Hugging Face Papers](https://huggingface.co/papers):每日热门论文,扫标题用。

### B 站视频

- 极海Channel《高级程序员谈薪技巧!避雷话术!建议收藏!》已经嵌在正文里。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1iS4y1h7m3&autoplay=0&high_quality=1" title="如何谈薪?面试千人大厂HR,教你【谈薪必胜法】搞钱!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>网易招聘 · 如何谈薪?面试千人大厂HR,教你【谈薪必胜法】搞钱! · 12 分钟。大厂 HR 视角讲谈薪,知道桌子对面的人怎么想、手里有多大空间。</figcaption>
</figure>

- Web3天空之城,《大神Andrej Karpathy最新演讲:AI时代的软件》(BV1CLNtzyEP4),40 分钟,正文里那个 Karpathy 演讲的中文字幕版。

### 其他经典视频

- Y Combinator 的 Karpathy 演讲已经嵌在正文里。
- Sequoia Capital,《Andrej Karpathy: From Vibe Coding to Agentic Engineering w/ Stephanie Zhan》(YouTube ID 96jN2OCOfLs)。Karpathy 讲从 vibe coding 到 agentic engineering 的转变,和资深 Agent 工程师要做的事很契合。

### 书籍

- Tanya Reilly,《The Staff Engineer's Path》,O'Reilly,2022。有繁体中文版《Staff 工程師之路》。读第三部分 Leveling Up,讲资深之后怎么继续成长。
- Camille Fournier,《The Manager's Path》,O'Reilly,2017。考虑往管理走就通读。中文版的书名和出版社我没能核实,按英文名找。
- Chris Voss,《Never Split the Difference》,HarperBusiness,2016。中文版书名《掌控谈话》。读讲锚定和提问的章节,谈薪前看。

### 开源项目与代码

- 你自己的 `agentops/` 和 `supportpilot/`:按 Day 647 的 `release_check.py` 检查一遍,整理成公开版本,README 里放上设计文档、评测报告和演示视频的链接,这是最好的简历附件。
- [anthropics/courses](https://github.com/anthropics/courses):Anthropic 官方课程仓库,第十部分学完可以用它查漏补缺。

## 自测

1. 自检表上「评测体系」这一行,什么样的证据算合格?

<details><summary>答案</summary>

一个能跑的评测平台(离线回归、judge 管理),加一份真实的评测报告:样本量、指标、Wilson 区间、两个版本的配对比较,以及 judge 和人工标注的一致率。只写「做过评测」或者只有一个分数不算,面试官问到样本量和显著性时答不上来。`self_check.py` 只能查文件在不在,内容合不合格要你自己用追问检验。

</details>

2. 国内资深档的挂牌年包大概多少?这组数字有哪些局限?

<details><summary>答案</summary>

职位名带资深、专家、架构师、高级、负责人等字样的 49 条:P25 48 万,中位 66 万,P75 88 万,37% 在 80 万以上;去掉只写「高级」的,33 条中位 72 万、P75 104 万。局限:是挂牌区间中点不是成交价;每个关键词和城市只抓了第一页,受平台推荐影响;「高级」在国内 JD 里用得随意,筛法很粗;10 年以上只有 7 条,不能代表市场。

</details>

3. 为什么说年限不怎么决定薪资?这对谈薪有什么启发?

<details><summary>答案</summary>

数据里要求 5–10 年的 107 条中位 54 万,和全部 557 条的 48 万相差不大;职位名真带资深字样的中位 72 万。薪资主要跟着职位和职级走。所以谈薪时不要拿「我有 8 年经验」当筹码,而要争取对的职级,用作品和面试表现说明你能承担那个职级的职责。练习 1 里同样 70 万起薪,L6 比 L5 四年多 35 万。

</details>

4. 两个 offer:A 月薪 45K × 15 薪、年终 1 个月、股票 80 万分四年;B 月薪 60K × 13 薪、签字费 10 万、有期权。怎么比?

<details><summary>答案</summary>

拆开算到四年。A 现金 `45 × 16 / 10 = 72` 万,加每年股票 20 万,每年 92 万,四年 368 万。B 现金 `60 × 13 / 10 = 78` 万,第一年加签字费 10 万,四年 322 万,期权先按 0 算。A 多 46 万。再单独算期权:纸面 100 万的话,要 46% 的概率按这个估值兑现才打平。另外问清楚年终是否保证、股票的归属节奏和 cliff、离职时未归属部分怎么处理。

</details>

5. 面试题:你为什么觉得自己适合资深 Agent 工程师这个职位?接下来一年想在哪个方向深入?

<details><summary>答案</summary>

用证据回答,不用形容词。挑两三个最有说服力的成果:设计并上线了什么系统、规模多大、用什么评测证明效果(样本量和区间)、推动了多少团队采用、带来了什么业务结果(成本、效率、质量)。然后讲深挖方向和理由,最好和对方团队的方向有交集。最后可以坦诚说一个还在补的短板和补的计划,比假装全能可信。如果有公开的 PR、文章或分享,顺手给链接,这是面试官能自己验证的东西。

</details>

6. 你人在国内,目标是海外远程 Staff 岗。根据数据,现实的路径有哪些?

<details><summary>答案</summary>

46 条海外远程岗里只有 3 条不限地区,两个远程 Staff 样本(GC AI、Mozilla/Thunderbird)都限美加。现实路径:先在国内拿资深岗,积累经验和作品;考虑新加坡或香港的岗位(要搬家);通过开源贡献、技术文章、社区参与让海外团队先找到你,以合同工或第三方雇佣(EOR)的形式合作。把它当一两年的目标,不是下个月靠投简历能达成的计划。

</details>

## 明天预告

第十部分到这里结束。明天是 Day 649,第十一部分开始:Loupe 开题(一):调 Agent 痛在看不清每一步,现有工具做到哪。我们先做 Agent Loupe,一个给 Agent 用的运行记录调试器,第一天先把痛点说清楚,再把 Langfuse、LangSmith 这些现有工具摆在一张竞品表里,看它们做到了哪一步、还缺什么。它会补上今天自检表里最难补的「前沿判断」和「影响力」两行,因为做完你会把它开源,再给它写一篇文章。
