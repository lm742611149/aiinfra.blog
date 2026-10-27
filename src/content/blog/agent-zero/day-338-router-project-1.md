---
title: 'Day 338 · 小项目(一):工单分流 Agent 设计和 MCP 工具'
description: '第五部分的收尾小项目开工:先写一页设计,再把不调模型的那一半做完。字二元组检索、同步调用 MCP 的桥、按工单类别给工具的工具箱,八个测试证明退款工具只有退款工单看得到、越权会被拒;中间撞一次 find_customer 绕过越权检查的漏洞。'
pubDate: 2026-10-27
regime: none
tags: ['mcp', 'tool-use', 'project', 'python', 'agent-zero']
series: 'agent-zero'
day: 338
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 337](/blog/agent-zero/day-337-low-code-2/) 把低代码平台的事收了个尾:给 n8n 接了一个只读的 HTTP 接口,用同一份 12 条用例给代码版和画布版打分,最后得出一张「什么时候该改成写代码」的判断表。那两天是旁支,今天回到主线。

第五部分前面 60 多天学的东西现在要拼在一起:[Day 280](/blog/agent-zero/day-280-mcp-seed/) 造的业务库、[Day 284](/blog/agent-zero/day-284-mcp-resource-prompt/) 写完的 CloudLedger MCP server、[Day 289](/blog/agent-zero/day-289-mcp-host/) 自己当 host 时写的两个转换、[Day 299](/blog/agent-zero/day-299-lg-one-node/) 到 [Day 324](/blog/agent-zero/day-324-lg-subgraph/) 的 LangGraph、[Day 320](/blog/agent-zero/day-320-lg-refund-approval/) 的退款审批,还有 [Day 335](/blog/agent-zero/day-335-week48-review/) 那个「先别拆多 Agent」的结论。这个小项目分三天:今天写设计和工具,[Day 339](/blog/agent-zero/day-339-router-project-2/) 把图和审批接起来真跑,[Day 340](/blog/agent-zero/day-340-router-project-3/) 做知识地图和坑清单。后面第六部分的评测、第八部分的 SupportPilot,拿的都是它。

## 今天要解决的问题

给一张客服工单,让 Agent 分类、查帮助中心、查业务库、遇到退款停下来等主管批、最后写一段带引用的回复。这个系统有一半不需要模型:检索、调 MCP、决定哪类工单能用哪些工具。这一半先写完,先测牢,明天再把模型接上去。

学完今天,你要能做到:

1. 画出这个系统的一页设计:输入输出、六个工单类别、每类能用的工具、文件怎么分。
2. 写出三个模块:`kb.py`(离线检索)、`mcp_bridge.py`(在普通函数里同步调用 MCP)、`toolbox.py`(按类别给工具、每次调用先过三道检查)。
3. 不调模型,用 8 个 pytest 证明「只有 refund 类能看到退款工具」「查别人的数据会被拒」。
4. 亲手撞出一个漏洞:只检查 `customer_id` 参数拦不住 `find_customer`,再把它补上。

预计用时 3 小时。前置:[Day 280](/blog/agent-zero/day-280-mcp-seed/) 的 `cloudledger/seed.py` 和 `cloudledger.db`,[Day 284](/blog/agent-zero/day-284-mcp-resource-prompt/) 的 `cloudledger/server.py`(四个工具加一个 resource),[Day 287](/blog/agent-zero/day-287-mcp-test/) 的 pytest 和 monkeypatch 用法,[Day 288](/blog/agent-zero/day-288-mcp-client/) 和 [Day 289](/blog/agent-zero/day-289-mcp-host/) 的 `Client`、工具清单转换,[Day 222](/blog/agent-zero/day-222-kb-data/) 和 [Day 224](/blog/agent-zero/day-224-chunking/) 的 `data/kb/` 帮助中心文章与 `part04/chunking.py`,[Day 311](/blog/agent-zero/day-311-lg-agent-loop/) 的 `part05/lgdemo/llm.py`(最后那个演示要用 `get_llm()`)。今天只有最后一个演示真调 4 次模型,约 0.008 元,其余全部不花钱。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `Toolbox.execute` 的三道检查默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 先把要做的东西说清楚

一页设计,写在动手之前。这是我做项目的习惯:写不出输入输出和边界,代码写到一半一定会改。

**输入**是一张工单:正文,可选的客户编号(客服系统里通常是用户登录后工单自带的,所以是「已验证身份」),可选的「今天」(年付退款要数剩余月份,评测时要固定日期才能复现)。**输出**是一段给客户的回复、引用了帮助中心哪几段、有没有转人工。

工单先分到六类之一:`refund` 退款、`billing` 扣款和计费、`invoice` 发票、`bug` 功能报错、`account` 账号登录、`other` 其他。分类是这个系统最关键的一个决定,因为后面「能用哪些工具」全看它。

整个流程是下面这张图。蓝色的节点要调模型,琥珀色的执行工具。今天写的是图下面那一层:工具箱、MCP 桥、知识库检索。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="三层结构:上层是 Day 339 的图 graph.py,中间是今天写的 toolbox.py,下面是 mcp_bridge.py、kb.py 和已有的 server.py、chunking.py">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="20" y="24" width="170" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="32" y="48" fill="var(--ink)">graph.py</text>
    <text x="32" y="68" font-size="11" fill="var(--ink-soft)">Day 339:模型 + 状态机</text>
    <rect x="235" y="24" width="170" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="247" y="48" fill="var(--ink)">toolbox.py</text>
    <text x="247" y="68" font-size="11" fill="var(--ink-soft)">specs() / execute()</text>
    <rect x="450" y="24" width="170" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="462" y="48" fill="var(--ink)">mcp_bridge.py</text>
    <text x="462" y="68" font-size="11" fill="var(--ink-soft)">同步地调 MCP</text>
    <rect x="235" y="140" width="170" height="52" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="247" y="162" fill="var(--ink)">kb.py</text>
    <text x="247" y="180" font-size="11" fill="var(--ink-soft)">字二元组检索</text>
    <rect x="450" y="140" width="170" height="52" rx="6" fill="none" stroke="var(--ink-soft)"/>
    <text x="462" y="162" fill="var(--ink)">server.py</text>
    <text x="462" y="180" font-size="11" fill="var(--ink-soft)">Day 284,stdio 子进程</text>
    <rect x="235" y="216" width="170" height="40" rx="6" fill="none" stroke="var(--ink-soft)"/>
    <text x="247" y="240" fill="var(--ink-soft)">part04/chunking.py</text>
    <rect x="450" y="216" width="170" height="40" rx="6" fill="none" stroke="var(--ink-soft)"/>
    <text x="462" y="240" fill="var(--ink-soft)">cloudledger.db</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="190" y1="56" x2="235" y2="56"/><line x1="405" y1="56" x2="450" y2="56"/>
    <line x1="320" y1="88" x2="320" y2="140"/><line x1="535" y1="88" x2="535" y2="140"/>
    <line x1="320" y1="192" x2="320" y2="216"/><line x1="535" y1="192" x2="535" y2="216"/>
  </g>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="196" y="50">调用</text><text x="406" y="50">转发</text>
    <text x="326" y="118">search_kb</text><text x="541" y="118">tools/call</text>
  </g>
</svg>
<figcaption>今天写琥珀色的三个文件。graph.py 明天才写,它只认 Toolbox 的两个方法:specs 告诉模型能用什么,execute 真正执行。</figcaption>
</figure>

接口先定下来,明天写图的时候照着用,不再改:

| 文件 | 对外给什么 | 谁来用 |
| --- | --- | --- |
| `part05/router/kb.py` | `search_kb(query, k=3)` 返回带编号的段落 | toolbox、图里的检索节点 |
| `part05/router/mcp_bridge.py` | `CloudLedgerMCP(db_path)` 的 `tool_specs()`、`call()`、`read_resource()` | toolbox、图里读退款政策 |
| `part05/router/toolbox.py` | `Toolbox(db_path)` 的 `specs(category, customer_id)`、`execute(call, category, customer_id)` | 图的 agent 节点和 tools 节点 |

下面这几个设计决定,面试时讲这个项目全靠它们。我先列出来,每个落在哪一天、为什么这么定,后面写到的时候再展开。

| 决定 | 为什么 | 哪天落地 |
| --- | --- | --- |
| 按工单类别给工具,只有 refund 能看到退款工具 | 分类可能错,但「看不到」比「看到了叫它别用」可靠得多 | 今天 |
| 安全检查写在工具层,不写在提示词里 | 提示词挡不住注入,代码可以单元测试 | 今天 |
| 工具层不依赖模型和图,单独可测 | 明天图出了问题,能先排除工具层 | 今天 |
| 业务库路径、模型都能从外面传 | 评测时每条用例一份干净的库;测试时传假模型 | 今天和明天 |
| 退款提交前人工审批,批了才写库 | 钱的事,Agent 只出方案 | Day 339 |
| 退款政策只在 MCP server 里存一份 | 规则抄在好几处,改的时候一定漏一处 | Day 339 |

目录是这样的,今天只写前五个文件:

```text
agent-zero-lab/
├── cloudledger/            # Day 280 的 seed.py、Day 284 的 server.py、cloudledger.db
├── data/kb/                # Day 222 造的 20 篇帮助中心文章
├── part04/chunking.py      # Day 224 的切块,块编号形如 kb-002#3
└── part05/
    ├── lgdemo/llm.py       # Day 311 的 get_llm()
    └── router/             # 这个小项目的全部文件
        ├── kb.py           # 今天
        ├── mcp_bridge.py   # 今天
        ├── toolbox.py      # 今天
        ├── test_toolbox.py # 今天
        ├── graph.py        # Day 339
        ├── run_ticket.py   # Day 339
        └── ...
```

先确认环境。下面这些都是前面几天已经装好的,`pytest` 是 Day 287 加的开发依赖:

```bash
cd ~/agent-zero-lab
uv add mcp langgraph langgraph-checkpoint-sqlite langchain-openai python-dotenv pydantic
uv add --dev pytest
uv run python cloudledger/seed.py
mkdir -p part05/router && touch part05/router/__init__.py
```

```text
已生成 cloudledger.db: {'customers': 30, 'subscriptions': 30, 'invoices': 123, 'tickets': 41}
```

我 2026 年 10 月 27 日查到的版本:mcp 2.3.0、langgraph 1.2.18、langchain-openai 1.7.3、langchain-core 1.7.0、pydantic 2.14.1,Python 3.12.13。你装的版本比这新的话,小版本之间一般没区别,真不一样了以文档为准。

## 第 1 步:知识库检索,先不联网

Day 226 做过完整的检索:embedding、混合检索、重排。工单 Agent 下周要拿去跑几十上百条评测,我希望检索这一环有三个性质:不联网、不花钱、同样的输入永远同样的输出。所以这里换一个最土的办法,**字二元组重叠**:把文字每相邻两个字切成一对,看查询和段落有多少对是相同的。

「被扣了两次款」切出来是「被扣」「扣了」「了两」「两次」「次款」五对。两段文字共有的对越多,越相关。这个办法不懂语义,「重复扣款」和「被扣了两次」一个二元组都不共用,下面会看到它因此漏掉的例子。先把它写出来:

```python
# agent-zero-lab/part05/router/kb.py
"""工单 Agent 用的知识库检索:字二元组重叠打分,不联网、不花钱、每次结果一样。"""
import sys
from collections import Counter
from functools import lru_cache

from part04.chunking import Chunk, load_chunks


def bigrams(text: str) -> Counter[str]:
    text = "".join(ch for ch in text.lower() if not ch.isspace())
    return Counter(text[i : i + 2] for i in range(len(text) - 1))


@lru_cache(maxsize=1)
def _index() -> list[tuple[Chunk, Counter[str]]]:
    return [(c, bigrams(c.text)) for c in load_chunks()]


def search_kb(query: str, k: int = 3) -> list[dict]:
    """返回 [{id, title, section, text, score}],按相关度从高到低,一个字都不重叠的块不返回。"""
    q = bigrams(query)
    scored: list[tuple[float, Chunk]] = []
    for chunk, grams in _index():
        overlap = sum((q & grams).values())
        if overlap:
            scored.append((overlap / (sum(q.values()) ** 0.5 * sum(grams.values()) ** 0.5), chunk))
    scored.sort(key=lambda x: -x[0])
    return [
        {"id": c.id, "title": c.title, "section": c.section, "text": c.text, "score": round(s, 3)}
        for s, c in scored[:k]
    ]


if __name__ == "__main__":
    for q in sys.argv[1:] or ["年付中途取消能退多少", "被扣了两次款", "重复扣款", "验证码过期登录不了"]:
        print(q)
        for hit in search_kb(q):
            print(f"  {hit['score']:.3f}  {hit['id']:<9} {hit['title']} > {hit['section']}")
```

<div class="line-notes">

- `"""工单 Agent 用的知识库检索` docstring 把三个性质写在最前面:不联网、不花钱、结果固定。
- `from collections import Counter` `Counter` 是一个「数数」的字典,相当于 JS 里 `Map<string, number>`,取不存在的键得 0 而不是报错。
- `from functools import lru_cache` 给函数加缓存,相当于 JS 里手写的 memoize。
- `from part04.chunking import Chunk, load_chunks` Day 224 写的切块:`load_chunks()` 返回 42 个 `Chunk`,每个有 `id`(如 `kb-002#3`)、`title`、`section`、`text`。要在 `agent-zero-lab` 根目录用 `-m` 运行,切块函数里的 `Path("data/kb")` 是相对路径。
- `def bigrams(text: str) -> Counter[str]:` 把一段文字变成二元组的计数。
- `text = "".join(ch for ch in text.lower() if not ch.isspace())` 转小写、去掉所有空白,这样「E1043」和「e1043」、换行前后的两个字都能连成一对。
- `return Counter(text[i : i + 2] for i in range(len(text) - 1))` `text[i : i + 2]` 取第 i 个和下一个字,相当于 JS 的 `text.slice(i, i + 2)`。代入「被扣了两次款」(6 个字):`i` 取 0 到 4,得到 `Counter({'被扣': 1, '扣了': 1, '了两': 1, '两次': 1, '次款': 1})`,共 5 对。
- `@lru_cache(maxsize=1)` 下面这个函数没有参数,第一次算完的结果留着,后面直接返回,42 个块不用每次重新切。
- `def _index() -> list[tuple[Chunk, Counter[str]]]:` 前面的下划线是约定:这是模块内部用的,别的文件不要 import。返回「块 + 它的二元组计数」的列表。
- `return [(c, bigrams(c.text)) for c in load_chunks()]` 每个块配上自己的二元组。第一个块是 `kb-001#1`(套餐与价格 > 三种套餐),199 个字符,出现最多的二元组是「业版」4 次、「每月」4 次、「套餐」3 次。
- `def search_kb(query: str, k: int = 3) -> list[dict]:` 对外的唯一入口,返回前 k 段。
- `q = bigrams(query)` 查询也切成二元组。
- `overlap = sum((q & grams).values())` `Counter` 的 `&` 取两边都有的键,次数取较小的那个,再把次数加起来就是重叠数。代入「验证码过期登录不了」(9 个字,8 对):和 `kb-016#1`(账号安全与两步验证 > 两步验证)共用「验证」「证码」两对,`overlap = 2`。
- `if overlap:` 一对都不共用的块直接跳过。实测「被扣了两次款」和 42 个块全部零重叠,最后返回空列表。
- `scored.append((overlap / (sum(q.values()) ** 0.5 * sum(grams.values()) ** 0.5), chunk))` 重叠数除以两边二元组总数各开根号再相乘,思路和余弦相似度一样,长段落不会因为字多就占便宜。代入:`2 / (√8 × √37) = 2 / (2.828 × 6.083) ≈ 0.116`,和输出里的 0.116 对得上。`kb-016#1` 一共 37 个二元组。
- `scored.sort(key=lambda x: -x[0])` 按分数从高到低排。`key` 只取分数;不写 `key` 直接排元组的话,两个分数相同时会接着比 `Chunk` 对象,它不支持比大小,会抛 `TypeError`。
- `{"id": c.id, "title": c.title, "section": c.section, "text": c.text, "score": round(s, 3)}` 返回普通字典,后面要原样转成 JSON 交给模型,字典比自定义对象省事。
- `for q in sys.argv[1:] or [` 不带参数就用后面四条默认查询。`sys.argv[1:]` 是空列表时为假,`or` 取右边,相当于 JS 的 `||`。

</div>

跑一遍:

```bash
uv run python -m part05.router.kb
```

```text
年付中途取消能退多少
  0.125  kb-002#1  退款政策 > 年付套餐
  0.096  kb-002#2  退款政策 > 月付套餐
  0.046  kb-006#1  发票类型与开具 > 可以开哪种发票
被扣了两次款
重复扣款
  0.258  kb-002#3  退款政策 > 重复扣款
  0.095  kb-004#1  自动续费与扣款规则 > 什么时候扣款
  0.057  kb-004#2  自动续费与扣款规则 > 扣款失败
验证码过期登录不了
  0.116  kb-016#1  账号安全与两步验证 > 两步验证
  0.081  kb-016#2  账号安全与两步验证 > 更换手机号
  0.054  kb-015#3  团队成员与权限 > 邀请成员
```

「年付中途取消能退多少」找对了,第一名是退款政策的年付一节。「重复扣款」第一名也对,后面两条是自动续费文章,因为都带「扣款」。**「被扣了两次款」一条都没有**,客户的说法和文章的说法用字不一样,二元组一个也对不上。这是这个简陋检索的硬伤,先记下,明天 Agent 会自己换关键词再查一次(我们把 `search_kb` 也当作工具交给它),第六部分评测时再回来量它漏了多少。练习 1 会把这个漏洞量一遍。

## 第 2 步:在普通函数里同步地调 MCP

Day 288 写 client 的时候,所有代码都在 `async def` 里,用 `anyio.run(main)` 起头。LangGraph 的节点却是普通函数,`graph.invoke()` 也是同步调用,评测脚本逐条跑起来最省事。要在普通函数里拿到 MCP 的结果,中间得垫一层「同步桥」。

用前端的话说:你在一个不能 `await` 的函数里,想拿到某个 Promise 的结果。JS 里没有好办法,所以才处处是 async。Python 有:`anyio.run(协程)` 自己起一个事件循环,把协程跑完,再把返回值交回来,调用的人看到的就是一个普通函数。

麻烦在于「已经在事件循环里」的时候。第六部分把这个 Agent 放进 FastAPI 的接口,接口函数本身就跑在事件循环里,再 `anyio.run` 一次会怎样?先撞一下:

```python
# agent-zero-lab/part05/router/ex338_nested.py
"""在已经有事件循环的地方(比如 FastAPI 的接口函数里)直接 anyio.run,会怎样;run_sync 又是怎么绕过去的。"""
import anyio

from part05.router.mcp_bridge import run_sync


async def inner() -> str:
    return "inner 跑完了"


async def handler_naive() -> str:
    return anyio.run(inner)  # 在 async 函数里又想「同步地」等一个协程


async def handler_safe() -> str:
    return run_sync(inner)


for name, handler in [("直接 anyio.run", handler_naive), ("run_sync", handler_safe)]:
    try:
        print(f"{name}: {anyio.run(handler)}")
    except Exception as e:
        print(f"{name}: {type(e).__name__}: {e}")
```

<div class="line-notes">

- `import anyio` 和 Day 288 用的是同一个库,`anyio.run(async 函数)` 相当于 JS 的顶层 `await main()`。
- `from part05.router.mcp_bridge import run_sync` 下面马上要写的桥。这个演示依赖它,先照着往下看,写完桥再回来跑。
- `async def inner() -> str:` 一个最简单的协程,什么都不干。
- `return anyio.run(inner)` 在一个 `async` 函数(它自己就在事件循环里)里又去 `anyio.run`,等于在 Promise 回调里再起一个整个事件循环。
- `return run_sync(inner)` 同样的需求,交给桥处理。
- `for name, handler in [("直接 anyio.run", handler_naive), ("run_sync", handler_safe)]:` 两种写法各跑一遍。
- `print(f"{name}: {anyio.run(handler)}")` 外层用 `anyio.run` 起一个事件循环,把 `handler` 放进去跑,这样 `handler` 就「身处事件循环」了。
- `except Exception as e:` 把异常的类型和消息打印出来,方便对照。

</div>

先写桥。你照着敲 `mcp_bridge.py`,再回来跑上面这个:

```python
# agent-zero-lab/part05/router/mcp_bridge.py
"""同步地调用 CloudLedger MCP server。LangGraph 的节点是普通函数,MCP 的 client 是异步的,中间垫一层。
每次调用起一个 stdio 子进程:简单,代价是每次几百毫秒;第六部分服务化时再换成常驻连接。"""
import asyncio
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import anyio
from mcp import Client, StdioServerParameters
from mcp.types import CallToolResult, TextContent, TextResourceContents

SERVER = Path(__file__).resolve().parents[2] / "cloudledger" / "server.py"


def run_sync(make_coro: Any) -> Any:
    """在同步代码里跑一个协程。身处事件循环里(比如 FastAPI)时换个线程跑,不然会报 already running。"""
    try:
        asyncio.get_running_loop()  # 当前线程没有事件循环时抛 RuntimeError
    except RuntimeError:
        return anyio.run(make_coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(anyio.run, make_coro).result()


class CloudLedgerMCP:
    def __init__(self, db_path: str | Path | None = None) -> None:
        # 子进程只拿到 SDK 默认的几个变量(HOME/PATH/USER 等),外加我们明说要给的数据库路径。
        # 不把整个 os.environ 传过去:里面有 LLM_API_KEY,server 用不着它。
        env = {"CLOUDLEDGER_DB": str(db_path)} if db_path else None
        self.params = StdioServerParameters(command=sys.executable, args=[str(SERVER)], env=env)
        self._specs: list[dict[str, Any]] | None = None

    def tool_specs(self) -> list[dict[str, Any]]:
        """MCP 工具清单 → OpenAI 兼容的 tools 格式,只取一次。"""
        if self._specs is None:
            async def fetch() -> list[dict[str, Any]]:
                async with Client(self.params) as c:
                    listing = await c.list_tools()
                return [
                    {"type": "function", "function": {
                        "name": t.name, "description": t.description or "", "parameters": t.input_schema}}
                    for t in listing.tools
                ]
            self._specs = run_sync(fetch)
        return self._specs or []

    def call(self, name: str, args: dict[str, Any]) -> str:
        async def go() -> CallToolResult:
            async with Client(self.params) as c:
                return await c.call_tool(name, args)
        r: CallToolResult = run_sync(go)
        if r.structured_content is not None:
            body = json.dumps(r.structured_content, ensure_ascii=False)
        else:
            body = "\n".join(b.text for b in r.content if isinstance(b, TextContent))
        return f"[工具报错] {body}" if r.is_error else body

    def read_resource(self, uri: str) -> str:
        """读一个 resource(Day 284)的文本内容。"""
        async def go() -> str:
            async with Client(self.params) as c:
                r = await c.read_resource(uri)
            return "\n".join(x.text for x in r.contents if isinstance(x, TextResourceContents))
        return run_sync(go)
```

