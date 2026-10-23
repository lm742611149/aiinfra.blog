---
title: 'Day 472 · 界面(五):三种用户三种信息密度,测试整条链路'
description: '先写脚本数出客户的浏览器收到了哪些不该看的字段:工具参数、给模型的提示、规则编号、花费。后端按客户、客服两条线裁剪事件,用白名单兜底;前端把过程收成阶段提示,财务审批卡片补上要发给客户的草稿。再用 Playwright 把 Day 471 的五种不顺利和审批流程变成 18 条端到端测试,踩到 strict mode、一条每二十次坏一次的断线测试、axe 查出的对比度和标题级别,最后故意改坏两处,看测试能不能抓住。'
pubDate: 2026-10-23
regime: none
tags: ['playwright', 'e2e', 'accessibility', 'react', 'sse', 'supportpilot', 'agent-zero']
series: 'agent-zero'
day: 472
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 471](/blog/agent-zero/day-471-ui-robust/) 处理了不顺利的时候:点「停止」只是不再接收,后台那一步会跑完;后端加了 `/resume` 从 checkpoint 接着跑;前端把「用户停了」和「流断了」分开,断线后自动查进度再接;还写了一个 TypeScript 假后端,能模拟慢、断线、退回、转人工、出错五种情况。

那一天结尾留了两个问题。一是界面现在把什么都摊开了:工具参数、检索到的文章编号、质检意见、花费,客户真的需要看这些吗?二是 [Day 470](/blog/agent-zero/day-470-ui-components/) 提过,财务批钱之前看不到要发给客户的草稿。今天先解决这两个,然后把前面几天「我用无头浏览器看了一眼」的做法,换成能自动跑的 Playwright 测试。

## 今天要解决的问题

前端部分默认你会 React,只讲和 Agent 有关的部分。学完今天你应该能做到:

1. 说清楚同一个事件对客户、客服、财务三种人该给多少信息,并写脚本数出「发出去了但界面不该显示」的字段。
2. 在后端用白名单按人裁剪事件流,知道为什么「前端不渲染」不等于「没泄露」。
3. 让审批卡片带上要发给客户的草稿,知道草稿存在 checkpoint 的哪里、怎么读出来。
4. 用 Playwright 写端到端测试:按角色和文字找元素、同时开两个人的页面、检查网络上收到的原始事件流、用 axe 查可访问性,并能解释一条时灵时不灵的测试是怎么被治好的。

预计用时 3 小时。前置:[Day 469](/blog/agent-zero/day-469-ui-stream/)(`streamEvents`、reducer、`fixtures/run.sse`)、[Day 470](/blog/agent-zero/day-470-ui-components/)(`RunView`、两个页面)、[Day 471](/blog/agent-zero/day-471-ui-robust/)(`useRun`、假后端)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `for_customer` 和 `submitTicket` 加 `waitForSubmitted` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先准备环境

今天不需要真后端,也不花钱:客户页面、工作台、假后端都在 `supportpilot/web/` 里。假后端是 Day 471 的 `scripts/fake_api.mts`,它读 Day 469 录的 `fixtures/run.sse`。我的 `fixtures/run.sse` 是按同样的形状和数字(77 个事件,107 字草稿,花费 0.02598)重新生成的,和你录的内容不会逐字一样,下面的数字对得上就行。

端口我用假后端 8472、前端 3472,和 Day 471 的 8077、3471 错开,免得和你还开着的进程撞车。先确认环境:

```bash
cd supportpilot/web
node -v                 # v24.22.0,AI SDK 和 Playwright 都要求 Node 20 以上
npx tsc --noEmit        # 没有输出就是 0 报错
npx tsx scripts/check_reducer.mts
```

`check_reducer.mts` 应该打印 `ok 77 个事件, 107 字草稿,花费 0.02598`,说明录音和 reducer 都还是 Day 469 的样子。

## 第一步:客户的浏览器收到了什么

Day 469 讲到调试页时我提过一句:interrupt 事件里有个 `note` 字段,是业务函数写给模型看的提示(「不要告诉客户退款已完成,只能说已提交审核」),跟着事件一起推到了浏览器。当时说正式页面不能显示它。可「不显示」做到了吗?「浏览器收到了」又是另一回事。

先量一下。下面的脚本建一张退款工单,走客户那几个流式接口之一(`/run`),把每个事件里的字段路径摊开,和「客户界面真正用到的字段」白名单对比,多出来的就是发出去了但不该给客户的。

```ts
// supportpilot/web/scripts/leak_scan.mts
// 客户的浏览器到底收到了什么:建一张退款工单,走客户那三个流式接口之一(/run),把每个事件里的字段路径摊开,
// 和「客户界面该显示的字段」白名单对比,多出来的就是「发出去了但不该给客户看」的。
// 运行:NEXT_PUBLIC_SUPPORTPILOT_API=http://localhost:8472 npx tsx scripts/leak_scan.mts
import { createTicket, runTicket } from "../src/lib/api.ts";

// 客户界面真正用到的字段(按事件名)。白名单:没列进来的,一律算多余
const SHOWN: Record<string, string[]> = {
  node: ["node"],
  token: ["type", "text"],
  step: ["type", "node", "passed", "problems"],
  interrupt: ["type", "ticket_id", "request.id", "request.amount_cny"],
  error: ["message"],
  done: ["ticket_id", "outcome", "reply", "turns"],
};

// {a: {b: 1}, c: [..]} → ["a.b", "c"]。数组不往里钻,按一个字段算
function paths(o: unknown, prefix = ""): string[] {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return [prefix];
  return Object.entries(o).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
}

const { ticket_id } = await createTicket({ customer_email: "lina@example.com", subject: "想退款", body: "上周买的专业版年付,用不上,请帮我退款。" });
const extra = new Map<string, Set<string>>(); // 事件名 → 多余的字段
const count: Record<string, number> = {};
for await (const e of runTicket(ticket_id)) {
  count[e.event] = (count[e.event] ?? 0) + 1;
  const allowed = SHOWN[e.event];
  for (const p of paths(e.data)) {
    if (!allowed?.includes(p)) extra.set(e.event, (extra.get(e.event) ?? new Set()).add(p));
  }
}
console.log("事件数", count);
if (extra.size === 0) console.log("没有多余字段");
for (const [ev, ps] of extra) console.log(`多余 ${ev}:`, [...ps].join(", "));
```

<div class="line-notes">

- `import { createTicket, runTicket } from "../src/lib/api.ts";` 直接用页面里那两个函数,不另写 fetch。这样测到的就是客户页面真的会收到的东西。`.ts` 后缀是 Day 469 在 tsconfig 里打开 `allowImportingTsExtensions` 的原因。
- `const SHOWN: Record<string, string[]> = {` 一张白名单:键是事件名,值是客户界面用得上的字段路径。`step` 只要 `passed`(前端靠它在质检退回时清掉旧草稿),`interrupt` 只要申请编号和金额。这张表是今天的设计决定,不是从代码里推出来的。
- `function paths(o: unknown, prefix = ""): string[] {` 把嵌套对象摊成路径列表。代入 `{request: {id: "RF-1", rule: "x"}, draft: "..."}` 得到 `["request.id", "request.rule", "draft"]`。
- `if (o === null || typeof o !== "object" || Array.isArray(o)) return [prefix];` 递归的出口:遇到数字、字符串、null、数组就停,把当前路径当成一个字段。数组不往里钻,比如 `docs: ["KB-refund-001", ...]` 就算一个字段 `docs`。
- `return Object.entries(o).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));` 对每个键递归,前缀用点号拼起来。`flatMap` 把每个键返回的数组拍平成一个。
- `const { ticket_id } = await createTicket({` 假后端的第一张工单是 T000001。邮箱用 lina@example.com,和 Day 467 起所有退款演示一致。
- `const extra = new Map<string, Set<string>>();` 事件名到「多余字段集合」的映射,用 Set 是因为同一个字段在 59 个 token 事件里会重复出现几十次,只记一次。
- `for await (const e of runTicket(ticket_id)) {` 和页面用同一个异步生成器读流。`runTicket` 返回 `AgentEvent`,`e.event` 是事件名,`e.data` 是数据。
- `count[e.event] = (count[e.event] ?? 0) + 1;` 按事件名数个数。第一次遇到某个事件名时 `count[...]` 是 undefined,`?? 0` 补成 0。
- `if (!allowed?.includes(p)) extra.set(` 路径不在白名单里就记下来。`allowed` 本身可能是 undefined(出现了表里没有的事件名,比如 `tool`),`?.` 让整个表达式变成 undefined,`!undefined` 为真,所以整个事件的所有字段都算多余。

</div>

启动假后端再跑(两个终端,都在 `web/` 目录):

```bash
FAKE_PORT=8472 WEB_ORIGIN=http://localhost:3472 npx tsx scripts/fake_api.mts
NEXT_PUBLIC_SUPPORTPILOT_API=http://localhost:8472 npx tsx scripts/leak_scan.mts
```

真实输出:

```text
事件数 { step: 5, node: 7, tool: 4, token: 59, interrupt: 1, done: 1 }
多余 step: found, profile, summarized_upto, category, docs
多余 tool: type, name, args, error
多余 interrupt: request.ticket_id, request.customer_id, request.invoice_id, request.rule, request.reason, request.status, request.note, draft, needs_finance_review
多余 done: category, cost_cny, waiting_on
```

77 个事件里,除了 7 个 `node`、59 个 `token`、1 个 `step`(质检)、1 个 `interrupt` 的两个字段和 `done` 的四个字段,其余全是客户界面不会用的。具体是:

- 4 个 `tool` 事件整条多余:`args` 里有 `{"customer_id": "C0002"}`,是内部客户编号。
- `interrupt` 里 `rule`(`annual_first_14_days`,是内部规则名)、`reason`、`note`(给模型的指令)、`draft`(还没人批过的草稿)、`needs_finance_review`(内部复核线的判断结果)。
- `done` 里 `cost_cny`(我们的成本)、`waiting_on`(内部节点名)。

这些字段在 Day 470 的客户页面上都没渲染出来:`RunView` 只取自己要的。但打开 DevTools 的 Network 面板,点开 `/run` 那条请求的 Response,每一个字都在。客户、竞争对手、写爬虫的人,都能看到你的退款规则叫什么、一张退款单模型被告知了什么、你每张工单成本多少。

所以这一步的结论是:**界面上不渲染,和没发出去,是两回事**。要不要给,得在后端决定。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="同一个事件流在后端被切成两份:客户那一份只剩阶段、申请编号和回复,客服和财务那一份是全量">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="16" y="90" width="150" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="28" y="116" fill="var(--ink)">LangGraph 的流</text>
    <text x="28" y="136" font-size="11" fill="var(--ink-soft)">77 个事件,全量</text>
    <rect x="236" y="90" width="150" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="248" y="116" fill="var(--ink)">for_audience</text>
    <text x="248" y="136" font-size="11" fill="var(--ink-soft)">白名单,按接口</text>
    <rect x="460" y="20" width="164" height="90" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="472" y="44" fill="var(--ink)">/tickets/…(客户)</text>
    <text x="472" y="64" font-size="11" fill="var(--ink-soft)">69 个事件</text>
    <text x="472" y="82" font-size="11" fill="var(--ink-soft)">无 tool、无花费</text>
    <text x="472" y="98" font-size="11" fill="var(--ink-soft)">无规则、无草稿</text>
    <rect x="460" y="140" width="164" height="90" rx="4" fill="none" stroke="var(--ink-soft)"/>
    <text x="472" y="164" fill="var(--ink)">/approvals/…(客服)</text>
    <text x="472" y="184" font-size="11" fill="var(--ink-soft)">全量</text>
    <text x="472" y="202" font-size="11" fill="var(--ink-soft)">没有登录时只是约定</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="166" y1="125" x2="236" y2="125"/>
    <line x1="386" y1="110" x2="460" y2="70"/>
    <line x1="386" y1="140" x2="460" y2="180"/>
  </g>
</svg>
<figcaption>裁剪发生在后端的出口。客户那几个接口(`/tickets/…`)默认只出客户那一份;审批的接口(`/approvals/…`)出全量,但要靠登录才能保证只有客服和财务调得到(今天没有登录,见下面的提醒)。</figcaption>
</figure>

## 第二步:后端按人裁剪,用白名单

裁剪函数写成一个独立的小模块,不 import 任何别的东西,好测:

```python
# supportpilot/src/supportpilot/api/audience.py
"""同一个事件,按看的人裁剪。客户走的接口一律过 for_customer;客服、财务走的接口不裁剪。

用白名单:没写进来的字段默认不给客户。以后后端给事件加了新字段,不会自动漏给客户。
"""

from typing import Any, Literal

Audience = Literal["customer", "staff"]


def for_customer(event: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """返回客户能看的那一份;返回 None 表示这个事件客户用不着,整条不推。"""
    if event in ("node", "token", "error"):  # 节点名、逐字文本、固定的出错提示:本来就是给用户看的
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
    return None  # tool,以及以后新增的、没想过要不要给客户的事件:默认不给


def for_audience(audience: Audience, event: str, data: dict[str, Any]) -> dict[str, Any] | None:
    return for_customer(event, data) if audience == "customer" else data
```

<div class="line-notes">

