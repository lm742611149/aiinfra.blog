---
title: 'Day 542 · 设计文档(一):设计文档写什么'
description: '这两周的 harness、记忆、持久化执行和架构实验,真到工作里要变成一份评审会上能过的设计文档。今天讲设计文档的八节各回答什么问题,重点讲目标怎么写成能验证的、非目标为什么比目标还重要;写一个生成骨架的小脚本和一个粗查目标的小脚本,再让 DeepSeek 改写两句空话目标,亲眼看它怎么凭空编出一个 50%。'
pubDate: 2026-10-23
regime: none
tags: ['design-doc', 'senior', 'python', 'agent-zero']
series: 'agent-zero'
day: 542
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 541](/blog/agent-zero/day-541-orch-2/) 用五个维度分析了一个任务适合哪种架构,用 `silent_fail.py` 看到子 Agent 吞掉错误时主管会对客户说「已退款」,最后写了 `part10/arch_bench.py`,把五种架构放到 8 张分难度的工单上各跑 3 次。结论是退款类工单选混合第二版:pass^3 和单 Agent 一样是 100%,平均成本 0.0014 元对 0.0019 元,而且金额来自账务系统、发票经过代码核对。那一课最后还写了一句带「推翻条件」的结论。

从 [Day 532](/blog/agent-zero/day-532-memory-taxonomy/) 到昨天,你学了记忆、持久化执行、编排取舍,每一样都能单独讲。可真到了工作里,没人会让你「讲一讲日志重放」。你接到的任务会是:「我们要给五个团队做一个统一的 Agent 运行时,你出个方案。」交上去的东西就是一份设计文档。今天先讲它写什么,明天给一份完整的示范。

## 今天要解决的问题

学完今天你应该能做到:

1. 说出一份设计文档的八节,以及每一节要回答的那个问题。这是今天第一个新概念:**骨架**。
2. 把「提升开发效率」这种空话改写成能验证的目标(指标、阈值、怎么测三样齐全),并写出能挡住「顺便做一下」的非目标。这是第二个新概念:**目标和非目标**。
3. 跑通 `part10/doc_skeleton.py`,在 `agentops/docs/design/runtime.md` 生成一份带提示问题的空骨架;跑通 `part10/goal_check.py`,用规则粗查一批目标,并说出这种规则检查会漏掉什么、会放过什么。
4. 判断一件事值不值得写设计文档,值得的话写完整版还是一两页的迷你版。

预计用时 2 小时,一半在读和想,代码不多。实跑花费不到 1 分钱(算式在第三步)。前置:[Day 519](/blog/agent-zero/day-519-senior-map/)(第一份 ADR)、[Day 539](/blog/agent-zero/day-539-durable-4/)(四个持久化方案)、[Day 541](/blog/agent-zero/day-541-orch-2/)(对比实验和推翻条件)、[Day 37](/blog/agent-zero/day-037-pathlib/)(pathlib)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)(`LLMClient`)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写八节的名字和每节要回答的问题,再默写 `goal_check.py` 的 `check` 函数;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 设计文档是什么,你其实见过

先从前端那边找个熟悉的东西。React 和 Vue 都有一个叫 `rfcs` 的仓库,任何人想给框架加一个大功能(比如当年的 Hooks、Vue 3 的 Composition API),要先在这里提一份文档,社区讨论、核心团队拍板,然后才动代码。RFC 是 Request for Comments 的缩写,字面意思是「请大家提意见」。

你打开 React 的 RFC 模板,会看到这几个标题:Summary、Basic example、Motivation、Detailed design、Drawbacks、Alternatives、Adoption strategy、How we teach this、Unresolved questions。Vue 的模板几乎一样,少了 How we teach this。这就是一份设计文档的骨架,只是名字不同。公司里叫它设计文档(design doc)、技术方案、RFC,指的是同一种东西:**动手写代码之前,写下打算怎么做、为什么这么做、放弃了什么,让别人在改动还便宜的时候挑毛病。**

为什么要在写代码之前?Google 工程师 Malte Ubl 在《Design Docs at Google》里讲得很直接:设计文档的核心价值是在改动还便宜的时候发现问题,顺带在组织里形成共识、留下决策的历史。代码写完再发现方向错了,改起来的代价是设计阶段的很多倍。你做前端应该有体会:组件 API 定下来、十几个页面都在用了,再想把 `onChange` 的参数从值改成事件对象,得改十几处;如果在写第一行代码之前有人看一眼说「这里应该和原生 input 对齐」,只要改一句话。

资深和中级在产出上最明显的差别之一,就是前者大量时间花在写这种文档上。一份好的设计文档能让评审的人半小时内看懂你要做什么、放弃了什么、风险在哪。[Day 518](/blog/agent-zero/day-518-senior-gap/) 讲资深岗贵在哪时说过,资深要的是落地、架构、平台、稳定性。这四样东西在动手之前的样子,就是设计文档。

## 八节骨架,每节回答一个问题

我把一份设计文档拆成八节。顺序有讲究:前三节讲「为什么做、做成什么样」,中间三节讲「怎么做、为什么不那样做」,最后两节讲「哪里可能出错、怎么证明做对了」。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="设计文档八节骨架,分成为什么、怎么做、怎么证明三组">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-faint)">为什么做、做成什么样</text>
<rect x="20" y="40" width="190" height="40" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="58" fill="var(--ink)">1 背景</text>
<text x="32" y="73" fill="var(--ink-soft)" font-size="11">为什么现在要做</text>
<rect x="20" y="90" width="190" height="40" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="108" fill="var(--ink)">2 目标</text>
<text x="32" y="123" fill="var(--ink-soft)" font-size="11">哪个数变成多少</text>
<rect x="20" y="140" width="190" height="40" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="158" fill="var(--ink)">3 非目标</text>
<text x="32" y="173" fill="var(--ink-soft)" font-size="11">听着相关但不做</text>
<text x="225" y="28" fill="var(--ink-faint)">怎么做、为什么不那样做</text>
<rect x="225" y="40" width="190" height="40" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="237" y="58" fill="var(--ink)">4 方案</text>
<text x="237" y="73" fill="var(--ink-soft)" font-size="11">接口、数据流、默认策略</text>
<rect x="225" y="90" width="190" height="40" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="237" y="108" fill="var(--ink)">5 被放弃的方案</text>
<text x="237" y="123" fill="var(--ink-soft)" font-size="11">好在哪、为何没选</text>
<rect x="225" y="140" width="190" height="40" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="237" y="158" fill="var(--ink)">6 横切关注点</text>
<text x="237" y="173" fill="var(--ink-soft)" font-size="11">安全 隐私 成本 观测</text>
<text x="430" y="28" fill="var(--ink-faint)">哪里会错、怎么证明</text>
<rect x="430" y="40" width="190" height="40" rx="5" fill="var(--paper)" stroke="var(--rule)"/>
<text x="442" y="58" fill="var(--ink)">7 风险与未决问题</text>
<text x="442" y="73" fill="var(--ink-soft)" font-size="11">没把握的地方怎么验</text>
<rect x="430" y="90" width="190" height="40" rx="5" fill="var(--paper)" stroke="var(--rule)"/>
<text x="442" y="108" fill="var(--ink)">8 评测与上线</text>
<text x="442" y="123" fill="var(--ink-soft)" font-size="11">怎么证明、怎么回滚</text>
<line x1="115" y1="190" x2="115" y2="220" stroke="var(--rule)"/>
<line x1="320" y1="190" x2="320" y2="220" stroke="var(--rule)"/>
<line x1="525" y1="140" x2="525" y2="220" stroke="var(--rule)"/>
<line x1="115" y1="220" x2="525" y2="220" stroke="var(--rule)"/>
<text x="20" y="250" fill="var(--ink-soft)">目标里的每个数字,第 8 节都要说怎么测出来;</text>
<text x="20" y="272" fill="var(--ink-soft)">第 5 节的每个方案,都要写「什么条件下重新考虑」;</text>
<text x="20" y="294" fill="var(--ink-soft)">第 7 节没写东西,评审人会默认你没想过。</text>
</g>
</svg>
<figcaption>八节分三组。React RFC 模板里的 Motivation 约等于背景,Detailed design 是方案,Alternatives 是被放弃的方案,Drawbacks 和 Unresolved questions 落在风险,Adoption strategy 落在上线。它没有单列「目标/非目标」,而这正是公司里的设计文档最看重的一节。</figcaption>
</figure>

