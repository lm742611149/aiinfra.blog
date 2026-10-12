---
title: 'Day 66 · 编排模式的取舍:单 Agent、工作流、多 Agent、混合'
description: '「该用单 Agent 还是多 Agent」是资深面试最爱问的问题之一,网上的答案两边都有。今天把 Anthropic、Cognition、LangChain 三篇文章的论据摆在一起,拆出决定架构的五个维度,讲清共享状态和消息传递、失败隔离这些细节,再写一个在同一批任务上对比几种架构的实验脚本,最后整理成一棵决策树。'
pubDate: 2026-10-12
regime: none
tags: ['architecture', 'multi-agent', 'workflow', 'experiment', 'agent-60']
series: 'agent-60'
day: 66
lang: 'zh'
---

## 今天要解决的问题

基础篇 Day 13 讲了 workflow 和 Agent 的区别,Day 26 实现了两种多 Agent 拓扑。那时候的问题是「怎么做」。进阶篇要回答的是「该不该这么做」,而且要能在评审会上用数据说服别人。

这个问题在资深面试里出现得非常频繁。我们的 JD 数据里,资深岗提到多 Agent 的有 30%,提到架构的有 73%。面试官问「你为什么用多 Agent」,真正想听的是你怎么权衡,而不是你用过哪个框架。最差的回答是「因为多 Agent 更强大」。

学完今天你应该能:

1. 准确引用 Anthropic、Cognition、LangChain 三篇文章的核心论据和数字。
2. 用五个维度分析一个任务适合哪种架构。
3. 说清楚多 Agent 系统里共享状态和消息传递的取舍,以及失败怎么隔离。
4. 设计并运行一个架构对比实验,用成功率、稳定性、成本、延迟四个指标做决定。
5. 画出自己的架构决策树。

预计用时 5 小时。前置:Day 13(五种 workflow 模式)、Day 26(多 Agent)、Day 62–65。

## 三篇文章,三种立场

2025 年 6 月中旬的一周里,三篇文章先后发出来,到现在还是讨论这个问题绕不开的材料。

**Cognition《Don't Build Multi-Agents》(6 月 12 日)**。做 Devin 的团队。核心论点是两条原则:一是共享上下文,而且要共享完整的执行轨迹,不只是几条消息;二是每个动作都隐含着决策,相互冲突的决策会带来坏结果。他们的结论是默认用单线程的线性 Agent,上下文太长就用专门的模型做压缩。Day 26 讲过他们那个 Flappy Bird 的例子:两个子 Agent 各做各的,一个做出了马里奥风格的背景,一个做出了不像游戏素材的鸟,拼不到一起。

**Anthropic《How we built our multi-agent research system》(6 月 13 日)**。Claude Research 功能的架构:一个主 Agent 规划,并行派出多个子 Agent 搜索,最后汇总。在他们内部的研究类评测上,多 Agent 版本比单 Agent 高 90.2%。代价同样写得很清楚:普通 Agent 的 token 消耗大约是聊天的 4 倍,多 Agent 系统大约是 15 倍;在 BrowseComp 评测里,token 用量一项就解释了 80% 的表现差异。他们也明确说多 Agent 不适合大多数编程任务,也不适合子 Agent 之间依赖很多的场景。

**LangChain《How and when to build multi-agent systems》(6 月 16 日)**。Harrison Chase 读完前两篇以后写的,他认为两篇其实有很多共同点,归纳成两条:上下文工程是关键;**以「读」为主的多 Agent 系统比以「写」为主的容易做**。研究任务主要是读,多个子 Agent 各读各的,最后汇总,冲突很少;写代码、写文档主要是写,多个 Agent 同时写同一个产物,决策很容易打架。

三篇放在一起,我的理解是:它们争的不是「多 Agent 好不好」,而是**子任务之间依赖有多少**。依赖少、以读为主、能并行,多 Agent 赚;依赖多、以写为主、要求前后一致,多 Agent 赔。还有一个被很多人忽略的点:Anthropic 那 90% 的提升,有相当一部分来自花了更多的 token。如果单 Agent 也能花同样多的 token(比如用更长的上下文、跑更多步),差距会缩小多少,文章没有给出。这正是你需要在自己的任务上做实验的原因。

## 四种架构

先把候选项摆清楚。

**单 Agent**:一个循环,所有工具都给它,它自己决定做什么。Day 9 的那种。

