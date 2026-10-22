---
title: 'Day 499 · 简历(二):项目经历,问题、方案、数据'
description: '把 SupportPilot 写成简历上的四条项目要点。先写两个小检查脚本(空话和口径、数字对账),再让模型按记录表改写,用脚本抓它的问题,最后人工改定稿。重点是每个数字都能讲清从哪来。'
pubDate: 2026-10-22
regime: none
tags: ['resume', 'job-search', 'portfolio', 'structured-output', 'agent-zero']
series: 'agent-zero'
day: 499
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 498](/blog/agent-zero/day-498-resume-1/) 读了一批真实 JD,写了 `count_skills` 数关键词,踩了子串误伤和中文 `\b` 的坑,最后生成了一张「JD 关键词 → 我的证据 → 简历哪一行」的对照表。表里右边那列写着「项目 1 第 1 条」「项目 1 第 2 条」,但这几条还没写出来。

今天就写它们。项目经历是简历里最重要的部分,对转方向的人尤其如此,因为你的 Agent 能力全部要靠它证明。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出一条好的项目要点由哪三样东西组成,并能指出一段坏写法具体坏在哪。
2. 写两个检查脚本:一个查空话和缺口径,一个把要点里的数字和记录表逐个对账。
3. 用模型按记录表改写项目经历,再用脚本和人工两道关,改出四条能放进简历的 SupportPilot 要点。

预计用时 2.5 小时。前置:[Day 498](/blog/agent-zero/day-498-resume-1/) 的对照表和 `part09/` 目录;毕业项目的评测和成本数字(Day 476–488);[Day 491](/blog/agent-zero/day-491-readme-arch/) 整理 README 时汇总的结果表;结构化输出([Day 147](/blog/agent-zero/day-147-structured-1/) 起)。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `lint` 和 `numbers_in` 两个函数默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先看一段坏写法

下面这种写法我见过太多次了,很可能你第一版也会这么写:

> **SupportPilot 智能客服 Agent**
> 技术栈:Python、LangGraph、RAG、MCP、pgvector、FastAPI、Docker、Langfuse
> 负责系统的设计与开发,实现了工单分类、知识检索、工具调用、回复生成等功能,提升了客服效率。

它的问题不是字写得不好,而是**没有任何一句能被验证,也没有任何一句会让面试官想追问**。「提升了客服效率」提升了多少?跟什么比?怎么测的?「实现了工单分类」分得准不准?面试官每天看几十份简历,这种句子他眼睛扫过去就忘了。

技术栈那一行也是同样的毛病:八个名词,没有一个告诉你它在这个项目里解决了什么问题。Day 498 说过,每个词都是一个追问点,一行列八个词,等于给自己留了八个坑,却没给面试官一个想往下聊的理由。

## 三段式:做了什么、结果数字、口径

改的方法是把每条要点写成三段:**做了什么具体的事**,**结果是什么数字**,**这个数字在什么数据上、怎么测出来的**。最后这个叫「口径」。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="项目要点的三段结构">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <rect x="16" y="30" width="190" height="80" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="28" y="54" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">做了什么</text>
  <text x="28" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">建三层评测</text>
  <text x="28" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">接 GitHub Actions</text>
  <rect x="226" y="30" width="190" height="80" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="238" y="54" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">结果数字</text>
  <text x="238" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">成功率 55% → 77.5%</text>
  <text x="238" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">有起点才有意义</text>
  <rect x="436" y="30" width="190" height="80" fill="none" stroke="var(--rule)"/>
  <text x="448" y="54" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">口径</text>
  <text x="448" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">40 条 test 工单</text>
  <text x="448" y="94" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">规则+评审都过才算</text>
  <line x1="206" y1="70" x2="226" y2="70" stroke="var(--rule)"/>
  <line x1="416" y1="70" x2="436" y2="70" stroke="var(--rule)"/>
  <text x="16" y="146" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">面试官的追问顺序正好反过来:</text>
  <text x="16" y="170" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">「77.5% 怎么测的?」→ 口径 → 「40 条哪来的?」→ Day 476 场景×说法</text>
  <text x="16" y="192" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">「从 55% 涨上来改了什么?」→ 做了什么 → 错误分析和改动日志</text>
  <text x="16" y="214" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每一格都要有你能当场打开的东西</text>
</svg>
<figcaption>一条要点三格都填满,面试官就有了往下追问的抓手;任何一格空着,他只能跳过这一条。</figcaption>
</figure>

你可能听过 STAR 法则(情境 Situation、任务 Task、行动 Action、结果 Result)或者 Google 前人力副总裁 Laszlo Bock 在 2014 年一篇 LinkedIn 文章里提的公式「Accomplished [X] as measured by [Y] by doing [Z]」,中文圈叫它 XYZ 公式。它们说的是同一件事:结果要量化,要有比较的基线,要说你做了什么。我这里的三段式把「口径」单独拎出来,是因为 Agent 项目的数字特别容易被追问来源,一个不带口径的「成功率 90%」比不写还糟糕,它会让面试官怀疑你别的数字。

还有一条规则没有例外:**简历上的每个数字,都必须能在你的记录表里找到。** 宁可写「在 40 条 test 工单上」这种朴素的口径,也不要写一个看起来很厉害但说不清来源的数。

## 第一步:准备记录表

[Day 491](/blog/agent-zero/day-491-readme-arch/) 你把 Day 476–488 的结果汇总进了 SupportPilot 仓库的 `docs/results.md`。今天把它复制一份到练习仓库,脚本才好读:

```bash
cd agent-zero-lab
cp ../supportpilot/docs/results.md part09/results.md
```

下面是我用来演示的版本。**这里的数字是为了演示脚本写的示例值,不是真实测量结果**,你要换成你自己记录表里的数,格式保持「指标 | 值 | 口径 | 来源」四列就行:

