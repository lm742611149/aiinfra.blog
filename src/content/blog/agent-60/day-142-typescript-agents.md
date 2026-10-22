---
title: 'Day 142 · 用 TypeScript 写 Agent:Mastra、Vercel AI SDK 与前后端一体'
description: '海外 JD 里 TypeScript 占三分之一,美国本土接近一半。今天用 AI SDK 7 的 ToolLoopAgent、工具审批和 useChat,把查账 Agent 做成一个前后端都是 TypeScript 的 Next.js 应用;再用 Mastra 1.x 写一遍同一个 Agent,最后和 Day 49「Python 后端 + 自己读 SSE」的做法摆在一起,讲清楚什么时候全用 TS。'
pubDate: 2026-10-22
regime: none
tags: ['typescript', 'vercel-ai-sdk', 'mastra', 'nextjs', 'tool-approval', 'frameworks', 'agent-60']
series: 'agent-60'
day: 142
lang: 'zh'
---

## 今天要解决的问题

这是专题篇的一课,**建议在 [Day 49 · 界面与流式体验](/blog/agent-60/day-49-capstone-ui/) 之后读**。Day 49 你做了 SupportPilot 的 Next.js 前端,后端是 Python,事件协议是我们自己定义的,前端用 `fetch` 加 `eventsource-parser` 自己读流。当时我说过:如果起一个全新项目、后端也是 Node,Vercel 的 AI SDK 会省很多代码。今天就把这条路走一遍。

为什么值得专门讲?看我们 10 月抓的 JD(`docs/jd-research`):TypeScript/JS 在海外合计 34% 的岗位里出现,美国本土 45%,海外远程 41%,国内是 27%。海外很多 AI 创业公司的整个产品就是一个 Next.js 应用,Agent 跑在 Route Handler 里,他们招人时更看重「能不能一个人把 Agent 和界面一起做完」。你如果是前端出身,这一课是你在面试里最好讲的故事。

学完你要能做到:

1. 说清 AI SDK 7、Mastra、OpenAI Agents SDK(JS 版)各自定位、当前版本、谁适合用。
2. 用 AI SDK 7 的 `ToolLoopAgent` 写一个带三个工具的 Agent,其中退款工具要用户在界面上点确认才执行。
3. 用 `useChat` 把工具调用和审批渲染成卡片,讲清楚 UI Message 的 `parts` 和工具 part 的几种 `state`。
4. 用 Mastra 写同一个 Agent,说出它比 AI SDK 多了什么。
5. 在「Python 后端 + TS 前端」和「全 TS」之间做选择,并说出理由。

预计用时 4–5 小时。前置:Day 23 的 `cloudledger.db`、Day 25 的人工审批概念、Day 49 的 Next.js 项目经验。需要 Node.js 22 以上(AI SDK 7 的 `package.json` 写着 `engines: node >=22`,Mastra core 要求 22.13 以上),`node -v` 先看一眼。

版本说明:下面的版本号是 2026 年 10 月 22 日从 npm 查的,API 用法我对照了 `ai@7.0.148` 和 `@ai-sdk/react@4.0.152` 发布包里的类型声明(`dist/index.d.ts`)以及官方文档。**整个应用我没有在本机跑过**,文中的运行结果都标了「大致长这样」,你跑出来如果不同,以你的为准,也欢迎在评论区告诉我。

## TypeScript 这边有哪些选择

| 名字 | 谁做的 | 当前版本 | 定位 |
| --- | --- | --- | --- |
| AI SDK(`ai` 包) | Vercel | 7.0.148(7.0.0 在 2026-06-25 发布) | 底层工具包:统一调各家模型、工具循环、流式协议、React/Vue/Svelte 的 `useChat` |
| Mastra(`@mastra/core`) | Mastra(Gatsby 原班人马) | 1.79.0(1.0 在 2026-01-20 发布) | 上层框架:Agent、Workflow、Memory、评测、本地开发面板,底下用的是 AI SDK 的模型层 |
| OpenAI Agents SDK(`@openai/agents`) | OpenAI | 0.20.0(2026-10-08) | Python 版 Agents SDK 的 JS 移植,handoff、guardrail、tracing 那一套 |
| LangGraph.js | LangChain | — | Python LangGraph 的 JS 版,状态图、checkpoint、interrupt |

拿 Day 27 那张五层图对照:AI SDK 在第 ① 层偏上一点,它给你模型调用、工具循环和前端协议,流程怎么编排你自己写;Mastra 和 LangGraph.js 在第 ③ 层,给你编排积木;OpenAI Agents SDK 在第 ④ 层。今天主讲 AI SDK,因为它是 TS 生态的公共底座,Mastra 等很多框架都建在它上面;Mastra 作为对照写一遍。

AI SDK 从 6 到 7 有一批破坏性变更,网上大量教程还停在 5 或 6,照抄会报错。我从官方的 7.0 迁移指南里挑了和今天有关的几条:

- 停止条件 `stepCountIs` 改名为 `isStepCount`(我在 7.0.148 的导出里看到旧名还作为别名保留着,但新代码用新名字)。
- 工具上的 `needsApproval` 废弃,改成在调用或 Agent 上配置 `toolApproval: { 工具名: 'user-approval' }`。
- `ToolLoopAgent` 的 `system` 改叫 `instructions`,`onFinish`/`onStepFinish` 改叫 `onEnd`/`onStepEnd`。
- 必须 Node 22 以上,所有包只提供 ESM,不能再 `require()`。
- `prompt` 或 `messages` 里默认不允许出现 system 消息,system prompt 只能走 `instructions`。

