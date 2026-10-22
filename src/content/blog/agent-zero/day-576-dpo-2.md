---
title: 'Day 576 · DPO(二):用 TRL 跑一次,读指标,回归检查'
description: '把 Day 575 造的 15 对偏好数据拿去训练。Colab 上用 TRL 的 DPOTrainer 训 Qwen3-4B 的脚本写好了但没 GPU 没实跑;Intel Mac 装不上新版 TRL,于是在本机 CPU 上手写一遍 DPOTrainer 做的事,真训了一个 0.5B 模型 7 分钟,读懂 rewards/margins 这些指标,踩到「按对留出」的泄漏,最后回归检查发现 DPO 版的回复平均长了三成、违规还多了两次。'
pubDate: 2026-10-22
regime: none
tags: ['dpo', 'trl', 'peft', 'evaluation', 'fine-tuning', 'agent-zero']
series: 'agent-zero'
day: 576
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 575](/blog/agent-zero/day-575-dpo-1/) 我们用两个小脚本把 DPO 的损失手算了一遍:隐式奖励是「训练中的模型比参考模型多给了多少 logp」再乘 β,一对数据的损失是 `-log sigmoid(margin)`,第 0 步一定是 0.693。然后用 DeepSeek 给 6 张工单各采样 4 份回复草稿,用三条规则和交换位置的 judge 造出 15 对偏好数据,存在 `part10/data/pairs.jsonl`,还抓到了长度偏差和 judge 判错的问题。

今天把这 15 对喂给训练。15 对远远不够训出一个更好的模型,今天的目标不是得到一个能上线的模型,而是把训练流程完整走一遍:训练怎么跑、日志里每个指标说明什么、训完要查什么。等你攒够几百上千对真实的修改记录,流程一模一样。

## 今天要解决的问题

学完今天你应该能做到:

1. 写出用 TRL `DPOTrainer` 加 LoRA 训练的完整脚本,知道数据要删掉哪些列、T4 上精度怎么设、用 LoRA 时参考模型从哪来。
2. 读懂 DPO 训练日志里的 `loss`、`rewards/chosen`、`rewards/rejected`、`rewards/margins`、`rewards/accuracies`、`logps/chosen`、`logps/rejected`,能从训练集和验证集的对比看出过拟合,并且知道验证集要按工单留出、不能按对留出。
3. 训完做回归检查:同一批工单对比 DPO 前后的回复长度、规则违规、通用问题的回答,能写出「这次训练值不值得上线」的结论。

预计用时 3 小时(本机训练和生成要等十来分钟)。前置:[Day 572](/blog/agent-zero/day-572-finetune-2/)(LoRA、Colab)、[Day 574](/blog/agent-zero/day-574-finetune-3/)(运行时挂载、对比和配对)、[Day 575](/blog/agent-zero/day-575-dpo-1/)(`pairs.jsonl`、`pref_rules.py`、`dpo_loss_toy.py`)。

哪些实跑了、哪些没有,先说清楚。**TRL 的 Colab 脚本没实跑**,我没有 GPU,脚本照 TRL 1.16.0(2026 年 10 月 15 日发布)的文档写,做了语法检查。本机部分全部实跑:在 2019 款 Intel MacBook Pro 的 CPU 上,手写的 DPO 训练循环训了 Qwen2.5-0.5B-Instruct 两轮共 6 步,用时 407 秒;回归检查生成了 20 段回复和 2 段通用问题的回答。今天不调付费 API,花费 0 元,只花了下载模型的约 1 GB 流量。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`dpo_cpu.py` 的 `seq_logp`、`prepare`、`dpo_step`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先说本机为什么跑不了 TRL

正常的路线是 `uv add trl peft`,然后照 TRL 文档写。我在本机试了,第一步就报错(在一个新建的 Python 3.12 项目里):

```text
error: Distribution `torch==2.14.1 @ registry+https://pypi.org/simple` can't be installed because it doesn't have a source distribution or wheel for the current platform

hint: You're on macOS (`macosx_14_0_x86_64`), but `torch` (v2.14.1) only has wheels for the following platforms: `manylinux_2_28_aarch64`, `manylinux_2_28_x86_64`, `macosx_14_0_arm64`, `win_amd64`; ...
```

PyTorch 早就不给 Intel 芯片的 Mac 出安装包了。我查了 PyPI,带 `macosx` 加 `x86_64` 安装包的最后一个版本是 2.2.2。把 torch 钉在 2.2.2 再装,又是一串导入错误:transformers 5.x 在这个 torch 上导入时报 `NameError: name 'nn' is not defined`;退回 transformers 4.57.6 之后,TRL 1.16.0 导入时报 `cannot import name 'DTensor' from 'torch.distributed.tensor'`,它用到了 torch 2.2 还没有的东西。

如果你用的是 M 系列芯片的 Mac,`uv add trl peft` 能装上最新版,可以直接用 TRL 在 CPU 或 MPS 上跑小模型(我没有这种机器,没试)。Intel Mac 和 Windows 没独显的读者,真正的训练去 Colab。

本机怎么办?DPOTrainer 做的事,核心就是 Day 575 算过的那几行。我们用 torch 2.2.2、transformers 4.57.6、peft 0.21.2 这三个能装上的库,自己写一遍训练循环,打印和 TRL 同名的指标。这样做反而有好处:每个指标是怎么算出来的,你看得清清楚楚。

## 第一步:Colab 上用 TRL 训练(没实跑)

先把「正规路线」写出来。打开一个新的 Colab 笔记本,运行时类型选 T4 GPU,左边栏把 `agent-zero-lab/part10/data/pairs.jsonl` 拖进去,它会出现在 `/content/pairs.jsonl`。Colab 的 T4 怎么申请、会话多久断,[Day 572](/blog/agent-zero/day-572-finetune-2/) 讲过。

```python
# Colab 单元 1:安装(没实跑)
!pip install -U trl peft bitsandbytes datasets
```

<div class="line-notes">

- `!pip install -U trl peft bitsandbytes datasets` `!` 开头是在 Colab 里执行终端命令(Day 572 讲过)。`-U` 升级到最新版。Colab 已经预装了新版 PyTorch,不用再装。这里不用 Unsloth,所以不必像 Day 572 那样钉死 TRL 的旧版本。

</div>

```python
# Colab 单元 2:用 TRL 跑 DPO(没实跑)。基座 Qwen3-4B-Instruct-2507,4 位加载 + LoRA,T4 用 fp16
import torch
from datasets import load_dataset
from peft import LoraConfig
from transformers import AutoTokenizer, BitsAndBytesConfig
from trl import DPOConfig, DPOTrainer

BASE = "Qwen/Qwen3-4B-Instruct-2507"
tokenizer = AutoTokenizer.from_pretrained(BASE)
tokenizer.padding_side = "left"
if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

data = load_dataset("json", data_files="/content/pairs.jsonl", split="train")
held = data.filter(lambda x: x["ticket_id"] in {"R04"})
train = data.filter(lambda x: x["ticket_id"] not in {"R04"})
keep = ["prompt", "chosen", "rejected"]
train = train.remove_columns([c for c in train.column_names if c not in keep])
held = held.remove_columns([c for c in held.column_names if c not in keep])

