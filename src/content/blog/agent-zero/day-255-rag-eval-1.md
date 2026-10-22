---
title: 'Day 255 · RAG 评估(一):为什么分两层'
description: 'RAG 答错一道题,要么是资料没检索到,要么是资料到手了模型没用好。今天把这两层拆开量:同 6 道题跑三套配置,BM25 那套和宽松提示词那套都是端到端 3/6,一个是 3 道检索错,一个是在无答案题上编了话,修法完全相反。顺手踩了空集合是任何集合子集的坑,也看到「查关键词」判生成有多粗。'
pubDate: 2026-10-22
regime: none
tags: ['rag-evaluation', 'rag', 'python', 'agent-zero']
series: 'agent-zero'
day: 255
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 252](/blog/agent-zero/day-252-graphrag-extract/) 到 [Day 254](/blog/agent-zero/day-254-graphrag-global/) 做了三天 GraphRAG:抽三元组、local search、社区摘要和 global search。三天的结论都是数字:图检索找文章 6/9,混合检索 8/9;global search 第一版覆盖 5/20,改完提示词升到 15/20,再捡回小社区到 18/20。

这些数字是我临时手标几道题、写个小函数算出来的。题怎么出、对错怎么判、一个数字该归到检索头上还是模型头上,一直没正经讲过。Day 254 最后还发现,同样的代码跑三轮,结果是 17、20、18。从今天起用六个内容日把 RAG 评估讲透,第一天只做一件事:把「答对没答对」拆成两层。

## 今天要解决的问题

学完你应该能做到:

1. 说清楚 RAG 答错一道题只有两类原因(检索层没拿到资料、生成层没用好资料),各举一个今天实跑出来的例子。
2. 写一个脚本,对同一道题分别判「检索层对不对」「生成层对不对」,把结果归进四个格子。
3. 看着两套端到端分数一样的配置,说出它们各自坏在哪一层、该改什么。
4. 知道「查关键词」判生成层有多粗,为什么后面要换成大模型当裁判。

预计用时 2 小时。API 花费约 ¥0.035:主线 ¥0.026(三次 `rag_once` ¥0.0057,`two_layers` 18 次调用 ¥0.0200),练习约 ¥0.009。embedding 和 rerank 用的硅基流动 bge-m3、bge-reranker-v2-m3 是免费模型。

前置:[Day 240](/blog/agent-zero/day-240-retrieval-pipeline/) 的 `part04/retrieve.py`(`retrieve(question, k, mode)`,mode 有 `vector`、`bm25`、`hybrid`、`hybrid+rerank` 四种,要 Postgres.app 开着,索引用 [Day 231](/blog/agent-zero/day-231-pgvector-2/) 的 `pg_sync.py` 建好);[Day 226](/blog/agent-zero/day-226-retrieve-answer/)、[Day 227](/blog/agent-zero/day-227-rag-prompt/) 的回答提示词(要求标出处、资料不够就说没找到);[Day 135](/blog/agent-zero/day-135-llm-client-1/) 的 `common/llm.py`;[Day 25](/blog/agent-zero/day-025-sets/) 的集合运算。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `two_layers.py` 的 `judge()` 和主循环;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 一道题答错了,先问错在哪

先看一道真题。用户问「年付企业版第 3 个月想退,能退多少?」。按帮助中心的规则,企业版年付 1908 元,每月 159 元,前 2 个月加当月共 3 个月不退,退剩下 9 个月,是 1431 元。这道题要两篇文章才答得出来:kb-001《套餐与价格》给价格,kb-002《退款政策》给规则。

跑一下 Day 240 的流水线,模型说的是「资料里只给了专业版的例子,没有企业版的价格,算不出来」。错了。可是错在哪?

RAG 是两段:先**检索**,从知识库里找出最相关的 k 块;再**生成**,把这 k 块拼进提示词交给模型回答。答错一道题,原因只有两类:

- 检索层错了:答这道题要用的资料根本没进 top-k,模型手里就没有。这时候换更强的模型、改提示词都没用,巧妇难为无米之炊。
- 生成层错了:资料已经在 top-k 里,模型没用好,漏了条件、张冠李戴,或者自己编了一句。这时候再调检索也没用。

只看最后一句回答对不对,你分不出是哪一类。就像前端页面显示「暂无数据」,你得打开 DevTools 的 Network 面板看一眼:接口返回的就是空数组,那是后端的问题;接口返回了 20 条,页面没渲染出来,那是前端的问题。RAG 评估分两层,就是在检索和生成之间开一个「Network 面板」。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="RAG 两段流水线:问题先进检索层取 top-k 块,再进生成层由大模型回答;检索层评估看答案所需的文章在不在 top-k,用规则判;生成层评估看回答是否正确、有依据、该拒答时拒答">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<defs><marker id="ev255a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="104" width="104" height="48" rx="4" fill="none" stroke="var(--rule)"/>
<text x="68" y="132" fill="var(--ink)" text-anchor="middle">用户问题</text>
<line x1="120" y1="128" x2="156" y2="128" stroke="var(--ink-soft)" marker-end="url(#ev255a)"/>
<rect x="158" y="104" width="130" height="48" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="223" y="124" fill="var(--ink)" text-anchor="middle">检索 top-k</text>
<text x="223" y="142" fill="var(--ink-soft)" text-anchor="middle" font-size="11">kb-002#1 kb-003#1 …</text>
<line x1="288" y1="128" x2="324" y2="128" stroke="var(--ink-soft)" marker-end="url(#ev255a)"/>
<rect x="326" y="104" width="130" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="391" y="124" fill="var(--ink)" text-anchor="middle">大模型生成</text>
<text x="391" y="142" fill="var(--ink-soft)" text-anchor="middle" font-size="11">资料 + 问题 → 回答</text>
<line x1="456" y1="128" x2="492" y2="128" stroke="var(--ink-soft)" marker-end="url(#ev255a)"/>
<rect x="494" y="104" width="130" height="48" rx="4" fill="none" stroke="var(--rule)"/>
<text x="559" y="132" fill="var(--ink)" text-anchor="middle">回答</text>
<rect x="128" y="16" width="190" height="64" rx="4" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="223" y="38" fill="var(--compute)" text-anchor="middle">检索层评估</text>
<text x="223" y="56" fill="var(--ink-soft)" text-anchor="middle" font-size="11">该用的文章在不在 top-k</text>
<text x="223" y="72" fill="var(--ink-faint)" text-anchor="middle" font-size="11">规则判,几秒,不花钱</text>
<line x1="223" y1="80" x2="223" y2="104" stroke="var(--compute)" stroke-dasharray="3 3"/>
<rect x="330" y="180" width="294" height="64" rx="4" fill="none" stroke="var(--mem)" stroke-dasharray="4 3"/>
<text x="477" y="202" fill="var(--mem)" text-anchor="middle">生成层评估</text>
<text x="477" y="220" fill="var(--ink-soft)" text-anchor="middle" font-size="11">答对了吗 有依据吗 该拒答时拒答了吗</text>
<text x="477" y="236" fill="var(--ink-faint)" text-anchor="middle" font-size="11">要判语义,今天先用关键词凑合</text>
<line x1="477" y1="152" x2="477" y2="180" stroke="var(--mem)" stroke-dasharray="3 3"/>
</g>
</svg>
<figcaption>两层评估。检索层只看「该用的文章进没进 top-k」,纯代码就能判;生成层要判一句话的意思,今天先用查关键词凑合,Day 260 换成大模型当裁判。</figcaption>
</figure>