```markdown
# SupportPilot 结果记录表(示例数字,换成你自己的)

| 指标 | 值 | 口径 | 来源 |
| --- | --- | --- | --- |
| 评测集规模 | 100 条 | dev 60 条 + test 40 条,场景×说法生成后人工改过 | Day 476 |
| 端到端任务成功率(基线) | 55% | test 集 40 条里 22 条通过,规则+LLM 评审都过才算 | Day 478 |
| 端到端任务成功率(最终) | 77.5% | test 集 40 条里 31 条通过,迭代 4 轮后只跑一次 test | Day 483 |
| 评审与人工一致率 | 85% | 抽 40 条人工标注,34 条和 LLM 评审结论一致 | Day 479 |
| 前缀缓存命中率 | 31% → 78% | dev 集跑一遍,prompt_cache_hit_tokens / prompt_tokens | Day 486 |
| 单工单成本 | ¥0.021 → ¥0.009 | dev 集 60 条平均,自建账本,DeepSeek 2026-10 高峰价 | Day 485–486 |
| 注入测试集 | 24 条 | 六类攻击各 4 条 | Day 487 |
| 越权与绕过审批成功次数 | 3 → 0 | 24 条注入用例里这两类 8 条 | Day 488 |
```

注意「口径」那一列写得有多啰嗦。这是故意的。简历上只放得下「40 条 test 工单」几个字,但面试官问下去,你要能接着说「规则和 LLM 评审都过才算通过,迭代 4 轮期间只看 dev,test 只跑了一次」。这些话现在就写进记录表,面试前翻一遍就行。

## 第二步:写一个检查空话和口径的脚本

先把「三段式」变成几条机器能查的规则:有没有数字,有没有空话,有数字的话有没有口径,长度有没有超。规则查不出好坏,但能查出明显的坏。

```python
# agent-zero-lab/part09/bullet_lint.py
import re

VAGUE = ["提升了", "显著", "大幅", "高效", "优化了", "等功能", "负责系统"]
SCOPE = re.compile(r"在 ?\d+ ?条|\d+ ?条(工单|用例|测试)")


def lint(bullet: str) -> list[str]:
    problems: list[str] = []
    if not re.search(r"\d", bullet):
        problems.append("没有数字")
    for word in VAGUE:
        if word in bullet:
            problems.append(f"空话「{word}」")
    if re.search(r"\d", bullet) and not SCOPE.search(bullet):
        problems.append("有数字但没写口径(在多少条上测的)")
    if len(bullet) > 90:
        problems.append(f"太长({len(bullet)} 字)")
    return problems


if __name__ == "__main__":
    bullets = [
        "负责系统的设计与开发,实现了工单分类、知识检索、工具调用、回复生成等功能,提升了客服效率。",
        "用 LangGraph 编排九个节点,退款走 interrupt 人工审批,大幅提升成功率。",
        "建立规则检查+LLM 评审两层评测并接入 CI,在 40 条 test 工单上端到端成功率从 55% 提升到 77.5%。",
    ]
    for b in bullets:
        p = lint(b)
        print("通过" if not p else "不通过", p, "|", b[:24] + "…")
```

<div class="line-notes">

- `VAGUE = ["提升了", "显著", "大幅", "高效", "优化了", "等功能", "负责系统"]` 空话清单。「提升了」后面不跟数字基本就是空话;「等功能」说明你在罗列而不是在讲一件事。这张表你可以按自己的坏习惯往里加。
- `SCOPE = re.compile(r"在 ?\d+ ?条|\d+ ?条(工单|用例|测试)")` 口径的样子:「在 40 条」或者「24 条用例」。`re.compile` 先把正则编译成一个对象,后面反复用时更快,也更好读。`|` 是「或」,` ?` 是「可以有一个空格也可以没有」。这条规则写窄了,第四步你会看到它误判。
- `def lint(bullet: str) -> list[str]:` 输入一条要点,返回问题列表。空列表就是通过。
- `if not re.search(r"\d", bullet):` `\d` 匹配一个阿拉伯数字。注意它不认「九个」「三层」这种中文数字,所以第二条测试会被判「没有数字」,这一条判得不算冤:「九个节点」不是结果,是规模。
- `for word in VAGUE:` 逐个空话词检查,有几个报几个。
- `if re.search(r"\d", bullet) and not SCOPE.search(bullet):` 有数字才要求口径,没数字的已经在第一条报过了,不重复报。
- `if len(bullet) > 90:` 一条要点在 A4 纸上大约一行半,超过 90 个字符多半是塞了两件事。`len` 按字符数算,一个汉字算 1。
- `bullets = [` 三条测试:原来的坏写法、一条半好不坏的、一条按三段式写的。
- `print("通过" if not p else "不通过", p, "|", b[:24] + "…")` `b[:24]` 取前 24 个字符,相当于 JS 的 `b.slice(0, 24)`。

</div>

```bash
uv run python part09/bullet_lint.py
```

```text
不通过 ['没有数字', '空话「提升了」', '空话「等功能」', '空话「负责系统」'] | 负责系统的设计与开发,实现了工单分类、知识检索、…
不通过 ['没有数字', '空话「大幅」'] | 用 LangGraph 编排九个节点,退款走 i…
通过 [] | 建立规则检查+LLM 评审两层评测并接入 CI,…
```

坏写法一口气中了四条。第三条通过了,注意它里面有「提升到」,但规则只拦「提升了」,因为「从 55% 提升到 77.5%」后面紧跟着数字,不是空话。这类细节就是规则要你自己拿捏的地方。

## 第三步:数字对账

第二个脚本做一件更重要的事:把要点里出现的每一个数字,拿去记录表里找。找不到的,要么是你记错了,要么是你(或者模型)编的。

```python
# agent-zero-lab/part09/number_check.py
import re
from pathlib import Path

NUM = re.compile(r"\d+(?:\.\d+)?%?")


def numbers_in(text: str) -> set[str]:
    return set(NUM.findall(text))


def check(bullet: str, known: set[str]) -> list[str]:
    return sorted(n for n in numbers_in(bullet) if n not in known)


if __name__ == "__main__":
    known = numbers_in(Path("part09/results.md").read_text(encoding="utf-8"))
    print(f"记录表里一共 {len(known)} 个不同的数字")
    bullets = [
        "建立规则检查+LLM 评审两层评测并接入 CI,在 40 条 test 工单上端到端成功率从 55% 提升到 77.5%。",
        "通过稳定前缀和模型路由,缓存命中率 31% → 87%,单工单成本从 ¥0.021 降到 ¥0.009。",
    ]
    for b in bullets:
        bad = check(b, known)
        print("通过" if not bad else f"记录表里找不到 {bad}", "|", b[:20] + "…")
```

