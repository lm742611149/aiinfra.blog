---
title: 'Day 249 · 递归语言模型 RLM:另一种处理超长输入的思路'
description: 'RAG 是事先切块建索引,RLM 反过来:不预处理,把整份长文本放进一个 Python 变量,让模型自己写代码去翻,看不懂的片段再交给子模型。今天先用 2000 张工单让「全塞进 prompt」答错,再写一个 60 行的最小 RLM 把它答对,最后讲清楚 RLM 和 RAG 各自该在什么时候用。'
pubDate: 2026-10-22
regime: none
tags: ['rlm', 'long-context', 'rag', 'agent-zero']
series: 'agent-zero'
day: 249
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 248](/blog/agent-zero/day-248-code-retrieval/) 讲的是代码库检索:代码不能按字数切,要按语法树一个函数一块,再用一张 repo map 告诉模型仓库里有什么。那一课最后有个结论:很多 coding agent 干脆不建向量库,直接给模型 `grep`、读文件这些工具,让它自己一层层往下翻。

今天顺着这个思路再走一步。既然模型能自己翻代码仓库,那一份超长的文档,是不是也可以不切块、不建索引,直接让模型自己去翻?2025 年底 MIT 的一篇论文就是这么做的,叫递归语言模型(Recursive Language Models,简称 RLM)。

## 今天要解决的问题

学完你应该能做到:

1. 说清楚「把长文本全塞进 prompt」为什么在计数、筛选这类问题上会答错,并用一个自己跑出来的例子证明它。
2. 讲清楚 RLM 的两个动作:长文本放进 REPL 变量让模型写代码去看;看不懂的片段递归调用子模型。
3. 读懂并跑通一个 60 行的最小 RLM(`part04/rlm_mini.py`),能指出它每一轮在干什么、花了多少钱。
4. 面对一个具体需求,能说出该用 RAG、直接塞长上下文还是 RLM,理由是什么。

预计用时 2.5 小时。今天文中贴出的实跑加起来约 ¥0.37(按 DeepSeek 高峰价记账,算式在后面),其中大头是两次「整份日志塞进 prompt」的对照实验。

前置:[Day 109](/blog/agent-zero/day-109-context-window/) 的上下文窗口,[Day 124](/blog/agent-zero/day-124-cost/) 的算钱和缓存价,[Day 136](/blog/agent-zero/day-136-llm-client-2/) 的 `common/llm.py`(`LLMClient`),[Day 166](/blog/agent-zero/day-166-agent-min/) 的 Agent 循环,[Day 186](/blog/agent-zero/day-186-codeact-1/) 和 [Day 187](/blog/agent-zero/day-187-codeact-2/) 的「代码即动作」(CodeAct),以及 [Day 221](/blog/agent-zero/day-221-why-rag/) 起的 RAG。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `rlm_mini.py` 里 `rlm()` 那个循环;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先造一份很长的资料

为了让问题看得清楚,先造一份「长到你不想自己读」的资料:CloudLedger 前 9 个月的 2000 张工单,一行一张。每张有编号、日期、客户号、套餐和一句客户原话。数据是用随机数造的,所以我们同时能拿到标准答案,用来判断模型答得对不对。

新建文件 `agent-zero-lab/part04/make_long_log.py`。这个脚本不调模型,不花钱,只用标准库。

```python
# agent-zero-lab/part04/make_long_log.py  造一份很长的工单日志,外加只给我们看的标准答案
import json
import random
from pathlib import Path

random.seed(249)
OUT = Path("part04/data")
PLANS = ["免费版", "专业版", "企业版"]
ISSUES = {
    "E1042": ["导入流水报 E1042,说列名不对", "日期列导入失败,提示 E1042"],
    "E1043": ["CSV 导入报 E1043", "上传流水提示 E1043 编码错误"],
    "E2017": ["发票识别失败 E2017", "拍的发票一直报 E2017"],
    "E3001": ["付款失败 E3001", "续费扣不了款,报 E3001"],
    "无": ["问怎么开专票", "想加一个成员", "问导出次数限制", "问汇率多久更新"],
}
CALM = ["麻烦看一下。", "谢谢。", "请问怎么处理?", "不着急,有空回复。", "先不取消,等你们修好。"]
CANCEL = ["再这样我就不续费了。", "请直接帮我把订阅取消掉。", "不想用了,退订吧。", "下个月换别家。", "太折腾了,我们准备停用。"]


def make(n: int = 2000) -> tuple[str, dict[str, int]]:
    lines: list[str] = []
    truth = {"ent_e1043_q3": 0, "e3001_cancel": 0, "e3001_total": 0}
    for i in range(1, n + 1):
        plan = random.choices(PLANS, weights=[5, 4, 1])[0]
        code = random.choice(list(ISSUES))
        month = random.randint(1, 9)
        day = random.randint(1, 28)
        wants_cancel = code == "E3001" and random.random() < 0.3
        calm = CALM if code != "无" else CALM[:4]  # 没报错的工单不会说「先不取消」
        tail = random.choice(CANCEL if wants_cancel else calm)
        title = random.choice(ISSUES[code])
        lines.append(
            f"T-{i:05d} | 2026-{month:02d}-{day:02d} | C-{random.randint(1, 400):04d} | {plan} | {title}。{tail}"
        )
        if plan == "企业版" and code == "E1043" and 7 <= month <= 9:
            truth["ent_e1043_q3"] += 1
        if code == "E3001":
            truth["e3001_total"] += 1
            truth["e3001_cancel"] += wants_cancel
    return "\n".join(lines), truth


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    text, truth = make()
    (OUT / "tickets_long.txt").write_text(text, encoding="utf-8")
    (OUT / "tickets_truth.json").write_text(json.dumps(truth, ensure_ascii=False), encoding="utf-8")
    print(f"{len(text.splitlines())} 行,{len(text)} 个字符")
    print(text.splitlines()[0])
    print("标准答案:", truth)
```

<div class="line-notes">

- `random.seed(249)` 固定随机数种子。相当于 JS 里给 `Math.random` 换成一个可复现的伪随机生成器,你跑出来的 2000 行和我的一模一样,后面贴的数字你也能对上。
- `OUT = Path("part04/data")` 相对路径,所以这个脚本要在 `agent-zero-lab/` 根目录下跑,不要 `cd` 进 `part04`。
- `ISSUES = {` 一个 dict(相当于 JS 的 Object),键是错误码,值是这类工单可能的标题。`"无"` 代表没报错、只是来咨询的。
- `CALM = [` 平静的结尾。最后一句「先不取消,等你们修好。」是故意埋的坑:里面有「取消」两个字,意思却是不取消。
- `CANCEL = [` 想走的结尾,五种说法,只有一种带「取消」二字。
- `plan = random.choices(PLANS, weights=[5, 4, 1])[0]` 按 5:4:1 的比例抽套餐,企业版最少,符合现实。`choices` 返回的是列表,所以取 `[0]`。
- `wants_cancel = code == "E3001" and random.random() < 0.3` 只有付款失败的工单才可能想走,概率 30%。结果是布尔值。
- `calm = CALM if code != "无" else CALM[:4]` Python 的三元表达式,相当于 JS 的 `code !== "无" ? CALM : CALM.slice(0, 4)`。来咨询的人不会说「先不取消」。
- `f"T-{i:05d} | 2026-{month:02d}` f-string 里的 `:05d` 是补零到 5 位,`i=1` 变成 `00001`,相当于 JS 的 `String(i).padStart(5, "0")`。
- `if plan == "企业版" and code == "E1043" and 7 <= month <= 9:` 边造边记标准答案。`7 <= month <= 9` 是 Python 的连写比较,JS 里要写成 `month >= 7 && month <= 9`。
- `truth["e3001_cancel"] += wants_cancel` 布尔值加到整数上,`True` 当 1、`False` 当 0。
- `(OUT / "tickets_truth.json").write_text(` 标准答案单独存一个文件,**不会**给模型看,只用来打分。

</div>

在 `agent-zero-lab/` 目录下跑:

```bash
cd agent-zero-lab
uv run python -m part04.make_long_log
```

我的输出:

```text
2000 行,119381 个字符
T-00001 | 2026-05-20 | C-0005 | 免费版 | 想加一个成员。不着急,有空回复。
标准答案: {'ent_e1043_q3': 22, 'e3001_cancel': 112, 'e3001_total': 387}
```

11.9 万个字符。用 `-m part04.make_long_log` 这种写法是把文件当模块跑,后面的脚本要 `from part04.xxx import` 别的文件,只有这样 Python 才找得到。

两个问题记住,后面一直用它们:

- 问题 A:2026 年 7 到 9 月,企业版客户提到 E1043 的工单一共有几张?标准答案 22。
- 问题 B:提到 E3001 的工单里,客户明确表示要取消、退订、停用或不再续费的有几张?标准答案 112。

问题 A 是纯筛选加计数,条件写得清清楚楚。问题 B 多了一层「理解语气」,而且有 57 张写着「先不取消」的工单专门用来骗关键词搜索。

