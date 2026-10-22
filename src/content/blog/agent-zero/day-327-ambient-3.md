---
title: 'Day 327 · 后台 Agent(三):收件箱式审批'
description: '昨天 5 张工单停在了 review,却没有一个给人用的入口。今天把收件箱做出来:讲清 Agent Inbox 的四种处理 accept、edit、response、ignore 和它现在在 LangChain 里的样子,给 review 节点补上 edit 和 response,写一个命令行收件箱把四种都走一遍;再让定时任务的超期提醒也以「通知」的形式进收件箱,最后出一份盯着收件箱和死信的日报。'
pubDate: 2026-10-22
regime: none
tags: ['ambient-agent', 'langgraph', 'human-in-the-loop', 'agent-zero']
series: 'agent-zero'
day: 327
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 326](/blog/agent-zero/day-326-ambient-2/) 把后台 Agent 的中段搭起来了:`webhook.py` 只验签、落库、回 202;`agent.py` 是一张「load → draft → review」的图,thread_id 用工单号;`worker.py` 用一条 `UPDATE ... RETURNING` 原子地领事件,失败重试,三次进死信,还能分清「停下等人」和「跑到一半崩了」。练习 1 加了 `PermanentError`,工单不存在一次就进死信。

跑完以后,T1012、T1041、T1003、T1033、T1007 五张工单停在 review,事件表里是 `waiting_human`。问题是:人在哪里看到它们,怎么告诉 Agent「就这么发」「我改一下再发」「你重写」「算了」?今天做的就是这个入口,收件箱。

## 今天要解决的问题

学完今天,你要能做到:

1. 说清 Agent Inbox 的数据结构(`action_request`、`config`、`description`)和四种处理(accept、edit、response、ignore),以及它和 LangChain 1.x `HumanInTheLoopMiddleware` 的对应关系。
2. 给 review 节点补上 edit 和 response,让一条待办可以「重写 → 再审」来回多轮。
3. 写一个命令行收件箱 `inbox.py`,四种处理都走通,并且按条目自己的 `config` 拒绝不允许的操作。
4. 让定时任务的超期提醒变成「通知」类待办进收件箱,并写一份日报,说出上线后最该盯的几个数。

预计用时 3 小时。前置:昨天的 `store.py`、`agent.py`、`worker.py`(包括练习 1 的 `PermanentError`),[Day 319](/blog/agent-zero/day-319-lg-interrupt/) 的 `Command(resume=...)` 和「恢复时节点从头重跑」,[Day 325](/blog/agent-zero/day-325-ambient-1/) 的 `ingest.py`。实跑花费约 0.012 元:正文和练习一共调了 7 次模型(T1025 起草和重写 2 次、T1029 1 次、T1034 2 次、T1035 1 次、邮件工单 1 次),按 Day 326 量的每次约 0.0017 元算,7 × 0.0017 ≈ 0.012。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 review 节点的四个分支和 `inbox.py` 的 `build_answer` 默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 收件箱是什么

聊天式 Agent 找人很简单,人就在对面。后台 Agent 找人时,对面没有人,只能把「我需要你」这件事放在一个地方,等人有空来处理。这个地方就是收件箱:一个待办列表,每条待办说清楚 Agent 想干什么、你能怎么处理。

LangChain 在 2025 年提出 ambient agent 的同时,开源了一个叫 Agent Inbox 的界面,并定义了两个数据结构。它的 README 里是 TypeScript 写的,前端同学应该一眼就懂:

```typescript
interface HumanInterrupt {
  action_request: ActionRequest;   // { action: string; args: Record<string, any> }
  config: HumanInterruptConfig;    // { allow_ignore, allow_respond, allow_edit, allow_accept: boolean }
  description?: string;
}

type HumanResponse = {
  type: "accept" | "ignore" | "response" | "edit";
  args: null | string | ActionRequest;
};
```

<div class="line-notes">

- `action_request: ActionRequest;   // { action: string; args: Record<string, any> }` Agent 想做的动作和参数。昨天的 review 节点里是 `{"action": "send_reply", "args": {"ticket_id": ..., "reply": ...}}`。
- `config: HumanInterruptConfig;    // { allow_ignore, allow_respond, allow_edit, allow_accept: boolean }` 这条待办允许人做哪几种处理。收件箱据此决定显示哪几个按钮。
- `description?: string;` 给人扫一眼的说明,可选。
- `type: "accept" | "ignore" | "response" | "edit";` 人的四种处理。
- `args: null | string | ActionRequest;` 跟着 type 变:accept 和 ignore 是 null,response 是一句话,edit 是一个改过的完整 `ActionRequest`。

</div>

昨天的 `interrupt({...})` 交出去的就是一个 `HumanInterrupt`,今天恢复时传进 `Command(resume=...)` 的就是一个 `HumanResponse`。四种处理各是什么意思:

- **accept**:就按 Agent 的草稿做。
- **edit**:人直接改好参数(这里是回复正文),按改过的做。不需要模型参与。
- **response**:人写一句意见,让 Agent 带着意见重来一遍。会再调一次模型,然后再停下来等人看。
- **ignore**:这件事不做了,图结束。工单本身还开着,人线下处理。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="review 节点的四种处理:accept 和 edit 走向 send,response 回到 draft 重写后再进 review,ignore 直接结束">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="20" y="88" width="70" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="55" y="109" fill="var(--ink)">load</text>
    <rect x="130" y="88" width="80" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="170" y="109" fill="var(--ink)">draft</text>
    <rect x="260" y="88" width="100" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/><text x="310" y="109" fill="var(--ink)">review ⏸</text>
    <rect x="470" y="40" width="80" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="510" y="61" fill="var(--ink)">send</text>
    <rect x="470" y="146" width="80" height="34" rx="13" fill="none" stroke="var(--ink-soft)"/><text x="510" y="167" fill="var(--ink-soft)">END</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="90" y1="105" x2="130" y2="105"/><line x1="210" y1="105" x2="260" y2="105"/>
    <line x1="360" y1="98" x2="470" y2="57"/><line x1="360" y1="114" x2="470" y2="163"/>
    <line x1="550" y1="57" x2="600" y2="57"/><line x1="600" y1="57" x2="600" y2="163"/><line x1="600" y1="163" x2="550" y2="163"/>
  </g>
  <path d="M310 122 Q240 200 170 122" stroke="var(--mem)" stroke-dasharray="4 3" fill="none"/>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="372" y="60">accept / edit</text>
    <text x="392" y="160">ignore</text>
    <text x="172" y="192">response:带着意见重写,再进一次 review</text>
  </g>
</svg>
<figcaption>四种处理里只有 response 会再调一次模型,并且会回到 review 再停一次。edit 是人改好了直接发。</figcaption>
</figure>

### 2026 年 10 月的现状

