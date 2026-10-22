---
title: 'Day 643 · 第 92 周复习:进阶(Day 637–642)'
description: '这一周前半段给 AgentOps 做安全加固、压测和作品包装,后半段转到设计文档、立项测算和 Staff 系统设计。今天不学新东西:画一张知识地图把六天串起来,默写 roi.py 的 monthly() 和三层权限的 decide(),用检查脚本证明默写对了,再拼一个只用本周知识的「成本估算一节生成器」。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'staff-engineer', 'python', 'agent-zero']
series: 'agent-zero'
day: 643
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 642](/blog/agent-zero/day-642-staff-sd-1/) 用 45 分钟框架完整答了一道「设计企业级 Agent 平台」:估算出 289 QPS 不是决定架构的数,真正决定架构的是 15 个团队共用一个 2500 的并发池和每月约 82 万的模型费;深挖时用三层权限取交集回应两次 prompt injection 事故;最后让模型扮演面试官追问,它一上来就盯住了「你这两个数是怎么来的」。

这一周的六天看起来跨度很大,前三天还在写 AgentOps 的代码,后三天已经在写文档、算账、练面试。其实它们是一条线:先把系统做扎实,再把它讲清楚、算清楚、推出去。今天把这条线画出来,把最容易写错的两段代码默写一遍。

## 今天要解决的问题

复习日不加新概念。今天结束时你应该能:

1. 不看文章画出本周知识地图,说出每一天解决的是「做」「讲」「算」「答」里的哪一件,以及它和前后几天怎么接上。
2. 默写 [Day 641](/blog/agent-zero/day-641-build-vs-buy/) 的 `monthly()` 和 [Day 642](/blog/agent-zero/day-642-staff-sd-1/) 的 `decide()`,并用两个检查脚本证明默写版和原版在几百组输入上结果一致。
3. 跑通本周小项目 `part10/review92.py`:用回本测算、利特尔定律、按钱熔断三样东西生成设计文档里「成本估算」那一节,再用 [Day 640](/blog/agent-zero/day-640-design-docs-1/) 的 `doc_lint.py` 检查每个数字都标了来源。
4. 解释本周三个最容易犯的错:拿 QPS 直接和并发上限比、权限用并集代替交集、审计哈希链以为能防删尾巴。

预计用时 3 到 4 小时,大头在默写和练习。前置:[Day 637](/blog/agent-zero/day-637-agentops-sec/) 到 [Day 642](/blog/agent-zero/day-642-staff-sd-1/) 全部。

学法和平时一样:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

先看全貌。我把六天按「做 → 讲 → 算 → 答」排成一行,下面一行是每一天留下来、后面还会反复用到的那一样东西:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="第 92 周知识地图:做、讲、算、答四段,对应 Day 637 到 642">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">第 92 周:从把系统做扎实,到把它讲清楚</text>
<rect x="20" y="40" width="190" height="110" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="115" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">做:AgentOps 收尾</text>
<text x="32" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">637 安全五层</text>
<text x="32" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">638 压测与容量</text>
<text x="32" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">639 五秒跑起来</text>
<rect x="230" y="40" width="120" height="110" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="290" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">讲:文档</text>
<text x="242" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">640 取舍四要素</text>
<text x="242" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">640 ADR</text>
<text x="242" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">640 评审三类</text>
<rect x="370" y="40" width="120" height="110" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="430" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">算:立项</text>
<text x="382" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">641 回本周期</text>
<text x="382" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">641 交叉点</text>
<text x="382" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">641 敏感性</text>
<rect x="510" y="40" width="110" height="110" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="565" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">答:面试</text>
<text x="520" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">642 七维度</text>
<text x="520" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">642 45 分钟</text>
<text x="520" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">642 三层权限</text>
<line x1="210" y1="95" x2="230" y2="95" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="350" y1="95" x2="370" y2="95" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="490" y1="95" x2="510" y2="95" stroke="var(--ink-soft)" stroke-width="1.5"/>
<rect x="20" y="190" width="190" height="46" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="115" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">在途 = 到达速率 × 耗时</text>
<text x="115" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">哈希链 / 按钱熔断</text>
<rect x="230" y="190" width="120" height="46" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="290" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">doc_lint.py</text>
<text x="290" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">预期/实测/假设</text>
<rect x="370" y="190" width="120" height="46" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="430" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">roi.py</text>
<text x="430" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">monthly()</text>
<rect x="510" y="190" width="110" height="46" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="565" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">tool_permission</text>
<text x="565" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">decide()</text>
<line x1="115" y1="150" x2="115" y2="190" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="290" y1="150" x2="290" y2="190" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="430" y1="150" x2="430" y2="190" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="565" y1="150" x2="565" y2="190" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="320" y="272" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">下面一行是今天默写和小项目要用的零件</text>
</svg>
<figcaption>本周知识地图。上面一行是四件事,下面一行是每件事留下的可复用零件。小项目 review92.py 会把下面四个零件里的三个拼在一起。</figcaption>
</figure>

图里有一个关系值得单独说一句:前三天和后三天不是两件事。[Day 642](/blog/agent-zero/day-642-staff-sd-1/) 真题一的标准答案,就是你在 [Day 626](/blog/agent-zero/day-626-agentops-gw-1/) 到 [Day 639](/blog/agent-zero/day-639-agentops-showcase/) 亲手做的 AgentOps;估算里用的利特尔定律是 [Day 638](/blog/agent-zero/day-638-agentops-load/) 压测时学的;面试官最爱追问的「出了事怎么查」,答案是 [Day 637](/blog/agent-zero/day-637-agentops-sec/) 的审计哈希链。资深面试里讲得最有底气的,永远是自己做过的那部分。

## 本周每天一句话

- [Day 637](/blog/agent-zero/day-637-agentops-sec/) · 安全加固:平台的攻击面按五层防,不靠模型的租户隔离测试、工具定义指纹防偷换、审计日志哈希链防篡改、按钱熔断防刷钱、promptfoo 红队进 CI。
- [Day 638](/blog/agent-zero/day-638-agentops-load/) · 压测和容量:压网关不打真模型,先剖析 CPU 花在哪,再用利特尔定律「在途请求 = 到达速率 × 停留时间」把压测数字串成容量规划。
- [Day 639](/blog/agent-zero/day-639-agentops-showcase/) · 作品包装:评审打开仓库五秒钟内要能跑起来,README 第一屏放问题、架构、关键数字和已知局限。
- [Day 640](/blog/agent-zero/day-640-design-docs-1/) · 设计文档:取舍写成同一组维度的表,约束在前、承认代价、写推翻条件;数字一律标「预期 / 实测 / 假设」;评审意见分成事实错误、方案分歧、需要升级三类处理。
- [Day 641](/blog/agent-zero/day-641-build-vs-buy/) · 立项:回本周期 = 一次性投入 ÷ 每月净收益;自建和购买的交叉点约 4,984 张/月;敏感性分析发现最要命的假设是人工处理一张工单的分钟数。
- [Day 642](/blog/agent-zero/day-642-staff-sd-1/) · Staff 系统设计:找到「决定架构的那个数」,主动挑最难的三点深挖,讲取舍和演进;三层权限取交集让被注入的 Agent 最多只能做当前用户本来就能做的事。