下面一节一节说,每节都配一个 AgentOps 运行时的例子,明天的完整示范就是把这些例子拼起来。

**背景。** 回答「现在是什么情况,为什么现在要做」。写给不了解上下文的评审人看,三五段就够。常见的错误是写成需求文档,洋洋洒洒列一堆功能点。背景只写和决策有关的事实:云簿已经有一个上线的 SupportPilot,销售、财务、研发三个团队下季度各做一个 Agent;SupportPilot 的循环、审批、记忆都是给它自己写的,别人拿不走;各写一套的话会有五套互不兼容的实现,审计和成本没法统一。最后一句很关键,它说的是「不做会怎样」。

**目标。** 回答「做成以后,哪几个数字会变成多少,怎么测」。这一节下面单独讲。

**非目标。** 回答「哪些事听起来相关,但这次明确不做」。也下面单独讲。

**方案。** 回答「系统长什么样」:一张架构图、关键接口、数据怎么流、默认策略。重点写**设计决定**,不写实现细节。评审人关心的是「为什么用日志重放而不是定期快照」,不是函数叫什么名字。接口写到函数签名这一层就够了,不要贴整段代码。

**被放弃的方案。** 回答「认真考虑过哪几种做法,各自好在哪,为什么没选,什么条件下会重新考虑」。这一节最能看出资深程度。[Day 539](/blog/agent-zero/day-539-durable-4/) 那四个持久化方案(Temporal、Restate、DBOS、LangGraph checkpoint)就是现成的素材:你最后选了一个,另外三个就要在这里写清楚。每个都要先写优点,不写优点的备选方案叫「稻草人」,是专门搭起来让自己打倒的,评审人一眼就能看出来。明天的示范会写满四个。

**横切关注点。** 回答「安全、隐私、成本、可观测各考虑了什么」。「横切」的意思是这些问题不属于哪一个模块,而是贯穿整个系统,就像前端的国际化和无障碍,每个组件都要管。不一定每项都长,但每项至少一句,证明你想过。比如隐私:[Day 534](/blog/agent-zero/day-534-memory-build/) 实测模型会把卡号、身份证号原样抽出来,所以记忆层必须拒写敏感字段。

**风险与未决问题。** 回答「哪里我自己也没把握,打算怎么验证」。很多人觉得写这个显得自己不专业,其实正相反。评审人最怕的是作者假装一切都想清楚了。[Day 541](/blog/agent-zero/day-541-orch-2/) 那句「代码核对一次都没有驳回过模型,这张安全网还没被证明接住过什么」,就是一条很好的风险。

**评测与上线。** 回答「怎么证明它有效,分几步上线,出了问题怎么回滚」。Agent 系统的设计文档比普通后端多一层难处:同一个方案换个模型、换一批数据,效果能差很多,所以「怎么证明」必须写到用哪个评测集、跑几次、看哪几个数。回滚写成能直接执行的句子,比如「旧循环代码保留一个月,配置开关切换」。

文档开头还有一行元信息:作者、评审人、状态、日期。评审人写具体人名,不写「平台组」。写组名等于没人负责看,这个坑我真踩过,文档挂了两周没人评,因为每个人都以为别人会看。

## 第一步:用脚本生成骨架

骨架记住了,每次新写一份还要手敲八个标题和提示,不如写个小脚本生成。顺便练一下 [Day 37](/blog/agent-zero/day-037-pathlib/) 的 pathlib 和「不覆盖已有文件」这个好习惯。

这是今天第一次用到 `agentops/` 这个目录。它在 `agent-zero-lab` 根目录下,和 `part10/` 平级,放 AgentOps 平台相关的文档;代码要到 [Day 625](/blog/agent-zero/day-625-agentops-kickoff-2/) 才正式开仓库,文档先行本来就是设计文档的意思。

```python
# agent-zero-lab/part10/doc_skeleton.py
"""生成一份设计文档骨架:八节,每节下面写着这一节要回答的问题。"""
import sys
from datetime import date
from pathlib import Path

SECTIONS = [
    ("背景", "现在是什么情况?为什么现在要做?(写给不了解项目的评审人,三五段)"),
    ("目标", "做成以后,哪几个数字会变成多少?怎么测?"),
    ("非目标", "哪些事听起来相关,但这次明确不做?"),
    ("方案", "系统长什么样?关键接口、数据怎么流、默认策略是什么?"),
    ("被放弃的方案", "认真考虑过哪两三个做法?各自好在哪,为什么没选,什么条件下重新考虑?"),
    ("横切关注点", "安全、隐私、成本、可观测各考虑了什么?(每项至少一句)"),
    ("风险与未决问题", "哪里自己也没把握?打算怎么验证?"),
    ("评测与上线", "怎么证明它有效?分几步上线?出问题怎么回滚?"),
]


def render(title: str, author: str) -> str:
    lines = [f"# {title}", ""]
    lines.append(f"作者:{author} · 评审人:(写具体人名) · 状态:草稿 · {date.today()}")
    lines.append("")
    for i, (name, question) in enumerate(SECTIONS, start=1):
        lines.append(f"## {i}. {name}")
        lines.append("")
        lines.append(f"<!-- 回答:{question} -->")
        lines.append("")
    return "\n".join(lines)


def main(path: str) -> None:
    out = Path(path)
    if out.exists():
        raise SystemExit(f"{out} 已经存在,不覆盖。要重来先自己删掉它。")
    out.parent.mkdir(parents=True, exist_ok=True)
    text = render("AgentOps 运行时设计文档", "你")
    out.write_text(text, encoding="utf-8")
    print(f"已生成 {out}:{len(SECTIONS)} 节,{len(text)} 个字符")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "agentops/docs/design/runtime.md")
```

