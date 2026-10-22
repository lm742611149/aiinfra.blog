---
title: 'Day 13 · Workflow 还是 Agent:《Building effective agents》五种模式逐个实现'
description: '通读 Anthropic 的《Building effective agents》,把 prompt chaining、routing、parallelization、orchestrator-workers、evaluator-optimizer 五种 workflow 模式各写一个可运行的最小实现,全部用客服工单做例子。最重要的收获是一个判断:什么时候根本不需要 Agent。'
pubDate: 2026-10-12
regime: none
tags: ['workflow', 'design-patterns', 'routing', 'orchestrator-workers', 'agent-60']
series: 'agent-60'
day: 13
lang: 'zh'
---

## 今天要解决的问题

前五天我们一直在造 Agent:让模型自己决定调什么工具、调几次、什么时候停。今天要泼一盆冷水:**大多数生产系统里,你需要的不是 Agent,而是 workflow。**

这不是我的个人观点,是 Anthropic 在 2024 年 12 月发表的《Building effective agents》的核心结论。那篇文章总结了他们和几十个团队合作构建 LLM 应用的经验,发现最成功的实现往往不用复杂框架,而是用简单、可组合的模式。这篇文章后来成了 Agent 领域被引用最多的工程文章之一,面试里「你怎么理解 workflow 和 agent 的区别」几乎是必问题。

今天学完你应该能:

1. 说清楚 workflow 和 agent 的定义差异,以及「增强型 LLM」这个基本构件。
2. 用代码实现文中的五种 workflow 模式,每种都知道适用场景和代价。
3. 拿到一个需求,能判断该用单次调用、哪种 workflow,还是真的需要 agent。
4. 理解 Anthropic 对框架的态度,以及他们说的 ACI(agent-computer interface)是什么意思。

预计用时 5–6 小时,五种模式每种大约一小时,建议一种一种跑通,别一口气全复制。前置是 Day 6 的 JSON 输出和 Day 2 的 asyncio。

## 两个定义和一个构件

文章先区分了两类系统。**Workflow**:LLM 和工具通过**预先写好的代码路径**来编排。**Agent**:LLM **动态地决定**自己的流程和工具使用,自己掌控怎么完成任务。两者合称 agentic systems(智能体系统)。

区别只有一个:**下一步做什么,是代码决定的还是模型决定的。** 你在 Day 9 写的循环里,模型决定调不调工具、调哪个、调几次,这是 agent。Day 10 的 plan-and-execute 里,规划器决定步骤,但执行顺序由代码固定,算是 workflow 和 agent 的混合。今天的五种模式全部是 workflow:每一步做什么都写在代码里,模型只负责每一步里的「智力活」。

两者都建立在一个基本构件上:**增强型 LLM**(augmented LLM),也就是一个配备了检索、工具、记忆的模型。文中特别强调,要把这个构件的接口做好、文档写清楚,这一条和 Day 11 讲的工具设计一脉相承。

然后是全文最重要的一段话,大意是:构建 LLM 应用时,先找最简单的方案,只在必要时增加复杂度,这可能意味着根本不去构建 agentic 系统。Agentic 系统通常用延迟和成本换取更好的任务表现,你要想清楚这个交换值不值。很多应用用一次 LLM 调用,配上检索和几个好的示例,就已经够了。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="从单次调用到 workflow 再到 agent 的复杂度阶梯">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">复杂度阶梯:能停在低的一级,就别往上走</text>
  <rect x="30" y="185" width="170" height="45" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="115" y="205" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">单次调用</text>
  <text x="115" y="222" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">+ 检索 + 示例</text>
  <rect x="235" y="130" width="170" height="100" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">Workflow</text>
  <text x="320" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">代码决定路径</text>
  <text x="320" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">五种模式</text>
  <text x="320" y="208" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">可预测、好测试</text>
  <rect x="440" y="70" width="170" height="160" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="525" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">Agent</text>
  <text x="525" y="112" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">模型决定路径</text>
  <text x="525" y="130" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">开放式问题</text>
  <text x="525" y="148" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">步数无法预知</text>
  <text x="525" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">更贵、更难测</text>
  <text x="320" y="250" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">往右:灵活性 ↑ 延迟 ↑ 成本 ↑ 可预测性 ↓</text>
</svg>
<figcaption>三级台阶。每往上一级,都要有证据(评测分数)说明下一级确实带来了提升。</figcaption>
</figure>

## 准备:共用的两个小函数和一张工单

五种模式都用同一个例子:云簿 CloudLedger(我们从 W4 开始的毕业项目里那家虚构的 SaaS 公司)收到的一张重复扣费工单。为了让每个模式的代码只关注模式本身,我把调模型的代码收进两个小函数,一个同步一个异步。

```python
# agent-60-lab/w2/wf_common.py  五种模式共用的小函数:同步/异步 × 文本/JSON
import json
import os
from typing import Any

from dotenv import load_dotenv
from openai import AsyncOpenAI, OpenAI

load_dotenv()  # 和 Day 8 起一样,从仓库根目录的 .env 读配置

client = OpenAI(base_url=os.environ.get("LLM_BASE_URL"), api_key=os.environ.get("LLM_API_KEY", "missing"))
aclient = AsyncOpenAI(base_url=os.environ.get("LLM_BASE_URL"), api_key=os.environ.get("LLM_API_KEY", "missing"))
MODEL = os.environ.get("LLM_MODEL", "")
SMALL_MODEL = os.environ.get("LLM_SMALL_MODEL", MODEL)  # 便宜模型,没配就用同一个
EXTRA_BODY = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))  # 比如关掉 DeepSeek 的思考模式,没配就是 {}


def _params(prompt: str, system: str, as_json: bool, model: str | None) -> dict[str, Any]:
    messages: list[Any] = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    params: dict[str, Any] = {"model": model or MODEL, "messages": messages, "extra_body": EXTRA_BODY}
    if as_json:
        params["response_format"] = {"type": "json_object"}
    return params


def llm(prompt: str, system: str = "", model: str | None = None) -> str:
    resp = client.chat.completions.create(**_params(prompt, system, False, model))
    return resp.choices[0].message.content or ""


def llm_json(prompt: str, system: str = "", model: str | None = None) -> dict[str, Any]:
    resp = client.chat.completions.create(**_params(prompt, system, True, model))
    return json.loads(resp.choices[0].message.content or "{}")


async def allm(prompt: str, system: str = "") -> str:
    resp = await aclient.chat.completions.create(**_params(prompt, system, False, None))
    return resp.choices[0].message.content or ""


async def allm_json(prompt: str, system: str = "") -> dict[str, Any]:
    resp = await aclient.chat.completions.create(**_params(prompt, system, True, None))
    return json.loads(resp.choices[0].message.content or "{}")


TICKET = """客户:陈先生(customer_id 10086,专业版年付)
主题:被重复扣费了!!
内容:我 9 月 28 号续费专业版,银行卡被扣了两次 1188 元,订单号 CL-20931 和 CL-20932。
你们系统是不是有 bug?我要求退回多扣的那笔,而且要一个解释。三天内没处理我就投诉。"""
```

<div class="line-notes">

