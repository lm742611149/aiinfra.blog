---
title: 'Day 435 · 开题:为什么做智能客服工单'
description: '毕业项目 SupportPilot 的第一天,不写业务代码,只回答一个很多人跳过的问题:作品项目怎么选题。先用 12 句真实 JD 和站里 519 条带正文的招聘数据看招聘方要什么,再定四条选题标准,写一个打分脚本比较五个候选题;用一个 20 行的判卷函数说明「有对错」为什么是第一要紧的,最后看一眼接下来 60 天要搭出什么。'
pubDate: 2026-10-23
regime: none
tags: ['capstone', 'supportpilot', 'project-selection', 'career', 'agent-zero']
series: 'agent-zero'
day: 435
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 434](/blog/agent-zero/day-434-prod-project-2/) 是第七部分的最后一天:在本机用 Caddy 搭了预发,加了按 IP 限流,实测了直连能伪造 `X-Forwarded-For`、经过 Caddy 就不行;写好了上服务器的三个文件;然后做了七项故障演练,其中两项(库打不开、审计写不进)和预期对不上,当场修好,写进了 README。

到这里你手上有一个「上了公网、做过演练」的小服务。可它只有两个只读工具、一个最多五步的循环,面试官看一眼就会问:「然后呢?」从今天开始的第八部分,用 60 多天做一个完整的、像真产品的东西:**SupportPilot,给虚构 SaaS 公司「云簿 CloudLedger」用的智能客服工单 Agent**。云簿就是 Day 429 起查账服务里那个公司,刘静、王磊、陈晨三个客户你已经见过了。

## 今天要解决的问题

今天只讲一件事:**作品项目怎么选题**。学完你应该能:

1. 说出好的作品项目的四条选题标准,每条都能举出一个反例。
2. 用一个小脚本在真实招聘要求里数关键词,知道招聘方最常要哪几样技能,也知道这种统计的局限。
3. 用打分脚本比较几个候选题目,并且能解释为什么 SupportPilot 得分最高,而不是只说「客服很常见」。
4. 用一个判卷函数说明「有对错」这条标准在代码里长什么样,以及一个天真的判卷函数会怎样被骗。

今天不写 SupportPilot 的代码,脚本都很短、一分钱不花。预计用时 1.5–2 小时。前置:第一到第七部分的整体印象,特别是 [Day 341](/blog/agent-zero/day-341-why-evals/)「为什么要评测」;脚本只用到 [Day 23](/blog/agent-zero/day-023-comprehensions/) 的推导式、[Day 24](/blog/agent-zero/day-024-dicts/) 的字典和 Python 自带的 `re` 正则模块。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把四条选题标准和每条的反例默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:作品集里的 TodoList

你做前端时大概见过、甚至自己写过这样的简历:「项目一:基于 React 的待办清单应用,支持增删改查和本地存储。」面试官看到它通常不会问什么,因为能问的都太浅了。真正能聊起来的项目,是那种「我们电商后台的订单列表,一页 5000 行卡得不行,我用虚拟滚动加分页把首屏从 4 秒降到 0.8 秒」的项目:有具体的用户、具体的问题、具体的数字,还有取舍。

Agent 岗位也一样,而且更严重。因为调一次大模型 API、做一个聊天框,门槛太低了。2026 年面试官最常见到的作品是这几类:「AI 写周报」「AI 旅行规划」「多 Agent 协作写小红书文案」「基于 LangChain 的 PDF 问答」。它们技术上能跑,但面试官问两个问题就聊不下去了:

- 「你怎么知道它做得好?」
- 「它出错了会怎样,谁负责?」

答不上来,不是你不会,是**题目本身就没有答案**。一篇周报写得好不好,没有标准;旅行规划出错了,用户自己改一下就完了,没有后果,所以也没有你需要设计的安全机制。题目决定了你能在面试里讲出什么。这就是为什么开工前要花一整天选题。

## 第一步:先看招聘方在要什么

选题的第一个依据是招聘要求。本站在 2026 年 10 月 12 日抓过一批 AI Agent 相关的岗位描述(JD),整理在 [Agent 工程师 JD 调研](/blog/agent-jd-report-2026-10/) 那篇文章里。今天先用一个小样本练手:我从那批数据里摘了 12 句国内 JD 的原文(略有删减,去掉了公司名),你在自己电脑上就能跑。

这里要用到 Python 的 `re` 模块,也就是**正则表达式**。你在 JS 里写过 `/RAG|知识库/i.test(line)`,Python 里对应的是 `re.search(r"RAG|知识库", line, re.IGNORECASE)`,意思完全一样:这一行里有没有出现 RAG 或者知识库,不区分大小写。

```bash
cd ~/agent-zero-lab
mkdir -p part08 && touch part08/__init__.py
```

<div class="line-notes">

- `mkdir -p part08 && touch part08/__init__.py` 第八部分的练习目录。SupportPilot 本身从 Day 441 起是一个独立的新仓库,`part08/` 只放这几天开题用的小脚本。

</div>

