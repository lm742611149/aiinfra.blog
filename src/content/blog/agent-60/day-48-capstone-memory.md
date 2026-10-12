---
title: 'Day 48 · 多轮与记忆:会话状态、客户画像、上下文压缩'
description: '给 SupportPilot 加上三种记忆:同一张工单里的多轮对话(状态存进 Postgres,进程重启也不丢)、跨工单的客户画像(只在历史变化时重建)、对话太长时把早期轮次压成摘要。改动集中在三个新文件和两个节点,用假 LLM 测多轮和压缩。'
pubDate: 2026-10-12
regime: none
tags: ['capstone', 'memory', 'context-engineering', 'checkpoint', 'langgraph', 'supportpilot', 'agent-60']
series: 'agent-60'
day: 48
lang: 'zh'
---

## 今天要解决的问题

昨天的工作流是"一问一答":客户发一张工单,Agent 处理完就结束。真实的客服不是这样的。客户看完回复会追问"那我重新授权了还是不行怎么办",会补一句"对了上次你们说会提醒我的",会隔天再回来接着问。

记忆这件事,国内 JD 里出现得特别多:本站 JD 调研里,国内 120 条样本有 66% 提到上下文工程或记忆,海外只有 25%。腾讯、字节几个标题写着 "Agent Harness" 的岗位,要求里几乎都有"上下文组装""记忆管理"。面试时这一块会被问得很细。

今天结束时你应该做到:

1. 同一张工单可以多轮对话,第二轮的 Agent 知道第一轮说过什么。
2. 状态存在 Postgres 里,进程重启、审批隔天才点,工单都能接着处理。
3. 吴刚第四次来问银行同步,Agent 在上下文里看到"这个客户 E3001 已经出现过 3 次,希望到期前能提醒"。
4. 对话超过预算时,早期轮次自动压成摘要,最近几轮原样保留。
5. 用假 LLM 测通多轮和压缩,讲得清楚三种记忆各自解决什么问题、存在哪、什么时候更新。

预计用时 3–5 小时。前置:Day 20(上下文工程与记忆)、Day 25(checkpoint)、Day 47。

## 三种记忆,三个问题

"记忆"这个词被用得太泛了。拆开看,SupportPilot 需要的是三样东西,解决三个不同的问题。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="SupportPilot 的三种记忆">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="20" width="200" height="220" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="44" text-anchor="middle" font-size="12" fill="var(--ink)">工单内:对话状态</text>
<text x="110" y="74" text-anchor="middle" fill="var(--ink-soft)">turns 列表 + 全部字段</text>
<text x="110" y="96" text-anchor="middle" fill="var(--ink-soft)">存:Postgres checkpoint</text>
<text x="110" y="118" text-anchor="middle" fill="var(--ink-soft)">键:thread_id = 工单号</text>
<text x="110" y="140" text-anchor="middle" fill="var(--ink-soft)">寿命:工单关闭为止</text>
<text x="110" y="180" text-anchor="middle" fill="var(--ink)">解决:追问时</text>
<text x="110" y="198" text-anchor="middle" fill="var(--ink)">不忘前文</text>
<rect x="220" y="20" width="200" height="220" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="44" text-anchor="middle" font-size="12" fill="var(--ink)">工单内:对话摘要</text>
<text x="320" y="74" text-anchor="middle" fill="var(--ink-soft)">summary + summarized_upto</text>
<text x="320" y="96" text-anchor="middle" fill="var(--ink-soft)">存:同上,状态的一部分</text>
<text x="320" y="118" text-anchor="middle" fill="var(--ink-soft)">触发:超过 token 预算</text>
<text x="320" y="140" text-anchor="middle" fill="var(--ink-soft)">保留:最近 4 轮原文</text>
<text x="320" y="180" text-anchor="middle" fill="var(--ink)">解决:聊得越久</text>
<text x="320" y="198" text-anchor="middle" fill="var(--ink)">越贵越乱</text>
<rect x="430" y="20" width="200" height="220" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="530" y="44" text-anchor="middle" font-size="12" fill="var(--ink)">跨工单:客户画像</text>
<text x="530" y="74" text-anchor="middle" fill="var(--ink-soft)">一段 100 字以内的话</text>
<text x="530" y="96" text-anchor="middle" fill="var(--ink-soft)">存:biz.customer_profiles</text>
<text x="530" y="118" text-anchor="middle" fill="var(--ink-soft)">更新:历史工单数变了</text>
<text x="530" y="140" text-anchor="middle" fill="var(--ink-soft)">寿命:跟着客户</text>
<text x="530" y="180" text-anchor="middle" fill="var(--ink)">解决:老客户来了</text>
<text x="530" y="198" text-anchor="middle" fill="var(--ink)">不用从头讲</text>
</g>
</svg>
<figcaption>三种记忆的存储、键、更新时机和寿命都不同。混在一起设计,最后就是一个越来越大、谁也说不清里面有什么的"记忆库"。</figcaption>
</figure>

学术上常见的分法是短期记忆(当前上下文)和长期记忆(外部存储),再细一点有语义记忆(事实)、情景记忆(经历)、程序记忆(怎么做事)。这些分法对理解有帮助,但做工程时我更愿意问三个具体问题:存什么、存在哪、什么时候读写。上面那张图就是这三个问题的答案。

## 第一种:工单内的对话状态

