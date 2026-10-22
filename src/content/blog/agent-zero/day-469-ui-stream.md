---
title: 'Day 469 · 界面(二):事件类型和读流,一次运行就是一个 reducer'
description: 'SupportPilot 的前端从这里开始。先说清为什么不用 AI SDK 的 useChat、为什么不能用 EventSource,然后把后端的七种事件写成 TypeScript 类型,用 fetch + TextDecoderStream + eventsource-parser 读 POST 的事件流,再写一个纯函数 reducer 把几十个事件折叠成界面状态。录一段真流做回放,不起模型也能联调;真模型那次质检退回两次转了人工,正好看清草稿怎么被清空。'
pubDate: 2026-10-22
regime: none
tags: ['typescript', 'sse', 'react', 'nextjs', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 469
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 468](/blog/agent-zero/day-468-week67-review/) 复习了这一周的后端,写了一个只走 HTTP 的测试,让一张工单从建单、审批一路聊到触发压缩。拼的过程中修了两个坑:`load_customer` 的每轮重置清单加了 outcome 和 reply,第二轮停在审批时 done 不再报上一轮的 resolved;`idle_thread` 只在真的停在审批时才返回 409,追问出错后工单不会被卡死。

到这里,后端对前端的承诺已经定死了:七种事件(node、step、tool、token、interrupt、error、done),一个流只以 done 或 error 结束;done 里的 outcome 只有真停在审批时才是 waiting_approval,没定稿时 reply 是 null。今天在浏览器这一侧把这份承诺接住。

## 今天要解决的问题

前端部分默认你会 React 和 Next.js,不讲组件怎么写、hook 是什么,只讲和 Agent 有关的部分。学完今天你应该能做到:

1. 说清楚为什么这个项目不用 AI SDK 的 `useChat`,为什么不能用浏览器自带的 `EventSource`。
2. 把后端的七种事件写成一个可辨识联合类型 `AgentEvent`,写出 `streamEvents`:用 fetch 发 POST,字节经过 `TextDecoderStream` 和 `eventsource-parser` 变成一个个类型化的事件;流没开起来时(404、409、422、后端没起)抛出带中文提示的错误。
3. 写出一个纯函数 `reducer`,把一次运行收到的几十到几百个事件折叠成界面状态,并能讲清两处设计:step 和 node 谁是「节点跑完了」的依据;质检退回时为什么要清空草稿。
4. 录一段真后端的事件流,用一个 30 行的回放服务器和一个调试页,在浏览器里不花钱地把 `useRun` 跑通。

预计用时 3 小时。前置:[Day 133](/blog/agent-zero/day-133-sse-principle/)(SSE 原理)、[Day 380](/blog/agent-zero/day-380-event-protocol/)(事件协议)、[Day 467](/blog/agent-zero/day-467-ui-api/)(六个接口、七种事件)、[Day 468](/blog/agent-zero/day-468-week67-review/)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `streamEvents` 和 `reducer` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先选路:AI SDK 的 useChat,还是自己读流

做 AI 聊天界面,React 圈子里最顺手的是 Vercel 的 AI SDK。2026 年 10 月我在 npm 上查到 `ai` 是 7.0.148,React 绑定 `@ai-sdk/react` 是 4.0.152,核心是 `useChat` 这个 hook:消息列表、流式更新、工具调用、连工具审批(协议里有 `tool-approval-request`、`tool-approval-response` 两种消息)都帮你管好了。它也能接 Python 后端。

听起来该直接用,我最后没用,原因有三条。

**它要求后端说它的协议。** `useChat` 消费的是 AI SDK 自己的 UI Message Stream 协议:后端响应头要带 `x-vercel-ai-ui-message-stream: v1`,每条消息是一个带 `type` 的 JSON,类型是 `text-delta`、`tool-input-available`、`data-*` 这些固定的名字,流最后以 `data: [DONE]` 结束(官方文档的 Stream Protocol 一页列了全部类型)。我们 Day 467 推的是自己定义的七种事件。要用 `useChat`,就得在 Python 那边再写一层翻译。

**我们的交互不完全是「聊天」。** `useChat` 的模型是同一个用户和 Agent 你来我往,消息列表由前端持有。SupportPilot 的审批是另一个人(客服)在另一个页面做的,审批恢复后的流推给的是客服的页面。硬塞进 `useChat` 的消息模型,要绕不少弯。

**学的目的。** 自己读流只要四十行,写完你会知道一个 SSE 流在浏览器里经过了哪几步:fetch 拿到字节流、解码成文本、按空行切成事件、解析 JSON、进 reducer。面试被问「流式输出前端怎么做」,你能讲到字节这一层,而不是「用了个 hook」。

所以今天用原生 fetch 读响应体,用 `eventsource-parser` 切事件,自己写 reducer。如果你以后起一个全新的 TypeScript 项目、后端也是 Node,AI SDK 是更好的选择,[Day 473](/blog/agent-zero/day-473-ts-agents-1/) 和 [Day 474](/blog/agent-zero/day-474-ts-agents-2/) 会专门用它写一遍,包括 `useChat` 的工具卡片。

### 为什么不能用 EventSource

浏览器自带 `EventSource`,专门读 SSE,还会自动重连。问题是它只能发 GET,不能带请求体,也不能加自定义请求头。我们的三个流式接口都是 POST:追问要带客户说的话,审批要带决定、审批人和备注。

有人会把接口改成 GET,把内容塞进 URL 参数。别这么做:审批是有副作用的操作,GET 会被浏览器预取、被缓存、被代理和访问日志完整记下来,还可能被重放。保持 POST,前端换成 fetch 读流。代价是自动重连没了,要自己处理,[Day 471](/blog/agent-zero/day-471-ui-robust/) 讲停止和断线时做。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1AdABzgEb8&autoplay=0&high_quality=1" title="AI对话的流式输出效果，使用fetch也可以轻松实现" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>前端周老师 · AI 对话的流式输出效果,使用 fetch 也可以轻松实现 · 10 分钟,2026 年。用 fetch 和 reader 一块块读流,和今天的 streamEvents 是同一个思路,看完再对照我们多做的两件事:TextDecoderStream 和按事件切分。</figcaption>
</figure>

## 第一步:建 web/ 目录

前端放在 SupportPilot 仓库的 `web/` 目录,和 Python 包平级。在 supportpilot 根目录:

```bash
cd supportpilot
npx --yes create-next-app@16.4.2 web --ts --app --no-eslint --no-tailwind --src-dir --import-alias "@/*" \
  --use-npm --disable-git --no-agents-md --yes
cd web
npm i eventsource-parser@4.1.2
npm i -D tsx@4.23.15
rm src/app/page.module.css
```

我本机生成出来的是 Next.js 16.4.2、React 19.3.0、TypeScript 5.9.3(2026 年 10 月)。版本号写死是故意的:前端生态半年一个大版本,教程不锁版本,过几个月照着敲就对不上了。`--disable-git` 是因为 supportpilot 根目录已经是一个 git 仓库(Day 441),不要在里面再套一个。`tsx` 是一个直接运行 TypeScript 文件的小工具,今天在 Node 里跑脚本用,相当于 Python 这边的 `uv run python xxx.py`。

几处脚手架的默认值要知道。`next.config.ts` 里默认打开了 `cacheComponents` 和 `partialPrefetching`,对我们这种全是客户端交互的页面没影响,不用动。脚手架的 `layout.tsx` 用了 `next/font/google`,开发服务器启动时要去 Google 拉字体,国内网络经常卡住;我还发现加了 `--no-agents-md`,第一次 `next dev` 时它还是生成了一个 `AGENTS.md`,删掉就行。

建完以后的结构(今天写 `lib/` 和 `scripts/`,组件和正式页面是 Day 470 的事):

```text
web/
├── fixtures/run.sse        # 今天录的一段真事件流
├── scripts/                # 在 Node 里跑的小脚本:录流、回放、检查 reducer
└── src/
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx        # 今天是调试页,Day 470 换成客户视角
    │   └── globals.css
    └── lib/
        ├── events.ts       # 事件类型,和后端 _events() 一一对应
        ├── sse.ts          # fetch + 解码 + 切事件
        ├── api.ts          # 六个接口的类型化封装
        ├── run.ts          # reducer,纯函数
        └── useRun.ts       # 把 reducer 接到 React 上
```

分层的想法是:`lib/` 里除了 `useRun.ts` 都不碰 React,只管协议和状态,所以能直接在 Node 里跑、在 Node 里测;`components/` 只拿状态渲染,不知道数据从哪来;`app/` 的页面把两者接起来。事件协议变了,只改 `events.ts`,TypeScript 会把所有要跟着改的地方标红。

还要改两处配置。`tsconfig.json` 的 `lib` 加一项 `"dom.asynciterable"`,`compilerOptions` 里加 `"allowImportingTsExtensions": true`。前者让 TypeScript 知道 `ReadableStream` 可以 `for await`(scripts 里会用到),后者允许 scripts 里写 `import ... from "../src/lib/run.ts"` 这种带后缀的导入,tsx 在 Node 里跑的时候需要后缀。

```json
"lib": ["dom", "dom.iterable", "dom.asynciterable", "esnext"],
"allowImportingTsExtensions": true,
```

## 第二步:把事件协议写成类型

先把 Day 467 那张七种事件的表写成 TypeScript。每一支对应后端 `_events()` 里的一种 `event:`,data 的形状来自 Day 460–466 各节点 `_emit()` 推的字典和 `_summary()` 的返回值:

```ts
// supportpilot/web/src/lib/events.ts
// 和后端 api/app.py 的 _events() 一一对应。后端改了事件,先改这里,让 TypeScript 帮你找漏掉的地方。

// args 是模型原样给的 JSON 字符串(act 节点直接转发),error 只说「有没有出错」
export type ToolEvent = { type: "tool"; name: string; args: string; error: boolean };

export type StepEvent =
  | { type: "step"; node: "load_customer"; found: boolean; profile: boolean }
  | { type: "step"; node: "prepare_context"; summarized_upto: number }
  | { type: "step"; node: "classify"; category: string }
  | { type: "step"; node: "retrieve"; docs: string[] }
  | { type: "step"; node: "check"; passed: boolean; problems: string[] };

export type RefundRequest = { id: string; amount_cny: number; rule: string; reason?: string };

// 和后端 _summary() 一一对应。done 事件和 GET /tickets/{id} 都是这个形状
export type Summary = {
  ticket_id: string;
  outcome: "resolved" | "escalated" | "waiting_approval" | null;
  category: string | null;
  reply: string | null;
  turns: number;
  cost_cny: number;
  waiting_on: string[];
};

export type AgentEvent =
  | { event: "node"; data: { node: string } }
  | { event: "step"; data: StepEvent }
  | { event: "tool"; data: ToolEvent }
  | { event: "token"; data: { type: "token"; text: string } }
  | {
      event: "interrupt";
      data: { type: "refund_approval"; ticket_id: string; request: RefundRequest; draft: string; needs_finance_review: boolean };
    }
  | { event: "error"; data: { message: string } }
  | { event: "done"; data: Summary };

export const STEP_NAMES: Record<string, string> = {
  load_customer: "查客户档案",
  prepare_context: "整理上下文",
  classify: "分诊",
  retrieve: "检索帮助中心",
  act: "查业务数据",
  draft: "起草回复",
  check: "质检",
  approval: "审批",
  finalize: "定稿",
  handoff: "转人工",
};
```

