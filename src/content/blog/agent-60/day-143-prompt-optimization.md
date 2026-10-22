---
title: 'Day 143 · 自动优化提示词:DSPy、GEPA 与 ACE'
description: '手调 prompt 的那套「看错例、猜规则、改一句、再跑一遍」可以交给程序做。用 60 条 CloudLedger 工单实测三种做法:60 行自己写的反思循环、DSPy 的 GEPA、ACE 式的增量规则手册,看它们各自把分数提了多少、在哪里过拟合、花了多少钱。'
pubDate: 2026-10-22
regime: none
tags: ['prompt-optimization', 'dspy', 'gepa', 'eval', 'agent-60']
series: 'agent-60'
day: 143
lang: 'zh'
---

## 今天要解决的问题

**建议在 [Day 35 · W5 复习 + 小项目:给工单 Agent 加评测集和 CI 回归门禁](/blog/agent-60/day-35-week5-review-eval-ci/) 之后读。** 这是专题篇的一课,不用按顺序学。你需要会用 Day 4 的 `LLMClient`,知道 Day 5 的提示词写法,做过 W5 的评测集,最好也读过 Day 51「按错误分析改 prompt」。

回想一下 Day 5 和 Day 51 你是怎么改 prompt 的:跑一遍评测,挑出错的那几条,盯着看半天,猜出背后的规则(「哦,登录报错码应该算 account 不算 bug」),往 prompt 里加一句,再跑一遍,看分数涨没涨。这个过程很机械,而且你已经有了它需要的所有零件:一份带标签的测试集,一个能打分的函数,一个能读懂错例的大模型。既然如此,能不能让程序替你跑这个循环?

这就是自动 prompt 优化。2026 年最常被提到的是三个名字:DSPy(斯坦福出的框架,把 prompt 当成可以编译的程序)、GEPA(DSPy 里的一个优化器,ICLR 2026 口头报告论文)、ACE(同样是 ICLR 2026 的论文,主张别整段重写 prompt,而是一条一条往「手册」里加经验)。今天不只是讲概念,我们用同一份 60 条工单把三种做法都跑一遍,数字全部是 2026 年 10 月 22 日用 DeepSeek `deepseek-flash` 实跑的。

学完你应该能:

1. 说清楚自动优化 prompt 需要哪三样东西,以及为什么「反馈文字」比优化算法更重要。
2. 不用框架,自己写一个「读错例 → 反思 → 改写 → 留出集验收」的循环。
3. 用 DSPy 3.4 的 `dspy.GEPA` 优化一个分类器,看懂它的候选列表和 Pareto 前沿。
4. 用 ACE 的思路写一个只做增量更新的规则手册,知道它和整段重写各有什么毛病。
5. 看出小数据集上的「优化」什么时候是真进步,什么时候只是过拟合了验证集。

预计用时 4–5 小时。API 花费:全部脚本各跑一遍(GEPA 两次、其他各两次)大约 ¥1,算式在后面。

## 手调 prompt 的天花板在哪

先说我自己的体会。Day 51 那种改法,前两三轮很有效,因为错误都很明显:漏了一个类别定义,或者没说清楚输出格式。到了第四五轮,剩下的错误往往是「规则之间打架」:你为了修好「注销账号顺便要退余额」那一条,加了一句「涉及退钱一律算 refund」,结果另一条「扣款短信和账单金额对不上」也被归成了 refund,可标注员认为那是 billing,因为客户只是问钱去哪了,没说要退。你再加一句例外,又有别的地方被带歪。

这时候人会累,会凭印象判断「好像好了」,而且很少有人每改一次都把整份测试集重跑、把分数记下来。程序不会累,它可以一晚上试几十个版本,每个版本都在同一份数据上打分。它也有人没有的毛病:它不知道哪些规则是业务上真的成立的,只知道哪个版本在它看得到的数据上分数高。今天后半段会看到,这个毛病在 20 条的验证集上暴露得非常明显。

所以先把期望放对:**自动优化省的是你跑循环的体力,不替你决定标注规则对不对,也不替你扩充测试集。** 测试集太小、反馈写得含糊,换什么优化器都没用。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="自动 prompt 优化的循环:当前 prompt 交给执行模型跑训练集,评分函数给出分数和文字反馈,反思模型读错例写出候选 prompt,在验证集上验收,更好就采用,否则丢弃;最终只在测试集上量一次">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="130" height="50" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="40" y="52" fill="var(--ink)">当前 prompt</text>
<text x="40" y="70" fill="var(--ink-faint)" font-size="11">v0、v1、v2…</text>
<rect x="190" y="30" width="130" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="205" y="52" fill="var(--ink)">执行模型</text>
<text x="205" y="70" fill="var(--ink-faint)" font-size="11">跑训练集小批</text>
<rect x="360" y="30" width="130" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="375" y="52" fill="var(--ink)">评分函数</text>
<text x="375" y="70" fill="var(--ink-faint)" font-size="11">分数 + 反馈文字</text>
<rect x="360" y="130" width="130" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="375" y="152" fill="var(--ink)">反思模型</text>
<text x="375" y="170" fill="var(--ink-faint)" font-size="11">读错例写新版</text>
<rect x="190" y="130" width="130" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="205" y="152" fill="var(--ink)">验证集验收</text>
<text x="205" y="170" fill="var(--ink-faint)" font-size="11">更好才采用</text>
<rect x="20" y="130" width="130" height="50" rx="6" fill="none" stroke="var(--rule)"/>
<text x="35" y="152" fill="var(--ink)">测试集</text>
<text x="35" y="170" fill="var(--ink-faint)" font-size="11">最后只量一次</text>
<line x1="150" y1="55" x2="188" y2="55" stroke="var(--ink-soft)"/>
<line x1="320" y1="55" x2="358" y2="55" stroke="var(--ink-soft)"/>
<line x1="425" y1="80" x2="425" y2="128" stroke="var(--ink-soft)"/>
<line x1="360" y1="155" x2="322" y2="155" stroke="var(--ink-soft)"/>
<line x1="255" y1="130" x2="100" y2="82" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="120" y="112" fill="var(--ink-faint)" font-size="11">采用 → 成为新的当前版</text>
<line x1="190" y1="170" x2="152" y2="170" stroke="var(--rule)" stroke-dasharray="2 3"/>
<text x="20" y="220" fill="var(--ink-soft)" font-size="11">关键在右上角那一格:反馈文字写得越具体(「应为 billing,因为付款没成功不算 bug」),</text>
<text x="20" y="238" fill="var(--ink-soft)" font-size="11">反思模型改得越准。只给 0/1 分数,它只能瞎猜。</text>
</g>
</svg>
<figcaption>三种做法都是这个循环,区别在「反思模型怎么改」和「怎么挑出最终版本」。测试集全程不参与挑选。</figcaption>
</figure>

## 三个名字分别是什么

**DSPy** 是斯坦福 NLP 组的开源框架,2023 年那篇论文的标题就说明了它的立场:把调用语言模型的代码当成「声明式的程序」来写,prompt 由框架生成和优化,而不是你手写一大段字符串。你写的是 `Signature`(输入什么字段、输出什么字段、类型是什么)和 `Module`(怎么调用,比如直接预测、先想再答、ReAct),然后挑一个「优化器」(DSPy 里叫 teleprompter)去调它。2026 年 10 月查到的最新版是 3.4.1(10 月 12 日发布),`dspy.teleprompt` 里导出的优化器有 `BootstrapFewShot`(自动挑 few-shot 示例)、`MIPROv2`(同时搜指令和示例)、`SIMBA`、`COPRO`、`BootstrapFinetune`(干脆微调模型)和今天的主角 `GEPA` 等十几个。

**GEPA** 的全称是 Genetic-Pareto,论文标题很嚣张:《Reflective Prompt Evolution Can Outperform Reinforcement Learning》。它的想法有两层。第一层是「反思」:不只看分数,还把执行过程和评分函数写的文字反馈交给一个反思模型,让它用自然语言分析为什么错、该怎么改,然后写出新版 prompt。第二层是「Pareto 前沿」:它不是只保留总分最高的那一个版本,而是保留「在某些样本上做得最好」的所有版本,下一轮从这些版本里挑一个接着改。这样能避免所有努力都押在一个版本上,陷进局部最优。ICLR 2026 版本的摘要说,在六个任务上它平均比 GRPO 强化学习高 6 个百分点、最多高 19 个点,用的 rollout 少到 1/35;比 DSPy 自己的 MIPROv2 高 10 个点以上。GEPA 有独立的 Python 包 `gepa`(10 月查到 0.1.4),DSPy 3.4.1 直接把 `gepa[dspy]==0.1.4` 列为依赖,所以装 DSPy 就有了。

**ACE**(Agentic Context Engineering)出自斯坦福、SambaNova 和伯克利的论文,也收进了 ICLR 2026。它点出了「反复整段重写 prompt」的两个毛病:一是**简短偏好**(brevity bias),模型改写时喜欢写得短而漂亮,把有用的细节删掉;二是**上下文坍缩**(context collapse),改写几轮之后,早先积累的具体经验被一点点抹平。ACE 的做法是把上下文当成一本「作战手册」:生成、反思、整理三个角色分工,每次只往手册里加或改几条带编号的条目,并记录每条帮了几次、害了几次,而不是从头重写。论文报告在 AppWorld 智能体基准上提升 10.6%,金融任务上提升 8.6%。

三者的关系可以这么记:DSPy 是框架,GEPA 是框架里的一种优化算法(也能单独用),ACE 是一种维护上下文的思路,不限于 prompt,也适合 Agent 的长期记忆和规则库。

