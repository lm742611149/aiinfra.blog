---
title: 'Day 684 · BillSleuth(五):流程为什么拆段,模型对象和 MCP 桥接'
description: '工具层有了,开始接模型。先想清楚调查流程为什么要拆成 intake、locate、investigate、conclude 几段;再写两个地基模块:llm.py 里的模型对象(顺手实测开着思考做结构化输出会 400),mcp_bridge.py 里的同步桥接(实测 asyncio.run 在事件循环里会炸、stdio 每次调用 1.5 秒)。最后用桥接拼一个不拆段的大循环,真跑 3 个场景,看它把时间花在哪。'
pubDate: 2026-10-22
regime: none
tags: ['billsleuth', 'mcp', 'langgraph', 'asyncio', 'agent-zero']
series: 'agent-zero'
day: 684
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 683](/blog/agent-zero/day-683-bs-tools/) 给 BillSleuth 写了 MCP 工具层:6 个只读工具、1 个调参考引擎逐类对比的 `recompute_invoice`、1 个只写草稿而且重复调用不重复创建的 `draft_credit_note`,每次调用都写审计日志。最后用内存客户端写了可解性测试,证明 100 个场景每个都能用这些工具算出标准答案。

工具是给模型用的,可到现在为止一行模型代码都没有。今天开始接模型,但还不急着写调查图。先回答一个设计问题:调查流程是一个大循环让模型从头查到尾,还是拆成几段?然后写两个地基模块,一个负责「怎么拿到模型」,一个负责「同步代码怎么调异步的 MCP 工具」。最后拿这两个模块拼一个不拆段的大循环,用真模型跑几个场景,让数据替我们回答开头那个问题。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出 BillSleuth 调查流程拆成哪几段、每段是调模型还是只跑代码,以及为什么拆,并能拿今天实跑的大循环数据举例。
2. 写出 `billsleuth/llm.py`:`get_llm()` 读 `.env` 造模型对象,`estimate_cost()` 粗算花费;能解释为什么 `.env` 里要关掉 DeepSeek 的思考模式(今天会实测一次 400)。
3. 写出 `billsleuth/mcp_bridge.py`:`BillingMCP` 把 MCP 工具清单转成模型认识的 tools 格式,把调用结果拆成 `(是否成功, 数据)`;能讲清楚 `_run` 为什么要分「外面有没有事件循环」两种情况。
4. 写 7 条桥接测试,全部通过。

预计用时 3 小时。前置:[Day 683](/blog/agent-zero/day-683-bs-tools/)(`server.py`、`billing.db`、`scenarios/`)、[Day 196](/blog/agent-zero/day-196-workflow-vs-agent/)(workflow 和 agent 的区别)、[Day 311](/blog/agent-zero/day-311-lg-agent-loop/)(用图写 Agent 循环)、[Day 320](/blog/agent-zero/day-320-lg-refund-approval/)(`get_llm` 的写法)、[Day 67](/blog/agent-zero/day-067-async-2/)(`async def`、`await`、`asyncio.run`)、[Day 287](/blog/agent-zero/day-287-mcp-test/)(内存客户端)。今天调真模型,实跑一共花了约 ¥0.16,算式在文末。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `_run` 和 `BillingMCP.call` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 概念一:调查流程为什么要拆段

先回忆一下客服小王是怎么查账的。客户在工单里写「8 月这张发票金额 1438.44,我们财务对不上账」。小王第一件事是读懂这句话:客户在抱怨金额不对,提到了 8 月和 1438.44 这个数。第二件事是打开后台,在这个客户的发票列表里找到总额 1438.44 的那张。这两步不需要任何判断力,换谁来做结果都一样。第三步才是真正的调查:这张发票哪里不对?是折算算错了,还是税率用错了?他会先猜一个,查一下,不对再换一个。最后,他在工单系统里填一个结论:根因选「时区导致改套餐日期算错」、发票号、多收 26.02、建议开贷记单。

把这四步原样搬进 Agent,就是 BillSleuth 的调查流程:

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="BillSleuth 调查流程拆成四段:intake 调模型读懂原话,locate 纯代码找候选发票,investigate 和 tools 是唯一的开放循环,conclude 纯代码校验结论">
  <rect x="0" y="0" width="640" height="320" fill="var(--paper-raised)" rx="6"/>
  <defs><marker id="a684" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="40" width="112" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="72" y="62" text-anchor="middle" font-size="12" fill="var(--mem)">intake</text>
    <text x="72" y="82" text-anchor="middle" fill="var(--mem)">读懂原话</text>
    <line x1="128" y1="68" x2="160" y2="68" stroke="var(--ink-soft)" marker-end="url(#a684)"/>
    <rect x="162" y="40" width="112" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="218" y="62" text-anchor="middle" font-size="12" fill="var(--compute)">locate</text>
    <text x="218" y="82" text-anchor="middle" fill="var(--compute)">代码找发票</text>
    <line x1="274" y1="68" x2="306" y2="68" stroke="var(--ink-soft)" marker-end="url(#a684)"/>
    <rect x="308" y="40" width="140" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="378" y="62" text-anchor="middle" font-size="12" fill="var(--mem)">investigate</text>
    <text x="378" y="82" text-anchor="middle" fill="var(--mem)">假设 → 选工具</text>
    <line x1="360" y1="96" x2="360" y2="146" stroke="var(--compute)" marker-end="url(#a684)"/>
    <line x1="396" y1="146" x2="396" y2="96" stroke="var(--compute)" marker-end="url(#a684)"/>
    <rect x="308" y="148" width="140" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="378" y="170" text-anchor="middle" font-size="12" fill="var(--compute)">tools</text>
    <text x="378" y="188" text-anchor="middle" fill="var(--compute)">经桥接调 MCP</text>
    <line x1="448" y1="68" x2="490" y2="68" stroke="var(--ink-soft)" marker-end="url(#a684)"/>
    <rect x="492" y="40" width="132" height="56" rx="4" fill="none" stroke="var(--ink)"/>
    <text x="558" y="62" text-anchor="middle" font-size="12" fill="var(--ink)">conclude</text>
    <text x="558" y="82" text-anchor="middle" fill="var(--ink-soft)">校验结论</text>
    <text x="72" y="122" text-anchor="middle" fill="var(--ink-faint)">1 次模型</text>
    <text x="218" y="122" text-anchor="middle" fill="var(--ink-faint)">0 次模型</text>
    <text x="558" y="122" text-anchor="middle" fill="var(--ink-faint)">0 次模型</text>
    <text x="378" y="218" text-anchor="middle" fill="var(--ink-faint)">唯一不知道要转几圈的地方</text>
    <rect x="16" y="240" width="608" height="64" rx="4" fill="none" stroke="var(--rule)"/>
    <text x="30" y="262" fill="var(--ink)">今天写的两块地基</text>
    <text x="30" y="284" fill="var(--mem)">llm.py:蓝色节点从这里拿模型</text>
    <text x="330" y="284" fill="var(--compute)">mcp_bridge.py:琥珀色节点从这里调工具</text>
  </g>
</svg>
<figcaption>蓝色节点调模型,琥珀色节点只跑代码(locate 和 tools 都会调 MCP 工具,但不调模型)。今天只写最下面框里的两个模块,图本身留到 Day 686。</figcaption>
</figure>

**intake** 只做一件事:把客户原话拆成三个字段,抱怨类型、提到的金额、提到的月份。这一步要理解自然语言,得用模型,而且要用结构化输出([Day 147](/blog/agent-zero/day-147-structured-1/) 起学过),因为下一步的代码要读这几个字段。

**locate** 是纯代码。拿 intake 抽出来的金额,在 `list_invoices` 的结果里精确匹配;匹配不到就按月份找;都没有就取最新一张。这就是一个数组里按条件找元素的问题,前端同学写过一万遍的 `invoices.filter(i => i.total === amount)`。

**investigate ⇄ tools** 是整个流程里唯一开放的部分,也是它配叫 Agent 的原因:模型提出假设,选工具验证,看结果,再决定下一步。转几圈事先不知道。

**conclude** 又是纯代码:把模型交上来的结论按 schema 校验一遍,格式不对就转人工。

[Day 196](/blog/agent-zero/day-196-workflow-vs-agent/) 讲过 Anthropic 那篇《Building effective agents》里的两个定义:workflow 是「代码预先写好路径,模型在路径上的某几步干活」;agent 是「模型自己决定下一步做什么」。BillSleuth 是两者的混合:前后两段是 workflow,中间一段是 agent。我做过的几个业务 Agent 都是这个形状,真正让模型从头到尾自己决定的很少。

为什么不干脆一个大循环?我能想到四个理由,下面最后一节会拿真实数据一条条核对:

第一,**确定的步骤不需要每次都让模型来做**。找发票这件事,模型每次都要花一轮去调 `list_invoices`,再读完整个列表。每一轮都是一次完整的模型调用,输入里带着系统提示和全部历史,几千 token。

第二,**结论要能被程序读**。大循环最后吐出来的是一段文字,我们后面要拿它和 `scenarios/` 里的标准答案逐字段比(根因、发票号、多收金额),文字没法可靠地比。

第三,**每段都能单独测**。locate 是纯函数,给一个发票列表和一个金额,输出候选发票,写单元测试不花一分钱。大循环只能端到端地测,每测一次都要调模型。

第四,**出了问题容易定位**。结论错了,是 intake 把金额抽错了,还是 locate 找错了发票,还是调查时漏查了?拆开以后,每一段的输入输出都在状态里,一眼能看出来。

这四条听起来都对,但目前只是道理。写完今天的两个模块,我们就能用最少的代码拼出一个不拆段的版本,真跑一次看看。

## 第一步:模型对象 llm.py

先装今天要用的两个库。在 `billsleuth/` 仓库根目录(就是有 `pyproject.toml` 的那一层)执行:

