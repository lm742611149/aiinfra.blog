---
title: 'Day 471 · 界面(四):停止和断线、可访问性、假后端'
description: '先实测点「停止」以后后端在干什么:正在跑的节点会在后台跑完,退款申请照样建了、通知照样发了,工单停在半路。给后端加一个 /resume 从 checkpoint 接着跑,踩到「两个 act 同时跑」造出一笔孤儿退款,用一个正在运行的工单集合挡住;前端把「流断了」和「用户停了」分开处理,断线自动查进度再接着跑。再用一个 TypeScript 写的假后端模拟慢、断线、退回、转人工、出错五种情况,最后看可访问性树,修掉点停止后键盘焦点掉回 body 的问题。'
pubDate: 2026-10-23
regime: none
tags: ['typescript', 'sse', 'react', 'langgraph', 'accessibility', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 471
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 470](/blog/agent-zero/day-470-ui-components/) 把 `RunState` 画成了两个页面:客户视角能提交工单、看处理过程、停在审批时锁住输入框;客服工作台能看待审批列表,点通过以后恢复的流程在卡片里跑完。真模型走了一趟「提交退款 → 停在审批 → 客服通过 → 客户刷新进展 → 追问」,合计 0.047 元。

那一趟一切顺利:网络没断,后端没出错,也没人点停止。今天专门看不顺利的时候。用户点了停止,后端那张工单到底停没停?网络断了,客户怎么接回正在跑的那一轮?读屏软件用户点了停止以后,焦点去哪了?最后写一个能模拟各种情况的假后端,以后调界面不用每次都花钱。

## 今天要解决的问题

前端部分默认你会 React,只讲和 Agent 有关的部分。学完今天你应该能做到:

1. 说清楚浏览器断开一个 SSE 流以后,后端的 LangGraph 会把正在跑的节点跑完、之后的节点不再跑,并能用脚本实测出来;讲清「停止」为什么不等于「撤销」。
2. 给后端加一个 `/resume` 接口,从 checkpoint 接着跑;讲清楚「上一次还在收尾」时为什么必须挡住,挡的那一行为什么要写在 `stream.close()` 之后。
3. 在前端把「用户停了」和「流断了」分开:断线以后先 GET 看进度,跑完了直接显示结果,没跑完就调 `/resume` 接着跑,409 就等一会儿再试。
4. 写一个 TypeScript 假后端,用录好的真流模拟慢、断线、退回、转人工、出错;用可访问性树和一段 DevTools 脚本检查流式界面对读屏软件友不友好。

预计用时 3 小时。前置:[Day 318](/blog/agent-zero/day-318-lg-sqlite-saver/)(进程退出以后从 checkpoint 续跑)、[Day 390](/blog/agent-zero/day-390-idempotency/)(幂等键)、[Day 393](/blog/agent-zero/day-393-resume/)(断点续跑)、[Day 467](/blog/agent-zero/day-467-ui-api/)(六个接口)、[Day 469](/blog/agent-zero/day-469-ui-stream/)(`streamEvents` 和 reducer)、[Day 470](/blog/agent-zero/day-470-ui-components/)(`RunView` 和两个页面)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `useRun` 里的 `pump` 和 `recover` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先准备环境

今天要同时开三样东西:真后端、假后端(第五步才写)、前端。我实跑用的端口是真后端 8471、假后端 8077、前端 3471,你用默认的 8000 和 3000 也行,只是下面命令里的环境变量要跟着改。

先重新造数、清快照(Day 464 讲过工单号会重用的坑),再起真后端。在 supportpilot 根目录:

```bash
uv run python -m supportpilot.memory.checkpoint
uv run python scripts/seed_db.py
SUPPORTPILOT_WEB_ORIGINS=http://localhost:3471 uv run uvicorn supportpilot.api.app:app --port 8471
```

这一节的脚本都在 `web/` 目录里用 tsx 跑(Day 469 装的),它们 import 的是 Day 469 的 `src/lib/api.ts`,后端地址从 `NEXT_PUBLIC_SUPPORTPILOT_API` 读,所以命令前面两个环境变量都要带上。

## 第一步:「停止」到底停了什么

Day 469 的 `useRun` 里,停止就是 `AbortController.abort()`。浏览器这边很清楚:fetch 的读取抛出 `AbortError`,reducer 进入 `stopped`,界面显示「已停止接收」。后端那边呢?旧版教程里我只是根据原理推了一句「正在执行的那一步会跑完」,没实测。今天测。

`AbortController` 是浏览器(和 Node)自带的取消开关:`new AbortController()` 得到一个控制器,把它的 `signal` 交给 fetch,调 `abort()` 时 fetch 立刻放弃这个请求,正在读的流会抛出一个名字叫 `AbortError` 的错误。它只管浏览器这一头,服务端只会看到「连接断了」。

脚本建一张李娜的退款工单,收到第一个 `tool` 事件就 abort,然后隔 0、3、10、20 秒各 GET 一次,看工单停在哪:

```ts
// supportpilot/web/scripts/stop_probe.mts
// 点「停止」以后后端在干什么:建一张退款工单,收到第 N 个 tool 事件就 abort,然后隔几秒 GET 一次看它停在哪。
// 运行:SUPPORTPILOT_API=http://localhost:8471 npx tsx scripts/stop_probe.mts tool 1
import { createTicket, getTicket } from "../src/lib/api.ts";
import { streamEvents } from "../src/lib/sse.ts";

const API = process.env.SUPPORTPILOT_API ?? "http://localhost:8000";
const [kind = "tool", nth = "1"] = process.argv.slice(2); // 收到第几个什么事件时停

const { ticket_id } = await createTicket({
  customer_email: "lina@example.com", subject: "想退款", body: "上周买的专业版年付,用不上,请帮我退款。",
});
const ctrl = new AbortController();
const t0 = Date.now();
const ms = () => `${String(Date.now() - t0).padStart(5)}ms`;
let seen = 0;
try {
  for await (const e of streamEvents(`${API}/tickets/${ticket_id}/run`, { signal: ctrl.signal })) {
    if (e.event !== "token") console.log(ms(), e.event, JSON.stringify(e.data).slice(0, 70));
    if (e.event === kind && ++seen === Number(nth)) {
      console.log(ms(), "---- abort ----");
      ctrl.abort();
    }
  }
} catch (err) {
  console.log(ms(), "for await 抛出:", (err as Error).name);
}
for (const wait of [0, 3000, 10000, 20000]) {
  await new Promise((r) => setTimeout(r, wait));
  const s = await getTicket(ticket_id);
  console.log(ms(), "GET", ticket_id, JSON.stringify({ outcome: s.outcome, waiting_on: s.waiting_on, reply: s.reply?.slice(0, 20) ?? null, cost: s.cost_cny }));
}
```

<div class="line-notes">

- `const [kind = "tool", nth = "1"] = process.argv.slice(2);` `process.argv` 是命令行参数数组,前两项是 node 和脚本路径,`slice(2)` 取后面的。数组解构带默认值:不传参数时 kind 是 "tool"、nth 是 "1"。相当于 Python 的 `sys.argv[1:]`。
- `const { ticket_id } = await createTicket({` 顶层 await:`.mts` 是 ES 模块,模块最外层可以直接 await,不用包一个 async 函数。实测拿到 `T000153`。
- `const ctrl = new AbortController();` 自己建一个控制器,模拟用户点「停止」。
- `const ms = () => `${String(Date.now() - t0).padStart(5)}ms`;` 打印距开始多少毫秒,`padStart(5)` 左边补空格对齐。
- `for await (const e of streamEvents(`${API}/tickets/${ticket_id}/run`, { signal: ctrl.signal })) {` Day 469 的 `streamEvents`,把 signal 传进去,fetch 就受这个控制器管。
- `if (e.event === kind && ++seen === Number(nth)) {` `++seen` 先加一再比较。收到第 1 个 tool 事件时条件成立。
- `ctrl.abort();` 断开。下一次 `reader.read()` 会抛 AbortError,for await 跳到 catch。
- `console.log(ms(), "for await 抛出:", (err as Error).name);` catch 里的 err 类型是 unknown,先断言成 Error 才能读 `.name`。实测是 `AbortError`。
- `for (const wait of [0, 3000, 10000, 20000]) {` 断开以后立刻、3 秒后、再 10 秒、再 20 秒各看一次。
- `JSON.stringify({ outcome: s.outcome, waiting_on: s.waiting_on,` 只打印关心的四个字段。`waiting_on` 是 checkpoint 里的 `next`,也就是「下一步该跑哪个节点」(Day 467)。

</div>

```bash
cd web
SUPPORTPILOT_API=http://localhost:8471 NEXT_PUBLIC_SUPPORTPILOT_API=http://localhost:8471 npx tsx scripts/stop_probe.mts tool 1
```

真实输出:

```text
  876ms step {"type":"step","node":"load_customer","found":true,"profile":true}
  878ms node {"node":"load_customer"}
  881ms step {"type":"step","node":"prepare_context","summarized_upto":0}
  883ms node {"node":"prepare_context"}
 1671ms step {"type":"step","node":"classify","category":"refund"}
 1674ms node {"node":"classify"}
 3641ms step {"type":"step","node":"retrieve","docs":["KB-refund-001","KB-refund-00
 3643ms node {"node":"retrieve"}
 4374ms tool {"type":"tool","name":"list_subscriptions","args":"{\"customer_id\": \
 4374ms ---- abort ----
 4385ms for await 抛出: AbortError
 4424ms GET T000153 {"outcome":null,"waiting_on":["act"],"reply":null,"cost":0.00261}
 7448ms GET T000153 {"outcome":null,"waiting_on":[],"reply":null,"cost":0.02218}
17491ms GET T000153 {"outcome":null,"waiting_on":[],"reply":null,"cost":0.02218}
37510ms GET T000153 {"outcome":null,"waiting_on":[],"reply":null,"cost":0.02218}
```

一行行看。4.374 秒收到第一个工具调用(查订阅),马上断开。断开后 50 毫秒 GET,`waiting_on` 是 `["act"]`,花费 0.00261 元,这是 act 之前那几个节点的钱。3 秒后再看,`waiting_on` 变成了空列表,花费涨到 0.02218 元。**act 节点在浏览器断开以后,自己在后台跑完了**:剩下的三次工具调用、几次模型调用全做了,钱也花了。之后 10 秒、20 秒,数字不再变,draft、check 这些后面的节点一个都没跑。

再看后端终端,断开之后它打印了这一段(Day 455 的审批通知,演示环境是 dry-run,只打印不发送):

```text
[notify:dry-run]
【退款待审批】RF-T000153-INV-202609-0002
客户:C0002  金额:¥950.0
规则:annual_first_14_days  原因:年付首购第 7 天（14 天政策内），客户表示专业版用不上，要求全额退款 950 元
```

客户点了停止,退款申请照样建了,财务群照样收到了通知。为什么会这样?我用一个不调模型的小脚本在 Python 里直接测了 LangGraph:同步的 `graph.stream()` 收到第一个工具事件后调它的 `close()`,`close()` 足足等了 2.01 秒才返回,这 2 秒正好是 act 节点剩下的工具调用时间,返回时四个工具全调完了。也就是说,**生成器被关掉时,LangGraph 会等正在跑的节点跑完、把结果存进 checkpoint,然后才停**,后面的节点不会再开始。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="点停止以后的时间线:浏览器在 4.4 秒断开,后端的 act 节点继续跑到 7.4 秒,期间建了退款申请、发了通知;之后 draft 和 check 都没有跑,工单停在半路">
<g font-family="var(--font-mono)" font-size="11">
<text x="10" y="30" fill="var(--ink)">浏览器</text>
<line x1="80" y1="26" x2="300" y2="26" stroke="var(--mem)" stroke-width="3"/>
<text x="304" y="30" fill="var(--ink-soft)">4.4s abort</text>
<line x1="300" y1="14" x2="300" y2="200" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="10" y="80" fill="var(--ink)">后端</text>
<rect x="80" y="64" width="150" height="26" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="155" y="81" text-anchor="middle" fill="var(--ink-soft)">前四个节点</text>
<rect x="232" y="64" width="210" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="337" y="81" text-anchor="middle" fill="var(--ink)">act(后台跑完)</text>
<rect x="450" y="64" width="80" height="26" rx="4" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="490" y="81" text-anchor="middle" fill="var(--ink-faint)">draft ✗</text>
<rect x="536" y="64" width="80" height="26" rx="4" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="576" y="81" text-anchor="middle" fill="var(--ink-faint)">check ✗</text>
<text x="442" y="112" text-anchor="end" fill="var(--ink-soft)">7.4s 存进 checkpoint</text>
<text x="10" y="140" fill="var(--ink)">副作用</text>
<text x="310" y="140" fill="var(--compute)">建了 RF-T000153-…(pending)</text>
<text x="310" y="158" fill="var(--compute)">发了审批通知</text>
<text x="310" y="176" fill="var(--ink-soft)">花费 0.00261 → 0.02218 元</text>
<text x="10" y="210" fill="var(--ink-faint)">GET:waiting_on ["act"] → [],outcome 一直是 null,工单停在半路</text>
</g>
</svg>
<figcaption>点停止只是浏览器不收了。正在跑的节点照样跑完,该建的申请建了、该发的通知发了,后面的节点不再跑。</figcaption>
</figure>