args = DPOConfig(
    output_dir="/content/dpo_out",
    beta=0.1,
    loss_type=["sigmoid"],
    learning_rate=1e-5,
    per_device_train_batch_size=2,
    gradient_accumulation_steps=4,
    num_train_epochs=2,
    max_length=1024,
    logging_steps=1,
    eval_strategy="steps",
    eval_steps=2,
    fp16=True,
    bf16=False,
    model_init_kwargs={"dtype": torch.float16},
    report_to="none",
)
trainer = DPOTrainer(
    model=BASE,
    args=args,
    train_dataset=train,
    eval_dataset=held,
    processing_class=tokenizer,
    quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.float16),
    peft_config=LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"),
)
trainer.train()
trainer.save_model("/content/dpo_lora")
```

<div class="line-notes">

- `BASE = "Qwen/Qwen3-4B-Instruct-2507"` 和 Day 572 同一个基座。注意 Day 575 的草稿是 DeepSeek 写的,不是这个模型写的;真实项目里应该先让 Qwen 自己采样草稿再造对,原因 Day 575 讲过:DPO 调的是它自己的分布。
- `tokenizer.padding_side = "left"` TRL 文档要求左填充。一批里长短不一的样本要补齐,补在左边,回答的最后一个 token 才对得齐。
- `tokenizer.pad_token = tokenizer.eos_token` 没有专门的填充 token 时,用结束符代替,文档里说 TRL 默认也会这么做。
- `data = load_dataset("json", data_files="/content/pairs.jsonl", split="train")` Hugging Face 的 `datasets` 库读 JSONL,每行变成一条记录,类似一张表。
- `held = data.filter(lambda x: x["ticket_id"] in {"R04"})` 验证集**按工单**留出:R04 这张工单的 3 对全进验证集,训练集里一对 R04 都没有。为什么不能按对随机留出,下面本机实跑时会看到。
- `train = train.remove_columns([c for c in train.column_names if c not in keep])` 删掉我们自己加的 `why`、`ticket_id`,只留 TRL 认识的三列。不删的话,有的版本会报不认识的列,有的会静悄悄忽略,删掉最省心。
- `beta=0.1,` Day 575 的 β,TRL 默认就是 0.1,写出来是为了提醒自己它存在。
- `loss_type=["sigmoid"],` Day 575 手算的那个损失。TRL 1.x 里这是个列表,可以混几种。
- `learning_rate=1e-5,` TRL 文档的提示:用 LoRA 时学习率要比全量微调高,在 1e-5 量级。`DPOConfig` 的默认是 1e-6,那是给全量微调的。
- `per_device_train_batch_size=2,` 一次算 2 对。每对要算 chosen 和 rejected 两段,相当于一次 4 条序列。
- `gradient_accumulation_steps=4,` 攒 4 次梯度再更新一次,等效每步 8 对(Day 572 讲过梯度累积)。12 对的训练集,一轮只有 2 步。
- `max_length=1024,` 提示加回答最多 1024 个 token。我们的提示两百来个 token、回答一百多个,够用;真实的起草节点带检索结果,动辄几千 token,要按数据分布设,T4 显存不够就先降。
- `eval_strategy="steps",` 每隔 `eval_steps` 步在验证集上算一遍同样的指标,日志里会多出 `eval_` 开头的那些。
- `fp16=True,` T4 不支持 bf16,用 fp16。`DPOConfig` 默认会开 bf16,不改的话在 T4 上会报错。
- `model_init_kwargs={"dtype": torch.float16},` 传给 `from_pretrained` 的参数。TRL 文档特别写了:模型以字符串传进来、又没指定 dtype 时,默认按 float32 加载,显存直接翻倍。
- `quantization_config=BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_compute_dtype=torch.float16),` 基座按 4 位加载,也就是 QLoRA(Day 572)。
- `peft_config=LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"),` 给 DPOTrainer 一个 LoRA 配置,它会自己把模型包起来。**用 LoRA 时不用另外加载参考模型**:文档写明不传 `ref_model` 时,参考模型就是训练开始前的那个模型;PEFT 模型可以随时把 LoRA 旁路关掉,关掉以后就是原来的基座。省下整整一份模型的显存。
- `trainer.save_model("/content/dpo_lora")` 只存 LoRA 适配器,几十 MB,下载下来按 Day 574 的方法挂到 vLLM 上用。

</div>

DPOTrainer 默认会把数据集里的对话格式套上 chat template、算出 prompt 和回答各自的 token,只对回答部分算 logp。你能在日志里看到 Day 575 提到的那些指标名:`loss`、`rewards/chosen`、`rewards/rejected`、`rewards/margins`、`rewards/accuracies`、`logps/chosen`、`logps/rejected`,验证时前面多一个 `eval_`。这些名字和意思来自 TRL 文档的「Logged metrics」一节,具体数字我没有,下面在本机用手写的版本跑出真实的数来读。

## 第二步:本机建一个能跑的环境

本机训练需要的 torch 2.2.2 要求 numpy 低于 2,和 `agent-zero-lab` 里已经装的 numpy 2.x 冲突。所以单独建一个小项目,放在 `part10/dpo-cpu/` 下,和主项目的依赖互不影响。前端打个比方,这像 monorepo 里一个单独有 `package.json` 的子包。

```bash
cd agent-zero-lab
uv init --bare --no-workspace --python 3.12 part10/dpo-cpu
cd part10/dpo-cpu
uv python pin 3.12
uv add "torch==2.2.2" "numpy<2" "transformers<5" peft
```

<div class="line-notes">

- `uv init --bare --no-workspace --python 3.12 part10/dpo-cpu` `--bare` 只生成一个最简的 `pyproject.toml`;`--no-workspace` 告诉 uv 别把它当成外层 `agent-zero-lab` 的子成员,它是独立的项目。
- `uv python pin 3.12` 生成 `.python-version` 文件。不钉的话 uv 可能挑一个更新的 Python(我机器上会挑 3.14),而 torch 2.2.2 只有 3.12 及以下的安装包。
- `uv add "torch==2.2.2" "numpy<2" "transformers<5" peft` 前三个都是为了凑一组在 Intel Mac 上能一起工作的版本:torch 2.2.2 是最后一个有 Intel Mac 安装包的版本,它是对着 numpy 1.x 编译的,transformers 5.x 又不支持这么老的 torch。M 系列 Mac 和 Linux 不需要这些限制。

</div>

装完的版本是 torch 2.2.2、numpy 1.26.4、transformers 4.57.6、peft 0.21.2。

第一次跑脚本时会从 Hugging Face 下载 Qwen2.5-0.5B-Instruct,权重约 1 GB。我这里走代理直连 huggingface.co,默认的 xet 下载方式报了 `ConnectionError: Network error: Request middleware error`,设环境变量 `HF_HUB_DISABLE_XET=1` 改用普通 HTTP 下载就好了,1 GB 下了 20 分钟。下载过一次以后,再跑可以加 `HF_HUB_OFFLINE=1`,不再联网检查更新。

为什么是 0.5B 而不是 Day 572 的 4B?CPU 上 4B 用 32 位浮点光权重就要 16 GB,我的机器一共 16 GB 内存。0.5B 约 2 GB,加上训练时的中间结果,内存够,速度也能接受。它是 Qwen2.5 家族的指令版,中文能写,chat template 和 Qwen3 是同一套写法。

## 第三步:手写一遍 DPOTrainer 做的事

整个训练循环分四块:把一对数据变成 token;算一段回答的 logp;用参考模型和训练中的模型算 Day 575 那个损失;按批更新。新建 `part10/dpo-cpu/dpo_cpu.py`:

```python
# agent-zero-lab/part10/dpo-cpu/dpo_cpu.py
"""在 CPU 上手写一遍 DPOTrainer 做的事:LoRA + 关掉 LoRA 当参考模型 + sigmoid 损失,打印和 TRL 同名的指标。
用法(在 part10/dpo-cpu 目录):uv run python dpo_cpu.py ../data/pairs.jsonl R04
"""
import json
import random
import sys
import time

import torch
import torch.nn.functional as F
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

BASE = "Qwen/Qwen2.5-0.5B-Instruct"
BETA, LR, EPOCHS, ACCUM = 0.1, 5e-5, 2, 4
torch.manual_seed(0)
random.seed(0)

tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.float32)
model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"))
model.print_trainable_parameters()


def encode(prompt: list[dict], answer: list[dict]) -> tuple[torch.Tensor, int]:
    p_ids = tok.apply_chat_template(prompt, add_generation_prompt=True)
    full = tok.apply_chat_template(prompt + answer)
    assert full[:len(p_ids)] == p_ids, "prompt 部分对不上,chat template 有问题"
    return torch.tensor([full]), len(p_ids)


def seq_logp(ids: torch.Tensor, n_prompt: int) -> torch.Tensor:
    logits = model(ids).logits[:, :-1]
    logps = F.log_softmax(logits, dim=-1).gather(2, ids[:, 1:].unsqueeze(-1)).squeeze(-1)
    return logps[:, n_prompt - 1:].sum()


def prepare(pair: dict) -> dict:
    c, r = encode(pair["prompt"], pair["chosen"]), encode(pair["prompt"], pair["rejected"])
    with torch.no_grad(), model.disable_adapter():
        ref_c, ref_r = seq_logp(*c), seq_logp(*r)
    return {"c": c, "r": r, "ref_c": ref_c, "ref_r": ref_r}


def dpo_step(ex: dict) -> dict[str, torch.Tensor]:
    pol_c, pol_r = seq_logp(*ex["c"]), seq_logp(*ex["r"])
    r_c, r_r = BETA * (pol_c - ex["ref_c"]), BETA * (pol_r - ex["ref_r"])
    loss = -F.logsigmoid(r_c - r_r)
    return {"loss": loss, "rewards/chosen": r_c, "rewards/rejected": r_r, "rewards/margins": r_c - r_r,
            "rewards/accuracies": (r_c > r_r).float(), "logps/chosen": pol_c, "logps/rejected": pol_r}


def report(tag: str, rows: list[dict[str, torch.Tensor]]) -> None:
    keys = ["loss", "rewards/chosen", "rewards/rejected", "rewards/margins", "rewards/accuracies",
            "logps/chosen", "logps/rejected"]
    print(tag, "  ".join(f"{k}={sum(float(r[k]) for r in rows) / len(rows):.3f}" for k in keys), flush=True)


pairs = [json.loads(x) for x in open(sys.argv[1], encoding="utf-8")]
held_ids = set(sys.argv[2].split(","))                        # 按工单留出,不按对留出
model.eval()                                                  # 关掉 dropout,和 TRL 的 disable_dropout=True 一样
t0 = time.time()
train = [prepare(p) for p in pairs if p["ticket_id"] not in held_ids]
held = [prepare(p) for p in pairs if p["ticket_id"] in held_ids]
print(f"train {len(train)} 对,held {len(held)} 对,参考模型 logp 预先算好,用时 {time.time() - t0:.0f} 秒", flush=True)
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LR)
step = 0
with torch.no_grad():
    report("eval  step 0", [dpo_step(ex) for ex in held])
for epoch in range(EPOCHS):
    random.shuffle(train)
    buf: list[dict[str, torch.Tensor]] = []
    for i, ex in enumerate(train):
        out = dpo_step(ex)
        (out["loss"] / ACCUM).backward()
        buf.append({k: v.detach() for k, v in out.items()})
        if len(buf) == ACCUM or i == len(train) - 1:
            opt.step()
            opt.zero_grad()
            step += 1
            report(f"train step {step}", buf)
            buf = []
    with torch.no_grad():
        report(f"eval  step {step}", [dpo_step(ex) for ex in held])
print(f"总用时 {time.time() - t0:.0f} 秒")
model.save_pretrained("dpo_lora")
```