<div class="line-notes">

- `export type ToolEvent = { type: "tool"; name: string; args: string; error: boolean };` `args` 是**字符串**。Day 467 的 curl 输出里是 `"args": "{\"customer_id\": \"C0002\"}"`,外面那层 JSON 里套着一段 JSON 字符串。写成对象类型,Day 470 的工具卡片就会把它再 `JSON.stringify` 一遍,显示一屏反斜杠。
- `export type StepEvent =` 联合类型,每个 `|` 开头的一行是一种形状。
- `| { type: "step"; node: "load_customer"; found: boolean; profile: boolean }` `node` 写成字面量类型 `"load_customer"`,不是 `string`。TypeScript 靠它判断「node 是 load_customer 的这一支一定有 found 和 profile」。`profile` 是 Day 466 加的,只推「有没有画像」,不推画像全文。
- `| { type: "step"; node: "prepare_context"; summarized_upto: number }` Day 465 的压缩节点。实测第一轮是 0,不压缩的工单一直是 0。
- `| { type: "step"; node: "retrieve"; docs: string[] }` 实测是 5 个切块各自所属的文章编号,有重复:`["KB-refund-001", "KB-refund-003", "KB-refund-001", "KB-plans-002", "KB-refund-001"]`。
- `| { type: "step"; node: "check"; passed: boolean; problems: string[] }` 质检结果。下面真模型那次,problems 是很长的四句话。
- `export type RefundRequest = { id: string; amount_cny: number; rule: string; reason?: string };` 只写前端要用的几个字段。实测后端的 request 还带 invoice_id、customer_id、status、created_at、note 等,类型里没写的字段 TypeScript 不管,运行时照样在对象上。`reason?` 的问号表示可选。
- `outcome: "resolved" | "escalated" | "waiting_approval" | null;` 四种可能。null 是 Day 468 加的情况:跑到一半出错了,不冒充任何结局。
- `reply: string | null;` 没定稿时是 null(Day 468 改成了 `or None`,不会是空字符串)。
- `export type AgentEvent =` 按 `event` 字段区分的联合类型,叫可辨识联合(discriminated union)。`switch (e.event)` 之后,每个 case 里 `e.data` 的类型是确定的,写错字段名直接编译失败。
- `| { event: "token"; data: { type: "token"; text: string } }` 实测 token 是模型一次吐出的一小段,一两个字到十来个字不等。
- `data: { type: "refund_approval"; ticket_id: string; request: RefundRequest; draft: string; needs_finance_review: boolean };` 就是 approval 节点交给 `interrupt()` 的那个字典。needs_finance_review 是后端按 1000 元复核线算好的,前端不要自己再判断一遍。
- `| { event: "error"; data: { message: string } }` Day 467 `_events` 的 except 推的那一句固定的话。
- `export const STEP_NAMES: Record<string, string> = {` 节点名翻成中文。`Record<string, string>` 允许查不到,所以用的时候写 `STEP_NAMES[node] ?? node`,后端以后加了新节点也不至于空着。

</div>

这里我没有给 `StepEvent` 加一个「任意节点、任意字段」的兜底分支。加了的话,TypeScript 就没法只看 `node` 确定是哪一支,reducer 里处处要写 `"passed" in e.data` 这种额外判断。后端以后加了新的 step,运行时也不会崩:reducer 遇到不认识的节点什么都不做。代价是类型不再完全诚实,这个取舍我选了「类型严一点、代码干净一点」。

## 第三步:读流

整条读流的链路是这样的:

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="读流的链路:fetch 拿到字节块,TextDecoderStream 拼成文本,EventSourceParserStream 按空行切成事件,JSON.parse 得到 AgentEvent,进 reducer 变成 RunState">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="40" width="100" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="60" y="64" text-anchor="middle" fill="var(--ink)">fetch</text>
<text x="60" y="82" text-anchor="middle" fill="var(--ink-soft)">Uint8Array 块</text>
<rect x="135" y="40" width="110" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="190" y="64" text-anchor="middle" fill="var(--ink)">TextDecoder</text>
<text x="190" y="82" text-anchor="middle" fill="var(--ink-soft)">Stream → 文本</text>
<rect x="270" y="40" width="120" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="330" y="64" text-anchor="middle" fill="var(--ink)">EventSource</text>
<text x="330" y="82" text-anchor="middle" fill="var(--ink-soft)">ParserStream</text>
<rect x="415" y="40" width="95" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="462" y="64" text-anchor="middle" fill="var(--ink)">JSON.parse</text>
<text x="462" y="82" text-anchor="middle" fill="var(--ink-soft)">AgentEvent</text>
<rect x="535" y="40" width="95" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="582" y="64" text-anchor="middle" fill="var(--ink)">reducer</text>
<text x="582" y="82" text-anchor="middle" fill="var(--ink-soft)">RunState</text>
<g stroke="var(--ink-soft)"><line x1="110" y1="68" x2="135" y2="68"/><line x1="245" y1="68" x2="270" y2="68"/><line x1="390" y1="68" x2="415" y2="68"/><line x1="510" y1="68" x2="535" y2="68"/></g>
<text x="60" y="124" text-anchor="middle" fill="var(--ink-faint)">77 块 5673 字节</text>
<text x="190" y="124" text-anchor="middle" fill="var(--ink-faint)">半个汉字留到下一块</text>
<text x="330" y="124" text-anchor="middle" fill="var(--ink-faint)">按空行切,丢掉 : ping</text>
<text x="462" y="124" text-anchor="middle" fill="var(--ink-faint)">as,不校验</text>
<text x="582" y="124" text-anchor="middle" fill="var(--ink-faint)">纯函数</text>
<text x="200" y="170" fill="var(--ink-soft)">streamEvents() 负责前四格</text>
<line x1="10" y1="160" x2="510" y2="160" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="540" y="170" fill="var(--ink-soft)">run.ts</text>
<line x1="535" y1="160" x2="630" y2="160" stroke="var(--mem)" stroke-dasharray="4 3"/>
</g>
</svg>
<figcaption>浏览器里一个事件从字节到界面状态要经过五格。前四格是 streamEvents,最后一格是 reducer。下面一格一格写。</figcaption>
</figure>

```ts
// supportpilot/web/src/lib/sse.ts
// 三个流式接口都是 POST,浏览器自带的 EventSource 只能发 GET,所以用 fetch 读响应体,
// 交给 eventsource-parser 切成一条条事件。
import { EventSourceParserStream } from "eventsource-parser/stream";
import type { AgentEvent } from "./events";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function* streamEvents(
  url: string,
  init: { body?: unknown; signal?: AbortSignal } = {},
): AsyncGenerator<AgentEvent> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  if (!res.ok || !res.body) {
    // 404/409 在流开始前就返回了,body 是 {"detail": "..."};422 的 detail 是数组
    const detail = await res.json().then((j) => j.detail, () => res.statusText);
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream()).getReader();
  try {
    for (;;) {
      const { done, value: msg } = await reader.read();
      if (done) return;
      if (!msg.event) continue; // 没有 event: 行的消息我们不认识,跳过
      yield { event: msg.event, data: JSON.parse(msg.data) } as AgentEvent;
    }
  } finally {
    reader.releaseLock();
  }
}
```

<div class="line-notes">

- `import { EventSourceParserStream } from "eventsource-parser/stream";` eventsource-parser 4.1.2 的流式接口。它是一个 TransformStream:进去的是文本,出来的是一条条 `{event, data, id}` 对象。
- `export class ApiError extends Error {` 自定义错误,多带一个 HTTP 状态码,调用方可以按 409、422 分别处理。
- `export async function* streamEvents(` `async function*` 是异步生成器:函数体里既能 `await` 也能 `yield`,外面用 `for await (const e of streamEvents(...))` 一个个取。调用它的那一刻不会执行任何一行,第一次取值时才开始跑,这一点和 [Day 99](/blog/agent-zero/day-099-generators/) 的 Python 生成器一样。
- `init: { body?: unknown; signal?: AbortSignal } = {},` 三个流式接口都是 POST,所以不让传 method。`signal` 用来中途停止,点「停止」时 abort。
- `headers: { "content-type": "application/json", accept: "text/event-stream" },` 正好是后端 CORS 的 `allow_headers` 里放行的两个(Day 467)。多加一个自定义头,浏览器的预检就会失败。
- `body: init.body === undefined ? undefined : JSON.stringify(init.body),` `/run` 不带请求体;追问带 `{content}`;审批带 `{approved, approver, note}`。
- `if (!res.ok || !res.body) {` 状态码不是 2xx,说明流根本没开起来。Day 467 把 404、409 都放进了依赖,就是为了让它们在这里以普通 HTTP 错误的样子出现,而不是一个 200 加空流。
- `const detail = await res.json().then((j) => j.detail, () => res.statusText);` `then` 的第二个参数是失败回调:响应体不是 JSON 时退回 statusText。
- `throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));` 409 的 detail 是一句中文,直接给用户看;422 的 detail 是数组,先转成字符串(练习 3 让它更好读)。
- `const reader = res.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream()).getReader();` 字节 → 文本 → 事件,两次 `pipeThrough`。`getReader()` 拿到一个读取器,每次 `read()` 取一个事件。
- `const { done, value: msg } = await reader.read();` 解构的同时把 `value` 改名成 `msg`。
- `if (done) return;` 流结束,生成器结束,外面的 `for await` 自然退出。
- `if (!msg.event) continue;` 我们的后端每条都有 `event:` 行;没有的是别的东西推的,不认识就跳过。FastAPI 15 秒一次的 `: ping` 心跳(Day 467 练习 4)是注释,解析器已经吞掉了,根本到不了这里。
- `yield { event: msg.event, data: JSON.parse(msg.data) } as AgentEvent;` `as AgentEvent` 是**断言,不是校验**:后端推什么就当成什么。后端改了字段名,TypeScript 一声不吭,要到运行时才发现。想真的校验可以用 zod 这类库,我们靠 Day 467 的接口测试守住后端这一侧。
- `reader.releaseLock();` 写在 finally 里,正常结束、出错、被 abort 都会释放读取器的锁。

</div>

为什么用 `getReader()` 一个个 `read()`,不直接 `for await (const msg of stream)`?对 `ReadableStream` 直接 `for await`,Chrome 124、Firefox 110 起支持,Safari 要到 27 才支持(我查的是 MDN 兼容数据 8.1.6 版)。用 reader 手动读,哪个浏览器都没问题。scripts 里的脚本只在 Node 24 里跑,我就直接用了 `for await`。

接口封装就是把六个接口写成六个函数,三个流式的返回生成器,三个普通的返回 Promise:

```ts
// supportpilot/web/src/lib/api.ts
// 六个接口的类型化封装。三个流式的返回异步生成器,三个普通的返回 Promise。
import type { RefundRequest, Summary } from "./events";
import { ApiError, streamEvents } from "./sse";

export const API = process.env.NEXT_PUBLIC_SUPPORTPILOT_API ?? "http://localhost:8000";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail, () => res.statusText);
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

export type PendingRefund = RefundRequest & { ticket_id: string; customer_name: string; created_at: string };

export const createTicket = (t: { customer_email: string; subject: string; body: string }) =>
  json<{ ticket_id: string }>("/tickets", { method: "POST", body: JSON.stringify(t) });

export const getTicket = (id: string) => json<Summary>(`/tickets/${id}`);

export const listApprovals = () => json<PendingRefund[]>("/approvals");

export const runTicket = (id: string, signal?: AbortSignal) => streamEvents(`${API}/tickets/${id}/run`, { signal });

export const followUp = (id: string, content: string, signal?: AbortSignal) =>
  streamEvents(`${API}/tickets/${id}/messages`, { body: { content }, signal });

export const decide = (id: string, d: { approved: boolean; approver: string; note: string }, signal?: AbortSignal) =>
  streamEvents(`${API}/approvals/${id}`, { body: d, signal });
```