这带出两个结论。

**「停止」是「我不想看了」,不是「撤销」。** 停在 act 之后,退款申请可能已经建好了。真正的撤销要在后端设计,比如退款申请在审批前允许作废,不能靠前端断开连接。界面上要把这句话告诉用户,第四步会加。

**工单会卡在半路。** `outcome` 是 null,`waiting_on` 是空的,既没有结局,也不在等审批。更糟的是那条退款申请:它在 `biz.refund_requests` 里是 pending,会出现在工作台的待审批列表里,可是图根本没走到 approval 节点,客服点「通过」只会得到 409「这个工单不在等待审批」。要让工单走完,得有办法让它从停下的地方接着跑。

## 第二步:后端加 /resume,从 checkpoint 接着跑

[Day 318](/blog/agent-zero/day-318-lg-sqlite-saver/) 学过,LangGraph 有 checkpointer 时,对同一个 `thread_id` 调 `graph.stream(None, cfg)`,输入传 `None`,意思是「别开新的一轮,从最后一个 checkpoint 接着跑」。我们的工单号就是 thread_id,所以接口很简单。在 `api/app.py` 里,`waiting_approval` 依赖下面加一个依赖,`get_ticket` 上面加一个接口:

```python
# supportpilot/src/supportpilot/api/app.py(新增,第一版)
def resumable(ticket_id: str, graph: Graph) -> str:
    """Day 471:这一轮跑到一半断了(停止、断网),允许从 checkpoint 接着跑。"""
    snap = graph.get_state(_cfg(ticket_id))
    if not snap.values:
        raise HTTPException(404, "工单还没有处理过,先调 /run")
    if "approval" in snap.next:
        raise HTTPException(409, "工单在等待审批,不需要继续")
    if snap.values.get("outcome"):
        raise HTTPException(409, "这一轮已经处理完了")
    return ticket_id


@app.post("/tickets/{ticket_id}/resume", response_class=EventSourceResponse)
def resume(ticket_id: Annotated[str, Depends(resumable)], graph: Graph) -> Iterator[ServerSentEvent]:
    yield from _events(graph, None, ticket_id)   # 输入传 None:不开新一轮,从最后一个 checkpoint 接着跑
```

<div class="line-notes">

- `def resumable(ticket_id: str, graph: Graph) -> str:` 和 Day 467 的 `idle_thread`、`waiting_approval` 一样是一个依赖:检查不过就抛 HTTPException,FastAPI 在流开始之前就返回 404 或 409,前端的 `streamEvents` 会把它变成 `ApiError`。
- `snap = graph.get_state(_cfg(ticket_id))` 读这个工单最新的快照。`snap.values` 是状态字典,`snap.next` 是下一步要跑的节点。
- `if "approval" in snap.next:` 停在审批不是「半路」,是在等人,要走 `/approvals/{id}`。
- `if snap.values.get("outcome"):` 已经有结局(resolved 或 escalated)就没什么可接着跑的。Day 468 改过,每一轮开始时 load_customer 会清掉 outcome,所以 outcome 有值一定是这一轮跑完了。
- `def resume(ticket_id: Annotated[str, Depends(resumable)], graph: Graph)` 写法和 Day 467 的 `follow_up` 一样,只是没有请求体。
- `yield from _events(graph, None, ticket_id)` 复用同一个翻译函数,前端收到的还是那七种事件。

</div>

重启后端,对第一步停在半路的 T000153 调一次(`curl -N` 关掉缓冲,事件一条条出来):

```bash
curl -N -X POST localhost:8471/tickets/T000153/resume
```

真实输出(token 太多,中间省掉):

```text
event: node
data: {"node": "act"}

event: node
data: {"node": "__metadata__"}

event: token
data: {"type": "token", "text": "您好"}
……(64 个 token)
event: node
data: {"node": "draft"}

event: step
data: {"type": "step", "node": "check", "passed": true, "problems": []}

event: node
data: {"node": "check"}

event: interrupt
data: {"type": "refund_approval", "ticket_id": "T000153", "request": {"id": "RF-T000153-INV-202609-0002", ……}

event: done
data: {"ticket_id": "T000153", "outcome": "waiting_approval", "category": "refund", "reply": null, "turns": 1, "cost_cny": 0.02621, "waiting_on": ["approval"]}
```

接着跑成功了,有三处值得看。

第一个事件是 `node: act`,但没有任何 tool 事件。act 在后台跑完时,它的结果已经作为「待写入」存进了 checkpoint,LangGraph 接着跑时直接用这份结果,不会再调一遍工具。它只是把 act 的「节点完成」补报了一次。

第二个事件是 `node: __metadata__`。这不是我们的节点,是 LangGraph 在补报的那条更新里附带的元数据(双下划线开头的都是它内部用的)。前端的 `STEP_NAMES` 不认识它,会原样显示成一个「✓__metadata__」。在 `_events` 里把双下划线开头的键全跳过:

```python
# supportpilot/src/supportpilot/api/app.py(_events 里 elif 那一行改成)
                elif update is None or node.startswith("__"):  # 空更新;Day 471:接着跑时还会多一个 __metadata__
                    continue
```

<div class="line-notes">

- `elif update is None or node.startswith("__"):` `__interrupt__` 在上面那个 if 里已经处理了,走到这里的双下划线键都是内部的。

</div>

第三,最后的花费是 0.02621 元,比停下时的 0.02218 只多了 4 厘钱,就是 draft 和 check 的钱。act 没有重复花钱。

### 故意犯错:断开以后立刻接着跑

上面我是等了 30 多秒才 resume 的,那时 act 早跑完了。前端的断线重连不会等这么久。如果断开以后马上 resume,act 还在后台跑,会怎样?

```ts
// supportpilot/web/scripts/resume_now.mts
// 收到第一个 tool 事件就断开,然后立刻调 /resume 接着跑。看后端会不会把同一个节点跑两遍。
// 运行:SUPPORTPILOT_API=http://localhost:8471 npx tsx scripts/resume_now.mts lina@example.com
import { createTicket, getTicket, listApprovals } from "../src/lib/api.ts";
import { streamEvents } from "../src/lib/sse.ts";

const API = process.env.SUPPORTPILOT_API ?? "http://localhost:8000";
const { ticket_id } = await createTicket({
  customer_email: process.argv[2] ?? "lina@example.com", subject: "想退款", body: "上周买的专业版年付,用不上,请帮我退款。",
});
const t0 = Date.now();
const at = () => `@${((Date.now() - t0) / 1000).toFixed(1)}s`;
const seen: string[] = [];

const ctrl = new AbortController();
try {
  for await (const e of streamEvents(`${API}/tickets/${ticket_id}/run`, { signal: ctrl.signal })) {
    if (e.event === "tool") {
      seen.push(`run:${e.data.name}${at()}`);
      ctrl.abort();
    }
  }
} catch { /* AbortError,预料之中 */ }

for (let i = 0; i < 10; i++) {
  try {
    for await (const e of streamEvents(`${API}/tickets/${ticket_id}/resume`)) {
      if (e.event === "tool") seen.push(`resume:${e.data.name}${at()}`);
      if (e.event === "node") seen.push(`node:${e.data.node}${at()}`);
    }
    break;
  } catch (err) {
    seen.push(`409${at()}`); // 上一次还在收尾,1 秒后再试
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const s = await getTicket(ticket_id);
const pending = (await listApprovals()).filter((r) => r.ticket_id === ticket_id).map((r) => r.id);
console.log(ticket_id, seen.join("  "));
console.log("结局", s.outcome, "花费", s.cost_cny, "待审批", pending);
```

<div class="line-notes">

- `customer_email: process.argv[2] ?? "lina@example.com",` 每次换一个客户。同一个客户的同一张账单已经有一条 pending 申请时,第二张工单查资格会被拒,结果就不可比了。
- `if (e.event === "tool") {` 收到第一个工具事件就断。`e.data.name` 能直接用,因为 `AgentEvent` 是可辨识联合,判断了 `event === "tool"` 以后 TypeScript 知道 data 是 `ToolEvent`。
- `} catch { /* AbortError,预料之中 */ }` catch 不写变量(Day 470 讲过)。
- `for (let i = 0; i < 10; i++) {` 最多试 10 次。现在后端还没有 409 的逻辑,第一次就会成功;后面加了挡板,这里的重试就用上了。
- `seen.push(`409${at()}`);` 走到 catch 说明 `streamEvents` 抛了 `ApiError`,流没开起来。
- `const pending = (await listApprovals()).filter((r) => r.ticket_id === ticket_id).map((r) => r.id);` 看这张工单在工作台的待审批列表里有没有申请。

</div>

在没有任何防护的 `/resume` 上,我用李娜、王芳、吴刚三个客户各跑了一次(跑之前重新造数、清快照):

```text
T000153 run:list_subscriptions@2.8s  resume:list_subscriptions@3.8s  resume:list_invoices@3.8s  resume:check_refund_eligibility@4.5s  resume:create_refund_request@5.4s  node:act@7.2s  node:draft@8.2s  node:check@9.4s  node:finalize@9.4s
结局 resolved 花费 0.02569 待审批 [ 'RF-T000153-INV-202609-0002' ]
T000154 run:list_subscriptions@3.2s  resume:list_subscriptions@4.3s  resume:list_invoices@4.3s  resume:check_refund_eligibility@5.2s  resume:create_refund_request@6.3s  node:act@7.8s  node:draft@9.1s  node:check@10.3s  node:draft@11.4s  node:check@12.4s  node:finalize@12.4s
结局 resolved 花费 0.03313 待审批 [ 'RF-T000154-INV-202605-0002' ]
T000155 run:list_subscriptions@3.0s  resume:list_subscriptions@3.9s  resume:list_invoices@3.9s  resume:check_refund_eligibility@4.8s  resume:create_refund_request@5.8s  node:act@7.7s  node:draft@9.0s  node:check@10.6s  node:draft@11.4s  node:check@14.0s  node:handoff@14.1s
结局 escalated 花费 0.03629 待审批 [ 'RF-T000155-INV-202601-0001' ]
```

三次都出事了。resume 里出现了 `resume:list_subscriptions`,act 被**从头又跑了一遍**,和后台那个还没跑完的 act 同时在跑。两个 act 都调了 `create_refund_request`:先到的那个建了申请;后到的那个撞上「这张账单已经有一条待审批的申请」,查资格不通过,工具返回错误。最后留在 checkpoint 里的是后到那个的结果,状态里 `refund_request` 是 None。

于是图以为没有退款申请,不走审批:T000153 和 T000154 直接 finalize,告诉客户「已完成」;T000155 质检两次没过,转了人工。可三张工单在工作台里都挂着一条 pending 的申请,客服点通过,得到的是 `{"detail":"这个工单不在等待审批"}`。一笔永远批不了的孤儿退款,客户那边还以为事情办完了。

花费也不对。T000153 显示 0.02569 元,可后台那个 act 也调了模型,它的钱被覆盖掉,没记进账本。

### 挡住「还在收尾」的工单

问题在于 `/resume` 不知道上一次还没收尾。最直接的办法:进程里记一个「正在跑图的工单」集合,跑的时候放进去,跑完拿出来,`resumable` 发现工单还在里面就返回 409。

我第一版是这样写的,`_events` 开头 add,`finally` 里 discard。跑了三次,前两次正常,第三次 act 又被重跑了。原因在 Python 关生成器的顺序:浏览器断开后,`_events` 这个生成器被关掉,我们的 `finally` 先执行,把工单从集合里拿掉了;然后 `for` 循环用的 `graph.stream()` 生成器才被关掉,而它要等 act 跑完才返回。在这几秒的空档里,集合里已经没有这张工单,resume 照样放行。