<div class="line-notes">

- `import torch.nn.functional as F` PyTorch 的函数库,`F.log_softmax`、`F.logsigmoid` 都在这里。`as F` 起个短名字,相当于 JS 的 `import * as F from ...`。
- `BETA, LR, EPOCHS, ACCUM = 0.1, 5e-5, 2, 4` β 0.1;学习率 5e-5,比 TRL 文档建议的 1e-5 大,因为我们一共只有 6 步,太小了几乎看不到变化;两轮;攒 4 对更新一次。
- `torch.manual_seed(0)` 固定 PyTorch 的随机数,LoRA 的 A 矩阵初始化是随机的,固定以后每次跑结果一样。`random.seed(0)` 管 Python 自己的打乱顺序。
- `model = AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.float32)` CPU 上用 32 位浮点。CPU 对 16 位的支持很慢,32 位最稳。
- `model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"))` 给所有线性层挂上 r=16 的 LoRA,和 Colab 脚本的配置一样。原来的权重自动冻结,只有 LoRA 的 A、B 可训练。
- `model.print_trainable_parameters()` 打印可训练参数占比,实跑是 879.8 万,占 1.75%。
- `p_ids = tok.apply_chat_template(prompt, add_generation_prompt=True)` 只套 prompt(system + user),末尾加上「轮到 assistant 说话了」的标记,返回 token 编号的列表。Day 571 讲过 chat template 是怎么把消息拼成一串文字的。
- `full = tok.apply_chat_template(prompt + answer)` prompt 加回答一起套。两个列表用 `+` 拼接,相当于 JS 的 `[...prompt, ...answer]`。
- `assert full[:len(p_ids)] == p_ids, "prompt 部分对不上,chat template 有问题"` 完整序列的开头必须正好是 prompt 那一段,这样「从第几个 token 开始是回答」才算得准。有的模板(比如带思考的 Qwen3)会在加回答时改写前面的内容,这一行就是防这个的,Day 571 的「渲染出来看一眼」在代码里的版本。
- `return torch.tensor([full]), len(p_ids)` 包成形状 (1, 长度) 的张量(一批只有一条),同时返回 prompt 有几个 token。
- `logits = model(ids).logits[:, :-1]` 模型对每个位置给出「下一个 token」的分数。最后一个位置预测的是序列之后的东西,用不上,去掉。形状是 (1, 长度-1, 词表大小)。
- `logps = F.log_softmax(logits, dim=-1).gather(2, ids[:, 1:].unsqueeze(-1)).squeeze(-1)` 分三步读。`log_softmax` 把分数变成对数概率;`ids[:, 1:]` 是每个位置真正的下一个 token;`gather` 从整张词表的对数概率里,只挑出那个真实 token 的那一个值。结果是每个 token 的 logprob,和 Day 110 里 API 返回的 `logprob` 是同一个东西。
- `return logps[:, n_prompt - 1:].sum()` 只要回答部分的 token,加起来就是整段回答的 logp。`n_prompt - 1` 是因为上一行错开了一位:第 i 个位置预测的是第 i+1 个 token。实跑时一段回答的 logp 在 -130 到 -220 之间。
- `with torch.no_grad(), model.disable_adapter():` **参考模型就在这一行**。`disable_adapter()` 临时关掉 LoRA 旁路,模型就是原来的基座;`no_grad` 表示不需要梯度,省内存。这就是 TRL 文档说的「用 PEFT 时参考模型是训练前的模型」。
- `ref_c, ref_r = seq_logp(*c), seq_logp(*r)` 参考模型对好、差两段回答的 logp。`*c` 把元组拆开当两个参数传,相当于 JS 的 `seqLogp(...c)`。参考模型冻结不动,这两个数整个训练过程都不会变,所以开训前一次算好存起来,TRL 里对应的选项叫 `precompute_ref_log_probs`。
- `pol_c, pol_r = seq_logp(*ex["c"]), seq_logp(*ex["r"])` 训练中的模型(LoRA 开着)的 logp,这两个要带梯度。
- `r_c, r_r = BETA * (pol_c - ex["ref_c"]), BETA * (pol_r - ex["ref_r"])` 隐式奖励,和 Day 575 `dpo_loss_toy.py` 的那两行一模一样。
- `loss = -F.logsigmoid(r_c - r_r)` 也和 Day 575 一样。`logsigmoid` 是把 `log(sigmoid(x))` 合成一步算,数值上更稳,margin 很大或很小时不会出现 log 0。
- `"rewards/accuracies": (r_c > r_r).float(),` 好回答的奖励严格大于差回答,记 1,否则 0。第 0 步两个奖励都是 0,不是「大于」,所以记 0。
- `print(tag, "  ".join(f"{k}={sum(float(r[k]) for r in rows) / len(rows):.3f}" for k in keys), flush=True)` 一批里每个指标取平均打印。`flush=True` 立刻写出,不在缓冲区里攒着,输出重定向到文件时也能实时看到进度。
- `held_ids = set(sys.argv[2].split(","))                        # 按工单留出,不按对留出` 第二个参数是留出的工单号,可以逗号分隔写多个。
- `model.eval()                                                  # 关掉 dropout,和 TRL 的 disable_dropout=True 一样` dropout 是训练时随机丢掉一些神经元的技巧,开着的话同一段回答算两次 logp 会不一样,参考值和训练值就对不上了。`eval()` 只影响 dropout 这类层,不影响求梯度。
- `opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LR)` 优化器只管可训练的参数,也就是 LoRA 的那 880 万个。
- `(out["loss"] / ACCUM).backward()` 算梯度并累加到参数上。除以 4 是因为攒 4 对再更新,这样累加起来等于 4 对的平均梯度(Day 572 讲过梯度累积)。
- `if len(buf) == ACCUM or i == len(train) - 1:` 攒够 4 对,或者到了这一轮最后一对,就更新一次。12 对一轮正好 3 步。
- `opt.step()` 按梯度更新 LoRA 参数,`opt.zero_grad()` 清空累加的梯度,准备下一步。
- `report(f"eval  step {step}", [dpo_step(ex) for ex in held])` 每轮结束在留出的验证集上算一遍同样的指标,不更新参数。
- `model.save_pretrained("dpo_lora")` 只存 LoRA 适配器,实测 34 MB。

</div>

### 故意踩一次坑:按对随机留出

我写的第一版,验证集是这样留的:把 15 对打乱,取前 3 对当验证集,剩下 12 对训练(第一版还有一个区别:参考模型的 logp 每步现算,没有预先存起来,所以慢得多)。跑完第一轮,输出是这样的:

```text
eval  step 0 loss=0.693  rewards/chosen=0.000  rewards/rejected=0.000  rewards/margins=0.000  rewards/accuracies=0.000  logps/chosen=-146.343  logps/rejected=-187.334
train step 1 loss=0.693  rewards/chosen=0.000  rewards/rejected=0.000  rewards/margins=0.000  rewards/accuracies=0.000  logps/chosen=-158.418  logps/rejected=-189.650
train step 2 loss=0.774  rewards/chosen=-0.025  rewards/rejected=-0.125  rewards/margins=0.100  rewards/accuracies=0.250  logps/chosen=-153.831  logps/rejected=-170.480
train step 3 loss=0.683  rewards/chosen=-0.461  rewards/rejected=-0.506  rewards/margins=0.046  rewards/accuracies=0.500  logps/chosen=-158.827  logps/rejected=-190.837
eval  step 3 loss=0.283  rewards/chosen=1.016  rewards/rejected=-0.563  rewards/margins=1.579  rewards/accuracies=1.000  logps/chosen=-136.182  logps/rejected=-192.960
```

看最后一行:验证集 loss 0.283,准确率 100%,margin 1.58,比训练集(loss 0.683,准确率 50%)好得多。验证集比训练集还好,这几乎从来不是好消息。原因是同一份草稿会出现在好几对里:Day 575 的 `pairs_for` 里,一份全过规则的草稿可以同时和两三份违规草稿各成一对。按对随机切,验证集里的回答原文大多在训练集里出现过。写个小脚本数一数,新建 `part10/split_leak.py`(这个在主项目里跑,只用标准库):

