---
title: 'Day 76 · 自部署推理:vLLM / SGLang 上线一个开源模型'
description: '把一个开源模型跑成 OpenAI 兼容接口,让 SupportPilot 改一个环境变量就能调用。先算清楚什么时候值得自部署,再用显存账解释 vLLM 为什么快,最后用压测工具量出吞吐和延迟,把昨天 TCO 里空着的那一项填上。'
pubDate: 2026-10-12
regime: none
tags: ['vllm', 'sglang', 'self-hosting', 'quantization', 'benchmark', 'agent-60']
series: 'agent-60'
day: 76
lang: 'zh'
---

## 今天要解决的问题

昨天的 TCO 算式里,「自部署」那一项还空着。很多团队对自部署的印象停留在两个极端:要么觉得「开源模型免费,自己部署肯定省钱」,要么觉得「GPU 运维太复杂,碰都别碰」。两种看法都不对。今天我们真把一个模型跑起来,用数据说话。

学完今天,你应该能做到:

1. 写出自部署的成本拐点算式,能判断你们的调用量离「值得自部署」还差多远,以及除了钱之外还有哪些自部署的理由。
2. 用显存账解释 vLLM 的核心机制:权重占多少、KV cache 每个 token 占多少、一张卡能同时服务多少请求,为什么连续批处理能让吞吐翻几倍。
3. 在 Colab 免费 T4 或一张租来的云 GPU 上用 vLLM 起一个 Qwen3 模型,开启工具调用,用 OpenAI SDK 调通,并让 SupportPilot 切过去跑一遍评测。
4. 用 `vllm bench serve` 压测,读懂 TTFT、TPOT、ITL 这几个指标,画出「并发数 → 吞吐 / 延迟」曲线。
5. 知道 AWQ、GPTQ、FP8、GGUF 这几种量化各适合什么场景,能用自己的评测集验证量化有没有伤到效果。

预计用时 5–7 小时,大部分时间花在等模型下载和压测上。前置:Day 41(部署)、Day 75(选型与 TCO)。今天需要 GPU,两条路线都给你。

## 先算账:什么时候值得自部署

自部署和 API 的成本结构完全不同。API 是按量付费,用多少花多少;自部署是租卡付费,卡开着就在计费,不管有没有请求。所以两条成本线一条随调用量线性上涨,一条基本是平的,中间有一个交点。

```text
API 月费      = 月调用量 × 单次调用成本
自部署月费    = 卡数 × 每卡小时价 × 每月运行小时 + 运维人力 + 存储带宽
单卡月产能    = 单卡可持续吞吐(token/s) × 3600 × 每月运行小时 × 利用率
需要的卡数    = ceil(月 token 量 ÷ 单卡月产能),再至少 +1 做冗余
```

拿一个演示用的例子过一遍(吞吐是假设值,后面你要用自己的压测结果替换):一张 RTX 4090 在国内按量租卡平台大约每小时 2 元上下(2026 年第三方文章里的报价在 1.7 到 2.7 元之间浮动,以平台控制台为准),一个月 24 小时开着就是 2 × 24 × 30 = 1,440 元。假设这张卡跑一个 4B 模型、在你的工单负载下可持续处理 1,500 token/s(输入加输出),利用率 40%(夜里没什么工单),一个月能处理 1,500 × 3600 × 720 × 0.4 ≈ 15.6 亿 token。

再看 API 这边。按 Day 52 里查到的 deepseek-flash 高峰价,输入未命中 2 元/百万、输出 8 元/百万,一张工单走完四次调用大约 1.7 万输入、700 输出 token,缓存命中一部分后单张工单大约几分钱。每天 3,000 张工单,一个月 9 万张,月费在几千元的量级。

这样看自部署似乎更便宜。但这笔账漏了三样东西。第一,质量不对等:你自部署的 4B 模型和 API 背后的大模型不是一个级别,昨天的 bakeoff 很可能显示它在起草回复这种节点上差一截,于是只能替代分类这类简单节点,省下的只是总账单的一小部分。第二,人力:模型服务挂了半夜谁起来处理,升级 vLLM 版本谁来回归测试,这些按人天折算往往比卡费还贵。第三,冗余:生产环境至少两张卡,不然一次重启服务就中断。