```python
# agent-zero-lab/part08/jd_keywords.py
"""12 句真实 JD 摘录(2026-10 抓取,略有删减),数一数每类技能被提到几次。"""
import re

JD_LINES = [
    "了解大语言模型、RAG、Embedding、Function Calling或Agent开发",
    "参与 LLM Agent、RAG 知识库、智能对话流程设计与工程落地",
    "Agent评测与评估体系（Eval / Harness / 自动化评测）",
    "开发Agent工作流、工具调用、记忆及多轮对话能力",
    "实际做过Agent、知识库、工具调用或智能工作流类项目",
    "理解 Agent 原理：function calling、上下文管理、记忆、RAG、多 Agent、沙箱隔离",
    "建立业务验收标准，牵引测试集、AI评测、回归及发布门禁",
    "能用Python独立完成应用服务，有检索、工具调用、结构化输出及异常处理经验",
    "负责Agent系统的部署、监控、性能调优和全生命周期管理",
    "熟悉 Linux、Docker、CI/CD，代码能从 git push 走到用户手里",
    "建立AI应用的基础工程规范，包括模型版本、调用成本、评测、监控、回退和运行稳定性",
    "支撑 Agent 产品在多租户、任务编排、资源管理、权限控制等场景下的工程落地",
]

SKILLS = {
    "工具调用": r"工具调用|function call",
    "RAG/知识库": r"RAG|知识库|检索",
    "评测": r"评测|评估|eval",
    "部署运维": r"部署|Docker|CI/CD|监控",
    "安全权限": r"权限|沙箱",
}

for skill, pattern in SKILLS.items():
    hits = [line for line in JD_LINES if re.search(pattern, line, re.IGNORECASE)]
    print(f"{skill:<8} {len(hits):>2}/{len(JD_LINES)}  {'#' * len(hits)}")
```

<div class="line-notes">

- `import re` Python 自带的正则模块,不用 `uv add`。
- `JD_LINES = [` 12 句 JD 原文。注意它们的标点有全角有半角、中英文混排,这是真实数据的样子,下面的正则要能应付。
- `"理解 Agent 原理：function calling、上下文管理、记忆、RAG、多 Agent、沙箱隔离",` 这一句一个人就命中了三类技能,后面会看到它被重复计数。
- `SKILLS = {` 字典:技能名 → 正则。`|` 是「或」,和 JS 正则一样。
- `"工具调用": r"工具调用|function call",` 字符串前的 `r` 表示「原样字符串」,反斜杠不转义,写正则时习惯加上。这里中文「工具调用」和英文「function call」都算,下面的 `IGNORECASE` 让 `Function Calling` 也能匹配。
- `"RAG/知识库": r"RAG|知识库|检索",` 检索也算进 RAG 一类。分类怎么定是我的判断,你可以改。
- `for skill, pattern in SKILLS.items():` 遍历字典的键值对,相当于 JS 的 `Object.entries(SKILLS)`。
- `hits = [line for line in JD_LINES if re.search(pattern, line, re.IGNORECASE)]` 列表推导式:留下所有能匹配上的句子。`re.search` 在整句里找,找到返回一个匹配对象(真),找不到返回 `None`(假)。相当于 JS 的 `JD_LINES.filter(line => /.../i.test(line))`。
- `print(f"{skill:<8} {len(hits):>2}/{len(JD_LINES)}  {'#' * len(hits)}")` `:<8` 左对齐占 8 格,`:>2` 右对齐占 2 格。`'#' * 5` 得到 `#####`,用来画一个最简陋的柱状图。

</div>

```bash
uv run python part08/jd_keywords.py
```

```text
工具调用      5/12  #####
RAG/知识库   5/12  #####
评测        3/12  ###
部署运维      3/12  ###
安全权限      2/12  ##
```

对不齐是因为一个汉字在终端里占两个英文字符的宽度,而 Python 的 `:<8` 按字符个数算,不按显示宽度算。不影响结果,知道原因就行。

12 句太少,只能当练习。站里那批完整数据我用同样的思路统计过(正则规则更多、更细,规则写在调研文章里),只看有正文的岗位:国内 334 条、海外 185 条。下面是和选题最相关的几行:

| 技能 | 国内(334 条) | 海外(185 条) |
| --- | --- | --- |
| 工具调用 / Function Calling | 55% | 39% |
| RAG / 检索 | 51% | 54% |
| 评测 Eval | 48% | 62% |
| 部署 / Docker / 云 | 39% | 53% |
| SQL / 数据系统 | 31% | 41% |
| 面向客户 / 交付 | 33% | 46% |
| 安全(注入 / 权限 / 沙箱) | 11% | 22% |

再数几个跟场景有关的词:国内正文里写了「知识库」的 23%,写了「客服」的 8%;海外正文里写了 support 的一半左右,但这个英文词太宽泛,「技术支持」「support our customers」都算进去了,我不拿它当证据。

这张表能说明的事情有限,我想把局限先讲清楚:关键词出现不等于岗位真的看重它(很多 JD 是抄来抄去的);一句话里同时写了五样技能,五样都会被算一次;Boss 直聘的大部分岗位没抓到正文,不在里面。但有一个结论是稳的:**工具调用、RAG、评测、部署这四样,在国内和海外都是出现最多的那一档。** 一个作品项目如果能把这四样都自然地用上,就覆盖了大多数岗位的核心要求。

## 第二步:四条选题标准

有了招聘方的要求,再看什么样的题目能把这些要求「装」进去。我用四条标准,前两条是硬的,后两条是加分的。

**第一条,覆盖高频技能。** 不是硬塞:你做一个旅行规划,硬加一个知识库查景点介绍,面试官一问「为什么要 RAG,直接让模型说不行吗」就露馅了。好的题目是**业务本身就需要**这些技能。智能客服就是这样:回答政策问题要查帮助中心(RAG);查账单要调业务系统(工具调用);回复对不对要量化(评测);给真人用要上线(部署)。