- `from openai import AsyncOpenAI, OpenAI` 同步客户端和异步客户端各一个。模式三、四要并发发请求,只能用异步版。
- `load_dotenv()  # 和 Day 8 起一样` 从仓库根目录的 `.env` 读配置。放在模块顶层,所以谁 import 了 `wf_common`,配置就都加载好了。
- `client = OpenAI(base_url=os.environ.get("LLM_BASE_URL"), api_key=os.environ.get("LLM_API_KEY", "missing"))` 用 `.get` 加默认值 `"missing"`,而不是 `os.environ["..."]`:没配 key 时 import 不会直接崩,真调用时才报 401,方便先跑不调模型的部分。
- `aclient = AsyncOpenAI(` 异步版客户端。它是模块级的,连接池会绑定在第一次用它的事件循环上,这就是模式三最后那条「一个脚本只调一次 `asyncio.run`」的原因。
- `MODEL = os.environ.get("LLM_MODEL", "")` 实测是 `deepseek-flash`。
- `SMALL_MODEL = os.environ.get("LLM_SMALL_MODEL", MODEL)` 实测我的 `.env` 没配 `LLM_SMALL_MODEL`,所以 `SMALL_MODEL` 也是 `deepseek-flash`,路由时分类和回答用的是同一个模型。
- `EXTRA_BODY = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` 环境变量只能是字符串,`json.loads` 把它变成 dict。实测 `.env` 里是 `{"thinking": {"type": "disabled"}}`,关掉 DeepSeek 的思考模式。
- `def _params(prompt: str, system: str, as_json: bool, model: str | None) -> dict[str, Any]:` 四个函数共用的「拼请求参数」。函数名前面的下划线表示内部用,别的文件不该直接调它。
- `messages: list[Any] = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]` 条件表达式 `A if 条件 else B`,再用 `+` 拼接两个列表。有 system 时是两条消息,没有就只有一条 user。实测 `_params("你好", "", False, "small-x")` 的 messages 只有 `[{"role": "user", "content": "你好"}]`。
- `params: dict[str, Any] = {"model": model or MODEL, "messages": messages, "extra_body": EXTRA_BODY}` `model or MODEL`:传了模型名就用传的,传 None 就用默认的。
- `params["response_format"] = {"type": "json_object"}` JSON 模式,保证模型返回的是合法 JSON。实测 `_params("你好", "你是客服", True, None)` 得到:<br>`{"model": "deepseek-flash", "messages": [{"role": "system", "content": "你是客服"}, {"role": "user", "content": "你好"}], "extra_body": {"thinking": {"type": "disabled"}}, "response_format": {"type": "json_object"}}`
- `resp = client.chat.completions.create(**_params(prompt, system, False, model))` `**dict` 把字典展开成关键字参数,等价于 `create(model=..., messages=..., extra_body=...)`。
- `return resp.choices[0].message.content or ""` 返回类型是 `str`,content 为 None 时兜成空串。
- `return json.loads(resp.choices[0].message.content or "{}")` 返回类型是 dict。模型偶尔回空内容时 `or "{}"` 兜成空字典,后面 `facts.get(...)` 不会崩。
- `async def allm(prompt: str, system: str = "") -> str:` `async def` 定义协程函数,调用它不会马上执行,要 `await` 或交给 `asyncio.gather`。
- `resp = await aclient.chat.completions.create(**_params(prompt, system, False, None))` `await` 的意思是「这里要等网络,先去干别的」。几个请求同时在等的时候,事件循环在它们之间切换,这就是并发。
- `TICKET = """客户:陈先生` 三引号字符串可以跨行。五种模式都处理这张工单:两个订单号 CL-20931、CL-20932,金额 1188,三天时限。

</div>

`LLM_SMALL_MODEL` 是一个新的环境变量,指向一个更便宜的模型。路由模式里会用到。如果你的厂商只有一个模型,不配就行,代码会退回到同一个模型。

几个和前几天保持一致的细节:开头 `load_dotenv()` 从 `.env` 读配置;`extra_body` 带上 `LLM_EXTRA_BODY`(比如 DeepSeek 关掉思考模式,又快又省);返回文本和返回 JSON 拆成 `llm` / `llm_json` 两个函数(异步版 `allm` / `allm_json`),这样 `llm_json(...)` 的返回类型就是 `dict`,后面写 `facts.get(...)`、`plan["sections"]` 编辑器不会飘红,`llm(...)` 的返回类型就是 `str`。如果合成一个函数、用 `as_json=True` 切换,返回类型只能写成 `str | dict`,每个用到的地方都要先判断类型。

所有文件放在 `w2/` 下,和前几天一样在仓库根目录用 `-m` 运行,比如 `uv run python -m w2.wf1_chaining`。我用 deepseek-flash 把五个都实跑过,每个 3 到 7 秒,一共花不到一毛钱。

## 模式一:Prompt chaining(提示链)

是什么:把任务拆成固定的几步,每一步的输出作为下一步的输入。中间可以插入**关卡**(gate),用代码检查前一步的结果,不合格就提前终止或转人工。

什么时候用:任务能被干净地拆成固定的子任务。用延迟换准确率,让每一次调用都只做一件更简单的事。文中的例子是先写营销文案再翻译,先写大纲、检查大纲、再写正文。

```python
# agent-60-lab/w2/wf1_chaining.py  模式一:提示链,一步的输出是下一步的输入,中间可以插代码检查
from w2.wf_common import TICKET, llm, llm_json


def chain(ticket: str) -> str:
    # 第 1 步:抽取关键信息(结构化,方便代码检查)
    facts = llm_json(
        f"从工单里抽取信息,输出 JSON:{{\"customer_id\":..., \"order_ids\": [...], \"amount\": ..., \"issue\": \"一句话\", \"deadline\": \"客户提的时限,没有就 null\"}}\n\n工单:\n{ticket}"
    )
    # 关卡(gate):纯代码检查,不过就不往下走,这是 chaining 比单个大提示词更可控的地方
    if not facts.get("order_ids"):
        return "【转人工】工单里没有订单号,无法自动处理。"
    # 第 2 步:按事实起草回复
    draft = llm(
        f"你是云簿 CloudLedger 的客服。根据这些事实给客户写回复初稿:\n{facts}\n"
        "要求:先道歉并确认问题;说明已提交退款核查(不要承诺具体到账日期);给出工单跟进方式。150 字以内。"
    )
    # 第 3 步:语气润色(单独一步,职责单一,好调好测)
    return llm(f"把下面的客服回复改得更自然、不卑不亢,保留所有事实和订单号,不要增加新承诺:\n\n{draft}")


if __name__ == "__main__":
    print(chain(TICKET))
```

<div class="line-notes">

- `from w2.wf_common import TICKET, llm, llm_json` 只拿要用的三样。
- `facts = llm_json(` 第 1 步:让模型把工单抽成结构化 JSON。
- `f"从工单里抽取信息,输出 JSON:{{\"customer_id\"` f-string 里要输出字面的 `{` `}`,得写成 `{{` `}}`;单个 `{ticket}` 才是变量。`\"` 是在双引号字符串里写双引号。这次实跑 1.2 秒返回:<br>`{"customer_id": 10086, "order_ids": ["CL-20931", "CL-20932"], "amount": 1188, "issue": "专业版续费被重复扣费两次1188元，要求退回多扣的一笔并解释", "deadline": "三天内"}`
- `if not facts.get("order_ids"):` 关卡,纯代码判断,不花 token。`.get` 拿不到返回 None,空列表 `[]` 也是假,两种情况都会进 if。上面那次有两个订单号,通过。<br>我另外拿一张没订单号的工单(「我好像被多扣钱了,你们查一下。」)实测:抽出来 `"order_ids": []`,`not []` 为 True,直接返回转人工,后面两步都没调。顺带一提,那次模型把「王女士」填进了 `customer_id`,这也说明抽取结果要靠代码检查,不能全信。
- `return "【转人工】工单里没有订单号,无法自动处理。"` 关卡不过就提前结束,第 2、3 步一次都不调。
- `draft = llm(` 第 2 步:按事实写初稿。`{facts}` 把 dict 直接塞进提示词,打印出来是 Python 的 dict 格式,模型读得懂。这次实跑 1.2 秒返回:「您好，非常抱歉给您带来困扰。已确认您的专业版续费订单 CL-20931、CL-20932 因重复扣费，多扣了 1188 元。我们已提交退款核查……」
- `"要求:先道歉并确认问题;` 和上一行是相邻的两个字符串,Python 自动拼成一个。限制「不要承诺具体到账日期」,初稿写的是「具体到账时间以核查结果为准」,守住了。
- `return llm(f"把下面的客服回复改得更自然` 第 3 步:只管润色。这次实跑 0.9 秒,改动很小:「已确认您的……订单因重复扣费」改成「经确认,您的……订单存在重复扣费」,订单号和金额都保留着。三步一共 3.3 秒。
- `print(chain(TICKET))` 在仓库根目录用 `uv run python -m w2.wf1_chaining` 运行。

