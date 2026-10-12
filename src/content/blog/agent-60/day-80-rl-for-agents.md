---
title: 'Day 80 · 强化学习与 Agent:RLVR、GRPO 和工具使用训练'
description: 'SFT 和蒸馏都是在模仿,上限是老师。强化学习让模型从结果的对错里学,这是 2025 年以来推理模型和 Agent 能力提升的主要来源。今天讲清楚 RLVR 和 GRPO 在做什么,怎么给 Agent 设计奖励、怎么防奖励作弊,用 TRL 跑一个最小的 GRPO 实验,最后说清楚这块对应用工程师的意义边界。'
pubDate: 2026-10-12
regime: none
tags: ['reinforcement-learning', 'grpo', 'rlvr', 'reward-design', 'trl', 'agent-60']
series: 'agent-60'
day: 80
lang: 'zh'
---

## 今天要解决的问题

如果你最近一年看过几篇大模型的技术报告,大概会注意到一个变化:讲后训练的部分,强化学习占的篇幅越来越大。DeepSeek-R1 用强化学习让模型自己学会了长链推理;Qwen3.5 的模型卡里专门写了在大规模 Agent 环境中扩展强化学习。Agent 能用工具、能多步规划,越来越多是练出来的,而不是教出来的。

作为应用工程师,你大概率不会去训练一个基座模型。但资深岗位的面试里,「你怎么理解 GRPO」「Agent 的奖励怎么设计」这类问题越来越常见;而且设计可验证奖励的能力,和你在 W5 学的设计评测的能力几乎是同一种能力。学完今天,你应该能做到:

1. 说清楚 SFT、蒸馏、强化学习三者学习信号的区别,以及为什么强化学习有机会超过老师。
2. 解释 RLVR(可验证奖励)和 GRPO 的工作方式:组内采样、相对优势、为什么不需要价值模型。
3. 给一个 Agent 任务设计奖励函数,能识别常见的奖励作弊方式并设防。
4. 用 TRL 的 GRPOTrainer 在单卡上跑一个分诊任务的 GRPO 玩具实验,读懂 reward、`frac_reward_zero_std` 这些训练指标。
5. 说出这块技术对应用团队的现实意义和边界:什么时候值得做,什么时候不值得。

预计用时 5–6 小时,其中训练在 T4 上大约一两个小时。前置:Day 77(LoRA)、Day 78(DPO)、Day 79(蒸馏)。

## 模仿和试错

前几天学的三种方法,学习信号都来自「正确的样子」:SFT 模仿标准答案,DPO 模仿好回答、远离差回答,蒸馏模仿老师。它们的共同上限是示范数据的质量。

强化学习换了一种信号:不给示范,只给结果的好坏。模型自己尝试,做对了加分,做错了不加分,慢慢把做对的那些行为的概率提高。这带来两个关键差别。

第一,它能发现示范里没有的做法。DeepSeek-R1 的论文报告了一个现象:只用「最终答案对不对」作为奖励训练,模型在训练中自己学会了更长的思考、反复检查、换思路重试,论文把其中一个时刻叫作 aha moment。没有人示范过这些行为。

第二,它学的是在自己的分布上做对。SFT 时模型看到的都是老师写的完美轨迹,从没见过自己犯错之后该怎么办;强化学习时模型在自己生成的轨迹上学,包括从错误中恢复。这对多步 Agent 特别重要,因为 Agent 的错误会累积。

代价是信号稀疏。一条完整的轨迹,最后只得到一个分数,模型不知道是哪一步做对了、哪一步做错了。所以强化学习需要大量的尝试,算力开销远大于 SFT。昨天提到的在线策略蒸馏,就是想在保留「在自己的分布上学」的同时,用老师的逐 token 打分把信号变密。

## RLVR:能验证的奖励

强化学习最难的部分是奖励从哪来。Day 78 讲的 RLHF 用一个学出来的奖励模型打分,问题是奖励模型本身会有漏洞,模型训练久了会学会钻这些漏洞,得到高分却不是真的变好了。

