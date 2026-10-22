---
title: 'Day 543 · 设计文档(二):示范 AgentOps 运行时设计文档和两份 ADR'
description: '把昨天的空骨架填满:先用一个小脚本把 Day 541 的实测数字算成文档要用的表,再给出一份完整的 AgentOps 运行时设计文档示范,逐行讲每一句为什么这么写;然后讲 ADR 和设计文档怎么分工,写两份 ADR。最后让 DeepSeek 按一份清单当第一个评审人:差文档 0/6,示范文档第一版 1/6,改完第二版 2/6,它永远挑得出毛病,哪些该听、哪些该写进评审记录不采纳,是今天要练的判断。'
pubDate: 2026-10-23
regime: none
tags: ['design-doc', 'adr', 'senior', 'python', 'agent-zero']
series: 'agent-zero'
day: 543
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 542](/blog/agent-zero/day-542-design-doc-1/) 讲了设计文档的八节:背景、目标、非目标、方案、被放弃的方案、横切关注点、风险与未决问题、评测与上线,每节回答一个问题。重点是目标要有指标、阈值、怎么测三样,非目标要写「评审时真会有人提」的东西。`doc_skeleton.py` 在 `agentops/docs/design/runtime.md` 生成了一份空骨架;`goal_rewrite.py` 让模型改写空话目标,它两句都给了一个凭空的「至少 50%」,说明数字只能来自你自己的数据。

今天把那份骨架填满。光知道每节写什么还不够,得看一份写完的长什么样,知道每一句为什么这么写。

## 今天要解决的问题

学完今天你应该能做到:

1. 读懂一份完整的 AgentOps 运行时设计文档,说出每一节里关键的那句话为什么这么写,尤其是被放弃的方案怎么写才不像稻草人。这是今天第一个新概念:**示范文档里的写法**。文档里的数字由 `part10/doc_numbers.py` 从实测值算出来,不手填。
2. 说清 **ADR 和设计文档的分工**,写出两份配套的 ADR:持久化方案和退款架构。这是第二个新概念。
3. 跑通 `part10/doc_review.py`,让模型按一份六条的清单预审文档,并且对它的每条意见做出判断:改、不改但记下理由。

预计用时 2.5 小时,一半时间在读示范和改你自己的版本。实跑花费约 2 分钱(算式在第三步和练习里)。前置:[Day 542](/blog/agent-zero/day-542-design-doc-1/) 全部;[Day 519](/blog/agent-zero/day-519-senior-map/)(第一份 ADR);[Day 537](/blog/agent-zero/day-537-durable-3/)(`durable_runner.py` 和崩溃注入测试);[Day 539](/blog/agent-zero/day-539-durable-4/)(四个持久化方案);[Day 541](/blog/agent-zero/day-541-orch-2/)(`arch_bench.py` 的结果表);[Day 148](/blog/agent-zero/day-148-structured-2/)(JSON mode)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写设计文档里「被放弃的方案」一节的三段式和 ADR 的六个字段;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 第一步:先把数字算出来

设计文档里最容易出问题的就是数字。昨天看到模型会编数字,其实人也会:写到一半懒得翻实验记录,凭印象写个「约四分之一」,评审时被问细节就卡住了。我的习惯是把文档里要用的数字放进一个小脚本,从实测值算出来,文档里写「来自哪个脚本」。以后实验重跑了,改一处,重新生成。

实测值来自 [Day 541](/blog/agent-zero/day-541-orch-2/) 的正式实验:五种架构、8 张工单、每张 3 次。今天只用其中能全过的三种。

```python
# agent-zero-lab/part10/doc_numbers.py
"""设计文档里要用到的数字,都从实测值算出来,不手填。"""

# 实测:Day 541 part10/arch_bench.py,8 张工单 × 3 次,DeepSeek deepseek-flash 高峰价
MEASURED = {
    "single":  {"pass": 1.00, "cost": 0.0019, "p95": 3.0667},
    "multi":   {"pass": 1.00, "cost": 0.0084, "p95": 11.1622},
    "hybrid2": {"pass": 1.00, "cost": 0.0014, "p95": 3.0967},
}
DAILY_TICKETS = 2000  # 假设:SupportPilot 每天的退款类工单数,上线后用真实值替换


def main() -> None:
    base = MEASURED["single"]["cost"]
    print("| 架构 | pass^3 | 单张成本(元) | 相对单 Agent | 每月成本(元) | P95 秒 |")
    print("| --- | --- | --- | --- | --- | --- |")
    for name, m in MEASURED.items():
        monthly = m["cost"] * DAILY_TICKETS * 30
        print(f"| {name} | {m['pass']:.0%} | {m['cost']:.4f} | {m['cost'] / base:.2f} 倍 "
              f"| {monthly:.0f} | {m['p95']:.1f} |")
    budget = MEASURED["hybrid2"]["cost"] * 1.05
    print(f"\nG4 的成本上限(混合第二版 × 1.05):{budget:.5f} 元/张")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `# 实测:Day 541 part10/arch_bench.py,8 张工单 × 3 次` 这行注释比代码还重要。数字的出处、样本量、条件(哪个模型、什么价格)写在数字旁边,半年后自己也能查回去。
- `MEASURED = {` 字典套字典,相当于 JS 的 `{ single: { pass: 1, cost: 0.0019, ... } }`。三个数都抄自 Day 541 那张结果表,一位小数都没改。
- `"multi":   {"pass": 1.00, "cost": 0.0084, "p95": 11.1622},` 多 Agent:成功率一样,成本和延迟都高很多。
- `DAILY_TICKETS = 2000  # 假设:` 这个数**是假设**,注释里明说了。设计文档里所有「每月成本」都建在它上面,评审人可以直接挑战它,这比藏在算式里好。
- `base = MEASURED["single"]["cost"]` 以单 Agent 为基准算倍数,0.0019。
- `for name, m in MEASURED.items():` `.items()` 同时拿键和值,相当于 JS 的 `Object.entries(MEASURED)`。
- `monthly = m["cost"] * DAILY_TICKETS * 30` 每月成本 = 单张成本 × 每天工单 × 30 天。混合第二版:0.0014 × 2000 × 30 = 84 元。
- `print(f"| {name} |` 两行 f-string 挨着写,Python 会自动把它们接成一个字符串,打印出来是一行 Markdown 表格,直接贴进文档。<br>`{m['pass']:.0%}` 格式化成百分比、不要小数,1.00 变成 `100%`。<br>`{m['cost'] / base:.2f} 倍` 多 Agent 0.0084 ÷ 0.0019 = 4.42 倍;混合第二版 0.0014 ÷ 0.0019 = 0.74 倍。
- `budget = MEASURED["hybrid2"]["cost"] * 1.05` G4 目标里的成本上限:迁移后允许比现在贵 5%。0.0014 × 1.05 = 0.00147。为什么是 5% 而不是 10%?这是一个判断,不是算出来的,评审时要能说出理由(这里的理由是:这个架构本来就是因为便宜才选的,贵太多就失去了选它的一个原因)。

</div>

```bash
cd ~/agent-zero-lab
uv run python -m part10.doc_numbers
```

```text
| 架构 | pass^3 | 单张成本(元) | 相对单 Agent | 每月成本(元) | P95 秒 |
| --- | --- | --- | --- | --- | --- |
| single | 100% | 0.0019 | 1.00 倍 | 114 | 3.1 |
| multi | 100% | 0.0084 | 4.42 倍 | 504 | 11.2 |
| hybrid2 | 100% | 0.0014 | 0.74 倍 | 84 | 3.1 |

G4 的成本上限(混合第二版 × 1.05):0.00147 元/张
```

这张表下面会原样进设计文档的附录。说一句实话:每天 2000 张工单、每月几十到几百元,这个规模的钱在公司里不算什么。多 Agent 真正贵的是 P95 慢了 3.6 倍,客户多等 8 秒。设计文档里要把评审人真正在乎的那个数放在前面,不要因为算出来了就每个都写一遍。

## 第二步:读一份完整的示范

下面是我写的 `agentops/docs/design/runtime.md` 第一版。它是在昨天的骨架上填的,八节都在,末尾加了一张空的评审记录表。真实的文档会更长,尤其方案一节会有架构图和接口附录,这里压缩到能一次读完。

读的时候注意两件事:每个数字后面有没有括号写出处;每个「不做」「没选」后面有没有写理由。鼠标悬停在行上能看到我为什么这么写。

