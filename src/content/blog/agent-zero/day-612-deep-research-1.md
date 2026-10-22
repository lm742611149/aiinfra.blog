---
title: 'Day 612 · Deep Research(一):和 RAG 差在哪,典型架构,读 open_deep_research'
description: 'Deep Research 是一类跑几分钟到几十分钟的 Agent:写研究提纲、派几个研究员并行搜索阅读、压缩成带出处的笔记、最后写成报告。今天先用一个大问题让 RAG 的「检索一次答一次」露馅(8 篇资料只读到 3 篇,最核心的退款政策没读到),再读 LangChain open_deep_research 的图结构、默认参数和并发上限的写法,最后在离线的云簿资料上自己实现一条提纲、并行研究、写报告的流水线,真模型跑一次,顺便踩一个「把分析题拆成搜索题」的坑。'
pubDate: 2026-10-22
regime: none
tags: ['deep-research', 'multi-agent', 'asyncio', 'langgraph', 'agent-zero']
series: 'agent-zero'
day: 612
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 610](/blog/agent-zero/day-610-voice-1/) 和 [Day 611](/blog/agent-zero/day-611-voice-2/) 讲语音 Agent,拼的是几百毫秒:延迟预算、流式衔接、打断以后只把用户听到的字写进历史、看首音频的 P95。

今天的 Deep Research 刚好在另一头。用户不在电话那边等着,他丢一个问题过来,愿意等几分钟甚至几十分钟,换一份有结构、每句话都有出处的报告。延迟不再是第一位的,难点变成了:问题太大,一次检索装不下;资料太多,上下文装不下;报告太长,出处对不对很难查。

## 今天要解决的问题

学完今天你应该能:

1. 说清 Deep Research 和 [Day 221](/blog/agent-zero/day-221-why-rag/) 起学的 RAG 差在哪四个地方,并用一次真实对比看出「检索一次、回答一次」在大问题上漏了什么。
2. 画出 Deep Research 的典型架构(澄清、研究提纲、主管、研究员、压缩、写报告),说清每一步解决什么问题,为什么研究员之间要互相看不见。
3. 在 LangChain 的 open_deep_research 源码里找到这几步对应的节点,读懂并发上限、迭代上限、压缩重试这几处是怎么写的,以及默认参数为什么那么设。
4. 自己实现一条最小的研究流水线(提纲、并行研究、写报告),在离线的云簿资料上用真模型跑一次。

今天两个新概念:**Deep Research 和 RAG 的区别**,以及**它的典型架构**。读源码用到的 LangGraph 都学过:`StateGraph`、子图([Day 324](/blog/agent-zero/day-324-lg-subgraph/))、`Command(goto=..., update=...)`([Day 309](/blog/agent-zero/day-309-lg-command/))。自己写流水线用到:`asyncio.gather` 和 `Semaphore`([Day 68](/blog/agent-zero/day-068-async-3/))、JSON mode([Day 148](/blog/agent-zero/day-148-structured-2/))、主管派活([Day 330](/blog/agent-zero/day-330-multi-agent-2/))、子 Agent 是为了省上下文([Day 332](/blog/agent-zero/day-332-multi-agent-4/))。

预计用时 3 小时。前置:上面列的几天;Day 136 的 `common/llm.py` 能用。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `research.py` 里 `plan`、`research_all`、`write` 三个函数默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 和 RAG 差在哪

RAG 是「为了回答一个问题,检索一次,拼进提示词,答一次」。这对「年付怎么退款」这种问题刚好够:答案就在一两篇文章里。

换一个问题:「整理云簿关于退款、发票和账户注销的规则,指出其中容易让客户误解的地方。」这是客服主管在写培训材料前会问的问题。它和「年付怎么退款」不是一个量级:要覆盖好几个方面,每个方面要读好几篇,还要在读完以后做比较和归纳。Deep Research 想做的,就是把这种「一个人要查半天」的活压到几分钟。

两者的差别集中在四个地方:

- **问题要先变清楚**。「帮我研究一下 Agent 市场」范围太大,先问用户关心哪个地区、哪类客户、要多深;问清楚以后,把它改写成一份明确的**研究提纲**(research brief)。
- **检索是多路、多轮的**。先拆成几个子问题分头查,读完一批再根据读到的内容决定下一步查什么,而不是拿用户原话搜一次。
- **资料量远超上下文**。几十篇网页加起来几十万字,不可能全塞给写报告的模型,中间要**压缩**成笔记。
- **输出是长文,每句要有出处**。读者要能点开引用核对,引用错了比没有引用还糟。引用怎么核验是明天的内容。

光说不直观,先用今天的离线资料跑一次 RAG,看看它在这个大问题上漏了什么。

## 准备:一份离线资料和一个离线搜索

**安全上今天比较简单**:模型能做的只有「读我们给它的资料」,没有执行命令、读写文件、上网的工具。资料是我写的 8 篇虚构的云簿帮助中心文章,搜索也在本地做。真实的 Deep Research 要接网页搜索(open_deep_research 默认用 Tavily),今天先不接,一是省掉申请 key 的步骤,二是离线资料能让每次结果可对照。

如果你跟着 [Day 222](/blog/agent-zero/day-222-kb-data/) 做过 `data/kb/`,也可以用那一份;今天的 8 篇更短,而且我特意在里面放了几处容易让人误解的规则(比如「冷静期内登录即视为撤销注销」),方便看报告有没有找出来。

```bash
cd agent-zero-lab
mkdir -p part10/research
touch part10/research/__init__.py
```

```python
# agent-zero-lab/part10/research/make_kb.py
"""写 8 篇虚构的云簿帮助中心文章,今天的研究任务只在这些离线资料里搜。"""
from pathlib import Path

KB = Path(__file__).parent / "kb"
ARTICLES = {
    "kb-refund": ("退款政策", "年付套餐在购买后 14 天内可全额退款。超过 14 天,按剩余整月数退款,当月不退。"
                  "月付套餐不支持退款,取消后服务用到本期结束。退款原路退回,一般 3 到 5 个工作日到账。"),
    "kb-duplicate": ("重复扣款怎么办", "如果同一张发票被扣款两次,系统会在 24 小时内自动识别并发起退款,"
                     "多扣的金额 3 个工作日内原路退回,不需要申请。超过 24 小时没有自动退回,请提交工单。"),
    "kb-invoice": ("发票开具", "电子发票在付款成功后 24 小时内开具,发送到账户的账单邮箱。"
                   "开票抬头和税号以付款时账户里填写的为准,开出后不能修改抬头,只能红冲后重开。"),
    "kb-redflush": ("发票红冲与重开", "发票开具后 30 天内可以申请红冲重开,每张发票最多重开 1 次。"
                    "已经退款的订单,发票会被自动红冲,不需要另外申请。"),
    "kb-close": ("注销账户", "注销前需要结清所有未付发票,并取消正在生效的订阅。注销申请提交后有 15 天冷静期,"
                 "冷静期内登录即视为撤销注销。冷静期结束后数据永久删除,不能恢复。"),
    "kb-export": ("导出数据", "管理员可以在设置页导出全部账单数据,格式为 CSV。注销冷静期内仍然可以导出,"
                  "冷静期结束后无法导出。单次导出最多包含 5 万行。"),
    "kb-plan": ("套餐升级与降级", "升级立即生效,按剩余天数补差价。降级在当前计费周期结束后生效,"
                "差价不退,也不折算成余额。"),
    "kb-coupon": ("优惠券", "优惠券只能在下单时使用,一个订单只能用一张。使用了优惠券的年付订单退款时,"
                  "按实际支付金额计算,优惠券不返还。"),
}

if __name__ == "__main__":
    KB.mkdir(exist_ok=True)
    for doc_id, (title, body) in ARTICLES.items():
        (KB / f"{doc_id}.md").write_text(f"# {title}\n\n{body}\n", encoding="utf-8")
    print("写了", len(ARTICLES), "篇:", ", ".join(sorted(p.stem for p in KB.glob("*.md"))))
```

<div class="line-notes">

- `KB = Path(__file__).parent / "kb"` 资料放在脚本旁边的 `kb/` 目录。今天所有脚本都只读这个目录。
- `ARTICLES = {` 字典的键是文章 id,值是(标题, 正文)元组。两个相邻的字符串字面量会自动拼成一个,`"a" "b"` 等于 `"ab"`,用来把长正文折成两行写。
- `"kb-plan": ("套餐升级与降级",` 这一篇讲降级差价不退,和「退款」有关但标题里没有「退款」两个字。留意后面谁读到了它。
- `(KB / f"{doc_id}.md").write_text(f"# {title}\n\n{body}\n", encoding="utf-8")` 每篇写成一个 markdown 文件,第一行是标题。
- `sorted(p.stem for p in KB.glob("*.md"))` `glob` 找出目录下所有 `.md`,`.stem` 是去掉扩展名的文件名。

