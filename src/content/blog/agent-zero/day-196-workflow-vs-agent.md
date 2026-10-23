---
title: 'Day 196 · Workflow 还是 Agent:两个定义和一个构件'
description: '第四周起换个角度:不是所有任务都需要让模型自己决定下一步。今天讲清 Anthropic 对 workflow 和 agent 的定义(下一步谁决定),再造一个「增强型 LLM」的小构件 wf_common.py,供接下来五种 workflow 模式共用。同一张重复扣费工单写成 workflow 和 agent 各跑五遍:workflow 固定两次模型调用、275 个输入 token、约 ¥0.0012;agent 三次调用、2502 个输入 token、约 ¥0.0042。再换两张不按套路来的工单,看哪边会转人工、哪边能自己想办法。'
pubDate: 2026-10-23
regime: none
tags: ['workflow', 'agent', 'design-patterns', 'agent-zero']
series: 'agent-zero'
day: 196
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 195](/blog/agent-zero/day-195-week28-review/) 是第 28 周的复习日:一张知识地图把九类失败和六天的零件对上,默写了 `LoopGuard.check` 和最小主循环,小项目往 Agent 里随机撒故障,量出了防线值多少钱,也量出两条防线自己带来的副作用。

那一周的主题是「一个 Agent 循环怎么才结实」。今天换个问题:**这个任务到底需不需要 Agent 循环?** 循环里的模型每一步都要自己拿主意,这是它的本事,也是它贵、慢、难测、会出事的原因。如果任务的步骤其实是固定的,把步骤写进代码里,模型只在每一步里干活,往往更便宜也更稳。接下来六天(Day 196 到 201)把这条路走一遍:先分清两个定义,然后一个一个实现五种常见的 workflow 模式。

## 今天要解决的问题

学完今天,你应该能:

1. 用一句话说出 workflow 和 agent 的区别,并对任意一段代码判断:下一步是谁决定的。
2. 解释「增强型 LLM」是什么,分别用检索、工具、记忆三种增强各跑一次,看到答案怎么变。
3. 读懂并跑通 `part03/wf_common.py`,这是后面五天共用的构件:四个调模型的函数加一张工单。
4. 拿同一张工单分别写成 workflow 和 agent,实测两者的调用次数、token、耗时、花费和路径,并说出各自适合什么情形。

今天两个新概念:**workflow 与 agent 的区别**、**增强型 LLM**。

预计用时 3 小时。前置:[Day 166](/blog/agent-zero/day-166-agent-min/) 和 [Day 170](/blog/agent-zero/day-170-agent-full/)(Agent 循环)、[Day 157](/blog/agent-zero/day-157-tool-schema/)(工具 schema)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)(`LLMClient` 和 `Conversation`)、[Day 195](/blog/agent-zero/day-195-week28-review/)(本周为什么要防线)、[Day 68](/blog/agent-zero/day-068-async-3/)(`asyncio.gather`)、[Day 74](/blog/agent-zero/day-074-pytest-4/)(monkeypatch)。代码在 `agent-zero-lab/part03/` 和 `tests/`,命令都在 `agent-zero-lab/` 根目录跑。今天真调模型,全部实跑加起来约 ¥0.07,算法见文末「花费」一节。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `wf_common.py` 里的 `llm_json` 和 `two_ways.py` 里 `workflow` 的骨架;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 一个问题:下一步谁决定

先从前端熟悉的东西说起。你写过一个表单提交流程:校验、提交、跳转,每一步做什么、顺序是什么,都是你在代码里写死的。用户点按钮,程序按你画好的路走。换一种写法,你把一堆函数交给一个「会自己看情况」的东西,告诉它目标,让它自己决定先调哪个、再调哪个、什么时候算完。这两种写法解决得了的事情不一样,出事的方式也不一样。

Anthropic 在 2024 年 12 月发过一篇工程文章《Building effective agents》,里面有两个定义,今天的整个主题都挂在上面。我原样引一下(2026 年 10 月重新读过,页面顶部注明文中提到的一些工具已经变了,但这两个定义还是老样子):

- **Workflow(工作流)**:"systems where LLMs and tools are orchestrated through predefined code paths",模型和工具按**预先写好的代码路径**编排。
- **Agent(智能体)**:"LLMs dynamically direct their own processes and tool usage, maintaining control over how they accomplish tasks",模型**动态地决定**自己的流程和工具使用,自己掌控怎么完成任务。

两者合在一起,文章叫 **agentic systems**(智能体系统)。名字不重要,区别只有一个:**下一步做什么,是代码决定的,还是模型决定的。**

对照 [Day 166](/blog/agent-zero/day-166-agent-min/) 写的 25 行循环:`while` 里调一次模型,模型回了 `tool_calls` 就执行,没回就结束。循环本身是写死的,但「调哪个工具、调几次、什么时候不再调」全是模型在每一轮里决定的,所以它是 agent。而今天要写的 workflow 是另一种形状:第一步调模型抽信息,第二步代码查订单,第三步代码判断,第四步再调模型写回复。步骤数、顺序、什么条件走哪条分支,都在 `if` 和函数调用里,模型只在两个格子里干「理解文字、写文字」的活。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="左边 workflow:四个方框固定顺序,其中两个由模型完成,两个由代码完成;右边 agent:模型在一个循环里决定调哪个工具">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">下一步谁决定</text>
  <text x="160" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Workflow:代码画好路</text>
  <rect x="85" y="70" width="150" height="38" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="160" y="93" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">1 模型:抽取订单号</text>
  <rect x="85" y="124" width="150" height="38" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="160" y="147" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">2 代码:查订单</text>
  <rect x="85" y="178" width="150" height="38" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="160" y="201" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">3 代码:判断+提交退款</text>
  <rect x="85" y="232" width="150" height="38" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="160" y="255" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">4 模型:写回复</text>
  <path d="M160 108 V124 M160 162 V178 M160 216 V232" stroke="var(--ink-soft)" fill="none"/>
  <path d="M155 118 l5 6 l5 -6 M155 172 l5 6 l5 -6 M155 226 l5 6 l5 -6" stroke="var(--ink-soft)" fill="none"/>
  <line x1="320" y1="44" x2="320" y2="280" stroke="var(--rule)" stroke-dasharray="4 4"/>
  <text x="480" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Agent:模型每步自己选</text>
  <rect x="410" y="100" width="140" height="56" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="480" y="124" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">模型</text>
  <text x="480" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">看到什么,决定下一步</text>
  <rect x="360" y="210" width="80" height="34" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="400" y="231" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">查订单</text>
  <rect x="450" y="210" width="80" height="34" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="490" y="231" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">搜帮助</text>
  <rect x="540" y="210" width="80" height="34" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="580" y="231" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">提退款</text>
  <path d="M450 156 L400 210 M480 156 L490 210 M510 156 L580 210" stroke="var(--ink-soft)" fill="none"/>
  <path d="M440 190 C420 175 420 175 430 165" stroke="var(--ink-faint)" fill="none" stroke-dasharray="3 3"/>
  <text x="480" y="276" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">选一个,拿到结果,再回来选,直到它说「够了」</text>
</svg>
<figcaption>蓝色是模型干的活,琥珀色是代码干的活。左边路径在写代码时就定了,右边每次运行的路径可能不一样。</figcaption>
</figure>

这个区分听起来像咬文嚼字,实际上决定了一串工程后果。路径写死,你就能给每一步写测试、给每一步定超时、预估每次花多少钱、出了错一眼看出哪一步坏了。路径交给模型,你得到的是灵活:工单里没写订单号、客户问了一个你没想到的问题,它会自己想办法。代价是每次运行路径可能不同,花费和耗时有波动,本周前面六天讲的那些防线都得上。

同一篇文章里还有一段我觉得是全文最重要的话,大意是:构建 LLM 应用时,先找最简单的方案,只在必要时增加复杂度,这可能意味着根本不要去构建 agentic 系统;agentic 系统通常拿延迟和成本换更好的任务表现,你要想清楚这笔交易值不值;很多应用里,一次 LLM 调用配上检索和几个示例就已经够了。今天的实验就是为了让你亲眼看一次这笔交易的账。

## 那一个构件:增强型 LLM

文章说 agentic systems 的基本构件是 **augmented LLM(增强型 LLM)**:一个配了**检索(retrieval)**、**工具(tools)**、**记忆(memory)** 三种增强的模型。三个词大白话各是:

- 检索:模型自己不知道的资料(你们公司的帮助中心、政策文档),先去搜出来再贴给它看。第四部分会用向量检索做,今天用一个土办法:数关键字。
- 工具:模型做不了、得由代码去做的事,比如查订单、提交退款。你在第三部分已经学过 function calling。
- 记忆:上一轮说过什么、之前发生过什么,要不要带进这一轮。最朴素的记忆就是 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 的 `Conversation`:把历史消息再发一遍。

注意这三样东西在今天的意思:**增强型 LLM 只是一个「能被喂资料、能被调用、能记住上文」的积木**,不是 agent。它既可以被塞进 workflow 的某一格,也可以放进 agent 的循环里。五种 workflow 模式里每一格,都是一个增强型 LLM 在干活。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="增强型 LLM:中间是模型,三条箭头分别连接检索、工具、记忆,输入输出在两端">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">增强型 LLM = 模型 + 三种增强</text>
  <rect x="250" y="95" width="140" height="64" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="320" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">LLM</text>
  <text x="320" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">llm() / llm_json()</text>
  <rect x="250" y="30" width="140" height="38" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="320" y="53" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">检索:search_help</text>
  <rect x="250" y="186" width="140" height="38" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="320" y="209" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">记忆:Conversation</text>
  <rect x="440" y="95" width="160" height="64" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="520" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">工具:lookup_orders</text>
  <text x="520" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">create_refund_request</text>
  <rect x="30" y="107" width="130" height="40" fill="var(--paper)" stroke="var(--ink-soft)" rx="4"/>
  <text x="95" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">输入:一张工单</text>
  <path d="M320 68 V95 M320 186 V159 M390 127 H440 M160 127 H250" stroke="var(--ink-soft)" fill="none"/>
  <text x="320" y="240" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">谁来决定用不用这三样?workflow 里是代码,agent 里是模型</text>
</svg>
<figcaption>三种增强都是模型之外的东西。今天的 <code>wf_common.py</code> 只造中间那个方框,另外三样放在 <code>ticket_tools.py</code>。</figcaption>
</figure>

## 先造零件:工单场景的三样东西

后面六天全用云簿 CloudLedger 这家虚构 SaaS 公司的客服工单做例子。先把「工具」和「检索」两样东西造出来,放在 `part03/ticket_tools.py`。这是 Day 196 新建的文件,不依赖前面任何文件,也不调模型。