```markdown
# AgentOps 运行时设计文档

作者:你 · 评审人:王磊(平台组)、陈静(SupportPilot 组)、周婷(财务 Agent 组) · 状态:评审中 · 2026-10-23

## 1. 背景

云簿已经有一个上线的客服 Agent:SupportPilot。销售、财务、研发三个团队计划下季度各做一个 Agent。
SupportPilot 的循环、工具接入、审批、上下文管理和客户记忆都是为它自己写的,别的团队拿不走。
如果各团队各写一套,会出现五套互不兼容的实现:审计口径不同、成本没法统一控制、出了事故要读五份代码。
另外,架构选择差别很大:同一批退款工单上,多 Agent 的平均成本是单 Agent 的 4.4 倍(实测,part10/arch_bench.py)。
没有统一的运行时和评测,各团队很难知道自己选的架构花了多少冤枉钱。

## 2. 目标

- G1:新团队基于运行时接入一个带工具和审批的 Agent,不超过 2 人日。(预期;财务 Agent 组接入时实测)
- G2:进程在任意一步被杀掉后恢复,结果与不被杀一致,有副作用的工具重复执行 0 次。(验证方法:part10/test_durable_runner.py 的崩溃注入测试,扩到运行时所有带副作用的工具)
- G3:每个运行都有步数上限、token 预算上限和审计记录,业务方可以调数值,不能关闭。
- G4:SupportPilot 迁移后,退款工单评测集的成功率与迁移前差异不显著;单张平均成本不超过 0.00147 元。(实测基线 0.0014 元 × 1.05,来自 part10/doc_numbers.py)

## 3. 非目标

- 不做可视化拖拽编排,业务方用代码定义 Agent。
- 不做模型网关,运行时通过接口调用网关(网关另有设计文档)。
- 不支持跨租户共享记忆。
- 本期不内置多 Agent 编排,只提供调用子 Agent 的基础能力。依据:arch_bench 实验里多 Agent 成功率没有更高,成本是 4.4 倍。

## 4. 方案

### 4.1 分层

一个薄的循环,加六个扩展点:Model、ContextManager、PermissionPolicy、Hook、StateStore、Memory。
接口沿用 harness 骨架(附录 A),本期新增 Memory。

### 4.2 默认策略

- 上下文:system 提示词和工具定义放最前面并保持不变(命中 KV 缓存);超预算时先清旧的工具结果,还超再摘要。
- 权限:有副作用的工具默认要审批;租户可配置金额阈值,低于阈值自动通过。
- 记忆:MemoryStore,按租户和客户隔离;来源有优先级;按类型设有效期;敏感字段拒写;支持按客户删除。
- 持久化:每一次模型调用和工具调用都走 step 记日志(durable_runner 的做法:日志重放 + 步骤指纹 + 幂等键 = 运行 id + 步骤序号);日志从 SQLite 换成 Postgres;加租约表防止两个进程同时恢复同一次运行。
- 编排:退款类工单默认用混合架构:模型提议要退哪几张发票,代码核对发票,代码执行退款,金额从账务系统重新取。

### 4.3 硬约束

最大步数、token 预算、副作用审批、审计日志。数值可调,开关不可关。

### 4.4 数据流

请求 → 创建 run → 每一步写日志 → 需要审批时把状态落库并返回 → 审批回调恢复 → 结束时写审计。

## 5. 被放弃的方案

### 5.1 直接引入 Temporal

优点:持久化执行最成熟,信号、定时器、版本化、可视化界面都有;workflow_id + activity_id 现成可做幂等键。
放弃原因:团队没人有 Temporal 运维经验;确定性约束(比如工作流里不能直接取当前时间)要所有业务方学会。
重新评估条件:运行超过 24 小时的任务占比超过 10%,或自研方案一个季度内出现 2 次以上恢复相关事故。

### 5.2 采用 DBOS

优点:只是一个库,日志放在我们自己的 Postgres 里,代码改动最小,单机重启时自动恢复未完成的工作流。
放弃原因:我们已有 durable_runner 和 6 个崩溃注入测试,团队都读过;多机恢复 DBOS 免费版同样要自己做,引入它主要省下的是七十多行我们已经写好的代码,却要所有业务方再学一套装饰器和约束。
重新评估条件:当我们准备自己写「扫描卡住的运行并重新派发」的调度器时,先评估用 DBOS 替换,因为这正是它现成有的部分。

### 5.3 以 LangGraph checkpoint 为基础

优点:SupportPilot 已经在用,interrupt 等审批现成。
放弃原因:checkpoint 粒度是节点,节点内部的副作用要各团队自己保证幂等,平台没法统一兜底;只需要简单循环的团队,写图的成本偏高。
它在新方案里的角色:业务方可以在运行时之上用 LangGraph 编排自己的流程。

### 5.4 直接用 Claude Agent SDK 当运行时

优点:成熟的 harness,压缩、工具、子 Agent 都是现成的。
放弃原因:循环跑在它自己的进程里,接不进我们的日志重放和幂等;各团队用的模型不同,需要支持 DeepSeek 等非 Claude 模型。
它在新方案里的角色:作为 Model 扩展点的一种实现,适合的团队可以用。

## 6. 横切关注点

- 安全:工具调用前一律经过权限策略;工具返回的内容当作不可信输入;审计日志业务方不能修改。
- 隐私:记忆层拒写敏感字段(实测模型会把卡号、身份证号原样抽出来);删除请求 7 天内物理清除。
- 成本:每个 run 记录 token 和缓存命中;超预算立即停止并返回已完成的部分。
- 可观测:通过 Hook 对接 OpenTelemetry,细节见可观测设计。

## 7. 风险与未决问题

- R1:两个进程同时恢复同一次运行。计划用租约表,上线前做并发恢复压测。
- R2:摘要压缩可能丢掉关键信息。需要在长任务评测集上量化,成功率比不压缩低 3 个百分点以上就改默认策略。
- R3:arch_bench 只有 8 张工单 × 3 次,混合架构的代码核对一次都没有驳回过模型,说明这张安全网还没被证明接住过什么。计划加入更容易让模型看错的工单再跑。
- Q1:子 Agent 的预算是否从父 run 的预算里扣?倾向于扣,待评审讨论。
- Q2:运行日志保留多久?倾向 90 天后归档,待财务组确认审计要求。

## 8. 评测与上线

- 离线:迁移前后各跑一次 arch_bench 和 SupportPilot 评测集,对比成功率、平均成本、P95。
- 故障注入:在每一步杀进程,断言恢复后结果一致、退款只有一笔。
- 上线:SupportPilot 先接 5% 流量,两周没有回退再全量;之后接财务 Agent。
- 回滚:旧循环代码保留一个月,配置开关切换。

## 评审记录

| 日期 | 谁 | 意见 | 处理 |
| --- | --- | --- | --- |
```

<div class="line-notes">

