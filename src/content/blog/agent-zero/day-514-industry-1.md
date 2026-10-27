---
title: 'Day 514 · 行业里的 Agent(一):JD 行业分布和换行业的五样东西'
description: '投出去的岗位不全是 SaaS 客服:银行要做投研助手,医院要做病历质控,电商要做商家客服。先用正则数一数 JD 里提到了哪些行业,抽 20 条看这个统计误判了多少;再讲换行业时同一套 SupportPilot 骨架要换的五样东西(知识源、工具、红线、验收指标、出错代价),并把它写成一个能检查「红线有没有落到代码层」的小工具。'
pubDate: 2026-10-27
regime: none
tags: ['industry', 'regex', 'dataclass', 'interview', 'agent-zero']
series: 'agent-zero'
day: 514
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 513](/blog/agent-zero/day-513-offer/) 讲了投出去以后的四件事:面试流程、用 `Offer` 把月薪和公积金和期权拆开算清楚、用规则筛掉培训贷这类坑、用投递漏斗找卡点。到这里,国内和海外的找工作流程都过了一遍。

今天回头看一个你投简历时会越来越明显的问题:岗位不全是 SaaS 客服。银行要做投研助手,医院信息科要做病历质控,电商公司要做商家客服。面试官常常问的不是「你会不会写 Agent 循环」,而是「你这套东西搬到我们这儿要改什么」。今天和明天两天专门准备这个回答:今天先数行业、再讲换行业要换的五样东西,明天拆四个具体行业。

## 今天要解决的问题

今天结束时你应该能:

1. 用正则数出 JD 里提到哪些行业,说清这个数字是怎么数出来的、粗糙在哪,并且自己抽样算一个误判率。
2. 用「知识源、工具、红线、验收指标、出错代价」五项拆任何一个行业的 Agent 场景。
3. 把五项写成一个 `IndustryProfile`,用 `validate` 检查「红线是不是只放在了提示词里」。
4. 说出 SupportPilot 的骨架里哪些模块换行业时原样保留、哪些要重做。

预计用时 2.5 小时。前置:[Day 511](/blog/agent-zero/day-511-job-channels/) 的口径意识(一个数字要问来源);[Day 498](/blog/agent-zero/day-498-resume-1/) 的正则关键词;[Day 50](/blog/agent-zero/day-050-dataclass/) 的 `dataclass`;SupportPilot 的整体结构([Day 441](/blog/agent-zero/day-441-repo-init/) 起搭、到 [Day 490](/blog/agent-zero/day-490-deploy-demo/) 上线),今天只引用它的模块,不需要再翻代码。今天不调模型,花费 ¥0。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `count`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先看数据:JD 里提到哪些行业

要回答「哪些行业在招 Agent 工程师」,最直接的做法是把岗位正文拿来数。站长在 2026 年 10 月 12 日抓了 880 条 Agent 岗位(国内 695、海外 185,来源和局限见 [Day 511](/blog/agent-zero/day-511-job-channels/)),其中**有正文的**国内 331 条、海外 185 条。国内另外的 364 条是 Boss 列表里只有标题和薪资的记录,没有正文,数不了。

这个统计的口径要先说清,因为它很粗:

- 方法是用关键词正则匹配「职位名 + 正文」,命中一次就算这个行业。
- JD 正文里常有公司介绍。一家大公司写一句「服务金融、电商、游戏等行业」,就会同时命中三个行业。所以它数的是「JD 里**提到**了这个行业」,不是「这个岗位**做**这个行业」。
- 一条 JD 可以同时命中几个行业,百分比加起来不等于 100%。

原始数据没有公开(里面有招聘方信息),所以我从里面挑了 17 条,**只保留岗位名和命中关键词前后各 70 个字左右的片段**,去掉了公司名,放在 `part09/industry/jd_sample.json`。**这份样本是我专门挑的:17 条里 10 条来自「金融」命中,为了让后面抽样看误判时有东西可看。所以在它上面算出的比例没有任何意义,只用来让代码跑起来。** 全量数据上的结果,我在原始文件上跑了同一份代码,单独给你。

先建目录:

```bash
cd agent-zero-lab
mkdir -p part09/industry
touch part09/industry/__init__.py
```

`part09/industry/jd_sample.json`,可以直接复制:

```json
{
 "domestic": [
  {
   "region": "domestic",
   "title": "AI应用工程师",
   "text": "地，推动 AI 技术在⼆级市场等⾦融业务场景中的应⽤。 2. 结合业务需求，建设和优化以下 AI 应⽤场景： o 企业知识库与智能问答 o 投研信息检索与分析 o 研报摘要与内容⽣成 o 智能办公助⼿ o 数据分析与⼯作流⾃动化 o AI Agent 智能体应⽤等 3. 负责 AI ",
   "id": 1
  },
  {
   "region": "domestic",
   "title": "（央企）AI大模型与智能体应用研发工程师",
   "text": "发经验者优先。 3.具有智能体产品从设计到落地的完整项目经验者优先。 4.具有开源项目贡献或技术博客/论文发表者优先。 福利待遇： 补充医疗保险、企业年金；免费提供3餐；取暖补贴；劳动保护用品费；各种节假日福利、工会福利等；园区有地下停车场、健身房、羽毛球场地、乒乓球场地、洗衣房、理",
   "id": 2
  },
  {
   "region": "domestic",
   "title": "易盾-agent安全工程师",
   "text": "erver、开源组件、模型等引入的风险，实现依赖审查、来源校验、权限隔离等防护能力。 4、基于安全业务场景设计落地Agent安全方案，将业务风控、数据安全、威胁检测、事件响应、溯源分析、告警研判等核心流程实现Agent Native端到端自动化处置。 要求:1、本科及以上学历，计算机",
   "id": 4
  },
  {
   "region": "domestic",
   "title": "AI应用工程师",
   "text": "发框架，具备基本的测试、部署和运行维护能力。 5.具备良好的业务理解、沟通协作和自主学习能力，能够与产品经理、业务专家共同推进应用落地；具有保险、医疗或金融行业项目经验者优先。",
   "id": 5
  },
  {
   "region": "domestic",
   "title": "AI Agent开发工程师 (MJ000082)",
   "text": "岗位职责 1. 开发生产级 AI Agent应用：金融文档理解与信息抽取、材料起草、数据缺口与异常识别、多步骤业务流程编排等； 2. 建设 Agent 的工程规范与治理机制：工具与权限控制、状态",
   "id": 6
  },
  {
   "region": "domestic",
   "title": "AI大模型应用开发工程师",
   "text": "领域能力：知识图谱与图检索（GraphRAG）、多模态文档解析（图文、扫描件、复杂表格）、OCR 后处理。 · 行业背景：政企、能源、交通、金融、制造、教育等 toB 场景，或企业内部管理系统建设经验。 · 自建过评测集或自动化评测流水线；有开源项目、技术文章或可复现的公开成果。 四",
   "id": 7
  },
  {
   "region": "domestic",
   "title": "AI Agent开发工程师",
   "text": "on Calling 及结构化输出等； 6、参与智能体运行组件建设，包括工具注册与执行、状态管理、任务调度、链路追踪及运行监控等； 7、面向银行、证券、保险等金融行业场景，参与需求分析、方案设计和智能体应用开发； 8、协助售前交流及 POC 项目，参与场景设计、数据准备、系统搭建、效",
   "id": 8
  },
  {
   "region": "domestic",
   "title": "AI应用工程师",
   "text": "AI应用工程师 职位描述： 1.业务价值挖掘：深入投研、风控、合规、交易支持、运营、营销等业务线，找到AI真正能创造价值的地方，并推动落地； 2.底层能力搭建：具备搭建Agent、Tool Ca",
   "id": 10
  },
  {
   "region": "domestic",
   "title": "AI 智能体工程师",
   "text": "工作职责 (1) 负责企业级医疗 AI Agent 架构设计、开发、测试上线，实现 Single/Multi Agent、Workflow、ReAct 等智能体架构。 (2",
   "id": 12
  },
  {
   "region": "domestic",
   "title": "AI Agent 开发-电商C端导购/评价/助手/AIGC",
   "text": "工作职责： 1、负责电商C端场景基于AI的核心功能开发与优化，包括但不限于直播助手、内容、导购、评价、推荐等AI落地场景，通过AIGC的能力驱动交易业务增长，⽤好A",
   "id": 13
  },
  {
   "region": "domestic",
   "title": "AI Agent 工程师",
   "text": "出等核心机制；深度参与过以下至少一类产品的真实交付，能讲清系统设计与线上问题：AI Agent、Copilot、AI 编程助手等智能体产品/智能客服、语音助手、对话系统 / AI 角色互动等对话类产品/办公 / 个人智能助理，或 RAG 知识库问答、企业搜索等大模型应用/工作流编排引擎、",
   "id": 16
  },
  {
   "region": "domestic",
   "title": "AI Agent开发工程师",
   "text": "年 学历:本科 基础研发平台是美团的核心技术平台，立足于“零售+科技”的战略定位，通过打造人工智能、大数据、云计算、安全等核心技术能力，以及研发效能平台、企业应用平台等公共服务，为业务提供稳定安全、扩展易用、技术领先的平台技术和产品服务。 在这里，我们会参与到最前沿的技术研发和探索；能够",
   "id": 17
  }
 ],
 "overseas": [
  {
   "region": "overseas",
   "title": "AI Engineer-Chatbot/Agent",
   "text": "力，能够驱动产品、数据、工程等协同交付。 7、有智能客服、对话助手、DataAgent等方向经验者优先 你将获得 1、深度参与Web3支付/金融行业核心场景的大模型落地机会。 2、与优秀算法、工程、产品团队共同探索 AI Native 应用的机会。 3、充分接触前沿 LLM、Agen",
   "id": 3
  },
  {
   "region": "overseas",
   "title": "AI Engineer",
   "text": "ment (RCM): eligibility, claim status, claim submission, denials, and payment posting. We're live in production with paying enterprise customers. O",
   "id": 9
  },
  {
   "region": "overseas",
   "title": "AI Engineer (招聘帖里的一条)",
   "text": "e building AI agents to expand access to affordable, and high quality healthcare. We run a vertically integrated primary and urgent care clinic and ar",
   "id": 11
  },
  {
   "region": "overseas",
   "title": "Senior Product Engineer | REMOTE [Europe",
   "text": "ilds AI, AR and computer-vision personalization for beauty brands and retailers: skin analysis, virtual try-on and product recommendations. We wor",
   "id": 14
  },
  {
   "region": "overseas",
   "title": "AI Engineer (招聘帖里的一条)",
   "text": "e fully remote in the countries listed unless otherwise specified. [1]Customer Support Engineer • Poland • Full time [2]Senior Software Engineer (Multiple T",
   "id": 15
  }
 ]
}
```

### 数行业的脚本

```python
# agent-zero-lab/part09/industry/jd_industry.py
import json
import re
import sys
from collections import Counter
from typing import Any, cast

INDUSTRIES = {
    "金融": r"金融|银行|证券|保险|基金|信贷|理财|投研|风控|fintech|\bbank|insurance|payments?\b|trading|financial",
    "医疗健康": r"医疗|医院|医药|临床|诊疗|问诊|healthcare|medical|clinical|pharma|patient",
    "电商零售": r"电商|零售|商家|e-?commerce|retail|merchant",
    "客服": r"智能客服|客服|售后|customer support|customer service|contact center",
    "法律": r"法律|律师|法务|legal|law firm",
    "研发效能": r"代码生成|编程助手|研发效能|coding agent|code generation|developer tool",
}


def count(jobs: list[dict[str, Any]], min_len: int = 100) -> tuple[int, Counter[str]]:
    total = 0
    hits: Counter[str] = Counter()
    for job in jobs:
        text = ((job.get("title") or "") + " " + (job.get("text") or "")).lower()
        if len(text) < min_len:
            continue
        total += 1
        for name, pattern in INDUSTRIES.items():
            if re.search(pattern, text):
                hits[name] += 1
    return total, hits


def main(path: str) -> None:
    data = cast(dict[str, list[dict[str, Any]]], json.load(open(path, encoding="utf-8")))
    for region in ["domestic", "overseas"]:
        total, hits = count(data[region])
        print(f"{region}: {total} 条有正文")
        for name, n in hits.most_common():
            print(f"  {name:6} {n:4}  {n / total:.0%}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "jds.json")
```

<div class="line-notes">

