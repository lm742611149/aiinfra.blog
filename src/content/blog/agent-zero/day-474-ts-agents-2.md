---
title: 'Day 474 · 用 TypeScript 写 Agent(二):useChat 工具卡片、Mastra 版,Python 后端还是全 TS'
description: '用 useChat 把工具调用和审批渲染成卡片,在真浏览器里用真模型点一遍批准和取消,并故意去掉 sendAutomaticallyWhen 看点完按钮为什么什么都不发生。再用 Mastra 把同一个 Agent 写一遍,踩到模型配置的类型、requireToolApproval 一刀切、没有存储就恢复不了审批三个坑,验证 Mastra 的记忆。最后用这两天的实测数字,和自己读流加 Python 后端那条路摆在一起,说清楚什么时候该全用 TypeScript。'
pubDate: 2026-10-23
regime: none
tags: ['typescript', 'vercel-ai-sdk', 'mastra', 'usechat', 'playwright', 'agent-zero']
series: 'agent-zero'
day: 474
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 473](/blog/agent-zero/day-473-ts-agents-1/) 在 Next.js 里把服务端写好了:业务函数、`ToolLoopAgent`、退款工具要审批、`/api/chat` 路由。审批的一整个来回用脚本在 Node 里跑过,也看过 curl 拿到的事件流,还伪造过审批:没有签名密钥时,工具真的被执行了。

但那一天的「用户」是脚本。今天把浏览器那一半写上:`useChat` 管消息列表和流,我们只负责把工具调用画成卡片、把审批画成两个按钮。然后用 Mastra 把同一个 Agent 再写一遍做对照,最后给「Python 后端还是全 TypeScript」一个有数据的回答。

## 今天要解决的问题

这一课默认你会 React,只讲 Agent 相关的部分。学完你应该能做到:

1. 用 `useChat` 渲染工具调用的几种状态和审批按钮,讲清楚 `sendAutomaticallyWhen` 为什么必须有,去掉以后实际会发生什么(我真去掉并测过)。
2. 在真浏览器里用 Playwright 把「批准」「取消」两条主路径点一遍,并说清楚这种调真模型的测试为什么只留两条、不放进每次提交都跑的流水线。
3. 用 Mastra 写出同一个 Agent,并能说出它在审批、记忆这两件事上和 AI SDK 的不同做法;遇到本课的三个报错能一眼认出原因。
4. 在「Python 后端加 TS 前端」和「全 TS」之间做选择,理由里有数字、有取舍。

预计用时 3 小时。前置:[Day 473](/blog/agent-zero/day-473-ts-agents-1/)(`ledger.ts`、`agent.ts`、`/api/chat`)、[Day 470](/blog/agent-zero/day-470-ui-components/)(工具卡片和审批按钮在 SupportPilot 里长什么样)、[Day 472](/blog/agent-zero/day-472-ui-audience/)(Playwright 的基本用法)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `page.tsx` 里工具 part 的 `switch` 和审批按钮默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 第一步:useChat 和工具卡片

先处理一个 Day 469 就见过的坑。`create-next-app` 生成的 `layout.tsx` 用了 `next/font/google`,开发服务器要去 Google 拉字体,国内网络经常卡住。和 Day 469 一样换成不引字体的版本,顺便把样式换成几十行自己的:

```tsx
// agent-zero-lab/part08/ts-agents/ledger-next/src/app/layout.tsx
// 去掉脚手架的 next/font/google(开发服务器启动时要去 Google 拉字体,国内网络常卡住),和 Day 469 一样
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: '云簿账务专员', description: 'AI SDK 7 的 ToolLoopAgent 演示' };

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

<div class="line-notes">

- `import './globals.css';` 全局样式,下面这个文件。
- `export const metadata: Metadata = {` 页面标题和描述。
- `export default function RootLayout({ children }: LayoutProps<'/'>) {` `LayoutProps` 是 Next.js 16 根据路由自动生成的全局类型,不用 import。
- `<html lang="zh-CN">` 读屏软件按中文读。

</div>

```css
/* agent-zero-lab/part08/ts-agents/ledger-next/src/app/globals.css */
:root { --ink:#1e2329; --soft:#474d57; --rule:#e6e8ea; --bg:#fafafa; --card:#fff; --accent:#8a6100; --accent-bg:#fdf3d1; --danger:#c62828; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --ink:#eaecef; --soft:#b7bdc6; --rule:#2b3139; --bg:#0b0e11; --card:#181a20; --accent:#f0b90b; --accent-bg:#2b2410; --danger:#f6465d; } }
body { margin: 0; font: 16px/1.7 system-ui, "PingFang SC", sans-serif; color: var(--ink); background: var(--bg); }
main { max-width: 46rem; margin: 0 auto; padding: 1.5rem; }
details, .card { background: var(--card); border: 1px solid var(--rule); border-radius: 8px; padding: .4rem .8rem; margin: .5rem 0; }
.approval { border-left: 3px solid var(--accent); background: var(--accent-bg); }
pre { font-size: 12px; overflow-x: auto; }
button { padding: .45rem 1rem; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: var(--bg); font: inherit; cursor: pointer; }
button:disabled { opacity: .45; cursor: not-allowed; }
button.ghost { background: transparent; color: var(--accent); }
input { width: 100%; padding: .5rem .6rem; border: 1px solid var(--rule); border-radius: 6px; font: inherit; background: var(--card); color: var(--ink); }
.user { margin-left: auto; width: fit-content; max-width: 85%; background: var(--accent-bg); padding: .4rem .8rem; border-radius: 10px; white-space: pre-wrap; }
.err { color: var(--danger); }
```

<div class="line-notes">

- `:root { --ink:#1e2329;` 一组颜色变量,和 Day 472 的工作台同一套,`--accent` 用的是 Day 472 axe 检查后改过的 `#8a6100`。`color-scheme: light dark` 让浏览器自带的控件跟着系统明暗。
- `@media (prefers-color-scheme: dark) { :root {` 深色模式换一套值。
- `main { max-width: 46rem; margin: 0 auto; padding: 1.5rem; }` 内容居中,手机上两边留 1.5rem。
- `details, .card { background: var(--card);` 工具卡片(`<details>`)和审批卡片(`.card`)共用外框。
- `.approval { border-left: 3px solid var(--accent); background: var(--accent-bg); }` 审批卡片加一条强调色的左边线和浅黄底,让它在一串工具卡片里一眼看得见。
- `button:disabled { opacity: .45; cursor: not-allowed; }` 禁用状态,下面发送按钮在等审批时会用到。
- `.user { margin-left: auto; width: fit-content;` 用户的话靠右、宽度跟着内容。

</div>

页面本身。这里是整个文件,下面逐段讲:

```tsx
// agent-zero-lab/part08/ts-agents/ledger-next/src/app/page.tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { useState } from 'react';
import type { AccountantMessage } from '@/lib/agent';

export default function Page() {
  const [input, setInput] = useState('user007@example.com 这个客户 10 月有没有被重复扣款?有的话帮我提交退款申请。');
  const { messages, sendMessage, status, error, addToolApprovalResponse } = useChat<AccountantMessage>({
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  // 最后一条消息里有还没回应的审批,就别让用户再发新消息(和 Day 470 客户页面停在审批时锁住输入框一个道理)
  const pending = messages.at(-1)?.parts.some((p) => p.type === 'tool-create_refund_request' && p.state === 'approval-requested') ?? false;

  return (
    <main>
      <h1>云簿账务专员</h1>
      {messages.map((m) => (
        <section key={m.id} aria-label={m.role === 'user' ? '你' : '账务专员'}>
          {m.parts.map((part, i) => {
            switch (part.type) {
              case 'text':
                return m.role === 'user' ? <p key={i} className="user">{part.text}</p> : <p key={i} style={{ whiteSpace: 'pre-wrap' }}>{part.text}</p>;
              case 'tool-find_customer':
              case 'tool-list_invoices':
                return (
                  <details key={i}>
                    <summary>
                      {part.type.slice(5)} · {part.state}
                    </summary>
                    <pre>{JSON.stringify(part.state === 'output-available' ? part.output : part.input, null, 2)}</pre>
                    {part.state === 'output-error' && <p role="alert" className="err">{part.errorText}</p>}
                  </details>
                );
              case 'tool-create_refund_request':
                if (part.state === 'approval-requested') {
                  return (
                    <div key={i} role="group" aria-label="退款申请确认" className="card approval">
                      <p>
                        要提交退款申请吗?发票 {part.input.invoice_id},金额 ¥{part.input.amount_yuan},原因:{part.input.reason}
                      </p>
                      <button onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: true })}>提交申请</button>{' '}
                      <button className="ghost" onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: false, reason: '用户取消' })}>
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
                if (part.state === 'output-error') {
                  return <p key={i} role="alert" className="err">退款申请没有提交:{part.errorText}</p>;
                }
                return <p key={i}>退款申请:{part.state}</p>;
              default:
                return null;
            }
          })}
        </section>
      ))}
      {error && <p role="alert" className="err">出错了:{error.message}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim()) return;
          sendMessage({ text: input });
          setInput('');
        }}
      >
        <label htmlFor="q" style={{ position: 'absolute', left: -9999 }}>问题</label>
        <input id="q" value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit" disabled={status !== 'ready' || pending}>
          发送
        </button>
      </form>
    </main>
  );
}
```

<div class="line-notes">

- `'use client';` 用了 `useState` 和 `useChat` 这些 hook,必须是客户端组件。
- `import { useChat } from '@ai-sdk/react';` 来自 `@ai-sdk/react` 4.0.154,和 `ai` 7.0.150 配套。
- `import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';` 一个传输层类,一个判断函数,后面用到。
- `import type { AccountantMessage } from '@/lib/agent';` 只要类型,不要值。写 `import type` 表达的是「这一行只在类型检查时存在」。我试过把 `type` 去掉(`import { AccountantMessage } ...`),在 Next.js 16.4.2 加 Turbopack 下 `next build` 照样通过,类型导入被自动丢掉了,旧课说会因为带进 better-sqlite3 而构建失败,我没复现。但这依赖打包器的行为,换成开了 `verbatimModuleSyntax` 的配置或者别的打包器就不一定,所以继续写 `import type`。
- `useState('user007@example.com` 输入框的默认值就是前面一直用的那句,点发送就能测。
- `useChat<AccountantMessage>({` 泛型参数让 `messages` 的类型精确到我们的三个工具。去掉它代码照样能跑,只是 `part.input.invoice_id` 会变成 `unknown`,有红线。
- `transport: new DefaultChatTransport({ api: '/api/chat' }),` 传输层,默认就是 POST `/api/chat`,写出来是为了让你知道换地址改哪里。
- `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,` **全文最容易漏的一行**。用户点审批按钮,只是在本地的消息里记下审批结果,不会发请求。这个函数判断「最后一条助手消息里所有审批都有答复了」,满足时 `useChat` 自动把消息再 POST 一次。下面会故意去掉它试一次。
- `const pending = messages.at(-1)?.parts.some((p) => p.type === 'tool-create_refund_request' && p.state === 'approval-requested') ?? false;` 最后一条消息里有没有等着回应的退款审批。`.at(-1)` 取最后一个元素,空数组时是 `undefined`,所以后面用 `?.` 和 `?? false`。
- `<section key={m.id} aria-label={m.role === 'user' ? '你' : '账务专员'}>` 每条消息一个有名字的区域,读屏软件能报「账务专员,区域」。
- `m.parts.map((part, i) => {` AI SDK 5 以后,消息内容不是一个字符串,而是一个 `parts` 数组:文本、工具调用、推理过程,按时间顺序排在一起。一条助手消息里可能是「文本、工具、工具、文本」。
- `switch (part.type) {` 因为有 `AccountantMessage` 类型,TypeScript 知道一共有哪几种 `type`,写错工具名会标红。
- `case 'text':` 用户的话靠右,助手的话原样显示。两处都当纯文本渲染,没有用 `dangerouslySetInnerHTML`,模型的输出不会变成 HTML(Day 470 的原则)。`whiteSpace: 'pre-wrap'` 让模型回的换行显示出来。
- `case 'tool-find_customer':` 工具 part 的 `type` 是 `tool-` 加工具名,两个只读工具共用一种卡片。
- `{part.type.slice(5)} · {part.state}` 去掉前 5 个字符 `tool-`,显示 `list_invoices · output-available`。
- `<pre>{JSON.stringify(part.state === 'output-available' ? part.output : part.input, null, 2)}</pre>` 有结果显示结果,没结果显示参数。
- `{part.state === 'output-error' && <p role="alert" className="err">{part.errorText}</p>}` 工具抛错时显示错误文本,比如模型第一次传错了客户编号。
- `case 'tool-create_refund_request':` 退款工具单独处理,因为它有审批。
- `if (part.state === 'approval-requested') {` 服务端发出审批请求后,这个 part 停在这个状态。此时 `part.input` 已经有完整参数,可以展示给用户看清楚再决定。
- `role="group" aria-label="退款申请确认"` 把卡片标成一个有名字的分组,读屏软件会报「退款申请确认,分组」,Playwright 也靠这个名字找到它。
- `要提交退款申请吗?发票 {part.input.invoice_id},金额 ¥{part.input.amount_yuan},原因:{part.input.reason}` 审批前必须把要执行的参数完整给用户看。三个字段都有类型提示,来自 `agent.ts` 里 zod 的定义。
- `addToolApprovalResponse({ id: part.approval.id, approved: true })` `id` 是审批请求的 id,不是工具调用的 id。批准;`approved: false` 加 `reason` 是拒绝,原因会作为工具的「被拒结果」交给模型。
- `if (part.state === 'output-available') {` 工具执行成功。`part.output.refund_request_id` 有类型提示,来自 `ledger.ts` 里 `createRefundRequest` 的返回值类型,一路从数据库函数推导到了 React 组件里。
- `if (part.state === 'output-denied') {` 用户取消。
- `if (part.state === 'output-error') {` 工具抛了错,比如金额超过发票剩余额度(Day 473 练习 4)。我最初没写这一支,工具出错时页面会落到最后那行「退款申请:output-error」,用户看不懂,所以补上。
- `return <p key={i}>退款申请:{part.state}</p>;` 兜底:其余状态(`input-streaming`、`input-available`、`approval-responded`)直接显示状态名。
- `{error && <p role="alert" className="err">出错了:{error.message}</p>}` `useChat` 在请求失败时把错误放在 `error` 里。
- `sendMessage({ text: input });` 发一条用户消息。`useChat` 把它追加到 `messages` 里,然后把整个历史 POST 给服务端。
- `<label htmlFor="q" style={{ position: 'absolute', left: -9999 }}>问题</label>` 给输入框一个看不见但读屏软件读得到的标签。
- `disabled={status !== 'ready' || pending}` `status` 有 `submitted`、`streaming`、`ready`、`error` 几种:请求进行中,或者有一个审批没回应时,禁用发送按钮。第二个条件是我跑完以后补的:原先只判断 `status`,流一结束 `status` 就回到 `ready`,等审批的时候输入框是亮的,用户可以直接再发一条,审批卡片就悬在那里了。

</div>

先不看浏览器,确认能构建:

```bash
npx tsc --noEmit        # 没有输出
npx next build          # 最后列出 / 和 /api/chat 两个路由
```

`next build` 的路由表是真实输出:

```text
Route (app)
┌ ○ /
├ ○ /_not-found
└ ƒ /api/chat
```

`○` 是静态页面,`ƒ` 是服务端按需渲染。`/` 是静态的,所有交互都在浏览器里;`/api/chat` 是动态的,每次请求都跑 Agent。

## 第二步:在真浏览器里点一遍

上一课用 curl 看过事件流,这一课用 Playwright 的 `chromium` 打开页面,读每一个阶段页面上的文字。脚本每 300 毫秒看一次工具卡片的摘要,变了就打印:

```ts
// agent-zero-lab/part08/ts-agents/ledger-next/scripts/peek_ui.mts
// 无头浏览器打开页面,把每个阶段 <main> 里的文字读出来:看工具卡片的 state 是怎么一步步变的
import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto('http://localhost:3474/');
await page.getByRole('button', { name: '发送' }).click();

const seen = new Set<string>();
const t0 = Date.now();
const snap = async (label: string) => {
  const summaries = await page.locator('summary').allInnerTexts();
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`, JSON.stringify(summaries));
};
// 每 300ms 看一次,摘要文字变了就打印
for (let i = 0; i < 300 && !(await page.getByRole('group', { name: '退款申请确认' }).isVisible()); i++) {
  const key = (await page.locator('summary').allInnerTexts()).join('|');
  if (!seen.has(key)) { seen.add(key); await snap('流式中'); }
  await page.waitForTimeout(300);
}
await snap('出现确认卡片');
console.log('卡片文字:', (await page.getByRole('group', { name: '退款申请确认' }).innerText()).replace(/\n/g, ' / '));
console.log('发送按钮 disabled =', await page.getByRole('button', { name: '发送' }).isDisabled());
await page.getByRole('button', { name: '提交申请' }).click();
await page.getByText(/已提交退款申请 #\d+/).waitFor({ timeout: 90_000 });
await snap('批准以后');
console.log('结尾:', (await page.locator('main section').last().innerText()).slice(0, 120).replace(/\n/g, ' / '));
await browser.close();
```

<div class="line-notes">

- `import { chromium } from '@playwright/test';` 不用测试运行器,直接用库来写脚本:自己启动浏览器、自己开页面。
- `const page = await (await browser.newContext()).newPage();` 一个干净的浏览器环境加一个标签页。
- `await page.getByRole('button', { name: '发送' }).click();` 页面里输入框已经有默认问题,直接点发送。
- `const seen = new Set<string>();` 记住看过的摘要组合,没变就不重复打印。
- `const snap = async (label: string) => {` 取页面上所有 `<summary>` 的文字(也就是各张工具卡片的标题行),连同相对开始的秒数打印出来。
- `for (let i = 0; i < 300 &&` 最多看 300 次(90 秒),确认卡片一出现就退出。`isVisible()` 不会等,当前能不能看见就返回当前的答案,适合这种自己轮询的场合。
- `await page.waitForTimeout(300);` 这里睡 300 毫秒是脚本在**自己**轮询,和测试里用 `waitForTimeout` 代替断言是两回事。
- `await snap('出现确认卡片');` 轮询结束,再打一次。
- `.innerText()).replace(/\n/g, ' / ')` 卡片文字里的换行换成斜杠,一行打印。
- `isDisabled()` 发送按钮此刻是不是禁用的。
- `await page.getByText(/已提交退款申请 #\d+/).waitFor({ timeout: 90_000 });` 点了批准以后等页面出现「已提交退款申请 #N」,`waitFor` 会等。

</div>

终端 1 起开发服务器,终端 2 跑脚本(`@playwright/test` 是 Day 472 装过浏览器的同一个版本,1.64.1):

```bash
npx next dev -p 3474
cp data/cloudledger.clean.db data/cloudledger.db
node --env-file=.env.local --import tsx scripts/peek_ui.mts
```

真实输出:

```text
[0.0s] 流式中 []
[1.3s] 流式中 ["find_customer · output-available"]
[2.2s] 流式中 ["find_customer · output-available","list_invoices · output-available"]
[8.0s] 出现确认卡片 ["find_customer · output-available","list_invoices · output-available"]
卡片文字: 要提交退款申请吗?发票 INV-2026-0123,金额 ¥2392,原因:重复扣款:2026-10-08 同客户同日同金额(2392.00元)存在两笔已支付发票。…… /  / 提交申请 取消
发送按钮 disabled = true
[5.7s] 批准以后 ["find_customer · output-available","list_invoices · output-available"]
```

(「出现确认卡片」那一行的 8.0 秒和「批准以后」的 5.7 秒是两次不同的运行,模型每次速度不一样;卡片文字里我把长长的原因截短了。)注意三件事:

- 工具卡片的 `state` 在流里实时变化:先看到 `find_customer`,1.3 秒时它已经是 `output-available`(查询很快),再来 `list_invoices`。中间还会出现 `input-streaming`、`input-available`,只是轮询间隔 300 毫秒没抓到。
- 8 秒左右确认卡片出现,里面是完整的发票号、金额、原因。**这一刻数据库还是空的**。发送按钮是灰的(`pending` 生效)。
- 点「提交申请」以后,「已提交退款申请 #N」几乎立刻出现:点击触发第二次请求,服务端先执行工具(写一行就结束),事件流第一条 `tool-output-available` 就到了,后面模型才开始写总结。

### 故意犯错:去掉 sendAutomaticallyWhen

把 `useChat` 里 `sendAutomaticallyWhen` 那一行(和上面对应的 import)删掉,重启,脚本换成点完「提交申请」以后等 15 秒再看:

```ts
// agent-zero-lab/part08/ts-agents/ledger-next/scripts/no_auto.mts(临时脚本)
import { chromium } from '@playwright/test';
import Database from 'better-sqlite3';

const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
const reqs: string[] = [];
page.on('request', (r) => { if (r.url().endsWith('/api/chat')) reqs.push(r.method()); });
await page.goto('http://localhost:3474/');
await page.getByRole('button', { name: '发送' }).click();
await page.getByRole('group', { name: '退款申请确认' }).waitFor({ timeout: 90_000 });
console.log('点之前:/api/chat 请求数 =', reqs.length);
await page.getByRole('button', { name: '提交申请' }).click();
await page.waitForTimeout(15_000);
console.log('点之后 15 秒:/api/chat 请求数 =', reqs.length);
console.log('页面上还有确认卡片吗:', await page.getByRole('group', { name: '退款申请确认' }).count());
const db = new Database('./data/cloudledger.db'); console.log('库里行数 =', (db.prepare('select count(*) c from refund_requests').get() as { c: number }).c); db.close();
await browser.close();
```

<div class="line-notes">

- `const reqs: string[] = [];` 记下页面发出的所有 `/api/chat` 请求。
- `page.on('request', (r) => { if (r.url().endsWith('/api/chat')) reqs.push(r.method()); });` 监听页面发出的每个网络请求,命中的记一笔。
- `console.log('点之前:/api/chat 请求数 =', reqs.length);` 点之前应该是 1:第一轮发消息那次。
- `await page.waitForTimeout(15_000);` 这里就是要「等一会儿看有没有事发生」,睡死的 15 秒是脚本的意图。
- `new Database('./data/cloudledger.db')` 直接开另一个连接读业务库,看有没有写入。

</div>

真实输出:

```text
点之前:/api/chat 请求数 = 1
点之后 15 秒:/api/chat 请求数 = 1
页面上还有确认卡片吗: 0
库里行数 = 0
```

点了按钮,**什么请求都没发**,15 秒里数据库一行没写。卡片消失了(这个 part 的 `state` 变成了 `approval-responded`,落到兜底那行显示「退款申请:approval-responded」),用户看到的是按钮点完变成一行奇怪的状态名,然后没有然后。这就是「看起来像按钮坏了」。把那一行加回来,页面恢复正常。

## 把两条主路径写成测试

真模型加真库的测试有几个特点:慢(每条 7 到 10 秒)、花钱(每条大约一分钱,按 Day 473 的价目算)、不稳定(模型每次措辞不同,偶尔选另一条路)。所以只留两条最重要的主路径,**不放进每次提交都跑的流水线**,改的是 Agent 或页面时手动跑,或者每晚一次。

```ts
// agent-zero-lab/part08/ts-agents/ledger-next/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  workers: 1, // 两条测试共用一个库和一个模型额度,串行跑
  timeout: 120_000, // 要真调模型,一次对话十几秒到半分钟
  reporter: 'list',
  use: { baseURL: 'http://localhost:3474', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx next dev -p 3474', // .env.local 由 Next.js 自己读
    url: 'http://localhost:3474',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

<div class="line-notes">

- `workers: 1,` 两条测试都会清空并读写同一张 `refund_requests` 表,并行会互相踩。
- `timeout: 120_000,` 单条测试最多 2 分钟,因为真调模型。Day 472 的 18 条测试默认 30 秒就够。
- `use: { baseURL: 'http://localhost:3474', trace: 'retain-on-failure' },` 和 Day 472 一样。
- `command: 'npx next dev -p 3474', // .env.local 由 Next.js 自己读` 这里用开发服务器而不是 build 后的版本,因为要读 `.env.local` 里的密钥(`next dev` 自动读,`next start` 也读,这里图省一次 build)。
- `reuseExistingServer: true,` 本地已经开着就直接用。

</div>

```ts
// agent-zero-lab/part08/ts-agents/ledger-next/e2e/chat.spec.ts
// 真调模型、真写库的端到端测试:贵(每条约 1 分钱)、不稳定(模型每次措辞不同),所以只留两条主路径,不要放进每次提交都跑的流水线
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';

const rows = () => {
  const db = new Database(process.env.CLOUDLEDGER_DB ?? './data/cloudledger.db');
  try {
    return db.prepare('SELECT invoice_id, amount_cents, status FROM refund_requests').all();
  } finally {
    db.close();
  }
};
test.beforeEach(() => {
  const db = new Database(process.env.CLOUDLEDGER_DB ?? './data/cloudledger.db');
  db.prepare('DELETE FROM refund_requests').run();
  db.close();
});

test('批准:卡片出现,点提交以后写库,页面显示申请编号', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '发送' }).click();

  const card = page.getByRole('group', { name: '退款申请确认' });
  await expect(card).toBeVisible({ timeout: 90_000 }); // 模型查客户、查发票、起草,要十几秒
  await expect(card).toContainText('INV-2026-0123');
  expect(rows()).toEqual([]); // 点之前库里什么都没有
  await expect(page.getByRole('button', { name: '发送' })).toBeDisabled(); // 有审批没回应,不能再发新消息

  await card.getByRole('button', { name: '提交申请' }).click();
  await expect(page.getByText(/已提交退款申请 #\d+,等待主管审批/)).toBeVisible({ timeout: 90_000 });
  expect(rows()).toEqual([{ invoice_id: 'INV-2026-0123', amount_cents: 239200, status: 'pending_approval' }]);
  await expect(page.getByRole('button', { name: '发送' })).toBeEnabled(); // 流结束,输入恢复
});

test('取消:显示已取消,库里一行都没有', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '发送' }).click();

  const card = page.getByRole('group', { name: '退款申请确认' });
  await expect(card).toBeVisible({ timeout: 90_000 });
  await card.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('你取消了这次退款申请。')).toBeVisible({ timeout: 90_000 });
  expect(rows()).toEqual([]);
});
```

<div class="line-notes">

- `import Database from 'better-sqlite3';` 测试文件直接开数据库检查。端到端测试不是只看页面,「数据有没有真的写进去」最该直接问库。
- `const rows = () => {` 每次开一个新连接查,查完关掉,不和服务端那个连接抢。`try / finally` 保证出错也会关。
- `test.beforeEach(() => {` 每条测试前清空 `refund_requests`。`DELETE` 是在另一个连接里做的,服务端的连接不受影响(不像换文件那样会让服务端拿着旧文件)。
- `await expect(card).toBeVisible({ timeout: 90_000 });` 默认 5 秒的等待太短,模型要查两次库再起草。这是整条测试里最慢的一行。
- `await expect(card).toContainText('INV-2026-0123');` 不检查原因那句话:模型每次措辞不同。只检查事实性的东西,发票号是确定的(0123 是后开的那张重复发票)。
- `expect(rows()).toEqual([]);` 点之前库里必须是空的。这一行证明「审批请求发出的时候,工具还没执行」。
- `.toBeDisabled(); // 有审批没回应,不能再发新消息` 刚才补的 `pending` 逻辑的测试。
- `await card.getByRole('button', { name: '提交申请' }).click();` 点批准。
- `await expect(page.getByText(/已提交退款申请 #\d+,等待主管审批/)).toBeVisible({ timeout: 90_000 });` 用正则匹配申请编号,不写死数字。
- `expect(rows()).toEqual([{ invoice_id: 'INV-2026-0123', amount_cents: 239200, status: 'pending_approval' }]);` 库里恰好一行,发票、金额、状态都对。`toEqual` 会逐字段比。
- `.toBeEnabled(); // 流结束,输入恢复` 审批回应后 `pending` 变假、流结束 `status` 回 `ready`,发送按钮重新可用。
- `await card.getByRole('button', { name: '取消' }).click();` 取消路径:点「取消」。
- `await expect(page.getByText('你取消了这次退款申请。')).toBeVisible({ timeout: 90_000 });` 这一句是页面自己写的,不是模型写的,所以可以写死。

</div>

```bash
node --env-file=.env.local node_modules/.bin/playwright test
```

(用 `node --env-file` 启动是为了让测试进程自己也读到 `CLOUDLEDGER_DB`;不传的话上面用的是默认路径 `./data/cloudledger.db`,碰巧一样。)

真实输出:

```text
Running 2 tests using 1 worker

  ✓  1 e2e/chat.spec.ts:20:5 › 批准:卡片出现,点提交以后写库,页面显示申请编号 (8.5s)
  ✓  2 e2e/chat.spec.ts:36:5 › 取消:显示已取消,库里一行都没有 (6.7s)

  2 passed (16.2s)
```

## 第三步:同一个 Agent 用 Mastra 写

AI SDK 是工具包,Mastra 是框架。拿同一个 Agent 对比最能看出区别。业务层 `ledger.ts` 原样复用:这就是前面坚持把业务逻辑写成普通函数的原因,换框架只换外面那一层。

```bash
npm i @mastra/core@1.79.0 @mastra/libsql@1.27.0 @mastra/memory@1.39.0
```

(三个包都是 2026 年 10 月 23 日 npm 上的最新版。`@mastra/core` 要求 Node 22.13 以上。后两个本节后半会用到。)

```ts
// agent-zero-lab/part08/ts-agents/ledger-next/scripts/mastra_accountant.mts
// 同一个 Agent 用 Mastra 写:业务层(ledger.ts)原样复用,只换外面这一层
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createRefundRequest, findCustomer, listInvoices } from '../src/lib/ledger';

const findCustomerTool = createTool({
  id: 'find_customer',
  description: '按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。',
  inputSchema: z.object({ query: z.string().describe('客户邮箱、姓名、公司名或客户编号(如 C007),支持部分匹配') }),
  execute: async ({ query }) => findCustomer(query),
});

const listInvoicesTool = createTool({
  id: 'list_invoices',
  description: '列出客户最近的发票(按开票日期倒序),金额单位为元。可按状态过滤。',
  inputSchema: z.object({
    customer_id: z.string().regex(/^C\d{3}$/).describe('客户编号,如 C007'),
    status: z.enum(['paid', 'open', 'void', 'refunded']).optional(),
    limit: z.number().int().min(1).max(20).default(6),
  }),
  execute: async ({ customer_id, status, limit }) => listInvoices(customer_id, status, limit),
});

const refundTool = createTool({
  id: 'create_refund_request',
  description: '提交一条退款申请,状态为 pending_approval,不会立刻退钱,需要客服主管审批。只能对 paid 状态的发票申请。',
  inputSchema: z.object({
    invoice_id: z.string().describe('要退款的发票号,如 INV-2026-0123'),
    amount_yuan: z.number().positive().describe('退款金额,单位元'),
    reason: z.string().min(4).max(200).describe('退款原因,写清楚依据'),
  }),
  requireApproval: true, // Mastra 的审批写在工具上,和 AI SDK 7 写在 Agent 上不同
  execute: async ({ invoice_id, amount_yuan, reason }) => createRefundRequest(invoice_id, amount_yuan, reason),
});

const agent = new Agent({
  id: 'accountant',
  name: '云簿账务专员',
  instructions:
    '你是云簿的账务专员。先用工具查事实,不要编造发票号和金额。确认是重复扣款时,可以调用 create_refund_request 提交退款申请,金额等于重复的那一笔。',
  model: { providerId: 'custom', modelId: process.env.LLM_MODEL!, url: process.env.LLM_BASE_URL!, apiKey: process.env.LLM_API_KEY! },
  tools: { find_customer: findCustomerTool, list_invoices: listInvoicesTool, create_refund_request: refundTool },
});

// 审批要「暂停一个运行、以后再恢复」,运行的快照得有地方存:把 Agent 注册进一个带存储的 Mastra 实例。
// 单独 new 出来的 Agent 没有这个存储,approveToolCallGenerate 会报 AGENT_RESUME_NO_SNAPSHOT_FOUND
const mastra = new Mastra({
  agents: { accountant: agent },
  storage: new LibSQLStore({ id: 'mastra-store', url: 'file:./data/mastra.db' }),
});
const accountant = mastra.getAgentById('accountant');

const out = await accountant.generate('user007@example.com 这个客户 10 月有没有被重复扣款?有的话帮我提交退款申请。');
console.log('finishReason =', out.finishReason, '| 步数 =', out.steps.length);
console.log('工具调用:', out.steps.flatMap((s) => s.toolCalls.map((c) => c.payload.toolName)));
if (out.finishReason === 'suspended') {
  console.log('等审批:', out.suspendPayload.toolName, JSON.stringify(out.suspendPayload.args).slice(0, 120));
  const done = await accountant.approveToolCallGenerate({ runId: out.runId!, toolCallId: out.suspendPayload.toolCallId! });
  console.log('批准以后 finishReason =', done.finishReason);
  console.log(done.text.slice(0, 200));
} else {
  console.log(out.text.slice(0, 200));
}
```

<div class="line-notes">

- `import { Agent } from '@mastra/core/agent';` Mastra 按子路径导出:Agent、工具、Mastra 实例各在各的入口。
- `import { LibSQLStore } from '@mastra/libsql';` LibSQL 是 SQLite 的一个分支,这里只当「本地文件数据库」用,存审批暂停时的运行快照。
- `const findCustomerTool = createTool({` Mastra 的工具比 AI SDK 的 `tool()` 多一个 `id`,还可以写 `outputSchema` 校验返回值。官方文档特别警告:**普通对象写的工具会悄悄不执行**,必须用 `createTool()`。
- `execute: async ({ query }) => findCustomer(query),` 第一个参数就是校验过的输入,直接解构。网上旧教程里常见的 `({ context })` 写法是旧版本的。
- `requireApproval: true, // Mastra 的审批写在工具上` 和 AI SDK 7 的 `toolApproval: { 工具名: 'user-approval' }` 写在 Agent 上不同。写在工具上的好处是工具到哪个 Agent 里都带着审批;写在 Agent 上的好处是同一个工具在不同 Agent 里可以有不同策略。
- `model: { providerId: 'custom', modelId: process.env.LLM_MODEL!,` 对象形式的模型配置,指向任意 OpenAI 兼容地址。`url` 写基础地址,不是具体的 chat 接口。(这一行我改过两次,见下面「三个坑」。)
- `const mastra = new Mastra({` 把 Agent 注册进一个带存储的 Mastra 实例。`url: 'file:./data/mastra.db'` 是本地文件。
- `const accountant = mastra.getAgentById('accountant');` 用注册后的 Agent,而不是最初 `new` 出来的那个。后者没有存储。
- `const out = await accountant.generate('user007@example.com` 返回完整响应。Mastra 的 `generate` 第一个参数直接是字符串。
- `out.steps.flatMap((s) => s.toolCalls.map((c) => c.payload.toolName))` 每一步里的工具调用,工具名藏在 `payload.toolName`。
- `if (out.finishReason === 'suspended') {` 遇到要审批的工具,`generate()` 提前返回,`finishReason` 是 `'suspended'`(AI SDK 那边是 `tool-calls`)。
- `out.suspendPayload.toolName` 暂停载荷里有 `toolCallId`、`toolName`、`args`。
- `accountant.approveToolCallGenerate({ runId: out.runId!,` 批准:传回 `runId` 和 `toolCallId`,Mastra 从存储里取出那次暂停的运行快照,执行工具,继续跑到结束。`!` 是因为类型里这两个字段是可选的。拒绝用 `declineToolCallGenerate`。

</div>

```bash
cp data/cloudledger.clean.db data/cloudledger.db
node --env-file=.env.local --import tsx scripts/mastra_accountant.mts
sqlite3 data/cloudledger.db "select id,invoice_id,amount_cents,status from refund_requests"
```

真实输出:

```text
finishReason = suspended | 步数 = 2
工具调用: [ 'find_customer', 'list_invoices' ]
等审批: create_refund_request {"invoice_id":"INV-2026-0123","amount_yuan":2392,"reason":"客户 C007(半岛咖啡,刘静)2026年10月存在重复扣款:INV-2026-0026 与 INV-2026-0123 
批准以后 finishReason = stop
已核实并提交,情况如下:

**客户**:C007 半岛咖啡(刘静,user007@example.com)

**2026 年 9–10 月发票记录**
| 发票号 | 开具日期 | 支付日期 | 金额 | 状态 |
|---|---|---|---|---|
| INV-2026-0123 | 2026-10-08 | 2026-10-08 | 2392.00 | paid |
| INV-2
1|INV-2026-0123|239200|pending_approval
```

结果和 AI SDK 版一样:查客户、列发票两步,然后在退款工具上暂停(`suspended`),批准后工具执行,库里多一条 `pending_approval`。


<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="两种审批:AI SDK 把暂停状态放在浏览器带上来的消息历史里,服务端不存;Mastra 把暂停的运行快照存进服务端的存储,批准时用 runId 取回">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <text x="16" y="24" fill="var(--ink)">AI SDK 7:状态在客户端</text>
    <rect x="16" y="36" width="130" height="64" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="26" y="60" fill="var(--ink)">浏览器</text>
    <text x="26" y="80" font-size="11" fill="var(--ink-soft)">messages 带着审批</text>
    <rect x="190" y="36" width="130" height="64" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="200" y="60" fill="var(--ink)">服务端</text>
    <text x="200" y="80" font-size="11" fill="var(--ink-soft)">什么都不存</text>
    <text x="16" y="124" font-size="11" fill="var(--ink-faint)">要靠签名证明「这个批准是我发的」</text>
    <text x="336" y="24" fill="var(--ink)">Mastra:状态在服务端</text>
    <rect x="336" y="36" width="130" height="64" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="346" y="60" fill="var(--ink)">浏览器</text>
    <text x="346" y="80" font-size="11" fill="var(--ink-soft)">只带 runId</text>
    <rect x="496" y="36" width="130" height="64" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="506" y="60" fill="var(--ink)">服务端 + 存储</text>
    <text x="506" y="80" font-size="11" fill="var(--ink-soft)">暂停的运行快照</text>
    <text x="336" y="124" font-size="11" fill="var(--ink-faint)">批准只对服务端已有的 runId 有效</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="146" y1="68" x2="190" y2="68"/>
    <line x1="466" y1="68" x2="496" y2="68"/>
  </g>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
    <text x="16" y="164">优点:好扩容、不用管存储</text>
    <text x="16" y="184">代价:历史真假得自己证明,刷新就丢</text>
    <text x="336" y="164">优点:客户端伪造不出一个运行</text>
    <text x="336" y="184">代价:服务端要有存储,要管运行的生命周期</text>
  </g>
</svg>
<figcaption>同样是「等人批准再执行」,暂停的状态放哪,决定了要不要签名、刷新会不会丢、服务端能不能无状态。今天的两个实验分别是:去掉签名密钥(Day 473)和去掉存储(今天的坑 3)。</figcaption>
</figure>

### 我踩的三个坑

上面这份是第三版。前两版是这样挂的,都是真实报错。

**坑 1:模型配置的类型。** 旧课文章里写的是 `model: { id: \`custom/${model}\`, url, apiKey }`。`tsc` 报:

```text
scripts/mastra_accountant.mts(43,3): error TS2322: Type '{ id: string; url: string; apiKey: string | undefined; }' is not assignable to type 'DynamicArgument<MastraModelConfig | ModelWithRetries[], any>'.
```

查类型声明(`node_modules/@mastra/core/dist/llm/model/shared.types.d.ts`),对象形式有两种:`{ id: \`${string}/${string}\`, url?, apiKey? }` 和 `{ providerId: string, modelId: string, url?, apiKey? }`。第一种的 `id` 是模板字面量类型,我拼出来的普通 `string` 不满足;第二种拆成两个字段,没有这个问题,所以用第二种。`apiKey` 是 `string | undefined`,加 `!` 断言。

**坑 2:`requireToolApproval: true` 是一刀切。** 我最初在 `generate` 的第二个参数里写了 `{ requireToolApproval: true }`,以为是「启用审批」。结果第一个工具 `find_customer` 就暂停了:

```text
finishReason = suspended | 步数 = 0
工具调用: []
等审批: find_customer {"query":"user007@example.com"}
```

这个选项是让**所有**工具都要审批。我们只想让退款工具审批,工具上写了 `requireApproval: true` 就够了,调用时什么选项都不用传。

**坑 3:没有存储,恢复不了。** 最初的 `agent` 就是单独 `new` 出来直接用,批准时:

```text
MastraError: Agent "云簿账务专员" resumeGenerate() could not find a suspended run for runId "be251952-eb5b-4241-b131-c43db18a6c1a". The run has already finished (for example, an earlier approval or resume already handled it), never suspended, or the runId is invalid. ...
  id: 'AGENT_RESUME_NO_SNAPSHOT_FOUND',
  details: { runId: '...', agentName: '云簿账务专员', hasStorage: true }
```

报错说「找不到暂停的运行」,措辞里列了三种可能,其中没有一条是「你没配存储」,`hasStorage: true` 还会让人往别处想。原因是 Agent 单独使用时,暂停的运行快照没有地方持久保存;要把它注册进带存储的 `Mastra` 实例,用 `mastra.getAgentById()` 取出来用。这也是 Mastra 和 AI SDK 在审批上最大的不同:**AI SDK 的暂停状态在消息历史里(客户端带着),Mastra 的暂停状态在服务端的存储里**。前者无状态、要签名防伪造;后者有状态,批准只能对服务端已有的 `runId` 生效,客户端伪造不出一个服务端没有的运行。这和 [Day 473](/blog/agent-zero/day-473-ts-agents-1/) 最后对比 LangGraph 的那段是同一个道理。

### Mastra 多出来的东西:记忆

只看这个例子,Mastra 和 AI SDK 的代码量差不多。它多出来的东西在别处,先实测一个:记忆。给 Agent 加 `@mastra/memory`,同一个 `thread` 里的第二句话不用再说客户编号:

```ts
// agent-zero-lab/part08/ts-agents/ledger-next/scripts/mastra_memory.mts(只列和上一个脚本不同的部分)
import { Memory } from '@mastra/memory';

const agent = new Agent({
  id: 'accountant',
  name: '云簿账务专员',
  instructions: '你是云簿的账务专员。先用工具查事实,不要编造发票号和金额。回答简短。',
  model: { providerId: 'custom', modelId: process.env.LLM_MODEL!, url: process.env.LLM_BASE_URL!, apiKey: process.env.LLM_API_KEY! },
  tools: { find_customer: findCustomerTool, list_invoices: listInvoicesTool },
  memory: new Memory({ options: { lastMessages: 10 } }), // 存储沿用 Mastra 实例里配的 LibSQL
});

const mastra = new Mastra({
  agents: { accountant: agent },
  storage: new LibSQLStore({ id: 'mastra-store', url: 'file:./data/mastra-memory.db' }),
});
const accountant = mastra.getAgentById('accountant');

// 同一个 thread:第二句不说客户编号,看 Agent 能不能接上
const opts = { memory: { thread: 'demo-thread-1', resource: 'user-min' } };
const a = await accountant.generate('user007@example.com 是谁?', opts);
console.log('第一句:', a.text.slice(0, 80).replace(/\n/g, ' '));
const b = await accountant.generate('她 10 月有几张发票?', opts);
console.log('第二句:', b.text.slice(0, 120).replace(/\n/g, ' '));
console.log('第二句用到的工具:', b.steps.flatMap((s) => s.toolCalls.map((c) => c.payload.toolName)));
const c = await accountant.generate('她 10 月有几张发票?', { memory: { thread: 'demo-thread-2', resource: 'user-min' } });
console.log('换一个 thread 问同一句:', c.text.slice(0, 120).replace(/\n/g, ' '));
```

<div class="line-notes">

- `import { Memory } from '@mastra/memory';` 记忆是单独的包。
- `memory: new Memory({ options: { lastMessages: 10 } }),` 带上最近 10 条消息。存储用 `Mastra` 实例里配的那个 LibSQL。
- `url: 'file:./data/mastra-memory.db'` 换一个库文件,免得和审批那个混在一起。
- `const opts = { memory: { thread: 'demo-thread-1', resource: 'user-min' } };` `thread` 是一段对话,`resource` 是对话属于谁(一个用户可以有很多个线程)。每次调用把它们传进去,Mastra 按它们取历史、存新消息。
- `const a = await accountant.generate('user007@example.com 是谁?', opts);` 第一句带邮箱。
- `const b = await accountant.generate('她 10 月有几张发票?', opts);` 第二句只说「她」。能答上来,说明历史被带进了这一轮。
- `b.steps.flatMap((s) => s.toolCalls.map((c) => c.payload.toolName))` 看第二句调了哪些工具。
- `{ memory: { thread: 'demo-thread-2', resource: 'user-min' } }` 同一个用户,换一个线程问同一句话,对照组。

</div>

真实输出:

```text
第一句: 我会查询这个邮箱对应的客户记录。该邮箱对应客户:刘静,公司为半岛咖啡,客户编号 C007。  如需查看其订阅或发票记录,请告知。
第二句: 10 月(2026 年)共 2 张发票,均已付款:  | 发票号 | 开票日 | 金额 | |---|---|---| | INV-2026-0123 | 2026-10-08 | 2,392.00 元 | | INV-2026-0026 
第二句用到的工具: [ 'list_invoices' ]
换一个 thread 问同一句: 请问您指的是哪位客户?请给我姓名、邮箱或客户编号,我先查出客户记录,再看 10 月的发票。
```

同一个 thread 里,第二句只调了 `list_invoices`(没有重新 `find_customer`,它从历史里知道客户是 C007);换一个 thread,Agent 反问「您指的是哪位客户」。AI SDK 这边没有这一层:历史是前端带上来的,想跨刷新、跨设备保留,得自己存数据库。

除了记忆,Mastra 还多这些(我这次没有实测,来自官方文档的介绍,二手):Workflow(`.then()`、`.branch()`、`.parallel()` 的步骤编排,可挂起等人再恢复,对应 LangGraph 的图和 interrupt)、本地开发面板 `npx mastra dev`(能直接和 Agent 对话、看每步 trace、跑评测)。

简单说:只需要「一个 Agent 加一个聊天界面」,AI SDK 够了,依赖少,离 HTTP 近;需要记忆、多步工作流、可观测这一套,又不想自己拼,看 Mastra。

## 第四步:Python 后端还是全 TypeScript

现在两种做法你都写过了。先把这两天的实测数字摆出来,再下判断。

**代码量。** Day 469 到 471 的前端协议和状态层(`events.ts`、`sse.ts`、`api.ts`、`run.ts`、`useRun.ts`)一共 320 行。今天用 AI SDK 的同样位置:服务端 `route.ts` 8 行,浏览器端是 `useChat` 一次调用,`page.tsx` 一共 86 行,其中大部分是渲染。注意这不是公平的 1 比 1:SupportPilot 的 320 行里包含停止、断线重连、`/resume`、质检退回清草稿、七种自定义事件,AI SDK 版没有做这些(`useChat` 有 `stop` 和 `resumeStream`,我没有测过,这里不下结论)。准确的说法是:**通用的那部分,AI SDK 替你写了;业务特有的那部分,两边都得自己写。**

**类型从数据库一路到组件。** 今天 `part.output.refund_request_id` 在 React 组件里有类型提示,来自 `createRefundRequest` 的返回类型,中间没有手写一行类型同步。Day 469 的 `events.ts` 是手写的,后端改了事件要手动同步(靠 Day 472 的 `leak_scan` 和 Python 测试里的 69 对上去核)。

**真实成本。** 今天几次调模型实测:一次查到审批请求 0.00639 元(3 步,2869 输入 token,其中 2176 命中缓存,614 输出);一次完整批准加总结 0.01246 元。全天实跑(含若干次探索和练习)合计大约 0.2 元,没有逐笔记账。

| 维度 | Python 后端 + TS 前端(Day 467–472) | 全 TypeScript(Day 473–474) |
| --- | --- | --- |
| 前后端类型同步 | 手写 `events.ts`,改协议要两边一起改 | `InferAgentUIMessage` 自动推导,改工具前端立刻标红 |
| 流式协议 | 自己定义,能精确表达 LangGraph 节点、质检、花费这类业务事件 | AI SDK 的 UI Message Stream,开箱即用,表达不了的要用 `data-*` 自定义事件 |
| 审批 | 暂停状态存在服务端 checkpoint,可以由另一个人在另一个页面批 | 同一个对话里当前用户确认,服务端无状态,要靠签名防伪造 |
| 断线、停止、续跑 | 自己写(Day 471) | `useChat` 有 `stop`,续跑今天没测 |
| 评测、数据分析 | Python 生态最全(pandas、第六部分那一套) | 自己写,或借 Langfuse、Braintrust 这类平台 |
| RAG、本地模型、微调 | 选择多 | 能用,但生态明显薄 |
| 部署 | 两个服务 | 一个 Next.js 应用 |
| 招聘市场 | 国内主流 | 海外创业公司常见(下面有说明) |

关于招聘市场那一行:旧课基于一批 JD 的统计是「TypeScript 在海外岗位里出现的比例明显高于国内」,具体数字(海外约三分之一、美国本土接近一半)是旧课当时抓取的结果,我今天没有重新核对,当作二手信息。你自己投简历前,可以对着目标岗位的 JD 数一数。

我的判断:**产品形态是「一个对话界面里的 Agent」、团队以前端为主、评测不复杂,全 TS 最快。** Agent 是后台流程的一部分(比如 SupportPilot 的工单流水线)、要接 RAG 和评测流水线、团队有 Python 的数据和算法同事,保持 Python 后端。还有一种折中:前端用 `useChat`,后端还是 Python,在 Python 里输出 AI SDK 的 UI Message Stream 协议(响应头 `x-vercel-ai-ui-message-stream: v1`,事件类型就是你今天用 curl 看到的那些)。这条路我没有实现过,不下判断。

面试里如果被问「为什么用 TS 写 Agent」,别只说「我是前端」。说类型从数据库函数一路推到 React 组件、少一个服务、无状态服务端的审批要签名防伪造(你亲手伪造过),这些是具体的工程理由。

## 零件和大代码的对照

| 零件 | 文件 | 作用 |
| --- | --- | --- |
| `useChat`、工具 part 的 `switch`、审批按钮、`pending` | `src/app/page.tsx` | 浏览器端:消息、卡片、审批 |
| `layout.tsx`、`globals.css` | `src/app/` | 去掉 Google 字体,几十行自己的样式 |
| `peek_ui.mts`、`no_auto.mts` | `scripts/` | 无头浏览器读各阶段的页面,验证 `sendAutomaticallyWhen` 的作用 |
| `playwright.config.ts`、`e2e/chat.spec.ts` | 项目根目录 / `e2e/` | 真模型的端到端测试,两条主路径 |
| `mastra_accountant.mts` | `scripts/` | 同一个 Agent 的 Mastra 版,工具要审批,Agent 注册进带存储的 Mastra |
| `mastra_memory.mts` | `scripts/` | 给 Mastra Agent 加记忆,验证同一线程里能接上 |

## 动手练习

### 练习 1:审批卡片出现以后刷新页面

在确认卡片出现之后刷新页面,看对话、卡片和数据库各是什么状态,写成一条 Playwright 测试。想一想:这在真实产品里是个问题吗?怎么解决?

<details><summary>参考答案</summary>

```ts
// agent-zero-lab/part08/ts-agents/ledger-next/e2e/reload.spec.ts  练习 1:审批卡片出现以后刷新页面
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';

test('卡片出现后刷新页面:对话和卡片都没了,库里没有写入', async ({ page }) => {
  const db = new Database(process.env.CLOUDLEDGER_DB ?? './data/cloudledger.db');
  db.prepare('DELETE FROM refund_requests').run();

  await page.goto('/');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('group', { name: '退款申请确认' })).toBeVisible({ timeout: 90_000 });

  await page.reload();
  await expect(page.getByRole('group', { name: '退款申请确认' })).toHaveCount(0);
  await expect(page.locator('main section')).toHaveCount(0); // 一条消息都没有:useChat 的状态在内存里
  expect((db.prepare('SELECT count(*) AS c FROM refund_requests').get() as { c: number }).c).toBe(0);
  db.close();
});
```

<div class="line-notes">

- `const db = new Database(` 测试里开一个库连接,开头清表,结尾关闭。
- `await page.reload();` 浏览器刷新,整个 React 状态重建。
- `await expect(page.getByRole('group', { name: '退款申请确认' })).toHaveCount(0);` 卡片没了。
- `await expect(page.locator('main section')).toHaveCount(0);` 每条消息是一个 `<section>`,一个都没有:连用户自己的问题也没了。
- `expect((db.prepare('SELECT count(*) 库里仍是 0 行:工具从没被批准过,所以从没执行。

</div>

实跑通过(6.8 秒)。结论:`useChat` 的消息只在浏览器内存里,刷新就没了,没有任何东西会重新弹出那张审批卡片;而用户可能已经看过卡片、想再点。好处是安全的(没批准就没执行),坏处是用户体验差。真实产品里要把对话存下来:服务端按会话 id 存消息历史,页面加载时取回来作为 `useChat` 的初始 `messages`;或者审批改成走业务系统里的待办(Day 473 提到的「真正的审批在后台」),页面刷新后待办还在。这正是 Mastra 那种「暂停状态在服务端」的做法更有优势的地方。

</details>

### 练习 2:Mastra 版用户取消

把 `mastra_accountant.mts` 的批准改成 `declineToolCallGenerate`,带上 `reason: '用户取消'`。看 `finishReason`、数据库和模型最后说的话。

<details><summary>参考答案</summary>

只改一处:

```ts
// agent-zero-lab/part08/ts-agents/ledger-next/scripts/mastra_decline.mts(只列改动的一行)
const done = await accountant.declineToolCallGenerate({ runId: out.runId!, toolCallId: out.suspendPayload.toolCallId!, reason: '用户取消' });
```

<div class="line-notes">

- `accountant.declineToolCallGenerate({` 和 `approveToolCallGenerate` 同样的参数,多一个可选的 `reason`,文档说这个原因会代替工具结果返回给模型。

</div>

(其余部分和 `mastra_accountant.mts` 一样,我另存为 `mastra_decline.mts` 并把存储文件换成 `data/mastra-decline.db`。)真实输出:

```text
finishReason = suspended | 步数 = 2
工具调用: [ 'find_customer', 'list_invoices' ]
等审批: create_refund_request {"invoice_id":"INV-2026-0123","amount_yuan":2392,"reason":"重复扣款:2026-10-08 同一客户同一天产生两笔金额相同的扣款(INV-2026-0026 与 INV-2026-0
拒绝以后 finishReason = stop
I'll look up the customer first.我看了一下,**确实存在重复扣款**。

客户:刘静(半岛咖啡,C007)
...
```

数据库 `select count(*) from refund_requests` 返回 0。注意这一次模型的回答开头多了一句英文「I'll look up the customer first.」,看起来是第一步里模型说的话被拼进了 `text`(我没有去查 Mastra 的文档确认这是不是固定行为);做界面时拿 `text` 展示之前,先看一眼它里面有什么。

</details>

### 练习 3:Mastra 记忆

按本课「记忆」那一节自己写一遍,连续问「user007@example.com 是谁?」「她 10 月有几张发票?」,并换一个 thread 问同一句做对照。

<details><summary>参考答案</summary>

见上面「Mastra 多出来的东西:记忆」一节的脚本和真实输出。关键现象:同一个 thread 里第二句只调了 `list_invoices`,没有再 `find_customer`;换 thread 以后 Agent 反问是哪位客户。如果你的第二句也重新调了 `find_customer`,不算错,模型有时会选择再确认一次,看 `lastMessages` 有没有生效,要对比换 thread 的那一次。

</details>

### 练习 4:写一份选型备忘

假设你们团队要给产品加一个「查账、提退款申请」的 AI 助手。团队是 4 个前端加 1 个后端(Java),没有 Python 工程师。写一页备忘:选哪条路,理由,三个风险和对应的缓解。不需要写代码。

<details><summary>参考答案</summary>

(开放题,下面是一个示范,不是唯一答案,没有实跑,只引用了本课已测的事实。)

**选择:** 全 TypeScript,Next.js 加 AI SDK 7 的 `ToolLoopAgent`,工具直接调现有后端(Java)的 HTTP 接口,业务规则留在 Java 服务里。

**理由:** ①团队以前端为主,上手最快;②产品形态就是应用内的对话助手,不是后台批处理;③类型从工具参数一路到 React 组件,改工具时前端立刻标红(今天实测的好处);④少一个服务要运维。

**风险和缓解:**
1. 审批伪造。无状态服务端、审批结果由客户端带回:必须配 `experimental_toolApprovalSecret`,并在工具内部再做业务校验(今天实测:没有密钥时伪造的批准让工具真的执行了)。真正的退款审批留在后台待办里,工具只创建待审批记录。
2. 刷新丢状态。`useChat` 的消息在内存里(今天练习 1 实测):服务端存消息历史,页面加载时取回;或者接受这个限制,把需要持久的东西(审批)放在业务系统里。
3. 评测和观测薄弱。TypeScript 这边评测生态没有 Python 全:先借一个观测平台看线上 trace,评测集用脚本加 CI 跑,等评测变复杂再把评测部分拆成 Python 服务,对话层不动。

**什么时候改主意:** 要接复杂 RAG(文档解析、重排序)、要做严肃的评测流水线、或者招到了数据和算法同事,就把那部分做成 Python 服务。

</details>

**验收标准:** `npx next build` 通过;`playwright test` 两条主路径通过(会花约一分钱);你能复现并解释「去掉 `sendAutomaticallyWhen` 点完按钮没反应」;`mastra_accountant.mts` 跑完数据库多一条 `pending_approval`;你能说出 Mastra 版和 AI SDK 版在「暂停状态存在哪」上的区别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `useChat` | `@ai-sdk/react` 的 hook,管消息列表、流式更新、工具调用和审批的前端状态 |
| 工具 part 的 `state` | 工具调用在消息里的状态:`input-streaming`、`input-available`、`approval-requested`、`approval-responded`、`output-available`、`output-error`、`output-denied` |
| `addToolApprovalResponse` | `useChat` 提供的函数,在本地消息里记下用户对某次审批的回答,不发请求 |
| `sendAutomaticallyWhen` | `useChat` 的选项,条件满足时自动把消息再发一次;审批后继续执行靠它 |
| Mastra | 建在 AI SDK 模型层之上的 TypeScript Agent 框架:Agent、Workflow、Memory、本地开发面板 |
| `createTool` | Mastra 定义工具的函数,必须用它,普通对象会悄悄不执行 |
| `requireApproval` | Mastra 里写在工具上的审批开关;`generate()` 遇到它会以 `suspended` 提前返回 |
| 暂停的运行(suspended run) | Mastra 把等审批的 Agent 运行快照存进存储,用 `runId` 恢复 |
| thread / resource | Mastra 记忆里的两个维度:一段对话(thread)和它属于谁(resource) |
| LibSQL | SQLite 的一个分支,Mastra 默认的本地存储 |
| 二手信息 | 没有自己实测、转述官方文档或旧课的内容,文中会标明 |

## 常见误区

**漏了 `sendAutomaticallyWhen`。** 点完确认按钮,没有任何请求发出(我实测 15 秒内请求数没变,库里 0 行),看起来像按钮坏了。其实审批结果已经记在本地消息里了,只是没有人把它发回服务端。

**等审批的时候输入框还是亮的。** `status` 在流结束后就回到 `ready`,只看它,用户可以在审批没回应时又发一条,卡片悬在那里。要自己判断「最后一条消息里有没有等着回应的审批」。

**工具出错时没有对应的界面。** 如果只处理了 `approval-requested`、`output-available`、`output-denied`,工具抛错(比如金额超过发票)时页面会落到兜底的「退款申请:output-error」。每一种 `state` 都要想过。

**调真模型的端到端测试放进每次提交都跑的流水线。** 每条花钱、七八秒到半分钟、偶尔因为模型换了说法而红。只留最重要的两三条主路径,手动或每晚跑;日常用假后端(Day 471、472)。

**把 Mastra 的 `requireToolApproval: true` 当成「启用审批」。** 它让所有工具都要审批。只想让某一个工具审批,在这个工具上写 `requireApproval: true`。

**把 Mastra 的 Agent 单独 `new` 出来就用审批。** 恢复时报「找不到暂停的运行」,措辞里没提存储。要把 Agent 注册进带 `storage` 的 `Mastra` 实例。

**把 Mastra 当成 AI SDK 的替代品。** 它们是上下层关系:Mastra 的模型层用的是 AI SDK 的接口。选 Mastra 是为了它的 Memory、Workflow 和工具链,不是为了换掉 AI SDK。

**照着旧教程抄 Mastra 的模型配置。** 对象形式的 `id` 是模板字面量类型,拼出来的普通字符串过不了类型检查,用 `providerId` 加 `modelId` 两个字段的形式。

## 学习资料

### 文档与文章

- [AI SDK 文档 · Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage):`useChat` 里怎么渲染工具 part、怎么做审批、`sendAutomaticallyWhen` 和签名。今天页面按它写。英文。
- [AI SDK 文档 · Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol):UI Message Stream 的全部事件类型,Python 后端想接 `useChat` 就要实现这一页。英文。
- [Mastra 文档 · Agents](https://mastra.ai/docs/agents/overview):Agent 和 `createTool` 的基本用法,注意新旧 `execute` 签名的说明。英文。
- [Mastra 文档 · Human-in-the-loop](https://mastra.ai/docs/agents/human-in-the-loop):`requireApproval`、`suspended`、`approveToolCallGenerate` 的官方写法。英文。
- [Mastra 文档 · Models](https://mastra.ai/models):模型字符串和自定义 OpenAI 兼容地址的写法。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TVKV6YE3g&autoplay=0&high_quality=1" title="Mastra 到底是什么？和 LangChain、LangGraph 怎么选" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>前端屎不了 · Mastra 到底是什么?和 LangChain、LangGraph 怎么选 · 11 分钟,2026 年 7 月。看 Mastra 比 AI SDK 多了哪些东西,和今天「多出来的东西」那一节对照。</figcaption>
</figure>

- 敲呆龙《typescript ai agent框架 mastra教学》(B 站 BV1jKUWB7EF4,约 2 分钟的一集,2025 年 11 月上传):手把手写 Mastra Agent 和工具,是 1.0 之前的版本,`execute` 签名可能是旧写法,对照文档看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/1qnmnRICX50" title="Mastra 1.0 is here - Intro to Mastra (2025 product tour)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Mastra · Mastra 1.0 is here - Intro to Mastra · 官方的产品导览,Agent、Workflow、Memory、Playground 都过一遍。英文,开字幕。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 6 章讲 Agent 的工具、规划和失败模式,和语言无关。英文。
- Boris Cherny《Programming TypeScript》(O'Reilly,2019):类型系统(泛型、条件类型、模板字面量类型)是 AI SDK 和 Mastra 的类型推导的基础,第 4、6 章。英文。

### 开源项目与代码

- [vercel/ai](https://github.com/vercel/ai):AI SDK 源码。`examples/` 里有 Next.js 的完整示例,也有「Python 后端加 useChat」的折中方案。
- [mastra-ai/mastra](https://github.com/mastra-ai/mastra):Mastra 源码,`examples/` 里有 Memory 和 Workflow 的例子。
- [openai/openai-agents-js](https://github.com/openai/openai-agents-js):OpenAI Agents SDK 的 JS 版,想对照 Python 版可以看。

## 自测

1. 在 `useChat` 里点了审批按钮,为什么还需要 `sendAutomaticallyWhen`?去掉会怎样?

<details><summary>答案</summary>

`addToolApprovalResponse` 只是把审批结果写进本地的消息状态,不会发请求。服务端无状态,不知道用户点了确认,工具也就一直不执行。`sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` 在最后一条助手消息的所有审批都有答复时,自动把整个消息历史再 POST 一次。我实测去掉以后:点完按钮 15 秒内 `/api/chat` 请求数没变(仍是 1),数据库 0 行,页面上卡片变成一行「退款申请:approval-responded」。

</details>

2. 工具 part 的 `state` 有哪几种?退款工具各种状态下页面该显示什么?

<details><summary>答案</summary>

`input-streaming`(参数还在流式生成)、`input-available`(参数齐了,正在执行)、`approval-requested`(等用户确认,显示确认卡片和两个按钮)、`approval-responded`(用户已回应,等请求发出)、`output-available`(成功,显示申请编号)、`output-denied`(用户取消,显示已取消)、`output-error`(工具抛错,显示错误文本)。最后几种要都想到:只处理前三种,工具抛错时页面会落到兜底状态名上。

</details>

3. Mastra 的审批和 AI SDK 的审批,暂停的状态分别存在哪?这对「伪造审批」意味着什么?

<details><summary>答案</summary>

AI SDK:存在消息历史里,由客户端带着,服务端不存。所以必须签名,否则客户端能伪造「已批准」(Day 473 实测过)。Mastra:存在服务端的存储里(`LibSQLStore`),按 `runId` 保存暂停的运行快照,批准时只能针对服务端已有的 `runId`,客户端伪造不出一个服务端没有的运行。代价是服务端要有存储、要管理运行,不再是无状态的。

</details>

4. 用 Mastra 的 `requireApproval` 做审批时,恢复报 `AGENT_RESUME_NO_SNAPSHOT_FOUND`,最可能是什么原因?

<details><summary>答案</summary>

Agent 是单独 `new` 出来直接用的,没有注册进带 `storage` 的 `Mastra` 实例,暂停时的运行快照没有地方持久保存,恢复时自然找不到。解决:`new Mastra({ agents: {...}, storage: new LibSQLStore({...}) })`,用 `mastra.getAgentById()` 取 Agent。错误信息里列的三种可能(已经处理过、从没暂停过、runId 错)都不是真正原因,`hasStorage: true` 还会误导。

</details>

5. **面试题**:一个只有前端工程师的创业团队要做应用内的 AI 助手,你建议 Python 后端还是全 TypeScript?什么条件下你会改主意?

<details><summary>答案</summary>

答题要点:先问产品形态和团队。如果是应用内的对话助手、评测不复杂、团队以前端为主,全 TS 最快:AI SDK 的 ToolLoopAgent 加 `useChat`,类型从数据库函数一路到 React 组件,少一个服务;工具审批要配签名防伪造,真正有权限的审批留在业务系统;刷新丢状态等限制要提前说清并有对策。会改主意的条件:要接复杂 RAG(文档解析、重排序、自部署 embedding)、要建严肃的评测和数据分析流水线、要微调模型、招到了数据和算法同事,这些在 Python 生态里成熟得多。即使那时,也可以只把这些部分做成 Python 服务,对话层继续留在 TS。再补一句:我自己实测过两条路的代码量和审批机制的差别,不是只凭印象。

</details>

6. 调真模型的端到端测试应该怎么放进工程里?

<details><summary>答案</summary>

只留最重要的两三条主路径(批准、取消),断言事实性的内容(发票号、数据库里的行、固定文案),不断言模型的措辞。因为每条测试花钱(约一分钱)、慢(几秒到半分钟)、偶尔因为模型换了说法而红,所以不放进每次提交都跑的流水线,改了 Agent 或页面时手动跑,或者每晚一次。日常的界面回归用假后端的测试(Day 471、472)。

</details>

## 明天预告

明天是 [Day 475](/blog/agent-zero/day-475-week68-review/),第 68 周复习:毕业项目(Day 469–474)。这一周从自己读流的 React 界面,到三种用户的信息密度、Playwright 端到端测试,再到 TypeScript 全栈的 Agent,有不少代码和坑要串起来。明天画一张本周的知识地图,把每天的错题整理出来,并要求你默写一段本周的核心代码并跑通。