</div>

这里最值得体会的是那个关卡。第一步要求输出 JSON,这样第二步之前,代码就能确定性地检查「有没有订单号」。如果把三步合成一个大提示词,你就失去了这个检查点,模型可能在没有订单号的情况下编一个出来。**拆分的价值不只是让每步更简单,更是在步骤之间获得了用代码控制流程的机会。**

另一个好处是可测试。第一步的抽取结果可以和人工标注比对,第二步可以单独评估回复质量,出问题时你知道是哪一步坏了。毕业项目的主流程本质上就是一条加了分支的提示链。

## 模式二:Routing(路由)

是什么:先对输入分类,再交给专门的处理分支。每个分支有自己的提示词、工具,甚至自己的模型。

什么时候用:输入有明显不同的类别,而且分开处理效果更好。文中举了两个例子:客服问题按类型分流到不同的流程和工具;简单问题交给小模型、难题交给大模型,以优化成本和速度。

```python
# agent-60-lab/w2/wf2_routing.py  模式二:路由,先分类,再交给专门的处理分支
from w2.wf_common import SMALL_MODEL, TICKET, llm, llm_json

HANDLERS = {
    "billing": "你是计费专员。熟悉扣费、退款、发票规则。回答要给出具体的下一步操作。",
    "technical": "你是技术支持。先确认报错信息和复现步骤,再给排查建议。",
    "account": "你是账号专员。涉及登录、权限、改密码时,提醒客户注意账号安全,不要在工单里发密码。",
}


def route(ticket: str) -> str:
    # 分类这种简单任务用小模型,又快又便宜(模型路由,Day 38 会细讲)
    c = llm_json(
        "把工单分到一个类别,输出 JSON {\"category\": \"billing|technical|account|other\", \"confidence\": 0到1}\n\n" + ticket,
        model=SMALL_MODEL,
    )
    category = c.get("category")
    if category not in HANDLERS or c.get("confidence", 0) < 0.6:
        return f"【转人工】无法可靠分类:{c}"
    print("路由到:", category)
    return llm(ticket, system=HANDLERS[category])


if __name__ == "__main__":
    print(route(TICKET))
```

<div class="line-notes">

- `HANDLERS = {` 每个类别对应一段专门的 system 提示词。加一个分支就是加一行。
- `def route(ticket: str) -> str:` 两步:先分类,再按类别处理。
- `c = llm_json(` 分类这一步要 JSON,因为后面要用代码读 `category` 和 `confidence`。
- `"把工单分到一个类别,输出 JSON` 字符串用 `+ ticket` 拼接,不是 f-string,所以里面的 `{` `}` 不用写两遍。
- `model=SMALL_MODEL,` 分类用便宜模型。实测我没配 `LLM_SMALL_MODEL`,这里还是 `deepseek-flash`。这次分类只用了 0.5 秒,返回 `{"category": "billing", "confidence": 0.98}`。
- `category = c.get("category")` 实测 `"billing"`。
- `if category not in HANDLERS or c.get("confidence", 0) < 0.6:` 两个出口:类别不在三个分支里(比如 `other`),或者置信度低于 0.6。`c.get("confidence", 0)` 在模型没给置信度时按 0 算,一定转人工。<br>我拿「你们周末上班吗?」实测:返回 `{'category': 'other', 'confidence': 0.6}`。置信度刚好 0.6 不小于 0.6,但 `other` 不在 `HANDLERS` 里,照样转人工。
- `return f"【转人工】无法可靠分类:{c}"` 把分类结果一起带上,人工一看就知道为什么没自动处理。
- `print("路由到:", category)` 实测打印 `路由到: billing`。
- `return llm(ticket, system=HANDLERS[category])` 用计费专员的 system 提示词回答。这次实跑 3.3 秒,返回的是一份「# 重复扣费处理方案」,分「核实信息」「处理动作」几节,写的是内部该怎么查流水、怎么退款,不像直接发给客户的回复。原因是 system 里写了「回答要给出具体的下一步操作」,模型就理解成给同事写处理步骤。分支提示词写什么,输出就长什么样,这也是路由的好处:每个分支可以单独调。

</div>

路由的关键是分类要准,而且要有出口。我让分类器同时输出置信度,低于 0.6 或者分到 other 就转人工,而不是硬塞进某个分支。一个被错误路由的工单,比一个转人工的工单糟糕得多:计费问题被当成技术问题处理,客户会觉得你们答非所问。

分类这一步用了小模型。分类是相对简单的任务,小模型通常够用,而它每张工单都要跑一次,省下的钱很可观。是否真的够用,要靠 W5 的评测来证明,不能凭感觉。

## 模式三:Parallelization(并行)

是什么:多个 LLM 调用同时进行,结果由代码汇总。文中分了两种变体。**分段**(sectioning):把任务拆成独立的子任务并行跑。**投票**(voting):同一个任务跑多次,汇总多个结果。

什么时候用:子任务互相独立,并行能提速;或者需要多个视角、多次尝试来提高结果的可信度。文中的例子:一个模型处理用户请求、另一个模型同时做内容安全检查,这比让同一个模型兼顾两件事效果更好;代码审查时用多个提示词从不同角度找漏洞;判断内容是否违规时多次投票,用不同阈值平衡误报和漏报。

```python
# agent-60-lab/w2/wf3_parallel.py  模式三:并行,分两种:分段(sectioning)和投票(voting)
import asyncio
from collections import Counter
from typing import Any

from w2.wf_common import TICKET, allm, allm_json


async def sectioning(ticket: str) -> str:
    """分段:回答和安全检查同时跑,互不干扰。"""
    answer, guard = await asyncio.gather(
        allm(ticket, system="你是云簿客服,简洁地回复这张工单。"),
        allm_json(f"这张工单里有没有人身威胁、索要他人信息、或要求绕过流程的内容?输出 JSON {{\"risky\": true/false, \"reason\": \"...\"}}\n\n{ticket}"),
    )
    return "【转人工】" + guard["reason"] if guard.get("risky") else answer


async def voting(ticket: str, n: int = 3) -> dict[str, Any]:
    """投票:同一个判断问 n 次,多数决,用于高风险的二元判断。"""
    q = f"根据工单内容判断:是否应该进入「退款核查」流程?只输出 JSON {{\"refund_review\": true/false}}\n\n{ticket}"
    votes = await asyncio.gather(*[allm_json(q) for _ in range(n)])
    tally = Counter(bool(v.get("refund_review")) for v in votes)
    decision, count = tally.most_common(1)[0]
    return {"refund_review": decision, "agreement": f"{count}/{n}", "unanimous": count == n}


async def main() -> None:
    print(await sectioning(TICKET))
    print(await voting(TICKET))


if __name__ == "__main__":
    asyncio.run(main())  # 两个放进同一个 asyncio.run,分两次跑会报 Event loop is closed
```