</div>

```bash
uv run python -m part10.research.make_kb
```

```text
写了 8 篇: kb-close, kb-coupon, kb-duplicate, kb-export, kb-invoice, kb-plan, kb-redflush, kb-refund
```

搜索用一个很粗的办法:把查询和文章都切成「两个字一组」(二元组,bigram),数重合了多少组。它不懂语义,但不用 embedding、不用网络,够用来演示流水线。真实系统里你会换成 [Day 226](/blog/agent-zero/day-226-retrieve-answer/) 的向量检索或者网页搜索,只要保持 `search(query, k) -> list[Source]` 这个签名不变,流水线一行都不用改。

```python
# agent-zero-lab/part10/research/local_search.py
"""离线搜索:按「两个字一组」的重合程度给文章打分。没有网络、没有搜索 API 也能把研究流水线跑通。"""
from collections import Counter
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Source:
    id: str
    title: str
    text: str


def bigrams(s: str) -> Counter[str]:
    s = "".join(s.split()).lower()
    return Counter(s[i : i + 2] for i in range(len(s) - 1))


class LocalSearch:
    def __init__(self, folder: Path) -> None:
        self.docs: list[Source] = []
        for p in sorted(folder.glob("*.md")):
            text = p.read_text(encoding="utf-8")
            self.docs.append(Source(p.stem, text.splitlines()[0].lstrip("# "), text))
        self.grams = [bigrams(d.text) for d in self.docs]

    def __call__(self, query: str, k: int = 3) -> list[Source]:
        q = bigrams(query)
        scored = [(sum(min(c, g[t]) for t, c in q.items()), d) for d, g in zip(self.docs, self.grams)]
        scored.sort(key=lambda x: -x[0])
        return [d for score, d in scored[:k] if score > 0]


if __name__ == "__main__":
    search = LocalSearch(Path(__file__).parent / "kb")
    for q in ["年付怎么退款", "发票抬头写错了", "注销后还能导出数据吗"]:
        print(q, "->", [d.id for d in search(q)])
```

<div class="line-notes">

- `@dataclass(frozen=True)` 冻结的 dataclass,创建后字段不能改,像 TS 里的 `Readonly<Source>`。来源一旦检索出来就不该被改。
- `s = "".join(s.split()).lower()` `split()` 按任意空白切开,再拼回去,等于去掉所有空白和换行。
- `return Counter(s[i : i + 2] for i in range(len(s) - 1))` 从每个位置取两个字。「年付怎么退款」得到「年付」「付怎」「怎么」「么退」「退款」5 组。`Counter` 是一个计数字典,相当于 JS 里 `Map<string, number>` 加一个自动计数。
- `text.splitlines()[0].lstrip("# ")` 第一行去掉开头的 `#` 和空格,就是标题。
- `def __call__(self, query: str, k: int = 3) -> list[Source]:` 定义了 `__call__`,实例就能像函数一样调用:`search("年付怎么退款")`。这样它和「一个搜索函数」可以互换。
- `scored = [(sum(min(c, g[t]) for t, c in q.items()), d) for d, g in zip(self.docs, self.grams)]` 对每篇文章,把查询里每个二元组在文章里出现的次数(最多算查询里的次数)加起来当分数。`zip` 把两个列表按位置配对,和 lodash 的 `_.zip` 一样。
- `scored.sort(key=lambda x: -x[0])` 按分数从高到低排。`key` 返回负分数,升序排就成了降序。
- `return [d for score, d in scored[:k] if score > 0]` 取前 k 篇,零分的不要。

</div>

```bash
uv run python -m part10.research.local_search
```

```text
年付怎么退款 -> ['kb-coupon', 'kb-duplicate', 'kb-refund']
发票抬头写错了 -> ['kb-invoice', 'kb-close', 'kb-duplicate']
注销后还能导出数据吗 -> ['kb-export', 'kb-close']
```

第一行就看得出它有多粗:「年付怎么退款」排第一的是优惠券那篇(因为里面有「年付订单退款」),真正的退款政策排第三。好在 k=3 还是捞到了。记住这个现象,后面会再碰到。

## 第 1 步:先让 RAG 试一次

对照组:拿用户的原话检索一次,取 3 篇,拼进提示词,答一次。这就是 [Day 226](/blog/agent-zero/day-226-retrieve-answer/) 的做法,只是把向量检索换成了今天的离线搜索。

```python
# agent-zero-lab/part10/research/rag_once.py
"""对照组:用 RAG 的老办法,检索一次、拼进提示词、回答一次,看大问题会漏掉什么。"""
from pathlib import Path

from common.llm import LLMClient
from part10.research.local_search import LocalSearch

QUESTION = "整理云簿关于退款、发票和账户注销的规则,指出其中容易让客户误解的地方。"

search = LocalSearch(Path(__file__).parent / "kb")
docs = search(QUESTION, k=3)
context = "\n\n".join(f"[{d.id}]\n{d.text}" for d in docs)
llm = LLMClient()
r = llm.chat([
    {"role": "system", "content": "只根据资料回答,每条结论后用 [id] 标出处。资料里没有的不要写。"},
    {"role": "user", "content": f"资料:\n{context}\n\n问题:{QUESTION}"},
])
print("检索到:", [d.id for d in docs])
print(r.content)
print(llm.ledger)
```

<div class="line-notes">

- `docs = search(QUESTION, k=3)` 用整句原话检索一次,只取 3 篇。这是 RAG 的典型设置。
- `context = "\n\n".join(f"[{d.id}]\n{d.text}" for d in docs)` 每篇前面标上 id,模型才能在回答里引用。
- `{"role": "system", "content": "只根据资料回答,每条结论后用 [id] 标出处` [Day 227](/blog/agent-zero/day-227-rag-prompt/) 讲过的 RAG 提示词:只用资料、标出处、没有就不写。

</div>

```bash
uv run python -m part10.research.rag_once
```

```text
检索到: ['kb-close', 'kb-duplicate', 'kb-invoice']
**退款规则**
- 同一张发票被扣款两次时，系统会在 24 小时内自动识别并发起退款，多扣的金额 3 个工作日内原路退回，不需要申请；超过 24 小时没有自动退回，需提交工单。[kb-duplicate]

**发票规则**
- 电子发票在付款成功后 24 小时内开具，发送到账户的账单邮箱。[kb-invoice]
- 开票抬头和税号以付款时账户里填写的为准，开出后不能修改抬头，只能红冲后重开。[kb-invoice]

**账户注销规则**
- 注销前需要结清所有未付发票，并取消正在生效的订阅。[kb-close]
- 注销申请提交后有 15 天冷静期，冷静期内登录即视为撤销注销。[kb-close]
- 冷静期结束后数据永久删除，不能恢复。[kb-close]

**容易让客户误解的地方**
- 退款方面：客户可能误以为重复扣款需要自己申请退款，但规则是系统自动识别并发起退款，不需要申请；只有超过 24 小时没有自动退回才需提交工单。[kb-duplicate]
- 发票方面：客户可能误以为发票抬头开出后还能修改，但规则是开出后不能修改抬头，只能红冲后重开。[kb-invoice]
- 账户注销方面：客户可能误以为提交注销申请后立即进入删除流程，但实际有 15 天冷静期，且冷静期内登录即视为撤销注销；冷静期结束后数据永久删除、不能恢复。[kb-close]
1 次调用 | 输入 227 / 输出 336 tokens | 约 ¥0.0031
```

这份回答单看挺像样,每句都有出处,也没编东西。问题在**它不知道自己没看到什么**。8 篇里只读了 3 篇,最核心的 `kb-refund`(14 天全额退、月付不退)根本没读到,于是「退款规则」那一节只剩重复扣款一条;红冲重开、导出数据、优惠券不返还也都没出现。用户拿着这份回答去写培训材料,会以为云簿的退款规则就只有「重复扣款自动退」。

原因不在模型,在流程:一句话里塞了三个主题,一次检索只能取前 3 篇,分数又被「注销」「发票」这些词带着走。这就是 Deep Research 要解决的第一个问题:**大问题要先拆开,分头去查**。

## 典型架构