所以要在 `finally` 里**先手动关掉 LangGraph 的流**,等它返回(act 跑完、结果存好),再把工单拿出来。改好的 `_events`:

```python
# supportpilot/src/supportpilot/api/app.py(R 下面加一行,_events 整个换成这样)
RUNNING: set[str] = set()  # Day 471:正在跑图的工单。浏览器断开以后,正在执行的那个节点还会在后台跑完


def _events(graph, payload: Any, ticket_id: str) -> Generator[ServerSentEvent, None, None]:
    """把 LangGraph 的流翻译成前端认识的七种事件。同步生成器,FastAPI 会放进线程池里跑。"""
    RUNNING.add(ticket_id)
    stream = graph.stream(payload, _cfg(ticket_id), stream_mode=["updates", "custom"])
    try:
        for mode, chunk in stream:
            if mode == "custom":
                yield _sse(chunk["type"], chunk)
                continue
            for node, update in chunk.items():
                if node == "__interrupt__":
                    yield _sse("interrupt", update[0].value)
                elif update is None or node.startswith("__"):  # 空更新;Day 471:接着跑时还会多一个 __metadata__
                    continue
                else:
                    yield _sse("node", {"node": node})
    except Exception:
        log.exception("ticket %s failed", ticket_id)  # 细节写服务端日志,不推给浏览器
        yield _sse("error", {"message": "处理出错了,已经记录,请稍后重试"})
        return
    finally:
        stream.close()  # 浏览器断开时这个生成器会被关掉。先关 LangGraph 的流:它会等正在跑的节点跑完才返回
        RUNNING.discard(ticket_id)
    yield _sse("done", _summary(graph, ticket_id))
```

`resumable` 的最后加两行:

```python
# supportpilot/src/supportpilot/api/app.py(resumable 里 return 之前加)
    if ticket_id in RUNNING:
        raise HTTPException(409, "上一次的处理还在收尾,请稍后再试")
```

文件顶部的 import 改成 `from collections.abc import Generator, Iterator`。

<div class="line-notes">

- `RUNNING: set[str] = set()` 模块级的集合,整个进程共用一份。Python 的 set 单次 add、discard 在 GIL 下是原子的,多个线程同时调不会把集合弄坏。
- `def _events(graph, payload: Any, ticket_id: str) -> Generator[ServerSentEvent, None, None]:` 返回类型从 `Iterator` 改成 `Generator`。三个类型参数依次是 yield 出来的类型、send 进去的类型、return 的类型。改它是因为下面的测试要调 `.close()`,`Iterator` 类型上没有这个方法,basedpyright 会报 `Cannot access attribute "close"`。
- `RUNNING.add(ticket_id)` 注意它在生成器函数体里,第一次取值时才执行,不是调用 `_events(...)` 的那一刻。FastAPI 先跑完依赖(包括 `resumable` 的检查),再开始取值。
- `stream = graph.stream(payload, _cfg(ticket_id), stream_mode=["updates", "custom"])` 先把 LangGraph 的流存进一个变量,finally 里才能手动关它。原来直接写在 for 里,我们拿不到它。
- `for mode, chunk in stream:` 其余逻辑和 Day 467 一样。
- `stream.close()` 生成器的 `close()` 会在它暂停的地方抛一个 GeneratorExit,让它的 finally 都执行完。LangGraph 的流收到 GeneratorExit 后会等正在跑的节点结束、把结果写进 checkpoint 才返回。正常跑完时调 `close()` 什么也不做,出错时也一样安全。
- `RUNNING.discard(ticket_id)` 用 discard 不用 remove:元素不在集合里时 discard 不报错,remove 会抛 KeyError。
- `if ticket_id in RUNNING:` 放在 `resumable` 最后:前面三项是「工单状态不对」,这一项是「现在不行,等会儿可以」,语义不同但都用 409。前端靠 detail 文字分不出来,所以下面前端统一按「等一会儿再试」处理。

</div>

重启后端、重新造数、清快照,同样三个客户再跑一次:

```text
T000153 run:list_subscriptions@7.0s  node:act@10.7s  node:draft@12.2s  node:check@12.7s
结局 waiting_approval 花费 0.02627 待审批 [ 'RF-T000153-INV-202609-0002' ]
T000154 run:list_subscriptions@2.3s  409@2.3s  node:act@6.0s  node:draft@7.0s  node:check@8.5s
结局 waiting_approval 花费 0.0262 待审批 [ 'RF-T000154-INV-202605-0002' ]
T000155 run:list_subscriptions@3.4s  409@3.4s  409@4.4s  node:act@7.0s  node:draft@8.3s  node:check@9.7s  node:draft@11.0s  node:check@11.7s
结局 waiting_approval 花费 0.03428 待审批 [ 'RF-T000155-INV-202601-0001' ]
```

三张工单都正常停在审批,待审批列表里的申请和图的状态对得上。没有一个 `resume:` 开头的工具调用,act 只跑了一次。T000154 第一次 resume 拿到 409,1 秒后再试成功;T000155 拿到两次 409。T000153 一次 409 都没有,它的 resume 请求在服务端等了大约 3 秒,直到第一个 act 跑完才开始返回事件,我猜是在等 checkpointer 那条数据库连接的锁,没有深究,结果是对的。T000155 质检退回过一次,所以多了一轮 draft 和 check,花费高一点。

这个集合只在一个进程里有效。用 `uvicorn --workers 4` 起四个进程时,每个进程各有一份 `RUNNING`,resume 可能落到另一个进程上。生产上要换成跨进程的锁,比如 Postgres 的 advisory lock 或 Redis 里一个带过期时间的键,思路和 [Day 390](/blog/agent-zero/day-390-idempotency/) 的幂等一样。我们的演示只起一个进程,够用。

顺便说一下幂等键。就算两个 act 真的同时调了 `create_refund_request`,库里也只会有一条申请,因为申请号是 `RF-{工单号}-{账单号}`,插入时 `ON CONFLICT (id) DO NOTHING`(Day 452 写的)。上面那三张出事的工单也确实每张只有一条申请。幂等键防住了「重复退款」,防不住「图的状态和库对不上」,所以两道都要有。

### 给 /resume 写个测试

不调模型,用 Day 467 的假零件和内存 checkpointer。直接调 `_events` 拿到生成器,收到第一个 tool 事件就停,模拟浏览器断开:

```python
# supportpilot/tests/test_resume.py
"""Day 471:跑到一半断开以后,/resume 从 checkpoint 接着跑。假模型 + 内存存档,不花钱。"""

import pytest
from test_api import client, parse_sse  # noqa: F401

from supportpilot.api import app as api


@pytest.mark.db
def test_resume_after_disconnect(client):
    tid = client.post("/tickets", json={"customer_email": "lina@example.com", "subject": "api-test",
                                        "body": "上周买的专业版年付,用不上,请帮我退款。"}).json()["ticket_id"]
    tools = api.R["deps"].call_tool
    gen = api._events(api.get_graph(), {"ticket": api.ticket_row(tid)}, tid)
    for ev in gen:  # 模拟浏览器:收到第一个 tool 事件就断开
        if ev.event == "tool":
            break
    assert tid in api.RUNNING
    r = client.post(f"/tickets/{tid}/resume")
    assert r.status_code == 409 and "收尾" in r.json()["detail"]   # 上一次还没收尾,不能接着跑

    gen.close()  # FastAPI 发现浏览器断开后,生成器被关掉:act 节点会先跑完
    assert tid not in api.RUNNING
    assert tools.calls.count("create_refund_request") == 1

    ev = parse_sse(client.post(f"/tickets/{tid}/resume").text)
    names = [e for e, _ in ev]
    assert "tool" not in names                       # act 的结果已经存了,不会重跑
    assert names[0] == "node" and ev[0][1] == {"node": "act"}
    assert names[-2:] == ["interrupt", "done"] and ev[-1][1]["outcome"] == "waiting_approval"
    assert tools.calls.count("create_refund_request") == 1

    r = client.post(f"/tickets/{tid}/resume")
    assert r.status_code == 409 and "等待审批" in r.json()["detail"]
    assert client.post("/tickets/T999999/resume").status_code == 404
```

<div class="line-notes">

- `from test_api import client, parse_sse  # noqa: F401` 复用 Day 467 的 fixture 和 SSE 解析函数。`client` 被当成 fixture 用,ruff 会以为它没被用到而报 F401,`noqa` 让它闭嘴。
- `tools = api.R["deps"].call_tool` fixture 里塞的是 `FakeTools`,它把每次调用的工具名记在 `calls` 里。
- `gen = api._events(api.get_graph(), {"ticket": api.ticket_row(tid)}, tid)` 绕过 HTTP 直接拿生成器,我们才能精确地「在某个事件之后断开」。`get_graph` 和 `ticket_row` 本来是依赖函数,直接调用也行。
- `if ev.event == "tool":` `ServerSentEvent` 是 FastAPI 的类,`event` 字段就是事件名。
- `assert tid in api.RUNNING` 此刻生成器停在 yield 上,还没关,工单在集合里。
- `assert r.status_code == 409 and "收尾" in r.json()["detail"]` 这时 resume 必须被挡住。
- `gen.close()` 在真服务里,这一步是浏览器断开后由 FastAPI 和 Python 完成的,这里手动做。
- `assert tools.calls.count("create_refund_request") == 1` close 返回时 act 已经跑完,四个工具都调过了。
- `assert "tool" not in names` 接着跑时没有任何 tool 事件,act 没有重跑。
- `assert names[0] == "node" and ev[0][1] == {"node": "act"}` 第一个事件是补报的 act,`__metadata__` 已经被过滤掉了。
- `assert r.status_code == 409 and "等待审批" in r.json()["detail"]` 停在审批以后再 resume,被第二条规则挡住。

</div>

```bash
uv run pytest tests/test_resume.py -q
uv run pytest -q -m "not llm"
```

真实结果:`1 passed`;全部测试 `63 passed`(Day 470 的 62 个加这一个)。

## 第三步:前端把「停了」和「断了」分开

后端能接着跑了,前端要用起来。先分清三种结束方式:

- **用户点了停止**:`signal.aborted` 是 true。显示「已停止接收」,告诉用户后台那一步还会跑完,给一个「继续处理」按钮,点了才接着跑。
- **流断了**:网络抖了、后端重启了、代理把长连接掐了。读取时抛 TypeError(浏览器里是 `network error`,Node 里是 `terminated`),或者流正常结束了却没收到 done 和 error。这时自动重连。
- **流正常结束**:收到了 done 或 error。

第二种里「正常结束却没有 done」很容易漏。Day 469 的 `useRun` 只在抛错时处理,流被代理干净利落地关掉时,`for await` 正常退出,reducer 永远停在 running,界面一直转。

### reducer 加两个动作

```ts
// supportpilot/web/src/lib/run.ts(改三处)
export type RunStatus = "idle" | "running" | "waiting_approval" | "done" | "error" | "stopped" | "reconnecting";

export type Action =
  | { type: "start" }
  | { type: "event"; e: AgentEvent }
  | { type: "fail"; message: string }
  | { type: "stopped" }
  | { type: "reconnecting" } // Day 471:流断了,正在查进度、准备接着跑
  | { type: "resume" }; // Day 471:接着跑。和 start 不同,已经收到的步骤、工具、草稿都留着

// reducer 里 case "stopped" 那一段换成:
    case "stopped":
      return s.status === "running" || s.status === "reconnecting" ? { ...s, status: "stopped" } : s;
    case "reconnecting":
      return { ...s, status: "reconnecting", error: null };
    case "resume":
      return { ...s, status: "running", error: null };

// case "interrupt" 那一行换成:
          // 断线重连后 token 可能缺了一截,interrupt 里带着完整草稿,以它为准
          return { ...s, draft: e.data.draft, approval: { request: e.data.request, needsFinanceReview: e.data.needs_finance_review } };
```

<div class="line-notes">

