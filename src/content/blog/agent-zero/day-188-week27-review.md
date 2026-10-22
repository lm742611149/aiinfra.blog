---
title: 'Day 188 · 第 27 周复习:工具与 Agent 循环(Day 182–187)'
description: '这一周从「一个工具该怎么写」走到「工具多了怎么挂」「结果大了怎么办」,最后让模型写代码、在沙箱里执行。今天画一张知识地图,默写 BM25 工具检索和沙箱执行器两段核心代码,再把检索和代码模式拼成一个迷你 Code Mode:60 个工具不进提示词,模型在沙箱里先 search_tools 再调用,写操作在桥上拦住。实测它答对了、也拦住了退款,但输入 8,146 个 token,比 Day 185 的 JSON 检索版贵了将近一倍,原因值得细看。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'tool-use', 'codeact', 'tool-search', 'agent-zero']
series: 'agent-zero'
day: 188
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 187](/blog/agent-zero/day-187-codeact-2/) 把模型写的代码真正跑了起来:代码关在 `sandbox-exec` 里的子进程中,读不到工作目录以外的文件、连不上网;工具函数是桩,调用经工具桥回主进程执行。同一道「退款最多的三个城市」,JSON 做法三轮对一轮、每轮输入八千到一万 token,写代码做法三轮全对、输入五六百 token;订单加到 12,000 条,写代码那边还是五百多。

这一周六课其实一直围着一件事转:**工具在上下文里占了多少地方,占得值不值。** 工具的说明书(Day 182–183)、工具的数量(Day 184–185)、工具的返回结果(Day 186–187),是上下文里三块不同的东西,每一块都有自己的办法。今天停一天,把这条线理清楚。

## 今天要解决的问题

学完今天,你应该能:

1. 不看文章,用一张图讲清本周六课各自在处理上下文里的哪一块,以及各自的代价。
2. 合上文章默写 Day 185 的 `tokenize` 和 `search_bm25`、Day 187 的 `run_code`,跑出和文中一致的结果。
3. 用本周的知识拼出 `code_mode_search.py`:提示词里只介绍一个 `search_tools`,60 个工具在沙箱里都能调,写操作在桥上拦住;并且能读懂它的账单,说清它为什么没有比 Day 185 的 JSON 检索版更省。
4. 说出本周每一个坑的现象和修法。

预计用时 3 小时:默写两段各 40 分钟,小项目 1 小时,剩下做练习和自测。前置:[Day 182](/blog/agent-zero/day-182-tool-design-2/) 到 [Day 187](/blog/agent-zero/day-187-codeact-2/) 全部,代码在 `agent-zero-lab/part03/`,命令都在 `agent-zero-lab/` 根目录跑,和 Day 187 一样只能在 macOS 上原样跑。今天的实跑一共约 ¥0.05(小项目 ¥0.010,练习 2 ¥0.010,练习 3 跑了三遍 ¥0.027,默写两段不调模型)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `search_bm25`、`run_code` 和小项目的 `CatalogForCode.call` 再默写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 本周知识地图

每次请求发给模型的东西,可以粗分成三块:工具的说明书(schema 和描述)、工具的数量(挂了几个就带几份说明书)、工具的结果(tool 消息)。本周两天一组,各管一块。

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="第 27 周知识地图:上下文里工具占的三块地方,每块对应两课和关键数字">
  <rect x="0" y="0" width="640" height="340" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">一次请求里,工具占了哪三块</text>
  <rect x="20" y="42" width="190" height="56" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="115" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">① 说明书写得好不好</text>
  <text x="115" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Day 182 六条原则</text>
  <rect x="225" y="42" width="190" height="56" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="320" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">② 挂了多少份说明书</text>
  <text x="320" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Day 184 量 · 185 检索</text>
  <rect x="430" y="42" width="190" height="56" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="525" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">③ 结果要不要过模型</text>
  <text x="525" y="84" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Day 186 问题 · 187 沙箱</text>
  <text x="115" y="124" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">搜「退款」返回</text>
  <text x="115" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">70,454 → 454 字符</text>
  <text x="320" y="124" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">60 个工具每步 4,485 tok</text>
  <text x="320" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">检索后 18,908 → 4,283</text>
  <text x="525" y="124" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">116 条订单 3,486 tok</text>
  <text x="525" y="142" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">写代码后 9,007 → 550</text>
  <rect x="20" y="160" width="190" height="50" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="115" y="181" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Day 183 改好了吗</text>
  <text x="115" y="199" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">任务+判卷+计数器</text>
  <rect x="225" y="160" width="190" height="50" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="320" y="181" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">代价:没挂上 = 不存在</text>
  <text x="320" y="199" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">「我没有提交退款的接口」</text>
  <rect x="430" y="160" width="190" height="50" fill="var(--paper)" stroke="var(--rule)" rx="4"/>
  <text x="525" y="181" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">代价:要沙箱、多一类错</text>
  <text x="525" y="199" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">list_orders('退款')</text>
  <rect x="20" y="230" width="600" height="92" fill="none" stroke="var(--ink-soft)" stroke-dasharray="5 4" rx="6"/>
  <text x="320" y="254" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">今天的小项目:② + ③ 拼在一起</text>
  <text x="320" y="276" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">提示词里只有 search_tools · 60 个桩在沙箱里 · 写操作在桥上拦</text>
  <text x="320" y="298" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">贯穿全周的尺子:同一道题、程序判卷、看 token 和调用次数</text>
</svg>
<figcaption>本周六课各管上下文里的一块。上面一排是问题和实测数字,中间一排是代价或验证办法,最下面是今天的小项目。</figcaption>
</figure>

图里有一条线容易漏掉:**每一种省法都有代价,而且代价都很安静。** 工具检索漏了,模型不报错,只是说「我没有这个功能」;代码模式的参数猜错了,代码不报错,只是返回一个空列表。所以本周每一课都配了同一把尺子:固定的题、程序判卷、数 token 和调用次数,而不是看一眼回答像不像对的。

## 本周每天一句话

