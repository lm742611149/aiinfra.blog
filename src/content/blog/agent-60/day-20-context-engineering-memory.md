---
title: 'Day 20 · 上下文工程与记忆:窗口预算、压缩、长期记忆、Agentic RAG'
description: '把视角从 RAG 拉到整个 Agent:上下文窗口里该放什么、放多少;清理工具结果、裁剪、摘要压缩三档手段;子 Agent 隔离上下文;长期记忆;Agentic RAG;最后讲清楚 JD 里高频出现的 Agent Harness 到底是什么。'
pubDate: 2026-10-12
updatedDate: 2026-10-15
regime: none
tags: ['context-engineering', 'memory', 'compaction', 'agentic-rag', 'agent-60']
series: 'agent-60'
day: 20
lang: 'zh'
---

## 今天要解决的问题

前四天我们一直在优化一件事:给模型找到对的资料。今天退一步想一个更大的问题:模型每次被调用时,它能看到的全部东西(system prompt、工具定义、检索到的资料、对话历史、关于用户的记忆)加起来就是它的「上下文」。这个上下文里放什么、放多少、按什么顺序放,决定了 Agent 表现得像个专业客服还是像个健忘的实习生。

这件事在 2025 年有了一个名字:上下文工程(context engineering)。Anthropic 在《Effective context engineering for AI agents》里给的定义大意是:找到最小的一组高信号 token,让模型最可能做出你想要的行为。提示词工程关心的是「怎么写指令」,上下文工程关心的是「每一轮调用时,窗口里到底装了什么」。对单轮问答,两者差不多;对要跑几十轮、调很多工具的 Agent,后者重要得多。

今天结束时你应该能做到:

1. 解释什么是上下文工程,以及「窗口越大越好」为什么是错的。
2. 给 CloudLedger 客服 Agent 做一张上下文预算表,并用代码按预算裁剪历史。
3. 实现三档上下文压缩:清理旧工具结果、按轮裁剪、摘要压缩,知道各自的代价和顺序。
4. 区分短期记忆和长期记忆,实现一个基于 pgvector 的用户长期记忆(写入、去重、召回、删除)。
5. 把检索做成工具,跑通一个 Agentic RAG,说出它和固定流程 RAG 的取舍。
6. 用子 Agent 隔离一个需要翻大量资料的子任务,并说清楚它省了什么、多花了什么。
7. 讲清楚 Agent Harness 是什么、由哪几块组成,并对应到自己写过的代码。

预计用时 6–8 小时。今天内容多,但这是国内 Agent 岗面试问得最密的一块,值得多花时间。前置:Day 4(messages 结构)、Day 8–9(function calling 和 Agent 循环)、Day 17(pgvector)、Day 18(混合检索)。

## 窗口大,不等于该塞满

现在主流模型的上下文窗口动辄几十万甚至上百万 token。很自然的想法是:既然装得下,全塞进去不就好了?

不行,原因有三个,前两个你在 Day 16 已经见过:

贵。 每次调用都按输入 token 付费。一个 Agent 跑 20 步,每步都带着 5 万 token 的上下文,单次任务就是 100 万输入 token。

慢。 输入越长,首 token 延迟越高。