六句话里有一个反复出现的动作:**把一个模糊的判断变成一个能算、能查的东西**。安全变成五个能跑的测试,性能变成一条公式,「值不值得做」变成一个 dataclass,「面试答得好不好」变成七个维度的分数。这就是资深工程师和中级工程师在工作方式上最大的差别,后面两周还会一直用到。

## 准备环境

今天所有脚本都放在 `agent-zero-lab/part10/` 里,和 [Day 640](/blog/agent-zero/day-640-design-docs-1/) 到 [Day 642](/blog/agent-zero/day-642-staff-sd-1/) 的脚本放在一起,只用标准库,不需要 `uv add` 新东西,也不调模型,今天一分钱不花。

先确认这几个前几天建的文件都在,而且能跑:

```bash
cd ~/agent-zero-lab        # 换成你自己的练习仓库路径
ls part10/roi.py part10/tool_permission.py part10/doc_lint.py
uv run python -m part10.roi
```

```text
part10/doc_lint.py
part10/roi.py
part10/tool_permission.py
省下: ¥20,700
花掉: ¥13,173
其中答错: ¥4,800
净收益: ¥7,527
回本: 8.0 个月
自动解决率只有 20% 时:回本 22.0 个月
```

`roi.py` 是 [Day 641](/blog/agent-zero/day-641-build-vs-buy/) 建的,`tool_permission.py` 是 [Day 642](/blog/agent-zero/day-642-staff-sd-1/) 建的,`doc_lint.py` 是 [Day 640](/blog/agent-zero/day-640-design-docs-1/) 建的。哪个没有,回到那一天把它敲出来再继续,今天的检查脚本要拿它们当「标准答案」。

## 默写一:回本测算 `monthly()`

先合上 Day 641,新建 `part10/recall_roi.py`,只默写 `monthly()` 一个函数。`Assumptions` 那个 dataclass 有十二个字段,背下来意义不大,直接从原文件导入。下面是我默写的版本,你默写完再对照:

```python
# agent-zero-lab/part10/recall_roi.py
from part10.roi import Assumptions

def monthly(a: Assumptions) -> dict[str, float]:
    per_min = a.wage_per_hour / 60
    saved_auto = a.tickets * a.auto_rate * a.human_minutes * per_min
    saved_draft = a.tickets * a.draft_rate * (a.human_minutes - a.draft_minutes) * per_min
    model = a.tickets * a.model_per_ticket
    errors = a.tickets * a.auto_rate * a.error_rate * a.error_cost
    spend = model + a.infra + a.maintain + errors
    saved = saved_auto + saved_draft
    return {"省下": saved, "花掉": spend, "其中答错": errors, "净收益": saved - spend}
```

<div class="line-notes">

- `from part10.roi import Assumptions` 只导入 dataclass,不导入原版的 `monthly`,不然默写就没意义了。用 `python -m part10.xxx` 方式运行时,`agent-zero-lab/` 是 import 的根,所以写 `part10.roi`。
- `per_min = a.wage_per_hour / 60` 时薪换成每分钟人力成本。基准假设 60 元/小时,所以是 1 元/分钟。
- `saved_auto = a.tickets * a.auto_rate * a.human_minutes * per_min` 完全自动解决省下的钱:`3000 × 0.4 × 12 × 1 = 14,400`。
- `saved_draft = a.tickets * a.draft_rate * (a.human_minutes - a.draft_minutes) * per_min` 起草的那部分,人还要花 5 分钟审,所以每张只省 `12 − 5 = 7` 分钟:`3000 × 0.3 × 7 × 1 = 6,300`。默写时最容易把括号漏掉,写成 `a.human_minutes - a.draft_minutes * per_min`,在 `per_min = 1` 时结果碰巧一样,换个时薪就错了。
- `model = a.tickets * a.model_per_ticket` 模型费 `3000 × 0.0244 = 73.2`,整张账里的零头。
- `errors = a.tickets * a.auto_rate * a.error_rate * a.error_cost` 答错的损失只按自动解决的那部分算,因为起草的有人审过:`3000 × 0.4 × 0.02 × 200 = 4,800`。
- `spend = model + a.infra + a.maintain + errors` 花掉的四项:`73 + 800 + 7500 + 4800 = 13,173`。我第一次默写就漏了 `errors`,下面的检查脚本当场抓到。
- `saved = saved_auto + saved_draft` 原版是在 return 里写两遍加法,我默写时提出来一个变量,读起来清楚些。结果一样,这种改写是允许的,检查只比结果。
- `return {"省下": saved, "花掉": spend, "其中答错": errors, "净收益": saved - spend}` 四个键的名字要和原版一模一样,检查脚本按键对比。

</div>

光看不够,得用脚本证明它对。思路是随机生成 200 组假设,每组分别喂给原版和默写版,四个结果逐一比较。这种「拿一个已知正确的实现当裁判」的测法,你在 [Day 637](/blog/agent-zero/day-637-agentops-sec/) 写隔离测试时见过类似的想法:不靠眼睛看,靠大量输入去撞。

```python
# agent-zero-lab/part10/check_recall_roi.py
import random
from dataclasses import replace

from part10 import recall_roi, roi

random.seed(643)
base = roi.Assumptions()
bad = 0
for i in range(200):
    a = replace(base,
                tickets=random.randint(500, 20000),
                human_minutes=random.uniform(4, 20),
                auto_rate=random.uniform(0.1, 0.6),
                error_cost=random.uniform(50, 500))
    want, got = roi.monthly(a), recall_roi.monthly(a)
    for key in want:
        if abs(want[key] - got.get(key, float("nan"))) > 1e-6:
            bad += 1
            if bad <= 3:
                print(f"第 {i} 组 {key}:原版 {want[key]:,.2f},默写版 {got.get(key, float("nan")):,.2f}")
print("200 组随机假设全部一致" if bad == 0 else f"有 {bad} 处不一致")
```

<div class="line-notes">