所以对大部分应用团队,结论通常是:先用 API,把成本拆到节点;当某个高频、简单的节点(比如分类)月调用量很大,又能用小模型做好时,把这一个节点自部署,其他节点继续用 API。Day 79 和 Day 81 就是在做这件事。

钱之外,还有几种情况自部署是刚需:数据不能离开内网(很多金融、政务、医疗客户);需要用自己微调过的模型(Day 77 训练出来的 LoRA,大部分 API 不让你挂);需要稳定的版本和延迟,不想被厂商的别名升级和高峰限流影响;需要 logprobs、约束解码这类 API 不一定开放的能力。

## 显存账:vLLM 为什么快

自部署绕不开的一个问题是:一张卡到底能同时服务多少请求?答案藏在显存账里。显存主要被两样东西占:模型权重和 KV cache。

权重好算:参数量 × 每个参数的字节数。Qwen3-4B-Instruct-2507 大约 40 亿参数,bf16 每个参数 2 字节,权重约 8.0 GB(Hugging Face 上 safetensors 文件合计也正好是 8.0 GB)。

KV cache 是推理时为每个 token 缓存的注意力键值,生成下一个 token 时要读之前所有 token 的 K 和 V,所以对话越长、并发越多,占得越多。每个 token 的 KV 大小:

```text
KV 每 token 字节 = 2(K 和 V) × 层数 × KV 头数 × 每头维度 × 每个数的字节数
```

我查了 Qwen3-4B-Instruct-2507 的 `config.json`:36 层,8 个 KV 头,每头 128 维。bf16 下:

```text
2 × 36 × 8 × 128 × 2 = 147,456 字节 ≈ 144 KB / token
```

一张 24 GB 的 4090,vLLM 默认让自己用 90% 显存,也就是约 21.6 GB。减掉 8.0 GB 权重,再留 1.5 GB 左右给运行时的激活和 CUDA graph(经验值,不同版本不一样),剩下约 12 GB 能给 KV cache:

```text
12 × 1024³ ÷ 147,456 ≈ 87,000 个 token
```

SupportPilot 一次起草调用的上下文大约 7,000 到 8,000 token,算下来这张卡同时能装下十来个这样的请求。这个数字就是并发上限的来源,超过它的请求只能排队。

传统推理框架给每个请求按「最大可能长度」预留一整块连续显存,大部分请求根本用不到那么长,白白浪费。vLLM 的 PagedAttention 借鉴了操作系统的分页内存:把 KV cache 切成固定大小的小块,按需分配,请求用多少拿多少,不要求连续。浪费少了,同样的显存能塞进更多并发请求。