- `INDUSTRIES = {` 行业名到正则的映射。中英文关键词写在一起,因为国内 JD 是中文、海外 JD 是英文,一个正则同时覆盖两边。这个写法和 [Day 498](/blog/agent-zero/day-498-resume-1/) 的关键词表是一种。
- `\bbank` `\b` 是「单词边界」,防止匹配到 `embankment` 这种词中间的 bank。它挡不住 `bankruptcy`,`re.search(r"\bbank", "bankruptcy")` 会命中,这是这个统计粗糙的又一处。同一行的 `payments?\b` 里 `s?` 表示 s 有没有都行,`payment` 和 `payments` 都命中。
- `"客服": r"智能客服|客服|` 「智能客服」其实已经被「客服」包含了,写在前面只是让读的人一眼看出意图,对结果没有影响。
- `def count(jobs: list[dict[str, Any]], min_len: int = 100)` 返回一个二元组:总条数和每个行业的命中数。`Any` 是因为 JSON 里每个字段可能是字符串也可能是 `None`。
- `hits: Counter[str] = Counter()` `Counter` 是计数用的字典,`hits["金融"] += 1` 键不存在时自动从 0 开始,不用先判断。
- `text = ((job.get("title") or "")` `or ""` 是因为有的记录 `text` 字段是 `None`,直接拼会报 `TypeError`。职位名和正文拼起来再 `.lower()`,英文关键词就不用管大小写。
- `if len(text) < min_len:` 少于 100 个字符的当作没有正文跳过。样本里的第 5 条(96 个字符)和第 12 条(96 个字符)就是这样被跳过的,17 条算出来是 15 条。
- `if re.search(pattern, text):` 只要出现一次就算命中。一条 JD 可以同时算进几个行业,所以百分比加起来超过 100%。
- `data = cast(dict[str, list[dict[str, Any]]], json.load(` `json.load` 返回的类型是 `Any`,`cast` 告诉类型检查器「我知道它是这个形状」,运行时什么也不做。这样编辑器里不会有红线。
- `for region in ["domestic", "overseas"]:` 国内和海外分开数,因为分母不同。
- `print(f"  {name:6} {n:4}  {n / total:.0%}")` `:6` 和 `:4` 是对齐宽度,`:.0%` 把 0.7 变成 `70%`。

</div>

```bash
uv run python -m part09.industry.jd_industry part09/industry/jd_sample.json
```

```text
domestic: 10 条有正文
  金融        7  70%
  电商零售      2  20%
  研发效能      2  20%
  医疗健康      1  10%
  客服        1  10%
overseas: 5 条有正文
  金融        2  40%
  客服        2  40%
  医疗健康      1  20%
  电商零售      1  20%
```

先看清:样本里国内只有 10 条,「金融」命中 7 条就是 70%。这个 70% 是我挑样本挑出来的,不是行业分布。接下来是在全量数据上跑同一份脚本的结果(`jds.json` 是站长的原始文件,你没有,所以这是我跑的):

```text
domestic: 331 条有正文
  研发效能     42  13%
  金融       39  12%
  客服       26  8%
  电商零售     23  7%
  医疗健康     17  5%
  法律        4  1%
overseas: 185 条有正文
  金融       47  25%
  医疗健康     19  10%
  研发效能     18  10%
  法律       10  5%
  客服        8  4%
  电商零售      6  3%
```

能读出来的东西不多,有三条相对稳:

**金融在海外特别突出。** 四分之一的海外 JD 提到金融,里面有支付和财务公司,有保险公司,也有银行的外包项目。**国内电商和客服的比例比海外高**,和国内大厂的业务结构一致。**医疗和法律在海外是国内的两倍以上**,但国内法律只有 4 条、海外只有 10 条,数字太小,别当成趋势,至多是个方向。

另外一个我自己最在意的数字,放在练习 2 里让你亲手跑出来:国内 331 条里有 217 条,也就是 66%,**一个行业都没命中**。大头是不分行业的 Agent 平台、Agent Infra、通用助手。所以别把行业当成唯一的筛子。行业知识的作用是:在一堆都会写 LangGraph 的候选人里,多一个区分点。

### 抽样看误判

「数出来 39 条金融」是个数字,「这 39 条里有几条真的做金融」才是它的可信度。写一个小脚本,把命中某个行业的 JD 随机抽出来,打印命中词前后的文字:

```python
# agent-zero-lab/part09/industry/fp_check.py
import json
import random
import re
import sys
from typing import Any, cast

from part09.industry.jd_industry import INDUSTRIES


def sample_hits(path: str, industry: str, k: int = 20, seed: int = 1) -> None:
    data = cast(dict[str, list[dict[str, Any]]], json.load(open(path, encoding="utf-8")))
    pat = re.compile(INDUSTRIES[industry])
    found: list[tuple[str, str, str]] = []
    for region in ["domestic", "overseas"]:
        for job in data[region]:
            title = job.get("title") or ""
            text = (job.get("text") or "")
            if len(title + text) < 100:
                continue
            m = pat.search((title + " " + text).lower())
            if m:
                s = (title + " " + text).replace("\n", " ")
                lo = max(0, m.start() - 25)
                found.append((region, title[:30], s[lo : m.end() + 25]))
    random.Random(seed).shuffle(found)
    print(f"{industry}: 共 {len(found)} 条命中,随机看 {k} 条")
    for i, (region, title, ctx) in enumerate(found[:k], 1):
        print(f"{i:>2} [{region[:3]}] {title}\n     …{ctx}…")


if __name__ == "__main__":
    sample_hits(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "金融")
```

<div class="line-notes">

- `pat = re.compile(INDUSTRIES[industry])` 复用上一个脚本里的正则,保证「抽样看的」和「统计数的」是同一个口径。
- `found: list[tuple[str, str, str]] = []` 每个命中记三样:地区、职位名、命中词前后的文字。
- `m = pat.search((title + " " + text).lower())` 只取第一次命中的位置。一条 JD 里金融词可能出现很多次,我们只关心第一次出现在什么语境里。
- `lo = max(0, m.start() - 25)` 命中位置往前退 25 个字符,但不能退到负数。`max(0, ...)` 保证下标不会小于 0。
- `found.append((region, title[:30], s[lo : m.end() + 25]))` 切片取命中词前 25 个到后 25 个字符。
- `random.Random(seed).shuffle(found)` 用固定种子的随机数生成器打乱,别人用同一个 `seed` 能得到同样的 20 条。不用 `random.seed(...)` 是因为那会改全局状态,`random.Random(seed)` 造一个独立的。
- `for i, (region, title, ctx) in enumerate(found[:k], 1):` `enumerate(..., 1)` 编号从 1 开始;括号里把二元组再解包成三个变量。
- `{region[:3]}` 取地区名的前 3 个字符,`domestic` 变成 `dom`,`overseas` 变成 `ove`。

</div>

```bash
uv run python -m part09.industry.fp_check part09/industry/jd_sample.json 金融
```