**工作流**:流程是写死的图,每个节点可能调模型,但走哪条路由代码决定。Day 13 的五种模式都属于这一类。

**多 Agent**:多个各有上下文的循环,由主管派活(orchestrator-worker)或者互相交接(handoff)。

**混合**:外层是工作流,某些节点内部是一个 Agent。SupportPilot 其实就是混合架构:分类、检索、审批这些步骤是写死的,但「处理工单」那个节点里是一个能自主调工具的 Agent。

生产环境里,纯粹的单 Agent 和纯粹的多 Agent 都不多,大部分成熟系统是混合的。原因很实际:业务方要求某些步骤一定发生(比如退款必须审批、回复必须带引用),这些用代码保证比用提示词保证可靠得多;而中间那些需要灵活应对的部分交给 Agent。

## 决定架构的五个维度

**一、任务能不能拆,子任务之间依赖多少。** 这是最重要的一条。能拆成互不依赖的子任务(查五家公司的财报),适合并行的多 Agent;每一步都依赖前一步的决定(改一个跨十个文件的 bug),适合单 Agent。

**二、以读为主还是以写为主。** 读的结果可以汇总,冲突了可以取舍;写的产物只有一份,冲突了就是错。

**三、上下文会不会爆。** 如果单 Agent 要读的材料远超窗口,子 Agent 的上下文隔离就很有价值:每个子 Agent 读一部分,只交回结论。如果材料不多,隔离只会让信息丢失。

**四、可预测性和审计要求。** 有资金操作、合规要求的场景,流程越确定越好,工作流或混合架构优先。审计人员问「这个退款为什么被批准」,你能指着图上的审批节点回答,比翻一个 Agent 五十步的推理记录容易得多。

**五、成本和延迟预算。** 多 Agent 的 token 消耗可能是单 Agent 的好几倍,并行能降低延迟,但汇总和协调又会增加延迟。客服场景对单张工单的成本很敏感,研究报告场景可能不在乎多花几块钱。

## 多 Agent 的两个细节:状态和失败

决定用多 Agent 以后,还有两个设计问题经常被忽略。

**共享状态还是消息传递。** 共享状态是所有 Agent 读写同一份状态(比如 LangGraph 里的 State,或者一个共享的文件目录);消息传递是 Agent 之间只通过明确的消息交流(主管写任务描述,子 Agent 交回结论)。共享状态让每个 Agent 都能看到全局,接近 Cognition 说的「共享完整上下文」,但并发写入容易冲突,而且上下文隔离的好处没了。消息传递隔离得好,但信息在传递中会丢失,任务描述写得不好,子 Agent 就会像 Flappy Bird 那样跑偏。Anthropic 的文章专门讲了主 Agent 给子 Agent 的任务描述要包含目标、输出格式、可用的工具和来源、明确的边界,否则子 Agent 会重复劳动或者漏掉东西。

我的经验是:**读类任务用消息传递,写类任务如果一定要多 Agent,用共享状态加明确的所有权**(每个 Agent 只能写自己负责的那部分,比如一个负责测试文件,一个负责实现文件)。