<div class="line-notes">

- `import sys` 标准库,今天只用它的 `sys.argv` 读命令行参数,相当于 Node 的 `process.argv`。
- `from datetime import date` 只要日期不要时间,`date.today()` 返回 `2026-10-23` 这样的对象,放进 f-string 会自动变成字符串。
- `from pathlib import Path` [Day 37](/blog/agent-zero/day-037-pathlib/) 学过的路径对象,拼路径、判断存在、建目录、写文件都在它身上。
- `SECTIONS = [` 一个列表,每个元素是一个二元组 `(节名, 这节要回答的问题)`。相当于 JS 里 `[["背景", "..."], ...]` 这样的数组的数组。把骨架写成数据而不是写死在字符串里,以后加一节或改提示只改这里。
- `("背景", "现在是什么情况?` 第一节。提示问题写成问句,写文档的人对着问句答,比对着「背景」两个字发呆容易得多。
- `("横切关注点"` 第六节,括号里「每项至少一句」是给写的人的最低要求。
- `def render(title: str, author: str) -> str:` 只负责拼字符串,不碰文件。拼和写分开,测试时不用真的写盘。
- `lines = [f"# {title}", ""]` 先放一级标题和一个空行。最后用 `"\n".join(lines)` 把列表接成一整段,和 JS 的 `lines.join("\n")` 一样。
- `作者:{author} · 评审人:(写具体人名)` 元信息行。「写具体人名」直接写进模板,就是为了防止上面说的「写组名没人看」。
- `for i, (name, question) in enumerate(SECTIONS, start=1):` `enumerate` 边遍历边给编号,`start=1` 让编号从 1 开始(默认是 0)。`(name, question)` 把每个二元组拆成两个变量,相当于 JS 的 `for (const [i, [name, question]] of SECTIONS.entries())`,只是 JS 的编号从 0 开始。
- `lines.append(f"## {i}. {name}")` 二级标题,实跑生成 `## 1. 背景` 到 `## 8. 评测与上线`。
- `lines.append(f"<!-- 回答:{question} -->")` 提示写成 HTML 注释。Markdown 渲染时注释不显示,所以忘了删也不会出现在正式文档里;在编辑器里写的人看得到。
- `out = Path(path)` 把字符串路径变成 Path 对象。
- `if out.exists():` 文件已经在就不写。设计文档写了半天,一个脚本手滑覆盖掉,那是真疼。
- `raise SystemExit(f"{out} 已经存在,不覆盖。` `SystemExit` 是一种特殊的异常,抛出来程序就带着这句话退出,退出码是 1(非 0 表示失败)。比 `print` 加 `return` 好的地方是,shell 和 CI 能从退出码知道它失败了。
- `out.parent.mkdir(parents=True, exist_ok=True)` `out.parent` 是 `agentops/docs/design`;`parents=True` 中间缺的目录一起建,`exist_ok=True` 已经有了也不报错,相当于 `mkdir -p`。
- `out.write_text(text, encoding="utf-8")` 写文件。中文一定写明 `utf-8`,不写的话在某些系统上会用别的编码。
- `print(f"已生成 {out}:{len(SECTIONS)} 节,{len(text)} 个字符")` 实跑打印 8 节、463 个字符。`len` 数的是字符数,中文一个字算 1。
- `main(sys.argv[1] if len(sys.argv) > 1 else "agentops/docs/design/runtime.md")` 命令行给了路径就用给的,没给就用默认路径。`a if 条件 else b` 是 Python 的三元表达式,相当于 JS 的 `条件 ? a : b`,注意顺序不一样。

</div>

在 `agent-zero-lab` 根目录跑两次:

```bash
cd ~/agent-zero-lab
uv run python -m part10.doc_skeleton
uv run python -m part10.doc_skeleton; echo "exit=$?"
```

```text
已生成 agentops/docs/design/runtime.md:8 节,463 个字符
agentops/docs/design/runtime.md 已经存在,不覆盖。要重来先自己删掉它。
exit=1
```

第二次被拦住了,退出码是 1。`echo "exit=$?"` 里的 `$?` 是 shell 的一个特殊变量,存着上一条命令的退出码:0 表示成功,非 0 表示失败。CI 判断一步过没过,看的就是它。看一眼生成的文件:

```bash
cat agentops/docs/design/runtime.md
```

```text
# AgentOps 运行时设计文档

作者:你 · 评审人:(写具体人名) · 状态:草稿 · 2026-10-23

## 1. 背景

<!-- 回答:现在是什么情况?为什么现在要做?(写给不了解项目的评审人,三五段) -->

## 2. 目标

<!-- 回答:做成以后,哪几个数字会变成多少?怎么测? -->

## 3. 非目标

<!-- 回答:哪些事听起来相关,但这次明确不做? -->

## 4. 方案

<!-- 回答:系统长什么样?关键接口、数据怎么流、默认策略是什么? -->

## 5. 被放弃的方案

<!-- 回答:认真考虑过哪两三个做法?各自好在哪,为什么没选,什么条件下重新考虑? -->

## 6. 横切关注点

<!-- 回答:安全、隐私、成本、可观测各考虑了什么?(每项至少一句) -->

## 7. 风险与未决问题

<!-- 回答:哪里自己也没把握?打算怎么验证? -->

## 8. 评测与上线

<!-- 回答:怎么证明它有效?分几步上线?出问题怎么回滚? -->
```

这份空骨架今天先放着,明天往里填。小结一下:骨架不是格式要求,是一张问题清单。每节下面那个问题答不上来,说明那块还没想清楚,比写出来再被评审问倒好得多。

## 目标:指标、阈值、怎么测,三样齐全

先看两句我在真实的方案里见过很多次的目标:「提升开发效率」「让系统更稳定」。它们的问题不是不对,而是**没法判断做到了没有**。三个月后项目上线,你说效率提升了,有人说没感觉,谁对?没人知道。

一条能验证的目标要有三样东西:

- **指标**:看哪个数。接入耗时、成功率、单张工单成本、P95 延迟。
- **阈值和方向**:多少算达标,是「不超过」还是「不低于」。
- **怎么测**:用哪个脚本、哪个数据集、在什么条件下测。

拿 AgentOps 运行时举例,把「提升开发效率」改成:

> G1:新团队基于运行时接入一个带工具和审批的 Agent,不超过 2 人日。(预期;财务 Agent 组接入时实测)