```text
金融: 共 9 条命中,随机看 20 条
 1 [dom] AI Agent开发工程师
     …态管理、任务调度、链路追踪及运行监控等； 7、面向银行、证券、保险等金融行业场景，参与需求分析、方案设计…
 2 [dom] AI应用工程师
     …AI应用工程师 职位描述： 1.业务价值挖掘：深入投研、风控、合规、交易支持、运营、营销等业务线，找到A…
 3 [ove] AI Engineer-Chatbot/Agent
     …向经验者优先 你将获得 1、深度参与Web3支付/金融行业核心场景的大模型落地机会。 2、与优秀算法、工…
 4 [dom] AI大模型应用开发工程师
     …OCR 后处理。 · 行业背景：政企、能源、交通、金融、制造、教育等 toB 场景，或企业内部管理系统建…
 5 [dom] AI Agent开发工程师 (MJ000082)
     …岗位职责 1. 开发生产级 AI Agent应用：金融文档理解与信息抽取、材料起草、数据缺口与异常识别、…
 6 [dom] AI应用工程师
     … AI 应⽤场景： o 企业知识库与智能问答 o 投研信息检索与分析 o 研报摘要与内容⽣成 o 智能办…
 7 [ove] AI Engineer
     …submission, denials, and payment posting. We're live in p…
 8 [dom] （央企）AI大模型与智能体应用研发工程师
     …或技术博客/论文发表者优先。 福利待遇： 补充医疗保险、企业年金；免费提供3餐；取暖补贴；劳动保护用品费…
 9 [dom] 易盾-agent安全工程师
     …基于安全业务场景设计落地Agent安全方案，将业务风控、数据安全、威胁检测、事件响应、溯源分析、告警研判…
```

样本里 9 条命中,我一条一条看:第 1、2、3、5、6 条是真的做金融业务(银行证券场景、投研风控合规、Web3 支付、金融文档理解、投研检索);第 4 条「行业背景:政企、能源、交通、金融、制造、教育等」只是在罗列行业;第 7 条是医疗收费场景里的「payment posting」;第 8 条命中的是「补充医疗保险、企业年金」,那是福利待遇,不是业务;第 9 条是「业务风控」,但上下文是安全工程师做威胁检测,和金融无关。所以 9 条里我判断 4 条不是。

这是在我挑的样本上。在全量数据上我跑了同一个脚本,随机看了 20 条金融命中,**我的人工判断是:14 条算金融场景(其中 1 条只是「保险、医疗或金融行业项目经验者优先」,算行业经验加分),5 条明显不是,1 条拿不准。** 5 条明显不是的包括:福利里的「补充医疗保险、企业年金」、安全岗里的「业务风控」、医疗收费里的「payment posting」、一句「个人的、职业的、财务的」的公司文化口号、一串罗列的行业。

所以全量表里的「金融 12% / 25%」大概要打个七折到八折看。这个误判率是抽了 20 条、我自己判断的结果,样本小、判断也有主观成分,拿它的数量级就够了,不要把「25%」当成「四分之一的海外 Agent 岗做金融」。

## 一个框架:换行业时要换的五样东西

SupportPilot 的骨架你已经很熟了:分类 → 检索知识库 → 调业务工具 → 起草回复 → 自检 → 敏感操作走审批 → 转人工。这条骨架在大部分行业都成立,真正要换的是五样东西。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="同一套 Agent 骨架,换行业时替换五个模块">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">骨架不变(SupportPilot)</text>
  <rect x="20" y="40" width="90" height="36" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="65" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">分类</text>
  <rect x="125" y="40" width="90" height="36" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="170" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">检索</text>
  <rect x="230" y="40" width="90" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="275" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">调工具</text>
  <rect x="335" y="40" width="90" height="36" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="380" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">起草+自检</text>
  <rect x="440" y="40" width="90" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="485" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">审批闸门</text>
  <rect x="545" y="40" width="75" height="36" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="582" y="63" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">转人工</text>
  <line x1="110" y1="58" x2="125" y2="58" stroke="var(--rule)"/>
  <line x1="215" y1="58" x2="230" y2="58" stroke="var(--rule)"/>
  <line x1="320" y1="58" x2="335" y2="58" stroke="var(--rule)"/>
  <line x1="425" y1="58" x2="440" y2="58" stroke="var(--rule)"/>
  <line x1="530" y1="58" x2="545" y2="58" stroke="var(--rule)"/>
  <text x="20" y="116" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">换行业要换的五样</text>
  <line x1="170" y1="76" x2="85" y2="136" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <line x1="275" y1="76" x2="205" y2="136" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <line x1="485" y1="76" x2="325" y2="136" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <line x1="380" y1="76" x2="445" y2="136" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <line x1="582" y1="76" x2="565" y2="136" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
  <rect x="30" y="136" width="110" height="64" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="85" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">① 知识源</text>
  <text x="85" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">帮助中心→研报</text>
  <rect x="150" y="136" width="110" height="64" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="205" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">② 工具</text>
  <text x="205" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">账单→持仓/病历</text>
  <rect x="270" y="136" width="110" height="64" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="325" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">③ 红线</text>
  <text x="325" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">落在哪一层</text>
  <rect x="390" y="136" width="110" height="64" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="445" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">④ 验收指标</text>
  <text x="445" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">解决率→召回率</text>
  <rect x="510" y="136" width="110" height="64" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
  <text x="565" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">⑤ 出错代价</text>
  <text x="565" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">退一单→处罚</text>
  <text x="20" y="236" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">五样决定了:你把时间花在提示词和检索上,还是花在审批、审计和评测上</text>
</svg>
<figcaption>SupportPilot 的骨架在多数行业里都能用,换的是知识源、工具、红线、验收指标、出错代价这五样。虚线表示这五样主要影响骨架里的哪一块。</figcaption>
</figure>

**知识源**:Agent 回答问题时能引用什么。客服是帮助中心文章,金融是研报、产品说明书、内部合规手册,医疗是诊疗指南和药品说明书,电商是商品详情页和售后规则。知识源决定了检索那一层的难度:帮助中心文章短而规整([Day 444](/blog/agent-zero/day-444-kb-generate/) 造的那 60 多篇),研报是带表格的长 PDF,药品说明书里有大量否定句和剂量数字,而向量检索对否定句不敏感。

**工具**:Agent 能读写哪些系统。客服查账单、开工单,金融查持仓和交易流水,医疗读医院信息系统和检验结果,电商查订单、物流、库存。工具的权限分级([Day 453](/blog/agent-zero/day-453-tools-registry/))在每个行业都要重做一遍,因为「写操作」的含义变了:客服里退一笔钱是写操作,医疗里往病历里写一句话就是写操作。

**红线**:哪些事情模型绝对不能自己做。重点是**规则写死在代码里,不靠提示词**。「提示词里写了不许承诺收益」的意思是:模型多数时候会听,少数时候不听,而你不知道哪一次。红线可以落在四个地方:提示词(只算提醒)、输出检查([Day 409](/blog/agent-zero/day-409-guardrails-1/) 讲的 guardrail)、工具层权限([Day 453](/blog/agent-zero/day-453-tools-registry/))、审批节点([Day 414](/blog/agent-zero/day-414-approval-design/))。面试时每说一条红线,都要能回答「它在代码的哪一层」。