- `作者:你 · 评审人:王磊(平台组)、陈静(SupportPilot 组)、周婷(财务 Agent 组)` 评审人写具体的人,括号里写他代表谁。三个人对应三类利益方:做平台的、第一个迁移的、第一个新接入的。<br>`状态:评审中` 状态只有四种:草稿、评审中、已接受、已废弃。读者第一眼就知道这份文档能不能当真。
- `云簿已经有一个上线的客服 Agent:SupportPilot。` 背景第一句写现状,不写愿景。
- `别的团队拿不走。` 一句话说清「为什么不能直接复用」,否则评审第一个问题就是「把 SupportPilot 的代码抽出来不就行了」。
- `如果各团队各写一套,会出现五套互不兼容的实现` 写「不做会怎样」。没有这句,背景只是描述,不是动机。
- `多 Agent 的平均成本是单 Agent 的 4.4 倍(实测,part10/arch_bench.py)` 背景里也只放一个数,挑最能说明问题的那个,带出处。
- `G1:新团队基于运行时接入一个带工具和审批的 Agent,不超过 2 人日。(预期;` 「预期」两个字老实标明这是拍的。拍的数也可以写,但要让人知道是拍的,并写清什么时候能测出真值。
- `G2:进程在任意一步被杀掉后恢复` 指向 Day 537 已经存在的测试。目标和验证方法写在一起,评审人不用去翻第 8 节。
- `G3:每个运行都有步数上限、token 预算上限和审计记录` 这一条第一版写得不够好:没有默认值,也没说怎么验证「不能关闭」。第三步里模型评审抓到了它。
- `G4:SupportPilot 迁移后,退款工单评测集的成功率与迁移前差异不显著` 写「差异不显著」而不是「不下降」,因为分数有随机波动,小样本上掉一两个点可能只是噪音。怎么判断显著要用到 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 开始的评测统计学。这里先埋个伏笔。<br>`单张平均成本不超过 0.00147 元。(实测基线 0.0014 元 × 1.05,来自 part10/doc_numbers.py)` 数字、算法、出处三样都在。
- `不做可视化拖拽编排,业务方用代码定义 Agent。` 非目标后半句说「那怎么办」。
- `不做模型网关,运行时通过接口调用网关(网关另有设计文档)。` 把话题引向另一份文档,评审时不在这里展开。网关的设计在 [Day 626](/blog/agent-zero/day-626-agentops-gw-1/) 开始。
- `本期不内置多 Agent 编排,只提供调用子 Agent 的基础能力。依据:` 非目标带依据,别人想推翻得先推翻实验。
- `一个薄的循环,加六个扩展点:Model、ContextManager、PermissionPolicy、Hook、StateStore、Memory。` 方案先说结构,一句话让人知道系统长什么样。这六个名字来自 [Day 525](/blog/agent-zero/day-525-harness-build/) 的 harness 骨架。
- `接口沿用 harness 骨架(附录 A),本期新增 Memory。` 接口细节放附录,正文只说「和已有的哪里不同」。评审人关心的是变化。
- `上下文:system 提示词和工具定义放最前面并保持不变(命中 KV 缓存)` [Day 527](/blog/agent-zero/day-527-kv-cache-design/) 的前缀稳定原则,写成一条默认策略。<br>`超预算时先清旧的工具结果,还超再摘要。` [Day 528](/blog/agent-zero/day-528-layered-compaction/) 的分层压缩:按成本从低到高。
- `权限:有副作用的工具默认要审批;租户可配置金额阈值` 「默认」和「可配置」分开写:平台定底线,业务方调参数。
- `记忆:MemoryStore,按租户和客户隔离` 来自 [Day 534](/blog/agent-zero/day-534-memory-build/)。分号隔开的五个短语,每个都对应那天的一条规则。
- `持久化:每一次模型调用和工具调用都走 step 记日志(durable_runner 的做法:` 来自 [Day 537](/blog/agent-zero/day-537-durable-3/)。括号里一口气说清三件事:日志重放、步骤指纹、幂等键。<br>`日志从 SQLite 换成 Postgres;加租约表` 写清和练习版的差别。Day 537 说过「离生产还差什么」,这里就是在回答它。
- `编排:退款类工单默认用混合架构:` Day 541 的结论变成了一条默认策略,后面会单独写一份 ADR。
- `最大步数、token 预算、副作用审批、审计日志。数值可调,开关不可关。` 硬约束一节最短,但最重要:这几样业务方关不掉。
- `请求 → 创建 run → 每一步写日志 →` 数据流用一行箭头,真实文档这里会是一张时序图。
- `### 5.1 直接引入 Temporal` 被放弃的方案按「最强的对手」排在前面。Temporal 是这个领域最成熟的,不写它评审一定会问。
- `优点:持久化执行最成熟,信号、定时器、版本化、可视化界面都有` 先写优点,而且写具体的优点,不写「功能强大」。这些都是 [Day 539](/blog/agent-zero/day-539-durable-4/) 实跑或查文档得到的。
- `放弃原因:团队没人有 Temporal 运维经验;确定性约束` 放弃原因是团队和成本的现实,不是「Temporal 不好」。Day 539 实跑时 Temporal 沙箱拦住了 `datetime.now()`,这里写成「要所有业务方学会」。
- `重新评估条件:运行超过 24 小时的任务占比超过 10%,` 条件要可检查:看日志表就能算出这个占比。写了这句,评审人知道你不是在否定 Temporal,而是说「现在还不到时候」。
- `### 5.2 采用 DBOS` DBOS 是和自研最接近的对手,也最难写放弃理由。
- `放弃原因:我们已有 durable_runner 和 6 个崩溃注入测试,团队都读过;` 老实写:放弃它不是因为它差,是因为它带来的增量不大,学习成本却要所有人付。
- `重新评估条件:当我们准备自己写「扫描卡住的运行并重新派发」的调度器时,` 这条重新评估条件不是一个数字,而是一个**可观察的事件**。也是好写法:那个时候 DBOS 的现成部分正好派上用场。
- `### 5.3 以 LangGraph checkpoint 为基础` 第一版这里漏了重新评估条件,只写了角色。模型评审抓到了。
- `它在新方案里的角色:业务方可以在运行时之上用 LangGraph 编排自己的流程。` 没选它不等于禁用它,写清它在新方案里还能干什么,LangGraph 的用户就不会觉得被排挤。
- `### 5.4 直接用 Claude Agent SDK 当运行时` 这里有个细节要说清:DeepSeek 其实提供了 Anthropic 兼容接口,技术上能接,但那是第三方兼容,出了问题官方不保证。真实文档里这类细节写进附录,正文只写主要原因。
- `安全:工具调用前一律经过权限策略;工具返回的内容当作不可信输入` 第七部分讲过的提示注入:工具结果可能带着别人写的指令。
- `隐私:记忆层拒写敏感字段(实测模型会把卡号、身份证号原样抽出来)` 横切关注点也带实测依据,这句来自 Day 534 的评测输出。
- `成本:每个 run 记录 token 和缓存命中;超预算立即停止并返回已完成的部分。` 「返回已完成的部分」是一个产品决定,不是技术细节,值得写。
- `R1:两个进程同时恢复同一次运行。计划用租约表,上线前做并发恢复压测。` 风险的标准格式:是什么、怎么缓解、怎么验证。
- `R2:摘要压缩可能丢掉关键信息。需要在长任务评测集上量化,成功率比不压缩低 3 个百分点以上就改默认策略。` 带了触发条件。
- `R3:arch_bench 只有 8 张工单 × 3 次,混合架构的代码核对一次都没有驳回过模型` 把自己实验的弱点主动写出来,这是 Day 541 那一课最后坦白的事。评审人看到这句,会更信任文档里其他的数字。
- `Q1:子 Agent 的预算是否从父 run 的预算里扣?倾向于扣,待评审讨论。` 未决问题写「倾向」,让评审有东西可以反驳,而不是一个开放的空问题。
- `离线:迁移前后各跑一次 arch_bench 和 SupportPilot 评测集` 第一版这里有个硬伤:「各跑一次」没法判断 G4 的「差异不显著」。第三步模型评审在第二版里才抓到它。
- `上线:SupportPilot 先接 5% 流量,两周没有回退再全量;` 灰度比例、观察期、放量条件都在一句里。
- `回滚:旧循环代码保留一个月,配置开关切换。` 能直接执行的回滚办法。
- `| 日期 | 谁 | 意见 | 处理 |` 评审记录表先空着。被否决的意见也要写进来,下次有人提同样的问题,直接指过来。

</div>

读完整份,你可以对照昨天的八个问题自己检查一遍:每节都答了它的问题吗?我自己写完第一版时觉得挺完整的。下面第三步会看到,一个按清单挑刺的评审人能找出五处毛病。

再说一下长度。这份示范压缩后大约三千字,真实写出来加上架构图、接口附录、实验数据附录,会有五到八页。别为了显得认真把每节都写长,Ubl 那篇文章说十到二十页是大项目的上限,不是目标。

## ADR 和设计文档怎么分工

[Day 519](/blog/agent-zero/day-519-senior-map/) 写过第一份 ADR(架构决策记录,Architecture Decision Record)。那天说的格式是:一份 ADR 只记一个决定,写背景、决定、理由、代价、重新评估条件,写完只追加不修改。今天说它和设计文档的关系。

前端类比一下。设计文档像一个大功能的 PR 描述加上评审讨论:讲整体怎么做,评审完基本就定稿了。ADR 像你在项目 README 旁边留的一张张便条:「为什么状态管理用 Zustand 不用 Redux」「为什么表单校验放在后端」。每张便条只讲一件事,半年后有人想改,先读这张便条。

两者的分工:

| | 设计文档 | ADR |
| --- | --- | --- |
| 管多大 | 一个项目或一个大功能的整体方案 | 一个具体的决定 |
| 什么时候写 | 动手之前 | 做决定的时候,包括实现中途 |
| 写完以后 | 定稿后很少大改,实现偏离时回填或另写 ADR | 只追加不修改;决定变了写新的一份,旧的标「被取代」 |
| 读者 | 评审人 | 未来想改这个决定的人 |
| 长度 | 五到八页 | 一页以内 |