<div class="line-notes">

- `NUM = re.compile(r"\d+(?:\.\d+)?%?")` 匹配一个数:`\d+` 一串数字,`(?:\.\d+)?` 可选的小数部分,`%?` 可选的百分号。`(?:...)` 是「只分组不捕获」,这样 `findall` 返回的是整个数而不是括号里那一截。`77.5%` 整体匹配成一个 `"77.5%"`。
- `def numbers_in(text: str) -> set[str]:` 返回一个集合。集合相当于 JS 的 `Set`,自动去重,判断 `in` 很快。
- `return set(NUM.findall(text))` `findall` 返回所有匹配的列表,再转成集合。
- `def check(bullet: str, known: set[str]) -> list[str]:` 返回要点里那些「记录表里没有」的数。
- `return sorted(n for n in numbers_in(bullet) if n not in known)` 生成器表达式加 `sorted`,结果排好序,打印出来稳定好对比。
- `known = numbers_in(Path("part09/results.md").read_text(encoding="utf-8"))` 把记录表整个文件里的数字都收进来,包括「Day 476」的 476。这是个偷懒的做法:476 也算「已知数字」,如果你在要点里误写成 476 条,脚本会放过。够用,但你要知道它的边界。
- `print(f"记录表里一共 {len(known)} 个不同的数字")` 实跑是 28 个。
- `"通过稳定前缀和模型路由,缓存命中率 31% → 87%,单工单成本从 ¥0.021 降到 ¥0.009。",` 第二条故意写错一个数:记录表是 78%,这里写成 87%。两位数字颠倒是真实会发生的笔误。

</div>

```bash
uv run python part09/number_check.py
```

```text
记录表里一共 28 个不同的数字
通过 | 建立规则检查+LLM 评审两层评测并接入…
记录表里找不到 ['87%'] | 通过稳定前缀和模型路由,缓存命中率 31…
```

87% 被抓出来了。这个脚本看起来很蠢,但它防的是简历上最致命的一类错误:面试官问「87% 怎么测的」,你翻出记录表一看是 78%,当场就说不清了。

## 第四步:让模型按记录表改写

现在把三样东西交给模型:原来的坏写法、你做过的事(几行笔记)、记录表。要求它写四条三段式要点,数字只许从记录表里抄。然后用上面两个脚本检查它的输出。

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="模型改写加两道检查的流程">
  <rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)"/>
  <rect x="16" y="40" width="120" height="56" fill="none" stroke="var(--rule)"/>
  <text x="26" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">坏写法</text>
  <text x="26" y="82" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">+笔记+记录表</text>
  <rect x="166" y="40" width="110" height="56" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="176" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">模型改写</text>
  <text x="176" y="82" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">JSON 4 条</text>
  <rect x="306" y="40" width="96" height="56" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="316" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">lint</text>
  <text x="316" y="82" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">空话/口径</text>
  <rect x="422" y="40" width="96" height="56" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="432" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">check</text>
  <text x="432" y="82" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">数字对账</text>
  <rect x="538" y="40" width="88" height="56" fill="none" stroke="var(--ink-soft)"/>
  <text x="548" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">你</text>
  <text x="548" y="82" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">因果和语气</text>
  <line x1="136" y1="68" x2="166" y2="68" stroke="var(--rule)"/>
  <line x1="276" y1="68" x2="306" y2="68" stroke="var(--rule)"/>
  <line x1="402" y1="68" x2="422" y2="68" stroke="var(--rule)"/>
  <line x1="518" y1="68" x2="538" y2="68" stroke="var(--rule)"/>
  <text x="16" y="136" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">脚本只能查「有没有」,查不了「对不对」:数字是真的,安在哪件事上是不是真的,只有你知道</text>
</svg>
<figcaption>模型负责把笔记改成句子,两个脚本负责拦住空话和编出来的数,最后一道永远是你自己。</figcaption>
</figure>

```python
# agent-zero-lab/part09/rewrite_project.py
import json
from pathlib import Path

from pydantic import BaseModel

from common.llm import LLMClient
from part09.bullet_lint import lint
from part09.number_check import check, numbers_in


class Bullets(BaseModel):
    bullets: list[str]


OLD = "负责系统的设计与开发,实现了工单分类、知识检索、工具调用、回复生成等功能,提升了客服效率。"
NOTES = """做过的事:
- LangGraph 九个节点:分类、混合检索、MCP 业务工具、起草、自检;退款走 interrupt 人工审批
- 三层评测:规则检查、LLM 评审、轨迹检查,接 GitHub Actions 回归门禁
- 稳定 prompt 前缀 + 大小模型路由
- 注入测试集,客户身份在工具层绑定,退款只能申请不能执行"""

SYSTEM = (
    "你帮工程师改简历的项目经历。写 4 条要点,每条一句话,90 字以内,"
    "格式是「做了什么具体的事 + 结果数字 + 口径(在多少条上测的)」。"
    "数字只能从用户给的记录表里抄,记录表里没有的数字一个都不许写,"
    "不许用「显著」「大幅」「高效」这类形容词。"
    '只输出 JSON:{"bullets": ["...", "..."]}'
)

results = Path("part09/results.md").read_text(encoding="utf-8")
user = f"原来的写法:{OLD}\n\n{NOTES}\n\n记录表:\n{results}"

llm = LLMClient()
r = llm.chat(
    [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
    response_format={"type": "json_object"},
    temperature=0,
)
out = Bullets.model_validate(json.loads(r.content))

known = numbers_in(results)
for i, b in enumerate(out.bullets, 1):
    problems = lint(b) + [f"编的数字 {n}" for n in check(b, known)]
    print(f"{i}. {b}\n   → {'通过' if not problems else problems}")
print(f"\n{r.prompt_tokens} 输入 / {r.completion_tokens} 输出 | ¥{r.cost:.5f}")
```