<div class="line-notes">

- `"""同步地调用 CloudLedger MCP server。` docstring 点明了代价:每次调用起一个子进程。
- `import asyncio` 只用它一个函数:`asyncio.get_running_loop()`,判断当前线程有没有事件循环。`anyio` 跑在 `asyncio` 上面。
- `from concurrent.futures import ThreadPoolExecutor` 线程池,下面在已有事件循环时开一个新线程用。
- `from mcp import Client, StdioServerParameters` Day 288 用过:`StdioServerParameters` 描述怎么启动 server 子进程,`Client` 连上它。
- `from mcp.types import CallToolResult, TextContent, TextResourceContents` 三个类型,用来做标注和 `isinstance` 判断,让类型检查器知道每个分支里拿到的是什么。
- `SERVER = Path(__file__).resolve().parents[2] / "cloudledger" / "server.py"` `__file__` 是本文件路径 `.../part05/router/mcp_bridge.py`,`parents[2]` 往上数两层是 `agent-zero-lab`,再拼上 server 的位置。用绝对路径,是 Day 288 踩过的坑:相对路径换个目录就找不到。
- `def run_sync(make_coro: Any) -> Any:` 这里的参数是一个「调用后得到协程的函数」,不是协程本身。两种场景都靠它:`anyio.run` 要的就是函数,线程池里也是把函数交给 `anyio.run`。
- `asyncio.get_running_loop()` 当前线程有事件循环就返回它,没有就抛 `RuntimeError`。这里只拿它当探针。
- `except RuntimeError:` 抛了 `RuntimeError`,说明身处普通同步环境(命令行、pytest、LangGraph 的同步节点),直接走下一行。
- `return anyio.run(make_coro)` 新建一个事件循环,把协程跑完,返回值交回来。
- `with ThreadPoolExecutor(max_workers=1) as pool:` 走到这里说明已经在事件循环里了(`try` 没抛错)。开一个只有一个线程的池子。
- `return pool.submit(anyio.run, make_coro).result()` 把 `anyio.run(make_coro)` 扔到新线程里跑,新线程没有事件循环,所以不会撞上面那个错;`.result()` 阻塞等它跑完,拿到返回值。
- `class CloudLedgerMCP:` 把「怎么连 server」包成一个对象。
- `def __init__(self, db_path: str | Path | None = None) -> None:` 业务库路径可以从外面传,评测时每条用例一份干净的库就靠它。
- `env = {"CLOUDLEDGER_DB": str(db_path)} if db_path else None` 传了路径就只给子进程这一个环境变量,没传就是 `None`(用 server 自己的默认库)。
- `self.params = StdioServerParameters(command=sys.executable, args=[str(SERVER)], env=env)` `sys.executable` 是当前这个 Python 解释器的路径,确保子进程用的是项目虚拟环境里装了 mcp 的那个。`env` 只写 `CLOUDLEDGER_DB` 时,SDK 会再补上 HOME、PATH 等几个默认变量。不把整个 `os.environ` 传过去:Day 288 实测过,那样 server 能看到你的 `LLM_API_KEY`,而它用不着。
- `self._specs: list[dict[str, Any]] | None = None` 工具清单的缓存。`None` 表示还没取过。
- `def tool_specs(self) -> list[dict[str, Any]]:` 把 MCP 的工具清单变成 OpenAI 兼容的 `tools` 格式,Day 289 的 `mcp_tool_to_openai` 做的就是这件事。
- `async def fetch() -> list[dict[str, Any]]:` 在方法里面定义协程,下面交给 `run_sync` 跑。
- `async with Client(self.params) as c:` 起子进程、握手,出了这个块子进程就被关掉。
- `listing = await c.list_tools()` 问 server 有哪些工具。实测返回 4 个:`find_customer`、`get_subscription`、`list_invoices`、`create_refund_request`。
- `"name": t.name, "description": t.description or "", "parameters": t.input_schema}}` MCP 和 OpenAI 的工具描述都是 JSON Schema,基本是换个位置放。`find_customer` 转出来的样子见下面第 3 步的输出。
- `self._specs = run_sync(fetch)` 第一次用到才去取,存起来。
- `return self._specs or []` 万一取回来是空,返回空列表。这一行同时让类型检查器确信返回值不是 `None`。
- `def call(self, name: str, args: dict[str, Any]) -> str:` 调一次工具,返回字符串,明天可以直接放进 `ToolMessage`。
- `r: CallToolResult = run_sync(go)` 每次调用都新起一个子进程。
- `if r.structured_content is not None:` Day 281 讲过,函数返回类型标注得足够具体时,SDK 会给出结构化结果。
- `body = json.dumps(r.structured_content, ensure_ascii=False)` 转成 JSON 字符串;`ensure_ascii=False` 让中文保持中文,不变成 `刘静`。实测 `find_customer` 查 `C007` 得到 `{"result": [{"id": "C007", "name": "刘静", ...}]}`,外面那层 `result` 是 SDK 给列表返回值包的。
- `body = "\n".join(b.text for b in r.content if isinstance(b, TextContent))` 没有结构化结果(比如出错)就把文本块拼起来。`isinstance` 是为了让类型检查器知道 `.text` 一定存在。
- `return f"[工具报错] {body}" if r.is_error else body` 出错加个前缀,模型一眼能看出这次失败了。Day 289 的 `result_to_text` 同一个思路。
- `def read_resource(self, uri: str) -> str:` 读 Day 284 的 resource。明天用它从 server 取退款政策。
- `r = await c.read_resource(uri)` 请求 `cloudledger://policy/refund` 这样的地址。
- `return "\n".join(x.text for x in r.contents if isinstance(x, TextResourceContents))` resource 的内容可能是文本也可能是二进制,只取文本的。

</div>

写完桥,回头跑刚才那个演示:

```text
直接 anyio.run: RuntimeError: Already running asyncio in this thread
run_sync: inner 跑完了
```

直接在事件循环里 `anyio.run` 报 `RuntimeError: Already running asyncio in this thread`,`run_sync` 绕过去了。图里的节点以后不管是被命令行同步调用,还是被 FastAPI 的事件循环调用,都不用改。

再看这层桥的代价。每次 `call` 都要起一个 Python 子进程、握手、调用、关掉。写一个小脚本量三次:

```python
# agent-zero-lab/part05/router/ex338_spawn.py
"""量一量「每次调用起一个子进程」到底多贵:墙钟时间会被机器忙闲影响,子进程吃掉的 CPU 秒数比较稳。"""
import resource
import time

from part05.router.mcp_bridge import CloudLedgerMCP


def child_cpu() -> float:
    r = resource.getrusage(resource.RUSAGE_CHILDREN)
    return r.ru_utime + r.ru_stime


m = CloudLedgerMCP()
for i in range(1, 4):
    wall0, cpu0 = time.perf_counter(), child_cpu()
    m.call("find_customer", {"query": "C007"})
    print(f"第 {i} 次调用:墙钟 {time.perf_counter() - wall0:.2f} 秒,子进程 CPU {child_cpu() - cpu0:.2f} 秒")
```

<div class="line-notes">

- `import resource` 标准库,能查进程用了多少 CPU 时间。Windows 上没有,macOS 和 Linux 有。
- `def child_cpu() -> float:` 到目前为止,本进程所有已经结束的子进程一共用了多少 CPU 秒。
- `r = resource.getrusage(resource.RUSAGE_CHILDREN)` `RUSAGE_CHILDREN` 表示统计子进程。
- `return r.ru_utime + r.ru_stime` 用户态加内核态的 CPU 时间。
- `m = CloudLedgerMCP()` 一个桥,不传库路径。
- `wall0, cpu0 = time.perf_counter(), child_cpu()` 记下调用前的墙钟时间和子进程 CPU。
- `m.call("find_customer", {"query": "C007"})` 调一次最简单的工具。每次循环都会起一个新的 server 子进程。
- `print(f"第 {i} 次调用:墙钟 {time.perf_counter() - wall0:.2f} 秒,子进程 CPU {child_cpu() - cpu0:.2f} 秒")` 墙钟时间受机器忙闲影响,子进程 CPU 秒数比较稳定。

</div>

```bash
uv run python -m part05.router.ex338_spawn
```

```text
第 1 次调用:墙钟 1.80 秒,子进程 CPU 1.44 秒
第 2 次调用:墙钟 3.76 秒,子进程 CPU 1.86 秒
第 3 次调用:墙钟 1.80 秒,子进程 CPU 1.67 秒
```

墙钟时间在我这台机器上跳来跳去(同一时间有别的程序在抢 CPU),比较稳定的是子进程吃掉的 CPU 时间:每次 1.4 到 1.9 秒,这台 2019 年的 Intel MacBook 慢,换新机器会少很多。一张工单里调 3 到 4 次工具,光这一项就是五六秒。作为学习项目、评测项目,换来的好处很实在:每次调用都是一个全新的进程,没有残留状态;各条用例用的库靠 `db_path` 隔开,互不污染。第六部分服务化时换成常驻连接,这个桥的接口不用动。

## 第 3 步:工具箱,谁能用什么,每次调用先过哪几道检查

这是今天的主体。要回答两个问题:模型这一轮**能看到**哪些工具;模型**要调**某个工具时,放不放行。

第一个问题的答案是一张表。每类工单一个集合,只有 `refund` 能看到 `create_refund_request`:

| 工单类别 | 能用的业务工具 | 为什么 |
| --- | --- | --- |
| `refund` | find_customer、get_subscription、list_invoices、create_refund_request | 唯一能提交退款申请的类别 |
| `billing` | find_customer、get_subscription、list_invoices | 扣款、计费要查订阅和发票,不能写 |
| `invoice` | find_customer、list_invoices | 开票问题只要发票 |
| `bug`、`account` | 无 | 报错和登录问题不需要碰业务数据,查帮助中心就够 |
| `other` | get_subscription | 没分清的,只给最小的一个只读工具 |

所有类别另外都有 `search_kb`(它不属于 CloudLedger,是本地的检索)。

第二个问题的答案是「每次执行前先过检查」。我是先写的越权这一道:带 `customer_id` 参数的调用,参数必须和工单绑定的客户一致。写完以后,我写了一个脚本专门去撞它。

```python
# agent-zero-lab/part05/router/ex338_hole.py
"""演示一个漏洞:只检查 customer_id 参数,拦不住 find_customer。这是 toolbox.py 第一版的写法,不要照抄。"""
from part05.router.mcp_bridge import CloudLedgerMCP

mcp = CloudLedgerMCP()


def execute_v1(name: str, args: dict, customer_id: str | None) -> str:
    if customer_id and "customer_id" in args and args["customer_id"] != customer_id:
        return f"[拒绝] 只能查询工单所属客户 {customer_id} 的数据"
    return mcp.call(name, args)


print("查别人的发票:", execute_v1("list_invoices", {"customer_id": "C008"}, "C007"))
print("按邮箱查别人:", execute_v1("find_customer", {"query": "user008@example.com"}, "C007"))
```