- `| "stopped" | "reconnecting";` 新状态:断了,正在查进度、准备接着跑。
- `| { type: "resume" }; // Day 471:接着跑。` 和 `start` 的区别是不重置。断线前已经收到的步骤和工具卡片都要留着,接着跑的流只会推后半段。
- `return s.status === "running" || s.status === "reconnecting" ? { ...s, status: "stopped" } : s;` 重连等待时用户点停止,也要能停。
- `return { ...s, status: "reconnecting", error: null };` 清掉上一次的错误提示,免得「出错了」和「正在接回」同时显示。
- `return { ...s, draft: e.data.draft, approval:` interrupt 事件里本来就带着 draft 节点写好的完整草稿(Day 460 的 approval 节点)。断在打字机中间的话,有一截 token 永远收不到,用 interrupt 里的完整版覆盖。没有退款的工单最后收到的是 done 里的 reply,本来就会替换草稿。

</div>

改完跑 `npx tsc --noEmit -p .`,立刻报:

```text
src/components/RunView.tsx(9,7): error TS2741: Property 'reconnecting' is missing in type '{ idle: string; running: string; waiting_approval: string; done: string; error: string; stopped: string; }' but required in type 'Record<RunStatus, string>'.
```

这就是 Day 470 用 `Record<RunState["status"], string>` 的好处:状态加了一个,显示文字漏写,编译器先红。下面改 RunView 时补上。

### useRun:pump 和 recover

`api.ts` 先加两样东西:

```ts
// supportpilot/web/src/lib/api.ts(decide 上面新增;第一行 import 加上 AgentEvent)
// Day 471:跑到一半断了,从后端的 checkpoint 接着跑
export const resumeTicket = (id: string, signal?: AbortSignal) => streamEvents(`${API}/tickets/${id}/resume`, { signal });

// 断线以后怎么补救:先 GET 看进度,没跑完再 resume。useRun 只认这两个函数,不关心是哪张工单
export type Recover = { get: () => Promise<Summary>; resume: (signal: AbortSignal) => AsyncGenerator<AgentEvent> };
export const recoverFor = (id: string): Recover => ({ get: () => getTicket(id), resume: (signal) => resumeTicket(id, signal) });
```

<div class="line-notes">

- `export const resumeTicket = (id: string, signal?: AbortSignal) =>` 和 `runTicket` 一样是 POST + SSE,只是路径不同。
- `export type Recover = { get: () => Promise<Summary>; resume: (signal: AbortSignal) => AsyncGenerator<AgentEvent> };` 把「怎么查进度」和「怎么接着跑」打包成一个对象传给 useRun。useRun 在 `lib/` 里,不该知道具体的接口路径,传函数进去就行,测试时也好换成假的。
- `export const recoverFor = (id: string): Recover => ({` 给一张工单生成它的补救办法。箭头函数直接返回对象字面量时外面要套一层圆括号,否则花括号会被当成函数体。

</div>

`useRun.ts` 整个换掉:

```ts
// supportpilot/web/src/lib/useRun.ts
// 把 reducer 接到 React 上:开一个流,每来一个事件 dispatch 一次;能停止;能塞一个不是从流里来的事件。
// Day 471:流断了(不是用户点停止)就先查进度,没跑完就从后端的 checkpoint 接着跑。
"use client";
import { useCallback, useReducer, useRef } from "react";
import type { Recover } from "./api";
import type { AgentEvent } from "./events";
import { initial, reducer, type Action } from "./run";
import { ApiError } from "./sse";

type Open = (signal: AbortSignal) => AsyncGenerator<AgentEvent>;
type Outcome = "ended" | "aborted" | "lost";

const RETRY_MS = [0, 1000, 2000, 4000, 8000]; // 第几次重连之前等多久,一共试 5 次,最多等 15 秒
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 把一个流读到底,说清楚它是怎么结束的
async function pump(open: Open, signal: AbortSignal, dispatch: (a: Action) => void, onOpen?: () => void): Promise<Outcome> {
  let opened = false;
  let ended = false;
  try {
    for await (const e of open(signal)) {
      if (!opened) onOpen?.(); // 第一个事件到了才算真的接上
      opened = true;
      dispatch({ type: "event", e });
      if (e.event === "done" || e.event === "error") ended = true;
    }
  } catch (err) {
    if (signal.aborted) return "aborted";
    if (err instanceof ApiError || !opened) throw err; // 流根本没开起来:404/409/422,或者后端没起
    return "lost";
  }
  return ended ? "ended" : "lost"; // 正常读完却没等到 done:被代理或服务器掐掉了
}

export function useRun() {
  const [state, dispatch] = useReducer(reducer, initial);
  const ctrl = useRef<AbortController | null>(null);

  const renew = useCallback(() => {
    ctrl.current?.abort(); // 上一次还没结束就开新的:先断掉旧的,免得两个流的事件交替进来
    const c = new AbortController();
    ctrl.current = c;
    return c;
  }, []);

  const recover = useCallback(async (r: Recover, c: AbortController) => {
    for (const wait of RETRY_MS) {
      dispatch({ type: "reconnecting" });
      await sleep(wait);
      if (c.signal.aborted) return dispatch({ type: "stopped" });
      try {
        const s = await r.get();
        if (s.outcome) return dispatch({ type: "event", e: { event: "done", data: s } }); // 断开期间已经跑完了
        const how = await pump(r.resume, c.signal, dispatch, () => dispatch({ type: "resume" }));
        if (how === "aborted") return dispatch({ type: "stopped" });
        if (how === "ended") return;
      } catch (err) {
        if (err instanceof ApiError && err.status !== 409) return dispatch({ type: "fail", message: err.message });
        // 409(上一次还在收尾)或者网络还没好:等一会儿再试
      }
    }
    dispatch({ type: "fail", message: "连接断了,重试几次都没接上,请稍后刷新页面" });
  }, []);

  const start = useCallback(async (open: Open, r?: Recover) => {
    const c = renew();
    dispatch({ type: "start" });
    try {
      const how = await pump(open, c.signal, dispatch);
      if (how === "aborted") dispatch({ type: "stopped" });
      else if (how === "lost" && r) await recover(r, c);
      else if (how === "lost") dispatch({ type: "fail", message: "连接中断,请稍后重试" });
    } catch (err) {
      dispatch({ type: "fail", message: err instanceof ApiError ? err.message : "连接中断,请稍后重试" });
    }
  }, [renew, recover]);

  const resume = useCallback((r: Recover) => recover(r, renew()), [renew, recover]); // 「继续处理」按钮
  const stop = useCallback(() => ctrl.current?.abort(), []);
  const apply = useCallback((e: AgentEvent) => dispatch({ type: "event", e }), []);

  return { state, start, stop, apply, resume };
}
```

<div class="line-notes">

- `type Outcome = "ended" | "aborted" | "lost";` 一个流的三种结束方式:收到了结局、用户停了、断了。用字符串字面量联合,比返回两个布尔值好读。
- `const RETRY_MS = [0, 1000, 2000, 4000, 8000];` 退避:第一次立刻试,之后每次等的时间翻倍。为什么不一直每秒重试?后端真挂了的时候,几百个浏览器每秒一起打过来,刚起来的服务会被再次打趴。
- `async function pump(open: Open, signal: AbortSignal, dispatch: (a: Action) => void, onOpen?: () => void): Promise<Outcome> {` 写在组件外面,是普通函数,不是 hook,所以 dispatch 要当参数传进来。
- `if (!opened) onOpen?.();` `?.()` 是可选调用:onOpen 没传就什么都不做。收到第一个事件时才通知调用方「接上了」。
- `if (e.event === "done" || e.event === "error") ended = true;` 只有这两个事件算「有结局」。
- `if (signal.aborted) return "aborted";` 先判断是不是用户主动停的。abort 以后 fetch 抛的是 AbortError,不看 signal 的话会被当成断线,又自动连回去了。
- `if (err instanceof ApiError || !opened) throw err;` 两种情况往外抛:一是 ApiError,说明后端明确拒绝(404、409、422),重连没用;二是一个事件都没收到就失败了,多半是后端根本没起,fetch 抛 `TypeError: Failed to fetch`,这和「接上以后断了」不一样,不重连,直接提示。
- `return ended ? "ended" : "lost";` 正常读完但没有结局,当断线处理。
- `const renew = useCallback(() => {` 换一个新的 AbortController,旧的先 abort。`start` 和 `resume` 都用它。
- `const recover = useCallback(async (r: Recover, c: AbortController) => {` 断线以后的补救流程,依赖数组是空的,因为它只用到 dispatch(React 保证 dispatch 引用不变)和参数。
- `dispatch({ type: "reconnecting" });` 状态行变成「正在接回进度」,输入框锁住。
- `if (c.signal.aborted) return dispatch({ type: "stopped" });` 等待期间用户点了停止,就别再连了。
- `const s = await r.get();` 先 GET。断开的这几秒里,后台可能已经跑完了,或者停在了审批。
- `if (s.outcome) return dispatch({ type: "event", e: { event: "done", data: s } });` 有结局(resolved、escalated、waiting_approval)就把摘要当 done 塞进去,和 Day 470「刷新进展」是同一招。
- `const how = await pump(r.resume, c.signal, dispatch, () => dispatch({ type: "resume" }));` 没结局就调 `/resume`。第四个参数:第一个事件到了才把状态改回 running。我第一版在调 pump 之前就 dispatch resume,实测状态行在「正在接回进度」和「处理中」之间来回闪了 6 毫秒:先变「处理中」,马上撞上 409,又变回去。读屏软件会把这两次变化都念出来。
- `if (how === "ended") return;` 接着跑的流有了结局,补救完成。`lost` 的话继续下一轮循环。
- `if (err instanceof ApiError && err.status !== 409) return dispatch({ type: "fail", message: err.message });` 404 这种重试也没用的错误,直接显示。409 和网络错误都吞掉,等下一轮。
- `dispatch({ type: "fail", message: "连接断了,重试几次都没接上,请稍后刷新页面" });` 五次都没成功,放弃,告诉用户。
- `const start = useCallback(async (open: Open, r?: Recover) => {` 第二个参数可选:不传的话断线就只报错,和 Day 469 一样。审批卡片、调试页都可以不传。
- `else if (how === "lost" && r) await recover(r, c);` 用同一个 AbortController,补救过程中点停止也能停。
- `const resume = useCallback((r: Recover) => recover(r, renew()), [renew, recover]);` 「继续处理」按钮调它:换一个新的控制器,走同样的补救流程。

</div>

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="useRun 的流程:pump 读流,三种结局;ended 结束,aborted 显示已停止,lost 进入 recover;recover 先 GET,有结局就塞 done,没有就 resume,409 或断线等一会儿重试,最多五次">
<g font-family="var(--font-mono)" font-size="11">
<rect x="20" y="20" width="120" height="40" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="80" y="44" text-anchor="middle" fill="var(--ink)">pump(读流)</text>
<rect x="200" y="10" width="120" height="26" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="260" y="27" text-anchor="middle" fill="var(--ink-soft)">ended → 完</text>
<rect x="200" y="44" width="120" height="26" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="260" y="61" text-anchor="middle" fill="var(--ink-soft)">aborted → 已停止</text>
<rect x="200" y="80" width="120" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="260" y="97" text-anchor="middle" fill="var(--ink)">lost → recover</text>
<g stroke="var(--ink-soft)"><line x1="140" y1="40" x2="200" y2="23"/><line x1="140" y1="40" x2="200" y2="57"/><line x1="140" y1="40" x2="200" y2="93"/></g>
<rect x="20" y="140" width="130" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="85" y="164" text-anchor="middle" fill="var(--ink)">等 0/1/2/4/8 秒</text>
<rect x="190" y="140" width="110" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="245" y="164" text-anchor="middle" fill="var(--ink)">GET 摘要</text>
<rect x="340" y="120" width="140" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="410" y="139" text-anchor="middle" fill="var(--ink-soft)">有 outcome → 塞 done</text>
<rect x="340" y="170" width="140" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="410" y="189" text-anchor="middle" fill="var(--ink)">POST /resume</text>
<rect x="510" y="170" width="120" height="30" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="570" y="189" text-anchor="middle" fill="var(--ink-soft)">有结局 → 完</text>
<g stroke="var(--ink-soft)" fill="none">
<line x1="260" y1="106" x2="85" y2="140"/>
<line x1="150" y1="160" x2="190" y2="160"/>
<line x1="300" y1="155" x2="340" y2="135"/>
<line x1="300" y1="165" x2="340" y2="185"/>
<line x1="480" y1="185" x2="510" y2="185"/>
<path d="M410 200 L410 230 L85 230 L85 180" stroke-dasharray="4 3"/>
</g>
<text x="250" y="224" fill="var(--ink-faint)">409 / 又断了 → 下一轮,五轮都不行就报错</text>
</g>
</svg>
<figcaption>停止和断线走两条路:停止就停,等用户点「继续处理」;断线自动进 recover,先看进度再决定要不要接着跑。</figcaption>
</figure>