<div class="line-notes">

- `export const API = process.env.NEXT_PUBLIC_SUPPORTPILOT_API ?? "http://localhost:8000";` Next.js 只把 `NEXT_PUBLIC_` 开头的环境变量打进浏览器端代码,而且是在**构建时**替换成字面量,不是运行时读。部署时换后端地址要重新 build,这和 Python 那边运行时读 `.env` 的习惯不一样。在 Node 里跑 scripts 时它就是普通的环境变量。
- `async function json<T>(path: string, init?: RequestInit): Promise<T> {` 泛型 `T` 由调用方指定返回的形状,比如 `json<Summary>(...)`。
- `{ ...init, headers: { "content-type": "application/json", ...init?.headers } }` `...init?.headers` 是可选链加展开:init 没传时展开的是 undefined,什么都不加。
- `return res.json() as Promise<T>;` 同样是断言,不校验。
- `export type PendingRefund = RefundRequest & { ticket_id: string; customer_name: string; created_at: string };` `&` 是交叉类型,两边的字段合在一起。对应 Day 467 `/approvals` 那条 SQL 查出来的列。
- `json<{ ticket_id: string }>("/tickets", { method: "POST", body: JSON.stringify(t) });` 实测返回 `{"ticket_id":"T000153"}`。
- `export const runTicket = (id: string, signal?: AbortSignal) => streamEvents(` 返回的是生成器。调用的那一刻还没发请求,第一次取值时才真正 fetch。
- `export const decide = (` 审批也是 POST + SSE,所以同样走 `streamEvents`。

</div>

### 故意犯错:每块单独解码

`TextDecoderStream` 那一格能不能省?自己 `new TextDecoder().decode(chunk)` 一块块解码不行吗?网络是按字节切包的,一个汉字在 UTF-8 里占 3 个字节,完全可能被切在两个包里。本机连本机时一个事件通常就是一个包,很难碰到;到了公网、经过代理,就会碰到。

下面第四步会录一段真流存成 `fixtures/run.sse`,先借来用:把它每 7 个字节切一块,模拟网络在任意位置切包,比较两种解码:

```ts
// supportpilot/web/scripts/split_decode.mts
// 故意犯错:把录好的字节每 7 个切一块(模拟网络在任意位置切包),比较两种解码办法。
import { readFileSync } from "node:fs";

const bytes = new Uint8Array(readFileSync("fixtures/run.sse"));
const pieces: Uint8Array<ArrayBuffer>[] = [];
for (let i = 0; i < bytes.length; i += 7) pieces.push(bytes.slice(i, i + 7));

// 错误做法:每块单独 decode
const wrong = pieces.map((p) => new TextDecoder().decode(p)).join("");

// 正确做法:一个 TextDecoderStream 接住所有块,半个字留到下一块再拼
const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
  start(c) {
    pieces.forEach((p) => c.enqueue(p));
    c.close();
  },
}).pipeThrough(new TextDecoderStream());
let right = "";
for await (const text of stream) right += text;

const bad = (s: string) => [...s].filter((ch) => ch === "�").length;
console.log(`${pieces.length} 块;每块单独解码:乱码 ${bad(wrong)} 个;TextDecoderStream:乱码 ${bad(right)} 个`);
console.log("单独解码的第一处乱码附近:", JSON.stringify(wrong.slice(wrong.indexOf("�") - 12, wrong.indexOf("�") + 6)));
console.log("同一位置正确的样子:      ", JSON.stringify(right.slice(wrong.indexOf("�") - 12, wrong.indexOf("�") + 4)));
```

<div class="line-notes">

- `const bytes = new Uint8Array(readFileSync("fixtures/run.sse"));` 读成字节数组,不是字符串。录下来的文件一共 5673 字节。
- `const pieces: Uint8Array<ArrayBuffer>[] = [];` 类型写成 `Uint8Array<ArrayBuffer>`,不写尖括号的话 TypeScript 5.9 在后面 `pipeThrough` 那里报类型不兼容。这是 5.7 起 Uint8Array 变成泛型带来的小麻烦,和逻辑无关。
- `for (let i = 0; i < bytes.length; i += 7) pieces.push(bytes.slice(i, i + 7));` 每 7 字节一块,切出 811 块。
- `const wrong = pieces.map((p) => new TextDecoder().decode(p)).join("");` 每块用一个新的解码器。块尾的半个汉字解不出来,变成替换字符 U+FFFD(显示成 �)。
- `const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({` 手工造一个流,把 811 块依次塞进去,模拟 fetch 的 `res.body`。
- `}).pipeThrough(new TextDecoderStream());` 和 streamEvents 里同一个东西。它内部只有一个解码器,块尾不完整的字节先攒着,等下一块来了再拼。
- `for await (const text of stream) right += text;` Node 24 支持直接 `for await` 一个 ReadableStream。
- `const bad = (s: string) => [...s].filter((ch) => ch === "�").length;` 数替换字符有几个。`[...s]` 按字符拆开,相当于 Python 的 `list(s)`。

</div>

```bash
npx tsx scripts/split_decode.mts
```

真实输出:

```text
811 块;每块单独解码:乱码 202 个;TextDecoderStream:乱码 0 个
单独解码的第一处乱码附近: "reason\\\": \\\"���付��"
同一位置正确的样子:       "reason\\\": \\\"年付首次"
```

202 个乱码,第一处在 create_refund_request 的参数里,「年付首次」变成了「���付��」。打字机里的回复也一样会出现零星的 �。`TextDecoderStream` 一行代码就把这件事处理掉了。

### 流没开起来的三种情况

再看出错的那一半。写一个脚本,对着真后端(Day 467 的服务)打四个请求,这几个都在依赖里就返回了,不调模型:

```ts
// supportpilot/web/scripts/errors.mts
// 三种「流没开起来」的情况,streamEvents 各抛什么。不调模型(409/404 在依赖里就返回了)。
// 运行:SUPPORTPILOT_API=http://localhost:8000 npx tsx scripts/errors.mts T000153
import { ApiError, streamEvents } from "../src/lib/sse.ts";

const API = process.env.SUPPORTPILOT_API ?? "http://localhost:8000";
const id = process.argv[2] ?? "T000153";

async function tryOpen(label: string, url: string, body?: unknown) {
  try {
    for await (const e of streamEvents(url, { body })) console.log(label, "收到", e.event);
  } catch (err) {
    if (err instanceof ApiError) console.log(label, "ApiError", err.status, err.message);
    else console.log(label, (err as Error).name, (err as Error).message);
  }
}

await tryOpen("追问(停在审批):", `${API}/tickets/${id}/messages`, { content: "多久到账?" });
await tryOpen("审批(漏了 approver):", `${API}/approvals/${id}`, { approved: true });
await tryOpen("跑不存在的工单:", `${API}/tickets/T999999/run`);
await tryOpen("后端没起:", "http://localhost:9/tickets/T1/run");
```

<div class="line-notes">

- `import { ApiError, streamEvents } from "../src/lib/sse.ts";` 脚本在 `scripts/` 下,所以是 `../src/lib/`。带 `.ts` 后缀是 tsx 在 Node 里跑的要求,前面 tsconfig 加的 `allowImportingTsExtensions` 就是为这个。
- `const id = process.argv[2] ?? "T000153";` 命令行第一个参数,相当于 Python 的 `sys.argv[1]`。Node 里 `argv[0]` 是 node 本身、`argv[1]` 是脚本路径。
- `for await (const e of streamEvents(url, { body })) console.log(label, "收到", e.event);` 流开起来了就打印每个事件。这四个请求一个事件都不会收到。
- `if (err instanceof ApiError) console.log(label, "ApiError", err.status, err.message);` 后端返回的错误。
- `else console.log(label, (err as Error).name, (err as Error).message);` 网络层面的错误,请求根本没到后端。
- `await tryOpen("后端没起:", "http://localhost:9/tickets/T1/run");` 9 号端口上没有任何服务。

</div>

先起后端。在 supportpilot 根目录开一个终端(Day 467 的命令,我实跑用 8469 端口;`SUPPORTPILOT_WEB_ORIGINS` 是 Day 467 的 CORS 白名单,我的前端开在 3469):

```bash
uv run python -m supportpilot.memory.checkpoint
uv run python scripts/seed_db.py
SUPPORTPILOT_WEB_ORIGINS=http://localhost:3469 uv run uvicorn supportpilot.api.app:app --port 8469
```

errors.mts 用的 T000153 要先存在并停在审批,第四步录流时会建出来。录完以后在 `web/` 目录跑:

```bash
SUPPORTPILOT_API=http://localhost:8469 npx tsx scripts/errors.mts T000153
```

真实输出:

```text
追问(停在审批): ApiError 409 工单还在等待审批,审批完成后才能继续对话
审批(漏了 approver): ApiError 422 [{"type":"missing","loc":["body","approver"],"msg":"Field required","input":{"approved":true}}]
跑不存在的工单: ApiError 404 工单不存在
后端没起: TypeError fetch failed
```

前三种是后端说的,带着 Day 467 写的中文提示,409 那句可以原样显示给用户。422 那一串是 pydantic 的校验结果,给开发者看还行,给用户看不行,练习 3 改它。第四种不是 ApiError,是 fetch 自己抛的 `TypeError`,Node 里的消息是 `fetch failed`,Chrome 里是 `Failed to fetch`。这种情况请求根本没到后端,前端只能说一句「连接中断」。

## 第四步:先录一段真流

后面写 reducer、调界面,每次都让真模型跑一遍,一次两三分钱、十秒钟,改十次就是一杯奶茶钱和几分钟的等待。先录一段真流,以后对着录音调。

```ts
// supportpilot/web/scripts/record.mts
// 建一张退款工单,把 /run 的响应原样录成 fixtures/run.sse,顺便看看字节是一块块怎么到的。
// 运行:SUPPORTPILOT_API=http://localhost:8000 npx tsx scripts/record.mts
import { mkdirSync, writeFileSync } from "node:fs";

const API = process.env.SUPPORTPILOT_API ?? "http://localhost:8000";

const { ticket_id } = await fetch(`${API}/tickets`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ customer_email: "lina@example.com", subject: "想退款", body: "上周买的专业版年付,用不上,请帮我退款。" }),
}).then((r) => r.json());

const t0 = Date.now();
const res = await fetch(`${API}/tickets/${ticket_id}/run`, { method: "POST" });
const chunks: Uint8Array[] = [];
for await (const chunk of res.body!) chunks.push(chunk);

const broken = chunks.filter((c) => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(c);
    return false;
  } catch {
    return true; // fatal 模式下遇到不完整的 UTF-8 会抛错:这一块的边上切着半个汉字
  }
}).length;
const all = Buffer.concat(chunks);
mkdirSync("fixtures", { recursive: true });
writeFileSync("fixtures/run.sse", all);
console.log(ticket_id, `${chunks.length} 块, ${all.length} 字节, ${(Date.now() - t0) / 1000} 秒, 切在半个字上的块: ${broken}`);
```