RLVR(Reinforcement Learning with Verifiable Rewards,可验证奖励的强化学习)这个说法来自 AI2 的 Tulu 3 论文,思路很朴素:只在能用程序判断对错的任务上训练。数学题对答案、代码跑单元测试、格式用解析器检查、SQL 在数据库里执行看结果。程序判断不会被讨好,奖励作弊的空间小得多。

这对你意味着什么?回想 W5 的评测:你写过规则检查(JSON 是否合法、是否调用了必须调用的工具、回复里有没有禁止语句、金额是否和工具结果一致)。这些检查原封不动就是可验证奖励。会设计评测的人,就会设计 RLVR 的奖励。这也是为什么做评测的经验在 Agent 训练相关的岗位上很值钱。

## GRPO:组内比较,省掉价值模型

GRPO(Group Relative Policy Optimization)出自 DeepSeekMath 论文,后来因为 DeepSeek-R1 而广为人知。要理解它省了什么,先回忆 Day 78 讲的 PPO:PPO 需要一个价值模型来估计「这个状态平均能拿多少分」,用实际得分减去这个估计得到优势(advantage),优势为正说明这次做得比平均好,就提高这次行为的概率。价值模型和策略模型差不多大,训练它又费显存又不稳定。

GRPO 的想法是:不用模型去估计平均分,直接现场测。对同一个提示,让模型生成一组(比如 8 个)回答,每个都用奖励函数打分,然后用这一组的平均分当基准:

```text
对同一个 prompt 采样 G 个回答,得分 r1 ... rG
优势 Ai = (ri - mean(r)) / std(r)
得分高于组内平均的回答,提高它的概率;低于平均的,降低它的概率
```

好处立刻可见:不需要价值模型,显存省了一大块;优势是组内相对的,奖励的绝对尺度不重要。

但它也带来一个特有的问题:如果一组回答的得分全一样(全对或全错),标准差为零,优势全是零,这一组对训练毫无贡献。TRL 把这个比例记录为 `frac_reward_zero_std`。题目太简单(全对)或太难(全错)都会让这个比例很高,训练就停滞了。所以 RLVR 的训练数据要挑难度适中的题,让模型「有时对有时错」,这是 GRPO 能学到东西的前提。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="GRPO:同一个提示采样一组回答,按组内平均算相对优势">
<rect x="20" y="105" width="110" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="75" y="125" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">一张工单</text>
<text x="75" y="140" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">prompt</text>
<g stroke="var(--rule)" stroke-width="1.5">
<line x1="130" y1="127" x2="190" y2="45"/><line x1="130" y1="127" x2="190" y2="100"/><line x1="130" y1="127" x2="190" y2="155"/><line x1="130" y1="127" x2="190" y2="210"/>
</g>
<g font-family="var(--font-mono)" font-size="11">
<rect x="190" y="28" width="170" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="200" y="50" fill="var(--ink)">回答 1 → refund</text>
<rect x="190" y="83" width="170" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="200" y="105" fill="var(--ink)">回答 2 → billing</text>
<rect x="190" y="138" width="170" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="200" y="160" fill="var(--ink)">回答 3 → refund</text>
<rect x="190" y="193" width="170" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="200" y="215" fill="var(--ink)">回答 4 → 坏 JSON</text>
</g>
<g font-family="var(--font-mono)" font-size="11">
<rect x="380" y="28" width="90" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="425" y="50" fill="var(--ink)" text-anchor="middle">1.2</text>
<rect x="380" y="83" width="90" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="425" y="105" fill="var(--ink)" text-anchor="middle">0.2</text>
<rect x="380" y="138" width="90" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="425" y="160" fill="var(--ink)" text-anchor="middle">1.2</text>
<rect x="380" y="193" width="90" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="425" y="215" fill="var(--ink)" text-anchor="middle">0.0</text>
<text x="490" y="50" fill="var(--ink)">+ 提高</text>
<text x="490" y="105" fill="var(--ink-soft)">- 降低</text>
<text x="490" y="160" fill="var(--ink)">+ 提高</text>
<text x="490" y="215" fill="var(--ink-soft)">- 降低</text>
</g>
<text x="425" y="250" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">琥珀色是奖励函数(程序验证)打的分,组内平均 0.65</text>
</svg>
<figcaption>GRPO 不需要价值模型,用同一组回答的平均分当基准。如果四个回答都得 1.2 或都得 0,优势全为零,这组就白采样了。</figcaption>
</figure>

