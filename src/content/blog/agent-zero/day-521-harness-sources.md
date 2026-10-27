---
title: 'Day 521 · Harness(二):读三家的源码'
description: '带着四个问题去读 OpenAI Agents SDK、Claude Agent SDK 和 LangGraph 的源码:循环在哪、工具抛异常时模型看到什么、需要人批准时怎么暂停、状态存成什么样。每个答案都落到文件和行号,再用真实运行验证:同一个抛异常的工具,三家的默认行为完全不同;Claude 的 Python 包只有 1.3 万行,因为循环根本不在里面;LangGraph 的 recursion_limit 数的是 super-step,不是模型调用。最后写一份读源码笔记,用脚本检查每个引用找不找得到。'
pubDate: 2026-10-27
regime: none
tags: ['harness', 'source-code', 'langgraph', 'agent-zero']
series: 'agent-zero'
day: 521
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 520](/blog/agent-zero/day-520-harness-parts/) 把 harness 拆成七层(循环、工具层、上下文管理、权限、钩子、子 Agent、状态持久化),并从 Day 267 的 25 行 `loop()` 一层层补出了一个 150 行的 `mini_harness.py`。过程里有几个我当时说「明天用真数据比较」的取舍:工具抛异常,错误信息给模型看多少?暂停等人时,状态存成什么样?步数上限怎么数?今天不再自己写,去看三家成熟的实现是怎么选的。

## 今天要解决的问题

学完这一课你应该能:

1. 用「带着问题读」的办法,在一个十几万行的陌生仓库里,十分钟内找到某个问题的答案在哪个文件、哪个符号。具体做法:先数行数找大头,再用问题里的关键词搜。
2. 对 OpenAI Agents SDK、Claude Agent SDK、LangGraph 各回答四个问题(循环在哪、工具抛异常怎么办、怎么暂停、状态存哪),每个答案给出文件路径和符号。
3. 用真实运行验证三件事,而不是只信自己读的:同一个抛异常的工具在三家各会让模型看到什么;Claude 的 Python 包到底做了什么;LangGraph 的 `recursion_limit` 数的是什么。
4. 写一份读源码笔记,并用 `check_notes.py` 检查笔记里每个「文件加符号」的引用都真的存在。

预计用时 3.5 小时,一半在读,一半在跑。前置:[Day 520](/blog/agent-zero/day-520-harness-parts/)(七层、`Registry`、`mini_harness.py`、`fake.py` 的剧本模型)、[Day 267](/blog/agent-zero/day-267-subagent-isolation/) 的 harness、[Day 519](/blog/agent-zero/day-519-senior-map/) 的读源码方法。

实跑花费约 ¥0.01:OpenAI Agents SDK 接 DeepSeek 一共跑了 4 次(每个都是 1 到 3 次模型调用,累计约 5000 token,按输入 ¥2、输出 ¥8 每百万 token 估算不到 ¥0.01),Claude 和 LangGraph 的实验都用假的 CLI、剧本模型,花费为 0。Claude Agent SDK 自带的真实 Claude Code 进程**没有实跑**,原因在 Claude 那一节。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `check_notes.py` 里的 `check` 函数;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先准备三份源码

读源码最好读本地的,因为要 `grep`、要跳转、要在同一个版本上做实验。三份都用浅克隆(`--depth 1` 只要最新一次提交,不要几年的历史,省下载):

```bash
mkdir -p ~/agent-zero-src && cd ~/agent-zero-src
git clone --depth 1 https://github.com/openai/openai-agents-python
git clone --depth 1 https://github.com/anthropics/claude-agent-sdk-python
git clone --depth 1 https://github.com/langchain-ai/langgraph
```

GitHub 在国内有时打不开。备选是从 PyPI 下 sdist(源码包)解开读,我这次三个仓库都克隆成功了,没有走这条路,所以这个备选是**没实跑**的。

再在 `agent-zero-lab` 里装三家的包,后面要跑实验:

```bash
cd ~/agent-zero-lab
uv add openai-agents claude-agent-sdk langgraph python-dotenv
```

我写这篇时(2026 年 10 月 27 日)装到的版本和读的提交:

| 项目 | PyPI 版本 | 读的提交 |
| --- | --- | --- |
| openai-agents(OpenAI Agents SDK) | 0.24.0(10-15 发布) | `b040da5`(10-27) |
| claude-agent-sdk(Claude Agent SDK) | 0.2.174(10-24 发布) | `717cea0`(10-26) |
| langgraph | 1.2.18(10-26 发布),`langgraph-prebuilt` 1.1.1 | `858891a`(10-26) |

两点提醒。第一,你克隆时 main 已经往前走了,**我下面写的行号很可能和你看到的差几行到几百行**。这正是为什么今天的笔记和检查脚本按「符号」找位置,不按行号。第二,Claude 这个仓库的 main 比 0.2.174 的发布包多一次提交(「bump bundled CLI version to 2.1.311」),发布包里自带的 Claude Code 是 2.1.310,这点后面会用到。

## 带着四个问题读

读源码最容易犯的错是从第一行读到最后一行。OpenAI Agents SDK 一个包就有 13 万多行,读完没有意义。办法是先定好问题,只找答案。今天的四个问题,直接对应 Day 520 的七层:

1. **循环在哪?**(第 1 层)步数上限在哪里检查,超了怎么办。
2. **工具抛异常时,模型会看到什么?**(第 2 层)
3. **需要人批准时怎么暂停和恢复?**(第 4 层加第 7 层)
4. **状态存成什么样?**(第 7 层)

### 第一步:先数行数,找大头

不看内容,先看每个目录有多少行。大头在哪,通常就是这个项目最操心的事。`src_map.py` 把每个仓库的 Python 文件按目录归总(不算测试):

```python
# agent-zero-lab/part10/sources/src_map.py
"""读源码第一步:不看内容,先数一数每个目录有多少文件、多少行,找出「大头在哪」。
用法: uv run python -m part10.sources.src_map <源码根目录> [<根目录> ...]"""
import sys
from collections import Counter
from pathlib import Path


def count(root: Path) -> Counter[str]:
    lines: Counter[str] = Counter()
    for p in root.rglob("*.py"):
        rel = p.relative_to(root)
        if "tests" in rel.parts or "test" in rel.parts:
            continue
        top = "/".join(rel.parts[:-1][:2]) or "(根)"
        with p.open(encoding="utf-8", errors="ignore") as f:
            lines[top] += sum(1 for _ in f)
    return lines


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        root = Path(arg)
        c = count(root)
        print(f"== {root}  共 {sum(c.values())} 行 Python(不含 tests)")
        for name, n in c.most_common(6):
            print(f"  {n:>6}  {name}")
```

<div class="line-notes">

- `def count(root: Path) -> Counter[str]:` 返回「目录名到行数」的计数器。`Counter` 是字典的子类,专门用来数数,`most_common(6)` 直接给前 6 名。
- `for p in root.rglob("*.py"):` `rglob` 是递归地找所有 `.py` 文件,相当于 Node 里 glob 一个 `**/*.py`。
- `if "tests" in rel.parts or "test" in rel.parts:` `rel.parts` 是路径拆成的片段元组。路径里有 `tests` 的整条跳过。
- `top = "/".join(rel.parts[:-1][:2]) or "(根)"` 取前两级目录当分组名。`rel.parts[:-1]` 去掉文件名,再取前两个。文件直接在根目录时没有目录,`or` 后面的 `"(根)"` 兜底。
- `errors="ignore"` 遇到不能按 UTF-8 解码的字节就忽略,不抛错。读陌生仓库时这个保险值得加。
- `lines[top] += sum(1 for _ in f)` 一行一行数。`sum(1 for _ in f)` 是 Python 数文件行数的惯用写法:每读一行给 sum 加 1。

</div>

```bash
uv run python -m part10.sources.src_map \
  ../agent-zero-src/openai-agents-python/src/agents \
  ../agent-zero-src/claude-agent-sdk-python/src/claude_agent_sdk \
  ../agent-zero-src/langgraph/libs/langgraph/langgraph
```

真实输出:

```text
== ../agent-zero-src/openai-agents-python/src/agents  共 134376 行 Python(不含 tests)
   26468  (根)
   20710  run_internal
   13607  extensions/sandbox
    7767  sandbox
    7556  models
    7179  realtime
== ../agent-zero-src/claude-agent-sdk-python/src/claude_agent_sdk  共 13529 行 Python(不含 tests)
    7250  _internal
    4628  (根)
    1315  _internal/transport
     336  testing
== ../agent-zero-src/langgraph/libs/langgraph/langgraph  共 28862 行 Python(不含 tests)
   15675  pregel
    3045  stream
    2940  _internal
    2920  graph
    2449  (根)
    1147  channels
```

三家差得非常大。OpenAI Agents SDK 13.4 万行,其中单是 `run_internal/` 就有 2 万行,说明「一轮怎么跑」被拆得非常细;还有 `sandbox`、`realtime`、`models` 这些,是它的范围远不止循环。LangGraph 2.9 万行,一半多(1.57 万)在 `pregel/` 里,那就是执行引擎。**Claude Agent SDK 只有 1.35 万行,最大的目录是 `_internal`,而且没有一个叫 `loop` 或 `runner` 的东西。** 这个现象本身就是答案的一半,后面细说。

## OpenAI Agents SDK

### 问题 1:循环在哪

对外的入口是 `src/agents/run.py` 里的 `Runner`(279 行起),但它几乎什么都不做:`Runner.run` 里一句 `runner = DEFAULT_AGENT_RUNNER`,然后转给 `AgentRunner.run`(类在 568 行)。真正的循环在 `AgentRunner._run_impl`(629 行)里的一个 `while True:`(1032 行)。到这里不是终点,每一圈的细节又被拆到 `run_internal/` 下面:`run_loop.py`(3081 行)管单轮执行,`turn_resolution.py`(4101 行)管「这一轮结束后下一步做什么」,`tool_execution.py`(2862 行)管工具执行,`session_persistence.py`(2065 行)管会话存取。

步数上限怎么数?默认 `DEFAULT_MAX_TURNS = 10`(`run_config.py:45`)。循环里每圈 `current_turn += 1`,`if max_turns is not None and current_turn > max_turns:` 就抛 `MaxTurnsExceeded`(`run.py` 1597 行附近),除非你注册了 `error_handlers`,让它返回一个兜底结果。这和 Day 520 的 `max_steps` 一样,但多了「可以注册处理器代替抛异常」这一手。

**最值得记住的一个设计是一圈结束后的「下一步」只有四种。** 在 `run_internal/run_steps.py` 里:

- `NextStepFinalOutput`:模型给出了最终输出,结束。
- `NextStepHandoff`:交给另一个 Agent(`current_agent = ...next_step.new_agent`),接着转。
- `NextStepRunAgain`:有工具刚执行完,再问模型一次(代码里就是一句 `continue`)。
- `NextStepInterruption`:有工具调用在等人批准,整个运行暂停并返回。

对照 Day 520 的 `Reason = Literal["done", "max_steps", "budget", "needs_approval"]`:我的四种是「为什么停」,它的四种是「下一步去哪」,角度不同,但 `needs_approval` 和 `NextStepInterruption` 是同一件事。它多了 handoff,因为它把「换一个 Agent 接着说」当成一等公民。

### 问题 2:工具抛异常时,模型看到什么

这个问题我没有只靠读。先读到的:`src/agents/tool.py` 第 1997 行,

```python
def default_tool_error_function(ctx: RunContextWrapper[Any], error: Exception) -> str:
    """Return a fixed error response without exposing the exception to the model."""
    return "An error occurred while running the tool. Please try again."
```

文档字符串说得很直白:**固定回复,不把异常暴露给模型。** 想暴露要自己传 `failure_error_function`。光读代码我还是不放心,默认值有没有被别处覆盖,所以写个实验。先是接 DeepSeek 的公共部分:

```python
# agent-zero-lab/part10/sources/oai_common.py
"""OpenAI Agents SDK 接 DeepSeek 的公共部分:换一个走 chat/completions 协议的模型。"""
import os

from agents import ModelSettings, OpenAIChatCompletionsModel, set_tracing_disabled
from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()
set_tracing_disabled(True)  # 默认会把 trace 上传到 OpenAI 平台,我们没有 OpenAI key,关掉

MODEL = OpenAIChatCompletionsModel(
    model=os.environ["LLM_MODEL"],
    openai_client=AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"]),
)
SETTINGS = ModelSettings(temperature=0, extra_body={"thinking": {"type": "disabled"}})
```