| | 改什么 | 怎么挑版本 | 适合 |
| --- | --- | --- | --- |
| 自己写的反思循环 | 整段重写 | 验证集分数不降就采用 | 理解原理、小任务 |
| GEPA | 整段重写,多个候选并存 | Pareto 前沿 + 验证集总分 | 有稳定评测集的分类、抽取、问答、多步程序 |
| ACE | 增量加减条目 | 每条规则的帮/害计数 | 经验会不断积累的 Agent、规则手册 |

## 准备:60 条工单,规则藏在标签里

今天的代码放在 `agent-60-lab/topics/prompt_opt/`。为了能用 `-m` 从仓库根目录运行,目录名用下划线。先建空的 `__init__.py`:

```bash
cd agent-60-lab
mkdir -p topics/prompt_opt && touch topics/__init__.py topics/prompt_opt/__init__.py
uv add dspy          # 2026-10 实测装上 dspy 3.4.1、gepa 0.1.4、litellm 1.83.0,和课程里的 openai 3.29 不冲突
```

数据是 60 条 CloudLedger 工单,沿用 Day 28 的六个类别。和 Day 5 那批简单工单不同,这里有一半是故意挑的边界情况,标签背后有一套「客服分诊规范」:重复扣款不管客户说没说要退都算 refund;付款没成功算 billing,哪怕页面弹出英文错误码;发票上的金额和实际扣款对不上算 billing,因为本质是钱算得对不对;发票 PDF 打不开算 bug;注销账号时要退余额算 refund,只问注销后数据还在不在算 account。每条都带一个 `why` 字段,是标注员写的理由,后面会当成反馈文字喂给优化器。

这份规范**没有写进起点 prompt**,优化器只能从错例和理由里自己学出来。这和真实情况一致:业务规则通常散落在标注员脑子里和历史工单里,不会有人提前整理好。

```jsonl
{"id":"t01","ticket":"这个月账单显示扣了两次 299,我只开了一个专业版。","label":"refund","why":"重复扣款一律算 refund,哪怕客户没明说要退"}
{"id":"t02","ticket":"信用卡续费没扣成功,页面提示 card_declined,怎么办?","label":"billing","why":"扣款失败属于 billing,不是 bug,即使页面出现英文错误码"}
{"id":"t03","ticket":"想问一下企业版一年多少钱,能开月付吗?","label":"billing","why":"价格和付费方式咨询属于 billing"}
{"id":"t04","ticket":"发票抬头写错了,公司名少了个「有限」,能重开吗?","label":"invoice","why":"抬头、税号、发票类型、重开都是 invoice"}
{"id":"t05","ticket":"导出 Excel 的时候一直转圈,最后报 E2001。","label":"bug","why":"导入导出等功能异常是 bug"}
{"id":"t06","ticket":"登录时提示 E1043 验证码已失效,重发了三次都不行。","label":"account","why":"登录、验证码相关问题算 account,即使带错误码"}
{"id":"t07","ticket":"年付专业版用了四个月不想用了,剩下的钱能退吗?","label":"refund","why":"年付中途取消问退钱是 refund"}
{"id":"t08","ticket":"怎么关闭自动续费?下个月不想再扣了。","label":"billing","why":"只问取消续费、不涉及把已付的钱退回,算 billing"}
{"id":"t09","ticket":"你们有没有代理合作?我们想在华南区代理 CloudLedger。","label":"other","why":"商务合作、代理属于 other"}
{"id":"t10","ticket":"子账号看不到报表菜单,是不是权限没给?","label":"account","why":"成员、子账号权限是 account"}
{"id":"t11","ticket":"发票上的金额是 399,可我实际被扣了 299,到底扣了多少?","label":"billing","why":"发票金额和扣款不一致,本质是钱算得对不对,算 billing 不算 invoice"}
{"id":"t12","ticket":"发票 PDF 下载下来打不开,显示文件已损坏。","label":"bug","why":"发票文件下载、显示异常属于功能问题,算 bug"}
{"id":"t13","ticket":"我要注销账号,账户里还有 120 块余额怎么退给我?","label":"refund","why":"涉及把钱退回给客户时 refund 优先于 account"}
{"id":"t14","ticket":"希望报表能加一个按项目筛选的功能。","label":"other","why":"功能建议算 other"}
{"id":"t15","ticket":"升级到企业版是马上按差价扣钱还是下个周期?","label":"billing","why":"升级计费规则是 billing"}
{"id":"t16","ticket":"上周取消了订阅,结果今天又扣了 99,请处理。","label":"refund","why":"取消后仍被扣款,要求处理多扣的钱,算 refund"}
{"id":"t17","ticket":"手机号换了,收不到验证码,怎么改绑定手机?","label":"account","why":"换绑手机、收不到验证码是 account"}
{"id":"t18","ticket":"想开增值税专用发票,需要提供什么资料?","label":"invoice","why":"发票类型和开票资料是 invoice"}
{"id":"t19","ticket":"银行卡余额不足导致续费失败,现在充值了能重新扣吗?","label":"billing","why":"扣款失败后重新扣款是 billing"}
{"id":"t20","ticket":"凭证列表页面打开很慢,要等 30 秒。","label":"bug","why":"性能和页面异常属于 bug"}
{"id":"t21","ticket":"同一张发票被扣了两笔钱,麻烦核实一下。","label":"refund","why":"重复扣款算 refund,出现「发票」二字也不改变"}
{"id":"t22","ticket":"支付宝付款时页面报错 PAY_TIMEOUT,钱没扣,订单也没成功。","label":"billing","why":"付款没成功属于 billing,不是 bug"}
{"id":"t23","ticket":"税号填错了,发票已经开出来了,怎么作废重开?","label":"invoice","why":"税号错误、作废重开是 invoice"}
{"id":"t24","ticket":"导入银行流水时提示「第 3 列格式错误」,可我的表格是按模板做的。","label":"bug","why":"导入功能异常算 bug"}
{"id":"t25","ticket":"管理员离职了,我们怎么把管理员权限转给别人?","label":"account","why":"管理员转移是 account"}
{"id":"t26","ticket":"基础版年付,能不能中途取消然后退剩下几个月的钱?","label":"refund","why":"问能不能退剩余的钱就是 refund,能不能退由政策决定,分类不管"}
{"id":"t27","ticket":"你们和金蝶比有什么优势?","label":"other","why":"产品对比、售前咨询非价格类算 other"}
{"id":"t28","ticket":"续费价格怎么比去年贵了 100?","label":"billing","why":"价格变化疑问是 billing"}
{"id":"t29","ticket":"开了发票但是邮箱一直没收到。","label":"invoice","why":"发票寄送、邮件没收到是 invoice"}
{"id":"t30","ticket":"点「生成凭证」按钮没有任何反应。","label":"bug","why":"按钮无响应是 bug"}
{"id":"t31","ticket":"登录后一直跳回登录页,清缓存也没用,报错码 E1101。","label":"account","why":"登录失败相关算 account,即使带错误码"}
{"id":"t32","ticket":"试用期结束自动扣了我 2392,我根本没打算买,退给我。","label":"refund","why":"要求退已扣的钱是 refund"}
{"id":"t33","ticket":"订阅页面显示下次扣款日期是 11 月 31 日,这个日期不存在吧?","label":"bug","why":"页面显示错误的日期属于 bug,不是 billing"}
{"id":"t34","ticket":"能不能把三张发票合并成一张开?","label":"invoice","why":"合并开票是 invoice"}
{"id":"t35","ticket":"公司要采购,需要你们盖章的报价单。","label":"billing","why":"报价单属于价格类,算 billing"}
{"id":"t36","ticket":"账号被锁了,提示密码错误次数过多。","label":"account","why":"账号锁定是 account"}
{"id":"t37","ticket":"我们换了公司名称,以后的发票抬头怎么改?","label":"invoice","why":"修改发票抬头是 invoice"}
{"id":"t38","ticket":"降级到基础版之后,多付的差价会退回来吗?","label":"refund","why":"问差价退不退回是 refund"}
{"id":"t39","ticket":"报表里的合计金额和明细加起来对不上,差了 0.01。","label":"bug","why":"计算显示错误是 bug,不是 billing(不是我们扣客户的钱)"}
{"id":"t40","ticket":"想邀请你们来我们公司做个培训。","label":"other","why":"培训邀约算 other"}
{"id":"t41","ticket":"微信支付扣了钱,但是订阅状态还是未付款。","label":"billing","why":"付款成功但状态没更新属于 billing"}
{"id":"t42","ticket":"开发票时提示「开票金额超过可开额度」,为什么?","label":"invoice","why":"开票额度问题是 invoice"}
{"id":"t43","ticket":"手机 App 闪退,打开就退出。","label":"bug","why":"闪退是 bug"}
{"id":"t44","ticket":"之前多扣的那 99 说好退,一周了还没到账。","label":"refund","why":"退款进度查询是 refund"}
{"id":"t45","ticket":"我是会计,想用一个账号管理三家公司,怎么弄?","label":"account","why":"多公司账号管理是 account"}
{"id":"t46","ticket":"月付可以改成年付吗?年付有优惠吗?","label":"billing","why":"付费周期和优惠是 billing"}
{"id":"t47","ticket":"你们的数据存在哪里?有等保认证吗?","label":"other","why":"安全合规咨询算 other"}
{"id":"t48","ticket":"发票开成了普票,我们要的是专票,能换吗?","label":"invoice","why":"发票类型更换是 invoice"}
{"id":"t49","ticket":"扣款短信说扣了 299,可是账单里显示 0,这笔钱去哪了?","label":"billing","why":"扣款记录对不上属于 billing,没有要求退款"}
{"id":"t50","ticket":"打开发票列表页面直接白屏。","label":"bug","why":"页面白屏是 bug,出现「发票」不改变"}
{"id":"t51","ticket":"企业版年付用了两个月,公司倒闭了,能退吗?","label":"refund","why":"年付中途取消问退钱是 refund"}
{"id":"t52","ticket":"怎么设置让财务只能看不能改?","label":"account","why":"成员权限设置是 account"}
{"id":"t53","ticket":"注销账号后数据还能找回吗?","label":"account","why":"只问注销和数据,不涉及退钱,是 account"}
{"id":"t54","ticket":"续费时优惠券用不了,提示「不适用于当前套餐」。","label":"billing","why":"优惠券和扣费相关是 billing,不是 bug"}
{"id":"t55","ticket":"上个月的发票能补开吗?当时忘了开。","label":"invoice","why":"补开发票是 invoice"}
{"id":"t56","ticket":"批量删除凭证后,回收站里找不到了。","label":"bug","why":"功能结果异常是 bug"}
{"id":"t57","ticket":"同事说你们有教育优惠,学校能用吗?","label":"billing","why":"优惠和价格咨询是 billing"}
{"id":"t58","ticket":"重复开了两张一样的发票,作废一张就行。","label":"invoice","why":"重复开票(不是重复扣款)是 invoice"}
{"id":"t59","ticket":"我的账号被别人登录了,改了密码,怎么办?","label":"account","why":"账号安全、被盗是 account"}
{"id":"t60","ticket":"被扣了两次年费,一共 4784,只要一份。","label":"refund","why":"重复扣款是 refund"}
```

