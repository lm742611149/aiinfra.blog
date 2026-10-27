---
title: 'Day 515 · 行业里的 Agent(二):SaaS 客服、金融、医疗、电商'
description: '用昨天的五项框架拆四个行业,每个行业读一个公开案例并标明哪些数字是公司自己说的,再各写一个能跑的小演示:客服里「什么算解决」换一种定义结果差多少;金融里回答里的每个数字都要能对上工具返回;医疗里准确率 95% 的模型召回率可以是 0;电商里知识库检索必须带店铺参数。最后把四个行业放进同一张迁移表,练习写一段两分钟的迁移讲稿。'
pubDate: 2026-10-27
regime: none
tags: ['industry', 'guardrail', 'evaluation', 'interview', 'agent-zero']
series: 'agent-zero'
day: 515
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 514](/blog/agent-zero/day-514-industry-1/) 数了 JD 里提到哪些行业(并抽样发现那个统计有四分之一到三成的误判),然后讲了换行业时要换的五样东西:知识源、工具、红线、验收指标、出错代价,还写了 `IndustryProfile` 和 `validate`,用来检查红线是不是只放在了提示词里。

今天把这套框架用到四个行业上:SaaS 客服、金融、医疗、电商。每个行业我会放一个公开的案例,每个数字都标出处和「谁说的」,因为大部分效果数字是公司自己披露的,没有第三方审计。每个行业再配一个很小的、能跑的演示,把案例里的那个关键点变成代码。

## 今天要解决的问题

今天结束时你应该能:

1. 各用一句话说出四个行业的 Agent 最关键的那条约束(客服:什么算解决;金融:数字来自系统;医疗:漏报比误报贵;电商:按店铺隔离)。
2. 区分一个案例里哪些数字是公司自己说的、哪些是第三方说的,面试时引用不翻车。
3. 写出并运行四个小演示:`resolved.py`、`numcheck.py`、`recall.py`、`shop_rules.py`,并说出每一个在 SupportPilot 里对应哪个模块。
4. 把四个行业的 `IndustryProfile` 放进一张迁移表,写一段两分钟的「迁移讲稿」。

预计用时 3 小时。前置:[Day 514](/blog/agent-zero/day-514-industry-1/) 的 `profile.py`(今天会 import 它);SupportPilot 的引用([Day 451](/blog/agent-zero/day-451-kb-citation/))、审批([Day 414](/blog/agent-zero/day-414-approval-design/))、评测([Day 476](/blog/agent-zero/day-476-eval-scenarios/))。今天不调模型,花费 ¥0。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `untraced`;做练习,做不出再展开参考答案,看完关掉重写一遍。

今天四个行业加四个演示,内容比较满。如果觉得吃不下,可以拆成两次读:客服加金融一次,医疗加电商一次。

## SaaS 客服:什么算「解决」

这是你最熟的场景,也是 Agent 落地最早、竞争最激烈的地方。海外有 Intercom 的 Fin、Sierra、Decagon,国内几乎每个云厂商和客服 SaaS 都有自己的大模型客服。

### 案例一:按结果收费