<div class="line-notes">

- `from agents import ModelSettings, OpenAIChatCompletionsModel, set_tracing_disabled` OpenAI Agents SDK 默认走 OpenAI 自家的 Responses 接口。DeepSeek 兼容的是老的 chat/completions 协议,所以要换成 `OpenAIChatCompletionsModel`。
- `set_tracing_disabled(True)  # 默认会把 trace 上传到 OpenAI 平台,我们没有 OpenAI key,关掉` 这个 SDK 默认会往 OpenAI 的平台上报 trace。我们没有 OpenAI 的 key,运行内容也不该往外传,所以一开始就关掉(不关会怎样我没试)。
- `openai_client=AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])` `AsyncOpenAI` 是异步版客户端。`base_url` 指向 DeepSeek,和 `common/llm.py` 读同一组环境变量。
- `SETTINGS = ModelSettings(temperature=0, extra_body={"thinking": {"type": "disabled"}})` 温度 0;关掉 DeepSeek 的思考模式(`extra_body` 是 openai SDK 透传额外字段的口子),和 `.env` 里 `LLM_EXTRA_BODY` 是同一件事。

</div>

然后是对比实验。同一个函数,用两种方式注册成工具:默认的,和指定了 `failure_error_function` 的:

```python
# agent-zero-lab/part10/sources/oai_tool_error.py
"""问题二:工具抛异常,OpenAI Agents SDK 默认让模型看到什么?改成把异常原文交给模型会怎样?"""
import asyncio
from typing import Any

from agents import Agent, RunContextWrapper, Runner, function_tool

from part10.sources.oai_common import MODEL, SETTINGS

INVOICES = {"C007": "INV-2290 468元, INV-2291 468元, INV-2188 468元"}


def lookup(customer_id: str) -> str:
    if customer_id not in INVOICES:
        raise ValueError(f"没有这个客户:{customer_id}。客户 id 形如 C007")
    return INVOICES[customer_id]


def show_error(ctx: RunContextWrapper[Any], error: Exception) -> str:
    return f"错误:{error}"  # 把异常原文交给模型


# 同一个函数,两种注册方式:默认的,和自己指定 failure_error_function 的
default_tool = function_tool(lookup, name_override="list_invoices", description_override="查一个客户的全部发票")
open_tool = function_tool(lookup, name_override="list_invoices", description_override="查一个客户的全部发票",
                          failure_error_function=show_error)


async def try_once(label: str, tool: Any) -> None:
    agent = Agent(name="客服", instructions="你是客服助手,用工具查账,回答简短。", tools=[tool],
                  model=MODEL, model_settings=SETTINGS)
    r = await Runner.run(agent, "查一下 C0007 的发票", max_turns=4)
    print(f"--- {label}")
    for item in r.new_items:
        if item.type == "tool_call_item":
            print("  模型调用:", getattr(item.raw_item, "arguments", ""))
        if item.type == "tool_call_output_item":
            print("  模型看到:", repr(item.output))
    print("  最终回答:", r.final_output)
    print("  用量:", r.context_wrapper.usage.total_tokens, "tokens")


async def main() -> None:
    await try_once("默认的错误处理", default_tool)
    await try_once("failure_error_function 把原文给模型", open_tool)


asyncio.run(main())
```

<div class="line-notes">

- `def lookup(customer_id: str) -> str:` 和 Day 520 的 `list_invoices` 一样:客户不存在就抛 `ValueError`,消息里带着「客户 id 形如 C007」这条有用的提示。
- `def show_error(ctx: RunContextWrapper[Any], error: Exception) -> str:` `failure_error_function` 的签名:收运行上下文和异常,返回一个字符串给模型看。这里原样把异常消息交出去。
- `default_tool = function_tool(lookup, name_override="list_invoices", description_override="查一个客户的全部发票")` `function_tool` 把普通函数包装成工具,自动从签名生成参数说明。`name_override` 和 `description_override` 手动指定名字和说明(否则用函数名和文档字符串)。
- `open_tool = function_tool(lookup,` 和上一个唯一的区别:多传了这个函数。
- `r = await Runner.run(agent, "查一下 C0007 的发票", max_turns=4)` 故意写成 `C0007`(多一个 0)。`await` 对应 JS 的 `await`,`Runner.run` 是异步函数。
- `if item.type == "tool_call_output_item":` `r.new_items` 是这次运行产生的所有条目,按类型区分。工具结果的类型是 `tool_call_output_item`,`item.output` 就是模型看到的那个字符串。
- `asyncio.run(main())` Python 里运行异步函数的入口,相当于顶层 `await main()`。

</div>

```bash
uv run python -m part10.sources.oai_tool_error
```

真实输出:

```text
--- 默认的错误处理
  模型调用: {"customer_id": "C0007"}
  模型看到: 'An error occurred while running the tool. Please try again.'
  模型调用: {"customer_id": "C0007"}
  模型看到: 'An error occurred while running the tool. Please try again.'
  最终回答: 抱歉，系统连续两次查询 C0007 的发票都报错，暂时查不到结果。请稍后再试，或提供其他信息以便我协助核实。
  用量: 1241 tokens
--- failure_error_function 把原文给模型
  模型调用: {"customer_id": "C0007"}
  模型看到: '错误:没有这个客户:C0007。客户 id 形如 C007'
  最终回答: 客户 ID 格式应为 C007 这种（三位数字）。请确认一下是 C007 吗？
  用量: 744 tokens
```

默认设置下,模型两次都看到那句固定的话,于是把同样的参数 `C0007` 又发了一遍,再失败,最后放弃,告诉用户「系统报错」。它没有机会知道错在客户号多了一个 0。指定了 `failure_error_function` 之后,模型第一次就读到「客户 id 形如 C007」,直接回复用户确认是不是 C007,用了 744 token,比默认的 1241 少。

**这和我昨天的 `Registry` 是相反的取舍。** 昨天我把异常原文给了模型,OpenAI 的默认是不给。它的理由写在函数的文档字符串里:异常里可能有敏感信息。两种都对,看你的工具会不会在异常里带出你不想让用户看到的东西。如果会,默认的做法更安全;如果工具都是你自己写的、异常消息可控,原文更有利于模型自救。

### 问题 3 和 4:怎么暂停,状态存成什么样

文档(`docs/human_in_the_loop.md`)里的流程是:工具声明 `needs_approval=True`,模型调用它时,运行暂停,`result.interruptions` 里有待批准的调用,`result.to_state()` 拿到 `RunState`,`state.approve(item)` 或 `state.reject(item)`,然后 `Runner.run(agent, state)` 接着跑。源码里这几步对应:`NextStepInterruption`(`run_steps.py:179`)、`RunState.approve`(`run_state.py:1380`)。

状态存成什么样?`run_state.py` 的 842 行是 `class RunState`,序列化函数 `to_json`、`to_string`、`from_string`。文件开头有一个 `CURRENT_SCHEMA_VERSION`(245 行起),下面一张 `SCHEMA_VERSION_SUMMARIES` 表记着每个版本加了什么。我实际存一份看看:

```python
# agent-zero-lab/part10/sources/oai_approval.py
"""问题三、四:需要人批准时怎么暂停?暂停的状态存在哪、什么格式?
用法: uv run python -m part10.sources.oai_approval pause
      uv run python -m part10.sources.oai_approval resume"""
import asyncio
import json
import sys
from pathlib import Path

from agents import Agent, Runner, RunState, function_tool

from part10.sources.oai_common import MODEL, SETTINGS

REFUNDS: list[dict[str, object]] = []
PATH = Path("out/oai_state.json")


@function_tool(needs_approval=True)
def create_refund(invoice_id: str, amount: int) -> str:
    """对一张发票发起退款,amount 单位是元。"""
    REFUNDS.append({"invoice_id": invoice_id, "amount": amount})
    return f"已退款 {amount} 元,单号 RF-{len(REFUNDS)}"


agent = Agent(name="客服", instructions="你是客服助手。要退款就调用 create_refund,回答简短。",
              tools=[create_refund], model=MODEL, model_settings=SETTINGS)


async def pause() -> None:
    r = await Runner.run(agent, "把发票 INV-2291 的 468 元退给客户。")
    print("final_output:", r.final_output)
    print("interruptions:", [(i.tool_name, i.arguments) for i in r.interruptions])
    PATH.parent.mkdir(exist_ok=True)
    PATH.write_text(r.to_state().to_string(), encoding="utf-8")
    data = json.loads(PATH.read_text(encoding="utf-8"))
    print("文件大小:", PATH.stat().st_size, "字节 | 顶层字段:", list(data))
    print("schema 版本:", data.get("$schemaVersion"), "| 退款流水:", REFUNDS)


async def resume() -> None:
    state = await RunState.from_string(agent, PATH.read_text(encoding="utf-8"))
    for item in state.get_interruptions():
        print("待批准:", item.tool_name, item.arguments)
        state.approve(item)
    r = await Runner.run(agent, state)
    print("final_output:", r.final_output)
    print("退款流水:", REFUNDS)


asyncio.run(pause() if sys.argv[1] == "pause" else resume())
```

<div class="line-notes">

- `REFUNDS: list[dict[str, object]] = []` 假的支付流水,和 Day 520 一样用来判断钱到底有没有动。
- `@function_tool(needs_approval=True)` 声明这个工具每次都要人批。`needs_approval` 也可以传一个函数,按参数决定要不要批(文档里有例子,今天用最简单的)。
- `r = await Runner.run(agent, "把发票 INV-2291 的 468 元退给客户。")` 这次运行会停在退款调用上,返回的结果里 `final_output` 是 `None`。
- `[(i.tool_name, i.arguments) for i in r.interruptions]` 每个待批准的调用有工具名和 JSON 字符串形式的参数。
- `PATH.write_text(r.to_state().to_string(), encoding="utf-8")` `to_state()` 把这次运行的结果转成可以继续的状态,`to_string()` 序列化成 JSON 文本,写进文件。
- `print("文件大小:", PATH.stat().st_size, "字节 | 顶层字段:", list(data))` 看文件多大、顶层有哪些字段。
- `state = await RunState.from_string(agent, PATH.read_text(encoding="utf-8"))` 另一个进程里把文本读回来。要传 `agent`,因为状态里记的是 Agent 的名字,不是 Agent 对象本身。
- `for item in state.get_interruptions():` 从状态里取出待批准项。官方文档的服务器场景里强调要这样做,不要信任客户端传来的内容。
- `state.approve(item)` 批准这一个调用。
- `r = await Runner.run(agent, state)` 把状态传给 `Runner.run`,从暂停的地方接着跑。

</div>

```bash
uv run python -m part10.sources.oai_approval pause
uv run python -m part10.sources.oai_approval resume
```

真实输出,第一个进程:

```text
final_output: None
interruptions: [('create_refund', '{"invoice_id": "INV-2291", "amount": 468}')]
文件大小: 10900 字节 | 顶层字段: ['$schemaVersion', 'current_turn', 'current_agent', 'original_input', 'pending_input', 'model_responses', 'context', 'tool_use_tracker', 'max_turns', 'no_active_agent_run', 'input_guardrail_results', 'output_guardrail_results', 'tool_input_guardrail_results', 'tool_output_guardrail_results', 'conversation_id', 'previous_response_id', 'auto_previous_response_id', 'generated_prompt_cache_key', 'reasoning_item_id_policy', 'nested_history_owned_session_item_refs', 'generated_session_item_indexes', 'current_response_generated_item_ownership', 'generated_items', 'session_items', 'current_step', 'last_model_response', 'last_processed_response', 'current_turn_persisted_item_count', 'trace']
schema 版本: 1.21 | 退款流水: []
```

第二个进程:

```text
待批准: create_refund {"invoice_id": "INV-2291", "amount": 468}
final_output: 已退款 468 元，退款单号 RF-1。
退款流水: [{'invoice_id': 'INV-2291', 'amount': 468}]
```

第一个进程里模型被调了一次,`final_output` 是 `None`,`interruptions` 里有那个 468 元的退款,流水是空的,钱没动。状态文件 10900 字节、29 个顶层字段,`$schemaVersion` 是 `1.21`,和源码里 `CURRENT_SCHEMA_VERSION = "1.21"` 对得上。第二个进程批准后退款执行,流水一笔。