把上面这段存成 `topics/prompt_opt/tickets.jsonl`。类别分布是 billing 14、refund 11、invoice 10、bug 10、account 10、other 5。

60 条按编号对 3 取余分成三份,每份 20 条:训练集给优化器看错例,验证集给优化器挑版本,测试集到最后只量一次,优化器全程看不到。这三份的分工是今天最重要的纪律,Day 31 讲 dev/test 拆分时说过一遍,今天会用实测数字再证明一遍为什么要这样。

下面是三种方法共用的任务文件:

```python
# agent-60-lab/topics/prompt_opt/task.py
"""工单分类任务:数据、基线 prompt、评测函数。三种优化方法共用这一份。"""
from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from common.llm import LLMClient

DATA = Path(__file__).with_name("tickets.jsonl")
LABELS = ["refund", "billing", "invoice", "bug", "account", "other"]

# Day 28 Triage 里的类别定义,原样搬过来当起点
BASE_PROMPT = """把客服工单分到一个类别。
refund=要求退款/重复扣款/取消后退钱;billing=扣款失败、欠费、价格、升级计费;
invoice=开票、发票抬头、发票类型;bug=报错、功能异常;account=登录、验证码、权限、注销;other=其他"""

# 偷懒版起点:只有类别名,没有任何定义。用来看优化器能从错例里学回多少规则
BARE_PROMPT = "把客服工单分到一个类别:refund、billing、invoice、bug、account、other。"

OUTPUT_RULE = '只输出 JSON:{"category": "<类别>"}'


def load(split: str) -> list[dict[str, Any]]:
    rows = [json.loads(line) for line in DATA.read_text(encoding="utf-8").splitlines() if line]
    k = {"train": 1, "val": 2, "test": 0}[split]
    return [r for r in rows if int(r["id"][1:]) % 3 == k]


def classify(client: LLMClient, prompt: str, ticket: str) -> str:
    r = client.chat(
        [{"role": "system", "content": f"{prompt}\n\n{OUTPUT_RULE}"},
         {"role": "user", "content": ticket}],
        temperature=0,
        response_format={"type": "json_object"},
    )
    try:
        cat = json.loads(r.content).get("category", "")
    except json.JSONDecodeError:
        return "<bad-json>"
    return cat if cat in LABELS else f"<{cat}>"


def evaluate(client: LLMClient, prompt: str, rows: list[dict[str, Any]]) -> tuple[float, list[dict[str, Any]]]:
    with ThreadPoolExecutor(max_workers=8) as pool:
        preds = list(pool.map(lambda r: classify(client, prompt, r["ticket"]), rows))
    errors = [{**r, "pred": p} for r, p in zip(rows, preds) if p != r["label"]]
    return 1 - len(errors) / len(rows), errors


if __name__ == "__main__":
    client = LLMClient()
    for split in ["train", "val", "test"]:
        acc, errors = evaluate(client, BASE_PROMPT, load(split))
        print(f"{split}: {acc:.0%}  错 {len(errors)} 条", [f"{e['id']} {e['label']}→{e['pred']}" for e in errors])
    print(client.ledger)
```

<div class="line-notes">

- `from common.llm import LLMClient` Day 4 写的客户端,读 `.env` 里的 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_PRICE`,每次调用自动记账。实测用的是 DeepSeek `deepseek-flash`,`LLM_EXTRA_BODY` 关掉了思考模式。
- `DATA = Path(__file__).with_name("tickets.jsonl")` 数据文件和脚本放在同一个目录,不管你从哪里运行都能找到。
- `BASE_PROMPT = """把客服工单分到一个类别。` 起点一:Day 28 `Triage` 字段 description 里的类别定义,一字没改。它是你在 W4 手写的「还不错」的版本。
- `BARE_PROMPT = "把客服工单分到一个类别:refund、billing、invoice、bug、account、other。"` 起点二:只有类别名。拿它当起点,能看出优化器到底从错例里学到了多少东西。
- `OUTPUT_RULE = '只输出 JSON:{"category": "<类别>"}'` 输出格式单独放。优化器只改上面的「判定规则」部分,不碰格式,免得它把格式也改坏。DeepSeek 的 JSON 模式要求 prompt 里出现 json 字样,这一行正好满足。
- `k = {"train": 1, "val": 2, "test": 0}[split]` t01、t04、t07……进训练集,t02、t05……进验证集,t03、t06……进测试集。用编号取余而不是随机打乱,每次运行分法都一样,数字才能对比。
- `return [r for r in rows if int(r["id"][1:]) % 3 == k]` `r["id"][1:]` 把 `"t13"` 切成 `"13"`,13 % 3 = 1,所以 t13 在训练集。实测三份各 20 条。
- `temperature=0,` 分类任务用 0,尽量让同一个 prompt 每次给同样的答案。后面会看到,0 也不能保证完全一样。
- `response_format={"type": "json_object"},` Day 6 讲过的 JSON 模式,模型保证输出合法 JSON,但不保证字段值合法,所以下面还要检查。
- `return cat if cat in LABELS else f"<{cat}>"` 模型如果答了六类以外的词(比如 `payment`),原样包上尖括号返回,算错,但在错例列表里一眼就能看出它答了什么。
- `with ThreadPoolExecutor(max_workers=8) as pool:` 20 条工单并发跑,一份大约 3 秒。Day 12 讲过为什么线程池够用:时间都花在等网络。
- `errors = [{**r, "pred": p} for r, p in zip(rows, preds) if p != r["label"]]` 错例保留原始字段(包括 `why`),再加一个 `pred`。反思循环要用到 `why`。
- `print(f"{split}: {acc:.0%}  错 {len(errors)} 条"` 实测一次的输出是 `val: 85%  错 3 条 ['t11 billing→invoice', 't35 billing→other', 't38 refund→billing']`。

</div>

运行 `uv run python -m topics.prompt_opt.task`,我实测连跑四次,训练集和测试集每次都是 90%(各错 2 条),验证集三次 85%、一次 80%,差别全在 t14「希望报表能加一个按项目筛选的功能」:有时答 other,有时答 bug。temperature 是 0,模型也还是会抖。**20 条的验证集上,一条工单就是 5 个百分点**,记住这个数,后面判断「优化有没有用」全靠它。

四次的花费都是 60 次调用、输入约 7400 token,约 ¥0.018。

## 自己写一个反思循环

在用框架之前,先用 60 行代码把这件事自己做一遍,这样 GEPA 的日志你就能看懂了。

```python
# agent-60-lab/topics/prompt_opt/reflect.py
"""不用框架,60 行写一个「读错例 → 反思 → 改 prompt → 留出集验收」的循环。"""
from __future__ import annotations

import re
import sys

from common.llm import LLMClient
from topics.prompt_opt.task import BARE_PROMPT, BASE_PROMPT, evaluate, load

REFLECT = """你在维护一个客服工单分类 prompt。下面是当前 prompt 和它在一批工单上分错的例子,
每个例子附有标注员写的理由。请找出这些错误背后的规则,改写 prompt:
- 保留六个类别名不变,可以补充判定规则和优先级
- 写成通用规则,不要逐字抄工单原文
- 不超过 400 字
把新 prompt 放在 <prompt></prompt> 里。

当前 prompt:
{prompt}

