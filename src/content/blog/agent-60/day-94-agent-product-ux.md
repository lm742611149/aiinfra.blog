---
title: 'Day 94 · Agent 的产品与交互:人在回路里的体验设计'
description: 'Agent 做得再聪明,用户不敢用也白搭。今天讨论自主程度怎么分级、为什么它是一个设计决策;怎么展示计划和步骤让用户敢信任;怎么做到可中断、可撤销;失败时用户看到什么;以及工程师怎么和 PM、设计师一起定下这些规则。最后给 SupportPilot 的每个动作定自主级别,实现一个带撤销窗口的动作策略引擎。'
pubDate: 2026-10-12
regime: none
tags: ['agent-ux', 'human-in-the-loop', 'autonomy', 'trust', 'product', 'agent-60']
series: 'agent-60'
day: 94
lang: 'zh'
---

## 今天要解决的问题

我见过不止一个团队,Agent 的评测分数很好看,上线后使用率却很低。去问客服同事,答案出奇一致:「它有时候会直接给客户发错东西,我不敢开」「它在干什么我看不懂,出了事我说不清」「我改了它的草稿,下次它还是那么写」。这些都不是模型能力的问题,是产品和交互的问题。

资深工程师和中级工程师的一个分界线,就是能不能在这类问题上和 PM、设计师坐在一起拿主意,而不是等别人给需求。今天不写复杂代码,重点是一套能拿来讨论的框架。

学完今天你应该能:

1. 用五级自主程度描述一个 Agent 的行为,并解释为什么自主程度应该是有意的设计决策,而不是能力的副产品。
2. 为一个 Agent 的每个动作定出自主级别,说清依据(可逆性、影响范围、金额、外部可见性)。
3. 设计透明度、可中断、可撤销、失败处理这几块的交互,知道每一块常见的做法。
4. 设计一个逐步放权的机制,用数据决定什么时候可以让 Agent 多做一点。
5. 实现一个动作策略引擎和撤销窗口,并用测试证明它的行为。

预计用时 3 到 4 小时。前置:Day 25(人工审批)、Day 39、40(安全与权限)、Day 49(SupportPilot 界面)。

## 自主程度是设计出来的

2025 年有一篇论文《Levels of Autonomy for AI Agents》(Feng、McDonald、Zhang)提出了一个很好用的框架。它的核心观点是:**一个 Agent 的自主程度应该被当作一个独立的设计决策,和它的能力、运行环境分开考虑**。能力强的 Agent 不代表就该让它全自动,能力一般的 Agent 在低风险的场景里也可以全自动。

论文按「用户扮演什么角色」把自主程度分成五级:

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="五级自主程度">
  <rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
  <rect x="20" y="150" width="112" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="76" y="168" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">L1 操作者</text>
  <text x="76" y="184" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">人做,AI 建议</text>
  <rect x="142" y="122" width="112" height="68" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="198" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">L2 协作者</text>
  <text x="198" y="162" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">一起做,人可</text>
  <text x="198" y="178" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">随时接管</text>
  <rect x="264" y="94" width="112" height="96" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="320" y="118" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">L3 顾问</text>
  <text x="320" y="134" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">AI 主导,</text>
  <text x="320" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">问人的意见</text>
  <rect x="386" y="66" width="112" height="124" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="442" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">L4 审批者</text>
  <text x="442" y="106" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">AI 自己做,</text>
  <text x="442" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">关键处人批</text>
  <rect x="508" y="38" width="112" height="152" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="564" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">L5 观察者</text>
  <text x="564" y="78" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">全自动,人</text>
  <text x="564" y="94" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只看日志、</text>
  <text x="564" y="110" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">能拉闸</text>
  <line x1="20" y1="210" x2="620" y2="210" stroke="var(--rule)"/>
  <text x="20" y="228" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">← 人的控制多</text>
  <text x="620" y="228" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">AI 的自主多 →</text>
</svg>
<figcaption>五级按「用户扮演什么角色」划分。同一个产品里,不同动作可以处在不同级别,这是今天最重要的一个认识。</figcaption>
</figure>