```python
# agent-zero-lab/part10/split_leak.py
"""两种留出方式各有多少「验证集里的回答在训练集里出现过」:按对随机留出 vs 按工单留出。
用法:uv run python part10/split_leak.py part10/data/pairs.jsonl
"""
import json
import random
import sys


def texts(pairs: list[dict]) -> set[str]:
    return {p[k][0]["content"] for p in pairs for k in ("chosen", "rejected")}


pairs = [json.loads(x) for x in open(sys.argv[1], encoding="utf-8")]
for name in ("按对随机留出 3 对", "按工单留出 R04"):
    if name.startswith("按对"):
        shuffled = pairs[:]
        random.seed(0)
        random.shuffle(shuffled)
        held, train = shuffled[:3], shuffled[3:]
    else:
        held = [p for p in pairs if p["ticket_id"] == "R04"]
        train = [p for p in pairs if p["ticket_id"] != "R04"]
    seen = texts(train)
    reused = sum(p[k][0]["content"] in seen for p in held for k in ("chosen", "rejected"))
    same_ticket = sum(p["ticket_id"] in {t["ticket_id"] for t in train} for p in held)
    print(f"{name}: 验证集 {len(held)} 对,其中 {same_ticket} 对的工单在训练集里出现过,"
          f"{reused}/{len(held) * 2} 份回答原文在训练集里出现过")
```

<div class="line-notes">

- `return {p[k][0]["content"] for p in pairs for k in ("chosen", "rejected")}` 集合推导式,所有对里出现过的回答原文。
- `shuffled = pairs[:]` 复制一份再打乱,`[:]` 是浅拷贝,相当于 JS 的 `pairs.slice()`。
- `random.seed(0)` 和第一版训练脚本同样的种子、同样只打乱一次,切出来的正是那 3 对(R03 一对、R05 两对)。
- `reused = sum(p[k][0]["content"] in seen for p in held for k in ("chosen", "rejected"))` 验证集的 6 份回答,有几份在训练集里原样出现过。

</div>

```bash
cd agent-zero-lab
uv run python part10/split_leak.py part10/data/pairs.jsonl
```

```text
按对随机留出 3 对: 验证集 3 对,其中 3 对的工单在训练集里出现过,5/6 份回答原文在训练集里出现过
按工单留出 R04: 验证集 3 对,其中 0 对的工单在训练集里出现过,0/6 份回答原文在训练集里出现过
```

6 份里 5 份是训练时见过的原文。模型在训练集上把这几份草稿的概率推上去、压下来,验证集上自然「表现很好」,它测的是记忆,不是泛化。这和 [Day 574](/blog/agent-zero/day-574-finetune-3/) 的模板泄漏是同一个道理,换了个样子:偏好对之间共享回答,所以**留出的单位必须是工单**(真实项目里甚至应该是客户或时间段),同一张工单的所有对要么全在训练集,要么全在验证集。

## 第四步:跑起来,读指标

按工单留出 R04,正式跑:

```bash
cd part10/dpo-cpu
HF_HUB_DISABLE_XET=1 uv run python dpo_cpu.py ../data/pairs.jsonl R04
```

实跑输出(2026-10-22,Intel Core i7-8569U 的 CPU,警告行省略):

```text
trainable params: 8,798,208 || all params: 502,830,976 || trainable%: 1.7497
train 12 对,held 3 对,参考模型 logp 预先算好,用时 72 秒
eval  step 0 loss=0.693  rewards/chosen=0.000  rewards/rejected=0.000  rewards/margins=0.000  rewards/accuracies=0.000  logps/chosen=-168.068  logps/rejected=-208.982
train step 1 loss=0.693  rewards/chosen=0.000  rewards/rejected=0.000  rewards/margins=0.000  rewards/accuracies=0.000  logps/chosen=-150.744  logps/rejected=-172.337
train step 2 loss=0.484  rewards/chosen=0.476  rewards/rejected=-0.247  rewards/margins=0.723  rewards/accuracies=0.750  logps/chosen=-143.197  logps/rejected=-218.658
train step 3 loss=0.282  rewards/chosen=0.818  rewards/rejected=-0.696  rewards/margins=1.514  rewards/accuracies=1.000  logps/chosen=-143.038  logps/rejected=-146.845
eval  step 3 loss=1.044  rewards/chosen=-0.739  rewards/rejected=-0.138  rewards/margins=-0.601  rewards/accuracies=0.000  logps/chosen=-175.453  logps/rejected=-210.358
train step 4 loss=0.052  rewards/chosen=1.123  rewards/rejected=-2.271  rewards/margins=3.394  rewards/accuracies=1.000  logps/chosen=-133.890  logps/rejected=-205.412
train step 5 loss=0.041  rewards/chosen=1.316  rewards/rejected=-2.451  rewards/margins=3.767  rewards/accuracies=1.000  logps/chosen=-138.067  logps/rejected=-221.665
train step 6 loss=0.246  rewards/chosen=1.747  rewards/rejected=-1.085  rewards/margins=2.832  rewards/accuracies=0.750  logps/chosen=-136.107  logps/rejected=-159.402
eval  step 6 loss=1.071  rewards/chosen=-1.734  rewards/rejected=-1.097  rewards/margins=-0.637  rewards/accuracies=0.000  logps/chosen=-185.406  logps/rejected=-219.947
总用时 407 秒
```

整个训练不到 7 分钟。一行一行读。

**第 0 步和第 1 步:loss 0.693,准确率 0。** 和 Day 575 算的一样:训练还没开始,模型就是参考模型,所有奖励都是 0,margin 是 0。`rewards/accuracies` 是 0 而不是 0.5,因为它数的是「好回答奖励**严格大于**差回答」,两个都是 0 不算大于。train step 1 的数字是这一步更新**之前**算的,所以也还是 0.693。

**`rewards/margins` 一路往上:0 → 0.72 → 1.51 → 3.39 → 3.77。** 训练在做它该做的事,好回答和差回答的奖励被拉开了。margin 3.39 时,按 Day 575 的 `bt_toy.py`,模型认为好回答更好的概率是 sigmoid(3.39) ≈ 0.97。

**`rewards/chosen` 是正的、`rewards/rejected` 是负的。** 在训练集上,模型把好回答的概率抬高了一点(+1.1 左右,也就是 logp 比参考模型高了约 11),把差回答压低得更多(-2.3,logp 低了约 23)。Day 575 说过,DPO 主要靠压低差回答,这里也看得到:压的幅度是抬的两倍。

**`logps/*` 每一步都在跳。** 比如 train step 3 的 `logps/rejected` 是 -146.8,step 4 是 -205.4。这不说明什么,每一步算的是不同的 4 对,回答长短不一样,logp 本来就差很多。所以 TRL 日志里 `logps` 要和 `rewards`(它扣掉了参考模型的值)放在一起看,单看绝对值没有意义。

**训练集 loss 掉到 0.04,准确率 100%。** 12 对,两轮,模型很快就把它们分开了。Day 575 的练习 1 算过,margin 一过 3,loss 就接近 0,这些对几乎不再提供训练信号。

**验证集越训越差。** 这是最该看的一行。`eval step 3` 的 margin 是 -0.60,`eval step 6` 是 -0.64,准确率 0:在没见过的 R04 上,模型反而更偏向差回答了。而且 `rewards/chosen` 从 0 掉到 -1.73,好回答的 logp 从 -168 掉到 -185,模型越来越不愿意写 R04 的好回答。

训练集越来越好、验证集越来越差,这就是过拟合。我猜原因是这样:R04 的 3 对里有 2 对是 `too_long`(好回答更短),1 对是 `no_policy_id`;训练集里 `too_long` 只有 2 对,`fake_action` 和 judge 的 7 对里有 4 对好回答更长(Day 575 `pair_stats.py` 的输出)。12 对数据,模型学到的很可能是这批数据里最容易抓的那个特征,而这个特征在 R04 上是反的。我没有办法用 3 对验证数据证明这个猜测,下一步的回归检查会给出一个旁证。