```python
# agent-zero-lab/part03/ticket_tools.py  Day 196:云簿工单场景的三样「增强」:查订单、搜帮助中心、提退款申请
from typing import Any

ORDERS: dict[int, list[dict[str, Any]]] = {
    10086: [
        {"order_id": "CL-20931", "amount": 1188, "paid_at": "2026-09-28 10:02:11", "status": "paid", "plan": "专业版年付"},
        {"order_id": "CL-20932", "amount": 1188, "paid_at": "2026-09-28 10:02:14", "status": "paid", "plan": "专业版年付"},
        {"order_id": "CL-18077", "amount": 1188, "paid_at": "2025-09-27 09:40:02", "status": "paid", "plan": "专业版年付"},
    ],
    10087: [
        {"order_id": "CL-20940", "amount": 99, "paid_at": "2026-10-01 08:15:30", "status": "paid", "plan": "基础版月付"},
    ],
}

HELP_ARTICLES: list[dict[str, str]] = [
    {"title": "重复扣费怎么处理", "body": "同一张订单在 10 分钟内被扣款两次,算重复扣费。客服核实后提交退款申请,多扣的一笔原路退回,银行通常需要 5 到 10 个工作日到账。"},
    {"title": "退款多久到账", "body": "退款申请审核通过后,款项原路退回,到账时间取决于发卡银行,一般 5 到 10 个工作日。云簿不能保证具体到账日期。"},
    {"title": "怎么开发票", "body": "在「账单」页面点击订单右侧的「申请发票」,填写抬头和税号,电子发票 1 个工作日内发到注册邮箱。"},
]

REFUND_REQUESTS: list[dict[str, str]] = []  # 假的「退款申请表」,演示用,看有没有人往里写


def lookup_orders(customer_id: int) -> list[dict[str, Any]]:
    """按客户编号查订单,查不到返回空列表。"""
    return ORDERS.get(customer_id, [])


def search_help(query: str, top_k: int = 2) -> list[dict[str, str]]:
    """最朴素的检索:数 query 里的字有多少出现在文章里,取前 top_k 篇。第四部分会换成向量检索。"""
    scored = [(sum(ch in a["title"] + a["body"] for ch in set(query) if ch.strip()), a) for a in HELP_ARTICLES]
    scored.sort(key=lambda x: x[0], reverse=True)
    return [a for score, a in scored[:top_k] if score > 0]


def create_refund_request(order_id: str, reason: str) -> dict[str, str]:
    """提交退款申请(演示:只往列表里记一行)。"""
    request_id = f"RF-{len(REFUND_REQUESTS) + 1:04d}"
    REFUND_REQUESTS.append({"request_id": request_id, "order_id": order_id, "reason": reason})
    return {"request_id": request_id, "order_id": order_id, "status": "submitted"}


TICKET_NO_ORDER_ID = """客户:陈先生(customer_id 10086)
主题:好像多扣钱了
内容:我 9 月底续费专业版,感觉被扣了两次,但订单号我找不到了,你们帮我查一下,多扣的退给我。"""

TICKET_NOT_DUP = """客户:李女士(customer_id 10087,基础版月付)
主题:想退款
内容:我 10 月 1 号付了 99 元的基础版月付(CL-20940),但我不想用了,请把这笔钱退给我。"""
```

<div class="line-notes">

- `from typing import Any` 代码里 `dict[str, Any]` 的 `Any` 表示「值什么类型都行」,订单字典里有字符串也有整数。
- `ORDERS: dict[int, list[dict[str, Any]]] = {` 一个字典:键是客户编号(整数),值是这个客户的订单列表,每笔订单又是一个字典。相当于 JS 里的 `Record<number, Order[]>`。10086 是工单里的陈先生。
- `{"order_id": "CL-20931", "amount": 1188, "paid_at": "2026-09-28 10:02:11",` 陈先生的第一笔订单。故意把 `CL-20931` 和 `CL-20932` 的金额写成同样的 1188、扣款时间只差 3 秒(10:02:11 和 10:02:14),这就是「重复扣费」的样子。
- `{"order_id": "CL-18077", "amount": 1188, "paid_at": "2025-09-27 09:40:02",` 去年同一天的续费订单,是个干扰项:金额也是 1188,但差了一年,不是重复扣费。后面的 `find_duplicate` 要靠时间把它排除。
- `10087: [` 另一个客户,只有一笔 99 元的月付订单,后面「不是重复扣费」那张工单用它。
- `HELP_ARTICLES: list[dict[str, str]] = [` 三篇假的帮助中心文章,每篇有标题和正文。检索就在这三篇里搜。
- `"body": "同一张订单在 10 分钟内被扣款两次,算重复扣费。客服核实后提交退款申请,多扣的一笔原路退回,银行通常需要 5 到 10 个工作日到账。"` 注意这篇写的是 5 到 10 个工作日。后面光秃秃的模型会张口说 1 到 3 个工作日,对照这里就能看出检索的价值。
- `REFUND_REQUESTS: list[dict[str, str]] = []` 一个模块级的空列表,假装是退款申请表。哪个函数提交了退款,就往里 `append` 一行,实验结束后看里面有什么,就知道有没有人真的「动了钱」。
- `def lookup_orders(customer_id: int) -> list[dict[str, Any]]:` 工具一:按客户编号查订单。
- `return ORDERS.get(customer_id, [])` `.get(键, 默认值)`:查得到返回订单列表,查不到返回空列表 `[]` 而不是报错。`lookup_orders(10086)` 返回 3 笔,`lookup_orders(99999)` 返回 `[]`。
- `def search_help(query: str, top_k: int = 2) -> list[dict[str, str]]:` 检索:最朴素的版本,按「query 里有多少个字出现在文章里」打分。
- `scored = [(sum(ch in a["title"] + a["body"] for ch in set(query) if ch.strip()), a) for a in HELP_ARTICLES]` 从里往外读:`set(query)` 把问题拆成不重复的字(「我被重复扣费了」拆成 7 个字);`ch in 标题加正文` 是真假值,`sum` 把真当 1 假当 0 加起来,就是命中了几个字;`if ch.strip()` 跳过空格。外层的列表推导式对每篇文章算一个(分数, 文章)的元组。这个打分很粗糙,「的」「了」这种字会虚高,第四部分会换成向量检索。
- `scored.sort(key=lambda x: x[0], reverse=True)` 按元组的第 0 项(分数)从高到低排序。
- `return [a for score, a in scored[:top_k] if score > 0]` 取前 `top_k` 篇,并且分数得大于 0,一个字都不沾边的不返回。「我被重复扣费了,退款多久能到账?」会命中《重复扣费怎么处理》和《退款多久到账》两篇。
- `def create_refund_request(order_id: str, reason: str) -> dict[str, str]:` 工具二:提交退款申请。真实系统里这是一个会动钱的写操作,今天只往列表里记一行。
- `request_id = f"RF-{len(REFUND_REQUESTS) + 1:04d}"` `:04d` 把整数补零到 4 位。列表里已有 0 条时,编号是 `RF-0001`;已经有 1 条,下一个是 `RF-0002`。
- `REFUND_REQUESTS.append({"request_id": request_id, "order_id": order_id, "reason": reason})` 往「申请表」追加一行。
- `return {"request_id": request_id, "order_id": order_id, "status": "submitted"}` 返回给调用者(代码或者模型)的是一个小回执。
- `TICKET_NO_ORDER_ID = """客户:陈先生(customer_id 10086)` 第二张工单:客户没写订单号。后面看 workflow 遇到它怎么办。
- `TICKET_NOT_DUP = """客户:李女士(customer_id 10087,基础版月付)` 第三张工单:客户要退的是一笔正常的订单,根本不是重复扣费,看谁会手滑把钱退了。

</div>

## 再造构件:wf_common.py

接下来是后面五天都要 import 的 `wf_common.py`。它做两件事:把「调一次模型」包成四个函数,以及放一张共用的工单。它建在 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 的 `LLMClient` 上,所以每次调用的 token 和花费自动记进账本。

```python
# agent-zero-lab/part03/wf_common.py  Day 196:五种 workflow 模式共用的小构件(调模型的四个函数 + 一张工单)
import asyncio
import json
import os
from typing import Any

from dotenv import load_dotenv

from common.llm import LLMClient

load_dotenv()  # 先读 .env,下面的 os.environ 才有值

MODEL = os.environ.get("LLM_MODEL", "")  # 默认模型,实测是 deepseek-flash
BIG_MODEL = os.environ.get("LLM_BIG_MODEL", MODEL)  # 贵一档的模型,没配就和默认的是同一个
_PRICES = {MODEL: os.environ.get("LLM_PRICE"), BIG_MODEL: os.environ.get("LLM_BIG_PRICE") or os.environ.get("LLM_PRICE")}
_clients: dict[str, LLMClient] = {}


def client_for(model: str | None = None) -> LLMClient:
    """每个模型名对应一个 LLMClient(各自有各自的账本和单价),第一次用到才建。"""
    name = model or MODEL
    if name not in _clients:
        _clients[name] = LLMClient(model=name, price=_PRICES.get(name))
    return _clients[name]


def llm(prompt: str, system: str = "", model: str | None = None) -> str:
    """一次调用,返回文本。"""
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    return client_for(model).chat(messages).content


def llm_json(prompt: str, system: str = "", model: str | None = None) -> dict[str, Any]:
    """一次调用,要求模型输出 JSON 对象,返回解析好的 dict。提示词里必须出现「JSON」这个词。"""
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    r = client_for(model).chat(messages, response_format={"type": "json_object"})
    return json.loads(r.content or "{}")


async def allm(prompt: str, system: str = "", model: str | None = None) -> str:
    """llm 的异步版:把同步调用丢进线程里跑,好让 asyncio.gather 同时发出多个请求。"""
    return await asyncio.to_thread(llm, prompt, system, model)


async def allm_json(prompt: str, system: str = "", model: str | None = None) -> dict[str, Any]:
    return await asyncio.to_thread(llm_json, prompt, system, model)


def total_cost() -> float:
    """所有客户端的花费加起来(元),脚本最后打印一下。"""
    return sum(c.ledger.cost for c in _clients.values())


def total_calls() -> int:
    return sum(c.ledger.calls for c in _clients.values())


TICKET = """客户:陈先生(customer_id 10086,专业版年付)
主题:被重复扣费了!!
内容:我 9 月 28 号续费专业版,银行卡被扣了两次 1188 元,订单号 CL-20931 和 CL-20932。
你们系统是不是有 bug?我要求退回多扣的那笔,而且要一个解释。三天内没处理我就投诉。"""
```

<div class="line-notes">