一个设计文档里通常有几个关键决定值得单独拎出来写 ADR。判断标准:**半年后会有人问「为什么这样」的决定**。AgentOps 运行时里我挑了两个:持久化为什么自研,退款为什么用混合架构。前者是 Day 539 学的四个方案都没选,一定会被问;后者是一个反直觉的选择(单 Agent 也能全过,为什么还要加代码核对),也一定会被问。

为什么不直接看设计文档?因为设计文档讲的是整体,一个决定的理由散在好几节里(目标、方案、被放弃的方案),而且设计文档定稿以后,后来的变化不一定回填进去。ADR 把一个决定的来龙去脉放在一页纸上,编号排好,`agentops/docs/adr/` 目录里按顺序一看,就是这个系统的决策史。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="设计文档和 ADR 的关系:设计文档拆出关键决定成为 ADR,实现中途的新决定也写成 ADR">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="40" width="200" height="150" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="36" y="64" fill="var(--ink)">design/runtime.md</text>
<text x="36" y="90" fill="var(--ink-soft)" font-size="11">2 目标</text>
<text x="36" y="110" fill="var(--ink-soft)" font-size="11">4.2 默认策略 · 持久化</text>
<text x="36" y="130" fill="var(--ink-soft)" font-size="11">4.2 默认策略 · 编排</text>
<text x="36" y="150" fill="var(--ink-soft)" font-size="11">5 被放弃的方案</text>
<text x="36" y="175" fill="var(--ink-faint)" font-size="11">动手前写,评审后定稿</text>
<rect x="330" y="30" width="290" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="344" y="50" fill="var(--ink)">0001 · Day 519 写的第一份</text>
<text x="344" y="66" fill="var(--ink-faint)" font-size="11">只追加不修改</text>
<rect x="330" y="84" width="290" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="344" y="104" fill="var(--ink)">0002 · 持久化用自研日志重放</text>
<text x="344" y="120" fill="var(--ink-faint)" font-size="11">从 4.2 和 5.1、5.2 拎出来</text>
<rect x="330" y="138" width="290" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="344" y="158" fill="var(--ink)">0003 · 退款用混合架构</text>
<text x="344" y="174" fill="var(--ink-faint)" font-size="11">从 4.2 编排拎出来</text>
<rect x="330" y="192" width="290" height="44" rx="6" fill="var(--paper)" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="344" y="212" fill="var(--ink-soft)">0004 · 实现中途改了主意</text>
<text x="344" y="228" fill="var(--ink-faint)" font-size="11">新写一份,旧的标「被取代」</text>
<line x1="220" y1="110" x2="330" y2="106" stroke="var(--rule)"/>
<line x1="220" y1="130" x2="330" y2="160" stroke="var(--rule)"/>
<line x1="220" y1="150" x2="330" y2="106" stroke="var(--rule)"/>
</g>
</svg>
<figcaption>设计文档讲整体,把半年后会被追问的决定拎出来单独写 ADR。实现中途改了主意,不去改旧的 ADR,写一份新的。编号从 0001 往下排,目录就是决策史。</figcaption>
</figure>

### 0002:持久化方案

```markdown
# 0002 · 运行时持久化采用自研日志重放,暂不引入 Temporal 或 DBOS

- 状态:已采纳 · 日期:2026-10-23 · 决定人:你 · 相关:设计文档 runtime.md 第 4.2、5.1、5.2 节

## 背景
运行时要支持进程重启后接着跑,以及等审批等上几个小时。SupportPilot 的退款流程三条全中:跨发版窗口、动钱、要等人。

## 决定
沿用 part10/durable_runner.py 的做法:每一步结果写日志,重启后按日志重放;步骤带指纹,对不上就报错;副作用调用的幂等键 = 运行 id + 步骤序号。日志从 SQLite 换成 Postgres,加租约表。

## 理由
- 团队已经有这套代码和 6 个崩溃注入测试(在第 1–4 步各杀一次进程,恢复后都只退一笔),所有人都读过。
- 当前最长的任务是等审批,不超过一天;不需要 Temporal 的版本化和可视化。
- DBOS 能省下的主要是我们已经写好的七十多行,多机恢复它的免费版同样要自己做。

## 代价
- 调度(发现卡住的运行并重新派发)、日志归档要自己写。
- 只有我们自己维护,没有社区帮忙踩坑。

## 重新评估条件
- 运行超过 24 小时的任务占比超过 10%;或
- 自研方案一个季度内出现 2 次以上和恢复有关的事故;或
- 开始写调度器之前,先评估换成 DBOS。
```

<div class="line-notes">

- `# 0002 · 运行时持久化采用自研日志重放,暂不引入 Temporal 或 DBOS` 标题就是决定本身,一句话。读目录的人只看标题就知道每份 ADR 说了什么。编号四位、从 0001 开始,0001 是 Day 519 那份。
- `状态:已采纳 · 日期:2026-10-23 · 决定人:你 · 相关:设计文档 runtime.md 第 4.2、5.1、5.2 节` 写清「相关」能让人从 ADR 跳回设计文档,也能从设计文档跳过来。
- `SupportPilot 的退款流程三条全中:跨发版窗口、动钱、要等人。` 背景直接用 Day 539 那三条判断标准,不重新发明一套说法。
- `沿用 part10/durable_runner.py 的做法:` 决定写到「照着能做」的程度:用什么代码、改哪两处。
- `团队已经有这套代码和 6 个崩溃注入测试(在第 1–4 步各杀一次进程,恢复后都只退一笔)` 理由里的数字带上了它测的是什么。练习 2 里模型审这份 ADR 时,说「6 个」「七十多行」没写出处,这条意见是对的,括号里该再加上测试文件名。
- `当前最长的任务是等审批,不超过一天;` 这个「不超过一天」是理由成立的前提。前提一变,决定就该重审,所以它和下面的重新评估条件是对应的。
- `调度(发现卡住的运行并重新派发)、日志归档要自己写。` 代价写真实的工作量,不写「可能有一定维护成本」这种空话。
- `运行超过 24 小时的任务占比超过 10%;或` 和设计文档 5.1 的条件一字不差。两处说法不一样,读者会困惑以哪个为准。
- `开始写调度器之前,先评估换成 DBOS。` 第三条是一个事件触发:做到某一步时自动想起这份 ADR。

</div>

### 0003:退款架构

```markdown
# 0003 · 退款类工单采用混合架构:模型提议,代码核对,代码执行

- 状态:已采纳 · 日期:2026-10-23 · 决定人:你 · 相关:设计文档 runtime.md 第 3、4.2 节

## 背景
退款工单要从客户的描述里判断退哪几张发票,判断要靠模型;退款动钱,金额和发票必须可审计。

## 决定
模型只提议要退的发票号;代码逐张核对(发票存在、前面有同一天同金额的那张);核对通过才由代码调用退款,金额从账务系统重新取,不用模型给的值。

## 理由
part10/arch_bench.py 实测,8 张分难度工单各跑 3 次:混合第二版和单 Agent 的 pass^3 都是 100%,混合第二版平均每张 0.0014 元,单 Agent 0.0019 元,多 Agent 0.0084 元(4.4 倍)。混合架构便宜约四分之一,而且每笔退款的金额和发票都由代码保证。

## 代价
- 每新增一类工单,都要有人写核对规则。
- 这次实验里代码核对一次都没有驳回过模型,安全网是否有用还没被证明。

## 重新评估条件
- 换模型或改工具后重跑 arch_bench.py;单 Agent 的平均成本降到混合架构以下且 pass^3 仍为 100%,评估简化为单 Agent 加退款前的代码核对。
- 新增的工单类型写不出核对规则,那一类改为人工审批,不放开模型的退款权限。
```

<div class="line-notes">

- `# 0003 · 退款类工单采用混合架构:模型提议,代码核对,代码执行` 标题把架构的三段分工直接写出来,比「采用混合架构」多了信息。
- `判断要靠模型;退款动钱,金额和发票必须可审计。` 背景就两个约束,正好对应「为什么不是纯工作流」和「为什么不是纯 Agent」。
- `金额从账务系统重新取,不用模型给的值。` 这一句来自 Day 541 的教训:混合第一版用了模型给的金额 0 去退款,6 张工单全错。
- `part10/arch_bench.py 实测,8 张分难度工单各跑 3 次:` 数字和 `doc_numbers.py` 的输出一致,出处、样本量都在。<br>`混合架构便宜约四分之一` 0.0014 ÷ 0.0019 = 0.74,便宜 26%,说「约四分之一」没问题。这种口头概括可以有,但旁边必须有原始数字。
- `这次实验里代码核对一次都没有驳回过模型,安全网是否有用还没被证明。` 把对自己不利的事实写进代价。这是 ADR 最容易省略、也最不该省略的一段。
- `换模型或改工具后重跑 arch_bench.py;` 重新评估条件里直接写要跑哪个脚本、看哪两个数,下一次换模型时团队不用凭感觉再吵一遍。
- `新增的工单类型写不出核对规则,那一类改为人工审批,不放开模型的退款权限。` 写清了「条件触发以后怎么办」,不只是「到时候再说」。