LangGraph 的 checkpointer 已经替我们做了大部分事:每个节点执行完,整个状态按 `thread_id` 存一份快照。同一个 `thread_id` 再次 `invoke`,LangGraph 先读出上次的状态,再把新输入合并进去,从 START 重新跑一遍图。

所以多轮对话要做的只有两件事:状态里要有对话记录,每轮把新消息追加进去。

先回答一个设计问题:`thread_id` 用工单号还是客户 ID?我选工单号。一张工单是一件事,有开始有结束,状态的边界很清楚。如果用客户 ID,同一个客户今天问发票、下个月问退款,两件不相干的事挤在一个对话里,前一件的检索结果和调查结论会干扰后一件,对话也会无限变长。跨工单需要记住的东西(这个客户是谁、以前遇到过什么),交给第三种记忆:客户画像。在线聊天类产品有时会用"会话 ID",规则是闲置 30 分钟就开新会话,道理一样:给每段状态一个自然的边界。

```python
# supportpilot/src/supportpilot/agent/state.py
import operator
from typing import Annotated, Literal, TypedDict

from pydantic import BaseModel, Field

Category = Literal["billing", "refund", "invoice", "account", "technical", "plan_change", "api", "other"]


class Ticket(TypedDict):
    id: str
    customer_email: str
    subject: str
    body: str


class SupportState(TypedDict, total=False):
    ticket: Ticket
    turns: Annotated[list[dict], operator.add]      # Day 48:多轮对话 {"role": "customer"|"agent", "content": ...}
    summary: str                                    # Day 48:早期对话的压缩摘要
    summarized_upto: int                            # turns[:summarized_upto] 已经被摘要覆盖
    profile: str                                    # Day 48:客户画像
    customer: dict | None
    triage: dict
    hits: list[dict]
    tool_log: Annotated[list[dict], operator.add]   # 每次工具调用追加一条,不覆盖
    findings: str
    refund_request: dict | None
    draft: str
    review: dict
    revisions: int
    approval: dict | None
    followup: str
    outcome: str            # resolved / waiting_approval / escalated
    handoff_reason: str
    reply: str              # 最终发给客户的文本(引用已渲染成链接)
    cost_cny: Annotated[float, operator.add]


class Triage(BaseModel):
    category: Category = Field(description="工单分类,定义见系统提示")
    needs_account_data: bool = Field(description="是否必须查这个客户的订阅/账单/历史才能回答")
    needs_human: bool = Field(description="是否必须直接转人工:投诉升级、法律威胁、安全事件、明确要求人工")
    urgency: Literal["low", "normal", "high"]
    summary: str = Field(description="一句话复述客户诉求,不超过 40 字")
    search_query: str = Field(description="用来检索帮助中心的查询:保留报错码、产品名词,去掉寒暄和情绪")


class Review(BaseModel):
    passed: bool
    problems: list[str] = Field(default_factory=list, description="不通过时列出具体问题,每条一句话")
```

新增四个字段。`turns` 用 `operator.add` 累加:第一轮的 `load_customer` 把工单正文作为客户的第一条消息放进去;`finalize` 和 `handoff` 把发给客户的回复追加进去;客户追问时,外部用 `graph.invoke({"turns": [{"role": "customer", "content": "..."}]}, cfg)` 再追加一条。

`load_customer` 现在每轮开头都会重置一批"本轮"字段:

```python
    def load_customer(state: SupportState) -> dict:
        text, err = deps.call_tool("get_customer", {"email": state["ticket"]["customer_email"]},
                                   ticket_id=state["ticket"]["id"])
        customer = None if err else json.loads(text)
        profile = deps.profile_for(customer["id"]) if customer else ""
        _emit({"type": "step", "node": "load_customer", "found": customer is not None})
        update = {"customer": customer, "profile": profile, "revisions": 0, "refund_request": None,
                  "approval": None, "followup": "", "review": {}, "findings": ""}
        if not state.get("turns"):  # 第一轮:把工单正文当作客户的第一条消息
            update["turns"] = [{"role": "customer", "content": state["ticket"]["body"]}]
        return update

    def prepare_context(state: SupportState) -> dict:
        before = deps.spent()
        summary, upto = maybe_compress(deps.small_llm, state["turns"], state.get("summary", ""),
                                       state.get("summarized_upto", 0))
        return {"summary": summary, "summarized_upto": upto, "cost_cny": deps.spent() - before}
```

为什么要重置?因为 checkpoint 会把上一轮的所有字段带过来。上一轮质检的 `review`、上一轮查到的 `findings`、上一轮的 `refund_request`,如果不清掉,第二轮的 draft 节点会看到"上一版草稿被质检退回",act 节点的结论会混进旧数据。我第一次写的时候就漏了 `review`,结果客户第二轮问了个很简单的问题,Agent 回复里莫名其妙地在"修正"上一轮的错误。哪些字段跨轮保留(turns、summary、profile、tool_log、cost_cny),哪些每轮重置,要想清楚并写在一处。

给模型看的工单文本也要带上历史:

```python
def _ticket_text(state: SupportState) -> str:
    """把工单 + 对话历史拼成给模型看的文本。早期对话用摘要代替,最新一条客户消息单独标出来。"""
    t = state["ticket"]
    turns = state.get("turns") or [{"role": "customer", "content": t["body"]}]
    upto = state.get("summarized_upto", 0)
    parts = [f"发件邮箱:{t['customer_email']}\n主题:{t['subject']}"]
    if state.get("profile"):
        parts.append(f"客户画像:{state['profile']}")
    if state.get("summary"):
        parts.append(f"早期对话摘要:\n{state['summary']}")
    history = turns[upto:-1]
    if history:
        parts.append(f"对话记录:\n{render_turns(history)}")
    parts.append(f"客户最新消息:{turns[-1]['content']}")
    return "\n\n".join(parts)
```

结构是:基本信息 → 客户画像 → 早期对话摘要 → 最近的对话记录 → 客户最新消息。最新消息单独一行、放在最后、明确标出来,这一点很重要。如果只是把所有轮次平铺,模型有时会去回答第一轮的问题而不是最新的追问。放在末尾也符合"Lost in the Middle"那篇论文的发现:长上下文里,开头和结尾的信息最容易被模型用上,中间的最容易被忽略。

### checkpoint 存进 Postgres

Day 47 用的 `InMemorySaver` 进程一退出就没了。现在换成 Postgres:

```python
# supportpilot/src/supportpilot/memory/checkpoint.py
"""LangGraph 的 checkpoint 存 Postgres:进程重启、审批隔天才点,工单状态都还在。"""

from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import Connection
from psycopg.rows import dict_row

from ..config import get_settings


def make_checkpointer(url: str | None = None) -> PostgresSaver:
    # PostgresSaver 要求 autocommit + dict_row;prepare_threshold=0 避免和连接池/pgbouncer 的预编译语句冲突
    conn = Connection.connect(url or get_settings().database_url, autocommit=True, prepare_threshold=0,
                              row_factory=dict_row)
    saver = PostgresSaver(conn)
    saver.setup()  # 第一次运行时建 checkpoint 相关的表,之后是空操作
    return saver
```

`PostgresSaver` 要求连接是 autocommit 并且返回字典行,`prepare_threshold=0` 关掉 psycopg 的预编译语句,否则以后接 pgbouncer 之类的连接池会报错。`setup()` 第一次运行会建四张表:`checkpoints`、`checkpoint_blobs`、`checkpoint_writes`、`checkpoint_migrations`,建在 public schema 里,和我们的 `biz`、`kb` 分开。

想看存了什么:

```sql
SELECT thread_id, count(*) AS snapshots FROM checkpoints GROUP BY thread_id ORDER BY 2 DESC LIMIT 5;
```

每张工单每跑一个节点存一份快照,一轮对话大概 8 到 10 份。快照里有完整的状态,所以也能"时间旅行":回到任意一个节点之后的状态重新跑。这对排查问题很有用,但也意味着这几张表会长得很快。上线后要定期清理已关闭工单的快照,或者只保留每张工单的最后一份。

## 第二种:对话太长时压缩

```python
# supportpilot/src/supportpilot/memory/compress.py
"""多轮对话的上下文预算。工单一般 2–5 轮,但总有客户来回十几轮,不压缩的话每轮都把全部历史重发一遍。"""

from ..llm import LLMClient

SUMMARY_PROMPT = """把下面这段客服工单的早期对话压缩成要点,给接手的同事看。
必须保留:客户的诉求、已经查到的账单号和金额、已经给出的答复和承诺、还没解决的问题。
用短句列表,不超过 150 字。"""


def estimate_tokens(text: str) -> int:
    """粗估:中文大约 1 个字 0.6–0.7 个 token,英文大约 4 个字符 1 个 token。只用来判断要不要压缩,不用来算钱。"""
    cjk = sum(1 for ch in text if "一" <= ch <= "鿿")
    return int(cjk * 0.7 + (len(text) - cjk) / 4) + 1


def render_turns(turns: list[dict]) -> str:
    who = {"customer": "客户", "agent": "客服"}
    return "\n".join(f"{who[t['role']]}:{t['content']}" for t in turns)


def maybe_compress(llm: LLMClient, turns: list[dict], summary: str, summarized_upto: int,
                   budget: int = 1200, keep_last: int = 4) -> tuple[str, int]:
    """如果"摘要 + 未摘要部分"超过预算,就把除了最后 keep_last 轮之外的内容并入摘要。
    返回新的 (summary, summarized_upto):turns[:summarized_upto] 已经被摘要覆盖。"""
    pending = turns[summarized_upto:]
    if estimate_tokens(summary + render_turns(pending)) <= budget or len(pending) <= keep_last:
        return summary, summarized_upto
    to_fold = pending[:-keep_last]
    text = (f"已有摘要:\n{summary}\n\n" if summary else "") + "新增对话:\n" + render_turns(to_fold)
    res = llm.chat([{"role": "system", "content": SUMMARY_PROMPT}, {"role": "user", "content": text}], temperature=0)
    return res.content.strip(), summarized_upto + len(to_fold)
```

工单对话一般两三轮,但总有客户来回十几轮。每一轮都会把全部历史重新发给模型好几次(分诊、调查、起草、质检各一次),历史越长,每轮越贵、越慢,模型也越容易被早期内容带偏。Anthropic 在《Effective context engineering for AI agents》里把这种现象叫上下文腐烂(context rot):上下文越长,模型准确回忆其中信息的能力越差。

压缩策略很朴素:

- 估算"摘要 + 还没被摘要的轮次"的 token 数,不超过预算(默认 1200)就什么都不做。
- 超了,把除最后 4 轮以外的部分交给小模型压成要点,并入已有摘要,`summarized_upto` 往后挪。
- 最后 4 轮永远保留原文,因为客户最近说的话措辞很重要,压缩会丢细节。

摘要提示词里列了"必须保留"的四类信息:诉求、查到的账单号和金额、已给出的答复和承诺、未解决的问题。尤其是"已给出的承诺",如果第三轮客服说过"会在 3 个工作日内回复",压缩后丢了这句,第十轮 Agent 可能会给出矛盾的承诺。

`estimate_tokens` 是粗估:中文按 1 个字约 0.7 个 token,其他字符 4 个约 1 个 token。只用来判断要不要压缩,差个 20% 无所谓;算钱用的是接口返回的真实 usage。要精确计数可以用厂商提供的 tokenizer,但多一个依赖,为了一个阈值判断不值得。

压缩节点 `prepare_context` 放在 `load_customer` 之后、`classify` 之前,这样后面所有节点看到的都是压缩过的上下文。

## 第三种:跨工单的客户画像

```python
# supportpilot/src/supportpilot/memory/profile.py
"""客户画像:把这个客户的订阅和历史工单压成一段 100 字以内的话,放进上下文。
只在历史工单数变了的时候重建,平时直接读表,不花钱。"""

import json

from ..llm import LLMClient
from ..tools import business as biz

PROFILE_PROMPT = """根据客户的订阅信息和历史工单,写一段不超过 100 字的客户画像,给客服同事看。
只写对处理新工单有用的事实:用的什么套餐、是否 VIP、反复出现过什么问题、之前答应过客户什么。
不要评价客户性格,不要写没有依据的推测。没有历史工单就只写订阅情况。"""


def get_or_build_profile(conn, llm: LLMClient, customer_id: str) -> str:
    n = conn.execute("SELECT count(*) AS n FROM biz.tickets WHERE customer_id = %s AND status = 'resolved'",
                     (customer_id,)).fetchone()["n"]
    row = conn.execute("SELECT summary, source_ticket_count FROM biz.customer_profiles WHERE customer_id = %s",
                       (customer_id,)).fetchone()
    if row and row["source_ticket_count"] == n:
        return row["summary"]
    facts = {"subscriptions": biz.list_subscriptions(conn, customer_id),
             "past_tickets": biz.search_past_tickets(conn, customer_id, limit=10)}
    res = llm.chat([{"role": "system", "content": PROFILE_PROMPT},
                    {"role": "user", "content": json.dumps(facts, ensure_ascii=False, default=str)}], temperature=0)
    summary = res.content.strip()[:300]
    conn.execute(
        "INSERT INTO biz.customer_profiles (customer_id, summary, source_ticket_count) VALUES (%s, %s, %s) "
        "ON CONFLICT (customer_id) DO UPDATE SET summary = EXCLUDED.summary, "
        "source_ticket_count = EXCLUDED.source_ticket_count, updated_at = now()",
        (customer_id, summary, n))
    return summary
```

客户画像是一段不超过 100 字的话,比如(这是按吴刚的数据,模型大致会写出这样的东西):

```text
专业版年付 VIP 客户。2026 年 4 月、7 月、9 月三次因银行授权 90 天到期导致招商银行流水同步失败(E3001),
均通过重新授权解决。客户希望授权到期前能收到提醒。
```

有了这段话,吴刚第四次来问,Agent 的回复就不会再从"请检查网络"开始,而是会说"您的银行授权又到 90 天了,还是重新授权就能恢复。到期提醒这个需求我们已经记录"。

几个设计决定:

**什么时候重建?** 只在这个客户已解决的工单数变了的时候。平时直接读表,零成本。另一种做法是每张工单结束时更新,但那样每张工单都要多一次模型调用,而且大部分工单不会让画像有实质变化。

**画像里写什么?** 提示词限制得很严:只写对处理新工单有用的事实,不评价客户性格,不写推测。"该客户脾气暴躁"这种话不该出现,一是对处理工单没帮助,二是如果客户依法要求查看自己的数据,这种描述会很难看。

**为什么不用 LangGraph 自带的 Store?** LangGraph 有一个跨 thread 的长期记忆存储(Store),可以按命名空间存任意 JSON,还支持语义检索。它很适合"Agent 自己决定记什么"的场景。我们的画像是结构化的、按客户 ID 一对一的、由固定规则触发更新的,放在业务库的一张表里更直接,和客户数据一起备份、一起删除。如果以后要做"Agent 在对话中主动记下客户偏好",再引入 Store 或 mem0 这类专门的记忆库。

画像通过 `Deps.profile_for` 注入,`load_customer` 查到客户后调用。依赖注入的好处又体现出来了:测试里直接塞一个返回固定字符串的 lambda。