对比 Day 520 我自己的存档:`messages`、`step`、`used`、`todo`、`approvals`,五个字段。它的 29 个字段里有很多是我的版本没有的东西:`input_guardrail_results`(护栏结果)、`trace`(追踪)、`generated_items` 和 `session_items`(会话条目)、`current_agent`(handoff 之后现在轮到谁)。**状态要存多少取决于 harness 管多少事。** 它管了护栏、handoff、会话、追踪,所以状态也就大。

这里还有一条文档里的安全提醒值得抄下来:`RunState.from_json` 和 `from_string` **不验证快照的真伪**。状态里包含批准记录,谁能改状态文件,谁就能替人批准。所以快照要放在服务端自己控制的存储里,别让浏览器把状态带来带去。昨天我的 `State` 里同样有 `approvals`,一模一样的风险,昨天我没提,今天补上。

### 钩子

OpenAI 的钩子在 `src/agents/lifecycle.py`。`RunHooksBase` 有 7 个方法(练习 1 会让你用脚本数):`on_llm_start`、`on_llm_end`、`on_agent_start`、`on_agent_end`、`on_handoff`、`on_tool_start`、`on_tool_end`。它们是只读通知,返回 `None`,这和昨天我的规矩一致。能拦截、能改行为的东西在别处:`needs_approval`(权限)和 `guardrails`(输入输出护栏)。

## Claude Agent SDK

### 问题 1:循环在哪?答:不在这里

先看那个反常的数字:整个 Python 包 1.35 万行,没有 `loop`、没有 `runner`。读 `_internal/transport/subprocess_cli.py`,类 `SubprocessCLITransport`(224 行起)的名字就是答案:它**启动一个子进程**。命令行以 `[self._cli_path, "--output-format", "stream-json", "--verbose"]` 开头。这个子进程是随包带的 Claude Code 本体。

确认一下:我装的 0.2.174 的发布包里,`claude_agent_sdk/_bundled/claude` 是一个 285 MB 的可执行文件,用一个不会读任何真实配置的假家目录问它版本:

```bash
mkdir -p fakehome
HOME=$PWD/fakehome .venv/lib/python3.12/site-packages/claude_agent_sdk/_bundled/claude --version
```

```text
2.1.310 (Claude Code)
```

和那个包里的 `_cli_version.py`(`2.1.310`)一致。所以结构是:**Python 这一层是协议客户端,循环在那个 285 MB 的进程里。** 这个进程是编译好的,我们读不到它的源码。这就是为什么我对这家「工具抛异常模型看到什么」没法像 OpenAI 那样读代码加实验回答。要实跑得让真的 Claude Code 去调 API 并且碰文件系统,而课程规定这类 Agent 必须关在沙箱里、不能让它读到我的真实目录和公司代码,我没有搭这套沙箱,所以**没实跑**。SDK 的 Python 一侧对工具失败只做了一件事:`types.py` 里的 `HookEvent` 有一个 `PostToolUseFailure`,让你旁观。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="Claude Agent SDK 的结构:你的应用和 Python SDK 在同一个进程,通过 stdin 和 stdout 上的 JSON 行与随包带的 Claude Code 进程通信,权限和钩子是 CLI 发回来的请求,由 SDK 调你的回调,循环在 CLI 进程里">
  <rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="20" y="30" width="270" height="120" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="155" y="50" fill="var(--ink)">你的 Python 进程</text>
    <rect x="40" y="62" width="110" height="36" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="95" y="84" fill="var(--ink)">can_use_tool</text>
    <rect x="160" y="62" width="110" height="36" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="215" y="84" fill="var(--ink)">hooks</text>
    <rect x="40" y="108" width="230" height="30" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="155" y="128" fill="var(--ink)">claude_agent_sdk(1.35 万行)</text>
    <rect x="350" y="30" width="270" height="120" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="485" y="50" fill="var(--ink)">claude 进程(285 MB,闭源)</text>
    <rect x="370" y="62" width="230" height="36" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="485" y="84" fill="var(--ink)">循环 · 工具 · 压缩 · 会话</text>
    <rect x="370" y="108" width="230" height="30" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="485" y="128" fill="var(--ink)">调模型 API</text>
  </g>
  <g stroke="var(--rule)" fill="none" stroke-width="1.5">
    <line x1="290" y1="85" x2="350" y2="85"/><line x1="290" y1="120" x2="350" y2="120"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)" text-anchor="middle">
    <text x="320" y="76">JSON 行</text><text x="320" y="112">control_request</text>
    <text x="320" y="185">stdin / stdout:CLI 反过来问 SDK「这个工具能用吗」,SDK 调你的回调再答</text>
  </g>
</svg>
<figcaption>Claude Agent SDK 的结构。琥珀色是你的进程,蓝色是别人的进程;循环在蓝色那边,所以 Python 这一侧只有协议和回调。</figcaption>
</figure>

### 它们是怎么通信的:用假 CLI 换掉真的

既然 Python 这一层只是协议客户端,就能用一个假的 CLI 换掉真的,看看它们之间说什么。`query()` 接受一个 `transport` 参数,`Transport` 是个抽象类,只有 `connect`、`write`、`read_messages`、`close`、`is_ready`、`end_input` 六个方法。我写一个 `FakeCLI`,按剧本回话:收到用户消息之后,先发一条 `hook_callback` 请求(让 SDK 调我的 `PreToolUse` 钩子),再发一条 `can_use_tool` 请求(让 SDK 调我的权限回调),然后给出结果。**这段没有调模型、没有启动真的 claude 进程、不碰任何本机文件**。注意 `Transport` 的文档字符串里有一句警告:这是内部 API,可能随时改,所以这段代码只用来学习,别用在生产里。

```python
# agent-zero-lab/part10/sources/claude_fake_cli.py
"""Claude Agent SDK 的 Python 这一层只是协议客户端。拿一个假的「CLI」换掉真的,看它收发什么。
这段没有调模型、没有启动真的 claude 进程,所以不花钱,也碰不到任何本机文件。"""
import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from claude_agent_sdk import (
    ClaudeAgentOptions,
    HookContext,
    HookMatcher,
    PermissionResultAllow,
    PermissionResultDeny,
    ToolPermissionContext,
    Transport,
    query,
)


class FakeCLI(Transport):
    """扮演 claude 进程:收 SDK 写来的 JSON 行,按剧本回话。"""

    def __init__(self) -> None:
        self.inbox: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()   # 发给 SDK 的
        self.replies: dict[str, asyncio.Future[dict[str, Any]]] = {}          # 等 SDK 回应的
        self.hook_ids: list[str] = []
        self.log: list[str] = []
        self.ready = False

    async def connect(self) -> None:
        self.ready = True

    def is_ready(self) -> bool:
        return self.ready

    async def end_input(self) -> None:
        pass

    async def close(self) -> None:
        self.ready = False

    async def read_messages(self) -> AsyncIterator[dict[str, Any]]:
        while True:
            m = await self.inbox.get()
            if m is None:
                return
            yield m

    async def ask_sdk(self, request_id: str, request: dict[str, Any]) -> dict[str, Any]:
        """CLI 向 SDK 发一个 control_request,等 SDK 的 control_response。"""
        fut: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self.replies[request_id] = fut
        await self.inbox.put({"type": "control_request", "request_id": request_id, "request": request})
        return await fut

    async def write(self, data: str) -> None:
        msg = json.loads(data)
        self.log.append(f"SDK -> CLI  {msg['type']}/{msg.get('request', {}).get('subtype', '')}")
        if msg["type"] == "control_request" and msg["request"]["subtype"] == "initialize":
            hooks = msg["request"].get("hooks") or {}
            self.hook_ids = [i for ms in hooks.get("PreToolUse", []) for i in ms["hookCallbackIds"]]
            await self.inbox.put({"type": "control_response", "response": {
                "subtype": "success", "request_id": msg["request_id"], "response": {"commands": []}}})
        elif msg["type"] == "control_response":
            self.replies.pop(msg["response"]["request_id"]).set_result(msg["response"]["response"])
        elif msg["type"] == "user":
            asyncio.create_task(self.script())

    async def script(self) -> None:
        tool = {"tool_name": "create_refund", "input": {"invoice_id": "INV-2291", "amount": 468}}
        # 第 1 步:模型想用工具了。先过 PreToolUse 钩子
        h = await self.ask_sdk("cli_1", {"subtype": "hook_callback", "callback_id": self.hook_ids[0], "tool_use_id": "tu_1",
                                         "input": {"hook_event_name": "PreToolUse", "tool_name": tool["tool_name"],
                                                   "tool_input": tool["input"], "tool_use_id": "tu_1", "session_id": "s1",
                                                   "transcript_path": "", "cwd": "/Users/你/work"}})
        self.log.append(f"CLI 收到钩子的回复: {json.dumps(h, ensure_ascii=False)}")
        # 第 2 步:钩子没拦,再问 can_use_tool(权限)
        p = await self.ask_sdk("cli_2", {"subtype": "can_use_tool", "tool_use_id": "tu_1", **tool})
        self.log.append(f"CLI 收到权限回调的回复: {json.dumps(p, ensure_ascii=False)}")
        text = "已退款" if p["behavior"] == "allow" else f"被拒绝:{p['message']}"
        await self.inbox.put({"type": "assistant", "message": {"model": "fake", "content": [{"type": "text", "text": text}]}})
        await self.inbox.put({"type": "result", "subtype": "success", "duration_ms": 1, "duration_api_ms": 0,
                              "is_error": False, "num_turns": 1, "session_id": "s1", "result": text})
        await self.inbox.put(None)


async def prompt() -> AsyncIterator[dict[str, Any]]:
    yield {"type": "user", "message": {"role": "user", "content": "退掉 INV-2291"}, "parent_tool_use_id": None}


async def audit_hook(data: dict[str, Any], tool_use_id: str | None, ctx: HookContext) -> dict[str, Any]:
    print(f"  [钩子 PreToolUse] {data['tool_name']} {data['tool_input']} id={tool_use_id}")
    return {}  # 空字典 = 不干预


async def can_use(name: str, tool_input: dict[str, Any], ctx: ToolPermissionContext) -> PermissionResultAllow | PermissionResultDeny:
    print(f"  [can_use_tool] {name} {tool_input}")
    if tool_input.get("amount", 0) > 100:
        return PermissionResultDeny(message="超过 100 元要人工批准")
    return PermissionResultAllow()


async def main() -> None:
    cli = FakeCLI()
    opts = ClaudeAgentOptions(can_use_tool=can_use,
                              hooks={"PreToolUse": [HookMatcher(matcher="create_refund", hooks=[audit_hook])]})
    async for m in query(prompt=prompt(), options=opts, transport=cli):
        print("SDK 交给应用的消息:", type(m).__name__, getattr(m, "result", None) or getattr(m, "content", None))
    print("--- 线上来回的消息")
    for line in cli.log:
        print(" ", line)


asyncio.run(main())
```

<div class="line-notes">