</div>

把两份 ADR 存到 `agentops/docs/adr/0002-durable-log-replay.md` 和 `agentops/docs/adr/0003-refund-hybrid.md`,文件名用编号加几个英文单词,方便在终端里 `ls` 一眼看全。

## 第三步:让模型当第一个评审人

正式评审之前,先找一个人看一遍,能少很多当场被问倒的尴尬。没有合适的同事时,可以让模型按一份清单当第一个读者。注意我说的是「第一个读者」:它挑毛病很勤快,但它不知道你们团队的情况,不能替你拍板。

清单就是昨天八节背后的那几个问题,压成六条。输出用 JSON,方便程序统计有几条没过,用的是 [Day 148](/blog/agent-zero/day-148-structured-2/) 讲过的 JSON mode(`response_format={"type": "json_object"}`,DeepSeek 支持)。

```python
# agent-zero-lab/part10/doc_review.py
"""让模型按一份清单当第一个评审人。它只能挑毛病,不能替你拍板。"""
import json
import sys
from pathlib import Path
from typing import Any

from common.llm import LLMClient

CHECKLIST = [
    "每个目标是否可验证(有数字或明确的通过标准)",
    "非目标是否写清楚,能挡住最可能出现的「顺便做一下」",
    "每个被放弃的方案是否写了优点、放弃原因、重新评估条件",
    "风险是否都有验证或缓解办法",
    "评测计划能否证明目标达成",
    "横切关注点(安全、隐私、成本、可观测)有没有遗漏",
]

SYSTEM = (
    "你是一位挑剔的资深工程师评审人。按清单逐条检查用户给的设计文档。"
    "只输出 JSON:{\"items\": [{\"no\": 1, \"ok\": true/false, \"problem\": \"一句话,ok 为 true 时写空字符串\"}]}。"
    "problem 要具体到文档里的哪一句,不要泛泛而谈。"
)


def review(llm: LLMClient, doc: str) -> list[dict[str, Any]]:
    rules = "\n".join(f"{i}. {c}" for i, c in enumerate(CHECKLIST, start=1))
    r = llm.chat(
        [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"清单:\n{rules}\n\n设计文档:\n{doc}"},
        ],
        response_format={"type": "json_object"},
        temperature=0,
    )
    return json.loads(r.content)["items"]


if __name__ == "__main__":
    llm = LLMClient()
    for path in sys.argv[1:]:
        items = review(llm, Path(path).read_text(encoding="utf-8"))
        passed = sum(1 for it in items if it["ok"])
        print(f"== {path}:{passed}/{len(CHECKLIST)} 条通过")
        for it in items:
            mark = "✓" if it["ok"] else "✗"
            print(f"  {mark} {it['no']}. {it['problem']}" if not it["ok"] else f"  {mark} {it['no']}.")
    print(llm.ledger)
```

<div class="line-notes">

- `from typing import Any` `Any` 表示「任意类型」。下面 `review` 返回的是从 JSON 解析出来的字典,值可能是数字、布尔、字符串,用 `dict[str, Any]` 标注,相当于 TS 的 `Record<string, any>`。
- `CHECKLIST = [` 六条检查项,对应昨天八节里最容易写坏的六处。清单写成数据,练习 2 会换一份 ADR 用的清单。
- `"每个被放弃的方案是否写了优点、放弃原因、重新评估条件",` 三段式写进清单,这样它会逐个方案去数。
- `SYSTEM = (` 括号里几个字符串挨着写会自动拼成一个,长提示词这么写比一行好读。
- `"只输出 JSON:{\"items\": [{\"no\": 1, \"ok\": true/false,` 把输出格式写死。JSON mode 只保证输出是合法 JSON,不保证字段对,所以提示词里必须给出结构。`\"` 是在 Python 字符串里写一个双引号。
- `"problem 要具体到文档里的哪一句,不要泛泛而谈。"` 不加这句,它会说「部分目标不够具体」这种没法改的话。
- `rules = "\n".join(f"{i}. {c}" for i, c in enumerate(CHECKLIST, start=1))` 把清单拼成「1. … 2. …」的编号文本,和 JSON 里的 `no` 对得上。
- `response_format={"type": "json_object"},` 打开 JSON mode,经过 `LLMClient.chat` 的 `**kw` 原样传给 openai SDK。
- `temperature=0,` 评审要稳定,同一份文档两次审出不同结论就没法用了。练习 3 会验证它到底稳不稳。
- `return json.loads(r.content)["items"]` 解析 JSON 取出列表。这里没做容错,如果模型某次没按格式输出会直接报 `KeyError`,练习版够用,正式用要加 [Day 150](/blog/agent-zero/day-150-structured-4/) 那种带错误重试的 `extract`。
- `for path in sys.argv[1:]:` 命令行可以给多个文件,`sys.argv[0]` 是脚本自己,所以从 1 开始切。
- `passed = sum(1 for it in items if it["ok"])` 数通过了几条,相当于 `items.filter(it => it.ok).length`。
- `mark = "✓" if it["ok"] else "✗"` 通过的只打勾,不通过的把问题打出来。

</div>

先拿一份差文档做对照。新建 `agentops/docs/design/bad.md`,这是我照着见过的真实方案缩写的:

```markdown
# Agent 平台方案

## 背景

公司很多团队要做 Agent,我们需要一个统一的平台。

## 目标

- 提升开发效率
- 让 Agent 更稳定、更安全
- 支持多 Agent 协作

## 方案

使用业界领先的 Temporal 作为底座,结合 LangGraph 进行编排,接入所有主流大模型,构建一站式 Agent 平台。

## 风险

暂无。
```

<div class="line-notes">

- `公司很多团队要做 Agent,我们需要一个统一的平台。` 背景只有结论没有事实:多少团队、现在什么问题、不做会怎样,全没有。
- `- 提升开发效率` 昨天的老朋友。
- `- 支持多 Agent 协作` 这其实是一个方案,混进了目标。目标说「要达到什么」,不说「用什么」。
- `使用业界领先的 Temporal 作为底座,结合 LangGraph 进行编排,` 两个持久化方案叠在一起用,没有说为什么,也没说两者的分工。「业界领先」「一站式」是宣传词。
- `暂无。` 最危险的两个字。

</div>

两份一起审:

```bash
uv run python -m part10.doc_review agentops/docs/design/bad.md agentops/docs/design/runtime.md
```

```text
== agentops/docs/design/bad.md:0/6 条通过
  ✗ 1. 目标「提升开发效率」「让 Agent 更稳定、更安全」「支持多 Agent 协作」均无数字或明确通过标准,无法验证。
  ✗ 2. 文档完全没有非目标章节,无法挡住「接入所有主流大模型」「一站式平台」这类范围蔓延。
  ✗ 3. 文档未记录任何被放弃的方案(如不用 Temporal 或 LangGraph 的替代方案),更无优点、放弃原因与重新评估条件。
  ✗ 4. 风险章节仅写「暂无。」,未识别任何风险,也无验证或缓解办法。
  ✗ 5. 文档没有评测计划章节,无法证明「提升开发效率」「更稳定、更安全」等目标达成。
  ✗ 6. 全文未提及安全、隐私、成本、可观测中的任何一项,而「接入所有主流大模型」直接涉及成本与数据隐私却无对应设计。
== agentops/docs/design/runtime.md:1/6 条通过
  ✗ 1. G1 写的是「不超过 2 人日」但标注「(预期;财务 Agent 组接入时实测)」,没有明确的通过判定标准(如计时口径、是否含评审/调试),且 G3「业务方可以调数值」没有给出可验证的默认值与上下界。
  ✓ 2.
  ✗ 3. 5.3 和 5.4 只写了优点和放弃原因,没有写重新评估条件(5.1、5.2 有),四项不齐。
  ✗ 4. R3 只写了「计划加入更容易让模型看错的工单再跑」,没有给出通过/失败判据(比如代码核对必须驳回过 N 次或拦截率下限),无法验证缓解是否生效。
  ✗ 5. 第 8 节离线评测只对比「成功率、平均成本、P95」,没有说明如何证明 G2(崩溃恢复一致性)和 G3(预算/审计不可关闭)达成,故障注入也只覆盖退款场景。
  ✗ 6. 横切关注点缺成本归属与配额(多租户下谁付钱、超预算如何按租户计量)以及 Q1 子 Agent 预算归属未定,可观测只写「细节见可观测设计」未列关键指标与告警。
2 次调用 | 输入 2151 / 输出 589 tokens | 约 ¥0.0090
```

