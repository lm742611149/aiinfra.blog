---
title: 'Day 428 · 自己跑开源模型:Ollama 和 vLLM 速览'
description: '在一台没有显卡的 2019 款 Intel Mac 上用 Ollama 跑起通义千问 Qwen3 0.6B,只改三个环境变量就让我们的代码改调本地模型;顺路踩两个真坑(下载卡死、思考模式把 max_tokens 吃光),看一眼 0.6B 模型为什么占了 5.6GB 内存;再用一个算式回答「什么时候值得自己部署模型」,最后知道生产环境的 vLLM 长什么样。'
pubDate: 2026-10-22
regime: none
tags: ['ollama', 'vllm', 'open-models', 'self-hosting', 'cost', 'agent-zero']
series: 'agent-zero'
day: 428
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 427](/blog/agent-zero/day-427-ci-cd/) 我们写了一条最小的 CI/CD 流水线:推到 main,GitHub Actions 先跑测试,通过了再构建镜像、SSH 上服务器换版本。到这里,部署这一块从代码到服务器都是我们自己的了,只剩一样东西还在别人手里:**模型**。服务里每一次回答,都是发一个 HTTP 请求给 DeepSeek 的服务器算出来的。

今天看看另一条路:模型也放在自己的机器上跑。这件事在面试里经常被问到,招聘要求里「熟悉开源模型私有化部署」也很常见。但我们今天的目的不是学会运维一个 GPU 集群(那是进阶篇 [Day 567](/blog/agent-zero/day-567-self-host-1/) 起的内容),而是亲手跑一次,知道它大概是怎么回事,能算清楚什么时候值得这么做。

## 今天要解决的问题

学完今天你应该能:

1. 在自己电脑上用 Ollama 下载并运行一个开源模型,用命令行和 HTTP 接口各问它一次。
2. 只改 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 三个环境变量,让 [Day 123](/blog/agent-zero/day-123-openai-compatible/) 起写的 OpenAI 兼容代码改调本地模型,并说出换厂商时除了 URL 还有什么要跟着换。
3. 用一个十几行的脚本算出「租 GPU 自己跑」和「调 API」的打平点,在面试里用数字回答「为什么不自己部署模型」。

今天只讲两个新概念:**本地推理服务**(Ollama,顺带看一眼生产用的 vLLM)和**自部署的成本账**。

预计用时 2–2.5 小时,其中下载模型可能要十几分钟,取决于网速。前置:Day 123 的 OpenAI 兼容协议、[Day 124](/blog/agent-zero/day-124-cost/) 的算钱公式、[Day 53](/blog/agent-zero/day-053-env-secrets/) 的环境变量和 `.env`。硬盘留出 2GB,内存最好有 2GB 空闲。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `ask.py` 和 `break_even.py` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 开源模型是什么,为什么能在自己电脑上跑

先把几个词说清楚。我们一直在调的 DeepSeek API,模型文件在 DeepSeek 的机房里,你只能发请求、拿结果。**开源模型**(更准确的叫法是「开放权重模型」,open weights)是厂商把训练好的模型文件公开放出来,谁都能下载到自己的机器上跑。阿里的通义千问 Qwen 系列、DeepSeek 自己的部分模型、Meta 的 Llama、Google 的 Gemma 都属于这一类。

模型文件里装的是一大堆数字,叫**参数**(也叫权重)。你在模型名字里看到的 0.6B、8B、27B,就是参数的个数:B 是 billion,十亿。0.6B 就是六亿个数字。每个数字原本用 16 位(2 字节)存,8B 模型光是参数就要 16GB,普通笔记本装不下。

所以本地跑模型几乎都要用**量化**:把每个数字从 16 位压成 8 位甚至 4 位存,文件小一半到四分之三,代价是回答质量掉一点。打个前端能懂的比方,就像把一张 PNG 存成 JPG,压到 80% 质量肉眼几乎看不出差别,压到 30% 就开始糊了。今天下载的模型文件名里带 `Q8_0`,意思是每个参数大约用 8 位存。

能跑起来还需要一个**推理引擎**:读进模型文件,接收你的问题,一个 token 一个 token 地算出回答([Day 106](/blog/agent-zero/day-106-next-token/) 讲过模型就是在反复猜下一个 token)。**Ollama** 就是把推理引擎、模型下载、HTTP 接口打包在一起的工具,一条命令下载,一条命令运行。它的底层是开源的 llama.cpp,专门为没有高端显卡的普通电脑优化过,CPU 也能跑。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="调云端 API 和调本地 Ollama 的对比">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <rect x="20" y="96" width="140" height="66" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="90" y="120" text-anchor="middle" fill="var(--ink)">ask.py</text>
    <text x="90" y="138" text-anchor="middle" fill="var(--ink-soft)">openai SDK</text>
    <text x="90" y="154" text-anchor="middle" fill="var(--ink-faint)" font-size="11">读 LLM_BASE_URL</text>
    <line x1="160" y1="110" x2="380" y2="56" stroke="var(--mem)"/>
    <text x="270" y="68" text-anchor="middle" fill="var(--ink-soft)">https://api.deepseek.com</text>
    <rect x="380" y="24" width="240" height="64" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="500" y="48" text-anchor="middle" fill="var(--ink)">DeepSeek 机房</text>
    <text x="500" y="66" text-anchor="middle" fill="var(--ink-soft)">deepseek-flash,按 token 收钱</text>
    <line x1="160" y1="148" x2="380" y2="196" stroke="var(--mem)"/>
    <text x="270" y="194" text-anchor="middle" fill="var(--ink-soft)">http://localhost:11434/v1</text>
    <rect x="380" y="164" width="240" height="72" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="500" y="186" text-anchor="middle" fill="var(--ink)">你自己的电脑:ollama serve</text>
    <text x="500" y="204" text-anchor="middle" fill="var(--ink-soft)">llama.cpp + Qwen3 0.6B Q8_0</text>
    <text x="500" y="222" text-anchor="middle" fill="var(--ink-faint)" font-size="11">不收钱,吃内存和 CPU</text>
  </g>
  <text x="320" y="252" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">两条线说的是同一种「话」(OpenAI 兼容协议),所以代码一行不改,换个地址就行</text>
</svg>
<figcaption>同一份调用代码,换一个 base URL 就从云端模型切到本地模型。两边都说 OpenAI 兼容协议,区别在于算力是谁的、钱怎么算。</figcaption>
</figure>

## 第一步:装 Ollama,下载一个小模型