<div class="line-notes">

- `from collections import Counter` 计数器,喂一串值进去,它数每个值出现几次。投票就靠它。
- `async def sectioning(ticket: str) -> str:` 分段:回答和安全检查是两件独立的事,同时跑。
- `answer, guard = await asyncio.gather(` `gather` 同时启动括号里的几个协程,全部完成后按**传入的顺序**返回结果列表,再解包给 `answer`、`guard`。这次实跑安全检查用了 0.6 秒,回答用了 0.8 秒,两个同时跑,总共约 0.8 秒,不是 1.4 秒。
- `allm(ticket, system="你是云簿客服,简洁地回复这张工单。"),` 这次实跑返回:「陈先生您好,非常抱歉给您带来困扰。已核实订单 CL-20931 与 CL-20932 为重复扣款,多扣的 1188 元将在 1-3 个工作日内原路退回……」。注意它**承诺了 1-3 个工作日到账**,还说「已核实」,可它根本没查过系统。护栏只查威胁和越权,查不出这种乱承诺,这正是模式五用评审标准去抓的东西。
- `allm_json(f"这张工单里有没有人身威胁` 这次实跑返回 `{"risky": false, "reason": "工单内容为重复扣费投诉与退款诉求，并提及投诉维权，属于正常客户服务沟通；……"}`。「三天内没处理我就投诉」没有被误判成威胁。
- `return "【转人工】" + guard["reason"] if guard.get("risky") else answer` 条件表达式:有风险就丢掉回答、转人工;没风险就用回答。实测 `risky` 是 false,返回的是 answer。
- `async def voting(ticket: str, n: int = 3) -> dict[str, Any]:` 投票:同一个问题问 n 次。
- `votes = await asyncio.gather(*[allm_json(q) for _ in range(n)])` 列表推导式造出 3 个协程,`*` 把列表拆开传给 `gather`,等价于 `gather(allm_json(q), allm_json(q), allm_json(q))`。`_` 表示这个循环变量用不上。实测 3 次分别用了 0.4、0.5、0.5 秒,并发跑,结果都是 `{"refund_review": true}`。
- `tally = Counter(bool(v.get("refund_review")) for v in votes)` `bool(...)` 把缺字段的 None 也统一成 False。实测 `tally` 是 `Counter({True: 3})`。
- `decision, count = tally.most_common(1)[0]` `most_common(1)` 返回出现最多的那 1 个,形如 `[(True, 3)]`,`[0]` 取出元组再解包。实测 `decision=True, count=3`。
- `return {"refund_review": decision, "agreement": f"{count}/{n}", "unanimous": count == n}` 实测返回 `{'refund_review': True, 'agreement': '3/3', 'unanimous': True}`。三票一致,说明这张工单该不该走退款核查没有歧义。
- `async def main() -> None:` 把两个异步函数放进同一个协程里依次 `await`。
- `asyncio.run(main())  # 两个放进同一个 asyncio.run` `asyncio.run` 建一个事件循环、跑完 `main`、再关掉循环。整个脚本只调这一次。这次实跑两段加起来 1.3 秒。

</div>

`main()` 把两个函数放进同一次 `asyncio.run`。如果写成两行 `asyncio.run(sectioning(...))`、`asyncio.run(voting(...))`,第二次会报 `RuntimeError: Event loop is closed`,我实测过:`aclient` 是模块级的,它的连接池在第一次 `asyncio.run` 的事件循环里建立,第一次跑完那个循环就关了,第二次再复用旧连接就炸。规则是**一个脚本只调一次 `asyncio.run`,所有异步的事都在它里面做**。

分段的例子里,回答和安全检查同时发出,总耗时约等于两者中较慢的那个,而不是两者之和。安全检查发现风险时直接丢弃回答、转人工。把护栏和主任务分开,护栏的提示词可以专注、可以单独评测、可以单独迭代,这是文中特别推荐的做法。

投票的例子里,同一个判断问三次。三次一致说明模型对这个判断很有把握;二比一说明这张工单可能有歧义,值得人工看一眼。注意投票的成本是线性增加的,问三次就花三倍的钱,只用在出错代价高的判断上。另外如果你的模型 temperature 很低,三次结果可能几乎总是一样,投票就失去了意义,这时可以换几种不同的提示词措辞来投。

## 模式四:Orchestrator-workers(编排者-工作者)

是什么:一个编排者 LLM 动态地拆分任务,分派给多个工作者 LLM,最后综合结果。

什么时候用:你**无法预先知道**需要哪些子任务。这是它和并行模式的关键区别:并行模式的子任务是代码里写死的(回答 + 安全检查),编排模式的子任务是编排者根据具体输入决定的。文中的例子是编程产品里修改代码:要改哪几个文件、每个文件怎么改,取决于具体需求。

```python
# agent-60-lab/w2/wf4_orchestrator.py  模式四:编排者-工作者,子任务不是事先写死的,由编排者按输入决定
import asyncio
from typing import Any

from w2.wf_common import allm, llm, llm_json


def orchestrate(topic: str) -> str:
    plan = llm_json(
        f"你要为云簿 CloudLedger 帮助中心写一篇关于「{topic}」的文章。先决定需要哪几个小节(2-5 个),"
        "每节写清楚要讲什么。输出 JSON {\"sections\": [{\"title\": ..., \"brief\": ...}]}"
    )
    sections: list[dict[str, Any]] = plan["sections"]
    print("编排者决定写:", [s["title"] for s in sections])

    async def worker(s: dict[str, Any]) -> str:
        return await allm(f"写帮助中心文章的一个小节。\n小节标题:{s['title']}\n要点:{s['brief']}\n200 字以内,面向普通用户。")

    async def run_all() -> list[str]:
        return await asyncio.gather(*[worker(s) for s in sections])

    parts = asyncio.run(run_all())
    # 综合者:把各节拼起来,统一术语、去掉重复、补过渡
    draft = "\n\n".join(f"## {s['title']}\n{p}" for s, p in zip(sections, parts))
    return llm(f"下面是几位同事分别写的小节,请合成一篇连贯的帮助文章,统一用语,删除重复内容,保留小节标题:\n\n{draft}")


if __name__ == "__main__":
    print(orchestrate("被重复扣费怎么办"))
```

<div class="line-notes">

