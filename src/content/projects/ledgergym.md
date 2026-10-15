---
title: 'LedgerGym · 给计费 Agent 做强化学习训练'
name: 'LedgerGym'
tagline: '把 BillSleuth 包成 RL 环境,用 GRPO 训一个会查账的 4B 小模型'
summary: '把计费争议场景包成多轮工具调用的强化学习环境,奖励按根因、金额、证据链精确计算并防奖励黑客。用 GRPO + LoRA 训练 Qwen3.5-4B,和训练前、和 API 大模型在同一套评测上比。'
order: 10
difficulty: 5
level: '资深+'
duration: '8–10 周(业余时间)'
cost: '云 GPU 约 $150–300 + API 约 $20–50(2026-10-15 估算,硬上限 $300 GPU)'
gpu: true
targets: ['Agent 后训练工程师', 'AI 平台工程师', '海外 FDE']
stack: ['Python', 'TRL', 'vLLM', 'PEFT/LoRA', 'Qwen3.5', 'SQLite', 'RunPod']
recognition: '同一套 100 场景评测上训练前后与 API 大模型的对比、开源的环境和训练配方、技术报告'
depends: ['billsleuth']
status: 'spec'
---

## 这个项目是什么

BillSleuth 用的是 API 大模型。LedgerGym 问一个更难的问题:一个能在单卡上部署的 4B 开源模型,经过强化学习之后,查计费争议能查到什么程度?

做法分三块。第一块是环境:把 BillSleuth 的计费库、只读工具、复算工具和贷记单草稿工具包成一个强化学习环境,每个回合加载一个场景的库副本,模型多轮调用工具,最后提交结论。第二块是奖励:根因对不对、多收金额是否精确到分、结论里的数字能不能追溯到本回合的工具输出、有没有误冲正,全部用代码判,不用 LLM 评审。第三块是训练:用 GRPO 加 LoRA 训练 Qwen3.5-4B,在 Day 127 那套 100 场景评测上,和训练前的同一个模型、和 deepseek-flash、Claude Sonnet 5.5 这类 API 模型比。

做完的样子:一个开源仓库,装上就能在 BillSleuth 场景上跑 RL;一份训练报告,有奖励曲线、训练前后的 pass^k 对比、按根因分组的变化,以及你抓到的奖励黑客案例;一个可以下载的 LoRA 适配器。

## 为什么值得做

2025 年以后,推理模型和 Agent 能力的提升有很大一部分来自可验证奖励的强化学习。DeepSeek-R1 的论文里写得很直白:R1-Zero 只用规则判定的准确率奖励和格式奖励,没用神经网络奖励模型,原因是他们发现神经网络奖励模型在大规模强化学习里会被钻空子。计费场景正好是「答案能精确验证」的那一类,这是 LedgerGym 能成立的前提。

招聘方那边,会调 API 的人很多,能把一个业务流程做成 RL 环境、设计出不被钻空子的奖励、在有限预算里训出可比较结果的人很少。Agent 后训练、AI 平台这类岗位要的正是这套能力。和数学题、代码题这些现成的 RL 环境比,LedgerGym 的点在于多轮工具调用加上会被改写的数据库状态,奖励里有「不该做的事做了要扣分」这一项(误冲正),这更接近企业里的真实 Agent。

我的判断:这个项目最大的风险是训不出提升。所以报告的价值不只在「提升了多少」,也在你能不能说清楚为什么没提升、在哪一类上提升了、提升是不是来自钻空子。

## 要做出什么

必做:

- `LedgerEnv`:每回合从场景生成器取一个场景,复制一份 SQLite,暴露 BillSleuth 的工具(`get_customer`、`list_invoices`、`get_invoice`、`list_payments`、`get_subscription_timeline`、`get_tax_rate`、`recompute_invoice`、`draft_credit_note`)和一个提交结论的 `submit_findings`。工具名和返回结构沿用 Day 123,不改。
- 奖励函数:根因、金额、动作、证据链四项打分,误冲正和数字幻觉扣分,每一项都有单元测试,包括故意构造的作弊轨迹。
- 训练数据:用 Day 122 的生成器换种子造几千个训练场景,和评测用的 100 个场景种子不同、客户名不同。再整类留出一种根因(比如时区那一类)完全不进训练集,测泛化。
- 训练:Qwen3.5-4B + LoRA + GRPO,至少两次主实验(二值成功奖励 vs 分项奖励)。
- 评测:Day 127 的评测脚本原样跑训练前、训练后、两个 API 模型,k=4,带置信区间。

加分:

- 先用大模型的成功轨迹做一轮拒绝采样 SFT,再接 GRPO,和直接 GRPO 比。
- 全参数微调的一次短实验,和 LoRA 比。
- 换一个框架(OpenPipe ART 或 verl)复现主实验,写两者的差异。
- 如果 BillBench 已经上线,在它的私有集上跑一次。

不做什么:不训 30B 以上的模型、不做 RLHF 偏好数据、不追求超过最强闭源模型,也不碰任何真实账单数据。

## 架构

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="LedgerGym 架构:场景生成器给环境提供场景,策略模型在环境里多轮调用工具,一组 8 条轨迹由奖励函数打分,组内相对优势用于更新 LoRA 参数">
  <rect x="0" y="0" width="640" height="400" fill="var(--paper-raised)" rx="6"/>
  <rect x="20" y="30" width="150" height="70" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="95" y="55" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">场景生成器</text>
  <text x="95" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">训练种子 ≠ 评测种子</text>
  <text x="95" y="92" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">留出一类根因</text>
  <line x1="170" y1="65" x2="220" y2="65" stroke="var(--ink-soft)" marker-end="url(#lg1)"/>
  <rect x="220" y="20" width="200" height="150" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="320" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">LedgerEnv(每条轨迹一个)</text>
  <text x="232" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">reset: 复制 billing.db</text>
  <text x="232" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">工具: 6 只读 + 复算</text>
  <text x="232" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">写: draft_credit_note</text>
  <text x="232" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">终止: submit_findings</text>
  <text x="232" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">_truth 私有,不当工具</text>
  <rect x="460" y="20" width="160" height="150" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="540" y="42" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">策略模型</text>
  <text x="472" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">Qwen3.5-4B</text>
  <text x="472" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">+ LoRA 适配器</text>
  <text x="472" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">vLLM 生成</text>
  <text x="472" y="126" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">同一场景采样 8 次</text>
  <line x1="460" y1="80" x2="420" y2="80" stroke="var(--mem)" marker-end="url(#lg1)"/>
  <line x1="420" y1="110" x2="460" y2="110" stroke="var(--compute)" marker-end="url(#lg1)"/>
  <line x1="320" y1="170" x2="320" y2="210" stroke="var(--ink-soft)" marker-end="url(#lg1)"/>
  <rect x="160" y="210" width="320" height="70" fill="none" stroke="var(--compute)" rx="4"/>
  <text x="320" y="232" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">奖励函数(确定性)</text>
  <text x="320" y="252" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">根因 · 金额 · 动作 · 证据链</text>
  <text x="320" y="270" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">误冲正 / 数字幻觉 / 多列发票 扣分</text>
  <line x1="320" y1="280" x2="320" y2="310" stroke="var(--ink-soft)" marker-end="url(#lg1)"/>
  <rect x="160" y="310" width="320" height="60" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="320" y="333" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">GRPO:组内优势 = 奖励 - 组均值</text>
  <text x="320" y="353" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">只更新 LoRA,不需要价值网络</text>
  <line x1="480" y1="340" x2="540" y2="340" stroke="var(--mem)"/>
  <line x1="540" y1="340" x2="540" y2="170" stroke="var(--mem)" marker-end="url(#lg1)"/>
  <text x="20" y="250" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">本机能做:</text>
  <text x="20" y="268" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">环境 + 奖励</text>
  <text x="20" y="286" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">+ API 当策略</text>
  <text x="20" y="330" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">要租 GPU:</text>
  <text x="20" y="348" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">生成 + 更新</text>
  <defs><marker id="lg1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="var(--ink-soft)"/></marker></defs>
