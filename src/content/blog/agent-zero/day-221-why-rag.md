---
title: 'Day 221 · RAG 为什么存在:两条流水线'
description: '大模型不知道 CloudLedger 的退款规则。今天先直接问一次,看它怎么绕;再把整个小知识库塞进 prompt,答对了,算出知识库变大以后这条路为什么走不通;最后拆出 RAG 的两条流水线:文档变了才跑的索引线,每个问题都跑的查询线,用两个二十几行的小脚本各跑一遍,再故意制造一次「资料改了索引没重建」的事故。'
pubDate: 2026-10-22
regime: none
tags: ['rag', 'embedding', 'deepseek', 'pipeline', 'agent-zero']
series: 'agent-zero'
day: 221
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 220](/blog/agent-zero/day-220-embed-cost/) 算了三笔账:一个 1024 维向量约 4 KB;1 万篇文章建一次索引最贵也就 12 元;而回答问题那一侧,一天 1000 个问题光输入费就要 4 元。那天最后一句结论是「RAG 真正的成本在把资料塞给大模型那一步」。我们还用 6 道自己的题比了四个 embedding 模型,看到榜单第一不加指令时会输给免费的 bge-m3。

从 [Day 212](/blog/agent-zero/day-212-why-vectors/) 到昨天,我们一直在练「找」:把文字变成向量,比相似度,知道它哪里会找错,花多少钱。今天退一步,问一个更根本的问题:为什么要找?大模型自己不知道答案吗?把资料全塞给它不行吗?把这两个问题想清楚,RAG 这个词的每个字母就都有了着落。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚 RAG 要解决的两个问题(模型不知道你的私有资料、资料太多塞不下也塞不起),并用今天实跑的三组数字支撑:直接问、全塞进去、只给相关的几段。
2. 画出 RAG 的两条流水线:**索引线**(读文档 → 编码 → 存起来,文档变了才跑)和**查询线**(编码问题 → 找最像的几段 → 拼 prompt → 大模型回答,每个问题都跑),说出每一步在哪个脚本的哪几行。
3. 跑通两个玩具脚本 `toy_index.py` 和 `toy_query.py`,并能解释为什么「改了资料不重建索引」时系统不报错却答旧答案。
4. 判断一个场景该直接塞、该用 RAG、还是两者都不该用。

预计用时 2 小时:三个对比实验 40 分钟,两条流水线两个脚本 40 分钟,剩下做练习。前置:[Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py`,[Day 135](/blog/agent-zero/day-135-llm-client-1/) 起写的 `common/llm.py`(`LLMClient`),[Day 109](/blog/agent-zero/day-109-context-window/) 的上下文窗口,[Day 220](/blog/agent-zero/day-220-embed-cost/) 的成本账。

实跑花费:embedding 全部走免费的 bge-m3;大模型是 DeepSeek 的 `deepseek-flash`,今天正文加练习一共调了十来次,`LLMClient` 按高峰价记账,最贵的一次 0.0032 元,合计约 0.012 元,一分钱出头。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,在纸上画出两条流水线,再默写 `toy_query.py` 的检索四行;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 第一个实验:直接问大模型

大模型的知识有两个天生的限制。一是**截止日期**:它只知道训练时见过的东西,CloudLedger 上个月刚改的退款规则,它不可能知道。二是**私有数据**:你公司的帮助中心、内部文档、客户合同,训练时根本没给它看过。CloudLedger 是我们虚构的公司,正好把第二个限制放大到极致:模型对它一无所知。

先直接问一次,看会发生什么。新建 `part04/no_rag.py`:

```python
# agent-zero-lab/part04/no_rag.py
from common.llm import LLMClient

client = LLMClient()
question = "我在 CloudLedger 买了年付专业版,用了 4 个月想取消,能退多少钱?多久到账?"
r = client.chat([{"role": "user", "content": question}], temperature=0)
print(r.content)
print("---")
print("输入", r.prompt_tokens, "输出", r.completion_tokens, f"花费 ¥{r.cost:.5f}")
```

<div class="line-notes">

- `from common.llm import LLMClient` Day 135 起写的封装,读根目录 `.env` 里的 `LLM_*`。我的 `.env` 是 `LLM_MODEL=deepseek-flash`,`LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}` 关掉思考模式。
- `client = LLMClient()` 建一个客户端,里面带着记账用的 `ledger`。
- `question = "我在 CloudLedger 买了年付专业版` 一个典型的客服问题,答案需要两条 CloudLedger 自己的规定:怎么退(按剩余月份比例)、专业版多少钱。
- `r = client.chat([{"role": "user", "content": question}], temperature=0)` 只有一条 user 消息,没有任何资料。`temperature=0` 让输出尽量稳定,方便对比([Day 110](/blog/agent-zero/day-110-sampling-1/) 讲过)。
- `print(r.content)` 模型的回答。
- `print("输入", r.prompt_tokens` `r.prompt_tokens` 是输入 token,实测 31;`r.cost` 是 `LLMClient` 按 `.env` 里 `LLM_PRICE` 算出来的花费(元)。

</div>

```bash
cd agent-zero-lab
uv run python -m part04.no_rag
```

真实输出(中间省略了一段,保留开头和结尾):

```text
关于 CloudLedger 年付专业版使用 4 个月后的退款问题，我需要先说明：我无法确认 CloudLedger 这家公司的具体退款政策，因为这不是一个我能核实的主流公开服务条款。不同公司的退款规则差异很大，直接给你一个数字可能会误导你。

不过我可以帮你梳理判断和操作思路：
...
**3. 到账时间**
- 通常原路退回，信用卡 5–10 个工作日，第三方支付（支付宝/PayPal 等）可能 3–15 个工作日，具体看支付渠道和公司处理时效。
...
如果你能贴出 CloudLedger 退款政策原文或购买渠道，我可以帮你逐条解读并估算退款金额。
---
输入 31 输出 387 花费 ¥0.00316
```

这个回答其实已经算「诚实」了:开头就说它不知道 CloudLedger 的政策。但对一个客服系统来说它没用,387 个 token 全是通用建议,里面「信用卡 5–10 个工作日」这种数字还是它自己根据常识编的,和 CloudLedger 的真实规定(3 到 5 个工作日)对不上。更糟的情况是模型不这么老实,直接编一个像模像样的政策出来,这就是常说的**幻觉**(hallucination)。

你还注意到最后一句了吗:「如果你能贴出退款政策原文,我可以帮你逐条解读」。模型自己把解决办法说出来了:把资料给它。

## 第二个实验:把资料全塞进去

先准备一个 6 篇的迷你知识库,单独放一个文件,后面几个脚本都 import 它。新建 `part04/mini_kb.py`:

```python
# agent-zero-lab/part04/mini_kb.py
KB = {
    "kb-001": "年付套餐退款:年付套餐中途取消的,按剩余的整月数比例退款,不足一个月的部分不退。退款审批通过后 3 到 5 个工作日原路退回。",
    "kb-002": "月付套餐退款:月付套餐不支持退款,取消后当月仍可使用到月底。",
    "kb-003": "发票抬头填错:在「账单 → 发票」页面申请作废,作废后重新填写抬头再开一次。已经报销的发票不能作废。",
    "kb-004": "E1042 错误:导入银行流水时文件编码不是 UTF-8。用 Excel 另存为 CSV UTF-8 后重新上传。",
    "kb-005": "重置密码:收不到重置邮件时先检查垃圾箱,或者把 noreply@cloudledger.cn 加入白名单。",
    "kb-006": "套餐价格:专业版年付 1200 元,月付 120 元;企业版年付 4800 元,月付 480 元。",
}
```