另一个关键是连续批处理(continuous batching)。生成是一个 token 一个 token 往外吐的,每一步 GPU 都要把整个模型的权重读一遍。如果一次只服务一个请求,读一遍权重只产出一个 token,大部分算力在等显存带宽。把很多请求的这一步拼成一批,读一遍权重就能同时产出几十个 token。传统的静态批处理要等一批请求全部生成完才能换下一批,先完成的请求干等着;连续批处理在每一步都把完成的请求踢出去、把新请求补进来,GPU 一直是满的。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一张 24GB 显卡的显存分配:权重、运行时开销、KV cache 块">
<text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">RTX 4090 · 24 GB · gpu-memory-utilization 0.9</text>
<rect x="20" y="45" width="600" height="56" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="20" y="45" width="200" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="120" y="70" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">权重 8.0 GB</text>
<text x="120" y="88" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">4B × 2 字节</text>
<rect x="220" y="45" width="38" height="56" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="239" y="77" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">运行</text>
<g fill="var(--compute-wash)" stroke="var(--compute)">
<rect x="262" y="49" width="28" height="22"/><rect x="292" y="49" width="28" height="22"/><rect x="322" y="49" width="28" height="22"/><rect x="352" y="49" width="28" height="22"/><rect x="382" y="49" width="28" height="22"/><rect x="412" y="49" width="28" height="22"/><rect x="442" y="49" width="28" height="22"/><rect x="472" y="49" width="28" height="22"/><rect x="502" y="49" width="28" height="22"/><rect x="532" y="49" width="28" height="22"/>
<rect x="262" y="75" width="28" height="22"/><rect x="292" y="75" width="28" height="22"/><rect x="322" y="75" width="28" height="22"/><rect x="352" y="75" width="28" height="22"/><rect x="382" y="75" width="28" height="22"/>
</g>
<rect x="412" y="75" width="148" height="22" fill="none" stroke="var(--rule)" stroke-dasharray="3 3"/>
<text x="486" y="90" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">空闲块</text>
<rect x="562" y="45" width="58" height="56" fill="var(--paper)" stroke="var(--rule)"/>
<text x="591" y="77" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">预留 10%</text>
<text x="400" y="128" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">KV cache ≈ 12 GB ≈ 8.7 万 token,切成小块按需分给请求</text>
<text x="20" y="168" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">每块属于某个请求:</text>
<rect x="20" y="180" width="28" height="18" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="56" y="194" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">请求 A 的前 16 个 token</text>
<text x="20" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">请求结束就把块还回池子,新请求立刻能用,不需要连续的大块显存</text>
</svg>
<figcaption>显存账是理解自部署的钥匙。权重是固定开销,KV cache 决定能同时服务多少请求。数字按 Qwen3-4B-Instruct-2507 的 config 算出,运行时开销是经验值。</figcaption>
</figure>

这两点合起来,让你能读懂两个推理指标的变化规律。TTFT(首 token 时间)主要由 prefill 决定:把整段输入一次性算完,输入越长越慢,而且新请求要排队等进入批次。TPOT(每个输出 token 的平均时间)主要由 decode 决定:并发越高,每一步的批越大,单个请求的 TPOT 会变慢一点,但整卡的总吞吐大幅上升。压测时你会看到吞吐随并发上升然后变平、延迟随并发缓慢变长然后陡增,那个拐点就是这张卡的合理工作点。

SGLang 是另一个主流推理框架,也用连续批处理和类似的 KV 管理,另外有一个叫 RadixAttention 的前缀缓存机制,对「很多请求共享同一段长系统提示」的 Agent 场景特别友好。SupportPilot 每次调用都带着同一段几千 token 的系统提示和工具定义,正是这种场景。vLLM 也有自动前缀缓存。两个框架你都可以试,对应用工程师来说差别主要在部署细节和对具体模型的支持速度上,用压测数据选。

## 路线一:Colab 免费 T4

Colab 免费版通常给一张 T4,16 GB 显存,Turing 架构,不支持 bf16,所以要用 fp16。vLLM 对 T4 这类老卡的支持时好时坏,新版本的某些优化只支持更新的架构,社区里有不少「T4 上起不来」的讨论。所以这条路线我的建议是:能跑通最好,跑不通别死磕,直接走路线二。

在 Colab 里新建笔记本,运行时类型选 T4 GPU,然后:

```python
# Colab 单元 1:安装(vLLM 版本以 PyPI 最新为准,2026-10 查到的是 0.31.x)
!pip install -q vllm openai
!nvidia-smi
```

```python
# Colab 单元 2:后台启动服务。4B 模型 fp16 约 8 GB,T4 16 GB 放得下
import subprocess, time
server = subprocess.Popen(
    ["vllm", "serve", "Qwen/Qwen3-4B-Instruct-2507",
     "--dtype", "half",                    # T4 不支持 bf16
     "--max-model-len", "8192",            # 别用默认的 26 万,显存装不下
     "--gpu-memory-utilization", "0.85",
     "--enable-auto-tool-choice", "--tool-call-parser", "hermes",
     "--port", "8000"],
    stdout=open("vllm.log", "w"), stderr=subprocess.STDOUT)
time.sleep(5)
print(open("vllm.log").read()[-2000:])
```

