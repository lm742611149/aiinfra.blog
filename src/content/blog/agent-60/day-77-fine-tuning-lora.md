---
title: 'Day 77 · 微调入门:什么时候该微调,LoRA SFT 跑一遍'
description: '微调不是「效果不好就训一下」的万能药。今天先把提示词、RAG、微调各自能解决什么问题分清楚,然后选一个真正适合微调的任务:SupportPilot 的工单分诊。从线上记录造训练集,在 Colab 免费 T4 上用 LoRA 训练一个 4B 分诊模型,挂到 vLLM 上和原版比一比。'
pubDate: 2026-10-12
regime: none
tags: ['fine-tuning', 'lora', 'qlora', 'sft', 'unsloth', 'llama-factory', 'agent-60']
series: 'agent-60'
day: 77
lang: 'zh'
---

## 今天要解决的问题

面试里有一道几乎必问的题:「你们的场景为什么用 RAG 而不是微调?」或者反过来,「既然效果不好,为什么不微调?」能答好这道题的人不多。很多人对微调的理解是「把公司知识灌进模型」,这恰恰是微调最不擅长的事情之一。

学完今天,你应该能做到:

1. 画出「提示词 → RAG → 微调」的决策路径,说清楚微调擅长什么、不擅长什么,以及 SupportPilot 里哪个环节值得微调。
2. 从线上记录造一份干净的 SFT 训练集:格式、去重、类别分布、和评测集严格隔离。
3. 用自己的话解释 LoRA 和 QLoRA:为什么只训练很小一部分参数就够,rank、alpha、学习率这几个参数怎么定。
4. 在 Colab 免费 T4 上用 Unsloth 跑一次 LoRA SFT,也知道 LLaMA-Factory 的零代码做法。
5. 把训练好的 LoRA 挂到 vLLM 上,用 Day 50 的评测集对比原版和微调版,并检查有没有把别的能力训坏。

预计用时 5–7 小时,其中训练本身在 T4 上通常一小时以内,造数据和评测花的时间更多。前置:Day 31(造测试集)、Day 47(分诊节点)、Day 50(评测集)、Day 76(vLLM)。

## 提示词、RAG、微调,各管什么

先建立一个判断框架。遇到「模型表现不好」时,按这个顺序排查,前一层能解决就不要动下一层:

提示词解决「模型不知道你要什么」。任务说明不清、没有示例、输出格式没讲明白,这些改提示词就行,成本最低,改完立刻生效。

RAG 解决「模型不知道某些事实」。CloudLedger 的退款政策、错误码含义、最新价格,这些知识会变,而且需要能追溯出处,放进检索库最合适。改一篇帮助中心文章,下一次回答就用新内容,不用重新训练。

微调解决「模型知道该做什么,但做得不稳定、不够好、或者太贵」。具体是这几类:输出格式和风格要求非常严格,提示词约束了还是偶尔出错;某个固定任务调用量极大,想用小模型替代大模型来省钱省延迟;任务需要的判断标准很难用语言描述清楚,但能给出大量正确示例,比如「什么样的工单算紧急」。

微调最不擅长的是灌知识。用几百条问答对训练一个模型「记住」退款政策,它可能学会了回答的语气,事实却记得半对半错,而且政策一改你就得重新训练。这类需求交给 RAG。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="提示词、RAG、微调的决策路径">
<rect x="20" y="20" width="180" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="110" y="47" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">模型表现不好</text>
<line x1="110" y1="64" x2="110" y2="90" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="20" y="90" width="180" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="112" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">不知道你要什么?</text>
<text x="110" y="127" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">改提示词、加示例</text>
<line x1="110" y1="134" x2="110" y2="160" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="20" y="160" width="180" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="182" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">不知道某些事实?</text>
<text x="110" y="197" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">RAG、工具</text>
<line x1="110" y1="204" x2="110" y2="225" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="20" y="225" width="180" height="36" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="248" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">知道但不稳/太贵 → 微调</text>
<rect x="250" y="90" width="370" height="171" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="266" y="115" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">SupportPilot 里的例子</text>
<text x="266" y="142" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">分类边界讲不清 → 先加 few-shot</text>
<text x="266" y="167" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">退款政策、错误码 → 帮助中心 + 检索</text>
<text x="266" y="192" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">账单金额 → 工具查库,永远别让模型记</text>
<text x="266" y="217" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">分诊每单都跑、标签稳定、量大</text>
<text x="266" y="240" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">→ 用小模型微调替代大模型</text>
</svg>
<figcaption>排查的顺序决定了成本。微调放在最后,不是因为它不重要,而是因为它的维护成本最高:数据要持续更新,每次换基座模型都要重训。</figcaption>
</figure>