**验收指标**:上线前后拿什么数字证明它有用。客服看解决率和转人工率,电商看转化率,医疗更在意漏报(该提醒的没提醒)而不是准确率。评测的做法在 [Day 476](/blog/agent-zero/day-476-eval-scenarios/) 一路讲下来,换行业时变的是「指标怎么定义」。

**出错代价**:错一次要付什么。客服错一次大不了退一单钱,医疗错一次是人身伤害,金融错一次可能是监管处罚。代价越高,你花在审批、日志审计、评测上的时间占比越大。

### 把五项写成代码

五项如果只停在「我心里有数」,面试时容易说成「注意合规」「保证安全」这种空话。把它写成一个数据结构,再写一个检查函数,检查的就是你有没有偷懒:工具至少 3 个、红线至少 2 条、每条红线要说清落在哪一层、红线不能只放在提示词里。

```python
# agent-zero-lab/part09/industry/profile.py
from dataclasses import dataclass, field

# 红线可以落在哪一层。prompt 只能算「提醒」,不算拦得住。
LAYERS = {"prompt", "guardrail", "tool_permission", "approval"}


@dataclass
class Tool:
    name: str
    mode: str  # "read" 或 "write"


@dataclass
class RedLine:
    rule: str
    layer: str


@dataclass
class IndustryProfile:
    name: str
    knowledge: list[str]
    tools: list[Tool]
    redlines: list[RedLine]
    metrics: list[str]
    cost_of_error: str
    notes: list[str] = field(default_factory=list)


def validate(p: IndustryProfile) -> list[str]:
    """返回问题清单,空列表表示五项都填到了能用的程度。"""
    problems: list[str] = []
    if not p.knowledge:
        problems.append("知识源没填")
    if len(p.tools) < 3:
        problems.append(f"工具只有 {len(p.tools)} 个,至少列 3 个")
    for t in p.tools:
        if t.mode not in ("read", "write"):
            problems.append(f"工具 {t.name} 的 mode 必须是 read 或 write")
    if len(p.redlines) < 2:
        problems.append(f"红线只有 {len(p.redlines)} 条,至少 2 条")
    for r in p.redlines:
        if r.layer not in LAYERS:
            problems.append(f"红线「{r.rule}」的 layer {r.layer!r} 不在 {sorted(LAYERS)} 里")
        elif r.layer == "prompt":
            problems.append(f"红线「{r.rule}」只放在 prompt 里,模型可以不听,换一层")
    if len(p.metrics) < 3:
        problems.append(f"验收指标只有 {len(p.metrics)} 个,至少 3 个")
    if not p.cost_of_error.strip():
        problems.append("出错代价没填")
    return problems


def show(p: IndustryProfile) -> None:
    print(f"== {p.name} ==")
    print("知识源:", "、".join(p.knowledge))
    print("工具:  ", "、".join(f"{t.name}({t.mode})" for t in p.tools))
    for r in p.redlines:
        print(f"红线:   {r.rule}  [{r.layer}]")
    print("指标:  ", "、".join(p.metrics))
    print("出错代价:", p.cost_of_error)
    problems = validate(p)
    print("检查:  ", "通过" if not problems else problems)
```

<div class="line-notes">

- `LAYERS = {"prompt", "guardrail", "tool_permission", "approval"}` 四个合法的落点,用集合装,查「在不在里面」很快。花括号里没有冒号是集合,有冒号才是字典。
- `class Tool:` 一个工具只记名字和读写。`mode` 用字符串而不是布尔,因为将来可能要加 `"read-sensitive"` 这类中间状态。
- `class RedLine:` 一条红线 = 一句规则 + 一个落点。`layer` 是 `LAYERS` 里的一个。
- `notes: list[str] = field(default_factory=list)` 列表不能直接写成默认值 `= []`,所有实例会共用同一个,这个坑 [Day 50](/blog/agent-zero/day-050-dataclass/) 讲过,要用 `field(default_factory=list)`。
- `problems: list[str] = []` 先造一个空的问题清单,检查不通过的往里加。函数最后返回清单,空列表表示通过。
- `if len(p.tools) < 3:` 少于 3 个工具,说明你对这个行业的系统还没想明白。
- `for t in p.tools:` 逐个检查读写标记是不是 `read` 或 `write`。
- `if r.layer not in LAYERS:` 落点写错(比如把 `guardrail` 拼成 `guardrial`)时指出来,并用 `{sorted(LAYERS)}` 列出合法值。
- `elif r.layer == "prompt":` 落点是 `prompt` 时单独报一条问题。这是整个检查里最重要的一条:红线只放在提示词里,等于没有红线。
- `if not p.cost_of_error.strip():` `.strip()` 去掉首尾空白,所以只写了几个空格的字符串也算没填。
- `print("检查:  ", "通过" if not problems else problems)` 通过就打印「通过」,不通过打印问题列表。

</div>

先用 SupportPilot 本身当第一个例子。它是 SaaS 客服行业,五项都是你自己做出来的:

```python
# agent-zero-lab/part09/industry/saas_support.py
from part09.industry.profile import IndustryProfile, RedLine, Tool, show

SAAS_SUPPORT = IndustryProfile(
    name="SaaS 客服(SupportPilot)",
    knowledge=["帮助中心文章", "套餐与退款政策"],
    tools=[
        Tool("find_customer", "read"),
        Tool("list_invoices", "read"),
        Tool("create_refund_request", "write"),
    ],
    redlines=[
        RedLine("退款只能创建申请,不能直接打款", "approval"),
        RedLine("回答政策必须带引用,没有出处就转人工", "guardrail"),
    ],
    metrics=["解决率", "转人工率", "满意度"],
    cost_of_error="退一单钱;政策说错了公司要认(Air Canada 案)",
)

if __name__ == "__main__":
    show(SAAS_SUPPORT)
    lazy = IndustryProfile("懒人版", ["文档"], [Tool("search", "read")],
                           [RedLine("注意合规", "prompt")], ["准确率"], "")
    show(lazy)
```

<div class="line-notes">

- `knowledge=["帮助中心文章", "套餐与退款政策"],` 知识源,对应 [Day 444](/blog/agent-zero/day-444-kb-generate/) 造的帮助中心。
- `Tool("find_customer", "read"),` 这三个是 CloudLedger MCP server 里的工具名([Day 456](/blog/agent-zero/day-456-tools-mcp/) 包成 MCP 的那一版),前两个只读,第三个 `create_refund_request` 是写操作,但只是「创建申请」,真正打款在审批之后。
- `RedLine("退款只能创建申请,不能直接打款", "approval"),` 这条红线落在审批节点,不在提示词里,模型怎么说都没法绕过它。
- `RedLine("回答政策必须带引用,没有出处就转人工", "guardrail"),` 这条落在输出检查,对应 [Day 451](/blog/agent-zero/day-451-kb-citation/) 的引用。
- `cost_of_error="退一单钱;政策说错了公司要认(Air Canada 案)",` 明天会讲这个案子。
- `lazy = IndustryProfile("懒人版", ["文档"], [Tool("search", "read")],` 故意写一个偷懒的版本:只有 1 个工具、1 条只放在 prompt 里的红线、1 个指标、没填出错代价,看检查能抓到几处。