笨。 这是最反直觉的一条。研究发现,上下文越长,模型从中准确找到并使用信息的能力越差。Chroma 的研究团队把这个现象叫 [context rot](https://research.trychroma.com/context-rot)(上下文腐烂),Anthropic 的文章里也引用了这个说法,把模型的注意力比作一份有限的「注意力预算」,每多一个 token 都在消耗它。更早的 [Lost in the Middle](https://arxiv.org/abs/2307.03172) 论文发现,信息放在长上下文的中间位置时,模型最容易忽略。

所以上下文要当作稀缺资源来管理。LangChain 的 Lance Martin 在[一篇很受欢迎的文章](https://blog.langchain.com/context-engineering-for-agents/)里把上下文工程的手段归成四类,我觉得这个分法很好记:

- 写出去(write):把信息存到窗口外面,比如草稿本、笔记文件、长期记忆。
- 选进来(select):需要时再把相关的部分取回窗口,RAG 就是这一类。
- 压缩(compress):把冗长的内容变短,比如对话摘要、清理旧的工具结果。
- 隔离(isolate):把子任务交给拥有独立窗口的子 Agent,只把结果带回来。Day 26 多 Agent 会讲。

今天四类都会动手:写出去(长期记忆)、选进来(Agentic RAG)、压缩(裁剪、摘要、清理工具结果)、隔离(子 Agent)。最后再看把它们拼在一起的那一层,也就是 JD 里常说的 Agent Harness。

## 给上下文做预算

做预算之前先问:CloudLedger 客服 Agent 的一次调用,上下文里都有什么?

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="客服 Agent 单次调用的上下文预算条,按来源分块">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink)">一次调用的上下文预算(示例,共约 12k token)</text>
<rect x="20" y="50" width="80" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="100" y="50" width="80" height="44" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="180" y="50" width="40" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="220" y="50" width="160" height="44" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="380" y="50" width="160" height="44" fill="none" stroke="var(--ink-soft)"/>
<rect x="540" y="50" width="80" height="44" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="60" y="76" fill="var(--ink)" text-anchor="middle">系统 1.5k</text>
<text x="140" y="76" fill="var(--ink)" text-anchor="middle">工具 1.5k</text>
<text x="200" y="76" fill="var(--ink)" text-anchor="middle" font-size="11">记忆</text>
<text x="300" y="76" fill="var(--ink)" text-anchor="middle">检索资料 3k</text>
<text x="460" y="76" fill="var(--ink)" text-anchor="middle">对话历史 ≤3k</text>
<text x="580" y="76" fill="var(--ink-soft)" text-anchor="middle">输出 1.5k</text>
<text x="20" y="125" fill="var(--mem)">蓝:每次都一样,适合 prompt caching</text>
<text x="20" y="145" fill="var(--compute)">琥珀:每次按需选进来(检索、记忆召回)</text>
<text x="20" y="165" fill="var(--ink-soft)">灰框:会越聊越长,必须裁剪或压缩</text>
<text x="20" y="185" fill="var(--ink-faint)">虚线:给回答留的空间,别被输入挤没了</text>
<text x="20" y="210" fill="var(--ink-faint)" font-size="11">数字是 CloudLedger 的示例配置,你的 Agent 要按实际情况定,并用 usage 字段核对</text>
</g>
</svg>
<figcaption>把上下文拆成几块分别给预算。固定部分放前面方便缓存,按需部分控制条数,会增长的部分设上限。</figcaption>
</figure>

这张表的意义不在于具体数字,而在于逼你想清楚每块是什么、谁在控制它的大小:

- 系统提示词和工具定义:每次调用都一样。它们应该放在最前面,这样能命中 prompt caching(Day 38 细讲),重复部分的价格能打到原价的一小部分。工具定义经常被忽视,十几个工具的 JSON Schema 轻松上千 token。
- 记忆:关于这个用户的几条事实,几百 token 足够。
- 检索资料:由 top-k 和块大小决定,4 块 × 每块几百字,大约 2–3k。
- 对话历史:唯一会无限增长的部分,必须设上限。
- 输出空间:要给模型的回答留位置。有的 API 是输入加输出共享上限,输入塞太满,回答会被截断。

估 token 时有个实际问题:不同厂商的分词器不一样,本地没法精确计算。我的做法是本地用一个偏保守的粗估做预算控制,精确值以 API 返回的 `usage` 为准,上线后定期对照两者,调整粗估系数。

```python
# agent-60-lab/w3/context_budget.py
"""给上下文窗口做预算:粗估 token,超预算时从最早的对话开始丢。"""
import re

CJK = re.compile(r"[一-鿿]")


def estimate_tokens(text: str) -> int:
    """粗估:汉字按 1 个 token,其余字符按 4 个字符 1 个 token。偏保守,够做预算用。
    精确值以 API 返回的 usage 为准。"""
    cjk = len(CJK.findall(text))
    return cjk + (len(text) - cjk) // 4 + 1


def message_tokens(m: dict) -> int:
    return estimate_tokens(str(m.get("content") or "")) + 4  # 每条消息有少量格式开销


def trim_history(messages: list[dict], budget: int) -> list[dict]:
    """保留所有 system 消息和最近的对话,总量不超过 budget。
    按「轮」丢弃:一个 user 消息和它后面的 assistant/tool 消息一起丢,避免留下孤立的 tool 结果。"""
    system = [m for m in messages if m["role"] == "system"]
    rest = [m for m in messages if m["role"] != "system"]
    turns: list[list[dict]] = []
    for m in rest:
        if m["role"] == "user" or not turns:
            turns.append([m])
        else:
            turns[-1].append(m)
    used = sum(message_tokens(m) for m in system)
    kept: list[list[dict]] = []
    for turn in reversed(turns):  # 从最新的一轮往回装
        cost = sum(message_tokens(m) for m in turn)
        if used + cost > budget and kept:
            break
        kept.append(turn)
        used += cost
    return system + [m for turn in reversed(kept) for m in turn]


if __name__ == "__main__":
    print(estimate_tokens("年付套餐买错了能退款吗"), estimate_tokens("How do I get a refund?"))
    msgs = [{"role": "system", "content": "你是客服" * 10}]
    for i in range(8):
        msgs.append({"role": "user", "content": f"第 {i} 个问题" + "啊" * 50})
        msgs.append({"role": "assistant", "content": f"第 {i} 个回答" + "嗯" * 100})
    trimmed = trim_history(msgs, budget=600)
    print(len(msgs), "→", len(trimmed), [m["content"][:5] for m in trimmed])
```

**`CJK = re.compile(r"[一-鿿]")` 是什么意思?** 这是一个匹配「一个汉字」的正则,`estimate_tokens` 用它数出文本里有几个汉字。

- `re.compile(...)`:把正则预先编译成对象,后面反复调用 `CJK.findall` 不用每次重新解析。相当于 TS 在模块顶层写 `const CJK = /[一-鿿]/g`。
- `r"..."`:原始字符串,反斜杠不转义。这里没有反斜杠,写 `r` 是写正则的习惯。
- `[一-鿿]`:字符区间。「一」的 Unicode 编码是 U+4E00,「鿿」是 U+9FFF,这一段正好是「中日韩统一表意文字」的基本区,常用汉字都在里面。「鿿」本身不是常用字,只是这个区间的最后一个码位。也可以写成 `r"[\u4e00-\u9fff]"`,意思完全一样,还更好认。
- `CJK.findall(text)`:返回所有匹配到的汉字组成的列表,`len(...)` 就是汉字个数。

拿一句话试一下:「导入招商银行流水报 E1043,怎么办?」共 20 个字符,其中汉字 12 个,其余 8 个(空格、字母、数字、标点)按 4 个字符算 1 个 token,估算结果 = 12 + 8 // 4 + 1 = 15。

两个注意点:中文标点(,。?)不在这个区间里,会被当成「其余字符」,按 1/4 个 token 算,实际分词器通常算 1 个,所以标点多的文本会略微低估;生僻字所在的扩展区(比如 U+3400 开头的扩展 A)也不在里面。做预算够用了,要精确就看 API 返回的 `usage`。

这段不调 API,我在本机跑过,输出是:

```text
12 6
17 → 7 ['你是客服你', '第 5 个', '第 5 个', '第 6 个', '第 6 个', '第 7 个', '第 7 个']
```

17 条消息裁到 7 条:system 保留,最近三轮保留,前五轮丢掉。

注意那个「按轮丢弃」的设计,这是我被坑过才加上的。如果只按条数从前往后删,很可能删掉了 assistant 发起工具调用的那条消息,却留下了后面的 tool 结果消息。OpenAI 兼容的接口看到一条 `role: tool` 的消息前面没有对应的 `tool_calls`,会直接返回 400 错误。报错信息通常是类似「messages with role 'tool' must be a response to a preceding message with 'tool_calls'」这样的话。第一次碰到时我盯着这个报错看了很久才想明白。

**`trim_history` 逐段在干什么?** 一句话:超预算时从最早的对话开始扔,但 system 消息和最新一轮一定保留。

- `system = [...]` / `rest = [...]`:按「是不是 system」分成两堆,相当于 TS 的 `filter`。system 里是人设和规则,无论如何都留着。
- `turns: list[list[dict]]`:列表的列表,每个元素是一轮,比如 `[user1, assistant1(调工具), tool1, assistant1(回答)]`。
- `if m["role"] == "user" or not turns`:遇到 user 就开新的一轮,其他消息塞进最后一轮(`turns[-1]`,相当于 TS 的 `turns.at(-1)`)。`or not turns` 是兜底:历史开头不是 user 时也先建一轮,否则空列表上取 `turns[-1]` 会报 `IndexError`。
- `used = sum(...)`:先扣掉 system 占的预算。
- `for turn in reversed(turns)`:从最新的一轮往回装,最近的对话最重要。
- `if used + cost > budget and kept: break`:装下这一轮就超了,就停。`and kept` 的意思是 `kept` 还空着时超了也要装,最新一轮无论多大都必须留,否则连用户刚问的问题都没了。
- `[m for turn in reversed(kept) for m in turn]`:`kept` 是倒着装的,`reversed` 翻回时间顺序;双层推导式把「轮的列表」摊平成「消息的列表」,相当于 TS 的 `kept.slice().reverse().flat()`。

拿下面的演示走一遍:system 约 45 token,每轮约 168 token,预算 600。装第 7 轮 → 213,第 6 轮 → 381,第 5 轮 → 549,第 4 轮 → 717 超了,停。剩 system + 3 轮共 7 条,就是输出里的 `17 → 7`。

## 压缩:别直接丢,先总结

直接丢掉旧对话有个明显的问题:用户第 1 轮说过「我们是年付的企业版」,第 10 轮问「那我能退吗」,这时候第 1 轮已经被裁掉了,Agent 不知道他是什么套餐。

压缩(compaction)的做法是:历史快超预算时,把较早的对话交给模型总结成一段摘要,最近几轮保留原文,摘要放在 system 后面。Anthropic 在 Claude Code 里就是这么做的:对话接近窗口上限时,总结前文、开一个新窗口接着干。

```python
# agent-60-lab/w3/compaction.py
"""对话压缩:历史太长时,把较早的对话总结成一段摘要,最近几轮保留原文。"""
from context_budget import estimate_tokens
from llm import chat

SUMMARY_TAG = "【之前对话的摘要】"
SUMMARY_PROMPT = """把下面这段客服对话压缩成一段摘要,给接手的客服看。
必须保留:用户的身份信息(套餐、是否年付等)、用户提出的每个问题、已经给出的结论、还没解决的事项、用户明确表达的偏好或不满。
可以丢掉:寒暄、重复的话、已经被纠正的错误信息。
如果开头有更早的摘要,把它的要点合并进来。用第三人称,不超过 200 字。"""


def compact(messages: list[dict], keep_last_turns: int = 3, trigger_tokens: int = 3000) -> list[dict]:
    """总 token 超过 trigger_tokens 时压缩。返回新的消息列表:system + 摘要 + 最近 keep_last_turns 轮。"""
    total = sum(estimate_tokens(str(m.get("content") or "")) for m in messages)
    if total <= trigger_tokens:
        return messages

    is_summary = lambda m: m["role"] == "system" and str(m.get("content", "")).startswith(SUMMARY_TAG)  # noqa: E731
    summaries = [m for m in messages if is_summary(m)]
    system = [m for m in messages if m["role"] == "system" and not is_summary(m)]
    rest = [m for m in messages if m["role"] != "system"]
    user_idx = [i for i, m in enumerate(rest) if m["role"] == "user"]
    if len(user_idx) <= keep_last_turns:
        return messages
    cut = user_idx[-keep_last_turns]          # 从倒数第 keep_last_turns 个 user 消息开始保留原文
    old, recent = rest[:cut], rest[cut:]

    # 旧摘要也放进去一起总结,否则多次压缩后会叠出好几段摘要
    lines = [s["content"] for s in summaries]
    lines += [f'{m["role"]}: {m.get("content") or "(调用了工具)"}' for m in old]
    summary = chat([{"role": "system", "content": SUMMARY_PROMPT},
                    {"role": "user", "content": "\n".join(lines)}], temperature=0)
    note = {"role": "system", "content": f"{SUMMARY_TAG}\n{summary}"}
    return system + [note] + recent
```

摘要 prompt 里「必须保留什么、可以丢掉什么」是这段代码的灵魂。我最初只写了「总结一下这段对话」,结果模型总结得很流畅,但把「用户是年付」这种关键身份信息当成细节省略了,压缩后 Agent 开始答错。**压缩 prompt 要按你的业务列出不能丢的东西**,而且要放进评估:构造几段长对话,压缩后问一个依赖早期信息的问题,看答得对不对。

还有一种更轻的压缩,Anthropic 文章里称它为最安全、最轻量的一种:清理旧的工具结果(tool result clearing)。Agent 第 3 步调用 `search_kb` 拿回了 2,000 字资料,到第 15 步时,这 2,000 字原文多半已经没用了,模型已经根据它做出了判断。把旧的工具结果换成一行占位,能省下大量 token,又几乎不损失信息。它和摘要压缩最大的区别是不需要调用模型,零成本、零延迟,所以应该排在摘要之前做。

实现时有一个和「按轮裁剪」一样的约束:消息结构不能破坏。assistant 的 `tool_calls` 和对应的 `tool` 消息都要留着,只把旧 `tool` 消息的 `content` 换短。这样模型仍然看得到「当时调过什么工具、传了什么参数」,需要的话可以自己再调一次。

```python
# agent-60-lab/w3/tool_clearing.py
"""工具结果清理:只保留最近 keep_recent 次工具调用的原始结果,更早的换成一行占位。

assistant 的 tool_calls 和对应的 tool 消息都保留(消息结构完整,接口不会报错),
只是把旧 tool 消息的 content 换短。模型仍然知道「当时调过什么工具、传了什么参数」。
"""

from typing import Any

PLACEHOLDER = "(早先的工具结果已清理以节省上下文。需要的话可以重新调用该工具。)"


def clear_old_tool_results(messages: list[dict], keep_recent: int = 2, min_chars: int = 200) -> list[dict]:
    tool_idx = [i for i, m in enumerate(messages) if m["role"] == "tool"]
    old = set(tool_idx[:-keep_recent]) if keep_recent else set(tool_idx)
    out = []
    for i, m in enumerate(messages):
        if i in old and len(str(m.get("content") or "")) > min_chars:  # 很短的结果留着,清了也省不了多少
            m = {**m, "content": PLACEHOLDER}
        out.append(m)
    return out


if __name__ == "__main__":
    msgs: list[dict[str, Any]] = [{"role": "system", "content": "你是客服"}, {"role": "user", "content": "问题"}]
    for n in range(4):
        msgs.append({"role": "assistant", "content": None,
                     "tool_calls": [{"id": f"call_{n}", "type": "function",
                                     "function": {"name": "search_kb", "arguments": f'{{"query": "q{n}"}}'}}]})
        msgs.append({"role": "tool", "tool_call_id": f"call_{n}", "content": f"第 {n} 次检索结果" + "字" * 800})
    before = sum(len(str(m.get("content") or "")) for m in msgs)
    cleaned = clear_old_tool_results(msgs, keep_recent=2)
    after = sum(len(str(m.get("content") or "")) for m in cleaned)
    print(f"字符数 {before} → {after}")
    print([m["content"][:8] for m in cleaned if m["role"] == "tool"])
```

这段不调 API,我在本机跑过:4 次检索、每次 800 多字的结果,清掉最早两次后,总字符数从 3242 降到 1690,最近两次的结果原样保留:

```text
字符数 3242 → 1690
['(早先的工具结果', '(早先的工具结果', '第 2 次检索结', '第 3 次检索结']
```

到这里,管理会增长的上下文有了三档手段,按代价从低到高用:

| 手段 | 代价 | 丢什么 | 什么时候用 |
| --- | --- | --- | --- |
| 清理旧工具结果 | 零(不调模型) | 旧工具的原始输出 | 工具调用多的 Agent,每轮都可以做 |
| 按轮裁剪 | 零 | 最早几轮对话的全部内容 | 早期对话确实不重要时 |
| 摘要压缩 | 一次模型调用 | 细节(摘要写不到的部分) | 接近预算上限,且早期信息仍有用 |

压缩有代价:多一次模型调用,而且摘要会丢细节,丢了就找不回来。所以触发阈值不要设得太低,能清理和裁剪解决的先清理裁剪,快到上限了再压缩。Claude Code、Claude Agent SDK 这类成熟的 Agent 都是这几种手段组合着用的。

## 记忆:短期和长期

说到 Agent 的「记忆」,先分清两种,它们的实现完全不同:

短期记忆就是当前会话的上下文:这次聊天里说过的话、调用过的工具。上面的裁剪和压缩管理的就是它。会话结束,它就没了。实现上,它通常存在会话存储里(W4 的 LangGraph checkpoint、W6 的 Redis/Postgres),按 `thread_id` 取。

长期记忆跨会话存在:用户下周再来,Agent 还记得他是年付企业版、上次因为 E1043 导入失败、喜欢邮件联系。它需要一个独立的存储,和「什么时候写、写什么、什么时候读」的策略。

长期记忆常见的再分三类,这个分法来自认知科学,在 LangChain、Letta 等框架的文档里都能看到:

- 语义记忆:关于用户的事实。「年付企业版」「用招商银行」。
- 情景记忆:发生过的事。「10 月 12 日因 E1043 导入失败,已解决」。
- 程序记忆:做事的规则。通常就是 system prompt 本身,有的系统会根据反馈自动更新它。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="长期记忆的写入和读取流程:对话结束后抽取事实写入 pgvector,新对话开始时按相关性召回">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">写入(会话结束后,异步)</text>
<rect x="20" y="40" width="110" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="75" y="64" fill="var(--ink)" text-anchor="middle">本次对话</text>
<rect x="160" y="40" width="130" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="225" y="58" fill="var(--ink)" text-anchor="middle">LLM 抽取</text>
<text x="225" y="73" fill="var(--ink-faint)" text-anchor="middle" font-size="11">profile/preference/event</text>
<rect x="320" y="40" width="120" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="380" y="58" fill="var(--ink)" text-anchor="middle">查重</text>
<text x="380" y="73" fill="var(--ink-faint)" text-anchor="middle" font-size="11">相似度 ≥0.9 → 更新</text>
<rect x="470" y="100" width="150" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="545" y="126" fill="var(--ink)" text-anchor="middle">user_memories</text>
<text x="545" y="144" fill="var(--ink-faint)" text-anchor="middle" font-size="11">pgvector</text>
<line x1="130" y1="60" x2="160" y2="60" stroke="var(--ink-faint)"/>
<line x1="290" y1="60" x2="320" y2="60" stroke="var(--ink-faint)"/>
<line x1="440" y1="60" x2="545" y2="60" stroke="var(--ink-faint)"/>
<line x1="545" y1="60" x2="545" y2="100" stroke="var(--ink-faint)"/>
<text x="20" y="200" fill="var(--ink-soft)">读取(新对话的每一轮)</text>
<rect x="20" y="212" width="110" height="40" rx="4" fill="none" stroke="var(--rule)"/>
<text x="75" y="236" fill="var(--ink)" text-anchor="middle">用户新问题</text>
<rect x="160" y="212" width="130" height="40" rx="4" fill="none" stroke="var(--ink-soft)"/>
<text x="225" y="230" fill="var(--ink)" text-anchor="middle">profile 全取</text>
<text x="225" y="245" fill="var(--ink-faint)" text-anchor="middle" font-size="11">其余按相关性 top-3</text>
<rect x="320" y="212" width="120" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="380" y="236" fill="var(--ink)" text-anchor="middle">拼进上下文</text>
<line x1="130" y1="232" x2="160" y2="232" stroke="var(--ink-faint)"/>
<line x1="290" y1="232" x2="320" y2="232" stroke="var(--ink-faint)"/>
<line x1="545" y1="160" x2="545" y2="190" stroke="var(--compute)" stroke-dasharray="3 3"/>
<line x1="545" y1="190" x2="225" y2="190" stroke="var(--compute)" stroke-dasharray="3 3"/>
<line x1="225" y1="190" x2="225" y2="212" stroke="var(--compute)" stroke-dasharray="3 3"/>
</g>
</svg>
<figcaption>一个最小可用的长期记忆。写入发生在会话结束后,不影响响应速度;读取发生在每一轮,只取少量最相关的几条。</figcaption>
</figure>

长期记忆本质上就是「关于用户的 RAG」:存进去的是从对话里抽出来的事实,取出来用的还是 Day 17 的 pgvector。真正难的地方不在存储,而在三个策略问题:

写什么。 不是所有话都值得记。「谢谢」不值得,「我们是年付企业版」值得。用大模型从对话里抽取,并在 prompt 里列清楚哪些要记、哪些不能记。尤其要明确不记敏感信息:身份证号、银行卡号、密码、手机号。这不只是道德问题,在国内涉及个人信息保护法,在欧洲涉及 GDPR。

怎么去重和更新。 用户上个月说「我们是专业版」,这个月说「我们刚升级到企业版」。如果两条都存着,Agent 会困惑。我的做法是:新记忆写入前,先查和它最相似的已有记忆,相似度超过阈值就更新那一条,否则新增。阈值 0.9 是我随手定的初值,和 Day 15 说的一样,它依赖模型,要用几个例子校准。更严谨的做法是让大模型判断新旧两条是「重复」「更新」还是「矛盾」,mem0 这类库就是这么做的。

什么时候写。 同步写(每轮对话后立刻抽取)会增加响应延迟;异步写(会话结束后后台任务处理)更常见。Day 37 讲任务队列时会把它放进后台。

```python
# agent-60-lab/w3/memory_store.py
"""长期记忆:从对话里抽取值得记住的用户事实,存进 pgvector;下次对话按相关性取回。"""
import json

from embed import embed, embed_one
from llm import chat
from pg_store import DIM, connect

SCHEMA = f"""
CREATE TABLE IF NOT EXISTS user_memories (
    id          bigserial PRIMARY KEY,
    user_id     text NOT NULL,
    kind        text NOT NULL,              -- profile / preference / event
    content     text NOT NULL,
    embedding   vector({DIM}) NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_memories_user_idx ON user_memories (user_id);
"""

EXTRACT_PROMPT = """你在为 CloudLedger 客服系统整理关于这位用户的长期记忆。
从对话中找出以后的对话里还会有用的信息,分三类:
- profile:稳定的事实,如套餐类型、付费方式、公司规模、使用的银行
- preference:偏好,如希望用邮件联系、不喜欢冗长的回答
- event:值得记住的事件,如「2026-10 因 E1043 导入失败,已解决」「申请过退款被拒」
不要记:寒暄、一次性的问题细节、身份证号、银行卡号、密码、手机号等敏感信息。
没有值得记的就返回空列表。只输出 JSON:{"memories": [{"kind": "...", "content": "..."}]}"""

DUP_THRESHOLD = 0.9  # 和已有记忆相似度超过这个值,就当作同一条,更新而不是新增


def init(conn) -> None:
    conn.execute(SCHEMA)


def extract(conversation: list[dict]) -> list[dict]:
    transcript = "\n".join(f'{m["role"]}: {m["content"]}' for m in conversation if m["role"] in ("user", "assistant"))
    raw = chat([{"role": "system", "content": EXTRACT_PROMPT}, {"role": "user", "content": transcript}],
               temperature=0, response_format={"type": "json_object"})
    try:
        items = json.loads(raw).get("memories", [])
    except json.JSONDecodeError:
        return []
    return [m for m in items if m.get("content") and m.get("kind") in ("profile", "preference", "event")]


def remember(conn, user_id: str, conversation: list[dict]) -> list[str]:
    items = extract(conversation)
    if not items:
        return []
    vectors = embed([m["content"] for m in items])
    log = []
    for m, v in zip(items, vectors):
        row = conn.execute(
            """SELECT id, content, 1 - (embedding <=> %s) AS sim FROM user_memories
               WHERE user_id = %s ORDER BY embedding <=> %s LIMIT 1""",
            (v, user_id, v),
        ).fetchone()
        if row and row[2] >= DUP_THRESHOLD:
            conn.execute("UPDATE user_memories SET content = %s, embedding = %s, kind = %s, updated_at = now() WHERE id = %s",
                         (m["content"], v, m["kind"], row[0]))
            log.append(f"更新: {row[1]} → {m['content']}")
        else:
            conn.execute("INSERT INTO user_memories (user_id, kind, content, embedding) VALUES (%s, %s, %s, %s)",
                         (user_id, m["kind"], m["content"], v))
            log.append(f"新增[{m['kind']}]: {m['content']}")
    return log


def recall(conn, user_id: str, query: str, k: int = 3) -> list[str]:
    """profile 类全部带上(通常就几条),其余按和当前问题的相关性取 k 条。"""
    profile = [r[0] for r in conn.execute(
        "SELECT content FROM user_memories WHERE user_id = %s AND kind = 'profile' ORDER BY updated_at DESC LIMIT 5",
        (user_id,)).fetchall()]
    q = embed_one(query)
    related = [r[0] for r in conn.execute(
        """SELECT content FROM user_memories WHERE user_id = %s AND kind <> 'profile'
           ORDER BY embedding <=> %s LIMIT %s""", (user_id, q, k)).fetchall()]
    return profile + related


def forget(conn, user_id: str) -> int:
    """用户要求删除记忆时调用。能删,是做记忆功能的前提。"""
    return conn.execute("DELETE FROM user_memories WHERE user_id = %s", (user_id,)).rowcount


if __name__ == "__main__":
    conn = connect()
    init(conn)
    demo = [
        {"role": "user", "content": "我们是年付的专业版,导入招商银行流水一直报 E1043"},
        {"role": "assistant", "content": "E1043 是编码问题,请另存为 CSV UTF-8 ……"},
        {"role": "user", "content": "好了,解决了。以后有事发邮件给我就行,别打电话"},
    ]
    for line in remember(conn, "u-1024", demo):
        print(line)
    print(recall(conn, "u-1024", "导入又报错了"))
```

`recall` 里我对 profile 类和其他类区别对待:profile 是少量稳定事实(套餐、付费方式),几乎每个问题都可能用到,全部带上;preference 和 event 可能很多,按和当前问题的相关性只取几条。注意所有 SQL 都带着 `WHERE user_id = %s`,这和 Day 17 说的权限过滤是一回事:**一个用户的记忆绝对不能被另一个用户的对话召回**。这种串号事故在多租户系统里是最严重的事故之一。

`forget` 函数看起来最简单,但我认为它是做记忆功能的前提。用户有权要求删除关于自己的记忆,产品上要有入口,系统里要真能删干净(包括备份和日志里的副本,这是另一个话题了)。

跑一下 `uv run python w3/memory_store.py`,你大致会看到抽出来三四条记忆:年付专业版、使用招商银行、E1043 导入问题已解决、偏好邮件联系。再跑一次,应该大部分是「更新」而不是「新增」,这就是去重在起作用。如果你发现同一件事被存了两条,说明 0.9 的阈值对你的 embedding 模型偏高,这正好是一个校准的机会。

市面上有专门做 Agent 记忆的开源项目:[mem0](https://github.com/mem0ai/mem0) 主打即插即用的记忆层;[Letta](https://github.com/letta-ai/letta-code)(前身是论文 [MemGPT](https://arxiv.org/abs/2310.08560))的思路是让 Agent 像操作系统管理内存一样,自己决定把什么换进换出上下文。我的建议是先像今天这样手写一遍,搞清楚写入、去重、召回、删除四个环节,再去评估这些库,你会知道它们帮你省掉了什么、又藏起了什么。

## Agentic RAG:让 Agent 自己决定查不查

到目前为止,我们的 RAG 是一条固定流水线:不管用户说什么,都先检索,再生成。这有几个问题:

- 用户说「谢谢,问题解决了」,也去检索一遍,浪费。
- 用户一句话问两件事,一次检索只能用一个查询,第二件事的资料可能没召回。
- 第一次检索结果不好,没有机会换个说法再查。
- 检索到的片段信息不全,没有办法去读完整文章。

Agentic RAG 的思路是:把检索变成一个工具,交给 W2 学的 Agent 循环。模型自己判断要不要查、用什么词查、查几次、要不要读全文。这和 Anthropic 文章里说的 just-in-time(即时)检索是一个意思:Agent 手里只拿着轻量的「指针」(文章 id、文件路径),需要时再加载具体内容。Claude Code 读代码就是这样,它不会一开始把整个仓库塞进上下文,而是用 grep、读文件这些工具按需取。

先给 `llm.py` 加一个返回完整消息对象的函数,Agent 循环需要拿到 `tool_calls`:

```python
# agent-60-lab/w3/llm.py  (在原有内容后面追加)
def chat_raw(messages: list[Any], **kwargs: Any):
    """返回完整的 message 对象(包括 tool_calls),Agent 循环用。"""
    resp = _client.chat.completions.create(
        model=MODEL, messages=messages, extra_body=EXTRA_BODY, **kwargs
    )
    return resp.choices[0].message
```

两个细节和上面的 `chat()` 保持一致:`messages` 标成 `list[Any]`(写 `list[dict]` 编辑器会报红,和 Day 8 同一个原因,openai 要的是它自己的消息类型);`extra_body=EXTRA_BODY` 别漏,否则 DeepSeek 会用思考模式跑工具调用,慢很多,某些参数组合还会直接 400。

然后是 Agent 本身。循环结构和 Day 9 一模一样,如果你 Day 9 写了自己的 Agent 循环,把这两个工具注册进去就行:

```python
# agent-60-lab/w3/agentic_rag.py
"""Agentic RAG:把检索做成工具,让模型自己决定查不查、查什么、查几次。

循环结构和 Day 9 手写的 Agent 循环一样,这里为了 W3 能独立运行再写一遍精简版。
"""
import json
import sys
from pathlib import Path

from llm import chat_raw
from mem_retriever import MemRetriever

DATA = Path(__file__).resolve().parent.parent / "data" / "helpcenter"
RETRIEVER = MemRetriever()
MAX_STEPS = 6

SYSTEM = """你是云簿 CloudLedger 的客服助手。你可以使用工具查帮助中心。
- 涉及 CloudLedger 的规则、价格、操作步骤、错误码时,必须先查帮助中心,不要凭记忆回答。
- 一个问题里有多件事,就分别查。第一次查不到,可以换个说法再查一次。
- 寒暄、感谢这类话不需要查。
- 回答时在事实后面标注出处,如 [kb-002#1]。查了两次仍然没有,就说帮助中心里没有找到,建议转人工。"""

TOOLS = [
    {"type": "function", "function": {
        "name": "search_kb",
        "description": "在 CloudLedger 帮助中心里检索,返回最相关的几段内容(带 id)。query 用帮助中心的说法写,例如「年付退款政策」而不是用户的原话。",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "检索用的查询"},
        }, "required": ["query"]},
    }},
    {"type": "function", "function": {
        "name": "get_article",
        "description": "按文章 id(如 kb-002)读取整篇帮助文章。检索到的片段信息不全时使用。",
        "parameters": {"type": "object", "properties": {
            "doc_id": {"type": "string", "description": "文章 id,形如 kb-002"},
        }, "required": ["doc_id"]},
    }},
]


def search_kb(query: str) -> str:
    chunks = RETRIEVER.search(query, mode="hybrid", k=4)
    return "\n\n".join(f"[{c.id}] {c.text}" for c in chunks) or "没有找到相关内容。"


def get_article(doc_id: str) -> str:
    path = DATA / f"{doc_id}.md"
    if not path.exists():
        return f"没有 id 为 {doc_id} 的文章。可用的 id 形如 kb-001 到 kb-020。"
    return path.read_text(encoding="utf-8").split("---", 2)[-1].strip()


FUNCS = {"search_kb": search_kb, "get_article": get_article}


def run(question: str, history: list[dict] | None = None) -> str:
    messages = [{"role": "system", "content": SYSTEM}, *(history or []), {"role": "user", "content": question}]
    for step in range(1, MAX_STEPS + 1):
        msg = chat_raw(messages, tools=TOOLS, temperature=0)
        if not msg.tool_calls:
            return msg.content or ""
        messages.append({"role": "assistant", "content": msg.content,
                         "tool_calls": [tc.model_dump() for tc in msg.tool_calls]})
        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
                result = FUNCS[tc.function.name](**args)
            except Exception as e:  # noqa: BLE001  工具出错要告诉模型,而不是让循环崩掉
                result = f"工具调用失败:{e}"
            print(f"  [step {step}] {tc.function.name}({tc.function.arguments}) → {len(result)} 字")
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
    return "这个问题我处理得不太顺利,已经帮你转给人工客服。"


if __name__ == "__main__":
    for q in (sys.argv[1:] and [" ".join(sys.argv[1:])]) or [
        "谢谢你,上次的问题解决了",
        "发票抬头写错了,而且我想退款,怎么弄",
        "外币的账怎么记",
    ]:
        print(f"\n问:{q}")
        print("答:" + run(q))
```

几个设计点,都是 Day 11 讲「好工具怎么设计」的实践:

`search_kb` 的描述里特意写了「query 用帮助中心的说法写,例如『年付退款政策』而不是用户的原话」。这等于把 Day 18 的 query 改写融进了工具调用:模型在决定调用工具时,就已经在改写查询了。

工具返回的结果带着 `[kb-002#1]` 这样的 id,模型才能在回答里引用。`get_article` 的报错信息告诉模型合法的 id 长什么样,这样它传错了也能自我纠正。

`MAX_STEPS = 6` 是步数上限,Day 12 讲过,没有上限的 Agent 循环迟早会在某个奇怪的输入上无限转圈。超过上限就优雅降级到转人工。

跑一下,你大致会看到:第一个问题(谢谢)不调用任何工具直接回复;第二个问题会调用两次 `search_kb`,一次查发票抬头,一次查退款;第三个问题可能先用「外币」查一次,再换成「多币种」查一次。具体行为取决于你用的模型,能力弱一些的模型可能会对寒暄也去检索一次,这就是要用评估集量化的东西。

### 固定 RAG 还是 Agentic RAG

| | 固定流程 RAG | Agentic RAG |
| --- | --- | --- |
| 调用次数 | 固定:1 次检索 + 1 次生成 | 不固定:1 到 MAX_STEPS 次 |
| 延迟 | 低且稳定 | 高且波动 |
| 成本 | 可预测 | 不可预测,要设上限 |
| 多问题、需要追查 | 弱 | 强 |
| 可控性、可调试性 | 强 | 弱,要靠 tracing(Day 34) |
| 适合 | 问题模式单一、对延迟敏感 | 问题复杂多样、能接受多等几秒 |

我的看法是:**能用固定流程解决的,先用固定流程。** 这和 Anthropic《Building effective agents》里的建议一致(Day 13 讲过):先找最简单的方案,只在需要时增加复杂度。客服场景里,大部分问题是单一的政策查询,固定 RAG 又快又稳。可以用一个折中的设计:默认走固定 RAG,遇到多问题或者首次检索的 rerank 分数很低时,升级到 Agentic 模式。毕业项目 SupportPilot 会用 LangGraph 把这个路由做出来。

## 隔离:把翻资料的脏活交给子 Agent

四类手段里还剩「隔离」(isolate)。设想用户问:「帮我对比一下三种套餐在账本数、成员数、导出次数、能不能开专票、退款规则上的区别。」要回答这个问题,Agent 得查五六篇文章,几千字原文会全部堆进主对话的上下文。回答完以后,这几千字还赖在历史里,后面每一轮都要为它们付钱,还会干扰后面的问题。

子 Agent 的做法是:主 Agent 把这个调研任务交给一个拥有独立消息列表的子 Agent。子 Agent 在自己的上下文里检索、读文章、来回折腾,最后只交回一段 300 字的结论。主 Agent 的上下文里只多了这 300 字。子 Agent 复用上一节 `agentic_rag.py` 里的两个工具。这就是 Anthropic 在《Effective context engineering》里说的子 Agent 架构:每个子 Agent 可能用掉几万 token 去探索,但只返回压缩过的结果。

```python
# agent-60-lab/w3/subagent.py
"""子 Agent 隔离上下文:把一个「要翻很多资料」的子任务交给独立的 Agent 循环,
它在自己的消息列表里检索、读文章,最后只把一段精简结论交回主 Agent。

主 Agent 的上下文里只多了这段结论,而不是子 Agent 读过的几千字原文。
"""
import json
from typing import Any

from agentic_rag import FUNCS, TOOLS
from llm import chat_raw

SUB_SYSTEM = """你是一个资料调研助手,只负责查 CloudLedger 帮助中心并整理结论,不直接面对用户。
用工具把任务里涉及的每一点都查清楚。最后输出不超过 300 字的结论,每条结论后标注出处 id,
查不到的点明确写「帮助中心未提及」。"""


def run_subagent(task: str, max_steps: int = 8) -> str:
    messages: list[Any] = [{"role": "system", "content": SUB_SYSTEM}, {"role": "user", "content": task}]
    for _ in range(max_steps):
        msg = chat_raw(messages, tools=TOOLS, temperature=0)
        if not msg.tool_calls:
            return msg.content or ""
        messages.append({"role": "assistant", "content": msg.content,
                         "tool_calls": [tc.model_dump() for tc in msg.tool_calls]})
        for tc in msg.tool_calls:
            try:
                result = FUNCS[tc.function.name](**json.loads(tc.function.arguments or "{}"))
            except Exception as e:  # noqa: BLE001
                result = f"工具调用失败:{e}"
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
    return "子任务未在步数上限内完成,已查到的信息不完整。"


# 主 Agent 看到的是一个普通工具,它不关心工具内部是不是又跑了一个 Agent
RESEARCH_TOOL = {"type": "function", "function": {
    "name": "research",
    "description": "把一个需要查多篇帮助文章的问题交给调研助手,返回整理好的结论(带出处)。"
                   "适合「对比几种套餐」「列出所有和发票有关的规则」这类需要翻很多资料的任务。",
    "parameters": {"type": "object", "properties": {
        "task": {"type": "string", "description": "要调研的问题,写清楚需要覆盖哪些方面"},
    }, "required": ["task"]},
}}

if __name__ == "__main__":
    print(run_subagent("对比免费版、专业版、企业版在账本数、成员数、导出次数、能否开专票、退款规则上的区别"))
```

注意 `RESEARCH_TOOL` 的设计:对主 Agent 来说,`research` 就是一个普通工具,和 `search_kb` 没有区别,它不需要知道工具内部又跑了一个完整的 Agent 循环。这种「Agent 当工具用」的写法是最简单的多 Agent 形态,Day 26 会在此基础上讲 orchestrator-worker 和 handoff。

隔离不是免费的。Anthropic 在介绍他们的多 Agent 调研系统时给过一组数字:按他们的数据,Agent 的 token 消耗大约是普通聊天的 4 倍,多 Agent 系统大约是 15 倍。子 Agent 省的是主对话的上下文,花的是总 token。所以只有「需要大量探索、但结论很短」的子任务才值得隔离。简单的单点查询直接调 `search_kb` 就好。

## Agent Harness:把这些拼在一起的那一层

如果你最近在看国内的 JD,会发现「Agent Harness」「Agent Infra」这两个词出现得越来越多,腾讯、美团、字节、百度都有岗位标题直接带着它们。站长 2026 年 10 月抓了 120 条国内 Agent 岗位的 JD 做统计,提到上下文工程或上下文管理的占 66%,是国内 JD 里出现最多的要求之一,海外同类 JD 只有 25% 左右。国内大厂明显更看重 Agent 内部机制。所以今天这些内容,不是锦上添花,是面试的主战场。

Harness 原意是马具、挽具:把马的力气接到车上的那套东西。放在 Agent 里,**模型是马,harness 是模型之外让它能干活的全部工程**。Anthropic 在 2025 年 11 月的文章《Effective harnesses for long-running agents》里,直接把 Claude Agent SDK 称为一个「通用的 agent harness」,并提到它自带 compaction 这类上下文管理能力。综合各家的用法,一个 harness 通常包括:

- Agent 循环:调模型、解析工具调用、执行、回传、判断结束(Day 9),加上步数和预算上限(Day 12)。
- 工具和能力的注册与加载:工具定义、MCP server 接入(Day 22–23),以及 Skills 这类「按需加载的能力包」:平时只在上下文里放一行简介,任务需要时才把完整说明和脚本加载进来。这其实就是今天讲的 just-in-time 思路用在工具和指令上。
- 上下文组装:每一轮决定窗口里放什么。system prompt、工具定义、记忆召回、检索结果、裁剪和压缩后的历史,就是今天这一整课。
- 状态持久化和恢复:checkpoint、会话存储、长任务中断后接着跑(Day 25、Day 37)。Anthropic 那篇文章讨论的正是跨很多个上下文窗口的长任务怎么接力:让 Agent 在每个窗口结束前留下进度记录,下一个窗口先读记录再继续。
- 执行环境和安全:代码在沙箱里跑、权限分级、敏感操作人工确认(Day 39–40)。
- 可观测:每一步的 trace、token、耗时(Day 34)。

你会发现,这门课从 W2 到 W6 做的几乎每件事,都是在搭 harness 的某一块。今天的 `agentic_rag.py` 加上裁剪、压缩、工具结果清理、子 Agent、记忆,已经是一个很小但五脏俱全的 harness 了。面试被问「你怎么理解 Agent Harness」,用这张清单回答,并且指着自己写过的代码说「这一块我是这么实现的」,比背定义有说服力得多。

## 动手练习

1. 跑 `context_budget.py`,确认输出和我贴的一样。然后构造一个包含工具调用的消息列表(assistant 带 `tool_calls`,后面跟 `tool` 消息),验证 `trim_history` 不会把它们拆开。
2. 写一段 10 轮的模拟客服对话,第 1 轮里用户说明「我们是年付企业版」,第 10 轮问「那我现在能退款吗」。分别用 `trim_history(budget=很小)` 和 `compact()` 处理,再把结果交给 Day 19 的 RAG 回答,比较两者的回答。
3. 跑 `memory_store.py` 两次,看第二次是更新还是新增。再写一段「我们刚从专业版升级到企业版了」的对话,看 profile 有没有被正确更新。
4. 跑 `agentic_rag.py`,把三个问题各自调用了哪些工具、几次,填进表格:

| 问题 | 工具调用序列 | 总步数 | 回答对吗 |
| --- | --- | --- | --- |
| 谢谢你,上次的问题解决了 |  |  |  |
| 发票抬头写错了,而且我想退款,怎么弄 |  |  |  |
| 外币的账怎么记 |  |  |  |

5. 跑 `tool_clearing.py`,确认输出和我贴的一致。然后把 `clear_old_tool_results` 接进 `agentic_rag.py` 的循环(每次调模型前处理一次 `messages`),问一个需要查三四次的问题,对比接入前后每一步的输入 token(看 API 返回的 `usage.prompt_tokens`)。
6. 跑 `subagent.py` 的套餐对比任务,记下子 Agent 内部一共调了几次工具、用了多少 token,和最终交回的结论有多长。再把同样的问题直接交给 `agentic_rag.run()`,比较主对话的上下文长度。
7. (选做)把 Day 19 的评估集用 Agentic RAG 跑一遍生成评估,和固定 RAG 比较忠实率、完整率和平均调用次数。

**验收标准:** 六个脚本都能跑;能讲清楚「按轮裁剪」为什么必要;记忆写入能去重;Agentic RAG 对多问题会分别检索;能用数字说明工具结果清理和子 Agent 各省了多少上下文;能说出至少三条固定 RAG 和 Agentic RAG 的取舍;能用自己的代码解释 Agent Harness 由哪几块组成。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 上下文工程(context engineering) | 管理每次模型调用时上下文窗口里放什么、放多少、怎么放 |
| context rot(上下文腐烂) | 上下文越长,模型准确使用其中信息的能力越差 |
| 注意力预算 | Anthropic 的比喻:模型的注意力有限,每个 token 都在消耗它 |
| 裁剪(trim) | 超出预算时丢弃最早的对话 |
| 压缩(compaction) | 把旧对话总结成摘要,保留最近几轮原文 |
| 工具结果清理 | 把早期工具调用的原始结果替换成简短说明 |
| 短期记忆 | 当前会话的上下文,会话结束即消失 |
| 长期记忆 | 跨会话保存的用户信息,需要独立存储 |
| 语义/情景/程序记忆 | 关于用户的事实 / 发生过的事件 / 做事的规则 |
| Agentic RAG | 把检索做成工具,由 Agent 决定何时、如何检索 |
| just-in-time 检索 | 只持有轻量引用,需要时再加载具体内容 |
| MemGPT / Letta | 让 Agent 像操作系统管理内存一样管理自己上下文的方案 |
| 子 Agent / 上下文隔离 | 子任务在独立的消息列表里完成,只把精简结论交回主 Agent |
| Agent Harness | 模型之外让 Agent 能干活的整套工程:循环、工具与 Skills 加载、上下文组装、状态持久化、沙箱、可观测 |
| Skills | 按需加载的能力包:平时只放简介,用到时才加载完整说明和脚本 |

## 常见误区

**窗口够大就全塞进去。** 贵、慢,而且模型会变笨。上下文是稀缺资源。

**按条数而不是按轮裁剪历史。** 会留下没有对应 `tool_calls` 的 `tool` 消息,接口直接报 400。

**压缩 prompt 写得太笼统。** 「总结一下」会把业务关键信息当细节丢掉。要明确列出必须保留的信息,并用评估验证。

**什么都往长期记忆里存。** 存得越多,召回时噪音越大,还有隐私风险。抽取时要有明确的记什么、不记什么的规则。

**记忆查询不带 user_id 过滤。** 一个用户的记忆被另一个用户召回,是严重的隐私事故。

**上来就做 Agentic RAG。** 它更灵活,但慢、贵、难调试。先用固定流程,在评估数据证明需要时再升级。

**什么子任务都开子 Agent。** 子 Agent 省的是主对话的上下文,花的是总 token。按 Anthropic 的数据,多 Agent 系统的 token 消耗大约是普通聊天的 15 倍。只有「探索量大、结论短」的任务才值得隔离。

**清理工具结果时连 tool_calls 一起删。** 和按条裁剪一样会破坏消息结构。只替换旧 tool 消息的 content。

**没有删除记忆的能力。** 用户要求删除时删不掉,既是产品问题也是合规问题。

## 学习资料

### 文档与文章

- [Anthropic · Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):今天的核心阅读,讲注意力预算、just-in-time 检索、压缩、结构化笔记、子 Agent,1 小时。
- [LangChain · Context Engineering for Agents](https://blog.langchain.com/context-engineering-for-agents/):write/select/compress/isolate 四类手段,每类都配了真实产品的例子,40 分钟。
- [Chroma · Context Rot](https://research.trychroma.com/context-rot):长上下文性能下降的实验报告,看图就能明白。
- [Lilian Weng · LLM Powered Autonomous Agents](https://lilianweng.github.io/posts/2023-06-23-agent/):经典综述,读其中 Memory 一节,讲短期/长期记忆和检索的关系,30 分钟。
- [Anthropic · Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):2025 年 11 月的文章,讲长任务跨多个上下文窗口时 harness 该怎么设计,把 Claude Agent SDK 称作通用 agent harness。理解「harness」这个词最好的一手材料,40 分钟。
- [Anthropic · How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):子 Agent 隔离上下文的真实案例,4 倍和 15 倍 token 的数字出自这里,Day 26 会精读,今天先看「为什么多 Agent 有效」那一节。
- [MemGPT 论文](https://arxiv.org/abs/2310.08560):读摘要和第 2 节的架构图,理解「虚拟上下文管理」的思路。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11zbPzVEUe&autoplay=0&high_quality=1" title="Context Engineering:概念与技术实现深度解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · Context Engineering:概念与技术实现深度解析 · 15 分钟,全看。把上下文工程的概念和常见技术讲得很清楚,和今天第一部分对应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NgUsBYECA&autoplay=0&high_quality=1" title="拒绝无效沟通!上下文工程(Context Engineering)四大核心实现策略大公开!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>写代码的阿咪 · 拒绝无效沟通!上下文工程(Context Engineering)四大核心实现策略大公开! · 16 分钟,讲的就是 write/select/compress/isolate 四类策略,适合配合 LangChain 那篇文章看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/4GiqzUHD5AA" title="Context Engineering for Agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Context Engineering for Agents · 22 分钟,Lance Martin 本人讲解,配合上面那篇博客看,有代码演示。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/0z9_MhcYvcY" title="What is Agentic RAG?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · What is Agentic RAG? · 6 分钟,白板讲清楚固定 RAG 和 Agentic RAG 的区别。</figcaption>
</figure>

- IBM Technology《The Four Types of Memory Every AI Agent Needs》(YouTube ID `BacJ6sEhqMo`,11 分钟):Agent 记忆分类的讲解。
- LangChain《Memory for agents (conceptual video)》(YouTube ID `JTL0yp85FsE`,7 分钟):语义、情景、程序记忆的概念介绍。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章「RAG and Agents」后半部分关于 Agent 和 memory 的小节:讲了记忆的几种实现和取舍,1 小时。
- 这个主题变化太快,书比博客落后。今天以 Anthropic 和 LangChain 的两篇文章为主。

### 开源项目与代码

- [mem0ai/mem0](https://github.com/mem0ai/mem0):即插即用的 Agent 记忆层,看它的 README 里记忆的增删改流程,和今天的手写版本对比。
- [letta-ai/letta-code](https://github.com/letta-ai/letta-code):MemGPT 的工程化版本,Letta 当前的主仓库;旧的 `letta-ai/letta` 服务端已归档到 archive 分支。
- [microsoft/ai-agents-for-beginners](https://github.com/microsoft/ai-agents-for-beginners):其中 Agentic RAG 和 Agent memory 两课有中文翻译和示例代码。
- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):中文 Agent 教程,有记忆与上下文相关章节。

## 自测

**1. 上下文窗口有 128k,你的客服 Agent 每次只用了 8k。为什么不把整个帮助中心(约 6 万 token)都放进去?**

<details><summary>答案</summary>

三个原因:成本,每次调用多付 6 万 token 的输入费;延迟,首 token 变慢;质量,上下文越长模型越难准确找到并使用相关信息(context rot、lost in the middle)。只放相关的几块,便宜、快、准。例外是知识库很小且稳定时,全量放入配合 prompt caching 也是合理选择,但要用评估验证。

</details>

**2. 为什么裁剪历史要「按轮」而不是「按条」?**

<details><summary>答案</summary>

一轮对话可能包含 user 消息、带 tool_calls 的 assistant 消息和若干 tool 结果消息。按条删可能删掉发起调用的 assistant 消息,留下孤立的 tool 消息,接口会报错;也可能留下一个没有结果的 tool_calls。按轮删能保证消息结构完整。

</details>

**3. 压缩和裁剪各自的代价是什么?什么时候用哪个?**

<details><summary>答案</summary>

裁剪零成本,但被丢掉的信息完全消失。压缩多一次模型调用、增加延迟,而且摘要会丢细节。一般先设置较宽的历史预算,超出时优先清理旧的工具结果,接近上限时再做摘要压缩;对需要依赖早期信息(身份、已确认的事项)的业务,压缩比直接裁剪好,压缩 prompt 要列明必须保留的信息。

</details>

**4. 长期记忆写入时为什么要做去重?你的去重策略有什么缺陷?**

<details><summary>答案</summary>

不去重会积累大量重复或过时的记忆,召回时噪音大,还可能出现「专业版」和「企业版」两条矛盾信息。用相似度阈值去重的缺陷:阈值依赖模型、需要校准;无法区分「更新」(升级了套餐)和「矛盾」(说法不一致需要确认);语义相近但其实是两件事的记忆可能被错误合并。改进方法是让大模型判断新旧记忆的关系(新增、更新、删除、忽略)。

</details>

**5.(面试题)什么是 Agent Harness?如果让你设计一个,包含哪些模块?**

<details><summary>答案</summary>

Harness 是模型之外让 Agent 能干活的整套工程,模型负责推理和决策,harness 负责把它接到真实世界并管住它。模块:Agent 循环(调用、工具解析与执行、结束判断、步数和预算上限);工具与能力的注册和加载(函数工具、MCP、Skills 按需加载);上下文组装(system、工具定义、记忆召回、检索结果、历史的裁剪/工具结果清理/摘要压缩、子 Agent 隔离);状态持久化与恢复(checkpoint、长任务进度记录);执行环境与安全(沙箱、权限分级、人工确认);可观测(trace、token、耗时、成本)。回答时最好每一块都举一个自己实现过的例子,比如「工具结果清理我只替换旧 tool 消息的 content,保留 tool_calls,避免接口报错」。

</details>

**6.(面试题)设计一个客服 Agent 的记忆系统,用户下次来时能记住他的套餐和上次的问题。你会怎么设计?要注意什么?**

<details><summary>答案</summary>

分短期和长期:短期是当前会话的消息,按 thread_id 存在会话存储,配合裁剪和压缩控制长度。长期记忆:会话结束后异步用 LLM 抽取 profile(套餐、付费方式)、preference(联系偏好)、event(上次的问题和结果),写入带向量的表,写入前查重或让 LLM 判断更新关系;读取时 profile 全部带上,其他按当前问题相关性取少量。注意点:严格按 user_id/租户隔离;不存敏感信息(卡号、身份证、密码),合规要求下要能导出和删除;记忆可能过时,带时间戳,和业务系统的真实数据冲突时以业务系统为准(套餐应该直接查订阅表,记忆只做补充);记忆质量要纳入评估(构造多会话场景测试)。能想到「套餐这种事实应查业务库而不是靠记忆」是加分项。

</details>

## 明天预告

Day 21 · W3 复习 + 小项目:带引用出处的文档问答 Agent。明天把这一周的东西拼成一个完整的项目:pgvector 增量索引、混合检索加 rerank、多轮对话的 query 改写和历史压缩、带引用的回答、一键跑的评估脚本,外加 W3 的面试题汇总和踩坑清单。它会成为 W4 工单 Agent 的知识库模块。
