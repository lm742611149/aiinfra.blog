---
title: 'Day 622 · 第 89 周复习:进阶(Day 616–621)'
description: '这一周讲了 Agent 互联、Agent 支付、Agent 产品交互和生成式 UI。今天不学新东西:一张知识地图把六天串成「谁能做什么」一条线,默写钱包授权框和放权梯子两段代码,用随机检查脚本证明默写对了,再把本周零件拼成一个退款加回复的动作闸门,用五条不变量跑两千轮随机操作,顺带抓到我自己写的闸门里三处 bug。'
pubDate: 2026-10-27
regime: none
tags: ['review', 'agent-payments', 'agent-ux', 'a2a', 'python', 'agent-zero']
series: 'agent-zero'
day: 622
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 621](/blog/agent-zero/day-621-generative-ui/) 给退款审批做了一张能点的卡片:MCP Apps、A2UI、AG-UI 三条路线各管哪一层;卡片的服务端只收「申请编号和决定」,金额按编号重新查库,980 元那一笔被服务端拒绝,按钮亮着也没用;界面放在沙箱 iframe 里,CSP 声明少一个域名,脚本就加载不了。

这一周的六天一开始像四个话题:Agent 之间怎么互相调用、Agent 怎么花钱、Agent 产品该给多大自主权、界面怎么长出来。今天把它们串成一条线,默写两段最容易写错的代码,再做一个把本周零件全用上的小项目。

## 今天要解决的问题

复习日不加新概念。今天结束时你应该能:

1. 不看文章画出本周知识地图,说出每一天在「谁能做什么」这条线上守的是哪一道门。
2. 默写 [Day 618](/blog/agent-zero/day-618-payments-2/) 钱包授权框的 `Wallet.decide` 和 [Day 620](/blog/agent-zero/day-620-agent-ux-2/) 放权梯子的 `wilson_lower` 加 `Ladder.week`,并用检查脚本证明默写版和原版在上万笔随机输入上结果一致。
3. 跑通本周小项目 `part10/review89/refund_gate.py`:退款先过钱包规则再问人,回复客户按放权梯子决定先问还是先发,结果都用任务状态表示;再用五条不变量跑两千轮随机操作,说清每条不变量守的是哪一天的规矩。
4. 说出本周最容易犯的几个错。

预计用时 3.5 到 4 小时,大头在默写和小项目。**今天全程不调模型、不花钱**,所有数据是假发票、假客户、假钱包,没有网络。前置:[Day 616](/blog/agent-zero/day-616-a2a-2/) 到 [Day 621](/blog/agent-zero/day-621-generative-ui/) 全部,尤其是 Day 618 的 `wallet_box.py`、Day 619 的 `levels.py` 和 `actions.py`、Day 620 的 `trust.py` 和 `undo.py`,今天直接 import 它们。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 89 周知识地图:一个 Agent 要做一件事,先过 616 的身份门,再过 617 和 618 的钱门,再按 619 和 620 的级别门决定谁来点头,最后用 621 的界面交给人批;每一层的结果都用 614 的任务状态表示">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
  <text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">第 89 周:一个动作要过几道门,才能真的做出去</text>
  <rect x="20" y="40" width="130" height="110" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="85" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">身份门</text>
  <text x="30" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">616 名片和 Bearer</text>
  <text x="30" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">616 按调用方隔离</text>
  <text x="30" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">616 替谁办事要校验</text>
  <rect x="165" y="40" width="150" height="110" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="240" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">钱门</text>
  <text x="175" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">617 402 往返、nonce</text>
  <text x="175" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">618 mandate 授权凭证</text>
  <text x="175" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">618 授权框 先拒绝后问人</text>
  <rect x="330" y="40" width="150" height="110" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="405" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">级别门</text>
  <text x="340" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">619 按动作定五级</text>
  <text x="340" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">620 撤销窗口</text>
  <text x="340" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">620 看下界才放权</text>
  <rect x="495" y="40" width="125" height="110" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="557" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">人的门</text>
  <text x="505" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">621 审批卡片</text>
  <text x="505" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">621 金额查库</text>
  <text x="505" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">621 沙箱和 CSP</text>
  <line x1="150" y1="95" x2="165" y2="95" stroke="var(--ink-soft)" stroke-width="1.5"/>
  <line x1="315" y1="95" x2="330" y2="95" stroke="var(--ink-soft)" stroke-width="1.5"/>
  <line x1="480" y1="95" x2="495" y2="95" stroke="var(--ink-soft)" stroke-width="1.5"/>
  <rect x="20" y="180" width="600" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="320" y="202" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">每一道门的结果:任务状态(614)</text>
  <text x="320" y="222" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">rejected(门外)/ input-required(等人)/ working(窗口期)/ completed / canceled</text>
  <rect x="20" y="256" width="600" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="320" y="278" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">今天的小项目 refund_gate.py:把后三道门接到一个对象上</text>
  <text x="320" y="298" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">钱包规则 → 分级 → 放权梯子和撤销窗口 → 人批准 → 任务状态</text>
</svg>
<figcaption>本周知识地图。一个动作要做出去,先证明你是谁(616),再证明这笔钱能花(617、618),再按动作定级决定谁点头(619、620),最后把要人点头的事用界面摆清楚(621)。每一层的结果都落在同一套任务状态上。</figcaption>
</figure>

打个具体的比方。客户在对话里说「上个月 INV-0043 那笔 980 元扣错了,帮我退了」。Agent 先要知道这句话是谁说的、替谁办事(616 的身份,confused deputy 就是在这里出的事);退款要打钱,这笔钱在不在授权范围里、是不是重复请求(617、618);退款撤不回来,所以按 619 的规矩一定先问人,而且 980 元超过了卡片审批人的上限;主管看到的是 621 那张只收「编号加决定」的卡片;如果换成「给客户发一封确认邮件」,它是撤得回的,那就走 620 的路:先发,留 30 秒撤销窗口,而且这个动作什么时候能从「先问」升到「先发」,要看原样发送率的置信区间下界。

## 本周每天一句话

- [Day 616](/blog/agent-zero/day-616-a2a-2/) · Agent 互联(二):用 `a2a-sdk` 把对账 Agent 做成真服务,Agent Card、Task、Message、Artifact、Part 五个对象在线上长什么样;JSON-RPC 和 REST 两种绑定;Bearer 鉴权要抛异常而不是 `return None`;身份对、数据错的 confused deputy;名片签名只证明没被改,公钥从哪来才是信任的根。
- [Day 617](/blog/agent-zero/day-617-payments-1/) · Agent 支付(一):授权、结账、结算三层;x402 的 402 往返用 `PAYMENT-REQUIRED`、`PAYMENT-SIGNATURE`、`PAYMENT-RESPONSE` 三个头;重放被 nonce 挡住,改金额和改收款人被要价匹配挡住;协议验签名,不验这笔钱该不该花。
- [Day 618](/blog/agent-zero/day-618-payments-2/) · Agent 支付(二):AP2 的 mandate 证明「这是用户让买的」,签名对不等于决定是用户的;商品描述里一句假话把模型带到贵货上;钱包授权框用确定性的代码分 `deny`、`ask_user`、`approve` 三档,硬规则在前、软规则在后。
- [Day 619](/blog/agent-zero/day-619-agent-ux-1/) · Agent 产品(一):自主程度分五级,但定级的对象是动作不是 Agent;四个问题(撤不撤得回、客户看不看得到、多少钱、影响几个人)写成 `decide()`,硬约束排前面、信任排最后;透明度给依据和具体的不确定,不给一个乱跳的置信度数字。
- [Day 620](/blog/agent-zero/day-620-agent-ux-2/) · Agent 产品(二):撤销窗口要真的把动作从队列里拿掉,时钟从外面传进来才好测;出错提示说清已完成什么、没完成什么、下一步;放权看 Wilson 下界不看裸比例,真实 85% 的类别裸比例每 4 个里就有 1 个被误升级;降级也看下界。
- [Day 621](/blog/agent-zero/day-621-generative-ui/) · 生成式 UI:MCP Apps 管 server 写好的页面,A2UI 管声明式的组件树,AG-UI 管事件传输,三者常常叠着用;沙箱、CSP、工具可见性挡不住服务端授权、界面注入和显示数据与写库数据不一致。

六句话底下是同一个结构:**每一道门都是程序里写死的规则,不是模型的判断。** 身份靠校验,钱靠授权框,级别靠 `decide()`,放权靠置信区间,审批卡片的金额靠重新查库。模型被带偏的概率不是零(618 那 23 次里有 6 次买了贵货),所以门不能让模型来开。

## 准备环境

今天的文件放在 `agent-zero-lab/part10/review89/`,只用标准库和本周写好的模块,不需要 `uv add` 新东西(`pytest` 是 Day 619 起就在用的开发依赖)。

```bash
cd agent-zero-lab        # 换成你自己的练习仓库路径,仓库根目录
mkdir -p part10/review89 && touch part10/review89/__init__.py
ls part10/mandate/wallet_box.py part10/ux/levels.py part10/ux/actions.py part10/ux/trust.py part10/ux/undo.py
```

```text
part10/mandate/wallet_box.py
part10/ux/levels.py
part10/ux/actions.py
part10/ux/trust.py
part10/ux/undo.py
```

`wallet_box.py` 是 Day 618 建的,`levels.py` 和 `actions.py` 是 Day 619 建的(`actions.py` 要是改过「硬约束排前、信任排最后」的第二版),`trust.py` 和 `undo.py` 是 Day 620 建的。哪个没有,回到那一天敲出来再继续,今天的检查脚本要把它们当「标准答案」。A2A 和 x402 那几天的脚本今天不重跑:它们要装 SDK、起本地服务,和复习要练的「规则」关系不大,真要复习就回去重跑 Day 616 和 617 的输出。

## 默写一:钱包授权框的 `Wallet.decide()`

先合上 Day 618,新建 `part10/review89/recall_wallet.py`。`Verdict`、`Box`、`Spend` 和 `commit` 直接从原文件导入,只默写 `decide` 里那八条规则和它们的顺序。下面是我默写的版本,你默写完再对照:

```python
# agent-zero-lab/part10/review89/recall_wallet.py
"""默写一:Day 618 的 Wallet.decide()。Verdict、Box、Spend 和 commit 直接从原文件导入,只默写 decide 的八条规则。"""
import time

from part10.mandate.wallet_box import Spend, Verdict, Wallet


class RecallWallet(Wallet):
    def decide(self, s: Spend, now: float | None = None) -> tuple[Verdict, str]:
        now = time.time() if now is None else now
        b = self.box
        if now > b.expires_at:
            return Verdict.DENY, "授权框已过期"
        if s.currency != b.currency:
            return Verdict.DENY, f"币种 {s.currency} 不在授权里"
        if s.payee not in b.payees:
            return Verdict.DENY, f"收款方 {s.payee} 不在授权名单里"
        if s.tx_id in self.seen_tx:
            return Verdict.DENY, f"交易号 {s.tx_id} 已经付过"
        if s.amount > b.per_payment_max:
            return Verdict.DENY, f"{s.amount} 美分超过单笔上限 {b.per_payment_max}"
        if self.spent + s.amount > b.budget:
            return Verdict.DENY, f"已花 {self.spent},再付 {s.amount} 会超过总预算 {b.budget}"
        if not any(s.item.startswith(p) for p in b.items):
            return Verdict.ASK_USER, f"{s.item} 不是用户确认过的东西"
        if s.amount > b.ask_above:
            return Verdict.ASK_USER, f"{s.amount} 美分超过自动放行线 {b.ask_above}"
        return Verdict.APPROVE, "在授权框内"
```