- `import asyncio` 异步版的函数要用 `asyncio.to_thread`。
- `from dotenv import load_dotenv` 读 `.env` 用的,和前面几天一样。
- `from common.llm import LLMClient` [Day 135](/blog/agent-zero/day-135-llm-client-1/) 建的客户端。`wf_common` 不自己直接碰 openai SDK。
- `load_dotenv()  # 先读 .env,下面的 os.environ 才有值` 注意顺序:`LLMClient()` 自己也会读 `.env`,但下面 `MODEL = os.environ.get(...)` 在模块加载时就要用,所以这里先读一次。
- `MODEL = os.environ.get("LLM_MODEL", "")  # 默认模型,实测是 deepseek-flash` `.get` 带默认值,没配时是空字符串,不会在 import 时崩。
- `BIG_MODEL = os.environ.get("LLM_BIG_MODEL", MODEL)` Day 198 的路由要用「贵一档的模型」,今天先留好位置:没配 `LLM_BIG_MODEL` 就退回默认模型。
- `_PRICES = {MODEL: os.environ.get("LLM_PRICE"), BIG_MODEL: os.environ.get("LLM_BIG_PRICE") or os.environ.get("LLM_PRICE")}` 每个模型名对应一个价格字符串。`.env` 里 `LLM_PRICE=0.04,2,8` 是 deepseek-flash 高峰时段的价格(元每百万 token:缓存命中、未命中、输出)。`或` 的意思是:大模型没配单独的价格就用默认价格。注意如果两个模型名相同,字典里同一个键后写的覆盖先写的,结果还是同一个价格。
- `_clients: dict[str, LLMClient] = {}` 缓存:模型名到客户端。下划线开头表示模块内部用。
- `def client_for(model: str | None = None) -> LLMClient:` 拿某个模型的客户端。不传就是默认模型。
- `name = model or MODEL` 传了就用传的,`None` 就用默认。
- `if name not in _clients:` 第一次用到才建,之后复用。这样同一个模型的所有调用共用一个账本,脚本最后能一次算出总花费。
- `_clients[name] = LLMClient(model=name, price=_PRICES.get(name))` 建客户端时把模型名和价格作为覆盖项传进去,`LLMClient` 的 `overrides` 接受 `model` 和 `price`。
- `def llm(prompt: str, system: str = "", model: str | None = None) -> str:` 第一个函数:一个提示词进,一段文本出。
- `messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]` 条件表达式加列表相加:有 system 时是两条消息,没有就只有一条 user。`llm("你好")` 拼出来是 `[{"role": "user", "content": "你好"}]`,测试里钉住了这一点。
- `return client_for(model).chat(messages).content` `chat` 返回 `ChatResult`,取它的 `.content` 就是文本。实测 `llm('用一句话说你是谁')` 花 1.22 秒,回了「我是 DeepSeek,由深度求索公司创造的 AI 助手」。
- `def llm_json(prompt: str, system: str = "", model: str | None = None) -> dict[str, Any]:` 第二个函数:要求模型输出 JSON,返回解析好的 dict。
- `r = client_for(model).chat(messages, response_format={"type": "json_object"})` `chat` 的 `**kw` 原样传给 openai,`response_format` 就是结构化输出那几天([Day 147](/blog/agent-zero/day-147-structured-1/) 起)学过的 JSON 模式。用这个模式时提示词里必须出现 "JSON" 这个词,否则服务端会报 400。
- `return json.loads(r.content or "{}")` `json.loads` 把字符串变成 dict;内容为空时兜成 `{}`,后面写 `facts.get("order_ids")` 不会因为 `None` 崩。模型返回的不是合法 JSON 时这里会抛 `JSONDecodeError`,今天先不处理,Day 197 的门控会管这件事。
- `async def allm(prompt: str, system: str = "", model: str | None = None) -> str:` 第三个函数:`llm` 的异步版。
- `return await asyncio.to_thread(llm, prompt, system, model)` `asyncio.to_thread` 把一个普通的同步函数丢进另一个线程里跑,`await` 等它回来。几个 `allm` 用 `asyncio.gather` 同时发出去,就是几个线程各等各的网络。`LLMClient` 本身是同步的,这样不用再写一套异步客户端,账本也还是同一个。
- `async def allm_json(` 第四个函数:`llm_json` 的异步版,同样的办法。
- `return sum(c.ledger.cost for c in _clients.values())` 把所有客户端账本里的花费加起来。`.values()` 取字典的所有值,`sum(生成器)` 求和。
- `def total_calls() -> int:` 同样把调用次数加起来,实验脚本拿它做前后相减。
- `TICKET = """客户:陈先生(customer_id 10086,专业版年付)` 共用的工单:两个订单号、一个金额 1188、一个三天时限。后面五天都处理这张工单。

</div>

测一下它能用。下面是临时脚本(不用留):三个提示词同时发,看总耗时是不是比一个一个发短。

```bash
uv run python -c "
import asyncio, time
from part03.wf_common import *
t = time.time(); print(llm('用一句话说你是谁')); print(round(time.time() - t, 2), '秒')
print(llm_json('输出 JSON {\"a\": 1}'))
async def m():
    t = time.time()
    await asyncio.gather(allm('说一个数字'), allm('说一个字母'), allm('说一个颜色'))
    print('三个并发:', round(time.time() - t, 2), '秒')
asyncio.run(m())
print(total_calls(), '次调用,¥', round(total_cost(), 5))
"
```

我实跑的输出:

```text
我是DeepSeek,由深度求索公司创造的AI助手,很高兴为你服务!
1.22 秒
{'a': 1}
三个并发: 0.67 秒
5 次调用,¥ 0.00042
```

`llm` 一次 1.22 秒,三个 `allm` 一起发只用了 0.67 秒,没有变成 3.6 秒。每次网络耗时的波动很大,具体数字别当真,只看趋势。5 次调用总共不到半分钱。

再给它写测试,这是 [Day 74](/blog/agent-zero/day-074-pytest-4/) 的做法:不调真模型,用一个「间谍」假客户端记下收到了什么。新建 `tests/test_wf_common.py`:

```python
# agent-zero-lab/tests/test_wf_common.py  Day 196:不调真模型,检查 wf_common 的四个函数怎么拼请求、怎么解析
from typing import Any

import pytest

from common.llm import ChatResult
from part03 import wf_common


class SpyClient:
    """记下收到的 messages 和 kw,返回写死的内容。"""

    def __init__(self, content: str) -> None:
        self.content = content
        self.calls: list[tuple[list[dict[str, Any]], dict[str, Any]]] = []

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:
        self.calls.append((messages, kw))
        return ChatResult(content=self.content, reasoning=None, finish_reason="stop", message={})


@pytest.fixture
def spy(monkeypatch: pytest.MonkeyPatch) -> SpyClient:
    s = SpyClient('{"a": 1}')
    monkeypatch.setattr(wf_common, "client_for", lambda model=None: s)
    return s


def test_llm_without_system_sends_one_message(spy: SpyClient) -> None:
    assert wf_common.llm("你好") == '{"a": 1}'
    assert spy.calls[0][0] == [{"role": "user", "content": "你好"}]


def test_llm_with_system_puts_it_first(spy: SpyClient) -> None:
    wf_common.llm("你好", system="你是客服")
    assert [m["role"] for m in spy.calls[0][0]] == ["system", "user"]


def test_llm_json_asks_for_json_object_and_parses(spy: SpyClient) -> None:
    assert wf_common.llm_json("给我 JSON") == {"a": 1}
    assert spy.calls[0][1] == {"response_format": {"type": "json_object"}}


def test_llm_json_empty_content_becomes_empty_dict(spy: SpyClient) -> None:
    spy.content = ""
    assert wf_common.llm_json("给我 JSON") == {}
```

<div class="line-notes">

- `import pytest` 要用 `fixture` 和 `MonkeyPatch` 类型。
- `from common.llm import ChatResult` 只为了构造假的返回值,字段和真的一样。
- `from part03 import wf_common` 导入模块本身而不是里面的函数,这样才能改上面的 `client_for` 这个名字(Day 189 的做法)。
- `class SpyClient:` 间谍:有一个和 `LLMClient` 同签名的 `chat`,把每次收到的参数记下来。
- `self.calls: list[tuple[list[dict[str, Any]], dict[str, Any]]] = []` 每次调用记一个元组:(messages, 其余关键字参数)。
- `def chat(self, messages: list[dict[str, Any]], **kw: Any) -> ChatResult:` `**kw` 收下 `response_format` 等所有关键字参数。
- `return ChatResult(content=self.content, reasoning=None, finish_reason="stop", message={})` 只填必填的几个字段,其余用默认值。
- `@pytest.fixture` 装饰器,标记下面的函数是「测试夹具」:测试函数把它的名字写成参数,pytest 会先运行夹具,把返回值传进去。
- `s = SpyClient('{"a": 1}')` 假模型永远回 `{"a": 1}`。
- `monkeypatch.setattr(wf_common, "client_for", lambda model=None: s)` 把 `wf_common.client_for` 换成一个永远返回间谍的函数。测试结束 pytest 自动换回来。
- `assert wf_common.llm("你好") == '{"a": 1}'` `llm` 原样返回文本,不解析。
- `assert spy.calls[0][0] == [{"role": "user", "content": "你好"}]` 没传 system,消息只有一条 user。
- `assert [m["role"] for m in spy.calls[0][0]] == ["system", "user"]` 传了 system,system 在最前面。
- `assert spy.calls[0][1] == {"response_format": {"type": "json_object"}}` `llm_json` 确实要求了 JSON 模式。
- `spy.content = ""` 改成假模型回空字符串。
- `assert wf_common.llm_json("给我 JSON") == {}` 空内容兜成空字典。

</div>

```bash
uv run pytest -q tests/test_wf_common.py
```

```text
....                                                                     [100%]
4 passed in 1.26s
```

## 增强到底增强了什么:同一个问题跑四次

零件齐了。先用一个小实验看三种增强各自带来什么,脚本 `part03/aug_demo.py`。问题固定是「我被重复扣费了,退款多久能到账?」,先问光秃秃的模型,再依次加检索、加工具、加记忆。

```python
# agent-zero-lab/part03/aug_demo.py  Day 196:同一个问题,光秃秃的模型 vs 增强过的模型
from common.llm import Conversation
from part03.ticket_tools import lookup_orders, search_help
from part03.wf_common import client_for, llm, total_cost

QUESTION = "我被重复扣费了,退款多久能到账?"

print("== 1. 光秃秃的模型 ==")
print(llm(QUESTION, system="你是云簿 CloudLedger 的客服,回答控制在 80 字以内。"))

print("\n== 2. 加检索:先搜帮助中心,把命中的文章贴进提示词 ==")
hits = search_help(QUESTION)
print("命中文章:", [h["title"] for h in hits])
context = "\n".join(f"《{h['title']}》{h['body']}" for h in hits)
print(llm(QUESTION, system=f"你是云簿 CloudLedger 的客服,只根据下面的资料回答,80 字以内。\n资料:\n{context}"))

print("\n== 3. 加工具:代码先查订单,把结果贴进提示词 ==")
orders = lookup_orders(10086)
print(f"查到 {len(orders)} 笔订单,最近两笔:{[o['order_id'] for o in orders[:2]]}")
print(llm(f"客户 10086 问:{QUESTION}\n他的订单:{orders}", system="你是云簿客服,结合订单回答,指出具体订单号,80 字以内。"))

print("\n== 4. 加记忆:把上一轮对话带进来 ==")
conv = Conversation("你是云簿 CloudLedger 的客服,回答 40 字以内。")
chat = client_for()
for q in ["我是陈先生,订单号 CL-20931 被扣了两次。", "那另一笔订单号是多少来着?"]:
    conv.add_user(q)
    r = chat.chat(conv.messages())
    conv.add_assistant(r.message)
    print(f"用户:{q}\n客服:{r.content}")
conv2 = Conversation("你是云簿 CloudLedger 的客服,回答 40 字以内。")  # 没带历史的新会话
conv2.add_user("那另一笔订单号是多少来着?")
print("没带记忆:", chat.chat(conv2.messages()).content)
print(f"\n本脚本共 {chat.ledger},折合 ¥{total_cost():.4f}")
```

<div class="line-notes">

