---
title: 'Day 320 · LangGraph(十九):实现退款审批'
description: '把这一周学的 checkpointer、thread_id、SqliteSaver、interrupt 和 Command(resume) 装进一张真图:读工单、让模型起草退款方案、停下来等主管、批了才写业务库。先四个零件各跑一遍,再拼成一个能在不同进程之间接着跑的命令行工具。'
pubDate: 2026-10-22
regime: none
tags: ['langgraph', 'human-in-the-loop', 'interrupt', 'agent-zero']
series: 'agent-zero'
day: 320
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 319](/blog/agent-zero/day-319-lg-interrupt/) 学了 `interrupt()` 和 `Command(resume=...)`:节点跑到 `interrupt()` 那一行,图就停下来,把一个值交给调用方;调用方带着人的答复再调一次图,答复变成 `interrupt()` 的返回值。那一课最重要的发现是,恢复时被中断的节点会**从第一行重新执行**,所以 interrupt 前面不能放发通知、写库这种有副作用的代码。

再往前,[Day 316](/blog/agent-zero/day-316-lg-checkpointer/) 的 thread_id 让同一张工单的处理过程落在同一条线上,[Day 317](/blog/agent-zero/day-317-lg-state-history/) 的 `get_state` 告诉你图停在哪(`next`),[Day 318](/blog/agent-zero/day-318-lg-sqlite-saver/) 的 SqliteSaver 让状态写进磁盘,进程退出也不丢。这些零件都是在玩具图上单独摸过的,节点全是纯函数,没调模型、没碰业务库。今天把它们装进一个真场景:CloudLedger(云簿)的退款审批。

## 今天要解决的问题

场景是这样的:客户 C007 提了工单 T1041,说 10 月 8 号被扣了两次款。Agent 读工单、查这个客户最近的发票、起草一个退款方案,然后**停下来**,等客服主管点批准或驳回。主管可能五分钟后批,也可能第二天早上才批,中间服务可能重启过。批了才真正往业务库写退款记录,驳回就转人工。

学完今天,你要能做到:

1. 说出退款审批图的五个节点各干什么,哪一个调模型、哪一个是人、哪一个写库。
2. 给 `interrupt()` 加上 `response_schema`,让主管的答复按 pydantic 模型校验,并看懂校验失败的报错。
3. 跑通 `start → status → approve` 三个命令,三个命令是三个独立进程,第三个能接上第一个停下的地方。
4. 说清楚三个设计取舍:State 里为什么只放字典、时间为什么在 Python 里生成、对已经跑完的 thread 再 approve 会怎样。

预计用时 2.5–3 小时。前置:[Day 280](/blog/agent-zero/day-280-mcp-seed/) 造的 `cloudledger.db`,[Day 311](/blog/agent-zero/day-311-lg-agent-loop/) 的 `llm.py`(`get_llm()`),[Day 312](/blog/agent-zero/day-312-lg-workflow/) 的 `with_structured_output`,[Day 306](/blog/agent-zero/day-306-lg-conditional/) 的条件边,以及本周 Day 316–319。今天真调模型的地方只有一个节点,全天实跑花费约 1 分钱,算式在第 2 步。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章把 `human_approval` 节点和 `main()` 里的 approve 分支默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 先看图:五个节点,只有一个调模型

<figure>
<svg viewBox="0 0 640 190" role="img" aria-label="退款审批图:START 到 load、draft、approval,approval 之后按条件边去 execute 或 reject,两者都到 END">
  <rect x="0" y="0" width="640" height="190" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12" text-anchor="middle">
    <rect x="15" y="68" width="60" height="26" rx="13" fill="none" stroke="var(--ink-soft)"/><text x="45" y="85" fill="var(--ink-soft)">START</text>
    <rect x="100" y="64" width="70" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="135" y="85" fill="var(--ink)">load</text>
    <rect x="195" y="64" width="70" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="230" y="85" fill="var(--ink)">draft</text>
    <rect x="290" y="64" width="90" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/><text x="335" y="85" fill="var(--ink)">approval</text>
    <rect x="430" y="22" width="80" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="470" y="43" fill="var(--ink)">execute</text>
    <rect x="430" y="108" width="80" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink-soft)"/><text x="470" y="129" fill="var(--ink)">reject</text>
    <rect x="560" y="68" width="60" height="26" rx="13" fill="none" stroke="var(--ink-soft)"/><text x="590" y="85" fill="var(--ink-soft)">END</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="75" y1="81" x2="100" y2="81"/><line x1="170" y1="81" x2="195" y2="81"/><line x1="265" y1="81" x2="290" y2="81"/>
    <line x1="510" y1="39" x2="560" y2="76"/><line x1="510" y1="125" x2="560" y2="86"/>
  </g>
  <g stroke="var(--ink-soft)" stroke-dasharray="4 3" fill="none">
    <line x1="380" y1="75" x2="430" y2="42"/><line x1="380" y1="87" x2="430" y2="122"/>
  </g>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">
    <text x="392" y="50">批准</text><text x="392" y="122">驳回</text>
    <text x="335" y="118" text-anchor="middle">interrupt 等人</text>
    <text x="135" y="118" text-anchor="middle">读业务库</text>
    <text x="230" y="118" text-anchor="middle">调模型</text>
    <text x="470" y="72" text-anchor="middle">写业务库</text>
  </g>
  <text x="20" y="170" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">蓝 = 模型侧,琥珀 = 业务库(外部系统),approval 是人</text>
</svg>
<figcaption>退款审批图。实线是普通边,虚线是条件边。draft 是整张图里唯一调模型的节点,最关键的那个决定(退不退钱)交给了 approval 节点背后的人。</figcaption>
</figure>

每个节点一句话:

- `load`:按工单号读工单正文,再读这个客户最近 5 张发票,压成几行文字。不调模型。
- `draft`:把工单和发票交给模型,让它按 pydantic 模型 `Proposal` 起草退款方案(退哪张发票、退多少、依据是什么)。
- `approval`:调用 `interrupt()` 暂停,把方案交给主管;恢复时拿到主管的决定。
- `execute`:主管批了才走到这里,往 `refund_requests` 表插一行。
- `reject`:驳回分支,不碰业务库,只写一句结论。

接下来不直接甩出完整文件。完整的 `refund_approval.py` 有 150 行,第一次看很容易分不清哪一行在管哪件事。我们先把 load、draft、approval、execute/reject 四块各写成一个能单独跑的小脚本,最后再拼起来。

## 准备:业务库和模型对象

今天所有文件都放 `agent-zero-lab/part05/lgdemo/`。这个目录是 Day 311 建的,里面有 `llm.py`。先确认两个依赖在,没有就装上(`langgraph-checkpoint-sqlite` 是 Day 318 装的):

```bash
cd agent-zero-lab
uv add langgraph langgraph-checkpoint-sqlite langchain-openai python-dotenv pydantic
uv run python cloudledger/seed.py
```

`seed.py` 是 Day 280 写的造数脚本,每次删库重建,随机种子固定,所以你造出来的数据和我的一模一样。实跑输出:

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
```

今天的 `refund_requests` 表也是那天建好的,一直空着,专门等今天往里写。它的列是 `id, invoice_id, amount_cents, reason, status, created_at, decided_at, decided_by`,金额用「分」存(Day 280 讲过为什么不用浮点存钱)。

`llm.py` 再贴一遍,方便对照。今天只用到 `get_llm()`:

```python
# agent-zero-lab/part05/lgdemo/llm.py
"""LangGraph 这几天共用的模型对象。走 OpenAI 兼容协议,换厂商只改 .env。"""
import json
import os

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from pydantic import SecretStr

load_dotenv()


def get_llm(temperature: float = 0) -> ChatOpenAI:
    return ChatOpenAI(
        model=os.environ["LLM_MODEL"],
        base_url=os.environ["LLM_BASE_URL"],
        api_key=SecretStr(os.environ["LLM_API_KEY"]),
        temperature=temperature,
        extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
    )