- `import random` Python 自带的随机数模块。`random.randint(a, b)` 给 a 到 b 之间的整数(两头都包含),`random.uniform(a, b)` 给 a 到 b 之间的小数,相当于 JS 里 `Math.random()` 再自己缩放。
- `from dataclasses import replace` [Day 641](/blog/agent-zero/day-641-build-vs-buy/) 学的:复制一个实例并改几个字段,≈ `{...base, tickets: 1234}`。
- `from part10 import recall_roi, roi` 把两个模块整个导入,用的时候写 `roi.monthly` 和 `recall_roi.monthly`,名字不会撞。
- `random.seed(643)` 固定随机种子,每次跑生成的 200 组数完全一样,结果可以复现。不固定的话,一个偶发的不一致你下次就复现不出来了。
- `a = replace(base,` 每组只随机改四个最常被追问的字段:工单量、人工分钟数、自动解决率、答错损失。其余字段保持基准值。
- `tickets=random.randint(500, 20000),` 工单量在 500 到 2 万之间。
- `want, got = roi.monthly(a), recall_roi.monthly(a)` 同时算两份,≈ JS 的 `const [want, got] = [f(a), g(a)]`。
- `if abs(want[key] - got.get(key, float("nan"))) > 1e-6:` 浮点数不能用 `==` 比,两个算法加法顺序不同时可能差最后几位,所以允许 `0.000001` 以内的误差。`got.get(key, float("nan"))`:默写版要是漏了某个键,取到的是 NaN(不是一个数),NaN 和任何数比较都是 False,`abs(...) > 1e-6` 也是 False,这一行会悄悄放过它。所以严格来说还要单独检查键齐不齐,练习 4 会处理这个漏洞。
- `if bad <= 3:` 不一致的地方只打印前三处,其余只计数,免得刷屏。
- `{got.get(key, float("nan")):,.2f}` f-string 里的表达式可以带双引号,这是 Python 3.12 才允许的写法,3.11 及以前要换成单引号。我们用的是 3.12,没问题。

</div>

```bash
uv run python -m part10.check_recall_roi
```

```text
200 组随机假设全部一致
```

为了确认这个检查脚本真能抓错,我把默写版里 `spend` 那一行的 `+ errors` 删掉(这正是我第一次默写时犯的错),再跑一次:

```text
第 0 组 花掉:原版 45,104.06,默写版 8,752.42
第 0 组 净收益:原版 200,252.05,默写版 236,603.68
第 1 组 花掉:原版 15,632.06,默写版 8,470.90
有 400 处不一致
```

200 组里每组都错了两个键(「花掉」和「净收益」),所以是 400 处。第 0 组的工单量比较大,漏掉的答错损失有三万多,净收益被高估了 18%。这就是 [Day 641](/blog/agent-zero/day-641-build-vs-buy/) 说「答错的损失这一行经常被忘掉」的意思:漏了它,账永远偏乐观,而且偏得不少。

检查完记得把默写版里的 `+ errors` 补回去,再跑一次确认回到「全部一致」。

## 默写二:三层权限 `decide()`

第二段默写 [Day 642](/blog/agent-zero/day-642-staff-sd-1/) 的权限决策。三张权限表和写操作集合直接从原文件导入,只默写函数本身。新建 `part10/recall_perm.py`:

```python
# agent-zero-lab/part10/recall_perm.py
from part10.tool_permission import AGENT_DECLARED, TENANT_ALLOWED, USER_GRANTED, WRITE_TOOLS

LIMIT = 100

def decide(tenant: str, agent: str, user: str, tool: str, amount: float = 0) -> str:
    allowed = TENANT_ALLOWED[tenant] & AGENT_DECLARED[agent] & USER_GRANTED[user]
    if tool not in allowed:
        return "拒绝"
    if tool in WRITE_TOOLS and amount >= LIMIT:
        return "等人工确认"
    return "放行"
```

<div class="line-notes">

- `from part10.tool_permission import AGENT_DECLARED, TENANT_ALLOWED, USER_GRANTED, WRITE_TOOLS` 一次导入四个名字。这几张表是「数据」,不是今天要背的逻辑。
- `LIMIT = 100` 原版叫 `AUTO_APPROVE_LIMIT`,我默写时换了个短名字,值必须一样:100 元。
- `allowed = TENANT_ALLOWED[tenant] & AGENT_DECLARED[agent] & USER_GRANTED[user]` 三层取交集,`&` 是集合交集。代入 bob:`{search_kb, get_invoice, refund, send_email} & {search_kb, get_invoice, refund, delete_customer} & {search_kb}` 只剩 `{search_kb}`。
- `if tool not in allowed:` 不在交集里就拒绝。这一行写在最前面,是「默认拒绝」:没有明确允许的,一律不行。
- `if tool in WRITE_TOOLS and amount >= LIMIT:` 是写操作并且金额到了阈值就停下等人。注意是 `>=`,正好 100 元也要等确认。
- `return "放行"` 剩下的都放行:读操作,或者金额低于阈值的写操作。

</div>

检查脚本这次不用随机数,因为输入空间很小:2 个用户 × 5 个工具 × 4 个金额,一共 40 种组合,可以全部列出来挨个比。金额特意挑了 `99.99`、`100` 这种贴着阈值的值,边界最容易错。

```python
# agent-zero-lab/part10/check_recall_perm.py
from itertools import product

from part10 import recall_perm, tool_permission

users = ["alice", "bob"]
tools = ["search_kb", "get_invoice", "refund", "send_email", "delete_customer"]
amounts = [0, 99.99, 100, 500]
diff = 0
for user, tool, amount in product(users, tools, amounts):
    want = tool_permission.decide("billing-team", "refund-agent", user, tool, amount)
    got = recall_perm.decide("billing-team", "refund-agent", user, tool, amount)
    if want != got:
        diff += 1
        print(f"{user} {tool} {amount}:原版 {want},默写版 {got}")
total = len(users) * len(tools) * len(amounts)
print(f"{total} 个组合,{diff} 个不一致")
```

<div class="line-notes">

- `from itertools import product` `itertools` 是标准库里专门处理「一串东西」的工具箱。`product` 是笛卡尔积:把几个列表的每种搭配都列出来,相当于 JS 里写三层嵌套 `for` 循环。
- `amounts = [0, 99.99, 100, 500]` 0 是读操作的典型值,`99.99` 和 `100` 夹住阈值,500 是明显的大额。
- `for user, tool, amount in product(users, tools, amounts):` 第一轮是 `("alice", "search_kb", 0)`,最后一轮是 `("bob", "delete_customer", 500)`,一共 `2 × 5 × 4 = 40` 轮。
- `want = tool_permission.decide(` 原版当裁判。
- `if want != got:` 字符串可以直接比,不像浮点数那样要留误差。
- `total = len(users) * len(tools) * len(amounts)` 算出总组合数 40,打印出来确认真的全测了。

