---
title: 'Day 475 · 第 68 周复习:毕业项目(Day 469–474)'
description: '这一周 SupportPilot 的浏览器一侧从零搭完:读流和 reducer、组件、停止和断线、按人裁剪加 Playwright,最后换成全 TypeScript 写了一遍。今天画出六天的地图,默写 reducer 和 for_customer,再写一个小项目把后端的两份事件流(客服版、客户版)原样喂给前端。拼起来发现两件各天单看都没问题的事:客户的浏览器在质检之前就收到了整份草稿,包括被退回的那版「已为您退款」;客户版的 interrupt 事件没有 draft,reducer 把草稿覆盖成了 undefined。'
pubDate: 2026-10-27
regime: none
tags: ['review', 'typescript', 'react', 'playwright', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 475
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 474](/blog/agent-zero/day-474-ts-agents-2/) 用 `useChat` 把工具调用和审批画成卡片,在真浏览器里用真模型点了批准和取消,故意去掉 `sendAutomaticallyWhen` 看按钮为什么没反应;然后用 Mastra 把同一个 Agent 写了一遍,踩到模型配置类型、`requireToolApproval` 一刀切、没有存储就恢复不了审批三个坑;最后拿两天的实测数字回答「Python 后端还是全 TypeScript」。

这一周正好六天。Day 469 到 472 是 SupportPilot 自己的前端:读流、组件、停止和断线、按人裁剪和端到端测试。Day 473、474 是另一条路,同一个业务全用 TypeScript 写。从明天(Day 476)开始进入评测,评测要把 Agent 从头到尾跑一遍,前端是不是漏了什么、后端发出去的东西对不对,最好今天先过一遍,不然评测分数里会混进「界面的问题」。

## 今天要解决的问题

复习日不学新东西,目标是确认这一周的东西真的长在你手上了。今天结束时你应该能:

1. 不看文章,说出一个事件从后端的 `_events` 出来,到客户屏幕上的一行字,中间经过哪几站,每一站守着什么;说出 Day 473、474 的全 TS 方案在这条链上替你省了哪几站。
2. 默写 `reducer` 和 `for_customer` 两段核心代码,用本周小项目里的检查证明写对了。
3. 跑通本周小项目 `web/scripts/week68.mts`:一个本地小服务把「客服版」「客户版」两份事件流原样推出来,前端用真的 `streamEvents` 读、真的 `reducer` 折叠,12 条检查。
4. 复现并修好两个「拼起来才出现」的问题:客户的事件流里有整份草稿(包括被质检退回的那一版);客户版的 `interrupt` 没有 `draft`,`reducer` 把草稿覆盖成了 `undefined`。

预计用时 3.5 小时(大头在默写和练习)。前置:[Day 469](/blog/agent-zero/day-469-ui-stream/) 到 [Day 474](/blog/agent-zero/day-474-ts-agents-2/) 全部。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `reducer` 和 `for_customer` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="本周知识地图:上排是一个事件的旅程,后端出口按人裁剪、streamEvents 读流、reducer 折叠成状态、RunView 渲染;中间一条是 Day 471 的停止和断线重连,覆盖读流和 reducer;再下面是 Day 472 的 Playwright 端到端测试,覆盖整条链;最下面是 Day 473 和 474 的全 TypeScript 路线,右边虚线框是今天拼起来发现的两件事">
  <rect x="0" y="0" width="640" height="340" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="24" fill="var(--ink)">一个事件的旅程(Day 469–472)</text>
    <rect x="20" y="34" width="135" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="32" y="54" fill="var(--ink)">后端出口</text>
    <text x="32" y="72" fill="var(--ink-soft)">472 for_customer</text>
    <text x="32" y="89" fill="var(--ink-soft)">白名单,默认不给</text>
    <rect x="178" y="34" width="135" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="190" y="54" fill="var(--ink)">读流 streamEvents</text>
    <text x="190" y="72" fill="var(--ink-soft)">469 POST + fetch</text>
    <text x="190" y="89" fill="var(--ink-soft)">TextDecoderStream</text>
    <rect x="336" y="34" width="135" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="348" y="54" fill="var(--ink)">reducer</text>
    <text x="348" y="72" fill="var(--ink-soft)">469 事件折叠成状态</text>
    <text x="348" y="89" fill="var(--ink-soft)">471 + 重连两个动作</text>
    <rect x="494" y="34" width="126" height="70" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
    <text x="506" y="54" fill="var(--ink)">界面</text>
    <text x="506" y="72" fill="var(--ink-soft)">470 RunView</text>
    <text x="506" y="89" fill="var(--ink-soft)">472 两档密度</text>
    <g stroke="var(--ink-soft)"><line x1="155" y1="69" x2="178" y2="69"/><line x1="313" y1="69" x2="336" y2="69"/><line x1="471" y1="69" x2="494" y2="69"/></g>
    <rect x="178" y="122" width="293" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="190" y="140" fill="var(--ink)">471 停止 ≠ 撤销,断线 → 先 GET 再 /resume</text>
    <text x="190" y="156" fill="var(--ink-soft)">pump / recover,409 等一会儿再试</text>
    <rect x="20" y="178" width="600" height="40" rx="6" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="32" y="196" fill="var(--ink)">472 Playwright 18 条:页面层管「界面对不对」,网络层管「发出去的对不对」</text>
    <text x="32" y="211" fill="var(--ink-soft)">假后端 fake_api.mts 模拟慢、断线、退回、转人工、出错</text>
    <text x="20" y="244" fill="var(--ink)">另一条路(Day 473–474)</text>
    <rect x="20" y="252" width="400" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="272" fill="var(--ink)">全 TypeScript:ToolLoopAgent + useChat</text>
    <text x="32" y="290" fill="var(--ink-soft)">协议、读流、reducer 三站由 AI SDK 代劳</text>
    <text x="32" y="307" fill="var(--ink-soft)">无状态服务端:审批要签名,否则能伪造</text>
    <rect x="440" y="252" width="180" height="70" rx="6" fill="var(--paper)" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
    <text x="452" y="272" fill="var(--ink)">今天拼起来</text>
    <text x="452" y="290" fill="var(--ink-soft)">token 提前泄露草稿</text>
    <text x="452" y="307" fill="var(--ink-soft)">draft 被 undefined 覆盖</text>
    <path d="M530 252 L530 218" stroke="var(--ink-soft)" stroke-dasharray="3 2" fill="none"/>
  </g>
</svg>
<figcaption>前四格是 SupportPilot 自己写的链路,每一格都有测试。全 TypeScript 的路线把中间三格交给了 AI SDK。右下角是今天把两份事件流真的喂进去才发现的两件事。</figcaption>
</figure>

这周所有东西围着同一件事转:**一个事件流从后端出口到屏幕,每一格各管一件事,每一格的测试也各管一件事,格子之间的约定没人管。** Day 472 的白名单只看「每个事件里的字段该不该给」,Day 469 的 reducer 只看「事件来了状态怎么变」,各自的测试都是绿的。今天的两个问题都出在格子之间:白名单放行了 `token`,因为每一个 token 单独看都是无害的几个字;reducer 假设 `interrupt` 一定带 `draft`,而白名单刚好把它去掉了。

Day 468 的结论放到这里也成立:每天的测试都绿了,不等于整体是对的。

## 本周每天一句话

[Day 469 · 事件类型和读流,一次运行就是一个 reducer](/blog/agent-zero/day-469-ui-stream/):后端自己定的七种事件,`useChat` 接不了,浏览器自带的 `EventSource` 只能发 GET,所以用 `fetch` 读 POST 的响应体,经过 `TextDecoderStream` 和 `eventsource-parser` 切成 `AgentEvent`;每块单独 `decode` 的写法在 811 块里解出 202 个乱码;`reducer` 里 `steps` 只由 `node` 事件追加,质检退回时清空草稿。

[Day 470 · 过程、工具卡片、回复和引用,两个页面](/blog/agent-zero/day-470-ui-components/):`RunView` 显示步骤、工具卡片和草稿/定稿两种形态;`PROPOSE` 集合只决定卡片颜色,权限在后端;模型的输出一律当纯文本,被注入的 `<img>` 只会显示成字符;复核线只在后端存一份。

[Day 471 · 停止和断线、可访问性、假后端](/blog/agent-zero/day-471-ui-robust/):点「停止」后端的 act 在后台照样跑完(建了申请、发了通知、花了 2 分钱);`/resume` 从 checkpoint 接着跑,用一个 `RUNNING` 集合挡住「还在收尾」的工单;前端把「用户停了」和「流断了」分开,断线先 GET 再 resume,退避重试。

[Day 472 · 三种用户三种信息密度,测试整条链路](/blog/agent-zero/day-472-ui-audience/):客户的浏览器 Network 面板里有 77 个事件、4 个 `tool`、`interrupt` 里的 `note` 和 `rule`;后端用白名单裁成 69 个,默认给最少;Playwright 18 条 e2e 28 秒,踩到 strict mode violation 和一条每 30 次坏 2 次的断线测试。

[Day 473 · 用 TypeScript 写 Agent(一)](/blog/agent-zero/day-473-ts-agents-1/):AI SDK 7 的 `ToolLoopAgent` 加 `toolApproval`;无状态服务端的审批结果由浏览器带回,没有签名密钥时我伪造的「已批准」让工具真的执行了,库里多了一行。

