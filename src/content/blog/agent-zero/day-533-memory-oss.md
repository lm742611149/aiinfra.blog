---
title: 'Day 533 · 记忆系统(二):四个开源方案对比'
description: '昨天把记忆拆成了四类、四个设计问题。今天用这把尺子去量四个现成方案:mem0、Letta、Zep/Graphiti、LangGraph store。每家写一个二三十行的最小脚本亲手跑一遍,看清它们在「谁来写」和「冲突了听谁的」上各自怎么选,最后给 SupportPilot 选型。'
pubDate: 2026-10-22
regime: none
tags: ['memory', 'mem0', 'letta', 'zep', 'langgraph', 'agent-zero']
series: 'agent-zero'
day: 533
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 532](/blog/agent-zero/day-532-memory-taxonomy/) 把「Agent 要有记忆」这句空话拆开了:按 CoALA 的说法分成工作记忆、情景记忆、语义记忆、程序记忆四类,又列出设计记忆系统必须回答的几个问题:什么时候写、写什么、谁来写、冲突了听谁的,最后补了一个最容易被忘的「怎么忘」。

问题列出来了,下一步自然是看看别人怎么答。市面上做 Agent 记忆的开源项目很多,今天挑最常被拿来比较的四个,用昨天那几个问题当尺子挨个量一遍。量完你就知道,明天给 SupportPilot 自己写客户记忆的时候,哪些设计可以抄,哪些坑别人已经踩过。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清 mem0、Letta、Zep/Graphiti、LangGraph store 在「谁来写」「冲突了听谁的」这两个问题上各自的答案,每家用一句话讲出来。
2. 亲手跑通四个最小脚本:用 mem0 真的写入和检索一次、用工具调用模拟 Letta 的核心记忆、用二十行 Python 模拟 Graphiti 的「带时间的事实」、用 LangGraph 的 `InMemoryStore` 按命名空间存取。
3. 给一个具体场景(SupportPilot 的客户记忆)选型,并说出理由。

预计用时 2.5 小时。前置:[Day 532](/blog/agent-zero/day-532-memory-taxonomy/)(四类记忆、四个设计问题)、[Day 158](/blog/agent-zero/day-158-fc-first-run/)(第一次跑通工具调用)、[Day 148](/blog/agent-zero/day-148-structured-2/)(JSON mode)、[Day 217](/blog/agent-zero/day-217-embed-service/)(embedding 服务和 embed 函数)、[Day 316](/blog/agent-zero/day-316-lg-checkpointer/)(LangGraph 的 checkpointer)。

今天只引入两个新概念,其余都是把学过的东西重新组合。第一个是**两根轴**:任何记忆方案都可以放在「谁来写」和「冲突怎么处理」这两根轴上定位;第二个是**带时间的事实**:一条事实除了值,还有「从哪天开始成立、到哪天失效」。四个方案本身不算新概念,它们是这两根轴上的四个点。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`temporal_facts.py` 的 `add_fact` 和 `as_of`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先立两根轴

四个方案的文档加起来几百页,每家都说自己记得准、记得快。一页一页读下去很容易被带着走,所以先立一把尺子,再拿着尺子去看。

第一根轴是**谁来写**。昨天说过三种:Agent 自己在对话中途调工具写;一个独立的抽取流程在对话结束后读完整段对话再写;业务系统直接写。站在前端的角度类比一下:Agent 自己写,像组件在 `onClick` 里直接 `setState`,随手就改,灵活但到处都可能改;抽取流程写,像所有修改都走一个 reducer,集中、可测;业务系统写,像服务端返回的数据,前端只读不改。

第二根轴是**冲突了怎么办**。同一件事有了新说法,常见的做法有四种:新的直接覆盖旧的;让模型判断是新增、改写还是删除;旧的不动、新的也存,读的时候再挑;旧的标记成「某天起失效」,保留完整时间线。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="两根轴:横轴是谁来写,纵轴是冲突怎么处理,四个方案各占一个位置">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <line x1="120" y1="250" x2="610" y2="250" stroke="var(--ink-soft)"/>
    <line x1="120" y1="250" x2="120" y2="20" stroke="var(--ink-soft)"/>
    <text x="365" y="285" text-anchor="middle" fill="var(--ink)">谁来写</text>
    <text x="200" y="268" text-anchor="middle" fill="var(--ink-soft)">Agent 自己</text>
    <text x="365" y="268" text-anchor="middle" fill="var(--ink-soft)">抽取流程</text>
    <text x="530" y="268" text-anchor="middle" fill="var(--ink-soft)">你自己的代码</text>
    <text x="20" y="40" fill="var(--ink-soft)">保留时间线</text>
    <text x="20" y="100" fill="var(--ink-soft)">只追加,读时挑</text>
    <text x="20" y="160" fill="var(--ink-soft)">模型判断改写</text>
    <text x="20" y="220" fill="var(--ink-soft)">直接覆盖</text>
    <rect x="140" y="140" width="120" height="36" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="200" y="157" text-anchor="middle" fill="var(--ink)">Letta</text>
    <text x="200" y="170" text-anchor="middle" fill="var(--ink-faint)" font-size="10">模型调工具改记忆块</text>
    <rect x="305" y="80" width="120" height="36" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="365" y="97" text-anchor="middle" fill="var(--ink)">mem0(新版)</text>
    <text x="365" y="110" text-anchor="middle" fill="var(--ink-faint)" font-size="10">2026-04 起只追加</text>
    <rect x="305" y="140" width="120" height="36" rx="5" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/>
    <text x="365" y="157" text-anchor="middle" fill="var(--ink-faint)">mem0(论文版)</text>
    <text x="365" y="170" text-anchor="middle" fill="var(--ink-faint)" font-size="10">ADD/UPDATE/DELETE</text>
    <rect x="305" y="22" width="120" height="36" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="365" y="39" text-anchor="middle" fill="var(--ink)">Zep / Graphiti</text>
    <text x="365" y="52" text-anchor="middle" fill="var(--ink-faint)" font-size="10">旧事实标记失效</text>
    <rect x="470" y="160" width="120" height="76" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="530" y="186" text-anchor="middle" fill="var(--ink)">LangGraph store</text>
    <text x="530" y="202" text-anchor="middle" fill="var(--ink-faint)" font-size="10">put 同 key 就覆盖</text>
    <text x="530" y="218" text-anchor="middle" fill="var(--ink-faint)" font-size="10">其余规则你自己写</text>
  </g>
</svg>
<figcaption>四个方案在两根轴上的位置。蓝色两家的写入靠模型判断,琥珀色两家的冲突规则是确定性的。虚线框是 mem0 论文里的老做法,新版已经换了。</figcaption>
</figure>

图先放在这里,下面每看一家,就回来对一下它为什么在这个位置。

## mem0:抽取流程来写

### 它的思路

mem0 的定位是「给 AI 应用加一层记忆」。你把对话丢给它的 `add`,它在内部调一次模型,从对话里抽出值得记的事实,算好 embedding 存进向量库;下次用 `search` 按语义查回来。写入是一个独立的流程,Agent 本身不用操心「要不要记」,所以在第一根轴上它站在「抽取流程」那一格。

第二根轴上它换过位置。2025 年的 mem0 论文里,抽取出来的每条候选事实都要和库里相似的旧记忆比一下,让模型从四个操作里选一个:ADD(新增)、UPDATE(改写某条旧的)、DELETE(删掉某条旧的)、NOOP(什么都不做)。昨天讲「冲突了听谁的」时提到过这个做法。

我在 2026 年 10 月查 PyPI 上的 `mem0ai` 页面,最新版是 2.2.1(2026-09-25 发布),页面上写着 2026 年 4 月起换了新算法:**一次调用、只追加**(single-pass ADD-only),不再 UPDATE 也不再 DELETE,记忆只会越攒越多,冲突交给检索阶段:检索时同时跑语义、BM25 关键词和实体匹配三路再融合,还加了时间推理,让「问现在」的时候排到最新的那条。

两种做法各有道理。让模型决定改写和删除,库里干净,但模型判断错一次,正确的旧记忆就被改没了,而且没有痕迹。只追加,什么都不丢,可以事后审计,代价是检索要足够聪明,不然新旧两条会同时被捞出来,让下游的模型自己去猜哪条对。

### 先用十几行看一眼论文版的四个操作

论文版的思路很好模拟:把旧记忆和新事实一起交给模型,让它输出 JSON 选一个操作。用到的只有 [Day 148](/blog/agent-zero/day-148-structured-2/) 学的 JSON mode。在 `agent-zero-lab/` 下新建 `part10/update_ops.py`:

```python
# agent-zero-lab/part10/update_ops.py
import json
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))

memories = {"m1": "客户是年付专业版", "m2": "客户只接受邮件联系"}
PROMPT = """已有记忆:{mem}
新事实:{fact}
对比后只选一个操作:ADD(新增)、UPDATE(改写某条)、DELETE(删掉某条)、NOOP(不变)。
只输出 JSON:{{"op": "...", "id": "要改或删的记忆 id,没有就写 null", "text": "新的记忆文字"}}"""


def decide(fact: str) -> dict:
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"], temperature=0, extra_body=EXTRA,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": PROMPT.format(mem=json.dumps(memories, ensure_ascii=False), fact=fact)}])
    return json.loads(resp.choices[0].message.content or "{}")


for fact in ["客户已降级为月付基础版", "客户说别打电话,发邮件就行", "客户的公司在杭州"]:
    print(fact, "->", decide(fact))
```

<div class="line-notes">

- `load_dotenv()` 读 `agent-zero-lab/.env`。我的配置是 `LLM_BASE_URL=https://api.deepseek.com`、`LLM_MODEL=deepseek-flash`,这几个变量从第二部分起一直在用。
- `EXTRA = json.loads(` `LLM_EXTRA_BODY` 是 `{"thinking": {"type": "disabled"}}`,关掉 DeepSeek 的思考模式,省 token 也省时间。
- `memories = {"m1": "客户是年付专业版"` 假装库里已经有两条记忆,用 dict 存,key 是记忆 id。相当于 JS 里的 `{ m1: "...", m2: "..." }`。
- `PROMPT = """已有记忆:{mem}` 三引号是多行字符串,相当于 JS 的反引号模板,但这里不是 f-string,`{mem}` 和 `{fact}` 要等下面 `.format()` 时才填进去。
- `只输出 JSON:{{"op"` 两个花括号 `{{` 是转义,`.format()` 之后变成一个 `{`。不转义的话 Python 会把 `{"op"...}` 当成一个要填的占位符,直接报 `KeyError`。
- `response_format={"type": "json_object"},` JSON mode,保证返回的是合法 JSON(但不保证字段齐全,Day 148 讲过)。
- `fact=fact)}])` 把两条旧记忆转成 JSON 字符串塞进提示词。`ensure_ascii=False` 让中文原样输出,不然会变成 `客` 这种转义,模型也能读,但浪费 token。
- `return json.loads(resp.choices[0].message.content or "{}")` `content` 的类型是 `str | None`,`or "{}"` 兜底,同时让类型检查器不画红线。
- `for fact in [` 三条新事实,分别对应改写、重复、全新三种情况。

</div>

```bash
cd agent-zero-lab
uv run python part10/update_ops.py
```

我跑出来是这样(2026-10-22):

```text
客户已降级为月付基础版 -> {'op': 'UPDATE', 'id': 'm1', 'text': '客户是月付基础版'}
客户说别打电话,发邮件就行 -> {'op': 'NOOP', 'id': None, 'text': ''}
客户的公司在杭州 -> {'op': 'ADD', 'id': None, 'text': '客户的公司在杭州'}
```

三条都判对了。但请注意第一条:模型说 UPDATE m1,如果你真去执行,「年付专业版」这个旧值就从库里消失了。万一这句「降级了」是客户记错了呢?业务系统里他其实还是年付,库里已经没有任何证据能让你发现这件事。这就是 mem0 后来改成只追加的一个原因。

### 再用真的 mem0 跑一遍

现在用真的 `mem0ai` 包,模型用 DeepSeek,embedding 用 [Day 217](/blog/agent-zero/day-217-embed-service/) 配好的硅基流动 bge-m3,向量库用 mem0 默认支持的 Qdrant 本地文件模式(不用起服务,数据存在一个目录里)。

```bash
cd agent-zero-lab
uv add mem0ai==2.2.1
```

这一步会装上 `qdrant-client`、`sqlalchemy`、`posthog` 等一串依赖,我这里 `.venv` 从 45MB 涨到 132MB。国内网络下载 PyPI 文件超时的话,先确认代理开着(我第一次装就是 `files.pythonhosted.org` 连接超时)。

新建 `part10/mem0_demo.py`:

```python
# agent-zero-lab/part10/mem0_demo.py
import os

from dotenv import load_dotenv
from mem0 import Memory

load_dotenv()
config = {
    "llm": {"provider": "deepseek", "config": {
        "model": os.environ["LLM_MODEL"], "api_key": os.environ["LLM_API_KEY"],
        "deepseek_base_url": os.environ["LLM_BASE_URL"], "temperature": 0}},
    "embedder": {"provider": "openai", "config": {
        "model": os.environ["EMB_MODEL"], "api_key": os.environ["EMB_API_KEY"],
        "openai_base_url": os.environ["EMB_BASE_URL"]}},
    "vector_store": {"provider": "qdrant", "config": {
        "collection_name": "c007", "path": "part10/qdrant_data", "embedding_model_dims": 1024}},
}
m = Memory.from_config(config)
uid = "cloudledger:C007"
r1 = m.add([{"role": "user", "content": "我是年付专业版,上个月被重复扣了 468 元。以后联系我请发邮件,别打电话。"}], user_id=uid)
print("第一次 add:", [(x["event"], x["memory"]) for x in r1["results"]])
r2 = m.add([{"role": "user", "content": "对了,我前天已经降级成月付基础版了。"}], user_id=uid)
print("第二次 add:", [(x["event"], x["memory"]) for x in r2["results"]])
hits = m.search(query="这个客户现在是什么套餐?", filters={"user_id": uid}, top_k=3)
for h in hits["results"]:
    print(round(h["score"], 3), h["memory"])
print("总共存了", len(m.get_all(filters={"user_id": uid})["results"]), "条")
```

<div class="line-notes">

- `from mem0 import Memory` 包名叫 `mem0ai`,导入时叫 `mem0`,这和 npm 里包名和导入名不一样的情况类似(比如装 `@types/node` 却不用导入它)。
- `"llm": {"provider": "deepseek", "config": {` mem0 内置了 deepseek 这个 provider,`deepseek_base_url` 填 `https://api.deepseek.com`。`temperature: 0` 让抽取尽量稳定,但下面你会看到它并不能保证两次结果完全一样。
- `"embedder": {"provider": "openai", "config": {` 硅基流动走的是 OpenAI 兼容协议,所以 provider 写 `openai`,再用 `openai_base_url` 指到 `https://api.siliconflow.cn/v1`,模型是 `BAAI/bge-m3`。
- `"openai_base_url": os.environ["EMB_BASE_URL"]}},` 这里**故意没写** `embedding_dims`。写了会报错,下面专门演示。
- `"collection_name": "c007", "path": "part10/qdrant_data", "embedding_model_dims": 1024}},` Qdrant 本地模式,数据落在 `part10/qdrant_data/` 目录。bge-m3 的向量是 1024 维,向量库这边必须写对,不然建出来的集合是默认的 1536 维,一写就报维度不匹配。
- `m = Memory.from_config(config)` 按配置组装出一个记忆对象。
- `uid = "cloudledger:C007"` mem0 用 `user_id` 隔离不同用户。SupportPilot 是多租户的,我把租户和客户拼在一起当 id,防止两家公司都有一个 C007 时串号。
- `r1 = m.add([{"role": "user"` `add` 收的就是一段 messages,格式和调模型时一样。这一句里有三件事:套餐、扣款、联系方式。
- `print("第一次 add:", [(x["event"], x["memory"])` 返回值里每条记忆都带 `event`,新算法下只会是 `ADD`。
- `r2 = m.add(` 第二段对话说套餐变了。按论文版的做法这里应该出一个 UPDATE。
- `hits = m.search(query="这个客户现在是什么套餐?", filters={"user_id": uid}, top_k=3)` 语义检索,按 user_id 过滤,取前 3 条。
- `print(round(h["score"], 3), h["memory"])` score 是相似度,越大越靠前。
- `print("总共存了", len(m.get_all(` `get_all` 列出这个用户名下全部记忆。

</div>

先看如果在 embedder 里也写了 `"embedding_dims": 1024` 会怎样(我第一次就是这么写的,觉得维度两边都写上更保险):

```text
openai.BadRequestError: Error code: 400 - {'code': 20015, 'message': 'The parameter is invalid. Please check again.', 'data': None}
```

报错来自硅基流动,不是 mem0。我翻了 mem0 的源码 `mem0/embeddings/openai.py`,里面写得很清楚:只要你在 embedder 配置里设了 `embedding_dims`,它就会把 `dimensions` 参数发给接口;OpenAI 的 `text-embedding-3` 系列支持这个参数(可以把向量截短),bge-m3 不支持,于是 400。源码注释里原话是「non-matryoshka OpenAI-compatible backends reject the parameter」。删掉那一项就好,维度只在 `vector_store` 里写。

删掉以后运行:

```bash
uv run python part10/mem0_demo.py
```

输出前面会有几行 mem0 的提示,大意是没装 spaCy、没装 fastembed,所以 BM25 关键词检索被关掉了;还有一行 PostHog 的提示(mem0 默认会发匿名使用统计,设环境变量 `MEM0_TELEMETRY=false` 可以关)。正文是这样:

```text
第一次 add: [('ADD', 'User is on the annual Professional plan and was double-charged 468 yuan in the previous month (around September 2026), and is raising the duplicate billing issue.'), ('ADD', 'User prefers to be contacted by email rather than by phone and explicitly asked not to be called.')]
第二次 add: [('ADD', 'User downgraded from the annual Professional plan to the monthly Basic plan around October 20, 2026 (two days before October 22, 2026).')]
0.6 User is on the annual Professional plan and was double-charged 468 yuan in the previous month (around September 2026), and is raising the duplicate billing issue.
0.546 User downgraded from the annual Professional plan to the monthly Basic plan around October 20, 2026 (two days before October 22, 2026).
0.518 User prefers to be contacted by email rather than by phone and explicitly asked not to be called.
总共存了 3 条
```

这几行值得一句一句看。

第一,**全是 ADD**。第二段对话明明是在改套餐,mem0 也没有去动第一条,只是新加了一条「降级了」。只追加,PyPI 页面上说的就是这个。

第二,**问「现在是什么套餐」,排第一的是旧的那条**(0.6 对 0.546)。旧记忆里「annual Professional plan」和问题里的「套餐」语义更近,于是排在前面。官方说的「时间推理」「多路融合」在我这个配置下没有起到作用,一是因为 BM25 和实体链接要额外装 `mem0ai[nlp]`、`mem0ai[extras]`,我没装;二是 PyPI 页面自己也说了,公布的分数来自托管平台,含开源版没有的专有优化,开源用户只能期待「方向一致」。

第三,**记忆被改写成了英文,还自动换算了日期**。「上个月」被写成「around September 2026」,「前天」被写成「around October 20, 2026」。好处是日后读起来不依赖对话当天的语境;坏处是它替你做了一次推断,推断错了你很难发现。

第四,**两次运行结果不一样**。我在同一天跑过两次,第一次第一段对话被拆成了三条(套餐、扣款、联系方式各一条),一共存了 4 条;第二次合成了两条,一共 3 条。`temperature: 0` 也没能让抽取完全稳定。

成本也算一下。我用一个小补丁统计了 mem0 内部的模型调用:两次 `add` 一共调了 2 次模型,输入 16056 个 token,输出 596 个。mem0 的抽取提示词很长,一次 add 平均八千个输入 token。按 DeepSeek 价格页(2026-10 查,`deepseek-flash` 高峰时段缓存未命中输入 ¥2/百万、输出 ¥8/百万)算:16056 × 2 ÷ 1,000,000 + 596 × 8 ÷ 1,000,000 ≈ ¥0.037。一次两句话的对话就要三四分钱,放到每天几万张工单上,这个数要认真算。

### mem0 的位置

回到那张图。第一根轴:抽取流程写,Agent 不操心。第二根轴:新版只追加、读时挑。它的优点是接入真的快,三行代码就有了记忆;缺点是写什么、怎么合并、怎么排序都在它的提示词和算法里,你能改的地方不多。客服场景里「业务系统的数据优先」「卡号永远不记」这些规则,要么在调 `add` 之前自己过滤,要么在 `search` 之后自己再筛一遍。

## Letta:Agent 自己来写

### 它的思路

Letta 的前身是 2023 年的 MemGPT 论文。论文的类比很好记:把上下文窗口当成电脑的内存,外部数据库当成硬盘,模型像操作系统一样,自己决定什么留在内存、什么换出到硬盘。具体做法是在系统提示词里放几块「核心记忆」(memory blocks),比如一块记用户、一块记 Agent 自己的人设,并给模型几个编辑这些块的工具。模型在对话里觉得哪条信息变了,就自己调工具去改。

所以在第一根轴上它站在「Agent 自己」那一格,第二根轴上它站在「模型判断改写」那一格:改不改、怎么改,全看模型这一轮的判断。

仓库也要提一句,网上很多教程会因此跑不通。我 2026 年 10 月看 `letta-ai/letta` 的 README,写的是当前源码已经搬到 `letta-ai/letta-code`(里面是 Agent harness、终端界面、App Server),原来的 V1 API 服务退役后放在 archive 分支。Python 客户端 `letta-client` 最新是 1.12.1(2026-06 发布)。按 2024 年的教程 `pip install letta` 再 `letta server`,大概率对不上现在的代码。

### 用工具调用模拟一个核心记忆块

起 Letta 的服务今天没必要,它的核心机制用 [Day 158](/blog/agent-zero/day-158-fc-first-run/) 学的工具调用二十几行就能模拟出来。新建 `part10/letta_style.py`:

```python
# agent-zero-lab/part10/letta_style.py
import json
import os

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionFunctionToolParam

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))

core = {"customer": "C007,年付专业版,只接受邮件联系"}  # 核心记忆块:每轮都原样放进系统提示词

TOOLS: list[ChatCompletionFunctionToolParam] = [{"type": "function", "function": {
    "name": "core_memory_replace",
    "description": "把核心记忆块 customer 里的一段旧文字替换成新文字。客户信息变了就调用。",
    "parameters": {"type": "object", "properties": {
        "old": {"type": "string"}, "new": {"type": "string"}}, "required": ["old", "new"]}}}]


def chat(user_text: str) -> None:
    system = f"你是 CloudLedger 客服。<customer>{core['customer']}</customer>"
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"], temperature=0, tools=TOOLS, extra_body=EXTRA,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user_text}])
    msg = resp.choices[0].message
    for call in msg.tool_calls or []:
        if call.type != "function":
            continue
        args = json.loads(call.function.arguments)
        core["customer"] = core["customer"].replace(args["old"], args["new"])
        print("模型调用了工具:", args)
    if resp.usage:
        print("token:", resp.usage.prompt_tokens, "+", resp.usage.completion_tokens)


chat("我前天已经降级成月付基础版了。")
print("核心记忆块现在是:", core["customer"])
chat("今天天气真好。")
print("核心记忆块现在是:", core["customer"])
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletionFunctionToolParam` 只为类型标注导入。不标的话 basedpyright 会说 `list[dict]` 不能传给 `tools`,Zed 里画红线;代码照样能跑。
- `core = {"customer": "C007,年付专业版,只接受邮件联系"}` 这就是「核心记忆块」。真实的 Letta 里一个块有名字、有字数上限、有描述,这里只用一个字符串。
- `TOOLS: list[ChatCompletionFunctionToolParam] = [{"type": "function", "function": {` 只给模型一个工具。工具定义的写法是 Day 157 的 JSON Schema。
- `"name": "core_memory_replace",` 名字照抄 MemGPT 论文里的同名工具,意思是「替换核心记忆里的一段」。
- `"description": "把核心记忆块 customer` description 是写给模型看的「什么时候该调我」,这一句决定了模型会不会主动去改记忆。
- `system = f"你是 CloudLedger 客服。<customer>{core['customer']}</customer>"` 每一轮都把记忆块原样拼进系统提示词。这一点很关键:模型「记得」,靠的就是每次都把这段文字重新塞给它。
- `model=os.environ["LLM_MODEL"], temperature=0, tools=TOOLS, extra_body=EXTRA,` 带上工具,其他参数和平时一样。
- `for call in msg.tool_calls or []:` 模型可能不调工具,这时 `tool_calls` 是 None,`or []` 让循环直接跳过。相当于 JS 的 `for (const call of msg.tool_calls ?? [])`。
- `if call.type != "function":` openai 新版 SDK 里工具调用分 function 和 custom 两种,只有 function 才有 `.function` 属性。这一行同时也是给类型检查器看的。
- `args = json.loads(call.function.arguments)` 第一轮拿到的是 `{'old': '年付专业版', 'new': '月付基础版'}`。
- `core["customer"] = core["customer"].replace(args["old"], args["new"])` 执行工具:字符串替换。真实系统这里要校验 `old` 确实存在,不然模型编一段不存在的旧文字,替换会静默失败。
- `if resp.usage:` usage 类型上可能是 None,先判断再读。
- `chat("今天天气真好。")` 第二轮故意说一句不该记的话,看模型会不会乱改。

</div>

```bash
uv run python part10/letta_style.py
```

```text
模型调用了工具: {'old': '年付专业版', 'new': '月付基础版'}
token: 327 + 61
核心记忆块现在是: C007,月付基础版,只接受邮件联系
token: 319 + 89
核心记忆块现在是: C007,月付基础版,只接受邮件联系
```

第一轮模型自己发现套餐变了,自己调工具改掉了;第二轮闲聊,它没有动记忆,只是正常回了一句话(那 89 个输出 token 就是回复)。两轮加起来 646 个输入、150 个输出,约 ¥0.0025。

看起来很聪明,问题也正好出在这里:**改记忆这件事和回答客户混在同一次调用里**。模型一边要想怎么回复,一边要判断这句话值不值得记、记成什么样。我这两句判断都对,但你很难给它写评测,因为「该不该改」的标准藏在模型脑子里;改错了也没有历史,`replace` 一执行旧值就没了。还有一个和 mem0 论文版一样的问题:客户说「降级了」,模型就信了,它不知道业务系统里的真实状态。

