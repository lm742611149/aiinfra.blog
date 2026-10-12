---
title: 'Day 63 · 上下文工程进阶:长任务里的压缩、外部记忆和缓存命中'
description: '跑五十步的 Agent,上下文会变成最贵也最容易出错的地方。今天看三份一手资料:Chroma 的上下文腐烂实验、Anthropic 的上下文工程文章、Manus 围绕 KV 缓存命中率的六条经验,然后写一个按「轮」裁剪的分层上下文管理器,最后设计一个实验,在自己的任务上比较几种策略的成功率和成本。'
pubDate: 2026-10-12
regime: none
tags: ['context-engineering', 'compaction', 'prompt-caching', 'long-horizon', 'agent-60']
series: 'agent-60'
day: 63
lang: 'zh'
---

## 今天要解决的问题

基础篇 Day 20 讲过上下文工程的基本功:窗口预算、摘要压缩、长期记忆。那时候 SupportPilot 处理一张工单只要五六步,上下文从来没真正撑满过。到了平台上,情况变了:财务团队想要一个 Agent 核对客户一整年的账单,研发团队想要一个 Agent 在代码库里跑几十个文件。这类任务动辄五十步以上,每一步的工具结果都往上下文里堆。

这时候会同时遇到三个问题。效果变差:上下文越长,模型越容易漏看、看错。成本变高:每一步都要把前面所有内容重新发一遍。延迟变大:首个 token 的等待时间跟输入长度直接相关。国内 Agent 岗位 JD 里「上下文」这个词出现了 52%,资深岗里也有 54%,招聘方问的就是这些问题怎么解。

学完今天你应该能:

1. 用实验结论说明为什么「窗口够大就全塞进去」是错的。
2. 解释为什么 KV 缓存命中率是生产 Agent 最重要的成本指标之一,以及上下文要怎么排才能命中。
3. 写一个按「轮」裁剪、分三层压缩、前缀稳定的上下文管理器,替换昨天 harness 里的 `KeepLastN`。
4. 设计一个对比实验,用数据决定你的系统该用哪种策略。

预计用时 5 小时。前置:Day 20(上下文工程基础)、Day 38(prompt caching)、Day 62(harness)。

## 上下文腐烂:窗口大不等于看得清

很多人的直觉是:模型支持 100 万 token,那我的任务只用到 10 万,完全没问题。实验结果不支持这个直觉。

最早被广泛引用的是 2023 年斯坦福等机构的论文《Lost in the Middle》。他们把答案藏在一堆文档的不同位置,发现模型对开头和结尾的信息利用得最好,放在中间的明显变差,画出来是一条 U 形曲线。

2025 年 7 月,向量数据库公司 Chroma 发了一份叫《Context Rot》的技术报告,把这件事测得更细。他们测了十几个主流模型,用的都是很简单的任务,比如在一段长文本里找一句话、或者原样重复一串词。结论是:即使任务难度不变,只要输入变长,各个模型的表现都会下降,而且下降并不均匀;如果上下文里有和答案相似但不相关的「干扰项」,下降得更厉害。报告的标题就叫「上下文腐烂」,意思是上下文本身会随着长度变质。

Anthropic 2025 年 9 月那篇《Effective context engineering for AI agents》把它总结成一句话:上下文是一种边际收益递减的有限资源,模型有一个「注意力预算」,每多放一个 token 都在消耗它。所以上下文工程的目标不是塞得越多越好,而是**找到最小的、信号最强的那组 token**。

对 Agent 来说,最大的噪音来源是工具结果。一次查询返回两千字的发票明细,模型用完其中一行就不再需要,但它会在上下文里一直待到任务结束,后面四十步每一步都要为它付费、被它干扰。

## Manus 的六条经验:围绕 KV 缓存设计

2025 年 7 月,Manus 的联合创始人季逸超写了一篇《Context Engineering for AI Agents: Lessons from Building Manus》,是目前讲生产 Agent 上下文最实在的一篇。他开篇就说,如果只能选一个指标,他会选 **KV 缓存命中率**,因为它同时决定了延迟和成本。