Deep Research 的各家实现长得不一样,但骨架基本是这样:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Deep Research 的典型架构:澄清问题、写研究提纲、主管拆题派活,多个研究员并行搜索阅读并压缩成笔记交回主管,主管判断够不够,最后写报告">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <rect x="16" y="24" width="100" height="46" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="66" y="44" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">澄清问题</text>
  <text x="66" y="61" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">不清楚就问</text>
  <rect x="136" y="24" width="110" height="46" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="191" y="44" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">研究提纲</text>
  <text x="191" y="61" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">research brief</text>
  <rect x="266" y="24" width="140" height="46" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="336" y="44" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">主管</text>
  <text x="336" y="61" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">拆题、派活、够不够</text>
  <line x1="116" y1="47" x2="136" y2="47" stroke="var(--rule)"/>
  <line x1="246" y1="47" x2="266" y2="47" stroke="var(--rule)"/>
  <rect x="196" y="116" width="120" height="64" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="256" y="138" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">研究员 1</text>
  <text x="256" y="156" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">搜 → 读 → 再搜</text>
  <text x="256" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">→ 压缩成笔记</text>
  <rect x="336" y="116" width="120" height="64" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="396" y="138" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">研究员 2</text>
  <text x="396" y="156" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">搜 → 读 → 再搜</text>
  <text x="396" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">→ 压缩成笔记</text>
  <rect x="476" y="116" width="120" height="64" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="536" y="138" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">研究员 N</text>
  <text x="536" y="156" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">并行,有上限</text>
  <text x="536" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">→ 压缩成笔记</text>
  <line x1="336" y1="70" x2="256" y2="116" stroke="var(--rule)"/>
  <line x1="336" y1="70" x2="396" y2="116" stroke="var(--rule)"/>
  <line x1="336" y1="70" x2="536" y2="116" stroke="var(--rule)"/>
  <line x1="406" y1="40" x2="600" y2="40" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <line x1="600" y1="40" x2="600" y2="116" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="430" y="32" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">笔记交回主管,不够再派一轮</text>
  <rect x="396" y="226" width="200" height="46" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="496" y="246" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">写报告</text>
  <text x="496" y="263" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只看提纲 + 全部笔记</text>
  <line x1="396" y1="180" x2="496" y2="226" stroke="var(--rule)"/>
  <text x="16" y="130" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">研究员之间</text>
  <text x="16" y="148" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">互相看不见,</text>
  <text x="16" y="166" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">原文不往上交</text>
  <text x="16" y="244" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每个研究员可能读几万字,</text>
  <text x="16" y="262" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">往上交的只有几百字的笔记</text>
</svg>
<figcaption>蓝色是模型做判断的地方,琥珀色是大量调用搜索和阅读工具的地方。虚线是主管的循环:看完笔记觉得不够,就再派一轮。</figcaption>
</figure>

一步一步说:

**澄清问题**。范围不清的时候先问用户,别闷头查。它是可选的,open_deep_research 里由 `allow_clarification` 开关控制,默认开。

**研究提纲**。把用户口语化的问题改写成一段明确的任务说明:要覆盖哪些方面、要什么深度、最后要什么形式。后面所有人都对着这份提纲干活,所以它写偏了,后面全偏。

**主管**(supervisor)。读提纲,拆成几个互不重叠的子问题,派给研究员;收回笔记后判断够不够,不够再派一轮。这就是 [Day 330](/blog/agent-zero/day-330-multi-agent-2/) 学的主管派活(orchestrator-worker)。

**研究员**(researcher)。每人只管一个子问题,自己跑一个小的 ReAct 循环:搜、读、根据读到的再搜,直到觉得够了或者工具调用次数到上限。

**压缩**(compress)。研究员读过的原文不往上交,只交一份整理过的、带出处的笔记。

**写报告**。另一个模型只拿着提纲和全部笔记,一次写成长文,每句标出处。LangChain 的博客里讲过,他们早期版本让几个子 Agent 并行各写一节,快是快,可各节之间协调不好,报告读起来各说各话;后来改成多 Agent 只负责研究,报告在所有笔记到齐后由一次调用写完。

这个架构里最关键的一条,是**研究员之间互相看不见,原文不往上交**。[Day 332](/blog/agent-zero/day-332-multi-agent-4/) 讲过,子 Agent 少数几个实打实的好处之一就是上下文隔离:每个研究员可以读几万字,进到主管和写报告那个模型上下文里的,只有几百字的笔记。没有这一层,读到第十篇网页时上下文就满了,而且写报告的模型在一大堆原文里更容易抓错依据。

## 读 open_deep_research 的源码

