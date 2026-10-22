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

## 如果要训的是工具调用

分诊是单轮分类,样本就是三段 messages。可 Agent 里还有一类常见的微调需求:小模型选工具老选错、参数老填漏,想用自己业务里的真实轨迹把它教稳。这时候样本里多了两样东西,工具定义和工具往返,格式上的坑比分诊多不少。

先说结论:**样本里存结构化的 messages 加 tools,不要自己拼字符串**,让基座模型自带的 chat template 去渲染。原因是每家模型把工具塞进上下文的方式都不一样,你手拼的格式只要和推理时 vLLM 用的不一致,训出来的模型在线上就对不上号。

一条工具调用样本长这样:顶层一个 `tools` 列表(和 Day 8 传给 API 的完全同一种 JSON Schema),一个 `messages` 列表,里面有 user 提问、assistant 发起的 `tool_calls`、role 为 `tool` 的结果、最后 assistant 的文字回答。多步任务就是中间多几轮调用和结果。

光看 JSON 看不出模型实际学到的是什么文本,所以训练前一定要渲染一条出来看。下面这个脚本直接读 Qwen3-4B-Instruct-2507 仓库里 `tokenizer_config.json` 的 `chat_template` 字段,用 jinja2 渲染,不需要装 transformers,本机就能跑(`curl -sL https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/raw/main/tokenizer_config.json -o tokenizer_config.json` 下载模板):

```python
# agentops-lab/w12/render_tool_sample.py
"""把一条工具调用样本按 Qwen3 的 chat template 渲染成训练文本,检查格式。
用法:python render_tool_sample.py tokenizer_config.json
"""
import json
import sys

from jinja2.sandbox import ImmutableSandboxedEnvironment

TOOLS = [{
    "type": "function",
    "function": {
        "name": "get_invoice",
        "description": "按发票号查询 CloudLedger 发票,返回金额、状态、开票日期",
        "parameters": {
            "type": "object",
            "properties": {"invoice_id": {"type": "string", "description": "形如 INV-2026-0012"}},
            "required": ["invoice_id"],
        },
    },
}]

SAMPLE = [
    {"role": "system", "content": "你是 CloudLedger 客服助手。"},
    {"role": "user", "content": "INV-2026-0012 这张发票为什么还是未付款?"},
    {"role": "assistant", "content": "", "tool_calls": [
        {"type": "function", "function": {"name": "get_invoice",
                                          "arguments": {"invoice_id": "INV-2026-0012"}}}]},
    {"role": "tool", "content": json.dumps({"status": "open", "amount": 199, "due": "2026-10-30"},
                                           ensure_ascii=False)},
    {"role": "assistant", "content": "这张发票金额 199 元,到期日是 10 月 30 日,目前还没到期,所以状态是未付款。"},
]


def main(config_path: str) -> None:
    template = json.load(open(config_path, encoding="utf-8"))["chat_template"]
    env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True)
    env.filters["tojson"] = lambda x, **kw: json.dumps(x, ensure_ascii=False)
    text = env.from_string(template).render(messages=SAMPLE, tools=TOOLS, add_generation_prompt=False)
    print(text)


if __name__ == "__main__":
    main(sys.argv[1])
```

<div class="line-notes">

- `from jinja2.sandbox import ImmutableSandboxedEnvironment` chat template 本质是一段 Jinja2 模板。transformers 的 `apply_chat_template` 内部也是用这个沙箱环境渲染的,这里直接用,省掉装 transformers 和下载权重。
- `TOOLS = [{` 和 Day 8 传给 `chat.completions.create(tools=...)` 的是同一种结构。训练样本里存的就是这个,渲染交给模板。
- `"required": ["invoice_id"],` 后面清洗脚本会拿它检查样本里的调用有没有漏填必填参数。
- `{"role": "assistant", "content": "", "tool_calls": [` 发起调用的那一轮 assistant,content 是空串。Qwen3 模板里 `content` 为空时不会在 `<tool_call>` 前多插一个换行。
- `"arguments": {"invoice_id": "INV-2026-0012"}}}]},` 这里给的是字典。模板两种都接受:字符串原样输出,字典走 `tojson`。从 OpenAI 格式日志导出的通常是字符串,混用不会出错,但字符串里如果是坏 JSON,模板不会帮你检查。
- `{"role": "tool", "content": json.dumps(` 工具结果。注意 Qwen3 模板会把它渲染成一个 **user** 轮里的 `<tool_response>` 块,不是单独的 tool 角色。
- `template = json.load(` 读出 `chat_template` 字段,一段两千多字符的 Jinja2。
- `env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True)` 两个参数和 transformers 渲染时的设置一致,去掉模板标签带来的多余换行和缩进;不加的话渲染出的文本会多出空行,和真实训练文本对不上。
- `env.filters["tojson"] = ` transformers 自定义了 `tojson`,不转义中文。Jinja2 自带的 `tojson` 会把中文转成 `\uXXXX`,还会转义 HTML 字符,这里覆盖成同样不转义的版本。
- `text = env.from_string(template).render(` `add_generation_prompt=False` 表示这是完整的训练样本,结尾不追加空的 assistant 开头。推理时才设 True。

