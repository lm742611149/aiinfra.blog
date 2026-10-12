---
title: 'Day 106 · 写设计文档和 ADR:资深工程师的主要产出'
description: '到了资深这一档,你最重要的产出不再是代码,而是一份能让十个人对齐的设计文档和一串能回答「当初为什么这么选」的 ADR。今天拿 AgentOps 的模型网关当例子,把设计文档每一节写什么、Agent 系统要多写哪几节、取舍怎么写才有说服力、评审时怎么接住质疑,一次讲清楚。'
pubDate: 2026-10-12
regime: none
tags: ['design-doc', 'adr', 'rfc', 'staff-engineer', 'writing', 'agent-60']
series: 'agent-60'
day: 106
lang: 'zh'
---

## 今天要解决的问题

前面 105 天,你产出的东西大部分是代码、评测报告和部署好的服务。从今天开始的这五天讲的是另一类产出:文档、面试、说服、影响力。这些东西在中级岗位上是加分项,到了资深和 Staff 是主业。

今天学完你应该能做到:

1. 说清楚设计文档和需求文档、技术方案 PPT、代码注释的区别,知道什么时候值得写、什么时候不值得。
2. 按一个固定骨架写出一份 3 到 8 页的设计文档,并且知道 Agent 系统比普通后端系统多出来的那几节(评测计划、成本估算、失败模式、权限)该写什么。
3. 用 Michael Nygard 的格式写 ADR,知道 ADR 和设计文档怎么分工。
4. 把「我选了 A」写成「在约束 X、Y 下,A 比 B 在这两个指标上好、在这个指标上差,我们接受这个代价,因为……」。
5. 在评审会上面对质疑时不慌,知道哪些意见当场改、哪些记下来、哪些需要升级决策。

预计用时:4 到 6 小时,其中一半以上是动手写。前置:Day 43(SupportPilot 开题)、Day 67(运行时设计文档)、Day 96(AgentOps 开题)。如果你跳过了 Day 67 和 Day 96 的设计文档练习,今天会觉得有点空,建议回去把那两份先写出来。

## 为什么资深工程师的主要产出是文档

先看一个事实。我从 docs/jd-research 的 880 条 JD 里挑出职位名带「资深」「专家」「架构师」「高级」「负责人」的国内岗位,一共 49 条带薪资(Boss 直聘加猎聘,挂牌区间中点乘薪数折成年包)。它们的年包中位数是 66 万,P75 是 90 万,37% 在 80 万以上。整体样本的中位数是 48 万。差出来的这十几二十万,买的不是更快的编码速度。

翻这些岗位的职责描述,出现最多的是这类句子:「负责 Agent 平台整体架构设计」「主导技术方案评审」「推动跨团队落地」「沉淀方法论」。字节「Agent 架构研发工程师/专家」、美团「Agent 可靠性技术专家」、网易「LLM Agent Memory 专家」,写法都差不多。海外那边,Harvey、Decagon 的 Staff 岗(年薪 23 万到 40 万美元档)会写 technical direction、cross-team alignment。这些事情落到纸面上,就是设计文档。

原因很朴素:一个人写代码的上限是一个人,一份好的设计文档能让十个人朝同一个方向写代码。资深工程师被付更多钱,是因为他能放大别人的产出。代码 review 一次影响几百行,设计评审一次影响几个月。

Agent 系统还多一个理由。普通后端系统,方案对不对,很多时候看代码就知道。Agent 系统的行为是概率性的,同一个方案换个模型、换批数据,效果能差十几个点。所以 Agent 的设计文档必须写清楚「怎么证明这个方案是对的」,也就是评测计划。这一节写不出来的方案,基本就是还没想清楚。

## 设计文档、需求文档、ADR、PPT 各管什么

很多团队把这几样东西混着用,结果哪个都没写好。分清楚:

| 文档 | 回答什么问题 | 谁主写 | 生命周期 |
| --- | --- | --- | --- |
| PRD(需求文档) | 要解决谁的什么问题,做到什么程度算成功 | 产品经理 | 立项前后,需求变了就改 |
| 设计文档(Design Doc / RFC) | 打算怎么做,考虑过哪些做法,为什么选这个 | 工程师 | 写代码之前,定稿后很少大改 |
| ADR(架构决策记录) | 某一个具体决定是什么、在什么背景下做的、后果是什么 | 做决定的工程师 | 永久保留,只追加不修改 |
| 方案汇报 PPT | 让管理层在 15 分钟里做个决定 | 负责人 | 一次性 |
| 代码注释和 README | 现在的代码怎么用、怎么改 | 写代码的人 | 跟着代码走 |