**第二条,有对错,能评测。** 这是最重要的一条。「年付首购第 7 天能不能全额退款」有标准答案;「这个客户 9 月是不是被扣了两次」查数据库就知道。有对错就能建评测集,有评测集就能在面试里说「通过率从 X 提到了 Y,靠的是这三处改动」,这一句的分量比「我用了 LangGraph」重得多。第六部分([Day 341](/blog/agent-zero/day-341-why-evals/) 起)讲了一个多月评测,可如果题目没有对错,那些方法全都用不上。下一步会用代码把这条说清楚。

**第三条,有真实的风险和取舍。** 退款涉及钱,所以必须有人工审批([Day 414](/blog/agent-zero/day-414-approval-design/));客户可能威胁投诉,所以要知道什么时候转人工;工单里可能夹着「忽略之前的指令」,所以要有注入防御([Day 403](/blog/agent-zero/day-403-injection-1/) 起)。有风险,第七部分学的权限、审批、审计、预算才有用武之地,面试官也最爱追问这些地方。写周报的 Agent 没有风险,你就没有机会展示这些。

**第四条,对接企业系统。** 国内很多 JD 写着要对接「数据平台、业务系统、知识库、审批系统、企业协作工具」,上面那张表里 SQL / 数据系统也占了三到四成。一个只调模型 API 的项目讲不出这些。客服工单天然要接业务数据库、知识库、审批流和群通知。

四条里我把第二条放在最前面考虑。题目没有对错,前三条做得再好也只是「做了很多事」,说不出「做好了没有」。

## 第三步:给候选题目打分

把四条标准变成一张打分表。每条 0 到 2 分:0 是完全不沾边,1 是勉强能扯上,2 是业务本身就离不开。分数是我的判断,理由写在旁边,你完全可以不同意,改了数字再跑。

```python
# agent-zero-lab/part08/topic_score.py
"""用四条标准给候选毕业项目打分。每条 0–2 分,分数是我的判断,理由写在旁边,你可以改。"""
CRITERIA = ["覆盖高频技能", "有对错可评测", "有风险和取舍", "对接企业系统"]

TOPICS: dict[str, tuple[list[int], str]] = {
    "AI 写周报": ([1, 0, 0, 1], "好坏全凭感觉,出错也没什么后果"),
    "AI 旅行规划": ([1, 0, 1, 0], "能调地图和天气工具,但「好行程」没有标准答案"),
    "多 Agent 写小红书文案": ([1, 0, 0, 0], "技术栈新,说不清怎么判断写得好"),
    "代码审查机器人": ([1, 2, 1, 1], "能用埋好的 bug 算召回,毕业项目最后几天的第二作品就做它"),
    "智能客服工单 SupportPilot": ([2, 2, 2, 2], "政策题有标准答案,退款要审批,要接业务库和知识库"),
}

ranked = sorted(TOPICS.items(), key=lambda kv: sum(kv[1][0]), reverse=True)
print("  ".join(CRITERIA))
for name, (scores, why) in ranked:
    cells = "".join(f"{s:^{len(c) * 2 + 2}}" for s, c in zip(scores, CRITERIA))
    print(f"{cells} 总分 {sum(scores)}  {name}:{why}")
```

<div class="line-notes">

- `CRITERIA = ["覆盖高频技能", "有对错可评测", "有风险和取舍", "对接企业系统"]` 四条标准,顺序和下面每个题目的分数一一对应。
- `TOPICS: dict[str, tuple[list[int], str]] = {` 类型标注读作:字典,键是题目名,值是一个元组,元组里第一个是分数列表,第二个是理由。相当于 TS 的 `Record<string, [number[], string]>`。
- `"AI 写周报": ([1, 0, 0, 1], "好坏全凭感觉,出错也没什么后果"),` 能接公司的文档系统,所以「对接企业系统」给 1;周报写得好不好没有标准,「有对错」给 0。
- `"AI 旅行规划": ([1, 0, 1, 0],` 订酒店、付款时有一点风险,给 1。
- `"代码审查机器人": ([1, 2, 1, 1],` 往代码里埋几个已知的 bug,看它找到几个,这就是对错。它也是一个很好的题,只是覆盖的技能窄一些(主要是工具调用和评测),所以放在第八部分末尾 Day 494 起做第二作品。
- `"智能客服工单 SupportPilot": ([2, 2, 2, 2],` 四条都是业务本身离不开的。
- `ranked = sorted(TOPICS.items(), key=lambda kv: sum(kv[1][0]), reverse=True)` 按总分从高到低排。`kv` 是一个 (题目名, (分数, 理由)) 的元组,`kv[1][0]` 取到分数列表,`sum` 求和。相当于 JS 的 `Object.entries(TOPICS).sort((a, b) => sum(b[1][0]) - sum(a[1][0]))`。
- `for name, (scores, why) in ranked:` 一次解包两层:外层拆出名字和元组,内层再把元组拆成分数和理由([Day 22](/blog/agent-zero/day-022-tuples-unpack/) 的解包)。
- `cells = "".join(f"{s:^{len(c) * 2 + 2}}" for s, c in zip(scores, CRITERIA))` 把四个分数排成一行,每个分数居中(`:^`)放在和表头一样宽的格子里。格子宽度是表头汉字数 × 2 + 2,就是为了对付上一步那个「汉字占两格」的问题。`zip` 把分数和表头一对一配起来,和 JS 里手写的 `scores.map((s, i) => [s, CRITERIA[i]])` 一样。
- `print(f"{cells} 总分 {sum(scores)}  {name}:{why}")` 每行最后写总分、题目、理由。