花费:2151 × 2 / 1000000 + 589 × 8 / 1000000 ≈ 0.0090 元(按高峰价;我跑的时候是空闲时段,实际扣一半)。

差文档 0/6 在意料之中,而且每条都指到了具体的句子,第 2 条还顺手点出「一站式平台」就是范围蔓延的苗头。我原以为示范文档能过四五条,结果只过了 1 条。我一条一条判断它说得对不对,这一步是今天真正要练的。

**第 1 条,一半对。** G3 确实没有默认值,也没说怎么验证「不能关闭」,这条要改。G1 的「计时口径」算是吹毛求疵,但给 G1 补一句「怎么计时」也不费事,我顺手补到了第 8 节。

**第 3 条,对。** 5.3、5.4 我只写了「它在新方案里的角色」,漏了重新评估条件。这正是我自己定的三段式,自己没做到。

**第 4 条,对。** R3 只说了要做什么,没说做成什么样算这张安全网有用。补一个判据。

**第 5 条,对,而且是最有价值的一条。** 我写了四条目标,第 8 节只证明了 G2 和 G4 的一部分。G1、G3 怎么证明,一个字没提。目标和评测计划对不上,是设计文档里最常见的硬伤。

**第 6 条,不采纳。** 它要我写按租户的成本归属和配额。这件事是真的,但它归模型网关管,第 3 节非目标第 2 条已经写了「不做模型网关」。按它的意见改,范围就蔓延进来了。不采纳也要留痕:写进评审记录,下次有人提同样的问题,直接指过来。

改完的第二版只动了这几处(`diff` 输出的意思:`<` 是旧的,`>` 是新的,`17c17` 表示第 17 行被修改,`68a69` 表示在第 68 行后面加了一行):

```bash
diff agentops/docs/design/runtime.v1.md agentops/docs/design/runtime.md
```

```text
17c17
< - G3:每个运行都有步数上限、token 预算上限和审计记录,业务方可以调数值,不能关闭。
---
> - G3:每个运行都有步数上限(默认 20)、token 预算上限(默认 5 万)和审计记录,业务方可以调数值,不能关闭。(验证方法:单元测试里把开关设成关闭,断言启动时报错;跑一个故意死循环的 Agent,断言第 21 步前停下)
68a69
> 重新评估条件:接入的团队里超过一半本来就在用 LangGraph,并且愿意把有副作用的操作都拆成单独节点、带幂等键。
74a76
> 重新评估条件:所有接入团队都改用 Claude 模型,且 SDK 提供可以接入外部日志的步骤回调。
87c89
< - R3:arch_bench 只有 8 张工单 × 3 次,混合架构的代码核对一次都没有驳回过模型,说明这张安全网还没被证明接住过什么。计划加入更容易让模型看错的工单再跑。
---
> - R3:arch_bench 只有 8 张工单 × 3 次,混合架构的代码核对一次都没有驳回过模型,说明这张安全网还没被证明接住过什么。计划加入更容易让模型看错的工单再跑;判据:新工单上代码核对至少驳回过 1 次,且驳回后没有退错一笔。
94c96,98
< - 故障注入:在每一步杀进程,断言恢复后结果一致、退款只有一笔。
---
> - 故障注入(证明 G2):在每一步杀进程,断言恢复后结果一致、退款只有一笔。
> - 硬约束测试(证明 G3):见 G3 的验证方法,进 CI。
> - 接入计时(证明 G1):财务 Agent 组从拿到文档到第一张工单跑通,按日历记人日。
101a106
> | 2026-10-23 | 模型预审 | 横切关注点缺按租户的成本归属 | 不采纳:计费归模型网关,见非目标第 2 条 |
```

(我在改之前先 `cp runtime.md runtime.v1.md` 留了一份第一版,所以能 diff。真实项目里文档在 git 里,看历史就行。)

再审一次第二版:

```bash
uv run python -m part10.doc_review agentops/docs/design/runtime.md
```

```text
== agentops/docs/design/runtime.md:2/6 条通过
  ✗ 1. G1 写的是「不超过 2 人日」但标注「(预期;财务 Agent 组接入时实测)」,没有明确的通过/失败判据,也没有说明超时怎么办。
  ✓ 2.
  ✓ 3.
  ✗ 4. R2 只写了「需要在长任务评测集上量化」,没有说这个长任务评测集由谁在什么时候建、怎么建,缓解办法本身没有验证路径。
  ✗ 5. G4 的「差异不显著」在评测计划里只写「迁移前后各跑一次」,单次运行无法做显著性判断,也没给样本量和统计方法。
  ✗ 6. 横切关注点里成本只写了「每个 run 记录 token 和缓存命中」,没有按租户/团队的成本归属与配额,评审记录里以「计费归模型网关」为由不采纳,但运行时侧的成本归属(谁超了预算、怎么告警)仍是缺口。
1 次调用 | 输入 2091 / 输出 284 tokens | 约 ¥0.0057
```

只多过了一条(第 3 条)。这次的意见里,第 5 条又是真问题,而且比上次深一层:「各跑一次」根本没法判断「差异不显著」。这个我第一版写的时候没意识到,算是模型评审帮了大忙。怎么改要用到 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 往后的统计方法,我在文档里先记成一条未决问题。第 6 条它在坚持,而且读了评审记录还反驳了一句,但我的判断没变。第 1 条和第 4 条是同一个方向的追问:「怎么计时」「谁来建评测集」,每次改完它都能再往下问一层。

这就是用模型当评审人最该知道的一件事:**它永远挑得出毛病。**你按它的意见改到 6/6,文档会变成一份二十页、每句话都带三个括号的东西,没人读得完。我的停止规则是:真问题改掉;判断分歧写进评审记录;追问细节的,问自己「真人评审会不会在会上问这个」,不会就停。模型预审的价值是在真人看之前把明显的洞补上,不是拿一个满分。

还有一点:它说的每一条我都回到文档里核对过原句。模型评审偶尔会张冠李戴(把一节的内容说成另一节没写),信它之前先自己看一眼。

## 写好设计文档的几个习惯

**先写目标和非目标,再写方案。** 很多人一上来就画架构图,写到一半才发现目标没想清楚。目标定了,方案的取舍才有标准。

**数字放进脚本,文档里写出处。** 今天的 `doc_numbers.py` 就是这个意思。实验重跑了改一处,文档和代码不会对不上。

**被放弃的方案按「最强的对手」排序。** 先写最可能被问「为什么不用」的那个。每个都写优点、放弃原因、重新评估条件或它在新方案里的角色。

**评审之前先找一个人看。** 同事或者模型都行,带一份清单。

**评审意见要留痕。** 被否决的意见也写上理由。

**实现中改了主意,写新的 ADR。** 不要悄悄改代码不改文档。

## 动手练习

**练习 1:写 ADR 0004。** 设计文档非目标第 4 条写了「本期不内置多 Agent 编排」。把它写成一份 ADR:`agentops/docs/adr/0004-no-builtin-multi-agent.md`,六个字段都要有,理由里的数字必须和 `doc_numbers.py` 的输出一致。

<details><summary>参考答案</summary>

```markdown
# 0004 · 运行时本期不内置多 Agent 编排,只提供调用子 Agent 的基础能力

- 状态:已采纳 · 日期:2026-10-23 · 决定人:你 · 相关:设计文档 runtime.md 第 3 节非目标第 4 条

## 背景
产品同学希望运行时自带「主管派活给专员」的多 Agent 编排,理由是看起来更强。

## 决定
本期运行时只提供 call_subagent(name, task, budget) 一个基础能力:子 Agent 的预算从父 run 里扣,结果必须是带状态字段的 JSON。不提供主管、专员、投票等现成编排模式。

## 理由
part10/arch_bench.py 实测(8 张分难度退款工单 × 3 次,数字来自 part10/doc_numbers.py):多 Agent 的 pass^3 和单 Agent 一样是 100%,平均成本 0.0084 元,是单 Agent 的 4.42 倍,P95 11.2 秒对 3.1 秒。这批工单只查一个系统、读三四张发票,拆不出互相独立的子任务。

## 代价
- 真有需要多 Agent 的团队要自己在运行时之上搭。
- 实验的任务集偏简单,结论只对退款类工单成立。

## 重新评估条件
- 出现需要同时查多个独立系统、材料多到一个 Agent 的上下文装不下的工单类型(比如年度对账),先在那一类上用 arch_bench 的方法做对比实验;
- 或者有两个以上接入团队各自搭出了相似的编排代码。
```