- `from w2.wf_common import allm, llm, llm_json` 编排和综合用同步的 `llm_json`/`llm`,工作者并发写各节用异步的 `allm`。
- `plan = llm_json(` 编排者:根据主题决定拆成几节、每节讲什么。这一步决定了后面有几个工作者。
- `f"你要为云簿 CloudLedger 帮助中心写一篇关于「{topic}」的文章。` 这次实跑 `topic` 是「被重复扣费怎么办」,用了 2.5 秒。
- `sections: list[dict[str, Any]] = plan["sections"]` 这里用 `[]` 而不是 `.get`:编排者没给 sections 就该直接报错,后面没法继续。这次实跑拆成了 5 节,每节是 `{"title": ..., "brief": ...}`。
- `print("编排者决定写:", [s["title"] for s in sections])` 这次实跑打印:<br>`['先确认是否真的被重复扣费', '在云簿内自助排查与处理', '提交申诉后会发生什么', '联系支付渠道与客服协同', '预防重复扣费的日常建议']`<br>五节是编排者看了主题以后自己定的,代码里没有写死。
- `async def worker(s: dict[str, Any]) -> str:` 函数里面定义函数,叫嵌套函数。`worker` 只在 `orchestrate` 内部用,放在里面不会污染模块。
- `return await allm(f"写帮助中心文章的一个小节。` 每个工作者只看得到自己那一节的标题和要点,看不到别的节。这次实跑五个工作者用时 1.0 到 1.3 秒,并发跑完。
- `async def run_all() -> list[str]:` 把五个 worker 一起交给 `gather`。
- `return await asyncio.gather(*[worker(s) for s in sections])` 返回顺序和 `sections` 顺序一致,不管谁先写完。这次实跑打印出来的完成顺序是「预防」「自助排查」「联系渠道」「先确认」「提交申诉」,和小节顺序完全不同,但 `parts` 还是按 1 到 5 节排好的。
- `parts = asyncio.run(run_all())` 在同步函数里跑一段异步代码。`orchestrate` 本身是普通函数,所以这里用 `asyncio.run` 包一下。
- `draft = "\n\n".join(f"## {s['title']}\n{p}" for s, p in zip(sections, parts))` `zip` 把标题列表和正文列表一对一配起来;每对拼成「## 标题\n正文」,再用空行连成一个大字符串。f-string 里用单引号 `s['title']`,因为外层是双引号。
- `return llm(f"下面是几位同事分别写的小节` 综合者,这次实跑 2.6 秒。它加了一个总标题「# 如何处理重复扣费：完整操作指南」,并把各节的「你」「您」统一成了「您」(工作者写「提交申诉后会发生什么」那节用的是「你」)。五节标题都保留了。整个流程 6.3 秒。

</div>

同样是「写一篇帮助文章」,主题是「重复扣费」时编排者可能拆成「确认扣费、申请退款、到账时间」三节,主题是「导出数据」时可能拆成完全不同的四节。这种「拆法取决于输入」就是这个模式存在的理由。

三个角色要分清:编排者负责拆,工作者负责做,综合者负责合。综合这一步经常被忽略,但它很重要。工作者是互相看不见的,会用不同的术语、写重复的内容,不综合就直接拼接,读起来像拼凑的。

这个模式离 agent 只有一步之遥。如果编排者不是一次性拆完,而是看到工作者的结果后继续决定下一步,它就变成了 agent。Anthropic 后来那篇《How we built our multi-agent research system》讲的就是这种升级版,Day 26 会读。

## 模式五:Evaluator-optimizer(评估者-优化者)

是什么:一个 LLM 生成,另一个 LLM 按标准评估并给出反馈,循环往复直到达标。

什么时候用:有清晰的评价标准,而且迭代改进确实能带来可衡量的提升。文中给了两个判断信号:人类给出反馈后,LLM 的输出能明显变好;LLM 自己也能给出这样的反馈。例子是文学翻译(评估者能指出原文的细微含义没翻出来),以及需要多轮搜索分析的复杂检索任务。

```python
# agent-60-lab/w2/wf5_evaluator.py  模式五:评估者-优化者,一个写,一个按标准挑刺,循环到达标
from typing import Any

from w2.wf_common import TICKET, llm, llm_json

RUBRIC = """评审标准(全部满足才算 PASS):
1. 明确复述了客户的问题和订单号
2. 没有承诺具体的退款到账日期或金额以外的补偿
3. 给出了清晰的下一步(客户需要做什么 / 我们会做什么)
4. 语气诚恳,不推卸,不超过 200 字"""


def evaluate_optimize(ticket: str, max_rounds: int = 3) -> tuple[str, list[dict[str, Any]]]:
    history: list[dict[str, Any]] = []
    reply = llm(f"你是云簿客服,回复这张工单:\n{ticket}")
    for i in range(max_rounds):
        review = llm_json(
            f"{RUBRIC}\n\n工单:\n{ticket}\n\n待评审的回复:\n{reply}\n\n"
            "逐条检查,输出 JSON {\"verdict\": \"PASS\" 或 \"FAIL\", \"problems\": [\"...\"]}"
        )
        history.append({"round": i + 1, "verdict": review.get("verdict"), "problems": review.get("problems", [])})
        if review.get("verdict") == "PASS":
            break
        reply = llm(f"根据评审意见修改回复。\n工单:\n{ticket}\n\n原回复:\n{reply}\n\n评审意见:{review.get('problems')}\n\n只输出修改后的回复。")
    return reply, history


if __name__ == "__main__":
    final, log = evaluate_optimize(TICKET)
    print(log)
    print(final)
```

<div class="line-notes">

- `RUBRIC = """评审标准` 四条能逐条核对的标准。评估者的严不严、准不准,几乎全看这段写得好不好。
- `def evaluate_optimize(ticket: str, max_rounds: int = 3) -> tuple[str, list[dict[str, Any]]]:` 返回两样东西:最终回复,和每一轮的评审记录。`tuple[A, B]` 表示返回一个二元组。
- `history: list[dict[str, Any]] = []` 每轮评审结果存一条,方便事后看它是怎么改过来的。
- `reply = llm(f"你是云簿客服,回复这张工单:\n{ticket}")` 第一稿,只给了身份,没给任何要求。这次实跑 2.3 秒,写了 400 多字,还承诺「24 小时内先向您反馈初步核查结果」「通常 1-7 个工作日」到账。
- `for i in range(max_rounds):` 最多评 3 轮,`i` 是 0、1、2。
- `review = llm_json(` 评估者:拿标准、工单、待评回复,逐条检查。
- `"逐条检查,输出 JSON {\"verdict\": \"PASS\" 或 \"FAIL\", \"problems\": [\"...\"]}"` 要求给 verdict 和问题清单,代码才能判断要不要继续。
- `history.append({"round": i + 1, "verdict": review.get("verdict"), "problems": review.get("problems", [])})` `i + 1` 让轮次从 1 开始数。这次实跑三轮的记录:<br>第 1 轮 `FAIL`:字数约 400 超了 200;承诺 24 小时反馈;给了 1-7 个工作日的到账范围。<br>第 2 轮 `FAIL`:约 230 字还是超;「提供卡尾号」和「仅凭订单号也会先查」并存,客户不知道要不要动手。<br>第 3 轮 `PASS`,problems 是 `[]`。
- `if review.get("verdict") == "PASS":` 达标就停,不再改。第 3 轮在这里 break。
- `reply = llm(f"根据评审意见修改回复。` 优化者:带着原稿和问题清单重写。`{review.get('problems')}` 直接把问题列表塞进提示词。第 1 轮后改到约 230 字,删掉了 24 小时承诺和到账天数;第 2 轮后再删掉「提供卡尾号」那段,改成「请您暂无需其他操作」。
- `return reply, history` 返回二元组,调用方用 `final, log = ...` 解包。
- `final, log = evaluate_optimize(TICKET)` 这次实跑三轮一共 6 次调用,7.6 秒。最终稿:「陈先生您好，非常抱歉给您带来困扰。您反馈的9月28日续费专业版被扣款两次、每笔1188元（订单号CL-20931、CL-20932）……到账时间以银行处理为准。……请您暂无需其他操作，也无需重复提交工单，我会全程跟进此单。感谢您的耐心。」
- `print(log)` 打印每轮的 verdict 和 problems,就是上面那三条记录。看它就知道每一轮改了什么、为什么改。

</div>