模型第一次要从 Hugging Face 下载 8 GB,Colab 上一般几分钟。日志里出现 `Application startup complete` 就是起来了。工具调用解析器用 `hermes`,这是 Qwen 官方文档给 Qwen3 系列的写法。

```python
# Colab 单元 3:用 OpenAI SDK 调,和调 DeepSeek 一模一样
import os
from openai import OpenAI
os.environ["VLLM_HOST"] = "localhost:8000"     # 服务和笔记本在同一台机器上
cli = OpenAI(base_url="http://" + os.environ["VLLM_HOST"] + "/v1", api_key="EMPTY")
r = cli.chat.completions.create(
    model="Qwen/Qwen3-4B-Instruct-2507",
    messages=[{"role": "user", "content": "用一句话解释什么是发票红冲"}],
    max_tokens=200)
print(r.choices[0].message.content, r.usage)
```

## 路线二:租一张云 GPU

国内可以用 AutoDL 这类按量租卡平台,海外可以用 RunPod。我 2026 年 10 月 12 日在 RunPod 定价页上看到的标价(美元每小时,随云类型和规格变化):RTX 4090 24 GB 约 0.89、L4 24 GB 约 0.59、L40S 48 GB 约 1.09、A100 80 GB 约 1.79。按秒计费,用完立刻销毁实例,一次实验花几块钱。

24 GB 的卡跑 Qwen3-4B-Instruct-2507 的 bf16 版本很宽裕。如果租到 48 GB 的 L40S,可以试 `Qwen3-30B-A3B-Instruct-2507-FP8`:总参数 300 亿,但每个 token 只激活约 30 亿,FP8 权重文件约 31 GB,速度接近小模型、能力接近中等模型,很适合 Agent 的分类和起草。它的 KV 是 48 层 × 4 个 KV 头 × 128 维,每 token 约 96 KB。

用 Docker 起服务最省心,vLLM 官方镜像带好了 CUDA 依赖:

```bash
# 云 GPU 实例上
docker run --gpus all --ipc=host -p 8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen3-4B-Instruct-2507 \
  --max-model-len 16384 \
  --gpu-memory-utilization 0.9 \
  --enable-auto-tool-choice --tool-call-parser hermes \
  --api-key "$VLLM_API_KEY"
```

`--api-key` 一定要加,否则你的端口暴露在公网上谁都能调。国内实例下载 Hugging Face 慢,可以设置 `HF_ENDPOINT` 走镜像,或者先从 ModelScope 下载到本地目录,再把 `--model` 指向本地路径。

想换 SGLang 对比一下,官方快速开始里的命令是这样:

```bash
docker run --gpus all --ipc=host -p 30000:30000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  lmsysorg/sglang:latest \
  sglang serve Qwen/Qwen3-4B-Instruct-2507 --host 0.0.0.0 --port 30000
```

工具调用解析器等参数的名字两个框架不一样,照各自文档里对应模型的写法来。

本地电脑连云上的服务,最安全的是 SSH 隧道,不用把端口开到公网:

```bash
ssh -N -L 8000:localhost:8000 root@你的实例地址 -p 端口
```

然后 SupportPilot 只改环境变量:

```bash
export LLM_BASE_URL=http://${VLLM_HOST:-localhost:8000}/v1
export LLM_API_KEY=$VLLM_API_KEY
export LLM_MODEL=Qwen/Qwen3-4B-Instruct-2507
uv run python -m evals.run_eval --split dev --label selfhost-qwen3-4b
```

这就是 Day 3 坚持用 OpenAI 兼容协议、用环境变量切厂商的回报:换成自部署模型,业务代码一行不改。不过要提醒你,评测分数大概率会掉,一个 4B 模型在 SupportPilot 的完整流程里通常扛不住起草和多轮工具调用。这正是我们只打算让它接分类节点的原因,把评测按节点拆开看。