## 第一步:把检索和回答分开打印

想分两层判,第一件事是让程序把两层的东西分开交出来。Day 226 的 `rag_numpy.py` 是一口气检索完直接回答,中间拿到了哪几块只在函数里一闪而过。今天先把提示词挪到一个单独的文件,后面好几个脚本都要用同一份。

在 `agent-zero-lab/` 下新建 `part04/prompts.py`:

```python
# agent-zero-lab/part04/prompts.py  RAG 回答用的提示词,从 Day 227 的 rag_numpy.py 挪出来
from part04.chunking import Chunk

SYSTEM = """你是云簿 CloudLedger 的客服助手。
只根据 <资料> 里的内容回答用户问题,不要用你自己的常识补充 CloudLedger 的规则。
每一个事实性的句子后面,用方括号标注出处,例如 [kb-002#1]。一句话用到多块资料就都标上。
出处只能原样照抄 <doc> 标签里的 id,不要在后面再加编号。
如果资料里没有足够的信息回答,就直接说「帮助中心里没有找到这个问题的说明,建议转人工客服」,不要猜。
回答用简洁的中文,先给结论,再给条件和步骤。"""


def build_messages(question: str, chunks: list[Chunk], system: str = SYSTEM) -> list[dict]:
    docs = "\n\n".join(
        f'<doc id="{c.id}" title="{c.title}">\n{c.text}\n</doc>' for c in chunks
    )
    user = f"<资料>\n{docs}\n</资料>\n\n用户问题:{question}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
```

<div class="line-notes">

- `from part04.chunking import Chunk` `Chunk` 是 Day 224 切块时定义的 dataclass,字段有 `id`(形如 `kb-002#1`)、`doc_id`(`kb-002`)、`title`、`category`、`section`、`text`。这里只拿它做类型标注。
- `SYSTEM = """你是云簿 CloudLedger 的客服助手。` 三引号字符串可以跨行,相当于 JS 的反引号模板字符串去掉 `${}`。内容就是 Day 227 那版提示词,一字没改。
- `只根据 <资料> 里的内容回答用户问题` 这句和最后的「没找到就说没找到」是今天要考的两条规矩。后面会故意换一版不写这两句的提示词做对照。
- `如果资料里没有足够的信息回答,就直接说「帮助中心里没有找到这个问题的说明,建议转人工客服」` 把拒答的话术写死,好处是今天可以用「回答里有没有『没有找到』四个字」粗略判断模型有没有拒答。这招很粗,下面会看到它判错。
- `def build_messages(question: str, chunks: list[Chunk], system: str = SYSTEM) -> list[dict]:` 第三个参数有默认值,不传就用严格版 `SYSTEM`。传别的字符串进来,就能在不改代码的情况下换提示词做实验。
- `f'<doc id="{c.id}" title="{c.title}">\n{c.text}\n</doc>' for c in chunks` 每块资料包一层 `<doc>` 标签,id 写在标签上,模型标出处时照抄它。外面的 `"\n\n".join(...)` 用两个换行把各块隔开,相当于 JS 的 `chunks.map(...).join("\n\n")`。
- `user = f"<资料>\n{docs}\n</资料>\n\n用户问题:{question}"` 资料在前,问题在后。
- `return [{"role": "system", "content": system}, {"role": "user", "content": user}]` 标准的两条消息,`client.chat()` 直接吃这个列表。

</div>

再新建 `part04/rag_once.py`,跑一次完整的 RAG,但把「检索层拿到了什么」和「生成层答了什么」分两行打出来:

```python
# agent-zero-lab/part04/rag_once.py  跑一次完整 RAG,把「检索拿到了什么」和「模型答了什么」分开打印
import sys

from common.llm import LLMClient
from part04.prompts import build_messages
from part04.retrieve import retrieve

client = LLMClient()


def rag_once(question: str, k: int = 4, mode: str = "hybrid+rerank") -> tuple[list[str], str]:
    chunks = [c for c, _ in retrieve(question, k=k, mode=mode)]
    reply = client.chat(build_messages(question, chunks), temperature=0)
    return [c.id for c in chunks], reply.content


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "年付专业版用到第 3 个月想退,能退多少?"
    mode = sys.argv[2] if len(sys.argv) > 2 else "hybrid+rerank"
    k = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    ids, text = rag_once(q, k=k, mode=mode)
    print("问题:", q)
    print("检索层拿到:", ids)
    print("生成层回答:", text)
    print("---", client.ledger)
```

<div class="line-notes">

- `import sys` 要用 `sys.argv` 读命令行参数,[Day 44](/blog/agent-zero/day-044-notebook-project/) 学过,相当于 Node 的 `process.argv`,只是 Python 里 `sys.argv[0]` 就是脚本名,参数从 `[1]` 开始。
- `client = LLMClient()` 模块级建一个客户端,读 `.env` 里的 `LLM_*`。它的 `ledger` 会把这个进程里所有调用的 token 和钱累计起来。
- `def rag_once(question: str, k: int = 4, mode: str = "hybrid+rerank") -> tuple[list[str], str]:` 返回一个二元组:检索到的块 id 列表、模型的回答。返回值分成两样,正是今天的主题。
- `chunks = [c for c, _ in retrieve(question, k=k, mode=mode)]` `retrieve()` 返回 `[(Chunk, 分数), ...]`,这里用列表推导式只留 `Chunk`,分数用 `_` 扔掉。
- `reply = client.chat(build_messages(question, chunks), temperature=0)` `temperature=0` 让输出尽量稳定,评估时都这么设。[Day 112](/blog/agent-zero/day-112-sampling-2/) 实测过,DeepSeek 设成 0 也不保证每次一模一样,所以今天的格子偶尔会跳。
- `return [c.id for c in chunks], reply.content` 逗号分开的两个值会被打包成元组,相当于 JS 的 `return [ids, text]`。
- `q = sys.argv[1] if len(sys.argv) > 1 else "年付专业版用到第 3 个月想退,能退多少?"` 有第一个参数就用它当问题,没有就用默认问题。`A if 条件 else B` 是 Python 的三元表达式,相当于 `条件 ? A : B`。
- `k = int(sys.argv[3]) if len(sys.argv) > 3 else 4` 命令行传进来的都是字符串,要 `int()` 转一下。
- `ids, text = rag_once(q, k=k, mode=mode)` 元组解包,相当于 `const [ids, text] = ragOnce(...)`。
- `print("---", client.ledger)` 打印这次花了多少,格式是 `LLMClient` 自己定的。

</div>

在 `agent-zero-lab/` 目录下跑三道题(Postgres.app 要开着):