**失败隔离。** 一个子 Agent 失败了,整个任务要不要失败?好的设计是让主 Agent 知道失败了并决定怎么办:重试、换个方式、或者在结果里标明「这部分没查到」。最坏的设计是子 Agent 静默返回一个空结果,主 Agent 把空结果当成「没有发现」写进报告。所以子 Agent 的返回格式里要有明确的状态字段(成功、部分成功、失败)和原因,不能只有一段文本。另外,一个子 Agent 陷入循环烧光预算,不应该拖垮整个任务,每个子 Agent 要有自己的预算上限。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="架构决策树:先问是否需要固定步骤,再问子任务是否可拆且依赖少,再问以读为主还是以写为主,再问上下文是否会爆">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11" text-anchor="middle">
    <rect x="200" y="14" width="240" height="34" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="320" y="35" fill="var(--ink)">有必须发生的步骤?(审批/合规)</text>
    <rect x="30" y="80" width="170" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="115" y="101" fill="var(--ink)">外层用工作流</text>
    <rect x="260" y="80" width="200" height="34" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="360" y="101" fill="var(--ink)">子任务可拆且依赖少?</text>
    <rect x="160" y="150" width="150" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="235" y="171" fill="var(--ink)">单 Agent</text>
    <rect x="360" y="150" width="200" height="34" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="460" y="171" fill="var(--ink)">以读为主?</text>
    <rect x="300" y="220" width="150" height="34" rx="4" fill="var(--paper)" stroke="var(--ink-soft)"/>
    <text x="375" y="241" fill="var(--ink)">上下文会爆?</text>
    <rect x="480" y="220" width="140" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="550" y="238" fill="var(--ink)">单 Agent</text><text x="550" y="254" fill="var(--ink-soft)" font-size="10">或分工明确的共享状态</text>
    <rect x="200" y="268" width="130" height="28" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="265" y="286" fill="var(--ink)">主管派活多 Agent</text>
    <rect x="345" y="268" width="120" height="28" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
    <text x="405" y="286" fill="var(--ink-soft)">先试单 Agent</text>
  </g>
  <g stroke="var(--ink-faint)" fill="none" font-family="var(--font-mono)" font-size="10">
    <line x1="270" y1="48" x2="140" y2="80"/><text x="190" y="62" fill="var(--ink-faint)" stroke="none">是</text>
    <line x1="370" y1="48" x2="370" y2="80"/><text x="384" y="66" fill="var(--ink-faint)" stroke="none">否</text>
    <line x1="115" y1="114" x2="115" y2="130"/><line x1="115" y1="130" x2="300" y2="130" stroke-dasharray="3 3"/>
    <line x1="320" y1="114" x2="250" y2="150"/><text x="270" y="134" fill="var(--ink-faint)" stroke="none">否</text>
    <line x1="400" y1="114" x2="450" y2="150"/><text x="436" y="134" fill="var(--ink-faint)" stroke="none">是</text>
    <line x1="430" y1="184" x2="390" y2="220"/><text x="398" y="204" fill="var(--ink-faint)" stroke="none">读</text>
    <line x1="500" y1="184" x2="540" y2="220"/><text x="528" y="204" fill="var(--ink-faint)" stroke="none">写</text>
    <line x1="340" y1="254" x2="280" y2="268"/><text x="300" y="262" fill="var(--ink-faint)" stroke="none">会</text>
    <line x1="400" y1="254" x2="405" y2="268"/><text x="414" y="264" fill="var(--ink-faint)" stroke="none">不会</text>
  </g>
</svg>
<figcaption>一棵够用的决策树。外层工作流和内层架构是两个独立的决定:先用工作流保证必须发生的步骤,再决定每个灵活节点内部用什么。每个分支最终都要用实验确认。</figcaption>
</figure>

## 设计一个架构对比实验

决策树只能帮你缩小范围,最后要靠数据。下面是在 SupportPilot 上比较几种架构的实验设计。

**任务集**。从 W5 的测试集里挑 40 张工单,覆盖三种难度:简单(一次查询就能答,比如「怎么改发票抬头」)、中等(要查两三个系统,比如重复扣款)、复杂(要跨多个历史工单和账单推理,比如「我过去半年的账单为什么一直在涨」)。每张都要有确定性的判题函数。

**候选架构**。至少三种:单 Agent(一个循环,所有工具);混合(SupportPilot 现在的样子);多 Agent(主管加账务专员、技术专员、知识库专员)。

**控制变量**。这是最容易做错的地方。三种架构要用同一个模型、同一套工具、同一个知识库,系统提示词的业务规则部分保持一致,只改编排方式。还要做一组「预算对齐」的对照:给单 Agent 同样多的 token 预算(更多步数、更长上下文),看它能不能追上多 Agent。如果追上了,说明提升来自花的钱而不是架构,这正是 Anthropic 文章没回答的那个问题。另外,每种架构的提示词都要各自调到一个合理水平再比,拿一个精心调过的多 Agent 去比一个随手写的单 Agent,结论没有意义。

**指标**。成功率;pass^k,也就是同一个任务跑 k 次全部成功的比例,这是 τ-bench 用来衡量稳定性的指标,Day 73 会细讲;平均成本;P95 延迟。四个指标都要看,只看成功率会系统性地偏向花钱多的架构。

**重复**。每个任务每种架构跑 3 次。40 乘 3 乘 3,一共 360 次运行。

下面的脚本把这个实验框架写好了。每种架构只要包装成「输入一个任务、返回 `Outcome`」的函数就能接进来。