## 压测:量出这张卡的真实产能

`vllm bench serve` 是 vLLM 自带的压测工具,用随机生成的输入模拟负载。在实例上另开一个终端:

```bash
# 模拟 SupportPilot 的形状:输入长、输出短
for c in 1 4 8 16 32; do
  vllm bench serve \
    --backend openai-chat --endpoint /v1/chat/completions \
    --model Qwen/Qwen3-4B-Instruct-2507 \
    --host 127.0.0.1 --port 8000 \
    --dataset-name random --random-input-len 6000 --random-output-len 300 \
    --num-prompts 200 --max-concurrency $c \
    --save-result --result-filename bench_c$c.json
done
```

输入 6,000、输出 300 是按 SupportPilot 起草节点的形状估的,你应该用自己 Langfuse 里的真实分布替换。默认报告的指标有 TTFT、TPOT、ITL(相邻两个输出 token 的间隔),每个给均值、中位数和 P99,以及总吞吐。把结果填进下面的表(我没有在你的卡上跑过,留空):

| 并发 | 请求吞吐 req/s | 输出吞吐 tok/s | TTFT P50 ms | TTFT P99 ms | TPOT P50 ms | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | |
| 4 | | | | | | |
| 8 | | | | | | |
| 16 | | | | | | |
| 32 | | | | | | |

预期的形状是:吞吐随并发上升然后趋于平缓,TTFT 的 P99 在某个并发之后陡增(请求开始排队)。选工作点的标准不是「吞吐最大」,而是「在 TTFT P99 和 TPOT 满足你的 SLO 的前提下吞吐最大」。比如你定的 SLO 是 TTFT P99 低于 2 秒,就找满足这个条件的最大并发。vLLM 的压测工具还支持 `--goodput` 参数,直接统计满足 SLO 的请求比例。

拿到工作点吞吐之后,回到开头的算式,把「假设的 1,500 token/s」换成你的实测值,自部署那一项就有了真实数字。

## 量化:用精度换显存和速度

量化是把模型权重从 16 位压到 8 位甚至 4 位。省下的显存可以装更大的模型或者更多 KV cache,读权重的数据量变少,decode 也会更快。代价是可能损失一点效果。常见的几种:

| 格式 | 怎么做 | 适合 |
| --- | --- | --- |
| FP8 | 权重(常常连激活)用 8 位浮点,需要较新的卡(Ada、Hopper 及以后)才有硬件加速 | 新卡上的生产部署,效果损失通常很小 |
| AWQ | 4 位权重,根据激活分布保护重要的权重通道 | 显存紧张的卡上跑更大的模型 |
| GPTQ | 4 位权重,逐层用少量校准数据最小化误差 | 和 AWQ 类似,生态成熟 |
| GGUF | llama.cpp 的格式,有很多档位(如 Q4_K_M) | CPU、Mac、Ollama 这类本地场景,不是 vLLM 的主场 |

很多模型厂商直接发布量化版本,比如 Qwen 在 Hugging Face 上同时有 `Qwen3-8B-FP8` 和 `Qwen3-8B-AWQ`,vLLM 能自动识别格式加载。T4 没有 FP8 硬件,在 T4 上用 4 位的 AWQ 或 GPTQ 更现实。

量化有没有伤效果,不要看厂商发的通用 benchmark,用你自己的评测集测:同一个模型的 bf16 版本和量化版本各起一个服务,用 Day 75 的 `bakeoff.py` 各跑一遍,对比分类准确率和 JSON 合法率。经验上 8 位几乎看不出差别,4 位在严格格式输出和长上下文上偶尔会出问题,值不值得只有你的数据能回答。

## 动手练习

今天的产出物是一个跑起来的自部署端点、一份压测报告,和补完整的 TCO。