### RunView 和客户页面

RunView 补上新状态的文字,停止以后加一段说明和「继续处理」按钮:

```tsx
// supportpilot/web/src/components/RunView.tsx(改四处)
// ① STATUS_TEXT 加一项
  reconnecting: "正在接回进度",

// ② props 多一个 onResume
type Props = { state: RunState; id: string; onStop?: () => void; onResume?: () => void };

export function RunView({ state, id, onStop, onResume }: Props) {

// ③ section 的 aria-busy 改成
    <section className="run" aria-busy={running || state.status === "reconnecting"} aria-labelledby={`${id}-status`}>

// ④ 草稿前面的提示分两种;错误那一行上面加「停止」的说明
            {!running && <span className="muted">{state.status === "waiting_approval" ? "草稿,审批后定稿:" : "没写完的草稿:"}</span>}

      {state.status === "stopped" && (
        <p className="note">
          只是不再接收进度:后台正在执行的那一步会跑完,之后的步骤不会再跑。{" "}
          {onResume && <button type="button" className="link" onClick={onResume}>继续处理</button>}
        </p>
      )}
```

<div class="line-notes">

- `reconnecting: "正在接回进度",` 断线自动重连和用户点「继续处理」都会进这个状态,所以文字不写「连接断了」,两种情况都说得通。
- `aria-busy={running || state.status === "reconnecting"}` 重连期间这块内容也还会变。
- `{state.status === "waiting_approval" ? "草稿,审批后定稿:" : "没写完的草稿:"}` Day 470 只有一种情况会显示停住的草稿:停在审批。现在多了停止和断线,草稿可能是半截的。我第一次在假后端上点停止,半截草稿前面写着「草稿,审批后定稿」,这是在骗人。
- `只是不再接收进度:后台正在执行的那一步会跑完,之后的步骤不会再跑。` 第一步实测的结论,原样告诉用户。
- `{onResume && <button type="button" className="link" onClick={onResume}>继续处理</button>}` 历史轮次不传 onResume,就不显示按钮。

</div>

客户页面 `src/app/page.tsx` 改四行:

```tsx
// supportpilot/web/src/app/page.tsx(改四行)
import { createTicket, followUp, getTicket, recoverFor, runTicket } from "@/lib/api";
  const { state, start, stop, apply, resume } = useRun();
  const locked = busy || state.status === "waiting_approval" || state.status === "reconnecting";
      start((signal) => runTicket(ticket_id, signal), recoverFor(ticket_id));
    start((signal) => followUp(ticketId, content, signal), recoverFor(ticketId));
          <RunView state={state} id="current" onStop={stop} onResume={() => resume(recoverFor(ticketId))} />
```

<div class="line-notes">

- `const locked = busy || state.status === "waiting_approval" || state.status === "reconnecting";` 正在重连时也锁住输入框,免得客户追问和接着跑的那一轮撞在一起。
- `start((signal) => runTicket(ticket_id, signal), recoverFor(ticket_id));` 第一轮和追问都传补救办法。追问断了也一样:GET 看进度,没跑完就 resume。
- `onResume={() => resume(recoverFor(ticketId))}` 客户点「继续处理」时走同一套流程。

</div>

工作台的审批卡片我没传 `recoverFor`。审批恢复只跑两个不调模型的节点,0.17 秒就完(Day 470 实测),断在中间的概率很低;真断了,客服点「刷新」重新拉列表就能看到。

## 第四步:写一个假后端

接下来要在浏览器里试断线、试停止、试出错。用真后端试,每次都要花两三分钱,而且时机很难掐:想看「断在打字机中间」,得盯着屏幕手动拔网线。Day 469 写过一个回放服务器,只会把录好的那段流原样再放一遍。今天把它升级成一个假后端:七个接口都有,数据形状和真后端一样,工单主题里带上关键词,就模拟对应的情况。

数据从哪来很要紧。旧版课程里我凭记忆写过一个假后端,工具事件的 args 写成了对象、error 写成了 None,界面在假后端上一切正常,接上真后端才露馅。所以这次第一轮的事件全部取自 Day 469 从真后端录的 `fixtures/run.sse`,只在它的基础上删、插、截断。

```ts
// supportpilot/web/scripts/fake_api.mts
// 假后端:路径、事件名、数据形状和真后端一样,第一轮的事件取自 Day 469 从真后端录的 fixtures/run.sse。
// 工单主题里带关键词就模拟一种不顺利的情况:慢、断线、退回、转人工、出错。不调模型、不连库、不花钱。
// 运行:npx tsx scripts/fake_api.mts   (监听 8077;WEB_ORIGIN 默认 http://localhost:3000)
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

type Ev = { event: string; data: Record<string, unknown> };
type Phase = "new" | "half" | "waiting" | "resolved" | "escalated";
type Ticket = { id: string; subject: string; phase: Phase; rest: Ev[]; after: Phase; reply: string | null; busy: number };

const REC: Ev[] = readFileSync("fixtures/run.sse", "utf8").split("\n\n").filter(Boolean).map((block) => ({
  event: /^event: (.*)$/m.exec(block)![1],
  data: JSON.parse(/^data: (.*)$/m.exec(block)![1]),
}));
const INTERRUPT = REC.find((e) => e.event === "interrupt")!.data as { draft: string; request: Record<string, unknown> };
const FINAL = INTERRUPT.draft.replace("[KB-refund-001]", " [1]")
  + "\n\n参考文章:\n[1] 退款政策总览 https://help.cloudledger.example/help/refund/001\n\n"
  + "补充:您的退款申请已审核通过,950.00 元将原路退回,到账时间以支付渠道为准。";
const HANDOFF = "您好,您的问题已经转给人工客服同事,会在 1 个工作日内通过这个工单回复您。";
const DONE: Ev = { event: "done", data: {} }; // 占位,推到它的时候才按工单当时的状态生成摘要
const RECORDED = REC.map((e) => (e.event === "done" ? DONE : e));
const node = (name: string): Ev => ({ event: "node", data: { node: name } });
const tickets = new Map<string, Ticket>();
const CORS = { "access-control-allow-origin": process.env.WEB_ORIGIN ?? "http://localhost:3000", "access-control-allow-headers": "content-type, accept" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function summary(t: Ticket) {
  const outcome = t.phase === "waiting" ? "waiting_approval" : t.phase === "resolved" || t.phase === "escalated" ? t.phase : null;
  return { ticket_id: t.id, outcome, category: "refund", reply: t.reply, turns: 1, cost_cny: 0.02598,
    waiting_on: t.phase === "waiting" ? ["approval"] : [] };
}

// 第一轮推哪些事件、推完工单处于什么阶段。默认是录音原样
function firstRun(subject: string): { evs: Ev[]; after: Phase } {
  const recorded = [...RECORDED];
  if (subject.includes("转人工")) return { evs: [...REC.slice(0, 5), node("classify"), node("handoff"), DONE], after: "escalated" };
  if (subject.includes("出错")) return { evs: [...REC.slice(0, 8), { event: "error", data: { message: "处理出错了,已经记录,请稍后重试" } }], after: "half" };
  if (subject.includes("退回")) {
    const at = recorded.findIndex((e) => e.event === "token");
    const check = { type: "step", node: "check", passed: false, problems: ["引用了不存在于资料中的编号:KB-refund-009"] };
    recorded.splice(at, 0, ...recorded.slice(at, at + 12), node("draft"), { event: "step", data: check }, node("check"));
  }
  return { evs: recorded, after: "waiting" };
}

// 一条条推事件。浏览器中途断开的话,学真后端:正在跑的节点在后台跑完,从下一个 node 事件起留给 /resume
async function streamTo(res: ServerResponse, t: Ticket, evs: Ev[], after: Phase, cutAt = -1) {
  res.writeHead(200, { ...CORS, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
  const tokenMs = t.subject.includes("慢") ? 300 : 30;
  for (let i = 0; i < evs.length; i++) {
    if (i === cutAt) res.destroy(); // 「断线」:不发 done,直接掐掉 TCP 连接
    if (res.destroyed) {
      t.phase = "half";
      t.after = after;
      t.rest = evs.slice(evs.findIndex((e, j) => j >= i && e.event === "node"));
      return;
    }
    if (evs[i] === DONE) t.phase = after;
    const e = evs[i] === DONE ? { event: "done", data: summary(t) } : evs[i];
    res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    await sleep(e.event === "token" ? tokenMs : 40);
  }
  if (after === "half") { // 「出错」:推完 error 停在半路,下次 /resume 从 act 重跑
    t.phase = "half";
    t.after = "waiting";
    t.rest = RECORDED.slice(8);
  }
  res.end();
}

function json(res: ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return res.writeHead(204, CORS).end();
  const url = req.url ?? "";
  const body = req.method === "POST" ? await readBody(req) : {};
  const [, a, id, b] = url.split("/"); // "/tickets/T000001/run" → ["", "tickets", "T000001", "run"]
  const t = id ? tickets.get(id) : undefined;

  if (req.method === "POST" && url === "/tickets") {
    const tid = `T${String(tickets.size + 1).padStart(6, "0")}`;
    tickets.set(tid, { id: tid, subject: String(body.subject ?? ""), phase: "new", rest: [], after: "new", reply: null, busy: 0 });
    return json(res, 200, { ticket_id: tid });
  }
  if (req.method === "GET" && url === "/approvals") {
    return json(res, 200, [...tickets.values()].filter((x) => x.phase === "waiting").map((x) => ({
      ...INTERRUPT.request, id: `RF-${x.id}-INV-202609-0002`, ticket_id: x.id, customer_name: "李娜",
      created_at: "2026-10-22 10:00:00", needs_finance_review: false,
    })));
  }
  if (!t) return json(res, 404, { detail: "工单不存在" });
  if (req.method === "GET" && a === "tickets" && !b) return json(res, 200, summary(t));

  if (b === "run") {
    const { evs, after } = firstRun(t.subject);
    if (after === "escalated") t.reply = HANDOFF;
    const cut = t.subject.includes("断线") ? evs.findIndex((e) => e.event === "tool") + 2 : -1; // 推完第二个工具调用就断
    if (cut > 0) t.busy = 1; // 第一次 /resume 回 409,模拟「上一次还在收尾」
    return streamTo(res, t, evs, after, cut);
  }
  if (b === "resume") {
    if (t.phase !== "half") return json(res, 409, { detail: t.phase === "waiting" ? "工单在等待审批,不需要继续" : "这一轮已经处理完了" });
    if (t.busy-- > 0) return json(res, 409, { detail: "上一次的处理还在收尾,请稍后再试" });
    return streamTo(res, t, t.rest, t.after);
  }
  if (b === "messages") {
    if (t.phase === "waiting") return json(res, 409, { detail: "工单还在等待审批,审批完成后才能继续对话" });
    t.reply = "一般 3 到 5 个工作日到账,具体以支付渠道为准。";
    return streamTo(res, t, [node("draft"), ...[...t.reply].map((c) => ({ event: "token", data: { type: "token", text: c } })), DONE], "resolved");
  }
  if (a === "approvals") {
    if (t.phase !== "waiting") return json(res, 409, { detail: "这个工单不在等待审批" });
    t.reply = FINAL;
    return streamTo(res, t, [node("approval"), node("finalize"), DONE], "resolved");
  }
  json(res, 404, { detail: "没有这个接口" });
}).listen(Number(process.env.FAKE_PORT ?? 8077), () => console.log(`fake api on :${process.env.FAKE_PORT ?? 8077}, ${REC.length} recorded events`));
```

<div class="line-notes">