TRL 的日志里还会有 `entropy`、`mean_token_accuracy`、`grad_norm` 等,意思在 TRL 文档里;最关键的就是上面这几个,看的顺序是:**验证集的 `rewards/accuracies` 和 `rewards/margins` 有没有涨 → 训练集和验证集差多远 → `rewards/chosen` 是不是一直在往下掉**。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="训练集和验证集的 rewards/margins 随步数变化:训练集上升,验证集下降">
<line x1="60" y1="20" x2="60" y2="220" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="60" y1="180" x2="600" y2="180" stroke="var(--rule)" stroke-width="1.5"/>
<text x="50" y="184" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="end">0</text>
<text x="50" y="44" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="end">4</text>
<text x="50" y="219" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="end">-1</text>
<line x1="60" y1="40" x2="600" y2="40" stroke="var(--rule)" stroke-dasharray="3 3"/>
<text x="60" y="240" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">0</text>
<text x="240" y="240" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">3</text>
<text x="420" y="240" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">6</text>
<text x="330" y="256" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">step</text>
<polyline points="120,180 180,154.7 240,127 300,61.2 360,48.2 420,80.9" fill="none" stroke="var(--mem)" stroke-width="2"/>
<circle cx="120" cy="180" r="3" fill="var(--mem)"/>
<circle cx="180" cy="154.7" r="3" fill="var(--mem)"/>
<circle cx="240" cy="127" r="3" fill="var(--mem)"/>
<circle cx="300" cy="61.2" r="3" fill="var(--mem)"/>
<circle cx="360" cy="48.2" r="3" fill="var(--mem)"/>
<circle cx="420" cy="80.9" r="3" fill="var(--mem)"/>
<polyline points="60,180 240,201 420,202.3" fill="none" stroke="var(--compute)" stroke-width="2"/>
<circle cx="60" cy="180" r="3" fill="var(--compute)"/>
<circle cx="240" cy="201" r="3" fill="var(--compute)"/>
<circle cx="420" cy="202.3" r="3" fill="var(--compute)"/>
<text x="440" y="70" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">训练集 margin</text>
<text x="440" y="86" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">0 → 3.77 → 2.83</text>
<text x="440" y="200" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">验证集(R04)margin</text>
<text x="440" y="216" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">0 → -0.60 → -0.64</text>
</svg>
<figcaption>本机实跑的 rewards/margins。蓝线是训练集每一步的平均,琥珀线是留出的 R04(没见过的数据)。两条线朝相反方向走,就是过拟合;按对随机留出时,琥珀线会跟着蓝线一起往上,把问题藏起来。</figcaption>
</figure>

## 第五步:回归检查

日志只能说明模型在偏好对上分得开分不开。训练完必须回答的问题是:**它写出来的回复变好了没有,有没有学坏**。偏好优化训完一般查四项:长度、事实和规则、格式、通用能力。我们的数据能查其中三项:长度、规则(复用 Day 575 的 `pref_rules.py`)、一道通用问题。

同一批工单分两组生成:LoRA 关掉(原版)和 LoRA 打开(DPO 版)。工单用三种:训练用过的 R01–R06(其中 R04 是留出的),再加 4 张全新的 N01–N04,新的这 4 张最能说明问题。新建 `part10/dpo-cpu/regress_check.py`:

```python
# agent-zero-lab/part10/dpo-cpu/regress_check.py
"""DPO 前后对比:同一批工单分别用原版(关掉 LoRA)和 DPO 版生成回复,查规则、数字数,再问一个和客服无关的问题。
用法(在 part10/dpo-cpu 目录):uv run python regress_check.py ../data/drafts.jsonl [适配器目录,默认 dpo_lora]
"""
import json
import sys
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pref_rules import check            # noqa: E402  Day 575 的三条规则,只用标准库,这个环境也能导入

BASE = "Qwen/Qwen2.5-0.5B-Instruct"
SYSTEM = "你是 CloudLedger 的客服,根据工单和查到的资料,给客户写一段中文回复草稿。"   # 和 sample_drafts.py 一字不差
NEW = [
    ("N01", "年付想换月付", "专业版年付才用了三个月,能改成月付吗?",
     "订阅:专业版年付 2376 元,已用 3 个月。政策 KB-042:年付中途不能改月付,到期后可切换。"),
    ("N02", "发票还没收到", "10 月的发票说开了,邮箱里没看到。",
     "发票 INV-1007:10 月 8 日已开具,发往 finance@example.com。政策 KB-032:电子发票开具后 24 小时内发送到预留邮箱。"),
    ("N03", "退款能退到别的卡吗", "原来那张卡注销了,退款能退到新卡吗?",
     "退款单 RF-3402:审批中。政策 KB-013:退款只能原路退回,不能退到其他账户。"),
    ("N04", "多扣了一个席位", "我们只有 11 个人,账单按 12 个席位收的。",
     "账单:10 月席位 12 个,实际成员 11 个。政策 KB-022:席位按账期内最高人数计费,多扣部分需人工核实后退回。"),
]

tok = AutoTokenizer.from_pretrained(BASE)
ADAPTER = sys.argv[2] if len(sys.argv) > 2 else "dpo_lora"
model = PeftModel.from_pretrained(AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.float32), ADAPTER)
model.eval()


def gen(messages: list, use_lora: bool) -> str:
    ids = torch.tensor([tok.apply_chat_template(messages, add_generation_prompt=True)])
    with torch.no_grad():
        if use_lora:
            out = model.generate(ids, max_new_tokens=200, do_sample=False)
        else:
            with model.disable_adapter():
                out = model.generate(ids, max_new_tokens=200, do_sample=False)
    return tok.decode(out[0, ids.shape[1]:], skip_special_tokens=True)


cases = [(r["ticket_id"], r["prompt"], r["facts"]) for r in map(json.loads, open(sys.argv[1], encoding="utf-8"))]
cases += [(tid, [{"role": "system", "content": SYSTEM},
                 {"role": "user", "content": f"工单主题:{s}\n客户原文:{b}\n查到的资料:{f}"}], f) for tid, s, b, f in NEW]
stats = {False: {"chars": 0, "fails": 0}, True: {"chars": 0, "fails": 0}}
for tid, messages, facts in cases:
    for use_lora in (False, True):
        text = gen(messages, use_lora)
        failed = check(text, facts)
        stats[use_lora]["chars"] += len(text)
        stats[use_lora]["fails"] += len(failed)
        print(f"{tid} {'DPO ' if use_lora else '原版'} {len(text):>4} 字  {failed or 'ok'}", flush=True)
for use_lora, s in stats.items():
    print(f"{'DPO ' if use_lora else '原版'} 平均 {s['chars'] / len(cases):.0f} 字,违规 {s['fails']} 次")

general = [{"role": "user", "content": "用一句话解释 HTTP 404 是什么意思。"}]
print("原版:", gen(general, False))
print("DPO :", gen(general, True))
```

<div class="line-notes">

- `sys.path.insert(0, str(Path(__file__).resolve().parent.parent))` 把上一级的 `part10/` 加进导入路径,才能导入 Day 575 的 `pref_rules.py`。`resolve()` 先把路径变成绝对路径,`.parent.parent` 是「这个文件所在目录的上一级」。
- `from pref_rules import check            # noqa: E402  Day 575 的三条规则,只用标准库,这个环境也能导入` `pref_rules.py` 只用了 `re`,在这个只装了 torch 的小环境里也能导入。`sample_drafts.py` 就不行,它要 `openai` 和 `dotenv`,所以下面把它的 system 说明抄了一份。`noqa: E402` 告诉 ruff 别报「导入不在文件开头」。
- `SYSTEM = "你是 CloudLedger 的客服,根据工单和查到的资料,给客户写一段中文回复草稿。"   # 和 sample_drafts.py 一字不差` 训练时 prompt 里就是这段,生成时也必须一样。
- `NEW = [` 4 张全新的工单,格式和 Day 575 一样带资料和政策编号,训练数据里没有它们。
- `model = PeftModel.from_pretrained(AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.float32), ADAPTER)` 先加载基座,再把训好的适配器挂上去,相当于 Day 574 的运行时挂载在 transformers 里的写法。
- `out = model.generate(ids, max_new_tokens=200, do_sample=False)` `do_sample=False` 是贪心解码,每一步都取概率最大的 token,相当于温度 0,两个版本的差别只来自 LoRA,不来自随机。最多写 200 个 token。
- `with model.disable_adapter():` 关掉 LoRA 就是原版,同一个进程里对比,和 Day 574 在同一个 vLLM 里比原版和微调版是一个思路。
- `return tok.decode(out[0, ids.shape[1]:], skip_special_tokens=True)` 生成结果包含输入,`ids.shape[1]` 是输入的长度,从那以后的才是新写的;`decode` 把 token 编号变回文字。
- `failed = check(text, facts)` 用 Day 575 的三条规则检查。
- `general = [{"role": "user", "content": "用一句话解释 HTTP 404 是什么意思。"}]` 一道和客服无关的问题,看通用能力有没有被训坏。真实项目里要十几二十道,今天只放一道示意。

</div>

```bash
HF_HUB_OFFLINE=1 uv run python regress_check.py ../data/drafts.jsonl
```

实跑输出(在我的机器上要跑几分钟,警告行省略):