```python
# supportpilot/src/supportpilot/agent/deps.py
"""节点需要的外部依赖都装在 Deps 里。生产环境用 from_conn() 组装;测试时换成假的,不连数据库不花钱。"""

from collections.abc import Callable
from dataclasses import dataclass
from functools import partial
from typing import Any

from ..config import Settings, get_settings
from ..kb.retriever import HybridRetriever
from ..llm import LLMClient
from ..memory.profile import get_or_build_profile
from ..tools import business as biz
from ..tools.registry import call_tool


@dataclass
class Deps:
    llm: LLMClient                 # 起草用的主力模型
    small_llm: LLMClient           # 分类、质检用的便宜模型(Day 52 才真的分开,现在可以是同一个)
    retriever: Any                 # 有 search(query, k) -> list[Hit] 就行
    call_tool: Callable[..., tuple[str, bool]]   # (name, arguments, ticket_id=...) -> (text, is_error)
    escalate: Callable[[str, str], Any]
    decide_refund: Callable[[str, bool, str, str], dict]
    finish_ticket: Callable[[str, str, str | None, str], None]
    settings: Settings
    profile_for: Callable[[str], str] = lambda customer_id: ""   # Day 48:客户画像

    @classmethod
    def from_conn(cls, conn, settings: Settings | None = None) -> "Deps":
        s = settings or get_settings()
        llm = LLMClient(s)
        small = LLMClient(s, model=s.llm_small_model) if s.llm_small_model else llm
        return cls(llm=llm, small_llm=small, retriever=HybridRetriever(conn, settings=s),
                   call_tool=partial(call_tool, conn),
                   escalate=partial(biz.escalate_to_human, conn),
                   decide_refund=partial(biz.decide_refund, conn),
                   finish_ticket=partial(biz.finish_ticket, conn), settings=s,
                   profile_for=partial(get_or_build_profile, conn, small))

    def spent(self) -> float:
        """两个客户端累计花了多少钱;同一个对象只算一次。"""
        total = self.llm.ledger.cost_cny(self.settings)
        if self.small_llm is not self.llm:
            total += self.small_llm.ledger.cost_cny(self.settings)
        return total
```

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1k8L3zxEDz&autoplay=0&high_quality=1" title="基于【LangGraph】构建长期记忆Agent,吴恩达联手LangChain创始人!附课件代码 DeepLearning.AI" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达大模型 · 基于 LangGraph 构建长期记忆 Agent(DeepLearning.AI 课程中文字幕版,7 集)· 讲语义、情景、程序三类记忆和 LangGraph Store,看完能理解我们为什么只用了其中最简单的一种。</figcaption>
</figure>

## 图的改动

```python
# supportpilot/src/supportpilot/agent/graph.py
from langgraph.graph import END, START, StateGraph

from .deps import Deps
from .nodes import make_nodes
from .state import SupportState


def after_classify(state: SupportState) -> str:
    return "handoff" if state["triage"]["needs_human"] else "retrieve"


def after_retrieve(state: SupportState) -> str:
    if state["triage"]["needs_account_data"] and state.get("customer"):
        return "act"
    return "draft"


def after_check(deps: Deps):
    def route(state: SupportState) -> str:
        if state["review"]["passed"]:
            rr = state.get("refund_request")
            return "approval" if rr and rr.get("status") == "pending" else "finalize"
        if state.get("revisions", 0) <= deps.settings.max_revisions:
            return "draft"
        return "handoff"
    return route


def build_graph(deps: Deps, checkpointer=None):
    n = make_nodes(deps)
    g = StateGraph(SupportState)
    for name, fn in n.items():
        g.add_node(name, fn)
    g.add_edge(START, "load_customer")
    g.add_edge("load_customer", "prepare_context")
    g.add_edge("prepare_context", "classify")
    g.add_conditional_edges("classify", after_classify, ["retrieve", "handoff"])
    g.add_conditional_edges("retrieve", after_retrieve, ["act", "draft"])
    g.add_edge("act", "draft")
    g.add_edge("draft", "check")
    g.add_conditional_edges("check", after_check(deps), ["approval", "finalize", "draft", "handoff"])
    g.add_edge("approval", "finalize")
    g.add_edge("finalize", END)
    g.add_edge("handoff", END)
    return g.compile(checkpointer=checkpointer)
```

只多了一个节点和一条边:`load_customer → prepare_context → classify`。`finalize` 和 `handoff` 的返回值里加上 `"turns": [{"role": "agent", "content": reply}]`,把回复追加进对话记录。

跑一遍多轮对话:

```python
# supportpilot/scripts/chat_ticket.py
"""终端里和一张工单多轮对话,状态存 Postgres。Ctrl+C 退出后,用 --ticket 接着聊,前面的对话都还在。

uv run python scripts/chat_ticket.py wugang@example.com "银行流水又同步失败了"
uv run python scripts/chat_ticket.py --ticket T000153
"""

import argparse

from langgraph.types import Command

from supportpilot.agent.deps import Deps
from supportpilot.agent.graph import build_graph
from supportpilot.db import connect
from supportpilot.memory.checkpoint import make_checkpointer
from supportpilot.tools import business as biz


def run(graph, payload, cfg) -> None:
    for mode, chunk in graph.stream(payload, cfg, stream_mode=["updates", "custom"]):
        if mode == "custom" and chunk["type"] == "token":
            print(chunk["text"], end="", flush=True)
        elif mode == "custom" and chunk["type"] == "tool":
            print(f"\n  🔧 {chunk['name']}({chunk['args']})")
    while graph.get_state(cfg).next:
        ok = input("\n  [审批] 通过这笔退款吗?[y/N] ").strip().lower() == "y"
        graph.invoke(Command(resume={"approved": ok, "approver": "cli"}), cfg)
    v = graph.get_state(cfg).values
    print(f"\n\n--- 发给客户 ({v.get('outcome')}) ---\n{v.get('reply')}\n")
    print(f"[记忆] 共 {len(v.get('turns', []))} 轮,已摘要到第 {v.get('summarized_upto', 0)} 轮;"
          f"画像:{(v.get('profile') or '无')[:60]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("email", nargs="?")
    ap.add_argument("message", nargs="?")
    ap.add_argument("--ticket")
    args = ap.parse_args()

    conn = connect()
    graph = build_graph(Deps.from_conn(conn), checkpointer=make_checkpointer())
    if args.ticket:
        tid = args.ticket
        if not graph.get_state({"configurable": {"thread_id": tid}}).values:
            raise SystemExit(f"工单 {tid} 没有保存的对话")
    else:
        tid = biz.create_ticket(conn, args.email, args.message[:30], args.message)
        run(graph, {"ticket": {"id": tid, "customer_email": args.email, "subject": args.message[:30],
                               "body": args.message}}, {"configurable": {"thread_id": tid}})
    cfg = {"configurable": {"thread_id": tid}}
    print(f"工单 {tid},输入追问(Ctrl+C 退出):")
    while True:
        try:
            msg = input("客户> ").strip()
        except (KeyboardInterrupt, EOFError):
            print(f"\n下次接着聊:uv run python scripts/chat_ticket.py --ticket {tid}")
            return
        if msg:
            run(graph, {"turns": [{"role": "customer", "content": msg}]}, cfg)


if __name__ == "__main__":
    main()
```