- **L1 操作者**:用户掌控规划和决策,需要时才叫 Agent,Agent 只给建议、不自己动手。
- **L2 协作者**:用户和 Agent 一起规划、分工执行,用户随时可以编辑 Agent 的工作或者接管。
- **L3 顾问**:Agent 在较长时间里主导规划和执行,在需要专业判断、偏好、方向时请教用户,用户通过提要求来影响结果,而不是自己动手。
- **L4 审批者**:Agent 独立跑整个流程,只在关键操作需要批准或者遇到阻碍(比如需要凭证)时才找用户。
- **L5 观察者**:Agent 完全自主,用户只能看活动日志或者拉紧急停止。

论文还提出了「自主程度证书」的设想:由第三方机构根据 Agent 的技术规格和运行环境,规定它最多能在哪一级运行。现在还是设想,但方向值得留意,Day 86 讲治理时会再提到。

Karpathy 在 2025 年那场《Software Is Changing (Again)》演讲里讲过一个类似的比喻,叫「自主程度滑杆」:好的 AI 产品让用户可以自己调这根滑杆,从只补全一行到改整个仓库;而且要让验证变得又快又容易,因为人还在回路里,人的验证速度就是整个系统的瓶颈。他的原话大意是要把 AI「拴在绳子上」。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CLNtzyEP4&autoplay=0&high_quality=1" title="大神Andrej Karpathy最新演讲：AI时代的软件" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Web3天空之城 · 大神Andrej Karpathy最新演讲:AI时代的软件 · 40 分钟中文字幕版,重点听后半段「部分自主应用」和自主程度滑杆那一部分。</figcaption>
</figure>

## 一个产品里,不同动作处在不同级别

很多人讨论「我们的 Agent 是第几级」,这个问题本身就问错了。拿 SupportPilot 来说:

| 动作 | 可逆吗 | 客户看得到吗 | 金额 | 我会定的级别 |
| --- | --- | --- | --- | --- |
| 检索知识库、查账单 | 只读 | 否 | 无 | L5,直接做 |
| 给工单打标签、分类 | 可逆 | 否 | 无 | L5,直接做并记日志 |
| 回复客户 | 发出去就收不回 | 是 | 无 | 初期 L2(起草,客服点发送),数据好了再升 |
| 小额退款 | 不可逆 | 是 | 几百元 | L3,执行前主管确认 |
| 大额退款、批量通知 | 不可逆或影响面大 | 是 | 上千元或几百个客户 | 永远 L3,执行前确认,不随信任提升 |

决定级别的四个因素基本固定:**可逆性**(做错了能不能撤回)、**外部可见性**(客户或外部系统会不会看到)、**金额**、**影响范围**(一次影响几个客户)。今天练习里的策略引擎就是把这张表写成代码。

有一个细节:「回复客户」这件事,邮件和工单回复如果加一个 30 秒的撤销窗口(像很多邮箱的「撤回发送」),它就从「不可逆」变成了「短时间内可逆」,于是可以从 L2 升到「先执行、留撤销窗口」。**很多时候提高自主程度的方法,不是让模型更聪明,而是把动作改造得更可逆。**

## 透明度:给用户看什么

用户信任一个 Agent,前提是看得懂它在干什么。但透明度不等于把所有思考过程都摊出来,一屏几千字的推理没有人会看。我的经验是展示三样东西就够了:

- **计划**:开始干活前,用几行字说明打算怎么做。长任务尤其需要,用户可以在一开始就纠正方向,比做完再返工便宜得多。Claude Code 的待办列表、Deep Research 的研究提纲都是这个。
- **关键步骤和依据**:查了哪张账单、引用了哪篇帮助文章,做成可以点开的卡片。Day 49 做 SupportPilot 界面时展示过工具调用卡片,就是这个用途。
- **把握程度**:模型不确定时要说出来,「我没找到这位客户今年的发票,下面的结论基于去年的记录」。比起一个笼统的置信度分数,具体说「哪里不确定、为什么」对用户有用得多。

微软研究院 2019 年在 CHI 上发表过一套人机交互指南(Guidelines for Human-AI Interaction,共 18 条),虽然早于大模型,但很多条直接适用,比如「让用户清楚系统能做什么」「让用户清楚它做得有多好」「支持高效纠正」「支持高效忽略」「拿不准时缩小服务范围」。设计评审时拿这 18 条过一遍,能发现不少问题。

## 可中断、可撤销