```text
R01 原版  192 字  ['no_policy_id', 'too_long']
R01 DPO   275 字  ['no_policy_id', 'too_long']
R02 原版  179 字  ['no_policy_id']
R02 DPO   300 字  ['too_long']
R03 原版  183 字  ['no_policy_id', 'too_long']
R03 DPO    99 字  ['no_policy_id']
R04 原版  252 字  ['no_policy_id', 'too_long']
R04 DPO   284 字  ['no_policy_id', 'too_long']
R05 原版  163 字  ['no_policy_id']
R05 DPO   260 字  ['no_policy_id', 'too_long']
R06 原版  308 字  ['no_policy_id', 'too_long']
R06 DPO   371 字  ['no_policy_id', 'too_long']
N01 原版  285 字  ['no_policy_id', 'too_long']
N01 DPO   341 字  ['no_policy_id', 'too_long']
N02 原版  236 字  ['too_long']
N02 DPO   371 字  ['no_policy_id', 'too_long']
N03 原版  170 字  ['no_policy_id']
N03 DPO   375 字  ['no_policy_id', 'too_long']
N04 原版  295 字  ['no_policy_id', 'too_long']
N04 DPO   280 字  ['no_policy_id', 'too_long']
原版 平均 226 字,违规 16 次
DPO  平均 296 字,违规 18 次
原版: HTTP 404（Bad Request）表示请求的资源不存在或无法找到，通常用于响应客户端未正确指定或访问的URL。
DPO : HTTP 404（Bad Request）表示请求的资源不存在或无法被服务器理解，通常用于响应用户关于找不到指定页面的信息。
```

**长度:平均从 226 字涨到 296 字,涨了 31%。** 10 张工单里 8 张变长了,只有 R03 和 N04 变短。这正是 Day 575 一直在防的长度偏差:训练集里 judge 和 `fake_action` 来源的 7 对,有 4 对好回答更长,模型学到了「写长一点」。一个常用的经验线是「平均长度涨了 30% 以上就要警惕」,我们正好踩在线上。

**规则:违规从 16 次变成 18 次,没变好。** `too_long` 从 7 次变成 9 次,和长度一起变坏;`no_policy_id` 两边都是 9 次,没动。偏好数据里专门有 4 对教「要引用政策编号」,可是 0.5B 的原版本来就几乎不引用,12 对里那几对远远不够把它扳过来。`fake_action` 两边都是 0 次,0.5B 的原版本来就不爱说「已为您提交」。

**通用问题:两边都错。** HTTP 404 是 Not Found,两个版本都写成了 Bad Request(那是 400)。这不是 DPO 弄坏的,原版就错,0.5B 的知识本来就有限;说法略有变化,意思没变。所以通用能力这一项,在这一道题上没看到退化,但一道题说明不了什么。

把结果填进一张回归检查表:

| 指标 | DPO 前 | DPO 后 | 判断 |
| --- | --- | --- | --- |
| 平均回复字数(10 张) | 226 | 296 | 涨 31%,长度偏差,不合格 |
| 规则违规次数(10 张 × 3 条) | 16 | 18 | 没变好 |
| `fake_action` 次数 | 0 | 0 | 原版本来就不犯 |
| 通用问题(1 道) | 错 | 错 | 没看到退化,样本太少 |
| 人工盲评胜率(抽 30 对) | 待填 | 待填 | 今天只有 10 张,没做 |

结论很清楚:**这次 DPO 不值得上线。** 原因在数据,不在方法:15 对、其中验证集 3 对,远远不够;数据有长度偏差;草稿是 DeepSeek 写的,不是 Qwen 自己写的,偏好对里的错误不是这个模型会犯的错误(0.5B 根本不说「已为您提交」,DeepSeek 说)。下一步要做的是:让要训的模型自己采样草稿,攒到几百对以上;按来源控制长度比;规则全过的草稿多了以后再用 judge;再训、再按今天的流程查。

人工盲评那一行今天空着,但它是这张表里最重要的一行:随机抽 30 张工单,把前后两个版本的回复打乱顺序给一个没参与训练的人看,问哪个更好。自动指标再好看,人看了觉得没区别,这次训练就没有意义。

### 零件和大代码的对照

| 零件 | 在哪学的 | 今天的位置 |
| --- | --- | --- |
| 隐式奖励、`-log sigmoid(margin)` | Day 575 `dpo_loss_toy.py` | `dpo_step` |
| logprob | Day 110 | `seq_logp` 里的 `log_softmax` + `gather` |
| chat template | Day 571 | `encode` 和那一行 `assert` |
| LoRA、梯度累积 | Day 572 | `get_peft_model`、`ACCUM` |
| 运行时挂载、同进程对比 | Day 574 | `disable_adapter`、`regress_check.py` |
| 训练集和评测集按出处隔离 | Day 570、Day 574 | 按工单留出、`split_leak.py` |
| 规则检查 | Day 575 `pref_rules.py` | `regress_check.py` 的 `check` |

## 动手练习

1. **日志里的 loss 为什么对不上 margin**:train step 4 的平均 margin 是 3.394,按 Day 575 的公式 `-log sigmoid(3.394)` 约等于 0.033,日志里的 loss 却是 0.052。写个小脚本解释为什么。

<details><summary>参考答案</summary>

日志里的每个指标都是「一批里每对的值取平均」。loss 是先对每一对算 `-log sigmoid(margin)` 再平均,不是先把 margin 平均了再算 loss。`-log sigmoid` 是一条弯的曲线(margin 小的时候 loss 涨得很快),两种算法不相等。新建 `part10/mean_loss.py`(在主项目里跑):

```python
# agent-zero-lab/part10/mean_loss.py
"""日志里的 loss 是「每对的 loss 取平均」,不是「平均 margin 的 loss」。两者差多少,用几组 margin 试一下。"""
import math
import statistics


def loss(m: float) -> float:
    return -math.log(1 / (1 + math.exp(-m)))


for margins in ([3.4, 3.4, 3.4, 3.4], [6.0, 5.0, 3.0, -0.4], [1.5, 1.5], [3.5, -0.5]):
    avg_m = statistics.mean(margins)
    print(f"margins={margins}  平均 margin {avg_m:.2f} 的 loss={loss(avg_m):.3f}  "
          f"每对 loss 的平均={statistics.mean(loss(m) for m in margins):.3f}")
```

<div class="line-notes">

- `for margins in ([3.4, 3.4, 3.4, 3.4], [6.0, 5.0, 3.0, -0.4], [1.5, 1.5], [3.5, -0.5]):` 两组平均 margin 都是 3.4、两组都是 1.5,但每组内部分散程度不同。这几组数是我编的示例,不是日志里的。

</div>

```bash
uv run python part10/mean_loss.py
```

```text
margins=[3.4, 3.4, 3.4, 3.4]  平均 margin 3.40 的 loss=0.033  每对 loss 的平均=0.033
margins=[6.0, 5.0, 3.0, -0.4]  平均 margin 3.40 的 loss=0.033  每对 loss 的平均=0.243
margins=[1.5, 1.5]  平均 margin 1.50 的 loss=0.201  每对 loss 的平均=0.201
margins=[3.5, -0.5]  平均 margin 1.50 的 loss=0.201  每对 loss 的平均=0.502
```

平均 margin 一样,只要有一对是负的(模型在这一对上还是偏向差回答),平均 loss 就会高很多。日志里 step 4 是 0.052 而不是 0.033,说明那 4 对里 margin 有大有小;step 6 的 loss 0.246、准确率 0.75,就是有一对 margin 是负的。读日志时,loss 和 `rewards/accuracies` 一起看,能看出「是整体都分开了,还是有几对死活分不开」。

</details>

2. **混一点 SFT 损失**:Day 575 说过,好回答的 logp 掉得太多时,可以在 DPO 损失上加一项 SFT 损失(TRL 里写成 `loss_type=["sigmoid", "sft"]`)。把 `dpo_cpu.py` 复制成 `dpo_sft_cpu.py`,损失加上「好回答每个 token 的平均负 logp」,权重 1.0,适配器存到 `dpo_sft_lora`,再跑一次训练和回归检查,和纯 DPO 比。

<details><summary>参考答案</summary>

复制一份,改三处:

```bash
cd part10/dpo-cpu
cp dpo_cpu.py dpo_sft_cpu.py
```

在 `BETA, LR, EPOCHS, ACCUM = ...` 下面加一行权重:

```python
SFT_W = 1.0                                                   # SFT 损失的权重
```

<div class="line-notes">

- `SFT_W = 1.0                                                   # SFT 损失的权重` 和 TRL 里 `loss_weights` 不写时的默认一样,两种损失各占 1.0。

</div>

`dpo_step` 里的损失那一行换成两行:

```python
    n_tok = ex["c"][0].shape[1] - ex["c"][1]                  # 好回答有几个 token
    loss = -F.logsigmoid(r_c - r_r) + SFT_W * (-pol_c / n_tok)
```

<div class="line-notes">

- `n_tok = ex["c"][0].shape[1] - ex["c"][1]                  # 好回答有几个 token` `ex["c"]` 是 `encode` 返回的(序列, prompt 长度),整条序列的长度减去 prompt 长度,就是回答的 token 数。
- `loss = -F.logsigmoid(r_c - r_r) + SFT_W * (-pol_c / n_tok)` 后半项是好回答每个 token 的平均负 logp,就是普通 SFT 的交叉熵:它要求模型把好回答的概率往上抬,不管差回答。

</div>

最后一行的保存目录改成 `model.save_pretrained("dpo_sft_lora")`。然后:

```bash
HF_HUB_OFFLINE=1 uv run python dpo_sft_cpu.py ../data/pairs.jsonl R04
HF_HUB_OFFLINE=1 uv run python regress_check.py ../data/drafts.jsonl dpo_sft_lora
```

