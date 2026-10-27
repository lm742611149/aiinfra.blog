---
title: 'Day 239 · Query 改写'
description: '用户的话常常没头没尾、口语、一句话两个问题,直接拿去检索效果差。今天让大模型在检索前先改写:补全省略、换成帮助中心的说法、拆开多个问题;定下两条规则(只改最新一句、寒暄原样返回),把改写做成多路查询,用 RRF 合并。实测 9 道题命中率 0.833 到 0.944,提升全来自一道题,每次多 0.63 秒、约 ¥0.0006。'
pubDate: 2026-10-27
regime: none
tags: ['rag', 'query-rewrite', 'multi-query', 'hyde', 'agent-zero']
series: 'agent-zero'
day: 239
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 238](/blog/agent-zero/day-238-rerank/) 写了 `part04/rerank.py` 和 `part04/rerank_search.py`:向量加 BM25 再加 RRF 粗筛出 20 块,用 cross-encoder 重排序模型精排。21 道题上 MRR 从 0.873 涨到 0.927,每次多 200 到 450 毫秒;rerank 分数还能把「该答」和「该拒」拉开(0.893 对 0.174)。

前面五天(Day 235 到 238)都在改进「拿到问题以后怎么找」,今天回头看问题本身。用户的话往往根本不适合直接去搜:「那要等多久」没头没尾,「我上周买的那个东西能退不」全是口语,「发票开错了,还有导入流水一直报错,怎么弄」一句话里塞了两个问题。再好的检索也救不了一句话本身没有信息。所以在检索之前加一步:让大模型把用户的话改写成适合搜索的样子。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清改写要做的三件事:补全省略的指代、换成帮助中心的说法、拆开一句话里的多个问题;写出 `part04/rewrite.py`,让模型输出 JSON,并在模型返回任何奇怪的东西时退回原问题。
2. 看到第一版 prompt 的两个真实毛病(把历史里聊过的话题又搜一遍、「好的谢谢」也被改成发票问题),并用两条规则修好:只改写最新一句,寒暄原样返回。
3. 写出 `part04/multi_query.py`:每条查询各走一遍混合检索,再用 RRF 合成一份;会判断要不要把用户原话也当作其中一路。
4. 在 9 道多轮、口语、一句多问的题上量出「直接搜、只搜改写、原话加改写」的命中率,并算出改写每次多花的时间和钱。

预计用时 3 小时:改写和 JSON 兜底 60 分钟,两条规则 30 分钟,多路查询和评测 60 分钟,代价和练习剩下的时间。前置:[Day 238](/blog/agent-zero/day-238-rerank/) 之前的全部检索代码,特别是 Day 236 练习 1 的 `part04/ex_hybrid.py`(`hybrid_search(conn, bm25, query, k, pool)` 返回 `[(块, 分数)]`)、`part04/fusion.py` 的 `rrf`、`common/llm.py` 的 `LLMClient`(`chat()` 返回带 `content / latency / cost` 的结果,`client.ledger` 是累计账本),以及 [Day 227](/blog/agent-zero/day-227-rag-prompt/) 里用过的 JSON 模式写法;库里要有 42 块。

今天要调大模型(`.env` 里的 DeepSeek,`LLM_MODEL=deepseek-flash`)和免费的 bge-m3 embedding。我的 `.env` 里 `LLM_PRICE=0.04,2,8`(每百万 token,缓存命中输入/未命中输入/输出,单位元),DeepSeek 官方价格页这次没抓到数字,价格以你自己查到的为准,下面的花费都是按这组价格算的。今天所有脚本(包括我反复跑的)加起来调了一百多次对话接口,总共不到 ¥0.15;每个脚本自己的花费在它的输出里。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `rewrite()` 的主体和 `multi_search()`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 用户的话为什么不能直接搜

先看三类典型的「不能直接搜」:

- **依赖上一轮的追问**:「那年付的呢?」「那要等多久」。单独拿出来,没有主语。
- **口语**:「我上周买的那个东西能退不」。帮助中心写的是「退款」,用户说的是「退」「要回钱」「拿回来」。Day 235 里 BM25 对这类就是一块都找不到。
- **一句话多个问题**:「发票开错了,还有导入流水一直报 E1043,怎么弄」。一个向量只能表示一个大致的意思,两个主题混在一起,两边都找得不准。

改写就是在检索前让大模型处理一下。常见的做法有三种,这个名字值得认一下:

**补全成独立问题**:结合对话历史,把「那年付的呢」改成「年付套餐能不能退款」。多轮对话的 RAG 几乎一定要做。**多路查询**(multi-query):让模型从不同角度生成几条查询,每条各检索一遍再合并,适合一句话多个问题,或者问题很模糊。**HyDE**(Hypothetical Document Embeddings,假想文档嵌入):先让模型「假装」写一段答案,用这段假答案去做向量检索,出自 2022 年的论文《Precise Zero-Shot Dense Retrieval without Relevance Labels》([arXiv 2212.10496](https://arxiv.org/abs/2212.10496))。今天主讲前两种,HyDE 放在练习 2 里实测一次。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="改写流程:用户问题加对话历史交给大模型改写成 1 到 3 条查询,用户原话也可以保留作为一路,每条查询各走混合检索,再用 RRF 合并成 top-k">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="40" width="110" height="40" rx="4" fill="none" stroke="var(--ink)"/>
<text x="75" y="64" fill="var(--ink)" text-anchor="middle">用户:那要等多久</text>
<rect x="20" y="100" width="110" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="75" y="124" fill="var(--ink)" text-anchor="middle">对话历史</text>
<rect x="160" y="60" width="110" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="215" y="86" fill="var(--ink)" text-anchor="middle">大模型改写</text>
<text x="215" y="104" fill="var(--ink-faint)" text-anchor="middle" font-size="11">两条规则 + 兜底</text>
<rect x="300" y="30" width="170" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="385" y="51" fill="var(--ink)" text-anchor="middle">路 1:原话(可选)</text>
<rect x="300" y="78" width="170" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="385" y="99" fill="var(--ink)" text-anchor="middle">路 2:429 要等多久</text>
<rect x="300" y="126" width="170" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="385" y="147" fill="var(--ink)" text-anchor="middle">路 3:(拆出的另一问)</text>
<rect x="500" y="62" width="120" height="70" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="560" y="88" fill="var(--ink)" text-anchor="middle">每路混合检索</text>
<text x="560" y="106" fill="var(--ink)" text-anchor="middle">再 RRF 合并</text>
<text x="560" y="122" fill="var(--ink-faint)" text-anchor="middle" font-size="11">top-k</text>
<line x1="130" y1="60" x2="160" y2="80" stroke="var(--ink-faint)"/>
<line x1="130" y1="120" x2="160" y2="100" stroke="var(--ink-faint)"/>
<line x1="270" y1="85" x2="300" y2="95" stroke="var(--ink-faint)"/>
<line x1="270" y1="100" x2="300" y2="143" stroke="var(--ink-faint)"/>
<line x1="75" y1="40" x2="75" y2="20" stroke="var(--ink-faint)"/>
<line x1="75" y1="20" x2="385" y2="20" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<line x1="385" y1="20" x2="385" y2="30" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<line x1="470" y1="47" x2="500" y2="80" stroke="var(--ink-faint)"/>
<line x1="470" y1="95" x2="500" y2="97" stroke="var(--ink-faint)"/>
<line x1="470" y1="143" x2="500" y2="115" stroke="var(--ink-faint)"/>
<text x="20" y="190" fill="var(--ink-soft)" font-size="11">虚线:用户原话直接当作一路,当保险。改写失败时只剩这一路。</text>
<text x="20" y="210" fill="var(--ink-soft)" font-size="11">蓝色是模型侧(要花钱、要时间),琥珀色是我们自己的检索代码。</text>
</g>
</svg>
<figcaption>改写不替换检索,只是在检索前多一步。每条查询各自完整地走一遍混合检索,最后用 Day 236 的 RRF 把几份名次合在一起。</figcaption>
</figure>

先直观看一次没头没尾的追问有多糟。新建 `part04/rewrite.py` 之前,我们先写好今天的第一个文件,再回来跑对比。

## 第一步:写 rewrite.py

改写要让模型做三件事,并且输出必须是程序能读的东西。输出格式用 JSON 模式(`response_format={"type": "json_object"}`),提示词里写明字段是 `queries`。第一版 prompt 我只写「补全、拆分、用帮助中心的说法」,故意不加任何限制,后面会看到它出的问题。新建 `part04/rewrite.py`:

```python
# agent-zero-lab/part04/rewrite.py
"""用大模型改写查询:补全上下文,拆成 1–3 个适合检索的短查询。出任何问题都退回原问题。"""
import json

from common.llm import LLMClient

# 第一版:只告诉模型「补全、拆分、用帮助中心的说法」,没有任何限制
PROMPT_V1 = """你负责把用户发给 CloudLedger 客服的话,改写成适合在帮助中心里检索的查询。
要求:
- 结合对话历史补全省略的信息(例如「那年付的呢」要补成完整问题)。
- 如果一句话里有多个问题,拆开,每个问题一条查询。
- 每条查询是简短的陈述或问题,使用帮助中心的说法(例如用「退款」而不是「把钱要回来」)。
- 最多 3 条。只输出 JSON:{"queries": ["...", "..."]}"""

# 第二版:加两条规则
PROMPT = PROMPT_V1.replace(
    "- 最多 3 条。",
    "- 只改写用户最新这句话问的内容。历史只用来补全省略和指代,历史里已经问过的问题不要再加进来。\n"
    "- 最新的话如果是寒暄、致谢这类不需要查资料的,原样返回这句话。\n- 最多 3 条。",
)

client = LLMClient()


def rewrite(question: str, history: list[dict] | None = None, prompt: str = PROMPT) -> list[str]:
    history_text = "\n".join(f'{m["role"]}: {m["content"]}' for m in (history or [])[-6:])
    user = f"对话历史:\n{history_text or '(无)'}\n\n用户最新的话:{question}"
    r = client.chat(
        [{"role": "system", "content": prompt}, {"role": "user", "content": user}],
        temperature=0,
        response_format={"type": "json_object"},
    )
    try:
        queries = json.loads(r.content).get("queries", [])
        return [q for q in queries if isinstance(q, str) and q.strip()][:3] or [question]
    except (json.JSONDecodeError, AttributeError):
        return [question]  # 改写失败就用原问题,检索不能因为改写挂掉


if __name__ == "__main__":
    print(rewrite("发票开错了,还有导入流水一直报 E1043,怎么弄"))
    history = [
        {"role": "user", "content": "月付的能退款吗"},
        {"role": "assistant", "content": "月付套餐不支持中途退款。"},
    ]
    print(rewrite("那年付的呢", history))
    print(client.ledger)
```

<div class="line-notes">

- `import json` 标准库,`json.loads` 把模型返回的 JSON 字符串变成 Python 字典,相当于 JS 的 `JSON.parse`。
- `PROMPT_V1 = """` 第一版 system 提示词,三条要求加一条输出格式。注意它没有告诉模型「历史只能用来补全」,也没说寒暄怎么办,模型会自己发挥,下面会看到后果。
- `PROMPT = PROMPT_V1.replace(` 第二版不是重写,而是把第一版里「最多 3 条」那一行替换成「两条新规则 + 最多 3 条」,所以两个版本只差这两条规则,对比才公平。`.replace(旧, 新)` 返回新字符串,原字符串不变。
- `client = LLMClient()` 模块级建一个客户端,`rewrite.py` 导入时读 `.env`。今天所有脚本共用这一个,`client.ledger` 会累计所有调用的花费。
- `def rewrite(question: str, history: list[dict] | None = None, prompt: str = PROMPT)` 三个参数:最新一句、对话历史(可选)、用哪版提示词(默认第二版)。把 `prompt` 做成参数,是为了后面能拿两版做对比。
- `history_text = "\n".join(` `(history or [])[-6:]` 没传历史就当空列表,只取最后 6 条(约三轮),太早的话和当前问题关系不大还费 token。每条变成 `user: 月付的能退款吗` 这样一行再拼起来。
- `user = f"对话历史:` 把历史和最新一句拼成一条 user 消息;历史是空时写「(无)」,让模型明确知道没有历史。
- `r = client.chat(` 调 Day 135 以来用的 `LLMClient.chat`,`r` 是 `ChatResult`,`r.content` 是模型回复的文字。
- `temperature=0` 让输出尽量稳定。注意是「尽量」:我同样的输入连跑几次,措辞偶尔还是会差一两个字,所以评测数字会有小波动。
- `response_format={"type": "json_object"}` JSON 模式,DeepSeek 和大部分 OpenAI 兼容服务支持。它保证返回的是合法 JSON,但不保证字段名对、不保证结构对,所以下面仍要防。
- `try:` 从这里到 `except` 是兜底区。下面三种情况都要能扛住。
- `queries = json.loads(r.content).get("queries", [])` 取 `queries` 字段,取不到就是空列表。如果模型返回的是 JSON 数组(不是对象),`.get` 会抛 `AttributeError`,所以 `except` 里不能只写 `JSONDecodeError`。
- `return [q for q in queries if isinstance(q, str) and q.strip()][:3] or [question]` 三层保护:只留是字符串且不是空白的项(防 `null` 和 `""`),`[:3]` 最多三条,`or [question]` 过滤完是空列表就退回原问题。
- `except (json.JSONDecodeError, AttributeError):` 两类异常:内容不是合法 JSON,或者 JSON 是数组、没有 `.get`。统统退回原问题。
- `return [question]  # 改写失败` 检索链路上的任何增强步骤失败了都应该降级,而不是让整个请求报错。用户最差也只是享受到「没改写」的待遇。
- `print(client.ledger)` 看这两次调用一共花了多少。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.rewrite
```

```text
['发票开错了怎么处理', '导入流水报错 E1043 怎么解决']
['年付套餐是否支持退款']
2 次调用 | 输入 436 / 输出 37 tokens | 约 ¥0.0012
```

第一句被拆成了两条,各自短而明确,而且错误码 E1043 原样保留;第二句借着历史补全成了「年付套餐是否支持退款」,并且换成了帮助中心的说法。两次调用共 473 个 token,约 ¥0.0012。

### 兜底到底在挡什么

`except` 和那一长串过滤不是凭空加的,每一条都对应模型真的可能给出的东西。不调接口,用一个假的 `chat` 替身,把模型可能返回的七种东西各喂一遍,看 `rewrite()` 怎么处理。新建 `part04/rewrite_failsafe.py`:

```python
# agent-zero-lab/part04/rewrite_failsafe.py
"""模型返回各种奇怪的东西时,rewrite() 会怎样。不调接口:用假的 chat 替身。"""
import json
from types import SimpleNamespace

from part04 import rewrite as rw

REPLIES = {
    "正常": '{"queries": ["年付套餐是否支持退款"]}',
    "不是 JSON": "好的,我来改写:年付套餐是否支持退款",
    "JSON 数组而不是对象": '["年付套餐是否支持退款"]',
    "queries 是空的": '{"queries": []}',
    "混了 null 和空串": '{"queries": [null, "", "  ", "年付退款"]}',
    "给了 5 条": '{"queries": ["a1", "a2", "a3", "a4", "a5"]}',
    "字段名写错": '{"query": ["年付退款"]}',
}
for label, reply in REPLIES.items():
    rw.client.chat = lambda messages, _r=reply, **kw: SimpleNamespace(content=_r)
    print(f"{label:<18} -> {rw.rewrite('那年付的呢')}")

# 没有兜底的版本会怎样:把 except 去掉,直接看真实报错
for label in ("不是 JSON", "JSON 数组而不是对象"):
    try:
        json.loads(REPLIES[label]).get("queries", [])
    except Exception as e:
        print(f"没兜底:{label} -> {type(e).__name__}: {e}")
```

<div class="line-notes">

- `from types import SimpleNamespace` 标准库里一个「随手造对象」的工具,`SimpleNamespace(content="x")` 得到一个有 `.content` 属性的对象,相当于 JS 里的 `{ content: "x" }`。真的 `ChatResult` 字段很多,`rewrite()` 只用到 `.content`,替身只要有这一个属性就行。
- `from part04 import rewrite as rw` 导入模块本身(而不是里面的函数),这样才能改它里面的 `client`。
- `REPLIES = {` 七种假回复,每种对应一个真实可能的故障:不是 JSON、是数组、空列表、混着 `null`、条数超限、字段名拼错。
- `rw.client.chat = lambda messages, _r=reply, **kw: SimpleNamespace(content=_r)` 把 `client.chat` 临时换成一个假函数,不管收到什么都返回当前这条假回复。`_r=reply` 是在 lambda 定义的这一刻就把 `reply` 的值固定下来;不写成默认参数的话,lambda 会在被调用时才去看 `reply`,而循环变量那时已经变了,是 Python 闭包里经典的坑。`**kw` 吃掉 `rewrite()` 传来的 `temperature` 和 `response_format`。
- `print(f"{label:<18} -> {rw.rewrite('那年付的呢')}")` 对每种假回复调一次真的 `rewrite()`,看它输出什么。
- `json.loads(REPLIES[label]).get("queries", [])` 把兜底的 `try/except` 拿掉,直接执行最核心的那一句,看没有保护时真实的报错是什么。

</div>

```bash
uv run python -m part04.rewrite_failsafe
```

```text
正常                 -> ['年付套餐是否支持退款']
不是 JSON            -> ['那年付的呢']
JSON 数组而不是对象       -> ['那年付的呢']
queries 是空的        -> ['那年付的呢']
混了 null 和空串        -> ['年付退款']
给了 5 条             -> ['a1', 'a2', 'a3']
字段名写错              -> ['那年付的呢']
没兜底:不是 JSON -> JSONDecodeError: Expecting value: line 1 column 1 (char 0)
没兜底:JSON 数组而不是对象 -> AttributeError: 'list' object has no attribute 'get'
```

七行里五种情况都退回了原问题(`['那年付的呢']`),「混了 null 和空串」只留下了有内容的那一条,「给了 5 条」砍到 3 条。最后两行是没有兜底时的真实报错:`JSONDecodeError`(模型不老实输出 JSON 时)和 `AttributeError: 'list' object has no attribute 'get'`(模型把对象写成数组时)。后一种如果只捕获 `JSONDecodeError` 就会漏掉,整个请求 500。这两种在 JSON 模式下都很少见,但检索链路每天跑几万次,少见也一定会遇到。

注意「字段名写错」那行:`{"query": [...]}` 是合法 JSON,但字段名不是 `queries`,`.get("queries", [])` 得到空列表,最后退回原问题。结果是对的(没崩),但这次改写其实白花了钱,模型的有效输出被丢掉了。线上如果看到「改写后和原话一模一样」的比例异常高,先查这里。

## 第二步:第一版 prompt 的两个毛病

下面用同一批输入对比两版 prompt。输入故意选了四种情况:单独一句没有历史、接着发票聊但换了话题、接着发票聊只是道谢、接着发票聊真的在追问。新建 `part04/rewrite_rules.py`:

```python
# agent-zero-lab/part04/rewrite_rules.py
"""两条规则有没有用:同样的输入,第一版 prompt 和第二版 prompt 各改写一次。"""
from part04.rewrite import PROMPT, PROMPT_V1, client, rewrite

HISTORY = [
    {"role": "user", "content": "发票开错了怎么办"},
    {"role": "assistant", "content": "发票开具后 30 天内可以申请红冲并重新开具,每张只能重开一次。"},
]
CASES = [
    ("单独一句,没有历史", "发票开错了,还有导入流水一直报 E1043,怎么弄", []),
    ("接着发票聊,换了话题", "你们有学生优惠吗", HISTORY),
    ("接着发票聊,只是道谢", "好的谢谢", HISTORY),
    ("接着发票聊,真的是追问", "那超过 30 天的呢", HISTORY),
]
for label, q, hist in CASES:
    print(f"[{label}] {q}")
    print("   第一版:", rewrite(q, hist, PROMPT_V1))
    print("   第二版:", rewrite(q, hist, PROMPT))
print(client.ledger)
```

<div class="line-notes">

- `from part04.rewrite import PROMPT, PROMPT_V1, client, rewrite` 两版提示词、同一个客户端、同一个函数,只换 `prompt` 参数,对比里唯一的变量就是那两条规则。
- `HISTORY = [` 一段关于发票重开的对话。后三个用例都接在它后面,用来检验「模型会不会被历史带偏」。
- `("接着发票聊,换了话题", "你们有学生优惠吗", HISTORY)` 用户突然换了话题,和发票没有任何关系。理想的改写只该有「学生优惠」。
- `("接着发票聊,只是道谢", "好的谢谢", HISTORY)` 不需要查任何资料的话,理想的改写是原样返回。
- `("接着发票聊,真的是追问", "那超过 30 天的呢", HISTORY)` 这一条是对照:真的需要历史才能补全,两条规则不应该把它改坏。
- `print("   第一版:", rewrite(q, hist, PROMPT_V1))` 同一个输入连调两次,第一版和第二版各一次。

</div>

```bash
uv run python -m part04.rewrite_rules
```

```text
[单独一句,没有历史] 发票开错了,还有导入流水一直报 E1043,怎么弄
   第一版: ['发票开错了怎么处理', '导入流水报错 E1043 怎么解决']
   第二版: ['发票开错了怎么处理', '导入流水报错 E1043 怎么解决']
[接着发票聊,换了话题] 你们有学生优惠吗
   第一版: ['发票开错如何申请红冲并重新开具', '发票重开次数限制', '学生优惠']
   第二版: ['学生优惠']
[接着发票聊,只是道谢] 好的谢谢
   第一版: ['发票开错如何申请红冲', '发票重新开具的条件和次数限制', '发票开具后多久可以申请红冲']
   第二版: ['好的谢谢']
[接着发票聊,真的是追问] 那超过 30 天的呢
   第一版: ['发票超过30天如何红冲重开', '发票开具超过30天能否重新开具']
   第二版: ['发票超过30天如何处理']
8 次调用 | 输入 1644 / 输出 165 tokens | 约 ¥0.0046
```

第一类没有历史的,两版一样,规则没有伤害它。第二类和第三类是第一版的毛病,而且很典型:用户问学生优惠,第一版给出三条,其中两条是**上一轮发票的话题**(红冲、重开次数),只有最后一条是真正的问题;用户只说一句「好的谢谢」,第一版输出了三条关于发票的查询,这一轮检索会把发票的块全拉出来,Day 227 的 prompt 又会逼模型据此回答,用户就会收到一段莫名其妙的发票说明。原因是第一版告诉模型「结合对话历史」,模型就尽职地把历史也「结合」进去了。

两条规则就是对症下药:

1. **只改写用户最新这句话问的内容,历史只用来补全省略和指代**。「学生优惠」那一行从三条变成一条。
2. **寒暄、致谢这类不需要查资料的话,原样返回**。「好的谢谢」原样返回,后面可以用一个很简单的判断(改写结果等于原话)决定要不要跳过检索。

第四类是对照:真正的追问,两版都补全了「30 天」和「发票」,第二版没有被规则伤害。

规则是我看了第一版的真实输出才加的,不是凭空想的。这是写这类 prompt 的通用办法:先用最简单的版本跑一批真实输入,看它在哪里出错,针对性地加规则,每加一条就把所有旧输入重跑一遍确认没有伤到别的。

## 第三步:改写以后,怎么搜

改写出来的是 1 到 3 条查询,怎么用?最直接的办法是:每条查询各自走一遍完整的混合检索(Day 236 练习 1 的 `hybrid_search`),得到几份名次,再用 `rrf` 合成一份。`rrf` 本来就是「几路合并」的,Day 236 说过它只认编号、不知道块是什么,今天用的是一个更大的「路」:一整条查询的结果。

还有一个要决定的事:**用户的原话要不要保留作为其中一路**。保留的好处是保险:改写万一把关键信息改丢了(比如把错误码改成了「编码错误」),原话那一路还在;坏处是原话本身如果没头没尾(比如「那要等多久」),这一路返回的全是噪声,会稀释好的结果。我把它做成参数。新建 `part04/multi_query.py`:

```python
# agent-zero-lab/part04/multi_query.py
"""多路查询:每条查询各走一遍混合检索,再用 RRF 把几份名次合成一份。"""
import psycopg

from part04.bm25_index import BM25Index
from part04.chunking import Chunk
from part04.ex_hybrid import hybrid_search
from part04.fusion import rrf
from part04.rewrite import rewrite


def multi_search(
    conn: psycopg.Connection, bm25: BM25Index, queries: list[str], k: int = 4, pool: int = 20
) -> list[tuple[Chunk, float]]:
    rankings: list[list[str]] = []
    by_id: dict[str, Chunk] = {}
    for q in queries:
        hits = hybrid_search(conn, bm25, q, k=pool, pool=pool)
        rankings.append([c.id for c, _ in hits])
        by_id.update({c.id: c for c, _ in hits})
    return [(by_id[cid], s) for cid, s in rrf(rankings)[:k]]


def search_with_rewrite(
    conn: psycopg.Connection, bm25: BM25Index, question: str, history: list[dict] | None = None,
    k: int = 4, keep_original: bool = True,
) -> tuple[list[str], list[tuple[Chunk, float]]]:
    """改写,再多路检索。keep_original=True 时把用户的原话也当作其中一路。返回 (实际用的查询, 结果)。"""
    queries = rewrite(question, history)
    if keep_original and question not in queries:
        queries = [question] + queries
    return queries, multi_search(conn, bm25, queries, k)
```

<div class="line-notes">

- `from part04.ex_hybrid import hybrid_search` Day 236 练习 1 写的 `hybrid_search(conn, bm25, query, k, pool)`:向量一路加 BM25 一路,两路各取前 `pool` 名,RRF 合并,返回前 `k` 块。今天的「一路查询」就是调它一次。
- `rankings: list[list[str]] = []` 每条查询的结果名次(只留编号)存成一个列表,最后是列表的列表,正好是 `rrf` 要的形状。
- `by_id: dict[str, Chunk] = {}` 编号到块的字典。`rrf` 只返回编号,融合完要用它换回块对象。每条查询的结果都往里并。
- `hits = hybrid_search(conn, bm25, q, k=pool, pool=pool)` 每条查询取到 `pool`(20)块而不是最终的 `k`(4)块,因为后面还要再融合一次,取得太少「共识」会很稀。这和 Day 236 说的「每路取 20 条左右,融合完再截到 k」是同一个道理。
- `by_id.update({c.id: c for c, _ in hits})` 字典推导式加 `update`,把这条查询的块并进总字典。
- `rrf(rankings)[:k]` 几条查询的名次合并后取前 `k`。如果同一块被多条查询都排得靠前,它的分数会叠加,这就是「多路认可更可信」。
- `queries = rewrite(question, history)` 先改写,得到 1 到 3 条。
- `if keep_original and question not in queries:` 保留原话,但如果改写出来的某条恰好和原话一样(比如「E1043 是什么错误」原样返回),就不用重复加一路。`[question] + queries` 把原话放在最前面。
- `return queries, multi_search(conn, bm25, queries, k)` 同时返回「实际用的查询」和结果,方便打印出来看改写得对不对。

</div>

先看没头没尾的追问,三种搜法各找到什么。新建 `part04/rewrite_demo.py`:

```python
# agent-zero-lab/part04/rewrite_demo.py
"""没头没尾的追问,直接搜和改写后再搜,各找到什么。"""
from part04.bm25_index import BM25Index
from part04.chunking import load_chunks
from part04.ex_hybrid import hybrid_search
from part04.multi_query import search_with_rewrite
from part04.pg_store import connect

HISTORY = [
    {"role": "user", "content": "接口返回 429 是什么意思"},
    {"role": "assistant", "content": "超过速率限制,错误码 E4029,请等待一分钟后重试。"},
]
Q = "那要等多久"
bm25 = BM25Index(load_chunks())
with connect() as conn:
    print("直接搜:", Q)
    for c, s in hybrid_search(conn, bm25, Q, k=4):
        print(f"   {s:.4f}  {c.id:<9}{c.title} > {c.section}")
    for keep in (True, False):
        queries, hits = search_with_rewrite(conn, bm25, Q, HISTORY, keep_original=keep)
        print(f"改写后搜(keep_original={keep}):", queries)
        for c, s in hits:
            print(f"   {s:.4f}  {c.id:<9}{c.title} > {c.section}")
```

<div class="line-notes">

- `HISTORY = [` 上一轮用户问 429,助手答了速率限制。接着的「那要等多久」只有放在这段历史后面才有意思。
- `Q = "那要等多久"` 没有主语的追问,单独搜等于在问「什么要等」。
- `bm25 = BM25Index(load_chunks())` BM25 一路在内存里建一次(Day 237 讲过它是启动时的快照)。
- `hybrid_search(conn, bm25, Q, k=4)` 不改写,直接搜。
- `for keep in (True, False):` 同一个问题,两种设置各跑一次:保留原话和不保留。
- `print(f"改写后搜(keep_original={keep}):", queries)` 把实际用的查询打印出来,保留原话时第一条是「那要等多久」。

</div>

```bash
uv run python -W ignore -m part04.rewrite_demo
```

```text
直接搜: 那要等多久
   0.0164  kb-002#4 退款政策 > 审批与到账
   0.0161  kb-006#2 发票类型与开具 > 怎么申请
   0.0159  kb-004#1 自动续费与扣款规则 > 什么时候扣款
   0.0156  kb-003#1 如何申请退款 > 操作步骤
改写后搜(keep_original=True): ['那要等多久', '接口返回 429 超过速率限制后需要等待多久才能重试']
   0.0318  kb-002#4 退款政策 > 审批与到账
   0.0315  kb-004#2 自动续费与扣款规则 > 扣款失败
   0.0309  kb-019#2 开放 API > 速率限制
   0.0301  kb-015#3 团队成员与权限 > 邀请成员
改写后搜(keep_original=False): ['接口返回 429 超过速率限制后需要等待多久才能重试']
   0.0164  kb-004#2 自动续费与扣款规则 > 扣款失败
   0.0161  kb-019#2 开放 API > 速率限制
   0.0159  kb-014#2 导出数据和报表 > 次数限制
   0.0156  kb-013#1 错误码 E3001:支付失败 > 原因
```

(模型每次的措辞会有一两个字的差别,我这几次跑出来的第三种结果里,`kb-019#2` 有时排第 1、有时排第 2,所以你的数字不会和我的完全一样。)

三种搜法差别很清楚。直接搜,前 4 名全是退款、发票、扣款的等待时间,没有一块讲速率限制,因为「等多久」在知识库里到处都有。改写之后,正确答案 `kb-019#2`(开放 API > 速率限制)进了前 4 名。保留原话时它排第 3,前面还有两块是原话那一路带来的噪声(`kb-002#4` 退款到账、`kb-015#3` 邀请链接),这两块之所以排得靠前,是因为原话「那要等多久」在向量里本来就偏向这类「等待」的块;不保留原话,噪声小得多,`kb-019#2` 排第 1 或第 2。

所以保留原话不是白拿的保险:原话越没信息,它带来的噪声越多。一个朴素的判断是:有对话历史、而且问题很短或者带指代词的(「那」「这个」),原话没有保留价值,不要保留;单轮的完整问题,原话是最好的信息源,保留。练习 3 会把这个规则做出来。

## 第四步:9 道题量一量

一两个例子说明不了问题。我写了 9 道题,覆盖这几类:三道依赖历史的追问、一道一句话两个问题、一道两个主题混着问、几道口语、两道单轮规范的问题当对照。每题标好「该命中哪几组块」(一题可能有多个目标组),命中率是「前 4 名里命中了几组」除以总组数。比三种做法:直接搜原话、只搜改写、原话加改写。新建 `part04/rewrite_eval.py`:

```python
# agent-zero-lab/part04/rewrite_eval.py
"""9 道多轮/口语/一句多问的题,每题标好「该命中哪几组块」。比三种做法:直接搜原话、只搜改写、原话加改写。"""
from part04.bm25_index import BM25Index
from part04.chunking import load_chunks
from part04.ex_hybrid import hybrid_search
from part04.multi_query import multi_search
from part04.pg_store import connect
from part04.rewrite import client, rewrite

H_REFUND = [{"role": "user", "content": "月付的能退款吗"}, {"role": "assistant", "content": "月付套餐不支持中途退款。"}]
H_TEAM = [{"role": "user", "content": "专业版最多几个人"}, {"role": "assistant", "content": "专业版最多 3 名成员。"}]
H_API = [{"role": "user", "content": "接口返回 429 是什么意思"}, {"role": "assistant", "content": "超过速率限制,错误码 E4029,请等待一分钟后重试。"}]

# (问题, 历史, [目标组, ...]):每个目标组里任意一块进了前 4 名,这一组就算命中
CASES: list[tuple[str, list[dict], list[set[str]]]] = [
    ("那年付的呢", H_REFUND, [{"kb-002#1"}]),
    ("那企业版呢", H_TEAM, [{"kb-015#2"}]),
    ("那要等多久", H_API, [{"kb-019#2"}]),
    ("发票开错了,还有导入流水一直报 E1043,怎么弄", [], [{"kb-007#1"}, {"kb-011#1", "kb-011#2"}]),
    ("旧手机号不用了,另外两步验证怎么开", [], [{"kb-016#2"}, {"kb-016#1"}]),
    ("我上周买的那个东西能退不", [], [{"kb-002#1", "kb-002#2", "kb-003#1"}]),
    ("钱扣了两次怎么搞", [], [{"kb-002#3"}]),
    ("我想把账本导出来,最多能导几次", [], [{"kb-014#2"}]),
    ("E1043 是什么错误", [], [{"kb-011#1", "kb-011#2"}]),
]


def score(ids: list[str], groups: list[set[str]]) -> float:
    return sum(bool(g & set(ids)) for g in groups) / len(groups)


def main() -> None:
    bm25 = BM25Index(load_chunks())
    totals = {"原话": 0.0, "只搜改写": 0.0, "原话+改写": 0.0}
    print(f"{'原话':>5}{'只改写':>7}{'原话+改写':>9}  问题  →  改写结果")
    with connect() as conn:
        for q, hist, groups in CASES:
            queries = rewrite(q, hist)
            raw = [c.id for c, _ in hybrid_search(conn, bm25, q, k=4)]
            only = [c.id for c, _ in multi_search(conn, bm25, queries, k=4)]
            both = [c.id for c, _ in multi_search(conn, bm25, [q] + [x for x in queries if x != q], k=4)]
            s = (score(raw, groups), score(only, groups), score(both, groups))
            for name, v in zip(totals, s):
                totals[name] += v
            print(f"{s[0]:>5.1f}{s[1]:>7.1f}{s[2]:>9.1f}  {q}  →  {queries}")
    n = len(CASES)
    print("平均命中率:", {k: round(v / n, 3) for k, v in totals.items()})
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `H_REFUND = [` 三段历史,分别对应「那年付的呢」「那企业版呢」「那要等多久」三个追问。每段只有一问一答。
- `CASES: list[tuple[str, list[dict], list[set[str]]]] = [` 每题三项:问题、历史、目标组列表。目标组是「一组可接受的块」,里面任意一块进前 4 名就算这一组命中。
- `("发票开错了,还有导入流水一直报 E1043,怎么弄", [], [{"kb-007#1"}, {"kb-011#1", "kb-011#2"}])` 一句话两个问题,所以有两个目标组:发票重开那一块、E1043 的两块之一。两组都命中才是 1.0,命中一组是 0.5。
- `def score(ids: list[str], groups: list[set[str]]) -> float:` `g & set(ids)` 是集合交集,不为空就是这一组命中,`bool(...)` 变成 True/False,`sum` 数出命中了几组,除以组数。
- `def main() -> None:` 把执行部分放进函数和 `if __name__ == "__main__":`,这样别的脚本(练习 2 和 3)`import` 这个文件的 `CASES` 和 `score` 时,不会把整个评测又跑一遍。我第一版没有这样写,练习脚本一导入就多花了一轮接口调用,发现后才改。
- `queries = rewrite(q, hist)` 每题只改写一次,三种做法共用这一次改写结果,这样三种做法对比时改写本身是同一份。
- `raw = [c.id for c, _ in hybrid_search(conn, bm25, q, k=4)]` 直接搜原话,不用历史,这是「不做改写」的现状。
- `only = [c.id for c, _ in multi_search(` 只用改写出的查询。
- `both = [c.id for c, _ in multi_search(` 原话加改写;`if x != q` 防止改写和原话一样时重复加一路。
- `for name, v in zip(totals, s):` `zip` 把字典的键(迭代字典得到键)和三个分数配对累加。

</div>

```bash
uv run python -W ignore -m part04.rewrite_eval
```

```text
   原话    只改写    原话+改写  问题  →  改写结果
  1.0    1.0      1.0  那年付的呢  →  ['年付套餐是否支持退款']
  1.0    1.0      1.0  那企业版呢  →  ['企业版最多几名成员']
  0.0    1.0      1.0  那要等多久  →  ['接口返回 429 超过速率限制后需要等待多久才能重试']
  0.5    0.5      0.5  发票开错了,还有导入流水一直报 E1043,怎么弄  →  ['发票开错了怎么处理', '导入流水报错 E1043 怎么解决']
  1.0    1.0      1.0  旧手机号不用了,另外两步验证怎么开  →  ['如何更换已停用的旧手机号', '如何开启两步验证']
  1.0    1.0      1.0  我上周买的那个东西能退不  →  ['购买的商品能否退款']
  1.0    1.0      1.0  钱扣了两次怎么搞  →  ['重复扣款如何处理', '扣款两次怎么退款']
  1.0    1.0      1.0  我想把账本导出来,最多能导几次  →  ['账本导出次数限制']
  1.0    1.0      1.0  E1043 是什么错误  →  ['E1043 错误']
平均命中率: {'原话': 0.833, '只搜改写': 0.944, '原话+改写': 0.944}
9 次调用 | 输入 1931 / 输出 145 tokens | 约 ¥0.0050
```

结论要老实说:平均命中率从 0.833 到 0.944,**提升全部来自一道题**,就是「那要等多久」(0.0 到 1.0),因为这是唯一一道原话信息不够、必须靠历史补全的题。另外 8 题,不改写直接搜就已经命中了,改写不但没有帮上忙,每题还多花一次模型调用。这和「那年付的呢」「那企业版呢」里「年付」「企业版」本身就是关键词,原话里已经带着足够的线索有关。你的题里如果追问更空(「那这个呢」「还有呢」),改写的收益会大得多。

「一句话两个问题」那一题,三种做法都是 0.5,改写没救回来。看细节(下一节练习 1 会跑):4 个名额分给两个子问题,每个子问题只分到两块,而「导入报错 E1043」的子查询顺带把 E1042、E2017 这些别的错误码块也拉了进来,把「发票重开」的那一块挤出了前 4。把 `k` 加到 5 就两个目标都进来了。**一句话拆成 N 个问题,最终取的块数要比 N 倍的每题需要量多。**

「E1043 是什么错误」被改成「E1043 错误」,错误码完好无损,原话和改写几乎一样。我专门多试了 7 句带错误码的问题,模型每次都把错误码原样留着,所以「改写会把错误码改丢」这个担心在这个模型上没有真的发生(练习 4 会写一个自动检查)。但这是我的观察,不是保证,换模型、换 prompt 都可能变,保留原话和做检查都是便宜的保险。

另外一个小细节:改写结果每次略有不同(「扣款两次怎么退款」我在另一次跑里看到的是「如何退款」),`temperature=0` 也不能让 DeepSeek 完全确定。所以别指望改写这一步的输出能逐字复现,评测数字有小浮动是正常的。

## 第五步:改写花多少钱、多少时间

改写是串在检索前面的一次大模型调用,每次提问都会多等它。量一下,新建 `part04/rewrite_cost.py`:

```python
# agent-zero-lab/part04/rewrite_cost.py
"""改写多花多少时间和钱:同一批题,逐条调一次 chat,记延迟和花费。"""
import statistics

from part04.rewrite import PROMPT, client
from part04.rewrite_eval import CASES

lat: list[float] = []
cost: list[float] = []
for q, hist, _ in CASES:
    h = "\n".join(f'{m["role"]}: {m["content"]}' for m in hist[-6:])
    r = client.chat(
        [{"role": "system", "content": PROMPT}, {"role": "user", "content": f"对话历史:\n{h or '(无)'}\n\n用户最新的话:{q}"}],
        temperature=0,
        response_format={"type": "json_object"},
    )
    lat.append(r.latency)
    cost.append(r.cost)
    print(f"{r.latency:.2f} 秒  输入 {r.prompt_tokens} 输出 {r.completion_tokens}  ¥{r.cost:.5f}  {q}")
print(f"延迟:中位数 {statistics.median(lat):.2f} 秒,最慢 {max(lat):.2f} 秒;每次平均 ¥{statistics.mean(cost):.5f}")
print(f"每天 1 万次提问都改写:{statistics.mean(cost) * 10000:.2f} 元")
```

<div class="line-notes">

- `import statistics` 标准库,`median` 取中位数,`mean` 取平均。
- `from part04.rewrite_eval import CASES` 复用上一节的 9 道题,正因为 `rewrite_eval` 有 `if __name__` 保护,这里导入不会重跑评测。
- `for q, hist, _ in CASES:` 第三项(目标组)用不上,用 `_` 接住。
- `r = client.chat(` 这里不调 `rewrite()`,而是直接调 `client.chat`,因为要拿到 `ChatResult` 里的 `latency`、`cost` 和 token 数,`rewrite()` 只返回查询列表,看不到这些。参数和 `rewrite()` 里的完全一样。
- `lat.append(r.latency)` `r.latency` 是这次调用的总耗时(秒)。
- `r.cost` `LLMClient` 用 `.env` 里的 `LLM_PRICE` 算出来的这次花费,单位是元。每次约输入 210 个 token、输出 10 到 25 个 token。
- `statistics.mean(cost) * 10000` 假设每天 1 万次提问都改写,总花费就是每次平均花费乘 1 万。

</div>

```bash
uv run python -W ignore -m part04.rewrite_cost
```

```text
0.69 秒  输入 221 输出 13  ¥0.00055  那年付的呢
0.63 秒  输入 222 输出 12  ¥0.00054  那企业版呢
0.73 秒  输入 232 输出 22  ¥0.00064  那要等多久
0.54 秒  输入 215 输出 24  ¥0.00062  发票开错了,还有导入流水一直报 E1043,怎么弄
0.55 秒  输入 211 输出 21  ¥0.00059  旧手机号不用了,另外两步验证怎么开
0.59 秒  输入 208 输出 11  ¥0.00050  我上周买的那个东西能退不
0.90 秒  输入 206 输出 18  ¥0.00056  钱扣了两次怎么搞
0.58 秒  输入 211 输出 12  ¥0.00052  我想把账本导出来,最多能导几次
0.77 秒  输入 205 输出 12  ¥0.00051  E1043 是什么错误
延迟:中位数 0.63 秒,最慢 0.90 秒;每次平均 ¥0.00056
每天 1 万次提问都改写:5.58 元
```

每次改写多 0.63 秒(中位数),花 ¥0.00056,算式是 (210 × 2 + 15 × 8) ÷ 1,000,000 ≈ 0.00054(输入按未命中价 2 元每百万、输出 8 元每百万,和 `.env` 的 `LLM_PRICE=0.04,2,8` 一致)。钱不是问题,一天 1 万次才 5.58 元;**时间才是**:0.63 秒加在每一次提问前面,再加上 Day 238 的 rerank 200 到 450 毫秒,检索阶段的耗时已经接近 1 秒,而大模型回答本身还要几秒。这就是为什么「单轮的完整问题先不改写,有历史或者带指代的才改写」是常见做法,练习 3 会实测这个策略能省多少。

## 动手练习

**练习 1:一句话两个问题,k 取多少才够?** 「发票开错了,还有导入流水一直报 E1043,怎么弄」有两个目标。把最终取块数 `k` 取 4、5、6、8,对比直接搜原话和多路改写,各命中几个目标,并看看改写的子查询在占用名额时带来了什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_w39_k.py
from part04.bm25_index import BM25Index
from part04.chunking import load_chunks
from part04.ex_hybrid import hybrid_search
from part04.multi_query import multi_search
from part04.pg_store import connect
from part04.rewrite import rewrite

Q = "发票开错了,还有导入流水一直报 E1043,怎么弄"
GROUPS = [{"kb-007#1"}, {"kb-011#1", "kb-011#2"}]  # 发票重开 / E1043
bm25 = BM25Index(load_chunks())
queries = rewrite(Q)
print("改写:", queries)
with connect() as conn:
    for k in (4, 5, 6, 8):
        raw = [c.id for c, _ in hybrid_search(conn, bm25, Q, k=k)]
        multi = [c.id for c, _ in multi_search(conn, bm25, queries, k=k)]
        hit = lambda ids: sum(bool(g & set(ids)) for g in GROUPS)
        print(f"k={k}  原话命中 {hit(raw)}/2 {raw}\n     改写命中 {hit(multi)}/2 {multi}")
```

<div class="line-notes">

- `GROUPS = [{"kb-007#1"}, {"kb-011#1", "kb-011#2"}]` 两个目标组:发票重开的块、E1043 的两块之一。
- `queries = rewrite(Q)` 只改写一次,后面 4 个 `k` 共用,不重复花钱。
- `for k in (4, 5, 6, 8):` 最终取多少块。`hybrid_search` 和 `multi_search` 的 `k` 含义一样,都是融合后截到前 k 块。
- `hit = lambda ids: sum(bool(g & set(ids)) for g in GROUPS)` 一行写个小函数:有几组目标被命中。lambda 相当于 JS 的箭头函数 `ids => ...`。
- `print(f"k={k}  原话命中` 里的 `\n` 换行,让原话和改写上下对齐。

</div>

```text
改写: ['发票开错了怎么处理', '导入流水报错 E1043 怎么解决']
k=4  原话命中 1/2 ['kb-007#1', 'kb-010#2', 'kb-010#1', 'kb-012#2']
     改写命中 1/2 ['kb-010#2', 'kb-012#2', 'kb-010#1', 'kb-011#2']
k=5  原话命中 2/2 ['kb-007#1', 'kb-010#2', 'kb-010#1', 'kb-012#2', 'kb-011#1']
     改写命中 2/2 ['kb-010#2', 'kb-012#2', 'kb-010#1', 'kb-011#2', 'kb-007#1']
k=6  原话命中 2/2 ['kb-007#1', 'kb-010#2', 'kb-010#1', 'kb-012#2', 'kb-011#1', 'kb-011#2']
     改写命中 2/2 ['kb-010#2', 'kb-012#2', 'kb-010#1', 'kb-011#2', 'kb-007#1', 'kb-012#1']
k=8  原话命中 2/2 ['kb-007#1', 'kb-010#2', 'kb-010#1', 'kb-012#2', 'kb-011#1', 'kb-011#2', 'kb-012#1', 'kb-009#2']
     改写命中 2/2 ['kb-010#2', 'kb-012#2', 'kb-010#1', 'kb-011#2', 'kb-007#1', 'kb-012#1', 'kb-013#2', 'kb-003#2']
```

读法:两种做法都是 `k=4` 命中 1/2,`k=5` 起命中 2/2,改写并没有比原话强。更值得看的是它占的名额:改写的 4 块里,有 3 块(`kb-010#2`、`kb-012#2`、`kb-010#1`)是别的错误码(E1042、E2017),因为子查询「导入流水报错 E1043 怎么解决」里的「导入」「报错」把所有错误码块都拉了出来,发票重开那块 `kb-007#1` 直到第 5 才出现。原话反而把 `kb-007#1` 排在第 1。这提醒我们:改写拆出来的子问题越宽泛,越容易吸来邻居;一句话拆成 N 个问题,最终的 `k` 要留够余量,不能还是 4 或 5。

</details>

**练习 2:HyDE,让模型先写一个假答案再搜。** 写 `hyde()`,让模型根据问题(和历史)写两三句话像帮助中心的答案,用这段假答案做向量检索。只比向量一路:原话、改写、HyDE,在上面 9 题上的命中率。顺便看看假答案里有没有模型瞎编的内容。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_w39_hyde.py
"""HyDE:先让模型写一段假答案,拿假答案去做向量检索。只比向量一路:原话 / 改写 / HyDE。"""
from common.embed import embed_one
from part04.pg_store import connect, search
from part04.rewrite import client, rewrite
from part04.rewrite_eval import CASES, score

HYDE_PROMPT = """你是云簿 CloudLedger 的客服。用户的问题和对话历史如下,请写一小段(两三句)像帮助中心文章的回答,
不确定的细节可以编,这段话只用来做检索,不会给用户看。只输出这段话。"""


def hyde(question: str, history: list[dict]) -> str:
    h = "\n".join(f'{m["role"]}: {m["content"]}' for m in history[-6:])
    r = client.chat(
        [{"role": "system", "content": HYDE_PROMPT}, {"role": "user", "content": f"对话历史:\n{h or '(无)'}\n\n用户问题:{question}"}],
        temperature=0,
    )
    return r.content.strip()


totals = [0.0, 0.0, 0.0]
with connect() as conn:
    for q, hist, groups in CASES:
        fake = hyde(q, hist)
        ids = [
            [c.id for c, _ in search(conn, embed_one(text), 4)]
            for text in (q, " ".join(rewrite(q, hist)), fake)
        ]
        s = [score(i, groups) for i in ids]
        totals = [a + b for a, b in zip(totals, s)]
        print(f"{s[0]:>4.1f}{s[1]:>6.1f}{s[2]:>6.1f}  {q}\n          假答案:{fake[:50]}…")
n = len(CASES)
print("向量一路平均命中率  原话 %.3f  改写 %.3f  HyDE %.3f" % tuple(t / n for t in totals))
print(client.ledger)
```

<div class="line-notes">

- `from part04.rewrite_eval import CASES, score` 复用 9 道题和打分函数。
- `HYDE_PROMPT = """` 让模型写一段「像帮助中心的答案」,并且明说「不确定的细节可以编」。HyDE 的原理就是假答案的措辞比问题更像文档,编造的细节不要紧,要紧的是措辞。
- `def hyde(question: str, history: list[dict]) -> str:` 不要求 JSON,直接要一段文字,所以没用 `response_format`。
- `return r.content.strip()` 去掉首尾空白,假答案整段拿去做 embedding。
- `for text in (q, " ".join(rewrite(q, hist)), fake)` 三种拿去做向量检索的文本:原话、改写结果(多条用空格连成一条,因为这里只做向量一路)、假答案。每种取前 4 名。
- `totals = [a + b for a, b in zip(totals, s)]` 两个列表逐位相加,累计每种方法的总分。
- `fake[:50]` 只打印假答案的前 50 个字,够看出它在编什么。

</div>

```text
 1.0   1.0   1.0  那年付的呢
          假答案:年付套餐支持在购买后7天内申请退款,超过7天则不支持中途退款。如需申请,请在云簿控制台的「账单与订阅…
 1.0   1.0   1.0  那企业版呢
          假答案:企业版支持最多 20 名成员,如需更多席位可联系我们升级至旗舰版。企业版还包含高级权限管理和专属客服…
 0.0   1.0   1.0  那要等多久
          假答案:遇到 429 速率限制错误(错误码 E4029)时,建议等待约 60 秒后再重试请求。若短时间内频繁…
 0.5   0.5   0.5  发票开错了,还有导入流水一直报 E1043,怎么弄
          假答案:发票开错可在「发票管理-已开发票」找到对应票据点「作废」或申请红冲后重开,跨月需走红冲流程。导入流…
 1.0   1.0   1.0  旧手机号不用了,另外两步验证怎么开
          假答案:更换手机号需登录云簿网页版,在「账户设置-安全中心-手机验证」中点击更换,通过原手机号或备用邮箱验证…
 1.0   1.0   1.0  我上周买的那个东西能退不
          假答案:您好,关于退货问题,云簿 CloudLedger 支持购买后 7 天内无理由退货,商品需保持完好、配…
 1.0   1.0   1.0  钱扣了两次怎么搞
          假答案:您好,关于重复扣款问题,请您先确认两笔扣款是否均为"已支付"状态,并记录两笔交易的订单号与扣款时间。…
 1.0   1.0   1.0  我想把账本导出来,最多能导几次
          假答案:账本导出次数没有限制,您可以随时在「账本管理」中选择导出为 Excel 或 CSV 格式。单次导出最…
 1.0   1.0   1.0  E1043 是什么错误
          假答案:E1043 是云簿 CloudLedger 的凭证借贷不平衡错误,通常出现在录入或导入记账凭证时,借…
向量一路平均命中率  原话 0.833  改写 0.944  HyDE 0.944
18 次调用 | 输入 2656 / 输出 717 tokens | 约 ¥0.0110
```

命中率上 HyDE 和改写打平(0.944),赢的还是那一道「那要等多久」。有意思的是假答案的内容:**几乎全是编的**。「年付 7 天内可退」「企业版最多 20 名成员」「E1043 是凭证借贷不平衡错误」,没有一条和我们的帮助中心对得上。HyDE 能奏效,靠的是假答案里的措辞(「429 速率限制」「重复扣款」「账本导出」)和真文档接近,编的数字不要紧,因为它只用来做检索,不给用户看。这也是它危险的地方:如果这段假答案不小心被当成资料送进了回答的 prompt,模型就会把编造的规则当成事实。成本方面,HyDE 要多生成几十个 token 的假答案(输出比改写长得多),这一轮 9 题的 18 次调用(9 次改写加 9 次假答案)约 ¥0.011。我的结论和旧课一样:知道原理就行,实际用得不多。

</details>

**练习 3:哪些问题可以不改写?** 写一个 `needs_rewrite(question, history)`:有历史、或者带指代词(「那」「这个」「它」「刚才」「上次」「上周」)、或者超过 15 个字,才改写;其余直接搜。对比「全部改写」和「按规则改写」的命中率和调用次数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_w39_skip.py
"""哪些问题不用改写:有历史、或者带指代词、或者很长的才改写,其余直接搜。比命中率和调用次数。"""
from part04.bm25_index import BM25Index
from part04.chunking import load_chunks
from part04.ex_hybrid import hybrid_search
from part04.multi_query import multi_search, search_with_rewrite
from part04.pg_store import connect
from part04.rewrite import client
from part04.rewrite_eval import CASES, score

REFERENCE_WORDS = ("那", "这个", "那个", "它", "刚才", "上次", "上周")


def needs_rewrite(question: str, history: list[dict]) -> bool:
    return bool(history) or len(question) > 15 or any(w in question for w in REFERENCE_WORDS)


bm25 = BM25Index(load_chunks())
always = smart = 0.0
with connect() as conn:
    for q, hist, groups in CASES:
        _, hits = search_with_rewrite(conn, bm25, q, hist)
        a = score([c.id for c, _ in hits], groups)
        calls_before = client.ledger.calls
        if needs_rewrite(q, hist):
            _, hits2 = search_with_rewrite(conn, bm25, q, hist)
        else:
            hits2 = hybrid_search(conn, bm25, q, k=4)
        s = score([c.id for c, _ in hits2], groups)
        always, smart = always + a, smart + s
        print(f"{'改写' if client.ledger.calls > calls_before else '直接搜'}  {a:.1f} -> {s:.1f}  {q}")
n = len(CASES)
print(f"全部改写 {always / n:.3f},按规则改写 {smart / n:.3f}")
print(client.ledger)
```

<div class="line-notes">

- `REFERENCE_WORDS = (` 指代词和时间词元组:这些词说明问题依赖上下文,单独拿出来信息不够。
- `return bool(history) or len(question) > 15` 三个条件任一成立就改写。`bool(history)` 空列表是 False、有内容是 True;`any(w in question for w in ...)` 问题里出现任何一个指代词。
- `_, hits = search_with_rewrite(conn, bm25, q, hist)` 第一遍:所有题都改写,作为基准。`_` 接住不需要的「实际用的查询」。
- `calls_before = client.ledger.calls` 记下此刻累计的调用次数,这一题调完再看有没有增加,用来判断它到底改写了没有。
- `if needs_rewrite(q, hist):` 按规则决定:要改写走 `search_with_rewrite`,不要就直接 `hybrid_search`。
- `always, smart = always + a, smart + s` 同时累加两种做法的分数。
- `'改写' if client.ledger.calls > calls_before else '直接搜'` 调用次数增加了就说明这一题改写了。

</div>

```text
改写  1.0 -> 1.0  那年付的呢
改写  1.0 -> 1.0  那企业版呢
改写  1.0 -> 1.0  那要等多久
改写  0.5 -> 0.5  发票开错了,还有导入流水一直报 E1043,怎么弄
改写  1.0 -> 1.0  旧手机号不用了,另外两步验证怎么开
改写  1.0 -> 1.0  我上周买的那个东西能退不
直接搜  1.0 -> 1.0  钱扣了两次怎么搞
直接搜  1.0 -> 1.0  我想把账本导出来,最多能导几次
直接搜  1.0 -> 1.0  E1043 是什么错误
全部改写 0.944,按规则改写 0.944
15 次调用 | 输入 3240 / 输出 248 tokens | 约 ¥0.0085
```

9 题里 3 题(「钱扣了两次」「账本导出」「E1043」)被规则判定为不用改写,命中率完全没变,改写的模型调用从 9 次降到 6 次,省了三分之一。(账本那题 15 个字,正好不超过 15,所以直接搜。)这个规则很粗,只是示范:真正的系统要拿真实问题的日志去调,看哪类问题改写有收益。例如以后统计「改写结果和原话几乎一样」的比例,高的话说明大部分题没必要改写。

</details>

**练习 4(开放题):自动检查改写有没有把错误码改丢。** 写一个 `safe_rewrite`:原话里出现的每个 `E` 开头四位数字的错误码,必须出现在改写结果里;缺了就退回原话。先用假的改写结果测检查逻辑,再用真的模型跑几句带错误码的话。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_w39_codes.py
"""改写不能把错误码改丢:检查改写结果里是不是保留了原话里每个 E 开头的错误码,丢了就退回原话。"""
import re

from part04.rewrite import rewrite

CODE = re.compile(r"[Ee]\d{4}")


def safe_rewrite(question: str, history: list[dict] | None = None) -> list[str]:
    queries = rewrite(question, history)
    wanted = {c.upper() for c in CODE.findall(question)}
    kept = {c.upper() for q in queries for c in CODE.findall(q)}
    return queries if wanted <= kept else [question]


# 1. 用假的改写结果测检查逻辑
for fake in (["导入时报错 E2017 是什么原因"], ["发票识别失败是什么原因"], []):
    wanted = {c.upper() for c in CODE.findall("导入时报 E2017")}
    kept = {c.upper() for q in fake for c in CODE.findall(q)}
    print(f"{fake!s:<30} 保留了错误码:{wanted <= kept}")

# 2. 用真的模型跑几句带错误码的话
for q in ["导入时报 E2017", "提示 e4029 怎么办", "E1042 啥意思", "老是弹出 E3001,还有发票开错了"]:
    print(q, "->", safe_rewrite(q))
```

<div class="line-notes">

- `CODE = re.compile(r"[Ee]\d{4}")` 正则:一个 `E` 或 `e`,后面跟 4 个数字(`\d{4}`)。`r"..."` 是原始字符串,反斜杠不用写两遍。`findall` 会返回所有匹配,比如 `"报 E2017 和 e4029"` 得到 `['E2017', 'e4029']`。
- `wanted = {c.upper() for c in CODE.findall(question)}` 原话里的错误码,统一转大写放进集合(用户可能写小写 `e4029`)。
- `kept = {c.upper() for q in queries for c in CODE.findall(q)}` 所有改写结果里出现的错误码,双层循环:先每条查询,再每个匹配。
- `return queries if wanted <= kept else [question]` `<=` 在集合上是「子集」:原话里的错误码是不是全在改写结果里。是就用改写,不是就退回原话。原话里没有错误码时 `wanted` 是空集,空集是任何集合的子集,所以直接放行。
- `print(f"{fake!s:<30} 保留了错误码:{wanted <= kept}")` `!s` 先把列表转成字符串再左对齐 30 格,没有它列表不支持 `:<30` 这种格式。

</div>

```text
['导入时报错 E2017 是什么原因']          保留了错误码:True
['发票识别失败是什么原因']                保留了错误码:False
[]                             保留了错误码:False
导入时报 E2017 -> ['导入报错 E2017 是什么原因', '导入报错 E2017 如何解决']
提示 e4029 怎么办 -> ['提示 e4029 怎么办']
E1042 啥意思 -> ['E1042 错误代码是什么意思']
老是弹出 E3001,还有发票开错了 -> ['E3001 错误提示', '发票开错如何处理']
```

假的三种里,第一种保留了,第二种(把 E2017 改成「发票识别失败」)和第三种(空列表)都被检出。真模型跑的四句,错误码都保留了,检查一次都没触发。这是常见的「保险」:平时用不上,但它的成本只是几行正则。注意它只防得住「有明确格式的字符串」(错误码、订单号、型号),防不住语义上的偏差。

</details>

验收标准:`rewrite.py` 能跑出文中那两行结果(措辞允许有一两个字不同);`rewrite_failsafe.py` 七种假回复都不崩;`rewrite_rules.py` 里第二版的「学生优惠」只剩一条、「好的谢谢」原样返回;`rewrite_eval.py` 命中率三种做法在 0.8 到 1.0 之间且「那要等多久」那题原话是 0.0 而改写后是 1.0;你能说出为什么提升全来自一题。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 查询改写(query rewriting) | 检索之前,先让大模型把用户的话改成更适合搜索的样子:补全省略、换成知识库里的说法、拆开多个问题 |
| 多路查询(multi-query) | 把一句话改写成几条查询,每条各走一遍检索,再把几份名次合并。今天合并用的是 RRF |
| HyDE | 让模型先「假装」写一段答案,拿假答案去做向量检索。靠的是假答案的措辞更像文档,编造的细节不影响检索,但不能把它当资料给用户 |
| 指代词 | 「那」「这个」「它」「刚才」这类要靠上下文才知道指什么的词,单独一句话里没有信息 |
| 降级(fallback) | 某个增强步骤出错时,退回到不用它的做法,让整条链路仍然能走完。今天是「改写失败就用原话」 |
| JSON 模式 | `response_format={"type": "json_object"}`,让模型保证输出合法 JSON。不保证字段名和结构对,所以还要自己校验 |
| 闭包默认参数 | 在 `lambda` 里写成 `_r=reply` 把当前值固定下来,防止循环里的变量在 lambda 被调用时已经变了。今天的假 `chat` 用到了 |

## 常见误区

**以为改写一定会更好。** 今天 9 题里 8 题不改写就已经命中,改写只救回了一题,每次还要多花 0.63 秒。有明显收益的是追问、全是指代的口语;单轮的完整问题别急着改写。

**让模型「结合历史」,却不说只能改最新一句。** 第一版 prompt 把上一轮发票的话题又搜了一遍,用户说「好的谢谢」也被改成三条发票问题。加两条规则:只改最新一句,寒暄原样返回。

**兜底只接 `JSONDecodeError`。** 模型把对象写成数组时抛的是 `AttributeError: 'list' object has no attribute 'get'`,漏接就是一次 500。

**改写失败时悄悄白花钱。** 字段名写错、`queries` 为空,兜底会让请求照常走完,但那次调用其实白花了。线上要统计「改写和原话完全一样」的比例。

**一律保留原话。** 原话没头没尾时(「那要等多久」),它那一路返回的全是噪声,把正确答案从第 1 名挤到第 3 名。有历史的追问不要保留,完整的单轮问题要保留。

**一句话拆成多个问题,最终的 k 不够。** 4 个名额分给两个子问题,每个只有两块,宽泛的子查询还会拉进邻居,把真正的答案挤出去。`k` 要按子问题数留余量。

**把 HyDE 的假答案当资料。** 它是模型编的:「E1043 是凭证借贷不平衡错误」「企业版最多 20 名成员」都不对。只拿来检索,绝不能放进回答用的 prompt。

**以为 `temperature=0` 输出就逐字相同。** DeepSeek 同样的输入,改写措辞偶尔会差一两个字。评测数字有小浮动是正常的,不要为一道题的升降调 prompt。

## 学习资料

### 文档与文章

- [Query Rewriting for Retrieval-Augmented Large Language Models](https://arxiv.org/abs/2305.14283)(arXiv 2305.14283):把「改写」当成一个可以训练的环节来研究的论文,摘要说明了为什么要在检索前改写问题,读摘要和引言就够。
- [Precise Zero-Shot Dense Retrieval without Relevance Labels](https://arxiv.org/abs/2212.10496)(arXiv 2212.10496):HyDE 的原始论文,看摘要和方法图,对照练习 2 里的 `hyde()`。
- [LlamaIndex · Query Transformations](https://docs.llamaindex.ai/en/stable/optimizing/advanced_retrieval/query_transformations/):讲 HyDE 和多步查询分解的文档,有可以对照的示例代码。
- [LangChain · MultiQueryRetriever](https://python.langchain.com/docs/how_to/MultiQueryRetriever/):多路查询的现成实现,它让模型生成几条不同角度的查询,各自检索后合并结果,可以和今天自己写的 `multi_search` 对照。
- [DeepSeek · JSON Output](https://api-docs.deepseek.com/guides/json_mode):JSON 模式的官方说明,看它对 prompt 里要不要出现「json」字样的要求,以及可能返回空内容的提醒。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1iHHL6fEbd&autoplay=0&high_quality=1" title="RAG Query Rewriting 5种常用查询改写策略" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI罐装知识 · RAG Query Rewriting 5种常用查询改写策略 · 约 3 分钟,把今天讲的补全、多路、HyDE 和另外两种策略放在一起看一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZXNgzsENk&autoplay=0&high_quality=1" title="面试官问:你的 RAG 系统是怎么进行 Query 改写的?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大模型-阿水 · 面试官问:你的 RAG 系统是怎么进行 Query 改写的? · 约 5 分钟,面试怎么答这一题,看完对照今天的两条规则和多路查询,想想自己能不能补一句「我量过收益和延迟」。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/feiXQdMjk5o" title="RAG Query Transformation — Multi-Query, HyDE, and Step-Back Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>StackOps AI · RAG Query Transformation — Multi-Query, HyDE, and Step-Back Explained · 英文,标题里的三种查询变换:多路、HyDE 和 Step-Back,前两个就是今天的内容。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):检索和 RAG 那一章里讲到对查询做改写、补全上下文的做法,和对话历史怎么处理放在一起,适合读完今天后看一遍。

### 开源项目与代码

- [langchain-ai/langchain](https://github.com/langchain-ai/langchain):`MultiQueryRetriever` 的源码就在 retrievers 目录下,不长,可以读它的 prompt 怎么写、结果怎么去重合并,和今天的 `multi_search` 对照。
- [run-llama/llama_index](https://github.com/run-llama/llama_index):`HyDEQueryTransform` 的实现,读它怎么把假答案和原问题一起送进检索。

## 自测

**1. 查询改写要解决的三类问题是什么?各举一个例子。**

<details><summary>答案</summary>

依赖上下文的追问(「那年付的呢」,单独没有主语);口语和知识库用词不一致(「我上周买的那个东西能退不」,知识库写的是「退款」);一句话多个问题(「发票开错了,还有导入流水一直报 E1043」,一个向量表示不好两个主题)。对应的做法分别是补全成独立问题、换成知识库的说法、拆成多条查询。

</details>

**2. 第一版 prompt 为什么会把「好的谢谢」改成三条发票查询?怎么修?**

<details><summary>答案</summary>

因为提示词只说「结合对话历史补全」,没说历史只能用来补全。模型很尽责,把历史里聊过的发票话题也一起「结合」进了每次改写,连寒暄也不放过。修法是加两条规则:只改写最新这句话问的内容、历史里已经问过的不要再加;最新的话如果是寒暄致谢这类不需要查资料的,原样返回。每加一条就把旧输入重跑一遍,确认没有伤到「真正需要历史」的追问。

</details>

**3. `rewrite()` 的 `except` 为什么要同时接 `JSONDecodeError` 和 `AttributeError`?**

<details><summary>答案</summary>

模型可能返回不是合法 JSON 的文字(`JSONDecodeError`),也可能返回合法 JSON 但是数组而不是对象,数组没有 `.get`(`AttributeError: 'list' object has no attribute 'get'`)。JSON 模式只保证第一种基本不出现,不保证结构。两种都要兜住并退回原问题,因为检索链路上的增强步骤出错时应该降级而不是让整个请求失败。

</details>

**4. 多路查询里,用户的原话要不要保留作为其中一路?**

<details><summary>答案</summary>

看情况。保留是保险:改写如果把关键信息(错误码、型号)改丢了,原话那一路还在。代价是原话如果没头没尾(「那要等多久」),这一路返回的都是噪声,会稀释甚至挤掉正确答案(今天实测把 `kb-019#2` 从第 1 或第 2 名挤到第 3 名)。常见做法是:单轮完整问题保留原话;有历史的追问、问题很短或带指代词的不保留。

</details>

**5. 面试题:你给 RAG 系统加了查询改写,线上效果怎么评估?怎么判断值不值?**

<details><summary>答案</summary>

先准备一个包含多轮追问、口语、一句多问和单轮规范问题的评估集,标好正确块。对比三种做法:不改写、只搜改写、原话加改写,看命中率或 MRR,并且把每道题的变好和变差列出来,不只看平均数(今天的例子里提升全来自一道题)。同时量成本和延迟:每次多一次大模型调用,今天实测多 0.63 秒、约 ¥0.0006。再统计线上「改写结果和原话几乎一样」的比例和改写失败(降级)的比例,前者高说明很多问题没必要改写,可以加规则跳过;后者高说明 prompt 或 JSON 格式有问题。上线时保留开关,出问题可以关掉直接搜原话。

</details>

**6. HyDE 和普通改写的核心区别是什么?它有什么风险?**

<details><summary>答案</summary>

普通改写把用户的话换成更适合检索的**问题**;HyDE 让模型写一段假的**答案**,拿答案去检索,依据是答案的措辞比问题更接近文档。风险是假答案是模型编的(今天实测它把 E1043 编成「凭证借贷不平衡错误」),只能用来检索,绝不能作为资料放进回答用的 prompt,否则模型会把编造的内容当事实。另外它要多生成一段文字,延迟和成本都比普通改写高。

</details>

## 明天预告

明天是 [Day 240 · 串成一条流水线,四种模式对比](/blog/agent-zero/day-240-retrieval-pipeline/)。这一周和今天写了六样东西:向量检索、BM25、RRF、rerank、改写、多路查询。明天把它们串成一条 `retrieve.py`,开关可以单独打开关闭,在同一批题上比 vector、bm25、hybrid、hybrid 加 rerank 四种模式的命中率、延迟和花费,做出一张对比表。