## 整体结构

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="全 TypeScript 的查账 Agent:浏览器里的 useChat 把消息 POST 到 Next.js 路由,路由用 ToolLoopAgent 调模型和工具,退款工具先发审批请求回浏览器,用户确认后再执行">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="16" y="30" width="170" height="200" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="28" y="52" fill="var(--ink)">浏览器 page.tsx</text>
    <text x="28" y="74" font-size="11" fill="var(--ink-soft)">useChat</text>
    <text x="28" y="92" font-size="11" fill="var(--ink-soft)">messages[].parts</text>
    <rect x="28" y="150" width="146" height="60" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="38" y="172" font-size="11" fill="var(--ink)">审批卡片</text>
    <text x="38" y="192" font-size="11" fill="var(--ink-soft)">确认 / 拒绝</text>

    <rect x="236" y="30" width="170" height="200" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="248" y="52" fill="var(--ink)">/api/chat route.ts</text>
    <text x="248" y="74" font-size="11" fill="var(--ink-soft)">ToolLoopAgent</text>
    <text x="248" y="92" font-size="11" fill="var(--ink-soft)">isStepCount(8)</text>
    <text x="248" y="110" font-size="11" fill="var(--ink-soft)">toolApproval</text>

    <rect x="456" y="30" width="168" height="90" rx="4" fill="none" stroke="var(--mem)"/>
    <text x="468" y="52" fill="var(--ink)">模型</text>
    <text x="468" y="74" font-size="11" fill="var(--ink-soft)">OpenAI 兼容接口</text>
    <text x="468" y="92" font-size="11" fill="var(--ink-soft)">DeepSeek 等</text>
    <rect x="456" y="140" width="168" height="90" rx="4" fill="none" stroke="var(--compute)"/>
    <text x="468" y="162" fill="var(--ink)">ledger.ts</text>
    <text x="468" y="184" font-size="11" fill="var(--ink-soft)">better-sqlite3</text>
    <text x="468" y="202" font-size="11" fill="var(--ink-soft)">cloudledger.db 副本</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="186" y1="70" x2="236" y2="70"/>
    <line x1="236" y1="100" x2="186" y2="100" stroke-dasharray="3 3"/>
    <line x1="406" y1="70" x2="456" y2="70"/>
    <line x1="406" y1="180" x2="456" y2="180"/>
    <line x1="236" y1="170" x2="174" y2="170" stroke="var(--compute)"/>
    <line x1="174" y1="196" x2="236" y2="196" stroke="var(--compute)" stroke-dasharray="3 3"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="190" y="64">POST</text>
    <text x="190" y="114">SSE</text>
    <text x="180" y="164">请求审批</text>
    <text x="180" y="212">再次 POST</text>
  </g>
  <text x="320" y="258" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">服务端无状态:每次请求都带上完整的消息历史,审批结果也在历史里</text>
</svg>
<figcaption>和 Day 49 的区别:协议不用自己定义,事件格式是 AI SDK 的 UI Message Stream;审批不是另开一个客服页面,而是在同一个对话里由当前用户确认。</figcaption>
</figure>

这个设计里有一点和 SupportPilot 很不一样,先说清楚:`useChat` 的审批是「当前这个用户」点确认。SupportPilot 的退款需要**另一个人**(客服主管)在另一个页面审批。所以今天的 `create_refund_request` 工具,用户点确认之后,也只是在库里写一条 `pending_approval` 的申请,和 Day 23 一样,真正退款仍然要主管审。「这一步要不要人看一眼」和「这件事要不要有权限的人批」是两件事,别用前者替代后者。

## 建项目

```bash
cd agent-60-lab && mkdir -p topics/ts-agents && cd topics/ts-agents
npx create-next-app@16.4.2 ledger-next --ts --app --no-eslint --no-tailwind --src-dir --import-alias "@/*" --use-npm --yes
cd ledger-next
npm i ai@7.0.148 @ai-sdk/react@4.0.152 @ai-sdk/openai-compatible@3.0.75 zod@4.6.7 better-sqlite3@13.0.3
npm i -D @types/better-sqlite3@9.6.0
mkdir -p data && cp ../../../w4/cloudledger/cloudledger.db data/
```

<div class="line-notes">

- `npx create-next-app@16.4.2 ledger-next` 和 Day 49 一样的参数,只是版本换成当前最新的 16.4.2。版本写死是为了三个月后照着敲还能对上。
- `npm i ai@7.0.148 @ai-sdk/react@4.0.152` `ai` 是核心包(模型调用、工具、Agent、流式协议都在里面),`@ai-sdk/react` 是 `useChat` 所在的 React 绑定。两者要配套:`ai` 7.x 对应 `@ai-sdk/react` 4.x,这两个包的 4.0.0 和 7.0.0 是同一天发布的。<br>`@ai-sdk/openai-compatible@3.0.75` 通用的 OpenAI 兼容 provider,接 DeepSeek、通义、Kimi 都用它。AI SDK 也有 `@ai-sdk/deepseek` 专用包,用兼容包是为了和全课一样只靠三个环境变量切厂商。<br>`zod@4.6.7` 写工具参数 schema 用。AI SDK 7.0.148 的 peerDependencies 写的是 `zod ^3.25.76 || ^4.1.8`,v4 可以直接用。<br>`better-sqlite3@13.0.3` Node 上最常用的同步 SQLite 驱动,需要编译原生模块,`npm i` 时会下载预编译包,下不下来会现场编译(要有 Xcode 命令行工具)。
- `cp ../../../w4/cloudledger/cloudledger.db data/` 复制一份,不直接用 Day 23 的库。今天的退款工具会往 `refund_requests` 表里写数据,别把你后面几课要用的库弄脏。

</div>

`.env.local`(Next.js 自动读,不要提交):

```bash
# agent-60-lab/topics/ts-agents/ledger-next/.env.local
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-flash
CLOUDLEDGER_DB=./data/cloudledger.db
TOOL_APPROVAL_SECRET=换成一串随机字符,比如 openssl rand -hex 32 的输出
```

## 业务层:ledger.ts

先把三个工具的业务逻辑写成普通函数,和 AI SDK 无关。这样 Mastra 版本也能直接复用。

```ts
// agent-60-lab/topics/ts-agents/ledger-next/src/lib/ledger.ts
import Database from 'better-sqlite3';

const db = new Database(process.env.CLOUDLEDGER_DB ?? './data/cloudledger.db', { fileMustExist: true });

export type Customer = { id: string; name: string; email: string; company: string };
export type InvoiceStatus = 'paid' | 'open' | 'void' | 'refunded';
export type Invoice = {
  id: string;
  amount_cents: number;
  amount_yuan: string;
  status: InvoiceStatus;
  issued_at: string;
  paid_at: string | null;
};

const yuan = (cents: number) => (cents / 100).toFixed(2);

export function findCustomer(query: string): Customer[] {
  const q = query.trim();
  const like = `%${q}%`;
  const rows = db
    .prepare('SELECT id, name, email, company FROM customers WHERE id = ? OR email LIKE ? OR name LIKE ? OR company LIKE ? LIMIT 5')
    .all(q.toUpperCase(), like, like, like) as Customer[];
  if (rows.length === 0) {
    throw new Error(`没有找到匹配「${query}」的客户。可以换成邮箱或客户编号再试。`);
  }
  return rows;
}

export function listInvoices(customerId: string, status: InvoiceStatus | undefined, limit: number): Invoice[] {
  let sql = 'SELECT id, amount_cents, status, issued_at, paid_at FROM invoices WHERE customer_id = ?';
  const args: (string | number)[] = [customerId];
  if (status) {
    sql += ' AND status = ?';
    args.push(status);
  }
  sql += ' ORDER BY issued_at DESC, id DESC LIMIT ?';
  args.push(limit);
  const rows = db.prepare(sql).all(...args) as Omit<Invoice, 'amount_yuan'>[];
  return rows.map((r) => ({ ...r, amount_yuan: yuan(r.amount_cents) }));
}

export function createRefundRequest(invoiceId: string, amountYuan: number, reason: string) {
  const run = db.transaction(() => {
    const inv = db.prepare('SELECT amount_cents, status FROM invoices WHERE id = ?').get(invoiceId) as
      | { amount_cents: number; status: InvoiceStatus }
      | undefined;
    if (!inv) throw new Error(`发票 ${invoiceId} 不存在。先用 list_invoices 查到正确的发票号。`);
    if (inv.status !== 'paid') throw new Error(`发票 ${invoiceId} 状态是 ${inv.status},只有 paid 的发票能退款。`);
    const { already } = db
      .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS already FROM refund_requests WHERE invoice_id = ? AND status != 'rejected'")
      .get(invoiceId) as { already: number };
    const cents = Math.round(amountYuan * 100);
    const left = inv.amount_cents - already;
    if (cents > left) {
      throw new Error(`最多还能申请 ${yuan(left)} 元(发票 ${yuan(inv.amount_cents)} 元,已申请 ${yuan(already)} 元)。`);
    }
    const info = db
      .prepare("INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at) VALUES (?, ?, ?, 'pending_approval', ?)")
      .run(invoiceId, cents, reason, new Date().toISOString().slice(0, 19));
    return { refund_request_id: Number(info.lastInsertRowid), status: 'pending_approval' as const, amount_yuan: yuan(cents) };
  });
  return run();
}
```