<div class="line-notes">

- `class Bullets(BaseModel):` 期望模型返回 `{"bullets": [...]}`,一个字符串列表。
- `NOTES = """做过的事:` 三引号是多行字符串,相当于 JS 的反引号模板字符串(但不能插值)。笔记写的是「做过什么」,不带数字,数字全在记录表里,这样模型想写数字就只能去抄表。
- `"数字只能从用户给的记录表里抄,记录表里没有的数字一个都不许写,"` 这句说得再狠也只是请求,不是保证。所以后面还要用 `check` 验。
- `results = Path("part09/results.md").read_text(encoding="utf-8")` 记录表原文直接塞进提示词,Markdown 表格模型读得懂。
- `user = f"原来的写法:{OLD}\n\n{NOTES}\n\n记录表:\n{results}"` 三段用空行隔开,模型更容易分清哪段是什么。
- `temperature=0,` 尽量稳定,方便对比改提示词前后的效果。
- `out = Bullets.model_validate(json.loads(r.content))` 结构化输出两步走:解析 JSON,pydantic 校验。
- `known = numbers_in(results)` 用同一份记录表做对账基准。
- `for i, b in enumerate(out.bullets, 1):` `enumerate(列表, 1)` 同时给出序号和元素,序号从 1 开始。相当于 JS 的 `arr.forEach((b, i) => ...)` 再把 i 加 1。
- `problems = lint(b) + [f"编的数字 {n}" for n in check(b, known)]` 两个检查的结果拼成一个列表。Python 里两个 list 用 `+` 拼接,相当于 JS 的 `[...a, ...b]`。

</div>

```bash
uv run python -m part09.rewrite_project
```

第一次实跑的输出:

```text
1. 用 LangGraph 搭九个节点并让退款走 interrupt 人工审批,端到端任务成功率从 55% 升到 77.5%,在 test 集 40 条上测
   → ['有数字但没写口径(在多少条上测的)']
2. 搭规则检查、LLM 评审、轨迹检查三层评测并接 GitHub Actions 回归门禁,评审与人工一致率 85%,在抽 40 条人工标注上测
   → ['有数字但没写口径(在多少条上测的)']
3. 用稳定 prompt 前缀加大小模型路由,前缀缓存命中率从 31% 升到 78%,在 dev 集 60 条上测
   → ['有数字但没写口径(在多少条上测的)']
4. 在工具层绑定客户身份、退款只能申请不能执行,越权与绕过审批成功次数从 3 降到 0,在 24 条注入用例里这两类 8 条上测
   → 通过

578 输入 / 174 输出 | ¥0.00255
```

四条里三条报「没写口径」。先别急着骂模型,回去看原文:第 1 条明明写了「在 test 集 40 条上测」。是我的规则错了。`SCOPE` 只认「在 40 条」(「在」后面紧跟数字)和「24 条用例」(「条」后面跟着指定的词),而模型写的是「在 test 集 40 条上」,「在」和「40」中间隔了「test 集」,两种都不匹配。

这是写检查脚本时一定会遇到的事:**检查器本身也会错**,它报的问题要先回原文核对,才知道是被检查的东西错了还是检查器错了。改法是把规则放宽,只要出现「数字 + 条」就算有口径,顺手加上英文简历的「on a 40-ticket」写法。打开 `part09/bullet_lint.py`,把 `SCOPE` 那一行改成:

```python
SCOPE = re.compile(r"\d+ ?条|on (a|the) \d+")
```

<div class="line-notes">

- `SCOPE = re.compile(r"\d+ ?条|on (a|the) \d+")` 前一半「数字,可选空格,条」;后一半英文「on a 40」或「on the 40」。放宽的代价是「九个节点 3 条」这种不是口径的也会被当成口径,规则永远是在误伤和漏掉之间挑一个你能接受的位置。

</div>

改完先重跑 `uv run python part09/bullet_lint.py`,三条测试的结果和之前一样(第三条本来就有「在 40 条」)。再跑一次改写:

```text
1. 用 LangGraph 搭九个节点并让退款走 interrupt 人工审批,端到端任务成功率从 55% 升到 77.5%,在 test 集 40 条上测
   → 通过
2. 接三层评测与 GitHub Actions 回归门禁,LLM 评审与人工一致率 85%,在抽 40 条人工标注上测
   → 通过
3. 用稳定 prompt 前缀加大小模型路由,前缀缓存命中率从 31% 升到 78%,在 dev 集 60 条上测
   → 通过
4. 在工具层绑定客户身份、退款只申请不执行,越权与绕过审批成功次数从 3 降到 0,在 24 条注入用例里这两类 8 条上测
   → 通过

578 输入 / 166 输出 | ¥0.00173
```

两件事值得注意。第一,`temperature=0` 第二次跑出来的第 2 条和第 4 条措辞跟第一次不一样(「搭规则检查、LLM 评审、轨迹检查三层评测」变成了「接三层评测」)。temperature=0 只是让模型每一步挑概率最高的词,服务端的批处理和浮点计算仍可能带来细微差异,别指望它逐字复现。第二,这次模型没有编数字,四条全部过了数字对账。

## 第五步:脚本都过了,还要你自己看一遍

四条全绿,能直接贴进简历吗?不能。我逐条读了一遍,脚本查不出的问题至少有三个。

**第 1 条的因果搭错了。** 它说「用 LangGraph 搭九个节点……成功率从 55% 升到 77.5%」,读起来像是搭了九个节点让成功率涨了 22.5 个点。但记录表写得很清楚:55% 是基线,77.5% 是「迭代 4 轮后」,涨上来靠的是 Day 480–483 的错误分析和一处一处的改动,不是靠搭图。数字是真的,安在哪件事上是假的。面试官顺着问「九个节点哪个节点让成功率涨的」,你答不上来。

**口径拖在句尾,读着像机器写的。** 「在 test 集 40 条上测」「在 24 条注入用例里这两类 8 条上测」,每条都是同一个尾巴,而且「上测」这种说法人不会这么写。