分错的例子:
{errors}"""


def reflect(client: LLMClient, prompt: str, errors: list[dict]) -> str:
    lines = [f"- 工单:{e['ticket']}\n  模型答:{e['pred']}  正确:{e['label']}  理由:{e['why']}" for e in errors]
    r = client.chat([{"role": "user", "content": REFLECT.format(prompt=prompt, errors="\n".join(lines))}])
    m = re.search(r"<prompt>(.*?)</prompt>", r.content, re.S)
    return m.group(1).strip() if m else prompt


def main() -> None:
    client = LLMClient()
    train, val = load("train"), load("val")
    start = BARE_PROMPT if "--bare" in sys.argv else BASE_PROMPT
    best, (best_val, _) = start, evaluate(client, start, val)
    print(f"起点 val {best_val:.0%}")
    for step in range(1, 5):
        _, errors = evaluate(client, best, train)
        if not errors:
            print(f"第 {step} 轮:训练集全对,停")
            break
        cand = reflect(client, best, errors)
        cand_val, _ = evaluate(client, cand, val)
        keep = cand_val >= best_val
        print(f"第 {step} 轮:训练集错 {len(errors)} 条,候选 val {cand_val:.0%},{'采用' if keep else '丢弃'}")
        if keep:
            best, best_val = cand, cand_val
    test_acc, test_err = evaluate(client, best, load("test"))
    print(f"\n最终 prompt({len(best)} 字):\n{best}\n\ntest {test_acc:.0%}", [f"{e['id']} {e['label']}→{e['pred']}" for e in test_err])
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `REFLECT = """你在维护一个客服工单分类 prompt。` 这就是「反思 prompt」。GEPA 内部也有一个类似的模板,只是写得更讲究。
- `- 写成通用规则,不要逐字抄工单原文` 这一句很重要。不加的话,反思模型最省事的做法是把错的工单原文写进 prompt(「如果客户说注销账号还有 120 块余额,归 refund」),训练集马上全对,对新工单毫无帮助。
- `- 不超过 400 字` 给个长度上限,防止 prompt 越改越长。实测最终版本 471 字,模型并没有严格遵守,但没有失控。
- `lines = [f"- 工单:{e['ticket']}\n  模型答:{e['pred']}  正确:{e['label']}  理由:{e['why']}" for e in errors]` 每条错例给四样东西:原文、模型答案、正确答案、理由。实测第一轮的两条是 t13(注销退余额,答成 account)和 t22(PAY_TIMEOUT,答成 bug)。
- `m = re.search(r"<prompt>(.*?)</prompt>", r.content, re.S)` 用 Day 5 讲的 XML 标签把新 prompt 圈出来,`re.S` 让 `.` 能匹配换行。
- `return m.group(1).strip() if m else prompt` 模型偶尔忘了写标签,就当这一轮没改出东西,原样返回。
- `start = BARE_PROMPT if "--bare" in sys.argv else BASE_PROMPT` 命令行加 `--bare` 就从偷懒版起步。
- `best, (best_val, _) = start, evaluate(client, start, val)` 先量一下起点在验证集上的分数,作为门槛。
- `for step in range(1, 5):` 最多四轮。这个任务两三轮就收敛,轮数多了只会让它在验证集上过拟合。
- `_, errors = evaluate(client, best, train)` 用当前最好的版本跑训练集,拿错例。注意反思只看训练集的错例,不看验证集的。
- `keep = cand_val >= best_val` 验收规则:候选在验证集上不比当前差就采用。用 `>=` 而不是 `>`,是因为 20 条里分数常常打平,打平时接受新版本能让循环继续往前走;代价是可能接受一个只是「换了种说法」的版本。
- `test_acc, test_err = evaluate(client, best, load("test"))` 测试集只在最后量一次。中途绝对不能拿它来决定采不采用。
- `print(client.ledger)` 实测从 BASE 起步一共 101 次调用,输入 23317 / 输出 892 tokens,约 ¥0.041。

</div>

从 BASE 起步,实测输出(省略了中间一部分 prompt):

```text
起点 val 85%
第 1 轮:训练集错 2 条,候选 val 85%,采用
第 2 轮:训练集全对,停

最终 prompt(471 字):
将客服工单归入唯一类别：refund、billing、invoice、bug、account、other。

判定规则：
- refund：核心诉求是退钱，包括退款、取消后退费、重复扣款返还、注销/停用后余额退回。只要涉及“把钱退给客户”，优先于 account 等其他类别。
- billing：核心是付款或费用流程异常但未明确要求退款，如支付失败、扣款失败、欠费、价格/套餐、升级计费、付款页面超时导致订单未成功。
...
优先级：refund > billing > invoice > account > bug > other。先看用户主诉求和最终要解决的问题，不因出现“报错”“账号”等单个词就改类。

test 85% ['t12 bug→invoice', 't33 bug→billing', 't57 billing→other']
101 次调用 | 输入 23317 / 输出 892 tokens | 约 ¥0.0405
```

第 1 轮改出来的版本在验证集上和起点打平(85%),按 `>=` 的规则被采用;第 2 轮训练集已经全对,循环停了。看上去「训练集从 90% 到 100%、验证集没变差」,是个无害的改进。可测试集从起点的 90% **掉到了 85%**,多错的那条是 t33「订阅页面显示下次扣款日期是 11 月 31 日,这个日期不存在吧?」。原因就在最后那行优先级:反思模型从 t13(注销退余额)、t22(PAY_TIMEOUT)两个错例里总结出「钱的问题优先」,排了一个「refund > billing > … > bug」的顺序。t33 里有「扣款」两个字,按这个顺序就被归成了 billing,可它其实是页面把日期显示错了,标注员算 bug。

这就是今天要反复看到的现象:**优化器学到的规则在它见过的数据上是对的,但它会把规则写得比真实规范更宽。** 训练集里没有「带扣款字样的显示错误」这种例子,它就不知道这条优先级有例外。

再从 BARE 起步跑一次(`uv run python -m topics.prompt_opt.reflect --bare`)。BARE 在 `task.py` 的格式下,测试集起点是 80%(错 t12、t21、t57、t60,其中 t21、t60 是重复扣款,分别被答成了 invoice 和 billing)。反思循环:起点 val 85%,第 1 轮训练集错 5 条,候选 90% 采用;第 2 轮错 3 条,候选 90% 打平采用;第 3 轮训练集全对。最终 test 90%,错 t12 和 t33,花费约 ¥0.056。从一句话的 prompt 出发,两轮就把测试集从 80% 拉到了 90%,追平了你在 W4 手写的定义,这一点是真本事。而 t33 照样错,而且这次的优先级写成了「refund > billing > account > bug > invoice > other」,又是钱排最前,说明这条宽规则几乎是这批错例必然诱导出来的。

## 用 DSPy 跑 GEPA

DSPy 的写法和你前面 140 多天习惯的不一样。你不再拼 messages,而是声明「输入是什么、输出是什么」,由 DSPy 的 adapter 把它渲染成 prompt、解析返回值。

```python
# agent-60-lab/topics/prompt_opt/gepa_opt.py
"""用 DSPy 的 GEPA 优化同一个分类任务。依赖:uv add dspy。加 --bare 从偷懒版 prompt 起步"""
from __future__ import annotations

import json
import logging
import os
import sys
from typing import Literal

import dspy
from dotenv import load_dotenv

from topics.prompt_opt.task import BARE_PROMPT, BASE_PROMPT, load

load_dotenv()
logging.getLogger("dspy").setLevel(logging.WARNING)
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")
START = BARE_PROMPT if "--bare" in sys.argv else BASE_PROMPT


def make_lm(**kw) -> dspy.LM:
    # openai/ 前缀让 LiteLLM 按 OpenAI 兼容协议调用,DeepSeek、百炼、Kimi 都能这样接
    return dspy.LM(f"openai/{os.environ['LLM_MODEL']}", api_base=os.environ["LLM_BASE_URL"],
                   api_key=os.environ["LLM_API_KEY"], extra_body=EXTRA, cache=False, **kw)


class Triage(dspy.Signature):
    ticket: str = dspy.InputField(desc="客户工单原文")
    category: Literal["refund", "billing", "invoice", "bug", "account", "other"] = dspy.OutputField()


def to_examples(split: str) -> list[dspy.Example]:
    return [dspy.Example(ticket=r["ticket"], label=r["label"], why=r["why"]).with_inputs("ticket")
            for r in load(split)]


def metric(gold, pred, trace=None, pred_name=None, pred_trace=None):
    if pred.category == gold.label:
        return dspy.Prediction(score=1.0, feedback="分类正确。")
    return dspy.Prediction(score=0.0, feedback=f"应为 {gold.label},模型答 {pred.category}。标注理由:{gold.why}")


def accuracy(program: dspy.Module, split: str) -> float:
    ev = dspy.Evaluate(devset=to_examples(split), metric=lambda g, p, t=None: float(p.category == g.label),
                       num_threads=8, display_progress=False)
    return ev(program).score / 100


def tokens(lm: dspy.LM) -> str:
    u = [h.get("usage") or {} for h in lm.history]
    return f"{len(u)} 次调用,输入 {sum(x.get('prompt_tokens', 0) for x in u)} / 输出 {sum(x.get('completion_tokens', 0) for x in u)} tokens"