</div>

```bash
uv run python -m part10.check_recall_perm
```

```text
40 个组合,0 个不一致
```

同样,故意写错两次,看检查脚本能不能抓到。第一种错:把 `&` 写成 `|`(并集)。这不是我瞎编的错法,第一次学集合运算的人很常把「三层都要允许」理解成「任何一层允许就行」:

```text
alice send_email 0:原版 拒绝,默写版 放行
alice delete_customer 0:原版 拒绝,默写版 放行
bob get_invoice 0:原版 拒绝,默写版 放行
bob refund 0:原版 拒绝,默写版 放行
bob refund 100:原版 拒绝,默写版 等人工确认
bob delete_customer 0:原版 拒绝,默写版 放行
40 个组合,24 个不一致
```

(实际打印了 24 行,上面挑了 6 行。)最吓人的是 `bob refund 0`:没有退款权限的 bob 被放行了。还有 `delete_customer`,这个工具只有 Agent 自己声明了,租户根本没批,用并集就谁都能调。Day 642 整个权限设计的价值,在一个符号上就没了。

第二种错:把 `>=` 写成 `>`。

```text
alice refund 100:原版 等人工确认,默写版 放行
40 个组合,1 个不一致
```

只有一处不一致,正好 100 元的退款被放行了。这种边界错误靠肉眼读代码很难发现,金额列表里要是没有 `100` 这个值,检查脚本也抓不到。**测边界就要把边界值本身放进输入里**,这是写检查脚本最重要的一条习惯。

## 本周小项目:生成「成本估算」一节

默写只是把零件背下来,小项目要把零件拼起来用。场景是这样的:你要给 CloudLedger 客服 Agent 写设计文档,其中「成本估算」那一节要放回本、容量和熔断三类数字。手写的话,改一个假设就要重算一遍,还容易漏标「假设」两个字。写个脚本自动生成,再让 `doc_lint.py` 检查。

它用到本周四天的东西:回本测算来自 Day 641,利特尔定律来自 Day 638(Day 642 估算时又用过一次),按钱熔断来自 Day 637,数字标签和检查器来自 Day 640。按钱熔断的意思再提一句:不只看月度预算,还看「最近一小时花了多少」,超过月预算的一个比例就拒绝新请求,防止有人在一小时里把一个月的钱刷光。

```python
# agent-zero-lab/part10/review92.py
import sys
from pathlib import Path

from part10.doc_lint import lint
from part10.roi import Assumptions, monthly, payback_months

LIMIT = 2500           # deepseek-flash 每账号并发上限,2026-10-22 查
LATENCY_S = 4.0        # 单次调用耗时(假设)
CALLS_PER_TICKET = 3   # 一张工单调几次模型(假设)
WORK_SECONDS = 8 * 3600  # 工单集中在 8 小时工作时间里(假设)
GUARD_FRACTION = 0.05  # 按钱熔断:一小时花费超过月预算 5% 就拒绝

def capacity(a: Assumptions) -> tuple[float, float]:
    qps = a.tickets / 30 * CALLS_PER_TICKET / WORK_SECONDS
    return qps, qps * LATENCY_S

def section(a: Assumptions) -> str:
    m = monthly(a)
    qps, inflight = capacity(a)
    budget = a.tickets * a.model_per_ticket
    return "\n".join([
        "## 成本估算",
        f"- 每月省下 {m['省下']:,.0f} 元,花掉 {m['花掉']:,.0f} 元(假设,算式见 roi.py)。",
        f"- 回本 {payback_months(a):.1f} 个月(假设)。",
        f"- 高峰在途请求 {inflight:.2f} 个,占账号上限 {inflight / LIMIT:.3%}(预期)。",
        f"- 每月模型预算 {budget:,.0f} 元,熔断线每小时 {budget * GUARD_FRACTION:.1f} 元。",
    ])

if __name__ == "__main__":
    tickets = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    text = section(Assumptions(tickets=tickets))
    out = Path("part10/samples/review92.md")
    out.write_text(text + "\n", encoding="utf-8")
    print(text)
    problems = [p for p in lint(out) if p.startswith("[成本估算]")]
    print("\n".join(problems) or "成本估算这一节:每个数字都标了来源")
```

<div class="line-notes">

- `from part10.doc_lint import lint` 复用 Day 640 的检查器。`lint(path)` 返回问题列表,每条以 `[节名]` 开头。
- `from part10.roi import Assumptions, monthly, payback_months` 回本测算三件套,算法只写在 `roi.py` 一处。
- `LIMIT = 2500` deepseek-flash 的账号并发上限,我今天又去 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 核对了一次,还是 2500。
- `WORK_SECONDS = 8 * 3600` 客服工单不是均匀分布在 24 小时里的,假设都挤在 8 小时工作时间。这相当于 Day 642 里的「高峰倍数」,只是换了个说法:24 ÷ 8 = 3 倍。
- `GUARD_FRACTION = 0.05` 熔断比例。月预算的 5% 是多少倍的平均小时花费?按 30 天 × 8 小时 = 240 个工作小时算,平均每小时花月预算的 `1/240 ≈ 0.42%`,5% 大约是平均的 12 倍。所以这条线只拦明显的刷钱,正常高峰撞不到。
- `qps = a.tickets / 30 * CALLS_PER_TICKET / WORK_SECONDS` 每天的工单数乘每张的调用次数,除以 8 小时的秒数:`3000 / 30 × 3 / 28800 ≈ 0.0104` 次/秒。
- `return qps, qps * LATENCY_S` 利特尔定律:在途请求 = 到达速率 × 停留时间,`0.0104 × 4 ≈ 0.04` 个。返回一个元组,调用方用 `qps, inflight = ...` 解构。
- `budget = a.tickets * a.model_per_ticket` 每月模型费当作模型预算:`3000 × 0.0244 = 73.2` 元。
- `return "\n".join([` 把几行拼成一段 markdown,≈ JS 的 `[...].join("\n")`。
- `f"- 每月省下 {m['省下']:,.0f} 元` f-string 外面用双引号,里面取字典键用单引号,两种引号错开。
- `{inflight / LIMIT:.3%}` 百分数保留三位小数。在途请求太小了,`.0%` 会打成 `0%`,看不出量级。
- `f"- 每月模型预算 {budget:,.0f} 元,熔断线每小时` 注意这一行**没有**标「(假设)」。第一版我就是这么写的,下面会看到检查器怎么抓它。
- `tickets = int(sys.argv[1]) if len(sys.argv) > 1 else 3000` 命令行可以传工单量,不传就用 3000。`sys.argv` ≈ Node 的 `process.argv`,但下标 0 是脚本名,不像 Node 那样前面还有一个 node 路径。
- `out.write_text(text + "\n", encoding="utf-8")` `doc_lint.lint` 吃的是文件路径,所以先写到 `part10/samples/review92.md`。
- `problems = [p for p in lint(out) if p.startswith("[成本估算]")]` 这份文件只有一节,`lint` 会报「缺少一节:背景」之类十一条,和今天无关,只留成本估算节的问题。
- `print("\n".join(problems) or "成本估算这一节:每个数字都标了来源")` 列表为空时 `join` 得到空字符串,空字符串是假值,`or` 返回右边那句。