- `class FakeCLI(Transport):` 继承抽象类,必须实现六个方法,少一个就不能实例化。
- `self.inbox: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()   # 发给 SDK 的` 一个异步队列,「CLI 想对 SDK 说的话」都往里放,`read_messages` 从里面取。`None` 是结束的信号。
- `self.replies: dict[str, asyncio.Future[dict[str, Any]]] = {}` 「CLI 在等 SDK 回应的请求」,键是请求 id。`Future` 相当于 JS 的 Promise。
- `async def read_messages(self) -> AsyncIterator[dict[str, Any]]:` 异步生成器,SDK 用 `async for` 读它。内部是死循环从队列取,取到 `None` 就 `return` 结束。
- `async def ask_sdk(self, request_id: str, request: dict[str, Any]) -> dict[str, Any]:` CLI 向 SDK 发一个 `control_request`,然后 `await fut` 等 SDK 回话。这就是「SDK 反过来被 CLI 调用」的机制。
- `await self.inbox.put({"type": "control_request", "request_id": request_id, "request": request})` 消息格式:`type` 是 `control_request`,`request` 里有 `subtype`(这次是 `hook_callback` 或 `can_use_tool`)。
- `if msg["type"] == "control_request" and msg["request"]["subtype"] == "initialize":` SDK 一连接先发 `initialize`,里面带着它注册的钩子清单(每个钩子分到一个 `hookCallbackIds`)。
- `self.hook_ids = [i for ms in hooks.get("PreToolUse", []) for i in ms["hookCallbackIds"]]` 把 PreToolUse 钩子的回调 id 记下来,待会儿要用 id 去喊它。**这说明钩子函数从不离开你的进程,CLI 只拿到一个 id,要触发时发消息让 SDK 去调。**
- `elif msg["type"] == "control_response":` SDK 对 CLI 请求的回应,放进对应的 Future,让 `ask_sdk` 返回。
- `elif msg["type"] == "user":` 收到用户消息,开一个后台任务跑剧本。
- `h = await self.ask_sdk("cli_1",` 剧本第 1 步:用 `hook_callback` 请求触发钩子。
- `p = await self.ask_sdk("cli_2", {"subtype": "can_use_tool", "tool_use_id": "tu_1", **tool})` 剧本第 2 步:问权限。
- `text = "已退款" if p["behavior"] == "allow" else f"被拒绝:{p['message']}"` 根据 SDK 回的判决决定结果。
- `async def audit_hook(data: dict[str, Any], tool_use_id: str | None, ctx: HookContext) -> dict[str, Any]:` 钩子函数的签名:收事件数据、工具调用 id、上下文,返回一个字典。返回 `{}` 表示不干预。
- `async def can_use(name: str, tool_input: dict[str, Any], ctx: ToolPermissionContext)` 权限回调的签名:收工具名和参数,返回 `PermissionResultAllow` 或 `PermissionResultDeny`。
- `if tool_input.get("amount", 0) > 100:` 和昨天的策略一个思路:超过 100 元拒绝。
- `opts = ClaudeAgentOptions(can_use_tool=can_use,` 两个扩展点都挂在 `ClaudeAgentOptions` 上。`matcher="create_refund"` 表示这个钩子只对这个工具触发。
- `async for m in query(prompt=prompt(), options=opts, transport=cli):` 传入自己的 `transport`,不传就会启动真的 CLI。注意 `prompt` 是个异步生成器:带 `can_use_tool` 或钩子的时候 SDK 要求流式输入。

</div>

```bash
uv run python -m part10.sources.claude_fake_cli
```

真实输出:

```text
  [钩子 PreToolUse] create_refund {'invoice_id': 'INV-2291', 'amount': 468} id=tu_1
  [can_use_tool] create_refund {'invoice_id': 'INV-2291', 'amount': 468}
SDK 交给应用的消息: AssistantMessage [TextBlock(text='被拒绝:超过 100 元要人工批准')]
SDK 交给应用的消息: ResultMessage 被拒绝:超过 100 元要人工批准
--- 线上来回的消息
  SDK -> CLI  control_request/initialize
  SDK -> CLI  user/
  SDK -> CLI  control_response/
  CLI 收到钩子的回复: {}
  SDK -> CLI  control_response/
  CLI 收到权限回调的回复: {"behavior": "deny", "message": "超过 100 元要人工批准"}
```

先是应用侧看到的:钩子被喊到了(打印的 `id=tu_1` 是 CLI 给的工具调用 id),权限回调被喊到了,拒绝了 468 元的退款,SDK 交给应用的消息是一条 `AssistantMessage` 和一条 `ResultMessage`。再是线上来回的完整记录:SDK 先发 `initialize`,再发用户消息,之后两条 `control_response` 分别是对钩子和权限的回应;CLI 收到钩子回的是空字典,收到权限回调回的是 `{"behavior": "deny", "message": "超过 100 元要人工批准"}`。

这个小实验让我明白了三件事。**第一,Claude 的权限是个回调**:CLI 在每次工具调用前问 SDK「这个允许吗」,SDK 去调你的 `can_use_tool`,你回 allow 或 deny。这对应 `_internal/query.py` 的 586 行 `subtype == "can_use_tool"`。**第二,钩子和权限是两个不同的东西**:钩子(`PreToolUse`)可以旁观或介入,权限回调是最终判决;先钩子后权限。**第三,和 OpenAI 的暂停恢复不同,这里看不到「暂停时存下的状态文件」**:CLI 发出请求后在等你的回调返回。我没在 SDK 里找到类似 `RunState` 的「暂停、存档、以后再批」入口,所以我的推断是:想「等人批准几个小时」,就得让回调自己等,进程一直活着(这是推断,我没实跑)。会话本身的恢复是另一回事,靠 `resume` 和 `session_id`。

### 它给你的扩展点清单

`ClaudeAgentOptions` 是它所有扩展点的集中地。我把每个字段读了一遍文档注释,按 Day 520 的七层分类,再用脚本检查「有没有漏分的」(字段名是从安装的包里读出来的,所以包升级后新增的字段会被抓出来):

```python
# agent-zero-lab/part10/sources/claude_options_by_layer.py
"""问题:Claude Agent SDK 的「扩展点清单」ClaudeAgentOptions 里,每个字段属于 harness 的哪一层?
字段是从安装好的包里读出来的,分类是我读完 types.py 里每个字段的注释后手写的。"""
from collections import defaultdict
from dataclasses import fields

import claude_agent_sdk
from claude_agent_sdk import ClaudeAgentOptions

LAYERS: dict[str, str] = {
    # 循环:什么时候停
    "max_turns": "循环", "max_budget_usd": "循环", "task_budget": "循环",
    # 模型
    "model": "模型", "fallback_model": "模型", "betas": "模型", "thinking": "模型",
    "max_thinking_tokens": "模型", "effort": "模型", "output_format": "模型",
    # 工具
    "tools": "工具", "allowed_tools": "工具", "disallowed_tools": "工具", "mcp_servers": "工具",
    "strict_mcp_config": "工具", "skills": "工具", "plugins": "工具",
    # 上下文
    "system_prompt": "上下文", "setting_sources": "上下文", "add_dirs": "上下文", "cwd": "上下文",
    "verbatim_prompts": "上下文",
    # 权限和沙箱
    "permission_mode": "权限", "permission_prompt_tool_name": "权限", "can_use_tool": "权限", "sandbox": "权限",
    # 钩子和事件流
    "hooks": "钩子", "include_hook_events": "钩子", "include_partial_messages": "钩子",
    # 子 Agent
    "agents": "子 Agent", "forward_subagent_text": "子 Agent",
    # 状态持久化
    "continue_conversation": "持久化", "resume": "持久化", "session_id": "持久化", "fork_session": "持久化",
    "resume_session_at": "持久化", "resume_drops_turn": "持久化", "session_store": "持久化",
    "session_store_flush": "持久化", "load_timeout_ms": "持久化", "enable_file_checkpointing": "持久化",
    # 不属于七层:怎么拉起那个外部进程
    "cli_path": "进程", "env": "进程", "extra_args": "进程", "max_buffer_size": "进程",
    "debug_stderr": "进程", "stderr": "进程", "settings": "进程", "user": "进程",
}

names = [f.name for f in fields(ClaudeAgentOptions)]
missing = [n for n in names if n not in LAYERS]
stale = [n for n in LAYERS if n not in names]
print(f"claude-agent-sdk {claude_agent_sdk.__version__}:ClaudeAgentOptions 共 {len(names)} 个字段")
print("没分类的:", missing, "| 分类表里多出来的:", stale)

by_layer: dict[str, list[str]] = defaultdict(list)
for n in names:
    by_layer[LAYERS.get(n, "?")].append(n)
for layer, ns in sorted(by_layer.items(), key=lambda kv: -len(kv[1])):
    print(f"{layer:<6}{len(ns):>3}  {', '.join(ns)}")
```

<div class="line-notes">

- `from dataclasses import fields` `ClaudeAgentOptions` 是个 dataclass,`fields(...)` 能列出它的所有字段,不用自己解析源码。
- `LAYERS: dict[str, str] = {` 手写的分类表:字段名到层名。每一条都是我读了字段的注释之后决定的,不是猜名字。
- `"max_turns": "循环", "max_budget_usd": "循环", "task_budget": "循环",` 属于第 1 层的只有这三个。`task_budget` 是让模型自己知道还剩多少 token 预算的 API 侧功能。
- `"setting_sources": "上下文"` 这个字段要特别注意:`None` 表示加载所有来源(用户级、项目级、本地的 settings 和 CLAUDE.md),传 `[]` 才是「SDK 隔离模式」。
- `"cli_path": "进程", "env": "进程",` 不属于七层的一类:怎么拉起那个外部进程。这一类存在本身说明了这家的架构。
- `missing = [n for n in names if n not in LAYERS]` 有字段没分类,就会出现在这里。
- `stale = [n for n in LAYERS if n not in names]` 分类表里有、包里已经没有的字段。
- `by_layer[LAYERS.get(n, "?")].append(n)` 按层归组。`defaultdict(list)` 让不存在的键自动是空列表。

</div>

```bash
uv run python -m part10.sources.claude_options_by_layer
```

```text
claude-agent-sdk 0.2.174:ClaudeAgentOptions 共 49 个字段
没分类的: [] | 分类表里多出来的: []
持久化    10  continue_conversation, resume, session_id, fork_session, resume_session_at, resume_drops_turn, enable_file_checkpointing, session_store, session_store_flush, load_timeout_ms
进程      8  cli_path, settings, env, extra_args, max_buffer_size, debug_stderr, stderr, user
工具      7  tools, allowed_tools, mcp_servers, strict_mcp_config, disallowed_tools, skills, plugins
模型      7  model, fallback_model, betas, max_thinking_tokens, thinking, effort, output_format
上下文     5  system_prompt, cwd, add_dirs, verbatim_prompts, setting_sources
权限      4  permission_mode, permission_prompt_tool_name, can_use_tool, sandbox
循环      3  max_turns, max_budget_usd, task_budget
钩子      3  hooks, include_partial_messages, include_hook_events
子 Agent  2  forward_subagent_text, agents
```

49 个字段,没有漏分的。对比一下:**第 1 层「循环」只有 3 个字段,而且都是「什么时候停」**,没有一个字段让你改循环本身。持久化占 10 个,是最多的,工具 7 个、模型 7 个。还有 8 个「进程」类字段,是前两家没有的一类。

`setting_sources` 值得单独说一次。它默认(`None`)会加载运行这台机器上的用户级设置:`~/.claude/settings.json`、项目里的 `.claude/settings.json` 和 CLAUDE.md。对个人工具这很方便,对**平台**是个坑:你部署在服务器上的 Agent 会读到服务器上某个人的设置和钩子。平台里应该传 `setting_sources=[]`,把「隔离」写成显式的。

### 钩子

`HookEvent` 有 10 个事件(练习 1 的脚本会数出来):`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`UserPromptSubmit`、`Stop`、`SubagentStop`、`PreCompact`、`Notification`、`SubagentStart`、`PermissionRequest`。和 OpenAI 的 7 个比,这里多了几个很贴近「长任务」的:`PreCompact`(上下文压缩之前通知你,你可以把重要信息先存下来)、`SubagentStart` 和 `SubagentStop`。

## LangGraph

### 问题 1:循环在哪

LangGraph 的循环在 `pregel/main.py` 3055 行:

```python
while loop.tick():
    for task in loop.match_cached_writes():
        loop.put_writes(task.id, task.writes, cached=True)
    for _ in runner.tick([t for t in loop.tasks.values() if not t.writes], ...):
        # emit output
        yield from _output(...)
    loop.after_tick()
```

`loop` 是 `pregel/_loop.py` 里的 `PregelLoop`(170 行起)。`tick` 方法(650 行)做三件事:检查是否超出步数上限(`self.step > self.stop`,超了设状态 `out_of_steps`);找出这一步该运行的节点(`prepare_next_tasks`);检查是否要在运行前中断(`interrupt_before`)。`after_tick`(700 行)做相反方向的事:把所有节点的写入合并进状态(`apply_writes`),然后**存一个 checkpoint**(`self._put_checkpoint({"source": "loop"})`),再检查要不要在运行后中断(`interrupt_after`)。

源码里有一段注释把模型讲得很清楚(`main.py` 3050 行起):像 Bulk Synchronous Parallel(Pregel 模型)一样,计算按「步」推进,第 N 步里节点的写入,到第 N+1 步才可见。**这个「步」就是 super-step,是 LangGraph 里一切计数的单位。** 步数上限、checkpoint、中断都按它算。

### 动手:用最小的图看 super-step 和 checkpoint

LangGraph 不假设你在写 Agent 循环,所以要自己把 Agent 搭出来:一个模型节点、一个工具节点、一条条件边(有工具调用就去工具节点,没有就结束)。为了不依赖 langchain,消息直接用 OpenAI 格式的字典,工具复用昨天的 `Registry`:

```python
# agent-zero-lab/part10/sources/lg_agent.py
"""用 LangGraph 的 StateGraph 手搭一个 Agent 循环:模型节点 + 工具节点 + 一条条件边。不依赖 langchain。"""
import json
import operator
from typing import Annotated, Any, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph

from part10.harness.fake import Chatter
from part10.harness.s2_tools import Registry
from part10.harness.tools import FUNCS, TOOL_SPECS


class AgentState(TypedDict):
    # Annotated[..., operator.add]:每个节点返回的 messages 会被「追加」到旧列表后面,不是覆盖
    messages: Annotated[list[dict[str, Any]], operator.add]


def build(client: Chatter, interrupt_before: list[str] | None = None) -> CompiledStateGraph[AgentState, None, AgentState, AgentState]:
    registry = Registry(FUNCS)

    def model_node(state: AgentState) -> dict[str, Any]:
        r = client.chat(state["messages"], tools=TOOL_SPECS, temperature=0)
        return {"messages": [r.message]}

    def tool_node(state: AgentState) -> dict[str, Any]:
        out = []
        for tc in state["messages"][-1].get("tool_calls") or []:
            result = registry.execute(tc["function"]["name"], tc["function"]["arguments"])
            out.append({"role": "tool", "tool_call_id": tc["id"], "content": result})
        return {"messages": out}

    def route(state: AgentState) -> str:
        return "tools" if state["messages"][-1].get("tool_calls") else END

    g = StateGraph(AgentState)
    g.add_node("model", model_node)
    g.add_node("tools", tool_node)
    g.add_edge(START, "model")
    g.add_conditional_edges("model", route, ["tools", END])
    g.add_edge("tools", "model")
    return g.compile(checkpointer=InMemorySaver(), interrupt_before=interrupt_before)


def show_history(graph: CompiledStateGraph[AgentState, None, AgentState, AgentState], config: Any) -> None:
    for snap in reversed(list(graph.get_state_history(config))):
        last = snap.values["messages"][-1]["role"] if snap.values.get("messages") else "-"
        print(f"  step={snap.metadata['step']:>2} source={snap.metadata['source']:<6} 消息数={len(snap.values.get('messages', []))} "
              f"最后一条={last:<9} 下一步={snap.next}")


if __name__ == "__main__":
    from part10.harness.fake import Reply, Scripted, call, say
    script = Scripted([
        Reply(call("list_invoices", json.dumps({"customer_id": "C007"}), "g1")),
        Reply(call("create_refund", json.dumps({"invoice_id": "INV-2291", "amount": 468}), "g2")),
        Reply(say("已退款。")),
    ])
    graph = build(script)
    cfg: Any = {"configurable": {"thread_id": "t1"}}
    out = graph.invoke({"messages": [{"role": "user", "content": "C007 被扣了两次,退掉重复的"}]}, cfg)
    print("最终消息角色:", [m["role"] for m in out["messages"]])
    print("每个 super-step 存了一个 checkpoint:")
    show_history(graph, cfg)
```

<div class="line-notes">

- `messages: Annotated[list[dict[str, Any]], operator.add]` 状态的唯一字段。`Annotated[..., operator.add]` 告诉 LangGraph:节点返回的 `messages` 要**追加**到旧列表后面(`operator.add` 对列表就是拼接),不是覆盖。这是 reducer(归约函数)。不写它,每个节点返回的列表会把旧消息全冲掉。
- `registry = Registry(FUNCS)` 昨天的 `Registry`,工具层照搬。
- `def model_node(state: AgentState) -> dict[str, Any]:` 节点就是一个函数:收状态,返回「要写入的更新」。返回 `{"messages": [r.message]}`,会被 reducer 追加。
- `for tc in state["messages"][-1].get("tool_calls") or []:` 取最后一条消息(模型刚说的那条)的所有工具调用,逐个执行。
- `return "tools" if state["messages"][-1].get("tool_calls") else END` 条件边:最后一条消息有工具调用就去 `tools` 节点,没有就 `END`。
- `g.add_edge(START, "model")` 入口边。
- `g.add_conditional_edges("model", route, ["tools", END])` 从 `model` 出发,由 `route` 函数决定去哪。第三个参数列出所有可能的去向,供画图和检查用。
- `g.add_edge("tools", "model")` 工具执行完回到模型。这一条边和上一条条件边合起来,就是 Day 520 里 `_drive` 的那个 `while`。
- `return g.compile(checkpointer=InMemorySaver(), interrupt_before=interrupt_before)` 编译成可运行的图。`InMemorySaver` 把 checkpoint 存在内存里,进程退出就没了,够演示用;持久的版本(sqlite、postgres)在 Day 539 讲。
- `for snap in reversed(list(graph.get_state_history(config))):` 取这个会话(`thread_id`)的所有 checkpoint,历史是从新到旧的,`reversed` 翻成从旧到新。
- `snap.metadata['step']` 每个 checkpoint 的 `step`。输入进来那一刻是 -1。

</div>

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="LangGraph 的 super-step:每一步先 tick 找出要运行的节点,节点并行运行,after_tick 合并写入并存一个 checkpoint;模型节点和工具节点交替,每个节点各占一步">
  <rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="20" y="40" width="90" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="65" y="64" fill="var(--ink)">step 1 model</text>
    <rect x="130" y="40" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="175" y="64" fill="var(--ink)">step 2 tools</text>
    <rect x="240" y="40" width="90" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="285" y="64" fill="var(--ink)">step 3 model</text>
    <rect x="350" y="40" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="395" y="64" fill="var(--ink)">step 4 tools</text>
    <rect x="460" y="40" width="90" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="505" y="64" fill="var(--ink)">step 5 model</text>
    <text x="65" y="108" fill="var(--ink-faint)">ckpt</text><text x="175" y="108" fill="var(--ink-faint)">ckpt</text><text x="285" y="108" fill="var(--ink-faint)">ckpt</text><text x="395" y="108" fill="var(--ink-faint)">ckpt</text><text x="505" y="108" fill="var(--ink-faint)">ckpt</text>
    <text x="320" y="150" fill="var(--ink-soft)">recursion_limit=10 时最多 10 个方块,模型只出现 5 次</text>
  </g>
  <g stroke="var(--rule)" fill="none" stroke-width="1.5">
    <line x1="110" y1="60" x2="130" y2="60"/><line x1="220" y1="60" x2="240" y2="60"/><line x1="330" y1="60" x2="350" y2="60"/><line x1="440" y1="60" x2="460" y2="60"/>
    <line x1="65" y1="80" x2="65" y2="96"/><line x1="175" y1="80" x2="175" y2="96"/><line x1="285" y1="80" x2="285" y2="96"/><line x1="395" y1="80" x2="395" y2="96"/><line x1="505" y1="80" x2="505" y2="96"/>
  </g>
</svg>
<figcaption>super-step 计数。模型节点和工具节点各占一步、每步结束存一个 checkpoint;上限数的是方块,不是模型调用。</figcaption>
</figure>

`__main__` 里用一个照剧本说话的模型跑一遍(没调 API),然后打印每个 checkpoint:

```text
最终消息角色: ['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']
每个 super-step 存了一个 checkpoint:
  step=-1 source=input  消息数=0 最后一条=-         下一步=('__start__',)
  step= 0 source=loop   消息数=1 最后一条=user      下一步=('model',)
  step= 1 source=loop   消息数=2 最后一条=assistant 下一步=('tools',)
  step= 2 source=loop   消息数=3 最后一条=tool      下一步=('model',)
  step= 3 source=loop   消息数=4 最后一条=assistant 下一步=('tools',)
  step= 4 source=loop   消息数=5 最后一条=tool      下一步=('model',)
  step= 5 source=loop   消息数=6 最后一条=assistant 下一步=()
```

6 条消息,7 个 checkpoint,从 `step=-1`(输入刚写进去)到 `step=5`(下一步是空,结束)。**每个 super-step 一个 checkpoint**:`step=1` 之后下一步是 `tools`,`step=2` 之后下一步是 `model`,交替出现。一个典型 Agent 的循环,在这里被拆成了「节点加边」,读代码时你得在脑子里把它拼回 while 循环。

### 问题 2:工具抛异常

LangGraph 的工具节点在另一个包里:`libs/prebuilt/langgraph/prebuilt/tool_node.py`。第 391 行有默认的错误处理函数:

```python
def _default_handle_tool_errors(e: Exception) -> str:
    """Default error handler for tool errors.

    If the tool is a tool invocation error, return its message.
    Otherwise, raise the error.
    """
    if isinstance(e, ToolInvocationError):
        return e.message
    raise e
```

读起来是:**只有参数校验错误(`ToolInvocationError`)会变成消息还给模型,其他异常原样抛出。** 实验验证。`ToolNode` 要放进图里才能跑:

```python
# agent-zero-lab/part10/sources/lg_tool_error.py
"""问题二(LangGraph 版):ToolNode 默认怎么处理工具里的异常?参数写错和工具内部出错,各是什么待遇?"""
from langchain_core.messages import AIMessage
from langgraph.graph import START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode


def list_invoices(customer_id: str) -> str:
    """查一个客户的全部发票。"""
    raise ValueError(f"没有这个客户:{customer_id}")


def run(node: ToolNode, args: dict[str, object]) -> None:
    g = StateGraph(MessagesState)  # ToolNode 要放进图里才能跑,它要从图的运行配置里取东西
    g.add_node("tools", node)
    g.add_edge(START, "tools")
    msg = AIMessage(content="", tool_calls=[{"name": "list_invoices", "args": args, "id": "t1"}])
    try:
        out = g.compile().invoke({"messages": [msg]})
        print("  工具消息:", out["messages"][-1].content[:120].replace("\n", " "))
    except Exception as e:
        print("  异常往外抛了:", type(e).__name__, str(e)[:60])


print("默认设置,参数名写错(缺 customer_id):")
run(ToolNode([list_invoices]), {"cust": "C007"})
print("默认设置,工具内部抛 ValueError:")
run(ToolNode([list_invoices]), {"customer_id": "C0007"})
print("handle_tool_errors=True:")
run(ToolNode([list_invoices], handle_tool_errors=True), {"customer_id": "C0007"})
```

<div class="line-notes">

- `from langchain_core.messages import AIMessage` `ToolNode` 用的是 langchain 的消息类型(`langchain-core` 随 langgraph 一起装上)。这里只造一条带 `tool_calls` 的 AI 消息当输入。
- `g = StateGraph(MessagesState)  # ToolNode 要放进图里才能跑,它要从图的运行配置里取东西` 我第一次直接 `node.invoke(...)`,报了 `ValueError: Missing required config key 'N/A' for 'tools'.`,所以要包一层最小的图。`MessagesState` 是 LangGraph 自带的、只有一个 `messages` 字段的状态。
- `msg = AIMessage(content="", tool_calls=[{"name": "list_invoices", "args": args, "id": "t1"}])` 手造一条模型说「我要调 list_invoices」的消息。
- `out = g.compile().invoke({"messages": [msg]})` 跑图,拿到的状态里最后一条是工具消息。
- `run(ToolNode([list_invoices]), {"cust": "C007"})` 第一种:参数名写错(没传 `customer_id`)。
- `run(ToolNode([list_invoices]), {"customer_id": "C0007"})` 第二种:参数对,但工具内部抛 `ValueError`。
- `ToolNode([list_invoices], handle_tool_errors=True)` 第三种:显式打开错误处理。

</div>

```bash
uv run python -m part10.sources.lg_tool_error
```

真实输出:

```text
默认设置,参数名写错(缺 customer_id):
  工具消息: Error invoking tool 'list_invoices' with kwargs {'cust': 'C007'} with error:  customer_id: Field required  Please fix th
默认设置,工具内部抛 ValueError:
  异常往外抛了: ValueError 没有这个客户:C0007
handle_tool_errors=True:
  工具消息: Error: ValueError('没有这个客户:C0007')  Please fix your mistakes.
```