<div class="line-notes">

- `// 运行:SUPPORTPILOT_API=http://localhost:8000 npx tsx scripts/record.mts` 后缀是 `.mts`,告诉 Node「这是 ES 模块」,文件最外层才能直接写 `await`。我第一次写成 `.ts`,tsx 报 `Top-level await is currently not supported with the "cjs" output format`:Next.js 项目的 package.json 没写 `"type": "module"`,`.ts` 文件默认按老的 CommonJS 处理。
- `const { ticket_id } = await fetch(`${API}/tickets`, {` 建工单,李娜那张退款单,和 Day 467 一样。
- `for await (const chunk of res.body!) chunks.push(chunk);` 原样收集每一块字节,不解码。`!` 告诉 TypeScript「body 一定不是 null」。
- `new TextDecoder("utf-8", { fatal: true }).decode(c);` `fatal: true` 让解码器遇到不完整的字节直接抛错,而不是悄悄换成 �。用它来数「有几块的边上切着半个字」。
- `writeFileSync("fixtures/run.sse", all);` 存下来,以后回放、测试都用它。

</div>

```bash
SUPPORTPILOT_API=http://localhost:8469 npx tsx scripts/record.mts
head -6 fixtures/run.sse
```

真实输出:

```text
T000153 77 块, 5673 字节, 9.057 秒, 切在半个字上的块: 0
event: step
data: {"type": "step", "node": "load_customer", "found": true, "profile": true}

event: node
data: {"node": "load_customer"}
```

77 个事件正好 77 块,本机连本机时 uvicorn 每发一个事件就是一个包,一块都没切在半个字上。所以上一节要人为每 7 字节切一刀才能看到乱码。每行用 `\n` 结尾;很多老教程用 sse-starlette,它用 `\r\n`,解析器两种都认。这一次花了 0.02598 元(done 里的 cost_cny)。

## 第五步:一次运行就是一个 reducer

一次运行(第一次跑、一次追问、一次审批恢复)会收到几十到几百个事件。用一堆 `useState` 各管一块很快就乱,这里用 reducer:事件进去,新状态出来,组件只读状态。和 [Day 535](/blog/agent-zero/day-535-durable-1/) 讲的「状态是事件折叠出来的」是同一个想法,Redux 也是。

我把 reducer 单独放在 `run.ts`,不 import React。这样它就是一个普通的 TypeScript 函数,可以在 Node 里直接喂事件、看结果。

```ts
// supportpilot/web/src/lib/run.ts
// 一次运行(第一次跑 / 一次追问 / 一次审批恢复)的界面状态。纯函数,不碰 React,可以直接在 Node 里测。
import type { AgentEvent, RefundRequest, StepEvent, Summary, ToolEvent } from "./events";

export type RunStatus = "idle" | "running" | "waiting_approval" | "done" | "error" | "stopped";

export type RunState = {
  status: RunStatus;
  steps: string[]; // 跑完的节点,按顺序,只由 node 事件追加
  details: Record<string, string>; // step 事件带来的细节,按节点名挂
  tools: ToolEvent[];
  draft: string; // 打字机里正在长的草稿
  rewrites: number; // 质检退回了几次
  approval: { request: RefundRequest; needsFinanceReview: boolean } | null;
  summary: Summary | null;
  error: string | null;
};

export const initial: RunState = {
  status: "idle", steps: [], details: {}, tools: [], draft: "", rewrites: 0,
  approval: null, summary: null, error: null,
};

export type Action = { type: "start" } | { type: "event"; e: AgentEvent } | { type: "fail"; message: string } | { type: "stopped" };

function stepDetail(d: StepEvent): string | undefined {
  switch (d.node) {
    case "load_customer":
      return d.found ? (d.profile ? "找到客户 · 有画像" : "找到客户") : "没找到这个邮箱对应的客户";
    case "prepare_context":
      return d.summarized_upto > 0 ? `前 ${d.summarized_upto} 条已压成摘要` : undefined;
    case "classify":
      return `分类:${d.category}`;
    case "retrieve": {
      const docs = [...new Set(d.docs)]; // 后端按切块推,同一篇文章的几块会重复
      return `命中 ${docs.length} 篇:${docs.join("、")}`;
    }
    case "check":
      return d.passed ? "通过" : `退回:${d.problems.join(";")}`;
  }
}

export function reducer(s: RunState, a: Action): RunState {
  switch (a.type) {
    case "start":
      return { ...initial, status: "running" };
    case "fail":
      return { ...s, status: "error", error: a.message };
    case "stopped":
      return s.status === "running" ? { ...s, status: "stopped" } : s;
    case "event": {
      const e = a.e;
      switch (e.event) {
        case "node":
          return { ...s, steps: [...s.steps, e.data.node] };
        case "step": {
          const detail = stepDetail(e.data);
          const next = detail ? { ...s, details: { ...s.details, [e.data.node]: detail } } : s;
          // 质检没过,draft 节点会从头重写:旧草稿清掉,不然两版文字接在一起
          if (e.data.node === "check" && !e.data.passed) return { ...next, draft: "", rewrites: s.rewrites + 1 };
          return next;
        }
        case "tool":
          return { ...s, tools: [...s.tools, e.data] };
        case "token":
          return { ...s, draft: s.draft + e.data.text };
        case "interrupt":
          return { ...s, approval: { request: e.data.request, needsFinanceReview: e.data.needs_finance_review } };
        case "error":
          return { ...s, status: "error", error: e.data.message };
        case "done":
          return { ...s, summary: e.data, status: e.data.outcome === "waiting_approval" ? "waiting_approval" : "done" };
      }
    }
  }
}
```

<div class="line-notes">

- `export type RunStatus = "idle" | "running" | "waiting_approval" | "done" | "error" | "stopped";` 六个状态,对应下面那张状态图。stopped 是用户自己点了停止,和 error 分开,界面上说的话不一样。
- `steps: string[]; // 跑完的节点,按顺序,只由 node 事件追加` 一个节点可能出现多次:质检退回时 draft 和 check 会再来一遍。
- `details: Record<string, string>;` 按节点名挂的一句话细节。同一个节点第二次推 step 会覆盖第一次。
- `approval: { request: RefundRequest; needsFinanceReview: boolean } | null;` 停在审批时才有。
- `export const initial: RunState = {` 初始状态。每次 start 都从它复制一份。
- `export type Action = { type: "start" } | { type: "event"; e: AgentEvent }` reducer 收的动作有四种:开始、来了一个事件、流没开起来或断了、用户停止。事件只是其中一种,被包在 `{ type: "event", e }` 里。
- `function stepDetail(d: StepEvent): string | undefined {` 把 step 事件翻成一句给人看的话。`switch (d.node)` 之后,每个 case 里 TypeScript 知道 `d` 是哪一支,`d.found`、`d.category` 都不用额外判断。这就是第二步不加兜底分支换来的。
- `return d.found ? (d.profile ? "找到客户 · 有画像" : "找到客户") : "没找到这个邮箱对应的客户";` 实测李娜这张是「找到客户 · 有画像」。
- `return d.summarized_upto > 0 ? `前 ${d.summarized_upto} 条已压成摘要` : undefined;` 没压缩时返回 undefined,不占一行细节。
- `const docs = [...new Set(d.docs)];` Set 去重,再展开回数组,保持第一次出现的顺序。实测 5 个切块去重后剩 3 篇。
- `case "start":` 新的一次运行,状态从头来,`status` 设成 running。
- `return s.status === "running" ? { ...s, status: "stopped" } : s;` 已经结束的运行再收到 stopped 不改状态,返回**原来那个对象**。React 用 `Object.is` 比较新旧状态,同一个对象就不重新渲染。
- `case "node":` 节点跑完。`steps` 只在这里追加。
- `const next = detail ? { ...s, details: { ...s.details, [e.data.node]: detail } } : s;` `[e.data.node]` 是计算属性名,用变量的值当键。没有细节就不动。
- `if (e.data.node === "check" && !e.data.passed) return { ...next, draft: "", rewrites: s.rewrites + 1 };` 质检退回:草稿清空、计数加一。注意基于 `next`,退回原因也挂上了。
- `return { ...s, draft: s.draft + e.data.text };` 打字机就是不停地拼字符串。
- `return { ...s, approval: { request: e.data.request, needsFinanceReview: e.data.needs_finance_review } };` 顺手把后端的下划线命名转成驼峰,前端代码里统一用驼峰。
- `return { ...s, status: "error", error: e.data.message };` 后端推的 error,message 是那句固定的话。
- `return { ...s, summary: e.data, status: e.data.outcome === "waiting_approval" ? "waiting_approval" : "done" };` 只有 outcome 是 waiting_approval 才进等审批状态。Day 468 修之前,第二轮停在审批时这里会走成 done。

</div>

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="一次运行的状态机:idle 经 start 到 running;running 收到 done 后按 outcome 到 waiting_approval 或 done;收到 error 或 fail 到 error;abort 到 stopped;waiting_approval 在审批后通过刷新进展变成 done">
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="90" width="80" height="36" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="60" y="113" text-anchor="middle" fill="var(--ink)">idle</text>
<rect x="160" y="90" width="100" height="36" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="210" y="113" text-anchor="middle" fill="var(--ink)">running</text>
<rect x="340" y="20" width="150" height="36" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="415" y="43" text-anchor="middle" fill="var(--ink)">waiting_approval</text>
<rect x="340" y="90" width="150" height="36" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="415" y="113" text-anchor="middle" fill="var(--ink)">done</text>
<rect x="340" y="160" width="70" height="36" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="375" y="183" text-anchor="middle" fill="var(--ink)">error</text>
<rect x="420" y="160" width="70" height="36" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="455" y="183" text-anchor="middle" fill="var(--ink)">stopped</text>
</g>
<g stroke="var(--ink-faint)" fill="none" stroke-width="1.2">
<line x1="100" y1="108" x2="158" y2="108"/><line x1="260" y1="100" x2="338" y2="40"/><line x1="260" y1="108" x2="338" y2="108"/><line x1="260" y1="116" x2="338" y2="176"/><line x1="260" y1="120" x2="440" y2="160"/>
<path d="M 490 38 C 560 38, 560 108, 492 108" stroke="var(--compute)" stroke-dasharray="4 3"/>
</g>
<g font-family="var(--font-mono)" font-size="10.5" fill="var(--ink-soft)">
<text x="129" y="100" text-anchor="middle">start</text>
<text x="272" y="58">done(waiting)</text>
<text x="284" y="102">done</text>
<text x="262" y="165">error/fail</text>
<text x="400" y="150">abort</text>
<text x="566" y="70" fill="var(--compute)">客服审批后</text>
<text x="566" y="84" fill="var(--compute)">刷新进展</text>
</g>
</svg>
<figcaption>一次运行的状态。客户页面停在 waiting_approval 时,审批发生在客服的页面里;客户这边刷新进展,用 GET /tickets/{id} 拿到一份和 done 一样形状的摘要,塞进同一个 reducer(练习 2)。</figcaption>
</figure>

reducer 里有两处是想清楚了才这么写的。

