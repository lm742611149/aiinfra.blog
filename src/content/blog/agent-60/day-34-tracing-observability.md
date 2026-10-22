---
title: 'Day 34 · Tracing 与可观测:Langfuse 接入,每一步都看得见'
description: '把 W4 的工单 Agent 接进 Langfuse,让每次运行变成一棵能点开的 trace 树,按客户和会话归类,把评测分数和用户反馈写回 trace;再用 OpenTelemetry 按 GenAI 语义约定手动打 span(工作流、模型调用、工具调用),把 token 用量做成指标,同时导出到 Langfuse 和 Jaeger。'
pubDate: 2026-10-12
regime: none
tags: ['observability', 'tracing', 'langfuse', 'opentelemetry', 'agent-60']
series: 'agent-60'
day: 34
lang: 'zh'
---

## 今天要解决的问题

这几天你一直在看 `results.jsonl` 里的 transcript。一条 trace 挤在一行 JSON 里,工具返回值是转义过的字符串,想知道「这一步花了多久」「这次模型调用用了多少 token」得自己算。离线评测时忍一忍还行,上线以后,每天几千张工单,你不可能这样看。

可观测性(observability)要解决的就是这个:系统在线上跑的时候,你能随时看清它每一次运行内部发生了什么,哪一步慢、哪一步错、钱花在哪。对 Agent 来说,核心工具是 tracing(链路追踪)。

今天分两半。前一半用 Langfuse,半小时内让 W4 的 Agent 每次运行都变成一棵能点开的树;后一半自己动手用 OpenTelemetry 打 span。为什么要两样都学?因为面试和工作里会同时遇到。我们开课前统计的 305 条 JD 里,国内 33%、海外 31% 提到可观测或 tracing;其中有几条(一个 AI 平台 DevOps 岗、腾讯的可观测岗、一个大型游戏公司的 Agent 岗)直接点名要求「用 OpenTelemetry 覆盖 API、AI 工作流、模型请求和工具调用」「监控 token 用量」。只会点 Langfuse 的按钮,遇到这种岗位就不够了。

学完今天你应该能:

1. 讲清 trace、span、generation、session、score 这几个概念,以及它们在一次工单处理里各对应什么。
2. 把 W4 的 Agent 接入 Langfuse,按客户和会话归类,在界面上找到最慢、最贵的那一步。
3. 把 Day 29–33 的评测分数和用户反馈写回对应的 trace。
4. 说出 OpenTelemetry GenAI 语义约定里最常用的 span 名称和属性。
5. 手写三种 span(工作流、模型调用、工具调用)和两个 token 指标,同时导出到 Langfuse 和 Jaeger。

预计用时 5–6 小时。前置:Day 28 的 Agent;Day 29 的 adapter 和 `run_eval.py`;本机能跑 Docker(只有 Jaeger 那部分需要)。

## 先把概念对齐

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="一次工单处理的 trace 树:根 span 是工作流,下面有分类、检索、模型调用和工具调用等子 span">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="11">
<text x="16" y="22" fill="var(--ink-soft)">trace 7f3a… · session = 会话 · user = C023</text>
<text x="470" y="22" fill="var(--ink-faint)">时间 →</text>
<rect x="16" y="34" width="600" height="22" fill="none" stroke="var(--ink-soft)"/>
<text x="22" y="49" fill="var(--ink)">invoke_workflow ticket_router            8.4s</text>
<rect x="40" y="62" width="90" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="44" y="76" fill="var(--ink)">chat 分类 0.9s</text>
<rect x="134" y="88" width="70" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="138" y="102" fill="var(--ink)">retrieval</text>
<rect x="208" y="114" width="150" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="212" y="128" fill="var(--ink)">chat 规划 2.1s · 3.2k tok</text>
<rect x="362" y="140" width="80" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="366" y="154" fill="var(--ink)">execute_tool</text>
<text x="446" y="154" fill="var(--ink-soft)">get_subscription</text>
<rect x="362" y="166" width="70" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="366" y="180" fill="var(--ink)">execute_tool</text>
<text x="436" y="180" fill="var(--ink-soft)">list_invoices</text>
<rect x="436" y="192" width="120" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="440" y="206" fill="var(--ink)">chat 起草 2.6s</text>
<rect x="560" y="218" width="56" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="563" y="232" fill="var(--ink)">refund</text>
<text x="16" y="266" fill="var(--ink-soft)">蓝 = 模型调用(generation,有 token 和费用)  琥珀 = 工具/检索(span)</text>
<text x="16" y="286" fill="var(--ink-soft)">评测分数、用户点赞点踩作为 score 挂在整棵树或某个节点上</text>
</g>
</svg>
<figcaption>一张工单的 trace 树(示意数据)。横向是时间,一眼能看出最慢的是两次「规划」和「起草」模型调用。</figcaption>
</figure>

trace(链路):一次完整的处理过程,比如处理一张工单。它有一个唯一的 trace ID。

span(跨度):trace 里的一个步骤,有开始时间、结束时间、父子关系和一堆属性。一次模型调用是一个 span,一次工具调用是一个 span,整个工作流本身也是一个 span(根)。span 嵌套起来就是上图那棵树。写过后端、用过 SkyWalking 或 Jaeger 的人对这个很熟,概念完全一样。

generation:Langfuse 的叫法,指「模型调用」这种特殊的 span,它额外带着模型名、输入输出、token 用量和费用。OpenTelemetry 的语义约定里没有单独的类型,而是用 `gen_ai.operation.name = chat` 这样的属性来表示。

session(会话):多个 trace 的集合。同一个客户的多轮对话,每一轮是一个 trace,它们属于同一个 session。对应我们 LangGraph 里的 `thread_id`。

score(分数):挂在 trace 或某个 span 上的评价。可以来自离线评测(Day 29–33 的 grader),来自线上的 LLM 评分器,也可以来自用户点赞点踩。

还有一个容易被忽略的概念:**user(用户)**。把客户编号作为 user_id 挂上去,你就能回答「C023 这个客户这个月花了公司多少钱」「哪些客户反复来问同一个问题」。

## 选 Langfuse,以及云版还是自托管

为什么这门课用 Langfuse?它开源(MIT 协议核心)、能自托管、对 LangChain/LangGraph 和 OpenAI SDK 都有现成集成,而且从 v3 开始整个 SDK 就是建立在 OpenTelemetry 之上的,这意味着今天后半段我们自己打的 OTel span 能直接进它的界面。对比一下几个常见选项:

| 工具 | 开源/自托管 | 特点 | 适合 |
| --- | --- | --- | --- |
| Langfuse | 是 | tracing + 评测 + prompt 管理,OTel 原生 | 想自托管、数据不出境的团队 |
| LangSmith | 否(有企业自托管版) | 和 LangChain 生态结合最紧 | 重度用 LangChain 的团队 |
| Arize Phoenix | 是 | 基于 OpenInference/OTel,偏评测和分析 | 想本地起一个轻量 UI |
| Jaeger / Tempo | 是 | 通用分布式追踪,不懂 token 和费用 | 已有 OTel 基础设施,要和后端服务串起来 |

云版还是自托管? Langfuse 自托管 v4 的 docker compose 会起六个容器:web、worker、Postgres、ClickHouse、Redis、MinIO。官方建议的机器配置不低,在一台 8 GB 内存的笔记本上跑起来会很吃力。学习阶段我建议直接用云版的免费档(Hobby):2026 年 10 月查到的额度是每月 5 万个 unit、数据保留 30 天、最多 2 个用户。unit 的算法是 trace、observation(span)、score 的数量之和。

算一下够不够用:一张工单大约 1 个 trace + 8 个 observation(3 次模型调用、3–4 次工具调用、1 次检索、1 个根 span),再加 2–3 个 score,约 12 个 unit。5 万 ÷ 12 ≈ 4,000 张工单一个月。你这一周做评测,70 条用例 × 3 次 trial × 几轮迭代,一两千张工单,够了。如果你的数据不能出境,或者要在公司环境里用,那就自托管;Day 41 讲部署时会给出完整的 compose。

