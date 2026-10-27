---
title: 'Day 268 · 小项目(一):文档问答 Agent 骨架和检索'
description: '第四部分的收官小项目,三天做完。今天搭骨架:把改写、检索、拼 prompt、回答、记历史、压缩历史接成一个多轮问答的 DocQA 类,历史里只存问答文本(五轮后 818 对 2410 个 token);读文件的地方第一版就上两道锁,工具层用 resolve 加 is_relative_to,进程层用 sandbox-exec,演示用的靶子全是伪造文件。'
pubDate: 2026-10-27
regime: none
tags: ['rag', 'project', 'agent', 'sandbox', 'python', 'agent-zero']
series: 'agent-zero'
day: 268
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 267](/blog/agent-zero/day-267-subagent-isolation/) 做了两件事:把翻资料的脏活交给子 Agent,让它的几十条 `messages` 留在自己那边,只带一段短结论回来;再把这周写过的零件接成一个 harness,一个会话聊三轮,结束时写长期记忆。到这里第四部分的零件基本齐了:切块、向量库、混合检索、rerank、改写、评估、预算、压缩、记忆。

零件齐了不等于东西能用。今天开始用三天把它们拼成一个完整的小项目,CloudLedger 帮助中心的文档问答 Agent。今天搭骨架和检索这一半,Day 269 加引用校验和拒答校准,Day 270 做复盘。

## 今天要解决的问题

学完你应该能做到:

1. 画出文档问答一轮对话的步骤(今天六步,Day 269 补成七步),说出每一步用的是哪一天的零件,以及第 5 步以后历史里该存什么、不该存什么。
2. 写出 `part04/docqa.py`(`DocQA` 类和它的 `ask` 方法)和命令行外壳 `part04/docqa_cli.py`,在一段五六轮的对话里跑通追问、一句话问两件事、查不到的问题、一句寒暄。
3. 给「读文件」上两道锁:工具层的 `part04/kb_jail.py`(`resolve` 加 `is_relative_to`),进程层的 `sandbox-exec` 配置。会用伪造的目录演示没有锁时会读到什么。
4. 知道历史里为什么只存问答文本,并能用一个小脚本量出来差多少。

预计用时 3 小时。API 花费约 ¥0.06:各脚本跑一遍合计,最大头是 `history_bloat.py` 的 ¥0.0150 和练习 4 的 ¥0.0260。价格按 2026 年 10 月 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing),和 Day 265 一样。embedding 和 rerank 用硅基流动的免费模型。