## 对照组:全部塞进 prompt

[Day 109](/blog/agent-zero/day-109-context-window/) 讲过上下文窗口。2026 年 10 月我查 DeepSeek 定价页,`deepseek-flash` 现在由 DeepSeek-V4.1-Flash-1017 提供服务,上下文是 1M token。11.9 万个字符远远装得下,那最省事的办法就是整份塞进去问。

```python
# agent-zero-lab/part04/long_direct.py  对照组:把整份日志直接塞进 prompt
import json
from pathlib import Path

from common.llm import LLMClient

LOG = Path("part04/data/tickets_long.txt").read_text(encoding="utf-8")
TRUTH = json.loads(Path("part04/data/tickets_truth.json").read_text(encoding="utf-8"))
QUESTIONS = {
    "ent_e1043_q3": "2026 年 7 到 9 月,企业版客户提到 E1043 的工单一共有几张?只回答一个数字。",
    "e3001_cancel": "提到 E3001 的工单里,客户明确表示要取消、退订、停用或不再续费的有几张?只回答一个数字。",
}

client = LLMClient()
for key, q in QUESTIONS.items():
    r = client.chat(
        [{"role": "user", "content": f"下面是工单日志:\n{LOG}\n\n问题:{q}"}],
        temperature=0,
    )
    print(f"{key}: 模型答 {r.content.strip()},标准答案 {TRUTH[key]}")
    print(f"  输入 {r.prompt_tokens} tokens,耗时 {r.latency:.1f}s,¥{r.cost:.4f}")
print(client.ledger)
```

<div class="line-notes">