**step 和 node,谁说了算。** 后端的 step 是节点**执行中**推的(分诊结果、检索到哪几篇),node 是节点**跑完后**才推的。看录下来的流:每个节点都是先 step 后 node。如果两种事件各往步骤列表里插一行,页面上会出现「分诊 · 分类:refund」紧跟着又一个「分诊」。所以 steps 只由 node 追加,step 带来的细节放进 details,渲染时按节点名对上。同一件事从两个通道到达,在事件驱动的界面里很常见,先想清楚哪个事件是这件事的权威来源。练习 1 会故意写错一次。

**质检退回时清空草稿。** check 不通过,draft 节点会从头重写,新的 token 从第一个字推起。不清空的话,第二版接在第一版后面,用户看到两段互相矛盾的话。顺手记一个 `rewrites`,界面上可以提示「质检退回 1 次,正在重写」,用户就知道刚才那段话为什么没了。

### 故意犯错:把 reducer 直接交给 Array.reduce

reducer 这个名字来自数组的 `reduce`。我第一次写检查脚本时,很自然地写成了 `events.reduce(reducer, 初始状态)`:

```ts
const s = events.reduce(reducer, reducer(initial, { type: "start" }));
```

tsx 不做类型检查,直接跑,报错是:

```text
TypeError: Cannot read properties of undefined (reading 'steps')
```

reducer 收的是 Action,不是事件。`reduce` 把每个事件当成 action 传进去,`a.type` 是 undefined,外层 switch 一个 case 都不进,函数什么都没返回,第一步之后状态就成了 undefined。`npx tsc --noEmit -p .` 会在这一行报 `TS2769: No overload matches this call`,后面说 `Type 'AgentEvent' is not assignable to type 'Action'`。教训有两个:事件要包成 `{ type: "event", e }`;tsx 只管跑不管类型,写完 scripts 也要跑一次 `tsc`。

### 用录好的流检查 reducer

正确的检查脚本,不起任何服务,用 eventsource-parser 的非流式接口把录音解析成事件,一个个喂给 reducer:

```ts
// supportpilot/web/scripts/check_reducer.mts
// 不起任何服务:把录好的 fixtures/run.sse 解析成事件,一个个喂给 reducer,断言最后的状态。
// 运行:npx tsx scripts/check_reducer.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createParser } from "eventsource-parser";
import type { AgentEvent } from "../src/lib/events.ts";
import { initial, reducer } from "../src/lib/run.ts";

const events: AgentEvent[] = [];
const parser = createParser({
  onEvent: (m) => events.push({ event: m.event, data: JSON.parse(m.data) } as AgentEvent),
});
parser.feed(readFileSync("fixtures/run.sse", "utf8"));

const s = events.reduce((st, e) => reducer(st, { type: "event", e }), reducer(initial, { type: "start" }));
assert.equal(events.length, 77);
assert.deepEqual(s.steps, ["load_customer", "prepare_context", "classify", "retrieve", "act", "draft", "check"]);
assert.equal(s.status, "waiting_approval");
assert.equal(s.tools.at(-1)?.name, "create_refund_request");
assert.equal(s.approval?.request.amount_cny, 950);
assert.equal(s.draft, events.filter((e) => e.event === "token").map((e) => e.data.text).join(""));

const again = reducer(s, { type: "stopped" });
assert.ok(again === s, "已经结束的运行再收到 stopped,应该原样返回同一个对象");
console.log("ok", events.length, "个事件,", s.draft.length, "字草稿,花费", s.summary?.cost_cny);
```

<div class="line-notes">

- `import assert from "node:assert/strict";` Node 自带的断言库,strict 版本里 `equal` 用 `===` 比较。正式的前端测试 Day 472 再上 Playwright,今天这样够用。
- `import { createParser } from "eventsource-parser";` 同一个库的非流式接口:`feed` 一段文本,每解析出一个事件就调一次 `onEvent`。
- `onEvent: (m) => events.push({ event: m.event, data: JSON.parse(m.data) } as AgentEvent),` 和 streamEvents 里 yield 的是同一个形状。
- `parser.feed(readFileSync("fixtures/run.sse", "utf8"));` 一次把整个文件喂进去。
- `const s = events.reduce((st, e) => reducer(st, { type: "event", e }), reducer(initial, { type: "start" }));` 正确的写法:每个事件包成 action。初始值是 start 之后的状态。
- `assert.equal(events.length, 77);` 和录的时候 77 块对上。
- `assert.deepEqual(s.steps, ["load_customer"` 7 个节点各出现一次,approval 停住了不在里面。step 也有 5 个,但没有混进 steps。
- `assert.equal(s.tools.at(-1)?.name, "create_refund_request");` `.at(-1)` 取最后一个,相当于 Python 的 `[-1]`。
- `assert.equal(s.approval?.request.amount_cny, 950);` interrupt 带来的申请,950 元。
- `assert.equal(s.draft, events.filter((e) => e.event === "token").map((e) => e.data.text).join(""));` 草稿等于所有 token 按顺序拼起来。这一次质检一遍过,没被清空过。
- `assert.ok(again === s,` 对结束的运行发 stopped,拿回来的是同一个对象。

</div>

```bash
npx tsx scripts/check_reducer.mts
npx tsc --noEmit -p .
```

真实输出:`ok 77 个事件, 107 字草稿,花费 0.02598`,tsc 没有输出,表示 0 报错。

## 第六步:真后端跑一次,看状态怎么长

录音只有一种情况:质检一遍过、停在审批。真模型每次都可能不一样。写一个小脚本,用 `streamEvents` 读真流,每个事件喂进 reducer,在关键时刻打一行:

```ts
// supportpilot/web/scripts/peek.mts
// 用 streamEvents 读一次 /run,每个事件喂进 reducer,在几个关键时刻打印状态。
// 运行:SUPPORTPILOT_API=http://localhost:8470 npx tsx scripts/peek.mts T000153
import { initial, reducer, type RunState } from "../src/lib/run.ts";
import { streamEvents } from "../src/lib/sse.ts";

const API = process.env.SUPPORTPILOT_API ?? "http://localhost:8000";
const id = process.argv[2] ?? "T000153";

let s: RunState = reducer(initial, { type: "start" });
const counts: Record<string, number> = {};
const t0 = Date.now();
for await (const e of streamEvents(`${API}/tickets/${id}/run`)) {
  counts[e.event] = (counts[e.event] ?? 0) + 1;
  const before = s;
  s = reducer(s, { type: "event", e });
  if (e.event === "token" && counts.token > 1) continue; // token 只打第一个,不然刷屏
  const ms = String(Date.now() - t0).padStart(5);
  console.log(`${ms}ms ${e.event.padEnd(9)} steps=${s.steps.length} tools=${s.tools.length} draft=${s.draft.length}字`
    + (s.details !== before.details ? ` +detail ${JSON.stringify(s.details)}`.slice(0, 90) : ""));
}
console.log("事件数", counts);
console.log("最后", { status: s.status, steps: s.steps, rewrites: s.rewrites, approval: s.approval?.request.id, cost: s.summary?.cost_cny });
console.log("工具", s.tools.map((t) => t.name));
console.log("细节", s.details);
```

<div class="line-notes">

- `import { initial, reducer, type RunState } from "../src/lib/run.ts";` `type RunState` 写在花括号里,表示这个名字只当类型用,编译后会被删掉。
- `let s: RunState = reducer(initial, { type: "start" });` 和页面里一样,先 start。
- `counts[e.event] = (counts[e.event] ?? 0) + 1;` 数每种事件来了几个。
- `const before = s;` 记下旧状态,下面用 `!==` 判断 details 有没有变。reducer 不改旧对象、只返回新对象,所以引用比较就够了。
- `if (e.event === "token" && counts.token > 1) continue;` token 有两三百个,只打第一个。
- `String(Date.now() - t0).padStart(5)` 毫秒数左边补空格到 5 位,对齐好看。
- `+ (s.details !== before.details ?` details 变了才打印,截到 90 个字符。

</div>

先建一张新工单,再读它的流(在 `web/` 目录,另一个终端里后端开着):

```bash
curl -s -X POST localhost:8469/tickets -H 'content-type: application/json' \
  -d '{"customer_email":"lina@example.com","subject":"想退款","body":"上周买的专业版年付,用不上,请帮我退款。"}'
SUPPORTPILOT_API=http://localhost:8469 npx tsx scripts/peek.mts T000156
```

我连着跑了三张(T000154、155、156),每张结果都不一样。下面是 T000156 的真实输出(最后的「细节」里 check 那一条有四句话,很长,我只留了第一句):

```text
 1100ms step      steps=0 tools=0 draft=0字 +detail {"load_customer":"找到客户 · 有画像"}
 1100ms node      steps=1 tools=0 draft=0字
 1102ms step      steps=1 tools=0 draft=0字
 1103ms node      steps=2 tools=0 draft=0字
 1737ms step      steps=2 tools=0 draft=0字 +detail {"load_customer":"找到客户 · 有画像","classify":"分类:refund"}
 1739ms node      steps=3 tools=0 draft=0字
 1956ms step      steps=3 tools=0 draft=0字 +detail {"load_customer":"找到客户 · 有画像","classify":"分类:refund","retrieve":"命中 3 篇:KB-refund
 1958ms node      steps=4 tools=0 draft=0字
 3286ms tool      steps=4 tools=1 draft=0字
 3291ms tool      steps=4 tools=2 draft=0字
 4176ms tool      steps=4 tools=3 draft=0字
 5814ms node      steps=5 tools=3 draft=0字
 6524ms token     steps=5 tools=3 draft=2字
 7210ms node      steps=6 tools=3 draft=203字
 8655ms step      steps=6 tools=3 draft=0字 +detail {"load_customer":"找到客户 · 有画像","classify":"分类:refund","retrieve":"命中 3 篇:KB-refund
 8656ms node      steps=7 tools=3 draft=0字
 9745ms node      steps=8 tools=3 draft=170字
11852ms step      steps=8 tools=3 draft=0字 +detail {"load_customer":"找到客户 · 有画像","classify":"分类:refund","retrieve":"命中 3 篇:KB-refund
11854ms node      steps=9 tools=3 draft=0字
11859ms node      steps=10 tools=3 draft=0字
11865ms done      steps=10 tools=3 draft=0字
事件数 { step: 6, node: 10, tool: 3, token: 230, done: 1 }
最后 {
  status: 'done',
  steps: [
    'load_customer',
    'prepare_context',
    'classify',
    'retrieve',
    'act',
    'draft',
    'check',
    'draft',
    'check',
    'handoff'
  ],
  rewrites: 2,
  approval: undefined,
  cost: 0.02973
}
工具 [ 'list_subscriptions', 'list_invoices', 'check_refund_eligibility' ]
细节 {
  load_customer: '找到客户 · 有画像',
  classify: '分类:refund',
  retrieve: '命中 3 篇:KB-refund-001、KB-refund-003、KB-plans-002',
  check: '退回:草稿称“退款申请已提交，审核通过后会原路退回”，但调查结论显示该客户已有退款申请 RF-T000153-INV-202609-0002 处于 pending 状态，本次因 already_requested 未创建新申请……'
}
```

这一段值得慢慢看。

**为什么没有建退款申请。** 工具只调了三个,没有 create_refund_request。check_refund_eligibility 返回的是 already_requested:第四步录流的 T000153 已经给同一张发票建了一条待审批的申请。业务规则是对的,同一张发票不能重复申请。