先看定价,因为定价方式反过来决定了工程上要做什么。Intercom 的 Fin 官网([fin.ai/pricing](https://fin.ai/pricing),2026 年 10 月查)写的是「From $0.99/outcome」,也就是每个「结果」从 0.99 美元起收。Sierra 不公开价格,它的官方博客把这种模式叫 outcome-based pricing:只在 Agent 达成约定结果时收钱,比如解决了一次咨询、挽回了一次退订([Sierra 博客](https://sierra.ai/blog/outcome-based-pricing-for-ai-agents))。

按结果收费听起来对客户很友好,对工程师的意思是:**「什么算解决」必须能被机器判断,而且判断标准要经得起客户审计。** 最省事的定义是「Agent 回答之后,用户没有再来求助」,但这个定义有明显的漏洞:用户被气走了、不再回复,也会被算成「解决」。

### 演示一:换一种定义,解决率差多少

下面是 8 条虚构的对话记录,每条有四个字段:回答后用户又来求助了吗、有没有转人工、用户打的分、人工复核后判断是不是气走的。数据是我编的,为了演示两种定义差在哪里。

```python
# agent-zero-lab/part09/industry/resolved.py
from dataclasses import dataclass


@dataclass
class Conv:
    cid: str
    asked_again: bool    # Agent 回答之后,用户又来求助了吗
    handoff: bool        # 转了人工吗
    csat: int | None     # 用户给的评分 1 到 5,没评就是 None
    left_angry: bool     # 人工复核后判断:用户是气走的


CONVS = [
    Conv("c1", False, False, 5, False),
    Conv("c2", False, False, None, False),
    Conv("c3", False, False, None, True),   # 没再问,但是气走了
    Conv("c4", True, True, 3, False),
    Conv("c5", False, False, 1, True),      # 没再问,打了 1 分
    Conv("c6", False, False, 4, False),
    Conv("c7", True, False, None, True),
    Conv("c8", False, False, None, False),
]


def resolved_v1(c: Conv) -> bool:
    """按「之后没再要求帮助」算解决(按结果收费里常见的写法)。"""
    return not c.asked_again


def resolved_v2(c: Conv) -> bool:
    """再加两条:没转人工;打了分的话不低于 4 分。没打分的看人工复核结论。"""
    if c.asked_again or c.handoff:
        return False
    if c.csat is not None:
        return c.csat >= 4
    return not c.left_angry


if __name__ == "__main__":
    n = len(CONVS)
    for name, f in [("v1 没再问就算", resolved_v1), ("v2 加评分和复核", resolved_v2)]:
        ok = [c.cid for c in CONVS if f(c)]
        print(f"{name}: {len(ok)}/{n} = {len(ok) / n:.0%}  {ok}")
```

<div class="line-notes">

- `csat: int | None` `int | None` 是「整数或者空」,[Day 45](/blog/agent-zero/day-045-type-hints-1/) 的写法。没评分的用户占多数,所以必须能表示「没有」。
- `Conv("c3", False, False, None, True),   # 没再问,但是气走了` 这条是漏洞的样本:没再来求助,没评分,但人工复核后发现是气走的。
- `Conv("c5", False, False, 1, True),      # 没再问,打了 1 分` 用户用最低分告诉你他不满意,然后走了。
- `return not c.asked_again` v1 一行搞定:没再求助就是解决。c1、c2、c3、c5、c6、c8 六条没再来,全部算解决。
- `if c.asked_again or c.handoff:` v2 先排除两种明显没解决的:又来求助,或者最终还是转了人工。c4(转人工)和 c7(又来求助)在这里被排掉。
- `if c.csat is not None:` 有评分的听用户的:4 分以上才算。c5 打了 1 分,c6 打了 4 分,c1 打了 5 分。
- `return not c.left_angry` 没评分的看人工复核结论。c3 被判气走,所以不算;c2、c8 算。
- `ok = [c.cid for c in CONVS if f(c)]` 把函数 `f` 当参数传进来,同一个循环里依次用 v1 和 v2 算。函数也是值,和 JS 里一样。
- `{len(ok) / n:.0%}` 6/8 = 0.75,打印成 `75%`。

</div>

```bash
uv run python -m part09.industry.resolved
```

```text
v1 没再问就算: 6/8 = 75%  ['c1', 'c2', 'c3', 'c5', 'c6', 'c8']
v2 加评分和复核: 4/8 = 50%  ['c1', 'c2', 'c6', 'c8']
```

同样 8 条对话,v1 说 75% 解决,v2 说 50%。差的 25 个百分点里有 c3 和 c5(用户气走了)。**如果你是按 v1 的定义向客户收钱,那就是在为气走的用户收费;如果你是在评估自己的 Agent,v1 会让你高估三成。** 所以按结果收费的产品,「什么算解决」的代码要经得起客户审计,每一单都要留下证据(是哪条规则判的、依据是什么)。这和 [Day 372](/blog/agent-zero/day-372-feedback-1/) 讲的隐式反馈采集直接相关:没评分的用户是多数,要靠行为和复核补出信号。

### 案例二:Klarna,转人工是产品的一半

Klarna 在 2024 年 2 月发新闻稿([Klarna 新闻稿](https://www.klarna.com/international/press/klarna-ai-assistant-handles-two-thirds-of-customer-service-chats-in-its-first-month/),这个页面对脚本请求返回 202,需要浏览器打开)说:接入 OpenAI 的 AI 助手第一个月处理了 230 万次对话,占客服聊天量的三分之二,工作量相当于 700 名全职客服,平均解决时间从 11 分钟降到 2 分钟以内。这几个数字都是 Klarna 自己说的。The Pragmatic Engineer 当时写了一篇分析([原文](https://blog.pragmaticengineer.com/klarnas-ai-chatbot/)),它没有质疑这些数字,批评的是包装:自动化第一线客服不是什么革命,电话菜单和老办法早就做过类似的事。

2025 年 5 月,Klarna 的 CEO 对彭博说,之前把成本看得太重,导致服务质量下降,公司开始重新招人工客服,强调「客户想找人的时候总该有人」([CX Dive,2025-05-09](https://www.customerexperiencedive.com/news/klarna-reinvests-human-talent-customer-service-AI-chatbot/747586/))。

这件事给工程师的教训很具体:三分之二的对话被 AI 接住了,剩下的三分之一恰好是最复杂、最情绪化的部分。**转人工不是兜底功能,是产品的一半。** 什么时候转、转的时候带什么上下文、人工接手后能不能看到 Agent 查过什么,都要单独设计和评测。SupportPilot 里你做过转人工的条件,面试时可以拿 Klarna 讲为什么这个节点要单独评测。

### 案例三:Air Canada,Agent 说出口的话公司要认

2024 年 2 月,加拿大 BC 省民事仲裁庭(Civil Resolution Tribunal)判 Air Canada 败诉,案号 2024 BCCRT 149。事情是:乘客在祖母去世后问网站上的聊天机器人丧亲票价怎么申请,机器人说可以先买票、事后申请退差价;实际政策不允许事后申请。Air Canada 辩称聊天机器人是独立的实体,公司不为它说的话负责,仲裁员没有采纳,判公司赔偿([判决原文](https://decisions.civilresolutionbc.ca/crt/crtd/en/525448/1/document.do),对脚本返回 403,需浏览器打开;[Kiplinger 报道](https://kiplinger.com/personal-finance/travel/air-canada-to-pay-a-partial-refund-for-chatbot-error))。赔的钱只有几百加元,不同报道的总额略有出入(我看到过 650.88 和 812 两种写法),所以我不在这里引用具体金额。

判决的意思很清楚:**Agent 说出口的政策,公司要认。** 所以客服 Agent 回答政策类问题时,带上引用出处([Day 451](/blog/agent-zero/day-451-kb-citation/))不只是为了让用户信服,也是给公司自己留证据,方便事后查到底是知识库写错了,还是模型编的。

**五项:** 知识源是帮助中心和政策文档;工具是账单、订单、工单系统;红线是退款、改价、承诺政策例外必须走审批或只能引用原文;指标是解决率、转人工率、满意度(并且要说清「解决」的定义);出错代价从退一单钱到被告上仲裁庭。

## 金融:先做内部助手,数字来自系统

金融是海外 JD 里被提到最多的行业(昨天的数字,打过折)。走得最靠前的落地方式,几乎都是**先给内部员工用,不直接面对客户**。

### 案例:摩根士丹利

摩根士丹利的内部助手 AI @ Morgan Stanley Assistant 基于 OpenAI 的 GPT-4,让理财顾问查询公司内部大约 10 万份研究和流程文档。10 万份这个数字出自公司的 McMillan 对 CNBC 的说法,我引用的是二手报道([PYMNTS,2023-09](https://www.pymnts.com/artificial-intelligence-2/2023/morgan-stanley-to-launch-ai-powered-assistant-for-financial-advisors/));早期试点的规模不同报道说法不一,我不引用具体人数。2024 年 6 月,公司又加了一个会议纪要工具 Debrief,在客户同意的前提下记录会议、起草跟进事项、写回 Salesforce,InvestmentNews 当时报道的采用率是 98%([InvestmentNews,2024-06-28](https://www.investmentnews.com/fintech/morgan-stanleys-open-ai-powered-solution-for-advisors-has-expanded/254880)),这个数字是公司自己说的。

这个案例里值得学的是两个设计选择。第一,**知识源是封闭的、审核过的**,不是开放网页。金融机构最怕的不是模型答不出来,是模型引用了一个没审核过的说法,顾问又转述给客户。第二,**输出给的是顾问,不是客户**。顾问是持牌的人,最后对客户说什么由他负责,Agent 只是让他更快找到材料。

国内的情况类似:从抓到的 JD 看,金融 Agent 岗写的场景大多是投研辅助、客户经理助手、风控审核辅助、合规文档审查(比如昨天样本里「投研信息检索与分析」「研报摘要」),直接给 C 端客户做投资建议的很少。

### 演示二:回答里的每个数字都要对得上工具返回

金融 Agent 最硬的一条规则:**数字必须来自系统,不能来自模型。** 持仓多少、收益率多少、费率多少,一律由工具查出来,模型只负责组织语言。在 SupportPilot 里,退款金额必须来自账单工具的返回值,是同一条规则。下面把它写成一个检查:从回答里抽出所有数字,看有没有哪个数字是任何一次工具返回里都没有的。

先写第一版,只认工具返回里的数值:

```python
# agent-zero-lab/part09/industry/numcheck.py  (第一版)
import re

NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def numbers_in(text: str) -> set[str]:
    return {m.replace(",", "") for m in NUM.findall(text)}


def flatten(obj: object) -> list[object]:
    if isinstance(obj, dict):
        return [x for v in obj.values() for x in flatten(v)]
    if isinstance(obj, list):
        return [x for v in obj for x in flatten(v)]
    return [obj]


def allowed(tool_results: list[dict[str, object]]) -> set[str]:
    out: set[str] = set()
    for r in tool_results:
        for v in flatten(r):
            if isinstance(v, (int, float)):
                out.add(f"{v:g}")
    return out


def untraced(reply: str, tool_results: list[dict[str, object]]) -> set[str]:
    return numbers_in(reply) - allowed(tool_results)


if __name__ == "__main__":
    tool = [{"holding_cny": 150000, "ytd_return_pct": 4.35, "fee_rate_pct": 1.2, "as_of": "2026-10-20"}]
    good = "截至 2026-10-20,您的持仓为 150,000 元,今年以来收益率 4.35%。"
    bad = "您的持仓 150,000 元,按这个势头全年大约能做到 8.7%。"
    print("good:", untraced(good, tool))
    print("bad: ", untraced(bad, tool))
```

```text
good: {'10', '20', '2026'}
bad:  {'8.7'}
```

`bad` 抓对了:8.7% 是模型自己把 4.35 乘以 2 推出来的「年化」,工具里没有,必须拦。但 `good` 也被误拦了,它被指出来的是 `2026`、`10`、`20`,也就是日期。原因是工具返回里的日期是字符串 `"2026-10-20"`,第一版的 `allowed` 只收了数值类型(`int`、`float`),字符串里的数字被忽略了。

第二版做两处改动:字符串里的数字也收进来;并且把数字规范成统一写法再比较,否则 `150,000`、`150000`、`150000.0` 会被当成三个不同的数。(顺带一个小坑:第一版用的 `f"{v:g}"` 对一百万以上的数会输出 `1e+06` 这种科学计数法,所以改成了自己写的 `norm`。)

```python
# agent-zero-lab/part09/industry/numcheck.py
import re
from collections.abc import Mapping, Sequence

NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def norm(s: str) -> str:
    """去掉千分位逗号和小数末尾的 0:'150,000' -> '150000','8.70' -> '8.7'。"""
    s = s.replace(",", "")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def numbers_in(text: str) -> set[str]:
    return {norm(m) for m in NUM.findall(text)}


def flatten(obj: object) -> list[object]:
    if isinstance(obj, Mapping):
        return [x for v in obj.values() for x in flatten(v)]
    if isinstance(obj, list):
        return [x for v in obj for x in flatten(v)]
    return [obj]


def allowed(tool_results: Sequence[Mapping[str, object]]) -> set[str]:
    out: set[str] = set()
    for r in tool_results:
        for v in flatten(r):
            if isinstance(v, (int, float)):
                out.add(norm(str(v)))
            elif isinstance(v, str):
                out |= numbers_in(v)          # 日期字符串里的 2026、10、20 也算系统给的
    return out


def untraced(reply: str, tool_results: Sequence[Mapping[str, object]]) -> set[str]:
    """回答里出现、但任何一次工具返回里都没有的数字。"""
    return numbers_in(reply) - allowed(tool_results)


if __name__ == "__main__":
    tool = [{"holding_cny": 150000, "ytd_return_pct": 4.35, "fee_rate_pct": 1.2, "as_of": "2026-10-20"}]
    good = "截至 2026-10-20,您的持仓为 150,000 元,今年以来收益率 4.35%。"
    bad = "您的持仓 150,000 元,按这个势头全年大约能做到 8.7%。"
    print("good:", untraced(good, tool))
    print("bad: ", untraced(bad, tool))
```

<div class="line-notes">

- `NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")` 匹配一个数字:以数字开头,后面可以跟数字或逗号(千分位),再可选地跟小数点加数字。`150,000` 整个匹配成一个,`4.35` 也是一个。
- `def norm(s: str) -> str:` 规范化:`150,000` 去掉逗号变成 `150000`;`8.70` 先去掉末尾的 0 再去掉孤零零的小数点,变成 `8.7`。整数 `150000` 里没有小数点,直接返回,不会把末尾的 0 删掉。
- `if "." in s:` 只有带小数点的才删末尾的 0,否则 `150000` 会被删成 `15`。这是个很容易踩的坑。
- `return {norm(m) for m in NUM.findall(text)}` 集合推导式:先找出所有数字,再逐个规范化,最后得到一个集合(自动去重)。回答 `150,000 元` 得到 `'150000'`。
- `def flatten(obj: object) -> list[object]:` 递归把任意嵌套的字典和列表摊平成一维列表。工具返回可能是 `{"items": [{"amount": 10}, ...]}` 这种多层结构。
- `if isinstance(obj, Mapping):` `Mapping` 是「字典这一类」的统称,字典是其中之一。
- `out.add(norm(str(v)))` 数值先转字符串再规范化,`4.35` 变 `'4.35'`,`150000` 变 `'150000'`。
- `elif isinstance(v, str):` 第二版新加的分支。字符串值(日期、订单号)里的数字也算系统给的。
- `out |= numbers_in(v)` `|=` 是集合的「并入」。`"2026-10-20"` 提出 `2026`、`10`、`20` 三个数加进允许集合。
- `return numbers_in(reply) - allowed(tool_results)` 集合相减:回答里有、但允许集合里没有的数字。`good` 得到空集合,`bad` 得到 `{'8.7'}`。

</div>

```bash
uv run python -m part09.industry.numcheck
```

```text
good: set()
bad:  {'8.7'}
```

这个检查还有明显的局限,你要知道它挡不住什么:**它只检查数字「在不在」,不检查数字「对不对位」。** 如果模型把持仓和费率说反了(`150,000` 说成费率),两个数字都在工具返回里,检查照样通过。它也不懂语义换算:工具返回小数 `0.0435`,回答里写 `4.35%`,会被拦(练习 1 处理)。后面 BillSleuth 那一课([Day 688](/blog/agent-zero/day-688-bs-grounded-1/))会做一个更完整的「数字溯源校验器」,今天这个是它的最小雏形。

**五项:** 知识源是审核过的研报、产品文档、合规手册;工具是持仓、净值、客户画像、风控系统,几乎全部只读;红线是不编数字、不给超出适当性的建议、不承诺收益,都要落到输出检查而不是提示词;指标是检索命中率、顾问采纳率、节省时长,以及合规抽检通过率;出错代价是监管处罚和声誉。另外,每次回答引用了哪些文档、调了哪些工具、谁批准的,都要能事后调出来([Day 364](/blog/agent-zero/day-364-tracing-concepts/) 的 trace),这在金融里不是锦上添花,是上线前提。

## 医疗:红线写在法规里,漏报比误报贵

医疗是出错代价最高的行业,也是红线最明确的行业,有些事法规直接写了不能做。

### 案例:国内处方规定和 C 端、医生端两类产品

国家卫健委办公厅和国家中医药局办公室 2022 年发布的《互联网诊疗监管细则(试行)》里有一句:「处方应由接诊医师本人开具,严禁使用人工智能等自动生成处方」([中新网报道,2022-06-27](https://www.chinanews.com.cn/cj/2022/06-27/9789307.shtml))。这一条直接框住了医疗 Agent 的边界:它可以帮医生整理病历、提示风险、查文献,可以给患者做健康科普和导诊,但「开药」这个动作必须是医生做的。

C 端的典型是蚂蚁的 AI 健康应用「阿福」。科技日报 2026 年 2 月 24 日报道,蚂蚁在 2 月 23 日披露阿福 App 总用户数超过 1 亿([科技日报](https://www.stdaily.com/web/gdxw/2026-02/24/content_476005.html))。9 月外滩大会上公布了更大的数字(1.5 亿用户、单日健康咨询近 2000 万人次),虎嗅的文章指出这两个数字的口径从未被清晰定义:1.5 亿是累计注册数、月活约 3000 万,2000 万人次包含了支付宝小程序、硬件和 App 全渠道([虎嗅,2026-09-11](https://www.huxiu.com/article/4890516.html))。这些全是蚂蚁自己说的数字,是一个很好的「同一个产品,两个口径」的例子。

医生端的典型是「环境式病历」(ambient documentation):医生看诊时 Agent 在旁边听,结束后自动生成病历草稿,医生审核签字。海外的 Abridge 是代表,下面的视频是它的工程师讲从病历记录走向临床辅助。这个场景里 Agent 只写草稿,写进正式病历必须医生确认。

### 演示三:为什么医疗看召回率,不看准确率

医疗评测和别的行业有一个根本区别:**漏报比误报贵得多。** 一个用药风险提醒,误报十次医生会烦,漏报一次可能出事。如果只看准确率,会被骗得很惨。下面造 100 条用药提醒的玩具数据:5 条是真有风险的,95 条没有。分数是我随机生成的演示数据,不是真实模型的输出。

```python
# agent-zero-lab/part09/industry/recall.py
# 一百条用药提醒的玩具数据:5 条是真有风险的(1),95 条没风险(0)。分数是我编的演示数据。
import random

random.seed(3)
labels = [1] * 5 + [0] * 95
scores = [round(random.uniform(0.55, 0.95), 2) for _ in range(5)] + [round(random.uniform(0.0, 0.7), 2) for _ in range(95)]


def evaluate(threshold: float) -> dict[str, float]:
    pred = [1 if s >= threshold else 0 for s in scores]
    tp = sum(p == 1 and y == 1 for p, y in zip(pred, labels))
    fp = sum(p == 1 and y == 0 for p, y in zip(pred, labels))
    fn = sum(p == 0 and y == 1 for p, y in zip(pred, labels))
    tn = sum(p == 0 and y == 0 for p, y in zip(pred, labels))
    return {"准确率": (tp + tn) / len(labels), "召回率": tp / (tp + fn), "误报条数": fp, "漏报条数": fn}


if __name__ == "__main__":
    print("高风险 5 条的分数:", scores[:5])
    print("什么都不提醒(阈值 1.01):", evaluate(1.01))
    for th in (0.9, 0.7, 0.5):
        print(f"阈值 {th}:", evaluate(th))
```

<div class="line-notes">

- `random.seed(3)` 固定随机种子,你跑出来的分数和我的一样。
- `labels = [1] * 5 + [0] * 95` 前 5 条是真有风险的,标签 1;后 95 条没风险,标签 0。`[1] * 5` 是 `[1, 1, 1, 1, 1]`。
- `scores = [round(random.uniform(0.55, 0.95), 2) for _ in range(5)]` 模型给每条打的「有风险的分数」。真有风险的 5 条分数在 0.55 到 0.95 之间,没风险的 95 条在 0 到 0.7 之间,两段有重叠,这就是模型分不清的地方。
- `pred = [1 if s >= threshold else 0 for s in scores]` 分数达到阈值就提醒(1),否则不提醒(0)。
- `tp = sum(p == 1 and y == 1` 真阳性:该提醒、也提醒了。`zip` 把预测和标签配成对,条件为真的数一个。
- `fp = sum(p == 1 and y == 0` 误报:不该提醒、提醒了,医生白看一眼。
- `fn = sum(p == 0 and y == 1` 漏报:该提醒、没提醒,这是最贵的一类。
- `"准确率": (tp + tn) / len(labels)` 所有判对的(该提醒的提醒了、不该的没提醒)占总数的比例。同一行的 `"召回率": tp / (tp + fn)` 是所有真有风险的里,被抓出来的比例,5 条里抓到几条。
- `evaluate(1.01)` 阈值设成 1.01,分数最高才 1,所以谁也达不到,等于「什么都不提醒」。

</div>

```bash
uv run python -m part09.industry.recall
```

```text
高风险 5 条的分数: [0.65, 0.77, 0.7, 0.79, 0.8]
什么都不提醒(阈值 1.01): {'准确率': 0.95, '召回率': 0.0, '误报条数': 0, '漏报条数': 5}
阈值 0.9: {'准确率': 0.95, '召回率': 0.0, '误报条数': 0, '漏报条数': 5}
阈值 0.7: {'准确率': 0.97, '召回率': 0.8, '误报条数': 2, '漏报条数': 1}
阈值 0.5: {'准确率': 0.64, '召回率': 1.0, '误报条数': 36, '漏报条数': 0}
```

看第一行:**什么都不提醒的模型,准确率 95%,召回率 0%,漏掉了全部 5 条。** 95 条没风险的它都答对了,所以准确率很好看,但它一条真正的风险都没抓到。阈值 0.9 是一样的情况。阈值降到 0.7,召回率到 80%,代价是误报 2 条;降到 0.5,5 条全抓到了,但误报多到 36 条,准确率掉到 64%,医生会被淹没。

所以医疗评测里,第一指标是高风险类别的召回率,并且接受一定的误报,具体接受多少要**先和医生一起定「哪些错误是不可接受的」,再定阈值**,而不是先定一个准确率目标。练习 3 会把这个「接受多少」写成一个代价函数。

数据合规也比别的行业重:病历是敏感个人信息,能不能出院区、能不能调用公有云模型,每家医院规定不同。很多医院项目最后选的是私有化部署开源模型([Day 567](/blog/agent-zero/day-567-self-host-1/) 讲什么时候值得),原因不是效果更好,是数据不能出去。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/u6q-byPWUuo" title="From Ambient Documentation to Clinical Intelligence — Chaitanya Asawa, Abridge" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · From Ambient Documentation to Clinical Intelligence(Abridge 工程师 Chaitanya Asawa)· 看他怎么讲病历草稿的评测和医生审核环节。</figcaption>
</figure>

**五项:** 知识源是诊疗指南、药品说明书、本院既往病历;工具是检验结果、病历系统读取,写操作只能写草稿区;红线是不开处方、不下诊断,写入正式病历必须医生签字;指标是高风险类别召回率、医生修改率、节省的文书时间;出错代价是病历里写错药名或剂量,伤害到人。

## 电商:量大、多店铺、大促是考场

电商的 Agent 分两类用户:面向买家的售前导购和售后客服,面向商家的经营助手。

### 案例:京小智 5.0

京东在 2025 年 9 月 25 日的全球科技探索者大会上发布京小智 5.0,定位是电商智能客服的行业 Agent 原生应用,面向京东的中小商家免费开放。京东披露的 5 万家店铺内测数据:转人工率降低 28% 以上,用户满意度提升 15% 以上,售前咨询转化率提升 37% 以上;三星京东自营旗舰店的案例里,导购场景转化率提升 27.6%,转人工率降低 43%([品玩,2025-09-25](https://www.pingwest.com/w/307975))。**这些全是京东自己披露的数字,没有第三方复核**,而且「提升 37% 以上」是相对内测前的比例,没说基线是多少。

电商和 SupportPilot 比,有四个明显不同:

**量和峰值。** 大促零点的咨询量是平时的几十倍,Agent 服务要扛得住峰值,成本也要按峰值算。[Day 399](/blog/agent-zero/day-399-model-routing/) 讲的模型路由在这里很实用:「我的快递到哪了」用小模型加订单工具就够,复杂的售后才上大模型。

**多模态。** 买家发一张商品破损的照片要求退款,发一张别家的截图问有没有同款。视觉输入([Day 245](/blog/agent-zero/day-245-vision-1/))在电商客服里是刚需,不是加分项。

**导购直接影响收入。** 客服答错是体验问题,导购推错了就是少卖一单。所以导购的指标是转化率和客单价,评测要能做 A/B,只做离线测试集不够。

**商家规则千差万别。** 同一个平台上,每家店的退换货规则、优惠规则都不同。知识库要按店铺隔离。

### 演示四:检索必须带店铺参数

先看一个「忘了隔离」会发生什么。两家虚构店铺的退换货规则放在一起,检索函数的 `shop` 参数默认是 `None`(不过滤):

```python
# agent-zero-lab/part09/industry/shop_rules.py  (第一版)
RULES = [
    {"shop": "A", "text": "A 店:签收后 7 天内可无理由退货,运费由买家承担"},
    {"shop": "A", "text": "A 店:定制商品不支持退货"},
    {"shop": "B", "text": "B 店:签收后 30 天内可无理由退货,运费由商家承担"},
]


def search(query: str, shop: str | None = None) -> list[str]:
    out = []
    for r in RULES:
        if shop is not None and r["shop"] != shop:
            continue
        if query in r["text"]:
            out.append(r["text"])
    return out


if __name__ == "__main__":
    print("不隔离:", search("退货"))
    print("只看 A:", search("退货", shop="A"))
```

```text
不隔离: ['A 店:签收后 7 天内可无理由退货,运费由买家承担', 'A 店:定制商品不支持退货', 'B 店:签收后 30 天内可无理由退货,运费由商家承担']
只看 A: ['A 店:签收后 7 天内可无理由退货,运费由买家承担', 'A 店:定制商品不支持退货']
```

「不隔离」那行是个事故:A 店的买家问「能退货吗」,Agent 会把 B 店「30 天、运费商家承担」的规则当成依据答出去,商家 A 就要为一个不是它定的承诺赔付。更糟的是,这个 bug 在开发时很难发现,因为只有一家店的测试数据不会暴露它。

修法不是「记得传 `shop`」,而是**让不传 `shop` 根本调不通**。第二版把它改成必须传的、只能用关键字传的参数:

```python
# agent-zero-lab/part09/industry/shop_rules.py
# 两家虚构店铺的退换货规则
RULES = [
    {"shop": "A", "text": "A 店:签收后 7 天内可无理由退货,运费由买家承担"},
    {"shop": "A", "text": "A 店:定制商品不支持退货"},
    {"shop": "B", "text": "B 店:签收后 30 天内可无理由退货,运费由商家承担"},
]


def search(query: str, *, shop: str) -> list[str]:
    """最土的关键词检索:规则里含有「退货」就命中。shop 必须传,而且只看这家店。"""
    out = []
    for r in RULES:
        if r["shop"] != shop:
            continue
        if query in r["text"]:
            out.append(r["text"])
    return out


if __name__ == "__main__":
    print("只看 A:", search("退货", shop="A"))
    print("只看 B:", search("退货", shop="B"))
```

<div class="line-notes">

- `RULES = [` 两家店的规则放在同一个列表里,每条带一个 `shop` 字段,相当于多租户的最小形态。
- `def search(query: str, *, shop: str) -> list[str]:` 参数列表里的 `*` 把后面的参数变成「只能用关键字传」,而且 `shop` 没有默认值,所以每次调用都必须写 `shop=...`。相当于 TypeScript 里把 `shop` 放进一个必填的 options 对象。
- `if r["shop"] != shop:` 不是这家店的规则直接跳过,不再有「`None` 表示不过滤」这个后门。
- `if query in r["text"]:` 最土的关键词检索,字符串里含有查询词就命中。真实系统里换成向量检索,但「先按店铺过滤再检索」这个顺序不变。
- `print("只看 A:", search("退货", shop="A"))` A 店得到两条自己的规则。
- `print("只看 B:", search("退货", shop="B"))` B 店只得到自己那一条。

</div>

```bash
uv run python -m part09.industry.shop_rules
```

```text
只看 A: ['A 店:签收后 7 天内可无理由退货,运费由买家承担', 'A 店:定制商品不支持退货']
只看 B: ['B 店:签收后 30 天内可无理由退货,运费由商家承担']
```

再故意忘记传 `shop`:

```python
search("退货")
```

```text
Traceback (most recent call last):
  File "<string>", line 3, in <module>
TypeError: search() missing 1 required keyword-only argument: 'shop'
```

`missing 1 required keyword-only argument: 'shop'` 的意思是「少了一个必须用关键字传的参数」。这个错在你写代码的时候就暴露,而不是上线后被买家撞到。这是红线的**工具层权限**落点:不靠提醒,靠接口形状让错误的调用写不出来。商家侧也是一样的思路,改动前先展示给商家确认(审批节点)。

**五项:** 知识源是商品详情、店铺规则、平台规则;工具是订单、物流、库存、优惠券;红线是检索只能在当前店铺范围内(工具层)、超出店铺规则的赔付和改价必须商家确认(审批);指标是转人工率、解决率、导购转化率;出错代价是赔付、差评和平台处罚。

## 四个行业放在一张表里

昨天的 `IndustryProfile` 现在可以把四个行业放在一起。`saas_support.py` 昨天建过;今天新建 `industries.py`,放金融、医疗、电商三个,并把四个放进 `ALL`:

```python
# agent-zero-lab/part09/industry/industries.py
from part09.industry.profile import IndustryProfile, RedLine, Tool, show
from part09.industry.saas_support import SAAS_SUPPORT

FINANCE = IndustryProfile(
    name="金融:理财顾问内部助手",
    knowledge=["审核过的研报", "产品说明书", "合规手册"],
    tools=[Tool("get_holdings", "read"), Tool("get_fund_nav", "read"), Tool("search_research", "read")],
    redlines=[
        RedLine("回答里的数字必须来自工具返回,对不上就拦下", "guardrail"),
        RedLine("不承诺收益、不暗示保本,命中合规词表就拦下", "guardrail"),
        RedLine("只对持牌顾问输出,不直接发给客户", "approval"),
    ],
    metrics=["检索命中率", "顾问采纳率", "节省时长", "合规抽检通过率"],
    cost_of_error="监管处罚、声誉损失",
)

HEALTHCARE = IndustryProfile(
    name="医疗:病历草稿助手",
    knowledge=["诊疗指南", "药品说明书", "本院既往病历"],
    tools=[Tool("get_lab_results", "read"), Tool("get_emr", "read"), Tool("save_draft", "write")],
    redlines=[
        RedLine("只能写草稿区,写入正式病历必须医生签字", "approval"),
        RedLine("不开处方、不下诊断(国内监管细则:处方须接诊医师本人开具)", "tool_permission"),
    ],
    metrics=["高风险类别召回率", "医生修改率", "节省的文书时间"],
    cost_of_error="病历里写错药名或剂量,伤害到人",
)

ECOMMERCE = IndustryProfile(
    name="电商:商家客服",
    knowledge=["商品详情页", "本店退换货规则", "平台规则"],
    tools=[Tool("get_order", "read"), Tool("get_logistics", "read"), Tool("issue_coupon", "write")],
    redlines=[
        RedLine("检索只能在当前店铺范围内,shop 参数必传", "tool_permission"),
        RedLine("超出店铺规则的赔付和改价必须商家确认", "approval"),
    ],
    metrics=["转人工率", "解决率", "导购转化率"],
    cost_of_error="赔付、差评、平台处罚",
)

ALL = [SAAS_SUPPORT, FINANCE, HEALTHCARE, ECOMMERCE]

if __name__ == "__main__":
    for p in ALL[1:]:
        show(p)
        print()
```

<div class="line-notes">

- `FINANCE = IndustryProfile(` 金融,三条红线分别落在两个层:数字溯源和合规词表是输出检查(`guardrail`),「只对持牌顾问输出」是审批层。对应演示二。
- `Tool("get_holdings", "read"), Tool("get_fund_nav", "read"), Tool("search_research", "read")` 三个工具全部只读,金融助手起步阶段不碰任何写操作。
- `Tool("save_draft", "write")` 医疗唯一的写操作是写草稿区,配合红线「写入正式病历必须医生签字」(审批)。
- `RedLine("不开处方、不下诊断(国内监管细则:处方须接诊医师本人开具)", "tool_permission")` 医疗这条落在工具层:根本没有「开处方」这个工具。
- `RedLine("检索只能在当前店铺范围内,shop 参数必传", "tool_permission")` 电商这条就是演示四的 `search(query, *, shop)`。
- `ALL = [SAAS_SUPPORT, FINANCE, HEALTHCARE, ECOMMERCE]` 四个放进一个列表,下面练习和讲稿都可以遍历它。
- `for p in ALL[1:]:` 切片 `[1:]` 去掉第一个(SupportPilot 昨天已经展示过),只打印三个新的。

</div>

```bash
uv run python -m part09.industry.industries
```

```text
== 金融:理财顾问内部助手 ==
知识源: 审核过的研报、产品说明书、合规手册
工具:   get_holdings(read)、get_fund_nav(read)、search_research(read)
红线:   回答里的数字必须来自工具返回,对不上就拦下  [guardrail]
红线:   不承诺收益、不暗示保本,命中合规词表就拦下  [guardrail]
红线:   只对持牌顾问输出,不直接发给客户  [approval]
指标:   检索命中率、顾问采纳率、节省时长、合规抽检通过率
出错代价: 监管处罚、声誉损失
检查:   通过

== 医疗:病历草稿助手 ==
知识源: 诊疗指南、药品说明书、本院既往病历
工具:   get_lab_results(read)、get_emr(read)、save_draft(write)
红线:   只能写草稿区,写入正式病历必须医生签字  [approval]
红线:   不开处方、不下诊断(国内监管细则:处方须接诊医师本人开具)  [tool_permission]
指标:   高风险类别召回率、医生修改率、节省的文书时间
出错代价: 病历里写错药名或剂量,伤害到人
检查:   通过

== 电商:商家客服 ==
知识源: 商品详情页、本店退换货规则、平台规则
工具:   get_order(read)、get_logistics(read)、issue_coupon(write)
红线:   检索只能在当前店铺范围内,shop 参数必传  [tool_permission]
红线:   超出店铺规则的赔付和改价必须商家确认  [approval]
指标:   转人工率、解决率、导购转化率
出错代价: 赔付、差评、平台处罚
检查:   通过
```

三个行业的 `validate` 全部通过:每个都有至少 3 个工具、至少 2 条红线、没有任何一条只放在提示词里。再看「SupportPilot 的模块在每个行业怎么动」这张迁移表,也写成脚本:

```python
# agent-zero-lab/part09/industry/migrate.py
INDUSTRIES = ["金融", "医疗", "电商"]

# 模块 -> 各行业要怎么动
MIGRATION: dict[str, list[str]] = {
    "知识库 RAG": ["保留架构,换成审核过的研报;长 PDF 表格解析加强", "保留,换指南和说明书;否定句和剂量数字单独评测", "保留,按店铺隔离"],
    "业务工具 MCP": ["换持仓、净值工具,全部只读", "换病历接口,写操作只写草稿区", "换订单、物流、优惠券,加图片输入"],
    "审批闸门": ["扩成合规审核节点,留审计", "写入正式病历都要医生签", "只在赔付、改价时触发"],
    "评测": ["加数字溯源检查和合规抽检", "高风险类别单独算召回率", "加线上 A/B 看转化率"],
}


def table() -> str:
    lines = ["| SupportPilot 模块 | " + " | ".join(INDUSTRIES) + " |", "| --- | " + " | ".join("---" for _ in INDUSTRIES) + " |"]
    for module, cells in MIGRATION.items():
        lines.append(f"| {module} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


if __name__ == "__main__":
    assert all(len(v) == len(INDUSTRIES) for v in MIGRATION.values())
    print(table())
```

<div class="line-notes">

- `INDUSTRIES = ["金融", "医疗", "电商"]` 表的列头。SaaS 客服是出发点,不占一列。
- `MIGRATION: dict[str, list[str]] = {` 每个模块一行,值是一个列表,三格对应上面三个行业。
- `"知识库 RAG": ["保留架构,换成审核过的研报;长 PDF 表格解析加强",` 金融:骨架不变,换知识源。
- `"审批闸门": ["扩成合规审核节点,留审计",` 同一个模块在三个行业里的含义不一样:金融扩成合规审核、医疗是医生签字、电商只在赔付改价时触发。
- `lines = ["| SupportPilot 模块 | " + " | ".join(INDUSTRIES) + " |",` 先拼表头行,`" | ".join(...)` 把列表用竖线连起来。
- `for module, cells in MIGRATION.items():` 一行行拼 markdown 表格。
- `assert all(len(v) == len(INDUSTRIES) for v in MIGRATION.values())` 防止某个模块漏填一格,漏了会直接报 `AssertionError`,而不是打印一张歪的表。

</div>

```bash
uv run python -m part09.industry.migrate
```

```text
| SupportPilot 模块 | 金融 | 医疗 | 电商 |
| --- | --- | --- | --- |
| 知识库 RAG | 保留架构,换成审核过的研报;长 PDF 表格解析加强 | 保留,换指南和说明书;否定句和剂量数字单独评测 | 保留,按店铺隔离 |
| 业务工具 MCP | 换持仓、净值工具,全部只读 | 换病历接口,写操作只写草稿区 | 换订单、物流、优惠券,加图片输入 |
| 审批闸门 | 扩成合规审核节点,留审计 | 写入正式病历都要医生签 | 只在赔付、改价时触发 |
| 评测 | 加数字溯源检查和合规抽检 | 高风险类别单独算召回率 | 加线上 A/B 看转化率 |
```

这张表可以直接贴进你的 README 或者面试前的笔记里。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="四个行业的红线分别落在哪一层">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <text x="250" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">prompt</text>
  <text x="350" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">guardrail</text>
  <text x="450" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool_permission</text>
  <text x="560" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">approval</text>
  <text x="20" y="74" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">客服(SupportPilot)</text>
  <line x1="20" y1="88" x2="620" y2="88" stroke="var(--rule)"/>
  <text x="250" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">-</text>
  <circle cx="350" cy="70" r="9" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <circle cx="560" cy="70" r="9" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="20" y="114" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">金融</text>
  <line x1="20" y1="128" x2="620" y2="128" stroke="var(--rule)"/>
  <text x="250" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">-</text>
  <circle cx="350" cy="110" r="9" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <circle cx="560" cy="110" r="9" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="20" y="154" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">医疗</text>
  <line x1="20" y1="168" x2="620" y2="168" stroke="var(--rule)"/>
  <text x="250" y="154" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">-</text>
  <circle cx="450" cy="150" r="9" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <circle cx="560" cy="150" r="9" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="20" y="194" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">电商</text>
  <line x1="20" y1="208" x2="620" y2="208" stroke="var(--rule)"/>
  <text x="250" y="194" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">-</text>
  <circle cx="450" cy="190" r="9" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <circle cx="560" cy="190" r="9" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="20" y="218" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">按本篇 IndustryProfile 里的红线统计:没有任何一条只落在 prompt 上</text>
</svg>
<figcaption>四个行业的红线落点(来自今天各行业 profile 的红线字段,不是行业统计)。琥珀色是权限和审批这类「模型绕不过去」的层,蓝色是输出检查。</figcaption>
</figure>

## 动手练习

### 练习 1:百分数和小数

工具返回收益率是小数 `0.0435`,回答里写 `4.35%`。现在的 `untraced` 会把 `4.35` 判成没有出处。写 `untraced_pct`,让「小数乘 100 之后能对上」也放行,但 `8.7` 仍然要被拦。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex515_pct.py
from collections.abc import Mapping, Sequence

from part09.industry.numcheck import allowed, norm, numbers_in


def untraced_pct(reply: str, tool_results: Sequence[Mapping[str, object]]) -> set[str]:
    ok = allowed(tool_results)
    # 工具给的小数(0.0435)回答里写成百分数(4.35)是合理的转换,多放行一份 ×100 的版本
    for s in list(ok):
        try:
            ok.add(norm(f"{float(s) * 100:.6f}"))
        except ValueError:
            pass
    return numbers_in(reply) - ok


if __name__ == "__main__":
    tool = [{"ytd_return": 0.0435, "holding_cny": 150000}]
    print(untraced_pct("今年以来收益率 4.35%,持仓 150,000 元", tool))
    print(untraced_pct("今年以来收益率 8.7%,持仓 150,000 元", tool))
```

<div class="line-notes">

- `ok = allowed(tool_results)` 先拿到原来的允许集合:`{'0.0435', '150000'}`。
- `for s in list(ok):` 遍历的同时要往 `ok` 里加东西,所以先 `list(ok)` 拷贝一份再遍历,否则 Python 会报 `RuntimeError: Set changed size during iteration`。
- `ok.add(norm(f"{float(s) * 100:.6f}"))` 每个允许的数再乘 100 放行一份:`0.0435 × 100` 是 `4.35`,格式化成 `4.350000`,`norm` 去掉末尾的 0 得到 `'4.35'`。保留 6 位小数是为了消掉浮点误差(`0.0435 * 100` 实际是 `4.3500000000000005`)。
- `except ValueError:` 允许集合里的元素都是数字字符串,理论上不会出错;留着是因为将来如果有人往里放了别的东西,不至于整个检查崩掉。
- `150000` 也被乘了 100 变成 `15000000` 放行,这是这个做法的代价:允许集合变大了,漏检的可能性也大了一点。

</div>

```bash
uv run python -m part09.ex.ex515_pct
```

```text
set()
{'8.7'}
```

第一条回答通过,第二条的 `8.7` 被拦。注意代价:放行的数变多,碰巧撞上的概率也多了一点。更严格的做法是只对名字带 `return`、`rate`、`pct` 的字段做 ×100,这需要工具返回带字段名的语义,留给你。

</details>

### 练习 2:两分钟迁移讲稿

选一个行业,写一段两分钟(大约 400 到 500 字)的口头讲稿,回答「你做的是 SaaS 客服,我们是 X 行业,你觉得要改什么」。要求:五项都提到;至少讲一条红线,并说清它落在代码的哪一层;最后诚实讲一件你不懂的事。再写一个小脚本检查这几点。

<details><summary>参考答案</summary>

下面是金融的示范讲稿和检查脚本。字数估算按每分钟 250 个汉字,这是我的假设,真实语速因人而异,你自己念一遍计时。

```python
# agent-zero-lab/part09/ex/ex515_speech.py
import re

SPEECH = """面试官好,我做过一个客服 Agent,叫 SupportPilot。如果搬到理财顾问的内部助手上,骨架不变,我会改五样东西。
第一是知识源。客服用的是帮助中心文章,理财顾问这边换成审核过的研报和产品说明书,封闭的,不让模型去引用没审核过的说法。
第二是工具。持仓和净值全部只读起步,先不碰任何写操作。
第三是红线,我只讲一条。我在客服项目里做过一个规则,退款金额必须来自账单工具的返回值,模型不能自己算。搬到金融,我会把它扩到所有数字,收益率、持仓、费率,回答里每个数字都要能对上一次工具调用,对不上就拦下来。这条写在输出检查的代码里,不放在提示词里。
第四是验收指标。客服看解决率,这里我会看顾问采纳率和合规抽检通过率,还有检索命中率。
第五是出错代价。客服错一单,退一笔钱。金融错一次,可能是监管处罚,所以审计日志要在上线前就有,每个回答引了哪些文档、调了哪些工具都能查。
最后说我不懂的部分。适当性管理的具体条款我没做过,我会先找合规部门要一份不能说的话的清单,再找业务方要三十条真实问题,先做内部工具,不碰客户。"""

KEYS = ["知识源", "工具", "红线", "指标", "代价"]
LAYER_WORDS = ["代码", "提示词", "审批", "权限"]


def check(text: str) -> None:
    n = len(re.findall(r"[一-鿿]", text))
    print(f"汉字 {n},按每分钟 250 字估计约 {n / 250:.1f} 分钟")
    print("五项都提到了吗:", {k: (k in text) for k in KEYS})
    print("有没有说红线落在哪一层:", [w for w in LAYER_WORDS if w in text])


if __name__ == "__main__":
    check(SPEECH)
```

<div class="line-notes">

- `SPEECH = """` 三个引号包起来的多行字符串,里面可以直接换行。第一句先交代自己做过什么,再说「骨架不变,改五样」,面试官一听就知道结构。
- `这条写在输出检查的代码里,不放在提示词里。` 讲稿里这一句是「红线落在哪一层」的回答,脚本会靠「代码」「提示词」这两个词检测到它。
- `KEYS = ["知识源", "工具", "红线", "指标", "代价"]` 检查五项有没有都出现。这只是关键词检查,出现了不等于讲得好,但没出现一定是漏讲了。
- `n = len(re.findall(r"[一-鿿]", text))` 数汉字个数。`[一-鿿]` 是汉字的 Unicode 范围,标点和英文不算。
- `{k: (k in text) for k in KEYS}` 字典推导式,每一项对应「文本里有没有这个词」。
- `[w for w in LAYER_WORDS if w in text]` 列出讲稿里出现了哪几个「落点词」。

</div>

```bash
uv run python -m part09.ex.ex515_speech
```

```text
汉字 389,按每分钟 250 字估计约 1.6 分钟
五项都提到了吗: {'知识源': True, '工具': True, '红线': True, '指标': True, '代价': True}
有没有说红线落在哪一层: ['代码', '提示词']
```

389 字大约 1.6 分钟,在两分钟以内。五项都有,红线也讲了落点。你自己写的时候别照抄这份:讲稿的价值在于每句话都是你做过的事,面试官追问「你说的那个检查怎么写」,你得答得出来,而昨天的 `profile.py` 和今天的 `numcheck.py` 就是你的底气。

</details>

### 练习 3:把「漏报多贵」写成代价函数

演示三里阈值选 0.9 还是 0.5,取决于漏报比误报贵多少。写 `total_cost(threshold, cost_fn)`:漏报一条的代价是 `cost_fn`,误报一条记作 1。再写 `best_threshold(cost_fn)` 在 0 到 1 之间每隔 0.05 找总代价最低的阈值,看看漏报代价是 100、20、5、1 时,最优阈值怎么变。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex515_cost.py
from part09.industry.recall import evaluate

COST_FP = 1.0   # 误报一条的代价:医生多看一眼,记作 1


def total_cost(threshold: float, cost_fn: float) -> float:
    r = evaluate(threshold)
    return r["漏报条数"] * cost_fn + r["误报条数"] * COST_FP


def best_threshold(cost_fn: float) -> float:
    candidates = [t / 100 for t in range(0, 101, 5)]
    return min(candidates, key=lambda t: total_cost(t, cost_fn))


if __name__ == "__main__":
    for cost_fn in (100.0, 20.0, 5.0, 1.0):
        th = best_threshold(cost_fn)
        r = evaluate(th)
        print(f"漏报代价 {cost_fn:>5.0f}: 最优阈值 {th:.2f},漏报 {r['漏报条数']:.0f} 条,误报 {r['误报条数']:.0f} 条")
```

<div class="line-notes">

- `from part09.industry.recall import evaluate` 直接复用演示三的 `evaluate`,不重写一遍。
- `COST_FP = 1.0` 误报的代价当作单位 1,其他代价都相对它说,「漏报是误报的多少倍」比绝对数字好讨论。
- `return r["漏报条数"] * cost_fn + r["误报条数"] * COST_FP` 总代价 = 漏报条数 × 漏报代价 + 误报条数 × 误报代价。阈值 0.5 时漏报 0、误报 36,代价是 36;阈值 0.9 时漏报 5、误报 0,漏报代价 100 时总代价是 500。
- `candidates = [t / 100 for t in range(0, 101, 5)]` 0.00、0.05、0.10……1.00 共 21 个候选阈值。用整数除以 100 而不是直接累加 0.05,是为了避免浮点累加误差。
- `return min(candidates, key=lambda t: total_cost(t, cost_fn))` `min` 的 `key` 参数指定「按什么比大小」,返回总代价最低的那个阈值。多个并列时返回第一个(最小的阈值)。
- `{cost_fn:>5.0f}` 右对齐占 5 格,不带小数。

</div>

```bash
uv run python -m part09.ex.ex515_cost
```

```text
漏报代价   100: 最优阈值 0.65,漏报 0 条,误报 10 条
漏报代价    20: 最优阈值 0.65,漏报 0 条,误报 10 条
漏报代价     5: 最优阈值 0.70,漏报 1 条,误报 2 条
漏报代价     1: 最优阈值 0.75,漏报 2 条,误报 0 条
```

漏报的代价是误报的 20 倍以上时,最优阈值都落在 0.65,5 条风险全抓到,代价是 10 条误报。漏报代价降到 5 倍,允许漏 1 条换更少的误报;降到和误报一样(1),最优就变成漏 2 条、零误报,「漏报也只是多一条记录」,这时选的就是准确率最高的那个点。所以**阈值怎么选取决于漏报多贵,而这个数字不是数据科学家能定的,要和医生一起定**。这里的 100、20、5 都是我随手假设的,不是任何真实医院的数字。

</details>

**验收标准**

- 四个演示都能跑出和文中一致的输出。
- 你能解释 `resolved.py` 里 v1 和 v2 差 25 个百分点是哪两条造成的。
- 你写出了自己的两分钟讲稿,并且读出声计过时。
- 能说出四个行业案例里至少三个数字是谁说的(公司自己说的就要标出来)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 按结果收费(outcome-based pricing) | 只在 Agent 达成约定结果(比如解决了一次咨询)时才收钱,要求「结果」能被机器判断和审计 |
| 隐式反馈 | 用户没有明说,但从行为里能看出的满意或不满,比如又来求助、转人工、直接走了 |
| 适当性管理 | 金融监管里的一类要求:给什么样的客户推荐什么样的产品要匹配,不能乱推 |
| 数字溯源 | 回答里的每个数字都能对上某次工具调用的返回值,对不上就拦下 |
| 环境式病历(ambient documentation) | 医生看诊时 Agent 在旁听,结束后自动生成病历草稿,医生审核签字 |
| 召回率 | 所有真正该报的里,被报出来的比例。5 条真风险抓到 4 条,召回率 80% |
| 误报 / 漏报 | 误报是不该报的报了(白打扰);漏报是该报的没报(可能出事) |
| 阈值 | 模型给的分数达到多少才触发提醒,调它就是在误报和漏报之间做取舍 |
| 多租户 / 店铺隔离 | 同一套系统服务很多商家,每家的数据和规则互相看不见 |
| keyword-only 参数 | Python 里参数列表里的 `*` 之后的参数,只能 `名字=值` 地传,不能按位置传 |

## 常见误区

**引用案例时不说「谁说的」。** 「Klarna 的 AI 相当于 700 个客服」是 Klarna 自己说的,一年后它又在重新招人工。面试时说「公司披露……」比说「据报道……」稳得多。

**把「没再来求助」当成「解决」。** 演示一里 v1 比 v2 高了 25 个百分点,差的就是气走的用户。

**数字检查只查「在不在」。** `numcheck` 挡不住「数字都在、但张冠李戴」,要对位校验必须带字段名,更完整的做法在后面 BillSleuth 那一课。

**医疗只看准确率。** 一个什么都不报的模型准确率 95%,一条真风险都没抓到。看召回率,并且先和医生定「不可接受的错误」。

**忘了隔离,靠自觉记得传参数。** 能让接口形状把错误的调用拦在写代码的时候(必传的关键字参数),就别指望每个人都记得。

**把一个行业的案例数字,拿去另一个行业讲。** 京东的「转人工率降 28%」是电商客服的数字,拿到银行面试里说没有意义。

## 学习资料

### 文档与文章

- [Fin 定价页](https://fin.ai/pricing):Intercom 的 AI 客服的定价,今天讲的按结果收费的真实例子,2026 年 10 月查到「From $0.99/outcome」。
- [Sierra · outcome-based pricing 博客](https://sierra.ai/blog/outcome-based-pricing-for-ai-agents):Sierra 怎么解释按结果收费,以及它对「结果」的定义。
- [The Pragmatic Engineer · Klarna's AI chatbot](https://blog.pragmaticengineer.com/klarnas-ai-chatbot/):一个冷静的工程师视角,怎么读公司披露的数字。
- [CX Dive · Klarna 重新招人工客服(2025-05-09)](https://www.customerexperiencedive.com/news/klarna-reinvests-human-talent-customer-service-AI-chatbot/747586/):CEO 原话,「成本被看得太重」。
- [Kiplinger · Air Canada 聊天机器人案](https://kiplinger.com/personal-finance/travel/air-canada-to-pay-a-partial-refund-for-chatbot-error):案情和判决的英文报道;判决原文要用浏览器打开(链接在上面客服一节)。
- [InvestmentNews · 摩根士丹利助手扩展](https://www.investmentnews.com/fintech/morgan-stanleys-open-ai-powered-solution-for-advisors-has-expanded/254880) 和 [PYMNTS · 摩根士丹利发布助手](https://www.pymnts.com/artificial-intelligence-2/2023/morgan-stanley-to-launch-ai-powered-assistant-for-financial-advisors/):金融内部助手的两篇报道,注意哪些数字是公司自己说的。
- [中新网 · 互联网诊疗监管细则](https://www.chinanews.com.cn/cj/2022/06-27/9789307.shtml):处方由医师本人开具、严禁 AI 自动生成处方的原文出处。
- [虎嗅 · 蚂蚁阿福 1.5 亿用户的口径](https://www.huxiu.com/article/4890516.html):读厂商披露数字时「口径」怎么追问的范例。
- [品玩 · 京小智 5.0 发布](https://www.pingwest.com/w/307975):电商客服的内测数据,京东自己披露。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1P3gs6uEbJ&autoplay=0&high_quality=1" title="Agent为什么难落地?企业级AI Agent落地的5大核心挑战与解决方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · Agent为什么难落地?企业级AI Agent落地的5大核心挑战与解决方案|腾讯、阿里、百度企业级实践深度拆解 · 19 分钟,讲企业落地卡在哪(数据权限、系统集成、效果验收),对照四个行业的红线听。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ermCBcEFR&autoplay=0&high_quality=1" title="5个企业级Agent落地案例效果预览介绍" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>韦东东666 · 5个企业级Agent落地案例效果预览介绍 · 13 分钟,看几个不同行业的 Agent 做成什么样,练习:用五项框架给每个案例找知识源、工具和红线。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/QDXqUejasH8" title="Bret Taylor of Sierra on AI agents, outcome-based pricing, and the OpenAI board" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Stripe · Bret Taylor of Sierra on AI agents, outcome-based pricing, and the OpenAI board · Sierra 创始人聊客服 Agent 和按结果收费,对照今天「什么算解决」那一节。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):评测和落地的章节对应今天的「验收指标」,尤其是讲评测指标和人工评审的部分。按目录挑读。

### 开源项目与代码

- [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench):Sierra 研究团队开源的客服场景 Agent 评测基准(航空、零售、电信等领域,带规则和工具)。读它怎么把「客服任务是否完成」定义成可自动判断的,和今天演示一对照。

## 自测

1. 按结果收费的客服产品里,「没再来求助就算解决」这个定义有什么漏洞?怎么补?

<details><summary>答案</summary>

用户被气走、没再回复,也会被算成解决,会高估解决率,按这个收费等于为不满意的用户收钱。补法:排除转了人工的、又来求助的;有评分的按评分(比如 4 分以上);没评分的靠行为信号或人工抽检复核。每一单要留下判定依据,客户审计时拿得出来。演示里 v1 是 75%,v2 是 50%。

</details>

2. Klarna 的案例里,哪些数字是公司自己说的?后来发生了什么?

<details><summary>答案</summary>

230 万次对话、占客服聊天量三分之二、相当于 700 名全职客服、解决时间从 11 分钟降到 2 分钟以内,这些是 2024 年 2 月 Klarna 新闻稿里自己披露的。2025 年 5 月 CEO 对彭博说成本被看得太重导致服务质量下降,开始重新招人工客服,并强调客户想找人时要有人。教训:转人工是产品的一半,不能只看自动化率。

</details>

3. `numcheck` 第一版为什么把 `2026-10-20` 里的数字拦了?第二版怎么修?它还挡不住什么?

<details><summary>答案</summary>

第一版的 `allowed` 只收了 `int` 和 `float` 类型的值,日期是字符串 `"2026-10-20"`,里面的 2026、10、20 没被收进允许集合。第二版把字符串里的数字也用 `numbers_in` 提出来并入,并且用 `norm` 把 `150,000`、`8.70` 这类写法规范化。它挡不住「数字都在工具返回里,但张冠李戴」,比如把持仓和费率说反;也不懂小数和百分数的换算。

</details>

4. 为什么医疗评测不能只看准确率?给出一个具体数字例子。

<details><summary>答案</summary>

100 条里 5 条真有风险,模型什么都不提醒,95 条没风险全答对,准确率 95%,召回率 0%,一条真风险都没抓到。医疗里漏报一次可能出事,误报十次只是医生烦,所以要单独看高风险类别的召回率,阈值由「漏报比误报贵多少」决定,这个比例要和医生一起定。

</details>

5. 电商里「检索不带店铺参数」会出什么事故?怎么在接口层避免?

<details><summary>答案</summary>

A 店的买家问退货,Agent 可能引用了 B 店「30 天、运费商家承担」的规则答出去,A 店要为不是自己定的承诺赔付。避免的办法是让 `shop` 成为没有默认值的、只能用关键字传的必填参数,不传在调用处就报 `TypeError`,而不是上线后才发现。

</details>

6. (面试题)面试官问:「你怎么证明你的客服 Agent 有用?」结合今天的内容,说出一个要小心的指标陷阱。

<details><summary>答案</summary>

先说指标:解决率、转人工率、满意度,配合抽检。陷阱是「解决」的定义:如果只看用户有没有再来求助,气走的用户会被算成解决,解决率虚高。应该同时看评分、转人工、复核抽样,并且说明每一单的判定依据可追溯。也可以补一句:公司自己公布的数字(比如某厂商的转人工率降低百分之多少)没有第三方复核,引用时要说清来源。

</details>

## 明天预告

[Day 516](/blog/agent-zero/day-516-basic-graduation/) · 普通篇结业:能力自检和接下来怎么进阶。普通篇到这里就走完了:从 Python 地基、Agent 循环、RAG、MCP、评测到上线,再到简历、面试、求职和行业。明天是最后一天:对照真实 JD 给自己的能力逐项打勾,清点作品,把没达标的部分排进计划,再看接下来往资深方向怎么走。