<div class="line-notes">

- `from part10.mandate.wallet_box import Spend, Verdict, Wallet` 三个类直接借原版的。`Box` 这里用不上,因为 `Wallet` 里已经带了一个 `self.box`。
- `class RecallWallet(Wallet):` 继承原版,只覆盖 `decide`。`seen_tx`、`spent`、`commit` 都沿用,这样比较的只有规则本身。
- `now = time.time() if now is None else now` 允许从外面传「现在」,测试才能验证「过期」。默写时容易忘记这个参数,直接写 `time.time()`,检查脚本传 `now=` 就会报错。
- `if now > b.expires_at:` 第一条:过期。便宜、硬,放最前面。
- `if s.currency != b.currency:` 第二条:币种。默写时我一开始把币种忘了,后来看检查脚本里 EUR 那一档才想起来。
- `if s.payee not in b.payees:` 第三条:收款方必须在名单里。
- `if s.tx_id in self.seen_tx:` 第四条:交易号见过就拒绝。注意它查的是 `seen_tx`,只有 `commit` 过才会进去,所以「判决过但没付」的不算。
- `if s.amount > b.per_payment_max:` 第五条:超过单笔上限。
- `if self.spent + s.amount > b.budget:` 第六条:已花加这一笔超过总预算。这里是 `>` 不是 `>=`,刚好花光不算超。
- `if not any(s.item.startswith(p) for p in b.items):` **从这里开始是软规则**,返回的是 `ASK_USER` 不是 `DENY`。我把循环变量叫 `p`,原版叫 `i`,不影响结果。
- `if s.amount > b.ask_above:` 第八条:框内但金额超过自动放行线,也要问。
- `return Verdict.APPROVE, "在授权框内"` 八条都过,才批准。

</div>

检查脚本随机生成 3000 个授权框,每个框下面 1 到 8 笔花费,收款方、金额、商品、交易号、币种都随机,框本身有一半是已过期的。每一笔同时交给原版和默写版,批准了的两边一起 `commit`,这样「交易号重复」和「预算用完」这两条有状态的规则也能测到:

```python
# agent-zero-lab/part10/review89/check_wallet.py
"""随机生成 3000 个授权框、每个框下 1 到 8 笔花费,比较原版和默写版的判决与原因,任何一笔不同就打印。"""
import importlib
import random
import sys
from collections import Counter

from part10.mandate.wallet_box import Box, Spend, Wallet

NOW = 1_000_000.0
PAYEES = ["CloudLedger", "LuckyGadgets", "FreshMart"]
ITEMS = ["/api/credit-report/acme", "/api/credit-report/bulk", "/api/premium-report/acme", "credit-basic"]


def random_box(rng: random.Random) -> Box:
    return Box(
        payees=frozenset(rng.sample(PAYEES, rng.randint(1, 2))),
        items=frozenset(rng.sample(["/api/credit-report/", "credit-"], rng.randint(1, 2))),
        per_payment_max=rng.choice([100, 500]),
        budget=rng.choice([100, 300, 1000]),
        expires_at=NOW + rng.choice([-10, 3600]),
        ask_above=rng.choice([20, 50]),
    )


def random_spend(rng: random.Random) -> Spend:
    return Spend(
        payee=rng.choice(PAYEES),
        amount=rng.choice([2, 20, 80, 150, 600]),
        item=rng.choice(ITEMS),
        tx_id=rng.choice(["t1", "t2", "t3", "t4"]),
        currency=rng.choice(["USD", "USD", "USD", "EUR"]),
    )


def main(module: str) -> None:
    mine_cls = importlib.import_module(module).RecallWallet
    rng = random.Random(618)
    diff, seen = 0, Counter()
    for n in range(3000):
        box = random_box(rng)
        a, b = Wallet(box), mine_cls(box)
        for _ in range(rng.randint(1, 8)):
            s = random_spend(rng)
            ra, rb = a.decide(s, now=NOW), b.decide(s, now=NOW)
            seen[ra[0].value] += 1
            if ra != rb:
                diff += 1
                if diff == 1:
                    print(f"第 {n} 个框不一致:{s}\n  原版 {ra}\n  默写 {rb}")
            if ra[0].value == "approve":
                a.commit(s)
                b.commit(s)
    print(f"不一致 {diff} 笔;原版判决分布 {dict(sorted(seen.items()))}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "part10.review89.recall_wallet")
```

<div class="line-notes">

- `NOW = 1_000_000.0` 固定一个「现在」,所有框的过期时间都是相对它算的。数字里的下划线是 Python 允许的千分位写法,相当于 JS 的 `1_000_000`。
- `PAYEES = ["CloudLedger", "LuckyGadgets", "FreshMart"]` 三个收款方,每个框只放行其中一两个,所以收款方不对是常态。
- `def random_box(rng: random.Random) -> Box:` 随机造一个框。每个字段都从一个很短的候选里挑,这样各条规则被触发的次数都够多。
- `expires_at=NOW + rng.choice([-10, 3600]),` 一半的框已经过期 10 秒。这会让「过期」那一条占掉很多判决,所以后面的分布里 `deny` 特别多,这是故意的:过期一半,其余规则只能分剩下的一半。
- `ask_above=rng.choice([20, 50]),` 自动放行线只有 20 和 50 美分,所以 80、150 的花费大多会走到 `ask_user`。
- `def random_spend(rng: random.Random) -> Spend:` 随机造一笔花费。交易号只有 t1 到 t4 四个,所以同一个框里很容易撞号,测到「重复交易号」。
- `currency=rng.choice(["USD", "USD", "USD", "EUR"]),` 四分之一是欧元。
- `mine_cls = importlib.import_module(module).RecallWallet` 按名字导入模块,这样同一个脚本既能测默写版,也能测下面故意改坏的版本。
- `rng = random.Random(618)` 固定种子 618,每次抽到的数据一样。
- `a, b = Wallet(box), mine_cls(box)` 同一个框,各开一个钱包。两边的 `spent` 和 `seen_tx` 各自累积。
- `ra, rb = a.decide(s, now=NOW), b.decide(s, now=NOW)` 同一笔花费问两边,拿到(判决, 原因)。原因字符串也比,所以「判决对了但原因写错」也能抓到。
- `if ra[0].value == "approve":` 批准了就两边一起记账。默写版如果在这里和原版不一致,后面整个框的状态都会错位。
- `print(f"不一致 {diff} 笔;原版判决分布 {dict(sorted(seen.items()))}")` 打出不一致的笔数和三种判决各出现多少次。分布里某一种是 0,说明那一档规则没被测到。

</div>

```bash
uv run python -m part10.review89.check_wallet
```

真实输出:

```text
不一致 0 笔;原版判决分布 {'approve': 553, 'ask_user': 1022, 'deny': 11904}
```

一共 13479 笔,三种判决都出现了,`approve` 553 笔,不是零。`deny` 占了大头是因为一半的框过期,这没有问题,但如果你想让软规则测得更充分,可以把 `expires_at` 那一行改成只有 10% 过期。

再故意写错一次。把默写版里「商品不是用户确认过的」那两行,剪切到币种检查前面(紧跟过期检查之后),存成 `mut_wallet.py`,也就是 Day 618 那句「规则顺序要硬在前、软在后」被打破的样子:

```bash
uv run python -m part10.review89.check_wallet part10.review89.mut_wallet
```

```text
第 1 个框不一致:Spend(payee='CloudLedger', amount=600, item='/api/premium-report/acme', tx_id='t4', currency='USD')
  原版 (<Verdict.DENY: 'deny'>, '600 美分超过单笔上限 100')
  默写 (<Verdict.ASK_USER: 'ask_user'>, '/api/premium-report/acme 不是用户确认过的东西')
不一致 2176 笔;原版判决分布 {'approve': 553, 'ask_user': 1022, 'deny': 11904}
```

第一笔就露馅:600 美分远超 100 的单笔上限,按规矩应该直接拒绝,改坏的版本却先问了「这是不是你要买的东西」。放到产品里就是,Agent 弹出一个确认框问用户「要不要买专业版」,用户点了「是」,系统才告诉他这笔钱本来就不可能付。13479 笔里有 2176 笔受影响,约 16%。Day 618 说的那句话,「先拒绝,别去问一个本来就不可能批准的问题」,这里有了数字。

## 默写二:放权梯子的 `wilson_lower()` 和 `Ladder.week()`

第二段默写 Day 620 的放权逻辑。`Level` 和 `Ladder` 的字段直接继承原版,默写两样东西:Wilson 下界的公式,和每周结算的升降规则。

```python
# agent-zero-lab/part10/review89/recall_ladder.py
"""默写二:Day 620 的 wilson_lower() 和 Ladder.week()。Level、Ladder 的字段直接继承原版,只默写这两段逻辑。"""
import math

from part10.ux.levels import Level
from part10.ux.trust import Ladder


def wilson_lower(ok: int, n: int, z: float = 1.96) -> float:
    if n == 0:
        return 0.0
    p = ok / n
    centre = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (centre - margin) / (1 + z * z / n)


class RecallLadder(Ladder):
    def week(self, as_is: int, n: int, undone: int = 0) -> str:
        self.sent_as_is += as_is
        self.total += n
        if self.level == Level.APPROVER:
            self.n_live += n
            self.undone_live += undone
            low = wilson_lower(self.undone_live, self.n_live)
            if low > self.demote_undo_rate:
                self.level = Level.COLLABORATOR
                self.sent_as_is = self.total = self.n_live = self.undone_live = 0
                return "降级"
            return "运行中"
        if self.total >= self.min_samples and wilson_lower(self.sent_as_is, self.total) >= self.promote_at:
            self.level = Level.APPROVER
            return "升级"
        return "不变"
```

<div class="line-notes">