Google 的工程博客《Design Docs at Google》里有一句话说得很准:设计文档是在写代码之前、改动还便宜的时候,把设计问题暴露出来的工具。它不是给实现完之后补的说明书。如果你的团队习惯「先写完代码,评审时再补个文档」,那这份文档只剩下归档价值。

什么时候不值得写?改动范围小、方案没有争议、做错了回滚成本很低,就别写,直接提 MR。一个粗略的门槛:预计超过两周工作量、或者会影响两个以上团队、或者改了之后很难回退(数据格式、对外 API、计费逻辑),就写。Agent 项目里还要加一条:会改变模型、工具权限或者用户可见行为的,写。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="设计文档从草稿到回填的生命周期">
<rect x="10" y="80" width="100" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="60" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">草稿</text>
<text x="60" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">一个人,1-3 天</text>
<rect x="135" y="80" width="110" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="190" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">小范围预审</text>
<text x="190" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">找 2-3 个关键人</text>
<rect x="270" y="80" width="110" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="325" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">正式评审</text>
<text x="325" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">异步评论+一次会</text>
<rect x="405" y="80" width="100" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="455" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">定稿+ADR</text>
<text x="455" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">关键决定单独记</text>
<rect x="530" y="80" width="100" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="580" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">实现+回填</text>
<text x="580" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">和计划不同就记</text>
<line x1="110" y1="108" x2="135" y2="108" stroke="var(--rule)" stroke-width="2"/>
<line x1="245" y1="108" x2="270" y2="108" stroke="var(--rule)" stroke-width="2"/>
<line x1="380" y1="108" x2="405" y2="108" stroke="var(--rule)" stroke-width="2"/>
<line x1="505" y1="108" x2="530" y2="108" stroke="var(--rule)" stroke-width="2"/>
<path d="M 325 136 C 325 190, 190 190, 190 140" fill="none" stroke="var(--ink-faint)" stroke-width="1.5" stroke-dasharray="4 4"/>
<text x="258" y="200" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">大分歧:退回去改,再预审</text>
<text x="320" y="40" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">改动便宜的时候暴露问题,越往右改动越贵</text>
</svg>
<figcaption>设计文档的生命周期。最容易被省掉的是「小范围预审」和「回填」,恰好这两步最值钱。</figcaption>
</figure>

## 设计文档的骨架

下面这个骨架是我综合 Google 那篇文章、Rust 和 Kubernetes 社区的 RFC/KEP 模板,再加上 Agent 系统的特殊需要整理的。不用每一节都写满,但每一节都要想过。

**1. 标题、作者、状态、评审人、日期。** 状态写「草稿 / 评审中 / 已接受 / 已废弃」。评审人要写具体的人名,不要写「后端组」。

**2. 背景。** 三五段话,让一个不了解这个项目的同事看懂为什么现在要做这件事。只写和决策有关的背景,别把项目历史从头讲一遍。Agent 项目里常见的背景是:现在每个业务团队各自调模型、各自管 key,上个月有一个团队把 API 额度打爆,导致另外三个团队的线上 Agent 一起 429。

**3. 目标和非目标。** 目标要能验证,比如「所有模型调用经过统一网关,P95 额外延迟不超过 30 毫秒」。非目标比目标更重要,它是你提前拒绝掉的范围蔓延。比如「本期不做语义缓存」「本期不支持自部署模型的自动扩缩容」。评审时一半的争论能靠非目标提前消化掉。

**4. 现状。** 现在系统长什么样,一张图加几段话。没有现状,读者没法判断你的方案改了多少。

**5. 方案。** 主体部分。先给一张架构图,再讲数据流和关键接口,再讲关键算法或流程。接口写到函数签名或 HTTP 路径这一层就够了,不要把代码贴进来。如果某个细节读者一定会问,就写;如果只是实现细节,留给代码。