**草稿被清空了两次。** 7210ms 第一版草稿 203 字写完(draft 节点的 node 事件);8655ms 质检退回,draft 变成 0 字;9745ms 第二版 170 字写完;11852ms 又被退回,又是 0。第二次退回后超过了 Day 462 的 `max_revisions`,路由去了 handoff。如果 reducer 不清空,页面上会是 203 + 170 = 373 个字两段话接在一起。

**最后草稿是 0 字,status 是 done。** 转人工的回复是 handoff 节点直接写的一句固定的话,不经过模型,也就没有 token。最终回复在 `summary.reply` 里,不在 draft 里。所以 Day 470 渲染回复时要先看 summary,再看 draft。

**details 里的 check 只剩最后一次。** 第一次退回的原因被第二次覆盖了,只有 `rewrites: 2` 记着退回过两次。给客服看的界面,两次的原因都应该留着,练习 4 改。

**时间都花在哪。** 第一个事件在 1100ms 才来:load_customer 里有画像那一步(Day 466),这次历史工单数变了,重写了一次画像。分诊 0.6 秒,act 里三次工具调用大约 4 秒,两版草稿各一秒多,两次质检各一两秒。一共 11.9 秒,0.02973 元。一张工单十秒以上,中间没有任何反馈的话用户早就关页面了,这就是要流式推过程的原因。

三张合计花了 0.02686 + 0.02897 + 0.02973 = 0.0856 元,加上录流那一次 0.02598,今天真模型一共 0.1115 元。

## 第七步:接到 React 上,用回放联调

reducer 接到 React 上就是 `useReducer`,再加一个 AbortController 用来停止:

```ts
// supportpilot/web/src/lib/useRun.ts
// 把 reducer 接到 React 上:开一个流,每来一个事件 dispatch 一次;能停止;能塞一个不是从流里来的事件。
"use client";
import { useCallback, useReducer, useRef } from "react";
import type { AgentEvent } from "./events";
import { initial, reducer } from "./run";
import { ApiError } from "./sse";

export function useRun() {
  const [state, dispatch] = useReducer(reducer, initial);
  const ctrl = useRef<AbortController | null>(null);

  const start = useCallback(async (open: (signal: AbortSignal) => AsyncGenerator<AgentEvent>) => {
    ctrl.current?.abort(); // 上一次还没结束就开新的:先断掉旧的,免得两个流的事件交替进来
    const c = new AbortController();
    ctrl.current = c;
    dispatch({ type: "start" });
    try {
      for await (const e of open(c.signal)) dispatch({ type: "event", e });
    } catch (err) {
      if (c.signal.aborted) dispatch({ type: "stopped" });
      else dispatch({ type: "fail", message: err instanceof ApiError ? err.message : "连接中断,请稍后重试" });
    }
  }, []);

  const stop = useCallback(() => ctrl.current?.abort(), []);
  const apply = useCallback((e: AgentEvent) => dispatch({ type: "event", e }), []);

  return { state, start, stop, apply };
}
```

<div class="line-notes">

- `"use client";` Next.js App Router 里的模块默认在服务端渲染,用到 hook 的要声明成客户端模块。
- `const [state, dispatch] = useReducer(reducer, initial);` 就是 run.ts 那个纯函数,React 只负责存状态、触发渲染。
- `const ctrl = useRef<AbortController | null>(null);` 用 useRef 存控制器:改它不触发渲染,又能在多次渲染之间保留。
- `const start = useCallback(async (open: (signal: AbortSignal) => AsyncGenerator<AgentEvent>) => {` 传进来的是「怎么打开流」的函数,不是流本身。这样 start 能先建好 AbortController,再把 signal 交给它。调用方写 `start((signal) => runTicket(id, signal))`。
- `ctrl.current?.abort();` 客户连点两次发送,或者上一次还没结束就追问,旧的流先断掉,否则两个流的事件会交替进同一个 reducer。
- `for await (const e of open(c.signal)) dispatch({ type: "event", e });` 每来一个事件 dispatch 一次。`{ type: "event", e }` 是 `{ type: "event", e: e }` 的简写。
- `if (c.signal.aborted) dispatch({ type: "stopped" });` abort 以后 fetch 和正在等的 `read()` 会抛 AbortError,走到这里。是用户自己停的,不算出错。
- `else dispatch({ type: "fail", message: err instanceof ApiError ? err.message : "连接中断,请稍后重试" });` 后端说的错(409 那句)原样显示;网络错误用兜底文案。
- `const apply = useCallback((e: AgentEvent) => dispatch({ type: "event", e }), []);` 塞一个不是从流里来的事件。客户页面刷新进展时,把 GET 拿到的摘要当成 done 塞进来(练习 2)。

</div>

React 会把短时间内连续的状态更新合并成一次渲染,一个网络包里来十几个 token,通常只渲染一次,所以这里没有自己做节流。如果模型吐字特别快、回复特别长,页面开始掉帧,再考虑把 token 攒到 `requestAnimationFrame` 里批量提交。

接下来要在浏览器里看它跑起来。不想每次都花钱,就把第四步的录音回放出来。回放服务器 30 行,用 Node 自带的 http 模块:

```ts
// supportpilot/web/scripts/replay.mts
// 回放服务器:任何 POST 都把 fixtures/run.sse 里录好的事件一条条再发一遍,每条隔 30 毫秒。不调模型,不花钱。
// 运行:npx tsx scripts/replay.mts   (监听 8470)
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const events = readFileSync("fixtures/run.sse", "utf8").split("\n\n").filter(Boolean);
const CORS = { "access-control-allow-origin": process.env.WEB_ORIGIN ?? "http://localhost:3000", "access-control-allow-headers": "content-type, accept" };

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return res.writeHead(204, CORS).end(); // 浏览器的预检
  res.writeHead(200, { ...CORS, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
  for (const ev of events) {
    if (res.destroyed) return; // 客户端断开了就别再写
    res.write(ev + "\n\n");
    await new Promise((r) => setTimeout(r, 30));
  }
  res.end();
}).listen(8470, () => console.log(`replaying ${events.length} events on :8470`));
```

<div class="line-notes">

- `const events = readFileSync("fixtures/run.sse", "utf8").split("\n\n").filter(Boolean);` 按空行切成 77 段,`filter(Boolean)` 去掉最后那个空串。
- `const CORS = { "access-control-allow-origin": process.env.WEB_ORIGIN ?? "http://localhost:3000",` 和 Day 467 的 CORSMiddleware 做同一件事,只是手写。前端开在哪个端口,就填哪个。
- `if (req.method === "OPTIONS") return res.writeHead(204, CORS).end();` 跨源的 POST 带 JSON 请求头,浏览器会先发一个 OPTIONS 问「允不允许」,回 204 加 CORS 头就行。
- `res.writeHead(200, { ...CORS, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });` 和 FastAPI 自动设的两个响应头一样。
- `if (res.destroyed) return;` 浏览器点了停止或者关了页面,连接就断了,别再往里写。
- `await new Promise((r) => setTimeout(r, 30));` 每条隔 30 毫秒,77 条大约 2.3 秒,比真模型快,但能看到状态一点点长。
- `}).listen(8470,` 这个服务器不管路径,任何工单号都回放同一段录音,也不管请求体。它只够今天联调用,[Day 471](/blog/agent-zero/day-471-ui-robust/) 会写一个像样的假后端。

</div>

调试页就是一个按钮加一个 `<pre>`,把状态原样打出来。先把脚手架的 `layout.tsx` 换成不拉 Google 字体的版本,`globals.css` 清成几行:

```tsx
// supportpilot/web/src/app/layout.tsx  Day 469 的临时版:去掉脚手架的 Google 字体,Day 470 再加导航
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "SupportPilot", description: "CloudLedger 智能客服演示" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
```

<div class="line-notes">

- `export default function RootLayout({ children }: LayoutProps<"/">) {` `LayoutProps` 是 Next.js 16 根据路由自动生成的全局类型,不用 import。
- `<html lang="zh-CN">` 读屏软件按中文读。

</div>

```css
/* supportpilot/web/src/app/globals.css  Day 469 只放几行,Day 470 换成正式样式 */
body { margin: 0; padding: 1.5rem; font: 15px/1.6 system-ui, "PingFang SC", sans-serif; }
pre { font-size: 12px; background: #f4f4f4; padding: .8rem; white-space: pre-wrap; }
```

```tsx
// supportpilot/web/src/app/page.tsx  Day 469 的调试页:点一下开一个流,把 reducer 的状态原样打出来
"use client";
import { useState } from "react";
import { runTicket } from "@/lib/api";
import { useRun } from "@/lib/useRun";

export default function DebugPage() {
  const [id, setId] = useState("T000153");
  const { state, start, stop } = useRun();
  const { draft, ...rest } = state;

  return (
    <main>
      <h1>useRun 调试页</h1>
      <input value={id} onChange={(e) => setId(e.target.value)} aria-label="工单号" />
      <button onClick={() => start((signal) => runTicket(id, signal))}>跑一次</button>
      <button onClick={stop} disabled={state.status !== "running"}>停止</button>
      <p data-testid="status">status: {state.status}</p>
      <p data-testid="draft">draft({draft.length} 字): {draft}</p>
      <pre>{JSON.stringify(rest, null, 2)}</pre>
    </main>
  );
}
```

<div class="line-notes">

- `const { draft, ...rest } = state;` 草稿单独拿出来显示成一段话,其余字段原样打成 JSON。
- `<button onClick={() => start((signal) => runTicket(id, signal))}>跑一次</button>` start 不用 await,流在后台跑,点击处理函数立刻返回。
- `<p data-testid="status">` `data-testid` 是给自动化测试找元素用的,Day 472 写 Playwright 时会用上。

</div>

三个终端:回放服务器、前端开发服务器、浏览器。

```bash
# 终端 1,在 web/ 目录
WEB_ORIGIN=http://localhost:3469 npx tsx scripts/replay.mts
# 终端 2,在 web/ 目录
NEXT_PUBLIC_SUPPORTPILOT_API=http://localhost:8470 npx next dev -p 3469
```

打开 `http://localhost:3469`,点「跑一次」。我用无头浏览器读页面上的文字记了两个时刻(真实值):第 0.5 秒 `status: running`,草稿 10 个字「您好,您的Pro年付」;第 2.3 秒 `status: waiting_approval`,草稿 107 个字。下面的 JSON 里 steps 是 7 个节点,details 四条(load_customer、classify、retrieve、check),tools 四个,approval 里是 RF-T000153-INV-202609-0002,summary 里 cost_cny 是 0.02598、reply 是 null。

JSON 里有一个值得注意的地方。approval.request 里除了金额、规则,还有一个 `note` 字段,内容是「已创建待审批的退款申请。不要告诉客户退款已完成,只能说已提交审核。」这是 Day 452 业务函数写给模型看的提示,跟着 interrupt 一起推到了浏览器。调试页什么都显示,正式的客户页面不能把它显示出来。Day 470 的组件只取需要的字段,Day 472 会讲「谁该看到什么」。

### 故意犯错:CORS 填错了端口

回放服务器不设 `WEB_ORIGIN` 直接起(默认放行 3000),页面开在 3469,再点「跑一次」。页面上 status 变成 error,error 是「连接中断,请稍后重试」。浏览器控制台里是真正的原因(真实输出):

