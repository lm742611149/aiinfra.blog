---
title: 'Day 185 · 工具多了怎么办(二):自己实现工具检索和评测'
description: '先看 Anthropic、OpenAI 和 Claude Code 内置的 Tool Search 是怎么做的,再在自己的 Agent 循环里做一个:开局只挂 search_tools,模型说要什么,就从 60 个工具里检索出最像的几个挂上。检索器用关键词(BM25)和语义(embedding)各做一个,30 句客服原话离线测召回率,BM25 recall@3 是 0.77,embedding 是 1.00;接进循环后输入 token 从 18,908 降到 4,283,但也亲眼看到 refund_submit 排在第四被 k=3 截掉,模型随即说「我没有提交退款的接口」。'
pubDate: 2026-10-22
regime: none
tags: ['tool-use', 'tool-search', 'retrieval', 'evaluation', 'agent-zero']
series: 'agent-zero'
day: 185
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 184](/blog/agent-zero/day-184-tool-search-1/) 给云簿客服后台造了 60 个工具,量出全挂上一次请求要 4,485 个 prompt token(固定开销约 220,每个工具约 71),四步的核实重复扣款任务一共 19,132 个输入 token,只挂真正用到的 3 个是 1,943。然后试了三个便宜办法:砍掉 10 个客服用不上的,合并相近的,先路由再挂。路由最省,但单选时把「被扣了两次款」分到了 billing,`invoice_list` 没挂上,Agent 一本正经地说「我没有查发票流水的接口」。

路由的问题是粒度太粗:按领域挑,一个请求跨几个领域就会丢。今天把粒度降到单个工具:让模型自己说「我需要一个能干什么的工具」,我们从 60 个里检索出最像的几个,当场挂上。

## 今天要解决的问题

学完你应该能:

1. 说清 Anthropic `defer_loading`、OpenAI `tool_search`、Claude Code MCP 延迟加载这三种内置做法的共同思路。
2. 在 Day 170 的 `run_agent` 里实现工具检索:开局只挂 `search_tools` 和一个常用工具,搜到什么追加什么,循环本身一行不改。
3. 用 30 句客服原话离线测选工具的召回率 recall@k,比较关键词检索和语义检索,知道各自输在哪。
4. 认出工具检索特有的失败方式(漏检后模型以为没有这个能力),说出至少三种防法。

今天只有这两个新概念:**工具检索**和 **recall@k**。为了做检索,会用到两个现成的检索办法:BM25(按关键词打分)和 embedding(把句子变成一串数字比意思)。它们各有一整天的正课([Day 235](/blog/agent-zero/day-235-bm25/) 和 [Day 212](/blog/agent-zero/day-212-why-vectors/)–[Day 217](/blog/agent-zero/day-217-embed-service/)),今天只当成两个黑盒函数用,讲到「知道它大概在干什么、什么时候会输」为止,原理不展开。

预计用时 3 小时。前置:[Day 184](/blog/agent-zero/day-184-tool-search-1/)(`catalog.py`、`Catalog`、今天的任务)、[Day 170](/blog/agent-zero/day-170-agent-full/)(`run_agent` 每一步都读 `registry.schemas`)、[Day 183](/blog/agent-zero/day-183-tool-design-3/)(用一批带答案的题评测)。代码在 `agent-zero-lab/part03/`,命令都在 `agent-zero-lab/` 根目录跑。正文和练习的模型调用按高峰价一共约 ¥0.05;embedding 一共用了约 2,500 个 token,几乎不花钱。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `SearchableRegistry` 和 `recall()`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 厂商的做法:工具先不进上下文,要用再展开

先看别人怎么做,我们再照着做一个。三家的写法不同,思路是一样的:**完整的工具清单你照样交出去,但大部分工具先不放进模型的上下文;给模型一个「搜工具」的工具,它搜到哪个,再把哪个的完整定义展开给它看。**

**Anthropic:`defer_loading`。** 按 2026 年 10 月的 [Claude 文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool),你在 `tools` 里照常放全部工具,给不常用的加一个 `"defer_loading": true`,再加一个搜索工具。搜索工具有两种:`tool_search_tool_regex_20251119`(模型写正则,最长 200 字符)和 `tool_search_tool_bm25_20251119`(模型写一句自然语言,最长 500 字符),两种都搜工具名、描述、参数名和参数描述。搜索在 Anthropic 的服务端执行,默认返回 5 个,API 把它们自动展开成完整定义,模型下一步就能直接调用。几个规则值得记:至少要有一个工具不延迟(通常就是搜索工具本身),全延迟会返回 400;文档建议最常用的 3 到 5 个保持不延迟;被延迟的工具不在请求开头那段里,发现后是追加在对话里的,所以**开头不变,前缀缓存不受影响**;搜索本身不另外收费,展开的定义按普通输入 token 算。文档还给了一条线:10 个以上工具、或者定义超过 10k token,就值得用;10 个以下、每次都全用到的,直接挂。