- `from common.llm import Conversation` [Day 135](/blog/agent-zero/day-135-llm-client-1/) 的对话管理类,第四步用。
- `from part03.wf_common import client_for, llm, total_cost` 要直接调 `chat` 时用 `client_for()` 拿默认客户端。
- `QUESTION = "我被重复扣费了,退款多久能到账?"` 整个脚本只问这一个问题,变的只有「模型手里有什么」。
- `print(llm(QUESTION, system="你是云簿 CloudLedger 的客服,回答控制在 80 字以内。"))` 第一步:什么都不加。实测回答是「重复扣费退款一般 1-3 个工作日原路到账」。这是模型编的,云簿的资料里写的是 5 到 10 个工作日。它不知道云簿的规则,但它不会说不知道。
- `hits = search_help(QUESTION)` 第二步加检索:先在三篇文章里搜。
- `print("命中文章:", [h["title"] for h in hits])` 实测命中 `['重复扣费怎么处理', '退款多久到账']`,《怎么开发票》分数低没进前两名。
- `context = "\n".join(f"《{h['title']}》{h['body']}" for h in hits)` 把命中的文章拼成一段文字,`"\n".join(...)` 用换行连接。
- `print(llm(QUESTION, system=f"你是云簿 CloudLedger 的客服,只根据下面的资料回答,80 字以内。\n资料:\n{context}"))` 把资料放进 system 提示词。实测回答变成「银行一般 5 到 10 个工作日到账,具体时间以发卡银行为准」,和资料一致。
- `orders = lookup_orders(10086)` 第三步加工具。这里是代码先调了工具,再把结果交给模型,也就是 workflow 的做法。
- `print(f"查到 {len(orders)} 笔订单,最近两笔:{[o['order_id'] for o in orders[:2]]}")` 实测 3 笔,前两笔是 `CL-20931`、`CL-20932`。
- `print(llm(f"客户 10086 问:{QUESTION}\n他的订单:{orders}", system="你是云簿客服,结合订单回答,指出具体订单号,80 字以内。"))` 实测回答里有了具体订单号和日期,「CL-20931 与 CL-20932 于 9 月 28 日重复扣费」。但是时间又回到了「1-3 个工作日」:这一步没有检索,模型又在编到账时间。**一种增强只补一块缺的东西,别的缺口还在。**
- `conv = Conversation("你是云簿 CloudLedger 的客服,回答 40 字以内。")` 第四步加记忆。`Conversation` 管着 messages 列表。
- `chat = client_for()` 这一步要直接用 `chat(messages)`,因为要传整段对话,不是单个提示词。
- `for q in ["我是陈先生,订单号 CL-20931 被扣了两次。", "那另一笔订单号是多少来着?"]:` 两轮对话:第二句只有「另一笔」,脱离第一句根本看不懂。
- `conv.add_user(q)` 把用户这句话记进历史。
- `r = chat.chat(conv.messages())` `conv.messages()` 返回 system 加所有历史轮次。第二轮发出去的 messages 里就带着第一轮的问答。
- `conv.add_assistant(r.message)` 把模型回复也记进历史,下一轮才看得见。
- `conv2 = Conversation("你是云簿 CloudLedger 的客服,回答 40 字以内。")  # 没带历史的新会话` 对照组:同一句「那另一笔订单号是多少来着?」,但没有历史。
- `print("没带记忆:", chat.chat(conv2.messages()).content)` 实测回「抱歉,我这边看不到您的订单信息」。带了记忆那次它回的是「我这边只能看到您提供的 CL-20931,另一笔需您核对账单后告知」:它知道「另一笔」指订单,但记忆里只有用户说过的那一个订单号,并没有第二个。记忆能带回说过的话,带不回没人说过的信息。
- `print(f"\n本脚本共 {chat.ledger},折合 ¥{total_cost():.4f}")` `ledger` 的 `__str__` 打印调用次数和 token。

</div>

```bash
uv run python -m part03.aug_demo
```

```text
== 1. 光秃秃的模型 ==
您好,重复扣费退款一般 1-3 个工作日原路到账。请提供订单号,我帮您核实处理。

== 2. 加检索:先搜帮助中心,把命中的文章贴进提示词 ==
命中文章: ['重复扣费怎么处理', '退款多久到账']
核实重复扣费后我们会提交退款,多扣的钱原路退回,银行一般5到10个工作日到账,具体时间以发卡银行为准。

== 3. 加工具:代码先查订单,把结果贴进提示词 ==
查到 3 笔订单,最近两笔:['CL-20931', 'CL-20932']
您订单CL-20931与CL-20932于9月28日重复扣费,退款审核后原路退回,一般1-3个工作日到账,请耐心等待。

== 4. 加记忆:把上一轮对话带进来 ==
用户:我是陈先生,订单号 CL-20931 被扣了两次。
客服:陈先生您好,订单CL-20931重复扣款已记录,将尽快为您核实退款,请留意通知。
用户:那另一笔订单号是多少来着?
客服:抱歉,我这边只能看到您提供的CL-20931,另一笔订单号需您核对账单后告知。
没带记忆: 抱歉,我这边看不到您的订单信息,请提供订单号或登录账户查询。

本脚本共 6 次调用 | 输入 517 / 输出 172 tokens | 约 ¥0.0024,折合 ¥0.0024
```

这四段里最该记住的是第一段和第三段的「1 到 3 个工作日」。模型没有资料时不会说「我不知道」,它会给一个听起来合理的数字。检索补的是知识,工具补的是事实,记忆补的是上文,各管一块。生产里常见的错误是只补了其中一块,就以为答案可靠了。

## 同一张工单,写两遍

现在来做今天的主实验。任务:处理陈先生那张重复扣费工单,要求是查清是不是真的重复扣费、为多扣的那笔提交退款申请、给客户回一封不承诺到账日期的信。

写法一是 workflow,四步,顺序和分支都写死。写法二是 agent,把三个工具交给模型,让它自己决定。两种写法放在同一个文件 `part03/two_ways.py` 里,工具函数是同一份,只有「谁来决定下一步」不一样。

```python
# agent-zero-lab/part03/two_ways.py  Day 196:同一张工单,写成 workflow 和写成 agent,各跑几遍看路径
import json
import sys
import time
from typing import Any

from part03 import ticket_tools
from part03.ticket_tools import create_refund_request, lookup_orders, search_help
from part03.wf_common import TICKET, client_for, llm, llm_json, total_calls, total_cost


# ---------- 写法一:workflow,每一步做什么、什么顺序,都是代码写死的 ----------
def workflow(ticket: str) -> tuple[str, list[str]]:
    path: list[str] = []
    facts = llm_json(f"从工单里抽取信息,输出 JSON:{{\"customer_id\": 整数, \"order_ids\": [订单号]}}\n\n{ticket}")
    path.append("llm:抽取")
    orders = lookup_orders(int(facts.get("customer_id", 0)))
    path.append("code:查订单")
    wanted = set(facts.get("order_ids", []))
    dup = [o for o in orders if o["order_id"] in wanted]
    if len(dup) == 2 and dup[0]["amount"] == dup[1]["amount"]:
        second = max(dup, key=lambda o: o["paid_at"])  # 退后扣的那笔
        create_refund_request(second["order_id"], "重复扣费")
        path.append(f"code:退款 {second['order_id']}")
    else:
        return "【转人工】订单对不上", path
    reply = llm(f"你是云簿客服。给客户写回复,100 字以内,先道歉,说明已为 {second['order_id']} 提交退款申请,不承诺到账日期。\n工单:{ticket}")
    path.append("llm:写回复")
    return reply, path


# ---------- 写法二:agent,工具给模型,下一步调什么由模型决定 ----------
TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": {"name": "lookup_orders", "description": "按客户编号查他的所有订单(订单号、金额、扣款时间)。",
     "parameters": {"type": "object", "properties": {"customer_id": {"type": "integer"}}, "required": ["customer_id"]}}},
    {"type": "function", "function": {"name": "search_help", "description": "搜索帮助中心文章,了解政策和流程。",
     "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "create_refund_request", "description": "为一个订单提交退款申请。只能为确认多扣的那一笔提交。",
     "parameters": {"type": "object", "properties": {"order_id": {"type": "string"}, "reason": {"type": "string"}}, "required": ["order_id", "reason"]}}},
]
FUNCS = {"lookup_orders": lookup_orders, "search_help": search_help, "create_refund_request": create_refund_request}


def agent(ticket: str, max_steps: int = 8) -> tuple[str, list[str]]:
    path: list[str] = []
    client = client_for()
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": "你是云簿 CloudLedger 的客服。处理客户工单,需要时调用工具,最后给客户写回复,100 字以内,不承诺到账日期。"},
        {"role": "user", "content": ticket},
    ]
    for _ in range(max_steps):
        r = client.chat(messages, tools=TOOLS)
        messages.append(r.message)
        calls = r.message.get("tool_calls") or []
        if not calls:
            return r.content, path
        for call in calls:
            name = call["function"]["name"]
            args = json.loads(call["function"]["arguments"])
            result = FUNCS[name](**args)
            path.append(f"{name}({', '.join(str(v) for v in args.values())[:30]})")
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result, ensure_ascii=False)})
    return "【到达最大步数】", path


def run(label: str, fn: Any, n: int) -> None:
    for i in range(n):
        ticket_tools.REFUND_REQUESTS.clear()
        c0, k0, t0 = total_cost(), total_calls(), time.perf_counter()
        _, path = fn(TICKET)
        print(f"{label} 第 {i + 1} 遍 | 模型调用 {total_calls() - k0} 次 | {time.perf_counter() - t0:.1f} 秒 | ¥{total_cost() - c0:.4f}")
        print("   路径:", " -> ".join(path))
        print("   退款申请:", [r["order_id"] for r in ticket_tools.REFUND_REQUESTS])


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    run("workflow", workflow, n)
    run("agent   ", agent, n)
    print(f"合计 ¥{total_cost():.4f}")
```

<div class="line-notes">