- `from typing import Any, Literal` `Any` 是「任何类型」,`Literal` 是字面量类型,相当于 TypeScript 的 `"customer" | "staff"`。
- `Audience = Literal["customer", "staff"]` 只有两种观众。财务和客服在后端是同一个:都能调审批接口。他们看到的不同是前端的选择,下面第三步讲。
- `def for_customer(event: str, data: dict[str, Any]) -> dict[str, Any] | None:` 参数是事件名和数据,返回裁剪后的数据,或者 `None`(整条不推)。返回类型的 `| None` 相当于 TypeScript 的 `| null`。
- `if event in ("node", "token", "error"):` 三种事件原样放行。`node` 只有节点名,`token` 是逐字文本,`error` 是 Day 467 定死的固定文案(堆栈只写服务端日志),它们本来就是给用户看的。
- `if data.get("node") == "check":` `step` 事件有五种,用 `node` 字段区分。`.get` 取不到时返回 None,不会抛 KeyError。
- `return {"type": "step", "node": "check", "passed": data["passed"], "problems": []}` 保留 `passed`,`problems` 换成空列表。前端的 reducer 在 `passed` 为 false 时清空草稿,这个信号必须留着;而「引用了不存在于资料中的编号:KB-refund-009」这种话是写给我们调试用的。
- `return None  # 分类、命中了哪几篇文章、有没有画像:客户不需要` 其余四种 `step`(load_customer、prepare_context、classify、retrieve)整条丢掉。77 个事件里 4 个。
- `req = data["request"]` 实测 interrupt 的 `request` 里有 `id`、`ticket_id`、`customer_id`、`invoice_id`、`amount_cny`、`rule`、`reason`、`status`、`note` 九个键。
- `"request": {"id": req["id"], "amount_cny": req["amount_cny"]}}` 代入 Day 467 录到的真实数据:`{"id": "RF-T000153-INV-202609-0002", "amount_cny": 950.0}`。不是「去掉不要的」,而是「只拿要的」:这就是白名单写法,以后 `request` 里再加十个字段,客户那一边也不会多出一个。
- `return {k: data[k] for k in ("ticket_id", "outcome", "reply", "turns") if k in data}` 字典推导式,只挑四个键。`if k in data` 防止数据里恰好没有某个键时抛 KeyError。
- `return None  # tool,以及以后新增的、没想过要不要给客户的事件:默认不给` 最后一行是白名单的灵魂:没有明确放行的,一律不给。四个 `tool` 事件在这里被丢掉。
- `def for_audience(audience: Audience, event: str, data: dict[str, Any])` 给 `_events` 用的入口。
- `return for_customer(event, data) if audience == "customer" else data` 客服那条线原样返回,同一个对象,不复制。

</div>

写测试之前先说一句:这个模块没有任何依赖,所以测试不用假 LLM、不用数据库、不用 FastAPI。测试里放一个「整段录音过一遍筛子」的用例,用 Day 469 录的 `web/fixtures/run.sse`:

```python
# supportpilot/tests/test_audience.py
import json
from pathlib import Path

import pytest

from supportpilot.api.audience import for_audience, for_customer

# 三条会泄露内部信息的事件,数据取自 Day 467 录到的真实事件的形状
INTERRUPT = {"type": "refund_approval", "ticket_id": "T000153", "draft": "您好……[KB-refund-001]",
             "needs_finance_review": False,
             "request": {"id": "RF-T000153-INV-202609-0002", "ticket_id": "T000153", "customer_id": "C0002",
                         "invoice_id": "INV-202609-0002", "amount_cny": 950.0, "rule": "annual_first_14_days",
                         "reason": "14 天内申请退款", "status": "pending",
                         "note": "已创建待审批的退款申请。不要告诉客户退款已完成,只能说已提交审核。"}}
DONE = {"ticket_id": "T000153", "outcome": "waiting_approval", "category": "refund", "reply": None, "turns": 1,
        "cost_cny": 0.02598, "waiting_on": ["approval"]}
TOOL = {"type": "tool", "name": "list_invoices", "args": '{"customer_id": "C0002"}', "error": False}


def test_tool_never_reaches_customer():
    assert for_customer("tool", TOOL) is None


def test_interrupt_keeps_only_id_and_amount():
    out = for_customer("interrupt", INTERRUPT)
    assert out == {"type": "refund_approval", "ticket_id": "T000153",
                   "request": {"id": "RF-T000153-INV-202609-0002", "amount_cny": 950.0}}
    text = json.dumps(out, ensure_ascii=False)
    for secret in ("note", "rule", "annual_first_14_days", "draft", "KB-refund", "C0002", "needs_finance_review"):
        assert secret not in text


def test_done_drops_cost_and_category():
    assert for_customer("done", DONE) == {"ticket_id": "T000153", "outcome": "waiting_approval", "reply": None, "turns": 1}


def test_check_step_keeps_verdict_but_not_reasons():
    step = {"type": "step", "node": "check", "passed": False, "problems": ["引用了不存在于资料中的编号:KB-refund-009"]}
    assert for_customer("step", step) == {"type": "step", "node": "check", "passed": False, "problems": []}
    assert for_customer("step", {"type": "step", "node": "classify", "category": "refund"}) is None


def test_unknown_event_is_hidden_by_default():
    assert for_customer("debug_dump", {"x": 1}) is None


def test_staff_gets_everything():
    assert for_audience("staff", "interrupt", INTERRUPT) is INTERRUPT
    assert for_audience("staff", "tool", TOOL) is TOOL


@pytest.mark.skipif(not Path("web/fixtures/run.sse").exists(), reason="没有录好的事件文件")
def test_recorded_run_has_no_secret_for_customer():
    """把整段录音过一遍客户的筛子,全文搜不到内部字段。"""
    blocks = Path("web/fixtures/run.sse").read_text().strip().split("\n\n")
    shown = []
    for b in blocks:
        event = b.split("\n")[0].removeprefix("event: ")
        data = json.loads(b.split("\n")[1].removeprefix("data: "))
        out = for_customer(event, data)
        if out is not None:
            shown.append(json.dumps(out, ensure_ascii=False))
    text = "\n".join(shown)
    assert len(shown) == 69  # 77 条里去掉 4 条 tool、4 条不相干的 step
    for secret in ("customer_id", "list_invoices", "annual_first_14_days", "cost_cny", "不要告诉客户"):
        assert secret not in text
```

<div class="line-notes">

- `from supportpilot.api.audience import for_audience, for_customer` 只 import 这一个模块,测试 0.08 秒就能跑完,不拉起 FastAPI。
- `INTERRUPT = {"type": "refund_approval"` 三个常量的形状来自 Day 467 录到的真实事件。`note` 的内容是 Day 452 业务函数写给模型的提示。
- `def test_tool_never_reaches_customer():` 最基础的一条:`tool` 事件返回 `None`。
- `out = for_customer("interrupt", INTERRUPT)` 代入上面的字典,`out` 只剩 `type`、`ticket_id`、`request.id`、`request.amount_cny` 四项。
- `text = json.dumps(out, ensure_ascii=False)` 把结果转成字符串,下面逐个搜内部词。比起断言「某个键不在」,搜全文能挡住「换了个地方又冒出来」。
- `for secret in ("note", "rule",` 七个词,包括 `C0002`(内部客户编号)和 `KB-refund`(草稿里的引用编号)。
- `assert for_customer("done", DONE) == {` 摘要从八个键剩四个。
- `step = {"type": "step", "node": "check", "passed": False,` 质检退回的那一条,`problems` 里是我们自己的诊断。结果里 `problems` 是 `[]`,`passed` 还是 `False`。
- `def test_unknown_event_is_hidden_by_default():` 白名单的核心保证:一个从没见过的事件名 `debug_dump` 默认不给客户。以后有人加了新事件,忘了写进这个函数,客户也看不到。
- `assert for_audience("staff", "interrupt", INTERRUPT) is INTERRUPT` `is` 比较的是同一个对象,说明客服那条线没有复制也没有改动。
- `@pytest.mark.skipif(not Path("web/fixtures/run.sse").exists(),` 录音文件在 `web/` 下,从 supportpilot 根目录跑才找得到;找不到就跳过而不是报错。
- `event = b.split("\n")[0].removeprefix("event: ")` 一段 SSE 文本是 `event: node\ndata: {...}`,第一行去掉前缀就是事件名。`removeprefix` 是 Python 3.9 加的,相当于 JS 里手写的 `s.startsWith(p) ? s.slice(p.length) : s`。
- `assert len(shown) == 69` 77 个事件,4 个 `tool` 加 4 个非质检的 `step` 被丢掉,剩 69。这个数字也出现在下面前端脚本的输出里,两边对得上说明 Python 和 TypeScript 两份白名单是一致的。
- `for secret in ("customer_id", "list_invoices",` 整段录音过完以后,全文里不能出现这五个词。

</div>

```bash
uv run pytest tests/test_audience.py -q
```

```text
.......                                                                  [100%]
7 passed in 0.08s
```

### 接进 app.py

Day 467 的 `_events` 把 LangGraph 的流翻译成七种事件。要改的地方有四处。**这一小节的 Python 我没有在 SupportPilot 真仓库里跑**:写手这边没有仓库副本,上面的 `audience.py` 和测试是独立跑通的,接线部分请你在自己的仓库里改完跑 `make test`。

```python
# supportpilot/src/supportpilot/api/app.py(四处改动)
from .audience import Audience, for_audience, for_customer   # ① 新增 import


def _sse(event: str, data: Any, audience: Audience = "customer") -> ServerSentEvent | None:   # ② 多一个 audience,返回值可能是 None
    """自己序列化:中文原样输出,datetime 之类转字符串。按观众裁剪,这位观众看不到的事件返回 None。"""
    shown = for_audience(audience, event, data)
    if shown is None:
        return None
    return ServerSentEvent(event=event, raw_data=json.dumps(shown, ensure_ascii=False, default=str))


def _events(graph, payload: Any, ticket_id: str, audience: Audience = "customer") -> Generator[ServerSentEvent, None, None]:  # ③
    """……(Day 471 的 _events,docstring 不变)"""
    RUNNING.add(ticket_id)
    stream = graph.stream(payload, _cfg(ticket_id), stream_mode=["updates", "custom"])
    try:
        for mode, chunk in stream:
            if mode == "custom":
                if (out := _sse(chunk["type"], chunk, audience)) is not None:
                    yield out
                continue
            for node, update in chunk.items():
                if node == "__interrupt__":
                    if (out := _sse("interrupt", update[0].value, audience)) is not None:
                        yield out
                elif update is None or node.startswith("__"):
                    continue
                elif (out := _sse("node", {"node": node}, audience)) is not None:
                    yield out
    except Exception:
        log.exception("ticket %s failed", ticket_id)
        if (out := _sse("error", {"message": "处理出错了,已经记录,请稍后重试"}, audience)) is not None:
            yield out
        return
    finally:
        stream.close()
        RUNNING.discard(ticket_id)
    if (out := _sse("done", _summary(graph, ticket_id), audience)) is not None:
        yield out


@app.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: str, graph: Graph) -> dict:
    if not graph.get_state(_cfg(ticket_id)).values:
        raise HTTPException(404, "工单还没有处理过")
    return for_customer("done", _summary(graph, ticket_id)) or {}   # ④ 客户的 GET 也过筛子


# decide 里:yield from _events(graph, Command(resume=d.model_dump()), ticket_id, audience="staff")
```

<div class="line-notes">

- `from .audience import Audience, for_audience, for_customer` 相对导入,`audience.py` 和 `app.py` 同在 `api/` 目录。
- `def _sse(event: str, data: Any, audience: Audience = "customer") -> ServerSentEvent | None:` 默认值是 `"customer"`:调用的人什么都不写,得到的是最保守的那一份。要给客服全量,得明明白白写出 `audience="staff"`。**默认给最少,是这一步最重要的设计。**
- `shown = for_audience(audience, event, data)` 裁剪发生在序列化之前。
- `if shown is None:` `None` 表示这位观众不该收到这个事件。
- `return ServerSentEvent(event=event, raw_data=json.dumps(shown,` 序列化的是裁剪后的 `shown`,不是原始 `data`。
- `def _events(graph, payload: Any, ticket_id: str, audience: Audience = "customer")` 同样默认客户。Day 467 的 `run_ticket`、`follow_up`、Day 471 的 `resume` 三个客户接口一个字都不用改,自动走客户那一份。
- `if (out := _sse(chunk["type"], chunk, audience)) is not None:` 海象运算符 `:=` 在判断的同时赋值。`_sse` 可能返回 `None`,为 `None` 时不 `yield`。代入第一个 `tool` 事件:客户那条线 `out` 是 `None`,这一轮什么也不推;客服那条线 `out` 是个事件,照推。
- `elif (out := _sse("node", {"node": node}, audience)) is not None:` 节点名对谁都是放行的,写成 `elif` 是为了少一层缩进。
- `if (out := _sse("error",` 出错的固定文案对两个观众都放行。
- `if (out := _sse("done", _summary(graph, ticket_id), audience)) is not None:` `done` 事件在客户那一条线上被去掉 `cost_cny`、`category`、`waiting_on`。
- `return for_customer("done", _summary(graph, ticket_id)) or {}` GET 接口返回的是同一份摘要,也要裁剪。`for_customer("done", ...)` 对 `done` 不会返回 `None`,`or {}` 只是让类型检查器安心。
- `# decide 里:yield from _events(` 审批接口是客服和财务调的,推全量。注意这一行不是「改成全量」那么简单,见下面的提醒。

</div>

**这几处改完,会让几个旧测试变红。** Day 467 的 `test_api.py` 直接调 `api._events(...)` 并断言事件里有 `tool` 和 `interrupt`:现在默认是客户那一份,`tool` 没了,要给这几处调用补上 `audience="staff"`。走 `TestClient` 打 `/run` 并断言 `tool` 的用例,要改成断言「没有 `tool`」,再补一条走 `/approvals/…` 断言「有 `tool`」的。我在写手这边没法跑,所以请你改完用 `uv run pytest -q` 对一遍。

还有一个必须说清楚的提醒:**今天的 `/approvals` 接口没有登录。** 谁都能 `curl -X POST /approvals/T000153`,拿到全量事件,还能批退款。今天做的只是把「该给谁多少」在接口层分开;真正保证只有客服和财务调得到,要靠身份。登录的基础在 [Day 82](/blog/agent-zero/day-082-auth-1/),这套系统里「身份绑到工具层」是 [Day 488](/blog/agent-zero/day-488-defenses/) 的内容,今天不展开。

### 审批人要看的草稿

[Day 470](/blog/agent-zero/day-470-ui-components/) 提过的缺口:`/approvals` 只查了 `biz.refund_requests` 表,表里没有草稿。草稿在哪?在 LangGraph 的 checkpoint 里,是状态里的 `draft` 键(Day 463 实测停在审批时 `values` 有 `draft`)。先用一个三节点的小图确认「停在 interrupt 的图,`get_state` 读得到草稿」:

```python
# supportpilot/scratch/d472/draft_probe.py
# 审批人要看的草稿放在哪:停在 interrupt 的图,用 get_state 能不能读到 draft?(三个节点的小图,不调模型)
from typing import TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt


class S(TypedDict, total=False):
    draft: str
    reply: str


def draft(state: S) -> S:
    return {"draft": "您好,退款申请已提交。[KB-refund-001]"}


def approval(state: S) -> S:
    decision = interrupt({"type": "refund_approval", "draft": state["draft"]})
    return {"reply": state["draft"] + (" 已通过。" if decision["approved"] else " 已驳回。")}


g = StateGraph(S)
g.add_node("draft", draft)
g.add_node("approval", approval)
g.add_edge(START, "draft")
g.add_edge("draft", "approval")
g.add_edge("approval", END)
graph = g.compile(checkpointer=InMemorySaver())

cfg = {"configurable": {"thread_id": "T000153"}}
graph.invoke({}, cfg)  # 停在 approval 的 interrupt 上

snap = graph.get_state(cfg)
print("next:", snap.next)
print("values 的键:", sorted(snap.values))
print("草稿:", snap.values.get("draft"))
print("tasks[0].interrupts:", snap.tasks[0].interrupts[0].value)

graph.invoke(Command(resume={"approved": True}), cfg)
print("批完以后 values 的键:", sorted(graph.get_state(cfg).values))
```

<div class="line-notes">

- `class S(TypedDict, total=False):` 只有两个键的最小状态,`total=False` 表示键可以不存在,和 Day 464 的 `SupportState` 一样。
- `def draft(state: S) -> S:` 第一个节点只写 `draft`。真实图里这是 `draft` 节点调模型写出的草稿。
- `decision = interrupt({"type": "refund_approval", "draft": state["draft"]})` 停下,把一个字典交给调用方。这就是前端 `interrupt` 事件的 `data`。恢复时 `interrupt()` 的返回值是 `Command(resume=...)` 里的东西。
- `return {"reply": state["draft"] + (" 已通过。" if decision["approved"] else " 已驳回。")}` 恢复以后拼出定稿。
- `graph = g.compile(checkpointer=InMemorySaver())` 没有 checkpointer 就没有 `get_state`,所以内存版也要带上。
- `graph.invoke({}, cfg)  # 停在 approval 的 interrupt 上` 输入是空字典,图跑 `draft`,进 `approval`,停在 `interrupt()`。
- `snap = graph.get_state(cfg)` 读最新快照,`snap.next` 是接下来要跑的节点。
- `print("草稿:", snap.values.get("draft"))` 草稿在 `values` 里,不需要从 interrupt 的载荷里翻。
- `snap.tasks[0].interrupts[0].value` 另一条路:快照的 `tasks` 里挂着等待中的 interrupt,`.value` 就是上面那个字典。两条路都行;读 `values["draft"]` 更直接。
- `graph.invoke(Command(resume={"approved": True}), cfg)` 批准,图继续跑完。

</div>

```bash
uv run python scratch/d472/draft_probe.py
```

真实输出:

```text
next: ('approval',)
values 的键: ['draft']
草稿: 您好,退款申请已提交。[KB-refund-001]
tasks[0].interrupts: {'type': 'refund_approval', 'draft': '您好,退款申请已提交。[KB-refund-001]'}
批完以后 values 的键: ['draft', 'reply']
```

停在审批时 `values` 里只有 `draft`,批完才多出 `reply`。接进 `list_approvals`(同样是**没在真仓库里跑**的改动,Day 470 练习 2 已经加过 `needs_finance_review`):

```python
# supportpilot/src/supportpilot/api/app.py(list_approvals 整个换成这样)
@app.get("/approvals")
def list_approvals(graph: Graph) -> list[dict]:
    rows = R["conn"].execute(
        "SELECT r.id, r.ticket_id, r.amount_cny, r.rule, r.reason, r.created_at, c.name AS customer_name "
        "FROM biz.refund_requests r JOIN biz.customers c ON c.id = r.customer_id "
        "WHERE r.status = 'pending' ORDER BY r.created_at").fetchall()
    line = R["deps"].settings.refund_review_threshold   # Day 470 练习 2:复核线只在后端存一份
    return [biz._jsonable(r) | {"created_at": str(r["created_at"]),
                                "needs_finance_review": float(r["amount_cny"]) > line,
                                "draft": graph.get_state(_cfg(r["ticket_id"])).values.get("draft", "")}
            for r in rows]
```

<div class="line-notes">

- `def list_approvals(graph: Graph) -> list[dict]:` 以前不需要图,现在要读 checkpoint,所以多一个依赖。FastAPI 会按 `Graph` 这个别名自动注入。
- `line = R["deps"].settings.refund_review_threshold` Day 470 练习 2 的写法:复核线只在后端存一份,前端不再写死 1000。
- `"needs_finance_review": float(r["amount_cny"]) > line,` `amount_cny` 从库里出来是 `Decimal`,先转 float 再比。950 对 1000 得 False。
- `"draft": graph.get_state(_cfg(r["ticket_id"])).values.get("draft", "")` 每一行按它的工单号读一次 checkpoint。`.get("draft", "")` 防止快照里没有草稿时抛错。这是「一行一次读」(N+1 查询);待审批列表最多几十行,先这样,多了再批量读。

</div>

## 第三步:前端按人收敛

后端只给客户该看的了,前端还要决定怎么显示。分三块。

### 客户:过程收成阶段

客户不需要知道「分诊」「检索」「质检」这些词。下面的小模块把内部节点名换成客户听得懂的话,表里没有的节点(`prepare_context`、`check`、`finalize`)不显示:

```ts
// supportpilot/web/src/lib/stages.ts
// 客户界面里的「处理过程」:把内部节点名换成客户听得懂的阶段。没写进表里的节点(prepare_context、check、finalize)客户不需要知道。
export const CUSTOMER_STAGES: Record<string, string> = {
  load_customer: "正在查询您的账户",
  classify: "正在了解您的问题",
  retrieve: "正在查找相关帮助文章",
  act: "正在核对您的订阅和账单",
  draft: "正在为您整理答复",
  approval: "退款申请已提交审核",
  handoff: "已转给人工客服",
};

// 内部节点按发生顺序进来,出去的是去了重复、翻译过的阶段文字。后端会重写草稿(质检退回),draft 可能出现两次
export function customerStages(steps: string[]): string[] {
  const out: string[] = [];
  for (const node of steps) {
    const text = CUSTOMER_STAGES[node];
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}
```

<div class="line-notes">

- `export const CUSTOMER_STAGES: Record<string, string> = {` 一张翻译表。键是后端的节点名,值是客户看到的话。「正在……」是进行时:客户看到的是正在发生的事,不是我们的内部流程。
- `act: "正在核对您的订阅和账单",` 注意这一句不说「调用了 list_invoices」。客户关心的是我们在核对什么,不是用了哪个工具。
- `handoff: "已转给人工客服",` 转人工是客户最需要看到的结局之一,标题和这一条阶段两处都有(Day 470 的 `headline`)。
- `export function customerStages(steps: string[]): string[] {` 输入是 reducer 里 `steps`(节点名按发生顺序),输出是要显示的文字列表。
- `const text = CUSTOMER_STAGES[node];` 代入第一轮的七个节点 `load_customer, prepare_context, classify, retrieve, act, draft, check`:`prepare_context` 和 `check` 取到 `undefined`。
- `if (text && !out.includes(text)) out.push(text);` 有文字且还没出现过才加。质检退回时 `draft` 会出现第二次,去重以后客户看到「正在为您整理答复」只有一行,不会觉得我们在反复折腾。最终 `out` 是五项。

</div>

### 一个 RunView,两种密度

`RunView` 加一个 `audience` 属性,默认 `customer`。和后端的默认值同一个思路:**忘了传,得到的是少的那一份。** 完整文件如下:

```tsx
// supportpilot/web/src/components/RunView.tsx
// 一次运行的全部界面。只读 RunState,不知道数据从哪来。audience 决定信息密度:
//   customer(默认):阶段提示、最终回复、引用;没有工具参数、质检意见、花费
//   staff:全过程,Day 470 的样子
"use client";
import { useEffect, useRef } from "react";
import { STEP_NAMES } from "@/lib/events";
import type { RunState } from "@/lib/run";
import { customerStages } from "@/lib/stages";
import { Reply } from "./Reply";
import { ToolCard } from "./ToolCard";

export type Audience = "customer" | "staff";

const STATUS_TEXT: Record<RunState["status"], string> = {
  idle: "",
  running: "处理中",
  waiting_approval: "已提交审批,等客服处理",
  done: "已完成",
  error: "出错了",
  stopped: "已停止接收",
  reconnecting: "正在接回进度",
};

function headline(s: RunState, audience: Audience): string {
  if (s.status === "done" && s.summary?.outcome === "escalated") return "已转人工客服";
  if (audience === "customer" && s.status === "waiting_approval") return "退款申请已提交审核";
  return STATUS_TEXT[s.status];
}

// level 是这块内容的标题级别:页面标题是 h1 时用 2,放在卡片(自己有 h2)里时用 3,标题级别不能跳
type Props = { state: RunState; id: string; audience?: Audience; level?: 2 | 3; onStop?: () => void; onResume?: () => void };

export function RunView({ state, id, audience = "customer", level = 2, onStop, onResume }: Props) {
  const Heading = `h${level}` as const;
  const staff = audience === "staff";
  const resumeRef = useRef<HTMLButtonElement>(null);
  // Day 471:点了「停止」,停止按钮就消失了,键盘焦点会掉回 <body>。把焦点交给「继续处理」
  useEffect(() => {
    if (state.status === "stopped") resumeRef.current?.focus();
  }, [state.status]);

  if (state.status === "idle") return null;
  const running = state.status === "running";
  const final = state.summary?.reply;
  // 客户在等审批时看不到草稿:草稿还没人批,批完以后也可能被改。他们只会看到上面那句「已提交审核」
  const showDraft = staff || state.status !== "waiting_approval";

  return (
    <section className="run" aria-busy={running || state.status === "reconnecting"} aria-labelledby={`${id}-status`}>
      <header className="run-head">
        {/* 只把状态变化读给屏幕阅读器听;逐字的 token 不播报 */}
        <Heading id={`${id}-status`} aria-live="polite" className={`badge badge-${state.status}`}>
          {headline(state, audience)}
          {staff && state.summary?.cost_cny !== undefined && ` · 花费 ¥${state.summary.cost_cny}`}
        </Heading>
        {running && onStop && (
          <button type="button" className="btn-ghost" onClick={onStop}>停止</button>
        )}
      </header>

      {staff ? (
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
      ) : (
        <ol className="steps" aria-label="处理进度">
          {customerStages(state.steps).map((text) => (
            <li key={text}>
              <span className="tick" aria-hidden="true">✓</span>
              {text}
            </li>
          ))}
          {running && <li className="pending">…</li>}
        </ol>
      )}

      {staff && state.rewrites > 0 && (
        <details className="note">
          <summary>质检退回 {state.rewrites} 次{running && ",正在重写回复"}</summary>
          <ol>{state.rejections.map((ps, i) => <li key={i}>{ps.join(";")}</li>)}</ol>
        </details>
      )}

      {staff && state.tools.length > 0 && (
        <ul className="tools">{state.tools.map((t, i) => <ToolCard key={i} tool={t} />)}</ul>
      )}

      {state.approval && (
        <p className="note note-approval">
          {staff ? "退款申请" : "退款申请编号"} {state.approval.request.id}(¥{state.approval.request.amount_cny})已提交审批
          {staff && state.approval.needsFinanceReview && ",金额超过复核线,需要财务复核"}
          {!staff && state.status === "waiting_approval" && ",结果出来以后会在这个工单里通知您"}
        </p>
      )}

      {final ? (
        <Reply text={final} id={id} />
      ) : (
        showDraft && state.draft && (
          <p className={`reply-body ${running ? "typing" : "draft"}`} aria-hidden={running}>
            {!running && <span className="muted">{state.status === "waiting_approval" ? "草稿,审批后定稿:" : "没写完的草稿:"}</span>}
            {state.draft}
          </p>
        )
      )}

      {state.status === "stopped" && (
        <p className="note">
          {staff ? "只是不再接收进度:后台正在执行的那一步会跑完,之后的步骤不会再跑。" : "只是不再显示进度,后台正在做的那一步会做完。"}{" "}
          {onResume && <button ref={resumeRef} type="button" className="link" onClick={onResume}>继续处理</button>}
        </p>
      )}

      {state.error && (
        <p className="error" role="alert">
          {state.error}
          {state.status === "error" && onResume && (
            <> <button type="button" className="link" onClick={onResume}>重试</button></>
          )}
        </p>
      )}
    </section>
  );
}
```

<div class="line-notes">

- `export type Audience = "customer" | "staff";` 前端也只分两档。客服和财务在前端的区别由工作台页面用不同的属性组合出来,下面讲。
- `waiting_approval: "已提交审批,等客服处理",` 这句是客服视角的措辞,客户那边由 `headline` 换成「退款申请已提交审核」。
- `if (s.status === "done" && s.summary?.outcome === "escalated") return "已转人工客服";` 两种观众都一样,优先于别的判断。
- `if (audience === "customer" && s.status === "waiting_approval") return "退款申请已提交审核";` 客户看到的标题。Playwright 里的 `waitForSubmitted` 就是等这个标题出现,下面会用到。
- `type Props = { state: RunState; id: string; audience?: Audience; level?: 2 | 3;` `audience` 和 `level` 都是可选的,都有默认值,Day 470 的调用方不用改。
- `export function RunView({ state, id, audience = "customer", level = 2, onStop, onResume }: Props) {` 解构时直接写默认值。忘了传 `audience` 就是客户那一档。
- `const Heading = `h${level}` as const;` 模板字符串得到 `"h2"` 或 `"h3"`,`as const` 让 TypeScript 把类型收窄成这两个字面量,所以下面能当 JSX 标签用。这个写法来自后面 axe 查出的「标题级别跳了」,先看到就行。
- `const staff = audience === "staff";` 布尔值,下面七八处判断都用它。
- `useEffect(() => {` 这一段是 Day 471 的:点「停止」后把焦点交给「继续处理」。放在 `if (state.status === "idle") return null;` 前面,因为 hook 不能放在提前 return 的后面。
- `const showDraft = staff || state.status !== "waiting_approval";` 客户在等审批时不显示草稿。代入退款第一轮:`waiting_approval` 时 `showDraft` 对客户是 false,对客服是 true。
- `<Heading id={`${id}-status`} aria-live="polite" ...` 状态标题,既是标题也是 live region(Day 471)。`level` 是 2 时渲染成 `h2`。
- `{staff && state.summary?.cost_cny !== undefined && ` · 花费 ¥${state.summary.cost_cny}`}` 只有客服看到花费。`Summary.cost_cny` 现在是可选的(客户那条线不推),所以要判断 `!== undefined`,否则客服页上会出现「花费 ¥undefined」。
- `{staff ? (` 过程区两种渲染:客服是 Day 470 的节点名加细节,客户是 `customerStages` 翻译后的阶段。
- `<ol className="steps" aria-label="处理进度">` 客户那一列有可访问名称,读屏软件会读「处理进度,列表,5 项」,Playwright 也用它定位。
- `{customerStages(state.steps).map((text) => (` 代入第一轮跑完:五行「正在查询您的账户」「正在了解您的问题」「正在查找相关帮助文章」「正在核对您的订阅和账单」「正在为您整理答复」。
- `{staff && state.rewrites > 0 && (` 质检退回的折叠框只给客服。
- `{staff && state.tools.length > 0 && (` 工具卡片只给客服。客户这一档里,即使 `state.tools` 非空(用客服那条线的数据喂进来),也不会渲染。
- `{staff ? "退款申请" : "退款申请编号"} {state.approval.request.id}(¥` 客户看到「退款申请编号 RF-T000153-INV-202609-0002(¥950)已提交审批,结果出来以后会在这个工单里通知您」。编号是客户日后咨询时可以引用的。
- `{staff && state.approval.needsFinanceReview && ",金额超过复核线,需要财务复核"}` 复核线是内部政策,客户不看。
- `showDraft && state.draft && (` 没有定稿时才看草稿,而且要过 `showDraft`。
- `{state.status === "waiting_approval" ? "草稿,审批后定稿:" : "没写完的草稿:"}` Day 471 加的两种提示。
- `{staff ? "只是不再接收进度:` 停止后的说明,客服版说得精确,客户版去掉了「后面的步骤不会再跑」这类内部说法。
- `<button ref={resumeRef} type="button" className="link" onClick={onResume}>继续处理</button>` `ref` 让上面的 `useEffect` 能把焦点交给它。
- `{state.status === "error" && onResume && (` 出错后的「重试」按钮来自 Day 471 练习 1,两种观众都有。

