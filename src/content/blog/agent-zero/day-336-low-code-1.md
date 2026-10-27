---
title: 'Day 336 · 低代码平台(一):Dify、扣子、百炼、n8n 现状,同一流程画 vs 写'
description: '国内招聘要求里 Dify、扣子出现得比 LangGraph 还勤。今天先把 Dify、扣子、百炼、n8n 在 2026 年 10 月的版本、协议、价格和最近的大变化查清楚,再把同一个工单分流流程写成 31 行 Python、在 n8n 里画成 10 个节点,各跑三张工单比耗时和 token,最后看画布导出的 JSON 在 git diff 里是什么样。'
pubDate: 2026-10-27
regime: none
tags: ['low-code', 'dify', 'n8n', 'python', 'agent-zero']
series: 'agent-zero'
day: 336
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 335](/blog/agent-zero/day-335-week48-review/) 是第 48 周的复习:把多 Agent 的取舍、三种拆法和七个框架放在一张图上,默写了主管派活和防踢皮球的交接,又写了个「拆不拆」小顾问。那一周所有东西都是手写的,最多用到 LangChain、OpenAI Agents SDK 这一层。

[Day 333](/blog/agent-zero/day-333-frameworks-1/) 画过一张五层图,最上面的第五层是「面向不写代码或少写代码的人」的平台,当时只说了一句不比较。今天和明天把它补上。原因很实际:你去翻国内的招聘要求,「熟悉 Dify、扣子等平台」出现得比 LangGraph 还频繁。面试官问到的时候,只说「低代码不如代码灵活」过不了关,他想听你真的搭过、知道它们现在到哪一步、知道它们在哪里会卡住你。

## 今天要解决的问题

学完今天,你要能做到:

1. 说出 Dify、扣子、阿里云百炼、n8n 在 2026 年 10 月各自的定位、最新版本、开源协议、一个最近的大变化,并分得清哪些是我对着官方页面核实的、哪些是媒体报道、哪些我没碰过。
2. 把「工单分流」(分类、按类别分支、起草回复)写成 31 行 Python,再在 n8n 里画成 10 个节点,两边各跑三张工单,比耗时和 token,并说清差别来自哪里。
3. 看懂画布的文件形态:导出的 JSON 长什么样,改一句提示词在 `git diff` 里和改 Python 有什么不同。
4. 说出平台会消失的三个真实例子(Flowise、OpenAI Agent Builder、OpenAI Evals),以及怎么给自己留退路。

预计用时 3.5 小时(装 n8n 的时间不算在内,我自己装了好几分钟,还失败过一次)。前置:[Day 333](/blog/agent-zero/day-333-frameworks-1/) 的五层图,[Day 334](/blog/agent-zero/day-334-frameworks-2/) 里提过的 OpenAI Agent Builder 弃用,[Day 280](/blog/agent-zero/day-280-mcp-seed/) 的 `cloudledger/seed.py`(今天要它造出来的 `cloudledger.db`),[Day 135](/blog/agent-zero/day-135-llm-client-1/) 的 `common/llm.py`,[Day 326](/blog/agent-zero/day-326-ambient-2/) 的 webhook。今天调模型的实跑,三张工单代码版约 0.002 元、n8n 版约 0.008 元,把开思考的对照和耗时脚本都跑一遍合计约 0.05 元(其中开思考的 `time_compare.py` 最贵,约 0.025 元),算式在对比表下面。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `triage()` 默写出来,再口头说一遍 n8n 那 10 个节点各自对应代码里的哪一段;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚:什么叫低代码平台

低代码平台(low-code platform)就是一个网页,你在上面用鼠标拖方块、连线,每个方块是一个步骤,整张图跑起来就是一个应用。前端同学可以把它想成 Figma 或 Webflow 的另一个版本:那两个是拖出页面,这类平台是拖出流程。这个方块叫节点(node),整张图叫工作流(workflow),你拖的那块区域叫画布(canvas)。

在 Agent 这个领域,每个节点通常是下面几种之一:调一次模型、调一个 HTTP 接口、判断一个条件走哪条分支、跑一小段代码、读知识库。画完点发布,平台给你一个网址(或者让你在聊天窗口里用),别的系统就能调它。

为什么值得花两天。我们在旧课 Day 140 里统计过 10 月抓的 881 条去重后的招聘正文,76 条点名了 Dify(约 9%),25 条提到扣子,18 条提到 n8n,而且 Dify 那 76 条里绝大多数是国内岗位。这是我们自己抓的样本,不是行业统计,但方向是清楚的:这些平台不是玩具,有公司拿它们做真东西。

我的立场放在前面。我见过两种极端:一种是工程师看不上拖拽;另一种是公司里有人用 Dify 拖了个客服机器人,老板觉得「这不是挺好的」,然后让它接住全部线上流量,半年后没人敢动它。平台和代码解决的是不同阶段的问题。需求没定、要先给业务方看效果,平台一下午能出一个能点的东西,代码要两三天。流程固定、一天几万条、出错要定位到哪一行,代码的优势就出来了。今天和明天的目标不是让你选边站,而是两边都能干活,并且知道边界在哪。

## 四个平台,2026 年 10 月的状态

这一节的数字都是 2026 年 10 月 27 日查的:GitHub 数据来自 GitHub 官方 API,价格来自各家官网当天的页面,媒体报道标明了是媒体。平台迭代很快,你读到的时候先去官方页面核对一遍。

| | Dify | 扣子(Coze) | 阿里云百炼 | n8n |
| --- | --- | --- | --- | --- |
| 是什么 | 开源的 LLM 应用开发平台 | 字节跳动的智能体平台 | 阿里云的模型服务平台,也能搭应用 | 通用工作流自动化工具,后来加了 AI 节点 |
| 最新版(10 月 27 日查) | 1.18.0(2026-10-23) | 云版持续更新;开源版 Coze Studio v0.5.1(2026-02-05) | 云服务,没有版本号 | 稳定版 2.44.7(2026-10-26) |
| GitHub | 约 16 万星 | Coze Studio 约 2.2 万星,最后一次提交 2026-07-29 | 不开源 | 约 20.9 万星 |
| 协议 | 修改版 Apache 2.0,加两条限制 | Coze Studio 是 Apache 2.0 | 商业云服务 | Sustainable Use License(源码公开,不是开源协议) |
| 自己部署 | Docker Compose,至少 2 核 4 GiB | Coze Studio,Docker,至少 2 核 4 GB | 不能 | Docker 或 npm,本机装法见后面 |
| 价格(官网) | 云版 Sandbox 免费;Professional $590/年/工作区;Team $1590/年/工作区 | 官方只列了版本名,我没查到价格数字 | 我没查价格 | 云版 Starter 20 欧/月、Pro 50 欧/月(按年付);自托管 Business 667 欧/月;Community 自托管页面没标价 |
| 我这次实际碰了没有 | 没有,本机没 Docker | 没有 | 没有 | 本机跑起来了 |

下面逐个说,每个只挑一件今年发生的、对你判断有用的事。

**Dify。** 10 月 23 日刚发的 1.18.0,发布说明开头列了四样:Agent 可以决定走哪个工作流分支(Output Routes)、整个应用能导出成一个 `.ifpkg` 包(连里面的 Agent 和 Skills 一起带走)、能点进嵌套工作流看子流程每一步、一个测试中的 Agent 知识库;命令行工具 `difyctl` 也在这版扩了,能从终端创建、导入导出、发布应用。更值得自部署的人读的是升级须知:API、worker、Agent Backend 和 Agent 运行环境的镜像要一起升;本地 Agent 沙箱必须配一个非空的认证 token;从源码装要 Python 3.13;`difyctl` 要重装并重新登录。再往前的 1.17.1 里还有一条:自带的 Weaviate 向量库从 1.27.0 一次跳到 1.39.2,中间不能跳版本,直接拉新镜像重启可能让向量检索永久坏掉。这是「自己部署一个平台」的真实成本:你得读它的升级说明,而不是 `npm update` 完事。