到 [ollama.com](https://ollama.com) 下载安装。macOS 和 Windows 是一个桌面应用,装好后菜单栏会多一个小羊驼图标,它在后台运行着服务;Linux 上一行 `curl -fsSL https://ollama.com/install.sh | sh`。我 2026 年 10 月装的是 v0.40.8,macOS 的安装包同时支持 Intel 和 Apple 芯片。

装好后在终端确认一下:

```bash
ollama --version
```

我这台机器上,因为不想往系统里装应用,用的是 GitHub Releases 里的 `ollama-darwin.tgz` 命令行版,解压后手动起服务 `./ollama serve`。效果一样,只是要自己开一个终端窗口一直挂着它。用桌面应用的话这一步不用管。

服务起来以后,日志里有几行值得看:

```text
msg="Listening on 127.0.0.1:11434 (version 0.40.8)"
msg="inference compute" id=cpu library=cpu ... total="16.0 GiB" available="4.9 GiB"
msg="vram-based default context" total_vram="0 B" default_num_ctx=4096
```

第一行:服务在本机的 **11434 端口**等请求,和你本地 `npm run dev` 起在 5173 端口是一回事。第二行:它没找到能用的显卡,只能用 CPU,机器 16GB 内存当时空闲 4.9GB。第三行:显存 0,一会儿要用到这个信息。

现在选模型。我的机器是 2019 款 Intel MacBook Pro,没有能用来跑模型的显卡,所以只挑最小的:**Qwen3 0.6B**。你的机器要是 Apple M 系列芯片且有 16GB 内存,可以试 8B 级别的模型,体验会好很多;判断自己的电脑能跑多大,看「学习资料」里 B 站第一个视频。

```bash
ollama pull qwen3.5:0.8b
```

这是 Ollama 官方模型库里 2026 年 10 月最新的 Qwen3.5 系列里最小的一个(约 1.2GB)。**我在这里踩了第一个坑**:下载从 Cloudflare 的存储拉文件,在我的网络下反复卡住,日志里一直是:

```text
msg="5ba2eb9bf28c part 1 stalled; retrying. If this persists, press ctrl-c to exit, then 'ollama pull' to find a faster connection."
```

挂了 19 分钟,最后以 `max retries exceeded: ... EOF` 失败退出,又重试了三次都一样。国内网络下这很常见。好在 Ollama 支持直接从**魔搭 ModelScope**(阿里的国内模型下载站,相当于国内版 Hugging Face)拉 GGUF 格式的模型,地址写成 `modelscope.cn/组织/仓库名`:

```bash
ollama pull modelscope.cn/Qwen/Qwen3-0.6B-GGUF
ollama list
```

这次 639MB 用了 4 分 40 秒下完。`ollama list` 的输出:

```text
NAME                                         ID              SIZE      MODIFIED
modelscope.cn/Qwen/Qwen3-0.6B-GGUF:latest    5f4604416973    639 MB    Less than a second ago
```

**GGUF** 是 llama.cpp 用的模型文件格式,一个文件里装着量化后的参数和模型的配置,Ollama 能直接读。模型名有点长,后面的命令里它就是 `LLM_MODEL` 的值。如果你从官方库拉成功了,把后面所有的 `modelscope.cn/Qwen/Qwen3-0.6B-GGUF` 换成你拉的名字即可。

看一下这个模型的基本信息:

```bash
ollama show modelscope.cn/Qwen/Qwen3-0.6B-GGUF
```

```text
  Model
    architecture        qwen3
    parameters          596.05M
    context length      40960
    embedding length    1024
    quantization        Q8_0

  Capabilities
    completion
    tools
    thinking
        levels     false, true
        default    true
```

596.05M 个参数,也就是约 6 亿;Q8_0 量化,6 亿 × 1 字节 ≈ 600MB,和文件大小 639MB 对得上。最大上下文 40960 个 token。Capabilities 里写着它支持 `tools`(工具调用)和 `thinking`(思考模式),而且**思考默认是开着的**,记住这一条,第三步会栽在这里。

## 第二步:在命令行和 HTTP 里各问一次

```bash
ollama run --verbose --think=false modelscope.cn/Qwen/Qwen3-0.6B-GGUF "用一句话解释什么是幂等。"
```

`--think=false` 关掉思考模式,`--verbose` 让它在回答后面打印速度统计。实跑输出:

```text
幂等是指一个操作在执行多次时，结果与执行次数无关，即对相同输入结果输出相同的
值。

total duration:       1.735027864s
load duration:        1.183588ms
prompt eval count:    23 token(s)
prompt eval cached:   11 token(s)
prompt eval duration: 158.305ms
prompt eval rate:     75.80 tokens/s
eval count:           26 token(s)
eval duration:        1.532608s
eval rate:            16.96 tokens/s
```

回答的意思对,措辞有点别扭(「对相同输入结果输出相同的值」),这就是 0.6B 小模型的水平。下面那几行统计里,`prompt eval` 是模型**读**你的问题,一秒 76 个 token;`eval` 是模型**写**回答,一秒 17 个 token。生成永远比读慢,因为读可以一次并行算完,写只能一个一个往外蹦。一秒 17 个 token 大概是一秒十来个汉字,在 CPU 上跑能有这个速度,全靠模型小。

不加 `--think=false` 的话,它会先打印一大段 `Thinking...` 开头的内心独白(我实跑出来三四百字,从「嗯,用户问的是……」开始),然后才给答案,整个过程花了 1 分 37 秒。

接着用 HTTP 问一次。Ollama 在 `/v1/chat/completions` 这个地址上提供了**和 OpenAI 一模一样格式**的接口,前端里你用 `fetch` 调过的 OpenAI 接口长什么样,这里就长什么样:

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"modelscope.cn/Qwen/Qwen3-0.6B-GGUF","messages":[{"role":"user","content":"用一句话解释什么是幂等。"}],"max_tokens":200}'
```

<div class="line-notes">

- `curl -s http://localhost:11434/v1/chat/completions \` 地址是本机 11434 端口,路径和 OpenAI 官方的 `https://api.openai.com/v1/chat/completions` 完全一样。`-s` 是不打印进度条。
- `-H "Content-Type: application/json" \` 告诉服务端请求体是 JSON,相当于 `fetch` 里的 `headers`。
- `-d '{"model":"modelscope.cn/Qwen/Qwen3-0.6B-GGUF",` `-d` 是请求体。注意这里**没有带 `Authorization` 头**,Ollama 本地服务不校验 key。`max_tokens` 设成 200,最多让它写 200 个 token。

</div>

这次我没加任何关闭思考的参数。返回(用 `python3 -m json.tool` 格式化后,中间的长文我截短了):

```text
{
    "model": "modelscope.cn/Qwen/Qwen3-0.6B-GGUF",
    "system_fingerprint": "fp_ollama",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "",
                "reasoning": "嗯，用户让我用一句话解释什么是幂等。首先，我需要确定他们想要的准确定义……最后，检查语法和流畅性，确保句子正确无误，并且清晰明了地传达了幂"
            },
            "finish_reason": "length"
        }
    ],
    "usage": {
        "prompt_tokens": 17,
        "prompt_tokens_details": {
            "cached_tokens": 11
        },
        "completion_tokens": 200,
        "total_tokens": 217
    }
}
```

看 `content`:**空字符串**。200 个 token 全被 `reasoning`(思考过程)用掉了,话没想完,`finish_reason` 是 `length`,意思是「到上限被掐断了」。这就是我踩的第二个坑。下一步用 Python 调的时候,我们会把思考关掉。

## 第三步:只改环境变量,让我们的代码调本地模型

这一步是今天最想让你体会的东西。从 Day 123 开始我们就坚持一个习惯:厂商地址、key、模型名都从环境变量读,不写死在代码里([Day 136](/blog/agent-zero/day-136-llm-client-2/) 的 LLMClient 读的也是这几个变量)。当时可能觉得多此一举,今天收回报。

先写一个最小的提问脚本,它和你前面写过的调用代码没有任何区别,只是多打印了地址和速度:

```python
# agent-zero-lab/part07/local_models/ask.py
import json
import os
import sys
import time

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()  # 已经在终端里 export 的变量优先,.env 只补缺的
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
model = os.environ["LLM_MODEL"]
extra = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")

question = sys.argv[1] if len(sys.argv) > 1 else "用一句话解释什么是幂等。"
start = time.perf_counter()
resp = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": question}],
    max_tokens=200,
    extra_body=extra,
)
elapsed = time.perf_counter() - start
usage = resp.usage
assert usage is not None
print(f"[{model} @ {client.base_url}]")
print(resp.choices[0].message.content)
print(f"输入 {usage.prompt_tokens} / 输出 {usage.completion_tokens} token,"
      f"用时 {elapsed:.1f}s,约 {usage.completion_tokens / elapsed:.1f} token/s")
```

<div class="line-notes">

- `load_dotenv()` 读仓库根目录的 `.env`。**关键细节**:python-dotenv 默认不覆盖已经存在的环境变量。所以你在终端里 `export LLM_BASE_URL=...` 之后,`.env` 里同名的那一行就不生效了。下面切换模型就靠这一点。
- `client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])` 地址和 key 都从环境变量来。调 DeepSeek 时是 `https://api.deepseek.com` 和你的真 key;调 Ollama 时是 `http://localhost:11434/v1` 和随便一个非空字符串。
- `model = os.environ["LLM_MODEL"]` 模型名。DeepSeek 时是 `deepseek-flash`,Ollama 时是 `modelscope.cn/Qwen/Qwen3-0.6B-GGUF`。
- `extra = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")` 各家**专属的额外参数**,用一个 JSON 字符串放在环境变量里。我的 `.env` 里写的是 `{"thinking": {"type": "disabled"}}`,这是 DeepSeek 关闭思考的写法。`or "{}"` 让没设这个变量时得到空 dict。
- `question = sys.argv[1] if len(sys.argv) > 1 else` 命令行给了问题就用它,否则用默认问题。
- `start = time.perf_counter()` 开始计时。注意这个计时包括网络来回,对云端 API 来说并不只是模型生成的时间。
- `max_tokens=200,` 和上一步 curl 一样的上限,方便对比。
- `extra_body=extra,` openai SDK 的「把这些字段原样塞进请求体」开关。SDK 自己不认识的厂商参数都走这里。
- `assert usage is not None` 类型上 `usage` 可能是 None(有些服务不返回),这一行让编辑器的类型检查放心,也让真没返回时早点报错。
- `print(f"[{model} @ {client.base_url}]")` 打印当前到底在调谁,切换时一眼能确认。
- `f"用时 {elapsed:.1f}s,约 {usage.completion_tokens / elapsed:.1f} token/s")` 粗略的生成速度:输出 token 数除以总时间。

</div>

先用 `.env` 里的 DeepSeek 跑一次(这是 Day 123 那套配置,什么都不用改):

```bash
cd ~/agent-zero-lab
uv run python part07/local_models/ask.py
```

```text
[deepseek-flash @ https://api.deepseek.com]
幂等是指对同一操作执行一次与执行多次所产生的效果相同。
输入 11 / 输出 15 token,用时 1.0s,约 14.6 token/s
```

然后在同一个终端里 export 三个变量,再跑同一个脚本:

```bash
export LLM_BASE_URL=http://localhost:11434/v1
export LLM_API_KEY=ollama
export LLM_MODEL=modelscope.cn/Qwen/Qwen3-0.6B-GGUF
uv run python part07/local_models/ask.py
```

实跑输出:

```text
[modelscope.cn/Qwen/Qwen3-0.6B-GGUF @ http://localhost:11434/v1/]

输入 17 / 输出 200 token,用时 25.9s,约 7.7 token/s
```

回答又是空的,等了 26 秒。原因和上一步 curl 一样:思考模式把 200 个 token 用光了。但这次还多了一层:`.env` 里的 `LLM_EXTRA_BODY` 是 `{"thinking": {"type": "disabled"}}`,它确实发给了 Ollama,可这是 **DeepSeek 的方言**,Ollama 不认识,悄悄忽略了,连个报错都没有。