```text
Access to fetch at 'http://localhost:8470/tickets/T000153/run' from origin 'http://localhost:3469' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: The 'Access-Control-Allow-Origin' header has a value 'http://localhost:3000' that is not equal to the supplied origin.
```

CORS 被拦时,JavaScript 拿到的只是一个 `TypeError: Failed to fetch`,看不到状态码、看不到原因,所以 `useRun` 只能走兜底文案。浏览器故意这么设计,不让网页借用户的浏览器探测别的网站。排查 CORS 问题,第一件事就是开 DevTools 的 Console 和 Network 看预检请求。连真后端时也一样:Day 467 的 `SUPPORTPILOT_WEB_ORIGINS` 要包含前端的地址。

## 零件和大代码的对照

| 零件 | 文件 | 作用 |
| --- | --- | --- |
| `AgentEvent`、`StepEvent`、`Summary` | `src/lib/events.ts` | 后端七种事件的类型 |
| `streamEvents`、`ApiError` | `src/lib/sse.ts` | fetch → 解码 → 切事件;流没开起来时抛带提示的错 |
| 六个接口函数 | `src/lib/api.ts` | 类型化封装 |
| `reducer`、`initial`、`RunState` | `src/lib/run.ts` | 事件折叠成界面状态,纯函数 |
| `useRun` | `src/lib/useRun.ts` | 接到 React 上,能停止、能塞事件 |
| `record.mts`、`fixtures/run.sse` | `scripts/`、`fixtures/` | 录一段真流 |
| `split_decode.mts`、`errors.mts` | `scripts/` | 乱码实验、流没开起来的四种情况 |
| `check_reducer.mts`、`peek.mts` | `scripts/` | 不起服务检查 reducer;看真流里状态怎么长 |
| `replay.mts`、调试页 | `scripts/`、`src/app/page.tsx` | 不花钱在浏览器里联调 |

## 动手练习

### 练习 1:step 也往 steps 里追加

把 reducer 的 step 分支改成「也往 steps 里追加节点名」,跑 `check_reducer.mts`,看会发生什么。然后说出页面上会是什么样子。

<details><summary>参考答案</summary>

把 step 分支里那一行改成:

```ts
          const next = { ...s, steps: [...s.steps, e.data.node], details: detail ? { ...s.details, [e.data.node]: detail } : s.details };
```

<div class="line-notes">

- `steps: [...s.steps, e.data.node], details: detail ?` 错误的改动:step 也往 steps 里追加;细节照旧挂。

</div>

```bash
npx tsx scripts/check_reducer.mts
```

真实输出(节选):

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

  [
    'load_customer',
+   'load_customer',
    'prepare_context',
+   'prepare_context',
    'classify',
+   'classify',
    'retrieve',
+   'retrieve',
    'act',
    'draft',
    'check',
+   'check'
  ]
```

推了 step 的五个节点各多出一次,act 和 draft 没推 step,所以只有一次。页面上会是「✓ 查客户档案 · 找到客户」后面紧跟一个「✓ 查客户档案」,而且第一个勾打得太早:step 是节点执行中推的,那时节点还没跑完。改回来,`ok 77 个事件`。

</details>

### 练习 2:把 GET 的摘要当成 done 塞进 reducer

客户页面停在 waiting_approval 时,审批发生在客服那边。客户点「刷新进展」,前端调 `GET /tickets/{id}`。写一个脚本,对 T000153(等审批)、T000156(转人工)、T000155(已解决)各调一次 `getTicket`,把结果当成 done 事件喂给 reducer,打印 status。

<details><summary>参考答案</summary>

```ts
// supportpilot/web/scripts/apply_get.mts
// 练习 2:GET /tickets/{id} 返回的就是 done 的 data,当成一个 done 事件塞进 reducer。不调模型。
// 运行:NEXT_PUBLIC_SUPPORTPILOT_API=http://localhost:8000 npx tsx scripts/apply_get.mts T000153 T000156
import { getTicket } from "../src/lib/api.ts";
import { initial, reducer } from "../src/lib/run.ts";

for (const id of process.argv.slice(2)) {
  const summary = await getTicket(id);
  const s = reducer(initial, { type: "event", e: { event: "done", data: summary } });
  console.log(id, s.status, summary.outcome, summary.waiting_on, summary.reply ? summary.reply.slice(0, 24) : summary.reply);
}
```

<div class="line-notes">

- `// 运行:NEXT_PUBLIC_SUPPORTPILOT_API=http://localhost:8000` api.ts 读的是这个变量名,在 Node 里也照读。
- `for (const id of process.argv.slice(2)) {` 命令行上给几个工单号就查几个。
- `const s = reducer(initial, { type: "event", e: { event: "done", data: summary } });` 后端的 `_summary()` 同时生成 done 的 data 和 GET 的返回,形状一样,所以不用写第二套更新逻辑。前后端共用一种数据形状,能省掉很多胶水代码。
- `summary.reply ? summary.reply.slice(0, 24) : summary.reply` 有回复就截 24 个字,null 原样打。

</div>

```bash
NEXT_PUBLIC_SUPPORTPILOT_API=http://localhost:8469 npx tsx scripts/apply_get.mts T000153 T000156 T000155
```

真实输出:

```text
T000153 waiting_approval waiting_approval [ 'approval' ] null
T000156 done escalated [] 您好,您的问题已经转给人工客服同事,会在 1 个
T000155 done resolved [] 您好，您的账单（INV-202609-0002，
```

转人工和已解决在 reducer 里都是 done,区别在 `summary.outcome`。Day 470 显示状态时要看 outcome,不能只看 status。T000153 还没审批,reply 是 null。

</details>

### 练习 3:让 422 的提示能给人看

`streamEvents` 遇到 422 时,message 是一整串 JSON。写一个 `detailText(detail)`:字符串原样返回;数组就把每一项拼成「字段名: 原因」,用分号连接;其他情况转 JSON。`sse.ts` 和 `api.ts` 两处都改成用它。

<details><summary>参考答案</summary>

在 `sse.ts` 里 `streamEvents` 上面加:

```ts
// supportpilot/web/src/lib/sse.ts(新增,写在 streamEvents 上面)
// 练习 3:422 的 detail 是数组 [{loc: ["body", "approver"], msg: "Field required"}, ...],拼成一句人能读的话
export function detailText(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((d) => `${d.loc?.at(-1) ?? "?"}: ${d.msg}`).join(";");
  return JSON.stringify(detail);
}
```

<div class="line-notes">

- `export function detailText(detail: unknown): string {` 参数用 `unknown`:后端给什么都可能,先判断再用。
- `if (typeof detail === "string") return detail;` 404、409 走这里。
- `if (Array.isArray(detail)) return detail.map((d) => `${d.loc?.at(-1) ?? "?"}: ${d.msg}`).join(";");` `Array.isArray` 之后 TypeScript 把 detail 当成 `any[]`,所以 `d.loc` 不报错。`loc` 是 `["body", "approver"]`,最后一项才是字段名。
- `return JSON.stringify(detail);` 兜底,至少不丢信息。

</div>

然后把 `streamEvents` 和 `api.ts` 的 `json` 里 `throw new ApiError(...)` 那一行都改成 `throw new ApiError(res.status, detailText(detail));`,`api.ts` 的导入加上 `detailText`。再跑 errors.mts:

```text
追问(停在审批): ApiError 409 工单还在等待审批,审批完成后才能继续对话
审批(漏了 approver): ApiError 422 approver: Field required
跑不存在的工单: ApiError 404 工单不存在
后端没起: TypeError fetch failed
```

字段名还是英文的 approver,给开发者看够了。正式页面上审批人是写死或从登录信息来的,用户不会碰到这个 422。Day 470 以加了 `detailText` 的版本为准。

</details>

### 练习 4:两次退回的原因都留住

第六步那张工单退回了两次,details 里只剩第二次的原因。给 `RunState` 加一个 `rejections: string[][]`,每次质检退回把 problems 追加进去。用一段手写的事件检查它。

<details><summary>参考答案</summary>

run.ts 改三处:类型里 `rewrites` 下面加一行 `rejections: string[][];`,`initial` 里加 `rejections: []`,step 分支里退回的那一行改成:

```ts
// supportpilot/web/src/lib/run.ts(step 分支里质检退回那一行,改成三行)
          if (e.data.node === "check" && !e.data.passed) {
            return { ...next, draft: "", rewrites: s.rewrites + 1, rejections: [...s.rejections, e.data.problems] };
          }
```

<div class="line-notes">

- `rejections: [...s.rejections, e.data.problems] };` 追加一项,不改原数组。每一项本身是一个字符串数组,一次退回可能有好几条问题。

</div>

```ts
// supportpilot/web/scripts/check_rejections.mts
// 练习 4:手写一段「质检退回两次再转人工」的事件,检查 rejections 两次都留住了。不起服务。
import assert from "node:assert/strict";
import type { AgentEvent } from "../src/lib/events.ts";
import { initial, reducer } from "../src/lib/run.ts";

const check = (passed: boolean, problems: string[]): AgentEvent =>
  ({ event: "step", data: { type: "step", node: "check", passed, problems } });
const token = (text: string): AgentEvent => ({ event: "token", data: { type: "token", text } });

const events: AgentEvent[] = [
  token("您好,已为您退款"), check(false, ["承诺了退款已完成"]),
  token("您好,您已有一笔申请"), check(false, ["没说明为什么不能重复申请", "答非所问"]),
  { event: "node", data: { node: "handoff" } },
];
const s = events.reduce((st, e) => reducer(st, { type: "event", e }), reducer(initial, { type: "start" }));
assert.equal(s.rewrites, 2);
assert.deepEqual(s.rejections, [["承诺了退款已完成"], ["没说明为什么不能重复申请", "答非所问"]]);
assert.equal(s.draft, "");
console.log("ok", s.details.check);
```

<div class="line-notes">

- `const check = (passed: boolean, problems: string[]): AgentEvent =>` 造事件的小工厂函数,返回类型写成 AgentEvent,写错字段 TypeScript 马上报。
- `const events: AgentEvent[] = [` 模拟第六步那张工单的样子:写草稿、退回、再写、再退回、转人工。比录一段真流快,也能精确控制。
- `assert.equal(s.draft, "");` 第二次退回后草稿又被清空。

</div>

```bash
npx tsx scripts/check_rejections.mts
npx tsx scripts/check_reducer.mts
npx tsc --noEmit -p .
```

真实输出:

```text
ok 退回:没说明为什么不能重复申请;答非所问
ok 77 个事件, 107 字草稿,花费 0.02598
```

tsc 0 报错。details 里的 check 还是只有最后一次,rejections 两次都在。Day 470 以加了 `rejections` 的版本为准,客服工作台会把它显示出来。

</details>