指标是接入耗时,阈值是不超过 2 人日,怎么测是「财务 Agent 组接入时实测」。括号里「预期」两个字也有讲究:这个数是拍的,不是测出来的,要老实标出来。「人日」是工作量单位,一个人干一天算 1 人日。

再把「让运行时更稳定」改成:

> G2:进程在任意一步被杀掉后恢复,结果与不被杀一致,有副作用的工具重复执行 0 次。(验证方法:part10/test_durable_runner.py 的崩溃注入测试)

这条的阈值是「0 次」,怎么测直接指向 [Day 537](/blog/agent-zero/day-537-durable-3/) 写过的测试。「稳定」这个词被拆成了一个能跑出红绿的东西。

还有一种目标很容易写歪:**数字有了,但数字是编的**。比如「单张工单成本降低 30%」,30% 从哪来?如果没有基线(现在是多少)也没有依据(凭什么能降这么多),它和「降低成本」一样是空话,只是看起来更专业。好的写法是把数字的出处写上:

> G4:单张平均成本不超过 0.00147 元。(实测基线 0.0014 元 × 1.05,来自 arch_bench.py)

0.0014 是 [Day 541](/blog/agent-zero/day-541-orch-2/) 混合第二版实测的平均成本,允许迁移后上浮 5%。数字有来源,评审人可以去复查。

## 第二步:写个小脚本,粗查目标

道理讲完,写个脚本把最明显的空话筛出来。规则很粗:没有数字的不行,没有比较方向(不超过、不低于……)的不行,同时还带着「提升」「优化」这类词的,点名是空话。这里用到 Python 的正则模块 `re`,和 JS 的正则是一回事,`re.search(r"\d", s)` 相当于 `/\d/.test(s)`。

```python
# agent-zero-lab/part10/goal_check.py
"""粗查一条目标能不能验证:有没有数字、有没有比较方向、有没有空话。"""
import re

VAGUE = ("提升", "优化", "更好", "更稳定", "友好", "高效", "尽量")
COMPARE = ("不超过", "不低于", "以内", "以上", "≤", ">=", "<=", "≥", "不下降", "不上升")


def check(goal: str) -> list[str]:
    problems = []
    if not re.search(r"\d", goal):
        problems.append("没有数字")
    if not any(w in goal for w in COMPARE):
        problems.append("没有比较方向(不超过/不低于…)")
    hits = [w for w in VAGUE if w in goal]
    if hits and problems:
        problems.append(f"空话:{'、'.join(hits)}")
    return problems


GOALS = [
    "提升开发效率",
    "让运行时更稳定",
    "新团队接入一个带工具和审批的 Agent,不超过 2 人日",
    "进程重启后 100 次故障注入里,重复退款 0 笔,恢复后结果与不重启一致",
    "退款工单单张平均成本不超过 0.002 元(arch_bench.py,8 张×3 次)",
    "用户体验提升 100% 以上",
]

if __name__ == "__main__":
    for g in GOALS:
        p = check(g)
        print(("通过 " if not p else "不通过") + f" | {g}" + ("" if not p else f"\n         └ {';'.join(p)}"))
```

<div class="line-notes">