协议要读。Dify 的 LICENSE 原文是「在 Apache 2.0 基础上加了额外条件」:可以商用,可以当企业内部的应用开发平台;但没有书面授权不能用它的源码运营多租户服务(它把一个工作区算一个租户),也不能去掉前端的 logo 和版权信息。公司想基于 Dify 做一个卖给客户的 SaaS,先找法务。

**扣子。** 国内版在 coze.cn。据 IT 之家和虎嗅报道,**扣子 3.0 在 2026 年 6 月 1 日前后上线**,主打从「一个智能体」变成「人和多个智能体组成的团队」:一人加多 Agent、多人加多 Agent,还能把本地的 Claude Code、Codex CLI 接进同一个项目里。两家媒体对具体哪一天说法不一致(一家说 6 月 1 日的前两天发布,一家说 6 月 1 日上线),我没有拿到字节官方的公告原文,所以只写「6 月前后,据媒体」。开源的 Coze Studio 是另一条线:Apache 2.0,README 写明部分功能(比如 tone customization)只在商业版里。它的最新版是 2 月的 v0.5.1,最后一次提交是 7 月底,节奏明显比云版慢,3.0 的多智能体协作是云版的能力,别以为开源版里有。README 还专门警告:部署到公网要小心开放注册和工作流代码节点里能执行 Python。

扣子的 API 我对着官方文档核了:执行工作流是 `POST https://api.coze.cn/v1/workflow/run`,用 Bearer 访问令牌,`parameters` 是**序列化成字符串的 JSON**,返回的 `data` 通常也是字符串,要再解析一次;同步调用 90 秒收不到响应连接就断,工作流整体上限 10 分钟,官方建议控制在 5 分钟内;`is_async` 只对付费套餐开放,免费版传 true 会报 6003。这些在明天的评测脚本里都会用到。

**阿里云百炼。** 按官方文档,应用分三类:智能体(提示词驱动,自己决定调知识库、MCP 等工具)、工作流(可视化节点编排的固定流程)、高代码应用(用 Python 写后端再部署上去)。调用发布好的应用是 `POST https://dashscope.aliyuncs.com/api/v1/apps/{APP_ID}/completion`,用户那句话放在 `input.prompt`,工作流的自定义参数放在 `input.biz_params` 里,回答在 `output.text`。官方文档里还有一页「新版智能体应用 API」,讲 Agent 2.0:它把知识库统一成智能体可以自己调用的工具,`doc_references` 字段在新版里永远返回 `null`,想看引用来源要在应用配置里打开「展示回答来源」。调用工作流和新版智能体这两页都标了「仅适用于华北 2(北京)地域」。百炼的价值不在编排能力,在和阿里云生态挨得近:模型、知识库、MCP、计费都在一个控制台里。

**n8n。** 出身和前三个不一样:它是 Zapier 那一类的通用自动化工具,有大量现成的集成节点,AI 能力是后来加上去的,所以特别适合「触发,几个系统之间搬数据,中间某一步让模型判断」,和 [Day 325](/blog/agent-zero/day-325-ambient-1/) 的后台 Agent 是一个路数。官方 2.0 破坏性变更页列的几条,基本都是在收紧默认值:环境变量在代码节点里默认读不到(`N8N_BLOCK_ENV_ACCESS_IN_NODE` 默认 `true`),任务运行器默认开启,`Execute Command` 等节点默认禁用,「激活」改叫「发布」。协议是 Sustainable Use License:源码公开,自己公司内部用、自己部署都行,但不是 OSI 认可的开源协议,拿它做服务卖给别人不行;文件名带 `.ee.` 的企业功能要另外授权。

n8n 还有一条我在本机启动日志里亲眼看到的,下面装 n8n 那一节会贴原文:它说**不在容器里运行 n8n 已经被标成弃用,以后的版本会要求用官方 Docker 镜像**。

## 平台会没:三个今年的例子

平台风险不是理论。今年就有三个:

**Flowise**(另一个流行的拖拽式 LLM 应用工具)。官方的 sunset 页面写着:2026 年 7 月 29 日宣布代码冻结,8 月 10 日 GitHub 仓库转为公开归档,8 月 31 日核心团队退出。我用 GitHub API 查了,仓库现在确实是 `archived: true`,最后一个版本 3.1.4 是 7 月 29 日发的。代码还在,Apache 2.0,可以 fork,但不会再有安全补丁。

**OpenAI Agent Builder** 和 **OpenAI Evals 平台**。OpenAI 的弃用页上,这两条都是 2026 年 6 月 3 日宣布的:Agent Builder 11 月 30 日关停,官方给的去处是 Agents SDK 或 ChatGPT 的 Workspace Agents;Evals 平台 10 月 31 日起变成只读(也就是四天以后),11 月 30 日关停,迁移指南指向 Promptfoo。同一页明说 ChatKit 不在弃用之列。2025 年 10 月才推出的可视化搭建工具,一年不到就收了,而写在代码里的 SDK 留了下来。

这三件事给你的教训很具体:在平台上搭的东西要能导出,要进版本库,核心逻辑最好放在你自己的接口后面,平台只负责编排。这样平台没了,换一个编排层就行。今天的第二半场就是验证「能导出」到底导出来什么。

## 同一个流程,先写成代码

拿 CloudLedger 的一个真实需求来做:客服把一张工单的正文贴进来,系统给出类别;如果是钱相关的类别(退款、账单、开票),走「财务」那套回复提示词,其他走通用的;最后起草一段回复。流程图长这样:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="同一个工单分流流程的两种样子:左边是 n8n 画布上的七个方块,右边是代码里对应的四个函数,虚线连起对应关系">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <text x="150" y="20" fill="var(--ink-soft)">n8n 画布(10 个节点)</text>
    <rect x="12" y="34" width="96" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="60" y="53" fill="var(--ink)">Webhook</text>
    <rect x="12" y="84" width="96" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="60" y="103" fill="var(--ink)">Classify</text>
    <rect x="12" y="134" width="96" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="60" y="153" fill="var(--ink)">Parse category</text>
    <rect x="12" y="184" width="96" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="60" y="203" fill="var(--ink)">Finance?</text>
    <rect x="150" y="150" width="108" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="204" y="169" fill="var(--ink)">Reply (finance)</text>
    <rect x="150" y="198" width="108" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="204" y="217" fill="var(--ink)">Reply (other)</text>
    <rect x="150" y="34" width="108" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="204" y="53" fill="var(--ink)">Respond</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="60" y1="64" x2="60" y2="84"/><line x1="60" y1="114" x2="60" y2="134"/><line x1="60" y1="164" x2="60" y2="184"/>
    <line x1="108" y1="199" x2="150" y2="165"/><line x1="108" y1="199" x2="150" y2="213"/>
    <line x1="258" y1="165" x2="290" y2="165"/><line x1="258" y1="213" x2="290" y2="213"/>
    <polyline points="290,165 290,49 258,49"/><polyline points="290,213 290,165"/>
  </g>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="380" y="20" fill="var(--ink-soft)">triage_code.py(31 行有效代码)</text>
    <rect x="372" y="34" width="256" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="382" y="53" fill="var(--ink)">triage(client, text)  整个流程</text>
    <rect x="372" y="84" width="256" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="382" y="103" fill="var(--ink)">classify(client, text)  分类 + 校验</text>
    <rect x="372" y="134" width="256" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="382" y="153" fill="var(--ink)">if category in (...)  分支</text>
    <rect x="372" y="184" width="256" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="382" y="203" fill="var(--ink)">draft_reply(client, text, category)</text>
  </g>
  <g stroke="var(--ink-faint)" stroke-dasharray="3 3" fill="none">
    <line x1="108" y1="99" x2="372" y2="99"/><line x1="108" y1="149" x2="372" y2="149"/><line x1="258" y1="196" x2="372" y2="199"/>
  </g>
  <text x="372" y="236" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">蓝 = 调模型,琥珀 = 外部入口出口;三条虚线是 Classify、Finance?、Reply 的对应</text>