- `import math` 开平方要用,标准库,不用装。
- `def wilson_lower(ok: int, n: int, z: float = 1.96) -> float:` 参数和原版一样:成功次数、总次数、95% 置信度对应的 1.96。我不推导公式,今天只要求把形状默写出来。
- `if n == 0:` 一次都没发过,没有证据,返回 0。不写这行,下面 `ok / n` 会除以零。
- `p = ok / n` 裸比例。20 次全对时 `p` 是 1.0。
- `centre = p + z * z / (2 * n)` 公式的中心项。`n` 越小,`z * z / (2 * n)` 越大,中心被往上推一点,这是公式的一半;另一半在下面的误差项里,而且更大。
- `margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))` 误差项。`n = 20, p = 1.0` 时里面是 `0 + 3.84 / 1600 = 0.0024`,开方 0.049,乘 1.96 约 0.096。
- `return (centre - margin) / (1 + z * z / n)` 中心减误差,再除以一个归一化因子。代入 `n = 20, p = 1.0`:中心 1.096,误差 0.096,除以 1.192,得 0.839。Day 620 打印的「20 次全对,下界 83.9%」就是这么来的。
- `class RecallLadder(Ladder):` 继承原版,只覆盖 `week`。
- `self.sent_as_is += as_is` 累计原样发送数。`self.total += n` 累计总数。两个数无论在什么级别都累计。
- `if self.level == Level.APPROVER:` 已经升上去了,看降级条件。
- `self.n_live += n` 升级之后单独记封数和撤销数,因为降级只看「升级以后」的撤销情况。
- `low = wilson_lower(self.undone_live, self.n_live)` 对撤销率也算下界。一周 25 封撤 1 封,下界约 0.7%,远不到 2%,所以不降级。
- `if low > self.demote_undo_rate:` 连保守估计都超过 2% 才降。
- `self.sent_as_is = self.total = self.n_live = self.undone_live = 0` 降级后四个统计一起清零,重新攒。默写时最容易少清一个,比如忘了清 `n_live`,下次升级后撤销率就混进了旧数据。
- `if self.total >= self.min_samples and wilson_lower(self.sent_as_is, self.total) >= self.promote_at:` 样本够 50 封,而且**下界**达到 0.90 才升。这是整段默写的考点,下面会换成裸比例看看会怎样。原版把这条拆成两行写,等价。
- `return "不变"` 原版返回的是带数字的说明句,我默写成短词,检查脚本不比这个字符串,只比级别和计数。

</div>

检查脚本随机生成 2000 条放权历史,每条 1 到 12 周,每周发 5、25 或 60 封,原样率和撤销率每条历史随机取一档。同一份数据同时喂给原版和默写版,每周结算完比较(级别、累计原样数、累计总数、升级后封数、升级后撤销数)五个值。最后另外抽 5000 组随机的(ok, n)比较 `wilson_lower` 的数值:

```python
# agent-zero-lab/part10/review89/check_ladder.py
"""随机生成 2000 条放权历史(每条 1 到 12 周),同时喂给原版和默写版,比较每周之后的级别和计数;再比较 wilson_lower 在 5000 组随机输入上的数值。"""
import importlib
import random
import sys

from part10.ux import trust
from part10.ux.trust import Ladder


def main(module: str) -> None:
    mod = importlib.import_module(module)
    rng = random.Random(620)
    bad = promotions = demotions = 0
    for n in range(2000):
        p_as_is = rng.choice([0.7, 0.85, 0.93, 0.97, 0.99])
        p_undo = rng.choice([0.005, 0.02, 0.06])
        a, b = Ladder(), mod.RecallLadder()
        for w in range(rng.randint(1, 12)):
            per_week = rng.choice([5, 25, 60])
            as_is = sum(rng.random() < p_as_is for _ in range(per_week))
            undone = sum(rng.random() < p_undo for _ in range(per_week))
            before = a.level
            a.week(as_is, per_week, undone)
            b.week(as_is, per_week, undone)
            promotions += before < a.level
            demotions += before > a.level
            if (a.level, a.sent_as_is, a.total, a.n_live, a.undone_live) != (b.level, b.sent_as_is, b.total, b.n_live, b.undone_live):
                bad += 1
                if bad == 1:
                    print(f"第 {n} 条历史第 {w + 1} 周不一致:原版 {a.level.name} {a.sent_as_is}/{a.total},默写 {b.level.name} {b.sent_as_is}/{b.total}")
    worst = 0.0
    for _ in range(5000):
        nn = rng.randint(0, 300)
        ok = rng.randint(0, nn)
        worst = max(worst, abs(trust.wilson_lower(ok, nn) - mod.wilson_lower(ok, nn)))
    print(f"2000 条历史里不一致 {bad} 周;共升级 {promotions} 次、降级 {demotions} 次;wilson_lower 最大差 {worst:.1e}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "part10.review89.recall_ladder")
```

<div class="line-notes">

- `from part10.ux import trust` 把原版模块整个导入,后面用 `trust.wilson_lower` 和默写版的数值对比。
- `rng = random.Random(620)` 种子固定为 620。
- `p_as_is = rng.choice([0.7, 0.85, 0.93, 0.97, 0.99])` 每条历史的真实原样率,五档,有绝不该升级的(0.7),也有很快该升级的(0.99)。
- `p_undo = rng.choice([0.005, 0.02, 0.06])` 升级之后的真实撤销率,有低于 2% 的,有刚好卡线的,有明显超标的。
- `a, b = Ladder(), mod.RecallLadder()` 原版和默写版各一份,都从第二级起步。
- `per_week = rng.choice([5, 25, 60])` 每周封数有三档。每周只有 5 封时,要攒十周才到 50 封的门槛,测到「样本不够」那条。
- `before = a.level` 记下结算前的级别,下一行结算后比较,就能数出这周发生了升级还是降级。
- `promotions += before < a.level` `Level` 是 `IntEnum`,能直接比大小;`True` 加进整数就是 1。
- `if (a.level, a.sent_as_is, a.total, a.n_live, a.undone_live) != (b.level` 五元组直接比较。任何一个计数错位都会在这里抓到,不只是级别。
- `worst = max(worst, abs(trust.wilson_lower(ok, nn) - mod.wilson_lower(ok, nn)))` 数值比较取最大差。公式抄对了是精确的 0,抄错一个系数会是 0.0 几。

</div>

```bash
uv run python -m part10.review89.check_ladder
```

```text
2000 条历史里不一致 0 周;共升级 1007 次、降级 273 次;wilson_lower 最大差 0.0e+00
```

升级 1007 次、降级 273 次,说明两个方向的分支都跑到了。再把升级条件里的 `wilson_lower(self.sent_as_is, self.total)` 换成裸比例 `self.sent_as_is / self.total`(存成 `mut_ladder.py`,用 `sed` 一行就行):

```bash
sed 's/wilson_lower(self.sent_as_is, self.total) >= self.promote_at/self.sent_as_is \/ self.total >= self.promote_at/' \
  part10/review89/recall_ladder.py > part10/review89/mut_ladder.py
uv run python -m part10.review89.check_ladder part10.review89.mut_ladder
```

```text
第 11 条历史第 1 周不一致:原版 COLLABORATOR 54/60,默写 APPROVER 54/60
2000 条历史里不一致 3714 周;共升级 1007 次、降级 273 次;wilson_lower 最大差 0.0e+00
```

第一个反例就够说明问题:第一周发了 60 封,54 封原样发送,裸比例 90.0%,刚好踩线,改坏的版本立刻升级;原版的下界只有约 79.9%,继续观察。一周的数据就放权,这是 Day 620 讲过的那个坑,现在有了随机数据的证明:2000 条历史里 3714 个「周」结果不同。


## 本周小项目:Agent 动作闸门

现在把零件拼起来。需求是这样:一个客服 Agent 会提出两类动作。

**退款**:撤不回来。要先过钱包授权框(Day 618,收款方、预算、重复请求都归它管),再按 Day 619 的 `decide()` 定级,结果永远是「先问人」,而且金额超过 500 元的要二级审批(Day 621 里 980 元那笔就是这个规则);审批人只递「编号加决定」,金额按编号重新查库(Day 621)。

**回复客户**:撤得回。按 `decide()` 加放权梯子(Day 620)决定先问还是先发:没升级时起草等客服点发送,升级以后先发出去,留 30 秒撤销窗口。

两类动作的每一件事都用任务状态表示(Day 614 讲过、Day 616 在 SDK 里见过的那套):`input-required` 是等人,`working` 是在窗口期里,`completed`、`canceled`、`rejected` 是终态,**终态之后不能再改**。

```text
退款:  提交 ──钱包 DENY──▶ rejected
          │
          └─钱包放行─▶ input-required ──人驳回──▶ canceled
                           │
                           └─人批准─▶ 钱包再判一次 ──DENY──▶ rejected
                                          │
                                          └─放行─▶ 记账,completed

回复:  生成 ──没升级──▶ input-required ──客服点发送──▶ completed
          │
          └─已升级──▶ working(窗口期)──到期──▶ completed
                          │
                          └─窗口内撤销──▶ canceled
```

注意退款流程里钱包判了**两次**,提交时一次,批准时一次。两次之间别人可能已经把额度花掉了,下面的实跑里会看到这种情况。

先写主体。文件比较长,按「任务、退款、回复」三块读:

```python
# agent-zero-lab/part10/review89/refund_gate.py
"""本周小项目:Agent 动作闸门。退款走「钱包规则 + 分级 + 人工批准」,回复客户走「分级 + 放权梯子 + 撤销窗口」,
每件事的结果用任务状态表示。全是本机假数据,不连任何真实系统,没有模型调用。"""
from collections.abc import Callable
from dataclasses import dataclass, field

from part10.mandate.wallet_box import Box, Spend, Verdict, Wallet
from part10.ux.actions import Action, decide
from part10.ux.levels import Level
from part10.ux.trust import Ladder
from part10.ux.undo import UndoWindow

TERMINAL = ("completed", "failed", "canceled", "rejected")
CARD_LIMIT_YUAN = 500.0  # 卡片审批上限:超过要二级审批(Day 621 的规则)

# 假发票:编号 -> (客户, 金额元)。金额只从这里读,绝不信请求里带来的数字。
INVOICES: dict[str, tuple[str, float]] = {
    "INV-0042": ("acme", 98.0),
    "INV-0043": ("acme", 980.0),
    "INV-0050": ("bolt", 300.0),
    "INV-0051": ("bolt", 260.0),
}


@dataclass
class Task:
    id: str
    kind: str
    state: str = "submitted"
    note: str = ""
    invoice_id: str = ""
    history: list[str] = field(default_factory=list)

    def move(self, state: str, note: str = "") -> None:
        if self.state in TERMINAL:
            raise ValueError(f"{self.id} 已经是终态 {self.state},不能改成 {state}")
        self.history.append(state)
        self.state, self.note = state, note


class Gate:
    def __init__(self, box: Box, clock: Callable[[], float], undo_seconds: float = 30) -> None:
        self.wallet = Wallet(box)
        self.clock = clock
        self.ladder = Ladder()
        self.window = UndoWindow(undo_seconds, clock)
        self.tasks: dict[str, Task] = {}
        self.refunded: list[tuple[str, int]] = []  # (refund_id, 分),真付出去的
        self.sent: list[str] = []  # 真发出去的回复编号

    def _wallet(self, customer: str) -> Wallet:
        return self.wallet  # 所有客户共用一个钱包;练习 2 会把它改成一客户一个

    def _spend(self, refund_id: str, invoice_id: str) -> Spend:
        customer, yuan = INVOICES[invoice_id]
        return Spend(customer, round(yuan * 100), f"refund/{invoice_id}", refund_id, currency="CNY")

    def submit_refund(self, refund_id: str, invoice_id: str) -> Task:
        if refund_id in self.tasks:
            return self.tasks[refund_id]  # 同一个 refund_id 再提交,返回原任务,不开新的
        task = Task(refund_id, "refund", invoice_id=invoice_id)
        self.tasks[refund_id] = task
        if invoice_id not in INVOICES:
            task.move("rejected", f"没有这张发票 {invoice_id}")
            return task
        customer, yuan = INVOICES[invoice_id]
        verdict, why = self._wallet(customer).decide(self._spend(refund_id, invoice_id), now=self.clock())
        if verdict is Verdict.DENY:
            task.move("rejected", why)
            return task
        level = decide(Action("issue_refund", reversible=False, external=True, amount=yuan))
        assert level == Level.CONSULTANT  # 退款撤不回来,永远先问人
        need = "二级审批" if yuan > CARD_LIMIT_YUAN else "卡片审批"
        task.move("input-required", f"{customer} 的 {invoice_id} 退 {yuan:.2f} 元,需要{need}")
        return task

    def approve_refund(self, refund_id: str, decision: str, approver_limit: float) -> Task:
        task = self.tasks[refund_id]
        if task.kind != "refund" or task.state != "input-required":
            raise ValueError(f"{refund_id} 是 {task.kind}/{task.state},不在等退款批准")
        invoice_id = task.invoice_id
        if decision != "approve":
            task.move("canceled", "审批人驳回")
            return task
        yuan = INVOICES[invoice_id][1]  # 金额重新从库里读
        if yuan > approver_limit:
            task.note += f"(审批人上限 {approver_limit:.0f} 元,批不了)"
            return task  # 留在 input-required
        spend = self._spend(refund_id, invoice_id)
        wallet = self._wallet(spend.payee)
        verdict, why = wallet.decide(spend, now=self.clock())
        if verdict is Verdict.DENY:
            task.move("rejected", why)
            return task
        wallet.commit(spend)
        self.refunded.append((refund_id, spend.amount))
        task.move("completed", f"已退 {yuan:.2f} 元")
        return task

    def send_reply(self, reply_id: str) -> Task:
        if reply_id in self.tasks:
            return self.tasks[reply_id]  # 同一个编号再来,返回原任务
        task = Task(reply_id, "reply")
        self.tasks[reply_id] = task
        trust = 1.0 if self.ladder.level == Level.APPROVER else 0.0
        level = decide(Action("send_reply", reversible=True, external=True), trust)
        if level == Level.APPROVER:
            due = self.window.schedule(reply_id, lambda: self._deliver(reply_id))
            task.move("working", f"已排队,时钟到 {due:.0f} 之前可撤")
        else:
            task.move("input-required", "草稿已生成,等客服点发送")
        return task

    def send_draft(self, reply_id: str) -> Task:
        task = self.tasks[reply_id]
        if task.kind != "reply" or task.state != "input-required":
            raise ValueError(f"{reply_id} 是 {task.kind}/{task.state},没有草稿在等")
        self._deliver(reply_id)
        return task

    def _deliver(self, reply_id: str) -> None:
        self.sent.append(reply_id)
        self.tasks[reply_id].move("completed", "已发送")

    def undo_reply(self, reply_id: str) -> bool:
        ok = self.window.undo(reply_id)
        if ok:
            self.tasks[reply_id].move("canceled", "客服撤销")
        return ok

    def tick(self) -> list[str]:
        return self.window.tick()
```

<div class="line-notes">

- `TERMINAL = ("completed", "failed", "canceled", "rejected")` 四个终态,Day 614 起一直是这四个。
- `CARD_LIMIT_YUAN = 500.0  # 卡片审批上限:超过要二级审批(Day 621 的规则)` 单位是**元**。钱包里的单位是**美分/分**,两边不一样,换算在 `_spend` 里做,后面有一道练习专门拆这个坑。
- `INVOICES: dict[str, tuple[str, float]] = {` 假发票表,键是发票号,值是(客户, 金额元)。`dict[str, tuple[str, float]]` 相当于 TS 的 `Record<string, [string, number]>`。
- `"INV-0043": ("acme", 980.0),` 980 元,超过 500 的卡片上限,Day 621 那一笔。
- `class Task:` 一个任务。`kind` 区分退款还是回复,这个字段第一版没有,下面「抓到三处 bug」会讲为什么要加检查。
- `invoice_id: str = ""` 退款任务记下它对应哪张发票,批准时用它回库里查金额。回复任务这里是空串。
- `history: list[str] = field(default_factory=list)` 状态变迁的记录。`field(default_factory=list)` 是 dataclass 里给列表字段设默认值的写法(Day 50 讲过),不能直接写 `= []`。
- `def move(self, state: str, note: str = "") -> None:` 所有状态变化都走这一个函数。
- `if self.state in TERMINAL:` 终态保护只在这一处写一次。后面不管哪条路径要改状态,都绕不开它。
- `raise ValueError(f"{self.id} 已经是终态 {self.state},不能改成 {state}")` 改一个终态任务会炸出这句话,比如 `r1 已经是终态 completed,不能改成 input-required`。
- `self.wallet = Wallet(box)` 一个共用钱包。
- `self.window = UndoWindow(undo_seconds, clock)` 撤销窗口,时钟是外面传进来的,演示和测试都用假时钟。
- `self.refunded: list[tuple[str, int]] = []  # (refund_id, 分),真付出去的` 只有走完批准、钱包放行、`commit` 之后才会进这个列表,后面五条不变量主要盯它。
- `def _wallet(self, customer: str) -> Wallet:` 取钱包的小函数。现在永远返回同一个,留着是为了练习 2 能一客户一个。
- `return Spend(customer, round(yuan * 100), f"refund/{invoice_id}", refund_id, currency="CNY")` 元换成分,`98.0` 元变成 `9800`。`item` 写成 `refund/INV-0042`,`tx_id` 用退款编号,同一个编号第二次来,钱包会因为「交易号已经付过」拒绝。
- `if refund_id in self.tasks:` 同一个退款编号再提交,返回原来的任务,不开新的。这是去重的第一道。
- `if invoice_id not in INVOICES:` 发票号不存在,直接 `rejected`,连钱包都不用问。
- `verdict, why = self._wallet(customer).decide(self._spend(refund_id, invoice_id), now=self.clock())` 第一次问钱包。`now=` 传假时钟。
- `if verdict is Verdict.DENY:` 钱包说「不行」就是 `rejected`,不去问人。钱包的 `ASK_USER` 这里不单独处理,因为退款不管钱包怎么说,都要问人。
- `level = decide(Action("issue_refund", reversible=False, external=True, amount=yuan))` 用 Day 619 的 `decide()` 定级:撤不回、客户看得到、金额按元。
- `assert level == Level.CONSULTANT` 退款永远是第三级「先问」。这一行是给读代码的人看的,也是个哨兵:以后谁改了 `decide()`,退款掉到别的级别,这里会炸。
- `need = "二级审批" if yuan > CARD_LIMIT_YUAN else "卡片审批"` 98 元是卡片审批,980 元是二级审批。
- `task.move("input-required", f"{customer} 的 {invoice_id} 退 {yuan:.2f} 元,需要{need}")` 任务停在 `input-required`,说明里写清是谁的哪张发票、多少钱、要谁批。
- `def approve_refund(self, refund_id: str, decision: str, approver_limit: float) -> Task:` 审批人的入口只有三个参数:编号、决定、**他自己的审批上限**。没有金额参数,金额只能自己去查。
- `if task.kind != "refund" or task.state != "input-required":` 不是退款任务,或者不在等批准,一律拒绝。
- `yuan = INVOICES[invoice_id][1]  # 金额重新从库里读` Day 621 的规矩:不信界面传回来的数字。
- `if yuan > approver_limit:` 980 元遇到上限 500 的审批人,不能批。任务**留在** `input-required`,说明末尾加一句「批不了」,等更高级别的人来。
- `wallet = self._wallet(spend.payee)` 批准时再取一次钱包(`spend.payee` 就是客户名)。
- `verdict, why = wallet.decide(spend, now=self.clock())` 第二次问钱包。两次之间额度可能被别的退款花掉了。
- `wallet.commit(spend)` 只有走到这里钱才真的算花了。`commit` 只在这一处调用。
- `self.refunded.append((refund_id, spend.amount))` 同时记进 `refunded`,单位是分。
- `def send_reply(self, reply_id: str) -> Task:` 回复客户的入口。
- `trust = 1.0 if self.ladder.level == Level.APPROVER else 0.0` 把放权梯子的级别翻译成 `decide()` 要的 `trust` 数值:升级了是 1.0,没升级是 0.0。
- `level = decide(Action("send_reply", reversible=True, external=True), trust)` 可逆、客户看得到。`trust` 是 0.0 得到 `COLLABORATOR`,是 1.0 得到 `APPROVER`。
- `due = self.window.schedule(reply_id, lambda: self._deliver(reply_id))` 升级后不立刻发,排进撤销窗口,到期才调用 `_deliver`。`lambda` 就是 JS 的箭头函数 `() => this._deliver(replyId)`。
- `task.move("working", f"已排队,时钟到 {due:.0f} 之前可撤")` 窗口期里任务是 `working`。
- `task.move("input-required", "草稿已生成,等客服点发送")` 没升级,起草后等人。
- `def send_draft(self, reply_id: str) -> Task:` 客服点「发送」的入口,同样要检查 `kind` 和状态。
- `def _deliver(self, reply_id: str) -> None:` 真正「发出去」只有这一个函数,`sent` 列表只在这里追加。
- `ok = self.window.undo(reply_id)` 撤销交给 Day 620 的 `UndoWindow`,它负责把动作从队列拿掉。
- `if ok:` 撤销成功才把任务改成 `canceled`。已经发出去的,`undo` 返回 `False`,任务保持 `completed`。
- `return self.window.tick()` 时间往前走时,外面定期调一次 `tick()`,到期的动作在这里被真正执行。

</div>

先跑一遍演示。时钟是假的,用一个列表 `now = [1000.0]` 当可变的时钟,手动拨快:

```python
# agent-zero-lab/part10/review89/gate_demo.py
"""把动作闸门跑一遍:四张发票退款 + 升级前后的回复。时钟是假的,不用真等。"""
from part10.mandate.wallet_box import Box
from part10.review89.refund_gate import Gate, Task

now = [1000.0]
box = Box(payees=frozenset({"acme", "bolt"}), items=frozenset({"refund/"}), per_payment_max=100_000,
          budget=150_000, expires_at=10_000.0, ask_above=0, currency="CNY")
gate = Gate(box, clock=lambda: now[0])


def show(label: str, t: Task) -> None:
    print(f"{label:<26}| {t.state:<14}| {t.note}")


print("== 退款")
show("提交 r1(INV-0042)", gate.submit_refund("r1", "INV-0042"))
show("卡片审批人批 r1", gate.approve_refund("r1", "approve", approver_limit=500))
show("再提交 r1", gate.submit_refund("r1", "INV-0042"))
show("提交 r2(INV-0043,980元)", gate.submit_refund("r2", "INV-0043"))
show("卡片审批人批 r2", gate.approve_refund("r2", "approve", approver_limit=500))
show("二级审批人批 r2", gate.approve_refund("r2", "approve", approver_limit=5000))
show("提交 r3(INV-0050,300元)", gate.submit_refund("r3", "INV-0050"))
show("提交 r5(INV-0051,260元)", gate.submit_refund("r5", "INV-0051"))
show("提交 r4(不存在的发票)", gate.submit_refund("r4", "INV-9999"))
show("批 r3", gate.approve_refund("r3", "approve", approver_limit=500))
show("批 r5", gate.approve_refund("r5", "approve", approver_limit=500))
print("真付出去的(分):", gate.refunded, "合计", sum(c for _, c in gate.refunded))
try:
    gate.approve_refund("r1", "approve", 500)
except ValueError as e:
    print("再批 r1:", e)

print("== 回复")
show("m1 起草", gate.send_reply("m1"))
show("m1 客服点发送", gate.send_draft("m1"))
for week in range(1, 5):
    print(f"  第 {week} 周", gate.ladder.week(as_is=24, n=25))
show("m2 升级后", gate.send_reply("m2"))
show("m3 升级后", gate.send_reply("m3"))
print("撤 m3:", gate.undo_reply("m3"), "| 再撤 m3:", gate.undo_reply("m3"))
now[0] += 29
print("29 秒后 tick:", gate.tick())
now[0] += 2
print("31 秒后 tick:", gate.tick())
show("m2", gate.tasks["m2"])
show("m3", gate.tasks["m3"])
print("真发出去的回复:", gate.sent)
```

<div class="line-notes">

- `now = [1000.0]` 用一个只有一个元素的列表当「可变的数字」。闭包里不能直接给外层变量重新赋值,列表可以改里面的元素。相当于 JS 里 `let now = 1000` 被箭头函数改,Python 要借个容器。
- `box = Box(payees=frozenset({"acme", "bolt"}), items=frozenset({"refund/"}), per_payment_max=100_000,` 授权框:两个客户可退,`item` 以 `refund/` 开头,单笔上限 1000 元(100000 分)。
- `budget=150_000, expires_at=10_000.0, ask_above=0, currency="CNY")` 总预算 1500 元;`ask_above=0` 让钱包对所有金额都返回 `ask_user` 而不是 `approve`,反正退款最后都要问人;币种人民币。
- `gate = Gate(box, clock=lambda: now[0])` 时钟函数每次读列表里的值。
- `def show(label: str, t: Task) -> None:` 小工具,把任务状态打印成表格的一行。
- `show("提交 r1(INV-0042)", gate.submit_refund("r1", "INV-0042"))` 98 元,钱包放行,等卡片审批。
- `show("再提交 r1", gate.submit_refund("r1", "INV-0042"))` 同一个编号再来,拿到的是已经 `completed` 的原任务,没有第二次扣款。
- `show("提交 r2(INV-0043,980元)", gate.submit_refund("r2", "INV-0043"))` 980 元,说明里写着「需要二级审批」。
- `show("卡片审批人批 r2", gate.approve_refund("r2", "approve", approver_limit=500))` 上限 500 的人批 980 元,批不了,任务还在等。
- `show("提交 r5(INV-0051,260元)", gate.submit_refund("r5", "INV-0051"))` 这时 r1 的 98 加 r2 的 980 一共 1078 元已经花掉,r3 和 r5 还没批。r3、r5 提交时钱包都放行了,因为提交只是在问「能不能」,没有记账。
- `show("批 r3", gate.approve_refund("r3", "approve", approver_limit=500))` 先批 r3,1078 加 300 是 1378,还在 1500 以内。
- `show("批 r5", gate.approve_refund("r5", "approve", approver_limit=500))` 再批 r5,1378 加 260 是 1638,超了。**这就是批准时要再问一次钱包的原因。**
- `print("真付出去的(分):", gate.refunded, "合计", sum(c for _, c in gate.refunded))` 把 `refunded` 打出来,单位是分。
- `for week in range(1, 5):` 模拟 4 周,每周 25 封里 24 封原样发送。
- `print(f"  第 {week} 周", gate.ladder.week(as_is=24, n=25))` 第 4 周累计 96/100,下界 91.5%,升级。和 Day 620 的演示一样。
- `show("m2 升级后", gate.send_reply("m2"))` 升级后的回复先排队,任务是 `working`。
- `print("撤 m3:", gate.undo_reply("m3"), "| 再撤 m3:", gate.undo_reply("m3"))` 第一次撤销返回 `True`,第二次是 `False`。
- `now[0] += 29` 拨快 29 秒,窗口 30 秒还没到。后面的 `now[0] += 2` 再拨 2 秒,到 31 秒,`m2` 才被真正发出去。

</div>

```bash
uv run python -m part10.review89.gate_demo
```

真实输出:

```text
== 退款
提交 r1(INV-0042)           | input-required| acme 的 INV-0042 退 98.00 元,需要卡片审批
卡片审批人批 r1                 | completed     | 已退 98.00 元
再提交 r1                    | completed     | 已退 98.00 元
提交 r2(INV-0043,980元)      | input-required| acme 的 INV-0043 退 980.00 元,需要二级审批
卡片审批人批 r2                 | input-required| acme 的 INV-0043 退 980.00 元,需要二级审批(审批人上限 500 元,批不了)
二级审批人批 r2                 | completed     | 已退 980.00 元
提交 r3(INV-0050,300元)      | input-required| bolt 的 INV-0050 退 300.00 元,需要卡片审批
提交 r5(INV-0051,260元)      | input-required| bolt 的 INV-0051 退 260.00 元,需要卡片审批
提交 r4(不存在的发票)             | rejected      | 没有这张发票 INV-9999
批 r3                      | completed     | 已退 300.00 元
批 r5                      | rejected      | 已花 137800,再付 26000 会超过总预算 150000
真付出去的(分): [('r1', 9800), ('r2', 98000), ('r3', 30000)] 合计 137800
再批 r1: r1 是 refund/completed,不在等退款批准
== 回复
m1 起草                     | input-required| 草稿已生成,等客服点发送
m1 客服点发送                  | completed     | 已发送
  第 1 周 不变
  第 2 周 不变
  第 3 周 不变
  第 4 周 升到 APPROVER(先发送,留撤销窗口)
m2 升级后                    | working       | 已排队,时钟到 1030 之前可撤
m3 升级后                    | working       | 已排队,时钟到 1030 之前可撤
撤 m3: True | 再撤 m3: False
29 秒后 tick: []
31 秒后 tick: ['m2']
m2                        | completed     | 已发送
m3                        | canceled      | 客服撤销
真发出去的回复: ['m1', 'm2']
```

对着输出过一遍。`r5` 最有意思:提交时钱包看到的是 1078 元已花、再加 260 元没超,放行;等到批准时 `r3` 已经先占了 300 元,1378 加 260 超过 1500,钱包这一次说「不行」,任务变成 `rejected`,理由原样写在说明里。如果批准时不再问一次钱包,这 260 元就会超预算地退出去。`m3` 在窗口期里被撤,`m2` 到期才真发出去,最后 `sent` 里只有 `m1`、`m2`。

输出里有几行的竖线对不齐,是因为中文字符在终端里占两格,而 `{label:<26}` 按字符数补空格。这是个小坑,我没去修,不影响理解。

## 五条不变量:随机操作两千轮

演示只走了一条路。真正要证明闸门可靠,得让它被乱操作,看有什么永远不该发生的事发生了。把「永远不该发生」写成五条不变量(不管怎么操作都必须成立的规则),每一条守本周某一天的规矩:

| 不变量 | 守的是 |
| --- | --- |
| I1 付出去的总额不超过钱包的总预算 | Day 618 授权框的预算 |
| I2 每一笔退款之前都有人点过批准 | Day 619 动作分级,Day 621 审批 |
| I3 同一个退款编号只付一次,而且付的金额等于库里的金额 | Day 617 重放保护,Day 621 金额查库 |
| I4 任务一旦到了终态,状态不再变 | Day 614 和 616 的终态规则 |
| I5 被撤销的回复永远不会被发出去 | Day 620 撤销窗口 |

随机操作有七种:提交退款、批准(随机批准人上限、随机批准还是驳回)、起草回复、客服点发送、撤销、时间往前拨 5 秒或 31 秒再 `tick`、结算一周放权。编号只有 `r1` 到 `r6` 和 `m1` 到 `m6`,所以会频繁撞号,测到各种重复和乱序。每轮一个新闸门做 5 到 30 步,每一步之后检查五条:

```python
# agent-zero-lab/part10/review89/check_gate.py
"""随机操作 2000 轮,每一步之后检查五条不变量。传 --bug early 或 --bug fakeundo 会换上一个带 bug 的闸门,看检查能不能抓到。"""
import random
import sys

from part10.mandate.wallet_box import Box
from part10.review89.refund_gate import INVOICES, TERMINAL, Gate, Task
from part10.ux.undo import UndoWindow


class EarlyCommitGate(Gate):
    """bug:提交时就记账,还没批准钱就算花了。"""

    def submit_refund(self, refund_id: str, invoice_id: str) -> Task:
        task = super().submit_refund(refund_id, invoice_id)
        if task.state == "input-required" and refund_id not in dict(self.refunded):
            spend = self._spend(refund_id, invoice_id)
            self.wallet.commit(spend)
            self.refunded.append((refund_id, spend.amount))
        return task


class FakeUndoWindow(UndoWindow):
    """bug:撤销只返回 True,队列里的动作还在。"""

    def undo(self, action_id: str) -> bool:
        return any(p.action_id == action_id for p in self.queue)


def make_gate(bug: str | None, now: list[float]) -> Gate:
    box = Box(payees=frozenset({"acme", "bolt"}), items=frozenset({"refund/"}), per_payment_max=100_000,
              budget=150_000, expires_at=1e9, ask_above=0, currency="CNY")
    gate = (EarlyCommitGate if bug == "early" else Gate)(box, clock=lambda: now[0])
    if bug == "fakeundo":
        gate.window = FakeUndoWindow(30, lambda: now[0])
    return gate


def run(bug: str | None) -> None:
    rng = random.Random(622)
    failures: dict[str, int] = {}
    stats = {"steps": 0, "refunded": 0, "sent": 0, "undone": 0, "budget_rejects": 0}
    first: dict[str, str] = {}

    def fail(rule: str, detail: str) -> None:
        failures[rule] = failures.get(rule, 0) + 1
        first.setdefault(rule, detail)

    for _ in range(2000):
        now = [0.0]
        gate = make_gate(bug, now)
        approved: set[str] = set()
        undone: set[str] = set()
        frozen: dict[str, str] = {}
        for _step in range(rng.randint(5, 30)):
            op = rng.choice(["submit", "approve", "reply", "send", "undo", "tick", "week"])
            ids = list(gate.tasks)
            try:
                if op == "submit":
                    gate.submit_refund(f"r{rng.randint(1, 6)}", rng.choice(list(INVOICES) + ["INV-9999"]))
                elif op == "approve" and ids:
                    rid = rng.choice(ids)
                    decision = rng.choice(["approve", "approve", "reject"])
                    if decision == "approve" and gate.tasks[rid].kind == "refund":
                        approved.add(rid)
                    gate.approve_refund(rid, decision, rng.choice([500.0, 5000.0]))
                elif op == "reply":
                    gate.send_reply(f"m{rng.randint(1, 6)}")
                elif op == "send" and ids:
                    gate.send_draft(rng.choice(ids))
                elif op == "undo" and ids:
                    rid = rng.choice(ids)
                    if gate.undo_reply(rid):
                        undone.add(rid)
                elif op == "tick":
                    now[0] += rng.choice([5.0, 31.0])
                    gate.tick()
                else:
                    gate.ladder.week(rng.randint(20, 25), 25, rng.randint(0, 1))
            except (ValueError, KeyError):
                pass
            stats["steps"] += 1
            if sum(c for _, c in gate.refunded) > gate.wallet.box.budget:
                fail("I1 总额超预算", f"{gate.refunded}")
            if any(rid not in approved for rid, _ in gate.refunded):
                fail("I2 没批准就付了", f"refunded={gate.refunded} approved={sorted(approved)}")
            ids_paid = [rid for rid, _ in gate.refunded]
            if len(ids_paid) != len(set(ids_paid)) or any(
                c != round(INVOICES[gate.tasks[rid].invoice_id][1] * 100) for rid, c in gate.refunded
            ):
                fail("I3 重复付或金额不是库里的", f"{gate.refunded}")
            for tid, task in gate.tasks.items():
                if tid in frozen and frozen[tid] != task.state:
                    fail("I4 终态被改了", f"{tid}: {frozen[tid]} -> {task.state}")
                if task.state in TERMINAL:
                    frozen.setdefault(tid, task.state)
            if any(rid in gate.sent for rid in undone):
                fail("I5 撤销了还是发出去了", f"undone={sorted(undone)} sent={gate.sent}")
        stats["refunded"] += len(gate.refunded)
        stats["sent"] += len(gate.sent)
        stats["undone"] += len(undone)
        stats["budget_rejects"] += sum("总预算" in t.note for t in gate.tasks.values())
    print(f"bug={bug}  {stats}")
    for rule, n in sorted(failures.items()):
        print(f"  违反 {rule}:{n} 次,第一次:{first[rule]}")
    if not failures:
        print("  五条不变量全部成立")


if __name__ == "__main__":
    run(sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--bug" else None)
```

<div class="line-notes">

- `class EarlyCommitGate(Gate):` 一个**故意带 bug** 的闸门,用来证明检查能抓到问题。它继承正常闸门。
- `task = super().submit_refund(refund_id, invoice_id)` 先走正常的提交流程。
- `if task.state == "input-required" and refund_id not in dict(self.refunded):` bug 的触发条件:任务刚好停在等批准。`dict(self.refunded)` 把(编号, 分)的列表转成字典,`in` 查编号。
- `self.wallet.commit(spend)` 还没批准就记账,这就是「提交时就扣钱」的错误写法。
- `class FakeUndoWindow(UndoWindow):` 第二个带 bug 的:撤销只返回 `True`,没真的拿掉。这正是 Day 620 第一版的错误。
- `return any(p.action_id == action_id for p in self.queue)` 只检查「队列里有没有这个编号」,不拿走。到期时它还会被执行。
- `def make_gate(bug: str | None, now: list[float]) -> Gate:` 按参数造正常的闸门或带 bug 的闸门。`str | None` 是 Python 3.10 起的写法,相当于 TS 的 `string | null`。
- `budget=150_000, expires_at=1e9, ask_above=0, currency="CNY")` 和演示用同一个框,不过过期时间拉到很远,不让「过期」把其他规则的测试吞掉。
- `rng = random.Random(622)` 种子固定 622。
- `stats = {"steps": 0, "refunded": 0, "sent": 0, "undone": 0, "budget_rejects": 0}` 几个计数器,最后打印。如果 `refunded` 是 0,说明随机操作根本没走到付钱那一步,「五条不变量全成立」就不可信。
- `def fail(rule: str, detail: str) -> None:` 记一次违反,并只留下第一次的细节。
- `approved: set[str] = set()` 记下**批准动作被调用过**的编号。注意是调用过,不是成功过,因为 I2 要证明的是「没有批准就没有付款」,调用过但失败也不能付。
- `undone: set[str] = set()` 记下撤销**返回了 True** 的编号。
- `frozen: dict[str, str] = {}` 记下每个任务第一次进终态时的状态,之后只要不一样就是 I4 被破坏。
- `op = rng.choice(["submit", "approve", "reply", "send", "undo", "tick", "week"])` 每一步随机挑一种操作。
- `gate.submit_refund(f"r{rng.randint(1, 6)}", rng.choice(list(INVOICES) + ["INV-9999"]))` 随机编号、随机发票,偶尔给一张不存在的。
- `gate.approve_refund(rid, decision, rng.choice([500.0, 5000.0]))` 随机批或驳回,审批人上限随机,500 的批不了 980。
- `now[0] += rng.choice([5.0, 31.0])` 要么拨 5 秒(窗口没到),要么 31 秒(窗口到了),然后 `tick`。
- `except (ValueError, KeyError):` 非法操作(对终态任务再批、对不存在的编号点发送)会炸 `ValueError` 或 `KeyError`,这是闸门拒绝的方式,检查脚本吞掉异常继续,只看状态有没有被破坏。
- `if sum(c for _, c in gate.refunded) > gate.wallet.box.budget:` I1。`gate.refunded` 里是(编号, 分),取每个的分求和,和总预算比。
- `if any(rid not in approved for rid, _ in gate.refunded):` I2。付出去的编号必须都在 `approved` 里。
- `c != round(INVOICES[gate.tasks[rid].invoice_id][1] * 100)` I3 的后半:付出去的金额必须等于库里那张发票的金额乘 100,不能是别的数。前半是 `len(ids_paid) != len(set(ids_paid))`,有重复编号就是付了两次。
- `if tid in frozen and frozen[tid] != task.state:` I4。任务已经进过终态,现在的状态和当时记的不同,违规。
- `frozen.setdefault(tid, task.state)` 只在第一次进终态时记。`setdefault` 的意思是「没有才设」。
- `if any(rid in gate.sent for rid in undone):` I5。撤销过的回复,不能出现在已发送列表里。
- `stats["budget_rejects"] += sum("总预算" in t.note for t in gate.tasks.values())` 数一数有多少任务是因为预算被拒的,确认「预算」这条规则真的被测到了。
- `run(sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == "--bug" else None)` 命令行传 `--bug early` 或 `--bug fakeundo` 就换上带 bug 的闸门。

</div>

### 第一次跑:抓到我自己写的 bug

这个闸门的第一版和上面的完整代码有三处不同:`send_reply` 没有「同一个编号再来就返回原任务」的去重,`send_draft` 和 `approve_refund` 也没检查任务的 `kind`,退款任务和回复任务混在同一个字典里,谁都能拿别人的编号来操作。第一次跑检查:

```text
bug=None  {'steps': 35982, 'refunded': 508, 'sent': 2267, 'undone': 32, 'budget_rejects': 2}
  违反 I4 终态被改了:2519 次,第一次:m1: completed -> input-required
  违反 I5 撤销了还是发出去了:3 次,第一次:undone=['m5'] sent=['m2', 'm5', 'm2', 'm4', 'm3']
```

`m1: completed -> input-required`:一封已经发出去的回复,因为又有人用同一个编号 `m1` 调了一次 `send_reply`,整个任务被一个新的 `Task` 覆盖,状态从 `completed` 掉回 `input-required`,客服可以再点一次发送,同一封信发两遍。`sent` 里 `'m2'` 出现了两次,就是这样发出去的。I5 的三次违反是同一个根:`m5` 先被撤销,然后同一个编号再来一次,新任务进了窗口,到期照发。

注意这是**没有埋 bug 的**闸门,它自己就有洞。把 `send_reply` 开头加上去重,再给 `send_draft` 和 `approve_refund` 都加上 `task.kind` 检查(上面的完整代码已经是改好的),重新跑三遍:

```bash
uv run python -m part10.review89.check_gate
uv run python -m part10.review89.check_gate --bug early
uv run python -m part10.review89.check_gate --bug fakeundo
```

```text
bug=None  {'steps': 35982, 'refunded': 679, 'sent': 1486, 'undone': 29, 'budget_rejects': 8}
  五条不变量全部成立
bug=early  {'steps': 35982, 'refunded': 2969, 'sent': 1486, 'undone': 29, 'budget_rejects': 233}
  违反 I2 没批准就付了:19047 次,第一次:refunded=[('r4', 30000)] approved=[]
bug=fakeundo  {'steps': 35982, 'refunded': 679, 'sent': 1493, 'undone': 29, 'budget_rejects': 8}
  违反 I5 撤销了还是发出去了:103 次,第一次:undone=['m6'] sent=['m6']
```

修好以后,三万五千多步里五条不变量全部成立;两个故意埋的 bug 各被对应的那一条抓住:提交时就记账,被 I2 报了 19047 次,第一次就是 `r4` 还没人批准,300 元(30000 分)已经进了 `refunded`;假撤销被 I5 报了 103 次。`refunded` 679 笔、`sent` 1486 封、`undone` 29 次、预算拒绝 8 次,这些计数说明每一条路径都真的走到了,「全部成立」不是因为什么都没发生。

有一点要老实说:**这五条不变量没有覆盖到所有我修的 bug。** 把一个退款任务的编号拿去 `send_draft`,第一版会把退款任务当成回复「发出去」,状态变成 `completed` 却没有付一分钱,五条不变量都不会叫,因为 I4 只看终态之后有没有再改,I2 只看付款前有没有批准。它要靠明确的单元测试来抓,练习 3 就是写这几条测试。随机检查和手写测试各有各的盲区,放在一起才够用。

### 零件对照表