按这个框架看 SupportPilot,最适合微调的是分诊节点:每张工单都要跑一次,输出是固定格式的 JSON,标签空间是稳定的 8 个类别,判断标准积累了大量历史样本。把它从大模型换成一个微调过的 4B 模型,单次成本和延迟都能降一大截,而且可以自部署。今天就训练这个。

## 造训练集:数据比参数重要

微调效果的上限几乎由数据决定。LIMA 那篇论文用 1,000 条精挑细选的样本就训出了不错的对话模型,反过来,一万条带噪声的数据可能把模型教坏。分诊任务的训练集,我建议按下面的原则造。

数据来源有三种,可靠性从高到低:人工标注或人工确认过的(客服主管改过分类的工单);线上记录中被下游验证为正确的(比如分类后工单没有被转回、没有被人工改类别);用强模型标注的(Day 79 会细讲,本质上是蒸馏)。刚开始数据少,可以三种混用,但每条都要记下来源,出问题时能追溯。

和评测集严格隔离。这一条怎么强调都不过分。Day 50 的 `tickets_v1.jsonl` 是你衡量效果的尺子,任何一条评测用例(包括它的换说法版本)出现在训练集里,你测出来的提升就是假的。做法是按工单文本去重,并且用评测集的场景名做黑名单。

看类别分布。线上数据天然不平衡,比如 billing 和 technical 占一半以上,api 只有 2%。不处理的话模型会倾向于猜大类。可以对小类别补数据(人工写或强模型扩写),或者对大类别下采样,目标是每个类别至少有几十条。

格式用对话格式。每条样本是一组 messages:system 是分诊说明,user 是工单,assistant 是标准答案的 JSON。训练时只对 assistant 部分计算损失,模型不需要学会「复述工单」。

下面这个脚本把原始记录整理成训练集。输入文件 `raw_triage.jsonl` 每行一条记录,字段是 `subject`、`body`、`triage`(分诊 JSON)和 `source`(human / verified / teacher)。你可以从 Day 52 的 Langfuse 里导出分诊节点的输入输出、筛选验证过的,或者用 Day 31 的合成方法先造几百条:

```python
# agentops-lab/w12/build_sft_data.py
"""整理分诊 SFT 训练集。不需要 GPU,本机就能跑。
用法:python build_sft_data.py raw_triage.jsonl ../supportpilot/evals/datasets/tickets_v1.jsonl out/
"""
import hashlib
import json
import random
import re
import sys
from collections import Counter
from pathlib import Path

SYSTEM = (
    "你是 CloudLedger 客服分诊员。只输出一个 JSON 对象,字段:"
    "category(billing/refund/invoice/account/technical/plan_change/api/other 之一)、"
    "needs_account_data(布尔)、needs_human(布尔)、urgency(low/normal/high)。不要输出其他文字。"
)
CATEGORIES = {"billing", "refund", "invoice", "account", "technical", "plan_change", "api", "other"}
KEYS = ("category", "needs_account_data", "needs_human", "urgency")


def norm(text: str) -> str:
    """去掉空白和标点后的文本,用来判断重复。"""
    return re.sub(r"[\s\W_]+", "", text.lower())


def fingerprint(subject: str, body: str) -> str:
    return hashlib.md5(norm(subject + body).encode()).hexdigest()


def load_eval_blacklist(eval_path: Path) -> set[str]:
    bad = set()
    for line in eval_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            c = json.loads(line)
            bad.add(fingerprint(c["subject"], c["body"]))
    return bad


def valid(rec: dict) -> bool:
    t = rec.get("triage") or {}
    return (t.get("category") in CATEGORIES and isinstance(t.get("needs_account_data"), bool)
            and isinstance(t.get("needs_human"), bool) and t.get("urgency") in {"low", "normal", "high"})


def to_messages(rec: dict) -> dict:
    answer = {k: rec["triage"][k] for k in KEYS}
    return {"messages": [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": f"主题:{rec['subject']}\n正文:{rec['body']}"},
        {"role": "assistant", "content": json.dumps(answer, ensure_ascii=False)},
    ], "source": rec.get("source", "unknown")}


def main(raw_path: str, eval_path: str, out_dir: str, val_ratio: float = 0.1, cap_per_class: int = 400):
    random.seed(42)
    blacklist = load_eval_blacklist(Path(eval_path))
    seen, kept, dropped = set(), [], Counter()
    for line in Path(raw_path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        fp = fingerprint(rec["subject"], rec["body"])
        if not valid(rec):
            dropped["invalid"] += 1
        elif fp in blacklist:
            dropped["in_eval_set"] += 1
        elif fp in seen:
            dropped["duplicate"] += 1
        else:
            seen.add(fp)
            kept.append(rec)

    by_cat: dict[str, list] = {}
    for rec in kept:
        by_cat.setdefault(rec["triage"]["category"], []).append(rec)
    balanced = []
    for cat, recs in by_cat.items():
        random.shuffle(recs)
        balanced.extend(recs[:cap_per_class])   # 大类下采样,小类有多少用多少
    random.shuffle(balanced)

    n_val = max(1, int(len(balanced) * val_ratio))
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for name, part in (("val", balanced[:n_val]), ("train", balanced[n_val:])):
        with open(out / f"triage_{name}.jsonl", "w", encoding="utf-8") as f:
            for rec in part:
                f.write(json.dumps(to_messages(rec), ensure_ascii=False) + "\n")

    print("dropped:", dict(dropped))
    print("kept per category:", Counter(r["triage"]["category"] for r in balanced))
    print("sources:", Counter(r.get("source", "unknown") for r in balanced))
    print(f"train={len(balanced) - n_val} val={n_val}")
    small = [c for c in CATEGORIES if len(by_cat.get(c, [])) < 30]
    if small:
        print("WARNING 这些类别少于 30 条,考虑补数据:", small)


if __name__ == "__main__":
    main(*sys.argv[1:4])
```

跑完先读它打印出的三行统计:丢了多少、各类别多少、来源构成。如果 `in_eval_set` 不是 0,说明你的原始数据里混进了评测用例,幸好被拦下了;如果某个来源占比特别高(比如 teacher 标注占 90%),要意识到你训出来的模型上限大概就是那个 teacher。

数据量多少够?分诊这种分类任务,经验上每个类别几十到一两百条干净样本就能看到明显效果,总量 500 到 2,000 条是一个合理的起点。更多数据有帮助,但边际收益递减,先跑通流程、看评测结果,再决定要不要扩充。

## LoRA:为什么只训一小部分参数就够

全量微调要更新模型的全部 40 亿参数,还要为每个参数存优化器状态,显存需求是推理的好几倍,一张 T4 根本放不下。LoRA 的想法是:微调时权重的变化量本身是「低秩」的,可以用两个很瘦的矩阵相乘来近似。

具体来说,原来某一层的权重矩阵是 W,形状 d × k。LoRA 不改 W,而是旁边加两个小矩阵:A 是 r × k,B 是 d × r,r(rank)通常取 8 到 64。前向计算时输出是 Wx + BAx,训练只更新 A 和 B。B 初始化为零,所以训练开始时模型行为和原模型完全一样。

算一笔账感受一下有多省。Qwen3-4B 的隐藏维度是 2560,注意力的 q_proj 把 2560 维映射到 32 × 128 = 4096 维。r = 16 时,这一层 LoRA 新增的参数是:

```text
A: 16 × 2560 = 40,960
B: 4096 × 16 = 65,536
合计 106,496,而原矩阵有 2560 × 4096 = 10,485,760 个参数,约 1%
```

