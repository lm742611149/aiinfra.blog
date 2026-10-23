---
title: 'Day 334 · 框架横评(二):2026-10 版本现状和面试三题'
description: '这个领域半年一个大版本,所以先用脚本查 PyPI 把十几个框架的最新版摆出来,再把 Pydantic AI v2、Microsoft Agent Framework 1.x、Google ADK 2.x 三个新面孔接到 DeepSeek 上跑同一个任务,和昨天的四个放成一张七行的表。实跑 LangGraph 1.2 的节点超时和错误处理器,并在装好的包里找到各框架主循环的行号,最后用这些亲手拿到的证据回答面试最爱问的三个问题。'
pubDate: 2026-10-23
regime: none
tags: ['framework', 'pydantic-ai', 'google-adk', 'microsoft-agent-framework', 'langgraph', 'agent-zero']
series: 'agent-zero'
day: 334
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 333](/blog/agent-zero/day-333-frameworks-1/) 先画了五层图,又把「查重复扣款」这个任务分别用手写版、LangChain `create_agent`、OpenAI Agents SDK 和 Claude Agent SDK 各跑了一遍。结论有点反直觉:任务简单的时候,四种做法都是 3 次模型请求、几分钱、四五秒,框架既没让你多花钱也没让你省钱;真正的差别在「出了问题你能不能改」,以及框架偷偷替你加了什么(Claude Agent SDK 多了一个起标题的请求、一段环境说明和一个占位工具)。

那一天只比了四个。可你去看招聘要求,会出现的名字远不止这些:Google ADK、微软的 Agent Framework、Pydantic AI、LlamaIndex、CrewAI,还有被说「已经停更」的 AutoGen。今天把这些补齐,方法还是量,不是读宣传稿。

## 今天要解决的问题

学完今天,你要能做到:

1. 用一个脚本查 PyPI,说出 LangChain、LangGraph、Deep Agents、OpenAI Agents SDK、Claude Agent SDK、Google ADK、Microsoft Agent Framework、Pydantic AI 等十几个包 2026 年 10 月的最新版、发布日期,以及每个框架这一年的一件大事。
2. 把 Pydantic AI v2、Microsoft Agent Framework 1.x、Google ADK 2.x 接到 DeepSeek 上跑同一个任务,和昨天的四个放进一张七行的表,并能说出每个框架接 DeepSeek 时撞到的坑。
3. 实跑 LangGraph 1.2 的节点超时(`timeout`)和节点错误处理器(`error_handler`),说清它们解决什么问题。
4. 在装好的包里找到各框架主循环的位置,并用今天的实测证据,回答面试里最常见的三个问题:框架底层怎么实现的、局限在哪、什么时候不用框架。

预计用时 3 小时:查版本和概念 20 分钟,三个新框架各 25 分钟,七行对比 15 分钟,LangGraph 和读源码 30 分钟,练习 1 小时。前置:[Day 333](/blog/agent-zero/day-333-frameworks-1/) 的 `part05/fw/` 全部文件(今天直接 import 它的 `fw_common.py` 和 `compare.py`),[Day 311](/blog/agent-zero/day-311-lg-agent-loop/) 和 [Day 317](/blog/agent-zero/day-317-lg-retry/) 的 LangGraph 节点与重试,[Day 51](/blog/agent-zero/day-051-pydantic-1/)、[Day 52](/blog/agent-zero/day-052-pydantic-2/) 的 pydantic。今天调模型的实跑,每个脚本一次约 0.004–0.005 元,七行对比跑了 21 次约 0.1 元,加上调试合计约 0.3 元。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `fw_pydantic_ai.py` 默写出来,再口头回答一遍面试三题;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 先查现状:一个脚本,十四个包

这个领域半年一个大版本,我写在文章里的版本号,你读到的时候大概率已经过时。所以先写一个脚本,让它去问 PyPI,你随时能自己更新这张表。

```python
# agent-zero-lab/part05/fw/framework_status.py
"""查 PyPI,把一批 Agent 框架的最新版本、发布日期、要求的 Python 版本打成一张表。只用标准库,不花钱。
这个领域半年一个大版本,文章里的版本号一定会过时,跑这个脚本比信文章准。"""
import json
import urllib.request

PACKAGES = [
    ("LangChain", "langchain"),
    ("LangGraph", "langgraph"),
    ("Deep Agents", "deepagents"),
    ("OpenAI Agents SDK", "openai-agents"),
    ("Claude Agent SDK", "claude-agent-sdk"),
    ("Google ADK", "google-adk"),
    ("Microsoft Agent Framework", "agent-framework"),
    ("Pydantic AI", "pydantic-ai"),
    ("LlamaIndex", "llama-index"),
    ("CrewAI", "crewai"),
    ("smolagents", "smolagents"),
    ("AutoGen(已归档)", "autogen-agentchat"),
    ("A2A Python SDK", "a2a-sdk"),
    ("MCP Python SDK", "mcp"),
]


def pad(text: str, width: int) -> str:
    """汉字占两格宽,按显示宽度补空格。"""
    return text + " " * (width - sum(2 if ord(c) > 127 else 1 for c in text))


def latest(pypi_name: str) -> tuple[str, str, str]:
    with urllib.request.urlopen(f"https://pypi.org/pypi/{pypi_name}/json", timeout=20) as resp:
        data = json.load(resp)
    version = data["info"]["version"]
    files = data["releases"][version]
    uploaded = files[0]["upload_time"][:10] if files else "?"
    return version, uploaded, data["info"].get("requires_python") or "?"


if __name__ == "__main__":
    print(pad("框架", 28) + pad("PyPI 包名", 20) + pad("最新版", 10) + pad("发布日期", 12) + "要求的 Python")
    for label, name in PACKAGES:
        version, uploaded, py = latest(name)
        print(pad(label, 28) + pad(name, 20) + pad(version, 10) + pad(uploaded, 12) + py)
```

<div class="line-notes">

- `import json` PyPI 的接口返回 JSON,用标准库解析。
- `import urllib.request` 标准库的 HTTP 客户端,今天只发十几个 GET,不值得装 `httpx`。
- `PACKAGES = [` 要查的包:(显示名, PyPI 上的包名)。显示名和包名常常对不上,比如 Microsoft Agent Framework 的包名是 `agent-framework`,Claude Agent SDK 是 `claude-agent-sdk`。
- `("AutoGen(已归档)", "autogen-agentchat"),` AutoGen 放进来是为了让你看到:它最后一次发版是 2025 年 9 月 30 日,一年多没动了。
- `def pad(text: str, width: int) -> str:` 汉字占两格宽,Python 的格式化按字符数算,表格会歪。这个函数按显示宽度补空格(Day 333 的 `compare.py` 里同一个写法)。
- `return text + " " * (width - sum(2 if ord(c) > 127 else 1 for c in text))` 码点大于 127 的算两格,其余算一格。
- `def latest(pypi_name: str) -> tuple[str, str, str]:` 返回三个字符串:最新版本号、发布日期、要求的 Python 版本。
- `with urllib.request.urlopen(f"https://pypi.org/pypi/{pypi_name}/json", timeout=20) as resp:` PyPI 公开的 JSON 接口,路径固定是 `/pypi/包名/json`,不用 key。`with` 保证请求结束后连接被关掉。
- `data = json.load(resp)` 从响应里直接解析 JSON。
- `version = data["info"]["version"]` `info.version` 就是最新稳定版。
- `files = data["releases"][version]` 这个版本下的文件列表(源码包、各平台的安装包)。
- `uploaded = files[0]["upload_time"][:10] if files else "?"` 取第一个文件的上传时间,截前 10 位就是 `2026-10-21` 这种日期。有的版本没有文件(被撤了),就写问号。
- `return version, uploaded, data["info"].get("requires_python") or "?"` 要求的 Python 版本也在 `info` 里。`crewai` 的写成 `<3.14,>=3.10`,意思是不支持 3.14,要是你机器上 uv 默认装了 Python 3.14,装它会失败,这是个真实的坑。
- `print(pad("框架", 28) + pad("PyPI 包名", 20) + pad("最新版", 10) + pad("发布日期", 12) + "要求的 Python")` 表头。
- `for label, name in PACKAGES:` 一个包一行。
- `version, uploaded, py = latest(name)` 三个返回值一次解构。

</div>

```bash
cd ~/agent-zero-lab/part05/fw
uv run python framework_status.py
```

```text
框架                        PyPI 包名           最新版    发布日期    要求的 Python
LangChain                   langchain           1.4.7     2026-10-21  <4.0.0,>=3.10.0
LangGraph                   langgraph           1.2.16    2026-10-16  >=3.10
Deep Agents                 deepagents          0.7.30    2026-10-22  <4.0,>=3.11
OpenAI Agents SDK           openai-agents       0.24.0    2026-10-15  >=3.10
Claude Agent SDK            claude-agent-sdk    0.2.173   2026-10-22  >=3.10
Google ADK                  google-adk          2.12.0    2026-10-13  >=3.11
Microsoft Agent Framework   agent-framework     1.23.0    2026-10-22  >=3.10
Pydantic AI                 pydantic-ai         2.60.0    2026-10-23  >=3.11
LlamaIndex                  llama-index         0.14.25   2026-09-21  <4.0,>=3.10
CrewAI                      crewai              1.15.28   2026-10-14  <3.14,>=3.10
smolagents                  smolagents          1.26.0    2026-05-29  >=3.10
AutoGen(已归档)             autogen-agentchat   0.7.5     2025-09-30  >=3.10
A2A Python SDK              a2a-sdk             1.2.3     2026-10-19  >=3.10
MCP Python SDK              mcp                 2.3.0     2026-10-02  >=3.10
```

一行一行读,每个我都对着官方页面核了一件大事(「2026 年 10 月 23 日」是我查的日子):

**LangChain 1.4.7 / LangGraph 1.2.16。** LangGraph 1.0 的官方说法是「稳定性优先的发布」:状态、节点、边这些核心概念和执行模型不变,只改类型安全和易用性;`create_react_agent` 被弃用,换成 LangChain 的 `create_agent`(Day 333 用的就是它)。1.2 系列加了什么,我没在官方页面上找到整理好的说明,所以直接看装好的包:`StateGraph.add_node` 的签名里确实有 `timeout` 和 `error_handler` 两个参数,下面「第 5 步」实跑。

