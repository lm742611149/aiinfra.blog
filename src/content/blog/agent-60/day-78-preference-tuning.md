---
title: 'Day 78 · 偏好优化:DPO 让模型学会「更好的回答」'
description: '客服回复没有唯一的标准答案,只有「这个比那个好」。今天把 RLHF、DPO、KTO、ORPO 这几种偏好优化方法的区别讲清楚,从 SupportPilot 的人工修改记录和评测结果里造成对数据,用 TRL 跑一次 DPO,再检查它有没有学到你不想要的东西,比如回复越来越长。'
pubDate: 2026-10-12
regime: none
tags: ['dpo', 'rlhf', 'preference', 'kto', 'orpo', 'trl', 'agent-60']
series: 'agent-60'
day: 78
lang: 'zh'
---

## 今天要解决的问题

昨天的分诊任务有标准答案:一张工单就是 refund,不是 billing。SFT 学的就是这种「照着标准答案模仿」。但 SupportPilot 起草的客户回复不一样。同一张退款工单,可以写三句话,也可以写一段;可以先道歉再解释,也可以先给结论。客服主管看两份草稿,能很快说出「这份更好」,却很难写出一份唯一正确的标准回复。

偏好优化就是为这种场景准备的:不告诉模型标准答案,只告诉它「A 比 B 好」。今天学完,你应该能做到:

1. 说清楚 RLHF 的三步流程,以及 DPO 为什么能省掉奖励模型和强化学习那两步。
2. 区分 DPO、IPO、KTO、ORPO、SimPO 这几个常见变体,知道各自需要什么样的数据。
3. 从 SupportPilot 的人工修改记录、评测检查和 LLM 评审里造一份干净的偏好对数据,并检查它有没有长度偏差。
4. 用 TRL 的 DPOTrainer 加 LoRA 在单卡上跑一次 DPO,读懂 `rewards/margins` 这些训练指标。
5. 训练完做回归检查,判断有没有出现回复变长、事实变差、格式变坏这类副作用。

预计用时 5–6 小时。前置:Day 32(LLM-as-judge)、Day 50(评测集)、Day 77(LoRA SFT)。

## 从 RLHF 到 DPO

先讲来龙去脉,面试里常被问到。2022 年 OpenAI 的 InstructGPT 论文把 RLHF 的流程定了型,分三步:

第一步 SFT,用人写的示范回答微调模型,让它先学会基本的对话。第二步训练奖励模型:同一个问题让模型生成几个回答,请人排序,用这些排序数据训练一个打分模型,输入问题和回答,输出一个分数。第三步强化学习:用 PPO 算法让模型生成回答、奖励模型打分、根据分数更新模型,同时用 KL 散度惩罚它离 SFT 模型太远,防止它为了刷分说胡话。

这套流程效果好,但工程上很重:要同时在显存里放四个模型(训练中的模型、参考模型、奖励模型、PPO 的价值模型),训练不稳定,调参很难。对应用团队来说基本是做不起的。

2023 年的 DPO(Direct Preference Optimization)论文给了一个漂亮的数学结论:在 RLHF 那个「最大化奖励、同时别离参考模型太远」的目标下,最优策略和奖励函数之间存在一个闭式关系。于是可以绕过奖励模型,直接用偏好对训练语言模型,损失函数就是一个分类损失。论文标题说得很直白:你的语言模型其实就是一个奖励模型。

DPO 的损失直觉上是这样的:对每一对 (提示, 好回答, 差回答),计算当前模型和参考模型给好回答的概率之比、给差回答的概率之比,让前者相对后者越来越大。β 控制「离参考模型多远」,β 越大越保守。TRL 文档里给出的公式是:

```text
L = -log σ( β · [ log(π(好|x) / π_ref(好|x)) - log(π(差|x) / π_ref(差|x)) ] )
```