<div class="line-notes">

- `# 0004 · 运行时本期不内置多 Agent 编排,只提供调用子 Agent 的基础能力` 「不做」也是一种决定,一样值得写 ADR。
- `产品同学希望运行时自带「主管派活给专员」的多 Agent 编排` 背景写清是谁、因为什么提的,这就是 Day 541 自测里那道「产品经理想全面升级成多 Agent」的场景。
- `call_subagent(name, task, budget)` 决定写到接口这一层。「预算从父 run 里扣」回答了设计文档的 Q1;「带状态字段的 JSON」来自 Day 541 的失败隔离。
- `平均成本 0.0084 元,是单 Agent 的 4.42 倍,P95 11.2 秒对 3.1 秒。` 和 `doc_numbers.py` 输出逐字对得上。
- `实验的任务集偏简单,结论只对退款类工单成立。` 代价里承认实验的边界。
- `有两个以上接入团队各自搭出了相似的编排代码。` 一个可观察的信号:如果大家都在重复造同一个轮子,说明该由平台提供了。

</div>

</details>

**练习 2:让模型审 ADR。** 设计文档的清单不适合 ADR。新建 `part10/ex543_adr_review.py`,换一份五条的 ADR 清单(背景、决定唯一且具体、数字有出处、代价诚实、重新评估条件可检查),审 0002 和 0003,对每条意见判断改还是不改。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex543_adr_review.py
"""练习 2:换一份清单,让模型审 ADR。"""
import json
import sys
from pathlib import Path

from common.llm import LLMClient

ADR_CHECKLIST = [
    "背景是否说清了为什么现在要做这个决定",
    "决定是否只有一个,并且具体到能照着做",
    "理由里的数字是否写了出处(哪个脚本、什么条件下测的)",
    "代价是否诚实写出,而不是只写好处",
    "重新评估条件是否可以被检查(有数字或可观察的事件)",
]
SYSTEM = (
    "你是挑剔的架构评审人。按清单逐条检查用户给的 ADR。"
    "只输出 JSON:{\"items\": [{\"no\": 1, \"ok\": true/false, \"problem\": \"ok 为 false 时写一句具体问题,否则空字符串\"}]}"
)

if __name__ == "__main__":
    llm = LLMClient()
    rules = "\n".join(f"{i}. {c}" for i, c in enumerate(ADR_CHECKLIST, start=1))
    for path in sys.argv[1:]:
        r = llm.chat(
            [{"role": "system", "content": SYSTEM},
             {"role": "user", "content": f"清单:\n{rules}\n\nADR:\n{Path(path).read_text(encoding='utf-8')}"}],
            response_format={"type": "json_object"},
            temperature=0,
        )
        items = json.loads(r.content)["items"]
        print(f"== {Path(path).name}:{sum(it['ok'] for it in items)}/{len(ADR_CHECKLIST)}")
        for it in items:
            if not it["ok"]:
                print(f"  ✗ {it['no']}. {it['problem']}")
    print(llm.ledger)
