---
title: 'Day 147 · 托管 Agent 运行时:Claude/Gemini Managed Agents、Bedrock AgentCore,自建还是租'
description: '2026 年各家厂商开始出租整套 Agent 运行时:循环、沙箱、会话、记忆、观测都替你托管。今天把 Claude Managed Agents、Gemini Managed Agents、Bedrock AgentCore 和国内几家对应产品放在一起看清楚各自托管了什么、怎么收钱,算一笔运行时成本账,再把 Day 23 的查账工具接到 Claude Managed Agents 上跑一遍,最后给一张「自建还是租」的决策表。'
pubDate: 2026-10-22
regime: none
tags: ['managed-agents', 'agentcore', 'deployment', 'build-vs-buy', 'cost', 'agent-60']
series: 'agent-60'
day: 147
lang: 'zh'
---

## 今天要解决的问题

这一篇是专题篇,**建议在 [Day 41 · 部署上线](/blog/agent-60/day-41-deploy/) 之后读**。Day 41 我们自己写 Dockerfile、自己配 Compose、自己租服务器,把 Agent 跑成了一个公网服务。那条路线有一个前提:循环是你写的,工具是你执行的,会话存在你自己的 Postgres 里,沙箱是你自己起的 Docker。

2026 年这个前提开始松动。Anthropic 在 4 月放出 Claude Managed Agents 公测,Google 在 5 月给 Gemini API 加了 Managed Agents 预览,AWS 的 Bedrock AgentCore 在 Runtime 之外又加了一个托管的 harness,微软 Foundry 的 Hosted Agents 也在年中正式可用。国内阿里云函数计算有 AgentRun,火山引擎有 AgentKit,腾讯云有 Agent Runtime。它们卖的东西大同小异:你给一份配置(模型、系统提示词、工具、技能),它们给你一个能跑几个小时、有沙箱、有会话历史、能断点续上的 Agent。

面试里这个话题会以两种形式出现。一种是「你们为什么不用 XX Managed Agents,要自己写」,另一种是系统设计题里面试官问「这部分你打算自建还是用云厂商的」。答「看情况」是不够的,你得说清楚看什么情况。

学完今天你应该能:

1. 说清楚一个 Agent 运行时由哪几层组成,托管服务各自替你接走了哪几层。
2. 列出 2026 年 10 月主要托管运行时的计费方式,并用一段脚本算出「运行时这一层」每月多少钱,和模型 token 费比一比。
3. 把 Day 23 的 CloudLedger 查账工具通过 custom tool 接到 Claude Managed Agents 上,业务库不出本机。
4. 从锁定、可观测、数据合规、调试控制四个方面比较自建和托管,写出一张能拿去和老板讨论的决策表。

预计用时 3–4 小时。没有海外 API key 的话,第 3 条可以只读代码不跑,其他几条都能在本地完成。前置:Day 23 的 `w4/cloudledger/server.py` 和 `cloudledger.db`,Day 41 的部署经验。

## 托管运行时到底托管了什么

先把一个能上线的 Agent 拆开看。Day 9 我们手写的循环只有一百行,但真要给很多人用,它下面会长出一堆东西:跑工具代码的沙箱,存会话历史和中间文件的地方,上下文快满时的压缩,掉线后的恢复,每一步的 trace,密钥怎么给工具又不让模型看见,还有谁能调这个 Agent 的鉴权。Day 62 讲 harness 设计时,我们把这些统称为 harness。

托管运行时就是把这些层打包出租。区别在于每家接走的层不一样多:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="自建和托管运行时的分层对比">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="120" y="24" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">自建(Day 41)</text>
  <text x="440" y="24" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">托管运行时</text>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="30" y="40" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="120" y="60" text-anchor="middle" fill="var(--ink)">业务工具 / 业务库</text>
    <rect x="30" y="76" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="120" y="96" text-anchor="middle" fill="var(--ink)">Agent 循环(你写的)</text>
    <rect x="30" y="112" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="120" y="132" text-anchor="middle" fill="var(--ink)">上下文压缩 / 缓存</text>
    <rect x="30" y="148" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="120" y="168" text-anchor="middle" fill="var(--ink)">会话存储 / 恢复</text>
    <rect x="30" y="184" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="120" y="204" text-anchor="middle" fill="var(--ink)">代码沙箱</text>
    <rect x="30" y="220" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="120" y="240" text-anchor="middle" fill="var(--ink)">trace / 鉴权 / 密钥</text>

    <rect x="350" y="40" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="440" y="60" text-anchor="middle" fill="var(--ink)">业务工具 / 业务库</text>
    <rect x="350" y="76" width="180" height="174" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="440" y="110" text-anchor="middle" fill="var(--ink)">循环</text>
    <text x="440" y="134" text-anchor="middle" fill="var(--ink)">压缩 / 缓存</text>
    <text x="440" y="158" text-anchor="middle" fill="var(--ink)">会话 / 恢复</text>
    <text x="440" y="182" text-anchor="middle" fill="var(--ink)">沙箱</text>
    <text x="440" y="206" text-anchor="middle" fill="var(--ink)">trace / 密钥</text>
    <text x="440" y="236" text-anchor="middle" fill="var(--ink-soft)">厂商按配置运行</text>
    <line x1="540" y1="55" x2="580" y2="55" stroke="var(--rule)"/>
    <text x="586" y="59" fill="var(--ink-soft)">仍是你的</text>
    <line x1="540" y1="160" x2="580" y2="160" stroke="var(--rule)"/>
    <text x="586" y="164" fill="var(--ink-soft)">租来的</text>
  </g>
  <text x="320" y="282" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">琥珀色是你自己维护的部分,蓝色是交给厂商的部分</text>
</svg>
<figcaption>自建时六层都归你;托管运行时把中间那一大块接走,业务工具和业务数据一般还留在你这边,通过 custom tool 或 MCP 接回去。</figcaption>
</figure>

左边这列在 Day 36 到 Day 42 我们一层层搭过,知道每层大概要花多少工夫。右边那块蓝色的,就是厂商要收钱的部分。有一点要先说清楚:托管运行时不替你写业务工具,也不替你做评测。Day 29 到 Day 35 那一整套 eval、Day 39 的注入测试,换到托管运行时上一样要做,而且因为循环不在你手里,有些测试反而更难做,后面会讲。