1. 二选一:在 Colab T4 上起 Qwen3-4B-Instruct-2507(路线一),或者租一张 24 GB 以上的云 GPU 用 Docker 起(路线二)。在实例上用 `curl localhost:8000/v1/models` 确认服务在线。
2. 工具调用冒烟测试:把 Day 75 `bakeoff.py` 里的 `run_tool_probe` 单独拿出来,对自部署端点跑 10 次,记录成功率。
3. 切换 SupportPilot:改环境变量,只让分类节点走自部署模型(Day 52 的路由配置里把 `MODEL_CLASSIFY` 指过去,其他节点不变),跑一遍 dev 集,记录分类准确率和整体分数的变化。
4. 压测:按上面的脚本跑五档并发,填表,标出你的工作点和对应的 SLO。
5. 补完 TCO:用实测工作点吞吐重算单卡月产能和需要的卡数,写一段 200 字的结论:按你们的调用量,分类节点自部署划不划算,拐点在每月多少调用量。
6. 用完立刻销毁云实例。截图你的账单页面,记下这次实验总共花了多少钱。

验收标准:有一个能用 OpenAI SDK 调通、支持工具调用的自部署端点;压测表至少填满三档并发;TCO 结论里引用了你的实测吞吐,并且写清楚算式里哪些数是假设。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| vLLM | 开源的大模型推理服务框架,核心是 PagedAttention 和连续批处理,提供 OpenAI 兼容接口 |
| SGLang | 另一个主流推理框架,前缀缓存(RadixAttention)对共享长系统提示的场景友好 |
| KV cache | 推理时缓存的每个 token 的注意力键和值,长度越长、并发越多占显存越多 |
| PagedAttention | 把 KV cache 切成固定小块按需分配,减少显存碎片和浪费 |
| 连续批处理 | 每生成一步就把完成的请求移出、新请求补进,让 GPU 始终满负载 |
| prefill / decode | 推理的两个阶段:一次性处理整段输入,以及逐个生成输出 token |
| TTFT / TPOT / ITL | 首 token 时间 / 每个输出 token 平均时间 / 相邻输出 token 的间隔 |
| goodput | 满足延迟 SLO 的有效吞吐,比单纯的吞吐更贴近线上体验 |
| AWQ / GPTQ / FP8 / GGUF | 几种常见的权重量化格式,用精度换显存和速度 |

## 常见误区

**以为开源模型免费所以自部署省钱。** 卡开着就在计费,夜里没请求也在烧钱;还要算冗余、运维人力,以及小模型替代不了大模型的那部分质量差距。先算账,大多数时候答案是「只把某个高频简单节点自部署」。

**`--max-model-len` 用默认值。** Qwen3-4B-Instruct-2507 的配置里最大位置是 26 万,vLLM 按这个长度检查显存,小卡上直接起不来。按你的真实需求设一个够用的值。

**只看平均延迟。** 用户感知的是尾延迟。压测时盯 TTFT 和 TPOT 的 P99,并且明确写出 SLO 再选工作点。

**用随机数据的压测结果直接当线上容量。** 随机输入不会命中前缀缓存,而你的真实请求有大量共享前缀,线上吞吐可能比压测好;反过来真实请求的长度分布比固定长度更分散,尾延迟可能更差。压测完要用一小段真实流量回放验证。

**服务开在公网不加鉴权。** 自部署的 OpenAI 兼容接口没有 `--api-key` 就是一个谁都能用的免费 GPU,被扫到很快就会被刷爆。用 SSH 隧道或者至少加 key 和防火墙。

## 学习资料

### 文档与文章

