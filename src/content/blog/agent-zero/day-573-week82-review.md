---
title: 'Day 573 · 第 82 周复习:进阶(Day 567–572)'
description: '这一周从「什么时候值得自部署」走到了在 Colab 上训练 LoRA。今天把六天串成一张图,逐天一句话回顾,再做一个只用本周知识的小项目:微调前体检脚本 preflight.py,一次打印显存、上线后的 KV cache、LoRA 参数量、样本长度、泄漏和训练步数。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'fine-tuning', 'self-hosting', 'python', 'agent-zero']
series: 'agent-zero'
day: 573
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 572](/blog/agent-zero/day-572-finetune-2/) 我们用 numpy 手写了 LoRA 的前向和训练,看到 rank 是 LoRA 的容量:目标改动秩为 4 时,r=1 卡在 2.44,r=4 降到 0;又从 `config.json` 数出 Qwen3-4B 挂 r=16 的 LoRA 要训练 33,030,144 个参数,和 Unsloth 笔记本打印的数对上了;最后写了一份在 Colab T4 上训练分诊 LoRA 的 8 个单元的笔记本。这一周六天的内容是一条线:先算清楚一张卡装得下什么、跑得多快,再造数据、再训练。今天停下来把这条线理一遍。

## 今天要解决的问题

学完今天你应该能做到:

1. 不看文章,说出这一周六天各解决了什么问题,以及它们之间谁依赖谁。
2. 写出一个「微调前体检」脚本 `preflight.py`,只用本周学过的函数,把显存、上线后能放多少 KV cache、LoRA 参数量、样本长度、训练集泄漏、训练步数一次打印出来,并给出「能不能开训」的结论。
3. 默写本周三个核心公式对应的代码:KV cache 每 token 字节数、LoRA 参数量、LoRA 前向,跑出和文章一致的数字。

预计用时 3.5 小时(复习日可以长一点)。前置:[Day 567](/blog/agent-zero/day-567-self-host-1/) 到 [Day 572](/blog/agent-zero/day-572-finetune-2/) 全部。今天不调 API,花费 0 元,不需要 GPU。用到的文件全是这一周建的:`part10/qwen3/config.json` 和 `tokenizer_config.json`(Day 571、572 下载的)、`part10/out/triage_train.jsonl` 和 `triage_val.jsonl`(Day 570 生成的)、`part10/data/tickets_v1.jsonl`(Day 570)、`build_sft_data.py`(Day 570)、`qwen3_params.py`(Day 572)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`recall_week82.py` 里的三个函数);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="第 82 周知识地图:自部署三天和微调三天的依赖关系">
<text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">自部署:一张卡装得下什么、跑多快</text>
<rect x="20" y="36" width="180" height="62" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">567 显存账</text>
<text x="110" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">权重 + KV cache</text>
<text x="110" y="91" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">每 token 144 KB</text>
<rect x="230" y="36" width="180" height="62" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">568 vLLM 上线</text>
<text x="320" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">Colab T4 / 云 GPU</text>
<text x="320" y="91" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">OpenAI 兼容端点</text>
<rect x="440" y="36" width="180" height="62" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="530" y="58" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">569 压测和量化</text>
<text x="530" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">TTFT/TPOT/工作点</text>
<text x="530" y="91" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">8 位 / 4 位</text>
<line x1="200" y1="67" x2="230" y2="67" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="410" y1="67" x2="440" y2="67" stroke="var(--rule)" stroke-width="1.5"/>
<text x="20" y="150" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">微调:小模型够不够用,数据怎么造,怎么训</text>
<rect x="20" y="162" width="180" height="62" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="184" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">570 该不该微调</text>
<text x="110" y="202" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">提示词 → RAG → 微调</text>
<text x="110" y="217" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">造训练集 297 条</text>
<rect x="230" y="162" width="180" height="62" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="184" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">571 工具调用数据</text>
<text x="320" y="202" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">chat template</text>
<text x="320" y="217" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">清洗 + MinHash</text>
<rect x="440" y="162" width="180" height="62" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="530" y="184" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">572 LoRA 训练</text>
<text x="530" y="202" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">rank 是容量</text>
<text x="530" y="217" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">QLoRA 塞进 T4</text>
<line x1="200" y1="193" x2="230" y2="193" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="410" y1="193" x2="440" y2="193" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="530" y1="98" x2="530" y2="162" stroke="var(--rule)" stroke-width="1.5" stroke-dasharray="4 3"/>
<text x="538" y="135" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">量化 → QLoRA</text>
<line x1="110" y1="98" x2="110" y2="162" stroke="var(--rule)" stroke-width="1.5" stroke-dasharray="4 3"/>
<text x="118" y="135" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">产能算出成本 → 值不值得</text>
<rect x="130" y="250" width="380" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="268" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">今天的 preflight.py:把六天的账一次算完</text>
<text x="320" y="283" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">Day 574 再把训好的 LoRA 挂回 568 的 vLLM 对比</text>
<line x1="320" y1="224" x2="320" y2="250" stroke="var(--rule)" stroke-width="1.5"/>
</svg>
<figcaption>上面一排是推理侧(琥珀色,外部系统:卡和服务),下面一排是训练侧(蓝色,模型本身)。两条虚线是这周最容易忽略的连接:569 的量化就是 572 QLoRA 的前半截;569 压测出来的产能决定了 570 那个「值不值得微调」的问题怎么答。</figcaption>
</figure>