还有一个容易混的概念。「托管模型」和「托管运行时」不是一回事。你调 DeepSeek 或 Claude 的 Messages API,模型是托管的,但循环在你代码里跑,每一轮都是你把 messages 发过去。托管运行时是连循环一起托管:你发一句用户消息,对方自己调模型、调工具、写文件,跑十几轮之后告诉你「我做完了」,中间你只是看事件流。

## 2026 年 10 月,几家都卖什么

下面是我 2026 年 10 月查官方文档整理的。这些产品大多还在 beta 或预览,半年后很可能变样,用之前请回到链接里再核一遍。

**Claude Managed Agents**(Anthropic,beta)。核心概念四个:Agent(模型、系统提示词、工具、MCP server、skills 的一份配置,可以版本化)、Environment(会话跑在哪:Anthropic 托管的云沙箱,或者你自己基础设施上的自托管沙箱)、Session(一次运行)、Events(你和 Agent 之间来回的消息,走 SSE)。内置工具有 bash、文件读写编辑、glob、grep、web fetch、web search,全部在沙箱里执行;你自己的工具用 custom tool 声明,调用时会话暂停,等你的代码把结果送回去。所有请求要带 `managed-agents-2026-04-01` 这个 beta 头,SDK 会自动加。计费两部分:token 按正常 API 价格,外加会话运行时每小时 0.08 美元,**只在会话处于 running 状态时计时**,等你回复、等工具确认的 idle 时间不算。官方文档还写明,因为会话历史和沙箱状态存在服务端,它目前**不能用零数据保留(ZDR),也不在 HIPAA BAA 覆盖范围内**。

**Gemini Managed Agents**(Google,公开预览)。一次 Interactions API 调用就开一个 Google 托管的 Linux 沙箱,在里面跑一个预置的 Antigravity agent。官方快速入门里的 agent id 是 `antigravity-preview-09-2026`,传 `environment="remote"` 就会新开一个沙箱,返回的 `environment_id` 下次传回去可以复用同一个沙箱里的文件。它支持用 `AGENTS.md` 和 skills 目录定制行为,这和 Day 131 讲的 Agent Skills 是同一套东西。我查到的说法是预览期沙箱算力不收费、模型 token 照收,但这一条要以 Google 当时的定价页为准。

**Amazon Bedrock AgentCore**(AWS)。它拆得最细:Runtime(按会话隔离的 microVM,框架不限,LangGraph、OpenAI Agents SDK、Google ADK 都能放进去)、Harness(托管的循环,声明模型、工具、skills 就能跑,官方文档写明已经 GA 且不单独收费,底层是 AWS 开源的 Strands Agents)、Gateway(把现有 API 和 Lambda 包成 MCP 工具)、Memory、Identity、Code Interpreter、Browser、Observability、Policy、Evaluations,最近还加了 Payments 和 Registry。Runtime 的价格是我从官方定价页抄的:v1 每 vCPU 小时 0.0895 美元、每 GB 小时 0.00945 美元,**等模型、等工具返回的 I/O 等待期间 CPU 不计费,内存则从 microVM 就绪一直算到会话结束**;v2 按量价是每 vCPU 小时 0.1276 美元、每 GB 小时 0.0169 美元。据第三方 FactualMinds 报道 v2 在 2026 年 9 月 GA、冷启动明显变快,这一点我没在官方公告里核实到。

**Microsoft Foundry Hosted Agents**。2026 年 4 月公开预览,年中 GA(Azure Updates 和 Foundry 博客给的日期不一致,一个说 6 月、一个说 7 月 9 日)。每个会话一个隔离沙箱,接 Entra 身份和 VNet,支持 Responses API 协议。

**Vertex AI Agent Engine**(Google Cloud)。和 Gemini Managed Agents 不是一个产品:Agent Engine 是「你写好的 Agent 部署上去」,更接近 AgentCore Runtime。它的 Sessions、Memory Bank、Code Execution 从 2026 年 1 月 28 日起开始收费(官方 release notes)。

**国内**。阿里云函数计算在 2025 年 12 月发布了 AgentRun,定位是 Agent 的一站式基础设施,提供 Code Interpreter、Browser、All In One 几种沙箱,计费按实例忙闲分开算,闲置时只收很少的内存费(这是阿里云云原生团队文章里的说法)。火山引擎 AgentKit 里有一个全托管的 Runtime,文档说支持任意框架和语言写的 Agent。腾讯云的 Agent Runtime 按量后付费,按秒计 CPU 和内存。这三家我都只读了文档和官方技术文章,没有实际开通。

把它们按「托管到哪一层」排一下,比按厂商排更有用:

| 托管程度 | 你给什么 | 代表 | 适合 |
| --- | --- | --- | --- |
| 只托管沙箱 | 你自己的循环,需要跑代码时调沙箱 API | E2B、AgentCore Code Interpreter、AgentRun 沙箱 | 循环要自己掌控,只是不想自己维护代码隔离 |
| 托管运行环境 | 一个打包好的 Agent(容器或代码) | AgentCore Runtime、Vertex Agent Engine、Foundry Hosted Agents、火山 AgentKit Runtime | 已经用 LangGraph 写好了,想要隔离、伸缩、长任务 |
| 托管整个 harness | 一份配置:模型、提示词、工具、skills | Claude Managed Agents、Gemini Managed Agents、AgentCore Harness | 通用的「能写代码、能查资料、能操作文件」型任务,不想写循环 |

注意 Day 40 讲沙箱时我们只用到了第一行。SupportPilot 那种客服 Agent 最自然的是第二行。第三行最省事,代价是循环里发生什么你只能通过事件流去看,改不了。

## 钱怎么算:运行时那层通常不是大头

很多人第一反应是「托管肯定贵」。我们把账算一下,而且只算运行时这一层,模型 token 费单独列,因为不管选哪条路,模型调用都要付钱。