<div class="line-notes">

- `const db = new Database(process.env.CLOUDLEDGER_DB ?? './data/cloudledger.db', { fileMustExist: true });` `fileMustExist: true` 是 better-sqlite3 的选项,文件不存在就直接抛错。Day 141 讲过,SQLite 驱动默认会悄悄建一个空库,然后你的工具报 `no such table`。Node 这边一个选项就解决了。<br>相对路径 `./data/...` 是相对进程的工作目录,`npm run dev` 在项目根目录启动,所以指向 `ledger-next/data/cloudledger.db`。
- `export type InvoiceStatus = 'paid' | 'open' | 'void' | 'refunded';` 字面量联合类型,相当于 Python 的 `Literal[...]`。下面 zod 的 `z.enum` 会生成同样的四个值。
- `paid_at: string | null;` 未付款发票的 `paid_at` 是 NULL,better-sqlite3 读出来是 JS 的 `null`。
- `const yuan = (cents: number) => (cents / 100).toFixed(2);` 239200 → `"2392.00"`,和 Python 版 `yuan()` 一致。
- `.all(q.toUpperCase(), like, like, like) as Customer[];` better-sqlite3 的 `prepare().all()` 是同步的,直接返回数组,不用 `await`。返回类型是 `unknown[]`,所以要 `as` 断言成我们的类型。代入 `query = "user007@example.com"`:返回 `[{ id: 'C007', name: '刘静', email: 'user007@example.com', company: '半岛咖啡' }]`(这条是我对着库用 sqlite3 查过的)。
- `throw new Error(` 工具里直接抛错。AI SDK 会把它变成一个 `tool-error`,下一次请求模型时,作为工具结果的错误文本(`type: 'error-text'`,内容是 `error.message`)发给模型。我在 7.0.148 的源码里看到 `createToolModelOutput` 就是这么处理的。所以效果等同于 Python MCP 的 `raise ToolError`。
- `const rows = db.prepare(sql).all(...args) as Omit<Invoice, 'amount_yuan'>[];` `Omit<Invoice, 'amount_yuan'>` 表示「Invoice 去掉 amount_yuan 字段」,因为数据库里没有这一列,下一行才补上。代入 `C007, undefined, 6`:返回 5 行,头两行是 10 月 8 日的 INV-2026-0123 和 INV-2026-0026。
- `const run = db.transaction(() => {` better-sqlite3 的事务是把函数包一层,调用 `run()` 时整个函数在一个事务里执行,中途抛错自动回滚。查已申请金额和插入新申请必须在同一个事务里,否则两个并发请求可能都通过检查,一共申请了两倍金额。
- `.get(invoiceId) as` `.get()` 只取第一行,没有就是 `undefined`,所以类型断言里要带 `| undefined`。
- `if (inv.status !== 'paid') throw new Error(` 这几条业务规则和 Day 23 的 `create_refund_request` 一一对应,报错文案也一样。规则放在业务层,不放在 prompt 里:模型就算想给一张 void 的发票退款,也会被这里挡住。
- `const cents = Math.round(amountYuan * 100);` 浮点数 2392 × 100 可能得到 239199.99999,`Math.round` 取整到分。
- `new Date().toISOString().slice(0, 19)` 得到 `2026-10-22T09:30:00` 这种格式,和 Python 版 `isoformat(timespec="seconds")` 一致(区别是这里是 UTC 时间,Python 版是本地时间,做练习时注意)。
- `return { refund_request_id: Number(info.lastInsertRowid),` `lastInsertRowid` 的类型是 `number | bigint`,转成 number 才能被 JSON 序列化。`'pending_approval' as const` 让 TypeScript 把类型收窄成这个字面量,前端能拿到更准确的类型。

</div>

## Agent:ToolLoopAgent 加工具审批

```ts
// agent-60-lab/topics/ts-agents/ledger-next/src/lib/agent.ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { isStepCount, tool, ToolLoopAgent, type InferAgentUIMessage } from 'ai';
import { z } from 'zod';
import { createRefundRequest, findCustomer, listInvoices } from './ledger';

const llm = createOpenAICompatible({
  name: 'llm',
  baseURL: process.env.LLM_BASE_URL!,
  apiKey: process.env.LLM_API_KEY,
  includeUsage: true,
});

export const accountant = new ToolLoopAgent({
  model: llm(process.env.LLM_MODEL!),
  instructions:
    '你是云簿的账务专员。先用工具查事实,不要编造发票号和金额。确认是重复扣款时,可以调用 create_refund_request 提交退款申请,金额等于重复的那一笔。',
  temperature: 0,
  tools: {
    find_customer: tool({
      description: '按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。',
      inputSchema: z.object({
        query: z.string().describe('客户邮箱、姓名、公司名或客户编号(如 C007),支持部分匹配'),
      }),
      execute: async ({ query }) => findCustomer(query),
    }),
    list_invoices: tool({
      description: '列出客户最近的发票(按开票日期倒序),金额单位为元。可按状态过滤。',
      inputSchema: z.object({
        customer_id: z.string().regex(/^C\d{3}$/).describe('客户编号,如 C007'),
        status: z.enum(['paid', 'open', 'void', 'refunded']).optional(),
        limit: z.number().int().min(1).max(20).default(6),
      }),
      execute: async ({ customer_id, status, limit }) => listInvoices(customer_id, status, limit),
    }),
    create_refund_request: tool({
      description: '提交一条退款申请,状态为 pending_approval,不会立刻退钱,需要客服主管审批。只能对 paid 状态的发票申请。',
      inputSchema: z.object({
        invoice_id: z.string().describe('要退款的发票号,如 INV-2026-0123'),
        amount_yuan: z.number().positive().describe('退款金额,单位元'),
        reason: z.string().min(4).max(200).describe('退款原因,写清楚依据'),
      }),
      execute: async ({ invoice_id, amount_yuan, reason }) => createRefundRequest(invoice_id, amount_yuan, reason),
    }),
  },
  toolApproval: { create_refund_request: 'user-approval' },
  experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
  stopWhen: isStepCount(8),
});

export type AccountantMessage = InferAgentUIMessage<typeof accountant>;
```