- `from common.llm import LLMClient` 这是 Day 135–136 写的 `common/llm.py`,读 `.env` 里的 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_PRICE`,`chat()` 返回一个带 `content`、`prompt_tokens`、`cost`、`latency` 的结果对象,`client.ledger` 累计记账。
- `LOG = Path("part04/data/tickets_long.txt").read_text(encoding="utf-8")` 整份日志读成一个字符串,11.9 万个字符。
- `"content": f"下面是工单日志:\n{LOG}\n\n问题:{q}"` 日志放前面、问题放后面。两次调用的前缀完全一样,第二次能命中 DeepSeek 的缓存。
- `temperature=0,` 尽量让输出稳定。Day 112 讲过,0 也不保证每次一样,下面的练习里你会看到。
- `print(f"  输入 {r.prompt_tokens} tokens,` 实测 71867 个输入 token。中文平均 1.66 个字符一个 token。

</div>

先在 `.env` 里确认 `LLM_PRICE=0.04,2,8`(缓存命中 / 未命中 / 输出,元每百万 token,DeepSeek 2026 年 10 月的高峰价;北京时间工作日 9–12 点、14–18 点以外是半价)。然后跑:

```bash
uv run python -m part04.long_direct
```

```text
ent_e1043_q3: 模型答 8,标准答案 22
  输入 71867 tokens,耗时 1.5s,¥0.1437
e3001_cancel: 模型答 32,标准答案 112
  输入 71868 tokens,耗时 1.1s,¥0.0033
2 次调用 | 输入 143735 / 输出 2 tokens | 约 ¥0.1470
```

两题都错,而且错得离谱:22 答成 8,112 答成 32。隔了一段时间我又原样跑了一次,这次答的是 3 和 34,还是错,而且和上一次错得不一样(那次两条前缀都命中了缓存,两次加起来只花了 ¥0.0065)。

花钱的账也看一下。第一次 71867 × 2 / 1000000 ≈ ¥0.1437,全是未命中。第二次前缀和第一次一样,几乎全部命中缓存,71868 × 0.04 / 1000000 ≈ ¥0.003。Day 124 讲的缓存价在这里一眼就能看出来值多少钱。

为什么会错?模型读 7 万个 token 不是一行行数过去的。它一次性「看」完整段文字,再一个 token 一个 token 地生成答案,没有一个地方能让它维护「数到第几张了」这种中间状态。数数、按条件筛选、对比两张表,这类问题需要的恰好是程序最擅长的东西。上下文越长,这类问题越容易错,业内管这个现象叫上下文腐烂(context rot):窗口装得下,不等于模型用得好。Chroma 2025 年发过一份专门的测试报告,链接放在学习资料里。

我第一次写这个对照实验时,其实以为模型能答对 A 题,毕竟条件这么清楚。结果是 8。这也是今天想让你自己亲手看到的:**窗口大小是「能不能放进去」,不是「能不能答对」。**

## RLM 在说什么

论文是 Alex Zhang、Tim Kraska 和 Omar Khattab 2025 年 12 月 31 日发在 arXiv 上的 [Recursive Language Models](https://arxiv.org/abs/2512.24601)(2512.24601),2026 年 5 月更新到 v3。想法一句话就能说完:**长输入不放进 prompt,放进一个代码执行环境里当变量,模型写代码去看它、切它,对切出来的片段再调用模型(也可以是它自己)去处理。**

拆开是两件事,也就是今天的两个新概念。

第一件,长文本是一个变量,不是一段 prompt。根模型(root model,就是最外层那个接到问题的模型)的上下文里只有问题、一段说明,以及「有一个叫 `context` 的变量,长 119381 个字符」这句话。它想知道里面有什么,就写 `print(context[:3000])`;想筛选,就写列表推导式。这和 [Day 186](/blog/agent-zero/day-186-codeact-1/) 讲的 CodeAct 是一回事:中间结果留在代码环境里,不经过模型的上下文。区别是 CodeAct 里代码操作的是工具返回值,RLM 里代码操作的是用户给的超长输入本身。

第二件,递归调用。有些事代码做不了,比如判断「下期别扣了」算不算要退订。这时模型在代码里调用 `llm_query(片段)`,把一小段文字交给一个子模型(sub model)去读,拿回一个短结果,存进变量里接着算。子模型每次只看一小块,上下文很干净。论文里还允许子调用本身也是一个 RLM,一层套一层,这就是名字里「递归」的来历;它的主要实验和开源实现默认只递归一层。

REPL 这个词第一次出现,解释一下。REPL 是 Read-Eval-Print Loop,读一行、执行、打印结果、再等下一行。浏览器 DevTools 的 Console 就是一个 JS 的 REPL:你敲 `document.title`,它打印结果,刚才定义的变量下一行还能用。RLM 给模型的就是一个 Python 版的 Console。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="RLM 的结构:根模型只看到问题和变量说明,它写的代码在 REPL 里执行,REPL 里有 context 变量和 llm_query 函数,llm_query 去调用子模型">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="40" width="180" height="96" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="62" fill="var(--ink)" text-anchor="middle">根模型</text>
<text x="34" y="86" fill="var(--ink-soft)" font-size="11">看到:问题</text>
<text x="34" y="104" fill="var(--ink-soft)" font-size="11">+ context 有多长</text>
<text x="34" y="122" fill="var(--ink-soft)" font-size="11">+ 每轮 print 的输出</text>
<rect x="260" y="30" width="200" height="200" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="360" y="52" fill="var(--ink)" text-anchor="middle">Python REPL(ns 字典)</text>
<rect x="276" y="66" width="168" height="34" rx="4" fill="none" stroke="var(--compute)"/>
<text x="360" y="88" fill="var(--ink)" text-anchor="middle">context:11.9 万字</text>
<rect x="276" y="110" width="168" height="34" rx="4" fill="none" stroke="var(--compute)"/>
<text x="360" y="132" fill="var(--ink)" text-anchor="middle">llm_query(片段)</text>
<rect x="276" y="154" width="168" height="34" rx="4" fill="none" stroke="var(--compute)"/>
<text x="360" y="176" fill="var(--ink)" text-anchor="middle">lines、e3 … 中间变量</text>
<text x="360" y="214" fill="var(--ink-faint)" text-anchor="middle" font-size="11">answer["ready"] = True 就结束</text>
<rect x="500" y="100" width="120" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="560" y="124" fill="var(--ink)" text-anchor="middle">子模型</text>
<text x="560" y="144" fill="var(--ink-soft)" text-anchor="middle" font-size="11">只读一小段</text>
<line x1="200" y1="70" x2="258" y2="70" stroke="var(--ink-soft)"/>
<text x="204" y="62" fill="var(--ink-soft)" font-size="11">写代码</text>
<line x1="258" y1="120" x2="200" y2="120" stroke="var(--ink-soft)"/>
<text x="204" y="140" fill="var(--ink-soft)" font-size="11">print 输出</text>
<line x1="444" y1="127" x2="498" y2="127" stroke="var(--ink-soft)"/>
<text x="20" y="262" fill="var(--ink-faint)" font-size="11">蓝色是模型,琥珀色是代码环境。长文本一直待在右边,从来不整份进入任何一个模型的上下文。</text>
</g>
</svg>
<figcaption>RLM 的三个角色。根模型像一个只能通过 Console 看数据的工程师,子模型像他随手找来帮忙读一段文字的同事。</figcaption>
</figure>

论文自己报的结果:能处理比模型上下文窗口长两个数量级的输入;在四个长上下文任务上比直接调用前沿模型和几种常见的长上下文、代码 Agent 做法都好,成本相当;他们后训练的 RLM-Qwen3-8B 比原版 Qwen3-8B 平均高 28.3%。这些是论文自己的数字,我没有复现。作者开源了实现 [alexzhang13/rlm](https://github.com/alexzhang13/rlm),PyPI 包名是 `rlms`(2026 年 10 月查到最新 0.1.3,6 月发布,要求 Python 3.11+),import 名是 `rlm`。今天不用它,自己写一个最小版,原因和以前一样:写过一遍,再看它的源码和参数就知道每个开关在管什么。

## 第一步:不调模型,先把 REPL 做出来

RLM 里最核心的零件是「执行一段代码字符串,把它 print 出来的东西收集起来」。这一步不调模型,不花钱。

Python 内置的 `exec(代码字符串, 命名空间)` 能执行一段代码。命名空间是一个 dict,代码里读写的变量都在这个 dict 里,相当于 JS 里给 `new Function` 传进去的那个作用域对象。`print` 默认写到终端,我们要把它截下来,用的是 `contextlib.redirect_stdout`:它是一个上下文管理器([Day 98](/blog/agent-zero/day-098-context-managers/) 讲过 `with` 背后的 `__enter__`/`__exit__`),`with` 块里所有 print 都改写到你给的地方去,出了 `with` 自动恢复。`io.StringIO` 是一个假装成文件的字符串缓冲区,print 往它里面写,最后 `getvalue()` 一次拿出来。

```python
# agent-zero-lab/part04/repl_demo.py  不调模型:把长文本放进变量,用 exec 跑一段代码并收集 print 输出
import contextlib
import io
from pathlib import Path
from typing import Any


def run_code(code: str, ns: dict[str, Any]) -> str:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        try:
            exec(code, ns)
        except Exception as e:
            print(f"{type(e).__name__}: {e}")
    return buf.getvalue()


if __name__ == "__main__":
    ns: dict[str, Any] = {"context": Path("part04/data/tickets_long.txt").read_text(encoding="utf-8")}

    print(run_code("print(len(context)); print(context[:60])", ns))
    print("---- 只写表达式、不 print:")
    print(repr(run_code("len(context)", ns)))
    print("---- 变量会留在 ns 里,下一段代码还能用:")
    run_code("lines = context.splitlines()", ns)
    print(run_code("print(len(lines), lines[-1])", ns))
    print("---- 代码出错也不会让程序崩:")
    print(run_code("print(lines[5000])", ns))
```

<div class="line-notes">

- `def run_code(code: str, ns: dict[str, Any]) -> str:` 输入一段代码字符串和一个命名空间,输出这段代码 print 出来的全部文字。后面 RLM 每一轮都调它。
- `buf = io.StringIO()` 一个内存里的「文件」,初始是空字符串。
- `with contextlib.redirect_stdout(buf):` 在这个 `with` 块里,所有 `print` 都写进 `buf`,不写终端。
- `exec(code, ns)` 真正执行。代码里出现的 `context` 从 `ns["context"]` 里取;代码里新建的变量(比如 `lines`)也会写回 `ns`。
- `except Exception as e:` 模型写的代码一定会出错,出错不能让整个程序崩掉,而是把错误变成一行文字,下一轮让模型自己看着改。
- `print(f"{type(e).__name__}: {e}")` 只打印错误类型和信息,比如 `IndexError: list index out of range`。这一行还在 `with` 里,所以也进了 `buf`。
- `if __name__ == "__main__":` 只有直接运行这个文件时才执行下面的演示。后面 `rlm_mini.py` 会 `import run_code`,不加这一行,一 import 就会把演示也跑一遍,我第一次就忘了加。
- `ns: dict[str, Any] = {"context":` 命名空间里先只放一个变量:整份日志。
- `print(repr(run_code("len(context)", ns)))` 只写表达式不 print,收集到的是空字符串 `''`。这是 RLM 最常见的坑,下面专门说。
- `run_code("lines = context.splitlines()", ns)` 这一段什么都不打印,但 `lines` 被存进了 `ns`。
- `print(run_code("print(len(lines), lines[-1])", ns))` 下一段代码直接用上一段建的 `lines`,就像 Console 里上一行定义的变量下一行还在。
- `print(run_code("print(lines[5000])", ns))` 只有 2000 行,故意越界。

</div>

```bash
uv run python -m part04.repl_demo
```

```text
119381
T-00001 | 2026-05-20 | C-0005 | 免费版 | 想加一个成员。不着急,有空回复。
T-000

---- 只写表达式、不 print:
''
---- 变量会留在 ns 里,下一段代码还能用:
2000 T-02000 | 2026-02-03 | C-0271 | 免费版 | 日期列导入失败,提示 E1042。请问怎么处理?

---- 代码出错也不会让程序崩:
IndexError: list index out of range
```

第二段那个 `''` 值得多看一眼。在 DevTools Console 里敲 `context.length`,它会把值显示出来,因为 Console 会自动回显最后一个表达式。`exec` 不会。模型如果以为自己在 Jupyter 里,写一行 `len(context)` 就等结果,它什么也看不到。所以等会儿给模型的说明里必须写明「只有 print 的东西你才看得到」。官方 `rlm` 库的系统提示词里也专门写了这一条。

还有一件严肃的事:`exec` 在你自己的 Python 进程里执行模型写的代码,模型能删你的文件、读你的 `.env`。今天的数据是自己造的、问题是自己出的,风险可控;官方库的 README 也写着默认的 local 环境不适合生产或者不可信的输入,它另外支持 Docker、Modal、E2B 等隔离环境。[Day 187](/blog/agent-zero/day-187-codeact-2/) 讲过沙箱边界,真正的隔离做法放在 [Day 415](/blog/agent-zero/day-415-sandbox/)。

## 第二步:60 行的最小 RLM

零件齐了:`LLMClient` 负责调模型,`run_code` 负责执行代码。RLM 就是把它俩接成一个循环,结构和 [Day 166](/blog/agent-zero/day-166-agent-min/) 的 Agent 循环几乎一样,只是「工具」换成了「执行代码」。

```python
# agent-zero-lab/part04/rlm_mini.py  最小 RLM:长文本放在变量里,模型写代码去读,读不懂的片段交给子模型
import json
import re
import sys
from pathlib import Path
from typing import Any

from common.llm import LLMClient
from part04.repl_demo import run_code

FENCE = "`" * 3  # 三个反引号,写成这样是为了不和 Markdown 的代码块打架
SYSTEM = """你在一个 Python REPL 里回答问题。资料太长,不会直接给你看。
REPL 里已经有:
- context:str,资料全文,共 {n} 个字符
- llm_query(prompt: str) -> str:调用一个子模型,适合判断语义;一次 prompt 不超过 20000 字
- answer:dict,初始是 {{"content": "", "ready": False}}
每次回复只写一个 {fence}repl 代码块。我执行后把 print 的内容(最多 1500 字)发回给你,只有 print 的东西你才看得到。
先用代码看看资料长什么样再动手。确定答案后,在代码里写 answer["content"] = 你的答案,answer["ready"] = True。"""

root = LLMClient()
sub = LLMClient()  # 子调用单独记账


def llm_query(prompt: str) -> str:
    return sub.chat([{"role": "user", "content": prompt[:20000]}], temperature=0).content


def rlm(question: str, context: str, max_turns: int = 8) -> str:
    ns: dict[str, Any] = {
        "context": context,
        "llm_query": llm_query,
        "answer": {"content": "", "ready": False},
    }
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM.format(n=len(context), fence=FENCE)},
        {"role": "user", "content": question},
    ]
    for turn in range(1, max_turns + 1):
        reply = root.chat(messages, temperature=0).content
        messages.append({"role": "assistant", "content": reply})
        m = re.search(FENCE + r"repl\n(.*?)" + FENCE, reply, re.S)
        if not m:
            messages.append({"role": "user", "content": f"请只写一个 {FENCE}repl 代码块。"})
            continue
        out = run_code(m.group(1), ns)
        print(f"--- 第 {turn} 轮代码:\n{m.group(1).strip()}\n--- 输出:\n{out[:300].strip()}\n")
        if ns["answer"]["ready"]:
            return str(ns["answer"]["content"])
        messages.append({"role": "user", "content": f"输出:\n{out[:1500]}"})
    return "(轮数用完,没有交答案)"


DATA = Path("part04/data")
CANCEL_Q = "提到 E3001 的工单里,客户明确表示要取消、退订、停用或不再续费的有几张?"
TASKS = {  # 任务名: (日志文件, 标准答案文件, 问题)
    "ent_e1043_q3": ("tickets_long.txt", "tickets_truth.json",
                     "2026 年 7 到 9 月,企业版客户提到 E1043 的工单一共有几张?"),
    "e3001_cancel": ("tickets_long.txt", "tickets_truth.json", CANCEL_Q),
    "free_cancel": ("tickets_free.txt", "tickets_free_truth.json", CANCEL_Q),
}

if __name__ == "__main__":
    task = sys.argv[1] if len(sys.argv) > 1 else "ent_e1043_q3"
    log_file, truth_file, question = TASKS[task]
    log = (DATA / log_file).read_text(encoding="utf-8")
    truth = json.loads((DATA / truth_file).read_text(encoding="utf-8"))
    final = rlm(question, log)
    print(f"最终答案:{final}")
    print(f"标准答案:{truth[task.replace('free_', 'e3001_')]}")
    print("根模型:", root.ledger)
    print("子模型:", sub.ledger)
```

<div class="line-notes">

- `from part04.repl_demo import run_code` 复用第一步的执行器,这也是为什么第一步要加 `if __name__ == "__main__":`。
- `FENCE = "`" * 3` 三个反引号。直接把三个反引号写进字符串也能跑,但这篇文章本身是 Markdown,代码块里再出现三个反引号容易把排版搞乱。
- `SYSTEM = """你在一个 Python REPL 里回答问题。` 三引号字符串可以跨行,相当于 JS 的模板字符串(反引号)。这一段就是给根模型的全部说明,它看不到资料本身。
- `- context:str,资料全文,共 {n} 个字符` `{n}` 是占位符,下面 `.format(n=...)` 时填进去,实际是 `119381`。根模型只知道资料有多长,这一点很重要。
- `- llm_query(prompt: str) -> str:` 告诉模型有一个函数能调子模型。说明里写「适合判断语义」,暗示它数数这种事别交给子模型。
- `- answer:dict,初始是 {{"content": "", "ready": False}}` 双花括号 `{{` 是 `.format` 的转义,输出时变成一个 `{`。只写一个的话 `.format` 会把它当占位符,直接 `KeyError`。
- `每次回复只写一个 {fence}repl 代码块。` 约定代码块的标签叫 `repl`,我们只执行这种代码块,模型顺手写的别的代码示例不执行。官方库也用这个标签。同一行后半句「只有 print 的东西你才看得到」,就是第一步那个 `''` 的坑,提前告诉模型。
- `root = LLMClient()` 根模型。
- `sub = LLMClient()  # 子调用单独记账` 子模型用同一个 DeepSeek,但单独一个对象,这样两边的花费能分开看。真实系统里子模型常换成更便宜的小模型。
- `return sub.chat([{"role": "user", "content": prompt[:20000]}], temperature=0).content` 子调用就是一次普通的单轮对话。`prompt[:20000]` 截断兜底,防止模型把整份 `context` 塞进来,那就又回到对照组了。
- `ns: dict[str, Any] = {` REPL 的命名空间。三样东西:资料、子模型函数、交答案用的 dict。
- `"llm_query": llm_query,` 把 Python 函数本身放进命名空间,模型写的代码里就能直接调用 `llm_query(...)`。
- `"answer": {"content": "", "ready": False},` 模型交答案的方式不是「在回复里说」,而是「在代码里改这个 dict」。这样答案可以是代码算出来的变量,不用模型抄一遍。
- `{"role": "user", "content": question},` 第一条用户消息只有问题,没有资料。对照组这里是 7 万个 token,RLM 这里只有几十个。
- `for turn in range(1, max_turns + 1):` 最多 8 轮。和 Agent 循环一样,一定要有上限,否则模型一直不交答案你就一直付钱。
- `reply = root.chat(messages, temperature=0).content` 根模型读完历史,回复一段带代码块的文字。
- `m = re.search(FENCE + r"repl\n(.*?)" + FENCE, reply, re.S)` 用正则把代码块里的代码抠出来。`(.*?)` 是「尽量少地匹配任意字符」,`re.S` 让 `.` 也能匹配换行。相当于 JS 的 `/```repl\n([\s\S]*?)```/`。
- `if not m:` 模型没写代码块(比如直接用文字回答了),提醒它一次,进入下一轮。
- `out = run_code(m.group(1), ns)` 执行代码。`ns` 在各轮之间一直是同一个 dict,所以上一轮建的变量下一轮还在。
- `print(f"--- 第 {turn} 轮代码:` 给我们自己看的轨迹,输出只打前 300 字,方便贴进文章。
- `if ns["answer"]["ready"]:` 模型在代码里把 `ready` 设成 `True`,就结束循环,返回答案。
- `messages.append({"role": "user", "content": f"输出:\n{out[:1500]}"})` 把执行结果作为下一条用户消息发回去,最多 1500 字。这个截断是 RLM 的关键:模型就算 `print(context)`,也只能看到 1500 字,逼着它用代码去筛,而不是用眼睛去读。
- `TASKS = {  # 任务名: (日志文件, 标准答案文件, 问题)` 三个任务,`free_cancel` 用的文件下一节才造。
- `task = sys.argv[1] if len(sys.argv) > 1 else "ent_e1043_q3"` 命令行第一个参数选任务,相当于 Node 的 `process.argv[2]`。
- `print(f"标准答案:{truth[task.replace('free_', 'e3001_')]}")` `free_cancel` 的标准答案文件里键叫 `e3001_cancel`,这里换一下名字。

</div>

先跑问题 A:

```bash
uv run python -m part04.rlm_mini ent_e1043_q3
```

下面是我跑的轨迹。代码是模型写的原样,每轮输出脚本只打前 300 字,我又删掉了一些重复的行,用 `...` 标出:

```text
--- 第 1 轮代码:
print(len(context))
print(context[:3000])
--- 输出:
119381
T-00001 | 2026-05-20 | C-0005 | 免费版 | 想加一个成员。不着急,有空回复。
T-00002 | 2026-07-26 | C-0282 | 专业版 | 问导出次数限制。麻烦看一下。
T-00003 | 2026-08-26 | C-0248 | 免费版 | CSV 导入报 E1043。谢谢。
...

--- 第 2 轮代码:
import re
lines = [l for l in context.splitlines() if l.strip().startswith("T-")]
print("总行数", len(lines))
hits = []
for l in lines:
    parts = [p.strip() for p in l.split("|")]
    if len(parts) < 5: 
        print("异常行:", l); continue
    tid, date, cid, ver, desc = parts[0], parts[1], parts[2], parts[3], parts[4]
    if ver == "企业版" and "E1043" in desc and "2026-07" <= date[:7] <= "2026-09":
        hits.append(l)
print(len(hits))
for h in hits: print(h)
--- 输出:
总行数 2000
22
T-00039 | 2026-08-25 | C-0090 | 企业版 | CSV 导入报 E1043。谢谢。
T-00276 | 2026-07-12 | C-0308 | 企业版 | CSV 导入报 E1043。谢谢。
...

--- 第 3 轮代码:
import re
lines = [l for l in context.splitlines() if l.strip().startswith("T-")]
# 检查日期格式
bad_date = [l for l in lines if not re.match(r"^T-\d+ \| \d{4}-\d{2}-\d{2} \|", l)]
print("日期异常行数:", len(bad_date))
for b in bad_date[:10]: print(b)
# 检查所有含1043的写法
variants = set()
for l in lines:
    for m in re.findall(r"E[-\s]?1043|Ｅ1043|e1043", l):
        variants.add(m)
print("1043写法:", variants)
# 企业版取值
vers = set(l.split("|")[3].strip() for l in lines if len(l.split("|"))>=5)
print("版本取值:", vers)
# 日期范围
dates = sorted(l.split("|")[1].strip() for l in lines if len(l.split("|"))>=5)
print(dates[0], dates[-1])
--- 输出:
日期异常行数: 0
1043写法: {'E1043'}
版本取值: {'企业版', '免费版', '专业版'}
2026-01-01 2026-09-28

--- 第 4 轮代码:
answer["content"] = "2026 年 7 到 9 月，企业版客户提到 E1043 的工单共 22 张。"
answer["ready"] = True
print(answer)
--- 输出:
{'content': '2026 年 7 到 9 月，企业版客户提到 E1043 的工单共 22 张。', 'ready': True}

最终答案:2026 年 7 到 9 月，企业版客户提到 E1043 的工单共 22 张。
标准答案:22
根模型: 4 次调用 | 输入 6498 / 输出 1027 tokens | 约 ¥0.0114
子模型: 0 次调用 | 输入 0 / 输出 0 tokens | 约 ¥0.0000
```

答对了,22。几个细节很像一个靠谱的工程师。第 1 轮先看前 3000 个字符了解格式(我们只回传 1500 字,它看到的是前一半)。第 2 轮就按 `|` 切字段筛出了 22 张,而且切之前留了一手:字段不够 5 段的行会被打印成「异常行」,结果一行都没有。第 3 轮它没急着交卷,先复核三件事:日期格式是不是都统一、有没有 `E-1043`、`e1043`、全角 `Ｅ1043` 这种变体写法、套餐字段到底有哪几种取值。三项都干净,第 4 轮交答案。

花钱:4 次根模型调用,一共 6498 个输入 token,比对照组单次的 71867 少了一个数量级,花了 ¥0.0114。子模型一次没用,因为这道题纯靠代码就能做,根本不需要「理解语气」。这正是好的行为:能用代码算的,别交给模型。

我又重跑了一次,那次是 5 轮交卷,输入 9937 token,¥0.0159,答案还是 22。模型每次写的代码不完全一样,轮数和花费会有浮动。

再跑问题 B:

```bash
uv run python -m part04.rlm_mini e3001_cancel
```

关键的两轮和结果(第 1、2 轮和问题 A 差不多,先看格式、再筛出 387 张 E3001 工单):

```text
--- 第 3 轮代码:
lines = [l for l in context.split("\n") if l.strip()]
e3 = [l for l in lines if "E3001" in l]
from collections import Counter
c = Counter()
for l in e3:
    parts = l.split("|")
    msg = parts[-1].strip()
    # 去掉 E3001 相关前缀
    c[msg] += 1
for k,v in c.most_common():
    print(v, "|", k)
--- 输出:
34 | 付款失败 E3001。请问怎么处理?
31 | 续费扣不了款,报 E3001。先不取消,等你们修好。
31 | 续费扣不了款,报 E3001。请问怎么处理?
...

--- 第 4 轮代码:
lines = [l for l in context.split("\n") if l.strip()]
e3 = [l for l in lines if "E3001" in l]
from collections import Counter
c = Counter()
for l in e3:
    c[l.split("|")[-1].strip()] += 1

cancel_kw = ["取消掉", "退订吧", "准备停用", "不续费了", "换别家"]
total = 0
for k,v in c.items():
    if any(w in k for w in cancel_kw):
        print(v, "|", k)
        total += v
print("TOTAL", total)
print("E3001 total", len(e3))
--- 输出:
12 | 付款失败 E3001。请直接帮我把订阅取消掉。
15 | 续费扣不了款,报 E3001。再这样我就不续费了。
...
5 | 续费扣不了款,报 E3001。请直接帮我把订阅取消掉。
TOTAL 112
E3

(第 5 轮交答案)

最终答案:提到 E3001 的工单共 387 张,其中客户明确表示取消/退订/停用/不再续费的有 112 张。
...
注:另有 57 张明确写“先不取消,等你们修好”,未计入。
标准答案:112
根模型: 5 次调用 | 输入 9348 / 输出 789 tokens | 约 ¥0.0125
子模型: 0 次调用 | 输入 0 / 输出 0 tokens | 约 ¥0.0000
```

注意第 4 轮的关键词:它用的是「取消掉」「退订吧」,不是「取消」「退订」。这是看过第 3 轮那张去重表之后挑的,刚好绕开了「先不取消」。最后那行 `E3` 不是写错了,是脚本只打印前 300 字,截在了这里。

又对了,112,还顺手指出了 57 张「先不取消」。但子模型还是一次没用。原因是我的数据造得太规整:387 张 E3001 工单的正文去重后只有 20 种,模型在第 3 轮用 `Counter` 去重,一眼看完 20 种说法,自己就分好了类。

这暴露了我造数据时的偷懒,真实工单的说法千奇百怪。下一节把数据造得乱一点,逼它用 `llm_query`。

## 第三步:让代码分不清,逼出子调用

新建 `agent-zero-lab/part04/make_free_log.py`。只改 E3001 工单的结尾:由「谁说的 + 核心意思 + 语气尾巴」三段随机拼起来,4 × 7 × 4 种组合,而且「不考虑换软件」和「准备换别的软件」这种只差几个字、意思相反的说法成对出现。

```python
# agent-zero-lab/part04/make_free_log.py  同一份日志,但 E3001 工单的结尾改成上百种说法,代码没法靠去重分类
import json
import random
from pathlib import Path

from part04.make_long_log import ISSUES, OUT, PLANS

random.seed(2490)
WHO = ["", "我们", "老板说", "财务说"]
END = ["。", ",别再扣了。", ",麻烦尽快。", "!"]
WANT = ["不续了", "把订阅停掉", "这个月就退订", "准备换别的软件", "直接注销吧", "下期别扣了", "取消自动续费"]
STAY = ["先别取消", "还想继续用", "不打算退订", "等修好再说", "只是想知道原因", "换张卡再试试", "不考虑换软件"]


def make(n: int = 2000) -> tuple[str, int]:
    lines: list[str] = []
    cancel = 0
    for i in range(1, n + 1):
        plan = random.choices(PLANS, weights=[5, 4, 1])[0]
        code = random.choice(list(ISSUES))
        body = random.choice(ISSUES[code])
        if code == "E3001":
            wants = random.random() < 0.3
            cancel += wants
            core = random.choice(WANT if wants else STAY)
            body += f"。{random.choice(WHO)}{core}{random.choice(END)}"
        else:
            body += "。"
        month, day = random.randint(1, 9), random.randint(1, 28)
        lines.append(f"T-{i:05d} | 2026-{month:02d}-{day:02d} | C-{random.randint(1, 400):04d} | {plan} | {body}")
    return "\n".join(lines), cancel


if __name__ == "__main__":
    text, cancel = make()
    (OUT / "tickets_free.txt").write_text(text, encoding="utf-8")
    (OUT / "tickets_free_truth.json").write_text(json.dumps({"e3001_cancel": cancel}), encoding="utf-8")
    e3 = [l for l in text.splitlines() if "E3001" in l]
    tails = {l.split("。", 1)[1] for l in e3}
    print(f"{len(text)} 个字符,E3001 工单 {len(e3)} 张,结尾有 {len(tails)} 种写法,要取消的 {cancel} 张")
```

<div class="line-notes">

- `from part04.make_long_log import ISSUES, OUT, PLANS` 复用上一个脚本的常量,只 import 不会重新造数据,因为那边的造数据代码在 `if __name__ == "__main__":` 里。
- `random.seed(2490)` 换一个种子,和第一份数据区分开。
- `WANT = [` 想走的七种核心说法,只有「取消自动续费」带「取消」,只有「这个月就退订」带「退订」。
- `STAY = [` 不走的七种,反而有三种带「取消」「退订」「换软件」字样,专门让关键词搜索翻车。
- `body += f"。{random.choice(WHO)}{core}{random.choice(END)}"` 三段随机拼接,比如「老板说直接注销吧,麻烦尽快。」。
- `tails = {l.split("。", 1)[1] for l in e3}` 集合推导式,按第一个句号切开取后半句,去重后数有多少种写法。

</div>

```bash
uv run python -m part04.make_free_log
```

```text
109865 个字符,E3001 工单 442 张,结尾有 172 种写法,要取消的 120 张
```

172 种写法。回传上限 1500 字,模型没法一次 print 全部再自己用眼睛分类。跑一下:

```bash
uv run python -m part04.rlm_mini free_cancel
```

第 3、4 轮它先用代码把「我们」「老板说」这类前缀和「麻烦尽快」这类尾巴剥掉,172 种写法被它归并成 14 种核心说法。然后第 5 轮,第一次调用了子模型:

```text
--- 第 5 轮代码:
cats = ['不打算退订','先别取消','等修好再说','还想继续用','不考虑换软件','换张卡再试试','只是想知道原因','下期别扣了','把订阅停掉','取消自动续费','直接注销吧','不续了','这个月就退订','准备换别的软件']
prompt = "判断以下客户表述是否【明确表示】要取消、退订、停用或不再续费(即明确要终止服务/停止付费)。只回答 是 或 否,每行一个,格式:表述=>是/否。\n" + "\n".join(cats)
print(llm_query(prompt))
--- 输出:
不打算退订=>否
先别取消=>否
...
这个月就退订=>是
准备换别的软件=>是

--- 第 6 轮代码:
q = "客户原话:'准备换别的软件'。这句话是否【明确】表示要取消、退订、停用或不再续费?注意:只是表达打算换软件,并未明确说要取消/退订/停用/不再续费,应判否。只回答 是 或 否。"
print(llm_query(q))
--- 输出:
否

--- 第 7 轮代码:
yes_cats = {'下期别扣了','把订阅停掉','取消自动续费','直接注销吧','不续了','这个月就退订'}
total = 0
detail = {}
for k, v in c.items():
    if k in yes_cats:
        total += v
        detail[k] = v
print(detail)
print("总计:", total)
--- 输出:
{'直接注销吧': 16, '下期别扣了': 24, '取消自动续费': 18, '把订阅停掉': 24, '不续了': 13, '这个月就退订': 13}
总计: 108

最终答案:含 E3001 的工单共 442 张,其中客户明确表示要取消、退订、停用或不再续费的有 108 张。
...
标准答案:120
根模型: 8 次调用 | 输入 23117 / 输出 1375 tokens | 约 ¥0.0199
子模型: 2 次调用 | 输入 191 / 输出 95 tokens | 约 ¥0.0011
```

108,标准答案 120,差了 12 张。差的正好是「准备换别的软件」那 12 张。

这一段轨迹是我今天觉得最有教学价值的地方,值得慢慢看。第 5 轮子模型的判断是「是」,和我造数据时的标签一致。第 6 轮根模型不同意,又问了一次,而且在问题里写好了「应判否」。子模型照着说了「否」,根模型就采纳了。说白了,根模型先有了自己的结论,再去问一个会顺着提问走的子模型,得到的只是自己想听的答案。

谁对?说实话两边都说得通。我的问题写的是「明确表示要取消、退订、停用或不再续费」,「准备换别的软件」确实没明说不续费。问题本身定义不清,RLM 只是把这个模糊放大了。下面练习 2 里我把「打算换软件也算」写进问题,它就答出了 120。

这里有两条经验,真实项目里都用得上:

- 子调用的 prompt 是根模型自己写的,它可以带偏子模型。看 RLM 的轨迹时,要专门看它给子模型写了什么。
- 「语义判断」类任务的标准要先写清楚。这和 [Day 140](/blog/agent-zero/day-140-prompt-2/) 讲提示词时说的「给定义」是一回事,换到 RLM 里问题更隐蔽,因为定义藏在根模型临时写的子 prompt 里。

## 三种做法放在一起比

把今天所有实跑结果放进一张表:

| 做法 | 问题 A(22) | 问题 B(112) | 乱序版 B(120) | 输入 token | 花费 |
| --- | --- | --- | --- | --- | --- |
| 全塞进 prompt | 8 / 3(跑两次) | 32 / 34(跑两次) | 128 / 34 / 34(连跑三次) | 每次约 7 万 | 首次约 ¥0.14,之后命中缓存约 ¥0.003 |
| 最小 RLM | 22 | 112 | 108(问题定义模糊)/ 120(写清定义) | 每题 6 千到 2.3 万 | 每题 ¥0.01–0.02 |

对照组在乱序版上我连跑了三次,温度都是 0,答案是 128、34、34(练习 1 的参考答案里有代码)。一次比真值多,两次少了一大半。

RLM 在这几道题上又准又便宜,但别急着下结论说它全面更好。这几道题是我特意挑的「需要通读全部、要筛选计数」的问题,刚好是 RLM 的主场。换成客服最常见的「E1043 怎么解决」,答案就在帮助中心一篇文章里,RAG 检索一次、调一次模型,一两秒出结果;RLM 要先写代码看格式,再筛,再交答案,至少三四轮往返,延迟是 RAG 的好几倍。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="三种做法对比:RAG 事先切块建索引查询时取 top-k;长上下文直接全部放进 prompt;RLM 不预处理,查询时模型写代码现场决定怎么读">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink)">RAG:事先准备,查询时取一点</text>
<rect x="20" y="42" width="120" height="34" rx="4" fill="none" stroke="var(--compute)"/><text x="80" y="64" fill="var(--ink)" text-anchor="middle">切块 + 建索引</text>
<line x1="140" y1="59" x2="180" y2="59" stroke="var(--ink-soft)"/>
<rect x="180" y="42" width="120" height="34" rx="4" fill="none" stroke="var(--compute)"/><text x="240" y="64" fill="var(--ink)" text-anchor="middle">检索 top-k</text>
<line x1="300" y1="59" x2="340" y2="59" stroke="var(--ink-soft)"/>
<rect x="340" y="42" width="120" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="400" y="64" fill="var(--ink)" text-anchor="middle">1 次模型调用</text>
<text x="480" y="64" fill="var(--ink-soft)" font-size="11">快、便宜;漏了就漏了</text>
<text x="20" y="114" fill="var(--ink)">长上下文:什么都不准备,全部给模型</text>
<rect x="20" y="126" width="280" height="34" rx="4" fill="none" stroke="var(--ink-soft)"/><text x="160" y="148" fill="var(--ink)" text-anchor="middle">整份资料 7 万 token 进 prompt</text>
<line x1="300" y1="143" x2="340" y2="143" stroke="var(--ink-soft)"/>
<rect x="340" y="126" width="120" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="400" y="148" fill="var(--ink)" text-anchor="middle">1 次模型调用</text>
<text x="480" y="148" fill="var(--ink-soft)" font-size="11">最省事;计数会错</text>
<text x="20" y="198" fill="var(--ink)">RLM:什么都不准备,模型现场决定怎么读</text>
<rect x="20" y="210" width="120" height="34" rx="4" fill="none" stroke="var(--compute)"/><text x="80" y="232" fill="var(--ink)" text-anchor="middle">资料进变量</text>
<line x1="140" y1="227" x2="180" y2="227" stroke="var(--ink-soft)"/>
<rect x="180" y="210" width="120" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="240" y="232" fill="var(--ink)" text-anchor="middle">写代码 × N 轮</text>
<line x1="300" y1="227" x2="340" y2="227" stroke="var(--ink-soft)"/>
<rect x="340" y="210" width="120" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="400" y="232" fill="var(--ink)" text-anchor="middle">按需子调用</text>
<text x="480" y="232" fill="var(--ink-soft)" font-size="11">准;慢,轮数不定</text>
</g>
</svg>
<figcaption>三条路的区别在「什么时候决定读哪些内容」:RAG 在建索引时就决定了怎么切,RLM 推迟到查询时才决定,长上下文干脆不决定。</figcaption>
</figure>

## RLM 和 RAG 怎么选

这是今天的第二个知识点。两者其实是对立的两种思路。RAG 是事先切好、建好索引,查询时一次性取回 top-k,把「读哪些内容」的决定提前做在建索引那一刻;RLM 是不预处理,查询时让模型现场决定怎么读。我自己的判断标准是看三件事。

**答案在不在少数几块里。** 「E1043 怎么解决」「企业版年付多少钱」,答案集中在一两段话里,用 RAG。「9 个月里企业版报 E1043 的有几张」「这份 300 页合同里所有违约条款列出来」,答案散在全文各处,或者需要逐条检查全文,RAG 的 top-k 装不下,RLM 合适。

**这份资料会被问多少次。** 帮助中心每天被问几千次,事先建索引的成本摊得很薄,每次查询又快又便宜。客户刚上传的一份对账单、一份日志,只问这一次,建索引反而是浪费,RLM 或者直接长上下文更划算。

**对延迟有多敏感。** 客服对话要秒回,RLM 的多轮往返等不起。后台的分析任务(「把上个月所有投诉按原因汇总」)晚几十秒没关系,可以用 RLM。

还有一种情况两者都不是最好的:资料本来就是结构化的表。今天的工单日志其实就是一张表,真实系统里它在数据库里,问题 A 一句 SQL 就能答。RLM 在这里有效,是因为模型在 REPL 里现场把文本当表处理了。如果你手上有数据库,直接让 Agent 写 SQL(第五部分的 Text-to-SQL)更稳。

面试里被问到「长上下文和 RAG 怎么选」,大多数人只会答两个选项。能把 RLM 当第三个选项讲出来,并且说清楚它适合「需要通读、一次性、不怕慢」的问题,会显得你一直在跟进。

## 动手练习

**练习 1:对照组换成乱序版数据,连跑三次。** 把 `long_direct.py` 复制成 `long_direct_free.py`,改成读 `tickets_free.txt`,只问 E3001 那一题,连跑三次。观察三次答案是不是一样,和 RLM 比准不准。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/long_direct_free.py  练习 1:对照组换成「上百种说法」那份日志
import json
from pathlib import Path

from common.llm import LLMClient

LOG = Path("part04/data/tickets_free.txt").read_text(encoding="utf-8")
TRUTH = json.loads(Path("part04/data/tickets_free_truth.json").read_text(encoding="utf-8"))
Q = "提到 E3001 的工单里,客户明确表示要取消、退订、停用或不再续费的有几张?只回答一个数字。"

client = LLMClient()
for i in range(3):
    r = client.chat([{"role": "user", "content": f"下面是工单日志:\n{LOG}\n\n问题:{Q}"}], temperature=0)
    print(f"第 {i + 1} 次:模型答 {r.content.strip()},标准答案 {TRUTH['e3001_cancel']},¥{r.cost:.4f}")
print(client.ledger)
```

<div class="line-notes">

- `LOG = Path("part04/data/tickets_free.txt")` 换成乱序版,标准答案是 120。
- `for i in range(3):` 同一个请求连发三次,温度都是 0。
- `print(f"第 {i + 1} 次:模型答 {r.content.strip()},` 第一次 128,第二、三次都是 34。
- `print(client.ledger)` 三次一共 197094 个输入 token,¥0.1373。第一次 ¥0.1314,后两次命中缓存各 ¥0.0030。

</div>

```text
第 1 次:模型答 128,标准答案 120,¥0.1314
第 2 次:模型答 34,标准答案 120,¥0.0030
第 3 次:模型答 34,标准答案 120,¥0.0030
3 次调用 | 输入 197094 / 输出 3 tokens | 约 ¥0.1373
```

三次答案不一样,温度 0 也不稳定;而且 34 和 120 差得太远,不是「差一点」的问题。第一次 128 看起来接近,只是碰巧。后来我又连跑了一组三次,这回是 34、34、67(三次都命中缓存,一共 ¥0.0089)。这个例子说明,长上下文直接回答计数题时,你连它错多少都预测不了。

</details>

**练习 2:把定义写清楚,再跑一次乱序版。** 第三步里 RLM 少算了「准备换别的软件」那 12 张。写一个 `rlm_define.py`,问题里写明「打算换别的软件也算要离开」,看能不能答出 120。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/rlm_define.py  练习 2:把「什么算要走」写进问题里,再跑一次
from pathlib import Path

from part04.rlm_mini import rlm, root, sub

log = Path("part04/data/tickets_free.txt").read_text(encoding="utf-8")
question = (
    "提到 E3001 的工单里,客户表示要离开的有几张?"
    "「要离开」包括:取消、退订、停用、注销、不再续费、不要再扣款、打算换别的软件。"
    "明确说不走的(比如先别取消、不考虑换软件)不算。"
)
print("最终答案:", rlm(question, log))
print("根模型:", root.ledger)
print("子模型:", sub.ledger)
```

<div class="line-notes">

- `from part04.rlm_mini import rlm, root, sub` 直接复用 `rlm()`,`root`、`sub` 是那边建好的两个客户端,账也记在它们身上。
- `question = (` 括号里几个字符串挨着写,Python 会自动拼成一个,相当于 JS 里用 `+` 连起来。
- `"「要离开」包括:` 把边界情况列出来,「打算换别的软件」明确算进去。
- `"明确说不走的(比如先别取消、不考虑换软件)不算。"` 反例也写出来,防止模型把「不考虑换软件」也算进去。

</div>

```text
最终答案: 提到 E3001 的工单共 442 张,其中客户表示要离开的有 120 张。
根模型: 7 次调用 | 输入 20888 / 输出 1228 tokens | 约 ¥0.0192
子模型: 0 次调用 | 输入 0 / 输出 0 tokens | 约 ¥0.0000
```

答对了。有意思的是这次它一次子调用都没用:问题里定义写得够清楚,它把 14 种核心说法在根模型里自己分完了。定义清楚之后,连「需不需要子模型」都变了。

</details>

**练习 3:给 RLM 加一个花费上限。** 轮数上限防不住「每轮都很贵」的情况(比如模型把 2 万字一次次塞给子模型)。写一个 `rlm_budget()`,每轮开始前检查根模型和子模型加起来的花费,超过预算就停。用 ¥0.004 的预算跑问题 A,看它在第几轮停下。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/rlm_budget.py  练习 3:给 RLM 加一个花费上限,超了就停
import re
from pathlib import Path
from typing import Any

from part04.repl_demo import run_code
from part04.rlm_mini import FENCE, SYSTEM, llm_query, root, sub


def rlm_budget(question: str, context: str, budget: float, max_turns: int = 8) -> str:
    ns: dict[str, Any] = {"context": context, "llm_query": llm_query, "answer": {"content": "", "ready": False}}
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM.format(n=len(context), fence=FENCE)},
        {"role": "user", "content": question},
    ]
    for turn in range(1, max_turns + 1):
        spent = root.ledger.cost + sub.ledger.cost
        if spent > budget:
            return f"(第 {turn} 轮前已花 ¥{spent:.4f},超过上限 ¥{budget},停止)"
        reply = root.chat(messages, temperature=0).content
        messages.append({"role": "assistant", "content": reply})
        m = re.search(FENCE + r"repl\n(.*?)" + FENCE, reply, re.S)
        if not m:
            messages.append({"role": "user", "content": f"请只写一个 {FENCE}repl 代码块。"})
            continue
        out = run_code(m.group(1), ns)
        if ns["answer"]["ready"]:
            return str(ns["answer"]["content"])
        messages.append({"role": "user", "content": f"输出:\n{out[:1500]}"})
    return "(轮数用完,没有交答案)"


if __name__ == "__main__":
    log = Path("part04/data/tickets_long.txt").read_text(encoding="utf-8")
    q = "2026 年 7 到 9 月,企业版客户提到 E1043 的工单一共有几张?"
    print(rlm_budget(q, log, budget=0.004))
    print("根模型:", root.ledger)
```

<div class="line-notes">

- `from part04.rlm_mini import FENCE, SYSTEM, llm_query, root, sub` 系统提示词和子调用函数都复用,只重写循环。
- `spent = root.ledger.cost + sub.ledger.cost` 两本账加起来才是这次查询的真实花费。只看根模型会漏掉子调用。
- `if spent > budget:` 在调模型**之前**检查。放在调用之后检查的话,最后一次超支的调用已经花出去了。
- `return f"(第 {turn} 轮前已花 ¥{spent:.4f},` 停下时把花了多少写清楚,方便排查。
- `print(rlm_budget(q, log, budget=0.004))` 故意给一个很小的预算,正常跑完问题 A 要 ¥0.01 左右。

</div>

```text
(第 3 轮前已花 ¥0.0043,超过上限 ¥0.004,停止)
根模型: 2 次调用 | 输入 1317 / 输出 422 tokens | 约 ¥0.0043
```

两轮花了 ¥0.0043,第三轮开始前被拦下。真实系统里预算一般按「这类查询平均花费的三到五倍」来定,停下时最好不是返回一句话,而是让模型用最后一轮交一个「目前为止的最佳答案」。官方 `rlm` 库就是这么做的:轮数用完还没交卷时,`_default_answer()` 会带着全部历史再调一次模型,让它根据已有信息给个最终答案;它另有一个 `max_budget` 参数(按美元算),超了直接抛 `BudgetExceededError`。

</details>

**练习 4(开放题):给 RLM 找一个它不该用的场景。** 用 Day 226 的帮助中心 RAG 问「E1043 怎么解决」,再用 `rlm()` 把 20 篇帮助中心文章拼成一个字符串当 `context` 问同一个问题。比较轮数和延迟。

<details><summary>参考答案</summary>

RLM 这一半我实跑了,RAG 那一半要用 Day 226 的检索脚本,我这里没有现成的,没跑。把 `data/kb/*.md` 用 `"\n\n".join(...)` 拼成一个字符串(20 篇一共 4108 个字符),传给 `rlm("E1043 怎么解决?", kb_text)`:

```text
--- 第 1 轮代码:
print(context[:2000])
...
--- 第 2 轮代码:
print(context[2000:4108])
...
(第 3 轮交答案:把 CSV 另存为 UTF-8 编码再导入,或者直接上传 XLSX)
耗时 3.2s
根模型: 3 次调用 | 输入 3240 / 输出 220 tokens | 约 ¥0.0060
```

三轮往返,而且你看它干了什么:资料只有 4108 个字符,它分两段直接 print 出来用眼睛读完了,代码执行环境完全没派上用场,只是绕了个远路。RAG 一次检索加一次回答,答案集中在一篇文章、问题又高频的场景里,RLM 多花的轮数没有换来任何准确率。再想一步,4108 个字符直接塞进 prompt 也就两千多个 token(按今天测的 1.66 字符一个 token 算约 2500),连检索都可以不要。资料小到这个程度,三种做法里最简单的那个最好。

</details>

验收标准:`long_direct.py` 和 `rlm_mini.py` 都跑通,能复现「直接塞答错、RLM 答对」;能指着 `rlm_mini.py` 说出哪一行是「资料进变量」、哪一行是「递归子调用」、哪一行防止模型偷看全文;能用自己的话讲出 RLM 和 RAG 各适合什么问题。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| RLM(递归语言模型) | Recursive Language Models。长输入放进代码环境当变量,模型写代码去看、去切,对片段递归调用模型处理,最后汇总 |
| REPL | Read-Eval-Print Loop,读一行、执行、打印、再等下一行。浏览器 Console 就是 JS 的 REPL |
| 根模型(root model) | RLM 里最外层接到问题、写代码的那个模型,它看不到资料全文 |
| 子模型(sub model) | 被 `llm_query` 调用的模型,每次只读一小段,上下文干净 |
| 子调用 / 递归调用 | 在代码里调用模型处理一个片段;子调用本身也是 RLM 时就是真正的递归 |
| 命名空间(namespace) | `exec` 用的那个 dict,代码里读写的变量都在里面,多轮之间共享 |
| `exec` | Python 内置函数,把一段字符串当代码执行,相当于 JS 的 `new Function(code)()` 加上指定作用域 |
| `redirect_stdout` | `contextlib` 里的上下文管理器,`with` 块里的 print 改写到指定对象 |
| 上下文腐烂(context rot) | 输入越长模型表现越差的现象,哪怕输入远没到窗口上限 |
| 上下文窗口 | 模型一次能看到的最大 token 数,见 [Day 109](/blog/agent-zero/day-109-context-window/) |
| CodeAct | 让模型写代码当动作,中间结果留在代码环境里,见 [Day 186](/blog/agent-zero/day-186-codeact-1/) |

## 常见误区

**以为窗口装得下就能答对。** 今天 7 万 token 只占 DeepSeek 1M 窗口的 7%,计数题照样从 22 答成 8。窗口大小决定能不能放进去,准确率要另外测。

**在 REPL 里写表达式等着看结果。** `exec` 不像 Console 和 Jupyter 那样回显最后一个表达式,`len(context)` 什么都不输出,模型会以为代码没跑。系统提示词里一定要写「只有 print 的你才看得到」。

**不截断回传的输出。** 不加 `out[:1500]`,模型第一轮写个 `print(context)`,11.9 万字就全回到它的上下文里,RLM 退化成「全塞进 prompt」,还多付了几轮的钱。

**`.format` 的模板里直接写花括号。** 系统提示词里的 `{"content": "", "ready": False}` 不写成双花括号,`.format(n=...)` 会报 `KeyError: '"content"'`。这一下我第一次写的时候就撞上了。

**不看子调用的 prompt 就相信结果。** 今天第 6 轮根模型在子 prompt 里写了「应判否」,子模型就照着答了。RLM 的轨迹要连子 prompt 一起看。

**在本机进程里 exec 不可信的输入。** 模型写的代码有和你一样的权限。资料来自用户上传时,代码可能被资料里的指令带偏(这叫提示词注入,第七部分专门讲)。生产环境要放进沙箱。

**什么问题都想用 RLM。** 答案集中在一两块、问题高频、要秒回的场景,RAG 又快又便宜;资料就几千字,直接塞进 prompt 最简单;资料本来是数据库表,写 SQL 最稳。

## 学习资料

### 文档与文章

- [Recursive Language Models(arXiv 2512.24601)](https://arxiv.org/abs/2512.24601):今天的出处。先读摘要和讲方法的那一节,再看实验部分的结果表和成本对比,1 小时。英文,配合浏览器翻译读就行。
- [Alex Zhang 的 RLM 博客](https://alexzhang13.github.io/blog/2025/rlm/):作者写在论文之前的博客版本,有轨迹截图,比论文好读,30 分钟。
- [alexzhang13/rlm README](https://github.com/alexzhang13/rlm):官方实现的用法和支持的沙箱环境,看完对照今天的 60 行代码,10 分钟。
- [Chroma · Context Rot](https://www.trychroma.com/research/context-rot):上下文越长模型越差的系统测试,看图就够,20 分钟。
- [Lost in the Middle(arXiv 2307.03172)](https://arxiv.org/abs/2307.03172):2023 年的经典论文,信息放在长上下文中间时模型最容易漏掉,读摘要和图 1。
- [Python 文档 · exec](https://docs.python.org/zh-cn/3/library/functions.html#exec) 和 [contextlib](https://docs.python.org/zh-cn/3/library/contextlib.html):今天用到的两个标准库,中文版。
- [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天算钱用的价格和高峰时段说明。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TrAezPEvC&autoplay=0&high_quality=1" title="[Agent Loop] 05期-MIT爆火论文-RLM-程序化递归调用，完成超长上下文任务（简介附原文链接）" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Agent智能体深度研究院 · [Agent Loop] 05期-MIT爆火论文-RLM-程序化递归调用,完成超长上下文任务 · 13 分钟,中文讲论文的思路和实验,看完再回来读今天的代码。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wPYK66EY4&autoplay=0&high_quality=1" title="大模型算数总出错？RLM递归语言模型如何破解长上下文难题 | AI Engineer" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>量子菠萝_ · 大模型算数总出错?RLM递归语言模型如何破解长上下文难题 | AI Engineer · 21 分钟,标题里的「算数出错」正好是今天对照组踩的坑。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/umbtFGPzdAM" title="MIT CSAIL Explains: Recursive Language Models" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>MIT CSAIL · MIT CSAIL Explains: Recursive Language Models · 实验室官方频道的讲解,英文,开自动字幕。</figcaption>
</figure>

- Latent Space《Recursive Language Models — Alex Zhang, MIT PhD》(YouTube ID `kog7mwsDqnk`):作者本人的长访谈,英文,想深入再看。

### 书籍

今天这组不需要。RLM 是 2025 年底才出现的方法,还没有书系统写过它,论文和作者博客就是最好的材料。

### 开源项目与代码

- [alexzhang13/rlm](https://github.com/alexzhang13/rlm):官方实现,PyPI 包 `rlms`。重点看 `rlm/utils/prompts.py` 里的系统提示词,和今天的 `SYSTEM` 对比,你会发现它多写了批量子调用 `llm_query_batched`、「子模型大约能吃 50 万字符,别怕多给」的提示,还有「别在没做完时交答案」。

## 自测

**1. 对照组里第二次调用只花了 ¥0.0033,第一次花了 ¥0.1437,输入 token 几乎一样。为什么?**

<details><summary>答案</summary>

两次请求的前缀(整份日志)完全一样,第二次命中了 DeepSeek 的上下文缓存。缓存命中的输入价是 0.04 元每百万 token,未命中是 2 元,差 50 倍。71868 × 0.04 / 1000000 ≈ ¥0.003。见 Day 124。

</details>

**2. `rlm_mini.py` 里哪一行保证了根模型看不到资料全文?如果删掉它会怎样?**

<details><summary>答案</summary>

两处。一是第一条用户消息只放 `question`,资料只在 `ns["context"]` 里;二是回传时 `out[:1500]` 截断。删掉截断后,模型一旦 `print(context)`,11.9 万字符就全部进入它的上下文,等于退化成「全塞进 prompt」,计数题又会开始出错,而且每一轮都要为这 7 万 token 付钱(后几轮能命中缓存会便宜些)。

</details>

**3. 为什么问题 A 和 B 的 RLM 都没有调用子模型?这是好事还是坏事?**

<details><summary>答案</summary>

问题 A 是纯筛选计数,代码就能做;问题 B 的数据只有 20 种说法,去重后模型自己就能分类。这是好事:能用代码精确算的就不该交给模型,子调用既花钱又可能出错。子调用只该用在代码判断不了的语义问题上,比如乱序版里那 14 种核心说法的归类。

</details>

**4. 乱序版里 RLM 答了 108,标准答案 120。差在哪?应该怎么修?**

<details><summary>答案</summary>

差在「准备换别的软件」这 12 张。根模型第一次问子模型得到「是」,又带着「应判否」的诱导问了第二次,采纳了「否」。根本原因是问题里「明确表示要……不再续费」的定义不清。修法是把边界写进问题(练习 2,写清定义后答出 120);另外看轨迹时要连子 prompt 一起检查,发现根模型在子 prompt 里预设答案要当成问题。

</details>

**5.(面试题)你们要做一个功能:客户上传一份 200 页的服务合同,问「里面所有关于违约金的条款,金额和触发条件分别是什么」。你会用 RAG、直接长上下文,还是 RLM?说说理由和风险。**

<details><summary>答案</summary>

倾向 RLM,或者至少是「代码先筛、模型再读」的同类做法。理由:这是枚举题,答案散在全文,RAG 的 top-k 很可能漏掉几条,而且你不知道漏了;合同只问这一次,建索引不划算;直接塞 200 页长上下文能放下,但枚举和逐条核对正是长上下文容易漏的地方。RLM 可以先用代码按条款编号切开,用关键词粗筛出带「违约」「赔偿」「滞纳」的条款,再对每条做子调用抽金额和条件,最后代码汇总成表。风险:轮数和延迟不固定,要有轮数和花费上限;合同是用户上传的,代码执行要放沙箱,防提示词注入;子调用的抽取要有结构化输出和校验(Day 147 起),最好抽查原文对照。如果这是一个高频、对延迟敏感的场景,可以先离线把合同条款结构化入库,再用 RAG 或 SQL 查。

</details>

**6. RLM 和 Day 186 的 CodeAct 有什么相同和不同?**

<details><summary>答案</summary>

相同:都是让模型写代码当动作,在一个代码执行环境里多轮循环,中间结果留在环境里不经过模型上下文。不同:CodeAct 里代码主要用来调用工具、组合工具结果;RLM 里代码操作的是用户给的超长输入本身,而且环境里多了一个能调用模型(甚至调用自己)的函数,用来处理代码判断不了的片段。可以把 RLM 看成「输入特别长时的一种 CodeAct」。

</details>

## 明天预告

Day 250 · 知识图谱三分钟入门:实体、关系和三元组。今天的问题 A 和 B 有一个共同点:答案散在全文,要「数」和「枚举」。RLM 的办法是查询时现场写代码;还有一条老路是事先把资料里的事实拆成「谁和谁是什么关系」存成一张图,问枚举、问多跳关系时沿着边走。明天不调模型,先手写十几条 CloudLedger 的三元组,把图的基本操作弄明白,后天再让大模型来抽。