- `from part03 import ticket_tools` 导入模块本身,为了在 `run` 里清空和读取 `ticket_tools.REFUND_REQUESTS` 这个列表。
- `from part03.ticket_tools import create_refund_request, lookup_orders, search_help` 三个工具函数,两种写法共用。
- `from part03.wf_common import TICKET, client_for, llm, llm_json, total_calls, total_cost` 构件和账本。
- `def workflow(ticket: str) -> tuple[str, list[str]]:` 写法一。返回两样:最终回复文本和「走过的路径」列表,路径是为了对比而记的。
- `path: list[str] = []` 每走一步往里记一笔,`llm:` 开头表示模型干的,`code:` 开头表示代码干的。
- `facts = llm_json(f"从工单里抽取信息,输出 JSON:{{\"customer_id\": 整数, \"order_ids\": [订单号]}}\n\n{ticket}")` 第 1 步,模型的活:从自由文字里抽出结构化信息。f-string 里 `{{` `}}` 是字面的花括号。对 `TICKET` 抽出的是 `{"customer_id": 10086, "order_ids": ["CL-20931", "CL-20932"]}`。
- `orders = lookup_orders(int(facts.get("customer_id", 0)))` 第 2 步,代码的活:拿抽出的客户编号去查订单。`int(...)` 防止模型把编号写成字符串。没抽到编号就用 0,查出来是空列表。
- `wanted = set(facts.get("order_ids", []))` 客户说的订单号,变成集合方便判断「在不在里面」。
- `dup = [o for o in orders if o["order_id"] in wanted]` 第 3 步,代码的活:从查到的 3 笔里挑出客户提到的那两笔。去年的 `CL-18077` 客户没提,被排除。
- `if len(dup) == 2 and dup[0]["amount"] == dup[1]["amount"]:` 判断条件写死:恰好两笔、金额一样才算重复扣费。条件成立才继续,不成立走下面的 `else`。
- `second = max(dup, key=lambda o: o["paid_at"])  # 退后扣的那笔` `max` 按扣款时间取最晚的一笔:`CL-20932`(10:02:14,晚于 10:02:11)。时间字符串格式统一,字符串比较大小就等于时间比较。
- `create_refund_request(second["order_id"], "重复扣费")` 写操作由代码直接调用,不经过模型。模型没有机会选错订单。
- `else:` 条件不成立的出口。
- `return "【转人工】订单对不上", path` workflow 的保守做法:对不上就交给人,不自己猜。
- `reply = llm(f"你是云簿客服。给客户写回复,100 字以内,先道歉,说明已为 {second['order_id']} 提交退款申请,不承诺到账日期。\n工单:{ticket}")` 第 4 步,模型的活:写信。订单号由代码填进提示词,模型不会写错。
- `TOOLS: list[dict[str, Any]] = [` 写法二开始。这是 [Day 157](/blog/agent-zero/day-157-tool-schema/) 的工具 schema,三个工具各一段。
- `"description": "为一个订单提交退款申请。只能为确认多扣的那一笔提交。"` 描述里写了约束。agent 版没有 `if` 帮它把关,约束只能靠描述和提示词。
- `FUNCS = {"lookup_orders": lookup_orders, "search_help": search_help, "create_refund_request": create_refund_request}` 工具名到函数的映射,模型回「调 `lookup_orders`」时按名字找到函数。
- `def agent(ticket: str, max_steps: int = 8) -> tuple[str, list[str]]:` 写法二。`max_steps` 是 [Day 192](/blog/agent-zero/day-192-failures-4/) 讲过的步数上限。
- `client = client_for()` 直接用默认客户端的 `chat`,因为这次要传 `tools` 和完整的消息历史。
- `{"role": "system", "content": "你是云簿 CloudLedger 的客服。处理客户工单,需要时调用工具,最后给客户写回复,100 字以内,不承诺到账日期。"},` 整个任务的说明就这一句,没有说先查订单再搜帮助,步骤由模型自己定。
- `for _ in range(max_steps):` 循环最多 8 轮。`_` 表示这个变量用不上。
- `r = client.chat(messages, tools=TOOLS)` 每一轮:把全部历史加上工具清单发给模型。
- `messages.append(r.message)` 模型这一轮的回复(可能带 `tool_calls`)原样追加进历史。
- `calls = r.message.get("tool_calls") or []` 模型要调工具时有 `tool_calls`,没有就是 `None`,`or []` 兜成空列表。
- `if not calls:` 没有要调的工具,说明模型认为可以给最终答案了。
- `return r.content, path` 这是循环唯一的正常出口:由模型说了算什么时候结束。
- `name = call["function"]["name"]` 模型想调的工具名。
- `args = json.loads(call["function"]["arguments"])` 参数是 JSON 字符串,解析成 dict。
- `result = FUNCS[name](**args)` 查表拿函数,`**args` 把 dict 展开成关键字参数。模型要是编了一个不存在的工具名这里会 `KeyError`,今天先不防,这是 Day 189 讲过的第 5 类失败,Day 170 的注册表会接住。
- `path.append(f"{name}({', '.join(str(v) for v in args.values())[:30]})")` 把工具名和参数记进路径,参数过长截 30 个字符。
- `messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result, ensure_ascii=False)})` 工具结果以 `tool` 消息追加,`tool_call_id` 对应上哪一次调用。
- `return "【到达最大步数】", path` 8 轮还没结束的出口。
- `def run(label: str, fn: Any, n: int) -> None:` 把一种写法跑 `n` 遍并打印每遍的账。
- `ticket_tools.REFUND_REQUESTS.clear()` 每遍开始前清空退款申请表,这样看到的是这一遍提交了什么。
- `c0, k0, t0 = total_cost(), total_calls(), time.perf_counter()` 一次赋三个值:记下起点的花费、调用次数、时刻,跑完用现在的值减它。
- `print(f"{label} 第 {i + 1} 遍 | 模型调用 {total_calls() - k0} 次 | {time.perf_counter() - t0:.1f} 秒 | ¥{total_cost() - c0:.4f}")` 一行摘要。
- `print("   退款申请:", [r["order_id"] for r in ticket_tools.REFUND_REQUESTS])` 这一遍有没有人「动了钱」、动的是哪一笔,这比回复文字重要。
- `n = int(sys.argv[1]) if len(sys.argv) > 1 else 5` 命令行第一个参数是遍数,不写就是 5。`sys.argv` 相当于 Node 的 `process.argv`。

</div>

```bash
uv run python -m part03.two_ways 5
```

```text
workflow 第 1 遍 | 模型调用 2 次 | 2.3 秒 | ¥0.0012
   路径: llm:抽取 -> code:查订单 -> code:退款 CL-20932 -> llm:写回复
   退款申请: ['CL-20932']
workflow 第 2 遍 | 模型调用 2 次 | 2.0 秒 | ¥0.0012
   路径: llm:抽取 -> code:查订单 -> code:退款 CL-20932 -> llm:写回复
   退款申请: ['CL-20932']
workflow 第 3 遍 | 模型调用 2 次 | 2.1 秒 | ¥0.0013
   路径: llm:抽取 -> code:查订单 -> code:退款 CL-20932 -> llm:写回复
   退款申请: ['CL-20932']
workflow 第 4 遍 | 模型调用 2 次 | 1.9 秒 | ¥0.0013
   路径: llm:抽取 -> code:查订单 -> code:退款 CL-20932 -> llm:写回复
   退款申请: ['CL-20932']
workflow 第 5 遍 | 模型调用 2 次 | 1.9 秒 | ¥0.0012
   路径: llm:抽取 -> code:查订单 -> code:退款 CL-20932 -> llm:写回复
   退款申请: ['CL-20932']
agent    第 1 遍 | 模型调用 3 次 | 4.1 秒 | ¥0.0050
   路径: lookup_orders(10086) -> search_help(重复扣费 退款流程) -> create_refund_request(CL-20932, 同一订阅续费在 3 秒内重复扣款两次(C)
   退款申请: ['CL-20932']
agent    第 2 遍 | 模型调用 3 次 | 4.0 秒 | ¥0.0042
   路径: lookup_orders(10086) -> search_help(重复扣费 退款流程 政策) -> create_refund_request(CL-20932, 重复扣费:与 CL-20931 为同一笔)
   退款申请: ['CL-20932']
agent    第 3 遍 | 模型调用 3 次 | 4.2 秒 | ¥0.0040
   路径: lookup_orders(10086) -> search_help(重复扣费 多扣 退款流程) -> create_refund_request(CL-20932, 重复扣费:与 CL-20931 同金额同)
   退款申请: ['CL-20932']
agent    第 4 遍 | 模型调用 3 次 | 3.7 秒 | ¥0.0043
   路径: lookup_orders(10086) -> search_help(重复扣费 退款流程) -> create_refund_request(CL-20932, 重复扣费:与 CL-20931 于 20)
   退款申请: ['CL-20932']
agent    第 5 遍 | 模型调用 3 次 | 3.9 秒 | ¥0.0042
   路径: lookup_orders(10086) -> search_help(重复扣费 多扣 退款流程) -> create_refund_request(CL-20932, 同一续费在3秒内重复扣款,客户重复支付专)
   退款申请: ['CL-20932']
合计 ¥0.0278
```

先说结果,有点出乎我意料:**在这张工单上两边都做对了,五遍都为 `CL-20932` 提交了退款**,agent 没有搞砸。差别全在账上和路径上:

- workflow 每遍固定 2 次模型调用,约 2 秒,约 ¥0.0012。路径五遍一字不差。
- agent 每遍 3 次模型调用,约 4 秒,¥0.0040 到 ¥0.0050。路径的骨架一样(查订单、搜帮助、提退款),但搜索关键词每遍都不同:「重复扣费 退款流程」「重复扣费 多扣 退款流程」,退款原因的措辞也各不相同。我另外单独跑了一遍测 token:workflow 两次调用共 275 个输入 token、83 个输出 token;agent 三次调用共 2502 个输入、321 个输出。**输入 token 差了约 9 倍**,因为 agent 每一轮都要把完整历史和三个工具的 schema 重新发一遍,workflow 的每个格子只带自己需要的那点文字。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="柱状对比:workflow 2 次调用 275 输入 token 约 0.0012 元;agent 3 次调用 2502 输入 token 约 0.0042 元">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">同一张工单:两种写法的账(各跑五遍)</text>
  <text x="20" y="70" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">输入 token</text>
  <rect x="120" y="56" width="30" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="158" y="71" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">workflow 275</text>
  <rect x="120" y="84" width="270" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="398" y="99" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">agent 2502</text>
  <text x="20" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每遍花费</text>
  <rect x="120" y="138" width="86" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="214" y="153" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">workflow ¥0.0012</text>
  <rect x="120" y="166" width="300" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="428" y="181" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">agent ¥0.0042</text>
  <text x="320" y="214" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">花费 3 倍多、耗时 2 倍,在这张「标准」工单上换来的只是「路径可以不同」</text>
</svg>
<figcaption>柱子长度只表示相对大小(token 按 275:2502,花费按 0.0012:0.0042)。agent 贵在每一轮都要重发整段历史和工具说明。</figcaption>
</figure>

要注意这是一张「标准」工单:客户把订单号都写全了,正好符合 workflow 的假设。真正拉开差距的是不按套路来的工单。

## 换两张不按套路的工单

第二个实验把两张特殊工单分别丢给两种写法,各跑三遍。`TICKET_NO_ORDER_ID` 是客户忘了订单号,`TICKET_NOT_DUP` 是客户要退一笔正常订单。我提前想好了「合理的结果」:第一张应该查出重复并退款,或者至少追问;第二张**绝对不能**退款,因为这笔钱客户正常付的。

```python
# agent-zero-lab/part03/two_ways_messy.py  Day 196:换两张不按套路来的工单,看 workflow 和 agent 各怎么反应
import time

from part03 import ticket_tools
from part03.ticket_tools import TICKET_NO_ORDER_ID, TICKET_NOT_DUP
from part03.two_ways import agent, workflow
from part03.wf_common import total_calls, total_cost

for name, ticket in [("没有订单号", TICKET_NO_ORDER_ID), ("不是重复扣费", TICKET_NOT_DUP)]:
    for label, fn in [("workflow", workflow), ("agent   ", agent)]:
        for i in range(3):
            ticket_tools.REFUND_REQUESTS.clear()
            c0, k0, t0 = total_cost(), total_calls(), time.perf_counter()
            reply, path = fn(ticket)
            refunds = [r["order_id"] for r in ticket_tools.REFUND_REQUESTS]
            print(f"[{name}] {label} #{i + 1} | {total_calls() - k0} 次调用 | {time.perf_counter() - t0:.1f} 秒 | ¥{total_cost() - c0:.4f} | 提交退款 {refunds}")
            print("    路径:", " -> ".join(path))
            print("    回复:", reply.replace("\n", " ")[:70])
print(f"合计 ¥{total_cost():.4f}")
```