### Letta 的位置

第一根轴:Agent 自己写。第二根轴:模型判断改写,不留历史。适合个人助理、陪伴型这类「记忆就是产品本身」的 Agent,用户希望它越聊越懂自己,记错了用户自己会纠正。不适合有钱进出的客服:谁改了客户的套餐信息、为什么改的,出了事要能查。

## Zep 和 Graphiti:带时间的事实

### 它的思路

Zep 是一家做 Agent 记忆的公司,它的核心引擎 Graphiti 是开源的。这里要先交代一下现状:Zep 早期有一个可以自部署的社区版,后来官方宣布不再维护社区版,开源的力气全放到 Graphiti 上,托管服务叫 Zep Cloud。所以 2026 年你想自己部署,装的是 `graphiti-core`(我查到 0.31.2,2026-10-20 发布);用托管服务,装的是 `zep-cloud`(4.0.1)。

Graphiti 把记忆存成一张**知识图谱**:点是实体(客户 C007、套餐「年付专业版」),边是关系(C007 订阅了年付专业版)。今天要学的第二个新概念就在边上:**每条边带两个时间**,`valid_at` 表示这件事从哪天开始成立,`invalid_at` 表示从哪天开始不成立。新事实进来,如果和旧事实冲突,旧边不删除,只把它的 `invalid_at` 填上。

用前端熟悉的东西类比:这有点像 git。你改了一行代码,旧版本没有消失,`git log` 能看到它在哪个提交之前是什么样。Graphiti 对每条事实都做了这件事,所以它能回答「9 月扣款那天这个客户是什么套餐」这种带时间的问题。在第二根轴上,它站在最上面那一格:保留时间线。第一根轴上它和 mem0 一样,是抽取流程在写,从对话里抽实体和关系、判断冲突的也是模型。

### 二十行模拟「带时间的事实」

Graphiti 跑起来要一个图数据库(Neo4j、FalkorDB 等,本地一般用 Docker 起),本机没有 Docker,这次我没实跑真的 Graphiti。但「带时间的边」这个机制本身不依赖图数据库,用 [Day 50](/blog/agent-zero/day-050-dataclass/) 学的 dataclass 二十行就能写出来。新建 `part10/temporal_facts.py`:

```python
# agent-zero-lab/part10/temporal_facts.py
from dataclasses import dataclass
from datetime import date


@dataclass
class Edge:  # 图里的一条边:主语 -关系-> 宾语,外加两个时间
    subject: str
    relation: str
    obj: str
    valid_at: date
    invalid_at: date | None = None


edges: list[Edge] = []


def add_fact(subject: str, relation: str, obj: str, valid_at: date) -> None:
    for e in edges:  # 同一主语同一关系的旧事实,让它在新事实开始那天失效
        if e.subject == subject and e.relation == relation and e.invalid_at is None:
            e.invalid_at = valid_at
    edges.append(Edge(subject, relation, obj, valid_at))


def as_of(subject: str, relation: str, day: date) -> str | None:
    for e in edges:
        if e.subject == subject and e.relation == relation and e.valid_at <= day \
                and (e.invalid_at is None or day < e.invalid_at):
            return e.obj
    return None


if __name__ == "__main__":
    add_fact("C007", "订阅", "年付专业版", date(2026, 1, 15))
    add_fact("C007", "订阅", "月付基础版", date(2026, 10, 20))
    print("现在:", as_of("C007", "订阅", date(2026, 10, 22)))
    print("9 月扣款那天:", as_of("C007", "订阅", date(2026, 9, 3)))
    print("所有边:", [(e.obj, str(e.valid_at), str(e.invalid_at)) for e in edges])
```

<div class="line-notes">

- `from datetime import date` 只要日期不要时刻,用 `date`。相当于只用 JS `Date` 的年月日部分,但 Python 的 `date` 可以直接用 `<`、`<=` 比较先后。
- `class Edge:` 一条边就是一条事实:`subject`(主语)、`relation`(关系)、`obj`(宾语)。不叫 `object` 是因为 `object` 是 Python 内置的名字,别占用它。
- `valid_at: date` 这件事从哪天开始成立。
- `invalid_at: date | None = None` 从哪天开始不成立,默认 None 表示「到现在还成立」。`date | None` 相当于 TS 的 `Date | null`。
- `edges: list[Edge] = []` 整张「图」就是一个边的列表。真的 Graphiti 存在图数据库里,能按点快速找边,这里只为看清机制。
- `for e in edges:  # 同一主语同一关系的旧事实` 第二次调用 `add_fact` 时,会找到「C007 订阅 年付专业版」这条还没失效的边。
- `e.invalid_at = valid_at` 不删,只把失效日期填成新事实开始的那天:2026-10-20。真的 Graphiti 判断「冲突」靠模型,这里简化成「同主语同关系就算冲突」。
- `edges.append(Edge(subject, relation, obj, valid_at))` 新边追加到末尾,`invalid_at` 用默认值 None。
- `def as_of(subject: str, relation: str, day: date) -> str | None:` 问「某一天这个关系的值是什么」。
- `if e.subject == subject and e.relation == relation and e.valid_at <= day \` 行尾的反斜杠表示这一行没写完,下一行接着算。
- `and (e.invalid_at is None or day < e.invalid_at):` 条件是「开始日期 ≤ 那一天 < 失效日期」,左闭右开。问 10-22 时,年付那条 10-20 已失效,不满足;月付那条 `invalid_at` 是 None,满足。
- `if __name__ == "__main__":` 只有直接运行这个文件时才执行下面的演示。练习里会从别的文件 `import` 它,有这一行就不会把演示也跑一遍(Day 32 讲过)。
- `print("9 月扣款那天:", as_of("C007", "订阅", date(2026, 9, 3)))` 9 月 3 日落在年付那条边的有效期 [01-15, 10-20) 里,答案是年付专业版。

</div>

```bash
uv run python part10/temporal_facts.py
```

```text
现在: 月付基础版
9 月扣款那天: 年付专业版
所有边: [('年付专业版', '2026-01-15', '2026-10-20'), ('月付基础版', '2026-10-20', 'None')]
```

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="C007 订阅关系的时间线:年付专业版从 1 月 15 日到 10 月 20 日有效,月付基础版从 10 月 20 日起有效;查 9 月 3 日落在第一段">
  <rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <line x1="40" y1="110" x2="610" y2="110" stroke="var(--ink-soft)"/>
    <text x="60" y="130" text-anchor="middle" fill="var(--ink-soft)">01-15</text>
    <text x="470" y="130" text-anchor="middle" fill="var(--ink-soft)">10-20</text>
    <text x="590" y="130" text-anchor="middle" fill="var(--ink-soft)">至今</text>
    <rect x="60" y="62" width="410" height="30" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
    <text x="265" y="81" text-anchor="middle" fill="var(--ink-faint)">年付专业版 · invalid_at = 10-20</text>
    <rect x="470" y="62" width="130" height="30" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="535" y="81" text-anchor="middle" fill="var(--ink)">月付基础版</text>
    <line x1="380" y1="40" x2="380" y2="110" stroke="var(--mem)" stroke-dasharray="3 3"/>
    <text x="380" y="32" text-anchor="middle" fill="var(--mem)">as_of(09-03)</text>
    <line x1="580" y1="40" x2="580" y2="110" stroke="var(--mem)" stroke-dasharray="3 3"/>
    <text x="580" y="32" text-anchor="middle" fill="var(--mem)">as_of(10-22)</text>
    <text x="320" y="155" text-anchor="middle" fill="var(--ink-faint)" font-size="10">旧边没有被删除,只是在新边开始那天被填上了 invalid_at</text>
  </g>
</svg>
<figcaption>一条关系的两段历史。问哪一天,就看那一天落在哪段有效期里,这就是 as_of 做的事。</figcaption>
</figure>

这个结果对客服很有用。客户来问「9 月那笔重复扣款是按什么价格扣的」,答案取决于 9 月时他的套餐,而不是现在的套餐。只存当前值的记忆系统回答不了这个问题,mem0 的只追加虽然两条都在,但它没有显式的「有效期」字段,只能靠模型从文字里的日期去推。

Zep 在论文里报告,在 MemGPT 团队提出的 DMR 基准上它是 94.8%,MemGPT 是 93.4%;在 LongMemEval 上准确率最多提升 18.5%。mem0 那边也有自己的论文和分数。这些都是厂商自己测、在自己挑的基准上测的,数字可以看个大概,不要拿来直接做决定。

### Zep 的位置

第一根轴:抽取流程写。第二根轴:保留时间线,旧事实标记失效。适合实体多、关系复杂、经常要问「以前怎样」的企业场景。代价是要维护一个图数据库,抽取实体和关系要多调好几次模型,比 mem0 更贵也更慢。

## LangGraph store:给你一个抽屉,规则自己写

### 它的思路

第四家和前三家不是一类东西。LangGraph 是第五部分学过的编排框架,[Day 316](/blog/agent-zero/day-316-lg-checkpointer/) 的 checkpointer 解决的是「同一个线程(thread)里接着跑」,也就是一次会话内的状态。跨会话的记忆,LangGraph 另外提供了一个叫 **store** 的东西:按**命名空间**存 JSON 文档,可以按 key 取、按字段过滤,配了 embedding 以后还能语义检索。

命名空间(namespace)是一个元组,比如 `("cloudledger", "C007")`,你可以把它想成文件夹路径 `cloudledger/C007/`,每个 key 是文件夹里的一个文件。它不替你决定写什么、谁来写、冲突怎么办,同一个 key 再 `put` 一次就是直接覆盖。所以在第一根轴上它站在「你自己的代码」那一格,第二根轴上默认是「直接覆盖」,其他规则全靠你自己写。

### 先不接 embedding,只存取

`langgraph` 第五部分就装过了,没有的话 `uv add langgraph`(我这里是 1.2.16)。新建 `part10/lg_store.py`:

```python
# agent-zero-lab/part10/lg_store.py
from langgraph.store.memory import InMemoryStore