- `import { createServer, type IncomingMessage, type ServerResponse } from "node:http";` Node 自带的 HTTP 服务器,不装任何依赖。`type` 前缀表示这两个只当类型用,编译后会被删掉。相当于 Python 标准库的 `http.server`。
- `type Phase = "new" | "half" | "waiting" | "resolved" | "escalated";` 假工单的五个阶段。half 就是第一步实测的「停在半路」。
- `type Ticket = { id: string; subject: string; phase: Phase; rest: Ev[]; after: Phase; reply: string | null; busy: number };` `rest` 是停在半路时还没推的事件,`after` 是这些事件推完以后工单该处于的阶段,`busy` 是接下来还要回几次「还在收尾」的 409。
- `const REC: Ev[] = readFileSync("fixtures/run.sse", "utf8").split("\n\n").filter(Boolean).map((block) => ({` 按空行切成一个个事件块。实测 77 个,和 Day 469 录的一样:59 个 token、7 个 node、5 个 step、4 个 tool、1 个 interrupt、1 个 done。
- `event: /^event: (.*)$/m.exec(block)![1],` 正则的 `m` 标志让 `^` `$` 匹配每一行的开头结尾,而不是整个字符串的。`!` 是非空断言:录音是我们自己录的,一定匹配得上。
- `const FINAL = INTERRUPT.draft.replace("[KB-refund-001]", " [1]")` 按后端 `render_sources()` 的格式手拼一个定稿,和 Day 470 第三步贴的真实定稿格式一致。
- `const DONE: Ev = { event: "done", data: {} };` 占位对象。done 里的摘要要反映推到这一刻时工单的阶段,不能提前算好。下面用 `===` 比较引用来认出它。
- `function summary(t: Ticket) {` 和真后端 `_summary()` 同样的七个字段。
- `if (subject.includes("转人工")) return { evs: [...REC.slice(0, 5), node("classify"), node("handoff"), DONE], after: "escalated" };` 录音的前 5 个事件是 load_customer、prepare_context 的 step 和 node,再加 classify 的 step;后面补上 classify 和 handoff 两个节点。
- `if (subject.includes("出错")) return { evs: [...REC.slice(0, 8), { event: "error",` 推到检索完成就推一个 error,文案和真后端 `_events` 里那句一模一样。
- `recorded.splice(at, 0, ...recorded.slice(at, at + 12), node("draft"), { event: "step", data: check }, node("check"));` 在第一个 token 前面插一段:12 个 token 的「第一版草稿」、draft 完成、check 不通过、check 完成。之后原样的 59 个 token 就是「重写的第二版」。`splice(位置, 删几个, ...插入的)` 会原地修改数组。
- `if (i === cutAt) res.destroy();` 直接销毁 socket,浏览器那边读取会抛网络错误,和真断网一样,不会收到 done。
- `if (res.destroyed) {` 浏览器主动断开(点停止)时 Node 也会把 res 标成 destroyed,两种断开走同一个分支。
- `t.rest = evs.slice(evs.findIndex((e, j) => j >= i && e.event === "node"));` 模仿真后端:正在跑的节点在后台跑完,它中间的 token 和 tool 事件丢了,`/resume` 从「这个节点完成」的 node 事件开始补。第二步 curl 的真实输出就是这样,第一条是 `node: act`。
- `if (evs[i] === DONE) t.phase = after;` 推 done 之前先改阶段,摘要里的 outcome 才对。
- `await sleep(e.event === "token" ? tokenMs : 40);` token 之间隔 30 毫秒,主题里有「慢」就隔 300 毫秒,留时间点停止。
- `if (after === "half") {` 只有「出错」会走到这里:流推完了,工单停在半路,`/resume` 时从录音的第 9 个事件(act 的第一个工具调用)开始,模拟「出错的节点重跑」。
- `const [, a, id, b] = url.split("/");` 数组解构跳过第一项(开头的空字符串)。`/approvals/T000001` 切出来 a 是 approvals、id 是 T000001、b 是 undefined。
- `const tid = `T${String(tickets.size + 1).padStart(6, "0")}`;` 工单号 T000001 起,和真后端同样的格式。
- `return json(res, 200, [...tickets.values()].filter((x) => x.phase === "waiting").map((x) => ({` 待审批列表从工单的阶段算出来,通过以后自然就消失了。
- `if (t.busy-- > 0) return json(res, 409,` 后置自减:先拿 busy 原值比较,再减一。断线的工单第一次 resume 回 409,第二次放行,用来测前端的重试。

</div>

起假后端,再把前端指过去:

```bash
# 终端一,在 web/ 目录
WEB_ORIGIN=http://localhost:3471 npx tsx scripts/fake_api.mts
# 终端二,在 web/ 目录
NEXT_PUBLIC_SUPPORTPILOT_API=http://localhost:8077 npx next dev -p 3471
```

第一个终端打印 `fake api on :8077, 77 recorded events`。打开 `http://localhost:3471`,把主题改成「想退款 断线」「想退款 慢」之类,逐个试。我用无头浏览器把五种情况各跑了一遍,读出状态行每次变化的时间和文字(这一步只是为了记准时间,你直接看浏览器就行,Day 472 会正式写 Playwright 测试):

| 主题里的关键词 | 状态行的变化 | 结果 |
| --- | --- | --- |
| 断线 | 0.39s 处理中 → 0.80s 正在接回进度 → 1.81s 处理中 → 3.84s 已提交审批 | 7 个步骤都在;工具卡片只有 2 张;草稿完整,和 interrupt 里的一致 |
| 慢 | 0.39s 处理中 → 2.15s 已停止接收(我按的停止) | 草稿前面写「没写完的草稿:」,下面出现「继续处理」 |
| 退回 | 0.22s 处理中 → 3.24s 已提交审批 | 步骤里起草回复、质检各出现两次 |
| 转人工 | 0.29s 处理中 → 0.56s 已转人工客服 | 没有工具卡片,正文是转人工那句固定回复 |
| 出错 | 0.24s 处理中 → 0.56s 出错了 | 红字「处理出错了,已经记录,请稍后重试」 |

「断线」这一行要细看。0.80 秒断开,状态变成「正在接回进度」;第一次 resume 碰上 409,1 秒后第二次成功,1.81 秒回到「处理中」,最后正常停在审批。工具卡片只有 2 张:断开时后两次工具调用的事件丢了,接着跑的流从 `node: act` 开始,不会补发。客户看到的工具卡片少了两张,这是我们这种「接着跑」方案的代价。要不丢,后端得把每个事件存下来,重连时带上 `Last-Event-ID`,从断开的那一条接着推,SSE 规范里本来就有这个字段,`EventSource` 断线重连时会自动带上。代价是后端要存事件、要编号、要设过期时间,我们现在不做。草稿是完整的,靠的就是 reducer 里 interrupt 那一行。

「慢」这一行停止以后,按「继续处理」,0.3 秒后进入「正在接回进度」,又过 0.2 秒停在审批,草稿换成了完整版。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11rp96WERp&autoplay=0&high_quality=1" title="SSE弱网下怎么兜底断线续传？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>前端面试攻城狮 · SSE 弱网下怎么兜底断线续传?· 6 分钟,2026 年。面试题的讲法:「加个重连」不够,用户已经看到一半内容时,重连是从头生成还是接着推。和我们「先查进度再接着跑」对照着看,它讲的是事件编号续传那条路。</figcaption>
</figure>

## 第五步:真后端上掐一次进程

假后端测的是前端逻辑,真后端还要再验一次。最狠的断线是后端进程直接没了:部署时重启、内存爆了被杀。我用无头浏览器在客户页面提交李娜的退款单,看到第一张工具卡片时 `kill -9` 掉 uvicorn,2.6 秒后重新启动它。

浏览器里状态行的变化:

```text
0.3s   处理中
3.7s   正在接回进度
20.2s  处理中
26.1s  已提交审批,等客服处理 · 花费 ¥0.02591
```

前端一直在重试,我这台 2019 年的 Intel MacBook 上 uvicorn 冷启动加连库要十几秒,第五次(等了 8 秒的那次)才连上。工具卡片是这样的:

```text
list_subscriptions, list_invoices, list_subscriptions, list_invoices, check_refund_eligibility, create_refund_request
```

前两张出现了两次。和第一步不一样:进程被杀,后台没有谁替 act 跑完,checkpoint 停在「act 还没开始」,接着跑时 act 从头再来,工具重新调一遍。查订阅、查账单是只读的,调两遍没关系;建退款申请那一次如果在被杀之前就执行过,幂等键会让第二次什么都不插。这次我杀得早,第一个 act 还没走到建申请,库里只有一条 pending 申请。

被杀的那个 act 已经调过两次模型,那部分钱跟着进程一起没了,checkpoint 里记的 0.02591 元比实际花的少。成本账本如果只信 checkpoint,就会少算。Day 485 做账本时会单独记每一次模型调用,不靠图的状态。

## 第六步:可访问性

流式界面对读屏软件很不友好。读屏软件(screen reader)是视障用户用的软件,把屏幕上的内容念出来,macOS 自带 VoiceOver(Cmd+F5 开关),Windows 上常用免费的 NVDA。Day 470 已经按下面几条写好了,今天解释为什么,并实测两个数字。

**只让状态行播报。** `aria-live="polite"` 告诉读屏软件「这块内容变了要念出来,等用户空闲时念」。最常见的错误是把逐字输出的正文设成 aria-live,一句话会被拆成几十次播报。把下面这段粘到 DevTools 的 Console 里,再点「提交工单」,跑完后输入 `liveLog` 和 `bodyChanges` 看:

```js
// 粘进 DevTools Console,然后点「提交工单」。跑完后输入 liveLog 和 bodyChanges 查看
window.liveLog = []; window.bodyChanges = 0; const t0 = performance.now();
new MutationObserver(() => {
  const h = document.getElementById("current-status")?.textContent ?? "";
  if (h && liveLog.at(-1)?.text !== h) liveLog.push({ t: Math.round(performance.now() - t0), text: h });
  if (document.querySelector("section.run .reply-body")) bodyChanges++;
}).observe(document.body, { subtree: true, childList: true, characterData: true });
```

<div class="line-notes">

- `window.liveLog = []; window.bodyChanges = 0;` 挂到 window 上,跑完以后在 Console 里直接输入名字就能看。
- `new MutationObserver(() => {` 浏览器自带的 DOM 变化监听器,页面上任何节点增删、文字变化都会触发回调。
- `const h = document.getElementById("current-status")?.textContent ?? "";` 当前这一轮的状态行,id 是 Day 470 拼的 `current-status`,只有它是 aria-live。
- `if (h && liveLog.at(-1)?.text !== h) liveLog.push(` 文字和上一次不一样才记,这就是读屏软件会念的那几次。`at(-1)` 取数组最后一个元素。
- `if (document.querySelector("section.run .reply-body")) bodyChanges++;` 正文存在期间,DOM 每变一次计一次,近似于「如果正文是 aria-live 会被播报几次」。
- `.observe(document.body, { subtree: true, childList: true, characterData: true });` 监听整个 body 的子树:子节点增删和文本内容变化。

</div>

在假后端上跑默认的退款单,实测 `liveLog` 只有两条:365 毫秒「处理中」,2900 毫秒「已提交审批,等客服处理 · 花费 ¥0.02598」。`bodyChanges` 是 63,正文在这 2.5 秒里变了 63 次。状态行念两次,用户就知道发生了什么;正文要是念 63 次,根本听不下去。

**跑的时候把打字机藏起来。** 正文在 running 时 `aria-hidden="true"`,跑完再露出来。用 Playwright 的 `ariaSnapshot()` 打出可访问性树,也就是读屏软件「看到」的页面结构。跑到一半时:

```text
- region "处理中":
  - heading "处理中" [level=3]
  - button "停止"
  - list:
    - listitem: 查客户档案 · 找到客户 · 有画像
    - listitem: 整理上下文
    - listitem: 分诊 · 分类:refund
    - listitem: 检索帮助中心 · 命中 3 篇:KB-refund-001、KB-refund-003、KB-plans-002
    - listitem: 查业务数据
    - listitem: …
  - list:
    - listitem:
      - code: list_subscriptions
      - text: 查询
      - group: 参数
    ……(另外三张卡片)
```

停在审批以后,树的末尾多了两段:

```text
  - paragraph: 退款申请 RF-T000153-INV-202609-0002(¥950)已提交审批
  - paragraph: 草稿,审批后定稿:您好，您的Pro年付订阅属于首次购买，目前在第7天，符合14天内无理由全额退款的条件[KB-refund-001]。……
```

几个细节都对上了:section 用 `aria-labelledby` 指向状态行,所以整块被识别成一个名字叫「处理中」的 region(区域);✓ 是 `aria-hidden` 的,不会被念成「对勾」;跑的时候没有正文段落,停下以后才有。

**焦点不能丢。** 这是今天真找到的一个问题。键盘用户(读屏用户基本都用键盘)Tab 到「停止」按回车,停止按钮随着状态变成 stopped 被卸载了,焦点去哪了?我用无头浏览器读 `document.activeElement`,结果是 `BODY`。焦点掉回了页面最开头,读屏用户要从头 Tab 一遍才能回到刚才的位置,而且不知道「继续处理」按钮出现了。