<div class="line-notes">

- `from part03.ticket_tools import TICKET_NO_ORDER_ID, TICKET_NOT_DUP` 两张新工单,放在 `ticket_tools.py` 末尾。
- `from part03.two_ways import agent, workflow` 直接复用上面两种写法,一个字没改。
- `for name, ticket in [("没有订单号", TICKET_NO_ORDER_ID), ("不是重复扣费", TICKET_NOT_DUP)]:` 外层循环两张工单,每一项是 (名字, 内容) 的元组,循环变量一次拆成两个。
- `for label, fn in [("workflow", workflow), ("agent   ", agent)]:` 中层循环两种写法。函数也是值,可以放进列表,相当于 JS 里把函数放进数组。`"agent   "` 后面补了空格是为了打印对齐。
- `for i in range(3):` 内层每种写法跑三遍。
- `reply, path = fn(ticket)` 统一调用,两种写法的返回形状一样,所以能这样写。
- `refunds = [r["order_id"] for r in ticket_tools.REFUND_REQUESTS]` 这一遍里谁被退款了。
- `print("    回复:", reply.replace("\n", " ")[:70])` 回复里可能有换行,换成空格后只看前 70 个字符。

</div>

```bash
uv run python -m part03.two_ways_messy
```

```text
[没有订单号] workflow #1 | 1 次调用 | 1.5 秒 | ¥0.0003 | 提交退款 []
    路径: llm:抽取 -> code:查订单
    回复: 【转人工】订单对不上
[没有订单号] workflow #2 | 1 次调用 | 0.7 秒 | ¥0.0003 | 提交退款 []
    路径: llm:抽取 -> code:查订单
    回复: 【转人工】订单对不上
[没有订单号] workflow #3 | 1 次调用 | 1.2 秒 | ¥0.0003 | 提交退款 []
    路径: llm:抽取 -> code:查订单
    回复: 【转人工】订单对不上
[没有订单号] agent    #1 | 3 次调用 | 3.7 秒 | ¥0.0041 | 提交退款 ['CL-20932']
    路径: lookup_orders(10086) -> search_help(续费重复扣款 退款政策) -> create_refund_request(CL-20932, 与 CL-20931 同一笔续费重复扣款)
    回复: 陈先生,已核实:9 月 28 日 10:02 您有两笔各 1188 元的专业版年付扣款,其中 CL-20932 属重复扣费,已为您提交退款申
[没有订单号] agent    #2 | 3 次调用 | 3.8 秒 | ¥0.0045 | 提交退款 ['CL-20932']
    路径: lookup_orders(10086) -> search_help(重复扣款 重复订单 退款政策) -> create_refund_request(CL-20932, 重复扣费:与订单 CL-20931 为同)
    回复: 陈先生您好:  已核实您9月28日的专业版年付续费被重复扣款两次(CL-20931、CL-20932,各1188元),属重复扣费。多扣的一笔
[没有订单号] agent    #3 | 3 次调用 | 3.4 秒 | ¥0.0041 | 提交退款 ['CL-20932']
    路径: lookup_orders(10086) -> search_help(重复扣款 退款政策 处理流程) -> create_refund_request(CL-20932, 重复扣费:客户于 2026-09-28 )
    回复: 陈先生您好:  已核实您 9 月 28 日续费专业版时,因系统原因在 3 秒内重复扣款两笔 1188 元(订单 CL-20931、CL-20
[不是重复扣费] workflow #1 | 1 次调用 | 0.8 秒 | ¥0.0004 | 提交退款 []
    路径: llm:抽取 -> code:查订单
    回复: 【转人工】订单对不上
[不是重复扣费] workflow #2 | 1 次调用 | 0.9 秒 | ¥0.0004 | 提交退款 []
    路径: llm:抽取 -> code:查订单
    回复: 【转人工】订单对不上
[不是重复扣费] workflow #3 | 1 次调用 | 0.7 秒 | ¥0.0004 | 提交退款 []
    路径: llm:抽取 -> code:查订单
    回复: 【转人工】订单对不上
[不是重复扣费] agent    #1 | 3 次调用 | 3.3 秒 | ¥0.0031 | 提交退款 []
    路径: lookup_orders(10087) -> search_help(退款政策 月付订阅 主动取消) -> search_help(订阅主动取消 自愿退款 政策)
    回复: 李女士,您好:  已核实您 10 月 1 日的基础版月付订单 CL-20940,金额 99 元,仅扣款一次,属于正常订阅付费,不属于重复扣费
[不是重复扣费] agent    #2 | 2 次调用 | 2.8 秒 | ¥0.0027 | 提交退款 []
    路径: lookup_orders(10087) -> search_help(退款政策 订阅 月付 自愿退款)
    回复: 我核实了您的订单情况,需要向您说明:  CL-20940(99 元,2026-10-01 08:15 支付)只有一笔扣款,属于正常订阅扣费,
[不是重复扣费] agent    #3 | 2 次调用 | 2.3 秒 | ¥0.0022 | 提交退款 []
    路径: lookup_orders(10087) -> search_help(退款政策 基础版月付 退款政策)
    回复: 李女士您好,已核实您的订单 CL-20940(99 元,基础版月付,10 月 1 日支付)只有一笔扣款,属正常付费,不符合重复扣费
合计 ¥0.0227
```

结果摆在这儿:

**没有订单号那张**:workflow 三遍都在第二步之后直接「转人工」,因为 `wanted` 是空集合,`dup` 就是空列表,条件不成立。它没做错事,也没做成事,花了 ¥0.0003。agent 三遍都自己去查了 10086 的订单,发现 `CL-20931` 和 `CL-20932` 间隔 3 秒金额相同,提交了退款,三遍结论一致。灵活性实实在在地兑现了。

**不是重复扣费那张**:workflow 还是「转人工」(它看到工单里的 `CL-20940` 只有一笔,凑不够两笔),这是对的。agent 三遍都没有退款,而且回复里解释了「只有一笔扣款,不属于重复扣费」。我事先最担心 agent 手滑退了钱,这次三遍都没有。但你要知道:**这是三遍的结果,不是保证**。workflow 在这里不退款是代码保证的(没有两笔就走不到 `create_refund_request`),agent 不退款是模型这几次的表现,换一个更弱的模型、换一句措辞,结果可能不一样。