</div>

```bash
uv run python -m part09.industry.saas_support
```

```text
== SaaS 客服(SupportPilot) ==
知识源: 帮助中心文章、套餐与退款政策
工具:   find_customer(read)、list_invoices(read)、create_refund_request(write)
红线:   退款只能创建申请,不能直接打款  [approval]
红线:   回答政策必须带引用,没有出处就转人工  [guardrail]
指标:   解决率、转人工率、满意度
出错代价: 退一单钱;政策说错了公司要认(Air Canada 案)
检查:   通过
== 懒人版 ==
知识源: 文档
工具:   search(read)
红线:   注意合规  [prompt]
指标:   准确率
出错代价: 
检查:   ['工具只有 1 个,至少列 3 个', '红线只有 1 条,至少 2 条', '红线「注意合规」只放在 prompt 里,模型可以不听,换一层', '验收指标只有 1 个,至少 3 个', '出错代价没填']
```

SupportPilot 五项都通过。懒人版被抓出五处:工具太少、红线太少、红线只放在 prompt、指标太少、没填出错代价。最后一行的列表你可以直接当成「面试前自查清单」。

## 面试里怎么用

投不是 SaaS 客服的岗位时,不用重写项目。准备一个「迁移讲法」:按五项框架,先说哪些原样保留,再说哪些要重做,最后说你会先验证什么。

**原样保留**的是骨架本身:分类、检索、调工具、起草、自检、审批、转人工这七个节点,以及你做过的评测方法、可观测、部署。这些都是「怎么做」,和行业无关。

**要重做**的就是五项。讲的时候用一个具体的例子开头最有说服力。比如面金融岗:「SupportPilot 里有一条规则,退款金额必须来自账单工具的返回值,模型不能自己算。搬到理财顾问的助手上,我会把这条规则扩到所有数字,收益率、持仓、费率,回答里每个数字都要能对上一次工具调用,对不上就拦下来。」这说明你知道规则落在代码的哪一层,比泛泛地说「我了解金融合规」强得多。这条规则明天会写成代码。

如果被问到你没做过的行业知识,诚实说不懂,然后讲你会怎么学:找业务方要三十条真实问题,和合规或医生一起定「不可接受错误」清单,先做内部工具、不碰客户。这三步在每个行业都适用。

## 动手练习

### 练习 1:把「福利里的保险」排除掉

刚才看到金融的几条误判:福利里的「补充医疗保险」、安全岗的「业务风控」、医疗收费里的「payment posting」。改一个 `is_finance(title, text)` 函数:把词分成「强词」(金融、银行、证券……)和「弱词」(风控、保险、payments、trading),强词出现一次就算,弱词要出现两次以上才算;再先把福利里的「补充医疗保险、企业年金」这类句子抹掉。在样本上重跑,看哪些误判被排除了,哪些还在。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex514_strong.py
import json
import re
from typing import Any, cast

STRONG = r"金融|银行|证券|基金|信贷|理财|投研|fintech|\bbank|insurance|financial"
WEAK = r"风控|保险|payments?\b|trading"
BENEFIT = re.compile(r"补充医疗保险|企业年金|五险一金|商业保险|团体保险")


def is_finance(title: str, text: str) -> bool:
    s = BENEFIT.sub("", (title + " " + text).lower())
    if re.search(STRONG, s):
        return True
    return len(re.findall(WEAK, s)) >= 2     # 弱词要出现两次以上才算


if __name__ == "__main__":
    data = cast(dict[str, list[dict[str, Any]]], json.load(open("part09/industry/jd_sample.json", encoding="utf-8")))
    for region in ["domestic", "overseas"]:
        for j in data[region]:
            if is_finance(j["title"], j["text"]):
                print(j["id"], j["title"])
```

<div class="line-notes">

- `STRONG = r"金融|银行|` 强词:出现一次就基本能确定是金融语境。把「保险」从强词挪走,因为它既可能是保险业务,也可能是福利。`insurance` 留在强词里,英文里它几乎只指保险业务。
- `WEAK = r"风控|保险|payments?\b|trading"` 弱词:单独出现不可靠。「风控」安全岗也会写,「payments」医疗收费也会有。
- `BENEFIT = re.compile(r"补充医疗保险|` 福利句子里常见的「保险」搭配,先整段抹掉。
- `s = BENEFIT.sub("", (title + " " + text).lower())` 把福利词替换成空字符串。样本第 2 条(央企)的「补充医疗保险、企业年金」就是在这一步被抹掉的,抹完以后它里面没有任何金融词。
- `if re.search(STRONG, s):` 先看强词。
- `return len(re.findall(WEAK, s)) >= 2` `re.findall` 返回所有匹配,数一数有几个。弱词至少两个才算,样本第 4 条(安全岗)只有一个「风控」,所以被排除。
- `for region in ["domestic", "overseas"]:` 样本里分国内海外两个列表,各遍历一遍,打印通过的编号。

</div>

```bash
uv run python -m part09.ex.ex514_strong
```

```text
1 AI应用工程师
5 AI应用工程师
6 AI Agent开发工程师 (MJ000082)
7 AI大模型应用开发工程师
8 AI Agent开发工程师
10 AI应用工程师
3 AI Engineer-Chatbot/Agent
```

样本里的 9 条原先命中变成 7 条(编号 5 是因为这里没有长度过滤,所以多出来)。福利里的保险(2)、安全岗的风控(4)、医疗收费的 payment posting(9)都被排除了;「行业背景:政企、能源、交通、金融、制造」(7)这种罗列仍然留着,因为「金融」是强词,这一类要靠另一种办法(比如看命中词是不是出现在「职责」段落而不是「要求」段落,或者统计同一句里有几个行业词)。**改规则能降低误判,不能清零,所以抽样看误判率这一步不能省。**

</details>

### 练习 2:一条 JD 命中几个行业

自己证实「百分比加起来为什么不等于 100%」:写脚本统计每条 JD 同时命中 0、1、2、3 个行业的条数,在全量数据上我跑的结果会放在答案里,你在样本上跑自己的。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex514_overlap.py
import json
import re
import sys
from collections import Counter
from typing import Any, cast

from part09.industry.jd_industry import INDUSTRIES