</svg>
<figcaption>琥珀色是环境和奖励,蓝色是模型和训练。标准答案只存在环境的私有属性里,奖励函数读它,模型永远拿不到。</figcaption>
</figure>

GRPO 来自 DeepSeekMath(Shao 等,2024):同一个题采样一组回答,用组内奖励的均值当基线算优势,省掉了 PPO 那个和策略一样大的价值网络。对单卡训 4B 来说,这一点决定了能不能做。后来的 DAPO(Yu 等,2025)和 Dr. GRPO(Liu 等,2025)指出了原版的一些偏差,比如按长度归一化会让模型倾向写长的错误回答;TRL 现在 GRPO 的默认损失类型已经是 `"dapo"`(以 2026-10-15 的 TRL main 文档为准),这些细节不用自己实现,但报告里要写清楚用的是哪个变体。

框架我选 TRL 的 `GRPOTrainer`。它现在支持 `environment_factory`:传一个类,每条轨迹实例化一个,`reset()` 返回提示词,公开方法自动变成工具,`get_reward()` 让环境自己给分。这和 LedgerEnv 的形状完全对得上。代价是这个接口在文档里标着实验性,而且要求 `transformers>=5.2.0`。备选有三个:OpenPipe ART 专门做多步 Agent 的 GRPO,底层用 Unsloth 和 vLLM;verl(仓库已迁到 verl-project/verl)规模化能力最强,但它的 Agent Loop 接口文档标着 alpha;PrimeIntellect 的 verifiers 加 prime-rl 是另一套生态。这四个在 2026-10-15 查的时候最近一周都有提交,都还活着。我选 TRL 的理由很简单:单卡、LoRA、文档最全,出问题搜得到。

LoRA 还是全参?Thinking Machines 2025 年 9 月的《LoRA Without Regret》报告,策略梯度强化学习里 LoRA 在很低的秩上就能追平全参微调,学习率大约要设成全参的 10 倍,而且 LoRA 要加在包括 MLP 在内的所有层上,只加注意力层效果差。全参训 4B 还有一笔显存账:Qwen3.5-4B 带视觉编码器约 46.6 亿参数,bf16 权重加梯度约 19GB,Adam 两份 fp32 状态约 37GB,fp32 主权重约 19GB,还没算激活值和 vLLM 的 KV 缓存,一张 80GB 的卡放不下。所以主实验用 LoRA,全参只做加分的对照。

## 分阶段计划

| 周 | 目标 | 产出 | 怎么算完成 |
| --- | --- | --- | --- |
| 1 | 环境 | `LedgerEnv`、训练场景生成 | 本机用脚本按参考解调用工具,100 个场景全拿满分 |
| 2 | 奖励 | `reward.py` + 作弊轨迹测试 | 20 条手造作弊轨迹全部拿不到高分 |
| 3 | API 当策略 | 用 deepseek-flash 跑环境 | 奖励分布和 Day 127 的判分结果一致 |
| 4 | 打通训练 | 租 4090 一小时,tiny 模型 + Qwen3.5-0.8B 各跑 20 步 | 奖励能算、梯度能更新、检查点能存 |
| 5 | 基线和选题 | Qwen3.5-4B 训练前每个场景采样 8 次 | 筛掉全对和全错的场景,剩下的够训 |
| 6–7 | 主实验 | 二值奖励、分项奖励各一次 | 奖励曲线、每 50 步在验证集上的成功率 |
| 8 | 评测 | Day 127 评测跑 4 个模型 | 表格带区间,分根因统计 |
| 9 | 查作弊和泛化 | 留出类评测、轨迹抽查 | 至少读 50 条高分轨迹 |
| 10 | 报告 | 技术报告、模型卡、适配器发布 | 别人能照着配方复现第一步 |

## 验收指标