- `import re` 正则表达式模块。
- `VAGUE = ("提升", "优化",` 空话词表,用元组(圆括号)是因为它不会变,[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 讲过元组。
- `COMPARE = ("不超过", "不低于", "以内"` 表示比较方向的词。注意这张表**故意没写全**,下面实跑会撞上。
- `def check(goal: str) -> list[str]:` 返回问题列表,空列表表示通过。返回「问题清单」而不是 `True/False`,打印时能告诉人具体哪里不行。
- `if not re.search(r"\d", goal):` `\d` 匹配一个数字字符,`re.search` 在字符串任意位置找,找不到返回 `None`,`not None` 是 `True`。字符串前面的 `r` 表示原样字符串,反斜杠不转义,写正则时总是加上。
- `if not any(w in goal for w in COMPARE):` `any(...)` 只要有一个为真就是真,相当于 JS 的 `COMPARE.some(w => goal.includes(w))`。`w in goal` 判断子串,相当于 `goal.includes(w)`。
- `hits = [w for w in VAGUE if w in goal]` 列表推导式,挑出目标里出现的空话词,相当于 `VAGUE.filter(w => goal.includes(w))`。
- `if hits and problems:` 只有「已经有问题」时才点名空话。「成功率提升到不低于 90%」里也有「提升」,但它有数字有方向,不该被骂。
- `problems.append(f"空话:{'、'.join(hits)}")` 用顿号把命中的词接起来。f-string 里面再用引号,要和外面的引号不同,外面双引号里面就用单引号。
- `GOALS = [` 六条样例:两条空话、三条我认为能验证的、一条故意埋的雷。
- `"用户体验提升 100% 以上",` 这条是雷:有数字、有「以上」,可「用户体验」怎么量?没说。
- `print(("通过 " if not p else "不通过")` 通过和不通过对齐打印;不通过时换行加一个 `└` 把原因列在下面。

</div>

```bash
uv run python -m part10.goal_check
```

```text
不通过 | 提升开发效率
         └ 没有数字;没有比较方向(不超过/不低于…);空话:提升
不通过 | 让运行时更稳定
         └ 没有数字;没有比较方向(不超过/不低于…);空话:更稳定
通过  | 新团队接入一个带工具和审批的 Agent,不超过 2 人日
不通过 | 进程重启后 100 次故障注入里,重复退款 0 笔,恢复后结果与不重启一致
         └ 没有比较方向(不超过/不低于…)
通过  | 退款工单单张平均成本不超过 0.002 元(arch_bench.py,8 张×3 次)
通过  | 用户体验提升 100% 以上
```

两句空话被拦住了,这是规则该做的。但仔细看,它犯了两个错,方向正好相反。

**冤枉了一条好目标。** 「重复退款 0 笔」明明是最硬的一种阈值,只因为没出现「不超过」这几个字,被判成「没有比较方向」。这叫漏报的反面,误报:好的被当成坏的。

**放过了一条坏目标。** 「用户体验提升 100% 以上」有数字、有「以上」,规则全过。可用户体验拿什么量?100% 相对谁?它恰好是上一节说的「数字有了但是编的」。

这就是规则检查的天花板:它只能看字面,看不懂意思。我的用法是把它当作第一道筛子,把明显的空话挡在评审之前,省得评审人花时间骂这种低级问题;真正判断一条目标能不能验证,还是要人对着「指标、阈值、怎么测」三样逐条看。练习 1 会补词表修掉第一个错,第二个错规则修不了。

## 第三步:让模型改写空话,看它的数字从哪来

规则看不懂意思,那让模型来改写呢?很多人写设计文档已经这么干了。试一下,用 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 封装的 `LLMClient`(`common/llm.py`),把两句空话交给 DeepSeek,让它改成可验证的目标,再用刚才的规则查一遍。

```python
# agent-zero-lab/part10/goal_rewrite.py
"""让模型把两条空话目标改写成可验证的目标,然后看它的数字从哪来。"""
from common.llm import LLMClient
from part10.goal_check import check

VAGUE_GOALS = ["提升开发效率", "让运行时更稳定"]
CONTEXT = "我们要给公司五个团队做一个统一的 Agent 运行时(AgentOps),现在每个团队各写一套循环。"

llm = LLMClient()
for goal in VAGUE_GOALS:
    r = llm.chat(
        [
            {"role": "system", "content": "你是资深工程师。把用户给的设计文档目标改写成一条可验证的目标,只输出改写后的那一句。"},
            {"role": "user", "content": f"背景:{CONTEXT}\n目标:{goal}"},
        ],
        temperature=0,
    )
    new = r.content.strip()
    print(f"原句:{goal}\n改写:{new}\n规则检查:{check(new) or '通过'}\n")
print(llm.ledger)
```

<div class="line-notes">

- `from common.llm import LLMClient` Day 135 建的客户端,读 `agent-zero-lab/.env` 里的 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`,每次调用自动记账。
- `from part10.goal_check import check` 直接复用上一步的规则。这就是为什么 `goal_check.py` 把打印放在 `if __name__ == "__main__":` 下面:被 import 时不会把六条样例打一遍。
- `CONTEXT = "我们要给公司五个团队` 只给模型一句背景,和真实情况一样:它不知道你们现在接入要几天、出过几次故障。
- `llm = LLMClient()` 不传参数就读当前目录的 `.env`。所以要在仓库根目录跑。
- `{"role": "system", "content": "你是资深工程师。` 系统提示词限制输出格式,方便直接打印。
- `temperature=0,` 温度设 0,让输出尽量稳定,方便你复现和我对照。[Day 110](/blog/agent-zero/day-110-sampling-1/) 讲过温度。
- `new = r.content.strip()` `r` 是 `ChatResult`,`.content` 是正文;`.strip()` 去掉首尾空白,相当于 JS 的 `trim()`。
- `规则检查:{check(new) or '通过'}` `check` 返回空列表时 `[] or '通过'` 得到 `'通过'`,因为空列表在 Python 里算假,和 JS 里空数组算真不一样,这是个容易踩的坑。
- `print(llm.ledger)` 打印这次一共调了几次、多少 token、多少钱。

</div>

```bash
uv run python -m part10.goal_rewrite
```

```text
原句:提升开发效率
改写:将五个团队各自实现的 Agent 循环统一为一个共享的 Agent 运行时（AgentOps），使新 Agent 的接入只需配置而无需重写循环逻辑，并将接入耗时从当前各团队独立实现的基线降低至少 50%。
规则检查:['没有比较方向(不超过/不低于…)']

原句:让运行时更稳定
改写:将五个团队各自实现的 Agent 循环统一迁移到同一 Agent 运行时后，运行时在连续 30 天生产运行中的非计划中断次数较迁移前基线下降至少 50%。
规则检查:['没有比较方向(不超过/不低于…)']

2 次调用 | 输入 117 / 输出 89 tokens | 约 ¥0.0009
```

花费按 `.env` 里的 DeepSeek 高峰价算(2026 年 10 月查官网:`deepseek-flash` 缓存未命中输入 2 元、输出 8 元,每百万 token):117 × 2 / 1000000 + 89 × 8 / 1000000 ≈ 0.0009 元。我实际是在空闲时段跑的,真实扣费是这个的一半。

先说规则检查:两句都写了「至少」,而我的词表里没有「至少」,规则又冤枉人了。这个练习 1 一起修。

再说更要紧的事。读改写后的句子,格式确实像样了:有指标(接入耗时、非计划中断次数)、有方向(降低、下降)、有阈值(至少 50%)、甚至有时间窗口(连续 30 天)。可你问自己三个问题:

1. 「当前各团队独立实现的基线」是多少?没人测过。
2. 50% 从哪来?模型两句都给了 50%,这是一个听起来合理的整数,不是任何数据算出来的。
3. 「非计划中断次数」现在一个月几次?如果现在每月 0 次,降 50% 还是 0 次,这条目标天生就达成了。

这就是我想让你亲眼看到的:**模型能把句子改得像一条好目标,但数字只能来自你的数据。**它没有你们团队的接入记录,没有你们的故障统计,它只能编。编出来的数字写进设计文档,评审时被问「50% 怎么来的」,你答不上来,整份文档的可信度就塌了。

我的用法是让模型帮我把格式理顺、帮我想「还可以用哪个指标」,然后数字一律自己填,填不出就老实写「先测基线,两周后补」。改写后的 G1 应该长这样:「新团队接入不超过 2 人日(预期);上线前先测 SupportPilot 组从零接入的耗时作为基线。」

## 非目标:提前拒绝掉的范围

非目标回答「哪些事听起来相关,但这次明确不做」。它常常比目标更能体现水平,原因是评审会上一半的争论都长这样:

> 「既然要做统一运行时了,为什么不顺便把模型网关也做了?」
> 「为什么不顺便做个拖拽界面,让业务方自己配 Agent?」

如果文档里没写,你只能当场解释,解释得不好,范围就被加进来了。项目越做越大,工期越拖越长,这叫**范围蔓延**。非目标就是提前把这些「顺便」挡掉,而且是白纸黑字、评审时大家都同意过的。

AgentOps 运行时的非目标可以这么写:

- 不做可视化拖拽编排,业务方用代码定义 Agent。
- 不做模型网关,运行时通过接口调用网关(网关另有设计文档)。
- 不支持跨租户共享记忆。
- 本期不内置多 Agent 编排,只提供调用子 Agent 的基础能力。依据:arch_bench 实验里多 Agent 成功率没有更高,成本是 4.4 倍。

注意第二条和第四条的写法:不只说「不做」,还说了「去哪做」或「为什么不做」。「网关另有设计文档」把话题引走,评审时不会在这里展开;「依据 arch_bench」让人知道这不是拍脑袋。

还有一个 Ubl 文章里专门提醒的坑:**非目标不是把目标反过来写**。「系统不应该崩溃」不是非目标,因为没有人会想让系统崩溃,它不是一件「听起来该做但这次不做」的事。真正的非目标都是合理的、有人会想要的东西,只是这次放弃了。Ubl 举的例子是数据库系统把「ACID 兼容」列为非目标,这是一件很多人会默认要的东西,写出来才有意义。ACID 是数据库事务的四个保证(原子性、一致性、隔离性、持久性),[Day 91](/blog/agent-zero/day-091-sql-6/) 讲事务时给过直觉,这里只要知道它是「大家默认会要」的东西就行。

判断一条非目标写得好不好,我用一个问题:**评审会上会不会真有人提这件事?**会,就值得写;不会,删掉。

## 哪些事不值得写设计文档

不是什么都要写。写一份完整的设计文档要两三天,评审又是一两周,小改动这么干就是官僚。Ubl 给了三种不值得写的情况,我加上自己的理解:

**问题本身没有歧义。** 只有一种合理做法的事,写文档只是在记录显而易见的东西,直接提 MR(合并请求)就行。

**写出来是一份「实现手册」。** 如果你写着写着发现文档里全是「第一步建表、第二步写接口」,没有任何取舍和被放弃的方案,说明这件事不需要设计,直接写代码。

**原型阶段,快速迭代更重要。** 还在试「这个方向行不行」的时候,先做个原型跑一下。但跑出结论后要上线,就该补文档了。

反过来,下面这些情况我一定写:预计超过两周工作量;影响两个以上团队;改了以后很难回退(数据格式、对外接口、计费逻辑);会改变 Agent 的模型、工具权限或用户看得到的行为。最后一条是 Agent 项目特有的:换个模型看起来只是改一行配置,实际上相当于换了一个员工。

规模在两者之间的,写**迷你设计文档**:一到三页,同样的思路,写得更紧凑,只留背景、目标和非目标、方案、被放弃的方案、风险五节。比如「退款金额改从账务系统重新取,不用模型给的值」这种改动,一页就够了,但「为什么不信模型给的金额」这个决定值得留下来,练习 3 会生成这样一份骨架。

长度上,Ubl 说大项目的设计文档十到二十页左右比较合适。AgentOps 运行时这个规模,我会写五到八页,超过十页就拆成主文档加附录。

## 写完不是结束

最后说一个经常被忽视的事:**设计文档不是写完就扔的。**实现过程中做了和文档不一样的决定,要回去更新文档,或者单独写一份 ADR 记录这个变化。[Day 519](/blog/agent-zero/day-519-senior-map/) 写第一份 ADR 时说过,ADR 只记一个决定,只追加不修改;设计文档讲整体方案。两者的关系明天细讲,还会给 AgentOps 运行时写两份 ADR。

半年后新同事问「为什么这里不用 Temporal」,最好的回答是丢给他一个链接。文档和系统对不上的时候,比没有文档还误导人,因为大家会相信它。

## 动手练习

**练习 1:修掉规则的误报。** 实跑里 `goal_check.py` 冤枉了两类好目标:「至少 50%」这种写法,和「重复退款 0 笔」这种零阈值。新建 `part10/ex542_goal_check2.py`,补上「至少、至多、低于、高于」,并把「0 笔 / 0 次 / 0 条 / 0 个」也算作有阈值。再加两条样例:「接入耗时从当前基线降低至少 50%」和「P95 延迟 0.5 秒」,跑一遍,说说哪条规则还是过不了、为什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex542_goal_check2.py
"""练习 1:补上「至少/至多/低于/高于」,并把「0 笔 / 0 次」也算作阈值。"""
import re

from part10.goal_check import GOALS, VAGUE

COMPARE = ("不超过", "不低于", "以内", "以上", "≤", ">=", "<=", "≥", "不下降", "不上升",
           "至少", "至多", "低于", "高于")
ZERO = re.compile(r"(?<![\d.])0 ?(笔|次|条|个)")


def check(goal: str) -> list[str]:
    problems = []
    if not re.search(r"\d", goal):
        problems.append("没有数字")
    if not any(w in goal for w in COMPARE) and not ZERO.search(goal):
        problems.append("没有比较方向")
    hits = [w for w in VAGUE if w in goal]
    if hits and problems:
        problems.append(f"空话:{'、'.join(hits)}")
    return problems


EXTRA = [
    "接入耗时从当前基线降低至少 50%",
    "P95 延迟 0.5 秒",
]

if __name__ == "__main__":
    for g in GOALS + EXTRA:
        p = check(g)
        print(("通过  " if not p else "不通过") + f" | {g}" + (f"  ← {';'.join(p)}" if p else ""))
```

<div class="line-notes">

- `from part10.goal_check import GOALS, VAGUE` 样例和空话词表直接复用,只重写 `COMPARE` 和 `check`。
- `"至少", "至多", "低于", "高于")` 补上的四个词。
- `ZERO = re.compile(r"(?<![\d.])0 ?(笔|次|条|个)")` 匹配「0 笔」「0次」这种零阈值。`re.compile` 先把正则编译好,反复用时快一点,相当于 JS 里先写好 `const ZERO = /.../`。`(?<![\d.])` 叫「后顾否定」:要求 0 前面不是数字也不是小数点,这样「100 次」里的 0 和「0.5 秒」不会被误当成零阈值。` ?` 表示空格可有可无。`(笔|次|条|个)` 四选一。
- `if not any(w in goal for w in COMPARE) and not ZERO.search(goal):` 两种都没有才算缺方向。
- `EXTRA = [` 两条新样例:第一条是模型改写出来的句式,第二条有数字没方向。
- `for g in GOALS + EXTRA:` 两个列表用 `+` 拼起来,相当于 JS 的 `[...GOALS, ...EXTRA]`。

</div>

```bash
uv run python -m part10.ex542_goal_check2
```

```text
不通过 | 提升开发效率  ← 没有数字;没有比较方向;空话:提升
不通过 | 让运行时更稳定  ← 没有数字;没有比较方向;空话:更稳定
通过   | 新团队接入一个带工具和审批的 Agent,不超过 2 人日
通过   | 进程重启后 100 次故障注入里,重复退款 0 笔,恢复后结果与不重启一致
通过   | 退款工单单张平均成本不超过 0.002 元(arch_bench.py,8 张×3 次)
通过   | 用户体验提升 100% 以上
通过   | 接入耗时从当前基线降低至少 50%
不通过 | P95 延迟 0.5 秒  ← 没有比较方向
```

「0 笔」那条和「至少 50%」那条都过了。「P95 延迟 0.5 秒」被拦是对的:0.5 秒是上限还是下限?写成「不超过 0.5 秒」才完整。

还是过不了的(或者说过得不该过的)是两条:「用户体验提升 100% 以上」和「降低至少 50%」。前者指标量不了,后者基线不存在、50% 没出处。这两类问题是语义问题,规则看字面永远查不出来,只能靠人问「这个数怎么来的」。所以规则修得再好,也只是第一道筛子。

</details>

**练习 2:给 AgentOps 运行时写非目标。** 不看正文,自己写四条非目标,每条都要满足:评审时真会有人提;写了「去哪做」或「为什么不做」。再故意写一条「把目标反过来」的假非目标,说说它为什么不算。

<details><summary>参考答案</summary>

一个示范(你的版本可以不同,标准是上面两条):

- 不做模型网关,运行时通过接口调用网关。网关的限流、计费、多供应商切换另有设计文档。(评审时平台组一定会问「为什么不顺便做」)
- 不做可视化拖拽编排,业务方用代码定义 Agent。拖拽界面是另一类产品,用户是不写代码的人,这期的用户都是工程师。
- 本期不内置多 Agent 编排,只提供调用子 Agent 的基础能力。依据:Day 541 实验,多 Agent 成功率没有更高,平均成本是单 Agent 的 4.4 倍。
- 不迁移研发组现有的 LangGraph 流程。他们可以在运行时之上继续用 LangGraph,迁移收益要等运行时稳定后再评估。

假非目标:「运行时不应丢失用户数据」。没有任何人会想要丢数据,它不是一件「听起来该做、这次放弃了」的事,而是任何系统的底线。它要写的话,应该在目标(比如 G2 的「重复执行 0 次」)或横切关注点里,用可验证的方式写。

</details>

**练习 3:迷你设计文档骨架。** 不是所有改动都值得写八节。新建 `part10/ex542_mini.py`,复用 `doc_skeleton.py` 的 `SECTIONS`,只留五节:背景、目标和非目标(合成一节)、方案、被放弃的方案、风险与未决问题。用它给「退款金额改从账务系统重新取」这个改动生成一份骨架。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex542_mini.py
"""练习 3:迷你设计文档,只留五节,目标和非目标合成一节。"""
import sys
from pathlib import Path

from part10.doc_skeleton import SECTIONS

KEEP = ("背景", "目标", "非目标", "方案", "被放弃的方案", "风险与未决问题")


def render_mini(title: str) -> str:
    lines = [f"# {title}(迷你设计文档)", ""]
    kept = [(n, q) for n, q in SECTIONS if n in KEEP]
    n = 0
    for name, question in kept:
        if name == "非目标":
            lines.append(f"<!-- 非目标:{question} -->")
            lines.append("")
            continue
        n += 1
        head = "目标和非目标" if name == "目标" else name
        lines += [f"## {n}. {head}", "", f"<!-- 回答:{question} -->", ""]
    return "\n".join(lines)


if __name__ == "__main__":
    out = Path(sys.argv[1])
    if out.exists():
        raise SystemExit(f"{out} 已经存在,不覆盖。")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_mini("退款金额改从账务系统重新取"), encoding="utf-8")
    print(out.read_text(encoding="utf-8"))
```

<div class="line-notes">

- `from part10.doc_skeleton import SECTIONS` 骨架的数据只在一个地方维护,完整版和迷你版共用。
- `KEEP = ("背景", "目标", "非目标", "方案", "被放弃的方案", "风险与未决问题")` 要留的节。横切关注点、评测与上线被砍掉了,小改动里这两块通常一两句话,写进方案或风险里就够。
- `kept = [(n, q) for n, q in SECTIONS if n in KEEP]` 按原顺序过滤,顺序不会乱。
- `n = 0` 自己数编号,因为「非目标」不单独占一节,不能直接用 `enumerate`。
- `if name == "非目标":` 碰到非目标,只往上一节(目标)下面追加一行提示,`continue` 跳过后面的标题生成。
- `head = "目标和非目标" if name == "目标" else name` 「目标」那一节改个名字。
- `lines += [f"## {n}. {head}", "", f"<!-- 回答:{question} -->", ""]` `+=` 把一个列表接到另一个后面,相当于 `lines.push(...[...])`。
- `out = Path(sys.argv[1])` 这次路径必须从命令行给,不给会报 `IndexError`,迷你文档每次主题不同,不该有默认路径。

</div>

```bash
uv run python -m part10.ex542_mini agentops/docs/design/refund-amount-mini.md
```

```text
# 退款金额改从账务系统重新取(迷你设计文档)

## 1. 背景

<!-- 回答:现在是什么情况?为什么现在要做?(写给不了解项目的评审人,三五段) -->

## 2. 目标和非目标

<!-- 回答:做成以后,哪几个数字会变成多少?怎么测? -->

<!-- 非目标:哪些事听起来相关,但这次明确不做? -->

## 3. 方案

<!-- 回答:系统长什么样?关键接口、数据怎么流、默认策略是什么? -->

## 4. 被放弃的方案

<!-- 回答:认真考虑过哪两三个做法?各自好在哪,为什么没选,什么条件下重新考虑? -->

## 5. 风险与未决问题

<!-- 回答:哪里自己也没把握?打算怎么验证? -->
```

这份迷你文档的「被放弃的方案」可以只写一条:「信任模型给的金额,只在超过阈值时人工复核」,优点是少一次账务系统查询,放弃原因是 Day 541 混合第一版就是用了模型给的金额 0 去退款,重新评估条件是账务系统查询成为延迟瓶颈(P95 超过 1 秒)。

</details>

**验收标准**:`agentops/docs/design/runtime.md` 骨架已生成且重复运行会被拦住;`ex542_goal_check2.py` 对八条样例的输出和上面一致,并能说出规则修不了的那两类问题;写出四条满足要求的非目标;能不看文章说出八节和每节的问题。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 设计文档 design doc | 动手写代码前写下的方案文档:打算怎么做、为什么、放弃了什么,用来评审和形成共识。也叫技术方案 |
| RFC | Request for Comments,「请提意见」的提案文档。开源社区(React、Vue、Rust)用这个词,性质和设计文档一样 |
| 骨架 | 设计文档固定的几节和每节要回答的问题,今天是八节 |
| 目标 goal | 做成以后要达到的可验证结果,要有指标、阈值、怎么测 |
| 非目标 non-goal | 听起来相关、有人会想要,但这次明确不做的事 |
| 范围蔓延 scope creep | 项目里不断「顺便」加进新需求,越做越大、越拖越久 |
| 被放弃的方案 alternatives considered | 认真考虑过但没选的方案,要写优点、放弃原因、重新评估条件 |
| 稻草人 straw man | 只写缺点、故意搭起来让自己驳倒的备选方案 |
| 横切关注点 cross-cutting concerns | 不属于某个模块、贯穿整个系统的问题:安全、隐私、成本、可观测 |
| 迷你设计文档 | 一到三页的简化版,适合中等规模的改动 |
| 人日 | 工作量单位,一个人干一天算 1 人日 |
| 基线 baseline | 改动前测出来的现状数字,目标里的「降低多少」都要相对它算 |
| 误报 / 漏报 | 检查工具把好的判成坏的 / 把坏的放过去 |

## 常见误区

**设计文档写成需求文档或使用手册。** 需求文档写「要什么」,使用手册写「怎么用」,设计文档写「打算怎么做、为什么这么做、放弃了什么」。写完通读一遍,如果找不到任何一处取舍,它多半不是设计文档。

**目标写得像口号。** 「提升效率」「更稳定」没法判断有没有做到。每条目标都要有指标、阈值、怎么测。

**目标里的数字是编的。** 本文第三步实跑,模型两句改写都给了「至少 50%」,基线谁也没测过。编的数字比没有数字更危险,因为它看起来很专业。数字写出处;没有基线就写「先测基线」。

**非目标写成反过来的目标。** 「系统不应崩溃」不是非目标。非目标是合理的、有人会想要、这次放弃了的东西。

**评审人写组名。** 写「平台组」等于没人负责看。写具体的人名,并且在评审前当面或私信打个招呼。

**觉得写风险显得不专业。** 评审人最怕的是作者假装什么都想清楚了。把没把握的地方写出来,让评审帮你想,比上线后出事好得多。

**什么都写设计文档。** 没歧义、写出来是实现手册、还在原型阶段的,直接写代码。中等规模的写迷你版。

## 学习资料

### 文档与文章

- [Malte Ubl《Design Docs at Google》](https://www.industrialempathy.com/posts/design-docs-at-google/):设计文档最常被引用的一篇,今天「非目标不是反过来的目标」「十到二十页」「迷你设计文档」「什么时候不写」都出自这里。英文,30 分钟,今天必读。
- [React RFC 模板](https://github.com/reactjs/rfcs/blob/main/0000-template.md) 和 [reactjs/rfcs 仓库](https://github.com/reactjs/rfcs):前端读者最好的入口。挑一份你熟悉的功能(比如 Hooks 那份)看它的 Motivation 和 Alternatives 怎么写。
- [Vue RFC 模板](https://github.com/vuejs/rfcs/blob/master/0000-template.md):和 React 的几乎一样,对照着看哪一节被删了。
- [Gergely Orosz《Software Engineering RFC and Design Doc Examples》](https://blog.pragmaticengineer.com/rfcs-and-design-docs/):收集了很多公司公开的设计文档模板和例子(Uber、Sourcegraph、HashiCorp 等),看不同公司的骨架有哪些共同点。英文,挑两三个模板看,20 分钟。
- [designdocs.dev](https://www.designdocs.dev/):设计文档范例的合集,挑一两份平台类的看。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17s4y1J7rG&autoplay=0&high_quality=1" title="阿里工程师带你学技术文档该怎么写" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里技术_AlibabaTech · 阿里工程师带你学技术文档该怎么写 · 30 分钟,三万多播放。国内大厂视角讲技术文档的结构和常见问题,听完对照今天的八节,看他们的叫法对应哪一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WP4y1B7ym&autoplay=0&high_quality=1" title="程序员的软技能实战-写好设计文档" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>idx_done · 程序员的软技能实战-写好设计文档 · 5 分钟的短视频,几个实用的小建议,通勤时看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bgHL41e7vgI" title="What Is A Design Doc In Software Engineering? (full example)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Clément Mihailescu · What Is A Design Doc In Software Engineering? (full example) · 前 Google、Facebook 工程师逐节讲一份完整的设计文档。英文,开字幕看,重点听他怎么讲目标和非目标。</figcaption>
</figure>

### 书籍

- Titus Winters、Tom Manshreck、Hyrum Wright《Software Engineering at Google》(O'Reilly,2020):第 10 章讲文档,讲「为什么写、写给谁」。这本书 Google 官方放了[免费在线版](https://abseil.io/resources/swe-book),第 10 章在[这里](https://abseil.io/resources/swe-book/html/ch10.html)。
- Tanya Reilly《The Staff Engineer's Path》(O'Reilly,2022):第 5 章讲怎么带大项目,其中写设计文档、推动评审的部分,讲的是文档在组织里怎么起作用。

### 开源项目与代码

- 你自己的 `part10/doc_skeleton.py` 和 `agentops/docs/design/runtime.md`:明天往这份骨架里填完整内容。
- [rust-lang/rfcs](https://github.com/rust-lang/rfcs):Rust 社区的 RFC 仓库,很多 RFC 的 Alternatives 写得非常认真,值得看看别人怎么对待被放弃的方案。

## 自测

1. 设计文档最核心的价值是什么?为什么要在写代码之前写?

<details><summary>答案</summary>

在改动还便宜的时候发现问题;顺带在团队里形成共识、留下决策历史。写代码之前改一句话,写完以后可能要改十几处调用方,越晚发现方向错,代价越大。

</details>

2. 「运行时要更稳定」改成可验证的目标,至少要补上哪三样?给一个示范。

<details><summary>答案</summary>

指标、阈值和方向、怎么测。示范:「进程在任意一步被杀掉后恢复,结果与不被杀一致,有副作用的工具重复执行 0 次;验证方法是 part10/test_durable_runner.py 的崩溃注入测试。」

</details>

3. 下面哪条不算非目标,为什么?(a)不做模型网关;(b)不做拖拽编排界面;(c)系统不应该丢数据。

<details><summary>答案</summary>

(c)不算。没有人会想让系统丢数据,它不是「合理但这次放弃」的东西,而是底线,应该在目标或横切关注点里用可验证的方式写。(a)(b)都是评审时真会有人提的「顺便做一下」。

</details>

4. 第三步里模型把「提升开发效率」改写成「接入耗时从基线降低至少 50%」,看起来已经可验证了。它还有什么问题?

<details><summary>答案</summary>

基线没人测过,50% 没有出处,是模型编的一个听起来合理的整数。评审时被问「50% 怎么来的」答不上来。正确做法是数字自己填,没有基线就写「先测基线」,或者给一个绝对的阈值并标明是预期(比如「不超过 2 人日,预期」)。

</details>

5. 什么情况下不该写设计文档?中等规模的改动怎么办?

<details><summary>答案</summary>

问题没有歧义、写出来只是一份实现手册(没有取舍)、还在原型阶段时不写,直接写代码。中等规模的写一到三页的迷你设计文档:背景、目标和非目标、方案、被放弃的方案、风险。

</details>

6. 面试题:「你写过设计文档吗?你觉得一份设计文档里最重要的是哪一节?」

<details><summary>答案</summary>

可以这样答:写过,拿 AgentOps 运行时举例,说八节的结构。最重要的我会说是「目标和非目标」加「被放弃的方案」。前者决定了方案的取舍标准,而且非目标能挡住评审会上一半的「顺便做一下」;后者最能体现有没有认真比较过,每个备选方案都写优点、放弃原因和什么条件下重新考虑。如果对 Agent 系统,再补一句:评测与上线那节必须写清用哪个评测集、跑几次、看哪几个数,因为同一个方案换个模型效果会差很多。

</details>

## 明天预告

Day 543 · 设计文档(二):示范 AgentOps 运行时设计文档和两份 ADR。今天的骨架还是空的,明天把这两周的 harness、记忆、持久化执行和 Day 541 的实验数字填进去,写出一份完整的示范,再配两份 ADR。数字用一个小脚本从实测值算出来,写完还会让模型按一份清单当第一个评审人,看它挑出哪些毛病、哪些该改、哪些不该听。