其中 `β · log(π / π_ref)` 被叫做隐式奖励。训练时你会看到 `rewards/chosen`、`rewards/rejected` 和它们的差 `rewards/margins` 这几个指标,就是在看隐式奖励。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="RLHF 三步流程与 DPO 一步流程的对比">
<text x="20" y="25" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">RLHF(InstructGPT)</text>
<rect x="20" y="38" width="140" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="65" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">1 · SFT</text>
<line x1="160" y1="60" x2="200" y2="60" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="200" y="38" width="170" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="285" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">2 · 训练奖励模型</text>
<text x="285" y="74" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">人工排序数据</text>
<line x1="370" y1="60" x2="410" y2="60" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="410" y="38" width="210" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="515" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">3 · PPO 强化学习</text>
<text x="515" y="74" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">显存里放 4 个模型</text>
<text x="20" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">DPO</text>
<rect x="20" y="143" width="140" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="170" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">1 · SFT</text>
<line x1="160" y1="165" x2="200" y2="165" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="200" y="143" width="420" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="410" y="163" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">2 · 直接用偏好对训练(分类损失)</text>
<text x="410" y="179" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">训练中的模型 + 冻结的参考模型,没有奖励模型和价值模型</text>
<text x="320" y="225" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">同样的偏好数据,DPO 把第 2、3 步合成一步,单卡 + LoRA 就能跑</text>
</svg>
<figcaption>DPO 没有消灭奖励的概念,只是把它变成了模型自己概率比的「隐式奖励」。蓝色是训练的模型,琥珀色是 RLHF 额外需要的组件。</figcaption>
</figure>

## 几个变体,区别在数据和损失

DPO 之后出现了一大批变体。你不需要记住所有公式,但要知道它们各自解决什么问题、需要什么数据,因为数据决定了你能用哪个:

| 方法 | 需要的数据 | 要不要参考模型 | 解决什么问题 |
| --- | --- | --- | --- |
| DPO | 成对:好 / 差 | 要 | 基础方法 |
| IPO | 成对 | 要 | DPO 在偏好很确定时容易过拟合,IPO 换了损失形式缓解 |
| KTO | 不成对:单条回答 + 好或差的标签 | 要 | 线上的点赞点踩天然是不成对的,不用硬凑对 |
| ORPO | 成对 | 不要 | 把 SFT 和偏好优化合成一步,省掉参考模型 |
| SimPO | 成对 | 不要 | 用长度归一化的概率做奖励,缓解「越长越好」的偏差 |

TRL 的 DPOTrainer 把其中很多做成了 `loss_type` 参数(比如 `ipo`、`sigmoid_norm`),KTO 有单独的 KTOTrainer。选型时先看你手里有什么数据:如果是客服对 Agent 草稿点「采纳」或「不采纳」的记录,天然适合 KTO;如果是「Agent 起草、客服改了再发」的记录,改前改后正好是一对,适合 DPO。

## SupportPilot 的偏好数据从哪来

偏好对的质量比数量重要得多。一对好数据的标准是:两个回答针对同一个输入,差别集中在你想让模型学的那个属性上。如果「好回答」同时更短、更礼貌、事实更准、格式更规范,模型不知道该学哪一条,很可能学到最容易学的那条(通常是长度)。

SupportPilot 里有三个可以挖的来源:

人工修改记录。Day 49 的客服工作台里,Agent 起草的回复要经过客服确认才发出,客服常常会改几句。改之前是差回答,改之后是好回答,这是质量最高的偏好信号。前提是你在 Day 48、49 做的时候把草稿和最终发送的版本都存下来了;如果没存,现在加上,积累几周再训练。

规则检查的结果。Day 50 的评测有一堆规则:不能出现「已为您退款」这种还没审批就承诺的话、退款类回复必须引用政策文章、事实必须和工具返回一致。对同一张工单采样多份草稿,通过全部检查的作好回答,违反了某条的作差回答。这种数据是自动的,而且差别集中在你关心的那条规则上。

LLM 评审。对同一张工单的两份草稿,用 Day 32 的 judge 做两两比较。一定要交换位置各评一次,两次结论一致才算数,不一致的丢掉。这样能去掉大部分位置偏差带来的噪声。