修法是在 RunView 里,状态变成 stopped 时把焦点交给「继续处理」:

```tsx
// supportpilot/web/src/components/RunView.tsx(import 加 useEffect, useRef;函数开头加这几行)
import { useEffect, useRef } from "react";

export function RunView({ state, id, onStop, onResume }: Props) {
  const resumeRef = useRef<HTMLButtonElement>(null);
  // Day 471:点了「停止」,停止按钮就消失了,键盘焦点会掉回 <body>。把焦点交给「继续处理」
  useEffect(() => {
    if (state.status === "stopped") resumeRef.current?.focus();
  }, [state.status]);

  if (state.status === "idle") return null;

// 「继续处理」按钮加上 ref
          {onResume && <button ref={resumeRef} type="button" className="link" onClick={onResume}>继续处理</button>}
```

<div class="line-notes">

- `const resumeRef = useRef<HTMLButtonElement>(null);` 拿到按钮的 DOM 节点。
- `useEffect(() => {` 必须写在 `if (state.status === "idle") return null;` 前面。hook 的调用次数每次渲染必须一样,写在提前 return 后面,idle 时少调一次,React 会报「Rendered more hooks than during the previous render」。
- `if (state.status === "stopped") resumeRef.current?.focus();` effect 在 DOM 更新之后执行,这时「继续处理」已经渲染出来了。`?.` 防止没传 onResume、按钮不存在的情况。
- `}, [state.status]);` 只在状态变化时执行,不是每次渲染都抢焦点。

</div>

改完再测,`document.activeElement` 是「继续处理」那个 BUTTON。再按一次回车,就接着跑了。

剩下几条 Day 470 已经做了,这里列一下来由:错误用 `role="alert"`,一出现就打断当前播报念出来;所有按钮和输入框有 `:focus-visible` 的焦点框;追问输入框有一个视觉隐藏、读屏读得到的 `<label>`;系统设置里开了「减少动态效果」时,打字机光标不闪。

我没用 VoiceOver 真听一遍,上面的结论来自可访问性树和 DOM 变化计数。你有空开 VoiceOver 听一次,体会会更直接。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Z3411J7ws&autoplay=0&high_quality=1" title="盲人怎么玩电脑？NVDA屏幕阅读器的安装及简单设置。" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>暗密 · 盲人怎么玩电脑?NVDA 屏幕阅读器的安装及简单设置 · 43 分钟。视障 UP 主自己演示怎么用读屏软件上网。看前 10 分钟就够,听听读屏软件念一个页面有多快、多依赖标题和按钮名,就明白为什么逐字播报不行、焦点丢了有多麻烦。</figcaption>
</figure>

## 零件和大代码的对照

| 零件 | 文件 | 作用 |
| --- | --- | --- |
| `stop_probe.mts` | `web/scripts/` | 实测停止以后后端在干什么 |
| `resumable`、`/resume`、`RUNNING`、`stream.close()` | `src/supportpilot/api/app.py` | 从 checkpoint 接着跑,上一次没收尾就 409 |
| `test_resume.py` | `tests/` | 断开、被挡、接着跑、act 不重跑 |
| `reconnecting`、`resume`、interrupt 带草稿 | `web/src/lib/run.ts` | 重连状态、不重置地接着跑 |
| `pump`、`recover`、`RETRY_MS` | `web/src/lib/useRun.ts` | 分清停止和断线,断线先查进度再接着跑 |
| `resumeTicket`、`Recover`、`recoverFor` | `web/src/lib/api.ts` | 补救办法打包传给 useRun |
| 停止说明、继续处理、焦点 | `web/src/components/RunView.tsx` | 告诉用户停止的真实含义,焦点不丢 |
| `fake_api.mts` | `web/scripts/` | 不花钱模拟五种情况 |

## 动手练习

### 练习 1:出错以后给一个「重试」

假后端主题带「出错」时,界面停在「出错了」。真后端出错时(比如模型接口 502),checkpoint 停在出错的那个节点前面,用 `/resume` 就能从那里重跑。给 RunView 的错误提示后面加一个「重试」按钮;再写一个后端测试,证明出错后 resume 会从出错的节点接着跑。

<details><summary>参考答案</summary>

RunView 里错误那一段换成:

```tsx
// supportpilot/web/src/components/RunView.tsx(错误提示那一段换成)
      {state.error && (
        <p className="error" role="alert">
          {state.error}
          {state.status === "error" && onResume && (
            <> <button type="button" className="link" onClick={onResume}>重试</button></>
          )}
        </p>
      )}
```

<div class="line-notes">

- `{state.status === "error" && onResume && (` 只有 status 是 error 才给重试。`fail` 动作也会设 error,比如「重试几次都没接上」,那时候再点重试走的是同一套 recover,也没问题。
- `<> <button` `<>` 是 Fragment,里面先放一个空格,让按钮和错误文字之间隔开。

</div>

客户页面已经传了 `onResume`,不用改。在假后端上实测:提交「想退款 出错」,状态行「出错了」,红字是「处理出错了,已经记录,请稍后重试 重试」;点重试以后停在「已提交审批,等客服处理 · 花费 ¥0.02598」,工具卡片 4 张,步骤 7 个。

后端测试加在 `tests/test_resume.py` 末尾:

```python
# supportpilot/tests/test_resume.py(末尾新增)
@pytest.mark.db
def test_retry_after_error(client):
    """练习 1:模型接口出错推了 error,修好以后 /resume 从出错的节点重跑。"""
    from fakes import FakeLLM, FakeTools, make_deps
    from test_graph_smoke import ACT, DRAFT, LINA, REFUND_TRIAGE

    class Broken(FakeLLM):
        def structured(self, *a, **kw):
            raise RuntimeError("模型接口 502")

    good = api.R["deps"]
    api.R["deps"] = make_deps(Broken(REFUND_TRIAGE, ACT, DRAFT), FakeTools(customer=LINA))
    tid = client.post("/tickets", json={"customer_email": "lina@example.com", "subject": "api-test",
                                        "body": "退款"}).json()["ticket_id"]
    assert parse_sse(client.post(f"/tickets/{tid}/run").text)[-1][0] == "error"
    assert client.get(f"/tickets/{tid}").json()["waiting_on"] == ["classify"]   # 停在出错的节点前面

    api.R["deps"] = good  # 「模型接口恢复了」
    ev = parse_sse(client.post(f"/tickets/{tid}/resume").text)
    assert [d["node"] for e, d in ev if e == "node"][0] == "classify"
    assert ev[-1][1]["outcome"] == "waiting_approval"
```

<div class="line-notes">

- `class Broken(FakeLLM):` 和 Day 467 的 `test_failure_becomes_error_event` 一样:`structured` 一调就抛错。classify 节点第一个用到它。
- `good = api.R["deps"]` 先把正常的假零件存起来,一会儿换回去。
- `assert client.get(f"/tickets/{tid}").json()["waiting_on"] == ["classify"]` 出错的节点没有完成,checkpoint 的 next 还是它。outcome 是 None,所以 `resumable` 放行。
- `api.R["deps"] = good` `get_graph` 每次请求都从 `R["deps"]` 现编译图,换掉以后下一个请求就用正常的零件。
- `assert [d["node"] for e, d in ev if e == "node"][0] == "classify"` 接着跑的第一个完成的节点是 classify,说明是从出错的地方重跑,不是从头。

</div>

```bash
uv run pytest tests/test_resume.py -q
```

真实结果 `2 passed`。

</details>

### 练习 2:不开浏览器检查 reducer 的接着跑

写一个 Node 脚本,用录好的 `fixtures/run.sse` 模拟:草稿打到第 20 个 token 时断开 → reconnecting → resume → 从 draft 节点完成那一刻起把剩下的事件喂进去。打印断开前后的步骤数、工具数、草稿字数,确认草稿和 interrupt 里的一致。再把 `resume` 换成 `start` 跑一次,看看会怎样。

<details><summary>参考答案</summary>

```ts
// supportpilot/web/scripts/check_resume.mts
// 练习 2:不开浏览器,用录好的真流检查 reducer 在「断线 → 接回 → 接着跑」时的行为。
// 运行:npx tsx scripts/check_resume.mts
import { readFileSync } from "node:fs";
import type { AgentEvent } from "../src/lib/events.ts";
import { initial, reducer, type RunState } from "../src/lib/run.ts";

const events: AgentEvent[] = readFileSync("fixtures/run.sse", "utf8").split("\n\n").filter(Boolean).map((b) => ({
  event: /^event: (.*)$/m.exec(b)![1],
  data: JSON.parse(/^data: (.*)$/m.exec(b)![1]),
}) as AgentEvent);

const cut = events.findIndex((e) => e.event === "token") + 20; // 草稿打到第 20 个 token 时断
const resumeAt = events.findIndex((e) => e.event === "node" && e.data.node === "draft");
let s: RunState = reducer(initial, { type: "start" });
for (const e of events.slice(0, cut)) s = reducer(s, { type: "event", e });
const before = { steps: s.steps.length, tools: s.tools.length, draft: s.draft.length };

s = reducer(s, { type: "reconnecting" });
const during = s.status;
s = reducer(s, { type: "resume" });
for (const e of events.slice(resumeAt)) s = reducer(s, { type: "event", e }); // 接着跑:从 draft 节点完成那一刻起

console.log("断开前", before, "断开时 status =", during);
console.log("接回后", { status: s.status, steps: s.steps.length, tools: s.tools.length, draft: s.draft.length });
console.log("草稿和 interrupt 里的一样:", s.draft === (events.find((e) => e.event === "interrupt")!.data as { draft: string }).draft);
```

<div class="line-notes">

- `}) as AgentEvent);` 读出来的是普通对象,断言成 AgentEvent,后面才能传给 reducer。
- `const cut = events.findIndex((e) => e.event === "token") + 20;` 第一个 token 的下标加 20,也就是第 20 个 token 之后断开。
- `const resumeAt = events.findIndex((e) => e.event === "node" && e.data.node === "draft");` 真后端接着跑时,第一条是「断开时正在跑的节点完成了」,这里就是 draft。
- `for (const e of events.slice(0, cut)) s = reducer(s, { type: "event", e });` reducer 是纯函数,在 Node 里一个个喂就行,不需要 React。
- `s = reducer(s, { type: "resume" });` 关键的一行。
- `s.draft === (events.find((e) => e.event === "interrupt")!.data as { draft: string }).draft` 用 interrupt 里的完整草稿做对照。

</div>

```bash
npx tsx scripts/check_resume.mts
```

真实输出:

```text
断开前 { steps: 5, tools: 4, draft: 33 } 断开时 status = reconnecting
接回后 { status: 'waiting_approval', steps: 7, tools: 4, draft: 107 }
草稿和 interrupt 里的一样: true
```

断开时草稿只有 33 个字,接回以后是 107 个字的完整版,步骤从 5 个长到 7 个,4 张工具卡片都在。

把 `{ type: "resume" }` 换成 `{ type: "start" }` 再跑:

```text
断开前 { steps: 5, tools: 4, draft: 33 } 断开时 status = reconnecting
接回后 { status: 'waiting_approval', steps: 2, tools: 0, draft: 107 }
草稿和 interrupt 里的一样: true
```

步骤只剩 2 个(draft、check),工具卡片全没了。start 会把状态重置成初始值,接着跑的流只有后半段,前半段就丢了。所以要单独一个 resume 动作。

我还试了把 reducer 里 interrupt 那一行改回 Day 469 的写法(不带 draft),接回后草稿停在 33 个字,和 interrupt 里的不一样(false)。

</details>

### 练习 3:断在打字机中间

给假后端加一个关键词「断在草稿」:草稿打到第 20 个 token 时掐断连接。在浏览器里提交,记下断开那一刻正文显示什么,接回以后又显示什么。

<details><summary>参考答案</summary>

`fake_api.mts` 里算 cut 的那一行换成:

```ts
// supportpilot/web/scripts/fake_api.mts(b === "run" 分支里 cut 那一行换成)
    const cut = t.subject.includes("断在草稿") ? evs.findIndex((e) => e.event === "token") + 20 // 练习 3:草稿打到第 20 个 token 时断
      : t.subject.includes("断线") ? evs.findIndex((e) => e.event === "tool") + 2 : -1; // 推完第二个工具调用就断
```

<div class="line-notes">