<div class="line-notes">

- `const llm = createOpenAICompatible({` 创建一个 provider。`name` 是给这个 provider 起的名字,以后用 `providerOptions.llm` 传厂商专有参数时用得上。
- `baseURL: process.env.LLM_BASE_URL!,` 末尾的 `!` 是 TypeScript 的非空断言,告诉编译器「这里一定有值」。`process.env.X` 的类型是 `string | undefined`,不加 `!` 会有红线。provider 会在后面拼上 `/chat/completions`,DeepSeek 填 `https://api.deepseek.com` 就行。
- `includeUsage: true,` 默认关闭。打开后流式响应也会带 token 用量,算成本要用。
- `model: llm(process.env.LLM_MODEL!),` `llm('deepseek-flash')` 和 `llm.chatModel('deepseek-flash')` 等价,得到一个聊天模型对象。
- `instructions:` AI SDK 7 里 system prompt 叫 `instructions`(6 里叫 `system`)。最后一句告诉模型什么情况下可以调退款工具,不写的话模型往往只回答「是重复扣款,建议联系客服」,不会主动提交申请。
- `temperature: 0,` `ToolLoopAgent` 的设置里包含了普通的模型调用参数,和 Day 27 一样设 0 方便复现。
- `find_customer: tool({` 对象的键就是工具名。`tool()` 这个函数运行时几乎什么都不做,主要作用是让 TypeScript 从 `inputSchema` 推出 `execute` 参数的类型:在 `execute` 里把鼠标放到 `query` 上,能看到它是 `string`。
- `customer_id: z.string().regex(/^C\d{3}$/).describe('客户编号,如 C007'),` zod 的 `regex` 会变成 JSON Schema 的 `pattern`,和 Python 版 `Field(pattern=...)` 一样。模型传了 `"7"`,AI SDK 在执行前就校验失败,产生一个 tool-error 交给模型,`execute` 根本不会被调用。
- `limit: z.number().int().min(1).max(20).default(6),` `.default(6)` 让这个字段在输入里变成可选,模型不传时 `execute` 拿到的是 6。`min`/`max` 对应 Python 版 `ge=1, le=20`。
- `execute: async ({ customer_id, status, limit }) => listInvoices(customer_id, status, limit),` `listInvoices` 是同步函数,包在 `async` 里返回值就成了 Promise,AI SDK 两种都接受。
- `amount_yuan: z.number().positive().describe('退款金额,单位元'),` `positive()` 即 `> 0`,对应 Python 的 `gt=0`。
- `toolApproval: { create_refund_request: 'user-approval' },` 这是 AI SDK 7 的新写法:哪个工具要审批,在 Agent 上配,不在工具上配(6 的 `needsApproval: true` 已废弃)。`'user-approval'` 的意思是发出一个审批请求、等明确的回复再执行。类型声明里还能写成函数,根据参数动态决定,比如「金额超过 500 元才要审批」,练习 3 让你试。
- `experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,` 类型声明里的注释说得很清楚:设了它,服务端在发出审批请求时用 HMAC 签名,审批结果传回来时校验签名,防止客户端伪造审批。为什么需要它?因为服务端是无状态的,每次请求浏览器都会把完整的消息历史发上来,审批结果也在历史里。不签名的话,任何人改一下请求体,写一条「approved: true」,就能让服务端执行退款工具。名字带 `experimental_`,说明以后可能改名。
- `stopWhen: isStepCount(8),` 最多 8 步,一步是一次模型调用加上它触发的工具执行。不设的话文档说默认 20 步。注意这里每次 HTTP 请求单独计数,用户点了审批之后发起的新请求,步数从头算。
- `export type AccountantMessage = InferAgentUIMessage<typeof accountant>;` 从 Agent 的定义推导出前端消息的类型。前端拿到这个类型后,`part.type === 'tool-list_invoices'` 时 `part.input.customer_id` 有类型提示,工具改了参数前端立刻标红。这就是全 TS 最大的好处,Day 49 我们是手写 `events.ts` 和后端保持同步的。

</div>

路由:

```ts
// agent-60-lab/topics/ts-agents/ledger-next/src/app/api/chat/route.ts
import { createAgentUIStreamResponse } from 'ai';
import { accountant } from '@/lib/agent';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { messages } = await req.json();
  return createAgentUIStreamResponse({ agent: accountant, uiMessages: messages });
}
```

<div class="line-notes">

- `export const runtime = 'nodejs';` better-sqlite3 是原生模块,只能跑在 Node 运行时,不能跑在 Edge。Route Handler 默认就是 nodejs,写出来是给以后读代码的人看的。Next.js 默认会把 better-sqlite3 当作服务端外部包不打包进 bundle;如果你遇到打包报错,在 `next.config.ts` 里加 `serverExternalPackages: ['better-sqlite3']`。
- `const { messages } = await req.json();` `useChat` 默认 POST 的请求体里有 `messages`,是完整的 UI 消息历史(包括之前的工具调用和审批结果)。服务端不存会话,这和 Day 36 我们自己在 Redis 里存会话是两种思路。
- `return createAgentUIStreamResponse({ agent: accountant, uiMessages: messages });` 一行做完三件事:把 UI 消息转换成模型消息、跑 Agent 循环、把过程编码成 UI Message Stream 作为 SSE 响应返回。响应里的事件类型(文本增量、工具输入、工具输出、审批请求)就是 Day 49 那节「它要求后端说它的协议」里提到的那套。

</div>

## 前端:useChat 和工具卡片

