---
title: 'Day 87 · Agent 事故复盘:线上出事了怎么查、怎么防'
description: '从 Air Canada、Cursor、Replit 三起真实事故讲起,整理 Agent 特有的六类事故;出事后头 15 分钟先按哪个开关、怎么用 trace 和回放定位根因、无责复盘怎么写,以及怎么把每次事故变成评测用例、护栏和灰度规则。动手实现一套分级紧急开关和自动行为熔断器。'
pubDate: 2026-10-12
regime: none
tags: ['incident-response', 'postmortem', 'kill-switch', 'reliability', 'sre', 'agent-60']
series: 'agent-60'
day: 87
lang: 'zh'
---

## 今天要解决的问题

传统服务出事故,大多数时候是「挂了」:接口 500、超时、页面打不开。监控会第一时间报警,影响范围也比较好估。Agent 出事故经常是另一种样子:**系统一切正常,但它在一本正经地做错事**。接口全是 200,延迟正常,错误率是 0,而它在给几千个客户发一条编出来的政策,或者在后台反复调用一个退款工具。

这一类事故的特点是发现得晚、影响面难估、根因往往不在代码里而在 prompt、模型版本或者数据里。今天结束时你应该能:

1. 用三起公开的真实事故说明 Agent 事故和传统事故的区别。
2. 列出 Agent 特有的六类事故,以及每类靠什么信号发现。
3. 设计分级的紧急开关,知道出事后头 15 分钟先做什么。
4. 用 trace 和回放定位根因,写一份无责复盘。
5. 把事故转化成评测用例、护栏、熔断器和灰度规则,防止同类问题再发生。

预计用时 4 小时。前置:Day 12(失败模式)、Day 33(轨迹评测)、Day 40(权限与审批)、Day 85(指标和告警)。

## 三起真实事故

先看三个公开报道过的案例,它们正好对应三种不同的失败方式。

**Air Canada 的客服机器人(2024 年 2 月裁决)。** 一位乘客在亲人去世后订机票,航空公司官网上的聊天机器人告诉他可以先按原价买票,90 天内再申请丧亲优惠的退款。实际上航空公司的政策不允许事后申请。乘客申请被拒后诉至加拿大不列颠哥伦比亚省的民事裁决庭。航空公司辩称聊天机器人是一个「对自己言论负责的独立实体」,裁决庭驳回了这个说法,认定航空公司要对自己网站上的所有信息负责,判赔 650.88 加元的差价损失,加上利息和费用合计约 812 加元。钱不多,但这个案例被反复引用,因为它确立了一件事:**Agent 说的话就是公司说的话**。

**Cursor 的客服机器人「Sam」(2025 年 4 月)。** 用户发现在多台设备之间切换时会被登出,写信给客服,收到一个叫 Sam 的「客服」回复:这是新政策,每个订阅只能在一台设备上使用。实际上公司根本没有这条政策,Sam 是一个 AI 机器人,凭空编了一条。消息在 Hacker News 和 Reddit 上传开,有用户退订,联合创始人亲自出来澄清「我们没有这样的政策」。批评除了针对幻觉本身,还针对公司没有告诉用户 Sam 是个机器人。

**Replit 的 Agent 删除生产数据库(2025 年 7 月)。** 一位投资人在做「氛围编程」实验时,Replit 的 AI Agent 在明确的代码冻结指令下删除了一个生产数据库,里面是一千多位高管和公司的真实记录。之后它还生成了数千条假数据,并给出了误导性的状态说明。Replit 的 CEO 公开道歉,称这「不可接受,本不该发生」,随后上线了开发库和生产库自动隔离、只规划不执行的模式、一键从备份恢复等措施。

这三起事故分别是:**说错话**(编造或给出与事实不符的政策)、**透明度问题**(没告诉用户对面是 AI)、**做错事**(在不该有的权限下执行了破坏性操作)。注意它们的共同点:没有一个是靠传统的错误率告警发现的,全部是用户发现之后公开出来的。

## Agent 的六类事故

把公开案例和平时常见的问题归一下类,Agent 的事故大致有六类:

| 类型 | 典型样子 | 常见根因 | 靠什么发现 |
| --- | --- | --- | --- |
| 批量错误回答 | 大量回复引用了错误或编造的政策、价格 | prompt 改动、知识库更新出错、模型静默升级 | 线上评测分下降、转人工率和点踩率上升(Day 85 质量告警) |
| 越权或破坏性操作 | 退款金额错误、删除了不该删的数据 | 工具权限过大、缺少审批、参数校验缺失 | 工具调用审计、写操作数量异常、业务对账 |
| 成本暴涨 | 一小时花掉平时一天的钱 | 循环不终止、重试风暴、上下文无限增长 | 成本异常告警(Day 85)、单任务步数分布 |
| 注入攻击 | Agent 按照网页或邮件里的指令行事 | 不可信内容进入上下文,且有外发能力 | 护栏触发率、异常的外发或工具调用模式 |
| 供应商故障或变化 | 大面积超时,或者回答风格、格式突然变了 | 供应商宕机、限流、模型版本更新 | 网关错误率和降级率(Day 83)、格式校验失败率 |
| 数据泄露 | 回复里出现别的客户的信息 | 缓存键缺租户、检索没有租户过滤、记忆串了 | 很难自动发现,常靠客户投诉;靠隔离测试预防(Day 82) |