```bash
uv run python scripts/chat_ticket.py wugang@example.com "银行流水又同步失败了,提示E3001"
# Agent 回复……
客户> 重新授权了还是不行
# Agent 回复,应该能接上前文
客户> ^C
下次接着聊:uv run python scripts/chat_ticket.py --ticket T000153

uv run python scripts/chat_ticket.py --ticket T000153
客户> 还在吗?刚才说到哪了
```

最后一步最能说明问题:进程已经退出了,重新启动后,Agent 依然知道这张工单前面聊过什么。

## 测试

```python
# supportpilot/tests/test_memory.py
from fakes import FakeLLM, FakeTools, make_deps
from langgraph.checkpoint.memory import InMemorySaver

from supportpilot.agent.graph import build_graph
from supportpilot.memory.compress import estimate_tokens, maybe_compress

TRIAGE = {"category": "technical", "needs_account_data": False, "needs_human": False, "urgency": "normal",
          "summary": "银行同步失败", "search_query": "E3001 银行流水同步失败"}
TICKET = {"id": "T000901", "customer_email": "wugang@example.com", "subject": "银行流水又不同步了",
          "body": "提示 E3001"}
DRAFT = "您好,E3001 一般是银行授权过期,请重新授权 [KB-refund-002]。"


def test_follow_up_keeps_history_on_same_thread():
    tools = FakeTools(customer={"id": "C0010"})
    deps = make_deps(FakeLLM(TRIAGE, [], DRAFT), tools)
    deps.profile_for = lambda cid: "专业版年付 VIP,银行同步 E3001 已出现 3 次"
    graph = build_graph(deps, checkpointer=InMemorySaver())
    cfg = {"configurable": {"thread_id": TICKET["id"]}}

    first = graph.invoke({"ticket": TICKET}, cfg)
    assert [t["role"] for t in first["turns"]] == ["customer", "agent"]

    second = graph.invoke({"turns": [{"role": "customer", "content": "重新授权了还是不行"}]}, cfg)
    assert [t["role"] for t in second["turns"]] == ["customer", "agent", "customer", "agent"]
    assert second["profile"].startswith("专业版")


def test_compress_only_when_over_budget():
    llm = FakeLLM(TRIAGE, [], DRAFT)
    short = [{"role": "customer", "content": "你好"}] * 6
    assert maybe_compress(llm, short, "", 0) == ("", 0)          # 没超预算,不动
    long = [{"role": "customer", "content": "我的账单有问题" * 80}] * 8
    summary, upto = maybe_compress(llm, long, "", 0, budget=500, keep_last=4)
    assert upto == 4 and summary                                  # 前 4 轮被并进摘要,后 4 轮原样保留
    assert llm.ledger.calls == 1


def test_estimate_tokens_rough():
    assert 60 <= estimate_tokens("中" * 100) <= 80
```

第一个测试验证同一个 thread 上两次 invoke 后,对话记录是"客户、客服、客户、客服"四轮,画像也被带上了。第二个测试验证压缩只在超预算时发生,并且正好把前 4 轮并入摘要、后 4 轮保留。第三个测试确认粗估的 token 数在合理范围。这三个测试都不需要数据库和 API,我本机跑过,通过。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/JTL0yp85FsE" title="Memory for agents (conceptual video)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Memory for agents (conceptual video) · 概念讲解,把短期、长期、语义、情景、程序记忆放在一张图里讲清楚,适合复习。</figcaption>
</figure>

## 记忆带来的新问题

加了记忆,系统更好用了,但也多了几类之前没有的问题,提前知道:

**记错的东西会一直错下去。** 如果画像里写错了一句(比如模型把"专业版"写成了"标准版"),之后每张工单都会被误导。所以画像只从结构化数据和已解决工单的摘要生成,不从对话原文里自由提取;评测集里要有专门考记忆的用例(Day 50 的 `repeat_bank_sync` 场景)。

**隐私和删除。** 客户要求删除数据时,checkpoint 表、画像表、工单表都要删。设计时就要知道每种记忆存在哪,否则真到要删的时候会漏。