```bash
uv add langgraph==1.2.16 langchain-openai==1.7.2
```

<div class="line-notes">

- `uv add langgraph==1.2.16 langchain-openai==1.7.2` 2026 年 10 月查 PyPI:langgraph 最新 1.2.16(10 月 16 日),langchain-openai 最新 1.7.2(10 月 14 日)。钉死版本号,和 Day 683 钉 `mcp==2.3.0` 一个道理,相当于 `npm install langgraph@1.2.16`。`openai` 和 `python-dotenv` 在 [Day 679](/blog/agent-zero/day-679-bs-prd/) 已经装过,langchain-openai 会顺带装上 `langchain-core`(我这里是 1.6.13)。

</div>

`.env` 是 Day 679 从 `agent-zero-lab` 复制过来的,里面有 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_EXTRA_BODY` 和 `LLM_PRICE` 五行。新建 `billsleuth/llm.py`:

```python
# billsleuth/billsleuth/llm.py  模型对象:走 OpenAI 兼容协议,换厂商只改 .env
import json
import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

load_dotenv()


def get_llm(temperature: float = 0) -> ChatOpenAI:
    extra = os.environ.get("LLM_EXTRA_BODY")
    return ChatOpenAI(
        model=os.environ["LLM_MODEL"],
        base_url=os.environ["LLM_BASE_URL"],
        api_key=SecretStr(os.environ["LLM_API_KEY"]),
        temperature=temperature,
        max_retries=5,  # 厂商偶尔返回 503「太忙」,SDK 会等一会儿再试
        extra_body=json.loads(extra) if extra else None,
    )


def estimate_cost(input_tokens: int, output_tokens: int) -> float:
    """按 .env 的 LLM_PRICE(缓存命中,未命中,输出;元/百万 token)粗算。输入一律按未命中算,是上限。"""
    _, miss, out = (float(x) for x in os.environ.get("LLM_PRICE", "0,0,0").split(","))
    return (input_tokens * miss + output_tokens * out) / 1_000_000
```

<div class="line-notes">

- `from langchain_openai import ChatOpenAI` LangChain 对 OpenAI 兼容接口的封装。为什么不直接用 openai SDK?因为后天要在 LangGraph 里用 `bind_tools` 和 `with_structured_output`,它们是 LangChain 模型对象的方法,[Day 320](/blog/agent-zero/day-320-lg-refund-approval/) 用过同一个类。
- `from pydantic import SecretStr` 存密钥用的字符串类型,打印时显示成星号,下面实测。
- `load_dotenv()` 从当前目录往上找 `.env`,把里面的变量放进 `os.environ`。模块被 import 时就执行一次,相当于前端项目里 Vite 启动时读 `.env`。
- `def get_llm(temperature: float = 0) -> ChatOpenAI:` 和 Day 320 的 `get_llm` 同名同参数,多了两样东西,下面两条讲。`temperature=0` 让输出尽量稳定,查账不需要创造力。
- `extra = os.environ.get("LLM_EXTRA_BODY")` 我的 `.env` 里是 `{"thinking": {"type": "disabled"}}`,关掉 DeepSeek 的思考模式。为什么非关不可,下面实测。
- `model=os.environ["LLM_MODEL"],` 我的是 `deepseek-flash`。用 `[]` 而不是 `.get`,没配就当场报 KeyError,比带着 None 跑到半路才报错好查。
- `api_key=SecretStr(os.environ["LLM_API_KEY"]),` 不包 `SecretStr` 也能跑,但 `ChatOpenAI` 的参数类型就是 `SecretStr`,不包的话 Zed 里 basedpyright 会标红。
- `max_retries=5,  # 厂商偶尔返回 503「太忙」` 第一处新增。默认是 2 次。旧课跑一批场景时,DeepSeek 好几次返回 503「Service is too busy」,两次重试用完整个调查就失败了。SDK 的重试是指数退避,第一次等不到 1 秒,之后越等越久。
- `extra_body=json.loads(extra) if extra else None,` `extra_body` 原样拼进请求体,用来传厂商私有参数。`json.loads` 把字符串变成字典,相当于 `JSON.parse`。
- `def estimate_cost(input_tokens: int, output_tokens: int) -> float:` 第二处新增,粗算花费。没有用 `common/llm.py` 的 `LLMClient`:BillSleuth 是独立仓库,Day 679 定过不 import 课程练习仓库的代码。
- `_, miss, out = (float(x) for x in os.environ.get("LLM_PRICE", "0,0,0").split(","))` `.env` 里是 `0.04,2,8`,拆成三个数,第一个(缓存命中价)用 `_` 丢掉。等号左边三个名字对应右边三个值,相当于 JS 的解构 `const [, miss, out] = ...`。
- `return (input_tokens * miss + output_tokens * out) / 1_000_000` 价格是「元每百万 token」,所以除以一百万。`1_000_000` 里的下划线只是为了好读,和 JS 的 `1_000_000` 一样。输入全按未命中算,所以是**上限**,DeepSeek 对重复前缀有缓存折扣,实际会更便宜。

</div>

试一下。新建草稿脚本:

```python
# billsleuth/scratch/try_llm.py  模型对象试一下:一次普通调用,看用量和花费
from billsleuth.llm import estimate_cost, get_llm

llm = get_llm()
reply = llm.invoke("用一句话解释什么是按天折算,不超过 40 个字。")
print(type(reply).__name__, "|", reply.content)
usage = reply.usage_metadata or {}
print("用量:", usage)
tin, tout = usage.get("input_tokens", 0), usage.get("output_tokens", 0)
print(f"花费上限 ¥{estimate_cost(tin, tout):.6f}")
print("key 打印出来是:", llm.openai_api_key)
```

<div class="line-notes">

- `reply = llm.invoke("用一句话解释什么是按天折算,不超过 40 个字。")` 传一个字符串,LangChain 会把它当成一条用户消息。返回的是 `AIMessage` 对象,不是字符串。
- `usage = reply.usage_metadata or {}` LangChain 统一过的用量字段。有些厂商不返回用量,这时是 None,`or {}` 兜一下,后面 `.get` 就不会炸。
- `tin, tout = usage.get("input_tokens", 0), usage.get("output_tokens", 0)` 输入 18、输出 20 个 token,见下面的输出。
- `print(f"花费上限 ¥{estimate_cost(tin, tout):.6f}")` (18 × 2 + 20 × 8) / 1,000,000 = 0.000196 元。
- `print("key 打印出来是:", llm.openai_api_key)` 看看 `SecretStr` 的效果。

</div>

```bash
uv run python -m scratch.try_llm
```

```text
AIMessage | 按天折算就是把月/年费率除以对应天数，再乘以实际使用天数来计算费用。
用量: {'input_tokens': 18, 'output_tokens': 20, 'total_tokens': 38, 'input_token_details': {'cache_read': 0}, 'output_token_details': {}}
花费上限 ¥0.000196
key 打印出来是: **********
```

一次调用不到两分钱的百分之一。key 打印出来是十个星号,哪天你把模型对象打进日志,至少 key 不会跟着出去。

### 实测:开着思考做结构化输出

`.env` 里那行 `LLM_EXTRA_BODY` 我一直说「关掉思考」,今天把它的理由跑出来。intake 要用 `with_structured_output(..., method="function_calling")`,LangChain 的做法是把 schema 包成一个工具,再用 `tool_choice` **强制**模型调用这个工具。下面这个脚本临时把思考模式打开:

```python
# billsleuth/scratch/thinking_toolchoice.py  为什么 .env 里要关思考:开着思考做结构化输出会怎样
import os
from typing import Literal

from pydantic import BaseModel

os.environ["LLM_EXTRA_BODY"] = '{"thinking": {"type": "enabled"}}'  # 只在这个脚本里临时打开

from billsleuth.llm import get_llm  # noqa: E402


class Intake(BaseModel):
    complaint: Literal["金额不对", "重复扣款", "取消后仍扣款", "看不懂账单", "其他"]
    amount: str | None = None


llm = get_llm().with_structured_output(Intake, method="function_calling")
print(llm.invoke("客户原话:8 月这张发票金额 1438.44,我们财务对不上账"))
```

<div class="line-notes">

- `os.environ["LLM_EXTRA_BODY"] = '{"thinking": {"type": "enabled"}}'` 改的是这个进程里的环境变量,不动 `.env` 文件。要在 import `billsleuth.llm` **之前**改,因为 `load_dotenv()` 默认不覆盖已经存在的变量,我们设的值会留下来。
- `from billsleuth.llm import get_llm  # noqa: E402` import 写在了代码中间,Ruff 会报 E402(模块级 import 不在文件顶部),`# noqa: E402` 告诉它这里是故意的。
- `class Intake(BaseModel):` 后天正式版 intake 的简化版,只留两个字段。
- `complaint: Literal["金额不对", "重复扣款", "取消后仍扣款", "看不懂账单", "其他"]` 只能取这五个值之一,相当于 TS 的联合字面量类型。
- `llm = get_llm().with_structured_output(Intake, method="function_calling")` `method="function_calling"` 表示用工具调用来实现结构化输出。DeepSeek 官方不支持 `json_schema` 方式([Day 150](/blog/agent-zero/day-150-structured-4/) 讲过),所以只能走这条路。

</div>

```bash
uv run python -m scratch.thinking_toolchoice
```