## 每天一句话

- [Day 567 · 自部署(一):什么时候值得,显存账](/blog/agent-zero/day-567-self-host-1/):自部署值不值,先算账;一张卡的显存被权重和 **KV cache**(推理时为每个 token 缓存的注意力键和值)分掉,Qwen3-4B 每个 token 的 KV 是 2 × 36 层 × 8 个 KV 头 × 128 维 × 2 字节 = 147,456 字节,也就是 144 KB。
- [Day 568 · 自部署(二):Colab T4 和云 GPU 两条路线](/blog/agent-zero/day-568-self-host-2/):用 vLLM 把模型起成一个 OpenAI 兼容的端点 `http://localhost:8000/v1`,T4 不支持 bf16 要用 fp16,起来以后用 OpenAI SDK 调,和调 DeepSeek 只差 `base_url` 和 `model`。
- [Day 569 · 自部署(三):压测和量化](/blog/agent-zero/day-569-self-host-3/):TTFT 是首 token 延迟、TPOT 是每个输出 token 的间隔,并发上去以后吞吐涨、延迟也涨,按 SLO 选工作点;量化用精度换显存,分组量化误差小得多。
- [Day 570 · 微调(一):提示词、RAG、微调各管什么,造训练集](/blog/agent-zero/day-570-finetune-1/):先证明提示词做到了哪(`category` 12/12,`urgency` 只有 6/12),剩下的口径问题才交给微调;`build_sft_data.py` 把 502 条原始记录洗成 297 条训练、32 条验证,丢掉坏标签、重复和混进来的评测题。
- [Day 571 · 微调(二):工具调用的训练数据格式、chat template 和清洗](/blog/agent-zero/day-571-finetune-tools/):模型读的是 chat template 渲染出来的文字,样本存结构化的 messages 加 tools 交给模板渲染;Qwen3 的工具调用是 Hermes 风格的 `<tool_call>`,vLLM 要配 `--tool-call-parser hermes`。
- [Day 572 · 微调(三):LoRA 原理,Unsloth 在 Colab 上训练](/blog/agent-zero/day-572-finetune-2/):LoRA 冻结 W,只训练旁边的 B @ A,B 初始为 0;rank 决定能学多少;全量微调 4B 约 60 GB,QLoRA 约 2.9 GB,T4 放得下。

这六天里有两个概念被反复用到,值得单独拎出来。一个是**显存账**:567 算推理、569 算量化、572 算训练,三次用的是同一套「参数个数 × 每个数几个字节」的乘法,只是乘的东西不一样。另一个是**训练和推理必须一致**:570 要求 system 说明一字不差,571 要求 chat template 一样、parser 对上,572 要求只对 assistant 段算损失、而推理时 assistant 段正好是模型要写的部分。下周你会看到,Day 574 的对比里出了问题,多半就是这两条里的某一条没守住。

## 小项目:微调前体检 preflight.py

### 要做什么

假设你明天就要去 Colab 开训,开训之前想花一分钟确认几件事:这张卡放不放得下;训完以后挂到同一张卡上推理,还剩多少地方给 KV cache;LoRA 会有多大;样本会不会超过 `max_seq_length` 被截断;训练集里有没有混进评测题;一共要训多少步。这些问题这一周每天回答了一个,散在六个脚本里。今天把它们拼成一个。

要求:

1. 命令行三个参数:模型目录(里面有 `config.json` 和 `tokenizer_config.json`)、训练数据目录(里面有 `triage_train.jsonl` 和 `triage_val.jsonl`)、评测集路径。
2. 只复用本周的函数:Day 570 `build_sft_data.py` 的 `fingerprint`、`load_eval_blacklist`,Day 572 `qwen3_params.py` 的 `base_params`、`lora_params`;KV cache 的公式按 Day 567 自己写;样本长度用 Day 571 的 Jinja2 沙箱渲染以后量。
3. 有问题就收集成一个列表,最后一行打印「可以开训」或「先处理:……」。
4. 正常数据跑出「可以开训」;往训练集拷贝里塞一条评测题,跑出「先处理:train∩eval = 1」。

先自己写,写不出再看下面的参考答案。提示:先写 `kv_bytes_per_token` 和读文件的两个小函数,再一段一段往 `main` 里加,每加一段跑一次。

<details><summary>参考答案</summary>

新建 `part10/preflight.py`:

```python
# agent-zero-lab/part10/preflight.py
"""微调前体检:读模型 config 和训练集,一次打印显存、上线后的 KV cache、LoRA 参数量、样本长度、泄漏和训练步数。
用法:uv run python part10/preflight.py part10/qwen3 part10/out part10/data/tickets_v1.jsonl
"""
import json
import math
import sys
from pathlib import Path

from jinja2.sandbox import ImmutableSandboxedEnvironment

from build_sft_data import fingerprint, load_eval_blacklist
from qwen3_params import base_params, lora_params

GB = 1024 ** 3
R, BATCH, ACCUM, EPOCHS, MAX_LEN, GPU_GB = 16, 2, 4, 2, 1024, 15


def kv_bytes_per_token(cfg: dict, bytes_per_num: int = 2) -> int:
    return 2 * cfg["num_hidden_layers"] * cfg["num_key_value_heads"] * cfg["head_dim"] * bytes_per_num


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


def main(model_dir: str, data_dir: str, eval_path: str) -> None:
    cfg = json.load(open(Path(model_dir) / "config.json", encoding="utf-8"))
    tpl = json.load(open(Path(model_dir) / "tokenizer_config.json", encoding="utf-8"))["chat_template"]
    n, n_lora = base_params(cfg), lora_params(cfg, R)
    warn: list[str] = []

    print("== 显存(Day 567、569、572)")
    n_embed = cfg["vocab_size"] * cfg["hidden_size"]
    w4 = ((n - n_embed) * 0.5 + n_embed * 2) / GB
    print(f"权重 16 位 {n * 2 / GB:.1f} GB,4 位(词表留 16 位)约 {w4:.1f} GB")
    kv = kv_bytes_per_token(cfg)
    free = GPU_GB * 0.9 - n * 2 / GB - 1.5
    print(f"上线后 KV cache 每 token {kv // 1024} KB;{GPU_GB} GB 卡 16 位部署剩 {free:.1f} GB,"
          f"约 {free * GB / kv:,.0f} token,够 {free * GB / kv / MAX_LEN:.0f} 个 {MAX_LEN} token 的请求同时跑")
    print(f"LoRA r={R}:{n_lora:,} 参数,适配器约 {n_lora * 2 / 1024 ** 2:.0f} MB")

    print("== 数据(Day 570、571)")
    train = load_jsonl(Path(data_dir) / "triage_train.jsonl")
    val = load_jsonl(Path(data_dir) / "triage_val.jsonl")
    env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True)
    env.filters["tojson"] = lambda x, **kw: json.dumps(x, ensure_ascii=False)
    template = env.from_string(tpl)
    lengths = sorted(len(template.render(messages=s["messages"], add_generation_prompt=False)) for s in train)
    print(f"train {len(train)} 条,val {len(val)} 条")
    print(f"渲染后字符数 中位 {lengths[len(lengths) // 2]},最长 {lengths[-1]}(上限 {MAX_LEN} token)")
    if lengths[-1] > MAX_LEN:
        warn.append("有样本渲染后超过 max_seq_length,会被截断")

    def fp(s: dict) -> str:
        user = s["messages"][1]["content"]
        subject, body = user.removeprefix("主题:").split("\n正文:", 1)
        return fingerprint(subject, body)

    evals = load_eval_blacklist(Path(eval_path))
    tr, va = [fp(s) for s in train], [fp(s) for s in val]
    leaks = {"train∩eval": len(set(tr) & evals), "val∩eval": len(set(va) & evals),
             "train∩val": len(set(tr) & set(va)), "train 内部重复": len(tr) - len(set(tr))}
    print("泄漏检查:", leaks)
    warn += [f"{k} = {v}" for k, v in leaks.items() if v]
    bad_end = sum(s["messages"][-1]["role"] != "assistant" for s in train)
    if bad_end:
        warn.append(f"{bad_end} 条样本最后一条不是 assistant")

    print("== 训练(Day 572)")
    steps = math.ceil(len(train) / (BATCH * ACCUM)) * EPOCHS
    print(f"每步 {BATCH * ACCUM} 条,{EPOCHS} 个 epoch 共 {steps} 步")
    need = w4 + n_lora * 16 / GB
    print(f"QLoRA 粗估(不含激活值)约 {need:.1f} GB / {GPU_GB} GB")

    print("== 结论:", "可以开训" if not warn else "先处理:" + ";".join(warn))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
```

<div class="line-notes">