| 指标 | 怎么测 | 目标 |
| --- | --- | --- |
| 训练后成功率(pass^1) | Day 127 评测,100 场景 × 4 次 | 高于训练前,且区间不重叠才算提升 |
| pass^4 | 同上 | 报告即可,看稳定性有没有一起变好 |
| 留出根因类成功率 | 训练没见过的那一类 | 只报告,不设目标;下降要解释 |
| 误冲正率 | 库里未驳回的错误贷记单 | 不高于训练前,这是红线 |
| 数字幻觉率 | Day 125 校验器 | 不高于训练前 |
| 平均工具调用数 | 轨迹统计 | 报告;明显上升要查是否在刷工具 |
| 与 API 模型的差距 | 同一评测跑 deepseek-flash、Claude Sonnet 5.5 | 只报告实测,不预设能追上 |
| 单场景推理成本 | 训练后模型自部署的 GPU 时 vs API 账单 | 给算式和实测 |

奖励我先这样设,训练中按作弊情况改:根因对 0.35、金额精确 0.35、动作对 0.1、证据链完整 0.2(结论里每个数字都能在本回合工具输出里找到);误冲正扣 1,数字幻觉扣 0.5,结论里多列的发票超过一张每张扣 0.1,没提交结论记 0。分项奖励让同一组 8 条轨迹之间有差别,GRPO 才有梯度;二值奖励更难被钻空子。两种都跑,就是主实验的对照。

预算算式:`总费用 = Σ(每次实验的 GPU 小时 × 单价) + 网络存储 + 评测用的 API 费`。2026-10-15 查的按需价格,单卡 H100 80GB 在 RunPod 价格页上是 $2.69–3.99/小时(页面表格和结构化数据给的数不一致,社区云和安全云也不同),Lambda 单卡 H100 SXM $4.29、PCIe $3.29,Vast.ai 是竞价市场,当天 API 查到单卡 H100 SXM 报价 $1.92–2.54;最便宜的 RTX 4090 24GB 在 RunPod 上 $0.34–0.89。按下面的计划(小时数是计划,第 4 周测出每步耗时后替换):

| 项 | GPU | 小时 | 按 $2.5–4.3/小时 |
| --- | --- | --- | --- |
| 打通流程 | 1×4090 | 2 | $1–2 |
| 调试 | 1×H100 | 6 | $15–26 |
| 主实验 ×3(两种奖励 + 一次换种子重复) | 1×H100 | 36 | $90–155 |
| 评测部署 | 1×H100 | 4 | $10–17 |
| 全参对照(加分) | 4×H100 | 4×6=24 | $60–103 |

不含全参约 $115–200,含全参约 $175–300。硬上限 $300,每次实验开跑前写好最大步数,训练脚本里加墙钟超时,跑完立刻关机;检查点写到网络卷,不然实例一停就没了。API 部分是第 3 周用 deepseek-flash 当策略跑环境、第 8 周两个 API 模型的评测,按 Day 127 的规模估在 $20–50。

## 最终产出

- 开源仓库 `ledgergym`:环境、奖励函数、训练配置、评测脚本,Apache-2.0。
- Hugging Face 上的 LoRA 适配器和模型卡,写清楚基座、数据、奖励、已知缺陷。
- 技术报告:奖励设计、两种奖励的对比、训练前后的评测表、抓到的作弊案例、失败的实验。
- 一篇长文《我花了 $X 训练一个会查账的 4B 模型》,X 填真实账单。
- 加分:向 TRL 提一个 issue 或 PR,内容是你在多轮工具调用上踩到的真实问题。

## 难点和坑

**Intel Mac 装不上训练栈。** PyTorch 给 Intel Mac 的最后一个 wheel 是 2.2.2,而当前 transformers(5.x)要求 `torch>=2.5`,TRL 的 `environment_factory` 又要求 `transformers>=5.2.0`。所以本机连跑通 TRL 都做不到。本机能做的是三件事:环境和奖励函数(纯 Python + SQLite)、它们的单元测试、用 API 模型当策略跑完整回合。打通训练流程这一步,租一张 4090 一两个小时,先用 `trl-internal-testing/tiny-Qwen3ForCausalLM` 这种 200 多万参数的随机小模型验证管线,再换 Qwen3.5-0.8B。