```tsx
// agent-60-lab/topics/ts-agents/ledger-next/src/app/page.tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { useState } from 'react';
import type { AccountantMessage } from '@/lib/agent';

export default function Page() {
  const [input, setInput] = useState('user007@example.com 这个客户 10 月有没有被重复扣款?有的话帮我提交退款申请。');
  const { messages, sendMessage, status, addToolApprovalResponse } = useChat<AccountantMessage>({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      {messages.map((m) => (
        <section key={m.id} aria-label={m.role === 'user' ? '你' : '账务专员'}>
          {m.parts.map((part, i) => {
            switch (part.type) {
              case 'text':
                return <p key={i}>{part.text}</p>;
              case 'tool-find_customer':
              case 'tool-list_invoices':
                return (
                  <details key={i}>
                    <summary>
                      {part.type.slice(5)} · {part.state}
                    </summary>
                    <pre>{JSON.stringify(part.state === 'output-available' ? part.output : part.input, null, 2)}</pre>
                    {part.state === 'output-error' && <p role="alert">{part.errorText}</p>}
                  </details>
                );
              case 'tool-create_refund_request':
                if (part.state === 'approval-requested') {
                  return (
                    <div key={i} role="group" aria-label="退款申请确认">
                      <p>
                        要提交退款申请吗?发票 {part.input.invoice_id},金额 ¥{part.input.amount_yuan},原因:{part.input.reason}
                      </p>
                      <button onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: true })}>提交申请</button>
                      <button onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: false, reason: '用户取消' })}>
                        取消
                      </button>
                    </div>
                  );
                }
                if (part.state === 'output-available') {
                  return <p key={i}>已提交退款申请 #{part.output.refund_request_id},等待主管审批。</p>;
                }
                if (part.state === 'output-denied') {
                  return <p key={i}>你取消了这次退款申请。</p>;
                }
                return <p key={i}>退款申请:{part.state}</p>;
              default:
                return null;
            }
          })}
        </section>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage({ text: input });
          setInput('');
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} style={{ width: '100%' }} />
        <button type="submit" disabled={status !== 'ready'}>
          发送
        </button>
      </form>
    </main>
  );
}
```

<div class="line-notes">

- `'use client';` 用了 `useState` 和 `useChat` 这些 hook,必须是客户端组件。
- `import type { AccountantMessage } from '@/lib/agent';` 一定要用 `import type`。`agent.ts` 引了 `ledger.ts`,`ledger.ts` 引了 better-sqlite3,普通 import 会让 Next.js 试图把一个原生数据库模块打进浏览器的包里,直接构建失败。`import type` 在编译后会被完全删掉,只留下类型信息。
- `useChat<AccountantMessage>({` 泛型参数让 `messages` 的类型精确到我们的三个工具。去掉它代码照样能跑,只是 `part.input.invoice_id` 会变成 `unknown`,有红线。
- `transport: new DefaultChatTransport({ api: '/api/chat' }),` 传输层,默认就是 POST `/api/chat`,写出来是为了让你知道换地址改哪里。
- `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,` 用户点了审批按钮之后,只是在本地的消息里记下审批结果,不会自动发请求。这个函数判断「最后一条助手消息里所有审批都有答复了」,满足时 `useChat` 自动把消息再 POST 一次,服务端拿到审批结果后继续执行工具。不加这一行,点完按钮界面就停住了,这是我觉得新手最容易漏的一行。
- `m.parts.map((part, i) => {` AI SDK 5 以后,消息内容不是一个字符串,而是一个 `parts` 数组:文本、工具调用、推理过程、文件,按时间顺序排在一起。一条助手消息里可能是「文本→工具→工具→文本」。
- `case 'tool-find_customer':` 工具 part 的 `type` 是 `tool-` 加工具名。因为有了 `AccountantMessage` 类型,TypeScript 知道一共有哪几种 type,写错工具名会标红。
- `{part.type.slice(5)} · {part.state}` 去掉前 5 个字符 `tool-`,显示 `list_invoices · output-available`。`state` 在类型声明里有 `input-streaming`(参数还在流式生成)、`input-available`(参数齐了、正在执行)、`output-available`、`output-error`,需要审批的工具还多 `approval-requested`、`approval-responded`、`output-denied` 三种。
- `{part.state === 'output-error' && <p role="alert">{part.errorText}</p>}` 工具抛错时显示错误文本,比如模型第一次传错了客户编号,你能在界面上看到「customer_id 校验失败」,然后下一个卡片是它改过参数后的重试。
- `if (part.state === 'approval-requested') {` 服务端发出审批请求后,这个 part 停在这个状态。此时 `part.input` 已经有完整参数,可以展示给用户看清楚再决定。
- `addToolApprovalResponse({ id: part.approval.id, approved: true })` `id` 是审批请求的 id,不是工具调用的 id。在 7.0.148 的类型声明里,这个函数接受 `id`、`approved` 和可选的 `reason`。
- `approved: false, reason: '用户取消'` 拒绝时带上原因,文档说这个原因会写进 `execution-denied` 工具结果交给模型,模型读到后通常会回一句「好的,已取消」。
- `part.output.refund_request_id` 有类型提示,来自 `ledger.ts` 里 `createRefundRequest` 的返回值类型,一路从数据库函数推导到了 React 组件里。
- `sendMessage({ text: input });` 发一条用户消息。`useChat` 会把它追加到 `messages` 里,然后把整个历史 POST 给服务端。
- `disabled={status !== 'ready'}` `status` 有 `submitted`、`streaming`、`ready`、`error` 几种,请求进行中禁用发送按钮,避免用户连点发出两条。

</div>

运行:

```bash
npm run dev
```

打开 http://localhost:3000,直接点发送。整个过程大致是这样的(具体措辞和工具调用次数每次会有出入):

1. 出现 `find_customer · output-available` 卡片,展开能看到 C007 刘静的那条记录;
2. 出现 `list_invoices · output-available`,展开是 5 张或更多发票,头两张是 10 月 8 日的 INV-2026-0123 和 INV-2026-0026;
3. 一段文字说明 10 月 8 日重复扣款;
4. 出现退款申请确认框:「发票 INV-2026-0123,金额 ¥2392,原因:……」,两个按钮;
5. 点「提交申请」,界面自动发起第二次请求,出现「已提交退款申请 #N,等待主管审批」,最后模型补一句总结。

验证一下数据库确实写进去了:

```bash
sqlite3 data/cloudledger.db "SELECT id, invoice_id, amount_cents, status FROM refund_requests ORDER BY id DESC LIMIT 1;"
```

<div class="line-notes">

- `sqlite3 data/cloudledger.db` 查的是 `data/` 下的副本,不是 Day 23 的原库。应该看到一行 `status` 为 `pending_approval`、`amount_cents` 为 239200 的记录,发票号是模型选的那一张(两张都可能,它们一模一样)。

</div>