**第 1 条的「九个节点」和笔记对不上。** 笔记里列了五个节点名就写了「九个节点」,这是我笔记的锅。模型照抄了,另一次实跑里它甚至写成了「拆成分类、混合检索、MCP 业务工具、起草、自检九个节点」,五个名字配一个「九」,明眼人一看就知道没数过。定稿时要么写全,要么加个「等」。

这三类问题有一个共同点:**数字和词都对得上,但意思不对**。规则查的是字面,意思只有做过这件事的你知道。所以流程里最后一道永远是人。

我改出来的定稿,同样用两个脚本过一遍:

```python
# agent-zero-lab/part09/project_final.py
from pathlib import Path

from part09.bullet_lint import lint
from part09.number_check import check, numbers_in

FINAL = [
    "用 LangGraph 编排分类、混合检索、MCP 业务工具、起草、自检等九个节点,退款经 interrupt 转人工审批;40 条 test 工单端到端成功率 77.5%。",
    "建三层评测(规则、LLM 评审、轨迹)接入 GitHub Actions 门禁;评审与人工抽检 40 条一致率 85%,迭代 4 轮后 test 成功率 55% → 77.5%。",
    "稳定 prompt 前缀并按难度路由大小模型,dev 集 60 条上缓存命中率 31% → 78%,单工单成本 ¥0.021 → ¥0.009。",
    "设计 24 条注入用例覆盖六类攻击;身份绑在工具层、退款只能申请,越权与绕过审批两类 8 条用例成功次数 3 → 0。",
]

known = numbers_in(Path("part09/results.md").read_text(encoding="utf-8"))
for i, b in enumerate(FINAL, 1):
    problems = lint(b) + [f"编的数字 {n}" for n in check(b, known)]
    print(f"{i}. {len(b)} 字 → {'通过' if not problems else problems}")
```

<div class="line-notes">

- `"用 LangGraph 编排分类、混合检索、MCP 业务工具、起草、自检等九个节点,退款经 interrupt 转人工审批;40 条 test 工单端到端成功率 77.5%。",` 第 1 条只放最终结果 77.5%,不再暗示是搭图带来的提升。「等九个节点」把五个名字和「九」的矛盾抹平。
- `"建三层评测(规则、LLM 评审、轨迹)接入 GitHub Actions 门禁;评审与人工抽检 40 条一致率 85%,迭代 4 轮后 test 成功率 55% → 77.5%。",` 提升放到它真正发生的地方:评测加迭代。「迭代 4 轮」也能在记录表里找到。
- `"稳定 prompt 前缀并按难度路由大小模型,dev 集 60 条上缓存命中率 31% → 78%,单工单成本 ¥0.021 → ¥0.009。",` 成本和缓存两个数挤在一条里,因为它们是同一组改动的结果。口径挪到数字前面,读起来顺。
- `"设计 24 条注入用例覆盖六类攻击;身份绑在工具层、退款只能申请,越权与绕过审批两类 8 条用例成功次数 3 → 0。",` 「3 → 0」比「降为 0」好,有起点。
- `print(f"{i}. {len(b)} 字 → {'通过' if not problems else problems}")` 顺带打印长度,第 2 条贴着 90 的上限。

</div>

```bash
uv run python -m part09.project_final
```

```text
1. 87 字 → 通过
2. 89 字 → 通过
3. 72 字 → 通过
4. 59 字 → 通过
```

放进简历时,项目标题那一行这样写:

> **SupportPilot · SaaS 智能客服工单 Agent**(个人项目,2026.10)· 演示:demo.你的域名 · GitHub:github.com/你的用户名/supportpilot

标题里用了「智能客服」,这是 Day 498 第六步从网易 JD 里抠出来的原词。

**注意「个人项目」四个字。** 课程里的项目就是个人项目,不要包装成「某公司智能客服系统」,也不要把它写进工作经历。面试官一问细节(「你们公司日均多少工单?」「上线后真实用户的满意度呢?」),包装立刻穿帮,而且会让他怀疑你简历上其他所有内容。个人项目只要做得深、数字讲得清,一点都不丢人。站长调研里一个要求硕士学历的 LLM Agent 系统开发岗,加分项里写的就是「个人项目或开源贡献均可」。

第二个项目(代码审查机器人)写两三条就够,重点放在它和第一个项目不同的地方:diff 解析和行号校验、埋 bug 评测集上的召回和有用率、阈值怎么选。练习第 2 题让你写。

## 动手练习

**练习 1:加一条规则。** 简历要点用「负责」「参与」「协助」开头,通常说明你在写职责而不是写成果。给 `lint` 加一条检查,遇到这种开头就提示「用职责开头,改成用做成的事开头」,不要改 `bullet_lint.py` 原文件。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex499_duty.py
from part09.bullet_lint import lint

DUTY_STARTS = ("负责", "参与", "协助")


def lint2(bullet: str) -> list[str]:
    problems = lint(bullet)
    if bullet.startswith(DUTY_STARTS):
        problems.append("用职责开头,改成用做成的事开头")
    return problems


for b in [
    "负责评测模块,在 40 条 test 工单上成功率 77.5%。",
    "建三层评测接入 CI,40 条 test 工单成功率 55% → 77.5%。",
]:
    print(lint2(b) or "通过", "|", b)
```

<div class="line-notes">

- `DUTY_STARTS = ("负责", "参与", "协助")` 用元组,因为下面 `startswith` 可以直接接收一个元组,任一前缀命中就返回 True。
- `def lint2(bullet: str) -> list[str]:` 包一层,先跑原来的检查,再加新规则。不改原文件,别的脚本还能照旧用 `lint`。
- `if bullet.startswith(DUTY_STARTS):` 相当于 JS 的 `DUTY_STARTS.some(p => bullet.startsWith(p))`。
- `print(lint2(b) or "通过", "|", b)` `列表 or "通过"`:空列表是假值,就打印「通过」;非空就打印列表本身。

</div>

```text
['用职责开头,改成用做成的事开头'] | 负责评测模块,在 40 条 test 工单上成功率 77.5%。
通过 | 建三层评测接入 CI,40 条 test 工单成功率 55% → 77.5%。
```

第一条数字和口径都有,但用「负责」开头,读的人看到的是你的岗位描述,不是你干成了什么。

</details>

**练习 2:给代码审查机器人写三条要点。** 下面是示例记录表(数字是演示用的,换成你 Day 495 的真实结果),存成 `part09/results_review.md`。写三条要点,用 `lint` 和 `check` 过一遍,报什么问题就分析是要点错了还是检查器错了。

```markdown
# 代码审查机器人结果记录表(示例数字,换成你自己的)

