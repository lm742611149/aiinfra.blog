---
title: 'Day 574 · 微调(四):挂到 vLLM 上和原版对比'
description: '训好的 LoRA 只有 63 MB,要挂回基座才能用。今天讲 vLLM 怎么让一个基座同时提供原版和微调版两个模型名,然后写一个对比脚本,把 DeepSeek、原版和微调版放在同一份评测集上逐条比;顺带发现 Day 570 的评测集和训练集出自同一套模板,手写一份换了说法的评测集。'
pubDate: 2026-10-22
regime: none
tags: ['fine-tuning', 'lora', 'vllm', 'evaluation', 'agent-zero']
series: 'agent-zero'
day: 574
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 573](/blog/agent-zero/day-573-week82-review/) 是第 82 周的复习,我们写了一个微调前体检脚本 `preflight.py`,开训前一次算清训练和部署两本显存账、LoRA 参数量、样本长度和泄漏,还整理了一张「不报错的坑」清单。再往前一天,[Day 572](/blog/agent-zero/day-572-finetune-2/) 给出了在 Colab T4 上用 Unsloth 训练分诊 LoRA 的笔记本,最后一个单元保存出一个 `triage_lora/` 目录。训练 loss 降了不代表模型变好了。今天把这个适配器挂到 vLLM 上,和原版、和 DeepSeek 放在一起,用同一份评测集说话。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清 LoRA 上线的两种方式:vLLM 运行时挂载(一个基座、多个模型名)和合并进基座权重,各自适合什么情况;能写出 `vllm serve` 挂 LoRA 的命令,知道 `--max-lora-rank` 默认是 16 这个坑。
2. 写一个对比脚本 `compare_models.py`,让多个候选(API 基线、原版、微调版)跑同一份评测集,打印逐字段准确率、JSON 合法率、带 Wilson 区间的全对率、P50 延迟和花费,并把逐条结果存下来做配对比较。
3. 知道「评测题和训练样本出自同一个模板」是一种指纹查不出的泄漏,会检查它,会补一份换了说法的评测集。

预计用时 2.5 小时。前置:[Day 547](/blog/agent-zero/day-547-eval-stats-1/)(Wilson 区间)、[Day 548](/blog/agent-zero/day-548-eval-stats-2/)(配对比较)、[Day 568](/blog/agent-zero/day-568-self-host-2/)(vLLM 上线)、[Day 569](/blog/agent-zero/day-569-self-host-3/)(压测和自部署成本)、[Day 570](/blog/agent-zero/day-570-finetune-1/)(`prompt_first.py`、`build_sft_data.py`、`tickets_v1.jsonl`)、[Day 572](/blog/agent-zero/day-572-finetune-2/)(`triage_lora`)。

哪些实跑了、哪些没有,先说清楚。对比脚本、配对比较、模板泄漏检查、换说法的评测集,都在本机实跑了,打的是 DeepSeek API,今天花费约 0.06 元,算式在验收标准里。vLLM 挂 LoRA 需要 GPU 和 Day 572 训出来的适配器,**我两样都没有,这部分没实跑**:命令和参数照 vLLM 0.32.0(2026 年 10 月 18 日发布,PyPI 上的最新版)的文档和源码写,对比表里微调版那两行留空,等你自己填。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`compare_models.py` 的 `run_one` 和 `summarize`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## LoRA 上线的两种方式

`triage_lora/` 里只有 LoRA 的 A、B 矩阵(约 63 MB)和一个 `adapter_config.json`,没有基座。要用它,得把它和基座 Qwen3-4B-Instruct-2507 放在一起。有两种放法。

**运行时挂载。** 推理服务加载一份基座权重,再加载一个或多个 LoRA 适配器;每个请求通过 `model` 字段说自己要哪个。请求 `model="Qwen/Qwen3-4B-Instruct-2507"` 就走原版,`model="triage"` 就在原版的输出上加上 triage 那条旁路。回想 Day 572 那一行 `W @ x + (alpha / r) * (B @ (A @ x))`:基座 W 所有请求共用,B 和 A 按请求换。前端打个比方,这像一个页面按 URL 参数加载不同的主题包,页面代码只有一份。

**合并。** 把 `(alpha / r) * B @ A` 直接加进 W,存成一份新的完整模型。合并以后它就是一个普通模型,部署方式和原版一模一样,不需要任何 LoRA 相关的参数,推理时也少了那条旁路的计算。代价是每个微调版都是一份完整的 8 GB 权重。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="vLLM 运行时挂载 LoRA:一份基座权重,按请求里的 model 名选适配器">
<rect x="10" y="30" width="170" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="95" y="55" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">model="Qwen/Qwen3-4B…"</text>
<rect x="10" y="90" width="170" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="95" y="115" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">model="triage"</text>
<rect x="10" y="150" width="170" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="95" y="175" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">model="toolcall"(以后)</text>
<rect x="240" y="20" width="380" height="200" rx="8" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="430" y="42" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">一个 vLLM 进程,一张卡</text>
<rect x="260" y="60" width="200" height="140" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="360" y="120" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">基座 W(16 位)</text>
<text x="360" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">7.5 GiB,所有请求共用</text>
<rect x="480" y="70" width="120" height="40" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="540" y="95" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">triage 63 MB</text>
<rect x="480" y="130" width="120" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="540" y="155" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">toolcall(空位)</text>
<line x1="180" y1="50" x2="260" y2="100" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="180" y1="110" x2="260" y2="120" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="180" y1="170" x2="260" y2="150" stroke="var(--rule)" stroke-width="1.5" stroke-dasharray="4 3"/>
<line x1="460" y1="100" x2="480" y2="90" stroke="var(--rule)" stroke-width="1.5"/>
<text x="20" y="242" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">--max-loras 控制同时能有几个适配器参与一批计算,--max-lora-rank 要 ≥ 所有适配器里最大的 r。</text>
</svg>
<figcaption>运行时挂载:基座只占一份显存,每多一个微调版只多几十 MB。请求里的 model 字段决定这一次走不走、走哪条旁路。原版和微调版跑在同一张卡上,对比时连硬件差异都排除了。</figcaption>
</figure>

怎么选,看你有几个微调版、部署环境支不支持:

| | 运行时挂载 | 合并 |
| --- | --- | --- |
| 显存 | 一份基座 + 每个适配器几十 MB | 每个微调版一份完整权重 |
| 对比原版 | 同一进程两个模型名,最方便 | 要起两个服务 |
| 推理速度 | 多一条旁路的计算,略慢 | 和原版一样 |
| 部署要求 | 推理服务要支持 LoRA(vLLM、SGLang 支持) | 任何能跑原版的地方都能跑 |
| 适合 | 多个任务各一个适配器、还在迭代 | 定型了只用一个,或者要转成 GGUF 给 Ollama 用 |

今天要做对比,运行时挂载最合适。定型以后要不要合并,等对比结果出来再说。

## 在 vLLM 上挂 LoRA(没实跑)

接着 [Day 568](/blog/agent-zero/day-568-self-host-2/) 的路线,在 Colab T4 或者租来的 GPU 上,把 Day 572 下载的 `triage_lora.zip` 传上去解压。下面以 Colab 为例,适配器放在 `/content/triage_lora/`。T4 上 vLLM 能不能顺利起来、遇到问题怎么办,Day 568 讲过,这里只说 LoRA 多出来的部分。

```bash
# Colab 单元(或 GPU 机器的终端):起 vLLM,同时提供原版和 triage 两个模型名
vllm serve Qwen/Qwen3-4B-Instruct-2507 \
  --dtype half \
  --max-model-len 4096 \
  --enable-lora \
  --lora-modules triage=/content/triage_lora \
  --max-lora-rank 16 \
  --max-loras 1 \
  --api-key "$VLLM_API_KEY"
```