还有一处小事值得记。agent 没有订单号那一遍(#3)的回复里写了「因系统原因在 3 秒内重复扣款」。「因系统原因」没有出现在任何一份资料或工具结果里,是模型自己给出的解释。客户工单里确实要求「给一个解释」,但这种「听起来合理的原因」要是错了,就是承认了公司没承认过的事。workflow 写回复那一格,我在提示词里只让它「说明已提交退款申请」,它没机会编原因。

## 怎么选:一张判断表

把今天的实验和文章的建议合在一起,我自己的做法是按下面这个顺序问:

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="三级台阶:单次调用加检索和示例、workflow、agent,往右灵活性升高、成本和不确定性也升高">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">复杂度阶梯:能停在低的一级,就别往上走</text>
  <rect x="30" y="185" width="170" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="115" y="206" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">单次调用</text>
  <text x="115" y="224" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">+ 检索 + 示例</text>
  <rect x="235" y="130" width="170" height="105" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Workflow</text>
  <text x="320" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">步骤能提前写出来</text>
  <text x="320" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每步可测、花费可估</text>
  <text x="320" y="208" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">没想到的情形转人工</text>
  <rect x="440" y="70" width="170" height="165" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="525" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Agent</text>
  <text x="525" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">步骤事先不知道</text>
  <text x="525" y="130" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">会自己想办法</text>
  <text x="525" y="148" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">输入 token 约 9 倍(实测)</text>
  <text x="525" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">需要整套防线(第 28 周)</text>
  <text x="320" y="258" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">往右:灵活性 ↑ 延迟 ↑ 成本 ↑ 可预测性 ↓</text>
</svg>
<figcaption>每往上走一级,都应该有评测分数证明确实好了。没有评测,就留在低一级。</figcaption>
</figure>

1. **一次调用够不够?** 加上检索和几个示例,多数问答、改写、分类、摘要一次就够。能够就别拆。
2. **步骤能不能提前写出来?** 能写出「先 A、再 B、B 的结果如果是 X 就 C」,用 workflow。你得到可测试、可估价、路径固定的系统,遇到没想到的情形它会老老实实转人工,而不是乱来。
3. **步骤事先真的不知道、而且每次差别很大?** 才用 agent。典型是「帮我把这个失败的测试修好」这种,修几步、改哪个文件,没人能提前写下来。这时候你要为它付出更多的钱、更多的时间,以及第 28 周讲的整套防线。

还有一个中间地带:**workflow 里的某一格可以是一个小 agent**,比如客服流程大骨架固定,只有「查不清的订单」那一步放一个有步数上限的 agent。真实系统里这种混合比纯 agent 常见得多,Day 200 的编排者-工作者就是这个形状。

接下来五天的五种 workflow 模式,每一种都是「步骤的某种固定形状」:Day 197 提示链是一串步骤接力,Day 198 路由是先分类再分支,Day 199 并行是多个步骤同时做,Day 200 编排者-工作者是步骤数由模型临时定,Day 201 评估者-优化者是写了评、评了改。

## 动手练习

先说明:练习 1 是判断题,不用写代码。练习 2 到 4 都在 `agent-zero-lab/` 根目录,依赖今天建的文件。

### 练习 1:五个需求,各放哪一级

给每个需求判断:一次调用(加检索/示例)、workflow、agent 三选一,写一句理由。

1. 把用户评论从英文翻译成中文,保留表情符号。
2. 每天凌晨把昨天的工单按「计费 / 技术 / 账号」分类,汇总成一份日报发邮件。
3. 客户问「我上个月那张发票为什么没收到」,要查发票状态、查邮件发送记录、必要时重发。
4. 「帮我看看这个仓库里 `test_billing.py` 为什么挂了,修好它」。
5. 给客户邮件起草回复,要引用帮助中心里的政策原文。

<details><summary>参考答案</summary>

1. **一次调用。** 输入一段文字、输出一段文字,没有任何外部信息要查,没有分支。拆成多步只会更贵。
2. **workflow。** 步骤固定:取昨天的工单、逐张分类、汇总、发邮件。分类这一步可以是「路由」(Day 198),汇总是代码。没有任何一步需要模型决定「下一步做什么」。
3. **看情形,默认先写 workflow。** 如果「查发票状态 → 状态是已发送就查邮件记录 → 没发出就重发」是固定的几个分支,写成 workflow 带 `if`。只有当可能的原因多到写不完、每次排查路径差别很大时,才升级成 agent,并且重发邮件这类写操作要放在代码里把关。
4. **agent。** 读哪个文件、改哪一行、跑几次测试都事先不知道,这是步骤数不确定的开放问题。要配步数上限、预算和沙箱(沙箱见 [Day 187](/blog/agent-zero/day-187-codeact-2/))。
5. **一次调用加检索。** 先用 `search_help` 搜出相关文章,把原文贴进提示词,模型一次写出回复。像 `aug_demo.py` 第二步那样。只有需要多轮搜索、根据结果调整关键词时才考虑 agent。

判断标准只有两条:有没有外部信息要拿(检索/工具),步骤能不能提前写出来。

</details>

### 练习 2:把 agent 的步数上限压到 2

把 `agent(TICKET, max_steps=...)` 的上限分别设成 1、2、3,看每个上限下:退款申请有没有提交、客户有没有收到回复。先猜,再跑。新建 `part03/ex196_max_steps.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex196_max_steps.py  Day 196 练习 2:把 agent 的步数上限压到 2,看会发生什么
from part03 import ticket_tools
from part03.two_ways import agent
from part03.wf_common import TICKET, total_calls, total_cost

for limit in (1, 2, 3):
    ticket_tools.REFUND_REQUESTS.clear()
    k0, c0 = total_calls(), total_cost()
    reply, path = agent(TICKET, max_steps=limit)
    print(f"max_steps={limit} | 模型调用 {total_calls() - k0} 次 | ¥{total_cost() - c0:.4f}")
    print("   路径:", " -> ".join(path) or "(空)")
    print("   退款申请:", [r["order_id"] for r in ticket_tools.REFUND_REQUESTS], "| 回复:", reply[:30])
```

<div class="line-notes">

- `for limit in (1, 2, 3):` 对一个元组循环,三个上限依次试。元组相当于不可变的数组。
- `ticket_tools.REFUND_REQUESTS.clear()` 每个上限开始前清空退款申请表。
- `k0, c0 = total_calls(), total_cost()` 记下起点,跑完相减得到这一遍自己的调用次数和花费。
- `reply, path = agent(TICKET, max_steps=limit)` 把上限传进去。
- `print("   路径:", " -> ".join(path) or "(空)")` `join` 把路径列表连成一行;列表为空时 `join` 得到空字符串,`or "(空)"` 让它显示成「(空)」而不是什么都不打。
- `print("   退款申请:", [r["order_id"] for r in ticket_tools.REFUND_REQUESTS], "| 回复:", reply[:30])` 同时看两件事:钱动了没有、客户拿到的是什么。

</div>

```bash
uv run python -m part03.ex196_max_steps
```

```text
max_steps=1 | 模型调用 1 次 | ¥0.0010
   路径: lookup_orders(10086) -> search_help(重复扣费 退款政策 流程)
   退款申请: [] | 回复: 【到达最大步数】
max_steps=2 | 模型调用 2 次 | ¥0.0028
   路径: lookup_orders(10086) -> search_help(重复扣费 多扣 退款流程) -> create_refund_request(CL-20932, 重复扣费:与 CL-20931 同一续费)
   退款申请: ['CL-20932'] | 回复: 【到达最大步数】
max_steps=3 | 模型调用 3 次 | ¥0.0042
   路径: lookup_orders(10086) -> search_help(重复扣费 退款流程) -> create_refund_request(CL-20932, 重复扣费:与 CL-20931 同一专业)
   退款申请: ['CL-20932'] | 回复: 陈先生您好,抱歉给您带来困扰!

经核实,CL-20931 
```

三种结果:

- 上限 1:模型第一轮并行调了两个工具(查订单、搜帮助),步数用完,什么也没做成,客户拿到一句「到达最大步数」。没出事,但白花了钱。
- 上限 2:**最糟的一种。** 第二轮模型提交了退款,循环随即用完步数,退款申请已经写进去了,而客户收到的回复是「到达最大步数」。钱动了,没人告诉客户。
- 上限 3:正好够用,三轮完整走完。

注意第 1 步里模型是**并行**调了两个工具(见 [Day 162](/blog/agent-zero/day-162-parallel-tools/)):一轮调用算一步,所以 `max_steps=2` 时两轮就完成了三个工具调用。步数上限卡的是模型调用的轮数,不是工具调用的个数。

教训:有副作用的工具,不能只靠步数上限兜底。[Day 192](/blog/agent-zero/day-192-failures-4/) 的做法是撞线后禁用工具、让模型用已有信息给部分答案,并且把「做过什么」写进返回值。这也是 agent 版比 workflow 版多出来的工作:workflow 版里提交退款和写回复的顺序是代码定的,不会出现「钱动了,信没写」。

</details>

### 练习 3:给 workflow 加一条代码路径

没有订单号的那张工单,workflow 转人工了。不换成 agent,只改代码:没有订单号时,用金额相同、时间相近的规则自己在订单里找重复的一对。改完再对三张工单各跑一遍。新建 `part03/ex196_workflow_v2.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex196_workflow_v2.py  Day 196 练习 3:给 workflow 加一条代码路径,让「没写订单号」的工单也能处理
from typing import Any

from part03 import ticket_tools
from part03.ticket_tools import TICKET_NO_ORDER_ID, TICKET_NOT_DUP, create_refund_request, lookup_orders
from part03.wf_common import TICKET, llm, llm_json


def find_duplicate(orders: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """在订单里找「金额相同、扣款时间差不到 60 秒」的一对,找不到返回空列表。"""
    for i, a in enumerate(orders):
        for b in orders[i + 1 :]:
            gap = abs(int(a["paid_at"][-2:]) - int(b["paid_at"][-2:]))  # 只比秒,够演示用
            if a["amount"] == b["amount"] and a["paid_at"][:16] == b["paid_at"][:16] and gap < 60:
                return [a, b]
    return []


def workflow_v2(ticket: str) -> tuple[str, list[str]]:
    path: list[str] = []
    facts = llm_json(f"从工单里抽取信息,输出 JSON:{{\"customer_id\": 整数, \"order_ids\": [订单号,没写就是空列表]}}\n\n{ticket}")
    path.append("llm:抽取")
    orders = lookup_orders(int(facts.get("customer_id", 0)))
    path.append("code:查订单")
    wanted = set(facts.get("order_ids", []))
    dup = [o for o in orders if o["order_id"] in wanted] if wanted else find_duplicate(orders)  # 新增的一条路径
    path.append("code:找重复" if not wanted else "code:按订单号对")
    if len(dup) != 2:
        return "【转人工】没找到重复扣费", path
    second = max(dup, key=lambda o: o["paid_at"])
    create_refund_request(second["order_id"], "重复扣费")
    path.append(f"code:退款 {second['order_id']}")
    reply = llm(f"你是云簿客服。给客户写回复,100 字以内,先道歉,说明已为 {second['order_id']} 提交退款申请,不承诺到账日期。\n工单:{ticket}")
    path.append("llm:写回复")
    return reply, path


if __name__ == "__main__":
    for name, ticket in [("原工单", TICKET), ("没有订单号", TICKET_NO_ORDER_ID), ("不是重复扣费", TICKET_NOT_DUP)]:
        ticket_tools.REFUND_REQUESTS.clear()
        reply, path = workflow_v2(ticket)
        print(f"[{name}] 路径:", " -> ".join(path))
        print("   退款申请:", [r["order_id"] for r in ticket_tools.REFUND_REQUESTS], "| 回复:", reply[:40])
```

<div class="line-notes">

- `def find_duplicate(orders: list[dict[str, Any]]) -> list[dict[str, Any]]:` 新增的规则:在订单里找「金额相同、同一分钟、相差不到 60 秒」的一对。
- `for i, a in enumerate(orders):` `enumerate` 给每个元素配一个下标 `i`。对 10086 的三笔订单,`i` 依次是 0、1、2。
- `for b in orders[i + 1 :]:` 只和排在 `a` 后面的比,这样每一对只比一次,不会自己跟自己比,也不会 (a,b) 比完再 (b,a) 比一遍。
- `gap = abs(int(a["paid_at"][-2:]) - int(b["paid_at"][-2:]))  # 只比秒,够演示用` 取时间字符串最后两位(秒)转成整数相减。`CL-20931` 的秒是 11,`CL-20932` 是 14,差 3。注意这是偷懒写法,只有同一分钟内才可靠,所以下一行先要求前 16 个字符相同。
- `if a["amount"] == b["amount"] and a["paid_at"][:16] == b["paid_at"][:16] and gap < 60:` 三个条件都满足才算:金额相同;`"2026-09-28 10:02"` 前 16 个字符(到分钟)相同;秒差小于 60。去年的 `CL-18077` 日期不同,过不了第二个条件。
- `return [a, b]` 找到就返回这一对。
- `return []` 一对都没找到,返回空列表。
- `{{\"customer_id\": 整数, \"order_ids\": [订单号,没写就是空列表]}}` 抽取提示词多了一句「没写就是空列表」,让模型没看到订单号时老实给 `[]`,而不是编一个。
- `dup = [o for o in orders if o["order_id"] in wanted] if wanted else find_duplicate(orders)  # 新增的一条路径` 条件表达式:客户写了订单号就按订单号对,没写就走新规则。两种来源的 `dup` 后面用同一套处理。
- `path.append("code:找重复" if not wanted else "code:按订单号对")` 路径里记下走了哪一边,方便看。
- `if len(dup) != 2:` 找到的不是恰好一对,就转人工。
- `return "【转人工】没找到重复扣费", path` 出口文字也改成更准确的描述。

</div>

```bash
uv run python -m part03.ex196_workflow_v2
```

```text
[原工单] 路径: llm:抽取 -> code:查订单 -> code:按订单号对 -> code:退款 CL-20932 -> llm:写回复
   退款申请: ['CL-20932'] | 回复: 陈先生您好,非常抱歉给您带来困扰。已为订单 CL-20932 提交退款申请,退款
[没有订单号] 路径: llm:抽取 -> code:查订单 -> code:找重复 -> code:退款 CL-20932 -> llm:写回复
   退款申请: ['CL-20932'] | 回复: 陈先生您好,抱歉让您对扣费产生疑虑。已为您在工单 CL-20932 提交退款申请
[不是重复扣费] 路径: llm:抽取 -> code:查订单 -> code:按订单号对
   退款申请: [] | 回复: 【转人工】没找到重复扣费
```

三张工单的结果:原工单照旧,没有订单号的那张现在也能处理了,不是重复扣费的那张依旧不退款、转人工。对比 agent:agent 靠模型的判断,不用你写 `find_duplicate`;workflow 靠你的代码,每种新情形都要自己加一条路径,但加完以后「会不会误退款」是你能证明的。这就是两种写法的交换条件。

另外一个细节:没有订单号那张的回复里出现了「在工单 CL-20932」这样的措辞,CL-20932 是订单号不是工单号,模型把词用错了。这类问题不会被 `if` 拦住,要靠评测发现,第六部分讲。

</details>

### 练习 4:并发到底快多少

三个独立的小请求,用 `llm` 一个一个发,和用 `allm` 加 `asyncio.gather` 同时发,比耗时。新建 `part03/ex196_concurrency.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex196_concurrency.py  Day 196 练习 4:allm 同时发三个请求,比一个一个发快多少
import asyncio
import time

from part03.wf_common import allm, llm, total_cost

PROMPTS = ["用 10 个字介绍退款流程", "用 10 个字介绍发票流程", "用 10 个字介绍升级套餐"]

t0 = time.perf_counter()
serial = [llm(p) for p in PROMPTS]
t_serial = time.perf_counter() - t0


async def main() -> list[str]:
    return list(await asyncio.gather(*(allm(p) for p in PROMPTS)))


t0 = time.perf_counter()
parallel = asyncio.run(main())
t_parallel = time.perf_counter() - t0
print(f"串行 {t_serial:.2f} 秒,并发 {t_parallel:.2f} 秒,快 {t_serial / t_parallel:.1f} 倍")
print("串行结果:", serial)
print("并发结果:", parallel)
print(f"花费 ¥{total_cost():.4f}")
```

<div class="line-notes">

- `PROMPTS = ["用 10 个字介绍退款流程", "用 10 个字介绍发票流程", "用 10 个字介绍升级套餐"]` 三个互不依赖的小任务,回复很短,耗时主要是网络往返。
- `t0 = time.perf_counter()` 记起点。`perf_counter` 是量耗时用的高精度计时器。
- `serial = [llm(p) for p in PROMPTS]` 串行:列表推导式依次调,前一个返回才发下一个。
- `async def main() -> list[str]:` 要写成协程才能用 `await`。
- `return list(await asyncio.gather(*(allm(p) for p in PROMPTS)))` `allm(p)` 此时只是造出三个协程;`*(...)` 把生成器展开成三个参数传给 `gather`;`gather` 同时启动三个并等全部完成,按传入顺序返回结果。相当于 JS 的 `Promise.all`,见 [Day 68](/blog/agent-zero/day-068-async-3/)。
- `parallel = asyncio.run(main())` 在脚本最顶层用 `asyncio.run` 跑起事件循环,只调一次。
- `print(f"串行 {t_serial:.2f} 秒,并发 {t_parallel:.2f} 秒,快 {t_serial / t_parallel:.1f} 倍")` 两个耗时相除。

</div>

```bash
uv run python -m part03.ex196_concurrency
```

```text
串行 2.24 秒,并发 1.13 秒,快 2.0 倍
串行结果: ['提交申请→审核→原路退回。', '开票→交付→接收→查验→入账。', '流量翻倍,通话无忧,畅享升级。']
并发结果: ['申请退款,审核通过,原路退回。', '开票→交付→报销→入账→归档。', '流量通话双升级,更划算']
花费 ¥0.0006
```

这次快了 2.0 倍,没有到 3 倍。原因有两个:三个请求最慢的那个决定总耗时,而三个请求本身快慢不一;线程切换、连接建立也有开销。前面临时测的那次是 0.67 秒对 1.22 秒的一次调用,趋势一样。还有一点:两次的文字结果不完全相同,同一个问题问两遍,模型的回答本来就不保证一样。并行的真正用法留到 Day 199。

</details>

## 花费

今天真调了模型的脚本:`wf_common` 测试 5 次(¥0.0004)、`aug_demo` 6 次(¥0.0024)、`two_ways` 五遍各两种写法共 25 次(¥0.0278)、`two_ways_messy` 22 次(¥0.0227)、练习 2 共 6 次(¥0.0080)、练习 3 共 5 次(约 ¥0.003)、练习 4 共 6 次(¥0.0006)、测 token 那次两种写法各一遍共 5 次(¥0.0053)。合计约 ¥0.07,价格按 `.env` 里 deepseek-flash 的高峰价算:缓存命中 0.04、未命中 2、输出 8 元每百万 token。我 2026 年 10 月查过 DeepSeek 价格页,空闲时段是这个价的一半。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| workflow(工作流) | 模型和工具按预先写好的代码路径编排,下一步是代码决定的。例:先抽取、再查订单、再写信 |
| agent(智能体) | 模型动态决定自己的流程和工具使用,下一步是模型决定的。例:Day 166 的 25 行循环 |
| agentic systems | 上面两者的合称,Anthropic 文章里用的词 |
| 增强型 LLM(augmented LLM) | 配了检索、工具、记忆的模型,是 workflow 和 agent 共用的基本构件 |
| 检索(retrieval) | 把模型不知道的资料先搜出来再贴给它看。今天用数关键字,第四部分用向量检索 |
| 记忆(memory) | 把之前说过的话带进这一轮。最朴素的做法是重发历史消息 |
| 副作用(side effect) | 工具做了会改变外部世界的事,比如提交退款。有副作用的步骤要小心重复和半途而废 |
| `asyncio.to_thread` | 把一个同步函数放进另一个线程里跑,让它能被 `await`、被 `gather` 并发调用 |
| ledger(账本) | `LLMClient` 里累计每次调用 token 和花费的对象,见 [Day 135](/blog/agent-zero/day-135-llm-client-1/) |
| 门控(gate) | workflow 步骤之间用代码做的检查,不合格就提前结束。Day 197 细讲 |

## 常见误区

**以为 workflow 是低级的、agent 才高级。** 今天那张标准工单,workflow 2 秒 ¥0.0012,agent 4 秒 ¥0.0042,答案一样。两者没有高低,是在拿灵活性换成本和可预测性,看任务需要哪个。

**把「用了工具调用」等同于「是 agent」。** 区别不在有没有工具,在谁决定下一步。workflow 里代码也会调 `lookup_orders`,但调不调、什么时候调是代码决定的。

**只补了一种增强就以为答案可靠。** `aug_demo` 第三步加了订单查询,模型的到账时间还是编的「1 到 3 个工作日」,因为没有同时检索到政策。检索、工具、记忆各补一块,缺哪块就在哪块出错。

**用 agent 处理有副作用的任务却只靠步数上限兜底。** 练习 2 的上限 2 把钱退了、信没写。有副作用的步骤要么放在代码里确定性地执行,要么给 agent 加上收尾和幂等保护。

**以为 agent 一次跑对,下次就一定对。** 不退款那张工单,agent 三遍都没退。但这是三次抽样,不是证明。workflow 里「没有两笔就退不了款」是代码保证的,agent 里只是模型的倾向。

**把 `llm_json` 返回的 dict 当可信数据。** 模型抽出的 `customer_id` 可能写错、`order_ids` 可能编。后面的代码要校验,`wf_common` 只负责把 JSON 字符串变成 dict,不负责它对不对。Day 197 的门控就是干这个的。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):今天的主线,2024 年 12 月发表。先读开头的 workflow 与 agent 定义和「增强型 LLM」,再读「When (and when not) to use agents」。英文,40 分钟。后面五天每天读它的一节。
- [claude-cookbooks · basic_workflows.ipynb](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/basic_workflows.ipynb):Anthropic 官方的提示链、并行、路由参考实现,和文章配套。英文,先扫一遍,Day 197 起对照着看。
- [OpenAI · A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf):OpenAI 的 agent 构建指南(PDF),看「什么时候该构建 agent」那一节,和 Anthropic 的立场对照。英文。
- [Python 文档 · asyncio.to_thread](https://docs.python.org/zh-cn/3.12/library/asyncio-task.html#asyncio.to_thread):中文版,今天 `allm` 用的就是它。
- [DeepSeek API 文档 · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天算花费用的价格页,高峰和空闲时段价格不同。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1FAWGzVEWF&autoplay=0&high_quality=1" title="Anthropic构建高效agent的第一性原理:精读《Building effective agents》①" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · Anthropic构建高效agent的第一性原理:精读《Building effective agents》① · 11 分钟,这个系列逐节精读今天的主线文章,先看这一集,建立「先简单后复杂」的框架。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1xrJZzuEHy&autoplay=0&high_quality=1" title="构建agent的原子能力-增强型LLM:精读《Building effective agents》②" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · 构建agent的原子能力-增强型LLM:精读《Building effective agents》② · 7 分钟,对应今天「那一个构件」一节,讲检索、工具、记忆三种增强。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents: Barry Zhang, Anthropic · 文章作者之一在大会上的演讲,讲什么时候不该做 agent、保持简单、站在 agent 的视角想问题,英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/tx5OapbK-8A" title="How to Build Effective AI Agents (without the hype)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dave Ebbelaar · How to Build Effective AI Agents (without the hype) · 用纯 Python 把文中的模式写一遍,和今天的代码可以互相对照,英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):Agents 一章讲规划、工具和失败模式,和今天「先简单后复杂」的原则一致,英文。
- Antonio Gulli《Agentic Design Patterns: A Hands-On Guide to Building Intelligent Systems》(Springer, 2025):21 种 agent 设计模式一章一种带代码,Prompt Chaining 和 Routing 两章对应接下来两天,英文。

### 开源项目与代码

- [anthropics/claude-cookbooks · patterns/agents](https://github.com/anthropics/claude-cookbooks/tree/main/patterns/agents):官方的五种模式实现所在目录,这个星期会反复用到。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):中文的 agent 入门教程,想要中文版的设计模式讲解可以翻它。

## 自测

1. 一句话说出 workflow 和 agent 的区别。「用了工具调用」算不算 agent?

<details><summary>答案</summary>

区别是下一步由谁决定:代码预先写好路径是 workflow,模型动态决定流程和工具使用是 agent。用了工具调用不一定是 agent:workflow 里代码也会调工具,只要「调不调、什么时候调」是代码决定的就还是 workflow。

</details>

2. 增强型 LLM 的三种增强是什么?`aug_demo.py` 里「加工具」一步为什么答案里到账时间还是错的?

<details><summary>答案</summary>

检索、工具、记忆。第三步只加了「查订单」这个工具,模型拿到了具体订单号和日期,但没有检索帮助中心,到账时间的政策资料不在它手里,它就按常识编了「1 到 3 个工作日」。一种增强只补一块缺口。

</details>

3. 同一张标准工单,两种写法的输入 token 差多少?差距从哪来?

<details><summary>答案</summary>

workflow 两次调用共 275 个输入 token,agent 三次调用共 2502 个,约 9 倍。agent 的每一轮都要把完整历史(含前面所有工具结果)再发一遍,还要带三个工具的 schema;workflow 每一格只带自己要用的那点文字,而且「查订单」「提交退款」是代码做的,不占模型的 token。

</details>

4. `max_steps=2` 时发生了什么?这说明什么?

<details><summary>答案</summary>

第二轮模型提交了退款,循环立刻因为步数用完而退出,客户收到的回复是「到达最大步数」:退款申请已经写入,客户却没得到任何解释。说明有副作用的工具不能只靠步数上限兜底,要有收尾机制(Day 192)或者把写操作放进代码里按固定顺序执行。

</details>

5. 面试题:有人说「我们客服要上 agent」。你会怎么判断该不该上?

<details><summary>答案</summary>

先问三个问题。第一,一次调用加检索和示例能不能解决?能就停。第二,处理流程的步骤能不能提前写出来?如果客服工单大多属于几种固定类型(查订单、退款、改地址),用路由加几条 workflow 更便宜更稳,没想到的情形转人工。第三,只有步骤真的无法预知、而且每次差别大(比如要排查多系统的疑难问题)才上 agent,并且要算账:今天实测同一张标准工单 agent 的 token 是 workflow 的约 9 倍、耗时约 2 倍,还要加上防线和评测的工程成本。我会先用 workflow 覆盖八成的常见情形,把剩下的「疑难」那一格做成一个有步数上限、有收尾、写操作受限的小 agent,用评测集证明这一格上 agent 比转人工更好,再扩大范围。

</details>

## 明天预告

明天是 **Day 197 · 模式一:提示链**。今天看到 workflow 的好处是每一步可测、可控,明天做第一个具体模式:把任务拆成几个固定的步骤,前一步的输出做后一步的输入,步骤之间放一道「门」,用代码检查前一步的结果,不合格就提前结束或转人工。门到底能拦住什么、拆成多步到底比一个大提示词好在哪里,明天用同一张工单实测。