```text
langchain_openai.chat_models.base.OpenAIInvalidRequestError: Error code: 400 - {'error': {'message': 'Thinking mode does not support this tool_choice (request_id: a77b8397-cefd-4538-ae92-0c0234655ce5)', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

(前面的调用栈省略。)400,「思考模式不支持这种 tool_choice」。DeepSeek 的[思考模式文档](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)里也写了思考模式下工具调用的限制。删掉脚本里那一行 `os.environ[...]` 再跑,就能拿到 `complaint='金额不对' amount='1438.44'`。

关思考还有第二个理由:思考模式下多轮工具调用要求把上一轮的 `reasoning_content` 原样传回去,LangChain 的消息转换不一定帮你带上,带不上就又是一个 400。查账这种任务不需要长链思考,关掉最省心,也更便宜。

## 第二步:同步代码怎么调异步工具

### 问题在哪

MCP 的 Python 客户端是异步的,`Client` 要用 `async with`,`call_tool` 要 `await`([Day 288](/blog/agent-zero/day-288-mcp-client/))。而 LangGraph 的节点,我们一直写成普通的 `def` 函数([Day 311](/blog/agent-zero/day-311-lg-agent-loop/))。在普通函数里怎么等一个异步结果?

前端同学的第一反应可能是「普通函数里没法 await,只能把整条调用链都改成 async」。JS 里确实如此,浏览器只有一个事件循环,你不能在同步代码里「停下来等一个 Promise」。Python 多了一条路:[Day 67](/blog/agent-zero/day-067-async-2/) 学的 `asyncio.run(协程)` 会**新建**一个事件循环,把协程跑完,关掉循环,把结果交回来。在同步函数里调它,效果就是「同步地等一个异步结果」。

可它有一个限制。写一个小实验:

```python
# billsleuth/scratch/sync_async.py  同步函数里调异步的 MCP 客户端:asyncio.run 什么时候能用,什么时候炸
import asyncio

from mcp import Client

from billsleuth.server import mcp


async def list_tool_names() -> list[str]:
    async with Client(mcp) as c:
        return [t.name for t in (await c.list_tools()).tools]


def node() -> list[str]:
    """假装这是一个 LangGraph 节点:普通的同步函数。"""
    return asyncio.run(list_tool_names())


print("情况一,外面没有事件循环:", node())


async def main() -> None:
    print("情况二,外面已经有事件循环:")
    node()


asyncio.run(main())
```

<div class="line-notes">

- `from billsleuth.server import mcp` Day 683 写的 server 对象,交给 `Client` 就是内存连接。
- `async def list_tool_names() -> list[str]:` 一个协程函数:连上 server,列出工具名。
- `return [t.name for t in (await c.list_tools()).tools]` `await` 拿到 `ListToolsResult`,再取 `.tools` 列表,推导式只留名字。
- `def node() -> list[str]:` 普通函数,没有 `async`。
- `return asyncio.run(list_tool_names())` 在同步函数里新建一个事件循环,把协程跑完。
- `print("情况一,外面没有事件循环:", node())` 直接在模块顶层调,这时没有任何事件循环在跑。
- `async def main() -> None:` 情况二:`node()` 被一个异步函数调用,也就是「外面已经有一个事件循环在跑」。什么时候会这样?Jupyter 里、FastAPI 的 async 接口里、用 `graph.ainvoke` 跑图时,都是。
- `asyncio.run(main())` 启动外层的事件循环。

</div>

```bash
uv run python -m scratch.sync_async
```

```text
情况一,外面没有事件循环: ['get_customer', 'list_invoices', 'get_invoice', 'list_payments', 'get_subscription_timeline', 'get_tax_rate', 'recompute_invoice', 'draft_credit_note']
情况二,外面已经有事件循环:
Traceback (most recent call last):
  ...
RuntimeError: asyncio.run() cannot be called from a running event loop
sys:1: RuntimeWarning: coroutine 'list_tool_names' was never awaited
```

情况一拿到了 8 个工具名。情况二炸了:`asyncio.run()` 不能在一个正在跑的事件循环里调用。一个线程同一时刻只能有一个事件循环在跑,外层的 `main` 已经占着了。最后那行警告是连带的:协程对象 `list_tool_names()` 已经造出来了,但 `asyncio.run` 拒绝执行它,它就没被 await 过。

今天我们用 `graph.invoke` 同步地跑图,碰不到情况二。但 Day 697 要把调查放进网页后端,那时外面就有事件循环了。桥接层最好两种情况都能处理。

### 解法:有循环就换个线程

`concurrent.futures.ThreadPoolExecutor` 是标准库里的线程池,[Day 191](/blog/agent-zero/day-191-failures-3/) 给工具调用加超时时用过。思路是:外面已经有事件循环,那就开一个新线程,在新线程里 `asyncio.run`。新线程里还没有事件循环,`asyncio.run` 就不会炸。当前线程等那个线程跑完,把结果拿回来。

```python
def _run(coro: Coroutine[Any, Any, Any]) -> Any:
    """在同步代码里跑一个协程。外面没有事件循环就直接 asyncio.run;有的话换一个线程去跑。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()
```

<div class="line-notes">

- `def _run(coro: Coroutine[Any, Any, Any]) -> Any:` 名字前的下划线是 Python 的约定,表示「模块内部用的,外面别调」,相当于 TS 里不 export。`Coroutine[Any, Any, Any]` 是协程对象的类型,三个参数分别是 send 类型、throw 类型和返回值类型,我们只关心它是个协程,都写 `Any`。
- `asyncio.get_running_loop()` 问一句「当前线程有正在跑的事件循环吗」。有就返回那个循环(我们不需要它,所以没接返回值);没有就抛 `RuntimeError`。
- `except RuntimeError:` 没有事件循环,情况一。
- `return asyncio.run(coro)` 直接跑。BillSleuth 绝大多数时候走这条路。
- `with ThreadPoolExecutor(max_workers=1) as pool:` 情况二,开一个只有一个线程的线程池。`with` 结束时会等线程跑完再关池子。
- `return pool.submit(asyncio.run, coro).result()` `submit(函数, 参数)` 让新线程执行 `asyncio.run(coro)`,返回一个 `Future`(和 JS 的 Promise 很像)。`.result()` 阻塞当前线程,直到新线程跑完,再把结果拿回来。注意这里阻塞的是**外层事件循环所在的线程**,外层循环在等的那几十毫秒里干不了别的事,对 BillSleuth 够用,真上高并发服务时要改成全异步,Day 697 再说。

</div>

## 第三步:BillingMCP,把工具变成模型认识的样子

桥接层还要做两件翻译的事。

一是**工具清单的格式**。MCP 的 `tools/list` 返回的每个工具有 `name`、`description`、`inputSchema`;而 OpenAI 兼容协议要的 tools 格式长这样:`{"type": "function", "function": {"name": ..., "description": ..., "parameters": ...}}`,[Day 157](/blog/agent-zero/day-157-tool-schema/) 手写过。字段是一一对应的,`inputSchema` 换个名字叫 `parameters`,外面再包一层。

二是**调用结果的形状**。Day 683 说过两个小坑:工具返回列表时 SDK 会包一层 `{"result": [...]}`;工具报错时 `structured_content` 是 None,错误文字在 `content` 里。桥接层统一成 `(是否成功, 数据)` 这样一对值交出去,后面的代码不用再关心 MCP 的细节。

完整的 `billsleuth/mcp_bridge.py`(`_run` 就是上一步那段):

```python
# billsleuth/billsleuth/mcp_bridge.py  同步地调用 BillSleuth MCP server:LangGraph 节点是同步函数,MCP 客户端是异步的
"""两种连法:
- stdio(默认):起一个子进程跑 server,和部署时 server 在另一台机器上的形态一致;
- in_process=True:直接把 server 对象交给 Client,同一个进程里走完整协议,快,测试和评测用。
"""
import asyncio
import json
import os
import sys
from collections.abc import Coroutine
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from mcp import Client, StdioServerParameters

from billsleuth.db import ROOT


def _run(coro: Coroutine[Any, Any, Any]) -> Any:
    """在同步代码里跑一个协程。外面没有事件循环就直接 asyncio.run;有的话换一个线程去跑。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


class BillingMCP:
    def __init__(self, in_process: bool = False) -> None:
        if in_process:
            from billsleuth.server import mcp
            self.target: Any = mcp
        else:
            # 构造时把当前环境变量(BILLSLEUTH_DB、BILLSLEUTH_SESSION)整份交给子进程
            self.target = StdioServerParameters(command=sys.executable, args=["-m", "billsleuth.server"],
                                                env={**os.environ}, cwd=str(ROOT))
        self._specs: list[dict] | None = None

    def tool_specs(self) -> list[dict]:
        """MCP 工具清单 → OpenAI 兼容的 tools 格式。只取一次,之后用缓存。"""
        if self._specs is None:
            async def fetch():
                async with Client(self.target) as c:
                    return (await c.list_tools()).tools
            self._specs = [{"type": "function", "function": {
                "name": t.name, "description": t.description or "", "parameters": t.input_schema}}
                for t in _run(fetch())]
        return self._specs

    def call(self, name: str, args: dict) -> tuple[bool, Any]:
        """调一次工具,返回 (是否成功, 结构化结果或报错文字)。"""
        async def go():
            async with Client(self.target) as c:
                return await c.call_tool(name, args)
        r = _run(go())
        if r.is_error:
            return False, "\n".join(getattr(x, "text", "") for x in r.content)
        data = r.structured_content
        if isinstance(data, dict) and set(data) == {"result"}:  # 返回列表时 SDK 包了一层 {"result": [...]}
            data = data["result"]
        return True, data


def to_text(ok: bool, data: Any) -> str:
    """工具结果变成给模型看的文字:成功是 JSON,失败加一个前缀。"""
    return json.dumps(data, ensure_ascii=False) if ok else f"[工具报错] {data}"
