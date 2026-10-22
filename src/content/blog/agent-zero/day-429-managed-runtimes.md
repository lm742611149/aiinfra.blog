---
title: 'Day 429 · 托管 Agent 运行时:自建还是租'
description: '2026 年各家云厂商开始出租整套 Agent 运行时:循环、沙箱、会话历史都替你跑。今天先把一个能上线的 Agent 拆成几层,看清 Claude Managed Agents、Bedrock AgentCore 和国内几家各接走了哪几层;再用实测的 token 数算一笔月账,发现运行时那层通常不是大头;最后把同一个查账问题分别写成自建版(实跑)和托管版(custom tool 桥接),落成一张能拿去和老板讨论的决策表。'
pubDate: 2026-10-22
regime: none
tags: ['managed-agents', 'agentcore', 'deployment', 'build-vs-buy', 'cost', 'agent-zero']
series: 'agent-zero'
day: 429
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 428](/blog/agent-zero/day-428-local-models/) 我们把模型拿到自己电脑上跑:用 Ollama 跑起 Qwen3 0.6B,只改环境变量就让代码改调本地模型;又用一个算式说明,对大多数中小应用,自己租 GPU 部署模型并不省钱,自部署的真正理由是数据不能出去或者要用微调模型。

那一课是在问「模型这一层要不要自己扛」。今天问的是它上面那一层:**Agent 的循环、工具执行环境、会话存储**,要不要自己扛。上一周我们自己写 Dockerfile、配 compose、租服务器、接 CI/CD,一路都在自建。2026 年各家云厂商开始卖另一种选择:这些都替你跑,你只交一份配置。今天把它看清楚。

## 今天要解决的问题

学完今天你应该能:

1. 把一个能上线的 Agent 拆成几层,说清楚「托管模型 API」和「托管 Agent 运行时」的区别,以及几类托管服务各接走了哪几层。
2. 用一段脚本算出「运行时这一层」和「模型 token 这一层」每月各多少钱,知道哪种负载会让运行时变贵。
3. 读懂托管运行时里 **custom tool** 的事件流:模型在厂商那边决定调哪个工具,查询在你自己的进程里执行。能和自建版的工具循环一一对上。
4. 用一张决策表回答「这个项目自建还是租」,而不是说「看情况」。

今天只有两个新概念:**托管运行时托管了什么**,和**自建还是租的判断方法**。