```bash
uv run python -m part04.rag_once "年付企业版第 3 个月想退,能退多少?"
uv run python -m part04.rag_once "买错了能把钱要回来吗"
uv run python -m part04.rag_once "有没有手机 App"
```

```text
问题: 年付企业版第 3 个月想退,能退多少?
检索层拿到: ['kb-002#1', 'kb-002#2', 'kb-002#3', 'kb-003#1']
生成层回答: 年付套餐中途取消按剩余整月数比例退款，已使用的月份和当前所在月份不退 [kb-002#1]。

具体到您的情况：第 3 个月中途取消，前 2 个月加当月共 3 个月不退，退剩余 9 个月 [kb-002#1]。但资料里只给了年付专业版 468 元（每月 39 元）的示例，没有企业版的价格，所以无法算出企业版的具体退款金额 [kb-002#1]。

申请方式：进入「设置 → 订阅 → 申请退款」，选择退款原因并提交，客服主管会在 1 个工作日内审批 [kb-003#1]。
--- 1 次调用 | 输入 440 / 输出 147 tokens | 约 ¥0.0016

问题: 买错了能把钱要回来吗
检索层拿到: ['kb-003#1', 'kb-002#4', 'kb-002#3', 'kb-003#2']
生成层回答: 可以申请退款，但需要客服主管审批，审批通过后才会原路退回。[kb-003#1][kb-002#4]

条件和步骤：
1. 进入「设置 → 订阅 → 申请退款」，选择退款原因并提交。[kb-003#1]
2. 客服主管会在 1 个工作日内审批。[kb-003#1]
3. 审批通过后进入退款流程，原路退回：支付宝 1 到 3 个工作日到账，银行卡 3 到 7 个工作日到账。[kb-002#4]
4. 如果这笔订单已经开具发票，需要先申请发票红冲（作废），红冲完成后才能退款；电子普通发票红冲一般当天完成，增值税专用发票需要你方配合退回或开具红字信息表。[kb-003#2]

另外，如果是同一笔订阅被重复扣款，核实后全额退还重复的那一笔，3 个工作日内原路退回。[kb-002#3]
--- 1 次调用 | 输入 417 / 输出 213 tokens | 约 ¥0.0020

问题: 有没有手机 App
检索层拿到: ['kb-016#1', 'kb-018#2', 'kb-020#1', 'kb-015#2']
生成层回答: 帮助中心里没有找到这个问题的说明,建议转人工客服。
--- 1 次调用 | 输入 354 / 输出 14 tokens | 约 ¥0.0006
```

三道题,三种情况,分两行一看就清楚。

第一题,检索层拿到的 4 块全是 kb-002 和 kb-003,没有 kb-001。企业版的价格 1908 元写在 kb-001 里,模型手里根本没有这个数。它说「算不出来」反而是对的:资料不够就说不够,没有自己编一个价格。这道题**错在检索层**,改提示词救不了。

第二题,文章对了一半。kb-002 拿到了,可拿到的是第 3、4 块(重复扣款、审批与到账),真正回答「买错了能不能退」的是第 1 块(年付按剩余整月退)和第 2 块(月付不退)。模型拿着一堆「怎么申请」的资料,答出来一篇申请流程,没回答「能不能退」。这道题按文章算检索是对的,按块算是错的,后面练习 1 会专门看这个。

第三题,帮助中心里压根没有手机 App 的说明。检索层照样会返回 4 块,它不会说「没有」,只会返回最像的 4 块(两步验证里有「验证器 App」几个字,就被捞上来了)。模型老老实实说了没找到。这种题叫**无答案题**,检索层没有标准答案可比,只考生成层会不会拒答。

## 两层各管什么,为什么先看检索层

把上面三道题的观察整理一下,两层评估各自回答的问题是:

**检索层**:答这道题要用的资料,在不在 top-k 里?要判它,只需要事先标好「每道题的答案在哪几篇文章」,然后拿检索结果和标注比一比,纯代码,不用调大模型(embedding 和 rerank 是检索本身要调的,不算评估的钱)。跑一遍几秒,结果每次都一样。所以检索层的实验可以做得很勤:换切块大小、换 k、加不加 rerank,改完马上跑。

**生成层**:资料给到了,模型答得对不对、每句话有没有依据、该说「不知道」的时候说了没有?这要判一句话的意思,规则判不准,得人看,或者让另一个大模型当裁判(Day 260)。要先调一次模型生成,再调一次模型打分,慢,花钱,裁判自己还会判错。

两层的先后很自然:**先把检索层调好,再看生成层**。检索没拿到资料的题,生成层分数怎么都高不了,在这种题上调提示词是白费功夫。反过来,检索层分数很高、端到端还是差,那就该去看提示词和模型了。

还有一种格子初学者容易漏:检索没拿到资料,模型却「答对了」。听着是好事,其实是隐患,说明模型在用自己的常识答题,今天碰巧对,换一条 CloudLedger 自己定的规则就会错。练习 2 会造一个出来看。

把两层的结果交叉,每道题会落进四个格子之一,再加上无答案题单独一格:

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="四个格子:检索对且生成对是都对;检索对生成错是生成错,去改提示词或模型;检索错生成错是检索错,去改切块和检索;检索错生成对是检索漏了但答对,模型在用常识,是隐患;无答案题单独判拒答">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="300" y="24" fill="var(--ink-soft)" text-anchor="middle">生成层:回答对吗</text>
<text x="210" y="46" fill="var(--ink-soft)" text-anchor="middle">对</text>
<text x="400" y="46" fill="var(--ink-soft)" text-anchor="middle">错</text>
<text x="40" y="104" fill="var(--ink-soft)" text-anchor="middle">检索层</text>
<text x="40" y="120" fill="var(--ink-soft)" text-anchor="middle">对</text>
<text x="40" y="184" fill="var(--ink-soft)" text-anchor="middle">检索层</text>
<text x="40" y="200" fill="var(--ink-soft)" text-anchor="middle">错</text>
<rect x="116" y="56" width="188" height="76" rx="4" fill="none" stroke="var(--rule)"/>
<text x="210" y="88" fill="var(--ink)" text-anchor="middle">都对</text>
<text x="210" y="108" fill="var(--ink-faint)" text-anchor="middle" font-size="11">什么都不用改</text>
<rect x="306" y="56" width="188" height="76" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="400" y="88" fill="var(--ink)" text-anchor="middle">生成错</text>
<text x="400" y="108" fill="var(--ink-soft)" text-anchor="middle" font-size="11">改提示词、换模型</text>
<rect x="116" y="136" width="188" height="76" rx="4" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="210" y="168" fill="var(--ink)" text-anchor="middle">检索漏了但答对</text>
<text x="210" y="188" fill="var(--ink-soft)" text-anchor="middle" font-size="11">模型靠常识蒙,隐患</text>
<rect x="306" y="136" width="188" height="76" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="400" y="168" fill="var(--ink)" text-anchor="middle">检索错</text>
<text x="400" y="188" fill="var(--ink-soft)" text-anchor="middle" font-size="11">改切块、k、检索方式</text>
<rect x="508" y="96" width="120" height="76" rx="4" fill="none" stroke="var(--ink-faint)" stroke-dasharray="2 3"/>
<text x="568" y="128" fill="var(--ink)" text-anchor="middle">无答案题</text>
<text x="568" y="148" fill="var(--ink-faint)" text-anchor="middle" font-size="11">只判拒答 ✓/✗</text>
<text x="320" y="244" fill="var(--ink-faint)" text-anchor="middle" font-size="11">琥珀色格子去修检索,蓝色格子去修生成</text>
</g>
</svg>
<figcaption>两层交叉出四个格子。端到端只看得到「右边两格加起来有几道」,分了层才知道每道错题该交给谁修。</figcaption>
</figure>

