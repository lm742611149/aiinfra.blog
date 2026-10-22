---
title: 'Day 571 · 微调(二):工具调用的训练数据格式、chat template 和清洗'
description: '工具调用的训练样本里多了工具定义和工具往返,格式坑比分诊多得多。今天先把样本按 Qwen3 的 chat template 渲染出来,看清模型实际学的是哪段文字;再写一个清洗脚本挑出坏样本,最后用 MinHash 试一次近似去重,看它在短问题上为什么不太灵。'
pubDate: 2026-10-22
regime: none
tags: ['fine-tuning', 'tool-calling', 'chat-template', 'dedup', 'agent-zero']
series: 'agent-zero'
day: 571
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 570](/blog/agent-zero/day-570-finetune-1/) 我们先用真实调用证明了分诊的 `category` 靠提示词就能拿满分,值得微调的是 `urgency` 这类团队口径;然后写了 `build_sft_data.py`,把 502 条原始记录整理成 297 条训练集,一路丢掉了坏标签、重复和混进来的评测题。那份样本只有三段:system、user、assistant 回一段 JSON。Agent 里还有一类更常见的微调需求:小模型选工具老选错、参数老填漏。这种样本里多了工具定义和工具往返,样本存成什么格式、模型实际看到的是什么文字、哪些样本是脏的,都要重新想一遍。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清 **chat template** 是什么:一段 messages 加 tools 是怎么被渲染成模型真正读的那串文字的;能自己渲染一条工具调用样本,并从结果里认出 Qwen3 的 Hermes 风格工具格式。
2. 知道为什么训练样本要存结构化的 messages 加 tools,而不是自己拼字符串,以及 vLLM 那边的 `--tool-call-parser` 为什么必须和训练格式对上。
3. 写一个工具调用样本的清洗脚本,挑出调用了不存在的工具、参数是坏 JSON、漏必填参数、调用没配上结果、轨迹没收尾的样本,并做精确去重;试一次 MinHash 近似去重,知道它在什么场景好用、什么场景不灵。

预计用时 2.5 小时。前置:[Day 95](/blog/agent-zero/day-095-json-schema/)(JSON Schema)、[Day 157](/blog/agent-zero/day-157-tool-schema/)(工具定义)、[Day 158](/blog/agent-zero/day-158-fc-first-run/)(第一次跑通工具调用)、[Day 162](/blog/agent-zero/day-162-parallel-tools/)(并行工具调用)、[Day 570](/blog/agent-zero/day-570-finetune-1/)。今天不调任何 API,一分钱不花,也不需要 GPU,只需要从网上下载一个 9 KB 的配置文件。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`render_tool_sample.py` 的 `main` 和 `check_tool_sft.py` 的 `problems`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 模型其实不认识 messages

你调 API 时传的是一个 messages 数组,每条有 `role` 和 `content`,工具调用时还有 `tool_calls`。很容易以为模型「看到」的就是这个 JSON。其实不是。模型只认一串文字(准确说是一串 token),服务端在把你的请求喂给模型之前,先把 messages 按一个模板拼成一段长文本。这个模板就叫 **chat template**(对话模板)。

前端同学可以这样理解:messages 是你传给组件的 props,chat template 是组件的 render 函数,模型读到的文本是渲染出来的 HTML。props 一样,换一个组件(换一个模型),渲染出来的 HTML 完全不同。每家模型的模板都不一样,Qwen 用 `<|im_start|>` 这种标记,Llama 用另一套,Gemma 又是一套。

这件事平时调 API 你不用管,服务端替你渲染了。可一旦要微调,它就变成头等大事:**训练时模型看到的文本,必须和推理时服务端渲染出来的文本一模一样**。训练时你用 A 格式教它「这样调工具」,上线时 vLLM 用 B 格式拼提示词,模型就对不上号。

所以今天的结论先说在前面:**训练样本存结构化的 messages 加 tools,不要自己拼字符串,让基座模型自带的 chat template 去渲染**。这样训练和推理用的是同一个模板,天然一致。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="同一份 messages 和 tools,训练和推理都经过同一个 chat template">
<rect x="20" y="80" width="150" height="60" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="95" y="105" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">messages + tools</text>
<text x="95" y="124" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">样本里存这个</text>
<rect x="230" y="80" width="160" height="60" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="310" y="105" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">chat template</text>
<text x="310" y="124" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">基座自带的 Jinja2</text>
<rect x="450" y="20" width="170" height="60" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="535" y="45" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">训练文本</text>
<text x="535" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">add_generation_prompt=False</text>
<rect x="450" y="140" width="170" height="60" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="165" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">推理提示词(vLLM)</text>
<text x="535" y="184" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">add_generation_prompt=True</text>
<line x1="170" y1="110" x2="230" y2="110" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="390" y1="100" x2="450" y2="55" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="390" y1="120" x2="450" y2="165" stroke="var(--rule)" stroke-width="1.5"/>
<text x="535" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">两边必须一致</text>
<text x="310" y="170" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">模型输出 &lt;tool_call&gt;…</text>
<text x="310" y="188" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">→ hermes parser 解析回 tool_calls</text>
</svg>
<figcaption>同一份结构化样本,训练时渲染成完整文本,推理时渲染成以 assistant 开头结尾的提示词。模型输出的文字再由 vLLM 的 parser 解析回 API 里的 tool_calls 字段。</figcaption>
</figure>

## 第一步:拿到模板,渲染一条普通对话

chat template 就存在模型仓库的 `tokenizer_config.json` 里,`chat_template` 字段,是一段 **Jinja2** 模板。Jinja2 是 Python 世界最常用的模板引擎,`{{ 变量 }}` 输出值、`{% if %}` `{% for %}` 写逻辑,和前端的 Handlebars、Nunjucks 是一家(Nunjucks 就是照着 Jinja2 做的 JS 版)。

我们不用下载几 GB 的模型权重,只要这一个 9 KB 的配置文件。国内直接访问 Hugging Face 经常不通,我这次 hf-mirror 镜像也连不上,ModelScope(魔搭社区)上的同名仓库可以下:

```bash
cd agent-zero-lab
mkdir -p part10/qwen3
curl -sL https://modelscope.cn/models/Qwen/Qwen3-4B-Instruct-2507/resolve/master/tokenizer_config.json \
  -o part10/qwen3/tokenizer_config.json
# 备选:https://hf-mirror.com/Qwen/Qwen3-4B-Instruct-2507/raw/main/tokenizer_config.json
ls -la part10/qwen3/
uv add jinja2
```

下载下来是 9,377 字节,`chat_template` 字段 2,630 个字符(2026 年 10 月查到;jinja2 当前版本 3.1.6)。用文本编辑器打开能看到它,下面渲染完再回头对照着读。

新建 `part10/render_chat.py`,先渲染一条不带工具的普通对话:

```python
# agent-zero-lab/part10/render_chat.py
"""不带工具,先看一条普通对话被 Qwen3 的 chat template 渲染成什么文本。
用法:uv run python part10/render_chat.py part10/qwen3/tokenizer_config.json
"""
import json
import sys

from jinja2.sandbox import ImmutableSandboxedEnvironment

MESSAGES = [
    {"role": "system", "content": "你是 CloudLedger 客服助手。"},
    {"role": "user", "content": "发票能开专票吗?"},
    {"role": "assistant", "content": "可以,在「设置 → 发票信息」里填好税号就能开。"},
]

config = json.load(open(sys.argv[1], encoding="utf-8"))
env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True)
template = env.from_string(config["chat_template"])
print(template.render(messages=MESSAGES, add_generation_prompt=False))
print("----- 推理时 add_generation_prompt=True,只给前两条 -----")
print(template.render(messages=MESSAGES[:2], add_generation_prompt=True))
```

<div class="line-notes">

- `from jinja2.sandbox import ImmutableSandboxedEnvironment` 沙箱版的 Jinja2 环境,模板里不能调用危险操作、不能修改传进去的数据。模型仓库里的模板是别人写的代码,用沙箱跑是对的;Hugging Face 的 transformers 库渲染 chat template 时用的也是它。
- `MESSAGES = [` 和调 API 时的 messages 一模一样,三条:system、user、assistant。
- `config = json.load(open(sys.argv[1], encoding="utf-8"))` 读 `tokenizer_config.json`,命令行第一个参数是它的路径。
- `env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True)` 两个开关去掉模板标签带来的多余换行和缩进。模板里每个 `{%- if %}` 都单独占一行,不开这两个开关,渲染结果会多出一堆空行和空格,和真实训练文本对不上。transformers 渲染时也开了这两个。
- `template = env.from_string(config["chat_template"])` 把模板字符串编译成模板对象,相当于前端模板引擎的 `compile(str)`。
- `print(template.render(messages=MESSAGES, add_generation_prompt=False))` 传进去的变量名 `messages`、`add_generation_prompt` 是模板里约定好的,模板里写的就是 `{%- for message in messages %}`。`False` 表示这是一条完整的训练样本。
- `print(template.render(messages=MESSAGES[:2], add_generation_prompt=True))` 推理时的情况:只有 system 和 user,`True` 让模板在末尾加上 `<|im_start|>assistant`,等模型接着往下写。

</div>

```bash
uv run python part10/render_chat.py part10/qwen3/tokenizer_config.json
```

```text
<|im_start|>system
你是 CloudLedger 客服助手。<|im_end|>
<|im_start|>user
发票能开专票吗?<|im_end|>
<|im_start|>assistant
可以,在「设置 → 发票信息」里填好税号就能开。<|im_end|>

----- 推理时 add_generation_prompt=True,只给前两条 -----
<|im_start|>system
你是 CloudLedger 客服助手。<|im_end|>
<|im_start|>user
发票能开专票吗?<|im_end|>
<|im_start|>assistant

```

这就是模型真正读到的东西。每条消息被 `<|im_start|>角色` 和 `<|im_end|>` 包起来,这种格式叫 **ChatML**。`<|im_start|>`、`<|im_end|>` 是**特殊 token**:它们在分词器里各是一个完整的 token,普通文字拼不出来,模型靠它们分辨「一条消息从哪开始、到哪结束」。

对比两段输出就看懂了训练和推理的关系。推理时文本停在 `<|im_start|>assistant` 后面,模型的任务是接着写,写完自己吐一个 `<|im_end|>` 表示说完了。训练时这段话已经写好在那里,模型学的正是「看到前面这些,接下来该写出这段回答和 `<|im_end|>`」。如果训练时漏了 `<|im_end|>`,模型学不会停,上线以后就会一直往下编。

## 第二步:渲染一条工具调用样本

一条工具调用样本比分诊多两样东西。顶层一个 `tools` 列表,和 [Day 157](/blog/agent-zero/day-157-tool-schema/) 传给 API 的完全同一种 JSON Schema;messages 里多了 assistant 发起的 `tool_calls` 和 role 为 `tool` 的结果。多步任务就是中间多几轮调用和结果。

新建 `part10/render_tool_sample.py`:

```python
# agent-zero-lab/part10/render_tool_sample.py
"""把一条工具调用样本按 Qwen3 的 chat template 渲染成训练文本,检查格式。
用法:uv run python part10/render_tool_sample.py part10/qwen3/tokenizer_config.json
"""
import json
import sys

from jinja2.sandbox import ImmutableSandboxedEnvironment

TOOLS = [{
    "type": "function",
    "function": {
        "name": "get_invoice",
        "description": "按发票号查询 CloudLedger 发票,返回金额、状态、到期日",
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
    {"role": "assistant", "content": "这张发票金额 199 元,到期日是 10 月 30 日,还没到期,所以状态是未付款。"},
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

- `TOOLS = [{` 和 Day 158 传给 `chat.completions.create(tools=...)` 的是同一种结构。训练样本里存的就是它,怎么变成文字交给模板。
- `"required": ["invoice_id"],` 必填参数列表。后面的清洗脚本会拿它检查样本里的调用有没有漏填。
- `{"role": "assistant", "content": "", "tool_calls": [` 发起调用的那一轮 assistant,content 是空串。Qwen3 模板里 content 为空时,不会在 `<tool_call>` 前面多插一个换行(模板里 `if (loop.first and content)` 那一句管这个)。
- `"arguments": {"invoice_id": "INV-2026-0012"}}}]},` 这里给的是字典。模板两种都接受:字符串原样输出,字典走 `tojson` 过滤器转成 JSON。从 OpenAI 格式的日志导出的通常是字符串;字符串里如果是坏 JSON,模板不会帮你检查,会原样渲染进训练文本。
- `{"role": "tool", "content": json.dumps(` 工具结果。注意看下面的输出,Qwen3 会把它渲染进一个 **user** 轮里的 `<tool_response>` 块,不是单独的 tool 角色。
- `env.filters["tojson"] = lambda x, **kw: json.dumps(x, ensure_ascii=False)` 覆盖 `tojson` 过滤器。`lambda` 相当于箭头函数,`**kw` 接住模板可能传来的额外参数(比如缩进)并忽略。为什么要覆盖,下一节故意不覆盖跑一次就知道。
- `text = env.from_string(template).render(messages=SAMPLE, tools=TOOLS, add_generation_prompt=False)` 比上一步多传了 `tools`。模板第一行就是 `{%- if tools %}`,有工具时走另一套 system 写法。

</div>

```bash
uv run python part10/render_tool_sample.py part10/qwen3/tokenizer_config.json
```

本机跑出来的完整文本(没有省略):

```text
<|im_start|>system
你是 CloudLedger 客服助手。

# Tools

You may call one or more functions to assist with the user query.

You are provided with function signatures within <tools></tools> XML tags:
<tools>
{"type": "function", "function": {"name": "get_invoice", "description": "按发票号查询 CloudLedger 发票,返回金额、状态、到期日", "parameters": {"type": "object", "properties": {"invoice_id": {"type": "string", "description": "形如 INV-2026-0012"}}, "required": ["invoice_id"]}}}
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
这张发票金额 199 元,到期日是 10 月 30 日,还没到期,所以状态是未付款。<|im_end|>
```

这段文本能读出四件事。

**工具定义整段进了 system。** 你的 system 说明后面,模板自动追加了一段英文说明和 `<tools>` 块,每个工具一行 JSON。一个工具就一百多 token,十几个工具时每条样本光定义就上千 token。训练时设的最大序列长度要按这个算,不然样本会被截断,截掉的恰恰可能是最后的回答。

**模型要学会输出的是 `<tool_call>` 包着的一行 JSON。** 这就是 Qwen 官方文档说的 **Hermes 风格**(最早来自 NousResearch 的 Hermes 系列模型,后来很多模型沿用)。API 里的 `tool_calls` 字段是服务端从这段文字里解析出来的。vLLM 起 Qwen3 时要加 `--enable-auto-tool-choice --tool-call-parser hermes`(Qwen 文档 2026 年 10 月的写法),parser 告诉 vLLM「用 Hermes 的规则把 `<tool_call>` 块解析回 `tool_calls`」。parser 和训练格式对不上时,会出现一种很迷惑的现象:模型的输出明明是对的,接口返回的 `tool_calls` 却是空的,一段 `<tool_call>` 原样躺在 `content` 里。

**工具结果被包进了 user 轮。** `<tool_response>` 在一个 `<|im_start|>user` 里。这对训练是好事。Day 572 训练时会只对 assistant 段算损失(上一课讲过损失),切分的依据就是 `<|im_start|>assistant` 和 `<|im_start|>user` 这两个标记。工具结果落在 user 部分会被遮掉,模型不会去学「编造工具返回值」,两轮 assistant(发起调用、最后回答)都参与训练。

**换一个基座,上面这些全都不一样。** Llama、Gemma、Mistral 的格式完全不同,所以换基座时这个渲染检查要再做一遍。Hugging Face Agents Course 的 Bonus Unit 1 讲的就是给 gemma-2-2b-it 做工具调用微调,那个基座的模板原本不支持工具,课程里自己给模板加了工具调用的标记,代价是推理服务那边也得配同一份模板和 parser。能选原生支持工具调用的基座,就别自己加。

### 故意踩一次坑:不覆盖 tojson

把 `env.filters["tojson"] = ...` 那一行注释掉,复制成 `render_no_filter.py` 再跑:

```bash
sed 's/^    env.filters\["tojson"\]/    # env.filters["tojson"]/' part10/render_tool_sample.py > part10/render_no_filter.py
uv run python part10/render_no_filter.py part10/qwen3/tokenizer_config.json
```

程序没有报错,这才是它危险的地方。看 `<tools>` 里那一行:

```text
{"function": {"description": "按发票号查询 CloudLedger 发票,返回金额、状态、到期日", "name": "get_invoice", "parameters": {"properties": {"invoice_id": {"description": "形如 INV-2026-0012", "type": "string"}}, "required": ["invoice_id"], "type": "object"}}, "type": "function"}
```

两处不一样。中文全变成了 `\uXXXX`,因为 Jinja2 自带的 `tojson` 默认把非 ASCII 字符转义,还会转义 `<`、`>` 这类 HTML 字符;键的顺序也被排过序了(`function` 跑到了 `type` 前面)。transformers 渲染时用的是自己的 `tojson`,中文原样输出、键不排序。你在本地检查时看到的文本和真实训练时的文本就不一样了,检查也就白做了。这种「不报错但悄悄不一致」的问题,只有把渲染结果打印出来逐行看才能发现。

## 第三步:清洗工具调用样本

工具调用的样本多半来自线上轨迹(Langfuse 导出,[Day 484](/blog/agent-zero/day-484-obs-langfuse/))或者强模型生成,脏数据的花样比分诊多:调用了工具列表里没有的工具;参数是截断的 JSON;漏了必填参数;发起了调用却没配上结果;轨迹停在半路没有最终回答。这些样本留着,模型就学会了同样的毛病。

先造 8 条样本,2 条正常、1 条只差空格的重复、1 条不需要工具的问答、4 条各带一种毛病。新建 `part10/make_tool_samples.py`:

```python
# agent-zero-lab/part10/make_tool_samples.py
"""造 8 条工具调用样本:2 条正常、1 条只差空格的重复、1 条不用工具的问答、4 条各带一种毛病。
用法:uv run python part10/make_tool_samples.py
"""
import json
from pathlib import Path

TOOLS = [{"type": "function", "function": {
    "name": "get_invoice", "description": "按发票号查询 CloudLedger 发票",
    "parameters": {"type": "object", "properties": {"invoice_id": {"type": "string"}},
                   "required": ["invoice_id"]}}}]
SYS = {"role": "system", "content": "你是 CloudLedger 客服助手。"}


def call(name: str, args: dict | str) -> dict:
    return {"role": "assistant", "content": "", "tool_calls": [
        {"id": "call_1", "type": "function", "function": {"name": name, "arguments": args}}]}


def tool(result: dict) -> dict:
    return {"role": "tool", "tool_call_id": "call_1", "content": json.dumps(result, ensure_ascii=False)}


def final(text: str) -> dict:
    return {"role": "assistant", "content": text}


OK_RESULT = {"status": "open", "amount": 199, "due": "2026-10-30"}
SAMPLES = [
    # 1 正常
    [SYS, {"role": "user", "content": "INV-2026-0012 为什么还是未付款?"},
     call("get_invoice", '{"invoice_id": "INV-2026-0012"}'), tool(OK_RESULT), final("还没到期,10 月 30 日到期。")],
    # 2 和 1 只差空格,回答措辞不同
    [SYS, {"role": "user", "content": "INV-2026-0012  为什么 还是未付款?"},
     call("get_invoice", '{"invoice_id": "INV-2026-0012"}'), tool(OK_RESULT), final("它 10 月 30 日才到期。")],
    # 3 不需要工具,直接回答
    [SYS, {"role": "user", "content": "你们支持开增值税专票吗?"}, final("支持,在「设置 → 发票信息」填好税号即可。")],
    # 4 调用了不存在的工具
    [SYS, {"role": "user", "content": "INV-2026-0031 帮我退款"},
     call("refund", '{"invoice_id": "INV-2026-0031"}'), tool({"ok": True}), final("已经提交退款。")],
    # 5 漏了必填参数
    [SYS, {"role": "user", "content": "我最近那张发票多少钱?"},
     call("get_invoice", {}), tool({"error": "missing invoice_id"}), final("查不到。")],
    # 6 参数是被截断的 JSON
    [SYS, {"role": "user", "content": "INV-1 状态是什么?"},
     call("get_invoice", '{"invoice_id": "INV-1"'), tool(OK_RESULT), final("是 open。")],
    # 7 调用以后没有 tool 结果
    [SYS, {"role": "user", "content": "INV-2026-0040 到期了吗?"},
     call("get_invoice", '{"invoice_id": "INV-2026-0040"}'), final("还没到期。")],
    # 8 正常,另一个问题
    [SYS, {"role": "user", "content": "INV-2026-0088 金额是多少?"},
     call("get_invoice", '{"invoice_id": "INV-2026-0088"}'),
     tool({"status": "paid", "amount": 2376, "due": "2026-09-30"}), final("2376 元,已经付清。")],
]

if __name__ == "__main__":
    out = Path(__file__).parent / "data" / "tool_sft_raw.jsonl"
    with open(out, "w", encoding="utf-8") as f:
        for msgs in SAMPLES:
            f.write(json.dumps({"tools": TOOLS, "messages": msgs}, ensure_ascii=False) + "\n")
    print(f"写入 {len(SAMPLES)} 条 → {out.name}")
```

<div class="line-notes">

- `def call(name: str, args: dict | str) -> dict:` 三个小工具函数,把样本写短。`dict | str` 表示参数可以是字典也可以是字符串,相当于 TS 的 `Record<string, unknown> | string`。
- `{"id": "call_1", "type": "function", "function": {"name": name, "arguments": args}}]}` OpenAI 格式里每个调用有 `id`,tool 结果用 `tool_call_id` 对上它。Qwen3 的模板不渲染 id,但存着它,换成别的需要 id 的模板时还能用。
- `call("get_invoice", '{"invoice_id": "INV-2026-0012"}')` 这次参数给的是字符串,和线上日志导出的一样。
- `call("get_invoice", {}), tool({"error": "missing invoice_id"}), final("查不到。")` 第 5 条:漏参数,工具报错,最后敷衍一句。真实轨迹里常见,模型乱调一通,用户什么也没得到。
- `call("get_invoice", '{"invoice_id": "INV-1"'),` 第 6 条少一个右花括号。模型输出被 `max_tokens` 截断时就是这个样子。
- `call("get_invoice", '{"invoice_id": "INV-2026-0040"}'), final("还没到期。")]` 第 7 条:调了工具,紧接着就回答了,中间没有结果。真实 API 收到这种消息序列会直接报 400。
- `if __name__ == "__main__":` 写文件放在这个判断里,别的脚本 `import` 这个文件拿 `TOOLS`、`call` 时就不会顺手把数据文件重写一遍。我第一版没加,练习 3 一导入它就多打印了一行「写入 8 条」,这就是导入时执行了副作用。

</div>

```bash
uv run python part10/make_tool_samples.py
```

```text
写入 8 条 → tool_sft_raw.jsonl
```

清洗脚本按样本逐条检查。新建 `part10/check_tool_sft.py`:

```python
# agent-zero-lab/part10/check_tool_sft.py
"""工具调用 SFT 样本的清洗检查:结构、工具名、参数、去重。
用法:uv run python part10/check_tool_sft.py part10/data/tool_sft_raw.jsonl part10/data/tool_sft_clean.jsonl
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
    seen: set[str] = set()
    kept: list[dict] = []
    dropped: Counter[str] = Counter()
    for line in open(src, encoding="utf-8"):
        if not line.strip():
            continue
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

- `tools = {t["function"]["name"]: t["function"]["parameters"] for t in sample["tools"]}` 把这条样本自带的工具列表变成「工具名 → 参数 schema」的字典。每条样本带自己的工具列表,因为线上不同场景挂的工具不一样。
- `msgs, out = sample["messages"], []` 一次给两个变量赋值。
- `for call in m.get("tool_calls") or []:` 没有 `tool_calls` 的消息 `get` 返回 None,`or []` 让循环直接跳过。
- `if fn["name"] not in tools:` 第 4 条调用了 `refund`,工具列表里只有 `get_invoice`,在这里被抓到。线上轨迹里这种情况多半是模型幻觉出的工具名,API 当时报了错,日志照样记了下来。
- `if isinstance(args, str):` 字符串就先解析,字典直接用。
- `except json.JSONDecodeError:` 第 6 条的 `'{"invoice_id": "INV-1"'` 在这里被抓到。`try/except` 相当于 JS 的 `try/catch`。
- `missing = set(tools[fn["name"]].get("required", [])) - set(args)` 必填参数集合减去实际给的参数名([Day 25](/blog/agent-zero/day-025-sets/) 的集合差)。第 5 条传了空字典,结果是 `{'invoice_id'}`。这里只查必填项;想连类型一起查,可以换成 [Day 95](/blog/agent-zero/day-095-json-schema/) 的 `jsonschema.validate`。
- `replies = msgs[i + 1:i + 1 + n_calls]` 发起几个调用,后面就该紧跟几条 tool 消息。第 7 条调用之后直接是 assistant 回答,`replies` 里那条的 role 是 assistant,判为没配上结果。
- `if msgs[-1]["role"] != "assistant" or msgs[-1].get("tool_calls"):` 轨迹必须以文字回答收尾。`msgs[-1]` 是最后一个元素,相当于 JS 的 `msgs.at(-1)`。停在 tool 结果或停在一次调用上的,多半是运行中途超时或被中断。
- `return hashlib.md5("".join(user.split()).encode()).hexdigest()` 指纹只取用户说的话,去掉所有空白。第 2 条和第 1 条只差空格、回答措辞不同,算重复。同一个问题留多种回答对工具调用帮助不大,反而让这类问题的权重偏大。
- `dropped[errs[0].split("条", 1)[-1]] += 1` 只按第一个问题计数,去掉「第 i 条」前缀方便汇总。`split("条", 1)` 只在第一个「条」处切一刀,`[-1]` 取后半截。
- `calls = Counter(` 统计保留下来的样本里各有几轮工具调用,下面讲配比时要看这个分布。

</div>

```bash
uv run python part10/check_tool_sft.py part10/data/tool_sft_raw.jsonl part10/data/tool_sft_clean.jsonl
```

```text
保留 3 条,丢弃 5 条:{'重复': 1, '调用了不存在的工具 refund': 1, "缺必填参数 ['invoice_id']": 1, '参数不是合法 JSON': 1, '的 1 个调用没有全部配上 tool 结果': 1}
按工具调用轮数分布:{0: 1, 1: 2}
```

埋的 5 个雷全部抓到,留下第 1、3、8 条:2 条各调一次工具,1 条不调工具。检查顺序和昨天一样,先查结构再去重:第 2 条之所以算「重复」,是因为和它撞车的第 1 条是干净的、已经进了 `seen`。

## 第四步:换了说法的重复怎么办

上面是精确去重:规范化以后一模一样才算重复。真实数据里更多的是「换了说法的同一个问题」。数据量上来以后,常用的办法是 **MinHash**:把每句话切成很多个小片段,用片段集合的重合程度(**Jaccard 相似度**:交集大小除以并集大小)判断两句话像不像。两两精确计算太慢,MinHash 用一组哈希函数给每句话算一个短「签名」,签名越像,Jaccard 越高,算起来飞快;再配合 **LSH**(局部敏感哈希)分桶,只比较落在同一个桶里的句子,几百万条也处理得动。

试一下。先装 `datasketch`(2026 年 10 月 PyPI 上是 2.0.0):

```bash
uv add datasketch
```

新建 `part10/near_dup.py`,6 个问题里有 3 个是同一件事(问 INV-2026-0012 为什么未付款),2 个是同一件事(能不能开专票):

```python
# agent-zero-lab/part10/near_dup.py
"""近似去重:用 MinHash 估算两句话的字符片段重合度,找出「换了说法的同一个问题」。
用法:uv run python part10/near_dup.py
"""
from datasketch import MinHash, MinHashLSH

QUESTIONS = [
    "INV-2026-0012 这张发票为什么还是未付款?",
    "请问 INV-2026-0012 这张发票为什么一直显示未付款",
    "INV-2026-0012 为啥还是未付款状态?",
    "INV-2026-0088 金额是多少?",
    "你们支持开增值税专票吗?",
    "能开增值税专用发票吗?",
]


def shingles(text: str, n: int = 3) -> set[str]:
    s = "".join(text.split())
    return {s[i:i + n] for i in range(len(s) - n + 1)}


def minhash(text: str) -> MinHash:
    m = MinHash(num_perm=128, seed=1)
    for sh in shingles(text):
        m.update(sh.encode("utf-8"))
    return m


hashes = [minhash(q) for q in QUESTIONS]
print("两两估算相似度(只列 ≥ 0.2 的):")
for i in range(len(QUESTIONS)):
    for j in range(i + 1, len(QUESTIONS)):
        est = hashes[i].jaccard(hashes[j])
        a, b = shingles(QUESTIONS[i]), shingles(QUESTIONS[j])
        exact = len(a & b) / len(a | b)
        if est >= 0.2:
            print(f"  {i}-{j}  MinHash 估 {est:.2f}  精确 {exact:.2f}")

lsh = MinHashLSH(threshold=0.5, num_perm=128)
kept = []
for i, m in enumerate(hashes):
    if lsh.query(m):
        print(f"丢弃 {i}:{QUESTIONS[i]}  (和 {lsh.query(m)} 太像)")
        continue
    lsh.insert(str(i), m)
    kept.append(i)
print("保留:", kept)
```

<div class="line-notes">

- `def shingles(text: str, n: int = 3) -> set[str]:` 把一句话切成所有连续 3 个字的片段(shingle,瓦片,像屋顶瓦片一样一片压一片)。
- `s = "".join(text.split())` 先去掉空白。
- `return {s[i:i + n] for i in range(len(s) - n + 1)}` 集合推导式。「你们支持开」切出来是 `{"你们支", "们支持", "支持开"}`。用集合是因为重复的片段只算一次。
- `m = MinHash(num_perm=128, seed=1)` 128 个哈希函数,签名就是 128 个数。越多估得越准、越慢。`seed` 固定,结果可复现;要比较的两个 MinHash 必须用同样的 `num_perm` 和 `seed`。
- `m.update(sh.encode("utf-8"))` 把每个片段喂进去,同样只吃字节。
- `est = hashes[i].jaccard(hashes[j])` 用签名估算 Jaccard 相似度。
- `exact = len(a & b) / len(a | b)` 直接用集合算真实的 Jaccard,用来对照估得准不准。数据量大时没法两两这么算,这里只有 6 句。
- `lsh = MinHashLSH(threshold=0.5, num_perm=128)` 建一个 LSH 索引,相似度大约超过 0.5 的会落进同一个桶。
- `if lsh.query(m):` 查索引里有没有和它像的。有就丢掉这条,没有就插进去留下。`query` 返回像的那些条目的键。

</div>

```bash
uv run python part10/near_dup.py
```

```text
两两估算相似度(只列 ≥ 0.2 的):
  0-1  MinHash 估 0.58  精确 0.59
  0-2  MinHash 估 0.51  精确 0.45
  0-3  MinHash 估 0.30  精确 0.28
  1-2  MinHash 估 0.38  精确 0.33
  1-3  MinHash 估 0.30  精确 0.26
  2-3  MinHash 估 0.33  精确 0.31
  4-5  MinHash 估 0.30  精确 0.27
丢弃 1:请问 INV-2026-0012 这张发票为什么一直显示未付款  (和 ['0'] 太像)
保留: [0, 2, 3, 4, 5]
```

结果和我预想的不太一样,值得一行行看。

MinHash 的估值和精确值很接近(0.58 对 0.59),说明签名本身没问题。LSH 抓到了 1,和 0 的相似度 0.59。

2 和 0 精确相似度 0.45,MinHash 估成了 0.51,刚过阈值,却没被 LSH 丢掉。LSH 是概率性的:阈值附近的对子可能进桶也可能不进,`threshold=0.5` 不是一条精确的刀。

0 和 3 是两个完全不同的问题(一个问为什么未付款,一个问金额),相似度却有 0.28,比 4 和 5 这对真正的同义句(0.27)还高。原因是发票号 `INV-2026-` 这一串贡献了一大堆共同片段。4 和 5「你们支持开增值税专票吗」和「能开增值税专用发票吗」意思一样,3 字片段只重合了不到三成。

所以结论很明确:**按字面片段的近似去重,在短问题上不太灵**,它容易被编号、产品名这种长串带偏,又认不出换了词的同义句。MinHash 真正的主场是长文本:网页、文档、长回答,大模型预训练数据去重就是这么做的。短问题的同义去重,用 [Day 217](/blog/agent-zero/day-217-embed-service/) 的 embedding 算余弦相似度更合适,每簇只留几条。练习 2 会试一次把发票号先替换掉,你会看到它能修好一个问题、又带出另一个问题。

## 配比:三类样本混着喂

最后一件事不是代码,是比例。只喂「需要调工具」的样本,模型会学成见什么都调工具,用户问一句「你们支持开专票吗」它也去查发票。训练集里要有三类样本按比例混在一起:

1. **需要调用工具的**:单步、多步、并行调用都要有。
2. **不需要调用、直接回答的**:上面第 3 条那种。
3. **工具报错以后怎么处理的**:重试一次、换参数,或者如实告诉用户查不到。

再加一小份和业务无关的通用指令数据,减轻**灾难性遗忘**(模型在新任务上训练以后,原来会的通用能力明显变差)。具体比例没有定律,我的起点是工具类六成、直接回答两成、报错恢复和通用数据合计两成,然后看评测调:「不该调却调了」多,就加直接回答类;「该调没调」多,就反过来。每次调配比都要重跑一遍轨迹评测,只看最终答案对不对是发现不了这类问题的。

我们那 3 条干净样本里,两条调工具、一条直接回答,报错恢复一条都没有。原始数据里唯一一条带工具报错的(第 5 条)恰好也是漏参数的坏样本,被清洗掉了。这是真实数据里很常见的情况:**报错恢复的好样本天然稀缺**,因为线上报错的轨迹大多本身就是坏的。这类样本通常要专门造:拿一条正常轨迹,把工具结果换成一个真实会出现的错误,再写一段像样的处理。练习 4 会把这个比例统计出来。

### 零件和大代码的对照

| 零件 | 在哪一步 | 作用 |
| --- | --- | --- |
| `ImmutableSandboxedEnvironment` + 两个开关 | 第一步 | 和 transformers 一样地渲染模板 |
| 覆盖 `tojson` | 第二步 | 中文不转义、键不排序 |
| `problems` | 第三步 | 五种结构问题 |
| `fingerprint` | 第三步 | 精确去重,只看用户说的话 |
| MinHash + LSH | 第四步 | 长文本的近似去重 |
| 三类配比 | 最后一节 | 防止「见什么都调工具」 |

## 动手练习

1. **并行调用怎么渲染**:写一条样本,assistant 一次并行调用两次 `get_invoice`([Day 162](/blog/agent-zero/day-162-parallel-tools/)),后面跟两条 tool 结果和一个最终回答,渲染出来看两个结果被放在了几个 user 轮里。

<details><summary>参考答案</summary>

新建 `part10/render_parallel.py`:

```python
# agent-zero-lab/part10/render_parallel.py
"""一次并行调用两个工具,看两个结果在 Qwen3 模板里怎么排。"""
import json
import sys

from jinja2.sandbox import ImmutableSandboxedEnvironment

from render_tool_sample import TOOLS

SAMPLE = [
    {"role": "user", "content": "INV-2026-0012 和 INV-2026-0088 分别多少钱?"},
    {"role": "assistant", "content": "", "tool_calls": [
        {"type": "function", "function": {"name": "get_invoice", "arguments": {"invoice_id": "INV-2026-0012"}}},
        {"type": "function", "function": {"name": "get_invoice", "arguments": {"invoice_id": "INV-2026-0088"}}},
    ]},
    {"role": "tool", "content": '{"amount": 199}'},
    {"role": "tool", "content": '{"amount": 2376}'},
    {"role": "assistant", "content": "前一张 199 元,后一张 2376 元。"},
]

template = json.load(open(sys.argv[1], encoding="utf-8"))["chat_template"]
env = ImmutableSandboxedEnvironment(trim_blocks=True, lstrip_blocks=True)
env.filters["tojson"] = lambda x, **kw: json.dumps(x, ensure_ascii=False)
text = env.from_string(template).render(messages=SAMPLE, tools=TOOLS, add_generation_prompt=False)
print(text[text.index("<|im_start|>user"):])
```

<div class="line-notes">

- `from render_tool_sample import TOOLS` 复用第二步的工具定义。`render_tool_sample.py` 的 `main` 放在 `if __name__` 里,导入时不会执行渲染。
- `{"type": "function", "function": {"name": "get_invoice", "arguments": {"invoice_id": "INV-2026-0088"}}},` 同一个 assistant 消息里两个调用,就是 API 返回并行调用时的样子。
- `{"role": "tool", "content": '{"amount": 2376}'},` 两条 tool 结果紧挨着,顺序和调用顺序一致。
- `print(text[text.index("<|im_start|>user"):])` system 里那一长段工具说明和第二步一样,这里从第一个 user 开始打印,省点篇幅。`index` 找到子串位置,切片取后面的部分。

</div>

```bash
uv run python part10/render_parallel.py part10/qwen3/tokenizer_config.json
```

```text
<|im_start|>user
INV-2026-0012 和 INV-2026-0088 分别多少钱?<|im_end|>
<|im_start|>assistant
<tool_call>
{"name": "get_invoice", "arguments": {"invoice_id": "INV-2026-0012"}}
</tool_call>
<tool_call>
{"name": "get_invoice", "arguments": {"invoice_id": "INV-2026-0088"}}
</tool_call><|im_end|>
<|im_start|>user
<tool_response>
{"amount": 199}
</tool_response>
<tool_response>
{"amount": 2376}
</tool_response><|im_end|>
<|im_start|>assistant
前一张 199 元,后一张 2376 元。<|im_end|>
```

两个调用在同一个 assistant 轮里各占一个 `<tool_call>` 块;两个结果被合并进**同一个** user 轮,各占一个 `<tool_response>` 块。模板里 `messages[loop.index0 - 1].role != "tool"` 那一句判断「上一条是不是也是 tool」,是的话就不再开新的 `<|im_start|>user`。注意结果里没有任何 id,模型只能靠顺序把结果和调用对上,所以样本里 tool 消息的顺序必须和调用顺序一致,这是清洗时可以再加的一条检查。

</details>

2. **先把发票号替换掉**:近似去重被发票号带偏了。在 `shingles` 里切片之前,用正则把 `INV-2026-0012` 这种发票号统一换成 `#`,重跑。再试试把片段长度从 3 改成 2。

<details><summary>参考答案</summary>

复制成 `part10/near_dup_v2.py`,文件头加 `import re`,`shingles` 里那一行改成:

```python
    s = re.sub(r"INV-\d{4}-\d{4}", "#", "".join(text.split()))
```

`\d{4}` 是 4 个数字,整段匹配 `INV-` 加 4 位加 `-` 加 4 位。

```bash
uv run python part10/near_dup_v2.py
```

```text
两两估算相似度(只列 ≥ 0.2 的):
  0-1  MinHash 估 0.27  精确 0.35
  4-5  MinHash 估 0.30  精确 0.27
保留: [0, 1, 2, 3, 4, 5]
```

0 和 3 的虚假相似消失了,这是好的一面。坏的一面:0 和 1 的相似度从 0.59 掉到 0.35,0 和 2 掉到 0.2 以下,真正的重复也认不出了,原来它们像,有一大半功劳是那串相同的发票号。

再把片段长度改成 2(复制成 `near_dup_v3.py`,`n: int = 3` 改成 `n: int = 2`):

```bash
sed -e 's/near_dup_v2.py/near_dup_v3.py/' -e 's/def shingles(text: str, n: int = 3)/def shingles(text: str, n: int = 2)/' part10/near_dup_v2.py > part10/near_dup_v3.py
uv run python part10/near_dup_v3.py
```

```text
两两估算相似度(只列 ≥ 0.2 的):
  0-1  MinHash 估 0.35  精确 0.45
  0-2  MinHash 估 0.21  精确 0.21
  4-5  MinHash 估 0.45  精确 0.40
保留: [0, 1, 2, 3, 4, 5]
```

2 字片段对中文短句好一些,4 和 5 升到 0.40,0 和 1 升到 0.45,但都没过 0.5 的阈值,还是一条没丢。调参调到这里你应该能体会到:短问题的同义去重,字面方法怎么调都别扭,该换 embedding 了。这个练习的价值就是让你亲手得出这个结论,下次别在短文本上死磕 MinHash。

</details>

3. **再加一条检查:多了未定义的参数**:模型有时会编出 schema 里没有的参数,比如给 `get_invoice` 多传一个 `customer`。写一个 `unknown_args(sample)`,返回问题列表,用一条坏样本、一条好样本测试。

<details><summary>参考答案</summary>

新建 `part10/unknown_args.py`,复用 `make_tool_samples.py` 里的工具函数:

```python
# agent-zero-lab/part10/unknown_args.py
"""补一条检查:参数里出现了 schema 里没定义的字段。"""
import json

from make_tool_samples import SYS, TOOLS, call, final, tool


def unknown_args(sample: dict) -> list[str]:
    props = {t["function"]["name"]: set(t["function"]["parameters"].get("properties", {}))
             for t in sample["tools"]}
    out = []
    for i, m in enumerate(sample["messages"]):
        for c in m.get("tool_calls") or []:
            fn = c["function"]
            args = json.loads(fn["arguments"]) if isinstance(fn["arguments"], str) else fn["arguments"]
            extra = set(args) - props.get(fn["name"], set())
            if extra:
                out.append(f"第{i}条多了未定义的参数 {sorted(extra)}")
    return out


bad = {"tools": TOOLS, "messages": [
    SYS, {"role": "user", "content": "查一下青禾餐饮的 INV-2026-0012"},
    call("get_invoice", '{"invoice_id": "INV-2026-0012", "customer": "青禾餐饮"}'),
    tool({"status": "open"}), final("还没付。")]}
good = {"tools": TOOLS, "messages": [
    SYS, {"role": "user", "content": "查一下 INV-2026-0012"},
    call("get_invoice", '{"invoice_id": "INV-2026-0012"}'), tool({"status": "open"}), final("还没付。")]}
print("bad :", unknown_args(bad))
print("good:", unknown_args(good))
```

<div class="line-notes">

- `from make_tool_samples import SYS, TOOLS, call, final, tool` 正因为 `make_tool_samples.py` 把写文件放进了 `if __name__ == "__main__":`,这里导入才不会重写数据文件。
- `props = {t["function"]["name"]: set(t["function"]["parameters"].get("properties", {}))` 每个工具允许的参数名集合。对字典调 `set()` 得到它的键。
- `args = json.loads(fn["arguments"]) if isinstance(fn["arguments"], str) else fn["arguments"]` 三元表达式,相当于 JS 的 `cond ? a : b`,只是写法是「值 if 条件 else 另一个值」。这里假设坏 JSON 已经被 `problems` 拦掉了,所以直接 `loads`。
- `extra = set(args) - props.get(fn["name"], set())` 实际给的参数名减去允许的参数名。

</div>

```bash
uv run python part10/unknown_args.py
```

```text
bad : ["第2条多了未定义的参数 ['customer']"]
good: []
```

要接进清洗流程,在 `check_tool_sft.py` 的 `problems` 末尾 `out.extend(unknown_args(sample))` 就行。

</details>

4. **统计三类配比**:写一个脚本,把样本分成「调工具」「直接回答」「报错恢复」(有 tool 结果里带 `error` 的算报错恢复),分别对清洗前后的文件跑一遍。

<details><summary>参考答案</summary>

新建 `part10/mix_report.py`:

```python
# agent-zero-lab/part10/mix_report.py
"""统计清洗后的样本里三类各占多少:调工具、直接回答、工具报错后的处理。"""
import json
import sys
from collections import Counter


def kind(sample: dict) -> str:
    msgs = sample["messages"]
    if not any(m.get("tool_calls") for m in msgs):
        return "直接回答"
    if any(m["role"] == "tool" and "error" in m["content"] for m in msgs):
        return "报错恢复"
    return "调工具"


counts = Counter(kind(json.loads(line)) for line in open(sys.argv[1], encoding="utf-8") if line.strip())
total = sum(counts.values())
for k in ("调工具", "直接回答", "报错恢复"):
    print(f"{k}  {counts[k]} 条  {counts[k] / total:.0%}")
```

<div class="line-notes">

- `if not any(m.get("tool_calls") for m in msgs):` `any` 相当于 JS 的 `msgs.some(...)`。一次工具调用都没有的算直接回答。
- `if any(m["role"] == "tool" and "error" in m["content"] for m in msgs):` 工具结果里出现 `error` 字样的算报错恢复。这是个粗糙的判断,真实项目里应该在造数据时就给每条样本打上类型标签。
- `print(f"{k}  {counts[k]} 条  {counts[k] / total:.0%}")` `:.0%` 把小数格式化成不带小数位的百分比。

</div>

```bash
uv run python part10/mix_report.py part10/data/tool_sft_clean.jsonl
uv run python part10/mix_report.py part10/data/tool_sft_raw.jsonl
```

```text
调工具  2 条  67%
直接回答  1 条  33%
报错恢复  0 条  0%
调工具  6 条  75%
直接回答  1 条  12%
报错恢复  1 条  12%
```

清洗前有 1 条报错恢复,清洗后没了,因为它就是那条漏参数的坏样本。如果只看清洗后的总数,你不会注意到这一类被清空了。所以配比要在清洗之后统计,发现某一类是 0,就专门去造。

</details>

验收标准:`render_tool_sample.py` 渲染出来的文本和本文完全一致(包括中文没有被转义);`check_tool_sft.py` 对 8 条样本输出「保留 3 条,丢弃 5 条」;你能说出为什么工具结果被放在 user 轮里对训练有利,以及 vLLM 为什么要配 `--tool-call-parser hermes`。今天不调 API,花费 0 元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| chat template | 把 messages(和 tools)拼成模型实际读的文本的模板,存在 `tokenizer_config.json` 的 `chat_template` 字段 |
| Jinja2 | Python 的模板引擎,`{{ }}` 输出、`{% %}` 写逻辑,Nunjucks 是它的 JS 版 |
| ChatML | `<|im_start|>角色 … <|im_end|>` 这种对话格式,Qwen 在用 |
| 特殊 token | 分词器里单独占一个 token 的标记,比如 `<|im_end|>`,普通文字拼不出来 |
| add_generation_prompt | 渲染时要不要在末尾加 `<|im_start|>assistant`,推理 True、训练 False |
| Hermes 风格 | 用 `<tool_call>` 包一行 `{"name":…, "arguments":…}` 表示工具调用的格式 |
| tool-call-parser | vLLM 把模型输出的文字解析回 `tool_calls` 字段的规则,Qwen3 用 `hermes` |
| `<tool_response>` | Qwen3 模板里装工具结果的块,放在 user 轮里 |
| tojson 过滤器 | 模板里把对象转成 JSON 的函数,Jinja2 自带版会转义中文、排序键 |
| 精确去重 / 近似去重 | 规范化后完全一样 / 意思或字面差不多 |
| shingle | 把文本切成的连续小片段,比如每 3 个字一片 |
| Jaccard 相似度 | 两个集合交集大小 ÷ 并集大小,0 到 1 |
| MinHash | 用一组哈希函数给集合算短签名,快速估计 Jaccard。今天估 0.58,精确 0.59 |
| LSH | 局部敏感哈希,把相似的签名分进同一个桶,只比较桶内的 |
| 灾难性遗忘 | 微调后模型原来会的通用能力明显变差 |
| 配比 | 训练集里各类样本的比例,比如调工具六成、直接回答两成 |

## 常见误区

**自己拼训练文本。** 手写一个 `"<tool_call>" + json.dumps(...)` 的格式,很容易和基座模板差一个换行、一个空格,训练和推理就对不上。样本存 messages 加 tools,渲染交给基座自带的模板。

**渲染时不覆盖 `tojson`。** Jinja2 自带的版本把中文转成 `\uXXXX`、还会给键排序,程序不报错,但你检查的文本和真实训练文本不一样了。

**忘了开 `trim_blocks` 和 `lstrip_blocks`。** 模板里每个控制标签都占一行,不开这两个开关会多出一堆空行,渲染结果和 transformers 的不一致。

**parser 没配对。** 训练用的是 Hermes 格式,vLLM 起服务时没加 `--tool-call-parser hermes` 或者配成了别的,模型输出正确的 `<tool_call>`,接口返回的 `tool_calls` 却是空的,一段 XML 原样躺在 `content` 里。

**留着坏轨迹。** 调了不存在的工具、参数是截断的 JSON、调用没有结果、停在半路的轨迹,留在训练集里,模型就学会同样的毛病。`check_tool_sft.py` 这一类检查每次造数据都要跑。

**在短问题上死磕 MinHash。** 今天的实验里,两个不同的问题因为共享发票号,相似度比真正的同义句还高;换掉发票号,真重复又认不出了。短文本的同义去重用 embedding。

**模块里写顶层副作用。** `make_tool_samples.py` 第一版把写文件写在顶层,别的脚本一 `import` 它就把数据重写一遍。会被导入的文件,执行逻辑放进 `if __name__ == "__main__":`。

**只喂调工具的样本。** 模型会见什么都调工具。直接回答类和报错恢复类要按比例放进去,而且报错恢复的好样本线上很少,通常要专门造。

## 学习资料

### 文档与文章

- [Hugging Face · Chat templates](https://huggingface.co/docs/transformers/main/en/chat_templating):chat template 的官方说明,`add_generation_prompt` 和工具调用那两节对应今天的第一、二步,30 分钟。
- [Qwen 官方文档 · 函数调用](https://qwen.readthedocs.io/zh-cn/latest/framework/function_call.html):中文,Qwen3 推荐 Hermes 风格,以及 vLLM 起服务的参数。
- [vLLM · Tool calling](https://docs.vllm.ai/en/latest/features/tool_calling.html):`--enable-auto-tool-choice` 和各模型该用哪个 parser 的对照表。
- [Hugging Face Agents Course · Bonus Unit 1](https://huggingface.co/learn/agents-course/bonus-unit1/introduction):给 gemma-2-2b-it 做工具调用微调,自己给模板加工具标记的完整例子。
- [Jinja2 · Sandbox](https://jinja.palletsprojects.com/en/stable/sandbox/):沙箱环境能做什么、不能做什么。
- [datasketch · MinHash LSH](https://ekzhu.com/datasketch/lsh.html):`threshold` 和 `num_perm` 怎么选,以及为什么 LSH 是概率性的。
- [Qwen3-4B-Instruct-2507 · ModelScope](https://modelscope.cn/models/Qwen/Qwen3-4B-Instruct-2507):今天下载配置文件的仓库,「模型文件」里能看到 `tokenizer_config.json`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11vjZzaE5p&autoplay=0&high_quality=1" title="凭什么说function calling是微调出来的?上证据链" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农野蛮生长 · 凭什么说function calling是微调出来的?上证据链 · 约 10 分钟,从模板和训练数据的角度讲模型为什么「会」调工具,和今天的渲染结果对着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11EPqzzE1u&autoplay=0&high_quality=1" title="大模型数据工程核心:MinHash LSH去重算法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>蹦跶波 · 大模型数据工程核心:MinHash LSH去重算法 · 约 10 分钟,讲清楚 MinHash 的签名为什么能估 Jaccard、LSH 怎么分桶,对应第四步。</figcaption>
</figure>

- 古希腊掌管代码的神 · [【数据工程硬核】数据去重 MinHash / SimHash](https://www.bilibili.com/video/BV1EdKx6pEuH):不到 4 分钟,MinHash 和 SimHash 的对比,适合复习。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hHn_cV5WUDI" title="Function Calling Datasets, Training and Inference" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Trelis Research · Function Calling Datasets, Training and Inference · 讲工具调用数据集的格式、训练和推理时怎么对上模板,今天第二步的英文加长版,先看讲数据格式的前半段。</figcaption>
</figure>

### 书籍

- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024),中文版《图解大模型:生成式AI原理与实战》(人民邮电出版社,2025):讲分词器和 token 的章节能帮你理解特殊 token 是什么,第 12 章微调部分讲到对话格式。

### 开源项目与代码

- [NousResearch/Hermes-Function-Calling](https://github.com/NousResearch/Hermes-Function-Calling):Hermes 工具调用格式的来源,README 里有完整的提示词格式示例。
- [NousResearch/hermes-function-calling-v1](https://huggingface.co/datasets/NousResearch/hermes-function-calling-v1):一个公开的工具调用训练数据集,打开 Viewer 看几条,对比它和我们样本的结构。
- [ekzhu/datasketch](https://github.com/ekzhu/datasketch):MinHash、LSH 的实现,今天用的就是它。

## 自测

1. 为什么训练样本要存 messages 加 tools,而不是存渲染好的文本?

<details><summary>答案</summary>

存结构化数据,渲染交给基座自带的 chat template,训练和推理用的是同一个模板,天然一致;换基座时重新渲染一遍就行。存渲染好的文本,一来容易和推理时的格式差一点点,二来换基座时要全部重做,还看不出原始结构,清洗检查也没法做。

</details>

2. Qwen3 的模板把 tool 结果渲染进 user 轮,这对训练有什么好处?

<details><summary>答案</summary>

训练时只对 assistant 段算损失,切分依据是 `<|im_start|>assistant` 和 `<|im_start|>user`。工具结果落在 user 段里会被遮掉,模型不会学着「编造工具返回值」,只学发起调用和最后回答这两段。

</details>

3. 模型输出看起来完全正确,接口返回的 `tool_calls` 却是空的,`content` 里是一段 `<tool_call>…</tool_call>`。最可能是什么原因?

<details><summary>答案</summary>

vLLM 没有配对 tool-call parser:没加 `--enable-auto-tool-choice --tool-call-parser hermes`,或者配成了和训练格式不一致的 parser,服务端没有把这段文字解析回 `tool_calls` 字段。

</details>

4. `check_tool_sft.py` 为什么把「最后一条不是 assistant 的文字回答」也算作问题?

<details><summary>答案</summary>

轨迹停在 tool 结果或停在一次调用上,多半是运行中途超时或被中断。拿这种样本训练,模型会学到「调完工具就停」,用户什么回答都拿不到。

</details>

5. (面试题)你要用线上 Agent 轨迹微调一个小模型,提升工具调用的准确率。数据这块你会怎么做?

<details><summary>答案</summary>

先定格式:样本存 messages 加 tools 的结构化数据,用目标基座的 chat template 渲染一条出来逐行检查,确认工具定义、调用、结果各落在哪,推理服务的 parser 和它对得上。再清洗:去掉调用不存在的工具、参数坏 JSON、漏必填参数、多了未定义参数、调用没配上结果、轨迹没收尾的样本;按用户问题精确去重,短问题用 embedding 做近似去重;和评测集按指纹隔离。然后看配比:调工具、直接回答、报错恢复三类按比例混合,报错恢复的好样本线上少,要专门造,再加一点通用数据防遗忘。训练后用轨迹评测看「不该调却调了」「该调没调」「参数错」各自的比例,据此调配比,而不只看最终答案。

</details>

## 明天预告

Day 572 · 微调(三):LoRA 原理,Unsloth 在 Colab 上训练。数据都准备好了:昨天的分诊训练集,今天的工具调用样本格式。明天先讲清楚 LoRA 为什么只训练很小一部分参数就够,rank、alpha、学习率这几个数怎么定,然后在 Colab 免费 T4 上用 Unsloth 把分诊模型真的训一次。