</div>

```bash
uv run python -m part10.review92
```

```text
## 成本估算
- 每月省下 20,700 元,花掉 13,173 元(假设,算式见 roi.py)。
- 回本 8.0 个月(假设)。
- 高峰在途请求 0.04 个,占账号上限 0.002%(预期)。
- 每月模型预算 73 元,熔断线每小时 3.7 元。
[成本估算] 数字没标预期/实测/假设:- 每月模型预算 73 元,熔断线每小时 3.7 元。
```

检查器抓到了最后一行。我把那一行末尾改成 `元(假设)。"`,再跑:

```bash
uv run python -m part10.review92; echo "exit=$?"
```

```text
## 成本估算
- 每月省下 20,700 元,花掉 13,173 元(假设,算式见 roi.py)。
- 回本 8.0 个月(假设)。
- 高峰在途请求 0.04 个,占账号上限 0.002%(预期)。
- 每月模型预算 73 元,熔断线每小时 3.7 元(假设)。
成本估算这一节:每个数字都标了来源
exit=0
```

这份输出本身就值得读一读。**CloudLedger 的在途请求只有 0.04 个,连账号上限的万分之一都不到。** 对比 Day 642 真题一的 1157 个,差了几万倍。这说明同一套估算方法,在不同规模下得出的「决定架构的那个数」完全不同:真题一里是共享并发池,CloudLedger 里并发根本不是问题,决定结论的是 Day 641 敏感性分析找到的「人工处理分钟数」。如果你在 CloudLedger 的设计文档里花一页纸讨论多供应商路由和并发隔离,评审会问你一句「我们一个月才三千张工单,这是在解决什么问题?」

再传一个大一点的工单量试试:

```bash
uv run python -m part10.review92 50000
```

```text
## 成本估算
- 每月省下 345,000 元,花掉 89,520 元(假设,算式见 roi.py)。
- 回本 0.2 个月(假设)。
- 高峰在途请求 0.69 个,占账号上限 0.028%(预期)。
- 每月模型预算 1,220 元,熔断线每小时 61.0 元(假设)。
成本估算这一节:每个数字都标了来源
```

工单量涨到 5 万,在途请求也才 0.69 个。回本 0.2 个月看起来漂亮得不真实,原因是 `roi.py` 里的维护人力和开发成本是固定值,没有随工单量变。一个月 5 万张工单的团队,0.25 个工程师大概不够维护,这时候你要回去改假设,而不是拿着 0.2 个月去找老板。**脚本只负责算对,假设合不合理是你的事。**

### 零件和小项目的对照

| 零件 | 哪天学的 | 在 review92.py 的哪一段 |
| --- | --- | --- |
| `monthly()` / `payback_months()` | Day 641 | `section()` 前两行数字 |
| 利特尔定律 | Day 638、Day 642 | `capacity()` |
| 按钱熔断比例 | Day 637 | `GUARD_FRACTION` 和最后一行 |
| 数字标签和 `lint()` | Day 640 | 主程序最后三行 |

## 本周错题与坑清单

我把这一周文章里写过的坑、我自己实跑时踩的坑,按「下次最可能再犯」排了个序:

| 坑 | 出在哪天 | 一句话怎么避免 |
| --- | --- | --- |
| 拿 QPS 直接和供应商并发上限比 | 642 | 先乘单次耗时换成在途请求,练习 2 会看到差了 4 倍 |
| 权限用并集,或者阈值写成 `>` | 642 | 交集加默认拒绝;边界值放进测试输入 |
| 回本测算漏了答错的损失 | 641 | 花掉四项:模型、基础设施、维护、答错 |
| 只盯模型费讨价还价 | 641 | 模型费 73 元,维护 7,500 元,先看大头 |
| 设计文档里写「很好」「预计」 | 640 | 只用「预期 / 实测 / 假设」三个词,有数字 |
| ADR 先写新文件再找旧文件 | 640 | 所有检查放在写盘之前 |
| 把模型评审的分类当结论 | 640 | 分到哪一类是你的判断 |
| 以为哈希链能防一切篡改 | 637 | 删尾巴和整条重算都查不出,要把链头存到外面 |
| 压测网关时打真模型 | 638 | 用假上游,不然测的是供应商不是你 |
| 面试背逐字稿 | 642 | 准备框架和几个能现场套的取舍 |

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1KL4y1s7jr&autoplay=0&high_quality=1" title="费曼学习法----看似最笨的办法常常是最有效的(附实例)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>曼鱼的视觉笔记 · 费曼学习法----看似最笨的办法常常是最有效的(附实例) · 6 分钟。复习日的默写就是这个思路:能不看原文讲出来、写出来,才算学会。看完试着把本周知识地图讲给一个不懂的人听。</figcaption>
</figure>

## 动手练习

**练习 1:给 Day 642 的审计日志加哈希链。** [Day 642](/blog/agent-zero/day-642-staff-sd-1/) 练习 2 写了 `ex642_audit.py`,每次权限决策追加一行 JSON。它的问题是谁都能改:把 bob 那行的「拒绝」改成「放行」,没人知道。用 [Day 637](/blog/agent-zero/day-637-agentops-sec/) 讲的哈希链思路,写一个只用标准库的版本 `part10/ex643_chain.py`:每行带上前一行的哈希,写一个 `verify()` 找出第一条对不上的行。跑三次决策,先验证一次,再把第 2 行的「拒绝」改成「放行」,再验证一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex643_chain.py
import hashlib
import json
from pathlib import Path

from part10.tool_permission import decide

LOG = Path("part10/samples/audit_chain.jsonl")
GENESIS = "0" * 64