参数名写错:变成一条给模型的消息,内容是 pydantic 的校验报错(`customer_id: Field required`)加一句 `Please fix your mistakes.`。工具内部抛 `ValueError`:异常原样往外抛,图的运行直接失败。`handle_tool_errors=True` 之后:变成 `Error: ValueError('没有这个客户:C0007')  Please fix your mistakes.` 给模型。

### 问题 3:怎么暂停

`_loop.py` 的 `tick` 里,执行节点之前有一段(679 行附近):

```python
if self.interrupt_before and should_interrupt(self.checkpoint, self.interrupt_before, self.tasks.values()):
    self.status = "interrupt_before"
    raise GraphInterrupt()
```

暂停就是抛一个 `GraphInterrupt`,状态已经在上一个 `after_tick` 里存成了 checkpoint。恢复时用同一个 `thread_id` 再调一次 `invoke(None, config)`:输入传 `None` 表示「没有新输入,从 checkpoint 接着跑」。两个小实验放在一个脚本里,都用剧本模型:

```python
# agent-zero-lab/part10/sources/lg_interrupt.py
"""问题一、三:LangGraph 的「步数上限」在哪?「暂停等人」怎么做?两个小实验,都用剧本模型。"""
import json
from typing import Any

from langgraph.errors import GraphRecursionError

from part10.harness.fake import Reply, Scripted, call, say
from part10.sources.lg_agent import build, show_history

user = {"messages": [{"role": "user", "content": "C007 被扣了两次,退掉重复的"}]}

print("== 实验 1:模型永远在调工具,recursion_limit=6")
forever = Scripted([Reply(call("list_invoices", json.dumps({"customer_id": "C007"}), "x"))])
cfg: Any = {"configurable": {"thread_id": "loop"}, "recursion_limit": 6}
try:
    build(forever).invoke(user, cfg)
except GraphRecursionError as e:
    print(type(e).__name__, "|", str(e).split("\n")[0])
print("模型被调了", forever.n, "次")

print("== 实验 2:interrupt_before=['tools'],每次要进工具节点前都停")
script = Scripted([
    Reply(call("list_invoices", json.dumps({"customer_id": "C007"}), "g1")),
    Reply(call("create_refund", json.dumps({"invoice_id": "INV-2291", "amount": 468}), "g2")),
    Reply(say("已退款。")),
])
graph = build(script, interrupt_before=["tools"])
cfg = {"configurable": {"thread_id": "hitl"}}
graph.invoke(user, cfg)
pauses = 1
while graph.get_state(cfg).next:
    pending = graph.get_state(cfg).values["messages"][-1]["tool_calls"][0]["function"]
    print(f"第 {pauses} 次暂停,下一步 {graph.get_state(cfg).next},要执行 {pending['name']}({pending['arguments']})")
    graph.invoke(None, cfg)  # 传 None = 不加新输入,从 checkpoint 接着跑
    pauses += 1
final = graph.get_state(cfg).values["messages"]
print("跑完了。最后一条:", final[-1]["content"])
show_history(graph, cfg)
```

<div class="line-notes">

- `forever = Scripted([Reply(call(` 剧本只有一条,剧本模型用完会一直重复最后一条,所以这个模型永远在调工具。
- `cfg: Any = {"configurable": {"thread_id": "loop"}, "recursion_limit": 6}` `thread_id` 是会话 id,checkpoint 按它分组。`recursion_limit` 是步数上限,注意它和 `thread_id` 放在同一个配置字典里。
- `except GraphRecursionError as e:` 超出上限抛这个异常。`str(e).split("\n")[0]` 只取第一行,后面是一段文档链接。
- `print("模型被调了", forever.n, "次")` `Scripted.n` 是被调用的次数。
- `graph = build(script, interrupt_before=["tools"])` 在每次进入 `tools` 节点之前暂停。
- `graph.invoke(user, cfg)` 第一次调用,走到要进 `tools` 节点时暂停并返回。
- `while graph.get_state(cfg).next:` `get_state(...).next` 是「下一步要运行的节点」,空元组表示跑完了。
- `graph.invoke(None, cfg)  # 传 None = 不加新输入,从 checkpoint 接着跑` 恢复。这里没有「批准」这个概念,只是「继续」。想拒绝得自己改状态,或者不调这一句。

</div>

```bash
uv run python -m part10.sources.lg_interrupt
```

真实输出:

```text
== 实验 1:模型永远在调工具,recursion_limit=6
GraphRecursionError | Recursion limit of 6 reached without hitting a stop condition. You can increase the limit by setting the `recursion_limit` config key.
模型被调了 3 次
== 实验 2:interrupt_before=['tools'],每次要进工具节点前都停
第 1 次暂停,下一步 ('tools',),要执行 list_invoices({"customer_id": "C007"})
第 2 次暂停,下一步 ('tools',),要执行 create_refund({"invoice_id": "INV-2291", "amount": 468})
跑完了。最后一条: 已退款。
  step=-1 source=input  消息数=0 最后一条=-         下一步=('__start__',)
  step= 0 source=loop   消息数=1 最后一条=user      下一步=('model',)
  step= 1 source=loop   消息数=2 最后一条=assistant 下一步=('tools',)
  step= 2 source=loop   消息数=3 最后一条=tool      下一步=('model',)
  step= 3 source=loop   消息数=4 最后一条=assistant 下一步=('tools',)
  step= 4 source=loop   消息数=5 最后一条=tool      下一步=('model',)
  step= 5 source=loop   消息数=6 最后一条=assistant 下一步=()
```

**实验 1 里有一个我读代码时没想到的数字**:`recursion_limit=6`,模型只被调用了 **3 次**。因为上限数的是 super-step:一次模型节点算一步,一次工具节点也算一步,6 步就是 3 次模型加 3 次工具。如果你以为 `recursion_limit` 是「最多让模型想几次」,设成 6 实际只给了 3 次机会。设成 10 是 5 次(我实测的,练习 2 会让你自己预测)。

**实验 2** 暂停了两次:第一次停在 `list_invoices` 前,第二次停在 `create_refund` 前,每次都要手动继续。这是 `interrupt_before=["tools"]` 的粒度:**节点级**,不管工具是什么、参数是什么,只要进工具节点就停。想只在金额超过 100 元时才停,要在节点内部用 `interrupt()` 函数按条件触发,或者拆成两个节点。OpenAI 的 `needs_approval` 可以直接传一个按参数判断的函数,粒度更细。这是两边设计出发点不同的体现:LangGraph 的暂停是图的通用能力(任何节点之前或之后都能停),OpenAI 的是工具的属性。

### 问题 4:状态存哪

`_put_checkpoint`(`_loop.py` 1237 行)在每个 super-step 结束时写一个 checkpoint,存到你传给 `compile(checkpointer=...)` 的那个对象里。实验里看到的 `get_state_history` 就是读它。内存版本是 `InMemorySaver`,生产要换成持久化的实现(仓库的 `libs/checkpoint-sqlite`、`libs/checkpoint-postgres`)。它存的是**图的状态**(channel 的值,加每个节点的待处理写入),不是「整个运行器的状态」:没有护栏结果、没有追踪。OpenAI 的 `RunState` 存的东西多得多,因为它管的事多。

## 三家放在一起

下面这张表里的每一格,都来自今天读到的源码和跑出来的结果,没有一格是凭记忆写的。我把 Day 520 自己的 `mini_harness.py` 也放进去当对照:

| 问题 | 我的 mini_harness | OpenAI Agents SDK 0.24.0 | Claude Agent SDK 0.2.174 | LangGraph 1.2.18 |
| --- | --- | --- | --- | --- |
| 循环在哪 | `_drive`(Python) | `run.py` 的 `AgentRunner._run_impl`,`while True`,细节拆在 `run_internal/` | **不在 Python 里**,在随包带的 285 MB Claude Code 进程里 | `pregel/main.py` 的 `while loop.tick()` |
| 你能改循环吗 | 能,就是你写的 | 部分:钩子、护栏、`error_handlers` | 基本不能:只有 `max_turns`、`max_budget_usd`、`task_budget` 三个旋钮 | 能:图就是你画的 |
| 步数上限 | `max_steps` | `max_turns`,默认 10,超了抛 `MaxTurnsExceeded` | `max_turns` | `recursion_limit`,数 **super-step**(模型 3 次约等于 6) |
| 工具抛异常 | 异常原文给模型(`InfraError` 除外) | **只给固定一句话**,原文不给;`failure_error_function` 可改 | CLI 里,**没实跑**;SDK 只能用 `PostToolUseFailure` 钩子旁观 | 参数校验错给模型;**工具内部异常原样抛**;`handle_tool_errors` 可改 |
| 权限和暂停 | `RefundPolicy` 三态,`needs_approval` 停下并存档 | 工具的 `needs_approval`(可传函数),`NextStepInterruption`,批准后 `Runner.run(agent, state)` | `can_use_tool` 回调(CLI 问、SDK 答);没找到存档入口,推断要等就得进程一直活着(没实跑) | `interrupt_before`/`interrupt_after`(节点级),`invoke(None, cfg)` 继续 |
| 状态存什么 | 5 个字段的 JSON | `RunState`:29 个字段、10.9 KB,带 schema 版本 1.21 | 会话转录由 CLI 写本地,`SessionStore` 可镜像到外部 | 每个 super-step 一个 checkpoint,存在你给的 checkpointer 里 |
| 钩子 | 5 个事件,只读 | `RunHooksBase` 7 个方法,只读 | `HookEvent` 10 个,可介入 | 回调和流式事件(今天没展开) |

读这张表我自己最有感触的是第一行:同样叫「Agent SDK」,一家把循环写在 Python 里让你读,一家把循环做成别人的二进制,一家根本不假设有 Agent 循环。**选哪个取决于你想对循环有多少控制权。** 想要现成的、在千万用户身上磨过的完整能力(文件、bash、压缩),又愿意接受循环是黑盒、依赖一个外部进程,选 Claude;要多 Agent 交接、护栏、会话管理这一整套并且愿意读一个 13 万行的库,选 OpenAI;要把确定性的工作流和 Agent 混在一张图里、要强控制,选 LangGraph。如果你的需求落在这三家的缝隙里(比如要平台级的统一权限和审计),就像明天以后要做的 AgentOps,那就自己写 harness,把这三家当参考。

## 读源码笔记,以及怎么验证它

读完要留下一份笔记,不然下个月就忘了。格式很简单,一行一个问题,五段:编号、问题、文件、符号、一句话结论。关键是**符号**那一段,不是行号:行号会随版本变,符号(函数名、类名、一段有辨识度的代码)基本稳定。

```text
# 编号 | 问题 | 文件(相对源码根) | 符号 | 一句话结论
OA-1 | 循环在哪 | openai-agents-python/src/agents/run.py | async def _run_impl | AgentRunner._run_impl 里一个 while True,每圈 current_turn += 1,超过 max_turns 抛 MaxTurnsExceeded
OA-2 | 工具抛异常 | openai-agents-python/src/agents/tool.py | def default_tool_error_function | 默认只给模型一句固定的话,异常原文不给;要给就传 failure_error_function
OA-3 | 怎么暂停 | openai-agents-python/src/agents/run_internal/run_steps.py | class NextStepInterruption | 一圈结束有四种下一步:final、handoff、run_again、interruption
OA-4 | 状态存哪 | openai-agents-python/src/agents/run_state.py | CURRENT_SCHEMA_VERSION | RunState 序列化成带版本号的 JSON,0.24.0 是 1.21
CA-1 | 循环在哪 | claude-agent-sdk-python/src/claude_agent_sdk/_internal/transport/subprocess_cli.py | class SubprocessCLITransport | 不在 Python 里:SDK 拉起打包的 claude 进程,用 stdin/stdout 的 JSON 行通信
CA-2 | 工具抛异常 | claude-agent-sdk-python/src/claude_agent_sdk/types.py | Literal["PostToolUseFailure"] | SDK 里没有处理逻辑,只能用 PostToolUseFailure 钩子旁观
CA-3 | 怎么暂停 | claude-agent-sdk-python/src/claude_agent_sdk/_internal/query.py | subtype == "can_use_tool" | CLI 发 control_request,SDK 调你的回调,回 allow 或 deny
CA-4 | 状态存哪 | claude-agent-sdk-python/src/claude_agent_sdk/types.py | class SessionStore(Protocol) | 默认由 CLI 写本地文件;SessionStore 是把转录镜像到外部存储的接口
LG-1 | 循环在哪 | langgraph/libs/langgraph/langgraph/pregel/main.py | while loop.tick(): | tick 找出这一步的节点,runner 并行跑,after_tick 合并写入并存 checkpoint
LG-2 | 工具抛异常 | langgraph/libs/prebuilt/langgraph/prebuilt/tool_node.py | def _default_handle_tool_errors | 默认只接住参数校验错误,其他异常原样往外抛
LG-3 | 怎么暂停 | langgraph/libs/langgraph/langgraph/pregel/_loop.py | self.status = "interrupt_before" | tick 在执行节点之前检查 interrupt_before,命中就抛 GraphInterrupt
LG-4 | 状态存哪 | langgraph/libs/langgraph/langgraph/pregel/_loop.py | def _put_checkpoint | 每个 super-step 结束写一个 checkpoint,存到你给的 checkpointer 里
```