## 第二步:6 道题 × 3 套配置,把每道题归进格子

光看三道题还说明不了「分层有用」。下面做个小实验:挑 6 道题,跑三套配置,每套都算端到端答对几道,再看每道题落在哪个格子。

三套配置故意各坏一处:

- A:今天的标准配置,混合检索 + rerank,k=4,严格提示词。
- B:检索变差,只用 BM25,k=2,提示词不变。
- C:检索不变,提示词换成一版宽松的:「参考资料回答,语气热情,尽量给用户一个明确的答案」,不说只能用资料、也不说没找到要拒答。

6 道题每道我事先标了两样东西:答案在哪几篇文章(检索层用),回答里必须出现的一个词(生成层用,很粗,先凑合)。比如企业版那题必须出现 1431,手机 App 那题必须出现「没有找到」。

新建 `part04/two_layers.py`:

```python
# agent-zero-lab/part04/two_layers.py  同 6 道题跑三套配置,每题分别判「检索层」和「生成层」,再归到四个格子里
from common.llm import LLMClient
from part04.prompts import SYSTEM, build_messages
from part04.retrieve import retrieve

LOOSE = "你是云簿 CloudLedger 的客服助手。参考 <资料> 回答用户问题,语气热情,尽量给用户一个明确的答案。"

# (问题, 答案在哪几篇文章, 回答里必须出现的词)
CASES = [
    ("年付企业版第 3 个月想退,能退多少?", {"kb-001", "kb-002"}, ["1431"]),
    ("买错了能把钱要回来吗", {"kb-002"}, ["月付"]),
    ("外币的账怎么记", {"kb-020"}, ["多币种"]),
    ("老板想看所有账但不能让他改", {"kb-015"}, ["只读"]),
    ("E1043 怎么解决", {"kb-011"}, ["UTF-8"]),
    ("有没有手机 App", set(), ["没有找到"]),
]
CONFIGS = [
    ("A 混合+rerank k=4", "hybrid+rerank", 4, SYSTEM),
    ("B 只用BM25 k=2", "bm25", 2, SYSTEM),
    ("C 混合+rerank 宽松提示词", "hybrid+rerank", 4, LOOSE),
]
client = LLMClient()


def judge(retrieval_ok: bool | None, answer_ok: bool) -> str:
    if retrieval_ok is None:
        return "无答案题" + ("✓" if answer_ok else "✗")
    if retrieval_ok and answer_ok:
        return "都对"
    if retrieval_ok:
        return "生成错"
    if answer_ok:
        return "检索漏了但答对"
    return "检索错"


if __name__ == "__main__":
    for name, mode, k, system in CONFIGS:
        print(f"== {name}")
        end_to_end = 0
        for question, expected, must in CASES:
            chunks = [c for c, _ in retrieve(question, k=k, mode=mode)]
            got = {c.doc_id for c in chunks}
            retrieval_ok = expected <= got if expected else None
            reply = client.chat(build_messages(question, chunks, system), temperature=0)
            answer_ok = all(w in reply.content for w in must)
            end_to_end += answer_ok
            print(f"  {judge(retrieval_ok, answer_ok):<8} {question}  拿到 {sorted(got)}")
        print(f"  端到端答对 {end_to_end}/{len(CASES)}")
    print("---", client.ledger)
```

<div class="line-notes">

- `LOOSE = "你是云簿 CloudLedger 的客服助手。参考 <资料> 回答用户问题,语气热情,尽量给用户一个明确的答案。"` 宽松提示词。和 `SYSTEM` 比,少了「只根据资料」「没找到就说没找到」两句,多了「尽量给明确答案」。很多线上客服机器人的提示词就长这样。
- `("年付企业版第 3 个月想退,能退多少?", {"kb-001", "kb-002"}, ["1431"]),` 每道题是一个三元组。第二项是**集合**,写成 `{"kb-001", "kb-002"}`,因为后面要做「是不是子集」的判断;第三项是列表,可以放好几个必须出现的词。1431 = 1908 ÷ 12 × 9。
- `("有没有手机 App", set(), ["没有找到"]),` 无答案题,答案文章是空集合。空集合必须写 `set()`,写 `{}` 得到的是空字典([Day 25](/blog/agent-zero/day-025-sets/) 讲过)。
- `("A 混合+rerank k=4", "hybrid+rerank", 4, SYSTEM),` 一套配置四个字段:名字、检索模式、k、提示词。实验的变量都写在这张表里,主循环一行都不用改。
- `def judge(retrieval_ok: bool | None, answer_ok: bool) -> str:` 把两层的判断归进格子。`bool | None` 表示这个参数可以是 `True`、`False` 或 `None` 三种,相当于 TS 的 `boolean | null`。`None` 专门留给无答案题:没有标准文章,谈不上检索对错。
- `if retrieval_ok is None:` 判断是不是 `None` 要用 `is None`,不要写 `== None`,也不能写 `if not retrieval_ok`(那样 `False` 也会进来)。
- `return "无答案题" + ("✓" if answer_ok else "✗")` 无答案题只看生成层:拒答了是 ✓。
- `if retrieval_ok:` 走到这里说明「检索对、生成错」,因为都对的情况上一行已经返回了。四个 `if` 按顺序排,每个只需要写一个条件。
- `for name, mode, k, system in CONFIGS:` 每套配置解包成四个变量。
- `end_to_end = 0` 端到端答对的题数,也就是不分层时你唯一能看到的数字。
- `got = {c.doc_id for c in chunks}` 集合推导式,把 4 块变成它们来自哪几篇文章。同一篇的两块会合成一个。第一题实测 `{'kb-002', 'kb-003'}`。
- `retrieval_ok = expected <= got if expected else None` 两件事写在一行。`expected <= got` 是集合的「子集」判断:`expected` 里每一篇都在 `got` 里才是 `True`。第一题 `{'kb-001', 'kb-002'} <= {'kb-002', 'kb-003'}` 是 `False`,因为缺 kb-001。后面的 `if expected else None`:`expected` 是空集合时直接给 `None`。为什么要多这一截,下一节专门演示。
- `reply = client.chat(build_messages(question, chunks, system), temperature=0)` 同一批块,传哪版提示词由配置决定。
- `answer_ok = all(w in reply.content for w in must)` `all(...)` 里面每个都为真才返回 `True`,相当于 JS 的 `must.every(w => reply.content.includes(w))`。`w in 字符串` 是子串判断。
- `end_to_end += answer_ok` 布尔值能直接加:`True` 当 1,`False` 当 0。实测 `True + True + False` 是 `2`。
- `print(f"  {judge(retrieval_ok, answer_ok):<8} {question}  拿到 {sorted(got)}")` `:<8` 是 f-string 的格式说明,左对齐、占 8 个字符宽,让几列对齐。`sorted(got)` 把集合排成有序列表再打印,不然每次顺序可能不一样。