def digest(prev: str, record: dict[str, object]) -> str:
    body = json.dumps(record, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256((prev + body).encode()).hexdigest()

def append(record: dict[str, object]) -> None:
    lines = LOG.read_text(encoding="utf-8").splitlines() if LOG.exists() else []
    prev = json.loads(lines[-1])["hash"] if lines else GENESIS
    row = {**record, "prev": prev, "hash": digest(prev, record)}
    with LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")

def verify() -> int | None:
    prev = GENESIS
    for i, line in enumerate(LOG.read_text(encoding="utf-8").splitlines(), start=1):
        row = json.loads(line)
        record = {k: v for k, v in row.items() if k not in ("prev", "hash")}
        if row["prev"] != prev or row["hash"] != digest(prev, record):
            return i
        prev = row["hash"]
    return None

if __name__ == "__main__":
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text("", encoding="utf-8")
    for user, amount in (("alice", 30), ("bob", 30), ("alice", 500)):
        result = decide("billing-team", "refund-agent", user, "refund", amount)
        append({"user": user, "tool": "refund", "amount": amount, "result": result})
    print("篡改前,第一条对不上的行:", verify())
    lines = LOG.read_text(encoding="utf-8").splitlines()
    lines[1] = lines[1].replace('"拒绝"', '"放行"')
    LOG.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("把第 2 行的拒绝改成放行后:", verify())
```

<div class="line-notes">

- `import hashlib` 标准库的哈希模块。哈希函数把任意长的内容变成一串固定长度的「指纹」,内容改一个字,指纹就完全变了。浏览器里对应的是 `crypto.subtle.digest("SHA-256", ...)`。
- `GENESIS = "0" * 64` 第一行没有「前一行」,约定它的前一个哈希是 64 个 0。SHA-256 的十六进制结果正好 64 个字符。
- `body = json.dumps(record, sort_keys=True, ensure_ascii=False)` `sort_keys=True` 让键按字母排序。同一条记录不管字段写的顺序如何,序列化出来的字符串都一样,哈希才稳定。
- `return hashlib.sha256((prev + body).encode()).hexdigest()` 把「前一行的哈希 + 本行内容」拼起来算 SHA-256。`.encode()` 把字符串转成字节(≈ `new TextEncoder().encode(s)`),`.hexdigest()` 转成十六进制字符串。
- `prev = json.loads(lines[-1])["hash"] if lines else GENESIS` 取最后一行的哈希当这一行的 `prev`。`lines[-1]` 是最后一个元素,≈ JS 的 `lines.at(-1)`。
- `row = {**record, "prev": prev, "hash": digest(prev, record)}` `**record` 展开字典,≈ `{...record, prev, hash}`。哈希只对原始记录算,不包含 `prev` 和 `hash` 自己。
- `for i, line in enumerate(LOG.read_text(encoding="utf-8").splitlines(), start=1):` `start=1` 让行号从 1 开始数,和你用编辑器看到的行号一致。
- `record = {k: v for k, v in row.items() if k not in ("prev", "hash")}` 字典推导式,去掉两个链字段,还原出算哈希时用的那份记录。
- `if row["prev"] != prev or row["hash"] != digest(prev, record):` 两种不对:这一行记的前一个哈希和实际的前一行对不上(中间被插或删了),或者这一行内容被改了、重算出来的哈希和记的不一样。
- `lines[1] = lines[1].replace('"拒绝"', '"放行"')` 模拟篡改:bob 那行原来是「拒绝」。`lines[1]` 是第 2 行,下标从 0 开始。

</div>

```bash
uv run python -m part10.ex643_chain
head -c 230 part10/samples/audit_chain.jsonl
```

```text
篡改前,第一条对不上的行: None
把第 2 行的拒绝改成放行后: 2
{"user": "alice", "tool": "refund", "amount": 30, "result": "放行", "prev": "0000000000000000000000000000000000000000000000000000000000000000", "hash": "e34414abe5ec6f8f8111efbedebebee61468b2862e8fcaccc282de3be674b403"}
```

改了第 2 行,`verify()` 准确指到第 2 行。篡改者改完内容如果顺手把这一行的 `hash` 也重算了,第 3 行的 `prev` 又对不上,还是会被发现;除非他把后面所有行一起重算,这就是下一题要说的局限。

</details>

**练习 2:观察哈希链防不住什么。** 用练习 1 的 `append` 和 `verify`,连写三条记录,把最后一行的哈希(链头)另存一份,然后删掉最后一行,再跑 `verify()`。观察结果,解释为什么 Day 637 要把链头定期存到别的系统里。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex643_tail.py
import json

from part10.ex643_chain import LOG, append, verify

LOG.write_text("", encoding="utf-8")
for amount in (30, 60, 90):
    append({"user": "alice", "tool": "refund", "amount": amount, "result": "放行"})
head = json.loads(LOG.read_text(encoding="utf-8").splitlines()[-1])["hash"]
print("外部存下的链头:", head[:12])

lines = LOG.read_text(encoding="utf-8").splitlines()
LOG.write_text("\n".join(lines[:-1]) + "\n", encoding="utf-8")
print("删掉最后一条后 verify():", verify())

now_head = json.loads(LOG.read_text(encoding="utf-8").splitlines()[-1])["hash"]
print("现在的链头:", now_head[:12], "| 和外部存的一样吗:", now_head == head)
```

<div class="line-notes">

- `from part10.ex643_chain import LOG, append, verify` 直接复用练习 1 的函数。`ex643_chain.py` 的演示代码在 `if __name__ == "__main__":` 下面,导入时不会执行。
- `head = json.loads(LOG.read_text(encoding="utf-8").splitlines()[-1])["hash"]` 最后一行的哈希就是链头。真实系统里这一步是「每小时把链头写到一个你自己也改不了的地方」。
- `LOG.write_text("\n".join(lines[:-1]) + "\n", encoding="utf-8")` `lines[:-1]` 是去掉最后一个元素的切片,≈ `lines.slice(0, -1)`。模拟有人删了最后一条 90 元的退款记录。
- `now_head = json.loads(` 只打印前 12 个字符,够比对就行。

</div>

```bash
uv run python -m part10.ex643_tail
```

```text
外部存下的链头: 03b19f8d4841
删掉最后一条后 verify(): None
现在的链头: 2dd038fe5c3a | 和外部存的一样吗: False
```

删掉最后一条,`verify()` 返回 `None`,链内部完全没有破绽,因为剩下两行的哈希都是自洽的。只有拿外部存下来的链头一比,才发现链尾对不上。同理,有写权限的人把整条链从头重算一遍,内部验证也会通过。所以哈希链证明的是「链内部一致」,要证明「没被删、没被整条重写」,必须有一个篡改者够不着的外部链头。面试时被问「审计日志怎么防篡改」,这一层局限要主动说出来。

</details>

**练习 3:复习利特尔定律,看错误的比法差多少。** 写 `part10/ex643_littles.py`,用 Day 642 真题一的数(日调用 500 万,账号上限 2500),对三种「高峰倍数、单次耗时」组合 (5, 4)、(5, 10)、(8, 10),分别算「错的比法」(高峰 QPS ÷ 2500)和「对的比法」(高峰 QPS × 耗时 ÷ 2500)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex643_littles.py
LIMIT = 2500
avg_qps = 5_000_000 / 86_400

for factor, latency in [(5, 4), (5, 10), (8, 10)]:
    peak = avg_qps * factor
    wrong = peak / LIMIT
    right = peak * latency / LIMIT
    print(f"高峰 {peak:.0f} QPS、每次 {latency} 秒:错的比法 {wrong:.0%},对的比法 {right:.0%}")
```

<div class="line-notes">

- `avg_qps = 5_000_000 / 86_400` 平均 57.9 QPS。
- `wrong = peak / LIMIT` 把「每秒多少个请求」和「同时最多多少个请求」直接相除,单位就不对,一个是「个/秒」,一个是「个」。
- `right = peak * latency / LIMIT` 先乘耗时得到在途请求数,单位变成「个」,再和上限比。

</div>

```bash
uv run python -m part10.ex643_littles
```

```text
高峰 289 QPS、每次 4 秒:错的比法 12%,对的比法 46%
高峰 289 QPS、每次 10 秒:错的比法 12%,对的比法 116%
高峰 463 QPS、每次 10 秒:错的比法 19%,对的比法 185%
```

错的比法永远显示「很宽裕」,而且对耗时完全不敏感:第一行和第二行的错误结果一模一样,都是 12%。可单次耗时从 4 秒变成 10 秒,真实占用从 46% 变成 116%,已经超了。开深度思考的推理模型单次调用十几秒很常见,用错的比法做容量规划,上线第一天就会收到一堆 429。

</details>

**练习 4:补上检查脚本的漏洞。** 默写一的检查脚本有个漏洞:默写版如果漏了某个键,`got.get(key, float("nan"))` 拿到 NaN,`abs(NaN) > 1e-6` 是 False,不会报错。先把 `recall_roi.py` 的返回值里删掉 `"其中答错"` 这个键,验证检查脚本真的没报;再改检查脚本,让它先比较两边的键是否一样。

<details><summary>参考答案</summary>

在 `check_recall_roi.py` 的 `want, got = ...` 那一行后面加三行:

```python
# agent-zero-lab/part10/check_recall_roi.py(在 want, got = ... 之后插入)
    if set(want) != set(got):
        print(f"键不一致:缺 {set(want) - set(got)},多 {set(got) - set(want)}")
        break
```

<div class="line-notes">

- `if set(want) != set(got):` 对字典调 `set()` 得到所有键的集合,两个集合不相等就说明键不一样。
- `print(f"键不一致:缺 {set(want) - set(got)},多 {set(got) - set(want)}")` 集合减法:在左边、不在右边的元素。这里一次说清缺了哪个、多了哪个。
- `break` 键都不对,后面 199 组也不用比了,直接跳出循环。

</div>

我先在没加这三行时删掉 `"其中答错"` 跑了一次,输出是 `200 组随机假设全部一致`,漏洞是真的。加上三行后再跑:

```text
键不一致:缺 {'其中答错'},多 set()
200 组随机假设全部一致
```

第一行抓到了。第二行还是打印「全部一致」,因为 `bad` 没有加一,这是我留给你的第二步:在 `break` 前面加 `bad += 1`,让最后一行变成「有 1 处不一致」。改完把 `"其中答错"` 加回 `recall_roi.py`。这道题想说的是,检查脚本本身也会有 bug,写完要故意喂一个错的实现,看它报不报。

</details>

**验收标准**:能不看文章画出本周知识地图并讲出每天一句话;`recall_roi.py` 和 `recall_perm.py` 是你合上文章默写的,两个检查脚本都打印 0 处不一致;`review92.py` 跑出和文中一致的结果,并能说出为什么 CloudLedger 的在途请求只有 0.04 个;四道练习都跑通,能讲清哈希链防不住的两种情况。

## 名词解释

今天没有新概念,下面是本周最重要的几个词,每个附上第一次出现的那一天。

| 名词 | 意思 |
| --- | --- |
| 利特尔定律 | 在途请求 = 到达速率 × 停留时间,289 QPS × 4 秒 ≈ 1157 个在途,Day 638 |
| 按钱熔断 | 最近一小时花费超过月预算的一个比例就拒绝新请求,防刷钱,Day 637 |
| 哈希链 | 每条记录带上前一条的哈希,改任何一条后面都对不上;链头要存到外部,Day 637 |
| 取舍四要素 | 约束在前、同一组维度比较、承认代价、写推翻条件,Day 640 |
| 回本周期 | 一次性投入 ÷ 每月净收益,CloudLedger 基准是 8 个月,Day 641 |
| 交叉点 | 自建和购买两条月成本曲线相交的工单量,约 4,984 张/月,Day 641 |
| 决定架构的数字 | 估算里一出来就迫使你采用某种设计的数,Day 642 |
| 三层权限交集 | 租户允许、Agent 声明、用户授权三者取交集,不在交集里一律拒绝,Day 642 |
| 裁判实现 | 检查默写时拿一个已知正确的版本当标准答案,大量输入两边对比 |
| 笛卡尔积 | 几个列表所有搭配的组合,`itertools.product`,今天检查权限时用 |

## 常见误区

**复习日只读不写。** 把六篇文章再读一遍,感觉都懂了,第二天让你写 `monthly()` 还是会漏 `errors`。复习的价值在输出:合上文章默写,写错的地方才是你真没掌握的地方。

**默写时连数据也背。** `Assumptions` 的十二个字段、权限表里的工具名,这些是数据,导入就行。要背的是逻辑:净收益由哪几项组成、权限为什么是交集、阈值为什么是 `>=`。

**检查脚本只喂对的实现。** 写完检查脚本跑出「全部一致」,不代表脚本是对的,可能它什么都抓不到。今天每个检查脚本我都故意喂了一个错的实现,练习 4 还真找出了一个漏洞。

**测试输入不含边界值。** 权限检查的金额要是只有 0 和 500,`>` 写成 `>=` 的错误永远测不出来。阈值附近的值,特别是阈值本身,一定要放进输入。

**把真题一的结论套到所有系统上。** 真题一里决定架构的是并发池,CloudLedger 的在途请求只有 0.04 个。估算方法通用,结论要重新算。

**脚本算出来的就当真。** 5 万张工单回本 0.2 个月,是因为维护成本没随规模变。脚本保证算式对,假设合不合理还得你自己判断。

## 学习资料

### 文档与文章

- [Python 文档:hashlib](https://docs.python.org/zh-cn/3.12/library/hashlib.html):练习 1 用的 SHA-256,中文版,看 `sha256` 和 `hexdigest` 两节就够。
- [Python 文档:itertools](https://docs.python.org/zh-cn/3.12/library/itertools.html):今天用了 `product`,顺便扫一眼 `combinations`,以后写检查脚本经常用到。
- [Python 文档:random](https://docs.python.org/zh-cn/3.12/library/random.html):`seed`、`randint`、`uniform` 三个函数。
- [Wikipedia:Little's law](https://en.wikipedia.org/wiki/Little%27s_law):利特尔定律的原始表述和几个例子,英文,10 分钟。
- [DeepSeek 定价与限速](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):2026 年 10 月 22 日我又核对了一次,deepseek-flash 高峰价仍是命中 0.04、未命中 2、输出 8 元每百万 token,账号并发上限 2500。
- [transparency.dev](https://transparency.dev/):Google 牵头的「透明日志」项目介绍,哈希链思路在工业界的完整形态(用默克尔树,能证明日志只追加不修改)。想知道练习 2 那个局限在大系统里怎么解决,从这里看起。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EPEszaEtW&autoplay=0&high_quality=1" title="利特尔法则(Little's law)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>项目管理晖太狼 · 利特尔法则(Little's law) · 11 分钟,从项目管理的角度讲在制品、吞吐量和周期时间的关系。换成我们的词就是在途请求、QPS 和单次耗时,同一条公式。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1zv411u7L7&autoplay=0&high_quality=1" title="怎么判断文件是否相同,md5,哈希值,放篡改" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>茶叶冒烟儿 · 怎么判断文件是否相同,md5,哈希值,放篡改 · 5 分钟,用最直观的例子讲哈希为什么能发现内容被改。没接触过哈希的话,做练习 1 之前先看。</figcaption>
</figure>

- 费曼学习法那个视频已经嵌在「错题与坑清单」后面。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/UC5xf8FbdJc" title="Back-Of-The-Envelope Estimation / Capacity Planning" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ByteByteGo · Back-Of-The-Envelope Estimation / Capacity Planning · Alex Xu 团队讲系统设计面试里的估算,和 Day 642 的 estimate.py 对照着看,重点听他怎么口算 QPS 和存储。</figcaption>
</figure>

### 书籍

- Alex Xu,《System Design Interview – An Insider's Guide》第 1 卷(2020),自出版。复习本周时重读第 2 章「Back-of-the-envelope Estimation」。
- Tanya Reilly,《The Staff Engineer's Path》,O'Reilly,2022。Day 640 引用过它讲的「评审前私下预沟通」,这周没读的话可以补第 1 章和讲大项目的那几章。

### 开源项目与代码

- [google/trillian](https://github.com/google/trillian):透明日志的开源实现,Certificate Transparency 就建在它上面。不用读代码,看 README 里「verifiable data structure」那段,知道练习 1 的哈希链往上走是什么样。
- [donnemartin/system-design-primer](https://github.com/donnemartin/system-design-primer):里面有一张「每个程序员都该知道的延迟数字」表,估算时常用。

## 自测

1. 不看文章,说出本周六天各自解决的是「做、讲、算、答」里的哪一件,每天留下的那个零件是什么。

<details><summary>答案</summary>

Day 637、638、639 是「做」:安全五层(其中哈希链和按钱熔断今天用到)、压测和利特尔定律、五秒跑起来的作品包装。Day 640 是「讲」:取舍四要素、ADR、评审三类,零件是 `doc_lint.py`。Day 641 是「算」:回本、交叉点、敏感性,零件是 `roi.py` 的 `monthly()`。Day 642 是「答」:七维度、45 分钟框架、真题一,零件是 `tool_permission.py` 的 `decide()`。

</details>

2. 默写 `monthly()` 时漏掉 `errors`,结果会往哪个方向偏?为什么这类错误特别危险?

<details><summary>答案</summary>

花掉的钱变少,净收益被高估,回本周期被算短,结论偏乐观。危险在于它偏向「项目值得做」那一边,决策者最容易接受,也最不会去追问。今天检查脚本里第 0 组净收益被高估了 18%。

</details>

3. 为什么检查 `decide()` 时金额要放 `99.99` 和 `100`,而不是随便挑几个数?

<details><summary>答案</summary>

阈值是 100,`>=` 和 `>` 只在正好等于 100 时结果不同。输入里没有 100,这个错误永远测不出来;放 `99.99` 是确认阈值下方确实放行。测边界就要把边界值本身和紧挨着它的值放进输入。

</details>

4. 哈希链能发现哪种篡改,发现不了哪两种?怎么补?

<details><summary>答案</summary>

能发现改了中间某一条记录(那一条的哈希重算对不上,或者后一条的 `prev` 对不上)。发现不了删掉最后几条,以及有写权限的人把整条链从头重算。补法是定期把链头写到篡改者够不着的地方(另一个团队的系统、开了对象锁的存储),核查时拿外部链头比对。

</details>

5. 面试题:面试官说「我们每月 3000 张客服工单,你这个方案里的多供应商路由和租户并发隔离是为了解决什么?」你怎么回应?

<details><summary>答案</summary>

先承认这个规模下并发不是问题:按 3 次调用、8 小时工作时间、单次 4 秒算,高峰在途请求只有 0.04 个,离 2500 的账号上限差几万倍。所以第一期不该做多供应商路由和并发隔离,应该砍掉,把精力放在真正决定成败的地方:自动解决率和人工处理时长的实测、答错的兜底。然后说清推翻条件:工单量涨两个数量级,或者开始大量用推理模型、单次耗时到几十秒,再回来做容量设计。这道题考的是你会不会把在别的题里学到的架构硬套过来,承认「不需要」本身是加分的。

</details>

## 明天预告

明天是 Day 644 · Staff 系统设计(二):真题二、真题三和追问清单。真题二是「大促时十万个并发会话的客服 Agent」,规模比 CloudLedger 大几万倍,今天练的利特尔定律和成本估算会变成决定架构的核心;真题三是「代码 Agent 的评测体系」,没有大流量,考的是评测集怎么构造、pass@k 和 pass^k、两个版本怎么做配对比较。最后整理一份追问清单,每条准备一个 30 秒的回答。