**6. 备选方案和取舍。** 资深和中级的设计文档,差别最大就在这一节。中级的文档常常只有一个方案,读起来像结论先行的说明书。资深的文档会写出至少两个认真考虑过的备选方案,并且说清楚为什么没选。下一节专门讲怎么写。

**7. Agent 专属的四节**(普通后端文档可以省,Agent 系统不能省):

- **评测计划**:用什么数据集、什么指标、多少样本、怎么判定「上线后比现在好」。引用 W11 学的统计方法:样本量够不够检测出你预期的提升。
- **成本估算**:按请求量、平均 token、单价算出月成本,给出上下浮动的假设。Day 38 和 Day 52 的算式可以直接用。
- **失败模式和降级**:模型供应商挂了怎么办、输出格式坏了怎么办、Agent 进了循环怎么办、工具超时怎么办。每一种写检测方式和降级动作。
- **安全和权限**:新方案让 Agent 多了什么能力,谁能用,出了事怎么审计。涉及 prompt injection 风险的要写「不可信输入从哪进来、能碰到哪些工具」。

**8. 上线计划。** 灰度比例、观察指标、回滚条件。写成「如果转人工率比基线高 3 个百分点以上,持续 2 小时,就回滚到旧路由」这种可执行的句子。

**9. 开放问题。** 你还没想清楚的事情,直接列出来。很多人觉得写开放问题显得自己不专业,其实正好相反,评审人最怕的是作者假装什么都想清楚了。

长度上,Google 那篇文章给的经验是 10 到 20 页适合大项目,小一点的改动写一两页的「迷你设计文档」就行。我自己的经验是 Agent 平台类的设计文档写到 5 到 8 页,超过 10 页就该拆成主文档加附录,或者拆成两份。

## 取舍怎么写才有说服力

「我们选 LiteLLM 做网关,因为它功能全、社区活跃。」这种句子在评审会上一定会被追问:功能全指哪些功能?我们用得上吗?社区活跃对我们意味着什么?

有说服力的取舍有三个特征:列出真正的约束,用同一组维度比较,并且承认选中的方案有代价。拿 AgentOps 模型网关举个例子,一个写得比较好的版本大概是这样:

| 维度 | A. 用 LiteLLM Proxy | B. 自研轻量网关 | C. 云厂商的 AI 网关 |
| --- | --- | --- | --- |
| 接入 6 家模型供应商 | 开箱即用 | 每家写适配层,约 2 人周 | 只支持部分供应商 |
| 租户级配额和成本归因 | 有,但需要它的数据库 | 按我们的租户模型设计 | 粒度到账号,不到租户 |
| 额外延迟(P95) | 需要压测,预期十几毫秒 | 可控,预期 5 毫秒以内 | 依赖厂商 |
| 数据出境和合规 | 自部署,数据不出 | 自部署,数据不出 | 要评估 |
| 长期维护成本 | 跟着上游升级,有破坏性变更风险 | 全部自己维护 | 低 |
| 第一版上线时间 | 2 周 | 5 到 6 周 | 1 周 |

然后用一段话收住:「在『三个月内要让五个业务团队接入』和『数据不能出境』这两个约束下,我们选 A。我们接受的代价是对上游版本的依赖,对策是锁定版本、在 CI 里跑网关回归测试、每个季度评估一次升级。如果半年后租户数超过 50 个,或者 LiteLLM 的配额模型不能满足按功能归因,重新评估 B。」

注意这里几件事:约束写在前面,而且是业务约束,不是技术偏好;表格里有数字或者至少有量级,不全是「好」「一般」;代价写出来了,并且给了对策;写了什么情况下推翻这个决定。最后这一条很多人不写,但它让读者知道你不是在赌,而是在当前信息下做了一个可以回头的选择。

表格里那几个延迟数字,写的时候要标清楚是「预期」还是「实测」。没压测过就写预期,并在上线计划里加一条压测任务。设计文档里编数字,是评审会上最容易翻车的地方。

## ADR:把单个决定钉住

设计文档讲的是一整套方案,ADR 讲的是其中一个决定。为什么要单独记?因为设计文档定稿以后很少有人回头看,半年后新同事问「为什么网关用 LiteLLM 不自己写」,没人记得当时的约束是什么。ADR 就是为这个问题准备的。