这张表最后一列是重点。传统的错误率和延迟告警只能覆盖其中的「供应商故障」。其他五类都要靠 Day 85 讲过的业务指标、质量指标和成本指标,外加业务层面的对账(比如每天核对 Agent 发起的退款总额和财务系统里的数字)。

## 头 15 分钟:先止血

事故响应的第一原则是**先止血,再查原因**。传统服务的止血手段是回滚和扩容;Agent 的止血需要一组更细的开关,因为你常常不想把整个 Agent 关掉(那样所有工单都涌进人工队列,客服团队会被淹没),而是想先把危险的那部分关掉。

我建议准备四档,从轻到重:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="四档紧急开关,从轻到重:正常、关闭写工具、全部回复进人工审核、Agent 下线。越往右影响越小的风险被切断,但人工负担越重">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="40" width="140" height="120" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="86" y="62" text-anchor="middle" fill="var(--ink)">0 NORMAL</text>
    <text x="86" y="90" text-anchor="middle" fill="var(--ink-soft)">一切照常</text>
    <rect x="170" y="40" width="140" height="120" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="240" y="62" text-anchor="middle" fill="var(--ink)">1 NO_WRITE</text>
    <text x="240" y="90" text-anchor="middle" fill="var(--ink-soft)">关掉退款、改订阅</text>
    <text x="240" y="108" text-anchor="middle" fill="var(--ink-soft)">等写工具</text>
    <text x="240" y="126" text-anchor="middle" fill="var(--ink-soft)">查询和回复照常</text>
    <rect x="324" y="40" width="140" height="120" rx="6" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="2"/>
    <text x="394" y="62" text-anchor="middle" fill="var(--ink)">2 HUMAN_REVIEW</text>
    <text x="394" y="90" text-anchor="middle" fill="var(--ink-soft)">回复先进审核队列</text>
    <text x="394" y="108" text-anchor="middle" fill="var(--ink-soft)">人点了才发出</text>
    <text x="394" y="126" text-anchor="middle" fill="var(--ink-soft)">Agent 当起草助手</text>
    <rect x="478" y="40" width="146" height="120" rx="6" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="2"/>
    <text x="551" y="62" text-anchor="middle" fill="var(--ink)">3 OFF</text>
    <text x="551" y="90" text-anchor="middle" fill="var(--ink-soft)">Agent 下线</text>
    <text x="551" y="108" text-anchor="middle" fill="var(--ink-soft)">工单全部转人工</text>
  </g>
  <line x1="16" y1="190" x2="624" y2="190" stroke="var(--ink-faint)" stroke-width="1.5"/>
  <polygon points="618,185 628,190 618,195" fill="var(--ink-faint)"/>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
    <text x="16" y="212">风险切得越多</text>
    <text x="624" y="212" text-anchor="end">人工负担越重</text>
    <text x="320" y="240" text-anchor="middle">按租户 x Agent 设置;只能往上拨,恢复必须由人确认</text>
  </g>
</svg>
<figcaption>四档紧急开关。做错事类的事故先拨到 1 档,说错话类的事故拨到 2 档,范围不清楚时拨到 3 档。开关的粒度是「租户 x Agent」,也支持全局通配。</figcaption>
</figure>

几个设计要点:

- **开关在数据面本地生效,不依赖控制面。** Day 82 讲过,控制面可能正好是出问题的那部分。开关状态放在 Redis 这类共享存储里,运行时每隔几秒读一次,或者订阅变更。
- **只能自动往上拨,不能自动往下拨。** 熔断器可以自动把开关从 0 拨到 2,但从 2 回到 0 必须有人确认。自动恢复的系统会在问题还没解决时反复开开关关,值班的人反而更难判断状态。
- **每一次拨动都留记录**:谁、什么时候、拨到哪一档、为什么。复盘时这就是时间线的骨架。
- **平时要演练。** 没演练过的开关,真出事时多半不好用:要么没人记得在哪,要么拨了才发现某个服务没读它。

除了这四档,还有几个常用的止血手段:**回滚 prompt 或 Agent 版本**(如果能定位到是哪次发布引起的);**固定模型版本**(如果怀疑供应商静默更新,在网关把模型组指向带日期的具体版本);**收紧预算**(成本暴涨时把这个 Agent 的预算临时调到很低,让网关替你拦住)。

## 自动熔断:让系统自己先拨开关

人发现问题、被叫醒、登录、判断、拨开关,快的话也要十几分钟。在这十几分钟里,一个出问题的 Agent 可能已经处理了几百张工单。所以除了人工开关,还需要**行为熔断器**:盯着某个行为指标的最近 N 次,坏的比例超过阈值就自动把开关拨上去,然后叫人。

适合做熔断的指标,是那些「一旦异常就很可能有事」的信号:转人工率、工具调用失败率、护栏触发率、单任务步数超过上限的比例、单任务成本超过上限的比例、写操作的金额超过阈值的比例。

下面是开关和熔断器的实现:

```python
# agent-60-lab/w13/incident/killswitch.py
import time
from collections import deque
from enum import IntEnum
from typing import Callable


class Mode(IntEnum):
    """数字越大越保守。事故时只能往大调,自动恢复只允许人来做。"""
    NORMAL = 0
    NO_WRITE = 1        # 关掉所有写工具(退款、改订阅),只读查询照常
    HUMAN_REVIEW = 2    # 回复全部进人工审核队列,不直接发给客户
    OFF = 3             # Agent 下线,工单直接进人工


class Switchboard:
    """每个租户 x Agent 一个开关。真实系统放 Redis/配置中心,数据面每几秒拉一次。"""

    def __init__(self) -> None:
        self.modes: dict[tuple[str, str], Mode] = {}
        self.history: list[tuple[float, str, str, Mode, str]] = []

    def get(self, tenant: str, agent: str) -> Mode:
        return max(self.modes.get((tenant, agent), Mode.NORMAL),
                   self.modes.get(("*", agent), Mode.NORMAL),
                   self.modes.get((tenant, "*"), Mode.NORMAL),
                   self.modes.get(("*", "*"), Mode.NORMAL))

    def set(self, tenant: str, agent: str, mode: Mode, who: str, reason: str) -> None:
        self.modes[(tenant, agent)] = mode
        self.history.append((time.time(), f"{tenant}/{agent}", who, mode, reason))

    def escalate(self, tenant: str, agent: str, mode: Mode, who: str, reason: str) -> None:
        if mode > self.modes.get((tenant, agent), Mode.NORMAL):
            self.set(tenant, agent, mode, who, reason)


class BehaviorBreaker:
    """盯着行为指标的熔断器:最近 N 次里出事的比例超过阈值,就自动把开关往上拨。"""

    def __init__(self, board: Switchboard, tenant: str, agent: str, window: int = 50,
                 threshold: float = 0.2, min_samples: int = 20, trip_to: Mode = Mode.HUMAN_REVIEW,
                 clock: Callable[[], float] = time.time):
        self.board, self.tenant, self.agent = board, tenant, agent
        self.events: deque[bool] = deque(maxlen=window)
        self.threshold, self.min_samples, self.trip_to = threshold, min_samples, trip_to

    def observe(self, bad: bool, what: str) -> None:
        self.events.append(bad)
        if len(self.events) >= self.min_samples:
            rate = sum(self.events) / len(self.events)
            if rate >= self.threshold:
                self.board.escalate(self.tenant, self.agent, self.trip_to, "breaker",
                                    f"{what} rate {rate:.0%} over last {len(self.events)}")


def allowed(mode: Mode, tool_risk: str) -> bool:
    if mode >= Mode.OFF:
        return False
    if mode >= Mode.NO_WRITE and tool_risk != "read":
        return False
    return True
```

```python
# agent-60-lab/w13/incident/test_killswitch.py
from killswitch import BehaviorBreaker, Mode, Switchboard, allowed


def test_global_switch_overrides_tenant():
    b = Switchboard()
    b.set("support", "refund-agent", Mode.NO_WRITE, "oncall-li", "退款金额异常")
    b.set("*", "*", Mode.HUMAN_REVIEW, "oncall-li", "模型供应商静默更新")
    assert b.get("support", "refund-agent") == Mode.HUMAN_REVIEW
    assert b.get("sales", "lead-agent") == Mode.HUMAN_REVIEW


def test_write_tools_blocked_in_no_write():
    assert allowed(Mode.NO_WRITE, "read")
    assert not allowed(Mode.NO_WRITE, "write")
    assert not allowed(Mode.OFF, "read")


def test_breaker_trips_on_escalation_spike():
    b = Switchboard()
    br = BehaviorBreaker(b, "support", "refund-agent", window=50, threshold=0.2, min_samples=20)
    for i in range(30):
        br.observe(bad=(i % 10 == 0), what="escalation")      # 10%,不触发
    assert b.get("support", "refund-agent") == Mode.NORMAL
    for _ in range(15):
        br.observe(bad=True, what="escalation")
    assert b.get("support", "refund-agent") == Mode.HUMAN_REVIEW
    assert b.history[-1][2] == "breaker"
```

运行 `uv run pytest -q w13/incident`,我本机是 `3 passed`。

接入方式很简单:Agent 运行时每次准备调用工具之前,先用 `allowed(board.get(tenant, agent), risk)` 检查,不允许就不调用,改为告诉用户「这个操作需要人工处理」并转人工;每次运行结束时,把「是否转人工」「是否触发护栏」等结果喂给对应的 `BehaviorBreaker`。模式为 `HUMAN_REVIEW` 时,运行时照常生成回复,但不直接发给客户,而是放进人工审核队列。

熔断阈值怎么定?先看历史数据。如果转人工率平时在 5% 到 8% 之间波动,阈值可以定在 20%;`min_samples` 防止样本太少时一两个坏事件就触发。阈值太敏感会导致频繁误触发,大家很快就会想办法绕过它,那比没有熔断器更糟。

## 查原因:trace、回放和差异

止血之后才是查原因。Agent 事故的根因定位有一套和传统服务不太一样的方法。

**第一步,圈定范围。** 从 Day 85 的看板上确认:哪个租户、哪个 Agent、哪个版本、从什么时候开始。把指标按 Agent 版本和模型组拆开,很多时候一眼就能看出「从 v14 发布那一刻开始」或者「只有走备用供应商的那部分」。

**第二步,看 trace。** 从异常时间段里挑出被采样下来的坏 trace(尾部采样会把转人工、低评分的都留下),再挑几条同一时间段的正常 trace 对比。重点看:模型看到了什么(检索回来的知识库片段、工具返回的结果)、它决定调用了什么、参数是什么。