| 指标 | 值 | 口径 | 来源 |
| --- | --- | --- | --- |
| 埋 bug 评测集 | 20 个 | 6 个 PR 里人工埋的 bug,五类 | Day 495 |
| 召回 | 14/20 | 意见落在埋 bug 那一行 ±2 行算命中 | Day 495 |
| 有用率 | 38/52 | 52 条意见人工逐条标,38 条有用 | Day 495 |
| 置信度阈值 | 0.7 | 0.5 / 0.7 / 0.9 三档里召回和有用率的折中 | Day 495 |
```

<details><summary>参考答案</summary>

第一版:

```python
# agent-zero-lab/part09/ex/ex499_review_bot.py
from pathlib import Path

from part09.bullet_lint import lint
from part09.number_check import check, numbers_in

BULLETS = [
    "解析 unified diff 并校验行号,意见只落在改动行;在 6 个 PR 埋的 20 个 bug 上召回 14 个。",
    "置信度阈值在 0.5 / 0.7 / 0.9 三档里取 0.7,52 条意见人工标注 38 条有用。",
    "按 70% 召回和 73% 有用率挂进 GitHub Actions,每个 PR 自动评论。",
]
known = numbers_in(Path("part09/results_review.md").read_text(encoding="utf-8"))
for b in BULLETS:
    problems = lint(b) + [f"编的数字 {n}" for n in check(b, known)]
    print(problems or "通过", "|", b[:22] + "…")
```

<div class="line-notes">

- `"解析 unified diff 并校验行号,意见只落在改动行;在 6 个 PR 埋的 20 个 bug 上召回 14 个。",` 口径用的是「个」,不是「条」。
- `"按 70% 召回和 73% 有用率挂进 GitHub Actions,每个 PR 自动评论。",` 70% 和 73% 是我从 14/20 和 38/52 心算出来的。
- `known = numbers_in(Path("part09/results_review.md").read_text(encoding="utf-8"))` 换成这份记录表。

</div>

```text
['有数字但没写口径(在多少条上测的)'] | 解析 unified diff 并校验行号,…
通过 | 置信度阈值在 0.5 / 0.7 / 0.9…
['有数字但没写口径(在多少条上测的)', '编的数字 70%', '编的数字 73%'] | 按 70% 召回和 73% 有用率挂进 Gi…
```

第 1 条是检查器错了:「20 个 bug」就是口径,`SCOPE` 只认「条」。第 3 条两个问题都是真的:没写在多少个上测,而且 70% 和 73% 记录表里没有。它们不是编的,是算出来的,但「算出来」的数同样要进记录表,不然下次你自己都忘了 73% 是 38/52 四舍五入还是别的什么。

修法:记录表末尾加两行,`SCOPE` 认「个」:

```markdown
| 召回率 | 70% | 14/20 算出 | Day 495 |
| 有用率 | 73% | 38/52 = 73.1%,四舍五入 | Day 495 |
```

```python
# agent-zero-lab/part09/ex/ex499_review_bot2.py
import re
from pathlib import Path

import part09.bullet_lint as bl
from part09.number_check import check, numbers_in

bl.SCOPE = re.compile(r"\d+ ?(条|个)|on (a|the) \d+")

BULLETS = [
    "解析 unified diff 并校验行号,意见只落在改动行;在 6 个 PR 埋的 20 个 bug 上召回 14 个。",
    "置信度阈值在 0.5 / 0.7 / 0.9 三档里取 0.7,52 条意见人工标注 38 条有用。",
    "挂进 GitHub Actions 每个 PR 自动评论,20 个埋 bug 召回 70%,52 条意见有用率 73%。",
]
known = numbers_in(Path("part09/results_review.md").read_text(encoding="utf-8"))
for b in BULLETS:
    problems = bl.lint(b) + [f"编的数字 {n}" for n in check(b, known)]
    print(problems or "通过", "|", b[:22] + "…")
```

<div class="line-notes">

- `import part09.bullet_lint as bl` 导入整个模块并起别名,这样才能改它里面的 `SCOPE`。如果写 `from part09.bullet_lint import SCOPE` 再给 `SCOPE` 赋值,改的只是你这个文件里的变量,`lint` 函数看不到。
- `bl.SCOPE = re.compile(r"\d+ ?(条|个)|on (a|the) \d+")` `lint` 每次调用时才去读模块里的 `SCOPE`,所以替换后立刻生效。
- `"挂进 GitHub Actions 每个 PR 自动评论,20 个埋 bug 召回 70%,52 条意见有用率 73%。",` 百分比后面带上分母的规模,面试官一眼就知道 70% 是在 20 个上算的,不是在 2000 个上。

</div>

```text
通过 | 解析 unified diff 并校验行号,…
通过 | 置信度阈值在 0.5 / 0.7 / 0.9…
通过 | 挂进 GitHub Actions 每个 P…
```

</details>

**练习 3:观察题。** 去掉 `temperature=0`,让改写跑两次,看第 1 条有什么不同、有没有编数字。写一个新脚本,复用 `rewrite_project.py` 里的 `SYSTEM`、`OLD`、`NOTES` 和 `Bullets`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex499_twice.py
import json
from pathlib import Path

from common.llm import LLMClient
from part09.number_check import check, numbers_in
from part09.rewrite_project import NOTES, OLD, SYSTEM, Bullets

results = Path("part09/results.md").read_text(encoding="utf-8")
known = numbers_in(results)
llm = LLMClient()
for run in (1, 2):
    r = llm.chat(
        [{"role": "system", "content": SYSTEM},
         {"role": "user", "content": f"原来的写法:{OLD}\n\n{NOTES}\n\n记录表:\n{results}"}],
        response_format={"type": "json_object"},
    )
    out = Bullets.model_validate(json.loads(r.content))
    bad = [n for b in out.bullets for n in check(b, known)]
    print(f"第 {run} 次 第 1 条:{out.bullets[0]}")
    print(f"        编的数字:{bad or '无'}")
print(llm.ledger)
```