def overlap(path: str) -> None:
    data = cast(dict[str, list[dict[str, Any]]], json.load(open(path, encoding="utf-8")))
    for region in ["domestic", "overseas"]:
        dist: Counter[int] = Counter()
        for job in data[region]:
            text = ((job.get("title") or "") + " " + (job.get("text") or "")).lower()
            if len(text) < 100:
                continue
            n = sum(1 for p in INDUSTRIES.values() if re.search(p, text))
            dist[n] += 1
        total = sum(dist.values())
        print(f"{region}: {total} 条")
        for k in sorted(dist):
            print(f"  命中 {k} 个行业: {dist[k]:>3} 条 {dist[k] / total:.0%}")


if __name__ == "__main__":
    overlap(sys.argv[1])
```

<div class="line-notes">

- `dist: Counter[int] = Counter()` 键是「命中了几个行业」,值是有多少条 JD。
- `n = sum(1 for p in INDUSTRIES.values() if re.search(p, text))` 生成器表达式:对每个行业的正则,命中就产出一个 1,`sum` 加起来就是命中的行业个数。
- `dist[n] += 1` 命中 2 个行业的 JD,这一格加 1。
- `total = sum(dist.values())` 所有格子加起来,就是有正文的 JD 总条数,用作分母。
- `for k in sorted(dist):` 按「命中个数」从小到大打印。

</div>

```bash
uv run python -m part09.ex.ex514_overlap part09/industry/jd_sample.json
```

```text
domestic: 10 条
  命中 1 个行业:   7 条 70%
  命中 2 个行业:   3 条 30%
overseas: 5 条
  命中 1 个行业:   4 条 80%
  命中 2 个行业:   1 条 20%
```

样本是我挑的,每条至少命中一个,没有意义。下面是我在全量数据上跑的:

```text
domestic: 331 条
  命中 0 个行业: 217 条 66%
  命中 1 个行业:  86 条 26%
  命中 2 个行业:  19 条 6%
  命中 3 个行业:   9 条 3%
overseas: 185 条
  命中 0 个行业: 103 条 56%
  命中 1 个行业:  58 条 31%
  命中 2 个行业:  22 条 12%
  命中 3 个行业:   2 条 1%
```

两个读法:一是国内 66%、海外 56% 的 JD 一个行业都没命中,行业不是主要筛选条件;二是命中 2 个以上的有一批,所以前面表里的百分比加起来超过 100%,不是算错。

</details>

### 练习 3:给一个没人讲过的行业填五项

选一个这两天不会讲的行业(下面答案用法律合同审查),用 `IndustryProfile` 填五项,让 `validate` 通过。每条红线都要写清落在哪一层,至少两条不能是 `prompt`。

<details><summary>参考答案</summary>

这是一份示范,是我自己的推断,没有找到公开的案例,所以名字里标明了。真实使用时,你应该找该行业的人确认每一项。

```python
# agent-zero-lab/part09/ex/ex514_law.py
from part09.industry.profile import IndustryProfile, RedLine, Tool, show

LEGAL = IndustryProfile(
    name="法律:合同审查助手(我自己的推断,没有公开案例支撑)",
    knowledge=["公司合同模板库", "法务团队的审查清单", "历史合同和批注"],
    tools=[Tool("get_contract", "read"), Tool("search_clauses", "read"), Tool("add_comment", "write")],
    redlines=[
        RedLine("只能加批注,不能直接改合同正文", "tool_permission"),
        RedLine("引用的条款必须能在原合同里逐字找到,找不到就拦下", "guardrail"),
        RedLine("风险等级为高的条款必须法务确认才能发给业务方", "approval"),
    ],
    metrics=["高风险条款召回率", "法务采纳率", "单份合同审查时长"],
    cost_of_error="漏掉一条不利条款,合同签出去就收不回",
)

if __name__ == "__main__":
    show(LEGAL)