笔记写完,用 `check_notes.py` 验:每一行的文件存在吗,符号在文件里找得到吗?

```python
# agent-zero-lab/part10/sources/check_notes.py
"""读源码笔记的「验尸官」:笔记里写的每个「文件 + 符号」,到源码目录里真的找得到吗?
笔记每行用 | 分成五段:编号 | 问题 | 文件(相对源码根) | 符号 | 一句话结论。
用法: uv run python -m part10.sources.check_notes <源码根目录> <笔记文件>"""
import sys
from pathlib import Path


def check(root: Path, notes: Path) -> int:
    bad = 0
    for raw in notes.read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.startswith("#"):
            continue
        parts = [p.strip() for p in raw.split("|")]
        if len(parts) != 5:
            print(f"格式不对(要 5 段,拿到 {len(parts)} 段):{raw[:50]}")
            bad += 1
            continue
        qid, _question, rel, symbol, claim = parts
        f = root / rel
        if not f.is_file():
            print(f"{qid:<6} 文件不存在  {rel}")
            bad += 1
            continue
        hit = next((i for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1) if symbol in line), None)
        if hit is None:
            print(f"{qid:<6} 文件里没有  {symbol!r}  ({rel})")
            bad += 1
        else:
            print(f"{qid:<6} ok  {rel}:{hit}  [{symbol}]  {claim}")
    return bad


if __name__ == "__main__":
    sys.exit(1 if check(Path(sys.argv[1]), Path(sys.argv[2])) else 0)
```

<div class="line-notes">

- `def check(root: Path, notes: Path) -> int:` 返回有问题的行数,0 表示全部通过。
- `if not raw.strip() or raw.startswith("#"):` 空行和注释行跳过,所以笔记里可以写 `#` 开头的说明。
- `parts = [p.strip() for p in raw.split("|")]` 按竖线拆成五段,每段去首尾空格。
- `if len(parts) != 5:` 格式不对(比如结论里不小心写了个竖线)就报格式错。
- `qid, _question, rel, symbol, claim = parts` 解包五段。下划线开头的变量表示「这个我用不上」。
- `if not f.is_file():` 文件不存在,多半是路径写错,或者那个版本把文件挪走了。
- `hit = next((i for i, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1) if symbol in line), None)` 找第一个包含符号的行,行号从 1 开始;`next(生成器, None)` 找不到返回 `None`。
- `sys.exit(1 if check(` 有问题就以非零状态退出,方便以后挂进 CI:升级依赖后重新检查笔记,引用失效就会红。

</div>

```bash
uv run python -m part10.sources.check_notes ../agent-zero-src part10/sources/notes_521.txt
```

真实输出(行号是我那个提交上的,你的会不一样):

```text
OA-1   ok  openai-agents-python/src/agents/run.py:629  [async def _run_impl]  AgentRunner._run_impl 里一个 while True,每圈 current_turn += 1,超过 max_turns 抛 MaxTurnsExceeded
OA-2   ok  openai-agents-python/src/agents/tool.py:1997  [def default_tool_error_function]  默认只给模型一句固定的话,异常原文不给;要给就传 failure_error_function
OA-3   ok  openai-agents-python/src/agents/run_internal/run_steps.py:179  [class NextStepInterruption]  一圈结束有四种下一步:final、handoff、run_again、interruption
OA-4   ok  openai-agents-python/src/agents/run_state.py:245  [CURRENT_SCHEMA_VERSION]  RunState 序列化成带版本号的 JSON,0.24.0 是 1.21
CA-1   ok  claude-agent-sdk-python/src/claude_agent_sdk/_internal/transport/subprocess_cli.py:224  [class SubprocessCLITransport]  不在 Python 里:SDK 拉起打包的 claude 进程,用 stdin/stdout 的 JSON 行通信
CA-2   ok  claude-agent-sdk-python/src/claude_agent_sdk/types.py:287  [Literal["PostToolUseFailure"]]  SDK 里没有处理逻辑,只能用 PostToolUseFailure 钩子旁观
CA-3   ok  claude-agent-sdk-python/src/claude_agent_sdk/_internal/query.py:586  [subtype == "can_use_tool"]  CLI 发 control_request,SDK 调你的回调,回 allow 或 deny
CA-4   ok  claude-agent-sdk-python/src/claude_agent_sdk/types.py:1964  [class SessionStore(Protocol)]  默认由 CLI 写本地文件;SessionStore 是把转录镜像到外部存储的接口
LG-1   ok  langgraph/libs/langgraph/langgraph/pregel/main.py:3055  [while loop.tick():]  tick 找出这一步的节点,runner 并行跑,after_tick 合并写入并存 checkpoint
LG-2   ok  langgraph/libs/prebuilt/langgraph/prebuilt/tool_node.py:391  [def _default_handle_tool_errors]  默认只接住参数校验错误,其他异常原样往外抛
LG-3   ok  langgraph/libs/langgraph/langgraph/pregel/_loop.py:680  [self.status = "interrupt_before"]  tick 在执行节点之前检查 interrupt_before,命中就抛 GraphInterrupt
LG-4   ok  langgraph/libs/langgraph/langgraph/pregel/_loop.py:1237  [def _put_checkpoint]  每个 super-step 结束写一个 checkpoint,存到你给的 checkpointer 里
```

12 条全部找到。`OA-1` 显示 629,是 `_run_impl` 的定义行,那个 `while True:` 在它下面 400 行左右(1032 行),所以笔记里的一句话结论补了这句。符号选在定义上而不是循环体上,是因为定义行更不容易随版本移动。

**为什么要这个检查?** 这三个库发版很勤:我写这篇时 Claude Agent SDK 是 0.2.174,main 比发布版还多一次提交;LangGraph 主包是 1.2.18,同一天(10-26)提交还在继续进 main。半年后你再看今天的笔记,多半已经隔了几十个版本。读源码得到的结论有保质期,脚本能把「该复查了」变成一个红灯。

## 动手练习

### 练习 1:数钩子

三家各有多少个钩子点?不要靠记忆,用 `ast` 数。OpenAI 数 `lifecycle.py` 里 `RunHooksBase` 的 `on_` 开头的方法,Claude 数 `types.py` 里 `HookEvent` 的成员。

<details><summary>参考答案</summary>

新建 `part10/sources/count_hooks.py`:

```python
# agent-zero-lab/part10/sources/count_hooks.py
"""练习 1:三家各有多少个「钩子点」?用 ast 数,不靠记忆。
用法: uv run python -m part10.sources.count_hooks <源码根目录>"""
import ast
import sys
from pathlib import Path

root = Path(sys.argv[1])

# OpenAI:RunHooksBase 类里以 on_ 开头的方法
tree = ast.parse((root / "openai-agents-python/src/agents/lifecycle.py").read_text(encoding="utf-8"))
cls = next(n for n in ast.walk(tree) if isinstance(n, ast.ClassDef) and n.name == "RunHooksBase")
oai = [n.name for n in cls.body if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef)) and n.name.startswith("on_")]
print(f"OpenAI Agents SDK  RunHooksBase 方法 {len(oai)} 个:", ", ".join(oai))

# Claude:types.py 里 HookEvent = ( Literal[...] | Literal[...] ... ) 的成员
tree = ast.parse((root / "claude-agent-sdk-python/src/claude_agent_sdk/types.py").read_text(encoding="utf-8"))
assign = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "HookEvent" for t in n.targets))
names = [n.slice.value for n in ast.walk(assign.value) if isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Constant)]
print(f"Claude Agent SDK   HookEvent {len(names)} 个:", ", ".join(str(x) for x in names))
```

<div class="line-notes">

- `tree = ast.parse((root / "openai-agents-python/src/agents/lifecycle.py").read_text(encoding="utf-8"))` `ast.parse` 把源码解析成语法树,不执行它。读别人的代码时,用 `ast` 比正则可靠得多,因为它认得语法。
- `cls = next(n for n in ast.walk(tree) if isinstance(n, ast.ClassDef) and n.name == "RunHooksBase")` 遍历整棵树,找到名字叫 `RunHooksBase` 的类定义。`ast.walk` 会逐个走到所有节点。
- `oai = [n.name for n in cls.body if isinstance(n, (ast.AsyncFunctionDef, ast.FunctionDef)) and n.name.startswith("on_")]` 类体里的函数定义,名字以 `on_` 开头的。
- `assign = next(n for n in tree.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "HookEvent" for t in n.targets))` 找到顶层那条 `HookEvent = (...)` 赋值语句。
- `names = [n.slice.value for n in ast.walk(assign.value) if isinstance(n, ast.Subscript) and isinstance(n.slice, ast.Constant)]` `Literal["PreToolUse"]` 在语法树里是一个下标表达式,方括号里的常量就是事件名。

</div>

```bash
uv run python -m part10.sources.count_hooks ../agent-zero-src
```

```text
OpenAI Agents SDK  RunHooksBase 方法 7 个: on_llm_start, on_llm_end, on_agent_start, on_agent_end, on_handoff, on_tool_start, on_tool_end
Claude Agent SDK   HookEvent 10 个: PermissionRequest, SubagentStart, Notification, PreCompact, SubagentStop, Stop, UserPromptSubmit, PostToolUseFailure, PreToolUse, PostToolUse
```

OpenAI 7 个,Claude 10 个。差别不只是数量:Claude 多出来的 `PreCompact`、`SubagentStart`、`SubagentStop`、`PermissionRequest`、`Notification`、`UserPromptSubmit`、`Stop` 反映的是 Claude Code 作为一个交互式长会话产品的需要;OpenAI 的 7 个围绕「一次运行」的 LLM 调用、Agent 切换、工具调用。LangGraph 没有等价的「钩子清单」,它走的是 LangChain 的 callbacks 机制和流式事件,所以这个脚本里没数它。

</details>

### 练习 2:预测再验证 recursion_limit

`lg_interrupt.py` 里 `recursion_limit=6` 时模型被调用 3 次。预测 `recursion_limit=10` 时模型被调用几次,再用同一个「永远调工具」的剧本跑一遍验证。

<details><summary>参考答案</summary>

预测:模型一步,工具一步,交替。10 步就是 5 次模型加 5 次工具,所以模型被调用 5 次。验证:

```python
import json
from typing import Any

from langgraph.errors import GraphRecursionError

from part10.harness.fake import Reply, Scripted, call
from part10.sources.lg_agent import build

for lim in (6, 10):
    f = Scripted([Reply(call("list_invoices", json.dumps({"customer_id": "C007"}), "x"))])
    cfg: Any = {"configurable": {"thread_id": f"l{lim}"}, "recursion_limit": lim}
    try:
        build(f).invoke({"messages": [{"role": "user", "content": "q"}]}, cfg)
    except GraphRecursionError:
        pass
    print(lim, f.n)
```

<div class="line-notes">

- `for lim in (6, 10):` 两个上限各跑一次。
- `Scripted([Reply(call(` 每次都建一个新的剧本模型,计数从 0 开始。
- `"thread_id": f"l{lim}"` 每次用不同的会话 id,否则第二次会接着第一次的 checkpoint 跑。
- `except GraphRecursionError:` 预期会超限,所以接住它。
- `print(lim, f.n)` `f.n` 是模型被调用的次数。

</div>

实测输出:

```text
6 3
10 5
```

6 对 3,10 对 5,和预测一致:模型被调用次数是 `recursion_limit` 的一半。所以如果你希望「最多让模型想 8 次」,`recursion_limit` 要设成 16 左右(一次模型加一次工具),还要留出最后那一步回答的余量。

</details>

### 练习 3:回答面试题,用今天的证据(开放题)