下面这个脚本把后两种来源结合起来:对每张工单采样几份草稿,先用规则检查打分,规则分不出来的再交给 judge,最后输出 DPO 需要的格式。它依赖你 SupportPilot 里已有的两个函数:Day 50 的规则检查(这里假设叫 `run_checks`)和 Day 32 的成对评审(假设叫 `judge_pair`),名字不一样就改导入那一行:

```python
# agentops-lab/w12/build_pref_pairs.py
"""从采样的草稿里造 DPO 偏好对。
输入:drafts.jsonl,每行 {"ticket_id", "prompt": [messages...], "drafts": ["...", "...", ...], "case": {...}}
     其中 prompt 是起草节点当时的完整输入(system + 工单 + 检索结果 + 工具结果)。
输出:pairs.jsonl,每行 {"prompt": [...], "chosen": [{"role":"assistant",...}], "rejected": [...], "why": ...}
"""
import json
import statistics
import sys
from itertools import combinations
from pathlib import Path

from evals.checks import run_checks        # Day 50:返回 {"passed": bool, "failed": [检查名...]}
from evals.judges import judge_pair        # Day 32:judge_pair(case, a, b) -> "A" / "B" / "tie"


def judged_winner(case, a, b):
    """交换位置各评一次,只有两次一致才采信。"""
    first = judge_pair(case, a, b)
    second = judge_pair(case, b, a)
    if first == "A" and second == "B":
        return a, b
    if first == "B" and second == "A":
        return b, a
    return None


def pairs_for(row):
    case, drafts = row["case"], row["drafts"]
    scored = [(d, run_checks(case, d)) for d in drafts]
    good = [d for d, r in scored if r["passed"]]
    bad = [(d, r["failed"]) for d, r in scored if not r["passed"]]
    out = []
    # 来源一:规则分得出好坏的,直接成对。每张工单最多取 2 对,避免某张工单占太多
    for g in good[:1]:
        for d, failed in bad[:2]:
            out.append((g, d, "rule:" + ",".join(failed)))
    # 来源二:全部通过规则的,交给 judge 比较
    if not out and len(good) >= 2:
        for a, b in combinations(good[:3], 2):
            w = judged_winner(case, a, b)
            if w:
                out.append((w[0], w[1], "judge"))
                break
    return out


def main(src, dst):
    rows = [json.loads(l) for l in Path(src).read_text(encoding="utf-8").splitlines() if l.strip()]
    written, len_ratio, why_count = 0, [], {}
    with open(dst, "w", encoding="utf-8") as f:
        for row in rows:
            for chosen, rejected, why in pairs_for(row):
                f.write(json.dumps({
                    "prompt": row["prompt"],
                    "chosen": [{"role": "assistant", "content": chosen}],
                    "rejected": [{"role": "assistant", "content": rejected}],
                    "why": why, "ticket_id": row["ticket_id"],
                }, ensure_ascii=False) + "\n")
                written += 1
                len_ratio.append(len(chosen) / max(1, len(rejected)))
                key = why.split(":")[0]
                why_count[key] = why_count.get(key, 0) + 1
    print(f"pairs={written} from tickets={len(rows)} sources={why_count}")
    if len_ratio:
        print(f"chosen/rejected 长度比 中位数={statistics.median(len_ratio):.2f} "
              f"好回答更长的比例={sum(r > 1 for r in len_ratio) / len(len_ratio):.0%}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
```

脚本最后打印的长度统计很重要。如果「好回答更长的比例」远高于一半,比如 80%,说明你的数据里长度和好坏高度相关,训练出来的模型大概率会学成「写长一点就对了」。缓解办法:在采样时就让草稿长度相近;或者刻意补一些「好回答更短」的对(比如简洁地给出结论的草稿 vs 啰嗦但信息一样的草稿);或者换成带长度归一化的损失(TRL 里的 `sigmoid_norm`,对应 SimPO 的思路)。

草稿怎么采样:用 Day 77 的方法先有一个能起草的模型(可以是 Qwen3-4B-Instruct-2507 原版,也可以先做一轮起草的 SFT),对 300 到 1,000 张工单各采样 4 份草稿,temperature 设 0.8 左右保证有差异。草稿来自你将要训练的那个模型本身,效果最好,因为 DPO 调整的是它自己的分布。同样,用于采样的工单不能来自评测集。

