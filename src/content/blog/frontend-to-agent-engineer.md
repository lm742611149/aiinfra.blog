---
title: '前端工程师转 Agent:TypeScript 技术栈、Agent UI 和怎么讲你的优势'
description: '写给做了好几年前端、后端经验不多、想转 AI Agent 工程师的人。先用 880 条真实 JD 看前端和全栈在 Agent 岗里占多少分量,再讲前端经验在 Agent 工作里值钱的地方、2026 年的 TypeScript Agent 技术栈怎么选、必须补的后端和 Python 短板,以及简历和面试怎么讲。'
pubDate: 2026-10-12
regime: none
tags: ['frontend', 'typescript', 'career', 'agent-ui', 'agent-60']
lang: 'zh'
---

这篇是写给一类具体的人的:前端做了五年八年,React、TypeScript 很熟,后端只碰过一点,最近想转 AI Agent 工程师,但心里没底。常见的担心有两个。一是「Agent 不都是 Python 和后端的活吗,我这前端经验是不是白攒了」;二是「我后端这么薄,面试会不会一问就露馅」。

两个担心都有道理,但第一个比你想的要轻,第二个比你想的要具体。下面先看数据,再说该怎么干。

## 先看数据:前端在 Agent JD 里占多少分量

数据来自这个站 2026 年 10 月抓的 880 条 AI Agent / 大模型应用工程师 JD(原始数据在仓库 `docs/jd-research/jds.json`,抓取方法见 [880 条 JD 拆解](/blog/agent-jd-report-2026-10/))。我从里面挑出有完整职位描述的样本:国内 331 条,海外 185 条,用关键词在标题和正文里匹配。关键词匹配会有误差,比如「交互」既可能是「用户交互」也可能是「多轮交互」,所以下面只看量级,不抠一两个百分点。

| 关键词(标题 + 正文) | 国内 331 条 | 海外 185 条 |
| --- | --- | --- |
| Python | 66% | 57% |
| 前端 / 全栈 / full-stack | 26% | 21% |
| TypeScript / JavaScript / Node | 21% | 29% |
| React / Vue / Next.js | 15% | 18% |
| 用户体验 / UX / AI-first 体验(严格口径) | 12% | 6% |
| 流式输出 / SSE / WebSocket | 7% | 3% |

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="前端相关关键词在国内和海外 Agent JD 中的出现比例">
<text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">出现比例(有正文的 JD,关键词匹配)</text>
<rect x="420" y="14" width="12" height="12" fill="var(--mem)"/><text x="438" y="25" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">国内 331</text>
<rect x="520" y="14" width="12" height="12" fill="var(--compute)"/><text x="538" y="25" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">海外 185</text>
<g font-family="var(--font-mono)" font-size="12" fill="var(--ink)">
<text x="20" y="66">Python</text>
<rect x="190" y="54" width="264" height="10" fill="var(--mem)"/><text x="460" y="64" fill="var(--ink-soft)">66%</text>
<rect x="190" y="66" width="228" height="10" fill="var(--compute)"/><text x="424" y="76" fill="var(--ink-soft)">57%</text>
<text x="20" y="116">前端 / 全栈</text>
<rect x="190" y="104" width="104" height="10" fill="var(--mem)"/><text x="300" y="114" fill="var(--ink-soft)">26%</text>
<rect x="190" y="116" width="84" height="10" fill="var(--compute)"/><text x="280" y="126" fill="var(--ink-soft)">21%</text>
<text x="20" y="166">TS / JS / Node</text>
<rect x="190" y="154" width="84" height="10" fill="var(--mem)"/><text x="280" y="164" fill="var(--ink-soft)">21%</text>
<rect x="190" y="166" width="116" height="10" fill="var(--compute)"/><text x="312" y="176" fill="var(--ink-soft)">29%</text>
<text x="20" y="216">React / Vue / Next</text>
<rect x="190" y="204" width="60" height="10" fill="var(--mem)"/><text x="256" y="214" fill="var(--ink-soft)">15%</text>
<rect x="190" y="216" width="72" height="10" fill="var(--compute)"/><text x="268" y="226" fill="var(--ink-soft)">18%</text>
<text x="20" y="266">用户体验 / UX</text>
<rect x="190" y="254" width="48" height="10" fill="var(--mem)"/><text x="244" y="264" fill="var(--ink-soft)">12%</text>
<rect x="190" y="266" width="24" height="10" fill="var(--compute)"/><text x="220" y="276" fill="var(--ink-soft)">6%</text>
</g>
</svg>
<figcaption>Python 仍是第一门槛,但四个 Agent JD 里大约有一个会提前端或全栈;海外 JD 写 TypeScript 的比例还更高一些。</figcaption>
</figure>