</div>

```bash
uv run python part08/topic_score.py
```

```text
覆盖高频技能  有对错可评测  有风险和取舍  对接企业系统
      2             2             2             2        总分 8  智能客服工单 SupportPilot:政策题有标准答案,退款要审批,要接业务库和知识库
      1             2             1             1        总分 5  代码审查机器人:能用埋好的 bug 算召回,毕业项目最后几天的第二作品就做它
      1             0             0             1        总分 2  AI 写周报:好坏全凭感觉,出错也没什么后果
      1             0             1             0        总分 2  AI 旅行规划:能调地图和天气工具,但「好行程」没有标准答案
      1             0             0             0        总分 1  多 Agent 写小红书文案:技术栈新,说不清怎么判断写得好
```

这个脚本的意义不在于算出 8 分,而在于逼你把理由写出来。打分时如果你发现某一格怎么也说不清为什么给 2,那一格就该是 1。另外注意「多 Agent」本身不加分:多 Agent 是一种实现手段,不是一个业务需求,面试官更关心你为什么需要多个 Agent,而不是你用了几个。

客服这个场景在海外也是 Agent 落地最早、钱最清楚的方向之一。Sierra、Decagon、Intercom(它的客服 Agent 产品叫 Fin)都在做客服 Agent。Sierra 在 2024 年 6 月发布了 [τ-bench](https://sierra.ai/blog/benchmarking-ai-agents),一个专门测客服 Agent 的公开基准:模拟用户和 Agent 多轮对话,Agent 手里有航空公司或零售店的业务工具和一份政策文档,最后看数据库的状态对不对。后来的 τ²-bench 又加了电信领域。有一个专门测客服 Agent 的基准,本身就说明这个场景**有对错**,这和我们的第二条标准是一回事。

## 第四步:「有对错」在代码里长什么样

第二条标准说起来抽象,写成代码就很具体:**有对错,就是你能写出一个判卷函数**。输入是题目和 Agent 的回答,输出是对或错,不需要人看。

用云簿的退款规则做例子(简化版,完整规则 Day 436 从访谈里拆):年付首次购买 14 天内(含第 14 天)可以全额退;月付不退;企业版是合同单,一律转人工。

```python
# agent-zero-lab/part08/right_or_wrong.py
"""有对错的题,才能写判卷函数。云簿退款规则的简化版:年付首购 14 天内(含)全额退,月付不退,企业版转人工。"""


def expected(plan: str, days: int) -> str:
    if plan == "enterprise":
        return "转人工"
    if plan == "annual" and days <= 14:
        return "全额退款"
    return "不能全额退"


def judge(plan: str, days: int, agent_answer: str) -> bool:
    return expected(plan, days) in agent_answer


CASES = [  # 套餐、买了几天、假设 Agent 这么回答
    ("annual", 7, "您是年付首购第 7 天,可以全额退款。"),
    ("annual", 14, "已经第 14 天了,不能全额退,只能按月折算。"),
    ("annual", 15, "超过 14 天,不能全额退,剩余整月按比例退。"),
    ("monthly", 3, "月付可以全额退款。"),
    ("enterprise", 2, "企业版合同单我帮您转人工,由客户成功经理处理。"),
]

passed = 0
for plan, days, answer in CASES:
    ok = judge(plan, days, answer)
    passed += ok
    print(f"{'对' if ok else '错'}  {plan:<10} 第{days:>2}天  应该:{expected(plan, days):<5}  Agent:{answer}")
print(f"\n{passed}/{len(CASES)} 答对")
```

<div class="line-notes">

- `def expected(plan: str, days: int) -> str:` 标准答案由**代码按规则算**,不靠人记,也不靠模型猜。SupportPilot 里退款资格就是这么算的,模型只负责把结果解释给客户。
- `if plan == "enterprise":` 企业版最先判断,不管买了几天都转人工。规则的顺序本身就是业务知识:如果把它放到最后,企业版第 3 天会被判成「全额退款」。
- `if plan == "annual" and days <= 14:` `<=` 而不是 `<`:第 14 天当天也算。这种边界恰好是新人客服最常算错、评测集里一定要有的用例。
- `return expected(plan, days) in agent_answer` 判卷:标准答案的关键词出现在回答里就算对。这是最天真的判法,练习 2 会让你骗过它。
- `CASES = [  # 套餐、买了几天、假设 Agent 这么回答` 五道题。回答是我手写的,模拟 Agent 可能给出的说法,其中故意埋了两个错。
- `("annual", 14, "已经第 14 天了,不能全额退,只能按月折算。"),` 边界错误:把「含第 14 天」理解成了「不含」。
- `("monthly", 3, "月付可以全额退款。"),` 规则错误:月付不退,它却承诺了。在真实客服里这种承诺会变成投诉或者公司亏钱。
- `passed += ok` 布尔值当 1 和 0 加,Day 432 起见过好几次。
- `print(f"{'对' if ok else '错'}  {plan:<10}` 每道题一行:对错、套餐、天数、标准答案、Agent 的回答。

</div>

```bash
uv run python part08/right_or_wrong.py
```

```text
对  annual     第 7天  应该:全额退款   Agent:您是年付首购第 7 天,可以全额退款。
错  annual     第14天  应该:全额退款   Agent:已经第 14 天了,不能全额退,只能按月折算。
对  annual     第15天  应该:不能全额退  Agent:超过 14 天,不能全额退,剩余整月按比例退。
错  monthly    第 3天  应该:不能全额退  Agent:月付可以全额退款。
对  enterprise 第 2天  应该:转人工    Agent:企业版合同单我帮您转人工,由客户成功经理处理。

3/5 答对
```

五道题,三对两错,机器自己判出来的,不需要任何人读一遍。现在试着给「AI 写周报」写一个 `expected()`:输入一周的工作记录,返回……什么?返回不出来。你最多能检查「有没有超过 500 字」「有没有提到每个项目」,但「写得好不好」这件事没有函数。这就是第二条标准的全部意思。

这个判卷函数很粗糙:它只认关键词,「不能全额退款」里也包含「全额退款」四个字。第六部分 [Day 350](/blog/agent-zero/day-350-judge-code/) 前后讲过判题器怎么写得更稳,SupportPilot 的评测(Day 476 起)会分两层,规则检查加 LLM 评审。今天只需要明白:**能写出判卷函数,是一切评测的前提;选题时就要确认它写得出来。**

## SupportPilot 要做成什么样

最后看一眼接下来 60 多天要搭出来的东西。一句话描述:**云簿的客服收到一张工单,SupportPilot 先判断这是什么问题,查帮助中心或业务库,能直接答的起草一份带出处的回复,涉及退款的算好金额、生成待审批的申请推到群里,有投诉威胁的直接转人工;客服人员在一个工作台上看到全过程,点确认才发出去。**

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="SupportPilot 的 60 天地图:左列是已经学过的七个部分,右列是毕业项目的阶段,箭头表示每个阶段主要用上了前面哪一部分">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="22" fill="var(--ink)">学过的部分</text>
    <text x="330" y="22" fill="var(--ink)">SupportPilot 的阶段(Day)</text>
    <rect x="20" y="34" width="200" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="30" y="53" fill="var(--ink-soft)">一 编程地基 / 二 大模型 API</text>
    <rect x="20" y="74" width="200" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="30" y="93" fill="var(--ink-soft)">四 RAG 与上下文</text>
    <rect x="20" y="114" width="200" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="30" y="133" fill="var(--ink-soft)">三 工具调用 / 五 MCP 与编排</text>
    <rect x="20" y="154" width="200" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="30" y="173" fill="var(--ink-soft)">六 评测与可观测</text>
    <rect x="20" y="194" width="200" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="30" y="213" fill="var(--ink-soft)">七 生产化与安全</text>
    <rect x="330" y="34" width="290" height="22" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="340" y="49" fill="var(--ink)">435–440 开题:选题、需求、PRD、架构</text>
    <rect x="330" y="60" width="290" height="22" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="340" y="75" fill="var(--ink)">441–446 搭骨架:仓库、配置、造数</text>
    <rect x="330" y="86" width="290" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="340" y="101" fill="var(--ink)">448–451 知识库:切块、混合检索、引用</text>
    <rect x="330" y="112" width="290" height="22" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="340" y="127" fill="var(--ink)">452–456 业务工具:权限、审批、MCP</text>
    <rect x="330" y="138" width="290" height="22" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="340" y="153" fill="var(--ink)">457–466 主工作流和记忆</text>
    <rect x="330" y="164" width="290" height="22" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="340" y="179" fill="var(--ink)">467–474 工作台界面、TS 写 Agent</text>
    <rect x="330" y="190" width="290" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="340" y="205" fill="var(--ink)">476–486 评测、迭代、可观测</text>
    <rect x="330" y="216" width="290" height="22" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="340" y="231" fill="var(--ink)">487–490 安全和上线</text>
    <rect x="330" y="242" width="290" height="22" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="340" y="257" fill="var(--ink)">491–497 包装作品、第二作品</text>
    <line x1="220" y1="49" x2="330" y2="71" stroke="var(--ink-faint)"/>
    <line x1="220" y1="89" x2="330" y2="97" stroke="var(--ink-faint)"/>
    <line x1="220" y1="129" x2="330" y2="123" stroke="var(--ink-faint)"/>
    <line x1="220" y1="129" x2="330" y2="149" stroke="var(--ink-faint)"/>
    <line x1="220" y1="169" x2="330" y2="201" stroke="var(--ink-faint)"/>
    <line x1="220" y1="209" x2="330" y2="227" stroke="var(--ink-faint)"/>
    <text x="20" y="294" fill="var(--ink-soft)">四条标准在哪里兑现:RAG 和工具 → 覆盖技能;476 起的评测 → 有对错;</text>
    <text x="20" y="312" fill="var(--ink-soft)">审批、转人工、注入防御 → 风险和取舍;业务库、群通知 → 对接企业系统</text>
  </g>
</svg>
<figcaption>左边是前七部分,右边是毕业项目按天的阶段,连线表示这个阶段主要用的是前面哪一部分。蓝色偏模型和检索,琥珀色偏工具和外部系统。每个阶段之间还有复习日,图里没画。</figcaption>
</figure>

你会发现几乎每一部分都有去处。这不是巧合,是选题时就挑了一个「业务本身需要所有这些东西」的题。也正因为它大,接下来几天要做的事情是**把它变小**:Day 436 从一次模拟访谈里拆需求,Day 437 写一页 PRD,把「本期不做什么」写清楚,Day 438 画架构,Day 439 排期和算成本。题目选得大不怕,怕的是不知道边界在哪。

## 动手练习

### 练习 1:给你自己的点子打分

想一个你自己想做的 Agent 项目(工作里的、生活里的都行),加进 `topic_score.py` 的 `TOPICS`,按四条标准打分并写理由。如果它总分低于 6,想一想怎么改题目能把分数提上去。

<details><summary>参考答案</summary>

示范一个:「帮我记账的 Agent」,把微信和支付宝的账单截图丢给它,它记到表格里。第一版打分 `[1, 1, 0, 0]`:用到了多模态和结构化输出,覆盖一般;识别出的金额和日期能和截图核对,有一点对错;没有风险,记错了自己改;不接任何系统。总分 2。

改题:「给小公司财务用的报销单审核 Agent」。员工上传发票和报销单,Agent 识别金额、核对报销规则(餐费上限、发票抬头、是否重复报销),超标的标红,通过的推给财务审批。

```python
    "报销单审核 Agent": ([2, 2, 2, 1], "规则可判对错,重复报销要查库,钱要审批,能接财务系统但我只能造数据"),
```

<div class="line-notes">

- `"报销单审核 Agent": ([2, 2, 2, 1],` 加在 `TOPICS` 字典里,和其他题目同一层缩进。工具调用(查历史报销)、RAG(报销制度文档)、评测(规则有对错)都是业务本身需要的,所以覆盖给 2;对接企业系统给 1,因为没有真实的财务系统,只能自己造一个假的库。

</div>

```text
覆盖高频技能  有对错可评测  有风险和取舍  对接企业系统
      2             2             2             2        总分 8  智能客服工单 SupportPilot:政策题有标准答案,退款要审批,要接业务库和知识库
      2             2             2             1        总分 7  报销单审核 Agent:规则可判对错,重复报销要查库,钱要审批,能接财务系统但我只能造数据
      1             2             1             1        总分 5  代码审查机器人:能用埋好的 bug 算召回,毕业项目最后几天的第二作品就做它
```

(只贴了前三行。)改题的方法基本固定:**找一个有规则、有钱或有风险、有人要审批的业务环节**,而不是找一个「AI 能生成点什么」的环节。这个报销审核的题和 SupportPilot 结构几乎一样,学完第八部分,你完全可以自己再做一遍当第三个作品。

</details>

### 练习 2:骗过判卷函数

`right_or_wrong.py` 里的 `judge` 只看关键词在不在回答里。请写一个**明明答错了却被判对**的用例加进 `CASES`,跑一次确认;然后改 `judge`,让它不再被骗,原来的五道题结果不变。

<details><summary>参考答案</summary>

年付第 7 天应该全额退。如果 Agent 回答「不能全额退款」,里面照样有「全额退款」四个字,会被判对。在 `CASES` 最后加一行:

```python
    ("annual", 7, "抱歉,年付第 7 天不能全额退款。"),
```

<div class="line-notes">

- `("annual", 7, "抱歉,年付第 7 天不能全额退款。"),` 答错了:应该能全额退,它说不能。但「不能全额退款」包含「全额退款」。

</div>

跑出来最后两行:

```text
对  annual     第 7天  应该:全额退款   Agent:抱歉,年付第 7 天不能全额退款。

4/6 答对
```

被骗了。修法是**先查否定的说法**:标准答案是「全额退款」时,回答里出现「不能全额退」就判错。

```python
def judge(plan: str, days: int, agent_answer: str) -> bool:
    want = expected(plan, days)
    if want == "全额退款" and "不能全额退" in agent_answer:
        return False
    return want in agent_answer
```

<div class="line-notes">

- `want = expected(plan, days)` 先算出标准答案,下面用两次。
- `if want == "全额退款" and "不能全额退" in agent_answer:` 应该能退,回答里却出现了否定说法,直接判错。
- `return want in agent_answer` 其余情况和原来一样。

</div>

```text
错  annual     第 7天  应该:全额退款   Agent:抱歉,年付第 7 天不能全额退款。

3/6 答对
```

原来五道题的结果没变(仍是三对两错),新加的这道被正确判错。但你应该已经感觉到了:这样一条条打补丁是补不完的,「无法全额退」「不支持全额退款」「全额退款恐怕不行」都能再骗它一次。这正是 SupportPilot 评测要分两层的原因:能用规则判的(金额、是否转人工、有没有引用)用规则判,用词千变万化的部分交给 LLM 评审,再用人工标注检查评审准不准(Day 476–479)。今天你亲手碰到了这堵墙,到时候就知道为什么要那样设计。

</details>

### 练习 3:给 JD 统计加一类,并想想它说明了什么

在 `jd_keywords.py` 的 `SKILLS` 里加一类「多轮对话/记忆」,正则自己写。跑完说说:12 句里它出现几次?这个数字能不能说明「记忆」是招聘方最看重的东西之一?

<details><summary>参考答案</summary>

在 `SKILLS` 里加一行,再在文件最后加三行,把命中的句子原样打印出来核对:

```python
    "对话/记忆": r"多轮|记忆|上下文",
```

<div class="line-notes">

- `"对话/记忆": r"多轮|记忆|上下文",` 加在 `SKILLS` 字典最后一项后面。「上下文」也算进来,因为「上下文管理」通常和记忆一起出现。

</div>

```python
for line in JD_LINES:
    if re.search(r"多轮|记忆|上下文", line):
        print(line)
```

<div class="line-notes">

- `for line in JD_LINES:` 逐句看,放在 `jd_keywords.py` 最后。
- `if re.search(r"多轮|记忆|上下文", line):` 和统计用的是同一个正则。
- `print(line)` 直接打印原句。别只打印编号再回去数,下标从 0 开始,人一数就容易错位。

</div>

```text
工具调用      5/12  #####
RAG/知识库   5/12  #####
评测        3/12  ###
部署运维      3/12  ###
安全权限      2/12  ##
对话/记忆     2/12  ##
开发Agent工作流、工具调用、记忆及多轮对话能力
理解 Agent 原理：function calling、上下文管理、记忆、RAG、多 Agent、沙箱隔离
```

我动手前凭印象猜的是 3 次,以为第 2 句「智能对话流程」也算。跑出来是 2 次:第 2 句里只有「对话」,不在正则里。这就是为什么要让代码数、再把命中的原句打出来核对,人读一遍很容易把相近的词算进去。要不要把「对话」也加进正则?加了第 2 句就会命中,但「智能对话流程设计」说的是对话产品,不一定是记忆。分类的边界本来就是主观的,写清楚规则比纠结数字更重要。

至于能不能说明「记忆」是招聘方最看重的之一:不能。12 句是我挑的,不是随机抽样;关键词出现不等于岗位看重它;一句话列五样技能,五样都算一次。站里完整数据里「上下文工程 / 记忆」在国内有正文的岗位中出现率是 52%,但这也只是「被提到」,不是「被看重」。用这种统计排除明显不对的方向可以,用它下结论要小心。

</details>

**验收标准**:三个脚本都在你电脑上跑出和文中一致的输出;能不看文章说出四条选题标准和每条的一个反例;练习 2 改完的 `judge` 对 6 道题判出 3 对 3 错;能用两三句话向别人解释「为什么不做 AI 写周报」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 毕业项目 / 作品项目 | 放进简历、面试时能深入讲的完整项目;本课是 SupportPilot |
| SupportPilot | 本课的毕业项目:给云簿 CloudLedger 用的智能客服工单 Agent |
| 选题标准 | 判断一个项目值不值得做的几条规则,本课用四条:覆盖高频技能、有对错、有风险和取舍、对接企业系统 |
| JD(Job Description) | 招聘岗位描述,写着职责和要求 |
| 正则表达式 | 描述文本模式的小语言,`RAG|知识库` 表示「RAG 或知识库」;Python 用 `re` 模块,和 JS 的 `/…/` 一样 |
| 判卷函数 | 输入题目和回答、输出对或错的函数;能写出它,题目才能自动评测 |
| τ-bench | Sierra 在 2024 年 6 月发布的客服 Agent 公开基准,用模拟用户多轮对话,看最后数据库状态对不对 |
| 业务规则 | 公司自己定的、有明确对错的规定,比如「年付首购 14 天内全额退」 |

## 常见误区

**选题看技术新不新。** 「多 Agent」「最新框架」不是需求。面试官问「为什么要多个 Agent」,你答「因为它是趋势」,这个项目就结束了。先有业务问题,再选技术。

**题目没有对错,打算「做完再想怎么评测」。** 做完你会发现根本想不出来,评测那一个多月学的东西全用不上。选题时就写一个最小的判卷函数,写不出来就换题。

**觉得客服太普通,想做个新奇的。** 普通恰恰是优点:面试官一听就懂业务,你不用花五分钟解释背景,可以直接讲技术取舍。新奇的题目常常要先花一半时间让对方理解你在做什么。

**用一个关键词统计就断定「市场最需要 X」。** 关键词会被重复计数,JD 之间互相抄,很多岗位没有正文。统计用来排除明显不对的方向够了,别拿它当结论引用。练习 3 里我凭印象猜的次数就和代码数的不一样。

**一上来就想做「全自动客服」。** 题目选大了没关系,但要能切小:SupportPilot 不自动退款、不直接给客户发消息,涉及钱的必须人点确认。Day 437 的 PRD 会把这些写成「非目标」。

**判卷函数只查关键词。** 「不能全额退款」里也有「全额退款」。规则判卷要先查否定,但补丁打不完,所以真正的评测要分层(练习 2)。

## 学习资料

### 文档与文章

- [Agent 工程师 JD 调研(2026-10)](/blog/agent-jd-report-2026-10/):本站自己的调研,今天那张技能比例表的出处,里面有抓取方法、正则规则和局限说明。30 分钟。
- [Sierra · τ-bench: Benchmarking AI agents for the real-world](https://sierra.ai/blog/benchmarking-ai-agents):τ-bench 的发布文章,看它怎么设计「模拟用户 + 业务工具 + 政策文档」的评测,和我们的客服场景几乎一样。20 分钟。论文在 [arXiv 2406.12045](https://arxiv.org/abs/2406.12045)。
- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):用一个真实产品讲为什么评测要从第一天开始,和今天「有对错」那一条是一个道理。英文,30 分钟。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):里面专门把客服列为 Agent 很合适的场景之一,理由是对话加动作、有明确的成功标准、能接人工。读它的附录部分,10 分钟。
- [Intercom · Fin](https://www.intercom.com/fin):一个真实的客服 Agent 产品页,看看它卖的是什么能力、怎么讲「解决率」,对你 Day 437 写验收指标有帮助。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1P6an6EEc9&autoplay=0&high_quality=1" title="为什么我不让 AI 客服直接回复用户？新思路构建可信赖的 AI 客服｜录屏精简版" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Koala聊开源 · 为什么我不让 AI 客服直接回复用户?新思路构建可信赖的 AI 客服 · 9 分钟,整段看。核心观点是 AI 客服要先可信再自动,和 SupportPilot「涉及钱的必须人点确认」是同一个思路,也正好是第三条标准「有风险和取舍」的一个例子。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1AshP6hEJa&autoplay=0&high_quality=1" title="GitHub上的项目能用来找工作吗？“包”进简历能混进公司吗？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑马尼古拉斯阿玮 · GitHub 上的项目能用来找工作吗? · 不到 2 分钟。讲的是拿别人的开源项目包装成自己的简历项目会在哪里露馅。这也是为什么我们要自己从选题、需求一路做起:面试官追问时,每个决定你都说得出来由。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RVnlB49gtW4" title="Why Decagon Bet on AI Customer Support" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>speedrun · Why Decagon Bet on AI Customer Support · 英文访谈。专做客服 Agent 的 Decagon 讲他们为什么选这个方向,听听做这个生意的人怎么看「客服适不适合 Agent」,和今天的四条标准对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/z9irn45ms9w" title="Sierra CEO Bret Taylor On Transforming Customer Engagement with AI" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>The Information · Sierra CEO Bret Taylor On Transforming Customer Engagement with AI · 英文访谈。τ-bench 就是 Sierra 发布的,可以和上面那篇文章一起看,了解他们为什么要专门给客服 Agent 做一个基准。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 1 章:讲怎么判断一个场景适不适合用基础模型做、怎么评估投入产出,和今天的选题标准角度不同但可以互相印证。1 小时。
- Rob Fitzpatrick《The Mom Test》(2013):一本很薄的小书,讲怎么和用户聊、才能问出真需求而不是客套话。明天 Day 436 的模拟访谈用得上,今天可以先读前两章。我没能确认它有没有正式的中文版,只写英文原版。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench) 和 [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench):看一眼它的 `policy` 文件和工具定义,就是一个「有对错的客服场景」写成代码的样子。SupportPilot 的评测(Day 476 起)可以借鉴它「看最后数据库状态」的判法。