**中断**:长任务一定要能随时停。停下来以后要说明已经做了什么、没做什么、现在系统处于什么状态。最差的体验是用户点了停止,不知道停在了哪里,也不知道哪些操作已经生效。技术上这要求 Day 65 讲的持久化执行:每一步的状态都存下来,停止时能准确报告。

**撤销**:分三种情况设计。可以真撤销的(打标签、改草稿),给撤销按钮;可以延迟生效的(发邮件、发回复),给撤销窗口;真不可逆的(退款、对外付款、删除数据),在执行前确认,而且确认界面要说清楚后果,别只放一个「确定」按钮。

**预览**:批量操作和代码修改,先给预览(要改哪些、改成什么),确认后再执行。Coding Agent 展示 diff 就是这个道理。

## 出错时用户看到什么

Agent 一定会失败。失败时的体验决定了用户下次还敢不敢用。三条原则:

- **说清发生了什么**:「退款申请没提交成功,原因是账单系统超时」,而不是「出错了,请重试」。
- **说清现在的状态**:哪些已经做了,哪些没做。用户最怕的是不确定有没有重复扣款、有没有重复发邮件。
- **给下一步**:重试、转人工、或者用户自己来。转人工时要把上下文带过去,别让客服同事再问客户一遍。Day 47 的转人工节点就是做这个的。

## 逐步放权:用数据决定能不能多做一点

新功能上线,自主程度从低开始,用数据逐步提高。以「回复客户」为例:

1. 先上 L2,Agent 起草,客服修改后发送。记录每份草稿**被原样发送、小改后发送、大改后发送、被丢弃**的比例。
2. 某类工单连续几周原样发送率超过某个阈值(比如 95%),这类工单升级到「先发送、留撤销窗口」。
3. 升级后继续监控撤销率和客户投诉率,一旦变差立刻降级。

今天的策略引擎里有一个 `trust` 参数,就是这个比例。注意两点:放权是**按动作、按工单类型**的,不是整个产品一起升;大额和批量操作不管信任多高都不放权,这条写死在代码里。

这个机制同时解决了一个组织问题:业务方的担心有了量化的回应。你不需要说服他们「AI 很靠谱」,只需要说「这类工单过去四周客服原样发出了 97%,我们打算先对这一类开放自动发送,撤销率超过 2% 就自动退回」。

## 和 PM、设计师怎么协作

工程师在这件事上最有价值的贡献,是把模糊的担心变成可以讨论的结构:

- 带一张「动作清单 × 自主级别」的表去开会,每一行写清可逆性、可见性、金额、影响范围和建议的级别,让业务方逐行确认。比讨论「Agent 安不安全」高效得多。
- 主动提出要埋哪些点:采纳率、修改率、撤销率、转人工率、用户主动中断率。没有这些数据,后面的放权和改进都无从谈起。
- 在评审时提醒「这个动作能不能改造得更可逆」,很多时候这比优化模型带来的提升大。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Qf3V-oPfE8E" title="Designing AI-Native Product Experiences: The Autonomy Dial Framework" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Databricks Events · Designing AI-Native Product Experiences: The Autonomy Dial Framework · 29 分钟,讲怎么在产品里设计「自主程度旋钮」,和今天的放权机制可以对照着看。</figcaption>
</figure>

## 动手练习

**目标**:把 SupportPilot 的动作清单写成一个策略引擎,实现撤销窗口,用测试证明行为;再写一份可以拿去和业务方开会的自主程度表。

**第 1 步:建目录。**

```bash
mkdir -p agentops/ux && cd agentops/ux
uv init --python 3.12 && uv add --dev pytest
```

**第 2 步:写策略引擎和撤销窗口。** 我借用了论文里五个级别的名字来命名执行模式,但「哪个动作对应哪一级」的规则是我按 SupportPilot 的业务定的,你要按自己的业务改。