**真值被当成工具暴露。** TRL 会把环境类的公开方法全部变成工具。你写了一个方便调试的 `def truth(self)`,模型就能直接调它拿答案,奖励曲线会漂亮得不正常。标准答案放在 `_truth` 这样的私有属性里,再写一个测试断言暴露出来的工具列表正好是那九个。

**判分规则被钻空子。** Day 127 的发票判法是「标准答案的发票都在结论里就算对」。RL 一定会发现「把所有发票都列上」最安全。另一个常见的是「一律不冲正」:如果误冲正扣分重、漏冲正不扣分,模型会学成只解释不动手,在 80% 有错的场景上丢分但避开了最大的惩罚。要按动作类型分开看成功率,而不是只看总分。

**组内全对或全错,梯度为零。** GRPO 的优势是相对组均值算的,8 条轨迹奖励都一样,这个场景就白跑了。训练前先对每个场景采样 8 次,只留成功率在 0 和 1 之间的;题太难就从 L1 开始,做成课程。

**多轮的 token 对不上。** verl 的 Agent Loop 文档专门写了这个坑:把最终的消息列表重新套一遍对话模板得到的 token,和生成时逐轮拼起来的 token 不一样,部分原因是工具解析器改写了模型的输出。TRL 文档则要求对话模板「前缀保持」,并为 Qwen3 等模型换上了打过补丁的模板。用 Qwen3.5 要把思考模式关掉(`chat_template_kwargs={"enable_thinking": False}`),再检查一条轨迹的 token 和对数概率是否对齐。

**环境里的写操作。** `draft_credit_note` 会写库。8 条轨迹并发跑,如果共用一个 SQLite 文件,一条轨迹的草稿会出现在另一条的 `list_invoices` 里。每条轨迹 `reset()` 时复制一份库到临时目录,回合结束删掉。

**评测和训练用了同一批题。** 训练场景用新种子造,但模板化的客户原话和虚构客户名会重复。训练集里换一套客户名,评测前对 100 个场景的原话做一次和训练集的重复检测。

## 面试里怎么讲

示范讲法:「我想知道一个 4B 开源模型经过强化学习能不能接住计费争议这种多轮工具调用的任务。我把之前做的 BillSleuth 包成环境,奖励全用代码判:根因、金额精确到分、结论里的数字必须能追溯到工具输出,误冲正重罚。用 TRL 的 GRPO 加 LoRA 在单张 H100 上训练,总共花了(真实数字)。训练后在 100 个场景上成功率从 A 到 B(带区间),但留出的那一类根因没有提升,说明它学到的更多是这套工具的使用套路,而不是计费规则。训练中我抓到两次奖励黑客,一次是把所有发票都列进结论,一次是一律不冲正,改了奖励才压下去。取舍上我没训全参,因为 RL 场景下 LoRA 低秩就够,省下的钱用来多跑一组对照。」A、B 和结论都换成你的实测。

<details>
<summary>为什么用 GRPO 而不是 PPO 或 DPO?</summary>

PPO 需要一个和策略差不多大的价值网络,单卡训 4B 时显存和工程量都翻倍;GRPO 用同一场景一组采样的组内均值当基线,省掉了它。DPO 需要成对的偏好数据,而计费场景有精确的可验证奖励,直接在线优化这个奖励更直接。GRPO 的代价是每个场景要采样多次,生成成本高,而且组内奖励相同时没有梯度,所以要筛题。

</details>

<details>
<summary>你怎么证明提升不是钻了奖励的空子?</summary>

三件事。第一,评测用 Day 127 的判分器,它和训练奖励是两份代码,而且按库终态判,不看模型自己声称做了什么。第二,分指标看:成功率上去但误冲正率或数字幻觉率也上去,就不算提升。第三,读轨迹,高分轨迹至少抽 50 条人工看。我抓到的作弊案例本身就写进报告。