[Day 474 · 用 TypeScript 写 Agent(二)](/blog/agent-zero/day-474-ts-agents-2/):`useChat` 里漏了 `sendAutomaticallyWhen`,按钮点了什么都不发生;Mastra 的审批把暂停的运行存在服务端,伪造不出一个服务端没有的运行;结论是产品形态是「应用内的对话助手」、团队以前端为主时全 TS 最快,Agent 是后台流水线时留 Python。

哪一句你读着觉得「好像是这样,但说不清为什么」,先回那一天把对应小节重看一遍再往下走。

## 准备环境

今天的代码都在毕业项目仓库 `supportpilot/` 里,不建新目录,新增三类文件:`scratch/d475/make_stream.py`、`web/scripts/week68.mts`、`web/scripts/pace.mts`,以及改 `api/audience.py`、`web/src/lib/run.ts`、`web/src/lib/events.ts` 三个旧文件。用到的旧文件:

| 文件 | 哪天建的 | 今天用它做什么 |
| --- | --- | --- |
| `src/supportpilot/api/audience.py` | Day 472 | 默写二 `for_customer`;今天改一处 |
| `web/src/lib/events.ts` | Day 469 | 事件类型;今天改一处 |
| `web/src/lib/sse.ts` | Day 469 | `streamEvents`,小项目里原样使用 |
| `web/src/lib/run.ts` | Day 469,471 改过 | 默写一 `reducer`;今天改一处 |
| `web/src/lib/stages.ts` | Day 472 | `customerStages`,客户界面的阶段提示 |
| `tests/test_audience.py` | Day 472 | 今天改两处 |

有一件事要先说明:**这一篇我写的时候手边没有你仓库里 Day 469 录的那份真实事件流 `web/fixtures/run.sse`**,所以小项目的事件流是我按 Day 467、469 记录下来的形状手写的,不是录的。事件的数量和类型对得上你录的那份(77 个事件:7 个 `node`、5 个 `step`、4 个 `tool`、59 个 `token`、1 个 `interrupt`、1 个 `done`),字段取自 Day 467、472 里贴出来的真实事件,但文字内容(草稿的措辞、检索到的文章)是我编的。小项目里的检查不依赖具体措辞,你用自己录的 `run.sse` 换进去,结论一样。

先确认起点是绿的。在 `supportpilot/` 根目录和 `web/` 目录各跑一次:

```bash
cd supportpilot
uv run pytest -q tests/test_audience.py
cd web
npx tsc --noEmit -p .
```

我这边的版本:Node 24.22.0、TypeScript 5.9.3、eventsource-parser 4.1.2、tsx 4.23.15(2026 年 10 月)。`tests/test_audience.py` 是 Day 472 的 7 个测试。Python 侧用到的 `uv run python -m ...` 都要在 `supportpilot/` 根目录跑。

## 默写一:`reducer`

合上 Day 469 和 Day 471,在一个新文件里把 `reducer` 写出来。提示:它收一个状态和一个动作,动作有六种(开始、事件、失败、停止、重连、接着跑);「事件」这一种里再按 `e.event` 分七种。有四处是这周学到的细节,漏了就是错:`stopped` 对已经结束的运行要原样返回同一个对象;质检退回时清空草稿并记下退回原因;`interrupt` 要带上草稿;`done` 里 `outcome` 是 `waiting_approval` 才进等审批状态。

写完对照标准答案。这是 `run.ts` 里的原文,最后一版(含 Day 471 加的两个动作和今天要改的那一行,先别管那行,后面会讲):