<div class="line-notes">

- `from part09.rewrite_project import NOTES, OLD, SYSTEM, Bullets` 复用常量和模型类。这一行有坑,看输出。
- `for run in (1, 2):` 跑两次,`(1, 2)` 是元组,遍历它和遍历列表一样。
- `response_format={"type": "json_object"},` 这次没传 temperature,用默认值。
- `bad = [n for b in out.bullets for n in check(b, known)]` 把四条里所有对不上的数字摊平到一个列表。
- `print(llm.ledger)` LLMClient 自带的账本,累计这个客户端的调用次数、token 和花费。

</div>

```text
1. 用 LangGraph 搭九个节点并给退款加 interrupt 人工审批,端到端任务成功率从 55% 升到 77.5%,在 test 集 40 条上测
   → 通过
2. 接三层评测并挂 GitHub Actions 回归门禁,LLM 评审与人工一致率 85%,在抽 40 条人工标注上测
   → 通过
3. 用稳定 prompt 前缀加大小模型路由,前缀缓存命中率从 31% 升到 78%,在 dev 集 60 条上测
   → 通过
4. 把客户身份绑在工具层、退款只申请不执行,越权与绕过审批成功次数从 3 降到 0,在 24 条注入用例里这两类 8 条上测
   → 通过

578 输入 / 168 输出 | ¥0.00175
第 1 次 第 1 条:用 LangGraph 搭建九节点工单流程并加退款 interrupt 人工审批,test 集 40 条任务成功率从 55%(22 条)升到 77.5%(31 条)
        编的数字:无
第 2 次 第 1 条:用 LangGraph 把客服流程拆成分类、混合检索、MCP 业务工具、起草、自检九个节点,退款走 interrupt 人工审批,在 test 集 40 条上端到端任务成功率从 55% 到 77.5%
        编的数字:无
2 次调用 | 输入 1156 / 输出 388 tokens | 约 ¥0.0039
```

先看开头多出来的那四条和一行花费。我只想跑两次,结果跑了三次:`rewrite_project.py` 的主体代码没有放进 `if __name__ == "__main__":`,`import` 它的时候整个文件从头到尾执行了一遍,包括调模型。这次多花了 ¥0.00175,钱不多,但如果那个文件里是删数据库的代码就不是小事了。Day 498 的 `kw_count_v2.py` 写了这个判断,所以被 import 时很安静。修法是把 `rewrite_project.py` 从 `results = ...` 开始的部分缩进进 `if __name__ == "__main__":`。

再看两次的第 1 条:第一次把分子也写进去了「55%(22 条)」,第二次列出了五个节点名配上「九个节点」。两次都没编数字,但因果搭错的问题两次都在,「九个」对五个名字的问题第二次也出现了。temperature 影响的是措辞,影响不了模型「不知道哪个改动带来了提升」这件事,它只有你的笔记,笔记没写的它不可能知道。

</details>

**验收标准**

- 你的 `part09/results.md` 是从自己的记录表来的,每一行都有口径和来源。
- 两个项目各写好了要点,每条都过了 `lint` 和 `check`。
- 你逐条读过,能对每条回答「这个数字是怎么测的」「这个提升是哪个改动带来的」。
- 项目标题写了「个人项目」,没有一条项目经历被写进工作经历。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 项目要点 | 简历项目经历下面那几行,一行讲一件事,英文简历叫 bullet point |
| 三段式 | 一条要点写清做了什么、结果数字、口径三样,例:建三层评测 / 55% → 77.5% / 40 条 test 工单 |
| 口径 | 一个数字是在什么数据上、用什么方法测出来的,例:「test 集 40 条,规则和 LLM 评审都过才算」 |
| 记录表 | 汇总所有实验数字和口径的文件,本课程里是 `docs/results.md`,简历上的数字只能从这里抄 |
| STAR 法则 | 情境、任务、行动、结果四段式,常用于面试讲经历 |
| XYZ 公式 | Laszlo Bock 提的「Accomplished X as measured by Y by doing Z」,强调量化结果和做法 |
| 数字对账 | 把文本里的每个数字拿去记录表里找,找不到的要么记错要么编的 |
| 检查器误判 | 检查脚本自己的规则写窄或写宽,把对的判成错、把错的放过 |
| 因果搭错 | 数字是真的,但安在了不是它的原因的那件事上 |

## 常见误区

**用形容词代替数字。** 「显著提升」「大幅降低」没有信息量。换成具体数字和起点:55% → 77.5%。

**有数字没口径。** 一个不带口径的「成功率 90%」比不写还糟,面试官会怀疑你所有的数。写成「40 条 test 工单上 77.5%」,朴素但站得住。

**检查脚本报错就去改简历。** 本文第四步三条「没写口径」全是检查器的错。脚本报的问题先回原文核对,分清是谁错了。

**脚本全绿就当定稿。** 因果搭错、五个名字配「九个节点」、句尾一样的尾巴,脚本一个都查不出来。最后一道是你。

**算出来的百分比不进记录表。** 70%、73% 是从 14/20、38/52 算的,不写进去,一个月后你自己也说不清。

**把个人项目包装成公司项目。** 一追问业务规模就穿帮,还会连累简历其他内容的可信度。

**被 import 的脚本没写 `if __name__ == "__main__":`。** import 时整个文件会执行一遍,练习 3 因此多调了一次模型。

## 学习资料

### 文档与文章