前置:[Day 135](/blog/agent-zero/day-135-llm-client-1/) 到 [Day 137](/blog/agent-zero/day-137-llm-client-3/) 的 `common/llm.py`(`LLMClient`);[Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py`;[Day 224](/blog/agent-zero/day-224-chunking/) 的 `part04/chunking.py`(`Chunk`);[Day 227](/blog/agent-zero/day-227-rag-prompt/) 的 `part04/prompts.py`;[Day 238](/blog/agent-zero/day-238-rerank/) 到 [Day 240](/blog/agent-zero/day-240-retrieval-pipeline/) 的 rerank、改写和 `part04/retrieve.py`;[Day 263](/blog/agent-zero/day-263-compaction/) 的 `part04/compaction.py`;[Day 266](/blog/agent-zero/day-266-agentic-rag/) 讲过的路径穿越。

**关于零件:** 我写这篇时手边没有你仓库里的这些文件,是把旧课的同名模块搬进 `part04/` 后实跑的。接口按 Day 240 的约定:`retrieve(question, k, mode, history, use_rewrite)` 返回 `[(Chunk, 分数), ...]`,`mode="hybrid+rerank"` 时分数是 rerank 分。今天会给它加一个参数,后面会讲。`compaction.py` 里数 token 的 `message_tokens` 我用的是 Day 262 里的粗估(没有 DeepSeek 分词器那份数据),所以「历史有多少 token」的数字和你的会差一点。你的数字和文章里的数字不会完全一致,模型每次回答的措辞也会不同,看量级和现象。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `DocQA.ask`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先点名:零件都在不在

三天的项目会同时用到十来个文件、一个数据库、三把密钥。缺一个,报错会出在很远的地方,比如 `KeyError: 'EMB_API_KEY'` 出现在 import 的第三层里。所以先写一个点名脚本,开工前跑一遍。在 `agent-zero-lab/` 根目录新建 `part04/docqa_check.py`:

```python
# agent-zero-lab/part04/docqa_check.py  开工前点名:今天和后两天要用的零件、数据、数据库、密钥都在不在
import importlib
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
ok = True


def report(name: str, good: bool, detail: str = "") -> None:
    global ok
    ok = ok and good
    print(f"  {'OK ' if good else '缺 '} {name} {detail}")


for mod in ["common.llm", "common.embed", "part04.chunking", "part04.prompts", "part04.retrieve",
            "part04.rewrite", "part04.compaction"]:
    try:
        importlib.import_module(mod)
        report(mod, True)
    except Exception as e:
        report(mod, False, f"{type(e).__name__}: {e}")

n_articles = len(list(Path("data/kb").glob("kb-*.md")))
report("data/kb 文章", n_articles == 20, f"{n_articles} 篇")
report("data/eval/rag_eval.jsonl", Path("data/eval/rag_eval.jsonl").exists())
for key in ["LLM_API_KEY", "EMB_API_KEY", "PG_DSN"]:
    report(f".env 里的 {key}", bool(os.environ.get(key)), "(只看有没有,不打印值)")

from part04.pg_store import connect  # noqa: E402  放在这里,是为了前面的检查失败时也能先看到报告

conn = connect()
rows = conn.execute("SELECT count(*) FROM kb_chunks").fetchone()
report("kb_chunks 表", bool(rows) and rows[0] == 42, f"{rows[0] if rows else '?'} 行")
print("全部就绪" if ok else "有缺的,先回去补")
```

<div class="line-notes">

- `import importlib` 标准库里按名字 import 模块的工具。`importlib.import_module("part04.retrieve")` 和 `import part04.retrieve` 效果一样,区别是模块名可以放在字符串变量里,所以能用循环批量试。
- `load_dotenv()` Day 53 学的,把 `.env` 里的 `KEY=value` 读进环境变量。后面 `os.environ.get(...)` 才拿得到。
- `ok = True` 全局的「是否全部通过」。
- `def report(name: str, good: bool, detail: str = "") -> None:` 统一的打印函数,每一项检查都走它。
- `global ok` 函数里要改外面的变量,必须先声明 `global`;不写的话,`ok = ok and good` 会被当成函数里新建的局部变量,外面的 `ok` 永远是 True。
- `print(f"  {'OK ' if good else '缺 '} {name} {detail}")` 通过打 `OK`,没通过打 `缺`。f-string 里的引号要和外层的双引号换成单引号。
- `for mod in ["common.llm", "common.embed", "part04.chunking", "part04.prompts", "part04.retrieve",` 七个要用的模块。注意 `part04.retrieve` 一 import 就会连 Postgres 并建 BM25 索引,所以这一行同时检查了数据库连得上。
- `importlib.import_module(mod)` import 成功就什么都不返回(返回的模块对象我们不用)。
- `except Exception as e:` 任何异常都算「缺」,把异常类型和信息打在后面。检查脚本的任务是把问题摆出来,不是自己崩掉。
- `n_articles = len(list(Path("data/kb").glob("kb-*.md")))` Day 37 学的 `glob`,数 `data/kb/` 下面 `kb-*.md` 的文件个数。我这里是 20 篇。
- `report("data/kb 文章", n_articles == 20, f"{n_articles} 篇")` 第二个参数是一个布尔表达式,直接当 `good`。
- `for key in ["LLM_API_KEY", "EMB_API_KEY", "PG_DSN"]:` 只检查「有没有」,不打印值。别在检查脚本里把密钥打到屏幕上,截图和终端回放都会留下它。
- `from part04.pg_store import connect  # noqa: E402` 通常 import 都写在文件顶上,这里故意放到后面,因为连库这一步依赖前面检查过的 `.env`,放前面的话 `.env` 没配好会直接在 import 时崩掉,看不到前面的报告。`# noqa: E402` 告诉 Ruff 这是故意的。
- `rows = conn.execute("SELECT count(*) FROM kb_chunks").fetchone()` 数向量表里有多少行。`fetchone()` 返回一个元组或 `None`,所以下一行先判断 `bool(rows)`。
- `report("kb_chunks 表", bool(rows) and rows[0] == 42, f"{rows[0] if rows else '?'} 行")` 42 是 20 篇文章切出来的块数(Day 224)。我实跑是 42 行。

</div>

```bash
cd ~/agent-zero-lab
uv run python -m part04.docqa_check
```

我的输出:

```text
  OK  common.llm 
  OK  common.embed 
  OK  part04.chunking 
  OK  part04.prompts 
  OK  part04.retrieve 
  OK  part04.rewrite 
  OK  part04.compaction 
  OK  data/kb 文章 20 篇
  OK  data/eval/rag_eval.jsonl 
  OK  .env 里的 LLM_API_KEY (只看有没有,不打印值)
  OK  .env 里的 EMB_API_KEY (只看有没有,不打印值)
  OK  .env 里的 PG_DSN (只看有没有,不打印值)
  OK  kb_chunks 表 42 行
全部就绪
```

有一行显示「缺」就先回去补那一天,别往下做。首次运行时 jieba 可能打印几行 `SyntaxWarning: invalid escape sequence`,是它自己源码里的写法在 Python 3.12 下的提醒,不影响结果,第二次运行就没有了。

## 最小版:检索一次,问一次

先写最短的一版,看它在哪里不够用。新建 `part04/docqa_min.py`:

```python
# agent-zero-lab/part04/docqa_min.py  最小版文档问答:检索 4 块,拼 prompt,问一次。一个字的历史都没有
from common.llm import LLMClient
from part04.prompts import build_messages
from part04.retrieve import retrieve

client = LLMClient()


def answer(question: str) -> str:
    hits = retrieve(question, k=4, mode="hybrid+rerank")
    reply = client.chat(build_messages(question, [c for c, _ in hits]), temperature=0)
    for c, s in hits:
        print(f"  {s:.3f}  [{c.id}] {c.title} > {c.section}")
    return reply.content


if __name__ == "__main__":
    for q in ["月付的能退款吗", "那年付的呢"]:
        print(f"\n你:{q}")
        print(f"客服:{answer(q)}")
    print(f"\n花费 ¥{client.ledger.cost:.4f}")
```

<div class="line-notes">

- `from common.llm import LLMClient` Day 135 到 137 建的客户端。它每次调用都会把花费记进 `client.ledger`。
- `from part04.prompts import build_messages` Day 227 的 prompt 拼装,返回 `[system 消息, user 消息]`,user 消息里是 `<资料>…</资料>` 加问题。
- `from part04.retrieve import retrieve` Day 240 的完整流水线:向量加 BM25,RRF 融合,rerank。import 的时候就会连库、建 BM25 索引。
- `client = LLMClient()` 读 `.env` 里的 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`,建一个 DeepSeek 客户端。放在模块顶层,整个文件共用一个,账本才会累加。
- `hits = retrieve(question, k=4, mode="hybrid+rerank")` 取 4 块。`hits` 是 `[(Chunk, 分数), ...]`。问「月付的能退款吗」,返回的第一块是 `kb-002#2`,分数 0.986。
- `reply = client.chat(build_messages(question, [c for c, _ in hits]), temperature=0)` 列表推导式 `[c for c, _ in hits]` 把元组里的块拿出来、丢掉分数(`_` 是约定俗成的「不要这个值」)。`temperature=0` 让输出尽量稳定。
- `for c, s in hits:` 把检索到的块和分数打出来,下面的输出里每问一次就有四行。
- `print(f"  {s:.3f}  [{c.id}] {c.title} > {c.section}")` `:.3f` 保留三位小数。`c.title` 是文章标题,`c.section` 是小节名。
- `for q in ["月付的能退款吗", "那年付的呢"]:` 两个问题,第二个是追问。注意它们之间没有任何东西连着,每次 `answer()` 都是从零开始。
- `print(f"\n花费 ¥{client.ledger.cost:.4f}")` 两次提问合计的钱。

</div>

```bash
uv run python -m part04.docqa_min
```

```text

你:月付的能退款吗
  0.986  [kb-002#2] 退款政策 > 月付套餐
  0.783  [kb-002#1] 退款政策 > 年付套餐
  0.105  [kb-003#1] 如何申请退款 > 操作步骤
  0.096  [kb-002#3] 退款政策 > 重复扣款
客服:月付套餐不支持中途退款。取消订阅后，当期结束时停止服务，不再续费，当期费用不退。[kb-002#2]

你:那年付的呢
  0.075  [kb-002#1] 退款政策 > 年付套餐
  0.007  [kb-006#1] 发票类型与开具 > 可以开哪种发票
  0.006  [kb-009#2] 导入银行流水 > 模板字段
  0.002  [kb-007#1] 修改发票抬头 > 开错了怎么办
客服:年付套餐中途取消的,按剩余的整月数比例退款;已经使用的月份和当前所在的月份不退。[kb-002#1]

例如年付专业版 468 元,折合每月 39 元;在第 3 个月中途取消,前 2 个月加当月共 3 个月不退,退剩余 9 个月,即 351 元。[kb-002#1]

如果您问的是年付套餐的发票类型:增值税专用发票仅限企业版,或年付的专业版。[kb-006#1]

花费 ¥0.0019
```

第一问没问题。第二问「那年付的呢」,人一看就知道在接上一句,问的是年付能不能退款。程序不知道:它把这五个字单独拿去检索,分数只有 0.075(第一问是 0.986),后面三块是发票、模板字段、发票抬头,全是凑数的。模型手里只有这五个字和四块资料,回答里居然多出一段「如果您问的是年付套餐的发票类型」,它在猜你想问什么。这次碰巧第一块检索对了(「年付」这两个字够 BM25 抓一下),换成「那它能开专票吗」这种没有关键词的追问,就真的检索不到东西了。

再看一对,问的是第 266 课就在用的那种问法。新建 `part04/docqa_nohist.py`:

```python
# agent-zero-lab/part04/docqa_nohist.py  坑:每一轮都当第一轮来问。追问「那退款前要做什么准备吗」单独拿去检索,会检到什么
from part04.docqa_min import answer, client

for q in ["我们是年付的专业版,买了十天,能退吗", "那退款前要做什么准备吗"]:
    print(f"\n你:{q}")
    print(f"客服:{answer(q)}")
print(f"\n花费 ¥{client.ledger.cost:.4f}")
```

<div class="line-notes">

- `from part04.docqa_min import answer, client` 直接借用上一个文件的函数和客户端。`import` 一个模块会执行它顶层的代码,但 `docqa_min.py` 的演示部分写在 `if __name__ == "__main__":` 里,不会跟着跑。
- `for q in ["我们是年付的专业版,买了十天,能退吗", "那退款前要做什么准备吗"]:` 第一句带着身份信息(年付专业版、十天),第二句是追问。
- `print(f"客服:{answer(q)}")` `answer()` 内部还会打印检索结果,所以输出里先是四行分数,再是「客服:」。

</div>

```text

你:我们是年付的专业版,买了十天,能退吗
  0.703  [kb-002#1] 退款政策 > 年付套餐
  0.048  [kb-002#2] 退款政策 > 月付套餐
  0.019  [kb-002#3] 退款政策 > 重复扣款
  0.018  [kb-005#2] 升级与降级 > 降级
客服:可以退,但按年付套餐的规则是按剩余整月数比例退款,已使用的月份和当前所在月份不退。

- 年付套餐(专业版和企业版)中途取消的,按剩余的整月数比例退款,已经使用的月份和当前所在的月份不退 [kb-002#1]。
- 例如年付专业版 468 元,折合每月 39 元;在第 3 个月中途取消,前 2 个月加当月共 3 个月不退,退剩余 9 个月,即 351 元 [kb-002#1]。

你们买了十天,属于当前所在月份,按上述规则这个月不退,具体退款金额建议转人工客服核算。

你:那退款前要做什么准备吗
  0.037  [kb-003#2] 如何申请退款 > 已经开了发票怎么办
  0.016  [kb-003#1] 如何申请退款 > 操作步骤
  0.015  [kb-002#4] 退款政策 > 审批与到账
  0.005  [kb-002#3] 退款政策 > 重复扣款
客服:退款前需要先确认订单是否已开具发票：如果已开具发票，需要先申请发票红冲（作废），红冲完成后才能退款；电子普通发票红冲一般当天完成，增值税专用发票需要你方配合退回或开具红字信息表 [kb-003#2]。

如果订单未开具发票，资料中没有提到其他前置准备。退款操作本身是进入「设置 → 订阅 → 申请退款」，选择退款原因并提交，客服主管会在 1 个工作日内审批 [kb-003#1]。

花费 ¥0.0029
```

第二问的第一名是 `kb-003#2`,分数 0.037,比第一问的 0.703 低了将近二十倍。答案本身没错,但它不知道客户是年付专业版,也不知道已经买了十天,所以说不出「十天内的话……」这类针对性的话。分数低还有一个后果,Day 269 做拒答阈值的时候会撞上:一个正常的追问,分数可能比「你们有学生优惠吗」这种该拒答的问题还低。

所以骨架要解决的第一件事是:追问要先补全成独立的问题,再去检索。Day 239 的改写做的就是这件事。第二件事是:历史要带给模型,让它知道前面聊过什么。

## 一轮对话的步骤

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="一轮问答的六个步骤:改写、检索、拼 prompt、回答、记历史、压缩,历史里只存问答文本,资料每轮重新检索">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
<defs><marker id="a268" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<rect x="14" y="20" width="130" height="52" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="24" y="40" fill="var(--ink)">1 改写</text>
<text x="24" y="58" fill="var(--ink-soft)" font-size="11">补全追问/拆多问</text>
<rect x="176" y="20" width="130" height="52" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="186" y="40" fill="var(--ink)">2 检索</text>
<text x="186" y="58" fill="var(--ink-soft)" font-size="11">向量+BM25+rerank</text>
<rect x="338" y="20" width="130" height="52" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="348" y="40" fill="var(--ink)">3 拼 prompt</text>
<text x="348" y="58" fill="var(--ink-soft)" font-size="11">规则+历史+资料</text>
<rect x="500" y="20" width="126" height="52" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="510" y="40" fill="var(--ink)">4 回答</text>
<text x="510" y="58" fill="var(--ink-soft)" font-size="11">模型,temperature 0</text>
<line x1="144" y1="46" x2="174" y2="46" stroke="var(--ink-soft)" marker-end="url(#a268)"/>
<line x1="306" y1="46" x2="336" y2="46" stroke="var(--ink-soft)" marker-end="url(#a268)"/>
<line x1="468" y1="46" x2="498" y2="46" stroke="var(--ink-soft)" marker-end="url(#a268)"/>
<line x1="563" y1="72" x2="563" y2="128" stroke="var(--ink-soft)" marker-end="url(#a268)"/>
<rect x="470" y="130" width="156" height="52" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="480" y="150" fill="var(--ink)">5 记历史</text>
<text x="480" y="168" fill="var(--ink-soft)" font-size="11">只存问和答的文字</text>
<rect x="290" y="130" width="140" height="52" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="300" y="150" fill="var(--ink)">6 压缩</text>
<text x="300" y="168" fill="var(--ink-soft)" font-size="11">超 2000 token 才调</text>
<line x1="470" y1="156" x2="432" y2="156" stroke="var(--ink-soft)" marker-end="url(#a268)"/>
<path d="M360,184 C360,226 80,226 80,76" fill="none" stroke="var(--ink-faint)" stroke-dasharray="4 4" marker-end="url(#a268)"/>
<text x="150" y="214" fill="var(--ink-faint)" font-size="11">下一轮:历史带回去改写,资料不带,每轮重新检索</text>
<rect x="14" y="120" width="230" height="52" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="3 3"/>
<text x="24" y="140" fill="var(--ink-soft)" font-size="11">kb_jail:读整篇文章时过的门</text>
<text x="24" y="158" fill="var(--ink-soft)" font-size="11">sandbox-exec:整个进程的门</text>
</g>
</svg>
<figcaption>一轮对话的步骤。蓝色是模型做的事,琥珀色是检索和拼装这类普通代码。左下角虚线框是读文件时的两道锁,不在主流程里,但从第一版就要有。</figcaption>
</figure>

每一步在哪一天学的,今天各自写在哪:

| 步骤 | 做什么 | 来自 | 今天落在 |
| --- | --- | --- | --- |
| 1 改写 | 把「那年付的呢」补全,一句话两个问题就拆开 | Day 239 | `part04/rewrite.py`,`ask` 里调用 |
| 2 检索 | 向量加 BM25,RRF 融合,rerank 取前 k | Day 235 到 240 | `part04/retrieve.py`,加一个参数 |
| 3 拼 prompt | 规则、历史、本轮资料和问题 | Day 227 | `ask` 里 `[system, *history, user]` |
| 4 回答 | 调模型 | Day 135 起 | `ask` 里 `client.chat` |
| 5 记历史 | 只存问答文本 | Day 264 | `ask` 里 `self.history += ...` |
| 6 压缩 | 超过阈值,较早的几轮换成摘要 | Day 263 | `ask` 里 `compact(...)` |

旧课里这个流程是七步,最后一步是「校验引用」。Day 269 才加,所以今天只有六步,上面标题里的「七个步骤」也要到明天才凑齐。

## 给 retrieve 开一个口子

`DocQA` 想在界面上显示「这次实际拿去检索的词是什么」,而改写是 `retrieve` 里面做的,外面拿不到。有两个办法:让 `retrieve` 把改写结果一起返回,这会改掉它的返回类型,Day 266、267 的代码全都要跟着改;或者让改写挪到 `DocQA` 里做,把结果当参数传给 `retrieve`。我选第二个,改动只有一个新参数,老调用方什么都不用动。

改的是 `part04/retrieve.py` 的函数头和开头几行(后面的向量、BM25、RRF、rerank 一行不动):

```python
# agent-zero-lab/part04/retrieve.py  只给改动的部分:函数头多了 queries,开头多了一层判断
def retrieve(
    question: str,
    k: int = 4,
    mode: str = "hybrid+rerank",
    history: list[dict] | None = None,
    use_rewrite: bool = False,
    pool: int = 20,
    queries: list[str] | None = None,
) -> list[tuple[Chunk, float]]:
    if queries is None:
        queries = [question]
        if use_rewrite:
            queries += [q for q in rewrite(question, history) if q != question]
```

<div class="line-notes">

- `queries: list[str] | None = None,` 新参数,默认 `None`。老调用方不传它,行为和以前完全一样。`list[str] | None` 是 Day 46 学的联合类型。
- `if queries is None:` 判断「调用方有没有自己给检索词」。注意写 `is None` 而不是 `not queries`:传一个空列表 `[]` 是另一回事(调用方明确说「不要查任何东西」),不能当成没传。
- `queries = [question]` 没传时,检索词的第一条永远是用户原话。
- `queries += [q for q in rewrite(question, history) if q != question]` 老逻辑原样挪进 `if` 里:要改写就调 `rewrite`,结果里和原话一样的丢掉,免得同一句检索两遍。传了 `queries` 的话,这几行整个跳过,`DocQA` 已经改写过了。

</div>

后面 `for q in queries:` 那个循环会对每个检索词各做一次向量检索和 BM25,再用 RRF 把所有名次合起来。所以一句话里有两个问题时,改写拆成两条查询,两个问题各自的相关块都有机会进前 k。

## 改写的账也要记

`Turn.cost` 想记「这一轮总共花了多少钱」,而改写是 `rewrite.py` 里调的模型。Day 239 的 `rewrite` 自己在模块顶层建了一个 `LLMClient`,账记在它自己的账本里,`DocQA` 的 `client.ledger` 看不到。我第一版就是这样写的,后来在命令行里看到一个被低分拦下、根本没调生成模型的问题显示 ¥0.0000,可它明明改写过一次,才发现改写那次的钱没记进 `Turn.cost`。

修法很小:`rewrite` 多收一个可选的 `client`,不传就用自己的默认客户端,`DocQA` 传自己的。`part04/rewrite.py` 改三处:

```python
# agent-zero-lab/part04/rewrite.py  只给改动的部分:原来的 client 改名 default_client,函数多一个参数,调用处用传进来的
default_client = LLMClient()  # 没传 client 时用它;DocQA 会传自己的,这样改写的花费也记进同一本账


def rewrite(question: str, history: list[dict] | None = None, client: LLMClient | None = None) -> list[str]:
    ...  # 拼 history_text 和 user 的几行不变
    raw = (client or default_client).chat(
```

<div class="line-notes">

- `default_client = LLMClient()  # 没传 client 时用它;DocQA 会传自己的,这样改写的花费也记进同一本账` 原来叫 `client`,改名是因为函数参数也叫 `client`,同名会让人分不清用的是哪一个。
- `def rewrite(question: str, history: list[dict] | None = None, client: LLMClient | None = None) -> list[str]:` 新参数放最后、给默认值 `None`,老调用方(练习里直接 `rewrite(q, history)` 的)不用改。
- `...  # 拼 history_text 和 user 的几行不变` `...` 是 Python 里的「省略号对象」,这里只是我用来表示「这几行没动」,真写文件时把原来的几行留着。
- `raw = (client or default_client).chat(` `client or default_client`:传了就用传的,没传(`None` 是假值)就用默认的。括号是为了先算 `or` 再调 `.chat`。

</div>

这种「谁调用谁出钱」的账,是自己封装模块时很容易漏的一类。往后每加一个会调模型的零件(Day 269 会加引用核对里的裁判),先问一句:它的花费记在哪本账上?

## DocQA:骨架

新建 `part04/docqa.py`。一个类,三个方法:`__init__` 建状态,`reset` 清空,`ask` 走一轮。

```python
# agent-zero-lab/part04/docqa.py  文档问答 Agent 的骨架:改写 → 检索 → 拼 prompt → 回答 → 记历史 → 必要时压缩
import time
from dataclasses import dataclass

from common.llm import LLMClient
from part04.chunking import Chunk
from part04.compaction import compact
from part04.prompts import build_messages
from part04.retrieve import retrieve
from part04.rewrite import rewrite


@dataclass
class Turn:
    question: str
    answer: str
    queries: list[str]  # 实际拿去检索的查询(第一条永远是用户原话)
    hits: list[tuple[Chunk, float]]  # (块, rerank 分数),按分数从高到低
    cost: float  # 这一轮花的钱(元),含改写、回答、压缩
    seconds: float


class DocQA:
    def __init__(self, client: LLMClient | None = None, k: int = 4,
                 keep_last_turns: int = 3, trigger_tokens: int = 2000) -> None:
        self.client = client or LLMClient()
        self.k = k
        self.keep_last_turns = keep_last_turns
        self.trigger_tokens = trigger_tokens
        self.history: list[dict] = []  # 只存问答文本,不存检索资料

    def reset(self) -> None:
        self.history = []

    def ask(self, question: str) -> Turn:
        start, cost0 = time.perf_counter(), self.client.ledger.cost
        queries = [question]
        if self.history:  # 第一轮没有指代,不用改写
            queries += [q for q in rewrite(question, self.history, self.client) if q != question]
        hits = retrieve(question, k=self.k, history=self.history, queries=queries)
        system, user = build_messages(question, [c for c, _ in hits])
        reply = self.client.chat([system, *self.history, user], temperature=0)

        self.history += [{"role": "user", "content": question},
                         {"role": "assistant", "content": reply.content}]
        self.history = compact(self.client, self.history,
                               keep_last_turns=self.keep_last_turns,
                               trigger_tokens=self.trigger_tokens)
        return Turn(question, reply.content, queries, hits,
                    self.client.ledger.cost - cost0, time.perf_counter() - start)
```

<div class="line-notes">

- `import time` 标准库,给每一轮计时用。
- `from dataclasses import dataclass` Day 50 学的,下面 `Turn` 用它省掉手写 `__init__`。
- `from part04.compaction import compact` Day 263 的总结压缩:历史没超阈值原样返回,不调模型;超了就把较早的几轮换成一条摘要。
- `from part04.rewrite import rewrite` Day 239 的改写,返回一个字符串列表,比如 `["年付套餐是否支持退款"]`。
- `class Turn:` 一轮的结果。不把 `ask` 的返回值只做成一个字符串,是因为界面要显示来源、成本,评估脚本要看检索词和分数,后两天都用得上。
- `queries: list[str]  # 实际拿去检索的查询(第一条永远是用户原话)` 第三轮「发票抬头也写错了,一起处理」实测是 `['发票抬头也写错了,一起处理', '发票抬头写错如何修改', '退款前发票红冲流程']`,一句话变三条。
- `hits: list[tuple[Chunk, float]]  # (块, rerank 分数),按分数从高到低` `hits[0][1]` 就是最高分。Day 269 的拒答判断读的就是它。
- `cost: float  # 这一轮花的钱(元),含改写、回答、压缩` 一轮可能调 2 到 3 次模型,账不能只记回答那一次。
- `def __init__(self, client: LLMClient | None = None, k: int = 4,` 所有可调的东西都放进构造参数,以后评估脚本要对比不同的 `k`、不同的压缩阈值,不用改类的代码。
- `self.client = client or LLMClient()` 调用方可以传一个现成的客户端(比如共用一个账本),没传就自己建。`or` 的用法 Day 22 学过:左边是 `None`(假值)就取右边。
- `self.history: list[dict] = []  # 只存问答文本,不存检索资料` 这一行的注释是整个类最重要的一条设计决定,下一节用数据说明。
- `def reset(self) -> None:` 开新话题。把 `self.history` 换成新的空列表,不影响 `client` 的账本。
- `start, cost0 = time.perf_counter(), self.client.ledger.cost` 元组赋值,同时记下开始时间和开始时的累计花费。轮末用「现在的累计减开始时的累计」得到这一轮花的钱。
- `queries = [question]` 先放原话。
- `if self.history:  # 第一轮没有指代,不用改写` 空列表是假值。第一轮不调改写,省一次模型调用。实测第一轮 `queries` 只有原话一条,¥0.0013;第二轮起每轮多一次改写调用。
- `queries += [q for q in rewrite(question, self.history, self.client) if q != question]` 改写结果里和原话相同的丢掉。「好的谢谢」改写会原样返回,所以 `queries` 还是一条。第三个参数把 `DocQA` 自己的客户端传给 `rewrite`,下一小节解释为什么。
- `hits = retrieve(question, k=self.k, history=self.history, queries=queries)` 把刚才开的口子用上。`history` 也传进去,是因为 `retrieve` 里挑 rerank 用哪句话打分时要看有没有历史:有历史且有改写,就用改写补全后的话打分,而不是那半句原话(Day 240)。第二轮的最高分 0.102 就是这么来的,上面不改写的版本只有 0.037。
- `system, user = build_messages(question, [c for c, _ in hits])` 返回的是长度为 2 的列表,直接解包。
- `reply = self.client.chat([system, *self.history, user], temperature=0)` 顺序是:规则、之前的问答、本轮资料加问题。`*self.history` 把列表展开,相当于 TS 的 `[system, ...history, user]`。
- `self.history += [{"role": "user", "content": question},` 存进历史的是**原话**,不是带资料的那条 `user`。
- `{"role": "assistant", "content": reply.content}]` 模型的回答原文。拒答也存,下一轮模型知道上一句没答上来。
- `self.history = compact(self.client, self.history,` 每轮都调,没超 `trigger_tokens` 就原样返回。注意是赋值回 `self.history`:`compact` 返回新列表,不改传进去的。
- `return Turn(question, reply.content, queries, hits,` 按 `Turn` 字段的顺序传。
- `self.client.ledger.cost - cost0, time.perf_counter() - start)` 这一轮的花费和耗时。第三轮实测 ¥0.0035,3.3 秒,是五轮里最贵的:改写生成了三条检索词,资料块多,回答也长。

</div>

## 历史里存什么

`self.history` 为什么只存问答文本?写个脚本量一下。新建 `part04/history_bloat.py`,同一场五轮对话,每轮算两个数:只存问答文本时历史有多少 token,和把每轮发给模型的完整 user 消息(带资料那条)也存下来时有多少:

```python
# agent-zero-lab/part04/history_bloat.py  历史里存什么?只存问答文本 vs 把每轮检索到的资料也存进去,五轮之后差多少 token
from common.llm import LLMClient
from part04.ctx_budget import estimate_tokens
from part04.docqa import DocQA
from part04.prompts import build_messages

QUESTIONS = [
    "我们是年付的专业版,买了十天,能退吗",
    "那退款前要做什么准备吗",
    "发票抬头也写错了,一起处理",
    "导入流水报 E1043 怎么解决",
    "Excel 存的 csv 传上去说格式不对,好像是乱码",
]

client = LLMClient()
qa = DocQA(client, trigger_tokens=10**9)  # 不压缩,单独看历史本身的大小
text_only = with_docs = 0
print(f"{'轮':<3}{'只存问答':>8}{'连资料一起存':>12}  问题")
for i, q in enumerate(QUESTIONS, 1):
    t = qa.ask(q)
    plain = estimate_tokens(t.question) + estimate_tokens(t.answer)
    full = estimate_tokens(build_messages(t.question, [c for c, _ in t.hits])[1]["content"]) + estimate_tokens(t.answer)
    text_only += plain
    with_docs += full
    print(f"{i:<3}{text_only:>8}{with_docs:>12}  {q}")
print(f"\n第 6 轮发请求时,光历史就要带 {text_only} vs {with_docs} 个 token(粗估)")
print(f"花费 ¥{client.ledger.cost:.4f}")
```

<div class="line-notes">

- `from part04.ctx_budget import estimate_tokens` Day 262 的粗估函数:汉字按 0.8 个 token、ASCII 按 0.35 算,不依赖分词器。我们只比较两种存法的相对大小,粗估够用。
- `QUESTIONS = [` 五个问题:前三个是同一场退款对话,后两个换了话题(导入报错),模拟客户一个会话里问了几件事。
- `client = LLMClient()` 单独建一个,最后读它的账本。
- `qa = DocQA(client, trigger_tokens=10**9)  # 不压缩,单独看历史本身的大小` `10**9` 是 Python 的幂运算,十亿。阈值大到永远不触发压缩,否则压缩会把历史变小,盖住我们要看的差别。
- `text_only = with_docs = 0` 链式赋值,两个变量都是 0。
- `t = qa.ask(q)` 真的问一轮,拿到 `Turn`。
- `plain = estimate_tokens(t.question) + estimate_tokens(t.answer)` 「只存问答」这种存法下,这一轮给历史增加的 token。
- `full = estimate_tokens(build_messages(t.question, [c for c, _ in t.hits])[1]["content"]) + estimate_tokens(t.answer)` 「连资料一起存」的话,存进去的 user 消息就是 `build_messages` 返回的第 2 条(下标 1),里面有四块资料全文。
- `text_only += plain` 累加。第 1 轮 197,第 5 轮累计 818。
- `print(f"{i:<3}{text_only:>8}{with_docs:>12}  {q}")` `:<3` 左对齐占 3 格,`:>8` 右对齐占 8 格,让表格对齐。

</div>

```text
轮      只存问答      连资料一起存  问题
1       197         508  我们是年付的专业版,买了十天,能退吗
2       356        1024  那退款前要做什么准备吗
3       542        1556  发票抬头也写错了,一起处理
4       670        1961  导入流水报 E1043 怎么解决
5       818        2410  Excel 存的 csv 传上去说格式不对,好像是乱码

第 6 轮发请求时,光历史就要带 818 vs 2410 个 token(粗估)
花费 ¥0.0150
```

五轮之后,只存问答是 818 个 token,连资料一起存是 2410,差 2.9 倍,而且差距每轮在拉大,因为每多一轮就多四块资料。

更要命的不是钱。第 5 轮的问题是「Excel 存的 csv 传上去说格式不对」,历史里要是还躺着第 1 轮的年付退款政策、第 3 轮的发票抬头规则,模型的注意力要在一堆和本轮无关的旧资料里分一部分出去(Day 262 量过这件事)。更糟的是旧资料可能已经过期:帮助中心昨天改了退款规则,历史里存的还是旧版本,模型可能引用旧版。所以资料只属于「这一轮」,每轮重新检索,历史只记「说了什么」。

这个设计有一个代价:客户追问「你刚才说的第二点能展开讲讲吗」时,模型看得到自己上一轮的回答(历史里有),但看不到那轮的资料原文,要展开就得重新检索。一般问题不大,因为改写会把「第二点」补全成具体的问题。如果你的场景里这类追问很多,可以只在历史里额外保存「上一轮引用过的文章编号」,下一轮让检索优先带上它们,这是个优化,今天不做。

## 先把门锁上:读文件的两道锁

到现在 `DocQA` 本身没有碰文件系统:知识库在启动时由 `chunking.load_chunks()` 一次读完。但文档问答产品几乎一定会很快长出「读整篇」的功能,用户点来源想看原文,或者像 Day 266 那样把 `get_article` 做成工具给模型调。只要有一个函数接收「一个名字」然后去读文件,就有路径穿越的风险。Day 266 用白名单堵了模型传参这条路;今天换个思路,不管名字从哪来(模型、用户输入、前端 URL),读文件那一步自己把关,而且分两层。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="两道锁:最外层 sandbox-exec 把整个进程关在项目目录里,里层 kb_jail 把读文章限定在 data/kb 里;项目外的伪造文件两层都读不到,项目内的 data/fake_home 只有 kb_jail 拦得住">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="10" y="12" width="430" height="226" rx="8" fill="none" stroke="var(--mem)" stroke-width="1.5"/>
<text x="22" y="32" fill="var(--mem)">第二层 sandbox-exec:整个进程只能读写 agent-zero-lab/</text>
<rect x="26" y="48" width="190" height="104" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="36" y="68" fill="var(--compute)">第一层 kb_jail</text>
<text x="36" y="88" fill="var(--ink)">data/kb/</text>
<text x="36" y="108" fill="var(--ink-soft)" font-size="11">kb-001.md … kb-020.md</text>
<text x="36" y="128" fill="var(--ink-soft)" font-size="11">read_article() 只读这里</text>
<rect x="236" y="48" width="190" height="104" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="246" y="68" fill="var(--ink)">data/fake_home/</text>
<text x="246" y="88" fill="var(--ink-soft)" font-size="11">伪造的「家目录」</text>
<text x="246" y="108" fill="var(--ink-soft)" font-size="11">在项目里面:kb_jail 拦,</text>
<text x="246" y="128" fill="var(--ink-soft)" font-size="11">sandbox-exec 不拦</text>
<text x="26" y="184" fill="var(--ink-soft)" font-size="11">.env 也在这一层里:工具层不放行,</text>
<text x="26" y="202" fill="var(--ink-soft)" font-size="11">进程层的锁不会替你挡住它</text>
<rect x="470" y="48" width="160" height="104" rx="6" fill="none" stroke="var(--rule)"/>
<text x="480" y="68" fill="var(--ink)">../outside/</text>
<text x="480" y="88" fill="var(--ink-soft)" font-size="11">项目外的伪造文件</text>
<text x="480" y="108" fill="var(--ink-soft)" font-size="11">两层都挡:读写</text>
<text x="480" y="128" fill="var(--ink-soft)" font-size="11">都是 Operation</text>
<text x="480" y="146" fill="var(--ink-soft)" font-size="11">not permitted</text>
</g>
</svg>
<figcaption>两道锁管的范围不一样。内层按「哪个文件能被读文章的函数读到」划线,外层按「这个进程整体能碰哪些路径」划线。真实仓库、家目录、公司代码在最外面那个框之外,进程根本碰不到。</figcaption>
</figure>

### 第一层:kb_jail,工具层

新建 `part04/kb_jail.py`:

```python
# agent-zero-lab/part04/kb_jail.py  文件读取的第一道锁:不管传进来什么名字,最后读的文件必须在 data/kb/ 里面
from pathlib import Path

KB_ROOT = Path("data/kb").resolve()  # 绝对路径,启动时算一次
MAX_BYTES = 100_000


class JailError(Exception):
    """想读的文件在 KB_ROOT 外面,或者不是允许的类型。"""


def resolve_inside(name: str, root: Path = KB_ROOT) -> Path:
    if not name or "\x00" in name:
        raise JailError("文件名为空或含有非法字符")
    path = (root / name).resolve()  # resolve():去掉 ..、跟着符号链接走到真正的位置
    if not path.is_relative_to(root):
        raise JailError(f"{name!r} 在知识库目录外面")
    if path.suffix != ".md":
        raise JailError(f"只能读 .md 文件,不能读 {path.suffix or '无后缀'} 文件")
    return path


def read_article(name: str, root: Path = KB_ROOT) -> str:
    path = resolve_inside(name, root)
    if not path.is_file():
        raise JailError(f"{name!r} 不存在")
    if path.stat().st_size > MAX_BYTES:
        raise JailError(f"{name!r} 超过 {MAX_BYTES} 字节")
    return path.read_text(encoding="utf-8")
```

<div class="line-notes">

- `from pathlib import Path` Day 37 的 pathlib。
- `KB_ROOT = Path("data/kb").resolve()  # 绝对路径,启动时算一次` `resolve()` 把相对路径变成绝对路径,顺便去掉 `..` 和符号链接。在 `agent-zero-lab/` 根目录跑,它是 `/Users/你/agent-zero-lab/data/kb`。启动时算一次,后面所有检查都和这个固定值比。
- `MAX_BYTES = 100_000` 数字里的下划线只是给人看的分隔,等于 100000。一篇帮助文章几百字,十万字节(约 100KB)已经远远够了,卡住超大文件,防止有人往知识库目录里塞个几 GB 的文件让进程吃光内存。
- `class JailError(Exception):` Day 36 的自定义异常。不用 `ValueError` 或 `PermissionError`,是为了调用方能只 `except JailError`,把「想读锁外的文件」和别的错误分开处理。
- `def resolve_inside(name: str, root: Path = KB_ROOT) -> Path:` 核心函数:给一个名字,返回「确认在锁里面」的绝对路径,否则抛 `JailError`。`root` 做成参数,是为了练习 2 能换一个根目录测试。
- `if not name or "\x00" in name:` 空字符串是假值。`"\x00"` 是空字符(NUL),C 语言层面把它当字符串结束符,有些系统调用会在它这里截断,`"kb-001.md\x00.txt"` 可能被检查当成 `.txt` 而被系统当成 `kb-001.md`。直接拒绝。
- `path = (root / name).resolve()  # resolve():去掉 ..、跟着符号链接走到真正的位置` 关键的一行。`root / name` 先拼路径(有个坑:`name` 如果是绝对路径,`root / "/etc/hosts"` 的结果是 `/etc/hosts`,`root` 被整个丢掉!`Path` 的这个行为很多人第一次见);`resolve()` 之后,`../fake_home/secret.txt` 变成 `/Users/你/agent-zero-lab/data/fake_home/secret.txt`,符号链接也被换成它真正指向的位置。
- `if not path.is_relative_to(root):` 判断「解析之后的真实位置」是不是在 `root` 里面。`is_relative_to` 是按路径的每一段比的,不是按字符串前缀比。练习 2 会演示字符串前缀判断为什么不行。
- `raise JailError(f"{name!r} 在知识库目录外面")` `{name!r}` 是 `repr`,带引号,空格和奇怪字符都看得清。错误信息里不要写出 `root` 的绝对路径,那会把服务器目录结构透露给调用方。
- `if path.suffix != ".md":` 只允许读 `.md`。就算有人把 `.env` 放进了知识库目录(或者以后配置错了目录),这道检查也拦着它。`path.suffix` 取最后一个点之后的部分,`.env` 的 `suffix` 是空字符串,`kb-001.MD` 是 `.MD`,都不等于 `.md`。
- `def read_article(name: str, root: Path = KB_ROOT) -> str:` 对外的函数:先过 `resolve_inside`,再读。
- `if not path.is_file():` 检查完「在不在锁里」才检查「存不存在」。顺序不能反:先检查存在性的话,调用方可以靠「不存在」和「被拒绝」两种不同的错误,一点点探出锁外面有哪些文件。
- `if path.stat().st_size > MAX_BYTES:` `stat()` 拿文件元信息,`st_size` 是字节数。
- `return path.read_text(encoding="utf-8")` 最后才真正读。

</div>

用伪造的靶子试一下。先准备两个假文件,都是假数据。`data/fake_home/` 在项目里面,模拟「家目录」;`../outside/` 在项目外面(你的 `~/outside/`):

```bash
cd ~/agent-zero-lab
mkdir -p data/fake_home ../outside
echo "FAKE-SECRET: 这是伪造的假密码 hunter2-not-real" > data/fake_home/secret.txt
echo "OUTSIDE-FAKE-SECRET: 伪造数据,不是真密码" > ../outside/secret.txt
```

新建 `part04/jail_demo.py`,把五种读法各用「没有锁」和「有锁」两个函数试一遍:

```python
# agent-zero-lab/part04/jail_demo.py  没有锁的读取 vs 有锁的读取,用伪造的 data/fake_home/ 和 ../outside/ 做靶子
import os
from pathlib import Path

from part04.kb_jail import JailError, read_article

KB = Path("data/kb")
OUTSIDE = Path("../outside/secret.txt").resolve()


def naive_read(name: str) -> str:
    """没有锁:拿到名字直接拼路径读。"""
    return (KB / name).read_text(encoding="utf-8")


link = KB / "notes-link.md"  # 在知识库里放一个指向外面的符号链接(演示完删掉)
if link.is_symlink():
    link.unlink()
os.symlink(OUTSIDE, link)

names = [
    "kb-001.md",
    "../fake_home/secret.txt",
    str(OUTSIDE),
    "notes-link.md",
    "kb-001.md/../../fake_home/secret.txt",
    "",
]
try:
    for name in names:
        label = repr(name if len(name) < 50 else "…" + name[-34:])
        try:
            got = naive_read(name)[:24].replace("\n", " ")
            naive = f"读到了 {got!r}"
        except (OSError, ValueError) as e:
            naive = f"失败 {type(e).__name__}"
        try:
            got = read_article(name)[:24].replace("\n", " ")
            jail = f"读到了 {got!r}"
        except JailError as e:
            jail = f"拦下 {e}"
        print(f"{label}\n    无锁:{naive}\n    有锁:{jail}")
finally:
    link.unlink()
```

<div class="line-notes">

- `import os` 为了 `os.symlink`,创建符号链接。
- `KB = Path("data/kb")` 没有锁的版本用的根目录,是相对路径,没有 `resolve`。
- `OUTSIDE = Path("../outside/secret.txt").resolve()` 项目外那个伪造文件的绝对路径。
- `def naive_read(name: str) -> str:` 没有锁的读法,这就是 Day 266 演示过的、最容易写出来的版本:拿到名字,拼到根目录后面,直接读。
- `return (KB / name).read_text(encoding="utf-8")` 一行,没有任何检查。
- `link = KB / "notes-link.md"  # 在知识库里放一个指向外面的符号链接(演示完删掉)` 符号链接(symlink)是一个「指路牌」文件,打开它就等于打开它指向的那个文件。名字叫 `notes-link.md`,后缀合法,看起来就是个普通笔记,但指向项目外面。
- `os.symlink(OUTSIDE, link)` 创建符号链接:`link` 这个名字指向 `OUTSIDE`。
- `names = [` 六个测试名字:一个正常的,一个 `../` 穿越,一个绝对路径,一个符号链接,一个绕了一圈的混合写法,一个空串。
- `"kb-001.md/../../fake_home/secret.txt",` 把 `kb-001.md` 当成目录再往上退两级。文件系统不认 `kb-001.md/`,没锁的版本报 `NotADirectoryError`;有锁的版本在 `resolve` 之后看到它落在 `data/fake_home/`,直接拦。
- `try:` 外层的 `try/finally`,保证演示不管中途出什么错,最后都会把符号链接删掉,不在知识库里留下一个指向外面的链接。
- `label = repr(name if len(name) < 50 else "…" + name[-34:])` 绝对路径太长,只显示末尾 34 个字符。
- `except (OSError, ValueError) as e:` 没有锁的版本可能因为文件不存在、是目录等原因失败,这里只是为了让演示继续往下走。
- `except JailError as e:` 有锁的版本只会抛 `JailError`。
- `link.unlink()` `finally` 里删掉符号链接。`unlink()` 对符号链接只删链接本身,不会删它指向的文件。

</div>

```bash
uv run python -m part04.jail_demo
```

```text
'kb-001.md'
    无锁:读到了 '--- id: kb-001 title: 套餐'
    有锁:读到了 '--- id: kb-001 title: 套餐'
'../fake_home/secret.txt'
    无锁:读到了 'FAKE-SECRET: 这是伪造的假密码 hu'
    有锁:拦下 '../fake_home/secret.txt' 在知识库目录外面
'…/Users/你/outside/secret.txt'
    无锁:读到了 'OUTSIDE-FAKE-SECRET: 伪造数'
    有锁:拦下 '/Users/你/outside/secret.txt' 在知识库目录外面
'notes-link.md'
    无锁:读到了 'OUTSIDE-FAKE-SECRET: 伪造数'
    有锁:拦下 'notes-link.md' 在知识库目录外面
'kb-001.md/../../fake_home/secret.txt'
    无锁:失败 NotADirectoryError
    有锁:拦下 'kb-001.md/../../fake_home/secret.txt' 在知识库目录外面
''
    无锁:失败 IsADirectoryError
    有锁:拦下 文件名为空或含有非法字符
```

没有锁的版本,除了那两个本来就拼不出合法路径的写法(第五条报 `NotADirectoryError`,空串报 `IsADirectoryError`),**三种穿越全部读到了内容**:`../fake_home/secret.txt`、绝对路径、符号链接。尤其是符号链接那条,名字叫 `notes-link.md`、后缀是 `.md`,光看文件名看不出任何问题。有锁的版本六个里放行一个、拦下五个,拦下的理由都是「`resolve` 之后的真实位置在外面」或「名字有问题」。

### 第二层:sandbox-exec,进程层

`kb_jail` 有个限制:它只管走它的代码路径。哪天有人在别处写了一个 `open(...)`,或者引入的第三方库有个漏洞,锁就绕过去了。第二层是让操作系统来管,不信任任何代码:`sandbox-exec` 是 macOS 自带的命令,用一份配置文件(profile)声明「这个进程能读哪些路径、能写哪些路径、能不能联网」,违反的操作系统直接拒绝,返回 `Operation not permitted`。

它相当于前端里的 CSP(内容安全策略)和 iframe 的 `sandbox` 属性:不管页面里的脚本怎么写,浏览器按声明限制它。

先看配置文件。`sandbox/docqa.sb.tpl`(`tpl` 是 template,模板,里面有两个占位符 `@LAB@`、`@UVPY@`,下一步换成你机器上的真实路径):

```scheme
(version 1)
(deny default)
; 进程、信号、系统信息:Python 起得来所需的最少几项
(allow process-fork)
(allow process-exec*)
(allow file-read-metadata)
(allow signal (target self))
(allow sysctl-read)
(allow mach-lookup)
(allow ipc-posix-shm*)
; 联网:要调用大模型 API 和 embedding 接口
(allow network*)
; 读:系统目录 + Python 解释器 + 本项目目录,别的(包括整个家目录)一律不给
(allow file-read*
  (literal "/")
  (subpath "/usr")
  (subpath "/System")
  (subpath "/Library")
  (subpath "/bin")
  (subpath "/private/etc")
  (subpath "/private/var/db")
  (subpath "/dev")
  (subpath "@UVPY@")
  (subpath "@LAB@"))
; 写:只允许本项目目录和 /dev/null
(allow file-write*
  (literal "/dev/null")
  (literal "/dev/dtracehelper")
  (subpath "@LAB@"))
```

<div class="line-notes">

- `(version 1)` profile 语法版本,固定写这个。整个文件是 Scheme(一种 Lisp 方言)的写法,括号表示一条规则,`;` 开头是注释。
- `(deny default)` **默认拒绝一切**。这是整个配置的立场:先全关上,再一项项开。反过来「默认放行再列禁止项」是常见的错误写法,漏列一项就是一个洞。
- `(allow process-fork)` 允许创建子进程,Python 启动要用。
- `(allow process-exec*)` 允许执行程序。星号是通配符,覆盖 `process-exec` 和 `process-exec-interpreter` 等同族的权限。一开始我只写了 `process-exec`,启动时报 `execvp() of '.venv/bin/python' failed: Operation not permitted`,加上星号才通。
- `(allow file-read-metadata)` 允许读文件的元信息(存不存在、多大),不允许读内容。Python 启动时要沿着路径一级一级 `stat`。这条放得比较宽,代价是外面的文件「存在与否」能被探到,但内容读不到。
- `(allow signal (target self))` 只允许给自己发信号,不能给别的进程发。
- `(allow sysctl-read)` 读系统参数(CPU 核数这类),Python 和 numpy 启动要用。
- `(allow mach-lookup)` macOS 进程间通信的名字查询,很多系统库在背后用。放得比较宽,是实测「不开起不来」的最小集之一。
- `(allow ipc-posix-shm*)` 共享内存,numpy 的库会用。
- `(allow network*)` 允许联网。这个 Agent 要调用大模型 API 和 embedding 接口,不开就没法工作。注意这是留的一个大口子:进程能读到的东西,理论上可以通过网络发出去,所以「能读什么」那几条要收得更紧。
- `(allow file-read*` 读权限的白名单开始,下面每一行是一个允许读的位置。
- `(literal "/")` `literal` 只匹配这一个路径本身,不包括子目录。根目录本身要能 `stat`。
- `(subpath "/usr")` `subpath` 匹配这个目录和它下面所有东西。`/usr`、`/System`、`/Library`、`/bin` 是系统库和命令。
- `(subpath "/private/etc")` `/etc` 在 macOS 上是指向 `/private/etc` 的链接,要写真实路径。放行它,是因为解析域名、证书这些要读里面的文件。
- `(subpath "@UVPY@")` uv 管理的 Python 解释器所在的整个目录。这个目录在家目录下面(`~/.local/share/uv/python/...`),是整个配置里唯一放进来的家目录路径,只放这一个解释器,别的一概不给。
- `(subpath "@LAB@"))` 整个 `agent-zero-lab/`。
- `(allow file-write*` 写权限单独一组,比读窄得多。
- `(literal "/dev/null")` 程序常往这里丢弃输出。
- `(subpath "@LAB@"))` 只能写项目目录。要往项目外写,操作系统直接拒绝。

</div>

占位符不手改,写个小脚本替换。新建 `part04/make_sandbox.py`:

```python
# agent-zero-lab/part04/make_sandbox.py  把 sandbox/docqa.sb.tpl 里的占位符换成本机真实路径,生成 sandbox/docqa.sb
from pathlib import Path

lab = Path.cwd().resolve()
uv_python = Path(".venv/bin/python").resolve().parents[1]  # 解释器所在的整个目录
text = Path("sandbox/docqa.sb.tpl").read_text(encoding="utf-8")
text = text.replace("@LAB@", str(lab)).replace("@UVPY@", str(uv_python))
Path("sandbox/docqa.sb").write_text(text, encoding="utf-8")
print("lab    =", lab)
print("python =", uv_python)
```

<div class="line-notes">

- `lab = Path.cwd().resolve()` 当前目录的绝对路径(带 `resolve`,处理符号链接。macOS 上 `/tmp` 实际是 `/private/tmp`,沙箱配置里必须写真实路径,写成别名不生效)。
- `uv_python = Path(".venv/bin/python").resolve().parents[1]  # 解释器所在的整个目录` `.venv/bin/python` 是个符号链接,`resolve()` 之后变成 uv 目录里真正的解释器路径,形如 `.../cpython-3.12.13-macos-x86_64-none/bin/python3.12`。`parents[1]` 取上两级,也就是 `.../cpython-3.12.13-macos-x86_64-none/`,整个解释器目录(标准库在 `lib/` 下面,不放整个目录的话 Python 找不到自己的标准库)。
- `text = text.replace("@LAB@", str(lab)).replace("@UVPY@", str(uv_python))` 两个占位符各换一次,链式调用。
- `Path("sandbox/docqa.sb").write_text(text, encoding="utf-8")` 生成的 `docqa.sb` 里是你机器上的绝对路径,不要提交进 git,每台机器各生成一份。

</div>

```bash
uv run python -m part04.make_sandbox
```

```text
lab    = /Users/你/agent-zero-lab
python = /Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none
```

再写一个探针,看同一段代码在「裸跑」和「关进沙箱」时,哪些路径读得到、写得进。新建 `part04/sandbox_probe.py`:

```python
# agent-zero-lab/part04/sandbox_probe.py  探一探:同一段代码,裸跑和关进 sandbox-exec,哪些路径读得到、写得进
import sys
from pathlib import Path

targets = {
    "项目里的 data/kb/kb-001.md": ("r", Path("data/kb/kb-001.md")),
    "项目里的 data/fake_home/secret.txt": ("r", Path("data/fake_home/secret.txt")),
    "项目外的伪造文件 ../outside/secret.txt": ("r", Path("../outside/secret.txt")),
    "往项目外写 ../outside/new.txt": ("w", Path("../outside/new.txt")),
    "往项目内写 data/ok.txt": ("w", Path("data/ok.txt")),
}
print("模式:", sys.argv[1] if len(sys.argv) > 1 else "?")
for name, (mode, p) in targets.items():
    try:
        if mode == "r":
            p.read_text(encoding="utf-8")
        else:
            p.write_text("x", encoding="utf-8")
        print(f"  可以  {name}")
    except OSError as e:
        print(f"  拒绝  {name}  ->  {type(e).__name__}: {e.strerror}")
```

<div class="line-notes">

- `import sys` 读命令行参数,用来在输出里标注是哪种模式。
- `targets = {` 五个靶子,字典的值是 `(模式, 路径)` 元组,`"r"` 读、`"w"` 写。全是项目里的文件或 `../outside/` 里的伪造文件。
- `"往项目外写 ../outside/new.txt": ("w", Path("../outside/new.txt")),` 写项目外面的新文件。
- `print("模式:", sys.argv[1] if len(sys.argv) > 1 else "?")` `sys.argv[0]` 是脚本名,`[1]` 是第一个参数。
- `if mode == "r":` 读模式调用 `read_text`,写模式调用 `write_text`。
- `except OSError as e:` 被沙箱拒绝时 Python 抛的是 `PermissionError`,它是 `OSError` 的子类。
- `print(f"  拒绝  {name}  ->  {type(e).__name__}: {e.strerror}")` `e.strerror` 是系统给的错误描述,沙箱拒绝时是 `Operation not permitted`。

</div>

```bash
.venv/bin/python -m part04.sandbox_probe 裸跑
sandbox-exec -f sandbox/docqa.sb .venv/bin/python -m part04.sandbox_probe sandbox-exec
rm -f ../outside/new.txt data/ok.txt   # 清理探针写出来的文件
```

```text
模式: 裸跑
  可以  项目里的 data/kb/kb-001.md
  可以  项目里的 data/fake_home/secret.txt
  可以  项目外的伪造文件 ../outside/secret.txt
  可以  往项目外写 ../outside/new.txt
  可以  往项目内写 data/ok.txt
模式: sandbox-exec
  可以  项目里的 data/kb/kb-001.md
  可以  项目里的 data/fake_home/secret.txt
  拒绝  项目外的伪造文件 ../outside/secret.txt  ->  PermissionError: Operation not permitted
  拒绝  往项目外写 ../outside/new.txt  ->  PermissionError: Operation not permitted
  可以  往项目内写 data/ok.txt
```

`sandbox-exec -f 配置文件 命令...` 的意思是「按这份配置,启动后面这个命令」。裸跑五项都成功。关进沙箱,项目外的读和写被拒,项目里面的读写照常,**包括 `data/fake_home/secret.txt`**:它在项目目录里,操作系统层面没有理由拦。这就是为什么要两层:`kb_jail` 管「读文章的函数只能读 `data/kb/`」,`sandbox-exec` 管「整个进程不能越出项目目录」。哪一层单独都有洞。

两点说明。第一,`sandbox-exec` 的 man 页自己写着「已弃用」(deprecated),但它是 Claude Code、Codex 这类工具在 macOS 上沿用的机制,2026 年 10 月在 macOS 14(本机)上实测可用;Linux 上对应的是 bubblewrap、Landlock,容器里是容器本身,Day 415 讲沙箱时再展开。第二,这份配置**不是安全边界的终点**:`network*` 全开意味着进程读到的任何东西都能发出去,所以「能读什么」要尽量收窄;而且 `.env` 就在项目目录里,进程读得到,所以真正放到线上时,密钥要走环境变量注入,不能放在进程能读的目录里。

## 命令行外壳

最后写交互外壳。新建 `part04/docqa_cli.py`:

```python
# agent-zero-lab/part04/docqa_cli.py  命令行外壳:/sources 看来源,/open kb-002.md 读整篇(过 kb_jail),/reset 清空,/quit 退出
from part04.docqa import DocQA, Turn
from part04.kb_jail import JailError, read_article


def show_sources(turn: Turn | None) -> None:
    if turn is None:
        print("(还没有问过问题)")
        return
    for c, s in turn.hits:
        print(f"  {s:.3f}  [{c.id}] {c.title} > {c.section}")


def main() -> None:
    qa = DocQA()
    last: Turn | None = None
    print("CloudLedger 帮助中心问答。/sources 看来源  /open kb-002.md 读整篇  /reset 清空  /quit 退出")
    while True:
        try:
            q = input("\n你:").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not q:
            continue
        if q == "/quit":
            break
        if q == "/reset":
            qa.reset()
            last = None
            print("(对话已清空)")
        elif q == "/sources":
            show_sources(last)
        elif q.startswith("/open "):
            try:
                print(read_article(q.removeprefix("/open ").strip())[:300])
            except JailError as e:
                print(f"(拒绝:{e})")
        else:
            last = qa.ask(q)
            print(f"客服:{last.answer}")
            print(f"  [检索词 {last.queries}  最高分 {last.hits[0][1]:.3f}  ¥{last.cost:.4f}  {last.seconds:.1f}s]")
    print(f"\n本次会话共花 ¥{qa.client.ledger.cost:.4f}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from part04.docqa import DocQA, Turn` 骨架和一轮的结果类型。
- `from part04.kb_jail import JailError, read_article` `/open` 命令读整篇用的就是过了锁的函数,外壳里没有任何一处直接 `open(...)`。
- `def show_sources(turn: Turn | None) -> None:` 参数可以是 `None`(还没问过问题)。类型标注里的 `Turn | None` 让编辑器提醒你下面必须先判断。
- `if turn is None:` 判断完这个,下面的 `turn.hits` 才不会被编辑器标红。
- `qa = DocQA()` 一个会话一个 `DocQA`,历史在它里面。
- `last: Turn | None = None` 记着上一轮,`/sources` 用。
- `q = input("\n你:").strip()` 读一行,去掉首尾空格。
- `except (EOFError, KeyboardInterrupt):` 管道喂完输入(EOF)或者按 Ctrl+C,都安静退出循环。下面的实跑就是用管道喂的输入,所以退出走的这里。
- `if q == "/reset":` 命令用 `/` 开头,和真正的问题分开。
- `elif q.startswith("/open "):` 注意空格:`/open` 后面要跟一个名字。
- `read_article(q.removeprefix("/open ").strip())[:300]` `removeprefix` 是 Python 3.9 加的,去掉开头那段,比 `q[6:]` 好读。`[:300]` 只打前 300 个字符,屏幕不被一整篇文章占满。
- `except JailError as e:` 被锁拦下就打印「拒绝」和原因,不是崩溃。
- `last = qa.ask(q)` 一轮问答。
- `print(f"  [检索词 {last.queries}  最高分 {last.hits[0][1]:.3f}  ¥{last.cost:.4f}  {last.seconds:.1f}s]")` 每轮后面跟一行调试信息:检索词、第一名分数、花费、耗时。`last.hits[0][1]` 是第一名的分数。Day 269 要做的校准,就是盯着这一列的数字。
- `print(f"\n本次会话共花 ¥{qa.client.ledger.cost:.4f}")` 退出时的总账。

</div>

用管道喂一段六轮加两条命令的对话,**整个进程跑在沙箱里**。管道喂入时终端不回显输入,下面的输出里我把每一句输入补在了「你:」后面:

```bash
printf '%s\n' "我们是年付的专业版,买了十天,能退吗" "那退款前要做什么准备吗" "发票抬头也写错了,一起处理" "/sources" "你们有学生优惠吗" "好的谢谢" "/open ../fake_home/secret.txt" "/open kb-003.md" "/quit" > /tmp/in.txt
sandbox-exec -f sandbox/docqa.sb .venv/bin/python -m part04.docqa_cli < /tmp/in.txt
```

```text
CloudLedger 帮助中心问答。/sources 看来源  /open kb-002.md 读整篇  /reset 清空  /quit 退出

你:我们是年付的专业版,买了十天,能退吗
客服:可以退,但只按剩余的整月数比例退款,已经使用的月份和当前所在的月份不退。[kb-002#1]

您的情况是年付专业版、已用十天,属于第 1 个月中途取消:当月不退,退剩余 11 个月的费用。以年付专业版 468 元(折合每月 39 元)为例,可退 11 × 39 = 429 元。[kb-002#1]

具体退款金额以您的实际订单金额按上述规则计算为准。
  [检索词 ['我们是年付的专业版,买了十天,能退吗']  最高分 0.703  ¥0.0013  2.3s]

你:那退款前要做什么准备吗
客服:退款前需要确认两件事:

1. 如果这笔订单已经开具发票,需要先申请发票红冲(作废),红冲完成后才能退款。电子普通发票红冲一般当天完成;增值税专用发票需要你方配合退回或开具红字信息表。[kb-003#2]

2. 准备好后进入「设置 → 订阅 → 申请退款」,选择退款原因并提交,客服主管会在 1 个工作日内审批。[kb-003#1]

审批通过后原路退回,支付宝 1 到 3 个工作日到账,银行卡 3 到 7 个工作日到账。[kb-002#4]
  [检索词 ['那退款前要做什么准备吗', '退款前需要准备什么']  最高分 0.102  ¥0.0028  2.6s]

你:发票抬头也写错了,一起处理
客服:发票抬头写错可以和退款一起处理,但要看开票时间:

- 发票开具后 30 天内:在「账单 → 发票」里申请红冲并重新开具,每张发票只能重开一次。[kb-007#1]
- 超过 30 天:需要联系客服,并提供加盖公章的情况说明。[kb-007#1]

结合退款流程,这笔订单的发票需要先完成红冲(作废)才能退款;电子普通发票红冲一般当天完成,增值税专用发票需要你方配合退回或开具红字信息表。[kb-003#2]

所以建议的顺序是:先在「账单 → 发票」处理红冲(超 30 天则联系客服并提交盖章说明),红冲完成后再进入「设置 → 订阅 → 申请退款」提交退款申请,客服主管会在 1 个工作日内审批。[kb-007#1][kb-003#2][kb-003#1]
  [检索词 ['发票抬头也写错了,一起处理', '发票抬头写错如何修改', '退款前发票红冲流程']  最高分 0.967  ¥0.0035  3.3s]

你:/sources
  0.967  [kb-007#1] 修改发票抬头 > 开错了怎么办
  0.241  [kb-003#2] 如何申请退款 > 已经开了发票怎么办
  0.019  [kb-006#2] 发票类型与开具 > 怎么申请
  0.003  [kb-003#1] 如何申请退款 > 操作步骤

你:你们有学生优惠吗
客服:帮助中心里没有找到这个问题的说明,建议转人工客服。
  [检索词 ['你们有学生优惠吗', '学生优惠']  最高分 0.006  ¥0.0022  2.2s]

你:好的谢谢
客服:不客气。如果之后还有 CloudLedger 使用上的问题,随时来问。
  [检索词 ['好的谢谢']  最高分 0.006  ¥0.0022  2.3s]

你:/open ../fake_home/secret.txt
(拒绝:'../fake_home/secret.txt' 在知识库目录外面)

你:/open kb-003.md
---
id: kb-003
title: 如何申请退款
category: 退款
---

# 如何申请退款

## 操作步骤
进入「设置 → 订阅 → 申请退款」,选择退款原因并提交。客服主管会在 1 个工作日内审批。
审批通过后进入退款流程,退款金额和到账时间见《退款政策》。

## 已经开了发票怎么办
如果这笔订单已经开具发票,需要先申请发票红冲(作废),红冲完成后才能退款。电子普通发票红冲一般当天完成,增值税专用发票需要你方配合退回或开具红字信息表。


你:/quit
本次会话共花 ¥0.0121
```

逐轮看:

**第 1 轮**,没有历史,不改写,`queries` 只有原话一条,最高分 0.703,¥0.0013。答案引用 `[kb-002#1]`,把年付规则和「买了十天属于当前月份」接上了,还顺手按 468 元算了个例子。

**第 2 轮「那退款前要做什么准备吗」**,有历史了,改写成了 `退款前需要准备什么`,检索词多了一条。这一轮最高分 0.102,和上面 `docqa_nohist` 里没改写的 0.037 比,将近三倍。回答同时用到了 `kb-003#2`(开了发票要先红冲)、`kb-003#1`(申请入口)和 `kb-002#4`(到账时间),比没有历史的版本完整。

**第 3 轮「发票抬头也写错了,一起处理」**,检索词是原话加两条改写,共三条(抬头写错怎么改、退款前发票红冲流程),最高分 0.967,发票和退款两块资料都进了回答。这一轮最贵最慢,¥0.0035,3.3 秒。

**`/sources`** 列出的是第 3 轮的四块:`kb-007#1` 0.967,后面三块分数掉到 0.241、0.019、0.003。第一名和第二名差了四倍,和第三名差了五十倍。

**第 4 轮「你们有学生优惠吗」**,帮助中心里确实没有。最高分 0.006,模型按 prompt 里的规则回了那句拒答话术,没有编。但注意:这是模型自己看了四块不相关的资料之后「悟」出来的,多花了一次检索和一次回答,¥0.0022。Day 269 要把它前移,分数低就直接拒答。

**第 5 轮「好的谢谢」**,检索词只有原话,最高分 0.006,这一次模型回的是「不客气。如果之后还有 CloudLedger 使用上的问题,随时来问。」,没问题。但我前一次跑同一句,回答是这样的:

```text
你:好的谢谢
客服:不客气。如果后续还有账号安全、数据备份、流水导入或团队成员方面的问题,可以随时问我。[kb-016#1][kb-018#2][kb-009#1][kb-015#3]
  [检索词 ['好的谢谢']  最高分 0.006  ¥0.0013  1.6s]
```

同一句寒暄,后面挂着四个引用,指向四篇毫不相干的文章。原因很清楚:寒暄也被拿去检索了,四块不相关的资料被塞进 prompt,模型有时老实说句客气话,有时照着「每句话后面标出处」的规则硬标出来。**这类问题靠运气不行**,而且你没法靠「再跑几遍都正常」就认定它没有。Day 269 的引用校验会把它抓出来,寒暄分流会让它根本走不到生成这一步。

最后两条 `/open`:`../fake_home/secret.txt` 被拒,`kb-003.md` 正常读出来。整个过程在沙箱里跑,联网调模型和 embedding 都没受影响。

## 把今天写的东西对到文件上

| 零件 | 大代码里对应哪里 | 文件 |
| --- | --- | --- |
| 点名 | 开工前跑一次 | `part04/docqa_check.py` |
| 步骤 1 到 6 | `DocQA.ask` 的函数体,从上到下就是六步 | `part04/docqa.py` |
| 检索词可外传 | `retrieve` 的 `queries` 参数 | `part04/retrieve.py` |
| 历史只存文本 | `self.history += [...]` 两条字典 | `part04/docqa.py` |
| 读文件的第一层锁 | `resolve_inside`、`read_article` | `part04/kb_jail.py` |
| 读文件的第二层锁 | `sandbox/docqa.sb.tpl`,`make_sandbox.py` 生成 | `sandbox/`、`part04/make_sandbox.py` |
| 交互外壳 | `main()` 的 `while True` 循环 | `part04/docqa_cli.py` |

## 动手练习

五道练习,每道做完再展开参考答案。练习脚本都新建在 `part04/` 下,从 `agent-zero-lab/` 根目录用 `uv run python -m part04.xxx` 运行。

### 练习 1:改写到底把追问改成了什么

手写两条历史(月付不能退款),然后让 `rewrite` 改写三句话:「那年付的呢」「它能开专票吗」「好的谢谢」。把三个结果打印出来。观察哪一个改写得对、哪一个让你意外,写下一句判断。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex268_1.py  练习 1:同一段历史,三句不同的话,rewrite 各改成什么检索词
from part04.rewrite import default_client as client, rewrite

history = [
    {"role": "user", "content": "月付的能退款吗"},
    {"role": "assistant", "content": "月付套餐不支持中途退款,当期结束后停止服务。[kb-002#2]"},
]
for q in ["那年付的呢", "它能开专票吗", "好的谢谢"]:
    print(f"{q!r:<14} -> {rewrite(q, history)}")
print(f"花费 ¥{client.ledger.cost:.4f}")
```

<div class="line-notes">

- `from part04.rewrite import default_client as client, rewrite` 把 `rewrite.py` 里的默认客户端也 import 出来,`as client` 起个短名字,最后读它的账本。这里直接调 `rewrite` 没传客户端,所以走默认的那个。
- `history = [` 手写的两条历史:用户问月付能不能退,助手答了不支持。`rewrite` 只看最近 6 条(`[-6:]`),这里只有 2 条。
- `for q in ["那年付的呢", "它能开专票吗", "好的谢谢"]:` 三种追问:有关键词的追问、纯指代的追问、寒暄。
- `print(f"{q!r:<14} -> {rewrite(q, history)}")` `!r` 加引号,`:<14` 左对齐 14 格。注意引号里的中文字符宽度和英文不一样,对不齐是正常的。

</div>

```text
'那年付的呢'        -> ['年付套餐是否支持退款']
'它能开专票吗'       -> ['月付套餐能否开具增值税专用发票']
'好的谢谢'         -> ['好的谢谢']
花费 ¥0.0017
```

「那年付的呢」改成 `年付套餐是否支持退款`,对。「好的谢谢」原样返回,对,说明改写提示词里「寒暄原样返回」那条在起作用。意外的是「它能开专票吗」被改成 `月付套餐能否开具增值税专用发票`:历史里只聊过月付,模型就把「月付」当成了上下文塞进去。客户说的「它」其实可能指的是整个订阅。改写是一次猜测,猜错了检索就偏。这就是为什么 `ask` 里保留原话作为第一条检索词:改写猜错的话,原话那一路还在。

</details>

### 练习 2:把 kb_jail 的行为写成断言

为 `resolve_inside` 写八个用例(名字、该不该放行),跑一遍并用 `assert` 检查。另外再准备一个 `data/kb_evil/x.md`(伪造文件),验证「用字符串前缀判断是不是在里面」这种写法为什么不行。

<details><summary>参考答案</summary>

先建伪造文件:

```bash
mkdir -p data/kb_evil && echo "FAKE evil 文件,伪造数据" > data/kb_evil/x.md
```

```python
# agent-zero-lab/part04/ex268_2.py  练习 2:把 kb_jail 的行为写成断言;再看「用字符串前缀判断」为什么挡不住 data/kb_evil/
from pathlib import Path

from part04.kb_jail import KB_ROOT, JailError, resolve_inside

CASES = [  # (名字, 应该放行吗)
    ("kb-001.md", True),
    ("kb-0/../kb-001.md", True),  # 绕一圈又回到知识库里面,放行
    ("../kb_evil/x.md", False),
    ("../fake_home/secret.txt", False),
    ("/etc/hosts", False),
    ("kb-001.MD", False),  # 后缀大小写不对
    ("kb-001.md\x00.txt", False),
    ("", False),
]
for name, ok in CASES:
    try:
        resolve_inside(name)
        got = True
    except JailError:
        got = False
    print(f"{'通过' if got == ok else '不符'}  放行={got!s:<5} {name!r}")
    assert got == ok

# 对照:字符串前缀判断。data/kb_evil 的路径以 data/kb 开头,所以「前缀相同」被当成「在里面」
evil = Path("data/kb_evil/x.md").resolve()
print("\nstartswith 的判断:", str(evil).startswith(str(KB_ROOT)))
print("is_relative_to 的判断:", evil.is_relative_to(KB_ROOT))
```

<div class="line-notes">

- `from part04.kb_jail import KB_ROOT, JailError, resolve_inside` 把根目录常量也取出来,最后对照用。
- `CASES = [  # (名字, 应该放行吗)` 每个用例是一个元组:名字和期望。
- `("kb-0/../kb-001.md", True),  # 绕一圈又回到知识库里面,放行` 路径 `data/kb/kb-0/../kb-001.md` 在 `resolve` 之后是 `data/kb/kb-001.md`,在锁里面。`kb-0` 这个目录并不存在,`resolve()` 默认不要求存在(`strict=False`),照样能算出结果。所以这条放行,是对的:拦的是「最后落在哪」,不是「路径里有没有 `..`」。
- `("../kb_evil/x.md", False),` 这个目录名以 `kb` 开头,和 `data/kb` 有相同的前缀,是为下面的对照准备的。
- `("/etc/hosts", False),` 绝对路径。这里只是检查字符串被拒绝,脚本没有真的去读这个文件。
- `("kb-001.MD", False),  # 后缀大小写不对` 严格匹配 `.md`,大写的被拒。保守一点没有坏处,macOS 的文件系统默认不分大小写,别的系统分,统一成只认小写。
- `("kb-001.md\x00.txt", False),` NUL 字符那条。
- `got = True` 没抛异常就是放行。
- `print(f"{'通过' if got == ok else '不符'}  放行={got!s:<5} {name!r}")` `!s` 把布尔值转成字符串,才能用 `:<5` 对齐。
- `assert got == ok` 不符就会抛 `AssertionError` 终止脚本。
- `evil = Path("data/kb_evil/x.md").resolve()` 项目里另一个目录里的文件。
- `str(evil).startswith(str(KB_ROOT))` 字符串前缀判断。`/…/data/kb_evil/x.md` 以 `/…/data/kb` 开头,所以是 `True`:这种写法会把 `kb_evil` 当成 `kb` 里面的东西放进来。
- `evil.is_relative_to(KB_ROOT)` 按路径的段比较,`kb_evil` 和 `kb` 是两段不同的名字,结果是 `False`。

</div>

```text
通过  放行=True  'kb-001.md'
通过  放行=True  'kb-0/../kb-001.md'
通过  放行=False '../kb_evil/x.md'
通过  放行=False '../fake_home/secret.txt'
通过  放行=False '/etc/hosts'
通过  放行=False 'kb-001.MD'
通过  放行=False 'kb-001.md\x00.txt'
通过  放行=False ''

startswith 的判断: True
is_relative_to 的判断: False
```

八个用例全部符合预期。最后两行是重点:字符串前缀判断说 `True`(放行),`is_relative_to` 说 `False`(拦下)。如果你自己写这种检查,别用 `startswith`,用 `is_relative_to`(Python 3.9 起有)。

</details>

### 练习 3:改写接口超时了,整轮问答跟着死吗

用一个一定超时的假函数替换 `rewrite.client.chat`,问一句追问,观察现状。然后写一个 `safe_rewrite`:改写失败就只用原话检索,并打印一行提示。

<details><summary>参考答案</summary>

先看现状:

```python
# agent-zero-lab/part04/ex268_3.py  练习 3:改写这一步挂了(接口超时)会怎样?先看现状,再让它降级成「只用原话检索」
import part04.docqa as docqa_mod
from part04.docqa import DocQA


def boom(*a, **kw):
    raise TimeoutError("模拟改写接口超时")


docqa_mod.rewrite = boom  # 把 docqa 里调用的 rewrite 换成一定超时的假函数

qa = DocQA()
qa.history = [{"role": "user", "content": "月付的能退款吗"},
              {"role": "assistant", "content": "月付套餐不支持中途退款。[kb-002#2]"}]

try:
    qa.ask("那年付的呢")
except TimeoutError as e:
    print("现状:整轮问答跟着挂了 ->", repr(e))
```

<div class="line-notes">

- `import part04.docqa as docqa_mod` 导入模块并起别名,为了改它里面的 `rewrite`。`docqa.py` 里是 `from part04.rewrite import rewrite`,在 `docqa` 这个模块的命名空间里就有了一个叫 `rewrite` 的名字,替换它,`ask` 就会调到替换后的版本。
- `def boom(*a, **kw):` `*a, **kw` 接收任意参数(Day 30 学的),假装自己是 `rewrite`。
- `raise TimeoutError("模拟改写接口超时")` 主动抛超时异常。
- `docqa_mod.rewrite = boom  # 把 docqa 里调用的 rewrite 换成一定超时的假函数` 只影响这个脚本的进程。
- `qa.history = [{"role": "user", "content": "月付的能退款吗"},` 直接给 `DocQA` 塞一段历史,这样 `ask` 才会走到改写那一步。
- `except TimeoutError as e:` 异常从 `rewrite` 一路冒到 `ask` 再到这里。

</div>

```text
现状:整轮问答跟着挂了 -> TimeoutError('模拟改写接口超时')
```

整轮挂了。改写只是锦上添花,它超时不该拖死回答。修法是包一层降级:

```python
# agent-zero-lab/part04/ex268_3_fix.py  练习 3 参考答案:给 rewrite 包一层 safe,改写失败就只用原话
import part04.docqa as docqa_mod
from part04.docqa import DocQA


def safe(rewrite_fn):
    """返回一个新函数:调 rewrite_fn,失败了就退回「只有原话」。"""
    def wrapper(question, history, client=None):
        try:
            return rewrite_fn(question, history, client)
        except Exception as e:  # 改写只是锦上添花,挂了不能拖死整轮
            print(f"  (改写失败,降级:{type(e).__name__})")
            return [question]
    return wrapper


def boom(*a, **kw):
    raise TimeoutError("模拟改写接口超时")


docqa_mod.rewrite = safe(boom)  # 实际改 docqa.py 时写 rewrite = safe(rewrite) 就行;这里用 boom 模拟它超时

qa = DocQA()
qa.history = [{"role": "user", "content": "月付的能退款吗"},
              {"role": "assistant", "content": "月付套餐不支持中途退款。[kb-002#2]"}]
t = qa.ask("那年付的呢")
print("检索词:", t.queries)
print("最高分:", f"{t.hits[0][1]:.3f}", t.hits[0][0].id)
print("回答:", t.answer[:80])
print(f"花费 ¥{qa.client.ledger.cost:.4f}")
```

<div class="line-notes">

- `def safe(rewrite_fn):` 一个「包装函数」:收一个函数,返回一个新函数。相当于 JS 里的高阶函数 `const safe = fn => (...args) => { try { return fn(...args) } catch { ... } }`。
- `def wrapper(question, history, client=None):` 新函数的参数和 `rewrite` 一样,可以直接顶替它。
- `return rewrite_fn(question, history, client)` 正常情况原样转调。
- `except Exception as e:  # 改写只是锦上添花,挂了不能拖死整轮` 这里捕获所有异常是合理的:改写失败的原因很多(超时、限流、JSON 解析),处理方式一样,都是降级。
- `print(f"  (改写失败,降级:{type(e).__name__})")` 降级要留痕。静默吞掉异常,以后检索质量变差,没人知道改写早就一直在失败。真实项目里这里应该写日志、记指标。
- `return [question]` 降级结果:只有原话。
- `return wrapper` 把包好的函数交出去。
- `docqa_mod.rewrite = safe(boom)  # 实际改 docqa.py 时写 rewrite = safe(rewrite) 就行;这里用 boom 模拟它超时` 把 `boom`(一定超时)包一层再替换进去。实际项目里是 `rewrite = safe(rewrite)`。
- `t = qa.ask("那年付的呢")` 现在不抛异常了。
- `print("最高分:", f"{t.hits[0][1]:.3f}", t.hits[0][0].id)` 没改写,rerank 用原话打分,最高分 0.074,这句话里本来就有「年付」,碰巧还够用。

</div>

```text
  (改写失败,降级:TimeoutError)
检索词: ['那年付的呢']
最高分: 0.074 kb-002#1
回答: 年付套餐中途取消可以按比例退款。[kb-002#1]

条件是：按剩余的整月数比例退款，已经使用的月份和当前所在的月份不退。[kb-002#1]

例如年付专业
花费 ¥0.0012
```

降级之后,这一轮还是答出来了(检索词只有原话,最高分 `kb-002#1` 0.074)。代价是遇到没有关键词的追问会检索不准,但比整轮报错好。

</details>

### 练习 4:压缩在第几轮触发

把 `trigger_tokens` 调到 600、`keep_last_turns` 调到 2,连问六轮,最后一轮问「回到最开始,我们那个订阅最后能退多少钱来着」。打印每轮历史的条数、token 数、有没有摘要,以及摘要全文和第六轮的回答。观察:摘要里还留着几条关键信息?第六轮接得住吗?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex268_4.py  练习 4:trigger_tokens 调小到 600,看五轮对话里压缩在第几轮触发、摘要长什么样、第 6 轮的问题还接不接得住
from common.llm import LLMClient
from part04.compaction import SUMMARY_TAG
from part04.ctx_budget import message_tokens
from part04.docqa import DocQA

qa = DocQA(LLMClient(), keep_last_turns=2, trigger_tokens=600)
for q in ["我们是年付的专业版,买了十天,能退吗", "那退款前要做什么准备吗", "发票抬头也写错了,一起处理",
          "导入流水报 E1043 怎么解决", "Excel 存的 csv 传上去说格式不对,好像是乱码",
          "回到最开始,我们那个订阅最后能退多少钱来着"]:
    t = qa.ask(q)
    size = sum(message_tokens(m) for m in qa.history)
    summary = [m for m in qa.history if m["content"].startswith(SUMMARY_TAG)]
    print(f"{q[:14]:<16} 历史 {len(qa.history)} 条 {size:>4} token  摘要 {'有' if summary else '无'}  ¥{t.cost:.4f}")
print("\n摘要:", summary[0]["content"] if summary else "(无)")
print("\n第 6 轮的回答:", t.answer[:200])
```

<div class="line-notes">

- `from part04.compaction import SUMMARY_TAG` 摘要消息的开头标记,用它找出历史里的摘要。
- `qa = DocQA(LLMClient(), keep_last_turns=2, trigger_tokens=600)` 把压缩阈值压低,才能在五六轮里看到它触发。默认的 2000 要聊十几轮才触发。
- `t = qa.ask(q)` 每轮真的问。
- `size = sum(message_tokens(m) for m in qa.history)` 把历史里每条消息的粗估 token 加起来。
- `summary = [m for m in qa.history if m["content"].startswith(SUMMARY_TAG)]` 找摘要消息。
- `{'有' if summary else '无'}` 空列表是假,所以有摘要时打「有」。
- `print("\n摘要:", summary[0]["content"] if summary else "(无)")` 最后打印摘要全文。

</div>

```text
我们是年付的专业版,买了十天   历史 2 条  194 token  摘要 无  ¥0.0017
那退款前要做什么准备吗      历史 4 条  355 token  摘要 无  ¥0.0030
发票抬头也写错了,一起处理    历史 6 条  598 token  摘要 无  ¥0.0041
导入流水报 E1043 怎么   历史 5 条  540 token  摘要 有  ¥0.0049
Excel 存的 csv 传   历史 5 条  458 token  摘要 有  ¥0.0063
回到最开始,我们那个订阅最后   历史 5 条  520 token  摘要 有  ¥0.0060

摘要: 【之前对话的摘要】
**摘要：** 客户为年付专业版用户，购买十天，席位及退款金额待核实。诉求：退款，并更正发票抬头。已告知：年付按剩余整月比例退款，已用及当月不退；退款前须先红冲发票（电子普票当天完成，专票需客户配合退回或开红字信息表），再于「设置→订阅→申请退款」提交，主管1个工作日内审批；发票30天内可红冲重开一次，超30天需盖章说明并转人工。另咨询导入流水报E1043，已告知为编码问题，需另存为CSV UTF-8或上传XLSX，并提醒模板四列及日期、金额格式要求。待办：核实退款金额、确认开票时间及发票类型，转人工一并处理。客户未表达明确不满或偏好。

第 6 轮的回答: 帮助中心里没有找到能确定您这笔订阅具体退款金额的说明,建议转人工客服。

资料里只有通用规则:年付套餐中途取消,按剩余整月数比例退款,已使用的月份和当前所在月份不退 [kb-002#1];如果订单用过优惠码,按实际支付金额退款,优惠部分不退现金 [kb-008#2]。

要算出具体金额,需要先核实您的实际支付金额、开卡(开通)日期和取消日期,这些信息我这边没有,所以无法给出数字。
```

第 3 轮结束时历史是 6 条、598 token,刚好压在 600 下面,没触发。第 4 轮一超线,压缩触发,历史变成 5 条:一条摘要加最近 2 轮原文,540 token。之后两轮是 458 和 520,不再随轮数一路涨。摘要里保住了:客户是年付专业版、买了十天、退款规则、先红冲再退款的顺序、发票抬头 30 天内可重开一次,以及导入报 E1043 的处理,还把「核实退款金额、确认开票时间及发票类型」列成了待办。

第六轮的回答接住了「最开始那个订阅」,引用了 `kb-002#1`,没有编一个金额,说帮助中心里没有能确定这笔订阅具体金额的说明,建议转人工。也有不太对味的地方:它顺手加了一句和这个问题无关的优惠码规则(`kb-008#2`)。压缩换来的是省 token,不是零损失,摘要是总结模型写的,它写什么不写什么你控制不了,所以重要的事实要靠评估去量(Day 263 量过)。

</details>

### 练习 5(开放题):k 取多大,「一句话问两件事」才答得全

对评估集里 `multi` 类型的四道题(q23 到 q26),分别用 `k=2、4、6` 检索,统计「期望的文章」被覆盖了几篇、资料部分有多少 token。再试 `k=4` 加改写。你认为 k 该定多少?写出理由。

<details><summary>参考答案(示范解法,不是唯一答案)</summary>

```python
# agent-zero-lab/part04/ex268_5.py  练习 5(开放题):k 取 2、4、6,四道「一句话问两件事」的题,期望的文章各被检索到几篇;prompt 的资料部分多长
from collections import defaultdict
import json

from part04.ctx_budget import estimate_tokens
from part04.retrieve import retrieve

rows = [json.loads(l) for l in open("data/eval/rag_eval.jsonl", encoding="utf-8")]
multi = [r for r in rows if r["type"] == "multi"]
for k in (2, 4, 6):
    covered, total, toks = 0, 0, 0
    miss = defaultdict(list)
    for r in multi:
        hits = retrieve(r["question"], k=k)
        got = {c.doc_id for c, _ in hits}
        for d in r["expected_docs"]:
            total += 1
            if d in got:
                covered += 1
            else:
                miss[r["id"]].append(d)
        toks += estimate_tokens("\n".join(c.text for c, _ in hits))
    print(f"k={k}: 期望的文章覆盖 {covered}/{total},资料部分平均 {toks // len(multi)} token,漏掉 {dict(miss)}")

# 再试一招:k 不变(4),但让 rewrite 把一句话拆成几个查询,各检索一次再融合
covered, total = 0, 0
for r in multi:
    hits = retrieve(r["question"], k=4, use_rewrite=True)
    got = {c.doc_id for c, _ in hits}
    miss = [d for d in r["expected_docs"] if d not in got]
    covered += len(r["expected_docs"]) - len(miss)
    total += len(r["expected_docs"])
    print(f"  {r['id']} 漏 {miss}")
print(f"k=4 + rewrite: 覆盖 {covered}/{total}")
```

<div class="line-notes">

- `from collections import defaultdict` 带默认值的字典,`miss[r["id"]]` 第一次访问时自动建一个空列表。
- `rows = [json.loads(l) for l in open("data/eval/rag_eval.jsonl", encoding="utf-8")]` 评估集一行一个 JSON(Day 257),`json.loads` 解析一行。
- `multi = [r for r in rows if r["type"] == "multi"]` 筛出四道多问题的题。
- `got = {c.doc_id for c, _ in hits}` 集合推导式:检索到的块来自哪些文章。块是 `kb-002#1` 这种,`doc_id` 是文章编号 `kb-002`,评估看的是文章。
- `miss[r["id"]].append(d)` 记下哪一题漏了哪篇期望的文章。
- `toks += estimate_tokens("\n".join(c.text for c, _ in hits))` 估算资料部分的 token。
- `toks // len(multi)` 整除,取平均。
- `hits = retrieve(r["question"], k=4, use_rewrite=True)` 第二段:`k` 不变,让改写把一句话拆成几个查询。没有历史,所以 `history` 不传。

</div>

```text
k=2: 期望的文章覆盖 7/8,资料部分平均 128 token,漏掉 {'q26': ['kb-011']}
k=4: 期望的文章覆盖 7/8,资料部分平均 260 token,漏掉 {'q26': ['kb-011']}
k=6: 期望的文章覆盖 7/8,资料部分平均 332 token,漏掉 {'q26': ['kb-011']}
  q23 漏 []
  q24 漏 []
  q25 漏 []
  q26 漏 ['kb-011']
k=4 + rewrite: 覆盖 7/8
```

四道题总共期望 8 篇文章,不管 `k` 取 2、4 还是 6,都是覆盖 7 篇,漏的始终是 q26 的 `kb-011`。加了改写也是 7/8。资料部分的 token 从 128 涨到 332,多花的钱换不来多覆盖一篇。

所以结论是:`k=4` 够用,往上加没有收益,往下减到 2 也一样,只是在别的题型上我没有验证,不能说 2 够。真正的问题在 q26「导入流水支持哪些银行,文件编码有要求吗」。改写把它拆成了 `导入流水支持哪些银行` 和 `导入流水文件编码有什么要求`,但第二条检索回来的是导入相关的 `kb-009`、`kb-010`,讲编码的 `kb-011` 是一篇专门讲 `E1043` 错误码的文章,字面上和「文件编码有什么要求」不够像,连 `k=8` 都没捞到。这是检索本身的缺口,不是 `k` 能补的。Day 259 在评估集上第一次量到它,Day 266 的 Agentic RAG 靠模型自己换词再查,把它补上了。留给 Day 270 的坑清单。

</details>

**验收标准:**

- `docqa_check.py` 全部显示 OK。
- 用管道或手敲跑完一段至少 6 轮的对话,其中有追问、一句话问两件事、一个查不到的问题、一句寒暄,`/sources` 和 `/open` 都试过。
- `/open ../fake_home/secret.txt` 被拒;在 `sandbox-exec` 里跑通整个命令行。
- 能不看文章,说出一轮对话的六个步骤和「为什么历史只存问答文本」。
- 练习 1 到 4 的脚本跑出和参考答案同量级的数字(措辞会不同)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 骨架(skeleton) | 项目里先把所有环节按正确顺序接起来、每个环节先用最简单的实现,能端到端跑通一轮。后面再逐个环节加强。今天的 `DocQA.ask` 就是骨架 |
| 多轮对话 | 用户连续问几句,后一句会依赖前一句的内容(「那年付的呢」)。程序要自己记着历史,模型本身不记事 |
| 追问补全 | 把依赖上下文的半句话,改写成一句单独拿出来也看得懂的问题,再去检索。「那年付的呢」补全成「年付套餐是否支持退款」 |
| 降级 | 某个环节出错时,退回一个简单但能用的做法,让整体继续工作。改写失败就只用原话检索 |
| 路径穿越(path traversal) | 利用 `../`、绝对路径或符号链接,让程序读到本不该读的文件。[Day 266](/blog/agent-zero/day-266-agentic-rag/) 演示过 |
| `resolve()` | pathlib 的方法:把路径变成绝对路径,去掉 `..`,并跟着符号链接走到最终位置。判断一个路径落在哪里,必须先 resolve 再比较 |
| `is_relative_to` | pathlib 的方法:判断一个路径是否在另一个目录里面,按路径的段比较,不是比字符串前缀 |
| 符号链接(symlink) | 一种特殊文件,内容是一个指向别处的路径,打开它等于打开目标文件。类似浏览器里的重定向 |
| 沙箱(sandbox) | 限制程序能碰什么资源(文件、网络、进程)的隔离环境。类似 iframe 的 `sandbox` 属性,不管里面的脚本怎么写,外面按声明限制 |
| `sandbox-exec` | macOS 自带命令,按一份 profile 配置启动程序并限制它。man 页标注已弃用,但仍可用 |
| profile(沙箱配置) | `sandbox-exec` 读的规则文件,Scheme 语法,写明默认拒绝还是放行,以及允许哪些路径和操作 |
| 默认拒绝(deny default) | 先禁止一切,再逐项开放。反过来「默认放行再列禁止项」,漏列一项就是漏洞 |
| 占位符与模板 | 配置文件里先写 `@LAB@` 这样的占位,生成时再替换成本机真实路径,同一份模板可以在不同机器上用 |
| NUL 字符(`\x00`) | 值为 0 的字符。C 语言把它当字符串结尾,攻击者用它在文件名里截断后缀检查 |

## 常见误区

**追问不补全就直接检索。** 最小版里「那年付的呢」只拿到 0.075,「那退款前要做什么准备吗」只有 0.037,比完整问题低一个量级。分数低的追问在后面做拒答阈值时,会被当成「没有答案」拒掉。

**把检索到的资料也存进历史。** 五轮后历史是 818 对 2410 个 token。更严重的是旧资料可能已经过期,模型会引用旧版本。资料每轮重新检索,历史只存问答。

**只做一层锁。** 只靠 `kb_jail`,别处的一个 `open()` 就绕过去了;只靠 `sandbox-exec`,项目里的 `data/fake_home/secret.txt` 和 `.env` 照样读得到。两层的范围不一样,互相补位。

**用字符串前缀判断「在不在目录里」。** `str(path).startswith(str(root))` 会把 `data/kb_evil/` 当成 `data/kb/` 里面的东西(练习 2 实测 `True`)。用 `is_relative_to`。

**先判断文件存不存在,再判断在不在锁里。** 顺序反了,调用方可以靠「不存在」和「被拒绝」两种不同的回答,一点点探出锁外面有哪些文件。先检查范围,再检查存在。

**沙箱配置写成「默认放行,再禁止几个路径」。** 一旦漏写一项,就是一个洞,而且你不知道漏了什么。`sandbox-exec` 的正确姿势是 `(deny default)`,然后只开放实测必须的最小集。我这份配置第一次跑也是缺项的:没有 `process-exec*` 时启动就报 `execvp() ... failed: Operation not permitted`,一项项加出来的。

**改写失败时让整轮崩掉。** 改写是锦上添花。练习 3 里一个超时就让整轮问答抛异常。降级成「只用原话」,并留日志。

**以为 `temperature=0` 就每次答案一样。** 我跑了好几遍同样的对话,回答的措辞每次都略有不同,最高分的小数点后第三位也会变(比如 `kb-003#2` 这一块有时 0.523,有时 0.021)。对比两次实验时,看量级和现象,不要盯着单个数字。

## 学习资料

### 文档与文章

- [Python 文档 · pathlib](https://docs.python.org/zh-cn/3.12/library/pathlib.html):中文,今天用到的 `resolve()`、`is_relative_to()`、`suffix`、`/` 运算符都在里面。
- [OWASP · Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal):路径穿越攻击的各种变体和防御建议,和今天的 `kb_jail` 对着看。
- [Anthropic · Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):怎么给 Agent 设计工具,包括工具返回什么、报错怎么写。
- [Claude Code 文档 · Sandboxing](https://code.claude.com/docs/en/sandboxing):Claude Code 自己用操作系统层的沙箱(macOS 上是 Seatbelt)限制文件和网络,和今天第二层锁是同一个思路。
- [The Chroma Team · Context Rot](https://research.trychroma.com/context-rot):历史里塞太多无关内容会让模型变差的实测,对应「为什么历史只存问答文本」。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dNq8YrEXt&autoplay=0&high_quality=1" title="基于RAG的的医疗问答系统,从0到1实现一个医疗知识问答系统!原理演示+代码解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大模型入门课程 · 基于RAG的的医疗问答系统,从0到1实现一个医疗知识问答系统 · 27 分钟,另一个领域的完整 RAG 问答项目,看它的目录怎么分、一轮流程怎么串,和今天的 `DocQA` 对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZobP6DE4L&autoplay=0&high_quality=1" title="【项目实战】RAG会话_知识库问答系统_手搓RAG项目" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>尚学堂官方 · 【项目实战】RAG会话_知识库问答系统_手搓RAG项目 · 150 分钟的长视频,不用一次看完,挑「会话历史怎么管」那几段看,对照今天的 `self.history`。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/q1tmp7Eim1E" title="Build a RAG Chatbot That Cites Its Sources — From Empty Folder to Live on Railway" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LLM Master · Build a RAG Chatbot That Cites Its Sources — From Empty Folder to Live on Railway · 英文,从空目录搭一个带引用的 RAG 聊天机器人并上线,Day 269 做引用时回来看,今天先看它的整体结构。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):RAG 和 Agent 那几章讲检索、上下文构造和系统组装,今天的骨架可以对照着读。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024):用大量图解讲语义搜索和 RAG 的实现,适合补直觉。

### 开源项目与代码

- [langchain-ai/langchain](https://github.com/langchain-ai/langchain):看它怎么把检索器、对话历史、回答这几块拆成可替换的组件,对照今天手写的 `DocQA` 里「改写、检索、回答、记历史」几步。
- [anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime):Anthropic 开源的沙箱运行时,macOS 上用的就是 `sandbox-exec` 生成配置,可以看它的配置是怎么拼出来的。

## 自测

1. 一轮文档问答的六个步骤是什么?哪几步调用了大模型?

<details><summary>答案</summary>

改写、检索、拼 prompt、回答、记历史、压缩。调用大模型的是:改写(第一轮没有历史就跳过)、回答、压缩(只有历史超阈值才调)。检索里的 rerank 是调的另一个模型接口,不算大模型。所以第一轮一般只调 1 次大模型,后面每轮 2 次,压缩那轮 3 次。

</details>

2. 为什么历史里只存问答文本,不存检索到的资料?

<details><summary>答案</summary>

资料每轮按当前问题重新检索,旧资料和新问题大多无关,会占掉上下文、分散模型注意力;旧资料还可能已经过期。实测五轮后只存问答 818 个 token,连资料存是 2410 个。代价是客户追问「展开第二点」时看不到上轮资料原文,靠改写补全成具体问题再检索来弥补。

</details>

3. `(root / name).resolve()` 之后用 `is_relative_to(root)` 判断,比 `str(path).startswith(str(root))` 好在哪里?再说一个 `root / name` 本身容易踩的坑。

<details><summary>答案</summary>

`is_relative_to` 按路径的段比较,`data/kb_evil` 不会被当成 `data/kb` 里面;`startswith` 按字符串前缀比,会放进来。`root / name` 的坑:`name` 是绝对路径时,结果是那个绝对路径,`root` 被整个丢掉,所以必须在拼完之后用 `resolve` 再做范围检查,不能只检查名字里有没有 `..`。

</details>

4. 为什么要同时用 `kb_jail` 和 `sandbox-exec`?各自拦不住什么?

<details><summary>答案</summary>

`kb_jail` 只管走它的代码路径,别处直接 `open()` 的它拦不住。`sandbox-exec` 管整个进程,但它的范围是整个项目目录,所以项目里的 `data/fake_home/` 和 `.env` 它拦不住,这些要靠 `kb_jail` 限定到 `data/kb/`。两层范围不同,互相补位。

</details>

5. (面试题)你给客服文档问答加了「读整篇文章」的功能,文章名由用户或模型传入。怎么防止它读到不该读的文件?

<details><summary>答案</summary>

分层回答。工具层:拼路径后 `resolve()`,用 `is_relative_to(根目录)` 判断,不用字符串前缀;只允许固定后缀;先判范围再判存在;限制文件大小;错误信息里不暴露真实路径。进程层:用操作系统的沙箱(macOS 的 `sandbox-exec`、Linux 的 bubblewrap/Landlock、容器)把进程限制在项目目录,默认拒绝,只开放必须的最小集。再补一条:密钥不要放在进程能读到的目录里。最后加一句,只用白名单(只接受 `kb-001` 这种编号)也是办法,最稳,但灵活性差;三种可以叠着用。

</details>

6. 改写接口超时时,`ask` 应该怎么处理?为什么要留痕?

<details><summary>答案</summary>

降级成只用用户原话检索,整轮继续。要留痕(日志或指标),因为静默降级会让检索质量悄悄变差,而没人知道改写其实一直在失败。

</details>

## 明天预告

[Day 269](/blog/agent-zero/day-269-docqa-2/):引用出处和拒答校准。今天最后两个观察,一个是「好的谢谢」后面跟着四个毫不相干的引用,一个是「你们有学生优惠吗」靠模型自己悟出来才拒答,都留给明天:回答里的 `[kb-xxx#n]` 要逐个检查是不是真的来自本轮资料,最高分低于阈值就直接拒答不调生成,阈值要用评估集里「有答案」和「没答案」两组问题实测出来,不能拍脑袋。