Michael Nygard 在 2011 年那篇《Documenting Architecture Decisions》里给的格式到今天还是最常用的,只有五节:

```markdown
# ADR-0007:模型网关采用 LiteLLM Proxy,不自研

- 状态:已接受(2026-10-12)
- 取代:无
- 相关设计文档:AgentOps 模型网关设计 v1.2

## 背景
五个业务团队要在三个月内接入统一网关;数据不能出境;
团队里能投入网关的人力是 1.5 人。需要支持 6 家模型供应商和租户级配额。

## 决定
采用 LiteLLM Proxy 自部署,锁定小版本号,租户配额用它的 virtual key 机制实现。
成本归因在网关之外用我们自己的计费表补齐。

## 后果
好的:两周内可以给第一个团队接入;6 家供应商开箱即用。
坏的:依赖上游版本节奏,升级需要回归;virtual key 和我们的租户模型不完全对应,
需要维护一张映射表。
需要重新评估的条件:租户数超过 50,或者需要按功能维度归因成本。
```

几条实践经验:

**ADR 只追加,不修改。** 决定变了,写一条新的 ADR,状态写「已接受,取代 ADR-0007」,同时把旧的状态改成「已被 ADR-0015 取代」。这样翻记录的人能看到决策是怎么演变的。

**和代码放在一起。** 放在仓库的 `docs/adr/` 目录,编号递增,改动走 MR。npryce 的 adr-tools 是一组小脚本,可以帮你生成编号和模板。放在 wiki 里的 ADR 很快会和代码脱节。

**一个 ADR 只记一个决定。** 「网关选型和缓存策略」应该是两条。

**写得短。** 一条 ADR 一屏能看完。长了说明它其实是一份设计文档。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="ADR 只追加不修改,新决定取代旧决定">
<rect x="20" y="60" width="160" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="100" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">ADR-0007</text>
<text x="100" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">网关用 LiteLLM</text>
<text x="100" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">已被 0015 取代</text>
<rect x="240" y="60" width="160" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">ADR-0011</text>
<text x="320" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">缓存只做精确匹配</text>
<text x="320" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">已接受</text>
<rect x="460" y="60" width="160" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="540" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">ADR-0015</text>
<text x="540" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">租户超 50,改自研</text>
<text x="540" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">已接受,取代 0007</text>
<path d="M 540 60 C 540 20, 100 20, 100 58" fill="none" stroke="var(--compute)" stroke-width="1.5"/>
<text x="320" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">取代</text>
<text x="320" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">旧的不删,改状态;新的写清楚取代了谁、为什么</text>
</svg>
<figcaption>一串 ADR 读下来就是这个系统的决策史。半年后有人问「当初为什么」,翻到对应编号就行。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17s4y1J7rG&autoplay=0&high_quality=1" title="阿里工程师带你学技术文档该怎么写" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里技术_AlibabaTech · 阿里工程师带你学技术文档该怎么写 · 30 分钟,重点听技术方案文档那部分怎么组织结构、怎么写给不同读者。</figcaption>
</figure>

## 评审:怎么接住质疑

文档写完只完成了一半,另一半在评审。几条在大公司和创业公司都适用的做法:

**先预审,再开会。** 正式评审前,把草稿私下发给两三个最可能反对的人:负责相关系统的同事、安全或合规的人、会受影响的业务团队负责人。私下聊十五分钟,大分歧在这一步解决。到了正式评审会,不应该出现「第一次听说」的反对意见。Tanya Reilly 在《The Staff Engineer's Path》里讲带大项目时反复提到这一点:让关键的人尽早参与进来。

**异步评论为主,会议为辅。** 文档发出去留三到五个工作日让大家在文档里评论。会议只讨论评论里没解决的分歧。一个小时的评审会如果有一半时间在念文档,说明流程有问题。

**对每条评论分类处理。** 我的习惯是三类:

- 事实错误或者遗漏(「这个接口其实已经有限流了」):当场改,回复「已改」。
- 方案上的不同意见(「为什么不用消息队列」):如果备选方案里写过,指过去;没写过,补到备选方案里并写清楚为什么不选;如果对方说得对,认,改方案。
- 超出你决策权的分歧(两个团队对优先级的看法不同):不在评论里争,记下来,升级给能拍板的人,在文档里写「待 X 决定」。