道理是这样的。Agent 和聊天机器人不一样,每一步的输入是整个历史,输出往往只是一个简短的工具调用。他们统计 Manus 的平均输入输出比大约是 100 比 1。输入这么大,能不能复用上一步已经算过的前缀就变得极其关键。他举的价格例子是 Claude Sonnet:命中缓存的输入每百万 token 0.30 美元,不命中是 3 美元,差 10 倍。

围绕这一点,文章给了六条做法,我按对我们的重要程度重新排一下:

**一、前缀保持稳定**。缓存是按前缀匹配的,前面任何一个 token 变了,后面全部失效。最常见的错误是在系统提示词开头放一个精确到秒的时间戳,每次请求都不一样,缓存永远命中不了。

**二、上下文只追加不修改**。不要回头改之前的动作和观察。还有一个容易忽略的细节:很多语言的 JSON 序列化不保证键的顺序,同样的对象两次序列化出来不一样,缓存也会悄悄失效。

**三、工具用遮蔽而不是删除**。工具多了以后,很自然想按场景动态加载和卸载工具。但工具定义通常放在上下文最前面,一改就让整个缓存失效;而且如果历史里的动作引用了一个已经不存在的工具,模型会困惑。Manus 的做法是工具列表不动,在解码时用约束(logits 遮蔽)限制模型这一步能选哪些工具。用 API 的话做不到 logits 层面,但可以借鉴思路:工具列表尽量固定,用提示词或 `tool_choice` 去约束。

**四、把文件系统当上下文**。超长的网页、文档不用全留在上下文里,只要保留能找回它的东西(URL、文件路径),内容可以丢掉,需要时再读。他管这叫「可恢复的压缩」。

**五、用复述操纵注意力**。Manus 处理复杂任务时会创建一个 `todo.md` 并逐步打勾。一个典型任务平均要五十次左右的工具调用,目标很容易在中间被遗忘;不断改写 todo 列表,相当于把目标反复写到上下文的末尾,也就是模型注意力最强的位置。

**六、把错误留在上下文里**。失败的动作和报错不要清掉。模型看到「这么做失败了」,会降低再犯同样错误的概率。另外别让上下文太整齐划一,几十步都是同一个格式的动作和观察,模型容易机械地模仿前面的模式,适当加一点格式上的变化反而更稳。

## 三层压缩:按成本从低到高

把上面的资料和 Anthropic 文章里的做法合起来,我把长任务的上下文压缩分成三层,按代价从低到高依次启用。

**第一层:清理旧工具结果**。只保留最近几次工具调用的完整结果,更早的替换成一行占位,写明「需要时重新调用工具获取」。这一层几乎没有信息损失,因为结果随时可以重新拿到(这就是 Manus 说的可恢复压缩)。Anthropic 的 API 也提供了类似的「context editing」功能,可以自动清理旧的工具结果。代价是它会让缓存从被清理的位置开始失效,所以不要每一步都清,而是超过预算时一次清一批。

**第二层:丢弃最早的轮次**。超过预算就丢掉最早的几轮,留一行「之前的 N 轮已省略」。免费,但信息直接没了,只适合早期内容确实不重要的任务。

**第三层:摘要压缩**。调一次模型,把旧的轮次压成一段摘要,放在系统提示词后面。信息保留最好,但要花一次模型调用,而且摘要可能漏掉关键细节。Claude Code 的「compact」就是这一层。有一个细节 Day 20 的写手踩过:多次压缩时,新摘要要把旧摘要也吸收进去,否则摘要会一段段叠起来越来越长。