def main() -> None:
    task_lm, reflection_lm = make_lm(temperature=0), make_lm(temperature=1.0)
    dspy.configure(lm=task_lm)
    student = dspy.Predict(Triage.with_instructions(START))
    print(f"起点 val {accuracy(student, 'val'):.0%}  test {accuracy(student, 'test'):.0%}")

    gepa = dspy.GEPA(metric=metric, max_metric_calls=300, reflection_lm=reflection_lm,
                     reflection_minibatch_size=3, num_threads=8, track_stats=True)
    best = gepa.compile(student, trainset=to_examples("train"), valset=to_examples("val"))

    r = best.detailed_results
    for i, (score, parents) in enumerate(zip(r.val_aggregate_scores, r.parents)):
        print(f"候选 {i}:val {score:.0%},父节点 {parents}")
    print(f"选中候选 {r.best_idx}:val {accuracy(best, 'val'):.0%}  test {accuracy(best, 'test'):.0%}")
    print("\n新指令:\n" + best.signature.instructions)
    best.save("topics/prompt_opt/triage_gepa.json")
    print(f"\n执行模型:{tokens(task_lm)}\n反思模型:{tokens(reflection_lm)}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import dspy` 2026-10 实测版本 3.4.1。它底层用 LiteLLM 发请求,不走你的 `LLMClient`,所以记账要另算(见 `tokens()`)。
- `logging.getLogger("dspy").setLevel(logging.WARNING)` GEPA 每一轮都打 INFO 日志,包括候选 prompt 全文。先关掉,想看过程再开。
- `EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")` 和 Day 28 一样,读 `.env` 里的 `{"thinking": {"type": "disabled"}}`。DeepSeek 默认开思考,分类任务开思考又慢又贵。
- `return dspy.LM(f"openai/{os.environ['LLM_MODEL']}", api_base=os.environ["LLM_BASE_URL"],` 模型名前面加 `openai/`,LiteLLM 就按 OpenAI 兼容协议去调 `api_base`。实测拼出来是 `openai/deepseek-flash`。
- `api_key=os.environ["LLM_API_KEY"], extra_body=EXTRA, cache=False, **kw)` `extra_body` 会被 LiteLLM 原样透传。`cache=False` 关掉 DSPy 的磁盘缓存,否则第二次运行会直接读缓存,分数和花费都不真实。
- `class Triage(dspy.Signature):` Signature 就是「这个步骤的输入输出契约」。类的 docstring(或者 `with_instructions` 设置的文字)就是指令,也是 GEPA 要优化的东西。
- `category: Literal["refund", "billing", "invoice", "bug", "account", "other"] = dspy.OutputField()` 用 `Literal` 约束输出,DSPy 会在 prompt 里列出可选值,并在解析时校验,答出别的词会报解析错误。
- `return [dspy.Example(ticket=r["ticket"], label=r["label"], why=r["why"]).with_inputs("ticket")` `Example` 像一个字典。`with_inputs("ticket")` 告诉 DSPy 只有 ticket 是输入,label 和 why 是答案,不能喂给模型。
- `def metric(gold, pred, trace=None, pred_name=None, pred_trace=None):` GEPA 要求评分函数接收五个参数,少一个会在构造时直接报 `GEPA metric must accept five arguments`。后三个今天用不上。
- `return dspy.Prediction(score=0.0, feedback=f"应为 {gold.label},模型答 {pred.category}。标注理由:{gold.why}")` 这一行是整个 GEPA 的灵魂:除了分数,还返回一段文字反馈。反思模型读到的就是它。比如 t22 答错时,反馈是 `应为 billing,模型答 bug。标注理由:付款没成功属于 billing,不是 bug`。
- `return ev(program).score / 100` `Evaluate` 返回的 score 是百分数(95.0),除以 100 和前面的格式统一。
- `u = [h.get("usage") or {} for h in lm.history]` 每个 `dspy.LM` 都把调用记录存在 `history` 里,从里面加总 token。LiteLLM 的价目表里没有 `deepseek-flash`,它自己算出来的 cost 是 0,不能用。
- `task_lm, reflection_lm = make_lm(temperature=0), make_lm(temperature=1.0)` 执行模型用 0,反思模型用 1.0。DSPy 的报错提示里推荐反思模型用强一点的模型、温度 1.0,让它敢写出不一样的版本。今天为了省事两者用同一个模型。
- `student = dspy.Predict(Triage.with_instructions(START))` `Predict` 是最简单的模块:一次调用直接出答案。`with_instructions` 返回一个指令换成 START 的新 Signature。
- `gepa = dspy.GEPA(metric=metric, max_metric_calls=300, reflection_lm=reflection_lm,` 预算三选一:`auto="light"/"medium"/"heavy"`、`max_full_evals`、`max_metric_calls`,只能设一个,设两个会断言失败。用调用次数封顶最好估钱。
- `reflection_minibatch_size=3, num_threads=8, track_stats=True)` 每轮只拿 3 条训练样本给反思模型看;`track_stats=True` 才会在结果上挂 `detailed_results`。
- `best = gepa.compile(student, trainset=to_examples("train"), valset=to_examples("val"))` 训练集用来找错例,验证集用来给每个候选打全量分、维护 Pareto 前沿。测试集不传进去。
- `for i, (score, parents) in enumerate(zip(r.val_aggregate_scores, r.parents)):` 把每个候选的验证集分数和它是从哪个版本改出来的打出来,能看出演化的谱系。
- `print("\n新指令:\n" + best.signature.instructions)` 选中候选的指令。如果选中的是候选 0,这里打印的就是原来的起点。
- `best.save("topics/prompt_opt/triage_gepa.json")` 保存成 JSON,上线时 `dspy.Predict(Triage)` 再 `.load(...)` 就行。这个文件要进 git,和代码一起评审。

</div>

GEPA 内部每评一个小批都会打一行进度条(DSPy 3.4.1 里这个进度条写死开着,参数关不掉),几百行刷屏。用 grep 把带 `it/s` 的行滤掉,屏幕上只留结果:

```bash
uv run python -m topics.prompt_opt.gepa_opt 2>/dev/null | grep -av "it/s"
uv run python -m topics.prompt_opt.gepa_opt --bare 2>/dev/null | grep -av "it/s"
```

先看 BASE 起步,结果出乎我意料:

```text
起点 val 95%  test 95%
候选 0:val 95%,父节点 [None]
候选 1:val 90%,父节点 [0]
候选 2:val 90%,父节点 [0]
候选 3:val 90%,父节点 [0]
候选 4:val 90%,父节点 [0]
候选 5:val 90%,父节点 [0]
候选 6:val 90%,父节点 [0]
候选 7:val 90%,父节点 [0]
候选 8:val 90%,父节点 [0]
选中候选 0:val 95%  test 95%

新指令:
把客服工单分到一个类别。
refund=要求退款/重复扣款/取消后退钱;billing=扣款失败、欠费、价格、升级计费;
invoice=开票、发票抬头、发票类型;bug=报错、功能异常;account=登录、验证码、权限、注销;other=其他
```

同样的指令,同样的模型,放进 DSPy 的格式里,起点就是 val 95%、test 95%,比 `task.py` 里我手拼的版本(val 80–85%、test 90%)高了一截。(在我前一次运行里,同一个起点的测试集量出来是 90%,同一个程序前后两次差一条工单,又是噪声。)区别在 adapter:DSPy 会把输入输出字段渲染成 `[[ ## ticket ## ]]`、`[[ ## category ## ]]` 这种带分隔标记的结构,还把 `Literal` 的六个可选值明确列出来。这件事本身就值得记一笔:**prompt 的格式和字段约束,有时比措辞的影响还大。** GEPA 在 300 次调用的预算里提出了 8 个新候选,全都是从候选 0 直接改出来的,验证集全是 90%,没有一个比起点好,最后选回了候选 0,也就是原样返回。它没有为了「看起来优化过」硬塞一个版本给你,这是对的行为。

再看 BARE 起步:

```text
起点 val 90%  test 75%
候选 0:val 90%,父节点 [None]
候选 1:val 95%,父节点 [0]
候选 2:val 95%,父节点 [1]
选中候选 1:val 95%  test 80%

新指令:
将客服工单分类到以下类别之一：refund、billing、invoice、bug、account、other。

分类规则：
- account：登录失败、登录后跳转回登录页、账户设置（如权限设置）等相关问题。
- bug：产品功能异常、错误、崩溃等。注意：登录失败即使伴随错误码，也视为 account 类，而非 bug。
- invoice：发票开具、作废、重开等涉及发票本身的问题。
- billing：账单、费用、扣款、支付相关问题。
- refund：退款申请、退款进度、退款政策等。
- other：无法归入以上类别的问题。

请根据工单内容判断最合适的类别，输出 JSON 格式：{"category": "类别"}。

执行模型:380 次调用,输入 158223 / 输出 5119 tokens
反思模型:2 次调用,输入 1232 / 输出 447 tokens
```

这一组数字最有教育意义,有三个地方值得看。

一是**反思模型只被调了 2 次**。300 次评分预算,绝大部分花在了「从训练集随机抽 3 条、用当前候选跑一遍」上,而 BARE 在训练集上本来就对了大半(`task.py` 格式下是 75%,DSPy 格式只会更高),随机抽 3 条全对的概率不低。把日志级别调回 INFO,能看到满屏的 `All subsample scores perfect for parent 1. Skipping.`,就是这个意思:小批全对,没有错例可反思,这一轮白跑。训练集几乎全对的时候,GEPA 的预算会大量浪费在这里。

二是选中的候选 1 在测试集上只从 75% 到 80%,多对了一条。我把它在测试集上的错例打出来:t12(发票 PDF 打不开)答成 invoice,t21(同一张发票被扣两笔)和 t60(被扣了两次年费)答成 billing,t57(教育优惠)答成 other。t21 和 t60 都是重复扣款。看新指令里 refund 那一行:「退款申请、退款进度、退款政策等」,**「重复扣款」这几个字没了**,反倒是 billing 写着「扣款」。这正是 ACE 论文说的简短偏好:反思模型把规则写得干净利落,顺手丢掉了最关键的细节。

三是反思模型自作主张在指令末尾加了输出格式那一句。DSPy 有自己的输出格式约定,这一句多余但无害。你在审 diff 时会看到这类东西,删掉就好。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="Pareto 前沿示意:横向是验证集里的样本,纵向是候选,每格表示该候选在该样本上对或错;GEPA 保留在至少一个样本上不被其他候选全面超越的候选">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="11">
<text x="20" y="24" fill="var(--ink)" font-size="12">验证集样本 →</text>
<text x="150" y="44" fill="var(--ink-soft)">v1</text><text x="190" y="44" fill="var(--ink-soft)">v2</text><text x="230" y="44" fill="var(--ink-soft)">v3</text><text x="270" y="44" fill="var(--ink-soft)">v4</text><text x="310" y="44" fill="var(--ink-soft)">v5</text><text x="350" y="44" fill="var(--ink-soft)">v6</text>
<text x="20" y="72" fill="var(--ink)">候选 A</text>
<rect x="145" y="58" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="185" y="58" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="225" y="58" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="265" y="58" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="305" y="58" width="24" height="20" fill="none" stroke="var(--rule)"/><rect x="345" y="58" width="24" height="20" fill="none" stroke="var(--rule)"/>
<text x="390" y="72" fill="var(--ink-soft)">总分 4/6,v1–v4 最好 → 留</text>
<text x="20" y="104" fill="var(--ink)">候选 B</text>
<rect x="145" y="90" width="24" height="20" fill="none" stroke="var(--rule)"/><rect x="185" y="90" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="225" y="90" width="24" height="20" fill="none" stroke="var(--rule)"/><rect x="265" y="90" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="305" y="90" width="24" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><rect x="345" y="90" width="24" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="390" y="104" fill="var(--ink-soft)">总分 4/6,只有它做对 v5、v6 → 留</text>
<text x="20" y="136" fill="var(--ink)">候选 C</text>
<rect x="145" y="122" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="185" y="122" width="24" height="20" fill="none" stroke="var(--rule)"/><rect x="225" y="122" width="24" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><rect x="265" y="122" width="24" height="20" fill="none" stroke="var(--rule)"/><rect x="305" y="122" width="24" height="20" fill="none" stroke="var(--rule)"/><rect x="345" y="122" width="24" height="20" fill="none" stroke="var(--rule)"/>
<text x="390" y="136" fill="var(--ink-soft)">做对的 A 全都做对 → 淘汰</text>
<text x="20" y="176" fill="var(--ink-soft)">只按总分选,A 和 B 打平时随便丢一个,B 学到的「v5、v6 那类规则」就没了。</text>
<text x="20" y="196" fill="var(--ink-soft)">Pareto 前沿把 A、B 都留下,下一轮可能从 B 出发改,也可能把 A、B 合并(use_merge)。</text>
<text x="20" y="216" fill="var(--ink-soft)">最终交给你的,仍然是验证集总分最高的那个(best_idx)。</text>
</g>
</svg>
<figcaption>GEPA 的「P」:保留每个样本上的最好者,而不是只保留总分第一。图里的 v1–v6 是示意,不是实测。</figcaption>
</figure>

花费按 `.env` 里 `LLM_PRICE=0.04,2,8`(每百万 token:缓存命中 0.04 元、未命中 2 元、输出 8 元)、假设全部未命中来估。BARE 那次执行模型 158223 × 2 / 10⁶ + 5119 × 8 / 10⁶ ≈ ¥0.36,反思模型只有 2 次调用,不到 1 分钱,合计约 ¥0.36;BASE 那次执行模型 152245 输入、5201 输出约 ¥0.35,反思模型 8 次约 ¥0.03,合计约 ¥0.38。每次耗时都在两分钟以内。执行调用比 300 多,是因为预算只数评分次数,开头和结尾我自己量分数的那几十次不算在里面。把 dspy 的日志级别调回 INFO,GEPA 启动时会打一行 `This amounts to 7.50 full evals on the train+val set`,意思是 300 次评分约等于把训练加验证的 40 条跑 7.5 遍。

下面两个视频一个是 GEPA 作者在 AI Engineer 大会上讲的,一个是国内 UP 主录屏实操 GEPA + DSPy,和今天的代码路线基本一致。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/OA-Mc60Rboo" title="Beating RL With Reflection: GEPA and Optimize Anything" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Lakshya A. Agrawal《Beating RL With Reflection: GEPA and Optimize Anything》· 作者本人讲反思和 Pareto 前沿为什么比只看分数省样本,重点看前半段的机制讲解。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1iVSeBLEP5&autoplay=0&high_quality=1" title="深入实践 Prompt 自动优化（APO）—— GEPA + DSPY｜录屏精简版" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Koala聊开源 · 深入实践 Prompt 自动优化（APO）—— GEPA + DSPY｜录屏精简版 · 15 分钟,中文讲解 metric 怎么写反馈、怎么看优化日志,适合跟着敲一遍。</figcaption>
</figure>

## ACE:不重写,只往手册里加条目

前两种做法都是「整段重写」。ACE 论文担心的正是整段重写:每一轮反思模型都可能顺手删掉它觉得啰嗦的细节,改上十几轮,早期攒下的经验就没了。ACE 的替代方案是让 prompt 由一个固定的「基础说明」加一本「手册」组成,手册里是一条条带编号的规则,每次只增删改条目,并且由一段确定性的代码(不是大模型)来做整理:去重、合并、淘汰。

下面是一个 70 行的最小版本,保留了 ACE 的三个关键点:增量更新、确定性整理、每条规则的帮/害计数。完整的 ACE 还有多轮反思、按语义去重、按需检索相关条目,看官方仓库。

```python
# agent-60-lab/topics/prompt_opt/ace_lite.py
"""ACE 的最小版:prompt 不整体重写,只往「手册」里一条一条加规则,并记录每条规则帮了几次、害了几次。"""
from __future__ import annotations

import difflib
import json
import sys
from dataclasses import dataclass

from common.llm import LLMClient
from topics.prompt_opt.task import BARE_PROMPT, BASE_PROMPT, classify, evaluate, load

REFLECT = """客服工单分类器分错了一条。请总结出一条能避免这类错误的通用规则(一句话,不超过 40 字,不要抄工单原文)。
只输出 JSON:{{"rule": "..."}}

工单:{ticket}
模型答:{pred}
正确:{label}
标注理由:{why}"""


@dataclass
class Bullet:
    id: int
    text: str
    helpful: int = 0
    harmful: int = 0


def render(base: str, book: list[Bullet]) -> str:
    if not book:
        return base
    return base + "\n\n补充规则(来自历史错例):\n" + "\n".join(f"[{b.id}] {b.text}" for b in book)


def curate(book: list[Bullet], rule: str, limit: int = 15) -> bool:
    """确定性的整理步骤:和已有规则太像就不加,超过上限就淘汰净分最低的。"""
    if any(difflib.SequenceMatcher(None, rule, b.text).ratio() > 0.6 for b in book):
        return False
    book.append(Bullet(id=max((b.id for b in book), default=0) + 1, text=rule))
    if len(book) > limit:
        book.remove(min(book, key=lambda b: b.helpful - b.harmful))
    return True


def main() -> None:
    client = LLMClient()
    base = BARE_PROMPT if "--bare" in sys.argv else BASE_PROMPT
    book: list[Bullet] = []
    for row in load("train"):
        before = classify(client, render(base, book), row["ticket"])
        if before == row["label"]:
            continue
        r = client.chat([{"role": "user", "content": REFLECT.format(pred=before, **row)}],
                        response_format={"type": "json_object"})
        rule = json.loads(r.content).get("rule", "").strip()
        if not rule or not curate(book, rule):
            continue
        after = classify(client, render(base, book), row["ticket"])
        book[-1].helpful += after == row["label"]
        book[-1].harmful += after != row["label"]
        print(f"{row['id']}:{before}→{after}  新规则 [{book[-1].id}] {rule}")
    prompt = render(base, book)
    for split in ["val", "test"]:
        acc, err = evaluate(client, prompt, load(split))
        print(f"{split} {acc:.0%}", [f"{e['id']} {e['label']}→{e['pred']}" for e in err])
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `REFLECT = """客服工单分类器分错了一条。` 和前面的反思 prompt 不同,这里一次只看一条错例,只要求产出一条规则。粒度小,改动就小。
- `只输出 JSON:{{"rule": "..."}}` 双花括号是因为后面要用 `str.format`,单个 `{` 会被当成占位符。
- `class Bullet:` 手册里的一条。`helpful` 和 `harmful` 是 ACE 论文里的计数器,记录这条规则加进来之后帮了几次、害了几次。
- `return base + "\n\n补充规则(来自历史错例):\n" + "\n".join(f"[{b.id}] {b.text}" for b in book)` 基础说明永远不动,手册接在后面。编号让你在日志里能指着某一条说「就是 [5] 这条害的」。
- `if any(difflib.SequenceMatcher(None, rule, b.text).ratio() > 0.6 for b in book):` 用字符串相似度做去重,0.6 是我试出来的阈值。真实系统里该用 embedding 算语义相似度(Day 15),这里为了不多装依赖用了标准库。
- `book.remove(min(book, key=lambda b: b.helpful - b.harmful))` 超过 15 条就淘汰净分最低的。这一步完全由代码做,不让大模型决定删什么,避免它顺手删掉有用的细节。
- `for row in load("train"):` 训练集按顺序过一遍,相当于「上线后一条条遇到工单」。这比一次性看全部错例更接近 Agent 在线积累经验的样子。
- `before = classify(client, render(base, book), row["ticket"])` 用当前手册先答一次,对了就跳过,只从错误里学。
- `r = client.chat([{"role": "user", "content": REFLECT.format(pred=before, **row)}],` `**row` 把 ticket、label、why 一次性填进模板。
- `after = classify(client, render(base, book), row["ticket"])` 加了新规则后立刻在这条工单上重答一次。答对了记一次 helpful。这是最粗糙的计数方式,完整的 ACE 会在后续所有用到这条规则的样本上持续计数。
- `print(f"{row['id']}:{before}→{after}  新规则 [{book[-1].id}] {rule}")` 实测 BARE 起步的第一行是 `t01:billing→refund  新规则 [1] 凡重复扣款、多扣费的工单，一律归为退款类。`,意思是 t01 本来答 billing,加了规则 [1] 以后答对了。

</div>

从 BARE 起步,实测输出:

```text
t01:billing→refund  新规则 [1] 凡重复扣款、多扣费的工单，一律归为退款类。
t13:account→refund  新规则 [2] 工单涉及退款或退余额时，优先归为退款类，而非账户类。
t22:bug→billing  新规则 [3] 涉及支付失败、未扣款、订单未成功的问题归为 billing，不要归为 bug。
t31:bug→account  新规则 [4] 登录或鉴权失败类工单归 account，不因含错误码而判为 bug
val 90% ['t11 billing→invoice', 't35 billing→other']
test 90% ['t12 bug→invoice', 't57 billing→other']
68 次调用 | 输入 10957 / 输出 503 tokens | 约 ¥0.0259
```

四条规则,每条都对应一个真实的错例,措辞具体,没有互相冲突。测试集从 BARE 起点的 80% 到了 90%,而且错的两条(t12、t57)和手写的 BASE 一模一样,也就是说,ACE 用四句话补回了你在 W4 写的那段定义。注意 [1]「凡重复扣款、多扣费的工单,一律归为退款类」:因为手册是增量加的,这条细节不会像 GEPA 那次一样在改写里被弄丢。

但别以为增量就没有坑。我第一次跑这份数据时(当时有几条工单的金额写法稍有不同,后来为了和 CloudLedger 的价格表对齐改掉了),反思模型给出了这样两条:

```text
[1] 涉及重复扣款或金额异常时归为refund，不以客户是否提及退款为准。
[5] 涉及账单金额不一致或扣款记录对不上时归为 billing，不归 refund。
```

[1] 说「金额异常归 refund」,[5] 说「扣款记录对不上归 billing」,两条直接打架。[1] 是从 t01(重复扣款)学来的,反思模型把「重复扣款」泛化成了「金额异常」,写宽了;到 t49(扣款短信和账单对不上)时它被这条宽规则带错,又学了一条反方向的 [5] 来补救。两条都留在手册里,模型只能自己判断听谁的。那一次的测试集只有 80%,t39「报表合计和明细差 0.01」就是被「钱优先」的规则吸成 billing 的。

这正是 ACE 设计里帮/害计数器要解决的问题:如果 [1] 在后续样本上害的次数多于帮的次数,整理步骤应该把它删掉或改写。我们的最小版只在加入那一刻计一次数,所以没机会发现。这也提醒你,ACE 的价值不在「加规则」这个动作,而在**长期运行时的整理**:去重、发现冲突、淘汰坏规则。只做前一半,手册会越来越长、越来越自相矛盾。

从 BASE 起步只学了两条。第二条很有意思:

```text
t13:account→refund  新规则 [1] 工单涉及资金退回或退款诉求时，优先归为退款而非账户类。
t22:bug→bug  新规则 [2] 付款失败或扣款异常类问题归入账单类，而非程序缺陷类。
val 85% ['t11 billing→invoice', 't14 other→bug', 't35 billing→other']
test 90% ['t12 bug→invoice', 't57 billing→other']
64 次调用 | 输入 10784 / 输出 439 tokens | 约 ¥0.0251
```

`t22:bug→bug` 表示加了规则 [2] 以后,t22 还是错的,所以 [2] 被记了一次 harmful。规则本身没写错,只是 BASE 里「bug=报错」那句定义更直接,模型更听它的。这类「加了没用」的规则在长期运行里会越积越多,正好用计数器淘汰。BASE 起步的 ACE 测试集 90%,和起点一样,花费约 ¥0.025,是三种方法里最便宜的,因为它只在出错时调一次反思。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/czy7hvXIImE" title="GEPA Explained!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Weaviate · GEPA Explained! · 用论文里的图把反思变异、Pareto 选择、合并三步过一遍,比读论文快,适合看完今天的代码再看。</figcaption>
</figure>

## 把所有数字放在一张表里

| 做法 | 起点 | 验证集 | 测试集 | 花费(约) |
| --- | --- | --- | --- | --- |
| 手写起点(`task.py`,跑四次) | BASE | 80–85% | 90% | ¥0.018/次 |
| 自写反思循环 | BASE | 85% → 85% | 85% | ¥0.041 |
| ACE 最小版 | BASE | 85% | 90% | ¥0.025 |
| DSPy 格式不优化 | BASE | 95% | 95%(前一次运行 90%) | 几分钱 |
| GEPA(300 次评分) | BASE | 95%(选回起点) | 95% | ¥0.38 |
| 手写起点(`task.py`) | BARE | 85% | 80% | ¥0.012 |
| 自写反思循环 | BARE | 85% → 90% | 90% | ¥0.056 |
| ACE 最小版 | BARE | 90% | 90% | ¥0.026 |
| DSPy 格式不优化 | BARE | 90% | 75% | 几分钱 |
| GEPA(300 次评分) | BARE | 90% → 95% | 80% | ¥0.36 |

都是单次运行。按 Day 69 的说法,20 条样本上 90% 的准确率,95% 置信区间大约是 70%–97%,宽得能开车过去。所以这张表能下的结论很有限,我只敢说三件事:

第一,**起点写得好的时候,三种方法都没让测试集变好**,自写循环还退了一条(t33)。BASE 是你在 W4 认真写过的定义,剩下的错误要么是标注本身就模棱两可(t57「教育优惠」算价格咨询还是 other),要么需要比训练集更多的反例才能学对。这时候花钱跑优化器,得到的多半是一个「换了说法」的版本。

第二,**起点很粗的时候,「从错例和理由里学规则」是真的有效**。BARE 在 `task.py` 格式下测试集 80%,自写循环和 ACE 都拉到了 90%,追平了手写的 BASE。GEPA 只从 75% 到 80%,原因前面说了:预算大半花在了全对的小批上,唯一一次有效改写还丢掉了「重复扣款」。如果你手上的 prompt 本来就写得很粗,自动优化值得一试,但 GEPA 在这么小的训练集上并不比 60 行的循环强。

第三,换成 DSPy 的结构化格式,不做任何优化,BASE 的验证集就到了 95%,测试集 90–95%。这提醒你先把最便宜的改动做了(清晰的字段、明确的可选值),再上优化器。

还有一条贯穿全表的:验证集被优化器拿来挑版本,它看过的东西越多,验证分数就越不可信。表里所有「验证集上涨」都只能当参考,能下结论的只有测试集那一列,而那一列的差距多数在一两条工单之内,也就是 5–10 个百分点,刚好在噪声范围里。

在这么小的数据上很难看出 GEPA 论文里那种几个到十几个百分点的提升。论文里的任务是多跳问答、指令遵循、隐私改写这类空间更大的任务,数据也多得多。想看到真实收益,先把测试集做到几百条。

## 真要上生产,我会这么用

把优化器当成一个「提 PR 的同事」,不要当成自动发布。具体做法:

优化跑在离线环境,输入是 W5 的 golden 集(训练和验证用 dev 部分),输出是一个候选 prompt 文件。候选 prompt 和原版做 diff,由人看一遍规则写得合不合业务。今天的 t33 就是例子,「钱的问题优先」这条规则人一眼就能看出有例外,优化器看不出来。看完之后走 Day 35 的 CI 门禁,在 test 集上和基线比,关键用例不许新挂。合并以后它就是一个普通的 prompt 版本,有版本号、能回滚。

另外三件事比选哪个优化器更重要。反馈文字要写具体,`why` 字段写成「应为 billing」没用,要写「付款没成功属于 billing,不是 bug」;今天三种方法都依赖它。反思模型尽量用比执行模型强的,它负责的是「总结规律」,能力不够就会把规则写宽。测试集要比验证集大,而且要定期从线上补新样本进去,否则优化器总能找到在你那几十条数据上更好看、上线却更差的版本。线上样本怎么来,是明天 Day 144 的内容。

## 动手练习

1. **量一下噪声。** 把 `task.py` 连跑五次,记录 val 和 test 每次的分数和错的工单 id。哪几条会时对时错?它们有什么共同点?
2. **反馈文字的作用。** 把 `gepa_opt.py` 的 `metric` 改成只返回分数(`return float(pred.category == gold.label)`,GEPA 允许返回 float),BARE 起步再跑一次,对比候选数量、选中版本的规则写法和测试集分数。
3. **扩大验证集。** 把 `load()` 改成训练 15 条、验证 25 条、测试 20 条(测试集不动),再跑一次 GEPA,看选中候选的测试分数有没有变。
4. **给 ACE 加上长期计数。** 改 `ace_lite.py`:每处理完一条训练样本,用当前手册把之前所有训练样本重答一遍,答对就给每条规则 +1 helpful、答错就 +1 harmful(粗糙但能用),最后删掉 harmful > helpful 的规则,看 [1] 这类宽规则会不会被删掉。
5. **用到你自己的评测集。** 把 Day 35 的 `w5/cases/golden.jsonl` 里 `split == "dev"` 的用例拆成训练和验证,对 Day 28 的分类 prompt 跑一次 GEPA,用 `split == "test"` 量结果,把优化前后的 prompt diff 和分数写进 `notes/prompt-opt.md`。

### 验收标准

- 五个脚本都能在仓库根目录用 `uv run python -m topics.prompt_opt.xxx` 跑通,花费和输出格式与文中一致(分数允许有一两条的出入)。
- 练习 1 写出至少一条「时对时错」的工单,并说出它为什么模棱两可。
- 练习 2 或 3 有一张对比表,包括验证集、测试集、花费三列,并写一句你的结论。
- 能对着 GEPA 的候选列表,说出哪个候选是从哪个改来的、最后为什么选它。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 自动 prompt 优化(APO) | 让程序替你迭代 prompt:跑评测、读错例、生成新版本、按分数挑选。 |
| DSPy | 斯坦福开源框架,用 Signature 和 Module 声明调用逻辑,prompt 由框架生成,并提供多种优化器。 |
| Signature | DSPy 里一个步骤的输入输出契约,包括字段名、类型、描述和指令。 |
| 优化器 / teleprompter | DSPy 里调整程序的算法,如 BootstrapFewShot、MIPROv2、GEPA。 |
| GEPA | Genetic-Pareto,用自然语言反思改写 prompt,并用 Pareto 前沿保留多个候选的优化器。 |
| 反思模型 | 读执行轨迹和反馈、写出新 prompt 的模型,通常要求比执行模型强。 |
| 文字反馈 | 评分函数在分数之外返回的解释,GEPA 和 ACE 都靠它知道该往哪改。 |
| Pareto 前沿 | 在多个维度(这里是每个验证样本)上不被其他候选全面超越的候选集合。 |
| ACE | Agentic Context Engineering,把上下文当成可增量更新的手册,由生成、反思、整理三个角色维护。 |
| 上下文坍缩 | 反复整段改写后,早先积累的细节被逐渐抹掉的现象。 |
| 简短偏好 | 模型改写时倾向写得短,丢掉有用的领域细节。 |
| 过拟合验证集 | 用验证集挑版本挑得太多,验证分数虚高,换新数据就掉下来。 |

## 常见误区

**拿测试集挑版本。** 一旦测试集参与了「采用还是丢弃」的决定,它就变成了第二个验证集,你再也没有一个干净的数字。今天的代码里测试集只在最后出现一次,这是纪律,不是风格。

**验证集涨了就算优化成功。** 今天 GEPA 从 BARE 起步,验证集 90% 到 95%,测试集只多对了一条;自写循环从 BASE 起步,验证集没变、训练集全对,测试集反而少对一条。小数据集上验证分数是被优化器刻意抬高的,只能当参考。

**只给分数不给理由。** 评分函数只返回 0/1,反思模型只知道「错了」,不知道「为什么错」,只能瞎猜。把标注时的判断理由写下来,成本很低,回报很高。

**以为优化器能替你定规则。** 它学到的是「在你给的数据上分数更高的写法」。t33 那条「钱优先」的规则人一看就知道有例外,优化器看不出来。优化结果一定要有人审。

**一上来就用 GEPA。** 先确认最便宜的改动做完了:字段结构清楚、可选值列明、输出格式固定。今天光是换成 DSPy 的格式,验证集就从 80–85% 到了 95%。

**手册只加不减。** 增量更新如果没有整理步骤,规则会越积越多、互相打架,我第一次跑时的 [1] 和 [5] 就是例子,BASE 起步那条「加了没用」的 [2] 也是。ACE 论文的重点恰恰在整理。

## 学习资料

### 文档与文章

- [DSPy 官网](https://dspy.ai):先看首页的 Signature 和 Module 示例,再看 Optimizers 一节对各优化器的一句话介绍,30 分钟。
- [DSPy · GEPA API 文档](https://dspy.ai/api/optimizers/GEPA/overview/):`GEPAFeedbackMetric` 的五参数签名、返回 `dspy.Prediction(score, feedback)` 的写法、预算参数,今天的代码照着它写,20 分钟。
- [DSPy · GEPA 教程](https://dspy.ai/tutorials/gepa_ai_program/):官方的完整例子,看它怎么在 metric 里写有用的反馈,30 分钟。
- [GEPA 论文(arXiv 2507.19457)](https://arxiv.org/abs/2507.19457):重点看第 3 节算法和图 2 的 Pareto 选择,实验部分扫一眼,1 小时。ICLR 2026 版本在 [proceedings 页面](https://proceedings.iclr.cc/paper_files/paper/2026/hash/0e9e708b6f48e14fd0ac29e167413f76-Abstract-Conference.html)。
- [ACE 论文(arXiv 2510.04618)](https://arxiv.org/abs/2510.04618):看引言里对 brevity bias 和 context collapse 的举例,以及生成、反思、整理三个角色的分工图,45 分钟。
- [DSPy 论文(arXiv 2310.03714)](https://arxiv.org/abs/2310.03714):想理解「把 prompt 当程序编译」这个立场就读前两节,30 分钟。
- [Hamel Husain · Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):为什么先有评测再谈优化,和今天的结论一致,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV16ATuzoE8o&autoplay=0&high_quality=1" title="吴恩达《DSPy：构建与优化智能代理应用|DSPy: Build and Optimize Agentic Apps》中英字幕" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>GPT中英字幕课程资源 · 吴恩达《DSPy：构建与优化智能代理应用》中英字幕 · DeepLearning.AI 和 DSPy 团队合作的短课,50 分钟,看 Signature、Module 和优化器那几节。</figcaption>
</figure>

- 上面正文里嵌的 Koala聊开源《深入实践 Prompt 自动优化（APO）—— GEPA + DSPY》也在这一组,15 分钟。

### 其他经典视频

- 正文里的 AI Engineer 大会 Lakshya A. Agrawal《Beating RL With Reflection: GEPA and Optimize Anything》和 Weaviate《GEPA Explained!》,一个讲动机,一个讲机制,合起来 1 小时左右。
- DeepLearning.AI 短课《DSPy: Build and Optimize Agentic Apps》原版在 learn.deeplearning.ai,按标题搜索,有交互式 notebook。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 5 章 Prompt Engineering 讲手调 prompt 的方法和局限,第 3、4 章讲评测,读完会更清楚为什么自动优化离不开评测集。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly, 2024):手写 prompt 的系统方法,适合当「优化器给出的规则合不合理」的判断参照,挑第 6 章往后读。

### 开源项目与代码

- [stanfordnlp/dspy](https://github.com/stanfordnlp/dspy):`dspy/teleprompt/gepa/gepa.py` 里 `GEPA.__init__` 的参数和断言写得很清楚,读 100 行就知道每个参数干什么。
- [gepa-ai/gepa](https://github.com/gepa-ai/gepa):不依赖 DSPy 的独立版本,`gepa.optimize()` 能优化任意文本组件,README 里有接自定义系统的 adapter 例子。
- [ace-agent/ace](https://github.com/ace-agent/ace):ACE 官方实现,看 curator 部分怎么做去重和合并,和今天的 `curate()` 对照。

## 自测

1. 自动优化 prompt 至少需要哪三样东西?缺了哪一样最致命?

<details><summary>答案</summary>

一份带标签的数据(拆成训练、验证、测试),一个能打分的评分函数,一个能读错例并改写的反思模型。最致命的是数据:测试集太小或者和线上分布不一样,优化器给你的任何版本都无法被验证。其次是反馈文字,只有分数没有理由时反思模型只能猜。

</details>

2. 从 BASE 起步时,自写反思循环把训练集改到了全对、验证集没变差,为什么测试集却从 90% 掉到了 85%?

<details><summary>答案</summary>

反思模型从 t13、t22 两条错例里总结出「钱的问题优先」的宽规则,并写成了一个全局优先级。训练集和验证集里没有「带钱字样但其实是显示错误」的反例,所以这两份数据都惩罚不了它;测试集里的 t33(订阅页面把扣款日期显示成 11 月 31 日)就被这条规则带成了 billing。验收规则用的是 `>=`,打平也采用,也让这个没有真实收益的版本混了进来。

</details>

3. GEPA 的评分函数为什么要返回 `dspy.Prediction(score=..., feedback=...)` 而不是只返回一个数字?

<details><summary>答案</summary>

GEPA 的反思步骤要读文字反馈来判断错在哪、该怎么改。只给数字,它只知道这条错了,看不到「付款没成功属于 billing 不是 bug」这样的理由。GEPA 允许只返回 float,但那样就退化成没有方向的搜索。

</details>

4. Pareto 前沿解决的是什么问题?如果只保留验证集总分最高的那个候选,会丢掉什么?

<details><summary>答案</summary>

两个候选总分打平但做对的样本不同时,只按总分选会随机丢掉一个,它在某些样本上学到的规则也就丢了,搜索容易卡在局部最优。Pareto 前沿保留每个样本上的最好者,下一轮可以从任何一个出发,或者把它们合并。

</details>

5. ACE 说的「上下文坍缩」是什么?今天的 ACE 最小版暴露了它自己的什么问题?

<details><summary>答案</summary>

上下文坍缩是反复整段改写 prompt 时,早先积累的细节被模型一点点删掉的现象。ACE 用增量加减条目来避免。今天的实验两面都看到了:GEPA 从 BARE 起步的那次改写把「重复扣款」从 refund 的定义里弄丢了,正是坍缩和简短偏好;而 ACE 最小版的第一次运行暴露了另一面,只加不整理,规则会互相冲突,[1]「金额异常归 refund」和 [5]「扣款对不上归 billing」同时留在手册里。ACE 依靠帮/害计数和确定性整理来发现并清掉这类规则,最小版只在加入时计一次数,做不到。

</details>

6. **面试题**:面试官问「你们的 Agent prompt 是怎么迭代的?用过 DSPy 之类的自动优化吗?」你怎么答?

<details><summary>答案</summary>

先讲基础设施:有 dev/test 拆分的评测集、带理由的标注、CI 门禁,每次改 prompt 都在同一份数据上量分。再讲自动优化的位置:离线跑 GEPA 一类的优化器,产出候选 prompt,人审 diff,再过 test 集门禁才合并;强调反馈文字写具体、反思模型用强模型、测试集比验证集大且持续从线上补样本。最后给一个具体数字或教训,比如「小数据集上验证集涨了 10 个点,测试集没涨,后来把测试集扩到几百条才看到真实收益」,说明你知道它的边界。

</details>

## 明天预告

Day 144 讲上线后的反馈闭环:客服点赞点踩、改写了多少、有没有转人工,这些信号怎么采集,怎么从里面挑出 badcase、归类、补进测试集,形成数据飞轮。今天反复说「测试集要持续从线上补样本」,明天就讲样本从哪来。专题篇可以跳着读,不想看可以直接回到主线。