```

<div class="line-notes">

- `knowledge=["公司合同模板库",` 知识源是封闭的、法务自己维护的材料。不让模型用公开网页上的「标准合同条款」,因为那些不一定符合公司的政策。
- `Tool("add_comment", "write")` 唯一的写操作是「加批注」,批注是建议,不改合同本身。这就是红线 1 在工具层的实现:根本没有 `edit_contract` 这个工具,模型想改也没有手段。
- `RedLine("只能加批注,不能直接改合同正文", "tool_permission"),` 落在工具层权限。
- `RedLine("引用的条款必须能在原合同里逐字找到,找不到就拦下", "guardrail"),` 落在输出检查:拿模型引用的每一句去原文里做字符串查找,找不到就拦。逻辑和金融「数字必须来自工具返回」是同一类。
- `RedLine("风险等级为高的条款必须法务确认才能发给业务方", "approval"),` 落在审批节点。
- `metrics=["高风险条款召回率",` 和医疗一样,漏报比误报贵,所以第一个指标是召回率而不是准确率。

</div>

```bash
uv run python -m part09.ex.ex514_law
```

```text
== 法律:合同审查助手(我自己的推断,没有公开案例支撑) ==
知识源: 公司合同模板库、法务团队的审查清单、历史合同和批注
工具:   get_contract(read)、search_clauses(read)、add_comment(write)
红线:   只能加批注,不能直接改合同正文  [tool_permission]
红线:   引用的条款必须能在原合同里逐字找到,找不到就拦下  [guardrail]
红线:   风险等级为高的条款必须法务确认才能发给业务方  [approval]
指标:   高风险条款召回率、法务采纳率、单份合同审查时长
出错代价: 漏掉一条不利条款,合同签出去就收不回
检查:   通过
```

三条红线分别落在三个不同的层,没有一条只靠提示词。这正是面试时想讲清的东西。

</details>

**验收标准**

- `jd_industry.py` 在样本上能跑,你能说出全量表里「金融 25%」的两处粗糙(提到不等于做、正则会误伤)。
- 你自己抽了 20 条命中某个行业的 JD(用 `fp_check.py`,可以换成别的行业),写下了你的误判数。
- 你有一份目标行业的 `IndustryProfile`,`validate` 通过,至少两条红线不是 `prompt`。
- 能不看文章,在一分钟内讲完五项各是什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 行业 Agent | 针对某个具体行业(金融、医疗、电商等)做的 Agent,和通用助手相对,难点在行业规则和数据,不在模型 |
| 关键词匹配统计 | 用正则或词表数一段文字里出现了哪些词,简单但粗糙,只能说「提到了」,不能说「是」 |
| 误判率 | 被判为某一类、其实不是的比例,抽样人工看出来的数字,是一个统计结果可信度的指标 |
| 知识源 | Agent 回答问题时能引用的材料,决定了检索那一层的难度 |
| 红线 | 模型绝对不能自己做的事,要落在代码的某一层,不能只写在提示词里 |
| 落点(layer) | 红线具体放在哪一层:提示词、输出检查、工具权限、审批节点 |
| 验收指标 | 上线前后用来证明 Agent 有没有用的数字,每个行业关心的不一样 |
| 出错代价 | 错一次要付出什么,决定了你把多少时间放在审批、审计和评测上 |
| 召回率(recall) | 所有真正该报的里面,被报出来的比例。漏报多就低,明天细讲 |

## 常见误区

**把 JD 行业统计当成行业分布。** 它数的是「JD 里提到了这个行业」,公司介绍里的一句话就能命中三个行业。要把它当成一个粗糙的线索,不是结论。

**数完不抽样。** 一个统计脚本跑完得到 12%,心里就当成真的。抽 20 条看一眼,发现三成是误判,数字的意思就变了。

**红线只写在提示词里。** 「请不要承诺收益」模型多数时候会听,少数时候不听,而你不知道哪一次。能写成代码检查的,就别靠提示词。

**以为换行业要把整个系统重写。** 骨架(分类、检索、调工具、起草、自检、审批、转人工)基本不变。换的是五样东西,而且前三样(知识源、工具、红线)是改配置和加检查,不是推倒重来。

**没做过的行业假装懂。** 面试官很容易问到你答不上来的地方。诚实说「这块我没做过」,然后讲你怎么学(找业务方要真实问题、和合规一起定不可接受错误、先做内部工具),比硬撑更可信。

**一上来就想做面向客户的 Agent。** 金融、医疗、法律的第一个落地几乎都是给内部员工用的,面向客户的放在后面。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/research/building-effective-agents):文章末尾附录里有客服和编程两类 Agent 的实践总结,看它怎么说「为什么这两类最先落地」,和今天的五项对照。
- [OpenAI · A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf):PDF,里面讲了护栏(guardrails)和人工介入的设计,可以对照红线的几个落点读。
- [站长抓的 JD 原始数据(GitHub 页面)](https://github.com/lm742611149/aiinfra.blog/blob/main/docs/jd-research/jds.json):旧课链接,网站上线前这个路径是否还在公开,以仓库为准;链接能打开时你可以直接下载跑全量。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1P3gs6uEbJ&autoplay=0&high_quality=1" title="Agent为什么难落地?企业级AI Agent落地的5大核心挑战与解决方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · Agent为什么难落地?企业级AI Agent落地的5大核心挑战与解决方案|腾讯、阿里、百度企业级实践深度拆解 · 19 分钟,讲企业落地卡在哪(数据权限、系统集成、效果验收),可以对照五项框架听。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ermCBcEFR&autoplay=0&high_quality=1" title="5个企业级Agent落地案例效果预览介绍" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>韦东东666 · 5个企业级Agent落地案例效果预览介绍 · 13 分钟,看几个不同行业的 Agent 做成什么样;练习:对每个案例找出它的知识源、工具、红线。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/QDXqUejasH8" title="Bret Taylor of Sierra on AI agents, outcome-based pricing, and the OpenAI board" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Stripe · Bret Taylor of Sierra on AI agents, outcome-based pricing, and the OpenAI board · Sierra 创始人聊企业客服 Agent 和按结果收费,明天讲 SaaS 客服时会用到,今天可以先听前半部分。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):讲 AI 应用工程的系统方法,里面有评测、护栏和落地的章节,和「验收指标」「红线」两项对应。按目录挑读,不用通读。

### 开源项目与代码

今天这组不需要。明天会读几个公开的行业案例(每个都标出处)。

## 自测

1. 「JD 里金融占海外 25%」这个说法有哪两处粗糙?

<details><summary>答案</summary>

一是「提到」不等于「做」:公司介绍里一句「服务金融客户」就会命中;二是正则会误伤:福利里的「保险」、安全岗的「风控」、医疗收费的 payment 都被算了进去。我在全量数据上抽 20 条人工看,有 5 条明显不是、1 条拿不准。所以这个数字更接近「提到金融」的上限,不是「做金融」的比例。

</details>

2. 一条 JD 能同时算进几个行业吗?这对「各行业占比加起来」有什么影响?

<details><summary>答案</summary>

能。脚本只要命中就计数,一条 JD 提到金融和电商就两个行业都算一次,所以各行业百分比加起来可以超过 100%。另一面,国内有 66% 的 JD 一个行业都没命中,不分行业的岗位才是大头。

</details>

3. 换行业时,SupportPilot 的骨架里哪些模块原样保留,要换哪五样东西?

<details><summary>答案</summary>

骨架(分类、检索、调工具、起草+自检、审批闸门、转人工)以及评测方法、可观测和部署方式基本保留。要换的五样是:知识源、工具、红线、验收指标、出错代价。

</details>

4. 红线「不许承诺收益」只写在提示词里,为什么不够?应该放在哪里?

<details><summary>答案</summary>

提示词只是对模型的请求,模型多数时候会照做,少数时候不听,而你事先不知道哪一次不听。应该落到代码层:输出检查(命中合规词表就拦下)、工具层权限(根本不给能做这件事的工具)、审批节点(必须人确认)。`validate` 里单独把 `prompt` 标出来,就是为了逼自己换一层。

</details>

5. 一个五项框架里「出错代价」,为什么要写在设计的最前面想,而不是最后?

<details><summary>答案</summary>

出错代价决定了你该把多少时间花在什么地方。代价低(退一单钱),优化提示词和检索就能直接提指标;代价高(医疗、金融),同样的时间花在审批、审计日志和高风险类别的评测上更划算。不先想代价,容易把时间花在错的地方。

</details>

6. (面试题)面试官问:「你做的是 SaaS 客服 Agent,我们是银行,你觉得要改什么?」请给出一个回答思路。

<details><summary>答案</summary>

按五项说。骨架保留:分类、检索、调工具、起草、自检、审批、转人工,评测和部署的方法也保留。然后说要换的:知识源换成审核过的研报和产品文档,封闭;工具换成持仓、净值这类系统,先全部只读;红线要落到代码层,比如回答里每个数字必须来自工具返回、命中合规词表就拦;指标换成顾问采纳率、合规抽检通过率;出错代价是监管处罚,所以上线前就要有审计日志。最后说你不懂的部分(适当性管理的具体条款),说会先找合规部门要不能说的话的清单,先做内部助手。

</details>

## 明天预告

[Day 515](/blog/agent-zero/day-515-industry-2/) · 行业里的 Agent(二):SaaS 客服、金融、医疗、电商。今天讲了五项框架和一个检查工具,明天把它用到四个具体行业上:每个行业读一个公开案例(标明哪些数字是公司自己说的),并且各写一个能跑的小演示:客服里「什么算解决」怎么定义,金融里「数字必须来自系统」怎么拦,医疗里为什么看召回率不看准确率,电商里知识库为什么要按店铺隔离。