```python
# agent-60-lab/topics/managed-runtimes/cost_compare.py
"""只比「运行时这一层」每月花多少钱:模型 token 费三条路线都要付,单独列出来,不混进比较。
单价是 2026-10 从官方定价页抄的,用之前自己再核一遍。"""
from dataclasses import dataclass


@dataclass
class Workload:
    tickets_per_day: int = 300      # 每天处理多少张工单
    running_min: float = 1.5        # 每张工单 Agent 真正在干活的分钟数(模型推理+工具执行)
    session_min: float = 8.0        # 每个会话从创建到结束的总分钟数(含等客户回复、等审批)
    vcpu: float = 1.0               # 自托管容器/微虚拟机给几个核
    mem_gb: float = 2.0
    tokens_in: int = 30_000         # 每张工单的输入 token(多轮累计)
    tokens_out: int = 2_000


def monthly(w: Workload) -> dict[str, float]:
    n = w.tickets_per_day * 30
    # Claude Managed Agents:只按 running 状态计时,$0.08 / session-hour
    claude_runtime = n * w.running_min / 60 * 0.08
    # AgentCore Runtime v1:CPU 只算活跃时间,内存按整个会话算(I/O 等待时 CPU 不计费)
    agentcore_runtime = n * (w.running_min / 60 * w.vcpu * 0.0895 + w.session_min / 60 * w.mem_gb * 0.00945)
    # 自建:一台 2 核 4G 海外 VPS(Day 41 的价位),再加一台备机
    self_host = 2 * 10.0
    # 模型费三条路线都要付。这里按 Claude Sonnet 5.5 的 $2 / $10 每百万 token 算,不考虑缓存
    model = n * (w.tokens_in * 2 + w.tokens_out * 10) / 1_000_000
    return {"claude_runtime": claude_runtime, "agentcore_runtime": agentcore_runtime,
            "self_host_vps": self_host, "model_tokens": model}


if __name__ == "__main__":
    for label, w in [("每天 300 张", Workload()), ("每天 3000 张", Workload(tickets_per_day=3000)),
                     ("每天 300 张,长任务 20 分钟", Workload(running_min=20, session_min=30))]:
        m = monthly(w)
        print(f"{label}:", ", ".join(f"{k}=${v:,.2f}" for k, v in m.items()))
```

<div class="line-notes">

- `"""只比「运行时这一层」` 这段脚本只用标准库,复制下来直接 `uv run python topics/managed-runtimes/cost_compare.py` 就能跑,不调任何 API。
- `@dataclass` 把一组工作量参数打包成一个对象,改参数时只改一处。TS 里相当于一个带默认值的 interface 加构造函数。
- `running_min: float = 1.5` 这是最关键的参数:**模型在推理、工具在执行**的时间。客服工单大部分时间在等客户回复,真正 running 的时间很短。默认 1.5 分钟是我拍的估计值,你要用自己 trace 里的数据替换。
- `session_min: float = 8.0` 会话从开到关的总时长。Claude 只按 running 收钱,用不到这个;AgentCore 的内存按整个会话收,用得到。
- `n = w.tickets_per_day * 30` 一个月的工单数。默认参数下 `n = 9000`。
- `claude_runtime = n * w.running_min / 60 * 0.08` 代入默认值:9000 × 1.5 ÷ 60 = 225 个 running 小时,× 0.08 = **18.00 美元**。
- `agentcore_runtime = n * (` CPU 部分:225 小时 × 1 核 × 0.0895 = 20.14;内存部分:9000 × 8 ÷ 60 = 1200 会话小时 × 2 GB × 0.00945 = 22.68。合计 **42.82 美元**。内存按整段会话算,所以会话越长越吃亏。
- `self_host = 2 * 10.0` Day 41 说过海外 2 核 4G 的 VPS 每月 5 到 10 美元,这里取 10 美元并留一台备机,20 美元。**它没算你自己维护沙箱、做恢复和监控的人力**,这是自建真正的成本。
- `model = n * (w.tokens_in * 2 + w.tokens_out * 10) / 1_000_000` 9000 × (30000 × 2 + 2000 × 10) ÷ 1000000 = **720 美元**。Sonnet 5.5 的价格是 2026-10 Anthropic 定价页上的 $2 输入、$10 输出每百万 token。
- `for label, w in [` 三种场景:默认、量放大十倍、单张工单真正干活 20 分钟的长任务(比如让 Agent 在沙箱里跑一份对账脚本)。
- `print(f"{label}:"` 实跑输出见下面。`:,.2f` 是千分位加两位小数。

</div>

实跑输出:

```text
每天 300 张: claude_runtime=$18.00, agentcore_runtime=$42.82, self_host_vps=$20.00, model_tokens=$720.00
每天 3000 张: claude_runtime=$180.00, agentcore_runtime=$428.17, self_host_vps=$20.00, model_tokens=$7,200.00
每天 300 张,长任务 20 分钟: claude_runtime=$240.00, agentcore_runtime=$353.55, self_host_vps=$20.00, model_tokens=$720.00
```

三行数字说明了几件事。第一,客服这种「短时间干活、长时间等人」的负载,运行时费用只有模型费的百分之几,纠结运行时贵不贵意义不大,该花心思的是 Day 38 讲的 prompt caching 和模型路由。第二,自建 VPS 的账面最便宜,而且量越大差距越大,但那 20 美元背后是你自己维护的沙箱、会话恢复、扩容和半夜的告警,在一个两三个人的小团队里,这部分人力折成钱远远超过一两百美元。第三,长任务会把运行时费用拉上来,到了每张工单真跑 20 分钟这种量级,运行时就不能忽略了。

这里也能看出两家计费口径的差别。Claude 只算 running,所以「会话开着等人」几乎不花钱;AgentCore Runtime 的 CPU 在 I/O 等待时不算,但内存一直算到会话结束,所以它更怕会话挂着不关。用 AgentCore 时记得及时结束会话,v2 文档还写了闲置 120 秒后会自动回收内存。

## 真正要比的四件事

钱不是主要矛盾,那主要矛盾是什么。我跟几个在用和放弃了托管运行时的团队聊过,总结下来是四件事。

**锁定**。托管 harness 的配置格式、事件类型、会话 API 全是厂商自己的。Claude Managed Agents 的事件叫 `agent.custom_tool_use`,Gemini 的叫 interaction step,AgentCore Harness 又是另一套。你写在这上面的东西,换厂商基本要重写。比较好的消息是工具层在收敛:三家都能接 MCP server,都支持 skills 目录或 `AGENTS.md`。所以一个降低锁定的办法是**把业务能力都做成 MCP server 和 skills**,运行时只是「谁来跑循环」,换厂商时业务那层不用动。Day 23 把 CloudLedger 包成 MCP server,现在看是一笔很值的投资。