除了这三层,还有两个不靠压缩的办法:**外部笔记**,让 Agent 自己把关键发现写到一个文件里(就是 Anthropic 长任务文章里的进度文件),需要时再读;**子 Agent**,把读大量材料的活交给子 Agent,它只交回结论,原始材料从不进主 Agent 的上下文。Day 26 讲过子 Agent 的代价,这里它换来的是主上下文的干净。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="缓存友好的上下文布局:最前面是稳定的系统提示词和工具定义,然后是进展摘要,然后是最近几轮,旧工具结果被替换成占位">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="30" y="40" width="170" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="115" y="64" text-anchor="middle" fill="var(--ink)">system + 工具定义</text>
    <text x="115" y="82" text-anchor="middle" fill="var(--ink-soft)" font-size="10">永远不变</text>
    <rect x="205" y="40" width="110" height="60" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="260" y="64" text-anchor="middle" fill="var(--ink)">进展摘要</text>
    <text x="260" y="82" text-anchor="middle" fill="var(--ink-soft)" font-size="10">压缩时才变</text>
    <rect x="320" y="40" width="50" height="60" rx="4" fill="var(--paper)" stroke="var(--rule)"/><text x="345" y="75" text-anchor="middle" fill="var(--ink-faint)" font-size="10">[已清理]</text>
    <rect x="375" y="40" width="50" height="60" rx="4" fill="var(--paper)" stroke="var(--rule)"/><text x="400" y="75" text-anchor="middle" fill="var(--ink-faint)" font-size="10">[已清理]</text>
    <rect x="430" y="40" width="60" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="460" y="75" text-anchor="middle" fill="var(--ink)" font-size="10">工具结果</text>
    <rect x="495" y="40" width="60" height="60" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="525" y="75" text-anchor="middle" fill="var(--ink)" font-size="10">工具结果</text>
    <rect x="560" y="40" width="50" height="60" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="585" y="75" text-anchor="middle" fill="var(--ink)" font-size="10">todo</text>
    <line x1="30" y1="130" x2="610" y2="130" stroke="var(--rule)"/>
    <line x1="30" y1="122" x2="30" y2="138" stroke="var(--mem)"/><line x1="200" y1="122" x2="200" y2="138" stroke="var(--mem)"/>
    <text x="115" y="155" text-anchor="middle" fill="var(--mem)">每一步都命中缓存</text>
    <line x1="205" y1="122" x2="205" y2="138" stroke="var(--ink-faint)"/><line x1="610" y1="122" x2="610" y2="138" stroke="var(--ink-faint)"/>
    <text x="408" y="155" text-anchor="middle" fill="var(--ink-faint)">压缩或清理之后才会失效一次</text>
    <text x="30" y="200" fill="var(--ink-soft)">反例:system 开头放「当前时间 14:03:27」</text>
    <text x="30" y="220" fill="var(--ink-soft)">      → 前缀每秒都在变,一次也命中不了</text>
  </g>
</svg>
<figcaption>缓存友好的上下文布局。越不变的东西越往前放;最近的工具结果和 todo 放在末尾,这里模型注意力最强。</figcaption>
</figure>

## 写一个分层上下文管理器

昨天的 harness 留了一个坑:按条数裁剪会拆散工具调用和它的结果。下面这个实现先把消息切成「轮」,一轮是一条 user 或 assistant 消息加上紧跟着的所有 tool 结果,裁剪只在轮与轮之间发生。然后按上面的三层依次启用。

