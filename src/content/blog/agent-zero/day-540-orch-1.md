---
title: 'Day 540 · 编排取舍(一):三篇文章三种立场,四种架构'
description: '「单 Agent 还是多 Agent」是资深面试最常问的架构题。今天把 Cognition、Anthropic、LangChain 2025 年 6 月那三篇文章的论据和数字逐条摆出来,再补上两家 2026 年的新说法;然后把同一张退款工单用单 Agent、工作流、多 Agent、混合四种架构各写一遍,用 DeepSeek 真跑,看清每一步是谁决定的、各花多少钱;最后用一个小实验验证「读好拆、写难拆」。'
pubDate: 2026-10-22
regime: none
tags: ['architecture', 'multi-agent', 'workflow', 'python', 'agent-zero']
series: 'agent-zero'
day: 540
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 539](/blog/agent-zero/day-539-durable-4/) 把同一个退款流程放到 Temporal、Restate、DBOS、LangGraph checkpoint 上各跑了一遍,在退款之后杀掉进程再恢复,四家都只退了一笔,但靠的都是我们自己带的幂等键。结论是:持久化执行解决「一次任务不怕重启」,外部系统去重还是你的事;要不要引入,看任务是否跨越发版窗口、有没有不可逆副作用、要不要等人。

这几周讲的 harness、上下文、记忆、持久化执行,都是一个 Agent **内部**的零件。今天往上走一层,问一个更大的问题:一个任务到底该交给一个 Agent、一段写死的流程、还是好几个 Agent 一起做?这是资深面试里出现得最多的架构题之一,也是评审会上最容易吵起来的题。

## 今天要解决的问题

学完今天你应该能做到:

1. 准确说出 Cognition、Anthropic、LangChain 三篇文章(2025 年 6 月)各自的核心论点和关键数字,以及这三篇放在一起真正在争什么;再说出 Cognition 和 Anthropic 在 2026 年各自更新了什么说法。这是今天第一个新概念:**三种立场**。
2. 分清四种架构:单 Agent、工作流、多 Agent、混合。判断标准只有一个问题:**下一步做什么,是代码决定还是模型决定**。这是今天第二个新概念。
3. 跑通 `part10/arch_four.py`:同一张「重复扣款」工单,四种架构各跑一次,打印每一步是谁决定的、调了几次模型、花了多少钱。
4. 跑通 `part10/read_write.py`:用一个写信任务和一个查重复发票任务,亲眼看到「读类任务拆开没事、写类任务拆开就打架」。

预计用时 2.5 小时。实跑花费 ¥0.2 以内。前置:[Day 196](/blog/agent-zero/day-196-workflow-vs-agent/)(workflow 和 Agent 的定义)到 [Day 200](/blog/agent-zero/day-200-orchestrator/)(编排者-工作者);[Day 329](/blog/agent-zero/day-329-multi-agent-1/) 到 [Day 332](/blog/agent-zero/day-332-multi-agent-4/)(多 Agent 四天);[Day 166](/blog/agent-zero/day-166-agent-min/)(最小 Agent 循环);[Day 135](/blog/agent-zero/day-135-llm-client-1/)(LLMClient)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写三篇文章各一句话的论点和四种架构的判断标准;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 三篇文章,三种立场

[Day 329](/blog/agent-zero/day-329-multi-agent-1/) 已经介绍过「两篇吵架的文章」,那时候的目标是知道有这么回事。进阶篇要做到的是:能准确引用,能说出每个数字的条件,能指出它们没回答的问题。下面的引用我都回原文核对过(2026 年 10 月)。

### Cognition:《Don't Build Multi-Agents》

2025 年 6 月 12 日,Walden Yan 写的。Cognition 是做 Devin(一个写代码的 Agent)的公司。文章提了两条原则:

一是「共享上下文,而且要共享完整的 Agent 轨迹,而不只是几条消息」(Share context, and share full agent traces, not just individual messages)。二是「每个动作都带着隐含的决定,相互冲突的决定会带来坏结果」(Actions carry implicit decisions, and conflicting decisions carry bad results)。

例子是做一个 Flappy Bird(一个点屏幕让小鸟穿过水管的小游戏)。任务拆成两半交给两个子 Agent:一个做带绿色水管的背景,一个做上下飞的小鸟。结果第一个做出了超级马里奥风格的背景,第二个做出的鸟既不像 Flappy Bird 的素材,动起来也不像。最后负责拼装的 Agent 拿到的是两块对不上的东西。

他的结论是:最简单的遵守这两条原则的做法,就是用**单线程的线性 Agent**。任务太长、上下文装不下时,加一个专门的模型把历史动作和对话压缩成关键细节、事件和决定。他也承认这个压缩很难做好,Cognition 有时会专门微调一个小模型来做。

### Anthropic:《How we built our multi-agent research system》

第二天,2025 年 6 月 13 日。讲的是 Claude 的 Research 功能怎么搭的:一个主 Agent(Claude Opus 4)做规划,并行派出几个子 Agent(Claude Sonnet 4)去搜,最后由主 Agent 汇总。

最常被引用的数字是:在他们内部的研究类评测上,这个多 Agent 系统比单 Agent 的 Claude Opus 4 **高 90.2%**。但同一篇文章里还有几个数字经常被省略:

- 普通 Agent 的 token 用量大约是聊天的 4 倍,多 Agent 系统大约是 15 倍。
- 在 BrowseComp(一个考 Agent 上网找难找信息的评测)上,三个因素解释了 95% 的表现差异,其中 **token 用量一项就解释了 80%**,另外两个是工具调用次数和模型选择。
- 他们明确写了:需要所有 Agent 共享同一份上下文、或者 Agent 之间依赖很多的领域,目前不适合多 Agent;大多数编程任务里真正能并行的部分比研究任务少。

文章里还有一段很实用的教训:主 Agent 给子 Agent 的任务描述写得太简单时,子 Agent 会重复劳动。他们举的例子是,一个子 Agent 去查 2021 年的汽车芯片危机,另外两个子 Agent 重复查了 2025 年的供应链。所以每个子 Agent 需要四样东西:目标、输出格式、该用哪些工具和来源的指引、清楚的任务边界。

### LangChain:《How and when to build multi-agent systems》

2025 年 6 月 16 日,Harrison Chase 读完前两篇后写的。他认为两篇标题相反,内容其实有很多共识,归纳了几条。最重要的一条是:**以「读」为主的系统比以「写」为主的容易做**,原文是「读动作天然比写动作更容易并行」(read actions are inherently more parallelizable than write actions)。冲突的读,后果通常不严重,汇总时取舍就行;冲突的写,结果就是坏的。他还指出,Anthropic 的研究系统正是这么做的:多个 Agent 去读,最后只由一个主 Agent 写报告。

另外几条:给子 Agent 足够的上下文很难,这是让 Agent 系统可靠的核心工作(他称之为上下文工程,词是从 Cognition 那篇借的);生产上的 Agent 都需要持久化执行、可观测和评测(这正是 Day 539 和第六部分讲的);多 Agent 适合「价值高、能大量并行」的任务,没有一种架构适合所有问题。

### 放在一起,到底在争什么

三篇连着读,我的理解是:它们争的不是「多 Agent 好不好」,而是**子任务之间的依赖有多少**。

- 依赖少、以读为主、能并行(查五家公司的财报、搜十个来源),多 Agent 赚:每个子 Agent 各读各的,上下文互不污染,还能并行省时间。
- 依赖多、以写为主、要求前后一致(改一个跨十个文件的 bug、写一封信),多 Agent 赔:每个子 Agent 都会做隐含的决定,决定一冲突,拼起来就是坏的。

还有一个很多人没注意的点。Anthropic 那 90.2% 的提升,有相当一部分来自花了更多的 token,文章自己说 token 用量解释了 80% 的差异。如果给单 Agent 同样多的 token(更多步数、更长上下文),差距还剩多少?文章没有回答。这个问题只能在你自己的任务上做实验,就是明天要做的事。

### 2026 年的两个更新

一年多过去,两家都写了新的文章,立场都往中间挪了一点。

Cognition 2026 年 4 月 22 日发了《Multi-Agents: What's Actually Working》,还是 Walden Yan 写的。他说一年前会劝人别做多 Agent,今天很多花哨的想法仍然不实用,但找到了几种真正管用的形状。核心一句是:多 Agent 系统今天在「**写操作保持单线程,其他 Agent 只贡献智力、不做动作**」时效果最好。管用的三种:一个写代码、一个审代码,互相迭代(审查 Agent 不带写代码 Agent 的上下文时效果最好,他们说 Devin Review 平均每个 PR 抓出 2 个 bug,约 58% 是严重的);小模型遇到难题去问大模型;主管拆活、子 Agent 干活、主管汇总。没被采用的是多个 Agent 同时写、以及 Agent 之间自由协商的「蜂群」。