<div class="line-notes">

- `"""演示一个漏洞` docstring 里写明了「不要照抄」,这段是反面教材。
- `mcp = CloudLedgerMCP()` 直接用刚写的桥,不传 `db_path`,用 server 默认的库。
- `def execute_v1(name: str, args: dict, customer_id: str | None) -> str:` 我写的第一版:先只写越权这一道,类别检查暂时省略,专门看这一道有没有洞。
- `if customer_id and "customer_id" in args and args["customer_id"] != customer_id:` 工单绑了客户(这里是 C007),并且这次调用带了 `customer_id` 参数,又和绑定的不一致,就拒绝。三个条件缺一个都不拦。
- `return f"[拒绝] 只能查询工单所属客户 {customer_id} 的数据"` 返回文字而不是抛异常,模型读得到,知道这次被拒了。
- `return mcp.call(name, args)` 通过检查才真正调 MCP。
- `print("查别人的发票:", execute_v1("list_invoices", {"customer_id": "C008"}, "C007"))` 客户 C007 的工单里,让它查 C008 的发票。
- `print("按邮箱查别人:", execute_v1("find_customer", {"query": "user008@example.com"}, "C007"))` 换一个工具:`find_customer` 的参数叫 `query`,不叫 `customer_id`。

</div>

```bash
uv run python -m part05.router.ex338_hole
```

```text
查别人的发票: [拒绝] 只能查询工单所属客户 C007 的数据
按邮箱查别人: {"result": [{"id": "C008", "name": "刘军", "email": "user008@example.com", "company": "云杉律所"}]}
```

第一条被拒了,第二条**把 C008 的姓名、邮箱、公司全吐出来了**。原因就在检查条件里:`"customer_id" in args` 对 `find_customer` 永远是假,它的参数叫 `query`,整道检查对它形同虚设。这类漏洞很典型,写检查的时候你想的是「那个参数」,攻击者(或者一个被注入的模型)走的是「另一个参数」。

补法有两种。一种是让 `find_customer` 的 `query` 也参与比较,但它是模糊搜索,可以搜邮箱、姓名、公司名,比较起来很别扭。更干脆的一种是:客户身份已经由系统确定了,这类工单里根本不需要「查找客户」这个动作,所以绑定了客户就**不给**这个工具,真的被调到了也拒绝。两处都改,下面是最终版:

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="execute 的检查顺序:工具在本类别允许名单里吗,search_kb 走本地,绑定了客户时 find_customer 被拒,customer_id 参数必须等于绑定的客户,全部通过才调 MCP">
  <rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="8" y="50" width="96" height="50" rx="5" fill="none" stroke="var(--ink-soft)"/>
    <text x="56" y="72" fill="var(--ink)">模型的调用</text><text x="56" y="88" fill="var(--ink-faint)">name + args</text>
    <rect x="126" y="50" width="100" height="50" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="176" y="72" fill="var(--ink)">① 本类别</text><text x="176" y="88" fill="var(--ink)">允许吗</text>
    <rect x="246" y="50" width="100" height="50" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="296" y="72" fill="var(--ink)">② 绑了客户</text><text x="296" y="88" fill="var(--ink)">还找客户</text>
    <rect x="366" y="50" width="100" height="50" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="416" y="72" fill="var(--ink)">③ customer_id</text><text x="416" y="88" fill="var(--ink)">是同一个吗</text>
    <rect x="490" y="50" width="100" height="50" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="540" y="72" fill="var(--ink)">真的调 MCP</text><text x="540" y="88" fill="var(--ink-faint)">mcp.call()</text>
    <text x="616" y="80" fill="var(--ink-soft)">→</text>
  </g>
  <g stroke="var(--ink-soft)" fill="none">
    <line x1="104" y1="75" x2="126" y2="75"/><line x1="226" y1="75" x2="246" y2="75"/>
    <line x1="346" y1="75" x2="366" y2="75"/><line x1="466" y1="75" x2="490" y2="75"/>
  </g>
  <g stroke="var(--ink-soft)" stroke-dasharray="4 3" fill="none">
    <line x1="176" y1="100" x2="176" y2="150"/><line x1="296" y1="100" x2="296" y2="150"/><line x1="416" y1="100" x2="416" y2="150"/>
  </g>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle" fill="var(--ink-soft)">
    <text x="176" y="168">[工具报错]</text><text x="176" y="184">不能调用 xxx</text>
    <text x="296" y="168">[拒绝]</text><text x="296" y="184">客户已确定</text>
    <text x="416" y="168">[拒绝]</text><text x="416" y="184">只能查本客户</text>
    <text x="320" y="26" fill="var(--ink-faint)">search_kb 是本地函数,过了 ① 就直接执行,不走 ②③</text>
  </g>
</svg>
<figcaption>三道检查,哪一道没过就返回一句带前缀的文字,不抛异常。前缀 [工具报错] 和 [拒绝] 明天用来给 ToolMessage 标成败。</figcaption>
</figure>

```python
# agent-zero-lab/part05/router/toolbox.py
"""工单 Agent 的工具层:哪类工单能用哪些工具,每次调用先过哪几道检查。全部不调模型,可以单独测。"""
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from part05.router.kb import search_kb
from part05.router.mcp_bridge import CloudLedgerMCP

# 按类别给工具:最小权限。只有 refund 类能看到 create_refund_request
TOOLS_BY_CATEGORY: dict[str, set[str]] = {
    "refund": {"find_customer", "get_subscription", "list_invoices", "create_refund_request"},
    "billing": {"find_customer", "get_subscription", "list_invoices"},
    "invoice": {"find_customer", "list_invoices"},
    "bug": set(),
    "account": set(),
    "other": {"get_subscription"},
}

# search_kb 不是 MCP 工具,是本地函数,所以手写一份 schema,和 MCP 转出来的放在一起交给模型
SEARCH_KB_SPEC = {"type": "function", "function": {
    "name": "search_kb",
    "description": "在云簿帮助中心检索相关段落,返回带编号(如 kb-002#1)的原文。回答规则类问题前先查。",
    "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "检索关键词"}},
                   "required": ["query"]},
}}

# 这几个前缀表示「没执行成功」,图里构造 ToolMessage 时靠它们判断成败
ERROR_PREFIXES = ("[工具报错]", "[拒绝]", "[主管驳回]")


class Toolbox:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self.mcp = CloudLedgerMCP(db_path)

    def allowed(self, category: str) -> set[str]:
        return TOOLS_BY_CATEGORY.get(category, set()) | {"search_kb"}

    def specs(self, category: str, customer_id: str | None = None) -> list[dict[str, Any]]:
        """给模型看的工具清单:只含这一类工单允许的。客户身份已经确定时,find_customer 也不给。"""
        names = self.allowed(category)
        if customer_id:
            names = names - {"find_customer"}
        return [s for s in self.mcp.tool_specs() if s["function"]["name"] in names] + [SEARCH_KB_SPEC]

    def execute(self, call: Mapping[str, Any], category: str, customer_id: str | None) -> str:
        """执行一次工具调用。call 是 {"name":..., "args":{...}},所有安全检查都在这里,不靠提示词。"""
        name, args = call["name"], call.get("args") or {}
        if name not in self.allowed(category):
            return f"[工具报错] {category} 类工单不能调用 {name}"
        if name == "search_kb":
            return json.dumps(search_kb(args.get("query", "")), ensure_ascii=False)
        if customer_id and name == "find_customer":
            return f"[拒绝] 客户已确定为 {customer_id},不需要再查找别的客户"
        if customer_id and "customer_id" in args and args["customer_id"] != customer_id:
            return f"[拒绝] 只能查询工单所属客户 {customer_id} 的数据"
        return self.mcp.call(name, args)
```

<div class="line-notes">

- `"""工单 Agent 的工具层` docstring 说明两件事:管「谁能用什么」,而且全程不调模型。
- `from collections.abc import Mapping` `Mapping` 是「只读的字典」类型,下面 `execute` 的参数用它。原因在那一行讲。
- `from typing import Any` 「什么类型都行」,JSON 解析出来的值用它。
- `from part05.router.kb import search_kb` 第 1 步写的检索。
- `from part05.router.mcp_bridge import CloudLedgerMCP` 第 2 步写的桥。
- `TOOLS_BY_CATEGORY: dict[str, set[str]] = {` 上面那张表,代码版。值用 `set`(集合,相当于 JS 的 `Set`),下面要做并集和差集。
- `"refund": {"find_customer", "get_subscription", "list_invoices", "create_refund_request"},` 只有退款类能看到 `create_refund_request`。
- `"bug": set(),` bug 和 account 类不给任何业务工具。空集合要写 `set()`,`{}` 是空字典。
- `"other": {"get_subscription"},` 没分清楚的类别只给一个只读工具。
- `SEARCH_KB_SPEC = {"type": "function", "function": {` `search_kb` 不是 MCP 工具,是本地函数,所以手写一份 OpenAI 格式的 schema,和从 MCP 转出来的放在一起交给模型。
- `"description": "在云簿帮助中心检索相关段落,返回带编号(如 kb-002#1)的原文。回答规则类问题前先查。",` 这句话是写给模型看的。「带编号」是为了让它回答时能引用,「回答规则类问题前先查」是在推它别凭记忆答。
- `ERROR_PREFIXES = ("[工具报错]", "[拒绝]", "[主管驳回]")` 三种「没执行成功」的前缀集中放一处,明天构造工具消息时用它判断成败。`[主管驳回]` 是明天审批节点用的。
- `class Toolbox:` 把检查和连接包成一个对象。
- `self.mcp = CloudLedgerMCP(db_path)` 每个 `Toolbox` 一个桥,每个桥一份库路径。
- `def allowed(self, category: str) -> set[str]:` 这一类工单允许的所有工具名。
- `return TOOLS_BY_CATEGORY.get(category, set()) | {"search_kb"}` `.get(category, set())` 是字典取值带默认值,类别不认识就当作空集。`|` 是集合并集,相当于 `new Set([...a, ...b])`。实测 `refund` 得到 5 个名字。
- `def specs(self, category: str, customer_id: str | None = None) -> list[dict[str, Any]]:` 给模型看的工具清单。
- `names = self.allowed(category)` 先取本类允许的。
- `if customer_id:` 客户已经绑定时:
- `names = names - {"find_customer"}` `-` 是集合差集,去掉 `find_customer`。身份已确定,模型没有理由去找别的客户。
- `return [s for s in self.mcp.tool_specs() if s["function"]["name"] in names] + [SEARCH_KB_SPEC]` 从 MCP 的 4 个工具里留下允许的,再加上本地的 `search_kb`。`bug` 类得到只有一项的列表。
- `def execute(self, call: Mapping[str, Any], category: str, customer_id: str | None) -> str:` 真正执行一次调用。`call` 声明成 `Mapping` 而不是 `dict`:LangChain 的 `ToolCall` 是 `TypedDict`,类型检查器认为它不是 `dict`,用 `Mapping` 两边都能接。
- `name, args = call["name"], call.get("args") or {}` `call` 形如 `{"name": "list_invoices", "args": {"customer_id": "C007", "limit": 20}, "id": "call_..."}`。`args` 缺了或是空值时当空字典。
- `if name not in self.allowed(category):` 第一道:类别权限。就算模型凭空编出一个本类别没有的工具名,这里也拒绝。
- `return f"[工具报错] {category} 类工单不能调用 {name}"` 返回的文字会原样交给模型,写清楚「哪类工单不能调哪个工具」,模型才知道该改做什么。
- `if name == "search_kb":` 本地函数,不经过 MCP,也不需要客户检查。
- `return json.dumps(search_kb(args.get("query", "")), ensure_ascii=False)` 检索结果转成 JSON 字符串。实测明天的 T1001(导出报表报错)里,模型查了 `search_kb({"query": "导出超时 ERR_EXPORT_TIMEOUT"})`,第一条是 `kb-014#1`。
- `if customer_id and name == "find_customer":` 第二道,补漏洞的那一行:客户已经绑定,`find_customer` 一律拒绝。
- `return f"[拒绝] 客户已确定为 {customer_id},不需要再查找别的客户"` 同样是文字。
- `if customer_id and "customer_id" in args and args["customer_id"] != customer_id:` 第三道:带 `customer_id` 参数的调用,必须等于绑定的客户。代入:绑定 C007,模型要查 `{"customer_id": "C008"}`,不相等,拒绝,根本不会去调 MCP。
- `return self.mcp.call(name, args)` 三道都过了才真的调。