**别把评审当答辩。** 资深工程师在评审会上最常见的失误是防御心太重,每个问题都要赢。评审的目的是让方案更好,不是证明作者聪明。被问到没想过的问题,直接说「这个我没考虑到,我记下来,会后补一个分析」,比现场硬编一个答案好得多。

**定稿后回填。** 实现过程中和设计不一样的地方,回到文档里加一段「实现时的变化」。不回填的文档半年后会误导人,比没有文档还糟。

## 动手练习

今天的产出物是三样东西:一份 AgentOps 模型网关的设计文档、三条 ADR、一份评审记录。

**步骤 1:建目录。** 在 `agentops/` 仓库里:

```bash
# agentops/ 仓库根目录
mkdir -p docs/design docs/adr
touch docs/design/model-gateway.md
# 可选:用 adr-tools 管理编号(macOS:brew install adr-tools)
adr init docs/adr
adr new "模型网关采用 LiteLLM Proxy,不自研"
```

不想装 adr-tools 就手动建 `docs/adr/0001-xxx.md`,编号四位递增。

**步骤 2:写设计文档。** 按上面的九节骨架写 `docs/design/model-gateway.md`,篇幅 3 到 8 页。如果你在 Day 97 已经实现了网关,这份文档就当作「补写」,但要按写在实现之前的口吻写,并在最后加「实现时的变化」。要求:

- 目标至少 3 条,每条可验证;非目标至少 3 条。
- 备选方案至少 2 个,用同一组维度的表格比较,至少一半的格子是数字或量级。
- Agent 专属四节齐全。评测计划要写样本量和判定标准;成本估算要写算式和假设。
- 开放问题至少 2 条。

**步骤 3:写三条 ADR。** 从设计文档里挑三个独立的决定,比如网关选型、配额实现方式、成本归因放在网关内还是网关外。每条一屏以内。

**步骤 4:找人预审。** 找一个同事或者学这门课的朋友读你的文档,请他至少提 5 条评论。没人可以找,就开两个 Claude 会话,一个扮演安全负责人、一个扮演业务团队负责人,让它们只挑毛病不给建议。把评论和你的处理方式按「事实错误 / 方案分歧 / 需要升级」三类记在 `docs/design/model-gateway-review.md`。

**步骤 5:自检。** 用下面这个清单对照:

```text
[ ] 不了解项目的人读完背景,能说出为什么现在要做
[ ] 每条目标都能写出验证方法
[ ] 非目标写了,而且评审时真的挡住了至少一个范围蔓延
[ ] 备选方案不是稻草人(你认真考虑过它可能更好)
[ ] 取舍里写了代价和推翻条件
[ ] 所有数字标了「预期」或「实测」
[ ] 评测计划写了样本量和判定规则
[ ] 成本估算能被别人按算式复算
[ ] 失败模式每条都有检测方式和降级动作
[ ] ADR 每条一个决定,一屏以内
```

**验收标准**:设计文档和三条 ADR 合进 `agentops` 仓库;评审记录里至少 5 条评论都有处理结论;自检清单全部打勾。最后一条最难:请一个没参与的人只读文档,让他用三句话复述方案和为什么这么选。他复述不出来,文档就要改。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Design Doc / 设计文档 | 写代码之前,说明打算怎么做、考虑过什么、为什么这么选的文档 |
| RFC | Request for Comments,开源社区常用的提案文档,性质和设计文档类似,强调公开征求意见 |
| KEP / PEP | Kubernetes 和 Python 社区各自的提案格式,是 RFC 的变体 |
| ADR | Architecture Decision Record,架构决策记录,一条只记一个决定 |
| 非目标 | 明确不在本期范围内的事情,用来提前拒绝范围蔓延 |
| 推翻条件 | 什么情况出现时应该重新评估当前决定 |
| 预审 | 正式评审之前私下找关键人看草稿 |
| 回填 | 实现完成后把和设计不一致的地方写回文档 |
| Disagree and commit | 保留不同意见但执行团队的决定,常见于决策文化 |

## 常见误区