```

<div class="line-notes">

- `load_dotenv()` 从脚本所在目录往上找 `.env`。在 `part05/lgdemo` 下运行,它会一路找到 `agent-zero-lab/.env`。
- `model=os.environ["LLM_MODEL"],` 我的 `.env` 里是 `deepseek-flash`。
- `api_key=SecretStr(os.environ["LLM_API_KEY"]),` 包一层 `SecretStr`,打印对象时 key 会显示成 `**********`。不包也能跑,只是 Zed 里的 basedpyright 会在这行标红,因为 `ChatOpenAI` 的参数类型写的是 `SecretStr`。
- `extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),` 我这里解析出来是 `{'thinking': {'type': 'disabled'}}`。Day 312 踩过的坑:DeepSeek 开着思考模式时,`with_structured_output` 会报 `400 Thinking mode does not support this tool_choice`,今天 draft 节点正好要用它,这一行不能少。

</div>

## 第 1 步:load 节点,先不用 LangGraph

节点就是一个普通函数:收一个 state 字典,返回一个「要更新哪些字段」的字典。所以完全可以不建图,直接调函数看它返回什么。这是调试节点最快的办法,相当于前端里先单独测一个纯函数,再把它塞进组件。

```python
# agent-zero-lab/part05/lgdemo/refund_s1_load.py
import sqlite3
from pathlib import Path

BIZ_DB = Path(__file__).parents[2] / "cloudledger" / "cloudledger.db"


def biz() -> sqlite3.Connection:
    conn = sqlite3.connect(BIZ_DB)
    conn.row_factory = sqlite3.Row
    return conn