- `t.subject.includes("断在草稿") ?` 先判断更具体的关键词。反过来写的话,「断在草稿」里没有「断线」两个字,其实也不冲突,但习惯上具体的放前面。
- `: t.subject.includes("断线") ?` 三元表达式可以链着写,读起来像 if / else if / else。

</div>

重启假后端,提交「想退款 断在草稿」。我用无头浏览器读到的:状态行变成「正在接回进度」的那一刻,正文是

```text
没写完的草稿:您好，您的Pro年付订阅属于首次购买，目前在第7天，符合14天内无
```

一共 40 个字(含前面 7 个字的提示)。接回以后状态行是「已提交审批,等客服处理 · 花费 ¥0.02598」,正文 116 个字,前面的提示变回「草稿,审批后定稿:」,步骤 7 个。断开期间的 token 永远收不到了,是 interrupt 里的完整草稿把它补齐的。

</details>

验收标准:`uv run pytest -q -m "not llm"` 是 64 个通过(含练习 1 的测试);`npx tsc --noEmit -p .` 0 报错;假后端上五个关键词各试一次,结果和第四步的表一致;用键盘停止后焦点落在「继续处理」上;真后端上至少跑一次 `stop_probe.mts`,亲眼看到断开后花费还在涨。今天真模型花费:读者照做大约 0.1 元(stop_probe 一次约 0.026 元、resume_now 三次约 0.08 元)。我反复试了二十来张工单,按每张 0.02 到 0.035 元估,合计 0.5 元左右。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| AbortController | 浏览器和 Node 自带的取消开关。把它的 signal 交给 fetch,调 abort() 时请求被放弃,读取抛 AbortError。只管客户端这一头。 |
| AbortError | abort 以后 fetch 抛出的错误的名字(`err.name`)。用它或 `signal.aborted` 区分「用户停了」和「网络断了」。 |
| 停止 ≠ 撤销 | 断开连接只是不再接收,后端正在跑的节点会跑完,已经执行的工具调用不会回滚。例:停在 act 之后,退款申请已经建了。 |
| 断点续跑(resume) | 从最后一个 checkpoint 接着跑,不从头开始。LangGraph 里对同一个 thread_id 调 `stream(None, cfg)`。 |
| 待写入(pending writes) | 节点跑完但下一个 checkpoint 还没生成时,LangGraph 先把节点结果单独存下。接着跑时直接用,节点不重跑。 |
| 退避(backoff) | 重试之间等待的时间越来越长,例:0、1、2、4、8 秒。避免服务刚恢复就被大量重试打垮。 |
| Last-Event-ID | SSE 规范里的请求头。服务端给每个事件编号,客户端重连时带上最后收到的编号,服务端从下一条接着推。我们没做。 |
| 假后端(mock server) | 路径和数据形状和真后端一样、内容写死的服务器,用来不花钱地调界面。数据要从真后端录。 |
| 读屏软件(screen reader) | 把屏幕内容念出来的软件,视障用户用。macOS 的 VoiceOver、Windows 的 NVDA。 |
| 可访问性树(accessibility tree) | 浏览器从 DOM 算出来给读屏软件用的结构,只有角色、名字、状态。`aria-hidden` 的节点不在里面。 |
| aria-busy | 告诉辅助技术「这块内容还在变」。 |
| 焦点管理 | 界面变化时把键盘焦点放到合理的位置。例:停止按钮消失后,焦点交给「继续处理」。 |
| MutationObserver | 浏览器自带的 DOM 变化监听器,节点增删和文字变化都会触发回调。 |

## 常见误区

**以为点了停止,后端就停了。** 第一步实测,断开后 act 在后台又跑了 3 秒,建了退款申请、发了通知、花了 2 分钱。停止只是不再接收。

**以为停止能当撤销用。** 已经执行的工具调用不会回滚。要撤销,后端得有作废的接口和规则。

**断开以后立刻从头重跑,或者立刻 resume。** 后台那个节点还在跑,两个 act 同时调工具,实测三张工单三次都造出了批不了的孤儿退款。先挡住「还在收尾」的工单。

**在 finally 里先放锁、后关 LangGraph 的流。** Python 关生成器时我们的 finally 先执行,LangGraph 的流后关,中间有几秒空档。要在 finally 里先 `stream.close()`。

**用进程内的集合当锁,然后起了多个 worker。** 每个进程各有一份,挡不住落到别的进程上的请求。多进程要用数据库锁或 Redis。

**只处理抛错,不处理「流正常结束但没有 done」。** 被代理干净地关掉时 for await 正常退出,界面会永远停在「处理中」。

**接着跑时用 start 重置状态。** 练习 2 实测,步骤只剩 2 个,工具卡片全没了。

**重连时每秒打一次。** 后端刚恢复就被一起涌来的重试打垮。用退避。

**状态先改成「处理中」再发请求。** 撞上 409 又改回去,状态行闪一下,读屏软件念两遍。第一个事件到了再改。

**假后端凭记忆写。** 字段类型错了界面也照常工作,接真后端才露馅。从真后端录。

**把逐字输出的正文设成 aria-live。** 实测正文变了 63 次,状态行只变 2 次。

**按钮消失时不管焦点。** 实测停止后焦点掉回 BODY。

**useEffect 写在提前 return 后面。** hook 每次渲染的调用次数必须一样。

## 学习资料

### 文档与文章

- [MDN · AbortController](https://developer.mozilla.org/zh-CN/docs/Web/API/AbortController):中文,一页,看 abort() 和 signal 的例子。
- [MDN · 使用服务器发送事件](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events/Using_server-sent_events):中文,看事件的 id 字段和断线重连那几段,理解 Last-Event-ID 是怎么来的。
- [HTML 规范 · Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html):英文原始规范,查 `Last-Event-ID` 和 `retry` 字段的准确定义。
- [LangGraph · Durable execution](https://docs.langchain.com/oss/python/langgraph/durable-execution):官方讲持久执行和「从中断处恢复」,包括为什么有副作用的操作要放进 task 或做成幂等。英文。
- [MDN · ARIA live regions](https://developer.mozilla.org/zh-CN/docs/Web/Accessibility/ARIA/Guides/Live_regions):polite 和 assertive 的区别、role="alert" 的用法。
- [MDN · aria-busy](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-busy):英文,一页。
- [W3C · Developing a Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/):W3C 官方的键盘交互指南,讲焦点该怎么移动、什么时候该主动设置焦点。英文。

### B 站视频

- 前端面试攻城狮《SSE 弱网下怎么兜底断线续传?》:上面嵌入的那个。
- 暗密《盲人怎么玩电脑?NVDA 屏幕阅读器的安装及简单设置》:上面嵌入的那个。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1KvgD6mEdU&autoplay=0&high_quality=1" title="AI项目，SSE流式长链接频繁断连怎么处理" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>巧克力不爱猫 · AI 项目,SSE 流式长链接频繁断连怎么处理 · 3 分钟,2026 年。短,讲 AI 项目里流式连接为什么老断(代理超时、负载均衡、网络切换),和我们第三步「正常结束却没有 done」那种情况对上。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BeZfiCPhZbI" title="I Cannot Believe Abort Controller Can Do This" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Web Dev Simplified · I Cannot Believe Abort Controller Can Do This · AbortController 除了取消 fetch 还能干什么,讲得很快。英文,开字幕。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/EGFUQ2ypnrE" title="Announce Content Changes with ARIA Live Regions" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Ross Robino · Announce Content Changes with ARIA Live Regions · 用读屏软件实际演示 live region 的播报效果,能直接听到 polite 是怎么等用户空闲再念的。英文。</figcaption>
</figure>

### 书籍

- Heydon Pickering《Inclusive Components》(Smashing Magazine,2019):一章一个常见组件,讲怎么做成读屏和键盘都能用的版本,其中 notifications 一章讲 live region,和今天的状态行是一回事。英文,没查到中译本。

### 开源项目与代码

- [Azure/fetch-event-source](https://github.com/Azure/fetch-event-source):微软开源的「能发 POST 的 EventSource」,自带断线重试和 Last-Event-ID,看它的重试和 onerror 是怎么设计的,和我们手写的 recover 对照。
- [mswjs/msw](https://github.com/mswjs/msw):前端圈最常用的假后端工具,在 Service Worker 里拦截请求返回假数据,不用另起服务。我们今天的假后端是独立进程,好处是 curl 也能打。
- [NVDA](https://www.nvaccess.org/download/):Windows 上免费的读屏软件,想认真做可访问性可以装一个试试。

## 自测

1. 浏览器断开一个正在跑 act 节点的 SSE 流,后端会发生什么?怎么用脚本证明?

<details><summary>答案</summary>

act 节点在后台跑完(工具都调了、钱花了、申请建了、通知发了),结果存进 checkpoint,之后的节点不再跑,工单停在半路:outcome 是 null,waiting_on 从 `["act"]` 变成 `[]`。证明办法是第一步的 stop_probe:收到第一个 tool 事件就 abort,然后隔几秒 GET,看到 waiting_on 和花费在断开后还在变,后端终端打印了审批通知。

</details>

2. `/resume` 为什么要挡住「上一次还在收尾」的工单?不挡会怎样?

<details><summary>答案</summary>

后台那个节点还在跑,checkpoint 里还没有它的结果。resume 读到的是「act 还没开始」,于是又起一个 act,两个同时调工具。实测三张工单都出了问题:后到的 act 建申请时撞上已有申请、查资格失败,状态里 refund_request 是 None,图不走审批,告诉客户已完成或转人工,而库里留着一条批不了的 pending 申请。

</details>

3. 「我第一版在 finally 里 discard,还是有一次 act 被重跑了」,为什么?怎么改?

<details><summary>答案</summary>

浏览器断开后 Python 关掉 `_events` 生成器,我们的 finally 先执行,把工单从 RUNNING 里拿掉;然后 for 循环用的 `graph.stream()` 生成器才被关掉,它要等正在跑的节点结束才返回。这几秒空档里 resume 被放行了。改法:把 `graph.stream()` 存到变量里,finally 里先 `stream.close()`(等节点跑完、结果存好),再 discard。

</details>

4. 前端怎么区分「用户点了停止」和「网络断了」?「流正常结束了」就一定没事吗?

<details><summary>答案</summary>

看 `signal.aborted`:用户点停止时我们调了 abort(),它是 true;网络断了它是 false,抛的是 TypeError。流正常结束也不一定没事:如果一直没收到 done 或 error,说明是被代理或服务器提前关掉了,也要当断线处理,否则界面永远停在「处理中」。

</details>

5. 面试题:你的 Agent 流式界面,网络断了怎么办?断开期间的事件丢了吗?

<details><summary>答案</summary>

示范回答:后端用 LangGraph,每个节点跑完都存 checkpoint。浏览器断开后,正在跑的节点会在后台跑完,之后停下。前端区分停止和断线:断线就进补救流程,按 0、1、2、4、8 秒退避重试,每次先 GET 工单摘要,已经有结局就直接显示,没有就调 `/resume` 从 checkpoint 接着跑。后端用一个「正在跑」的集合挡住上一次还没收尾的工单,返回 409,前端等一会儿再试,避免同一个节点被两个请求同时跑。有副作用的工具都有幂等键。断开期间的事件确实丢了,比如中间几张工具卡片,但最后的结局和完整草稿不会丢,因为 interrupt 和 done 里带着权威数据。要做到一条不丢,得给事件编号、存下来,重连时带 Last-Event-ID 补推,我们评估过,演示项目里不值得。另外这个集合只在单进程有效,多 worker 要换成数据库锁。

</details>

6. 为什么只让状态行 aria-live,而不是正文?你怎么验证的?

<details><summary>答案</summary>

正文在流式输出时每来一个 token 就变一次,设成 aria-live 会被拆成几十次播报,用户听不下去。状态行只在几个关键时刻变化。验证:用 MutationObserver 计数,实测一次退款运行里状态行变了 2 次,正文变了 63 次;再用可访问性树确认跑的时候正文是 aria-hidden 的,不在树里。

</details>

## 明天预告

明天是 [Day 472](/blog/agent-zero/day-472-ui-audience/),界面(五):三种用户三种信息密度,测试整条链路。到今天,两个页面把所有东西都摊开了:工具参数、检索到的文章编号、质检意见、花费。客户需要看这些吗?财务批钱之前又缺了什么(Day 470 提过,审批人看不到要发给客户的草稿)?明天按客户、客服、财务三种人重新分配信息,再用 Playwright 把今天的假后端接上,写一组端到端测试,把五种情况都变成能自动跑的检查。