- [Day 182](/blog/agent-zero/day-182-tool-design-2/):按六条原则改会议纪要工具(按任务设计、命名空间、四句话描述、能枚举就枚举、返回值有上限、报错指导下一步),搜「退款」的返回从 70,454 个字符缩到 454 个,顺带踩了一次工具重名的 400。
- [Day 183](/blog/agent-zero/day-183-tool-design-3/):五个带程序判卷的任务、一个计数器,坏工具和好工具成功率都是 10/10,差别全在调用次数、token 和波动上;再用留出任务检查改描述有没有改过头。
- [Day 184](/blog/agent-zero/day-184-tool-search-1/):60 个工具全挂上每次请求 4,485 个 prompt token,每多一个约 71 个;砍、合并、先分类再挂三种便宜办法,以及路由分错领域后模型说「我没有查发票的工具」。
- [Day 185](/blog/agent-zero/day-185-tool-search-2/):开局只挂 `search_tools`,BM25 和 embedding 两种检索器,离线 recall@3 是 0.77 对 1.00;接进循环后输入从 18,908 降到 4,283,也亲眼看到 `refund_submit` 排第四被截掉。
- [Day 186](/blog/agent-zero/day-186-codeact-1/):JSON 工具调用让 116 条订单每步重发、让模型心算二十几个小数,三遍全错;CodeAct 的主意是动作即代码,今天只写不执行。
- [Day 187](/blog/agent-zero/day-187-codeact-2/):子进程加 `sandbox-exec` 加工具桥,模型的代码真正跑起来,三轮全对、输入少 7 到 16 倍;沙箱挡住了文件、网络和起别的程序,挡不住内存和工具本身的权限。

## 默写一:BM25 工具检索

合上 Day 185,自己写出 `tokenize` 和 `search_bm25`。为了不依赖 Day 185 文件里 embedding 那一半(要 key),默写版单独放一个文件,只用 `catalog.py` 的 `SPECS`。写完拿今天小项目里模型真实搜过的几句话试一试,输出和下面一致才算过。

```python
# agent-zero-lab/part03/recall_bm25.py  默写一:合上文章写 tokenize 和 search_bm25,再拿小项目里模型的原话试一试
import logging
import re

import jieba
from rank_bm25 import BM25Okapi

from part03.catalog import SPECS

jieba.setLogLevel(logging.WARNING)
STOPWORDS = {"的", "了", "是", "吗", "呢", "我", "帮", "能", "想", "要", "这个", "一下", "客户"}
WORD = re.compile(r"[\w一-鿿]+")


def tokenize(text: str) -> list[str]:
    text = text.replace("_", " ")
    return [t.lower() for t in jieba.lcut(text) if WORD.fullmatch(t) and t not in STOPWORDS]


NAMES = [name for name, _, _ in SPECS]
DOCS = [f"{name} {desc} " + " ".join(f"{k} {v}" for k, v in params.items()) for name, desc, params in SPECS]
bm25 = BM25Okapi([tokenize(d) for d in DOCS])


def search_bm25(query: str, k: int = 5) -> list[str]:
    scores = bm25.get_scores(tokenize(query))
    order = sorted(range(len(NAMES)), key=lambda i: scores[i], reverse=True)
    return [NAMES[i] for i in order[:k]]


if __name__ == "__main__":
    for q in ["查询用户订单列表", "查询用户支付/扣款记录", "根据邮箱查找客户 ID", "列出客户的发票"]:
        print(q, "| 切词", tokenize(q), "|", search_bm25(q, 5))
```

<div class="line-notes">

- `import jieba` 中文分词库(Day 185 用 `uv add jieba` 装的)。中文词之间没有空格,BM25 要先切成词才能数「这个词出现了几次」。
- `from rank_bm25 import BM25Okapi` BM25 的现成实现(Day 185 装的 `rank-bm25`)。
- `jieba.setLogLevel(logging.WARNING)` jieba 第一次加载词典时会打印好几行日志,调高日志级别让它安静。
- `STOPWORDS = {` 停用词,出现在几乎每句话里、对区分工具没帮助的词。注意 `"客户"` 也在里面,因为 60 个工具的描述里到处都是「客户」,它分不出谁是谁。下面会看到这个选择的副作用。
- `WORD = re.compile(r"[\w一-鿿]+")` 只保留由字母、数字、下划线或汉字组成的词,把标点和空格切出来的碎片扔掉。`一-鿿` 是汉字的 Unicode 范围。
- `text = text.replace("_", " ")` 把 `invoice_list` 拆成 `invoice list`,英文名里的单词也能当关键词。
- `return [t.lower() for t in jieba.lcut(text) if WORD.fullmatch(t) and t not in STOPWORDS]` 切词、过滤、统一小写。`jieba.lcut` 返回列表。
- `DOCS = [f"{name} {desc} "` 每个工具拼成一段文本:名字、描述、参数名和参数说明。检索就是在这 60 段文本里找和问题最像的。
- `bm25 = BM25Okapi([tokenize(d) for d in DOCS])` 先把 60 段都切好词交给 BM25 建索引。
- `scores = bm25.get_scores(tokenize(query))` 问题也切词,算出它和 60 段文本各自的 BM25 分数,得到 60 个数。
- `order = sorted(range(len(NAMES)), key=lambda i: scores[i], reverse=True)` 把下标 0–59 按分数从高到低排,相当于 JS 的 `[...Array(60).keys()].sort((a, b) => scores[b] - scores[a])`。
- `return [NAMES[i] for i in order[:k]]` 取前 k 个下标对应的工具名。

</div>

```bash
uv run python -m part03.recall_bm25
```

```text
查询用户订单列表 | 切词 ['查询', '用户', '订单', '列表'] | ['notify_unsubscribe', 'notify_history', 'billing_credit_balance', 'billing_tax_rate', 'refund_status']
查询用户支付/扣款记录 | 切词 ['查询', '用户', '支付', '扣款', '记录'] | ['billing_retry_charge', 'ticket_get', 'ticket_close', 'invoice_list', 'account_login_history']
根据邮箱查找客户 ID | 切词 ['根据', '邮箱', '查找', 'id'] | ['customer_find', 'invoice_resend', 'customer_update_contact', 'account_transfer_owner', 'customer_merge']
列出客户的发票 | 切词 ['列出', '发票'] | ['invoice_list', 'kb_list_categories', 'refund_list_pending', 'invoice_void', 'account_list_members']
```

(jieba 第一次导入时在 Python 3.12 下会打印几行 `SyntaxWarning`,Day 185 说过,不影响结果。)

前两句是今天小项目里模型真实写出来的搜索词,检索结果很差:「查询用户订单列表」前五名里一个有用的都没有,因为我们的工具里压根没有「订单」这个词,发票叫 invoice;「用户」也没有,工具描述里用的都是「客户」,而「客户」又被我们放进了停用词。第二句的 `invoice_list` 排到第四,勉强捞上来。后两句用了工具描述里的原词「邮箱」「发票」,一下就准了。BM25 只认字面,模型换个说法它就瞎,这正是 Day 185 离线测出 recall@3 只有 0.77 的原因。记住这一点,小项目里马上要用到。