def load_ticket(state: dict) -> dict:
    with biz() as conn:
        t = conn.execute("SELECT * FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()
        invs = conn.execute(
            "SELECT id, amount_cents, status, issued_at FROM invoices WHERE customer_id = ? "
            "ORDER BY issued_at DESC, id DESC LIMIT 5",
            (t["customer_id"],),
        ).fetchall()
    lines = [f"{r['id']} {r['amount_cents'] / 100:.2f}元 {r['status']} {r['issued_at']}" for r in invs]
    return {"ticket_text": t["body"], "invoices": "\n".join(lines)}


if __name__ == "__main__":
    print(BIZ_DB.relative_to(Path(__file__).parents[2]))
    out = load_ticket({"ticket_id": "T1041"})
    print("工单:", out["ticket_text"])
    print("发票:")
    print(out["invoices"])
```

<div class="line-notes">

- `BIZ_DB = Path(__file__).parents[2] / "cloudledger" / "cloudledger.db"` `Path(__file__)` 是这个脚本的完整路径。`parents[0]` 是 `lgdemo`,`parents[1]` 是 `part05`,`parents[2]` 是 `agent-zero-lab`,再拼上 `cloudledger/cloudledger.db`。用脚本自己的位置算路径,不管你在哪个目录运行都找得到库。
- `conn.row_factory = sqlite3.Row` Day 93 学过:这样查出来的每一行可以按列名取值(`t["body"]`),像 JS 里访问对象属性;不设的话只能按下标 `t[3]`。
- `with biz() as conn:` sqlite3 的连接当上下文管理器用,块结束时自动提交(出错就回滚)。注意它**不会**自动关闭连接,这里是短脚本,进程退出时一起释放。
- `t = conn.execute("SELECT * FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()` `?` 是占位符,Day 92 讲过为什么不能用 f-string 拼 SQL。`(state["ticket_id"],)` 结尾的逗号让它成为只有一个元素的元组。实跑时 `t["body"]` 是 `你好,10 月 8 号我被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一模一样,麻烦把多扣的那笔退给我。`
- `"ORDER BY issued_at DESC, id DESC LIMIT 5",` 先按开票日期从新到旧,同一天的按发票号倒序。两张 10 月 8 号的发票里 0123 号更大,所以排在 0026 前面。
- `(t["customer_id"],),` T1041 的客户是 `C007`。
- `lines = [f"{r['id']} {r['amount_cents'] / 100:.2f}元 {r['status']} {r['issued_at']}" for r in invs]` 列表推导式,相当于 JS 的 `invs.map(r => ...)`。`239200 / 100` 得 `2392.0`,`:.2f` 格式化成 `2392.00`。
- `return {"ticket_text": t["body"], "invoices": "\n".join(lines)}` 返回两个字段。放进图里以后,LangGraph 会把它们合并进 State。
- `print(BIZ_DB.relative_to(Path(__file__).parents[2]))` 只是为了让你确认路径算对了,打印 `cloudledger/cloudledger.db`。

</div>

```bash
cd agent-zero-lab/part05/lgdemo
uv run python refund_s1_load.py
```

```text
cloudledger/cloudledger.db
工单: 你好,10 月 8 号我被扣了两次款,INV-2026-0026 和 INV-2026-0123 金额一模一样,麻烦把多扣的那笔退给我。
发票:
INV-2026-0123 2392.00元 paid 2026-10-08
INV-2026-0026 2392.00元 paid 2026-10-08
INV-2026-0027 2392.00元 paid 2026-09-07
INV-2026-0028 2392.00元 paid 2026-08-08
INV-2026-0029 2392.00元 paid 2026-07-09
```

前两行就是 seed 故意造的重复扣款:同一天、同金额、两张发票。

再故意传一个不存在的工单号,看看会怎样:

```bash
uv run python -c "
from refund_s1_load import load_ticket
load_ticket({'ticket_id':'T9999'})"
```

```text
    (t["customer_id"],),
     ~^^^^^^^^^^^^^^^
TypeError: 'NoneType' object is not subscriptable
```

`fetchone()` 查不到就返回 `None`,`None["customer_id"]` 就是这个报错,相当于 JS 里的 `Cannot read properties of null`。报错指向的是下一行,真正的原因在上一行,第一次看很容易找错地方。拼完整文件时我们会在查完工单后立刻判空,抛一个看得懂的 `ValueError`。

## 第 2 步:draft 节点,让模型起草方案

draft 用的是 Day 312 学过的 `with_structured_output`:给它一个 pydantic 模型,它会让模型按这个结构输出,再解析回 pydantic 对象。今天多加一个 `include_raw=True`,顺便把 token 用量打出来算钱。

```python
# agent-zero-lab/part05/lgdemo/refund_s2_draft.py
from pydantic import BaseModel, Field

from llm import get_llm
from refund_s1_load import load_ticket


class Proposal(BaseModel):
    invoice_id: str = Field(description="要退款的发票号,必须是工单里或发票列表里出现过的")
    amount_yuan: float = Field(gt=0, description="退款金额(元)")
    reason: str = Field(description="退款依据,一句话")


def draft_proposal(state: dict) -> dict:
    llm = get_llm().with_structured_output(Proposal, method="function_calling", include_raw=True)
    out = llm.invoke(
        "你是云簿的账务专员。根据工单和发票记录起草退款方案。"
        "重复扣款只退重复的那一笔(通常是开票日期相同、较晚生成的那张)。\n\n"
        f"工单:{state['ticket_text']}\n\n最近发票:\n{state['invoices']}"
    )
    print("token 用量:", out["raw"].usage_metadata)
    proposal = out["parsed"]
    print("类型:", type(proposal).__name__)
    return {"proposal": proposal.model_dump()}


if __name__ == "__main__":
    state = {"ticket_id": "T1041"}
    state |= load_ticket(state)
    state |= draft_proposal(state)
    print(state["proposal"])
```

<div class="line-notes">

- `from refund_s1_load import load_ticket` 直接复用第 1 步的函数。这是裸导入,要在 `lgdemo` 目录下运行才找得到。
- `invoice_id: str = Field(description="要退款的发票号,必须是工单里或发票列表里出现过的")` description 会进 JSON Schema 发给模型,写约束能降低它编发票号的概率。Day 52 讲过 `Field`。
- `amount_yuan: float = Field(gt=0, description="退款金额(元)")` `gt=0` 在 schema 里变成 `"exclusiveMinimum": 0`,模型和 pydantic 两边都看得到。这个约束后面会带来一个意外,见「常见误区」。
- `llm = get_llm().with_structured_output(Proposal, method="function_calling", include_raw=True)` `include_raw=True` 让返回值变成一个字典,`raw` 是模型原始回复(带用量),`parsed` 是解析好的对象。拼完整文件时去掉它。
- `"重复扣款只退重复的那一笔(通常是开票日期相同、较晚生成的那张)。\n\n"` 业务规则写进提示词。退哪张其实两张都说得通,写死「较晚生成的那张」是为了让结果可复现。
- `print("token 用量:", out["raw"].usage_metadata)` 实跑:输入 543 个 token,其中 384 个命中缓存,输出 114 个。
- `print("类型:", type(proposal).__name__)` 打印 `Proposal`,说明拿到的是 pydantic 对象,不是字典。
- `return {"proposal": proposal.model_dump()}` `model_dump()` 把对象转成普通字典再返回。为什么不直接存对象,拼完整文件后专门演示。
- `state |= load_ticket(state)` `|=` 是 Python 3.9 起的字典合并,相当于 JS 的 `Object.assign(state, ...)`。这里手动模拟了 LangGraph 合并节点返回值的过程。

</div>

```text
token 用量: {'input_tokens': 543, 'output_tokens': 114, 'total_tokens': 657, 'input_token_details': {'cache_read': 384}, 'output_token_details': {}}
类型: Proposal
{'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '与 INV-2026-0026 为同日同额重复扣款，INV-2026-0123 为较晚生成的一张，退还该笔重复扣款'}
```

模型挑对了 `INV-2026-0123`。算一下这一次调用多少钱。2026 年 10 月查到的 [DeepSeek 定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing),`deepseek-flash` 高峰时段(北京时间工作日 9–12 点、14–18 点)每百万 token:缓存命中输入 0.04 元、未命中输入 2 元、输出 8 元,空闲时段减半。我是工作日中午前跑的,按高峰价:

- 未命中输入:(543 − 384) × 2 / 1,000,000 = 0.000318 元
- 命中输入:384 × 0.04 / 1,000,000 ≈ 0.000015 元
- 输出:114 × 8 / 1,000,000 = 0.000912 元

合计约 0.00125 元,八分之一分钱。今天整篇文章连练习一共调了十次左右,全部加起来约 0.0125 元。

## 第 3 步:approval 节点,给 interrupt 加上 response_schema

Day 319 的 interrupt 是这样恢复的:`Command(resume="同意")`,答复是一个随便什么值。真实审批里主管的答复有固定结构:批不批(布尔)、一句备注。主管那边可能是一个网页表单,也可能是企业微信里的按钮,传过来的数据少个字段、类型不对都有可能。LangGraph 1.2.12 起 `interrupt()` 多了一个 `response_schema` 参数,用来声明「恢复时要给我什么样的数据」,并按它校验。

这一步不调模型,方案直接写死。

```python
# agent-zero-lab/part05/lgdemo/refund_s3_approval.py
from typing import NotRequired, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel


class Decision(BaseModel):
    approved: bool
    note: str = ""


class S(TypedDict):
    proposal: dict
    decision: NotRequired[dict]


def human_approval(state: S) -> dict:
    print("  [approval 开始执行]")
    decision = interrupt({"question": "是否批准这笔退款?", **state["proposal"]}, response_schema=Decision)
    print("  [拿到决定]", repr(decision))
    return {"decision": decision.model_dump()}


builder = StateGraph(S)
builder.add_node("approval", human_approval)
builder.add_edge(START, "approval")
graph = builder.compile(checkpointer=InMemorySaver())
config: RunnableConfig = {"configurable": {"thread_id": "s3"}}

fake = {"invoice_id": "INV-2026-0123", "amount_yuan": 2392.0, "reason": "同日同额重复扣款"}
r = graph.invoke({"proposal": fake}, config)
it = r["__interrupt__"][0]
print("交给人看的:", it.value)
print("要求的回复格式:", it.response_schema)

try:
    graph.invoke(Command(resume={"note": "忘了写 approved"}), config)
except Exception as e:
    print("恢复失败:", type(e).__name__)
    print(str(e).splitlines()[:3])

print("next =", graph.get_state(config).next)
print(graph.invoke(Command(resume={"approved": True, "note": "核实无误"}), config))
```

<div class="line-notes">

- `class Decision(BaseModel):` 主管答复的结构。`approved` 必填,`note` 有默认值所以可以不填。
- `decision: NotRequired[dict]` 图刚开始时只有 `proposal`,`decision` 要等人给,所以标成「可以没有」。Day 47 讲 TypedDict 时提过 `NotRequired`,相当于 TS interface 里的 `decision?: object`。
- `print("  [approval 开始执行]")` 放在 interrupt 前面,用来数这个节点一共执行了几次。看输出,三次。
- `decision = interrupt({"question": "是否批准这笔退款?", **state["proposal"]}, response_schema=Decision)` `**state["proposal"]` 把方案的三个字段摊进字典,相当于 JS 的 `{question: ..., ...proposal}`。第一次执行到这里图暂停;恢复时 resume 的值先按 `Decision` 校验,通过了才返回,而且返回的是 `Decision` 实例,不是原始字典。
- `print("  [拿到决定]", repr(decision))` 打印 `Decision(approved=True, note='核实无误')`,证明拿到的确实是 pydantic 对象。
- `return {"decision": decision.model_dump()}` 转回字典再存进 State。
- `it = r["__interrupt__"][0]` 暂停时 invoke 正常返回,结果里多一个 `__interrupt__` 键,是一个列表(并行分支可能同时有好几个中断),这里取第一个。
- `print("要求的回复格式:", it.response_schema)` `Interrupt` 对象上带着 `Decision` 转出来的 JSON Schema。前端拿到它就能自动渲染出一个「勾选框 + 文本框」的表单,和你用 zod schema 生成表单一个思路。
- `graph.invoke(Command(resume={"note": "忘了写 approved"}), config)` 故意少给 `approved`。
- `print(str(e).splitlines()[:3])` 只打印报错前三行,完整的还有一行 pydantic 文档链接。
- `print("next =", graph.get_state(config).next)` 校验失败后图仍然停在 `('approval',)`,状态没被破坏,可以重新提交。
- `print(graph.invoke(Command(resume={"approved": True, "note": "核实无误"}), config))` 这次数据对了,节点跑完,`decision` 写进 State。

</div>

```bash
uv run python refund_s3_approval.py
```

```text
  [approval 开始执行]
交给人看的: {'question': '是否批准这笔退款?', 'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '同日同额重复扣款'}
要求的回复格式: {'properties': {'approved': {'title': 'Approved', 'type': 'boolean'}, 'note': {'default': '', 'title': 'Note', 'type': 'string'}}, 'required': ['approved'], 'title': 'Decision', 'type': 'object'}
  [approval 开始执行]
恢复失败: ValidationError
['1 validation error for Decision', 'approved', "  Field required [type=missing, input_value={'note': '忘了写 approved'}, input_type=dict]"]
next = ('approval',)
  [approval 开始执行]
  [拿到决定] Decision(approved=True, note='核实无误')
{'proposal': {'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '同日同额重复扣款'}, 'decision': {'approved': True, 'note': '核实无误'}}
```

「开始执行」打了三次:第一次暂停,第二次是那次失败的恢复(节点从头跑,走到 interrupt 时校验没过,抛错),第三次是成功的恢复。这就是 Day 319 那条规矩的现场版,每恢复一次,interrupt 前面的代码就多跑一次,失败的恢复也算。

`ValidationError` 是 Day 51 学 pydantic 时见过的那个,读法一样:第一行说哪个模型校验失败,第二行是字段名 `approved`,第三行说原因 `Field required`(缺这个字段)和你实际传了什么。

## 第 4 步:execute 和 reject,条件边分两路

审批之后分两路,用的是 Day 306 的条件边。这一步也不调模型,而且故意不带 checkpointer,只看分支对不对、业务库写进去长什么样。

```python
# agent-zero-lab/part05/lgdemo/refund_s4_branch.py
from datetime import datetime
from typing import NotRequired, TypedDict

from langgraph.graph import END, START, StateGraph

from refund_s1_load import biz


class S(TypedDict):
    proposal: dict
    decision: dict
    outcome: NotRequired[str]


def after_approval(state: S) -> str:
    return "execute" if state["decision"]["approved"] else "reject"


def execute_refund(state: S) -> dict:
    p = state["proposal"]
    now = datetime.now().isoformat(timespec="seconds")
    with biz() as conn:
        conn.execute(
            "INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at, decided_at, decided_by) "
            "VALUES (?, ?, ?, 'approved', ?, ?, 'supervisor')",
            (p["invoice_id"], round(p["amount_yuan"] * 100), p["reason"], now, now),
        )
    return {"outcome": f"已批准:{p['invoice_id']} 退 {p['amount_yuan']:.2f} 元。审批备注:{state['decision']['note']}"}


def reject_refund(state: S) -> dict:
    return {"outcome": f"已驳回,转人工跟进。原因:{state['decision']['note']}"}


builder = StateGraph(S)
builder.add_node("execute", execute_refund)
builder.add_node("reject", reject_refund)
builder.add_conditional_edges(START, after_approval, ["execute", "reject"])
builder.add_edge("execute", END)
builder.add_edge("reject", END)
graph = builder.compile()

if __name__ == "__main__":
    p = {"invoice_id": "INV-2026-0123", "amount_yuan": 2392.0, "reason": "同日同额重复扣款"}
    print(graph.invoke({"proposal": p, "decision": {"approved": False, "note": "金额不对"}})["outcome"])
    print(graph.invoke({"proposal": p, "decision": {"approved": True, "note": "核实无误"}})["outcome"])
    with biz() as conn:
        for row in conn.execute("SELECT id, invoice_id, amount_cents, status, created_at FROM refund_requests"):
            print(tuple(row))
        print("SQLite datetime('now'):", conn.execute("SELECT datetime('now')").fetchone()[0])
    print("Python datetime.now():  ", datetime.now().isoformat(timespec="seconds"))
```

<div class="line-notes">

- `from refund_s1_load import biz` 复用第 1 步的连接函数。
- `def after_approval(state: S) -> str:` 路由函数,只看 `decision["approved"]`。返回的字符串就是下一站的节点名。
- `now = datetime.now().isoformat(timespec="seconds")` 在 Python 里取**本地时间**,格式化到秒,实跑是 `2026-10-22T12:02:27`。为什么不在 SQL 里写 `datetime('now')`,看输出最后两行。
- `"VALUES (?, ?, ?, 'approved', ?, ?, 'supervisor')",` 时间也走占位符。`status` 和 `decided_by` 是固定值,直接写在 SQL 里。
- `(p["invoice_id"], round(p["amount_yuan"] * 100), p["reason"], now, now),` 元转分:`2392.0 * 100` 得 `239200.0`,`round` 取整成 `239200`。浮点乘 100 有时会差一点点(比如 `0.29 * 100` 是 `28.999999999999996`),直接 `int()` 会少一分钱,所以用 `round`。
- `builder.add_conditional_edges(START, after_approval, ["execute", "reject"])` 这个演示图没有 approval 节点,所以直接从 START 分叉。第三个参数列出所有可能的下一站,画图时用得上(Day 306 的 path_map)。
- `graph = builder.compile()` 没传 checkpointer。这一步只跑一次、不暂停,用不着存状态。
- `print(graph.invoke({"proposal": p, "decision": {"approved": False, "note": "金额不对"}})["outcome"])` 驳回那次不碰业务库。
- `print("SQLite datetime('now'):", conn.execute("SELECT datetime('now')").fetchone()[0])` 让 SQLite 自己报时间,和下一行 Python 的时间对比。

</div>

```text
已驳回,转人工跟进。原因:金额不对
已批准:INV-2026-0123 退 2392.00 元。审批备注:核实无误
(1, 'INV-2026-0123', 239200, 'approved', '2026-10-22T12:02:27')
SQLite datetime('now'): 2026-10-22 04:02:27
Python datetime.now():   2026-10-22T12:02:27
```

两路都对,业务库里只有批准那一行。最后两行差了整整 8 小时:SQLite 的 `datetime('now')` 返回的是 **UTC**(协调世界时,北京时间减 8 小时),Python 的 `datetime.now()` 返回本机时区的时间。Day 280 的 seed 和别的地方写时间都用本地时间,如果这里换成 SQL 的 `datetime('now')`,同一张表里就混着两种时区,中午 12 点批的单会记成凌晨 4 点,按时间排序、对账全会乱。前端同学对这个应该不陌生,`new Date().toISOString()` 给的也是 UTC。

跑完这一步业务库里多了一行测试数据,重新 seed 一下:

```bash
cd agent-zero-lab && uv run python cloudledger/seed.py && cd part05/lgdemo
```

## 拼起来:refund_approval.py

四块都单独跑过了,现在装到一张图里,再加上 SqliteSaver 和一个命令行入口。先看对照表,大代码里每一段是从哪一步来的:

| 零件 | 在哪学的 | 大代码里的哪一段 |
| --- | --- | --- |
| `load_ticket` 读工单和发票 | 第 1 步 | `load_ticket`,加了判空 |
| `Proposal` + `with_structured_output` | 第 2 步,Day 312 | `Proposal`、`draft_proposal`,去掉了 `include_raw` |
| `interrupt(..., response_schema=Decision)` | 第 3 步,Day 319 | `Decision`、`human_approval` |
| 条件边 + 写业务库 | 第 4 步,Day 306 | `after_approval`、`execute_refund`、`reject_refund` |
| thread_id 按业务主键起名 | Day 316 | `main()` 里的 `config` |
| `get_state(...).next` | Day 317 | `status` 命令 |
| `SqliteSaver` + `check_same_thread=False` | Day 318 | `main()` 里的 `with sqlite3.connect(CKPT_DB, ...)` |
| `Command(resume=...)` | Day 319 | `approve` / `reject` 命令 |

```python
# agent-zero-lab/part05/lgdemo/refund_approval.py
"""退款人工审批:Agent 起草退款方案 → interrupt 暂停等主管 → 批了才写库。
状态存在 SQLite 里,进程退出后用同一个 thread_id 还能接着跑。

用法(在 agent-zero-lab/part05/lgdemo 目录下):
  uv run python refund_approval.py start T1041              # 跑到审批点停下
  uv run python refund_approval.py status T1041             # 看停在哪
  uv run python refund_approval.py approve T1041 "核实无误"
  uv run python refund_approval.py reject T1041 "金额不对"
"""
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel, Field

from llm import get_llm

BIZ_DB = Path(__file__).parents[2] / "cloudledger" / "cloudledger.db"
CKPT_DB = Path(__file__).with_name("checkpoints.db")


class Proposal(BaseModel):
    invoice_id: str = Field(description="要退款的发票号,必须是工单里或发票列表里出现过的")
    amount_yuan: float = Field(gt=0, description="退款金额(元)")
    reason: str = Field(description="退款依据,一句话")


class Decision(BaseModel):
    approved: bool
    note: str = ""


class RefundState(TypedDict):
    ticket_id: str
    ticket_text: str
    invoices: str
    proposal: dict  # Proposal.model_dump(),State 里只放能直接序列化的数据
    decision: dict  # Decision.model_dump()
    outcome: str


class RefundInput(TypedDict):
    ticket_id: str


def biz() -> sqlite3.Connection:
    conn = sqlite3.connect(BIZ_DB)
    conn.row_factory = sqlite3.Row
    return conn


def load_ticket(state: RefundState) -> dict:
    with biz() as conn:
        t = conn.execute("SELECT * FROM tickets WHERE id = ?", (state["ticket_id"],)).fetchone()
        if t is None:
            raise ValueError(f"工单 {state['ticket_id']} 不存在")
        invs = conn.execute(
            "SELECT id, amount_cents, status, issued_at FROM invoices WHERE customer_id = ? "
            "ORDER BY issued_at DESC, id DESC LIMIT 5",
            (t["customer_id"],),
        ).fetchall()
    lines = [f"{r['id']} {r['amount_cents'] / 100:.2f}元 {r['status']} {r['issued_at']}" for r in invs]
    return {"ticket_text": t["body"], "invoices": "\n".join(lines)}


def draft_proposal(state: RefundState) -> dict:
    llm = get_llm().with_structured_output(Proposal, method="function_calling")
    proposal = llm.invoke(
        "你是云簿的账务专员。根据工单和发票记录起草退款方案。"
        "重复扣款只退重复的那一笔(通常是开票日期相同、较晚生成的那张)。\n\n"
        f"工单:{state['ticket_text']}\n\n最近发票:\n{state['invoices']}"
    )
    assert isinstance(proposal, Proposal)
    return {"proposal": proposal.model_dump()}


def human_approval(state: RefundState) -> dict:
    p = state["proposal"]
    # 恢复时这个节点会从第一行重新执行,interrupt 前面不要放有副作用的代码
    decision = interrupt({"question": "是否批准这笔退款?", **p}, response_schema=Decision)
    return {"decision": decision.model_dump()}


def after_approval(state: RefundState) -> str:
    return "execute" if state["decision"]["approved"] else "reject"


def execute_refund(state: RefundState) -> dict:
    p = state["proposal"]
    now = datetime.now().isoformat(timespec="seconds")  # 本地时间;SQLite 的 datetime('now') 是 UTC
    with biz() as conn:
        conn.execute(
            "INSERT INTO refund_requests (invoice_id, amount_cents, reason, status, created_at, decided_at, decided_by) "
            "VALUES (?, ?, ?, 'approved', ?, ?, 'supervisor')",
            (p["invoice_id"], round(p["amount_yuan"] * 100), p["reason"], now, now),
        )
    return {"outcome": f"已批准:{p['invoice_id']} 退 {p['amount_yuan']:.2f} 元。审批备注:{state['decision']['note']}"}


def reject_refund(state: RefundState) -> dict:
    return {"outcome": f"已驳回,转人工跟进。原因:{state['decision']['note']}"}


builder = StateGraph(RefundState, input_schema=RefundInput)
builder.add_node("load", load_ticket)
builder.add_node("draft", draft_proposal)
builder.add_node("approval", human_approval)
builder.add_node("execute", execute_refund)
builder.add_node("reject", reject_refund)
builder.add_edge(START, "load")
builder.add_edge("load", "draft")
builder.add_edge("draft", "approval")
builder.add_conditional_edges("approval", after_approval, ["execute", "reject"])
builder.add_edge("execute", END)
builder.add_edge("reject", END)


def main() -> None:
    action, ticket_id = sys.argv[1], sys.argv[2]
    note = sys.argv[3] if len(sys.argv) > 3 else ""
    config: RunnableConfig = {"configurable": {"thread_id": f"refund-{ticket_id}"}}

    with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:
        graph = builder.compile(checkpointer=SqliteSaver(conn))

        if action == "start":
            result = graph.invoke({"ticket_id": ticket_id}, config)
            if "__interrupt__" in result:
                print("已暂停,等待审批:", result["__interrupt__"][0].value)
        elif action == "status":
            snap = graph.get_state(config)
            print("下一步要执行的节点:", snap.next)
            print("当前方案:", snap.values.get("proposal"))
        elif action in ("approve", "reject"):
            result = graph.invoke(Command(resume={"approved": action == "approve", "note": note}), config)
            print(result["outcome"])
        else:
            print("不认识的命令:", action)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `"""退款人工审批:` docstring 里写清用法和运行目录。下面每条注释里的数据都是按 start、status、approve 的顺序在刚 seed 过的库上实跑出来的。
- `import sqlite3` 这个文件连两个 SQLite 库:业务库 `cloudledger.db` 和存执行状态的 `checkpoints.db`。
- `from langgraph.checkpoint.sqlite import SqliteSaver` 来自 `langgraph-checkpoint-sqlite` 包,2026 年 10 月 PyPI 上的最新版是 3.1.2,配 langgraph 1.2.16,我就是用这两个版本跑的。
- `CKPT_DB = Path(__file__).with_name("checkpoints.db")` checkpoint 库放在脚本旁边。`with_name` 把路径的文件名部分换掉,得到 `.../lgdemo/checkpoints.db`。
- `class RefundState(TypedDict):` 这次没写 `total=False`,所有字段都标成必填。原因是类型检查:`total=False` 时节点里写 `state["proposal"]`,basedpyright standard 档会报 `"proposal" is not a required key`。LangGraph 运行时并不检查字段齐不齐,每个节点读的都是前面节点已经写好的字段,所以对类型检查器说「都有」是成立的。
- `proposal: dict  # Proposal.model_dump(),State 里只放能直接序列化的数据` 存字典不存 pydantic 对象,原因见后面的「三个设计取舍」。
- `class RefundInput(TypedDict):` 图的**输入**格式:调用方只给 `ticket_id`。上面把 State 的字段都标成了必填,如果不单独声明输入格式,`graph.invoke({"ticket_id": ...})` 这一行就会被标红,说缺了五个字段。
- `if t is None:` 第 1 步演示过的坑,查不到工单立刻抛一个看得懂的错。实跑 `start T9999` 打印 `ValueError: 工单 T9999 不存在`,下面还跟一行 `During task with name 'load'`,告诉你是哪个节点出的错。
- `assert isinstance(proposal, Proposal)` `with_structured_output` 的返回类型标的是「字典或 pydantic 对象」,类型检查器不知道这里一定是 `Proposal`。`assert` 一下,下一行的 `.model_dump()` 就不标红了;真不是的话会立刻报错,比悄悄往下跑强。
- `p = state["proposal"]` 这一行在 interrupt 前面,但它只是读字典,没有副作用,跑几遍都没关系。
- `decision = interrupt({"question": "是否批准这笔退款?", **p}, response_schema=Decision)` 和第 3 步一样。实跑 start 时交出去的是 `{'question': '是否批准这笔退款?', 'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '…'}`。
- `def after_approval(state: RefundState) -> str:` 和第 4 步一样。
- `now = datetime.now().isoformat(timespec="seconds")  # 本地时间;SQLite 的 datetime('now') 是 UTC` 实跑写进库的是 `2026-10-22T12:05:02`。
- `builder = StateGraph(RefundState, input_schema=RefundInput)` 第一个参数是整张图的状态格式,`input_schema` 声明 invoke 时收什么。输出默认还是整个 State。
- `builder.add_edge("draft", "approval")` 起草完一定进审批,图里没有任何绕过人的路径。
- `builder.add_conditional_edges("approval", after_approval, ["execute", "reject"])` 审批之后分两路。
- `action, ticket_id = sys.argv[1], sys.argv[2]` `sys.argv` 是命令行参数列表,相当于 Node 里的 `process.argv`,只是 Python 的 `argv[0]` 就是脚本名,所以从 1 开始取。
- `note = sys.argv[3] if len(sys.argv) > 3 else ""` 备注可以不写。
- `config: RunnableConfig = {"configurable": {"thread_id": f"refund-{ticket_id}"}}` Day 316 的习惯:「业务类型 + 业务主键」,T1041 永远是 `refund-T1041`。三个命令是三个进程,靠这个 id 接上同一条线。
- `with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:` Day 318 讲过,LangGraph 可能在别的线程里写 checkpoint,SQLite 默认禁止跨线程用同一个连接,不加这个参数会偶发 `ProgrammingError`。
- `graph = builder.compile(checkpointer=SqliteSaver(conn))` 每个子命令都重新编译一次图。编译很快,不调模型,重要的是 checkpointer 指向同一个库文件。
- `result = graph.invoke({"ticket_id": ticket_id}, config)` start:从头跑,跑到 interrupt 停下。
- `print("已暂停,等待审批:", result["__interrupt__"][0].value)` 把交给人的方案打出来。
- `snap = graph.get_state(config)` status:不执行任何节点,只读最新快照,所以不花钱。
- `print("下一步要执行的节点:", snap.next)` 实跑 `('approval',)`。
- `result = graph.invoke(Command(resume={"approved": action == "approve", "note": note}), config)` approve 和 reject 共用这一行,`action == "approve"` 算出 `True` 或 `False`。resume 的字典会按 `Decision` 校验。
- `print(result["outcome"])` 实跑 `已批准:INV-2026-0123 退 2392.00 元。审批备注:核实无误`。

</div>

## 跑一遍,三个命令三个进程

先确认业务库是干净的(上一步 seed 过就不用再跑),然后:

```bash
cd agent-zero-lab/part05/lgdemo
rm -f checkpoints.db
uv run python refund_approval.py start T1041
```

```text
已暂停,等待审批: {'question': '是否批准这笔退款?', 'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '与 INV-2026-0026 同为 2026-10-08 扣款、金额相同，属重复扣款，INV-2026-0123 为较晚生成的一张，退该笔'}
```

命令结束,进程退出了。这时候关掉终端、去喝杯咖啡都行,状态已经在 `checkpoints.db` 里。回来以后先看看它停在哪:

```bash
uv run python refund_approval.py status T1041
```

```text
下一步要执行的节点: ('approval',)
当前方案: {'invoice_id': 'INV-2026-0123', 'amount_yuan': 2392.0, 'reason': '与 INV-2026-0026 同为 2026-10-08 扣款、金额相同，属重复扣款，INV-2026-0123 为较晚生成的一张，退该笔'}
```

这就是以后做审批后台时「待审批列表」的数据来源:`next` 是 `('approval',)` 的 thread 就是在等人。主管看了方案,批准:

```bash
uv run python refund_approval.py approve T1041 "核实无误"
sqlite3 ../../cloudledger/cloudledger.db "select * from refund_requests"
```

```text
已批准:INV-2026-0123 退 2392.00 元。审批备注:核实无误
1|INV-2026-0123|239200|与 INV-2026-0026 同为 2026-10-08 扣款、金额相同，属重复扣款，INV-2026-0123 为较晚生成的一张，退该笔|approved|2026-10-22T12:05:02|2026-10-22T12:05:02|supervisor
```

第三个进程读回 checkpoint,从 approval 节点接着跑完,写了业务库。模型每次起草的理由措辞都不一样(我跑了好几遍,有用全角逗号的、有用半角的,有说「退该笔」的、有说「退还该笔重复扣款」的),只要它挑的是 `INV-2026-0123` 就对。挑成 `INV-2026-0026` 从业务上讲也说得通,两张都是那笔重复的钱。这种「不止一个正确答案」的情况,第六部分写评测时会专门处理。

再试两件事。第一件,对已经跑完的 thread 再批一次:

```bash
uv run python refund_approval.py approve T1041 "再批一次"
```

```text
已批准:INV-2026-0123 退 2392.00 元。审批备注:核实无误
```

注意备注还是上一次的「核实无误」,不是新给的「再批一次」。LangGraph 发现这个 thread 已经跑完了(`next` 是空的),没有可以恢复的中断,就直接把最终状态还给你,一个节点都没执行。业务库里还是只有 1 行。所以在我们这个命令行里重复点批准是安全的。

第二件,先驳回、再改主意批准行不行?重新来一遍:

```bash
rm -f checkpoints.db
uv run python refund_approval.py start T1041
uv run python refund_approval.py reject T1041 "金额不对"
uv run python refund_approval.py approve T1041 "我改主意了"
```

```text
已暂停,等待审批: {'question': '是否批准这笔退款?', ...}
已驳回,转人工跟进。原因:金额不对
已驳回,转人工跟进。原因:金额不对
```

不行,和上面同一个原因:驳回之后 thread 就结束了。「驳回后撤回重审」要靠时间旅行回到审批之前,这是 [Day 322](/blog/agent-zero/day-322-lg-time-travel/) 的内容。

## 三个设计取舍

**State 里只放能直接序列化的数据。** checkpointer 要把 State 写进 SQLite,读的时候再还原。字典、字符串、数字这些它都会处理;pydantic 对象它也能存,但读回来时会警告。我做了个对照版本 `bad_pydantic_state.py`,draft 直接返回 `{"proposal": proposal}`(不 `model_dump()`),start 之后跑 status,终端多了这么一行:

```text
Deserializing unregistered type __main__.Proposal from checkpoint. This will be blocked in a future version. Set LANGGRAPH_STRICT_MSGPACK=true to block now, or add to allowed_msgpack_modules to allow explicitly: [('__main__', 'Proposal')]
```

意思是从 checkpoint 里还原任意 Python 类有安全风险(存档被人改过的话,还原时可能执行恶意代码),以后的版本默认会拒绝。最省心的做法就是我们现在这样,节点里 `model_dump()` 成字典再放进 State。

**时间在 Python 里生成。** 第 4 步已经演示过,SQLite 的 `datetime('now')` 是 UTC,和库里其他本地时间混在一起会乱。整个项目统一一种时区,在一个地方生成。

**业务库和 checkpoint 库分开。** `cloudledger.db` 存业务数据,`checkpoints.db` 存执行状态。我跑完 start 和 approve 之后看了一眼,`checkpoints.db` 是 32 KB,里面两张表:`checkpoints` 6 行、`writes` 14 行。这些是 LangGraph 内部格式,不是给人或者给报表看的,混进业务库只会添乱。生产里通常也这样分:checkpoint 放一个独立的 Postgres schema。

## 动手练习

**练习 1:副作用重复实验。** 复制一份 `refund_approval.py` 叫 `ex1_notify.py`,把 `CKPT_DB` 改成 `ex1.db`,在 `human_approval` 里 `interrupt` 前面加一行 `print("已通知主管")`。跑一次 start、一次 approve,数一数这行打印了几次,用今天学的原理解释。然后把这行挪到 `draft_proposal` 的 `return` 前面,再跑一遍。

<details><summary>参考答案</summary>

第一个版本,`human_approval` 改成这样:

```python
def human_approval(state: RefundState) -> dict:
    p = state["proposal"]
    print("已通知主管")
    decision = interrupt({"question": "是否批准这笔退款?", **p}, response_schema=Decision)
    return {"decision": decision.model_dump()}
```

<div class="line-notes">

- `print("已通知主管")` 代表「给主管发一条企业微信」这种真实副作用。放在 interrupt 前面。
- `decision = interrupt(` 第一次执行到这里暂停;approve 时节点从第一行重新执行,又经过一次 print。

</div>

```text
已通知主管
已暂停,等待审批: {'question': '是否批准这笔...
已通知主管
已批准:INV-2026-0123 退 2392.00 元。审批备注:ok
```

(方案那一行太长,我截掉了后半段。)打印了两次,start 一次、approve 一次。真发消息的话主管会收到两条。

第二个版本,print 挪到 draft 末尾,`human_approval` 恢复原样:

```python
def draft_proposal(state: RefundState) -> dict:
    llm = get_llm().with_structured_output(Proposal, method="function_calling")
    proposal = llm.invoke(
        "你是云簿的账务专员。根据工单和发票记录起草退款方案。"
        "重复扣款只退重复的那一笔(通常是开票日期相同、较晚生成的那张)。\n\n"
        f"工单:{state['ticket_text']}\n\n最近发票:\n{state['invoices']}"
    )
    assert isinstance(proposal, Proposal)
    print("已通知主管")
    return {"proposal": proposal.model_dump()}
```

<div class="line-notes">

- `print("已通知主管")` draft 节点跑完就有了 checkpoint,恢复时从 approval 开始,draft 不会再执行。

</div>

先 `rm -f ex1.db`,再跑 start 和 approve:

```text
已通知主管
已暂停,等待审批: {'question': '是否批准这笔...
已批准:INV-2026-0123 退 2392.00 元。审批备注:ok
```

只打印一次。另一种同样可行的改法是单独加一个 `notify` 节点放在 draft 和 approval 中间,好处是以后换通知渠道只改这一个节点。

</details>

**练习 2:换成 InMemorySaver 会怎样。** 复制一份叫 `ex2_memory.py`,把 `SqliteSaver(conn)` 换成 `InMemorySaver()`(记得改 import),依次跑 start、status、approve,观察现象,写一句话解释。

<details><summary>参考答案</summary>

改动只有两行:

```python
from langgraph.checkpoint.memory import InMemorySaver
graph = builder.compile(checkpointer=InMemorySaver())
```

<div class="line-notes">

- `from langgraph.checkpoint.memory import InMemorySaver` 替换原来那行 `from langgraph.checkpoint.sqlite import SqliteSaver`。
- `graph = builder.compile(checkpointer=InMemorySaver())` 状态只存在这个进程的内存里。

</div>

实跑输出(方案那行截掉了后半段,traceback 中间几十行省略):

```text
已暂停,等待审批: {'question': '是否批准这笔...
下一步要执行的节点: ()
当前方案: None
Traceback (most recent call last):
...
KeyError: 'ticket_id'
During task with name 'load' and id '7fc5fb7f-4b76-8413-f4c2-9229aacf9214'
```

start 那个进程退出时,内存里的状态跟着没了。status 是新进程,`refund-T1041` 在它的内存里不存在,所以 `next` 是空的、方案是 `None`。approve 更糟:没有可恢复的中断,LangGraph 把它当成一次全新的执行从 START 开始跑,而 `Command` 不带任何输入,`load` 节点读 `state["ticket_id"]` 就 KeyError 了。一句话:InMemorySaver 的状态活不过进程,跨进程审批必须用落盘的 checkpointer。

</details>

**练习 3:待审批列表。** 写一个 `pending.py`,列出 `checkpoints.db` 里所有 thread,并把停在审批点的那些打印出来(thread_id、发票号、金额)。为了有两条数据,先对 T1041 和 T1001 各跑一次 start。提示:`SqliteSaver` 有一个 `list(None)` 方法,能遍历库里所有 checkpoint。

<details><summary>参考答案</summary>

```bash
rm -f checkpoints.db
uv run python refund_approval.py start T1041
uv run python refund_approval.py start T1001
```

```python
# agent-zero-lab/part05/lgdemo/pending.py
import sqlite3

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver

from refund_approval import CKPT_DB, builder

with sqlite3.connect(CKPT_DB, check_same_thread=False) as conn:
    saver = SqliteSaver(conn)
    graph = builder.compile(checkpointer=saver)
    threads = sorted({c.config.get("configurable", {})["thread_id"] for c in saver.list(None)})
    print("库里一共", len(threads), "个 thread:", threads)
    for tid in threads:
        config: RunnableConfig = {"configurable": {"thread_id": tid}}
        snap = graph.get_state(config)
        if snap.next == ("approval",):
            p = snap.values["proposal"]
            print(f"待审批 {tid}: {p['invoice_id']} {p['amount_yuan']:.2f} 元")
```

<div class="line-notes">

- `from refund_approval import CKPT_DB, builder` 复用图的定义和库路径。`refund_approval.py` 末尾有 `if __name__ == "__main__":`,所以被导入时不会去执行 `main()`。
- `saver = SqliteSaver(conn)` 这次把 saver 单独存进变量,下面要直接调用它的方法。
- `threads = sorted({c.config.get("configurable", {})["thread_id"] for c in saver.list(None)})` `saver.list(None)` 不按 thread 过滤,把库里每一个 checkpoint 都拿出来;花括号推导式建一个集合(Set)去重,再排序。`.get("configurable", {})` 是为了让类型检查器满意,`configurable` 在类型上是可选键。实跑得到两个:`['refund-T1001', 'refund-T1041']`。
- `if snap.next == ("approval",):` 下一步是 approval 的就是在等人。
- `print(f"待审批 {tid}: {p['invoice_id']} {p['amount_yuan']:.2f} 元")` 实跑两条都在等审批。

</div>

```text
库里一共 2 个 thread: ['refund-T1001', 'refund-T1041']
待审批 refund-T1001: INV-2026-0056 495.00 元
待审批 refund-T1041: INV-2026-0123 2392.00 元
```

T1001 那条值得多看一眼。它其实是一张「导出报表报错」的工单(正文是 `导出年度报表的时候一直提示 ERR_EXPORT_TIMEOUT,换了浏览器也一样。`),和扣款没关系。客户 C015 的三张发票是 10 月 11 日、9 月 9 日、8 月 10 日各一张 495 元,正常的月付。我对它跑了两次 start,两次模型都起草了 495 元的退款方案:

- 第一次的理由:`工单为导出报表超时故障，与扣款无关；三张发票金额相同但开票日期各异，不构成重复扣款，故无退款依据。` 它自己都知道不该退,金额却还是填了 495。
- 第二次的理由:`经核对 INV-2026-0056 与 INV-2026-0057 金额均为 495.00 元、属重复扣款，按规则仅退开票日期较晚生成的 INV-2026-0056 一笔。` 这次干脆编了一个重复扣款,两张发票差了一个月。

原因是 `Proposal` 的结构逼它必须给一个大于 0 的金额,提示词里又只讲了重复扣款这一条规则,它就往这条规则上靠。如果没有审批这一道,第二次就真退出去了。这正好说明审批节点为什么不能省,也说明 schema 该留一条「不需要退款」的出路,见「常见误区」。

真实系统里不会每次都扫全库,而是 start 时顺手把 thread_id 写进一张 `pending_approvals` 业务表,这部分在 [Day 324](/blog/agent-zero/day-324-lg-subgraph/) 讲「放到真实系统里」时展开。

</details>

**练习 4(开放题):让主管能改金额。** 有时主管会说「只退一半」。改造 `Decision` 和 `execute_refund`,让 approve 命令可以多带一个金额参数,比如 `approve T1041 "只退一半" 1196`;不带就按方案金额退。金额必须大于 0。

<details><summary>参考答案</summary>

示范解法存成 `ex4_amount.py`(`CKPT_DB` 改成 `ex4.db`),和 `refund_approval.py` 相比改了四处:

```python
class Decision(BaseModel):
    approved: bool
    note: str = ""
    amount_yuan: float | None = Field(default=None, gt=0)  # 主管改的金额,不填就按方案


def execute_refund(state: RefundState) -> dict:
    p = dict(state["proposal"])
    if state["decision"]["amount_yuan"] is not None:
        p["amount_yuan"] = state["decision"]["amount_yuan"]
    now = datetime.now().isoformat(timespec="seconds")
    ...  # 后面和原来一样

# main() 里:
    amount = float(sys.argv[4]) if len(sys.argv) > 4 else None
    ...
            result = graph.invoke(Command(resume={"approved": action == "approve", "note": note, "amount_yuan": amount}), config)
```

<div class="line-notes">

- `amount_yuan: float | None = Field(default=None, gt=0)  # 主管改的金额,不填就按方案` `float | None` 相当于 TS 的 `number | null`。`gt=0` 只对非 None 的值生效。因为用了 `response_schema=Decision`,这个约束在恢复时自动校验。
- `p = dict(state["proposal"])` 复制一份再改。直接改 `state["proposal"]` 会改到 LangGraph 交给你的那个字典,虽然这次碰巧没事,但节点里原地修改 state 是个坏习惯。
- `if state["decision"]["amount_yuan"] is not None:` 主管给了金额就用主管的。
- `amount = float(sys.argv[4]) if len(sys.argv) > 4 else None` 第四个参数是金额。
- `result = graph.invoke(Command(resume={"approved": action == "approve", "note": note, "amount_yuan": amount}), config)` 多传一个字段。

</div>

先 seed、start,再故意传一个负数,最后传正确的金额:

```bash
uv run python ex4_amount.py approve T1041 "只退一半" -5
uv run python ex4_amount.py approve T1041 "只退一半" 1196
sqlite3 ../../cloudledger/cloudledger.db "select id, invoice_id, amount_cents, status from refund_requests"
```

```text
pydantic_core._pydantic_core.ValidationError: 1 validation error for Decision
amount_yuan
  Input should be greater than 0 [type=greater_than, input_value=-5.0, input_type=float]
已批准:INV-2026-0123 退 1196.00 元。审批备注:只退一半
1|INV-2026-0123|119600|approved
```

负数被 `response_schema` 拦在了恢复那一刻,图还停在审批点;第二次正常写进 119600 分。对比原版:原版只能按模型给的 2392 元退,改金额只能驳回重来。

</details>

**验收标准**:`start → status → approve` 三个进程跑通,业务库里出现一行 approved 记录,金额 239200;练习 1 能说清楚「打印两次」的原因和两种修法;练习 2 能说清楚 KeyError 是怎么来的;能不看代码画出五个节点和两条条件边。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 人工审批(human-in-the-loop) | 自动流程跑到关键决策处停下,让人拍板后再继续。今天的例子是退款要主管批准 |
| response_schema | `interrupt()` 的参数(langgraph 1.2.12 起),声明恢复时人要给什么格式的数据。传 pydantic 模型会自动校验,并把 JSON Schema 带在 `Interrupt.response_schema` 上 |
| input_schema | `StateGraph(..., input_schema=...)` 的参数,声明 invoke 时调用方要传哪些字段。今天调用方只传 `ticket_id` |
| UTC | 协调世界时,北京时间减 8 小时。SQLite 的 `datetime('now')`、JS 的 `toISOString()` 给的都是它 |
| 序列化 | 把内存里的对象转成能写进文件或网络的格式(比如 JSON 字符串),读回来叫反序列化 |
| sys.argv | 命令行参数列表,`argv[0]` 是脚本名,相当于 Node 的 `process.argv` |
| include_raw | `with_structured_output` 的参数,为 True 时同时返回模型原始回复和解析结果,用来看 token 用量 |

## 常见误区

**以为结构化输出的模型会「拒绝」不合理的请求。** 练习 3 里那张和扣款无关的 T1001 工单,模型两次都给了 495 元的方案,第二次还编出一个不存在的重复扣款,因为 `amount_yuan` 是 `gt=0` 的必填字段,它没有办法说「不退」。schema 决定了模型能说什么。真做的话,`Proposal` 里应该加一个 `need_refund: bool`,图里再加一条「不需要退款就直接结束」的条件边,而不是把判断全压给审批的人。

**对已经结束的 thread 再发 resume,以为会重新审批。** 实测它什么都不执行,直接返回上一次的最终状态,备注都还是旧的。想改结论得用时间旅行。

**在节点里原地修改 state。** 比如 `state["proposal"]["amount_yuan"] = 1196`。LangGraph 是按节点的**返回值**来更新状态的,原地修改要么不生效,要么在你没预料到的地方生效。要改就复制一份(`dict(...)`)或者把新值放进返回的字典。

**pydantic 对象直接放进 State。** 能跑,但从 SqliteSaver 读回时每次都打 `Deserializing unregistered type` 警告,以后的版本会直接拒绝。State 里放字典和基本类型。

**SQL 里写 `datetime('now')` 记审批时间。** 它是 UTC,中午 12 点批的单会记成 04:02,和本地时间写的其他列混在一起,排序和对账全乱。统一在 Python 里生成时间。

**看到 `'NoneType' object is not subscriptable` 就盯着报错那一行找。** 真正的原因往往在上一行:`fetchone()` 查不到返回了 `None`。查数据库的地方都要想一下「查不到怎么办」。

## 学习资料

### 文档与文章

- [LangGraph · Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts):今天的核心文档。重点读 response_schema 那一节和「Side effects called before interrupt must be idempotent」那一节,40 分钟。
- [LangGraph · Persistence](https://docs.langchain.com/oss/python/langgraph/persistence):checkpoint 存了什么、序列化规则,和今天「State 里只放能序列化的数据」对应,20 分钟。
- [LangChain · Human-in-the-loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop):如果用高层的 `create_agent`,它的 `HumanInTheLoopMiddleware` 能在指定工具调用前自动插一个审批,底下就是今天的 interrupt,15 分钟扫一眼知道有这个东西就行。
- [SQLite · Date And Time Functions](https://www.sqlite.org/lang_datefunc.html):看开头那段说明,确认 `'now'` 是 UTC,`'localtime'` 修饰符怎么用,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z3NY66EY1&p=88&autoplay=0&high_quality=1" title="尚硅谷LangGraph教程,langgraph入门,langgraph智能体项目实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚硅谷 · LangGraph 教程 · 今天看第 88 集「审批模型」(17 分钟)和第 86 集「HITL 案例演示」(14 分钟),它的审批例子和我们的退款图是同一个形状,可以对照着看它怎么组织节点。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fykHY6EAF&autoplay=0&high_quality=1" title="LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · LangGraph Interrupt:Human-In-The-Loop 人机交互手到擒来! · 22 分钟,讲 interrupt 刚推出时的设计和几种审批模式。2024 年 12 月录的,主体 API 没变,但还没有 response_schema。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/6t7YJcEFUIY" title="LangGraph interrupt: Making it easier to build human-in-the-loop agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · LangGraph interrupt: Making it easier to build human-in-the-loop agents · 官方介绍 interrupt 的设计动机,英文,重点听为什么恢复时节点要重新执行。</figcaption>
</figure>

### 书籍

- Mayo Oshin、Nuno Campos《Learning LangChain》(O'Reilly,2025):讲 LangGraph 的章节里有持久化和人工介入的例子,和今天的退款图对照着看。英文原版。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章讲 Agent 的部分讨论了「哪些操作必须让人确认」。读完想一想,CloudLedger 里除了退款,还有哪些写操作你会设成要审批。

### 开源项目与代码

- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) 的 [libs/checkpoint-sqlite](https://github.com/langchain-ai/langgraph/tree/main/libs/checkpoint-sqlite):SqliteSaver 的源码,看它建的 `checkpoints` 和 `writes` 两张表,就知道我们库里那 6 行和 14 行是什么。

## 自测

1. 退款审批图五个节点里,哪个调模型、哪个写业务库、哪个是人?恢复审批时,哪些节点会再执行一次?

<details><summary>答案</summary>

draft 调模型,execute 写业务库,approval 是人。恢复时 load 和 draft 不会再执行(它们跑完时已经有 checkpoint 了),approval 从第一行重新执行一次,然后按决定走 execute 或 reject。

</details>

2. 主管恢复时传了 `{"note": "看过了"}`,忘了 `approved`,会发生什么?图的状态会被破坏吗?

<details><summary>答案</summary>

因为 `interrupt` 带了 `response_schema=Decision`,恢复值先按 `Decision` 校验,抛 `ValidationError: 1 validation error for Decision / approved / Field required`。图的状态不会被破坏,`get_state` 看 `next` 仍然是 `('approval',)`,改对数据重新提交就行。注意这次失败的恢复也让 approval 节点从头执行了一次。

</details>

3. 为什么 `execute_refund` 里用 `datetime.now()` 而不是 SQL 里的 `datetime('now')`?

<details><summary>答案</summary>

SQLite 的 `datetime('now')` 返回 UTC,实测中午 12:02 跑出来是 `04:02:27`;Python 的 `datetime.now()` 是本机时区。业务库其他地方用的是本地时间,混用会让排序和对账出错。统一在 Python 里生成,也方便以后改成显式带时区的写法。

</details>

4. 对一个已经驳回结束的 thread 再发 `Command(resume={"approved": True})`,结果是什么?为什么?

<details><summary>答案</summary>

还是返回驳回的那个最终状态,一个节点都不执行。thread 的 `next` 是空的,没有待处理的中断可以恢复。想改结论要用时间旅行回到审批前(Day 322)。

</details>

5. **面试题**:「你的 Agent 有一步要人工审批,审批可能等好几个小时,中间服务会重启。用 LangGraph 怎么实现?有哪些坑?」

<details><summary>答案</summary>

参考要点:用持久化的 checkpointer(开发用 SqliteSaver,生产用 PostgresSaver),每个节点跑完自动存快照;审批节点里调 `interrupt()` 暂停,把待审批内容(发票号、金额、理由)交给业务系统;thread_id 用业务主键(`refund-T1041`),这样任何进程、任何时候都能接上;审批结果回来后用同一个 thread_id 和 `Command(resume=...)` 恢复,并用 `response_schema` 校验答复格式。坑:恢复时审批节点会从头重跑,interrupt 前不放副作用;State 里只放可序列化的数据;写库的节点要考虑重复执行;已结束的 thread 再 resume 不会重新审批;时区统一。能补一句「不用 LangGraph 的话,本质就是状态持久化加可恢复的执行位置,Temporal 这类 durable execution 引擎做的是同一件事」会更好。

</details>

## 明天预告

明天是 [Day 321 · 第 46 周复习:MCP 与编排(Day 315–320)](/blog/agent-zero/day-321-week46-review/)。这一周从「没有 checkpoint 会丢什么」一路走到今天的退款审批,零件多、名字像(checkpoint、checkpointer、thread、snapshot),很容易混。明天画一张知识地图把它们串起来,默写今天的审批节点,再用本周的东西从零写一个不调模型的「发票抬头修改审批」。