```ts
// supportpilot/web/src/lib/run.ts(节选:reducer)
export function reducer(s: RunState, a: Action): RunState {
  switch (a.type) {
    case "start":
      return { ...initial, status: "running" };
    case "fail":
      return { ...s, status: "error", error: a.message };
    case "stopped":
      return s.status === "running" || s.status === "reconnecting" ? { ...s, status: "stopped" } : s;
    case "reconnecting":
      return { ...s, status: "reconnecting", error: null };
    case "resume":
      return { ...s, status: "running", error: null };
    case "event": {
      const e = a.e;
      switch (e.event) {
        case "node":
          return { ...s, steps: [...s.steps, e.data.node] };
        case "step": {
          const detail = stepDetail(e.data);
          const next = detail ? { ...s, details: { ...s.details, [e.data.node]: detail } } : s;
          // 质检没过,draft 节点会从头重写:旧草稿清掉,不然两版文字接在一起
          if (e.data.node === "check" && !e.data.passed) {
            return { ...next, draft: "", rewrites: s.rewrites + 1, rejections: [...s.rejections, e.data.problems] };
          }
          return next;
        }
        case "tool":
          return { ...s, tools: [...s.tools, e.data] };
        case "token":
          return { ...s, draft: s.draft + e.data.text };
        case "interrupt":
          // 断线重连后 token 可能缺了一截,interrupt 里带着完整草稿,以它为准
          // Day 475:客户那条线的 interrupt 没有 draft,不能拿 undefined 把 draft 覆盖掉
          return { ...s, draft: e.data.draft ?? s.draft, approval: { request: e.data.request, needsFinanceReview: e.data.needs_finance_review ?? false } };
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

- `export function reducer(s: RunState, a: Action): RunState {` 纯函数:旧状态加一个动作,返回新状态,不碰 React、不碰网络。因此小项目可以在 Node 里直接调它。
- `case "start":` 新一次运行,从 `initial` 重来,`status` 设成 running。注意是展开 `initial`,不是展开 `s`:上一轮的步骤、工具、草稿全部清掉。
- `case "fail":` 流没开起来(404、409、422、后端没起)走这里,保留已有的状态,只改 `status` 和 `error`。
- `return s.status === "running" || s.status === "reconnecting" ? { ...s, status: "stopped" } : s;` Day 471 的两处细节:重连等待期间点停止也要能停;已经结束的运行再收到 `stopped`,返回的是**原来那个对象 `s`**,React 用 `Object.is` 比较,同一个对象就不重新渲染。小项目的第 11 条检查专门测这一行。
- `case "reconnecting":` 流断了,正在查进度。清掉上一次的 `error`,免得「出错了」和「正在接回」同时显示。
- `case "resume":` 接着跑。和 `start` 的区别是展开的是 `s`:断线前收到的步骤、工具卡片、草稿都留着,接着跑的流只推后半段。
- `case "event": {` 事件被包在动作里,`const e = a.e` 取出来再按 `e.event` 分。如果你写成 `events.reduce(reducer, ...)`,Day 469 演示过:状态第一步就变成 `undefined`。
- `case "node":` 节点跑完。`steps` 只在这里追加,`step` 事件不追加,免得每个节点出现两次。
- `const next = detail ? { ...s, details: { ...s.details, [e.data.node]: detail } } : s;` `step` 事件带来的细节按节点名挂进 `details`。没有细节(比如没压缩时的 `prepare_context`)就原样不动。
- `if (e.data.node === "check" && !e.data.passed) {` 质检没过,`draft` 节点会从头重写,所以草稿清成空串,`rewrites` 加 1,原因追加进 `rejections`。小项目里「退回一次」的流:草稿只剩第二版。
- `case "tool":` 工具卡片只追加。客户版里这条根本到不了。
- `case "token":` 打字机就是不停地拼字符串。
- `case "interrupt":` 停在审批。`draft: e.data.draft ?? s.draft` 是今天改的一行,原来是 `draft: e.data.draft`,后面第三步会讲为什么。`needsFinanceReview` 同理加了 `?? false`。
- `case "error":` 后端推的 error,message 是 Day 467 定死的那句固定的话,堆栈不在里面。
- `case "done":` 只有 `outcome` 是 `waiting_approval` 才进等审批状态,别的(resolved、escalated)都是 done。转人工和已解决在这里长得一样,要看 `summary.outcome` 才分得出。

</div>

默写完替换进 `run.ts`,跑 `npx tsc --noEmit -p .` 加后面的 `week68.mts`。我第一次默写漏了 `rejections` 那一项,`tsc` 立刻在 `initial` 那里报缺字段,比人眼看快。

## 默写二:`for_customer`

再合上 Day 472,把客户那条线的白名单写出来。提示:它收一个事件名和数据,返回裁剪后的数据或者 `None`。规矩只有一条:**没有明确写出来放行的,一律不给。** 放行的有四种半:`node` 和 `error` 原样;`step` 只留质检那一条且把 `problems` 换成空列表;`interrupt` 只留申请号和金额;`done` 只留四个键。

标准答案(今天改过一处,`token` 不在第一行的元组里了):

```python
# supportpilot/src/supportpilot/api/audience.py(节选:for_customer 和 for_audience)
def for_customer(event: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """返回客户能看的那一份;返回 None 表示这个事件客户用不着,整条不推。"""
    if event in ("node", "error"):  # 节点名、固定的出错提示:本来就是给用户看的。Day 475:token 不在里面了,见下
        return data
    if event == "step":
        if data.get("node") == "check":  # 只留「质检过没过」:前端靠它在退回时清掉旧草稿。退回理由是内部细节,不给
            return {"type": "step", "node": "check", "passed": data["passed"], "problems": []}
        return None  # 分类、命中了哪几篇文章、有没有画像:客户不需要
    if event == "interrupt":  # 退款在等审批:客户只需要知道申请号和金额,规则、原因、给模型的提示、草稿都不给
        req = data["request"]
        return {"type": data["type"], "ticket_id": data["ticket_id"],
                "request": {"id": req["id"], "amount_cny": req["amount_cny"]}}
    if event == "done":  # 摘要:去掉花费、分类、等在哪个节点
        return {k: data[k] for k in ("ticket_id", "outcome", "reply", "turns") if k in data}
    return None  # tool、token(草稿还没过质检,也没人批过),以及以后新增的、没想过要不要给客户的事件:默认不给


def for_audience(audience: Audience, event: str, data: dict[str, Any]) -> dict[str, Any] | None:
    return for_customer(event, data) if audience == "customer" else data
```

<div class="line-notes">

- `def for_customer(event: str, data: dict[str, Any]) -> dict[str, Any] | None:` 返回 `None` 的意思是「这个事件客户用不着,整条不推」,和返回一个空字典不是一回事。
- `if event in ("node", "error"):` 这两种原样放行:节点名和固定的出错提示,本来就是给用户看的。Day 472 这里还有 `"token"`,今天拿掉了,理由在第三步。
- `if event == "step":` `step` 有五种,靠 `node` 字段区分。
- `if data.get("node") == "check":` 只留质检这一条。前端的 reducer 要靠 `passed` 为 false 在退回时清草稿,这个信号必须留着。
- `return {"type": "step", "node": "check", "passed": data["passed"], "problems": []}` `problems` 换成空列表而不是删掉这个键:前端的 `stepDetail` 里写着 `d.problems.join(";")`,键没了会抛 `TypeError`。
- `return None  # 分类、命中了哪几篇文章、有没有画像:客户不需要` 其余四种 `step` 整条丢掉。
- `if event == "interrupt":` 退款在等审批。
- `req = data["request"]` 实测 `request` 里有九个键。
- `return {"type": data["type"], "ticket_id": data["ticket_id"],` 不是「去掉不要的」,而是「只拿要的」:以后 `request` 里再加十个字段,客户那边也不会多出一个。
- `if event == "done":` 摘要从七个键剩四个。
- `return None  # tool、token` 最后一行是白名单的灵魂。以后后端加了新事件,忘了写进这个函数,客户也看不到。
- `def for_audience(` 给 `_events` 用的入口。客服那条线原样返回同一个对象,不复制。

</div>

两段都写对了,`tests/test_audience.py` 的 8 个测试(Day 472 的 7 个加今天的 1 个)和后面的小项目才会绿。

## 本周小项目:把两份事件流原样喂给前端

这周的东西都是分开测的:`for_customer` 有 Python 单元测试,`reducer` 有 `check_reducer.mts`,页面有 Playwright。今天写一个横跨三格的检查:同一张退款工单,后端出口按「客服」「客户」各裁一份,前端用**真的** `streamEvents` 读(走真的 HTTP,不是读文件)、**真的** `reducer` 折叠,再检查每一份的状态和原始文本。

### 第一步:生成两份事件流

`make_stream.py` 手写一张退款工单的完整事件序列,再用 Day 472 的 `for_audience` 切成两份。它还生成一个质检退回一次的版本,后面要用:

```python
# supportpilot/scratch/d475/make_stream.py
"""按 Day 467/469 录到的形状,手写一段退款工单的事件流(不是录的),再用 Day 472 的 for_audience 切成客户版。
输出到 web/fixtures/:run_staff.sse / run_customer.sse(一遍过),rewrite_staff.sse / rewrite_customer.sse(质检退回一次)。
运行:uv run python scratch/d475/make_stream.py
"""
import json
import random
from pathlib import Path

from supportpilot.api.audience import Audience, for_audience

OUT = Path(__file__).resolve().parents[2] / "web" / "fixtures"
TID = "T000153"
DRAFT = ("您好,您的专业版年付订阅属于首次购买,今天是第 7 天,在 14 天无理由全额退款期内,符合全额退款条件 [KB-refund-001]。"
         "我们已为您提交退款申请(金额 950 元),审核通过后会原路退回,请留意通知。")
BAD_DRAFT = "您好,已为您退款 950 元,马上到账,请查收 [KB-refund-001]。"
REQUEST = {"id": f"RF-{TID}-INV-202609-0002", "ticket_id": TID, "customer_id": "C0002", "invoice_id": "INV-202609-0002",
           "amount_cny": 950.0, "rule": "annual_first_14_days", "reason": "年付首购第 7 天,客户表示用不上,申请全额退款",
           "status": "pending", "note": "不要告诉客户退款已完成,只能说已提交审核"}


def chunks(text: str, n: int, seed: int) -> list[str]:
    """把 text 切成 n 段,每段 1–3 个字,模拟模型一次吐一小段。"""
    sizes = [1] * n
    left = len(text) - n
    rng = random.Random(seed)
    while left > 0:
        i = rng.randrange(n)
        if sizes[i] < 3:
            sizes[i] += 1
            left -= 1
    out, at = [], 0
    for s in sizes:
        out.append(text[at:at + s])
        at += s
    return out


def tokens(text: str, n: int, seed: int) -> list[tuple[str, dict]]:
    return [("token", {"type": "token", "text": t}) for t in chunks(text, n, seed)]


def staff_events(rewrite: bool) -> list[tuple[str, dict]]:
    ev: list[tuple[str, dict]] = [
        ("step", {"type": "step", "node": "load_customer", "found": True, "profile": True}), ("node", {"node": "load_customer"}),
        ("step", {"type": "step", "node": "prepare_context", "summarized_upto": 0}), ("node", {"node": "prepare_context"}),
        ("step", {"type": "step", "node": "classify", "category": "refund"}), ("node", {"node": "classify"}),
        ("step", {"type": "step", "node": "retrieve", "docs": ["KB-refund-001", "KB-refund-003", "KB-refund-001", "KB-plans-002", "KB-refund-001"]}),
        ("node", {"node": "retrieve"}),
        ("tool", {"type": "tool", "name": "list_subscriptions", "args": '{"customer_id": "C0002"}', "error": False}),
        ("tool", {"type": "tool", "name": "list_invoices", "args": '{"customer_id": "C0002", "limit": 10}', "error": False}),
        ("tool", {"type": "tool", "name": "check_refund_eligibility", "args": '{"invoice_id": "INV-202609-0002"}', "error": False}),
        ("tool", {"type": "tool", "name": "create_refund_request",
                  "args": json.dumps({"invoice_id": "INV-202609-0002", "reason": REQUEST["reason"]}, ensure_ascii=False), "error": False}),
        ("node", {"node": "act"}),
    ]
    if rewrite:
        ev += tokens(BAD_DRAFT, 30, 3) + [("node", {"node": "draft"}),
              ("step", {"type": "step", "node": "check", "passed": False,
                        "problems": ["草稿承诺了退款已完成/马上到账,退款必须经过人工审核"]}),
              ("node", {"node": "check"})]
    ev += tokens(DRAFT, 59, 7) + [("node", {"node": "draft"}),
          ("step", {"type": "step", "node": "check", "passed": True, "problems": []}), ("node", {"node": "check"}),
          ("interrupt", {"type": "refund_approval", "ticket_id": TID, "request": REQUEST, "draft": DRAFT, "needs_finance_review": False}),
          ("done", {"ticket_id": TID, "outcome": "waiting_approval", "category": "refund", "reply": None, "turns": 1,
                    "cost_cny": 0.02598, "waiting_on": ["approval"]})]
    return ev


def to_sse(events: list[tuple[str, dict]], audience: Audience) -> str:
    out = []
    for name, data in events:
        shown = for_audience(audience, name, data)
        if shown is not None:
            out.append(f"event: {name}\ndata: {json.dumps(shown, ensure_ascii=False)}\n\n")
    return "".join(out)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, rewrite in (("run", False), ("rewrite", True)):
        ev = staff_events(rewrite)
        for aud in ("staff", "customer"):
            text = to_sse(ev, aud)  # type: ignore[arg-type]
            (OUT / f"{name}_{aud}.sse").write_text(text, encoding="utf-8")
            n = text.count("event: ")
            print(f"{name}_{aud}.sse  {n} 个事件  {len(text.encode())} 字节")
```

<div class="line-notes">

- `OUT = Path(__file__).resolve().parents[2] / "web" / "fixtures"` `parents[2]` 是往上数两级:`d475` → `scratch` → `supportpilot` 根目录。输出放进 `web/fixtures/`,和 Day 469 录的 `run.sse` 放在一起。
- `TID = "T000153"` 工单号用 Day 467 之后一直出现的 T000153,申请号 `RF-T000153-INV-202609-0002` 也是那几天真实输出里的。
- `DRAFT = (` 一份合规的草稿:引用 `[KB-refund-001]`,说的是「已提交退款申请」。108 个字,下面会切成 59 个 token,和 Day 472 `leak_scan` 里数出来的 59 个对上。
- `BAD_DRAFT = "您好,已为您退款 950 元,马上到账,请查收 [KB-refund-001]。"` 一份会被质检退回的草稿,承诺了「已退款」「马上到账」。质检的 `PROMISE_RE` 会拦这类句子(Day 463 实测),退回原因我直接用了当时打印出来的真实文字。
- `REQUEST = {"id": f"RF-{TID}-INV-202609-0002"` 申请字典九个键,和 Day 472 实测的一样,其中 `rule` 和 `note` 是不该给客户的。
- `def chunks(text: str, n: int, seed: int) -> list[str]:` 把文字切成 n 段,每段 1 到 3 个字,模拟模型一次吐一小段。
- `sizes = [1] * n` 先给每段一个字。
- `while left > 0:` 把剩下的字一个一个随机加到某一段上(每段最多 3 个字),`seed` 固定,所以每次切法一样。代入 108 个字、59 段:先各给 1 个字,剩 49 个字随机分配。
- `def tokens(text: str, n: int, seed: int)` 切好的每段包成一个 `token` 事件。
- `def staff_events(rewrite: bool)` 客服看到的完整事件序列,`rewrite=True` 时在第一份草稿之后插入质检退回。
- `("step", {"type": "step", "node": "load_customer", "found": True, "profile": True}), ("node", {"node": "load_customer"}),` 每个节点都是先 `step` 后 `node`(Day 469 实测)。`retrieve` 的 `docs` 有重复,和 Day 463 的真实输出一样。
- `("tool", {"type": "tool", "name": "list_subscriptions",` 四个工具事件,`args` 是 JSON 字符串。
- `if rewrite:` 退回版:30 个 token 的坏草稿,`draft` 节点结束,`check` 不通过,`check` 节点结束。然后才是第二份草稿。
- `ev += tokens(DRAFT, 59, 7) + [("node", {"node": "draft"}),` 正式的草稿,59 个 token。
- `("interrupt", {"type": "refund_approval", "ticket_id": TID, "request": REQUEST, "draft": DRAFT,` 停在审批:这个字典就是 approval 节点交给 `interrupt()` 的那个,带完整草稿。
- `("done", {"ticket_id": TID, "outcome": "waiting_approval",` 第二轮才会出现的「等审批」摘要,`reply` 是 `None`(Day 468 改的)。
- `def to_sse(events: list[tuple[str, dict]], audience: Audience) -> str:` 把事件序列按观众裁剪后写成 SSE 文本。
- `shown = for_audience(audience, name, data)` 过 Day 472 的筛子;`None` 的整条不写。
- `if shown is not None:` 事件格式是 `event: 名字\ndata: JSON\n\n`,中文不转义。

</div>

```bash
uv run python scratch/d475/make_stream.py
```

这是**修之前**的真实输出(`audience.py` 还是 Day 472 的样子,放行 `token`):

```text
run_staff.sse  77 个事件  5474 字节
run_customer.sse  69 个事件  3816 字节
rewrite_staff.sse  110 个事件  7282 字节
rewrite_customer.sse  102 个事件  5548 字节
```

客服版 77 个,正好是你录的那份的数。客户版 69 个,和 Day 472 的测试里 `assert len(shown) == 69` 对得上:77 去掉 4 个 `tool`、4 个不是质检的 `step`。

### 第二步:12 条检查

`week68.mts` 分两半。上半是本地「后端」和读流:

```ts
// supportpilot/web/scripts/week68.mts
// 第 68 周小项目:同一张退款工单的两份事件流(客服版、客户版),走完 读流 → reducer → 客户阶段,
// 再检查「客户那一份」有没有该挡的东西。全程不调模型、不起 Python:流是 scratch/d475/make_stream.py 生成的。
// 运行:npx tsx scripts/week68.mts
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentEvent } from "../src/lib/events.ts";
import { initial, reducer, type Action, type RunState } from "../src/lib/run.ts";
import { streamEvents } from "../src/lib/sse.ts";
import { customerStages } from "../src/lib/stages.ts";

// 一个本地「后端」:POST /<文件名> 把 fixtures/<文件名>.sse 每 7 个字节切一块发出去,
// 汉字是 3 个字节,会被切在中间,正好练一练 TextDecoderStream
function serve(): Promise<Server> {
  const srv = createServer(async (req, res) => {
    const file = `fixtures/${(req.url ?? "").slice(1)}.sse`;
    const buf = readFileSync(file);
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (let i = 0; i < buf.length; i += 7) {
      res.write(buf.subarray(i, i + 7));
      if (i % 700 === 0) await new Promise((r) => setImmediate(r));
    }
    res.end();
  });
  return new Promise((ok) => srv.listen(0, () => ok(srv)));
}

type Played = { events: AgentEvent[]; state: RunState };

async function play(base: string, name: string): Promise<Played> {
  const events: AgentEvent[] = [];
  let state = reducer(initial, { type: "start" });
  for await (const e of streamEvents(`${base}/${name}`)) {
    events.push(e);
    state = reducer(state, { type: "event", e });
  }
  return { events, state };
}

const results: [string, boolean, string][] = [];
function check(name: string, fn: () => string | void) {
  try {
    const note = fn();
    results.push([name, true, note ?? ""]);
  } catch (err) {
    results.push([name, false, (err as Error).message.split("\n")[0]]);
  }
}
function must(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const srv = await serve();
const base = `http://localhost:${(srv.address() as AddressInfo).port}`;
const staff = await play(base, "run_staff");
const cust = await play(base, "run_customer");
const rwS = await play(base, "rewrite_staff");
const rwC = await play(base, "rewrite_customer");
srv.close();

const count = (p: Played, ev: string) => p.events.filter((e) => e.event === ev).length;
const tokensText = (p: Played) => p.events.flatMap((e) => (e.event === "token" ? [e.data.text] : [])).join("");
```

<div class="line-notes">

- `import { createServer, type Server } from "node:http";` Node 自带的 HTTP 服务,不用装 Express。
- `import { streamEvents } from "../src/lib/sse.ts";` 这是 Day 469 的**真**`streamEvents`:走 `fetch`、`TextDecoderStream`、`EventSourceParserStream`。小项目不是读文件假装读流。
- `function serve(): Promise<Server> {` 起一个小服务,路径对应 `fixtures/` 里的文件。
- `const file = `fixtures/${(req.url ?? "").slice(1)}.sse`;` 请求 `/run_customer` 就读 `fixtures/run_customer.sse`。`slice(1)` 去掉开头的斜杠。
- `for (let i = 0; i < buf.length; i += 7) {` 每 7 个字节发一块。汉字在 UTF-8 里占 3 个字节,7 不是 3 的倍数,所以大量汉字被切在中间。这正好是 Day 469 `split_decode.mts` 演示过的坑:每块单独 `decode` 会出乱码,`TextDecoderStream` 会把半个字留到下一块。
- `if (i % 700 === 0) await new Promise((r) => setImmediate(r));` 每发 100 块让出一次事件循环,让客户端有机会交错读写。
- `return new Promise((ok) => srv.listen(0, () => ok(srv)));` 端口填 0,系统随机分一个空闲端口,避免和你本机别的东西冲突。
- `type Played = { events: AgentEvent[]; state: RunState };` 一次播放的结果:收到的全部事件,和折叠出来的最终状态。
- `let state = reducer(initial, { type: "start" });` 和页面里 `useRun` 一样,先 `start` 再收事件。
- `for await (const e of streamEvents(`${base}/${name}`)) {` 读流。每来一个事件,存一份,再喂 `reducer`。
- `const results: [string, boolean, string][] = [];` 每条检查记一行:名字、过没过、一句备注。
- `function check(name: string, fn: () => string | void) {` 不让第一条失败就退出,12 条都跑完再一起报,这样一次能看到全部问题。
- `function must(cond: unknown, msg: string): asserts cond {` 自己写的断言。`asserts cond` 是 TypeScript 的断言函数签名:调用之后,编译器认为 `cond` 一定为真,后面的类型收窄才生效。
- `const staff = await play(base, "run_staff");` 四份流各播一遍,播完关掉服务。
- `const tokensText = (p: Played) => p.events.flatMap(` 把一份流里所有 `token` 的文字按顺序拼回去。这是「客户在 DevTools 里把 Network 面板的 token 拼起来」的动作。

</div>

下半是 12 条检查:

```ts
check("1 读流:客服版 77 个事件", () => {
  must(staff.events.length === 77, `实际 ${staff.events.length}`);
  return `node ${count(staff, "node")} step ${count(staff, "step")} tool ${count(staff, "tool")} token ${count(staff, "token")}`;
});
check("2 客服版:7 个节点、4 张工具卡片、检索细节去重", () => {
  must(staff.state.steps.length === 7 && staff.state.tools.length === 4, "步骤或工具数不对");
  must(staff.state.details.retrieve === "命中 3 篇:KB-refund-001、KB-refund-003、KB-plans-002", staff.state.details.retrieve);
});
check("3 客户版:没有工具卡片,过程收成 5 个阶段", () => {
  must(cust.state.tools.length === 0, "客户收到了 tool 事件");
  const st = customerStages(cust.state.steps);
  must(st.length === 5, `阶段 ${st.length} 个`);
  return st.at(-1);
});
check("4 两份都停在审批,金额一致", () => {
  for (const p of [staff, cust]) {
    must(p.state.status === "waiting_approval", `status ${p.state.status}`);
    must(p.state.approval?.request.amount_cny === 950, "金额不是 950");
  }
});
check("5 客户拿不到规则名和给模型的 note", () => {
  const raw = JSON.stringify(cust.state.approval);
  must(!raw.includes("annual_first_14_days") && !raw.includes("不要告诉客户"), raw);
});
check("6 客户版的 draft 仍然是字符串", () => {
  must(typeof cust.state.draft === "string", `typeof draft = ${typeof cust.state.draft}`);
});
check("7 客户的事件流里没有任何草稿文字", () => {
  const t = tokensText(cust);
  must(t === "", `收到了 ${t.length} 个字的草稿:「${t.slice(0, 18)}…」`);
});
check("8 质检退回一次:rewrites=1,草稿只剩第二版", () => {
  must(rwS.state.rewrites === 1 && rwS.state.rejections.length === 1, "退回次数不对");
  must(!rwS.state.draft.includes("马上到账"), "草稿里还留着被退回的那版");
});
check("9 被质检退回的话,客户一个字也没收到", () => {
  const t = tokensText(rwC);
  must(!t.includes("已为您退款"), `客户收到了:「${t.slice(0, 20)}」`);
});
check("10 断线接着跑:中间插 reconnecting + resume,结果和一口气跑完一样", () => {
  for (const p of [staff, cust]) {
    const cut = Math.floor(p.events.length / 2); // 从中间断开
    let s = reducer(initial, { type: "start" });
    const feed = (e: AgentEvent) => (s = reducer(s, { type: "event", e }));
    p.events.slice(0, cut).forEach(feed);
    for (const a of [{ type: "reconnecting" }, { type: "resume" }] as Action[]) s = reducer(s, a);
    p.events.slice(cut).forEach(feed);
    must(JSON.stringify(s) === JSON.stringify(p.state), "不一样");
  }
});
check("11 已经结束的运行再收到 stopped,原样返回同一个对象", () => {
  must(reducer(staff.state, { type: "stopped" }) === staff.state, "返回了新对象");
});

check("12 客户那份原始文本里搜不到任何内部词", () => {
  const raw = readFileSync("fixtures/run_customer.sse", "utf8");
  for (const w of ["annual_first_14_days", "C0002", "KB-refund", "不要告诉客户", "needs_finance_review", "list_invoices", "cost_cny"]) {
    must(!raw.includes(w), `客户的流里出现了「${w}」`);
  }
});

for (const [name, ok, note] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${name}${note ? "  → " + note : ""}`);
const bad = results.filter((r) => !r[1]).length;
console.log(`\n${results.length - bad}/${results.length} 通过`);
process.exit(bad ? 1 : 0);
```

<div class="line-notes">

- `check("1 读流:客服版 77 个事件", () => {` 数量对上才说明七种事件一个没丢,包括被切在块边界上的。备注里是各类型的个数。
- `must(staff.state.details.retrieve === "命中 3 篇:KB-refund-001、KB-refund-003、KB-plans-002"` 检索事件里 5 个切块去重成 3 篇,顺序是第一次出现的顺序。
- `check("3 客户版:没有工具卡片,过程收成 5 个阶段", () => {` 客户版 `tool` 事件没了,`customerStages` 把 7 个节点收成 5 行。最后一行是「正在为您整理答复」。
- `for (const p of [staff, cust]) {` 两份都要停在审批,金额都是 950。客户版的 `interrupt` 只剩申请号和金额,`reducer` 照样能折叠出 `approval`。
- `const raw = JSON.stringify(cust.state.approval);` 把状态里的 `approval` 转成字符串再搜内部词,和 Day 472 的 Python 测试「搜全文」是同一个思路:不断言「某个键不在」,而是搜内容。
- `check("6 客户版的 draft 仍然是字符串", () => {` 类型里写的是 `draft: string`,这条检查验运行时是不是真的字符串。TypeScript 的类型在运行时不存在,`as AgentEvent` 只是让编译器闭嘴(Day 469)。
- `check("7 客户的事件流里没有任何草稿文字", () => {` 把所有 token 拼起来,期望是空串。备注会打印前 18 个字。
- `must(!rwS.state.draft.includes("马上到账")` 客服版的草稿在质检退回那一刻被清空,只剩第二版。
- `check("9 被质检退回的话,客户一个字也没收到", () => {` 客户版里不能出现被退回那一版的承诺。
- `const cut = Math.floor(p.events.length / 2); // 从中间断开` 从事件序列的正中间断开,先喂前一半,插入 `reconnecting` 和 `resume` 两个动作,再喂后一半。客户版只有 10 个事件,所以切点要按比例算,不能写死一个数。
- `must(JSON.stringify(s) === JSON.stringify(p.state), "不一样");` 断线接着跑的结果必须和一口气跑完的完全相同。`reconnecting` 和 `resume` 不能在状态里留下痕迹。
- `must(reducer(staff.state, { type: "stopped" }) === staff.state, "返回了新对象");` `===` 比较的是对象身份,不是内容。
- `for (const w of ["annual_first_14_days", "C0002", "KB-refund"` 第 12 条:客户那份**原始文本**里搜七个内部词,不经过 reducer,和 Day 472 里那条「客户收到的事件流里没有内部字段」是同一类。
- `process.exit(bad ? 1 : 0);` 有一条失败就以退出码 1 结束,以后能挂进 CI。

</div>

```bash
cd web
npx tsx scripts/week68.mts
```

**修之前**的真实输出:

```text
PASS  1 读流:客服版 77 个事件  → node 7 step 5 tool 4 token 59
PASS  2 客服版:7 个节点、4 张工具卡片、检索细节去重
PASS  3 客户版:没有工具卡片,过程收成 5 个阶段  → 正在为您整理答复
PASS  4 两份都停在审批,金额一致
PASS  5 客户拿不到规则名和给模型的 note
FAIL  6 客户版的 draft 仍然是字符串  → typeof draft = undefined
FAIL  7 客户的事件流里没有任何草稿文字  → 收到了 108 个字的草稿:「您好,您的专业版年付订阅属于首次购买…」
PASS  8 质检退回一次:rewrites=1,草稿只剩第二版
FAIL  9 被质检退回的话,客户一个字也没收到  → 客户收到了:「您好,已为您退款 950 元,马上到账,」
PASS  10 断线接着跑:中间插 reconnecting + resume,结果和一口气跑完一样
PASS  11 已经结束的运行再收到 stopped,原样返回同一个对象
PASS  12 客户那份原始文本里搜不到任何内部词

9/12 通过
```

三条红。同一时间 `npx tsc --noEmit -p .` 是 0 报错,`pytest tests/test_audience.py` 是 7 个全绿,Day 472 那条「客户收到的事件流里没有内部字段」的思路也在第 12 条里过了。每一格自己的检查都绿,三条红全在格子之间。

### 第三步:两个问题

**问题一:客户的浏览器在质检之前就收到了整份草稿(第 7、9 条)。** 看第 9 条的备注:客户收到了「您好,已为您退款 950 元,马上到账,」。这是我故意放进去的那版会被质检退回的草稿。质检的 `PROMISE_RE` 就是为这类句子存在的(Day 463 实测它拦下了第 4 张工单的两版草稿),拦住以后重写一遍才发给客户。这个坏草稿是我编的,真模型写不写得出这句我没有专门去引,但质检节点存在,说明这类句子是可能出现的。可是事件流的顺序是:`draft` 节点一边写一边推 `token`,写完了 `check` 节点才跑。**token 是在质检之前发出去的。**

Day 472 的白名单把 `token` 和 `node`、`error` 放在一起,理由是「逐字文本,本来就是给用户看的」。这个理由对 `error` 和 `node` 成立,对 `token` 不成立:草稿**还没有过质检**,退款的草稿**还没有人批过**(`RunView` 里那句注释自己写着「客户在等审批时看不到草稿:草稿还没人批,批完以后也可能被改」)。页面确实做到了,`showDraft` 在 `waiting_approval` 时挡住了草稿。可是质检退回的那一版,在界面上是看得见的:状态是 `running`,`showDraft` 为真,打字机一个字一个字把「已为您退款 950 元,马上到账」打在客户屏幕上,几秒后质检退回,草稿被清空,换成第二版。客户已经读到了。

Day 472 那一天的话在这里应验了:**界面上不渲染,和没发出去,是两回事。** 而 Day 472 自己的网络层测试(第 12 条的前身)也没抓到,因为它搜的是内部词列表,每个 token 只有一到三个字,「已为您退款」被切在好几个事件里,整段原始文本里搜不到。要先把 token 拼起来(第 7、9 条里的 `tokensText`)才看得见。

**问题二:`draft` 变成了 `undefined`(第 6 条)。** Day 471 给 `interrupt` 那个 case 加了一行,「断线重连后 token 可能缺了一截,interrupt 里带着完整草稿,以它为准」,写成 `draft: e.data.draft`。对客服版没问题。客户版的 `interrupt` 被 Day 472 的白名单去掉了 `draft`,`e.data.draft` 是 `undefined`,一赋值,`state.draft` 就从一个字符串变成了 `undefined`。`tsc` 一声不吭,因为 `events.ts` 里写的是 `draft: string`,而 `as AgentEvent` 从来没校验过。

页面上没出事,是因为 `showDraft && state.draft &&` 恰好把它挡住了,`undefined` 是假值。换一个写法,比如有人在 `RunView` 里加一行 `state.draft.length`,客户页面一到等审批就白屏。这类问题的特点是:**今天没有症状,但它在等一个不小心。**

两个问题有共同的根:客户版的数据形状和客服版不一样,而前端的类型和 reducer 只认客服版那一种。

### 第四步:修

问题一的修法是两种里选一种。第一种,在后端攒着 token,质检过了再一次性放出去:打字机效果没了,而且后端的出口要变成有状态的。第二种,客户这一档干脆不推 `token`,过程由阶段提示表示(「正在为您整理答复」),定稿从 `done` 里的 `reply` 一次性出来。第二种简单得多:只是把 `"token"` 从白名单第一行拿掉。代价是客户看不到打字机,我觉得对一个会等审批、会被质检退回的 Agent 这是对的取舍:客户看到的每一个字都是定稿。客服那条线不受影响,他们要看打字机和被退回的那一版。

`audience.py`,第一行拿掉 `"token"`(前面「默写二」里贴的就是改后的):

```python
# supportpilot/src/supportpilot/api/audience.py(第一行 if 和最后的注释改了)
    if event in ("node", "error"):  # 节点名、固定的出错提示:本来就是给用户看的。Day 475:token 不在里面了,见下
        return data
    ...
    return None  # tool、token(草稿还没过质检,也没人批过),以及以后新增的、没想过要不要给客户的事件:默认不给
```

`tests/test_audience.py` 要改两处。一是加一个测试:

```python
# supportpilot/tests/test_audience.py(加在 test_tool_never_reaches_customer 后面)
def test_token_never_reaches_customer():
    """Day 475:草稿在质检之前就开始推 token,没过质检(或者要等人批)的话不能给客户。"""
    assert for_customer("token", {"type": "token", "text": "已为您退款"}) is None
    assert for_audience("staff", "token", {"type": "token", "text": "已为您退款"}) is not None
```

二是 `test_recorded_run_has_no_secret_for_customer` 里的数字改一下,因为 59 个 token 不推了:

```python
# supportpilot/tests/test_audience.py(test_recorded_run_has_no_secret_for_customer 里)
    assert len(shown) == 10  # Day 475:77 条里去掉 4 条 tool、4 条不相干的 step、59 条 token(原来是 69)
```

10 个是 7 个 `node`、1 个质检的 `step`、`interrupt` 和 `done`。

问题二两处改动。`events.ts` 把类型改成和现实一致:

```ts
// supportpilot/web/src/lib/events.ts(interrupt 那一支)
      // Day 475:客户那条线只有 type、ticket_id 和 request 的 id、金额,所以 draft 和 needs_finance_review 是可选的
      data: { type: "refund_approval"; ticket_id: string; request: RefundRequest; draft?: string; needs_finance_review?: boolean };
```

类型一改,`run.ts` 里原来那一行立刻报错,这就是类型该做的事:

```text
src/lib/run.ts(83,26): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
src/lib/run.ts(83,84): error TS2322: Type 'boolean | undefined' is not assignable to type 'boolean'.
```

然后改 `run.ts` 的 `interrupt` 分支(就是默写一里贴的那一行):

```ts
// supportpilot/web/src/lib/run.ts(interrupt 分支)
          return { ...s, draft: e.data.draft ?? s.draft, approval: { request: e.data.request, needsFinanceReview: e.data.needs_finance_review ?? false } };
```

重新生成事件流,再跑:

```bash
uv run python scratch/d475/make_stream.py
cd web && npx tsc --noEmit -p . && npx tsx scripts/week68.mts
```

```text
run_staff.sse  77 个事件  5474 字节
run_customer.sse  10 个事件  614 字节
rewrite_staff.sse  110 个事件  7282 字节
rewrite_customer.sse  13 个事件  774 字节
```

```text
PASS  1 读流:客服版 77 个事件  → node 7 step 5 tool 4 token 59
PASS  2 客服版:7 个节点、4 张工具卡片、检索细节去重
PASS  3 客户版:没有工具卡片,过程收成 5 个阶段  → 正在为您整理答复
PASS  4 两份都停在审批,金额一致
PASS  5 客户拿不到规则名和给模型的 note
PASS  6 客户版的 draft 仍然是字符串
PASS  7 客户的事件流里没有任何草稿文字
PASS  8 质检退回一次:rewrites=1,草稿只剩第二版
PASS  9 被质检退回的话,客户一个字也没收到
PASS  10 断线接着跑:中间插 reconnecting + resume,结果和一口气跑完一样
PASS  11 已经结束的运行再收到 stopped,原样返回同一个对象
PASS  12 客户那份原始文本里搜不到任何内部词

12/12 通过
```

客户版从 69 个事件变成 10 个,退回版从 102 变成 13。`tsc` 0 报错,`uv run pytest -q tests/test_audience.py` 是 `8 passed`(Day 472 的 7 个加今天新增的 1 个)。

**还没做的,要诚实地说。** 这个改动会连带影响 Day 472 的 Playwright 测试,而我手边没有那个仓库,**没有跑 Playwright**。可以确定的有两处,请你在自己的仓库里改完跑 `npx playwright test`:一是假后端的「慢」模式(`tokenMs`)是靠 token 之间的间隔拖慢的,客户版没有 token 以后,「想退款 慢」这张工单一秒不到就推完了,点「停止」的测试来不及点,练习 3 讲怎么改;二是 `leak_scan.mts` 里 `token: ["type", "text"]` 那一行白名单可以删了,留着就等于允许 token 回来。`app.py` 的接线不用动,`for_audience` 的签名没变。

## 本周错题与坑清单

下面这些是本周最容易出错的地方,每一条都是前几天实测出来的,括号里是哪一天。

**每块单独 decode(469)。** 本机测试看不出问题,一过公网就出现零星的 �。`split_decode.mts` 实测 811 块里解出 202 个乱码。用 `TextDecoderStream`。今天的小项目每 7 个字节切一块,同样的写法一定会红。

**`events.reduce(reducer, ...)`(469)。** reducer 收的是动作不是事件,状态第一步就变成 `undefined`,报 `Cannot read properties of undefined (reading 'steps')`。`tsx` 不查类型,写完脚本也要跑 `tsc`。

**step 和 node 都往步骤列表里加(469)。** 每个节点出现两次,勾还打早了。

**拿 draft 当最终回复(469、470)。** 草稿里的引用还是 `[KB-refund-001]`,转人工那次草稿是 0 字,回复在 `summary.reply`。

**用 `dangerouslySetInnerHTML` 渲染模型输出(470)。** 被注入的 `<img>` 变成真的标签,不用点击就能把数据发出去。模型的输出一律当纯文本。

**前后端各存一份阈值(470)。** 复核线只在后端,前端只显示结论。

**以为点了停止后端就停了(471)。** act 在后台又跑了 3 秒,建了申请、发了通知、花了 2 分钱。停止只是不再接收,不是撤销。

**断开后立刻 resume(471)。** 两个 act 同时调工具,实测三张工单三次都造出批不了的孤儿退款。先挡住「还在收尾」的工单。

**只处理抛错,不处理「流正常结束但没有 done」(471)。** 界面会永远停在「处理中」。

**以为前端不渲染就是没泄露(472)。** DevTools 的 Network 面板里什么都看得到。要不要给,在后端出口决定。

**用黑名单挡内部字段(472)。** 下个月有人给事件加个新字段,它就自动发给客户了。白名单:新字段默认不给。

**用 `.first()` 绕过 strict mode violation(472)。** 页面结构一变就悄悄点错元素。缩小范围比取第几个稳。

**断言一个只亮一秒的中间状态(472)。** 单独跑过,并行跑偶尔红。该断言「确定发生过」的事,比如网络上那条 409。

**照着 AI SDK 5 或 6 的教程写 7(473)。** `stepCountIs`、`needsApproval`、`system` 在 7 里都改名或废弃了。

**服务端无状态却不签名审批(473)。** 没有密钥时,我伪造的「已批准」让工具真的执行了,库里多了一行。

**漏了 `sendAutomaticallyWhen`(474)。** 点完确认按钮,15 秒内请求数没变,库里 0 行,看起来像按钮坏了。

**把 Mastra 的 `requireToolApproval: true` 当成「启用审批」(474)。** 它让所有工具都要审批,只想审批某一个工具要写在那个工具上。

**白名单放行「看起来无害」的流式片段(今天)。** 每个 token 一到三个字,单看无害,拼起来是整份没过质检的草稿。放行前问一句:这些东西拼起来是什么。

**类型里写 `string`,运行时是 `undefined`(今天)。** `as AgentEvent` 不校验,后端换了形状,`tsc` 一直绿。让类型和最少的那一份数据一致,可选字段就写成可选。

## 动手练习

### 练习 1:先算,再跑

不运行任何东西,先写下答案,再用 `make_stream.py` 验证:修完以后,「质检退回一次」那份事件流,客服版和客户版各有多少个事件?算式是什么?

<details><summary>参考答案</summary>

客服版:一遍过是 77 个。退回版多出:30 个坏草稿的 `token`、1 个 `draft` 的 `node`、1 个质检 `step`、1 个 `check` 的 `node`,一共 33 个。77 + 33 = **110**。

客户版:一遍过是 10 个(7 个 `node`、1 个质检 `step`、`interrupt`、`done`)。退回版多出:坏草稿的 token 不推了(0 个),`draft` 的 `node` 1 个,质检 `step` 1 个(质检那条留着,`passed` 为 false,reducer 靠它清草稿),`check` 的 `node` 1 个,共 3 个。10 + 3 = **13**。

```bash
uv run python scratch/d475/make_stream.py
```

```text
run_staff.sse  77 个事件  5474 字节
run_customer.sse  10 个事件  614 字节
rewrite_staff.sse  110 个事件  7282 字节
rewrite_customer.sse  13 个事件  774 字节
```

和算的一致。想一想:退回版客户版里那条质检 `step` 的 `problems` 是什么?(是 `[]`,白名单换成了空列表。我把这份流喂给 reducer 实测:`rewrites` 是 1,`rejections` 是 `[[]]`,一个空的原因列表;`details.check` 最后是「通过」,因为第二次质检把第一次的「退回:」覆盖了,但在两次质检之间它是「退回:」后面什么都没有。客户界面不渲染这几项,所以没事,但别在客户页面上显示退回原因。)

</details>

### 练习 2:把问题一钉成 pytest

写 `tests/test_stream_leak.py`:用 `make_stream.py` 里的 `staff_events`,整段过客户的筛子,断言客户拿到的 token 拼起来是空串,并且被退回的那一版「已为您退款」一个字都不在里面。要求:先在**修之前**的 `audience.py` 上跑红,再在修之后跑绿。提示:只搜原始文本不够。

<details><summary>参考答案</summary>

```python
# supportpilot/tests/test_stream_leak.py
"""练习 2:整段事件流过一遍客户的筛子,客户拿到的全文里不能有草稿,更不能有被质检退回的那一版。"""
import json

import pytest

from scratch.d475.make_stream import BAD_DRAFT, DRAFT, staff_events
from supportpilot.api.audience import for_audience


def customer_text(rewrite: bool) -> str:
    shown = [for_audience("customer", name, data) for name, data in staff_events(rewrite)]
    return "".join(json.dumps(s, ensure_ascii=False) for s in shown if s is not None)


def customer_tokens(rewrite: bool) -> str:
    return "".join(d["text"] for name, d in staff_events(rewrite) if name == "token"
                   and for_audience("customer", name, d) is not None)


@pytest.mark.parametrize("rewrite", [False, True])
def test_customer_never_receives_draft_text(rewrite):
    assert customer_tokens(rewrite) == ""


def test_rejected_promise_never_reaches_customer():
    # 只搜原始文本不行:token 是 1-3 个字一段,「已为您退款」被切在好几个事件里,整段文本里搜不到。要先把 token 拼起来
    assert "已为您退款" not in customer_text(True)
    assert "已为您退款" not in customer_tokens(True)


def test_staff_still_gets_the_whole_draft():
    staff = "".join(d["text"] for name, d in staff_events(True) if name == "token")
    assert staff == BAD_DRAFT + DRAFT  # 客服看到的是两版接在一起,reducer 靠 check 失败那一刻清空
```

<div class="line-notes">

- `from scratch.d475.make_stream import BAD_DRAFT, DRAFT, staff_events` 直接复用生成脚本里的数据。`scratch` 没有 `__init__.py`,靠 `pyproject.toml` 里 pytest 的 `pythonpath` 包含项目根目录才导入得了(`pythonpath = ["src", "."]`)。
- `shown = [for_audience("customer", name, data) for name, data in staff_events(rewrite)]` 每个事件过一遍筛子,不要的是 `None`。
- `return "".join(json.dumps(s, ensure_ascii=False) for s in shown if s is not None)` 客户实际收到的所有事件的 JSON 文本拼在一起,模拟「搜原始文本」。
- `return "".join(d["text"] for name, d in staff_events(rewrite) if name == "token"` 先挑出 token 事件,再看这个 token 客户收不收得到,收到的把文字拼起来,模拟「把 Network 里的 token 拼回去」。
- `@pytest.mark.parametrize("rewrite", [False, True])` 同一条断言跑两遍:一遍过的流、退回的流。
- `assert "已为您退款" not in customer_text(True)` 这一条**在修之前也是绿的**,因为「已为您退款」被切开了,每个事件里最多一两个字。这是故意留的:绿的测试不等于没问题。
- `assert "已为您退款" not in customer_tokens(True)` 拼起来才抓得到。
- `assert staff == BAD_DRAFT + DRAFT` 反过来也要测:客服那条线必须还是全量,否则以后有人把 token 全砍了,客服的打字机也没了。

</div>

```bash
uv run pytest -q tests/test_stream_leak.py
```

修之后:

```text
....                                                                     [100%]
4 passed in 0.03s
```

把 `audience.py` 第一行改回 `("node", "token", "error")`,同一个命令:

```text
FAILED tests/test_stream_leak.py::test_customer_never_receives_draft_text[False]
FAILED tests/test_stream_leak.py::test_customer_never_receives_draft_text[True]
FAILED tests/test_stream_leak.py::test_rejected_promise_never_reaches_customer
3 failed, 1 passed in 0.05s
```

三条红,一条绿(客服还是全量那条)。把 `customer_text` 那一行单独拿出来,修之前是绿的,这就是为什么要写两行断言。

</details>

### 练习 3:假后端的「慢」模式要跟着改

Day 472 的假后端 `fake_api.mts` 在主题含「慢」时让每个 token 隔 300 毫秒,其余事件隔 40 毫秒,Playwright 用它来制造一个够长的窗口去点「停止」。客户版没有 token 以后,这个窗口还剩多少?写一个脚本算出来(不用真的睡),再给一个新的节奏,让客户版也有大约 10 秒的窗口。

<details><summary>参考答案</summary>

```ts
// supportpilot/web/scripts/pace.mts
// 练习 3:假后端「慢」模式推完一份事件流要多久?不真的睡,只把每个事件之后要等的毫秒数加起来。
// 运行:npx tsx scripts/pace.mts
import { readFileSync } from "node:fs";
import { createParser } from "eventsource-parser";

function eventNames(file: string): string[] {
  const names: string[] = [];
  createParser({ onEvent: (m) => names.push(m.event ?? "") }).feed(readFileSync(file, "utf8"));
  return names;
}

// Day 472 假后端的节奏:慢模式下 token 隔 300 毫秒,其余隔 40 毫秒
const before = (names: string[]) => names.reduce((ms, n) => ms + (n === "token" ? 300 : 40), 0);
// 改成:慢模式下 node 隔 1500 毫秒,其余隔 40 毫秒(token 对客户已经不推了;客服那条线 token 照旧 300)
const after = (names: string[], audience: "customer" | "staff") =>
  names.reduce((ms, n) => ms + (n === "node" ? 1500 : n === "token" && audience === "staff" ? 300 : 40), 0);

for (const [label, file, aud] of [["客服版", "fixtures/run_staff.sse", "staff"], ["客户版", "fixtures/run_customer.sse", "customer"]] as const) {
  const names = eventNames(file);
  console.log(`${label}  ${names.length} 个事件  旧节奏 ${before(names)} 毫秒  新节奏 ${after(names, aud)} 毫秒`);
}
```

<div class="line-notes">

- `import { createParser } from "eventsource-parser";` 用非流式接口,把整个文件一次喂进去,不起服务。
- `createParser({ onEvent: (m) => names.push(m.event ?? "") }).feed(readFileSync(file, "utf8"));` 只收事件名。`m.event` 可能是 `undefined`(没有 `event:` 行的消息),用 `?? ""` 补成空串。
- `const before = (names: string[]) => names.reduce((ms, n) => ms + (n === "token" ? 300 : 40), 0);` 这里的 `reduce` 是数组的 `reduce`,初始值 0,每个事件加上它后面要等的毫秒。
- `const after = (names: string[], audience: "customer" | "staff") =>` 新节奏要知道是哪一档观众,因为只有客服版还有 token。
- `names.reduce((ms, n) => ms + (n === "node" ? 1500 : n === "token" && audience === "staff" ? 300 : 40), 0);` 嵌套的三元:node 1500、客服的 token 300、其余 40。
- `for (const [label, file, aud] of` `as const` 让 `aud` 的类型是字面量 `"staff"` 或 `"customer"`,能传给 `after`。

</div>

```text
客服版  77 个事件  旧节奏 18420 毫秒  新节奏 28640 毫秒
客户版  10 个事件  旧节奏 400 毫秒  新节奏 10620 毫秒
```

旧节奏下客户版只有 0.4 秒,Playwright 点不到「停止」,这就是我说的会红。客户版 7 个节点各等 1.5 秒,加起来 10.6 秒,足够。算式:客户版 7 × 1500 + 3 × 40 = 10620。客服版新节奏里 59 个 token 仍然各 300、7 个节点各 1500,28.6 秒,客服卡片的测试一般不需要慢,可以只给客户版用新节奏。**我没有跑 Playwright**,请你在 `fake_api.mts` 的 `streamTo` 里按这个思路改完再跑一遍 `situations.spec.ts`。

</details>

### 练习 4:检查本身要被检查

第 12 条检查写好了,它真的抓得到问题吗?故意把 `audience.py` 的 `interrupt` 改成多放一个 `rule`,重新生成流,看 12 条里哪几条会红。

<details><summary>参考答案</summary>

在 `for_customer` 的 `interrupt` 那个 `return` 里,把 `"request"` 这一项改成:

```python
                "request": {"id": req["id"], "amount_cny": req["amount_cny"], "rule": req["rule"]}}
```

```bash
uv run python scratch/d475/make_stream.py
cd web && npx tsx scripts/week68.mts | grep -E "FAIL|通过"
```

```text
FAIL  5 客户拿不到规则名和给模型的 note  → {"request":{"id":"RF-T000153-INV-202609-0002","amount_cny":950,"rule":"annual_first_14_days"},"needsFinanceReview":false}
FAIL  12 客户那份原始文本里搜不到任何内部词  → 客户的流里出现了「annual_first_14_days」
10/12 通过
```

两条红:第 5 条看 reducer 折叠出来的状态,第 12 条看原始文本,各自独立抓到。其中第 12 条的消息更直接:告诉你是哪个词漏了。想一想:如果只留第 5 条,什么情况下它抓不到?(前端 reducer 把 `rule` 丢掉了、不放进状态,而流里还带着它。Day 472 的 `RunView` 就不渲染 `rule`。这时候只有看原始文本的那一条能抓到。)改回来以后重新生成,恢复 12/12。

</details>

## 名词解释

今天没有新概念,下面几个词是这周用得多、讲得少的。

| 名词 | 意思 |
| --- | --- |
| 可辨识联合(discriminated union) | TypeScript 里用一个固定字段(比如 `event`)区分每一种形状的联合类型。例:`AgentEvent` 按 `e.event` 分七种,`switch` 之后每个分支里 `e.data` 的类型是确定的。 |
| 白名单 | 只放行明确写出来的,其余一律不给。例:`for_customer` 里没写的事件名默认返回 `None`,以后新增的事件不会漏给客户。和它相对的黑名单是「挡住明确写出来的」。 |
| 断言函数(asserts) | TypeScript 里签名写成 `asserts cond` 的函数,调用之后编译器认为 `cond` 为真。例:小项目里的 `must`。 |
| 退避(backoff) | 重试时每次等的时间越来越长。例:Day 471 的 `RETRY_MS = [0, 1000, 2000, 4000, 8000]`。 |
| 变异测试(mutation testing) | 故意把代码改坏,看测试会不会变红,检验测试本身。例:练习 4 把白名单多放一个 `rule`。 |
| 假后端(fake backend) | 一个只会回放固定事件的小服务,用来不花钱地调前端。例:今天的 `serve()`。 |

## 常见误区

**每一格的测试都绿,就以为整条链是对的。** 今天两个问题,涉及的代码各自都有测试而且是绿的。Day 472 的白名单测试只看「每个事件里的字段」,Day 471 的 reducer 测试只喂客服版的事件。至少要有一个把两边接起来、从用户视角走完全程的检查。

**以为「每个片段都无害,拼起来就无害」。** 流式输出的 token 一到三个字,单看什么都不是。放行流式数据之前,问一句它拼起来是什么、拼完之前有没有人审过。

**用搜原始文本来证明「没发出去」。** 被切开的内容在原始文本里搜不到。要先按协议把它还原(拼 token、拼分块),再搜。

**修白名单只改后端,不管前端的类型。** 后端的形状变了(客户版没有 `draft`),前端的类型还写着 `string`,`tsc` 一直绿,运行时是 `undefined`。后端裁掉什么,前端的类型就把什么标成可选。

**默写只对着文章看一遍。** 默写完一定要替换进项目跑检查。`tsc` 比眼睛快,`week68.mts` 比 `tsc` 全面。

## 学习资料

### 文档与文章

- [React · 迁移状态逻辑至 Reducer 中](https://zh-hans.react.dev/learn/extracting-state-logic-into-a-reducer):中文,讲为什么一堆 `useState` 该换成 reducer,默写 `reducer` 之前读一遍。
- [MDN · TextDecoderStream](https://developer.mozilla.org/zh-CN/docs/Web/API/TextDecoderStream):中文,一页,讲为什么它能把切在块边界上的汉字拼回来,对应小项目里每 7 个字节切一块。
- [eventsource-parser](https://github.com/rexxars/eventsource-parser):README 里有流式和非流式两种用法,`streamEvents` 和 `week68.mts` 里分别用了。
- [MDN · 使用服务器发送事件](https://developer.mozilla.org/zh-CN/docs/Web/API/Server-sent_events/Using_server-sent_events):中文,SSE 的事件格式和断线重连,回看 Day 471 的 recover。
- [OWASP · LLM05:2025 Improper Output Handling](https://genai.owasp.org/llmrisk/llm052025-improper-output-handling/):英文,讲「模型输出没处理就交给下游」,和今天「没过质检的草稿发给客户」是同一类问题的两面。
- [Playwright · Best Practices](https://playwright.dev/docs/best-practices):英文,优先用用户看得到的方式找元素,别断言瞬间状态,回看 Day 472 的两个坑。
- [AI SDK · Stream Protocol](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol):英文,Day 473、474 用的协议,对照我们自己的七种事件,想一想它的 `text-delta` 对应我们的哪一种、有没有同样的「草稿提前给用户」的问题。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1KvgD6mEdU&autoplay=0&high_quality=1" title="AI项目，SSE流式长链接频繁断连怎么处理" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>巧克力不爱猫 · AI项目,SSE流式长链接频繁断连怎么处理 · 3 分钟,讲断线以后怎么兜底,对照 Day 471 的 `pump` 和 `recover` 看,想一想他的做法比我们多了什么、少了什么。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oAebzkExf&autoplay=0&high_quality=1" title="为什么要用 useReducer？5分钟搞懂 React 状态管理进阶！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>FireUG技术社区 · 为什么要用 useReducer?5分钟搞懂 React 状态管理进阶! · 5 分钟,讲一堆 `useState` 为什么该换成 reducer,默写 `reducer` 之前看一遍。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BeZfiCPhZbI" title="I Cannot Believe Abort Controller Can Do This" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Web Dev Simplified · I Cannot Believe Abort Controller Can Do This · 英文,开字幕。讲 `AbortController` 能取消的东西,停止按钮靠它,和 Day 471 的「停止不是撤销」放在一起想。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):讲 Agent 系统里防护措施该放在哪一层的部分,对照今天的结论:白名单要放在后端出口,不能指望前端不渲染。英文。
- Boris Cherny《Programming TypeScript》(O'Reilly,2019):可辨识联合和类型收窄,`AgentEvent` 和 `reducer` 的写法就是它讲的。英文。

### 开源项目与代码

- [rexxars/eventsource-parser](https://github.com/rexxars/eventsource-parser):想看 SSE 切分的所有边角情况,读 `src/parse.ts`。
- [vercel/ai](https://github.com/vercel/ai):AI SDK 的源码,`packages/react` 里的 `useChat` 内部也是读流加状态折叠,和我们的 `useRun` 对照。

## 自测

1. 客户的浏览器 Network 面板里,一张要审批的退款工单从头到尾会收到哪些事件?修之前和修之后各多少个?

<details><summary>答案</summary>

修之前 69 个:7 个 `node`、1 个质检 `step`、59 个 `token`、1 个 `interrupt`、1 个 `done`。修之后 10 个,没有 `token`。客服那条线始终是 77 个,多出的 8 个是 4 个 `tool` 和 4 个别的 `step`。

</details>

2. `reducer` 里 `stopped` 那一行为什么对已经结束的运行返回原来的对象,而不是 `{ ...s }`?

<details><summary>答案</summary>

React 用 `Object.is` 比较新旧状态,同一个对象就跳过重新渲染。`{ ...s }` 内容一样但是新对象,会触发一次无意义的渲染。小项目第 11 条检查用 `===` 验这一点。

</details>

3. 为什么 `streamEvents` 要用 `TextDecoderStream`,而不是对每一块 `new TextDecoder().decode(chunk)`?小项目里是怎么逼出这个问题的?

<details><summary>答案</summary>

汉字在 UTF-8 里占 3 个字节,网络包可能把一个字切在两块之间。每块单独解码,半个字解不出来,变成 �。`TextDecoderStream` 会把没凑齐的字节留到下一块。小项目的本地服务每 7 个字节发一块,7 不是 3 的倍数,所以大量汉字被切在中间,如果写成逐块解码,第 1 条检查就会拿到乱码。Day 469 实测 811 块里解出 202 个乱码。

</details>

4. 今天的问题一里,为什么 Day 472 自己的网络层测试没有抓到「草稿提前给了客户」?

<details><summary>答案</summary>

那条测试搜的是一份内部词列表(`list_invoices`、`annual_first_14_days` 之类),草稿的文字不在列表里;而且 token 是 1 到 3 个字一段,一句话被切在几十个事件里,在原始文本里搜整句也搜不到。要先把 token 拼回去再看,这才是客户在 DevTools 里实际会做的事。

</details>

5. 面试题:你的 Agent 前端要给客户看流式输出,有人说「前端只渲染定稿就行,中间的 token 随便推」。你怎么回答?

<details><summary>答案</summary>

示范回答:前端不渲染不等于没发出去,DevTools 的 Network 面板里每个字节都看得到。我在 SupportPilot 里实测过:客户那条线放行了 token,而 token 是在质检之前推的,一份被质检退回的草稿「已为您退款,马上到账」,客户的浏览器在质检拦下之前已经完整收到了,界面上也打字机一样显示了几秒。我的做法是后端出口用白名单,客户这一档不推 token,过程用阶段提示表示,定稿一次性从完成事件里给;客服那一档保留 token,因为他们要看打字机和被退回的那一版。代价是客户没有打字机效果,但他们看到的每一个字都是过了质检的。我还写了一个测试,把整段流过一遍客户的筛子,把 token 拼回去搜,不然被切开的句子搜不到。

</details>

6. `draft: e.data.draft ?? s.draft` 比 `draft: e.data.draft` 好在哪?为什么光改这一行还不够,还要改 `events.ts`?

<details><summary>答案</summary>

客户版的 `interrupt` 没有 `draft`,前者拿不到就保留已有的草稿,后者会把它覆盖成 `undefined`。光改 `reducer` 不够:`events.ts` 里 `draft` 写的是 `string`(必有),类型和现实不一致,下一个写代码的人还会按「一定有」去用。把它改成 `draft?: string`,TypeScript 会在所有直接用到它的地方报错,逼着你处理没有的情况。

</details>

## 明天预告

明天是 [Day 476](/blog/agent-zero/day-476-eval-scenarios/),评测(一):从验收指标到评测项,场景×说法。到今天为止 SupportPilot 的后端、记忆、接口、界面都有了,你能说出的效果大概是「我试了十几张工单,大部分挺好的」。明天把 [Day 437](/blog/agent-zero/day-437-prd/) PRD 里的 16 个指标逐个对到可以自动判断的评测项上,再造一份 100 条的评测集:每个场景一个标准答案,配几种客户说法,按场景拆成 dev 和 test。Day 463 记下的四个问题(描述状态被当成违规承诺、找到了客户还要邮箱、驳回后前后矛盾、质检看不到提示)也会变成用例。