</div>

先跑一遍,看每一类工单、绑不绑定客户,模型分别能看到什么,再看桥取回来的第一个工具长什么样:

```python
# agent-zero-lab/part05/router/ex338_specs.py
"""看每一类工单能看到哪些工具;绑定客户 C007 以后又是哪些。再看桥取回来的第一个工具长什么样。不调模型。"""
import json

from part05.router.toolbox import TOOLS_BY_CATEGORY, Toolbox

box = Toolbox()
for category in TOOLS_BY_CATEGORY:
    plain = sorted(s["function"]["name"] for s in box.specs(category))
    bound = sorted(s["function"]["name"] for s in box.specs(category, "C007"))
    print(f"{category:<8} {plain}")
    print(f"{'':<8} 绑定 C007 后 {bound}")
print(json.dumps(box.mcp.tool_specs()[0], ensure_ascii=False, indent=1))
```

<div class="line-notes">

- `box = Toolbox()` 不传库路径,用 server 默认的库。这里只读工具清单,不执行任何工具。
- `for category in TOOLS_BY_CATEGORY:` 遍历六个类别。
- `plain = sorted(s["function"]["name"] for s in box.specs(category))` 没绑定客户时的清单,取名字、排序,输出好对照。
- `bound = sorted(s["function"]["name"] for s in box.specs(category, "C007"))` 绑定 C007 以后的清单。
- `print(f"{category:<8} {plain}")` `:<8` 左对齐占 8 格。
- `print(f"{'':<8} 绑定 C007 后 {bound}")` 空字符串占 8 格,让第二行缩进对齐。
- `print(json.dumps(box.mcp.tool_specs()[0], ensure_ascii=False, indent=1))` 桥取回来的第一个工具,看看 MCP 的描述转成 OpenAI 格式长什么样。

</div>

```bash
uv run python -m part05.router.ex338_specs
```

```text
refund   ['create_refund_request', 'find_customer', 'get_subscription', 'list_invoices', 'search_kb']
         绑定 C007 后 ['create_refund_request', 'get_subscription', 'list_invoices', 'search_kb']
billing  ['find_customer', 'get_subscription', 'list_invoices', 'search_kb']
         绑定 C007 后 ['get_subscription', 'list_invoices', 'search_kb']
invoice  ['find_customer', 'list_invoices', 'search_kb']
         绑定 C007 后 ['list_invoices', 'search_kb']
bug      ['search_kb']
         绑定 C007 后 ['search_kb']
account  ['search_kb']
         绑定 C007 后 ['search_kb']
other    ['get_subscription', 'search_kb']
         绑定 C007 后 ['get_subscription', 'search_kb']
{
 "type": "function",
 "function": {
  "name": "find_customer",
  "description": "按邮箱/姓名/公司/编号查找客户,返回最多 5 条。查订阅和发票前先用它拿到 customer_id。",
  "parameters": {
   "type": "object",
   "properties": {
    "query": {
     "description": "客户邮箱、姓名、公司名或客户编号(如 C007),支持部分匹配",
     "title": "Query",
     "type": "string"
    }
   },
   "required": [
    "query"
   ],
   "title": "find_customerArguments"
  }
 }
}
```

`bug` 和 `account` 只剩 `search_kb`,绑定了客户以后 `find_customer` 从所有类别里消失,`refund` 是唯一有 `create_refund_request` 的。最后那段 JSON 就是 `find_customer` 转成 OpenAI 工具格式以后的样子:`description` 是 server 里函数的 docstring,`parameters` 是 Day 281 讲过的、由类型标注生成的 JSON Schema。

两个细节值得停一下。

一是检查全部返回**文字**,没有抛异常。模型下一轮读到「[拒绝] 只能查询工单所属客户 C007 的数据」,会改口告诉客户「我只能查您自己的数据」;如果抛异常,整张图就崩了。

二是 `specs` 和 `execute` 各检查了一遍类别,看着重复。其实意义不同:`specs` 决定模型**看到**什么,是为了让模型少受干扰、少走弯路;`execute` 决定调用**能不能执行**,是真正的安全边界。模型看不到不等于调不了,它完全可能写出一个没见过的工具名。两层都要有。

## 第 4 步:不调模型,把这几条规矩写成测试

检查逻辑一个字都没碰到模型,可以全部用 pytest 守住。Day 287 讲过,测试里别用真的业务库,每个测试用临时库;`seed.py` 的库路径是模块变量,要用 `monkeypatch` 把它改成临时文件,不然 `seed.main()` 会把你真正的 `cloudledger.db` 删掉重建。

```python
# agent-zero-lab/part05/router/test_toolbox.py
"""工具层的测试:不调模型。每个测试用一份临时的业务库,互不影响。"""
import json
import sqlite3
from pathlib import Path

import pytest

from cloudledger import seed
from part05.router.toolbox import Toolbox


@pytest.fixture(scope="module")
def db(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("router") / "cl.db"
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(seed, "DB_PATH", path)  # seed.py 的库路径是模块变量:不改的话 main() 会删掉真正的 cloudledger.db
        seed.main()
    return path


@pytest.fixture(scope="module")
def box(db: Path) -> Toolbox:
    return Toolbox(db)


def names(specs: list[dict]) -> set[str]:
    return {s["function"]["name"] for s in specs}


def test_bug_tickets_only_get_search_kb(box: Toolbox) -> None:
    assert names(box.specs("bug")) == {"search_kb"}


def test_only_refund_sees_create_refund_request(box: Toolbox) -> None:
    for cat in ("billing", "invoice", "bug", "account", "other"):
        assert "create_refund_request" not in names(box.specs(cat)), cat
    assert "create_refund_request" in names(box.specs("refund"))


def test_unknown_tool_name_is_refused(box: Toolbox) -> None:
    out = box.execute({"name": "create_refund_request", "args": {"invoice_id": "INV-2026-0123", "amount_yuan": 1, "reason": "试试看"}}, "bug", "C007")
    assert out.startswith("[工具报错]") and "不能调用" in out


def test_other_customers_data_is_refused(box: Toolbox) -> None:
    out = box.execute({"name": "list_invoices", "args": {"customer_id": "C008"}}, "billing", "C007")
    assert out.startswith("[拒绝]")


def test_find_customer_is_closed_once_identity_is_bound(box: Toolbox) -> None:
    out = box.execute({"name": "find_customer", "args": {"query": "user008@example.com"}}, "billing", "C007")
    assert out.startswith("[拒绝]")
    assert "find_customer" not in names(box.specs("billing", "C007"))
    assert "find_customer" in names(box.specs("billing", None))


def test_own_invoices_work(box: Toolbox) -> None:
    out = box.execute({"name": "list_invoices", "args": {"customer_id": "C007", "limit": 2}}, "refund", "C007")
    rows = json.loads(out)["result"]
    assert [r["id"] for r in rows] == ["INV-2026-0123", "INV-2026-0026"]


def test_mcp_errors_get_a_prefix(box: Toolbox) -> None:
    out = box.execute({"name": "get_subscription", "args": {"customer_id": "c007"}}, "billing", None)
    assert out.startswith("[工具报错]")


def test_refund_request_lands_as_pending(box: Toolbox, db: Path) -> None:
    call = {"name": "create_refund_request", "args": {"invoice_id": "INV-2026-0123", "amount_yuan": 2392, "reason": "重复扣款,依据 kb-002#3"}}
    out = box.execute(call, "refund", "C007")
    assert json.loads(out)["status"] == "pending_approval"
    with sqlite3.connect(db) as conn:
        assert conn.execute("SELECT status FROM refund_requests").fetchall() == [("pending_approval",)]
```

<div class="line-notes">

- `"""工具层的测试:不调模型。` 每个测试用一份临时的业务库,互不影响。
- `import pytest` Day 287 起用的测试框架,相当于 jest。
- `from cloudledger import seed` 造数据的脚本,当模块导入,用它的 `DB_PATH` 变量和 `main()` 函数。`cloudledger` 目录里没有 `__init__.py`,Python 把它当作「命名空间包」,从根目录运行时能直接导入。
- `from part05.router.toolbox import Toolbox` 被测的对象。
- `@pytest.fixture(scope="module")` fixture 是「测试要用的准备工作」,类似 jest 的 `beforeAll` 返回一个值。`scope="module"` 表示整个文件只做一次。
- `def db(tmp_path_factory: pytest.TempPathFactory) -> Path:` `tmp_path_factory` 是 pytest 给的,能造临时目录;模块级 fixture 不能用只管单个测试的 `tmp_path`。
- `path = tmp_path_factory.mktemp("router") / "cl.db"` 一个临时目录里的 `cl.db`,测试结束后 pytest 会清理。
- `with pytest.MonkeyPatch.context() as mp:` 模块级 fixture 拿不到只管单个测试的 `monkeypatch`,用 `MonkeyPatch.context()` 开一个临时的,出了 `with` 自动还原。
- `mp.setattr(seed, "DB_PATH", path)` 把 `seed` 模块里的 `DB_PATH` 换成临时文件。这一行不写,下一行就会删掉你真正的库。注释里写明原因,以后别人(包括半年后的你)不会把它当多余的删掉。
- `seed.main()` 在临时路径上造一份和 Day 280 一模一样的数据:30 个客户、123 张发票。
- `def box(db: Path) -> Toolbox:` 一个 fixture 可以依赖另一个,写在参数里。`Toolbox(db)` 让 server 子进程读这份临时库。
- `def names(specs: list[dict]) -> set[str]:` 辅助函数:从工具清单里取出工具名的集合,测试里断言方便。
- `assert names(box.specs("bug")) == {"search_kb"}` bug 类只能看到 `search_kb`。
- `for cat in ("billing", "invoice", "bug", "account", "other"):` 除 refund 以外的五类,挨个检查没有退款工具。`assert` 后面的 `, cat` 是失败时附带的说明,哪一类出了问题一眼看到。
- `out = box.execute({"name": "create_refund_request"` 模拟一个「模型凭空写出本类没有的工具名」。
- `assert out.startswith("[工具报错]") and "不能调用" in out` 返回的是带前缀的文字,不是异常。
- `out = box.execute({"name": "list_invoices", "args": {"customer_id": "C008"}}` 绑定 C007,查 C008。
- `assert out.startswith("[拒绝]")` 被拒。
- `out = box.execute({"name": "find_customer", "args": {"query": "user008@example.com"}}` 刚才那个漏洞,变成了回归测试。
- `assert "find_customer" not in names(box.specs("billing", "C007"))` 绑定了客户,清单里没有 `find_customer`。
- `assert "find_customer" in names(box.specs("billing", None))` 没绑定客户(比如匿名工单)时它还在,模型需要靠它找人。
- `rows = json.loads(out)["result"]` 正常路径也要测:查自己的发票。`result` 就是前面说的 SDK 包的那层。
- `assert [r["id"] for r in rows] == ["INV-2026-0123", "INV-2026-0026"]` C007 在 10 月 8 日有两张金额相同的发票,按开票日倒序、同日按编号倒序,0123 在前。
- `out = box.execute({"name": "get_subscription", "args": {"customer_id": "c007"}}` 传小写的 `c007`,server 里 `customer_id` 参数声明了 `pattern=r"^C\d{3}$"`,校验不过。
- `assert out.startswith("[工具报错]")` MCP 返回的错误被桥加上了前缀。
- `assert json.loads(out)["status"] == "pending_approval"` 提交退款申请后状态是待审批,不是已退款。
- `assert conn.execute("SELECT status FROM refund_requests").fetchall() == [("pending_approval",)]` 回到临时库里数一数:恰好一行,状态待审批。这条放在最后,因为它往库里写了一行。