```python
# agentops/ux/autonomy.py
"""给每个 Agent 动作定一个自主级别,并据此决定:直接做、做了可撤销、先问人、只给建议。
级别借用 Feng 等人《Levels of Autonomy for AI Agents》按「用户角色」划分的思路。"""
from __future__ import annotations

import heapq
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Callable


class Level(IntEnum):
    OPERATOR = 1      # 用户主导,Agent 只在被叫到时帮忙:只给建议
    COLLABORATOR = 2  # 一起干:Agent 起草,用户编辑后自己提交
    CONSULTANT = 3    # Agent 主导,关键处问用户意见:执行前要确认
    APPROVER = 4      # Agent 自己做,高风险的由用户批:执行后给撤销窗口
    OBSERVER = 5      # 完全自主,用户只看日志


@dataclass(frozen=True)
class Action:
    name: str
    reversible: bool          # 做错了能不能撤回
    external: bool            # 会不会让客户或外部系统看到
    amount: float = 0.0       # 涉及金额(元)
    blast_radius: int = 1     # 一次影响多少个客户


def decide(a: Action, trust: float = 0.0) -> Level:
    """trust 是这个动作历史上「被人批准且没被撤销」的比例,0 到 1,用来逐步放权。"""
    if a.amount >= 1000 or a.blast_radius > 10:
        return Level.CONSULTANT                     # 大额或批量操作,永远先问
    if not a.reversible:
        return Level.CONSULTANT if a.external or a.amount > 0 else Level.APPROVER
    if a.external:
        return Level.APPROVER if trust >= 0.95 else Level.COLLABORATOR
    return Level.OBSERVER


MODE = {
    Level.OPERATOR: "只给建议",
    Level.COLLABORATOR: "起草,等人提交",
    Level.CONSULTANT: "执行前确认",
    Level.APPROVER: "先执行,留撤销窗口",
    Level.OBSERVER: "直接执行并记日志",
}


@dataclass(order=True)
class _Pending:
    due: float
    action_id: str = field(compare=False)
    run: Callable[[], None] = field(compare=False)


class UndoWindow:
    """APPROVER 级别的动作先排队,窗口期内可以撤销,到期才真正执行。时钟可注入,方便测试。"""

    def __init__(self, seconds: float, clock: Callable[[], float]):
        self.seconds, self.clock = seconds, clock
        self._q: list[_Pending] = []
        self.canceled: set[str] = set()

    def schedule(self, action_id: str, run: Callable[[], None]) -> float:
        due = self.clock() + self.seconds
        heapq.heappush(self._q, _Pending(due, action_id, run))
        return due

    def undo(self, action_id: str) -> bool:
        if any(p.action_id == action_id for p in self._q):
            self.canceled.add(action_id)
            return True
        return False                                   # 已经执行了,撤不回

    def tick(self) -> list[str]:
        done = []
        while self._q and self._q[0].due <= self.clock():
            p = heapq.heappop(self._q)
            if p.action_id in self.canceled:
                continue
            p.run()
            done.append(p.action_id)
        return done
```

**第 3 步:写测试。** 把上面那张表的每一行都写成断言,撤销窗口用注入的时钟测试,不用真等 30 秒。

```python
# agentops/ux/test_autonomy.py
from autonomy import Action, Level, UndoWindow, decide

SEARCH_KB = Action("search_kb", reversible=True, external=False)
SEND_REPLY = Action("send_reply", reversible=True, external=True)       # 邮件有撤回窗口时可撤销
REFUND = Action("create_refund", reversible=False, external=True, amount=468)
BIG_REFUND = Action("create_refund", reversible=False, external=True, amount=5000)
TAG_TICKET = Action("tag_ticket", reversible=True, external=False)
BULK_EMAIL = Action("bulk_notify", reversible=True, external=True, blast_radius=300)


def test_levels():
    assert decide(SEARCH_KB) == Level.OBSERVER
    assert decide(TAG_TICKET) == Level.OBSERVER
    assert decide(SEND_REPLY, trust=0.80) == Level.COLLABORATOR
    assert decide(SEND_REPLY, trust=0.97) == Level.APPROVER
    assert decide(REFUND) == Level.CONSULTANT
    assert decide(BIG_REFUND, trust=1.0) == Level.CONSULTANT
    assert decide(BULK_EMAIL, trust=1.0) == Level.CONSULTANT


def test_undo_window():
    now = [0.0]
    sent = []
    w = UndoWindow(30, clock=lambda: now[0])
    w.schedule("r1", lambda: sent.append("r1"))
    w.schedule("r2", lambda: sent.append("r2"))
    now[0] = 10
    assert w.undo("r1") is True
    now[0] = 31
    assert w.tick() == ["r2"] and sent == ["r2"]
    assert w.undo("r2") is False
```