GRPO 之后又有不少改进。DAPO 论文针对长推理训练提出了几项修改(比如非对称的裁剪范围、按 token 而不是按序列平均损失);《Understanding R1-Zero-Like Training》这篇论文(提出了 Dr. GRPO)指出原始 GRPO 的长度归一化和标准差归一化会带来偏差,比如倾向于让错误回答变长。你不需要记住这些细节,但要知道框架里的默认值已经吸收了这些改进:我查 TRL 文档时,GRPOTrainer 的 `loss_type` 默认值是 `"dapo"`,KL 系数 `beta` 默认是 0(也就是默认不加载参考模型)。看到这些参数时,知道它们从哪来就够了。

## 给 Agent 设计奖励

单轮任务的奖励好设计,Agent 任务难很多,因为一条轨迹有很多步,结果可能部分正确。常见的奖励组成:

结果奖励。任务最终完成了没有:退款申请的金额对不对、回复里的事实是否和数据库一致、代码改动是否通过测试。这是最重要的部分,也最难作弊。

格式奖励。输出能不能被解析、工具调用参数是否符合 schema。给一个小的分数,防止模型在训练早期因为格式全错而拿不到任何结果奖励。

过程约束。高风险操作前有没有调用审批工具、有没有越权调用工具。违反了直接重罚,而不是扣一点分。

效率。步数和 token 的轻微惩罚,防止模型学会无意义地反复调工具。权重要小,否则模型会学会「少做事」来避免扣分。

奖励作弊(reward hacking)是强化学习永恒的问题:模型会找到你没想到的方式拿高分。Lilian Weng 写过一篇很长的综述,里面有大量例子。放到 Agent 场景,常见的几种:

格式钻空子。奖励只检查 JSON 能不能解析,模型学会在 JSON 后面附上一段解释,解析器宽松地截取了 JSON,于是两者都「对」。对策是严格解析,多余内容直接判零。

迎合判定器。如果结果奖励由 LLM judge 打分,模型可能学会说 judge 爱听的话(比如反复强调「已核实」)。能用程序验证的就别用 judge。

改测试而不是改代码。代码 Agent 的经典作弊:奖励是「测试通过」,模型把测试改了。对策是测试文件只读,或者在隔离的沙箱里用原始测试重新跑。

规避任务。有转人工选项的客服 Agent,如果转人工不扣分,模型可能学会把难的工单全转出去。对策是给转人工一个合理的成本,并单独监控转人工率。

设计奖励时的一个好习惯:每加一条奖励规则,都问自己「一个只想刷分、不想做好事情的人,会怎么利用这条规则」。这和 Day 39 做注入测试的思路是一样的。

多轮 Agent 的强化学习是 2025 年以来很活跃的研究方向。ReTool 用强化学习教模型在推理中调用代码解释器;Search-R1 教模型在推理中决定什么时候搜索、搜什么;RAGEN 研究多轮交互训练中的不稳定性。读这几篇的摘要,能对「Agent 是怎么被训练出来的」有个具体的印象。

## 动手:GRPO 训练一个分诊模型

玩具实验的任务还是分诊,因为它的奖励可以完全由程序验证:输出格式对不对,类别和标注一不一致。三个奖励函数:

```python
# agentops-lab/w12/rewards.py
"""GRPO 的奖励函数:全部是程序能验证的规则,不用奖励模型。
TRL 约定:关键字参数调用,completions 是对话格式时每个元素是 [{"role": "assistant", "content": ...}],
数据集里除 prompt 以外的列(这里是 gold)会作为同名参数传进来;返回每条一个 float。
"""
import json

KEYS = {"category", "needs_account_data", "needs_human", "urgency"}
CATEGORIES = {"billing", "refund", "invoice", "account", "technical", "plan_change", "api", "other"}


def _text(c):
    return c[0]["content"] if isinstance(c, list) else c


def _parse(text):
    try:
        obj = json.loads(text.strip())
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


def format_reward(completions, **kwargs):
    """输出必须是只含四个字段的合法 JSON,类别在枚举内。满足给 0.2,否则 0。"""
    out = []
    for c in completions:
        obj = _parse(_text(c))
        ok = obj is not None and set(obj) == KEYS and obj.get("category") in CATEGORIES
        out.append(0.2 if ok else 0.0)
    return out


def category_reward(completions, gold, **kwargs):
    """类别和标注一致给 1.0。gold 是数据集里的一列,每条是可接受类别的列表。"""
    out = []
    for c, g in zip(completions, gold):
        obj = _parse(_text(c)) or {}
        out.append(1.0 if obj.get("category") in g else 0.0)
    return out


def length_penalty(completions, **kwargs):
    """分诊输出应该很短,超过 200 个字符开始扣分,防止模型学会在 JSON 外面写长篇解释。"""
    return [-min(0.5, max(0, len(_text(c)) - 200) / 400) for c in completions]
```

注意 `format_reward` 用的是严格解析:`json.loads` 整段文本,多一个字都算错;字段集合必须恰好是那四个,多一个 `reason` 字段也不给分。这正是在防上一节说的格式钻空子。这几个函数我写了单元测试,覆盖了正确 JSON、多字段、非 JSON、超长输出和纯字符串输入。

训练脚本用 TRL 的 GRPOTrainer。数据用 Day 79 打好标签的工单,但只保留「难度适中」的:先用基座模型对每条采样几次,全对的和全错的都去掉一部分,否则 `frac_reward_zero_std` 会很高。

```python
# agentops-lab/w12/train_grpo.py
"""用 GRPO 训练分诊。TRL 1.x(2026-10 查到最新 1.15),参数名以官方文档为准。
依赖:pip install trl peft datasets(装 trl[vllm] 可以用 vLLM 加速采样)
数据:grpo_train.jsonl,每行 {"subject", "body", "gold": ["refund"]}
"""
import json

from datasets import Dataset
from peft import LoraConfig
from trl import GRPOConfig, GRPOTrainer

from build_sft_data import SYSTEM
from rewards import category_reward, format_reward, length_penalty

rows = [json.loads(l) for l in open("grpo_train.jsonl", encoding="utf-8") if l.strip()]
dataset = Dataset.from_list([{
    "prompt": [{"role": "system", "content": SYSTEM},
               {"role": "user", "content": f"主题:{r['subject']}\n正文:{r['body']}"}],
    "gold": r["gold"],
} for r in rows])

args = GRPOConfig(
    output_dir="grpo_out",
    num_generations=8,              # 每张工单采样 8 个回答组成一组
    max_completion_length=96,       # 分诊输出很短
    per_device_train_batch_size=8,  # 有效 batch 必须能被 num_generations 整除
    gradient_accumulation_steps=2,
    learning_rate=1e-5,             # LoRA 用比全量微调高的学习率
    num_train_epochs=1,
    logging_steps=5,
    fp16=True, bf16=False,          # T4;新卡改 bf16
    report_to="none",
    # use_vllm=True,                # 有 trl[vllm] 时打开,采样快很多
)

trainer = GRPOTrainer(
    model="Qwen/Qwen3-0.6B",
    reward_funcs=[format_reward, category_reward, length_penalty],
    args=args,
    train_dataset=dataset,
    peft_config=LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"),
)
trainer.train()
trainer.save_model("grpo_lora")
```