再试一次,这回点「取消」,数据库不应该有新记录。再试第三次,把问题改成「给 INV-2026-0029 退 3000 元」:即使你点了确认,`createRefundRequest` 也会因为超过发票金额抛错,模型会看到「最多还能申请 2392.00 元」并告诉你。这三次跑下来,你就验证了三层防线各管一段:界面确认管「用户知不知道」,业务校验管「规则允不允许」,主管审批管「有没有权限」。

## 同一个 Agent 用 Mastra 写

AI SDK 是工具包,Mastra 是框架。拿同一个 Agent 对比最能看出区别。Mastra 的文档说,`createTool` 的 `execute` 签名是 `(inputData, context)`,模型可以直接写 `'provider/model'` 字符串,也可以用对象形式指向任意 OpenAI 兼容的地址。

```bash
npm i @mastra/core@1.79.0
npm i -D tsx@4.23.15
```

```ts
// agent-60-lab/topics/ts-agents/ledger-next/scripts/mastra-accountant.ts
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { findCustomer, listInvoices } from '../src/lib/ledger';

const findCustomerTool = createTool({
  id: 'find_customer',
  description: '按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。',
  inputSchema: z.object({ query: z.string().describe('客户邮箱、姓名、公司名或客户编号(如 C007),支持部分匹配') }),
  execute: async ({ query }) => findCustomer(query),
});

const listInvoicesTool = createTool({
  id: 'list_invoices',
  description: '列出客户最近的发票(按开票日期倒序),金额单位为元。',
  inputSchema: z.object({
    customer_id: z.string().regex(/^C\d{3}$/),
    limit: z.number().int().min(1).max(20).default(6),
  }),
  execute: async ({ customer_id, limit }) => listInvoices(customer_id, undefined, limit),
});

const accountant = new Agent({
  id: 'accountant',
  name: '云簿账务专员',
  instructions: '你是云簿的账务专员。先用工具查事实,不要编造发票号和金额。',
  model: {
    id: `custom/${process.env.LLM_MODEL}`,
    url: process.env.LLM_BASE_URL!,
    apiKey: process.env.LLM_API_KEY,
  },
  tools: { find_customer: findCustomerTool, list_invoices: listInvoicesTool },
});

const res = await accountant.generate('user007@example.com 这个客户 10 月有没有被重复扣款?列出相关发票号和金额。');
console.log(res.text);
```

<div class="line-notes">

- `import { findCustomer, listInvoices } from '../src/lib/ledger';` 业务层原样复用。这就是前面坚持把业务逻辑写成普通函数的原因,换框架只换外面那一层。
- `const findCustomerTool = createTool({` Mastra 的工具多了一个 `id`,还可以写 `outputSchema` 校验返回值。
- `execute: async ({ query }) => findCustomer(query),` 第一个参数就是校验过的输入,直接解构。文档特别说明 `({ context })` 那种写法是旧版本的,网上教程里很常见,别抄。
- `model: {` 对象形式的模型配置:`id` 写成 `custom/模型名`,`url` 写 base URL(文档强调是基础地址,不是具体的 chat 接口地址),`apiKey` 自己传。如果用 OpenAI、Anthropic 这些 Mastra 内置的厂商,直接写 `'openai/gpt-...'` 字符串,key 从约定的环境变量读。
- `tools: { find_customer: findCustomerTool, list_invoices: listInvoicesTool },` 键名写成蛇形,和其他版本的工具名保持一致。
- `const res = await accountant.generate(` 顶层 `await` 能用,是因为 tsx 按 ESM 运行这个文件。`res.text` 是最终回答。

</div>

```bash
node --env-file=.env.local --import tsx scripts/mastra-accountant.ts
```

<div class="line-notes">

- `node --env-file=.env.local` Node 20.6 起内置的读 env 文件功能。脚本不经过 Next.js,`.env.local` 不会自动加载,得这样传进去。<br>`--import tsx` 让 Node 用 tsx 的加载器直接运行 TypeScript 文件,不用先编译。

</div>

只看这个例子,Mastra 和 AI SDK 的代码量差不多。它多出来的东西在别处:

- **Memory**:`@mastra/memory` 加一个存储(LibSQL、Postgres),Agent 就有线程级的对话历史和跨会话的工作记忆,不用像我们在路由里那样每次让前端把全部历史发上来。
- **Workflow**:有 `.then()`、`.branch()`、`.parallel()` 的步骤编排,还能挂起等人工输入再恢复,概念上对应 LangGraph 的图和 interrupt。
- **Durable Agents**:Mastra 2026 年推的功能,客户端断线后流式输出能接着续上,Agent 的执行和 HTTP 连接解耦。这正好是 Day 49「停止和断线」那一节我们手工处理的问题。
- **本地开发面板**:`npx mastra dev` 起一个 Playground,能直接和 Agent 对话、看每一步的 trace、跑评测。

简单说,只需要「一个 Agent + 一个聊天界面」,AI SDK 够了,依赖少、离 HTTP 近;需要记忆、多步工作流、可观测这一套,又不想自己拼,用 Mastra。

## Python 后端还是全 TypeScript

回到 Day 49 那个问题。现在两种做法你都写过了,可以对照着判断:

| 维度 | Python 后端 + TS 前端(Day 49) | 全 TypeScript(今天) |
| --- | --- | --- |
| 前后端类型同步 | 手写 `events.ts`,改协议要两边一起改 | `InferAgentUIMessage` 自动推导,改工具前端立刻标红 |
| 流式协议 | 自己定义,能精确表达 LangGraph 节点、中断 | AI SDK 的 UI Message Stream,开箱即用,表达不了的要用 `data-*` 自定义 part |
| 审批 | 另一个角色、另一个页面,服务端存状态 | 同一个对话里当前用户确认,服务端无状态 |
| 评测、数据分析 | Python 生态最全(pandas、Day 29–35 那一套) | 要么自己写,要么借 Langfuse、Braintrust 这类平台 |
| RAG、本地模型、微调 | 选择多 | 能用,但生态明显薄 |
| 部署 | 两个服务 | 一个 Next.js 应用,Vercel 一键部署 |
| 招聘市场 | 国内主流 | 海外创业公司常见 |

我的判断:**产品形态是「一个对话界面里的 Agent」、团队以前端为主、评测不复杂,全 TS 最快。** Agent 是后台流程的一部分、要接 RAG 和评测流水线、团队有 Python 的数据和算法同事,保持 Python 后端。还有一种常见的折中:前端用 `useChat`,后端还是 Python,在 Python 里输出 AI SDK 的 UI Message Stream 协议。Day 49 的课后练习让你做的就是这个,只要实现那几种事件类型就行。

面试里如果被问「为什么用 TS 写 Agent」,别只说「我是前端」。说类型从数据库函数一路推到 React 组件、少一个服务、工具审批的签名防伪造,这些是具体的工程理由。