</svg>
<figcaption>左边的 10 个节点里,有 3 个是「模型」子节点(图里没画),所以画布上看起来是 7 个方块。右边的代码四个函数各自对应画布上的一段。</figcaption>
</figure>

先写代码版。目录和依赖照旧,在练习仓库根目录跑(`agent-zero-lab` 是 [Day 10](/blog/agent-zero/day-010-uv-1/) 建的仓库,`cloudledger/seed.py` 是 Day 280 建的,`common/llm.py` 是 Day 135 到 137 建的):

```bash
cd ~/agent-zero-lab
uv run python cloudledger/seed.py
mkdir -p part05/lowcode
touch part05/lowcode/__init__.py
```

`seed.py` 会打印造出了多少行数据(我这里是 30 个客户、123 张发票、41 张工单),今天只用到它建的库,不读工单表。接下来这个文件里,提示词是我按 CloudLedger 的工单类别写的,分类要求只输出 JSON,用的是 OpenAI 兼容接口的 JSON 模式([Day 148](/blog/agent-zero/day-148-structured-2/) 讲过,[Day 150](/blog/agent-zero/day-150-structured-4/) 的 `common/structured.py` 是带校验重试的版本)。

```python
# agent-zero-lab/part05/lowcode/triage_code.py
"""工单分流,写成代码:分类 → 财务类和其他类走不同的回复提示词 → 起草回复。
运行:uv run python -m part05.lowcode.triage_code "上个月的发票抬头写错了,应该是「启明科技有限公司」,能重开吗?"
"""
import json
import sys

from common.llm import LLMClient

CATEGORIES = ["refund", "billing", "invoice", "bug", "account", "other"]

CLASSIFY_PROMPT = (
    "你是云簿 CloudLedger 的工单分诊员。把工单分到下面一类,只输出 JSON,形如 {\"category\": \"refund\"}。\n"
    "refund=要求退钱;billing=扣费金额、套餐升降级、取消续费;invoice=开票、改抬头、补税号;"
    "bug=功能报错或崩溃;account=登录、账号、权限;other=其他。"
)
FINANCE_PROMPT = "你是云簿客服。这是一张财务类工单。用两三句话回复客户:说明你会请财务核对,不要承诺具体金额和到账时间。"
OTHER_PROMPT = "你是云簿客服。用两三句话回复客户:先复述问题,再说明下一步,不要编造功能或数字。"


def classify(client: LLMClient, text: str) -> str:
    r = client.chat(
        [{"role": "system", "content": CLASSIFY_PROMPT}, {"role": "user", "content": text}],
        response_format={"type": "json_object"},
        temperature=0,
    )
    category = json.loads(r.content).get("category", "")
    return category if category in CATEGORIES else "other"


def draft_reply(client: LLMClient, text: str, category: str) -> str:
    system = FINANCE_PROMPT if category in ("refund", "billing", "invoice") else OTHER_PROMPT
    r = client.chat([{"role": "system", "content": system}, {"role": "user", "content": text}], temperature=0.3)
    return r.content


def triage(client: LLMClient, text: str) -> dict[str, str]:
    category = classify(client, text)
    return {"category": category, "reply": draft_reply(client, text, category)}


if __name__ == "__main__":
    llm = LLMClient()
    out = triage(llm, sys.argv[1])
    print(json.dumps(out, ensure_ascii=False, indent=2))
    print(llm.ledger)
```

<div class="line-notes">

- `from common.llm import LLMClient` 用 Day 135 建的客户端,它自带记账本 `client.ledger`。
- `CATEGORIES = ["refund", "billing", "invoice", "bug", "account", "other"]` 六个类别。后面分类结果必须落在这张表里,不在就当 `other`。
- `CLASSIFY_PROMPT = (` 分类提示词:告诉模型每个类别指什么、只输出 JSON。`{\"category\": \"refund\"}` 是给模型看的格式示例。
- `FINANCE_PROMPT = "你是云簿客服。这是一张财务类工单。` 财务类的回复提示词,里面写死了「不要承诺具体金额和到账时间」。Day 330 的主管就是因为没人拦,自己补出了「3–5 个工作日」。
- `OTHER_PROMPT = "你是云簿客服。用两三句话回复客户:` 通用提示词,「不要编造功能或数字」。
- `def classify(client: LLMClient, text: str) -> str:` 第一次调模型:返回类别。
- `response_format={"type": "json_object"},` 打开 JSON 模式。提示词里必须有「JSON」这个词,这个模式才不会报错,我们的提示词里有。
- `temperature=0,` 分类要稳,不要随机。
- `category = json.loads(r.content).get("category", "")` 把模型返回的字符串解析成字典再取字段。模型返回 `{"category": "invoice"}`,取到 `"invoice"`。
- `return category if category in CATEGORIES else "other"` 模型偶尔会写出表外的词,兜底成 `other`。这个兜底有个代价:它会把「解析出错」也悄悄变成 `other`,今天 n8n 那边正好踩到。
- `def draft_reply(client: LLMClient, text: str, category: str) -> str:` 第二次调模型:起草回复。
- `system = FINANCE_PROMPT if category in ("refund", "billing", "invoice") else OTHER_PROMPT` 分支就是这一行:钱相关的三类走财务提示词,其余走通用的。画布上这一行是 `Finance?` 那个菱形加两个回复节点。
- `r = client.chat([{"role": "system", "content": system}, {"role": "user", "content": text}], temperature=0.3)` 回复允许一点点随机,所以是 0.3。
- `def triage(client: LLMClient, text: str) -> dict[str, str]:` 把两步串起来,返回类别和回复。
- `llm = LLMClient()` 读 `.env` 里的 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_EXTRA_BODY`。
- `print(llm.ledger)` 记账本:几次调用、多少输入输出 token、多少钱。

</div>

跑三张工单,一张发票类、一张故障类、一张闲聊类:

```bash
uv run python -m part05.lowcode.triage_code "上个月的发票抬头写错了,应该是「启明科技有限公司」,能重开吗?"
```

```text
{
  "category": "invoice",
  "reply": "您好，关于发票抬头重开的问题，我会立即请财务同事核对您上月的开票记录，确认后为您处理。具体处理结果和金额请以财务核实后的回复为准，感谢您的耐心等待。"
}
2 次调用 | 输入 193 / 输出 51 tokens | 约 ¥0.0008
```

```bash
uv run python -m part05.lowcode.triage_code "导出年度报表一直转圈,最后提示 ERR_EXPORT_TIMEOUT"
```

```text
{
  "category": "bug",
  "reply": "您反馈导出年度报表时一直转圈，最后提示 ERR_EXPORT_TIMEOUT。这个问题我先帮您记录并转交技术排查，请您稍等，后续有进展会及时同步给您。"
}
2 次调用 | 输入 179 / 输出 48 tokens | 约 ¥0.0007
```

```bash
uv run python -m part05.lowcode.triage_code "你们支持和金蝶对接吗?"
```

```text
{
  "category": "other",
  "reply": "您问的是云簿是否支持和金蝶对接。关于对接的具体情况我需要为您进一步确认，请您稍等，我核实后再回复您。"
}
2 次调用 | 输入 163 / 输出 36 tokens | 约 ¥0.0006
```

三张都分对了,每张 2 次模型调用、36 到 51 个输出 token、不到 0.001 元。注意这三次跑的 `.env` 里有 `LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`,也就是关着思考。留着这个细节,后面对比要用。

## 再画出来:n8n

### 先把它装起来

n8n 有三条路:官方 Docker 镜像(官方推荐,而且上面说了以后会要求用它)、`npx n8n`(需要 Node 24 或更新)、官方云版。我本机没有 Docker,走的是 npm。**这一步在我这台 2019 款 Intel MacBook 上没一次装成**,值得原样讲一遍,因为你可能也撞上。

```bash
mkdir n8n-run && cd n8n-run
npm init -y
npm i n8n@2.44.7
```

装了七八分钟,最后挂在一个原生模块的编译上,报错的关键行是:

```text
npm error error: invalid value 'c++20' in '-std=c++20'
npm error gyp ERR! stack Error: `make` failed with exit code: 2
npm error gyp ERR! cwd .../node_modules/isolated-vm
```

读法:`isolated-vm`(n8n 用来隔离执行表达式的原生库)7.0.1 要用 C++20 编译,我的 Apple clang 是 12.0.0,不认 `-std=c++20`。这个包自带了预编译文件,但目录里只有 `darwin-arm64`、`linux-x64`、`linux-arm64`、`win32-x64`,没有 Intel Mac。Apple 芯片的 Mac 一般不会遇到这个问题,我没有那样的机器,这一点没有实测。

我绕过去的办法分三步,其中第三步是官方不推荐的:

```bash
npm i n8n@2.44.7 --ignore-scripts      # 跳过所有编译脚本,2.8 GB 的 node_modules 能装完
npm rebuild sqlite3                    # 只把 sqlite3 的预编译二进制补上(不然启动时报 SQLite package has not been found)
export N8N_EXPRESSION_ENGINE=legacy    # 用旧的表达式引擎,绕开 isolated-vm
```

启动的日志里,n8n 对这个环境变量的评价是:

```text
 - N8N_EXPRESSION_ENGINE -> The `legacy` expression engine runs expressions without isolation, is no longer considered secure, and will be removed in a future version. Remove this environment variable to use the default `vm` engine.
 - Running n8n outside a container is deprecated. Future versions will require running n8n via the official Docker image. See https://docs.n8n.io/deploy/host-n8n