</div>

注意这里有个取舍:`staff` 档在客户页面上永远用不到(`app/page.tsx` 不传 `audience`,用默认值)。把客服版放在同一个组件里,是因为两边 90% 的代码一样(状态、停止、重试、回复)。如果以后两边长得越来越不一样,拆成两个组件也完全合理。

### 工作台:客服和财务

[Day 470](/blog/agent-zero/day-470-ui-components/) 的工作台只有一种卡片。现在加一个「我是」选择:客服看到申请编号和工单,批完以后看全过程;财务只看做决定要的东西,批完以后看的是**客户那一档**,因为财务批完最想确认的就是「客户会收到什么」。两者都能看到要发给客户的草稿,这是补上 Day 470 留的缺口。

```tsx
// supportpilot/web/src/app/desk/page.tsx  工作台:待审批列表。同一份数据,客服和财务看到的不一样
"use client";
import { useCallback, useEffect, useState } from "react";
import { RunView, type Audience } from "@/components/RunView";
import { decide, listApprovals, type PendingRefund } from "@/lib/api";
import { useRun } from "@/lib/useRun";

type Role = "support" | "finance";

// 客服要把「Agent 做了什么」看全:申请编号、工单、规则、原因,批完以后看全过程。
// 财务只要做决定的最少信息:谁、多少钱、依据哪条规则、要发给客户的是什么;批完以后只看客户会看到的样子。
const DENSITY: Record<Role, Audience> = { support: "staff", finance: "customer" };

function ApprovalCard({ r, role }: { r: PendingRefund; role: Role }) {
  const [note, setNote] = useState("");
  const { state, start } = useRun();
  const decided = state.status !== "idle";

  function go(approved: boolean) {
    start((signal) => decide(r.ticket_id, { approved, approver: "demo-finance", note }, signal));
  }

  return (
    <article className="card" aria-labelledby={`h-${r.id}`}>
      <h2 id={`h-${r.id}`}>
        {role === "support" ? `${r.id} · ` : ""}{r.customer_name} · ¥{r.amount_cny}
      </h2>
      <p className="muted">
        工单 {r.ticket_id} · 规则 <code>{r.rule}</code> · 原因:{r.reason}
      </p>
      {/* 复核线只在后端存一份,后端算好 needs_finance_review,前端照着显示 */}
      {r.needs_finance_review && <p className="warn">金额超过复核线,按政策需要财务复核</p>}
      <figure className="draft-box">
        <figcaption>批准后客户会收到(草稿,定稿时引用编号会换成文章链接):</figcaption>
        <blockquote>{r.draft}</blockquote>
      </figure>
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
      <RunView state={state} id={`run-${r.id}`} audience={DENSITY[role]} level={3} />
    </article>
  );
}

export default function DeskPage() {
  const [role, setRole] = useState<Role>("support");
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
      {/* 演示项目没有登录,角色是手动切的。真实产品里角色来自登录态,后端按角色决定能不能调这个接口 */}
      <fieldset className="roles">
        <legend>我是</legend>
        {(["support", "finance"] as const).map((v) => (
          <label key={v}>
            <input type="radio" name="role" value={v} checked={role === v} onChange={() => setRole(v)} />
            {v === "support" ? "客服" : "财务"}
          </label>
        ))}
      </fieldset>
      {error && <p className="error" role="alert">{error}</p>}
      {items === null && !error && <p className="muted">加载中…</p>}
      {items?.length === 0 && <p className="muted">没有待审批的退款。去客户视角提交一张退款工单试试。</p>}
      {/* 审批完不立刻从列表里移除:要看到恢复后的流程跑完,下次刷新再消失 */}
      {items?.map((r) => <ApprovalCard key={r.id} r={r} role={role} />)}
    </div>
  );
}
```

<div class="line-notes">

- `type Role = "support" | "finance";` 前端的角色名,和后端的 `Audience` 不是一回事:后端只分「客户」和「员工」,员工里的细分是页面的展示选择。
- `const DENSITY: Record<Role, Audience> = { support: "staff", finance: "customer" };` 一行决定两个角色批完以后看哪一档。财务用 `customer` 档,看到的就是「客户将看到的样子」:阶段提示、定稿回复和引用,没有工具和花费。
- `function ApprovalCard({ r, role }: { r: PendingRefund; role: Role }) {` 一张卡片对应一笔待审批退款。`useRun()` 放在卡片里,每张卡片自己有一个运行状态,互不干扰(Day 470)。
- `start((signal) => decide(r.ticket_id, { approved, approver: "demo-finance", note }, signal));` 点通过或驳回,打开审批流。这一条流走 `/approvals/…`,后端按 `audience="staff"` 给全量。
- `{role === "support" ? `${r.id} · ` : ""}{r.customer_name} · ¥{r.amount_cny}` 客服的标题带申请编号,代入一张卡片是「RF-T000001-INV-202609-0002 · 李娜 · ¥950」,财务的是「李娜 · ¥950」。
- `工单 {r.ticket_id} · 规则 <code>{r.rule}</code> · 原因:{r.reason}` 工单号两种角色都显示:财务要靠它和客服对口径,也是测试里找卡片的依据。
- `{r.needs_finance_review && <p className="warn">` Day 470 写死的 1000 元常量没有了,直接读后端算好的 `needs_finance_review`。
- `<blockquote>{r.draft}</blockquote>` 本节补的东西:审批人批之前就能看到客户将收到的文字。React 把它当纯文本渲染,和 Day 470 的原则一致。
- `{!decided && (` 点过通过或驳回后,按钮收起,避免重复提交。
- `<RunView state={state} id={`run-${r.id}`} audience={DENSITY[role]} level={3} />` 卡片里已经有一个 `h2`,所以 `RunView` 的标题用 `h3`。这一行的 `level={3}` 是下面 axe 的第二条告警逼出来的。
- `const [role, setRole] = useState<Role>("support");` 默认客服。
- `<fieldset className="roles">` 一组单选按钮要用 `fieldset` 加 `legend` 包起来,读屏软件才会读「我是,分组」。
- `{(["support", "finance"] as const).map((v) => (` `as const` 让 `v` 的类型是 `"support" | "finance"`,而不是 `string`。
- `<input type="radio" name="role" value={v} checked={role === v} onChange={() => setRole(v)} />` 受控的单选按钮。Playwright 里用 `getByRole("radio", { name: "财务" })` 找到它,`label` 的文字就是它的可访问名称。
- `{items?.map((r) => <ApprovalCard key={r.id} r={r} role={role} />)}` 切换角色时,所有卡片按新角色重新渲染,已经批过的卡片里的 `useRun` 状态保留。

</div>

补几行样式(加在 `globals.css` 末尾):

```css
/* supportpilot/web/src/app/globals.css(末尾新增) */
.roles { border: 0; padding: 0; margin: 0 0 1rem; display: flex; gap: 1rem; align-items: center; }
.roles legend { float: left; margin-right: .8rem; color: var(--soft); }
.draft-box { margin: .6rem 0; padding: .6rem .9rem; border-left: 3px solid var(--rule); background: var(--card); }
.draft-box figcaption { color: var(--faint); font-size: 13px; }
.draft-box blockquote { margin: .3rem 0 0; }
```

<div class="line-notes">

- `.roles { border: 0; padding: 0; margin: 0 0 1rem; display: flex;` `fieldset` 默认有一圈边框和内边距,去掉后横着排。
- `.roles legend { float: left; margin-right: .8rem; color: var(--soft); }` `legend` 默认会骑在边框上,`float: left` 让它变成一个普通的行内标签。
- `.draft-box { margin: .6rem 0; padding: .6rem .9rem; border-left: 3px solid var(--rule);` 左边一条竖线,像引用块。
- `.draft-box figcaption { color: var(--faint); font-size: 13px; }` 这里用了 `--faint`,下面 axe 会告诉你它的对比度不够。
- `.draft-box blockquote { margin: .3rem 0 0; }` 去掉 `blockquote` 默认的左右缩进。

</div>

### 假后端也要跟着裁剪

`fake_api.mts` 要和真后端说同一套话,否则前端在假后端上调好的东西,换到真后端会不一样。改五处:加一个和 `audience.py` 对应的 `forCustomer`、`streamTo` 多一个观众参数、`/approvals` 的行和真后端 `list_approvals` 的列一致(带 `draft`)、`GET /tickets/:id` 也过筛子、再加一个「大额」关键词用来测复核线。核心两段:

```ts
// supportpilot/web/scripts/fake_api.mts(新增 forCustomer 和 show,放在 node() 下面)
type Audience = "customer" | "staff";

// 和后端 api/audience.py 的 for_customer 同一套白名单。后端改了,这里跟着改
function forCustomer(e: Ev): Ev | null {
  const d = e.data as Record<string, any>;
  switch (e.event) {
    case "node": case "token": case "error": return e;
    case "step": return d.node === "check" ? { event: "step", data: { type: "step", node: "check", passed: d.passed, problems: [] } } : null;
    case "interrupt": return { event: "interrupt", data: { type: d.type, ticket_id: d.ticket_id, request: { id: d.request.id, amount_cny: d.request.amount_cny } } };
    case "done": return { event: "done", data: { ticket_id: d.ticket_id, outcome: d.outcome, reply: d.reply, turns: d.turns } };
    default: return null; // tool,以及以后新增、没想过要不要给客户的事件:默认不给
  }
}
const show = (aud: Audience, e: Ev) => (aud === "customer" ? forCustomer(e) : e);
```

<div class="line-notes">

- `type Audience = "customer" | "staff";` 和前端 `RunView` 里的同名类型一样,但这是假后端自己的一份。
- `function forCustomer(e: Ev): Ev | null {` 和 Python 的 `for_customer` 逐条对应,返回 `null` 就是「不推」。
- `const d = e.data as Record<string, any>;` 假后端是测试用的脚本,这里用 `any` 省事;生产代码里不要这么写。
- `case "node": case "token": case "error": return e;` 三种放行,和 Python 里 `if event in ("node", "token", "error")` 对应。
- `case "step": return d.node === "check"` 只留质检的结论,`problems` 换成 `[]`。
- `case "interrupt": return { event: "interrupt"` 只拿申请编号和金额。
- `case "done": return { event: "done", data: { ticket_id` 摘要四个字段。
- `default: return null;` 白名单的默认拒绝。
- `const show = (aud: Audience, e: Ev) => (aud === "customer" ? forCustomer(e) : e);` 客户走筛子,员工原样。

</div>

```ts
// supportpilot/web/scripts/fake_api.mts(streamTo 里:断线前多等一会儿;写事件前先过 show)
async function streamTo(res: ServerResponse, t: Ticket, evs: Ev[], after: Phase, aud: Audience, cutAt = -1) {
  res.writeHead(200, { ...CORS, "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
  const tokenMs = t.subject.includes("慢") ? 300 : 30;
  for (let i = 0; i < evs.length; i++) {
    if (i === cutAt) {
      await sleep(400); // 先让写出去的事件到达浏览器再掐断。刚写完立刻掐,前端有时一个事件都没收到
      res.destroy(); // 「断线」:不发 done,直接掐掉 TCP 连接
    }
    if (res.destroyed) {
      t.phase = "half";
      t.after = after;
      t.rest = evs.slice(evs.findIndex((e, j) => j >= i && e.event === "node"));
      return;
    }
    if (evs[i] === DONE) t.phase = after;
    const shown = show(aud, evs[i] === DONE ? { event: "done", data: summary(t) } : evs[i]);
    if (!shown) continue; // 这个事件这位观众看不到:不推,也不用等
    res.write(`event: ${shown.event}\ndata: ${JSON.stringify(shown.data)}\n\n`);
    await sleep(shown.event === "token" ? tokenMs : 40);
  }
  /* 后面和 Day 471 一样 */
}
```

<div class="line-notes">

- `async function streamTo(res: ServerResponse, t: Ticket, evs: Ev[], after: Phase, aud: Audience, cutAt = -1) {` 多了 `aud`。三个客户接口(`/run`、`/resume`、`/messages`)传 `"customer"`,审批接口传 `"staff"`。
- `if (i === cutAt) {` 断线模拟的位置,取「第二个 tool 事件」的下标。
- `await sleep(400);` 这一行是下面「时灵时不灵」那一节的结果,先看到。
- `if (res.destroyed) {` 连接断了(不管是自己掐的还是浏览器关的),把剩下的事件存进 `t.rest`,留给 `/resume`。
- `const shown = show(aud, evs[i] === DONE ? { event: "done", data: summary(t) } : evs[i]);` `DONE` 是个占位事件,推到它的时候才按工单当时的状态生成摘要;不管哪种,都先过筛子。
- `if (!shown) continue;` 客户看不到的事件直接跳过,连 40 毫秒的节奏等待也省了。所以客户那条线上 4 个 `tool` 不占时间。
- `res.write(`event: ${shown.event}\ndata: ${JSON.stringify(shown.data)}\n\n`);` 写的是 `shown` 不是原始事件。