```python
# agentops/experiments/arch_bench.py
"""同一批任务,用几种架构各跑 k 次,比较成功率、稳定性、成本和延迟。"""
from __future__ import annotations

import statistics
import time
from dataclasses import dataclass
from typing import Callable


@dataclass
class Outcome:
    ok: bool        # 由确定性的判题函数给出,不用 LLM 评审
    cost_cny: float
    seconds: float


Arch = Callable[[dict], Outcome]  # 输入一个任务,跑完返回结果


def run_bench(archs: dict[str, Arch], tasks: list[dict], k: int = 3) -> list[dict]:
    rows = []
    for name, arch in archs.items():
        per_task: list[list[Outcome]] = []
        for task in tasks:
            outs = []
            for _ in range(k):
                t0 = time.perf_counter()
                o = arch(task)
                o.seconds = o.seconds or time.perf_counter() - t0
                outs.append(o)
            per_task.append(outs)
        flat = [o for outs in per_task for o in outs]
        secs = sorted(o.seconds for o in flat)
        rows.append({
            "架构": name,
            "成功率": sum(o.ok for o in flat) / len(flat),
            # pass^k:同一个任务 k 次全部成功的比例,衡量稳定性(τ-bench 用的指标)
            "pass^k": sum(all(o.ok for o in outs) for outs in per_task) / len(per_task),
            "平均成本": statistics.mean(o.cost_cny for o in flat),
            "P95 秒": secs[min(len(secs) - 1, int(0.95 * len(secs)))],
        })
    return rows


def to_markdown(rows: list[dict]) -> str:
    head = "| " + " | ".join(rows[0]) + " |\n| " + " | ".join("---" for _ in rows[0]) + " |\n"
    def fmt(key, v):
        if key in ("成功率", "pass^k"):
            return f"{v:.1%}"
        return f"{v:.3f}" if isinstance(v, float) else str(v)
    return head + "\n".join("| " + " | ".join(fmt(k, v) for k, v in r.items()) + " |" for r in rows)


if __name__ == "__main__":
    # 用两个假架构验证脚本本身能跑。下面的数字是随机造的,不是实验结果。
    import random
    random.seed(0)
    fake_tasks = [{"id": i} for i in range(20)]
    archs = {
        "fake_single": lambda t: Outcome(random.random() < 0.8, 0.02, random.uniform(3, 8)),
        "fake_multi": lambda t: Outcome(random.random() < 0.85, 0.09, random.uniform(5, 15)),
    }
    print(to_markdown(run_bench(archs, fake_tasks, k=3)))
```

直接运行时,它会用两个随机的假架构跑一遍,只是为了确认脚本能跑、表格格式对。输出大致长这样,**这些数字是随机数,不是实验结果**:

```text
| 架构 | 成功率 | pass^k | 平均成本 | P95 秒 |
| --- | --- | --- | --- | --- |
| fake_single | 68.3% | 30.0% | 0.020 | 7.833 |
| fake_multi | 93.3% | 80.0% | 0.090 | 14.868 |
```

真实实验的结果表留给你填:

| 架构 | 简单任务成功率 | 中等任务成功率 | 复杂任务成功率 | pass^3 | 平均成本(元) | P95(秒) |
| --- | --- | --- | --- | --- | --- | --- |
| 单 Agent | | | | | | |
| 混合(现状) | | | | | | |
| 多 Agent | | | | | | |

按难度分开统计很关键。很可能出现的情况是:简单任务三种架构差不多,多 Agent 只是更贵更慢;复杂任务多 Agent 略好。如果是这样,结论就不是「选哪一种」,而是「按难度路由」:先用一个便宜的分类判断难度,简单的走单 Agent 或混合,复杂的才走多 Agent。这种结论只有拆开看数据才会出现,也是资深评审会上最有说服力的那种。

还有一点:成功率差几个点,在 40 个任务上不一定说明问题。Day 69 会讲怎么判断差异是不是显著,今天先把数据攒下来。

## 架构不是一次性的决定

最后说一个容易被忽视的事实:架构的最优解会随着模型能力变化。

2024 年很多团队用多 Agent,是因为当时的模型上下文短、长任务里容易忘事,拆成几个小 Agent 是不得已。到 2025、2026 年,模型的上下文窗口和长任务能力都明显变强,不少当初必须拆开的任务,现在一个 Agent 就能做好,拆开反而增加了协调成本和信息损失。反过来也可能发生:某个新模型特别擅长规划和派活,让主管加工人的架构变得更划算。