训练输出(只贴关键的几行,警告省略):

```text
eval  step 0 loss=2.794  rewards/chosen=0.000  rewards/rejected=0.000  rewards/margins=0.000  rewards/accuracies=0.000  logps/chosen=-168.068  logps/rejected=-208.982
train step 1 loss=2.236  rewards/chosen=0.000  rewards/rejected=0.000  rewards/margins=0.000  rewards/accuracies=0.000  logps/chosen=-150.744  logps/rejected=-172.337
train step 5 loss=1.342  rewards/chosen=2.440  rewards/rejected=-1.122  rewards/margins=3.561  rewards/accuracies=1.000  logps/chosen=-126.827  logps/rejected=-208.368
train step 6 loss=1.487  rewards/chosen=3.391  rewards/rejected=0.648  rewards/margins=2.744  rewards/accuracies=0.750  logps/chosen=-119.666  logps/rejected=-142.079
eval  step 6 loss=3.284  rewards/chosen=-0.457  rewards/rejected=0.266  rewards/margins=-0.723  rewards/accuracies=0.000  logps/chosen=-172.633  logps/rejected=-206.322
总用时 353 秒
```

回归检查最后两行(这里标着 `DPO` 的是 DPO+SFT 版,脚本里的名字没改):

```text
原版 平均 226 字,违规 16 次
DPO  平均 280 字,违规 18 次
```

和纯 DPO 对比:

| | 纯 DPO | DPO + SFT |
| --- | --- | --- |
| 训练集最后一步 `rewards/chosen` | 1.747 | 3.391 |
| 验证集 `rewards/chosen`(第 6 步) | -1.734 | -0.457 |
| 验证集 `rewards/margins`(第 6 步) | -0.637 | -0.723 |
| 回归检查平均字数 | 296 | 280 |
| 回归检查违规次数 | 18 | 18 |

loss 一开始就是 2.79 而不是 0.693,因为多了 SFT 那一项(每个 token 平均负 logp 约 2.1),这个数和纯 DPO 的 loss 没法直接比。

SFT 项起了它该起的作用:好回答的奖励在训练集上涨得更多,在验证集上掉得少多了(-0.46 对 -1.73),模型不再「越来越不愿意写好回答」。可它解决不了根本问题:验证集的 margin 还是负的,回复还是比原版长了 24%,违规次数一样。损失函数的小技巧补不了数据的不足,12 对数据就是 12 对数据。


</details>

3. **按组看回归结果**:把 `regress_check.py` 的输出存成文件,按「训练用过的工单」「留出的 R04」「全新的工单」三组分别统计平均字数和违规次数。

<details><summary>参考答案</summary>

先把输出存下来:`HF_HUB_OFFLINE=1 uv run python regress_check.py ../data/drafts.jsonl > regress.txt 2>&1`(`2>&1` 把警告也写进同一个文件,不影响解析)。然后回到主项目,新建 `part10/regress_split.py`:

```python
# agent-zero-lab/part10/regress_split.py
"""把 regress_check.py 的输出按「训练过的工单 / 留出的工单 / 全新的工单」分组统计平均字数和违规次数。
用法:uv run python part10/regress_split.py part10/dpo-cpu/regress.txt
"""
import re
import sys
from collections import defaultdict

GROUP = {"R04": "留出的 R04"}
stats: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0, 0])
for line in open(sys.argv[1], encoding="utf-8"):
    m = re.match(r"(R\d\d|N\d\d) (原版|DPO )\s+(\d+) 字  (.*)", line)
    if not m:
        continue
    tid, who, chars, failed = m.groups()
    group = GROUP.get(tid, "训练过的 R" if tid.startswith("R") else "全新的 N")
    s = stats[(group, who.strip())]
    s[0] += 1
    s[1] += int(chars)
    s[2] += 0 if failed == "ok" else failed.count("'") // 2
for (group, who), (n, chars, fails) in sorted(stats.items()):
    print(f"{group:<8} {who:<4} {n} 张  平均 {chars / n:.0f} 字  违规 {fails} 次")
```

<div class="line-notes">

- `stats: dict[tuple[str, str], list[int]] = defaultdict(lambda: [0, 0, 0])` 键是(组, 原版或 DPO),值是 [张数, 总字数, 违规次数]。`lambda: [0, 0, 0]` 是一个没有名字的小函数,每次遇到新键就调用它造一个新列表,相当于 JS 的 `() => [0, 0, 0]`。
- `m = re.match(r"(R\d\d|N\d\d) (原版|DPO )\s+(\d+) 字  (.*)", line)` 正则从每行抠出四段:工单号、哪个版本、字数、违规列表。警告行匹配不上,`m` 是 None,跳过。
- `s[2] += 0 if failed == "ok" else failed.count("'") // 2` 违规列表打印出来像 `['no_policy_id', 'too_long']`,每个规则名有一对单引号,数引号再除以 2 就是违规条数。是个偷懒的办法,够用。

</div>

```bash
uv run python part10/regress_split.py part10/dpo-cpu/regress.txt
```

```text
全新的 N    DPO  4 张  平均 342 字  违规 8 次
全新的 N    原版   4 张  平均 246 字  违规 6 次
留出的 R04  DPO  1 张  平均 284 字  违规 2 次
留出的 R04  原版   1 张  平均 252 字  违规 2 次
训练过的 R   DPO  5 张  平均 261 字  违规 8 次
训练过的 R   原版   5 张  平均 205 字  违规 8 次
```

(中文在终端里占两格,列没有完全对齐。)全新的 4 张工单上,DPO 版平均长了 39%,违规从 6 次变 8 次,是三组里退化最明显的。训练用过的工单上也变长了,违规次数持平。这说明「写长」不是只在没见过的数据上才出现,它是模型从这批数据里学到的整体倾向。真实项目里回归检查一定要包含全新的数据,只在训练用过的工单上比,会低估问题。

</details>

4. **写一份结论**(开放题):假设你的经理问「DPO 那个实验怎么样了,能不能上线?」,用今天的数字写一段五六句话的回复。

<details><summary>参考答案</summary>

示范:

这次 DPO 实验不建议上线。训练流程已经跑通(Colab 脚本和本机复现都有),但数据只有 15 对,按工单留出的验证集上 `rewards/margins` 从 0 降到 -0.64,模型在没见过的工单上反而更偏向差回答,是过拟合。回归检查里,10 张工单的回复平均长了 31%(226 → 296 字),全新的 4 张长了 39%,规则违规从 16 次变 18 次,原因是偏好数据里好回答系统性更长。下一步:让 Qwen 自己采样草稿、攒到 300 对以上,按来源控制长度比,再训一次,同时补 30 对人工盲评。在那之前,「引用政策编号」这个问题先改提示词,预计成本更低、见效更快。

这段话里每个数字都能在今天的某一行输出里找到,这就是 Day 574 说的「结论里每一句都要能指到一个脚本的一行输出」。

</details>

验收标准:`dpo_cpu.py` 在你的机器上跑完 6 步,第 0 步 loss 是 0.693,训练集 `rewards/margins` 一路涨到 3 左右(具体数字和 CPU、库版本有关,不一定和我一字不差);`split_leak.py` 的两行和本文一致;`regress_check.py` 跑出 20 行加两行平均值;你能指着日志说出「训练集在涨、验证集在跌」是哪几个数,以及为什么验证集要按工单留出。今天没有调付费 API,花费 0 元;本机训练 407 秒,回归检查几分钟,练习 2 再加这两样各一次。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| TRL | Hugging Face 的训练库,`DPOTrainer`、`SFTTrainer`、`KTOTrainer` 都在里面,今天查到 1.16.0 |
| DPOTrainer / DPOConfig | TRL 里做 DPO 的训练器和它的配置,`beta`、`loss_type`、`max_length` 等都在 `DPOConfig` 里 |
| `disable_adapter()` | PEFT 模型临时关掉 LoRA 旁路的写法,关掉以后就是基座,DPO 用它当参考模型 |
| `precompute_ref_log_probs` | 开训前一次算好参考模型对所有回答的 logp,训练时不再加载参考模型 |
| `rewards/chosen`、`rewards/rejected` | 好、差回答的平均隐式奖励 |
| `rewards/margins` | 两者之差的平均,应该随训练变大 |
| `rewards/accuracies` | 好回答奖励严格大于差回答的比例,第 0 步是 0 |
| `logps/chosen`、`logps/rejected` | 训练中的模型给好、差回答的平均 logp,单看绝对值意义不大 |
| 按工单留出 | 同一张工单的所有偏好对要么全在训练集、要么全在验证集,防止共享回答造成泄漏 |
| 过拟合 | 训练集上越来越好、没见过的数据上越来越差 |
| 回归检查 | 训练后在同一批输入上对比前后的长度、规则、格式、通用能力,看有没有学坏 |
| 贪心解码 | 每一步取概率最大的 token,`do_sample=False`,相当于温度 0 |
| 人工盲评 | 把前后两个版本的输出打乱顺序给没参与训练的人看,问哪个更好 |