预计用时 2.5–3 小时。没有 Anthropic 的 API key 也能学完:托管版的代码我也没有连真实服务跑过(原因写在代码后面),只做了类型检查,其余脚本全部实跑。前置:[Day 165](/blog/agent-zero/day-165-agent-what/)–[Day 170](/blog/agent-zero/day-170-agent-full/) 的 Agent 循环、[Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 的 tool 消息一来一回、[Day 267](/blog/agent-zero/day-267-subagent-isolation/) 第一次提到的 harness、[Day 415](/blog/agent-zero/day-415-sandbox/) 的沙箱、上一周的部署。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `self_loop.py` 的循环部分和决策表默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 托管运行时到底托管了什么

先回忆 [Day 166](/blog/agent-zero/day-166-agent-min/) 那个 25 行的最小 Agent 循环:调模型,模型说要调工具,我们执行工具,把结果塞回 messages,再调模型,直到它不再要工具。25 行就能跑。

可一旦要给很多人用,这 25 行下面会长出一堆东西,这半年我们一层层都碰过:

- 工具要执行代码时,得有个**沙箱**隔离起来(Day 415);
- 会话历史要**存起来**,用户刷新页面、进程重启都能接着聊([Day 385](/blog/agent-zero/day-385-session-mgmt/) 的会话管理);
- 跑到一半崩了要能**接着跑**([Day 393](/blog/agent-zero/day-393-resume/) 的断点续跑);
- 上下文快满了要**压缩**;
- 每一步要留 **trace**([Day 365](/blog/agent-zero/day-365-langfuse/) 接的 Langfuse);
- 工具要用的**密钥**不能让模型看到,谁能调这个 Agent 要**鉴权**。

这一整套让 Agent 跑起来的东西,统称 **harness**(本义是马具,套在马身上让它能拉车的那一身装备)。Day 267 第一次提到这个词,进阶篇 [Day 520](/blog/agent-zero/day-520-harness-parts/) 会专门拆开讲。

**托管 Agent 运行时**,就是厂商把 harness 的一部分或全部打包出租。这里要先分清两个词,很多人会混:

- **托管模型 API**:你调 DeepSeek、调 Claude 的 Messages API,都属于这一种。模型在厂商那边,但**循环在你的代码里**,每一轮都是你把 messages 发过去、拿回来、执行工具、再发过去。我们这门课到今天写的全是这种。
- **托管运行时**:连循环一起托管。你发一句用户消息过去,厂商那边自己调模型、调工具、写文件,跑十几轮,最后告诉你「我做完了」,中间你只是看着它推过来的事件。

用前端的话打个比方:托管模型 API 像你调一个后端接口,页面逻辑还是你写的;托管运行时像你把整个页面交给一个低代码平台,你只配置,它负责跑。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="自建和托管运行时的分层对比">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <text x="120" y="24" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">自建(上一周的做法)</text>
  <text x="440" y="24" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">托管整个 harness</text>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="30" y="40" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="120" y="60" text-anchor="middle" fill="var(--ink)">业务工具 / 业务库</text>
    <rect x="30" y="76" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="120" y="96" text-anchor="middle" fill="var(--ink)">Agent 循环(你写的)</text>
    <rect x="30" y="112" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="120" y="132" text-anchor="middle" fill="var(--ink)">上下文压缩 / 缓存</text>
    <rect x="30" y="148" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="120" y="168" text-anchor="middle" fill="var(--ink)">会话存储 / 恢复</text>
    <rect x="30" y="184" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="120" y="204" text-anchor="middle" fill="var(--ink)">代码沙箱</text>
    <rect x="30" y="220" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="120" y="240" text-anchor="middle" fill="var(--ink)">trace / 鉴权 / 密钥</text>
    <rect x="350" y="40" width="180" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="440" y="60" text-anchor="middle" fill="var(--ink)">业务工具 / 业务库</text>
    <rect x="350" y="76" width="180" height="174" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="440" y="110" text-anchor="middle" fill="var(--ink)">循环</text>
    <text x="440" y="134" text-anchor="middle" fill="var(--ink)">压缩 / 缓存</text>
    <text x="440" y="158" text-anchor="middle" fill="var(--ink)">会话 / 恢复</text>
    <text x="440" y="182" text-anchor="middle" fill="var(--ink)">沙箱</text>
    <text x="440" y="206" text-anchor="middle" fill="var(--ink)">trace / 密钥</text>
    <text x="440" y="236" text-anchor="middle" fill="var(--ink-soft)">厂商按配置运行</text>
    <line x1="540" y1="55" x2="576" y2="55" stroke="var(--rule)"/>
    <text x="582" y="59" fill="var(--ink-soft)">仍是你的</text>
    <line x1="540" y1="160" x2="576" y2="160" stroke="var(--rule)"/>
    <text x="582" y="164" fill="var(--ink-soft)">租来的</text>
  </g>
  <text x="320" y="282" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">琥珀色是你自己维护的部分,蓝色是交给厂商的部分</text>
</svg>
<figcaption>自建时六层都归你;托管整个 harness 时,中间那一大块交给厂商,业务工具和业务数据一般还留在你这边,通过 custom tool 或 MCP 接回去。</figcaption>
</figure>

注意右边最上面那块还是琥珀色。**托管运行时不替你写业务工具,也不替你做评测**。查发票的函数、退款的规则、[Day 341](/blog/agent-zero/day-341-why-evals/) 起那一整套评测,换到托管运行时上一样要做。而且因为循环不在你手里,有些测试反而更难做,后面会讲。

## 2026 年 10 月,几家都在卖什么

下面是我 2026 年 10 月查官方文档和定价页整理的。这些产品大多还在 beta 或预览,半年后很可能变样,用之前回到链接里再核一遍。

**Claude Managed Agents**(Anthropic,beta)。[官方概览](https://platform.claude.com/docs/en/managed-agents/overview)里的核心概念有四个:**Agent**(模型、系统提示词、工具、MCP server、skills 的一份配置)、**Environment**(会话跑在哪:Anthropic 托管的云沙箱,或者你自己基础设施上的自托管沙箱)、**Session**(一次运行)、**Events**(你和 Agent 之间来回的消息)。内置了 bash、文件读写、网页抓取和搜索等工具,都在沙箱里执行;你自己的工具用 custom tool 声明。所有请求要带 `managed-agents-2026-04-01` 这个 beta 头,SDK 会自动加。[定价页](https://platform.claude.com/docs/en/about-claude/pricing)写的计费是两部分:token 按正常模型价,外加会话运行时**每小时 0.08 美元,只在会话处于 running 状态时按毫秒计**,等你下一条消息、等工具确认的 idle 时间不算。还有一条很重要的限制,概览里原话是它「目前不符合零数据保留(ZDR)和 HIPAA BAA 的条件」,因为会话历史和沙箱状态都存在服务端。

**Amazon Bedrock AgentCore**(AWS)。它拆得最细:Runtime(每个会话一个隔离的 microVM,LangGraph、Strands 之类框架写的 Agent 都能放进去)、Harness(托管的循环)、Gateway(把现有 API 包成 MCP 工具)、Memory、Identity、Code Interpreter、Browser、Observability 等十几个服务,可以只用其中几个。[定价页](https://aws.amazon.com/bedrock/agentcore/pricing/)上 Runtime v1 是每 vCPU 小时 0.0895 美元、每 GB 小时 0.00945 美元;页面上写着「等 LLM 响应、等工具或数据库时 CPU 降到零」,而 v1 的内存按会话一直算,v2 才会在会话过程中回收内存。

**Gemini Managed Agents**(Google,预览)。一次 Interactions API 调用开一个 Google 托管的 Linux 沙箱,在里面跑一个预置的通用 agent,[快速入门](https://ai.google.dev/gemini-api/docs/managed-agents-quickstart)里有完整示例。Google Cloud 那边另有一个 Vertex AI Agent Engine,是「部署你自己写好的 Agent」,和前者不是一个产品。

**国内**。阿里云函数计算有 [AgentRun](https://cn.aliyun.com/product/news/28237)(2025 年 12 月发布,提供代码解释器、浏览器等几种沙箱),火山引擎有 [AgentKit](https://www.volcengine.com/product/agentkit),腾讯云有 Agent Runtime([计费说明](https://cloud.tencent.com/document/product/1814/133249)写的是按量后付费、按秒计 CPU 和内存)。这三家我都只读了文档和官方文章,没有实际开通。

与其按厂商记,不如按「托管到哪一层」记:

| 托管程度 | 你交出去什么 | 代表 | 适合 |
| --- | --- | --- | --- |
| 只托管沙箱 | 循环还是你自己的,要跑代码时调沙箱 API | E2B、AgentCore Code Interpreter、AgentRun 沙箱 | 循环要自己掌控,只是不想维护代码隔离 |
| 托管运行环境 | 一个打包好的 Agent(容器或代码) | AgentCore Runtime、Vertex Agent Engine、火山 AgentKit Runtime | 已经用 LangGraph 写好了,想要隔离、伸缩、长任务 |
| 托管整个 harness | 一份配置:模型、提示词、工具、skills | Claude Managed Agents、Gemini Managed Agents、AgentCore Harness | 写代码、查资料、处理文件这类开放任务,不想写循环 |

Day 415 讲沙箱时,我们用的就是第一行。下一部分毕业项目 SupportPilot 那种客服 Agent,如果要托管,最自然的是第二行。第三行最省事,代价是循环里发生什么,你只能通过事件流去看,改不了。

## 先写自建版:同一个问题,循环在自己手里

为了比较,先用我们熟悉的方式写一个自建版:DeepSeek 加两个查账工具,循环、工具执行、会话历史全在自己进程里。这就是 Day 170 那个完整 Agent 的缩小版,只是数据换成了 CloudLedger 的查账场景。

先准备一份迷你账本。[Day 280](/blog/agent-zero/day-280-mcp-seed/) 造过完整的 CloudLedger 业务库,这里为了今天的代码能独立跑,只放三个客户和四张发票,存在本机 SQLite 里(Python 自带 `sqlite3`,不用装):

```python
# agent-zero-lab/part07/managed/ledger.py
"""CloudLedger 查账工具的迷你版:三个客户、几张发票,存在本机 SQLite 里。"""
import sqlite3
from pathlib import Path

DB = Path(__file__).with_name("ledger.db")


def setup() -> None:
    DB.unlink(missing_ok=True)
    with sqlite3.connect(DB) as conn:
        conn.executescript("""
            CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, email TEXT, company TEXT);
            CREATE TABLE invoices (id TEXT PRIMARY KEY, customer_id TEXT, amount REAL,
                                   status TEXT, issued_on TEXT);
            INSERT INTO customers VALUES
              ('C007', '刘静', 'user007@example.com', '半岛咖啡'),
              ('C012', '王磊', 'user012@example.com', '北岸设计'),
              ('C031', '陈晨', 'user031@example.com', '小满书店');
            INSERT INTO invoices VALUES
              ('INV-2026-0123', 'C007', 2392.00, 'paid', '2026-10-08'),
              ('INV-2026-0098', 'C007', 2392.00, 'paid', '2026-09-08'),
              ('INV-2026-0071', 'C007', 2392.00, 'open', '2026-08-08'),
              ('INV-2026-0130', 'C012', 599.00, 'open', '2026-10-12');
        """)


def find_customer(query: str) -> list[dict[str, str]]:
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        like = f"%{query}%"
        rows = conn.execute(
            "SELECT id, name, email, company FROM customers "
            "WHERE id = ? OR email = ? OR name LIKE ? OR company LIKE ? LIMIT 5",
            (query, query, like, like),
        ).fetchall()
    if not rows:
        raise ValueError(f"没找到和「{query}」匹配的客户。换成邮箱、姓名或公司名再试。")
    return [dict(r) for r in rows]


def list_invoices(customer_id: str, status: str | None = None) -> list[dict[str, object]]:
    sql = "SELECT id, amount, status, issued_on FROM invoices WHERE customer_id = ?"
    args: list[str] = [customer_id]
    if status:
        sql += " AND status = ?"
        args.append(status)
    with sqlite3.connect(DB) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(sql + " ORDER BY issued_on DESC LIMIT 3", args).fetchall()
    if not rows:
        raise ValueError(f"客户 {customer_id} 没有发票记录。确认编号是否来自 find_customer 的结果。")
    return [dict(r) for r in rows]


if __name__ == "__main__":
    setup()
    print(find_customer("user007@example.com"))
    print(list_invoices("C007"))
    try:
        list_invoices("C999")
    except ValueError as e:
        print("ValueError:", e)
```

<div class="line-notes">

- `DB = Path(__file__).with_name("ledger.db")` 数据库文件放在这个脚本旁边。`with_name` 是「同目录下换个文件名」,不管你在哪个目录运行脚本都能找到。
- `DB.unlink(missing_ok=True)` 先删掉旧库,每次都从同一份数据开始,结果可重复。`missing_ok=True`:文件不存在也不报错。
- `with sqlite3.connect(DB) as conn:` 连接数据库,`with` 块结束时自动提交事务([Day 93](/blog/agent-zero/day-093-python-sqlite-2/) 学过的上下文管理器和 `row_factory`)。
- `conn.executescript("""` 一次执行多条 SQL,建两张表、插样本数据。SQL 是第一部分学过的那几条语句。
- `('INV-2026-0071', 'C007', 2392.00, 'open', '2026-08-08'),` C007 的三张发票里故意放一张 `open`(未付),好看模型能不能发现。
- `conn.row_factory = sqlite3.Row` 让查出来的每一行能按列名取值,下面 `dict(r)` 才能把它变成 `{"id": ..., "name": ...}`。
- `"WHERE id = ? OR email = ? OR name LIKE ? OR company LIKE ? LIMIT 5",` 用 `?` 占位,值从下一行传进去,防 SQL 注入。编号和邮箱精确匹配,姓名和公司名模糊匹配。
- `raise ValueError(f"没找到和「{query}」匹配的客户。换成邮箱、姓名或公司名再试。")` 查不到不返回空列表,而是抛一个**写给模型看的错误**,告诉它下一步该怎么做。这是 [Day 282](/blog/agent-zero/day-282-mcp-errors/) 学的「出错时让模型看得懂」。
- `def list_invoices(customer_id: str, status: str | None = None)` `status` 可选,不传就查所有状态。
- `rows = conn.execute(sql + " ORDER BY issued_on DESC LIMIT 3", args).fetchall()` 按开票日期倒序,最多三张。
- `print(find_customer("user007@example.com"))` 实跑打印 `[{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]`。
- `print("ValueError:", e)` 实跑打印 `ValueError: 客户 C999 没有发票记录。确认编号是否来自 find_customer 的结果。`

</div>

```bash
cd ~/agent-zero-lab
uv run python part07/managed/ledger.py
```

```text
[{'id': 'C007', 'name': '刘静', 'email': 'user007@example.com', 'company': '半岛咖啡'}]
[{'id': 'INV-2026-0123', 'amount': 2392.0, 'status': 'paid', 'issued_on': '2026-10-08'}, {'id': 'INV-2026-0098', 'amount': 2392.0, 'status': 'paid', 'issued_on': '2026-09-08'}, {'id': 'INV-2026-0071', 'amount': 2392.0, 'status': 'open', 'issued_on': '2026-08-08'}]
ValueError: 客户 C999 没有发票记录。确认编号是否来自 find_customer 的结果。
```

然后是自建的循环。下面要用 `from part07.managed.ledger import ...` 导入,所以 `part07/` 和 `part07/managed/` 下都要有一个空的 `__init__.py`(`touch part07/managed/__init__.py`),运行时用 `python -m` 的写法,原因在 [Day 72](/blog/agent-zero/day-072-pytest-2/) 讲过。

```python
# agent-zero-lab/part07/managed/self_loop.py
"""自建版:循环、工具执行、会话历史全在自己进程里。和 managed_ledger.py 问同一个问题,对比用。"""
import json
import os
import sys
import time
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam, ChatCompletionToolUnionParam

from part07.managed.ledger import find_customer, list_invoices, setup

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
model = os.environ["LLM_MODEL"]
extra = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")
PRICE_IN, PRICE_OUT = 2.0, 8.0  # deepseek-flash 忙时,元 / 百万 token(未命中缓存)

LOCAL_TOOLS = {"find_customer": find_customer, "list_invoices": list_invoices}


def fn(name: str, desc: str, props: dict[str, Any], required: list[str]) -> ChatCompletionToolUnionParam:
    return {"type": "function", "function": {"name": name, "description": desc,
            "parameters": {"type": "object", "properties": props, "required": required}}}


TOOLS = [
    fn("find_customer", "按邮箱、姓名、公司名或客户编号查客户。查发票之前先用它拿 customer_id。",
       {"query": {"type": "string"}}, ["query"]),
    fn("list_invoices", "列出客户最近 3 张发票,金额单位元。status 可选 paid/open。",
       {"customer_id": {"type": "string"}, "status": {"type": "string"}}, ["customer_id"]),
]


def run_local(name: str, args: dict[str, Any]) -> str:
    try:
        return json.dumps(LOCAL_TOOLS[name](**args), ensure_ascii=False)
    except ValueError as e:
        return f"出错:{e}"


def main(question: str) -> None:
    messages: list[ChatCompletionMessageParam] = [
        {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。先用工具核实,再用中文回答,金额写元。"},
        {"role": "user", "content": question},
    ]
    tokens_in = tokens_out = calls = 0
    start = time.perf_counter()
    for _ in range(5):
        resp = client.chat.completions.create(model=model, messages=messages, tools=TOOLS, extra_body=extra)
        assert resp.usage is not None
        tokens_in += resp.usage.prompt_tokens
        tokens_out += resp.usage.completion_tokens
        msg = resp.choices[0].message
        if not msg.tool_calls:
            print(msg.content)
            break
        messages.append({"role": "assistant", "content": msg.content, "tool_calls": [
            {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}}
            for c in msg.tool_calls if c.type == "function"]})
        for c in msg.tool_calls:
            if c.type != "function":
                continue
            calls += 1
            text = run_local(c.function.name, json.loads(c.function.arguments))
            print(f"[本地执行 {c.function.name}({c.function.arguments}) -> {text[:50]}]")
            messages.append({"role": "tool", "tool_call_id": c.id, "content": text})
    cost = (tokens_in * PRICE_IN + tokens_out * PRICE_OUT) / 1_000_000
    print(f"工具调用 {calls} 次,输入 {tokens_in} / 输出 {tokens_out} token,"
          f"用时 {time.perf_counter() - start:.1f}s,约 ¥{cost:.5f}")


if __name__ == "__main__":
    setup()
    main(sys.argv[1] if len(sys.argv) > 1 else "user007@example.com 这个客户最近三张发票都付了吗?")
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletionMessageParam, ChatCompletionToolUnionParam` SDK 给 messages 和工具定义的类型。标上之后编辑器不飘红,basedpyright standard 档实测 0 报错。
- `from part07.managed.ledger import find_customer, list_invoices, setup` 刚才那个迷你账本。
- `PRICE_IN, PRICE_OUT = 2.0, 8.0` DeepSeek 2026 年 10 月的忙时价,按全部未命中缓存算,偏贵的估法。
- `LOCAL_TOOLS = {"find_customer": find_customer, "list_invoices": list_invoices}` 工具名到函数的映射表。模型只会说名字,我们按名字查表执行。Day 168 的工具注册表是这个的完整版。
- `def fn(name: str, desc: str, props: dict[str, Any], required: list[str])` 拼一个工具定义的小函数,省得每个工具都写一遍外面那几层大括号。结构就是 [Day 157](/blog/agent-zero/day-157-tool-schema/) 学的 JSON Schema。
- `fn("find_customer", "按邮箱、姓名、公司名或客户编号查客户。查发票之前先用它拿 customer_id。",` 描述里写清「先用它拿 customer_id」,模型就知道两个工具的先后顺序。
- `def run_local(name: str, args: dict[str, Any]) -> str:` 真正执行工具的地方。出错时不让程序崩,而是把错误文字当作工具结果交给模型,让它自己决定下一步。
- `messages: list[ChatCompletionMessageParam] = [` **会话历史就是这个列表**,存在我们自己进程的内存里。自建时它在哪、存多久、要不要落库,全由你决定。
- `for _ in range(5):` 最多 5 轮,防止模型一直要工具停不下来。`_` 表示这个循环变量用不到。
- `resp = client.chat.completions.create(model=model, messages=messages, tools=TOOLS, extra_body=extra)` 每一轮都把**完整的** messages 发过去。这就是「托管模型 API」:模型在 DeepSeek 那边,循环在我们这边。
- `tokens_in += resp.usage.prompt_tokens` 每一轮的输入 token 都要累加,因为每一轮都重发了整段历史。第一轮约 600 多,第二轮带上了工具结果,更多。
- `if not msg.tool_calls:` 模型不要工具了,说明它准备好回答了,打印并退出循环。
- `messages.append({"role": "assistant", "content": msg.content, "tool_calls": [` 先把模型「我要调工具」这条消息原样追加进历史,Day 159 讲过,少了这一步下一轮会报错。
- `for c in msg.tool_calls:` 模型可能一次要调多个工具,逐个执行。
- `text = run_local(c.function.name, json.loads(c.function.arguments))` `arguments` 是 JSON 字符串,先 `json.loads` 成 dict 再展开成参数。
- `messages.append({"role": "tool", "tool_call_id": c.id, "content": text})` 工具结果以 `tool` 角色追加,`tool_call_id` 对上是哪一次调用。
- `cost = (tokens_in * PRICE_IN + tokens_out * PRICE_OUT) / 1_000_000` 默认问题的实跑:(1530 × 2 + 252 × 8) ÷ 1,000,000 = 0.00508 元。

</div>

```bash
uv run python -m part07.managed.self_loop
```

实跑输出:

```text
[本地执行 find_customer({"query": "user007@example.com"}) -> [{"id": "C007", "name": "刘静", "email": "user007@ex]
[本地执行 list_invoices({"customer_id": "C007"}) -> [{"id": "INV-2026-0123", "amount": 2392.0, "status]
刘静（半岛咖啡，user007@example.com）最近三张发票中，有两张已付，一张未付：

| 发票号 | 金额 | 状态 | 开票日期 |
|---|---|---|---|
| INV-2026-0123 | 2392 元 | 已付 | 2026-10-08 |
| INV-2026-0098 | 2392 元 | 已付 | 2026-09-08 |
| INV-2026-0071 | 2392 元 | **未付** | 2026-08-08 |

所以并非全部付清：INV-2026-0071（2392 元）仍为未付状态。需要我帮您进一步处理这张发票吗？
工具调用 2 次,输入 1530 / 输出 252 token,用时 2.3s,约 ¥0.00508
```

先查客户拿到 C007,再查发票,发现了那张未付的,用时 2.3 秒,花了半分钱。再换一个问题,用公司名问:

```bash
uv run python -m part07.managed.self_loop "北岸设计有没有没付的发票?"
```

```text
[本地执行 find_customer({"query": "北岸设计"}) -> [{"id": "C012", "name": "王磊", "email": "user012@ex]
[本地执行 list_invoices({"customer_id": "C012", "status": "open"}) -> [{"id": "INV-2026-0130", "amount": 599.0, "status"]
查到了。北岸设计（联系人：王磊）目前有 **1 张未付发票**：

| 发票号 | 金额 | 状态 | 开票日期 |
|---|---|---|---|
| INV-2026-0130 | 599 元 | 未付 | 2026-10-12 |

需要我帮您核对该发票的明细或其他信息吗？
工具调用 2 次,输入 1446 / 输出 185 token,用时 2.8s,约 ¥0.00437
```

这次模型自己想到了传 `status: "open"` 只查未付的。记住这两组数字(每张工单约 1500 输入、250 输出 token,两秒多),下一节算账要用。

## 托管版:同样的工具,换成 custom tool

现在把同一件事交给 Claude Managed Agents。关键设计问题只有一个:**业务数据要不要进厂商的沙箱?** 客服 Agent 要查的发票在你自己的数据库里,有三种接法:

1. **custom tool**:模型在厂商那边决定「我要调 `list_invoices`」,会话暂停,厂商把这个请求作为一个事件推给你;你的代码在本地查库,把结果发回去,会话继续。数据库和密钥都在你这边,厂商只看到你回传的那段文本。代价是你的进程要一直在线接事件。
2. **MCP connector**:把 [Day 290](/blog/agent-zero/day-290-mcp-remote/) 的远程 MCP server 暴露到公网(加鉴权),在 Agent 配置里挂上它。厂商的循环直接调你的 server,你不用常驻进程接事件,但 server 要公网可达。
3. **把数据放进沙箱**:上传文件,让 Agent 在沙箱里自己用 bash 和 Python 读。分析类任务(「把这个月三千张发票对一遍账」)这样最高效,但数据就进了厂商的存储。

客服场景我推荐第一种或第二种。下面写第一种,因为它不需要公网地址。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="custom tool 的事件时序">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="30" y="16" width="160" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="110" y="36" text-anchor="middle" fill="var(--ink)">你的进程 + ledger.db</text>
    <rect x="430" y="16" width="180" height="30" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="520" y="36" text-anchor="middle" fill="var(--ink)">托管会话(循环+模型)</text>
    <line x1="110" y1="46" x2="110" y2="250" stroke="var(--rule)"/>
    <line x1="520" y1="46" x2="520" y2="250" stroke="var(--rule)"/>
    <line x1="110" y1="74" x2="516" y2="74" stroke="var(--ink-soft)"/>
    <text x="310" y="68" text-anchor="middle" fill="var(--ink)">user.message「C007 发票付了吗」</text>
    <line x1="520" y1="112" x2="114" y2="112" stroke="var(--mem)"/>
    <text x="320" y="106" text-anchor="middle" fill="var(--ink)">agent.custom_tool_use list_invoices</text>
    <rect x="40" y="124" width="140" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="110" y="141" text-anchor="middle" fill="var(--ink)">本地查 SQLite</text>
    <line x1="110" y1="176" x2="516" y2="176" stroke="var(--compute)"/>
    <text x="310" y="170" text-anchor="middle" fill="var(--ink)">user.custom_tool_result(只回需要的字段)</text>
    <line x1="520" y1="214" x2="114" y2="214" stroke="var(--mem)"/>
    <text x="320" y="208" text-anchor="middle" fill="var(--ink)">agent.message + session.status_idle</text>
    <text x="320" y="244" text-anchor="middle" fill="var(--ink-faint)" font-size="11">会话在等你回结果时是 idle,不计运行时</text>
  </g>
</svg>
<figcaption>custom tool 的时序。模型在厂商那边决定调哪个工具,真正的查询在你自己的进程里执行,离开你机器的只有回传的那几个字段。</figcaption>
</figure>

对照自建版看,两边其实是同一件事换了个位置:自建时「把工具结果追加进 messages、再调模型」是我们的 `for` 循环在做;托管时这一步在厂商那边,我们只负责「收到 `agent.custom_tool_use` 事件 → 本地执行 → 发回 `user.custom_tool_result`」。

```bash
uv add anthropic          # 2026 年 10 月最新是 2.1.0,Managed Agents 的接口在 client.beta 下面
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env   # 换成你自己的 key
```

```python
# agent-zero-lab/part07/managed/managed_ledger.py
"""托管版:循环、上下文、会话历史在 Anthropic 那边;业务库留在本机,工具以 custom tool 的形式回到本地执行。"""
import json
import sys
from typing import Any

from anthropic import Anthropic
from anthropic.types.beta import BetaManagedAgentsCustomToolParams
from dotenv import load_dotenv

from part07.managed.ledger import find_customer, list_invoices, setup

load_dotenv()  # 需要 ANTHROPIC_API_KEY
client = Anthropic()

LOCAL_TOOLS = {"find_customer": find_customer, "list_invoices": list_invoices}


def custom(name: str, desc: str, props: dict[str, Any], required: list[str]) -> BetaManagedAgentsCustomToolParams:
    return {"type": "custom", "name": name, "description": desc,
            "input_schema": {"type": "object", "properties": props, "required": required}}


TOOLS = [
    custom("find_customer", "按邮箱、姓名、公司名或客户编号查客户。查发票之前先用它拿 customer_id。",
           {"query": {"type": "string"}}, ["query"]),
    custom("list_invoices", "列出客户最近 3 张发票,金额单位元。status 可选 paid/open。",
           {"customer_id": {"type": "string"}, "status": {"type": "string"}}, ["customer_id"]),
]


def run_local(name: str, args: dict[str, Any]) -> tuple[str, bool]:
    try:
        return json.dumps(LOCAL_TOOLS[name](**args), ensure_ascii=False), False
    except ValueError as e:
        return str(e), True


def main(question: str) -> None:
    agent = client.beta.agents.create(
        name="cloudledger-support",
        model="claude-sonnet-5-5",
        system="你是云簿 CloudLedger 的客服助手。先用工具核实,再用中文回答,金额写元。",
        tools=TOOLS,
    )
    env = client.beta.environments.create(
        name="cloudledger-env",
        config={"type": "cloud", "networking": {"type": "limited"}},
    )
    session = client.beta.sessions.create(
        agent=agent.id, environment_id=env.id, title=question[:40],
        budget={"type": "limit", "max_list_cost": {"amount": "50", "currency": "USD"}},
    )
    with client.beta.sessions.events.stream(session.id) as stream:
        client.beta.sessions.events.send(
            session.id, events=[{"type": "user.message", "content": [{"type": "text", "text": question}]}],
        )
        for event in stream:
            match event.type:
                case "agent.custom_tool_use":
                    text, is_error = run_local(event.name, dict(event.input))
                    print(f"[本地执行 {event.name}({event.input}) -> {text[:50]}]")
                    client.beta.sessions.events.send(session.id, events=[{
                        "type": "user.custom_tool_result", "custom_tool_use_id": event.id,
                        "content": [{"type": "text", "text": text}], "is_error": is_error,
                    }])
                case "agent.message":
                    print("".join(b.text for b in event.content if b.type == "text"))
                case "session.status_idle" if event.stop_reason and event.stop_reason.type == "end_turn":
                    break
                case _:
                    pass
    s = client.beta.sessions.retrieve(session.id)
    print("usage:", s.usage.input_tokens, s.usage.output_tokens, s.usage.active_seconds, s.usage.list_cost)


if __name__ == "__main__":
    setup()
    main(sys.argv[1] if len(sys.argv) > 1 else "user007@example.com 这个客户最近三张发票都付了吗?")
```

<div class="line-notes">

- `"""托管版:循环、上下文、会话历史在 Anthropic 那边` **这个文件我没有连真实服务跑过**:我没有 Anthropic 的 API key。做过的验证:用 basedpyright standard 档按 anthropic 2.1.0 的类型定义检查,0 报错;为了确认类型检查是真在查,我故意把 `"limited"` 改成 `"limitd"`,它立刻报 `Argument of type "dict[str, str | dict[str, str]]" cannot be assigned to parameter "config"`。`run_local` 那部分单独用本地 `ledger.db` 实跑过,结果在练习 1。
- `from anthropic.types.beta import BetaManagedAgentsCustomToolParams` SDK 给 custom tool 定义的类型。和自建版的 `ChatCompletionToolUnionParam` 是同一个作用。
- `client = Anthropic()` 读环境变量 `ANTHROPIC_API_KEY`。没有 key 时,发第一个请求那一刻会报 `TypeError: "Could not resolve authentication method. Expected one of api_key, auth_token, or credentials to be set...`,我实跑看到的就是这句。
- `def custom(` 和自建版的 `fn` 几乎一样,区别是外层 `"type": "custom"`、参数字段叫 `input_schema` 而不是 `parameters`。这就是 [Day 164](/blog/agent-zero/day-164-anthropic-tools/) 讲过的 Anthropic 写法。
- `def run_local(name: str, args: dict[str, Any]) -> tuple[str, bool]:` 比自建版多返回一个布尔值:这次调用是否出错。托管版要把它作为 `is_error` 告诉模型。
- `agent = client.beta.agents.create(` 建一份 Agent 配置。真实项目里只建一次,把 `agent.id` 存下来以后反复用;这里为了练习简单每次都新建。
- `model="claude-sonnet-5-5",` **托管 harness 只能用这家厂商自己的模型**。自建版用的是 DeepSeek,这里只能是 Claude。下一节算账时这一条影响很大。
- `tools=TOOLS,` 只挂了我们两个 custom tool,没挂内置的 bash、文件、网页工具,所以这个 Agent 什么都执行不了,只能查账。**托管 harness 默认能力很强,给客服用要主动收窄**,这是 [Day 413](/blog/agent-zero/day-413-least-privilege/) 最小权限原则在托管场景下的样子。
- `env = client.beta.environments.create(` 每个会话都要跑在某个 Environment 里,哪怕用不到沙箱工具也得建一个。
- `config={"type": "cloud", "networking": {"type": "limited"}},` `limited` 网络模式下沙箱只能访问白名单里的域名,这里一个都没列,等于断网。
- `budget={"type": "limit", "max_list_cost": {"amount": "50", "currency": "USD"}},` 会话的花费上限,按 anthropic 2.1.0 的类型定义,金额是以「美分」为单位的字符串,`"50"` 就是 0.5 美元。到了上限会话就不再发新的模型请求。
- `with client.beta.sessions.events.stream(session.id) as stream:` **先打开事件流,再发消息**。SSE 这类流一般只推送连上之后发生的事件,反过来写,模型很快发出的第一个工具请求可能就漏掉了。我没在文档里找到对这一点的明确说明,按这个顺序写是稳妥的。事件流走的是 SSE,和 [Day 379](/blog/agent-zero/day-379-sse-server/) 我们自己写的服务端推送是同一种东西,只是这回你是接收方。
- `client.beta.sessions.events.send(` 发一条用户消息,会话从 idle 变成 running,开始计运行时。
- `match event.type:` Python 3.10 起的 `match` 语句,相当于 JS 的 `switch (event.type)`,但能在 `case` 后面加 `if` 条件。
- `case "agent.custom_tool_use":` 模型决定调我们的工具。`event.name` 是工具名,`event.input` 是参数,`event.id` 是回传结果要用的编号。这一刻会话进入 idle,等我们回结果,不计运行时。
- `text, is_error = run_local(event.name, dict(event.input))` 在本地执行。按默认问题,大概率先调 `find_customer`,再调 `list_invoices`,和自建版一样。
- `"type": "user.custom_tool_result", "custom_tool_use_id": event.id,` 把结果送回去,会话继续 running。对应自建版里 `{"role": "tool", "tool_call_id": c.id, ...}` 那一行。
- `case "agent.message":` 模型说的话,`event.content` 是一组内容块,只取文本块拼起来。
- `case "session.status_idle" if event.stop_reason and event.stop_reason.type == "end_turn":` 会话空闲有两种原因:等你回工具结果,或者这一轮答完了(`end_turn`)。只有后者才退出。
- `case _:` 其他事件(比如状态变成 running 的通知)一律忽略。`_` 相当于 switch 的 `default`。
- `print("usage:", s.usage.input_tokens,` 会话结束后的统计:输入输出 token、`active_seconds`(running 了多少秒,运行时就按它收钱)、`list_cost`(按标价算的花费)。

</div>

有 key 的话这样跑:

```bash
uv run python -m part07.managed.managed_ledger
```

输出的结构应该和自建版一样:先是两行 `[本地执行 ...]`,然后是中文回答,最后一行 `usage:` 跟着 token 数、秒数和花费。具体回答内容取决于模型怎么调工具,我没有实跑,就不编了。

把两个文件并排放着看,能看出托管到底替你省掉了什么:自建版里那个 `for _ in range(5)` 循环、`messages` 列表、每一轮的 `append`,在托管版里都没有了。你写的只剩「工具定义」和「收到工具请求时怎么执行」。代价是另外三件事:循环里发生什么只能看事件,模型只能用 Claude,会话历史存在 Anthropic 的服务器上。

## 钱怎么算:运行时那层通常不是大头

很多人第一反应是「托管肯定贵」。算一下。账分成两层:**运行时**(托管服务的会话费,或者自建的服务器钱)和**模型 token**。注意自建可以用便宜的 DeepSeek,托管 harness 只能用厂商自己的模型,所以两边的模型费要分开列。

```python
# agent-zero-lab/part07/managed/cost_compare.py
"""一个月花多少钱:运行时那层 + 模型 token 那层,分开算。单价 2026-10 从官方定价页抄的,用前再核。"""
from dataclasses import dataclass


@dataclass
class Workload:
    tickets_per_day: int = 300   # 每天处理多少张工单
    running_min: float = 0.5     # 每张工单 Agent 真正在干活的分钟数(模型推理 + 工具执行)
    session_min: float = 8.0     # 会话从开到关的总分钟数(含等客户回复)
    tokens_in: int = 1_530       # 每张工单的输入 token,self_loop.py 实测
    tokens_out: int = 252


def monthly(w: Workload) -> dict[str, float]:
    n = w.tickets_per_day * 30
    return {
        # Claude Managed Agents:只按 running 计时,$0.08 / 小时;模型只能用 Claude,按 Sonnet 5.5 $2/$10
        "托管·运行时": n * w.running_min / 60 * 0.08,
        "托管·Sonnet": n * (w.tokens_in * 2 + w.tokens_out * 10) / 1_000_000,
        # AgentCore Runtime v1:CPU 只算干活时间(1 vCPU),内存(2 GB)从会话开始算到结束
        "AgentCore·运行时": n * (w.running_min / 60 * 0.0895 + w.session_min / 60 * 2 * 0.00945),
        # 自建:两台 2 核 4G 海外 VPS(一台备用),模型用 deepseek-flash 忙时 $0.30/$1.20
        "自建·VPS": 2 * 10.0,
        "自建·DeepSeek": n * (w.tokens_in * 0.30 + w.tokens_out * 1.20) / 1_000_000,
    }


if __name__ == "__main__":
    for label, w in [("每天 300 张", Workload()),
                     ("每天 3000 张", Workload(tickets_per_day=3000)),
                     ("每天 300 张,每张真干活 20 分钟", Workload(running_min=20, session_min=30))]:
        print(label)
        for k, v in monthly(w).items():
            print(f"  {k}: ${v:,.2f}")
```

<div class="line-notes">

- `from dataclasses import dataclass` [Day 50](/blog/agent-zero/day-050-dataclass/) 学过的 dataclass:把一组带默认值的字段打包成一个类,相当于 TS 里一个带默认值的 interface 加构造函数。
- `running_min: float = 0.5` **最关键的参数**:模型在推理、工具在执行的时间。自建版实测一张工单两秒多,托管那边多了事件往返,我按半分钟估,已经很宽松。客服工单大部分时间在等客户回复,真正干活的时间很短。
- `session_min: float = 8.0` 会话从开到关的总时长,包括等客户打字。Claude 只按 running 收钱,用不到它;AgentCore v1 的内存按整段会话收,用得到。这个 8 分钟是我拍的估计值。
- `tokens_in: int = 1_530` 直接用 `self_loop.py` 第一个问题的实测值。
- `n = w.tickets_per_day * 30` 一个月的工单数,默认 9000。
- `"托管·运行时": n * w.running_min / 60 * 0.08,` 9000 × 0.5 ÷ 60 = 75 个 running 小时,× 0.08 = **6.00 美元**。
- `"托管·Sonnet": n * (w.tokens_in * 2 + w.tokens_out * 10) / 1_000_000,` 9000 × (1530 × 2 + 252 × 10) ÷ 1,000,000 = 9000 × 5580 ÷ 1,000,000 = **50.22 美元**。Sonnet 5.5 的 $2 输入、$10 输出是 Anthropic 定价页 2026-10 的价格,没算缓存。
- `"AgentCore·运行时": n * (` CPU:75 小时 × 0.0895 = 6.71;内存:9000 × 8 ÷ 60 = 1200 会话小时 × 2GB × 0.00945 = 22.68。合计 **29.39 美元**。内存按整段会话算,所以会话越长越吃亏。AgentCore Runtime 是「托管运行环境」,里面跑你自己的 Agent,模型可以随便选,这里就没单列模型费。
- `"自建·VPS": 2 * 10.0,` [Day 425](/blog/agent-zero/day-425-deploy-route/) 说过海外 2 核 4G 的 VPS 每月 5 到 10 美元,取 10 美元、留一台备机,**20 美元**。它没算你自己维护沙箱、会话恢复、监控的人力,这是自建真正的成本。
- `"自建·DeepSeek": n * (w.tokens_in * 0.30 + w.tokens_out * 1.20) / 1_000_000,` 9000 × (459 + 302.4) ÷ 1,000,000 = **6.85 美元**。
- `("每天 300 张,每张真干活 20 分钟", Workload(running_min=20, session_min=30))` 第三种场景是长任务,比如让 Agent 在沙箱里跑一份对账脚本、反复改反复跑。

</div>

```bash
uv run python part07/managed/cost_compare.py
```

实跑输出:

```text
每天 300 张
  托管·运行时: $6.00
  托管·Sonnet: $50.22
  AgentCore·运行时: $29.39
  自建·VPS: $20.00
  自建·DeepSeek: $6.85
每天 3000 张
  托管·运行时: $60.00
  托管·Sonnet: $502.20
  AgentCore·运行时: $293.93
  自建·VPS: $20.00
  自建·DeepSeek: $68.53
每天 300 张,每张真干活 20 分钟
  托管·运行时: $240.00
  托管·Sonnet: $50.22
  AgentCore·运行时: $353.55
  自建·VPS: $20.00
  自建·DeepSeek: $6.85
```

这几行数字里有三个结论。

第一,**客服这种「干活时间短、等人时间长」的负载,运行时费用很小**。每天 300 张,Claude 托管的运行时一个月 6 美元,只有它模型费的八分之一。纠结「运行时每小时 8 美分贵不贵」没什么意义。

第二,**真正拉开差距的是模型费**,而这一条是托管 harness 带来的连锁反应:用了 Claude Managed Agents 就只能用 Claude。同样的工单,Sonnet 一个月 50 美元,DeepSeek 不到 7 美元。这不是说哪个模型更好(质量要用评测集比),而是提醒你算账时别只盯着运行时那一行。

第三,**长任务会把运行时拉上来**。每张工单真干活 20 分钟时,托管运行时涨到 240 美元,反超了模型费。AgentCore v1 更怕会话挂着不关,因为内存一直在计费。

自建 VPS 账面最便宜,量越大差距越大。但那 20 美元背后是你自己维护的沙箱、会话恢复、扩容和半夜的告警。两三个人的小团队,这部分人力折成钱远远超过一两百美元。所以**钱通常不是这道题的主要矛盾**。

## 真正要比的四件事

**锁定**。托管 harness 的配置格式、事件类型、会话 API 都是厂商自己的:Claude 的事件叫 `agent.custom_tool_use`,别家又是另一套。写在上面的胶水代码,换厂商基本要重写。好在工具层在收敛,几家都能接 MCP server、都支持 skills。所以降低锁定的办法是**把业务能力做成 MCP server 和 skills**([Day 296](/blog/agent-zero/day-296-skills-1/)),运行时只负责「谁来跑循环」,换厂商时业务那层不用动。押注托管产品还要想它两年后在不在:OpenAI 2025 年推出的可视化 Agent Builder,2026 年 6 月 3 日宣布弃用,定在 2026 年 11 月 30 日关停([OpenAI 弃用说明](https://developers.openai.com/api/docs/deprecations))。

**可观测**。循环不在你手里,你看到的是它愿意给你的事件。要把这些事件接进你自己的 Langfuse、跑 [Day 341](/blog/agent-zero/day-341-why-evals/) 起那套轨迹评测,得写适配代码转格式。如果你的评测很依赖「改一下循环里某一步,看分数变化」,托管 harness 会让你很难受,因为那一步不归你改。

**数据合规**。这一条在国内团队经常是一票否决。会话历史、沙箱文件、中间结果都存在厂商那边,Claude Managed Agents 官方明说目前不支持零数据保留。海外厂商的服务,客户数据出境要过相应的合规流程(进阶篇 [Day 596](/blog/agent-zero/day-596-governance-1/) 起讲)。国内业务能选的基本是阿里云、火山、腾讯云这几家,或者用「托管循环 + 自托管沙箱」的混合形态,把代码执行和文件留在自己机房。Claude Managed Agents 的 Environment 就支持自托管沙箱。

**调试和控制**。自建循环出问题,你可以打断点、加日志、改重试策略。托管 harness 出问题,比如它压缩上下文时把关键信息丢了,你能做的是改提示词、改工具描述,然后再试。反过来说,厂商替你做了很多你未必做得好的优化(内置的缓存、上下文压缩),只是什么时候触发、怎么触发,你说了不算。

## 自建还是租:一张决策表

下面这张表是我会拿去和老板开会用的。每一行问一个具体问题,看答案落在哪一边:

| 问题 | 偏向租 | 偏向自建 |
| --- | --- | --- |
| 任务形态 | 写代码、查资料、处理文件,步骤开放 | 固定流程、强业务规则,比如分类 → 检索 → 起草 → 审批 |
| 循环要不要改 | 用厂商默认的就行 | 要插自己的检查节点、审批、路由([Day 319](/blog/agent-zero/day-319-lg-interrupt/) 那种 interrupt) |
| 数据能不能出机房 | 能,或者只出脱敏后的字段 | 不能,或者合同明确禁止 |
| 有没有人维护沙箱和恢复 | 没有,或者不想花这个人力 | 有,而且已经有 [Day 395](/blog/agent-zero/day-395-temporal/) 那套持久化执行 |
| 模型选择 | 只用这家厂商的模型 | 要在 DeepSeek、通义、Claude 之间路由([Day 399](/blog/agent-zero/day-399-model-routing/)) |
| 评测要求 | 端到端结果对就行 | 要做步骤级的轨迹评测和 A/B |
| 时间 | 两周内要上线一个内部工具 | 公司核心产品,要长期演进 |

很常见的结论是混合:**核心产品自建,内部提效工具租**。比如客服主流程自己写,但「每周把工单导出来做一份分析报告」这种活,丢给托管 harness,在沙箱里跑 Python 出图表,写一份配置就完事。另一种混合是用 AgentCore Runtime 这类「托管运行环境」:LangGraph 图还是你自己写的,只把隔离、伸缩、长任务交出去,锁定和失控的代价比托管整个 harness 小很多。

## 动手练习

**练习 1:先把本地工具那一半跑通。** 托管版里只有 `run_local` 是在你自己机器上执行的。不用 Anthropic key,单独调用它,分别传一个正常的查询和一个查不到的客户,看返回值的第二个元素。

<details><summary>参考答案</summary>

```bash
uv run python -c "
from part07.managed.ledger import setup
setup()
from part07.managed.safe_tools import run_local
print(run_local('find_customer', {'query': 'user007@example.com'}))
print(run_local('list_invoices', {'customer_id': 'C999'}))
"
```

<div class="line-notes">

- `from part07.managed.ledger import setup` 先建库。
- `from part07.managed.safe_tools import run_local` 这里导入的是练习 3 那个更稳的版本(和托管版的 `run_local` 返回格式一样,`(文本, 是否出错)`),这样不用导入 `managed_ledger.py`,也就不需要 Anthropic 的 SDK 配置。还没写练习 3 的话,先把练习 3 的文件建好。
- `print(run_local('find_customer', {'query': 'user007@example.com'}))` 实跑:`('[{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"}]', False)`。
- `print(run_local('list_invoices', {'customer_id': 'C999'}))` 实跑:`('客户 C999 没有发票记录。确认编号是否来自 find_customer 的结果。', True)`。第二个值 `True` 在托管版里会作为 `is_error` 告诉模型「这次调用失败了」,模型据此换个思路,而不是把错误文字当成查询结果复述给用户。

</div>

</details>

**练习 2:观察自建版遇到查不到的客户会怎样。** 用 `self_loop.py` 问「客户 C999 的发票付了吗?」,看模型调了几次工具、最后怎么回答。

<details><summary>参考答案</summary>

```bash
uv run python -m part07.managed.self_loop "客户 C999 的发票付了吗?"
```

实跑:

```text
[本地执行 find_customer({"query": "C999"}) -> 出错:没找到和「C999」匹配的客户。换成邮箱、姓名或公司名再试。]
我没有查到客户编号为 C999 的客户记录。方便的话,请提供客户的邮箱、姓名或公司名,我帮您重新查一下。
工具调用 1 次,输入 846 / 输出 76 token,用时 1.6s,约 ¥0.00230
```

模型按工具描述先调了 `find_customer`,收到我们写给它看的错误信息后,没有去瞎查发票,而是照着错误里的提示,请用户换成邮箱、姓名或公司名。这就是 Day 282 说的「错误信息是写给模型看的」。托管版里同样的错误会以 `is_error: True` 送回去,模型的反应应该类似,这一点我没有实跑验证。

</details>

**练习 3:让本地工具执行更稳。** 托管会话里模型可能要求调一个你没注册的工具名,或者把参数名写错。现在的 `run_local` 遇到这两种情况会怎样?改成「出错也返回 `(说明文字, True)`,不让进程崩」。

<details><summary>参考答案</summary>

现在的版本实跑:调 `delete_customer` 抛 `KeyError 'delete_customer'`,传 `{"q": "C007"}` 抛 `TypeError find_customer() got an unexpected keyword argument 'q'`。在托管版里,这两个异常会让 `for event in stream` 循环直接崩掉,会话停在 idle 等一个永远不会来的结果。改法:

```python
# agent-zero-lab/part07/managed/safe_tools.py
import json
from typing import Any

from part07.managed.ledger import find_customer, list_invoices, setup

LOCAL_TOOLS = {"find_customer": find_customer, "list_invoices": list_invoices}


def run_local(name: str, args: dict[str, Any]) -> tuple[str, bool]:
    func = LOCAL_TOOLS.get(name)
    if func is None:
        return f"没有叫 {name} 的工具。可用的只有:{', '.join(LOCAL_TOOLS)}。", True
    try:
        return json.dumps(func(**args), ensure_ascii=False), False
    except TypeError:
        return f"{name} 的参数不对,收到的是 {sorted(args)}。请按工具定义里的参数名重试。", True
    except ValueError as e:
        return str(e), True


if __name__ == "__main__":
    setup()
    print(run_local("delete_customer", {"customer_id": "C007"}))
    print(run_local("find_customer", {"q": "C007"}))
    print(run_local("find_customer", {"query": "C007"}))
```

<div class="line-notes">

- `func = LOCAL_TOOLS.get(name)` 用 `.get` 而不是 `[name]`,查不到返回 None 而不是抛 KeyError。相当于 JS 里 `map.get(name)` 拿到 undefined。
- `return f"没有叫 {name} 的工具。可用的只有:{', '.join(LOCAL_TOOLS)}。", True` 把可用的工具名告诉模型。`', '.join(LOCAL_TOOLS)` 遍历 dict 得到的是键,实跑拼出 `find_customer, list_invoices`。这也是一道安全闸:不在表里的名字一律不执行,哪怕模型被注入了「调用 delete_customer」。
- `except TypeError:` 参数名不对或缺参数时,Python 抛的是 TypeError。
- `return f"{name} 的参数不对,收到的是 {sorted(args)}。` `sorted(args)` 对 dict 排序得到排好序的键列表,实跑是 `['q']`。
- `except ValueError as e:` 业务上的「查不到」,保持原来的处理。
- `print(run_local("delete_customer", {"customer_id": "C007"}))` 实跑:`('没有叫 delete_customer 的工具。可用的只有:find_customer, list_invoices。', True)`。
- `print(run_local("find_customer", {"q": "C007"}))` 实跑:`("find_customer 的参数不对,收到的是 ['q']。请按工具定义里的参数名重试。", True)`。
- `print(run_local("find_customer", {"query": "C007"}))` 实跑:`('[{"id": "C007", "name": "刘静", "email": "user007@example.com", "company": "半岛咖啡"}]', False)`。

</div>

```bash
uv run python -m part07.managed.safe_tools
```

basedpyright standard 档检查 0 报错。把托管版 `managed_ledger.py` 里的 `run_local` 换成从这里导入,它就稳了。

</details>

**练习 4:运行时什么时候会超过模型费?** 用 `cost_compare.py` 的 `monthly`,保持每天 300 张,只改 `running_min`,找出 Claude 托管的运行时费用追上 Sonnet 模型费的那个点。先手算,再用脚本验证。

<details><summary>参考答案</summary>

手算:运行时 = 9000 × r ÷ 60 × 0.08 = 12r 美元,模型费固定 50.22 美元,12r = 50.22,r ≈ 4.2 分钟。验证:

```bash
uv run python -c "
from part07.managed.cost_compare import Workload, monthly
for r in [0.5, 2, 4.19, 6]:
    m = monthly(Workload(running_min=r))
    print(r, round(m['托管·运行时'], 2), round(m['托管·Sonnet'], 2))
"
```

实跑:

```text
0.5 6.0 50.22
2 24.0 50.22
4.19 50.28 50.22
6 72.0 50.22
```

每张工单真正干活超过 4 分钟左右,运行时就比模型费贵了。客服问答一般是几秒到几十秒,离这个点很远;让 Agent 在沙箱里写代码、跑测试、反复修改的任务,很容易超过。所以判断运行时贵不贵,先去 trace 里看你的任务真正 running 多久。

</details>

**练习 5:给 SupportPilot 写一段「自建还是租」的结论。** 下一部分的毕业项目 SupportPilot 是一个面向客户的客服 Agent:分类、检索帮助中心、查账、起草回复,退款要人工审批,数据在国内。用决策表写 200 字以内的结论,至少引用三行。

<details><summary>参考答案</summary>

示范结论:SupportPilot 选自建。任务形态是固定流程(分类 → 检索 → 查账 → 起草),而且退款要插人工审批节点,循环必须自己能改;客户数据在国内,不能进海外厂商的会话存储;我们要在 DeepSeek 和通义之间按成本路由,托管 harness 会把模型锁死在一家;评测要做到步骤级,看分类和检索各自的准确率。按今天的成本脚本,每天 300 张工单时运行时费用本来就很低,自建省的不是钱,而是控制权。以后如果要做「每周工单分析报告」这类内部工具,可以单独用国内厂商的托管 harness,和主流程分开。

自查方法:把你的结论和决策表逐行对一遍,每个论点能对上表里的一行,并且至少有一条是具体数字(比如成本脚本的结果),就算合格。

</details>

**验收标准**:`ledger.py`、`self_loop.py`、`cost_compare.py`、`safe_tools.py` 都实跑过;能对着 custom tool 时序图,说清楚哪一步数据离开了你的机器;能说出每天 300 张工单时运行时和模型费各多少,以及运行时在什么情况下会变成大头;写出练习 5 的结论。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| harness | 让 Agent 跑起来的那一整套:循环、工具执行、上下文管理、沙箱、会话、观测、鉴权 |
| 托管模型 API | 只托管模型推理,循环在你的代码里,每轮由你发 messages,比如调 DeepSeek |
| 托管运行时(managed runtime) | 厂商替你运行 Agent 的基础设施,包括隔离环境、会话存储,有的连循环一起托管 |
| Claude Managed Agents | Anthropic 的托管 harness,beta,按 token 加 running 时长(每小时 0.08 美元)收费 |
| Session(会话) | 一次 Agent 运行实例,有状态(running、idle 等)和事件历史 |
| Environment | Claude Managed Agents 里定义会话跑在哪的配置:厂商的云沙箱或自托管沙箱 |
| 事件(Events) | 托管会话和你之间来回的消息,如 `user.message`、`agent.custom_tool_use`,走 SSE 推送 |
| custom tool | 由你的代码执行的工具。模型发出调用请求,会话暂停等你回结果,数据不进厂商沙箱 |
| running / idle | 会话的两种主要状态:在干活,或在等你。Claude 只对 running 计运行时 |
| microVM | 轻量虚拟机,隔离比容器强、启动比普通虚拟机快,AgentCore 每个会话一个 |
| 零数据保留(ZDR) | 厂商承诺不在服务端保存请求和响应内容的合规选项,有状态的托管会话目前大多不支持 |
| 锁定(vendor lock-in) | 系统深度依赖某厂商的私有接口,换厂商成本很高 |

## 常见误区

**「托管运行时一定比自建贵。」** 按今天的脚本,每天 300 张工单,Claude 托管的运行时一个月 6 美元,只是模型费的零头。真正的代价是锁定、失去控制和模型被绑定,不是每小时那几美分。

**只比运行时,忘了模型被锁定。** 托管 harness 只能用它家的模型。同样的工单,Sonnet 一个月 50 美元,DeepSeek 不到 7 美元,这一项比运行时差得多。

**「上了托管就不用做评测了。」** 恰恰相反。循环不在你手里,厂商升级一次 harness,行为就可能变。你更需要一套固定的回归评测集,每次厂商更新都跑一遍。

**「托管运行时帮我解决了安全问题。」** 它解决的是隔离:你的沙箱代码伤不到别人。提示词注入、工具权限过大、数据外发这些 Agent 层面的问题([Day 403](/blog/agent-zero/day-403-injection-1/) 起那几天)一个都没少。默认工具集带 bash 和网页抓取,不收窄就直接给客服用,风险比自建还大。

**本地工具执行不做兜底。** 模型要一个不存在的工具名、或者参数名写错,`run_local` 抛 KeyError 或 TypeError,事件循环直接崩,会话卡在 idle。工具执行一律返回 `(说明, is_error)`,不让异常冒出来。

**先发消息再开事件流。** 流一般只推送连上之后的事件,顺序反了可能漏掉开头的工具调用请求,表现是程序一直等、什么都不打印。先 `stream`,再 `send`。

**会话开着不管。** AgentCore v1 的内存从会话开始算到结束,挂着就一直花钱;Claude 只算 running,但会话历史一直存在服务端,涉及个人信息的要主动删除(官方提供了删除会话的接口)。

**把「托管模型」和「托管运行时」混为一谈。** 调 DeepSeek API 也是用别人的服务器,但循环是你的。面试里被问「用没用过托管运行时」,别拿调 API 的经历回答。

## 学习资料

### 文档与文章

- [Claude Managed Agents overview](https://platform.claude.com/docs/en/managed-agents/overview):先看四个核心概念,再看 Beta access 里关于 ZDR 的那段,20 分钟。
- [Claude Managed Agents quickstart](https://platform.claude.com/docs/en/managed-agents/quickstart):建 Agent、Environment、Session、收事件流的完整代码,对照今天的托管版读,30 分钟。
- [Anthropic 定价页](https://platform.claude.com/docs/en/about-claude/pricing):找「Claude Managed Agents pricing」那一节,看 session runtime 的计费规则和算例,10 分钟。
- [Amazon Bedrock AgentCore 是什么](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/what-is-bedrock-agentcore.html):一张表列全了十几个服务,先看懂每个管哪一层,20 分钟。
- [AgentCore 定价](https://aws.amazon.com/bedrock/agentcore/pricing/):重点看 Runtime 的 I/O 等待和内存计费规则,15 分钟。
- [Gemini API · Managed agents quickstart](https://ai.google.dev/gemini-api/docs/managed-agents-quickstart):Google 的托管 harness 怎么用,和 Claude 的对照着看,15 分钟。
- [阿里云 AgentRun 发布公告](https://cn.aliyun.com/product/news/28237)和阿里云开发者社区的[《探秘 AgentRun》](https://developer.aliyun.com/article/1707976):国内对应产品的定位和技术细节,20 分钟。
- [腾讯云 Agent Runtime 计费模式](https://cloud.tencent.com/document/product/1814/133249):国内按秒计费的一个例子,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ruDdBHErG&autoplay=0&high_quality=1" title="[中配] 什么是Claude Managed Agents？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>豚工智能 · [中配] 什么是Claude Managed Agents? · 7 分钟,官方介绍视频的中文配音版,讲清楚 Agent、Environment、Session 三个概念,先看它建立整体印象。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1sRQpBvEP8&autoplay=0&high_quality=1" title="Claude Managed Agents 完全指南！从 API 到自动执行代码，性能提升 10 倍的秘密！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>李哈利Harry · Claude Managed Agents 完全指南 · 13 分钟上手演示,标题有点夸张,看他建 Agent、开会话、看事件流那一段就行。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/NLWiIj47IdI" title="What is Claude Managed Agents?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Claude · What is Claude Managed Agents? · 官方英文原版,和上面的中配版二选一。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hcm5zIWASCM" title="What is an Agent Harness? (And How We Built One)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AWS Developers · What is an Agent Harness? (And How We Built One) · AWS 团队讲他们为什么把 harness 做成托管服务,听完对今天那张分层图会更有体感。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 10 章「AI Engineering Architecture and User Feedback」前半部分,讲一个 AI 应用从最简单的架构一步步加组件,读完你会对「哪些组件值得外包」有更好的直觉。英文原版,1 小时。
- Michael Albada《Building Applications with AI Agents》(O'Reilly, 2025):讲 Agent 系统的设计取舍,挑部署和生产化相关的章节读。英文原版。

### 开源项目与代码

- [anthropics/claude-quickstarts 的 managed-agents 目录](https://github.com/anthropics/claude-quickstarts/tree/main/managed-agents):官方给的几个完整应用,看真实项目里事件流怎么接,30 分钟。
- [aws/bedrock-agentcore-sdk-python](https://github.com/aws/bedrock-agentcore-sdk-python):看 README 里的最小例子,理解「托管运行环境」要求你的代码长什么样,15 分钟。
- [strands-agents/sdk-python](https://github.com/strands-agents/sdk-python):AWS 开源的 Agent 框架,AgentCore Harness 的底层。想知道托管 harness 里的循环大概怎么写,读它的 agent loop 部分,1 小时。

## 自测

**1. 托管模型 API 和托管运行时有什么区别?各举一个例子。**

<details><summary>答案</summary>

托管模型 API 只托管推理:每一轮由你的代码组 messages、调模型、执行工具,循环在你这边,比如我们一直在调的 DeepSeek API。托管运行时连循环、工具执行环境、会话状态一起托管:你发一条用户消息,它自己跑完多轮,你通过事件流看过程,比如 Claude Managed Agents。

</details>

**2. 用 custom tool 接业务库时,哪些东西离开了你的机器,哪些没有?**

<details><summary>答案</summary>

离开的:用户的问题、模型的回答、你通过 `user.custom_tool_result` 回传的那段工具结果文本,它们都会存在厂商的会话历史里。没离开的:数据库本身、数据库连接和密钥、你没回传的其他字段。所以回传时只给模型需要的字段,别把整行数据一股脑塞回去。

</details>

**3. 每天 300 张工单,为什么 Claude 托管的运行时费用只有 6 美元?什么样的任务会让它变成大头?**

<details><summary>答案</summary>

它只按会话处于 running 的时间收费,每小时 0.08 美元。客服工单每张真正在干活的时间很短(按半分钟估,9000 张一个月只有 75 个 running 小时),等客户回复的 idle 时间不收钱。会让它变贵的是长任务:在沙箱里写代码、跑测试、反复修改,每张真干活超过约 4 分钟时,运行时就超过了 Sonnet 的模型费;按脚本,每张 20 分钟时运行时是 240 美元一个月。

</details>

**4. 怎样降低对某一家托管 harness 的锁定?**

<details><summary>答案</summary>

把业务能力做成跨厂商通用的形态:工具做成 MCP server,领域知识做成 skills,评测集和运行时无关;托管 harness 只负责跑循环,换厂商时只改配置和事件处理那层胶水代码。另外优先考虑「托管运行环境」(把你自己写的 LangGraph 图部署上去),它比托管整个 harness 锁定小得多,模型也能自己选。

</details>

**5. 面试题:你们要做一个给内部运营用的「每周数据分析报告」Agent,还要做对外的智能客服。运行时你怎么选?**

<details><summary>答案</summary>

分开选。周报 Agent 是内部工具,任务开放(读数据、写 Python、画图),对循环没有特殊要求,数据可以脱敏后进沙箱,适合直接租托管 harness,一两天就能上线;它属于长任务,要注意运行时按 running 计费,先估一下每次跑多久。对外客服是核心产品,流程固定、要插审批和自检节点、要做步骤级评测和 A/B、要在多个模型之间按成本路由,客户数据的合规要求也高,应该自建循环;如果团队不想维护隔离和伸缩,可以把自己的图部署到 AgentCore Runtime 或国内同类的托管运行环境上。最后补一句成本:客服这种负载运行时费用远小于模型费,决策主要看控制力、合规和模型选择,不看运行时单价。

</details>

**6. 面试题:「托管运行时已经帮我们做了沙箱隔离,安全问题就解决了吧?」你怎么回答?**

<details><summary>答案</summary>

没有。隔离解决的是「这段代码伤不到别的租户和宿主机」。Agent 层面的问题都还在:间接提示词注入可能让模型调用不该调的工具,工具权限给大了一样会出事,沙箱如果能出网,数据照样能被发出去。所以托管场景下还是要做那几件事:只挂需要的工具,关掉用不到的内置 bash 和网页工具;网络设成 limited 并列白名单;本地执行工具时按白名单查表,不认识的名字一律拒绝;注入测试和回归评测照常跑。另外会话历史存在厂商那边,涉及个人信息的要按保留期限主动删除。

</details>

## 明天预告

明天是 Day 430 · 用 Java 和 Go 写 Agent(一):全景和 Spring AI。到今天为止,我们的 Agent 从头到尾都是 Python 写的,今天还把循环交给过托管服务。可很多公司的后端是 Java 或 Go,Agent 往往要嵌进已有的服务里。明天看一眼这两门语言的 Agent 生态,用 Spring AI 的 ChatClient 写一个带工具调用的版本,和我们的 Python 版对照着读。