**OpenAI:`tool_search`。** 按 2026 年 10 月的 [OpenAI 文档](https://developers.openai.com/api/docs/guides/tools-tool-search),在 Responses API 的 `tools` 里加 `{"type": "tool_search"}`,要延迟的函数加 `defer_loading: true`。它推荐把相关函数放进一个 namespace(一组),每组少于 10 个;有 hosted(OpenAI 服务端替你搜)和 client(模型发出搜索请求、你自己的程序去查)两种执行方式,后者适合按租户、权限动态决定有哪些工具。只有 `gpt-5.4` 及以后的模型支持。文档也明说了:新发现的工具追加在上下文末尾以保住缓存,但已加载的工具集合一变,从那一点往后缓存就失效。

**Claude Code:MCP 工具默认就是延迟的。** 如果你在 Claude Code 里接了很多 MCP server,其实已经在用这套了。按 2026 年 10 月的 [Claude Code 文档](https://code.claude.com/docs/en/mcp),Tool Search 默认开启,会话开始时只加载 MCP 工具的名字和 server 的说明,完整定义在需要时通过 `ToolSearch` 工具加载。用环境变量 `ENABLE_TOOL_SEARCH` 控制:不设或 `true` 全部延迟;`auto` 是工具定义总量低于上下文窗口 10% 时直接全加载,超过才开搜索;`false` 是全部直接加载。对写 MCP server 的人有一条很实用:通过搜索加载的工具描述最多保留 16,384 个字符,但**搜索匹配时只看前 4,096 个字符**,所以用户会搜的关键词要写在描述开头。

我们用的 DeepSeek 没有内置这个功能,而且就算有,你也可能想用自己的检索(比如按租户权限过滤掉一部分工具)。所以下面自己在客户端做一个,思路和上面完全一样。Anthropic 文档里也专门有一节「Custom tool search implementation」,说明自己做检索是官方认可的用法。

## 先装两个库,准备 embedding 的 key

```bash
# 在 agent-zero-lab/ 下跑
uv add jieba rank-bm25
```

```text
 + jieba==0.42.1
 + numpy==2.5.4
 + rank-bm25==0.2.2
```

`jieba` 是最常用的中文分词库,`rank-bm25` 是 BM25 打分的现成实现,`numpy` 是后者顺带装上的数值计算库([Day 214](/blog/agent-zero/day-214-numpy-basics/) 才学,今天我们的代码不直接用它)。这两个库都很老了(2022 年和 2020 年的最后版本),但一直是中文关键词检索的常见组合。

embedding 要调一个专门的接口,DeepSeek 不提供,课程用硅基流动(SiliconFlow)的 `BAAI/bge-m3`。如果你的 `.env` 里还没有 `EMB_*` 这几行,去 [siliconflow.cn](https://siliconflow.cn) 注册、实名后在「API 密钥」页新建一个 key,在 `agent-zero-lab/.env` 末尾加上:

```bash
# Embedding:硅基流动 bge-m3(Day 217 会正式讲,今天先用)
EMB_BASE_URL=https://api.siliconflow.cn/v1
EMB_API_KEY=sk-你的key
EMB_MODEL=BAAI/bge-m3
```

硅基流动的价格页上 bge-m3 标注为免费(这是 2026 年 10 月看到的第三方整理和价格页说法,注册后以你账号里看到的为准)。就算收费,今天一共只用两千来个 token,海外平台的报价约每百万 0.01 美元,也就一分钱的零头。

## 检索器:关键词和语义各一个

检索的对象是 60 个工具,每个工具当成一篇「文档」,内容是名字、描述、参数说明拼起来的一段话。用户(这里其实是模型)给一句话,检索器返回最像的 k 个工具名。

两种检索器的直觉:

- **BM25(关键词)**:把句子切成词,看查询里的词在每篇文档里出现了没有、出现几次。越稀有的词分越高,比如「E1043」只出现在一个工具里,命中它就很值钱;「客户」几十个工具都有,命中了也说明不了什么。就像你在 VS Code 里全局搜一个变量名,能搜到的前提是字面上得有。
- **embedding(语义)**:把一段话交给一个专门的模型,它返回一串数字(bge-m3 是 1024 个),意思相近的话,两串数字的「方向」也相近。比较两串数字方向有多接近用余弦相似度,1 是完全同向,0 是不相关。它不要求字面相同,「被扣了两次钱」和「查重复扣款」能被认为很像。

```python
# agent-zero-lab/part03/tool_retrievers.py  两个工具检索器:关键词(BM25)和语义(embedding)
import json
import logging
import math
import os
import re
from functools import cache
from pathlib import Path

import jieba
from dotenv import load_dotenv
from openai import OpenAI
from rank_bm25 import BM25Okapi

from part03.catalog import SPECS

load_dotenv()
jieba.setLogLevel(logging.WARNING)
STOPWORDS = {"的", "了", "是", "吗", "呢", "我", "帮", "能", "想", "要", "这个", "一下", "客户"}
WORD = re.compile(r"[\w一-鿿]+")


def tokenize(text: str) -> list[str]:
    text = text.replace("_", " ")  # invoice_void -> invoice void,英文名也能当关键词
    return [t.lower() for t in jieba.lcut(text) if WORD.fullmatch(t) and t not in STOPWORDS]


def tool_doc(name: str, desc: str, params: dict[str, str]) -> str:
    return f"{name} {desc} " + " ".join(f"{k} {v}" for k, v in params.items())


NAMES = [s[0] for s in SPECS]
DOCS = [tool_doc(*s) for s in SPECS]
_bm25 = BM25Okapi([tokenize(d) for d in DOCS])


def search_bm25(query: str, k: int = 5) -> list[str]:
    scores = _bm25.get_scores(tokenize(query))
    order = sorted(range(len(NAMES)), key=lambda i: scores[i], reverse=True)
    return [NAMES[i] for i in order[:k]]


# ---------- embedding:把一段话变成 1024 个数,意思越近,两串数越「同向」 ----------
_emb = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])
CACHE = Path("workspace/tool_vecs.json")
usage = {"calls": 0, "tokens": 0}


def embed(texts: list[str]) -> list[list[float]]:
    out: list[list[float]] = []
    for i in range(0, len(texts), 10):  # 硅基流动一次最多收一小批,这里每批 10 条
        resp = _emb.embeddings.create(model=os.environ["EMB_MODEL"], input=texts[i:i + 10])
        usage["calls"] += 1
        usage["tokens"] += resp.usage.total_tokens if resp.usage else 0
        out += [d.embedding for d in resp.data]
    return out


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


def _tool_vecs() -> list[list[float]]:
    if CACHE.exists():
        saved = json.loads(CACHE.read_text(encoding="utf-8"))
        if saved["docs"] == DOCS:  # 工具描述改过就重算
            return saved["vecs"]
    vecs = embed(DOCS)
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps({"docs": DOCS, "vecs": vecs}), encoding="utf-8")
    return vecs


@cache
def _query_vec(query: str) -> list[float]:
    return embed([query])[0]  # 同一句话只算一次,评测里 k=1/3/5 共用


def search_embed(query: str, k: int = 5) -> list[str]:
    vecs = _tool_vecs()
    q = _query_vec(query)
    sims = [cosine(v, q) for v in vecs]
    order = sorted(range(len(NAMES)), key=lambda i: sims[i], reverse=True)
    return [NAMES[i] for i in order[:k]]


if __name__ == "__main__":
    print(tokenize("导入银行流水提示 E1043"))
    print(DOCS[NAMES.index("account_disable_2fa")])
    print(tokenize(DOCS[NAMES.index("account_disable_2fa")]))
    for q in ["导入银行流水提示 E1043", "user007 说 10 月被扣了两次钱"]:
        print(q, "| bm25:", search_bm25(q, 3), "| embed:", search_embed(q, 3))
    print("embedding 用量", usage)
```

<div class="line-notes">

- `import jieba` 中文分词。英文天然用空格分词,中文没有空格,得靠它把「导入银行流水」切成「导入 / 银行 / 流水」。
- `from rank_bm25 import BM25Okapi` BM25 的一个实现。`Okapi` 是这个算法最常用的变体的名字,不用管。
- `from part03.catalog import SPECS` Day 184 的 60 个工具三元组。
- `load_dotenv()` 读 `.env`。下面直接用 `os.environ["EMB_BASE_URL"]`,所以必须先读进来。
- `jieba.setLogLevel(logging.WARNING)` jieba 第一次用会打印「Building prefix dict...」之类的调试信息,调高日志级别把它们关掉。
- `STOPWORDS = {"的", "了", "是", "吗", "呢", "我", "帮", "能", "想", "要", "这个", "一下", "客户"}` 停用词:切出来也不参与打分的词。专门加了「客户」:60 个工具里大半的参数说明都是「客户 ID」,这个词区分不了任何工具。
- `WORD = re.compile(r"[\w一-鿿]+")` 只保留由字母、数字、下划线或汉字组成的词,把逗号、空格这些丢掉。`一-鿿` 是常用汉字的 Unicode 范围。
- `text = text.replace("_", " ")  # invoice_void -> invoice void,英文名也能当关键词` 不拆的话 `account_disable_2fa` 是一个整词,谁也搜不到它。
- `return [t.lower() for t in jieba.lcut(text) if WORD.fullmatch(t) and t not in STOPWORDS]` `jieba.lcut` 返回切好的词列表;再过滤掉标点和停用词,统一小写。实测 `tokenize("导入银行流水提示 E1043")` 得到 `['导入', '银行', '流水', '提示', 'e1043']`。
- `def tool_doc(name: str, desc: str, params: dict[str, str]) -> str:` 名字、描述、参数说明拼成一段话。Anthropic 的内置搜索也是搜这四样。
- `DOCS = [tool_doc(*s) for s in SPECS]` `*s` 把三元组拆开传进去,相当于 `tool_doc(s[0], s[1], s[2])`,和 JS 的 `tool_doc(...s)` 一样。
- `_bm25 = BM25Okapi([tokenize(d) for d in DOCS])` 把 60 篇切好词的文档交给 BM25 建索引。模块导入时就建好,一瞬间。
- `scores = _bm25.get_scores(tokenize(query))` 查询切词后,算它和 60 篇文档各自的分数,得到 60 个数。
- `order = sorted(range(len(NAMES)), key=lambda i: scores[i], reverse=True)` 把下标 0 到 59 按分数从高到低排。`lambda i: scores[i]` 相当于 JS 的 `i => scores[i]`。
- `return [NAMES[i] for i in order[:k]]` 取前 k 个的工具名。
- `_emb = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])` 硅基流动的 embedding 接口也是 OpenAI 兼容的,所以直接用 openai SDK 建一个客户端,只是 base_url 和 key 换了。
- `CACHE = Path("workspace/tool_vecs.json")` 60 个工具的向量算一次就存到文件里,下次直接读。工具没变就没必要每次都重算。
- `usage = {"calls": 0, "tokens": 0}` 模块级的计数器,记 embedding 接口一共调了几次、多少 token。
- `for i in range(0, len(texts), 10):  # 硅基流动一次最多收一小批,这里每批 10 条` `range(0, 60, 10)` 得到 0、10、20…50,每次取 10 条发一批。
- `resp = _emb.embeddings.create(model=os.environ["EMB_MODEL"], input=texts[i:i + 10])` embedding 接口:`input` 给一个字符串列表,返回同样多个向量。
- `out += [d.embedding for d in resp.data]` 每个 `d.embedding` 是一个 1024 个浮点数的列表。`+=` 把新列表拼到后面,相当于 JS 的 `out.push(...arr)`。
- `dot = sum(x * y for x, y in zip(a, b))` 余弦相似度的分子:两串数一一相乘再加起来(点积)。`zip(a, b)` 把两个列表按位置配对,相当于 lodash 的 `_.zip`。
- `return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))` 分母是两串数各自的长度。除完以后只剩「方向有多接近」,和数字整体大小无关。用纯 Python 写会慢一点,60 个工具毫无压力;正式的写法在 Day 215 用 numpy。
- `if saved["docs"] == DOCS:  # 工具描述改过就重算` 缓存里连原文一起存着,原文对不上就说明工具描述改过,不能用旧向量。我第一次没写这一行,改了描述检索结果却没变,查了半天。
- `CACHE.write_text(json.dumps({"docs": DOCS, "vecs": vecs}), encoding="utf-8")` 存成 JSON 文件,实测约 1.4 MB。
- `@cache` 标准库 `functools.cache`:同样的参数第二次调用直接返回上次的结果。评测时同一句话要按 k=1、3、5 各查一次,有它就只调一次接口。
- `sims = [cosine(v, q) for v in vecs]` 查询向量和 60 个工具向量各算一次相似度。
- `print("embedding 用量", usage)` 第一次运行要给 60 个工具算向量,分 6 批,加上两句查询,实测 8 次调用、1,769 个 token。

</div>

第一次跑(路径换成了 `/Users/你/`):

```bash
uv run python -m part03.tool_retrievers
```

```text
/Users/你/agent-zero-lab/.venv/lib/python3.12/site-packages/jieba/__init__.py:44: SyntaxWarning: invalid escape sequence '\.'
  re_han_default = re.compile("([一-鿕a-zA-Z0-9+#&\._%\-]+)", re.U)
/Users/你/agent-zero-lab/.venv/lib/python3.12/site-packages/jieba/__init__.py:46: SyntaxWarning: invalid escape sequence '\s'
  re_skip_default = re.compile("(\r\n|\s)", re.U)
/Users/你/agent-zero-lab/.venv/lib/python3.12/site-packages/jieba/finalseg/__init__.py:78: SyntaxWarning: invalid escape sequence '\.'
  re_skip = re.compile("([a-zA-Z0-9]+(?:\.\d+)?%?)")
['导入', '银行', '流水', '提示', 'e1043']
account_disable_2fa 核实身份后关闭客户的两步验证。 customer_id 客户 ID
['account', 'disable', '2fa', '核实', '身份', '后', '关闭', '两步', '验证', 'customer', 'id', 'id']
导入银行流水提示 E1043 | bm25: ['report_import_errors', 'customer_find', 'customer_update_contact'] | embed: ['report_import_errors', 'report_export_status', 'report_revenue_monthly']
user007 说 10 月被扣了两次钱 | bm25: ['subscription_pause', 'refund_calc_annual', 'report_churn'] | embed: ['invoice_list', 'refund_calc_annual', 'billing_retry_charge']
embedding 用量 {'calls': 8, 'tokens': 1769}
```

开头那三段 `SyntaxWarning` 先别慌,它不是我们代码的问题。jieba 是 2020 年的代码,里面写的正则字符串没有加 `r` 前缀,Python 3.12 起对这种写法发警告(老版本是静默的)。只是警告,不影响结果;而且只在第一次导入、Python 把 jieba 编译成缓存文件时出现,第二次跑就没了。如果你嫌它碍眼,可以在命令前面加 `PYTHONWARNINGS=ignore::SyntaxWarning`。

再看两句查询的结果,已经能看出两种检索器的性格:

- 「导入银行流水提示 E1043」两个都把 `report_import_errors` 排第一。错误码 E1043 是一个很稀有的词,BM25 最喜欢这种。
- 「user007 说 10 月被扣了两次钱」BM25 前三全错。它切出来的词是 `被扣`、`两次`、`钱`,而 `invoice_list` 的描述写的是「查重复扣款」,切出来是 `重复`、`扣款`。「被扣」和「扣款」在 jieba 眼里是两个不同的词,一个字面重合都没有。embedding 把 `invoice_list` 排第一,它认得这两句话说的是一回事。

## 离线测召回率:30 句客服原话

只看两句不够。[Day 183](/blog/agent-zero/day-183-tool-design-3/) 说过,凭感觉不算数,要有一批带答案的题。这里的「题」是用户的原话,「答案」是应该用到的那个工具。

指标用 **recall@k**(召回率,读作「recall at k」):检索器返回前 k 个,期望的那个工具在不在里面;30 题里在的比例就是 recall@k。比如 recall@3 = 0.77,意思是 30 题里有 23 题,正确的工具出现在前 3 名里。为什么看「在不在前 k 个」而不是「是不是第一名」?因为我们会把前 k 个全挂上,让模型自己挑,所以只要正确的工具在里面就行。

这一步完全不调大模型,BM25 部分一分钱不花。

```python
# agent-zero-lab/part03/eval_select.py  选工具的离线评测:30 句客服原话,看检索的前 k 个里有没有期望的工具
import sys
from collections.abc import Callable

from part03.tool_retrievers import search_bm25, search_embed, usage

CASES = [
    ("user007 说 10 月被扣了两次钱", "invoice_list"),
    ("我们想从专业版升到企业版", "subscription_change_plan"),
    ("公司又来了三个同事,要加人", "subscription_change_seats"),
    ("下个月起不用了,帮我停掉", "subscription_cancel"),
    ("年付用了两个月想退,能退多少", "refund_calc_annual"),
    ("我上周申请的退款到哪一步了", "refund_status"),
    ("发票上公司名字写错了", "invoice_change_title"),
    ("把 9 月那张发票再发我一次", "invoice_resend"),
    ("要一份发票的 PDF 报销用", "invoice_get_pdf"),
    ("对公转账已经打过去了,系统还显示没付", "invoice_mark_paid"),
    ("登录不上去,密码忘了", "account_reset_password"),
    ("手机换了,收不到两步验证码", "account_disable_2fa"),
    ("账号被锁了,说输错太多次", "account_unlock"),
    ("怀疑有人盗号,看看最近谁登录过", "account_login_history"),
    ("原来的管理员离职了,要换负责人", "account_transfer_owner"),
    ("导出报表一直失败", "report_export_status"),
    ("导入银行流水提示 E1043", "report_import_errors"),
    ("我们买了 20 个席位,好像没几个人在用", "report_seat_usage"),
    ("别再给我发促销邮件了", "notify_unsubscribe"),
    ("信用卡过期了要换一张", "billing_update_payment_method"),
    ("这个月扣款失败了,能再扣一次吗", "billing_retry_charge"),
    ("有个优惠码 SAVE20 怎么用", "billing_apply_coupon"),
    ("账户里还有多少余额可以抵扣", "billing_credit_balance"),
    ("我注册了两个号,能合成一个吗", "customer_merge"),
    ("帮我把联系电话改成新号码", "customer_update_contact"),
    ("我要注销账号,把我的数据删掉", "customer_delete_request"),
    ("多币种账本里美元怎么换算成人民币", "billing_currency_convert"),
    ("以前有没有人问过同样的导入问题", "ticket_search"),
    ("暂停三个月,淡季不用", "subscription_pause"),
    ("不想自动续费", "subscription_toggle_autorenew"),
]


def recall(search: Callable[[str, int], list[str]], k: int) -> tuple[float, list[str]]:
    misses = [q for q, want in CASES if want not in search(q, k)]
    return 1 - len(misses) / len(CASES), misses


if __name__ == "__main__":
    methods: dict[str, Callable[[str, int], list[str]]] = {"bm25": search_bm25}
    if "--embed" in sys.argv:
        methods["embed"] = search_embed
    for name, fn in methods.items():
        for k in (1, 3, 5):
            r, misses = recall(fn, k)
            print(f"{name:6} recall@{k} = {r:.2f}  漏掉 {len(misses)} 条")
        print("  前 5 个里还是没有的:", misses)
    print("embedding 用量", usage)
```

<div class="line-notes">

- `from collections.abc import Callable` 用来标注「函数类型」。`Callable[[str, int], list[str]]` 读作「一个接收 (str, int)、返回 list[str] 的函数」,相当于 TS 的 `(q: string, k: number) => string[]`。
- `CASES = [` 每条是「用户原话 → 期望工具」。说法故意写得很口语,很多条和工具描述没有一个字重合。真实项目里这份题应该从历史工单里抽,不要自己编,自己编的句子会不自觉地往工具描述上靠。
- `("user007 说 10 月被扣了两次钱", "invoice_list"),` 有的问题要用好几个工具,这里只标「第一个必须找到的」。
- `("公司又来了三个同事,要加人", "subscription_change_seats"),` 用户说「加人」,工具描述说「增加或减少席位数量」,一个字都不一样。
- `("导入银行流水提示 E1043", "report_import_errors"),` 这条是给 BM25 的送分题。
- `def recall(search: Callable[[str, int], list[str]], k: int) -> tuple[float, list[str]]:` 第一个参数是一个检索函数。两个检索器签名一样,可以直接传进来比较,这和 JS 里把回调函数当参数传是一回事。
- `misses = [q for q, want in CASES if want not in search(q, k)]` 期望工具不在前 k 个里的题,收集起来。
- `return 1 - len(misses) / len(CASES), misses` 返回召回率和漏掉的题。Python 的 `return a, b` 返回一个元组,调用方用 `r, misses = ...` 解构。
- `methods: dict[str, Callable[[str, int], list[str]]] = {"bm25": search_bm25}` 默认只跑 BM25,加 `--embed` 才跑 embedding,因为后者要联网调接口。

</div>

```bash
uv run python -m part03.eval_select --embed
```

```text
bm25   recall@1 = 0.67  漏掉 10 条
bm25   recall@3 = 0.77  漏掉 7 条
bm25   recall@5 = 0.77  漏掉 7 条
  前 5 个里还是没有的: ['user007 说 10 月被扣了两次钱', '公司又来了三个同事,要加人', '下个月起不用了,帮我停掉', '发票上公司名字写错了', '原来的管理员离职了,要换负责人', '信用卡过期了要换一张', '帮我把联系电话改成新号码']
embed  recall@1 = 0.80  漏掉 6 条
embed  recall@3 = 1.00  漏掉 0 条
embed  recall@5 = 1.00  漏掉 0 条
  前 5 个里还是没有的: []
embedding 用量 {'calls': 30, 'tokens': 364}
```

整理成表(2026 年 10 月 22 日实测):

| 检索方式 | recall@1 | recall@3 | recall@5 |
| --- | --- | --- | --- |
| BM25(jieba 分词) | 0.67 | 0.77 | 0.77 |
| embedding(bge-m3) | 0.80 | 1.00 | 1.00 |

在选工具这件事上,embedding 几乎全面胜出。BM25 漏掉的 7 条有一个共同点:**用户的说法和工具描述的写法字面上差得远**。拿两条看切词结果:

```text
'公司又来了三个同事,要加人' -> ['公司', '又', '来', '三个', '同事', '加人']
subscription_change_seats 的文档 -> ['subscription', 'change', 'seats', '增加', '或', '减少', '席位', '数量', 'customer', 'id', 'id', 'seats', '新', '席位数']
```

一个词都对不上。BM25 只能靠「公司」这个词去匹配,前三名给出的是 `customer_find`(描述里有「公司名」)、`account_list_members`、`report_revenue_monthly`,全错。embedding 把 `subscription_change_seats` 排第三,它知道「来了同事要加人」和「增加席位」是一个意思。

```text
'发票上公司名字写错了' -> ['发票', '上', '公司', '名字', '写错']
```

这句有「发票」,看起来该命中发票类工具,可是 BM25 仍然没找到 `invoice_change_title`。原因是「发票」出现在好几个工具里,不稀有,分不高;而「公司」又把 `customer_find` 拉了上去。真正关键的「抬头」这个词,用户根本不会说。

embedding 的 recall@1 是 0.80,也就是有 6 题它把正确答案排在了第二、三名,比如「发票上公司名字写错了」它排第一的是 `billing_retry_charge`,正确的 `invoice_change_title` 在第三。所以单看第一名它也不太可靠,前 3 到 5 个一起挂才稳。

这和 Day 235 会学到的「搜帮助中心文章」时的结论不一样。那里错误码、产品名这种精确字符串很多,BM25 很有优势。到了选工具,用户描述问题的方式和工程师写工具描述的方式差得很远,正好是语义检索擅长、关键词检索吃亏的场景。如果只能选一个,工具检索我选 embedding,k 取 3 到 5;练习 3 会试试两个一起用。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="30 句客服原话的召回率:BM25 recall@1 0.67、@3 0.77、@5 0.77;embedding 0.80、1.00、1.00">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">30 句客服原话的选工具召回率(琥珀 = BM25,蓝 = embedding)</text>
  <line x1="90" y1="190" x2="620" y2="190" stroke="var(--rule)"/>
  <text x="90" y="206" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">0</text>
  <text x="600" y="206" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">1.00</text>
  <text x="20" y="62" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">@1</text>
  <rect x="90" y="48" width="342" height="14" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="440" y="59" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">0.67</text>
  <rect x="90" y="64" width="408" height="14" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="506" y="75" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">0.80</text>
  <text x="20" y="112" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">@3</text>
  <rect x="90" y="98" width="393" height="14" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="491" y="109" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">0.77</text>
  <rect x="90" y="114" width="510" height="14" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="560" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1.00</text>
  <text x="20" y="166" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">@5</text>
  <rect x="90" y="152" width="393" height="14" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="491" y="163" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">0.77</text>
  <rect x="90" y="168" width="510" height="14" fill="var(--mem-wash)" stroke="var(--mem)"/>
</svg>
<figcaption>BM25 从 k=3 起就不再涨了:那 7 条和工具描述字面上没有重合,排第几都轮不到。embedding 在 k=3 时已经全找到,只是第一名不总对。</figcaption>
</figure>

## 接进 Agent 循环

检索器有了,接进 [Day 170](/blog/agent-zero/day-170-agent-full/) 的 `run_agent`。关键在于 `run_agent` 每一步都会重新读 `registry.schemas`,所以只要写一个注册表的子类,让 `schemas` 这个列表随着搜索结果变长,循环本身一行都不用改。

开局只挂两个工具:`search_tools`(搜工具的工具)和 `customer_find`(几乎每张工单都要先查客户,常驻)。模型调用 `search_tools("查客户的发票")` 时,我们用 embedding 检索出前 k 个,把它们**追加**到已加载的列表里;模型下一步发请求时,这几个工具的完整定义就在里面了。

```python
# agent-zero-lab/part03/search_agent.py  开局只挂 search_tools 和一个常用工具,搜到什么再挂什么
import json
import sys
from typing import Any

from part03.agent_loop import ToolRegistry, run_agent
from part03.catalog import SCHEMAS, SPECS, Catalog, run_tool
from part03.tool_retrievers import search_embed

SEARCH_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "search_tools",
        "description": "按功能搜索可用的后台工具。手头的工具不够用时先调它,搜到的工具下一步就能直接调用。"
        "工具覆盖:客户、订阅、发票、退款、工单、帮助中心、账号安全、报表、通知、计费。",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string", "description": "要做的事,用一句话描述,如「查客户的发票」"}},
            "required": ["query"],
        },
    },
}
DESC = {name: desc for name, desc, _ in SPECS}


class SearchableRegistry(ToolRegistry):
    def __init__(self, always: list[str], k: int = 3) -> None:
        super().__init__()
        self.k = k
        self.loaded: list[str] = list(always)
        self.searches: list[tuple[str, list[str]]] = []
        self._refresh()

    def _refresh(self) -> None:
        self.schemas[:] = [SEARCH_TOOL] + [SCHEMAS[n] for n in self.loaded]

    def call(self, name: str, arguments: str) -> str:
        args = json.loads(arguments or "{}")
        if name == "search_tools":
            hits = search_embed(args["query"], self.k)
            new = [h for h in hits if h not in self.loaded]
            self.loaded += new  # 只追加不删除
            self._refresh()
            self.searches.append((args["query"], hits))
            found = [{"name": h, "description": DESC[h]} for h in hits]
            return json.dumps({"found": found, "newly_loaded": new}, ensure_ascii=False)
        if name not in self.loaded:
            return json.dumps({"error": f"{name} 还没加载,先用 search_tools 搜一下"}, ensure_ascii=False)
        return json.dumps(run_tool(name, args), ensure_ascii=False)


SYSTEM = "你是云簿 CloudLedger 的客服助手,先用工具核实事实再回答。金额字段单位是分,回答时换算成元。"
TASK = "user007@example.com 说 10 月被扣了两次款,帮我核实一下。如果确实重复了,直接帮他把多扣的那笔提交退款申请。"

if __name__ == "__main__":
    if "--all" in sys.argv:
        reg: ToolRegistry = Catalog(list(SCHEMAS))
    else:
        reg = SearchableRegistry(always=["customer_find"], k=5 if "--k5" in sys.argv else 3)
    answer, llm = run_agent(reg, SYSTEM, TASK, max_steps=8)
    print("== 回答\n" + answer)
    if isinstance(reg, SearchableRegistry):
        for q, hits in reg.searches:
            print("搜索", q, "->", hits)
    print(f"最后挂着 {len(reg.schemas)} 个工具 |", llm.ledger)
```

<div class="line-notes">

- `from part03.catalog import SCHEMAS, SPECS, Catalog, run_tool` 复用 Day 184 的工具表和执行函数。`Catalog` 是对照组用的全挂版本。
- `SEARCH_TOOL: dict[str, Any] = {` 搜索工具的 schema 是手写的,不走装饰器,因为它的执行逻辑在注册表的 `call` 里。
- `"description": "按功能搜索可用的后台工具。手头的工具不够用时先调它,搜到的工具下一步就能直接调用。"` 这句决定了模型什么时候想起来用它,而且告诉它「搜到的下一步就能用」,不然它可能搜完不敢调。
- `"工具覆盖:客户、订阅、发票、退款、工单、帮助中心、账号安全、报表、通知、计费。",` 把有哪些领域列出来。没有这句,模型不知道后台有没有退款类的工具,可能直接放弃。Anthropic 的文档也建议在提示里写一句「你可以搜索 xx、xx 相关的工具」。
- `"properties": {"query": {"type": "string", "description": "要做的事,用一句话描述,如「查客户的发票」"}},` 给查询的写法举个例子。实测模型第一次搜的是「查客户的支付扣款记录和发票」,确实是一句话。
- `DESC = {name: desc for name, desc, _ in SPECS}` 名字到描述的字典,搜索结果里要给模型看描述。`_` 是约定俗成的「这个值我不要」。
- `class SearchableRegistry(ToolRegistry):` 继承 Day 168 的注册表,复用 `schemas` 这个属性,重写 `call`。装饰器那套这里用不上。
- `def __init__(self, always: list[str], k: int = 3) -> None:` `always` 是开局就挂上的工具,`k` 是每次搜索返回几个。默认 3,马上就会看到这个数太小。
- `self.loaded: list[str] = list(always)` 已加载的工具名。用 list 而不用 set,因为要保持追加的顺序。`list(always)` 复制一份,避免改到调用方传进来的列表。
- `self.searches: list[tuple[str, list[str]]] = []` 记下每次搜了什么、搜到什么,跑完打印出来分析。
- `self.schemas[:] = [SEARCH_TOOL] + [SCHEMAS[n] for n in self.loaded]` 切片赋值 `[:] =` 是原地替换列表内容,列表还是原来那个对象。相当于 JS 里 `arr.splice(0, arr.length, ...newItems)`。
- `hits = search_embed(args["query"], self.k)` 用 embedding 检索,返回前 k 个工具名。
- `new = [h for h in hits if h not in self.loaded]` 已经挂上的不重复追加。
- `self.loaded += new  # 只追加不删除` 为什么不删:工具定义在请求开头,删掉一个,后面所有内容的位置都变了,前缀缓存从那一点开始失效。只追加至少能保住前面那段。代价是工具只增不减,长任务里可能慢慢涨回去,那时可以设一个上限,超过就清空重来。
- `found = [{"name": h, "description": DESC[h]} for h in hits]` 把搜到的工具名和描述作为工具结果返回,让模型知道现在多了什么。完整定义已经通过 `schemas` 在下一步请求里给它了,这里不用重复。
- `if name not in self.loaded:` 防止模型调用还没加载的工具(比如它从别处见过这个名字)。给一句能纠正它的报错,这是 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 原则六。今天的实跑没触发过这个分支。
- `TASK = "user007@example.com 说 10 月被扣了两次款,帮我核实一下。如果确实重复了,直接帮他把多扣的那笔提交退款申请。"` 比 Day 184 多了后半句,逼它跨三个领域:客户、发票、退款。
- `reg: ToolRegistry = Catalog(list(SCHEMAS))` 带 `--all` 是对照组,60 个全挂。变量标注成父类 `ToolRegistry`,下一行才能赋一个 `SearchableRegistry` 给它,不然类型检查器会报错。
- `reg = SearchableRegistry(always=["customer_find"], k=5 if "--k5" in sys.argv else 3)` 带 `--k5` 就每次搜 5 个。
- `if isinstance(reg, SearchableRegistry):` `isinstance` 判断对象是不是某个类(或子类)的实例,相当于 JS 的 `instanceof`。只有检索版有 `searches` 可打印。

</div>

先跑检索版(k=3)和全挂版:

```bash
uv run python -m part03.search_agent
uv run python -m part03.search_agent --all
```

检索版:

```text
[step 1] 输入 473 tok | 输出 86 tok
    调用 customer_find({"query": "user007@example.com"}) -> 返回 81 字符
    调用 search_tools({"query": "查客户的支付扣款记录和发票"}) -> 返回 332 字符
[step 2] 输入 924 tok | 输出 73 tok
    调用 invoice_list({"customer_id": "C007"}) -> 返回 282 字符
    调用 billing_credit_balance({"customer_id": "C007"}) -> 返回 58 字符
[step 3] 输入 1162 tok | 输出 266 tok
    调用 search_tools({"query": "提交退款申请"}) -> 返回 262 字符
[step 4] 输入 1724 tok | 输出 334 tok
== 回答
核实结论和限制说明如下:

**✅ 重复扣款已确认**
- 2026-10-08 有两笔完全相同的扣款:INV-2026-0123 和 INV-2026-0026,各 **2,392.00 元**,合计 4,784.00 元,应当只发生一笔,多扣 **2,392.00 元**。
- 2025-10-08 的 INV-2025-0871 是去年的正常年费,与此无关。

**⚠️ 退款申请我这边提交不了**
我现有的退款工具只有:撤回申请(`refund_cancel`)、审批通过(`refund_approve`)、查询进度(`refund_status`),**没有创建/提交退款申请的接口**。所以这笔退款需要走另一条路:
……
搜索 查客户的支付扣款记录和发票 -> ['invoice_list', 'billing_credit_balance', 'billing_update_payment_method']
搜索 提交退款申请 -> ['refund_cancel', 'refund_approve', 'refund_status']
最后挂着 8 个工具 | 4 次调用 | 输入 4283 / 输出 759 tokens | 约 ¥0.0114
```

全挂版(回答只保留和退款有关的一句):

```text
[step 1] 输入 4530 tok | 输出 50 tok
    调用 customer_find({"query": "user007@example.com"}) -> 返回 81 字符
[step 2] 输入 4624 tok | 输出 39 tok
    调用 invoice_list({"customer_id": "C007"}) -> 返回 282 字符
[step 3] 输入 4796 tok | 输出 74 tok
    调用 subscription_get({"customer_id": "C007"}) -> 返回 106 字符
    调用 billing_credit_balance({"customer_id": "C007"}) -> 返回 58 字符
[step 4] 输入 4958 tok | 输出 446 tok
== 回答
……
- 一旦确认重复,我立刻按客户指定的发票号提交 2,392.00 元的退款申请(需主管审批,不是即时到账);
……
最后挂着 60 个工具 | 4 次调用 | 输入 18908 / 输出 609 tokens | 约 ¥0.0071
```

前两步很漂亮。第一步模型**同时**调了 `customer_find` 和 `search_tools`([Day 162](/blog/agent-zero/day-162-parallel-tools/) 的并行工具调用),第二步拿到 `invoice_list` 查出了 10 月 8 日两张同金额的发票。输入 token 是全挂版的 23%:4,283 对 18,908。

(钱只差不到一倍,而且检索版反而更贵:¥0.0114 对 ¥0.0071。原因有二:检索版输出多了 150 个 token,输出价是输入的四倍;全挂版的 60 个工具定义每步不变,几乎全部命中缓存,检索版的工具列表每搜一次就变一次,缓存命中少。Day 184 说过,按需挂工具和前缀缓存天生有点冲突,这就是实例。工具多到几百个、定义几万 token 时,省下的输入远远盖过这点损失;60 个工具、每个七十来 token,账就打得很近。)

问题出在第三步。模型要提交退款,搜了「提交退款申请」,k=3 返回的是撤回、审批、查进度,**偏偏没有 `refund_submit`**。单独查一下:

```bash
uv run python -c "
from part03.tool_retrievers import search_embed, search_bm25
print(search_embed('提交退款申请', 6)); print(search_bm25('提交退款申请', 6))"
```

```text
['refund_cancel', 'refund_approve', 'refund_status', 'refund_submit', 'refund_list_pending', 'refund_calc_annual']
['refund_submit', 'refund_approve', 'refund_cancel', 'refund_status', 'refund_list_pending', 'customer_delete_request']
```

embedding 把 `refund_submit` 排在第四,刚好被 k=3 截掉。有意思的是,这一次 BM25 反而把它排第一,因为查询「提交退款申请」和它的描述「提交退款申请,需要主管审批……」字面上一模一样。六个退款工具的描述都是「……退款申请……」,意思上彼此都很近,embedding 分不太开;而字面完全重合正是 BM25 的强项。

然后模型在回答里写:「我现有的退款工具只有撤回、审批、查进度,**没有创建/提交退款申请的接口**。」它没有编造,没有报错,还很负责地给出了替代方案。只看这一条回答,你会以为后台真的没有这个功能。全挂版就不会这样,它知道 `refund_submit` 存在,明确说「一旦确认重复,我立刻提交」。

这就是工具检索最典型的失败方式,和 Day 184 路由分错领域是同一种:**没检索到的工具,在模型眼里就等于不存在,它会很合理地绕开。** 而且比路由更隐蔽,因为它确实搜了,也确实搜到了「退款」相关的东西。

那把 k 调到 5 是不是就好了?跑一下:

```bash
uv run python -m part03.search_agent --k5
```

```text
[step 1] 输入 473 tok | 输出 92 tok
    调用 customer_find({"query": "user007@example.com"}) -> 返回 81 字符
    调用 search_tools({"query": "查询客户某月的扣款/支付记录,检查是否重复扣款"}) -> 返回 502 字符
[step 2] 输入 1121 tok | 输出 39 tok
    调用 invoice_list({"customer_id": "C007"}) -> 返回 282 字符
[step 3] 输入 1293 tok | 输出 412 tok
== 回答
……
**关于直接提交退款**:这一步我没有照做,需要先跟你确认。原因是我手上目前只有「查退款进度」的工具,没有创建退款申请的工具;……
搜索 查询客户某月的扣款/支付记录,检查是否重复扣款 -> ['invoice_list', 'billing_credit_balance', 'billing_retry_charge', 'billing_update_payment_method', 'refund_status']
最后挂着 7 个工具 | 3 次调用 | 输入 2887 / 输出 543 tokens | 约 ¥0.0066
```

更糟了。第一次搜索 k=5 顺带捞上来一个 `refund_status`,模型看到手里有一个退款类工具,就**以为退款类的工具就这么多**,连搜都没再搜,直接说「没有创建退款申请的工具」。k 大了,一次搜得多了,反而让它产生了「我已经看过全部」的错觉。

这说明光调 k 不够,还要在搜索工具的描述里告诉模型:搜到的只是一部分,没找到就换个说法再搜。练习 1 把三处改动(k=5、改搜索描述、给 `refund_submit` 描述加用户说法)一起上,模型就会再搜一次,找到并调用了 `refund_submit`。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="工具检索流程和漏检:开局挂 search_tools 和 customer_find,搜索结果追加到已加载列表;refund_submit 排第四被 k=3 截掉,模型认为没有这个能力">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="30" width="180" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="110" y="54" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">第 1 步挂着</text>
  <text x="110" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">search_tools</text>
  <text x="110" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">customer_find</text>
  <line x1="200" y1="65" x2="235" y2="65" stroke="var(--rule)"/>
  <rect x="235" y="30" width="170" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="54" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型</text>
  <text x="320" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">search_tools(</text>
  <text x="320" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">"提交退款申请")</text>
  <line x1="405" y1="65" x2="440" y2="65" stroke="var(--rule)"/>
  <rect x="440" y="30" width="180" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="530" y="54" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">检索器 k=3</text>
  <text x="530" y="74" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1 cancel 2 approve</text>
  <text x="530" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3 status | 4 submit ✂</text>
  <line x1="530" y1="100" x2="530" y2="140" stroke="var(--rule)"/>
  <rect x="380" y="140" width="240" height="60" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="500" y="164" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">loaded 追加 3 个</text>
  <text x="500" y="184" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只追加不删除</text>
  <line x1="380" y1="170" x2="345" y2="170" stroke="var(--rule)"/>
  <rect x="20" y="140" width="325" height="60" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="182" y="164" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型:我没有提交退款的接口</text>
  <text x="182" y="184" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">不报错,不编造,只是绕开了</text>
  <text x="320" y="235" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">没检索到的工具,在模型眼里就等于不存在</text>
</svg>
<figcaption>客户端版的工具检索。上面一行是正常流程:模型搜、检索器挑前 k 个、追加进已加载列表、下一步生效。这次 refund_submit 排第四,被 k=3 截掉,模型就合理地得出了「没有这个功能」的结论。</figcaption>
</figure>

## 漏检了怎么防

按成本从低到高:

1. **k 别取太小,但光调 k 不够。** 3 个太紧,5 个更稳,多出来的两个定义也就一百多 token。但上面看到了,k 大了模型可能更早停止搜索。
2. **搜索工具的描述里写明「没找到就换个说法再搜」。** 比如加一句「没找到合适的工具时换一种说法再搜一次,不要直接认为没有这个功能」。这是专门对付「以为看过全部」的。
3. **工具描述里写上用户会怎么说。** `refund_submit` 的描述是「提交退款申请」,用户说的是「给他退钱」「多扣了要退回来」。这其实就是 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 原则三在检索场景里的样子:描述既写给模型看,也写给检索器看。
4. **按组加载。** 搜到一个 `refund_` 开头的工具,就把整个 `refund_` 组都挂上。OpenAI 推荐用 namespace 组织延迟加载也是这个道理。练习 2 会试,并会看到它带来的新问题。
5. **两种检索器一起用。** 上面「提交退款申请」BM25 排第一、embedding 排第四,两个取并集就不会漏。练习 3 会离线测。
6. **对「没有这个能力」做兜底检查。** 评测时除了看答案对不对,还要看「本该调用的工具最后有没有被调用」。上面那次漏检,只看回答是发现不了的,回答本身合情合理。第六部分的轨迹评测会专门讲。

## 怎么评测工具检索

和以后要学的 RAG 一样,分两层看:

**检索层**:离线 recall@k,就是上面那张表。不调大模型、不花钱、几秒跑完,每次改工具描述、改分词、换 embedding 模型,先跑它。注意一条请求可能需要好几个工具,更严格的版本要检查「这条请求需要的所有工具都被召回了」,而不只是第一个。

**端到端**:让 Agent 真跑一批任务,像 Day 183 那样记成功率、步数、输入 token,再加一项「该调用的工具有没有被调用」。今天的漏检在检索层看不出来(30 题里没有「提交退款申请」这一句),只有在端到端的轨迹里才暴露。两层都要有。

最后算一笔账。检索会多出搜索的那一两步:今天检索版比全挂版多两次搜索调用,输出多了 150 个 token,缓存命中也少,结果钱反而更多。所以工具很少时检索不划算,这也是 Anthropic 文档说 10 个以下工具不用搜索的原因。我自己的经验线是:工具定义加起来超过上下文的 10%(和 Claude Code `auto` 模式的默认阈值一样),或者工具过了三五十个,就值得做;低于这个,先用 Day 184 的砍、合并、路由。

## 动手练习

### 练习 1:三处小改,把 refund_submit 找回来

在不改 `search_agent.py` 的前提下,写一个新脚本:给 `refund_submit` 的描述加上「客户要退款、要退钱、多扣了要退回时用它」,给 `search_tools` 的描述加上「没找到就换种说法再搜」,k 改成 5。重跑同一个任务,看 `refund_submit` 有没有被搜到、被调用。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/search_agent_fix.py  练习 1:三处小改,让 refund_submit 不再被漏掉
import json
import sys

from part03 import catalog, search_agent
from part03.agent_loop import run_agent
from part03.search_agent import SYSTEM, TASK, SearchableRegistry

# 改动一:refund_submit 的描述里写上用户会怎么说
name, desc, params = catalog.SPECS[18]
assert name == "refund_submit"
catalog.SCHEMAS[name]["function"]["description"] = desc + "客户要退款、要退钱、多扣了要退回时用它。"
search_agent.DESC[name] = catalog.SCHEMAS[name]["function"]["description"]
# 改动二:搜索工具的描述里叮嘱「搜不到就换个说法」
search_agent.SEARCH_TOOL["function"]["description"] += "没找到合适的工具时换一种说法再搜一次,不要直接认为没有这个功能。"

if __name__ == "__main__":
    reg = SearchableRegistry(always=["customer_find"], k=5)  # 改动三:k 从 3 调到 5
    answer, llm = run_agent(reg, SYSTEM, TASK, max_steps=8)
    print("== 回答\n" + answer[:400])
    for q, hits in reg.searches:
        print("搜索", q, "->", hits)
    print(f"最后挂着 {len(reg.schemas)} 个工具 |", llm.ledger)
```

<div class="line-notes">

- `from part03 import catalog, search_agent` 导入整个模块对象,下面要改模块里的变量。直接 `from ... import SCHEMAS` 拿到的也是同一个字典,改它也行,但写成 `catalog.SCHEMAS` 更容易看出改的是哪里。
- `name, desc, params = catalog.SPECS[18]` 第 19 个工具(下标从 0 开始)就是 `refund_submit`。
- `assert name == "refund_submit"` `assert` 不成立时直接抛异常。防止以后有人往 `SPECS` 里插了一行,下标错位,改到别的工具上。
- `catalog.SCHEMAS[name]["function"]["description"] = desc + "客户要退款、要退钱、多扣了要退回时用它。"` 改的是**模型看到的**描述。注意:检索器的 `DOCS` 在 `tool_retrievers` 被导入时已经从 `SPECS` 拼好了,所以这一改不影响检索排名。想让检索也受益,得改 `SPECS` 本身再重建索引。
- `search_agent.DESC[name] = catalog.SCHEMAS[name]["function"]["description"]` 搜索结果里给模型看的描述也同步改。
- `search_agent.SEARCH_TOOL["function"]["description"] += "没找到合适的工具时换一种说法再搜一次,不要直接认为没有这个功能。"` `+=` 对字符串是拼接。这是对付「以为已经看过全部」的那一句。
- `reg = SearchableRegistry(always=["customer_find"], k=5)  # 改动三:k 从 3 调到 5` 三处改动一起上。

</div>

```bash
uv run python -m part03.search_agent_fix
```

```text
[step 1] 输入 492 tok | 输出 90 tok
    调用 customer_find({"query": "user007@example.com"}) -> 返回 81 字符
    调用 search_tools({"query": "查客户的扣款记录和发票"}) -> 返回 534 字符
[step 2] 输入 1161 tok | 输出 39 tok
    调用 invoice_list({"customer_id": "C007"}) -> 返回 282 字符
[step 3] 输入 1333 tok | 输出 119 tok
    调用 billing_credit_balance({"customer_id": "C007"}) -> 返回 58 字符
    调用 search_tools({"query": "提交退款申请"}) -> 返回 457 字符
[step 4] 输入 2027 tok | 输出 136 tok
    调用 refund_submit({"invoice_id": "INV-2026-0026", "amount_yuan": "2392.00", "reason": "2026-10-08 重复扣款:INV-2026-0026 与 INV-2026-0123 同日同额(各 2392.00 元),客户确认只应扣一次,退回重复的一笔"}) -> 返回 49 字符
[step 5] 输入 2197 tok | 输出 350 tok
== 回答
已经帮你核实了,情况属实 👇
……
- 已针对 **INV-2026-0026** 提交退款申请,金额 **2392.00 元**,原因注明为重复扣款。
- 请注意:这笔退款**还需主管审批**,提交后并不会立即退款,到账时间取决于审批进度。
……
搜索 查客户的扣款记录和发票 -> ['invoice_list', 'billing_credit_balance', 'billing_update_payment_method', 'billing_retry_charge', 'report_import_errors']
搜索 提交退款申请 -> ['refund_cancel', 'refund_approve', 'refund_status', 'refund_submit', 'refund_list_pending']
最后挂着 12 个工具 | 5 次调用 | 输入 7210 / 输出 734 tokens | 约 ¥0.0118
```

这次第三步模型主动又搜了一次「提交退款申请」,k=5 把排第四的 `refund_submit` 带了上来,第四步它带着正确的发票号和金额调用了。

两点要老实说明。第一,第二次搜索的排名和原来一模一样,`refund_submit` 还是第四,说明起作用的是 k=5,改 `refund_submit` 的描述没有影响检索(原因见 line-notes)。第二,这只是一次运行,模型有随机性,要确认改动有效,得像 Day 183 那样同一个任务多跑几遍。

还有一个值得警惕的地方:任务里写了「直接帮他提交」,模型就真的提交了。`refund_submit` 在这里是演示桩,真系统里这是一次写操作。第七部分讲审批和人工确认时会回到这个问题。

</details>

### 练习 2:按前缀整组加载

写一个 `SearchableRegistry` 的子类,每次 `_refresh` 时,只要已加载里有某个前缀的工具,就把这个前缀的所有工具都追加上。k 保持 3,跑同一个任务,看能不能找到 `refund_submit`,输入 token 多了多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/search_agent_group.py  练习 2:搜到一个工具,就把它所在的整组(同前缀)都挂上
from part03.agent_loop import run_agent
from part03.catalog import SCHEMAS
from part03.search_agent import SYSTEM, TASK, SearchableRegistry


class GroupRegistry(SearchableRegistry):
    def _refresh(self) -> None:
        prefixes = {n.split("_")[0] for n in self.loaded}
        for name in SCHEMAS:  # 按 SCHEMAS 原有顺序追加,同一组排在一起
            if name.split("_")[0] in prefixes and name not in self.loaded:
                self.loaded.append(name)
        super()._refresh()


if __name__ == "__main__":
    reg = GroupRegistry(always=["customer_find"], k=3)
    answer, llm = run_agent(reg, SYSTEM, TASK, max_steps=8)
    print("== 回答\n" + answer[:300])
    for q, hits in reg.searches:
        print("搜索", q, "->", hits)
    print(f"最后挂着 {len(reg.schemas)} 个工具 |", llm.ledger)
```

<div class="line-notes">

- `class GroupRegistry(SearchableRegistry):` 只重写 `_refresh`,搜索和调用的逻辑全部继承。
- `prefixes = {n.split("_")[0] for n in self.loaded}` 集合推导式,得到已加载工具涉及的所有前缀,比如 `{"customer", "invoice", "billing"}`。
- `for name in SCHEMAS:  # 按 SCHEMAS 原有顺序追加,同一组排在一起` 遍历全部 60 个,同前缀且还没加载的就追加。注意开局 `always=["customer_find"]` 时,customer 组的 6 个一开始就全挂上了。
- `super()._refresh()` 最后交给父类去重建 `schemas`。`super()` 相当于 JS class 里的 `super`。

</div>

```bash
uv run python -m part03.search_agent_group
```

```text
[step 1] 输入 864 tok | 输出 48 tok
    调用 customer_find({"query": "user007@example.com"}) -> 返回 81 字符
[step 2] 输入 956 tok | 输出 86 tok
    调用 search_tools({"query": "查客户的发票和扣款记录"}) -> 返回 312 字符
    调用 search_tools({"query": "提交退款申请"}) -> 返回 262 字符
[step 3] 输入 2542 tok | 输出 104 tok
    调用 invoice_list({"customer_id": "C007"}) -> 返回 282 字符
    调用 refund_submit({"invoice_id": "placeholder", "amount_yuan": "0", "reason": "placeholder"}) -> 返回 49 字符
[step 4] 输入 2809 tok | 输出 389 tok
== 回答
抱歉,我刚才误发了一个占位参数的调用,那次是演示桩、没有实际执行,不影响任何数据。
……
搜索 查客户的发票和扣款记录 -> ['invoice_list', 'billing_credit_balance', 'billing_retry_charge']
搜索 提交退款申请 -> ['refund_cancel', 'refund_approve', 'refund_status']
最后挂着 25 个工具 | 4 次调用 | 输入 7171 / 输出 627 tokens | 约 ¥0.0106
```

找到了:第二次搜索只返回了 cancel、approve、status,但整组加载把 `refund_submit` 也带上了。代价是最后挂了 25 个工具(customer、invoice、billing、refund 四组全上),输入 7,171,比 k=3 的检索版多了将近七成。

更要命的是第三步:模型**同时**调了 `invoice_list` 和 `refund_submit`,而后者的参数是 `"placeholder"`。它还没看到发票,就先把提交退款的调用发出去了,参数只能瞎填。这里是演示桩所以没事,真系统里就是一条垃圾退款申请。工具一下子多了,模型「既然有就先调」的冲动也跟着来了(Day 184 全挂 60 个时也见过)。防法不在检索,而在写操作本身:参数校验要严格(发票号必须匹配格式),写操作最好要人工确认。

</details>

### 练习 3:两个检索器取并集

写一个 `search_union(query, k)`:embedding 前 k 个和 BM25 前 k 个合并去重。用 `eval_select.py` 的 `recall` 测 k=1、2、3,同时打印平均返回几个工具。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/eval_union.py  练习 3:BM25 前 3 和 embedding 前 3 取并集,召回率能不能更稳
from part03.eval_select import CASES, recall
from part03.tool_retrievers import search_bm25, search_embed, usage


def search_union(query: str, k: int) -> list[str]:
    out: list[str] = []
    for name in search_embed(query, k) + search_bm25(query, k):
        if name not in out:
            out.append(name)
    return out


for k in (1, 2, 3):
    r, misses = recall(search_union, k)
    print(f"union 各取 {k} 个: recall = {r:.2f},平均挂 {sum(len(search_union(q, k)) for q, _ in CASES) / len(CASES):.1f} 个,漏 {misses}")
print("embedding 用量", usage)
```

<div class="line-notes">

- `from part03.eval_select import CASES, recall` 复用题目和评测函数。导入 `eval_select` 时它的 `if __name__ == "__main__":` 部分不会执行,只拿到定义。
- `for name in search_embed(query, k) + search_bm25(query, k):` 两个列表用 `+` 拼起来,embedding 的结果排在前面。
- `if name not in out:` 去重,保留第一次出现的位置。
- `print(f"union 各取 {k} 个: recall = {r:.2f},平均挂 {sum(len(search_union(q, k)) for q, _ in CASES) / len(CASES):.1f} 个,漏 {misses}")` 并集的大小不固定,两边重合得多就小,所以要单独算平均挂了几个,才好和单个检索器的 k 比。

</div>

```bash
uv run python -m part03.eval_union
```

```text
union 各取 1 个: recall = 0.90,平均挂 1.4 个,漏 ['公司又来了三个同事,要加人', '发票上公司名字写错了', '导出报表一直失败']
union 各取 2 个: recall = 0.93,平均挂 3.1 个,漏 ['公司又来了三个同事,要加人', '发票上公司名字写错了']
union 各取 3 个: recall = 1.00,平均挂 4.8 个,漏 []
embedding 用量 {'calls': 30, 'tokens': 364}
```

各取 1 个时,平均只挂 1.4 个工具,召回率就到了 0.90,比 embedding 单独取 1 个(0.80)高,也比 BM25 单独取 5 个(0.77)高。两种检索器错的地方不一样,合起来互补。各取 3 个时平均挂 4.8 个、召回率 1.00,和 embedding 单独取 5 个差不多。这 30 题里 embedding 已经很强,并集的优势主要在「提交退款申请」这种字面完全重合、embedding 却分不开的查询上,正文那次漏检用并集就不会发生。更讲究的合并方法(RRF,按两边的排名打分)在第四部分讲混合检索时会学。

</details>

### 练习 4:读切词结果,解释 BM25 为什么漏(不花钱)

从 BM25 漏掉的 7 条里挑三条,用 `tokenize()` 打印查询和期望工具文档的切词结果,写出每条漏掉的原因。

<details><summary>参考答案</summary>

```bash
uv run python -c "
from part03.tool_retrievers import tokenize, DOCS, NAMES
pairs = [('user007 说 10 月被扣了两次钱', 'invoice_list'),
         ('信用卡过期了要换一张', 'billing_update_payment_method'),
         ('原来的管理员离职了,要换负责人', 'account_transfer_owner')]
for q, want in pairs:
    print(tokenize(q)); print('  ', tokenize(DOCS[NAMES.index(want)]))"
```

```text
['user007', '说', '10', '月', '被扣', '两次', '钱']
   ['invoice', 'list', '列出', '最近', '发票', '发票', '号', '金额', '状态', '开票', '日期', '查', '重复', '扣款', '先用', '它', 'customer', 'id', 'id']
['信用卡', '过期', '换', '一张']
   ['billing', 'update', 'payment', 'method', '生成', '更换', '绑定', '银行卡', '或', '支付宝', '链接', 'customer', 'id', 'id']
['原来', '管理员', '离职', '要换', '负责人']
   ['account', 'transfer', 'owner', '把', '账号', '所有者', '转给', '另', '一个', '成员', 'customer', 'id', 'id', 'new', 'owner', 'email', '新', '所有者', '邮箱']
```

三条的原因是同一类:**同义不同词**。「被扣」对「扣款」,「信用卡」「换」对「银行卡」「更换」,「管理员」「负责人」对「所有者」。查询和文档之间一个词都对不上,BM25 一分不得。

还能看出两个分词细节。第三条里「要换」被 jieba 切成了一个词,而第二条里是单独的「换」:同一个字在不同句子里切法不同,这也会让字面匹配更不稳定。另外「的」「了」都被停用词表过滤掉了,`的链接` 那里只剩下「链接」。

</details>

**验收标准**:练习 1 的轨迹里出现 `refund_submit` 被调用,并能说清三处改动里哪一处真正起了作用;练习 2 能说出整组加载多花了多少 token、带来了什么新问题;练习 3 有并集的召回率表;练习 4 写出三条漏检原因,有切词结果为证。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 工具检索(tool search / tool retrieval) | 不一次挂全部工具,而是根据当前要做的事从工具库里检索出最相关的几个再挂上 |
| 延迟加载(`defer_loading`) | Anthropic、OpenAI 的写法:工具定义照常发送,但先不进模型上下文,被搜到才展开 |
| `search_tools` | 我们自己写的「搜工具的工具」,模型用一句话描述需求,返回最像的 k 个工具 |
| 分词 | 把一句中文切成一个个词,中文没有空格,要靠 jieba 这类库。例:「导入银行流水」→ 导入 / 银行 / 流水 |
| 停用词 | 太常见、区分不了任何东西的词,比如「的」「了」,今天还加了「客户」,分词后直接丢掉 |
| BM25 | 一种按关键词打分的检索方法,词越稀有、出现越多分越高,只认字面。[Day 235](/blog/agent-zero/day-235-bm25/) 细讲 |
| embedding(嵌入向量) | 把一段话变成一串数字(bge-m3 是 1024 个),意思相近的话数字的方向也相近。[Day 212](/blog/agent-zero/day-212-why-vectors/) 起细讲 |
| 余弦相似度 | 比较两串数字方向有多接近,1 是同向,0 是无关。例:「被扣了两次钱」和 `invoice_list` 的描述相似度最高 |
| recall@k(前 k 召回率) | 检索返回前 k 个时,正确答案在里面的比例。30 题里 23 题命中就是 0.77 |
| 漏检(miss) | 该检索到的工具不在前 k 个里。在 Agent 里表现为「模型说没有这个功能」 |
| 并集检索 | 两个检索器各取前 k 个合并去重,利用它们错的地方不一样来互补 |

## 常见误区

**看到 jieba 的 `SyntaxWarning` 以为装坏了。** 那是 jieba 2020 年的老代码在 Python 3.12 下的警告,只在第一次导入时出现,不影响结果。真正要担心的是你自己代码里的警告。

**相信模型说的「我没有这个功能」。** 在按需挂工具的系统里,这句话大概率只是「这次没检索到」。今天 `refund_submit` 排第四被 k=3 截掉,模型就说没有提交退款的接口,回答合情合理,日志一切正常。

**以为 k 调大就万事大吉。** 今天 k=5 时,第一次搜索顺带捞上来一个 `refund_status`,模型以为退款工具就这一个,连搜都不搜了。要在搜索工具的描述里明确告诉它「没找到就换说法再搜」。

**改了工具描述,忘了重算向量。** embedding 向量是按描述原文算的,描述改了向量不会自己变。今天的缓存里连原文一起存,对不上就重算;我第一次没写这个判断,改了描述检索结果纹丝不动。

**以为改工具的 `description` 一定会影响检索。** 要看检索器是从哪里拿文本的。练习 1 改的是发给模型的 schema,检索器用的 `DOCS` 早在导入时就从 `SPECS` 拼好了,排名一点没变。

**只做离线 recall,不跑端到端。** 30 题 embedding 的 recall@3 是 1.00,可真跑任务时还是漏了 `refund_submit`,因为测试集里根本没有「提交退款申请」这种说法。两层评测都要有,端到端还要检查「该调用的工具有没有被调用」。

**工具一多就让模型随便调。** 练习 2 整组加载后,模型在还没查到发票时就并行调用了 `refund_submit`,参数填了 `placeholder`。写操作要有严格的参数校验和确认环节,不能指望检索替你挡。

## 学习资料

### 文档与文章

- [Claude 文档 · Tool search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool):今天读「How tool search works」「Deferred tool loading」「Custom tool search implementation」三节,对照我们的 `SearchableRegistry` 看哪一步是服务端替你做的。2026 年 10 月查,英文。
- [Claude Cookbook · Tool search with embeddings](https://platform.claude.com/cookbook/tool-use-tool-search-with-embeddings):官方用 embedding 做客户端工具检索的完整示例,和今天的做法几乎一样,只是返回 `tool_reference` 让 API 去展开,英文。
- [OpenAI 文档 · Tool search](https://developers.openai.com/api/docs/guides/tools-tool-search):看 namespace 的组织方式和 hosted / client 两种执行方式的区别,英文。
- [Claude Code 文档 · MCP](https://code.claude.com/docs/en/mcp):翻到「Scale with MCP tool search」一节,看 `ENABLE_TOOL_SEARCH` 的取值和「描述前 4,096 个字符参与搜索」那条,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oNv8BPE2m&autoplay=0&high_quality=1" title="15分钟弄懂Token和Embedding -- 详解LLM与RAG的数据处理机制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · 15 分钟弄懂 Token 和 Embedding · 今天把 embedding 当黑盒用,看这个视频的后半段,对「一句话变成一串数字、意思近的数字也近」有个直观印象就够了。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1XT421Q7fw&autoplay=0&high_quality=1" title="相关性03：文本匹配（TF-IDF、BM25、词距）" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ShusenWang · 相关性 03:文本匹配(TF-IDF、BM25、词距) · 王树森讲搜索相关性的系列课,BM25 那一段讲清楚了「稀有词分高」的来由。今天不用记公式,Day 235 会细讲。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/y7n1PZc8p9s" title="98% Token Savings: Claude's Tool Search &amp; Code Execution (2026)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Prompt Circle AI · 98% Token Savings: Claude's Tool Search &amp; Code Execution (2026) · 演示 Claude 的 Tool Search 怎么用,标题里的 98% 是 Anthropic 代码执行那篇文章的数字,Day 186 会讲。英文。</figcaption>
</figure>

### 书籍

- Christopher D. Manning、Prabhakar Raghavan、Hinrich Schütze《Introduction to Information Retrieval》(Cambridge University Press, 2008):信息检索的经典教材,第 6、11 章讲词项加权和概率模型(BM25 的来历)。作者在斯坦福的网站上提供免费在线版。今天不用读,Day 235 前可以翻。

### 开源项目与代码

- [dorianbrown/rank_bm25](https://github.com/dorianbrown/rank_bm25):今天用的 BM25 实现,源码就一个文件,`BM25Okapi.get_scores` 只有十来行,可以对照着看它怎么算分。
- [fxsjy/jieba](https://github.com/fxsjy/jieba):jieba 分词,README 里有自定义词典的用法。给业务词加词典要小心:查询和文档必须用同一套切法,不然反而会漏。

## 自测

1. Anthropic 的 `defer_loading` 和我们的 `SearchableRegistry` 有什么相同、有什么不同?

<details><summary>答案</summary>

相同:都是开局只让模型看到少数工具(搜索工具加几个常用的),模型搜到哪个再把哪个的完整定义给它;都是只追加不删除,尽量保住前缀缓存。不同:Anthropic 是你把全部工具定义都发过去,搜索在服务端执行,API 自动把 `tool_reference` 展开成定义;我们是全部在客户端做,检索器和已加载列表都在自己的代码里,下一步请求的 `tools` 里只有已加载的那些。

</details>

2. recall@3 = 0.77 是什么意思?为什么选工具时看 recall@k 而不只看第一名对不对?

<details><summary>答案</summary>

30 题里有 23 题,正确的工具出现在检索结果的前 3 个里。因为前 k 个会全部挂给模型,由模型自己挑,所以正确的工具只要在里面就行,不必排第一。代价是 k 越大挂的工具越多,要在召回率和 token 之间取舍。

</details>

3. 「公司又来了三个同事,要加人」BM25 找不到 `subscription_change_seats`,embedding 能找到。为什么?「提交退款申请」却是 BM25 排第一、embedding 排第四,又为什么?

<details><summary>答案</summary>

第一句和工具描述「增加或减少席位数量」字面上一个词都不重合,BM25 只认字面,得零分;embedding 比的是意思,「加人」和「增加席位」意思接近。第二句和 `refund_submit` 的描述字面完全一样,BM25 最擅长这种;而六个退款工具的描述都围绕「退款申请」,意思彼此都很近,embedding 分不开,`refund_submit` 被挤到了第四。两者错的地方不一样,所以取并集能互补。

</details>

4. 今天检索版的输入 token 只有全挂版的 23%,花费却更高(¥0.0114 对 ¥0.0071)。为什么?这说明工具检索什么时候才划算?

<details><summary>答案</summary>

两个原因:检索版多了两次搜索,输出 token 多了 150 个,而输出价是输入的四倍;全挂版的工具定义每步不变,几乎全部命中前缀缓存,检索版的工具列表每搜一次就变一次,缓存命中少。所以工具不多、每个定义也短时,检索可能不划算;工具多到定义占上下文 10% 以上,或者有几十上百个工具时,省下的输入和选择准确率的提升才会盖过这些开销。

</details>

5. 面试题:你给 Agent 做了工具检索,上线后发现有些工单 Agent 回复「系统暂不支持该操作」,但这个操作明明有工具。你会怎么排查和改进?

<details><summary>答案</summary>

先怀疑是漏检:翻这些工单的轨迹,看模型搜了什么、检索返回了什么、期望工具排第几;也看模型是不是根本没搜(以为已经看过全部)。然后分别处理:排名靠后被 k 截掉的,调大 k 或者和 BM25 取并集;说法和描述差太远的,在工具描述开头补上用户的常见说法并重算向量;模型没搜的,在搜索工具描述里写明「没找到就换说法再搜,别直接认为没有」;一组关系很紧的工具,考虑按组加载。最后把这些工单的原话加进离线 recall 测试集,端到端评测里加一项「该调用的工具有没有被调用」,防止以后回退。

</details>

## 明天预告

明天是 **Day 186 · 代码即动作(一):JSON 工具调用卡在哪,CodeAct 在说什么**。这两天解决的是「工具定义太多」;还有另一半问题是「工具结果太大」:一个工具返回 116 条订单,每一条都要穿过模型的上下文,还得靠模型心算求和。明天先用实跑看 JSON 工具调用在这种题上怎么又贵又算错,再看 CodeAct 的主意:让模型写一段代码来调工具,中间数据留在代码里,只把结果交回来。