## 自测

1. 说出四条选题标准,并给每条各举一个不满足它的题目。

<details><summary>答案</summary>

覆盖高频技能(反例:纯文案生成,用不上工具调用和检索);有对错可评测(反例:AI 写周报,好坏没有标准);有风险和取舍(反例:AI 起名字,出错了没有后果,也就没有审批、权限可设计);对接企业系统(反例:只调模型 API 的聊天机器人,讲不出数据库、审批流、群通知)。

</details>

2. 为什么「有对错」这条最重要?用今天的判卷函数说明。

<details><summary>答案</summary>

有对错才能写出判卷函数,有判卷函数才能自动评测,有评测才能说出「改了什么、分数从多少到多少」。`right_or_wrong.py` 里退款题能由代码算出标准答案,五道题自动判出三对两错;换成周报,`expected()` 根本写不出来,第六部分学的评测方法全都用不上,面试官问「你怎么知道它做得好」时就答不上来。

</details>

3. 关键词统计显示国内 JD 里「工具调用」出现率 55%,能不能直接说「55% 的岗位要求会工具调用」?为什么?

<details><summary>答案</summary>

不能。关键词出现不等于是要求,可能只是「了解即可」或者出现在公司介绍里;JD 之间互相抄;只统计了有正文的 334 条,Boss 直聘大部分岗位没抓到正文,样本有偏;一句话列五样技能会全部计数。这个统计适合判断「哪几样是高频的那一档」,不适合引用成精确比例。