**摘要会丢信息。** 压缩本质上是有损的。被压掉的细节如果后来又被客户提起("我第二轮说的那个账单号"),Agent 可能接不上。保留最近几轮原文、摘要提示词列出必须保留的内容,能缓解但不能根治。真遇到了,Agent 应该坦白地请客户再说一遍,而不是编一个。

**成本。** 每轮都多带画像和摘要,输入 token 会多出一两百。和它带来的效果比通常值得,但要在 Day 52 的成本看板上能看到。

## 动手练习

**步骤 1:放文件。** 新增 `memory/` 下的 `profile.py`、`compress.py`、`checkpoint.py`;更新 `agent/state.py`、`agent/deps.py`、`agent/graph.py`;`agent/nodes.py` 里替换 `_ticket_text`、`load_customer`,新增 `prepare_context`,`finalize` 和 `handoff` 的返回值加上 `turns`,`make_nodes` 返回的字典里加上 `prepare_context`;新增 `scripts/chat_ticket.py` 和 `tests/test_memory.py`。

**步骤 2:跑单测。** `make test`。Day 47 的测试也要继续全过,如果 `test_graph_smoke` 挂了,多半是 `load_customer` 的返回值或 `_ticket_text` 改坏了。

**步骤 3:多轮对话。** 用 `chat_ticket.py` 和吴刚聊三轮以上,然后 Ctrl+C 退出,用 `--ticket` 接着聊,确认前文还在。去数据库看一眼:

```bash
docker compose exec db psql -U supportpilot -c "SELECT * FROM biz.customer_profiles;"
docker compose exec db psql -U supportpilot -c "SELECT thread_id, count(*) FROM checkpoints GROUP BY 1;"
```

**步骤 4:触发压缩。** 把 `maybe_compress` 的 `budget` 临时改成 200,和任意客户聊 6 轮以上,观察 `chat_ticket.py` 最后打印的"已摘要到第几轮"。看看摘要里有没有丢掉你说过的账单号。改回 1200。

**步骤 5(选做):画像的失效策略。** 现在画像只在已解决工单数变化时重建。想一个它会过时的场景(提示:客户升级了套餐,但没有提工单),修改 `get_or_build_profile` 的判断条件覆盖这个场景,并写一个测试。

**验收标准:** 单测全绿;同一工单第二轮回复能引用第一轮的内容;进程重启后能继续对话;吴刚的画像里有 E3001 的历史;budget 调小后能看到压缩发生,且最近 4 轮原文保留。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| thread_id | LangGraph 里区分不同会话的键,我们用工单号 |
| checkpoint 快照 | 每个节点执行完后保存的完整状态 |
| 时间旅行 | 从任意历史快照恢复并重新执行 |
| 上下文腐烂 | 上下文越长,模型准确使用其中信息的能力越差 |
| Lost in the Middle | 长上下文中间部分的信息最容易被模型忽略的现象 |
| 对话摘要 | 把早期对话压成要点,替代原文放进上下文 |
| 客户画像 | 跨工单的长期记忆,一段描述客户情况的文字 |
| LangGraph Store | LangGraph 提供的跨会话长期记忆存储 |
| 失效策略 | 决定缓存或记忆什么时候需要重建的规则 |

## 常见误区

**多轮时不重置"本轮"字段。** checkpoint 会把上一轮所有字段带过来,质检意见、调查结论、退款申请都会污染下一轮。

**把所有历史原样塞进上下文。** 一开始没问题,聊到第十轮就又贵又慢,还会答非所问。设预算,超了就压缩。

**画像什么都记。** 记了"客户态度很差"这种主观评价,对处理问题没帮助,还有合规风险。只记对处理工单有用的事实。

**每张工单结束都更新画像。** 大部分工单不改变画像,却每次都花一次调用。用一个便宜的条件(比如历史工单数)判断是否需要重建。

**以为 checkpoint 存了就万事大吉。** 快照表会快速增长,要有清理策略;客户要求删除数据时要记得删这里。

**最新消息淹没在历史里。** 只把所有轮次平铺,模型可能去回答早期的问题。最新一条单独标出、放在最后。

## 学习资料

### 文档与文章