还有一个现实例子值得记住:OpenAI 在 2025 年 10 月推出的 AgentKit 里有一个可视化的 Agent Builder,2026 年 6 月 OpenAI 通知开发者,Agent Builder 和平台上的 Evals 将在 2026 年 11 月 30 日停用,ChatKit 保留([OpenAI 弃用说明页](https://developers.openai.com/api/docs/deprecations)有迁移指引)。押注一个托管产品,要考虑它两年后还在不在。

**可观测**。托管 harness 的循环不在你手里,你看到的是它愿意给你的事件。Claude Managed Agents 会把会话事件持久化在服务端,可以完整拉取;AgentCore 每一步都进 CloudWatch,也支持导出 OpenTelemetry。但要把这些 trace 接进你自己的 Langfuse、跑 Day 33 那种轨迹评测,你得写适配代码把它们的事件格式转过来。如果你的评测体系很依赖「改一下循环里某一步,看分数变化」,托管 harness 会让你很难受,因为那一步不归你改。

**数据合规**。这一条在国内团队那里经常是一票否决。会话历史、沙箱里的文件、中间结果都存在厂商那边;Claude Managed Agents 官方文档明说不支持 ZDR,AgentCore 的文档也写着它可能存储你的内容来改进服务体验。海外厂商的服务在中国大陆不能直接合规使用,客户数据出境要过数据出境安全评估这类流程,Day 86 讲过。所以对国内业务,能选的托管运行时基本只有阿里云、火山、腾讯云这几家,或者用「托管 harness + 自托管沙箱」的混合形态,把代码执行和文件留在自己的机房里。Claude Managed Agents 的 Environment 就支持自托管沙箱,AgentCore Harness 也能自带容器镜像。

**调试和控制**。自建循环出问题,你可以打断点、加日志、改重试策略。托管 harness 出了问题,比如它在某一步压缩上下文时把关键信息丢了,你能做的是改系统提示词、调工具描述,然后祈祷。托管的好处是厂商替你做了很多你未必做得好的优化,比如 Claude Managed Agents 文档里提到的内置 prompt caching 和上下文压缩,Gemini Managed Agents 在约 135k token 时自动压缩;坏处是这些优化什么时候触发、怎么触发,你说了不算。

## 业务工具怎么接回来

托管 harness 最需要想清楚的设计点是:**业务数据要不要进厂商的沙箱**。客服 Agent 要查发票、查订阅,这些数据在你的数据库里。有三种接法:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="custom tool 的调用时序">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="30" y="16" width="160" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="110" y="36" text-anchor="middle" fill="var(--ink)">你的进程 + 业务库</text>
    <rect x="430" y="16" width="180" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="520" y="36" text-anchor="middle" fill="var(--ink)">托管会话(循环+模型)</text>
    <line x1="110" y1="46" x2="110" y2="246" stroke="var(--rule)"/>
    <line x1="520" y1="46" x2="520" y2="246" stroke="var(--rule)"/>
    <line x1="110" y1="74" x2="516" y2="74" stroke="var(--ink-soft)"/>
    <text x="300" y="68" text-anchor="middle" fill="var(--ink)">user.message「C007 发票付了吗」</text>
    <line x1="520" y1="112" x2="114" y2="112" stroke="var(--mem)"/>
    <text x="320" y="106" text-anchor="middle" fill="var(--ink)">agent.custom_tool_use list_invoices</text>
    <rect x="40" y="124" width="140" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="110" y="141" text-anchor="middle" fill="var(--ink)">本地查 SQLite</text>
    <line x1="110" y1="174" x2="516" y2="174" stroke="var(--compute)"/>
    <text x="300" y="168" text-anchor="middle" fill="var(--ink)">user.custom_tool_result(只回需要的字段)</text>
    <line x1="520" y1="212" x2="114" y2="212" stroke="var(--mem)"/>
    <text x="320" y="206" text-anchor="middle" fill="var(--ink)">agent.message + session.status_idle</text>
    <text x="320" y="240" text-anchor="middle" fill="var(--ink-faint)" font-size="11">会话在等结果时是 idle,不计运行时</text>
  </g>
</svg>
<figcaption>custom tool 的时序:模型在厂商那边决定要调哪个工具,真正的查询在你自己的进程里执行,只有返回的那几个字段离开你的机器。</figcaption>
</figure>

第一种是 **custom tool**:像上图那样,模型发出调用请求,会话暂停,你的代码执行完把结果发回去。数据库连接、密钥都在你这边,厂商只看到你返回的那段文本。这种最安全,代价是你的进程必须一直在线接事件。

第二种是 **MCP connector**:把 Day 23 的 server 用 Streamable HTTP 暴露到公网(加鉴权,Day 84 讲过 OAuth),在 Agent 配置里挂上这个 MCP server。厂商的循环直接调你的 MCP server,你不用常驻一个进程接事件,但你的 server 要能从公网访问。

第三种是**把数据放进沙箱**:上传文件或挂载存储,让 Agent 在沙箱里用 bash 和 Python 自己读。分析类任务(比如「把这个月 3000 张发票跑一遍对账」)这样最高效,但数据就进了厂商的存储。

客服场景我推荐第一种或第二种。练习里用第一种,因为它不需要公网地址,在笔记本上就能跑。

## 自建还是租:一张决策表

下面这张表是我会拿去和老板开会用的。每一行都问一个具体问题,答案指向哪边就记一分。

| 问题 | 偏向租 | 偏向自建 |
| --- | --- | --- |
| 任务形态 | 通用的写代码、查资料、处理文件,步骤开放 | 固定流程、强业务规则,像 SupportPilot 的分类→检索→起草 |
| 循环要不要改 | 用厂商默认的就行 | 要插自己的检查节点、审批、路由(Day 47 那种 LangGraph 图) |
| 数据能不能出境/出机房 | 能,或者只出脱敏后的字段 | 不能,或者合同明确禁止 |
| 团队里有没有人能维护沙箱和恢复 | 没有,或者不想花这个人力 | 有,而且已经有 Day 37、Day 65 那套持久化执行 |
| 模型选择 | 只用这家厂商的模型 | 要在 DeepSeek、通义、Claude 之间路由(Day 79、Day 83) |
| 评测要求 | 端到端结果对就行 | 要做步骤级的轨迹评测和 A/B |
| 时间 | 两周内要上线一个内部工具 | 这是公司的核心产品,要长期演进 |

一个很常见的结论是混合:**核心产品自建,内部提效工具租**。比如 SupportPilot 主流程自己写,但「每周把客服工单导出来做一次分析报告」这种活,直接丢给托管 harness,在沙箱里跑 Python 生成图表,写一份配置就完事。另一种混合是用 AgentCore Runtime、Vertex Agent Engine 这类「托管运行环境」:LangGraph 图还是你自己写的,只是把隔离、伸缩、长任务交出去。它在锁定和控制上的代价比托管整个 harness 小很多。

## 动手练习

**目标**:把 Day 23 的三个只读查账工具通过 custom tool 接到 Claude Managed Agents,问一个需要连查两次的问题,记录 token、运行时和花费,和你自建的版本对比。

**第 1 步:准备目录和依赖。** 在 `agent-60-lab` 根目录:

```bash
mkdir -p topics/managed-runtimes
uv add anthropic          # 我写这篇时是 2.1.0,Managed Agents 的接口在 client.beta 下面
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env
```

没有 Anthropic key 的话可以跳过第 3、4 步,把代码读懂就行,第 5 步的对比表照样能做一半。

**第 2 步:跑成本脚本。** 把上面的 `cost_compare.py` 放进 `topics/managed-runtimes/`,用你自己 Day 52 的 Langfuse 数据替换 `running_min`、`tokens_in`、`tokens_out` 三个参数,看运行时费用占模型费的比例。

**第 3 步:写桥接脚本。**

```python
# agent-60-lab/topics/managed-runtimes/managed_cloudledger.py
"""把 Day 23 的查账工具交给 Claude Managed Agents 用:循环、上下文、会话历史在 Anthropic 那边,
业务库留在你自己机器上,工具调用以 custom tool 的形式回到本地执行。"""
import json
import sys
from pathlib import Path
from typing import Any

from anthropic import Anthropic
from anthropic.types.beta import BetaManagedAgentsCustomToolParams
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "w4/cloudledger"))
from server import find_customer, get_subscription, list_invoices  # noqa: E402  # pyright: ignore[reportMissingImports]
from mcp.server.mcpserver.exceptions import ToolError  # noqa: E402

load_dotenv()  # 需要 ANTHROPIC_API_KEY
client = Anthropic()

LOCAL_TOOLS = {"find_customer": find_customer, "get_subscription": get_subscription, "list_invoices": list_invoices}


def custom(name: str, description: str, props: dict[str, Any], required: list[str]) -> BetaManagedAgentsCustomToolParams:
    return {"type": "custom", "name": name, "description": description,
            "input_schema": {"type": "object", "properties": props, "required": required}}


TOOLS = [
    custom("find_customer", "按邮箱、姓名、公司名或客户编号查客户,返回最多 5 条。查订阅和发票之前先用它拿 customer_id。",
           {"query": {"type": "string"}}, ["query"]),
    custom("get_subscription", "查客户当前订阅:套餐、计费周期、席位、状态、本期结束日。customer_id 形如 C007。",
           {"customer_id": {"type": "string"}}, ["customer_id"]),
    custom("list_invoices", "列出客户最近的发票,金额单位元。status 可选 paid/open/void/refunded。",
           {"customer_id": {"type": "string"}, "status": {"type": "string"}}, ["customer_id"]),
]


def run_local(name: str, args: dict[str, Any]) -> tuple[str, bool]:
    try:
        return json.dumps(LOCAL_TOOLS[name](**args), ensure_ascii=False), False
    except ToolError as e:
        return str(e), True


def main(question: str) -> None:
    agent = client.beta.agents.create(
        name="cloudledger-support",
        model="claude-sonnet-5-5",
        system="你是云簿 CloudLedger 的客服助手。先用工具核实,再用中文回答,金额写元。不确定就说不确定。",
        tools=TOOLS,  # 没挂 agent_toolset:这个客服用不到 bash 和文件读写
    )
    env = client.beta.environments.create(
        name="cloudledger-env",
        config={"type": "cloud", "networking": {"type": "limited"}},  # 不列 allowed_hosts:沙箱不出网
    )
    session = client.beta.sessions.create(
        agent=agent.id, environment_id=env.id, title=question[:40],
        budget={"type": "limit", "max_list_cost": {"amount": "50", "currency": "USD"}},  # 单个会话最多花 0.5 美元
    )
    with client.beta.sessions.events.stream(session.id) as stream:
        client.beta.sessions.events.send(
            session.id, events=[{"type": "user.message", "content": [{"type": "text", "text": question}]}],
        )
        for event in stream:
            match event.type:
                case "agent.custom_tool_use":
                    text, is_error = run_local(event.name, dict(event.input))
                    print(f"[本地执行 {event.name}({event.input}) -> {text[:60]}]")
                    client.beta.sessions.events.send(session.id, events=[{
                        "type": "user.custom_tool_result", "custom_tool_use_id": event.id,
                        "content": [{"type": "text", "text": text}], "is_error": is_error,
                    }])
                case "agent.message":
                    print("".join(b.text for b in event.content if b.type == "text"))
                case "session.status_idle" if event.stop_reason and event.stop_reason.type == "end_turn":
                    break
    s = client.beta.sessions.retrieve(session.id)
    print("usage:", s.usage.input_tokens, s.usage.output_tokens, s.usage.active_seconds, s.usage.list_cost)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "user007@example.com 这个客户最近三张发票都付了吗?")
```

<div class="line-notes">

- `"""把 Day 23 的查账工具` 我手上没有 Anthropic key,**这个文件没有连真实服务跑过**。我做过的验证:用 basedpyright 按 anthropic 2.1.0 的类型定义检查,0 个错误;`run_local` 那部分单独用本地 `cloudledger.db` 实跑过,结果写在下面几条里。
- `from anthropic.types.beta import BetaManagedAgentsCustomToolParams` SDK 给 custom tool 定义的类型。不标这个类型的话,`tools=TOOLS` 那一行在编辑器里会飘红:普通 `dict` 对不上 SDK 要的 `Tool` 联合类型。
- `sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "w4/cloudledger"))` `parents[2]` 是从这个文件往上两级的目录,也就是 `agent-60-lab/`。把 Day 23 的目录加进 import 搜索路径,下一行才 import 得到 `server`。
- `from server import find_customer, get_subscription, list_invoices` Day 23 的 `@mcp.tool()` 装饰器注册完工具后返回的还是原函数,所以可以当普通函数直接调。行尾的 `pyright: ignore` 是因为编辑器的类型检查不知道运行时改了 `sys.path`,不加会飘红。
- `from mcp.server.mcpserver.exceptions import ToolError` Day 23 的工具查不到数据时抛这个异常,下面要接住它。
- `client = Anthropic()` 读环境变量 `ANTHROPIC_API_KEY`。没有 key 时这一行就会报错,所以想只测 `run_local` 的话,可以先设一个假的 key。
- `LOCAL_TOOLS = {` 工具名到本地函数的映射。托管会话只知道名字,执行时我们按名字查表。
- `def custom(` 拼一个 custom tool 定义的小函数。结构和 Day 8 的 function calling 工具定义几乎一样,只是外面多了 `"type": "custom"`。
- `custom("find_customer",` 描述是从 Day 23 的 docstring 改写的。托管 harness 里工具描述一样决定模型会不会用对,Day 11 的规则全部适用。
- `def run_local(` 真正执行工具的地方。实跑 `run_local('find_customer', {'query': 'user007@example.com'})` 返回 `('[{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"}]', False)`。
- `return json.dumps(LOCAL_TOOLS[name](**args), ensure_ascii=False), False` `**args` 把字典展开成关键字参数。`ensure_ascii=False` 让中文原样输出,不变成 `刘` 这种转义,省 token 也方便看日志。
- `except ToolError as e:` 实跑 `run_local('get_subscription', {'customer_id': 'C999'})` 返回 `('客户 C999 没有订阅记录。确认编号是否来自 find_customer 的结果。', True)`,第二个值 `True` 会作为 `is_error` 告诉模型这次调用失败了。
- `agent = client.beta.agents.create(` 建一个 Agent 配置。真实项目里这个只建一次,把 `agent.id` 存下来,每次开会话时引用;这里为了练习方便每次都新建。
- `model="claude-sonnet-5-5",` 客服问答用 Sonnet 足够,Opus 5.5 的单价是它的两倍。
- `tools=TOOLS,` 只挂了我们的三个 custom tool,没挂 `agent_toolset_20260401`,所以 Agent 没有 bash 和文件工具。**托管 harness 默认能力很强,给客服用要主动收窄**,这是 Day 40 最小权限原则在托管场景下的样子。
- `env = client.beta.environments.create(` 每个会话都跑在某个 Environment 里,哪怕我们用不到沙箱里的工具也得建一个。
- `config={"type": "cloud", "networking": {"type": "limited"}},` `limited` 网络模式下只能访问 `allowed_hosts` 里列出的域名,这里一个都没列,沙箱等于断网。
- `session = client.beta.sessions.create(` 开一次运行。
- `budget={"type": "limit", "max_list_cost": {"amount": "50", "currency": "USD"}},` anthropic 2.1.0 的类型定义里,`sessions.create` 有一个 `budget` 参数:累计的标价花费达到上限后,会话不再发新的模型请求。金额用「美分」写成字符串,`"50"` 就是 0.5 美元。Day 53 讲公网 demo 防滥用时说的「花费上限」,在这里一个参数就有了。
- `with client.beta.sessions.events.stream(session.id) as stream:` **先打开事件流,再发消息**。官方文档特别强调了这个顺序:流只推送打开之后发生的事件,反过来写可能漏掉开头几个事件。
- `client.beta.sessions.events.send(` 发一条用户消息,会话从 idle 变成 running。
- `case "agent.custom_tool_use":` 模型决定调我们的工具时收到这个事件,`event.name` 是工具名,`event.input` 是参数,`event.id` 是回传结果时要用的编号。
- `text, is_error = run_local(event.name, dict(event.input))` 在本地执行。以默认问题为例,大概率先调 `find_customer` 拿到 C007,再调 `list_invoices`;实跑本地 `list_invoices('C007', status='paid')` 第一条是 `INV-2026-0123`,2392.00 元,10 月 8 日开票当天付款。
- `"type": "user.custom_tool_result", "custom_tool_use_id": event.id,` 把结果送回去。文档说可以收到调用事件就立刻回,不用等后面那个 `requires_action` 的 idle 事件。
- `case "agent.message":` 模型说的话。`event.content` 是一组内容块,这里只取文本块拼起来打印。
- `case "session.status_idle" if event.stop_reason and event.stop_reason.type == "end_turn":` 会话空闲有两种原因:`requires_action`(等你回工具结果或确认)和 `end_turn`(这一轮答完了)。只有后者才退出循环,前者我们已经在上面那个分支处理了。
- `s = client.beta.sessions.retrieve(session.id)` 会话结束后取回统计。
- `print("usage:", s.usage.input_tokens,` SDK 类型里 `usage` 有输入/输出 token、缓存读取、`active_seconds`(running 的秒数)和 `list_cost`(按标价算的花费)。把这几个数抄进第 5 步的对比表。

</div>

**第 4 步:跑起来。**

```bash
uv run python topics/managed-runtimes/managed_cloudledger.py
uv run python topics/managed-runtimes/managed_cloudledger.py "C012 的订阅什么时候到期?下一张发票多少钱?"
```

输出大致长这样:先是一两行 `[本地执行 find_customer(...) -> ...]`、`[本地执行 list_invoices(...) -> ...]`,然后是模型的中文回答,最后一行 `usage:` 后面跟着 token 数、秒数和花费。具体内容取决于模型怎么调工具,我没有实跑,不给你编数字。

**第 5 步:和自建版对比。** 用 Day 14 的 CLI Agent 或者 Day 23 的 `mcp_agent.py`,问同样两个问题,把下面这张表填满:

| 指标 | 自建(DeepSeek + Day 23) | Claude Managed Agents |
| --- | --- | --- |
| 工具调用次数 | | |
| 输入 / 输出 token | | |
| 端到端耗时(秒) | | |
| 本次花费 | | |
| 回答是否正确(对照 cloudledger.db) | | |
| 写了多少行胶水代码 | | |
| 出错时你能看到什么 | | |

**第 6 步(可选):换成 Gemini 或 AgentCore。** Gemini Managed Agents 的最小调用只有几行,官方快速入门里是这样:

```python
# agent-60-lab/topics/managed-runtimes/gemini_hello.py
from google import genai

client = genai.Client()  # 读 GEMINI_API_KEY
interaction = client.interactions.create(
    agent="antigravity-preview-09-2026",
    input="写一个 Python 脚本,生成前 20 个斐波那契数,存成 fibonacci.txt,再读出来打印。",
    environment="remote",
)
print(interaction.environment_id)
print(interaction.output_text)
```

<div class="line-notes">

- `from google import genai` Google 的 `google-genai` SDK。代码照抄自官方 Managed agents quickstart(2026-10 查),我没有实跑。
- `agent="antigravity-preview-09-2026",` 预置的通用 agent,名字里带 preview 和年月,说明它会更新换代,升级时要改这里。
- `environment="remote",` 每次传 `"remote"` 都新开一个沙箱;想在同一个沙箱里接着干活,把上一次返回的 `environment_id` 传进来,对话则用 `previous_interaction_id` 接上。
- `print(interaction.output_text)` 最终回答。中间每一步(推理、工具调用、代码执行)在 `interaction.steps` 里。

</div>

AgentCore 的入门是 `npm i -g @aws/agentcore` 装命令行工具,`agentcore create` 生成项目,`agentcore deploy` 部署,入口函数用 `bedrock_agentcore` 包里的 `BedrockAgentCoreApp` 加 `@app.entrypoint` 装饰器。这是官方 SDK 仓库 README 里的流程,需要 AWS 账号。

**国内路线**:如果你的业务在国内,把第 3 步换成阿里云函数计算 AgentRun 或火山引擎 AgentKit 的快速入门,对比表照样填。

**验收标准**:

1. `cost_compare.py` 用你自己的 trace 数据跑过,能说出运行时费用占模型费用的百分比。
2. 能画出 custom tool 的事件时序,说清楚哪一步数据离开了你的机器。
3. 第 5 步的对比表至少填完自建那一列;有 key 的话两列都填完。
4. 针对 SupportPilot,写一段 200 字以内的「自建还是租」结论,至少引用决策表里的三行。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 托管运行时(managed runtime) | 厂商替你运行 Agent 的基础设施,包括隔离环境、伸缩、会话存储,有的还包括循环本身 |
| harness | 循环、工具执行、上下文管理、沙箱、会话、观测这一整套让 Agent 跑起来的东西,Day 62 详细讲过 |
| Claude Managed Agents | Anthropic 的托管 harness,2026 年 4 月起公测,按 token 加 running 时长收费 |
| Session(会话) | 一次 Agent 运行实例,有自己的状态(running、idle、rescheduling、terminated)和事件历史 |
| Environment | Claude Managed Agents 里定义会话跑在哪的配置:厂商托管的云沙箱,或者自托管沙箱 |
| custom tool | 由你的代码执行的工具。模型发出调用请求,会话暂停等你回结果,数据不进厂商沙箱 |
| microVM | 轻量虚拟机(如 Firecracker),比容器隔离更强、比普通虚拟机启动更快,AgentCore 每个会话一个 |
| AgentCore Harness | AWS 托管的 Agent 循环,声明式配置,底层是开源的 Strands Agents,不单独收费 |
| 零数据保留(ZDR) | 厂商承诺不在服务端保存请求和响应内容的合规选项,有状态的托管会话目前大多不支持 |
| 锁定(vendor lock-in) | 系统深度依赖某厂商的私有接口,换厂商成本很高 |

## 常见误区

**「托管运行时一定比自建贵。」** 算一下就知道,短任务负载里运行时费用只有模型费的百分之几。真正贵的是锁定和失去控制,不是那每小时几美分。

**「上了托管 harness 就不用做评测了。」** 恰恰相反。循环不在你手里,厂商的 harness 升级一次,行为就可能变。你更需要一套固定的回归评测集,每次厂商更新都跑一遍。

**「托管运行时帮我解决了安全问题。」** 它解决的是隔离:你的沙箱代码伤不到别人,别人的也伤不到你。prompt injection、工具权限过大、数据外发这些 Agent 层面的问题(Day 39、Day 40)一个都没少。Claude Managed Agents 默认的工具集包括 bash 和 web fetch,不收窄就直接给客服用,风险比自建版还大。

**「Gemini Managed Agents 和 Vertex Agent Engine 是一个东西。」** 不是。前者是 Gemini API 里的托管 harness,一次调用跑一个预置 agent;后者是 Google Cloud 上部署你自己写好的 Agent 的运行环境。AWS 那边同理,AgentCore Harness 和 AgentCore Runtime 是两个产品。

**「用托管就不用关心会话什么时候结束。」** AgentCore 的内存从会话就绪算到结束,会话挂着不关一直在花钱。Claude 只算 running,但会话历史一直存在服务端,涉及个人信息的要按 Day 86 的保留期限主动删除。

## 学习资料

### 文档与文章

- [Claude Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview):先看四个核心概念和「When to use」那一节,再看 Beta access 里关于 ZDR 的说明,20 分钟。
- [Claude Managed Agents quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart):建 Agent、Environment、Session、收事件流的完整代码,对照今天的练习读,30 分钟。
- [Anthropic 定价页的 Managed Agents 部分](https://platform.claude.com/docs/en/about-claude/pricing):看「Claude Managed Agents pricing」和那两个算例,10 分钟。
- [Gemini API · Managed agents quickstart](https://ai.google.dev/gemini-api/docs/managed-agents-quickstart):看 environment 复用和保存自定义 agent 那两段,20 分钟。
- [Amazon Bedrock AgentCore 是什么](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html):一张表列全了它的十几个服务,先看懂每个服务管哪一层,20 分钟。
- [AgentCore harness](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/harness.html):AWS 自己怎么定义 harness、为什么要托管它,开头两段写得很清楚,15 分钟。
- [AgentCore 定价](https://aws.amazon.com/bedrock/agentcore/pricing/):重点看 Runtime 的 I/O 等待和内存计费规则,15 分钟。
- [阿里云 AgentRun 发布公告](https://cn.aliyun.com/product/news/28237):国内对应产品的定位,5 分钟;技术细节可以接着看阿里云开发者社区的[《探秘 AgentRun》](https://developer.aliyun.com/article/1707976)。
- [腾讯云 Agent Runtime 计费模式](https://cloud.tencent.com/document/product/1814/133249):国内按秒计费的一个例子,5 分钟。

### B 站视频

- 豚工智能《[中配] 什么是Claude Managed Agents?》:Anthropic 官方介绍视频的中文配音版,7 分钟,适合先建立整体印象。
- 李哈利Harry《Claude Managed Agents 完全指南!》:13 分钟的上手演示,标题有点夸张,看他建 Agent、开会话那一段就行。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ruDdBHErG&autoplay=0&high_quality=1" title="[中配] 什么是Claude Managed Agents?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>豚工智能 · [中配] 什么是Claude Managed Agents? · 7 分钟,官方视频中配,讲清楚 Agent、Environment、Session 三个概念。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1sRQpBvEP8&autoplay=0&high_quality=1" title="Claude Managed Agents 完全指南" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>李哈利Harry · Claude Managed Agents 完全指南 · 13 分钟,看控制台操作和事件流,宣传性的部分可以跳过。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/NLWiIj47IdI" title="What is Claude Managed Agents?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Claude · What is Claude Managed Agents? · 官方英文原版,和上面的中配版二选一。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hcm5zIWASCM" title="What is an Agent Harness? (And How We Built One)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AWS Developers · What is an Agent Harness? (And How We Built One) · AWS 团队讲他们为什么把 harness 做成托管服务,适合和 Day 62 对照看。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 10 章「AI Engineering Architecture and User Feedback」前半部分,讲一个 AI 应用从最简单的架构一步步加组件,读完你会对「哪些组件值得外包」有更好的直觉,1 小时。英文原版。
- Michael Albada《Building Applications with AI Agents》(O'Reilly, 2025):讲单 Agent 和多 Agent 系统的设计取舍,挑部署和生产化相关的章节读。我没能看到完整目录,按目录自己挑。英文原版。

### 开源项目与代码

- [aws/bedrock-agentcore-sdk-python](https://github.com/aws/bedrock-agentcore-sdk-python):看 README 里 `BedrockAgentCoreApp` 的最小例子,理解「托管运行环境」要求你的代码长什么样,15 分钟。
- [anthropics/claude-quickstarts 的 managed-agents 目录](https://github.com/anthropics/claude-quickstarts/tree/main/managed-agents):官方给的几个完整应用,其中 CopilotKit 那个用 AG-UI 接前端,明天会讲到,30 分钟。
- [strands-agents/sdk-python](https://github.com/strands-agents/sdk-python):AgentCore Harness 的底层框架,想知道托管 harness 内部大概怎么写的,可以读它的 agent loop 部分,1 小时。

## 自测

**1. 托管模型 API 和托管运行时的区别是什么?**

<details><summary>答案</summary>

托管模型 API 只托管推理:每一轮由你的代码组 messages、调模型、执行工具,循环在你这边。托管运行时连循环、工具执行环境、会话状态一起托管,你发一条用户消息,它自己跑完多轮,你通过事件流看过程。

</details>

**2. 同样每天 300 张工单,为什么 AgentCore Runtime 的费用对「会话开多久」很敏感,而 Claude Managed Agents 不敏感?**

<details><summary>答案</summary>

AgentCore Runtime 的 CPU 在 I/O 等待时不计费,但内存从 microVM 就绪一直算到会话结束,会话挂得越久内存费越多。Claude Managed Agents 只按 running 状态计时,等用户回复和等工具确认的 idle 时间不收运行时费。

</details>

**3. 客服 Agent 要查你数据库里的发票,用托管 harness 时有哪几种接法?各自的数据边界在哪?**

<details><summary>答案</summary>

custom tool:模型发调用请求,你的进程执行查询,只把返回字段送回去,数据库和密钥不离开你的机器,但你的进程要常驻接事件。MCP connector:把 MCP server 暴露到公网让厂商直接调,不用常驻进程,但 server 要公网可达并做好鉴权。把数据放进沙箱:上传文件或挂存储,Agent 在沙箱里自己读,效率最高,数据进了厂商存储。

</details>

**4. 怎样降低对某一家托管 harness 的锁定?**

<details><summary>答案</summary>

把业务能力做成跨厂商通用的形态:工具做成 MCP server,领域知识做成 skills 或 `AGENTS.md`,评测集和运行时无关;托管 harness 只负责跑循环。换厂商时只需要改配置和事件处理那一层胶水代码。另外优先选「托管运行环境」(你自己的 LangGraph 图部署上去),比托管整个 harness 锁定小。

</details>

**5. 面试题:你们团队要做一个给内部运营用的「每周数据分析报告」Agent,还要做对外的智能客服。你会怎么选运行时?**

<details><summary>答案</summary>

分开选。周报 Agent 是内部工具,任务开放(读数据、写 Python、画图),对循环没有特殊要求,数据可以脱敏后进沙箱,适合直接租托管 harness,一两天就能上线,运行时按 running 计费也便宜。对外客服是核心产品,流程固定、要插审批和自检节点、要做轨迹评测和 A/B、要在多个模型间路由,而且客户数据合规要求高,应该自建循环;如果团队不想维护隔离和伸缩,可以把自己的 LangGraph 图部署到 AgentCore Runtime 或国内的同类服务上。最后补一句成本:两者的运行时费用都远小于模型 token 费,决策主要看控制力和合规,不看运行时单价。

</details>

**6. 国内业务想用托管运行时,要注意什么?**

<details><summary>答案</summary>

客户数据出境要走数据出境相关的合规流程,海外厂商的托管会话会把会话历史和沙箱文件存在境外,通常过不了。可选的是阿里云 AgentRun、火山引擎 AgentKit、腾讯云 Agent Runtime 这类国内服务,或者用「托管循环 + 自托管沙箱」的混合形态,把代码执行和文件留在自己的机房。同时要确认会话数据的保存期限和删除接口。

</details>

## 明天预告

专题篇可以跳着读,下一篇是 Day 148 · 生成式 UI:MCP Apps、A2UI、AG-UI 三条路线。今天的托管会话还是在命令行里打印文字,明天让 Agent 的工具直接在对话里渲染一张可以点的退款审批卡片,并且真的在一个 MCP host 里把它跑起来。