- `from jinja2.sandbox import ImmutableSandboxedEnvironment` Day 571 渲染 chat template 用的沙箱环境。
- `from build_sft_data import fingerprint, load_eval_blacklist` Day 570 的指纹函数。指纹算法必须和造训练集时一模一样,所以导入,不复制。
- `from qwen3_params import base_params, lora_params` Day 572 的两个计数函数,`qwen3_params.py` 把打印放在 `if __name__` 里,导入不会刷屏。
- `R, BATCH, ACCUM, EPOCHS, MAX_LEN, GPU_GB = 16, 2, 4, 2, 1024, 15` 和 Day 572 Colab 单元 2、单元 4 的配置一致。写成常量放在顶上,想试别的配置只改这一行。
- `return 2 * cfg["num_hidden_layers"] * cfg["num_key_value_heads"] * cfg["head_dim"] * bytes_per_num` Day 567 的公式:K 和 V 两份 × 层数 × KV 头数 × 每头维度 × 每个数的字节数。Qwen3-4B 是 2 × 36 × 8 × 128 × 2 = 147,456。
- `def load_jsonl(path: Path) -> list[dict]:` 读 JSONL 并跳过空行,Day 570 的空行坑在这里一次性处理掉。
- `tpl = json.load(open(Path(model_dir) / "tokenizer_config.json", encoding="utf-8"))["chat_template"]` Day 571 下载的那个 9 KB 文件里的模板字符串。
- `warn: list[str] = []` 所有问题先攒着,最后一起报。和 Day 570 `build_sft_data.py` 用 `Counter` 记账是一个思路:脚本跑完再看全貌,不在第一个问题上就退出。
- `w4 = ((n - n_embed) * 0.5 + n_embed * 2) / GB` 和 Day 572 `ft_memory.py` 里 QLoRA 那一行同一个算法:线性层 4 位(0.5 字节),词表保留 16 位。
- `print(f"权重 16 位 {n * 2 / GB:.1f} GB,4 位(词表留 16 位)约 {w4:.1f} GB")` 输出 7.5 GB。之前几天说「约 8 GB」,是按 1 GB = 10⁹ 字节粗算的(4.02 × 10⁹ × 2 ≈ 8.0 × 10⁹);这里按 1024³ 算是 7.5。两种说法都对,看清单位。
- `free = GPU_GB * 0.9 - n * 2 / GB - 1.5` 上线后的账:vLLM 默认用卡的 90% 显存,减掉 16 位权重,再留 1.5 GB 给运行时开销(经验值,不同版本不一样),剩下的给 KV cache。这一行回答的是「训完挂到同一张 T4 上推理还剩多少地方」。
- `f"约 {free * GB / kv:,.0f} token,够 {free * GB / kv / MAX_LEN:.0f} 个 {MAX_LEN} token 的请求同时跑")` 4.5 GB ÷ 144 KB ≈ 3.3 万个 token,每个请求按 1024 token 算能同时放 32 个。分诊请求只有一百多 token,实际能放的远不止这些。
- `print(f"LoRA r={R}:{n_lora:,} 参数,适配器约 {n_lora * 2 / 1024 ** 2:.0f} MB")` 每个参数 16 位 2 字节,3,303 万个约 63 MB。
- `env.filters["tojson"] = lambda x, **kw: json.dumps(x, ensure_ascii=False)` Day 571 的坑:不覆盖 tojson,中文会被转义、长度就量错了。
- `lengths = sorted(len(template.render(messages=s["messages"], add_generation_prompt=False)) for s in train)` 每条样本渲染成训练文本以后的字符数,排好序。没有 Qwen 的分词器,用字符数近似:中文基本一个字最多一个 token,英文和 JSON 符号往往几个字符一个 token,所以字符数是 token 数的一个偏大的上界,用它和 `MAX_LEN` 比是保守的。
- `print(f"渲染后字符数 中位 {lengths[len(lengths) // 2]},最长 {lengths[-1]}(上限 {MAX_LEN} token)")` 排序后取正中间那个是中位数,最后一个是最长。
- `def fp(s: dict) -> str:` 函数里面定义函数,只在 `main` 里用。把 messages 里的 user 内容拆回主题和正文,和 Day 570 `check_leak.py` 的拆法一样。
- `leaks = {"train∩eval": len(set(tr) & evals), "val∩eval": len(set(va) & evals),` 集合交集([Day 25](/blog/agent-zero/day-025-sets/)),四个数都应该是 0。
- `warn += [f"{k} = {v}" for k, v in leaks.items() if v]` 不是 0 的才进警告。`if v` 里 0 是假值,和 JS 一样。
- `bad_end = sum(s["messages"][-1]["role"] != "assistant" for s in train)` Day 571 的检查之一:每条样本必须以 assistant 收尾,否则模型学不会「说完就停」。
- `steps = math.ceil(len(train) / (BATCH * ACCUM)) * EPOCHS` Day 572 练习 3 的算法,297 条得 76 步。
- `need = w4 + n_lora * 16 / GB` 训练时的显存:4 位基座加 LoRA 的全套账。训练时不用 KV cache(训练日志里会打印一行 `Setting use_cache=False` 的提示),但有激活值,这里没算。
- `print("== 结论:", "可以开训" if not warn else "先处理:" + ";".join(warn))` 空列表是假值,`not warn` 为真就是没问题。

</div>

```bash
cd agent-zero-lab
uv run python part10/preflight.py part10/qwen3 part10/out part10/data/tickets_v1.jsonl
```

```text
== 显存(Day 567、569、572)
权重 16 位 7.5 GB,4 位(词表留 16 位)约 2.4 GB
上线后 KV cache 每 token 144 KB;15 GB 卡 16 位部署剩 4.5 GB,约 32,823 token,够 32 个 1024 token 的请求同时跑
LoRA r=16:33,030,144 参数,适配器约 63 MB
== 数据(Day 570、571)
train 297 条,val 32 条
渲染后字符数 中位 433,最长 456(上限 1024 token)
泄漏检查: {'train∩eval': 0, 'val∩eval': 0, 'train∩val': 0, 'train 内部重复': 0}
== 训练(Day 572)
每步 8 条,2 个 epoch 共 76 步
QLoRA 粗估(不含激活值)约 2.9 GB / 15 GB
== 结论: 可以开训
```

再做一份塞了评测题的拷贝([Day 570](/blog/agent-zero/day-570-finetune-1/) 练习 2 做过一模一样的事,做过的话 `part10/out_leak/` 已经在了,跳过这一段):

```bash
mkdir -p part10/out_leak && cp part10/out/*.jsonl part10/out_leak/
uv run python -c "
import json
c = json.loads(open('part10/data/tickets_v1.jsonl', encoding='utf-8').readline())
msg = {'messages': [{'role': 'system', 'content': 'x'}, {'role': 'user', 'content': f\"主题:{c['subject']}\n正文:{c['body']}\"}, {'role': 'assistant', 'content': '{}'}]}
open('part10/out_leak/triage_train.jsonl', 'a', encoding='utf-8').write(json.dumps(msg, ensure_ascii=False) + '\n')
"
uv run python part10/preflight.py part10/qwen3 part10/out_leak part10/data/tickets_v1.jsonl | tail -6
```