把 LoRA 加到每层的注意力和 MLP 投影上,总的可训练参数一般在原模型的 1% 上下。训练完只需保存这几十 MB 的 A、B 矩阵,部署时可以合并进原权重,也可以像今天这样在 vLLM 里动态挂载,同一个基座模型挂多个不同用途的 LoRA。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="LoRA 结构:冻结的原权重旁边加两个低秩矩阵 A 和 B">
<text x="40" y="115" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">x</text>
<line x1="55" y1="110" x2="110" y2="70" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="55" y1="110" x2="110" y2="160" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="110" y="40" width="200" height="60" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="210" y="67" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">W(d × k)冻结</text>
<text x="210" y="85" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">原模型权重,不更新</text>
<rect x="110" y="135" width="80" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="150" y="158" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">A</text>
<text x="150" y="175" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">r × k</text>
<line x1="190" y1="160" x2="230" y2="160" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="230" y="135" width="80" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="270" y="158" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">B</text>
<text x="270" y="175" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">d × r,初始 0</text>
<line x1="310" y1="70" x2="380" y2="110" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="310" y1="160" x2="380" y2="115" stroke="var(--rule)" stroke-width="1.5"/>
<circle cx="392" cy="112" r="12" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="392" y="117" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">+</text>
<line x1="404" y1="112" x2="450" y2="112" stroke="var(--rule)" stroke-width="1.5"/>
<text x="460" y="108" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Wx + (α/r)·BAx</text>
<text x="460" y="130" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只训练 A 和 B</text>
<text x="460" y="150" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">约占原参数 1%</text>
</svg>
<figcaption>LoRA 只在旁路上学一个低秩的增量。B 初始为零,保证训练第一步时模型和原模型完全一致。蓝色是训练的部分。</figcaption>
</figure>

QLoRA 在 LoRA 的基础上再省一步:把冻结的原权重量化成 4 位存储,LoRA 的 A、B 仍然用 16 位训练。4B 模型的权重从 8 GB 降到 3 GB 左右,T4 就能放下。代价是训练稍慢、精度略有损失。Unsloth 官方的 Qwen3 4B 笔记本在 T4 上默认就是这样配置的。

几个超参数怎么定。Thinking Machines 在 2025 年 9 月发的《LoRA Without Regret》做了大量对照实验,结论很实用:LoRA 的最佳学习率大约是全量微调最佳学习率的 10 倍;LoRA 应该加到所有层,尤其是 MLP 层,只加在注意力层效果明显更差;rank 决定 LoRA 的「容量」,小数据集上 LoRA 能追平全量微调,数据量超过容量后才开始落后;LoRA 对大 batch size 比全量微调更敏感。对分诊这种小任务,r = 16 到 32、加到全部投影层、学习率 2e-4 量级,是一个不错的起点。

## 用 Unsloth 在 Colab 上训练

Unsloth 是目前在单卡上做 LoRA 最省显存的工具之一,官方维护了大量 Colab 笔记本。下面的代码改编自它的 Qwen3 (4B) Instruct 笔记本,把数据换成我们的分诊集。在 Colab 新建笔记本,选 T4 GPU,把 `triage_train.jsonl` 和 `triage_val.jsonl` 上传到 `/content/`:

```python
# Colab 单元 1:安装(写法跟 Unsloth 官方笔记本,2026-10 的 unsloth 版本号是 2026.10.x)
!pip install -q unsloth
```

```python
# Colab 单元 2:加载 4 位基座 + 挂 LoRA
from unsloth import FastLanguageModel

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="unsloth/Qwen3-4B-Instruct-2507",
    max_seq_length=1024,          # 分诊输入很短,1024 足够,省显存
    load_in_4bit=True,            # QLoRA:T4 上必须开
)
model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    lora_alpha=16,
    lora_dropout=0,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    use_gradient_checkpointing="unsloth",
    random_state=3407,
)
```

```python
# Colab 单元 3:数据。对话格式 → 套 chat template 变成一段文本
from datasets import load_dataset
from unsloth.chat_templates import get_chat_template

tokenizer = get_chat_template(tokenizer, chat_template="qwen3-instruct")
ds = load_dataset("json", data_files={"train": "/content/triage_train.jsonl",
                                      "val": "/content/triage_val.jsonl"})

def to_text(batch):
    return {"text": [tokenizer.apply_chat_template(m, tokenize=False, add_generation_prompt=False)
                     for m in batch["messages"]]}

ds = ds.map(to_text, batched=True, remove_columns=ds["train"].column_names)
print(ds["train"][0]["text"][:600])
```

先把打印出来的那段文本看一眼,确认 system、user、assistant 三段都在,模板标记正确。模板错了是微调最常见的翻车原因:训练时用一种模板,推理时 vLLM 用模型自带的另一种,模型就会表现得莫名其妙。