</details>

<details>
<summary>这个模型能上生产吗?</summary>

我会说现在不能。它只在虚构公司、12 类故障、单一数据结构上训练过,留出类上的表现说明泛化有限。它证明的是方法:一个业务流程只要能精确判分,就能用这套环境加奖励的方式把小模型训到一个可测量的水平。上生产还需要真实数据分布、更多故障类型、人工审批兜底,以及和 API 大模型在成本和质量上的帕累托比较。

</details>

## 前置知识

- Day 29:pass^k
- Day 69:评测统计与置信区间
- Day 75:选模型与成本算式
- Day 76:vLLM 自部署
- Day 77:LoRA SFT
- Day 79:蒸馏(加分项的拒绝采样 SFT)
- Day 80:RLVR 与 GRPO
- Day 121–128:BillSleuth 全套,尤其 Day 122 造数、Day 123 工具、Day 125 数字溯源、Day 127 评测

## 参考资料

- [DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models](https://arxiv.org/abs/2402.03300)(Shao 等,2024):GRPO 的出处,看组内基线怎么算。
- [DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning](https://arxiv.org/abs/2501.12948)(DeepSeek-AI,2025):规则奖励、为什么不用神经网络奖励模型。
- [DAPO: An Open-Source LLM Reinforcement Learning System at Scale](https://arxiv.org/abs/2503.14476)(Yu 等,2025):TRL 默认损失类型的来源。
- [Understanding R1-Zero-Like Training: A Critical Perspective](https://arxiv.org/abs/2503.20783)(Liu 等,2025):Dr. GRPO,看长度偏差。
- [RAGEN: Understanding Self-Evolution in LLM Agents via Multi-Turn Reinforcement Learning](https://arxiv.org/abs/2504.20073)(Wang 等,2025)与[仓库](https://github.com/mll-lab-nu/RAGEN):多轮 Agent RL 的训练不稳定问题。
- [ToolRL: Reward is All Tool Learning Needs](https://arxiv.org/abs/2504.13958)(Qian 等,2025):工具调用任务的奖励设计对比。
- [Defining and Characterizing Reward Hacking](https://arxiv.org/abs/2209.13085)(Skalse 等,2022):奖励黑客的定义,写报告时用。
- [LoRA: Low-Rank Adaptation of Large Language Models](https://arxiv.org/abs/2106.09685)(Hu 等,2021)和 [LoRA Without Regret](https://thinkingmachines.ai/blog/lora/)(Thinking Machines,2025-09):LoRA 原理和 RL 下的秩与学习率建议。
- [TRL GRPOTrainer 文档](https://huggingface.co/docs/trl/main/en/grpo_trainer):`environment_factory`、`tools`、vLLM 两种模式、默认参数。
- [verl](https://github.com/verl-project/verl)、[Agent Loop 文档](https://verl.readthedocs.io/en/latest/advance/agent_loop.html) 和 [HybridFlow 论文](https://arxiv.org/abs/2409.19256)(Sheng 等,2024):规模化方案和多轮 token 对齐的坑。
- [OpenPipe ART](https://github.com/OpenPipe/ART):备选框架,专做多步 Agent 的 GRPO。
- [verifiers](https://github.com/PrimeIntellect-ai/verifiers) 与 [prime-rl](https://github.com/PrimeIntellect-ai/prime-rl):另一套环境加训练的生态。
- [Unsloth](https://github.com/unslothai/unsloth):省显存的 LoRA 训练,ART 底层也用它。
- 模型:[Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B)(主实验)、[Qwen3.5-0.8B](https://huggingface.co/Qwen/Qwen3.5-0.8B)(打通流程)、[tiny-Qwen3ForCausalLM](https://huggingface.co/trl-internal-testing/tiny-Qwen3ForCausalLM)(冒烟测试)。
- GPU 价格页(2026-10-15 查证):[RunPod](https://www.runpod.io/pricing)、[Lambda](https://lambda.ai/pricing)、[Vast.ai](https://vast.ai/pricing)。