所以资深工程师对架构的态度应该是:**做出决定,记下理由和推翻条件,定期用实验复查**。这就是为什么 Day 61 让你写 ADR 时一定要写「什么情况下推翻这个决定」。比如 SupportPilot 的架构 ADR 可以写:「当新模型在复杂工单测试集上单 Agent 成功率达到混合架构的 95% 以上,且单张成本更低时,评估简化为单 Agent。」有了这句话,下一次模型升级时,团队知道要跑哪个实验、看哪个数字,而不是凭感觉争论。

迁移的时候也别一刀切。新架构先接 5% 的流量,和老架构在同一批线上工单上对比一到两周,确认没有回退再逐步放量。W11 会专门讲线上实验怎么设计。

## 动手练习

**第一步:读三篇文章。** Cognition、Anthropic、LangChain 各一篇,每篇写三行笔记:论点、证据、局限。特别留意 Anthropic 文章里 token 用量和效果的关系。

**第二步:用五个维度分析三个任务。** 分别是:SupportPilot 处理一张工单;财务团队的「核对客户全年账单并写一份报告」;研发团队的「根据 issue 修一个 bug 并补测试」。每个任务按五个维度打分,写出你推荐的架构和理由。

**第三步:实现三种架构。** 在 SupportPilot 上实现单 Agent、混合、多 Agent 三个版本,都包装成 `Arch` 函数。多 Agent 版本的子 Agent 返回值必须带状态字段。

**第四步:跑实验。** 至少 20 个任务、3 种架构、各 3 次,按难度分开填表。

**第五步:写结论。** 一页纸,写给一个想「全面升级成多 Agent」的产品经理看。用你的数据说明哪些场景值得、哪些不值得,花多少钱换来多少效果。

**验收标准**:三个任务的分析都有五个维度的具体理由;实验表按难度分开填完;结论里有成本换效果的具体数字(比如「复杂任务成功率提高 X 个点,单张成本增加 Y 元」)。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 单 Agent | 一个循环、所有工具,由模型自主决定每一步 |
| 工作流 workflow | 流程写死在代码里的图,节点可以调模型,但路径由代码决定 |
| 混合架构 | 外层工作流保证必要步骤,内层某些节点是自主 Agent |
| orchestrator-worker | 主管 Agent 拆任务派给工人 Agent,收集结果 |
| 共享状态 | 多个 Agent 读写同一份状态 |
| 消息传递 | Agent 之间只通过明确的消息交换信息,上下文彼此隔离 |
| pass^k | 同一个任务跑 k 次全部成功的比例,衡量稳定性 |
| 失败隔离 | 一个子任务失败不会导致整体静默出错或被拖垮 |

## 常见误区

**多 Agent 更强大,所以更好。** Anthropic 的提升有很大一部分来自花了更多 token。在你的任务上,先看花同样的钱单 Agent 能做到什么程度。

**引用数字不带条件。** 「多 Agent 提升 90%」是在 Anthropic 内部研究类评测上的结果,换成写代码任务他们自己都说不适合。面试时引用数字一定要带上场景。

**只看成功率选架构。** 只看成功率会偏向最贵的方案。成功率、稳定性、成本、延迟四个一起看,并按任务难度分开看。

**子 Agent 只返回一段文本。** 主 Agent 分不清「没查到」和「查失败了」。返回值要有状态字段和原因。

**把必须发生的步骤交给 Agent 自己决定。** 审批、引用这类硬性要求,写在工作流里比写在提示词里可靠得多,也更好审计。

**架构定了就不再改。** 模型能力每半年变一次。今天需要多 Agent 才能做好的事,明年单 Agent 可能就够了。保留实验脚本,定期重跑。

## 学习资料

### 文档与文章