```

所以这是一次只在本地学习用的权宜之计,别带进任何真实环境。你有 Docker 就用官方镜像,没有就用官方云版;我没有注册云版,没碰过它的界面。

另外为了让它别联网上报、能在 http 下登录,我设了几个环境变量:`N8N_DIAGNOSTICS_ENABLED=false`、`N8N_VERSION_NOTIFICATIONS_ENABLED=false`、`N8N_SECURE_COOKIE=false`,并且把数据目录 `N8N_USER_FOLDER` 指到临时目录。起服务:

```bash
npx n8n start        # 我是 node node_modules/n8n/bin/n8n start,效果一样
```

第一次打开 `http://localhost:5678` 它要你建一个 owner 账号。这是本机的账号,不是注册到 n8n 官网,我填的是 `local-test@example.com` 加一个随手的密码,你也不要填真实信息。

### 凭据和 10 个节点

n8n 里模型的密钥放在「凭据」(credential)里:自带一个 DeepSeek 的凭据类型,字段是 API Key 和 Base URL(默认 `https://api.deepseek.com`)。密钥存进去以后会加密落库,节点里只引用它的名字。

然后是画图。我画的 10 个节点如下(我没有在界面里点过,估计要半小时):

| 节点 | 类型 | 关键设置 |
| --- | --- | --- |
| Webhook | Webhook | 方法 POST,路径 `triage`,响应方式选「用 Respond to Webhook 节点」 |
| Classify | Basic LLM Chain | Prompt 选 Define,内容 `{{ $('Webhook').item.json.body.ticket_text }}`;Chat Messages 加一条 System,填 `CLASSIFY_PROMPT` |
| DeepSeek (classify) | DeepSeek Chat Model | 连到 Classify 底下的 Model 插口;模型 `deepseek-flash`,Temperature 0,Response Format 选 JSON |
| Parse category | Code | JavaScript,取类别并校验,同时算出 `finance` 布尔值 |
| Finance? | If | 条件 `{{ $json.finance }}` 为 true |
| Reply (finance) | Basic LLM Chain | System 填 `FINANCE_PROMPT`,Prompt 同 Classify |
| DeepSeek (finance) | DeepSeek Chat Model | Temperature 0.3 |
| Reply (other) | Basic LLM Chain | System 填 `OTHER_PROMPT` |
| DeepSeek (other) | DeepSeek Chat Model | Temperature 0.3 |
| Respond | Respond to Webhook | JSON,内容 `{{ JSON.stringify({ category: $('Parse category').item.json.category, reply: $json.text }) }}` |

两个地方要说明。第一,每个「调一次模型」的节点要配一个模型子节点,我给三个 Basic LLM Chain 各配了一个 DeepSeek Chat Model(没试过让三个链共用一个),所以 10 个节点里有 3 个是模型子节点,画布上看起来是 7 个方块。第二,我**没有在界面上一个个点**。我是用一个脚本生成了同样 10 个节点和设置的导入文件,再用 n8n 的命令行导入:

```bash
n8n import:credentials --input=cred.json
n8n import:workflow --input=triage-v1.json
n8n publish:workflow --id=triagev1wf0001
```

所以界面里点的体验我没有截图可以给你。`publish` 之后要重启 n8n 才生效,这是它命令行输出里写明的。2.0 把「激活」改叫「发布」,没发布时只能用「测试地址」(路径里带 `webhook-test`),发布后才有「正式地址」(`/webhook/triage`)。

### 第一次跑:全部分成了 other

发布、重启,发第一张工单:

```bash
curl -s -X POST localhost:5678/webhook/triage -H 'Content-Type: application/json' \
  -d '{"ticket_text":"上个月的发票抬头写错了,应该是「启明科技有限公司」,能重开吗?"}'
```

回复是正常的一段话,看不出毛病。但我去翻 n8n 记下的这次执行(界面里点开 Executions 就能看),每个节点的输出是这样:

```text
DeepSeek (classify) [649ms] success: [{"response":{"generations":[[{"text":"{\"category\": \"invoice\"}","generationInfo":{"finish_reason":"stop"}}]]},"tokenUsage":{"completionTokens":37,"promptTokens":161,"tot
Classify [1453ms] success: [{"category":"invoice"}]
Parse category [41ms] success: [{"category":"other","finance":false}]
Finance? [7ms] success: []
```

读法:`DeepSeek (classify)` 节点的文本是 `{"category": "invoice"}`,分类链的输出已经是个解析好的对象 `{"category":"invoice"}`;但我的 `Parse category` 节点写的是从 `json.text` 里取字符串再 `JSON.parse`,`text` 不存在,`JSON.parse(undefined)` 抛错,被我自己写的 `try { ... } catch (e) {}` 吞掉,类别落回默认的 `other`,于是这张发票工单走了通用回复。整次执行的状态是 `success`。

这个坑值得记:**画布上看不到错。** 所有节点都是绿的,回复也像模像样,只有点进节点看数据才能发现分类是错的。我的 try/catch 兜底是人为写的。代码版 `classify()` 也有一个兜底(类别不在表里就当 `other`),但解析 JSON 那一步没写 try,出错会直接抛异常,在日志和测试里一眼能看到。画布上要靠你自己点进去看,或者靠明天的评测集。修法是两种形状都认:

```javascript
const j = $input.first().json;
const c = j.category ?? JSON.parse(j.text).category;
```

修好重新导入、发布、重启,同一张工单:

```bash
curl -s -X POST localhost:5678/webhook/triage -H 'Content-Type: application/json' \
  -d '{"ticket_text":"上个月的发票抬头写错了,应该是「启明科技有限公司」,能重开吗?"}'
```

```text
{"category":"invoice","reply":"您好，理解您需要将发票抬头更正为“启明科技有限公司”。我会请财务核对原发票信息及重开要求，具体能否重开及所需材料以财务确认为准，感谢您的耐心等待。"}
[2.001736s]
{"category":"bug","reply":"您反馈导出年度报表时一直转圈，最后提示 ERR_EXPORT_TIMEOUT。我先为您记录该问题并转交技术核查，请补充导出账号、报表范围、操作时间和报错截图，便于进一步定位。建议暂时不要重复导出。"}
[2.872288s]
{"category":"other","reply":"您是想确认云簿是否支持和金蝶对接。这个问题我先帮您记录并转交相关同事核实，确认后再回复您，具体以实际确认结果为准。"}
[2.619466s]
```