几个读法:

第一,**Python 绕不过去**。三分之二的国内 JD 写了 Python,前端再强也得补,这一点后面单独说。

第二,**前端和全栈不是边缘需求**。国内大约四分之一的 Agent JD 在正文里提到前端或全栈。更直观的是标题:国内 695 条里有 53 条标题直接带「全栈」或「前端」,而且不少来自大厂,比如「智能体 Agent Harness 全栈工程师」「企业微信 AI Agent Harness 全栈工程师」「资深 Agent 平台全栈工程师」「全栈 Agent Builder」。这些岗位要的就是一个人能把 Agent 从后端循环一直做到用户眼前。

第三,**海外更偏 TypeScript**。海外 JD 写 TS/JS/Node 的比例(29%)比国内(21%)高,很多美国 AI 创业公司的整套产品就是 Next.js 加 TypeScript 写的 Agent。

第四,**钱不打折**。我从 Boss 直聘和猎聘里能解析出薪资的 593 条挑出标题带「全栈」或「前端」的 43 条,按区间中点乘薪数折成年包,中位数是 48 万,P25 36 万,P75 68 万,和全部样本的分布几乎一模一样。也就是说,全栈 Agent 岗不是「低一档的前端岗」,是同一个价位。样本只有 43 条,只能说明「没有明显打折」,别拿它当精确报价。

## 前端经验在 Agent 工作里值钱在哪

很多人做 Agent demo,后端循环写得挺好,界面就是一个输入框加一段等了二十秒才出来的回答。真到上线,用户第一反应是「它卡了吗」「它刚才干了什么」「我能不能让它停下」。这些问题都落在前端。下面这几样,做过复杂前端的人上手比别人快得多。

**流式渲染**。大模型一个 token 一个 token 往外吐,前端要边收边渲染,还要处理 Markdown 渲染到一半的半截代码块、表格,中途断网重连,用户往上翻的时候别自动滚到底。这本质上是你熟悉的「增量更新 + 状态同步」问题,只是数据源换成了 SSE 或 WebSocket。

**工具调用可视化**。Agent 查了哪个订单、调了哪个接口、用了几秒,要以卡片的形式插在对话里,可折叠、能看参数和结果。AI SDK 的消息结构里工具调用本来就是一个个 part,有「输入流式中」「已执行」「出错」这几种状态,怎么把这些状态画得清楚又不吵,是纯粹的前端功夫。

**人在回路**。退款这类写操作要停下来等人批准。界面上要有清晰的「待审批」卡片,显示 Agent 想做什么、依据是什么,批准和拒绝之后流程从哪里接着走。这块和后端的中断恢复(课程 [Day 25](/blog/agent-60/day-25-langgraph-hitl/))是一对,前后端都懂的人能把它做成一个整体。

**可中断、可撤销**。用户发现 Agent 方向不对,要能一键停下;已经执行的操作要能看到、能回滚的要能回滚。取消信号怎么从按钮一路传到正在跑的模型请求(AbortController),这是前端工程师天天打交道的东西。