<div class="line-notes">

- `vllm serve Qwen/Qwen3-4B-Instruct-2507 \` 第一个参数是基座,必须和训练时的基座是同一个。Day 572 训练用的是 `unsloth/Qwen3-4B-Instruct-2507`,它是 Unsloth 在 Hugging Face 上的镜像,权重和 Qwen 官方仓库一样;`adapter_config.json` 里的 `base_model_name_or_path` 记着训练时用的是哪个。用 4 位版本训的 QLoRA,部署时挂到 16 位基座上是常规做法,但这一点也要用评测结果验证。
- `--dtype half \` T4 不支持 bf16,用 fp16(Day 568)。
- `--max-model-len 4096 \` 最大上下文长度。设小一点,KV cache 的预留就少。分诊请求一百多 token,4096 绰绰有余。
- `--enable-lora \` 打开 LoRA 支持。不加这个,下面两个参数都不生效。
- `--lora-modules triage=/content/triage_lora \` 「名字=路径」。名字就是请求时 `model` 字段要填的字符串,你可以起任何名字。也可以写成 JSON:`'{"name": "triage", "path": "/content/triage_lora", "base_model_name": "Qwen/Qwen3-4B-Instruct-2507"}'`,多一个 `base_model_name`,`/v1/models` 里就能看出它挂在哪个基座上。
- `--max-lora-rank 16 \` 允许的最大 rank。我查了 vLLM 0.32.0 的源码(`vllm/config/lora.py`),默认值就是 16,可选值是 1、8、16、32、64、128、256、320、512。**你训的是 r=32,这里不改就加载不上**。Unsloth 官方笔记本默认就是 r=32,这是最容易撞上的坑。也别随手设成 512,文档说设得远大于需要会浪费显存、影响性能。
- `--max-loras 1 \` 同一批计算里最多同时有几个不同的适配器,默认 1。只挂一个 triage 就够;以后挂了多个、而且它们的请求会同时来,要调大。
- `--api-key "$VLLM_API_KEY"` 和 Day 568 一样,给服务加个密钥,`$VLLM_API_KEY` 先 `export` 好。

</div>

服务起来以后先看模型列表:

```bash
curl -s http://localhost:8000/v1/models -H "Authorization: Bearer $VLLM_API_KEY" | python3 -m json.tool
```

按 vLLM 文档的说法,返回的列表里除了基座,适配器也会作为单独的一项出现,它的 `parent` 字段指向基座。看到 `triage` 这一项,说明挂上了。这一段我没有实跑,返回的具体 JSON 不贴了。

### 运行时加载新适配器

服务已经在跑,又训了一个新版本 `triage_v2`,不想重启。vLLM 有一个 `/v1/load_lora_adapter` 接口,要先设环境变量 `VLLM_ALLOW_RUNTIME_LORA_UPDATING=True` 再启动服务,然后:

```bash
curl -s -X POST http://localhost:8000/v1/load_lora_adapter \
  -H "Authorization: Bearer $VLLM_API_KEY" -H "Content-Type: application/json" \
  -d '{"lora_name": "triage_v2", "lora_path": "/content/triage_lora_v2"}'
```

文档明确提醒这个功能有安全风险,只在隔离、完全可信的环境里用,生产环境别开。原因不难想:能调这个接口的人,就能往你的服务里塞任意一份权重。做对比实验时用一下很方便,线上的版本切换还是走重新部署。

### 合并成完整模型

要合并的话,在训练用的 Colab 里加一个单元就行(照 Unsloth 官方笔记本最后的保存单元):

```python
# Colab 单元:把 LoRA 合并进基座,存成 16 位完整模型(没实跑)
model.save_pretrained_merged("triage_merged_16bit", tokenizer, save_method="merged_16bit")
```

<div class="line-notes">

- `model.save_pretrained_merged("triage_merged_16bit", tokenizer, save_method="merged_16bit")` 把 `(alpha / r) * B @ A` 加进每个被挂了 LoRA 的 W,存成一份完整的 16 位模型,约 8 GB。部署时 `vllm serve /content/triage_merged_16bit` 就行,不用任何 LoRA 参数。`save_method` 还可以是 `"merged_4bit"`;笔记本里另有 `save_pretrained_gguf`,转成 GGUF 给 llama.cpp、Ollama 用。

</div>

如果训练时基座是 4 位加载的(我们就是),合并要先把基座还原成 16 位再加,Unsloth 的 `merged_16bit` 会替你处理。不用 Unsloth 的话,PEFT 库的写法是 `PeftModel.from_pretrained(基座, 适配器路径)` 再 `.merge_and_unload()`,这里不展开。

## 第一步:对比脚本

服务起来了也好,没起来也好,对比脚本是同一个。思路和 [Day 570](/blog/agent-zero/day-570-finetune-1/) 的 `prompt_first.py` 一样:同一份评测集,每个候选跑一遍,逐字段算对了几条。多了四件事:

1. 候选写成一张配置表,每个候选有自己的 `base_url`、`model`、要不要加示例、价格。加一个候选就是加一行。
2. 逐条结果存成 JSONL,后面做配对比较、按类别统计都从这些文件读,不用重新调模型。
3. 不用 `response_format` 兜底,直接看模型输出是不是合法 JSON。微调版要学会的一件事就是「只输出那段 JSON」,JSON 合法率本身就是一个指标。
4. 全对率带上 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 的 Wilson 区间,12 条的评测集到底能说明多少,区间一眼就看出来。

微调版的调用方式有一条硬规矩:**不加示例,system 说明和训练时一字不差**。它训练时看到的就是「system + 一张工单 → 一段 JSON」,推理时多塞三个示例,反而和训练分布不一样了。所以配置里 `qwen-triage` 的 `few_shot` 是 False,system 直接从 `build_sft_data.py` 导入。

新建 `part10/compare_models.py`:

```python
# agent-zero-lab/part10/compare_models.py
"""同一份评测集跑多个候选(原版、微调版、API 基线),逐条存结果,打印对比表。
用法:uv run python part10/compare_models.py part10/data/tickets_v1.jsonl deepseek-zero deepseek-3shot
"""
import json
import math
import os
import statistics
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

from build_sft_data import KEYS, SYSTEM
from prompt_first import SHOTS

load_dotenv()
CANDIDATES = {
    "deepseek-zero": {"base_url": os.environ["LLM_BASE_URL"], "key": os.environ["LLM_API_KEY"],
                      "model": os.environ["LLM_MODEL"], "few_shot": False, "price": (2, 8)},
    "deepseek-3shot": {"base_url": os.environ["LLM_BASE_URL"], "key": os.environ["LLM_API_KEY"],
                       "model": os.environ["LLM_MODEL"], "few_shot": True, "price": (2, 8)},
    # 下面两个要先在 GPU 机器上起 vLLM(见正文),本文没有实跑
    "qwen-base": {"base_url": "http://localhost:8000/v1", "key": os.environ.get("VLLM_API_KEY", "x"),
                  "model": "Qwen/Qwen3-4B-Instruct-2507", "few_shot": False, "price": (0, 0)},
    "qwen-triage": {"base_url": "http://localhost:8000/v1", "key": os.environ.get("VLLM_API_KEY", "x"),
                    "model": "triage", "few_shot": False, "price": (0, 0)},
}
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    p = k / n
    mid = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return mid - half, mid + half