上面是三张工单的原始返回,每条后面方括号里是 `curl` 量到的总耗时。三张都分对了:`invoice`、`bug`、`other`。

### 一个只有对账才发现的差别

代码版每次调用 40 多个输出 token,n8n 版每次两三百。我去翻每次执行里两个模型节点的 token 数:

```text
execution 24: LLM calls 2 prompt 243 completion 213
execution 25: LLM calls 2 prompt 229 completion 281
execution 26: LLM calls 2 prompt 213 completion 262
```

输出 213 到 281 个,是代码版的五六倍。原因在 `.env` 里那行 `LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`:代码版把 DeepSeek 的思考关了,n8n 的 DeepSeek Chat Model 节点没有这个开关。我翻了装好的包里这个节点的定义,它的可选项只有 Frequency Penalty、Maximum Number of Tokens、Response Format、Presence Penalty、Sampling Temperature、Timeout、Max Retries、Top P,没有「额外请求体」。所以 n8n 这边思考是开着的,每次多想几百个 token。想公平地比,把代码版也开着思考再跑一遍(去掉那行配置):

```bash
LLM_EXTRA_BODY='{}' uv run python -m part05.lowcode.triage_code "导出年度报表一直转圈,最后提示 ERR_EXPORT_TIMEOUT"
```

```text
{
  "category": "bug",
  "reply": "您反馈导出年度报表时一直转圈，最后提示 ERR_EXPORT_TIMEOUT。我先记录该报错并转交技术核查导出任务状态，请您稍后重试；如仍失败，请补充报表年度和操作时间。"
}
2 次调用 | 输入 229 / 输出 246 tokens | 约 ¥0.0024
```

再用 `time_compare.py` 把三张工单各跑三遍取平均。先写这个小脚本:

```python
# agent-zero-lab/part05/lowcode/time_compare.py
"""量三张工单在代码版里的耗时,各跑 3 遍取平均。用法:uv run python -m part05.lowcode.time_compare"""
import time

from common.llm import LLMClient
from part05.lowcode.triage_code import triage

TICKETS = [
    "上个月的发票抬头写错了,应该是「启明科技有限公司」,能重开吗?",
    "导出年度报表一直转圈,最后提示 ERR_EXPORT_TIMEOUT",
    "你们支持和金蝶对接吗?",
]

if __name__ == "__main__":
    llm = LLMClient()
    triage(llm, TICKETS[0])  # 先热一下连接,别把第一次建连接的时间算进去
    for text in TICKETS:
        t = []
        for _ in range(3):
            t0 = time.perf_counter()
            triage(llm, text)
            t.append(time.perf_counter() - t0)
        print(f"{sum(t) / 3:.2f} 秒  {text[:16]}")
```

<div class="line-notes">

- `from part05.lowcode.triage_code import triage` 直接复用上面的 `triage`,不重写。
- `TICKETS = [` 三张工单:发票、故障、闲聊。
- `llm = LLMClient()` 一个客户端重复用,连接可以复用。
- `triage(llm, TICKETS[0])  # 先热一下连接` 第一次调用要建 HTTPS 连接,多花几百毫秒,不算进平均数。
- `for _ in range(3):` 每张跑三遍。
- `t0 = time.perf_counter()` 和下一行的 `time.perf_counter() - t0` 量一次完整分流的耗时。
- `print(f"{sum(t) / 3:.2f} 秒  {text[:16]}")` 三遍的平均,后面跟工单的前 16 个字。

</div>

```bash
uv run python -m part05.lowcode.time_compare               # 关着思考
LLM_EXTRA_BODY='{}' uv run python -m part05.lowcode.time_compare   # 开着思考
```

```text
1.46 秒  上个月的发票抬头写错了,应该是「
1.32 秒  导出年度报表一直转圈,最后提示 
1.35 秒  你们支持和金蝶对接吗?
```

```text
2.46 秒  上个月的发票抬头写错了,应该是「
2.70 秒  导出年度报表一直转圈,最后提示 
2.38 秒  你们支持和金蝶对接吗?
```

把三组放在一起(三张工单的平均):

| | 输入 token | 输出 token | 耗时 | 算式(未命中价,输入 2、输出 8 元每百万) |
| --- | --- | --- | --- | --- |
| 代码版,关思考 | 178 | 45 | 1.38 秒 | (178×2 + 45×8) ÷ 10⁶ ≈ 0.0007 元 |
| 代码版,开思考 | 228 | 252 | 2.51 秒 | (228×2 + 252×8) ÷ 10⁶ ≈ 0.0025 元 |
| n8n | 228 | 252 | 2.50 秒 | 同上,约 0.0025 元 |

最后两行几乎一模一样,说明 n8n 这个流程本身没有多花钱也没有变慢,差别全在那个思考开关上。耗时那一栏 n8n 是 `curl` 量到的 webhook 往返,包括 n8n 自己的开销,三张分别是 2.00、2.87、2.62 秒。这张表是三张工单的平均,数据量很小,看量级就好。

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="三种做法的平均输出 token:代码版关思考 45,代码版开思考 252,n8n 252">
  <rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <text x="16" y="36" fill="var(--ink)">代码版 关思考</text>
    <rect x="150" y="22" width="45" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="203" y="37" fill="var(--ink-soft)">45</text>
    <text x="16" y="76" fill="var(--ink)">代码版 开思考</text>
    <rect x="150" y="62" width="252" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="410" y="77" fill="var(--ink-soft)">252</text>
    <text x="16" y="116" fill="var(--ink)">n8n</text>
    <rect x="150" y="102" width="252" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="410" y="117" fill="var(--ink-soft)">252</text>
  </g>
  <text x="16" y="154" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">三张工单的平均输出 token。n8n 的 DeepSeek 节点没有「关思考」选项,所以和开着思考的代码版一样</text>
</svg>
<figcaption>差别不是 n8n 贵,是那个节点没有留关思考的口子。要关,只能改用 HTTP Request 节点自己拼请求体。</figcaption>
</figure>

这是平台和代码的第一个真实差别:**平台只暴露了设计者想到的参数。** 你要的开关它没留,你就只能绕(换成 HTTP 请求节点自己写请求体)或者接受。写代码时一个 `extra_body` 就解决。

## 画 vs 写:文件长什么样

平台上搭的东西最终是一份文件。n8n 的导出命令是 `n8n export:workflow --id=... --pretty --output=...`,不加 `--pretty` 输出的是压成一行的 JSON(我量了,`wc -l` 是 0 行),`git diff` 一改就是整个文件变了,所以导出一定要加 `--pretty`。导出的片段长这样,是分类那一对节点:

```text
      {
        "parameters": {
          "promptType": "define",
          "text": "={{ $('Webhook').item.json.body.ticket_text }}",
          "messages": {
            "messageValues": [
              {
                "type": "SystemMessagePromptTemplate",
                "message": "你是云簿 CloudLedger 的工单分诊员。把工单分到下面一类,只输出 JSON,形如 {\"category\": \"refund\"}。\nrefund=要求退钱;billing=扣费金额、套餐升降级、取消续费;invoice=开票、改抬头、补税号;bug=功能报错或崩溃;account=登录、账号、权限;other=其他。"
              }
            ]
          }
        },
        "id": "d6d84fcb-6ad8-4280-9364-4116ac2c854c",
        "name": "Classify",
        "type": "@n8n/n8n-nodes-langchain.chainLlm",
        "typeVersion": 1.9,
        "position": [
          220,
          0
        ]
      },
      {
        "parameters": {
          "model": "deepseek-flash",
          "options": {
            "temperature": 0,
            "responseFormat": "json_object"
          }
        },
        "id": "bed29efa-a4ab-45e2-896b-adcda337a7d4",
        "name": "DeepSeek (classify)",
        "type": "@n8n/n8n-nodes-langchain.lmChatDeepSeek",
        "typeVersion": 1,
        "position": [
          220,
          200
        ],
        "credentials": {
          "deepSeekApi": {
            "id": "ds-cred-1",
            "name": "DeepSeek (scratch)"
          }
        }
      },
      {
        "parameters": {
          "jsCode": "const j = $input.first().json;\nconst allowed = ['refund', 'billing', 'invoice', 'bug', 'account', 'other'];\nlet category = 'other';\ntry {\n  const c = j.category ?? JSON.parse(j.text).category;\n  if (allowed.includes(c)) category = c;\n} catch (e) {}\nreturn [{ json: { category, finance: ['refund', 'billing', 'invoice'].includes(category) } }];"
```