## 默写二:沙箱执行器 `run_code`

第二段默写 Day 187 的 `part03/sandbox.py`,这是本周最值得背下来的一段代码。建议这样默写:先只写 `BRIDGE` 的四行和 `run_code` 里那个 `for line in proc.stdout:` 循环(读一行、判断前缀、执行、写回、flush),这是工具桥的全部;再补沙箱规则、`Popen` 的参数和两个时间限制。

写完不用对着原文逐字比,用两条命令验收:

```bash
uv run python -m part03.sandbox        # 应该得到和 Day 187 一样的四个 RunResult
uv run python -m part03.escape_test    # 十项里前九项和 Day 187 一样被挡住或报错,吃内存那项成功
```

我自己默写时漏了三处,你多半也会漏:

**`BRIDGE` 里的双反斜杠。** 写成单个 `\x00` 和 `\n`,外层字符串会把它们变成真正的空字符和换行塞进源码中间。我实测了一次:连子进程都没起来,主进程在 `subprocess.Popen` 那一行直接崩了,报 `ValueError: embedded null byte`,因为命令行参数里不允许出现空字符。看到这个报错,先去查 `BRIDGE`。

**`flush()`。** 漏了它,第一次工具调用就卡死,一直等到墙钟超时,`timed_out=True`、退出码 `-9`。Day 187 常见误区里实测过,5 秒超时就卡满 5 秒。

**`(literal "/")`。** 规则里漏了这一条,子进程连启动都起不来,退出码 134,stderr 是空的,很难猜到原因。我第一次写规则就卡在这里。

如果你默写时把 stderr 也接成了 `subprocess.PIPE`,短代码测不出问题,但要知道它在报错很长时会死锁(Day 187 讲过为什么),改回写临时文件。

## 小项目:迷你 Code Mode,先搜工具再写代码

### 想法

Day 185 解决的是「工具太多,说明书撑满上下文」:开局只挂 `search_tools`,搜到什么挂什么。Day 187 解决的是「结果太大,不该过模型」:代码在沙箱里跑,工具在代码里调。两件事拼在一起,就是 Day 186 讲过的 Cloudflare Code Mode 的思路:提示词里只有一个搜索函数,**60 个工具都在沙箱里以函数的形式存在**,模型先写代码搜,看到名字和参数后再写代码调。不管后台有多少工具,提示词里的说明书都只有一份。

任务用 Day 185 的那道:「user007@example.com 说 10 月被扣了两次款,帮我核实一下。如果确实重复了,直接帮他把多扣的那笔提交退款申请。」它有一个写操作 `refund_submit`。按 Day 187 练习 3 的结论,写操作不能在代码里随便调,所以桥上要拦住它,让模型在最终回答里写明要退哪笔、交给人工。

验收三条:回答里查出两张重复发票(INV-2026-0123 和 INV-2026-0026,各 2,392 元);`refund_submit` 被桥拦下;看看输入 token 和 Day 185 的 JSON 检索版(4,283)比怎么样。

### 代码

只用本周的东西:Day 184 的 `catalog.py`(`SPECS` 和 `run_tool`)、Day 185 的 `search_bm25` 和任务、Day 187 的 `CodeAgent` 和 `run_code`。

```python
# agent-zero-lab/part03/code_mode_search.py  第 27 周小项目:60 个工具不进提示词,模型在沙箱里先 search_tools 再调用
import inspect
import json
from collections.abc import Callable
from typing import Any

from common.llm import LLMClient
from part03.agent_loop import ToolRegistry
from part03.catalog import SPECS, run_tool
from part03.code_agent import FENCE, SYSTEM, CodeAgent
from part03.search_agent import TASK
from part03.tool_retrievers import search_bm25

WRITES = {"refund_submit", "refund_approve", "refund_cancel", "invoice_void", "customer_delete_request"}
DESC = {name: (desc, params) for name, desc, params in SPECS}


def search_tools(query: str, k: int = 5) -> list[dict[str, Any]]:
    """按需求描述搜索可用的工具,返回最像的 k 个:名字、说明、参数。没找到想要的就换个说法再搜。"""
    return [{"name": n, "description": DESC[n][0], "params": DESC[n][1]} for n in search_bm25(query, k)]


def _make(name: str, desc: str, params: dict[str, str]) -> Callable[..., Any]:
    def fn(**kwargs: Any) -> Any:
        return run_tool(name, kwargs)
    fn.__name__, fn.__doc__ = name, desc
    fn.__signature__ = inspect.Signature(  # type: ignore[attr-defined]
        [inspect.Parameter(p, inspect.Parameter.POSITIONAL_OR_KEYWORD) for p in params])
    return fn


class CatalogForCode(ToolRegistry):
    """60 个工具都生成桩,但提示词里只介绍 search_tools;写操作在桥上拦住。"""

    def __init__(self) -> None:
        super().__init__()
        self.tool(search_tools)
        for name, desc, params in SPECS:
            self.funcs[name] = _make(name, desc, params)
        self.blocked: list[str] = []
        self.searches: list[str] = []

    def call(self, name: str, arguments: str) -> str:
        if name in WRITES:
            self.blocked.append(name)
            return json.dumps({"error": f"{name} 是写操作,代码里不能调用。请在最终回答里写明要做什么,交给人工审批"}, ensure_ascii=False)
        if name == "search_tools":
            self.searches.append(json.loads(arguments)["query"])
        return super().call(name, arguments)


if __name__ == "__main__":
    reg = CatalogForCode()
    api = ('def search_tools(query, k=5)\n    """' + (inspect.getdoc(search_tools) or "") + '"""\n'
           "另外还有约 60 个客服后台函数也已经定义好,名字和参数以 search_tools 返回的为准,直接按名字调用。")
    llm = LLMClient()
    agent = CodeAgent(reg, llm, max_steps=8)
    agent.messages[0]["content"] = SYSTEM.format(api=api, fence=FENCE) + "\n5. 金额字段单位是分,回答时换算成元。"
    answer = agent.run(TASK)
    print("== 回答\n" + answer)
    print("搜索过:", reg.searches, "| 被拦的写操作:", reg.blocked, "|", llm.ledger)
    with open("code_mode_search_trace.json", "w") as f:
        json.dump(agent.messages, f, ensure_ascii=False, indent=1)
```

<div class="line-notes">