我去看的时候,[langchain-ai/agent-inbox](https://github.com/langchain-ai/agent-inbox) 这个仓库已经在 2026 年 9 月 20 日被归档,只读。LangChain 现在主推的是 LangChain 1.x 里的 [`HumanInTheLoopMiddleware`](https://docs.langchain.com/oss/python/langchain/human-in-the-loop):用 `create_agent` 建的 Agent,给某些工具调用挂上它,调用前就会停下等人。它的四种决定叫 `approve`、`edit`、`reject`、`respond`,中断里放的是 `action_requests`(每个有 `name`、`args`、`description`)和 `review_configs`(每个有 `allowed_decisions`)。

名字不同,意思基本一一对应:

| Agent Inbox | HumanInTheLoopMiddleware | 意思 |
| --- | --- | --- |
| accept | approve | 照做 |
| edit | edit(带 `edited_action`) | 人改了参数再做 |
| response | respond(带 `message`) | 人回一句话,Agent 接着想 |
| ignore | reject(可带 `message`) | 不做 |
| `config.allow_*` | `allowed_decisions` | 这条允许哪几种 |

我们没有用 `create_agent`,是自己画的图,所以继续借用 Agent Inbox 那套结构。它字段少、说得清,而且以后换成 middleware,改的只是名字。这一页你可以当成「审批类交互的通用数据模型」来记,而不是记某个库的 API。

## 第 1 步:review 补上 edit 和 response

改昨天的 `agent.py`。只动五个地方,下面只贴改动的部分,其余和昨天(含练习 1 的 `PermanentError`)一样:

```python
# agent-zero-lab/part05/ambient/agent.py(只贴改动的部分)
class TicketState(TypedDict):
    ticket_id: str
    ticket_text: str
    draft: dict  # Draft.model_dump()
    feedback: list[str]  # 人每次 response 的意见,重写时全部带上
    outcome: str


def load(state: TicketState) -> dict:
    with store.connect(store.BIZ_DB) as conn:
        t = conn.execute("SELECT subject, body FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()
    if t is None:
        raise PermanentError(f"工单 {state['ticket_id']} 不存在")
    return {"ticket_text": f"{t['subject']}:{t['body']}", "feedback": []}


def draft(state: TicketState) -> dict:
    llm = get_llm().with_structured_output(Draft, method="function_calling")
    prompt = (
        "你是云簿 CloudLedger 的客服。给下面的工单分类并起草回复。\n\n"
        f"工单 {state['ticket_id']}:{state['ticket_text']}"
    )
    notes = "\n".join(f"- {f}" for f in state.get("feedback", []))
    if notes:
        prompt += f"\n\n客服主管对上一版草稿的意见,必须照改:\n{notes}"
    d = llm.invoke(prompt)
    assert isinstance(d, Draft)
    return {"draft": d.model_dump()}


def review(state: TicketState) -> dict:
    d = state["draft"]
    # 收件箱条目:要做什么动作(action_request)、允许人怎么处理(config)、给人看的说明(description)
    answer = interrupt({
        "action_request": {"action": "send_reply", "args": {"ticket_id": state["ticket_id"], "reply": d["reply"]}},
        "config": {"allow_accept": True, "allow_edit": True, "allow_respond": True, "allow_ignore": True},
        "description": f"[{d['category']}] {d['summary']}",
    })
    kind = answer["type"]
    if kind == "accept":
        return {"outcome": "send"}
    if kind == "edit":
        return {"outcome": "send", "draft": {**d, "reply": answer["args"]["args"]["reply"]}}
    if kind == "response":
        return {"outcome": "redraft", "feedback": state.get("feedback", []) + [answer["args"]]}
    return {"outcome": "ignored"}


def after_review(state: TicketState) -> str:
    return {"send": "send", "redraft": "draft"}.get(state["outcome"], END)


# 图的定义里只改这一行:多了一个去向 "draft"
builder.add_conditional_edges("review", after_review, ["send", "draft", END])
```

<div class="line-notes">

- `feedback: list[str]  # 人每次 response 的意见,重写时全部带上` 新字段。存的是一个列表,第二轮重写时把第一轮的意见也带上,免得改了这条忘了那条。
- `return {"ticket_text": f"{t['subject']}:{t['body']}", "feedback": []}` load 时把意见列表初始化成空。
- `prompt = (` 提示词先拼成变量,下面可能要往后追加。括号里两个字符串挨着写会自动拼成一个,Day 325 见过。
- `notes = "\n".join(f"- {f}" for f in state.get("feedback", []))` 每条意见前面加个短横,一行一条。用 `.get` 而不是 `state["feedback"]`,是因为**昨天就停在 review 的那几个 thread,State 里根本没有这个键**。代码升级了,老 thread 的数据还是老格式,这件事后面还会碰到一次。
- `if notes:` 只有被提过意见才加这一段。第一次起草时提示词里不出现「主管意见」几个字,免得模型以为有人不满意。
- `prompt += f"\n\n客服主管对上一版草稿的意见,必须照改:\n{notes}"` 意见追加在工单后面。
- `"config": {"allow_accept": True, "allow_edit": True, "allow_respond": True, "allow_ignore": True},` 四种全开。昨天是 `allow_edit` 和 `allow_respond` 都为 False。
- `kind = answer["type"]` `answer` 就是收件箱传进来的 `HumanResponse`。
- `return {"outcome": "send", "draft": {**d, "reply": answer["args"]["args"]["reply"]}}` edit 时人送回来的是一个完整的 `ActionRequest`,正文在 `args.args.reply` 两层下面。`{**d, "reply": ...}` 保留类别和摘要,只换正文,相当于 JS 的 `{...d, reply: ...}`。`send` 节点读的是 `state["draft"]["reply"]`,所以发出去的就是人改过的版本。
- `return {"outcome": "redraft", "feedback": state.get("feedback", []) + [answer["args"]]}` response 时 `args` 就是人写的那句话。用 `+` 生成一个新列表,不要 `.append()` 原地改 State 里的列表。
- `return {"outcome": "ignored"}` ignore:什么都不发,图结束。
- `return {"send": "send", "redraft": "draft"}.get(state["outcome"], END)` 用字典查表代替一串 if。查不到(ignored)就去 END。
- `builder.add_conditional_edges("review", after_review, ["send", "draft", END])` 去向里多了 `draft`,图里出现了一个 review → draft → review 的环。环会不会转不停?不会,每转一圈都要人在收件箱里点一次 respond。

</div>

注意 review 节点里 `interrupt()` 后面的代码:Day 319 讲过,恢复时节点从第一行重新执行,这次 `interrupt()` 直接返回人的答复,然后往下走。所以 interrupt 前面只能读不能写,后面的代码每次恢复只跑一次,可以放有副作用的东西(练习 1 会往后面加一行写日志)。

## 第 2 步:命令行收件箱

收件箱要回答两个问题:「现在有哪些待办」和「这条待办具体是什么」。第一个问题问事件表,`status = 'waiting_human'` 的那些行就是目录;第二个问题问 checkpoint 库,`get_state(...).interrupts[0].value` 就是那个 `HumanInterrupt`。昨天练习 4 的 `list_waiting.py` 已经这么做过一次。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="收件箱的数据流:inbox.py list 从 events 表读 waiting_human 作为目录,再到 checkpoints.db 用 get_state 取每条的 interrupt 内容;处理时先按 config 检查是否允许,再用 Command(resume) 恢复图,图跑完后把事件改成 done">
  <rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="20" y="30" width="150" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="95" y="50" fill="var(--ink)">events 表</text>
    <text x="95" y="66" font-size="10" fill="var(--ink-soft)">目录:谁在等人</text>
    <rect x="20" y="120" width="150" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <text x="95" y="140" fill="var(--ink)">checkpoints.db</text>
    <text x="95" y="156" font-size="10" fill="var(--ink-soft)">内容:interrupt 的值</text>
    <rect x="245" y="72" width="140" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="315" y="93" fill="var(--ink)">inbox.py</text>
    <text x="315" y="110" font-size="10" fill="var(--ink-soft)">先查 config 再恢复</text>
    <rect x="460" y="72" width="160" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="540" y="93" fill="var(--ink)">图继续跑</text>
    <text x="540" y="110" font-size="10" fill="var(--ink-soft)">Command(resume=...)</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="170" y1="52" x2="245" y2="88"/><line x1="170" y1="142" x2="245" y2="106"/>
    <line x1="385" y1="97" x2="460" y2="97"/>
    <path d="M540 122 Q540 190 95 190 L95 164" stroke-dasharray="4 3"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="300" y="200">跑完:checkpoint 更新,事件改 done</text>
    <text x="390" y="88">accept / edit / respond / ignore</text>
  </g>
</svg>
<figcaption>目录和内容分在两个库里。网页版收件箱也是这个结构:列表页是 list,四个按钮是四个子命令。</figcaption>
</figure>

```python
# agent-zero-lab/part05/ambient/inbox.py
"""命令行收件箱(在 part05/ambient 目录下运行):
  uv run python inbox.py list
  uv run python inbox.py accept  T1012
  uv run python inbox.py edit    T1041 "改过的回复全文"
  uv run python inbox.py respond T1041 "语气再软一点,先道歉"
  uv run python inbox.py ignore  T1003
  uv run python inbox.py ignore  stale-2026-10-22      # 通知类待办,看过就 ignore
"""
import json
import sys

from langchain_core.runnables import RunnableConfig
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command

import agent
import notify
import store

ALLOW = {"accept": "allow_accept", "edit": "allow_edit", "respond": "allow_respond", "ignore": "allow_ignore"}


def waiting() -> list[dict]:
    """收件箱的目录:事件表里所有 waiting_human 的事件,算出每条的短名字和对应的 thread。"""
    with store.connect() as conn:
        rows = conn.execute(
            "SELECT event_id, kind, payload, updated_at FROM events WHERE status = 'waiting_human' ORDER BY updated_at"
        ).fetchall()
    items = []
    for r in rows:
        p = json.loads(r["payload"])
        if r["kind"] == "digest.stale_tickets":
            key, which, config = f"stale-{p['run_date']}", "digest", notify.thread_of(p["run_date"])
        else:
            ticket_id = p["data"]["ticket_id"]
            key, which, config = ticket_id, "ticket", agent.thread_of(ticket_id)
        items.append({"key": key, "event_id": r["event_id"], "which": which, "config": config, "since": r["updated_at"]})
    return items


def build_answer(cmd: str, key: str, text: str) -> dict:
    if cmd == "accept":
        return {"type": "accept", "args": None}
    if cmd == "edit":
        return {"type": "edit", "args": {"action": "send_reply", "args": {"ticket_id": key, "reply": text}}}
    if cmd == "respond":
        return {"type": "response", "args": text}
    return {"type": "ignore", "args": None}


def main() -> None:
    cmd = sys.argv[1]
    ticket_graph, c1 = agent.open_graph()
    digest_graph, c2 = notify.open_graph()
    graphs: dict[str, CompiledStateGraph] = {"ticket": ticket_graph, "digest": digest_graph}
    try:
        items = waiting()
        if cmd == "list":
            for it in items:
                item = graphs[it["which"]].get_state(it["config"]).interrupts[0].value
                ok = [c for c, flag in ALLOW.items() if item["config"][flag]]
                print(f"{it['key']:<18} 等待自 {it['since'][11:16]}  可用:{'/'.join(ok)}")
                print(f"    {item['description']}")
                if "reply" in item["action_request"]["args"]:
                    print(f"    草稿:{item['action_request']['args']['reply']}")
            return

        key = sys.argv[2]
        text = sys.argv[3] if len(sys.argv) > 3 else ""
        it = next((i for i in items if i["key"] == key), None)
        if it is None:
            print(key, "不在收件箱里(已经处理过,或者还没轮到 worker)")
            return
        graph: CompiledStateGraph = graphs[it["which"]]
        config: RunnableConfig = it["config"]
        item = graph.get_state(config).interrupts[0].value
        if not item["config"][ALLOW[cmd]]:
            print(f"{key} 这条待办不允许 {cmd}")
            return

        result = graph.invoke(Command(resume=build_answer(cmd, key, text)), config)
        if "__interrupt__" in result:
            print("已按意见重写,新草稿:", result["__interrupt__"][0].value["action_request"]["args"]["reply"])
            return
        store.set_status(it["event_id"], "done")
        print(key, "→", result["outcome"])
    finally:
        c1.close()
        c2.close()


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import notify` 第 3 步要写的通知图。先把 `inbox.py` 敲完,跑之前把第 3 步的 `notify.py` 也建好(`waiting()` 和 `main()` 都用到它)。
- `ALLOW = {"accept": "allow_accept", "edit": "allow_edit", "respond": "allow_respond", "ignore": "allow_ignore"}` 子命令名到 config 字段名的对照表。命令行上写 `respond` 比 `response` 顺手,数据结构里还是 `response`。
- `"SELECT event_id, kind, payload, updated_at FROM events WHERE status = 'waiting_human' ORDER BY updated_at"` 目录来自事件表,等得最久的排在最前面。
- `if r["kind"] == "digest.stale_tickets":` 定时任务的通知类待办,短名字叫 `stale-日期`,走通知图。
- `key, which, config = f"stale-{p['run_date']}", "digest", notify.thread_of(p["run_date"])` 一次给三个变量赋值,右边是三个值。`which` 记住用哪张图。
- `ticket_id = p["data"]["ticket_id"]` 工单类的短名字就是工单号。
- `items.append({"key": key, "event_id": r["event_id"], "which": which, "config": config, "since": r["updated_at"]})` 每条待办记下五样东西,后面都要用。
- `return {"type": "edit", "args": {"action": "send_reply", "args": {"ticket_id": key, "reply": text}}}` edit 送回一个完整的 `ActionRequest`,结构和收件箱条目里的那份一样,只是 reply 换成人写的。
- `return {"type": "response", "args": text}` response 只送一句话。
- `ticket_graph, c1 = agent.open_graph()` 两张图各开一个到 `checkpoints.db` 的连接,同一个文件,不同的 thread。
- `item = graphs[it["which"]].get_state(it["config"]).interrupts[0].value` 从 checkpoint 里取出这条待办的 `HumanInterrupt`。
- `ok = [c for c, flag in ALLOW.items() if item["config"][flag]]` 列出这条允许的操作,只显示能点的「按钮」。
- `if "reply" in item["action_request"]["args"]:` 通知类待办没有草稿,不打这一行。
- `it = next((i for i in items if i["key"] == key), None)` 在目录里找这一条。第二个参数 `None` 是找不到时的默认值;不写的话,对一张已经处理完的工单再 accept 一次会直接抛 `StopIteration`。
- `if not item["config"][ALLOW[cmd]]:` **按条目自己的 config 判断**,而不是按现在代码里写的默认值。这一行马上会拦下一次真实的情况。
- `result = graph.invoke(Command(resume=build_answer(cmd, key, text)), config)` 带着人的决定恢复。review 节点从头执行,这次 `interrupt()` 直接返回答复。
- `if "__interrupt__" in result:` 只有 response 会走到这里:重写完又停在了 review。事件状态保持 `waiting_human` 不变。
- `store.set_status(it["event_id"], "done")` 图跑完了,事件也收尾。发了还是没发,看 `outcome`。
- `print(key, "→", result["outcome"])` accept 和 edit 打印 `sent`,ignore 打印 `ignored`。

</div>

### 先处理昨天留下的五条

这一节和第 3 步一起跑。先把第 3 步的 `notify.py` 和改过的 `worker.py` 建好,再回来跑下面的命令。

```bash
cd agent-zero-lab/part05/ambient
uv run python inbox.py list
```

```text
T1012              等待自 18:55  可用:accept/ignore
    [account] 客户登录时验证码反复提示过期,已尝试五六次,急需登录。
    草稿:您好,非常抱歉给您带来不便。验证码提示过期通常与手机时间不同步、短信延迟或多次重复获取有关。建议您:1) 确认手机系统时间为自动同步;2) 只点击一次获取,等待最新一条验证码并在5分钟内输入;3) 清除浏览器缓存或更换网络后重试。若仍无法登录,请回复您的账号邮箱,我们为您转技术核查。
T1041              等待自 18:55  可用:accept/ignore
    [refund] 客户反映10月8日被重复扣款,INV-2026-0026与INV-2026-0123金额相同,要求退还多扣的一笔。
    草稿:您好,感谢反馈。已收到您关于10月8日两笔金额相同的扣款(INV-2026-0026、INV-2026-0123)的说明,我们已转交财务核查是否为重复扣款。核实后会在1-3个工作日内告知处理结果,如确属重复扣款将按流程为您办理退款。给您带来不便,敬请谅解。
T1003              等待自 18:55  可用:accept/ignore
    [account] 客户要求取消订阅并停止自动续费。
    草稿:您好,感谢您的来信。我们已收到您取消订阅、停止自动续费的请求,正在为您处理。取消后,您的订阅将在当前计费周期结束时到期,期间仍可正常使用。为避免遗漏,请确认您希望取消的是哪个套餐。如有疑问,欢迎随时联系我们。
T1033              等待自 18:56  可用:accept/ignore
    ……(T1033 和 T1007 两条略)
```

五条都只有 `accept/ignore`。为什么?代码里明明四种都开了。因为这五条待办是**昨天的代码**生成的,它们的 `HumanInterrupt` 连同 `config` 一起存在 checkpoint 里,今天改代码改不到它们。这是后台 Agent 很容易忽视的一点:一条待办可能挂好几天,这期间你上线了好几版代码,收件箱里同时存在好几个版本的待办。

处理几条看看:

```bash
uv run python inbox.py accept T1012
uv run python inbox.py accept T1012
uv run python inbox.py edit T1041 "x"
uv run python inbox.py ignore T1003
sqlite3 ambient.db "select ticket_id, sent_by, substr(body,1,30) from outbox"
```

```text
T1012 → sent
T1012 不在收件箱里(已经处理过,或者还没轮到 worker)
T1041 这条待办不允许 edit
T1003 → ignored
T1012|agent+reviewer|您好,非常抱歉给您带来不便。验证码提示过期通常与手机时间不同
```

T1012 发出去了,重复 accept 被挡住;T1041 的 edit 被拒,因为它的条目说不许;T1003 忽略了,outbox 里没有它。

拒绝 T1041 的 edit 是对的吗?我认为是。条目的 config 是生成它时的规则,收件箱按条目自己的规则走,才不会出现「昨天的 Agent 交出来时说这个不许改,今天却被改了」。想按新规则重新生成这条待办,用 [Day 322](/blog/agent-zero/day-322-lg-time-travel/) 的时间旅行回到 review 之前重跑一遍就行,不用重新调模型,练习 3 来做。

这里有个前端同学一看就懂的问题:收件箱检查 config,相当于前端表单校验,挡得住正常用户,挡不住直接调接口的人。review 节点里自己也该再检查一遍「这个 type 允不允许」,就像后端不能信任前端校验一样。今天的 CLI 是唯一入口,先不做;做成网页 API 时一定要补上。

### 新工单,四种处理全开

发一张新的重复扣款工单 T1025,今天的代码会给它生成四种全开的条目。(第 3 步的 worker 改动先做完再跑这一段,uvicorn 要在第一个终端开着。)

```bash
uv run python send_webhook.py T1025
```

```text
202 {'accepted': True, 'duplicate': False}
```

跑 worker 的命令放到第 3 步,和定时任务的事件一起跑。跑完以后 `list` 里 T1025 这一条是这样的:

```text
T1025              等待自 19:16  可用:accept/edit/respond/ignore
    [billing] 客户反映本月账单疑似重复扣款,INV-2026-0050 与另一笔金额相同,要求核查并退还多扣款项。
    草稿:您好,感谢联系云簿 CloudLedger。关于您反馈的重复扣款问题,我们已记录并转交财务核查 INV-2026-0050 及同期另一笔同额交易。核实后我们会尽快告知处理结果,如确认为重复扣款,将按流程为您办理退款。为加快核查,烦请提供两笔交易的扣款日期与支付方式。给您带来不便,敬请谅解。
```

我扮演客服主管,假设已经查过账,先 respond 让它重写,再 edit 定稿:

```bash
uv run python inbox.py respond T1025 "已确认 INV-2026-0050 是重复扣款,直接告诉客户退款申请已提交、原路退回,别写金额"
uv run python inbox.py edit T1025 "您好,已确认 INV-2026-0050 是重复扣款,退款申请已提交,会原路退回,到账时间以支付渠道为准。给您添麻烦了。"
uv run python history.py T1025
```

```text
已按意见重写,新草稿: 您好,感谢您的反馈。经核查,INV-2026-0050 确认为重复扣款,我们已为您提交退款申请,款项将按原支付路径退回,请留意到账通知。给您带来不便,敬请谅解。如后续仍有疑问,欢迎随时联系我们。
T1025 → sent
-1 11:16:07 下一步 ('__start__',)
0 11:16:07 下一步 ('load',)
1 11:16:07 下一步 ('draft',)
2 11:16:09 下一步 ('review',)
3 11:16:26 下一步 ('draft',)
4 11:16:27 下一步 ('review',)
5 11:16:40 下一步 ('send',)
6 11:16:40 下一步 ()
```

`history.py` 是昨天写的。快照历史把来回的过程记得清清楚楚:step 2 第一次停在 review;step 3 是 respond 之后回到 draft;step 4 第二次停在 review;step 5 是 edit 之后去 send。重写版本照着意见改了,也确实没写金额。

模型重写版其实已经能用了,我为什么还要 edit?因为我想要更短、更像人说话的一句。这种修改每天都会发生,它们是最值钱的数据:人改了什么、为什么改,下一版提示词或者以后的微调就从这里来。练习 1 会把每次处理都记下来。

## 第 3 步:定时任务也进收件箱

Day 325 讲过后台 Agent 找人有三种方式:通知、提问、审核。今天的工单回复是「审核」;Day 325 的定时任务扫出 12 张超期工单,它不需要人审什么,只需要人知道一下,这是「通知」。用同一个收件箱装它,条目只允许 ignore(看过即可)。

通知不调模型,单独一张一个节点的小图:

```python
# agent-zero-lab/part05/ambient/notify.py
"""通知类待办:Day 325 的定时任务扫出超期工单,不调模型,只在收件箱里放一条「你知道一下」。"""
import sqlite3
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import interrupt

from agent import CKPT_DB


class DigestState(TypedDict):
    run_date: str
    ticket_ids: list[str]
    outcome: str


class DigestInput(TypedDict):
    run_date: str
    ticket_ids: list[str]


def notify(state: DigestState) -> dict:
    ids = state["ticket_ids"]
    interrupt({
        "action_request": {"action": "notify_supervisor", "args": {"ticket_ids": ids}},
        "config": {"allow_accept": False, "allow_edit": False, "allow_respond": False, "allow_ignore": True},
        "description": f"[通知] {state['run_date']} 有 {len(ids)} 张工单开了 20 天以上:{', '.join(ids[:5])} 等",
    })
    return {"outcome": "acknowledged"}


builder = StateGraph(DigestState, input_schema=DigestInput)
builder.add_node("notify", notify)
builder.add_edge(START, "notify")
builder.add_edge("notify", END)


def open_graph() -> tuple[CompiledStateGraph, sqlite3.Connection]:
    conn = sqlite3.connect(CKPT_DB, check_same_thread=False)
    return builder.compile(checkpointer=SqliteSaver(conn)), conn


def thread_of(run_date: str) -> RunnableConfig:
    return {"configurable": {"thread_id": f"digest-{run_date}"}}
```

<div class="line-notes">

- `from agent import CKPT_DB` 和工单图共用一个 checkpoint 库文件,靠 thread_id 的前缀区分。
- `class DigestInput(TypedDict):` 输入就是定时任务 payload 里的两样:哪一天、哪些工单。
- `ids = state["ticket_ids"]` Day 325 的 `ingest.py` 已经把超期工单号查好放进 payload 了,这里不用再查业务库。
- `interrupt({` 返回值不用接,ignore 是唯一允许的处理,恢复后直接往下走。
- `"config": {"allow_accept": False, "allow_edit": False, "allow_respond": False, "allow_ignore": True},` 只开 ignore。在 Agent Inbox 的界面上,这种条目只显示一个「知道了」按钮。
- `"description": f"[通知] {state['run_date']} 有 {len(ids)} 张工单开了 20 天以上:{', '.join(ids[:5])} 等",` 只列前 5 个,完整列表在 `args` 里。`', '.join(...)` 相当于 JS 的 `ids.slice(0, 5).join(', ')`。
- `return {"outcome": "acknowledged"}` 人看过了。
- `return {"configurable": {"thread_id": f"digest-{run_date}"}}` 一天一个 thread,和 Day 325 定时任务的去重键 `cron:stale_tickets:日期` 同一个粒度。

</div>

worker 要按事件的 `kind` 分派到不同的图。在昨天的 `worker.py` 里加两个函数,`main()` 里多开一张图:

```python
# agent-zero-lab/part05/ambient/worker.py(只贴改动的部分)
import notify
import store
from agent import PermanentError, open_graph, thread_of


def handle_digest(graph: CompiledStateGraph, ev: dict) -> str:
    p = json.loads(ev["payload"])
    config = notify.thread_of(p["run_date"])
    snap = graph.get_state(config)
    if snap.next or snap.values.get("outcome"):
        return "done"  # 这一天的通知已经在收件箱里,或者已经看过了
    result = graph.invoke({"run_date": p["run_date"], "ticket_ids": p["ticket_ids"]}, config)
    return "waiting_human" if "__interrupt__" in result else "done"


def dispatch(graphs: dict[str, CompiledStateGraph], ev: dict) -> str:
    if ev["kind"] == "ticket.created":
        return handle(graphs["ticket"], ev)
    if ev["kind"] == "digest.stale_tickets":
        return handle_digest(graphs["digest"], ev)
    raise PermanentError(f"没有处理 {ev['kind']} 的图")


def main() -> None:
    once = "--once" in sys.argv
    store.init()
    graph, conn = open_graph()
    digest_graph, digest_conn = notify.open_graph()
    graphs = {"ticket": graph, "digest": digest_graph}
    try:
        while True:
            # ……中间和昨天一样,只有这一行从 handle(graph, ev) 改成了 dispatch:
                status = dispatch(graphs, ev)
            # ……
    finally:
        conn.close()
        digest_conn.close()
```

<div class="line-notes">

- `import notify` 新的通知图。
- `snap = graph.get_state(config)` 和 `handle` 一样,跑之前先看这一天的通知 thread 什么状态。
- `if snap.next or snap.values.get("outcome"):` `next` 不为空说明已经停在收件箱里(通知图只有一个节点,不存在跑到一半);`outcome` 有值说明已经看过了。两种都不再放一条新的。我第一版只写了 `snap.next`,写完对着代码推了一遍才发现漏洞:通知被 ignore 以后 `next` 是空的,同一天的事件要是再被处理一次(比如有人手动重放),就会再放进收件箱一条。
- `result = graph.invoke({"run_date": p["run_date"], "ticket_ids": p["ticket_ids"]}, config)` 从 payload 里取两样东西当输入。
- `if ev["kind"] == "ticket.created":` 工单类还走昨天的 `handle`。
- `raise PermanentError(f"没有处理 {ev['kind']} 的图")` 没写处理器的类型(今天是邮件)直接进死信,一次就进,不重试。不抛错、悄悄标 done 更糟糕:那等于把客户的邮件扔了还没人知道。
- `graphs = {"ticket": graph, "digest": digest_graph}` 两张图放进字典,`dispatch` 按名字取。
- `status = dispatch(graphs, ev)` 唯一改动的调用点。
- `digest_conn.close()` 第二个连接也要关。

</div>

现在用 Day 325 的 `ingest.py` 把三种来源一起灌进来,再跑 worker。T1025 的 webhook 刚才已经发了,也在队列里:

```bash
uv run python ingest.py 2026-10-22
uv run python worker.py --once
```

```text
webhook 新事件? True
email 新事件? True
email 新事件? True
cron 新事件? True
事件表: [{'source': 'cron', 'status': 'pending', 'n': 1}, {'source': 'email', 'status': 'pending', 'n': 2}, {'source': 'webhook', 'status': 'dead', 'n': 2}, {'source': 'webhook', 'status': 'done', 'n': 3}, {'source': 'webhook', 'status': 'pending', 'n': 2}, {'source': 'webhook', 'status': 'waiting_human', 'n': 3}]
webhook:evt_T1025_created → waiting_human
webhook:evt_8f2c41 → done
email:<CAF7x2@mail.example.com> 永久失败 → dead: 没有处理 email.received 的图
email:<CAF9k1@mail.example.com> 永久失败 → dead: 没有处理 email.received 的图
cron:stale_tickets:2026-10-22 → waiting_human
```

`ingest.py` 打印的统计里,webhook 有 2 个 dead(T9999 和昨天练习 2 的 T1020)。worker 这边每一行都值得看:

- T1025 进了收件箱,就是上面那条四种全开的。
- `evt_8f2c41` 是 Day 325 模拟的那个 webhook,它的工单号是 T1041。T1041 已经在收件箱里,第二处去重让它直接 done,没调模型。
- 两封邮件进了死信,原因写得清清楚楚。练习 4 给它们写处理器。
- 定时任务变成了一条通知。

```bash
uv run python inbox.py list
```

输出的最后一条是:

```text
stale-2026-10-22   等待自 19:16  可用:ignore
    [通知] 2026-10-22 有 12 张工单开了 20 天以上:T1023, T1024, T1014, T1017, T1001 等
```

```bash
uv run python inbox.py accept stale-2026-10-22
uv run python inbox.py ignore stale-2026-10-22
```

```text
stale-2026-10-22 这条待办不允许 accept
stale-2026-10-22 → acknowledged
```

## 第 4 步:日报,盯住安静的坏掉

后台 Agent 最大的风险是**安静地坏掉**:没人在对面等结果,也就没人会立刻发现它不工作了。worker 挂了,事件就一直 pending;收件箱没人看,待办就一直等着。所以要有一份每天早上自动发出来的日报。

```python
# agent-zero-lab/part05/ambient/report.py
"""后台 Agent 的日报:队列里有多少、收件箱等得最久的是哪条、死信有哪些。交给定时任务每天早上跑。"""
from datetime import datetime

import store


def build_report() -> str:
    with store.connect() as conn:
        counts = dict(conn.execute("SELECT status, COUNT(*) FROM events GROUP BY status ORDER BY status").fetchall())
        oldest = conn.execute(
            "SELECT event_id, updated_at FROM events WHERE status = 'waiting_human' ORDER BY updated_at LIMIT 1"
        ).fetchone()
        dead = conn.execute("SELECT event_id, last_error FROM events WHERE status = 'dead' ORDER BY updated_at").fetchall()
        sent = conn.execute("SELECT COUNT(*) FROM outbox").fetchone()[0]
    lines = [f"事件状态:{counts}", f"已发出回复:{sent} 封"]
    if oldest:
        hours = (datetime.now() - datetime.fromisoformat(oldest["updated_at"])).total_seconds() / 3600
        lines.append(f"收件箱里等得最久的:{oldest['event_id']},已等 {hours:.1f} 小时")
    for d in dead:
        lines.append(f"死信:{d['event_id']}  {(d['last_error'] or '')[:60]}")
    return "\n".join(lines)


if __name__ == "__main__":
    print(build_report())
```

<div class="line-notes">

- `counts = dict(conn.execute("SELECT status, COUNT(*) FROM events GROUP BY status ORDER BY status").fetchall())` 每行是 `(状态, 数量)` 两个值,`dict()` 直接把一串二元组变成字典,相当于 JS 的 `Object.fromEntries(rows)`。
- `"SELECT event_id, updated_at FROM events WHERE status = 'waiting_human' ORDER BY updated_at LIMIT 1"` 收件箱里等得最久的那条。`updated_at` 是 worker 把它改成 waiting_human 的时刻,也就是开始等人的时刻。
- `dead = conn.execute("SELECT event_id, last_error FROM events WHERE status = 'dead' ORDER BY updated_at").fetchall()` 所有死信和原因。
- `hours = (datetime.now() - datetime.fromisoformat(oldest["updated_at"])).total_seconds() / 3600` 两个时间相减得到一段时长,`total_seconds()` 换成秒,再除以 3600 得小时。存的时间格式和 `datetime.now()` 都是本地时间,所以能直接相减。
- `lines.append(f"死信:{d['event_id']}  {(d['last_error'] or '')[:60]}")` 错误信息可能很长,截 60 个字符。`or ''` 防止 `last_error` 是 None 时切片报错。
- `return "\n".join(lines)` 拼成一段文本。要发到企业微信、飞书、Slack 的群机器人,它们都是「一个 webhook 地址 + 一段 JSON」,把这段文本 POST 过去就行。

</div>

```bash
uv run python report.py
```

```text
事件状态:{'dead': 4, 'done': 6, 'waiting_human': 3}
已发出回复:2 封
收件箱里等得最久的:webhook:evt_T1041_created,已等 0.4 小时
死信:webhook:evt_T9999_created  PermanentError: 工单 T9999 不存在
死信:webhook:evt_T1020_created  OpenAIAuthenticationError: Error code: 401 - {'error': {'mes
死信:email:<CAF7x2@mail.example.com>  PermanentError: 没有处理 email.received 的图
死信:email:<CAF9k1@mail.example.com>  PermanentError: 没有处理 email.received 的图
```

(这是做完上面 T1025 和通知那几步以后跑的。T1041 是我故意留着没处理的那条。)

上线以后我会盯这几个数:

- **队列深度**:pending 的事件数。持续上涨,说明 worker 处理不过来,或者已经挂了。
- **收件箱最长等待时间**:上面那一行。比条数更值得告警:十条都是刚进来的不要紧,一条等了三天说明流程断了。超过一个工作日就该提醒值班的人。
- **死信**:任何一条都值得看。今天四条里有三种原因:数据问题(T9999)、配置问题(key 错)、代码缺口(没有邮件处理器)。真实环境里还常见模型服务欠费、上游改了 payload 格式。
- **每类工单的处理分布**:accept、edit、response、ignore 各占多少。某一类 accept 率一直很高,说明可以考虑让它自动发;某一类 edit 率突然升高,说明模型或提示词出了问题,或者业务规则变了。这个数要从练习 1 的 `review_log` 算。
- **单事件成本**:一次起草约 0.0017 元(Day 326 算过),response 会多调一次。如果某类工单平均要来回两三轮,成本和人的耐心都会出问题。

日报本身也用定时任务跑。crontab 一行(`crontab -e` 打开,路径换成你自己的,`uv` 用 `which uv` 查出的绝对路径,因为 crontab 的环境变量和你的终端不一样):

```text
5 9 * * * cd /Users/你/agent-zero-lab/part05/ambient && /Users/你/.local/bin/uv run python report.py >> report.log 2>&1
```

这一行我没有真的装进 crontab,只用 [crontab.guru](https://crontab.guru/) 核对了 `5 9 * * *` 是「每天 9:05」。如果用 LangGraph 的托管部署(LangSmith Deployment),它自带 cron 功能,但[官方文档](https://docs.langchain.com/langsmith/cron-jobs)特别提醒所有时间按 UTC 解释,北京时间 9:05 要写成 `5 1 * * *`。Day 325 练习 3 讲过时区这件事。

三天下来,后台 Agent 的完整链路是:三种触发源 → 事件表(去重)→ worker(原子领取、重试、死信)→ 处理图(停在 review)→ 收件箱(四种处理)→ outbox(发送幂等)→ 日报。每一段都可以单独换掉:SQLite 换 Postgres,事件表换 Redis 或云队列,命令行收件箱换网页,图换成 `create_agent` 加 `HumanInTheLoopMiddleware`。结构不变。

## 动手练习

**练习 1:把人的每次处理记下来。** 在事件库里加一张 `review_log` 表(工单号、类别、处理类型、人看到的草稿、edit 时的终稿、response 时的意见、时间),在 review 节点里每次拿到人的答复后写一行。用 T1029 走 accept、T1034 先 respond 再 edit 验证。想一想:为什么写日志要放在 `interrupt()` 后面?

<details><summary>参考答案</summary>

`store.py` 的 `SCHEMA` 末尾加一张表,再加一个写入函数:

```python
CREATE TABLE IF NOT EXISTS review_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id   TEXT NOT NULL,
    category    TEXT NOT NULL,
    decision    TEXT NOT NULL,                     -- accept / edit / response / ignore
    draft       TEXT NOT NULL,                     -- 人看到的那版模型草稿
    final       TEXT,                              -- edit 时人改成的正文,其他情况为空
    note        TEXT,                              -- response 时人写的意见
    decided_at  TEXT NOT NULL
);
```

<div class="line-notes">

- `CREATE TABLE IF NOT EXISTS review_log (` 这次不用删库。Day 326 的坑是「已有的表不会补列」,而这是一张新表,`IF NOT EXISTS` 发现它不存在,就会建。下次任何脚本调 `store.init()` 时自动建好。
- `draft       TEXT NOT NULL,                     -- 人看到的那版模型草稿` 每一轮都记人当时看到的那版。response 之后会有新草稿,下一行日志记的就是新的。
- `final       TEXT,                              -- edit 时人改成的正文,其他情况为空` accept 时终稿就是草稿,不重复存。

</div>

```python
def log_review(ticket_id: str, category: str, decision: str, draft: str, final: str | None, note: str | None) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT INTO review_log (ticket_id, category, decision, draft, final, note, decided_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (ticket_id, category, decision, draft, final, note, now()),
        )
```

`agent.py` 的 review 节点在 `kind = answer["type"]` 后面加三行:

```python
    kind = answer["type"]
    final = answer["args"]["args"]["reply"] if kind == "edit" else None
    note = answer["args"] if kind == "response" else None
    store.log_review(state["ticket_id"], d["category"], kind, d["reply"], final, note)
```

<div class="line-notes">

- `final = answer["args"]["args"]["reply"] if kind == "edit" else None` 条件表达式,相当于 JS 的三元运算符。
- `store.log_review(state["ticket_id"], d["category"], kind, d["reply"], final, note)` 写在 `interrupt()` 后面。恢复时节点从头重跑,`interrupt()` 前面的代码每次恢复都会再跑一遍,后面的代码每次恢复只跑一次。放前面的话,第一次停下时(人还没处理)就会写一行,恢复时又写一行。

</div>

```bash
uv run python send_webhook.py T1029
uv run python send_webhook.py T1034
uv run python worker.py --once
uv run python inbox.py accept T1029
uv run python inbox.py respond T1034 "先道歉,再说已提交退款申请、原路退回,别写金额"
uv run python inbox.py edit T1034 "您好,给您添麻烦了。已核实 10 月的两笔扣款中有一笔是重复的,退款申请已提交,会原路退回。"
sqlite3 -header ambient.db "select ticket_id, category, decision, substr(draft,1,24) as draft, substr(final,1,20) as final, note from review_log"
```

```text
202 {'accepted': True, 'duplicate': False}
202 {'accepted': True, 'duplicate': False}
webhook:evt_T1029_created → waiting_human
webhook:evt_T1034_created → waiting_human
T1029 → sent
已按意见重写,新草稿: 您好,非常抱歉给您带来困扰。关于您反馈的重复扣款问题,我们已核实并为您提交退款申请,款项将按原支付路径退回,请您留意到账情况。如有其他疑问,欢迎随时联系我们。
T1034 → sent
ticket_id|category|decision|draft|final|note
T1029|invoice|accept|您好,感谢联系云簿 CloudLedger。关于||
T1034|refund|response|您好,感谢联系云簿 CloudLedger。关于||先道歉,再说已提交退款申请、原路退回,别写金额
T1034|refund|edit|您好,非常抱歉给您带来困扰。关于您反馈的重复扣款|您好,给您添麻烦了。已核实 10 月的两|
```

T1034 两行:第一行是对原稿的 response,第二行是对重写稿的 edit,草稿列已经是新的那版。这张表攒上几百行,就能回答「哪类工单最常被改、人都在改什么」,第六部分做评测时它就是现成的标注数据。`sqlite3 -header` 让输出带列名。

</details>

**练习 2:按类别收紧权限。** 退款类工单不许直接 accept,逼着人至少 edit 一次(至少看一眼金额和发票号)。改 review 节点的 config,用 T1035(申请退款)验证收件箱里看不到 accept,强行 accept 被拒。

<details><summary>参考答案</summary>

只改 config 那一行:

```python
        # 退款类不许直接 accept:逼着人至少改一个字,也就是至少把金额和发票号看一眼
        "config": {"allow_accept": d["category"] != "refund", "allow_edit": True, "allow_respond": True, "allow_ignore": True},
```

<div class="line-notes">

- `"config": {"allow_accept": d["category"] != "refund", "allow_edit": True, "allow_respond": True, "allow_ignore": True},` `d["category"] != "refund"` 算出一个布尔值。类别是模型分的,所以模型把退款工单分错类时,这道闸就失效了;更稳的做法是按工单里有没有发票号、有没有「退」字再加一道规则,别全信模型。

</div>

```bash
uv run python send_webhook.py T1035
uv run python worker.py --once
uv run python inbox.py list | grep -A1 T1035
uv run python inbox.py accept T1035
```

```text
202 {'accepted': True, 'duplicate': False}
webhook:evt_T1035_created → waiting_human
T1035              等待自 19:18  可用:edit/respond/ignore
    [refund] 客户公司下月起停用云簿,年付订阅尚余数月,询问能否退还未使用部分费用(发票号 INV-2026-0030)。
T1035 这条待办不允许 accept
```

注意这个改动只影响之后生成的条目。昨天就在等的 T1041、T1033、T1007 还是旧 config,允许 accept。想让它们也按新规则来,看练习 3。

</details>

**练习 3:用时间旅行刷新旧条目。** T1041 的条目是 Day 326 的代码生成的,只能 accept/ignore。写 `refresh_item.py`:找到 T1041 这条 thread 上「下一步是 review」的那张快照,从它重跑一遍,让 review 节点用今天的代码生成新条目。验证 load 和 draft 没重跑、草稿没变、config 变成新的了。(先做完练习 2 再做,新 config 里就能看到退款类不许 accept。)

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ambient/refresh_item.py
"""练习 3:旧版代码生成的收件箱条目,用 Day 322 的时间旅行按新代码重新生成。不重跑 load/draft,不调模型。
用法:uv run python refresh_item.py T1041"""
import sys

from agent import open_graph, thread_of

graph, conn = open_graph()
try:
    config = thread_of(sys.argv[1])
    old = graph.get_state(config).interrupts[0].value
    target = next(s for s in graph.get_state_history(config) if s.next == ("review",))
    result = graph.invoke(None, target.config)
    new = result["__interrupt__"][0].value
    print("旧条目 config:", old["config"])
    print("新条目 config:", new["config"])
    print("草稿没变?", old["action_request"] == new["action_request"])
finally:
    conn.close()
```

<div class="line-notes">

- `old = graph.get_state(config).interrupts[0].value` 先把旧条目存下来,后面对比。
- `target = next(s for s in graph.get_state_history(config) if s.next == ("review",))` 从新到旧找第一张「下一步是 review」的快照,也就是 draft 刚做完那一刻。和 Day 322 `refund_tt.py` 找「下一步是 approval」是同一个写法。
- `result = graph.invoke(None, target.config)` 从这张快照往下跑:第一个执行的就是 review,用的是**现在**的代码,于是生成新条目,然后又停下。load 和 draft 不重跑,不调模型。
- `print("草稿没变?", old["action_request"] == new["action_request"])` 字典比较内容,两份 `action_request` 一模一样说明草稿是原来那份。

</div>

```bash
uv run python refresh_item.py T1041
uv run python inbox.py list | grep -A1 "^T1041"
uv run python history.py T1041
```

```text
旧条目 config: {'allow_accept': True, 'allow_edit': False, 'allow_respond': False, 'allow_ignore': True}
新条目 config: {'allow_accept': False, 'allow_edit': True, 'allow_respond': True, 'allow_ignore': True}
草稿没变? True
T1041              等待自 18:55  可用:edit/respond/ignore
    [refund] 客户反映10月8日被重复扣款,INV-2026-0026与INV-2026-0123金额相同,要求退还多扣的一笔。
-1 10:55:27 下一步 ('__start__',)
0 10:55:27 下一步 ('load',)
1 10:55:27 下一步 ('draft',)
2 10:55:28 下一步 ('review',)
3 11:19:09 下一步 ('review',)
```

快照历史里多了一张 step 3,下一步还是 review,前面的 load、draft 都只有原来那一次。收件箱里 T1041 现在是退款类的新规则。事件表这边不用动,它一直是 `waiting_human`。

真实系统里升级代码时,这种「批量刷新待办」要不要做,是一个产品决定:刷新了,人看到的规则统一;不刷新,条目和生成它时的规则一致,审计更清楚。我倾向于默认不刷新,只在权限收紧(比如今天这种)时刷新。

</details>

**练习 4(开放题):给邮件写处理器。** 两封邮件因为「没有处理 email.received 的图」进了死信。写 `email_handler.py`:按发件人邮箱在业务库里找客户,找不到就 `PermanentError`;找到了就在业务库里建一张工单(工单号由 Message-ID 算出来,同一封邮件永远是同一个号),再交给工单图。用一封 `User013@example.com` 发来的邮件测(投两次),并把那两封旧邮件放回队列看看会怎样。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/ambient/email_handler.py
"""练习 4:邮件事件 → 业务库里的一张工单 → 走同一张工单图。陌生发件人直接死信。"""
import hashlib
import json

import store
from agent import PermanentError


def ticket_id_of(payload: str) -> str:
    """同一封邮件永远算出同一个工单号。worker 和收件箱都用它,规则只写在这一处。"""
    return "M" + hashlib.sha1(json.loads(payload)["message_id"].encode()).hexdigest()[:6]


def email_to_ticket(payload: str) -> str:
    mail = json.loads(payload)
    with store.connect(store.BIZ_DB) as biz:
        c = biz.execute("SELECT id FROM customers WHERE email = ?", (mail["from"].lower(),)).fetchone()
        if c is None:
            raise PermanentError(f"陌生发件人 {mail['from']},不建工单")
        ticket_id = ticket_id_of(payload)
        biz.execute(
            "INSERT OR IGNORE INTO tickets (id, customer_id, subject, body, status, created_at) "
            "VALUES (?, ?, ?, ?, 'open', ?)",
            (ticket_id, c["id"], mail["subject"], mail["body"], store.now()[:10]),
        )
    return ticket_id
```

<div class="line-notes">

- `return "M" + hashlib.sha1(json.loads(payload)["message_id"].encode()).hexdigest()[:6]` 工单号由 Message-ID 算出来,是**确定的**:同一封邮件处理几次都是同一个号。前缀 `M` 和 webhook 来的 `T` 工单区分开。SHA-1 在这里只当「指纹」用,不涉及安全,够用。
- `c = biz.execute("SELECT id FROM customers WHERE email = ?", (mail["from"].lower(),)).fetchone()` 业务库里存的邮箱是小写,发件人写成 `User013@...` 也要能查到,所以先 `.lower()`。
- `raise PermanentError(f"陌生发件人 {mail['from']},不建工单")` 最粗的一道过滤。真实客服邮箱里还有自动回复、退信、营销邮件,要按发件人和标题再筛。
- `"INSERT OR IGNORE INTO tickets (id, customer_id, subject, body, status, created_at) "` 模拟「工单系统收到邮件后建单」。`OR IGNORE` 让重跑不会建出第二张。真实环境里通常是工单系统自己做这一步,再用 webhook 通知你,那就回到第一种触发源了。
- `(ticket_id, c["id"], mail["subject"], mail["body"], store.now()[:10]),` 创建日期取 `now()` 的前 10 个字符 `2026-10-22`,和业务库里其他工单的日期格式一致。

</div>

`worker.py` 的 `dispatch` 里加一个分支,先建工单,再造一份「看起来像 webhook」的 payload 交给原来的 `handle`:

```python
from email_handler import email_to_ticket
```

```python
    if ev["kind"] == "email.received":
        ticket_id = email_to_ticket(ev["payload"])
        return handle(graphs["ticket"], {**ev, "payload": json.dumps({"data": {"ticket_id": ticket_id}})})
```

测试数据脚本:

```python
# agent-zero-lab/part05/ambient/ex_email.py
"""练习 4 的测试数据:一封已知客户(C013)的邮件,同一封投两次;再把 Day 325 那两封陌生邮件放回队列。"""
import json

import store

mail = {"message_id": "<D327a1@mail.example.com>", "from": "User013@example.com",
        "subject": "发票抬头写错了", "body": "上个月的发票抬头写成了旧公司名,麻烦改成「北京云杉科技有限公司」。"}
for _ in range(2):
    print("新事件?", store.add_event(f"email:{mail['message_id']}", "email", "email.received", json.dumps(mail, ensure_ascii=False)))
with store.connect() as conn:
    cur = conn.execute("UPDATE events SET status = 'pending', attempts = 0, last_error = NULL WHERE source = 'email' AND status = 'dead'")
    print("放回队列的旧邮件:", cur.rowcount)
```

<div class="line-notes">

- `"from": "User013@example.com",` 故意写成大写开头,测 `.lower()`。
- `for _ in range(2):` 同一封邮件投两次,第二次被事件表挡住。
- `cur = conn.execute("UPDATE events SET status = 'pending', attempts = 0, last_error = NULL WHERE source = 'email' AND status = 'dead'")` 批量「重放死信」:有了处理器,把之前因为没有处理器死掉的邮件放回去重试。

</div>

```bash
uv run python ex_email.py
uv run python worker.py --once
uv run python inbox.py list
```

第一次跑时 worker 成功了,`inbox.py list` 却崩了:

```text
新事件? True
新事件? False
放回队列的旧邮件: 2
email:<CAF7x2@mail.example.com> 永久失败 → dead: 陌生发件人 c012@example.com,不建工单
email:<CAF9k1@mail.example.com> 永久失败 → dead: 陌生发件人 c019@example.com,不建工单
email:<D327a1@mail.example.com> → waiting_human
Traceback (most recent call last):
  ...
  File ".../part05/ambient/inbox.py", line 36, in waiting
    ticket_id = p["data"]["ticket_id"]
                ~^^^^^^^^
KeyError: 'data'
```

邮件事件的 payload 里没有 `data.ticket_id`,worker 是现算的,收件箱不知道。「从事件算出工单号」这条规则被写在了两处,只改了一处。修法是两边都用 `ticket_id_of`,所以上面 `email_handler.py` 里才单独有这个函数。`inbox.py` 改两处:

```python
from email_handler import ticket_id_of
```

```python
        else:
            ticket_id = ticket_id_of(r["payload"]) if r["kind"] == "email.received" else p["data"]["ticket_id"]
```

```bash
uv run python inbox.py list | grep -A2 "^M"
```

```text
M301fbc            等待自 19:19  可用:accept/edit/respond/ignore
    [invoice] 客户上个月发票抬头误写为旧公司名,需改为「北京云杉科技有限公司」。
    草稿:您好,感谢联系云簿 CloudLedger。关于上个月发票抬头需由旧公司名更改为「北京云杉科技有限公司」的需求,我们已记录并转交财务核实处理。为加快进度,烦请提供发票号码或订单号,以及可证明新抬头名称的营业执照信息。处理结果会第一时间同步给您,感谢配合。
```

已知客户的邮件变成了工单 M301fbc,进了收件箱;两封陌生邮件第二次进死信,原因从「没有处理器」变成了「陌生发件人」,日报里一看就知道该怎么处理。更干净的设计是让 worker 在处理时把算出来的工单号写回事件表的一列(比如 `ticket_id`),收件箱直接读这一列,规则就只剩一处了。真实的邮件还要解析 MIME、解码中文标题、处理 HTML 正文,标准库 [email.parser](https://docs.python.org/zh-cn/3/library/email.parser.html) 能做这些,这里没展开。

</details>

**验收标准**:review 节点支持四种处理,`after_review` 能回到 draft;`inbox.py list` 能列出工单类和通知类两种待办,并按各自的 config 显示可用操作;对 T1025 走一遍 respond 再 edit,`history.py` 能看到两次停在 review;对通知 accept 被拒、ignore 成功;`report.py` 能打出状态统计、最长等待和死信原因;能说出 Agent Inbox 四种处理和 `HumanInTheLoopMiddleware` 四种决定的对应关系。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 收件箱(Agent Inbox) | 后台 Agent 找人的集中入口:一个待办列表,每条说清 Agent 想做什么、人能怎么处理。LangChain 开源过同名界面,仓库 2026 年 9 月已归档 |
| HumanInterrupt | 一条待办的数据结构:`action_request`(动作和参数)、`config`(允许哪几种处理)、`description`(一句说明) |
| HumanResponse | 人的答复:`type` 是 accept/edit/response/ignore 之一,`args` 跟着 type 变 |
| accept / edit / response / ignore | 照做 / 人改了参数再做 / 人回一句意见让 Agent 重来 / 不做了 |
| HumanInTheLoopMiddleware | LangChain 1.x 给 `create_agent` 用的人工审批中间件,四种决定叫 approve/edit/reject/respond |
| 通知类待办 | 只需要人知道、不需要人决定的待办,只允许 ignore(「知道了」) |
| 安静地坏掉 | 后台系统出了问题却没有任何人立刻发现,因为没人在对面等结果。靠日报和告警兜底 |
| 收件箱最长等待时间 | 等人处理得最久的那条待办等了多久。比待办条数更能说明流程是否断了 |
| 日报 | 定时生成的运行摘要:队列深度、最长等待、死信、处理分布 |

## 常见误区

**以为改了代码,收件箱里所有待办都按新规则来。** 实测昨天生成的五条都只有 `accept/ignore`。条目的 config 存在 checkpoint 里,代码改不到它们。要刷新就用时间旅行重跑 review(练习 3)。

**收件箱按「当前代码的默认值」判断权限。** 应该按条目自己的 config。T1041 的 edit 被拒是对的。另外,收件箱的检查相当于前端校验,图里的 review 节点也该再查一遍。

**把写日志、发通知这种副作用放在 `interrupt()` 前面。** 恢复时节点从头重跑,前面的代码每恢复一次就多跑一次。练习 1 的 `log_review` 放在 interrupt 后面。

**response 时原地 `.append()` 意见列表。** 要用 `state.get("feedback", []) + [新意见]` 返回新列表。顺便注意 `.get`:老 thread 的 State 里没有 `feedback` 这个键,直接 `state["feedback"]` 会 `KeyError`。

**没有处理器的事件悄悄标 done。** 今天两封邮件以 `PermanentError: 没有处理 email.received 的图` 进了死信,日报里看得见。标 done 等于把客户的邮件扔了。

**同一条规则写在两处。** 练习 4 实测,worker 会从邮件算工单号,收件箱不会,`inbox.py list` 报 `KeyError: 'data'`。从事件算业务键的逻辑只写一个函数,两边共用。

**收件箱只看条数。** 十条刚进来的不要紧,一条等了三天才是问题。日报里放最长等待时间。

**crontab 里直接写 `uv`。** crontab 的 PATH 和终端不一样,很可能找不到 `uv`,而且出错了你什么都看不到。写绝对路径,输出追加到日志文件。

## 学习资料

### 文档与文章

- [langchain-ai/agent-inbox](https://github.com/langchain-ai/agent-inbox):README 里 `HumanInterrupt` 和 `HumanResponse` 的定义是今天收件箱格式的来源。仓库已归档,只看数据结构那一节,10 分钟。
- [LangChain · Human-in-the-loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop):`HumanInTheLoopMiddleware` 的官方文档,四种决定和 `allowed_decisions` 的写法。用 `create_agent` 时审批走这一套,20 分钟。
- [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):interrupt 的完整语义,重点看「恢复时节点重新执行」和「interrupt 前面不要放副作用」,20 分钟。
- [LangGraph · Time travel](https://docs.langchain.com/oss/python/langgraph/use-time-travel):练习 3 用到的从旧快照重跑,复习 Day 322,10 分钟。
- [LangSmith · Cron jobs](https://docs.langchain.com/langsmith/cron-jobs):托管部署上的定时任务,注意 UTC,10 分钟。
- [crontab.guru](https://crontab.guru/):在线解释 cron 表达式,配日报时核对一下。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fykHY6EAF&autoplay=0&high_quality=1" title="LangGraph Interrupt：Human-In-The-Loop 人机交互手到擒来！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来! · 22 分钟,把 interrupt、Command(resume) 和 checkpoint 的配合讲得很细,对照今天 review 节点的四个分支看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17UKd6zEgH&autoplay=0&high_quality=1" title="Agent实践——2.9.2 langgraph框架checkpoint，人机协作，时间旅行等问题探究" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>不如语冰 · Agent实践——2.9.2 langgraph框架checkpoint,人机协作,时间旅行等问题探究 · 23 分钟,2026 年的视频,checkpoint、人机协作、时间旅行放在一起讲,正好对应练习 3。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/gF341XMN8cY" title="Open Source Agent Inbox for LangGraph" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Open Source Agent Inbox for LangGraph · 官方演示 Agent Inbox 怎么接 LangGraph,看它的界面怎么呈现 accept、edit、respond、ignore 四个按钮。做网页版收件箱时可以照着设计。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/egSh4TxS5go" title="Ambient Agents and the New Agent Inbox ft. Harrison Chase" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sequoia Capital · Ambient Agents and the New Agent Inbox ft. Harrison Chase · Day 325 推荐过前半段,今天看后半段讲收件箱的部分:为什么聊天界面不适合后台 Agent、收件箱这种交互是怎么想出来的。</figcaption>
</figure>

- LangChain Academy《Project: Ambient Agents with LangGraph》([课程页](https://academy.langchain.com/courses/ambient-agents)):免费,做一个邮件助手式的后台 Agent,包含人工审核、记忆和部署。三天学完想看完整版就学它。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章「Agents」:讲 Agent 的失败模式,补充「为什么有后果的动作要让人先审」的理由。
- Gregor Hohpe、Bobby Woolf《Enterprise Integration Patterns》(Addison-Wesley,2003):「Content-Based Router」就是今天 worker 的 `dispatch`,按消息内容决定交给谁。翻目录看这一节,英文原版。

### 开源项目与代码

- [langchain-ai/agent-inbox](https://github.com/langchain-ai/agent-inbox):收件箱前端的参考实现(Next.js,已归档,只读)。前端同学可以直接读它的组件,看四个按钮怎么映射成 `HumanResponse`。
- [langchain-ai/agents-from-scratch](https://github.com/langchain-ai/agents-from-scratch):官方邮件助手的完整代码,看它的人工审核节点怎么处理四种答复,和今天的 review 对照。

## 自测

1. accept、edit、response、ignore 四种处理里,哪一种会再调一次模型?哪一种会让图回到 review 再停一次?

<details><summary>答案</summary>

只有 response:带着人的意见回到 draft 重写(调一次模型),然后再进 review 停下来等人。accept 和 edit 去 send,ignore 去 END,都不调模型。

</details>

2. 今天代码里 review 的 config 四种全开,为什么昨天的 T1041 在收件箱里只能 accept 和 ignore?该不该放行它的 edit?

<details><summary>答案</summary>

T1041 的收件箱条目是昨天的代码生成的,`HumanInterrupt`(连同 config)存在 checkpoint 里,今天改代码改不到它。收件箱按条目自己的 config 判断,所以拒绝 edit。不该绕过去直接放行;要按新规则处理,就用时间旅行从「下一步是 review」的快照重跑,让 review 用新代码重新生成条目(练习 3),不调模型。

</details>

3. 收件箱的「目录」为什么从事件表读,而不是遍历 checkpoint 库?

<details><summary>答案</summary>

checkpoint 库擅长回答「某个 thread 停在哪」,不擅长回答「现在有哪些 thread 在等人」,要遍历所有 thread 再逐个 `get_state`。事件表里 `status = 'waiting_human'` 一条 SQL 就能列出来,还能按等待时间排序、按来源统计。真实系统里常会单独建一张 inbox 表,带上指派给谁、优先级、截止时间。

</details>

4. 日报里为什么「收件箱最长等待时间」比「收件箱条数」更值得告警?

<details><summary>答案</summary>

条数多不一定有问题,可能只是刚进来一批;一条待办等了三天,说明有人没在看收件箱,或者它被漏掉了,流程已经断了。后台 Agent 的风险是安静地坏掉,最长等待时间能直接暴露这种情况。

</details>

5. **面试题**:「你们的后台 Agent 起草客服回复后要人审。你会怎么设计这个审核环节,让它既安全又能越用越好?」

<details><summary>答案</summary>

参考要点:数据结构上,每条待办包含 Agent 想做的动作和参数、允许的处理方式、一句说明(Agent Inbox 的 HumanInterrupt,或 LangChain `HumanInTheLoopMiddleware` 的 action_requests + allowed_decisions);处理方式分照做、人改了再做、给意见让 Agent 重写、不做四种。安全上:有后果的类别(退款)不允许直接照做,强制人改;权限按条目生成时的规则判断,服务端也要校验,不只靠前端;恢复用 checkpoint,thread 按业务主键组织,发送动作幂等。可运营上:每次人工处理记一行(类别、决定、原稿、终稿、意见),统计各类工单的照做率和修改率,照做率高的类别考虑自动发,修改率突然升高说明模型或业务变了;日报盯队列深度、最长等待、死信。加分:说出代码升级后老待办的处理策略(默认保留生成时的规则,权限收紧时用时间旅行刷新)。

</details>

6. 通知类待办(定时任务扫出的超期工单)为什么只允许 ignore?它的 thread_id 为什么按日期而不是按事件 id?

<details><summary>答案</summary>

通知只需要人知道,不需要人决定,没有「照做」或「修改」的对象,所以只给一个「知道了」(ignore)。thread_id 按日期(`digest-2026-10-22`),和定时任务的去重键 `cron:stale_tickets:日期` 同一个粒度:同一天补跑多少次都落在同一个 thread 上,`handle_digest` 看到这一天的通知已在收件箱或已看过就直接 done,不会出现两条一样的通知。

</details>

## 明天预告

明天是 [Day 328 · 第 47 周复习:MCP 与编排(Day 322–327)](/blog/agent-zero/day-328-week47-review/)。这一周从 LangGraph 的时间旅行、三种 stream_mode、子图,一路走到后台 Agent 的事件表、worker 和收件箱,今天练习 3 还把时间旅行用在了收件箱上。明天把这六天串成一张图,默写 worker 的 `claim` 和 `handle`,再做一个只用本周知识的小项目,把这周踩过的坑过一遍。