Anthropic 2026 年 1 月 23 日在 Claude 博客发了《Building multi-agent systems: When and how to use them》。它说多 Agent 稳定胜过单 Agent 的只有三种情况:上下文污染拖累了表现(上下文保护);任务能并行;专门化能让工具选择更准、任务更聚焦。这三种之外,协调成本通常超过收益。成本上,它给的数字是**同样的任务,多 Agent 比单 Agent 多用 3 到 10 倍 token**。还有一个很好用的拆法建议:按**上下文**拆,不要按**问题类型**拆。一个写功能、一个写测试、一个做审查,这种按工种拆的,每次交接都会丢上下文;应该让已经掌握相关信息的那个 Agent 继续做相关的事,「只有当上下文真的能隔离时才拆」。今天最后一个实验会实打实地验证这一点。

两家现在的共识可以用一句话记:**写的事一个人干,读和想的事可以多人分。**

## 四种架构,只问一个问题

候选项还是 [Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) 那几种,今天把它们放在一个判断标准下:**下一步做什么,是代码决定的,还是模型决定的?**

**工作流**:路径写死在代码里。每个节点可以调模型(分类、写回复),但走哪条分支、先做什么后做什么,由 `if` 决定。[Day 197](/blog/agent-zero/day-197-chaining/) 到 [Day 201](/blog/agent-zero/day-201-evaluator/) 的五种模式都属于这一类。

**单 Agent**:一个循环,所有工具都给它,它自己决定调哪个、调几次、什么时候停。[Day 166](/blog/agent-zero/day-166-agent-min/) 那种。

**多 Agent**:好几个各有自己上下文的循环。最常见的是主管派活(orchestrator-worker,[Day 330](/blog/agent-zero/day-330-multi-agent-2/))和专员交接(handoff,[Day 331](/blog/agent-zero/day-331-multi-agent-3/))。

**混合**:外层是工作流,某些节点里面是一个 Agent。SupportPilot 就是这种:分类、检索、审批这些步骤写死,「处理工单」那个节点里面是一个能自己调工具的 Agent。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="四种架构里谁决定下一步:工作流全由代码决定,单 Agent 全由模型决定,多 Agent 由主管模型和专员模型决定,混合是外层代码、内层模型">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <text x="85" y="26" fill="var(--ink)">工作流</text>
    <rect x="25" y="44" width="120" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="85" y="64" fill="var(--ink)">代码:分类后分支</text>
    <rect x="25" y="94" width="120" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="85" y="114" fill="var(--ink)">代码:查发票</text>
    <rect x="25" y="144" width="120" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="85" y="164" fill="var(--ink)">代码:退款</text>
    <rect x="25" y="194" width="120" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="85" y="214" fill="var(--ink)">模型:写回复</text>
    <text x="245" y="26" fill="var(--ink)">单 Agent</text>
    <rect x="185" y="44" width="120" height="180" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="245" y="110" fill="var(--ink)">模型自己决定</text>
    <text x="245" y="130" fill="var(--ink-soft)" font-size="11">调哪个工具</text>
    <text x="245" y="148" fill="var(--ink-soft)" font-size="11">调几次、何时停</text>
    <text x="405" y="26" fill="var(--ink)">多 Agent</text>
    <rect x="345" y="44" width="120" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="405" y="68" fill="var(--ink)">主管模型派活</text>
    <rect x="345" y="110" width="55" height="114" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="372" y="160" fill="var(--ink)" font-size="11">账务</text><text x="372" y="176" fill="var(--ink)" font-size="11">专员</text>
    <rect x="410" y="110" width="55" height="114" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="437" y="160" fill="var(--ink)" font-size="11">知识库</text><text x="437" y="176" fill="var(--ink)" font-size="11">专员</text>
    <line x1="385" y1="84" x2="372" y2="110" stroke="var(--ink-faint)"/><line x1="425" y1="84" x2="437" y2="110" stroke="var(--ink-faint)"/>
    <text x="565" y="26" fill="var(--ink)">混合</text>
    <rect x="505" y="44" width="120" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="565" y="64" fill="var(--ink)">代码:定流程</text>
    <rect x="505" y="94" width="120" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="565" y="116" fill="var(--ink)">模型:找要退</text><text x="565" y="134" fill="var(--ink)">的那张发票</text>
    <rect x="505" y="164" width="120" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="565" y="184" fill="var(--ink)">代码:审批+退款</text>
    <rect x="505" y="214" width="120" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="565" y="234" fill="var(--ink)">代码:拼回复</text>
    <text x="320" y="282" fill="var(--ink-faint)" font-size="11">琥珀 = 代码决定,蓝 = 模型决定。越往右看,「必须发生的步骤」越多由代码兜住</text>
  </g>
</svg>
<figcaption>同一张退款工单在四种架构里的样子,和下面 <code>arch_four.py</code> 一一对应。看颜色就知道每一步是谁说了算。</figcaption>
</figure>

生产上,纯粹的单 Agent 和纯粹的多 Agent 都不多,成熟的系统大多是混合的。原因很实际:业务方会要求某些步骤**一定**发生,比如退款必须审批、回复必须带单号,这些用代码保证比用提示词保证可靠得多,出了事审计时也能指着代码说「这一步永远会执行」。中间那些需要随机应变的部分,交给 Agent。

## 准备:共用的假工具和 Agent 循环

四种架构要公平比较,得用同一套工具和同一份数据。先写一个共用文件。数据是 CloudLedger 的几张假发票:C007 在 9 月 3 日有两张 468 元的发票,这是重复扣款。

这个文件用到 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 封装的 `LLMClient`,它在 `common/llm.py` 里,会读 `.env` 里的 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_PRICE`、`LLM_EXTRA_BODY`,并在 `llm.ledger` 里累计调用次数和花费。因为要 import `common`,今天的脚本都在 `agent-zero-lab` 根目录用 `uv run python -m part10.xxx` 运行(和 Day 217 的 embed 脚本一样)。

新建 `part10/orch_tools.py`:

```python
# agent-zero-lab/part10/orch_tools.py
"""四种架构共用的假数据、假工具和一个通用的 Agent 循环。"""
import json
from typing import Any, Callable

from common.llm import LLMClient

INVOICES = {
    "C007": [{"id": "INV-2290", "date": "2026-09-03", "amount": 468},
             {"id": "INV-2291", "date": "2026-09-03", "amount": 468},
             {"id": "INV-2188", "date": "2026-08-03", "amount": 468}],
    "C012": [{"id": "INV-2301", "date": "2026-09-05", "amount": 199}],
}
KB = {"发票抬头": "改发票抬头:设置 → 账单信息 → 发票抬头,保存后下一张发票生效,已开出的发票不能改。"}
REFUNDS: list[dict] = []  # 假的支付系统:每次退款追加一条


def list_invoices(customer_id: str) -> list[dict]:
    return INVOICES.get(customer_id, [])


def create_refund(invoice_id: str, amount: int) -> dict:
    REFUNDS.append({"invoice_id": invoice_id, "amount": amount})
    return {"refund_id": f"RF-{len(REFUNDS)}", "invoice_id": invoice_id, "amount": amount}


def search_kb(query: str) -> str:
    return next((v for k, v in KB.items() if k in query), "没有找到相关文章")


def schema(name: str, desc: str, **props: str) -> dict:
    types = {"amount": "integer"}
    return {"type": "function", "function": {"name": name, "description": desc, "parameters": {
        "type": "object", "properties": {p: {"type": types.get(p, "string"), "description": d} for p, d in props.items()},
        "required": list(props)}}}


TOOLS: dict[str, tuple[Callable[..., Any], dict]] = {
    "list_invoices": (list_invoices, schema("list_invoices", "查客户的发票", customer_id="客户 id,如 C007")),
    "create_refund": (create_refund, schema("create_refund", "对一张发票退款", invoice_id="发票号", amount="金额(元)")),
    "search_kb": (search_kb, schema("search_kb", "搜帮助中心文章", query="关键词")),
}


def agent_loop(llm: LLMClient, system: str, user: str, tools: dict, max_steps: int = 6,
               who: str = "agent") -> str:
    messages: list[dict] = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    for _ in range(max_steps):
        r = llm.chat(messages, tools=[spec for _, spec in tools.values()], temperature=0)
        calls = r.message.get("tool_calls") or []
        if not calls:
            return r.content
        messages.append(r.message)
        for c in calls:
            name, args = c["function"]["name"], json.loads(c["function"]["arguments"])
            out = tools[name][0](**args)
            print(f"  [{who} 模型决定] {name}({args}) -> {str(out)[:60]}")
            messages.append({"role": "tool", "tool_call_id": c["id"], "content": json.dumps(out, ensure_ascii=False)})
    return "步数用完,转人工"