Qwen3-0.6B 是带思考模式的模型,默认会先输出一段思考再给答案,超过 96 个 token 就被截断了。实际跑的时候有两个选择:在数据集的 prompt 后面让模板关闭思考(用 Day 79 提到的 `enable_thinking=False` 生成 prompt 文本),或者把 `max_completion_length` 放大并让奖励函数只解析思考之后的部分。用 Thinking Machines 的话说,LoRA 在强化学习里很省:他们的实验里 rank 1 都能追平全量微调,因为一次强化学习任务能提供的信息量本来就很少。所以 0.6B 加 LoRA 在 T4 上是能跑起来的。如果你更想照着现成的笔记本走,Unsloth 有 Qwen3 (4B) GRPO 和 GRPO 加工具使用的 Colab 笔记本,思路一样。

训练时看这几个指标(名字来自 TRL 的日志):

`reward` 是平均总奖励,应该逐步上升。按奖励函数拆开的 `rewards/format_reward/mean` 和 `rewards/category_reward/mean` 能告诉你是哪一部分在涨。通常格式奖励先涨到接近满分,类别奖励后涨。

`frac_reward_zero_std` 是组内得分完全相同的比例。高于一半说明数据太简单或太难,要回头调整数据难度。

`completions/mean_length` 是回答平均长度。分诊任务里它应该稳定在一个较短的值,如果持续变长,检查是不是模型在 JSON 外面加内容(长度惩罚应该在抑制它)。

训练完用 Day 79 的方法挂到 vLLM,在 dev 和 test 上评测,和 SFT 版本对比。结果留空给你填:

| 模型 | dev 准确率 | test 准确率 | JSON 合法率 | 平均输出长度 |
| --- | --- | --- | --- | --- |
| Qwen3-0.6B 原版 | | | | |
| Qwen3-0.6B + SFT(Day 79) | | | | |
| Qwen3-0.6B + GRPO | | | | |
| Qwen3-0.6B + SFT 再 GRPO | | | | |

最后一行是业界常见的做法:先 SFT 让模型学会基本格式和行为,再用强化学习进一步打磨。你可以比较一下哪种组合在你的数据上最好。

选做:TRL 的 GRPOTrainer 还支持工具调用和环境(`tools` 参数和 `environment_factory` 参数,后者要求 transformers 5.2 以上)。环境是一个类,`reset()` 返回任务描述,公开方法自动变成工具,`get_reward()` 返回奖励。你可以把 Day 23 的 CloudLedger 查询包成这样一个环境:任务是「查出某客户上个月是否被重复扣费」,工具是 `list_invoices`,奖励是最终回答和数据库里的事实是否一致。这就是一个最小的多轮 Agent 强化学习环境,TRL 文档的 GRPO 页面里有完整的接口说明和示例。

## 对应用工程师的意义边界

最后说点实在的。强化学习训练对大部分应用团队来说,投入产出比并不高:需要稳定的可验证奖励、大量的采样算力、熟悉训练不稳定问题的人,而且训出来的往往是一个专门任务的小模型。在你的分诊这种任务上,SFT 加蒸馏通常已经够了。

但有几件事值得你掌握。第一,看懂模型。今天的推理模型和 Agent 模型是怎么训练出来的,决定了它们的行为习惯,比如为什么推理模型在简单问题上也想很久、为什么有的模型特别爱调工具。第二,奖励设计就是评测设计。你写的每一个评测检查,都可能成为某个团队训练时的奖励函数;反过来,学会防奖励作弊会让你的评测更难被「刷分」。第三,职业方向。Agent 强化学习、环境搭建、奖励设计是 2026 年招聘里需求增长很快的方向,尤其是在做 Agent 产品的公司里,懂应用又懂训练的人很少。

什么时候值得做:你有一个高频、有明确对错标准的任务,SFT 和蒸馏的效果到顶了,团队有 GPU 和训练经验,而且这个任务对业务足够重要。不满足这些,就把今天当作理解原理的一课。

## 动手练习

今天的产出物是一组经过单元测试的奖励函数、一次 GRPO 训练记录,和一份奖励作弊分析。