```python
# agentops/runtime/context.py
"""按「轮」管理上下文:清理旧工具结果、超预算时压缩、保持前缀稳定。"""
from __future__ import annotations

import json
from typing import Callable


def est_tokens(msg: dict) -> int:
    """粗估 token:中文约 1 字 1 token,英文约 4 字符 1 token。够做预算判断。"""
    text = json.dumps(msg, ensure_ascii=False)
    cjk = sum(1 for ch in text if "一" <= ch <= "鿿")
    return cjk + (len(text) - cjk) // 4 + 4


def split_rounds(messages: list[dict]) -> tuple[list[dict], list[list[dict]]]:
    """把消息切成 [前缀] + 若干轮。一轮 = 一条 user 或 assistant 消息 + 紧跟着的 tool 结果。"""
    prefix = [m for m in messages if m["role"] == "system"]
    rounds: list[list[dict]] = []
    for m in messages:
        if m["role"] == "system":
            continue
        if m["role"] == "tool" and rounds:
            rounds[-1].append(m)  # tool 结果永远跟着它的 assistant,不会被拆开
        else:
            rounds.append([m])
    return prefix, rounds


class LayeredContext:
    """三层策略,按成本从低到高依次启用:
    1. 清理旧工具结果(几乎免费)
    2. 丢弃最早的几轮,留一行占位(免费,但会丢信息)
    3. 调模型把旧轮次压成摘要(花钱,信息保留最好)
    """

    def __init__(self, budget: int = 24_000, keep_tool_results: int = 3, keep_recent_rounds: int = 6,
                 summarize: Callable[[list[dict]], str] | None = None):
        self.budget = budget
        self.keep_tool_results = keep_tool_results
        self.keep_recent_rounds = keep_recent_rounds
        self.summarize = summarize
        self.summary = ""  # 历次压缩合并后的摘要
        self.stats = {"cleared": 0, "dropped_rounds": 0, "summaries": 0}

    def _size(self, prefix, rounds) -> int:
        return sum(est_tokens(m) for m in prefix) + sum(est_tokens(m) for r in rounds for m in r)

    def _clear_old_tool_results(self, rounds):
        tool_msgs = [m for r in rounds for m in r if m["role"] == "tool"]
        for m in tool_msgs[: max(0, len(tool_msgs) - self.keep_tool_results)]:
            if not m["content"].startswith("[已清理]"):
                m["content"] = f"[已清理] 原结果 {len(m['content'])} 字,需要时重新调用工具获取"
                self.stats["cleared"] += 1

    def prepare(self, messages: list[dict]) -> list[dict]:
        msgs = [dict(m) for m in messages]  # 不改调用方手里的历史
        prefix, rounds = split_rounds(msgs)
        if self._size(prefix, rounds) > self.budget:
            self._clear_old_tool_results(rounds)
        if self._size(prefix, rounds) > self.budget and len(rounds) > self.keep_recent_rounds:
            old, rounds = rounds[: -self.keep_recent_rounds], rounds[-self.keep_recent_rounds:]
            if self.summarize:
                flat = [m for r in old for m in r]
                if self.summary:
                    flat = [{"role": "user", "content": f"之前的摘要:{self.summary}"}] + flat
                self.summary = self.summarize(flat)  # 新摘要吸收旧摘要,不会越叠越长
                self.stats["summaries"] += 1
            else:
                self.stats["dropped_rounds"] += len(old)
                self.summary = self.summary or f"(更早的 {len(old)} 轮对话已省略)"
        if self.summary:
            # 摘要放在前缀之后、最近轮次之前。前缀(system)永远不变,缓存才能命中。
            rounds = [[{"role": "user", "content": f"[之前进展摘要] {self.summary}"}]] + rounds
        return prefix + [m for r in rounds for m in r]
```

它实现了昨天 harness 的 `ContextManager` 接口,所以直接替换就行:`Harness(model, tools, context=LayeredContext(budget=24_000, summarize=my_summarizer))`。

用一段造出来的长历史测一下。下面的脚本模拟一个翻了 30 页发票的核对任务,每页工具结果约一千 token:

```python
# agentops/runtime/context_demo.py
from context import LayeredContext, est_tokens, split_rounds

SYSTEM = {"role": "system", "content": "你是 CloudLedger 客服 Agent。" + "规则说明。" * 300}


def fake_history(turns: int) -> list[dict]:
    msgs = [SYSTEM, {"role": "user", "content": "帮我核对客户 C007 过去一年的所有发票和退款记录。"}]
    for i in range(turns):
        msgs.append({"role": "assistant", "content": "", "tool_calls": [{"id": f"c{i}", "name": "get_invoice_page"}]})
        msgs.append({"role": "tool", "tool_call_id": f"c{i}", "content": f"第 {i} 页发票明细:" + "INV-xxxx 金额 468 已付;" * 120})
    return msgs


def total(msgs):
    return sum(est_tokens(m) for m in msgs)


hist = fake_history(30)
print("原始:", len(hist), "条,约", total(hist), "token")

only_clear = LayeredContext(budget=24_000)
out = only_clear.prepare(hist)
print("清理旧工具结果后:", len(out), "条,约", total(out), "token", only_clear.stats)

fake_summarize = lambda msgs: f"已核对 {sum(1 for m in msgs if m['role']=='tool')} 页发票,暂未发现重复扣款。"
layered = LayeredContext(budget=4_000, summarize=fake_summarize)
out = layered.prepare(hist)
print("再加压缩后:", len(out), "条,约", total(out), "token", layered.stats)

prefix, rounds = split_rounds(out)
paired = all(r[0]["role"] != "tool" for r in rounds)
print("每轮都以非 tool 消息开头(没有拆散工具调用):", paired)
print("前缀是否和原来一样(缓存友好):", prefix[0] == SYSTEM)
```