</div>

本机跑出来的文本是这样的(没有省略):

```text
<|im_start|>system
你是 CloudLedger 客服助手。

# Tools

You may call one or more functions to assist with the user query.

You are provided with function signatures within <tools></tools> XML tags:
<tools>
{"type": "function", "function": {"name": "get_invoice", "description": "按发票号查询 CloudLedger 发票,返回金额、状态、开票日期", "parameters": {"type": "object", "properties": {"invoice_id": {"type": "string", "description": "形如 INV-2026-0012"}}, "required": ["invoice_id"]}}}
</tools>

For each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:
<tool_call>
{"name": <function-name>, "arguments": <args-json-object>}
</tool_call><|im_end|>
<|im_start|>user
INV-2026-0012 这张发票为什么还是未付款?<|im_end|>
<|im_start|>assistant
<tool_call>
{"name": "get_invoice", "arguments": {"invoice_id": "INV-2026-0012"}}
</tool_call><|im_end|>
<|im_start|>user
<tool_response>
{"status": "open", "amount": 199, "due": "2026-10-30"}
</tool_response><|im_end|>
<|im_start|>assistant
这张发票金额 199 元,到期日是 10 月 30 日,目前还没到期,所以状态是未付款。<|im_end|>
```

从这段文本能读出三件事。第一,工具定义整段进了 system,一个工具就一百多 token,十几个工具时每条样本光定义就上千 token,训练时的序列长度要按这个算。第二,模型要学会输出的是 `<tool_call>` 包着的一行 JSON,这就是 Qwen 文档说的 Hermes 风格;推理时 vLLM 要用 `--enable-auto-tool-choice --tool-call-parser hermes` 才能把这段文本解析回 `tool_calls` 字段,parser 和训练格式不匹配,模型输出是对的,接口却返回一段纯文本。第三,工具结果被包在 user 轮里。这对损失计算正好有利:上一节的 `train_on_responses_only` 按 `<|im_start|>assistant` 和 `<|im_start|>user` 切分,工具结果落在 user 部分会被遮掉,模型不会去学「编造工具返回值」,两轮 assistant(发起调用、最后回答)都参与训练。换别的基座(Llama、Gemma、Mistral)格式完全不同,所以同样的检查要再做一遍。

Hugging Face Agents Course 的 Bonus Unit 1 讲的就是这件事:拿 gemma-2-2b-it 做 function calling 的 LoRA 微调,配套笔记本里自己给模板加了思考和工具调用的标记。基座模板本来不支持工具时就得这么做,代价是推理服务那边也要配同一份模板和 parser。能选原生支持工具调用的基座,就别自己加。

### 清洗、去重和配比

工具调用的样本多半来自线上轨迹(Day 52 的 Langfuse 导出)或强模型生成,脏数据的花样比分诊多:调用了工具列表里没有的工具、参数是截断的 JSON、漏了必填参数、发起了两个并行调用却只回了一个结果、轨迹停在半路没有最终回答。这些样本留着,模型就学会了同样的毛病。下面这个检查脚本把它们挑出来,顺便按用户问题去重:

```python
# agentops-lab/w12/check_tool_sft.py
"""工具调用 SFT 样本的清洗检查:结构、工具名、参数、去重。
用法:python check_tool_sft.py tool_sft_raw.jsonl tool_sft_clean.jsonl
"""
import hashlib
import json
import sys
from collections import Counter


def problems(sample: dict) -> list[str]:
    tools = {t["function"]["name"]: t["function"]["parameters"] for t in sample["tools"]}
    msgs, out = sample["messages"], []
    for i, m in enumerate(msgs):
        for call in m.get("tool_calls") or []:
            fn = call["function"]
            if fn["name"] not in tools:
                out.append(f"第{i}条调用了不存在的工具 {fn['name']}")
                continue
            args = fn["arguments"]
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    out.append(f"第{i}条参数不是合法 JSON")
                    continue
            missing = set(tools[fn["name"]].get("required", [])) - set(args)
            if missing:
                out.append(f"第{i}条缺必填参数 {sorted(missing)}")
        if m.get("tool_calls"):
            n_calls = len(m["tool_calls"])
            replies = msgs[i + 1:i + 1 + n_calls]
            if len(replies) < n_calls or any(r["role"] != "tool" for r in replies):
                out.append(f"第{i}条的 {n_calls} 个调用没有全部配上 tool 结果")
    if msgs[-1]["role"] != "assistant" or msgs[-1].get("tool_calls"):
        out.append("最后一条不是 assistant 的文字回答")
    return out


def fingerprint(sample: dict) -> str:
    user = "".join(m["content"] for m in sample["messages"] if m["role"] == "user")
    return hashlib.md5("".join(user.split()).encode()).hexdigest()


def main(src: str, dst: str) -> None:
    seen, kept, dropped = set(), [], Counter()
    for line in open(src, encoding="utf-8"):
        sample = json.loads(line)
        errs = problems(sample)
        if errs:
            dropped[errs[0].split("条", 1)[-1]] += 1
            continue
        fp = fingerprint(sample)
        if fp in seen:
            dropped["重复"] += 1
            continue
        seen.add(fp)
        kept.append(sample)
    with open(dst, "w", encoding="utf-8") as f:
        for s in kept:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")
    calls = Counter(len([m for m in s["messages"] if m.get("tool_calls")]) for s in kept)
    print(f"保留 {len(kept)} 条,丢弃 {sum(dropped.values())} 条:{dict(dropped)}")
    print(f"按工具调用轮数分布:{dict(sorted(calls.items()))}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
```

<div class="line-notes">

- `tools = {t["function"]["name"]: t["function"]["parameters"]` 把这条样本自带的工具列表变成「工具名 → 参数 schema」的字典。每条样本带自己的工具列表,因为线上不同场景挂的工具不一样。
- `for call in m.get("tool_calls") or []:` 没有 `tool_calls` 的消息 `get` 返回 None,`or []` 让循环直接跳过。
- `if fn["name"] not in tools:` 测试数据里第 4 条调用了 `refund`,工具列表里只有 `get_invoice`,在这里被抓到。线上轨迹里这种情况多半来自模型幻觉出的工具名,API 当时报了错,但日志照样记下来了。
- `if isinstance(args, str):` OpenAI 格式的日志里 arguments 是字符串,手造的样本常是字典,两种都要能检查。
- `except json.JSONDecodeError:` 测试数据第 6 条的参数是 `'{"invoice_id": "INV-1"'`,少一个右括号,模型输出被 max_tokens 截断时就是这个样子。
- `missing = set(tools[fn["name"]].get("required", [])) - set(args)` 必填参数集合减去实际给的参数名。第 5 条传了空字典,结果是 `{'invoice_id'}`。这里只查必填项,想查类型可以换成 `jsonschema.validate`。
- `replies = msgs[i + 1:i + 1 + n_calls]` 发起几个调用,后面就应该紧跟几条 tool 消息。第 7 条调用之后直接是 assistant 回答,`replies` 里那条的 role 是 assistant,判为没配上结果。真实 API 遇到这种消息序列会直接报 400(Day 8 练习里见过)。
- `if msgs[-1]["role"] != "assistant" or msgs[-1].get("tool_calls"):` 轨迹必须以文字回答收尾。停在 tool 结果或者停在一次调用上的,多半是运行中途超时或被中断。
- `return hashlib.md5("".join(user.split()).encode()).hexdigest()` 指纹只取用户说的话,去掉所有空白。第 2 条和第 1 条只差一个空格、回答措辞不同,算重复。同一个问题保留多种回答对工具调用帮助不大,反而会让某类问题的权重偏大。
- `dropped[errs[0].split("条", 1)[-1]] += 1` 只按第一个问题计数,去掉「第 i 条」前缀方便汇总。
- `calls = Counter(` 统计保留下来的样本里各有几轮工具调用,下面讲配比时要看这个分布。

</div>

我用 7 条造好的样本跑了一遍(1 条正常、1 条只差空格的重复、1 条不需要工具的问答、4 条各带一种毛病),输出:

```text
保留 2 条,丢弃 5 条:{'重复': 1, '调用了不存在的工具 refund': 1, "缺必填参数 ['invoice_id']": 1, '参数不是合法 JSON': 1, '的 1 个调用没有全部配上 tool 结果': 1}
按工具调用轮数分布:{0: 1, 1: 1}
```

这里的去重是精确去重。真实数据里更多的是「换了说法的同一个问题」,规模上来以后要加近似去重:用 MinHash(`datasketch` 库)按字符 n-gram 找相似度高于某个阈值的样本,或者用 Day 15 的 embedding 算余弦相似度聚类,每簇只留几条。和评测集隔离的那条黑名单规则在这里同样适用。

最后是配比。只喂「需要调工具」的样本,模型会学成见什么都调工具,用户问一句「你们支持开专票吗」它也去查发票。所以训练集里要有三类样本按比例混在一起:需要调用工具的(单步、多步、并行调用都要有);**不需要调用、直接回答的**(上面那条 0 轮的样本就是);工具报错后怎么处理的(重试一次、换参数、或者如实告诉用户查不到)。再加一小份和业务无关的通用指令数据,用来减轻灾难性遗忘。具体比例没有定律,我的起点是工具类六成、直接回答两成、报错恢复和通用数据合计两成,然后看评测:「不该调却调了」的比例高就加直接回答类,「该调没调」多就反过来。每次调整配比都重跑一遍 Day 33 的轨迹评测,只看最终答案对不对是发现不了这类问题的。

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
| Hermes 风格工具调用 | 把工具定义放进 `<tools>`、模型输出 `<tool_call>` 包着的 JSON、结果放进 `<tool_response>` 的文本格式,Qwen3 用的就是它 |
| tool-call parser | 推理服务把模型输出的工具调用文本解析回 `tool_calls` 字段的组件,vLLM 用 `--tool-call-parser` 指定,必须和训练格式一致 |
| 近似去重 | 用 MinHash 或 embedding 找出说法不同、意思相同的样本,只保留一部分 |

## 常见误区

**用微调灌知识。** 会变的事实交给 RAG,要精确的数字交给工具查库。微调学的是「怎么做」,不是「是什么」。

**训练集混进评测用例。** 测出来的提升是假的,而且你自己很难发现。用指纹去重加场景黑名单,在脚本里强制拦截。

**训练和推理用了不同的 chat template。** 训练时一种格式,vLLM 推理时用模型默认的另一种,效果会莫名其妙地差。训练前打印一条样本确认,推理时用同一个基座的同一个模板。

**工具调用样本只放「要调工具」的。** 模型会学成什么问题都去调工具。要混进不需要调用的直接回答样本和工具报错后的处理样本,并用轨迹评测检查「不该调却调了」的比例。

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
- [Hugging Face Agents Course · Bonus Unit 1](https://huggingface.co/learn/agents-course/bonus-unit1/introduction):用 gemma-2-2b-it 做 function calling 的 LoRA 微调,看配套笔记本里怎么给模板加工具标记,1 小时。
- [Transformers · Chat templates 中的工具调用](https://huggingface.co/docs/transformers/en/chat_extras):`apply_chat_template(tools=...)` 的用法,以及工具和结果怎么进对话,30 分钟。
- [Qwen 文档 · Function Calling](https://qwen.readthedocs.io/en/latest/framework/function_call.html):Qwen3 推荐的 Hermes 风格,以及 vLLM 侧怎么开工具解析,20 分钟。
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

7. 你用线上轨迹微调了一个选工具的小模型,离线评测里最终答案准确率涨了,上线后客服反馈它「什么都去查一下」,延迟翻倍。最可能是数据哪里出了问题?怎么改?

<details><summary>答案</summary>

训练集几乎全是需要调工具的样本,模型学到了「先调工具」这个习惯;最终答案准确率不会暴露这个问题,因为多调一次查询答案照样是对的。改法是补进不需要调用、直接回答的样本,并调整配比,评测时加上轨迹层面的指标,比如「不必要的工具调用占比」和平均调用次数,用 Day 33 的轨迹评测盯住。

</details>

## 明天预告

Day 78 · 偏好优化:DPO 让模型学会「更好的回答」。SFT 教会模型「标准答案长什么样」,但客服回复没有唯一的标准答案,只有「这个比那个好」。明天讲 RLHF、DPO、ORPO、KTO 的区别,用 SupportPilot 起草回复的成对数据跑一次 DPO,并检查它有没有学到你不想要的东西。