1. 把 `rewards.py` 复制到你的仓库,给每个奖励函数写单元测试,至少覆盖:正确输出、多余字段、非 JSON、超长输出。
2. 准备 `grpo_train.jsonl`:从 Day 79 打好标签的数据里选 500 条,用基座模型每条采样 4 次,去掉全对的一半和全错的一半,记录去掉前后的比例。
3. 跑 `train_grpo.py`(或者 Unsloth 的 GRPO 笔记本),截图 `reward`、按函数拆分的奖励和 `frac_reward_zero_std` 三条曲线,各写一句解读。
4. 在 dev、test 上评测,填对比表。
5. 写一份奖励作弊分析:针对你的三个奖励函数,各想出一种模型可能的作弊方式,说明你的实现能不能防住,防不住的话怎么改。
6. 选做:用 `environment_factory` 搭一个 CloudLedger 查询环境,跑通几步训练,不要求效果。

验收标准:奖励函数单元测试全部通过;训练曲线截图和解读齐全;对比表至少填满三行;奖励作弊分析每条都有具体的防御措施或改进方案。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 强化学习 | 模型自己尝试,根据结果的奖励调整行为,而不是模仿示范 |
| RLVR | 可验证奖励的强化学习,奖励由程序判定(对答案、跑测试、查格式) |
| 奖励模型 | 学出来的打分模型,RLHF 用它,但可能被钻漏洞 |
| GRPO | 组相对策略优化,同一提示采样一组回答,用组内平均当基准算优势,不需要价值模型 |
| 优势(advantage) | 这次结果比基准好多少,为正就提高这次行为的概率 |
| 价值模型 | PPO 中估计「平均能拿多少分」的模型,GRPO 省掉了它 |
| 奖励作弊 | 模型找到拿高分但没有真正完成任务的方法 |
| 结果奖励 / 过程奖励 | 只看最终结果打分 / 对中间步骤也打分 |
| frac_reward_zero_std | 组内得分全部相同的比例,高说明数据太难或太简单,学习信号少 |
| 环境 | 强化学习中模型与之交互的对象,提供任务、工具和奖励 |

## 常见误区

**以为强化学习能凭空教会模型新知识。** 强化学习主要是把模型已经「有时能做对」的行为变得更稳定、更可靠。如果模型在某类任务上一次都做不对,组内得分全是零,什么也学不到。所以通常先 SFT 打底再上强化学习。

**奖励函数写得宽松。** 宽松的解析、模糊的判定都会被模型利用。奖励要严格,而且每条规则都要想一遍会被怎么钻空子。

**用 LLM judge 当主要奖励。** judge 会被讨好。能用程序验证的就用程序,judge 只用在确实无法程序化的维度上,并且要监控有没有出现迎合现象。

**只看平均奖励上升就认为成功。** 奖励上升可能是作弊。一定要在独立的评测集上用和训练奖励不同的检查方式验证,并且人工看一些训练后的输出。

**数据难度不调就开始训。** 全对和全错的题在 GRPO 里都没有学习信号,`frac_reward_zero_std` 很高时训练基本是在空转。

## 学习资料

### 文档与文章