LangChain 的 [open_deep_research](https://github.com/langchain-ai/open_deep_research) 是这个架构最清楚的开源实现。我读的是 2026 年 8 月 10 日的提交 `1b7d2e80`(查的时候 main 分支最新的一次)。核心就四个文件,都在 `src/open_deep_research/` 下:

| 文件 | 行数 | 里面是什么 |
| --- | --- | --- |
| `deep_researcher.py` | 718 | 整张图:所有节点函数和三张图(主图、主管子图、研究员子图) |
| `configuration.py` | 251 | 所有可调参数和默认值 |
| `prompts.py` | 367 | 主管、研究员、压缩、写报告各自的提示词 |
| `state.py` | 95 | 各张图的状态,以及主管能调用的工具 `ConductResearch`、`ResearchComplete` |

想自己读,用 curl 把这几个文件下到你的工作目录里看就行,不用 clone 整个仓库,更不用装它的依赖:

```bash
mkdir -p ~/odr-read && cd ~/odr-read
for f in deep_researcher.py configuration.py state.py prompts.py; do
  curl -s -o $f https://raw.githubusercontent.com/langchain-ai/open_deep_research/main/src/open_deep_research/$f
done
wc -l *.py
grep -n "add_node" deep_researcher.py
```

`grep add_node` 能直接看到三张图各有哪些节点,和上面那张架构图一一对应:

```text
356:supervisor_builder.add_node("supervisor", supervisor)           # Main supervisor logic
357:supervisor_builder.add_node("supervisor_tools", supervisor_tools)  # Tool execution handler
596:researcher_builder.add_node("researcher", researcher)                 # Main researcher logic
597:researcher_builder.add_node("researcher_tools", researcher_tools)     # Tool execution handler
598:researcher_builder.add_node("compress_research", compress_research)   # Research compression
708:deep_researcher_builder.add_node("clarify_with_user", clarify_with_user)           # User clarification phase
709:deep_researcher_builder.add_node("write_research_brief", write_research_brief)     # Research planning phase
710:deep_researcher_builder.add_node("research_supervisor", supervisor_subgraph)       # Research execution phase
711:deep_researcher_builder.add_node("final_report_generation", final_report_generation)  # Report generation phase
```

主图四个节点:`clarify_with_user`(澄清)、`write_research_brief`(提纲)、`research_supervisor`(整个主管子图被当成一个节点放进来,就是 Day 324 的子图)、`final_report_generation`(写报告)。主管子图是 `supervisor` 和 `supervisor_tools` 两个节点来回跳,研究员子图是 `researcher` 和 `researcher_tools` 来回跳,最后进 `compress_research`。这种「模型节点 + 工具节点」来回跳的结构,就是你在第三部分手写过的 Agent 循环,只是画成了图。

### 并发上限:用工具返回值约束模型

主管怎么派活?它不是输出一个 JSON 列表,而是**调用工具**:每想派一个研究员,就调一次 `ConductResearch(research_topic=...)`,一轮里可以并行调好几次。`supervisor_tools` 节点负责执行这些调用。最值得看的是下面这一段(原文有删节,只留关键行):

```python
# open_deep_research/src/open_deep_research/deep_researcher.py(节选,第 288–320 行附近)
if conduct_research_calls:
    try:
        allowed_conduct_research_calls = conduct_research_calls[:configurable.max_concurrent_research_units]
        overflow_conduct_research_calls = conduct_research_calls[configurable.max_concurrent_research_units:]
        research_tasks = [
            researcher_subgraph.ainvoke({
                "researcher_messages": [HumanMessage(content=tool_call["args"]["research_topic"])],
                "research_topic": tool_call["args"]["research_topic"]
            }, config)
            for tool_call in allowed_conduct_research_calls
        ]
        tool_results = await asyncio.gather(*research_tasks)
        for observation, tool_call in zip(tool_results, allowed_conduct_research_calls):
            all_tool_messages.append(ToolMessage(
                content=observation.get("compressed_research", "Error synthesizing research report: Maximum retries exceeded"),
                name=tool_call["name"],
                tool_call_id=tool_call["id"]
            ))
        for overflow_call in overflow_conduct_research_calls:
            all_tool_messages.append(ToolMessage(
                content=f"Error: Did not run this research as you have already exceeded the maximum number of concurrent research units. Please try again with {configurable.max_concurrent_research_units} or fewer research units.",
                name="ConductResearch",
                tool_call_id=overflow_call["id"]
            ))
    except Exception as e:
        if is_token_limit_exceeded(e, configurable.research_model) or True:
            return Command(goto=END, update={"notes": get_notes_from_tool_calls(supervisor_messages)})
```

<div class="line-notes">

- `if conduct_research_calls:` 主管这一轮发出的所有 `ConductResearch` 工具调用。
- `allowed_conduct_research_calls = conduct_research_calls[:configurable.max_concurrent_research_units]` 列表切片,前 N 个(默认 5 个)放行。
- `overflow_conduct_research_calls = conduct_research_calls[configurable.max_concurrent_research_units:]` 第 N 个以后的全部算超额。
- `researcher_subgraph.ainvoke({` 每个放行的任务启动一个研究员子图,输入只有一条消息:主管写的 `research_topic`。**研究员看不到主管的历史,也看不到别的研究员**,这就是上下文隔离在代码里的样子。所以 `prompts.py` 里专门叮嘱主管:派活时要给「完整、独立的说明」,别用缩写,因为研究员看不到其他人的工作。
- `tool_results = await asyncio.gather(*research_tasks)` 所有研究员并行跑,和 JS 的 `Promise.all` 一样,全部完成才往下走。
- `content=observation.get("compressed_research",` 交回主管的是研究员子图输出里的 `compressed_research`,也就是压缩后的笔记,不是原文。拿不到时给一句错误信息。
- `for overflow_call in overflow_conduct_research_calls:` 超额的任务**不执行**,但每一个都回一条工具结果,内容是错误信息:你超过上限了,请用 N 个或更少重试。
- `if is_token_limit_exceeded(e, configurable.research_model) or True:` 留意末尾的 `or True`:条件永远为真。不管是 token 超限还是别的什么异常,一律结束研究阶段,拿已有的笔记去写报告。这可能是作者有意为之(长任务里宁可交一份不完整的报告,也别整个挂掉),也可能是调试时留下的,源码里没有说明。读源码时这种地方要记下来:它决定了系统出错时的行为。

</div>

超额那一段是这里最值得学的设计。它没有指望提示词里一句「最多派 5 个」,而是**在代码里硬切**,再把「为什么没执行、该怎么改」作为工具结果还给模型。模型下一轮看到这条错误,自然会合并任务重新派。这和 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 讲工具设计时说的「错误信息要告诉模型下一步怎么做」是同一个原则。练习 2 会照着写一个。

### 其他几个上限和默认值

`configuration.py` 里和研究过程有关的默认值(这一版):

| 参数 | 默认值 | 管什么 |
| --- | --- | --- |
| `allow_clarification` | `True` | 要不要先问用户澄清 |
| `max_concurrent_research_units` | 5 | 主管一轮最多派几个研究员 |
| `max_researcher_iterations` | 6 | 主管最多来回几轮(超过就直接结束研究阶段) |
| `max_react_tool_calls` | 10 | 每个研究员最多调几次工具(超过就去压缩) |
| `max_content_length` | 50000 | 一篇网页超过多少字符先总结再给模型 |
| `search_api` | `tavily` | 搜索用哪家,还可以选 OpenAI 或 Anthropic 自带的搜索,或者不搜 |
| `summarization_model` | `openai:gpt-4.1-mini` | 总结网页用的模型 |
| `research_model` / `compression_model` / `final_report_model` | `openai:gpt-4.1` | 研究、压缩、写报告用的模型 |

两点值得多想一下。

**每一层都有硬上限**:主管轮数、并发数、每个研究员的工具调用数。长任务 Agent 最怕的是停不下来,一个研究员陷在「再搜一次就好」里,一晚上就能烧掉不少钱。这些上限是写在代码判断里的(比如研究员那边 `exceeded_iterations = state.get("tool_call_iterations", 0) >= configurable.max_react_tool_calls`),不靠模型自觉。

**模型是分层配置的**:总结网页这种量大、简单的活用小模型(`gpt-4.1-mini`),研究和写报告用大模型。网页读入通常是成本的大头,这一层用小模型最省。这和 [Day 399](/blog/agent-zero/day-399-model-routing/) 的模型路由是同一个思路。

再看 `prompts.py` 里给主管的提示词,有一段 `<Scaling Rules>`:简单的查事实、列清单用 1 个研究员;用户明确要比较几样东西时,每样一个研究员;前面还有一条 **「Bias towards single agent」**,能用一个就别用多个。以及一句很关键的分工说明:「A separate agent will write the final report - you just need to gather information」,写报告是另一个 Agent 的事,主管只管收集信息。下面自己写流水线时,我就因为没写这句踩了坑。

open_deep_research 本身我没有实跑:它默认要 OpenAI 和 Tavily 两个 key,我手头没有。今天只读源码,流水线用自己的最小版本。

## 第 2 步:自己写一条最小流水线

照着上面的架构,写一个最小版:主管一次调用写出提纲和子问题;研究员并行跑,每人检索一次、压缩成带出处的笔记;最后写报告。先不做澄清和「够不够」的循环,练习 1 再加。

这里有一个前面没用过的函数:`asyncio.to_thread(函数, 参数...)`。Day 136 的 `LLMClient.chat()` 是同步的,直接在协程里调会卡住事件循环(Day 611 刚演示过这种事)。`to_thread` 把它丢到一个后台线程里跑,返回一个可以 `await` 的对象,事件循环就能同时管好几个。类比前端,有点像把重活交给 Web Worker,主线程只等结果。

```python
# agent-zero-lab/part10/research/research.py
"""最小的 Deep Research 流水线:研究提纲 -> 并行研究(检索 + 压缩成带出处的笔记)-> 写报告。
模型只能读 kb/ 里的离线资料,不碰网络和本机其他文件。"""
import asyncio
import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from common.llm import LLMClient
from part10.research.local_search import LocalSearch, Source

PLAN_PROMPT = """你是研究主管。把用户的问题改写成一段研究提纲(brief),再拆成不超过 {n} 个互不重叠的子问题。
只输出 JSON:{{"brief": "...", "subquestions": ["...", "..."]}}
用户的问题:{q}"""

NOTE_PROMPT = """你是研究员,只负责这个子问题:{sq}
下面是检索到的资料,每篇有 id。只根据资料写 3 到 6 条要点,每条结尾用 [id] 标出处;资料里没有的写「资料中未找到」。
{docs}"""

WRITE_PROMPT = """根据研究笔记写一份中文报告。研究提纲:{brief}
要求:分小节;每个事实句结尾用 [id] 标出处,id 只能用笔记里出现过的;笔记里没有的不要写。
{notes}"""


@dataclass
class Budget:
    max_subquestions: int = 4  # 最多拆几个子问题
    max_concurrency: int = 3  # 同时跑几个研究员
    docs_per_query: int = 3  # 每个子问题读几篇


@dataclass
class Note:
    subquestion: str
    text: str
    source_ids: list[str] = field(default_factory=list)
    seconds: float = 0.0


def plan(q: str, llm: LLMClient, budget: Budget) -> tuple[str, list[str]]:
    r = llm.chat([{"role": "user", "content": PLAN_PROMPT.format(n=budget.max_subquestions, q=q)}],
                 response_format={"type": "json_object"})
    try:
        data = json.loads(r.content)
        return str(data["brief"]), [str(s) for s in data["subquestions"]][: budget.max_subquestions]
    except (json.JSONDecodeError, KeyError, TypeError):
        return q, [q]  # 规划失败就退化成一个子问题,别让整个任务挂掉


def research_one(sq: str, llm: LLMClient, search: LocalSearch, budget: Budget) -> Note:
    start = time.perf_counter()
    docs: list[Source] = search(sq, budget.docs_per_query)
    block = "\n\n".join(f'<doc id="{d.id}">\n{d.text}\n</doc>' for d in docs)
    r = llm.chat([{"role": "user", "content": NOTE_PROMPT.format(sq=sq, docs=block)}])
    return Note(sq, r.content, [d.id for d in docs], time.perf_counter() - start)


async def research_all(subqs: list[str], llm: LLMClient, search: LocalSearch, budget: Budget) -> list[Note]:
    sem = asyncio.Semaphore(budget.max_concurrency)

    async def guarded(sq: str) -> Note:
        async with sem:
            return await asyncio.to_thread(research_one, sq, llm, search, budget)

    return list(await asyncio.gather(*(guarded(sq) for sq in subqs)))


def write(brief: str, notes: list[Note], llm: LLMClient) -> str:
    notes_text = "\n\n".join(f"## {n.subquestion}\n{n.text}" for n in notes)
    return llm.chat([{"role": "user", "content": WRITE_PROMPT.format(brief=brief, notes=notes_text)}]).content


def run(q: str, budget: Budget | None = None) -> None:
    budget = budget or Budget()
    llm = LLMClient()
    search = LocalSearch(Path(__file__).parent / "kb")
    t0 = time.perf_counter()
    brief, subqs = plan(q, llm, budget)
    print("提纲:", brief)
    for i, sq in enumerate(subqs, 1):
        print(f"  子问题 {i}: {sq}")
    t1 = time.perf_counter()
    notes = asyncio.run(research_all(subqs, llm, search, budget))
    t2 = time.perf_counter()
    for n in notes:
        print(f"  研究员「{n.subquestion[:12]}…」读了 {n.source_ids},用时 {n.seconds:.1f}s")
    print(f"研究阶段墙钟 {t2 - t1:.1f}s,各研究员加起来 {sum(n.seconds for n in notes):.1f}s")
    report = write(brief, notes, llm)
    print(f"写报告 {time.perf_counter() - t2:.1f}s,全程 {time.perf_counter() - t0:.1f}s")
    used = sorted({i for n in notes for i in n.source_ids})
    print("读过的资料:", used)
    print("----- 报告 -----")
    print(report)
    print("-----")
    print(llm.ledger)


if __name__ == "__main__":
    run("整理云簿关于退款、发票和账户注销的规则,指出其中容易让客户误解的地方。")
```

<div class="line-notes">

- `PLAN_PROMPT = """你是研究主管。` 主管的提示词:一次输出提纲和子问题。`{{` `}}` 是 `str.format` 里字面的大括号,不然会被当成占位符。
- `NOTE_PROMPT = """你是研究员,只负责这个子问题:{sq}` 研究员的提示词。它只看到自己的子问题和检索到的资料,看不到用户原话,也看不到别的研究员,和 open_deep_research 一样。「资料里没有的写资料中未找到」是让它承认缺口,而不是编。
- `WRITE_PROMPT = """根据研究笔记写一份中文报告。` 写报告的模型只拿到提纲和笔记,原文一篇都看不到。
- `class Budget:` 所有上限集中在一处:子问题数、并发数、每题读几篇。对应 open_deep_research 的 `Configuration`。
- `class Note:` 研究员交回的东西:子问题、笔记正文、读了哪几篇、用了几秒。
- `response_format={"type": "json_object"})` [Day 148](/blog/agent-zero/day-148-structured-2/) 讲过的 JSON mode,DeepSeek 支持;它不支持 `json_schema`,所以字段名靠提示词约定。
- `return str(data["brief"]), [str(s) for s in data["subquestions"]][: budget.max_subquestions]` 取出提纲和子问题,子问题多了就截断。这里是直接丢掉超出的,和 open_deep_research「回一条错误让模型重来」不同,练习 2 会讲差别。
- `except (json.JSONDecodeError, KeyError, TypeError):` 三种可能的失败:不是合法 JSON、缺字段、字段类型不对。
- `return q, [q]  # 规划失败就退化成一个子问题` 降级而不是崩溃:最差也能按 RAG 的方式跑一遍。长任务里每一步都要想「这步失败了怎么办」。
- `block = "\n\n".join(f'<doc id="{d.id}">\n{d.text}\n</doc>' for d in docs)` 用标签把每篇资料包起来,[Day 143](/blog/agent-zero/day-143-prompt-5/) 讲过的标签分隔,让模型分清哪段是哪篇、哪段是资料哪段是指令。
- `sem = asyncio.Semaphore(budget.max_concurrency)` [Day 68](/blog/agent-zero/day-068-async-3/) 学的信号量,同时最多 3 个研究员在跑。
- `async with sem:` 拿到一个名额才进去,出来时自动还回去。
- `return await asyncio.to_thread(research_one, sq, llm, search, budget)` 把同步的 `research_one` 丢到后台线程跑。几个线程共用同一个 `llm`,它的 `ledger` 是简单的加法,在 CPython 里这种程度的并发一般不会出错,但严格说不是线程安全的;要精确记账,可以每个研究员各用一个 `LLMClient`。
- `return list(await asyncio.gather(*(guarded(sq) for sq in subqs)))` 所有子问题一起开跑,结果按子问题的顺序返回。
- `used = sorted({i for n in notes for i in n.source_ids})` 集合推导去重:全部研究员合起来读过哪几篇。这是今天和 RAG 对比的关键指标。

</div>

```bash
uv run python -m part10.research.research
```

第一次跑的结果(报告很长,我只留了开头和最后一节):

```text
提纲: 系统梳理云簿平台（一家云服务/云记账服务提供方）关于退款、发票开具与账户注销三类事项的正式规则，识别其中表述含糊、与用户直觉不符或易被误读的条款，并说明误解来源与影响。
  子问题 1: 云簿的退款规则（适用情形、时限、计算方式、到账周期与限制条件）具体如何规定？
  子问题 2: 云簿的发票开具规则（可开票类型、时点、红冲与换开流程）具体如何规定？
  子问题 3: 云簿的账户注销规则（前提条件、数据处理与余额/发票处置）具体如何规定？
  子问题 4: 上述三类规则中哪些条款存在表述模糊或与用户预期不符、容易引发误解？
  研究员「云簿的退款规则（适用情形…」读了 ['kb-coupon', 'kb-refund', 'kb-duplicate'],用时 1.5s
  研究员「云簿的发票开具规则（可开…」读了 ['kb-invoice', 'kb-redflush', 'kb-close'],用时 1.2s
  研究员「云簿的账户注销规则（前提…」读了 ['kb-close', 'kb-invoice', 'kb-export'],用时 1.2s
  研究员「上述三类规则中哪些条款存…」读了 [],用时 0.9s
研究阶段墙钟 2.0s,各研究员加起来 4.7s
写报告 2.6s,全程 6.6s
读过的资料: ['kb-close', 'kb-coupon', 'kb-duplicate', 'kb-export', 'kb-invoice', 'kb-redflush', 'kb-refund']
----- 报告 -----
# 云簿平台退款、发票开具与账户注销规则研究报告

## 一、退款规则

云簿平台的退款规则按套餐类型区分适用情形。年付套餐购买后 14 天内可申请全额退款；超过 14 天的，按剩余整月数退款，且当月不退。[kb-refund] 月付套餐不支持退款，用户取消后服务仍可使用至本期结束。[kb-refund]
...
## 四、表述模糊或易引发误解的条款识别

资料中未找到三类规则的具体条款内容，因此无法判断哪些条款存在表述模糊、与用户预期不符或容易引发误解。[资料中未找到]
-----
6 次调用 | 输入 1675 / 输出 1219 tokens | 约 ¥0.0131
```

好的一面先看:8 篇里读到了 7 篇,RAG 漏掉的 `kb-refund`、`kb-redflush`、`kb-export`、`kb-coupon` 都读到了,报告的退款一节第一句就是 14 天全额退款。研究阶段墙钟 2.0 秒,4 个研究员加起来 4.7 秒,并行省了一半多。

坏的一面在最后一节:用户最想要的「容易误解的地方」,报告说「无法判断」。原因看子问题 4:「上述三类规则中哪些条款存在表述模糊……」。这不是一个能**查**的问题,是一个要**想**的问题。它被派给了一个研究员,研究员拿这句话去搜,一篇都没搜到(`读了 []`),老老实实写了「资料中未找到」;写报告的模型看到这条笔记,也就照着说无法判断。还有一个附带的问题:最后那个 `[资料中未找到]` 被写成了引用的样子,明天做引用核验时要能抓出这种假引用。

这就是 open_deep_research 的提示词里那句「A separate agent will write the final report - you just need to gather information」要防的事。**子问题必须能靠查资料回答,比较、归纳、找问题这类分析留给写报告的那一步**。在主管提示词里补上这条规则:

```python
PLAN_PROMPT = """你是研究主管。把用户的问题改写成一段研究提纲(brief),再拆成不超过 {n} 个互不重叠的子问题。
每个子问题都必须能靠查资料回答;对比、归纳、找问题这类分析不要拆成子问题,写进 brief,留给最后写报告的人做。
只输出 JSON:{{"brief": "...", "subquestions": ["...", "..."]}}
用户的问题:{q}"""
```

<div class="line-notes">

- `每个子问题都必须能靠查资料回答;` 新加的一行。分析类的要求不是删掉,而是写进 brief,写报告的模型能看到 brief。

</div>

再跑一次:

```text
提纲: 整理云簿（云记账/云财务软件服务商）在退款、发票和账户注销三方面的公开规则条款，汇总各环节的适用条件、时限、费用与例外情形；随后对比三类规则之间及与客户常见预期的差异，归纳出客户容易误解或产生争议的条款表述与流程设计，并指出信息不透明或表述模糊之处。
  子问题 1: 云簿的退款规则是什么？包括可退款情形、退款时限、手续费或扣减、不可退款情形及申请流程。
  子问题 2: 云簿的发票规则是什么？包括开票类型（增值税普票/专票）、开票时点与条件、红冲或换开流程、退订后发票处理方式。
  子问题 3: 云簿的账户注销规则是什么？包括注销条件（如欠费、合约期、数据保留）、注销流程、注销后数据处理与不可恢复说明、注销与退款的先后关系。
  研究员「云簿的退款规则是什么？包…」读了 ['kb-refund', 'kb-coupon', 'kb-duplicate'],用时 1.2s
  研究员「云簿的发票规则是什么？包…」读了 ['kb-invoice', 'kb-redflush', 'kb-close'],用时 1.2s
  研究员「云簿的账户注销规则是什么…」读了 ['kb-close', 'kb-export', 'kb-invoice'],用时 1.4s
研究阶段墙钟 1.4s,各研究员加起来 3.8s
写报告 6.3s,全程 9.6s
读过的资料: ['kb-close', 'kb-coupon', 'kb-duplicate', 'kb-export', 'kb-invoice', 'kb-redflush', 'kb-refund']
----- 报告 -----
...
## 六、客户容易误解或产生争议的条款与流程设计

1. **月付套餐不可退款**：取消后仅可用到本期结束 [kb-refund]，客户容易误以为按月付费可按比例退还。
2. **年付超 14 天退款的"当月不退"**：按剩余整月数退款、当月不退 [kb-refund]，计算方式易引发争议。
3. **优惠券不返还**：退款按实际支付金额计算 [kb-coupon]，客户容易预期优惠券退回。
4. **抬头开出后不可修改**：只能红冲后重开，且 30 天内、每张最多重开 1 次 [kb-invoice][kb-redflush]，客户容易误以为可随时改抬头。
5. **注销冷静期内登录即撤销**：客户容易误以为登录查看不影响注销 [kb-close]。
6. **冷静期结束后数据无法导出**：数据永久删除、不能恢复 [kb-close][kb-export]，客户容易误以为注销后仍可导出备份。

## 七、信息不透明或表述模糊之处

1. 退款申请流程：资料中未找到 [资料中未找到]。
2. 开票类型（增值税普票/专票的具体区分规则）：资料中未找到 [kb-invoice][kb-redflush]。
3. 欠费、合约期等其它注销条件：资料中未找到。
4. 注销与退款的先后关系：资料中未找到。
5. 退款手续费：笔记中未见单独条款，仅可确认超 14 天按剩余整月数退款、当月不退及优惠券不返还等扣减情形 [kb-refund][kb-coupon]。
-----
5 次调用 | 输入 1683 / 输出 2133 tokens | 约 ¥0.0204
```

这次子问题只剩 3 个,全是能查的;「容易误解」那一节列了 6 条,我特意埋的「冷静期内登录即视为撤销注销」被找出来了(第 5 条),「冷静期结束后无法导出」也在。报告一共七节,还多了一节「信息不透明之处」,把资料里确实没写的东西(申请流程、普票专票)列了出来,这对写培训材料的人很有用:知道哪些要去问产品。

但它还是有两处不对劲,留给你带着问题去看:

- **`kb-plan` 一次都没读到**。「降级差价不退,也不折算成余额」是一条非常容易被客户误解的退款相关规则,可三个子问题的措辞里都没有「降级」「差价」,二元组搜索就搜不到它。这就是架构图里那条虚线(主管看完笔记判断「够不够」)存在的意义,练习 1 会加上它看看能不能补回来。
- 第七节第 2 条写着「资料中未找到」,后面却挂着 `[kb-invoice][kb-redflush]` 两个引用,引用和内容对不上;第 1 条的 `[资料中未找到]` 又是一个假引用。**有引用不等于引用对**,明天的引用核验专门处理这件事。

花费:RAG 对照 ¥0.0031,两次流水线 ¥0.0131 + ¥0.0204。第二次输出 2133 tokens,大部分在报告上;按 `.env` 的价格,输出 2133 × 8 / 1e6 ≈ ¥0.017,输入 1683 × 2 / 1e6 ≈ ¥0.0034,合计约 ¥0.020,和账本一致。Deep Research 的钱主要花在两头:研究员读资料(输入)和写长报告(输出)。今天资料很短,所以大头是输出;换成网页,每篇几千字,输入会迅速变成大头,这时 open_deep_research 那个「网页先用小模型总结」就很关键了。

## 回头再看:和 RAG 的差别落在了哪

把今天两次跑的结果放在一起:

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="RAG 检索一次读到 3 篇资料、1 次模型调用;Deep Research 流水线拆成 3 个子问题并行研究,读到 7 篇资料、5 次模型调用">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <text x="16" y="34" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">RAG</text>
  <rect x="80" y="18" width="110" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="135" y="37" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">原话检索一次</text>
  <rect x="206" y="18" width="90" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="251" y="37" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">答一次</text>
  <line x1="190" y1="32" x2="206" y2="32" stroke="var(--rule)"/>
  <text x="316" y="30" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">读到 3/8 篇,1 次调用,¥0.0031</text>
  <text x="316" y="46" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">核心的退款政策没读到</text>
  <text x="16" y="110" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Deep</text>
  <text x="16" y="126" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Research</text>
  <rect x="80" y="96" width="70" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="115" y="115" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">提纲</text>
  <rect x="166" y="70" width="80" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="206" y="87" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">退款</text>
  <rect x="166" y="98" width="80" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="206" y="115" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">发票</text>
  <rect x="166" y="126" width="80" height="24" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="206" y="143" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">注销</text>
  <rect x="262" y="96" width="70" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="297" y="115" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">写报告</text>
  <line x1="150" y1="110" x2="166" y2="82" stroke="var(--rule)"/>
  <line x1="150" y1="110" x2="166" y2="110" stroke="var(--rule)"/>
  <line x1="150" y1="110" x2="166" y2="138" stroke="var(--rule)"/>
  <line x1="246" y1="82" x2="262" y2="110" stroke="var(--rule)"/>
  <line x1="246" y1="110" x2="262" y2="110" stroke="var(--rule)"/>
  <line x1="246" y1="138" x2="262" y2="110" stroke="var(--rule)"/>
  <text x="352" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">读到 7/8 篇,5 次调用,¥0.0204</text>
  <text x="352" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">研究阶段并行:墙钟 1.4s,串行要 3.8s</text>
  <text x="352" y="136" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">还漏了 kb-plan(降级差价不退)</text>
  <line x1="16" y1="176" x2="624" y2="176" stroke="var(--rule)"/>
  <text x="16" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">多花的 6 倍钱,换来的是覆盖面;覆盖面仍然取决于子问题拆得好不好</text>
</svg>
<figcaption>同一个问题、同一份资料、同一个模型。差别全在流程:拆题、分头查、只交笔记。</figcaption>
</figure>

这张图也说明了什么时候**不该**用 Deep Research:「年付怎么退款」这种一两篇文章就能答的问题,多花 6 倍的钱和几倍的时间换不来什么。open_deep_research 的提示词里写「Bias towards single agent」,就是这个意思。

## 动手练习

**练习 1:加上「够不够」的一轮。** 研究完第一轮后,让主管看着提纲和全部笔记判断还缺什么,缺的话给出最多 2 个新的、能查的子问题,再派一轮。最多 2 轮。看能不能把 `kb-plan` 补回来。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/research/ex612_reflect.py
"""练习 1:研究完一轮后,让主管看笔记判断「够不够」,不够就再派一轮(最多 max_rounds 轮)。"""
import asyncio
import json
from pathlib import Path

from common.llm import LLMClient
from part10.research.local_search import LocalSearch
from part10.research.research import Budget, Note, plan, research_all

REFLECT_PROMPT = """你是研究主管。研究提纲:{brief}
已有笔记如下。判断要完成提纲还缺哪些事实;缺的话给出不超过 {n} 个新的、能靠查资料回答的子问题,不要重复已问过的。
只输出 JSON:{{"enough": true 或 false, "subquestions": [...]}}
已问过:{asked}
笔记:
{notes}"""


def reflect(brief: str, notes: list[Note], llm: LLMClient, n: int) -> list[str]:
    asked = [x.subquestion for x in notes]
    text = "\n\n".join(f"## {x.subquestion}\n{x.text}" for x in notes)
    r = llm.chat([{"role": "user", "content": REFLECT_PROMPT.format(brief=brief, n=n, asked=asked, notes=text)}],
                 response_format={"type": "json_object"})
    data = json.loads(r.content)
    return [] if data.get("enough") else [str(s) for s in data.get("subquestions", [])][:n]


def research_with_reflection(q: str, max_rounds: int = 2) -> list[Note]:
    budget, llm = Budget(), LLMClient()
    search = LocalSearch(Path(__file__).parent / "kb")
    brief, subqs = plan(q, llm, budget)
    notes: list[Note] = []
    for round_no in range(1, max_rounds + 1):
        new = asyncio.run(research_all(subqs, llm, search, budget))
        notes += new
        read = sorted({i for x in notes for i in x.source_ids})
        print(f"第 {round_no} 轮 {len(new)} 个子问题,累计读过 {read}")
        if round_no == max_rounds:
            break
        subqs = reflect(brief, notes, llm, n=2)
        print("  主管追加:", subqs or "够了,不再派")
        if not subqs:
            break
    print(llm.ledger)
    return notes


if __name__ == "__main__":
    research_with_reflection("整理云簿关于退款、发票和账户注销的规则,指出其中容易让客户误解的地方。")
```

<div class="line-notes">

- `from part10.research.research import Budget, Note, plan, research_all` 直接复用第 2 步的函数(用的是修过提示词的那版 `plan`)。
- `REFLECT_PROMPT = """你是研究主管。` 对应 open_deep_research 里主管每轮之后用 `think_tool` 反思「找到了什么、缺什么、够不够」那一步。
- `已问过:{asked}` 把问过的子问题告诉它,避免它原样再派一遍。
- `return [] if data.get("enough") else [str(s) for s in data.get("subquestions", [])][:n]` 够了就返回空列表;不够就取最多 n 个新子问题。`.get` 在缺字段时返回默认值,不抛 KeyError。
- `for round_no in range(1, max_rounds + 1):` 轮数有硬上限,对应 `max_researcher_iterations`。没有它,主管可能永远觉得「还不够」。
- `notes += new` 新一轮的笔记追加到总笔记里,`+=` 对列表就是 `extend`。

</div>

```text
第 1 轮 3 个子问题,累计读过 ['kb-close', 'kb-coupon', 'kb-duplicate', 'kb-export', 'kb-invoice', 'kb-redflush']
  主管追加: ['云簿的退款规则中，除重复扣款外，是否还有针对服务未使用、订阅取消或产品质量问题的退款适用情形与金额计算规定？', '云簿发票规则中规定的发票类型（如增值税普通发票/专用发票、电子/纸质）有哪些，以及发票申请时限的具体规定是什么？']
第 2 轮 2 个子问题,累计读过 ['kb-close', 'kb-coupon', 'kb-duplicate', 'kb-export', 'kb-invoice', 'kb-redflush', 'kb-refund']
7 次调用 | 输入 2351 / 输出 1065 tokens | 约 ¥0.0132
```

这次的结果很有意思,和我预想的不一样。第 1 轮这次反而**没读到 `kb-refund`**(同样的提示词,主管这次把退款子问题写成了别的措辞,模型输出不稳定,[Day 112](/blog/agent-zero/day-112-sampling-2/) 讲过);主管看笔记发现「退款规则只有重复扣款」,第 2 轮追加了一个退款子问题,把 `kb-refund` 补回来了。反思这一步确实在起作用。

但 `kb-plan` 还是没读到。主管只能根据「已经知道的」判断缺什么,它不知道世界上还有一篇讲降级差价的文章,自然不会去问。这是这类系统的一个根本局限:**它找不到它想不到的东西**。改善的办法有几个:研究员自己多搜几轮(open_deep_research 的研究员是一个 ReAct 循环,最多 10 次工具调用,不像我们只搜一次);换更好的检索(二元组搜「退款」找不到「差价不退」,向量检索有机会);或者在提纲阶段就让模型列出「和退款相关的所有场景」,把升降级、优惠券这类边角场景显式写出来。花费 ¥0.0132。

</details>

**练习 2:照 open_deep_research 写一个超额处理。** 第 2 步的 `plan()` 拿到太多子问题时是直接截断丢掉的。写两个函数:`split_by_cap(calls, cap)` 把任务分成放行和超额两部分,`overflow_messages(overflow, cap)` 给每个超额任务生成一条告诉模型上限的错误信息。用 6 个任务、上限 4 测一下。再想想:截断丢掉和回错误信息,各适合什么场景?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/research/ex612_cap.py
"""练习 2:照 open_deep_research 的做法,主管一次派太多活时,超出的不执行,而是回一条告诉它上限的错误。"""


def split_by_cap(calls: list[str], cap: int) -> tuple[list[str], list[str]]:
    return calls[:cap], calls[cap:]


def overflow_messages(overflow: list[str], cap: int) -> list[str]:
    return [f"Error: 没有执行「{c}」,一次最多只能派 {cap} 个研究任务,请合并后重试。" for c in overflow]


if __name__ == "__main__":
    asked = ["退款规则", "发票规则", "注销规则", "优惠券规则", "数据导出规则", "套餐升降级规则"]
    run_now, overflow = split_by_cap(asked, cap=4)
    print("执行:", run_now)
    for m in overflow_messages(overflow, cap=4):
        print(m)
```

<div class="line-notes">

- `return calls[:cap], calls[cap:]` 两个切片,前 cap 个和剩下的,和源码里 `allowed_...` `overflow_...` 两行一模一样。
- `return [f"Error: 没有执行「{c}」,一次最多只能派 {cap} 个研究任务,请合并后重试。" for c in overflow]` 每条错误都说清三件事:哪个没执行、上限是多少、该怎么办。

</div>

```text
执行: ['退款规则', '发票规则', '注销规则', '优惠券规则']
Error: 没有执行「数据导出规则」,一次最多只能派 4 个研究任务,请合并后重试。
Error: 没有执行「套餐升降级规则」,一次最多只能派 4 个研究任务,请合并后重试。
```

这个例子正好说明截断的危险:被丢掉的是第 5、6 个,其中「套餐升降级规则」恰好就是练习 1 里怎么都找不回来的 `kb-plan`。直接截断,模型根本不知道有任务没跑,报告会悄悄缺一块;回错误信息,模型在下一轮能看到,可以把「优惠券」和「升降级」合并成一个任务重新派。所以:**主管是一个会继续循环的 Agent 时,回错误信息**(它有下一轮可以改);**只调一次、没有下一轮时(比如我们第 2 步的 `plan()`),截断也行,但要在报告里写明哪些方向因为上限没研究**,别让缺口变成隐形的。

</details>

**练习 3:并发上限调多少合适?** 固定 4 个子问题(跳过 `plan`,省一次调用),并发上限分别设 1、2、4,看研究阶段的墙钟时间。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/research/ex612_concurrency.py
"""练习 3:同样 4 个子问题,并发上限 1、2、4 各跑一次,看研究阶段的墙钟时间。"""
import asyncio
import time
from pathlib import Path

from common.llm import LLMClient
from part10.research.local_search import LocalSearch
from part10.research.research import Budget, research_all

SUBQS = ["年付和月付套餐的退款规则", "发票开具和红冲重开的规则", "注销账户的条件和冷静期", "套餐降级后差价怎么处理"]

llm = LLMClient()
search = LocalSearch(Path(__file__).parent / "kb")
for c in (1, 2, 4):
    t = time.perf_counter()
    notes = asyncio.run(research_all(SUBQS, llm, search, Budget(max_concurrency=c)))
    print(f"并发 {c}: 墙钟 {time.perf_counter() - t:.1f}s,各研究员加起来 {sum(n.seconds for n in notes):.1f}s")
print(llm.ledger)
```

<div class="line-notes">

- `SUBQS = [` 4 个手写的子问题,第 4 个特意写了「降级」「差价」,检索一定能命中 `kb-plan`。换句话说,子问题写对了,二元组搜索也够用。
- `Budget(max_concurrency=c)` 只改并发上限,其他参数保持默认。
- `sum(n.seconds for n in notes)` 每个研究员自己的耗时加起来,相当于「完全串行要多久」。

</div>

```text
并发 1: 墙钟 5.6s,各研究员加起来 5.6s
并发 2: 墙钟 2.0s,各研究员加起来 3.7s
并发 4: 墙钟 1.3s,各研究员加起来 4.4s
12 次调用 | 输入 3054 / 输出 1270 tokens | 约 ¥0.0153
```

并发 1 时墙钟等于各研究员之和,就是串行。并发 2 时墙钟降到 2.0 秒,并发 4 降到 1.3 秒,基本等于最慢那个研究员的耗时。并发越高越快,但钱一分没少(调用次数一样),而且会撞上模型厂商的速率限制,网页搜索 API 一般也有每秒请求数的限制。open_deep_research 默认 5 个、我们默认 3 个,都是在「快」和「别被限流」之间取的一个中间值。上线前要按你用的厂商的限流规则来定。花费 ¥0.0153(三轮各 4 次调用)。

</details>

**验收标准**:`make_kb.py`、`local_search.py`、`rag_once.py`、`research.py`(修过提示词的版本)都跑通;你能指出自己那次 RAG 对照读到了哪几篇、漏了哪几篇;能在 `deep_researcher.py` 里找到并发上限、主管轮数上限、研究员工具调用上限这三处判断,说清各自超了以后发生什么;练习 1 跑完,能用自己的话说清「为什么反思这一步也找不回 `kb-plan`」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Deep Research | 为写一份带出处的研究报告,进行多路、多轮检索、阅读和综合的长任务 Agent,一次跑几分钟到几十分钟 |
| 研究提纲(research brief) | 把用户口语化的需求改写成的明确任务说明:覆盖哪些方面、要多深、要什么形式 |
| 主管(supervisor) | 拆题、派活、收笔记、判断够不够的那个 Agent |
| 研究员(researcher) | 只负责一个子问题,自己搜、读、再搜的子 Agent |
| 压缩(compress) | 研究员把读过的大量原文整理成带出处的短笔记,只把笔记往上交 |
| 并发研究单元 | 同时进行的研究子任务数,open_deep_research 里叫 `max_concurrent_research_units`,默认 5 |
| 澄清(clarification) | 开始研究前,范围不清时先向用户提问 |
| 二元组(bigram) | 相邻两个字组成的一组。「退款规则」的二元组是「退款」「款规」「规则」 |
| `asyncio.to_thread` | 把一个同步函数丢到后台线程里执行,返回可以 `await` 的对象,避免卡住事件循环 |
| open_deep_research | LangChain 的开源 Deep Research 实现,用 LangGraph 写成,主图加主管、研究员两个子图 |

## 常见误区

**拿用户原话检索一次就当研究。** 第 1 步实测:一个跨三个主题的问题,检索一次只读到 8 篇里的 3 篇,最核心的退款政策没读到,回答却看起来完整、每句都有出处。RAG 不知道自己漏了什么。

**把分析题拆成搜索题。** 「哪些条款容易误解」是要想的,不是能搜的。派给研究员只会得到「资料中未找到」,报告就说「无法判断」。子问题只放能查的,分析写进提纲留给写报告的一步。

**把全部原文交给写报告的模型。** 上下文会爆,成本暴涨,写作模型在海量原文里更容易抓错依据。研究员必须先压缩,往上只交笔记。

**超额任务悄悄丢掉。** 练习 2 里被截掉的恰好是最难找的那个方向。有下一轮的主管,要回一条错误信息让它重新安排;没有下一轮,要在报告里写明哪些没研究。

**以为加了「够不够」就能查全。** 主管只能根据已知的笔记判断缺什么,想不到的方向它不会去问。练习 1 里 `kb-plan` 两轮都没读到,手写一个带「降级」「差价」的子问题,二元组搜索马上就命中了。

**什么问题都上 Deep Research。** 今天同一个问题,流水线比 RAG 贵 6 倍多。一两篇就能答的问题,用 RAG 就够了。

## 学习资料

### 文档与文章

- [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research):README 里有架构图和可配置项说明,先看它再读源码,20 分钟。英文。
- [LangChain 博客:Open Deep Research](https://www.langchain.com/blog/open-deep-research):作者讲为什么用主管加研究员的结构、为什么研究员要压缩、为什么改成最后一次调用写完整份报告,25 分钟。英文。
- [Anthropic:How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):今天只看前半篇的架构部分(主 Agent 派子 Agent、子 Agent 各自搜索、最后由引用 Agent 处理出处),工程数字和评测明天细讲,20 分钟。英文。
- [Python 文档:asyncio.to_thread](https://docs.python.org/3/library/asyncio-task.html#asyncio.to_thread):今天新用到的函数,5 分钟。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aXg5zzExm&autoplay=0&high_quality=1" title="🦜🕸️ Open Deep Research V2：新架构！上下文工程最新实践 📋" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>沧海九粟 · Open Deep Research V2:新架构!上下文工程最新实践 · 26 分钟,对着源码讲 open_deep_research 的图结构和压缩策略,和今天读源码那一节正好配套。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/2mSNIX-l_Zc" title="Open Deep Research" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Open Deep Research · 作者讲架构的演进,为什么从单 Agent 改成主管加研究员的结构,看完再回头读 `supervisor_tools`。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章「RAG and Agents」,前半讲检索、后半讲 Agent 的规划和工具,合起来就是 Deep Research 的底子,1.5 小时。英文原版。

### 开源项目与代码

- [open_deep_research 的 deep_researcher.py](https://github.com/langchain-ai/open_deep_research/blob/main/src/open_deep_research/deep_researcher.py):整个读一遍,重点是 `supervisor_tools`、`researcher_tools`、`compress_research` 三个函数,1 小时。
- [open_deep_research 的 prompts.py](https://github.com/langchain-ai/open_deep_research/blob/main/src/open_deep_research/prompts.py):读 `lead_researcher_prompt` 里的 `<Hard Limits>` 和 `<Scaling Rules>`,看它怎么用提示词配合代码里的硬上限,20 分钟。
- [open_deep_research 的 configuration.py](https://github.com/langchain-ai/open_deep_research/blob/main/src/open_deep_research/configuration.py):所有默认值,对照今天那张表,10 分钟。

## 自测

**1. Deep Research 和 RAG 差在哪四个地方?**

<details><summary>答案</summary>

问题要先澄清并改写成研究提纲;检索是多路、多轮的,拆成子问题分头查,读完再决定下一步;资料量远超上下文,研究员要先压缩成笔记;输出是长文,每句要有出处。今天第 1 步的对照里,RAG 用原话检索一次只读到 3/8 篇,最核心的退款政策漏了;流水线拆成三个子问题后读到了 7/8 篇。

</details>

**2. 为什么研究员之间要互相看不见,而且原文不往上交?**

<details><summary>答案</summary>

上下文隔离。每个研究员可能读几万字的资料,如果原文都交给主管和写报告的模型,上下文很快就满了,成本暴涨,写报告的模型也更容易在一大堆原文里抓错依据。只交几百字带出处的笔记,读得多的那部分被关在研究员自己的上下文里。代价是研究员要拿到完整、独立的任务说明,open_deep_research 的提示词专门叮嘱主管别用缩写,因为研究员看不到别人的工作。

</details>

**3. open_deep_research 怎么防止主管一次派太多研究员?这种做法好在哪?**

<details><summary>答案</summary>

在 `supervisor_tools` 里按 `max_concurrent_research_units`(默认 5)把 `ConductResearch` 调用切成放行和超额两部分,放行的并行执行;超额的不执行,但每一个都回一条工具结果,说明超了上限、请用 N 个或更少重试。好处是约束在代码里是硬的,不依赖模型听不听提示词;错误信息又告诉了模型怎么改,它下一轮会自己合并任务。

</details>

**4. 第 2 步第一次跑时,报告最后一节为什么说「无法判断」?怎么修的?**

<details><summary>答案</summary>

主管把「哪些条款容易引发误解」拆成了一个子问题派给研究员。这是分析题不是搜索题,研究员拿它去搜一篇都没搜到,写了「资料中未找到」,写报告的模型就照着说无法判断。修法是在主管提示词里规定子问题必须能靠查资料回答,比较、归纳、找问题写进提纲,留给最后写报告的一步。open_deep_research 的提示词里也有对应的一句:写报告是另一个 Agent 的事,主管只管收集信息。

</details>

**5. 面试题:你们要给客服团队做一个内部研究工具,问题像「整理所有和退款有关的规则,找出容易误解的地方」。你会直接上 Deep Research 吗?怎么设计?**

<details><summary>答案</summary>

先看问题类型的分布。如果大部分是「年付怎么退款」这种一两篇就能答的,RAG 就够了,再加一个路由:判断问题跨几个主题,跨多个主题的才走 Deep Research,因为它贵好几倍(今天实测 6 倍多)、慢好几倍。走 Deep Research 的部分用主管加研究员:主管先写提纲,子问题只放能查的事实题,分析留给写报告;研究员各自在帮助中心和内部规则库里搜几轮,只交带出处的笔记;主管看笔记判断够不够,最多两三轮。每一层有硬上限(子问题数、并发数、轮数、每个研究员的工具调用数),超额的任务回错误信息而不是悄悄丢掉。还要认识到它的局限:主管想不到的方向它不会去查,所以提纲阶段可以先让模型列出相关场景清单(升降级、优惠券、注销),再拆题。最后报告要做引用核验,有引用不等于引用对。

</details>

## 明天预告

[Day 613](/blog/agent-zero/day-613-deep-research-2/) 讲 Deep Research(二):其他实现、工程复盘数字、评测和成本。今天的报告里已经冒出了假引用(`[资料中未找到]`)和引用与内容对不上的句子,明天先看 GPT Researcher、STORM 这些别的做法,再读 Anthropic 多 Agent 研究系统复盘里的几个关键数字,然后给研究报告设计评测,写一个不靠模型的引用核验器,把今天这份报告过一遍。