```python
# Colab 单元 4:训练,只对 assistant 部分算损失
from trl import SFTConfig, SFTTrainer
from unsloth.chat_templates import train_on_responses_only

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=ds["train"],
    eval_dataset=ds["val"],
    args=SFTConfig(
        dataset_text_field="text",
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,
        num_train_epochs=2,
        learning_rate=2e-4,
        warmup_steps=10,
        lr_scheduler_type="linear",
        logging_steps=10,
        eval_strategy="steps",
        eval_steps=50,
        optim="adamw_8bit",
        seed=3407,
        output_dir="outputs",
        report_to="none",
    ),
)
trainer = train_on_responses_only(trainer)
stats = trainer.train()
print(stats.metrics)
```

训练过程中看两条曲线:训练损失应该稳步下降;验证损失先降,如果某个时候开始上升而训练损失还在降,就是过拟合了,减少 epoch 或者加数据。分诊输出只有几十个 token,损失会降得很低,这是正常的,不要只看损失,最后以评测集上的准确率为准。

```python
# Colab 单元 5:保存 LoRA 适配器(几十 MB),下载回来或推到 Hugging Face 私有仓库
model.save_pretrained("triage_lora")
tokenizer.save_pretrained("triage_lora")
!zip -r triage_lora.zip triage_lora
```

如果你更习惯点界面,LLaMA-Factory 是国内用得很多的零代码微调工具,它官方仓库里就有 Qwen3-4B-Instruct-2507 的 LoRA 示例配置。用法是把数据注册到 `data/dataset_info.json`,然后写一个 YAML:

```yaml
# LLaMA-Factory/examples/train_lora/triage_lora_sft.yaml(改自官方 qwen3_lora_sft.yaml)
model_name_or_path: Qwen/Qwen3-4B-Instruct-2507
stage: sft
do_train: true
finetuning_type: lora
lora_rank: 16
lora_target: all
dataset: cloudledger_triage        # 在 dataset_info.json 里注册的名字
template: qwen3_nothink
cutoff_len: 1024
output_dir: saves/qwen3-4b/lora/triage
per_device_train_batch_size: 4
gradient_accumulation_steps: 4
learning_rate: 2.0e-4
num_train_epochs: 2.0
lr_scheduler_type: cosine
warmup_ratio: 0.1
bf16: true                           # T4 上改成 fp16: true
logging_steps: 10
report_to: none
```

```json
{
  "cloudledger_triage": {
    "file_name": "triage_train.jsonl",
    "formatting": "sharegpt",
    "columns": {"messages": "messages"},
    "tags": {"role_tag": "role", "content_tag": "content",
             "user_tag": "user", "assistant_tag": "assistant", "system_tag": "system"}
  }
}
```

然后 `llamafactory-cli train examples/train_lora/triage_lora_sft.yaml`,也可以 `llamafactory-cli webui` 在网页里点。两个工具训出来的都是标准的 PEFT 格式 LoRA,后面的部署方式一样。

## 挂到 vLLM 上,和原版对比

vLLM 可以在同一个基座模型上挂 LoRA,通过不同的模型名访问。把下载回来的 `triage_lora` 放到 GPU 实例上:

```bash
vllm serve Qwen/Qwen3-4B-Instruct-2507 \
  --enable-lora --lora-modules triage=/root/triage_lora --max-lora-rank 16 \
  --max-model-len 4096 --api-key "$VLLM_API_KEY"
```

请求时 `model="Qwen/Qwen3-4B-Instruct-2507"` 走原版,`model="triage"` 走微调版,同一张卡、同一份基座权重。然后用 Day 75 的 `bakeoff.py` 跑对比:在 `models.yaml` 里加两个候选,base_url 都指向你的 vLLM,model 分别填这两个名字。为了看得更细,再加一个按类别统计的脚本:

```python
# agentops-lab/w12/per_class.py
"""按类别统计分诊准确率,找出微调前后变化最大的类别。
用法:python per_class.py results_base.jsonl results_lora.jsonl
每行:{"id": ..., "gold": ["refund"], "pred": "billing"}
"""
import json
import sys
from collections import defaultdict


def load(path):
    return [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]


def per_class(rows):
    hit, tot = defaultdict(int), defaultdict(int)
    for r in rows:
        g = r["gold"][0]
        tot[g] += 1
        hit[g] += r["pred"] in r["gold"]
    return {c: (hit[c], tot[c]) for c in tot}


base, lora = per_class(load(sys.argv[1])), per_class(load(sys.argv[2]))
print(f"{'category':<14}{'base':>12}{'lora':>12}{'变化':>8}")
for c in sorted(base, key=lambda c: -base[c][1]):
    b, l = base[c], lora.get(c, (0, base[c][1]))
    delta = l[0] / l[1] - b[0] / b[1]
    print(f"{c:<14}{b[0]:>5}/{b[1]:<6}{l[0]:>5}/{l[1]:<6}{delta:>+8.2f}")
```

要让 `bakeoff.py` 输出这种逐条结果,在 `run_triage` 的返回值里加上 `id`、`gold` 和 `pred` 三个字段并写进文件,改动很小,留给你练手。结果填进下表(我没有替你训练,数字留空):

| 模型 | 分类准确率(dev) | 分类准确率(test) | JSON 合法率 | P50 延迟 | 备注 |
| --- | --- | --- | --- | --- | --- |
| deepseek-flash(Day 75 基线) | | | | | |
| Qwen3-4B-Instruct-2507 原版 | | | | | |
| Qwen3-4B + triage LoRA | | | | | |

最后还要做一个容易被忘掉的检查:有没有把别的能力训坏。分诊 LoRA 只在分诊任务上用,问题不大;但如果你打算让这个模型同时干别的(比如起草简单回复),就要拿几条非分诊的请求对比微调前后的回答。有一篇论文的标题很直白,叫《LoRA Learns Less and Forgets Less》:LoRA 学得比全量微调少,但遗忘也少,这正是它适合「给基座加一个专门技能」的原因。

## 动手练习

今天的产出物是一个训练好的分诊 LoRA 和一份对比报告。

1. 准备原始数据 `raw_triage.jsonl`,至少 500 条,来源可以混合,每条标 `source`。8 个类别每个至少 30 条。
2. 跑 `build_sft_data.py`,确认 `in_eval_set` 被正确拦截(可以故意混进两条评测用例试试)。
3. 在 Colab T4 上用 Unsloth 训练(或者用 LLaMA-Factory),记录训练时长、峰值显存、最终训练损失和验证损失。
4. 把 LoRA 挂到 vLLM,对比原版和微调版在 Day 50 dev、test 上的分类准确率和 JSON 合法率,填表;用 `per_class.py` 找出提升最大和退步最大的类别。
5. 写一页结论:微调版能不能替代 deepseek-flash 做分诊?如果能,按 Day 76 的压测数据估算每月省多少钱;如果不能,差在哪几个类别,下一步是补数据还是换更大的基座。

验收标准:训练集和评测集零重叠(脚本统计为证);对比表三行都有数字,且 test 集的结果和 dev 集分开报告;结论里引用了按类别的统计。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| SFT(监督微调) | 用「输入 → 标准输出」的样本继续训练模型,让它学会某种输出 |
| LoRA | 冻结原权重,只训练旁路上两个低秩小矩阵的参数高效微调方法 |
| QLoRA | 原权重量化成 4 位存储,再在上面训练 LoRA,进一步省显存 |
| rank(r) | LoRA 小矩阵的中间维度,决定适配器的容量和参数量 |
| lora_alpha | LoRA 增量的缩放系数,实际缩放是 alpha / r |
| chat template | 把多轮对话拼成一段文本的模板,训练和推理必须一致 |
| train on responses only | 只对 assistant 回复部分计算损失,不让模型学习复述输入 |
| 过拟合 | 训练损失继续下降而验证损失上升,模型在背训练集 |
| 灾难性遗忘 | 微调后模型丢失原有的通用能力 |

## 常见误区

**用微调灌知识。** 会变的事实交给 RAG,要精确的数字交给工具查库。微调学的是「怎么做」,不是「是什么」。

**训练集混进评测用例。** 测出来的提升是假的,而且你自己很难发现。用指纹去重加场景黑名单,在脚本里强制拦截。