**信任设计**。回答里的每个事实要能点开看出处,不确定的地方要明说,Agent 的自主程度要和风险匹配。Google 的 [People + AI Guidebook](https://pair.withgoogle.com/guidebook/) 和课程 [Day 94](/blog/agent-60/day-94-agent-product-ux/) 都在讲这件事。纯后端出身的人往往觉得这是「产品的事」,但 JD 里写的「AI-first 用户体验」「产品意识」,考的就是这个。

**评测和标注工具**。这个最容易被忽略。做 Agent 绕不开错误分析([Day 30](/blog/agent-60/day-30-error-analysis/)):要一条条看 trace、打标签、对比两个版本的回答。很多团队用表格硬扛,效率很低。一个能半天搭出好用标注界面的人,在 Agent 团队里非常吃香。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="一个 Agent 产品的分层:界面层、BFF 和流式层、Agent 运行时、模型和工具">
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="16" width="600" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="36" y="38" fill="var(--ink)">界面层:流式渲染、工具卡片、审批面板、中断按钮、引用来源</text>
<text x="36" y="56" fill="var(--ink-soft)">React / Next.js、AI SDK UI、assistant-ui、CopilotKit</text>
<rect x="20" y="76" width="600" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="36" y="98" fill="var(--ink)">BFF 与流式层:鉴权、会话、SSE/WebSocket、取消信号</text>
<text x="36" y="116" fill="var(--ink-soft)">Next.js Route Handler、Node、Python FastAPI 都行</text>
<rect x="20" y="136" width="600" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="36" y="158" fill="var(--ink)">Agent 运行时:循环、上下文、记忆、评测、可观测</text>
<text x="36" y="176" fill="var(--ink-soft)">AI SDK / Mastra / LangGraph(.js 或 Python)/ Agents SDK</text>
<rect x="20" y="196" width="600" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="36" y="218" fill="var(--ink)">模型与工具:LLM API、MCP server、数据库、业务系统</text>
<text x="36" y="236" fill="var(--ink-soft)">这一层的工程深度,是前端背景最需要补的</text>
</g>
</svg>
<figcaption>前端背景的人天然站在上两层;往下两层走,就是从「做 Agent 界面的前端」变成「全栈 Agent 工程师」的过程。</figcaption>
</figure>

## 拿一张工单走一遍:界面上到底发生了什么

光说「流式」「审批」有点虚,拿课程毕业项目里最典型的一张工单走一遍。客户说「上个月年费被扣了两次」,客服在工作台里点了「让 Agent 处理」。从这一下开始,界面上要依次处理下面这些事件,每一个都对应一个前端决策。

第一秒内,要给出「已经开始」的反馈。模型的首个 token 可能要等一两秒,这段空白最让人焦虑。常见做法是立刻显示一个「正在分析工单」的占位状态,而不是转圈。这里的前端决策是:占位文案用什么、什么时候换成真实内容、换的时候布局会不会跳。

接着模型决定调用 `list_invoices`。消息流里先来的是一个「工具调用输入流式中」的 part,参数还没传完整。要不要把半截 JSON 展示给客服看?大多数产品的选择是只显示「正在查询账单」和工具名,等参数完整了再展开。这个取舍没有标准答案,但你得想过。

工具返回了两笔 468 元的扣款。结果卡片要不要默认展开?如果默认展开,对话会被一大坨数据撑长;如果默认折叠,客服可能错过关键信息。比较好的做法是折叠,但在卡片标题里直接写摘要,比如「查到 2 笔,均为 09-03,¥468」。摘要从哪来,是让模型生成还是前端按工具类型自己拼,又是一个选择。

然后 Agent 要发起退款,流程停下来等主管审批。这时候界面的状态从「Agent 在干活」切到「在等人」,这个切换要非常明显:颜色、位置、是否发通知、主管在别的页面时怎么提醒。审批卡片上要写清楚 Agent 想做什么、金额、依据是哪条政策,以及批准后会发生什么。主管点了批准,前端要把这个动作发回后端,让后端从中断的地方接着跑,并且在界面上把审批卡片变成「已批准,由某某于几点几分」。

最后是回复草稿,带着「依据:帮助中心《退款政策》第 3 节」这样的引用。引用要能点开看原文段落,客服可以在发出前改几个字。改过的地方要不要记录下来,用于以后改进 prompt?这其实已经是评测的范畴了。

整个过程里还有两个随时可能发生的事件:客服点「停止」,或者网络断了。停止要能真正取消后端还在跑的模型请求和工具调用,而不只是前端不显示了;断网重连后要能恢复到正确的状态,不能让同一个退款被提交两次。这两件事前端和后端必须一起设计,也是面试里最能拉开差距的追问。

这一串下来你会发现,一个 Agent 产品里,前端要回答的问题一点不比后端少。区别在于,后端的问题有比较成熟的答案,前端这一块很多团队还在摸索,这正是有经验的前端工程师的机会。

## 2026 年的 TypeScript Agent 技术栈

下面这些包的版本是 2026 年 10 月 12 日在 npm 上查到的最新版。我在本机建了一个空项目,把每个库的最小示例都写了一遍并用 `tsc --strict` 做了类型检查,全部通过。能离线跑的几个也实际跑了,输出贴在下面。

| 库 | 当前版本 | 定位 | 什么时候选它 |
| --- | --- | --- | --- |
| Vercel AI SDK(`ai`) | 7.0.x | 模型调用、工具循环、流式、前端 hooks | 默认首选,尤其前后端都用 TS、用 Next.js 的时候 |
| Mastra(`@mastra/core`) | 1.76.x | 在 AI SDK 之上加 Agent、工作流、记忆、评测 | 想要一个「全家桶」框架,少拼零件 |
| LangGraph.js | 1.4.x | 显式状态图、checkpoint、人工中断 | 流程复杂、要可控可恢复,或团队 Python 侧已经用 LangGraph |
| OpenAI Agents SDK(`@openai/agents`) | 0.20.x | Agent、handoff、guardrail、tracing | 以 OpenAI 模型为主、多 Agent 交接多 |
| MCP TypeScript SDK | 1.32.x | 写 MCP server / client | 要把自家系统包成工具给各种 Agent 用 |
| Claude Agent SDK(TS) | 0.3.x | 直接复用 Claude Code 的整套 harness | 做代码类、文件类 Agent,想站在 Claude Code 肩膀上 |

我的建议很简单:**先把 AI SDK 学透,再按需要加一个**。AI SDK 的 `streamText` 加工具加 `stopWhen` 就是一个完整的 Agent 循环,而且它的前端 hooks(`useChat`)和后端返回的流是同一套消息格式,前后端一个人写起来最顺。

下面是一个最小的工具调用循环。模型走 OpenAI 兼容接口,所以 DeepSeek、通义、Kimi 都能直接换,和课程 Python 部分用的是同一组环境变量。

```ts
// src/ai-sdk.ts  Vercel AI SDK 7:流式 + 工具调用 + 多步循环
import { streamText, tool, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

const llm = createOpenAI({ baseURL: process.env.LLM_BASE_URL, apiKey: process.env.LLM_API_KEY });

const getInvoice = tool({
  description: '按客户 ID 查最近的发票',
  inputSchema: z.object({ customerId: z.string() }),
  execute: async ({ customerId }) => [{ id: 'INV-2291', customerId, amount: 468, status: 'paid' }],
});

const result = streamText({
  model: llm.chat(process.env.LLM_MODEL ?? 'deepseek-flash'),
  tools: { getInvoice },
  stopWhen: stepCountIs(5),
  prompt: '客户 C007 说上个月被扣了两次,帮我看看账单',
});

for await (const part of result.fullStream) {
  if (part.type === 'text-delta') process.stdout.write(part.text);
  if (part.type === 'tool-call') console.log('\n[调用]', part.toolName, part.input);
  if (part.type === 'tool-result') console.log('[结果]', part.output);
}
```

依赖是 `npm i ai@7 @ai-sdk/openai@4 zod@4`,用 `npx tsx src/ai-sdk.ts` 跑。我没有真实模型的 key,所以在本机起了一个模拟 OpenAI 兼容接口的小服务器:第一次请求返回一个工具调用,第二次返回一段文字。对着它跑出来的真实输出是:

```text
[调用] getInvoice { customerId: 'C007' }
[结果] [ { id: 'INV-2291', customerId: 'C007', amount: 468, status: 'paid' } ]
查到两笔 468 元,同一天扣的。
```

注意两个版本差异,网上很多教程还停在旧写法。AI SDK 5 之后工具的参数字段叫 `inputSchema`,不再是 `parameters`;多步循环用 `stopWhen: stepCountIs(n)`,不再是 `maxSteps`。照抄 2024 年的教程会直接类型报错。

做界面的时候,后端把 `streamText` 的结果用 `toUIMessageStreamResponse()` 返回,前端用 `@ai-sdk/react` 的 `useChat` 接住,消息的 `parts` 里会依次出现文字、工具调用、工具结果,你按 part 类型渲染成不同组件就行。官方文档的 [Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage) 一页把这套写法讲得很清楚,建议直接照着做一遍。

第二个值得前端同学亲手写的是 MCP server。它不需要任何 API key,在本机就能完整跑通:

```ts
// src/mcp.ts  MCP TypeScript SDK:写一个 server,再用内存传输连上去调用
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';

const server = new McpServer({ name: 'cloudledger', version: '0.1.0' });
server.registerTool(
  'get_invoice',
  { description: '按客户 ID 查最近的发票', inputSchema: { customerId: z.string() } },
  async ({ customerId }) => ({
    content: [{ type: 'text', text: JSON.stringify({ id: 'INV-2291', customerId, amount: 468 }) }],
  }),
);

const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
await server.connect(serverSide);
const client = new Client({ name: 'demo-client', version: '0.1.0' });
await client.connect(clientSide);

const { tools } = await client.listTools();
console.log('工具:', tools.map((t) => t.name));
const res = await client.callTool({ name: 'get_invoice', arguments: { customerId: 'C007' } });
console.log('结果:', JSON.stringify(res.content));
await client.close();
```

本机实际输出:

```text
工具: [ 'get_invoice' ]
结果: [{"type":"text","text":"{\"id\":\"INV-2291\",\"customerId\":\"C007\",\"amount\":468}"}]
```

把内存传输换成 stdio,这个 server 就能直接接进 Claude Desktop、Cursor 或 Claude Code。课程 [Day 23](/blog/agent-60/day-23-build-mcp-server/) 用 Python 写了同一件事,两边对照着看,协议是一样的,只是 SDK 语法不同。

LangGraph.js 的写法和 Python 版几乎一一对应,下面这个分类路由的小图本机跑出来是 `{ ticket: '上个月被扣了两次', category: 'refund', reply: '已转给退款流程,主管审批后处理' }`:

```ts
// src/langgraph.ts  LangGraph.js:分类 → 处理 → 结束
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';

const State = Annotation.Root({
  ticket: Annotation<string>,
  category: Annotation<string>,
  reply: Annotation<string>,
});

const graph = new StateGraph(State)
  .addNode('classify', async (s) => ({ category: s.ticket.includes('扣') ? 'refund' : 'other' }))
  .addNode('refund', async () => ({ reply: '已转给退款流程,主管审批后处理' }))
  .addNode('other', async () => ({ reply: '已记录,稍后人工回复' }))
  .addEdge(START, 'classify')
  .addConditionalEdges('classify', (s) => s.category, { refund: 'refund', other: 'other' })
  .addEdge('refund', END)
  .addEdge('other', END)
  .compile();

console.log(await graph.invoke({ ticket: '上个月被扣了两次' }));
```

Mastra、OpenAI Agents SDK 和 Claude Agent SDK 我也各写了一个最小示例,类型检查通过,但它们都要真实模型才能跑,我没有跑出输出,这里就不贴假的结果了。要点各一句:

- **Mastra**:`new Agent({ id, name, instructions, model, tools })`,模型直接传 AI SDK 的 provider,工具用 `createTool` 定义,调用是 `agent.generate()` 或 `agent.stream()`。
- **OpenAI Agents SDK**:接非 OpenAI 厂商时要 `setDefaultOpenAIClient(new OpenAI({ baseURL }))` 再 `setOpenAIAPI('chat_completions')`,因为大部分国产模型不支持 Responses API。工具参数字段在这里叫 `parameters`,和 AI SDK 不一样,别混。
- **Claude Agent SDK**:`query({ prompt, options })` 返回一个异步迭代器,你拿到的就是 Claude Code 的完整 harness(读写文件、bash、子 Agent、权限)。课程 [Day 27](/blog/agent-60/day-27-frameworks-compared/) 提过一个坑:`allowedTools` 不是白名单,真要限制工具得用 `tools` 参数。

界面层如果不想从零写,可以看两个开源库:[assistant-ui](https://github.com/assistant-ui/assistant-ui)(一套可组合的聊天界面组件,能接 AI SDK)和 [CopilotKit](https://github.com/CopilotKit/CopilotKit)(偏「把 Agent 嵌进现有应用」,还推了一个前后端事件协议 [AG-UI](https://docs.ag-ui.com))。我的建议是先自己用 `useChat` 写一遍工具卡片和审批面板,搞懂消息结构,再决定用不用这些库。面试时「我用 assistant-ui 搭的」远不如「我自己设计了工具调用的渲染和中断」有说服力。

## 必须补的短板:后端深度和 Python

前端转过来的人,面试里最容易被追问倒的不是 Agent 本身,而是 Agent 背后那些普通的后端问题。我按「最容易被问到」排了个序,每条对应课程里的天数。

**1. Python 要能写生产代码**。不是能看懂,是能写出带类型标注、async、pydantic 校验、pytest 的服务。三分之二的国内 JD 要 Python,而且很多团队的 Agent 运行时、评测脚本、数据处理都是 Python。好消息是 TypeScript 熟的人学 Python 很快,类型标注和 async/await 的概念几乎一样。课程 [Day 2](/blog/agent-60/day-02-python-for-backend-devs/) 是用对照的方式写的,前端读起来会很顺;读完之后建议把上面的 AI SDK 示例用 Python 重写一遍,练手感。

**2. 服务化和长任务**。Agent 不是一次请求一次响应,一个任务可能跑几分钟,中途要能断点续跑、能重试、不能重复退款。这要懂队列、幂等、超时、状态持久化。对应 [Day 36](/blog/agent-60/day-36-agent-as-service/) 和 [Day 37](/blog/agent-60/day-37-long-running-reliability/),这两天不要快过。

**3. 数据库**。会写 SQL 查询不够,要懂事务、索引、连接池,以及向量检索怎么跟业务数据放在一起。对应 [Day 17](/blog/agent-60/day-17-pgvector/) 和毕业项目的 [Day 44](/blog/agent-60/day-44-capstone-skeleton-data/)。

**4. 可观测**。线上出问题,要能从一条 trace 里看出是哪一步慢、哪个工具报错、哪次调用花了多少钱。前端的人对 Sentry 很熟,但后端链路追踪(OpenTelemetry)是另一套,对应 [Day 34](/blog/agent-60/day-34-tracing-observability/)。

**5. 安全**。prompt injection、工具权限、敏感数据。前端的人对 XSS 有直觉,prompt injection 本质上是同一类问题:把不可信的内容当成了指令。对应 [Day 39](/blog/agent-60/day-39-prompt-injection/)。

**6. 部署**。Docker、环境变量和密钥、上一台云服务器。习惯了 Vercel 一键部署的人,第一次自己配 compose 和反向代理会踩不少坑。对应 [Day 41](/blog/agent-60/day-41-deploy/)。

## 前端背景的人怎么调整 60 天的节奏

这门课默认读者是后端出身,所以有些天对你来说可以快过,有些天要多花时间。下面是我的建议,不是硬规定,按自己的情况调。

**可以快过的**:
- [Day 4 流式输出](/blog/agent-60/day-04-messages-and-streaming/):SSE 的原理你大概率已经懂,重点看 messages 状态管理那部分就行。
- [Day 6 结构化输出](/blog/agent-60/day-06-structured-output/):pydantic 对你来说就是 Python 版的 zod,概念一样。
- [Day 49 毕业项目界面](/blog/agent-60/day-49-capstone-ui/):课程用 Streamlit 是为了让后端读者少写前端。你直接用 Next.js 加 AI SDK 写一个像样的客服工作台,把工具卡片、审批面板、引用来源都做出来,这会是你作品集里最亮的一块。

**要加练的**:
- [Day 2 Python 速成](/blog/agent-60/day-02-python-for-backend-devs/):多花一倍时间,把 async 和 pytest 练熟。
- [Day 9 手写 Agent 循环](/blog/agent-60/day-09-agent-loop-from-scratch/):Python 写一遍,再用 TypeScript 不用任何框架写一遍。两种语言都能闭眼写出来,面试的手写题就稳了。
- [Day 36](/blog/agent-60/day-36-agent-as-service/)、[Day 37](/blog/agent-60/day-37-long-running-reliability/)、[Day 41](/blog/agent-60/day-41-deploy/):后端基本功,别跳。
- [Day 13 Workflow 还是 Agent](/blog/agent-60/day-13-workflows-vs-agents/) 和 [Day 27 框架横评](/blog/agent-60/day-27-frameworks-compared/):把 TS 生态的几个库也放进对比里,面试问「为什么选这个框架」时你会比只懂 Python 的人多一个维度。

**额外加一个小项目**:一个「Agent 评测标注台」。读取 trace 文件,一条条展示对话和工具调用,支持打标签、写备注、导出 CSV,再加一个两个版本回答并排对比的视图。一两天就能做完,刚好把你的前端优势和 [Day 30 错误分析](/blog/agent-60/day-30-error-analysis/)、[Day 32 LLM 评审](/blog/agent-60/day-32-llm-as-judge/)接起来。面试官看到这个,会知道你不只是会画界面,而是理解 Agent 是怎么被改进的。

## 简历和面试怎么讲

定位上,不要写成「前端工程师,想转 AI」,也不要硬把自己包装成后端。最贴切的说法是**全栈 AI 产品工程师 / Agent 应用工程师**:多年前端打底,能把 Agent 从运行时一路做到用户界面,并且懂评测和上线。这个定位在市场上人少,而且和你的真实经历完全对得上,经得起追问。

简历上几个具体建议:

**把前端经历往 Agent 关心的问题上靠**。不是「负责 XX 系统前端开发」,而是写你解决过的、和 Agent 界面相通的问题:复杂状态管理、实时数据流、长列表性能、可撤销操作、权限控制。如实写,不要编,只是换一个让 Agent 团队看得懂的角度。

**项目经历用课程的两个作品,但突出你的那一层**。SupportPilot 写清楚你做了哪些后端(循环、RAG、MCP 工具、评测),再写界面层(流式工具卡片、审批面板、引用溯源),最后给数据:评测分数、单张工单成本、P95 延迟。评测和成本这两个数字最能说明你不是「只会做界面的前端」。

**工作里真实用过的 AI 能力要写**。如果你在公司里接过大模型 API、做过聊天界面、日常用 Claude Code 或 Cursor 写代码、写过 MCP 或 skill,这些都是真实的 Agent 相关经验,如实写进去。国内约两成 JD 明确要求熟练使用 Coding Agent。

面试里几个高频追问,前端背景的人要提前准备:

- 「后端经验比较少,你怎么保证 Agent 服务的可靠性?」用毕业项目里的断点续跑、幂等键、重试和评测数据回答,别泛泛说「我会学」。
- 「流式输出中途断了怎么办?工具执行到一半用户点了停止怎么办?」这是你的主场,讲清楚取消信号的传递链路和服务端状态怎么收尾。
- 「为什么选 AI SDK / LangGraph?」讲取舍,不要讲好恶。参考上面那张选型表。
- 「手写一个 Agent 循环」。Python 和 TypeScript 都要能写,面试官可能让你选。

## 学习资料

### 文档与文章
- [AI SDK 官方文档](https://ai-sdk.dev/docs/introduction):从 Introduction 开始,重点读 Agents 和 AI SDK UI 两部分,一个晚上能过完核心概念。
- [AI SDK:Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage):工具调用在前端怎么渲染,照着做一遍。
- [Mastra 文档](https://mastra.ai/docs):想用全家桶框架时看,Agent、Workflow、Memory 三章最有用。
- [LangGraph.js 文档](https://docs.langchain.com/oss/javascript/langgraph/overview):和 Python 版对照着读。
- [OpenAI Agents SDK(JS)文档](https://openai.github.io/openai-agents-js/):看 handoff 和 guardrail 两节。
- [Claude Agent SDK TypeScript 文档](https://docs.claude.com/en/docs/agent-sdk/typescript):想复用 Claude Code harness 时看。
- [Anthropic:Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):不分语言,先把「什么时候不需要 Agent」想清楚。
- [Google People + AI Guidebook](https://pair.withgoogle.com/guidebook/):AI 产品的交互和信任设计,前端出身的人读起来最有共鸣。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hoXNBPE73&autoplay=0&high_quality=1" title="【前端学AI】AI 应用开发为啥要用 Langchain.js 框架？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI全栈进阶Cris · 【前端学AI】AI 应用开发为啥要用 Langchain.js 框架? · 7 分钟,2026 年发布。从前端视角讲为什么 AI 框架在拥抱 TypeScript,适合开始学之前先看,建立「TS 也是 Agent 一等公民」的认识。</figcaption>
</figure>

- 五里墩茶社《Vercel AI SDK - 支持多模型多框架的AI应用开发包》(BV1yH4y1U7wT):2023 年的老视频,API 已经变了很多,只适合了解 AI SDK 的设计初衷,代码以官方文档为准。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/1bx-eosOOkE" title="Vercel Ship 2025 workshop: Building agents with the AI SDK (Nico Albanese)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Vercel · Building agents with the AI SDK(Nico Albanese)· AI SDK 团队自己讲怎么用它搭 Agent,是 TS 技术栈最直接的入门。注意版本:讲的是 v5,v7 的大部分写法一致。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/WKIjkxxNH0c" title="Build a Support Agent with Vercel AI SDK – Full Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp · Build a Support Agent with Vercel AI SDK · 完整教程,做的正好是客服 Agent,和课程毕业项目 SupportPilot 是同一类场景,可以对照着看界面怎么做。</figcaption>
</figure>

- Matt Pocock《AI SDK v5: A Crash Course》(YouTube,ihHLs6v7Lko):TypeScript 圈很有名的讲师,讲 AI SDK 的类型设计讲得很透。

### 开源项目与代码
- [vercel/ai](https://github.com/vercel/ai):AI SDK 源码,`examples/` 目录下有 Next.js 的完整例子。
- [mastra-ai/mastra](https://github.com/mastra-ai/mastra)、[langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs)、[openai/openai-agents-js](https://github.com/openai/openai-agents-js)、[anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript):各框架源码。
- [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk):MCP 官方 TS SDK。
- [assistant-ui](https://github.com/assistant-ui/assistant-ui)、[CopilotKit](https://github.com/CopilotKit/CopilotKit):Agent 界面组件库,看它们怎么组织消息和工具调用的渲染。

## 最后

前端转 Agent,最大的误区是觉得自己要「从零开始」。其实你缺的是后端深度和 Python,这两样是可以在两三个月里补到够用的;而你已经有的那部分,流式、交互、状态、信任感,是很多后端和算法出身的人几年都补不好的。

把课程 60 天走一遍,后端的天数别偷懒,界面那块放开手做到你自己满意的水平,然后用「全栈 AI 产品工程师」这个身份去投。