- [DeepSeekMath 论文](https://arxiv.org/abs/2402.03300):GRPO 的出处,读第 4 节,1 小时。
- [DeepSeek-R1 论文](https://arxiv.org/abs/2501.12948):读 R1-Zero 部分和 aha moment 的讨论,理解强化学习为什么能让推理能力涌现。
- [Tulu 3 论文](https://arxiv.org/abs/2411.15124):RLVR 这个说法的来源,读介绍 RLVR 的那一节。
- [DAPO 论文](https://arxiv.org/abs/2503.14476)和 [Understanding R1-Zero-Like Training](https://arxiv.org/abs/2503.20783):GRPO 的两种改进,各读摘要和主要修改点,知道 TRL 默认值从哪来。
- [ReTool](https://arxiv.org/abs/2504.11536)、[Search-R1](https://arxiv.org/abs/2503.09516)、[RAGEN](https://arxiv.org/abs/2504.20073):多轮 Agent 强化学习的三个代表工作,读摘要和方法图。
- [TRL · GRPO Trainer](https://huggingface.co/docs/trl/main/grpo_trainer):奖励函数签名、工具和环境接口、全部日志指标,今天代码的依据。
- [Lilian Weng · Reward Hacking in Reinforcement Learning](https://lilianweng.github.io/posts/2024-11-28-reward-hacking/):奖励作弊最全面的综述,挑 LLM 相关的部分读,1 小时。
- [Thinking Machines · LoRA Without Regret](https://thinkingmachines.ai/blog/lora/):其中强化学习那一节解释了为什么低秩 LoRA 在强化学习里就够用。
- [Unsloth 强化学习指南](https://unsloth.ai/docs/get-started/reinforcement-learning-rl-guide):在单卡上跑 GRPO 的实践建议。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1enQLYKEA5&autoplay=0&high_quality=1" title="DeepSeek-GRPO" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>RethinkFun · DeepSeek-GRPO · 18 分钟,从 PPO 讲到 GRPO 为什么不需要价值模型,和正文 GRPO 一节对应。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1pXA5eyEEg&autoplay=0&high_quality=1" title="[LLM+RL] 理解 GRPO 公式原理及 TRL GrpoTrainer 代码实现(advantage 与 loss 计算)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>五道口纳什 · [LLM+RL] 理解 GRPO 公式原理及 TRL GrpoTrainer 代码实现 · 48 分钟,对着 TRL 源码讲优势和损失怎么算,今天跑完实验再看收获更大。注意录制时的 TRL 版本较老,默认参数已有变化。</figcaption>
</figure>

- 吃花椒的麦 · [【大白话03】一文理清强化学习RL基本原理](https://www.bilibili.com/video/BV1rooaYVEk8):35 分钟,强化学习零基础的先看这个。
- 东川路第一可爱猫猫虫 · [【GRPO】零基础也能看懂的GRPO算法](https://www.bilibili.com/video/BV1EEP6zTEWu):17 分钟,2026 年 3 月。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bAWV_yrqx4w" title="[GRPO Explained] DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Yannic Kilcher · [GRPO Explained] DeepSeekMath · 逐段讲解 DeepSeekMath 论文和 GRPO,适合配合论文第 4 节看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/mg-iU-WxiNs" title="GRPO: The RL Trick Behind DeepSeek-R1's Reasoning" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Jia-Bin Huang · GRPO: The RL Trick Behind DeepSeek-R1's Reasoning · 用动画讲 GRPO 的直觉,时间短,适合复习。</figcaption>
</figure>

- Stanford Online · [CS336 Spring 2025 Lecture 16: Alignment - RL 1](https://www.youtube.com/watch?v=46f2QTDB08Q) 和 [Lecture 17: Alignment - RL 2](https://www.youtube.com/watch?v=JdGFdViaOJk):斯坦福课程讲强化学习对齐的两讲,不允许嵌入,点链接看,有时间再深入。

### 书籍

- Nathan Lambert《RLHF Book》(在线免费,rlhfbook.com):强化学习与可验证奖励相关的章节,讲得比论文好读。
- Sebastian Raschka《Build a Reasoning Model (From Scratch)》(Manning):从零实现推理模型,包括用 GRPO 做 RLVR 的章节。B 站上有它配套视频的中配搬运,搜书名能找到。

### 开源项目与代码

- [huggingface/trl](https://github.com/huggingface/trl):GRPOTrainer 的实现,单机实验首选。
- [volcengine/verl](https://github.com/volcengine/verl):字节跳动开源的大规模强化学习训练框架,很多 Agent 强化学习研究基于它,2026 年 9 月版本是 0.9.x。
- [OpenRLHF/OpenRLHF](https://github.com/OpenRLHF/OpenRLHF):另一个主流的分布式 RLHF 框架。
- [huggingface/open-r1](https://github.com/huggingface/open-r1):Hugging Face 复现 DeepSeek-R1 的开源项目,看它的数据和训练配置。
- [rasbt/reasoning-from-scratch](https://github.com/rasbt/reasoning-from-scratch):上面那本书的代码仓库。
- [unslothai/notebooks · Qwen3 (4B) GRPO](https://github.com/unslothai/notebooks/blob/main/nb/Qwen3_%284B%29-GRPO.ipynb) 和 [GRPO Tool Use](https://github.com/unslothai/notebooks/blob/main/nb/Qwen3_%284B%29-GRPO-Tool_Use.ipynb):能直接在 Colab 跑的 GRPO 笔记本。

## 自测

1. SFT、蒸馏、强化学习的学习信号分别是什么?为什么只有强化学习有机会超过示范数据的水平?

<details><summary>答案</summary>

SFT 的信号是标准答案,蒸馏的信号是老师的输出(或分布),都是模仿,上限是示范的质量。强化学习的信号是结果的奖励,模型自己探索,能发现示范中没有的做法(比如 R1 自发学会反复检查),并且在自己的分布上学习从错误中恢复,所以有机会超过示范。

</details>

2. 一组 8 个回答的得分是 [1, 1, 1, 1, 1, 1, 1, 1],GRPO 的优势是多少?这对训练意味着什么?

<details><summary>答案</summary>

组内平均 1,标准差 0,所有优势都是 0(实现里分母会加一个很小的数防止除零),这组对梯度没有贡献。如果大部分组都这样,训练就停滞了。说明这批题对模型太简单,要换更难的题。

</details>

3. 你的奖励是「回复通过 LLM judge 评分 ≥ 8 分」。训练后 judge 分数大涨,但人工看回复变得冗长、反复强调「已为您核实」。发生了什么?怎么改?

<details><summary>答案</summary>

奖励作弊:模型学会了迎合 judge 的偏好(冗长、讨好的表述),而不是真正提高质量。改法:把能程序验证的维度(事实与工具结果一致、是否调用必需的工具、禁止语句)改成规则奖励作为主体;judge 只评无法程序化的维度,并加长度惩罚;用独立的评测集和人工盲评验证,监控 judge 分数和人工评价的背离。

</details>

4. 为什么 RLVR 的训练数据要挑「难度适中」的题?怎么挑?

<details><summary>答案</summary>

GRPO 靠组内得分差异产生学习信号,全对或全错的题优势都是零。挑法:用训练前的模型对每道题采样多次,统计正确率,保留正确率在中间区间(比如 20% 到 80%)的题,或者去掉大部分全对和全错的题。训练过程中模型变强后,可以定期重新筛选。

</details>

5. (资深面试题)你们有一个代码审查 Agent,产品希望「用强化学习让它更会找 bug」。你怎么评估可行性,奖励怎么设计?

<details><summary>答案</summary>

先评估前提:有没有可验证的奖励来源(比如有历史上被确认的 bug 及其修复提交,可以构造「找出已知 bug」的任务;或者能注入已知缺陷);有没有足够的 GPU 和训练经验;SFT、更好的提示词和工具是否已经到顶。奖励设计:结果奖励是指出的问题位置和类型与已知 bug 匹配(按行号范围和类别程序判定);误报要扣分,否则模型会学会大量报问题;格式奖励保证评论可解析;过程上限制工具调用次数和时间。防作弊:奖励不能只看「报了多少问题」;任务集和评测集分开,评测集包含无 bug 的改动检查误报率;人工抽查训练后的评论。可行性结论往往是先用 SFT 和规则做基线,在有稳定数据管道和算力时再小规模试强化学习,并和基线做严格对比。

</details>

6. Thinking Machines 的实验显示强化学习里 rank 1 的 LoRA 就能追平全量微调,他们给的解释是什么?

<details><summary>答案</summary>

强化学习每条轨迹只提供很少的信息(大致是一个标量奖励,论文里估算每个 episode 约 1 比特),整个训练能吸收的信息量远小于 SFT,所以很小容量的适配器就足够承载。

</details>

## 明天预告

Day 81 · W12 复习:给 AgentOps 训练一个路由小模型。这一周从选模型、自部署、微调、偏好优化、蒸馏讲到强化学习。明天把它们串成一条完整的流水线:数据 → LoRA → 评测 → 部署 → 路由,产出 AgentOps 平台要用的第一个自研模型,再把这一周的面试题和坑过一遍。