这个模式的效果几乎完全取决于 `RUBRIC` 写得好不好。「回复要好」这种标准等于没有标准,评估者会随便给 PASS。我把标准写成四条可以逐一核对的规则,而且每条都是客服主管真的会在意的点。Day 32 讲 LLM-as-judge 时,你会系统地学怎么写这种评分标准,以及怎么验证评估者本身靠不靠谱。

一定要有轮数上限。评估者有时会在两个版本之间来回挑刺,永远不给 PASS。三轮还过不了,通常说明标准本身有矛盾,或者任务超出了模型能力,该停下来让人看。

### 评估者最好不是模型:用外部反馈做 reflection

上面那个评估者也是一个 LLM。它挑出了字数超标和乱承诺,但你得承认,它说 PASS 的时候你心里还是有点虚:同一类模型给同一类模型打分,它漏掉的东西,优化者多半也意识不到。这类「生成完让模型自己反思一下再改」的做法,学术界叫 reflection(Reflexion、Self-Refine 这几篇论文都是这个思路)。后来大家在实践里发现,真正让反思管用的是反馈从哪来。模型自评只能发现它本来就知道的错;编译器报错、单元测试失败、SQL 执行结果、API 返回的 400,这些是**外部反馈**,它们不会客气,也不会和生成者犯同一种错。

所以只要任务有能执行的东西,评估者那一格就优先放「真的去跑一下」。写代码就跑测试,写 SQL 就在只读库上执行,调接口就看返回码,填表就用 pydantic 校验。模型评审留给没法执行的部分,比如语气、有没有乱承诺。

下面是一个能直接跑的小例子。表里的开票日期是从老系统导过来的 `2026/09/28` 这种斜杠格式,表结构注释里没说清楚,这在真实业务库里太常见了。模型第一次写 SQL 基本都会按 ISO 格式去过滤 9 月,语法完全正确,但结果是空的。模型自己读这条 SQL 是看不出问题的,得让数据库告诉它。

```python
# agent-60-lab/w2/wf5b_sql_feedback.py  评估者换成「真的去执行」:让数据库来挑刺
import sqlite3

from w2.wf_common import llm

SCHEMA = """CREATE TABLE invoices (
  id TEXT PRIMARY KEY, customer_id TEXT, amount_cents INTEGER,
  status TEXT,          -- 'paid' / 'open' / 'void'
  issued_at TEXT        -- 开票日期(老系统导过来的字符串)
);"""
ROWS = [
    ("INV-1", "C001", 118800, "paid", "2026/09/28"),
    ("INV-2", "C001", 118800, "paid", "2026/09/28"),
    ("INV-3", "C002", 9900, "open", "2026/09/30"),
    ("INV-4", "C003", 9900, "void", "2026/10/02"),
]
QUESTION = "9 月份每个客户已付款的总金额(元),按金额从高到低"


def make_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.execute(SCHEMA)
    conn.executemany("INSERT INTO invoices VALUES (?,?,?,?,?)", ROWS)
    return conn


def check(conn: sqlite3.Connection, sql: str) -> str | None:
    """返回 None 表示通过,否则返回一段给模型看的报错。"""
    try:
        rows = conn.execute(sql).fetchall()
    except sqlite3.Error as e:
        return f"SQL 执行报错:{e}"
    if not rows:
        sample = conn.execute("SELECT DISTINCT status, issued_at FROM invoices LIMIT 3").fetchall()
        return f"SQL 能执行,但结果是空的。表里真实的 (status, issued_at) 长这样:{sample}"
    if any(isinstance(v, int) and v > 100000 for row in rows for v in row):
        return f"结果里有 {rows[0]} 这样的大整数,amount_cents 是分,题目要元。"
    return None


def sql_with_feedback(max_rounds: int = 3) -> tuple[str, list[str]]:
    conn = make_db()
    feedback: list[str] = []
    prompt = f"表结构:\n{SCHEMA}\n\n问题:{QUESTION}\n只输出一条 SQLite SQL,不要解释,不要代码块。"
    sql = llm(prompt).strip().strip("`")
    for _ in range(max_rounds):
        problem = check(conn, sql)
        if problem is None:
            break
        feedback.append(problem)
        sql = llm(f"{prompt}\n\n你上一次写的是:\n{sql}\n\n执行结果反馈:{problem}\n改正后只输出 SQL。").strip().strip("`")
    print(conn.execute(sql).fetchall())
    return sql, feedback


if __name__ == "__main__":
    final_sql, log = sql_with_feedback()
    print(log)
    print(final_sql)
```

<div class="line-notes">

- `issued_at TEXT        -- 开票日期(老系统导过来的字符串)` 故意只写「字符串」不写格式。真实业务库里列注释经常就这么含糊,模型只能猜。
- `("INV-1", "C001", 118800, "paid", "2026/09/28"),` 金额存的是分,118800 分 = 1188 元;日期是斜杠格式。C001 被扣了两笔 1188,对应前面工单里的重复扣款。
- `QUESTION = "9 月份每个客户已付款的总金额(元),按金额从高到低"` 正确答案只有一行:`('C001', 2376.0)`。C002 是 open,C003 是 void,而且日期在 10 月。
- `conn = sqlite3.connect(":memory:")` 内存库,跑完就没了,不用准备任何文件。
- `def check(conn: sqlite3.Connection, sql: str) -> str | None:` 这就是外部评估者,一行模型调用都没有。返回 `None` 表示通过,返回字符串就是要喂回给模型的反馈。
- `rows = conn.execute(sql).fetchall()` 真的执行。语法错、列名写错会在这里抛 `sqlite3.Error`。
- `return f"SQL 执行报错:{e}"` 把数据库的原始报错原样交给模型,比如 `no such column: amount`,这种信息模型自己是想不出来的。
- `if not rows:` 能执行但查不到东西,这是最隐蔽的一种错。我实跑的几次里,第一稿全部落在这里,模型写的是 `issued_at >= '2026-09-01'` 或 `LIKE '%-09-%'`。
- `sample = conn.execute("SELECT DISTINCT status, issued_at FROM invoices LIMIT 3").fetchall()` 关键一行:不光说「空了」,还把表里真实的值拿给模型看。实跑时它拿到的是 `[('paid', '2026/09/28'), ('open', '2026/09/30'), ('void', '2026/10/02')]`。
- `if any(isinstance(v, int) and v > 100000 for row in rows for v in row):` 第二道检查:结果里出现很大的整数,多半是忘了把分换成元。这是针对这张表的业务规则,换张表要换规则。
- `sql = llm(prompt).strip()` 第一稿。后面那个 `` strip("`") `` 是防模型不听话给 SQL 包了反引号。
- `for _ in range(max_rounds):` 和模式五一样要有上限,3 轮。
- `feedback.append(problem)` 记下每次反馈,事后能看它是被什么纠正过来的。
- `sql = llm(f"{prompt}\n\n你上一次写的是:` 把上一稿和执行反馈一起给回去重写。这一步和模式五里的优化者是同一个角色,区别只在反馈来自数据库。
- `print(conn.execute(sql).fetchall())` 打印最终结果。实跑 5 次都是 `[('C001', 2376.0)]`。
- `print(log)` 5 次里有 4 次 log 只有一条反馈(第二稿就对了),1 次有两条。每次总耗时 2.7 到 3 秒左右。

</div>