## 常见误区

**按对随机切验证集。** 偏好对之间共享回答,今天按对切的验证集 6 份回答里 5 份训练时见过,验证集 loss 0.283、准确率 100%,全是假象。按工单留出后验证集 margin 是负的。

**DPOConfig 的默认学习率直接拿来训 LoRA。** `DPOConfig` 的 `learning_rate` 默认 1e-6,是给全量微调的;TRL 文档提示 LoRA 要用 1e-5 量级。

**在 T4 上不改精度。** `DPOConfig` 默认开 bf16,T4 不支持;字符串传模型时不指定 dtype 会按 float32 加载,显存翻倍。两处都要显式写。

**只看训练集的 `rewards/accuracies`。** 今天训练集几步就到了 100%,验证集是 0%。训练集指标漂亮只说明模型记住了这几对。

**只看 loss 不看 `rewards/chosen`。** loss 在降、margin 在涨,好回答的奖励却可能一直往下掉(今天验证集上从 0 掉到 -1.73)。好回答越来越不受待见,模型的输出迟早会变怪,这时加一点 SFT 损失或调大 β。

**训完不做回归检查就上线。** 今天的模型日志里 margin 很好看,回复却平均长了 31%、违规更多了。

**以为 Intel Mac 也能装最新的 TRL。** PyTorch 最后一个有 Intel Mac 安装包的版本是 2.2.2,新版 transformers 和 TRL 都跑不起来。要么像今天这样手写一遍,要么去 Colab。

**偏好对用别的模型写的草稿。** 今天的草稿是 DeepSeek 写的,里面的「已为您提交」0.5B 根本不会说,这 4 对 `fake_action` 对它几乎没有用。DPO 的草稿要让被训练的模型自己采样。

## 学习资料

### 文档与文章

- [TRL · DPO Trainer](https://huggingface.co/docs/trl/main/dpo_trainer):今天的 Colab 脚本照这一页写。重点看「Logged metrics」一节(每个指标的定义)、「Train adapters with PEFT」一节(LoRA 时的参考模型和学习率提示)和 `DPOConfig` 参数表。
- [TRL · Reducing Memory Usage](https://huggingface.co/docs/trl/main/reducing_memory_usage):显存不够时怎么办,截断长度、预先算参考模型 logp 等办法都在这里。
- [PEFT · PeftModel](https://huggingface.co/docs/peft/main/en/package_reference/peft_model):`disable_adapter`、`from_pretrained` 挂适配器的官方说明。
- [huggingface_hub · 环境变量](https://huggingface.co/docs/huggingface_hub/main/en/package_reference/environment_variables):`HF_HUB_DISABLE_XET`、`HF_HUB_OFFLINE`、`HF_HOME` 的说明,下载模型出问题时查这里。
- [PyTorch · 历史版本](https://pytorch.org/get-started/previous-versions/):各版本的安装命令,能看到 Intel Mac 的支持停在了哪一版。
- [Hugging Face 博客 · Preference Tuning LLMs with Direct Preference Optimization Methods](https://huggingface.co/blog/pref-tuning):DPO、IPO、KTO 的对比实验,里面的训练曲线可以和今天的日志对照着看。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1m8FnzpEXm&autoplay=0&high_quality=1" title="【DPO】直接偏好优化 详细原理推导+快速上手实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>东川路第一可爱猫猫虫 · 【DPO】直接偏好优化 详细原理推导+快速上手实战 · 约 19 分钟,后半段是代码实战,可以和今天手写的 dpo_cpu.py 对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZAKWzFEyB&autoplay=0&high_quality=1" title="如何观测模型的微调过程?微调后的模型如何合并导出和部署?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>code秘密花园 · 如何观测模型的微调过程?微调后的模型如何合并导出和部署? · 约 21 分钟,讲训练过程中看哪些曲线、怎么判断过拟合,对应今天「读指标」一节,虽然演示的是 SFT,读曲线的方法通用。</figcaption>
</figure>

- 蓝斯诺特 · [基于TRL训练大预言模型,DPO,PPO方法](https://www.bilibili.com/video/BV1bu4y1w7Dz):约 10 分钟,2023 年的视频,TRL 的 API 已经变了不少,看思路别照抄参数名。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/E5kzAbD8D0w" title="Direct Preference Optimization (DPO)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Trelis Research · Direct Preference Optimization (DPO) · 从数据准备到用 TRL 训练、看训练曲线的完整演示。英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/o6l6tJQgUg4" title="Post-Training and RLHF Overview | Post-Training Book Course, Lecture 1" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Nathan Lambert · Post-Training and RLHF Overview · 《RLHF Book》作者的后训练课程第一讲,讲偏好优化在整个后训练里的位置,以及为什么评测比训练难。英文。</figcaption>
</figure>

### 书籍

- Nathan Lambert《Reinforcement Learning from Human Feedback》(Manning, 2026):直接对齐算法一章讲 DPO 的实现细节和常见失败模式,网页版 rlhfbook.com 免费。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 7 章讲微调,包括偏好微调和训练后怎么评估。

### 开源项目与代码

- [huggingface/trl](https://github.com/huggingface/trl):`trl/trainer/dpo_trainer.py` 里找算 `logps` 和 `rewards/*` 的地方,和今天的 `seq_logp`、`dpo_step` 一一对应。
- [unslothai/notebooks · Zephyr (7B) DPO](https://github.com/unslothai/notebooks/blob/main/nb/Zephyr_(7B)-DPO.ipynb):Unsloth 的 DPO 笔记本,想用 Unsloth 在 Colab 上加速可以参考,注意它会钉死 TRL 的版本(Day 572 讲过)。
- [Qwen/Qwen2.5-0.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct):今天本机用的模型,模型卡里有 chat template 和推荐的生成参数。

## 自测

1. 用 LoRA 跑 DPO 时,参考模型从哪来?为什么不用多占一份显存?

<details><summary>答案</summary>

参考模型就是关掉 LoRA 旁路的基座(PEFT 的 `disable_adapter()`)。基座权重训练时是冻结的,本来就在显存里,关掉旁路算一遍就是参考模型的输出,不需要另外加载一份。参考模型的 logp 训练中不变,还可以开训前一次算好存起来(`precompute_ref_log_probs`),今天的 `prepare` 就是这么做的。

</details>

2. 训练第 1 步日志里 `rewards/accuracies` 是 0,是不是说明数据有问题?

<details><summary>答案</summary>

不是。第 1 步的指标是在第一次更新之前算的,模型还等于参考模型,好坏两个隐式奖励都是 0,`accuracies` 数的是「严格大于」,相等不算,所以是 0。loss 同理是 0.693。从第 2 步开始才有意义。

</details>

3. 训练集 `rewards/accuracies` 很快到了 1.0,验证集 `rewards/margins` 却是负的,说明什么?你会先查什么?

<details><summary>答案</summary>

过拟合:模型记住了训练集的几对,没学到能推广的偏好。先查数据量和数据偏差(今天 12 对,而且好回答多数更长),再查验证集是不是和训练集出处不同(R04 的 `too_long` 对和训练集主流的方向相反)。如果验证集反而好得出奇,先查泄漏:是不是按对切的。

</details>

4. 为什么偏好数据的验证集要按工单留出,而 Day 570 的分诊数据按条随机切就可以?

<details><summary>答案</summary>

偏好对之间共享回答:同一张工单的一份草稿会出现在好几对里,有时是 chosen、有时是 rejected。按对随机切,验证集里的回答大多在训练集里原样出现过(今天 6 份里 5 份)。分诊数据经过指纹去重,每条记录是独立的一张工单,按条切不会共享内容。不过 Day 574 也说过,如果分诊数据出自同一批模板,按条切同样会有出处泄漏,原则是一样的:按「出处」切。

</details>

5. (面试题)你用 DPO 训了一版客服回复模型,训练日志很好看。上线前你会做哪些检查?

<details><summary>答案</summary>

先确认验证集按工单或客户留出,日志里看验证集的 `rewards/margins` 和 `accuracies` 有没有涨、`rewards/chosen` 有没有一路往下掉。然后做回归检查:同一批全新的工单分别用原版和新版生成,对比平均长度(涨 30% 以上要警惕长度偏差)、规则和事实检查(禁止承诺、引用政策、金额与工具结果一致)、格式合法率、一组和业务无关的通用问题;再抽至少 30 对做人工盲评。全部过关后,用运行时挂载灰度一部分流量,看线上的采纳率或客服修改率有没有改善,保留随时切回原版的开关。

</details>

## 明天预告

Day 577 · 蒸馏(一):三种蒸馏,规模化打标,学生选多大。这几天训练用的数据都是现成有标签的,真实项目里最缺的恰恰是标签。明天让一个强的大模型当老师,给一批没标注的工单打标签,三票一致才收,再拿标准答案给老师本身打分,看看老师会在哪里错;最后算清楚学生模型选 0.6B、1.7B 还是 4B 各要多少资源。