验收标准:`npx tsc --noEmit -p .` 0 报错;`check_reducer.mts` 和 `check_rejections.mts` 都打印 ok;在浏览器的调试页里用回放看到 status 从 running 变成 waiting_approval;能说出为什么不用 EventSource、为什么要 TextDecoderStream、为什么 steps 只由 node 追加;今天真模型花费在 0.15 元以内(我是 0.1115 元)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| AI SDK / useChat | Vercel 的 TypeScript 库和它的 React hook,帮你管聊天消息和流式更新,但要求后端说它的 UI Message Stream 协议。 |
| UI Message Stream 协议 | AI SDK 规定的流格式:响应头 `x-vercel-ai-ui-message-stream: v1`,消息类型如 `text-delta`、`tool-input-available`,以 `[DONE]` 结束。 |
| EventSource | 浏览器自带的 SSE 客户端,会自动重连,但只能发 GET、不能带请求体。 |
| ReadableStream | 浏览器和 Node 里表示「一块块到来的数据」的对象。例:fetch 的 `res.body`。 |
| TextDecoderStream | 把字节流解码成文本流,会把切在块边上的半个字符留到下一块再拼。 |
| U+FFFD 替换字符 | 解码失败时出现的 �。例:一个汉字的三个字节被分在两块里单独解码。 |
| eventsource-parser | 把 SSE 文本切成一条条 `{event, data, id}` 的小库;有流式接口 `EventSourceParserStream` 和非流式接口 `createParser`。 |
| 异步生成器 | `async function*`,里面能 await 也能 yield,外面用 `for await` 取值。例:`streamEvents`。 |
| 可辨识联合 | 联合类型里每个成员都有一个字面量字段(这里是 `event`),`switch` 它之后 TypeScript 能确定是哪个成员。例:`AgentEvent`。 |
| 类型断言(as) | 告诉 TypeScript「把它当成这个类型」,不做任何运行时检查。例:`JSON.parse(...) as AgentEvent`。 |
| reducer | `(旧状态, 动作) => 新状态` 的纯函数,不改旧对象。例:`run.ts` 的 `reducer`。 |
| 纯函数 | 同样的输入一定得到同样的输出,不读写外面的东西。所以能在 Node 里直接测。 |
| AbortController | 用来中途取消 fetch 的对象,`abort()` 以后 fetch 和正在读的流都会抛 AbortError。 |
| 回放(replay) | 把录下来的真实响应按原样再发一遍,用来不花钱地调前端。例:`replay.mts`。 |
| tsx | 直接运行 TypeScript 文件的命令行工具,只转译不做类型检查。 |
| .mts | 「这是 ES 模块」的 TypeScript 文件后缀,最外层可以直接写 await。 |

## 常见误区

**以为 useChat 能直接接任何后端。** 它要后端说 AI SDK 的 UI Message Stream 协议。后端是自己定的事件格式,要么在后端加一层翻译,要么前端自己读流。

**把有副作用的流式接口改成 GET,好用 EventSource。** 审批、追问都会改数据,GET 会被预取、缓存、记日志、重放。保持 POST,用 fetch 读。

**每块单独 `new TextDecoder().decode(chunk)`。** 本机测试看不出问题,一过公网就出现零星的 �。`split_decode.mts` 实测 811 块里解出 202 个乱码。用 `TextDecoderStream`。

**自己按 `\n\n` 切事件。** 一个事件被切在两个网络包里、多行 data、注释行心跳,自己写很容易漏一种。交给 eventsource-parser。

**以为 `as AgentEvent` 会检查数据。** 它只是让 TypeScript 闭嘴。后端改了字段名,前端要到运行时才发现。后端那一侧靠接口测试守住,真要校验就上 zod。

**step 和 node 都往步骤列表里加。** 每个节点出现两次,勾还打早了。steps 只由 node 追加,step 的内容放 details。

**质检退回不清草稿。** 第六步实测两版草稿 203 字和 170 字,不清空就是 373 个字两段话接在一起。

**拿 draft 当最终回复。** 转人工那次 draft 是 0 字,回复在 `summary.reply` 里。定稿也是后端 finalize 拼好引用的版本,和打字机里的草稿不一样。

**只看 status 判断结局。** 转人工和已解决在 reducer 里都是 done,要看 `summary.outcome`。

**`events.reduce(reducer, ...)`。** reducer 收的是 Action 不是事件,状态第一步就变成 undefined。tsx 不查类型,写完 scripts 也要跑 `tsc --noEmit`。

**CORS 出错时盯着页面上的报错看。** JavaScript 只拿到 `Failed to fetch`,真正的原因在 DevTools 的 Console 里。先看预检请求的 `Access-Control-Allow-Origin` 和页面的端口对不对得上。

**把 interrupt 里的数据整个显示给客户。** 实测 request 里有一个写给模型的 note。前端只取要显示的字段。

## 学习资料

### 文档与文章

- [AI SDK · Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol):UI Message Stream 协议的全部消息类型和响应头,对照我们的七种事件看差在哪。
- [AI SDK · Chatbot(useChat)](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot):`useChat` 的基本用法,Day 473 会正式用。
- [MDN · 使用可读流](https://developer.mozilla.org/zh-CN/docs/Web/API/Streams_API/Using_readable_streams):中文,`getReader`、`pipeThrough`、自己造一个 ReadableStream,今天 split_decode 里那几行都在这。
- [MDN · TextDecoderStream](https://developer.mozilla.org/zh-CN/docs/Web/API/TextDecoderStream):中文,一页就看完。
- [MDN · EventSource](https://developer.mozilla.org/zh-CN/docs/Web/API/EventSource):中文,看构造函数那一节就知道为什么它不能发 POST。
- [MDN · AbortController](https://developer.mozilla.org/zh-CN/docs/Web/API/AbortController):中文,停止按钮靠它。
- [eventsource-parser](https://github.com/rexxars/eventsource-parser):README 里有流式和非流式两种用法。
- [React · useReducer](https://react.dev/reference/react/useReducer) 和 [迁移状态逻辑至 Reducer 中](https://zh-hans.react.dev/learn/extracting-state-logic-into-a-reducer):后者是中文,讲为什么一堆 useState 该换成 reducer。
- [TypeScript · Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html):英文,「Discriminated unions」一节就是 AgentEvent 的写法。
- [Next.js · Environment Variables](https://nextjs.org/docs/app/guides/environment-variables):`NEXT_PUBLIC_` 在构建时内联,部署前一定要知道。

### B 站视频

- 前端周老师《AI 对话的流式输出效果,使用 fetch 也可以轻松实现》:上面嵌入的那个。
- 今晚吃泡面a《chatgpt stream 实时输出功能实现原理 SSE(Server-send events)》:BV1ws4y1P7G7,7 分钟,用的是 EventSource 加 nginx 关缓冲,正好对照我们为什么换成 fetch。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oAebzkExf&autoplay=0&high_quality=1" title="为什么要用 useReducer？5分钟搞懂 React 状态管理进阶！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>FireUG技术社区 · 为什么要用 useReducer?5 分钟搞懂 React 状态管理进阶 · 6 分钟,2025 年。你会 React 的话这个是复习,重点听「状态之间有关联时 useState 为什么会乱」那段,和我们一次运行几十个事件的情况一样。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/mojZpktAiYQ" title="A Complete Guide To Vercel’s AI SDK // The ESSENTIAL Tool For Shipping AI Apps" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Matt Pocock · A Complete Guide To Vercel's AI SDK · 英文,开字幕看。今天没用 AI SDK,但应该知道它帮你做了什么,看完再回头看我们手写的四十行,判断以后自己的项目选哪条路。视频里的版本比 7.0 旧,API 以官方文档为准。</figcaption>
</figure>

### 书籍

今天这组不需要。读流和 reducer 的资料以 MDN 和 React 官方文档为准,比任何一本书都新。

### 开源项目与代码

- [rexxars/eventsource-parser](https://github.com/rexxars/eventsource-parser):想看 SSE 的切分规则到底有几种边角情况,读 `src/parse.ts`,不长。
- [vercel/ai](https://github.com/vercel/ai):AI SDK 的源码,`packages/react` 里是 `useChat`。想看它内部是不是也是一个 reducer 加读流,可以翻一翻。

## 自测

1. 为什么我们的三个流式接口不能用 `EventSource`?改成 GET 有什么问题?

<details><summary>答案</summary>

EventSource 只能发 GET,不能带请求体和自定义请求头,而追问要带客户的话、审批要带决定和审批人。改成 GET 的话,有副作用的操作会被浏览器预取、被缓存、被日志完整记下、可能被重放。所以保持 POST,用 fetch 读响应体。

</details>

2. 一个汉字被网络切在两个包里,`TextDecoderStream` 是怎么处理的?每块单独 decode 会怎样?

<details><summary>答案</summary>

TextDecoderStream 内部只有一个解码器,块尾不完整的字节先留着,下一块来了拼上再解。每块单独用新的 TextDecoder 解码,半个字解不出来,变成替换字符 �。split_decode.mts 每 7 字节切一块,811 块里出了 202 个乱码。

</details>

3. step 事件和 node 事件谁先到?reducer 为什么只让 node 往 steps 里追加?

<details><summary>答案</summary>

step 先到,它是节点执行中通过 `_emit()` 推的;node 是节点跑完后 LangGraph 的 updates。两种都追加的话每个节点会出现两次,而且 step 那一次打勾太早。node 才是「节点跑完了」的权威来源,step 只带细节,放进 details 按节点名挂上。

</details>

4. 真模型那次 T000156 跑完,`state.draft` 是 0 字,为什么?最终回复在哪?

<details><summary>答案</summary>

质检退回了两次,每次退回 reducer 都把草稿清空;第二次之后路由去了 handoff,handoff 写的是一句固定的转人工回复,不调模型,没有 token。最终回复在 done 的 `summary.reply` 里。渲染时要先看 summary.reply,没有再看 draft。

</details>

5. 面试题:Agent 的流式输出,前端是怎么接的?状态怎么管?

<details><summary>答案</summary>

示范回答:后端是 FastAPI 的 SSE,接口是 POST,所以浏览器不能用 EventSource,我用 fetch 拿 `res.body`,先过 TextDecoderStream 解码,避免一个汉字被切在两个包里出乱码,再用 eventsource-parser 按 SSE 规则切成事件,解析 JSON 以后按 `event` 字段变成一个 TypeScript 的可辨识联合类型。整个读流写成一个异步生成器,404、409 这类在流开始前返回的错误抛成带中文提示的 ApiError。状态用一个纯函数 reducer 管:一次运行收几十到几百个事件,事件进 reducer 出新状态,组件只读状态。有两个细节:节点完成只认 node 事件,step 只带细节,否则步骤会重复;质检退回时清空草稿,因为模型会从头重写。reducer 不依赖 React,我录了一段真后端的流存成文件,用它在 Node 里做断言,也用一个三十行的回放服务器在浏览器里联调,调界面不花模型的钱。没用 AI SDK 的 useChat,是因为它要求后端说它的协议,而我们的审批发生在另一个人的页面上,不完全是聊天模型。

</details>

6. 为什么 reducer 在已经结束的运行上收到 stopped 时,要返回原来那个对象,而不是 `{ ...s }`?

<details><summary>答案</summary>

React 用 `Object.is` 比较新旧状态,返回同一个对象就跳过这次渲染。`{ ...s }` 内容一样但是新对象,会让组件白白重新渲染一次。check_reducer.mts 用 `again === s` 断言了这一点。

</details>

## 明天预告

明天是 [Day 470](/blog/agent-zero/day-470-ui-components/),界面(三):过程、工具卡片、回复和引用,两个页面。今天的 `RunState` 已经有了步骤、细节、工具调用、草稿、审批和摘要,明天把它们画出来:一个 RunView 显示 Agent 的过程,工具卡片把读操作和写操作分开,回复里的 `[1]` 渲染成上标链接,模型的输出一律当纯文本;再做客户视角和客服工作台两个页面,客服在工作台上点「通过」,恢复后的流程在审批卡片里跑完。