我在 DeepSeek `deepseek-flash` 上做了一个对照,很能说明问题。第一个版本的 `check` 在结果为空时只返回一句「结果是空的,检查过滤条件(日期格式、status 取值)」,不带样例数据。跑 3 次,只有 1 次改对了(它猜到用 `substr(issued_at, 6, 2) = '09'`);另外 2 次三轮用完还是空,其中一次越改越离谱,写出了八个 `LIKE '%-09-%'` 变体 OR 在一起,一直在猜横杠格式。换成上面这个带样例值的版本,跑 5 次全部改对,改法是 `replace(issued_at, '/', '-')` 或 `LIKE '%/09/%'`。

这个对照想说的是,外部反馈管用的前提是它带着证据。「不对,再想想」这种反馈和模型自评差不多,模型只能继续猜;「报错原文 + 真实数据长什么样」才能让它改到点子上。你在 Day 12 写工具报错时其实已经做过同样的事:错误信息要写成模型能照着改的样子。

真实项目里一般两种评估者叠着用:能执行的先执行,执行通过了再让模型评审看执行不了的那部分。Day 55 的代码审查 Agent 和专题篇 Day 138 的问数 Agent 都会用到这个结构。

## 什么时候才需要真正的 Agent

五种 workflow 讲完,回到 agent。文中对 agent 的描述是:它从用户的指令或对话开始,任务明确后自主规划和执行,过程中可能需要回到人那里获取信息或判断;每一步都从环境获取「真实反馈」(工具结果、代码执行结果)来评估进展;可以在检查点或遇到阻碍时停下来等人;通常有停止条件,比如最大迭代次数。你会发现这正是 Day 9 到 Day 12 我们一路写下来的东西。

适用场景是**开放式问题**:很难甚至不可能预测需要多少步,也没法把路径写死。同时你要对模型的决策有一定信任,因为它会自主运行很多轮。文中特别提醒:agent 的自主性意味着更高的成本和错误累积的风险,建议在沙箱环境里充分测试,并配上合适的护栏。

给你一个我自己用的判断清单,拿到需求时依次问:

1. 一次调用加检索和示例能不能解决?能就停。
2. 步骤是否固定?固定就用提示链,步骤间加关卡。
3. 输入是否有明显不同的类别?有就先路由。
4. 有没有可以同时做的独立子任务,或者需要多次判断提高可信度?用并行。
5. 子任务是否要根据输入动态决定?用编排者-工作者。
6. 有没有清晰的评价标准、且迭代确实能提升?用评估者-优化者。
7. 以上都不行,步数和路径都无法预知?这时才考虑 agent。

这些模式可以组合。一个真实的客服系统往往是:路由在最外层,计费分支里是一条提示链,提示链的最后一步是评估者-优化者,只有「复杂排查」这个分支才是一个 agent。毕业项目的架构基本就是这样。

## 关于框架,以及 ACI

文章对框架的态度很值得一说。它提到 LangGraph、Amazon Bedrock 的 AI Agent 框架、Rivet、Vellum 等工具能帮你快速上手,但也指出框架会增加抽象层,让底层的提示词和响应变得不透明,难以调试,还会诱使你在简单方案就够的时候增加复杂度。建议是**先直接用 LLM API**,很多模式几行代码就能实现;如果用框架,一定要理解底层在做什么,对底层的错误假设是客户常见的错误来源。这也是本课程前两周坚持手写的原因,W4 学 LangGraph 时你会知道它替你做了什么。

附录里还有一个概念叫 ACI,agent-computer interface,对应人机交互里的 HCI。意思是:你在人机界面上投入多少心思,就应该在模型和工具的接口上投入多少心思。他们举了一个自己的例子:做 SWE-bench 的 agent 时,花在优化工具上的时间比优化整体提示词还多;发现模型用相对路径时容易出错,就把工具改成必须用绝对路径,问题就消失了。这和 Day 11 是同一个道理:与其教模型适应工具,不如改工具来适应模型。

## 动手练习

**练习 1:五种模式各跑一遍。** 按顺序运行 `wf1` 到 `wf5`,每个都把输出存下来。对 `wf3` 的投票,改用一张有歧义的工单(比如「我想取消订阅,但不确定还能不能退」),看投票结果是否出现分歧。

**练习 2:提示链的关卡。** 把工单里的订单号删掉,确认提示链在第一步之后就转人工,没有走到起草。然后再加一个关卡:如果抽出的 `amount` 大于 5000,也转人工(大额退款需要主管)。

**练习 3:路由准不准。** 自己写 20 张工单,计费、技术、账号、其他各 5 张,跑路由,统计准确率。分别用大模型和小模型做分类,填表(空表,填你的实测):

| 分类模型 | 准确率(20 张) | 平均耗时 | 分错的工单类型 |
| --- | --- | --- | --- |
| 大模型 | | | |
| 小模型 | | | |

**练习 4:组合。** 把路由、提示链、评估者-优化者组合起来:先路由,计费类走「抽取 → 关卡 → 起草 → 评估优化」,其他类直接用对应的专员提示词回复。这就是 W4 工单分流 agent 的雏形。

**练习 5:说服自己。** 回到 Day 9 的「读 cities.txt 查天气算平均气温」任务,用今天的某种 workflow 重写它(提示:步骤是固定的)。比较和 agent 版本的步数、token、稳定性,写三句话的结论。

**验收标准:** 五种模式都能跑通;练习 2 两个关卡都生效;练习 3 表格填满,能说出小模型是否够用;练习 4 能对计费类和非计费类工单走出不同路径;练习 5 有结论,并能说出这个任务用 agent 是不是过度设计。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Workflow | LLM 和工具按预先写好的代码路径编排的系统 |
| Agent | LLM 动态决定自己流程和工具使用的系统 |
| Agentic system | workflow 和 agent 的统称 |
| 增强型 LLM(augmented LLM) | 配备检索、工具、记忆的模型,是所有模式的基本构件 |
| Prompt chaining | 固定步骤串联,前一步输出作为后一步输入 |
| Gate(关卡) | 提示链步骤之间的代码检查,不通过就终止或转向 |
| Routing | 先分类再分发到专门分支 |
| Sectioning / Voting | 并行的两种变体:拆成独立子任务 / 同一任务多次投票 |
| Orchestrator-workers | 编排者动态拆分任务,工作者执行,最后综合 |
| Evaluator-optimizer | 一个生成、一个按标准评估反馈,循环到达标 |
| ACI | agent-computer interface,模型与工具之间的接口设计 |
| Rubric | 评估标准,最好是可以逐条核对的具体规则 |
| Reflection | 让模型看自己的输出和反馈后再改一版,Reflexion、Self-Refine 是代表论文 |
| 外部反馈 | 来自模型之外的检查结果:编译器、测试、数据库执行、接口返回码,比模型自评可靠 |

## 常见误区

**什么都做成 agent。** agent 更贵、更慢、更难测试。步骤固定的流程用 workflow,稳定性和成本都好得多。面试官很喜欢问「这个场景你为什么用 agent」,答不出理由是减分项。

**把 workflow 当成「不够高级」。** 生产环境里大部分可靠的 LLM 应用都是 workflow。能用简单方案解决问题,恰恰说明你懂行。

**提示链拆得太细。** 每多一步就多一次调用的延迟和成本。拆分的依据是「这一步能否被独立检查或独立优化」,不是越碎越好。

**路由没有出口。** 置信度低或类别不明时硬塞进某个分支,结果比转人工更糟。

**评估者没有具体标准。** 「回复要好」这种标准下,评估者几乎总会给 PASS,整个循环形同虚设。标准要写成可逐条核对的规则。