- [Cognition《Don't Build Multi-Agents》](https://cognition.ai/blog/dont-build-multi-agents):两条原则和 Flappy Bird 的例子。15 分钟。
- [Anthropic《How we built our multi-agent research system》](https://www.anthropic.com/engineering/multi-agent-research-system):重点看 token 用量、任务描述的写法、评测方法三部分。30 分钟。
- [LangChain《How and when to build multi-agent systems》](https://blog.langchain.com/how-and-when-to-build-multi-agent-systems/):读写之分的出处。10 分钟。
- [Anthropic《Building effective agents》](https://www.anthropic.com/engineering/building-effective-agents):workflow 和 agent 的定义,再读一遍「什么时候用 agent」那一节。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CrKA6YETu&autoplay=0&high_quality=1" title="10 分钟讲透 AI Agent 8 种主流架构" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI架构师Leo · 10 分钟讲透 AI Agent 8 种主流架构 · 快速过一遍常见架构,当作今天四种分类的补充。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1MFpG63End&autoplay=0&high_quality=1" title="从 Codex 源码学 Agent 工程|04/13 多 Agent 协作:任务拆分、上下文交接与结果核验" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI架构师Leo · 从 Codex 源码学 Agent 工程 04/13 多 Agent 协作 · 13 分钟,从 Codex 的源码看任务拆分、上下文交接和结果核验怎么做,和今天讲的失败隔离直接相关。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/JYaGAqvPfYA" title="Anthropic vs Cognition on Multi-Agents: A Breakdown with Dylan Davis" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Latent Space · Anthropic vs Cognition on Multi-Agents: A Breakdown with Dylan Davis · 把两篇文章放在一起逐条讨论,和今天的内容几乎一一对应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · Anthropic 几位工程师聊什么时候该用 Agent、什么时候不该,很多观点和决策树里的分支对得上。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 10 章「AI Engineering Architecture and User Feedback」:从简单到复杂逐步加组件的架构演进思路,和「先试单 Agent」是一个意思。
- Mark Richards、Neal Ford《Fundamentals of Software Architecture》(O'Reilly,2020),中文版《软件架构:架构模式、特征及实践指南》:不讲 Agent,但「架构是取舍」和「架构特征」的思维方式,正是今天五个维度的来源。读第 1、2 章。

### 开源项目与代码

- [openai/openai-agents-python](https://github.com/openai/openai-agents-python):`examples/agent_patterns/` 目录里有 `agents_as_tools.py`、`routing.py`、`parallelization.py`、`deterministic.py` 等例子,分别对应主管派活、路由、并行和确定性工作流,实现第三步时可以参考。
- 你的 `agentops/experiments/arch_bench.py`:今天的产出,W11 会给它加上统计检验。

## 自测

1. Cognition 反对多 Agent 的两条原则是什么?

<details><summary>答案</summary>

共享上下文,而且要共享完整的执行轨迹而不只是几条消息;每个动作都隐含着决策,相互冲突的决策会带来坏结果。

</details>

2. Anthropic 多 Agent 研究系统的效果提升和 token 用量之间是什么关系?这对解读「提升 90%」有什么影响?

<details><summary>答案</summary>

多 Agent 系统的 token 消耗约是聊天的 15 倍,普通 Agent 约 4 倍;在 BrowseComp 上 token 用量解释了 80% 的表现差异。所以提升有很大一部分来自花了更多 token,不能简单理解为架构本身带来 90% 的提升。

</details>

3. LangChain 说「读」类多 Agent 比「写」类容易,为什么?

<details><summary>答案</summary>

读的结果可以汇总、冲突时可以取舍;写的产物只有一份,多个 Agent 的决策冲突会直接变成错误。

</details>

4. 为什么子 Agent 的返回值要有状态字段?

<details><summary>答案</summary>

否则主 Agent 分不清「没查到」和「查询失败」,可能把失败当成「没有发现」写进结果,造成静默错误。

</details>

5. 架构对比实验为什么要按任务难度分开统计?

<details><summary>答案</summary>

不同难度下架构的优劣可能相反:简单任务各架构差不多但多 Agent 更贵,复杂任务多 Agent 可能更好。合在一起看会掩盖这个差别,分开看才能得出「按难度路由」这类更优的结论。

</details>

6. 资深面试题:「产品经理想把客服 Agent 全面升级成多 Agent 架构,说这样更智能。你怎么回应?」

<details><summary>答案</summary>

要点:先认同目标(提高复杂工单的解决率),再说明多 Agent 的真实收益和代价(并行、上下文隔离 vs token 成本数倍、协调失败、更难审计),引用 Anthropic 和 Cognition 的数据时带上场景条件;提出用实验决定:按难度分层的任务集,比较成功率、稳定性、成本、延迟;预判可能的结论是按难度路由,只对复杂工单启用多 Agent;强调退款审批等必须发生的步骤仍由外层工作流保证。整体态度是用数据推动决定,而不是直接否定。

</details>

## 明天预告

Day 67 · W10 复习:写一份 Agent 运行时的设计文档。这周的五个主题(harness、上下文、记忆、持久化、架构)明天要合成一份完整的设计文档,用「背景、目标与非目标、方案、取舍、风险、评测计划」的结构写出来,作为 AgentOps 运行时的正式方案。