## 用 TRL 跑一次 DPO

TRL 的 DPOTrainer 直接吃上面那种对话格式的数据,自动套 chat template。下面的配置在单卡上用 4 位量化的基座加 LoRA 训练,Colab T4 能跑(T4 不支持 bf16,所以开 fp16),24 GB 的卡更从容:

```python
# agentops-lab/w12/train_dpo.py
"""在 Qwen3-4B-Instruct-2507 上用 LoRA 跑 DPO。依赖:pip install trl peft bitsandbytes datasets
TRL 1.x 的 API(2026-10 查到最新是 1.15),参数名以官方文档为准。
"""
import torch
from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoTokenizer, BitsAndBytesConfig
from trl import DPOConfig, DPOTrainer

BASE = "Qwen/Qwen3-4B-Instruct-2507"

tokenizer = AutoTokenizer.from_pretrained(BASE)
tokenizer.padding_side = "left"          # DPOTrainer 要求左填充
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

data = load_dataset("json", data_files="pairs.jsonl", split="train")
data = data.remove_columns([c for c in data.column_names if c not in ("prompt", "chosen", "rejected")])
split = data.train_test_split(test_size=0.1, seed=42)

args = DPOConfig(
    output_dir="dpo_out",
    beta=0.1,                            # 越大越保守,离参考模型越近
    learning_rate=1e-5,                  # LoRA 用比全量微调高的学习率,TRL 文档建议在 1e-5 量级
    per_device_train_batch_size=2,
    gradient_accumulation_steps=8,
    num_train_epochs=1,
    max_length=4096,                     # 起草节点的输入很长,按你的数据分布设
    logging_steps=5,
    eval_strategy="steps",
    eval_steps=25,
    fp16=True, bf16=False,               # T4;Ampere 及以后的卡改成 bf16=True
    model_init_kwargs={"dtype": torch.float16},
    report_to="none",
)

trainer = DPOTrainer(
    model=BASE,
    args=args,
    train_dataset=split["train"],
    eval_dataset=split["test"],
    processing_class=tokenizer,
    quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.float16),
    peft_config=LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"),
)
trainer.train()
trainer.save_model("dpo_lora")
```

用 LoRA 时不需要单独加载参考模型:训练器把「关掉 LoRA 的基座」当作参考模型,省下一半显存。起草节点的输入动辄六七千 token,T4 上如果显存不够,先把 `max_length` 降到 2048 并只保留检索结果较短的样本跑通流程,再上更大的卡。

## 读懂训练指标

DPO 训练时最有用的几个指标(名字来自 TRL 的日志):

`rewards/accuracies` 是好回答的隐式奖励高于差回答的比例。正常情况下从 0.5 左右开始往上走。如果几十步就到了 1.0,说明你的偏好对太容易区分(比如差回答全是明显违规的),模型学到的东西可能很浅。

`rewards/margins` 是两者隐式奖励的差,应该逐步变大。

`logps/chosen` 和 `logps/rejected` 是两类回答的对数概率。一个反直觉的现象:DPO 训练中这两个经常一起下降,只是差回答降得更多。TRL 文档里也提到,DPO 在实践中主要是压低差回答的概率,而不是抬高好回答的概率。如果好回答的概率掉得太厉害,模型的输出可能变得奇怪,这时可以加一点 SFT 损失一起训(TRL 支持把 `loss_type` 设成多个,比如 `["sigmoid", "sft"]`),或者调大 β。

验证集上的 `rewards/accuracies` 是最直接的「有没有学到泛化的偏好」的信号。训练集很高、验证集上不去,就是过拟合了。

## 训练完必须做的回归检查

偏好优化最大的风险是学到了你没打算教的东西。训练完至少做这四项检查:

长度。对比 DPO 前后在同一批工单上的平均回复长度。涨了 30% 以上就要警惕,回头看数据的长度偏差。

