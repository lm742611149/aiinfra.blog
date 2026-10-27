---
title: 'Day 619 · Agent 产品(一):自主程度、动作分级、透明度'
description: '一个 Agent 的评测分数很好看,上线后却没人敢开,多半是产品问题而不是模型问题。今天先把「Agent 该有多大自主权」拆成五级和一张动作表,用代码写出分级规则并用测试逮住自己写错的地方,再用真实模型对比两种「把握程度」的展示方式。'
pubDate: 2026-10-27
regime: none
tags: ['agent-ux', 'autonomy', 'human-in-the-loop', 'python', 'agent-zero']
series: 'agent-zero'
day: 619
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 618](/blog/agent-zero/day-618-payments-2/) 写了一个钱包授权框:Agent 每花一笔钱,先过一段不问模型的代码,得到三种判决之一,`approve`(框内,直接付)、`ask_user`(框里没写清楚,回去问人)、`deny`(框外,直接拒绝)。当时留了一句没展开的话:`ask_user` 那一句提示该怎么写,才能让用户一眼看懂、不会手一滑点了确认。

三种判决其实就是一种最粗的「动作分级」。今天把它做细:一个 Agent 的自主权不是一个开关,而是一排滑杆,每个动作各有各的位置。后面两天(620 讲撤销、出错、放权,621 讲界面怎么画)都踩在今天这张表上。

## 今天要解决的问题

我见过的 Agent 项目里,最常见的一种失败长这样:评测分数不错,内部演示也顺利,上线后使用率上不去。去问客服同事,答案出奇一致,「它有时候直接给客户发错东西,我不敢开」「它到底在干嘛我看不懂,出了事我说不清」。这两句里没有一句是在抱怨模型不够聪明。

学完今天你应该能:

1. 用五级自主程度描述一个 Agent 的行为,并说清为什么「我们的 Agent 是第几级」这个问法本身就是错的。
2. 用「能不能撤回、客户看不看得到、涉及多少钱、一次影响几个人」四个因素给每个动作定级,并把规则写成能跑的代码和测试。
3. 说出透明度该给用户看哪三样东西,并用真实模型验证:同样的情况,「给一个置信度数字」和「说清楚哪里没数据」差在哪。

预计用时 2.5 到 3 小时。前置:[Day 618](/blog/agent-zero/day-618-payments-2/) 的 `wallet_box.py`(练习 2 要用),Day 280 建的 `cloudledger/seed.py` 和 `cloudledger.db`(如果你的仓库里还没有,在 `agent-zero-lab` 根目录跑 `uv run python cloudledger/seed.py`),Day 135 建的 `common/llm.py`(LLMClient)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

今天的文件都放在 `agent-zero-lab/part10/ux/` 下。先建目录:

```bash
cd ~/agent-zero-lab
mkdir -p part10/ux && touch part10/ux/__init__.py
```

`__init__.py` 是一个空文件,作用是告诉 Python「这个目录是一个包」,后面才能写 `from part10.ux.levels import Level`。相当于 JS 里让一个文件夹能被 `import` 的 `index.js`,只不过这里的它什么都不用写。

## 先把问题问对:不是「Agent 第几级」,是「这个动作第几级」

先讲结论,再解释。一个 Agent 产品里,不同动作应该处在不同的自主程度上。查账单可以全自动,给客户回邮件可以先让人看一眼,退款一定要有人点头。如果有人问你「你们的 Agent 是第几级」,正确的反应是反问一句「哪个动作?」。