def run_one(name: str, cases: list[dict]) -> list[dict]:
    c = CANDIDATES[name]
    client = OpenAI(base_url=c["base_url"], api_key=c["key"])
    rows = []
    for case in cases:
        messages: list[ChatCompletionMessageParam] = [{"role": "system", "content": SYSTEM}]
        if c["few_shot"]:
            for s, b, ans in SHOTS:
                messages.append({"role": "user", "content": f"主题:{s}\n正文:{b}"})
                messages.append({"role": "assistant", "content": json.dumps(ans, ensure_ascii=False)})
        messages.append({"role": "user", "content": f"主题:{case['subject']}\n正文:{case['body']}"})
        t0 = time.perf_counter()
        resp = client.chat.completions.create(model=c["model"], messages=messages, temperature=0,
                                              max_tokens=200, extra_body=EXTRA if c["price"][0] else {})
        latency = time.perf_counter() - t0
        text = resp.choices[0].message.content or ""
        try:
            pred = json.loads(text)
        except json.JSONDecodeError:
            pred = None
        u = resp.usage
        cost = (u.prompt_tokens * c["price"][0] + u.completion_tokens * c["price"][1]) / 1e6 if u else 0.0
        rows.append({"id": case["id"], "expected": case["expected"], "pred": pred, "raw": text,
                     "latency": round(latency, 3), "cost": cost})
    return rows


def summarize(name: str, rows: list[dict]) -> None:
    n = len(rows)
    valid = sum(isinstance(r["pred"], dict) for r in rows)
    exact = sum(isinstance(r["pred"], dict) and all(r["pred"].get(k) == r["expected"][k] for k in KEYS)
                for r in rows)
    fields = "  ".join(f"{k[:8]}={sum(isinstance(r['pred'], dict) and r['pred'].get(k) == r['expected'][k] for r in rows)}"
                       for k in KEYS)
    lo, hi = wilson(exact, n)
    p50 = statistics.median(r["latency"] for r in rows)
    print(f"{name:<15} JSON {valid}/{n}  全对 {exact}/{n} [{lo:.0%}, {hi:.0%}]  {fields}  "
          f"P50 {p50:.2f}s  ¥{sum(r['cost'] for r in rows):.4f}")