store = InMemoryStore()
ns = ("cloudledger", "C007")  # 命名空间:租户 + 客户,像文件夹路径
store.put(ns, "plan", {"text": "年付专业版", "source": "system"})
store.put(ns, "contact", {"text": "只接受邮件", "source": "extracted"})
store.put(("cloudledger", "C009"), "plan", {"text": "月付基础版", "source": "system"})

item = store.get(ns, "plan")
assert item is not None  # get 找不到会返回 None
print("get:", item.key, item.value, item.namespace)
store.put(ns, "plan", {"text": "月付基础版", "source": "system"})  # 同一个 key 再 put 就是覆盖
new = store.get(ns, "plan")
print("覆盖后:", new.value if new else None)
print("C007 名下:", [(i.key, i.value["text"]) for i in store.search(ns)])
print("按字段过滤:", [i.key for i in store.search(ns, filter={"source": "system"})])
print("所有命名空间:", store.list_namespaces())
```

<div class="line-notes">

- `from langgraph.store.memory import InMemoryStore` 存在内存里的 store,进程一退就没了,只适合演示和测试。生产用 `PostgresStore`,接口一样。
- `ns = ("cloudledger", "C007")` 圆括号是元组(Day 22),不可变。用元组而不是字符串拼接,是为了能按前缀查找,练习 4 会看到这个特性的坑。
- `store.put(ns, "plan", {"text": "年付专业版", "source": "system"})` 三个参数:命名空间、key、值。值必须是 dict。`source` 字段是我自己加的,store 不认识它,只是原样存着。
- `store.put(("cloudledger", "C009"), "plan",` 另一个客户,用来确认隔离。
- `item = store.get(ns, "plan")` 按命名空间加 key 精确取一条,返回 `Item` 对象,有 `.key`、`.value`、`.namespace`,还有创建和更新时间。
- `assert item is not None  # get 找不到会返回 None` 告诉类型检查器下面 `item` 不是 None。真找不到时程序会在这里停下并报 `AssertionError`。
- `store.put(ns, "plan", {"text": "月付基础版", "source": "system"})  # 同一个 key 再 put 就是覆盖` 旧值没有任何保留,和 Letta 的 `replace` 一样。
- `new = store.get(ns, "plan")` 再取一次,这次不用 assert,用下一行的条件表达式处理 None。
- `print("C007 名下:", [(i.key, i.value["text"]) for i in store.search(ns)])` 不带 query 的 `search` 就是列出这个命名空间下的全部条目。
- `store.search(ns, filter={"source": "system"})` 按值里的字段精确过滤,有点像 SQL 的 `WHERE source = 'system'`。
- `store.list_namespaces()` 列出所有命名空间,做「删除某个客户全部数据」的时候用得上。

</div>

```bash
uv run python part10/lg_store.py
```

```text
get: plan {'text': '年付专业版', 'source': 'system'} ('cloudledger', 'C007')
覆盖后: {'text': '月付基础版', 'source': 'system'}
C007 名下: [('plan', '月付基础版'), ('contact', '只接受邮件')]
按字段过滤: ['plan']
所有命名空间: [('cloudledger', 'C007'), ('cloudledger', 'C009')]
```

### 再接上 embedding

给 `InMemoryStore` 传一个 `index` 配置,它在 `put` 时会对指定字段算 embedding,`search` 时就能带 `query` 做语义检索。embed 函数复用 Day 217 的写法。新建 `part10/lg_store_search.py`:

```python
# agent-zero-lab/part10/lg_store_search.py
import os
from collections.abc import Sequence

from dotenv import load_dotenv
from langgraph.store.base import IndexConfig
from langgraph.store.memory import InMemoryStore
from openai import OpenAI

load_dotenv()
emb = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])


def embed(texts: Sequence[str]) -> list[list[float]]:
    resp = emb.embeddings.create(model=os.environ["EMB_MODEL"], input=list(texts))
    return [d.embedding for d in resp.data]


index: IndexConfig = {"embed": embed, "dims": 1024, "fields": ["text"]}
store = InMemoryStore(index=index)
ns = ("cloudledger", "C007")
store.put(ns, "plan", {"text": "订阅是月付基础版"})
store.put(ns, "contact", {"text": "只接受邮件联系,不要打电话"})
store.put(ns, "issue-0903", {"text": "9 月 3 日报告重复扣款 468 元,已提交退款"})
for q in ["怎么联系这个客户", "上次退款的事"]:
    hits = store.search(ns, query=q, limit=2)
    print(q, "->", [(h.key, round(h.score or 0, 3)) for h in hits])
```

<div class="line-notes">

- `from collections.abc import Sequence` `Sequence[str]` 表示「任何能按下标读的字符串序列」,list 和 tuple 都算。LangGraph 要求 embed 函数接受 `Sequence[str]`,写成 `list[str]` 能跑,但类型检查器会报不兼容。
- `from langgraph.store.base import IndexConfig` index 配置的类型,标上它 Zed 才不画红线。
- `emb = OpenAI(base_url=os.environ["EMB_BASE_URL"]` 硅基流动的 OpenAI 兼容地址,和调大模型用的是同一个 SDK,只是换了地址和 key。
- `resp = emb.embeddings.create(model=os.environ["EMB_MODEL"], input=list(texts))` 一次把一批文字发过去,`list(texts)` 把序列转成真正的 list,接口要的是 list。
- `return [d.embedding for d in resp.data]` 每条文字返回一个 1024 维的浮点数列表。
- `index: IndexConfig = {"embed": embed, "dims": 1024, "fields": ["text"]}` 三项:用哪个函数算向量、向量几维、对值里哪个字段算。`fields` 不写的话默认对整个值算。
- `store.put(ns, "issue-0903",` key 可以是任意字符串。这条是情景记忆(发生过的事),前两条是语义记忆(事实)。
- `hits = store.search(ns, query=q, limit=2)` 带 `query` 就是语义检索,返回的每个 Item 多了 `score`。
- `round(h.score or 0, 3)` score 类型上可能是 None(不带 query 时就是 None),`or 0` 兜底。

</div>

```bash
uv run python part10/lg_store_search.py
```

```text
怎么联系这个客户 -> [('contact', 0.672), ('issue-0903', 0.564)]
上次退款的事 -> [('issue-0903', 0.82), ('plan', 0.529)]
```

排第一的都对。第二名的分数也不低,说明短句之间的余弦相似度普遍在 0.5 上下,[Day 219](/blog/agent-zero/day-219-embed-limits/) 讲过 embedding 分不太清这种细微差别,所以真用的时候要设一个阈值,或者先按规则过滤再按相似度排。这一步的 embedding 一共几十个 token,费用可以忽略。

### LangGraph store 的位置

第一根轴:你自己的代码。第二根轴:默认覆盖,其他规则自己写。它最大的价值是**不替你做决定**,存储、命名空间隔离、语义检索这些「水电」都有了,来源优先级、有效期、敏感字段拦截这些「业务规则」你自己加。对已经在用 LangGraph 的项目,这是最顺的选择。另外,LangChain 官方还有一个叫 LangMem 的库,在 store 之上提供了抽取和管理记忆的工具,我查到的版本是 0.0.30(2025-10 发布),一年没有发新版了,今天不展开。

## 四家放在一张表里

| 方案 | 谁来写 | 冲突怎么处理 | 今天的实跑 | 适合 |
| --- | --- | --- | --- | --- |
| mem0(`mem0ai` 2.2.1) | 抽取流程 | 论文版让模型选 ADD/UPDATE/DELETE/NOOP;2026-04 起只追加,靠检索挑 | 真跑:全是 ADD,问「现在」时旧套餐排第一 | 个人偏好类记忆,想最快接上 |
| Letta(`letta-client` 1.12.1) | Agent 自己调工具 | 模型判断改写,不留历史 | 模拟:模型自己改了套餐,闲聊没乱改 | 陪伴、个人助理这类记忆即产品的 Agent |
| Zep / Graphiti(`graphiti-core` 0.31.2) | 抽取流程 | 旧事实标记失效,保留时间线 | 模拟:能回答「9 月那天是什么套餐」 | 实体关系复杂、要做时间推理的企业场景 |
| LangGraph store(`langgraph` 1.2.16) | 你自己的代码 | 默认覆盖,其余你写 | 真跑:命名空间隔离、语义检索 | 已经用 LangGraph,规则要自己掌控 |

## 给 SupportPilot 选一个

SupportPilot 的客户记忆有几条硬要求,都是 Day 532 讨论出来的:业务系统的数据优先,对话里客户随口一句不能覆盖它;银行卡号、身份证号、密码永远不进记忆,而且拦截必须是确定性的代码;「当前问题」这种记忆 30 天后要过期;客户要求删除时要能按客户删干净;出了事要能查到某条记忆什么时候、从哪来、被谁替代。

拿这几条去对四家:

mem0 的写入规则在它的提示词里,要实现来源优先级,得在调 `add` 之前自己判断,只追加的设计又让「拒绝写入」这件事无处安放,能做但处处在绕它。Letta 让模型自己改记忆,和「出了事要能查」正面冲突。Graphiti 的时间线正好满足审计要求,但为了一个客服记忆维护一个图数据库,还要每次写入多调几次模型,对现在的规模太重了。LangGraph store 什么规则都没有,恰好意味着什么规则都能加。

我的选择是**自己写**,思路上抄两家:冲突处理抄 Graphiti,旧值不删、标记被替代;写入抄 mem0 的抽取流程,对话结束后由后台流程抽,不让 Agent 在回答时顺手改。存储先用 SQLite,以后 SupportPilot 已经在用 LangGraph 的话,把底层换成 store 也不难。

我的判断标准就一句话:**记忆规则和业务规则绑得越紧,越应该自己写**。客服的来源优先级、有效期、删除权全是业务规则,用通用框架反而要绕。反过来,个人助理那种「记住用户的一切偏好」,用 mem0 这类开箱即用的方案省事得多。明天就动手写这个客户记忆。

## 动手练习

**练习 1:换个问法再查一次 mem0。** 不重新写入,直接打开 `part10/qdrant_data` 里已有的记忆,分别用「这个客户现在是什么套餐?」和「客户最近一次改套餐是什么时候、改成了什么?」去查,看排序有没有变,并解释原因。

<details><summary>参考答案</summary>

新建 `part10/ex533_mem0_search.py`,配置和 `mem0_demo.py` 一模一样,只是不调 `add`:

```python
# agent-zero-lab/part10/ex533_mem0_search.py
import os

from dotenv import load_dotenv
from mem0 import Memory

load_dotenv()
config = {
    "llm": {"provider": "deepseek", "config": {
        "model": os.environ["LLM_MODEL"], "api_key": os.environ["LLM_API_KEY"],
        "deepseek_base_url": os.environ["LLM_BASE_URL"], "temperature": 0}},
    "embedder": {"provider": "openai", "config": {
        "model": os.environ["EMB_MODEL"], "api_key": os.environ["EMB_API_KEY"],
        "openai_base_url": os.environ["EMB_BASE_URL"]}},
    "vector_store": {"provider": "qdrant", "config": {
        "collection_name": "c007", "path": "part10/qdrant_data", "embedding_model_dims": 1024}},
}
m = Memory.from_config(config)
for q in ["这个客户现在是什么套餐?", "客户最近一次改套餐是什么时候、改成了什么?"]:
    hits = m.search(query=q, filters={"user_id": "cloudledger:C007"}, top_k=3)["results"]
    print(q)
    for h in hits:
        print("  ", round(h["score"], 3), h["memory"][:60], "| created_at:", (h.get("created_at") or "")[:19])
```

<div class="line-notes">

- `"collection_name": "c007", "path": "part10/qdrant_data"` 指向同一个目录和集合,就能读到 `mem0_demo.py` 写进去的记忆。
- `hits = m.search(query=q, filters={"user_id": "cloudledger:C007"}, top_k=3)["results"]` 检索只调 embedding,不调大模型,这个练习几乎不花钱。
- `h["memory"][:60]` 记忆是很长的英文句子,只打印前 60 个字符,`[:60]` 是 Day 15 的切片。同一行后半的 `(h.get("created_at") or "")[:19]` 打印写入时间:`.get` 取不到时返回 None,`or ""` 兜底再切片,只留到秒。

</div>

```text
这个客户现在是什么套餐?
   0.6 User is on the annual Professional plan and was double-charg | created_at: 2026-10-22T04:11:21
   0.546 User downgraded from the annual Professional plan to the mon | created_at: 2026-10-22T04:11:23
   0.518 User prefers to be contacted by email rather than by phone a | created_at: 2026-10-22T04:11:21
客户最近一次改套餐是什么时候、改成了什么?
   0.596 User downgraded from the annual Professional plan to the mon | created_at: 2026-10-22T04:11:23
   0.58 User is on the annual Professional plan and was double-charg | created_at: 2026-10-22T04:11:21
   0.464 User prefers to be contacted by email rather than by phone a | created_at: 2026-10-22T04:11:21
```

问法里带了「改」,和「downgraded」那条在语义上更近,它就排到了第一。也就是说,在这个配置下排序完全由文字相似度决定,和哪条更新无关:两条记忆的 `created_at` 只差两秒,检索根本没看它。想让「现在」稳定拿到最新值,要么装上 mem0 的额外组件让它做时间推理,要么自己在检索结果上按 `created_at` 再排一次。这正是「只追加,读时挑」把难题转移到读那一侧的样子。

</details>

**练习 2:给 Letta 风格的记忆块加一个追加工具。** 现在只有 `core_memory_replace`,客户说出一条全新的信息(比如「我们公司在杭州」)时,模型没有工具可用。加一个 `core_memory_append(text)`,让模型自己选用哪个工具。

<details><summary>参考答案</summary>

新建 `part10/ex533_letta_append.py`:

```python
# agent-zero-lab/part10/ex533_letta_append.py
import json
import os

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionFunctionToolParam

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
core = {"customer": "C007,月付基础版,只接受邮件联系"}

TOOLS: list[ChatCompletionFunctionToolParam] = [
    {"type": "function", "function": {
        "name": "core_memory_replace",
        "description": "把核心记忆块 customer 里的一段旧文字替换成新文字。已有的信息变了就调用。",
        "parameters": {"type": "object", "properties": {
            "old": {"type": "string"}, "new": {"type": "string"}}, "required": ["old", "new"]}}},
    {"type": "function", "function": {
        "name": "core_memory_append",
        "description": "往核心记忆块 customer 末尾追加一条以后还用得上的新信息。",
        "parameters": {"type": "object", "properties": {
            "text": {"type": "string"}}, "required": ["text"]}}},
]


def chat(user_text: str) -> None:
    system = f"你是 CloudLedger 客服。<customer>{core['customer']}</customer>"
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"], temperature=0, tools=TOOLS, extra_body=EXTRA,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user_text}])
    for call in resp.choices[0].message.tool_calls or []:
        if call.type != "function":
            continue
        args = json.loads(call.function.arguments)
        if call.function.name == "core_memory_append":
            core["customer"] += "," + args["text"]
        else:
            core["customer"] = core["customer"].replace(args["old"], args["new"])
        print("调用:", call.function.name, args)


chat("我们公司在杭州,下个月要开发票给杭州的分公司。")
print("核心记忆块:", core["customer"])
```

<div class="line-notes">

- `"description": "把核心记忆块 customer 里的一段旧文字替换成新文字。已有的信息变了就调用。",` 把 replace 的描述改成「已有的信息变了」,和 append 的「新信息」区分开,模型才知道该选哪个。
- `"name": "core_memory_append",` 新工具只有一个参数 `text`。
- `if call.function.name == "core_memory_append":` 按工具名分发。工具一多就该用 Day 168 的注册表,这里两个工具 if 就够了。
- `core["customer"] += "," + args["text"]` 追加。真实的 Letta 每个块有字数上限,追加超限会报错,让模型先删再加。

</div>

```text
调用: core_memory_append {'text': '公司位于杭州；下个月需向杭州的分公司开具发票。'}
核心记忆块: C007,月付基础版,只接受邮件联系,公司位于杭州；下个月需向杭州的分公司开具发票。
```

模型选对了工具。注意它把「下个月要开发票」这种一次性的事也写进了核心记忆块,一个月后这条就过时了,而记忆块没有有效期,会一直待在每一轮的系统提示词里。这就是「Agent 自己写」的典型问题:记什么、记多久,标准都在模型的一次判断里。

</details>

**练习 3:给带时间的事实加一个 history 函数。** 写 `history(subject, relation)`,按开始时间列出某个关系的全部历史,格式像「2026-01-15 ~ 2026-10-20:年付专业版」。再给 C007 加两条「联系方式」的事实验证一下,并查一下 2025 年底(还没有任何事实时)的套餐。

<details><summary>参考答案</summary>

新建 `part10/ex533_temporal_history.py`:

```python
# agent-zero-lab/part10/ex533_temporal_history.py
from datetime import date

from temporal_facts import add_fact, as_of, edges


def history(subject: str, relation: str) -> list[str]:
    rows = [e for e in edges if e.subject == subject and e.relation == relation]
    rows.sort(key=lambda e: e.valid_at)
    return [f"{e.valid_at} ~ {e.invalid_at or '至今'}:{e.obj}" for e in rows]


add_fact("C007", "订阅", "年付专业版", date(2026, 1, 15))
add_fact("C007", "订阅", "月付基础版", date(2026, 10, 20))
add_fact("C007", "联系方式", "电话", date(2026, 1, 15))
add_fact("C007", "联系方式", "只要邮件", date(2026, 6, 1))
for line in history("C007", "订阅") + history("C007", "联系方式"):
    print(line)
print("2025 年底的套餐:", as_of("C007", "订阅", date(2025, 12, 31)))
```

<div class="line-notes">

- `from temporal_facts import add_fact, as_of, edges` 从正文的文件导入。因为那边的演示放在 `if __name__ == "__main__":` 下面,导入时不会再打印一遍。`edges` 是同一个列表对象,这里 `add_fact` 加进去的边,`history` 能直接看到。
- `rows = [e for e in edges if` 列表推导式(Day 23)筛出同主语同关系的边,相当于 JS 的 `edges.filter(...)`。
- `rows.sort(key=lambda e: e.valid_at)` 按开始日期原地排序,`lambda` 相当于箭头函数 `e => e.valid_at`。
- `{e.invalid_at or '至今'}` 还没失效的边 `invalid_at` 是 None,显示成「至今」。
- `print("2025 年底的套餐:", as_of(` 2025-12-31 早于所有边的开始日期,`as_of` 的循环一条都匹配不上,走到最后的 `return None`。

</div>

```text
2026-01-15 ~ 2026-10-20:年付专业版
2026-10-20 ~ 至今:月付基础版
2026-01-15 ~ 2026-06-01:电话
2026-06-01 ~ 至今:只要邮件
2025 年底的套餐: None
```

None 是对的答案:那时候我们对这个客户一无所知。真实系统里要把「不知道」和「没有」区分开,回答客户时说「系统里查不到当时的记录」,而不是瞎猜一个。

</details>

**练习 4:命名空间前缀的坑。** 往 store 里放三个客户:`("cloudledger", "C007")`、`("cloudledger", "C009")`、`("acme", "C007")`。先用 `store.search(("cloudledger",))` 查一次,再用完整命名空间查一次,观察差别。然后写一个 `customer_ns(tenant, customer_id)` 函数,任何一个参数为空就报错。

<details><summary>参考答案</summary>

新建 `part10/ex533_ns_prefix.py`:

```python
# agent-zero-lab/part10/ex533_ns_prefix.py
from langgraph.store.memory import InMemoryStore

store = InMemoryStore()
store.put(("cloudledger", "C007"), "contact", {"text": "只接受邮件"})
store.put(("cloudledger", "C009"), "contact", {"text": "电话 138xxxx"})
store.put(("acme", "C007"), "contact", {"text": "别的公司的 C007"})

print("只给前缀:", [(i.namespace, i.value["text"]) for i in store.search(("cloudledger",))])
print("写全:", [(i.namespace, i.value["text"]) for i in store.search(("cloudledger", "C007"))])


def customer_ns(tenant: str, customer_id: str) -> tuple[str, str]:
    if not tenant or not customer_id:
        raise ValueError("tenant 和 customer_id 都必须有值")
    return (tenant, customer_id)


try:
    store.search(customer_ns("cloudledger", ""))
except ValueError as e:
    print("拦住了:", e)
```

<div class="line-notes">

- `store.search(("cloudledger",))` 只有一个元素的元组要写逗号,`("cloudledger")` 不带逗号只是一个加了括号的字符串(Day 22 的坑)。
- `store.search(("cloudledger", "C007"))` 完整的命名空间,只返回这个客户。
- `def customer_ns(tenant: str, customer_id: str) -> tuple[str, str]:` 所有读写记忆的地方都只能通过这个函数拿命名空间,不允许手拼元组。
- `if not tenant or not customer_id:` 空字符串在 Python 里是假值(Day 17),`not ""` 是 True。
- `raise ValueError(` 宁可报错,也不要带着一个残缺的命名空间去查。

</div>

```text
只给前缀: [(('cloudledger', 'C007'), '只接受邮件'), (('cloudledger', 'C009'), '电话 138xxxx')]
写全: [(('cloudledger', 'C007'), '只接受邮件')]
拦住了: tenant 和 customer_id 都必须有值
```

`search` 的第一个参数是**命名空间前缀**,只给租户就会把这个租户下所有客户的记忆都捞出来。设想一个 bug:某处代码拿到的 `customer_id` 是空字符串,有人写了 `tuple(x for x in (tenant, cid) if x)` 之类的「清理」,结果查询变成只按租户查,Agent 给 C007 回复时引用了 C009 的电话号码。这类串号事故在多租户系统里很常见,防的办法就是把命名空间的构造收口到一个会报错的函数里。

</details>

**练习 5(开放题):给三个场景选方案。** 场景 A:一个英语口语陪练 App,希望越聊越懂学生的兴趣和薄弱点;场景 B:SupportPilot 客服;场景 C:一个法务助理,要回答「合同签订时对方公司的法人是谁」这类问题。每个场景选一个方案并写两三句理由。

<details><summary>参考答案</summary>

这是我的示范解法,你的选择可以不同,重要的是理由落在那两根轴上。

场景 A 选 mem0 或 Letta。记忆就是产品体验本身,记错了学生会当场纠正,没有资金和合规风险;要的是接入快、偏好记得全。如果希望 Agent 在对话里实时调整(「你上次说想练面试,今天继续?」),Letta 的核心记忆块更合适;如果只是后台慢慢积累画像,mem0 更省事。

场景 B 选自己写,存储可以用 SQLite 或 LangGraph store。理由正文讲过:来源优先级、有效期、删除权、敏感字段拦截都是业务规则,必须是可测试的确定性代码。

场景 C 选 Graphiti。问题天然带时间(「签订时」),实体关系多(公司、法人、合同、日期),而且法人会变更,必须保留时间线才能答对。图数据库的运维成本在这种场景里是值得的。

做对比时可以用练习 3 的代码验证场景 C:把「对方公司 法人 张三 2024-03-01」「对方公司 法人 李四 2025-07-15」两条事实加进去,`as_of` 查合同签订日 2025-01-10,得到张三;只存当前值的方案只会答李四。

</details>

**验收标准**:四个正文脚本都在你的机器上跑出和文中同类的结果(mem0 和 Letta 的具体文字可以不同);能不看文章画出两根轴的图并把四家放对位置;练习 5 的三个选择每个都有落在「谁来写」或「冲突怎么处理」上的理由。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| mem0 | 一个开源的 AI 记忆层,`add` 时用模型从对话里抽事实存进向量库,`search` 时按语义查回来 |
| ADD / UPDATE / DELETE / NOOP | mem0 论文里写入记忆的四种操作:新增、改写、删除、不变。2026-04 起 mem0 新算法只用 ADD |
| 只追加 ADD-only | 写入时只新增、不改不删,冲突留给检索阶段去挑 |
| Letta / MemGPT | 让 Agent 自己用工具编辑「核心记忆块」的方案,前身是 MemGPT 论文,把上下文类比成操作系统的内存 |
| 核心记忆块 memory block | 每轮都原样放进系统提示词的一段文字,Agent 可以用工具改它 |
| Zep / Graphiti | Zep 是做 Agent 记忆的公司,Graphiti 是它开源的带时间的知识图谱引擎 |
| 知识图谱 | 用「点(实体)+ 边(关系)」存知识,例如「C007 —订阅→ 月付基础版」 |
| valid_at / invalid_at | Graphiti 给每条事实加的两个时间:从哪天开始成立、从哪天开始不成立 |
| 带时间的事实 | 不只存值,还存有效期的事实;旧值不删,只标记失效,能回答「某天是什么」 |
| LangGraph store | LangGraph 提供的跨会话存储,按命名空间存 JSON 文档,可选语义检索 |
| 命名空间 namespace | store 里给数据分组的元组,例如 `("cloudledger", "C007")`,像文件夹路径,查询时按前缀匹配 |
| Qdrant | 一个向量数据库,mem0 默认用它,支持不起服务、直接存到本地目录的模式 |

## 常见误区

**给 OpenAI 兼容的 embedding 服务也配 `embedding_dims`。** mem0 只要在 embedder 里看到这个配置,就会把 `dimensions` 参数发给接口。OpenAI 自家的模型支持,bge-m3 这类不支持,硅基流动直接回 `400 {'code': 20015, 'message': 'The parameter is invalid.'}`。维度只写在 `vector_store` 的 `embedding_model_dims` 里。

**以为 mem0 会帮你把旧记忆改掉。** 网上 2025 年的教程讲的都是 ADD/UPDATE/DELETE/NOOP,那是论文版。2026-04 以后的版本只追加,实测「降级了」那句没有改动旧记忆,检索时旧套餐还排在第一。

**以为 `temperature=0` 抽出来的记忆每次都一样。** 我同一天跑两次 mem0,一次存了 4 条,一次存了 3 条,拆分方式不同。抽取结果要当成「可能每次不同」来设计和评测。

**按旧教程装 Letta。** 2026 年 `letta-ai/letta` 的 README 已经写明源码搬到了 `letta-ai/letta-code`,旧的 V1 API 服务在 archive 分支。照着两年前的步骤起服务,命令和接口都可能对不上,先看仓库首页。

**拿厂商论文里的分数直接选型。** mem0、Zep 都在自己挑的基准上报告自己领先,mem0 的 PyPI 页面也写明分数来自含专有优化的托管平台。看它们的方法设计,用自己的数据测,比看分数可靠。

**`store.search` 只传租户。** LangGraph store 按命名空间前缀匹配,只传 `("cloudledger",)` 会把这个租户所有客户的记忆都返回。命名空间要收口到一个参数为空就报错的函数里。

**把一次性的事写进核心记忆块。** 练习 2 里模型把「下个月要开发票」也追加进了常驻的记忆块,它没有有效期,会一直占着每一轮的上下文。哪些信息配进常驻记忆,要有明确的规则。

## 学习资料

### 文档与文章

- [mem0 PyPI 页面](https://pypi.org/project/mem0ai/):2026-04 新算法(只追加、多路检索、时间推理)的官方说明和基准分数都在这里,注意看「分数来自托管平台」那句。15 分钟。
- [mem0 文档:DeepSeek 作为 LLM](https://docs.mem0.ai/components/llms/models/deepseek):今天的配置照这一页写的。
- [mem0 论文](https://arxiv.org/abs/2504.19413):看抽取和更新两个阶段的流程图,理解 ADD/UPDATE/DELETE/NOOP 的来历。
- [MemGPT 论文](https://arxiv.org/abs/2310.08560):读前两节和图 1,「上下文是内存、数据库是硬盘」这个类比值得记住。30 分钟。
- [Letta 文档:Memory blocks](https://docs.letta.com/guides/agents/memory-blocks):核心记忆块在真实 Letta 里长什么样,有哪些字段和限制。
- [Zep 论文](https://arxiv.org/abs/2501.13956):看 Graphiti 怎么给边加 `valid_at` 和 `invalid_at`,以及冲突时怎么让旧边失效。
- [Graphiti 文档](https://help.getzep.com/graphiti/getting-started/overview):想自己部署时从这里开始,需要 Neo4j 或 FalkorDB。
- [Zep 关于开源策略调整的公告](https://blog.getzep.com/announcing-a-new-direction-for-zeps-open-source-strategy/):为什么社区版不再维护、开源只做 Graphiti。
- [LangGraph 文档:Memory](https://docs.langchain.com/oss/python/langgraph/memory):短期记忆和长期记忆、store 的命名空间和语义检索,今天 store 部分的出处。30 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1p2DyB4Ee3&autoplay=0&high_quality=1" title="Agent记忆框架怎么选?5大Agent Memory项目工程级横向对比" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · Agent记忆框架怎么选?5大Agent Memory项目工程级横向对比,哪一种才是未来Agent记忆的标准答案 · 15 分钟,播放量 6.9 万。和今天的对比表互相印证,看他的分类维度和我们的两根轴有什么异同。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1F7P9zLErb&autoplay=0&high_quality=1" title="GitHub 4.9万星 | mem0 开源框架架构解析与实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>加菲大杂烩 · GitHub 4.9万星 | mem0 开源框架架构解析与实战 · 40 分钟,2026 年 3 月发布,播放量 3 万。讲 mem0 内部的抽取和检索流程;注意视频发布在 4 月新算法之前,讲到更新操作的部分对应的是论文版。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/E0k9Ppq6yXY" title="Stateful Agents — Full Workshop with Charles Packer of Letta and MemGPT" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Stateful Agents — Full Workshop with Charles Packer of Letta and MemGPT · MemGPT 一作讲有状态 Agent 和核心记忆块的设计,前 30 分钟的概念部分最有价值,英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章「RAG and Agents」里讲 Agent 记忆的小节:把记忆和 RAG 放在一起讲,能看清两者的边界。
- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly,2017;中文版《数据密集型应用系统设计》,中国电力出版社),第 5 章「Replication」里讲多副本写冲突和「最后写入者胜」的坑,和今天第二根轴是同一类问题。这本书 2026 年出了和 Chris Riccomini 合写的第二版,章节编排有变化,看第一版即可。

### 开源项目与代码

- [mem0ai/mem0](https://github.com/mem0ai/mem0):看 `mem0/embeddings/openai.py`,今天那个 400 报错的原因就写在注释里;再看 `mem0/memory/main.py` 里 `add` 的流程。
- [letta-ai/letta-code](https://github.com/letta-ai/letta-code):Letta 当前的主仓库。想看 MemGPT 原始的核心记忆工具实现,去 [letta-ai/letta](https://github.com/letta-ai/letta) 的 archive 分支。
- [getzep/graphiti](https://github.com/getzep/graphiti):带时间的知识图谱实现,搜 `invalid_at` 能找到旧边失效的逻辑。
- [langchain-ai/langmem](https://github.com/langchain-ai/langmem):LangChain 在 store 之上做的记忆抽取工具,可以和 mem0 的思路对照着看。

## 自测

1. 用「谁来写」和「冲突怎么处理」两根轴,分别说出 mem0(新版)和 Letta 的位置。

<details><summary>答案</summary>

mem0 新版:抽取流程来写,冲突上只追加、读时挑。Letta:Agent 自己调工具来写,冲突上由模型判断改写,不保留历史。

</details>

2. 实跑 mem0 时,客户说「我前天已经降级成月付基础版了」,mem0 做了什么?问「现在是什么套餐」时为什么旧套餐排在第一?

<details><summary>答案</summary>

mem0 只新增了一条「降级了」的记忆,没有修改旧的「年付专业版」那条(新算法只追加)。检索时排序只看语义相似度,旧记忆里的「annual Professional plan」和问题更接近,于是排第一;时间推理和关键词检索需要额外组件,我的配置下没有生效。

</details>

3. Graphiti 的「带时间的事实」解决了什么问题?举一个只存当前值的方案答不了的问题。

<details><summary>答案</summary>

它让每条事实带有效期,旧事实不删只标记失效,所以能回答「某一天这件事是什么」。例子:「9 月重复扣款那天,这个客户是什么套餐?」只存当前值的方案只能答出现在的月付基础版,答不出当时的年付专业版。

</details>

4. LangGraph store 的 `search(("cloudledger",))` 会返回什么?这会带来什么风险?

<details><summary>答案</summary>

`search` 按命名空间前缀匹配,会返回 `cloudledger` 这个租户下所有客户的记忆。风险是串号:某处代码丢了 customer_id,Agent 就可能拿别的客户的信息去回复。要把命名空间的构造收口到一个参数为空就报错的函数里。

</details>

5. 面试题:「你们的客服 Agent 要加跨会话记忆,为什么不直接用 mem0?」请给一个有取舍的回答。

<details><summary>答案</summary>

要点:先承认 mem0 接入快、适合偏好类记忆。再说清客服记忆的硬要求:业务系统数据优先、对话里的说法不能覆盖它;敏感字段必须由确定性代码拦截;不同类型的记忆有不同有效期;要支持按客户删除和审计。mem0 新版只追加、规则在它的提示词里,这些要求都得在它外面绕,而且检索阶段可能把过期的旧值排在前面(可以举实测的例子)。所以选择自己写一个规则明确的记忆层,冲突处理借鉴 Graphiti 的「旧值标记失效」,写入借鉴 mem0 的后台抽取,存储用 SQLite 或 LangGraph store。最后补一句:如果是个人助理类场景,我会选 mem0。

</details>

6. 为什么说「Agent 自己写记忆」难评测?

<details><summary>答案</summary>

改不改、改成什么,是模型在回答问题的同一次调用里顺手判断的,判断标准没有写成代码,你只能看结果;改写直接覆盖旧值,没有历史,出了错也查不到是哪一轮改的。抽取流程写则可以单独拿一批对话去测抽取的准确率和召回率。

</details>

## 明天预告

Day 534 · 记忆系统(三):给 SupportPilot 写客户记忆并评测。今天选定了「自己写」,明天就动手:用 SQLite 一步一步搭出一个带来源优先级、有效期、替代历史和按客户删除的客户记忆,再用一批标注过的对话测它的写入质量,重点看敏感信息有没有全部被拦住。