```bash
uv run pytest -q
```

输出大致长这样:`2 passed`。

**第 4 步:接进 Agent。** 在 SupportPilot 的工具执行层(Day 46 的权限分级那里)加一道:执行任何写操作前先 `decide()`,按级别走不同路径:OBSERVER 直接执行;APPROVER 放进 `UndoWindow` 并在界面上显示倒计时和撤销按钮;CONSULTANT 用 Day 25 的 interrupt 停下来等人确认;COLLABORATOR 只生成草稿。

**第 5 步:写自主程度表。** 列出 SupportPilot 所有工具(至少 8 个),每行写:动作、可逆性、外部可见性、金额范围、影响范围、当前级别、升级条件、降级条件、需要埋的指标。

**第 6 步:做一次设计评审。** 拿微软的 18 条人机交互指南(下面学习资料里有链接)逐条对照 SupportPilot 的界面,找出至少 3 条没做到的,写下改进方案。

**验收标准**:测试通过;自主程度表完整,每个写操作都有明确的升级和降级条件;设计评审找出至少 3 个具体问题和改法。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 自主程度(level of autonomy) | Agent 在多大程度上不需要人参与就能行动,应作为独立的设计决策 |
| 操作者 / 协作者 / 顾问 / 审批者 / 观察者 | 五级自主程度中用户分别扮演的角色 |
| 人在回路(human-in-the-loop) | 系统的关键步骤需要人参与确认或纠正 |
| 撤销窗口 | 动作延迟生效,期间用户可以撤回 |
| 逐步放权 | 根据历史数据,按动作和场景逐步提高自主程度 |
| 采纳率 / 修改率 / 撤销率 | 衡量 Agent 产出是否被用户接受的指标 |
| 自主程度证书 | 由第三方规定 Agent 最高可运行自主级别的设想 |
| 校准的信任 | 用户对系统的信任程度和系统的真实可靠性相匹配,既不过度依赖也不过度怀疑 |

## 常见误区

**问「我们的 Agent 是第几级」。** 一个产品里不同动作应该处在不同级别,按动作定级才有意义。

**以为提高自主程度只能靠更强的模型。** 把动作改造得更可逆(加撤销窗口、先预览),往往是更便宜的路。

**把全部推理过程展示给用户当透明度。** 没人看。展示计划、关键依据和不确定的地方就够了。

**整个产品一起放权。** 应该按动作、按场景,用数据逐个放,并且有自动降级。

**错误提示只写「出错了」。** 用户需要知道发生了什么、现在处于什么状态、下一步能做什么。

## 学习资料

### 文档与文章

