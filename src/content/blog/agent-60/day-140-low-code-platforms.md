---
title: 'Day 140 · 低代码 Agent 平台实操:Dify、扣子、百炼、n8n,什么时候该改成写代码'
description: '国内 JD 里 Dify 出现得比 LangGraph 还频繁。今天把 Dify、扣子、阿里云百炼、n8n 在 2026 年 10 月的真实状态查清楚,把 CloudLedger 的工单分流在平台上搭一遍,写一个只读接口把业务数据接给平台,再用同一份用例给代码版和平台版打分。最后给一张「什么时候该从平台改成写代码」的判断表。'
pubDate: 2026-10-22
regime: none
tags: ['dify', 'coze', 'n8n', 'low-code', 'agent-60']
series: 'agent-60'
day: 140
lang: 'zh'
---

## 今天要解决的问题

这是专题篇的一课,**建议在 [Day 27 · 框架横评](/blog/agent-60/day-27-frameworks-compared/) 之后读**。专题篇可以跳着读。

Day 27 画过一张五层图,低代码平台在最上面一层,当时只用一段话带过:适合业务同学和快速验证,复杂逻辑表达力有限。这个判断我现在也不改,但只有判断不够用。我们 10 月抓的 881 条去重 JD 正文里,76 条点名了 Dify(约 9%),25 条提到 Coze,18 条提到 n8n,而且 Dify 那 76 条里绝大多数是国内岗位。很多 JD 的写法是「熟悉 Dify/Coze 等平台,有基于平台的落地经验者优先」。面试官问到的时候,只会说「低代码不如代码灵活」是过不了关的,你得真的搭过、知道它们现在能做到哪一步、知道它们在哪里会卡住你。

学完今天,你要能做到:

1. 说出 Dify、扣子(Coze)、阿里云百炼、n8n 在 2026 年 10 月各自的定位、开源协议和最近的大变化。
2. 把 CloudLedger 的「工单分类 → 查发票 → 起草回复」流程在 Dify 上搭出来,知道每个节点对应代码里的哪一段。
3. 写一个只读的 HTTP 接口,把自家业务数据安全地接给平台,并知道什么时候改用 MCP。
4. 用同一份评测用例同时给代码版和平台版打分,让平台搭的应用也进回归测试。
5. 用一张判断表回答「这件事该放在平台上还是写代码」,并在面试里讲清楚理由。

预计用时 4–6 小时(平台注册和点界面比写代码花时间)。前置:Day 23 的 `cloudledger.db`,Day 27 的分层图,Day 28 的六个工单类别。要做 Dify 自部署的话需要 Docker;没有 Docker 就用 Dify 云版或扣子,不影响今天的主线。

## 先说我的立场

我见过两种极端。一种是工程师看不上低代码,觉得拖拽是给不会写代码的人用的;另一种是公司里一个人用 Dify 拖了个客服机器人,老板觉得「这不是挺好的」,然后让它接住全部线上流量,半年后谁也不敢动。

我的看法是,平台和代码解决的是不同阶段的问题。需求还没定、要先给业务方看效果的时候,平台一下午能出一个能点的东西,代码要两三天;流程固定、要每天处理几万条、出错要能定位到哪一行的时候,代码的优势就出来了。很多公司实际的做法是两者并存:业务同学在 Dify 上维护内部的小工具和知识库问答,工程团队用代码写核心产品,两边通过 API 和 MCP 互相调用。

所以今天的目标不是让你选边站,而是让你在两边都能干活,并且知道边界在哪。

## 四个平台,2026 年 10 月的状态

这一节的版本号和日期都是我 10 月 22 日查的,平台迭代很快,你读到的时候先去官方页面核对一遍。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="四个平台的定位对比:横轴从面向业务人员到面向工程师,纵轴从只能用云版到可以自部署;Dify 和 n8n 偏工程且可自部署,扣子偏业务以云版为主但有开源版,百炼以云版为主">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <line x1="60" y1="220" x2="610" y2="220" stroke="var(--rule)"/>
  <line x1="60" y1="220" x2="60" y2="20" stroke="var(--rule)"/>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="60" y="238">面向业务同学</text>
    <text x="540" y="238">面向工程师</text>
    <text x="12" y="214">只有云版</text>
    <text x="12" y="34">能自部署</text>
  </g>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="380" y="40" width="130" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="445" y="60" text-anchor="middle" fill="var(--ink)">Dify 1.17</text>
    <text x="445" y="77" text-anchor="middle" font-size="10" fill="var(--ink-soft)">工作流 · Agent · 知识库</text>
    <rect x="470" y="104" width="120" height="46" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="530" y="124" text-anchor="middle" fill="var(--ink)">n8n 2.x</text>
    <text x="530" y="141" text-anchor="middle" font-size="10" fill="var(--ink-soft)">自动化 · 1500+ 集成</text>
    <rect x="110" y="90" width="150" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="185" y="110" text-anchor="middle" fill="var(--ink)">扣子 3.0</text>
    <text x="185" y="127" text-anchor="middle" font-size="10" fill="var(--ink-soft)">云版为主,另有开源版</text>
    <rect x="200" y="160" width="140" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="270" y="180" text-anchor="middle" fill="var(--ink)">阿里云百炼</text>
    <text x="270" y="197" text-anchor="middle" font-size="10" fill="var(--ink-soft)">智能体 · 工作流 · 高代码</text>
  </g>
</svg>
<figcaption>位置是我的主观判断,用来帮你记,不是精确测量。扣子的开源版 Coze Studio 可以自部署,但更新明显比云版慢。</figcaption>
</figure>

### Dify