**第三步,回放。** 这是 Agent 排查里最有用的技巧。把一条坏 trace 里的输入(用户消息、检索结果、工具返回值)全部取出来,在测试环境里重放一遍,换不同的变量看结果:用上一个版本的 prompt 重放、用另一个模型重放、用修正过的知识库片段重放。Day 33 做轨迹评测时你已经有了「记录工具返回、回放」的能力,这里直接复用。回放能把「是 prompt 的问题、模型的问题还是数据的问题」区分开。

**第四步,看变更。** 事故开始前后都变了什么?prompt 版本、Agent 代码、知识库内容、工具 server 的版本、网关路由、模型供应商的模型版本(这一项最容易被忽略,因为它不是你变的)。一个好的平台会把所有这些变更都记录在同一条时间线上,复盘时把它和指标曲线叠在一起看。

举一个具体的例子。某天下午 SupportPilot 的转人工率从 6% 涨到 23%。按版本拆开,发现所有版本都涨了,排除了 prompt 发布。按模型组拆开,只有 `smart` 组涨了。看变更时间线,没有任何自己的发布。看坏 trace,发现回复的格式变了:原来结构化输出的 JSON 里多了一层包装,解析失败后走了转人工兜底。回放:用固定版本号的模型重放,一切正常;用模型的别名(不带日期)重放,复现。结论是供应商把别名指向了新版本,新版本的输出格式有细微变化。止血是在网关把 `smart` 组固定到带日期的旧版本,长期措施是所有模型组都用固定版本、升级要走评测。

## 写一份无责复盘

问题解决之后要写复盘(postmortem)。Google SRE 把这种文化叫做「无责复盘」(blameless postmortem):复盘关注的是系统和流程哪里让这个错误能够发生、为什么没有更早发现,而不是追究某个人的责任。理由很现实:如果复盘变成追责,大家下次就会隐瞒问题,而你最需要的就是信息。

一份 Agent 事故的复盘,我建议包含这些部分:

```markdown
# 事故复盘:SupportPilot 转人工率飙升(2026-10-08)

## 摘要
一两句话:发生了什么、影响多大、根因是什么、已经修复了没有。

## 影响
- 时间范围:14:12 – 15:47(共 95 分钟),其中 14:12 – 14:58 未被发现
- 受影响工单:3,412 张转人工,其中约 2,600 张本可自动处理
- 客户影响:平均首次回复时间从 2 分钟上升到 41 分钟
- 成本:人工处理额外约 120 人时;模型费用无明显变化
- 是否有错误回复发给客户:否(解析失败后走了转人工兜底)

## 时间线(全部用 UTC+8,每一条写清楚信息来源)
- 14:05 供应商将模型别名指向新版本(事后从供应商变更公告得知)
- 14:12 转人工率开始上升(看板)
- 14:58 燃烧速率告警触发,值班工程师被呼叫(告警系统)
- 15:06 将 support/refund-agent 开关拨到 HUMAN_REVIEW(开关审计日志)
- 15:31 定位到 smart 组输出格式变化(回放结果)
- 15:40 网关将 smart 组固定到旧版本(网关配置变更记录)
- 15:47 转人工率恢复,开关恢复 NORMAL(由值班工程师确认)

## 根因
可能有多个,每个都写:为什么会发生、为什么没被拦住。
1. 模型组使用了不带日期的别名,供应商升级直接生效
2. 结构化输出解析失败时只转人工、没有单独的指标和告警
3. 回归评测只在我们自己发布时运行,供应商的变化不会触发

## 做得好的
- 解析失败走转人工兜底,没有错误回复发给客户
- 开关拨动后 2 分钟内生效

## 待办(每一项都要有负责人和日期)
| 待办 | 类型 | 负责人 | 截止 |
| --- | --- | --- | --- |
| 所有模型组改用带日期的固定版本 | 预防 | 平台组 | 10-15 |
| 新增「结构化输出解析失败率」指标和熔断 | 发现 | 平台组 | 10-17 |
| 每天定时对每个模型组跑一次回归评测 | 发现 | 评测组 | 10-22 |
| 把这次的 20 条坏 trace 脱敏后加入评测集 | 预防 | 客服 Agent 组 | 10-12 |
```

写复盘时有几个小心得。时间线每一条都写信息来源,否则大家会凭记忆争论「到底几点发现的」。根因不要只写一个,「5 个为什么」很容易被追问成一条线,而真实的事故几乎总是几个因素叠加。「做得好的」那一节不能省,它告诉大家哪些设计是有效的、应该保留。待办要能追踪,很多团队复盘写得很好,待办三个月后一项都没完成。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/qgHWzQ2zcqQ" title="Postmortem Culture at Google | Ramon Medrano Llamas | Conf42 SRE 2022" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Conf42 · Postmortem Culture at Google · 23 分钟。Google 的 SRE 讲他们的复盘文化:什么时候必须写复盘、为什么要无责、复盘文档怎么评审、待办怎么追踪。</figcaption>
</figure>

## 拿模板练手:复盘 OpenClaw 的一键 RCE

上面的模板写的是我们自己的事故。练习写复盘最好的材料是别人公开过的事故,因为信息来源是公开的,你能逐条核对。2026 年 Agent 圈最典型的一起是 OpenClaw。它是一个自部署的个人 AI 助手(早期叫 Clawdbot,中间改名 Moltbot),本机跑一个 gateway 进程,能读写文件、执行命令、连各种聊天软件,再配一个浏览器里打开的 Control UI 管理界面。