注册 [Langfuse Cloud](https://langfuse.com/docs/observability/get-started) 后建一个项目,拿到 public key 和 secret key。云版有欧盟、美国、日本几个区域,域名不同,选离你近的。

## 第一部分:半小时接入 Langfuse

### 1. 环境变量

```bash
# agent-60-lab/.env 追加
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com   # 欧盟区;美国区是 https://us.cloud.langfuse.com
```

```bash
uv add langfuse
```

注意:老教程里写的是 `LANGFUSE_HOST`,现在的 SDK(2026 年 10 月 PyPI 上最新是 5.0.4,v4 起就这样)把它标成了已废弃,改用 `LANGFUSE_BASE_URL`。旧变量名目前还能用,但别再往新项目里写。这类「教程里的写法过时了」的问题在 Agent 生态里非常常见,遇到报错先看你装的版本号,再去官方文档对一下。

### 2. LangGraph 一行接入

LangGraph 基于 LangChain 的回调机制,Langfuse 提供了一个回调处理器,传进 `config` 就行。在 Day 29 的 adapter 里,`run_case` 本来就留了 `callbacks` 参数:

```python
# agent-60-lab/w5/traced_run.py
"""带 Langfuse tracing 跑一张工单。用法: uv run python -m w5.traced_run"""
from __future__ import annotations

from dotenv import load_dotenv
from langfuse import get_client, propagate_attributes
from langfuse.langchain import CallbackHandler

from w5.adapter import run_case

load_dotenv()
langfuse = get_client()


def traced_case(case: dict, run_tag: str = "dev") -> tuple:
    handler = CallbackHandler()
    # user_id / session_id / tags 会挂到这次运行产生的所有 span 上,越早设越好
    with propagate_attributes(user_id=case.get("customer_id") or "anonymous",
                              session_id=f"{run_tag}-{case['id']}",
                              tags=["w5", run_tag],
                              metadata={"case_id": case["id"]}):
        run = run_case(case["id"], case["ticket"], case.get("customer_id"), callbacks=[handler])
    return run, handler.last_trace_id


if __name__ == "__main__":
    case = {"id": "smoke-02", "customer_id": "C023",
            "ticket": "我们公司年付的企业版,下个月起不用了。请帮我们取消,剩余月份的钱按规定退回来。"}
    run, trace_id = traced_case(case)
    print(run.category, run.pending_approval, trace_id)
    print(langfuse.get_trace_url(trace_id=trace_id))
    langfuse.flush()   # 脚本马上退出,不 flush 的话后台还没发出去的数据会丢
```

<div class="line-notes">

- `from langfuse import get_client, propagate_attributes` `get_client()` 拿进程里唯一的 Langfuse 客户端(单例),`propagate_attributes` 用来给这次运行的所有 span 挂上 user_id、session_id。
- `from langfuse.langchain import CallbackHandler` LangChain 回调处理器。LangGraph 每个节点、每次模型调用都会触发回调,它把这些回调翻译成 Langfuse 的 span。
- `load_dotenv()` 必须在 `get_client()` 之前:客户端构造时读 `LANGFUSE_PUBLIC_KEY` 等环境变量。
- `langfuse = get_client()` 没配 key 时不会报错,只会打一行 `Authentication error: Langfuse client initialized without public_key. Client will be disabled.`,然后整个客户端变成空操作。我实跑时没有 Langfuse 账号,就是这个状态(下面的 trace 数据都是在这种状态下拿的,界面部分未实跑)。
- `def traced_case(case: dict, run_tag: str = "dev") -> tuple:` 返回 `(AgentRun, trace_id)`。`run_tag` 用来区分是 dev 集、回归集还是线上。
- `handler = CallbackHandler()` 每条用例新建一个,`last_trace_id` 才不会串到上一条。
- `with propagate_attributes(user_id=case.get("customer_id") or "anonymous",` 代入 smoke-02:`user_id="C023"`。没有客户编号就记 `anonymous`,不要留空,否则按用户筛选时这批 trace 找不到。
- `session_id=f"{run_tag}-{case['id']}",` 代入得 `dev-smoke-02`。同一个 session 的多个 trace 在界面上会排在一起。
- `tags=["w5", run_tag],` 标签是列表,筛选用。
- `metadata={"case_id": case["id"]}):` 任意键值,点开 trace 能看到。
- `run = run_case(case["id"], case["ticket"], case.get("customer_id"), callbacks=[handler])` 复用 Day 29 的 `run_case`,只多传一个回调。实测 smoke-02(C023 企业版年付,想退剩余月份):`category='refund'`,工具 `['find_customer', 'get_subscription', 'list_invoices', 'search_kb', 'create_refund_request']`,输入 7815、输出 435 token(Day 29 的 adapter 用 `UsageMetadataCallbackHandler` 统计,含 classify 那次),耗时 9.2 秒,停在审批上(`pending_approval=True`)。退款参数是 `INV-2026-0091`、6578 元,理由里写着「当前周期 2026-10-09 至 2027-10-09,已使用当月不退,剩余 11 个整月,598 × 11 = 6578 元」,和 Day 31 判题器一致。
- `return run, handler.last_trace_id` 回调处理器记着刚才那次运行的 trace_id。没配 key 时实测是 32 个 0:`'00000000000000000000000000000000'`。
- `case = {"id": "smoke-02", "customer_id": "C023",` 冒烟用例,和 Day 29 的 smoke-02 一样。C023 是企业版年付 2 席位(种子 42 的真实数据)。
- `print(langfuse.get_trace_url(trace_id=trace_id))` 拼出界面上的 trace 链接。要先查项目 id,所以没配 key 时这一行直接抛 `AttributeError: Langfuse client is not initialized`。看到这个报错先检查 `.env`。
- `langfuse.flush()` 把后台队列里还没发出去的数据立刻发完。原因见代码下面的正文。

</div>

最后那行 `flush()` 很重要。Langfuse SDK 是在后台线程批量发送数据的,短脚本跑完就退出,不 flush 的话你会发现界面上什么都没有,然后开始怀疑 key 配错了。我第一次就在这里浪费了二十分钟。长期运行的服务(比如 Day 36 的 FastAPI)不用每次 flush,在进程退出时调一次 `shutdown()` 即可。

`propagate_attributes` 是 v4 SDK 设置 trace 级属性的推荐方式。它是一个上下文管理器,在它里面创建的所有 span 都会带上这些属性。文档里专门强调要「尽早调用」:在它之前就已经创建的 span 不会被补上,统计「C023 花了多少钱」时就会漏掉。

跑一下,打开打印出来的链接。你会看到一棵树:LangGraph 的每个节点是一个 span,模型调用是 generation(带 token 和估算费用),工具调用也在里面。点开任何一个节点能看到完整的输入输出。

如果费用一栏是空的,那是因为 Langfuse 不认识你的模型名(比如国内厂商的某些模型)。在项目设置的 Models 页面里可以自己添加模型名和单价,价格以厂商官网为准。

### 3. 不用 LangChain 的代码怎么接

评分器(Day 32)和用户模拟器(Day 33)是直接用 `openai` SDK 写的,没有 LangChain 回调。Langfuse 提供了一个替换品,改一行 import 就行:

```python
# 原来: from openai import OpenAI
from langfuse.openai import OpenAI   # 用法完全一样,但每次调用自动记录为 generation
```

自己写的普通函数,用 `@observe` 装饰器:

```python
from langfuse import observe


@observe(as_type="evaluator")
def judge_facts(ticket: str, reply: str, facts: list[str]):
    ...
```

<div class="line-notes">

- `from langfuse import observe` 装饰器,给普通函数套一个 span,函数的参数和返回值会作为输入输出记录下来。
- `@observe(as_type="evaluator")` 实测 5.0.4 里 `as_type` 能取的值是 `generation`、`embedding`、`span`、`agent`、`tool`、`chain`、`retriever`、`evaluator`、`guardrail`。不写就是普通 `span`。
- `def judge_facts(ticket: str, reply: str, facts: list[str]):` 函数体不用改。注意参数会被原样记录,工单原文里有手机号的话也会进 Langfuse,隐私处理见文末。

</div>

`as_type` 可以是 `span`、`generation`、`tool`、`retriever`、`evaluator`、`agent` 等,Langfuse 界面会用不同图标显示,筛选时也方便。

### 4. 把评测分数写回 trace

这是把 W5 前几天的工作串起来的一步。Day 29 的 `run_eval.py` 每跑一条用例会得到一堆 grader 结果,把它们作为 score 写回对应的 trace:

```python
# agent-60-lab/w5/run_eval.py 中,每条用例跑完之后
from langfuse import get_client

langfuse = get_client()


def push_scores(trace_id: str, graders: dict[str, bool], dataset_version: str) -> None:
    for name, ok in graders.items():
        langfuse.create_score(trace_id=trace_id, name=name, value=1 if ok else 0,
                              data_type="BOOLEAN", metadata={"dataset": dataset_version})
```

<div class="line-notes">

- `from langfuse import get_client` 和 `traced_run.py` 拿到的是同一个客户端单例。
- `def push_scores(trace_id: str, graders: dict[str, bool], dataset_version: str) -> None:` `graders` 就是 `check()` 返回的结果字典,比如 Day 33 那张 C007 工单的 `{"traj:order": True, "traj:scope": True, ...}`。
- `for name, ok in graders.items():` 每个 grader 写成一个独立的 score,名字沿用 `traj:scope` 这种 key,界面上按名字筛。
- `langfuse.create_score(trace_id=trace_id, name=name, value=1 if ok else 0,` 布尔值转成 1/0。实测 5.0.4 的签名里 `value` 是 `float | str`,不收 bool。
- `data_type="BOOLEAN", metadata={"dataset": dataset_version})` `data_type` 可选值实测是 `NUMERIC / CATEGORICAL / BOOLEAN / TEXT / CORRECTION`。`metadata` 记数据集版本,换了测试集后两次的分数不能直接比,靠它区分。没有 Langfuse 账号,这一段未实跑。

</div>

`run_case` 换成上面的 `traced_case`,拿到 `trace_id` 后调 `push_scores`。跑完一轮评测,在 Langfuse 里按 score 筛选「`traj:scope` = 0」,就能直接点进所有越权的 trace,比在 JSONL 里搜方便太多了。Langfuse 也有自己的数据集和实验功能(`run_experiment`),可以把测试集上传上去、在界面上对比两次实验,这和我们自己写的 `run_eval.py` 做的是同一件事。我的建议是评测逻辑先留在自己的代码里(它要进 CI,Day 35),Langfuse 用来看和分享。

### 5. 线上反馈

上线以后,最有价值的信号是用户自己给的。客服回复下面放一个「有帮助 / 没帮助」,把结果写成 score:

```python
def record_feedback(trace_id: str, helpful: bool, comment: str = "") -> None:
    langfuse.create_score(trace_id=trace_id, name="user_feedback", value=1 if helpful else 0,
                          data_type="BOOLEAN", comment=comment or None)
```

这要求前端拿得到 trace_id,所以 Day 36 写 API 时,响应里要把 trace_id 带回去。点踩的 trace 就是下一轮错误分析(Day 30)最该优先读的那批。

## 第二部分:自己用 OpenTelemetry 打 span

Langfuse 帮你做了很多事。现在我们把它拆开,看看底下到底是什么。

### 为什么还要学 OTel

三个实际的原因。第一,你的 Agent 不会孤立存在。Day 36 它会变成一个 FastAPI 服务,前面可能还有 Java 或 Go 写的网关、业务系统。公司的后端服务大概率已经用 OpenTelemetry 接了 Jaeger、Tempo 或者某个商业 APM。你希望一张工单从网关进来、经过 Agent、调到业务系统的整条链路在一个 trace 里,而不是 Agent 的部分在 Langfuse、其余在别处。第二,不绑定厂商。按标准打的 span,想发给 Langfuse、Jaeger、Datadog 还是阿里云 ARMS,改导出器配置就行。第三,就是前面说的,有岗位明确要求。

### GenAI 语义约定

语义约定(semantic conventions)规定的是「span 叫什么名字、属性用什么 key」。如果每个人都自己起名字,有人叫 `llm.model`,有人叫 `model_name`,后端就没法统一展示和统计。OpenTelemetry 为生成式 AI 专门定了一套,现在在单独的仓库 [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai) 里维护,状态是 Development(还在变)。下面是 2026 年 10 月版本里最常用的部分:

| 操作 | span 名称 | span kind | 关键属性 |
| --- | --- | --- | --- |
| 模型调用 | `chat {gen_ai.request.model}` | CLIENT | `gen_ai.operation.name=chat`、`gen_ai.provider.name`、`gen_ai.request.model`、`gen_ai.response.model`、`gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens`、`gen_ai.response.finish_reasons` |
| 工具调用 | `execute_tool {gen_ai.tool.name}` | INTERNAL | `gen_ai.operation.name=execute_tool`、`gen_ai.tool.name`、`gen_ai.tool.call.id`、`gen_ai.tool.type` |
| 检索 | `retrieval {gen_ai.data_source.id}` | CLIENT | `gen_ai.operation.name=retrieval`、`gen_ai.data_source.id`、`gen_ai.retrieval.top_k` |
| 调用 Agent | `invoke_agent {gen_ai.agent.name}` | CLIENT 或 INTERNAL | `gen_ai.operation.name=invoke_agent`、`gen_ai.agent.name`、`gen_ai.conversation.id` |
| 工作流 | `invoke_workflow {gen_ai.workflow.name}` | INTERNAL | `gen_ai.operation.name=invoke_workflow`、`gen_ai.workflow.name`、`gen_ai.conversation.id` |

指标方面,和我们最相关的有:`gen_ai.client.operation.duration`(直方图,单位秒)、`gen_ai.execute_tool.duration`(直方图),以及 token 用量计数器 `gen_ai.client.inference.usage.input_tokens` 和 `gen_ai.client.inference.usage.output_tokens`(单位 `{token}`,带 `gen_ai.token.modality` 等属性)。

有两个坑提前说。一是 `gen_ai.provider.name` 是较新的名字,老版本叫 `gen_ai.system`;token 指标在老版本里是一个叫 `gen_ai.client.token.usage` 的直方图,用 `gen_ai.token.type` 区分输入输出。你在网上看到的文章、甚至一些库的默认行为,可能还是老名字。比如 OpenTelemetry 官方的 OpenAI 自动埋点库,默认对齐的是 v1.30 版语义约定,要设环境变量 `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` 才会切到新约定。二是 `gen_ai.provider.name` 有一张标准取值表,DeepSeek 是 `deepseek`,OpenAI 是 `openai`,Anthropic 是 `anthropic`,Kimi 对应 `moonshot_ai`;阿里通义不在表里,可以用自定义值,比如 `alibaba.dashscope`(这是我的取法,不是标准值)。

还有一点:prompt 和回复的**原文默认不应该记录**。语义约定要求内容采集必须由用户显式开启,比如 OpenAI 自动埋点库用 `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` 控制。原因很现实:客服对话里有手机号、地址、发票信息,随便进日志系统会出合规问题。

### 1. 初始化:一个 provider,两个出口

```bash
uv add opentelemetry-sdk opentelemetry-exporter-otlp-proto-http opentelemetry-exporter-prometheus
docker run --rm -d --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:2.22.0
```

Jaeger 2.x 的一体化镜像自带 OTLP 接收端(4318 是 HTTP 端口)和网页界面(16686)。它比 Langfuse 自托管轻得多,一个容器,笔记本跑得动。

```python
# agent-60-lab/w5/otel_setup.py
"""OpenTelemetry 初始化:trace 导出到 Jaeger(可选),指标用 Prometheus 格式暴露。
必须在 langfuse.get_client() 之前调用:Langfuse 发现已有全局 TracerProvider 时,
会把自己的处理器挂上去,而不是另建一个,这样一份 span 同时进 Jaeger 和 Langfuse。"""
from __future__ import annotations

import os

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.prometheus import PrometheusMetricReader
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from prometheus_client import start_http_server

_done = False


def setup_otel(service_name: str = "cloudledger-agent") -> None:
    global _done
    if _done:
        return
    resource = Resource.create({
        "service.name": service_name,
        "deployment.environment.name": os.getenv("APP_ENV", "dev"),
    })

    tp = TracerProvider(resource=resource)
    jaeger = os.getenv("JAEGER_OTLP_ENDPOINT")          # 例如 http://localhost:4318/v1/traces
    if jaeger:
        tp.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=jaeger)))
    trace.set_tracer_provider(tp)

    reader = PrometheusMetricReader()
    metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[reader]))
    start_http_server(int(os.getenv("METRICS_PORT", "9464")))   # curl localhost:9464/metrics
    _done = True
```

<div class="line-notes">

- `"""OpenTelemetry 初始化:` docstring 里写清楚调用顺序要求:必须在 `langfuse.get_client()` 之前。
- `from opentelemetry import metrics, trace` 两个 API 入口:`trace` 管 span,`metrics` 管指标。API 和 SDK 是分开的包,库代码只依赖 API,应用启动时装上 SDK(就是这个文件做的事)。
- `from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter` 用 OTLP/HTTP 协议把 span 发出去,Jaeger、Tempo、Langfuse 都收这个格式。
- `from opentelemetry.exporter.prometheus import PrometheusMetricReader` 把指标转成 Prometheus 文本格式,等 Prometheus 来拉。
- `from prometheus_client import start_http_server` 起一个只提供 `/metrics` 的小 HTTP 服务,跑在后台线程里。
- `_done = False` 模块级标志,防止重复初始化。
- `def setup_otel(service_name: str = "cloudledger-agent") -> None:` 默认服务名就是你在 Jaeger 下拉框里选的那个。
- `global _done` 函数里要给模块级变量重新赋值,必须先声明 `global`,否则 `_done = True` 只会建一个局部变量。
- `if _done:` 实测连调两次 `setup_otel()`,第二次直接返回。不加这个判断,第二次 `start_http_server` 会因为端口被占用报 `OSError: [Errno 48] Address already in use`。
- `resource = Resource.create({` resource 描述「是谁产生的数据」,会附在每个 span 和指标上。
- `"deployment.environment.name": os.getenv("APP_ENV", "dev"),` 区分 dev / staging / prod,没设就是 `dev`。
- `tp = TracerProvider(resource=resource)` trace 的 SDK 实现。
- `jaeger = os.getenv("JAEGER_OTLP_ENDPOINT")` 没设就不导出 span。我实跑时没有 Docker、没起 Jaeger,这一项留空,span 只在内存里(用测试用的 `InMemorySpanExporter` 收集来看)。
- `tp.add_span_processor(BatchSpanProcessor(OTLPSpanExporter(endpoint=jaeger)))` `BatchSpanProcessor` 攒一批再发,不阻塞业务代码。一个 provider 可以挂多个 processor,这就是「一份 span 发两个地方」的原理。
- `trace.set_tracer_provider(tp)` 设成全局。之后任何地方 `trace.get_tracer(...)` 拿到的都挂在它上面。全局只能设一次,第二次会被忽略并打警告。
- `reader = PrometheusMetricReader()` 指标读取器。
- `metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=[reader]))` 指标的全局 provider。
- `start_http_server(int(os.getenv("METRICS_PORT", "9464")))` 默认端口 9464。实测起来后 `curl localhost:9464/metrics` 能看到 `gen_ai_` 开头的指标(具体内容见下面 `genai_otel.py` 的注释)。

</div>

### 2. 三种 span 和两个指标

```python
# agent-60-lab/w5/genai_otel.py
"""按 OpenTelemetry GenAI 语义约定手动埋点。"""
from __future__ import annotations

import functools
import inspect
import os
import time
from contextlib import contextmanager

from opentelemetry import metrics, trace
from opentelemetry.trace import SpanKind, Status, StatusCode

tracer = trace.get_tracer("cloudledger.agent")
meter = metrics.get_meter("cloudledger.agent")

PROVIDER = os.getenv("GENAI_PROVIDER", "deepseek")   # 按标准取值表填

# 默认桶边界是 0、5、10、25……750、1000,按毫秒设计的,秒级耗时全挤在第一个桶里。用语义约定建议的边界
DURATION_BUCKETS = [0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48, 40.96, 81.92]
OP_DURATION = meter.create_histogram("gen_ai.client.operation.duration", unit="s",
                                     description="GenAI operation duration",
                                     explicit_bucket_boundaries_advisory=DURATION_BUCKETS)
TOOL_DURATION = meter.create_histogram("gen_ai.execute_tool.duration", unit="s",
                                       description="Tool execution duration",
                                       explicit_bucket_boundaries_advisory=DURATION_BUCKETS)
INPUT_TOKENS = meter.create_counter("gen_ai.client.inference.usage.input_tokens", unit="{token}")
OUTPUT_TOKENS = meter.create_counter("gen_ai.client.inference.usage.output_tokens", unit="{token}")


@contextmanager
def workflow_span(name: str, conversation_id: str):
    """整张工单的根 span。"""
    attrs = {"gen_ai.operation.name": "invoke_workflow",
             "gen_ai.workflow.name": name,
             "gen_ai.conversation.id": conversation_id}
    with tracer.start_as_current_span(f"invoke_workflow {name}", kind=SpanKind.INTERNAL,
                                      attributes=attrs) as span:
        yield span


def traced_chat(client, *, model: str, messages: list[dict], **kwargs):
    """包一层 openai 兼容的 chat.completions.create。"""
    attrs = {"gen_ai.operation.name": "chat", "gen_ai.provider.name": PROVIDER,
             "gen_ai.request.model": model}
    # record_exception=False:异常由下面的 except 自己记,不关掉的话 SDK 会再记一遍,span 上出现两个 exception 事件
    with tracer.start_as_current_span(f"chat {model}", kind=SpanKind.CLIENT, attributes=attrs,
                                      record_exception=False) as span:
        t0 = time.perf_counter()
        error_type = None
        try:
            resp = client.chat.completions.create(model=model, messages=messages, **kwargs)
        except Exception as e:
            error_type = type(e).__name__
            span.record_exception(e)
            span.set_status(Status(StatusCode.ERROR, str(e)))
            span.set_attribute("error.type", error_type)
            raise
        finally:
            OP_DURATION.record(time.perf_counter() - t0,
                               {**attrs, **({"error.type": error_type} if error_type else {})})
        span.set_attribute("gen_ai.response.model", resp.model)
        span.set_attribute("gen_ai.response.finish_reasons", [c.finish_reason for c in resp.choices])
        if resp.usage:
            span.set_attribute("gen_ai.usage.input_tokens", resp.usage.prompt_tokens)
            span.set_attribute("gen_ai.usage.output_tokens", resp.usage.completion_tokens)
            labels = {**attrs, "gen_ai.token.modality": "text"}
            INPUT_TOKENS.add(resp.usage.prompt_tokens, labels)
            OUTPUT_TOKENS.add(resp.usage.completion_tokens, labels)
        return resp


def traced_tool(fn):
    """给工具函数加 execute_tool span,同步和 async 函数都支持。"""
    name = fn.__name__
    attrs = {"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": name,
             "gen_ai.tool.type": "function"}

    def _start():
        return tracer.start_as_current_span(f"execute_tool {name}", kind=SpanKind.INTERNAL,
                                            attributes=attrs, record_exception=False)

    def _fail(span, e):
        span.record_exception(e)
        span.set_status(Status(StatusCode.ERROR, str(e)))
        span.set_attribute("error.type", type(e).__name__)

    if inspect.iscoroutinefunction(fn):
        @functools.wraps(fn)
        async def awrapper(*args, **kwargs):
            with _start() as span:
                t0 = time.perf_counter()
                try:
                    return await fn(*args, **kwargs)
                except Exception as e:
                    _fail(span, e)
                    raise
                finally:
                    TOOL_DURATION.record(time.perf_counter() - t0, attrs)
        return awrapper

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with _start() as span:
            t0 = time.perf_counter()
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                _fail(span, e)
                raise
            finally:
                TOOL_DURATION.record(time.perf_counter() - t0, attrs)
    return wrapper
```

<div class="line-notes">

- `import functools` 下面用 `functools.wraps` 保留被装饰函数的名字和 docstring。
- `import inspect` 用 `inspect.iscoroutinefunction` 判断是不是 `async def`。
- `from contextlib import contextmanager` 把一个带 `yield` 的生成器函数变成可以 `with` 的上下文管理器。
- `from opentelemetry.trace import SpanKind, Status, StatusCode` `SpanKind` 标明 span 的角色(CLIENT 是调外部服务,INTERNAL 是进程内部);`Status` 标记成功还是失败。
- `tracer = trace.get_tracer("cloudledger.agent")` 名字是埋点库的名字(instrumentation scope),不是服务名。实测它会以 `otel_scope_name="cloudledger.agent"` 的 label 出现在指标里。
- `PROVIDER = os.getenv("GENAI_PROVIDER", "deepseek")` 按语义约定的取值表填。实测没设环境变量时是 `deepseek`。
- `DURATION_BUCKETS = [0.01, 0.02,` 直方图的桶边界,从 10 毫秒到 82 秒,每格翻倍。为什么要显式写:实测不写时,SDK 用的默认边界是 `0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, …`,那是为毫秒设计的。我们记的是秒,一次 0.67 秒的模型调用落进 `le="5.0"` 这一格,比它小的只有 `le="0"`,P50、P95 全算不出来。加上之后实测一次 0.64 秒的调用,`le="0.32"` 计数 0、`le="0.64"` 计数 1,分辨得很清楚。
- `OP_DURATION = meter.create_histogram("gen_ai.client.operation.duration", unit="s",` 模型调用耗时的直方图,名字和单位都按语义约定。
- `explicit_bucket_boundaries_advisory=DURATION_BUCKETS)` 「advisory」意思是建议值:用户在 SDK 里配了 View 会覆盖它,没配就用它。
- `TOOL_DURATION = meter.create_histogram("gen_ai.execute_tool.duration", unit="s",` 工具耗时,和上面同一套桶。
- `INPUT_TOKENS = meter.create_counter("gen_ai.client.inference.usage.input_tokens", unit="{token}")` counter 只增不减,适合累计 token。`{token}` 是 UCUM 的写法,花括号表示「这是个计数单位的说明」。
- `@contextmanager` 下面的函数就能写成 `with workflow_span(...) as span:`。
- `def workflow_span(name: str, conversation_id: str):` 整张工单的根 span,其他 span 都挂在它下面。
- `"gen_ai.conversation.id": conversation_id}` 实测我传的是 `eval-C007-1a2b3c4d`。按它能把一次对话的所有 span 找出来。
- `with tracer.start_as_current_span(f"invoke_workflow {name}", kind=SpanKind.INTERNAL,` 「current」的意思是:这个 span 在 with 块里是当前活动的 span,块里新建的 span 自动成为它的子 span。实测根 span 的 `parent` 是 None,块里的 `chat` 和 `execute_tool` 的 `parent` 都等于根 span 的 id。
- `yield span` `yield` 之前是进入 with,之后是退出 with。调用方在 with 块里做的事,都发生在 yield 暂停的这段时间里。
- `def traced_chat(client, *, model: str, messages: list[dict], **kwargs):` `*` 后面的参数只能用关键字传,防止把 model 和 messages 的位置传反。`**kwargs` 原样转给 SDK,比如 `extra_body`、`tools`。
- `attrs = {"gen_ai.operation.name": "chat", "gen_ai.provider.name": PROVIDER,` 低基数属性,span 和指标都用。
- `with tracer.start_as_current_span(f"chat {model}", kind=SpanKind.CLIENT, attributes=attrs,` span 名按约定是 `chat {模型名}`,实测为 `chat deepseek-flash`。
- `record_exception=False) as span:` 不让 SDK 自动记异常。实测原来不加这个参数时,一次失败调用的 span 上有两个 `exception` 事件:一个是下面 `except` 里手动记的,另一个是异常穿出 with 块时 SDK 自动记的。加上之后只剩一个。
- `t0 = time.perf_counter()` 高精度计时器,只适合算时间差,不是钟表时间。
- `error_type = None` 先置空,成功时保持 None。
- `resp = client.chat.completions.create(model=model, messages=messages, **kwargs)` 真正的调用。实测问「用一句话说你好」,回复「你好!很高兴见到你,有什么我可以帮忙的吗?」,输入 8、输出 11 token。
- `except Exception as e:` 实测把 model 写成不存在的 `no-such-model`,DeepSeek 返回 400,这里捕到 `BadRequestError`。
- `span.record_exception(e)` 把异常类型、消息、堆栈作为一个事件记到 span 上。
- `span.set_status(Status(StatusCode.ERROR, str(e)))` 标红。实测失败那个 span 的状态是 `StatusCode.ERROR`,成功的是 `UNSET`(UNSET 就表示没出错,不需要显式设 OK)。
- `span.set_attribute("error.type", error_type)` 实测值 `BadRequestError`。
- `raise` 记完再抛,不吞掉异常,调用方该重试还是该报错照旧。
- `finally:` 成功失败都要记耗时。
- `OP_DURATION.record(time.perf_counter() - t0,` 实测成功那次 0.64 秒、失败那次 0.09 秒。
- `{**attrs, **({"error.type": error_type} if error_type else {})})` 只有失败时才多一个 `error.type` 属性。实测指标里出现两条序列:`error_type=""` 的是成功调用(Prometheus 导出时同一个指标里缺的 label 会补空串),`error_type="BadRequestError"` 的是失败调用。
- `span.set_attribute("gen_ai.response.model", resp.model)` 厂商实际用的模型,可能和请求的不一样(比如请求别名、返回具体版本)。实测两者都是 `deepseek-flash`。
- `span.set_attribute("gen_ai.response.finish_reasons", [c.finish_reason for c in resp.choices])` 列表属性,实测为 `('stop',)`。
- `if resp.usage:` 有的厂商流式返回时没有 usage,判断一下。
- `labels = {**attrs, "gen_ai.token.modality": "text"}` token 指标多一个 modality 属性。
- `INPUT_TOKENS.add(resp.usage.prompt_tokens, labels)` 实测 `/metrics` 里 `gen_ai_client_inference_usage_input_tokens_total{...} 8.0`。名字被 Prometheus 改了:点换成下划线,counter 加 `_total` 后缀。
- `def traced_tool(fn):` 装饰器:接收函数,返回包装后的函数。
- `name = fn.__name__` 工具名直接用函数名。
- `def _start():` 每次调用都要新开 span,所以包成函数,不能在装饰时就开好。
- `attributes=attrs, record_exception=False)` 和 `traced_chat` 同一个原因,关掉自动记异常。
- `def _fail(span, e):` 同步和异步两个包装都要用的失败处理,抽出来写一次。
- `if inspect.iscoroutinefunction(fn):` `async def` 定义的函数走这个分支。直接用同步包装会出错:调用 async 函数只会立刻返回一个协程对象,span 在协程真正执行之前就结束了,耗时永远接近 0。
- `@functools.wraps(fn)` 实测包装后 `list_invoices.__name__` 仍然是 `list_invoices`,不加的话会变成 `wrapper`,依赖函数名生成工具 schema 的代码(比如 Day 9 的注册表)就会出错。
- `return await fn(*args, **kwargs)` 在 span 里等协程执行完。实测一个 `sleep(0.05)` 的 async 工具,耗时记为 0.051 秒。
- `TOOL_DURATION.record(time.perf_counter() - t0, attrs)` 实测同步的 `list_invoices`(直接返回假数据)只有 3.5 微秒,`/metrics` 里是 `gen_ai_execute_tool_duration_seconds_sum{gen_ai_tool_name="list_invoices",...} 3.547e-06`。
- `def wrapper(*args, **kwargs):` 同步版本,结构和上面一样,只是没有 await。实测一个抛 `ValueError("库连不上")` 的工具:异常照常抛给调用方,span 状态 ERROR,`error.type=ValueError`,一个 exception 事件。

</div>

几个实现细节:

`traced_chat` 里,不管成功失败都记录耗时(放在 `finally` 里),失败时带上 `error.type`。这样你在指标里能分别看到成功调用和 429、超时这类失败调用的耗时分布。只统计成功调用,会让你低估用户实际等待的时间。

span 属性里只放了 token 数,没放 prompt 和回复原文。要记原文的话,单独加一个开关,默认关闭。

指标的属性(Prometheus 里叫 label)只放了低基数的东西:操作名、厂商、模型名。千万别把 `customer_id`、`trace_id` 这种值放进指标属性,每个不同的值都会产生一条新的时间序列,客户一多,指标系统就会被撑爆。按客户统计花费,用 trace 里的 user_id 去 Langfuse 里查,不要用指标。

### 3. 用到 W4 上

W4 的 Agent 里,工具调用是经过 MCP 客户端发出去的。最自然的埋点位置是你把 MCP 工具包装成 LangChain 工具(或者 Day 9 那种工具注册表)的那一层。给那个调用函数加上 `@traced_tool` 即可;如果你是动态包装的,用 `traced_tool(fn)` 的函数形式。工作流根 span 加在 adapter 里:

```python
# agent-60-lab/w5/adapter.py 的 run_case 里,把 graph.invoke 包起来
from w5.genai_otel import workflow_span

        with workflow_span("ticket_router", conversation_id=config["configurable"]["thread_id"]):
            state = graph.invoke({"ticket": ticket, "customer_id": customer_id}, config=config)
```

<div class="line-notes">

- `from w5.genai_otel import workflow_span` 放在 `run_case` 函数里导入也可以,我实跑时就是放在函数里的。
- `with workflow_span("ticket_router", conversation_id=config["configurable"]["thread_id"]):` 用 thread_id 当 conversation.id,形如 `eval-otel-C009-5c1e…`。LangGraph 里所有模型调用、MCP 调用的 span 都在这个 with 块里产生,自动挂到它下面。
- `state = graph.invoke({"ticket": ticket, "customer_id": customer_id}, config=config)` 原来那行缩进一层放进 with 块,其他不变。

</div>

模型调用这一层有个选择要做。W4 里如果是 LangChain 的 `ChatOpenAI` 在调模型,你没法直接把 `traced_chat` 塞进去。两个办法:

- 用官方的自动埋点库 `opentelemetry-instrumentation-openai-v2`。`ChatOpenAI` 底层用的就是 `openai` SDK,所以 `OpenAIInstrumentor().instrument()` 一行就能让每次模型调用自动产生 `chat` span。记得设置上面说的 `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`。
- 你自己的代码里直接调 `openai` SDK 的地方(评分器、模拟器),用 `traced_chat`。

别同时开两套。 如果你既在 LangGraph 里传了 Langfuse 的 `CallbackHandler`,又开了 OpenAI 自动埋点,同一次模型调用会在 Langfuse 里出现两次,token 和费用也会算两遍。我的做法是:学习阶段先用第一部分的 `CallbackHandler`,熟悉界面;然后关掉它,换成 OTel 这一套,对比两者看到的东西有什么不同。生产环境里选一套坚持用。如果公司已经有 OTel 体系,选 OTel,Langfuse 作为其中一个导出目的地。

### 4. 跑起来看

```python
# agent-60-lab/w5/otel_demo.py
"""用法: JAEGER_OTLP_ENDPOINT=http://localhost:4318/v1/traces uv run python -m w5.otel_demo"""
from dotenv import load_dotenv

load_dotenv()

from w5.otel_setup import setup_otel  # noqa: E402

setup_otel()   # 先于 Langfuse 初始化

from langfuse import get_client  # noqa: E402
from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor  # noqa: E402

from w5.adapter import run_case  # noqa: E402

OpenAIInstrumentor().instrument()
langfuse = get_client()

for cid, ticket in [("C009", "我们年付的,下个月起不用了,剩下几个月的钱能退吗?"),
                    ("C007", "10 月 8 号被扣了两次款,麻烦退一笔"),
                    ("C002", "月付不想用了,这个月的钱退我")]:
    run = run_case(f"otel-{cid}", ticket, cid)
    print(cid, run.category, run.latency_s)

langfuse.flush()
input("打开 http://localhost:16686 和 http://localhost:9464/metrics 看看,回车退出")
```

<div class="line-notes">

- `load_dotenv()` 放在最前面,后面几个 import 在导入时就会读环境变量。
- `from w5.otel_setup import setup_otel  # noqa: E402` `E402` 是 Ruff/flake8 的「import 不在文件顶部」警告。这里是故意的:必须先跑完 `load_dotenv()` 和 `setup_otel()` 再导入后面的模块,`noqa` 告诉检查器别报。
- `setup_otel()   # 先于 Langfuse 初始化` 全局 TracerProvider 先设好,Langfuse 初始化时发现已有 provider,就把自己的处理器挂上去。
- `from opentelemetry.instrumentation.openai_v2 import OpenAIInstrumentor  # noqa: E402` 官方的 OpenAI 自动埋点库。实测 2.4b0 配 `opentelemetry-util-genai` 1.2b0 时这一行直接报 `ModuleNotFoundError: No module named 'opentelemetry.util.genai.instruments'`,把 util-genai 限制在 1.2 以下(我用 1.1b0)才能导入,见代码下面的安装命令。
- `OpenAIInstrumentor().instrument()` 给 `openai` SDK 打猴子补丁,之后所有 `chat.completions.create` 都自动产生 span。`ChatOpenAI` 底层用的就是它,所以 LangGraph 里的模型调用也被覆盖了。
- `langfuse = get_client()` 我没有 Langfuse 账号,这里是禁用状态,不影响 OTel 那边。
- `for cid, ticket in [("C009", "我们年付的,` 三张工单。实测输出 `C009 refund 8.092`、`C007 refund 6.68`、`C002 refund 6.952`:三张都被分到 refund,每张 6–8 秒。
- `run = run_case(f"otel-{cid}", ticket, cid)` 用的是上面加了 `workflow_span` 的 adapter。实测三张工单一共产生 44 个 span:`chat deepseek-flash` 11 个(每张工单里第一个是 classify 那次,它用 function calling 做结构化输出,所以 `finish_reasons` 是 `tool_calls`),`invoke_workflow ticket_router` 3 个,另外还有 `MCP send tools/list`、`MCP send tools/call list_invoices` 这类 span 共 30 个,是 MCP Python SDK 2.x 自己埋的点,不用你写。`execute_tool` span 没有出现,因为 W4 的工具函数还没加 `@traced_tool`,这一步要你自己加。
- `print(cid, run.category, run.latency_s)` 自动埋点产生的 `chat` span 属性实测有 `gen_ai.provider.name='openai'`(它只认 SDK,不认背后是 DeepSeek)、`gen_ai.request.temperature=0.0`、`gen_ai.usage.input_tokens=414` 等。练习 6 要对的数,我在这里多打了 `run.input_tokens` 又跑了一遍同样三张:adapter 累加是输入 17458、输出 1393,`/metrics` 里的 `gen_ai_client_token_usage_sum` 也是 17458 和 1393,一个不差。两边统计的是同一批调用:Day 29 的 adapter 用 `UsageMetadataCallbackHandler` 记每一次 `ChatOpenAI` 调用,自动埋点记每一次 `openai` SDK 调用,classify 都在里面。如果把 adapter 换回「从 `messages` 里每条 AI 消息累加」的旧写法,同样三张实测是 16196 对 17426,差 1230 个输入 token,约等于 3 次 classify 的量:分类结果不进消息列表,旧写法漏掉了它。
- `langfuse.flush()` 没账号时什么也不发。
- `input("打开 http://localhost:16686` 让进程别退出,`/metrics` 的 HTTP 服务跑在这个进程里,进程退了就看不到了。Jaeger 需要 Docker,我没有实跑那一侧;`/metrics` 实测内容见代码下面的说明。

</div>

```bash
uv add opentelemetry-instrumentation-openai-v2 "opentelemetry-util-genai<1.2"
JAEGER_OTLP_ENDPOINT=http://localhost:4318/v1/traces \
OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental \
uv run python -m w5.otel_demo
```

打开 Jaeger(`localhost:16686`),Service 选 `cloudledger-agent`,能看到三个 trace,每个下面挂着 `chat ...` 和 `execute_tool ...` 的 span。同一批 span 也会出现在 Langfuse 里。Langfuse v4 默认只接收「LLM 相关」的 span:它自己 SDK 产生的、带 `gen_ai.*` 属性的、以及已知 LLM 埋点库产生的。我们按语义约定打的 span 都带 `gen_ai.operation.name`,所以会被收进去。如果你还打了一些普通的业务 span(比如「查 Redis」),它们只会进 Jaeger,不会进 Langfuse,这是 v4 的默认过滤策略,需要的话可以在 `Langfuse(should_export_span=...)` 里改。

另开一个终端看指标:

```bash
curl -s localhost:9464/metrics | grep gen_ai
```

输出大致长这样(Prometheus 会把点换成下划线,并按单位和类型加后缀,具体名字以你看到的为准):

```text
gen_ai_client_inference_usage_input_tokens_total{gen_ai_operation_name="chat",gen_ai_provider_name="deepseek",gen_ai_request_model="...",gen_ai_token_modality="text"} 18234.0
gen_ai_client_operation_duration_seconds_bucket{...,le="2.5"} 5.0
gen_ai_execute_tool_duration_seconds_count{gen_ai_tool_name="list_invoices",...} 3.0
```

上面第二、三行来自我们自己的 `traced_chat` 和 `traced_tool`。只靠自动埋点跑 W4 的话,看到的会不一样。我 2026 年 10 月实跑 `otel_demo`(三张工单、11 次模型调用)拿到的是 `gen_ai_client_operation_duration_seconds_count{...,gen_ai_provider_name="openai",...} 11.0` 和 `gen_ai_client_token_usage_sum{...,gen_ai_token_type="input"} 14708.0`:自动埋点库(2.4b0)即使设了 `OTEL_SEMCONV_STABILITY_OPT_IN`,token 指标仍是老的 `gen_ai.client.token.usage` 直方图,`provider` 也按 SDK 记成了 `openai` 而不是 `deepseek`。另外 `uv add` 时要顺手把 `opentelemetry-util-genai` 限制在 1.2 以下:它的 1.2b0 改了内部模块名,和 openai-v2 2.4b0 不兼容,import 时报 `No module named 'opentelemetry.util.genai.instruments'`。

有了这些指标,接上 Prometheus 和 Grafana 就能画「每分钟 token 用量」「模型调用 P95 延迟」「各工具耗时」这些面板,设告警(比如 token 用量一小时内翻倍,很可能是某个 Agent 在死循环)。Grafana 的部署 Day 41 再说,今天能在 `/metrics` 里看到数字就够了。

### 5. 跨服务串起来(预告)

现在 trace 从 adapter 开始。Day 36 Agent 变成 HTTP 服务后,如果调用方也接了 OTel,它会在请求头里带上 `traceparent`(W3C Trace Context 标准),FastAPI 的 OTel 中间件读到它,Agent 这边的 span 就会挂到调用方的 trace 下面,一条链从前端一直串到工具调用。这就是那条 JD 里「覆盖 API、AI 工作流、模型请求和工具调用」的完整含义。

## 看什么:几个真正有用的视图

接入之后,不要只是偶尔点开看看。我每周会固定看这几样:

- **最慢的 10 个 trace。** 按耗时排序,点开看时间花在哪。常见发现:某个工具调用偶尔超时 10 秒;某次模型调用的输入 token 异常多(上下文没截断)。
- **最贵的 10 个 trace。** 按费用排序。常见发现:Agent 在原地打转调了十几次模型(这正是 Day 33 预算检查要抓的)。
- **错误率。** 哪些 span 带 ERROR 状态,集中在哪个工具。
- **用户点踩的 trace。** 全部读,作为下一轮错误分析的素材。
- **单张工单成本的分布。** 均值、P50、P95。Day 38 优化成本、Day 52 算 ROI 都从这里出发。

还有一件事是线上评测(online eval):Langfuse 可以配置 LLM 评分器,对线上 trace 抽样自动打分。你可以把 Day 32 校准过的 `facts` 评分器搬上去,对 10% 的线上流量打分。注意抽样,全量打分的费用可能比 Agent 本身还高。

## 隐私和合规

客服 trace 里会有客户的姓名、手机号、发票、地址。几条底线:

- 原文采集默认关闭,确实需要时只在开发和测试环境开。
- 需要记录内容时先脱敏。Langfuse 的 `Langfuse(mask=...)` 可以传一个函数,在数据发送之前替换掉敏感内容:

```python
import re

from langfuse import Langfuse

PHONE = re.compile(r"1[3-9]\d{9}")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")


def mask(*, data, **kwargs):
    if isinstance(data, str):
        return EMAIL.sub("<email>", PHONE.sub("<phone>", data))
    return data


langfuse = Langfuse(mask=mask)
```

<div class="line-notes">

- `PHONE = re.compile(r"1[3-9]\d{9}")` 大陆手机号:1 开头,第二位 3–9,后面 9 位数字,共 11 位。预编译一次,每次调用不用重新解析正则。
- `EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")` 粗略的邮箱规则,够脱敏用,不是严格校验。
- `def mask(*, data, **kwargs):` Langfuse 调用时用关键字传 `data`,以后可能多传别的参数,所以收一个 `**kwargs` 兜住。
- `if isinstance(data, str):` 只处理字符串。dict、list 原样返回,实测 `mask(data={"phone": "13812345678"})` 原样返回 `{'phone': '13812345678'}`,结构化数据里的手机号漏掉了,生产里要递归处理。
- `return EMAIL.sub("<email>", PHONE.sub("<phone>", data))` 先换手机号再换邮箱。实测输入「我是刘静,手机 13812345678,邮箱 user007@example.com,发票 INV-2026-0123」,输出「我是刘静,手机 &lt;phone&gt;,邮箱 &lt;email&gt;,发票 INV-2026-0123」。座机 `010-62345678` 不会被换掉;一串 17 位的订单号 `20261008123456789` 也没被误伤,因为它不是以 1 开头。
- `langfuse = Langfuse(mask=mask)` 实测 5.0.4 的构造函数里 `mask` 和 `should_export_span` 两个参数都在。

</div>

- 数据放在哪里要和公司确认。用海外云版,客户数据就出境了;国内业务很可能要求自托管。
- trace 保留期限要设,不要无限期保存。

Day 40 讲数据脱敏时会更完整地处理这个问题。

## 动手练习

1. 注册 Langfuse 云版,配好环境变量,运行 `w5/traced_run.py`,在界面上找到这次运行,截个图(或者用文字描述)写清楚树的结构和每一层的耗时。
2. 改 `run_eval.py`:用 `traced_case` 替代 `run_case`,每条用例跑完后 `push_scores`。跑一遍 dev 集,在 Langfuse 里按 score 筛出所有失败的 trace。
3. 在 Langfuse 里找出 dev 集里最慢和最贵的各 3 条 trace,写下它们慢和贵的原因。
4. 起 Jaeger,完成第二部分:`otel_setup.py`、`genai_otel.py`,把 `@traced_tool` 加到 W4 的工具调用层,`workflow_span` 加到 adapter。关掉 `CallbackHandler`,打开 OpenAI 自动埋点,跑 `otel_demo.py`。
5. 在 Jaeger 和 Langfuse 里分别看同一个 trace,写下两边看到的东西有什么不同(提示:哪边有 token 费用、哪边有业务 span)。
6. `curl localhost:9464/metrics`,找到三次运行的输入 token 总数,和 adapter 里 `run.input_tokens` 的累加值对一下。两边应该一样;如果不一样,差在哪几次模型调用、为什么(提示:看看你的 adapter 统计 token 时有没有算上 classify 那一步)。
7. 给 `mask` 函数写两个单元测试:手机号和邮箱都被替换,普通文本不变。

### 验收标准

- Langfuse 里能看到带 user_id、session_id 的 trace,并且每个 trace 上有 Day 29–33 的 grader 分数。
- Jaeger 里能看到 `invoke_workflow ticket_router` 根 span 下挂着 `chat` 和 `execute_tool` 子 span,属性名符合语义约定。
- `/metrics` 能看到 token 计数器和工具耗时直方图。
- 笔记里有:最慢和最贵 trace 的分析;Jaeger 与 Langfuse 的对比;token 对账的结果。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 可观测性 observability | 从外部信号(trace、指标、日志)理解系统内部状态的能力 |
| trace | 一次完整请求的处理链路,由一棵 span 树组成 |
| span | trace 中的一个步骤,有起止时间、父子关系和属性 |
| generation | Langfuse 中表示模型调用的 span,带 token 和费用 |
| session | 多个 trace 组成的会话,如同一客户的多轮对话 |
| score | 挂在 trace 或 span 上的评价分数 |
| OpenTelemetry / OTel | CNCF 的可观测性标准和 SDK,定义 trace、指标、日志的采集与导出 |
| 语义约定 semantic conventions | 规定 span 名称和属性 key 的标准 |
| GenAI semconv | 专门针对生成式 AI 的语义约定,属性以 `gen_ai.` 开头 |
| TracerProvider | OTel SDK 中创建 tracer、管理 span 处理器和导出器的对象 |
| OTLP | OpenTelemetry 的传输协议,HTTP 默认端口 4318,gRPC 默认 4317 |
| Jaeger | 开源分布式追踪系统,2.x 版本原生支持 OTLP |
| 基数 cardinality | 某个属性不同取值的数量,指标属性的基数要低 |
| traceparent | W3C Trace Context 标准的请求头,用于跨服务传递 trace 上下文 |

## 常见误区

**短脚本跑完不 flush。** SDK 后台批量发送,进程退出时还没发出去的数据就丢了,界面一片空白。脚本最后调 `flush()`,服务退出时调 `shutdown()`。

**Langfuse 回调和 OTel 自动埋点同时开。** 同一次模型调用被记两次,token 和费用翻倍。选一套。

**OTel 初始化顺序反了。** 先创建 Langfuse 客户端、后设置自己的 TracerProvider,Langfuse 会用它自己建的那个,你的 Jaeger 导出器收不到它的 span。先 `setup_otel()`,再 `get_client()`。

**把高基数的值放进指标属性。** customer_id、trace_id、工单号进了指标 label,时间序列数量爆炸。按客户分析用 trace,不用指标。

**默认记录全部 prompt 和回复原文。** 客户隐私数据进了日志和第三方平台。默认关,需要时脱敏后开。

**照着老教程用老属性名。** `gen_ai.system`、`gen_ai.client.token.usage`、`LANGFUSE_HOST` 这些都是旧写法。语义约定还在 Development 阶段,写代码前看一眼当前版本的文档,并且在代码注释里记下你对齐的是哪个版本。

**接了 tracing 就以为有了可观测性。** 数据进来了但没人看,和没接一样。每周固定看最慢、最贵、出错、点踩这几个视图。

## 学习资料

### 文档与文章

- [Langfuse · Get Started](https://langfuse.com/docs/observability/get-started):官方快速开始,先照着走一遍,15 分钟。
- [Langfuse · Python SDK](https://langfuse.com/docs/observability/sdk/python/overview):v4 SDK 的完整说明,重点看 `@observe`、`propagate_attributes`、flush 和 shutdown 几节。
- [Langfuse · LangChain & LangGraph 集成](https://langfuse.com/docs/integrations/langchain/tracing):`CallbackHandler` 的用法和常见问题。
- [Langfuse · OpenTelemetry 集成](https://langfuse.com/integrations/native/opentelemetry):Langfuse 作为 OTLP 后端的配置方法(端点 `/api/public/otel`、Basic 认证头),以及默认的 span 过滤规则。
- [Langfuse · Sessions](https://langfuse.com/docs/observability/features/sessions):多轮对话怎么归到一个 session。
- [OpenTelemetry GenAI 语义约定仓库](https://github.com/open-telemetry/semantic-conventions-genai):`docs/gen-ai/` 下的 spans、agent spans、metrics 三个文件是今天表格的出处。属性还在变,以这里为准。
- [OpenTelemetry · Python 手动埋点](https://opentelemetry.io/docs/languages/python/instrumentation/):TracerProvider、span、指标的官方教程,30 分钟。
- [OpenTelemetry 博客 · OpenTelemetry for Generative AI](https://opentelemetry.io/blog/2024/otel-generative-ai/):GenAI 语义约定的由来,10 分钟。
- [Jaeger · Getting Started](https://www.jaegertracing.io/docs/latest/getting-started/):一体化镜像的启动方式和端口说明。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nZ3Q6yEzk&autoplay=0&high_quality=1" title="Langfuse 到底是什么?LLM 监控、Trace 与历史记录一次讲清" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>前端屎不了 · Langfuse 到底是什么?LLM 监控、Trace 与历史记录一次讲清 · 11 分钟,中文讲 Langfuse 的定位和 trace 概念,适合开场。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1tUpDzwEr3&autoplay=0&high_quality=1" title="【Langfuse】开源LLM监控平台" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>胖虎遛二狗 · 【Langfuse】开源LLM监控平台 · 26 分钟,有界面操作演示,接入后对照着认识各个页面。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NwNVemEyE&autoplay=0&high_quality=1" title="【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案 · 23 分钟,站在后端工程师的角度讲 OTel 是什么、trace/指标/日志怎么统一,没接触过 OTel 的先看这个。</figcaption>
</figure>

- 代码指南《Agent可观测性从0到1:Langfuse + OpenTelemetry 双剑合璧,打造LLM原生监控体系》(BV1NyMk6QENt,约 1 小时 48 分钟):和今天的两部分完全对应的长视频,做完练习后挑自己没弄明白的部分看。
- 百里说技术《3分钟掌握分布式链路追踪技术的核心参数:TraceID、SpanID、ParentID》(BV1mk4y1V7et,3 分钟):没做过链路追踪的同学先看这个补概念。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/THfB4p2xCFY" title="Langfuse Walkthrough - Full Demo of Agent Tracing, Evals, Experiments and Prompt Management" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Langfuse · Langfuse Walkthrough - Full Demo of Agent Tracing, Evals, Experiments and Prompt Management · 15 分钟,官方最新的完整演示,覆盖 Agent tracing、评测和实验,和今天、明天的内容对应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/FDVdLrloFOw" title="Observability and Evals for AI Agents: A Simple Breakdown" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Observability and Evals for AI Agents: A Simple Breakdown · 15 分钟,讲 Agent 的可观测和评测怎么配合,适合看完整周之后再看一遍。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 10 章「AI Engineering Architecture and User Feedback」:讲监控和可观测、用户反馈怎么收集和利用,今天第一部分第 5 步和「看什么」一节的延伸,约 1 小时。
- Charity Majors、Liz Fong-Jones、George Miranda《Observability Engineering》(O'Reilly,2022):讲可观测性的通用方法论,不针对 AI,但关于高基数、事件和 trace 的思想很有用。挑第 1–3 章读。

### 开源项目与代码

- [langfuse/langfuse](https://github.com/langfuse/langfuse):Langfuse 本体,根目录的 `docker-compose.yml` 就是自托管配置,看一眼它起了哪些服务。
- [open-telemetry/opentelemetry-python-contrib](https://github.com/open-telemetry/opentelemetry-python-contrib):`instrumentation-genai/` 目录下是官方的 GenAI 自动埋点库(OpenAI、Google 等),看它们怎么按语义约定打 span,是写自己埋点代码最好的参考。
- [Arize-ai/phoenix](https://github.com/Arize-ai/phoenix):另一个开源的 LLM 可观测和评测工具,`pip install` 就能本地起一个 UI,想对比的话可以试试。

## 自测

1. 一张工单的处理过程里,trace、span、generation、session、score 分别对应什么?

<details><summary>答案</summary>

trace 是处理这张工单的整个过程;span 是其中每个步骤,包括根工作流、检索、工具调用;generation 是其中的模型调用 span,带 token 和费用;session 是这个客户的整段多轮对话,包含多个 trace;score 是挂在 trace 上的评测结果或用户反馈。

</details>

2. 你的 Langfuse 界面上什么都没有,脚本也没报错。最可能的原因是什么?

<details><summary>答案</summary>

脚本结束前没有调用 `flush()`,后台线程还没把数据发出去进程就退出了。然后检查环境变量(key、`LANGFUSE_BASE_URL` 区域是否对应)。

</details>

3. 为什么指标的属性里不能放 customer_id?那「每个客户花了多少钱」怎么统计?

<details><summary>答案</summary>

指标系统为每种属性组合维护一条时间序列,customer_id 的取值很多,会让时间序列数量爆炸,占满内存和存储。按客户统计花费应该用 trace:trace 上挂了 user_id,在 Langfuse 里按用户聚合费用。

</details>

4. 写出一次模型调用 span 按 GenAI 语义约定应有的名称和至少 5 个属性。

<details><summary>答案</summary>

名称 `chat {模型名}`,span kind 为 CLIENT。属性:`gen_ai.operation.name=chat`、`gen_ai.provider.name`(如 deepseek)、`gen_ai.request.model`、`gen_ai.response.model`、`gen_ai.usage.input_tokens`、`gen_ai.usage.output_tokens`、`gen_ai.response.finish_reasons`;失败时加 `error.type` 并把状态设为 ERROR。

</details>

5. 你同时开了 Langfuse 的 `CallbackHandler` 和 OpenAI 自动埋点,会出现什么现象?

<details><summary>答案</summary>

同一次模型调用在 Langfuse 里出现两个 generation,token 和费用被重复统计,trace 树也变乱。应该只保留一套模型调用的埋点。

</details>

6. (面试题)「你们的 Agent 上线后怎么做监控?」

<details><summary>答案</summary>

要点:用 OpenTelemetry 按 GenAI 语义约定埋点,覆盖 API 入口、工作流根 span、每次模型调用(模型、token、耗时、错误)、每次工具调用和检索;trace 通过 traceparent 和上游服务串起来;导出到 Langfuse 看 LLM 细节,同时进公司现有的 APM;token 用量、模型和工具耗时做成低基数指标,接 Prometheus/Grafana,对 token 突增、错误率、P95 延迟设告警;trace 上挂 user_id 和 session_id,能按客户分析成本;离线评测分数、线上抽样的 LLM 评分、用户点赞点踩都作为 score 写回 trace,点踩的 trace 进入每周错误分析;prompt 原文默认不采集,需要时先脱敏,数据存储位置符合合规要求。

</details>

## 明天预告

Day 35 · W5 复习 + 小项目:给工单 Agent 加评测集和 CI 回归门禁。这一周的东西零零散散写了不少:adapter、测试集、判题器、评分器、轨迹检查、tracing。明天把它们组装成一个完整的评测系统:一条命令跑完 L1 断言、L2 评分器和轨迹检查,输出带「新增通过 / 新增失败」的对比报告,再接进 GitHub Actions,改了 prompt 的合并请求自动跑评测,分数掉了就不让合并。