</div>

```bash
uv run pytest part05/router/test_toolbox.py -v
```

```text
part05/router/test_toolbox.py::test_bug_tickets_only_get_search_kb PASSED [ 12%]
part05/router/test_toolbox.py::test_only_refund_sees_create_refund_request PASSED [ 25%]
part05/router/test_toolbox.py::test_unknown_tool_name_is_refused PASSED  [ 37%]
part05/router/test_toolbox.py::test_other_customers_data_is_refused PASSED [ 50%]
part05/router/test_toolbox.py::test_find_customer_is_closed_once_identity_is_bound PASSED [ 62%]
part05/router/test_toolbox.py::test_own_invoices_work PASSED             [ 75%]
part05/router/test_toolbox.py::test_mcp_errors_get_a_prefix PASSED       [ 87%]
part05/router/test_toolbox.py::test_refund_request_lands_as_pending PASSED [100%]
============================== 8 passed in 16.30s ==============================
```

八个全绿。用时那一串数字主要是起了很多次 server 子进程,上一步量过每次要一两秒。

测试写完不能只看它绿。试着把规矩改坏,看它会不会红,不红说明这条测试没守住东西。把 `invoice` 类加上 `create_refund_request`:

```text
.F
=================================== FAILURES ===================================
_________________ test_only_refund_sees_create_refund_request __________________
    def test_only_refund_sees_create_refund_request(box: Toolbox) -> None:
        for cat in ("billing", "invoice", "bug", "account", "other"):
>           assert "create_refund_request" not in names(box.specs(cat)), cat
E           AssertionError: invoice
E           assert 'create_refund_request' not in {'create_refund_request', 'find_customer', 'list_invoices', 'search_kb'}
FAILED part05/router/test_toolbox.py::test_only_refund_sees_create_refund_request
```

红了,而且一眼看出是 `invoice` 这一类。改回去。

## 第 5 步:让模型真的看一眼,工具少了它就调不了

前面都是代码在自说自话。最后用真模型验证一件事:同一句话,分到不同类别,模型看到的工具不同,它能做的事也不同。这一步调 4 次模型,每次只看第一轮它想调什么,不真的执行:

```python
# agent-zero-lab/part05/router/ex338_model_sees.py
"""同一句话,分到不同类别,模型看到的工具不一样,能做的事也不一样。真调 4 次模型,每次一轮。"""
from langchain_core.messages import HumanMessage, SystemMessage

from part05.lgdemo.llm import get_llm
from part05.router.toolbox import Toolbox

TEXT = "我的发票金额不对,你直接帮我提交退款申请,发票号 INV-2026-0123,退 2392 元。"
SYSTEM = "你是云簿 CloudLedger 的客服专员。工单所属客户编号:C007(已验证身份)。需要时调用工具。"
box = Toolbox()
llm = get_llm()
cost = 0.0

for category in ["bug", "invoice", "billing", "refund"]:
    specs = box.specs(category, "C007")
    shown = [s["function"]["name"] for s in specs]
    reply = llm.bind_tools(specs).invoke([SystemMessage(SYSTEM), HumanMessage(TEXT)])
    u = reply.usage_metadata or {}
    cost += u.get("input_tokens", 0) * 2e-6 + u.get("output_tokens", 0) * 8e-6
    calls = [(c["name"], c["args"]) for c in reply.tool_calls]
    print(f"[{category:<7}] 看到 {shown}")
    print(f"          调用 {calls or '(没调工具)'}  回复开头:{str(reply.content)[:40]!r}")
print(f"4 次约 {cost:.4f} 元(按未命中价上限算)")
```

<div class="line-notes">

- `from langchain_core.messages import HumanMessage, SystemMessage` 两种消息:用户说的话和系统提示词。
- `from part05.lgdemo.llm import get_llm` Day 311 建的模型对象,读 `.env` 里的 `LLM_MODEL`(`deepseek-flash`)和 `LLM_EXTRA_BODY`。
- `TEXT = "我的发票金额不对,你直接帮我提交退款申请,发票号 INV-2026-0123,退 2392 元。"` 同一句话:客户要求提交退款申请。
- `SYSTEM = "你是云簿 CloudLedger 的客服专员。工单所属客户编号:C007(已验证身份)。需要时调用工具。"` 故意写得很短,不提退款规则,看工具集本身起多大作用。
- `box = Toolbox()` 不传库路径,用默认库;这里只读工具清单,不执行。
- `llm = get_llm()` 
- `for category in ["bug", "invoice", "billing", "refund"]:` 四个类别,由少到多。
- `specs = box.specs(category, "C007")` 绑定客户 C007,所以没有 `find_customer`。
- `shown = [s["function"]["name"] for s in specs]` 把这一类看到的工具名列出来。
- `reply = llm.bind_tools(specs).invoke([SystemMessage(SYSTEM), HumanMessage(TEXT)])` `bind_tools` 把工具清单随请求发给模型;`invoke` 只问一轮,拿到的是 `AIMessage`,它的 `tool_calls` 里就是模型想调的工具。
- `u = reply.usage_metadata or {}` 这次请求用了多少 token。
- `cost += u.get("input_tokens", 0) * 2e-6 + u.get("output_tokens", 0) * 8e-6` 按 DeepSeek 未命中缓存的价格(输入 2 元、输出 8 元每百万 token,2026 年 10 月 `.env` 里 `LLM_PRICE` 的值)算上限。
- `calls = [(c["name"], c["args"]) for c in reply.tool_calls]` 取出每个调用的名字和参数。

</div>

```bash
uv run python -m part05.router.ex338_model_sees
```

```text
[bug    ] 看到 ['search_kb']
          调用 [('search_kb', {'query': '发票金额错误 退款申请 流程'}), ('search_kb', {'query': '退款 权限 客服 提交'})]  回复开头:'我先查一下退款和发票相关的规则，再帮您处理。'
[invoice] 看到 ['list_invoices', 'search_kb']
          调用 [('list_invoices', {'customer_id': 'C007', 'limit': 20}), ('search_kb', {'query': '退款申请 流程 发票金额错误'})]  回复开头:'我先核实一下这张发票的信息，再按流程处理。'
[billing] 看到 ['get_subscription', 'list_invoices', 'search_kb']
          调用 [('list_invoices', {'customer_id': 'C007', 'limit': 20}), ('get_subscription', {'customer_id': 'C007'})]  回复开头:'我先核实一下这张发票和您的订阅情况。'
[refund ] 看到 ['get_subscription', 'list_invoices', 'create_refund_request', 'search_kb']
          调用 [('list_invoices', {'customer_id': 'C007', 'limit': 20}), ('get_subscription', {'customer_id': 'C007'})]  回复开头:'我先核实一下这张发票和您的订阅情况，再决定能否提交退款申请。'
4 次约 0.0079 元(按未命中价上限算)
```

`bug` 类只看得到 `search_kb`,模型想的是先查帮助中心里的退款规则。`invoice` 类多了 `list_invoices`,它先去核实发票。`refund` 类四个工具都有,包括 `create_refund_request`,但第一轮它**也没有直接提交**,先查订阅和发票,再决定。这个行为是提示词和模型自己的谨慎带来的,不是权限表带来的,权限表只保证 `bug` 类这一轮即使想提交也提交不了。两件事要分清:模型守规矩是运气好,工具层拦住是保证。

四次一共约 0.008 元。

## 零件和明天的对应

| 今天的零件 | 在哪一步 | 明天 graph.py 里怎么用 |
| --- | --- | --- |
| `search_kb(query, k)` | 第 1 步 | `retrieve` 节点调它;同时通过 `Toolbox` 也交给模型当工具 |
| `run_sync` + `CloudLedgerMCP` | 第 2 步 | 图的节点是同步函数,靠它调 MCP;退款政策靠 `read_resource` 取 |
| `TOOLS_BY_CATEGORY`、`Toolbox.specs` | 第 3 步 | `agent` 节点每次调模型前取工具清单 |
| `Toolbox.execute` 的三道检查 | 第 3 步 | `tools` 节点和 `approval` 节点都调它,所有工具调用只有这一个出口 |
| `ERROR_PREFIXES` | 第 3 步 | 构造 `ToolMessage` 时判断 `status` 是 `error` 还是 `success` |
| `test_toolbox.py` 的 fixture | 第 4 步 | 明天 `test_graph.py` 复用同样的临时库写法 |

## 动手练习

1. **检索漏了多少。** 写 `part05/router/ex338_kb_miss.py`,准备 8 句客户的口语说法(含「被扣了两次款」「钱扣多了」「登不进去」),每句配上你认为该命中的块编号,统计 `search_kb` 前 3 条里命中了几句。再想办法补漏,但要如实说明你补漏的做法有什么问题。
2. **account 类的测试。** 给 `account` 类写一条测试:清单里只有 `search_kb`,而且 `find_customer`、`get_subscription`、`list_invoices` 三个业务工具直接调用都被拒绝。
3. **改坏权限表。** 把 `TOOLS_BY_CATEGORY["invoice"]` 加上 `create_refund_request`,跑 `test_toolbox.py`,看哪条红、报错怎么写。再试着删掉 `execute` 里的越权检查(第三道),看红的有哪几条。每次改完记得还原。
4. **审计日志。** 写一个 `Toolbox` 的子类,每次 `execute` 往 `audit.jsonl` 追加一行 JSON:哪类工单、哪个客户、调了什么工具、参数、成没成。并写测试证明被拒的调用也记了。
5. **写工具的清单不手写。** 现在「谁是写工具」这件事靠我们自己记得是 `create_refund_request`。写一个测试,从 MCP server 的 `annotations`(Day 283 的 `read_only_hint`)里读出所有写工具,再断言它们只出现在 `refund` 类的名单里。以后 server 加了新的写工具,测试会自己发现。

<details><summary>参考答案</summary>

**练习 1。** 先量漏了多少:

```python
# agent-zero-lab/part05/router/ex338_kb_miss.py
"""练习 1:客户的几种说法,字二元组检索能不能找到想要的那一段。"""
from part05.router.kb import search_kb

CASES = [  # (客户的说法, 应该命中的块)
    ("被扣了两次款", "kb-002#3"),
    ("重复扣款", "kb-002#3"),
    ("钱扣多了", "kb-002#3"),
    ("怎么退钱", "kb-003#1"),
    ("退款多久到账", "kb-002#4"),
    ("登不进去", "kb-016#1"),
    ("发票开错了", "kb-007#1"),
    ("导出一直超时", "kb-014#2"),
]
if __name__ == "__main__":
    hit = 0
    for query, want in CASES:
        hits = [h["id"] for h in search_kb(query)]
        status = "命中" if want in hits else ("空" if not hits else "偏")
        hit += want in hits
        print(f"{status}  {query:<8} 想要 {want:<9} 实际 {hits}")
    print(f"{hit}/{len(CASES)} 命中")
```

<div class="line-notes">

- `CASES = [  # (客户的说法, 应该命中的块)` 每句口语配一个「应该命中」的块编号。编号我是对着 `data/kb/` 里的文章找的,不是随便写的。
- `("被扣了两次款", "kb-002#3"),` 退款政策里的「重复扣款」一节。
- `("怎么退钱", "kb-003#1"),` 「如何申请退款」文章的操作步骤那一节。
- `hit = 0` 命中计数。
- `hits = [h["id"] for h in search_kb(query)]` 取前 3 条的块编号。
- `status = "命中" if want in hits else ("空" if not hits else "偏")` 三种结果:命中;一条都没有(空);有结果但不是想要的(偏)。后两种对用户来说都是「没找到」,但原因不同,「空」是用字对不上,「偏」是被别的字带歪了。
- `hit += want in hits` 布尔值可以直接加,`True` 当 1。
- `print(f"{status}  {query:<8} 想要 {want:<9} 实际 {hits}")` `:<8` 是左对齐占 8 格,让输出整齐。

</div>

```text
空  被扣了两次款   想要 kb-002#3  实际 []
命中  重复扣款     想要 kb-002#3  实际 ['kb-002#3', 'kb-004#1', 'kb-004#2']
空  钱扣多了     想要 kb-002#3  实际 []
偏  怎么退钱     想要 kb-003#1  实际 ['kb-008#2', 'kb-001#2', 'kb-007#1']
命中  退款多久到账   想要 kb-002#4  实际 ['kb-002#4', 'kb-003#1', 'kb-002#3']
空  登不进去     想要 kb-016#1  实际 []
命中  发票开错了    想要 kb-007#1  实际 ['kb-007#1', 'kb-006#1', 'kb-012#2']
命中  导出一直超时   想要 kb-014#2  实际 ['kb-014#1', 'kb-015#1', 'kb-014#2']
4/8 命中
```