```

<div class="line-notes">

- `ADR_CHECKLIST = [` 五条,对应 ADR 的五个字段(状态行不用审)。
- `"理由里的数字是否写了出处(哪个脚本、什么条件下测的)",` 这一条最能抓到问题,下面实跑就是它挂的。
- `"重新评估条件是否可以被检查(有数字或可观察的事件)",` 「可观察的事件」是给「开始写调度器之前」这种条件留的口子,否则模型会要求每个条件都带数字。
- `{Path(path).read_text(encoding='utf-8')}` f-string 里调用方法,外面是双引号,里面的 `'utf-8'` 用单引号。
- `print(f"== {Path(path).name}:{sum(it['ok'] for it in items)}` `Path(path).name` 只取文件名不要目录;`sum` 对布尔值求和,`True` 算 1,数出通过几条。

</div>

```bash
uv run python -m part10.ex543_adr_review agentops/docs/adr/0002-durable-log-replay.md agentops/docs/adr/0003-refund-hybrid.md
```

```text
== 0002-durable-log-replay.md:3/5
  ✗ 1. 背景只说了业务需求(重启续跑、等审批),没有说明为什么现在必须做这个决定、不做的后果或触发时机。
  ✗ 3. 「6 个崩溃注入测试」「七十多行」等数字没写出处(哪个脚本、什么条件下测的)。
== 0003-refund-hybrid.md:5/5
2 次调用 | 输入 1055 / 输出 225 tokens | 约 ¥0.0039
```

判断:第 3 条采纳,在括号里加上 `part10/test_durable_runner.py` 和 `part10/durable_runner.py`,数字能被复查。第 1 条半采纳:「为什么现在」其实在设计文档背景里讲了(五个团队要接入),ADR 里加一句「AgentOps 运行时要在财务 Agent 组接入前定下持久化方案」就够,不用把设计文档的背景搬过来。0003 全过,因为它的每个数字都带了脚本名和样本量,这就是数字有出处的好处。

花费:1055 × 2 / 1000000 + 225 × 8 / 1000000 ≈ 0.0039 元。

</details>

**练习 3:同一份文档审三遍,模型评审人稳不稳?** 新建 `part10/ex543_repeat.py`,import `doc_review.py` 的 `review`,把第二版 `runtime.md` 审三遍,打印每遍没通过的条目号。如果三遍不一样,你会怎么用它?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex543_repeat.py
"""练习 3:同一份文档审 3 遍,看模型评审人稳不稳。"""
import sys
from pathlib import Path

from common.llm import LLMClient
from part10.doc_review import review

if __name__ == "__main__":
    llm = LLMClient()
    doc = Path(sys.argv[1]).read_text(encoding="utf-8")
    for i in range(1, 4):
        items = review(llm, doc)
        fails = [it["no"] for it in items if not it["ok"]]
        print(f"第 {i} 遍:没通过的条目 {fails}")
    print(llm.ledger)
```

<div class="line-notes">

- `from part10.doc_review import review` 复用,清单和提示词完全一样,只有次数不同。
- `doc = Path(sys.argv[1]).read_text(encoding="utf-8")` 文档只读一次,三遍用同一份文本。
- `for i in range(1, 4):` 跑 3 遍,`range(1, 4)` 是 1、2、3,不含 4。
- `fails = [it["no"] for it in items if not it["ok"]]` 只收集没通过的编号,方便一眼比较三遍是否一致。

</div>

```bash
uv run python -m part10.ex543_repeat agentops/docs/design/runtime.md
```

```text
第 1 遍:没通过的条目 [1, 4, 5, 6]
第 2 遍:没通过的条目 [1, 4, 5, 6]
第 3 遍:没通过的条目 [1, 4, 5, 6]
3 次调用 | 输入 6273 / 输出 922 tokens | 约 ¥0.0086
```

三遍一样,和正文第二次审的结果也一样。温度 0 加上固定的清单,在这份文档上是稳的。但这不代表任何时候都稳:温度 0 只是让模型每次挑最可能的词,服务端的实现细节、负载不同仍可能导致输出变化,我在别的任务上见过温度 0 也不一致的情况。

花费比 3 × 0.0057 低,是因为第 2、3 遍的提示词前缀完全一样,命中了 DeepSeek 的缓存(命中部分每百万 0.04 元)。

如果三遍不一样,我的用法是只认「三遍里至少两遍都说没过」的条目,只出现一次的当作噪音,真想知道就自己去读原句判断。这其实就是 [Day 179](/blog/agent-zero/day-179-self-consistency/) 的自洽投票用在了评审上。

</details>

**验收标准**:`agentops/docs/design/runtime.md` 八节填满,每个数字带出处,每个被放弃的方案三段齐全;`agentops/docs/adr/` 下有 0002、0003、0004;跑过一次 `doc_review.py`,评审记录里至少有一条「不采纳」并写了理由;能说出设计文档和 ADR 的五点区别。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| ADR | Architecture Decision Record,架构决策记录。一份只记一个决定:背景、决定、理由、代价、重新评估条件 |
| 重新评估条件 | 写在被放弃的方案或 ADR 里,什么情况发生时要重新考虑这个决定。要能检查:一个数字或一个可观察的事件 |
| 被取代 superseded | ADR 的一种状态。决定变了不改旧 ADR,写一份新的,旧的标「被 00XX 取代」 |
| 评审记录 | 设计文档末尾的表,记下谁提了什么意见、怎么处理,不采纳的也写理由 |
| 预审 | 正式评审前先找一个人(或模型)看一遍,把明显的问题补上 |
| 稻草人 | 只写缺点、故意让自己驳倒的备选方案。[Day 542](/blog/agent-zero/day-542-design-doc-1/) 讲过 |
| diff | 比较两个文件哪里不一样的命令。`<` 是旧内容,`>` 是新内容 |

## 常见误区

**被放弃的方案只写缺点。** 只写缺点的方案一看就是陪跑的。先写它好在哪,再写为什么没选,最后写什么条件下重新考虑或它在新方案里还能干什么。

**重新评估条件写成「以后再看」。** 「视情况重新评估」等于没写。要么一个能算出来的数(超过 24 小时的任务占比超过 10%),要么一个看得见的事件(开始写调度器之前)。

**目标和评测计划对不上。** 四条目标,评测计划只证明了两条。今天第一版就犯了,是模型评审抓到的。写完以后逐条目标问一遍「第 8 节哪一行证明它」。

**设计文档和 ADR 的说法不一致。** 设计文档写「超过 24 小时占比 10%」,ADR 写「超过一天的任务多起来」,读者不知道以哪个为准。同一个条件在两处一字不差。

**把模型评审当裁判。** 它永远挑得出毛病。改到 6/6 的文档没人读得完。真问题改,分歧写进评审记录,细节追问问自己「真人会不会在会上问」。

**改了主意去改旧 ADR。** ADR 只追加不修改。旧的标「被取代」,新写一份。改旧的就丢了「当时为什么那样决定」。

**数字凭印象写。** 写到一半懒得翻实验记录写个「约四分之一」,评审时被问细节就卡住。数字放进脚本,文档里写出处。

## 学习资料

### 文档与文章

- [Michael Nygard《Documenting Architecture Decisions》](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):ADR 这个做法的出处,2011 年的博客,很短,英文 10 分钟。
- [Martin Fowler · Architecture Decision Record](https://www.martinfowler.com/bliki/ArchitectureDecisionRecord.html):Fowler 网站上对 ADR 的简介,讲清它和设计文档的关系、为什么只追加不修改。
- [AWS 规范性指南:使用架构决策记录](https://docs.aws.amazon.com/zh_cn/prescriptive-guidance/latest/architectural-decision-records/welcome.html):中文,讲 ADR 在团队里怎么用,[ADR 流程](https://docs.aws.amazon.com/zh_cn/prescriptive-guidance/latest/architectural-decision-records/adr-process.html)那一页讲状态怎么流转、被取代怎么标。20 分钟。
- [adr.github.io](https://adr.github.io/):ADR 社区站,各种模板的入口。
- [joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record):大量真实 ADR 例子,重点看别人怎么写代价和重新评估条件。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ymjN6YE4Z&autoplay=0&high_quality=1" title="【IT老齐899.59】架构决策记录ADR最佳实践" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐899.59】架构决策记录ADR最佳实践 · 11 分钟,中文讲 ADR 的格式和放在仓库里的做法。听完对照今天的 0002、0003,看他讲的字段有没有我们没写的。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17s4y1J7rG&autoplay=0&high_quality=1" title="阿里工程师带你学技术文档该怎么写" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里技术_AlibabaTech · 阿里工程师带你学技术文档该怎么写 · 30 分钟。昨天看过的话,今天跳到讲方案评审的那段重看,和第三步的预审对照。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/6H6zfCNeqek" title="Architecture Decision Records (ADR) as a LOG that answers &quot;WHY?&quot;" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CodeOpinion(Derek Comartin)· Architecture Decision Records (ADR) as a LOG that answers "WHY?" · 讲 ADR 为什么是一份「回答为什么」的日志,只追加不修改。英文,开字幕。</figcaption>
</figure>

### 书籍

- Mark Richards、Neal Ford《Fundamentals of Software Architecture》(O'Reilly,2020):第 19 章「Architecture Decisions」讲怎么做决定、怎么记录、怎么沟通,以及几种决策反模式(比如同一个问题被反复拿出来吵的「土拨鼠日」)。
- Michael Keeling《Design It!: From Programmer to Software Architect》(Pragmatic Bookshelf,2017):讲怎么带团队做架构设计。书里的「Activity 20: Architecture Decision Records」讲 ADR,「Activity 26: Paths Not Taken」讲怎么记录被放弃的方案,正好对应今天两件事。

### 开源项目与代码

- 你自己的 `agentops/docs/design/runtime.md`、`agentops/docs/adr/0002–0004` 和 `part10/doc_review.py`:后面 AgentOps 的几天([Day 624](/blog/agent-zero/day-624-agentops-kickoff-1/) 起)会回到这份文档。
- [npryce/adr-tools](https://github.com/npryce/adr-tools):命令行管理 ADR 的小工具,自动编号、标记被取代。[phodal/adr](https://github.com/phodal/adr) 是国内作者写的同类工具,中文文档。

## 自测

1. 被放弃的方案一节,每个方案要写哪三段?为什么先写优点?

<details><summary>答案</summary>

优点、放弃原因、重新评估条件(或它在新方案里的角色)。先写优点是为了证明你认真比较过,不是搭稻草人;评审人看到你把对手的长处说清楚了,才会信你的放弃理由。

</details>

2. 设计文档和 ADR 有什么区别?举一个应该写 ADR 的决定。

<details><summary>答案</summary>

设计文档讲一个项目的整体方案,动手前写,评审后定稿;ADR 只记一个具体决定,做决定时写,只追加不修改,读者是未来想改这个决定的人。应该写 ADR 的:半年后会被问「为什么这样」的决定,比如「持久化用自研日志重放,不用 Temporal」。

</details>

3. 示范文档 G4 写「成功率差异不显著」,第 8 节写「迁移前后各跑一次」。这两句之间有什么问题?

<details><summary>答案</summary>

各跑一次没法判断差异显不显著:分数有随机波动,一次的差可能只是噪音。要判断显著,得多跑几次或用足够多的样本,再用统计方法算区间或做检验(Day 547 开始讲)。这是第三步模型评审第二轮抓到的问题。

</details>

4. 模型评审说「横切关注点缺按租户的成本归属」,你为什么可以不采纳?不采纳要做什么?

<details><summary>答案</summary>

按租户计费归模型网关管,文档非目标里已经写了「不做模型网关」,采纳就把范围蔓延进来了。不采纳也要写进评审记录:日期、谁提的、意见、处理和理由(见非目标第 2 条)。下次有人提同样的问题,直接指过来。

</details>

5. 好的重新评估条件长什么样?给一个坏例子和一个好例子。

<details><summary>答案</summary>

要可检查:一个能算出来的数,或一个看得见的事件。坏例子:「视情况重新评估」「等任务变复杂了再说」。好例子:「运行超过 24 小时的任务占比超过 10%」「开始写调度器之前先评估 DBOS」。

</details>

6. 面试题:「讲一个你主导的技术决策,当时考虑过哪些方案,为什么选了现在这个?」

<details><summary>答案</summary>

用设计文档的结构讲,两三分钟:背景一两句(五个团队要接 Agent,各写一套没法统一审计和成本);可验证的目标(进程任意一步被杀,副作用重复 0 次);考虑过的方案,每个说一个真实的优点(Temporal 最成熟,DBOS 改动最小,LangGraph 团队在用);选择自研日志重放的理由(已有代码和 6 个崩溃注入测试,任务不超过一天,团队没人运维过 Temporal);代价(调度和归档要自己写);重新评估条件(超过 24 小时的任务占比到 10%,或开始写调度器时)。最后一句加分:如果重来,我会更早把实验扩大样本,因为 8 张工单 × 3 次的结论统计上很单薄。

</details>

## 明天预告

Day 544 · 评测是产品(一):一个人和一个团队的评测,资产生命周期。今天设计文档的 G4 写了「评测集成功率差异不显著」,第 8 节靠评测集证明目标。可评测集本身谁维护?到了五个团队都接入运行时,评测从一个人的事变成一个团队的事,会烂在哪?明天讲用例的生老病死:从哪来、怎么入库、能力集和回归集为什么要分开、什么时候毕业、怎么退役,还会实跑一个「总分没变、其实一好一坏」的例子。