**评估者-优化者不设轮数上限。** 评估者可能永远不满意,循环永远不停。三轮左右封顶,过不了就转人工。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):今天的主线,通读全文包括两个附录,对照今天的五个代码文件,1.5 小时。
- [claude-cookbooks · basic_workflows.ipynb](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/basic_workflows.ipynb):Anthropic 官方的提示链、并行、路由参考实现,和文章配套,40 分钟。
- [claude-cookbooks · orchestrator_workers.ipynb](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/orchestrator_workers.ipynb) 和 [evaluator_optimizer.ipynb](https://github.com/anthropics/claude-cookbooks/blob/main/patterns/agents/evaluator_optimizer.ipynb):另外两种模式的官方实现,40 分钟。
- [OpenAI · A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf):OpenAI 版本的 agent 构建指南(PDF),看它讲「什么时候该构建 agent」和单 agent / 多 agent 编排的部分,和 Anthropic 的观点对照,1 小时。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1FAWGzVEWF&autoplay=0&high_quality=1" title="Anthropic构建高效agent的第一性原理:精读《Building effective agents》①" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · Anthropic构建高效agent的第一性原理:精读《Building effective agents》① · 11 分钟,这是一个系列,UP 主逐节精读这篇文章。先看第 1 集建立框架。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wcvCBLEQ8&autoplay=0&high_quality=1" title="agentic Workflow 选型全景:建立选型的快速判断直觉|精读《Building Effective Agents》⑨" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · agentic Workflow 选型全景:建立选型的快速判断直觉|精读《Building Effective Agents》⑨ · 8 分钟,同一系列的选型总结,和今天的判断清单对照看。</figcaption>
</figure>

- 同系列的《Workflow模式之:Prompt Chaining》(BV1c5qDBiEsS,7 分钟)和《Workflow 模式之:协调器—工作器模式》(BV1PWBYB8Eii,4 分钟):对应模式一和模式四,做练习时卡住了看。
- 吴恩达《Agentic AI》中英双语搬运(BV1aaxyz8ELY)第 8 P「智能体设计模式」:吴恩达的四模式分类(反思、工具、规划、多智能体),和 Anthropic 的五模式是不同切法,对照着理解,7 分钟。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents: Barry Zhang, Anthropic · 文章作者之一在 AI Engineer 大会上的演讲,讲三个观点:不要什么都做成 agent、保持简单、站在 agent 的视角思考。</figcaption>
</figure>

- Dave Ebbelaar《How to Build Effective AI Agents (without the hype)》(YouTube `tx5OapbK-8A`):用纯 Python 把文中的模式实现一遍,和今天的代码可以互相对照。
- Anthropic《Building more effective AI agents》(YouTube `uhJJgc-0iTQ`):Anthropic 官方频道的后续讨论,讲文章发布后他们观察到的新变化。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 部分,以及全书最后一章「AI Engineering Architecture and User Feedback」里逐步给系统加组件的思路(配套仓库目录里的「Step 5. Add Agent Patterns」),和「先简单后复杂」的原则一致。
- Antonio Gulli《Agentic Design Patterns: A Hands-On Guide to Building Intelligent Systems》(Springer, 2025):Google 工程师写的 21 种 agent 设计模式,一种一章并配代码。今天读 Prompt Chaining、Routing、Parallelization、Reflection 四章,和五种 workflow 一一对应。

### 开源项目与代码

- [anthropics/claude-cookbooks · patterns/agents](https://github.com/anthropics/claude-cookbooks/tree/main/patterns/agents):上面三个 notebook 所在目录,建议整个目录收藏。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):第六章「框架开发实践」可以先翻一下,看 AutoGen、AgentScope、LangGraph 分别怎么实现这些模式,为 W4 做准备。

## 自测

1. (面试题)「什么时候不该用 Agent?什么时候不该用框架?」

<details><summary>答案</summary>

不该用 Agent:步骤固定、路径可预测(用 workflow 写死更稳更便宜);一次调用加检索和示例就能解决;出错代价高又没有可靠的验证手段;对延迟和成本很敏感。只有开放式、步数无法预知的任务才值得用 Agent。

不该用框架:逻辑只是几次模型调用或一个简单循环,直接用 API 几十行就能写完;你需要完全掌控重试、预算、上下文组装,而框架把这些藏在抽象层后面、出了问题难调试;团队还不理解底层在做什么。适合用框架的情况是确实需要它的重型能力,比如状态持久化、中断恢复、人工审批节点、可视化调试,并且你清楚它底层的提示词和调用长什么样。回答时最好举自己的例子:「这个场景我先手写,后来因为需要 checkpoint 才换成 LangGraph」。

</details>

2. 并行模式和编排者-工作者模式都会同时跑多个子任务,区别是什么?

<details><summary>答案</summary>

并行模式的子任务是代码里预先写死的(比如固定是「回答 + 安全检查」);编排者-工作者模式的子任务是编排者根据具体输入动态决定的,事先不知道会拆成几个、拆成什么。

</details>

3. 提示链相比「一个大提示词完成所有步骤」,除了让每步更简单,还有什么好处?

<details><summary>答案</summary>

在步骤之间获得了用代码检查和控制流程的机会(关卡),比如没有订单号就提前转人工;每一步可以单独测试、单独优化、单独换模型;出错时能定位到具体哪一步。

</details>

4. 什么情况下评估者-优化者模式会失效?

<details><summary>答案</summary>

评价标准模糊(评估者总给 PASS,循环形同虚设);评价标准之间有矛盾(永远过不了);模型本身能力不足,反馈后也改不好;没有轮数上限导致无限循环和成本失控。

</details>

5. (面试题)「给你一个需求:每天把 200 张客服工单分类、抽取关键信息、起草回复,由人工审核后发出。你会设计成 agent 吗?」

<details><summary>答案</summary>

不会,这是典型的 workflow。步骤固定(分类、抽取、起草),路径可预测,用路由加提示链即可:先路由到不同类型的处理分支,每个分支是「抽取 → 关卡检查 → 起草 → 评估者检查」的链。分类可以用小模型降成本,高风险判断(是否退款)可以投票。只有遇到需要多步排查、步数不可预知的工单类型,才在那个分支里用 agent,或者直接转人工。这样更便宜、更稳定、更容易评测。

</details>

6. Anthropic 说的 ACI 是什么?举一个例子。

<details><summary>答案</summary>

Agent-computer interface,模型和工具之间的接口,类比人机交互的 HCI,强调要像设计用户界面一样用心设计工具接口。例子:Anthropic 做 SWE-bench agent 时发现模型用相对路径容易出错,就把工具改成必须使用绝对路径,问题随之消失。核心思想是改工具去适应模型,而不是让模型适应工具。

</details>

7. 让模型写 SQL 后「自己检查一遍再改」,和「拿去只读库执行、把结果反馈给它」,哪个更可靠?反馈里应该放什么?

<details><summary>答案</summary>

执行更可靠。模型自评只能发现它本来就知道的错,而 SQL 语法正确但过滤条件和真实数据对不上(比如日期格式不同)这种错,读代码是看不出来的。反馈里要带证据:数据库的原始报错;结果为空时附上表里真实的几行样例值;结果明显不合理时说清楚哪一条业务规则被违反(比如金额单位是分)。只说「不对,再试试」的反馈,模型只能继续猜。

</details>

## 明天预告

明天(Day 14)是 W2 的复习日:把这一周的知识画成一张图,汇总 W2 的面试题,然后完成本周小项目,**一个能查天气、算数、读文件、搜网页的命令行 Agent**。它会用上 Day 9 的循环、Day 11 的工具设计、Day 12 的全部防线,是你可以放进 GitHub 的第一个像样作品。