</div>

跑一遍同一个脚本,看筛子有没有生效:

```bash
NEXT_PUBLIC_SUPPORTPILOT_API=http://localhost:8472 npx tsx scripts/leak_scan.mts
```

真实输出:

```text
事件数 { node: 7, token: 59, step: 1, interrupt: 1, done: 1 }
没有多余字段
```

69 个事件,和 Python 测试里的 69 对上。

## 第四步:Playwright,把「看一眼」变成自动检查

Day 469 到 471,我好几次写「我用无头浏览器读了页面」。那是一次性的手工活,代码一改就失效。Playwright 做的是同一件事:启动一个真浏览器,点、填、读,只是把过程和期望写进代码里,以后每次改完一条命令全跑。

Playwright 是微软做的浏览器自动化库,同时带一个测试运行器(`@playwright/test`)。「端到端测试」(end-to-end,常缩写 e2e)指从用户的角度,把整条链路(浏览器、前端、后端)当黑盒跑一遍,只检查用户看得到的结果。和 Day 469 的 `check_reducer.mts` 比,那个只测 reducer 一个函数,e2e 测的是浏览器里最终渲染出来的东西。

### 安装和配置

```bash
cd supportpilot/web
npm i -D @playwright/test@1.64.1 @axe-core/playwright@4.14.0
npx playwright install chromium     # 下载一份 Chromium,几百 MB,只需要一次
```

版本是 2026 年 10 月 23 日在 npm 上查到的 `@playwright/test` 最新版 1.64.1 和 `@axe-core/playwright` 4.14.0。`playwright install` 在我这台机器上因为以前装过,几乎是瞬间完成;第一次装要下载一两分钟。配置文件:

```ts
// supportpilot/web/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

const API_PORT = 8472; // 假后端
const WEB_PORT = 3472; // 前端(构建后的版本,不是 dev server)

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true, // 每个测试自己建工单,互不干扰,可以并行
  forbidOnly: !!process.env.CI, // 有人把 test.only 提交上去,CI 直接红
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure", // 失败了才留 trace,通过的不占磁盘
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npx tsx scripts/fake_api.mts",
      url: `http://localhost:${API_PORT}/approvals`, // 能返回 200 就算起来了
      env: { FAKE_PORT: String(API_PORT), WEB_ORIGIN: `http://localhost:${WEB_PORT}` },
      reuseExistingServer: !process.env.CI,
    },
    {
      // NEXT_PUBLIC_ 变量在 build 时就写死进了 js,所以环境变量要带给 build,而不是只带给 start
      command: `npm run build && npx next start -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      env: { NEXT_PUBLIC_SUPPORTPILOT_API: `http://localhost:${API_PORT}` },
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
```

<div class="line-notes">

- `import { defineConfig, devices } from "@playwright/test";` `defineConfig` 只是给配置对象加类型提示,`devices` 是一张预设的设备表(浏览器、视口、User-Agent)。
- `const API_PORT = 8472; // 假后端` 和前面手动起假后端用的是同一个端口。
- `testDir: "e2e",` 测试文件放 `web/e2e/` 下,文件名以 `.spec.ts` 结尾。
- `fullyParallel: true,` 同一个文件里的测试也并行。在我这台 2019 款 Intel MacBook Pro 上默认开 4 个 worker,18 条测试 28 秒。
- `forbidOnly: !!process.env.CI,` `test.only` 是调试时只跑一条用的,忘了删就会让 CI 只跑一条还显示全绿。`CI` 环境变量在大部分持续集成平台上都有。
- `retries: process.env.CI ? 1 : 0,` 本地不重试:红了就要看,不要被重试盖住。CI 上重试一次,但被重试救回来的测试会被标成 flaky,下面「时灵时不灵」那一节要用到。
- `reporter: "list",` 每条测试一行。想要 HTML 报告改成 `"html"`。
- `trace: "retain-on-failure",` trace 是一个 zip,里面有每一步的 DOM 快照、网络请求和控制台,用 `npx playwright show-trace` 打开能回放。只在失败时留。
- `projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],` 今天只跑 Chromium 一个浏览器。Playwright 也能跑 Firefox 和 WebKit,加一项就行,时间乘 3。
- `webServer: [` 数组:测试开始前 Playwright 先按顺序启动这两个服务,等 `url` 返回成功再开始跑,结束时关掉。
- `command: "npx tsx scripts/fake_api.mts",` 第一个服务是假后端。
- `url: `http://localhost:${API_PORT}/approvals`,` 用「列出待审批」这个 GET 接口当健康检查,假后端起来后返回 200 和一个空数组。
- `env: { FAKE_PORT: String(API_PORT), WEB_ORIGIN:` 假后端读这两个环境变量,`WEB_ORIGIN` 是 CORS 放行的前端地址(Day 469 讲过的坑)。
- `reuseExistingServer: !process.env.CI,` 本地如果已经有进程占着这个端口,直接用它,不报「端口被占用」。CI 上总是自己启动一个干净的。
- `command: `npm run build && npx next start -p ${WEB_PORT}`,` 第二个服务是前端,先构建再用生产模式启动,而不是 `next dev`。dev 模式有热更新的 WebSocket、开发提示浮层,测试时偶尔会干扰;生产版和用户实际拿到的更接近。代价是每次测试前要多花一次 build 的时间。
- `env: { NEXT_PUBLIC_SUPPORTPILOT_API:` 这个环境变量要在 `build` 时就有,因为 Next.js 构建时把 `NEXT_PUBLIC_` 开头的变量替换成字面量(Day 469 讲过)。写在 `env` 里,`&&` 两边的命令都能读到。
- `timeout: 180_000,` 给 build 留 3 分钟。数字里的下划线是 JS 的数字分隔符。

</div>

### 先写最直接的一条

每个测试都要先建工单,抽成两个小函数:

```ts
// supportpilot/web/e2e/helpers.ts
import { expect, type Page } from "@playwright/test";

// 打开客户页,填主题,提交,返回工单号。主题里的关键词决定假后端模拟哪种情况(想退款 慢 / 断线 / 退回 / 转人工 / 出错 / 大额)
export async function submitTicket(page: Page, subject = "想退款"): Promise<string> {
  await page.goto("/");
  await page.getByLabel("主题").fill(subject);
  await page.getByRole("button", { name: "提交工单" }).click();
  const label = await page.getByText(/^工单号 T\d{6}$/).textContent();
  return label!.replace("工单号 ", "");
}

// 等到「退款申请已提交审核」:这是一次正常的退款第一轮跑完的样子
export async function waitForSubmitted(page: Page) {
  await expect(page.getByRole("heading", { name: "退款申请已提交审核" })).toBeVisible();
}

// 在工作台里批准某张工单的退款(备注可选),等恢复的流程跑完。desk 是另一个标签页,当成客服
export async function approveInDesk(desk: Page, ticketId: string, note = "") {
  await desk.goto("/desk");
  const card = desk.getByRole("article").filter({ hasText: ticketId });
  if (note) await card.getByLabel("审批备注").fill(note);
  await card.getByRole("button", { name: "通过" }).click();
  await expect(card.getByRole("heading", { name: /已完成/ })).toBeVisible();
}
```

<div class="line-notes">

- `import { expect, type Page } from "@playwright/test";` `Page` 是一个浏览器标签页,所有操作都从它出发。`type` 前缀表示只导入类型。
- `export async function submitTicket(page: Page, subject = "想退款"): Promise<string> {` 默认主题是普通的退款,带「慢」「断线」等关键词就触发 Day 471 的五种情况。
- `await page.goto("/");` 相对路径会接上配置里的 `baseURL`,也就是 `http://localhost:3472/`。`await` 等页面加载完成。
- `await page.getByLabel("主题").fill(subject);` 按**表单标签的文字**找输入框:页面上 `<label>主题<input name="subject">` 把文字和输入框关联起来了,读屏软件怎么找到它,这里就怎么找。`fill` 先清空再整段写入。
- `await page.getByRole("button", { name: "提交工单" }).click();` 按 ARIA 角色和可访问名称找:一个角色是 button、名字是「提交工单」的元素。这也是读屏软件用户找它的方式。
- `const label = await page.getByText(/^工单号 T\d{6}$/).textContent();` 页面在提交成功后出现「工单号 T000001」。正则要完整匹配整个文字,`^…$` 避免误匹配别的含「工单号」的文字。Playwright 会自动等到它出现(最多 5 秒)。
- `return label!.replace("工单号 ", "");` `textContent()` 的类型是 `string | null`,`!` 告诉 TypeScript 这里一定有值。代入 `"工单号 T000007"` 返回 `"T000007"`。
- `export async function waitForSubmitted(page: Page) {` 单独抽出来,因为客户页面的七八条测试都要等同一个状态。
- `await expect(page.getByRole("heading", { name: "退款申请已提交审核" })).toBeVisible();` 找标题,等它可见。`expect(locator)` 是 Playwright 的「会等」的断言:条件不满足时每隔一会儿重试,默认最多 5 秒。
- `const card = desk.getByRole("article").filter({ hasText: ticketId });` 工作台上每张卡片是一个 `<article>`,按工单号过滤出属于自己这条测试的那一张。并行测试会同时往同一个假后端建工单,所以不能假设「列表里只有我的」。
- `if (note) await card.getByLabel("审批备注").fill(note);` `getByLabel` 在 `card` 范围里找,不会找到别的卡片里同名的输入框。
- `await expect(card.getByRole("heading", { name: /已完成/ })).toBeVisible();` 恢复的流程跑完,卡片里的 `RunView` 标题变成「已完成 · 花费 ¥0.02598」。

</div>

第一个测试文件:

```ts
// supportpilot/web/e2e/customer.spec.ts
import { expect, test } from "@playwright/test";
import { submitTicket, waitForSubmitted } from "./helpers";

test("客户提交退款工单:看到阶段提示,停在审核,输入框锁住", async ({ page }) => {
  await submitTicket(page);
  await waitForSubmitted(page);

  const progress = page.getByRole("list", { name: "处理进度" });
  for (const text of ["正在查询您的账户", "正在了解您的问题", "正在查找相关帮助文章", "正在核对您的订阅和账单", "正在为您整理答复"]) {
    await expect(progress.getByText(text)).toBeVisible();
  }
  await expect(page.getByText(/退款申请编号 RF-T\d{6}-INV-202609-0002\(¥950\)/)).toBeVisible();
  await expect(page.getByLabel("继续追问")).toBeDisabled();
});

test("客户页面上没有内部信息", async ({ page }) => {
  await submitTicket(page);
  await waitForSubmitted(page);

  const text = await page.locator("main").innerText();
  for (const secret of ["list_invoices", "create_refund_request", "annual_first_14_days", "花费", "质检", "不要告诉客户", "参数"]) {
    expect(text, `客户页面不该出现「${secret}」`).not.toContain(secret);
  }
  // 草稿在审批前不给客户看
  await expect(page.getByText("按政策可以全额退款")).toHaveCount(0);
});

test("客户收到的事件流里没有内部字段", async ({ page }) => {
  await page.goto("/");
  const run = page.waitForResponse((r) => r.url().endsWith("/run"));
  await page.getByRole("button", { name: "提交工单" }).click();
  const body = await (await run).text(); // 流结束以后才拿得到完整文本
  for (const secret of ['"note"', "customer_id", "cost_cny", "list_invoices", "annual_first_14_days", "KB-refund", "waiting_on"]) {
    expect(body, `事件流里不该出现 ${secret}`).not.toContain(secret);
  }
  expect(body).toContain('"amount_cny":950'); // 该给的还在
});
```

<div class="line-notes">

- `test("客户提交退款工单:` `test` 的第二个参数是个函数,Playwright 给它一个叫 `page` 的参数:每条测试都有一个全新的、互不共享 cookie 和存储的浏览器环境。相当于 jest 里 `it` 加了「自动给你一个干净的浏览器」。
- `const progress = page.getByRole("list", { name: "处理进度" });` `RunView` 客户那一档给 `<ol>` 加了 `aria-label="处理进度"`,这里按这个名字找,不会误碰页面上别的列表。
- `for (const text of [` 五个阶段,和 `customerStages` 的输出一一对应。
- `await expect(progress.getByText(text)).toBeVisible();` 在 `progress` 里找包含这段文字的元素,等它可见。
- `await expect(page.getByText(/退款申请编号 RF-T\d{6}-INV-202609-0002\(¥950\)/)).toBeVisible();` 正则里 `\d{6}` 匹配六位工单号,`\(¥950\)` 的括号要转义。假后端的编号格式是 `RF-T000001-INV-202609-0002`。
- `await expect(page.getByLabel("继续追问")).toBeDisabled();` 停在审批时,追问输入框锁住(Day 470)。这个输入框的 `label` 是 `sr-only` 类的,看不见但读屏软件读得到,`getByLabel` 一样能找到。
- `const text = await page.locator("main").innerText();` 取 `<main>` 里所有看得见的文字,拼成一个字符串。`innerText` 只含渲染出来的文字,不含 `display: none` 的和 `<script>`。
- `expect(text, `客户页面不该出现「${secret}」`).not.toContain(secret);` `expect` 的第二个参数是失败时的自定义说明。这里没用 `await`,因为 `text` 已经是个普通字符串了,断言是同步的。
- `await expect(page.getByText("按政策可以全额退款")).toHaveCount(0);` 草稿里的一句话,客户页面上一个都不该有。
- `const run = page.waitForResponse((r) => r.url().endsWith("/run"));` **先挂监听再点按钮**:`waitForResponse` 返回一个 Promise,此时不 `await`,让它在后台等;顺序反过来(先点再等)可能错过很快返回的响应。
- `const body = await (await run).text();` 两层 `await`:第一层等响应对象,第二层等响应体读完。SSE 响应体要等流结束才读完,所以拿到的是整段原始文本。
- `for (const secret of ['"note"', "customer_id",` 这回查的是**网络上的原始文本**,不是页面。页面测试通过不能保证事件流是干净的,第一步已经看到了。注意 `'"note"'` 带着引号,避免误匹配别的含 note 的词。
- `expect(body).toContain('"amount_cny":950');` 反向检查:该给的还在。只检查「没有」会让「全删光」也通过。注意没有空格也没有小数点:假后端用 `JSON.stringify` 输出,950 就是 `950`。换成真后端(Python 的 `json.dumps` 会写成 `"amount_cny": 950.0`),这一行要跟着改。

</div>

```bash
npx playwright test e2e/customer.spec.ts
```

第一次运行会先 build 前端,然后:

```text
Running 3 tests using 3 workers

  ✓  1 [chromium] › e2e/customer.spec.ts:5:5 › 客户提交退款工单:看到阶段提示,停在审核,输入框锁住 (4.1s)
  ✓  2 [chromium] › e2e/customer.spec.ts:17:5 › 客户页面上没有内部信息 (3.7s)
  ✓  3 [chromium] › e2e/customer.spec.ts:29:5 › 客户收到的事件流里没有内部字段 (3.6s)

  3 passed
```

(上面三行是我完整套件那次输出里摘出来的,时间是 4 个 worker 并行时的。)

### 故意犯错:strict mode violation

下一个文件测五种不顺利。我第一次写「出错」那条是这样的:

```ts
const alert = page.getByRole("alert");
await expect(alert).toContainText("处理出错了,已经记录,请稍后重试");
```

真实报错:

```text
Error: expect(locator).toHaveText(expected) failed

Locator: getByRole('alert')
Expected: "提交失败,请检查后端是否启动"
Error: strict mode violation: getByRole('alert') resolved to 2 elements:
    1) <p role="alert" class="error">提交失败,请检查后端是否启动</p> aka getByText('提交失败,请检查后端是否启动')
    2) <div role="alert" aria-live="assertive" id="__next-route-announcer__"></div> aka locator('[id="__next-route-announcer__"]')
```

(这是同一类写法在「后端没起」那条测试里的原文,「出错」那条的报错是同一个原因。)

**strict mode violation**(严格模式违规)是 Playwright 的保护:一个 locator 要对元素做动作或断言,但它匹配到了不止一个,Playwright 不替你猜是哪个,直接报错。这里第二个元素不是我写的:Next.js 在每个页面里放了一个空的 `role="alert"` 的 `div`,用来给读屏软件播报路由切换。

修法不是 `.first()`(那样 Next.js 哪天改了顺序就悄悄挑错),而是把 locator 限定在 `<main>` 里:

```ts
const alert = page.locator("main").getByRole("alert");
```

`<main>` 是我们自己页面里的区域,Next.js 的播报 `div` 在它外面。限定范围比取第几个稳。

### 五种不顺利

```ts
// supportpilot/web/e2e/situations.spec.ts
// Day 471 的五种不顺利,变成自动跑的检查。主题里的关键词让假后端模拟对应的情况
import { expect, test } from "@playwright/test";
import { submitTicket, waitForSubmitted } from "./helpers";

test("慢:点停止以后焦点落在「继续处理」上", async ({ page }) => {
  await submitTicket(page, "想退款 慢");
  await page.getByRole("button", { name: "停止" }).click();
  await expect(page.getByRole("heading", { name: "已停止接收" })).toBeVisible();
  await expect(page.getByRole("button", { name: "继续处理" })).toBeFocused();
});

test("断线:自动接回,第一次被 409 挡住,等一会儿再试成功", async ({ page }) => {
  // 先挂上监听再提交:不去断言「正在接回进度」那个只亮 1 秒的中间状态,改成断言网络上确实发生过 409
  const blocked = page.waitForResponse((r) => r.url().endsWith("/resume") && r.status() === 409);
  await submitTicket(page, "想退款 断线");
  await blocked;
  await waitForSubmitted(page);
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("退回:客户看不到退回的理由,事件流里只有 passed:false", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("主题").fill("想退款 退回");
  const run = page.waitForResponse((r) => r.url().endsWith("/run"));
  await page.getByRole("button", { name: "提交工单" }).click();
  const body = await (await run).text();
  expect(body).toContain('"passed":false'); // 前端靠它清掉旧草稿
  expect(body).not.toContain("KB-refund-009"); // 退回理由不给客户
  await waitForSubmitted(page);
  await expect(page.getByText(/质检/)).toHaveCount(0);
});

test("转人工:标题和回复都告诉客户接下来是人在处理", async ({ page }) => {
  await submitTicket(page, "想退款 转人工");
  await expect(page.getByRole("heading", { name: "已转人工客服" })).toBeVisible();
  await expect(page.getByText("会在 1 个工作日内通过这个工单回复您")).toBeVisible();
  await expect(page.getByRole("list", { name: "处理进度" }).getByText("已转给人工客服")).toBeVisible();
});

test("出错:提示加重试按钮,点重试从出错的地方接着跑", async ({ page }) => {
  await submitTicket(page, "想退款 出错");
  const alert = page.locator("main").getByRole("alert"); // 限定在 main 里:Next 自己有个空的 role=alert 播报路由变化
  await expect(alert).toContainText("处理出错了,已经记录,请稍后重试"); // 固定文案,没有堆栈和 SQL
  await alert.getByRole("button", { name: "重试" }).click();
  await waitForSubmitted(page);
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
});

test("提交的时候后端没起:提示而不是白屏", async ({ page }) => {
  await page.route("**/tickets", (route) => route.abort("connectionrefused")); // 把创建工单的请求直接掐掉
  await page.goto("/");
  await page.getByRole("button", { name: "提交工单" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("提交失败,请检查后端是否启动");
});
```

<div class="line-notes">

- `await submitTicket(page, "想退款 慢");` 主题含「慢」,假后端每个 token 隔 300 毫秒推,59 个 token 要 17 秒多,足够点停止。
- `await page.getByRole("button", { name: "停止" }).click();` 运行中才有这个按钮。`click()` 会先等按钮可见、可点击(没被遮挡、没禁用)再点。
- `await expect(page.getByRole("heading", { name: "已停止接收" })).toBeVisible();` 状态标题变成「已停止接收」(Day 469 的 reducer)。
- `await expect(page.getByRole("button", { name: "继续处理" })).toBeFocused();` Day 471 修的可访问性:点停止后键盘焦点会落到「继续处理」上,而不是掉回 `<body>`。当时是手工用可访问性树看的,现在是一条断言。
- `const blocked = page.waitForResponse((r) => r.url().endsWith("/resume") && r.status() === 409);` 断线测试的核心。主题「断线」让假后端在第二个工具调用后掐断连接;前端自动 GET 看进度,再调 `/resume`;假后端第一次故意回 409「上一次的处理还在收尾」。这里在浏览器的网络层等这条 409。
- `await blocked;` 确认 409 真的出现过,证明走过「被挡住」这条路。
- `await waitForSubmitted(page);` 然后等 1 秒后的第二次 `/resume` 成功,流程跑完停在审核。
- `await expect(page.locator("main").getByRole("alert")).toHaveCount(0);` 整个过程没有留下错误提示。`toHaveCount(0)` 也是会等的断言:条件满足就立即通过。
- `expect(body).toContain('"passed":false');` 「退回」这一条同样直接看网络。前端靠质检的 `passed: false` 清掉旧草稿,所以这个信号必须在。
- `expect(body).not.toContain("KB-refund-009");` 但退回的理由(引用了一个不存在的编号)不应该出现。
- `await expect(page.getByText(/质检/)).toHaveCount(0);` 页面上也没有「质检」二字。
- `await expect(page.getByRole("heading", { name: "已转人工客服" })).toBeVisible();` 转人工的标题。
- `.getByText("已转给人工客服")` 阶段列表里也有一行,两处不同的元素,所以第三条断言限定在 `处理进度` 列表里。
- `await alert.getByRole("button", { name: "重试" }).click();` 出错提示里的「重试」按钮是 Day 471 练习 1 做的。点了以后调 `/resume`,假后端从 `act` 重跑。
- `await page.route("**/tickets", (route) => route.abort("connectionrefused"));` Playwright 能拦截浏览器发出的任何请求。这里把创建工单的请求直接当作「连接被拒绝」,不需要真的关掉后端。`**/tickets` 是个 glob,匹配任何以 `/tickets` 结尾的地址。
- `.toHaveText("提交失败,请检查后端是否启动")` 客户页面在 `submit` 里 catch 到错误后显示的固定文案(Day 470)。

</div>

### 故意犯错:一条时灵时不灵的测试

上面「断线」那条是改过的。我最先写的版本是这样的:

```ts
await submitTicket(page, "想退款 断线");
await expect(page.getByRole("heading", { name: "正在接回进度" })).toBeVisible(); // 中间状态
await waitForSubmitted(page);
```

直觉上很合理:断线以后界面应该先显示「正在接回进度」。单独跑 12 次全过。但我把整套测试一起跑,并且每条重复 3 次(`--repeat-each=3`),跑了四轮,共 144 次执行,**这一条失败了 3 次,别的全过**:

```bash
npx playwright test --repeat-each=3
```

(那时套件还只有 12 条,所以每轮 36 次。)四轮的结果分别是 0、2、1、0 次失败。原因很普通:「正在接回进度」这个状态只亮大约 1 秒(第一次接回被 409 挡住后,前端等 1 秒再试),而整套测试并行时机器忙,Playwright 的轮询偶尔刚好错过这一秒。

这类问题叫 **flaky**(时灵时不灵)。不能靠加大超时糊弄:一个断言要看的是一个只存在一瞬间的状态,本身就写错了。该断言的是**确定发生过的事**,也就是网络上那条 409。上面「五种不顺利」里就是改过后的版本。

改完以后我又发现它还有第二层问题。在只重复这一条(`-g 断线 --repeat-each=30`,4 个 worker)时,**30 次里失败 2 次**,报的是 `page.waitForResponse: Test timeout of 30000ms exceeded`:30 秒内一直没有等到 409。看失败时留下的页面快照:

```yaml
- region:
  - heading "出错了" [level=2]
  - list "处理进度"
  - alert:
    - text: 连接中断,请稍后重试
    - button "重试"
```

页面是「出错了」,处理进度是空的:前端连一个事件都没收到,直接判定「连接没开起来」。这一次,问题出在**假后端**:断线是通过在第二个工具调用后立刻 `res.destroy()` 掐掉连接模拟的。因为 `tool` 事件现在对客户是隐藏的、写完不用等,前面的 `node`、`step` 刚写出去就被掐断了,浏览器有时还没把这些字节读进 JavaScript 就收到了连接错误。(这是我根据现象做的推测:我没有抓包确认 TCP 层的细节,但加一段等待就消失了。)

修法是掐断之前先 `await sleep(...)` 让写出去的字节到达。我试了三个值,每个都是 `--repeat-each` 重复跑这一条、4 个 worker:

| 掐断前等待 | 失败次数 |
| --- | --- |
| 0 毫秒(没有等待) | 2 / 30 |
| 100 毫秒 | 2 / 40 |
| 400 毫秒 | 0 / 40 |

最后用 400 毫秒,也就是上面 `streamTo` 里那一行。假后端模拟真实世界里「流在传输中断掉」的场景,这个场景本身就会有时序问题;**测试工具自己的时序问题,和被测代码的 bug,要分开看。** 这一次是前者。

## 工作台:两个人的页面

「客服批准,客户看到结果」涉及两个人,Playwright 用同一个浏览器环境里开两个标签页来模拟:

```ts
// supportpilot/web/e2e/desk.spec.ts
import { expect, test } from "@playwright/test";
import { submitTicket, waitForSubmitted } from "./helpers";

test("客服批准:客户刷新以后看到定稿和参考文章", async ({ browser }) => {
  const context = await browser.newContext(); // 一个干净的浏览器环境,里面开两个标签页,当成两个人
  const customer = await context.newPage();
  const desk = await context.newPage();

  const ticketId = await submitTicket(customer);
  await waitForSubmitted(customer);

  await desk.goto("/desk");
  const card = desk.getByRole("article").filter({ hasText: ticketId });
  await expect(card.getByText("按政策可以全额退款")).toBeVisible(); // 审批人批之前就能看到草稿
  await card.getByLabel("审批备注").fill("符合 14 天政策");
  await card.getByRole("button", { name: "通过" }).click();
  await expect(card.getByRole("heading", { name: /已完成 · 花费 ¥0\.02598/ })).toBeVisible(); // 客服能看到花费
  await expect(card.getByText("查客户档案")).toHaveCount(0); // 恢复的流程只有审批和定稿,没有前面的步骤

  await customer.getByRole("button", { name: "刷新进展" }).click();
  await expect(customer.getByText("您的退款申请已审核通过,950.00 元将原路退回")).toBeVisible();
  await expect(customer.getByRole("link", { name: "退款政策总览" })).toHaveAttribute("href", /help\.cloudledger\.example/);
  await expect(customer.getByText(/花费/)).toHaveCount(0);
  await expect(customer.getByLabel("继续追问")).toBeEnabled(); // 审批完才能追问
  await context.close();
});

test("财务和客服看到的卡片不一样", async ({ page }) => {
  const ticketId = await submitTicket(page);
  await waitForSubmitted(page);
  await page.goto("/desk");
  const card = page.getByRole("article").filter({ hasText: ticketId });

  await expect(card.getByRole("heading", { name: /^RF-.* · 李娜 · ¥950$/ })).toBeVisible(); // 客服看得到申请编号
  await page.getByRole("radio", { name: "财务" }).check();
  await expect(card.getByRole("heading", { name: "李娜 · ¥950" })).toBeVisible(); // 财务这一行只有人和钱
  await expect(card.getByText("按政策可以全额退款")).toBeVisible(); // 但草稿两个角色都看得到
  await expect(card.getByText("超过复核线")).toHaveCount(0);
});

test("金额超过复核线:卡片上有提示", async ({ page }) => {
  const ticketId = await submitTicket(page, "想退款 大额");
  await waitForSubmitted(page);
  await page.goto("/desk");
  const card = page.getByRole("article").filter({ hasText: ticketId });
  await expect(card.getByText("金额超过复核线,按政策需要财务复核")).toBeVisible();
  await expect(card.getByRole("heading", { name: /¥1280/ })).toBeVisible();
});
```

<div class="line-notes">

- `async ({ browser }) => {` 这一条不用默认的 `page`,而要 `browser` 自己建环境。`browser` 是整个 Chromium 进程。
- `const context = await browser.newContext();` 一个「浏览器环境」:有自己的 cookie、本地存储。同一个 context 里可以开多个标签页。
- `const customer = await context.newPage();` 第一个标签页扮演客户。
- `const desk = await context.newPage();` 第二个扮演客服。两个标签页各有自己的 React 状态,互不知道对方。
- `const ticketId = await submitTicket(customer);` 客户提交,代入第一次跑得到 `T000001`(并行时是别的号)。
- `await desk.goto("/desk");` 客服打开工作台,页面加载时调 `/approvals`,得到所有 `waiting` 的工单。
- `await expect(card.getByText("按政策可以全额退款")).toBeVisible();` 审批人批之前就看到草稿,这是今天补的功能。
- `await card.getByRole("button", { name: "通过" }).click();` 点通过,恢复流程在卡片里跑完。
- `.toBeVisible(); // 客服能看到花费` 标题里是「已完成 · 花费 ¥0.02598」。正则里 `\.` 转义小数点。
- `await expect(card.getByText("查客户档案")).toHaveCount(0);` 恢复的流程只有 `approval` 和 `finalize` 两个节点。
- `await customer.getByRole("button", { name: "刷新进展" }).click();` 回到客户标签页。它的状态没变,仍在「等审批」,点「刷新进展」会 GET 工单摘要(客户那一份)。
- `.toBeVisible();` 定稿回复里的「补充」一句是假后端写死的,和 Day 470 真实输出一致。
- `await expect(customer.getByRole("link", { name: "退款政策总览" })).toHaveAttribute("href", /help\.cloudledger\.example/);` 引用渲染成了链接,`toHaveAttribute` 检查属性,第二个参数可以是正则。
- `await expect(customer.getByText(/花费/)).toHaveCount(0);` 同一笔工单,客服看到花费,客户看不到。
- `await expect(customer.getByLabel("继续追问")).toBeEnabled();` 审批完成后输入框解锁。
- `await context.close();` 关掉这个环境。用默认 `page` 夹具的测试不用手动关,自己建的 context 要自己关。
- `{ name: /^RF-.* · 李娜 · ¥950$/ }` 客服的标题带申请编号,用正则开头 `^RF-`、结尾 `¥950$` 夹住。
- `await page.getByRole("radio", { name: "财务" }).check();` 单选按钮用 `check()`,点一下选中。切换以后所有卡片按财务的样子重新渲染。
- `{ name: "李娜 · ¥950" }` 财务的标题。字符串形式的 `name` 默认是**包含匹配**,不是完全相等,所以如果客服标题也包含这段字,这条断言单独看是区分不出来的。它之所以有意义,是因为上一条断言先检查了客服的样子,这里检查切换后的样子;要严格区分,改成 `{ name: "李娜 · ¥950", exact: true }`。
- `await expect(card.getByText("超过复核线")).toHaveCount(0);` 950 元没有超过 1000 元的复核线,卡片上不该有提示。
- `const ticketId = await submitTicket(page, "想退款 大额");` 主题含「大额」,假后端把金额改成 1280 并把 `needs_finance_review` 设成 true。
- `{ name: /¥1280/ }` 标题里是 1280,没有小数点:`JSON` 里的 1280 在 JS 里是整数,显示就是 1280。

</div>

## 可访问性:让机器替你查一遍

Day 471 手工看了一次可访问性树。现在加一条自动检查:[axe-core](https://github.com/dequelabs/axe-core) 是 Deque 公司做的开源规则引擎,能查出大约一半的可访问性问题(对比度、缺 label、标题级别跳级、重复 id……),`@axe-core/playwright` 把它接到 Playwright 里。它查不出来的那一半(焦点顺序合不合理、读出来的文字是否有意义)还得人来。

```ts
// supportpilot/web/e2e/a11y.spec.ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { submitTicket, waitForSubmitted } from "./helpers";

// axe 能抓到的可访问性问题只是一部分(官方说法是大约一半),抓得到的就别留给人去发现
test("客户页面:没有 axe 能查出来的违规", async ({ page }) => {
  await submitTicket(page);
  await waitForSubmitted(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.id}(${v.impact}) × ${v.nodes.length}`)).toEqual([]);
});