```text
渲染后字符数 中位 433,最长 456(上限 1024 token)
泄漏检查: {'train∩eval': 1, 'val∩eval': 0, 'train∩val': 0, 'train 内部重复': 0}
== 训练(Day 572)
每步 8 条,2 个 epoch 共 76 步
QLoRA 粗估(不含激活值)约 2.9 GB / 15 GB
== 结论: 先处理:train∩eval = 1
```

塞进去的那条评测题被抓到了,结论变成「先处理」。注意 `train` 变成了 298 条,步数还是 76,因为 298 ÷ 8 向上取整仍是 38。

</details>

### 读输出

几个数值得多看一眼。

**7.5 GB 和「8 GB」。** 前几天一直说 4B 模型权重约 8 GB,这里打印 7.5。差别只是单位:4,022,468,096 × 2 字节 ≈ 8.04 × 10⁹ 字节,按十进制是 8 GB,按 1024³ 是 7.5 GiB。显卡厂商标显存、云厂商报价一般按十进制,`nvidia-smi` 和 PyTorch 打印的是按 1024 算的。对账时别在这上面纠结半天。

**上线后只剩 4.5 GB 给 KV cache。** 同一张 T4,训练时 4 位基座加 LoRA 只占 2.9 GB,很宽裕;推理时如果用 16 位基座挂 LoRA,权重就吃掉一半,剩下的够 3.3 万个 token。分诊请求一个才一百多 token,够用;但如果你训的是工具调用,每个请求光工具定义就上千 token(Day 571 讲过),并发就上不去了。训练和部署的显存账是两本账,开训之前两本都要算。

**最长 456 个字符,离 1024 很远。** 分诊样本都很短,`max_seq_length=1024` 有富余。换成工具调用样本,这一行的数字会大好几倍,那时候就要回头调 Day 572 单元 2 的 `max_seq_length`,以及 Day 572 练习 4 说的 batch。

**泄漏四个 0。** Day 570 的流水线保证了这一点,但流水线改过以后不一定还成立。这个体检脚本的价值就是不管训练集是怎么来的,开训前独立再查一遍。

### 零件和大代码的对照

| 零件 | 哪天学的 | preflight.py 里的位置 |
| --- | --- | --- |
| KV cache 公式 | Day 567 | `kv_bytes_per_token` |
| 部署时显存剩多少 | Day 567、568 | `free = GPU_GB * 0.9 - ...` |
| 4 位权重 | Day 569、572 | `w4` |
| 参数计数 | Day 572 | `base_params`、`lora_params` |
| 空行跳过 | Day 570 | `load_jsonl` |
| 指纹 + 集合交集 | Day 570 | `fp`、`leaks` |
| chat template 渲染、覆盖 tojson | Day 571 | `env`、`template.render` |
| 以 assistant 收尾 | Day 571 | `bad_end` |
| 训练步数 | Day 572 练习 3 | `steps` |

## 本周错题与坑清单

这一周踩过的坑,按「会不会报错」分成两类。会报错的好办,看见报错就知道;**不报错的才危险**,这一周多数坑是后一类。

会报错的:

- **JSONL 末尾的空行**:`json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)`。读每一行前 `if not line.strip(): continue`(Day 570)。
- **学习率太大**:numpy 打 `RuntimeWarning: overflow encountered in matmul`,loss 变成 `nan`(Day 572)。真实训练里先降学习率、加预热。
- **样本太少算分位数**:Day 569 压测时请求数太少,P95 之类的分位数算不出来或者没意义。压测要发够多的请求。
- **T4 上用 bf16 或 FP8**:T4 是 Turing 架构,不支持 bf16 和 FP8 硬件加速,vLLM 要 `--dtype half`,量化版选 AWQ/GPTQ 这类 4 位格式(Day 568、569)。

不报错的:

- **温度 0 也会抖**:同一份 12 条评测集跑两次,`needs_human` 一次 10/12 一次 9/12(Day 570)。小评测集差一条就是 8 个百分点,别拿一次结果下结论。
- **评测题混进训练集**:只差空格和标点,直接比字符串查不出来,要规范化以后算指纹(Day 570)。
- **合成数据多样性不够**:第一版生成脚本模板太少,去重砍掉一半多(Day 570)。
- **Jinja2 自带的 tojson**:中文被转成 `\uXXXX`、键被排序,渲染结果和 transformers 的不一样(Day 571)。
- **没开 trim_blocks 和 lstrip_blocks**:多出一堆空行(Day 571)。
- **parser 没配对**:模型输出的 `<tool_call>` 是对的,接口返回的 `tool_calls` 却是空的(Day 571)。
- **短问题上用 MinHash**:被发票号带偏,真重复认不出、不同问题反而像(Day 571)。
- **模块顶层写副作用**:别的脚本一 import 就重写了数据文件(Day 571)。
- **A 和 B 都初始化为 0**:loss 一动不动,不报错(Day 572)。
- **改了 r 不改 alpha**:等于偷偷改了学习率(Day 572)。
- **模板或遮罩错了**:训练照样跑完、loss 照样降,上线才发现答非所问。开训前打印检查 ①、②(Day 572)。
- **随手升级 Unsloth 笔记本的依赖**:补丁对不上,可能报错也可能悄悄失效(Day 572)。