提示词埋在 `parameters.messages.messageValues[0].message` 这个字符串里,引号和换行都被转义了。整份导出 368 行、10 个节点,每个节点还带了画布上的坐标(`position`)和随机生成的 `id`。同一个流程,`triage_code.py` 是 46 行,其中有效代码 31 行。

行数不是重点,重点是改一句话以后 `git diff` 长什么样。我把财务类的回复提示词末尾加了一句「结尾加一句『如需加急请回复"加急"』」,代码版和 n8n 版各改一次(n8n 版是改导入文件、重新导入、再导出,等于在界面上改完保存):

```text
 triage-v1.json | 10 +++++-----
 triage_code.py |  2 +-
 2 files changed, 6 insertions(+), 6 deletions(-)
```

代码版的 diff 是一行:

```text
@@ -14,7 +14,7 @@ CLASSIFY_PROMPT = (
     "refund=要求退钱;billing=扣费金额、套餐升降级、取消续费;invoice=开票、改抬头、补税号;"
     "bug=功能报错或崩溃;account=登录、账号、权限;other=其他。"
 )
-FINANCE_PROMPT = "你是云簿客服。这是一张财务类工单。用两三句话回复客户:说明你会请财务核对,不要承诺具体金额和到账时间。"
+FINANCE_PROMPT = "你是云簿客服。这是一张财务类工单。用两三句话回复客户:说明你会请财务核对,不要承诺具体金额和到账时间,结尾加一句「如需加急请回复\"加急\"」。"
 OTHER_PROMPT = "你是云簿客服。用两三句话回复客户:先复述问题,再说明下一步,不要编造功能或数字。"
 
 
```

n8n 版的 diff 是五行,其中只有一行是我改的:

```text
diff --git a/triage-v1.json b/triage-v1.json
index dbfd1d9..3fd2232 100644
--- a/triage-v1.json
+++ b/triage-v1.json
@@ -5,7 +5,7 @@
     "id": "triagev1wf0001",
     "name": "triage-v1",
     "description": null,
-    "active": true,
+    "active": false,
     "isArchived": false,
     "nodes": [
       {
@@ -124,7 +124,7 @@
             "messageValues": [
               {
                 "type": "SystemMessagePromptTemplate",
-                "message": "你是云簿客服。这是一张财务类工单。用两三句话回复客户:说明你会请财务核对,不要承诺具体金额和到账时间。"
+                "message": "你是云簿客服。这是一张财务类工单。用两三句话回复客户:说明你会请财务核对,不要承诺具体金额和到账时间,结尾加一句「如需加急请回复\"加急\"」。"
               }
             ]
           }
@@ -335,9 +335,9 @@
     "meta": null,
     "nodeGroups": [],
     "pinData": null,
-    "versionId": "5ed955d2-5e95-448d-9945-52fa48bdfef6",
-    "activeVersionId": "5ed955d2-5e95-448d-9945-52fa48bdfef6",
-    "versionCounter": 2,
+    "versionId": "380ea5d8-37b5-40b3-b557-904aeeaa3aec",
+    "activeVersionId": null,
+    "versionCounter": 3,
     "triggerCount": 1,
     "sourceWorkflowId": null,
     "tags": [],
```

其余四行是平台自己改的:`active` 从 `true` 变成 `false`,`versionId`、`activeVersionId`、`versionCounter` 全换了。注意第一条:**重新导入一个工作流会把它变成未发布状态**。我在 n8n 开着的时候重新导入了一次,再请求原来的地址,马上得到:

```text
{"code":404,"message":"The requested webhook \"POST triage\" is not registered.","hint":"The workflow must be active for a production URL to run successfully. ..."}
```

线上 webhook 当场失效,要再 `publish` 一次并重启才恢复(它的命令行输出写明了改动要重启才生效)。

还有一件事要看清,凭据有没有被导出来。上面片段末尾的节点里 `credentials` 只有 `id` 和 `name`:

```text
"credentials": { "deepSeekApi": { "id": "ds-cred-1", "name": "DeepSeek (scratch)" } }
```

密钥本身不在工作流文件里,可以放心进 git。凭据要单独导出(`n8n export:credentials`),默认导出的是加密后的一长串;只有明确加 `--decrypted` 才会输出明文。明天会实际试一遍。

## Dify、扣子、百炼上的对应写法

我没有在这三个平台上实际搭过流程,所以这一节是「照官方文档的对应关系」,不是实操记录。

Dify 的工作流里,同样的节点有现成的对应:**开始**节点加一个文本输入变量 `ticket_text`;**LLM** 节点做分类,官方文档说提示词里用双大括号引用变量(`{{变量名}}`),结构化输出可以用字段编辑器或手写 JSON Schema,如果选的模型旁边显示「不支持」,要换模型或者关掉结构化输出;**IF/ELSE** 节点做分支,条件可以组合 AND 或 OR,有 IF、ELIF、ELSE 三种出口;再来两个 **LLM** 节点起草回复;**结束**节点输出 `category` 和 `reply`。扣子的对应是开始节点、大模型节点、选择器、大模型节点、结束节点。百炼的工作流应用类似,调用时自定义参数放进 `input.biz_params`。

Dify 自部署按官方快速开始页面是这几步:要求 CPU 至少 2 核、内存至少 4 GiB;macOS 上要装 Docker Desktop,并且虚拟机至少 2 个 CPU、8 GiB 内存;然后克隆仓库、进 `dify/docker`、复制 `.env.example` 成 `.env`、给 `DIFY_AGENT_LOCAL_SANDBOX_AUTH_TOKEN` 填一个随机值(1.18 起不填的话 Agent 后端和沙箱起不来)、`docker compose up -d`,最后打开 `http://localhost/install` 初始化。没有 Docker 的话用 Dify 云版:官网价格页上的 Sandbox 套餐是免费的,含 200 条消息额度、5 个应用、50 篇知识库文档、1 个团队成员。以上都是据官方页面,我没点过。

## 动手练习

**练习 1:在 Dify 上搭一遍。** 用 Dify 云版的 Sandbox 套餐(或者你自己部署的),把上面的工单分流搭出来:开始节点一个输入变量,分类 LLM 节点,IF/ELSE,两个回复 LLM 节点,结束节点输出 `category` 和 `reply`。然后用三张工单手点运行,把每次分类结果记下来,再导出 DSL 文件放进 git。写出你在界面上卡住的第一个地方。

<details><summary>参考答案</summary>

我没有 Dify 账号和 Docker,这一题没实跑,下面是对着官方文档整理的检查清单,不是实操记录。

1. 开始节点:变量名 `ticket_text`,类型选段落。后面的提示词和评测脚本都按这个名字取。
2. 分类 LLM 节点:模型选你在设置里配好的那个;系统提示词复制 `CLASSIFY_PROMPT`;用户消息里用双大括号插入 `ticket_text`;如果要结构化输出,在节点里加一个 `category` 字段,类型字符串;模型旁边显示「不支持」就换模型或者在提示词里要求只输出 JSON,后面加一个代码节点解析。
3. IF/ELSE 节点:条件写分类节点输出的 `category` 属于 refund、billing、invoice 之一(三个条件用 OR 连)。
4. 两个回复 LLM 节点分别接 IF 和 ELSE,提示词分别复制 `FINANCE_PROMPT` 和 `OTHER_PROMPT`。
5. 结束节点:输出 `category` 和 `reply` 两个变量。
6. 三张工单手点运行,期望分别是 `invoice`、`bug`、`other`。
7. 导出 DSL:应用菜单里导出,得到一个 YAML 文件,进 git。1.18 起还可以导出 `.ifpkg` 整包,但官方说明里 YAML 导出仍然保留。
8. 自检:提示词里是不是漏了「只输出 JSON」几个字;结构化输出的字段名是不是和 IF 条件里引用的一致;`ticket_text` 在两个 LLM 节点里是不是都插进去了。