```

<div class="line-notes">

- `"""两种连法:` 模块顶部的 docstring,写清这个模块是干什么的、有哪两种用法。
- `from mcp import Client, StdioServerParameters` mcp 2.3.0 的 `Client` 构造参数可以是 server 对象(内存连接)、`StdioServerParameters`(起子进程)或者一个 URL(HTTP),我查过它的签名,这三种都认。
- `from billsleuth.db import ROOT` Day 680 在 `db.py` 里定义的仓库根目录。
- `class BillingMCP:` 一个类管一个 server 连接方式。用类而不是几个散函数,是因为要缓存工具清单(`_specs`),[Day 40](/blog/agent-zero/day-040-classes-1/) 讲过类就是「数据 + 操作数据的函数」。
- `def __init__(self, in_process: bool = False) -> None:` 默认 stdio。测试和评测时传 `in_process=True`。
- `from billsleuth.server import mcp` import 写在函数里,只有选了内存连接才导入 server。stdio 模式下本进程根本不需要加载 server 的代码。
- `self.target: Any = mcp` 两个分支给 `self.target` 赋的类型不同,标成 `Any`,类型检查器就不会抱怨。
- `# 构造时把当前环境变量(BILLSLEUTH_DB、BILLSLEUTH_SESSION)整份交给子进程` 这句注释很重要:环境变量是在**构造的那一刻**复制的,之后再改 `os.environ`,子进程看不到。练习 2 会实测。
- `self.target = StdioServerParameters(command=sys.executable, args=["-m", "billsleuth.server"],` `sys.executable` 是当前正在运行的 Python 解释器的完整路径。用 `uv run` 启动时,它就是 `.venv` 里那个 Python,装好的 mcp 等库子进程都能用。直接用 `-m`,没有 Day 683 Inspector 吞参数的问题,因为中间没有别的命令行工具。
- `env={**os.environ}, cwd=str(ROOT))` `{**os.environ}` 把当前所有环境变量复制成一个新字典,相当于 JS 的 `{...process.env}`。`cwd` 是子进程的工作目录,设成仓库根目录,`-m billsleuth.server` 才找得到包。
- `self._specs: list[dict] | None = None` 工具清单的缓存,一开始是 None。
- `def tool_specs(self) -> list[dict]:` 给模型的工具清单。
- `async def fetch():` 在方法里定义一个协程函数,它能直接用外面的 `self`。这种写在函数里的函数叫闭包,和 JS 里一样。
- `return (await c.list_tools()).tools` 拿到 8 个 `Tool` 对象。
- `"name": t.name, "description": t.description or "", "parameters": t.input_schema}}` 一一对应地搬过去。`input_schema` 是 SDK 里的 Python 属性名,协议里叫 `inputSchema`。`description or ""` 防止哪个工具没写描述是 None。
- `for t in _run(fetch())]` 这里用上了 `_run`:同步地拿到异步的结果。
- `def call(self, name: str, args: dict) -> tuple[bool, Any]:` 返回一对值,第一个是成没成。`tuple[bool, Any]` 相当于 TS 的 `[boolean, any]`。
- `async with Client(self.target) as c:` **每次调用都新开一个连接**。内存连接只要十几毫秒,无所谓;stdio 就意味着每次调用都起一个子进程,下面实测有多慢。
- `if r.is_error:` 工具报错(我们抛的 `ToolError`)和参数没通过 schema 校验,都会走到这里。
- `return False, "\n".join(getattr(x, "text", "") for x in r.content)` 错误文字在 `content` 列表的文字块里。`getattr(x, "text", "")` 取 `x.text`,没有这个属性就给空字符串,比直接 `x.text` 安全,也不用像 Day 683 那样压类型检查的红线。
- `data = r.structured_content` 成功时取结构化结果。
- `if isinstance(data, dict) and set(data) == {"result"}:  # 返回列表时 SDK 包了一层 {"result": [...]}` 字典的键**正好只有** `result` 一个,才拆。`set(data)` 把字典的键变成集合。只判断「有 result 键」不够严谨:哪天某个工具的返回结构里真有一个叫 result 的字段,就会被误拆。
- `def to_text(ok: bool, data: Any) -> str:` 后天的 tools 节点要把结果塞进 ToolMessage,ToolMessage 的内容是文字。
- `return json.dumps(data, ensure_ascii=False) if ok else f"[工具报错] {data}"` 成功给 JSON(`ensure_ascii=False` 让中文原样输出,不变成 `中`);失败加一个醒目的前缀,模型一眼知道这次调用没成功。

</div>

### 试一下,顺便量一量两种连法

```python
# billsleuth/scratch/try_bridge.py  桥接试一下:工具清单变成什么样、调用结果长什么样、两种连法各要多久
import json
import time

from billsleuth.mcp_bridge import BillingMCP, to_text

fast = BillingMCP(in_process=True)
specs = fast.tool_specs()
print(len(specs), "个工具;第二个长这样:")
print(json.dumps(specs[1], ensure_ascii=False, indent=2))

ok, data = fast.call("list_invoices", {"customer_id": "C-0011", "limit": 2})
print(ok, type(data).__name__, [d["id"] for d in data])
ok, data = fast.call("get_invoice", {"invoice_id": "INV-0011-09"})
print(ok, "|", to_text(ok, data))

for label, m in [("in_process", fast), ("stdio", BillingMCP())]:
    t0 = time.perf_counter()
    for _ in range(3):
        m.call("get_customer", {"customer_id": "C-0011"})
    print(f"{label:<10} 每次调用平均 {(time.perf_counter() - t0) / 3 * 1000:.0f} ms")
```

<div class="line-notes">

- `fast = BillingMCP(in_process=True)` 内存连接。
- `print(json.dumps(specs[1], ensure_ascii=False, indent=2))` 第二个工具是 `list_invoices`,看它被翻译成了什么样。
- `print(ok, type(data).__name__, [d["id"] for d in data])` 拆包以后应该直接是 list。
- `ok, data = fast.call("get_invoice", {"invoice_id": "INV-0011-09"})` 格式对、但不存在的发票号,看报错怎么变成文字。
- `for label, m in [("in_process", fast), ("stdio", BillingMCP())]:` 两种连法各调 3 次同一个工具。
- `t0 = time.perf_counter()` 高精度计时器,相当于浏览器的 `performance.now()`,单位是秒。
- `print(f"{label:<10} 每次调用平均 {(time.perf_counter() - t0) / 3 * 1000:.0f} ms")` `:<10` 左对齐占 10 个字符宽,`:.0f` 不保留小数。

</div>

```bash
uv run python -m scratch.try_bridge
```

```text
8 个工具;第二个长这样:
{
  "type": "function",
  "function": {
    "name": "list_invoices",
    "description": "列出客户的发票表头(不含行项目),最新的在前。要看行项目用 get_invoice。",
    "parameters": {
      "type": "object",
      "properties": {
        "customer_id": {
          "description": "客户编号,如 C-0007",
          "pattern": "^C-\\d{4}$",
          "title": "Customer Id",
          "type": "string"
        },
        "limit": {
          "default": 12,
          "description": "最多返回几张,按计费周期倒序",
          "maximum": 24,
          "minimum": 1,
          "title": "Limit",
          "type": "integer"
        }
      },
      "required": [
        "customer_id"
      ],
      "title": "list_invoicesArguments"
    }
  }
}
True list ['INV-0011-05', 'INV-0011-04']
False | [工具报错] Error executing tool get_invoice: 发票 INV-0011-09 不存在。发票号形如 INV-0007-03,先用 list_invoices 查这个客户有哪些发票。
in_process 每次调用平均 15 ms
stdio      每次调用平均 1572 ms
```

几个地方对一下。Day 683 写在 `Annotated[..., Field(...)]` 里的描述、正则、上下限,全部原样出现在 `parameters` 里:`pattern`、`maximum: 24`、`minimum: 1`、`default: 12`。模型看到的就是这些。`list_invoices` 的结果拆完包是 `list`,不再有 `result` 那一层。报错变成了一行以 `[工具报错]` 开头的文字。

最后两行差了一百倍:内存连接 15 毫秒,stdio 1.5 秒多。stdio 每次调用都要起一个新的 Python 进程、import 一遍 mcp 和 pydantic、握手、调用、退出,我的 2019 款 Intel MacBook 上大头花在启动和 import 上。一次调查十来次工具调用,stdio 光这一项就是十几秒;Day 693 评测 100 个场景,就是半个小时。所以测试和评测一律用 `in_process=True`。

stdio 版也不是摆设:部署时工具层多半跑在另一个进程甚至另一台机器上(比如只有它有数据库的读权限),那时候走的是真协议、真进程边界。桥接层两种都支持,上层代码一行不用改,这正是隔一层的好处。想让 stdio 不每次都起进程,要让一个 `Client` 连接长期活着,跨多次同步调用复用,这得把事件循环放在一个常驻线程里,复杂度上一个台阶,我们现在不需要。

### 有现成的库,为什么还自己写

LangChain 官方有一个 [langchain-mcp-adapters](https://github.com/langchain-ai/langchain-mcp-adapters),能把 MCP 工具直接变成 LangChain 的工具对象。我没用它,原因有三条:它是异步优先的,我们的节点是同步的,中间还是要桥;我们要在调工具之前插两道防线(只能查本客户、发票号必须来自列表,Day 686 写),自己掌握调用入口更方便;拆 `{"result": [...]}`、统一成 `(ok, data)` 这种小事,自己写二十行比读懂一个库的配置项快。如果你的项目只是想把一堆 MCP 工具原样交给一个预置的 Agent,用它更省事。

## 第四步:桥接测试

和 Day 683 的 `test_server.py` 一样,每条测试用一份干净的库副本。新建 `tests/test_bridge.py`:

```python
# billsleuth/tests/test_bridge.py  桥接测试:工具清单的格式、列表拆包、报错变文字、在事件循环里也能调、stdio 也通
import asyncio
import shutil

import pytest

from billsleuth import seed
from billsleuth.mcp_bridge import BillingMCP, to_text


@pytest.fixture(scope="module")
def master_db(tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "master.db"
    mp = pytest.MonkeyPatch()
    mp.setenv("BILLSLEUTH_DB", str(path))
    seed.main()
    mp.undo()
    return path


@pytest.fixture(autouse=True)
def fresh_db(master_db, tmp_path, monkeypatch):
    path = tmp_path / "billing.db"
    shutil.copy(master_db, path)
    monkeypatch.setenv("BILLSLEUTH_DB", str(path))
    return path


@pytest.fixture
def bridge():
    return BillingMCP(in_process=True)


def test_specs_are_openai_tools(bridge):
    specs = bridge.tool_specs()
    assert len(specs) == 8
    lst = next(s for s in specs if s["function"]["name"] == "list_invoices")
    assert lst["type"] == "function"
    assert lst["function"]["parameters"]["required"] == ["customer_id"]
    assert bridge.tool_specs() is specs  # 第二次拿的是缓存


def test_list_result_is_unwrapped(bridge):
    ok, data = bridge.call("list_invoices", {"customer_id": "C-0011", "limit": 2})
    assert ok and isinstance(data, list)
    assert [d["id"] for d in data] == ["INV-0011-05", "INV-0011-04"]


def test_object_result_is_kept(bridge):
    ok, data = bridge.call("recompute_invoice", {"invoice_id": "INV-0011-03"})
    assert ok and data["difference"] == "26.02"


def test_tool_error_becomes_text(bridge):
    ok, data = bridge.call("get_invoice", {"invoice_id": "INV-0011-09"})
    assert not ok and "list_invoices" in data
    assert to_text(ok, data).startswith("[工具报错]")


def test_schema_error_becomes_text(bridge):
    ok, data = bridge.call("get_invoice", {"invoice_id": "12345"})
    assert not ok and "pattern" in data


def test_works_inside_running_loop(bridge):
    async def inside():
        return bridge.call("get_customer", {"customer_id": "C-0011"})
    ok, data = asyncio.run(inside())
    assert ok and data["timezone"] == "Asia/Singapore"


def test_stdio_reads_the_same_db():
    ok, data = BillingMCP().call("recompute_invoice", {"invoice_id": "INV-0011-03"})
    assert ok and data["difference"] == "26.02"
```

<div class="line-notes">

- `@pytest.fixture(scope="module")` 和 Day 683 一模一样的两个 fixture:整个文件造一次数,每条测试复制一份。两个测试文件里有重复代码,按理该挪到 `tests/conftest.py` 共用,[Day 73](/blog/agent-zero/day-073-pytest-3/) 讲过 conftest。我先保持重复,复习日的练习里再挪。
- `mp.setenv("BILLSLEUTH_DB", str(path))` 造数时指向临时目录,不碰仓库里的 `billing.db`。
- `def bridge():` 每条测试一个新的内存桥接对象。
- `assert len(specs) == 8` 8 个工具一个不少。
- `lst = next(s for s in specs if s["function"]["name"] == "list_invoices")` 按名字找,不按下标。工具顺序将来可能变。
- `assert lst["function"]["parameters"]["required"] == ["customer_id"]` 必填参数只有客户号,`limit` 有默认值不是必填。
- `assert bridge.tool_specs() is specs  # 第二次拿的是缓存` `is` 判断是不是**同一个对象**,相当于 JS 的 `===` 比较对象引用。是同一个,说明第二次没有再去连 server。
- `assert ok and isinstance(data, list)` 列表被拆了包。
- `assert ok and data["difference"] == "26.02"` 返回对象的工具不拆,字段在顶层。
- `assert not ok and "list_invoices" in data` Day 683 那句「先用 list_invoices 查」原样传到了这一层。
- `assert to_text(ok, data).startswith("[工具报错]")` 给模型看的文字带前缀。
- `assert not ok and "pattern" in data` schema 校验失败的报错是英文的 `String should match pattern ...`,也走 `is_error` 这条路。
- `def test_works_inside_running_loop(bridge):` 守住第二步那个坑:在一个正在跑的事件循环里调桥接。
- `return bridge.call("get_customer", {"customer_id": "C-0011"})` `inside` 是 async 函数,它里面的 `bridge.call` 走的是开线程那个分支。把 `_run` 里的 try/except 删掉,这条测试就会报 `asyncio.run() cannot be called from a running event loop`。
- `def test_stdio_reads_the_same_db():` 唯一一条真起子进程的测试,一秒半左右。证明 stdio 连法也通,而且读的是 fixture 指定的那份库。
- `ok, data = BillingMCP().call("recompute_invoice", {"invoice_id": "INV-0011-03"})` 桥接对象是在 `fresh_db` 设好 `BILLSLEUTH_DB` **之后**才建的,子进程拿到的就是临时库的路径。

</div>

```bash
uv run pytest tests/test_bridge.py -v
```

```text
tests/test_bridge.py::test_specs_are_openai_tools PASSED                 [ 14%]
tests/test_bridge.py::test_list_result_is_unwrapped PASSED               [ 28%]
tests/test_bridge.py::test_object_result_is_kept PASSED                  [ 42%]
tests/test_bridge.py::test_tool_error_becomes_text PASSED                [ 57%]
tests/test_bridge.py::test_schema_error_becomes_text PASSED              [ 71%]
tests/test_bridge.py::test_works_inside_running_loop PASSED              [ 85%]
tests/test_bridge.py::test_stdio_reads_the_same_db PASSED                [100%]

============================== 7 passed in 4.02s ===============================
```

7 条全绿,4 秒里大部分是造数和 stdio 那一条。再跑一次全部测试 `uv run pytest -q`,我这里是 `237 passed`。Day 683 的验收数是 232,我重建项目时少放了两条练习里的测试,所以你那边的总数可能多一两条,以 0 failed 为准。

## 拼起来:一个不拆段的大循环

两个模块都有了。现在用最少的代码拼一个「不拆段」的版本:一个系统提示、7 个只读工具、一个循环,让模型从头查到尾,最后用一段话写结论。这就是 [Day 311](/blog/agent-zero/day-311-lg-agent-loop/) 那个 Agent 循环,只是没用 LangGraph,直接写 for 循环,好看清每一轮发生了什么。

```python
# billsleuth/scratch/one_loop.py  不拆段:一个系统提示、一组工具、一个大循环,看模型前几步在干什么
import json
import sys

from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, SystemMessage, ToolMessage

from billsleuth.db import ROOT
from billsleuth.llm import estimate_cost, get_llm
from billsleuth.mcp_bridge import BillingMCP, to_text

READ_ONLY = {"get_customer", "list_invoices", "get_invoice", "list_payments",
             "get_subscription_timeline", "get_tax_rate", "recompute_invoice"}
mcp = BillingMCP(in_process=True)
specs = [s for s in mcp.tool_specs() if s["function"]["name"] in READ_ONLY]
llm = get_llm().bind_tools(specs)

for sid in sys.argv[1:]:
    sc = json.loads((ROOT / "scenarios" / f"{sid}.json").read_text(encoding="utf-8"))
    print(f"\n=== {sid} {sc['customer_id']}:{sc['question']}")
    msgs: list[AnyMessage] = [
        SystemMessage(f"你是云簿的计费调查员,客户编号 {sc['customer_id']}。用工具查清这位客户的账单问题,"
                      "最后用一段话写出结论:根因、发票号、多收多少。"),
        HumanMessage(sc["question"]),
    ]
    tin = tout = step = 0
    for step in range(1, 13):
        reply = llm.invoke(msgs)
        assert isinstance(reply, AIMessage)
        msgs.append(reply)
        u = reply.usage_metadata or {}
        tin, tout = tin + u.get("input_tokens", 0), tout + u.get("output_tokens", 0)
        if not reply.tool_calls:
            print(f"  第 {step} 轮 结论:{str(reply.content)[:110]}")
            break
        for c in reply.tool_calls:
            ok, data = mcp.call(c["name"], c["args"])
            msgs.append(ToolMessage(to_text(ok, data), tool_call_id=c["id"]))
            print(f"  第 {step} 轮 → {c['name']}({json.dumps(c['args'], ensure_ascii=False)})")
    print(f"  共 {step} 轮,输入 {tin} / 输出 {tout} token,约 ¥{estimate_cost(tin, tout):.4f}")
    print(f"  标准答案:{sc['truth']['root_cause']} {sc['truth']['invoice_ids']} 多收 {sc['truth']['overcharge']}")
```

<div class="line-notes">

- `from langchain_core.messages import AIMessage, AnyMessage, HumanMessage, SystemMessage, ToolMessage` LangChain 的五种消息类,分别对应 OpenAI 协议里的 assistant、任意一种、user、system、tool 角色,[Day 311](/blog/agent-zero/day-311-lg-agent-loop/) 用过。
- `READ_ONLY = {"get_customer", "list_invoices", "get_invoice", "list_payments",` 只给只读工具,`draft_credit_note` 不给。调查阶段不该写任何东西,这是最小权限。
- `mcp = BillingMCP(in_process=True)` 内存连接,快。
- `specs = [s for s in mcp.tool_specs() if s["function"]["name"] in READ_ONLY]` 8 个里挑 7 个。
- `llm = get_llm().bind_tools(specs)` `bind_tools` 把工具清单绑到模型对象上,之后每次 `invoke` 都会带上 `tools` 参数。它返回一个新对象,原来的 `get_llm()` 不受影响。
- `sc = json.loads((ROOT / "scenarios" / f"{sid}.json").read_text(encoding="utf-8"))` 读场景文件。注意只用了 `customer_id` 和 `question` 给模型,`truth` 只在最后打印出来对答案,不进消息。
- `msgs: list[AnyMessage] = [` 消息历史,每一轮都整个发给模型。
- `"最后用一段话写出结论:根因、发票号、多收多少。"),` 大循环没有 SubmitFindings 这种结构化交卷的办法(那是 Day 686 的事),只能让它写一段话。
- `tin = tout = step = 0` 累计输入输出 token。`step` 也先给个 0,不然循环一次都没跑时最后那行 print 会用到一个没定义的变量,basedpyright 会标红「possibly unbound」。
- `for step in range(1, 13):` 最多 12 轮,防止死循环。
- `assert isinstance(reply, AIMessage)` `bind_tools` 之后 `invoke` 的返回类型标注比较宽,断言一下,下面用 `.tool_calls` 时类型检查器才满意。
- `if not reply.tool_calls:` 模型这一轮没调工具,就是在写结论了,循环结束。
- `for c in reply.tool_calls:` 模型一轮可能同时调好几个工具(并行工具调用,[Day 162](/blog/agent-zero/day-162-parallel-tools/) 讲过),逐个执行。
- `ok, data = mcp.call(c["name"], c["args"])` 桥接层的用武之地:一行同步调用,背后是完整的 MCP 协议。
- `msgs.append(ToolMessage(to_text(ok, data), tool_call_id=c["id"]))` 结果放回历史,`tool_call_id` 必须和模型那次调用的 id 对上,否则下一轮接口会报错。
- `print(f"  共 {step} 轮,输入 {tin} / 输出 {tout} token,约 ¥{estimate_cost(tin, tout):.4f}")` 用 `llm.py` 的 `estimate_cost` 算上限。

</div>

挑三个场景:S011 是时区算错日期,S017 是重复扣款,S023 是重复开票。

```bash
uv run python -m scratch.one_loop S011 S017 S023
```

```text
=== S011 C-0011:8 月这张发票金额 1438.44,我们财务对不上账,麻烦查一下。
  第 1 轮 → get_customer({"customer_id": "C-0011"})
  第 1 轮 → list_invoices({"customer_id": "C-0011"})
  第 2 轮 → get_invoice({"invoice_id": "INV-0011-03"})
  第 2 轮 → get_subscription_timeline({"customer_id": "C-0011"})
  第 2 轮 → recompute_invoice({"invoice_id": "INV-0011-03"})
  第 3 轮 → get_tax_rate({"region": "SG", "on": "2026-08-01"})
  第 3 轮 → list_payments({"customer_id": "C-0011", "invoice_id": "INV-0011-03"})
  第 4 轮 结论:**结论**

客户 C-0011(鲸落科技-011)8 月发票 **INV-0011-03**(周期 2026-08-01 至 2026-09-01,总额 1438.44 USD)确实多收了 **26.02 USD**
  共 4 轮,输入 10876 / 输出 671 token,约 ¥0.0271
  标准答案:timezone_change_date ['INV-0011-03'] 多收 26.02

=== S017 C-0017:我的信用卡在 9 月 14 日有两笔 123.60 美元的扣款,是不是扣重了?
  第 1 轮 → get_customer({"customer_id": "C-0017"})
  第 1 轮 → list_payments({"customer_id": "C-0017"})
  第 1 轮 → list_invoices({"customer_id": "C-0017"})
  第 2 轮 → get_invoice({"invoice_id": "INV-0017-05"})
  第 2 轮 → recompute_invoice({"invoice_id": "INV-0017-05"})
  第 2 轮 → get_tax_rate({"region": "US", "on": "2026-09-14"})
  第 3 轮 结论:查清了，结论如下：

**结论：** 客户 C-0017（木棉旅行-017）的发票 **INV-0017-05**（计费周期 2026-09-14 至 2026-10-14，入门版 8 席位 × 15.00 = 120.
  共 3 轮,输入 7483 / 输出 589 token,约 ¥0.0197
  标准答案:duplicate_charge ['INV-0017-05'] 多收 123.60

=== S023 C-0023:9 月这张发票金额 139.05,我们财务对不上账,麻烦查一下。
  第 1 轮 → get_customer({"customer_id": "C-0023"})
  第 1 轮 → list_invoices({"customer_id": "C-0023"})
  第 2 轮 → get_invoice({"invoice_id": "INV-0023-04"})
  第 2 轮 → get_invoice({"invoice_id": "INV-0023-04D"})
  第 2 轮 → recompute_invoice({"invoice_id": "INV-0023-04"})
  第 2 轮 → recompute_invoice({"invoice_id": "INV-0023-04D"})
  第 2 轮 → list_payments({"customer_id": "C-0023"})
  第 2 轮 → get_subscription_timeline({"customer_id": "C-0023"})
  第 3 轮 结论:核查完毕，结论如下：

**根因**：C-0023（Quartz Legal-023）在 2026-09-15 至 2026-10-15 这个计费周期被**重复开票**——同一周期生成了两张内容完全相同的发票 INV-0
  共 3 轮,输入 7727 / 输出 678 token,约 ¥0.0209
  标准答案:duplicate_invoice ['INV-0023-04D'] 多收 139.05
```

说实话,这个结果比我预想的好。三个场景大循环都查到了点子上:S011 说出了 26.02,S017 认出了重复扣款,S023 认出了重复开票。Day 683 把工具设计得足够好用,复算工具直接给差额,模型没多少机会走偏。那拆段还有必要吗?回到开头那四条理由,拿这三次运行逐条核对:

**第一条,确定的步骤每次都让模型做。** 三个场景的第 1 轮,模型都调了 `get_customer` 和 `list_invoices`,一次不落。这一轮没有任何判断,换成代码零成本。练习 3 会把这两个调用挪到开场之前用代码做掉,实测 S011 从 4 轮降到 2 轮,输入 token 从 10876 降到 5098。不过另外两个场景没有省,S023 反而多了一轮,一次跑的结果噪声很大,别拿一次的数下结论。

**第二条,结论不能被程序读。** 看 S017 的结论:「客户 C-0017(木棉旅行-017)的发票 **INV-0017-05**……」,带着 markdown 的加粗星号,标点一会儿全角一会儿半角;根因写的是「重复扣款」四个中文字,而标准答案是 `duplicate_charge`;多收金额要从一段话里找,这段话里还出现了 120.00、123.60、247.20 好几个数。拿正则去抠,今天能抠对,换个场景就可能抠错。这一条是今天实验最直接的证据,也是后天 `SubmitFindings` 要解决的。

**第三条,不能单独测。** `one_loop.py` 里没有一个函数能脱离模型单独测。想知道「客户说了 1438.44,能不能找到 INV-0011-03」,只能整个跑一遍,花两分钱。

**第四条,出了问题难定位。** 今天三个都对,看不出来。S023 的标准答案发票号只有重复的那张 `INV-0023-04D`,而模型的结论里两张都提到了,算对算错?出了分歧时,你只有一长串消息历史可以翻。这一条要等 Day 687 跑更多场景、Day 693 正式评测时才会疼。

所以拆段的理由,第一条是钱和速度,第二三四条是**工程上可控**。大循环能查出答案,但没法被测试、被评测、被自动对账。生产系统要的是后者。

## 今天的文件

| 零件 | 文件 | 新建还是修改 | 后面哪天用到 |
| --- | --- | --- | --- |
| 依赖 | `pyproject.toml`(`uv add langgraph==1.2.16 langchain-openai==1.7.2`) | 修改 | 全程 |
| 模型对象、花费估算 | `billsleuth/llm.py` | 新建 | Day 686 起 |
| 同步跑协程 `_run` | `billsleuth/mcp_bridge.py` 上半 | 新建 | Day 686 起 |
| 工具清单翻译、调用拆包 | `billsleuth/mcp_bridge.py` 的 `BillingMCP`、`to_text` | 新建 | Day 686 调查图、Day 693 评测 |
| 桥接测试 | `tests/test_bridge.py` | 新建 | 每次改桥接 |
| 草稿 | `scratch/try_llm.py`、`thinking_toolchoice.py`、`sync_async.py`、`try_bridge.py`、`one_loop.py` | 新建 | Day 687 对照 |

大代码 `one_loop.py` 里每一段用到了哪个零件:

| 零件 | `one_loop.py` 里的哪一段 |
| --- | --- |
| `get_llm()` | `llm = get_llm().bind_tools(specs)` |
| `BillingMCP.tool_specs()` | `specs = [s for s in mcp.tool_specs() ...]` |
| `BillingMCP.call()`(内部用 `_run`) | 循环里的 `ok, data = mcp.call(...)` |
| `to_text()` | `ToolMessage(to_text(ok, data), ...)` |
| `estimate_cost()` | 每个场景最后一行的花费 |

## 动手练习

**练习 1:桥接层也记一份日志。** [Day 683 练习 2](/blog/agent-zero/day-683-bs-tools/) 发现,schema 校验失败的调用到不了 `@audited`,审计日志里没有。当时说可以在桥接层再记一份「模型想干什么」。写一个 `BillingMCP` 的子类 `LoggedMCP`,每次 `call` 都往 `self.log` 里追加 `(工具名, 参数, 是否成功)`。依次调三次:`list_invoices`(正常)、`get_invoice` 发票号 `12345`、`get_invoice` 发票号 `INV-0011-09`,打印 `log`,再查 `audit_log` 表,对比两边各有几行。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex1_bridge_log.py  练习 1:在桥接这一层也记一份调用日志,连 schema 拒掉的也记
from typing import Any

from billsleuth.mcp_bridge import BillingMCP


class LoggedMCP(BillingMCP):
    def __init__(self, in_process: bool = False) -> None:
        super().__init__(in_process)
        self.log: list[tuple[str, dict, bool]] = []

    def call(self, name: str, args: dict) -> tuple[bool, Any]:
        ok, data = super().call(name, args)
        self.log.append((name, args, ok))
        return ok, data


m = LoggedMCP(in_process=True)
m.call("list_invoices", {"customer_id": "C-0011", "limit": 2})
m.call("get_invoice", {"invoice_id": "12345"})
m.call("get_invoice", {"invoice_id": "INV-0011-09"})
for row in m.log:
    print(row)
```

<div class="line-notes">

- `class LoggedMCP(BillingMCP):` 继承,[Day 42](/blog/agent-zero/day-042-classes-2/) 讲过,相当于 JS 的 `class LoggedMCP extends BillingMCP`。
- `super().__init__(in_process)` 先让父类把连接方式设好,再加自己的东西。
- `self.log: list[tuple[str, dict, bool]] = []` 每条日志是一个三元组。
- `ok, data = super().call(name, args)` 真正的调用还是父类做,子类只旁观,和 `@audited` 一个思路。
- `self.log.append((name, args, ok))` 不管成没成都记。

</div>

```bash
uv run python -m billsleuth.seed
uv run python -m scratch.ex1_bridge_log
sqlite3 billing.db "SELECT id, tool, ok FROM audit_log"
```

```text
('list_invoices', {'customer_id': 'C-0011', 'limit': 2}, True)
('get_invoice', {'invoice_id': '12345'}, False)
('get_invoice', {'invoice_id': 'INV-0011-09'}, False)
1|list_invoices|1
2|get_invoice|0
```

桥接日志 3 行,审计日志 2 行,少的正是 `12345` 那次。两层日志各管一段:server 的审计日志记「真正执行了什么」,桥接日志记「模型想干什么」。模型连续几次传格式错误的参数,只有桥接日志看得到。Day 686 的调查图会把每次工具调用都放进状态,效果和这个 `log` 一样。

</details>

**练习 2:观察会发生什么。** 先把环境变量 `BILLSLEUTH_DB` 设成一个不存在的路径,分别建一个 stdio 桥和一个内存桥;然后把 `BILLSLEUTH_DB` 改回 `billing.db`,再用两个桥各调一次 `get_customer`。猜猜结果,再跑。

<details><summary>参考答案</summary>

```python
# billsleuth/scratch/ex2_env_timing.py  练习 2:BILLSLEUTH_DB 在建桥之前设和之后设,两种连法各读到哪个库
import os

from billsleuth.mcp_bridge import BillingMCP

os.environ["BILLSLEUTH_DB"] = "/tmp/billsleuth-no-such.db"  # 先指向一个不存在的库
stdio, inproc = BillingMCP(), BillingMCP(in_process=True)
os.environ["BILLSLEUTH_DB"] = "billing.db"  # 建好桥以后再改回真库

for label, m in [("stdio", stdio), ("in_process", inproc)]:
    ok, data = m.call("get_customer", {"customer_id": "C-0011"})
    print(f"{label:<10}", ok, data if not ok else data["name"])
```

<div class="line-notes">

- `os.environ["BILLSLEUTH_DB"] = "/tmp/billsleuth-no-such.db"  # 先指向一个不存在的库` 只是一个路径字符串,不会去创建它。Day 683 的 `db()` 检查到文件不存在会直接报错,不会悄悄建空库。
- `stdio, inproc = BillingMCP(), BillingMCP(in_process=True)` 两个桥都在「错误路径」时建好。
- `os.environ["BILLSLEUTH_DB"] = "billing.db"  # 建好桥以后再改回真库` 相对路径,从仓库根目录运行时就是真库。

</div>

```bash
uv run python -m scratch.ex2_env_timing
```

```text
stdio      False Error executing tool get_customer: 计费库不存在,请先运行 uv run python -m billsleuth.seed
in_process True 鲸落科技-011
```

两个桥的表现相反。stdio 桥在**构造时**把当时的环境变量复制了一份交给子进程,后来改 `os.environ` 它看不到,子进程拿着那个不存在的路径。内存桥和 server 在同一个进程里,server 每次调用时现读 `os.environ`,读到的已经是改回来的值。Day 687 评测时每个场景要设一个新的 `BILLSLEUTH_SESSION`,用 stdio 的话,必须先设环境变量、再建桥。

</details>

**练习 3:把找发票挪给代码。** 复制 `one_loop.py` 为 `ex3_with_list.py`,在进循环之前,用代码调 `get_customer` 和 `list_invoices`,把结果拼成开场白放进第一条用户消息,其他一字不改。跑同样三个场景,和大循环的轮数、输入 token 对比。

<details><summary>参考答案</summary>

只改两处。在 `llm = get_llm().bind_tools(specs)` 下面加一个函数:

```python
def brief(cid: str, question: str) -> str:
    """不用模型:代码先查客户和发票列表,拼成开场白。"""
    _, cust = mcp.call("get_customer", {"customer_id": cid})
    _, invs = mcp.call("list_invoices", {"customer_id": cid})
    rows = "\n".join(f"- {i['id']} 周期 {i['period_start']} 至 {i['period_end']} 总额 {i['total']}" for i in invs)
    return (f"客户原话:{question}\n客户信息:{cust}\n"
            f"这个客户的发票(最新在前):\n{rows}\n开始调查。")
```

<div class="line-notes">

- `_, cust = mcp.call("get_customer", {"customer_id": cid})` 成没成用 `_` 丢掉:客户号来自场景文件,一定存在。正式代码里要检查,后天的 locate 节点会写。
- `rows = "\n".join(f"- {i['id']} 周期 {i['period_start']} 至 {i['period_end']} 总额 {i['total']}" for i in invs)` 每张发票一行,只留模型找发票要用的四个字段。
- `f"这个客户的发票(最新在前):\n{rows}\n开始调查。")` 后天 locate 节点的开场白就是这个样子,只是还会加上「候选发票」。

</div>

然后把第一条用户消息从 `HumanMessage(sc["question"])` 改成 `HumanMessage(brief(sc["customer_id"], sc["question"]))`。

```bash
uv run python -m scratch.ex3_with_list S011 S017 S023
```

```text
=== S011 C-0011:8 月这张发票金额 1438.44,我们财务对不上账,麻烦查一下。
  第 1 轮 → get_invoice({"invoice_id": "INV-0011-03"})
  第 1 轮 → recompute_invoice({"invoice_id": "INV-0011-03"})
  第 1 轮 → get_subscription_timeline({"customer_id": "C-0011"})
  第 1 轮 → list_payments({"customer_id": "C-0011", "invoice_id": "INV-0011-03"})
  第 1 轮 → get_tax_rate({"region": "SG", "on": "2026-08-01"})
  共 2 轮,输入 5098 / 输出 525 token,约 ¥0.0144
=== S017 C-0017:我的信用卡在 9 月 14 日有两笔 123.60 美元的扣款,是不是扣重了?
  第 1 轮 → get_customer({"customer_id": "C-0017"})
  第 1 轮 → list_payments({"customer_id": "C-0017"})
  第 1 轮 → get_subscription_timeline({"customer_id": "C-0017"})
  第 2 轮 → get_invoice({"invoice_id": "INV-0017-05"})
  第 2 轮 → recompute_invoice({"invoice_id": "INV-0017-05"})
  第 2 轮 → get_tax_rate({"region": "US", "on": "2026-09-14"})
  共 3 轮,输入 7537 / 输出 609 token,约 ¥0.0199
=== S023 C-0023:9 月这张发票金额 139.05,我们财务对不上账,麻烦查一下。
  第 1 轮 → get_customer({"customer_id": "C-0023"})
  第 1 轮 → get_subscription_timeline({"customer_id": "C-0023"})
  第 1 轮 → list_payments({"customer_id": "C-0023"})
  第 2 轮 → get_invoice({"invoice_id": "INV-0023-04"})
  第 2 轮 → get_invoice({"invoice_id": "INV-0023-04D"})
  第 2 轮 → recompute_invoice({"invoice_id": "INV-0023-04"})
  第 2 轮 → recompute_invoice({"invoice_id": "INV-0023-04D"})
  第 2 轮 → get_tax_rate({"region": "US", "on": "2026-09-15"})
  第 3 轮 → recompute_invoice({"invoice_id": "INV-0023-05"})
  第 3 轮 → recompute_invoice({"invoice_id": "INV-0023-03"})
  第 3 轮 → recompute_invoice({"invoice_id": "INV-0023-01"})
  共 4 轮,输入 14174 / 输出 849 token,约 ¥0.0351
```

(每个场景末尾的「标准答案」行省略。)

| 场景 | 大循环 轮数 / 输入 token | 开场给列表 轮数 / 输入 token |
| --- | --- | --- |
| S011 | 4 / 10876 | 2 / 5098 |
| S017 | 3 / 7483 | 3 / 7537 |
| S023 | 3 / 7727 | 4 / 14174 |

S011 省了一半,另外两个没省,S023 还多查了三张无关的发票。还有个细节:开场白里已经给了客户信息,S017 和 S023 的模型还是又调了一次 `get_customer`,它不太信任用户消息里给的东西。结论:每个场景只跑一次,噪声比效果大,这张表证明不了「给列表就省钱」,也证明不了反面。真要比,要几十个场景、每个跑几次,Day 696 讲怎么判断一个提升是不是真的。不过有一件事是确定的:找发票这一步交给代码以后,它就**不会错**,也能写测试了。

</details>

**验收标准:** `uv run pytest tests/test_bridge.py` 7 条全绿,全部测试 0 failed;`try_bridge.py` 能打出 8 个工具和两种连法的耗时;`one_loop.py` 至少跑通一个场景并打印出每一轮的工具调用;能不看文章说出拆段的四条理由,并且各举一个今天实跑里的例子;能解释 `_run` 为什么要判断「外面有没有事件循环」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 拆段 | 把一个流程按「要不要判断力」切成几段,确定的步骤写成代码,只在需要判断的地方让模型自由发挥,例子:BillSleuth 的 intake → locate → investigate → conclude |
| workflow / agent 混合 | 前后是代码定好的路径,中间一段是模型自己决定下一步的循环 |
| intake | 读懂请求的第一步,这里用结构化输出抽抱怨类型、金额、月份 |
| locate | 用代码在发票列表里找客户说的那张发票 |
| 模型对象 | LangChain 里代表「一个可以调用的模型」的对象,例子:`get_llm()` 返回的 `ChatOpenAI` |
| `SecretStr` | pydantic 的敏感字符串类型,打印出来是 `**********` |
| `max_retries` | SDK 遇到可重试的错误(如 503)时自动重试的次数,间隔越来越长 |
| 思考模式 | DeepSeek 先输出一段推理再回答的模式;开着时不支持强制指定 `tool_choice`,实测报 400 |
| 桥接(bridge) | 在两种调用方式之间做转换的一层代码,这里是「同步的图节点」和「异步的 MCP 客户端」之间 |
| 事件循环正在运行 | 当前线程已经有一个 asyncio 事件循环在跑,这时不能再调 `asyncio.run` |
| `ThreadPoolExecutor` | 标准库的线程池,`submit` 把函数交给另一个线程执行,`.result()` 等它的结果 |
| `sys.executable` | 当前 Python 解释器的完整路径,起子进程时用它,保证用的是同一个虚拟环境 |
| stdio 连接 / 内存连接 | 前者起子进程用标准输入输出通信(实测每次调用约 1.5 秒),后者把 server 对象直接交给客户端(约 15 毫秒) |

## 常见误区

**一个大循环也能查出答案,所以拆段是多余的。** 今天三个场景大循环全查到了点子上,但结论是一段带 markdown 的中文,根因写「重复扣款」而不是 `duplicate_charge`,多收金额要从好几个数里猜。拆段要的不是更聪明,是可测、可评、可对账。

**开着思考模式做结构化输出。** 实测报 `Thinking mode does not support this tool_choice`,400。`.env` 里的 `LLM_EXTRA_BODY` 要关掉思考。

**在已经有事件循环的地方直接 `asyncio.run`。** 实测报 `RuntimeError: asyncio.run() cannot be called from a running event loop`。Jupyter、FastAPI 的 async 接口、`graph.ainvoke` 里都会遇到。`_run` 先判断,有循环就换线程。

**评测时用 stdio 连 MCP。** 实测每次调用 1572 毫秒,内存连接 15 毫秒。一次调查十几次调用,一百个场景就是半小时以上。测试和评测用 `in_process=True`。

**先建 stdio 桥,再设环境变量。** 环境变量在构造时就复制给了子进程,之后改 `os.environ` 子进程看不到,练习 2 实测读到了一个不存在的库。

**拆包时只判断「有没有 result 键」。** 要判断键**正好只有** `result` 一个,否则某个工具的返回结构里真有 `result` 字段时会被误拆。

**跑一次就下结论。** 练习 3 里「开场给列表」在 S011 省了一半 token,在 S023 反而多花了。单次运行噪声很大,要多场景、多次跑。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):workflow 和 agent 的两个定义,以及什么时候该用哪种,重读开头两节,20 分钟。
- [LangGraph · Thinking in LangGraph](https://docs.langchain.com/oss/python/langgraph/thinking-in-langgraph):官方讲怎么把一个业务流程拆成节点,和今天的拆段思路一致,20 分钟。
- [Python 文档 · asyncio 运行器](https://docs.python.org/zh-cn/3.12/library/asyncio-runner.html):`asyncio.run` 的官方说明,里面写了「当有其他 asyncio 事件循环在同一线程中运行时,此函数不能被调用」,中文,10 分钟。
- [Python 文档 · concurrent.futures](https://docs.python.org/zh-cn/3.12/library/concurrent.futures.html):看 `ThreadPoolExecutor` 和 `Future.result` 两节,中文,15 分钟。
- [DeepSeek API 文档 · 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode):思考模式的开关和工具调用时的限制,中文,10 分钟。
- [LangChain · ChatOpenAI](https://docs.langchain.com/oss/python/integrations/chat/openai):`max_retries`、`extra_body` 等参数的说明,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oa411b7c9&autoplay=0&high_quality=1" title="【python】asyncio的理解与入门,搞不明白协程?看这个视频就够了。" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农高天 · 【python】asyncio的理解与入门,搞不明白协程?看这个视频就够了。 · 15 分钟,讲事件循环、协程和 task 的关系。看完就明白为什么一个线程里不能同时有两个事件循环在跑。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1FAWGzVEWF&autoplay=0&high_quality=1" title="Anthropic构建高效agent的第一性原理:精读《Building effective agents》①" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · Anthropic构建高效agent的第一性原理:精读《Building effective agents》① · 11 分钟,中文逐段讲那篇文章的 workflow 和 agent 之分,对照今天的拆段。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents: Barry Zhang, Anthropic · 《Building effective agents》作者之一的现场讲解,他的第一个观点就是「不是什么都要做成 agent」,和今天的结论一致。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/aHCDrAbH_go" title="Building Effective Agents with LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Building Effective Agents with LangGraph · 官方把 workflow 的几种模式和 agent 在 LangGraph 里逐个实现,看 prompt chaining 和 agent 两段,后天写调查图时会用到。</figcaption>
</figure>

### 书籍

- Luciano Ramalho《Fluent Python》第 2 版(O'Reilly, 2022;人民邮电出版社 2023 年中译本《流畅的 Python(第 2 版)》):第 20 章讲 `concurrent.futures` 的线程池,第 21 章讲异步编程,想把 `_run` 里那两个分支彻底弄懂就读这两章。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 讲规划和工具调用,其中「什么时候不要让模型规划」的讨论和今天的拆段对应。

### 开源项目与代码

- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):看 `Client` 的构造逻辑,它怎么根据传进来的是 server 对象、`StdioServerParameters` 还是 URL 选连接方式。
- [langchain-ai/langchain-mcp-adapters](https://github.com/langchain-ai/langchain-mcp-adapters):官方的 MCP → LangChain 工具转换库,和我们二十几行的 `BillingMCP` 对比着看,想想它多做了什么、我们为什么不需要。

## 自测

1. BillSleuth 的调查流程拆成哪几段?哪几段调模型,哪几段只跑代码?

<details><summary>答案</summary>

intake、locate、investigate ⇄ tools、conclude。intake 和 investigate 调模型;locate、tools、conclude 只跑代码(locate 和 tools 会调 MCP 工具,但不调模型)。intake 要理解自然语言所以用模型;locate 是在列表里按金额和月份找发票,确定性的查找用代码;investigate 是唯一需要判断力、转几圈事先不知道的部分;conclude 校验结论格式。

</details>

2. 今天的大循环三个场景都查对了,为什么还要拆段?请至少用一个今天实跑里的现象说明。

<details><summary>答案</summary>

查对不等于可用。一是第 1 轮三个场景都调了 `get_customer` 和 `list_invoices`,这一轮完全不需要判断,交给代码省一次模型调用;二是结论是一段带 markdown 的中文,S017 根因写的是「重复扣款」而不是 `duplicate_charge`,多收金额混在 120.00、123.60、247.20 几个数里,程序没法可靠地和标准答案比;三是大循环里没有一个函数能脱离模型单独测试;四是出了分歧(比如 S023 提到了两张发票)只能翻消息历史定位。

</details>

3. `.env` 里为什么要关掉 DeepSeek 的思考模式?

<details><summary>答案</summary>

intake 用 `with_structured_output(..., method="function_calling")`,它靠 `tool_choice` 强制模型调用一个工具;DeepSeek 思考模式不支持这种 `tool_choice`,实测返回 400「Thinking mode does not support this tool_choice」。另外思考模式下多轮工具调用要回传 `reasoning_content`,框架不一定带上。查账不需要长链思考,关掉更稳也更便宜。

</details>

4. `_run` 里为什么要先 `asyncio.get_running_loop()`?两个分支分别在什么情况下走到?

<details><summary>答案</summary>

`asyncio.run` 会新建一个事件循环,而一个线程同时只能有一个事件循环在跑。当前线程没有循环时(普通脚本、`graph.invoke`),`get_running_loop` 抛 `RuntimeError`,直接 `asyncio.run`。当前线程已有循环时(Jupyter、FastAPI 的 async 接口、`graph.ainvoke`),直接调会报 `asyncio.run() cannot be called from a running event loop`,所以开一个新线程,在新线程里 `asyncio.run`,当前线程用 `.result()` 等结果。

</details>

5. `BillingMCP` 的 stdio 和 in_process 两种连法各适合什么场合?实测差多少?

<details><summary>答案</summary>

stdio 起子进程,和部署时工具层在另一个进程或另一台机器上的形态一致,适合真实部署和联调;in_process 把 server 对象直接交给 `Client`,同进程内走完整协议,适合测试和评测。实测每次调用 stdio 约 1572 毫秒、in_process 约 15 毫秒,差一百倍,因为当前实现每次调用都新起一个 Python 进程。

</details>

6. 面试题:「你的 Agent 用 MCP 调工具,但你的编排框架是同步的。你怎么接?有什么坑?」

<details><summary>答案</summary>

我在中间加了一层很薄的同步桥:每次调用用 `asyncio.run` 跑一个「连上 server、调工具、断开」的协程;如果调用方本身已经在事件循环里(比如 FastAPI 的 async 接口),就把这个 `asyncio.run` 放到一个新线程里执行,当前线程等结果。桥接层同时做两件翻译:把 MCP 的工具清单转成 OpenAI 兼容的 tools 格式,把调用结果统一成「是否成功 + 数据」,顺手拆掉 SDK 给列表包的 `{"result": [...]}`。坑有三个:在运行中的事件循环里直接 `asyncio.run` 会抛 RuntimeError;stdio 方式每次调用都起子进程,我实测 1.5 秒一次,评测要改用进程内连接;stdio 的环境变量在构造时复制,之后再改子进程看不到。长期看,如果并发高,应该把编排也改成全异步,或者让一个常驻连接跨调用复用,而不是每次都新开。

</details>

## 明天预告

明天是 Day 685 · 第 98 周复习:作品(Day 679–684)。BillSleuth 的地基到今天全部打完了:PRD、金额规则、表结构、参考引擎、故障注入、造数、MCP 工具层、模型对象和桥接。在开始写调查图之前,用一天把这六天串成一张图,默写最核心的几段代码,把这一周踩过的坑过一遍。