题目:「你们公司要做一个 Agent 平台,让五个业务团队接入。OpenAI Agents SDK、Claude Agent SDK、LangGraph 你选哪个?」用上面那张表写一份 5 到 8 句话的回答,每个论点都必须带今天的一个证据(文件、数字或实验结果)。

<details><summary>参考答案</summary>

一个示范回答:

「我会先问平台需要对循环有多少控制权。Claude Agent SDK 的 Python 包只有 1.35 万行,循环在随包带的 285 MB 进程里,`ClaudeAgentOptions` 里讲『循环』的字段只有 `max_turns`、`max_budget_usd`、`task_budget` 三个。平台要做统一的预算、审计和按租户的权限,控制面都在循环里,拿不到,所以不把它当平台的核心,但可以让它做被平台管起来的一类 worker。OpenAI Agents SDK 的循环在 Python 里(`run.py` 的 `_run_impl`),`NextStep` 只有四种,权限是工具属性 `needs_approval`,暂停状态是带版本号的 `RunState`,这几样都是平台要的;代价是 13 万行,而且默认把工具异常隐藏,要平台统一设 `failure_error_function`。LangGraph 的暂停和 checkpoint 是图的通用能力,但步数上限数的是 super-step,团队很容易设错一半。我的选择是:平台自己写一层薄 harness,统一权限、预算、审计和存档,把这三家当可插拔的执行后端,并且把『哪些默认行为被平台覆盖了』写成一份清单,每次升级依赖用 `check_notes.py` 式的检查复查。」

这段回答里每个论点的证据:1.35 万行(`src_map`)、三个旋钮(`claude_options_by_layer`)、四种 `NextStep`(`run_steps.py`)、`needs_approval`、`RunState`(`oai_approval`)、默认隐藏异常(`oai_tool_error`)、super-step(`lg_interrupt`)。

</details>

**验收标准**:本机有三份源码和对应的安装包;`part10/sources/` 下的脚本都能跑,并且你能说出每个结果说明了什么;你写了一份自己的笔记,`check_notes.py` 全部通过;你能不看文章说出「工具抛异常」在三家各自的默认行为;你能解释为什么 Claude 的 Python 包这么小。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 浅克隆 | `git clone --depth 1`,只下最新一次提交,不下历史。读源码时够用,下载小得多 |
| sdist | Python 包的源码发布形式,从 PyPI 下载解开就是源码。GitHub 打不开时的备选 |
| `NextStep` | OpenAI Agents SDK 里一圈结束后的四种去向:最终输出、交接、再来一圈、中断 |
| handoff | 一个 Agent 把对话交给另一个 Agent 继续(OpenAI 的一等公民概念) |
| `RunState` | OpenAI 暂停时的可序列化状态,带 schema 版本号 |
| `needs_approval` | OpenAI 工具上的声明:调用前需要人批准,可以传函数按参数决定 |
| `failure_error_function` | OpenAI 里自定义「工具抛异常时模型看到什么」的函数 |
| control protocol | Claude Agent SDK 和随包的 CLI 之间用 JSON 行通信的协议,`can_use_tool`、`hook_callback` 都是它的请求类型 |
| `can_use_tool` | Claude 的权限回调:CLI 每次要调工具前问你,你回 allow 或 deny |
| `Transport` | Claude Agent SDK 里和 CLI 通信的抽象层;换成自己的实现就能不启动真进程 |
| Pregel | LangGraph 运行时的名字,源自 Google 的图计算模型,按「步」推进 |
| super-step | Pregel 里的一「步」:一批节点并行运行,写入在步末才合并。LangGraph 的上限、checkpoint、中断都按它计数 |
| reducer | 状态字段的合并规则。`Annotated[list, operator.add]` 表示新值追加到旧值后面 |
| checkpoint | 每个 super-step 结束时保存的状态快照,用于恢复和回放 |
| `thread_id` | LangGraph 里一个会话的标识,checkpoint 按它分组 |

## 常见误区

**从第一行读到最后一行。** 13 万行读不完,也没意义。先数行数找大头,再用问题里的词搜。今天的四个问题,每个都是十分钟内的事。

**只读不跑。** `default_tool_error_function` 我读到的时候觉得懂了,跑了实验才看到模型会把同样的错参数原样重发一遍。同样,`recursion_limit=6` 只给 3 次模型调用,是跑出来才发现的,代码里没有一句话告诉你。

**把「Agent SDK」当成同一类东西。** 三家的架构完全不同:一家循环在你能读的 Python 里,一家在别人的二进制里,一家是通用图引擎。对比的时候先问「循环在哪、你能改多少」,再比功能。

**拿行号当引用。** 行号一升级就变。笔记里写符号,行号只当临时的辅助,并且跑检查脚本。

**以为 `interrupt_before` 等于「批准」。** LangGraph 的暂停只是停,继续只是 `invoke(None, cfg)`,没有批准或拒绝的概念,条件判断和决定记录得你自己写。OpenAI 的 `needs_approval` 是直接带批准和拒绝语义的。

**把 `setting_sources` 的默认值当成安全的。** Claude Agent SDK 默认加载这台机器上的用户级设置。平台里要显式传 `[]`。

## 学习资料

### 文档与文章

- [OpenAI Agents SDK 文档:Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/):今天的暂停恢复流程,最后「Long-running approvals」一节讲了状态不验证真伪的安全问题。
- [OpenAI Agents SDK 文档:Running agents](https://openai.github.io/openai-agents-python/running_agents/):循环和 `max_turns`、`error_handlers`。
- [Claude Agent SDK 文档](https://platform.claude.com/docs/en/agent-sdk/overview):配合读 `types.py`,看每个配置项的说明。
- [LangGraph 持久化文档](https://docs.langchain.com/oss/python/langgraph/persistence):checkpoint 和 thread,配合 `_loop.py` 的 `_put_checkpoint` 读。
- [LangGraph 中断文档](https://docs.langchain.com/oss/python/langgraph/interrupts):`interrupt_before` 之外还有函数式的 `interrupt()`,条件暂停用它。
- [LangGraph Pregel 文档](https://docs.langchain.com/oss/python/langgraph/pregel):super-step 的官方说明。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ccMm64ELW&autoplay=0&high_quality=1" title="05.LangGraph 底层引擎 Pregel 全解:一张图到底是怎么被跑起来的" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>是的iamrio · 05.LangGraph 底层引擎 Pregel 全解:一张图到底是怎么被跑起来的 · 约 11 分钟,2026 年 8 月的视频。讲 super-step 和 channel,看完再回头读 `_loop.py` 的 `tick` 会轻松很多。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1FPArzkEaH&autoplay=0&high_quality=1" title="基于 Claude Agent SDK 打造 Agent 平台| Agent 平台化 上集|录屏精简版" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Koala聊开源 · 基于 Claude Agent SDK 打造 Agent 平台 · 约 8 分钟,看一个团队在循环是黑盒的前提下怎么做平台化。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/TqC1qOfiVcQ" title="Claude Agent SDK [Full Workshop] — Thariq Shihipar, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Claude Agent SDK [Full Workshop] — Thariq Shihipar, Anthropic · 讲 SDK 的设计理念,可以对照今天看到的「循环在 CLI 里」。</figcaption>
</figure>

### 书籍

- Michael Feathers《Working Effectively with Legacy Code》(Prentice Hall,2004),中文版《修改代码的艺术》(人民邮电出版社):不讲 Agent,讲怎么在看不懂的代码里找切入点、怎么用实验(特征测试)搞清楚它到底做什么。今天「读了再跑一遍」的习惯和它一脉相承。
- Chip Huyen《AI Engineering》(O'Reilly,2025):第 6 章的 Agent 部分,看它怎么谈工具和失败模式,对照今天三家的默认行为。

### 开源项目与代码

- [openai/openai-agents-python](https://github.com/openai/openai-agents-python):`src/agents/run.py`、`run_internal/run_steps.py`、`run_state.py`、`lifecycle.py`。
- [anthropics/claude-agent-sdk-python](https://github.com/anthropics/claude-agent-sdk-python):`types.py` 的 `ClaudeAgentOptions` 和 `HookEvent`,`_internal/query.py` 的 `_handle_control_request`。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):`libs/langgraph/langgraph/pregel/_loop.py` 的 `tick` 和 `after_tick`,`libs/prebuilt/langgraph/prebuilt/tool_node.py`。

## 自测

1. 读一个十几万行的陌生仓库,你的第一步是什么?为什么?

<details><summary>答案</summary>

先定问题,再数行数找大头(今天的 `src_map.py`),然后用问题里的关键词搜。不从头读,因为 OpenAI Agents SDK 一个包就有 13.4 万行。大头的分布本身有信息:LangGraph 一半多在 `pregel/`,Claude 的 Python 包总共才 1.35 万行,说明它的重量不在这里。

</details>

2. 同一个抛 `ValueError` 的工具,在 OpenAI Agents SDK、LangGraph `ToolNode` 默认设置下,模型分别会看到什么?

<details><summary>答案</summary>

OpenAI:固定一句 `An error occurred while running the tool. Please try again.`,异常原文不给,模型会把同样的参数重发。LangGraph:`ValueError` 原样往外抛,整个图运行失败(只有参数校验错误会变成消息给模型;设 `handle_tool_errors=True` 才会把异常变成消息)。Claude 的默认行为在闭源的 CLI 里,我没实跑,不下结论。

</details>

3. Claude Agent SDK 的 Python 包只有 1.35 万行,为什么?这对做平台意味着什么?

<details><summary>答案</summary>

循环不在 Python 里,SDK 启动随包带的 Claude Code 进程(285 MB 的二进制),用 JSON 行协议通信,Python 层是协议客户端。对平台意味着:循环是黑盒,能调的只有 `max_turns`、`max_budget_usd`、`task_budget` 等几个旋钮;依赖一个外部进程;默认还会加载本机的用户设置,所以要传 `setting_sources=[]` 隔离。

</details>

4. LangGraph 里 `recursion_limit=10` 时,模型最多被调用几次?为什么?

<details><summary>答案</summary>

5 次。上限数的是 super-step,模型节点一步、工具节点一步,交替进行,10 步是 5 次模型加 5 次工具。实测 `recursion_limit=6` 是 3 次,`10` 是 5 次。

</details>

5. 面试题:你的 Agent 暂停等待人工审批,审批要等两天。OpenAI Agents SDK、Claude Agent SDK、LangGraph 在这件事上各有什么不同?你的状态文件有什么安全要求?

<details><summary>答案</summary>

OpenAI:运行暂停并返回 `interruptions`,把 `RunState` 序列化成 JSON 存起来,两天后读回来 `approve` 再 `Runner.run(agent, state)`,进程不用活着。LangGraph:`interrupt_before` 暂停,checkpoint 已经存在 checkpointer 里,要用持久化的 checkpointer(内存版进程退出就没了),两天后用同一个 `thread_id` `invoke(None, cfg)`,但「批准」要自己建模。Claude:`can_use_tool` 回调是 CLI 在等你,我没找到「存档后以后再批」的入口,推断是只能让回调自己等、进程一直活着(没实跑),或者靠 `resume` 恢复会话后重新触发。状态文件的安全要求:里面有待执行的工具调用和批准记录,谁能改谁就能替人批准,OpenAI 官方文档明说它不验证快照真伪;要存在服务端自己控制的存储里,不让客户端带着状态跑,恢复时用 `get_interruptions()` 取待批项而不是信客户端传来的内容。

</details>

6. `check_notes.py` 为什么按符号找,不按行号?它能防住什么?

<details><summary>答案</summary>

行号随版本变,符号(定义名、一段稳定的代码)基本不变。脚本能在升级依赖或换提交后,自动发现笔记里哪些「文件加符号」引用失效,把「读源码的结论该复查了」变成一个失败的检查,而不是半年后才发现笔记已经和代码对不上。

</details>

## 明天预告

明天是 Day 522,Harness(三):Anthropic 的长任务 harness 和 harness engineering。今天看的三家都是「一次运行」的 harness:循环、工具、暂停、存档。但真实的长任务是跨很多个上下文窗口的,一个 Agent 干几个小时,中间上下文满了、换了一个新会话继续。明天读 Anthropic 那篇讲规划者、生成者、评估者三个角色的文章,和 OpenAI 的 harness engineering,看 harness 在「任务比窗口长」的时候要多出哪些东西。