最常见的第一个卡点我猜是变量引用:节点之间引用的是「上游节点的输出变量」,不是你以为的「上一步的文字」。这是推测,不是我踩出来的。

</details>

**练习 2:故意让解析失败。** 在 `triage_code.py` 的 `classify()` 里,把模型的原始输出 `r.content` 先打印出来,再让提示词里的「只输出 JSON」几个字消失(改成「请输出分类结果」),跑发票那张工单。代码版现在怎么表现?它和 n8n 里「全部落成 other」相比,有什么不同?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/lowcode/ex336_no_json.py
"""练习 2:去掉「只输出 JSON」,看代码版怎么坏。"""
import json

from common.llm import LLMClient
from part05.lowcode.triage_code import CATEGORIES

PROMPT = "你是云簿 CloudLedger 的工单分诊员。请输出分类结果,类别有 refund、billing、invoice、bug、account、other。"
TEXT = "上个月的发票抬头写错了,应该是「启明科技有限公司」,能重开吗?"

if __name__ == "__main__":
    client = LLMClient()
    r = client.chat([{"role": "system", "content": PROMPT}, {"role": "user", "content": TEXT}], temperature=0)
    print("原始输出:", repr(r.content[:80]))
    try:
        category = json.loads(r.content).get("category", "")
    except json.JSONDecodeError as e:
        print("解析失败:", e)
        category = "other"
    print("最后落成:", category if category in CATEGORIES else "other")
```

<div class="line-notes">

- `PROMPT = "你是云簿 CloudLedger 的工单分诊员。请输出分类结果,` 故意不要求 JSON,也不再开 `response_format`。
- `r = client.chat([{"role": "system", "content": PROMPT}, {"role": "user", "content": TEXT}], temperature=0)` 去掉了 `response_format`,模型自由发挥。
- `print("原始输出:", repr(r.content[:80]))` 用 `repr` 打印,能看出有没有多余的换行或引号。
- `json.loads(r.content).get("category", "")` 和 `classify()` 里一样的解析。
- `except json.JSONDecodeError as e:` 这里和 `classify()` 的区别:`classify()` 里没有 `try`,解析失败会直接抛异常,程序停下;我这里为了演示「悄悄兜底」才加了 try。
- `print("最后落成:"` 看最终落成的类别。

</div>

```bash
uv run python -m part05.lowcode.ex336_no_json
```

我实跑了两次,输出一样:

```text
原始输出: '类别:invoice'
解析失败: Expecting value: line 1 column 1 (char 0)
最后落成: other
```

模型其实分对了(`invoice`),只是写成了 `类别:invoice` 这种人话,不是 JSON,`json.loads` 在第 1 个字符就报错,于是走到兜底,最后落成 `other`。这里能看到两件事:`classify()` 本身没有 `try`,解析失败会直接抛 `json.JSONDecodeError`,整个程序停下,根本不会悄悄变成 `other`,调用方在日志里一眼看到;n8n 里是我自己写的 `catch (e) {}` 把错吞了。所以两边的差别不在「平台还是代码」,在于你有没有写吞错的兜底。但有一个结构性的区别:代码里的报错会从调用栈一路冒到你的测试和日志里,画布上的节点要你点进执行记录才看得到。

</details>

**练习 3:数一数画布上的 token。** n8n 的执行记录里,每个模型节点都有 `tokenUsage`。写一个脚本思路:怎么拿到一次执行里所有模型节点的 token 之和?不用写代码,写出你会调用的接口和遍历的字段。

<details><summary>参考答案</summary>

我实跑时用的是 n8n 自己的界面接口:先登录拿 cookie(`POST /rest/login`),再 `GET /rest/executions` 列出最近的执行,按 id 取 `GET /rest/executions/{id}`。返回的 `data` 是一段用 `flatted` 压缩过的 JSON(循环引用被拍平成数组),要用 `flatted` 的 `parse` 展开。展开后遍历 `resultData.runData`,每个模型节点(名字带 DeepSeek 的那几个)的 `data.ai_languageModel[0][0].json.tokenUsage` 里有 `promptTokens` 和 `completionTokens`,对所有模型节点求和就是这次执行的总用量。这是 n8n 内部接口,不是公开 API,版本一变可能就不能用了;稳妥的办法是在流程里加一个节点把用量写进你自己的日志。n8n 日志里没有缓存命中数,所以只能按未命中价算上限。

</details>

**练习 4:选哪个。** 下面三个场景,各选 Dify、扣子、百炼、n8n 或者「直接写代码」,写一两句理由:(1)运营同学每天要把一份 Excel 里的反馈分类后推送到飞书群;(2)公司已经全面用阿里云,要做一个内部知识库问答;(3)要给客户嵌一个客服机器人,每秒几十个请求,出错要能复现。

<details><summary>参考答案</summary>

(1)n8n。典型的「触发,搬数据,中间一步让模型判断」,n8n 的集成节点多,Excel、飞书都有现成的;而且运营同学自己能改。(2)百炼。知识库、模型、计费在同一个控制台,采购和合规最省事;我没查它的价格,选它的理由是生态位置,不是便宜。(3)直接写代码。每秒几十个请求、要复现某一次线上请求,这两条都是画布的弱项;明天的决策表会把这几个信号列全。第三题没有标准答案,理由比结论重要。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 低代码平台 | 用拖拽方块和连线搭出应用流程的网页工具,每个方块是一个步骤。Dify、扣子、百炼、n8n 都是 |
| 节点(node) | 画布上的一个方块,代表一个步骤,比如调一次模型、判断一个条件 |
| 工作流(workflow) | 由节点和连线组成的一整张图,点发布后可以被别的系统调用 |
| 画布(canvas) | 你拖拽节点的那块区域 |
| 自部署(self-host) | 把平台装在自己的服务器或电脑上跑,不用对方的云。要自己负责升级、备份和安全 |
| Docker | 把一个软件连同它需要的环境打包成一个「盒子」,在哪台机器上都能原样跑起来。n8n、Dify 官方都推荐用它部署 |
| 凭据(credential) | 平台里存密钥的地方,加密落库,节点只引用名字,不在工作流文件里出现 |
| DSL | 这里指 Dify 把整个应用导出成的 YAML 文件,里面是节点、连线和提示词;n8n 对应的是导出的 JSON |
| 发布(publish) | n8n 2.0 里把工作流上线的动作,以前叫激活。没发布时只有测试地址能用 |
| fair-code / 源码公开 | 源码能看能改,但商用有限制,不是 OSI 认可的开源协议。n8n 的 Sustainable Use License 是这类 |
| 多租户 | 一套系统同时给很多互相隔离的客户用。Dify 的协议禁止未经授权用它的源码运营多租户服务 |

## 常见误区

**以为画布上全绿就是对的。** 今天 n8n 里所有节点都是 success,类别却错了。要在执行记录里看每个节点实际吐了什么,更好的做法是后面用评测集批量验证。

**以为低代码一定更省钱。** 今天 n8n 和代码版花的是同一笔钱,而且还多了一层思考开着的钱。平台的收费(Dify 云版按年、n8n 云版按执行次数)和它省下的人力要放在一起算。

**以为换平台参数都能传进去。** n8n 的 DeepSeek 节点没有「关思考」的开关,和 [Day 334](/blog/agent-zero/day-334-frameworks-2/) 里微软 Agent Framework 没有 `extra_body` 是同一类坑。

**以为导入等于保持原状。** 重新导入 n8n 的工作流会让它变成未发布,线上地址立刻失效。把「导入、发布、重启」写进你的部署清单。