## 动手练习

1. **跑通 Next.js 版。** 按上面的步骤跑通,完成「提交」「取消」「超额」三次测试。验收:`refund_requests` 表里只多了一条 `pending_approval` 记录,取消和超额那两次都没有写入。
2. **看一眼协议。** 打开浏览器开发者工具的 Network 面板,找到 `/api/chat` 请求,看响应里的事件。验收:在 `notes/ts-agents.md` 里列出你看到的事件类型(至少包括文本增量、工具输入、工具输出、审批请求四类各一个原样例子),和 Day 49 我们自定义的 node/step/tool/token/interrupt/done 一一对照。
3. **按金额决定要不要审批。** 把 `toolApproval` 里的 `'user-approval'` 改成一个函数:金额不超过 100 元直接执行,超过才要审批。函数签名看 `ai` 包类型声明里的 `SingleToolApprovalFunction`。验收:「给 INV-2026-0123 退 50 元」不弹确认框,「退 2392 元」弹。想一想:这个规则放在 `toolApproval` 里和放在 `createRefundRequest` 里,分别防的是什么。
4. **伪造审批。** 先去掉 `experimental_toolApprovalSecret`,在界面上触发审批请求后,用 curl 自己构造一个请求,把审批结果写成 `approved: true` 发到 `/api/chat`。然后加回 secret 再试一次。验收:记录两次的结果。这道题做完你会真正理解为什么无状态服务端的审批需要签名。
5. **Mastra 版加上记忆。** 按 Mastra 文档给 Agent 配 `@mastra/memory` 和 LibSQL 存储,连续问两句:「C007 是谁」「她 10 月有几张发票」。验收:第二句不用再说客户编号,Agent 能接上。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| AI SDK | Vercel 的 TypeScript AI 工具包,`ai` 是核心包,7.0 在 2026-06-25 发布 |
| ToolLoopAgent | AI SDK 里的 Agent 类,封装「调模型→执行工具→再调模型」的循环 |
| `isStepCount` | AI SDK 7 的停止条件,`stopWhen: isStepCount(8)` 表示最多 8 步;6 里叫 `stepCountIs` |
| `toolApproval` | AI SDK 7 配置哪些工具要审批的选项,替代 6 的 `needsApproval` |
| UI Message | `useChat` 里的消息类型,内容是 `parts` 数组,包含文本、工具调用、推理等 |
| UI Message Stream | AI SDK 定义的服务端到前端的 SSE 事件协议 |
| `InferAgentUIMessage` | 从 Agent 定义推导前端消息类型的类型工具 |
| `sendAutomaticallyWhen` | `useChat` 选项,满足条件时自动重新提交消息,审批后继续执行要靠它 |
| Mastra | 建在 AI SDK 模型层之上的 TS Agent 框架,有 Agent、Workflow、Memory、Playground |
| `createTool` | Mastra 定义工具的函数,`execute(inputData, context)` |
| `import type` | TypeScript 只导入类型的语法,编译后完全删除,不会把服务端模块带进浏览器包 |
| HMAC | 用密钥对消息做签名的算法,这里用来防止客户端伪造审批结果 |

## 常见误区

**照着 AI SDK 5 或 6 的教程写 7。** `stepCountIs`、`needsApproval`、`system` 这些在 7 里都改名或废弃了,ESM-only 也会让老的 `require` 写法直接报错。看教程先看它用的版本,和你 `package.json` 里的对不上就以官方迁移指南为准。

**以为 `useChat` 的审批等于业务审批。** 它只是让当前用户在执行前确认一下。需要另一个有权限的人批准的操作(退款、删数据、发邮件给客户),工具本身只能创建待审批记录,审批流程在业务系统里做。

**服务端无状态却不签名审批。** 每次请求都带着完整历史,历史是客户端给的,客户端就能改。有副作用的工具要么配 `experimental_toolApprovalSecret`,要么服务端自己存审批状态,不能信任请求体里的「已批准」。

**在客户端组件里普通 import 服务端模块。** 少写一个 `type`,Next.js 就会尝试把 better-sqlite3 打进浏览器包,报一堆找不到 `fs`、`path` 的错误,第一次见很难看出原因。

**漏了 `sendAutomaticallyWhen`。** 点完确认按钮什么都不发生,看起来像是按钮坏了。其实审批结果已经记在本地消息里了,只是没有人把它发回服务端。

**把 Mastra 当成 AI SDK 的替代品。** 它们是上下层关系:Mastra 的模型层用的就是 AI SDK 的接口,文档里说 AI SDK 的模型对象可以用在任何接受 `'provider/model'` 字符串的地方。选 Mastra 是为了它的 Memory、Workflow 和工具链,不是为了换掉 AI SDK。

## 学习资料

### 文档与文章