<div class="line-notes">

- `KB = {` 一个字典,键是文章编号,值是正文。真实的 CloudLedger 帮助中心明天([Day 222](/blog/agent-zero/day-222-kb-data/))才造,有 20 篇、每篇几段;今天每篇只有一两句,够演示就行。
- `"kb-001": "年付套餐退款:` 回答今天这个问题需要的第一条:怎么退、多久到账。
- `"kb-006": "套餐价格:` 需要的第二条:专业版年付多少钱。注意这两条在不同的文章里,这一点在第四个实验里会出问题。

</div>

这个文件只有数据,不用跑。然后新建 `part04/stuff_all.py`,把 6 篇全部拼进 system 消息:

```python
# agent-zero-lab/part04/stuff_all.py
from common.llm import LLMClient
from part04.mini_kb import KB

client = LLMClient()
docs = "\n".join(f"[{doc_id}] {text}" for doc_id, text in KB.items())
system = "你是 CloudLedger 的客服。只根据下面的帮助中心资料回答,并在句末标注引用的编号。资料里没有的就说不知道。\n\n" + docs
question = "我在 CloudLedger 买了年付专业版,用了 4 个月想取消,能退多少钱?多久到账?"

r = client.chat([{"role": "system", "content": system}, {"role": "user", "content": question}], temperature=0)
print(r.content)
print("---")
print("资料字数", len(docs), " 输入", r.prompt_tokens, "输出", r.completion_tokens, f"花费 ¥{r.cost:.5f}")
```

<div class="line-notes">

- `from part04.mini_kb import KB` 从刚才的文件里拿字典。因为是 `part04.mini_kb` 这种包路径,脚本必须在 `agent-zero-lab` 根目录用 `-m` 跑([Day 33](/blog/agent-zero/day-033-packages/))。
- `docs = "\n".join(f"[{doc_id}] {text}" for doc_id, text in KB.items())` 每篇变成一行 `[kb-001] 年付套餐退款:……`,用换行拼起来。编号放在方括号里,是为了让模型回答时能引用。
- `system = "你是 CloudLedger 的客服。只根据下面的帮助中心资料回答` 三条规矩:只用资料、标出处、没有就说不知道。这几条规矩怎么写才管用是 [Day 227](/blog/agent-zero/day-227-rag-prompt/) 的内容,今天先照抄。行尾的 `+ docs` 把资料直接接在规矩后面,一起放进 system 消息。
- `r = client.chat([{"role": "system", "content": system}, {"role": "user", "content": question}], temperature=0)` 两条消息:system 里是规矩加全部资料,user 里是问题。
- `len(docs)` 资料一共多少字符,实测 361。

</div>

```bash
uv run python -m part04.stuff_all
```

真实输出:

```text
年付专业版是 1200 元，用了 4 个月后取消，按剩余的整月数比例退款：剩余 8 个月，可退 1200 × 8/12 = 800 元（不足一个月的部分不退）。退款审批通过后 3 到 5 个工作日原路退回。[kb-001][kb-006]
---
资料字数 361  输入 291 输出 80 花费 ¥0.00122
```

完美的回答:从 kb-006 找到 1200 元,从 kb-001 找到按剩余整月比例退,自己算出 800 元,到账时间 3 到 5 个工作日也对,两处出处都标了。输入 291 个 token,比直接问多了 260 个,花费反而更低,因为输出从 387 个废话 token 变成了 80 个干货。

这其实是一个正经的选项,不是凑数的。资料少的时候,**我真的推荐你先这么干**:简单,不会漏,也不会有「找错了」的问题。Anthropic 在讲检索的工程文章里也写了同样的建议:知识库小于 20 万 token(大约 500 页)时,直接把整个知识库放进 prompt 就行,不用做检索(链接在学习资料里)。

那为什么还要 RAG?因为知识库会长大。

## 全塞的账:知识库长大以后