</div>

```bash
uv run python -m part04.two_layers
```

```text
== A 混合+rerank k=4
  检索错      年付企业版第 3 个月想退,能退多少?  拿到 ['kb-002', 'kb-003']
  生成错      买错了能把钱要回来吗  拿到 ['kb-002', 'kb-003']
  都对       外币的账怎么记  拿到 ['kb-009', 'kb-020']
  都对       老板想看所有账但不能让他改  拿到 ['kb-001', 'kb-007', 'kb-015', 'kb-018']
  都对       E1043 怎么解决  拿到 ['kb-010', 'kb-011', 'kb-016']
  无答案题✓    有没有手机 App  拿到 ['kb-015', 'kb-016', 'kb-018', 'kb-020']
  端到端答对 4/6
== B 只用BM25 k=2
  都对       年付企业版第 3 个月想退,能退多少?  拿到 ['kb-001', 'kb-002']
  检索错      买错了能把钱要回来吗  拿到 []
  检索错      外币的账怎么记  拿到 ['kb-002', 'kb-003']
  检索错      老板想看所有账但不能让他改  拿到 ['kb-002', 'kb-008']
  都对       E1043 怎么解决  拿到 ['kb-011']
  无答案题✓    有没有手机 App  拿到 ['kb-016']
  端到端答对 3/6
== C 混合+rerank 宽松提示词
  检索错      年付企业版第 3 个月想退,能退多少?  拿到 ['kb-002', 'kb-003']
  生成错      买错了能把钱要回来吗  拿到 ['kb-002', 'kb-003']
  都对       外币的账怎么记  拿到 ['kb-009', 'kb-020']
  都对       老板想看所有账但不能让他改  拿到 ['kb-001', 'kb-007', 'kb-015', 'kb-018']
  都对       E1043 怎么解决  拿到 ['kb-010', 'kb-011', 'kb-016']
  无答案题✗    有没有手机 App  拿到 ['kb-015', 'kb-016', 'kb-018', 'kb-020']
  端到端答对 3/6
--- 18 次调用 | 输入 5762 / 输出 1689 tokens | 约 ¥0.0200
```

18 次调用花了两分钱。我跑了两遍,第一遍 A 的「外币」那题多拿到一篇 kb-001,格子一样;其余完全相同。

先只看每套最后一行,假装你只有端到端分数:A 4/6,B 3/6,C 3/6。你会得出「B 和 C 一样差」的结论,下一步大概是两个都随手调一调。

现在看格子。B 的三道错题全是「检索错」:「买错了能把钱要回来吗」BM25 一块都没拿到(问题里的词「买错」「要回来」在帮助中心里一个都没有,BM25 只认字面,分数全是 0);「外币」「老板」两题拿到的都是不相干的文章。B 的病在检索层,该做的是把向量检索加回来、把 k 调大。C 的检索结果和 A 一模一样,唯一多错的一道是无答案题,病在生成层,该做的是把提示词改回去。**两套分数相同的配置,修法正好相反。**

再看 A 自己的两道错题。企业版那题是「检索错」,和第一步看到的一样,缺 kb-001。「买错了」那题被判成「生成错」,可第一步我们看到,拿到的是 kb-002 的第 3、4 块,答「能不能退」的第 1、2 块不在里面。按文章判,检索层算对;按块判,其实是检索错。判检索层用文章还是用块,是评估设计时要做的选择,练习 1 会两种都算一遍。

## 故意踩一次坑:空集合是任何集合的子集

上面那行 `retrieval_ok = expected <= got if expected else None`,后半截看着多余。删掉它,直接写 `retrieval_ok = expected <= got` 会怎样?写个小脚本看看,新建 `part04/subset_trap.py`:

```python
# agent-zero-lab/part04/subset_trap.py  空集合是任何集合的子集:无答案题会被误判成「检索对了」
from part04.two_layers import judge

got = {"kb-015", "kb-016", "kb-018", "kb-020"}  # 「有没有手机 App」实际拿到的四篇
expected: set[str] = set()                       # 帮助中心里没有答案

naive = expected <= got
print("set() <= got:", naive)
print("天真写法归到:", judge(naive, False))
print("正确写法归到:", judge(expected <= got if expected else None, False))
```

<div class="line-notes">

- `from part04.two_layers import judge` 直接复用上一步的 `judge()`。`two_layers.py` 的实验代码都在 `if __name__ == "__main__":` 下面,被 import 时不会跑,不花钱(模块顶上那行 `LLMClient()` 只是建对象,不发请求)。
- `got = {"kb-015", "kb-016", "kb-018", "kb-020"}` 配置 C 下手机 App 那题实际拿到的四篇,从上面的输出抄来。
- `expected: set[str] = set()` 无答案题的标注。`: set[str]` 是给编辑器看的类型标注,空集合不写的话 basedpyright 推不出里面装什么。
- `naive = expected <= got` 天真写法。数学上空集是任何集合的子集,Python 照这个规矩来,结果是 `True`。
- `print("天真写法归到:", judge(naive, False))` 假装模型没拒答(`answer_ok=False`),看它被归到哪格。
- `print("正确写法归到:", judge(expected <= got if expected else None, False))` 空集合在 `if` 里算假,走到 `else None`。

</div>

```bash
uv run python -m part04.subset_trap
```

```text
set() <= got: True
天真写法归到: 生成错
正确写法归到: 无答案题✗
```

天真写法下,无答案题会被算成「检索对了」,模型编了话也只记一个「生成错」,和普通的生成错混在一起,而且每道无答案题都白白给检索层加了一分。这个坑不报错,数字看着还挺好看,所以特别难发现。Day 256 算 recall 时还会遇到它的兄弟:空集合当分母,那次是真的会报错。

## 第三步:关键词判生成,有多粗

再回头看配置 C 那道「无答案题✗」。它到底说了什么?把它单独打出来是练习之外很值得做的一步,我把代码和输出放在这里。新建 `part04/ex255_1.py`:

```python
# agent-zero-lab/part04/ex255_1.py  把配置 C 下「有没有手机 App」的检索结果和回答原样打出来
from part04.prompts import build_messages
from part04.retrieve import retrieve
from part04.two_layers import LOOSE, client

q = "有没有手机 App"
chunks = [c for c, _ in retrieve(q, k=4)]
for c in chunks:
    print(c.id, c.text.replace("\n", " | ")[:60])
reply = client.chat(build_messages(q, chunks, LOOSE), temperature=0)
print("回答:", reply.content)
```

<div class="line-notes">