这张清单本身就是复习材料:合上文章,每一条你能不能说出「是什么现象、为什么、怎么修」。说不出的那几条,回到对应那天重看。

## 动手练习

1. **默写三个公式**:合上文章,新建 `part10/recall_week82.py`,写出三个函数:`kv_bytes(layers, kv_heads, head_dim, bytes_per_num=2)`、`lora_count(shapes, r, layers)`(`shapes` 是 7 个 `(输入, 输出)` 元组的列表)、`lora_forward(W, A, B, x, alpha)`。用 Qwen3-4B 的 config 算出 KV 每 token 字节数、r=16 和 r=8 的 LoRA 参数量,并验证 B 全 0 时 `lora_forward` 和 `W @ x` 一样。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/recall_week82.py
"""默写:KV cache 每 token 字节数、LoRA 参数量、LoRA 前向。写完和 preflight.py 的结果对一下。"""
import json

import numpy as np


def kv_bytes(layers: int, kv_heads: int, head_dim: int, bytes_per_num: int = 2) -> int:
    return 2 * layers * kv_heads * head_dim * bytes_per_num


def lora_count(shapes: list[tuple[int, int]], r: int, layers: int) -> int:
    return sum(r * (k + d) for k, d in shapes) * layers


def lora_forward(W: np.ndarray, A: np.ndarray, B: np.ndarray, x: np.ndarray, alpha: float) -> np.ndarray:
    r = A.shape[0]
    return W @ x + (alpha / r) * (B @ (A @ x))