新建 `part04/stuff_scale.py`,纯算术,不调接口。用 Day 220 的口径:每字 0.9 个 token,DeepSeek 未命中缓存的输入价每百万 2 元,一天 1000 个问题。`deepseek-flash` 的上下文窗口我 2026 年 10 月在 [DeepSeek 价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 查到是 1M,也就是 100 万 token。

```python
# agent-zero-lab/part04/stuff_scale.py
TOKENS_PER_CHAR = 0.9
WINDOW = 1_000_000
PRICE_MISS = 2.0
QUESTIONS_PER_DAY = 1_000

SIZES = [
    ("今天的 6 篇小样本", 6, 60),
    ("Day 222 的帮助中心", 20, 300),
    ("长大一点", 1_000, 1_500),
    ("1 万篇", 10_000, 1_500),
]

for name, n, chars in SIZES:
    tokens = int(n * chars * TOKENS_PER_CHAR)
    fits = "装得下" if tokens <= WINDOW else "装不下"
    per_q = tokens / 1_000_000 * PRICE_MISS
    print(f"{name:<14} {tokens:>11,} token  窗口{fits}  每问 ¥{per_q:>7.4f}  每天 ¥{per_q * QUESTIONS_PER_DAY:>9.2f}")

rag_tokens = int(3 * 500 * TOKENS_PER_CHAR)
rag_per_q = rag_tokens / 1_000_000 * PRICE_MISS
print(f"{'RAG 只给 3 块':<14} {rag_tokens:>11,} token  窗口装得下  每问 ¥{rag_per_q:>7.4f}  每天 ¥{rag_per_q * QUESTIONS_PER_DAY:>9.2f}")
```

<div class="line-notes">

- `WINDOW = 1_000_000` deepseek-flash 的上下文窗口,100 万 token。[Day 109](/blog/agent-zero/day-109-context-window/) 讲过,窗口是模型一次能看到的全部内容,输入加输出都算在里面。
- `PRICE_MISS = 2.0` 未命中缓存的输入价,高峰时段每百万 token 2 元。
- `SIZES = [` 四种知识库规模,每个元组是 `(名字, 篇数, 每篇字数)`。
- `("今天的 6 篇小样本", 6, 60),` 6 篇、每篇约 60 字,和 `mini_kb.py` 差不多。
- `("Day 222 的帮助中心", 20, 300),` 明天要造的 20 篇,我按每篇 300 字估。
- `("1 万篇", 10_000, 1_500),` Day 220 算过的那个规模。
- `tokens = int(n * chars * TOKENS_PER_CHAR)` 全塞进去要多少 token。`int()` 去掉小数。
- `fits = "装得下" if tokens <= WINDOW else "装不下"` 三元表达式,超过窗口就塞不进去,API 会直接报错。
- `per_q = tokens / 1_000_000 * PRICE_MISS` 每问一次光输入就要付这么多。
- `rag_tokens = int(3 * 500 * TOKENS_PER_CHAR)` RAG 的做法:只给最相关的 3 块,每块 500 字。
- `f"{'RAG 只给 3 块':<14}` f-string 的花括号里也能直接写一个字符串字面量再加格式,这里是为了和上面几行对齐。外面是双引号,里面就用单引号,和 JS 模板字符串里嵌引号的道理一样。

</div>

```bash
uv run python -m part04.stuff_scale
```

真实输出:

```text
今天的 6 篇小样本             324 token  窗口装得下  每问 ¥ 0.0006  每天 ¥     0.65
Day 222 的帮助中心        5,400 token  窗口装得下  每问 ¥ 0.0108  每天 ¥    10.80
长大一点             1,350,000 token  窗口装不下  每问 ¥ 2.7000  每天 ¥  2700.00
1 万篇            13,500,000 token  窗口装不下  每问 ¥27.0000  每天 ¥ 27000.00
RAG 只给 3 块           1,350 token  窗口装得下  每问 ¥ 0.0027  每天 ¥     2.70
```

(中文字符在终端里占两格,所以名字那一列看起来没对齐,数字列是对齐的。)

20 篇的时候全塞完全可行,一天 10.8 元,还没算缓存。到 1000 篇、135 万 token,已经超过了 100 万的窗口,物理上塞不进去;就算有更大窗口的模型,每问 2.7 元、一天 2700 元也没人付得起。RAG 只给 3 块,不管知识库多大,每问都是 1350 个 token 左右,0.0027 元。

钱和窗口之外还有两个问题。一是**慢**:输入越长,模型开始吐第一个字之前要处理的东西越多,首 token 延迟越高(`LLMClient` 的 `ChatResult.ttft` 记的就是它,流式调用时才有)。二是**不一定准**:2023 年有篇很有名的论文叫《Lost in the Middle》,实验发现资料放在长上下文的中间时,模型用它的效果明显变差,开头和结尾的反而用得好。新模型在这方面进步了不少,但「塞得越多越好」从来不是真的,[Day 262](/blog/agent-zero/day-262-context-budget/) 讲上下文预算时会回来。

说明一下:DeepSeek 有前缀缓存,同样的资料前缀第二次起按命中价算,每百万 0.04 元,比未命中便宜 50 倍([Day 397](/blog/agent-zero/day-397-prompt-caching/) 细讲)。这能让「20 篇全塞」更便宜,但救不了「装不下」。

## RAG 的思路:只给相关的那几段

把三个实验放在一起:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="三种做法对比:直接问、全塞进去、只给相关几段">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="180" height="150" rx="6" fill="none" stroke="var(--rule)"/>
<text x="110" y="54" fill="var(--ink)" text-anchor="middle">直接问</text>
<text x="110" y="84" fill="var(--ink-soft)" text-anchor="middle">输入 31 token</text>
<text x="110" y="106" fill="var(--ink-soft)" text-anchor="middle">没有资料</text>
<text x="110" y="128" fill="var(--ink-soft)" text-anchor="middle">通用建议 / 可能编</text>
<text x="110" y="160" fill="var(--ink)" text-anchor="middle">答不了</text>
<rect x="230" y="30" width="180" height="150" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="54" fill="var(--ink)" text-anchor="middle">全塞进去</text>
<text x="320" y="84" fill="var(--ink-soft)" text-anchor="middle">输入 = 整个知识库</text>
<text x="320" y="106" fill="var(--ink-soft)" text-anchor="middle">小库:答对,800 元</text>
<text x="320" y="128" fill="var(--ink-soft)" text-anchor="middle">大库:装不下、太贵</text>
<text x="320" y="160" fill="var(--ink)" text-anchor="middle">只适合小知识库</text>
<rect x="440" y="30" width="180" height="150" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="530" y="54" fill="var(--ink)" text-anchor="middle">RAG</text>
<text x="530" y="84" fill="var(--ink-soft)" text-anchor="middle">先找最相关的几段</text>
<text x="530" y="106" fill="var(--ink-soft)" text-anchor="middle">输入 ≈ 1350 token</text>
<text x="530" y="128" fill="var(--ink-soft)" text-anchor="middle">和库多大无关</text>
<text x="530" y="160" fill="var(--ink)" text-anchor="middle">代价:多一步「找」</text>
<text x="20" y="214" fill="var(--ink-soft)">「找」错了,后面就全错。第四部分剩下的几十天,大多在优化这一步。</text>
<text x="20" y="236" fill="var(--ink-faint)" font-size="11">数字来自今天的 no_rag.py、stuff_all.py、stuff_scale.py 实跑</text>
</g>
</svg>
<figcaption>三种做法。全塞在小知识库上是好选择,今天的 6 篇小样本就用它答对了;知识库一大,只有 RAG 走得通。</figcaption>
</figure>

**RAG** 是 Retrieval-Augmented Generation 的缩写,中文一般叫「检索增强生成」。三个词正好是三步:Retrieval,先检索出和问题相关的几段资料;Augmented,把它们加进 prompt,增强模型手里的信息;Generation,让模型基于这些资料生成回答。说白了就是「开卷考试」:模型不用背下整本书,考试时先翻到相关的那几页,再答题。

这个名字来自 2020 年 Facebook AI(现在的 Meta)的一篇论文,论文里的 RAG 是一个把检索器和生成模型一起训练的具体模型。今天大家说 RAG,已经泛指「先检索、再把结果塞进 prompt 生成」这一大类做法,和论文里的具体结构关系不大了。

代价也要说清楚:多了一个「找」的环节,这一步找错了,后面全错。Day 219 你已经见过两种找错:否定句和错误码。下面第四个实验还会再撞上一次。

## 两条流水线

RAG 系统由两条互相独立的流水线组成。这一点一定要分清,面试画 RAG 架构图时几乎必考。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="RAG 的索引线和查询线">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">索引线:文档变了才跑(toy_index.py)</text>
<rect x="20" y="42" width="100" height="40" rx="4" fill="none" stroke="var(--compute)"/>
<text x="70" y="66" fill="var(--ink)" text-anchor="middle">mini_kb.py</text>
<rect x="150" y="42" width="90" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="195" y="60" fill="var(--ink)" text-anchor="middle">切块</text>
<text x="195" y="75" fill="var(--ink-faint)" text-anchor="middle" font-size="11">今天跳过</text>
<rect x="270" y="42" width="110" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="325" y="66" fill="var(--ink)" text-anchor="middle">embed 每一篇</text>
<rect x="410" y="42" width="200" height="40" rx="4" fill="none" stroke="var(--compute)"/>
<text x="510" y="60" fill="var(--ink)" text-anchor="middle">vectors.npy</text>
<text x="510" y="75" fill="var(--ink)" text-anchor="middle">meta.json</text>
<line x1="120" y1="62" x2="150" y2="62" stroke="var(--ink-faint)" marker-end="url(#a221)"/>
<line x1="240" y1="62" x2="270" y2="62" stroke="var(--ink-faint)" marker-end="url(#a221)"/>
<line x1="380" y1="62" x2="410" y2="62" stroke="var(--ink-faint)" marker-end="url(#a221)"/>
<line x1="20" y1="112" x2="620" y2="112" stroke="var(--rule)" stroke-dasharray="4 4"/>
<text x="20" y="140" fill="var(--ink-soft)">查询线:每个问题都跑(toy_query.py)</text>
<rect x="20" y="156" width="100" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="70" y="180" fill="var(--ink)" text-anchor="middle">用户问题</text>
<rect x="150" y="156" width="90" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="195" y="180" fill="var(--ink)" text-anchor="middle">embed 问题</text>
<rect x="270" y="156" width="110" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="325" y="174" fill="var(--ink)" text-anchor="middle">点积 → top-k</text>
<text x="325" y="189" fill="var(--ink-faint)" text-anchor="middle" font-size="11">读 vectors.npy</text>
<rect x="410" y="156" width="200" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="510" y="180" fill="var(--ink)" text-anchor="middle">拼 prompt:资料 + 问题</text>
<rect x="410" y="236" width="200" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="510" y="260" fill="var(--ink)" text-anchor="middle">大模型生成 + 引用</text>
<rect x="150" y="236" width="230" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="265" y="260" fill="var(--ink)" text-anchor="middle">回答 … [kb-001]</text>
<line x1="120" y1="176" x2="150" y2="176" stroke="var(--ink-faint)" marker-end="url(#a221)"/>
<line x1="240" y1="176" x2="270" y2="176" stroke="var(--ink-faint)" marker-end="url(#a221)"/>
<line x1="380" y1="176" x2="410" y2="176" stroke="var(--ink-faint)" marker-end="url(#a221)"/>
<line x1="510" y1="196" x2="510" y2="236" stroke="var(--ink-faint)" marker-end="url(#a221)"/>
<line x1="410" y1="256" x2="380" y2="256" stroke="var(--ink-faint)" marker-end="url(#a221)"/>
<line x1="510" y1="82" x2="510" y2="100" stroke="var(--compute)" stroke-dasharray="3 3"/>
<line x1="325" y1="100" x2="510" y2="100" stroke="var(--compute)" stroke-dasharray="3 3"/>
<line x1="325" y1="100" x2="325" y2="156" stroke="var(--compute)" stroke-dasharray="3 3" marker-end="url(#a221)"/>
<text x="20" y="310" fill="var(--ink-faint)" font-size="11">蓝色 = 调模型;琥珀色 = 你自己的数据和文件;两条线必须用同一个 embedding 模型</text>
</g>
<defs><marker id="a221" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</svg>
<figcaption>上半部分只在文档变化时跑一次,产出两个文件;下半部分每个问题都跑,只读那两个文件。两条线之间唯一的接口就是琥珀色虚线那一段。</figcaption>
</figure>

**索引线**(indexing pipeline,也叫离线流水线):读文档 → 切块 → 每块算 embedding → 存起来。这一步可以慢,可以批量,文档改了才重跑。

**查询线**(query pipeline,也叫在线流水线):用户问题 → 算问题的 embedding → 和所有块的向量算相似度 → 取最高的 k 个 → 把这 k 块和问题拼成 prompt → 大模型回答。这一步每个请求都跑,要快。

拿前端打个比方:索引线像 `npm run build`,源码改了才跑,跑一次可能要一分钟,产出 `dist/` 目录;查询线像用户打开网页,每次访问都发生,只读 `dist/` 里的东西,要求几百毫秒内响应。没人会在每个用户访问时现场 build 一遍。

分成两条的好处是两边可以分开优化。索引线关心切得好不好、每块带不带编号和标题、文档改了能不能只重建改动的那几篇;查询线关心延迟、找得准不准、prompt 怎么写模型才不乱编。第四部分接下来的课大致也按这个分:Day 222–225 是索引线(造数据、切块、存索引),Day 226–227 是查询线(检索、拼 prompt、拒答),之后再分别往深里做。

下面用两个玩具脚本把两条线各跑一遍。为了让你看清骨架,今天不切块(每篇就一两句话),不用数据库,只存两个文件。

### 索引线:toy_index.py

新建 `part04/toy_index.py`:

```python
# agent-zero-lab/part04/toy_index.py
import json
from pathlib import Path

import numpy as np

from common.embed import EMB_MODEL, embed, usage
from part04.mini_kb import KB

OUT = Path("part04/toy_index")
OUT.mkdir(exist_ok=True)

ids = list(KB.keys())
vecs = embed([KB[i] for i in ids])

np.save(OUT / "vectors.npy", vecs)
meta = {"model": EMB_MODEL, "ids": ids, "texts": [KB[i] for i in ids]}
(OUT / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

print("索引线跑完:", vecs.shape, "→", OUT)
print("embedding 请求", usage["requests"], "次,", usage["tokens"], "token")
```

<div class="line-notes">

- `from common.embed import EMB_MODEL, embed, usage` 除了 `embed` 和 `usage`,还拿了模块里的常量 `EMB_MODEL`(实测 `BAAI/bge-m3`),要把它写进索引。Day 217 的铁律:建索引和查询必须用同一个模型。
- `OUT = Path("part04/toy_index")` 索引放在这个目录里。
- `OUT.mkdir(exist_ok=True)` 建目录,已经存在就不报错。相当于 Node 的 `fs.mkdirSync(p, { recursive: true })` 里「已存在不报错」那一半。
- `ids = list(KB.keys())` 6 个编号排成列表,顺序就是字典里写的顺序(Python 3.7 起字典保持插入顺序,和 JS 对象的字符串键一样)。向量的第 i 行对应 `ids[i]`,这个对应关系一乱,检索结果就会张冠李戴。
- `vecs = embed([KB[i] for i in ids])` 按 `ids` 的顺序取出正文,一次编码。6 条一批,一次请求,得到 `(6, 1024)`。
- `np.save(OUT / "vectors.npy", vecs)` `Path` 对象可以用 `/` 拼路径,`OUT / "vectors.npy"` 就是 `part04/toy_index/vectors.npy`,相当于 Node 的 `path.join(OUT, "vectors.npy")`。
- `meta = {"model": EMB_MODEL, "ids": ids, "texts": [KB[i] for i in ids]}` 向量之外的东西都放这里:用的哪个模型、每行是哪篇、原文是什么。查询线拿到「第 0 行最像」以后,要靠它把行号换回编号和原文。
- `json.dumps(meta, ensure_ascii=False, indent=2)` [Day 39](/blog/agent-zero/day-039-json/) 学的:`ensure_ascii=False` 让中文原样写进文件,不变成 `年` 这种转义;`indent=2` 缩进两格,方便人看。相当于 `JSON.stringify(meta, null, 2)`。外面的 `.write_text(..., encoding="utf-8")` 把这个字符串写进文件,编码写明 UTF-8。
- `print("embedding 请求", usage["requests"]` 实测 1 次、231 个 token。

</div>

```bash
uv run python -m part04.toy_index
ls -la part04/toy_index
```

真实输出:

```text
索引线跑完: (6, 1024) → part04/toy_index
embedding 请求 1 次, 231 token
total 64
drwxr-xr-x   4 minliu  wheel    128 22 Oct 13:34 .
drwxr-xr-x  36 minliu  wheel   1152 22 Oct 13:34 ..
-rw-r--r--   1 minliu  wheel    902 22 Oct 13:34 meta.json
-rw-r--r--   1 minliu  wheel  24704 22 Oct 13:34 vectors.npy
```

`vectors.npy` 24,704 字节 = 6 × 1024 × 4 + 128 字节文件头,和 Day 220 算的一模一样。索引线的全部产出就是这两个文件,跑完它就可以退出了。

### 查询线:toy_query.py

新建 `part04/toy_query.py`。它不 import `mini_kb.py`,只读索引线留下的两个文件:

```python
# agent-zero-lab/part04/toy_query.py
import json
import sys
from pathlib import Path

import numpy as np

from common.embed import EMB_MODEL, embed_one
from common.llm import LLMClient

INDEX = Path("part04/toy_index")
TOP_K = 2

vecs = np.load(INDEX / "vectors.npy")
meta = json.loads((INDEX / "meta.json").read_text(encoding="utf-8"))
if meta["model"] != EMB_MODEL:
    sys.exit(f"索引是用 {meta['model']} 建的,现在配置的是 {EMB_MODEL},先重建索引")

question = sys.argv[1]
scores = vecs @ embed_one(question)
top = np.argsort(-scores)[:TOP_K]
for i in top:
    print(f"检索到 [{meta['ids'][i]}] {scores[i]:.4f}")

docs = "\n".join(f"[{meta['ids'][i]}] {meta['texts'][i]}" for i in top)
system = "你是 CloudLedger 的客服。只根据下面的资料回答,并在句末标注引用的编号。资料里没有的就说不知道。\n\n" + docs
r = LLMClient().chat([{"role": "system", "content": system}, {"role": "user", "content": question}], temperature=0)
print(r.content)
print(f"--- 输入 {r.prompt_tokens} 输出 {r.completion_tokens} 花费 ¥{r.cost:.5f}")
```

<div class="line-notes">

- `import sys` 标准库,今天用它的两样东西:`sys.argv` 读命令行参数,`sys.exit` 提前退出。
- `TOP_K = 2` 取最像的几篇。先取 2,第四个实验你会看到它带来的问题。
- `vecs = np.load(INDEX / "vectors.npy")` 读回 `(6, 1024)` 的数组,和存进去的一模一样。
- `meta = json.loads((INDEX / "meta.json").read_text(encoding="utf-8"))` 读回编号、原文和模型名。
- `if meta["model"] != EMB_MODEL:` Day 217 说的工程做法:把模型名和索引存在一起,查询前核对,不一致就拒绝查询。
- `sys.exit(f"索引是用 {meta['model']} 建的` 打印这句话并结束程序,退出码是 1(表示出错)。相当于 Node 里 `console.error(msg); process.exit(1)`。f-string 外面用双引号,里面取字典值用单引号。
- `question = sys.argv[1]` `sys.argv` 是命令行参数列表,`[0]` 是脚本名,`[1]` 是你在命令后面写的第一个参数,相当于 Node 的 `process.argv[2]`(Node 前面多了一个 `node` 本身)。问题有空格时整句要用引号包起来。
- `scores = vecs @ embed_one(question)` 编码问题,和 6 篇一次算完余弦。查询线每个问题只发这一次 embedding 请求。
- `top = np.argsort(-scores)[:TOP_K]` 从大到小排,取前 2 个行号。
- `print(f"检索到 [{meta['ids'][i]}] {scores[i]:.4f}")` 把行号换回编号打印出来。调试 RAG 时,**先看检索到了什么**,再看回答,这个习惯从今天开始养。
- `docs = "\n".join(f"[{meta['ids'][i]}] {meta['texts'][i]}" for i in top)` 只拼这 2 篇,不是全部 6 篇。
- `system = "你是 CloudLedger 的客服。` 和 `stuff_all.py` 一样的规矩,只是资料少了。
- `r = LLMClient().chat(` 生成这一步和第二个实验完全一样。RAG 的「G」就是普通的一次大模型调用。

</div>

问同一个问题:

```bash
uv run python -m part04.toy_query "我在 CloudLedger 买了年付专业版,用了 4 个月想取消,能退多少钱?多久到账?"
```

真实输出:

```text
检索到 [kb-001] 0.7188
检索到 [kb-002] 0.6575
年付套餐中途取消的，按剩余的整月数比例退款，不足一个月的部分不退；退款审批通过后 3 到 5 个工作日原路退回。[kb-001] 您用了 4 个月，具体退款金额需按剩余整月数比例计算，资料中未给出具体金额。[kb-001]
--- 输入 135 输出 73 花费 ¥0.00085
```

规则和到账时间都对了,输入从全塞的 291 降到 135。但它没算出 800 元,说「资料中未给出具体金额」。原因就在前两行:检索到的是 kb-001(年付退款)和 kb-002(月付退款),价格那篇 kb-006 没进前两名。模型的表现其实无可挑剔,资料里确实没有价格,它也没编。**问题出在「找」**:这个问题需要两篇文章拼起来才能答,而 top-2 只找全了一半。练习 1 会把 `TOP_K` 改成 3 再看。

再问一个资料里根本没有的:

```bash
uv run python -m part04.toy_query "可以开增值税专用发票吗"
```

真实输出:

```text
检索到 [kb-003] 0.6148
检索到 [kb-006] 0.4916
资料里没有提到能否开增值税专用发票，我不知道。资料只说明了发票抬头填错时可在「账单 → 发票」页面申请作废后重开，以及已报销的发票不能作废 [kb-003]。
--- 输入 124 输出 48 花费 ¥0.00063
```

检索永远会返回 k 篇,哪怕没有一篇真的相关;这时要靠 prompt 里「资料里没有的就说不知道」这条规矩,让模型老实拒答。这次它做到了。拒答在什么情况下会失败、怎么测,是 Day 227 的内容。

## 故意制造一次事故:改了资料,没重建索引

两条线分开带来一个必然的风险:**两边不同步**。资料改了,索引线没跑,查询线读的还是旧文件,而且不会有任何报错。

假设 CloudLedger 调整了政策,退款时效从「3 到 5 个工作日」改成「7 个工作日内」。打开 `part04/mini_kb.py`,把 kb-001 最后一句改成:

```text
退款审批通过后 7 个工作日内原路退回。
```

保存,**不跑** `toy_index.py`,直接问:

```bash
uv run python -m part04.toy_query "年付退款多久到账"
```

真实输出:

```text
检索到 [kb-001] 0.7697
检索到 [kb-002] 0.6451
年付套餐退款审批通过后 3 到 5 个工作日原路退回。[kb-001]
--- 输入 114 输出 24 花费 ¥0.00042
```

还是「3 到 5 个工作日」。资料已经改了,客服 Agent 还在说旧政策,而且有理有据,标着 kb-001 的出处。查询线只读 `meta.json`,它根本不知道 `mini_kb.py` 变了。现在跑一次索引线再问:

```bash
uv run python -m part04.toy_index
uv run python -m part04.toy_query "年付退款多久到账"
```

真实输出:

```text
索引线跑完: (6, 1024) → part04/toy_index
embedding 请求 1 次, 226 token
检索到 [kb-001] 0.7418
检索到 [kb-002] 0.6450
年付套餐退款审批通过后 7 个工作日内原路退回。[kb-001]
--- 输入 110 输出 20 花费 ¥0.00038
```

对了。这个事故在真实系统里非常常见:帮助中心的编辑改了文章,但重建索引的任务是每周跑一次,或者干脆忘了配。用户投诉「客服说的和官网不一样」,查了半天才发现是索引过期。练习 3 给查询线加一道检查,发现资料比索引新就报警。做完这个实验,记得把 kb-001 改回「3 到 5 个工作日原路退回」,再跑一次 `toy_index.py`,后面的练习按原文来。

另一种不同步是 Day 217 讲过的模型不一致,`toy_query.py` 已经防住了。用环境变量临时把查询侧的模型换掉试一下:

```bash
EMB_MODEL=BAAI/bge-large-zh-v1.5 uv run python -m part04.toy_query "年付退款多久到账"
echo "exit=$?"
```

真实输出:

```text
索引是用 BAAI/bge-m3 建的,现在配置的是 BAAI/bge-large-zh-v1.5,先重建索引
exit=1
```

命令前面写 `EMB_MODEL=...` 是只对这一条命令生效的临时环境变量,`load_dotenv()` 默认不覆盖已经存在的环境变量(Day 217 练习 2 用过这个特性)。`echo "exit=$?"` 打印上一条命令的退出码,`sys.exit("...")` 给出的是 1。查询线拒绝工作,而不是默默返回一堆乱七八糟的结果,这正是我们要的。

## 什么时候不用 RAG

最后给一个判断顺序,不展开,Day 227 会细讲。

先问资料多不多:几十篇、加起来几万 token 以内,直接全塞,省掉检索这一步的所有麻烦。再问问题需不需要资料:「帮我把这段话翻译成英文」不需要任何知识库。再问资料是不是在数据库里、要精确查:「客户 C-1024 这个月的账单金额」应该用工具调用去查数据库([Day 180](/blog/agent-zero/day-180-tool-design-1/) 起学的那套),不该用向量检索去「找相似的段落」。剩下的,资料多、是非结构化的文字、问题要靠其中几段来回答,才是 RAG 的主场。

## 动手练习

**练习 1:top-k 改成 3。** 先写一个小脚本把那个「4 个月能退多少」的问题对 6 篇的分数全部打印出来,看 kb-006 排第几、和第四名差多少;再把 `toy_query.py` 的 `TOP_K` 改成 3 重新问。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_topk.py
import json
from pathlib import Path

import numpy as np

from common.embed import embed_one

INDEX = Path("part04/toy_index")
vecs = np.load(INDEX / "vectors.npy")
meta = json.loads((INDEX / "meta.json").read_text(encoding="utf-8"))

question = "我在 CloudLedger 买了年付专业版,用了 4 个月想取消,能退多少钱?多久到账?"
scores = vecs @ embed_one(question)
for rank, i in enumerate(np.argsort(-scores), start=1):
    print(rank, meta["ids"][i], f"{scores[i]:.4f}", meta["texts"][i][:20])
```

<div class="line-notes">

- `vecs = np.load(INDEX / "vectors.npy")` 只读索引线的产出,和 `toy_query.py` 一样。
- `scores = vecs @ embed_one(question)` 6 个分数。
- `for rank, i in enumerate(np.argsort(-scores), start=1):` 全部 6 篇按分数从高到低,名次从 1 开始。
- `meta["texts"][i][:20]` 原文只打印前 20 个字符。

</div>

```bash
uv run python -m part04.ex_topk
```

真实输出:

```text
1 kb-001 0.7188 年付套餐退款:年付套餐中途取消的,按剩余
2 kb-002 0.6575 月付套餐退款:月付套餐不支持退款,取消后
3 kb-006 0.5790 套餐价格:专业版年付 1200 元,月付
4 kb-005 0.5780 重置密码:收不到重置邮件时先检查垃圾箱,
5 kb-003 0.4988 发票抬头填错:在「账单 → 发票」页面申
6 kb-004 0.4274 E1042 错误:导入银行流水时文件编码
```

然后把 `toy_query.py` 里的 `TOP_K = 2` 改成 `TOP_K = 3`,再问一次:

```bash
uv run python -m part04.toy_query "我在 CloudLedger 买了年付专业版,用了 4 个月想取消,能退多少钱?多久到账?"
```

真实输出:

```text
检索到 [kb-001] 0.7188
检索到 [kb-002] 0.6575
检索到 [kb-006] 0.5790
年付专业版价格为 1200 元，按剩余整月数比例退款：使用 4 个月后取消，剩余 8 个月，可退 1200 × 8/12 = 800 元（不足一个月的部分不退）[kb-001][kb-006]。退款审批通过后 3 到 5 个工作日原路退回[kb-001]。
--- 输入 178 输出 85 花费 ¥0.00104
```

取 3 篇就答对了,800 元,两处出处。但看排名表:kb-006 是 0.5790,第四名「重置密码」是 0.5780,只差 0.001。价格那篇能进前三纯属运气,换一种问法它就可能掉到第四。而且月付退款那篇(kb-002)和这个问题无关,却稳稳排第二,因为它也在说「退款」。这就是检索质量的问题:真正需要的文章分数不高,不相关但话题相近的文章分数很高。Day 235 起的混合检索、rerank、query 改写,都是为了让 kb-006 这种文章排得更靠前。改完记得把 `TOP_K` 改回 2,下一个练习按 2 来。

</details>

**练习 2:分一分,哪条线。** 下面 8 件事,各属于索引线还是查询线?哪几件出问题时会「不报错但答错」?

① 读帮助中心的 Markdown 文件 ② 把用户问题编码成向量 ③ 把每篇文章切成 500 字的块 ④ 取分数最高的 3 块 ⑤ 把向量存进 `vectors.npy` ⑥ 拼 system prompt ⑦ 记录这批向量是用哪个模型算的 ⑧ 调大模型生成回答

<details><summary>参考答案</summary>

索引线:① ③ ⑤ ⑦。查询线:② ④ ⑥ ⑧。

「不报错但答错」的至少有这几件:③ 切块切坏了(比如一句话被切成两半,检索到的那块只有半句),查询线照样能跑;⑦ 没记录模型或者记错了,查询时换了模型也发现不了,Day 217 实测混用后分数几乎是随机的;④ k 取小了,今天就是 top-2 漏掉了价格那篇,模型老老实实说「资料中未给出」,看起来很合理;还有今天的事故,①⑤ 对应的文档改了没重跑,查询线读旧文件,答旧政策。

会报错的反而好办:② 的 embedding 服务挂了会抛异常,⑧ 的 key 失效会 401。所以 RAG 系统上线后真正要盯的,是那些不报错的环节,这就是第六部分要建评测和监控的原因。

</details>

**练习 3:给查询线加一道「索引过期」检查。** 写 `ex_fresh.py`:对 `mini_kb.py` 里的当前资料和 `meta.json` 里存的资料各算一个指纹(把字典转成 JSON 字符串,再算 SHA-256 取前 12 位),不一样就打印哪几篇改了。分别在「刚建完索引」「改了 kb-001 没重建」「改回去」三种状态下各跑一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_fresh.py
import hashlib
import json
from pathlib import Path

from part04.mini_kb import KB

INDEX = Path("part04/toy_index")


def kb_fingerprint(kb: dict[str, str]) -> str:
    raw = json.dumps(kb, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


meta = json.loads((INDEX / "meta.json").read_text(encoding="utf-8"))
indexed = dict(zip(meta["ids"], meta["texts"]))
now, then = kb_fingerprint(KB), kb_fingerprint(indexed)
print("现在的资料指纹:", now)
print("索引里的指纹:  ", then)
if now != then:
    changed = [k for k in KB if KB[k] != indexed.get(k)]
    print("索引过期了,改动的文章:", changed, "→ 先跑 toy_index")
else:
    print("索引是最新的")
```

<div class="line-notes">

- `import hashlib` 标准库,算哈希用的,相当于 Node 的 `crypto.createHash`。
- `def kb_fingerprint(kb: dict[str, str]) -> str:` 输入一个「编号 → 正文」的字典,输出一个短字符串当指纹。内容有一个字不同,指纹就完全不同。
- `raw = json.dumps(kb, ensure_ascii=False, sort_keys=True)` 先把字典变成一个字符串。`sort_keys=True` 按键排序,保证同样的内容不管插入顺序如何,都得到同一个字符串。
- `hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]` `encode` 把字符串变成字节(哈希只吃字节),`sha256` 算哈希,`hexdigest()` 转成 64 位十六进制字符串,`[:12]` 取前 12 位,够区分了。相当于 Node 的 `crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12)`。[Day 231](/blog/agent-zero/day-231-pgvector-2/) 做增量更新时,会对每一块算这样的指纹。
- `indexed = dict(zip(meta["ids"], meta["texts"]))` 把 `meta.json` 里两个平行的列表重新配成字典。`zip` 按位置配对,`dict(...)` 把一对对变成键值。相当于 JS 的 `Object.fromEntries(ids.map((id, i) => [id, texts[i]]))`。
- `now, then = kb_fingerprint(KB), kb_fingerprint(indexed)` 一行算两个,右边是一个元组,左边拆开。
- `changed = [k for k in KB if KB[k] != indexed.get(k)]` 找出正文变了的编号。`indexed.get(k)` 在键不存在时返回 `None` 而不是报错,这样新加的文章也会被算作「改动」。

</div>

刚建完索引时跑一次;再把 kb-001 改成「7 个工作日内」后跑一次(不重建);最后改回去再跑一次:

```bash
uv run python -m part04.ex_fresh
```

三次的真实输出依次是:

```text
现在的资料指纹: 776dfa7bb7b0
索引里的指纹:   776dfa7bb7b0
索引是最新的
```

```text
现在的资料指纹: 55bcf37fd95e
索引里的指纹:   776dfa7bb7b0
索引过期了,改动的文章: ['kb-001'] → 先跑 toy_index
```

```text
现在的资料指纹: 776dfa7bb7b0
索引里的指纹:   776dfa7bb7b0
索引是最新的
```

改回去以后指纹又变回 `776dfa7bb7b0`,说明指纹只取决于内容。真实系统里,查询线一般不会每次都去读原始文档算指纹(那样就失去了「查询线只读索引」的意义),而是由索引线在发现文档变化时自动重建,或者由一个定时任务做这个检查。这里放在一个单独的脚本里,就是这种「定时检查」的雏形。

</details>

**练习 4:数一数两条线各花了什么。** 写一个脚本,用 `toy_index` 已经建好的索引问 3 个问题,用 `time.perf_counter()` 分别记检索和生成各花了多久,最后打印查询线一共发了几次 embedding 请求、几次大模型调用。和 `toy_index.py` 打印的「1 次请求、231 token」比一比。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_count.py
import json
import time
from pathlib import Path

import numpy as np

from common.embed import embed_one, usage
from common.llm import LLMClient

INDEX = Path("part04/toy_index")
vecs = np.load(INDEX / "vectors.npy")
meta = json.loads((INDEX / "meta.json").read_text(encoding="utf-8"))
client = LLMClient()

QUESTIONS = ["年付退款多久到账", "发票抬头写错了怎么办", "导入流水报 E1042"]
for q in QUESTIONS:
    t0 = time.perf_counter()
    scores = vecs @ embed_one(q)
    t1 = time.perf_counter()
    top = np.argsort(-scores)[:2]
    docs = "\n".join(f"[{meta['ids'][i]}] {meta['texts'][i]}" for i in top)
    system = "你是 CloudLedger 的客服。只根据资料回答,标注引用编号。\n\n" + docs
    r = client.chat([{"role": "system", "content": system}, {"role": "user", "content": q}], temperature=0)
    t2 = time.perf_counter()
    print(f"{q:<14} 检索 {t1 - t0:.2f}s  生成 {t2 - t1:.2f}s")

print("查询线 embedding 请求:", usage["requests"], "次,", usage["tokens"], "token")
print("查询线大模型:", client.ledger)
```

<div class="line-notes">

- `import time` 标准库,`time.perf_counter()` 返回一个高精度的秒数,两次相减就是耗时,相当于浏览器里的 `performance.now()`(只是单位是秒不是毫秒)。
- `client = LLMClient()` 三个问题共用一个客户端,`client.ledger` 才能把三次调用累计起来。
- `t0 = time.perf_counter()` 检索开始。
- `scores = vecs @ embed_one(q)` 检索的耗时几乎全是这一次 embedding 网络请求,6 个点积在本地是微秒级的。
- `r = client.chat(` 生成。
- `print("查询线大模型:", client.ledger)` `Ledger` 在 `common/llm.py` 里写好了 `__str__`,直接打印就是一行汇总。

</div>

```bash
uv run python -m part04.ex_count
```

真实输出:

```text
年付退款多久到账       检索 0.32s  生成 1.17s
发票抬头写错了怎么办     检索 0.10s  生成 1.10s
导入流水报 E1042    检索 0.11s  生成 0.95s
查询线 embedding 请求: 3 次, 31 token
查询线大模型: 3 次调用 | 输入 313 / 输出 116 tokens | 约 ¥0.0016
```

查询线每个问题 1 次 embedding 加 1 次大模型。检索 0.1 秒左右(第一次 0.32 秒,多了建立网络连接的时间),生成 1 秒左右,大头在生成。索引线 6 篇文章只发了 1 次请求;如果是 1 万篇,按 10 条一批要 1000 次请求,跑几分钟都正常,但它只在文档变化时跑,用户感觉不到。查询线则必须每个问题都在一两秒内完成。两条线对「快」的要求完全不同,这就是要把它们分开的原因。

</details>

**验收标准:** `no_rag.py`、`stuff_all.py`、`toy_index.py`、`toy_query.py` 都跑通;能不看文章在纸上画出两条流水线,并标出 `vectors.npy` 和 `meta.json` 在哪里;能解释 top-2 为什么没算出 800 元;亲手复现一次「改了资料没重建索引」的事故并修好;能说出至少一个不该用 RAG 的场景。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| RAG(检索增强生成) | Retrieval-Augmented Generation。先检索出和问题相关的几段资料,拼进 prompt,再让大模型基于资料回答 |
| 幻觉(hallucination) | 模型编出看起来像真的、实际上没有依据的内容,比如替 CloudLedger 编一个退款时效 |
| 私有数据 | 模型训练时没见过的资料,比如公司内部的帮助中心、合同、工单 |
| 全塞(stuffing) | 不做检索,把整个知识库放进 prompt。小知识库时最简单可靠 |
| 索引线(indexing pipeline) | 离线流水线:读文档 → 切块 → 编码 → 存起来。文档变了才跑 |
| 查询线(query pipeline) | 在线流水线:编码问题 → 找 top-k → 拼 prompt → 生成。每个问题都跑 |
| top-k | 按相似度取最高的 k 篇(块)。k 太小会漏,太大会塞进无关资料 |
| 索引过期 | 资料改了但索引没重建,查询线读旧数据,不报错却答旧内容 |
| Lost in the Middle | 2023 年的论文,发现长上下文中间的资料更容易被模型忽略 |
| `sys.argv` | 命令行参数列表,`sys.argv[1]` 相当于 Node 的 `process.argv[2]` |
| `sys.exit(msg)` | 打印消息并以退出码 1 结束程序 |
| 指纹(哈希) | 对内容算出的一串短字符,内容变一个字指纹就变,`hashlib.sha256` 算 |

## 常见误区

**以为大模型「什么都知道」。** 它不知道你的私有资料,也不知道训练截止之后的事。今天实测,问 CloudLedger 的退款规则,它说了 387 个 token 的通用建议,里面的到账时间是按常识编的。

**一上来就做 RAG。** 6 篇、20 篇的知识库,直接全塞最省事,今天全塞版一次就算对了 800 元。等资料多到装不下或者太贵,再上检索。Anthropic 给的经验线是 20 万 token。

**只看回答不看检索结果。** top-2 那次,模型说「资料中未给出具体金额」,单看回答你会以为模型不够聪明。打印检索结果才发现价格那篇根本没进来。调 RAG 先看检索到了什么。

**以为检索不到就会返回空。** 向量检索永远返回 k 篇,哪怕都不相关。「可以开专票吗」那次,检索到的是发票抬头和套餐价格,得靠 prompt 里的拒答规矩兜底。

**改了资料不重建索引。** 不报错,答旧政策,还带着出处,最难查。资料更新要触发索引线,或者至少有一个检查索引是否过期的任务。

**把查询线和索引线写进同一个脚本、每次提问都重建一遍。** 6 篇时看不出问题,1 万篇时每个问题都要先发 1000 次 embedding 请求。两条线分开,查询线只读索引文件。

## 学习资料

### 文档与文章

- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):读开头「A note on simply using a longer prompt」那一小段,「知识库小于 20 万 token 就直接全塞」的建议出自这里。后面讲 BM25 的部分 Day 219 推荐过。
- [Lewis 等 · Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks(arXiv 2005.11401)](https://arxiv.org/abs/2005.11401):RAG 这个名字的出处,2020 年 Facebook AI 的论文。只读摘要,知道名字从哪来就行,论文里的模型结构今天已经很少有人照着用了。
- [Liu 等 · Lost in the Middle: How Language Models Use Long Contexts(arXiv 2307.03172)](https://arxiv.org/abs/2307.03172):看摘要和那张 U 形曲线图,理解「资料放在中间更容易被忽略」。
- [DeepSeek · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天用的 1M 上下文窗口、2 元/百万的未命中输入价和缓存命中价都在这一页。
- [Datawhale · all-in-rag](https://github.com/datawhalechina/all-in-rag):中文的 RAG 全栈教程,开头几章讲 RAG 是什么、为什么需要,和今天的内容对应,适合用中文再过一遍概念。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1AKRLY4ECg&autoplay=0&high_quality=1" title="RAG是什么?和大模型有什么关系?|RAG工作原理|向量数据库" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小生凡一 · RAG是什么?和大模型有什么关系?|RAG工作原理|向量数据库 · 5 分钟。很短的入门讲解,把「检索、增强、生成」三步和向量数据库的位置讲了一遍,看完对照今天的两条流水线图。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1e4nE6FE26&autoplay=0&high_quality=1" title="一次搞懂RAG到底是啥,为啥是企业AI化几乎必选步骤" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>真观自在 · 一次搞懂RAG到底是啥,为啥是企业AI化几乎必选步骤 · 12 分钟。从企业为什么需要它讲起,正好对应今天「私有数据」和「知识库会长大」两个理由。</figcaption>
</figure>

- 吴恩达《RAG 检索增强生成》课程的中文字幕搬运(眼镜搞不懂AI 上传,BV1Mkgp6uEQB,分 P 很长):第四部分做完 Day 227 以后,挑前几 P 看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/T-D1OfcDW1M" title="What is Retrieval-Augmented Generation (RAG)?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · What is Retrieval-Augmented Generation (RAG)? · 英文,7 分钟。播放量很高的一个白板讲解,讲的正是「模型不知道最新和私有的信息」这两个限制。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/of4UDMvi2Kw" title="A Helping Hand for LLMs (Retrieval Augmented Generation) - Computerphile" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Computerphile · A Helping Hand for LLMs (Retrieval Augmented Generation) · 英文,14 分钟。一位研究者边写边讲 RAG 的来龙去脉,比 IBM 那个讲得更细。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)。第 6 章「RAG and Agents」开头讲 RAG 为什么存在、和长上下文是什么关系,今天读这一章的开头部分。Day 217 提到过「读完 Day 221 再看」,就是现在。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024),中文版《图解大模型:生成式AI原理与实践》(人民邮电出版社,2025)。第 8 章后半讲 RAG,图很多,适合对照今天的流水线图看。

### 开源项目与代码

- [datawhalechina/llm-universe](https://github.com/datawhalechina/llm-universe):Datawhale 的中文大模型应用开发教程,里面有一个完整的个人知识库问答项目,索引线和查询线的分法和今天一样。
- [datawhalechina/all-in-rag](https://github.com/datawhalechina/all-in-rag):上面文档里推荐过的 RAG 教程的代码仓库,每章都有可跑的代码。

## 自测

**1. 大模型的哪两个限制让 RAG 有了存在的理由?今天的第一个实验暴露的是哪一个?**

<details><summary>答案</summary>

一是训练截止日期,之后的新信息它不知道;二是私有数据,训练时没见过你公司的资料。第一个实验暴露的是第二个:CloudLedger 是虚构公司,模型对它的政策一无所知,只能给通用建议,里面的到账时间是按常识编的。

</details>

**2. 知识库只有 20 篇、5400 token,你会用 RAG 吗?为什么?**

<details><summary>答案</summary>

不会,先全塞。5400 token 离 100 万的窗口很远,每问 0.01 元左右,加上前缀缓存还会更便宜;全塞没有「找错」的问题,今天 6 篇的全塞版一次就算对了 800 元,而 top-2 的 RAG 版漏掉了价格那篇。等资料多到窗口装不下或者费用、延迟不可接受,再上检索。

</details>

**3. 说出 RAG 两条流水线的名字、各自包含哪几步、各自什么时候跑。**

<details><summary>答案</summary>

索引线(离线):读文档 → 切块 → 每块算 embedding → 把向量和元数据(编号、原文、模型名)存起来。文档变了才跑,可以慢、可以批量。查询线(在线):把问题编码成向量 → 和所有块的向量算相似度 → 取 top-k → 把这 k 块和问题拼成 prompt → 大模型生成带引用的回答。每个问题都跑,要快。两条线必须用同一个 embedding 模型,唯一的接口是存下来的索引文件(今天是 `vectors.npy` 和 `meta.json`)。

</details>

**4. 你改了 kb-001 的退款时效,客服 Agent 还在说旧时效,而且标着 [kb-001] 的出处。最可能是什么原因?怎么防?**

<details><summary>答案</summary>

索引过期:资料改了,索引线没重跑,查询线读的还是 `meta.json` 里的旧原文。系统不会报错,因为每一步都正常执行了。防法:文档更新时自动触发索引线;或者给索引存一个内容指纹,定期和当前资料比,不一致就报警或重建(练习 3);真实系统里一般按文档或按块记指纹,只重建变了的那部分(Day 231)。

</details>

**5. 面试题:「请画一下你们 RAG 系统的架构,并说说哪些地方出错时不会报错。」**

<details><summary>答案</summary>

先画两条线。索引线:文档源 → 解析和切块 → embedding 服务 → 向量库(连同块编号、原文、来源、embedding 模型名、内容指纹一起存);查询线:用户问题 → embedding 服务(同一个模型)→ 向量库 top-k → 拼 prompt(规矩 + 资料 + 问题)→ 大模型 → 带引用的回答。强调两条线分开部署、分开优化,索引线追求完整和可增量更新,查询线追求延迟和准确。

不报错的地方我会举四个:索引过期(资料改了没重建,答旧内容);索引和查询的 embedding 模型不一致(分数接近随机);切块切坏(检索到的块只有半句话);top-k 太小或者检索排序不好,漏掉需要的资料(模型会合理地说「资料里没有」,看起来像模型的问题,其实是检索的问题)。对应的防法:元数据里存模型名和指纹并在查询前核对;建检索评估集,上线后持续量 recall;日志里记下每次检索到的块编号,出问题时先看检索再看生成。

</details>

## 明天预告

明天是 [Day 222 · 造一份数据:CloudLedger 帮助中心](/blog/agent-zero/day-222-kb-data/)。今天的 `mini_kb.py` 只有 6 篇、每篇一两句,检索时连「切块」都跳过了。明天用一个脚本造出一份像样的帮助中心:20 篇 Markdown 文章,覆盖套餐、退款、发票、导入错误码、账号安全,每篇有标题和几个小节。后面第四部分的切块、建索引、检索、评估,全都用这一份数据,所以文章结构为什么这样设计,明天会讲清楚。