- [Anthropic · Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):上下文腐烂、压缩(compaction)、结构化笔记、子 agent 隔离上下文,今天的压缩思路出自这里,40 分钟。
- [LangGraph Persistence](https://docs.langchain.com/oss/python/langgraph/persistence):thread、checkpoint、时间旅行、PostgresSaver,30 分钟。
- [LangGraph Memory 概念](https://docs.langchain.com/oss/python/langgraph/memory) 和 [添加记忆](https://docs.langchain.com/oss/python/langgraph/add-memory):短期记忆的裁剪和摘要、长期记忆的 Store,30 分钟。
- [Lost in the Middle: How Language Models Use Long Contexts](https://arxiv.org/abs/2307.03172):为什么最新消息要放在最后,看图 1 和结论就够,15 分钟。
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560):把上下文当内存、外部存储当磁盘的思路,扩展视野,读摘要和第 2 节,30 分钟。
- [DeepLearning.AI · Long-Term Agentic Memory with LangGraph](https://www.deeplearning.ai/short-courses/long-term-agentic-memory-with-langgraph/):上面 B 站那个视频的官方版,有配套代码。

### B 站视频

- 上面嵌的《基于 LangGraph 构建长期记忆 Agent》。
- 唐国梁Tommy《Claude Code 的记忆机制到底强在哪?六维记忆体系深度解析》(BV1z6SXBzEYh,24 分钟):从一个真实的 coding agent 看记忆怎么分层、什么时候压缩,和我们的设计对照着看,下面嵌了。
- 日新月异max《最近很火的 Agent Memory 到底是什么?【论文精读】》(BV1cezTBDEgQ,33 分钟):精读一篇 Agent 记忆综述,想系统了解分类可以看。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1z6SXBzEYh&autoplay=0&high_quality=1" title="Claude Code 的记忆机制到底强在哪?六维记忆体系深度解析,一节视频讲透指令记忆、长期记忆、Session Memory 与 AutoDream" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · Claude Code 的记忆机制到底强在哪?· 重点看会话记忆和上下文压缩的部分,和我们的 prepare_context 是同一类问题。</figcaption>
</figure>

### 其他经典视频

- 上面嵌的 LangChain《Memory for agents (conceptual video)》。
- LangChain《Build Agents that Never Forget: LangMem Semantic Memory Tutorial》(YouTube,3Yp-hIEcWXk):如果想让 Agent 在对话中自己提取和记住客户偏好,看这个,作为扩展。

### 书籍

- Chip Huyen《AI Engineering》第 6 章最后的 Memory 一节:内部知识、短期记忆、长期记忆的划分,以及记忆管理的几种策略(FIFO、摘要、反思),约 40 分钟。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》第 7 章的对话记忆部分:conversation buffer、windowed buffer、summary 三种方式,图示清楚,30 分钟。

### 开源项目与代码

- [mem0ai/mem0](https://github.com/mem0ai/mem0):专门的 Agent 记忆层,看它怎么从对话里抽取、去重和更新记忆,对比我们"只从结构化数据生成画像"的保守做法。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph):`libs/checkpoint-postgres` 目录,看 PostgresSaver 的表结构。

## 自测

**1. 客户第二轮追问时,外部应该怎么调用图?为什么不需要传 ticket?**

<details><summary>答案</summary>

用同一个 thread_id 调 `graph.invoke({"turns": [{"role": "customer", "content": "追问内容"}]}, cfg)`。checkpointer 会读出上一轮的完整状态(包括 ticket),新输入里的 turns 通过 `operator.add` 追加到已有对话后面,然后从 START 重新跑图。

</details>

**2. `load_customer` 为什么每轮都要把 `review`、`findings`、`refund_request` 等字段重置?**

<details><summary>答案</summary>

checkpoint 会把上一轮所有字段带到这一轮。不重置的话,上一轮的质检意见会被当成本轮草稿的退回原因,上一轮的调查结论会混进本轮,上一轮的退款申请会让路由错误地走向审批。这些是"本轮"字段,对话记录、摘要、画像、成本才是要跨轮保留的。

</details>

**3. 压缩时为什么保留最后 4 轮原文,而不是全部压缩?**

<details><summary>答案</summary>

最近几轮的具体措辞对回答当前问题最重要(客户刚说的账单号、刚提出的追问),压缩是有损的会丢细节;早期轮次的信息通常只需要要点。保留最近原文、压缩早期内容,在成本和准确性之间折中。

</details>

**4. 客户画像为什么不在每张工单结束时更新?**

<details><summary>答案</summary>

大部分工单不会让画像有实质变化,每次都更新会给每张工单多加一次模型调用。用"已解决工单数是否变化"这种廉价条件判断,只在需要时重建,平时直接读表。代价是某些不经过工单的变化(比如客户自己升级了套餐)不会及时反映,可以再加别的失效条件。

</details>

**5. 「面试题」你的 Agent 是怎么管理上下文的?对话很长了怎么办?**

<details><summary>答案</summary>

分三层。工单内的对话状态由 LangGraph checkpoint 按工单号存进 Postgres,支持多轮和进程重启后恢复,每轮开头重置本轮字段;对话超过 token 预算时,由小模型把早期轮次压成要点摘要(必须保留诉求、账单号金额、已作的承诺、未解决问题),最近 4 轮保留原文;跨工单的客户画像从订阅和历史工单生成,只在历史变化时重建。拼上下文时按"基本信息、画像、摘要、近期对话、最新消息"的顺序,最新消息放最后单独标出,因为长上下文中间的信息最容易被忽略。

</details>

**6. 「面试题」长期记忆有哪些风险?你怎么控制?**

<details><summary>答案</summary>

一是记错了会持续误导,所以画像只从结构化数据和已解决工单生成,不从对话里自由提取,评测集里有专门考记忆的用例;二是隐私和删除,每种记忆存在哪要清楚,客户要求删除时 checkpoint、画像、工单都要删;三是摘要有损,保留近期原文并要求摘要保留关键信息,接不上时让 Agent 请客户重述而不是编造;四是成本和上下文膨胀,画像限制在 100 字以内,压缩有预算。

</details>

## 明天预告

Day 49 · 界面与流式体验:Streamlit 前端、展示工具调用与审批。用 FastAPI 把工作流包成 HTTP 接口,用 SSE 把每一步、每个工具调用、每个字推给前端;用 Streamlit 做两个页面:客户视角能看着 Agent 一步步干活、能追问,客服工作台能看到待审批的退款并一键审批,审批完工作流自动接着跑完。