- [vLLM 快速开始](https://docs.vllm.ai/en/latest/getting_started/quickstart.html):安装和 `vllm serve` 的基本用法,30 分钟。
- [vLLM 工具调用](https://docs.vllm.ai/en/latest/features/tool_calling.html):`--enable-auto-tool-choice` 和各模型的解析器对照表,上线前对一遍你的模型用哪个。
- [vLLM 压测工具 bench serve](https://docs.vllm.ai/en/latest/cli/bench/serve.html):全部参数和指标说明,`--goodput` 那段要读。
- [vLLM 量化文档](https://docs.vllm.ai/en/latest/features/quantization/index.html):支持哪些格式、每种格式需要什么硬件。
- [vLLM 性能调优](https://docs.vllm.ai/en/latest/configuration/optimization.html):显存利用率、批大小、抢占这些参数的含义。
- [Qwen 官方文档 · vLLM 部署](https://qwen.readthedocs.io/zh-cn/latest/deployment/vllm.html):Qwen 系列的推荐启动参数,工具调用、思考模式开关都在这里,中文。
- [SGLang 快速开始](https://docs.sglang.io/docs/get-started/quickstart):SGLang 的安装和启动命令。
- [PagedAttention 论文](https://arxiv.org/abs/2309.06180):vLLM 的原始论文,读第 1、3、4 节,1 小时。
- [SGLang 论文](https://arxiv.org/abs/2312.07104):RadixAttention 的设计,读第 3 节。
- [AWQ 论文](https://arxiv.org/abs/2306.00978)和 [GPTQ 论文](https://arxiv.org/abs/2210.17323):量化方法的原理,读摘要和方法概述即可。
- [RunPod 定价页](https://www.runpod.io/pricing)和 [AutoDL](https://www.autodl.com/):海外和国内租卡的入口,价格以控制台为准。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kx4y1x7bu&autoplay=0&high_quality=1" title="怎么加快大模型推理?10分钟学懂VLLM内部原理,KV Cache,PageAttention" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>RethinkFun · 怎么加快大模型推理?10分钟学懂VLLM内部原理,KV Cache,PageAttention · 12 分钟,把今天的显存账和分页机制讲得很直观,建议先看它再读正文的显存一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1euPkerEun&autoplay=0&high_quality=1" title="【13】GPTQ、AWQ、GGUF等模型量化概念讲解" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>LLM张老师 · 【13】GPTQ、AWQ、GGUF等模型量化概念讲解 · 18 分钟,把几种量化格式的区别和适用场景讲清楚,对应正文量化一节。</figcaption>
</figure>

- 九天Hector · [DeepSeek v3本地部署与调用实战|vLLM、SGLang、LMDeploy](https://www.bilibili.com/video/BV1jjwVe4EKn):4 个分 P,演示三个框架的部署和调用,看第 1、2 P 里 vLLM 和 SGLang 的部分。
- SGLang_Official · [180秒带你快速了解SGLang](https://www.bilibili.com/video/BV12due6NESh):SGLang 官方频道的 3 分钟介绍。
- 探索未至之境 · [14款本地大模型工具全面对比](https://www.bilibili.com/video/BV1LXDPBcE5N):Ollama、LM Studio、vLLM、SGLang 的定位差异,9 分钟。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/5ZlavKF_98U" title="Fast LLM Serving with vLLM and PagedAttention" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anyscale · Fast LLM Serving with vLLM and PagedAttention · vLLM 作者的演讲,讲 KV cache 浪费从哪来、分页怎么解决,半小时左右,和论文配合看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7xTGNNLPyMI" title="Deep Dive into LLMs like ChatGPT" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · Deep Dive into LLMs like ChatGPT · 三个半小时,今天只看讲推理(inference)和 token 逐个生成的那一段,帮你理解 prefill 和 decode 为什么是两个阶段。</figcaption>
</figure>

- Stanford Online · [CS336 Spring 2025 Lecture 10: Inference](https://www.youtube.com/watch?v=fcgPYo3OtV0):斯坦福课程讲推理的一讲,比今天深一层,有时间再看(这个视频不允许嵌入,点链接去 YouTube 看)。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 9 章 Inference Optimization,讲推理指标、批处理、量化和服务优化,和今天几乎一一对应,1.5 小时。

### 开源项目与代码

- [vllm-project/vllm](https://github.com/vllm-project/vllm):看 `benchmarks/` 目录和 `vllm/entrypoints/openai/` 下 OpenAI 兼容服务的入口,知道请求从哪里进来。
- [sgl-project/sglang](https://github.com/sgl-project/sglang):对照着看 README 里的特性列表。

## 自测

1. 按文中方法算一下:Qwen3-30B-A3B-Instruct-2507 有 48 层、4 个 KV 头、每头 128 维,bf16 的 KV cache 每个 token 占多少?和 Qwen3-4B-Instruct-2507 比为什么反而更小?

<details><summary>答案</summary>

2 × 48 × 4 × 128 × 2 = 98,304 字节,约 96 KB。比 4B 模型的 144 KB 小,是因为它的 KV 头数更少(4 对 8),虽然层数更多。KV 大小由层数、KV 头数和每头维度决定,和总参数量没有直接关系;MoE 的专家参数主要在前馈层,不影响 KV。

</details>

2. 为什么连续批处理能让吞吐大幅提升,而单个请求的 TPOT 会略微变慢?

<details><summary>答案</summary>

decode 每一步都要把模型权重从显存读一遍,单个请求时读一遍只产出一个 token,瓶颈在显存带宽。把多个请求拼成一批,读一遍权重同时产出多个 token,总吞吐大幅上升。但批越大,每一步要算的东西越多,单步时间略变长,所以单个请求每个 token 的时间会变慢一点。连续批处理还能随时补进新请求,不让 GPU 空等。

</details>

3. 一张卡起了 4B 模型,压测发现并发从 8 到 16 时输出吞吐只涨了 5%,TTFT P99 从 0.8 秒涨到 3.5 秒。你会怎么解读,工作点选哪个?

<details><summary>答案</summary>

吞吐基本饱和,多出来的并发只是在排队,TTFT 尾延迟被排队拉高。如果 SLO 要求 TTFT P99 在 2 秒内,工作点应选 8 或在 8 和 16 之间再测几档找满足 SLO 的最大值。再往上加并发没有收益,只会伤体验,需要的话加卡横向扩展。

</details>

4. 列出至少三个「不是为了省钱」的自部署理由。

<details><summary>答案</summary>

数据不能离开内网(合规);要用自己微调的模型或挂 LoRA;要固定模型版本、不受厂商别名升级影响;要稳定可控的延迟,不受 API 高峰限流影响;需要 logprobs、约束解码等 API 不一定开放的能力。

</details>

5. (资深面试题)公司想把客服 Agent 全部切到自部署开源模型,理由是「API 太贵」。你作为负责人怎么评估这个提议?

<details><summary>答案</summary>

先把现有成本拆到节点,算清楚 API 月费的结构;再用自有评测集按节点比较候选开源模型和现有 API 的质量,通常会发现简单节点(分类、自检)可以替代,起草和复杂工具调用差距明显。然后算自部署的 TCO:按压测得到的工作点吞吐和 SLO 算需要的卡数,加冗余、运维人力、升级回归的成本,得出成本拐点。再看非成本因素:合规是否要求私有化、团队有没有 GPU 运维能力、模型升级节奏谁来负责。结论通常是分阶段:先把高频简单节点自部署并灰度验证,保留 API 作为复杂节点和故障时的兜底,用实际账单和线上指标决定是否继续扩大范围。要讲清楚风险:单点故障、版本升级、峰值容量。

</details>

6. 你在 T4 上用 FP8 版本的模型启动 vLLM,速度没有提升甚至报错,可能是什么原因?

<details><summary>答案</summary>

T4 是 Turing 架构,没有 FP8 的硬件支持,FP8 的加速需要 Ada、Hopper 及更新的卡。在 T4 上应该用 fp16 原版,或者 4 位的 AWQ、GPTQ 量化版本。

</details>

## 明天预告

Day 77 · 微调入门:什么时候该微调,LoRA SFT 跑一遍。今天的自部署端点能挂你自己训练的模型了。明天先讲清楚什么问题该用提示词、什么该用 RAG、什么才轮到微调,然后从 SupportPilot 的 trace 里造一份训练集,在 Colab 上用 LoRA 训练一个专门做工单分诊的模型,和原版比一比。