- [AI SDK 文档 · Building Agents](https://ai-sdk.dev/docs/agents/building-agents):`ToolLoopAgent`、`createAgentUIStreamResponse`、`InferAgentUIMessage` 的官方用法,今天的 agent.ts 和 route.ts 按它写。20 分钟。
- [AI SDK 文档 · Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage):`useChat` 里怎么渲染工具 part、怎么做审批、`experimental_toolApprovalSecret` 是防什么的。练习 3、4 必读。
- [AI SDK 7.0 迁移指南](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0):从 6 升级的所有破坏性变更。看到网上老代码报错,先来这里查。
- [AI SDK 文档 · OpenAI Compatible Providers](https://ai-sdk.dev/providers/openai-compatible-providers):`createOpenAICompatible` 的选项,`includeUsage`、`supportsStructuredOutputs` 的含义。
- [Mastra 文档 · Agents](https://mastra.ai/docs/agents/overview):Agent 和 `createTool` 的基本用法,注意新旧 `execute` 签名的说明。
- [Mastra 文档 · Models](https://mastra.ai/models):模型字符串、自定义 OpenAI 兼容地址的对象写法、怎么直接用 AI SDK 的模型对象。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dPKb69EJQ&autoplay=0&high_quality=1" title="Vercel AI SDK 7 到底是什么？和 LangChain、LangGraph、Mastra 怎么选" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>前端屎不了 · Vercel AI SDK 7 到底是什么?和 LangChain、LangGraph、Mastra 怎么选 · 2026-07 上传,12 分钟,讲 7 的定位和选型,和今天第一节的表格对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TVKV6YE3g&autoplay=0&high_quality=1" title="Mastra 到底是什么？和 LangChain、LangGraph 怎么选" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>前端屎不了 · Mastra 到底是什么?和 LangChain、LangGraph 怎么选 · 2026-07 上传,11 分钟,看 Mastra 比 AI SDK 多了哪些东西。</figcaption>
</figure>

- 敲呆龙《typescript ai agent 框架 mastra 教学》(B 站 BV1jKUWB7EF4,4 集共 22 分钟):手把手写 Mastra Agent 和工具,2025 年 11 月录的,是 1.0 之前的版本,`execute` 签名可能是旧写法,对照文档看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9dYcwOkpCE8" title="How We Solved Agent Building — Andrew Qu, Vercel" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Solved Agent Building — Andrew Qu, Vercel · Vercel 的工程师讲他们怎么设计 AI SDK 的 Agent 抽象,能听到 ToolLoopAgent 背后的取舍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/1qnmnRICX50" title="Mastra 1.0 is here - Intro to Mastra (2025 product tour)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Mastra · Mastra 1.0 is here - Intro to Mastra · 官方的产品导览,Agent、Workflow、Memory、Playground 都过一遍,看完知道练习 5 要做什么。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 6 章:Agent 的工具、规划和失败模式,和语言无关,今天讲的审批、步数上限在这一章都能找到理论依据。
- Boris Cherny《Programming TypeScript》(O'Reilly, 2019):如果 `Omit<>`、`as const`、字面量联合类型这些还不熟,读第 6 章「Advanced Types」。书比较老,类型系统的核心没变。

### 开源项目与代码

- [vercel/ai](https://github.com/vercel/ai):AI SDK 源码。`examples/` 目录下有 Next.js 的完整示例,`examples/next-fastapi` 是「Python 后端 + useChat」的折中方案,接 Day 49 的课后练习。
- [mastra-ai/mastra](https://github.com/mastra-ai/mastra):Mastra 源码,`examples/` 里有 Memory 和 Workflow 的例子。
- [openai/openai-agents-js](https://github.com/openai/openai-agents-js):OpenAI Agents SDK 的 JS 版,想对照 Day 27 的 Python 版可以看它的 examples。

## 自测

1. AI SDK 7 里,为什么用户点了审批按钮之后需要 `sendAutomaticallyWhen`?不加会怎样?

<details><summary>答案</summary>

`addToolApprovalResponse` 只是把审批结果写进本地的消息状态,不会发请求。服务端是无状态的,它不知道用户已经点了确认,工具也就一直不执行。`sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` 在最后一条助手消息的所有审批都有答复时,自动把整个消息历史再 POST 一次,服务端从历史里读到审批结果,执行工具并继续循环。不加的话,点完按钮界面停在原地,看起来像按钮坏了。

</details>

2. `experimental_toolApprovalSecret` 防的是什么攻击?不用它还有什么办法?

<details><summary>答案</summary>

防客户端伪造审批。服务端无状态,每次请求的消息历史都来自客户端,攻击者可以直接构造一条带「approved: true」的历史发给 `/api/chat`,让服务端执行本该经过确认的工具。设了 secret 后,服务端发出的审批请求带 HMAC 签名,回来时校验,伪造的审批签名对不上。不用它的办法是服务端自己存审批状态(比如在数据库里记一条待确认记录,审批时按 id 查),不信任请求体里的审批结果。还有一层兜底:敏感操作本身只创建待审批记录,真正执行要另一个有权限的人批。

</details>

3. 在 `page.tsx` 里把 `import type { AccountantMessage }` 写成 `import { AccountantMessage }` 会发生什么?为什么?

<details><summary>答案</summary>

很可能构建失败,报找不到 `fs`、`path` 之类的模块。`page.tsx` 是客户端组件,它 import 的模块会被打进浏览器的包。`agent.ts` 引了 `ledger.ts`,`ledger.ts` 引了 better-sqlite3 这个 Node 原生模块,浏览器里根本跑不了。`import type` 只导入类型,编译后整句被删除,所以不会把服务端代码带进来。即使某些情况下打包工具能摇树掉,也别依赖它,类型就用 `import type`。

</details>

4. `toolApproval` 写成「金额超过 100 元才要审批」,和在 `createRefundRequest` 里写「金额不能超过发票剩余金额」,这两条规则分别防什么?能不能只留一条?

<details><summary>答案</summary>

`toolApproval` 里的规则决定「执行前要不要让人看一眼」,防的是模型理解错意图、参数填错时直接生效,属于体验和风险分级。`createRefundRequest` 里的校验是业务不变量,防的是任何来源(模型、伪造请求、代码 bug)让数据违反规则。不能只留审批:用户可能没仔细看就点了确认,而业务规则必须无条件成立。也不建议只留业务校验:规则允许的操作不一定是用户想要的,比如模型选错了发票。两者加上主管审批,是三层不同的防线。

</details>

5. **面试题**:我们是一家海外 SaaS 创业公司,前端团队 4 人、没有 Python 工程师,想在产品里加一个能查账、能提交退款申请的 AI 助手。你会怎么选技术栈?什么情况下你会建议引入 Python?

<details><summary>答案</summary>

答题要点:团队全是前端、产品形态是应用内的对话助手,我会全用 TypeScript,Next.js Route Handler 里用 AI SDK 的 ToolLoopAgent,前端 `useChat`,工具直接调现有的后端 API 或数据库访问层,业务规则(退款金额、发票状态)放在业务层而不是 prompt 里;退款工具配 `toolApproval` 做用户确认并签名防伪造,工具本身只创建待审批记录,审批走现有的后台流程;步数上限、工具错误回传、token 用量记录都配上,接一个 tracing 平台看线上 trace。如果需要记忆、多步工作流和本地调试面板,再考虑上 Mastra。会建议引入 Python 的情况:要做复杂的 RAG(文档解析、rerank、自部署 embedding)、要建严肃的评测流水线和数据分析、要微调模型,或者招到了数据和算法同事。即便那时,也可以只把这些部分做成 Python 服务,对话层继续留在 TS。

</details>

6. 一次对话里,`stopWhen: isStepCount(8)` 的 8 步是怎么算的?用户点了审批之后呢?

<details><summary>答案</summary>

一步是一次模型调用加上它触发的工具执行,模型不再调工具、或者达到 8 步就停。每次 HTTP 请求单独跑一次 Agent 循环,所以单独计数:第一次请求里查客户、查发票、请求审批可能用了 3 步就停下等审批了;用户点确认后 `useChat` 发起新请求,这一次从头算,执行退款工具、写总结又是新的几步。如果你想限制整个对话的总步数或总花费,要自己在服务端记账,`isStepCount` 管不了跨请求的。

</details>

## 明天预告

专题篇可以跳着读。按编号,下一篇是 **Day 143 · 自动优化提示词:DSPy、GEPA 与 ACE**:Day 35 你给工单 Agent 建了评测集,手调 prompt 总有天花板。明天让优化器读失败轨迹、自己改 prompt,看分数能不能往上走,以及怎么防止它只是背下了测试集。