- `from part03.catalog import SPECS, run_tool` Day 184 的 60 个工具:`SPECS` 是 (名字, 描述, 参数) 的列表,`run_tool(name, args)` 执行一个工具,其中 `customer_find`、`subscription_get`、`invoice_list` 接了小样本数据,其余是演示桩。
- `from part03.search_agent import TASK` 和 Day 185 同一道题,方便对比。
- `from part03.tool_retrievers import search_bm25` 用 BM25,不花钱;练习 2 换成 embedding。
- `WRITES = {"refund_submit", "refund_approve", "refund_cancel", "invoice_void", "customer_delete_request"}` 写操作名单。会动钱、动数据的都放进来。
- `DESC = {name: (desc, params) for name, desc, params in SPECS}` 字典推导式,工具名 → (描述, 参数说明)。
- `def search_tools(query: str, k: int = 5) -> list[dict[str, Any]]:` 这是提示词里唯一介绍的函数。它本身也是一个工具,在主进程里执行。
- `"""按需求描述搜索可用的工具,返回最像的 k 个:名字、说明、参数。没找到想要的就换个说法再搜。"""` 最后一句来自 Day 185 的教训:k 再大也会漏,要告诉模型「没找到就换说法」。
- `def _make(name: str, desc: str, params: dict[str, str]) -> Callable[..., Any]:` 给 60 个工具各造一个真函数。Day 187 的 `tool_stubs` 是读函数签名来生成桩的,所以注册表的 `funcs` 里要有带正确参数名的函数。
- `def fn(**kwargs: Any) -> Any:` 函数体:收到什么关键字参数都原样交给 `run_tool`。这是 [Day 30](/blog/agent-zero/day-030-functions-3/) 学过的闭包,每个 `fn` 记住了自己的 `name`。
- `fn.__name__, fn.__doc__ = name, desc` 改函数的名字和文档字符串,`tool_stubs` 和 `inspect.getdoc` 会读它们。
- `fn.__signature__ = inspect.Signature(` 本周唯一借来的新东西:`inspect.signature(fn)` 会优先读函数的 `__signature__` 属性。我们按 `params` 的参数名手工造一个签名挂上去,`tool_stubs` 就会生成 `def customer_find(query):` 这样的桩。`# type: ignore` 是因为类型检查器不知道函数对象上可以挂这个属性。
- `[inspect.Parameter(p, inspect.Parameter.POSITIONAL_OR_KEYWORD) for p in params])` 每个参数都是「既可以按位置传、也可以按名字传」的普通参数,没有默认值。
- `class CatalogForCode(ToolRegistry):` 继承注册表,和 Day 187 练习 3 的 `GuardedRegistry` 一个思路。
- `self.tool(search_tools)` 用 Day 168 的装饰器方法登记 `search_tools`,它的 `funcs` 和 `call` 都走注册表的正常逻辑。
- `self.funcs[name] = _make(name, desc, params)` 60 个工具直接塞进 `funcs`,不生成 schema(反正不走 function calling)。
- `if name in WRITES:` 写操作在主进程这一层拦住,沙箱里的代码绕不过去。
- `self.searches.append(json.loads(arguments)["query"])` 记下模型搜过什么,跑完回头看检索准不准。
- `return super().call(name, arguments)` 其余的交给父类:找到 `funcs[name]`,用参数调用,出错变成 `{"error": ...}`。
- `api = ('def search_tools(query, k=5)\n    """'` 给模型看的函数说明只有 `search_tools` 一个,外加一句「还有约 60 个,名字以搜到的为准」。60 个工具的说明书一份都不进提示词。
- `agent.messages[0]["content"] = SYSTEM.format(api=api, fence=FENCE) + "\n5. 金额字段单位是分,回答时换算成元。"` 系统提示词用 Day 187 的模板,只替换 `{api}` 那一段,再加一条金额单位的规则(Day 184 的系统提示词里也有这句)。

</div>

```bash
uv run python -m part03.code_mode_search
```

2026 年 10 月 22 日实测,DeepSeek `deepseek-flash`,思考关闭:

```text
[step 1] 输入 255 tok | 输出 46 tok
    执行代码:工具调用 3 次,退出码 0,输出 1514 字符
[step 2] 输入 883 tok | 输出 27 tok
    执行代码:工具调用 1 次,退出码 0,输出 616 字符
[step 3] 输入 1156 tok | 输出 20 tok
    执行代码:工具调用 1 次,退出码 0,输出 82 字符
[step 4] 输入 1221 tok | 输出 21 tok
    执行代码:工具调用 1 次,退出码 0,输出 279 字符
[step 5] 输入 1375 tok | 输出 67 tok
    执行代码:工具调用 0 次,退出码 0,输出 47 字符
[step 6] 输入 1484 tok | 输出 245 tok
    执行代码:工具调用 1 次,退出码 0,输出 61 字符
[step 7] 输入 1772 tok | 输出 293 tok
== 回答
核实完毕，情况属实，但退款申请需要由你或主管人工提交，我不能直接代为执行。

**核实结果：确认重复扣款**
- 客户：刘静 / 半岛咖啡（C007，user007@example.com）
- INV-2026-0123：2392.00 元，已支付，2026-10-08
- INV-2026-0026：2392.00 元，已支付，2026-10-08

两张发票金额相同、同日扣款，属于重复扣款。（2025-10-08 那张同额发票是去年正常年费，不涉及重复。）

**需要人工执行的操作**
为 **INV-2026-0026** 提交退款申请：
- 发票号：INV-2026-0026
- 退款金额：2392.00 元
- 原因：10 月重复扣款，与 INV-2026-0123 金额相同且同日扣款，退回多扣的一笔
……
搜索过: ['查询用户订单列表', '查询用户支付/扣款记录', '提交退款申请', '根据邮箱查找客户 ID'] | 被拦的写操作: ['refund_submit'] | 7 次调用 | 输入 8146 / 输出 719 tokens | 约 ¥0.0100
```

### 读结果:对了,拦住了,但没省

前两条验收都过了:两张重复发票、金额、去年那张不算重复,全对;第 6 步模型写了 `refund_submit(invoice_id="INV-2026-0026", amount_yuan=2392.00, ...)`,被桥拦下,它读到报错后在最终回答里把退款单要素列给了人工。这正是我们设计的样子。

第三条出乎意料:**输入 8,146 个 token,比 Day 185 的 JSON 检索版(4,283)贵了将近一倍,用了 7 次模型调用。** 翻 `code_mode_search_trace.json` 看每一步做了什么:

| 步 | 模型写的代码 | 结果 |
| --- | --- | --- |
| 1 | 一次搜三句:「查询用户订单列表」「查询用户支付/扣款记录」「提交退款申请」,全部 print | 1,514 个字符的搜索结果,前两句基本没搜到有用的 |
| 2 | 再搜「根据邮箱查找客户 ID」 | 搜到 `customer_find` |
| 3 | `customer_find("user007@example.com")` | C007 |
| 4 | `invoice_list("C007")`,逐条 print | 三张发票 |
| 5 | 只 print 了一句「10月两笔……各 2392.00 元」 | 自言自语 |
| 6 | `refund_submit(...)` | 被桥拦下 |
| 7 | 最终回答 | |

原因有两个,都是本周学过的。

**一是检索不准。** 第 1 步的两句搜索词就是默写一里试过的那两句,「订单」「用户」在工具描述里都不存在,BM25 只认字面,搜不到。模型多花了一步换说法。Day 185 的 JSON 版用的是 embedding 检索,这里用的是 BM25,起点就不公平(练习 2 换成 embedding 再比)。

**二是这道题根本没有「大数据」。** 三张发票、一个客户,工具结果都只有几十到几百个字符。Day 186 的判断标准第一条就是「数据需要穿过模型吗」,这道题的数据穿过模型一点都不贵,代码模式的优势用不上;反倒是每一步都要带上越来越长的历史(搜索结果全被 print 了出来),再加上它一步只做一件事(先查客户、再查发票,分两段代码写),七步累下来就贵了。Day 187 的订单题是 116 条数据要汇总,代码模式省了 16 倍;这道题不是,它就不省。

所以这个小项目的结论不是「Code Mode 不好」,而是:**省法要对症。** 工具数量的问题用检索(Day 185)已经解决了;结果大小的问题这道题里不存在。两样拼在一起,只是把两份代价都背上了。Cloudflare 那边两千五百多个接口、每个接口返回大段 JSON,两种问题同时存在,拼在一起才值。

### 零件对照

| 零件 | 出自 | 在小项目里 |
| --- | --- | --- |
| 60 个工具的 `SPECS`、`run_tool` | [Day 184](/blog/agent-zero/day-184-tool-search-1/) `catalog.py` | `_make` 造函数、`DESC` |
| `search_bm25` | [Day 185](/blog/agent-zero/day-185-tool-search-2/) `tool_retrievers.py` | `search_tools` 的实现 |
| 「没找到就换说法」的描述 | Day 185 常见误区 | `search_tools` 的 docstring |
| 报错指导下一步 | [Day 182](/blog/agent-zero/day-182-tool-design-2/) 原则六 | 拦截写操作时的报错文案 |
| `CodeAgent`、`run_code`、工具桥 | [Day 187](/blog/agent-zero/day-187-codeact-2/) | 整个执行过程 |
| 写操作在桥上拦 | Day 187 练习 3 | `CatalogForCode.call` 的 `WRITES` |
| 数据需要穿过模型吗 | [Day 186](/blog/agent-zero/day-186-codeact-1/) | 读结果时的判断 |
| 同一道题、数 token | [Day 183](/blog/agent-zero/day-183-tool-design-3/) | 和 4,283 对比 |

## 本周错题与坑清单

| 坑 | 现象 | 修法 | 出处 |
| --- | --- | --- | --- |
| 工具重名 | 注册表悄悄覆盖,DeepSeek 400 `Tool names must be unique` | 名字加命名空间,注册表查重 | Day 182 |
| 截断不说总数 | 只给 5 条,模型以为只有 5 条 | 返回总数和翻页办法 | Day 182 |
| 只跑一遍就下结论 | 同一任务两遍 17,914 和 122,888 token | 每个任务跑两三遍看范围 | Day 183 |
| 包装器绕过被包对象 | 两层包装时里层逻辑被跳过,不报错 | `call` 一律交给被包对象的 `call` | Day 183 |
| 以为工具定义只发一次 | 60 个工具四步发了四遍,约 1.8 万 token | 每步都是新请求,按步算账 | Day 184 |
| 路由单选 | 「扣了两次款」被分到 billing,没挂发票工具 | 允许多选,评测里查「该挂的有没有挂上」 | Day 184 |
| 相信「我没有这个功能」 | 检索漏了 `refund_submit`,回答合情合理 | 端到端测试检查该调的工具有没有被调 | Day 185 |
| 改描述忘了重算向量 | 检索结果纹丝不动 | 缓存里存原文,对不上就重算 | Day 185 |
| 以为模型能把一堆数加对 | 23 个数全列对了,和还是错 170 元 | 计算交给代码 | Day 186 |
| f-string 里写花括号 | `ValueError: Format specifier missing precision` | 写 `{{` `}}` | Day 186 |
| 子进程当沙箱 | 不关沙箱时读出伪造 key、能联网 | `sandbox-exec` 白名单规则 | Day 187 |
| 桥里漏 flush | 卡满超时,`returncode=-9` | 每次写请求后 flush | Day 187 |
| 代码模式的说明丢了类型 | `list_orders('退款')` 安静地返回空列表 | 说明带类型和取值,工具校验参数 | Day 187 |
| macOS 限内存 | `RLIMIT_AS` 报 `ValueError` | Linux 的 rlimit 或 Docker `--memory` | Day 187 |
| BM25 只认字面 | 「查询用户订单列表」前五名全无关 | 换 embedding 或两路取并集 | 今天 |

## 动手练习

### 练习 1:不看文章写出工具桥的最小版

不要沙箱规则、不要超时,只写 `BRIDGE`、一个工具的桩和 `for line in proc.stdout:` 那个循环,让子进程里的 `print(get_city_manager("杭州"))` 打出 `{'city': '杭州', 'manager': '刘洋'}`。这只是为了默写协议本身,代码是我们自己写死的,不执行模型的代码,所以可以不加沙箱;**真接模型时必须换回 Day 187 的 `run_code`**。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/bridge_min.py  练习 1:工具桥协议的最小版。只跑自己写死的代码,不接模型
import json
import subprocess
import sys

from part03.orders_tools import reg

BRIDGE = '''
import json, sys
def _call_tool(name, **kwargs):
    sys.__stdout__.write("\\x00TOOL " + json.dumps({"name": name, "args": kwargs}, ensure_ascii=False) + "\\n")
    sys.__stdout__.flush()
    return json.loads(sys.stdin.readline())
def get_city_manager(city):
    return _call_tool("get_city_manager", city=city)
'''
MARK = "\x00TOOL "