cfg = json.load(open("part10/qwen3/config.json", encoding="utf-8"))
h, inter = cfg["hidden_size"], cfg["intermediate_size"]
q, kv = cfg["num_attention_heads"] * cfg["head_dim"], cfg["num_key_value_heads"] * cfg["head_dim"]
shapes = [(h, q), (h, kv), (h, kv), (q, h), (h, inter), (h, inter), (inter, h)]
print("KV 每 token:", kv_bytes(cfg["num_hidden_layers"], cfg["num_key_value_heads"], cfg["head_dim"]))
print("LoRA r=16:", f"{lora_count(shapes, 16, cfg['num_hidden_layers']):,}")
print("LoRA r=8: ", f"{lora_count(shapes, 8, cfg['num_hidden_layers']):,}")
rng = np.random.default_rng(0)
W, A, B, x = rng.normal(size=(6, 8)), rng.normal(size=(2, 8)), np.zeros((6, 2)), rng.normal(size=8)
print("B=0 时和原模型一样:", np.array_equal(lora_forward(W, A, B, x, 2), W @ x))
```

<div class="line-notes">

- `return 2 * layers * kv_heads * head_dim * bytes_per_num` 开头的 2 是 K 和 V 各一份。最常见的默写错误是把 `kv_heads` 写成注意力头数 32,结果大 4 倍。
- `return sum(r * (k + d) for k, d in shapes) * layers` 每个线性层 A 是 r × k、B 是 d × r,合计 r × (k + d)。
- `r = A.shape[0]` `.shape` 是数组的形状元组,A 是 r × k,第 0 个就是 r。不用单独传 r,少一个出错的地方。
- `return W @ x + (alpha / r) * (B @ (A @ x))` 本周最该背下来的一行。
- `shapes = [(h, q), (h, kv), (h, kv), (q, h), (h, inter), (h, inter), (inter, h)]` 顺序是 q、k、v、o、gate、up、down。o_proj 和 down_proj 方向是反的,这两处最容易写反;不过 `k + d` 是加法,写反了数也一样,这道题查不出来,形状写反在真实代码里会报矩阵乘法维度不匹配。
- `print("B=0 时和原模型一样:", np.array_equal(lora_forward(W, A, B, x, 2), W @ x))` 应该是 True。

</div>

```bash
uv run python part10/recall_week82.py
```

```text
KV 每 token: 147456
LoRA r=16: 33,030,144
LoRA r=8:  16,515,072
B=0 时和原模型一样: True
```

三个数和 `preflight.py`、`qwen3_params.py` 的一致。r 减半,LoRA 参数正好减半,因为参数量和 r 成正比。

</details>

2. **体检加一项:类别分布**:Day 570 在整理训练集时警告过 api 和 other 少于 30 条。给 `preflight.py` 加一项检查,统计**训练集**(不是切分前)里每个类别的条数,少于 30 的进警告。复制成 `part10/preflight_v2.py` 再改。

<details><summary>参考答案</summary>

文件头加 `from collections import Counter`,在 `bad_end = sum(` 那一行前面插入:

```python
    cats = Counter(json.loads(s["messages"][-1]["content"])["category"] for s in train)
    print("类别分布:", dict(cats.most_common()))
    small = [c for c, k in cats.items() if k < 30]
    if small:
        warn.append(f"这些类别少于 30 条:{small}")
```

<div class="line-notes">

- `cats = Counter(json.loads(s["messages"][-1]["content"])["category"] for s in train)` 最后一条消息是 assistant 的回答,内容是一段 JSON 字符串,解析出来取 category。
- `print("类别分布:", dict(cats.most_common()))` `most_common()` 按条数从多到少排。
- `small = [c for c, k in cats.items() if k < 30]` 少于 30 条的类别。

</div>

```bash
uv run python part10/preflight_v2.py part10/qwen3 part10/out part10/data/tickets_v1.jsonl | tail -1
```

```text
== 结论: 先处理:这些类别少于 30 条:['plan_change', 'other', 'api']
```

中间那行类别分布是 `{'technical': 55, 'refund': 55, 'billing': 54, 'invoice': 44, 'account': 35, 'plan_change': 26, 'other': 18, 'api': 10}`。比 Day 570 的警告多了一个 `plan_change`:Day 570 是在切验证集**之前**统计的,plan_change 当时正好 30 条;切掉 10% 给验证集以后,训练集里只剩 26 条。哪一步统计、统计的是哪份数据,结论会不一样。体检要查的是真正喂给模型的那份。

</details>

3. **换个模型算 KV**:Qwen3-30B-A3B-Instruct-2507 有 48 层、4 个 KV 头、每头 128 维。用练习 1 的 `kv_bytes` 算它每个 token 的 KV cache,和 Qwen3-4B 比,解释为什么总参数大了 7 倍多,KV 反而更小。

<details><summary>参考答案</summary>

```bash
uv run python -c "print(2*48*4*128*2, 2*48*4*128*2//1024)"
```

```text
98304 96
```

每 token 96 KB,比 4B 的 144 KB 还小。KV cache 只和层数、KV 头数、每头维度有关,和总参数量没有直接关系。30B-A3B 是 MoE(混合专家)模型,多出来的参数主要在 MLP 里的一堆「专家」上,每个 token 只用其中几个,而 KV 头数只有 4 个。所以它对显存的要求是「权重很大、KV 很小」,和 4B 正好相反:权重要放得下(FP8 约 31 GB),但放下以后能同时服务的 token 数不少。

</details>

4. **给 Day 574 做个计划**(开放题):你训好了分诊 LoRA,明天要把它挂到 vLLM 上和原版、和 DeepSeek 比。只用本周学的知识,列出你要比哪几列,每一列为什么要比。

<details><summary>参考答案</summary>

示范解法:①每个字段的准确率(Day 570:`category` 本来就满分,要看的是 `urgency`、`needs_account_data` 这些口径字段有没有涨);②JSON 合法率(微调版不该再需要 `response_format` 兜底);③P50 延迟(Day 569 的 TTFT 和 TPOT,小模型自部署应该快);④每张工单的成本(DeepSeek 按 token 算,自部署按 Day 569 的工作点和卡费摊);⑤原版 Qwen3-4B 作为对照,证明提升来自 LoRA 而不是换了个模型。另外要补一份「换了说法」的评测集,因为 Day 570 的评测集和训练集出自同一套模板。这道题没有代码要跑,明天正文就是按这张单子做的,你可以对照看看漏了哪项。

</details>

验收标准:`preflight.py` 对正常数据输出「可以开训」,对塞了评测题的拷贝输出「先处理:train∩eval = 1」;`recall_week82.py` 合上文章能默写出来并跑出 147456、33,030,144、16,515,072、True;错题清单里每一条能说出现象和修法。今天花费 0 元。

## 名词解释

这一周的术语前几天都解释过,这里只列今天第一次出现或今天换了说法的。

| 名词 | 意思 |
| --- | --- |
| 体检脚本(preflight) | 开训之前一次性检查资源和数据的脚本,有问题先报再开训 |
| GiB | 按 1024³ 字节算的 GB。4B 模型 16 位权重是 8.0 GB(十进制)或 7.5 GiB |
| 训练显存 / 部署显存 | 两本账:训练时 4 位基座 + LoRA + 激活值;部署时权重 + KV cache |
| 中位数 | 排好序取正中间那个,今天样本渲染后字符数的中位数是 433 |
| MoE(混合专家) | MLP 里放很多个「专家」,每个 token 只用其中几个;总参数大,KV 不一定大 |

## 常见误区

**以为复习日就是重看一遍。** 重看会产生「我都懂」的错觉。合上文章默写 `recall_week82.py`,写不出来的那一行才是你真正没掌握的。

**只算训练的显存,不算部署的。** 训练时 QLoRA 只要 2.9 GB,部署时 16 位权重就要 7.5 GiB,同一张 T4 剩给 KV cache 的只有 4.5 GB。工具调用这种长提示的任务,训得动不代表部署后并发够用。

**在切分前统计类别分布。** Day 570 的警告漏了 plan_change,因为切走验证集后它只剩 26 条。检查要针对真正喂给模型的那份文件。

**用字符数当 token 数还以为是精确的。** 今天体检用的是字符数,对中文是一个偏大的上界,拿来判断「会不会超长」是保守的、够用;要算训练用了多少 token、花多少钱,得用目标模型自己的分词器数。

**把 KV cache 算进训练显存。** 训练时模型不做逐个 token 的生成,不用 KV cache(Unsloth 会关掉 `use_cache`),占显存的是激活值。KV cache 是部署那本账里的。

**觉得体检通过就万事大吉。** 体检只能查格式、数量、泄漏这些机械的东西,查不出「这条工单其实是退款却被标成账单」。Day 570 说的抽十几条人工读一读,体检之后还是要做。

## 学习资料

### 文档与文章

- [vLLM · LoRA Adapters](https://docs.vllm.ai/en/latest/features/lora.html):明天要用的文档,先扫一眼 `--enable-lora` 和 `--lora-modules` 两个参数。
- [Unsloth · Fine-tuning LLMs Guide](https://unsloth.ai/docs/get-started/fine-tuning-llms-guide):Unsloth 的微调总览,把这一周的「选模型、造数据、训练、保存」串了一遍,适合复习时对照。
- [Thinking Machines · LoRA Without Regret](https://thinkingmachines.ai/blog/lora/):Day 572 超参数那一节的来源,复习时重读一遍结论部分。
- [LIMA: Less Is More for Alignment](https://arxiv.org/abs/2305.11206):Day 570 的「多少数据才够」,复习时读摘要。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kx4y1x7bu&autoplay=0&high_quality=1" title="怎么加快大模型推理?10分钟学懂VLLM内部原理,KV Cache,PageAttention" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>RethinkFun · 怎么加快大模型推理?10分钟学懂VLLM内部原理,KV Cache,PageAttention · 约 12 分钟,复习 Day 567、568 的显存账和 vLLM 为什么快。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1PLhw6fEaB&autoplay=0&high_quality=1" title="为什么LoRA能省下训练资源?一个宝藏比喻讲透低秩适配" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术Flow · 为什么LoRA能省下训练资源?一个宝藏比喻讲透低秩适配 · 约 26 分钟,换一个角度讲 Day 572 的低秩,看完试着用自己的话讲给别人听。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/80bIUggRJf4" title="The KV Cache: Memory Usage in Transformers" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Efficient NLP · The KV Cache: Memory Usage in Transformers · 讲 KV cache 存的是什么、为什么按层数和头数算,对应今天 `kv_bytes` 那个公式。英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 7 章讲微调(什么时候该微调、LoRA、QLoRA、显存怎么估),第 9 章讲推理优化,正好覆盖这一周的两条线。复习日读第 7 章「Memory Bottlenecks」那一节。

### 开源项目与代码

- [hiyouga/LLaMA-Factory](https://github.com/hiyouga/LLaMA-Factory):它在启动训练前也会打印可训练参数量和数据集统计,可以对照我们的 preflight 看看别人查了哪些项。
- [huggingface/peft](https://github.com/huggingface/peft):`model.print_trainable_parameters()` 就是我们 `lora_params` 的框架版。

## 自测

1. 不看文章:Qwen3-4B 每个 token 的 KV cache 多少字节?公式里每一项是什么?

<details><summary>答案</summary>

147,456 字节,约 144 KB。2(K 和 V)× 36 层 × 8 个 KV 头 × 128 维 × 2 字节(16 位)。注意用的是 KV 头数 8,不是注意力头数 32。

</details>

2. 同一张 15 GB 的 T4,训练时 QLoRA 只占 2.9 GB,为什么部署后能给 KV cache 的只有 4.5 GB?

<details><summary>答案</summary>

训练时基座是 4 位的;部署时这里按 16 位权重算,7.5 GiB。vLLM 默认用 90% 显存(13.5 GB),减掉权重 7.5、运行时开销约 1.5,剩 4.5 GB。两本账不一样:训练算的是 4 位基座 + LoRA + 激活值,部署算的是权重 + KV cache。部署时也可以用量化版的基座省显存,代价是要验证量化有没有伤效果。

</details>

3. 体检脚本报「train∩eval = 1」,你会怎么处理?只把那一条删掉够不够?

<details><summary>答案</summary>

先删掉保证这次训练干净,但不够。要回头查这条是怎么进来的:原始数据导出时是不是把评测运行的流量也导出了,还是 `build_sft_data.py` 的黑名单用的不是最新的评测集。修好源头,否则下次还会混进来。

</details>

4. 这一周哪些坑是「不报错的」?为什么它们比报错的更危险?

<details><summary>答案</summary>

评测题混进训练集、tojson 转义中文、没开 trim_blocks、parser 没配对、MinHash 在短问题上失灵、A 和 B 都为 0、改 r 不改 alpha、模板或遮罩错了、温度 0 的抖动等。危险在于程序正常跑完,你拿到的数字看起来也合理,只有在上线以后或者换了评测方式才发现结论是错的。对付它们只能靠打印出来人眼看、写独立的检查脚本、把检查放进 CI。

</details>

5. (面试题)面试官问:「你们决定微调一个小模型之前,做了哪些评估?」请回答。

<details><summary>答案</summary>

分三块。需求:先用评测集逐字段证明提示词和 few-shot 能做到哪,我们的分诊里类别提示词就满分,只有团队口径类的字段值得微调。成本:用压测量出小模型在目标卡上按 SLO 选的工作点吞吐,折算成每百万 token 的成本,和 API 比,确认量大到划算。可行性:按模型 config 算训练和部署两本显存账,LoRA r=16 只训 0.8% 的参数,QLoRA 在一张 T4 上就训得动;数据侧造好训练集后跑体检,确认零泄漏、类别够、样本不超长。这些都过了才开训,训完再用同一份评测集加一份换了说法的评测集和原版、API 基线对比。

</details>

## 明天预告

Day 574 · 微调(四):挂到 vLLM 上和原版对比。体检通过,假设你已经在 Colab 上训好了 `triage_lora`。明天把它挂到 Day 568 的 vLLM 上,同一个基座同时提供原版和微调版两个模型名,写一个对比脚本,把 DeepSeek、原版 Qwen3-4B、微调版放在同一份评测集上逐条比。我们还会发现 Day 570 的评测集有个藏得很深的问题:它和训练集出自同一套模板。