8 句里 4 句命中,3 句是空(「被扣了两次款」「钱扣多了」「登不进去」),1 句偏了(「怎么退钱」的第一名是 kb-008#2)。口语说法一多,字二元组就不够用了。

补漏的做法:加一张同义词表,查询里出现客户的说法,就把帮助中心的说法补在后面。

```python
# agent-zero-lab/part05/router/ex338_kb_syn.py
"""练习 1 参考答案:给检索加一张同义词表,查询里出现客户的说法,就把帮助中心的说法补在后面。"""
from part05.router.ex338_kb_miss import CASES
from part05.router.kb import search_kb

SYNONYMS = {
    "扣了两次": "重复扣款",
    "钱扣多了": "重复扣款",
    "退钱": "退款 申请 步骤",
    "登不进去": "登录 验证码 两步验证",
}


def expand(query: str) -> str:
    extra = [v for k, v in SYNONYMS.items() if k in query]
    return " ".join([query, *extra])


def search_kb_syn(query: str, k: int = 3) -> list[dict]:
    return search_kb(expand(query), k)


if __name__ == "__main__":
    hit = 0
    for query, want in CASES:
        ids = [h["id"] for h in search_kb_syn(query)]
        hit += want in ids
        print(f"{'命中' if want in ids else '没中'}  {query:<8} {ids}")
    print(f"{hit}/{len(CASES)} 命中")
```

<div class="line-notes">

- `from part05.router.ex338_kb_miss import CASES` 复用上面那 8 句。
- `SYNONYMS = {` 一张手写的对照表:客户的说法 → 帮助中心的说法。
- `"扣了两次": "重复扣款",` 「被扣了两次款」里包含「扣了两次」,命中这一条。
- `"退钱": "退款 申请 步骤",` 补三个词,希望把「如何申请退款」那篇拉进来。
- `def expand(query: str) -> str:` 把同义词补在查询后面。
- `extra = [v for k, v in SYNONYMS.items() if k in query]` 查询里出现了哪些「客户说法」,就取对应的「帮助中心说法」。`k in query` 是字符串包含判断。
- `return " ".join([query, *extra])` `*extra` 把列表展开,相当于 JS 的 `[query, ...extra]`;再用空格连起来。
- `def search_kb_syn(query: str, k: int = 3) -> list[dict]:` 对外和 `search_kb` 签名一样,明天要换进图里不用改别的。
- `hit += want in ids` 统计命中。

</div>

```text
命中  被扣了两次款   ['kb-002#3', 'kb-004#1', 'kb-004#2']
命中  重复扣款     ['kb-002#3', 'kb-004#1', 'kb-004#2']
命中  钱扣多了     ['kb-002#3', 'kb-004#1', 'kb-004#2']
命中  怎么退钱     ['kb-003#1', 'kb-003#2', 'kb-008#2']
命中  退款多久到账   ['kb-002#4', 'kb-003#1', 'kb-002#3']
命中  登不进去     ['kb-016#1', 'kb-016#2']
命中  发票开错了    ['kb-007#1', 'kb-006#1', 'kb-012#2']
命中  导出一直超时   ['kb-014#1', 'kb-015#1', 'kb-014#2']
8/8 命中
```

8/8,看着很漂亮,但**这是作弊**:这张同义词表是我对着这 8 句话写的,等于考前看了答案。真要知道它有没有用,得拿它没见过的说法去测。这个道理就是第六部分的主题,评测集必须和你调参用的那批题分开。眼下的结论只能是「同义词表对这 8 句有效,对新说法不知道」。

**练习 2。** 复用上面的 fixture,新建 `test_ex338.py`:

```python
# agent-zero-lab/part05/router/test_ex338.py
"""练习 2、4 的参考答案:account 类的测试,和带审计日志的工具箱。"""
import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from part05.router.test_toolbox import db, names  # noqa: F401  复用上一个文件的临时库 fixture
from part05.router.toolbox import Toolbox


class AuditedToolbox(Toolbox):
    """每次 execute 追加一行 JSON 到日志:哪类工单、哪个客户、调了什么、成没成。"""

    def __init__(self, db_path: Path, log_path: Path) -> None:
        super().__init__(db_path)
        self.log_path = log_path

    def execute(self, call: Mapping[str, Any], category: str, customer_id: str | None) -> str:
        out = super().execute(call, category, customer_id)
        row = {"category": category, "customer_id": customer_id, "tool": call["name"],
               "args": call.get("args") or {}, "ok": not out.startswith(("[工具报错]", "[拒绝]"))}
        with self.log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
        return out


@pytest.fixture(scope="module")
def box(db: Path) -> Toolbox:  # noqa: F811
    return Toolbox(db)


def test_account_tickets_cannot_touch_business_data(box: Toolbox) -> None:
    assert names(box.specs("account", "C007")) == {"search_kb"}
    for tool, args in [("find_customer", {"query": "C007"}), ("get_subscription", {"customer_id": "C007"}),
                       ("list_invoices", {"customer_id": "C007"})]:
        out = box.execute({"name": tool, "args": args}, "account", "C007")
        assert out.startswith("[工具报错]"), tool


def test_audit_log_records_refusals(db: Path, tmp_path: Path) -> None:  # noqa: F811
    log = tmp_path / "audit.jsonl"
    box = AuditedToolbox(db, log)
    box.execute({"name": "list_invoices", "args": {"customer_id": "C007", "limit": 1}}, "billing", "C007")
    box.execute({"name": "list_invoices", "args": {"customer_id": "C008"}}, "billing", "C007")
    rows = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]
    assert [r["ok"] for r in rows] == [True, False]
    assert rows[1]["args"] == {"customer_id": "C008"}
```

<div class="line-notes">

- `from part05.router.test_toolbox import db, names  # noqa: F401  复用上一个文件的临时库 fixture` 把上一个测试文件里的 `db` fixture 和 `names` 辅助函数导入。`noqa` 是告诉代码检查器「这行 import 看起来没用到,别提醒」,fixture 是靠名字被 pytest 找到的。
- `class AuditedToolbox(Toolbox):` 练习 4 的子类:继承 `Toolbox`,只多一件事。
- `def __init__(self, db_path: Path, log_path: Path) -> None:` 多接一个日志路径。
- `super().__init__(db_path)` 先让父类把桥建好,`super()` 相当于 JS 子类构造函数里的 `super(...)`。
- `out = super().execute(call, category, customer_id)` 调用父类的 `execute`(三道检查加真调用),结果先拿到。
- `row = {"category": category, "customer_id": customer_id, "tool": call["name"],` 要记的字段。
- `"args": call.get("args") or {}, "ok": not out.startswith(("[工具报错]", "[拒绝]"))}` `startswith` 传元组表示「以其中任何一个开头」。以这两个前缀开头就是没成功。
- `with self.log_path.open("a", encoding="utf-8") as f:` `"a"` 是追加模式,相当于 Node 的 `fs.appendFileSync`。
- `f.write(json.dumps(row, ensure_ascii=False) + "\n")` 一行一个 JSON(JSONL),方便以后一行行读回来。
- `def test_account_tickets_cannot_touch_business_data(box: Toolbox) -> None:` 练习 2 的测试。
- `assert names(box.specs("account", "C007")) == {"search_kb"}` 清单里只有检索。
- `for tool, args in [("find_customer"` 三个业务工具各调一次。
- `assert out.startswith("[工具报错]"), tool` 都在第一道(类别权限)就被拒了。后面的 `, tool` 让失败时能看到是哪个工具。
- `def test_audit_log_records_refusals(db: Path, tmp_path: Path) -> None:` 练习 4 的测试。
- `rows = [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]` 把日志一行行读回来变成字典。
- `assert [r["ok"] for r in rows] == [True, False]` 第一条成功,第二条(查 C008)失败。
- `assert rows[1]["args"] == {"customer_id": "C008"}` 被拒的那条,参数也完整记下了:以后查「谁试图越权」就靠它。

</div>

**练习 5。**

```python
# agent-zero-lab/part05/router/test_ex338_writes.py
"""练习 5 参考答案:写工具的清单不手写,从 server 的 annotations 里读;再断言「写工具只出现在 refund 类」。"""
from mcp import Client

from part05.router.mcp_bridge import CloudLedgerMCP, run_sync
from part05.router.toolbox import TOOLS_BY_CATEGORY


def write_tools(mcp: CloudLedgerMCP) -> set[str]:
    async def go() -> set[str]:
        async with Client(mcp.params) as c:
            listing = await c.list_tools()
        return {t.name for t in listing.tools if not (t.annotations and t.annotations.read_only_hint)}
    return run_sync(go)


def test_write_tools_only_in_refund() -> None:
    writes = write_tools(CloudLedgerMCP())
    assert writes == {"create_refund_request"}
    for category, tools in TOOLS_BY_CATEGORY.items():
        if category != "refund":
            assert not (tools & writes), f"{category} 类能用写工具 {tools & writes}"
```

<div class="line-notes">

- `from mcp import Client` 直接用 SDK 的 client 去问 server,不走桥,因为桥把 `annotations` 丢掉了。
- `def write_tools(mcp: CloudLedgerMCP) -> set[str]:` 返回 server 里所有「不是只读」的工具名。
- `async with Client(mcp.params) as c:` 复用桥里已经配好的启动参数。
- `listing = await c.list_tools()` 每个 `Tool` 带 `annotations`,里面有 Day 283 标的 `read_only_hint`。
- `return {t.name for t in listing.tools if not (t.annotations and t.annotations.read_only_hint)}` 集合推导式:没有标注,或者标注里 `read_only_hint` 不是真,都算写工具。没标的当作会写,更保守。
- `return run_sync(go)` 用第 2 步的同步桥。
- `assert writes == {"create_refund_request"}` 目前 server 里只有这一个写工具。
- `for category, tools in TOOLS_BY_CATEGORY.items():` 遍历每一类。
- `assert not (tools & writes), f"{category} 类能用写工具 {tools & writes}"` `&` 是集合交集,不为空说明这一类能用写工具。失败时直接打印是哪一类、哪个工具。

</div>

```text
part05/router/test_ex338.py::test_account_tickets_cannot_touch_business_data PASSED [ 33%]
part05/router/test_ex338.py::test_audit_log_records_refusals PASSED      [ 66%]
part05/router/test_ex338_writes.py::test_write_tools_only_in_refund PASSED [100%]
============================== 3 passed in 10.89s ==============================
```

**练习 3。** 把 `invoice` 加上 `create_refund_request`:`test_only_refund_sees_create_refund_request` 红,报错 `AssertionError: invoice`(正文贴过)。删掉第三道检查(`execute` 里比较 `customer_id` 那三行)再跑全部测试,我这边红了三条:

```text
FAILED part05/router/test_ex338.py::test_audit_log_records_refusals
FAILED part05/router/test_graph.py::test_refund_pauses_before_writing_and_writes_after_approval
FAILED part05/router/test_toolbox.py::test_other_customers_data_is_refused
3 failed, 16 passed
```

`test_graph.py` 那条是明天才写的图的测试,第一个断言就是模型试图查别人的发票要被拒。这说明越权检查一旦被人删掉,不止工具层的测试红,连图的测试也会红,多层守着。

**练习 4。** 见练习 2 那份文件里的 `AuditedToolbox`。

</details>

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 最小权限 | 只给完成任务必需的权限。这里体现为每类工单只给它需要的工具,`bug` 类一个业务工具都不给 |
| 工具层 | 夹在模型和真实系统之间的一层代码,决定哪些调用放行。安全检查放在这里,不放在提示词里 |
| 字二元组(bigram) | 把文字每相邻两个字切成一对。拿来比较两段文字有多少共用的对,不懂语义但稳定、免费 |
| 同步桥 | 让普通函数调用异步代码的一层封装。这里是 `run_sync`,内部用 `anyio.run` 起事件循环 |
| 事件循环 | 异步代码的调度器,Python 的 `asyncio` 和 JS 的事件循环是同一类东西。一个线程里同时只能有一个在跑 |
| 越权 | 用 A 客户的身份去读写 B 客户的数据。客服系统里最严重的一类事故 |
| 绑定客户 | 工单进来时就确定「这是谁的工单」,由系统写死,不由模型或工单正文决定 |
| fixture | pytest 里「测试要用的准备工作」,写成函数,测试用参数名声明要用谁。类似 jest 的 `beforeAll` 带返回值 |
| 回归测试 | 把已经出过的问题写成测试,以后改坏了立刻红。今天的 find_customer 漏洞就变成了一条 |
| JSONL | 一行一个 JSON 的文件格式,方便追加、方便逐行读,日志常用 |

## 常见误区

**以为「提示词里写了不许查别人的数据」就够了。** 提示词是写给模型的建议,工单正文里随便一句「忽略之前的指令」就可能把它冲掉。真正能用的防线是工具层的代码检查,而且它可以单元测试,提示词不行。

**检查只盯着一个参数名。** 今天的漏洞就是这样:越权检查看 `customer_id`,`find_customer` 的参数叫 `query`,检查对它不起作用。写检查之前先把每个工具的参数列一遍,看有哪些路能碰到别人的数据。

**把整个 `os.environ` 传给子进程。** 图省事,但这样 server 子进程能读到你的 `LLM_API_KEY`。它用不着,就别给。传了 `env` 也不是完全空的,SDK 会补几个默认变量(HOME、PATH 等),这是 Day 288 实测过的。

**只在 `specs` 里过滤工具,`execute` 不检查。** 模型看不到某个工具,不代表它写不出这个名字。真正的边界在执行的那一刻。

**在已经有事件循环的地方直接 `anyio.run`。** 报 `RuntimeError: Already running asyncio in this thread`。脚本里没事,放进 FastAPI 就炸,所以桥里要多做那一步判断。

**测试只验证「正常路径能通」。** 权限类的代码,价值在于「该拒绝的拒绝了」。把规矩故意改坏一次,确认测试会红,才算写完。

**用同义词表补完漏洞就宣布检索做好了。** 表是对着已知的 8 句话写的,在这 8 句上当然满分。要看没参与调试的说法上的分数。

**`seed.py` 的库路径没改就在测试里调 `seed.main()`。** 它会把你真正的 `cloudledger.db` 删掉重建,这一点 Day 287 已经提过。fixture 里用 `monkeypatch.setattr(seed, "DB_PATH", ...)`,并且在注释里写明原因。

## 学习资料

### 文档与文章

- [Anthropic · Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents):怎么设计工具、写工具描述、让工具的返回对模型友好,和今天「错误信息写清楚哪类工单不能调哪个工具」同一个思路,30 分钟。
- [OWASP · LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/):「给 Agent 的权限、功能、自主性过多」被列为 LLM 应用的十大风险之一,看它给的成因和缓解措施,和今天的最小权限对照,20 分钟。
- [Simon Willison · The lethal trifecta for AI agents](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/):私有数据、不可信内容、对外通信三样凑齐就危险。想一想工单 Agent 里这三样各是什么,10 分钟。
- [MCP 规范 · Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools):工具清单、调用、`isError` 的协议原文,今天桥里那个错误前缀就是对它的包装,15 分钟。
- [pytest · How to monkeypatch/mock modules and environments](https://docs.pytest.org/en/stable/how-to/monkeypatch.html):`monkeypatch` 和 `MonkeyPatch.context()` 的出处,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13YGA6hEdX&autoplay=0&high_quality=1" title="面试官问:Agent怎么防止Prompt注入?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大模型-阿水 · 面试官问:Agent怎么防止Prompt注入? · 7 分钟,面试题的讲法,听的时候对照今天的做法,把它提到的每种防御归到「提示词里」还是「工具层」。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13VgG6EEfk&autoplay=0&high_quality=1" title="【全网独创】企业级基于AI Agent的智能客服与工单协同系统" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序猿椰椰子 · 企业级基于 AI Agent 的智能客服与工单协同系统 · 39 分钟,一个更大的客服与工单协同系统的演示,先看它有哪些功能模块,再回头想今天我们只做了其中分流这一小块。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/js6rgedzjGs" title="Prompt Injection and the Lethal Trifecta - minimising risks of agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CharlieCowanAI · Prompt Injection and the Lethal Trifecta - minimising risks of agents · 英文,讲怎么通过减少 Agent 同时拿到的能力来降低风险,和「按类别给工具」是一个路子。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):讲 Agent 的那一章里有工具设计和风险的讨论,读完对照今天的权限表想一想:CloudLedger 里除了退款,还有哪些写操作你会设成要审批。英文原版。
- Michael Albada《Building Applications with AI Agents》(O'Reilly,2025):有专门讲工具、权限和安全边界的章节,选读。英文原版。

### 开源项目与代码

- [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk):今天用的 `Client`、`StdioServerParameters`、`read_resource` 都在这里,想知道默认给子进程哪几个环境变量,看 `stdio` 那一块的 `get_default_environment`。
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers):官方维护的参考 server 集合,看它们怎么限制可访问的目录和操作范围,和我们按类别限制工具是同一类问题。

## 自测

1. 为什么按类别给工具之后,`execute` 里还要再检查一遍类别?

<details><summary>答案</summary>

`specs` 控制的是模型「看到」什么,只是让它少受干扰。模型完全可能凭空写出一个没见过的工具名,或者被工单正文里的指令诱导去调某个工具。`execute` 是工具真正被执行前的最后一道关,边界必须设在这里。两层是互补的:`specs` 让模型少犯错,`execute` 保证犯了错也没事。

</details>

2. 今天第一版越权检查只看 `customer_id` 参数,漏了什么?怎么补?

<details><summary>答案</summary>

漏了 `find_customer`:它的参数叫 `query`,`"customer_id" in args` 永远是假,所以可以用邮箱、姓名等搜到别的客户的基本信息。补法是工单已经绑定客户时,根本不给这个工具(`specs` 去掉),真被调用也拒绝(`execute` 第二道检查)。同时把这次的复现写成回归测试。

</details>

3. `run_sync` 里为什么要先探测当前线程有没有事件循环?

<details><summary>答案</summary>

`anyio.run` 会新建一个事件循环,同一个线程里不能同时有两个,已经有循环时直接调用会抛 `RuntimeError: Already running asyncio in this thread`。探测到已经有循环,就把 `anyio.run` 放到一个新线程里,新线程没有循环,不冲突。这样同一个桥既能被命令行脚本同步调用,也能被 FastAPI 的接口调用。

</details>

4. 为什么 `StdioServerParameters` 的 `env` 只传 `CLOUDLEDGER_DB`,不直接传 `os.environ`?

<details><summary>答案</summary>

`os.environ` 里有 `LLM_API_KEY` 等密钥,server 子进程用不着它们。给了就多一个泄露面:server 里任何一行代码、任何一个依赖都能读到。只传需要的变量是最小权限的一个具体体现。传了 `env` 以后,SDK 仍会补上 HOME、PATH 等几个默认变量。

</details>

5. **面试题**:「你的客服 Agent 怎么防止它查到别的客户的数据?」

<details><summary>答案</summary>

要点:身份由系统确定,工单进来时就绑定已验证的客户编号,不由模型或用户输入决定;所有带客户标识的工具调用在执行层检查,参数必须等于绑定的客户,不一致直接拒绝并记日志;按场景给工具(最小权限),比如技术故障类工单一个业务工具都不给;类似 `find_customer` 这种参数名不叫 `customer_id` 但能碰到别人数据的工具要单独处理,我项目里就踩过,绑定客户后直接不给这个工具;检查逻辑写成测试,越权的复现变成回归用例;数据库层面最好再有一层(行级权限或租户隔离)。强调一点:不能只靠系统提示词说「别查别人的」,提示词挡不住注入。

</details>

## 明天预告

明天是 [Day 339 · 小项目(二):LangGraph 主流程和审批](/blog/agent-zero/day-339-router-project-2/)。今天做完的是不调模型的那一半,明天把模型接上去:分类节点、检索节点、Agent 循环、工具节点,再加上遇到退款就停下来等主管的审批节点,用一个假模型把整条路径免费测一遍,然后拿真模型跑 T1041 的批准和驳回两条路径。