自主程度有一套现成的说法。2025 年有一篇论文,《Levels of Autonomy for AI Agents》([arXiv 2506.12469](https://arxiv.org/abs/2506.12469)),按「用户在这件事里扮演什么角色」把自主程度分成五级,我按它的思路给五个级别起了名字(名字和每级的含义是我的概括,细节以论文为准):

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="五级自主程度和 CloudLedger 里几个动作的位置">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <line x1="30" y1="120" x2="610" y2="120" stroke="var(--rule)" stroke-width="2"/>
    <circle cx="70" cy="120" r="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <circle cx="190" cy="120" r="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <circle cx="310" cy="120" r="6" fill="var(--paper-raised)" stroke="var(--ink-soft)"/>
    <circle cx="430" cy="120" r="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <circle cx="550" cy="120" r="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="70" y="146" text-anchor="middle" fill="var(--ink)">L1 操作者</text>
    <text x="70" y="162" text-anchor="middle" fill="var(--ink-soft)" font-size="11">只给建议</text>
    <text x="190" y="146" text-anchor="middle" fill="var(--ink)">L2 协作者</text>
    <text x="190" y="162" text-anchor="middle" fill="var(--ink-soft)" font-size="11">起草,人提交</text>
    <text x="310" y="146" text-anchor="middle" fill="var(--ink)">L3 顾问</text>
    <text x="310" y="162" text-anchor="middle" fill="var(--ink-soft)" font-size="11">做之前先问</text>
    <text x="430" y="146" text-anchor="middle" fill="var(--ink)">L4 审批者</text>
    <text x="430" y="162" text-anchor="middle" fill="var(--ink-soft)" font-size="11">先做,窗口内可撤</text>
    <text x="550" y="146" text-anchor="middle" fill="var(--ink)">L5 观察者</text>
    <text x="550" y="162" text-anchor="middle" fill="var(--ink-soft)" font-size="11">全自动,看日志</text>
    <text x="550" y="96" text-anchor="middle" fill="var(--ink)">list_invoices</text>
    <text x="550" y="80" text-anchor="middle" fill="var(--ink)">tag_ticket</text>
    <text x="190" y="96" text-anchor="middle" fill="var(--ink)">send_reply(起步)</text>
    <path d="M 205 90 L 415 90" stroke="var(--mem)" stroke-dasharray="4 3" fill="none"/>
    <text x="310" y="84" text-anchor="middle" fill="var(--ink-soft)" font-size="11">数据好了才往右挪</text>
    <text x="310" y="196" text-anchor="middle" fill="var(--ink)">create_refund_request</text>
    <text x="310" y="212" text-anchor="middle" fill="var(--ink)">bulk_notify</text>
    <text x="310" y="232" text-anchor="middle" fill="var(--ink-faint)" font-size="11">钉在 L3,不随信任上升</text>
    <text x="30" y="30" fill="var(--ink-faint)" font-size="11">← 人的控制多</text>
    <text x="610" y="30" text-anchor="end" fill="var(--ink-faint)" font-size="11">AI 的自主多 →</text>
  </g>
</svg>
<figcaption>五级是一条轴,每个动作各占一个位置。回复客户从 L2 起步,数据好了可以往右挪;退款和批量通知钉在 L3,信任再高也不动。</figcaption>
</figure>

同一个 Agent、同一个产品里,这几个动作的位置并不相同,这就是整节的要点。Andrej Karpathy 在 2025 年那场《Software Is Changing (Again)》演讲里讲过同一个想法,叫「自主程度滑杆」:好的 AI 产品让用户自己调这根滑杆,而且要让验证变得又快又容易,因为人还在回路里的时候,人的验证速度就是整个系统的瓶颈。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CLNtzyEP4&autoplay=0&high_quality=1" title="大神Andrej Karpathy最新演讲：AI时代的软件" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Web3天空之城 · 大神Andrej Karpathy最新演讲:AI时代的软件 · 中文字幕版,重点听讲「部分自主应用」和自主程度滑杆的那一段。</figcaption>
</figure>

### 第一步:把五个级别写成代码

先用最小的脚本把五级放进代码里。Python 里表示「一组固定的选项」用 `enum`,相当于 TypeScript 的 `enum`。这里用 `IntEnum`,每个成员背后是一个整数,好处是级别之间能直接比大小,和 TS 里的数字枚举一样。

```python
# agent-zero-lab/part10/ux/levels.py
from enum import IntEnum


class Level(IntEnum):
    OPERATOR = 1      # 操作者:人做,Agent 只给建议
    COLLABORATOR = 2  # 协作者:Agent 起草,人改了再提交
    CONSULTANT = 3    # 顾问:Agent 主导,关键处先问人
    APPROVER = 4      # 审批者:Agent 先做,人在窗口期内能撤
    OBSERVER = 5      # 观察者:全自动,人只看日志


MODE = {
    Level.OPERATOR: "只给建议",
    Level.COLLABORATOR: "起草,等人提交",
    Level.CONSULTANT: "执行前确认",
    Level.APPROVER: "先执行,留撤销窗口",
    Level.OBSERVER: "直接执行并记日志",
}

if __name__ == "__main__":
    for lv in Level:
        print(lv.value, lv.name, MODE[lv])
    print(Level.CONSULTANT < Level.OBSERVER, int(Level.APPROVER))
    print(Level(6))
```

<div class="line-notes">

- `from enum import IntEnum` 从标准库拿 `IntEnum`。标准库不用 `uv add`,装好 Python 就有。
- `class Level(IntEnum):` 定义一个枚举。括号里的 `IntEnum` 表示「继承自它」,相当于 TS 的 `enum Level { ... }`,只不过成员值是整数。
- `OPERATOR = 1      # 操作者:人做,Agent 只给建议` 成员名等于号后面是它背后的整数。这一行说明最低一级:人自己做,Agent 只是在旁边出主意。
- `COLLABORATOR = 2  # 协作者:Agent 起草,人改了再提交` 第二级,日常的「AI 写草稿,人点发送」就是这一级。
- `CONSULTANT = 3    # 顾问:Agent 主导,关键处先问人` 第三级,对应 Day 618 钱包里的 `ask_user`:做之前要先得到人的同意。
- `APPROVER = 4      # 审批者:Agent 先做,人在窗口期内能撤` 第四级,先执行,留一个撤销窗口(明天实现)。
- `OBSERVER = 5      # 观察者:全自动,人只看日志` 第五级。查询类动作基本都在这里。
- `MODE = {` 一个字典,把每一级翻译成一句界面上能显示的话。相当于 JS 里键是枚举值的 `Record<Level, string>`。
- `for lv in Level:` 枚举可以直接遍历,按定义顺序依次给出五个成员。
- `print(lv.value, lv.name, MODE[lv])` `lv.value` 是整数,`lv.name` 是成员名字符串;实跑第一行输出 `1 OPERATOR 只给建议`。
- `print(Level.CONSULTANT < Level.OBSERVER, int(Level.APPROVER))` 因为是 `IntEnum`,3 小于 5 成立,输出 `True`;`int(Level.APPROVER)` 输出 `4`。
- `print(Level(6))` 故意传一个不存在的数字,枚举会拒绝。这一行是为了让你看一次真实的报错。

</div>

```bash
uv run python -m part10.ux.levels
```

输出(最后一行是故意触发的报错,中间的 Traceback 我省略了):

```text
1 OPERATOR 只给建议
2 COLLABORATOR 起草,等人提交
3 CONSULTANT 执行前确认
4 APPROVER 先执行,留撤销窗口
5 OBSERVER 直接执行并记日志
True 4
ValueError: 6 is not a valid Level
```

注意运行方式是 `python -m part10.ux.levels`,不是 `python part10/ux/levels.py`。`-m` 表示「把它当成一个包里的模块来跑」,这样文件里 `from part10.ux...` 这种按包路径的导入才找得到。这个运行方式从 Day 135 起一直在用,在仓库根目录执行。

## 给每个动作定级:四个问题

定级靠四个问题,我每次都按这个顺序问:

- 做错了能不能撤回?(可逆性)
- 客户或者外部系统会不会看到?(外部可见性)
- 涉及多少钱?(金额)
- 一次影响几个客户?(影响范围)

拿 CloudLedger(虚构 SaaS 公司「云簿」)的几个动作来过一遍。查客户和查发票只读,什么也改不了,全自动。给工单打标签可以改回来,客户也看不到,同样全自动,只是要记日志。回复客户发出去就收不回,客户一定看得到,所以起步只能是「Agent 起草,客服点发送」。创建退款申请动的是钱,撤不回。批量通知一次碰几百个人。

### 第二步:写成代码,然后被测试打脸

下面是我第一次写的 `decide` 函数。它想表达两件事:一是回复这类「客户可见但可逆」的动作,信任高了可以升到第四级;二是大额和批量永远要问。

```python
# agent-zero-lab/part10/ux/actions.py(第一版,有 bug)
from dataclasses import dataclass

from part10.ux.levels import Level


@dataclass(frozen=True)
class Action:
    name: str
    reversible: bool       # 做错了能不能撤回
    external: bool         # 客户或外部系统会不会看到
    amount: float = 0.0    # 涉及金额(元)
    blast_radius: int = 1  # 一次影响几个客户


def decide(a: Action, trust: float = 0.0) -> Level:
    """trust:这个动作历史上「被人批准且没被撤销」的比例,0 到 1。"""
    if a.external and a.reversible and trust >= 0.95:
        return Level.APPROVER
    if a.amount >= 1000 or a.blast_radius > 10:
        return Level.CONSULTANT
    if not a.reversible:
        return Level.CONSULTANT if a.external or a.amount > 0 else Level.APPROVER
    if a.external:
        return Level.COLLABORATOR
    return Level.OBSERVER
```

<div class="line-notes">

- `@dataclass(frozen=True)` `dataclass` 让 Python 根据下面的字段自动生成构造函数,相当于 TS 里写好 `interface` 再配一个构造器。`frozen=True` 表示创建后不能改字段,相当于 `Readonly<...>`:一个动作的属性不该在运行中被悄悄改掉。
- `class Action:` 一个动作的描述:名字加上四个定级要用的事实。
- `reversible: bool       # 做错了能不能撤回` 字段名冒号后面是类型。没有等号的字段是必填。
- `amount: float = 0.0    # 涉及金额(元)` 有等号的是默认值,不传就是 0,所以只读动作不用写金额。
- `def decide(a: Action, trust: float = 0.0) -> Level:` 输入一个动作和一个信任值,输出一个级别。`trust` 默认 0,代表「还没有任何历史数据」。
- `if a.external and a.reversible and trust >= 0.95:` 我第一个想到的规则:对外可见、可逆、信任高,就升到第四级。我把它放在了最前面,这是错的,后面测试会告诉你为什么。
- `if a.amount >= 1000 or a.blast_radius > 10:` 大额或批量,问人。
- `if not a.reversible:` 撤不回的动作。这一行下面我写了一个三元表达式 `A if 条件 else B`,相当于 JS 的 `条件 ? A : B`:对外可见或涉及金额就问人,否则 `APPROVER`。
- `if a.external:` 到这里说明动作可逆,只要对外可见,在第二版之前一律 `COLLABORATOR`。
- `return Level.OBSERVER` 剩下的:可逆、对内,全自动。

</div>

再写测试。测试文件里每一行断言都对应上面那张分级表里的一行:

```python
# agent-zero-lab/part10/ux/test_actions.py
from part10.ux.actions import Action, decide
from part10.ux.levels import Level

LIST_INVOICES = Action("list_invoices", reversible=True, external=False)
TAG_TICKET = Action("tag_ticket", reversible=True, external=False)
SEND_REPLY = Action("send_reply", reversible=True, external=True)
REFUND = Action("create_refund_request", reversible=False, external=True, amount=98)
BIG_REFUND = Action("create_refund_request", reversible=False, external=True, amount=5000)
BULK_EMAIL = Action("bulk_notify", reversible=True, external=True, blast_radius=300)


def test_read_only_runs_itself():
    assert decide(LIST_INVOICES) == Level.OBSERVER
    assert decide(TAG_TICKET) == Level.OBSERVER


def test_reply_levels_up_with_trust():
    assert decide(SEND_REPLY, trust=0.80) == Level.COLLABORATOR
    assert decide(SEND_REPLY, trust=0.97) == Level.APPROVER


def test_money_always_asks():
    assert decide(REFUND) == Level.CONSULTANT
    assert decide(BIG_REFUND, trust=1.0) == Level.CONSULTANT


def test_bulk_always_asks():
    assert decide(BULK_EMAIL, trust=1.0) == Level.CONSULTANT


def test_irreversible_internal_still_asks():
    assert decide(Action("delete_ticket", reversible=False, external=False)) == Level.CONSULTANT
```

<div class="line-notes">

- `from part10.ux.actions import Action, decide` 测试和被测代码分开两个文件。`pytest` 相当于 jest/vitest,自动找文件名以 `test_` 开头的文件和函数。
- `LIST_INVOICES = Action("list_invoices", reversible=True, external=False)` 模块顶部先把几个动作造好,下面的测试直接用。参数写成 `reversible=True` 这种「关键字参数」,相当于 JS 里传一个对象的字段,读起来不会弄混哪个布尔值是哪个。
- `BIG_REFUND = Action("create_refund_request", reversible=False, external=True, amount=5000)` 5000 元的退款,后面断言它不管信任多高都要问。
- `BULK_EMAIL = Action("bulk_notify", reversible=True, external=True, blast_radius=300)` 一封邮件发给 300 个人。注意它是「可逆 + 对外可见」,和回复客户同一种形状,只有影响范围不同。
- `def test_read_only_runs_itself():` 以 `test_` 开头的函数就是一条测试。名字写成一句话,失败时一眼能看出哪条规则坏了。
- `assert decide(LIST_INVOICES) == Level.OBSERVER` `assert` 是 Python 的断言,相当于 `expect(...).toBe(...)`。不对就抛 `AssertionError`,pytest 把它标成失败。
- `assert decide(SEND_REPLY, trust=0.80) == Level.COLLABORATOR` 信任只有 0.8:起草,等人发。
- `assert decide(SEND_REPLY, trust=0.97) == Level.APPROVER` 信任到 0.97:先发出去,留撤销窗口。
- `assert decide(BIG_REFUND, trust=1.0) == Level.CONSULTANT` 把信任拉满到 1.0 也必须问人。这一条钉的是「大额不随信任放权」。
- `assert decide(BULK_EMAIL, trust=1.0) == Level.CONSULTANT` 批量同样。第一版就是死在这一条上。
- `def test_irreversible_internal_still_asks():` 这条是后面练习 1 之后补的,先放在这里,第一版代码跑它也会挂。

</div>

先跑第一版(这时文件里还没有最后那条 `test_irreversible_internal_still_asks`),运行:

```bash
uv run pytest part10/ux/test_actions.py -q
```

真实输出(只留关键几行):

```text
...F                                                                     [100%]
FAILED part10/ux/test_actions.py::test_bulk_always_asks - AssertionError: assert <Level.APPROVER: 4> == <Level.CONSULTANT: 3>
E        +  where <Level.APPROVER: 4> = decide(Action(name='bulk_notify', reversible=True, external=True, amount=0.0, blast_radius=300), trust=1.0)
1 failed, 3 passed in 0.21s
```

一条红,三条绿。红的那条讲的是:信任拉到 1.0 之后,给 300 个人群发邮件被判成了第四级,「先发出去再说」。原因就在我把信任规则放在了最前面,它先命中,后面的「批量永远要问」根本没机会执行。这个坑在写分级规则时特别容易踩:**规则的顺序就是优先级**,最硬的约束必须排在最前面,会随数据变化的「放权」只能放在最后。

注意绿的三条里有一条是 `BIG_REFUND` 那个 5000 元的退款,它之所以没挂,只是因为它不可逆,碰巧被第三条规则接住了,并不是因为金额规则先命中。这种「碰巧对」的测试,过一阵改了规则就会冒出来。

改法:把信任那条挪到最后,和 `external` 合并成一行。

```python
# agent-zero-lab/part10/ux/actions.py
from dataclasses import dataclass

from part10.ux.levels import Level


@dataclass(frozen=True)
class Action:
    name: str
    reversible: bool       # 做错了能不能撤回
    external: bool         # 客户或外部系统会不会看到
    amount: float = 0.0    # 涉及金额(元)
    blast_radius: int = 1  # 一次影响几个客户


def decide(a: Action, trust: float = 0.0) -> Level:
    """trust:这个动作历史上「被人批准且没被撤销」的比例,0 到 1。"""
    if a.amount >= 1000 or a.blast_radius > 10:
        return Level.CONSULTANT
    if not a.reversible:
        return Level.CONSULTANT  # 撤不回来的事,窗口期也救不了,只能先问
    if a.external:
        return Level.APPROVER if trust >= 0.95 else Level.COLLABORATOR
    return Level.OBSERVER
```

<div class="line-notes">

- `@dataclass(frozen=True)` 同第一版,没变。
- `if a.amount >= 1000 or a.blast_radius > 10:` 现在它是第一条。金额超过 1000 元或一次影响超过 10 人,不管别的字段是什么,先问人。
- `if not a.reversible:` 这一条我也改了,原因在下面「练习 1」里。现在不可逆的动作一律先问。
- `return Level.CONSULTANT  # 撤不回来的事,窗口期也救不了,只能先问` 第一版在这里还有一个分支会返回 `APPROVER`,也就是「先做再留撤销窗口」。对一个撤不回来的动作留撤销窗口是自相矛盾的。
- `if a.external:` 到这里动作一定是可逆的了。
- `return Level.APPROVER if trust >= 0.95 else Level.COLLABORATOR` 信任规则最后才出场:可逆、客户看得到的动作,历史上 95% 以上被原样采纳,才从「起草」升到「先发再撤」。
- `return Level.OBSERVER` 可逆、对内、小范围:全自动。实跑 `list_invoices`、`tag_ticket` 都落在这里。

</div>

```bash
uv run pytest part10/ux/test_actions.py -q
```

```text
....                                                                     [100%]
4 passed in 0.04s
```

(这是改完 `decide` 之后、还没加最后那条 `test_irreversible_internal_still_asks` 的结果;加上之后是 5 条,下面练习 1 里会跑到。)

最后把所有动作按两种信任值各跑一遍,打成一张表,给自己和 PM 看。

```python
# agent-zero-lab/part10/ux/table.py
from part10.ux.actions import Action, decide
from part10.ux.levels import MODE

ACTIONS = [
    Action("find_customer", reversible=True, external=False),
    Action("list_invoices", reversible=True, external=False),
    Action("tag_ticket", reversible=True, external=False),
    Action("send_reply", reversible=True, external=True),
    Action("create_refund_request(98 元)", reversible=False, external=True, amount=98),
    Action("create_refund_request(5000 元)", reversible=False, external=True, amount=5000),
    Action("bulk_notify(300 人)", reversible=True, external=True, blast_radius=300),
]

if __name__ == "__main__":
    print(f"{'动作':32}{'trust=0':22}{'trust=0.97'}")
    for a in ACTIONS:
        lo, hi = decide(a, 0.0), decide(a, 0.97)
        print(f"{a.name:32}{lo.name + ' ' + MODE[lo]:24}{hi.name}")
```

<div class="line-notes">

- `ACTIONS = [` 一个列表,每个元素是一个 `Action`。这里的七个动作是 CloudLedger MCP server 的四个工具加上客服场景里会有的三个动作。
- `Action("create_refund_request(98 元)", reversible=False, external=True, amount=98),` 同一个工具按金额拆成两行,因为金额会改变级别。名字里带上金额,只是为了表里好读。
- `if __name__ == "__main__":` 只有直接运行这个文件时才执行下面的代码,被 `import` 时不执行,相当于 Node 里的 `if (require.main === module)`。
- `print(f"{'动作':32}{'trust=0':22}{'trust=0.97'}")` f-string 里的 `:32` 是占 32 个字符宽。中文字符在终端里占两格,所以表头在你的终端上可能对不齐,不影响内容。
- `lo, hi = decide(a, 0.0), decide(a, 0.97)` 一行同时给两个变量赋值。分别是「没有历史数据」和「历史上 97% 被采纳」两种情况下的级别。
- `print(f"{a.name:32}{lo.name + ' ' + MODE[lo]:24}{hi.name}")` 打印名字、低信任下的级别加说明、高信任下的级别。

</div>

```bash
uv run python -m part10.ux.table
```

```text
动作                              trust=0               trust=0.97
find_customer                   OBSERVER 直接执行并记日志       OBSERVER
list_invoices                   OBSERVER 直接执行并记日志       OBSERVER
tag_ticket                      OBSERVER 直接执行并记日志       OBSERVER
send_reply                      COLLABORATOR 起草,等人提交    APPROVER
create_refund_request(98 元)     CONSULTANT 执行前确认        CONSULTANT
create_refund_request(5000 元)   CONSULTANT 执行前确认        CONSULTANT
bulk_notify(300 人)              CONSULTANT 执行前确认        CONSULTANT
```

看这张表,真正随信任变化的只有 `send_reply` 一行。这是故意的:**能放权的动作很少,值得放权的更少**。大部分动作要么本来就该全自动,要么永远不该自动。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="decide 函数的判断顺序">
  <rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="20" y="20" width="170" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="105" y="38" text-anchor="middle" fill="var(--ink)">金额 ≥ 1000 或</text>
    <text x="105" y="54" text-anchor="middle" fill="var(--ink)">影响 &gt; 10 人?</text>
    <rect x="260" y="20" width="150" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="335" y="46" text-anchor="middle" fill="var(--ink)">L3 先问人</text>
    <line x1="190" y1="42" x2="260" y2="42" stroke="var(--ink-soft)"/>
    <text x="225" y="36" text-anchor="middle" fill="var(--ink-soft)" font-size="11">是</text>

    <rect x="20" y="92" width="170" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="105" y="119" text-anchor="middle" fill="var(--ink)">撤不回来?</text>
    <rect x="260" y="92" width="150" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="335" y="118" text-anchor="middle" fill="var(--ink)">L3 先问人</text>
    <line x1="190" y1="114" x2="260" y2="114" stroke="var(--ink-soft)"/>
    <text x="225" y="108" text-anchor="middle" fill="var(--ink-soft)" font-size="11">是</text>

    <rect x="20" y="164" width="170" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
    <text x="105" y="191" text-anchor="middle" fill="var(--ink)">客户看得到?</text>
    <rect x="260" y="156" width="170" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="345" y="173" text-anchor="middle" fill="var(--ink)">信任≥0.95 → L4,否则 L2</text>
    <line x1="190" y1="176" x2="260" y2="169" stroke="var(--ink-soft)"/>
    <rect x="260" y="192" width="170" height="26" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="345" y="209" text-anchor="middle" fill="var(--ink)">否 → L5 全自动</text>
    <line x1="190" y1="196" x2="260" y2="205" stroke="var(--ink-soft)"/>

    <line x1="105" y1="64" x2="105" y2="92" stroke="var(--ink-soft)"/>
    <line x1="105" y1="136" x2="105" y2="164" stroke="var(--ink-soft)"/>
    <text x="115" y="82" fill="var(--ink-soft)" font-size="11">否</text>
    <text x="115" y="154" fill="var(--ink-soft)" font-size="11">否</text>
    <text x="20" y="246" fill="var(--ink-faint)" font-size="11">越往上越硬、越不随数据变;随信任变化的只有最后一层。</text>
  </g>
</svg>
<figcaption>第二版 decide 的判断顺序:前两层是硬规则,最后一层才吃信任值。第一版的 bug 就是把最后一层写到了最前面。</figcaption>
</figure>

## 透明度:给用户看什么

用户敢不敢用一个 Agent,前提是看得懂它在干什么。但透明度不等于把推理过程一股脑摊出来,一屏几千字的思考没有人会读。我的经验是给三样就够:

- **计划**:开工前几行字说明打算怎么做。长任务尤其要这样,用户在开头就能纠正方向,比做完返工便宜。
- **依据**:查了哪张表、查到几条、引用了哪张发票。做成可以点开的卡片。
- **把握程度**:模型不确定的地方,具体说出来。

前两样靠工程,第三样最容易做错。很多团队的第一反应是「让模型输出一个置信度分数」。我们用真实模型试一下这样做有没有用。

### 第三步:同一个问题,两种「把握程度」

场景:客服问「赵霞(客户编号 C002)2025 年一共付了我们多少钱」。数据库里 C002 最早的一张发票是 2026-08-13,2025 年没有任何记录,所以正确的回答是「没查到,没法给金额」。我让同一个模型在两种要求下各回答 5 次:A 版要求最后附一行 0 到 1 的置信度,B 版要求分【结论】【依据】【不确定的地方】三块,不确定的地方必须具体到「哪一步没数据」。

```python
# agent-zero-lab/part10/ux/card_demo.py
"""透明度对比:让 Agent 回答「赵霞 2025 年付了多少钱」。库里 C002 最早的发票是 2026-08-13,2025 年没有记录。
A 版要求给置信度数字;B 版要求给依据并说清哪里缺数据。全是 CloudLedger 的假数据。"""
import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any

from common.llm import LLMClient

DB = Path(__file__).resolve().parents[2] / "cloudledger/cloudledger.db"
TOOLS = [
    {"type": "function", "function": {"name": "list_invoices", "description": "按客户编号和年份列出发票",
     "parameters": {"type": "object", "properties": {"customer_id": {"type": "string"}, "year": {"type": "integer"}},
                    "required": ["customer_id", "year"]}}},
]


def list_invoices(customer_id: str, year: int) -> list[dict[str, Any]]:
    with sqlite3.connect(DB) as conn:
        rows = conn.execute("SELECT id, amount_cents, status, issued_at FROM invoices WHERE customer_id = ? AND substr(issued_at, 1, 4) = ?",
                            (customer_id, str(year))).fetchall()
    return [{"id": r[0], "amount_yuan": r[1] / 100, "status": r[2], "issued_at": r[3]} for r in rows]


STYLE_A = "回答后附一行「置信度:0 到 1 的数字」。"
STYLE_B = ("回答分三块:【结论】【依据】(查了什么、查到几条、引用发票号)【不确定的地方】"
           "(具体说哪一步没有数据或没法确认;没有就写「无」)。")
USER = "赵霞(客户编号 C002)2025 年一共付了我们多少钱?"


def ask(llm: LLMClient, style: str) -> tuple[str, int]:
    messages: list[dict[str, Any]] = [{"role": "system", "content": "你是客服助手,用工具查数据再回答。" + style},
                                      {"role": "user", "content": USER}]
    calls = 0
    for _ in range(5):
        r = llm.chat(messages, tools=TOOLS)
        messages.append(r.message)
        tcs = r.message.get("tool_calls") or []
        if not tcs:
            return r.content, calls
        for tc in tcs:
            calls += 1
            a = json.loads(tc["function"]["arguments"])
            messages.append({"role": "tool", "tool_call_id": tc["id"],
                             "content": json.dumps(list_invoices(a["customer_id"], a["year"]), ensure_ascii=False)})
    return "(超过轮数)", calls


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    llm = LLMClient()
    for name, style in (("A 置信度", STYLE_A), ("B 依据+不确定", STYLE_B)):
        said_no_data = 0
        confs: list[str] = []
        for i in range(n):
            text, calls = ask(llm, style)
            hit = bool(re.search(r"(没有|没查到|无|未查到).{0,12}(2025|发票|记录)", text))
            said_no_data += hit
            confs += re.findall(r"置信度[:：]\s*([01](?:\.\d+)?)", text)
            if i == 0:
                print(f"--- {name} 第 1 次(调了 {calls} 次工具)---\n{text}\n")
        print(f"{name}:{n} 次里有 {said_no_data} 次明确说了「没有 2025 年记录」,置信度数字:{confs or '无'}")
    print(llm.ledger)
```

<div class="line-notes">

- `"""透明度对比:让 Agent 回答` 文件开头的三引号字符串是模块的说明文字,相当于文件头的注释,运行时也能读到。
- `from common.llm import LLMClient` Day 135 起建的 `common/llm.py`,封装模型调用和花费统计。没有的话回到 Day 135 先建。
- `DB = Path(__file__).resolve().parents[2] / "cloudledger/cloudledger.db"` `__file__` 是当前文件的路径,`parents[2]` 往上数两层:`ux` 往上是 `part10`,再往上是仓库根 `agent-zero-lab`。所以这里指向仓库根下的假数据库。
- `TOOLS = [` 工具定义,格式是 Day 156 之后用的函数调用格式:名字、描述、参数的 JSON Schema。这里只有一个工具 `list_invoices`。
- `def list_invoices(customer_id: str, year: int) -> list[dict[str, Any]]:` 真正干活的函数。
- `rows = conn.execute("SELECT id, amount_cents, status, issued_at FROM invoices WHERE customer_id = ? AND substr(issued_at, 1, 4) = ?",` SQL 里的两个 `?` 是占位符,后面元组里的值按顺序填进去,不拼字符串,避免注入。`substr(issued_at, 1, 4)` 取日期的前四位,也就是年份。
- `return [{"id": r[0], "amount_yuan": r[1] / 100, "status": r[2], "issued_at": r[3]} for r in rows]` 列表推导式,相当于 JS 的 `rows.map(r => ({...}))`。金额在库里是分,这里除以 100 变成元。C002 查 2025 年,`rows` 是空列表,返回 `[]`。
- `STYLE_A = "回答后附一行「置信度:0 到 1 的数字」。"` A 版的要求。
- `STYLE_B = ("回答分三块:` B 版的要求,三块里最后一块「不确定的地方」逼模型把没数据的地方说出来。
- `USER = "赵霞(客户编号 C002)2025 年一共付了我们多少钱?"` 问题固定,两版只有系统提示词里的 style 不同。
- `def ask(llm: LLMClient, style: str) -> tuple[str, int]:` 跑一次完整的「模型想调工具、我们执行、结果回给模型」循环,返回最终回答和调了几次工具。
- `calls = 0` 计数器,调试时看模型到底查了几次。
- `for _ in range(5):` 最多五轮,防止模型一直调工具停不下来。`_` 是「这个变量我不用」的惯例写法。
- `r = llm.chat(messages, tools=TOOLS)` 一轮模型调用。
- `tcs = r.message.get("tool_calls") or []` 模型要调的工具列表;没有就是空列表,表示它给出了最终回答。
- `a = json.loads(tc["function"]["arguments"])` 模型给的工具参数是一个 JSON 字符串,这里解析成字典。
- `messages.append({"role": "tool", "tool_call_id": tc["id"],` 把工具结果以 `tool` 角色放回消息列表,`tool_call_id` 对上是哪一次调用。
- `hit = bool(re.search(r"(没有|没查到|无|未查到).{0,12}(2025|发票|记录)", text))` 用正则粗略判断回答里有没有明确说「没有记录」。粗,但够数一数。
- `confs += re.findall(r"置信度[:：]\s*([01](?:\.\d+)?)", text)` 把 A 版回答里的置信度数字抠出来,汉字冒号和英文冒号都认。
- `print(f"{name}:{n} 次里有 {said_no_data} 次明确说了「没有 2025 年记录」,置信度数字:{confs or '无'}")` 实跑 A 版输出的数字列表是 `['0.55', '0.35', '0.7', '0.6', '0.8']`,B 版没有数字所以打印 `无`。

</div>

```bash
uv run python -m part10.ux.card_demo 5
```

参数 `5` 是每版跑 5 次。一次真实运行的结果(每次运行模型的措辞都不同,数字也会变):

```text
A 置信度:5 次里有 5 次明确说了「没有 2025 年记录」,置信度数字:['0.55', '0.35', '0.7', '0.6', '0.8']
B 依据+不确定:5 次里有 5 次明确说了「没有 2025 年记录」,置信度数字:无
21 次调用 | 输入 8032 / 输出 2501 tokens | 约 ¥0.0280
```

先说一件反直觉的事:**两版 5 次全都答对了**,都说了没有记录。如果只看「对不对」,两版没有区别。差别在别处。

A 版五次的置信度是 0.55、0.35、0.7、0.6、0.8。情况完全相同、结论也相同,数字却从 0.35 摇到 0.8。用户拿到「0.6」不知道该怎么办:是 60% 可能对,还是模型自己也没数?我没有办法据此做任何决定,这个数字没有告诉他缺什么。

B 版第一次的回答是这样(节选):

```text
【结论】查不到赵霞(C002)2025 年的付款金额,因为系统里没有她的发票记录,所以我无法给出任何金额。
【依据】我调用了发票查询工具,参数是客户编号 C002、年份 2025,返回结果是空列表,0 条记录。
【不确定的地方】我查的是「发票」数据,没有查到记录,可能意味着她的发票开在下一年、由其他客户编号开票,或者根本没有开票记录。仅凭这个结果无法区分。
更重要的是,「发票金额」和「实付金额」并不等同,有没有付款要看收款记录,而这类数据我目前查不到。
```

最后一句是我自己没想到的:模型主动指出了「发票不等于付款」。用户看到这句会知道下一步该去查收款记录,这就是 A 版那个数字永远给不出的信息。具体的不确定,是可以行动的不确定。

### 第四步:依据由代码生成,不让模型转述

B 版有个隐患:「依据」那一块是模型自己写的,它可能把没查的说成查了,也可能转述错误。重要的依据不该靠模型转述,应该由代码从工具调用记录里直接生成。

```python
# agent-zero-lab/part10/ux/trace_card.py
"""「依据」这一栏由代码从工具记录里生成,不让模型自己描述它查了什么。"""
from dataclasses import dataclass, field
from typing import Any

from part10.ux.card_demo import list_invoices


@dataclass
class Step:
    tool: str
    args: dict[str, Any]
    rows: int


@dataclass
class Trace:
    plan: list[str]
    steps: list[Step] = field(default_factory=list)

    def call(self, customer_id: str, year: int) -> list[dict[str, Any]]:
        rows = list_invoices(customer_id, year)
        self.steps.append(Step("list_invoices", {"customer_id": customer_id, "year": year}, len(rows)))
        return rows

    def card(self) -> str:
        out = ["计划:"] + [f"  {i}. {p}" for i, p in enumerate(self.plan, 1)]
        out.append("依据(系统记录):")
        for s in self.steps:
            out.append(f"  {s.tool}({', '.join(f'{k}={v}' for k, v in s.args.items())}) -> {s.rows} 条")
        empty = [s for s in self.steps if s.rows == 0]
        if empty:
            out.append("需要你注意:")
            out += [f"  {s.args} 没有查到任何记录,下面的结论没有这部分数据支撑" for s in empty]
        return "\n".join(out)


if __name__ == "__main__":
    t = Trace(plan=["查 C002 在 2025 年的发票", "把已付款的金额加起来"])
    t.call("C002", 2025)
    t.call("C002", 2026)
    print(t.card())
```

<div class="line-notes">

- `from part10.ux.card_demo import list_invoices` 直接复用上一步写好的查询函数,不重写。
- `@dataclass` 这次不加 `frozen`,因为 `Trace` 要往里追加步骤,需要可变。
- `class Step:` 一次工具调用的记录:用了什么工具、什么参数、返回几行。
- `rows: int` 只记行数,不记内容。卡片上要的是「查到几条」,不是把整个结果再抄一遍。
- `steps: list[Step] = field(default_factory=list)` 给每个 `Trace` 对象各自一个新列表。如果直接写 `= []`,所有对象会共用同一个列表,dataclass 会直接报错拦住你。`field(default_factory=list)` 相当于 JS 里在构造函数里写 `this.steps = []`。
- `def call(self, customer_id: str, year: int) -> list[dict[str, Any]]:` 包装一层:调用真正的查询,顺手记一笔。以后 Agent 的每次工具调用都走这一层,记录就不会漏。
- `rows = list_invoices(customer_id, year)` 真正的查询。
- `self.steps.append(Step("list_invoices", {"customer_id": customer_id, "year": year}, len(rows)))` 记录这一步。查 C002 的 2025 年,`len(rows)` 是 0。
- `def card(self) -> str:` 把记录渲染成给用户看的卡片文字。
- `out = ["计划:"] + [f"  {i}. {p}" for i, p in enumerate(self.plan, 1)]` `enumerate(列表, 1)` 给每个元素配上从 1 开始的序号,相当于 JS 里 `plan.map((p, i) => ...)` 的 `i + 1`。
- `out.append("依据(系统记录):")` 这一栏的内容全部来自 `self.steps`,没有一个字是模型写的。
- `empty = [s for s in self.steps if s.rows == 0]` 找出所有「查了但没有结果」的步骤。
- `out += [f"  {s.args} 没有查到任何记录,下面的结论没有这部分数据支撑" for s in empty]` 把它们单独列在「需要你注意」下面。这一块也是代码生成的,不依赖模型愿不愿意坦白。
- `t = Trace(plan=["查 C002 在 2025 年的发票", "把已付款的金额加起来"])` 演示:先写好计划。
- `t.call("C002", 2025)` 查 2025 年,返回空。
- `t.call("C002", 2026)` 查 2026 年,返回 3 条。

</div>

```bash
uv run python -m part10.ux.trace_card
```

```text
计划:
  1. 查 C002 在 2025 年的发票
  2. 把已付款的金额加起来
依据(系统记录):
  list_invoices(customer_id=C002, year=2025) -> 0 条
  list_invoices(customer_id=C002, year=2026) -> 3 条
需要你注意:
  {'customer_id': 'C002', 'year': 2025} 没有查到任何记录,下面的结论没有这部分数据支撑
```

这样分工之后,模型负责「结论」和「它觉得哪里可能有问题」,代码负责「真的查了什么、真的查到什么」。两边对不上的时候,以代码那一栏为准。

## 动手练习

**练习 1:先猜再跑。** 把三个新动作加进分级表:`delete_ticket`(删除工单,不可逆、客户看不到)、`export_customer_data`(导出 500 个客户的数据,可逆、对外可见)、`update_customer_email`(改客户邮箱,可逆、客户看不到)。**先在纸上写出你认为的级别**,再写代码跑出来对比。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ux/ex619_levels.py
from part10.ux.actions import Action, decide
from part10.ux.levels import Level

NEW = {
    "delete_ticket": Action("delete_ticket", reversible=False, external=False),
    "export_customer_data": Action("export_customer_data", reversible=True, external=True, blast_radius=500),
    "update_customer_email": Action("update_customer_email", reversible=True, external=False),
}
GUESS = {"delete_ticket": Level.APPROVER, "export_customer_data": Level.CONSULTANT, "update_customer_email": Level.OBSERVER}

if __name__ == "__main__":
    for name, a in NEW.items():
        got = decide(a)
        print(f"{name:24} 我猜 {GUESS[name].name:10} 代码给 {got.name:10} {'一致' if got == GUESS[name] else '不一致'}")
```

<div class="line-notes">

- `from part10.ux.actions import Action, decide` 复用今天写的分级函数。
- `"delete_ticket": Action("delete_ticket", reversible=False, external=False),` 不可逆、对内。这是个有意挑的难题:它既没有金额也不对外,看起来「不严重」。
- `"export_customer_data": Action("export_customer_data", reversible=True, external=True, blast_radius=500),` 影响范围 500,超过 10。
- `GUESS = {"delete_ticket": Level.APPROVER,` 这是我动手前凭感觉写下的猜测:删除工单对内、没钱,「先删再留撤销窗口」应该行。
- `got = decide(a)` 把猜测和代码结果对比。
- `print(f"{name:24} 我猜 {GUESS[name].name:10} 代码给 {got.name:10} {'一致' if got == GUESS[name] else '不一致'}")` 三元表达式决定打印「一致」还是「不一致」。

</div>

我第一次写这道练习时,`decide` 还是第一版里「不可逆且不对外、没金额就 `APPROVER`」那个分支,跑出来是:

```text
delete_ticket            我猜 APPROVER   代码给 APPROVER   一致
export_customer_data     我猜 CONSULTANT 代码给 CONSULTANT 一致
update_customer_email    我猜 OBSERVER   代码给 OBSERVER   一致
```

三个全部「一致」,我差点就过去了。停下来想了一下才发现不对:`APPROVER` 的意思是「先执行,留一个撤销窗口」,而删除工单是不可逆的,没有任何窗口能把它救回来。猜和代码一起错了,而且错得很一致。这就是为什么今天正文里的 `decide` 把那个分支改成了「不可逆一律 `CONSULTANT`」,同时补了那条 `test_irreversible_internal_still_asks`。改完再跑:

```text
delete_ticket            我猜 APPROVER   代码给 CONSULTANT 不一致
export_customer_data     我猜 CONSULTANT 代码给 CONSULTANT 一致
update_customer_email    我猜 OBSERVER   代码给 OBSERVER   一致
```

「不一致」那一行才是对的。这里真正的教训:**用代码把规则写下来,并不能保证规则是对的,它只保证规则被一致地执行**。猜测、代码、测试三者是互相校对的关系,只有一个人写的时候,最好换个时间再看一遍。

现实里的做法是把 `delete_ticket` 改造成软删除(只打一个「已删除」标记,保留 30 天),这样它就变成可逆动作,可以放进撤销窗口。这就是明天要讲的「把动作改造得更可逆」。

```bash
uv run pytest part10/ux/test_actions.py -q
```

加上 `test_irreversible_internal_still_asks` 之后是 `5 passed in 0.02s`。

</details>

**练习 2:把 Day 618 的三种判决放进五级。** `wallet_box.py` 里的 `Verdict` 有 `approve`、`ask_user`、`deny` 三种。写一个函数 `level_of(v: Verdict) -> Level | None`,说清哪个判决对应哪一级,有没有放不进五级的。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ux/ex619_verdict.py
"""Day 618 钱包的三种判决,对应到今天的五级里是哪几级?"""
from part10.mandate.wallet_box import Verdict  # 这是 Day 618 建的文件
from part10.ux.levels import Level


def level_of(v: Verdict) -> Level | None:
    if v is Verdict.APPROVE:
        return Level.OBSERVER      # 框内:直接做
    if v is Verdict.ASK_USER:
        return Level.CONSULTANT    # 执行前确认
    return None                    # DENY:不在五级里,是「这件事不让做」


if __name__ == "__main__":
    for v in Verdict:
        lv = level_of(v)
        print(v.value, "->", lv.name if lv else "不在五级里")
```

<div class="line-notes">

- `from part10.mandate.wallet_box import Verdict  # 这是 Day 618 建的文件` 用到前面某天建的文件时写清楚是哪天的:这个 `wallet_box.py` 在 Day 618 的 `part10/mandate/` 下。
- `def level_of(v: Verdict) -> Level | None:` 返回类型写成 `Level | None`,相当于 TS 的 `Level | null`:有些判决没有对应的级别。
- `if v is Verdict.APPROVE:` 枚举成员用 `is` 比较身份,比 `==` 更明确。
- `return Level.OBSERVER      # 框内:直接做` 钱包放行,就是「全自动,事后看日志」。
- `return Level.CONSULTANT    # 执行前确认` `ask_user` 就是第三级:做之前先问。
- `return None                    # DENY:不在五级里,是「这件事不让做」` `deny` 放不进去。五级描述的是「人和 Agent 怎么分工」,`deny` 是「这件事根本不在授权范围内」,是规则层面的禁止,不是分工。
- `lv = level_of(v)` 遍历枚举里的三个判决各问一次。
- `print(v.value, "->", lv.name if lv else "不在五级里")` 有级别就打级别名,没有就打「不在五级里」。

</div>

```bash
uv run python -m part10.ux.ex619_verdict
```

```text
approve -> OBSERVER
ask_user -> CONSULTANT
deny -> 不在五级里
```

这个映射说明了一件事:五级是「允许做」的动作内部怎么分工;`deny` 在五级之外,是授权框划出来的边界。所以一个完整的 Agent 权限设计是两层:先看这件事在不在授权框里(框外直接拒绝),再看框内的动作在第几级。

</details>

**练习 3:让「依据」栏会提醒没查过的年份。** 用户问的是「2024 到 2026 三年」,`Trace` 只记录了实际查过的。写一个 `uncovered(t, years)`,返回「没查过」或「查了但 0 条」的年份。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ux/ex619_trace.py
"""练习 3:用户问的是「2024 到 2026 三年」,代码检查每一年有没有真的查过、查到没有。"""
from part10.ux.trace_card import Trace


def uncovered(t: Trace, years: range) -> dict[int, str]:
    queried = {s.args["year"]: s.rows for s in t.steps}
    out: dict[int, str] = {}
    for y in years:
        if y not in queried:
            out[y] = "没查过"
        elif queried[y] == 0:
            out[y] = "查了但 0 条"
    return out


if __name__ == "__main__":
    t = Trace(plan=["查 2024 到 2026 的发票"])
    t.call("C002", 2025)
    t.call("C002", 2026)
    print(uncovered(t, range(2024, 2027)))
    t2 = Trace(plan=["查 2024 到 2026 的发票"])
    for y in (2024, 2025, 2026):
        t2.call("C005", y)
    print(uncovered(t2, range(2024, 2027)))
```

<div class="line-notes">

- `from part10.ux.trace_card import Trace` 今天第四步写的类。
- `def uncovered(t: Trace, years: range) -> dict[int, str]:` `range(2024, 2027)` 是 2024、2025、2026 三个年份,不含末尾的 2027。相当于 JS 里 `[2024, 2025, 2026]`。
- `queried = {s.args["year"]: s.rows for s in t.steps}` 字典推导式,把每次查询整理成「年份到行数」。
- `if y not in queried:` 年份根本没出现在记录里:模型压根没查。
- `out[y] = "没查过"` 这是最危险的一种,模型可能把「没查」当成「没有」。
- `elif queried[y] == 0:` 查了,返回 0 条。
- `t = Trace(plan=["查 2024 到 2026 的发票"])` 第一个例子:只查了 2025 和 2026。
- `for y in (2024, 2025, 2026):` 第二个例子:三年全查,C005 的三年都有发票。

</div>

```bash
uv run python -m part10.ux.ex619_trace
```

```text
{2024: '没查过', 2025: '查了但 0 条'}
{}
```

第一行:2024 年模型根本没查,2025 年查了但 C002 没有发票。第二行 C005 三年都查了且都有数据,所以返回空字典。「没查过」和「查了但 0 条」要分开,因为它们对用户的含义完全不同:前者是 Agent 的疏漏,后者是数据本来就没有。

</details>

**验收标准:**`uv run pytest part10/ux/test_actions.py -q` 全绿;练习 1 先写下了猜测再跑代码;你能说出为什么「置信度 0.6」没法让用户采取任何行动,而「发票不等于付款」可以。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 自主程度(level of autonomy) | Agent 做一件事时,不需要人参与就能自己推进的程度。今天按五级描述:操作者、协作者、顾问、审批者、观察者 |
| 动作分级 | 给 Agent 的每一个动作单独定自主级别,而不是给整个 Agent 定一个级别 |
| 可逆性 | 一个动作做错之后能不能撤回。发出去的邮件不可逆,打错的标签可逆 |
| 影响范围(blast radius) | 一次动作波及多少个客户或系统,批量操作的范围大 |
| 透明度 | 让用户看得懂 Agent 在做什么:计划、依据、把握程度 |
| 置信度 | 模型自己报的 0 到 1 的把握分数。今天的实验里它在同一情况下从 0.35 摇到 0.8 |
| 软删除 | 删除时只打一个标记、不真正删数据,所以可以恢复 |
| enum / IntEnum | Python 里表示一组固定选项的类型,类似 TS 的 `enum`;`IntEnum` 的成员可以比大小 |
| dataclass | 根据字段自动生成构造函数的类,相当于 TS 里 `interface` 加构造器 |
| frozen dataclass | 创建后不能修改字段的 dataclass,相当于 `Readonly<T>` |

## 常见误区

**问「我们的 Agent 是第几级」。** 同一个产品里,查账单可以第五级,退款应该第三级,按动作定级才有意义。

**以为提高自主程度只能靠换更强的模型。** 很多动作的级别取决于它能不能撤回,而不是模型聪不聪明。把动作改造得更可逆(软删除、延迟发送、先预览),往往比优化模型便宜得多。

**把会随数据变化的规则放在最前面。** 今天第一版就是这么挂的:信任规则排第一,批量发邮件在信任 1.0 的时候被放行。分级规则里,硬约束(金额、批量、不可逆)排前面,「放权」排最后。

**让模型报一个置信度当透明度。** 实测同样的情况,数字在 0.35 到 0.8 之间乱跳,而且数字本身不告诉用户缺什么。要让模型说具体:哪一步没数据、为什么这会影响结论。

**让模型自己转述「我查了什么」。** 查了什么、查到几条这种事实性的依据,从工具调用记录里由代码生成,模型只写它的判断。

**测试和代码是同一个人同一时间写的就放心了。** 练习 1 里猜测和代码一致地错了。重要的规则表,换个时间、换个人再过一遍。

## 学习资料

### 文档与文章

- [Levels of Autonomy for AI Agents(arXiv 2506.12469)](https://arxiv.org/abs/2506.12469):五级自主程度的原文,先读摘要和各级的定义,40 分钟。
- [Google PAIR:People + AI Guidebook](https://pair.withgoogle.com/guidebook/):Google 的人与 AI 交互设计指南,看讲解释和信任、反馈和控制的两章,1 小时。
- 微软 Guidelines for Human-AI Interaction(Amershi 等,CHI 2019):18 条人机交互指南,按标题搜索就能找到微软研究院的项目页(微软站点对脚本访问返回 403,需用浏览器打开)。
- [Shape of AI](https://www.shapeof.ai/):AI 产品交互模式图鉴,看别人怎么设计预览、确认、撤销,30 分钟。
- [Anthropic:Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):回头再读,留意它讨论「什么时候需要人参与」的部分,20 分钟。

### B 站视频

已在正文嵌入 Web3天空之城《大神Andrej Karpathy最新演讲:AI时代的软件》。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Qf3V-oPfE8E" title="Designing AI-Native Product Experiences: The Autonomy Dial Framework" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Databricks Events · Designing AI-Native Product Experiences: The Autonomy Dial Framework · 讲怎么在产品里设计一个「自主程度旋钮」,可以和今天的五级对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LCEmiRjPEtQ" title="Andrej Karpathy: Software Is Changing (Again)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Y Combinator · Andrej Karpathy: Software Is Changing (Again) · 英文原版演讲,和上面的中文字幕版二选一。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 10 章后半部分讲用户反馈的设计和收集,和明天要用的「采纳率、修改率」直接相关。英文原版。
- Ben Shneiderman《Human-Centered AI》(Oxford University Press, 2022):书里的二维框架主张「高人类控制」和「高自动化」可以同时存在,正好反驳「自主程度越高越好」这种直觉。英文原版。
- Louise Macfadyen《Designing AI Interfaces》(O'Reilly, 2026):按出版社介绍,讲 AI 交互的设计模式,包括可中断性、自主与控制的平衡。我只看到了出版社的简介,没读正文。英文原版。

### 开源项目与代码

- [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research):这个仓库已在 GitHub 归档,但里面 `clarify_with_user` 这个节点怎么在开工前向用户确认范围,仍然是「先展示计划」的一个具体写法。
- [Claude Code 的权限文档](https://docs.anthropic.com/en/docs/claude-code/iam):一个真实产品怎么把动作分成「读文件自动做、改文件要确认、跑命令要确认」几档。

## 自测

**1. 为什么说「我们的 Agent 是第几级」这个问法有问题?**

<details><summary>答案</summary>

因为自主程度属于动作,不属于整个 Agent。同一个产品里,查账单可以全自动(第五级),回复客户先起草(第二级),退款先问人(第三级)。给整个产品定一个级别,要么把风险高的动作放得太开,要么把没风险的动作管得太死。

</details>

**2. 给动作定级要问哪四个问题?规则的顺序为什么重要?**

<details><summary>答案</summary>

能不能撤回、客户或外部看不看得到、涉及多少钱、一次影响几个人。规则按顺序匹配,先命中的先生效,所以最硬的约束(大额、批量、不可逆)要排在最前面,会随历史数据变的「放权」规则只能放最后。今天第一版把信任规则放最前,信任调到 1.0 时批量群发邮件就被放行了。

</details>

**3. 同一个情况下,模型三次给的置信度分别是 0.35、0.6、0.8,这种数字作为「透明度」有什么问题?什么做法更好?**

<details><summary>答案</summary>

数字不稳定,而且不告诉用户缺什么,没法据此采取行动。更好的做法是要求模型说具体的不确定:哪一步没有数据、这对结论有什么影响;同时「查了什么、查到几条」这类事实由代码从工具记录里生成,不让模型转述。

</details>

**4. `delete_ticket`(不可逆、对内、没金额)该定在第几级?为什么「先做再留撤销窗口」不适用?**

<details><summary>答案</summary>

第三级,做之前先问。撤销窗口的前提是动作能被撤回,不可逆的动作窗口救不了。更好的办法是把它改造成软删除,变成可逆动作之后才能考虑放进窗口。

</details>

**5. 为什么 `deny` 放不进五级?**

<details><summary>答案</summary>

五级描述的是被允许的动作里人和 Agent 怎么分工;`deny` 表示这件事根本不在授权范围内,是规则层的禁止。完整的权限设计是两层:先看在不在授权框里,框外拒绝;框内再看第几级。

</details>

**6. 面试题:客服负责人说「这个 Agent 我不放心,不想用」。你是负责这个 Agent 的资深工程师,怎么推进?**

<details><summary>答案</summary>

先问清「不放心」具体指什么:怕发错东西、怕看不懂它在干什么,还是怕出事没人担责。然后带一张动作表去开会:列出每个动作的可逆性、客户可见性、金额和影响范围,建议级别,让他逐行确认。风险高的动作(退款、批量)一律执行前确认;低风险的只读动作才全自动;回复客户从「起草、客服点发送」开始。界面上展示计划、依据(由代码从工具记录生成)和具体的不确定点。同时埋采纳率、修改率、撤销率这些指标,约定放权规则,比如某类工单连续几周原样发送率达标才开放。让「放权」变成基于数据的共同决定,而不是工程师单方面推动。

</details>

## 明天预告

[Day 620](/blog/agent-zero/day-620-agent-ux-2/) 接着讲 Agent 产品(二):可撤销、出错体验、逐步放权、和 PM 协作。今天表里 `send_reply` 能在信任高的时候升到第四级,前提是真的有一个撤销窗口,而且这个「信任」是用数据算出来的。明天就把这两样做出来:一个能撤回、会被测试逮住 bug 的撤销窗口,和一个根据样本量决定升不升级的放权梯子。