if __name__ == "__main__":
    eval_path = Path(sys.argv[1])
    cases = [json.loads(x) for x in eval_path.read_text(encoding="utf-8").splitlines() if x.strip()]
    out = Path("part10/results")
    out.mkdir(exist_ok=True)
    for name in sys.argv[2:]:
        rows = run_one(name, cases)
        with open(out / f"{eval_path.stem}-{name}.jsonl", "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        summarize(name, rows)
```

<div class="line-notes">

- `import statistics` 标准库,`statistics.median` 算中位数,P50 就是中位数。
- `from build_sft_data import KEYS, SYSTEM` 四个字段名和 system 说明都从 Day 570 的整理脚本导入。微调版训练时用的就是这段 `SYSTEM`,这里不复制粘贴,改了一处另一处自动跟着变。
- `from prompt_first import SHOTS` Day 570 那三个示例。导入 `prompt_first.py` 会顺带执行它顶层的 `load_dotenv()` 和创建一个 client,没有副作用,只是多建了一个对象。
- `CANDIDATES = {` 候选配置表,相当于前端的一个 config 对象。名字是命令行上用的,值里是连哪个服务、用哪个模型。
- `"model": os.environ["LLM_MODEL"], "few_shot": False, "price": (2, 8)},` DeepSeek 的 `deepseek-flash`,价格用 Day 570 查的高峰价:输入每百万 token 2 元、输出 8 元。
- `"deepseek-3shot": {` 同一个模型加三个示例。它是「不微调、只改提示词」能做到的上限的一个参照。
- `"qwen-base": {"base_url": "http://localhost:8000/v1", "key": os.environ.get("VLLM_API_KEY", "x"),` 原版 Qwen3-4B,连上面起的 vLLM。`get` 给默认值 `"x"`,没设这个环境变量也不会在导入时就报错。
- `"model": "triage", "few_shot": False, "price": (0, 0)},` 微调版,`model` 填的就是 `--lora-modules` 里起的名字。自部署按 token 不花钱,真实成本是卡费,在下面对比表那一节单独算。
- `def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:` Day 547 的 Wilson 区间:k 条对、共 n 条时,真实正确率 95% 可能落在哪个范围。
- `client = OpenAI(base_url=c["base_url"], api_key=c["key"])` 每个候选一个 client。DeepSeek 和 vLLM 都是 OpenAI 兼容协议,代码完全一样,区别只在配置。
- `if c["few_shot"]:` 只有 3shot 候选加示例,写法和 `prompt_first.py` 一样。
- `t0 = time.perf_counter()` 高精度计时器,相当于浏览器里的 `performance.now()`,单位是秒。
- `max_tokens=200, extra_body=EXTRA if c["price"][0] else {})` 分诊输出二三十个 token,200 是上限,防止模型停不下来一直写。`EXTRA` 是关掉 DeepSeek 思考模式的参数,只发给 DeepSeek(价格不是 0 的),vLLM 不认识这个参数。这里**没有** `response_format`,要看模型自己能不能只输出 JSON。
- `try:` 解析失败不让脚本崩,记成 `pred = None`,算作 JSON 不合法。微调前的小模型、parser 配错的服务,常常在 JSON 前后多一句话,就会走到这里。
- `cost = (u.prompt_tokens * c["price"][0] + u.completion_tokens * c["price"][1]) / 1e6 if u else 0.0` 这一条的花费,token 数乘单价除以一百万。
- `rows.append({"id": case["id"], "expected": case["expected"], "pred": pred, "raw": text,` 逐条结果把标准答案、解析结果、原始输出都存下来。`raw` 很重要:JSON 不合法时要看模型到底输出了什么。
- `exact = sum(isinstance(r["pred"], dict) and all(r["pred"].get(k) == r["expected"][k] for k in KEYS)` 四个字段全对才算这一条对。分诊节点下游要用全部四个字段,一个错了整条就是错的。`all` 相当于 JS 的 `every`。
- `fields = "  ".join(f"{k[:8]}={sum(` 每个字段单独数对了几条。`k[:8]` 只取字段名前 8 个字符,让一行放得下。
- `print(f"{name:<15} JSON {valid}/{n}  全对 {exact}/{n} [{lo:.0%}, {hi:.0%}]  {fields}  "` 一个候选一行。
- `eval_path = Path(sys.argv[1])` 第一个参数是评测集文件,后面的都是候选名。
- `with open(out / f"{eval_path.stem}-{name}.jsonl", "w", encoding="utf-8") as f:` `.stem` 是不带扩展名的文件名,结果存成 `tickets_v1-deepseek-zero.jsonl` 这样,哪份评测集、哪个候选一目了然。

</div>

```bash
cd agent-zero-lab
uv run python part10/compare_models.py part10/data/tickets_v1.jsonl deepseek-zero deepseek-3shot
```

实跑输出(2026-10-22,DeepSeek `deepseek-flash`,关闭思考):

```text
deepseek-zero   JSON 12/12  全对 3/12 [9%, 53%]  category=12  needs_ac=8  needs_hu=10  urgency=6  P50 0.75s  ¥0.0049
deepseek-3shot  JSON 12/12  全对 3/12 [9%, 53%]  category=12  needs_ac=8  needs_hu=9  urgency=8  P50 0.57s  ¥0.0091
```

和 Day 570 `prompt_first.py` 的数字基本对得上:类别都满分,`urgency` 零样本 6 条、加示例 8 条。`needs_human` 零样本这次是 10,我之前同一个脚本跑过一次是 11,温度 0 也在抖,Day 570 提醒过。没有 `response_format` 兜底,DeepSeek 也是 12 条全部合法 JSON,大模型听话。

最该看的是「全对 3/12 [9%, 53%]」。12 条里全对 3 条,真实全对率 95% 可能在 9% 到 53% 之间。两个候选都是 3/12,区间一模一样,这份评测集根本分不出它们谁好。加示例让 `urgency` 多对了 2 条,却让 `needs_human` 少对了 1 条,而且全对的条数没变。要看清楚是谁在哪几条上变了,得逐条配对比。

### 故意踩一次坑:服务没起来

vLLM 没起(我本机就没有),直接跑微调版:

```bash
uv run python part10/compare_models.py part10/data/tickets_v1.jsonl qwen-triage
```

```text
Traceback (most recent call last):
  ...
httpx2.ConnectError: [Errno 61] Connection refused
  ...
openai.APIConnectionError: Connection error.
```

`Connection refused` 是「这个端口上没有程序在听」,和前端 `fetch` 一个没起的本地 dev server 时 DevTools 里看到的 `net::ERR_CONNECTION_REFUSED` 是一回事。SDK 会先重试两次再报 `APIConnectionError`,所以要等几秒才出错。在 Colab 上跑时还有一种情况:vLLM 还在加载权重,端口没开,你就开始跑脚本。先 `curl` 一下 `/v1/models` 确认服务在线,再跑对比。

## 第二步:逐条配对比较

两个候选跑的是同一批题,[Day 548](/blog/agent-zero/day-548-eval-stats-2/) 讲过,这时候应该配对比:每道题看 A 对不对、B 对不对,只有「一个对一个错」的题才说明两者有差别,两个都对或都错的题对比较没有贡献。新建 `part10/paired_diff.py`:

```python
# agent-zero-lab/part10/paired_diff.py
"""逐条配对比较两个候选:哪些题 A 对 B 错、哪些 B 对 A 错,按字段列出来。
用法:uv run python part10/paired_diff.py part10/results/tickets_v1-deepseek-zero.jsonl part10/results/tickets_v1-deepseek-3shot.jsonl
"""
import json
import sys
from collections import Counter

from build_sft_data import KEYS


def load(path: str) -> dict[str, dict]:
    return {r["id"]: r for r in map(json.loads, open(path, encoding="utf-8")) if r}


def right(row: dict, key: str) -> bool:
    return isinstance(row["pred"], dict) and row["pred"].get(key) == row["expected"][key]


a, b = load(sys.argv[1]), load(sys.argv[2])
assert a.keys() == b.keys(), "两份结果的题目不一样,不能配对比较"
for key in KEYS:
    tally = Counter((right(a[i], key), right(b[i], key)) for i in a)
    print(f"{key:<20} 都对 {tally[(True, True)]:>2}  只有A对 {tally[(True, False)]:>2}  "
          f"只有B对 {tally[(False, True)]:>2}  都错 {tally[(False, False)]:>2}")
print("变化的题:")
for i in sorted(a):
    for key in KEYS:
        ra, rb = right(a[i], key), right(b[i], key)
        if ra != rb:
            print(f"  {i} {key}: 标准={a[i]['expected'][key]}  A={a[i]['pred'].get(key)}  B={b[i]['pred'].get(key)}")
```

<div class="line-notes">

- `return {r["id"]: r for r in map(json.loads, open(path, encoding="utf-8")) if r}` 读成「题号 → 结果」的字典,方便按题号对上。`map(json.loads, 文件)` 对每一行调用 `json.loads`,相当于 JS 的 `lines.map(JSON.parse)`。
- `return isinstance(row["pred"], dict) and row["pred"].get(key) == row["expected"][key]` JSON 不合法的(`pred` 是 None)一律算错。
- `assert a.keys() == b.keys(), "两份结果的题目不一样,不能配对比较"` `assert` 条件不成立就报错并打印后面的说明,相当于 JS 里 `if (!cond) throw new Error(...)`。配对比较的前提是同一批题。
- `tally = Counter((right(a[i], key), right(b[i], key)) for i in a)` 每道题得到一个 (A 对不对, B 对不对) 的元组,数四种组合各几道。这就是 Day 548 的配对表。
- `if ra != rb:` 只打印两边结果不一样的题,这些才是两个候选真正的差别。

</div>

```bash
uv run python part10/paired_diff.py part10/results/tickets_v1-deepseek-zero.jsonl part10/results/tickets_v1-deepseek-3shot.jsonl
```

```text
category             都对 12  只有A对  0  只有B对  0  都错  0
needs_account_data   都对  8  只有A对  0  只有B对  0  都错  4
needs_human          都对  9  只有A对  1  只有B对  0  都错  2
urgency              都对  6  只有A对  0  只有B对  2  都错  4
变化的题:
  T003 needs_human: 标准=False  A=False  B=True
  T009 urgency: 标准=low  A=normal  B=low
  T010 urgency: 标准=low  A=normal  B=low
```

12 道题、4 个字段,只有 3 处结果不同。T009、T010 是两张「怎么加子账号」,加了示例以后 `urgency` 判对了,因为示例里正好就有一张「怎么加子账号」标着 low;T003「页面打不开」加了示例反而判成要转人工。`needs_account_data` 有 4 道两边都错,加示例一点没帮上。这就是 Day 570 的结论:口径类字段,示例能教会它见过的那几种,教不会没见过的。微调版要证明的,正是它能在这 4 道「都错」的题上翻过来。

等你的 vLLM 起来,同样的两行命令,把候选换成 `qwen-base qwen-triage`,再拿 `tickets_v1-qwen-base.jsonl` 和 `tickets_v1-qwen-triage.jsonl` 做配对,就是今天真正要的那张表。

## 第三步:一个指纹查不出的泄漏

写对比脚本时我顺手看了一眼 `tickets_v1.jsonl` 的 12 道题,觉得眼熟:「账单金额看不懂」「页面打不开」「怎么加子账号」,全是 Day 570 `make_raw_triage.py` 里的模板主题。评测集是用同一个 `make` 函数、同一套模板造出来的,只是公司名、客户号、金额不一样。指纹查重查的是「内容一样」,这些题内容不一样,当然查不出来。

用一个小脚本数一数。新建 `part10/template_overlap.py`:

```python
# agent-zero-lab/part10/template_overlap.py
"""指纹查不出的泄漏:评测题和训练样本出自同一个模板(主题一样、正文只换了公司和数字)。
用法:uv run python part10/template_overlap.py part10/out/triage_train.jsonl part10/data/tickets_v1.jsonl
"""
import json
import sys
from collections import Counter

train_subjects = Counter()
for line in open(sys.argv[1], encoding="utf-8"):
    user = json.loads(line)["messages"][1]["content"]
    train_subjects[user.removeprefix("主题:").split("\n正文:", 1)[0]] += 1

hit = 0
for line in open(sys.argv[2], encoding="utf-8"):
    c = json.loads(line)
    n = train_subjects[c["subject"]]
    hit += n > 0
    print(f"{c['id']} {c['subject']:<10} 训练集里同主题 {n} 条")
print(f"12 道评测题里有 {hit} 道,训练集里能找到同一个模板")
```

<div class="line-notes">

- `train_subjects = Counter()` 训练集里每个主题出现了几次。
- `train_subjects[user.removeprefix("主题:").split("\n正文:", 1)[0]] += 1` 和 Day 570 `check_leak.py` 一样的拆法,这次只要主题。我们的合成数据里,主题就是模板的标识。
- `n = train_subjects[c["subject"]]` `Counter` 访问不存在的键返回 0,不会报错。
- `hit += n > 0` 比较结果 True 当 1 加,Day 570 用过的写法。

</div>

```bash
uv run python part10/template_overlap.py part10/out/triage_train.jsonl part10/data/tickets_v1.jsonl
```

```text
T001 账单金额看不懂    训练集里同主题 12 条
T002 账单金额看不懂    训练集里同主题 12 条
T003 页面打不开      训练集里同主题 18 条
T004 页面打不开      训练集里同主题 18 条
T005 申请退款       训练集里同主题 26 条
T006 申请退款       训练集里同主题 26 条
T007 发票抬头写错了    训练集里同主题 18 条
T008 要开专票       训练集里同主题 26 条
T009 怎么加子账号     训练集里同主题 14 条
T010 怎么加子账号     训练集里同主题 14 条
T011 想降级        训练集里同主题 12 条
T012 想降级        训练集里同主题 12 条
12 道评测题里有 12 道,训练集里能找到同一个模板
```

12 道全中。每道评测题在训练集里都有十几到二十几条「同一个模板换了公司名」的兄弟,而且模板的口径(要不要查账户、紧急度)是写死在模板里的。微调版只要记住「主题是『怎么加子账号』就输出 low」,就能在这份评测集上拿满分,但这不代表它学会了口径,换个说法它可能就不会了。用这份评测集给微调版打分,分数一定虚高。

这种泄漏在真实项目里也有,只是不叫模板:同一个客户反复提的同一类问题、同一份 FAQ 改写出来的多条样本、同一个运营同学按同一个句式写的测试题。查法是一样的思路:找到能代表「出处」的字段(模板号、客户号、FAQ 编号、写题的人),看评测集和训练集在这个字段上有没有重叠。Day 570 那句「训练集和评测集严格隔离」,隔离的不只是内容,还有出处。

### 补一份换了说法的评测集

修法是另外准备一份评测集,每道题都换一种说法,不出自任何训练模板。我按 CloudLedger 的口径手写了 12 道,8 个类别都有,包括训练集里偏少的 api 和 other。新建 `part10/make_hard_eval.py`:

```python
# agent-zero-lab/part10/make_hard_eval.py
"""手写 12 道「换了说法」的评测题,不出自训练数据的任何模板,用来考微调版是不是真学会了口径。
用法:uv run python part10/make_hard_eval.py
"""
import json
from pathlib import Path

CASES = [
    ("同一笔钱扣了两回", "昨天续费 299 元,信用卡账单上出现两条一样的扣款。", "billing", True, True, "high"),
    ("超额席位费是啥", "账单上多了一行超额席位费 99 元,没看懂怎么来的。", "billing", True, False, "low"),
    ("钱退到哪了", "前几天提交了退款,到现在银行卡还没收到 199 元。", "refund", True, False, "low"),
    ("开错版本了想退", "手滑买成了企业版,才用了两天,差价能退吗?", "refund", True, True, "normal"),
    ("发票名称少几个字", "收到的发票公司名称不全,缺了「有限公司」,麻烦重新开一张。", "invoice", True, True, "normal"),
    ("收不到短信验证码", "新手机号收不到登录验证码,进不去后台。", "account", True, True, "high"),
    ("给会计开个只读账号", "会计要看报表,但不能让她改数据,怎么设?", "account", False, False, "low"),
    ("报表导不出来", "导出 Excel 的按钮点了没反应,一直在转。", "technical", False, False, "normal"),
    ("首页白了", "登录后首页一片空白,F12 看到接口 500。", "technical", False, False, "high"),
    ("下个月想换小一点的套餐", "人少了,打算从团队版换到基础版,下个账期开始。", "plan_change", True, False, "low"),
    ("接口老是 429", "/v1/invoices 一分钟才调十几次就报 429 了。", "api", False, False, "normal"),
    ("想做你们的代理", "我们做代账的,想谈渠道合作,联系谁?", "other", False, True, "low"),
]

if __name__ == "__main__":
    out = Path(__file__).parent / "data" / "tickets_hard.jsonl"
    with open(out, "w", encoding="utf-8") as f:
        for i, (s, b, cat, acct, human, urg) in enumerate(CASES):
            f.write(json.dumps({"id": f"H{i + 1:03d}", "subject": s, "body": b, "expected": {
                "category": cat, "needs_account_data": acct, "needs_human": human, "urgency": urg}},
                ensure_ascii=False) + "\n")
    print(f"写入 {len(CASES)} 条 → {out.name}")
```

<div class="line-notes">

- `CASES = [` 每道题六个值:主题、正文、类别、要不要查账户、要不要转人工、紧急度。标注的口径和 Day 570 模板里写死的口径一致,比如「重复扣款」是 high 且转人工,「怎么加只读账号」不查账户、low。只换说法,不换口径,考的才是「学没学会口径」。
- `("同一笔钱扣了两回", "昨天续费 299 元,信用卡账单上出现两条一样的扣款。", "billing", True, True, "high"),` 对应训练模板「被重复扣款了」,一个字都没重。
- `("首页白了", "登录后首页一片空白,F12 看到接口 500。", "technical", False, False, "high"),` 这一条我在 Day 572 的 Colab 单元 7 里拿来试答过,它不在训练集里。
- `("接口老是 429", "/v1/invoices 一分钟才调十几次就报 429 了。", "api", False, False, "normal"),` api 类训练集里只有 10 条,看微调版在小类上是不是也行。
- `f.write(json.dumps({"id": f"H{i + 1:03d}", "subject": s, "body": b, "expected": {` 格式和 `tickets_v1.jsonl` 完全一样,`compare_models.py` 不用改就能读。题号用 H 开头,和 T 开头的区分开。

</div>

```bash
uv run python part10/make_hard_eval.py
uv run python part10/template_overlap.py part10/out/triage_train.jsonl part10/data/tickets_hard.jsonl | tail -1
uv run python part10/compare_models.py part10/data/tickets_hard.jsonl deepseek-zero deepseek-3shot
uv run python part10/paired_diff.py part10/results/tickets_hard-deepseek-zero.jsonl part10/results/tickets_hard-deepseek-3shot.jsonl
```

```text
写入 12 条 → tickets_hard.jsonl
12 道评测题里有 0 道,训练集里能找到同一个模板
deepseek-zero   JSON 12/12  全对 4/12 [14%, 61%]  category=12  needs_ac=9  needs_hu=10  urgency=7  P50 0.74s  ¥0.0046
deepseek-3shot  JSON 12/12  全对 5/12 [19%, 68%]  category=11  needs_ac=10  needs_hu=10  urgency=8  P50 0.73s  ¥0.0088
category             都对 11  只有A对  1  只有B对  0  都错  0
needs_account_data   都对  9  只有A对  0  只有B对  1  都错  2
needs_human          都对 10  只有A对  0  只有B对  0  都错  2
urgency              都对  7  只有A对  0  只有B对  1  都错  4
变化的题:
  H006 category: 标准=account  A=account  B=technical
  H007 needs_account_data: 标准=False  A=True  B=False
  H007 urgency: 标准=low  A=normal  B=low
```

(`template_overlap.py` 最后一行写死了「12 道」,这份正好也是 12 道。)

新评测集上 DeepSeek 零样本全对 4 条,加示例 5 条,和旧评测集差不多,说明对大模型来说这两份难度相当,它本来就没见过我们的训练集。加示例那一边,H007「给会计开个只读账号」对了两个字段(和示例里的「怎么加子账号」很像),H006「收不到短信验证码」却被分成了 technical,类别第一次出错。示例把一个问题修好,又带偏了另一个,这在 Day 570 也见过。

今后看微调版,**两份评测集都要报,但以 `tickets_hard` 为准**。如果微调版在 `tickets_v1` 上接近满分、在 `tickets_hard` 上和原版差不多,结论就是它背住了模板,没学会口径,下一步要回 Day 570 增加数据的多样性,而不是调训练参数。

## 对比表和怎么下结论

把今天能填的都填上。微调版两行我没有实跑,留空:

| 候选 | tickets_v1 全对(区间) | tickets_hard 全对(区间) | tickets_hard 的 urgency | JSON 合法 | P50 延迟 | 每张工单成本 |
| --- | --- | --- | --- | --- | --- | --- |
| deepseek-zero | 3/12 [9%, 53%] | 4/12 [14%, 61%] | 7/12 | 12/12 | 0.74 秒 | 约 0.0004 元 |
| deepseek-3shot | 3/12 [9%, 53%] | 5/12 [19%, 68%] | 8/12 | 12/12 | 0.73 秒 | 约 0.0007 元 |
| qwen-base(原版) | 待填 | 待填 | 待填 | 待填 | 待填 | 按卡费算 |
| qwen-triage(微调版) | 待填 | 待填 | 待填 | 待填 | 待填 | 按卡费算 |

每张工单成本是 `tickets_hard` 那一轮的总花费除以 12:0.0046 ÷ 12 ≈ 0.0004 元,0.0088 ÷ 12 ≈ 0.0007 元。自部署那两行不按 token 算,按 [Day 569](/blog/agent-zero/day-569-self-host-3/) 的方法:卡每小时多少钱,除以在你的 SLO 下一小时能处理多少张工单。

等你填完,按这个顺序看:

1. **qwen-triage 对 qwen-base**:同一个基座、同一张卡,唯一的差别是 LoRA。在 `tickets_hard` 上逐条配对,「只有微调版对」的题明显多于「只有原版对」,才说明训练有效。12 道题太少,看到差一两道别急着下结论,先把评测集扩大(练习 1 会算要多大)。
2. **qwen-triage 对 deepseek**:微调版要替代的是 DeepSeek。它不一定要全面超过,但要在你关心的字段上不差,并且延迟、成本、数据不出内网这些理由足够大。
3. **两份评测集的落差**:`tickets_v1` 比 `tickets_hard` 高很多,就是上一节说的背模板。
4. **JSON 合法率**:微调版应该是 12/12。原版小模型如果有不合法的,看 `raw` 字段,多半是在 JSON 前后加了解释的话,这正是微调要解决的事情之一。

### 别忘了查「学坏了没有」

微调只盯着分诊练,其他能力可能变差,也就是 Day 571 提过的**灾难性遗忘**。如果这个模型只用来分诊,问题不大;如果你还想让它顺带干点别的(起草一句回复、回答一个通用问题),就要拿几条和分诊无关的请求,对比原版和微调版的回答。有一篇论文的标题说得很直白:《LoRA Learns Less and Forgets Less》(Biderman 等,2024),LoRA 比全量微调学得少,但忘得也少,这正是它适合「给基座加一个专门技能」的原因(论文的结论,我没有复现)。

还有一种更隐蔽的「学坏」:微调版对任何输入都输出分诊 JSON,哪怕你问它「你好」。用运行时挂载时这反而不是问题,原版还在,别的请求走 `model="Qwen/Qwen3-4B-Instruct-2507"` 就行,这也是运行时挂载的一个好处。

### 零件和大代码的对照

| 零件 | 在哪学的 | 今天的位置 |
| --- | --- | --- |
| OpenAI 兼容端点 | Day 568 | `CANDIDATES` 里的 `base_url` |
| 示例的写法 | Day 570 `prompt_first.py` | `run_one` 里的 `few_shot` 分支 |
| 训练和推理同一段 system | Day 570 | `from build_sft_data import SYSTEM` |
| Wilson 区间 | Day 547 | `wilson`、`summarize` |
| P50 延迟 | Day 569 | `statistics.median` |
| 配对比较 | Day 548 | `paired_diff.py` |
| 评测集和训练集隔离 | Day 570 | `template_overlap.py`、`tickets_hard.jsonl` |
| LoRA 前向 | Day 572 | vLLM 的运行时挂载 |

## 动手练习

1. **评测集要多大**:用 `compare_models.py` 里的 `wilson`,假设真实全对率 80%,算一下评测集是 12、24、50、100、200、400 条时,区间各有多宽。要让区间宽度小于 20 个百分点,大约需要多少条?

<details><summary>参考答案</summary>

新建 `part10/how_many_cases.py`:

```python
# agent-zero-lab/part10/how_many_cases.py
"""评测集要多大,Wilson 区间才够窄:假设真实全对率 80%,看 n 从 12 到 400 区间宽度怎么变。"""
from compare_models import wilson

for n in (12, 24, 50, 100, 200, 400):
    k = round(0.8 * n)
    lo, hi = wilson(k, n)
    print(f"n={n:>3}  全对 {k:>3}  区间 [{lo:.0%}, {hi:.0%}]  宽 {hi - lo:.0%}")
```

<div class="line-notes">

- `from compare_models import wilson` 导入会执行 `compare_models.py` 顶层的 `load_dotenv()` 和读环境变量,`.env` 在就没问题。正因为调模型的代码在 `if __name__ == "__main__":` 里,导入不会去调 API。
- `k = round(0.8 * n)` 假设 80% 全对。n=24 时 0.8 × 24 = 19.2,四舍五入成 19。

</div>

```bash
uv run python part10/how_many_cases.py
```

```text
n= 12  全对  10  区间 [55%, 95%]  宽 40%
n= 24  全对  19  区间 [60%, 91%]  宽 31%
n= 50  全对  40  区间 [67%, 89%]  宽 22%
n=100  全对  80  区间 [71%, 87%]  宽 16%
n=200  全对 160  区间 [74%, 85%]  宽 11%
n=400  全对 320  区间 [76%, 84%]  宽 8%
```

12 条时区间宽 40 个百分点,基本说明不了什么。宽度小于 20 要 100 条左右(50 条是 22%)。区间宽度大约和条数的平方根成反比,条数翻 4 倍,宽度才减半:100 条 16%,400 条 8%。所以 `tickets_hard` 至少要扩到一百条上下,才能分辨几个百分点的差别。配对比较比两个独立区间更灵敏一些(Day 548),但 12 条怎么比都太少。

</details>

2. **按类别看**:写一个 `per_category.py`,读两份逐条结果,按类别统计「四个字段全对」的条数,对比 `tickets_hard` 上的零样本和加示例。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/per_category.py
"""按类别统计「四个字段全对」的条数,看微调版是哪几类涨了、哪几类掉了。
用法:uv run python part10/per_category.py part10/results/tickets_hard-deepseek-zero.jsonl part10/results/tickets_hard-deepseek-3shot.jsonl
"""
import json
import sys
from collections import defaultdict

from build_sft_data import KEYS


def per_cat(path: str) -> dict[str, tuple[int, int]]:
    hit: dict[str, int] = defaultdict(int)
    tot: dict[str, int] = defaultdict(int)
    for r in map(json.loads, open(path, encoding="utf-8")):
        cat = r["expected"]["category"]
        tot[cat] += 1
        hit[cat] += isinstance(r["pred"], dict) and all(r["pred"].get(k) == r["expected"][k] for k in KEYS)
    return {c: (hit[c], tot[c]) for c in tot}


a, b = per_cat(sys.argv[1]), per_cat(sys.argv[2])
print(f"{'类别':<12}{'A':>6}{'B':>6}")
for c in sorted(a, key=lambda c: -a[c][1]):
    print(f"{c:<12}{a[c][0]:>3}/{a[c][1]:<2}{b[c][0]:>3}/{b[c][1]:<2}")
```

<div class="line-notes">

- `from collections import defaultdict` 访问不存在的键时自动用默认值创建,`defaultdict(int)` 的默认值是 0。和 `Counter` 类似,这里用它是因为要两个计数器。
- `cat = r["expected"]["category"]` 按标准答案的类别分组,不按模型预测的。按预测分组,模型分错类的题会跑到别的组里去。
- `for c in sorted(a, key=lambda c: -a[c][1]):` 按题数从多到少排,`-` 号让大的排前面。

</div>

```bash
uv run python part10/per_category.py part10/results/tickets_hard-deepseek-zero.jsonl part10/results/tickets_hard-deepseek-3shot.jsonl
```

```text
类别               A     B
billing       1/2   1/2 
refund        1/2   1/2 
account       0/2   1/2 
technical     1/2   1/2 
invoice       1/1   1/1 
plan_change   0/1   0/1 
api           0/1   0/1 
other         0/1   0/1 
```

加示例只在 account 上多对了一条(就是 H007),其他类别不变。plan_change、api、other 两边都是 0,每类只有 1 道题,更说明不了什么。按类别看能告诉你「该往哪一类补数据」,但每类至少要几十道题,数字才有意义。真实项目里评测集按类别分层抽样,每类凑够数。

</details>

3. **加一个候选只改配置**:给 `CANDIDATES` 加一个 `deepseek-json`,零样本但打开 `response_format={"type": "json_object"}`,看 JSON 合法率和准确率有没有变化。复制成 `part10/compare_models_v2.py` 再改。

<details><summary>参考答案</summary>

在 `CANDIDATES` 里加一项:

```python
    "deepseek-json": {"base_url": os.environ["LLM_BASE_URL"], "key": os.environ["LLM_API_KEY"],
                      "model": os.environ["LLM_MODEL"], "few_shot": False, "price": (2, 8), "json_mode": True},
```

<div class="line-notes">

- `"model": os.environ["LLM_MODEL"], "few_shot": False, "price": (2, 8), "json_mode": True},` 多一个 `json_mode` 键,其他候选没有这个键。

</div>

`run_one` 里调用那两行换成:

```python
        extra: dict = {"response_format": {"type": "json_object"}} if c.get("json_mode") else {}
        resp = client.chat.completions.create(model=c["model"], messages=messages, temperature=0,
                                              max_tokens=200, extra_body=EXTRA if c["price"][0] else {}, **extra)
```

<div class="line-notes">

- `extra: dict = {"response_format": {"type": "json_object"}} if c.get("json_mode") else {}` 其他候选没有 `json_mode` 键,`get` 返回 None,走 `else`。
- `max_tokens=200, extra_body=EXTRA if c["price"][0] else {}, **extra)` `**extra` 把字典展开成关键字参数;空字典展开等于什么都没传。

</div>

```bash
uv run python part10/compare_models_v2.py part10/data/tickets_hard.jsonl deepseek-json
```

```text
deepseek-json   JSON 12/12  全对 4/12 [14%, 61%]  category=11  needs_ac=9  needs_hu=10  urgency=7  P50 0.67s  ¥0.0051
```

JSON 合法率本来就是 12/12,打开 JSON mode 没有变化;全对还是 4 条。`category` 变成了 11,和零样本的 12 差一条,打开 `results/tickets_hard-deepseek-json.jsonl` 看是哪条,很可能又是温度 0 的抖动。对大模型来说 JSON mode 在这个任务上是多余的保险。对还没微调的小模型,这个开关可能就是 JSON 合法率从八成到十成的差别,vLLM 也支持 `response_format`;但微调版评测时要关掉它,否则你测不出它自己学没学会只输出 JSON。

</details>

4. **写一页结论**(开放题):假设你已经填完了对比表的四行。写一页给团队看的结论,要回答:微调版能不能替代 deepseek-flash 做分诊;如果能,上线计划是什么;如果不能,差在哪、下一步做什么。先用今天已有的两行数据,写出「结论模板」里每一段要引用哪个数。

<details><summary>参考答案</summary>

示范解法(结论模板,方括号里是要填的数,来源写在后面):

**结论**:微调版 [能/不能] 替代 deepseek-flash 做分诊。
**证据**:在换了说法的评测集 `tickets_hard`(12 条,需扩到 100 条以上,见练习 1)上,微调版全对 [k/n][区间],DeepSeek 零样本 4/12 [14%, 61%];配对比较中只有微调版对的题 [a] 道、只有 DeepSeek 对的 [b] 道(`paired_diff.py`)。`urgency` 和 `needs_account_data` 这两个口径字段分别是 [x] 和 [y],DeepSeek 是 7/12 和 9/12。微调版在 `tickets_v1` 上是 [z],和 `tickets_hard` 的落差说明 [有/没有] 背模板。
**成本和延迟**:DeepSeek 每张工单约 0.0004 元、P50 0.74 秒;微调版 P50 [t] 秒,按 Day 569 的工作点和卡费折算每张 [c] 元,日均 [N] 张时每月差 [M] 元。
**风险**:遗忘检查 [结果];JSON 合法率 [v/12];哪些类别退步了(`per_category.py`)。
**下一步**:能替代就灰度,先 10% 流量,低置信度或 JSON 不合法的回退 DeepSeek;不能替代就看差在哪,差在口径字段就回 Day 570 补那几类的数据、增加说法的多样性,差在小类就补 api、other、plan_change。

用今天的实跑数据能先填上 DeepSeek 那一侧的所有数字,上面已经填好了。这道题的重点是:结论里每一句话都要能指到一个脚本的一行输出上,不说「效果明显提升」这种没有数的话。

</details>

验收标准:`compare_models.py` 对 DeepSeek 两个候选跑出和本文同一个量级的结果(温度 0 的抖动会让个别字段差一条);`template_overlap.py` 对 `tickets_v1` 输出 12 道、对 `tickets_hard` 输出 0 道;你能说出运行时挂载和合并各适合什么时候,以及 `--max-lora-rank` 为什么要改。今天的实跑花费约 0.06 元:`compare_models.py` 在 `tickets_v1` 上两个候选跑了两遍(约 0.014 × 2 = 0.028 元),在 `tickets_hard` 上跑了一遍(约 0.013 元),练习 3 约 0.005 元,加上调试时多跑的一遍约 0.014 元;每一遍的花费都在输出行最后的 ¥ 那一列。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 运行时挂载 | 推理服务加载一份基座、再加载 LoRA 适配器,按请求里的 model 名选用哪个 |
| 合并(merge) | 把 (alpha/r)·B@A 加进 W,存成一份完整的新模型,部署时不再需要 LoRA |
| `--enable-lora` | vLLM 打开 LoRA 支持的开关 |
| `--lora-modules` | vLLM 启动时挂哪些适配器,「名字=路径」,名字就是请求里的 model |
| `--max-lora-rank` | vLLM 允许的最大 rank,0.32.0 默认 16,r=32 的适配器要改 |
| `--max-loras` | 同一批计算里最多同时用几个不同的适配器,默认 1 |
| 动态加载 | 服务运行中用 `/v1/load_lora_adapter` 加新适配器,有安全风险,生产别开 |
| 候选 | 对比实验里的一个被测对象:一个服务 + 一个模型名 + 一种调用方式 |
| JSON 合法率 | 输出能被 `json.loads` 解析的比例,不用 `response_format` 兜底时才测得出来 |
| P50 | 第 50 百分位,也就是中位数,今天 DeepSeek 约 0.74 秒 |
| 模板泄漏 | 评测题和训练样本出自同一个出处(模板、客户、FAQ),内容不同但口径相同,指纹查不出 |
| 换说法评测集 | 不出自任何训练模板的评测集,今天手写的 `tickets_hard.jsonl` |
| 灾难性遗忘 | 微调后原来会的通用能力变差,LoRA 比全量微调轻 |

## 常见误区

**用训练集的「兄弟」当评测集。** 今天 `tickets_v1` 的 12 道题在训练集里都有同模板的十几条兄弟,微调版背住模板就能满分。评测集要和训练集在出处上隔离,不只是内容。

**给微调版也加 few-shot 示例。** 它训练时没见过示例,推理时加了反而改变了输入分布。微调版的调用方式要和训练样本一模一样:同一段 system、不加示例。

**评测微调版时打开 JSON mode。** `response_format` 会替模型兜底,你就测不出它自己有没有学会只输出 JSON。原版小模型可以开着做参照,微调版评测时关掉。

**r=32 的适配器用默认参数挂到 vLLM。** vLLM 0.32.0 的 `--max-lora-rank` 默认是 16,不改就加载不上。启动命令里显式写 `--max-lora-rank`,和训练时的 r 对上。

**两个候选不在同一张卡上比延迟。** DeepSeek 走公网、vLLM 在 Colab 上,延迟差别里混着网络和硬件。比「LoRA 带来的变化」要用同一个 vLLM 里的原版和微调版,运行时挂载正好做到这一点。

**12 条评测集上差一条就下结论。** 12 条的 Wilson 区间宽 40 个百分点。今天零样本和加示例都是 3/12,`urgency` 一个涨了两条、`needs_human` 一个掉了一条,这些都可能是抖动。扩到 100 条以上再谈几个百分点的差别。

**只比总分不配对。** 两个候选总分一样(都是 3/12),逐条看却是在不同的题上对错。配对比较能告诉你「谁在哪几道题上翻了」,这才是改数据、改提示词的依据。

**生产环境打开动态加载。** `VLLM_ALLOW_RUNTIME_LORA_UPDATING` 让任何能访问接口的人往服务里塞权重。只在隔离的实验环境里用。

## 学习资料

### 文档与文章

- [vLLM · LoRA Adapters](https://docs.vllm.ai/en/latest/features/lora.html):今天所有 vLLM 参数的出处,`--lora-modules` 的 JSON 写法、动态加载和它的安全提醒、`/v1/models` 里适配器怎么显示,都在这一页。
- [Unsloth · vLLM Deployment Guide](https://unsloth.ai/docs/basics/inference-and-deployment/vllm-guide):Unsloth 训出来的模型怎么保存成 vLLM 能读的格式,合并和只存适配器两条路都讲了。
- [PEFT · LoRA 开发指南](https://huggingface.co/docs/peft/main/en/developer_guides/lora):找「Merge LoRA weights into the base model」那一节,`merge_and_unload` 的用法。
- [LoRA Learns Less and Forgets Less](https://arxiv.org/abs/2405.09673):LoRA 和全量微调在「学了多少、忘了多少」上的对照实验,读摘要和结论。
- [EleutherAI · lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness):做遗忘检查时常用的通用基准评测工具,能对 OpenAI 兼容端点跑标准任务,看微调前后通用能力有没有掉。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SvJZ6AERB&autoplay=0&high_quality=1" title="vllm私有化部署lora微调权重合并模型" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小易老师AI实战 · vllm私有化部署lora微调权重合并模型 · 约 4 分钟,演示合并后的模型用 vLLM 部署,对应「合并成完整模型」那条路,我没法实跑的部分可以看这个。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1yaUiYBEyo&autoplay=0&high_quality=1" title="20个问题搞懂LLM评估与lm-eval的用法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI开发者-就爱瞎鼓捣 · 20个问题搞懂LLM评估与lm-eval的用法 · 约 14 分钟,讲微调前后怎么评估、怎么用 lm-eval 查通用能力有没有掉,对应「学坏了没有」那一节。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ZalNVkpZoUw" title="Serve Multiple LoRA Adapters on a Single GPU" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Trelis Research · Serve Multiple LoRA Adapters on a Single GPU · 一张卡上挂多个 LoRA、按请求切换的完整演示,就是今天那张图在真机上的样子。英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/DXo6LUR_98I" title="MULTI-LoRA SERVING | Serving 100 Custom Fine-Tuned Models on 1 GPU" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Insight Ops · MULTI-LoRA SERVING | Serving 100 Custom Fine-Tuned Models on 1 GPU · 讲为什么一个基座能服务很多个微调版,以及 max-loras 这类参数背后的取舍。英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 3、4 章讲评测方法,其中讨论了数据污染(评测数据混进训练数据),和今天的模板泄漏是同一类问题;第 7 章讲微调和 LoRA。

### 开源项目与代码

- [vllm-project/vllm](https://github.com/vllm-project/vllm):`vllm/config/lora.py` 里能看到 `max_lora_rank` 的默认值和可选值,今天就是从这里查的。
- [huggingface/peft](https://github.com/huggingface/peft):适配器的保存格式(`adapter_config.json`、`adapter_model.safetensors`)和合并逻辑。
- [unslothai/notebooks](https://github.com/unslothai/notebooks):Qwen3 (4B) Instruct 笔记本最后几个单元就是各种保存和合并方式。

## 自测

1. 运行时挂载和合并,各自最适合什么情况?

<details><summary>答案</summary>

运行时挂载:有多个微调版(每个任务一个适配器)、还在迭代、要和原版在同一张卡上对比,显存只多几十 MB 一个。合并:定型了只用一个微调版,或者部署环境不支持 LoRA、要转成 GGUF 给 Ollama 用,好处是推理和原版一样快、部署不需要额外参数。

</details>

2. vLLM 启动时挂一个 r=32 的适配器加载失败,最可能是什么原因?

<details><summary>答案</summary>

`--max-lora-rank` 没改。vLLM 0.32.0 默认是 16,适配器的 r 超过它就加载不上。启动命令加 `--max-lora-rank 32`,和训练时的 r 对上,别设得远大于需要。

</details>

3. 微调版在 `tickets_v1` 上 12/12,在 `tickets_hard` 上 5/12,说明什么?下一步做什么?

<details><summary>答案</summary>

说明它背住了训练模板,没学会口径。`tickets_v1` 的每道题在训练集里都有同模板的兄弟。下一步不是调训练参数,而是回到 Day 570 提高训练数据的多样性:同一个口径用很多种说法写,让模型学的是「什么样的问题算 low」,不是「这个主题输出 low」。

</details>

4. 为什么评测微调版时不该给它加 few-shot 示例、也不该打开 JSON mode?

<details><summary>答案</summary>

它训练时的输入是「system + 一张工单」,加示例会改变输入分布,测出来的不是它平时上线的表现;JSON mode 会替模型兜底,测不出它自己有没有学会只输出 JSON。评测时的调用方式要和上线时一样,上线时也不该依赖这两样。

</details>

5. (面试题)你微调了一个分诊小模型,怎么向团队证明它可以替代现在用的大模型 API?

<details><summary>答案</summary>

用同一套对比流程说话。评测集用和训练集在出处上隔离的那份(换了说法、不同客户、不同写题人),至少一百条、按类别分层,报带区间的全对率和逐字段准确率。候选包括 API 基线、原版小模型、微调版,原版和微调版在同一个 vLLM 里用运行时挂载跑,排除硬件差异。逐条配对比较,看「只有微调版对」和「只有 API 对」各几道,按类别看退步在哪。再报 JSON 合法率、P50 延迟、按卡费折算的每张工单成本,和 API 的成本比。最后做遗忘检查。结论里每一句都对应一个脚本的输出,灰度上线时保留 API 兜底低置信度和 JSON 不合法的请求。

</details>

## 明天预告

Day 575 · DPO(一):从 RLHF 到 DPO,变体,偏好数据从哪来。SFT 教模型「这道题的标准答案是什么」,可很多时候没有唯一的标准答案,只知道两个回答里哪个更好:客服回复哪个语气更合适、哪个更啰嗦。明天讲怎么用「A 比 B 好」这种偏好数据继续训练模型,从 RLHF 讲到今天最常用的 DPO,以及这种数据从哪里来。