- [Levels of Autonomy for AI Agents(arXiv 2506.12469)](https://arxiv.org/abs/2506.12469):五级自主程度的原文,读第 3 节各级定义和例子,40 分钟。
- [Google PAIR:People + AI Guidebook](https://pair.withgoogle.com/guidebook/):Google 的人与 AI 交互设计指南,看「Explainability + Trust」和「Feedback + Control」两章,1 小时。
- 微软 Guidelines for Human-AI Interaction(Amershi 等,CHI 2019):18 条人机交互指南,按标题搜索即可找到微软研究院的项目页和论文 PDF(微软站点对脚本访问返回 403,需浏览器打开)。
- [Shape of AI](https://www.shapeof.ai/):AI 产品交互模式的图鉴,看别人怎么设计预览、确认、撤销,30 分钟。
- [Anthropic:Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):回头再读一遍,注意它对「什么时候需要人参与」的讨论,20 分钟。

### B 站视频

- Web3天空之城《大神Andrej Karpathy最新演讲:AI时代的软件》:已嵌入正文。
- 大家一起学AI《03|Agent 的自主程度不是越高越好?》:5 分钟,DeepLearning.AI《Agentic AI》课程里「Degrees of Autonomy」一节的中文整理,适合快速复习。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Zzgd6JEdh&autoplay=0&high_quality=1" title="03｜Agent 的自主程度不是越高越好？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大家一起学AI · 03|Agent 的自主程度不是越高越好? · 5 分钟,自主程度是连续谱而不是是非题。</figcaption>
</figure>

### 其他经典视频

- Y Combinator《Andrej Karpathy: Software Is Changing (Again)》:原版英文演讲,和上面的中文版二选一。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LCEmiRjPEtQ" title="Andrej Karpathy: Software Is Changing (Again)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Y Combinator · Andrej Karpathy: Software Is Changing (Again) · 40 分钟,「部分自主应用」那一段最相关。</figcaption>
</figure>

- Databricks Events《Designing AI-Native Product Experiences: The Autonomy Dial Framework》:已嵌入正文。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 10 章「AI Engineering Architecture and User Feedback」后半部分,讲怎么设计和收集用户反馈,和今天的采纳率、修改率直接相关,1 小时。英文原版。
- Ben Shneiderman《Human-Centered AI》(Oxford University Press, 2022):第二部分提出的「高人类控制与高自动化可以同时存在」的二维框架,是对「自主程度越高越好」这种直觉最好的反驳,2 小时。英文原版。

### 开源项目与代码

- [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research):看 `clarify_with_user` 节点怎么在开始前向用户确认范围,这是「先展示计划」的一个具体实现。
- [OpenHands/software-agent-sdk](https://github.com/OpenHands/software-agent-sdk):看 `openhands-tools/openhands/tools/task_tracker/` 怎么让 Agent 维护一份用户看得见的任务清单。

## 自测

**1. 为什么说自主程度应该是一个独立的设计决策?**

<details><summary>答案</summary>

因为能力和该给多少自主是两件事。能力强的 Agent 在高风险场景里也可能需要人确认,能力一般的 Agent 在低风险、可撤销的场景里可以全自动。把自主程度单独拿出来设计,才能按每个动作的风险来定,而不是「模型变强了就全放开」。

</details>

**2. 「回复客户」这个动作,怎样才能在不换模型的情况下提高它的自主程度?**

<details><summary>答案</summary>

把它改造得更可逆:加一个撤销窗口,回复延迟 30 秒到几分钟才真正发出,期间客服可以撤回。这样它就从「不可逆、外部可见」变成了「短时间内可逆」,可以从「起草等人发送」升到「先发送、留撤销窗口」。再配合按工单类型的原样发送率逐步放权。

</details>

**3. 透明度应该展示哪些东西?为什么不展示完整推理过程?**

<details><summary>答案</summary>

展示计划(开始前打算怎么做)、关键步骤和依据(查了什么、引用了什么,可点开)、不确定的地方(具体说哪里不确定、为什么)。完整推理过程太长,用户不会看,反而淹没了关键信息;而且推理过程不一定忠实反映模型的实际依据。

</details>

**4. 逐步放权机制要注意什么?**

<details><summary>答案</summary>

按动作、按场景放权,不要整个产品一起升;用可量化的指标(原样采纳率、撤销率、投诉率)作为升级条件,并且设置自动降级;高风险动作(大额、批量、不可逆)设上限,不管数据多好都不放权;升级后持续监控。

</details>

**5. 资深面试题:客服团队负责人说「这个 Agent 我不放心,不想用」。你作为负责这个 Agent 的资深工程师,会怎么推动落地?**

<details><summary>答案</summary>

先弄清楚「不放心」具体指什么:怕发错东西给客户、怕看不懂它做了什么、还是怕出事担责。然后针对性设计:按动作做一张自主程度表,和负责人逐行确认,风险高的动作一律需要客服确认,低风险的只读动作才自动;上线先用协作者模式,Agent 起草、客服发送,界面展示依据和不确定点;埋点记录原样采纳率、修改率、撤销率;约定一个清晰的放权规则,比如某类工单连续四周原样采纳率超过 95% 才开放自动发送,撤销率超过阈值自动退回。定期把数据给负责人看,让放权成为基于数据的共同决定,而不是工程师单方面推动。同时确保出错时有清晰的状态说明和转人工流程,让客服同事知道出了问题怎么兜底。

</details>

## 明天预告

Day 95 是 W14 的复习日:前沿技术选型报告。这一周看了 Coding Agent、Computer Use、语音、Deep Research、Agent 互联和产品交互,每一样都很诱人。资深工程师要回答的是「我们团队明年该不该做 X」。明天先用一张图把这一周串起来,再给一个技术选型报告的模板,用一个打分矩阵加敏感性分析,完整写一份「要不要做语音客服 Agent」的报告,最后是本周的资深面试题汇总和坑清单。