**Deep Agents 0.7.30。** LangChain 在 LangGraph 上做的现成 harness,定位和 Claude Agent SDK 类似但不绑模型。0.7 的[官方博客](https://www.langchain.com/blog/deep-agents-v0-7)说:删掉了基础系统提示词,内置工具描述缩短 43%,todo 中间件改成可选;一个默认 Agent 一轮的基础输入从约 6k 降到约 2k token,降幅 65%,「效果保持相当」。这个结论对你自己写 Agent 也成立:系统提示词和工具描述每一轮都要付钱,写长了不一定更好。

**OpenAI Agents SDK 0.24.0。** 官方文档首页现在把 Agents、Handoffs、Guardrails、Sessions、Tracing 和 Sandbox agents(在隔离工作区里干活的专员)列为核心。同一时期 OpenAI 的[弃用页](https://developers.openai.com/api/docs/deprecations)写着:可视化搭建工具 Agent Builder 2026 年 6 月 3 日宣布弃用,11 月 30 日下线,建议迁到 Agents SDK 或 ChatGPT 的 Workspace Agents,ChatKit 保留。2025 年 10 月才推出的东西,一年不到就收了。写在代码里的 SDK 留下来了,这是个很好的面试素材:平台型低代码工具的风险,不只是表达力不够,还有厂商随时可能收掉它。

**Claude Agent SDK 0.2.173。** 官方概览的第一句是「把 Claude Code 当作库」,Day 333 已经从抓包里看到了它的代价和安全问题。

**Google ADK 2.12.0。** ADK 2.0 的[官方页面](https://adk.dev/2.0/)说,最大变化是引入 Workflow Runtime,把执行器「从层级式 Agent 执行器变成图执行引擎」,Agent、工具、函数都是图里的一个节点。GA 日期:Python 2026 年 5 月 19 日、Go 6 月 30 日、TypeScript 8 月 21 日;页面上没写 Java。听上去很像 LangGraph,装好之后看包里的文件也确实是:`workflow` 目录里有 `Workflow`、`Edge`、`JoinNode`、`RetryConfig`,甚至有一个和 LangGraph 同名的 `NodeTimeoutError`(练习 1 去找它们)。两家往同一个方向收敛了。

**Microsoft Agent Framework 1.23.0。** [1.0 在 2026 年 4 月 3 日发布](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/),.NET 和 Python 都有,官方承诺「长期支持」和「完全向后兼容」。它把 Semantic Kernel 的企业基础和 AutoGen 的编排模式合在一个 SDK 里,内置顺序、并发、handoff、群聊和 Magentic-One 几种编排,支持 MCP;A2A 在那篇发布文章里写的是「1.0 即将支持」。AutoGen 自己的仓库 README 现在写的是「项目已归档,不再维护」,「新用户请从 Microsoft Agent Framework 开始」。所以你再遇到 AutoGen 的老教程,知道它已经停在原地了。

**Pydantic AI 2.60.0。** 你在 [Day 51](/blog/agent-zero/day-051-pydantic-1/) 用过的 pydantic 的同一个团队做的 Agent 框架。官方页面上的说法是 typed(类型化)、model-agnostic(不绑模型)、capabilities(把工具、钩子、指令、模型设置打包成一个可复用的单位)、durable execution(能跑在 Temporal、DBOS、Prefect 这类持久化引擎上)。v2 在 2026 年 6 月 23 日发布,版本政策页写明 v1 的安全修复至少再给 6 个月。今天你会亲手撞到 v2 一处不兼容的改动。

**LlamaIndex 0.14.25 / CrewAI 1.15.28 / smolagents 1.26.0。** LlamaIndex 起家于 RAG,数据接入是强项,版本号还是 0.x(定位我沿用对它的一般印象,没有重新核对官方页面)。CrewAI 的[官方介绍](https://docs.crewai.com/en/introduction)回答「Crews 还是 Flows」的话是「两个都用」,生产应用从 Flow 开始搭,Flow 里需要一队自主 Agent 时再放 Crew。smolagents 的 README 说自己是「一个让 Agent 用代码思考的极简库」,CodeAgent 的动作写成 Python 代码而不是 JSON 工具调用;它 2026 年 5 月之后没发新版,但「写代码来调工具」这个思路被很多框架借走了。

**A2A Python SDK 1.2.3 / MCP Python SDK 2.3.0。** 这两个不是框架,是第 ② 层的协议。你前面一路在用的 `mcp` 2.3.0 是 10 月 2 日发的。

这张表里藏着一个选型的小信息:`google-adk`、`pydantic-ai`、`deepagents` 要求 Python 3.11 以上,`crewai` 要求低于 3.14。本课规定的 Python 3.12 刚好都在范围里;如果你的 uv 不小心装了 3.14,CrewAI 就装不上了。

## 准备

接着 `part05/fw/`。在练习仓库根目录装今天三个新框架。Pydantic AI 装精简版 `pydantic-ai-slim` 加 OpenAI 兼容模型要用的 `openai` 额外依赖,避免把所有厂商的 SDK 都拉进来:

```bash
cd ~/agent-zero-lab
uv add "pydantic-ai-slim[openai]"
uv add agent-framework-core agent-framework-openai
uv add google-adk litellm
```

`google-adk` 那一步 uv 会打印 `- websockets==16.1.1`、`+ websockets==15.0.1`:ADK 要求 `websockets>=15.0.1,<16`,所以把你已经装的 16.1.1 降了级。这是依赖管理的日常,不用慌,但说明装一个框架可能改变别的包的版本,[Day 11](/blog/agent-zero/day-011-uv-2/) 讲的 `uv.lock` 在这时候最有用。

版本是 2026 年 10 月 23 日装到的:`pydantic-ai-slim` 2.60.0、`agent-framework-core` 1.23.0、`agent-framework-openai` 1.17.0、`google-adk` 2.12.0、`litellm` 1.83.0。任务、工具、提示词和算钱的办法全部沿用昨天的 `fw_common.py`。

## 第 1 步:Pydantic AI v2

Pydantic AI 的卖点是类型:工具是带类型标注的普通函数,Agent 的输出也可以是一个 pydantic 类(练习 3 会做)。先用最朴素的版本跑同一个任务。

```python
# agent-zero-lab/part05/fw/fw_pydantic_ai.py
"""同一个任务 · Pydantic AI v2。工具是带类型标注的普通函数,模型通过 OpenAI 兼容接口接 DeepSeek。"""
import json
import os
import time

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")  # 关掉启动时打印的那个大横幅
from pydantic_ai import Agent  # noqa: E402
from pydantic_ai.models.openai import OpenAIChatModel  # noqa: E402
from pydantic_ai.providers.openai import OpenAIProvider  # noqa: E402
from pydantic_ai.settings import ModelSettings  # noqa: E402

from fw_common import SYSTEM, TASK, find_customer, list_invoices, report

model = OpenAIChatModel(
    os.environ["LLM_MODEL"],
    provider=OpenAIProvider(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"]),
    settings=ModelSettings(temperature=0, extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))),
)
agent = Agent(model, instructions=SYSTEM, tools=[find_customer, list_invoices])

if __name__ == "__main__":
    t0 = time.perf_counter()
    result = agent.run_sync(TASK)
    seconds = time.perf_counter() - t0
    print(result.output)
    u = result.usage  # 属性,不是方法
    report("Pydantic AI", u.requests, u.input_tokens, u.cache_read_tokens, u.output_tokens, seconds)
```

<div class="line-notes">

- `os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")  # 关掉启动时打印的那个大横幅` 第一次跑时终端里先刷出一个 ASCII 艺术的横幅和「去开通 Logfire」的广告。这个环境变量要在 import `pydantic_ai` **之前**设,所以后面几行 import 都得加 `# noqa: E402`(告诉 Ruff import 不在文件开头是故意的)。`setdefault` 的意思是没设过才设,你自己设了就不覆盖。
- `from pydantic_ai import Agent  # noqa: E402` Agent 类。
- `from pydantic_ai.models.openai import OpenAIChatModel  # noqa: E402` 说 OpenAI 协议(Chat Completions)的模型类,DeepSeek 兼容这个协议。
- `from pydantic_ai.providers.openai import OpenAIProvider  # noqa: E402` Pydantic AI 把「模型」和「怎么连到哪个服务」拆成两层:Model 管协议,Provider 管地址和 key。
- `from pydantic_ai.settings import ModelSettings  # noqa: E402` 温度、`extra_body` 这类请求参数放在这里。
- `model = OpenAIChatModel(` 模型对象。第一个位置参数是模型名,实测是 `deepseek-flash`。
- `provider=OpenAIProvider(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"]),` 指向 DeepSeek 的地址和 key。
- `settings=ModelSettings(temperature=0, extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))),` 昨天 Agents SDK 的教训:关思考的 `extra_body` 要放在框架认的地方。这里的 `ModelSettings` 认 `extra_body`,抓包能看到它进了请求。
- `agent = Agent(model, instructions=SYSTEM, tools=[find_customer, list_invoices])` 全部配置一行:模型、指令、工具。工具直接传 Day 284 的函数,它从函数签名和 docstring 生成 schema。实测启动信息里写着 `tools: 2`。
- `result = agent.run_sync(TASK)` 同步跑到结束。内部是个状态机,「第 4 步」会找到它的节点。
- `print(result.output)` 最终输出。没有指定 `output_type` 时就是一段字符串。
- `u = result.usage  # 属性,不是方法` **这一行是我撞了坑改过来的**,见下面。`usage` 在 v2 里是属性,字段有 `requests`、`input_tokens`、`cache_read_tokens`、`output_tokens`。
- `report("Pydantic AI", u.requests, u.input_tokens, u.cache_read_tokens, u.output_tokens, seconds)` 沿用 Day 333 的报数函数。实测请求 3 次,输入 2069(命中缓存),输出 427。

</div>

我最开始把用量那行写成了 `result.usage()`,这是 Pydantic AI v1 的写法,抄旧教程很容易抄成这样。v2 里它变成了属性,报错是:

```text
Traceback (most recent call last):
  File ".../part05/fw/fw_pydantic_ai.py", line 27, in <module>
    u = result.usage()
        ^^^^^^^^^^^^^^
TypeError: 'RunUsage' object is not callable
```

`'RunUsage' object is not callable` 的意思是:`result.usage` 已经是一个 `RunUsage` 对象了,你又在后面加了括号去「调用」它,对象不能被调用。去掉括号就好。这是这个领域「照抄旧教程就报错」的又一个活例子,和 Day 333 提过的 `create_react_agent`、`FastMCP` 改名是同一类事。

```bash
uv run python fw_pydantic_ai.py
```

输出的最后一行:

```text
[Pydantic AI] 模型请求 3 次,输入 2069(命中缓存 1536),输出 427,约 0.0046 元,用时 3.8 秒
```

(回答正文和昨天那几个大同小异,指出 INV-2026-0123 和 INV-2026-0026 重复,我就不再贴了。)

## 第 2 步:Microsoft Agent Framework

微软这个有点特别:Python 版的 `Agent` 把「客户端」和「Agent」分开,客户端负责和模型说话,Agent 负责循环和工具。接 DeepSeek 要用它的 Chat Completions 客户端 `OpenAIChatCompletionClient`(它还有一个走 Responses API 的 `OpenAIChatClient`,DeepSeek 不支持)。

```python
# agent-zero-lab/part05/fw/fw_msaf.py
"""同一个任务 · Microsoft Agent Framework 1.x(Python)。用它的 Chat Completions 客户端接 DeepSeek。"""
import asyncio
import json
import os
import time
from typing import Any

from agent_framework import Agent
from agent_framework.openai import OpenAIChatCompletionClient
from openai import AsyncOpenAI

from fw_common import SYSTEM, TASK, find_customer, list_invoices, report

EXTRA_BODY = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
raw = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
_create = raw.chat.completions.create


async def create_with_extra(*args: Any, **kwargs: Any) -> Any:
    """它的 options 里没有地方放 extra_body,只好在 openai 客户端的 create 外面包一层,每次请求补上。"""
    kwargs.setdefault("extra_body", EXTRA_BODY)
    return await _create(*args, **kwargs)


raw.chat.completions.create = create_with_extra  # type: ignore[method-assign]  # pyright: ignore[reportAttributeAccessIssue]
agent = Agent(
    OpenAIChatCompletionClient(model=os.environ["LLM_MODEL"], async_client=raw),
    instructions=SYSTEM,
    tools=[find_customer, list_invoices],
    default_options={"temperature": 0},
)


async def main() -> None:
    t0 = time.perf_counter()
    response = await agent.run(TASK)
    seconds = time.perf_counter() - t0
    print(response.text)
    u = response.usage_details or {}
    requests = sum(1 for m in response.messages if m.role == "assistant")  # 每次模型请求对应一条助手消息
    report("Agent Framework", requests, u.get("input_token_count") or 0, u.get("cache_read_input_token_count") or 0,
           u.get("output_token_count") or 0, seconds)


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from agent_framework import Agent` Agent 类,包名叫 `agent-framework-core`,import 名是 `agent_framework`。
- `from agent_framework.openai import OpenAIChatCompletionClient` OpenAI 家的客户端放在 `agent_framework.openai` 里,是另一个包 `agent-framework-openai` 提供的。「核心 + 各家适配」分成几个包,这是 1.0 的结构。
- `from openai import AsyncOpenAI` 下面要自己建一个 openai 异步客户端,原因就在后面几行。
- `EXTRA_BODY = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` 还是那段关思考的 JSON。
- `raw = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])` 自己建的客户端,稍后塞给微软的客户端用。
- `_create = raw.chat.completions.create` 先把原来的 `create` 方法存起来。
- `async def create_with_extra(*args: Any, **kwargs: Any) -> Any:` 新的 `create`:不管框架传什么进来,都原样转给原方法,只多补一个参数。`*args, **kwargs` 是「收下所有位置参数和关键字参数」。
- `"""它的 options 里没有地方放 extra_body,只好在 openai 客户端的 create 外面包一层,每次请求补上。"""` 我一开始想把 `extra_body` 放进 `default_options`,类型检查直接说没有这个字段,翻了一遍选项类的注解(`temperature`、`max_tokens`、`tools` 等二十几个),确实没有。又试了 `agent.run(..., client_kwargs=...)`,抓包看请求里还是没有 `thinking`,思考模式开着,输出 955 个 token、用时 6.7 秒。所以只能走这条绕路。
- `kwargs.setdefault("extra_body", EXTRA_BODY)` 调用方没传 `extra_body` 才补,传了就尊重它。
- `return await _create(*args, **kwargs)` 转给原方法。
- `raw.chat.completions.create = create_with_extra  # type: ignore[method-assign]  # pyright: ignore[reportAttributeAccessIssue]` 把实例上的方法替换成我们的版本,Python 允许这样做,类型检查器不喜欢,所以两个忽略注释。这是个「能用但丑」的补丁,真实项目里更好的办法是给 `AsyncOpenAI` 传一个自定义的 `http_client`,在 HTTP 层改请求体。
- `agent = Agent(` 微软的 `Agent` 构造函数第一个参数是客户端。
- `OpenAIChatCompletionClient(model=os.environ["LLM_MODEL"], async_client=raw),` 把我们包过的客户端交给它。
- `instructions=SYSTEM,` 系统提示词也叫 `instructions`,和 OpenAI Agents SDK、Pydantic AI 一致。
- `tools=[find_customer, list_invoices],` 工具直接传函数,从签名和 docstring 生成 schema。抓包看到它把 pydantic `Field` 的描述、正则都带进了 schema,和 LangChain 一样。
- `default_options={"temperature": 0},` 默认选项,温度设 0。
- `response = await agent.run(TASK)` 异步跑完,返回 `AgentResponse`。
- `u = response.usage_details or {}` 用量是个字典,键是 `input_token_count`、`output_token_count`、`cache_read_input_token_count`,取不到就是空字典。
- `requests = sum(1 for m in response.messages if m.role == "assistant")` 响应里没有直接给「请求次数」,我用助手消息的条数估:每次模型请求回一条助手消息,实测 3 条。
- `report("Agent Framework", requests, u.get("input_token_count") or 0, u.get("cache_read_input_token_count") or 0,` `or 0` 把可能的 `None` 换成 0,类型检查才满意。实测输入 2261,命中缓存 1792。

</div>

```bash
uv run python fw_msaf.py
```

```text
[Agent Framework] 模型请求 3 次,输入 2261(命中缓存 1792),输出 358,约 0.0039 元,用时 3.6 秒
```

这个框架启动时还有一个小插曲:它用标准库 `logging` 往外打每次工具调用的 INFO 日志(`Function name: list_invoices` 之类),被 Day 284 `server.py` 装在根日志器上的 Rich 处理器接住,刷了一屏。所以 `fw_common.py` 的静音名单里要加上 `agent_framework`;今天一并加了 `LiteLLM` 和 `litellm`,下一步 ADK 会用到。

## 第 3 步:Google ADK 2.x

ADK 的模型层直连 Gemini。接 DeepSeek 要借 LiteLLM,一个把几十家模型厂商统一成 OpenAI 格式的转接库。

```python
# agent-zero-lab/part05/fw/fw_adk.py
"""同一个任务 · Google ADK 2.x。ADK 自己只直连 Gemini,接 DeepSeek 要借 LiteLLM 这个转接层。"""
import asyncio
import json
import os
import time

from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import InMemoryRunner
from google.genai import types

from fw_common import SYSTEM, TASK, find_customer, list_invoices, report

model = LiteLlm(
    model="openai/" + os.environ["LLM_MODEL"],  # litellm 的写法:「厂商前缀/模型名」,openai/ 表示走 OpenAI 兼容协议
    api_base=os.environ["LLM_BASE_URL"],
    api_key=os.environ["LLM_API_KEY"],
    temperature=0,
    extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
)
agent = Agent(name="billing", model=model, instruction=SYSTEM, tools=[find_customer, list_invoices])


async def main() -> None:
    runner = InMemoryRunner(agent=agent, app_name="fw_demo")
    session = await runner.session_service.create_session(app_name="fw_demo", user_id="u1")
    t0 = time.perf_counter()
    requests = prompt = hit = out = 0
    final = ""
    async for event in runner.run_async(user_id="u1", session_id=session.id,
                                        new_message=types.Content(role="user", parts=[types.Part(text=TASK)])):
        if event.usage_metadata:  # 每次模型请求对应一个带用量的事件
            requests += 1
            prompt += event.usage_metadata.prompt_token_count or 0
            hit += event.usage_metadata.cached_content_token_count or 0
            out += event.usage_metadata.candidates_token_count or 0
        if event.is_final_response() and event.content and event.content.parts:
            final = event.content.parts[0].text or ""
    print(final)
    report("Google ADK", requests, prompt, hit, out, time.perf_counter() - t0)


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from google.adk.agents import Agent` `Agent` 是 `LlmAgent` 的别名,最常用的那种 Agent。
- `from google.adk.models.lite_llm import LiteLlm` ADK 内置的 LiteLLM 适配,要先装 `litellm` 包。
- `from google.adk.runners import InMemoryRunner` Runner 负责跑 Agent;「InMemory」的意思是会话、记忆都放内存里,进程退出就没了,适合试验。
- `from google.genai import types` ADK 的消息格式沿用 Google 的 `genai` 库,所以用户消息要用 `types.Content` 包一层。
- `model = LiteLlm(` 模型对象。
- `model="openai/" + os.environ["LLM_MODEL"],  # litellm 的写法:「厂商前缀/模型名」,openai/ 表示走 OpenAI 兼容协议` LiteLLM 靠前缀决定走哪家的协议。DeepSeek 兼容 OpenAI,所以写 `openai/deepseek-flash`,再用 `api_base` 指到 DeepSeek 的地址。
- `api_base=os.environ["LLM_BASE_URL"],` 地址。
- `extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),` 额外的参数 LiteLLM 会原样传给底层的 `completion` 调用。
- `agent = Agent(name="billing", model=model, instruction=SYSTEM, tools=[find_customer, list_invoices])` 注意这里系统提示词的参数叫 `instruction`(单数),OpenAI Agents SDK、微软、Pydantic AI 叫 `instructions`(复数),三个框架三种写法。必须有 `name`。
- `runner = InMemoryRunner(agent=agent, app_name="fw_demo")` 给 Agent 配一个 Runner,`app_name` 随便起。
- `session = await runner.session_service.create_session(app_name="fw_demo", user_id="u1")` ADK 的对话必须挂在会话上,先建一个。这是它和前几个框架最不一样的地方:前几个是一次函数调用,ADK 是「应用 → 用户 → 会话」三层。
- `requests = prompt = hit = out = 0` 链式赋值,四个计数器都置 0。
- `async for event in runner.run_async(` 运行是个异步生成器,每发生一件事就吐一个 `event`。
- `new_message=types.Content(role="user", parts=[types.Part(text=TASK)])):` 用户消息按 Google 的格式包装:一个 `Content`,里面有若干 `Part`。
- `if event.usage_metadata:  # 每次模型请求对应一个带用量的事件` 只有模型回复的事件带用量,工具结果事件没有。
- `requests += 1` 数一次请求。实测 3 次。
- `hit += event.usage_metadata.cached_content_token_count or 0` 命中缓存的输入,实测 1152 到 1792,和别的版本同一量级。
- `if event.is_final_response() and event.content and event.content.parts:` 最后一个事件才是给用户的最终回答。三个条件逐个判断,是因为中间的事件可能没有 `content`。
- `final = event.content.parts[0].text or ""` 取第一个文本块。

</div>

```bash
uv run python fw_adk.py
```

```text
[Google ADK] 模型请求 3 次,输入 2278(命中缓存 1792),输出 420,约 0.0044 元,用时 7.3 秒
```

它是七个里最慢的:7 到 8 秒,别的 3.5 到 4.5 秒。我第一次跑时 12.5 秒,因为 LiteLLM 第一次加载要初始化一大堆东西。这类「中间多一层转接」的代价,就是延迟和多出来的依赖(`litellm` 一个包就把 `tokenizers`、`tqdm` 等一批东西拉了进来)。ADK 直接用 Gemini 时不会有这层。

## 第 4 步:七行放一起

把昨天的 `compare.py` 拿来用:它定义了怎么跑一个脚本、怎么从输出里抠数字。今天写一个加长版,把七个都跑 3 遍。

```python
# agent-zero-lab/part05/fw/compare_all.py
"""昨天 compare.py 的加长版:在原来四个做法后面,再加今天的三个框架,七个各跑 N 遍。"""
import statistics
import sys

from compare import SCRIPTS, pad, rpad, run_once  # Day 333 建的 compare.py

N = int(sys.argv[1]) if len(sys.argv) > 1 else 3
ALL = {**SCRIPTS, "Pydantic AI": "fw_pydantic_ai.py", "Agent Framework": "fw_msaf.py", "Google ADK": "fw_adk.py"}

if __name__ == "__main__":
    print(pad("做法", 20) + rpad("请求", 5) + rpad("输入", 7) + rpad("输出", 6) + rpad("元", 9) + rpad("秒", 6)
          + f"  (每个跑 {N} 遍,取平均)")
    for name, script in ALL.items():
        rows = [run_once(script) for _ in range(N)]
        avg = [statistics.mean(r[i] for r in rows) for i in range(6)]
        print(pad(name, 20) + f"{avg[0]:>5.0f}{avg[1]:>7.0f}{avg[3]:>6.0f}{avg[4]:>9.4f}{avg[5]:>6.1f}")
```

<div class="line-notes">

- `from compare import SCRIPTS, pad, rpad, run_once  # Day 333 建的 compare.py` 直接 import 昨天的函数和字典,不复制。`compare.py` 底部有 `if __name__ == "__main__":`,所以 import 它不会触发它自己的主程序。
- `ALL = {**SCRIPTS, "Pydantic AI": "fw_pydantic_ai.py", "Agent Framework": "fw_msaf.py", "Google ADK": "fw_adk.py"}` `{**a, 新键: 值}` 把昨天的四项摊开再加三项,得到一个七项的新字典。
- `print(pad("做法", 20) + rpad("请求", 5) + rpad("输入", 7) + rpad("输出", 6) + rpad("元", 9) + rpad("秒", 6)` 表头,汉字按显示宽度对齐。
- `for name, script in ALL.items():` 七个依次跑。
- `rows = [run_once(script) for _ in range(N)]` 每个脚本跑 N 遍,`run_once` 会在 Claude 那个前面自动加沙箱前缀。

</div>

```bash
uv run python compare_all.py 3
```

```text
做法                 请求   输入  输出       元    秒  (每个跑 3 遍,取平均)
手写                    3   1782   435   0.0049   4.2
LangChain               3   2098   421   0.0048   3.8
OpenAI Agents SDK       3   1898   394   0.0042   3.7
Claude Agent SDK        3   2549   649   0.0078   6.5
Pydantic AI             3   2069   427   0.0046   3.8
Agent Framework         3   2261   480   0.0049   3.8
Google ADK              3   2278   426   0.0044   7.8
```

七个做法、21 次运行、约 0.1 元的结果。读这张表,我想说三件事。

**第一,绝大多数框架在这个任务上是一个水平。** 请求都是 3 次,输入 1782 到 2278,花费 0.0042 到 0.0049 元,用时 3.7 到 4.2 秒。这又一次说明,简单任务上框架不决定成本。手写版 0.0049 元并不比 LangChain 的 0.0048 元便宜多少。

**第二,有两个是离群点。** Claude Agent SDK 0.0078 元、6.5 秒:前天抓包看到的多一个起标题的请求、更长的系统提示词和环境块,今天的平均数里仍然在。Google ADK 7.8 秒,慢在 LiteLLM 那一层。

**第三,花钱最少的是 OpenAI Agents SDK(0.0042 元),但别急着当结论。** 它的输入只有 1898、输出 394,是因为它那一轮的模型回答碰巧短一些。输出 token 的价格是输入的四倍,几十个 token 的波动就能让名次变化。再强调一次:这个量级的差别,别拿来选型。

下面这些才是选型要看的,而且全都是今天亲手撞出来的:

| 框架 | 接 DeepSeek 时撞到的 | 这说明什么 |
| --- | --- | --- |
| LangChain | 无,`extra_body` 是 `ChatOpenAI` 的参数 | 适配最成熟 |
| OpenAI Agents SDK | 默认走 Responses API 和 tracing 上传;不传 `ModelSettings` 思考模式就开着 | 默认为 OpenAI 自家设计,换厂商要多配几处 |
| Claude Agent SDK | 要走 Anthropic 兼容地址;多一个标题请求;读家目录配置 | 为 Claude 设计,要隔离 |
| Pydantic AI | 无,`ModelSettings` 直接认 `extra_body`;但 v2 里 `usage()` 变成了属性 | 类型严,版本升级有不兼容 |
| Agent Framework | options 里没有 `extra_body`,得包一层 `create` | 选项是封闭的,没留后门 |
| Google ADK | 要借 LiteLLM;`instruction` 单数;会话三层 | 直连 Gemini 最顺,其他厂商多一层 |

## 第 5 步:LangGraph 1.2 的节点超时和错误处理器

七个框架里,LangGraph 是前面五周你一直在用的。1.2 系列的两个新能力,都是生产里真会碰到的:一个节点卡住了怎么办,一个节点失败了怎么办。不调模型,用一个故意很慢的节点演示。

```python
# agent-zero-lab/part05/fw/lg12_timeout.py
"""LangGraph 1.2 的两样新东西:节点级超时(timeout)和节点级错误处理器(error_handler)。不调模型。
一个故意很慢的节点 slow_lookup(睡 2 秒,假装在等一个卡住的下游),给它设 0.5 秒超时。"""
import asyncio
import time
from typing import TypedDict

from langgraph.errors import NodeError, NodeTimeoutError
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, RetryPolicy


class State(TypedDict):
    answer: str


async def slow_lookup(state: State) -> dict:
    await asyncio.sleep(2)  # 假装下游卡住了
    return {"answer": "查到了"}


async def fallback(state: State, error: NodeError) -> Command:
    """节点失败后由它收场:把失败原因写进状态,而不是让整个图崩掉。"""
    return Command(update={"answer": f"降级回答:节点 {error.node} 失败,原因 {type(error.error).__name__}"})


def build(with_handler: bool):
    g = StateGraph(State)
    g.add_node("slow_lookup", slow_lookup, timeout=0.5,
               retry_policy=RetryPolicy(max_attempts=2, initial_interval=0.1, jitter=False),
               error_handler=fallback if with_handler else None)  # pyright: ignore[reportArgumentType]  # 官方示例就是这样写,类型标注还没跟上
    g.add_edge(START, "slow_lookup")
    g.add_edge("slow_lookup", END)
    return g.compile()


async def main() -> None:
    for with_handler in (False, True):
        t0 = time.perf_counter()
        try:
            out = await build(with_handler).ainvoke({"answer": ""})
            print(f"有错误处理器={with_handler}:正常结束,{out},用时 {time.perf_counter() - t0:.2f} 秒")
        except NodeTimeoutError as e:
            print(f"有错误处理器={with_handler}:抛出 NodeTimeoutError:{e},用时 {time.perf_counter() - t0:.2f} 秒")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `from langgraph.errors import NodeError, NodeTimeoutError` `NodeTimeoutError` 是节点超时抛的异常;`NodeError` 是传给错误处理器的「失败现场」,里面有出事的节点名和异常对象。
- `from langgraph.types import Command, RetryPolicy` `Command` 是 [Day 309](/blog/agent-zero/day-309-lg-command/) 学的,「改状态 + 指定下一步」;`RetryPolicy` 是 [Day 317](/blog/agent-zero/day-317-lg-retry/) 学的重试策略。
- `async def slow_lookup(state: State) -> dict:` 故意写得很慢的节点。
- `await asyncio.sleep(2)  # 假装下游卡住了` 睡 2 秒。**注意要用异步的 `asyncio.sleep`,不能用 `time.sleep`**:LangGraph 的超时靠 asyncio 的取消实现,同步的 `time.sleep` 会堵住事件循环,超时要等它睡醒才能触发。源码里 `TimeoutPolicy` 的说明写着这条。
- `async def fallback(state: State, error: NodeError) -> Command:` 错误处理器:第一个参数是状态,第二个参数标注成 `NodeError`,LangGraph 看到这个类型标注就会把失败现场传进来(「按类型注入参数」)。
- `return Command(update={"answer": f"降级回答:节点 {error.node} 失败,原因 {type(error.error).__name__}"})` 不让图崩掉,而是把失败写进状态,给用户一个降级的回答。实测 `error.node` 是 `slow_lookup`,`type(error.error).__name__` 是 `NodeTimeoutError`。
- `def build(with_handler: bool):` 造两张图:一张没有错误处理器,一张有。
- `g.add_node("slow_lookup", slow_lookup, timeout=0.5,` 给这个节点设 0.5 秒超时。`timeout` 可以是一个数字(秒),也可以是 `TimeoutPolicy`(分 `run_timeout` 硬上限和 `idle_timeout` 无进展上限)。
- `retry_policy=RetryPolicy(max_attempts=2, initial_interval=0.1, jitter=False),` 超时抛的 `NodeTimeoutError` 会被默认的重试策略当成可重试的错误,所以最多试 2 次,间隔 0.1 秒,关掉抖动让耗时好算:0.5 + 0.1 + 0.5 = 1.1 秒。
- `error_handler=fallback if with_handler else None)  # pyright: ignore[reportArgumentType]  # 官方示例就是这样写,类型标注还没跟上` 重试用完还失败,才轮到错误处理器。类型检查器对这个参数的签名报错,官方文档的示例就是这么写的,是库的类型标注没跟上,加了忽略注释。
- `g.add_edge(START, "slow_lookup")` 只有一个节点的最小图。
- `g.add_edge("slow_lookup", END)` 节点走完就结束。
- `return g.compile()` 编译成可运行的图。
- `out = await build(with_handler).ainvoke({"answer": ""})` 异步调用。
- `except NodeTimeoutError as e:` 没有错误处理器时,重试用完异常会一路抛出来,在这里接住打印。

</div>

```bash
uv run python lg12_timeout.py
```

```text
有错误处理器=False:抛出 NodeTimeoutError:Node 'slow_lookup' exceeded its run timeout of 0.500s (elapsed: 0.503s).,用时 1.11 秒
有错误处理器=True:正常结束,{'answer': '降级回答:节点 slow_lookup 失败,原因 NodeTimeoutError'},用时 1.12 秒
```

没有错误处理器时,节点试了两次、各 0.5 秒都超时,总共 1.11 秒后异常抛了出来,调用方拿到的是一个 `NodeTimeoutError`。有错误处理器时,同样的 1.1 秒,图正常结束了,状态里是我们写的降级回答。**重试用的是同一个超时设置,先重试、重试耗尽才去错误处理器,这个顺序要记住。**

这两个东西在手写版里要自己写 `asyncio.wait_for`、`try/except`、重试循环,每个节点都写一遍。框架给的是把它们变成节点的一个参数。再回头看昨天练习 4 里的「模型调用次数上限」,也是同类:**框架真正的价值是这类横切的能力(超时、重试、降级、次数上限、审批),不是省那十几行循环代码。**

## 第 6 步:在装好的包里找主循环

面试官问「框架底层怎么实现的」,最好的回答是:我自己找过。办法很朴素:在装好的包里,对每个框架找一个关键文件、一条正则,打印行号。

```python
# agent-zero-lab/part05/fw/peek_source.py
"""「框架底层怎么实现的」不用猜:在装好的包里找到关键代码,打印文件和行号。
找法:对每个框架给一个文件和一条正则,打印第一个匹配的行。读源码就从这些行号开始。"""
import re
import site
from pathlib import Path

SITE = Path(site.getsitepackages()[0])  # 当前虚拟环境的 site-packages
TARGETS = [
    ("LangChain create_agent 建图", "langchain/agents/factory.py", r'graph\.add_node\("model"'),
    ("LangChain 工具节点", "langchain/agents/factory.py", r'graph\.add_node\("tools"'),
    ("OpenAI Agents SDK 默认最大轮数", "agents/run_config.py", r"^DEFAULT_MAX_TURNS"),
    ("OpenAI Agents SDK Runner 主循环", "agents/run.py", r"^\s+while True:"),
    ("OpenAI Agents SDK 超轮数报错", "agents/run.py", r"MaxTurnsExceeded\(f"),
    ("Agent Framework 默认最大迭代数", "agent_framework/_tools.py", r"^DEFAULT_MAX_ITERATIONS"),
    ("Agent Framework 工具调用循环", "agent_framework/_tools.py", r"for attempt_idx in range\(attempt_start, max_iterations\)"),
    ("Pydantic AI 状态机节点一:处理用户输入", "pydantic_ai/_agent_graph.py", r"^class UserPromptNode"),
    ("Pydantic AI 状态机节点二:请求模型", "pydantic_ai/_agent_graph.py", r"^class ModelRequestNode"),
    ("Pydantic AI 状态机节点三:处理工具调用", "pydantic_ai/_agent_graph.py", r"^class CallToolsNode"),
    ("Pydantic AI 默认最多请求几次模型", "pydantic_ai/usage.py", r"request_limit: int \| None = "),
    ("Google ADK 2.x 的图工作流", "google/adk/workflow/_workflow.py", r"^class Workflow"),
    ("Google ADK 2.x 图里的边", "google/adk/workflow/_graph.py", r"^class Edge"),
    ("Claude Agent SDK 启动 Claude Code 的命令行", "claude_agent_sdk/_internal/transport/subprocess_cli.py", r'"--output-format", "stream-json"'),
]


def first_match(rel: str, pattern: str) -> tuple[int, str]:
    for i, line in enumerate((SITE / rel).read_text(encoding="utf-8").splitlines(), 1):
        if re.search(pattern, line):
            return i, line.strip()
    return 0, "(没找到,版本可能改了写法)"


if __name__ == "__main__":
    for label, rel, pattern in TARGETS:
        n, text = first_match(rel, pattern)
        print(f"{label}\n    {rel}:{n}  {text[:90]}")
```

<div class="line-notes">

- `import site` 标准库,能告诉你当前虚拟环境的 `site-packages` 在哪。
- `SITE = Path(site.getsitepackages()[0])  # 当前虚拟环境的 site-packages` 在 `uv run` 里,这个路径是仓库里的 `.venv/lib/python3.12/site-packages`。所有 `uv add` 装的包的源码都在这。
- `TARGETS = [` 要找的东西:(说明, 相对 site-packages 的文件, 正则)。
- `("LangChain create_agent 建图", "langchain/agents/factory.py", r'graph\.add_node\("model"'),` `create_agent` 的实现在 `factory.py` 里,找往图里加 `model` 节点的那一行。正则里的 `\.` 和 `\(` 是转义:`.` 在正则里表示任意字符,要匹配真正的点就得写 `\.`。
- `("OpenAI Agents SDK Runner 主循环", "agents/run.py", r"^\s+while True:"),` `^\s+` 表示行首有若干空白,然后是 `while True:`。文件里第一个满足的就是主循环。
- `("Agent Framework 工具调用循环", "agent_framework/_tools.py", r"for attempt_idx in range\(attempt_start, max_iterations\)"),` 微软的循环用的是 `for`,上限是 `max_iterations`。
- `("Pydantic AI 状态机节点一:处理用户输入", "pydantic_ai/_agent_graph.py", r"^class UserPromptNode"),` Pydantic AI 的循环是状态机,每个状态是一个类。这三个类串起来就是一轮:`UserPromptNode` → `ModelRequestNode` → `CallToolsNode`,有工具调用就回到 `ModelRequestNode`。
- `("Pydantic AI 默认最多请求几次模型", "pydantic_ai/usage.py", r"request_limit: int \| None = "),` 默认上限也藏在文件里。`\|` 是转义的竖线,因为 `|` 在正则里表示「或」。
- `("Google ADK 2.x 的图工作流", "google/adk/workflow/_workflow.py", r"^class Workflow"),` ADK 2.x 的图在 `workflow` 目录。
- `def first_match(rel: str, pattern: str) -> tuple[int, str]:` 在一个文件里找第一个匹配的行,返回(行号, 这行的文字)。
- `for i, line in enumerate((SITE / rel).read_text(encoding="utf-8").splitlines(), 1):` 逐行读,`enumerate(…, 1)` 让行号从 1 开始。
- `if re.search(pattern, line):` 这一行匹配正则就算找到。
- `return i, line.strip()` 返回行号和去掉前后空白的文字。
- `return 0, "(没找到,版本可能改了写法)"` 没找到时返回 0 行,提醒你包升级后这个脚本要重新校一遍,这就是读源码的保质期。
- `for label, rel, pattern in TARGETS:` 逐个打印。
- `n, text = first_match(rel, pattern)` 解构出行号和文字。

</div>

```bash
uv run python peek_source.py
```

```text
LangChain create_agent 建图
    langchain/agents/factory.py:1611  graph.add_node("model", RunnableCallable(model_node, amodel_node, trace=False))
LangChain 工具节点
    langchain/agents/factory.py:1615  graph.add_node("tools", tool_node)
OpenAI Agents SDK 默认最大轮数
    agents/run_config.py:45  DEFAULT_MAX_TURNS = 10
OpenAI Agents SDK Runner 主循环
    agents/run.py:1032  while True:
OpenAI Agents SDK 超轮数报错
    agents/run.py:1606  max_turns_error = MaxTurnsExceeded(f"Max turns ({max_turns}) exceeded")
Agent Framework 默认最大迭代数
    agent_framework/_tools.py:109  DEFAULT_MAX_ITERATIONS: Final[int] = 40
Agent Framework 工具调用循环
    agent_framework/_tools.py:5812  for attempt_idx in range(attempt_start, max_iterations):
Pydantic AI 状态机节点一:处理用户输入
    pydantic_ai/_agent_graph.py:667  class UserPromptNode(AgentNode[DepsT, NodeRunEndT]):
Pydantic AI 状态机节点二:请求模型
    pydantic_ai/_agent_graph.py:1440  class ModelRequestNode(AgentNode[DepsT, NodeRunEndT]):
Pydantic AI 状态机节点三:处理工具调用
    pydantic_ai/_agent_graph.py:2375  class CallToolsNode(AgentNode[DepsT, NodeRunEndT]):
Pydantic AI 默认最多请求几次模型
    pydantic_ai/usage.py:516  request_limit: int | None = 50
Google ADK 2.x 的图工作流
    google/adk/workflow/_workflow.py:134  class Workflow(BaseNode):
Google ADK 2.x 图里的边
    google/adk/workflow/_graph.py:59  class Edge(BaseModel):
Claude Agent SDK 启动 Claude Code 的命令行
    claude_agent_sdk/_internal/transport/subprocess_cli.py:574  cmd = [self._cli_path, "--output-format", "stream-json", "--verbose"]
```

这就是「主循环」在每个包里的位置。你会发现每个框架的写法差别很大,但骨架是同一个:**调模型 → 看回复里有没有工具调用 → 有就执行、把结果追加进历史、再调模型 → 没有就结束,同时有个轮数上限防跑飞。** Day 330 的 `MiniAgent.run` 里那个 `for _ in range(self.max_steps)`,和 OpenAI Agents SDK 的 `while True` 加 `max_turns`(默认 10)、微软的 `for attempt_idx in range(…, max_iterations)`(默认 40)、Pydantic AI 的 `request_limit`(默认 50),是同一件事的不同写法。

## 面试最难的三题

JD 里「理解 LangChain/LlamaIndex 原理」「能讲清框架局限和何时不用框架」这类要求,对应的面试题基本是下面三个。每个我都配上今天亲手拿到的证据,这样你回答时说的是「我量过」而不是「我听说」。

### 一、框架底层是怎么实现的?

先说共同的骨架(上一节那句话),再按框架分:

- **LangChain `create_agent`**:构造一张 LangGraph 图。`factory.py` 里往图里加一个 `model` 节点(第 1611 行)和一个 `tools` 节点(第 1615 行),再用条件边连起来:模型回复里有工具调用就去 `tools` 节点,否则结束,工具节点跑完回到模型节点。middleware 是插在模型调用和工具调用前后的钩子。工具 schema 从函数签名和 docstring 用 pydantic 生成,所以 `Field(le=20)` 能一路带到请求里(Day 333 抓包看到了 `maximum: 20`)。LangGraph 本身是按「超步」执行的状态机,每步按 reducer 合并状态、写 checkpoint。
- **OpenAI Agents SDK**:`Runner` 里一个 `while True`(`agents/run.py` 第 1032 行),每一轮调一次模型,得到一个「下一步」:最终输出就结束,handoff 就换成另一个 Agent 继续,要重来就再跑一轮,要人工介入就暂停;每轮先查护栏;轮数超过 `max_turns`(默认 10)就抛 `MaxTurnsExceeded`。
- **Microsoft Agent Framework**:工具调用循环是一个 `for`,上限 `max_iterations` 默认 40。
- **Pydantic AI**:基于 `pydantic-graph` 的状态机,三个节点 `UserPromptNode`、`ModelRequestNode`、`CallToolsNode` 轮转,`UsageLimits.request_limit` 默认 50。
- **Claude Agent SDK**:根本不是个 Python 循环。它启动一个 `claude --output-format stream-json --verbose` 的子进程(`subprocess_cli.py` 第 574 行),通过流式 JSON 和它通信,循环在那个程序里面。
- **Google ADK 2.x**:`Workflow` 图执行引擎,节点、边、重试配置、超时异常都有。

说到这个程度,面试官就知道你看过源码或者自己实现过。最有说服力的一句是:「我自己手写过一个,111 行,结构和它们是一样的」,然后讲 Day 330 的 `MiniAgent`。

### 二、局限在哪?

每一点带一个今天亲眼见过的例子:

- **抽象泄漏和加料。** 抓包发现 Claude Agent SDK 往系统提示词前加了身份行,消息里夹了一条环境说明,还多了一个占位工具和一个起标题的请求。你写了 29 个字的系统提示词,模型看到的是 166 个字加一大段环境。模型行为不对劲时,先抓包看实际发了什么。
- **读配置的地方各不相同。** 同一个「关闭思考」的开关:LangChain 在 `ChatOpenAI(extra_body=)`,OpenAI Agents SDK 在 `ModelSettings(extra_body=)`,Pydantic AI 在 `ModelSettings(extra_body=)`,ADK 在 `LiteLlm(extra_body=)`,而微软 Agent Framework 的选项里根本没有这个字段,我只好包了一层 `create`。换框架时关键参数必须抓包确认。
- **版本变动快,旧教程会报错。** Pydantic AI 从 v1 到 v2,`result.usage()` 变成 `result.usage`,抄旧代码立刻 `TypeError`;LangGraph 1.0 弃用了 `create_react_agent`;AutoGen 已归档;MCP Python SDK 2.x 把 `FastMCP` 改名为 `MCPServer`。依赖升级要有测试兜底。
- **模型绑定和兼容性。** OpenAI Agents SDK 默认走 Responses API 和 tracing 上传,接兼容厂商要多配几处;ADK 直连 Gemini,接 DeepSeek 要借 LiteLLM,多一层依赖和约 4 秒延迟(7.8 秒对 3.7 秒)。
- **依赖和平台。** Intel Mac 上 `cryptography` 没预编译包,装 `openai-agents` 要限版本;`google-adk` 把 `websockets` 降级;`crewai` 不支持 Python 3.14。
- **安全。** Claude Agent SDK 会读家目录的配置和记忆文件,不隔离就是把家目录交给一个联网的进程。
- **成本和性能。** 简单任务上它们都不省钱:七个做法 0.0042–0.0078 元。框架的价值不在这。

### 三、什么时候不用框架?

流程简单、一问一答或固定两三步的时候不用,手写更清楚。对延迟和成本极度敏感、需要精确控制每个 token 的时候不用。团队没人熟悉它、又没时间学的时候不用。框架的抽象和你的业务模型严重不匹配、天天在和它作对的时候不用。反过来,需要持久化、人工介入、复杂分支、超时重试降级、多人协作维护的时候,用框架划算。

我会补一句今天的数据:简单任务上七个做法的请求数一样、花费同一量级,所以**引入框架的理由必须是「我需要它给的能力」,不能是「我想省钱省时间」**。一个很好的实践是:先手写最小版本把问题跑通,等出现第一个手写起来很痛苦的需求(比如节点要超时重试、要暂停等审批),再引入框架。这样你引入框架的理由是具体的,面试时也讲得出来。

## 动手练习

1. LangGraph 1.2 和 Google ADK 2.x 都有「节点超时」。复用 `peek_source.py` 的 `first_match`,找出两家各自在哪个文件、哪一行实现了超时策略和超时异常,并说说你看到了什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/fw/peek_timeout.py
"""练习 1:LangGraph 1.2 和 Google ADK 2.x 都有「节点超时」,各自在哪实现的?复用 peek_source.py 的 first_match。"""
from peek_source import first_match

TARGETS = [
    ("LangGraph 超时策略", "langgraph/types.py", r"^class TimeoutPolicy"),
    ("LangGraph 超时异常", "langgraph/errors.py", r"^class NodeTimeoutError"),
    ("LangGraph 整张图的默认超时(set_node_defaults)", "langgraph/graph/state.py", r"timeout: float \| timedelta \| TimeoutPolicy"),
    ("ADK 超时异常", "google/adk/workflow/_errors.py", r"^class NodeTimeoutError"),
    ("ADK 重试配置", "google/adk/workflow/_retry_config.py", r"^class RetryConfig"),
]

if __name__ == "__main__":
    for label, rel, pattern in TARGETS:
        n, text = first_match(rel, pattern)
        print(f"{label}\n    {rel}:{n}  {text[:90]}")
```

<div class="line-notes">

- `from peek_source import first_match` 直接用上一节写的函数。`peek_source.py` 底部有 `if __name__ == "__main__":`,import 它不会再跑一遍它自己的打印。
- `("LangGraph 超时策略", "langgraph/types.py", r"^class TimeoutPolicy"),` LangGraph 把超时配置做成一个数据类 `TimeoutPolicy`,有 `run_timeout`(硬上限)和 `idle_timeout`(无进展上限)。
- `("LangGraph 超时异常", "langgraph/errors.py", r"^class NodeTimeoutError"),` 异常类。
- `("LangGraph 整张图的默认超时(set_node_defaults)", "langgraph/graph/state.py", r"timeout: float \| timedelta \| TimeoutPolicy"),` 这个正则匹配到的是 `StateGraph.set_node_defaults` 的参数:不用给每个节点单独设,可以给整张图设默认。注意同样的参数在 `add_node` 里也有,所以文件里有好几处,脚本只打印第一处。
- `("ADK 超时异常", "google/adk/workflow/_errors.py", r"^class NodeTimeoutError"),` ADK 里有同名的异常类。
- `("ADK 重试配置", "google/adk/workflow/_retry_config.py", r"^class RetryConfig"),` ADK 的重试是一个 pydantic 模型 `RetryConfig`。

</div>

```text
LangGraph 超时策略
    langgraph/types.py:461  class TimeoutPolicy:
LangGraph 超时异常
    langgraph/errors.py:191  class NodeTimeoutError(Exception):
LangGraph 整张图的默认超时(set_node_defaults)
    langgraph/graph/state.py:278  timeout: float | timedelta | TimeoutPolicy | None = None,
ADK 超时异常
    google/adk/workflow/_errors.py:66  class NodeTimeoutError(Exception):
ADK 重试配置
    google/adk/workflow/_retry_config.py:28  class RetryConfig(BaseModel):
```

两家都有 `NodeTimeoutError`,都有重试配置,都有「图 + 节点 + 边」。Google 把 ADK 2.0 从层级式执行器改成图执行引擎之后,API 和 LangGraph 越来越像,这就是前面说的「往同一个方向收敛」。对你学习的意义是:LangGraph 学得扎实,换到 ADK 的图工作流,概念几乎是直接迁移的。

</details>

2. 重试成功的情形:节点第一次尝试卡住(睡 2 秒),第二次很快。设 0.5 秒超时和最多 3 次的重试,看 LangGraph 会不会自己救回来,以及总共花多久。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/fw/ex334_retry.py
"""练习 2:节点超时 + 重试。第一次尝试卡住(睡 2 秒),第二次尝试很快,看 LangGraph 1.2 会不会自己救回来。不调模型。"""
import asyncio
import time
from typing import TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.types import RetryPolicy

attempts = 0


class State(TypedDict):
    answer: str


async def flaky_lookup(state: State) -> dict:
    global attempts
    attempts += 1
    started = time.perf_counter()
    if attempts == 1:
        await asyncio.sleep(2)  # 第一次尝试:下游卡住
    print(f"  第 {attempts} 次尝试正常走完,函数体内用时 {time.perf_counter() - started:.2f} 秒")
    return {"answer": f"第 {attempts} 次尝试拿到了结果"}


async def main() -> None:
    g = StateGraph(State)
    g.add_node("flaky_lookup", flaky_lookup, timeout=0.5,
               retry_policy=RetryPolicy(max_attempts=3, initial_interval=0.1, jitter=False))
    g.add_edge(START, "flaky_lookup")
    g.add_edge("flaky_lookup", END)
    t0 = time.perf_counter()
    out = await g.compile().ainvoke({"answer": ""})
    print(f"结果:{out},一共尝试 {attempts} 次,总用时 {time.perf_counter() - t0:.2f} 秒")


if __name__ == "__main__":
    asyncio.run(main())
```

<div class="line-notes">

- `attempts = 0` 模块级计数器,记节点被执行了几次。
- `async def flaky_lookup(state: State) -> dict:` 「时灵时不灵」的节点。
- `global attempts` 函数里要改模块级变量得先声明 `global`。
- `attempts += 1` 每次进入这个函数就加一。
- `started = time.perf_counter()` 记这一次尝试的开始时间,用来在函数体内计时。
- `if attempts == 1:` 只有第一次尝试卡住。
- `await asyncio.sleep(2)  # 第一次尝试:下游卡住` 睡 2 秒,会被 0.5 秒的超时在半路取消,所以后面那行 `print` **不会执行**,你在输出里看不到「第 1 次尝试」。
- `print(f"  第 {attempts} 次尝试正常走完,函数体内用时 {time.perf_counter() - started:.2f} 秒")` 只有走完的尝试才会打印。
- `return {"answer": f"第 {attempts} 次尝试拿到了结果"}` 返回结果里带着是第几次尝试。
- `g.add_node("flaky_lookup", flaky_lookup, timeout=0.5,` 同样 0.5 秒超时。
- `retry_policy=RetryPolicy(max_attempts=3, initial_interval=0.1, jitter=False))` 最多 3 次,间隔 0.1 秒。
- `out = await g.compile().ainvoke({"answer": ""})` 跑图。
- `print(f"结果:{out},一共尝试 {attempts} 次,总用时 {time.perf_counter() - t0:.2f} 秒")` 实测尝试了 2 次,总用时 0.61 秒。

</div>

```text
  第 2 次尝试正常走完,函数体内用时 0.00 秒
结果:{'answer': '第 2 次尝试拿到了结果'},一共尝试 2 次,总用时 0.61 秒
```

第 1 次尝试在 0.5 秒时被超时取消(你看不到它的打印),等 0.1 秒后第 2 次尝试立刻成功,总共 0.61 = 0.5 + 0.1 + 几毫秒。用户感受到的是慢了半秒,而不是失败。超时加重试对「偶发卡顿」的下游特别有效;对「一直卡」的下游就像上一节那样,重试用尽、交给错误处理器降级。

</details>

3. Pydantic AI 的看家本领:让 Agent 直接返回一个经过校验的 Python 对象。给「查重复扣款」定义一个 pydantic 输出类,看模型能不能按它填。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/fw/ex334_typed.py
"""练习 3:Pydantic AI 的看家本领:让 Agent 直接返回一个经过校验的 Python 对象,而不是一段文字。"""
import json
import os
import time

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")
from pydantic import BaseModel, Field  # noqa: E402
from pydantic_ai import Agent  # noqa: E402
from pydantic_ai.models.openai import OpenAIChatModel  # noqa: E402
from pydantic_ai.providers.openai import OpenAIProvider  # noqa: E402
from pydantic_ai.settings import ModelSettings  # noqa: E402

from fw_common import SYSTEM, TASK, find_customer, list_invoices  # noqa: E402


class DuplicateCheck(BaseModel):
    """账务专员的结构化结论。"""
    customer_id: str = Field(pattern=r"^C\d{3}$")
    is_duplicate: bool
    invoice_ids: list[str] = Field(description="涉嫌重复的发票号")
    refundable_yuan: float = Field(ge=0, description="建议退还的金额,单位元")


model = OpenAIChatModel(
    os.environ["LLM_MODEL"],
    provider=OpenAIProvider(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"]),
    settings=ModelSettings(temperature=0, extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))),
)
agent = Agent(model, instructions=SYSTEM, tools=[find_customer, list_invoices], output_type=DuplicateCheck)

if __name__ == "__main__":
    t0 = time.perf_counter()
    result = agent.run_sync(TASK)
    out = result.output
    print(type(out).__name__, out)
    print("is_duplicate 的类型:", type(out.is_duplicate).__name__, ",refundable_yuan 的类型:", type(out.refundable_yuan).__name__)
    print(f"模型请求 {result.usage.requests} 次,用时 {time.perf_counter() - t0:.1f} 秒")
```

<div class="line-notes">

- `from pydantic import BaseModel, Field  # noqa: E402` [Day 51](/blog/agent-zero/day-051-pydantic-1/)、[Day 52](/blog/agent-zero/day-052-pydantic-2/) 学过的写法。
- `class DuplicateCheck(BaseModel):` 账务专员的结构化结论:不再是一段话,而是四个字段。类的 docstring 会被当作这个输出的描述发给模型。
- `customer_id: str = Field(pattern=r"^C\d{3}$")` 客户编号必须形如 `C007`,不符合会触发校验失败。
- `is_duplicate: bool` 一个真正的布尔值,不是字符串「是」。
- `invoice_ids: list[str] = Field(description="涉嫌重复的发票号")` 一个字符串列表,`description` 会进 schema 帮模型理解。
- `refundable_yuan: float = Field(ge=0, description="建议退还的金额,单位元")` 非负浮点数。
- `agent = Agent(model, instructions=SYSTEM, tools=[find_customer, list_invoices], output_type=DuplicateCheck)` 唯一新增的参数是 `output_type`。Agent 内部把它变成一个「输出工具」,模型最后一步调用这个工具来交卷,Pydantic AI 再用 pydantic 校验,不合格就带着错误让模型重试。
- `out = result.output` 现在 `result.output` 是一个 `DuplicateCheck` 对象,不是字符串。
- `print("is_duplicate 的类型:", type(out.is_duplicate).__name__, ",refundable_yuan 的类型:", type(out.refundable_yuan).__name__)` 验证类型:实测是 `bool` 和 `float`。
- `print(f"模型请求 {result.usage.requests} 次,用时 {time.perf_counter() - t0:.1f} 秒")` 还是 3 次请求:前两次查工具,第三次调输出工具交卷。

</div>

```text
DuplicateCheck customer_id='C007' is_duplicate=True invoice_ids=['INV-2026-0123', 'INV-2026-0026'] refundable_yuan=2392.0
is_duplicate 的类型: bool ,refundable_yuan 的类型: float
模型请求 3 次,用时 3.0 秒
```

模型交回了一个 `DuplicateCheck`:`is_duplicate=True`,两张发票号,退还金额 `2392.0`。后面的代码可以直接 `if out.is_duplicate:`,不用再从一段中文里抠。这在 [Day 150](/blog/agent-zero/day-150-structured-output/) 你是手写的 `extract` + 重试,Pydantic AI 把它做进了框架。它是「框架给你的能力」的又一个例子,和超时、重试、次数上限同一类。

</details>

4. 写一页「选型说明」:如果给 CloudLedger 的客服系统选技术栈,你选哪几层、哪个框架,理由是什么,不选什么,为什么。这页纸就是面试时的答题稿。

<details><summary>参考答案</summary>

这是一道开放题,我给一个示范,你写自己的,要经得起「为什么不用 X」的追问。

**选哪几层。** ① 用 openai 兼容协议接 DeepSeek,成本最低、可以随时换厂商。② 工具用 MCP 暴露(Day 281–284 的 `cloudledger/server.py`),这样客服 Agent、内部运营的 Claude Code、将来别的 Agent 都能共用同一份业务工具。③ 主流程用 LangGraph:客服要查询、判断、起草、遇到退款停下来等审批,这是一张有分支、要持久化、要人工介入的图,正好是 LangGraph 的强项(Day 316–320 已经做过)。没有选 ④ 和 ⑤。

**为什么是 LangGraph。** 三条理由,都来自今天:一,流程固定、有审批,需要 checkpointer 和 `interrupt`,手写要自己造;二,生产里要超时、重试、降级,1.2 的 `timeout`、`retry_policy`、`error_handler` 是一行配置(今天实跑 1.1 秒完成降级);三,它的概念(节点、边、状态)和 ADK 2.x 的图工作流几乎同构,将来换栈的迁移成本低。

**不选什么,为什么。**

- **不选 Claude Agent SDK 做客服主链路。** 客服 Agent 只需要两三个业务工具,不需要读写文件和执行命令的 harness;今天看到它默认读家目录配置、多一个起标题的请求、比别人贵三到五成、慢两秒,而且只有 Claude 官方接口才是它的主场(我们用 DeepSeek 要走兼容层)。需要「什么都能干」的编码或运维助手时再考虑,而且必须沙箱。
- **不选 OpenAI Agents SDK。** 它的 handoff 和护栏很好用,但默认绑 Responses API 和 tracing 上传,接 DeepSeek 要多配几处,而我们的流程图已经用 LangGraph 表达了。如果团队主要用 OpenAI 的模型、流程是「几个专员互相交接」,它会是更轻的选择。
- **不选 ADK 和微软 Agent Framework。** 一个主场在 Gemini、接 DeepSeek 要借 LiteLLM(7.8 秒对 3.7 秒),一个选项封闭(要关思考得打补丁)。如果公司已经全面上 Google Cloud 或 .NET,答案会不同。
- **不选低代码。** Day 336、337 会专门讲:原型阶段可以用,核心链路的版本管理、评测和可迁移性更重要(Agent Builder 一年就下线是个提醒)。

**怎么验证这个选型。** 用 Day 333 的抓包脚本确认请求里没有被加料,用评测集(第六部分)跑回归,而不是看一次的成本或延迟。

对比一下「你的答案」和这个示范,看你有没有:点名了层、给了理由、说了不选什么并且理由具体(最好带数字)、说了怎么验证。

</details>

验收标准:`framework_status.py` 能打印出十四行的版本表;三个新框架的脚本都跑通且都指出 INV-2026-0123 和 INV-2026-0026;`compare_all.py` 能出七行的表;`lg12_timeout.py` 的两种结果和上面一致(没有处理器抛 `NodeTimeoutError`、有处理器返回降级回答);`peek_source.py` 在你的环境里能找到每个框架的关键行(行号可能和我的不同,这正是读源码的保质期);面试三题能不看文章讲一遍。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| PyPI | Python 的包仓库,`uv add` 从这里下载包,有公开的 JSON 接口可以查版本 |
| Workflow Runtime(ADK 2.0) | Google ADK 2.0 的图执行引擎,Agent、工具、函数都是图里的节点 |
| Microsoft Agent Framework | 微软合并 Semantic Kernel 和 AutoGen 后的 Agent SDK,2026 年 4 月 3 日发布 1.0,有 .NET 和 Python 版 |
| capability(Pydantic AI) | 把工具、钩子、指令、模型设置打包成一个可复用单位,挂到 Agent 上 |
| `output_type`(Pydantic AI) | 让 Agent 直接返回一个经过校验的 pydantic 对象,内部靠「输出工具」实现 |
| LiteLLM | 把几十家模型厂商统一成 OpenAI 格式的转接库,ADK 用它接非 Gemini 模型 |
| `timeout`(LangGraph 1.2) | `add_node` 的参数,给一个节点设超时,超过抛 `NodeTimeoutError` |
| `TimeoutPolicy` | LangGraph 的超时配置类,`run_timeout` 是硬上限,`idle_timeout` 是无进展上限 |
| `error_handler`(LangGraph 1.2) | 节点重试用尽后才调用的收场函数,收到 `NodeError`,可以返回 `Command` 写入降级结果 |
| `NodeError` | 传给错误处理器的失败现场,含出事的节点名和异常对象 |
| `RetryPolicy` | LangGraph 的重试策略:最多几次、间隔多久、要不要抖动 |
| `DEFAULT_MAX_TURNS` | OpenAI Agents SDK 的默认最大轮数,实测是 10,超了抛 `MaxTurnsExceeded` |
| `request_limit` | Pydantic AI 的默认最大模型请求数,实测是 50 |
| `max_iterations` | 微软 Agent Framework 的工具调用循环上限,实测默认 40 |
| 归档(archived) | GitHub 仓库被设成只读,不再修 bug、不再发版,AutoGen 就是 |
| `set_node_defaults` | LangGraph 里给整张图设默认的重试、缓存、错误处理器、超时 |
| `site-packages` | 虚拟环境里存放所有装好的包源码的目录,读框架源码就从这里找 |
| 静音名单 | `fw_common.py` 里把一批日志器调到 WARNING 的那个循环,每多装一个框架可能要加一项 |

## 常见误区

**把文章里的版本号当成现在的版本号。** 这个领域半年一个大版本。查版本用 `framework_status.py` 或 `pip index versions 包名`,看教程先看日期。

**抄 v1 的写法跑 v2 的包。** `result.usage()` 在 Pydantic AI v2 里会报 `'RunUsage' object is not callable`。遇到 import 或调用报错,先查迁移文档。

**以为 AutoGen 还能当新项目的起点。** 它的 README 写着「已归档,不再维护」,最后一次发版是 2025 年 9 月 30 日。新项目用 Microsoft Agent Framework。

**以为换了框架 `extra_body` 这类参数一定还能用。** 微软 Agent Framework 的选项里没有它,我先放进 `default_options` 没用,放进 `client_kwargs` 也没用,抓包才发现思考模式一直开着,输出 955 token。要么绕路,要么承认这个框架不适合当前模型。

**在 LangGraph 节点里用 `time.sleep` 想测超时。** 超时靠 asyncio 取消实现,同步睡眠会堵住事件循环,超时到睡醒才触发。节点要写成 `async` 并用 `asyncio.sleep`。

**以为错误处理器会在第一次失败时就运行。** 顺序是先重试,重试用尽才轮到它。今天实测两次尝试共 1.1 秒之后才降级。

**拿 0.0042 对 0.0049 当选型依据。** 七个做法请求数一样、花费同一量级,差别淹没在波动里。选型看接模型的顺不顺、关键参数能不能传到、能不能读懂和改、有没有你要的横切能力。

**读源码只读不记版本。** `peek_source.py` 里的行号在包升级后会变。记住「我在哪个版本看到的」,面试时说「在 0.24.0 里,主循环在 run.py 的 `while True`,默认 10 轮」比说「应该是这样」有力得多。

**因为框架有 `error_handler` 就以为失败都被兜住了。** 它只管节点里抛出的异常。节点返回了一个错的结果但没抛异常(比如模型胡编的发票号),它管不了,那是评测要管的事。

## 学习资料

### 文档与文章

- [Google ADK 2.0](https://adk.dev/2.0/):官方的 2.0 介绍,重点读 Workflow Runtime 和各语言的 GA 日期,15 分钟。
- [Microsoft Agent Framework 1.0 发布文章](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/):1.0 的稳定性承诺、编排模式和 MCP/A2A 支持,15 分钟。
- [Pydantic AI 概览](https://pydantic.dev/docs/ai/overview/):类型化、capabilities、持久化执行三块,先看这页再选读 [版本政策](https://pydantic.dev/docs/ai/project/version-policy/),15 分钟。
- [LangGraph v1 发布说明](https://docs.langchain.com/oss/python/releases/langgraph-v1):1.0 为什么说是稳定性优先、`create_react_agent` 为什么被弃用,10 分钟。
- [Deep Agents 0.7 博客](https://www.langchain.com/blog/deep-agents-v0-7):把默认 harness 精简掉 65% 基础输入的那篇,读完会重新审视自己的系统提示词,10 分钟。
- [OpenAI 弃用页](https://developers.openai.com/api/docs/deprecations):找 Agent Builder 那一条,看它的时间线,5 分钟。
- [CrewAI 介绍](https://docs.crewai.com/en/introduction):读「Crews 还是 Flows」那一段,5 分钟。
- [LiteLLM 文档](https://docs.litellm.ai/):ADK 接非 Gemini 模型靠它,看「provider/模型名」的写法,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15W9MB7Eve&autoplay=0&high_quality=1" title="微软继 SK 和 AutoGen后的新 Agent 框架 Agent Framework 1.0 正式发布,支持 Python和.NET 双语言。" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>向AI而行 · 微软继 SK 和 AutoGen后的新 Agent 框架 Agent Framework 1.0 正式发布 · 9 分钟,讲 1.0 发布时的定位和 Python/.NET 双语言支持,对照今天的第 2 步和 AutoGen 归档那一段看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kYNp62EFv&autoplay=0&high_quality=1" title="Pydantic AI 2.0 来了:一个 capability 原语,重构智能体开发" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>五里墩茶社 · Pydantic AI 2.0 来了:一个 capability 原语,重构智能体开发 · 5 分钟,讲 v2 的 capability 概念,正好是今天 `fw_pydantic_ai.py` 没用到的那一块。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/PY7xIxybYNc" title="Pydantic AI 2.0: The New Best Way to Build AI Agents is Composing Capabilities" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Cole Medin · Pydantic AI 2.0: The New Best Way to Build AI Agents is Composing Capabilities · 英文,带着代码演示 capability 怎么组合,看完能补上今天没讲的那一块。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/oPd64jUdUWI" title="Hands-On Graph Based Workflows with ADK 2.0: From Agentic AI to Agentic Engineering" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>10XROADMAP · Hands-On Graph Based Workflows with ADK 2.0 · 英文,动手搭 ADK 2.0 的图工作流,对照今天练习 1 里 ADK 和 LangGraph 的相似之处。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):Agent 那一章讲规划、工具和失败模式,选框架之前先读,英文原版。
- Michael Albada《Building Applications with AI Agents》(O'Reilly,2025):对几类 Agent 框架的取舍有专门章节,和「面试三题」对照着读,英文原版。

### 开源项目与代码

- [pydantic/pydantic-ai](https://github.com/pydantic/pydantic-ai):读 `_agent_graph.py` 里那三个节点类,看一轮是怎么在状态机里转的。
- [microsoft/agent-framework](https://github.com/microsoft/agent-framework):README 里有从 AutoGen 和 Semantic Kernel 迁移的指南。
- [google/adk-python](https://github.com/google/adk-python):读 `workflow` 目录,和 LangGraph 的 `StateGraph` 对照。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):读 `langgraph/types.py` 里 `TimeoutPolicy` 的 docstring,它写了「协作式取消」的限制。

## 自测

1. Google ADK 2.0 最大的变化是什么?它和 LangGraph 有什么相似之处?你在包里找到了什么证据?

<details><summary>答案</summary>

ADK 2.0 把执行器从层级式 Agent 执行器换成了图执行引擎(Workflow Runtime),Agent、工具、函数都是图里的节点,和 LangGraph 的节点、边、状态很像。证据:装好的 `google/adk/workflow/` 目录里有 `Workflow`、`Edge`、`JoinNode`、`RetryConfig`,还有一个和 LangGraph 同名的 `NodeTimeoutError`。

</details>

2. 为什么说「AutoGen 老教程别照着做」?新项目该选谁?

<details><summary>答案</summary>

AutoGen 的 GitHub 仓库 README 标明项目已归档、不再维护(没有 bug 修复、安全修复和新功能),PyPI 上 `autogen-agentchat` 最后一次发版是 2025 年 9 月 30 日。微软把 AutoGen 和 Semantic Kernel 合并成了 Microsoft Agent Framework,2026 年 4 月 3 日发布 1.0,README 让新用户从它开始。

</details>

3. LangGraph 的节点设了 `timeout=0.5`、`RetryPolicy(max_attempts=2)` 和一个 `error_handler`,节点每次都卡 2 秒。整个图会发生什么?总共多久?

<details><summary>答案</summary>

先重试,重试用尽才轮到错误处理器。节点第 1 次尝试 0.5 秒超时被取消,等 0.1 秒的重试间隔,第 2 次尝试 0.5 秒又超时,总共约 1.1 秒。然后调用错误处理器,它收到 `NodeError`,返回 `Command` 把降级回答写进状态,图正常结束。没有错误处理器时,异常 `NodeTimeoutError` 会一路抛给调用方。

</details>

4. 在 Pydantic AI v2 里 `result.usage()` 报 `'RunUsage' object is not callable`,为什么?怎么改?这件事说明什么?

<details><summary>答案</summary>

v2 里 `result.usage` 变成了属性(返回 `RunUsage` 对象),而 v1 里它是个方法。对象不能被「调用」,所以加括号就报这个错。去掉括号即可。这说明这个领域版本变动快,旧教程的写法在新版本里会直接报错,升级依赖要有测试兜底,遇到报错先查迁移文档。

</details>

5. **面试题**:「你选 Agent 框架的时候怎么选?什么情况下你不会用框架?」怎么回答?

<details><summary>答案</summary>

先分层:框架不能跨层比,LangGraph 是编排层、OpenAI Agents SDK 和 Claude Agent SDK 是 Agent SDK 层、Dify 是低代码层。选型问三件事:流程是不是固定(固定用 workflow,手写或 LangGraph);需不需要持久化、人工介入、超时重试降级这类横切能力(需要就用 LangGraph 或同类);需不需要一个什么都能干的通用 Agent(需要就看 harness,但要沙箱隔离)。不用框架的情况:流程简单一问一答、对 token 和延迟极度敏感、团队不熟悉、框架抽象和业务不匹配。我会补充数据:我在同一个任务上量了七种做法,请求数都是 3 次,花费 0.004–0.008 元,所以引入框架的理由必须是「我需要它的能力」,不是省钱;原则是先手写最小版本,出现第一个痛点再引入。

</details>

6. **面试题**:「请说说 OpenAI Agents SDK 的主循环是怎么实现的?」

<details><summary>答案</summary>

`Runner` 里一个 `while True`(在 `agents/run.py`),每一轮:先查输入护栏(只在第一轮),调模型,把回复处理成一个「下一步」。下一步有四种:最终输出就结束并返回;handoff 就把当前 Agent 换成接手的 Agent 继续;要再跑一轮(比如执行了工具)就继续循环;需要人工审批就中断。每轮结束把轮数加一,超过 `max_turns`(默认 10)就抛 `MaxTurnsExceeded`。可以再补一句:这和手写 Agent 循环的结构一样,框架多出来的是护栏、会话持久化和 tracing。

</details>

## 明天预告

明天是 [Day 335 · 第 48 周复习:MCP 与编排(Day 329–334)](/blog/agent-zero/day-335-week48-review/)。这一周从两篇吵架的文章开始,经过主管派活、专员交接、subagent,再到框架横评。复习日不学新东西:画一张本周的知识地图,把六天各用一句话回顾,默写一段本周的核心代码并跑通,再整理一张错题和坑的清单。