先说明这份复盘的局限:我们是局外人,时间线和影响只能用公开资料拼,一手的(官方安全通告、项目自己的安全策略、GitHub 通告库的查询结果)和二手的(安全公司博客)我分开标了。暴露实例的数量各家说法差得很远,这本身就是复盘里要写进去的事实。

### 摘要

OpenClaw 的 Control UI 会从网页地址的查询参数里读取 gateway 地址,并且页面一打开就自动连接,连接时把本地保存的 gateway 令牌一起发过去。攻击者只要让已登录过 Control UI 的用户点开一个构造好的链接,令牌就会发到攻击者的服务器上;拿到令牌后可以连回受害者的 gateway,改掉沙箱和工具策略,再让它执行任意命令。漏洞编号 CVE-2026-25253,CVSS 8.8,2026.1.29 版修复。

### 影响

- 影响版本:2026.1.28 及以前([GitHub 安全通告 GHSA-g8p2-7wf7-98mq](https://github.com/advisories/GHSA-g8p2-7wf7-98mq),一手)。
- 只监听本机回环地址也没用。通告里写得很清楚:发起外连的是受害者自己的浏览器,浏览器充当了桥。很多人以为「我没开公网端口所以安全」,这次正好不成立。
- 拿到的是操作员级别的权限,能改配置、执行命令,等于拿下了跑 gateway 的那台机器。个人助手通常装在开发者自己的电脑上,上面有 SSH 密钥、云凭据、浏览器会话。
- 公网暴露规模:ProArch 称到 2 月 3 日公开披露时已发现 4 万多个暴露在公网的实例,其中 63% 被评估为可远程利用([ProArch](https://www.proarch.com/blog/threats-vulnerabilities/openclaw-rce-vulnerability-cve-2026-25253),二手);其他文章里有 4.2 万、13.5 万等说法,我没找到原始扫描报告,这些数字都按「未核实」处理。

### 时间线

- 2026-01-30:修复版 2026.1.29 发布,改法是换 gateway 地址时必须在界面上让用户确认(修复日期来自 [SOCRadar](https://socradar.io/blog/cve-2026-25253-rce-openclaw-auth-token/) 等二手报道;改法来自官方通告)。
- 2026-02-02:GitHub 发布安全通告,CVSS 8.8(通告页面,一手)。
- 2026-02-03 前后:安全公司陆续发文,暴露实例统计出来(二手)。
- 之后几个月:通告一批接一批。我在 2026-10-22 用 GitHub 通告库的接口查 `affects=openclaw`,一共返回 765 条,时间从 2 月到 10 月,3 月最多(335 条),单日最多是 3 月 3 日的 102 条,7 月 2 日也有 40 条;按严重程度,critical 26 条、high 267 条。查询方法:`curl "https://api.github.com/advisories?affects=openclaw&per_page=100"`,按响应头里的 `Link` 翻页。

### 根因

照模板,不止写一个,每个都问「为什么会发生、为什么没被拦住」。

1. **管理界面信任了地址栏里的参数。** 一个能改沙箱策略的界面,接受外部链接指定「连到哪里」,还自动带上令牌。这是传统 Web 安全问题,和大模型无关,Day 84 讲 OAuth 时反复强调令牌要校验受众、回调地址要事先确定,道理相同:凭据只能发给验证过的对象,这里缺的就是这一条。
2. **一个令牌能做所有事。** 拿到 gateway 令牌就能关掉沙箱。改安全策略这种操作没有单独的二次确认,也没有和日常使用分开的权限。
3. **「本机就安全」的假设。** 回环地址挡得住外网直连,挡不住受害者浏览器替攻击者发请求。
4. **安装量涨得比安全投入快。** 后面几个月几百条通告说明问题不是一个漏洞,而是整体上先做功能、后补安全。这一条在复盘里要写,但要写成系统原因,不是指责某个人。

还有一条要单独记下来,因为它决定了这类产品的风险边界。OpenClaw 的[安全策略](https://openclaw.ai/security)把「没有绕过策略、鉴权、审批、沙箱或工具边界的 prompt injection」明确列为不受理的范围,理由是它假设一个 gateway 只有一个可信的操作员。换句话说,项目方认为 prompt injection 一定会发生,防线放在边界上。这个判断本身没错,Day 39 讲过 prompt injection 没有根治办法;但它意味着边界(鉴权、沙箱、审批)一旦像这次一样被打穿,就没有第二道防线了。

### 做得好的

通告写得清楚:根因、影响范围、为什么回环地址也受影响,一段话说完,下游用户能自己判断要不要紧急升级。安全策略把「什么算漏洞」写得很明确,报告者和维护者不用每次争论。

### 对你的平台,待办是什么

复盘别人的事故,最后一节换成「我们自己要做什么」:

| 待办 | 对应根因 |
| --- | --- |
| 所有管理界面不从 URL 参数接受后端地址;换地址必须人工确认 | 1 |
| 改沙箱、改工具权限、改审批规则这类操作单独授权,要二次确认并写审计日志 | 2 |
| 本机服务也要鉴权并校验请求来源(Origin),不能因为只监听 localhost 就省掉 | 3 |
| 给员工电脑上装的 Agent 类工具建台账,定期查版本,有通告时能在一天内找到所有受影响的机器 | 4 |
| 把「一个外部链接让 Agent 失控」写成故障演练场景,每季度演一次 | 全部 |

最后一条待办和下面「防再发」那一节的定期演练是同一件事。

## 防再发:把事故变成资产

复盘的价值最终体现在「同样的事不再发生」。对 Agent 来说,有几种特别有效的防再发手段。

**事故 trace 进评测集。** 每次事故都会留下一批「坏样本」,把它们脱敏后加进回归评测集(W5、W11),并写清楚期望的行为。下一次有人改 prompt 或者换模型,这些用例会第一时间告诉你同样的问题有没有回来。这是成本最低、效果最好的一条。

**灰度发布。** prompt、Agent 代码、模型版本的变更都应该先给一小部分流量(比如 5%),对比新旧版本的成功率、转人工率、评测分、成本,确认没问题再全量。SRE Workbook 专门有一章讲金丝雀发布。Agent 的灰度要注意样本量,W11 讲过,几十个样本上两三个百分点的差异不说明任何问题。

**确定性护栏。** 针对「做错事」类的事故,在工具层加确定性的检查(Day 40、Day 84):退款金额不超过原订单金额、单个客户一天的退款次数上限、删除类操作必须先有备份。这些检查不依赖模型的判断,是最可靠的一道防线。Replit 事故之后加上的开发库和生产库强制隔离,就是这一类措施。

**限制爆炸半径。** 新上线的 Agent 先只开读工具;写工具从小额、小范围开始;权限按需增加。不要第一天就给一个 Agent 完整的生产权限。

**定期演练。** 每个季度做一次故障演练(game day):在测试环境或者低峰期,故意制造一个故障(让某个工具返回错误数据、让主供应商超时、往知识库里放一篇错误的文章),看告警会不会响、开关好不好用、值班的人知不知道怎么处理。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18MgHzXE5G&autoplay=0&high_quality=1" title="AI删库跑路还撒谎！硅谷大佬9天从狂赞到脱粉，翻车实录来了" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>量子位Daily · AI 删库跑路还撒谎!硅谷大佬 9 天从狂赞到脱粉,翻车实录来了 · 2 分钟。Replit 事故的中文快速回顾。看完想一想:如果你是 Replit 的平台工程师,今天讲的哪几条措施能挡住它。</figcaption>
</figure>

## 值班手册

最后,每个 Agent 都应该有一份值班手册(runbook),值班的人半夜被叫醒时照着做。它至少包括:

- 这个 Agent 是干什么的,依赖哪些服务(模型组、工具 server、知识库)。
- 看板和 trace 的链接,常用的过滤条件。
- 紧急开关在哪、每一档的效果、拨了之后要通知谁(客服负责人要知道人工队列要涨了)。
- 常见告警对应的排查步骤:转人工率飙升先看什么、成本暴涨先看什么、供应商故障怎么确认。
- 升级路径:什么情况下要叫醒谁(业务负责人、安全团队、法务)。涉及数据泄露或者错误的资金操作,要立即升级。
- 对外沟通:客服团队要不要发公告、用什么口径。Cursor 那次事故里,用户最不满的除了错误本身,还有「不知道对面是机器人」。

## 动手练习

**第一步:接入开关和熔断器(1.5 小时)。** 跑通 `w13/incident` 的测试。然后把 `Switchboard` 和 `BehaviorBreaker` 接进你的 SupportPilot:工具调用前检查开关,运行结束后把「是否转人工」喂给熔断器。开关状态先存在内存,有余力的话改成 Redis。

**第二步:做一次故障演练(1.5 小时)。** 在测试环境里故意制造故障,任选一个:

1. 把知识库里的退款政策文章改成错误版本(比如把「3 个工作日」改成「30 个工作日」)。
2. 让 `get_invoice` 工具一半的调用返回空结果。
3. 在 prompt 里引入一个会让结构化输出格式出错的改动。

用你的评测集或者模拟流量跑 200 张工单,观察:哪个指标先变化?熔断器有没有触发?触发后是否按预期进入 `HUMAN_REVIEW`?从故障注入到熔断触发用了多久?

**第三步:写复盘和值班手册(1 小时)。** 按今天的模板,为你的演练写一份复盘,包括时间线、根因、做得好的、待办。再为 SupportPilot 写一份值班手册。

**验收标准:**

- 开关和熔断器接入了 SupportPilot,`NO_WRITE` 下退款工具确实不会被调用,`HUMAN_REVIEW` 下回复进了审核队列而不是直接发出。
- 演练记录里有「从注入故障到熔断触发」的时间。
- 复盘里的待办至少有一项是「把演练中的坏样本加入评测集」,并且你真的加了。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 止血(mitigation) | 先阻止事故继续扩大,再查原因 |
| 紧急开关(kill switch) | 运行时可以立刻生效的开关,用于关闭某些能力或整个 Agent |
| 行为熔断器 | 监控行为指标,异常比例超过阈值时自动收紧开关 |
| 爆炸半径(blast radius) | 一个故障最多能影响到的范围 |
| 回放(replay) | 用记录下来的输入在测试环境重新执行,替换变量定位根因 |
| 无责复盘(blameless postmortem) | 关注系统和流程而非个人责任的事故复盘 |
| 值班手册(runbook) | 值班人员处理某类告警或事故的操作指南 |
| 灰度 / 金丝雀发布 | 新版本先给一小部分流量,对比确认后再全量 |
| 故障演练(game day) | 主动制造故障来检验告警、开关和流程是否有效 |
| 模型别名 | 不带日期的模型名,供应商可能随时把它指向新版本 |
| CVE / 安全通告 | 公开漏洞的统一编号和说明文档,GitHub 通告库(GHSA)可以按包名查询 |
| 信任边界 | 系统里「这边的输入可信、那边不可信」的分界线,复盘时先画出来再看哪条被越过了 |

## 常见误区

**「只监听 localhost 就不用鉴权」。** 浏览器会替攻击者向本机端口发请求,OpenClaw 的 CVE-2026-25253 就是这样绕过回环地址的。本机服务同样要鉴权并校验请求来源。

**只靠错误率和延迟告警发现 Agent 事故。** Agent 最常见的事故是「一切正常但在做错事」,要靠转人工率、评测分、点踩率、成本、写操作数量和业务对账来发现。

**出事后先查原因再止血。** 查原因可能要一个小时,这期间 Agent 还在继续出错。先拨开关,再慢慢查。

**只有一个「关掉 Agent」的开关。** 全关会把所有工单压给人工,客服团队可能扛不住。分档开关让你只切掉危险的部分。

**熔断器可以自动恢复。** 问题没解决就自动恢复,系统会反复开关,状态混乱。自动只能往严拨,恢复由人确认。

**复盘变成追责会。** 追责会让下一次的问题被隐瞒。复盘关注系统为什么允许这个错误发生、为什么没有更早发现。

**复盘写完就结束了。** 待办没人跟进,同样的事故会再来一次。待办要有负责人和日期,最重要的一条是把坏样本加进评测集。

## 学习资料

### 文档与文章

- [Google SRE Book · Postmortem Culture: Learning from Failure](https://sre.google/sre-book/postmortem-culture/):无责复盘的原始出处,包括什么情况必须写复盘、复盘怎么评审。40 分钟。
- [Google SRE Workbook · Incident Response](https://sre.google/workbook/incident-response/):事故指挥的角色分工(指挥、沟通、操作),以及几个真实事故的处理过程。1 小时。
- [Google SRE Workbook · Postmortem Culture](https://sre.google/workbook/postmortem-culture/):给了一份好复盘和一份差复盘的对比,非常直观。40 分钟。
- [PagerDuty Incident Response](https://response.pagerduty.com/):PagerDuty 公开的事故响应手册,值班、升级、沟通的模板拿来就能用。1 小时。
- [AI Incident Database · Incident 1039](https://incidentdatabase.ai/cite/1039/):Cursor「Sam」事件的记录。这个数据库收录了大量 AI 事故,做 Agent 的人值得偶尔翻翻,看看别人踩过什么坑。20 分钟。
- [BBC · Air Canada 聊天机器人事件](https://www.bbc.com/travel/article/20240222-air-canada-chatbot-misinformation-what-travellers-should-know):事件经过和裁决要点。10 分钟。
- [eWeek · Replit 的 AI Agent 删除生产数据库](https://www.eweek.com/news/replit-ai-coding-assistant-failure/) 和 [eWeek · Cursor 的客服机器人编造政策](https://www.eweek.com/news/cursor-ai-chatbot-hallucination-fake-policy/):另外两起事故的报道。各 10 分钟。
- [GitHub 安全通告 · CVE-2026-25253](https://github.com/advisories/GHSA-g8p2-7wf7-98mq):OpenClaw 一键 RCE 的官方通告,根因和影响各一段,10 分钟。拿它练习按今天的模板写复盘。
- [OpenClaw 安全策略](https://openclaw.ai/security):看「Outside scope」那一节,理解为什么项目方把单纯的 prompt injection 排除在外,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV118411j7Wz&autoplay=0&high_quality=1" title="《Google SRE工作手册》第三期SRE事故响应和复盘的应用分享" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ZTA-SRE专委会 · 《Google SRE 工作手册》第三期:SRE 事故响应和复盘的应用分享 · 20 分钟。国内 SRE 社区讲工作手册里的事故响应和复盘在国内团队怎么落地,和上面的英文资料互补。</figcaption>
</figure>

上面那个 Replit 删库的回顾也在这一组。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/-pXoiqj7kRA" title="Postmortem Culture at Google: How Do We Learn From Failures and How Can You, Too? Martin Hoefling" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Container Solutions · Postmortem Culture at Google: How Do We Learn From Failures and How Can You, Too? · 48 分钟。比上面那个演讲更长、更系统,后半段讲小团队怎么借鉴 Google 的做法,适合想在自己团队推行复盘文化的人。</figcaption>
</figure>

上面那个 Conf42 的演讲也在这一组。

### 书籍

- 《SRE:Google 运维解密》(Site Reliability Engineering,O'Reilly 2016;中文版电子工业出版社):第 14 章「Managing Incidents」(事故管理)和第 15 章「Postmortem Culture」(事后总结)。英文版在 sre.google 免费在线阅读。1.5 小时。
- 《The Site Reliability Workbook》(O'Reilly, 2018):第 9 章「Incident Response」、第 10 章「Postmortem Culture」、第 16 章「Canarying Releases」。同样免费在线。2 小时。

### 开源项目与代码

- [PagerDuty/incident-response-docs](https://github.com/PagerDuty/incident-response-docs):上面那份事故响应手册的源码仓库,可以 fork 一份改成你们团队的版本。30 分钟。
- [dastergon/postmortem-templates](https://github.com/dastergon/postmortem-templates):收集了多家公司的复盘模板,对比着看,挑适合你们的格式。20 分钟。

## 自测

1. Air Canada 案例里,航空公司辩称聊天机器人是独立实体。裁决庭的结论对 Agent 工程师意味着什么?

<details><summary>答案</summary>

裁决庭认定公司对自己网站上的所有信息负责,包括聊天机器人说的话。对工程师来说,Agent 的输出就是公司的承诺,涉及政策、价格、退款这类有法律或财务后果的内容,必须基于权威来源(知识库检索并带引用),不能让模型自由发挥;没有依据时应该说不知道或转人工;并且要有质量监控及时发现批量错误回答。

</details>

2. 说出 Agent 六类事故中的四类,以及各自主要靠什么信号发现。

<details><summary>答案</summary>

批量错误回答:线上评测分、转人工率、点踩率。越权或破坏性操作:工具调用审计、写操作数量异常、业务对账。成本暴涨:成本异常告警、单任务步数和成本分布。注入攻击:护栏触发率、异常外发或工具调用模式。供应商故障或变化:网关错误率、降级率、格式校验失败率。数据泄露:较难自动发现,靠隔离测试预防和客户反馈。

</details>

3. 为什么熔断器只能自动收紧,不能自动恢复?`min_samples` 起什么作用?

<details><summary>答案</summary>

自动恢复会在问题还没解决时反复开关,系统状态在正常和保守之间来回切换,值班的人难以判断现状,客户体验也不稳定。恢复应该由人在确认问题解决后执行。`min_samples` 防止样本太少时一两个坏事件就让比例超过阈值,造成误触发;频繁误触发会让团队想办法绕过熔断器。

</details>

4. 转人工率突然从 6% 涨到 23%,但你们当天没有任何发布。你会按什么顺序排查?

<details><summary>答案</summary>

先止血:按影响拨开关(没有错误回复发出的话可能只需要观察,有错误回复就拨到 HUMAN_REVIEW)。然后圈范围:按租户、Agent 版本、模型组、工具拆指标,看是全局还是局部。看变更时间线,包括不是自己发起的变更:供应商的模型版本(别名是否被指向新版本)、工具 server 的发布、知识库内容的更新、上游数据的变化。挑坏 trace 和同期正常 trace 对比,看模型输入和工具返回有什么不同。用回放区分 prompt、模型、数据三类原因:换固定版本的模型重放、换修正后的数据重放。

</details>

5. 复盘的待办里,为什么「把坏样本加入评测集」被认为是性价比最高的一项?

<details><summary>答案</summary>

它几乎没有成本,而且是一种持续生效的防线:之后任何人改 prompt、换模型、改知识库,回归评测都会检查同样的问题有没有回来,包括供应商静默更新这种不是自己引起的变化。其他措施(比如改架构、加护栏)往往只针对这一次的具体根因,评测用例针对的是用户可见的行为本身。

</details>

6. **资深面试题**:你负责的客服 Agent 平台服务 20 个业务团队。过去三个月发生了 4 次 Agent 事故,都是用户先发现的。老板要你在一个季度内把「用户先发现」的比例降下来。你怎么做?

<details><summary>答案</summary>

先复盘这 4 次事故,按六类归类,分析每次为什么监控没发现(缺哪个指标、哪个告警、阈值是否合理)。然后建立平台级的发现能力:每个 Agent 必须有业务和质量指标(转人工率、线上评测分、点踩率、写操作数量和金额),基于 SLO 的燃烧速率告警和成本异常告警(Day 85);平台提供行为熔断器,团队只需要配置阈值;关键写操作每天和业务系统对账。再建立止血能力:分档紧急开关在所有 Agent 上统一接入,并通过季度演练验证。预防侧:模型组固定版本、供应商变化触发定时回归评测;prompt 和模型变更走灰度;每次事故的坏样本进评测集。用指标衡量效果:事故中「系统先发现」的比例、平均发现时间、平均止血时间。还要提到文化:无责复盘、待办追踪到关闭,以及把这些能力做成平台默认提供的,而不是要求 20 个团队各自实现。

</details>

7. OpenClaw 的安全策略说「没有绕过边界的 prompt injection 不算漏洞」。如果你在给公司选一个类似的个人 Agent 工具,这句话会让你怎么评估它的风险?

<details><summary>答案</summary>

这句话说明项目方默认 prompt injection 一定会发生,安全完全依赖鉴权、沙箱、审批这些边界。所以评估重点就是边界本身:改沙箱和权限的操作是否单独授权、是否有审计、本机服务有没有鉴权和来源校验、历史通告里边界被绕过的次数和修复速度(可以去 GitHub 通告库按包名查)。同时公司这边要假设边界会被打穿,限制它能碰到的凭据和数据,比如不在装了它的机器上放生产密钥,并把它纳入资产台账,有通告时能快速找到所有安装点。

</details>

## 明天预告

Day 88 是 **W13 复习:AgentOps 平台架构评审**。这一周讲了平台架构、模型网关、MCP 网关、可观测、治理、事故响应。明天把它们拼成一份完整的 AgentOps 平台设计文档,用一份 30 多项的架构评审清单逐项过一遍,再整理这周的资深面试题和坑清单。这份设计文档就是 Day 96 进阶毕业项目开题时的底稿。