| 今天的代码 | 来自哪一天 | 守的规矩 |
| --- | --- | --- |
| `Task.move`、`TERMINAL` | Day 614、616 | 终态不能再改 |
| `Wallet.decide`、`commit` | Day 618 | 先拒绝后问人,判决和记账分开 |
| `Spend` 的 `tx_id` | Day 617、618 | 同一个编号只能付一次 |
| `decide()`、`Level` | Day 619 | 撤不回的动作永远先问人 |
| `INVOICES[...]` 重新查库 | Day 621 | 不信界面传回来的金额 |
| `Ladder`、`wilson_lower` | Day 620 | 放权看下界,不看裸比例 |
| `UndoWindow` | Day 620 | 撤销要真的拿掉 |
| `approver_limit` | Day 621 | 审批权限在服务端判断 |

## 动手练习

### 练习 1:把 ×100 去掉,看哪条不变量会叫

Day 619 的 `decide()` 里金额单位是元,Day 618 的钱包里是分(美分),闸门在 `_spend` 里用 `round(yuan * 100)` 换算。假设有人改代码时把 `* 100` 弄丢了。用 `check_gate.run` 跑一次,说出哪几条不变量会叫、哪几条不会,并解释为什么。

<details>
<summary>参考答案</summary>

不改 `refund_gate.py`,在新文件里把 `Gate._spend` 临时换成少了 `* 100` 的版本,再调检查脚本的 `run`:

```python
# agent-zero-lab/part10/review89/ex622_units.py
"""练习 1:把「元换成分」那个 ×100 去掉,看五条不变量里哪几条会叫。"""
from part10.mandate.wallet_box import Spend
from part10.review89 import check_gate
from part10.review89.refund_gate import INVOICES, Gate


def wrong_spend(self: Gate, refund_id: str, invoice_id: str) -> Spend:
    customer, yuan = INVOICES[invoice_id]
    return Spend(customer, round(yuan), f"refund/{invoice_id}", refund_id, currency="CNY")  # 少了 * 100


Gate._spend = wrong_spend  # type: ignore[method-assign]
check_gate.run(None)
```

<div class="line-notes">

- `def wrong_spend(self: Gate, refund_id: str, invoice_id: str) -> Spend:` 一个假的 `_spend`。第一个参数 `self` 是因为它要被塞进 `Gate` 类里当方法用。
- `return Spend(customer, round(yuan), f"refund/{invoice_id}", refund_id, currency="CNY")  # 少了 * 100` 98 元变成 98 分,980 元变成 980 分。
- `Gate._spend = wrong_spend  # type: ignore[method-assign]` 在类上直接替换方法,Python 允许。`# type: ignore[...]` 是告诉类型检查器「这里我知道在干什么」。
- `check_gate.run(None)` 用没有 bug 的闸门配上这个错的 `_spend`,跑一遍随机检查。

</div>

```bash
uv run python -m part10.review89.ex622_units
```

```text
bug=None  {'steps': 35982, 'refunded': 681, 'sent': 1486, 'undone': 29, 'budget_rejects': 0}
  违反 I3 重复付或金额不是库里的:6494 次,第一次:[('r4', 300)]
```

只有 I3 叫了:`r4` 付出去的是 300,而库里那张发票是 300 元,应该是 30000 分。I1 没叫,而且这是最该关心的地方:`budget_rejects` 变成了 0,因为 1500 元的预算现在是和 15 万「分」比,花出去的数字小了 100 倍,**预算拒绝一次都没有触发**,总额永远不会超过总预算。I1 没抓到是因为「付出去的总额」和「预算」两个数都在同一个错的单位里互相比,没毛病。只有 I3 拿「库里的金额」当外部标准,才抓得到。

小结:单位不一致的 bug,最好有一条不变量把数字和一个**外部的、独立的**真相对一下,光是内部自洽的检查抓不到。

</details>

### 练习 2:额度按客户隔离

现在所有客户共用一个钱包,`acme` 退了 1078 元以后,`bolt` 的 300 元、260 元一起退时只剩 422 元额度,260 元那笔被拒。需求变成「每个客户各自有 1200 元额度」。写一个 `PerCustomerGate`,不改 `Gate` 的其他代码,跑一次对比。

<details>
<summary>参考答案</summary>

`Gate` 里取钱包的地方已经收敛到 `_wallet(customer)` 一个函数,覆盖它就行:

```python
# agent-zero-lab/part10/review89/ex622_per_customer.py
"""练习 2:额度按客户隔离。共用钱包时 acme 的大额退款会吃掉 bolt 的额度;一客户一个钱包就不会。"""
from collections.abc import Callable
from dataclasses import replace

from part10.mandate.wallet_box import Box, Wallet
from part10.review89.refund_gate import Gate


class PerCustomerGate(Gate):
    def __init__(self, box: Box, clock: Callable[[], float], undo_seconds: float = 30) -> None:
        super().__init__(box, clock, undo_seconds)
        self.wallets: dict[str, Wallet] = {}

    def _wallet(self, customer: str) -> Wallet:
        if customer not in self.wallets:
            self.wallets[customer] = Wallet(replace(self.wallet.box))  # 每个客户一份独立的框和独立的账
        return self.wallets[customer]


def run(gate_cls: type[Gate], budget_yuan: int) -> None:
    box = Box(payees=frozenset({"acme", "bolt"}), items=frozenset({"refund/"}), per_payment_max=100_000,
              budget=budget_yuan * 100, expires_at=1e9, ask_above=0, currency="CNY")
    gate = gate_cls(box, clock=lambda: 0.0)
    for rid, inv in [("r1", "INV-0042"), ("r2", "INV-0043"), ("r3", "INV-0050"), ("r5", "INV-0051")]:
        gate.submit_refund(rid, inv)
    out = []
    for rid in ("r1", "r2", "r3", "r5"):
        out.append(f"{rid}={gate.approve_refund(rid, 'approve', 5000).state}")
    print(f"{gate_cls.__name__:<16} 额度 {budget_yuan} 元:{'  '.join(out)}")


run(Gate, 1500)
run(PerCustomerGate, 1200)
```

<div class="line-notes">

- `class PerCustomerGate(Gate):` 子类,只覆盖取钱包的方式。
- `self.wallets: dict[str, Wallet] = {}` 一个字典,客户名对一个钱包。
- `if customer not in self.wallets:` 第一次见到这个客户才建钱包。
- `self.wallets[customer] = Wallet(replace(self.wallet.box))` 用 `dataclasses.replace` 复制一份授权框(`Box` 是 `frozen=True`,不能改,但可以复制),再包成新的 `Wallet`。每个钱包有自己的 `spent` 和 `seen_tx`。
- `def run(gate_cls: type[Gate], budget_yuan: int) -> None:` `type[Gate]` 表示「传进来的是类本身,不是实例」,相当于 TS 里的 `typeof Gate`。
- `for rid, inv in [("r1", "INV-0042"), ("r2", "INV-0043"), ("r3", "INV-0050"), ("r5", "INV-0051")]:` 四笔退款先全提交,再全批准,和演示一样的顺序。
- `out.append(f"{rid}={gate.approve_refund(rid, 'approve', 5000).state}")` 审批人上限给 5000,把二级审批的问题排除,只比钱包。
- `run(Gate, 1500)` 共用一个 1500 元的钱包。
- `run(PerCustomerGate, 1200)` 每个客户 1200 元。

</div>

```bash
uv run python -m part10.review89.ex622_per_customer
```

```text
Gate             额度 1500 元:r1=completed  r2=completed  r3=completed  r5=rejected
PerCustomerGate  额度 1200 元:r1=completed  r2=completed  r3=completed  r5=completed
```

共用钱包时,`acme` 的 1078 元占了额度,`bolt` 的 `r5` 被拒;一客户一个钱包后,`acme` 用掉 1078 元(上限 1200),`bolt` 用掉 560 元,互不影响。Day 584 讲的「吵闹的邻居」就是这个问题的平台版。

</details>

### 练习 3:把我修的几处 bug 写成测试

写三条 pytest:同一个回复编号再来不能把已完成的任务重置;退款任务不能被当成回复发送;回复任务不能被当成退款批准。对着第一版闸门应该三条全红,对着现在的版本全绿。

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part10/review89/test_refund_gate.py
"""练习 3:三条测试。对着 v1(没有去重和类型检查)红,对着现在的版本绿。"""
import pytest

from part10.mandate.wallet_box import Box
from part10.review89.refund_gate import Gate


def make() -> Gate:
    box = Box(payees=frozenset({"acme", "bolt"}), items=frozenset({"refund/"}), per_payment_max=100_000,
              budget=150_000, expires_at=1e9, ask_above=0, currency="CNY")
    return Gate(box, clock=lambda: 0.0)


def test_same_reply_id_does_not_reset_a_finished_task() -> None:
    g = make()
    g.send_reply("m1")
    g.send_draft("m1")
    assert g.tasks["m1"].state == "completed"
    g.send_reply("m1")  # 同一个编号再来
    assert g.tasks["m1"].state == "completed"
    assert g.sent == ["m1"]


def test_refund_task_cannot_be_sent_as_a_reply() -> None:
    g = make()
    g.submit_refund("r1", "INV-0042")
    with pytest.raises(ValueError):
        g.send_draft("r1")
    assert g.sent == []


def test_reply_task_cannot_be_approved_as_a_refund() -> None:
    g = make()
    g.send_reply("m1")
    with pytest.raises(ValueError):
        g.approve_refund("m1", "approve", 5000)
    assert g.refunded == []