proc = subprocess.Popen([sys.executable, "-I", "-c", BRIDGE + 'print(get_city_manager("杭州"))'],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
assert proc.stdin and proc.stdout
for line in proc.stdout:
    if line.startswith(MARK):
        req = json.loads(line[len(MARK):])
        print("主进程收到请求:", req)
        proc.stdin.write(reg.call(req["name"], json.dumps(req["args"], ensure_ascii=False)) + "\n")
        proc.stdin.flush()
    else:
        print("子进程输出:", line.rstrip())
print("退出码", proc.wait())
```

<div class="line-notes">

- `def get_city_manager(city):` 桩手写在 `BRIDGE` 里,省掉 `tool_stubs`。
- `proc = subprocess.Popen([sys.executable, "-I", "-c", BRIDGE + 'print(get_city_manager("杭州"))'],` 子进程跑的是「桥 + 一行写死的代码」。
- `stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)` 没接 stderr,报错会直接打到终端,方便调试。
- `req = json.loads(line[len(MARK):])` 去掉前缀解析请求。
- `proc.stdin.write(reg.call(req["name"], json.dumps(req["args"], ensure_ascii=False)) + "\n")` 用注册表执行并写回,末尾换行。
- `print("退出码", proc.wait())` `wait()` 等子进程结束并返回退出码。

</div>

```bash
uv run python -m part03.bridge_min
```

```text
主进程收到请求: {'name': 'get_city_manager', 'args': {'city': '杭州'}}
子进程输出: {'city': '杭州', 'manager': '刘洋'}
退出码 0
```

整个协议就这么多:一行请求出去,一行结果回来。Day 187 的 `run_code` 在这上面加的东西,全是为了安全(沙箱规则、环境变量白名单、两种时间限制)和健壮(stderr 写文件、输出截断、临时工作目录)。

</details>

### 练习 2:搜索换成 embedding

把小项目的 `search_tools` 换成 Day 185 的 `search_embed`,其余不变,跑一次,和 BM25 版比搜索词、步数和 token。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/code_mode_search_emb.py  练习 2:search_tools 换成 embedding 检索,步数和 token 会不会变
import inspect
from typing import Any

from common.llm import LLMClient
from part03 import code_mode_search as cms
from part03.code_agent import FENCE, SYSTEM, CodeAgent
from part03.tool_retrievers import search_embed, usage


def search_tools(query: str, k: int = 5) -> list[dict[str, Any]]:
    """按需求描述搜索可用的工具,返回最像的 k 个:名字、说明、参数。没找到想要的就换个说法再搜。"""
    return [{"name": n, "description": cms.DESC[n][0], "params": cms.DESC[n][1]} for n in search_embed(query, k)]


reg = cms.CatalogForCode()
reg.funcs["search_tools"] = search_tools
api = ('def search_tools(query, k=5)\n    """' + (inspect.getdoc(search_tools) or "") + '"""\n'
       "另外还有约 60 个客服后台函数也已经定义好,名字和参数以 search_tools 返回的为准,直接按名字调用。")
llm = LLMClient()
agent = CodeAgent(reg, llm, max_steps=8)
agent.messages[0]["content"] = SYSTEM.format(api=api, fence=FENCE) + "\n5. 金额字段单位是分,回答时换算成元。"
answer = agent.run(cms.TASK)
print("== 回答(前 300 字)\n" + answer[:300])
print("搜索过:", reg.searches, "| 被拦的写操作:", reg.blocked, "|", llm.ledger, "| embedding", usage)
```

<div class="line-notes">

- `from part03.tool_retrievers import search_embed, usage` Day 185 的语义检索,要 `.env` 里的 `EMB_*`;工具向量缓存在 `workspace/tool_vecs.json`,只有搜索词要现算。
- `reg.funcs["search_tools"] = search_tools` 只替换主进程里真正执行的那个函数。桩是按名字转发的,子进程那边什么都不用改。
- `print("搜索过:", reg.searches, "| 被拦的写操作:", reg.blocked, "|", llm.ledger, "| embedding", usage)` `usage` 是 embedding 的调用次数和 token。

</div>

```bash
uv run python -m part03.code_mode_search_emb
```

```text
[step 1] 输入 255 tok | 输出 38 tok
    执行代码:工具调用 2 次,退出码 0,输出 1063 字符
[step 2] 输入 702 tok | 输出 29 tok
    执行代码:工具调用 1 次,退出码 0,输出 583 字符
[step 3] 输入 957 tok | 输出 19 tok
    执行代码:工具调用 1 次,退出码 0,输出 82 字符
[step 4] 输入 1022 tok | 输出 21 tok
    执行代码:工具调用 1 次,退出码 0,输出 279 字符
[step 5] 输入 1176 tok | 输出 79 tok
    执行代码:工具调用 0 次,退出码 1,输出 0 字符
[step 6] 输入 1316 tok | 输出 38 tok
    执行代码:工具调用 1 次,退出码 0,输出 111 字符
[step 7] 输入 1427 tok | 输出 177 tok
    执行代码:工具调用 1 次,退出码 0,输出 61 字符
[step 8] 输入 1647 tok | 输出 333 tok
== 回答(前 300 字)
我已核实完毕。以下是情况说明和需要人工处理的退款申请:
……(两张重复发票 INV-2026-0123、INV-2026-0026,各 2392.00 元,和 BM25 版一致)
搜索过: ['查询用户支付/扣款记录', '提交退款申请', '根据邮箱查找客户 customer_id'] | 被拦的写操作: ['refund_submit'] | 8 次调用 | 输入 8502 / 输出 734 tokens | 约 ¥0.0101 | embedding {'calls': 3, 'tokens': 27}
```

答案一样对,退款一样被拦,但输入 8,502 个 token、8 次调用,和 BM25 版(8,146、7 次)几乎一样,第 5 步还有一段代码报错了一次(退出码 1)。搜索词少了一句,可省下来的一步被别处吃掉了。

结论:检索换成更准的,**这道题上并没有省**,印证了正文的判断:贵的主要原因不是检索,而是这道题数据小、一步一件事、历史越滚越长。embedding 本身三次调用 27 个 token,几乎不要钱。

</details>

### 练习 3:让模型一段代码多做几步(开放题)

正文第 3、4 步先查客户、再查发票,分了两段代码。在系统提示词里加一条规则,要它「每段代码尽量多做几步」,看步数和 token 能不能降下来。

<details><summary>参考答案</summary>

示范解法:加一条第 6 条规则,其余和小项目一样。

```python
# agent-zero-lab/part03/code_mode_search_batch.py  练习 3:加一条「一段代码多做几步」的规则,看步数能不能降
import inspect

from common.llm import LLMClient
from part03 import code_mode_search as cms
from part03.code_agent import FENCE, SYSTEM, CodeAgent

RULE = ("\n5. 金额字段单位是分,回答时换算成元。"
        "\n6. 每段代码尽量多做几步:一次搜多个需求;已经知道名字的函数,在同一段代码里直接调用、"
        "把结果算好再 print,不要每段只做一件事。")

reg = cms.CatalogForCode()
api = ('def search_tools(query, k=5)\n    """' + (inspect.getdoc(cms.search_tools) or "") + '"""\n'
       "另外还有约 60 个客服后台函数也已经定义好,名字和参数以 search_tools 返回的为准,直接按名字调用。")
llm = LLMClient()
agent = CodeAgent(reg, llm, max_steps=8)
agent.messages[0]["content"] = SYSTEM.format(api=api, fence=FENCE) + RULE
answer = agent.run(cms.TASK)
print("== 回答(前 200 字)\n" + answer[:200])
print("搜索过:", reg.searches, "| 被拦的写操作:", reg.blocked, "|", llm.ledger)
```

<div class="line-notes">

- `"\n6. 每段代码尽量多做几步:一次搜多个需求;已经知道名字的函数,在同一段代码里直接调用、"` 新加的规则。两段字符串相邻写会自动拼成一段,括号里换行只是为了好读。

</div>

```bash
uv run python -m part03.code_mode_search_batch
```

我跑了三次,三次差别很大。第一次:

```text
[step 1] 输入 296 tok | 输出 35 tok
    执行代码:工具调用 1 次,退出码 0,输出 512 字符
[step 2] 输入 545 tok | 输出 64 tok
== 回答(前 200 字)
<｜｜DSML｜｜ calls>
<｜｜DSML｜｜ invoke name="search_tools">
<｜｜DSML｜｜ parameter name="query" string="true">根据邮箱查询客户 customer_id 用户信息 customer_get</｜｜DSML｜｜ parameter>
<｜｜DSML｜｜ parameter name="k" string="f
搜索过: ['查询用户订单 扣款记录'] | 被拦的写操作: [] | 2 次调用 | 输入 841 / 输出 99 tokens | 约 ¥0.0017
```

第二、三次(只留统计行):

```text
搜索过: ['查询用户扣款记录', '查询用户订单', '提交退款申请', '查询用户信息', '根据邮箱或客户标识查找客户'] | 被拦的写操作: ['refund_submit'] | 7 次调用 | 输入 11190 / 输出 1086 tokens | 约 ¥0.0135
搜索过: ['根据邮箱查询用户', '查询用户订单列表', '查询扣款流水记录', '提交退款申请', '查询退款申请状态', '查询发票详情', '查询交易流水 扣款记录', '查询工单'] | 被拦的写操作: ['refund_submit'] | 6 次调用 | 输入 8991 / 输出 993 tokens | 约 ¥0.0121
```

**规则没起作用。** 第二、三次还是六七步,输入 8,991 和 11,190,比不加规则(8,146)还多;模型确实「一次搜多个」了,搜了五句、八句,可搜索结果全被 print 出来,历史更长了。真正卡住它的还是检索:不知道工具叫什么,就没法在同一段代码里直接调用。

**第一次更值得记住。** 模型第二步没写 python 代码块,而是输出了一串 `<｜｜DSML｜｜ calls>`,看起来是它想发起原生的工具调用,却因为我们没传 `tools` 参数,这串内部格式就原样出现在了正文里。我们的循环规则是「没有代码块 = 最终回答」,于是把这串乱码当成答案返回了,任务没做完,也没报错。这是 Day 187 讲过的那个结束条件的缺点,真实地发生了一次。修法:最终回答要显式标记(比如要求调用 `final_answer()` 或以「最终回答:」开头),既没有代码块也没有标记时,回一条「请写 python 代码块或给出最终回答」让它重来。这类「模型输出格式不对」的失败,明天开始的失败模式系列会专门分类。

对比前后,我的结论是:提示词规则改变不了「检索不准」这个根因。想降步数,先把检索改准(Day 185 练习 3 的两路取并集),或者干脆别对这道小数据的题用代码模式。

</details>

**验收标准**:默写一的四行输出和文中一致;默写二的两条验收命令结果和 Day 187 一致;小项目回答里有两张重复发票且 `refund_submit` 被拦;能说出这道题上代码模式不省钱的两个原因;练习 1 的最小桥跑通;练习 2、3 各写出一句结论。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 迷你 Code Mode | 今天小项目的叫法:提示词里只介绍一个搜索函数,全部工具以函数形式在沙箱里,模型先写代码搜、再写代码调。仿 Cloudflare Code Mode 的 `search()` + `execute()`([Day 186](/blog/agent-zero/day-186-codeact-1/)) |
| `__signature__` | 函数对象上的一个属性,`inspect.signature()` 会优先读它。今天用它给动态造出来的函数挂上参数名 |
| `inspect.Signature` / `inspect.Parameter` | 标准库里表示「函数签名」和「一个参数」的类,可以手工构造 |
| 字面匹配 | BM25 这类关键词检索只看词是否相同,「订单」和「发票」意思相近它也认不出 |
| 写操作名单 | 会动钱或改数据的工具列表,在工具桥上统一拦截,沙箱里的代码绕不过去 |
| DSML 泄漏 | 本课的叫法:模型把自己内部的工具调用格式(DeepSeek 这里是 `<｜｜DSML｜｜ calls>`)当成普通文本输出了,通常发生在提示词里描述了工具、请求里却没传 `tools` 的时候 |

本周其他术语(命名空间、宽进严出、留出任务、recall@k、BM25、embedding、中间结果、CodeAct、工具桥、桩函数、`sandbox-exec`、rlimit 等)见各天的名词解释。

## 常见误区

**以为把几种省法叠在一起就更省。** 今天检索加代码模式,输入 8,146,比只用检索的 4,283 贵了将近一倍。每种省法治一种病,这道题没有「结果太大」的病,代码模式就是纯代价。先判断问题在哪一块,再选办法。

**以为提示词规则能弥补检索不准。** 练习 3 加了「多做几步」的规则,步数没降,token 还涨了。不知道工具叫什么,模型就只能一轮轮去搜。

**循环的结束条件太宽。** 「没写代码块就当最终回答」会把一串乱码当成答案收下,练习 3 实测碰上了一次。结束要有明确的标记,不符合格式就让模型重来。

**默写时只背代码不背坑。** `run_code` 照着敲一遍不难,难的是双反斜杠、flush、`(literal "/")` 这三处,写错了的现象分别是主进程报 `ValueError: embedded null byte`、卡满超时、退出码 134 且没有报错。记住现象比记住代码更有用,下次一看就知道是哪里。

**拿一次运行下结论。** 练习 3 同一个脚本三次跑出 2 步、7 步、6 步,输入 841 到 11,190。Day 183 说的「每个任务跑两三遍看范围」,本周每天都在应验。

## 学习资料

### 文档与文章

- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):本周前两天的总纲,用评测驱动改工具,英文。
- [Anthropic · Introducing advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use):Tool Search 和程序化工具调用放在同一篇里讲,正好对应本周后四天,英文。
- [Cloudflare · Code Mode: the better way to use MCP](https://blog.cloudflare.com/code-mode/):今天小项目的原型,看他们为什么要把搜索和执行合起来,英文。
- [Python 文档 · inspect](https://docs.python.org/3/library/inspect.html):搜 `Signature` 和 `__signature__`,看今天借用的那个属性是怎么被读取的,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zXoPBQE6m&autoplay=0&high_quality=1" title="【AI Engineer】告别JSON工具调用！CodeMode让AI Agent直接执行代码" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>量子菠萝_ · 告别 JSON 工具调用!CodeMode 让 AI Agent 直接执行代码 · 20 分钟,AI Engineer 大会上 Code Mode 演讲的中文版,看完再回头读小项目的「读结果」,想想他们的场景和我们这道题差在哪。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14sorBiEgP&autoplay=0&high_quality=1" title="AI Agent的沙箱是什么？它和Docker容器/虚拟机有什么区别?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小白debug · AI Agent 的沙箱是什么?它和 Docker 容器、虚拟机有什么区别? · 7 分钟,复习 Day 187 沙箱边界那一节用。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/uhJJgc-0iTQ" title="Building more effective AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Building more effective AI agents · Anthropic 官方频道,讲工具设计、上下文和评测怎么配合,可以当本周的总复习听,英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agent 部分讲工具清单怎么选、工具多了模型为什么选不准,和本周前四天对应,英文。

### 开源项目与代码

- [dorianbrown/rank_bm25](https://github.com/dorianbrown/rank_bm25):默写一用的库,源码不长,`BM25Okapi.get_scores` 就是那个公式。
- [fxsjy/jieba](https://github.com/fxsjy/jieba):中文分词,README 里有自定义词典的用法,想让「订单」和「发票」被当成同义可以从这里入手。
- [anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime):Claude Code 用的沙箱运行时,和 Day 187 的规则对照着读。

## 自测

1. 本周处理了上下文里工具占的哪三块?每块各用了什么办法,代价是什么?

<details><summary>答案</summary>

说明书的质量(Day 182–183):六条原则改工具,用任务加程序判卷验证,代价是要花时间建评测。说明书的数量(Day 184–185):砍、合并、路由、工具检索,代价是没挂上的工具对模型来说不存在,而且它不会报错。工具的结果(Day 186–187):让模型写代码,数据在沙箱里处理、只 print 结论,代价是要维护沙箱,多出「代码安静地拿到空结果」这类新失败。

</details>

2. 今天小项目里,为什么检索加代码模式反而比 Day 185 的 JSON 检索版贵?

<details><summary>答案</summary>

一是 BM25 只认字面,模型写的「订单」「用户」在工具描述里不存在,多搜了一轮;二是这道题只有三张发票,结果本来就小,代码模式「数据不过模型」的优势用不上,反而因为一步只做一件事、搜索结果全 print,七步历史越滚越长,输入累计 8,146。练习 2 换成 embedding 后还是 8,502,说明主因是第二条。

</details>

3. 小项目里 `refund_submit` 是怎么被拦住的?如果只在提示词里写「不要调用 refund_submit」,够不够?

<details><summary>答案</summary>

`CatalogForCode.call` 在主进程里检查工具名,在 `WRITES` 里就不执行,返回报错。沙箱里的桩只能把请求发到这里,绕不过去。只写在提示词里不够:实测模型在第 6 步照样写了 `refund_submit(...)`,提示词只是引导,和 Anthropic 文档说 `allowed_callers` 不是安全边界一个道理。

</details>

4. 默写 `run_code` 时漏了 `flush()`、`BRIDGE` 里只写了一个反斜杠、规则里漏了 `(literal "/")`,分别会看到什么?

<details><summary>答案</summary>

漏 flush:工具请求停在子进程的缓冲区里,两边互相等,直到墙钟超时,`timed_out=True`、退出码 -9。单反斜杠:真正的空字符被塞进了要执行的源码,而这段源码是作为命令行参数传给子进程的,命令行参数不允许有空字符,主进程在 `subprocess.Popen` 就抛 `ValueError: embedded null byte`,子进程根本没启动。漏 `(literal "/")`:子进程启动就崩,退出码 134,stderr 是空的。

</details>

5. 面试题:你接手一个客服 Agent,后台有 300 个内部 API,有的返回很大的 JSON。上下文一直超长,账单也很高。你会按什么顺序排查和改?

<details><summary>答案</summary>

示范回答:先量,再分块治。先用 `max_tokens=1` 或账单拆出每步输入里工具定义占多少、工具结果占多少、历史占多少。工具定义占大头,先砍掉这个 Agent 用不上的、合并相近的,再上工具检索,开局只挂搜索工具,并且用离线 recall 和端到端「该调的有没有调」两层评测盯住漏检。工具结果占大头,先改工具本身:加上限、返回总数和翻页、做按任务的汇总工具;问法实在没法穷举、又要在大量数据上做计算的,才上代码执行,配沙箱(断网、只挂工作目录、限 CPU 内存时间)和工具桥,写操作在桥上强制审批。每改一步都用同一批带判卷的任务跑两三遍,比成功率、调用次数和 token,不凭感觉。最后提醒自己:几种办法不要无脑叠加,对不上症的办法只会多一份代价。

</details>

## 明天预告

明天是 **Day 189 · 失败模式(一):三层九类**。这一周我们已经撞上了各种失败:工具重名的 400、检索漏掉的工具、心算错的金额、卡死的桥、今天那串 DSML 乱码。它们看起来五花八门,其实可以按「出在哪一层」分成三层九类,每一层的治法完全不同。明天先把分类表立起来,用 Day 170 的 `run_agent` 挨个撞一遍,看它现在接得住哪几类。