**把导出的工作流当成密钥安全的。** 工作流文件里只有凭据的 id 和名字,这是好事;但凭据单独导出时加 `--decrypted` 会输出明文,别把这种文件放进 git。

**在公网上直接开自部署的平台。** Coze Studio 的 README 自己都写了:开放注册和能执行 Python 的代码节点放到公网有风险。n8n 的 `Execute Command` 节点 2.0 起默认禁用也是同一个原因。

**把今天的版本号当成永远的版本号。** Dify 一个月就从 1.17.1 到 1.18.0,而且 1.18.0 是要所有组件一起升的版本。写进简历或方案里的版本,要写上查证日期。

## 学习资料

### 文档与文章

- [Dify · 自部署快速开始(Docker Compose)](https://docs.dify.ai/en/self-host/quick-start/docker-compose):本地要求、克隆和启动命令、1.18 起必须设置的沙箱 token,15 分钟。
- [Dify · 1.18.0 发布说明](https://github.com/langgenius/dify/releases/tag/1.18.0):读「Upgrade guide」那一节,感受自部署平台的升级成本,10 分钟。
- [n8n · 2.0 破坏性变更](https://docs.n8n.io/2-0-breaking-changes/):环境变量读取、任务运行器、禁用节点这些默认值的变化,10 分钟。
- [n8n · 服务端命令行](https://docs.n8n.io/hosting/cli-commands/):导入导出、发布、`--pretty` 都在这一页,10 分钟。
- [阿里云百炼 · 应用介绍](https://help.aliyun.com/zh/model-studio/user-guide/application-introduction):智能体、工作流、高代码应用三类的区别,10 分钟。
- [Coze · 工作流执行 API](https://docs.coze.cn/developer_guides/workflow_run):请求和返回字段,同步 90 秒、异步只限付费这些限制,10 分钟。
- [OpenAI · 弃用页](https://developers.openai.com/api/docs/deprecations):找 Agent Builder 和 Evals 平台两条,看时间线,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV116w5zuEbo&autoplay=0&high_quality=1" title="黑马程序员零基础玩转Dify,5小时极速入门Agent开发,从Prompt到企业级项目实战,涵盖RAG+Text2SQL、电商客服+LOL助手全实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑马程序员 · 零基础玩转Dify,5小时极速入门Agent开发 · 4 小时多的完整课程,2026 年 3 月的,不用全看,挑工作流和 HTTP 节点那几集,对照今天的 10 个节点。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1KSKwzJEEV&autoplay=0&high_quality=1" title="从0开始“做”一个Agent!【n8n草履虫教程】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>秋芝2046 · 从0开始"做"一个Agent!【n8n草履虫教程】 · 34 分钟,2025 年 6 月,从零在 n8n 里搭一个 Agent,界面可能和 2.x 略有不同,看思路。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/GuaKeDS6UKU" title="n8n Quick Start Tutorial: Build Your First AI Agent [2026]" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>n8n(官方频道)· n8n Quick Start Tutorial: Build Your First AI Agent [2026] · 英文,官方出的入门,看它怎么建工作流、配凭据、连模型子节点。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dJ34OU_JY7Y" title="Dify Quickstart Guide: Build Your First AI Workflow" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dify(官方频道)· Dify Quickstart Guide: Build Your First AI Workflow · 英文,官方入门,对照练习 1 看节点怎么连。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):讲应用架构和评测的部分,读的时候想想「画布上的流程」和「代码里的流程」各自怎么测,英文原版。
- Michael Albada《Building Applications with AI Agents》(O'Reilly,2025):对几类 Agent 框架和平台的取舍有专门章节,选读,英文原版。

### 开源项目与代码

- [langgenius/dify](https://github.com/langgenius/dify):读根目录的 `LICENSE`,再看 `docker/` 目录里的 `docker-compose.yaml`,数一数自部署要起多少个容器。
- [n8n-io/n8n](https://github.com/n8n-io/n8n):读 `LICENSE.md`(Sustainable Use License)和 `packages/@n8n/nodes-langchain` 里的 DeepSeek 节点,看它到底暴露了哪些参数。
- [coze-dev/coze-studio](https://github.com/coze-dev/coze-studio):开源版 README 里的部署和安全警告,对照云版的差别。

## 自测

1. 说出 Dify 的协议对商用做了哪两条限制。

<details><summary>答案</summary>

在 Apache 2.0 基础上加了两条:没有 Dify 的书面授权,不能用它的源码运营多租户服务(一个工作区算一个租户);不能去掉或修改前端控制台和应用里的 logo 与版权信息(只用后端、不涉及前端的使用不受这条限制)。可以商用,可以当企业内部的应用开发平台。

</details>

2. 今天为什么 n8n 版每次的输出 token 是代码版的五六倍?这和 n8n 本身贵不贵有关吗?

<details><summary>答案</summary>

和 n8n 本身无关。代码版 `.env` 里有 `LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`,把 DeepSeek 的思考关了;n8n 的 DeepSeek Chat Model 节点没有传额外请求体的选项,思考是开着的。把代码版也开着思考,输出 token 252、耗时 2.51 秒,和 n8n 的 252、2.50 秒基本一样。

</details>

3. 画布上所有节点都是绿色,为什么分类还是错的?怎么发现?

<details><summary>答案</summary>

`Parse category` 节点从 `json.text` 里取字符串再 `JSON.parse`,但分类链的输出已经是解析好的对象、没有 `text` 字段,`JSON.parse(undefined)` 抛错被我自己写的 `catch (e) {}` 吞掉,类别落回默认的 `other`,整次执行的状态仍是 success。发现办法是点进执行记录看每个节点实际吐了什么,更根本的办法是用一份带标准答案的评测集批量跑(明天)。

</details>

4. 重新导入一个 n8n 工作流之后,线上的 webhook 为什么会失效?要补哪两步?

<details><summary>答案</summary>

导入会把工作流变成未发布状态(导出文件里 `active` 从 `true` 变成 `false`,`activeVersionId` 变成 `null`)。要补:`n8n publish:workflow --id=...`,然后重启 n8n(命令行输出里写明了改动要重启才生效)。

</details>

5. 导出的 n8n 工作流 JSON 里有没有密钥?哪种导出才会输出明文?

<details><summary>答案</summary>

工作流文件里只有凭据的 `id` 和 `name`,没有密钥。凭据需要单独用 `n8n export:credentials` 导出,默认输出加密后的字符串,加 `--decrypted` 才输出明文,所以明文文件不能进 git。

</details>

6. **面试题**:「你用过 Dify 或者 n8n 吗?你怎么看低代码平台?」

<details><summary>答案</summary>

参考要点:先说定位,低代码平台是五层图里最上面一层,适合需求没定要快速给业务方看效果、业务同学自己维护的内部工具,不适合要审计、要复现、高并发的核心产品。再说我真做过的:同一个工单分流,我写过 31 行 Python,也在 n8n 里画过 10 个节点,耗时和 token 没差别,真正的差别是平台只暴露设计者想到的参数(DeepSeek 节点没有关思考的开关)、画布上出错看不到(全绿但分类错了)、导出文件里一句提示词的改动混在平台自己改的元数据里。再说风险:Flowise 今年 8 月归档,OpenAI Agent Builder 11 月 30 日关停,平台会没,所以要导出进版本库、核心逻辑放在自己的接口后面。最后说我的做法:先用平台出原型,出现几个「该改成代码」的信号再迁移(明天的决策表)。

</details>

## 明天预告

明天是 [Day 337 · 低代码平台(二):接自有系统、跑评测,什么时候改成写代码](/blog/agent-zero/day-337-low-code-2/)。今天的流程还是「孤岛」:回复里没有客户真实的发票。明天写一个只读的 HTTP 接口把 CloudLedger 接给 n8n,看密钥怎么放、`localhost` 为什么会连不上;再用同一份 12 条用例给代码版和 n8n 版打分,最后给一张「什么时候该改成写代码」的判断表。