**把设计文档写成实现说明书。** 通篇是类名、函数名和流程,没有一句话讲为什么。读者看完知道你要怎么做,不知道你为什么不那么做。设计文档的价值在「为什么」,实现细节交给代码。

**备选方案写成稻草人。** 「方案 B:不做网关,继续各自调用。缺点:很乱。」这种备选方案一看就是为了凑数。真正的备选方案是你认真考虑过、在某些条件下可能更好的方案。写不出像样的备选方案,通常说明你调研不够。

**数字靠拍脑袋。** 「预计 P95 延迟 10 毫秒」没有压测也没有依据,评审时被问一句就露馅。没测过就写预期区间和依据,并把压测列进上线计划。

**Agent 文档没有评测计划。** 普通后端改动,单测加集成测试就能说明正确性。Agent 改动的效果是统计意义上的,没有评测计划的 Agent 设计文档等于没有验收标准。

**ADR 写进 wiki,和代码分家。** 半年后代码改了三轮,wiki 里的 ADR 还停在第一版,没人知道哪条还有效。放进仓库,走 MR。

**评审会变成辩论赛。** 作者每个问题都要辩赢,评审人越来越不愿意提意见,最后评审流于形式。被问住了就记下来会后补,这比当场赢更能建立信任。

## 学习资料

### 文档与文章

