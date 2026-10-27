---
title: 'Day 436 · 像 FDE 那样拆需求:先访谈,再写代码'
description: '毕业项目开工前最容易被跳过的一步:先和客户聊清楚。今天让模型扮演云簿的客服负责人老周,用同一个人设对比「问意见」和「问过去」两种访谈方式,实测前者问出 0 条事实、后者问出 10 条;再把访谈原话拆成「真实问题、需求、验收办法」的需求表,写一个脚本检查每条需求都有验收办法、每条访谈事实都有去处,把 Day 435 里简化过的退款规则补完整。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'supportpilot', 'fde', 'requirements', 'interview', 'agent-zero']
series: 'agent-zero'
day: 436
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 435](/blog/agent-zero/day-435-capstone-why/) 定下了毕业项目:给虚构的 SaaS 公司云簿 CloudLedger 做 SupportPilot,一个智能客服工单 Agent。选题用了四条标准(覆盖高频技能、有对错、有风险和取舍、对接企业系统),还写了一个只有 20 行的判卷函数,里面的退款规则是简化版:年付首购 14 天内全额退,月付不退,企业版转人工。当时留了一句话,「完整规则明天从访谈里拆」。

今天兑现这句话。题目选好了,可是「智能客服」四个字底下到底要做什么,现在还是一团雾。你现在手上能写的代码,只能是你自己猜的需求。猜错了,做到第三周才发现,返工的代价比今天花的三小时大得多。

## 今天要解决的问题

今天讲两件事:**怎么访谈**,以及**怎么把访谈结果拆成能验收的需求**。学完你应该能:

1. 说出访谈里「问意见」和「问过去」的区别,并用一个模拟实验看到它们问出的信息量差多少。
2. 给一个业务场景写出访谈清单:几个固定话题,每个话题配一个「最近一次」式的问题。
3. 把一段乱糟糟的访谈原话拆成四列的需求表(原话、真实问题、需求、怎么验收),并用脚本检查两件事:每条要做的需求都写得出验收办法;访谈里问出来的每条事实都有去处。
4. 把 Day 435 简化过的退款规则补成完整的一张表,并说出每一条是从访谈里哪句话来的。

今天会花几分钱调模型(扮演客户),每个脚本不到 ¥0.03。预计用时 2.5–3 小时。前置:[Day 435](/blog/agent-zero/day-435-capstone-why/) 的选题和判卷函数;`common/llm.py` 里的 `LLMClient`(Day 135–137 建的,今天直接用);[Day 50](/blog/agent-zero/day-050-dataclass/) 的 dataclass;Day 435 用过的 `re` 正则。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把「问过去」的三条规矩和需求表的四列默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:你收到过的需求

你大概收到过这样的需求单:「把订单列表的筛选做得更好用一点。」你做出来,产品说不是这个意思;再改一版,运营又说他要的是导出。最后翻出来才发现,真正的问题是运营每天要手工筛出「昨天退款的订单」给财务,一共点十一下,他想要一个按钮。

「更好用」是结论,不是需求。需求藏在「最近一次他是怎么做的」里。前端同学吃过这种亏,好处是不用我解释它多疼。Agent 项目里这个坑更深,因为大模型太能干了:你随便写句「帮我处理客服工单」,它也能给你一个看起来像那么回事的东西。看起来像,但没人知道对不对。

所以做 Agent 的人,比做普通业务开发的人更需要这一步:**先弄清楚什么叫对,再动手**。

## FDE 是干什么的

Day 435 统计招聘要求时,你看到海外岗位里「面向客户、交付」出现得很多。这类岗位最常见的名字叫 Forward Deployed Engineer,简称 FDE,中文常译成前线部署工程师(也叫驻场工程师,国内叫法不统一)。