```

<div class="line-notes">

- `from common.llm import LLMClient` Day 135 的封装。`chat()` 返回 `ChatResult`,今天用到它的 `content`(回复文字)和 `message`(可以原样追加进历史的 assistant 消息,里面带着 `tool_calls`)。
- `INVOICES = {` 一个 dict,键是客户 id,值是这个客户的发票列表。C007 有三张:9 月 3 日两张 468 元(重复),8 月 3 日一张(正常的上月账单)。
- `REFUNDS: list[dict] = []  # 假的支付系统:每次退款追加一条` 模块级的列表,跑完数一下长度,就知道这种架构退了几笔。
- `return {"refund_id": f"RF-{len(REFUNDS)}", "invoice_id": invoice_id, "amount": amount}` 第一笔是 RF-1,第二笔 RF-2。
- `return next((v for k, v in KB.items() if k in query), "没有找到相关文章")` `next(生成器, 默认值)` 取第一个符合条件的元素,一个都没有就返回默认值。相当于 JS 的 `Object.entries(KB).find(([k]) => query.includes(k))?.[1] ?? "没有找到相关文章"`。知识库只有一篇文章,查别的都是「没有找到」,这一点在多 Agent 那次实跑里会变得很重要。
- `def schema(name: str, desc: str, **props: str) -> dict:` 生成 OpenAI 格式的工具描述([Day 158](/blog/agent-zero/day-158-fc-first-run/))。`**props` 收集所有关键字参数,比如 `customer_id="客户 id"` 会变成 `{"customer_id": "客户 id"}`。
- `types = {"amount": "integer"}` 只有金额是整数,其他参数都当字符串。
- `TOOLS: dict[str, tuple[Callable[..., Any], dict]] = {` 工具注册表:名字 → (真正执行的函数, 给模型看的描述)。[Day 168](/blog/agent-zero/day-168-tool-registry-1/) 用装饰器做过更完整的版本,这里手写一个 dict 就够了。
- `def agent_loop(llm: LLMClient, system: str, user: str, tools: dict, max_steps: int = 6,` [Day 166](/blog/agent-zero/day-166-agent-min/) 的最小 Agent 循环,多了一个 `tools` 参数,这样不同的 Agent 可以拿到不同的工具子集。
- `who: str = "agent") -> str:` 打印时用来区分是哪个 Agent 在做决定。
- `r = llm.chat(messages, tools=[spec for _, spec in tools.values()], temperature=0)` 把工具描述列表交给模型。`for _, spec in` 里的 `_` 表示「这个位置的值我不用」。
- `calls = r.message.get("tool_calls") or []` 模型没调工具时 `message` 里没有这个键,`or []` 换成空列表。
- `if not calls:` 不调工具了,说明模型给出了最终回复,循环结束。
- `messages.append(r.message)` 带着 `tool_calls` 的 assistant 消息必须先进历史,后面的 tool 消息才对得上([Day 159](/blog/agent-zero/day-159-tool-roundtrip/))。
- `out = tools[name][0](**args)` 按名字找到函数,把模型给的参数 dict 拆成关键字参数调用。
- `print(f"  [{who} 模型决定] {name}({args}) -> {str(out)[:60]}")` 每次工具调用都打印一行,并标明「模型决定」。结果只打前 60 个字,不然多 Agent 那次会刷屏。
- `return "步数用完,转人工"` 步数上限是兜底,防止模型一直调工具停不下来。

</div>

## 同一张工单,四种架构

新建 `part10/arch_four.py`。四个函数签名一样:输入 `llm` 和工单文字,返回给客户的回复。

```python
# agent-zero-lab/part10/arch_four.py
"""同一张工单,四种架构各跑一遍,看每一步是谁决定的。"""
import json
import sys

from common.llm import LLMClient
from part10.orch_tools import REFUNDS, TOOLS, agent_loop, create_refund, list_invoices, search_kb

RULES = "你是 CloudLedger 客服。同一天、同金额的两张发票算重复扣款,退掉后一张。回复客户只用一两句话,带上退款单号。"


def single(llm: LLMClient, ticket: str) -> str:
    return agent_loop(llm, RULES, ticket, TOOLS, who="单 Agent")


def workflow(llm: LLMClient, ticket: str) -> str:
    r = llm.chat([{"role": "system", "content": '把工单分成 refund 或 howto,只输出 JSON:{"type": "...", "customer_id": "..."}'},
                  {"role": "user", "content": ticket}], response_format={"type": "json_object"}, temperature=0)
    kind = json.loads(r.content)
    print(f"  [模型] 分类 -> {kind}")
    if kind["type"] == "howto":
        print("  [代码] 走 howto 分支:查知识库")
        facts = search_kb(ticket)
    else:
        print("  [代码] 走 refund 分支:查发票、找重复、退款")
        invs = list_invoices(kind["customer_id"])
        seen, dup = set(), None
        for inv in invs:
            if (inv["date"], inv["amount"]) in seen:
                dup = inv
            seen.add((inv["date"], inv["amount"]))
        facts = json.dumps(create_refund(dup["id"], dup["amount"]) if dup else "没有重复扣款", ensure_ascii=False)
    reply = llm.chat([{"role": "system", "content": RULES}, {"role": "user", "content": f"工单:{ticket}\n处理结果:{facts}\n写回复。"}],
                     temperature=0)
    return reply.content


def multi(llm: LLMClient, ticket: str) -> str:
    billing = {k: TOOLS[k] for k in ("list_invoices", "create_refund")}
    kb = {"search_kb": TOOLS["search_kb"]}
    specialists = {
        "ask_billing": lambda task: agent_loop(llm, RULES + "你是账务专员,只管发票和退款。", task, billing, who="账务专员"),
        "ask_kb": lambda task: agent_loop(llm, "你是知识库专员,只查帮助中心。", task, kb, who="知识库专员"),
    }
    sub_tools = {name: (fn, {"type": "function", "function": {"name": name, "description": desc, "parameters": {
        "type": "object", "properties": {"task": {"type": "string", "description": "交给专员的任务描述"}},
        "required": ["task"]}}})
        for (name, fn), desc in zip(specialists.items(), ["交给账务专员:查发票、退款", "交给知识库专员:查操作说明"])}
    return agent_loop(llm, RULES + "你是主管,自己不查任何东西,把活派给专员,最后汇总回复客户。", ticket, sub_tools, who="主管")


def hybrid(llm: LLMClient, ticket: str) -> str:
    print("  [代码] 外层工作流:先由代码确定这是退款类工单的处理流程")
    billing = {"list_invoices": TOOLS["list_invoices"]}
    found = agent_loop(llm, RULES + '只负责找出要退的那张发票,最后只输出 JSON:{"invoice_id": "...", "amount": 0},没有就输出 {}。',
                       ticket, billing, who="内层 Agent")
    target = json.loads(found[found.find("{"):found.rfind("}") + 1] or "{}")
    if not target:
        return "没有发现重复扣款,已转人工复核。"
    print(f"  [代码] 审批节点:金额 {target['amount']} 元 <= 500,自动通过")
    r = create_refund(target["invoice_id"], target["amount"])
    print(f"  [代码] 执行退款 -> {r}")
    return f"多扣的 {r['amount']} 元已退回,退款单号 {r['refund_id']}。"


if __name__ == "__main__":
    llm = LLMClient()
    ticket = "我是 C007,9 月 3 号被扣了两次 468 元,麻烦处理一下。"
    for name in sys.argv[1:] or ["workflow", "single", "multi", "hybrid"]:
        before, n0 = llm.ledger.cost, llm.ledger.calls
        print(f"== {name}")
        answer = globals()[name](llm, ticket)
        print(f"  回复:{answer}")
        print(f"  模型调用 {llm.ledger.calls - n0} 次,约 ¥{llm.ledger.cost - before:.4f},累计退款 {len(REFUNDS)} 笔")
        REFUNDS.clear()
```

<div class="line-notes">

- `from part10.orch_tools import REFUNDS, TOOLS, agent_loop, create_refund, list_invoices, search_kb` 用 `-m` 运行时,`agent-zero-lab` 根目录在导入路径上,所以写 `part10.orch_tools`。
- `RULES = "你是 CloudLedger 客服。同一天、同金额的两张发票算重复扣款,退掉后一张。回复客户只用一两句话,带上退款单号。"` 四种架构共用的业务规则。控制变量:只改编排方式,业务规则不变。
- `def single(llm: LLMClient, ticket: str) -> str:` 单 Agent:把所有工具交给一个循环,一行就写完了。
- `def workflow(llm: LLMClient, ticket: str) -> str:` 工作流:模型只做两件事,开头分类、最后写回复;中间的路全由代码走。
- `response_format={"type": "json_object"}, temperature=0)` JSON mode([Day 148](/blog/agent-zero/day-148-structured-2/)),保证输出能被 `json.loads` 解析。
- `if kind["type"] == "howto":` **分支由代码决定**。模型只给出了分类标签,走哪条路是这个 `if` 说了算。
- `for inv in invs:` 找重复发票用的是确定性代码:见过同日期同金额的,后来的那张就是重复。退款规则写在代码里,不靠模型理解提示词。
- `facts = json.dumps(create_refund(dup["id"], dup["amount"]) if dup else "没有重复扣款", ensure_ascii=False)` 有重复就退款,没有就记一句。结果交给最后写回复的那次调用。
- `def multi(llm: LLMClient, ticket: str) -> str:` 多 Agent,主管派活的形状。
- `billing = {k: TOOLS[k] for k in ("list_invoices", "create_refund")}` 账务专员只拿到两个账务工具,看不到知识库。这是「专门化」:每个专员的工具少,选错的机会也少。
- `"ask_billing": lambda task: agent_loop(llm, RULES + "你是账务专员,只管发票和退款。", task, billing, who="账务专员"),` 每个专员本身就是一个 Agent 循环,有自己的系统提示词和自己的上下文。主管看不到专员内部调了什么工具,只看得到最后交回来的那段话。
- `sub_tools = {name: (fn, {"type": "function", "function": {"name": name, "description": desc, "parameters": {` 对主管来说,「派活给专员」本身就是一个工具,参数只有一个 `task`(任务描述)。这就是「agent as tool」的写法。
- `for (name, fn), desc in zip(specialists.items(), ["交给账务专员:查发票、退款", "交给知识库专员:查操作说明"])}` `zip` 把两个序列一一配对,相当于同时遍历专员和它的说明。
- `return agent_loop(llm, RULES + "你是主管,自己不查任何东西,把活派给专员,最后汇总回复客户。", ticket, sub_tools, who="主管")` 主管也是一个 Agent 循环,只不过它的工具是两个专员。
- `def hybrid(llm: LLMClient, ticket: str) -> str:` 混合:外层流程写死,只在「找出要退哪张发票」这一步交给一个 Agent。
- `billing = {"list_invoices": TOOLS["list_invoices"]}` 内层 Agent 只能查,**不能退款**。动钱的那一步不交给模型。
- `target = json.loads(found[found.find("{"):found.rfind("}") + 1] or "{}")` 模型有时会在 JSON 前后加几句话,这里截出第一个 `{` 到最后一个 `}` 之间的部分再解析。截出来是空字符串时用 `"{}"`。
- `print(f"  [代码] 审批节点:金额 {target['amount']} 元 <= 500,自动通过")` 演示用的审批节点:真实系统里这里是 [Day 319](/blog/agent-zero/day-319-lg-interrupt/) 的 interrupt,或者 Day 539 练习 1 的 signal。今天为了一次跑完,简化成金额判断。
- `return f"多扣的 {r['amount']} 元已退回,退款单号 {r['refund_id']}。"` 回复用模板拼,单号一定在里面。这是混合架构的特点:「回复必须带单号」由代码保证。
- `before, n0 = llm.ledger.cost, llm.ledger.calls` 跑之前记一下累计值,跑完相减,就是这一种架构的调用次数和花费。
- `answer = globals()[name](llm, ticket)` `globals()` 返回当前模块所有全局名字的 dict,用字符串取出同名函数。命令行写 `single` 就调 `single` 函数。
- `REFUNDS.clear()` 每种架构跑完清空假支付系统,下一种从 RF-1 开始。

</div>

```bash
cd agent-zero-lab
uv run python -m part10.arch_four
```

实跑输出(2026 年 10 月 22 日,`deepseek-flash`,关思考):

```text
== workflow
  [模型] 分类 -> {'type': 'refund', 'customer_id': 'C007'}
  [代码] 走 refund 分支:查发票、找重复、退款
  回复:C007 您好，9 月 3 日同金额的两张发票属重复扣款，已为您退掉后一张，退款单号 RF-1，金额 468 元。
  模型调用 2 次,约 ¥0.0008,累计退款 1 笔
== single
  [单 Agent 模型决定] list_invoices({'customer_id': 'C007'}) -> [{'id': 'INV-2290', 'date': '2026-09-03', 'amount': 468}, {'
  [单 Agent 模型决定] create_refund({'invoice_id': 'INV-2291', 'amount': 468}) -> {'refund_id': 'RF-1', 'invoice_id': 'INV-2291', 'amount': 46
  回复:已确认 9 月 3 日的两笔 468 元为重复扣款，后一笔已退款，退款单号 RF-1，请留意到账。
  模型调用 3 次,约 ¥0.0025,累计退款 1 笔
== multi
  [账务专员 模型决定] list_invoices({'customer_id': 'C007'}) -> [{'id': 'INV-2290', 'date': '2026-09-03', 'amount': 468}, {'
  [账务专员 模型决定] create_refund({'invoice_id': 'INV-2291', 'amount': 468}) -> {'refund_id': 'RF-1', 'invoice_id': 'INV-2291', 'amount': 46
  [主管 模型决定] ask_billing({'task': '客户 C007 反馈 9 月 3 日被扣款两次，每次 468 元。请核查该客户 9 月 3 日的发票/扣款记录，确认是否为同一天、同金额的两张发票（重复扣款）。若确认重复，请退掉后一张，并给出退款单号。'}) -> 已核实：9 月 3 日确实有两张同金额 468 元的发票（INV-2290、INV-2291），属重复扣款，已退掉后一张
  [知识库专员 模型决定] search_kb({'query': '重复扣款 退款处理规则'}) -> 没有找到相关文章
  [知识库专员 模型决定] search_kb({'query': '退款单号 生成方式'}) -> 没有找到相关文章
  [知识库专员 模型决定] search_kb({'query': '重复扣款'}) -> 没有找到相关文章
  [知识库专员 模型决定] search_kb({'query': '退款'}) -> 没有找到相关文章
  [知识库专员 模型决定] search_kb({'query': '发票 重复 退款'}) -> 没有找到相关文章
  [知识库专员 模型决定] search_kb({'query': '退款单号'}) -> 没有找到相关文章
  [知识库专员 模型决定] search_kb({'query': '扣款'}) -> 没有找到相关文章
  [知识库专员 模型决定] search_kb({'query': '发票'}) -> 没有找到相关文章
  [知识库专员 模型决定] search_kb({'query': '退款流程 操作说明'}) -> 没有找到相关文章
  [知识库专员 模型决定] search_kb({'query': '帮助中心 退款政策'}) -> 没有找到相关文章
  [主管 模型决定] ask_kb({'task': '请确认重复扣款（同一天、同金额两张发票）的退款处理规则与操作说明，以及退款单号的生成方式。'}) -> 我无法确认这些信息。我尝试了多组关键词（“重复扣款”“退款处理规则”“退款单号 生成方式”“发票 重复 退款”“退款流程
  回复:C007 您好，已核实 9 月 3 日两张 468 元发票（INV-2290、INV-2291）属重复扣款，后一张已为您退款，退款单号 RF-1，金额 468 元，请留意到账。
  模型调用 9 次,约 ¥0.0118,累计退款 1 笔
== hybrid
  [代码] 外层工作流:先由代码确定这是退款类工单的处理流程
  [内层 Agent 模型决定] list_invoices({'customer_id': 'C007'}) -> [{'id': 'INV-2290', 'date': '2026-09-03', 'amount': 468}, {'
  [代码] 审批节点:金额 468 元 <= 500,自动通过
  [代码] 执行退款 -> {'refund_id': 'RF-1', 'invoice_id': 'INV-2291', 'amount': 468}
  回复:多扣的 468 元已退回,退款单号 RF-1。
  模型调用 2 次,约 ¥0.0014,累计退款 1 笔
```

先说明一下打印顺序:多 Agent 那段里,专员内部的工具调用先打出来,主管那一行后打,因为主管的 `ask_billing` 要等专员整个跑完才有返回值可打印。

四种都答对了,都只退了一笔。差别在过程和价钱上:

| 架构 | 模型调用 | 花费(元) | 谁决定了退哪张 | 谁保证带单号 |
| --- | --- | --- | --- | --- |
| 工作流 | 2 | 0.0008 | 代码 | 提示词 |
| 单 Agent | 3 | 0.0025 | 模型 | 提示词 |
| 多 Agent | 9 | 0.0118 | 账务专员(模型) | 提示词 |
| 混合 | 2 | 0.0014 | 内层 Agent(模型)找,代码执行 | 代码模板 |

花费按 `.env` 里的高峰价算(DeepSeek 官网 2026 年 10 月查到:`deepseek-flash` 缓存命中输入 0.04 元、未命中输入 2 元、输出 8 元,每百万 token;闲时减半)。多 Agent 是工作流的 15 倍左右,和 Anthropic 文章说的 15 倍正好同一个量级,不过这只是一张工单跑一次,别把这个巧合当成规律。

多 Agent 那段值得多看几遍。账务专员早就把活干完了,主管还是把知识库专员派了出去,任务是「确认退款处理规则和退款单号的生成方式」,这件事没人需要。知识库专员老老实实搜了十次,一次都没找到,写了一段「我无法确认」交回来。九次调用里有好几次就花在这上面。这正是 Anthropic 文章里「子 Agent 重复劳动」的那类问题,只不过这里是主管多派了一个没用的活:主管的提示词写着「把活派给专员」,它就觉得两个专员都该用上。修法是把任务边界写清楚(什么情况下才找知识库),或者干脆不给它这个选项。

还要注意一件只有混合架构做到的事:内层 Agent 只有 `list_invoices`,没有 `create_refund`。退款这一步无论模型怎么想都不会自己发生,一定会经过审批节点。另外三种里,工作流的退款也是代码执行的,但「退哪张」是代码算的,换成规则复杂、写不成 `if` 的情况就不行了;单 Agent 和多 Agent 里,退不退、退哪张、退几次,全看模型。

## 读好拆,写难拆:一个小实验

LangChain 说读类任务比写类任务容易并行,Cognition 说动作带着隐含的决定。这两句话都可以在 5 分钱以内亲手验证。

**写类任务**:一封给王磊的道歉信,拆成前半段和后半段交给两个子 Agent,它们互相看不到对方写了什么。前半段要「明确告诉他我们补偿什么」,后半段要「说明补偿怎么领取」。补偿是什么,事实里没写,两边都得自己拿主意,这就是一个隐含的决定。对照组是一个 Agent 写整封信。

**读类任务**:13 张发票里找重复的(同一天同金额,除第一张外都算重复)。拆法是按日期分成两半,9 月 1–3 日一半,4–6 日一半,两个子 Agent 各找各的,结果取并集。对照组是一个 Agent 读全部 13 张。

新建 `part10/read_write.py`:

```python
# agent-zero-lab/part10/read_write.py
"""读类任务拆给两个子 Agent 没事,写类任务拆开就会互相打架。"""
import json
import re
import sys

from common.llm import LLMClient

FACTS = "客户王磊(C007)9 月 3 日被重复扣款 468 元,已退款,退款单号 RF-1。"
INVOICES = [  # 13 张发票,按开票顺序
    {"id": "INV-2280", "date": "2026-09-01", "amount": 199},
    {"id": "INV-2281", "date": "2026-09-02", "amount": 468},
    {"id": "INV-2282", "date": "2026-09-03", "amount": 99},
    {"id": "INV-2283", "date": "2026-09-04", "amount": 199},
    {"id": "INV-2284", "date": "2026-09-05", "amount": 468},
    {"id": "INV-2285", "date": "2026-09-06", "amount": 99},
    {"id": "INV-2286", "date": "2026-09-01", "amount": 199},
    {"id": "INV-2287", "date": "2026-09-02", "amount": 468},
    {"id": "INV-2288", "date": "2026-09-03", "amount": 99},
    {"id": "INV-2289", "date": "2026-09-04", "amount": 199},
    {"id": "INV-2290", "date": "2026-09-05", "amount": 468},
    {"id": "INV-2291", "date": "2026-09-06", "amount": 99},
    {"id": "INV-2292", "date": "2026-09-03", "amount": 468},
]


def ask(llm: LLMClient, prompt: str, json_mode: bool = False) -> str:
    kw = {"response_format": {"type": "json_object"}} if json_mode else {}
    return llm.chat([{"role": "user", "content": prompt}], **kw).content


def comp(text: str) -> set[str]:
    """抽出补偿:除了 468 之外出现的金额,再加上券/现金这类形式词。"""
    found = {m + "元" for m in re.findall(r"(\d+)\s*元", text) if m != "468"}
    return found | {w for w in ("代金券", "优惠券", "积分", "免费", "补偿金", "余额") if w in text}


def write_split(llm: LLMClient) -> tuple[set[str], set[str]]:
    a = ask(llm, f"{FACTS}\n写客服回复邮件的前半段:称呼客户、道歉、说明发生了什么,并明确告诉他我们补偿什么。只写这一段。")
    b = ask(llm, f"{FACTS}\n写客服回复邮件的后半段:说明补偿怎么领取、多久到账,最后落款。只写这一段。")
    return comp(a), comp(b)


def write_single(llm: LLMClient) -> set[str]:
    t = ask(llm, f"{FACTS}\n写一封完整的客服回复邮件:称呼、道歉、说明发生了什么、补偿什么、补偿怎么领取、多久到账、落款。")
    return comp(t)


def find_dups(llm: LLMClient, invs: list[dict]) -> set[str]:
    out = ask(llm, "下面是发票列表。同一天、同金额的发票里,除第一张外都算重复。"
                   '只输出 JSON:{"duplicates": [发票号, ...]}\n' + json.dumps(invs, ensure_ascii=False), json_mode=True)
    return set(json.loads(out)["duplicates"])


def truth(invs: list[dict]) -> set[str]:
    seen, dups = set(), set()
    for inv in invs:
        k = (inv["date"], inv["amount"])
        if k in seen:
            dups.add(inv["id"])
        seen.add(k)
    return dups


if __name__ == "__main__":
    llm = LLMClient()
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    print("== 写:拆给两个子 Agent")
    for i in range(n):
        a, b = write_split(llm)
        print(f"  第 {i + 1} 次 前半段说补偿 {sorted(a) or '无'} | 后半段说补偿 {sorted(b) or '无'} | {'一致' if a == b else '对不上'}")
    print("== 写:一个 Agent 写完整封")
    for i in range(n):
        print(f"  第 {i + 1} 次 整封信说补偿 {sorted(write_single(llm)) or '无'}")
    print(f"== 读:真实重复发票 {sorted(truth(INVOICES))}")
    by_day: dict[str, list[dict]] = {}
    for inv in INVOICES:
        by_day.setdefault(inv["date"], []).append(inv)
    days_sorted = sorted(by_day)
    half1 = [x for d in days_sorted[:3] for x in by_day[d]]
    half2 = [x for d in days_sorted[3:] for x in by_day[d]]
    for i in range(n):
        merged = find_dups(llm, half1) | find_dups(llm, half2)
        whole = find_dups(llm, INVOICES)
        print(f"  第 {i + 1} 次 两个子 Agent 合并 {sorted(merged)} | 一个 Agent {sorted(whole)}")
    print(llm.ledger)
```

<div class="line-notes">

- `FACTS = "客户王磊(C007)9 月 3 日被重复扣款 468 元,已退款,退款单号 RF-1。"` 所有写信的子 Agent 都拿到同一段事实。注意事实里**没有**补偿方案。
- `INVOICES = [  # 13 张发票,按开票顺序` 每个日期、金额组合都出现两次,前面那张是正常的,后面那张是重复;最后一张 INV-2292(9 月 3 日 468 元)是唯一的,是一张干扰项:9 月 3 日有别的发票,但金额不同。
- `kw = {"response_format": {"type": "json_object"}} if json_mode else {}` 要 JSON 的时候才开 JSON mode。写信不开,开了模型就只能写 JSON 了。
- `return llm.chat([{"role": "user", "content": prompt}], **kw).content` 这里没设 `temperature`,用 DeepSeek 默认值,同一个提示词每次写法会不一样,这样多跑几次才看得出规律。
- `def comp(text: str) -> set[str]:` 判题函数:从一段文字里抽出它说的补偿。抽两样东西,除 468 以外的金额(比如「50 元」),以及形式词(代金券、余额这类)。很粗糙,但足够看出两段话说的是不是同一个东西。
- `found = {m + "元" for m in re.findall(r"(\d+)\s*元", text) if m != "468"}` `re.findall` 配一个括号分组,返回所有分组匹配到的字符串。`\s*` 允许数字和「元」之间有空格。468 是退款金额,不算补偿。
- `def write_split(llm: LLMClient) -> tuple[set[str], set[str]]:` 写类任务的拆法:两个子 Agent 同时各写一半,谁也看不到谁。
- `def write_single(llm: LLMClient) -> set[str]:` 对照组:一个 Agent 写整封,要它写的内容和两半加起来一样。
- `def find_dups(llm: LLMClient, invs: list[dict]) -> set[str]:` 读类任务:给模型一个发票列表,要它返回重复的发票号。
- `def truth(invs: list[dict]) -> set[str]:` 标准答案用代码算,和 `arch_four.py` 里工作流找重复的逻辑一样。
- `by_day.setdefault(inv["date"], []).append(inv)` `setdefault` 的意思是:键不存在就先放一个空列表,然后返回这个键对应的值。相当于 JS 的 `(byDay[d] ??= []).push(inv)`。这一段把发票按日期分组。
- `half1 = [x for d in days_sorted[:3] for x in by_day[d]]` 前三天的发票放一起,两层 for 的列表推导式:外层遍历日期,内层遍历这一天的发票。**同一天的发票一定在同一半**,这是关键,练习 1 会改掉它看看后果。
- `merged = find_dups(llm, half1) | find_dups(llm, half2)` 两个子 Agent 的结果取并集。集合的 `|` 是并集,相当于 JS 的 `new Set([...a, ...b])`。

</div>

```bash
uv run python -m part10.read_write 5
```

```text
== 写:拆给两个子 Agent
  第 1 次 前半段说补偿 无 | 后半段说补偿 ['50元', '余额'] | 对不上
  第 2 次 前半段说补偿 无 | 后半段说补偿 ['50元'] | 对不上
  第 3 次 前半段说补偿 无 | 后半段说补偿 无 | 一致
  第 4 次 前半段说补偿 ['优惠券'] | 后半段说补偿 ['50元', '优惠券'] | 对不上
  第 5 次 前半段说补偿 ['优惠券'] | 后半段说补偿 ['50元', '优惠券'] | 对不上
== 写:一个 Agent 写完整封
  第 1 次 整封信说补偿 ['50元']
  第 2 次 整封信说补偿 ['50元', '优惠券']
  第 3 次 整封信说补偿 ['50元', '优惠券']
  第 4 次 整封信说补偿 ['50元', '优惠券']
  第 5 次 整封信说补偿 ['50元', '优惠券']
== 读:真实重复发票 ['INV-2286', 'INV-2287', 'INV-2288', 'INV-2289', 'INV-2290', 'INV-2291']
  第 1 次 两个子 Agent 合并 ['INV-2286', 'INV-2287', 'INV-2288', 'INV-2289', 'INV-2290', 'INV-2291'] | 一个 Agent ['INV-2286', 'INV-2287', 'INV-2288', 'INV-2289', 'INV-2290', 'INV-2291']
  第 2 次 两个子 Agent 合并 ['INV-2286', 'INV-2287', 'INV-2288', 'INV-2289', 'INV-2290', 'INV-2291'] | 一个 Agent ['INV-2286', 'INV-2287', 'INV-2288', 'INV-2289', 'INV-2290', 'INV-2291']
  第 3 次 两个子 Agent 合并 ['INV-2286', 'INV-2287', 'INV-2288', 'INV-2289', 'INV-2290', 'INV-2291'] | 一个 Agent ['INV-2286', 'INV-2287', 'INV-2288', 'INV-2289', 'INV-2290', 'INV-2291']
  第 4 次 两个子 Agent 合并 ['INV-2286', 'INV-2287', 'INV-2288', 'INV-2289', 'INV-2290', 'INV-2291'] | 一个 Agent ['INV-2286', 'INV-2287', 'INV-2288', 'INV-2289', 'INV-2290', 'INV-2291']
  第 5 次 两个子 Agent 合并 ['INV-2286', 'INV-2287', 'INV-2288', 'INV-2289', 'INV-2290', 'INV-2291'] | 一个 Agent ['INV-2286', 'INV-2287', 'INV-2288', 'INV-2289', 'INV-2290', 'INV-2291', 'INV-2292']
30 次调用 | 输入 5410 / 输出 2732 tokens | 约 ¥0.0302
```

**写**:拆开写,5 次里 4 次对不上。典型的情况是前半段只说「我们会给您一份补偿」或者「一张优惠券」,后半段自己定了「50 元」,客户读下来会觉得前后像两个人写的;第 3 次两边都没写具体补偿,判题函数算它「一致」,其实是两边都在含糊其辞。一个 Agent 写整封,5 次补偿都说得清楚,而且信里前后是同一个说法。在我之前的一次试跑里,拆开写的两半还出现过一边说「20 元」、另一边说「50 元」。这就是 Cognition 说的「每个动作带着隐含的决定」:补偿是什么,没人告诉它们,两个子 Agent 各自做了决定,而且彼此不知道。

**读**:两个子 Agent 的并集 5 次全对。有意思的是,一个 Agent 读全部 13 张,第 5 次把干扰项 INV-2292 也算成了重复(它和 INV-2282、INV-2288 同一天,但金额不同)。之前一次试跑里也是 5 次错 1 次,错的也是这张。我不打算从这么小的样本里得出「拆开读更准」的结论,能说的只是:读类任务拆开**没有坏处**,每个子 Agent 只看 6、7 张,任务更简单。

把补偿方案先定下来、再告诉两个写手,冲突就没了吗?练习 2 会验证。这就是 Cognition 2026 年那篇文章说的「写保持单线程」的一个变体:决定只做一次,写的人照着写。

## 什么时候该吵,什么时候不用吵

今天的东西浓缩成一张表,评审会上被问到时可以直接拿出来:

| 问题 | 偏向单 Agent / 工作流 | 偏向多 Agent |
| --- | --- | --- |
| 子任务之间依赖多吗 | 多,每步依赖上一步的决定 | 少,能独立做完再汇总 |
| 主要是读还是写 | 写(产物只有一份) | 读(结果可以合并、取舍) |
| 能按上下文边界拆吗 | 拆了会丢上下文 | 拆开的每块自带它需要的全部信息 |
| 钱和延迟 | 预算紧,单张工单要便宜 | 任务价值高,多花几倍 token 值得 |

明天会把这张表扩成五个维度,并且设计一个实验,在同一批工单上用数据比较这几种架构。

## 动手练习

**练习 1:按列表位置拆读任务。** 把 `read_write.py` 里按日期分组的拆法换成「前 7 张给一个子 Agent、后 6 张给另一个」,跑 3 次,看合并结果对不对。然后用一句话解释 Anthropic 那句「按上下文拆,不要按问题拆」。

<details><summary>参考答案</summary>

新建 `part10/ex540_split_wrong.py`:

```python
# agent-zero-lab/part10/ex540_split_wrong.py
from common.llm import LLMClient
from part10.read_write import INVOICES, find_dups, truth

llm = LLMClient()
half1, half2 = INVOICES[:7], INVOICES[7:]  # 按列表位置对半切,不管日期
print("真实重复:", sorted(truth(INVOICES)))
print("各半边自己的真实重复:", sorted(truth(half1) | truth(half2)))
for i in range(3):
    merged = find_dups(llm, half1) | find_dups(llm, half2)
    print(f"第 {i + 1} 次 两个子 Agent 合并:", sorted(merged))
print(llm.ledger)
```

<div class="line-notes">

- `from part10.read_write import INVOICES, find_dups, truth` 复用正文的数据和函数。`read_write.py` 的实验代码放在 `if __name__ == "__main__":` 下面,所以导入时不会把正文实验再跑一遍([Day 32](/blog/agent-zero/day-032-modules/))。
- `half1, half2 = INVOICES[:7], INVOICES[7:]  # 按列表位置对半切,不管日期` 前 7 张是 INV-2280 到 INV-2286,后 6 张是 INV-2287 到 INV-2292。
- `print("各半边自己的真实重复:", sorted(truth(half1) | truth(half2)))` 先用代码算一下:就算两个子 Agent 都做得完美,合起来最多能找到几张。

</div>

```bash
uv run python -m part10.ex540_split_wrong
```

```text
真实重复: ['INV-2286', 'INV-2287', 'INV-2288', 'INV-2289', 'INV-2290', 'INV-2291']
各半边自己的真实重复: ['INV-2286']
第 1 次 两个子 Agent 合并: ['INV-2286']
第 2 次 两个子 Agent 合并: ['INV-2286']
第 3 次 两个子 Agent 合并: ['INV-2286']
6 次调用 | 输入 1437 / 输出 54 tokens | 约 ¥0.0033
```

6 张重复只找到 1 张。两个子 Agent 都没做错,每一半里它们都把能找的找全了;错在拆法:INV-2281 在前一半、INV-2287 在后一半,它们是一对,但没有任何一个子 Agent 同时看到两张。

一句话解释:拆任务时,判断一件事需要的信息必须落在同一个子 Agent 的上下文里,所以要沿着「信息之间的依赖」拆(这里是按日期),而不是按表面上的工作量平均分。

</details>

**练习 2:先定决定,再分头写。** 写类任务里,先用一次模型调用定下补偿方案(JSON,含补偿内容和到账时间),再把这个决定原样写进两个子 Agent 的提示词。跑 5 次,看前后半段还对不对得上。

<details><summary>参考答案</summary>

新建 `part10/ex540_shared_decision.py`:

```python
# agent-zero-lab/part10/ex540_shared_decision.py
import json

from common.llm import LLMClient
from part10.read_write import FACTS, ask, comp

llm = LLMClient()
for i in range(5):
    decision = json.loads(ask(llm, f"{FACTS}\n决定给客户什么补偿。只输出 JSON:"
                                   '{"compensation": "一句话,具体到金额和形式", "eta": "多久到账"}', json_mode=True))
    shared = f"{FACTS}\n已定好的补偿:{decision['compensation']},{decision['eta']}到账。不要改动这个决定。"
    a = ask(llm, f"{shared}\n写客服回复邮件的前半段:称呼客户、道歉、说明发生了什么,并明确告诉他我们补偿什么。只写这一段。")
    b = ask(llm, f"{shared}\n写客服回复邮件的后半段:说明补偿怎么领取、多久到账,最后落款。只写这一段。")
    ca, cb = comp(a), comp(b)
    print(f"第 {i + 1} 次 决定:{decision['compensation']} | 前半段 {sorted(ca)} | 后半段 {sorted(cb)} | {'一致' if ca == cb else '对不上'}")
print(llm.ledger)
```

<div class="line-notes">

- `decision = json.loads(ask(llm, f"{FACTS}\n决定给客户什么补偿。只输出 JSON:"` 先单独做「决定」这一步。真实系统里这一步通常不交给模型,而是查补偿规则表,这里用模型是为了让每次的决定不一样,看两个写手能不能跟上。
- `shared = f"{FACTS}\n已定好的补偿:{decision['compensation']},{decision['eta']}到账。不要改动这个决定。"` 把决定写进两个子 Agent 共享的上下文。这就是 Cognition 第一条原则「共享上下文」最朴素的做法。
- `ca, cb = comp(a), comp(b)` 用正文同一个判题函数抽补偿。

</div>

```bash
uv run python -m part10.ex540_shared_decision
```

```text
第 1 次 决定:赠送50元账户余额作为重复扣款补偿 | 前半段 ['50元', '余额'] | 后半段 ['50元', '余额'] | 一致
第 2 次 决定:468元原路退回已完成，另补偿50元账户余额作为致歉 | 前半段 ['50元', '余额'] | 后半段 ['50元', '余额'] | 一致
第 3 次 决定:补偿50元无门槛优惠券 | 前半段 ['50元', '优惠券'] | 后半段 ['50元', '优惠券'] | 一致
第 4 次 决定:20元无门槛现金券一张 | 前半段 ['20元'] | 后半段 ['20元'] | 一致
第 5 次 决定:补偿客户王磊(C007)20元微信立减金或等值现金红包 | 前半段 ['20元'] | 后半段 ['20元'] | 一致
15 次调用 | 输入 1401 / 输出 821 tokens | 约 ¥0.0094
```

5 次全部一致,而且决定本身每次不同(20 元、50 元、余额、优惠券),两个写手都跟上了。冲突的根源是「隐含的决定」,把决定变成显式的、只做一次、再共享给所有写手,冲突就消失了。代价是多了一次调用,以及流程上多了一步「先定后写」,这一步其实就是工作流。

</details>

**练习 3:管住多余的主管。** 正文里多 Agent 版的主管把知识库专员派去做了一件没人需要的事。只改主管的系统提示词(不改代码结构),让它在退款类工单上不再调 `ask_kb`。跑一次,对比调用次数和花费。

<details><summary>参考答案</summary>

把 `multi` 函数最后一行的主管提示词改成写清楚任务边界:

```python
    return agent_loop(llm, RULES + "你是主管,自己不查任何东西。账务问题(扣款、发票、退款)只交给账务专员;"
                      "只有客户问「怎么操作」时才交给知识库专员。专员交回结果后,直接汇总回复客户,不要再派别的活。",
                      ticket, sub_tools, who="主管")
```

<div class="line-notes">

- `RULES + "你是主管,自己不查任何东西。账务问题(扣款、发票、退款)只交给账务专员;"` 对应 Anthropic 说的「清楚的任务边界」:什么样的工单交给谁。
- `"只有客户问「怎么操作」时才交给知识库专员。专员交回结果后,直接汇总回复客户,不要再派别的活。",` 后半句是停止条件。原来的提示词没说什么时候算完,主管就倾向于把所有工具都用一遍。

</div>

把这三行替换进 `arch_four.py` 的 `multi` 后,运行:

```bash
uv run python -m part10.arch_four multi
```

```text
== multi
  [账务专员 模型决定] list_invoices({'customer_id': 'C007'}) -> [{'id': 'INV-2290', 'date': '2026-09-03', 'amount': 468}, {'
  [账务专员 模型决定] create_refund({'invoice_id': 'INV-2291', 'amount': 468}) -> {'refund_id': 'RF-1', 'invoice_id': 'INV-2291', 'amount': 46
  [主管 模型决定] ask_billing({'task': '客户 C007 反馈 9 月 3 日被扣了两次 468 元，请核查该客户 9 月 3 日的发票，若存在同一天同金额的重复扣款，请退掉后一张并返回退款单号。'}) -> 已核实客户 C007 在 9 月 3 日有两张同金额（468 元）的发票 INV-2290 和 INV-2291
  回复:您好，已核实您 9 月 3 日被重复扣款 468 元，我们已退掉后一张发票，退款单号 RF-1，款项将原路退回，请注意查收。
  模型调用 4 次,约 ¥0.0035,累计退款 1 笔
```

调用从 9 次降到 4 次,花费从 0.0118 降到 0.0035 元。即便这样,它还是工作流的 4 倍多:主管一次派活、专员两次、主管一次汇总,这是主管派活这个形状的固定开销。对于一张只需要查一下、退一笔的工单,多出来的那一层并没有带来任何东西。

</details>

**练习 4(开放题):给三个任务选架构。** 只用今天的「三种立场」和「谁决定下一步」,给下面三个任务各推荐一种架构,并写出一句最关键的理由:(a)SupportPilot 处理一张「重复扣款」工单;(b)给销售团队写一份「十家竞品的定价对比报告」;(c)根据一个 issue 修一个跨五个文件的 bug 并补测试。

<details><summary>参考答案</summary>

一个示范答案:

(a)混合。退款必须审批、回复必须带单号,这些「一定要发生」的步骤放在外层工作流里用代码保证;「找出要退哪张」这种需要看懂客户描述的部分交给内层 Agent,而且它只有查询工具,没有退款工具。今天的实跑里混合架构只用 2 次调用,和工作流一样便宜。

(b)主管派活的多 Agent。十家竞品互不依赖,每个子 Agent 读一家,任务描述写清楚要交回的字段(价格档位、计费单位、免费额度、来源链接),主管只负责汇总和写报告。这是以读为主、能按上下文边界拆(一家一个)、价值高的典型场景,多花的 token 值得。写报告这一步留给主管一个人,保持「写是单线程」。

(c)单 Agent。改五个文件是写类任务,每处改动都依赖前面的决定(接口怎么改、变量叫什么),拆给多个 Agent 同时写就是 Flappy Bird。可以加一个不带上下文的审查 Agent 在最后审一遍,也就是 Cognition 2026 年说的「一个写、一个审」,但写的只能有一个。

</details>

**验收标准**:`arch_four.py` 四种架构都跑通,你能对着自己的输出说出每一步是代码还是模型决定的;`read_write.py` 跑出写类任务前后对不上的情况;练习 1 亲眼看到按位置拆导致漏检;能不看文章复述三篇文章各自一句话的论点和它们 2026 年的更新。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 单线程线性 Agent | Cognition 推荐的形状:一个 Agent 按顺序做完所有事,上下文一路连续,不分叉给别的 Agent |
| 隐含的决定 | 动作背后没说出来的选择,比如写信时自己定了补偿 50 元。多个 Agent 各自做隐含决定,拼起来就会冲突 |
| 完整轨迹 trace | 一个 Agent 做过的所有步骤:模型说了什么、调了什么工具、拿到什么结果,而不只是最后交出来的那段话 |
| 读类 / 写类任务 | 读类是查资料、找信息,结果可以合并取舍;写类是产出一份东西(代码、信、报告),产物只有一份,冲突就是错 |
| 上下文污染 | 无关的中间结果塞满上下文,让模型表现变差。Anthropic 说的多 Agent 适用情况之一就是用子 Agent 隔离它 |
| 按上下文拆 | 拆任务时让判断一件事所需的信息都落在同一个子 Agent 里,和「按工种拆」(写代码、写测试、审查各一个)相对 |
| 混合架构 | 外层是代码写死的工作流,保证必须发生的步骤;内层某些节点是能自主调工具的 Agent |
| agent as tool | 把一个子 Agent 包装成主 Agent 的一个工具,参数是任务描述,返回值是子 Agent 的最终回复 |
| BrowseComp | OpenAI 发布的一个评测,考 Agent 上网找难以找到的信息,Anthropic 用它分析多 Agent 的表现来源 |

## 常见误区

**引用「多 Agent 提升 90%」不带条件。** 那是 Anthropic 内部研究类评测上、Opus 4 带 Sonnet 4 子 Agent 对比单个 Opus 4 的结果,同一篇文章说 token 用量解释了 BrowseComp 上 80% 的差异,也说大多数编程任务不适合。面试时引用数字一定把场景和条件一起说。

**把 Cognition 那篇当成「永远别用多 Agent」。** 它 2026 年 4 月的新文章已经说了哪些形状管用:写保持单线程,其他 Agent 只贡献分析和审查。现在拿 2025 年那篇的标题去反驳所有多 Agent 设计,会显得没跟上。

**按工种拆任务。** 一个写功能、一个写测试、一个写文档,看起来分工清楚,实际上每次交接都丢上下文。练习 1 里按位置拆发票,6 张重复只找到 1 张,两个子 Agent 都没犯错,错在拆法。

**以为多 Agent 只是贵一点。** 今天这张简单工单上,多 Agent 花了工作流 15 倍的钱,还让一个子 Agent 白搜了十次。问题不只是钱:主管多派一个活,就多一次出错和拖慢的机会。

**把必须发生的步骤写在提示词里。** 「退款前要审批」写在提示词里,模型大多数时候会照做;写在代码里,它每次都会发生。混合架构的内层 Agent 根本拿不到退款工具,这比任何提示词都可靠。

**多次运行里有一次一致,就说两个写手没冲突。** 正文第 3 次「一致」是因为两边都没写具体补偿,判题函数把「都没说」也算成了一致。看实验结果时要回去读原文,别只看判题函数的结论。

## 学习资料

### 文档与文章

- [Cognition《Don't Build Multi-Agents》](https://cognition.com/blog/dont-build-multi-agents):两条原则和 Flappy Bird 的例子。15 分钟。
- [Cognition《Multi-Agents: What's Actually Working》](https://cognition.com/blog/multi-agents-working):2026 年 4 月的续篇,讲写保持单线程、审查 Agent 不带上下文、主管拆活三种管用的形状。15 分钟。
- [Anthropic《How we built our multi-agent research system》](https://www.anthropic.com/engineering/multi-agent-research-system):重点读 token 用量、给子 Agent 写任务描述、评测方法三部分。30 分钟。
- [Claude 博客《Building multi-agent systems: When and how to use them》](https://www.claude.com/blog/building-multi-agent-systems-when-and-how-to-use-them):2026 年 1 月,三种适用情况、3 到 10 倍 token、按上下文拆。20 分钟。
- [LangChain《How and when to build multi-agent systems》](https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems):读写之分的出处。10 分钟。
- [Anthropic《Building effective agents》](https://www.anthropic.com/engineering/building-effective-agents):workflow 和 agent 的定义,再读一遍「什么时候用 agent」那一节。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19LdqBAErd&autoplay=0&high_quality=1" title="多智能体系统怎么搭?claude给出了5种模式和选择标准" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · 多智能体系统怎么搭?claude 给出了 5 种模式和选择标准 · 17 分钟,讲的是 Claude 博客 2026 年 4 月的《Multi-agent coordination patterns》。今天先看它怎么把多 Agent 分成几种形状,明天讲状态和失败时会用到里面的「共享状态」和「消息总线」。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/JYaGAqvPfYA" title="Anthropic vs Cognition on Multi-Agents: A Breakdown with Dylan Davis" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Latent Space · Anthropic vs Cognition on Multi-Agents: A Breakdown with Dylan Davis · 把 2025 年那两篇文章放在一起逐条讨论,和今天前半部分几乎一一对应,英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · Anthropic 几位工程师聊什么时候该用 Agent、什么时候用写死的流程就够,对应今天「谁决定下一步」那一节,英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章「RAG and Agents」:Agent 的规划、工具和失败模式,读完对「什么时候让模型决定下一步」会有更系统的认识。
- Mark Richards、Neal Ford《Fundamentals of Software Architecture》(O'Reilly,2020),中文版《软件架构:架构模式、特征及实践指南》(机械工业出版社):不讲 Agent,但「架构的一切都是取舍」这句话和第 1、2 章的思路,是明天五个维度的出发点。

### 开源项目与代码

- [openai/openai-agents-python](https://github.com/openai/openai-agents-python):`examples/agent_patterns/` 目录里有 `agents_as_tools.py`(今天多 Agent 版的写法)、`routing.py`、`deterministic.py`(确定性工作流)等,可以和 `arch_four.py` 对照读。
- 你自己的 `part10/arch_four.py` 和 `part10/orch_tools.py`:明天的对比实验直接 import 它们。

## 自测

1. Cognition 2025 年那篇文章的两条原则是什么?它 2026 年的续篇改了什么说法?

<details><summary>答案</summary>

两条原则:共享上下文,而且要共享完整的 Agent 轨迹而不只是几条消息;每个动作都带着隐含的决定,相互冲突的决定会带来坏结果。2026 年 4 月的续篇说找到了几种真正管用的多 Agent 形状,核心是写操作保持单线程、其他 Agent 只贡献分析和审查(比如一个写代码一个审代码、主管拆活后汇总),多个 Agent 同时写的形状仍然没被采用。

</details>

2. Anthropic 说多 Agent 研究系统比单 Agent 高 90.2%。引用这个数字时必须同时说清楚哪些条件?

<details><summary>答案</summary>

一是场景:内部的研究类评测,主 Agent 是 Opus 4、子 Agent 是 Sonnet 4,对比的是单个 Opus 4;二是成本:多 Agent 系统的 token 用量约是聊天的 15 倍,在 BrowseComp 上 token 用量一项就解释了 80% 的表现差异,所以提升有很大一部分来自花了更多 token;三是适用范围:他们自己说需要共享上下文、Agent 间依赖多的领域,以及大多数编程任务,目前不适合多 Agent。

</details>

3. 判断一个系统属于四种架构里的哪一种,只需要问哪一个问题?SupportPilot 属于哪一种?

<details><summary>答案</summary>

下一步做什么,是代码决定还是模型决定。全由代码决定是工作流,全由一个模型决定是单 Agent,由多个各有上下文的模型决定是多 Agent,外层代码决定、内层某些节点由模型决定是混合。SupportPilot 是混合:分类、检索、审批写死,处理工单的节点里是一个 Agent。

</details>

4. 今天的 `read_write.py` 实验里,为什么写类任务拆开就对不上,读类任务拆开却没事?

<details><summary>答案</summary>

写信时补偿是什么,事实里没给,前后两个子 Agent 都要自己做这个决定,而且互相看不到,所以 5 次里 4 次对不上。找重复发票时,规则是明确的,每个子 Agent 只要在自己那一半里按规则找,结果合并就行,不需要做彼此冲突的决定。前提是拆法正确:同一天的发票要在同一半,练习 1 按位置拆就漏掉了 5 张。

</details>

5. 面试题:「你在设计一个客服 Agent,同事建议把它拆成『理解问题』『查资料』『写回复』『审核回复』四个 Agent,说这样职责清楚。你怎么评价?」

<details><summary>答案</summary>

要点:这是按工种拆,每次交接都会丢上下文。「写回复」的 Agent 看不到「理解问题」时的完整推理,只能拿到一段摘要,容易做出和前面不一致的隐含决定;四个 Agent 意味着至少三次交接和数倍的 token。更好的做法:按上下文拆,查资料如果是多个互不依赖的来源,可以并行交给子 Agent 读;理解问题和写回复由同一个 Agent 连续完成,保持写是单线程;审核可以单独一个 Agent,而且最好不带写回复 Agent 的上下文(Cognition 2026 年说审查 Agent 不共享上下文时效果最好);退款、审批这些必须发生的步骤放在外层工作流里。最后说明会用实验比较,而不是凭直觉定。

</details>

6. 多 Agent 版本的主管为什么多派了一个没用的活?怎么修?

<details><summary>答案</summary>

主管的提示词只说了「把活派给专员,最后汇总」,没有说什么情况下找哪个专员、什么时候算完,它就倾向于把所有专员都用上。修法是写清任务边界和停止条件(账务问题只找账务专员,问操作才找知识库专员,专员交回后直接汇总),练习 3 实跑调用从 9 次降到 4 次;更彻底的做法是根本不给它这个选项,比如在混合架构里由代码决定派给谁。

</details>

## 明天预告

Day 541 · 编排取舍(二):五个维度、状态和失败、对比实验。今天的表只有四行,明天把它扩成决定架构的五个维度;再讲多 Agent 落地时最常被忽略的两件事,共享状态和消息传递怎么选,一个子 Agent 失败了怎么不让整个任务静默出错;最后写一个对比实验脚本,把今天的四种架构放到一批工单上各跑几次,用成功率、稳定性、成本、延迟四个指标做决定。