- [Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/):Malte Ubl 写的,讲 Google 设计文档的结构、长度和生命周期。今天的骨架主要参考它,30 分钟读完。
- [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):Michael Nygard 2011 年提出 ADR 格式的原文,很短,10 分钟。
- [adr.github.io](https://adr.github.io/):ADR 的社区站点,汇总了几种模板和工具,挑一种模板用就行。
- [joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record):ADR 示例和模板大全,看几个真实例子找感觉。
- [Microsoft:Architecture decision record](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record):微软架构框架里讲 ADR 的一页,适合拿去说服团队开始用 ADR。
- [Thoughtworks 技术雷达:Lightweight ADRs](https://www.thoughtworks.com/radar/techniques/lightweight-architecture-decision-records):为什么推荐把 ADR 放在代码仓库里。
- [PEP 1](https://peps.python.org/pep-0001/):Python 社区提案流程,看一个成熟社区怎么组织「提案、讨论、决定」。
- [Rust RFCs](https://github.com/rust-lang/rfcs) 和 [Kubernetes KEPs](https://github.com/kubernetes/enhancements/tree/master/keps):两个大型开源项目的设计提案仓库,挑一两篇已接受的读,看它们的「Alternatives」和「Drawbacks」怎么写。
- [Will Larson:Engineering strategy](https://staffeng.com/guides/engineering-strategy/):多份设计文档之上的工程策略怎么写,资深往 Staff 走时会用到。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WP4y1B7ym&autoplay=0&high_quality=1" title="程序员的软技能实战-写好设计文档" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>idx_done · 程序员的软技能实战-写好设计文档 · 5 分钟,快速过一遍设计文档的常见结构,适合写之前看。</figcaption>
</figure>

- 阿里技术_AlibabaTech 的《阿里工程师带你学技术文档该怎么写》已经嵌在正文里,30 分钟,建议完整看一遍。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bgHL41e7vgI" title="What Is A Design Doc In Software Engineering? (full example)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Clément Mihailescu · What Is A Design Doc In Software Engineering? (full example) · 16 分钟,前 Google 和 Facebook 工程师拿一份完整的设计文档逐节讲解。</figcaption>
</figure>

### 书籍

- Tanya Reilly,《The Staff Engineer's Path》,O'Reilly,2022。繁体中文版书名《Staff 工程師之路》。读第 5 章「Leading Big Projects」(带跨团队的大项目,讲怎么写设计文档、怎么让关键人早参与),有余力再读第三部分 Leveling Up。
- Will Larson,《Staff Engineer: Leadership beyond the management track》,2021,自出版。没查到简体中文版。大部分内容在 [staffeng.com](https://staffeng.com/) 免费公开,今天看「Engineering strategy」和「Manage technical quality」两篇就够。
- Chip Huyen,《AI Engineering》,O'Reilly,2025。第 10 章讲 AI 应用的架构和用户反馈,可以拿来检查你的设计文档是否漏了哪一层。

### 开源项目与代码

- [npryce/adr-tools](https://github.com/npryce/adr-tools):命令行管理 ADR 编号和模板,`adr new`、`adr new -s 7` 这两个命令最常用。
- [rust-lang/rfcs](https://github.com/rust-lang/rfcs):`0000-template.md` 是很好的 RFC 模板,特别是 Drawbacks 和 Rationale and alternatives 两节。
- [kubernetes/enhancements](https://github.com/kubernetes/enhancements/tree/master/keps):KEP 模板里的 Production Readiness Review 一节,可以直接借鉴到 Agent 文档的「上线计划」。

## 自测

1. 设计文档和 ADR 的分工是什么?为什么设计文档里已经写了选型,还要单独写 ADR?

<details><summary>答案</summary>

设计文档讲一整套方案,写在实现之前,定稿后很少回头看;ADR 一条只记一个决定,永久保留、只追加不修改。半年后有人问「当初为什么选 LiteLLM」,没人会去翻一份八页的设计文档,翻 `docs/adr/0007` 一屏就能看到背景、决定、后果和推翻条件。决定变了,写新 ADR 取代旧的,历史不丢。

</details>

2. 下面这段取舍写得有什么问题?怎么改?「我们选择 LangGraph,因为它是目前最流行的 Agent 框架,功能强大,社区活跃。」

<details><summary>答案</summary>

问题:没有约束、没有比较维度、没有代价、没有推翻条件,「流行」「强大」「活跃」都不可验证。改法:先写约束(比如需要人工审批中断、需要断点续跑、团队已有 Python 栈),再用同一组维度和至少一个备选方案比较(比如自研循环、OpenAI Agents SDK),写出 LangGraph 的代价(版本变化快、抽象层多、调试成本),最后写什么情况下重新评估。

</details>

3. Agent 系统的设计文档比普通后端多出来哪四节?各写一句话说明为什么不能省。

<details><summary>答案</summary>

评测计划:Agent 效果是统计意义上的,没有评测计划就没有验收标准。成本估算:token 成本随流量线性涨,不估算可能上线后才发现亏钱。失败模式和降级:模型供应商故障、格式错误、循环、工具超时都是常态,要提前设计检测和降级。安全和权限:Agent 会调用工具、读取不可信输入,新增能力要写清楚边界和审计方式。

</details>

4. 评审会上,一个资深同事问「为什么不用消息队列把模型调用全部异步化」,你的文档里没考虑过这个方案。你怎么回应?

<details><summary>答案</summary>

不要当场硬辩。先确认对方想解决的问题是什么(削峰?重试?解耦?),如果你有现成的判断(比如客服场景要求同步流式返回,异步化会破坏体验),简短说明;如果没有,直接说没考虑到,记为待办,会后补一个分析写进「备选方案」一节,说明选或不选的理由。如果对方是对的,改方案。

</details>

5. 资深面试题:你在上一家公司推动过一个跨团队的技术决策吗?你是怎么写文档、怎么让大家对齐的?遇到反对怎么处理?

<details><summary>答案</summary>

答题要点:用 STAR 结构讲一个真实案例。突出几件事:写了设计文档并列出备选方案和取舍,而不是只有结论;正式评审前做了预审,把关键反对者提前拉进来;对反对意见分类处理,该认的认、该升级的升级;决定后用 ADR 记录,并设置了推翻条件;上线后用数据(评测分数、成本、事故率)证明决定是对的,或者承认哪里错了、怎么修正。面试官想听的是你能在没有直接权力的情况下推动一群人往同一个方向走。

</details>

6. 什么样的改动不值得写设计文档?给出你的判断标准。

<details><summary>答案</summary>

改动范围小、方案没争议、回滚便宜的,直接提 MR。我的门槛是满足任一条就写:预计超过两周工作量;影响两个以上团队;改动难以回退(数据格式、对外 API、计费);会改变 Agent 的模型、工具权限或用户可见行为。

</details>

## 明天预告

Day 107 · Staff 级系统设计面试:三道真题完整示范。今天写的设计文档,明天要能在 45 分钟的白板上讲出来。我们拿「设计企业级 Agent 平台」「设计十万并发的客服 Agent」「设计代码 Agent 的评测体系」三道题,练从业务目标、约束和规模出发,把取舍和演进路线讲清楚。