```

<div class="line-notes">

- `def make() -> Gate:` 每条测试自己造一个干净的闸门,互相不影响。
- `def test_same_reply_id_does_not_reset_a_finished_task() -> None:` 第一条:先起草、点发送,任务 `completed`,再用同一个编号起草一次。
- `g.send_draft("m1")` 客服点了发送,任务进了终态。
- `assert g.tasks["m1"].state == "completed"` 再来一次之后状态还是 `completed`。第一版这里变成了 `input-required`。
- `assert g.sent == ["m1"]` 只发过一次。
- `with pytest.raises(ValueError):` 第二条:预期下面这一行会抛 `ValueError`,没抛就算失败。
- `g.send_draft("r1")` 把一个退款任务的编号当回复发送。第一版会直接「发出去」,而且把退款任务标成 `completed`。
- `assert g.sent == []` 没有任何东西被发出去。
- `g.approve_refund("m1", "approve", 5000)` 第三条:拿回复任务的编号去批退款。第一版会因为 `INVOICES[""]` 抛出 `KeyError`,不是 `ValueError`,所以 `pytest.raises(ValueError)` 也算红。

</div>

```bash
uv run pytest part10/review89 -q
```

```text
...                                                                      [100%]
3 passed in 0.02s
```

把闸门文件临时换成第一版(没有去重、没有 `kind` 检查)再跑,三条全红:

```text
FAILED part10/review89/test_refund_gate.py::test_same_reply_id_does_not_reset_a_finished_task
FAILED part10/review89/test_refund_gate.py::test_refund_task_cannot_be_sent_as_a_reply
FAILED part10/review89/test_refund_gate.py::test_reply_task_cannot_be_approved_as_a_refund
3 failed in 0.06s
```

第三条红的原因是 `KeyError: ''`:第一版的 `approve_refund` 没挡住回复任务,走到 `INVOICES[invoice_id]` 时 `invoice_id` 是空串。这个报错信息不好看,但比悄悄做错事强。换回现在的版本全绿。

</details>

**验收标准:** `check_wallet` 和 `check_ladder` 的「不一致」都是 0;`check_gate` 在没有 bug 时五条不变量全部成立,加 `--bug early` 和 `--bug fakeundo` 分别被 I2 和 I5 抓到;`pytest part10/review89` 三条全绿;能不看文章说出五条不变量各守哪一天的规矩。

## 本周错题与坑清单

| 天 | 坑 | 怎么避 |
| --- | --- | --- |
| 616 | 认证后端里 `return None` 当拒绝,Starlette 把它当匿名用户放行 | 抛 `AuthenticationError`,配 `on_error` 返回 401 |
| 616 | 身份对、数据错:替用户办事时没校验归属 | 每次取数据都按调用方过滤,`onBehalfOf` 是约定不是标准 |
| 616 | 签名通过就信名片 | 公钥不能从名片同一个域名下载 |
| 617 | 照 2025 年 x402 教程写,头叫 `X-PAYMENT` | v2 叫 `PAYMENT-SIGNATURE`,看教程日期 |
| 617 | 「先查后改」不加锁,并发请求兑现多次 | 一次性凭证的查和用必须原子 |
| 618 | 签名都对,决定不是用户的 | 授权框把「用户确认过买什么」也写进去 |
| 618 | 批准当成覆盖,预算不够用户点了也没用 | 批准回答「要不要问」,推翻不了「不能花」 |
| 619 | 信任规则放在 `decide()` 最前面,批量邮件被放行 | 硬约束在前,放权在最后 |
| 619 | 让模型报置信度当透明度 | 让模型说具体缺什么,依据由代码从调用记录里生成 |
| 620 | 撤销只返回 `True`,没有真拿掉 | 撤销必须改状态,第二次撤返回 `False` |
| 620 | 用裸比例升级,样本少就升了 | 看 Wilson 下界,降级也看下界 |
| 621 | 写库的工具收界面传回来的金额 | 只收编号和决定,金额按编号重新查库 |
| 621 | 把 `visibility: ["app"]` 当权限控制 | 授权在服务端做 |
| 今天 | 元和分混用 | 换算放在一个函数里,加一条用外部真相对账的不变量 |
| 今天 | 同一个编号再来,新对象覆盖旧对象 | 凡是有终态的对象,创建前先查是不是已经存在 |
| 今天 | 只有随机检查,没有手写测试 | 两者盲区不同,都要 |

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 不变量 | 不管怎么操作都必须成立的规则。比如「付出去的总额不超过预算」。把它写成能自动检查的代码,再用随机操作去撞,比手工想例子更容易找到漏洞 |
| 随机检查 | 用随机生成的输入反复跑,检查某个性质成立,而不是给定一个输入断言一个输出。固定随机种子就能复现。英文常叫 property-based testing |
| 变异(mutant) | 故意把代码改坏一点,看检查能不能发现。检查抓不到的变异,说明检查本身有盲区 |
| 默写 | 合上文章凭记忆写代码。不是为了背,是为了暴露哪一段你其实没懂 |
| 终态 | 任务不会再变的状态,本周的四个是 completed、failed、canceled、rejected(Day 614) |
| 软规则、硬规则 | 授权框里「不过就拒绝」的是硬规则,「不过就回去问人」的是软规则(Day 618) |
| 放权梯子 | 按统计数据决定一个动作能不能从「先问」升到「先做」的规则,升降都看置信区间下界(Day 620) |
| 撤销窗口 | 动作先排队、窗口期内能撤、到期才真正执行(Day 620) |

## 常见误区

**以为默写版和原版结果一致,原版就没问题。** 默写检查只证明「抄对了」,不证明「原版对」。Day 615 的复习里就有过:默写版和原版行为一致,但原版有 bug。所以今天还要加上不变量检查,它不拿原版当标准,拿规矩当标准。

**检查脚本一次通过就放心。** 要看随机数据有没有真的走到每条分支:`approve` 553 笔、`ask_user` 1022 笔、升级 1007 次、降级 273 次、`budget_rejects` 8 次,这些计数都不是零,「全部成立」才有分量。

**只靠随机检查。** 今天把退款任务当回复发送那个 bug,五条不变量一条都没叫,是手写测试抓到的。

**换成假的时钟,就忘了真时钟下会不会出问题。** 闸门里所有时间都从 `clock` 来,单元测试和随机检查才能拨时间。Day 620 用真时钟再跑过一遍,闸门没有,真要上线前也得补这一步。

**把本周的东西当成 A2A 或 x402 的一部分。** 授权框、分级、放权梯子都是我们自己的代码,协议本身不管。协议只告诉你「怎么交换消息、怎么证明是谁」,「该不该做」是应用自己的事。

**复习日只看不写。** 今天 2000 轮随机检查,我是在写小项目的时候才发现 `send_reply` 有洞的。只看文章,永远发现不了。

## 学习资料

### 文档与文章

- [A2A 规范](https://a2a-protocol.org/latest/specification/):回头看任务状态和 Agent Card 两节,对照今天用的五个状态名,20 分钟。英文。
- [AP2 规范(仓库里的 specification.md)](https://github.com/google-agentic-commerce/AP2/blob/main/docs/ap2/specification.md):想补 mandate 的细节,重读 `Verification` 一节,验证方要做哪几件事,30 分钟。英文。
- [Levels of Autonomy for AI Agents(arXiv 2506.12469)](https://arxiv.org/abs/2506.12469):五级自主程度的原文,再读一遍各级定义,对照今天 `decide()` 的四个问题,40 分钟。
- [Binomial proportion confidence interval(维基百科)](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval):Wilson 区间那一节,看它和裸比例在小样本时的差别,20 分钟。
- [Hypothesis 文档](https://hypothesis.readthedocs.io/):Python 里正经的随机检查工具,今天手写的 `check_*.py` 就是它的简化版。看首页的介绍,15 分钟。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1xNmzBuE1M&autoplay=0&high_quality=1" title="智能体支付—— Agent 经济真正开始的地方" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>灵机一物 · 智能体支付—— Agent 经济真正开始的地方 · 7 分钟,2025 年 12 月的入门概览,复习支付两天时重新看一遍。细节以 Day 617、618 的文章为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ETfABHE7b&autoplay=0&high_quality=1" title="【Web杂谈18】一次性搞懂 Gen UI、A2UI 和 AG-UI" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>捣鼓键盘的小麦 · 【Web杂谈18】一次性搞懂 Gen UI、A2UI 和 AG-UI · 5 分钟,Day 621 的短复习。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Qf3V-oPfE8E" title="Designing AI-Native Product Experiences: The Autonomy Dial Framework" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Databricks Events · Designing AI-Native Product Experiences: The Autonomy Dial Framework · 讲怎么在产品里设计一个「自主程度旋钮」,对照 Day 619、620 的分级和放权梯子看。英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 10 章后半部分讲用户反馈的设计和收集,放权梯子里的原样发送率、撤销率就是这一类信号。英文原版。
- Ben Shneiderman《Human-Centered AI》(Oxford University Press, 2022):书里主张高人类控制和高自动化可以同时成立,和「按动作分级」的思路对得上。英文原版。

### 开源项目与代码

- [a2aproject/a2a-python](https://github.com/a2aproject/a2a-python):回头看它的任务状态和终态检查是怎么写的,和今天的 `Task.move` 对照,30 分钟。
- [x402-foundation/x402](https://github.com/x402-foundation/x402):看 facilitator 怎么处理 nonce 的「用一次就作废」,和今天 `seen_tx` 对照。
- [HypothesisWorks/hypothesis](https://github.com/HypothesisWorks/hypothesis):看 `stateful` 测试那一块,它能自动生成「一串操作」,今天 `check_gate.py` 手写的随机操作序列就是它做的事。

## 自测

1. 钱包授权框里,为什么「收款方不在名单」要排在「商品没确认过」前面?
2. 放权梯子升级时为什么看下界而不是裸比例?`wilson_lower(20, 20)` 是多少、说明什么?
3. 闸门里钱包为什么要判两次(提交一次,批准一次)?只判一次会出什么事?
4. 今天的随机检查没抓到「退款任务被当回复发送」,为什么?该用什么抓?
5. 面试题:你的 Agent 要给客户退款,怎么设计「它不会越权花钱」?

<details>
<summary>答案</summary>

1. 因为硬规则先于软规则。一笔花费如果收款方就不对,它根本不可能被批准,这时候去问用户「你是不是要买这个」没有意义,还会让用户以为点了「是」就能付。硬规则不过就直接拒绝,软规则不过才回去问人。
2. 样本少时裸比例会骗人。真实只有 85% 的类别,8 周内按裸比例每 4 个就有 1 个被误升级(Day 620 实测 260/1000),按下界只有 1 个。`wilson_lower(20, 20)` 是 0.839,20 次全对也只敢说「至少 83.9%」。
3. 提交时只是问「能不能」,没有记账;批准之前别的退款可能已经把额度花掉了。只判一次,今天演示里的 `r5` 就会在 1378 元已花的情况下再退 260 元,超出 1500 元的总预算。第二次判决必须在 `commit` 之前。
4. 五条不变量看的是「状态有没有被破坏」和「钱有没有多付」,退款任务被当回复「发出去」时,任务被标成 `completed` 但没付钱,既没破坏终态规则也没多付钱,不变量不会叫。要靠针对性的单元测试(练习 3)。两种检查盲区不同,都要。
5. 参考骨架:钱的规则写在确定性的代码里,不交给模型判断(授权框:收款方白名单、单笔上限、总预算、重复交易号、过期);撤不回来的动作永远先问人,审批只收「编号加决定」,金额由服务端重新查库;审批权限分级(卡片审批、二级审批),上限在服务端判断;批准时钱包再判一次;任务状态用终态保护,同一个编号去重;最后用不变量加随机操作验证,并且手写测试覆盖已知坑。

</details>

## 明天预告

[Day 623](/blog/agent-zero/day-623-tech-selection/) · 前沿技术选型报告:打分矩阵和敏感性分析。这周学的东西,每一样单独都能写成一份「我们也该做」的提案,可是团队的人手和预算有限。明天讲怎么把「该不该做」写成一份别人能审、能反驳、半年后能复盘的报告,用加权打分矩阵比较选项,再用敏感性分析看结论有多脆弱。