事实和规则。重跑 Day 50 的评测集,重点看事实检查(金额、日期是否和工具结果一致)和禁止项(有没有提前承诺退款)。偏好优化可能让回复读起来更顺,但事实更差。

格式。如果起草节点要求输出带引用标记的固定格式,检查格式合法率。

通用能力。拿十几条和客服无关的请求(写一段 SQL、解释一个概念)对比前后,看有没有明显退化。

把结果填进下面的表(我没有替你训练,留空):

| 指标 | DPO 前 | DPO 后 | 判断 |
| --- | --- | --- | --- |
| 评测集总分 | | | |
| 事实检查通过率 | | | |
| 禁止项触发次数 | | | |
| 平均回复字数 | | | |
| 人工盲评胜率(抽 30 对) | | | |

最后一行人工盲评最重要:随机抽 30 张工单,把 DPO 前后的回复打乱顺序给一个没参与训练的人看,问哪个更好。自动指标再好看,人看了觉得没区别,这次训练就没有意义。

最后说一句实话:对大部分应用团队,DPO 不是第一优先级。起草质量的问题,通常先靠提示词、检索质量和规则检查就能解决大半。DPO 适合的情况是:你已经积累了大量客服修改记录或点赞点踩数据,任务稳定,而且你在用自己部署的模型。今天学它,一是为了面试能讲清楚,二是为了在真正有数据的时候知道怎么用。

## 动手练习

今天的产出物是一份偏好数据集、一个 DPO 训练后的 LoRA,和一份回归检查报告。

1. 采样:选 300 张以上非评测集的工单,用起草模型各采样 4 份草稿,存成 `drafts.jsonl`。
2. 造对:跑 `build_pref_pairs.py`,记录每种来源的对数和长度统计。如果「好回答更长的比例」超过 70%,想办法平衡后再训练。
3. 训练:跑 `train_dpo.py`,截图 `rewards/accuracies` 和 `rewards/margins` 的曲线,写两句话解读。
4. 回归检查:填上面的表,人工盲评至少 30 对。
5. 写结论:这次 DPO 值不值得上线?如果值得,上线方案是什么(Day 76 里用 `--lora-modules` 挂到 vLLM);如果不值得,原因在数据还是在方法。
6. 选做:如果你有客服点赞点踩的记录,用 TRL 的 KTOTrainer 训一个对照组,比较和 DPO 的结果。

验收标准:偏好数据的长度统计和来源统计写进报告;训练曲线有截图和解读;回归检查表五行都有数字,人工盲评样本不少于 30 对。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 偏好优化 | 用「A 比 B 好」这种相对信号而不是标准答案来训练模型 |
| RLHF | 基于人类反馈的强化学习:SFT、训练奖励模型、PPO 三步 |
| 奖励模型 | 输入问题和回答,输出质量分数的模型 |
| PPO | RLHF 中常用的强化学习算法,需要额外的价值模型 |
| DPO | 直接用偏好对训练语言模型,不需要显式的奖励模型和强化学习 |
| 参考模型 | 训练开始时的模型快照,用来约束新模型别偏离太远 |
| β | DPO 中控制偏离参考模型程度的系数,越大越保守 |
| 隐式奖励 | β 乘以当前模型与参考模型概率之比的对数,DPO 里用它比较好坏 |
| KTO | 用不成对的「好 / 差」单条标签训练的偏好方法 |
| 长度偏差 | 偏好数据中好回答系统性地更长,导致模型学会写长 |

## 常见误区

**用 DPO 修事实错误。** 事实错误要从检索和工具层面修。DPO 让模型更倾向于某种风格和做法,不会让它凭空知道正确的金额。

**偏好对的差别太多维。** 好回答同时更短、更准、更礼貌,模型不知道学哪一条。每一对的差别尽量集中在一个属性上,并记录这一对是因为什么分出好坏的。

**忽视长度偏差。** 训练前统计好回答比差回答长的比例,训练后对比平均回复长度。这是偏好优化最常见的副作用。