在本机运行的输出:

```text
原始: 62 条,约 30759 token
清理旧工具结果后: 62 条,约 6017 token {'cleared': 27, 'dropped_rounds': 0, 'summaries': 0}
再加压缩后: 14 条,约 4468 token {'cleared': 27, 'dropped_rounds': 0, 'summaries': 1}
每轮都以非 tool 消息开头(没有拆散工具调用): True
前缀是否和原来一样(缓存友好): True
```

几个观察。只做第一层,token 就从三万降到六千,降了八成,而且一条消息都没删。这说明在工具结果很大的任务里,第一层就能解决大部分问题,不用急着上摘要。第二种配置预算定得很紧(4000),第一层不够,于是触发了一次摘要,剩下 14 条。最终 4468 还是超过了 4000,因为系统提示词本身就有一千多 token,而最近 6 轮是强制保留的。预算是软目标,保证不拆散最近的工作比卡死数字更重要。

这里的 token 数是用字符粗估的,和真实 tokenizer 会有出入,做预算判断够用,算钱要以 API 返回的 `usage` 为准。

还要提醒一个和缓存相关的取舍:第一层每次触发,被清理的那条工具结果之后的缓存都会失效。如果每一步都清一条,等于每一步都让一大段缓存失效。所以实现里是「超预算时一次清一批」,清完之后很多步都不用再动。

## 设计一个对比实验

到这里你可能想问:三层到底该怎么配,预算定多少,保留几次工具结果?网上没有标准答案,因为答案取决于你的任务。资深的做法是在自己的任务上做实验。

**任务集**。从 SupportPilot 和 AgentOps 的场景里挑 20 个长任务,每个至少需要 20 步工具调用,比如「核对客户全年发票,找出所有重复扣款」。每个任务要有明确可判定的答案(找出了哪几张发票),用代码判对错,不要用 LLM 评审,以免评审本身引入噪音。

**对比的策略**。至少四组:不做任何管理(基线)、只做第一层、第一层加摘要、第一层加外部笔记文件。

**要记录的指标**。任务成功率;每个任务的总输入 token;其中命中缓存的 token(DeepSeek 在 `usage` 里返回 `prompt_cache_hit_tokens` 和 `prompt_cache_miss_tokens`,OpenAI 是 `prompt_tokens_details.cached_tokens`,Anthropic 是 `cache_read_input_tokens`);总花费;总耗时。

**重复次数**。每个任务每种策略至少跑 3 次,因为同一个任务跑两次结果可能不一样。20 个任务乘 4 种策略乘 3 次,一共 240 次运行,用 DeepSeek 跑大约几十块钱。Day 69 会讲怎么判断差异是不是显著,今天先把数据收集好。

| 策略 | 成功率 | 平均输入 token | 缓存命中比例 | 平均花费(元) | 平均耗时(秒) |
| --- | --- | --- | --- | --- | --- |
| 不管理 | | | | | |
| 只清理工具结果 | | | | | |
| 清理 + 摘要 | | | | | |
| 清理 + 外部笔记 | | | | | |

我没有在真模型上跑过这个实验,表格留给你填。可以预先写下你的猜测,跑完再对照,看自己的直觉准不准,这本身就是一种训练。

## 动手练习

**第一步:读三份资料。** Chroma《Context Rot》、Anthropic《Effective context engineering for AI agents》、Manus 那篇。每篇写三行笔记:它说了什么、证据是什么、AgentOps 要不要跟着改。

**第二步:跑通上下文管理器。** 把 `context.py` 和 `context_demo.py` 放进 `agentops/runtime/`,跑出和上面一样的数字。再把它接进 Day 62 的 harness,替换 `KeepLastN`。

**第三步:写一个真的 summarize。** 用你的 `LLMClient` 实现 `summarize(messages) -> str`,提示词要求它保留:已确认的事实(带编号的)、已做过的操作、还没完成的事项、失败过的尝试。不要只写「请总结以上对话」。