这就是「OpenAI 兼容」的边界:请求的骨架(地址、messages、model、max_tokens、tools)各家一样,但思考开关这种新功能,各家写法不同。按 [Ollama 的 OpenAI 兼容文档](https://docs.ollama.com/api/openai-compatibility),它用 OpenAI 自己的 `reasoning_effort` 参数控制思考。所以第四个变量也要跟着换:

```bash
export LLM_EXTRA_BODY='{"reasoning_effort":"none"}'
uv run python part07/local_models/ask.py
```

```text
[modelscope.cn/Qwen/Qwen3-0.6B-GGUF @ http://localhost:11434/v1/]
幂等（Idempotent）是指一个操作在应用后对原结果产生不会改变其值的性质，即 $ f(f(x)) = f(x) $。
输入 23 / 输出 37 token,用时 2.5s,约 14.8 token/s
```

出答案了,还顺手给了个数学定义 `f(f(x)) = f(x)`,虽然用词还是有点绕。代码一行没改,换了四个环境变量,整套程序就跑在了本地模型上。想切回 DeepSeek,`unset LLM_BASE_URL LLM_API_KEY LLM_MODEL LLM_EXTRA_BODY` 就行,`.env` 里那份配置又会生效。

**我建议的做法**:给每个厂商各准备一份配置,比如 `.env`(DeepSeek)和 `.env.ollama`(本地),切换时 `set -a; source .env.ollama; set +a` 一次性导入。这比手敲四个 export 不容易漏。

## 第四步:同一组题,本地小模型和云端比一比

「能跑」和「好用」是两回事。拿工单分类这种最简单的任务试一下([Day 198](/blog/agent-zero/day-198-routing/) 的路由第一步就是它)。下面这个脚本问 6 张工单,只让模型回答类别英文名:

```python
# agent-zero-lab/part07/local_models/classify.py
import json
import os
import time

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
model = os.environ["LLM_MODEL"]
extra = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")

LABELS = ["billing", "refund", "bug", "account"]
CASES = [
    ("这个月发票金额怎么比上个月多了 300 块?", "billing"),
    ("我昨天误购了年付套餐,能退钱吗?", "refund"),
    ("导出 Excel 的按钮点了没反应,Chrome 最新版。", "bug"),
    ("忘记密码了,重置邮件一直收不到。", "account"),
    ("开票抬头写错了,想重新开一张。", "billing"),
    ("取消订阅以后,剩下两个月的钱怎么算?", "refund"),
]
SYSTEM = f"把客服工单分到一类,只输出类别英文名,不要解释。可选:{', '.join(LABELS)}"

right = 0
start = time.perf_counter()
for text, gold in CASES:
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}],
        max_tokens=10,
        temperature=0,
        extra_body=extra,
    )
    got = (resp.choices[0].message.content or "").strip().lower()
    right += got == gold
    print(f"{'✓' if got == gold else '✗'} 期望 {gold:8} 得到 {got!r:12} {text}")
print(f"{model}: {right}/{len(CASES)} 正确,总用时 {time.perf_counter() - start:.1f}s")
```

<div class="line-notes">

- `LABELS = ["billing", "refund", "bug", "account"]` 四个类别:账单、退款、故障、账号。
- `CASES = [` 每条是一个元组(元组≈只读数组):工单文本和标准答案。最后一条故意出得有点模糊,「取消订阅后剩下的钱」既像退款又像账单。
- `SYSTEM = f"把客服工单分到一类` 系统提示词,`', '.join(LABELS)` 把列表拼成 `billing, refund, bug, account`,相当于 JS 的 `LABELS.join(', ')`。
- `for text, gold in CASES:` 一次取出元组的两个值,相当于 JS 的 `for (const [text, gold] of CASES)`。
- `max_tokens=10,` 类别名就一个词,给 10 个 token 够了。前提是思考关着,不然 10 个 token 一个字都等不到。
- `temperature=0,` 让输出尽量稳定,方便比较。
- `got = (resp.choices[0].message.content or "").strip().lower()` `content` 可能是 None,`or ""` 兜底;`.strip()` 去掉首尾空白,`.lower()` 转小写,模型回 `Billing` 也算对。
- `right += got == gold` `got == gold` 是布尔值,Python 里 True 当 1 加,False 当 0 加。JS 里 `right += (got === gold)` 也能这么写,只是没人这么写。
- `print(f"{'✓' if got == gold else '✗'} 期望 {gold:8}` `{gold:8}` 让类别名占 8 个字符宽,输出对齐;`{got!r:12}` 里的 `!r` 是打印带引号的形式,能看出有没有多余空格。

</div>

DeepSeek(`.env` 配置,先 `unset` 掉刚才那四个变量):

```text
✓ 期望 billing  得到 'billing'    这个月发票金额怎么比上个月多了 300 块?
✓ 期望 refund   得到 'refund'     我昨天误购了年付套餐,能退钱吗?
✓ 期望 bug      得到 'bug'        导出 Excel 的按钮点了没反应,Chrome 最新版。
✓ 期望 account  得到 'account'    忘记密码了,重置邮件一直收不到。
✓ 期望 billing  得到 'billing'    开票抬头写错了,想重新开一张。
✗ 期望 refund   得到 'billing'    取消订阅以后,剩下两个月的钱怎么算?
deepseek-flash: 5/6 正确,总用时 3.3s
```

本地 Qwen3 0.6B(export 那四个变量,`LLM_EXTRA_BODY` 用 `reasoning_effort` 那份):

```text
✓ 期望 billing  得到 'billing'    这个月发票金额怎么比上个月多了 300 块?
✓ 期望 refund   得到 'refund'     我昨天误购了年付套餐,能退钱吗?
✓ 期望 bug      得到 'bug'        导出 Excel 的按钮点了没反应,Chrome 最新版。
✗ 期望 account  得到 'billing'    忘记密码了,重置邮件一直收不到。
✓ 期望 billing  得到 'billing'    开票抬头写错了,想重新开一张。
✗ 期望 refund   得到 'billing'    取消订阅以后,剩下两个月的钱怎么算?
modelscope.cn/Qwen/Qwen3-0.6B-GGUF: 4/6 正确,总用时 4.1s
```

两个都栽在最后那条模糊的题上,这条说明我的标准答案本身就有争议,真做评测时要拿出来和业务方对一下。区别在第四条:「忘记密码」这种很明确的账号问题,0.6B 也分错了。六道题当然说明不了什么,[Day 341](/blog/agent-zero/day-341-why-evals/) 起的评测部分讲过,下结论要用几十上百条的评测集。但方向是清楚的:**参数少一个数量级,能力就差一截**,而且越难的任务差得越多。分类这种一个词的活还能凑合,多步工具调用和写长回复,小模型通常明显落后。

速度上,CPU 跑的 0.6B 总用时和云端差不多,因为每个答案只有一两个 token,时间主要花在读题上。换成要写几百字的回答,一秒 15 个 token 的速度就要等半分钟。

## 第五步:为什么一个 0.6B 模型占了 5.6GB 内存

模型加载以后,用 `ollama ps` 看它占了多少内存:

```bash
ollama ps
```

```text
NAME                                         ID              SIZE      PROCESSOR    CONTEXT    RUNNER      UNTIL
modelscope.cn/Qwen/Qwen3-0.6B-GGUF:latest    5f4604416973    5.6 GB    100% CPU     40960      llamacpp    4 minutes from now
```

模型文件才 639MB,运行起来却占了 **5.6GB**。看 `CONTEXT` 那一列:40960。模型在生成时,要为上下文里的每个 token 存一份中间结果(叫 KV cache,进阶篇 Day 567 细讲),上下文窗口开多大,这块内存就预留多大。我们只问一句话,却按 4 万 token 的窗口预留了内存。

试一下把窗口改小。Ollama 自己的原生接口 `/api/generate` 可以在 `options` 里指定 `num_ctx`(上下文长度):

```bash
ollama stop modelscope.cn/Qwen/Qwen3-0.6B-GGUF
curl -s http://localhost:11434/api/generate -d '{"model":"modelscope.cn/Qwen/Qwen3-0.6B-GGUF","prompt":"你好","think":false,"stream":false,"options":{"num_ctx":4096}}'
ollama ps
```

```text
NAME                                         ID              SIZE      PROCESSOR    CONTEXT    RUNNER      UNTIL
modelscope.cn/Qwen/Qwen3-0.6B-GGUF:latest    5f4604416973    1.1 GB    100% CPU     4096       llamacpp    4 minutes from now
```

窗口从 40960 降到 4096,内存从 5.6GB 降到 **1.1GB**。所以自己跑模型时,「模型文件多大」只是一半,另一半是你要给它开多大的上下文。Agent 的上下文动不动就几万 token([Day 131](/blog/agent-zero/day-131-conversation-cost/) 算过对话越聊越长),这块内存是省不掉的。想全局改默认窗口,起服务前设环境变量 `OLLAMA_CONTEXT_LENGTH=4096`。

`UNTIL` 那一列的「4 minutes from now」是说:5 分钟没人用,Ollama 会自动把模型从内存里卸掉。用完想马上释放,执行 `ollama stop 模型名`。像我这种内存紧张的老机器,做完练习记得 stop,不然 5.6GB 一直占着。

## 第六步:生产环境用 vLLM,长什么样

Ollama 适合在个人电脑上开发和试验。真要在服务器上同时给很多用户提供服务,业界主流是 **vLLM**:一个开源的高性能推理服务框架。它最大的本事是**批处理**:一张显卡同时处理几十个请求,把它们拼在一起算,吞吐量比一个一个处理高得多(用到的技术叫 PagedAttention 和连续批处理,名字先记住,进阶篇再讲)。Ollama 也能同时接多个请求,但它的设计重点是「在普通电脑上跑起来」,不是「一张卡榨出最大吞吐」。

vLLM 同样提供 OpenAI 兼容接口,所以对我们的代码来说,它只是又一个 `LLM_BASE_URL`:

```bash
# 需要一台有 NVIDIA 显卡的 Linux 服务器,本机跑不了
uv pip install vllm
vllm serve Qwen/Qwen3-8B --port 8000 --enable-auto-tool-choice --tool-call-parser hermes
# 然后在调用方:
#   LLM_BASE_URL=http://<GPU 服务器地址>:8000/v1
#   LLM_MODEL=Qwen/Qwen3-8B
```

<div class="line-notes">

- `# 需要一台有 NVIDIA 显卡的 Linux 服务器,本机跑不了` 这一段**我没有实跑**:我的 Mac 没有 NVIDIA 显卡,vLLM 的主要支持平台是 Linux 加 NVIDIA GPU。2026 年 10 月 PyPI 上 vLLM 最新是 0.32.0,要求 Python 3.11 到 3.14。
- `uv pip install vllm` 装进当前虚拟环境。它很大,带着 PyTorch 和 CUDA 相关的包,装一次几个 GB。
- `vllm serve Qwen/Qwen3-8B --port 8000` 从 Hugging Face 下载 Qwen3-8B 并在 8000 端口提供服务。这里的模型名是 Hugging Face 上的仓库名,和 Ollama 的命名方式不一样。国内服务器可以设 `VLLM_USE_MODELSCOPE=True` 改从魔搭下载。后半截 `--enable-auto-tool-choice --tool-call-parser hermes` 开启工具调用:vLLM 默认不解析模型输出里的工具调用,要用这两个参数指定按哪种格式解析;不同模型用的解析器不同,Qwen 官方的 vLLM 部署文档给 Qwen3 用的是 `hermes`,用之前以 [vLLM 的 Tool Calling 文档](https://docs.vllm.ai/en/latest/features/tool_calling.html)为准。
- `#   LLM_BASE_URL=http://<GPU 服务器地址>:8000/v1` 调用方还是那几个环境变量。这一点和 Ollama 一样。

</div>

上面这条命令只是让你知道它长什么样。显存要多少、一张卡能扛多少并发、怎么压测、怎么量化,是进阶篇 [Day 567](/blog/agent-zero/day-567-self-host-1/) 到 [Day 569](/blog/agent-zero/day-569-self-host-3/) 的内容,那时会在云 GPU 上真的跑一遍。

## 第七步:什么时候值得自己部署,算一笔账

面试里很可能被问:「你们为什么不自己部署开源模型,不是更省钱吗?」答「API 方便」没有说服力,用数字回答。

先列单价。下面的价格都是我 2026 年 10 月查的:

- DeepSeek `deepseek-flash`,[官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)忙时价:缓存命中输入 0.04 元、未命中输入 2 元、输出 8 元,每百万 token;英文页的美元价是 0.006 / 0.30 / 1.20 美元。闲时(北京时间工作日 9–12 点、14–18 点以外)半价。
- 租一张能跑 8B 模型的 RTX 4090 显卡:[RunPod 定价页](https://www.runpod.io/pricing)上最低每小时 0.34 美元,更稳定的档位 0.89 美元。国内的 AutoDL 等平台按人民币计价,我没查到能核实的公开价,自己去看。

自己部署有一个容易忽略的前提:**机器要 24 小时开着**,有没有请求都在计费。API 则是用多少付多少。所以比较的是「一个月固定 720 小时的 GPU 钱」和「一个月的 token 钱」:

```python
# agent-zero-lab/part07/local_models/break_even.py
"""自己租 GPU 跑模型 vs 调 DeepSeek API,每月各花多少美元。单价 2026-10 查的,用前自己再核。"""

# DeepSeek deepseek-flash 忙时价,美元 / 百万 token
PRICE_HIT, PRICE_MISS, PRICE_OUT = 0.006, 0.30, 1.20
GPU_PER_HOUR = 0.34          # RunPod 上 RTX 4090 的最低档
HOURS = 24 * 30              # 自部署要 24 小时开着,一个月 720 小时


def api_monthly(requests_per_day: int, tokens_in: int, tokens_out: int, hit_ratio: float) -> float:
    n = requests_per_day * 30
    cost_in = tokens_in * (hit_ratio * PRICE_HIT + (1 - hit_ratio) * PRICE_MISS)
    return n * (cost_in + tokens_out * PRICE_OUT) / 1_000_000


gpu = GPU_PER_HOUR * HOURS
print(f"GPU 一张卡开一个月: ${gpu:,.2f}")
for per_day in [1_000, 10_000, 100_000]:
    no_cache = api_monthly(per_day, 3_000, 300, 0.0)
    cached = api_monthly(per_day, 3_000, 300, 0.8)
    print(f"每天 {per_day:>7,} 次: API 无缓存 ${no_cache:>9,.2f},80% 命中缓存 ${cached:>9,.2f}")

per_request = api_monthly(1, 3_000, 300, 0.8) / 30
print(f"80% 命中时一次请求 ${per_request:.6f},打平要每天 {gpu / 30 / per_request:,.0f} 次")
```

<div class="line-notes">

- `PRICE_HIT, PRICE_MISS, PRICE_OUT = 0.006, 0.30, 1.20` 一行给三个变量赋值,相当于 JS 的 `const [a, b, c] = [0.006, 0.30, 1.20]`。用忙时价,对 API 来说是偏贵的算法。
- `GPU_PER_HOUR = 0.34` 取最低档,对自部署来说是偏便宜的算法。两头都往对自部署有利的方向取,看它还能不能赢。
- `HOURS = 24 * 30` 720 小时。
- `def api_monthly(requests_per_day: int, tokens_in: int, tokens_out: int, hit_ratio: float) -> float:` 给定每天请求数、每次输入输出 token 数、缓存命中率,算一个月的 API 钱。
- `cost_in = tokens_in * (hit_ratio * PRICE_HIT + (1 - hit_ratio) * PRICE_MISS)` 输入 token 里命中缓存的部分按 0.006 算,没命中的按 0.30 算。代入 3000 token、命中 80%:3000 × (0.8 × 0.006 + 0.2 × 0.30) = 3000 × 0.0648 = 194.4,再除以一百万就是 0.000194 美元。Agent 每一轮都带着同样的系统提示词和工具定义,命中率高是常态([Day 397](/blog/agent-zero/day-397-prompt-caching/) 讲过怎么让它命中)。
- `return n * (cost_in + tokens_out * PRICE_OUT) / 1_000_000` 加上输出:300 × 1.20 = 360,一次请求合计 (194.4 + 360) / 1,000,000 = 0.000554 美元。
- `gpu = GPU_PER_HOUR * HOURS` 0.34 × 720 = 244.80 美元一个月。
- `for per_day in [1_000, 10_000, 100_000]:` 三个量级:每天一千次、一万次、十万次。`1_000` 里的下划线只是方便读,和 JS 的 `1_000` 一样。
- `no_cache = api_monthly(per_day, 3_000, 300, 0.0)` 每次 3000 输入、300 输出,一个典型的工单处理请求;先算完全没缓存的最坏情况。
- `print(f"每天 {per_day:>7,} 次:` `:>7,` 是右对齐占 7 格、加千分位逗号。
- `per_request = api_monthly(1, 3_000, 300, 0.8) / 30` 一次请求的钱:每天 1 次算一个月再除以 30。
- `print(f"80% 命中时一次请求 ${per_request:.6f},打平要每天 {gpu / 30 / per_request:,.0f} 次")` 打平点 = 每天的 GPU 钱 ÷ 每次请求的 API 钱 = 8.16 ÷ 0.000554 ≈ 14,719 次。

</div>

```bash
uv run python part07/local_models/break_even.py
```

实跑输出:

```text
GPU 一张卡开一个月: $244.80
每天   1,000 次: API 无缓存 $    37.80,80% 命中缓存 $    16.63
每天  10,000 次: API 无缓存 $   378.00,80% 命中缓存 $   166.32
每天 100,000 次: API 无缓存 $ 3,780.00,80% 命中缓存 $ 1,663.20
80% 命中时一次请求 $0.000554,打平要每天 14,719 次
```

怎么读这几行数字:

每天一千次请求,API 一个月十几到三十几美元,GPU 固定 245 美元,API 便宜得多。一个小团队的内部工具、一个个人项目,基本都在这个量级。

每天一万次、缓存命中不错的情况下,API 166 美元,仍然比一张卡便宜;要是完全不命中缓存,API 378 美元就超过了 GPU。

到每天十万次,账面上自部署明显便宜了。但先别急,账面没算这几样:

- **质量差距**。4090 上跑的是 8B 级别的模型,`deepseek-flash` 背后是大得多的模型。第四步那六道题已经能看出小模型差一截,这个差距要用你自己的评测集量出来,不能凭感觉。
- **只有一张卡**。卡挂了服务就停了。要可靠至少两张,钱翻倍。练习 4 会算这个。
- **人**。有人要负责装驱动、升级 vLLM、半夜处理宕机、压测扩容。哪怕只占一个工程师四分之一的时间,折成钱也远超几百美元一个月。
- **峰值**。请求不是均匀来的,白天高峰要按峰值配卡,夜里卡闲着照样计费。

所以结论是:对绝大多数中小规模的 Agent 应用,直接调 API 更便宜也更省心。**自部署真正成立的理由通常不是钱**,而是下面三条之一:

1. **数据不能出去**。金融、医疗、政务客户的合同或法规要求数据不出内网,这时候没得选。
2. **要用自己微调过的模型**。进阶篇 [Day 570](/blog/agent-zero/day-570-finetune-1/) 起讲微调,微调后的模型就得自己托管(或者用支持托管微调模型的平台)。
3. **量真的极大**。每天几十万、上百万次,而且评测证明小模型够用,这时省下的钱才盖得过人力。

## 动手练习

**练习 1:自己跑通本地模型。** 装 Ollama,下载一个适合你电脑的模型,用 `ollama run --verbose` 问一个问题,记下 `eval rate`(每秒生成几个 token)。如果官方库下载卡住,改从魔搭下载。

<details><summary>参考答案</summary>

```bash
ollama --version
ollama pull qwen3.5:0.8b || ollama pull modelscope.cn/Qwen/Qwen3-0.6B-GGUF
ollama list
ollama run --verbose --think=false modelscope.cn/Qwen/Qwen3-0.6B-GGUF "用一句话解释什么是幂等。"
```

<div class="line-notes">

- `ollama --version` 确认装好了。如果只打印了 `Warning: could not connect to a running Ollama instance`,说明服务没起来:桌面版打开一下应用,命令行版另开一个终端跑 `ollama serve`。我第一次就是这个提示。
- `ollama pull qwen3.5:0.8b || ollama pull modelscope.cn/Qwen/Qwen3-0.6B-GGUF` `||` 是「前一条失败才执行后一条」,和 JS 里 `a || b` 的短路意思一样。不过 pull 卡住时不会马上失败,要等十几分钟重试完才退出,所以网络不好的话直接用魔搭那条更省时间。
- `ollama list` 确认下载成功,看文件大小。
- `ollama run --verbose --think=false` 我的实跑结果:`eval rate: 16.96 tokens/s`,`prompt eval rate: 75.80 tokens/s`。Apple M 系列芯片的机器跑同一个模型会快几倍。

</div>

</details>

**练习 2:观察思考模式会发生什么。** 用 `ask.py` 调本地模型,`LLM_EXTRA_BODY` 分别设成 `{}`(什么都不传)和 `{"reasoning_effort":"none"}`,对比回答内容、输出 token 数和用时。

<details><summary>参考答案</summary>

```bash
export LLM_BASE_URL=http://localhost:11434/v1 LLM_API_KEY=ollama LLM_MODEL=modelscope.cn/Qwen/Qwen3-0.6B-GGUF
LLM_EXTRA_BODY='{}' uv run python part07/local_models/ask.py
LLM_EXTRA_BODY='{"reasoning_effort":"none"}' uv run python part07/local_models/ask.py
```

<div class="line-notes">

- `export LLM_BASE_URL=http://localhost:11434/v1 LLM_API_KEY=ollama LLM_MODEL=modelscope.cn/Qwen/Qwen3-0.6B-GGUF` 一条 export 可以同时设多个变量。
- `LLM_EXTRA_BODY='{}' uv run python part07/local_models/ask.py` 把变量写在命令前面,只对这一条命令生效,不影响后面的命令。这是 shell 的写法,很适合做这种对比。

</div>

实跑:

```text
[modelscope.cn/Qwen/Qwen3-0.6B-GGUF @ http://localhost:11434/v1/]
幂等是指一个操作无论执行多少次，输入与输出结果
输入 17 / 输出 200 token,用时 43.8s,约 4.6 token/s
[modelscope.cn/Qwen/Qwen3-0.6B-GGUF @ http://localhost:11434/v1/]
幂等（Idempotent）是指一个操作在应用后对原结果产生不会改变其值的性质，即 $ f(f(x)) = f(x) $。
输入 23 / 输出 37 token,用时 2.5s,约 14.8 token/s
```

不传参数时,思考吃掉了大部分 token,答案只写了半句就到 200 个 token 的上限了,用时 43.8 秒;关掉思考,37 个 token、2.5 秒就答完。另外注意第一行的速度只有 4.6 token/s,比第二次慢很多:我那台机器同时开着别的程序,CPU 被抢了。本地跑模型的速度会随机器负载波动,云端 API 没有这个问题。

</details>

**练习 3:本地模型能不能调工具?** 写一个只有一个工具 `get_invoice` 的请求,问「帮我查一下 INV-2026-0123 付了没有」,分别发给本地模型和 DeepSeek,看它们返回的是不是工具调用。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/local_models/tool_call.py
import json
import os

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionToolUnionParam

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
extra = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")

tools: list[ChatCompletionToolUnionParam] = [{
    "type": "function",
    "function": {
        "name": "get_invoice",
        "description": "按发票编号查一张发票的金额和状态",
        "parameters": {
            "type": "object",
            "properties": {"invoice_id": {"type": "string", "description": "形如 INV-2026-0123"}},
            "required": ["invoice_id"],
        },
    },
}]
resp = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": "帮我查一下 INV-2026-0123 付了没有"}],
    tools=tools,
    extra_body=extra,
)
msg = resp.choices[0].message
print("finish_reason:", resp.choices[0].finish_reason)
for call in msg.tool_calls or []:
    if call.type == "function":
        print("要调用:", call.function.name, call.function.arguments)
print("文字回复:", msg.content)
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletionToolUnionParam` SDK 给工具定义的类型。不标注的话,basedpyright 会在 `tools=tools` 那一行报 `Argument of type "list[dict[str, Unknown]]" cannot be assigned to parameter "tools"`,我第一次就是这样。标上以后 0 报错。
- `tools: list[ChatCompletionToolUnionParam] = [{` 工具定义的结构和 [Day 156](/blog/agent-zero/day-156-fc-idea/) 起学的 function calling 一模一样,本地模型认的也是这套格式。
- `"description": "按发票编号查一张发票的金额和状态",` 小模型对工具描述更敏感,描述写清楚、参数给格式示例,能明显提高调对的概率。
- `tools=tools,` 把工具列表发过去。
- `for call in msg.tool_calls or []:` 模型可能一次要求调多个工具,也可能一个都不调(这时 `tool_calls` 是 None,`or []` 让循环直接跳过)。
- `if call.type == "function":` openai SDK 3.x 里工具调用有好几种类型,先确认是函数调用,编辑器才知道下面能取 `call.function`。
- `print("要调用:", call.function.name, call.function.arguments)` `arguments` 是一个 JSON **字符串**,不是 dict,真执行前要 `json.loads`。

</div>

本地模型(`LLM_EXTRA_BODY='{"reasoning_effort":"none"}'`)实跑:

```text
finish_reason: tool_calls
要调用: get_invoice {"invoice_id":"INV-2026-0123"}
文字回复: 
```

`unset` 掉四个变量,DeepSeek 实跑:

```text
finish_reason: tool_calls
要调用: get_invoice {"invoice_id": "INV-2026-0123"}
文字回复: 
```

这么简单的单工具调用,0.6B 也调对了,参数一字不差。`ollama show` 里 Capabilities 列出了 `tools`,就是在说这个。但要注意,单个工具、问题直白是最容易的情况;工具一多、需要连着调好几步、参数要从上下文里推,小模型出错率会明显上去。真要用,拿你自己的 Agent 评测集跑。

</details>

**练习 4:把账算得更实在一点。** 改 `break_even.py`:GPU 改成更稳定的 0.89 美元档,并且按两张卡算(一张挂了另一张顶上)。重新算打平点。

<details><summary>参考答案</summary>

只改三行,其他不动:

```python
GPU_PER_HOUR = 0.89          # RunPod 上 RTX 4090 的 Secure Cloud 档
gpu = 2 * GPU_PER_HOUR * HOURS  # 两张卡,一张挂了另一张顶上
print(f"GPU 两张卡开一个月: ${gpu:,.2f}")
```

<div class="line-notes">

- `GPU_PER_HOUR = 0.89` 换成更稳定的档位。便宜档的机器可能被收回或中断,生产服务一般不用。
- `gpu = 2 * GPU_PER_HOUR * HOURS` 2 × 0.89 × 720 = 1,281.60 美元。
- `print(f"GPU 两张卡开一个月: ${gpu:,.2f}")` 标签也跟着改,不然输出会骗你自己。

</div>

实跑输出:

```text
GPU 两张卡开一个月: $1,281.60
每天   1,000 次: API 无缓存 $    37.80,80% 命中缓存 $    16.63
每天  10,000 次: API 无缓存 $   378.00,80% 命中缓存 $   166.32
每天 100,000 次: API 无缓存 $ 3,780.00,80% 命中缓存 $ 1,663.20
80% 命中时一次请求 $0.000554,打平要每天 77,056 次
```

打平点从每天 1.5 万次涨到 7.7 万次,翻了五倍多,而且这还没算人力和质量差距。这就是为什么「自部署省钱」这个直觉大多数时候是错的:你最开始那笔账,通常是按最便宜的卡、一张卡、满负荷算的。

</details>

**验收标准**:本机跑通过一个本地模型,知道它的 eval rate;同一个脚本只改环境变量就能在 DeepSeek 和本地模型之间切换,并能说出 `LLM_EXTRA_BODY` 为什么也要跟着换;能用 `break_even.py` 的数字回答「为什么不自己部署模型」;做完练习执行 `ollama stop` 释放内存。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 开源模型 / 开放权重 | 厂商公开了模型文件,任何人可以下载到自己的机器上运行,如 Qwen、Llama、Gemma |
| 参数(权重) | 模型文件里存的那一大堆数字。0.6B 就是约 6 亿个参数 |
| 量化 | 把每个参数从 16 位压成 8 位、4 位存,文件和内存小很多,质量略降。`Q8_0` 约 8 位 |
| 推理引擎 | 读进模型文件、接收输入、一个个算出输出 token 的程序,如 llama.cpp、vLLM |
| Ollama | 把模型下载、推理引擎和 HTTP 接口打包在一起的本地运行工具,默认端口 11434 |
| GGUF | llama.cpp 和 Ollama 用的模型文件格式,一个文件装着量化参数和配置 |
| 魔搭 ModelScope | 阿里的模型下载站,国内下载快,Ollama 可直接 `pull modelscope.cn/...` |
| eval rate | Ollama 统计的生成速度,每秒输出多少 token |
| `num_ctx` | 运行时给模型开的上下文窗口大小,开得越大预留的内存越多 |
| 思考模式 | 模型先输出一段推理过程再给答案;思考的 token 也算在 `max_tokens` 里 |
| `reasoning_effort` | OpenAI 协议里控制思考强度的参数,Ollama 用它开关思考 |
| vLLM | 生产环境主流的开源推理服务框架,擅长一张卡同时服务很多请求 |
| 打平点 | 自部署的固定成本等于 API 按量费用时的请求量,超过它自部署账面上才便宜 |

## 常见误区

**以为模型文件多大就占多少内存。** 0.6B 的模型文件 639MB,默认 40960 的上下文窗口跑起来占了 5.6GB;窗口改成 4096 后是 1.1GB。上下文窗口开多大,内存就要预留多少。

**换了 base URL 就以为全换好了。** 我 `.env` 里给 DeepSeek 写的 `{"thinking": {"type": "disabled"}}` 原样发给了 Ollama,它不认识也不报错,结果思考没关上,回答是空字符串。厂商专属参数要跟着厂商一起换。

**`max_tokens` 设小了,回答是空的。** 思考模式下 `max_tokens` 同时管着思考和回答,200 个 token 全花在思考上,`content` 就是 `""`,`finish_reason` 是 `length`。看到空回答先查这两个字段。

**`ollama pull` 卡在 stalled 一直等。** 官方库的文件走 Cloudflare 存储,国内网络经常卡住重试,我等了 19 分钟最后失败。直接从魔搭拉 `modelscope.cn/Qwen/...-GGUF`,4 分多钟就下完了。

**看到 `could not connect to a running Ollama instance` 以为没装好。** 装好了,只是服务没在跑。桌面版打开应用,命令行版跑 `ollama serve`。

**用一台笔记本的体验判断自部署行不行。** 笔记本上 0.6B 一秒十几个 token 只能说明「能跑」。生产要看显卡上的并发吞吐、评测集上的质量和全天的成本,这些今天都没测。

**以为自部署一定省钱。** 按最便宜的卡、一张卡、满负荷算出来的打平点是每天 1.5 万次;换成稳定档、两张卡,打平点就到了 7.7 万次,还没算人力。自部署的理由通常是数据和定制,不是钱。

**用完不 stop。** Ollama 默认 5 分钟没人用才卸载模型,内存紧张的机器做完实验执行 `ollama stop 模型名`。

## 学习资料

### 文档与文章

- [Ollama 快速入门](https://docs.ollama.com/quickstart):安装、下载、运行第一个模型,10 分钟。
- [Ollama · OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility):今天切换模型靠的就是这一页,重点看支持哪些参数、`reasoning_effort` 怎么控制思考,15 分钟。
- [Ollama FAQ](https://docs.ollama.com/faq):怎么改默认上下文长度、模型存在哪、怎么让局域网其他机器访问,遇到问题先查这里,15 分钟。
- [魔搭 · Ollama 加载 ModelScope 模型](https://modelscope.cn/docs/models/advanced-usage/ollama-integration):`ollama pull modelscope.cn/...` 的官方说明,怎么选量化版本,10 分钟。
- [Qwen 文档 · Ollama(中文)](https://qwen.readthedocs.io/zh-cn/latest/run_locally/ollama.html)、[Qwen 文档 · vLLM](https://qwen.readthedocs.io/en/latest/deployment/vllm.html):通义千问官方的本地运行和 vLLM 部署说明,包括工具调用怎么开,各 15 分钟。
- [vLLM · OpenAI-compatible server](https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html):知道 vLLM 的接口和 OpenAI 有哪些差别,15 分钟。
- [DeepSeek 定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)、[RunPod 定价](https://www.runpod.io/pricing):今天算账用的两个价格来源,算之前自己再核一遍。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QWpK68EFA&autoplay=0&high_quality=1" title="普通电脑怎么本地跑大模型？显存、量化、7B/8B、Ollama 一次讲透" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI算法工程师Power · 普通电脑怎么本地跑大模型?显存、量化、7B/8B、Ollama 一次讲透 · 10 分钟,讲清楚参数量、量化位数和内存的关系。下载模型之前先看,能判断自己的电脑跑多大的合适。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ot9WBfE58&autoplay=0&high_quality=1" title="大模型部署选Ollama还是vLLM？看完直接不踩坑" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT塔台 · 大模型部署选Ollama还是vLLM?看完直接不踩坑 · 7 分钟,对照今天第一步和第六步看,两个工具各自适合什么场景。</figcaption>
</figure>

想系统学 Ollama 做应用的话,B 站上大模型观察员的《2026 超详细 Ollama 保姆级教程》合集([BV1qfPQzBEYR](https://www.bilibili.com/video/BV1qfPQzBEYR/))很长,挑安装、API 调用两部分看即可。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/UtSSMs6ObqY" title="Learn Ollama in 15 Minutes - Run LLM Models Locally for FREE" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Tech With Tim · Learn Ollama in 15 Minutes · 英文,装 Ollama、拉模型、用 Python 调用,15 分钟走完,和今天前三步一一对应。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 9 章「Inference Optimization」讲推理服务为什么要批处理、延迟和吞吐怎么取舍,看完你会明白 vLLM 在解决什么问题。英文原版,挑这一章读,1 小时。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024),中文版《图解大模型》(人民邮电出版社):图多,讲本地加载和量化模型的部分适合今天这种「先有直觉」的阶段,挑相关章节读,40 分钟。

### 开源项目与代码

- [ollama/ollama](https://github.com/ollama/ollama):README 里有 REST API 说明和支持的平台。
- [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp):Ollama 底层的推理引擎,GGUF 格式就是它定的。看 README 了解它支持哪些硬件就行,不用读源码。
- [vllm-project/vllm](https://github.com/vllm-project/vllm):看 README 了解定位和支持的硬件。

## 自测

**1. 0.6B、8B 是什么意思?Q8_0 又是什么意思?**

<details><summary>答案</summary>

0.6B、8B 是模型的参数个数,B 是十亿,0.6B 约 6 亿个参数。Q8_0 是一种量化方式,每个参数大约用 8 位(1 字节)存,所以 6 亿参数的文件约 600MB,我们下载的那个是 639MB。不量化时一个参数一般用 16 位,文件大一倍。

</details>

**2. 同一个 `ask.py`,从 DeepSeek 切到本地 Ollama 要改哪几个环境变量?为什么 `LLM_EXTRA_BODY` 也要改?**

<details><summary>答案</summary>

改 `LLM_BASE_URL`(换成 `http://localhost:11434/v1`)、`LLM_API_KEY`(本地不校验,随便一个非空字符串)、`LLM_MODEL`(本地模型名),再加 `LLM_EXTRA_BODY`。前三个是 OpenAI 兼容协议的骨架;`LLM_EXTRA_BODY` 装的是厂商专属参数,DeepSeek 关思考的写法是 `{"thinking": {"type": "disabled"}}`,Ollama 不认识会直接忽略,要换成它认的 `{"reasoning_effort": "none"}`,否则思考关不掉。

</details>

**3. 调本地模型返回的 `content` 是空字符串,`finish_reason` 是 `length`,最可能是什么原因?**

<details><summary>答案</summary>

思考模式开着,`max_tokens` 的额度全被思考过程用掉了,还没来得及写答案就到了上限。返回里的 `reasoning` 字段能看到那段没写完的思考。关掉思考(`reasoning_effort: none` 或 `--think=false`),或者把 `max_tokens` 调大。

</details>

**4. 一个 639MB 的模型,为什么 `ollama ps` 显示占了 5.6GB?怎么降下来?**

<details><summary>答案</summary>

运行时除了模型参数,还要按上下文窗口大小预留存放中间结果(KV cache)的内存。这个模型默认窗口是 40960 个 token,所以预留了很多。把 `num_ctx` 设成 4096(请求里的 `options`,或起服务前设 `OLLAMA_CONTEXT_LENGTH`),实测降到 1.1GB。代价是能处理的上下文变短。

</details>

**5. 面试题:「你们为什么不自己部署开源模型?」请用数字回答。**

<details><summary>答案</summary>

参考答法:我们算过打平点。按 2026 年 10 月的价格,租一张 4090 最低每小时 0.34 美元,一个月 24 小时开着是 245 美元;我们的工单请求每次约 3000 输入、300 输出 token,DeepSeek 缓存命中八成时一次约 0.00055 美元,要每天约 1.5 万次请求才打平。换成生产该用的稳定档、两张卡做冗余,打平点到每天 7.7 万次,这还没算运维人力和峰值配卡。另外 4090 上跑的是 8B 级别的模型,在我们的评测集上和云端模型有差距。我们现在每天几千次,远没到。自部署真正的理由是数据不能出域、要用微调模型或者量极大,目前都不成立。架构上我们用 OpenAI 兼容协议和环境变量切厂商,真要切到 vLLM,改配置就行,我在本机用 Ollama 验证过这一点。

</details>

**6. 面试题:Ollama 和 vLLM 你会怎么选?**

<details><summary>答案</summary>

看场景。个人开发、在笔记本或单机上试模型、做离线 demo,用 Ollama:装起来一条命令,CPU 和 Apple 芯片都能跑,自带模型下载和 OpenAI 兼容接口。在 GPU 服务器上给很多用户提供服务,用 vLLM:它靠批处理让一张卡同时服务大量请求,吞吐高很多,也支持工具调用解析、多卡并行这些生产需要的功能。两者都提供 OpenAI 兼容接口,所以应用代码不用跟着改,开发时连 Ollama,上线时连 vLLM,只是换配置。

</details>

## 明天预告

明天是 Day 429 · 托管 Agent 运行时:自建还是租。今天我们把「模型」这一层拿到自己手里跑了一遍;明天往反方向走,看看 2026 年各家云厂商在卖的「托管 Agent 运行时」:连循环、沙箱、会话都替你跑。它们到底托管了哪几层,运行时那部分钱怎么算,和我们一路自己搭的这套比,什么时候该自建、什么时候该租,最后落成一张决策表。