- [Laszlo Bock · My Personal Formula for a Winning Resume](https://www.linkedin.com/pulse/20140929001534-24454816-my-personal-formula-for-a-winning-resume)(LinkedIn,2014,需浏览器打开并可能要求登录):XYZ 公式的出处,文中「12% 的提升,从 100 到 112 不值一提,从 1000 万加 120 万就很可观」那个例子讲清了为什么要给基线,10 分钟。
- [Google Careers · How we hire](https://www.google.com/about/careers/applications/how-we-hire/):Google 官方的招聘流程说明,里面有简历建议,能看到「用数据说明影响」被写成了官方要求。
- [Tech Interview Handbook · Resume](https://www.techinterviewhandbook.org/resume/):「Experience」一节有大量改写前后的对比,和今天的三段式一一对得上,30 分钟。
- [DeepSeek · JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode):今天用的 `response_format={"type": "json_object"}`,注意文档里「提示词中必须包含 json 字样」的要求。
- [Python 文档 · 正则表达式指南](https://docs.python.org/zh-cn/3.12/howto/regex.html):「分组」一节讲了 `(?:...)` 非捕获组,和 `NUM` 那个正则对着看。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1pq4y147qv&autoplay=0&high_quality=1" title="简历工作经历、项目经历怎么写?万能STAR法则,小姐姐告诉你怎么用。" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>offer收割机XYZ · 简历工作经历、项目经历怎么写?万能STAR法则,小姐姐告诉你怎么用。 · 5 分钟,讲 STAR 法则怎么落到简历句子上,和今天的三段式对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DCDjBRExV&autoplay=0&high_quality=1" title="时隔六年,曝光一下我的最新简历!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员鱼皮 · 时隔六年,曝光一下我的最新简历! · 22 分钟,看一份真实的技术简历项目怎么取舍、每条写多长,不必照搬他的风格。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hubZ6WEfU&autoplay=0&high_quality=1" title="我的AI Agent面试复盘。纯是个人的分享和总结,未必准确,期待大家交流指正哈哈哈哈!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>假如今天可以躺平 · 我的AI Agent面试复盘 · 36 分钟,2026 年 8 月发布。看面试官围绕简历上的项目追问了什么,倒推你的每一条要点要准备到什么深度。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BYUy1yvjHxE" title="Create Your Resume for Google: Tips and Advice" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Life at Google · Create Your Resume for Google: Tips and Advice · Google 招聘团队官方频道讲简历,XYZ 写法有现场示范,写英文版时再看一遍。</figcaption>
</figure>

### 书籍

- Gergely Orosz《The Tech Resume Inside Out》(自出版,2020):书里有大量真实简历改写前后的对比,读讲「工作经历和项目怎么写」以及改写案例的章节,1.5 小时。
- Gayle Laakmann McDowell《Cracking the Coding Interview》(第 6 版,CareerCup,2015):以算法题出名,但开头几章讲了招聘方怎么看简历和「写成果而不是职责」,只读那几章,40 分钟。

### 开源项目与代码

- [AmruthPillai/Reactive-Resume](https://github.com/AmruthPillai/Reactive-Resume):开源的简历编辑器,可以自托管,导出的 PDF 链接可点击,Day 501 排版时会用到。
- [jsonresume/resume-schema](https://github.com/jsonresume/resume-schema):用 JSON 描述简历的开源格式。如果你想把记录表和要点放进版本管理,一份 `resume.json` 配今天的脚本就能自动检查。

## 自测

1. 一条好的项目要点由哪三部分组成?拿「基于 RAG 技术构建知识库问答,大幅提升了回答准确率」举例改写。

<details><summary>答案</summary>

做了什么具体的事、结果数字、口径。原句没有具体做法、没有数字、没有口径。改写示例:「帮助中心按小标题切块,向量检索与 BM25 混合;在 30 条检索测试集上 recall@5 从 xx% 到 xx%」,数字换成你记录表里的值。

</details>

2. `re.compile(r"\d+(?:\.\d+)?%?").findall("成功率 55% → 77.5%,40 条")` 返回什么?

<details><summary>答案</summary>

`['55%', '77.5%', '40']`。`(?:\.\d+)?` 是非捕获的可选小数部分,`%?` 是可选百分号;因为用了非捕获组,`findall` 返回整个匹配而不是括号里的部分。

</details>

3. 第四步里 `lint` 报了三条「没写口径」,但其实原文写了。这说明了什么?你该怎么做?

<details><summary>答案</summary>

说明检查器本身也会错,规则写窄了(只认「在 40 条」和「24 条用例」,不认「在 test 集 40 条上」)。检查器报的问题要先回原文核对,确认是被检查的东西错了还是检查器错了,再决定改哪边。

</details>

4. 四条要点全部通过了两个脚本,还可能有什么问题?举一个本文里的例子。

<details><summary>答案</summary>

意思层面的问题脚本查不出。例如第 1 条把「55% → 77.5%」接在「用 LangGraph 搭九个节点」后面,暗示提升来自搭图,而实际是迭代 4 轮带来的,数字是真的、因果是错的。还有五个节点名配「九个节点」这种计数矛盾。

</details>

5. (面试题)面试官指着你简历上的「端到端成功率 77.5%」问:「这个数怎么来的?」你怎么答?

<details><summary>答案</summary>

按口径讲:评测集 100 条,dev 60 条、test 40 条,用场景×说法生成后人工改过;一条工单要同时通过规则检查和 LLM 评审才算成功;LLM 评审和人工标注在 40 条上一致率 85%,所以评审本身可信;迭代 4 轮期间只看 dev,最后只跑了一次 test,40 条过了 31 条,就是 77.5%。基线是 55%。说完可以主动补一句局限:评测集是合成的,和真实流量有差距。

</details>

6. 为什么课程项目要标「个人项目」,而不是写成公司项目?

<details><summary>答案</summary>

一追问业务规模、团队、真实流量就会穿帮,一处不实会让对方怀疑简历其他内容。个人项目本身是被认可的,不少 JD 加分项里写着「个人项目或开源贡献均可」,关键是做得深、有数字、讲得清。

</details>

## 明天预告

Day 500 · 简历(三):工作经历换角度,年限学历门槛。项目经历写完了,简历上还有一大块是你原来的工作。明天把一个前端工程师的工作经历诚实地往 Agent 方向改写,写一个抓「职责升级」和「凭空多出来的技术词」的检查脚本,再用正则从 JD 里读出年限和学历门槛,判断哪些岗位该投、哪些该走内推。