**训练和推理用了不同的 chat template。** 训练时一种格式,vLLM 推理时用模型默认的另一种,效果会莫名其妙地差。训练前打印一条样本确认,推理时用同一个基座的同一个模板。

**只看训练损失。** 分诊输出很短,损失很容易降到很低。决定成败的是评测集准确率,以及按类别拆开后有没有某一类被训坏。

**数据越多越好。** 带噪声的数据会把模型教坏。先用几百条干净数据跑通、评测,看清楚错在哪,再有针对性地补。

## 学习资料

### 文档与文章

- [LoRA 论文](https://arxiv.org/abs/2106.09685):原始论文,读第 1、4 节理解低秩假设,40 分钟。
- [QLoRA 论文](https://arxiv.org/abs/2305.14314):4 位量化加 LoRA 的做法,读摘要和第 2 节。
- [Thinking Machines · LoRA Without Regret](https://thinkingmachines.ai/blog/lora/):2025 年 9 月,大量对照实验得出的超参数建议(学习率约为全量微调 10 倍、加到所有层),今天最值得读的一篇,1 小时。
- [LoRA Learns Less and Forgets Less](https://arxiv.org/abs/2405.09673):LoRA 和全量微调在学习与遗忘上的对比,读摘要和结论。
- [LIMA 论文](https://arxiv.org/abs/2305.11206):1,000 条高质量样本的对齐实验,读摘要,理解「数据质量比数量重要」。
- [Unsloth 微调指南](https://unsloth.ai/docs/get-started/fine-tuning-llms-guide)和 [Unsloth 笔记本列表](https://unsloth.ai/docs/get-started/unsloth-notebooks):超参数建议和各模型的 Colab 入口。
- [TRL · SFT Trainer](https://huggingface.co/docs/trl/main/sft_trainer):SFTTrainer 的数据格式和参数,Unsloth 底层用的就是它。
- [PEFT · LoRA 概念指南](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora):LoRA 各参数的含义。
- [LLaMA-Factory 中文文档](https://llamafactory.readthedocs.io/zh-cn/latest/)和 [Qwen 文档 · LLaMA-Factory](https://qwen.readthedocs.io/zh-cn/latest/training/llama_factory.html):零代码路线的数据格式和配置。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1waZ2YDEcp&autoplay=0&high_quality=1" title="【LoRA微调】从原理到调参,7 个问题彻底理解LoRA,不懂线性代数也没问题" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>费曼学徒冬瓜 · 【LoRA微调】从原理到调参,7 个问题彻底理解LoRA · 18 分钟,不用线性代数基础也能看懂 rank、alpha 的作用,对应正文 LoRA 一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Q8rYYdErf&autoplay=0&high_quality=1" title="大模型微调!手把手带你用LLaMA-Factory工具微调Qwen大模型!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大语言模型教程 · 大模型微调!手把手带你用LLaMA-Factory工具微调Qwen大模型 · 两个分 P 共约 35 分钟,零代码路线完整演示一遍,想走 LLaMA-Factory 的看这个。</figcaption>
</figure>

- code秘密花园 · [微调模型的各种参数到底怎么设置?微调的显存消耗怎么估算?](https://www.bilibili.com/video/BV1BaM8zHEgh):31 分钟,超参数和显存估算,训练前看。
- 九天Hector · [如何构造微调数据集?对话数据、指令数据、Function call数据、思考链数据构造方法详解](https://www.bilibili.com/video/BV1XXVHzYEK2):25 分钟,对应正文造数据一节。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/PXWYUTMt-AU" title="LoRA: Low-Rank Adaptation of Large Language Models - Explained visually + PyTorch code from scratch" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Umar Jamil · LoRA: Low-Rank Adaptation of Large Language Models - Explained visually + PyTorch code from scratch · 可视化讲原理再手写实现,想彻底搞懂的看完整版。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/-W2JdSl1v48" title="Is Fine-Tuning Still Needed? LLMs, RAG, & LoRA" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · Is Fine-Tuning Still Needed? LLMs, RAG, & LoRA · 十几分钟,正好对应今天开头「什么时候该微调」的判断。</figcaption>
</figure>

- Edward Hu · [What is Low-Rank Adaptation (LoRA) | explained by the inventor](https://www.youtube.com/watch?v=DhRoTONcyZE):LoRA 作者本人讲的短视频。

### 书籍

- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024):第 12 章 Fine-Tuning Generation Models,讲 SFT、LoRA、QLoRA 并带代码,1.5 小时。中文版书名《图解大模型》。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 7 章 Finetuning,讲什么时候该微调、PEFT 方法和内存估算,和今天的决策框架呼应。

### 开源项目与代码

- [unslothai/notebooks · Qwen3 (4B) Instruct](https://github.com/unslothai/notebooks/blob/main/nb/Qwen3_%284B%29-Instruct.ipynb):今天代码的出处,对照着看完整笔记本里的保存和导出部分。
- [hiyouga/LLaMA-Factory](https://github.com/hiyouga/LLaMA-Factory):`examples/train_lora/` 目录下有各模型的示例配置。
- [huggingface/trl](https://github.com/huggingface/trl):SFTTrainer 的源码在 `trl/trainer/sft_trainer.py`,想知道损失是怎么只算 assistant 部分的,看这里。

## 自测

1. 客服主管说「模型老是答错退款政策,你给它微调一下」。你怎么回应?

<details><summary>答案</summary>

退款政策是会变的事实,而且回答需要能追溯出处,应该放在帮助中心由 RAG 检索,而不是靠微调记住。先查是检索没找到正确文章、还是找到了但模型没用好:前者改检索,后者改提示词或起草节点。微调适合「知道该怎么做但做得不稳定或太贵」的任务,比如固定格式的分诊。

</details>

2. Qwen3-4B 的 o_proj 把 4096 维映射回 2560 维,r = 32 时这一层 LoRA 有多少参数?

<details><summary>答案</summary>

A 是 32 × 4096 = 131,072,B 是 2560 × 32 = 81,920,合计 212,992。原矩阵 4096 × 2560 = 10,485,760,LoRA 约占 2%。

</details>

3. 训练到第二个 epoch,训练损失还在降,验证损失从 0.05 涨到 0.09,你怎么处理?

<details><summary>答案</summary>

这是过拟合的信号。可以减少 epoch(用验证损失最低时的检查点)、降低学习率、减小 rank,或者增加数据量和多样性。最后仍以评测集准确率为准,验证损失只是参考。

</details>

4. 为什么训练前一定要打印一条套过 chat template 的样本看一眼?

<details><summary>答案</summary>

确认模板标记正确、三个角色都在、assistant 部分是期望的输出。训练和推理模板不一致是微调最常见的翻车原因,模型在训练格式下表现很好,换到推理服务的默认模板就乱了。

</details>

5. (资深面试题)你们要把分诊从 API 大模型换成自己微调的小模型。从数据、评测、上线三个阶段,说说你会怎么控制风险。

<details><summary>答案</summary>

数据阶段:训练数据来源可追溯,优先人工确认和下游验证过的样本,强模型标注的要抽检;和评测集用指纹加场景黑名单严格隔离;检查类别分布,小类补数据。评测阶段:在独立的 test 集上和现有大模型做配对比较,按类别拆开看,特别关注 refund、billing 这类高风险类别;检查 JSON 合法率和延迟;准备一组非分诊请求检查遗忘。上线阶段:影子模式先跑,小模型和大模型同时分类但只用大模型结果,对比一致率;再灰度一部分流量,低置信度回退大模型;监控转人工率、类别改判率;保留一键切回 API 的开关;建立数据回流,把线上被人工改判的工单定期加进训练集重训。

</details>

6. LoRA 的学习率为什么通常比全量微调高一个数量级?

<details><summary>答案</summary>

LoRA 只更新很少的参数,而且 B 从零开始,增量要经过 alpha/r 缩放,同样的学习率下对模型输出的影响比全量微调小得多。Thinking Machines 的实验测出 LoRA 的最佳学习率大约是全量微调的 10 倍,并且在 1/r 缩放下这个最佳值和 rank 关系不大。

</details>

## 明天预告

Day 78 · 偏好优化:DPO 让模型学会「更好的回答」。SFT 教会模型「标准答案长什么样」,但客服回复没有唯一的标准答案,只有「这个比那个好」。明天讲 RLHF、DPO、ORPO、KTO 的区别,用 SupportPilot 起草回复的成对数据跑一次 DPO,并检查它有没有学到你不想要的东西。