我查到的说法是:这个岗位由 Palantir 推广开,工程师被派到客户那里,在客户自己的环境里把系统做出来、接起来、一直维护到真正能用;后来 OpenAI、Anthropic 这类 AI 公司也开了类似岗位,招聘启事里常把它比作「小团队里的 CTO」。这些信息来自招聘页和几家厂商博客,起源时间各处说法不完全一致,我没找到权威的统计,所以只当背景听,不当事实引用(参见 [Kanerika 的介绍](https://kanerika.com/blogs/forward-deployed-engineer/))。

你不需要投这个岗位也能用上它的做法。FDE 的日常是三步:去客户那里听,把含糊的话拆成能写代码、能验收的东西,然后自己动手做。你投 Agent 工程师,面试官问「这个项目的需求哪来的」,你答「我自己想的」和答「我访谈了客服负责人,这条规则是他第三个回答里说的」,是两个分量。

要说明白一件事:今天的「客户」是虚构的,访谈是模型扮演的。我没有真的去采访谁,不会假装有。这个做法的价值在于**让你练问问题的手法**,而不是让你拿到真实的客户知识。这一点后面还会再说。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="从访谈到验收:访谈产生事实表,事实表拆成需求表,需求表里的验收办法后面变成 PRD 指标和评测项">
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="10" y="50" width="130" height="64" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="75" y="76" text-anchor="middle" fill="var(--ink)">访谈</text>
    <text x="75" y="96" text-anchor="middle" font-size="11" fill="var(--ink-soft)">问过去,不问意见</text>
    <rect x="170" y="50" width="130" height="64" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="235" y="76" text-anchor="middle" fill="var(--ink)">事实表 F01–F13</text>
    <text x="235" y="96" text-anchor="middle" font-size="11" fill="var(--ink-soft)">一条一件事</text>
    <rect x="330" y="50" width="140" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="400" y="76" text-anchor="middle" fill="var(--ink)">需求表 R1–R12</text>
    <text x="400" y="96" text-anchor="middle" font-size="11" fill="var(--ink-soft)">原话 → 问题 → 需求</text>
    <rect x="500" y="50" width="130" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="565" y="76" text-anchor="middle" fill="var(--ink)">验收办法</text>
    <text x="565" y="96" text-anchor="middle" font-size="11" fill="var(--ink-soft)">Day 437 / Day 476</text>
    <line x1="140" y1="82" x2="168" y2="82" stroke="var(--ink-faint)" stroke-width="1.5"/>
    <line x1="300" y1="82" x2="328" y2="82" stroke="var(--ink-faint)" stroke-width="1.5"/>
    <line x1="470" y1="82" x2="498" y2="82" stroke="var(--ink-faint)" stroke-width="1.5"/>
    <text x="235" y="152" text-anchor="middle" font-size="11" fill="var(--ink-soft)">检查一:每条事实都被某条需求用到</text>
    <text x="400" y="172" text-anchor="middle" font-size="11" fill="var(--ink-soft)">检查二:每条「要做」的需求都写得出验收办法</text>
    <line x1="235" y1="118" x2="235" y2="140" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
    <line x1="400" y1="118" x2="400" y2="160" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
    <text x="320" y="28" text-anchor="middle" fill="var(--ink-soft)">今天的流水线:每一步都能用一个小脚本检查</text>
  </g>
</svg>
<figcaption>今天的路线。访谈得到事实,事实拆成需求,需求必须带验收办法;中间两处检查都写成脚本,不靠人记。</figcaption>
</figure>

## 第一步:先学会问

### 三条规矩

教人怎么做用户访谈的书里,流传最广的一本是 Rob Fitzpatrick 的《The Mom Test》(2013)。书名的意思是:你拿创业点子去问妈妈「你觉得这个怎么样」,她为了不伤你的心,一定说好。所以问法要设计成连妈妈也没法撒谎的样子。我读到的核心是三条:

- 别推销你的方案,别问「你会不会用」。
- 问**具体的过去**,不问泛泛的将来。「你以后会不会用这个」是没有信息量的客套话;「上一次你遇到这个问题是什么时候,当时你怎么做的」是事实。
- 多听少说,对方抱怨的地方追下去。

我把它换成一句更土的话:**问意见,得到客套;问过去,得到事实。** 大模型版本的「意见」更是如此,你问它想要什么功能,它能给你写五百字。可是五百字里没有一条是你的客户说的。

### 让模型扮演老周

怎么在没有真客户的情况下练?用模型扮演,但要给它设计好「脾气」。下面这个人设是我写的:老周知道 13 件事,但只在被问到具体的过去时才说,被问意见时只客套。这个规则不是模型的天性(模型天性是把知道的一股脑倒出来),是我用提示词硬压出来的,目的是模拟真人「你不问我就不说」的习惯。

13 条事实是我编的,它们对应的是云簿的退款规则、系统流程和几条红线。事实旁边写着一个正则,脚本用它检查「某一轮回答里有没有提到这件事」。

```bash
cd ~/agent-zero-lab
mkdir -p part08/docs
```

第八部分的目录 Day 435 已经建过了(`part08/__init__.py`),今天多建一个 `docs/` 放输出。下面是第一个脚本。

```python
# agent-zero-lab/part08/interview_sim.py
"""让模型扮演云簿的客服负责人老周,比较两种访谈方式能问出几条事实。"""
import re
import sys

from common.llm import LLMClient

# 老周「知道」的 12 件事:编号、一句话、用来检查回答里有没有提到的正则
FACTS = [
    ("F01", "6 个客服,每天约 300 张工单", r"6 ?个|六个|300"),
    ("F02", "一半以上是帮助中心里就有答案的重复问题", r"一半|50%|重复"),
    ("F03", "年付首购 14 天内(含第 14 天)全额退", r"14 ?天.{0,6}(全额|全退)|全额.{0,12}14 ?天"),
    ("F04", "年付超过 14 天:按剩余完整月份,扣 10% 手续费", r"剩余.{0,4}月|10%|手续费|九折"),
    ("F05", "续费的年付,续费后 7 天内全退", r"续费.{0,12}7 ?天|7 ?天.{0,8}续费"),
    ("F06", "月付不退(重复扣款例外)", r"月付.{0,8}不(能|支持)?退|月付.{0,12}不退"),
    ("F07", "企业版是合同单,不走这套规则,转客户成功经理", r"企业版.{0,30}(合同|客户成功|转)"),
    ("F08", "退款超过 1000 元,财务要复核", r"1[,，]?000|一千"),
    ("F09", "说要去 12315 投诉的,必须马上给组长", r"12315|组长"),
    ("F10", "客户用别的邮箱发工单:要让他提供注册邮箱,不能凭名字猜", r"注册邮箱|别的邮箱|不同的邮箱|另一个邮箱"),
    ("F11", "财务审批都在飞书群里", r"飞书"),
    ("F12", "AI 回复前:政策类不用人看,涉及钱的要人看一眼", r"涉及钱|涉及金额|涉及退款|钱的.{0,6}(人|确认)|人.{0,4}(点|确认|看)"),
    ("F13", "处理一张账单工单要开三个系统:工单系统、计费后台、财务审批", r"三个系统|3 ?个系统|计费后台"),
]

PERSONA = """你是老周,虚构 SaaS 公司「云簿 CloudLedger」的客服负责人,正在接受一位外部工程师的访谈。
你知道下面这些事实(编号只是方便你对照,不要在回答里说出编号):
{facts}

回答规矩,必须遵守:
1. 只回答对方问到的那一个方面,一次最多讲两三件事,不要把知道的全倒出来。
2. 对方问的是意见、愿望、「你觉得会不会」「你会不会用」「你想要什么功能」这类问题,你只给客套的、笼统的回答,比如「挺好的,有需要」,不主动讲上面的任何具体事实。
3. 对方问的是具体的过去:「上一次」「当时怎么处理的」「现在怎么做」,你才讲对应的细节,可以带点抱怨,口语,不超过 120 字。
4. 对方没问到的事实,你就当不记得,绝不主动提。
"""


def covered(text: str) -> set[str]:
    return {fid for fid, _, pat in FACTS if re.search(pat, text)}


def start(facts: list[tuple[str, str, str]] = FACTS) -> list[dict[str, str]]:
    facts_text = "\n".join(f"- {fid} {desc}" for fid, desc, _ in facts)
    return [{"role": "system", "content": PERSONA.format(facts=facts_text)}]


def ask(llm: LLMClient, messages: list[dict[str, str]], questions: list[str]) -> list[str]:
    """顺着同一段对话往下问;messages 会被原地追加,所以追问能接着聊。"""
    answers = []
    for q in questions:
        messages.append({"role": "user", "content": q})
        r = llm.chat(messages, temperature=0, max_tokens=300)
        messages.append({"role": "assistant", "content": r.content})
        answers.append(r.content)
    return answers


BAD = [
    "你们觉得智能客服 AI 会不会很有帮助?",
    "如果我们做一个全自动处理工单的 AI,你会用吗?",
    "你们希望它有哪些功能?",
    "退款这块,你觉得 AI 能搞定吗?",
    "你们愿意为它付多少钱?",
]

GOOD = [
    "你们团队现在几个人,一天大概处理多少工单?",
    "最近一次有客服在退款上出了问题,能讲讲当时具体是怎么回事吗?",
    "那现在退款规则是怎么定的?新来的客服是怎么学的?",
    "遇到涉及账单的工单,客服从头到尾要打开哪几个系统?最近一次是怎么做的?",
    "有没有哪类工单,你们绝对不想让机器碰?最近一次碰到是什么情况?",
]

FOLLOW_UP = [
    "年付的客户,申请当天刚好是第 14 天,算 14 天内吗?",
    "年付自动续费以后,客户马上后悔了,能退吗?",
    "客户用另一个邮箱发来工单,你们最近一次是怎么处理的?",
    "退款金额多大的时候,你们会特别当心?",
    "如果机器替客服起草了回复,最近一次你们是希望有人先看一眼再发,还是直接发?",
]


def report(title: str, got: set[str], total_q: int) -> None:
    print(f"== {title}:{total_q} 个问题,问出 {len(got)}/{len(FACTS)} 条事实")
    print("   没问出来:", " ".join(f for f, _, _ in FACTS if f not in got) or "(无)")


if __name__ == "__main__":
    verbose = "-v" in sys.argv
    llm = LLMClient()

    bad_msgs = start()
    bad_answers = ask(llm, bad_msgs, BAD)
    report("坏访谈(问意见)", covered("\n".join(bad_answers)), len(BAD))

    good_msgs = start()
    good_answers = ask(llm, good_msgs, GOOD)
    first = covered("\n".join(good_answers))
    report("好访谈第一轮(问过去)", first, len(GOOD))

    more_answers = ask(llm, good_msgs, FOLLOW_UP)  # 接着同一段对话追问
    both = covered("\n".join(good_answers + more_answers))
    report("加上追问", both, len(GOOD) + len(FOLLOW_UP))
    print("   追问多问出:", " ".join(sorted(both - first)) or "(无)")

    if verbose:
        for q, a in zip(BAD + GOOD + FOLLOW_UP, bad_answers + good_answers + more_answers):
            print(f"\n问:{q}\n答:{a}")
    print(llm.ledger)
```

<div class="line-notes">

- `from common.llm import LLMClient` Day 135–137 建的 `common/llm.py`,只用它的 `chat()` 和 `ledger`。在 `agent-zero-lab` 根目录用 `uv run python -m part08.interview_sim` 跑,才找得到 `common`。
- `FACTS = [` 每条是三元组:编号、一句话、正则。编号 F01 到 F13 是我定的,后面需求表要用它们对号入座。
- `("F03", "年付首购 14 天内` 正则里 `14 ?天.{0,6}(全额|全退)` 的意思是「14 天」后面隔不超过 6 个字出现「全额」或「全退」;` ?` 表示中间可以有一个空格。回答里写「年付首购 14 天内含第 14 天全额退」会命中。
- `("F12", "AI 回复前` 这条的正则最松,「涉及钱」之类的说法都算。正则只能粗判,所以脚本只用来比较两种访谈,不拿它当严格评分。
- `("F13", "处理一张账单工单` 这条是后加的,排在 F12 后面,编号不按先后。真实访谈里事实也不是按你问的顺序冒出来的。
- `PERSONA = """你是老周` 人设提示词。`{facts}` 是占位符,下面用 `.format` 填进去。
- `1. 只回答对方问到的那一个方面` 规矩 1 压住模型「倒豆子」的毛病,一次最多讲两三件事。
- `2. 对方问的是意见` 规矩 2 是整个实验的关键:意见类问题只许客套。没有这一条,模型会在第一个问题里就把退款规则全背出来,实验就没意义了。
- `3. 对方问的是具体的过去` 规矩 3 对应「问过去」才开口。
- `def covered(text: str) -> set[str]:` 返回这段文字命中了哪些事实编号,集合推导式 + `re.search`,和 Day 435 数 JD 关键词是同一招。
- `def start(facts` 开一段新对话:`messages` 里只有一条 system 消息,内容是人设。每次调用都得到一个新的列表,所以两次访谈互不串。
- `facts_text = ` 把 13 条事实拼成多行文本,填进人设。注意只给模型事实描述,不给正则。
- `def ask(` 一个问题一个问题地问。`messages` 被原地追加:每问一次先 `append` 用户问题,拿到回答再 `append` 助理回答,下一问就能看到前面聊过什么。
- `r = llm.chat(messages, temperature=0, max_tokens=300)` `temperature=0` 让回答尽量稳定(但不保证完全一样,后面会看到);`max_tokens=300` 防止老周长篇大论。
- `BAD = [` 五个典型的坏问题:问意见、问将来、问愿望、问能不能、问愿意付多少钱。
- `GOOD = [` 五个好问题,每个都带「现在」「最近一次」「当时具体」。
- `FOLLOW_UP = [` 第二轮追问,是我从第一轮没问出来的话题里补的:第 14 天算不算、续费能不能退、别的邮箱、大额、AI 起草后要不要人看。
- `def report(title` 打印问出几条、没问出哪几条。
- `bad_msgs = start()` 坏访谈用自己的一段对话,和好访谈完全隔开。
- `more_answers = ask(llm, good_msgs, FOLLOW_UP)` 追问接着好访谈的**同一段对话**问,老周记得前面聊过的,和真人聊天一样。
- `both = covered("\n".join(good_answers + more_answers))` 把两轮的回答合在一起数。
- `if verbose:` 命令行带 `-v` 才打印每个问答,方便你亲眼看回答是什么样。

</div>

```bash
uv run python -m part08.interview_sim -v
```

我这次跑出来(2026 年 10 月 27 日,`deepseek-flash`)的结果开头是:

```text
== 坏访谈(问意见):5 个问题,问出 0/13 条事实
   没问出来: F01 F02 F03 F04 F05 F06 F07 F08 F09 F10 F11 F12 F13
== 好访谈第一轮(问过去):5 个问题,问出 10/13 条事实
   没问出来: F07 F08 F10
== 加上追问:10 个问题,问出 12/13 条事实
   没问出来: F07
   追问多问出: F08 F10
```

后面是每个问答。坏访谈的五个回答是这样的:

```text
问:你们觉得智能客服 AI 会不会很有帮助?
答:挺好的,有需要的话我们会考虑。

问:如果我们做一个全自动处理工单的 AI,你会用吗?
答:这个得看情况,暂时不好说,有合适的可以聊聊。

问:你们希望它有哪些功能?
答:这个我一时也说不好,看你们能做到什么程度吧,有需要再细聊。
```

(后两个问题的回答同样是客套话,省略。)五个问题,问出零条。好访谈里最有料的是第二个问题:

```text
问:最近一次有客服在退款上出了问题,能讲讲当时具体是怎么回事吗?
答:上次有个客户年付首购第 14 天来退,客服没注意卡在线上,直接按超期扣了 10% 手续费,客户炸了。后来我让重新按全额退的。
```

一个回答里就有「第 14 天」这个边界、「扣 10% 手续费」这条规则、「卡在线上」这个新人最容易犯的错。你没问「退款规则是什么」,是问「最近一次出了什么事」,对方自己把规则带出来了。

追问也有效:「申请当天刚好是第 14 天算不算」得到「算,含第 14 天,全额退」,这是一个边界用例,后面评测集里要单独放一条。

有三点要老实说。

第一,这次**没有问出 F07**,也就是「企业版是合同单,不走这套规则」。恰好是上个月出事故的那条。我的五个追问里没有一个指向「哪类客户不适用」,老周也不会主动讲。这是真实访谈里最常见的漏洞:你不知道要问什么,对方也没意识到该说。解决办法在后面讲,练习 1 也让你补一个追问去把它挖出来。

第二,**模型每次回答不完全一样**。同一份问题我又跑了三遍,脚本如下。

```python
# agent-zero-lab/part08/interview_repeat.py
"""同样的问题再跑几遍,看「问出几条事实」稳不稳。"""
from common.llm import LLMClient
from part08.interview_sim import BAD, FACTS, FOLLOW_UP, GOOD, ask, covered, start

llm = LLMClient()
for i in range(1, 4):
    bad = covered("\n".join(ask(llm, start(), BAD)))
    msgs = start()
    first = covered("\n".join(ask(llm, msgs, GOOD)))
    both = first | covered("\n".join(ask(llm, msgs, FOLLOW_UP)))
    print(f"第 {i} 遍  坏访谈 {len(bad):>2}/{len(FACTS)}   好访谈 {len(first):>2}/{len(FACTS)}   +追问 {len(both):>2}/{len(FACTS)}")
print(llm.ledger)
```

<div class="line-notes">

- `from part08.interview_sim import BAD, FACTS, FOLLOW_UP, GOOD, ask, covered, start` 直接复用上一个脚本里的函数和数据,不复制粘贴。这就是 Day 32–33 学的模块和包。
- `for i in range(1, 4):` 重复三遍。
- `bad = covered("\n".join(ask(llm, start(), BAD)))` 每遍都用一个全新的对话问坏问题,取命中的事实集合。
- `msgs = start()` 好访谈的对话要留着,因为追问要接着问。
- `both = first |` 集合的并集:第一轮命中的,加上追问轮命中的。
- `print(f"第 {i} 遍  坏访谈 {len(bad):>2}/{len(FACTS)}` `:>2` 右对齐占两格,三遍的数字才对得齐。

</div>

```bash
uv run python -m part08.interview_repeat
```

```text
第 1 遍  坏访谈  0/13   好访谈 11/13   +追问 12/13
第 2 遍  坏访谈  0/13   好访谈  9/13   +追问 11/13
第 3 遍  坏访谈  0/13   好访谈 10/13   +追问 12/13
45 次调用 | 输入 27919 / 输出 1060 tokens | 约 ¥0.0269
```

数字有上下浮动(好访谈 9 到 11 条),坏访谈三次都是 0。比较的结论稳定,具体数字不稳定。你自己跑会得到略有不同的数字,没关系。

第三,模型扮演的客户**会编故事**。「上次有个客户第 14 天来退、被扣了 10%」是它根据我给的规则现编的,三次跑的故事细节不一样(有时是第 14 天,有时是超过 14 天)。真人的故事也许更荒谬、也许更有价值。所以今天这个模拟只用来练手法,算不得需求来源。**真实项目里,事实必须来自真人。**

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="三种访谈方式问出的事实条数:坏访谈 0,好访谈第一轮 10,加追问 12,总共 13 条">
  <g font-family="var(--font-mono)" font-size="12">
    <text x="20" y="24" fill="var(--ink-soft)">每种访谈问出的事实(共 13 条,本次实跑)</text>
    <text x="20" y="62" fill="var(--ink)">坏访谈</text>
    <rect x="130" y="46" width="2" height="22" fill="var(--compute)"/>
    <text x="146" y="62" fill="var(--ink-soft)">0</text>
    <text x="20" y="104" fill="var(--ink)">好访谈第一轮</text>
    <rect x="130" y="88" width="385" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="525" y="104" fill="var(--ink-soft)">10</text>
    <text x="20" y="146" fill="var(--ink)">加追问</text>
    <rect x="130" y="130" width="462" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="598" y="146" fill="var(--ink-soft)">12</text>
    <text x="20" y="184" fill="var(--ink-faint)">满格是 13 条;缺的那条是 F07(企业版不适用),正好是上个月的事故</text>
  </g>
</svg>
<figcaption>条形长度按条数比例画(满格 13 条)。同样的客户、同样的 token 花销,问法不同,问出的事实从 0 到 12。</figcaption>
</figure>

## 第二步:访谈清单

漏掉 F07 说明一个问题:靠临场发挥,总会漏。FDE 的办法是**写下一份清单**,把话题固定下来,每个话题带一个「最近一次」式的问题。清单不是照着念的问卷,是防止自己忘了的备忘。

我给云簿这个场景用的是下面七个话题。你换成别的业务,话题基本通用:

| 话题 | 怎么问(都是问过去) | 这次对应的事实 |
| --- | --- | --- |
| 规模和现状 | 现在几个人,一天多少件,哪几类最多? | F01、F02 |
| 最近一次出事 | 上次出了什么问题,当时怎么发现、怎么补救的? | F03 的边界 |
| 规则从哪来 | 规则现在怎么定的,新人怎么学? | F03–F06 |
| 例外和不适用 | 哪类客户/情况不走这套?最近一次是什么? | F07 |
| 系统和流程 | 处理一件事要开几个系统,每一步谁做? | F11、F13 |
| 红线 | 哪些事绝不能让机器碰?谁说了算? | F09、F12 |
| 大额和审批 | 多大的钱要多一道把关,在哪里审批? | F08、F11 |

对照今天的实验:我的 `GOOD` 五个问题只覆盖了前三行、第五行、第六行,**没有写「例外和不适用」那一行**,所以漏了 F07;第一轮也没怎么碰「大额」,所以 F08 靠追问才出来。这就是清单的用处:不是让访谈更长,是让你在访谈**之前**就看出自己漏了哪一行。

追问清单还有一个来源:**把对方说到一半的词追下去。** 老周说「新人经常算错」,你就问「最近一次算错是哪条规则」;他说「财务在群里批」,你就问「在哪个群,批的时候看什么」。我在这一步学到的一个习惯是,每个回答里挑一个名词或数字追问一句,比换话题强。

## 第三步:从访谈到需求表

访谈得到的是原话和事实。下一步是拆。我对每句话问三个问题:这是事实还是情绪?背后真正的问题是什么?怎么验收?填进一张四列的表。

```python
# agent-zero-lab/part08/requirements.py
"""把访谈原话拆成需求表,并检查:每条需求有验收办法,每条事实都有去处。"""
from dataclasses import dataclass
from pathlib import Path

from part08.interview_sim import FACTS


@dataclass
class Row:
    id: str
    quote: str  # 访谈原话
    facts: list[str]  # 它对应哪几条事实(F01…)
    problem: str  # 背后的真实问题
    need: str  # 系统要做什么
    accept: str  # 怎么验收;写不出来就留空
    status: str = "做"  # 做 / 不做 / 待问


ROWS = [
    Row("R1", "一半以上是重复问题,帮助中心里都有,客户就是不看", ["F01", "F02"],
        "知识没被用起来", "政策和操作类问题自动答,答案带帮助中心出处", "检索命中率、引用合法率、事实覆盖率"),
    Row("R2", "年付首购 14 天内全退,超过按剩余完整月份扣 10%,续费 7 天内全退,月付不退", ["F03", "F04", "F05", "F06"],
        "规则不该靠人记,也不该靠模型猜", "退款资格和金额由代码按规则算,模型只负责解释", "每条规则一个单元测试;评测集里退款金额 100% 对"),
    Row("R3", "上个月有人给企业版客户承诺了全额退款", ["F07"],
        "承诺越权", "企业版退款一律转客户成功经理;回复里不许出现没有依据的承诺", "『禁止承诺』规则检查 + 专门的企业版用例"),
    Row("R4", "客服要开三个系统才能查清一张账单", ["F13"],
        "查数据成本高", "Agent 用工具查客户、订阅、账单,把结论整理好", "工具调用正确率"),
    Row("R5", "我不想让 AI 直接给客户退钱", ["F12"],
        "风险控制", "退款只能创建『待审批』申请,人点通过才执行;模型拿不到执行退款的工具", "审批闸门正确率 100%"),
    Row("R6", "超过 1000 块财务要复核", ["F08"],
        "大额要多一道把关", "金额超过 1000 的申请带『需财务复核』标记", "评测集里 >1000 的用例 100% 带标记"),
    Row("R7", "去 12315 投诉的必须马上给组长", ["F09"],
        "高风险工单要识别", "投诉、法律威胁、账号被盗、要求人工 → 直接转人工", "转人工召回率 100%"),
    Row("R8", "客户用别的邮箱发工单,得让他提供注册邮箱", ["F10"],
        "不能凭名字猜人", "找不到客户时不查账,回复里请客户提供注册邮箱", "『身份不明』用例 100% 不泄露账单"),
    Row("R9", "财务审批都在飞书群里,最好能推过去", ["F11"],
        "要融入现有流程", "退款申请推送到群;推送失败不影响主流程", "有推送;推送失败时工单仍能走完"),
    Row("R10", "政策类的 AI 直接回就行,涉及钱的要人看一眼", ["F12"],
        "不同风险不同把关", "政策类自动发;涉及金额的草稿由客服确认后才发", "涉及金额的草稿 100% 进待确认"),
    Row("R11", "最好它很聪明,客户满意", [],
        "(情绪,没有对象)", "—", "", "待问"),
    Row("R12", "以后最好还能自动发邮件、打电话", [],
        "渠道扩张", "—", "", "不做"),
]


def check(rows: list[Row]) -> list[str]:
    problems = []
    for r in rows:
        if r.status == "做" and not r.accept.strip():
            problems.append(f"{r.id} 状态是『做』,但写不出验收办法:{r.need}")
        if r.status == "做" and not r.facts:
            problems.append(f"{r.id} 状态是『做』,但没有对应的访谈事实,是不是你自己加的戏?")
    used = {f for r in rows for f in r.facts}
    for fid, desc, _ in FACTS:
        if fid not in used:
            problems.append(f"{fid} 访谈里问出来了,但没有哪条需求用到它:{desc}")
    return problems


def to_markdown(rows: list[Row]) -> str:
    lines = ["| # | 访谈原话 | 真实问题 | 需求 | 怎么验收 | 状态 |", "| --- | --- | --- | --- | --- | --- |"]
    for r in rows:
        lines.append(f"| {r.id} | {r.quote} | {r.problem} | {r.need} | {r.accept or '—'} | {r.status} |")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    problems = check(ROWS)
    print(f"{len(ROWS)} 行,做 {sum(r.status == '做' for r in ROWS)} 条,不做 {sum(r.status == '不做' for r in ROWS)} 条,待问 {sum(r.status == '待问' for r in ROWS)} 条")
    print("检查结果:", "全部通过" if not problems else "")
    for p in problems:
        print(" -", p)
    out = Path("part08/docs/requirements.md")
    out.write_text(to_markdown(ROWS), encoding="utf-8")
    print("已写入", out)
```

<div class="line-notes">

- `from dataclasses import dataclass` Day 50 的 dataclass,装一行需求的数据。
- `from part08.interview_sim import FACTS` 复用事实表。需求表和事实表用编号对得上,这是检查二的基础。
- `class Row:` 六个字段对应表格六列。`facts` 是列表,一条需求可以对应多条事实。
- `accept: str  # 怎么验收;写不出来就留空` 留空不是偷懒,是诚实:写不出来就说明需求没想清楚。
- `status: str = "做"  # 做 / 不做 / 待问` 有默认值的字段必须放在最后。
- `Row("R2", "年付首购 14 天内全退` 一行需求对应 F03–F06 四条事实,验收写成「每条规则一个单元测试」。这就是 Day 435 那个判卷函数的正式版:规则由代码算,评测时和标准答案对。
- `Row("R5", "我不想让 AI 直接给客户退钱"` 访谈里最重的一句话:模型拿不到「执行退款」的工具,只能创建待审批申请。后面 Day 452 的工具权限、Day 456 的审批时序都从这条来。
- `Row("R11", "最好它很聪明,客户满意", [],` 这是情绪,没有对象,没有事实,验收留空。状态标「待问」:它不是需求,是下一次访谈要追的话头。
- `Row("R12", "以后最好还能自动发邮件、打电话"` 状态「不做」:有人提了,但这期不做。Day 437 会把它写进非目标。
- `def check(rows` 返回问题列表,空列表代表通过。
- `if r.status == "做" and not r.accept.strip():` 检查一:要做的需求必须写得出验收办法。`.strip()` 去掉首尾空白,防止只写了个空格。
- `if r.status == "做" and not r.facts:` 要做的需求必须能追溯到访谈事实,防止你自己加戏。
- `used = {f for r in rows for f in r.facts}` 集合推导式,两层 `for`,收集所有被需求用到的事实编号。
- `for fid, desc, _ in FACTS:` 检查二:访谈里问出来的每条事实,都得有需求用到它。没有就是漏了,或者这条事实本来就不该进系统,那就应该明确写成「不做」。`_` 是不用的第三项(正则)。
- `def to_markdown(rows` 把需求表输出成 markdown,方便贴进文档。
- `out = Path("part08/docs/requirements.md")` 写到练习仓库里,Day 437 的 PRD 要引用它。

</div>

```bash
uv run python -m part08.requirements
```

```text
12 行,做 10 条,不做 1 条,待问 1 条
检查结果: 全部通过
已写入 part08/docs/requirements.md
```

`docs/requirements.md` 的内容(表格里每一行都可以追溯到上面的事实编号):

| # | 访谈原话 | 真实问题 | 需求 | 怎么验收 | 状态 |
| --- | --- | --- | --- | --- | --- |
| R1 | 一半以上是重复问题,帮助中心里都有,客户就是不看 | 知识没被用起来 | 政策和操作类问题自动答,答案带帮助中心出处 | 检索命中率、引用合法率、事实覆盖率 | 做 |
| R2 | 年付首购 14 天内全退,超过按剩余完整月份扣 10%,续费 7 天内全退,月付不退 | 规则不该靠人记,也不该靠模型猜 | 退款资格和金额由代码按规则算,模型只负责解释 | 每条规则一个单元测试;评测集里退款金额 100% 对 | 做 |
| R3 | 上个月有人给企业版客户承诺了全额退款 | 承诺越权 | 企业版退款一律转客户成功经理;回复里不许出现没有依据的承诺 | 『禁止承诺』规则检查 + 专门的企业版用例 | 做 |
| R4 | 客服要开三个系统才能查清一张账单 | 查数据成本高 | Agent 用工具查客户、订阅、账单,把结论整理好 | 工具调用正确率 | 做 |
| R5 | 我不想让 AI 直接给客户退钱 | 风险控制 | 退款只能创建『待审批』申请,人点通过才执行;模型拿不到执行退款的工具 | 审批闸门正确率 100% | 做 |
| R6 | 超过 1000 块财务要复核 | 大额要多一道把关 | 金额超过 1000 的申请带『需财务复核』标记 | 评测集里 >1000 的用例 100% 带标记 | 做 |
| R7 | 去 12315 投诉的必须马上给组长 | 高风险工单要识别 | 投诉、法律威胁、账号被盗、要求人工 → 直接转人工 | 转人工召回率 100% | 做 |
| R8 | 客户用别的邮箱发工单,得让他提供注册邮箱 | 不能凭名字猜人 | 找不到客户时不查账,回复里请客户提供注册邮箱 | 『身份不明』用例 100% 不泄露账单 | 做 |
| R9 | 财务审批都在飞书群里,最好能推过去 | 要融入现有流程 | 退款申请推送到群;推送失败不影响主流程 | 有推送;推送失败时工单仍能走完 | 做 |
| R10 | 政策类的 AI 直接回就行,涉及钱的要人看一眼 | 不同风险不同把关 | 政策类自动发;涉及金额的草稿由客服确认后才发 | 涉及金额的草稿 100% 进待确认 | 做 |
| R11 | 最好它很聪明,客户满意 | (情绪,没有对象) | — | — | 待问 |
| R12 | 以后最好还能自动发邮件、打电话 | 渠道扩张 | — | — | 不做 |

最后一列是这张表最值钱的部分。很多自学项目写到「需求」那一列就开工,做完不知道算不算做完。验收一旦写下来,Day 437 的 PRD 指标、Day 476 起的评测集就有了骨架:每条验收办法最后都会变成评测里的一项检查。写不出验收办法的需求,先挂在「待问」,不要硬做。

### 故意弄坏它

检查函数自己对不对,要弄坏一次才知道。下面这个脚本删掉一条需求、清空一条验收、再凭空加一条没有事实依据的。

```python
# agent-zero-lab/part08/requirements_break.py
"""故意弄坏需求表,看 check() 能不能抓到。"""
from dataclasses import replace

from part08.requirements import ROWS, check

broken = [r for r in ROWS if r.id != "R6"]  # 删掉「超过 1000 块」那条
broken = [replace(r, accept="") if r.id == "R9" else r for r in broken]  # 飞书那条验收写不出来
broken.append(replace(ROWS[0], id="R13", facts=[], need="加一个会讲笑话的人设"))  # 凭空加戏
for p in check(broken):
    print("-", p)
```

<div class="line-notes">

- `from dataclasses import replace` `replace(r, accept="")` 复制一个对象并改其中几个字段,原对象不动。相当于 JS 的 `{...r, accept: ""}`。
- `broken = [r for r in ROWS if r.id != "R6"]` 删掉「超过 1000 块」那条,预期检查会说 F08 没人用。
- `replace(r, accept="") if r.id == "R9" else r` R9 的验收清空,预期检查会说它写不出验收办法。
- `broken.append(replace(ROWS[0], id="R13", facts=[], need="加一个会讲笑话的人设"))` 拷贝 R1 改个编号、去掉事实,模拟「自己加戏」。
- `for p in check(broken):` 打印检查结果。

</div>

```bash
uv run python -m part08.requirements_break
```

```text
- R9 状态是『做』,但写不出验收办法:退款申请推送到群;推送失败不影响主流程
- R13 状态是『做』,但没有对应的访谈事实,是不是你自己加的戏?
- F08 访谈里问出来了,但没有哪条需求用到它:退款超过 1000 元,财务要复核
```

三个问题抓到三个。注意 F08 的提示是「访谈里问出来了,但没有需求用它」:这在真项目里最常发生,你听到了,记在本子上,开工时忘了。

## 第四步:补完整的退款规则

Day 435 的判卷函数只有三条规则。访谈之后,完整的退款规则是下面这样,每一行后面标了它在访谈里出现的位置:

| 优先级 | 情形 | 处理 | 来自 |
| --- | --- | --- | --- |
| 1 | 企业版(合同单) | 一律转客户成功经理,不走下面的规则 | F07 |
| 2 | 年付、首次购买、第 14 天及以内 | 全额退 | F03(含第 14 天来自追问) |
| 3 | 年付续费后 7 天内 | 全额退 | F05(追问出来的) |
| 4 | 年付超过 14 天 | 剩余完整月份 ÷ 12 × 年付金额 × 90% | F04 |
| 5 | 月付 | 不退(重复扣款、系统错误多扣的除外) | F06 |
| 全局 | 退款金额超过 1000 元 | 申请带「需财务复核」标记 | F08 |
| 全局 | 所有退款 | 只能创建待审批申请,不直接执行 | F12/R5 |

第 4 行举个算例,把公式代进去:专业版年付 950 元,用了四个多月,剩余完整月份 7 个,退款 = 950 × 7 ÷ 12 × 0.9。

```bash
python3 -c "print(950 * 7 / 12 * 0.9)"
```

```text
498.75
```

这是后面评测里的一个标准答案。规则之间有先后顺序:企业版必须排第一,否则一个年付的企业版客户第 3 天来问,会被判成「全额退」,和上个月那次事故一模一样。这个顺序在 Day 435 判卷函数的 `expected()` 里已经体现了,今天你知道了它是从访谈里哪一句话来的。

规则的**代码**不在今天写,Day 452 才写,到时它是 `business.py` 里一个纯函数,配十来个单元测试。今天只确认两件事:规则表是从访谈里来的,不是我拍脑袋;每条规则以后都有测试。

## 访谈里没问到的,怎么办

还有两件事要诚实地讲。

一是**这次没问到的,不代表不存在**。这次实验里老周没提「优惠券订单退款按实付金额算」,也没提「退款多久到账」,但帮助中心(Day 444 生成)里有这些内容。真实项目里,访谈只是需求的一个来源,另外要翻现有的工单记录、客服的 SOP 文档、帮助中心。哪个来源和访谈对不上,就是追问的好题目。

二是**模拟客户的回答不能当真**。人设会编故事,规则是我给的,它只会在我给的范围里说话。你从它那里问不出我没想到的事。这个实验证明的只有一件事:**问法决定了问出多少**。真实世界里问法的差距只会更大。

模型能帮上忙的地方在别处:拿一份真实的访谈录音整理成要点、把原话归类到话题清单、检查需求表里有没有互相冲突的条目。这些都是整理活,不是产出事实的活。想听听「AI 能不能代替你做用户访谈」的看法,可以看学习资料里 Rob Fitzpatrick 那条 YouTube 视频。

## 动手练习

### 练习 1:补一个追问,把 F07 问出来

在 `interview_sim.py` 的追问之后,再写**一个**追问,让老周把「企业版不适用」说出来。写一个脚本跑给自己看:追问前后各命中几条事实。

<details><summary>参考答案</summary>

思路:F07 属于「例外和不适用」那个话题。别问「企业版怎么退」(你本来就不知道有企业版这回事),问「哪类客户不适用」,用「最近一次」把它落到具体的事上。

```python
# agent-zero-lab/part08/ex1_followup.py
"""练习 1:再写一个追问,把 F07(企业版)问出来。"""
from common.llm import LLMClient
from part08.interview_sim import FACTS, FOLLOW_UP, GOOD, ask, covered, start

EXTRA = "有没有哪类客户,这套退款规则对他们是不适用的?最近一次是怎么处理的?"

llm = LLMClient()
msgs = start()
text = "\n".join(ask(llm, msgs, GOOD + FOLLOW_UP))
before = covered(text)
extra_answer = ask(llm, msgs, [EXTRA])[0]
after = covered(text + "\n" + extra_answer)
print("追问:", EXTRA)
print("答:", extra_answer)
print(f"之前 {len(before)}/{len(FACTS)},之后 {len(after)}/{len(FACTS)},多出:", " ".join(sorted(after - before)) or "(无)")
print(llm.ledger)
```

<div class="line-notes">

- `EXTRA = "有没有哪类客户,这套退款规则对他们是不适用的?最近一次是怎么处理的?"` 前半句找例外,后半句要一个具体的过去,和「问过去」的规矩一致。
- `text = "\n".join(ask(llm, msgs, GOOD + FOLLOW_UP))` 先把原来的十个问题问完,在同一段对话里。
- `before = covered(text)` 追问之前命中的事实。
- `extra_answer = ask(llm, msgs, [EXTRA])[0]` 只问新追问一个,取它的回答。`ask` 返回列表,所以 `[0]` 取第一个。
- `after = covered(text + "\n" + extra_answer)` 把新回答加进去再数。
- `after - before` 集合相减,只留下新多出来的事实编号。

</div>

```bash
uv run python -m part08.ex1_followup
```

我跑了两次:

```text
追问: 有没有哪类客户,这套退款规则对他们是不适用的?最近一次是怎么处理的?
答: 企业版是合同单,不走这套,直接转客户成功经理。上次有个企业客户来问退费,我就转过去了。
之前 11/13,之后 12/13,多出: F07
```

```text
答: 企业版是合同单,不走这套规则。上次碰到一个,我直接转给客户成功经理了。
之前 12/13,之后 13/13,多出: F07
```

两次都是追问之后多出 F07。我另外有一次跑(那次没截图)在追问之前就已经 13/13 了,因为老周碰巧在前面的回答里提了企业版;所以这种实验一定要多跑几遍再下结论。

</details>

### 练习 2:把五个坏问题改成好问题

`BAD` 里五个问题:「觉得 AI 有没有帮助」「会不会用全自动 AI」「希望有哪些功能」「AI 能不能搞定退款」「愿意付多少钱」。每个改写成一个「问过去」的问题,跑一遍,对比问出几条事实。

<details><summary>参考答案</summary>

改写的套路是把「你觉得/你会不会/你想要」换成「最近一次/上一次/当时怎么做的」。

```python
# agent-zero-lab/part08/ex2_rewrite.py
"""练习 2:把五个坏问题各改成一个『问过去』的好问题,和原来比。"""
from common.llm import LLMClient
from part08.interview_sim import BAD, FACTS, ask, covered, start

REWRITTEN = [
    "你们每天的工单里,最近一周数量最多的是哪几类?",  # 原:觉得 AI 会不会有帮助
    "上一次有工单是客服卡住、拖了很久才处理完的,是什么情况?",  # 原:会不会用全自动 AI
    "上周客服花时间最多的一件事是什么?他当时一步步是怎么做的?",  # 原:希望有哪些功能
    "最近一次退款申请,从客户提出到钱退出去,中间经过了哪些人?",  # 原:AI 能不能搞定退款
    "现在处理一张工单大概要多久?最近一次特别慢的是为什么?",  # 原:愿意付多少钱
]

llm = LLMClient()
for name, qs in [("原来的坏问题", BAD), ("改写后", REWRITTEN)]:
    got = covered("\n".join(ask(llm, start(), qs)))
    print(f"{name}:问出 {len(got)}/{len(FACTS)} 条  {' '.join(sorted(got))}")
print(llm.ledger)
```

<div class="line-notes">

- `REWRITTEN = [` 五个改写后的问题,每个后面的注释写了它替换的原问题。
- `"你们每天的工单里,最近一周数量最多的是哪几类?",` 替换「觉得 AI 有没有帮助」:不问态度,问现状数据。
- `"上一次有工单是客服卡住、拖了很久才处理完的,是什么情况?",` 替换「会不会用全自动 AI」:从「最近一次的痛」入手。
- `"上周客服花时间最多的一件事是什么?他当时一步步是怎么做的?",` 替换「希望有哪些功能」:功能是从过程里长出来的,不是对方想出来的。
- `"最近一次退款申请,从客户提出到钱退出去,中间经过了哪些人?",` 替换「AI 能不能搞定退款」:问流程,不问判断。
- `"现在处理一张工单大概要多久?最近一次特别慢的是为什么?",` 替换「愿意付多少钱」:问现状成本,价格以后再谈。
- `for name, qs in [("原来的坏问题", BAD), ("改写后", REWRITTEN)]:` 对两组问题各自跑一次,每组都用一个全新的对话(`start()`)。

</div>

```bash
uv run python -m part08.ex2_rewrite
```

```text
原来的坏问题:问出 0/13 条  
改写后:问出 7/13 条  F02 F03 F04 F08 F10 F11 F13
10 次调用 | 输入 5268 / 输出 269 tokens | 约 ¥0.0062
```

同样五个问题的位置,从 0 条到 7 条。比 `GOOD` 的 10 条少,因为改写时我没有刻意去碰「红线」和「例外」这两个话题。改写能提升问出来的东西,但话题覆盖要靠清单。

</details>

### 练习 3:给你自己的场景写访谈清单

选一个你熟悉的业务(你公司的、前公司的都行,比如 HR 问答、IT 工单、报销审核),按上面七个话题写出清单:每个话题一个「最近一次」式的问题。不用跑代码。

<details><summary>参考答案</summary>

以「公司内部的报销审核」为例,我写的是:

| 话题 | 问题 |
| --- | --- |
| 规模和现状 | 财务每个月收多少张报销单?最近一个月里哪类最多? |
| 最近一次出事 | 上一次报销被驳回又被员工投诉,是什么情况? |
| 规则从哪来 | 餐费、差旅的上限现在写在哪里?新人怎么知道? |
| 例外和不适用 | 有没有哪些人或哪些部门不适用这套标准?最近一次怎么处理的? |
| 系统和流程 | 一张单子从提交到打款要经过几个人、几个系统? |
| 红线 | 有哪些情况必须由财务经理亲自看?谁定的? |
| 大额和审批 | 超过多少钱要多一道审批?最近一次是谁批的、花了多久? |

自检办法:把每个问题里的「最近一次」「上一次」去掉,看它会不会变成泛泛的意见题。会的话,说明这句话里真正起作用的是「最近一次」。

</details>

### 练习 4:把「待问」变成追问清单

需求表里状态是「待问」的行,是下一次访谈的话头。写一个函数 `open_questions(rows)`,为每个「待问」行生成一个追问,并打印出来。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part08/ex4_open_questions.py
"""练习 4:把『待问』的行变成下一次访谈的追问清单。"""
from part08.requirements import ROWS


def open_questions(rows):
    return [f"{r.id}『{r.quote}』:具体指什么?最近一次是怎么发生的?" for r in rows if r.status == "待问"]


for q in open_questions(ROWS):
    print("-", q)
```

<div class="line-notes">

- `from part08.requirements import ROWS` 直接用需求表数据。这里 import 时不会跑 `requirements.py` 里 `if __name__ == "__main__":` 下面的代码,所以不会重复写文件。
- `def open_questions(rows):` 返回一个字符串列表。
- `[f"{r.id}『{r.quote}』:具体指什么?最近一次是怎么发生的?" for r in rows if r.status == "待问"]` 列表推导式:只处理状态是「待问」的行,把原话套进「具体指什么?最近一次」的模板里。
- `for q in open_questions(ROWS):` 打印每一条,开头加 `-`。

</div>

```bash
uv run python -m part08.ex4_open_questions
```

```text
- R11『最好它很聪明,客户满意』:具体指什么?最近一次是怎么发生的?
```

表里只有 R11 一行是「待问」,所以只出一条。「客户满意」得追问到可以量:满意度问卷?复购?投诉数?追问出来以后,它才有资格变成验收指标。

</details>

**验收标准:** `part08/` 下有 `interview_sim.py`、`interview_repeat.py`、`requirements.py` 并能跑通;`part08/docs/requirements.md` 存在,12 行,检查通过;你能不看稿说出「问过去」的三条规矩,和需求表的四列。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| FDE(Forward Deployed Engineer) | 前线部署工程师,驻在客户那里把需求拆清楚并亲手做出来的工程师;Palantir 推广了这个岗位,后来 AI 公司也在招 |
| 访谈 | 和真实用户或客户一对一聊,目的是搞清楚他们现在怎么做、哪里疼,不是推销方案 |
| 问过去 | 只问「最近一次」「当时怎么做的」这类具体已发生的事,不问「你会不会」这类将来的意见 |
| 访谈清单 | 事先写好的话题列表,每个话题配一个问过去的问题,防止漏问 |
| 追问 | 顺着对方说到一半的词继续问,挑一个名词或数字追下去 |
| 事实表 | 访谈里问出来的一条一件事的记录,这里用 F01–F13 编号 |
| 需求表 | 把原话拆成「真实问题、需求、怎么验收」的表,这里用 R1–R12 编号 |
| 验收办法 | 一条需求怎么判定做完了、做对了;写不出来说明需求还没想清楚 |
| 非目标 | 明确写下「这期不做」的东西,明天的 PRD 里详细讲 |
| 人设提示词 | 让模型扮演某个角色并遵守说话规矩的 system 提示词 |

## 常见误区

**访谈时问「你想要什么功能」。** 对方会客套,或者给你一堆他想象出来的功能。今天的实验里,五个这类问题问出 0 条事实。换成「最近一次你是怎么做的」,同一个人立刻开口。

**需求表只写到「需求」那一列。** 没有验收办法的需求没法验收,做完不知道算不算做完。`check()` 的第一条就是拦这个。

**把模型扮演的客户当成真客户。** 它会编故事,三次跑的故事细节都不一样。它只能让你练手法,不能提供事实。真项目里事实必须来自真人。

**只靠临场发挥访谈。** 我第一版 `GOOD` 里没有「例外」那一行,漏了企业版。清单不是用来念的,是用来在访谈前找自己的漏洞。

**听到了但没落到表里。** 删掉 R6 之后,F08 就没人用了。信息只要没进表,开工时就会被忘掉。事实和需求用编号挂钩,是为了让这种遗漏能被脚本发现。

**正则判卷太松或太紧,然后拿数字当结论。** `FACTS` 里的正则是粗判,「涉及钱」这样的词能命中很多说法。同样的实验我跑了三遍,好访谈从 9 到 11 条不等。比较方向可信,具体数字别当精确值引用。

## 学习资料

### 文档与文章

- [The Mom Test(作者官网)](https://www.momtestbook.com/):Rob Fitzpatrick 的书的官网,有三条规矩的简介和购买入口。10 分钟。
- [Nielsen Norman Group · User Interviews 101](https://www.nngroup.com/articles/interviewing-users/):用户体验研究机构写的访谈入门,讲怎么准备、怎么问、怎么记。英文,20 分钟。
- [Kanerika · Forward Deployed Engineer](https://kanerika.com/blogs/forward-deployed-engineer/):FDE 岗位的介绍,厂商博客,里面的数字和起源说法仅供参考。15 分钟。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):里面把「客服」列为 Agent 合适的场景之一,理由和我们今天从访谈里拆出来的东西(有对话、有动作、有明确成功标准、能接人工)基本对得上。读到客服那一段即可。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1jnAwztEvs&autoplay=0&high_quality=1" title="25分钟的《妈妈测试》" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>凉面派_123 · 25分钟的《妈妈测试》 · 23 分钟,把这本书的几条规矩按顺序讲一遍。看的时候对照今天实验里的坏问题和好问题,每条规矩找一个例子。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/uUr0zxUqIGA" title="[The Mom Test] AI can't run your customer interviews (but it *can* help in other ways) | Rob Fitzpatrick" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Rob Fitzpatrick · AI can't run your customer interviews (but it can help in other ways) · 英文。作者讲为什么不能让 AI 替你访谈,以及 AI 可以帮在哪些环节。正好和今天「模拟客户只能练手法」的结论互相印证。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/tOojBwR8cis" title="[Mom Test] Mini-workshop to find critical gaps in your customer understanding | Rob Fitzpatrick" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Rob Fitzpatrick · Mini-workshop to find critical gaps in your customer understanding · 英文。一个小练习:列出你对客户不知道的事,和今天的「访谈清单」想解决的是同一类漏洞。</figcaption>
</figure>

### 书籍

- Rob Fitzpatrick《The Mom Test》(2013):一本很薄的英文书,讲怎么和人聊才能问出真话,今天的三条规矩来自它。我没有查到中文版的出版信息,按英文原版写。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看它的 `envs` 下面怎么把客服场景的政策写成文档、数据写成库、工具写成函数。你今天的需求表,后面就是要变成这样一套东西。

## 自测

1. 「问意见」和「问过去」各举一个问题,说说为什么前者问不出事实。

<details><summary>答案</summary>

问意见:「如果我们做一个全自动处理工单的 AI,你会用吗?」对方回答的是对一个还不存在的东西的想象,常常是客套话。问过去:「最近一次有客服在退款上出了问题,能讲讲当时具体怎么回事吗?」对方回答的是已经发生的事,带着具体的数字、人和做法。实验里五个问意见的问题问出 0 条事实。

</details>

2. 需求表为什么要有「怎么验收」这一列?`check()` 里哪一条在保护它?

<details><summary>答案</summary>

验收办法决定了「做完」的定义,也是后面写评测集的骨架。写不出验收办法的需求说明还没想清楚。`check()` 里「状态是『做』但 `accept` 为空」那一条在保护它;这样的需求要么补上验收办法,要么改成「待问」或「不做」。

</details>

3. 脚本检查二说的「每条事实都被某条需求用到」,防的是什么?

<details><summary>答案</summary>

防「听到了但忘了做」。访谈里问出来的事实如果没有任何需求引用它,它很可能被遗漏了(删掉 R6 之后,F08「超过 1000 元要财务复核」就是这样被抓到的)。如果确实不该做,也应该显式写成一条「不做」,而不是悄悄消失。

</details>

4. 为什么同一个模拟实验我要跑三遍才下结论?

<details><summary>答案</summary>

模型每次回答不完全一样,即使 `temperature=0`。三遍里好访谈问出的条数是 11、9、10,坏访谈三遍都是 0。方向稳定,具体数字不稳定,所以只能说「好访谈明显更多」,不能说「好访谈正好问出 10 条」。

</details>

5. **面试题**:面试官问「这个项目的需求是怎么来的?你怎么知道做完了?」你怎么答?

<details><summary>答案</summary>

我先把要做的场景拆成几个话题(规模、最近一次出事、规则来源、例外、系统流程、红线、大额审批),对每个话题问「最近一次」式的问题,而不是问「你想要什么功能」。问出来的内容记成编号的事实,再拆成需求表,每条需求写原话、真实问题、需求本身和验收办法,写不出验收办法的挂在待问或写进非目标。我还写了一个脚本检查:每条要做的需求都有验收办法,每条事实都有需求用到它。所以我说得出来「企业版转人工」这条规则是客服负责人在回答「哪类客户不适用」时说的,「做完」的定义就是这些验收办法在评测里全部通过。需要补一句诚实的话:这个项目里的访谈是我用模型扮演客户练出来的,真实项目里事实必须来自真人。

</details>

## 明天预告

明天是 Day 437 · 一页 PRD:背景、用户、目标、非目标、指标、风险。今天的需求表有 12 行,PRD 要把它压成一页纸:写什么是目标、什么刻意不做、每条目标用什么指标衡量、有什么风险。明天还会写一个脚本检查这份 PRD,看每条目标有没有指标、每条非目标有没有理由,让 PRD 不是一份「写完就不看」的文档。