**judge 只评一次。** LLM 评审有位置偏差,不交换顺序评两次,数据里会混进大量噪声对。

**只看训练指标就上线。** `rewards/accuracies` 漂亮不代表回复变好了。重跑评测集、做人工盲评,两者都过关再考虑上线。

## 学习资料

### 文档与文章

- [DPO 论文](https://arxiv.org/abs/2305.18290):读第 1、4 节和第 5 节的推导概要,理解「语言模型就是奖励模型」这句话,1 小时。
- [InstructGPT 论文](https://arxiv.org/abs/2203.02155):RLHF 三步流程的出处,读第 3 节方法部分,40 分钟。
- [KTO 论文](https://arxiv.org/abs/2402.01306)、[ORPO 论文](https://arxiv.org/abs/2403.07691)、[SimPO 论文](https://arxiv.org/abs/2405.14734):三个变体各读摘要和方法图,30 分钟。
- [TRL · DPO Trainer](https://huggingface.co/docs/trl/main/dpo_trainer):数据格式、`loss_type` 全表、日志指标含义,今天代码的依据,必读。
- [Hugging Face 博客 · Illustrating RLHF](https://huggingface.co/blog/rlhf):图解 RLHF 流程的经典文章,20 分钟。
- [RLHF Book](https://rlhfbook.com):Nathan Lambert 写的免费在线书,直接偏好优化那一章讲得最系统,挑着读。
- [Constitutional AI 论文](https://arxiv.org/abs/2212.08073):用 AI 反馈代替部分人工反馈的思路,对「用 judge 造偏好数据」有启发,读摘要和第 1 节。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14z1WYeEo3&autoplay=0&high_quality=1" title="DPO直接偏好优化算法 (动画讲解)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>数源创域 · DPO直接偏好优化算法(动画讲解) · 21 分钟,用动画把 DPO 损失函数的推导和直觉讲清楚,对应正文第一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HYBWBaEE3&autoplay=0&high_quality=1" title="20分钟带你快速弄懂SFT、RLHF、DPO!从定义到适用边界全流程解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI敲代码的阿Q · 20分钟带你快速弄懂SFT、RLHF、DPO!从定义到适用边界全流程解析 · 19 分钟,把三者的关系和适用边界串起来,适合当今天的复习。</figcaption>
</figure>

- 东川路第一可爱猫猫虫 · [【DPO】直接偏好优化 详细原理推导+快速上手实战](https://www.bilibili.com/video/BV1m8FnzpEXm):19 分钟,2026 年 2 月,推导加代码实战。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hvGa5Mba4c8" title="Direct Preference Optimization (DPO) explained: Bradley-Terry model, log probabilities, math" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Umar Jamil · Direct Preference Optimization (DPO) explained: Bradley-Terry model, log probabilities, math · 从 Bradley-Terry 模型讲起推导 DPO,想把数学弄明白的看这个。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/o6l6tJQgUg4" title="Post-Training and RLHF Overview | Post-Training Book Course, Lecture 1" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Nathan Lambert · Post-Training and RLHF Overview · 《RLHF Book》作者的后训练课程第一讲,讲整个后训练流程的全景,和书配合看。</figcaption>
</figure>

- Stanford Online · [CS234 Guest Lecture on DPO](https://www.youtube.com/watch?v=Q7rl8ovBWwQ):DPO 三位作者本人的讲座,这个视频不允许嵌入,点链接去看。
- Stanford Online · [CS336 Spring 2025 Lecture 15: Alignment - SFT/RLHF](https://www.youtube.com/watch?v=Dfu7vC9jo4w):斯坦福课程讲对齐的一讲,同样只能点链接看。

### 书籍

- Nathan Lambert《RLHF Book》(在线免费,rlhfbook.com):偏好数据、奖励模型、直接对齐算法几章,是目前讲后训练最系统的免费资料之一。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024):第 12 章后半部分讲偏好微调和 DPO,有代码,中文版《图解大模型》。

### 开源项目与代码

- [huggingface/trl](https://github.com/huggingface/trl):DPO 实现在 `trl/trainer/dpo_trainer.py`,看损失计算部分。
- [huggingface/smol-course](https://github.com/huggingface/smol-course):Hugging Face 的免费小课,偏好对齐那一章有 DPO 和 ORPO 的练习笔记本。
- [unslothai/notebooks · Zephyr (7B) DPO](https://github.com/unslothai/notebooks/blob/main/nb/Zephyr_%287B%29-DPO.ipynb):Unsloth 的 DPO 示例笔记本,想用 Unsloth 加速的参考。

## 自测

1. RLHF 用 PPO 训练时显存里通常要放哪几个模型?DPO 为什么能少放两个?

<details><summary>答案</summary>

训练中的策略模型、冻结的参考模型、奖励模型、PPO 的价值模型。DPO 利用最优策略和奖励之间的闭式关系,把奖励表示成策略模型与参考模型概率比的对数(隐式奖励),直接用偏好对优化,不需要显式的奖励模型和价值模型。用 LoRA 时连参考模型都可以复用基座本身。

</details>

2. 你手里只有客服对 Agent 草稿点「采纳 / 不采纳」的记录,没有成对数据。该用哪种方法?

<details><summary>答案</summary>

KTO 天然适合这种不成对的二元标签。也可以把同一张工单下的采纳和不采纳草稿硬凑成对用 DPO,但很多工单只有一份草稿,凑不出对,会浪费大部分数据。

</details>

3. 训练 30 步后 `rewards/accuracies` 就到了 1.0,但人工盲评几乎没区别。可能是什么原因?

<details><summary>答案</summary>

偏好对太容易区分,差回答都是明显违规(比如包含禁止语句)的草稿,模型很快学会避开这些显眼特征,但没有学到更细的质量差别。可以补充更难的偏好对(两份都合规、只是质量有差别,由 judge 或人工判定),或者从人工修改记录里取数据。

</details>

4. DPO 训练后平均回复长度涨了 40%,事实检查通过率略降。你怎么排查和处理?

<details><summary>答案</summary>

先查偏好数据的长度偏差,统计好回答比差回答长的比例;大概率是好回答系统性更长。处理办法:平衡数据(补「好回答更短」的对、采样时控制长度相近)、换带长度归一化的损失(TRL 的 sigmoid_norm),或调大 β 让模型更保守;事实下降说明模型在长回复里加了没有依据的内容,要在数据里加入事实错误作为差回答的对,并把事实检查作为上线门槛。

</details>

5. (资深面试题)产品经理希望「让 Agent 的回复更像我们最好的客服」,你会用 SFT、DPO 还是不训练?怎么决定?

<details><summary>答案</summary>

先不训练:把最好客服的回复整理成风格指南和 few-shot 放进提示词,配合规则检查,成本最低、见效最快,用评测集和人工盲评量化差距。如果提示词达到瓶颈,再看数据:有大量优秀客服的完整回复,用 SFT 让模型模仿;有大量「Agent 草稿 vs 客服修改后」的记录,用 DPO 学相对偏好,通常比 SFT 更贴近「更好」而不是「一样」。训练前要确认用的是自部署模型、任务稳定、数据和评测集隔离;训练后做长度、事实、格式、通用能力四项回归和人工盲评,用灰度上线验证线上采纳率是否提升。要讲清楚维护成本:换基座模型就要重训。

</details>

6. 为什么建议用于 DPO 的草稿最好由「将要被训练的那个模型」采样?

<details><summary>答案</summary>

DPO 调整的是这个模型自己的输出分布。如果好坏回答都来自别的模型,它们可能根本不在这个模型容易生成的范围内,训练信号和模型实际会犯的错对不上,效果打折扣。用自己的采样构造偏好对,学的正好是它自己的错误。

</details>

## 明天预告

Day 79 · 蒸馏与路由:让小模型接住八成流量。昨天和今天你训练的都是同一个 4B 模型。明天换个问题:怎么用大模型的输出批量造训练数据(蒸馏),把分诊交给一个更小更快的模型,再用置信度决定什么时候回退到大模型,画出成本和质量的取舍曲线。