- `from part04.two_layers import LOOSE, client` 宽松提示词和客户端都从上一步拿。
- `chunks = [c for c, _ in retrieve(q, k=4)]` 不传 `mode` 就是默认的 `hybrid+rerank`,和配置 C 一样。
- `print(c.id, c.text.replace("\n", " | ")[:60])` 每块只打前 60 个字,换行替换成 ` | ` 让一块占一行。`[:60]` 是字符串切片([Day 15](/blog/agent-zero/day-015-strings-1/))。
- `reply = client.chat(build_messages(q, chunks, LOOSE), temperature=0)` 第三个参数传 `LOOSE`。

</div>

```bash
uv run python -m part04.ex255_1
```

```text
kb-016#1 账号安全与两步验证 > 两步验证 | 支持短信验证码和验证器 App 两种方式,建议开启。
kb-018#2 数据安全与备份 > 备份 | 每天自动备份,备份保留 30 天。 | 企业版客户误删数据后,可以申请从备份恢复,每次收费
kb-020#1 多币种记账 > 支持范围 | 专业版和企业版支持多币种记账,共支持 30 种货币。
kb-015#2 团队成员与权限 > 人数上限 | 免费版只有 1 名成员,专业版最多 3 名,企业版不限。
回答: 您好！关于手机 App 的问题，我这边资料里暂时没有明确提到云簿是否有独立的手机 App，所以没法给您一个确切的答复，实在抱歉～

不过可以告诉您的是，云簿支持**短信验证码**和**验证器 App** 两种两步验证方式，建议您开启以保障账号安全。如果您想确认 App 的具体情况，建议您联系人工客服或查看官网获取最新信息哦！还有其他问题随时问我～
```

它其实拒答了:「资料里暂时没有明确提到」「建议您联系人工客服」。只是没用我们写死的那句「没有找到」,关键词判定就给了 ✗。这是一次**误判**,而且误判的方向是冤枉了模型。

那宽松提示词就没问题了吗?我又加了两道无答案题跑 A 和 C(就是练习 3),C 在「你们公司在哪个城市」上答的是「我们公司位于**杭州**哦」。帮助中心只写了「数据存储在杭州的数据中心」,公司在哪根本没写,模型把数据中心的城市安成了公司地址。这才是客服场景最怕的事:编一个听起来合理的事实。关键词判定碰巧也给了 ✗,但它是蒙对的,它分不出「换了个说法的拒答」和「编了个答案」。

所以关键词只能凑合今天这个小实验。真正的生成层要分三件事判:答案对不对(**完整**)、每句话在资料里有没有依据(**忠实**)、资料不够时有没有老实说不知道(**拒答**)。这三件事都要读懂意思才判得了,Day 260 会让大模型当裁判来判。

## 今天的代码放在哪

| 文件 | 今天新建/改动 | 干什么 |
| --- | --- | --- |
| `part04/prompts.py` | 新建(从 Day 227 挪出) | `SYSTEM` 严格提示词、`build_messages()` |
| `part04/rag_once.py` | 新建 | 跑一次 RAG,检索和回答分开打印 |
| `part04/two_layers.py` | 新建 | 6 题 × 3 配置,`judge()` 归格子 |
| `part04/subset_trap.py` | 新建 | 空集合子集的坑 |
| `part04/ex255_1.py` | 新建 | 看配置 C 手机 App 那题的原话 |

Day 256 会在这几个文件的基础上写 `part04/metrics.py`,把「在不在 top-k」这一个是非题,细化成三个能比大小的数。

## 动手练习

**练习 1:检索层按块判。** 「买错了能把钱要回来吗」这题,答案真正在 kb-002 的第 1 块(年付怎么退)和第 2 块(月付不退)。写 `part04/ex255_2.py`,对配置 A 分别按文章、按块判检索层,看它被归到哪一格。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex255_2.py  练习 1:检索层改成按「块」判,看「买错了」那题会被归到哪一格
from part04.prompts import build_messages
from part04.retrieve import retrieve
from part04.two_layers import client, judge

q = "买错了能把钱要回来吗"
expected_chunks = {"kb-002#1", "kb-002#2"}  # 年付怎么退、月付不退,这两块才答得了「能不能」
chunks = [c for c, _ in retrieve(q, k=4)]
got = {c.id for c in chunks}
doc_ok = {"kb-002"} <= {c.doc_id for c in chunks}
chunk_ok = expected_chunks <= got
answer_ok = "月付" in client.chat(build_messages(q, chunks), temperature=0).content
print("拿到的块:", sorted(got))
print("按文章判:", judge(doc_ok, answer_ok))
print("按块判:  ", judge(chunk_ok, answer_ok))
```

<div class="line-notes">

- `expected_chunks = {"kb-002#1", "kb-002#2"}` 标到块一级。块 id 是 Day 224 切块时按「文章 id + # + 第几块」生成的,kb-002 一共 4 块。
- `got = {c.id for c in chunks}` 这次收集的是块 id,不是文章 id。实测 `{'kb-002#3', 'kb-002#4', 'kb-003#1', 'kb-003#2'}`。
- `doc_ok = {"kb-002"} <= {c.doc_id for c in chunks}` 按文章判:kb-002 在不在。在,`True`。
- `chunk_ok = expected_chunks <= got` 按块判:#1 和 #2 都不在,`False`。
- `answer_ok = "月付" in client.chat(build_messages(q, chunks), temperature=0).content` 调用和取 `.content` 连着写,只调一次模型。

</div>

```text
拿到的块: ['kb-002#3', 'kb-002#4', 'kb-003#1', 'kb-003#2']
按文章判: 生成错
按块判:   检索错
```

同一道题,换一种标法,就从「去改提示词」变成了「去改检索」。按块标更准,但标注成本高得多:文章改一次、切块参数改一次,块 id 就全变了,标注要重做。所以大多数团队按文章标(Day 257 的评估集也按文章标),再靠多篇文章的召回率、排第几(Day 256)和人工看错题来补这个洞。

</details>

**练习 2:不给资料,模型会不会蒙对?** 拿「Excel 存的 csv 传上去说格式不对,好像是乱码」这题,资料传空列表,分别用严格和宽松两版提示词问一次,看回答里有没有 UTF-8。写 `part04/ex255_3.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex255_3.py  练习 2:不给资料,看模型会不会靠常识「蒙对」
from part04.prompts import build_messages
from part04.two_layers import LOOSE, SYSTEM, client

q = "Excel 存的 csv 传上去说格式不对,好像是乱码"
for name, system in [("严格提示词", SYSTEM), ("宽松提示词", LOOSE)]:
    reply = client.chat(build_messages(q, [], system), temperature=0)
    print(f"[{name}] 含 UTF-8: {'UTF-8' in reply.content}")
    print("  ", reply.content.replace("\n", " ")[:200])