**第四步:检查缓存命中。** 用 DeepSeek 跑一个 10 步以上的任务,打印每一步 `usage` 里的 `prompt_cache_hit_tokens`。然后故意在 system 开头加一个当前时间戳再跑一次,对比命中数。

**第五步:做实验。** 至少挑 5 个长任务、3 种策略、各跑 2 次,填上面的表。

**验收标准**:上下文管理器替换后 harness 正常运行且没有出现不配对的工具消息;能拿出加时间戳前后缓存命中的对比数字;实验表至少填了 5 个任务的数据,并写一段结论说明你会给 AgentOps 选哪种默认策略、为什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 上下文腐烂 context rot | 输入越长模型表现越差的现象,即使任务难度不变 |
| 注意力预算 | Anthropic 的说法,上下文里每个 token 都在消耗模型有限的注意力 |
| KV 缓存 | 模型对已处理过的前缀保存的中间计算结果,命中后不用重算,更快更便宜 |
| 缓存命中率 | 输入 token 中命中缓存的比例 |
| 可恢复压缩 | 丢掉内容但保留找回它的线索(URL、文件路径、工具参数) |
| compaction | 把旧对话压成摘要继续工作,Claude Code 等工具里的叫法 |
| 复述 recitation | 让 Agent 不断改写 todo 之类的目标列表,把目标保持在上下文末尾 |

## 常见误区

**窗口够大就全塞进去。** 上下文腐烂的实验说明,长度本身就会降低表现,还会推高成本和延迟。窗口大小是上限,不是建议用量。

**在系统提示词开头放时间戳。** 这是让缓存命中率归零最常见的原因。需要时间信息就放在最后一条用户消息里,或者只精确到天。

**按消息条数裁剪。** 会拆散工具调用和结果,轻则模型困惑,重则 API 直接报错。永远以「轮」为单位裁剪。

**一上来就做摘要压缩。** 摘要要花钱,还可能丢细节。工具结果很大的任务,先清理旧工具结果往往就够了。先用便宜的办法,不够再升级。

**把失败的尝试从上下文里清掉,让它「看起来干净」。** 模型需要看到失败才能避免重复。清理要清的是体积大、可恢复的工具结果,不是错误信息。

**凭别人的结论选策略。** 别人的任务不是你的任务。资深的做法是在自己的任务集上跑对比,用数据定默认值。

## 学习资料

### 文档与文章