test("工作台:没有 axe 能查出来的违规", async ({ page }) => {
  const ticketId = await submitTicket(page);
  await waitForSubmitted(page);
  await page.goto("/desk");
  await expect(page.getByRole("article").filter({ hasText: ticketId })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.id}(${v.impact}) × ${v.nodes.length}`)).toEqual([]);
});

test.describe("深色模式", () => {
  test.use({ colorScheme: "dark" }); // 模拟系统设成深色。样式里写了 prefers-color-scheme,两套颜色都要过

  test("客户页面:没有 axe 能查出来的违规", async ({ page }) => {
    await submitTicket(page);
    await waitForSubmitted(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => `${v.id}(${v.impact}) × ${v.nodes.length}`)).toEqual([]);
  });
});
```

<div class="line-notes">

- `import AxeBuilder from "@axe-core/playwright";` 默认导出是个构造器。
- `await submitTicket(page);` 先把页面带到有内容的状态再查:空表单页面查出来没问题,不代表提交以后也没问题。
- `const { violations } = await new AxeBuilder({ page }).analyze();` 对当前页面跑全部默认规则,返回对象里 `violations` 是违规的规则列表,每条有 `id`、`impact`(严重程度)、`nodes`(出问题的元素)。
- `expect(violations.map((v) => `${v.id}(${v.impact}) × ${v.nodes.length}`)).toEqual([]);` 不直接 `expect(violations).toEqual([])`:那样失败时会打印每个元素的完整 HTML,很长。先 `map` 成「规则名(严重程度) × 个数」,失败信息只有一行。
- `test.describe("深色模式", () => {` 把几条测试分到一组,给这一组加共同的设置。
- `test.use({ colorScheme: "dark" });` 让浏览器假装系统是深色模式。`globals.css` 里有 `@media (prefers-color-scheme: dark)`,浅色和深色是两套颜色,都要查。

</div>

第一次跑,浅色的两条都红(后来补的深色那条,红在标题级别)。客户页面的真实输出:

```text
- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "color-contrast(serious) × 3",
+   "heading-order(moderate) × 1",
```

工作台:`color-contrast(serious)`(第一次跑时页面上有 8 处,每张卡片的说明文字都算一处,卡片越多数字越大);深色模式那条只有 `heading-order(moderate) × 1`,说明深色那套颜色本来就够。想知道具体是哪个元素,临时写个脚本把 `nodes` 打出来:

```text
color-contrast .muted:nth-child(2) 4.15 #707a8a #fafafa 4.5:1
color-contrast .muted:nth-child(5) 4.15 #707a8a #fafafa 4.5:1
color-contrast .link 4.45 #9a6c00 #fafafa 4.5:1
heading-order #current-status
```

每行是规则、元素选择器、实际对比度、前景色、背景色、要求的对比度。

- **`color-contrast`**:`.muted` 文字用的 `--faint` 是 `#707a8a`,放在 `#fafafa` 的页面底色上,对比度 4.15,低于 WCAG AA 对正文要求的 4.5:1。`.link` 用的 `--accent` 是 `#9a6c00`,4.45,也差一点点。差一点点也不行,低视力用户读起来吃力。用公式 `(L1 + 0.05) / (L2 + 0.05) `(亮度较大的那个在上)算几个候选:`#667080` 在 `#fafafa` 上是 4.8,`#8a6100` 是 5.31。两个变量改成这两个值,深色模式的颜色本来就够,没动。
- **`heading-order`**:页面标题是 `h1`,`RunView` 的状态标题写成了 `h3`,中间没有 `h2`,读屏软件用户用标题导航时会觉得少了一级。修法就是上面 `RunView` 里的 `level` 属性:客户页面直接在 `h1` 下面,用 `h2`(默认值);工作台里卡片自己有 `h2`,里面的 `RunView` 传 `level={3}`。

改完 `globals.css` 里的两个颜色值、`RunView` 加 `level`、工作台传 `level={3}`:

```css
/* supportpilot/web/src/app/globals.css(第 2、3 行,浅色那一套) */
:root { --ink:#1e2329; --soft:#474d57; --faint:#667080; --rule:#e6e8ea; --bg:#fafafa; --card:#fff;
  --accent:#8a6100; --accent-bg:#fdf3d1; --ok:#03875a; --danger:#c62828; color-scheme: light dark; }
```

再跑:

```text
✓  3 [chromium] › e2e/a11y.spec.ts:26:7 › 深色模式 › 客户页面:没有 axe 能查出来的违规 (4.2s)
✓  1 [chromium] › e2e/a11y.spec.ts:7:5 › 客户页面:没有 axe 能查出来的违规 (4.3s)
✓  2 [chromium] › e2e/a11y.spec.ts:14:5 › 工作台:没有 axe 能查出来的违规 (4.4s)

3 passed (13.6s)
```

写这一节时我还踩了一个小坑:想先用一个独立脚本(不走测试运行器)调 axe,`chromium.launch()` 之后直接 `browser.newPage()` 再 `analyze()` 会报 `Error: Please use browser.newContext()`。`@axe-core/playwright` 要求页面来自 `browser.newContext()` 创建的环境。测试运行器里的 `page` 夹具本来就是这么来的,所以测试里不会遇到,只有手写脚本才会。

## 测试真的能抓住问题吗

测试全绿并不说明它有用。检验方法很土:故意把代码改坏,看红不红、红在哪里。这叫**变异测试**(mutation testing)的手工版。我做了两处。

**改坏一:`RunView` 的默认观众从 `customer` 改成 `staff`**(模拟有人图省事把默认值改了)。跑 `customer.spec.ts` 和 `situations.spec.ts`,真实结果:6 条红(客户提交、客户页面没有内部信息、断线、退回、转人工、出错)。有意思的是,「没有内部信息」这条并没有报「出现了 `list_invoices`」,而是死在更前面的 `waitForSubmitted`:客服档的标题是「已提交审批,等客服处理」,找不到「退款申请已提交审核」。一个改动红了六条,**失败信息读起来是「找不到标题」,不是「泄露了」**。这是 e2e 测试的特点:能抓住问题,但指向问题要多看一步。看 trace 里的页面快照,一眼能看到页面上多出的工具卡片。

**改坏二:假后端的白名单里,`interrupt` 多放行一个 `rule`**(模拟后端漏过滤)。这时候只有一条红,而且信息精确:

```text
Error: 事件流里不该出现 annual_first_14_days
Received string:  "event: node
..."
✘ e2e/customer.spec.ts:29:5 › 客户收到的事件流里没有内部字段 (4.1s)
1 failed
11 passed
```

另外 11 条全绿,包括「客户页面上没有内部信息」。因为前端没有渲染 `rule`,页面看起来一点问题没有。**只有网络层那一条测试能抓到这种漏**,而这种漏恰好是第一步看到的那类。

这两个实验合起来说明:页面层的测试管「界面对不对」,网络层的测试管「发出去的对不对」,缺一条都有漏。

## 零件和大代码的对照

| 零件 | 文件 | 作用 |
| --- | --- | --- |
| `for_customer`、`for_audience` | `src/supportpilot/api/audience.py` | 后端白名单,默认不给 |
| `_sse`、`_events` 的 `audience` | `src/supportpilot/api/app.py` | 把筛子接进 SSE 出口,默认客户 |
| `list_approvals` 的 `draft` | `src/supportpilot/api/app.py` | 从 checkpoint 读草稿给审批人 |
| `customerStages` | `web/src/lib/stages.ts` | 内部节点名 → 阶段提示 |
| `audience`、`level` 属性 | `web/src/components/RunView.tsx` | 两档信息密度、标题不跳级 |
| `DENSITY`、角色单选 | `web/src/app/desk/page.tsx` | 客服看全过程,财务看客户那一档 |
| `forCustomer`、`show` | `web/scripts/fake_api.mts` | 假后端和真后端说同一套话 |
| `leak_scan.mts` | `web/scripts/` | 数出发给客户的多余字段 |
| `playwright.config.ts`、`e2e/*.spec.ts` | `web/` | 端到端测试 |

## 动手练习

### 练习 1:审批以后追问

写一条测试:客户提交退款,客服批准,客户刷新进展,然后在输入框里追问「大概几天到账?」,期望出现客户的气泡和助手的回复「一般 3 到 5 个工作日到账,具体以支付渠道为准。」。复用 `helpers.ts`,把「批准」那几行抽成一个函数。

<details><summary>参考答案</summary>

`helpers.ts` 里新增 `approveInDesk`(上文已经列出),再写:

```ts
// supportpilot/web/e2e/followup.spec.ts  练习 1 的参考答案
import { expect, test } from "@playwright/test";
import { approveInDesk, submitTicket, waitForSubmitted } from "./helpers";

test("审批完成后,客户刷新进展再追问,拿到回复", async ({ browser }) => {
  const context = await browser.newContext();
  const customer = await context.newPage();
  const desk = await context.newPage();

  const ticketId = await submitTicket(customer);
  await waitForSubmitted(customer);
  await expect(customer.getByLabel("继续追问")).toBeDisabled(); // 审批前问不了

  await approveInDesk(desk, ticketId);
  await customer.getByRole("button", { name: "刷新进展" }).click();
  await customer.getByLabel("继续追问").fill("大概几天到账?");
  await customer.getByRole("button", { name: "发送" }).click();

  await expect(customer.getByText("大概几天到账?")).toBeVisible(); // 客户说的话变成气泡
  await expect(customer.getByText("一般 3 到 5 个工作日到账,具体以支付渠道为准。")).toBeVisible();
  await context.close();
});
```

<div class="line-notes">

- `import { approveInDesk, submitTicket, waitForSubmitted } from "./helpers";` 三个辅助函数。
- `const context = await browser.newContext();` 两个标签页放同一个环境。
- `await expect(customer.getByLabel("继续追问")).toBeDisabled(); // 审批前问不了` 先确认审批前输入框是锁的,否则后面「解锁了」就没有意义。
- `await approveInDesk(desk, ticketId);` 客服标签页里完成批准,函数返回时卡片已经显示「已完成」。
- `await customer.getByRole("button", { name: "刷新进展" }).click();` 客户标签页的状态仍是「等审批」,必须点这里才会去 GET 一次,变成「已完成」。
- `await customer.getByLabel("继续追问").fill("大概几天到账?");` 输入框这时已解锁。`fill` 在元素被禁用时会等到它可用,超时报错。
- `await customer.getByRole("button", { name: "发送" }).click();` 发送按钮。
- `await expect(customer.getByText("大概几天到账?")).toBeVisible();` 气泡(`.bubble`)里是客户自己的原话。
- `await expect(customer.getByText("一般 3 到 5 个工作日到账,具体以支付渠道为准。")).toBeVisible();` 假后端 `/messages` 写死的回复。

</div>

我的实跑:这条测试通过(5.8 秒),和其他 17 条一起 18 passed。

</details>

### 练习 2:手机宽度不横向滚动

把视口设成 375 × 667,写两条测试:客户页面和工作台(有一张待审批卡片时)都不出现横向滚动条。提示:页面宽度可以用 `document.documentElement.scrollWidth - window.innerWidth` 算,大于 0 就会横向滚动。

<details><summary>参考答案</summary>

```ts
// supportpilot/web/e2e/mobile.spec.ts  练习 2 的参考答案
import { expect, test } from "@playwright/test";
import { submitTicket, waitForSubmitted } from "./helpers";

test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE 的宽度

// 页面比窗口宽多少像素。大于 0 就会出现横向滚动条
const overflow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test("手机宽度:客户页面不横向滚动", async ({ page }) => {
  await submitTicket(page);
  await waitForSubmitted(page);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});

test("手机宽度:工作台不横向滚动", async ({ page }) => {
  const ticketId = await submitTicket(page);
  await waitForSubmitted(page);
  await page.goto("/desk");
  await expect(page.getByRole("article").filter({ hasText: ticketId })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
});
```

<div class="line-notes">

- `test.use({ viewport: { width: 375, height: 667 } });` 写在文件顶层,这个文件里所有测试的浏览器窗口都是 375 × 667。
- `const overflow = (page: import("@playwright/test").Page) =>` 内联的 `import(...)` 类型写法,省得在文件头再 import 一次 `Page`。
- `page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);` `evaluate` 把函数送进浏览器里执行,返回值传回来。函数里不能用外面的变量。`scrollWidth` 是页面实际内容宽度,`innerWidth` 是窗口宽度。
- `expect(await overflow(page)).toBeLessThanOrEqual(0);` 不用会等的断言,因为这是读一次的数字。读之前已经 `waitForSubmitted`,页面已经稳定。

</div>

实跑结果:两条都通过,说明现在的样式在 375 宽度下没有横向溢出(工具卡片里的 `<pre>` 有 `overflow-x: auto`,长文本在自己的框里滚,不撑开页面)。如果你的页面有溢出,这条测试会打印一个大于 0 的数,先用 DevTools 的「设备模拟」找到最宽的那个元素。

</details>

### 练习 3:改坏白名单,看谁红

在假后端的 `forCustomer` 里,给 `done` 事件多放行一个 `cost_cny`。跑全部测试,哪几条红?为什么页面层的测试不红?再想一下:如果真后端也漏了,用户在哪里能看到这个数字?

<details><summary>参考答案</summary>

改一行:

```ts
// supportpilot/web/scripts/fake_api.mts(forCustomer 里 done 那一行,临时改)
case "done": return { event: "done", data: { ticket_id: d.ticket_id, outcome: d.outcome, reply: d.reply, turns: d.turns, cost_cny: d.cost_cny } };
```

<div class="line-notes">

- `case "done": return { event: "done", data: {` 在摘要里多放一个 `cost_cny`。

</div>

我对「练习 3」同类的改动(多放行 `rule`)实跑过,结果是只有「客户收到的事件流里没有内部字段」红。这一道题的 `cost_cny` 同理:事件流里 `cost_cny` 在黑名单里,所以网络层那条红,信息是「事件流里不该出现 cost_cny」。页面层的测试(包括「客户页面上没有内部信息」里搜「花费」)不红,因为 `RunView` 在客户那一档里只有 `staff` 为真才渲染花费,前端是第二道门,会替后端兜住。

用户能在哪里看到:DevTools 的 Network 面板里点开 `/run` 请求的 Response,每个 `done` 事件里有 `"cost_cny":0.02598`。也就是说有两道门,第二道没漏不代表第一道可以漏。恢复:把那一行改回去,再跑全部,18 passed。

</details>

**验收标准:** `uv run pytest tests/test_audience.py` 通过;`leak_scan.mts` 打印「没有多余字段」;`npx playwright test` 全绿(我这里 18 条,28 秒);你能说出 e2e 和 reducer 脚本测试各自管什么;你能回答「为什么只在前端隐藏不够」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 信息密度 | 同一份数据给不同的人看多少。客户要结果和进度,客服要全过程,财务要做决定的最少信息 |
| 白名单 | 只有明确写进去的才放行,没写的默认拒绝。反面是黑名单:只挡明确列出的,漏列的就漏过去 |
| 端到端测试(e2e) | 从用户的角度把整条链路当黑盒跑一遍,只检查用户看得到的结果 |
| Playwright | 微软的浏览器自动化库,自带测试运行器 `@playwright/test`,能驱动 Chromium、Firefox、WebKit |
| locator | Playwright 里「怎么找到页面上的元素」的描述,比如 `getByRole`、`getByLabel`;动作发生时才去找,会自动等 |
| strict mode violation | locator 要对元素操作却匹配到多个,Playwright 直接报错而不是猜 |
| flaky | 同样的代码、同样的测试,有时过有时不过 |
| trace | Playwright 记录的一次测试执行的回放包,里面有每步的页面快照和网络请求 |
| axe-core | 开源的可访问性规则引擎,能自动查出对比度、缺标签、标题跳级等问题 |
| WCAG | 网页内容可访问性指南,对比度要求 AA 级正文 4.5:1 |
| 变异测试 | 故意把代码改坏,看测试会不会红。红了说明测试有用,不红说明测试有洞 |
| 健康检查 URL | 服务起来以后能返回 200 的地址,Playwright 用它判断 `webServer` 是否就绪 |

## 常见误区

**以为前端不渲染就是没泄露。** DevTools 的 Network 面板里什么都看得到。要不要给,在后端的出口决定,前端的筛选是第二道门,不是第一道。

**用黑名单挡内部字段。** 「把 `note`、`rule`、`cost_cny` 删掉」看起来更省事,但下个月有人给事件加个新字段,它就自动发给客户了。白名单只给明确写出来的,新字段默认不给。

**默认值给了最全的那一份。** `_events(..., audience="staff")` 当默认值,调用的人忘了写就是全量。默认给最少,要全量的明确写出来。

**用 `.first()` 或 `.nth(0)` 绕过 strict mode violation。** 绕过去以后,页面结构一变就悄悄点错元素。缩小范围(比如限定到 `main`、一张卡片、一个有名字的列表)比取第几个稳。

**断言一个只亮一秒的中间状态。** 单独跑通过,并行跑偶尔红。应该断言「确定发生过」的事:网络请求的响应、最终状态。

**测试里到处 `waitForTimeout(2000)`。** 睡死的时间要么太短(机器忙就红),要么太长(每条多等几秒,全套慢得没人想跑)。Playwright 的 `expect(...)`、`click()`、`fill()` 都会自动等,用它们。

**只在页面层测。** 页面上看不到,不等于事件流里没有。涉及「发给谁什么」的地方,至少留一条读网络原始文本的测试。

**把 e2e 当单元测试用。** 18 条 e2e 28 秒,每条要起浏览器、走一遍页面。reducer 的分支(Day 469 的 `check_reducer.mts`)用一个函数调用就能测,别把所有东西都推到 e2e 里。e2e 留给「这些零件拼在一起还对不对」。

## 学习资料

### 文档与文章

- [Playwright · Best Practices](https://playwright.dev/docs/best-practices):官方列的测试原则,讲为什么优先用用户看得到的方式找元素(`getByRole`)、为什么不要依赖实现细节。英文,10 分钟。
- [Playwright · Locators](https://playwright.dev/docs/locators):`getByRole`、`getByLabel`、`filter`、strict mode 的完整说明,「strictness」那一节解释了今天踩的坑。英文。
- [Playwright · Web server](https://playwright.dev/docs/test-webserver):`webServer` 数组、`reuseExistingServer`、`url` 健康检查的写法。英文。
- [Playwright · Accessibility testing](https://playwright.dev/docs/accessibility-testing):官方对 axe 集成的说明,也写了「自动检测只能发现一部分问题」。英文。
- [Playwright · Trace Viewer](https://playwright.dev/docs/trace-viewer):失败测试留下的 zip 怎么打开、怎么看每一步。英文。
- [菜鸟教程 · Playwright 教程](https://www.runoob.com/playwright/playwright-tutorial.html):中文入门,先了解有哪些概念时看。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1gU4y1S7Qq&autoplay=0&high_quality=1" title="微软开源最强Python自动化神器Playwright！不用写一行代码！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>软件测试大全 · 微软开源最强 Python 自动化神器 Playwright!不用写一行代码! · 2022 年上传,是个多集合辑,第一集 24 分钟。讲的是 Python 版的录制功能(codegen),和我们用的 TypeScript 测试运行器不是同一套命令,但「录一遍操作生成代码」「按元素定位」的思路一样。看个整体印象即可。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/wawbt1cATsk" title="Playwright with TypeScript : Learn Playwright Automation Tutorial from Scratch [6 Hours]" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>TestMu AI(原 LambdaTest) · Playwright with TypeScript: Learn Playwright Automation Tutorial from Scratch · 6 小时的完整课程,英文。不用从头看,按章节跳到 locators、assertions、fixtures 那几段,和今天的内容对照。</figcaption>
</figure>

### 书籍

- Lucas da Costa《Testing JavaScript Applications》(Manning,2021):前端和 Node 的测试全景,讲怎么分配单元测试、集成测试和端到端测试的比例,以及测试的可靠性。英文,没查到中译本。
- Heydon Pickering《Inclusive Components》(Smashing Magazine,2019):今天 axe 查出来的两类问题(对比度、标题级别)和读屏软件的使用方式,书里按组件一章一章讲。英文,没查到中译本。

### 开源项目与代码

- [microsoft/playwright](https://github.com/microsoft/playwright):Playwright 源码和 issue,遇到奇怪行为时搜 issue 常常能找到解释。
- [dequelabs/axe-core-npm](https://github.com/dequelabs/axe-core-npm):`@axe-core/playwright` 所在的仓库,「error-handling」文档里有 `Please use browser.newContext()` 那个报错的解释。

## 自测

1. 为什么客户页面的 `RunView` 没渲染 `rule`,还是要在后端把它从事件里去掉?

<details><summary>答案</summary>

因为浏览器收到的是整条流,不管前端渲染不渲染,DevTools 的 Network 面板里每个字段都看得见,任何人都能读。前端筛选只是第二道门。后端出口决定给不给才是第一道。我在 `leak_scan.mts` 里量到的:没裁剪时客户那条线上的 77 个事件里只有 69 个能用,剩下的 `tool`、规则、给模型的提示、花费都在网络上。

</details>

2. 白名单和黑名单有什么区别?`for_customer` 里最后一行 `return None` 起什么作用?

<details><summary>答案</summary>

白名单只放行明确写出来的,黑名单只拦明确列出的。后端事件以后一定会被加新字段、新事件:黑名单漏列一个,新东西就自动发给了客户;白名单漏写一个,最坏是客户界面少一点东西,马上就能发现。最后那行 `return None` 是白名单的默认拒绝:没见过的事件名一律不推。测试 `test_unknown_event_is_hidden_by_default` 专门保证了这一点。

</details>

3. Playwright 里 `expect(page.getByRole("alert")).toHaveCount(0)` 在 Next.js 页面上为什么会失败?怎么改?

<details><summary>答案</summary>

Next.js 在页面里放了一个空的 `<div role="alert" id="__next-route-announcer__">` 用来给读屏软件播报路由切换,所以 `getByRole("alert")` 永远至少匹配到一个。用 `toHaveText` 断言时还会触发 strict mode violation(匹配到两个)。改成 `page.locator("main").getByRole("alert")`,把范围限定在 `<main>` 里,Next.js 的 div 在它外面。不要用 `.first()` 绕。

</details>

4. 「断线」那条测试第一版为什么时灵时不灵?两层原因各是什么?

<details><summary>答案</summary>

第一层是测试写错了:它断言「正在接回进度」这个只亮 1 秒的中间状态,并行跑、机器忙时 Playwright 的轮询偶尔错过这一秒(144 次执行里失败 3 次)。改成断言网络上出现过 409 的 `/resume` 响应。第二层是假后端的时序问题:掐断连接前没有等写出去的事件到达浏览器,浏览器偶尔一个事件都没收到,前端判定「流没开起来」。在掐断前加 `await sleep(400)` 以后,40 次重复 0 次失败(0 毫秒 2/30、100 毫秒 2/40)。

</details>

5. **面试题**:你做的 Agent 产品里,客户、客服、管理员看到的信息不同。你怎么保证客户看不到不该看的?怎么用测试来保证?

<details><summary>答案</summary>

答题要点:先分清两件事,界面不显示和数据没发出去。保密要在服务端的出口按身份裁剪,用白名单,默认给最少,新字段不自动放行;客户那几个接口默认走客户那一份,要全量的接口明确传参并且必须过登录和权限(不能只靠约定)。测试分两层:单元测试覆盖裁剪函数,包括「未知事件默认不给」;端到端测试里至少有一条直接读网络上的原始响应文本,搜内部字段,因为页面层的断言抓不到「发了但没渲染」。再补一条「改坏白名单看测试红不红」的变异检验,证明测试有用。还可以提到:前端同样按观众选信息密度,是体验层面的第二道门。

</details>

6. axe 全绿是不是说明这个页面对所有人都可用?

<details><summary>答案</summary>

不是。axe 只能查机器能判断的规则(对比度、缺 label、标题级别、重复 id 之类),官方说法是能覆盖大约一半的可访问性问题。焦点顺序合不合理、读出来的文字有没有意义、键盘能不能完成全流程,这些要人来试(比如用 VoiceOver 或 NVDA 走一遍)。Day 471 手工看可访问性树发现的「点停止后焦点掉回 body」,axe 就查不出来,我们是用 `toBeFocused()` 断言补上的。

</details>

## 明天预告

明天是 [Day 473](/blog/agent-zero/day-473-ts-agents-1/),用 TypeScript 写 Agent(一):选择、结构和 AI SDK 的 ToolLoopAgent。今天和前几天的界面都是 Python 后端加 TypeScript 前端,事件协议是我们自己定义的。如果起一个全新项目、后端也是 Node,Vercel 的 AI SDK 能省掉大半事件协议和 reducer 的代码,连工具审批都有现成的。明天先把选择讲清楚,再用 `ToolLoopAgent` 把同样的退款审批写一遍,真调一次模型。