print("---", client.ledger)
```

<div class="line-notes">

- `reply = client.chat(build_messages(q, [], system), temperature=0)` 资料传空列表,模拟「检索一块都没拿到」。`<资料>` 标签里就是空的。
- `print(f"[{name}] 含 UTF-8: {'UTF-8' in reply.content}")` f-string 里面又用了引号,外层是双引号,里层就用单引号,不然会提前结束字符串。
- `print("  ", reply.content.replace("\n", " ")[:200])` 只看前 200 个字。

</div>

```text
[严格提示词] 含 UTF-8: False
   帮助中心里没有找到这个问题的说明,建议转人工客服。
[宽松提示词] 含 UTF-8: True
   您好！这个问题很常见，别担心，我来帮您解决～  Excel 保存的 CSV 默认是 **GBK 编码**，而系统一般要求 **UTF-8 编码**，所以上传后会出现乱码、提示格式不对。  **解决方法（推荐第一种）：**  1. **用记事本另存为 UTF-8**    - 用 Excel 打开文件 → 另存为 → 选择「CSV（逗号分隔）」保存    - 再用**记事本**打开这个 CSV → 
--- 2 次调用 | 输入 214 / 输出 284 tokens | 约 ¥0.0027
```

宽松提示词一块资料都没有,照样答出了 UTF-8,还很详细,这就是四格里的「检索漏了但答对」。它碰巧对,是因为 Excel 的编码问题是公开常识;可它推荐的「用记事本另存」帮助中心里没写,帮助中心写的是「另存为 CSV UTF-8(逗号分隔)或直接传 XLSX」。换一条 CloudLedger 自己的规则(比如退款比例),常识就会答错。严格提示词这时候选择拒答,是对的。

</details>

**练习 3:再加两道无答案题。** 「能用 PayPal 付款吗」「你们公司在哪个城市」,只跑配置 A 和 C,把回答前 120 个字也打出来,逐条判断关键词判得对不对。写 `part04/ex255_4.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex255_4.py  练习 3:加两道无答案题,只跑配置 A 和 C
from part04.prompts import SYSTEM, build_messages
from part04.retrieve import retrieve
from part04.two_layers import LOOSE, client, judge

NEW = [
    ("能用 PayPal 付款吗", set(), ["没有找到"]),
    ("你们公司在哪个城市", set(), ["没有找到"]),
]
for name, system in [("A 严格提示词", SYSTEM), ("C 宽松提示词", LOOSE)]:
    print(f"== {name}")
    for question, expected, must in NEW:
        chunks = [c for c, _ in retrieve(question, k=4)]
        reply = client.chat(build_messages(question, chunks, system), temperature=0)
        ok = all(w in reply.content for w in must)
        print(f"  {judge(None, ok)}  {question}  拿到 {sorted(c.id for c in chunks)}")
        print("    ", reply.content.replace("\n", " ")[:120])