- [Anthropic《Effective context engineering for AI agents》](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):今天的主线,注意力预算、即时检索、压缩、结构化笔记、子 Agent 几种手段讲得很完整。30 分钟。
- [Manus《Context Engineering for AI Agents: Lessons from Building Manus》](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus):KV 缓存命中率、遮蔽工具、文件系统当上下文、todo 复述,每一条都可以直接用。30 分钟。
- [Chroma《Context Rot》](https://research.trychroma.com/context-rot):上下文腐烂的实验报告,看实验设计和图表。20 分钟。
- [《Lost in the Middle》论文](https://arxiv.org/abs/2307.03172):U 形曲线的出处,读摘要和图 1 即可。
- [LangChain《Context engineering for agents》](https://blog.langchain.com/context-engineering-for-agents/):把上下文工程归纳成写入、选择、压缩、隔离四类,和今天的三层可以互相对照。
- [Claude 的 context editing 文档](https://docs.claude.com/en/docs/build-with-claude/context-editing):API 层面自动清理旧工具结果的功能。
- [DeepSeek 上下文硬盘缓存文档](https://api-docs.deepseek.com/guides/kv_cache):`prompt_cache_hit_tokens` 字段的说明和命中规则,第四步练习要用。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nJ396JEmC&autoplay=0&high_quality=1" title="Claude Code 为什么不会撑爆上下文?深入解析 Agent 上下文压缩与会话恢复机制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>唐国梁Tommy · Claude Code 为什么不会撑爆上下文?深入解析 Agent 上下文压缩与会话恢复机制 · 14 分钟,讲上下文投影、压缩、缓存和会话恢复的全过程,和今天的三层压缩正好对应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1L3hg6eEhg&autoplay=0&high_quality=1" title="10分钟带你吃透生产级Agent上下文管理架构!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI敲代码的阿Q · 10分钟带你吃透生产级Agent上下文管理架构 · 10 分钟的概览,播放量不高但内容扎实,可以当复习。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/6_BcCthVvb8" title="Context Engineering for AI Agents with LangChain and Manus" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Context Engineering for AI Agents with LangChain and Manus · LangChain 的 Lance Martin 和 Manus 的季逸超一起讲,Manus 那篇文章的现场版,有不少文章里没写的细节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/IS_y40zY-hc" title="Advanced Context Engineering for Agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>YC Root Access · Advanced Context Engineering for Agents · HumanLayer 的 Dex Horthy 讲他们怎么在大代码库里管理上下文,「有意压缩」的思路很实用。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 5 章「Prompt Engineering」和第 6 章「RAG and Agents」:上下文构造和 Agent 记忆的部分,和今天的内容互补。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly,2024):两位作者做过 GitHub Copilot,书里讲「怎么在有限窗口里组装上下文」的几章,是上下文工程最早的系统论述之一。

### 开源项目与代码

- [humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents):第 3 条「Own your context window」专讲上下文,今天读这一条。
- 你的 `agentops/runtime/context.py`:今天的产出,后面 Day 99 的持久化运行时会直接用它。

## 自测

1. Chroma 的上下文腐烂实验用的都是很简单的任务,为什么这反而让结论更有说服力?

<details><summary>答案</summary>

任务简单,说明表现下降不是因为任务变难了,而是输入变长本身造成的。这排除了「长任务本来就难」这个解释。

</details>

2. Manus 为什么把 KV 缓存命中率当成最重要的指标?

<details><summary>答案</summary>

Agent 每一步的输入是整个历史,输出很短,输入输出比大约 100 比 1,成本和延迟几乎都花在输入上。命中缓存的输入在 Claude Sonnet 上便宜 10 倍,首 token 延迟也大幅降低。

</details>

3. 列出三种会让缓存失效的做法。

<details><summary>答案</summary>

系统提示词开头放精确时间戳;回头修改历史中的动作或观察;动态增删工具定义;JSON 序列化键顺序不稳定;每一步都清理一条旧工具结果。任答三条即可。

</details>

4. 三层压缩为什么要按「清理工具结果、丢弃旧轮、摘要」的顺序启用?

<details><summary>答案</summary>

按代价从低到高。清理工具结果几乎不丢信息(可重新获取)且免费;丢弃旧轮免费但丢信息;摘要保留信息最好但要花一次模型调用,还可能漏细节。先用便宜的,不够再升级。

</details>

5. 为什么上下文管理器必须以「轮」为单位裁剪?

<details><summary>答案</summary>

一条 assistant 消息的 tool_calls 必须和对应的 tool 结果成对出现。按条数裁剪可能留下不配对的消息,模型会困惑,很多 API 会直接返回 400。

</details>

6. 资深面试题:「你们的 Agent 跑长任务时成本是预期的 5 倍,而且越往后越容易出错。你会怎么排查和优化?」

<details><summary>答案</summary>

要点:先看数据,每一步的输入 token、缓存命中 token、输出 token,画出随步数的曲线;检查缓存命中率,排查前缀里是否有变化的内容(时间戳、动态工具列表、不稳定的序列化);看上下文构成,哪类内容占比最大,通常是工具结果;按代价从低到高优化:清理旧工具结果、工具结果分页和精简、外部笔记、子 Agent 隔离、最后才是摘要;每个改动都在长任务评测集上对比成功率和成本,而不是只看成本。提到「出错率上升」和上下文腐烂的关系、以及 todo 复述这类保持目标的手段会加分。

</details>

## 明天预告

Day 64 · 记忆系统:短期、长期、情景、语义,怎么写、怎么忘。今天解决的是一次任务内部的上下文,明天解决跨任务、跨会话的记忆:哪些东西值得记、谁来写、怎么检索、冲突了听谁的、什么时候该忘。我们会对比 mem0、Letta、Zep 和 LangGraph store,给 SupportPilot 设计一个客户记忆。