[langgenius/dify](https://github.com/langgenius/dify) 是 GitHub 上星数最多的 LLM 应用平台之一,10 月查的时候是 15.9 万。最新正式版是 **1.17.1(2026-09-10)**。最近两个版本变化很大:

- **1.16.0(2026-07-17)** 推出了 Dify Agent(Beta)。官方说法是「像其他主流 Agent 一样跑在 Linux 沙箱里」:可以上传 Skills 和文件,装依赖,还能把这个 Agent 当作工作流里的一个节点用。发布说明里加粗写着,这个功能**只应该开放给可信的用户**,因为它能在沙箱里执行命令。
- **1.17.0(2026-08-25)** 继续补 Agent:沙箱后端可以换成 E2B 云沙箱;发布时给沙箱的 home 目录拍快照,之后每次运行从快照恢复;工作区级别的 Skill 管理,有草稿、发布、版本三个状态;长对话按模型的上下文窗口分层压缩,先清旧的工具结果,再总结更早的历史(和 Day 63 讲的思路一样);人工输入表单可以放进循环和迭代节点里;还有一个默认关闭的统一 tracing,先支持 Phoenix 和 LangSmith。
- **1.17.1** 有一条要特别注意的升级警告:自带的 Weaviate 向量库从 1.27.0 跳到 1.39.2,自部署的人必须按官方步骤分阶段升级,直接拉新镜像重启可能永久损坏向量检索。

MCP 方面,Dify 从 [1.6.0 开始支持双向 MCP](https://dify.ai/blog/v1-6-0-built-in-two-way-mcp-support):既能把外部 MCP server 加成工具,也能把一个 Dify 应用发布成 MCP server 给 Claude、Cursor 调用。发布出去的 MCP 地址本身就是凭证,要当 API key 一样保管。

协议要读一下。Dify 用的是**在 Apache 2.0 基础上加了条件的自定义协议**:可以商用,可以当企业内部的应用开发平台,但未经书面授权不能用源码运营多租户服务(一个工作区算一个租户),也不能去掉前端的 logo 和版权信息。如果你们公司想基于 Dify 做一个卖给客户的 SaaS,先找法务。

### 扣子(Coze)

扣子是字节跳动的平台,国内版在 [coze.cn](https://www.coze.cn/),海外版在 coze.com。据北京商报、IT 之家等媒体报道,**扣子 3.0 在 2026 年 6 月 1 日上线**,主打从「一个智能体」变成「人和多个智能体组成的团队」:可以自定义多个 Agent 组队,可以把本地的 Claude Code、Codex CLI、OpenClaw 接进同一个项目空间里协作,还带了金融、医疗、法律等行业的技能包。我没有找到字节官方的发布公告原文,另有一家网站说是 5 月 27 日在火山引擎的大会上发布的,日期以官方为准。

开源方面,字节在 2025 年 7 月开源了 [Coze Studio](https://github.com/coze-dev/coze-studio)(Apache 2.0),后端用 Go 写,Agent 和工作流的运行时建立在字节自己的 Eino 框架上(Day 141 会讲 Eino)。最低配置 2 核 4 GB,要 Docker。不过开源版的节奏明显慢于云版:最新版本是 **v0.5.1(2026-02-05)**,10 月查时最后一次提交是 7 月底。如果你看中的是扣子 3.0 的多智能体协作,那是云版的能力,开源版里没有。

扣子的 API 我查了官方文档:执行工作流是 POST 请求 `api.coze.cn/v1/workflow/run`(HTTPS),用 Bearer 访问令牌鉴权(需要有 run 权限),请求体里 `parameters` 是**序列化成字符串的 JSON**,返回的 `data` 也是字符串,要再解析一次。同步调用 90 秒收不到响应就超时,工作流整体限 10 分钟,官方建议控制在 5 分钟以内;异步执行只对付费套餐开放。

### 阿里云百炼

百炼是阿里云的模型服务平台,通义千问系列模型的官方入口,同时也能搭应用。按[官方文档](https://help.aliyun.com/zh/model-studio/user-guide/application-introduction)的说法,应用分三类:**智能体**(提示词驱动,自主决定调用知识库、MCP 等工具)、**工作流**(节点编排的固定流程)、**高代码应用**(用 Python 写后端服务再部署上去)。MCP 广场里标了 One Key 的服务不用单独开通,首次调用即生效,用同一个 `DASHSCOPE_API_KEY` 鉴权。

百炼的优势不在编排能力,而在和阿里云生态挨得近:模型、知识库、MCP 服务、计费都在一个控制台里,企业已经在用阿里云的话,采购和合规最省事。调用发布好的应用是 POST 请求 `dashscope.aliyuncs.com/api/v1/apps/{app_id}/completion`(HTTPS),问题放在 `input.prompt`,回答在 `output.text`。网上有说法提到百炼 2026 年推出了 Flow Agent 模板和「智能体 2.0」,我只在二手文章里看到,没有找到官方说明,先不展开。

### n8n

[n8n](https://github.com/n8n-io/n8n) 的出身和前三个不一样:它是一个通用的工作流自动化工具(类似 Zapier),有 1500 多个现成的集成节点,AI 能力是后来加上去的。所以它特别适合「触发 → 一堆系统之间搬数据 → 中间某一步用 AI 判断」这种场景,和昨天 Day 139 讲的后台 Agent 是一个路数。

几个事实:2.0 在 2025 年 12 月发布(先发了 beta),官方定位是「加固版本」:默认更安全的配置、移除旧选项、高负载性能,不是功能更新。10 月 21 日的稳定版是 2.44.5。AI 相关的节点有 AI Agent(把模型、记忆、工具、向量库组合成一个 Agent)、MCP Client Tool(调用任意 MCP server 的工具),以及 [MCP Server Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger/)(把 n8n 工作流暴露成 MCP server,支持 SSE 和 Streamable HTTP,鉴权可选 Bearer 或自定义 Header)。

协议同样要看:n8n 是 **fair-code**,用的是自己的 Sustainable Use License,源码公开,内部使用和自部署都可以,但不是 OSI 认可的开源协议,拿它做竞品服务卖给别人是不行的;带 `.ee.` 的企业功能文件需要企业授权。

### 两个提醒:平台会变,也会没

平台风险不是理论上的。今年就有两个例子:

- **Flowise**(另一个流行的拖拽式 LLM 应用工具,2025 年 8 月被 Workday 收购)在 2026 年 7 月 29 日宣布冻结开发,8 月 10 日 GitHub 仓库转为只读归档,npm 包和 Docker 镜像标记为弃用,8 月 31 日核心团队退出社区。代码还在,Apache 2.0,可以 fork,但不会再有安全补丁。详见 [flowiseai.com/sunset](https://flowiseai.com/sunset)。
- **OpenAI Agent Builder**:按 [OpenAI 弃用说明](https://developers.openai.com/api/docs/deprecations),2026 年 6 月 3 日通知开发者,**11 月 30 日关停**,官方给的去处是改用 Agents SDK 写代码,或者用 ChatGPT 里的 Workspace Agents。同一天宣布的还有 Evals 平台:10 月 31 日起只读,11 月 30 日关停,迁移指南指向 Promptfoo。

这两件事给你的教训很具体:在平台上搭的东西,要能导出(Dify 的 DSL、n8n 的工作流 JSON),要进版本库,核心逻辑最好放在你自己的接口后面,平台只负责编排。这样平台没了,你换一个编排层就行,不用从头再来。

## 同一个流程,画出来和写出来

拿 CloudLedger 的一个真实需求来搭:客服粘贴一段工单正文,系统给出类别;如果是退款或账单类,顺便查出这个客户最近的发票;最后起草一段回复。我用 Dify 的工作流来演示,扣子和百炼的工作流节点名字不同,思路一样。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="Dify 工作流画布:开始节点、LLM 分类节点、条件分支、HTTP 请求节点查发票、LLM 起草节点、结束节点;下方对应代码里的函数">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="10" y="40" width="70" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="45" y="64" fill="var(--ink)">开始</text>
    <rect x="100" y="40" width="90" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="145" y="58" fill="var(--ink)">LLM</text><text x="145" y="73" font-size="10" fill="var(--ink-soft)">分类</text>
    <rect x="210" y="40" width="90" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="255" y="58" fill="var(--ink)">条件分支</text><text x="255" y="73" font-size="10" fill="var(--ink-soft)">refund/billing?</text>
    <rect x="320" y="10" width="100" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="370" y="28" fill="var(--ink)">HTTP 请求</text><text x="370" y="43" font-size="10" fill="var(--ink-soft)">查发票</text>
    <rect x="440" y="40" width="90" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="485" y="58" fill="var(--ink)">LLM</text><text x="485" y="73" font-size="10" fill="var(--ink-soft)">起草</text>
    <rect x="550" y="40" width="80" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="590" y="64" fill="var(--ink)">结束</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="80" y1="60" x2="100" y2="60"/><line x1="190" y1="60" x2="210" y2="60"/>
    <line x1="300" y1="52" x2="320" y2="32"/><line x1="420" y1="32" x2="440" y2="52"/>
    <line x1="300" y1="68" x2="440" y2="68"/><line x1="530" y1="60" x2="550" y2="60"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="340" y="84">其他类别直接去起草</text>
  </g>
  <line x1="10" y1="110" x2="630" y2="110" stroke="var(--rule)" stroke-dasharray="3 3"/>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
    <text x="10" y="134">对应到代码:</text>
    <text x="10" y="156">classify(text) → if category in ("refund","billing"): invoices = api.list_invoices(cid)</text>
    <text x="10" y="178">reply = draft(text, category, invoices) → return {"category": …, "reply": …}</text>
    <text x="10" y="206" fill="var(--ink-faint)">画布上 6 个节点,代码里大约 30 行。差别不在长度,在于测试、版本和调试方式。</text>
  </g>
</svg>
<figcaption>琥珀色的 HTTP 节点是「伸到你自己系统里」的那只手,下一节专门讲怎么把它做安全。</figcaption>
</figure>

在 Dify 里搭这个流程的步骤(云版和自部署界面一样):

1. **建应用。** 工作室 → 创建空白应用 → 类型选「工作流」(不是「对话流」,我们不需要多轮记忆)。
2. **开始节点。** 加一个输入变量 `ticket_text`,类型选段落。后面评测脚本就是按这个名字传参的。
3. **LLM 节点做分类。** 模型选你在「设置 → 模型供应商」里配好的那个(DeepSeek、通义都有官方插件)。提示词里写清楚六个类别各指什么,把开始节点的 `ticket_text` 用变量插进来。输出格式打开结构化输出(JSON Schema),定义一个 `category` 字段,枚举六个值。如果你选的模型不支持 JSON Schema,退一步在提示词里要求「只输出 JSON」,后面加一个代码节点解析。
4. **条件分支。** 条件写「分类节点的 category 等于 refund 或 billing」。
5. **HTTP 请求节点。** 在 IF 分支上调下一节写的 CloudLedger 只读接口,方法 GET,地址填 `{你的公网地址}/customers/{客户号}/invoices?limit=5`,Header 里加 `Authorization: Bearer {令牌}`。令牌不要直接写在节点里,放进工作流的「环境变量」,类型选 secret。
6. **第二个 LLM 节点起草回复。** 两个分支在这里汇合。提示词里引用工单原文、类别,以及 HTTP 节点的返回体(ELSE 分支上这个变量为空,提示词里写一句「没有发票信息时不要编造金额」)。
7. **结束节点。** 输出两个变量:`category` 和 `reply`。名字要和评测脚本里读的一致。
8. **发布,拿 API 密钥。** 右上角发布,然后在「访问 API」页面生成一个密钥。云版的接口根地址是 `api.dify.ai/v1`(HTTPS),自部署的是你自己的域名加 `/v1`。
9. **导出 DSL。** 应用菜单里有「导出 DSL」,得到一个 YAML 文件。把它提交进你的仓库。下次改了画布,再导出一次,`git diff` 就能看到改了哪个节点的哪句提示词。这一步很多人不做,出了问题就说不清楚是谁、什么时候改坏的。

扣子的工作流对应关系是:开始节点 → 大模型节点 → 选择器 → 插件或 HTTP 节点 → 大模型节点 → 结束节点。百炼的工作流应用类似。n8n 则是 Webhook 或 Manual Trigger → Basic LLM Chain / AI Agent → If → HTTP Request → LLM → Respond to Webhook。

画完你会发现,画布上这 6 个节点对应的代码大概 30 行。差别不在长度。代码可以写单元测试、可以在 IDE 里打断点、可以 code review、可以和别的代码共享一个函数;画布可以让不写代码的同事看懂和改动、可以在界面上点每个节点看输入输出。这就是两者真正的取舍。

## 把 CloudLedger 接给平台

平台搭的流程迟早要读你们自己的数据。有两条路:给平台一个 HTTP 接口,或者给它一个 MCP server。

**HTTP 接口**是最通用的:四个平台都有 HTTP 请求节点,Dify 和扣子还能直接导入 OpenAPI 文档生成自定义工具/插件。FastAPI 天生会生成 OpenAPI 文档(`/openapi.json`),正好对上。

下面这个接口只做两件事:按工单号查工单,按客户号查最近的发票。全部只读。

```python
# agent-60-lab/topics/low-code/cloudledger_api.py
"""给低代码平台的「HTTP 请求」节点调用的只读接口。
运行:uv run uvicorn cloudledger_api:app --port 8140
"""
import os
import sqlite3
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException

load_dotenv()
DB = Path(__file__).parents[2] / "w4" / "cloudledger" / "cloudledger.db"
TOKEN = os.environ.get("PLATFORM_TOKEN", "change-me")

app = FastAPI(title="CloudLedger read-only API")


def auth(authorization: str = Header(default="")) -> None:
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "bad token")


def query(sql: str, *args) -> list[dict]:
    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)  # 只读打开,平台那边写错了也改不了库
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, args).fetchall()]
    finally:
        conn.close()


@app.get("/tickets/{ticket_id}", dependencies=[Depends(auth)])
def get_ticket(ticket_id: str) -> dict:
    rows = query("SELECT id, customer_id, subject, body, status FROM tickets WHERE id = ?", ticket_id)
    if not rows:
        raise HTTPException(404, "ticket not found")
    return rows[0]


@app.get("/customers/{customer_id}/invoices", dependencies=[Depends(auth)])
def list_invoices(customer_id: str, limit: int = 5) -> list[dict]:
    return query(
        "SELECT id, amount_cents, status, issued_at FROM invoices WHERE customer_id = ? "
        "ORDER BY issued_at DESC, id DESC LIMIT ?",
        customer_id, min(limit, 20),
    )
```

<div class="line-notes">

- `DB = Path(__file__).parents[2] / "w4" / "cloudledger" / "cloudledger.db"` 文件在 `topics/low-code/` 下,`parents[0]` 是 `low-code`,`parents[1]` 是 `topics`,`parents[2]` 是练习仓根目录。
- `TOKEN = os.environ.get("PLATFORM_TOKEN", "change-me")` 给平台用的令牌,和你自己调模型的 key 分开。将来平台账号泄露或者有人离职,只换这一个就行。
- `app = FastAPI(title="CloudLedger read-only API")` title 会出现在 `/openapi.json` 里。实测启动后访问 `/openapi.json` 返回 200,把这个地址或者文件内容贴进 Dify 的「工具 → 自定义工具」,它会按文档生成两个工具。
- `def auth(authorization: str = Header(default="")) -> None:` 默认值给空字符串,这样缺 Header 时走到下面的比较,统一回 401,而不是 FastAPI 自动回的 422。对外的接口,报错信息越少越好。
- `raise HTTPException(401, "bad token")` 实测不带令牌请求 `/tickets/T1041`,返回 `{"detail":"bad token"}`。
- `conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)  # 只读打开,平台那边写错了也改不了库` 这是这个文件里最重要的一行。平台上的提示词、节点配置是别人也能改的,哪怕接口代码里只有 SELECT,也要在连接层再锁一道。换成 Postgres 的话,就是给这个接口单独建一个只有 SELECT 权限的数据库账号。
- `return [dict(r) for r in conn.execute(sql, args).fetchall()]` `sqlite3.Row` 转成普通字典,FastAPI 才能序列化成 JSON。
- `@app.get("/tickets/{ticket_id}", dependencies=[Depends(auth)])` 鉴权挂在路由上,每个接口都要写。漏写一个就是一个没锁的门,练习 3 让你改成全局依赖。
- `raise HTTPException(404, "ticket not found")` 实测请求 T9999 返回 `{"detail":"ticket not found"}`。返回 404 而不是 200 加空对象,平台的 HTTP 节点能据此走失败分支。
- `def list_invoices(customer_id: str, limit: int = 5) -> list[dict]:` 实测 `GET /customers/C007/invoices?limit=3` 返回三张,前两张就是 T1041 里说的重复扣款:`INV-2026-0123` 和 `INV-2026-0026`,都是 239200 分、10 月 8 日、paid。
- `customer_id, min(limit, 20),` 上限写死 20。平台那边有人把 limit 填成 100000,你的接口也不会把整张表吐出去。

</div>

起服务和测试:

```bash
cd agent-60-lab/topics/low-code
uv run uvicorn cloudledger_api:app --port 8140
# 另一个终端
curl -s localhost:8140/tickets/T1041
curl -s -H "Authorization: Bearer change-me" localhost:8140/tickets/T1041
curl -s -H "Authorization: Bearer change-me" "localhost:8140/customers/C007/invoices?limit=3"
```

第一条返回 `{"detail":"bad token"}`,第二条返回 T1041 的工单内容,第三条返回 C007 最近三张发票。

**平台怎么访问到你本机?** 云版的 Dify、扣子、百炼都在公网上,访问不到你的 `localhost:8140`。本地学习时可以用 Cloudflare 的 [Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/):装好 `cloudflared` 后运行 `cloudflared tunnel --url http://localhost:8140`,会给你一个形如 `xxx.trycloudflare.com` 的临时 HTTPS 地址,填进平台的 HTTP 节点。这个地址是公开的,所以令牌一定要改掉默认值。自部署的 Dify 跑在 Docker 里时,容器访问宿主机要用 `host.docker.internal` 而不是 `localhost`。生产环境就是正常地把接口部署到内网或公网,平台到接口之间走 HTTPS 加令牌,能加 IP 白名单更好。

**什么时候改用 MCP?** 当你要接的不止一个平台、而且同一套工具还要给 Claude Code、Cursor 或者你自己的 Agent 用的时候。Day 23 写的 CloudLedger MCP server 用 Streamable HTTP 方式跑起来,Dify 1.6 以上、n8n 的 MCP Client Tool、百炼的自定义 MCP 都能接。有一个坑要提前知道:Day 22 讲过,我们用的 `mcp` 2.3.0 默认协议版本是 2026-07-28,而 Dify 1.6.0 发布时公告里写的是只支持 2025-03-26 版本的 HTTP MCP server。平台后来有没有跟进新规范,我没有实测。如果接上以后列不出工具,先看两边协商的协议版本。

还有一条原则:**写操作不要直接开给平台**。退款、改订阅这类有后果的动作,要么根本不暴露给平台,要么像 Day 25 一样只允许「创建待审批的申请」,真正执行的那一步留在你自己的系统里,由人审批。平台上的提示词谁都能改,你没法对它做代码审查。

## 平台上的应用也要跑评测

Day 29 说过,没有评测的 Agent 只是 demo。这条对平台搭的应用同样成立,而且更重要:平台上改一句提示词不需要走 code review,也没有 CI,改坏了往往要等客户投诉才知道。

好在四个平台都能通过 API 调用。只要把「调用一次」包成一个函数,你在 Day 29 到 Day 35 建的那套评测就能原样用上。下面这个脚本用 12 条手写用例,同时支持四种后端:

```text
# agent-60-lab/topics/low-code/cases.jsonl(节选,共 12 行)
{"id": "c01", "text": "10 月 8 号被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一样,把多扣的退给我", "category": "refund"}
{"id": "c03", "text": "这个月账单怎么比上个月多了 300 块,我没加席位啊", "category": "billing"}
{"id": "c05", "text": "发票抬头写成了旧公司名,麻烦改成北京云杉科技有限公司", "category": "invoice"}
{"id": "c07", "text": "导出报表一直转圈,最后提示 E1043", "category": "bug"}
{"id": "c09", "text": "验证码一直提示过期,试了五六次登不上去", "category": "account"}
{"id": "c11", "text": "你们支持和金蝶对接吗", "category": "other"}
{"id": "c12", "text": "请帮我取消订阅,不要再自动续费了", "category": "billing"}
```

完整 12 条是:c01、c02 退款(重复扣款、年付中途退),c03、c04 账单(金额变多、升级差价),c05、c06 发票(改抬头、补税号),c07、c08 故障(E1043、App 闪退),c09、c10 账号(验证码、转移主账号),c11 其他(对接金蝶),c12 账单(取消续费)。

```python
# agent-60-lab/topics/low-code/triage_eval.py
"""同一份工单分类用例,分别跑代码版、Dify 工作流、扣子工作流,比准确率和耗时。

  uv run python triage_eval.py code
  uv run python triage_eval.py dify     # 需要 DIFY_BASE_URL、DIFY_API_KEY
  uv run python triage_eval.py coze     # 需要 COZE_API_TOKEN、COZE_WORKFLOW_ID
  uv run python triage_eval.py bailian  # 需要 DASHSCOPE_API_KEY、BAILIAN_APP_ID
"""
import json
import os
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
CASES = Path(__file__).with_name("cases.jsonl")
PROMPT = (
    "你是云簿 CloudLedger 的工单分诊员。把工单分到下面一类,只输出 JSON,形如 {\"category\": \"refund\"}。\n"
    "refund=要求退钱;billing=扣费金额、套餐升降级、取消续费;invoice=开票改票;"
    "bug=功能报错或崩溃;account=登录、账号、权限;other=其他。\n\n工单:"
)


def classify_code(text: str) -> str:
    client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "user", "content": PROMPT + text}],
        response_format={"type": "json_object"},
        temperature=0,
        extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
    )
    return json.loads(resp.choices[0].message.content or "{}").get("category", "")


def classify_dify(text: str) -> str:
    r = httpx.post(
        f"{os.environ['DIFY_BASE_URL']}/workflows/run",
        headers={"Authorization": f"Bearer {os.environ['DIFY_API_KEY']}"},
        json={"inputs": {"ticket_text": text}, "response_mode": "blocking", "user": "eval-bot"},
        timeout=100,
    )
    r.raise_for_status()
    data = r.json()["data"]
    if data["status"] != "succeeded":
        raise RuntimeError(data["error"])
    return data["outputs"]["category"]


def classify_coze(text: str) -> str:
    r = httpx.post(
        "https://api.coze.cn/v1/workflow/run",
        headers={"Authorization": f"Bearer {os.environ['COZE_API_TOKEN']}"},
        json={"workflow_id": os.environ["COZE_WORKFLOW_ID"], "parameters": json.dumps({"ticket_text": text})},
        timeout=90,
    )
    body = r.json()
    if body["code"] != 0:
        raise RuntimeError(f"{body['code']} {body['msg']}")
    return json.loads(body["data"])["category"]  # data 是 JSON 字符串,要再解析一次


def classify_bailian(text: str) -> str:
    r = httpx.post(
        f"https://dashscope.aliyuncs.com/api/v1/apps/{os.environ['BAILIAN_APP_ID']}/completion",
        headers={"Authorization": f"Bearer {os.environ['DASHSCOPE_API_KEY']}"},
        json={"input": {"prompt": text}, "parameters": {}, "debug": {}},
        timeout=90,
    )
    r.raise_for_status()
    return json.loads(r.json()["output"]["text"])["category"]  # 智能体的系统提示词里要求它只输出 JSON


def main() -> None:
    backend = sys.argv[1]
    classify = {"code": classify_code, "dify": classify_dify, "coze": classify_coze, "bailian": classify_bailian}[backend]
    cases = [json.loads(line) for line in CASES.read_text(encoding="utf-8").splitlines() if line.strip()]
    right, seconds = 0, []
    for c in cases:
        t0 = time.perf_counter()
        try:
            got = classify(c["text"])
        except Exception as e:  # noqa: BLE001
            got = f"ERROR {e}"
        seconds.append(time.perf_counter() - t0)
        ok = got == c["category"]
        right += ok
        if not ok:
            print(f"✗ {c['id']} 期望 {c['category']},得到 {got}:{c['text']}")
    print(f"{backend}: {right}/{len(cases)} 正确,平均 {sum(seconds) / len(seconds):.2f} 秒/条")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `CASES = Path(__file__).with_name("cases.jsonl")` 用例文件和脚本放在一起。将来平台版和代码版共用这一份,改用例只改一处。
- `"refund=要求退钱;billing=扣费金额、套餐升降级、取消续费;invoice=开票改票;"` 每个类别是什么意思写进提示词。c12「取消订阅」按 Day 28 的口径是 billing,不写清楚的话模型很容易分到 account:Day 139 的后台 Agent 提示词里没写类别定义,T1003(内容同样是取消订阅)就被分成了 account。平台版的 LLM 节点也要贴同一段定义,否则两边比的就不是同一件事。
- `client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])` 每次调用都新建客户端,写法最简单,代价是不能复用连接。12 条无所谓,上千条时挪到函数外面。
- `response_format={"type": "json_object"},` JSON mode,只保证输出是合法 JSON,不保证字段对。Day 6 讲过它和 JSON Schema 的区别。实测「请帮我取消订阅」这条:输入 126 token、输出 7 token,返回 `{"category": "billing"}`。按 deepseek-flash 的价格,126×2 + 7×8 = 308,除以一百万约 0.0003 元一条。
- `return json.loads(resp.choices[0].message.content or "{}").get("category", "")` 解析失败的情况这里没处理,会抛异常,被下面 main 里的 except 接住记成 ERROR。
- `json={"inputs": {"ticket_text": text}, "response_mode": "blocking", "user": "eval-bot"},` 对着 Dify 官方的 Run Workflow 接口写:`inputs` 的键要和开始节点的变量名一模一样;`user` 必填,是终端用户标识,评测时固定写一个,方便在 Dify 日志里筛出评测流量。
- `timeout=100,` Dify 云版文档写明 blocking 模式经过 Cloudflare,100 秒超时。工作流更长就要改用 streaming。
- `if data["status"] != "succeeded":` 工作流跑失败时 HTTP 状态码可能还是 200,真正的状态在 `data.status` 里。只看 `raise_for_status()` 会漏掉这种失败。
- `return data["outputs"]["category"]` 对应结束节点里定义的输出变量名。
- `json={"workflow_id": os.environ["COZE_WORKFLOW_ID"], "parameters": json.dumps({"ticket_text": text})},` 扣子的 `parameters` 要的是**字符串**,所以先 `json.dumps`。直接传字典是很多人第一次调扣子 API 时踩的坑。
- `if body["code"] != 0:` 扣子的错误靠响应体里的 `code` 表示,0 才是成功。
- `return json.loads(body["data"])["category"]  # data 是 JSON 字符串,要再解析一次` 返回值同样是字符串,要再解析一层。
- `json={"input": {"prompt": text}, "parameters": {}, "debug": {}},` 百炼智能体应用的调用格式,来自官方 API 参考页的 curl 示例。
- `return json.loads(r.json()["output"]["text"])["category"]  # 智能体的系统提示词里要求它只输出 JSON` 智能体应用返回的是自由文本,所以要在它的提示词里要求只输出 JSON。如果它偶尔多说一句话,这里就会解析失败。百炼的工作流应用调用方式不同,用工作流的话按官方文档改这个函数。
- `classify = {"code": classify_code, "dify": classify_dify, "coze": classify_coze, "bailian": classify_bailian}[backend]` 后端只是一个函数,换平台只换这一个。这就是把评测和被测对象解耦。
- `got = f"ERROR {e}"` 调用出错也记一条失败,不让一个异常打断整轮评测。实测没配 `DIFY_BASE_URL` 时跑 dify 后端,每条都打印 `得到 ERROR 'DIFY_BASE_URL'`,最后 `dify: 0/12 正确`。
- `right += ok` 布尔值当 0 和 1 加。
- `print(f"{backend}: {right}/{len(cases)} 正确,平均 {sum(seconds) / len(seconds):.2f} 秒/条")` 实测代码版跑了三次,都是 `12/12`,平均每条 0.6 到 0.9 秒。

</div>

我只实跑了代码版。Dify、扣子、百炼三个后端的请求格式是对照各家官方 API 文档写的,我手上没有可用的账号去跑,所以没有分数可以给你。你搭好平台版以后跑一下,把结果填进下面这张表:

| 后端 | 正确数 / 12 | 平均秒 / 条 | 备注 |
| --- | --- | --- | --- |
| code(deepseek-flash) | 12(实测三次) | 0.6–0.9 | |
| dify | | | |
| coze | | | |
| bailian | | | |

如果平台版分数明显低于代码版,先检查两边的提示词和类别定义是不是一样、平台节点选的模型是不是同一个、温度有没有设成 0。很多「平台不如代码」的结论,其实比的根本不是同一个东西。

把这个脚本放进 CI,每天或者每次有人改了平台上的工作流之后跑一次,平台应用就有了回归门禁。Dify 的 DSL 文件进了版本库以后,还可以做到「DSL 有改动就自动触发评测」。

## 什么时候该改成写代码

最后是最常被问到的问题。我自己的判断表:

| 信号 | 继续用平台 | 该改成代码了 |
| --- | --- | --- |
| 谁在维护 | 业务同学、运营 | 工程团队,而且已经有人在画布里写大段代码节点 |
| 流程复杂度 | 十几个节点以内,分支清楚 | 节点上百、嵌套循环、多处共享逻辑要复制粘贴 |
| 出错的代价 | 内部工具,错了重来 | 面向客户、涉及钱、要审计 |
| 测试和发布 | 手点几次能确认 | 需要单元测试、灰度、回滚到某个版本 |
| 性能 | 每天几百次调用 | 每秒几十次以上,或者对延迟敏感 |
| 调试 | 看节点输入输出就够 | 要打断点、看完整 trace、复现某一次线上请求 |
| 依赖 | 平台自带的模型和工具够用 | 要接公司内部的鉴权、消息队列、数据权限体系 |
| 平台风险 | 能接受,有导出 | 平台的协议、价格、存续对业务有实质影响 |

不需要所有信号都满足。我的经验是,出现两三个「该改成代码」的信号,就该开始规划迁移了。迁移也不必一次到位:先把平台上最复杂、最关键的那几个节点抽成你自己的 HTTP 接口或 MCP 工具(上面写的 `cloudledger_api.py` 就是这种形态),平台只负责编排;等编排本身也成了瓶颈,再用 LangGraph 或者纯代码把整个流程接过来。评测脚本不用改,`triage_eval.py code` 和 `triage_eval.py dify` 的分数可以一直对比着看,确认迁移没有让效果变差。

反过来也成立:有些已经用代码写好的能力,可以发布给平台用。Dify 可以把外部 MCP server 加成工具,n8n 可以用 MCP Client Tool 调用,业务同学在平台上拼自己的小流程,不用每次都来找工程师。

## 面试里怎么聊

面试官问「你用过 Dify 吗,怎么看低代码平台」,我建议按这个顺序答,每一点都带上你自己做过的事:

先说定位。低代码平台和编排框架不在同一层,前者面向快速验证和非工程人员,后者面向工程团队的可控性。再说你怎么用过:比如「我在 Dify 上搭过工单分类和回复起草的工作流,用 HTTP 节点接了自己写的只读接口」。然后说工程化:「平台应用我也跑了评测,同一份 12 条用例,代码版和平台版对比分数和延迟;工作流 DSL 进了版本库」。最后说边界和迁移:「当流程复杂到要在代码节点里写大量逻辑、或者面向客户需要审计时,我会把关键逻辑抽成接口,逐步迁到代码,迁移前后用同一份评测集比较」。

这样答有两个好处:说明你不是只会拖拽,也说明你不排斥平台。国内很多岗位的真实工作就是「把业务同学在 Dify 上验证过的东西,用工程的方式做成产品」,这个回答正好对上。

## 动手练习

1. **在一个平台上把流程搭出来。** Dify 云版、自部署 Dify、扣子任选其一,按正文「同一个流程」一节的步骤搭工单分类工作流(至少包含开始、LLM 分类、结束三个节点;有余力把条件分支、HTTP 节点、起草节点也加上)。验收:在平台界面里测试运行 c01 和 c12 两条,类别分别是 refund 和 billing;导出 DSL(或扣子、n8n 的等价导出文件)并提交到你的练习仓。

2. **让平台版进评测。** 发布工作流,拿到 API 密钥,在 `.env` 里配好对应的环境变量,跑 `triage_eval.py` 的对应后端。验收:脚本输出 `x/12 正确`,填进正文那张表。如果低于 12,逐条看错在哪,修改平台上的提示词再跑,直到和代码版持平。

3. **把接口的鉴权改成全局。** 现在 `cloudledger_api.py` 每个路由都要写 `dependencies=[Depends(auth)]`。改成 `FastAPI(dependencies=[Depends(auth)])` 全局生效,再新增一个 `/customers/{customer_id}/subscription` 接口。验收:新接口不写任何鉴权代码,不带令牌访问也返回 401;用 `curl` 证明。

4. **接上 HTTP 节点。** 用 `cloudflared tunnel --url http://localhost:8140` 把接口暴露出去,把练习 1 的工作流补上「refund 和 billing 类查发票」的分支,起草节点引用发票数据。验收:测试运行 c01,起草出的回复里出现了 `INV-2026-0123` 或 `INV-2026-0026` 中至少一个发票号,并且没有编造金额以外的发票。

5. **写一份迁移评估。** 假设练习 1 的工作流已经在你们公司跑了半年,现在每天 5000 次调用,客服团队想加「退款自动建单」功能。用正文的判断表逐条评估,写一页文档:哪些信号已经出现、迁移的第一步做什么、怎么证明迁移后效果没变差。验收:文档里至少引用了判断表的四条,并给出了「先抽哪个节点成接口」的具体建议。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 低代码平台 | 用拖拽节点、填表单的方式搭建应用的平台,必要时可以插入少量代码。今天说的 Dify、扣子、百炼、n8n 都是 |
| 工作流 / 对话流 | Dify 的两种应用类型。工作流是一次输入一次输出的固定流程;对话流带多轮会话记忆,适合聊天场景 |
| DSL | Domain Specific Language,这里指 Dify 把应用导出成的 YAML 文件,包含所有节点、连线和提示词,可以进版本库、可以导入另一个实例 |
| 自定义工具 / 插件 | 平台上「伸到外部系统」的能力。Dify 叫自定义工具,扣子叫插件,都可以从 OpenAPI 文档生成 |
| OpenAPI | 描述 HTTP 接口的标准格式(以前叫 Swagger)。FastAPI 会自动在 `/openapi.json` 生成 |
| fair-code | n8n 采用的授权模式:源码公开、可以自部署和内部使用,但限制用它做竞争性的商业服务。不是 OSI 认可的开源协议 |
| Sustainable Use License | n8n 的具体授权协议名 |
| Coze Studio | 扣子开源出来的核心引擎,Apache 2.0,Go 写的后端,可以自部署,功能少于云版 |
| Quick Tunnel | Cloudflare 提供的临时隧道,一条命令给本地服务分配一个公网 HTTPS 地址,适合开发测试 |
| 平台锁定 | 业务逻辑深度依赖某个平台的私有格式和功能,平台变价、变规则或停服时迁移成本很高 |

## 常见误区

**用低代码就不用评测了。** 平台上改提示词没有 code review、没有 CI,恰恰更需要评测兜底。所有平台都能 API 调用,评测脚本加一个后端函数就能用上。

**平台版和代码版直接比分数。** 提示词、类别定义、模型、温度只要有一个不一样,比出来的结论就没有意义。先对齐这些再比。

**把写权限直接开给平台。** 平台上的配置是很多人都能改的,出了问题很难追溯。业务库要只读,有后果的动作只允许创建待审批的申请。

**平台上的东西不导出、不进版本库。** Flowise 停更、OpenAI Agent Builder 关停都发生在今年。能导出的(Dify DSL、n8n JSON)定期导出提交;导不出来的,核心逻辑放到自己的接口后面。

**没看开源协议就拿去做产品。** Dify 的协议禁止未授权的多租户运营,n8n 的协议限制竞争性商用。公司要基于它们做对外产品,先让法务看。

**认为开源版和云版能力一样。** 扣子 3.0 的多智能体协作是云版的能力,Coze Studio 开源版最近一次发版是 2 月。选型时按你实际能部署的那个版本评估。

**一出现复杂需求就推倒重写。** 先把关键节点抽成接口,平台只做编排,用同一份评测集确认效果没有变化,再决定要不要整体迁移。

## 学习资料

### 文档与文章

- [Dify 官方文档](https://docs.dify.ai/):先看工作流节点和「Developing with APIs」两部分,1 小时。
- [Dify · Run Workflow API](https://docs.dify.ai/en/api-reference/workflow-runs/run-workflow):今天评测脚本对照的接口文档,注意 blocking 模式 100 秒的超时说明,10 分钟。
- [Dify 1.17.0 发布说明](https://github.com/langgenius/dify/releases/tag/1.17.0) 和 [Dify Agent 文档](https://docs.dify.ai/en/self-host/use-dify/build/new-agent/overview):Agent 沙箱、Skill 管理、上下文压缩这些新能力的原文,20 分钟。
- [Dify · v1.6.0 双向 MCP](https://dify.ai/blog/v1-6-0-built-in-two-way-mcp-support) 与 [发布为 MCP server](https://docs.dify.ai/en/use-dify/publish/publish-mcp):把 Dify 应用给 Claude、Cursor 用,15 分钟。
- [Dify 开源协议](https://github.com/langgenius/dify/blob/main/LICENSE):两条附加条件,5 分钟读完,省得以后踩坑。
- [扣子 · 执行工作流 API](https://docs.coze.cn/developer_guides/workflow_run):`parameters` 是字符串、同步 90 秒超时这些细节都在这里,15 分钟。
- [阿里云百炼 · 应用介绍](https://help.aliyun.com/zh/model-studio/user-guide/application-introduction)、[应用调用](https://help.aliyun.com/zh/model-studio/application-calling-guide) 与 [MCP 广场](https://help.aliyun.com/zh/model-studio/official-and-third-party-mcp):三类应用的区别和调用格式,30 分钟。
- [n8n · AI Agent 节点](https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/)、[MCP Server Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-langchain.mcptrigger/) 与 [2.0 破坏性变更](https://docs.n8n.io/changelog/v20-breaking-changes):30 分钟。
- [OpenAI · Deprecations](https://developers.openai.com/api/docs/deprecations) 与 [Flowise · The Future of Flowise](https://flowiseai.com/sunset):两个平台停服的官方说明,当作风险案例读,10 分钟。
- 北京商报《扣子 3.0 正式上线》([链接](https://www.bbtnews.com.cn/2026/0601/594940.shtml))和 [IT 之家的报道](https://www.ithome.com/0/958/372.htm):扣子 3.0 功能的媒体描述,不是官方公告,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV116w5zuEbo&autoplay=0&high_quality=1" title="黑马程序员零基础玩转Dify,5小时极速入门Agent开发" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>黑马程序员 · 零基础玩转 Dify,5 小时极速入门 Agent 开发 · 29 个分 P,2026 年 3 月,播放量过百万。不用全看,挑工作流节点、知识库、Text2SQL 那几 P,用来补今天练习 1 的界面操作。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1VvVo6XErm&autoplay=0&high_quality=1" title="「我看谁不学Coze3.0」扣子3.0炸了!之前学的2.5会白费吗?2个核心变动深度解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>麦当mdldm · 扣子 3.0 的 2 个核心变动解析 · 8 分钟,6 月 1 日上线当天的解读,快速了解 3.0 和 2.5 的差别。</figcaption>
</figure>

- 小工蚁创始人《Dify V1.17.0发布又有哪些新功能》(B 站 BV1fg8Q6HE9S,3 分钟):1.17 新功能速览。
- 陶渊xiao明《AI工作流 Plus! n8n MCP 新玩法!完整部署 + 实战演示》(B 站 BV1emMezoEGm,14 分钟):n8n 接 MCP 的完整演示。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dJ34OU_JY7Y" title="Dify Quickstart Guide: Build Your First AI Workflow" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Dify 官方 · Dify Quickstart Guide: Build Your First AI Workflow · 官方的第一个工作流教程,节点怎么连、变量怎么引用,跟着做一遍就能完成练习 1 的骨架。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/P5x0nsY8hCg" title="When to use the New Agents vs A workflow with AI" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>n8n 官方 · When to use the New Agents vs A workflow with AI · n8n 自己讲什么时候用 Agent 节点、什么时候用固定工作流加一步 AI,和 Day 13 的 workflow vs agent 讨论是同一件事。</figcaption>
</figure>

- n8n 官方《n8n Quick Start Tutorial: Build Your First AI Agent [2026]》(YouTube,按标题搜索):n8n 2.x 的入门教程。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 1 章「Planning AI Applications」和第 4 章里的「Model Build Versus Buy」:讲自建还是用现成服务的判断方法,和今天的判断表是同一个问题的两个层面。第 10 章「AI Engineering Architecture」讲怎么从最简单的架构一步步加组件,适合配合「先抽接口、再迁移」的思路读。
- 低代码平台迭代太快,目前没有我能推荐的、内容还没过时的专门书籍。以官方文档和发布说明为准。

### 开源项目与代码

- [langgenius/dify](https://github.com/langgenius/dify):`docker/` 目录下是自部署用的 compose 文件,README 写了最低配置(2 核、4 GiB 内存)。
- [coze-dev/coze-studio](https://github.com/coze-dev/coze-studio):扣子开源版,Go 后端,想看一个工作流引擎怎么实现可以读它的后端代码。
- [n8n-io/n8n](https://github.com/n8n-io/n8n):README 里有 Docker 一行启动命令;不用 Docker 的话按[官方 npm 安装文档](https://docs.n8n.io/hosting/installation/npm/),主分支的 `package.json` 要求 Node 24 以上。
- [cloudflare/cloudflared](https://github.com/cloudflare/cloudflared):练习 4 用的隧道客户端。
- [FlowiseAI/Flowise](https://github.com/FlowiseAI/Flowise):已归档,留着当「平台会没」的实物例子。

## 自测

1. Dify、扣子、百炼、n8n 各自最适合什么场景?各用一句话说。

<details><summary>答案</summary>

Dify:想自部署、要工作流加知识库加 Agent 的通用 LLM 应用平台,工程团队和业务同学都能用。扣子:面向业务人员、上手最快的云平台,3.0 主打多智能体协作;开源版 Coze Studio 可自部署但功能少。百炼:已经在阿里云上、主要用通义模型的企业,模型、知识库、MCP、计费在一处。n8n:系统之间搬数据的自动化场景,AI 只是流程中的一步,1500 多个集成是它的强项。

</details>

2. 为什么 `cloudledger_api.py` 已经只写了 SELECT 语句,还要用 `mode=ro` 只读打开数据库?

<details><summary>答案</summary>

纵深防御。接口代码将来可能被别人加上写操作的路由,SQL 拼接也可能出 bug;平台那边的配置更是很多人都能改,出了问题不好追溯。在连接层锁成只读,即使上层代码出了错,也改不了库。生产环境里对应的做法是给接口单独建一个只有 SELECT 权限的数据库账号。

</details>

3. 调扣子的执行工作流接口时,`parameters` 字段直接传一个字典会怎样?返回值里的 `data` 要怎么处理?

<details><summary>答案</summary>

按官方文档,`parameters` 要的是序列化后的 JSON 字符串,直接传字典不符合接口约定,要先 `json.dumps`。返回的 `data` 通常也是一个 JSON 字符串,要再 `json.loads` 一次才能取到里面的字段。

</details>

4. 同一份用例,代码版 12/12,Dify 版 9/12,能不能直接得出「Dify 不如代码」的结论?你会先查什么?

<details><summary>答案</summary>

不能。先确认两边比的是同一件事:提示词和类别定义是否一致(代码版的提示词里写了每个类别的意思),模型是否同一个,温度是否都是 0,结构化输出的方式是否一样(JSON mode 还是 JSON Schema 还是纯文本解析),失败是分类错还是调用出错(超时、解析失败会被记成 ERROR)。对齐以后分数还有差距,再逐条看错例。

</details>

5. **面试题**:你们公司业务团队在 Dify 上搭了一个客服机器人,跑了半年,现在每天 5000 次调用,老板想加「自动退款」。你会怎么做?

<details><summary>答案</summary>

先不在平台上直接加写操作。第一步把现在的流程导出 DSL 进版本库,用 API 给它建一份评测集和基线分数。第二步把「自动退款」拆开:平台只负责识别和收集信息,真正的退款由我们自己的服务提供一个「创建待审批退款申请」的接口,带幂等键、权限和审计,由客服主管审批后才执行,和 Day 25 一样。第三步按判断表评估迁移:调用量、涉及钱、需要审计这几条信号已经出现,规划把分类和起草也逐步抽成接口,最终用代码接管编排;每一步都用同一份评测集对比,证明效果没有变差。同时说明平台风险(协议、存续),所以核心逻辑要放在自己的服务里。

</details>

6. 今年有哪两个平台宣布停更或关停?它们对你在平台上搭东西的方式有什么启发?

<details><summary>答案</summary>

Flowise(2026 年 7 月 29 日冻结开发,8 月 10 日仓库归档)和 OpenAI Agent Builder(6 月 3 日宣布,11 月 30 日关停;Evals 平台同日关停)。启发:平台上的东西要能导出并进版本库;核心业务逻辑放在自己的接口或 MCP 工具后面,平台只做编排;评测脚本和被测平台解耦,换平台时用同一份评测集验证。

</details>

## 明天预告

专题篇可以跳着读。下一篇是 Day 141 · 用 Java 和 Go 写 Agent:国内 JD 里 Java 和 Go 各占约四分之一,已有的业务系统不一定要为了 Agent 改成 Python。明天把 Spring AI、LangChain4j、字节的 Eino(今天提到的 Coze Studio 就建立在它上面)和 Google ADK Go 放在一起看,同一个查账单的工具 Agent 用两种语言各写一遍。