print("---", client.ledger)
```

<div class="line-notes">

- `("能用 PayPal 付款吗", set(), ["没有找到"]),` 和 `CASES` 同样的三元组格式,以后想并进去直接粘。
- `for question, expected, must in NEW:` `expected` 这里用不上(都是空集合),解包时还是要写一个变量接住,不然个数对不上会报错。
- `print(f"  {judge(None, ok)}  {question}  拿到 {sorted(c.id for c in chunks)}")` 无答案题直接给 `judge` 传 `None`。`sorted(c.id for c in chunks)` 括号里是生成器表达式,`sorted` 能直接吃。

</div>

```text
== A 严格提示词
  无答案题✓  能用 PayPal 付款吗  拿到 ['kb-002#4', 'kb-008#1', 'kb-013#2', 'kb-020#1']
     帮助中心里没有找到这个问题的说明,建议转人工客服。
  无答案题✗  你们公司在哪个城市  拿到 ['kb-001#1', 'kb-001#2', 'kb-018#1', 'kb-018#2']
     根据帮助中心资料，CloudLedger 的数据存储在中国大陆杭州的数据中心 [kb-018#1]。资料中没有说明公司所在城市，建议转人工客服。
== C 宽松提示词
  无答案题✗  能用 PayPal 付款吗  拿到 ['kb-002#4', 'kb-008#1', 'kb-013#2', 'kb-020#1']
     您好！关于 PayPal 付款的问题，目前我手头的资料里没有提到支持 PayPal 支付哦。资料中提到的支付方式有银行卡和支付宝，如果您在支付时遇到失败（错误码 E3001），建议更换银行卡或改用支付宝支付。  如果您想确认是否支持 Pay
  无答案题✗  你们公司在哪个城市  拿到 ['kb-001#1', 'kb-001#2', 'kb-018#1', 'kb-018#2']
     我们公司位于**杭州**哦～我们的所有数据也都存储在中国大陆杭州的数据中心，传输全程 TLS 加密，安全有保障。还有什么想了解的吗？😊
--- 4 次调用 | 输入 1512 / 输出 164 tokens | 约 ¥0.0038
```

四个判定,人看一遍:

| 配置 | 题 | 关键词判 | 人判 |
| --- | --- | --- | --- |
| A | PayPal | ✓ | ✓ |
| A | 公司城市 | ✗ | ✓(说了没写,建议转人工,还给了相关信息) |
| C | PayPal | ✗ | ✓(说了没提到,给了替代方案) |
| C | 公司城市 | ✗ | ✗(编了「公司位于杭州」) |

关键词判对 2 个,判错 2 个,错的两个都是冤枉了模型。4 个里错一半,这样的裁判拿去比较配置是不行的,Day 260 换掉它。

</details>

**练习 4(思考题):** 有人说「检索层只要看端到端准确率就行,端到端对了说明检索肯定对了」。用今天的输出举一个反例。

<details><summary>参考答案</summary>

练习 2 就是反例:资料一块都没给,宽松提示词照样答出了 UTF-8,端到端判定是对的,检索层其实什么都没拿到。反过来也有:配置 A 的企业版那题端到端错了,可模型的表现是对的(资料不够就说算不出),错全在检索层。端到端的对错和检索的对错是两件事,只看一个会把另一个的问题藏起来。

</details>

**验收标准:** `two_layers.py` 跑通,三套配置的格子你能逐行解释;能说出 B 和 C 端到端都是 3/6,但一个该修检索、一个该修提示词;练习 3 的四个判定你自己人判过一遍,知道关键词判定为什么不够用。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 检索层(retrieval) | RAG 的第一段:从知识库里找出最相关的 k 块资料。评估时看「该用的资料进没进 top-k」 |
| 生成层(generation) | RAG 的第二段:模型拿着资料回答。评估时看回答对不对、有没有依据、该拒答时拒答没有 |
| 端到端评估(end-to-end) | 只看最后的回答对不对,不管中间哪一段出的错。今天 A 4/6、B 3/6、C 3/6 就是端到端分数 |
| 标注(label) | 事先人工写好的「标准答案」,比如每道题的答案在哪几篇文章(`expected`) |
| 无答案题(unanswerable) | 知识库里没有答案的题,比如「有没有手机 App」。不算检索分,只考模型会不会拒答 |
| 拒答(refusal) | 资料不够时老实说「没找到」或转人工,不编答案 |
| 忠实(faithfulness) | 回答里每句话都能在给的资料里找到依据。「公司位于杭州」就是不忠实 |
| 子集(subset) | 集合 A 的每个元素都在 B 里,写作 `A <= B`。空集合是任何集合的子集 |
| 误判 | 评估方法给出的结论和人判不一致,今天关键词判定 4 个错 2 个 |

## 常见误区

**只看端到端分数。** 今天 B 和 C 都是 3/6,一个 3 道检索错,一个在无答案题上出事。只看总分,你会给两个都用同一个修法。

**无答案题直接用 `expected <= got`。** 空集合是任何集合的子集,结果永远是 `True`,无答案题会被算成「检索对了」,不报错,分数还变好看。先判 `if expected`。

**以为检索层「没有答案」时会返回空。** 向量检索和 rerank 永远返回最像的 k 块,问手机 App 照样给你 4 块两步验证、备份、多币种。判断「帮助中心里有没有」是生成层的事。只有 BM25 在一个词都对不上时会返回空列表(「买错了能把钱要回来吗」)。

**按文章判检索就以为万事大吉。** 「买错了」那题文章拿对了,块拿错了,模型只能答申请流程。按文章标是省事的折中,知道它有这个洞。

**用关键词判生成层。** 今天 4 个无答案题判定错了 2 个,都是模型换了个说法拒答被判成 ✗。小实验凑合可以,拿来做决定不行。

**跑评估时 Postgres 没开。** `retrieve.py` 一 import 就连数据库,Postgres.app 没开,或者 `.env` 里的库名写错,报的是这一长串(我把库名故意写错 `w255evl` 跑出来的):

```text
psycopg.OperationalError: connection failed: connection to server at "127.0.0.1", port 5432 failed: FATAL:  database "w255evl" does not exist
Multiple connection attempts failed. All failures were:
- host: 'localhost', port: '5432', hostaddr: '::1': connection failed: connection to server at "::1", port 5432 failed: FATAL:  database "w255evl" does not exist
```

看最后的 `database "..." does not exist` 就知道是库名不对;如果是 `Connection refused`,就是 Postgres.app 没开。

## 学习资料

### 文档与文章

- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):为什么评估是 AI 产品迭代的核心,今天先读前半部分(评估的三个层次),建立「先量再改」的习惯,30 分钟。
- [Jason Liu · Systematically Improving Your RAG](https://jxnl.co/writing/2024/05/22/systematically-improving-your-rag/):讲先把检索评估做起来、按问题类型拆开看,和今天「先修检索层」是一个思路,1 小时。
- [Evidently AI · A complete guide to RAG evaluation](https://www.evidentlyai.com/llm-guide/rag-evaluation):把检索指标和生成指标分开整理的一篇指南,今天看它开头的两层划分和那张总图。
- [Ragas: Automated Evaluation of Retrieval Augmented Generation(arXiv 2309.15217)](https://arxiv.org/abs/2309.15217):RAGAS 论文,读第 1、2 节,看它怎么把 faithfulness、answer relevance、context relevance 分开,Day 261 会用到。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1b69gB5E3h&autoplay=0&high_quality=1" title="面试官问:如何评估RAG系统的效果?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI深度幻觉 · 面试官问:如何评估RAG系统的效果? · 12 分钟,从面试回答的角度梳理 RAG 评估。看完对照今天的四个格子,试着用「检索层/生成层」重新组织一遍答案。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1MBn1z2Emi&autoplay=0&high_quality=1" title="做RAG两年 我总结出最好的RAG测试方法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Beep_Beep_Sheep · 做RAG两年 我总结出最好的RAG测试方法 · 不到 3 分钟,一个做过项目的人讲怎么测 RAG,短,适合今天收尾时看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RrDBV6odPKo" title="Systematically improving RAG applications" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · Systematically improving RAG applications · 英文,69 分钟,Hamel 和 Jason Liu 对谈怎么用评估驱动 RAG 迭代。前 30 分钟讲为什么先评检索,开自动字幕。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 3 章「Evaluation Methodology」:评估方法论讲得最系统的一本书,今天只读开头讲「为什么评估难」和「端到端 vs 分组件」的部分,约 40 分钟。

### 开源项目与代码

- [explodinggradients/ragas](https://github.com/explodinggradients/ragas):RAGAS 源码,先看 README 里的指标列表,数一数哪些是检索层的、哪些是生成层的。
- [datawhalechina/llm-universe](https://github.com/datawhalechina/llm-universe):Datawhale 的中文 RAG 教程,有一章专讲评估与优化,和今天的两层划分对照着看。

## 自测

**1. RAG 答错一道题,只有哪两类原因?各举今天的一个例子。**

<details><summary>答案</summary>

检索层没拿到该用的资料:「年付企业版第 3 个月想退」缺 kb-001 的价格,模型只能说算不出。生成层没用好资料:配置 C 的「你们公司在哪个城市」,资料里只有数据中心在杭州,模型说成了公司在杭州。

</details>

**2. 配置 B 和 C 端到端都是 3/6,各自该怎么修?**

<details><summary>答案</summary>

B 的三道错题都是检索错(BM25 对口语问题一个词都匹配不上,k=2 又太小),该把向量检索加回来、调大 k。C 的检索结果和 A 一模一样,多错的是无答案题,该把提示词改回「只根据资料,没找到就说没找到」。

</details>

**3. 为什么 `retrieval_ok = expected <= got` 对无答案题是错的?**

<details><summary>答案</summary>

无答案题的 `expected` 是空集合,空集合是任何集合的子集,`set() <= got` 永远是 `True`,检索层会被误判成对了。要先判 `if expected`,空集合给 `None`,单独当无答案题处理。

</details>

**4. 为什么一般先调检索层,再调生成层?**

<details><summary>答案</summary>

检索层判起来便宜、快、确定(规则对比标注,几秒钟,不调模型打分),可以频繁实验;而且检索没拿到资料的题,怎么调提示词都没用。检索层调好后,剩下的错才值得花钱让模型裁判去判生成层。

</details>

**5.(面试题)你们的 RAG 客服上线后,用户投诉「答非所问」越来越多。你怎么定位问题?**

<details><summary>答案</summary>

先把投诉的对话捞出来,每条都分两层看:当时检索到的块里有没有答这个问题需要的资料。有的归到生成层(提示词、模型、上下文太长被淹没),没有的归到检索层(知识库缺文章、切块切断了、新出现的口语说法匹配不上)。统计两类各占多少,再按占比大的那一层去修;修完用同一批题回归,两层分数都看,防止修好一层弄坏另一层。如果检索结果没记日志,第一件事就是把每次请求检索到的块 id 记下来,不然根本没法分层。

</details>

## 明天预告

Day 256 · RAG 评估(二):手算三个检索指标。今天的检索层只有「对」和「错」两种结论,企业版那题拿到一篇缺一篇,和一篇都没拿到,都记作「检索错」;答案排第 1 和排第 4,也都记作「检索对」。明天把这一个是非题拆成三个能比大小的数:recall(该找的找到了几成)、precision(拿到的里面有几成有用)、MRR(第一个有用的排第几),先在纸上手算,再写成 `metrics.py`。