</details>

4. `expected()` 里为什么要先判断企业版,再判断年付 14 天?换个顺序会怎样?

<details><summary>答案</summary>

企业版是合同单,不管买了几天都转人工,这是优先级最高的规则。如果先判断「年付且 14 天内」,一个年付的企业版客户第 3 天来问,会被判成「全额退款」,正是访谈里那种「客服给企业版客户承诺了全额退款」的事故。规则的顺序本身就是业务知识,写判卷函数和写业务代码时都要按优先级排。

</details>

5. **面试题**:「你为什么选智能客服做毕业项目?这不是很普通吗?」

<details><summary>答案</summary>

我选题用了四条标准,客服四条都满足。第一,它天然覆盖招聘里最高频的几样:政策问题要 RAG,查账单要工具调用,回复对不对要评测,给真人用要部署,我看过 500 多条 JD,这几样在国内外都是出现最多的那一档。第二,它有对错:退款资格、扣款记录都有标准答案,我能写出判卷函数,所以能建评测集、能说出每次改动让通过率变了多少。第三,它有真实风险:涉及钱,所以退款必须人工审批;有投诉威胁要转人工;工单里可能有注入,这些让权限、审批、审计都有了用武之地。第四,它要接业务库、知识库、审批群通知。普通反而是优点,面试官一听就懂业务,我们可以直接聊技术取舍;而且海外 Sierra、Decagon 这些公司就专做这个,Sierra 还发布了客服 Agent 基准 τ-bench,说明这个场景有明确的对错和商业价值。

</details>

## 明天预告

明天是 Day 436 · 像 FDE 那样拆需求:先访谈,再写代码。今天定了「做客服工单」,但「智能客服」四个字底下到底要做什么,还是一团雾。明天模拟一次和云簿客服负责人的访谈,学海外很多岗位要求的那种 FDE(前线部署工程师)的做法:每句话问「这是事实还是情绪、背后的真实问题是什么、怎么验收」,把一段乱糟糟的对话拆成能写代码、能验收的需求表。今天的判卷函数里那条「企业版转人工」,明天你会看到它是从访谈的哪一句话里来的。
