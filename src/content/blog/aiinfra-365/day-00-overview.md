---
title: 'Day 0 · 这条路为什么是 AI Infra，以及 12 个月怎么走'
description: '开工前把三件事写死：为什么选 AI Infra 而不是 AI 应用层，为什么先攻推理不碰分布式训练，以及 12 个月每一段要交出什么东西。这一篇是整个 365 天系列的地图。'
pubDate: 2026-08-29
regime: none
tags: ['roadmap', 'aiinfra-365']
series: 'aiinfra-365'
day: 0
lang: 'zh'
---

## 今天要解决的问题

三个月后我一定会怀疑自己：这条路是不是选错了，是不是该回去做熟悉的东西。所以在写第一行代码、算第一个数字之前，先把「为什么走这条路」和「走到哪一步算走通」写下来，以后动摇的时候回来读这一篇，而不是凭当时的情绪重新做决定。

这篇没有任何技术内容，全部是选择和规则。

## 为什么是 AI Infra，不是 AI 应用层

我是做了十几年前端和后端业务系统的工程师，对 transformer 的了解在动笔这天是零。摆在面前的 AI 相关方向大致三种：

| 方向 | 做什么 | 门槛 | 岗位数量 | 我的判断 |
| --- | --- | --- | --- | --- |
| AI 应用层 | 调 API、做 agent、做 RAG、做 chatbot | 低，前端后端经验直接复用 | 多，几乎每家公司都在招 | 供给会像当年前端一样迅速饱和 |
| 算法/研究 | 训模型、发论文、改架构 | 需要博士级数学和大量算力 | 少 | 我没有这个入场条件 |
| AI Infra | 让模型训得起、跑得快、跑得省 | 高，要懂 GPU、内存、并行、系统 | 少，只有自己部署推理或训练的公司才要 | 溢价久，但入场券贵 |

选第三条，理由不是「高薪」两个字，而是三条更冷静的观察：

**岗位少但溢价久**。应用层的门槛低到培训班能批量供货，所以红利期结束得快，十年前前端就是这样。AI Infra 的门槛卡在硬件和系统知识上，供给上不来，溢价会维持更长时间。代价是学习周期不是 3 到 6 个月，是 12 个月起。

**入场券贵**。这 12 个月里我要租 GPU、读源码、写 kernel，没有任何一步能靠「我以前做过类似的」跳过。billing 系统的经验在这里价值接近零，这一点我反复确认过：公司内部的 AI 项目全是 Vercel AI SDK 调 Anthropic/OpenAI API 的应用层代码，没有一行 CUDA、没有一个 tensor，攒不出 infra 履历。

**知识半衰期短**。vLLM 内部机制两年后可能换架构，今天学的 PagedAttention 细节到时候可能只剩「思路」有价值。这意味着不存在「学会了吃存量」，要一直跟。

还有一个必须校正的预期。我一开始把这条路类比成「十年前自学前端赶上红利期，找工作像喝水一样简单，工资两年翻倍」。这个类比错了一半：

- 岗位数量差一个数量级，不会「像喝水一样简单」，是「难找，但找到就贵」。
- 「两年翻倍」这条反而更可能成立，因为供给更少，跳槽套利空间更大。

写下来是为了以后别拿错的那一半来衡量进度。

## 核心判断：先攻推理，不要先碰分布式训练

这是整条路线最重要的一个决定，也是最常见的放弃原因所在。

新手最容易一头扎进分布式训练，因为它听起来最「infra」：FSDP、张量并行、流水线并行、NCCL。然后发现没有 8 张 H100 什么实验都做不了，租一小时几十美元，跑一次实验的钱够买一个月的推理实例。三个月后放弃。

推理侧才是入口，三个原因：

1. **单卡就能开始**。一张 A100 甚至一张消费卡就能测出所有关键数字。
2. **需求量大得多**。每家用模型的公司都要部署推理，但只有极少数公司训基座模型。
3. **能产出硬数字**。「吞吐提升 3.2 倍、成本降 60%」写在简历上有杀伤力，「我学过 FSDP」没有。

训练侧放到 M9 到 M10 再碰，那时候手里已经有推理产出物，租多卡的钱花得值。

## 12 个月路线

按业余每周 10 到 15 小时安排。前两个月不产出项目，只建判断力。这两个月省掉的话，后面所有优化都是瞎调。

| 阶段 | 时间 | 目标 | 产出物 |
| --- | --- | --- | --- |
| M1–M2 | W1–W8 | 建判断力：算力和内存花在哪，roofline，KV cache，batching，量化 | 第一篇公开技术帖 |
| M3–M4 | W9–W16 | 读 vLLM 源码，做推理优化实验 | 产出物 01：推理优化报告 |
| M5–M6 | W17–W24 | Triton 写 kernel | 产出物 02：一个 kernel 加三方对比 |
| M7–M8 | W25–W32 | 从零写最小推理引擎 | 产出物 03：开源引擎加实现笔记 |
| M9–M10 | W33–W40 | 训练侧：DDP、FSDP、NCCL、故障恢复 | 产出物 04：训练侧文章 |
| M11–M12 | W41–W48 | 作品集统一格式、简历重写、面试、投 | offer 或校准后的下一轮计划 |

### M1 每周任务

| 周 | 任务 | 产出 |
| --- | --- | --- |
| W1 | 读 Horace He《Making Deep Learning Go Brrrr》，手算一个 transformer 的 FLOPs 和显存占用 | 能回答「7B 模型推理时显存到底花在哪」 |
| W2 | Colab 上跑通小模型推理，用 `torch.profiler` 抓 trace 并看懂 timeline | 能指出哪个 op 最耗时、为什么 |
| W3 | 算出所租 GPU 的峰值算力和显存带宽，判断 workload 落在 roofline 哪一侧 | 自己画的 roofline 图加实测点 |
| W4 | 环境工程化：RunPod/Vast 开机脚本、SSH、持久化存储、成本监控 | 一条命令起环境，跑完自动销毁 |

### M2 每周任务

| 周 | 任务 | 产出 |
| --- | --- | --- |
| W5 | KV cache 从原理到实测：关掉和开启对比延迟和显存 | 数据加解释为什么差这么多 |
| W6 | 静态 batching 的问题、continuous batching 解决什么，读 vLLM 的 scheduler | 自己画的请求时序图 |
| W7 | 量化初步：跑 GPTQ 或 AWQ 版本，测精度、速度、显存三角 | 对比表 |
| W8 | 整合前 7 周的东西，写成第一篇公开技术帖 | 发出去的文章，不是草稿 |

M3 之后的每周任务在路线图里也拆好了，到时候再抄过来，现在写出来只会让我分心。

## 成本纪律

这条路的钱花在 GPU 租金上，纪律比预算重要。

- **W1 零成本**。纸、笔、免费 Colab。第一周的产出是一组数字，不需要任何付费资源。
- **Colab 免费版起步**，够跑小模型推理和 profiler。
- **付费从 RunPod 或 Vast 的 spot 实例开始**，按小时计费，目标月支出 30 到 60 美元。
- **跑完立刻销毁实例**。忘记关机一晚上的钱够买一周的实验。进实例之前脚本必须调试完，不在按小时计费的机器上想逻辑。
- **2018 年的 Intel MacBook Pro 只当终端**。Intel Mac 没有 MPS，本地跑不了任何 GPU 相关的东西，也别试。

## M4 止损点

M4 结束、产出物 01 做完的时候，问自己一个问题：这两个月是追着数字不肯睡，还是每次打开都靠意志力？

如果是后者，止损。四个月加两百美元，是很便宜的试错。这一条现在写下来，是为了到时候不要因为「已经投入了四个月」而硬撑。沉没成本不是继续的理由。

## 三个出口

不等到 M12 才想出口，现在就排好序。

**出口一，海外远程，最优先**。我已经在为一家美国公司做远程工作，英文沟通和跨时区交付是存量优势，多数国内候选人卡死在跨国雇佣这一关。进入方式不是投简历，是 GPU MODE 和 vLLM 社区里的可见度：认真提交过 kernel、被 maintainer review 过的 PR、公开的排行榜成绩。薪资参照：海外 CUDA 和推理优化岗 TC 在 30 万到 50 万美元以上，远程按全美 band 比旧金山低 10 到 15%，但中国境内 contractor 或 EOR 通常只拿美国 band 的 40 到 70%。

**出口二，国内 AI Infra，走平台层入口**。GPU 调度、推理服务部署这类岗位。按 AI 年限定级，第一份大概率降级。北京参照：3 到 5 年 60 到 100 万，5 到 8 年 100 到 180 万。

**出口三，留在现公司转 AI 应用，保底**。随时可以，但 infra 履历价值约等于零，这一条只是兜底。

关键动作：**别等 M12 才投**。M5 到 M6 就要试水面试，目的是校准不是拿 offer；同时提第一个开源 PR。

## 资源只用六样

信息过载是这条路的另一个死因。资源清单锁死在六样，不加：

| 资源 | 用途 | 什么时候用 |
| --- | --- | --- |
| Horace He《Making Deep Learning Go Brrrr》 | 三种瓶颈的判断框架 | W1 |
| GPU MODE lectures | GPU 编程讲座，配 PMPP | M5 起 |
| PMPP 第 4 版（Programming Massively Parallel Processors）英文版 | GPU 编程教材，不读中译 | W20 起 |
| Triton tutorials | 写 kernel 的入口 | M5 |
| vLLM 源码 | 推理引擎内部机制 | M3 起 |
| HuggingFace Ultra-Scale Playbook | 分布式训练 | M9 起 |

### 视频课主线

我要求「系统、全面、详细，不要 B 站几分钟」的课，最后定下来的是三条：

**Karpathy 的 Zero to Hero 系列**，先看《Let's build GPT: from scratch, in code, spelled out》。手写一个 GPT，每个矩阵的形状都看得见。

**Stanford CS336 2025**（Language Modeling from Scratch），YouTube playlist ID `PLoROMvodv4rOY23Y0BoGoBGgQ1zmU_MT_`。19 讲，和 M1 到 M10 几乎一一对应。先看第 1 到 3、5 到 8、10 讲。

**ZOMI酱《AIInfra》开源课**，中文补充。GitHub 仓库 Infrasys-AI/AIInfra，文档站 https://infrasys-ai.github.io/aiinfra-docs/ ，B 站空间 ID 517221395。全课 8 个模块，按 **0 → 6 → 5 → 4** 的顺序看，1、2、3、7 先跳：

| 顺序 | 模块 | 看什么 | 跳什么 |
| --- | --- | --- | --- |
| 1 | 00 大模型系统概述 | 全看，6 讲：Scaling Law 整体解读、大模型 Scaling Law、Inference Time Scaling、大模型训练与 AI Infra、大模型推理与 AI Infra、AI Infra 核心逻辑与行业趋势 | |
| 2 | 06 大模型算法与数据 | Transformer 架构、MoE 混合专家 | 创新架构、图文/视频/语音、数据工程、DeepSeek、向量数据库 |
| 3 | 05 大模型推理 | 全看：推理基本概念、推理加速、架构调度加速、长序列推理、输出采样、大模型压缩、推理框架架构分析、DeepSeek 推理优化 | |
| 4 | 04 大模型训练 | 分布式并行基础、大模型并行进阶、大模型训练加速（到 M9 再看） | 后训练与强化学习、微调 SFT、验证评估 |
| 跳 | 01 AI 计算集群、02 通信与存储、03 集群容器与云原生 | 平台层，等有推理产出物后再回头 | |
| 跳 | 07 大模型应用 | 对 infra 路线没帮助 | |

注意：ZOMI 的 B 站空间里合集是按小主题拆的（比如「【大模型算法】Transformer架构」「【大模型推理】大模型推理框架」），没有叫「大模型系统概述」的合集，模块 00 的视频要在空间里按标题搜，或者直接读文档站的文字版。

可选：CMU 的 dlsyscourse（Deep Learning Systems），从自动微分到编译器自己写一遍框架，M5 之后有余力再看。

否掉的：李沐《动手学深度学习》全课、CS224N、慕课网上的所有「大模型」课。前两个讲的是研究者需要的部分，第三个查过全是应用层。

## W1 前置：只补这五条

W1 不需要深度学习基础，但不是零门槛。要的是「零件图」，不是「物理原理」。不用懂反向传播、梯度下降、attention 为什么有效，那些是研究者的知识，和性能优化无关。要懂的只有五条：

1. transformer 层结构骨架：embedding → N 层 ×（attention + FFN）→ output head
2. 每层的矩阵形状：Q/K/V 投影是 `hidden × hidden`，FFN 是 `hidden → 中间宽度 → hidden`
3. 参数量怎么数出来，就藏在上面那些矩阵里
4. prefill 和 decode 的区别：一次吃掉整个 prompt，对比一次只生成一个 token
5. KV cache 是什么、为什么能缓存

补这五条的材料：3Blue1Brown 的《But what is a GPT?》和 attention 那一集，bbycroft.net/llm 的 3D 可视化（能看到每个矩阵的尺寸，最对症），Illustrated GPT-2，李宏毅讲 self-attention 的两个视频。

**别去上深度学习课**。那些课讲的正好是我不需要的部分，几十个小时换不来这五条。等 M9 训练侧再按需补。

## 学习方法，也是这个系列的规则

这 365 天系列每天一篇，记录当天学到的所有东西，包括错题。规则写死：

**一次只推进一小块**。W1 第一天我就被「一次甩一张公式表」打回过：`4d²`、`11008`、KV cache 公式一起出现，我一个都看不懂。改成一次一小块、每块结尾问「哪句没跟上」之后才走通。以后自己学新东西也按这个粒度。

**每块结尾必须检验**。检验的形式是具体问题，不是「我觉得懂了」。一个矩阵有多少参数，说不出算式就是没懂。

**算不出数字就是没通过**。「建立直觉」听着虚，最容易变成收藏夹里躺着的文章。所以每周的产出是一组具体的数字，跟读了几篇文章无关。

**错题要记**。被打回的地方就是知识的断点，比学会的东西更值得记录。这个系列每篇文章都会有「常见误区」一节，写的全是我自己犯过的错。

**用已经懂的东西做锚点**。学新概念时先找到它和已学内容的连接点。比如 KV cache 的大小可以从「一个矩阵有多少格子」一路推出来，不需要新公式。

## 名词解释

| 术语 | 一句话解释 | 首次出现 |
| --- | --- | --- |
| AI Infra | AI 基础设施，让模型训得起、跑得快、跑得省的那一层，从 GPU 到推理框架 | Day 0 |
| 推理（inference） | 用训练好的模型生成结果的过程，和训练相对 | Day 0 |
| 分布式训练 | 用多张 GPU 甚至多台机器一起训一个模型 | Day 0 |
| roofline | 一张图，横轴是每字节数据配多少次计算，纵轴是能达到的算力，用来判断代码卡在算力还是卡在内存 | Day 0，详讲在 Day 5 |
| KV cache | 推理时缓存下来的 key 和 value 向量，避免每生成一个 token 都重算前文 | Day 0，详讲在 Day 4 |
| batching | 把多个请求合在一起算，让 GPU 一次搬权重服务多个 token | Day 0 |
| 量化（quantization） | 把权重从 16 位浮点压到 8 位或 4 位整数，减少显存和搬运量 | Day 0 |
| Triton | OpenAI 出的写 GPU kernel 的 Python 方言，比裸 CUDA 好学 | Day 0 |
| kernel | 在 GPU 上跑的一段程序，一个矩阵乘法就是一个 kernel | Day 0 |
| vLLM | 目前最主流的开源推理引擎，PagedAttention 的出处 | Day 0 |
| FSDP | Fully Sharded Data Parallel，PyTorch 的一种把参数切开分到多卡的训练方式 | Day 0 |
| NCCL | NVIDIA 的多卡通信库，训练时同步梯度靠它 | Day 0 |
| spot 实例 | 云厂商的闲置算力，便宜但随时可能被收回 | Day 0 |
| GPU MODE | 一个 GPU 编程社区，有讲座、Discord 和 kernel 排行榜 | Day 0 |

## 常见误区

**误区一：觉得「AI 相关」就够了，不区分应用层和 infra**。公司内部的 chatbot 项目、MCP server 都是调 API 的应用层代码，做一年也攒不出 infra 履历。方向选定后，这类经历对目标岗位的价值要按零算。

**误区二：拿前端红利期类比**。前端门槛低所以培训班能批量供货、红利快结束；AI Infra 门槛高所以溢价久但入场慢。「找工作像喝水一样简单」这一半类比是错的，「两年翻倍」这一半反而可能对。

**误区三：一开始就学分布式训练**。没有 8 张 H100 就什么都做不了，三个月后放弃。先推理。

**误区四：觉得需要先上一门深度学习课**。W1 只需要五条前置知识，几个小时够。深度学习课讲的反向传播、优化器、正则化是研究者的知识，和性能优化无关。

**误区五：资源越多越好**。锁死六样。收藏夹里的文章和实际算出来的数字之间没有任何关系。

## 参考资料

### 文章

- Horace He，《Making Deep Learning Go Brrrr From First Principles》，https://horace.io/brrr_intro.html
- HuggingFace，《The Ultra-Scale Playbook: Training LLMs on GPU Clusters》，按标题搜索
- Jay Alammar，《The Illustrated GPT-2》，按标题搜索
- bbycroft，LLM Visualization，https://bbycroft.net/llm
- ZOMI酱，《AIInfra》开源课文档，https://infrasys-ai.github.io/aiinfra-docs/
- Infrasys-AI/AIInfra 仓库，https://github.com/Infrasys-AI/AIInfra
- GPU MODE lectures 仓库，https://github.com/gpu-mode/lectures
- Triton 官方 tutorials，按「Triton tutorials」搜索
- vLLM 仓库，https://github.com/vllm-project/vllm

### 视频

- Andrej Karpathy，《Let's build GPT: from scratch, in code, spelled out》，YouTube，按标题搜索
- Stanford CS336 Language Modeling from Scratch（Spring 2025），YouTube playlist `PLoROMvodv4rOY23Y0BoGoBGgQ1zmU_MT_`
- ZOMI酱，B 站空间 https://space.bilibili.com/517221395
- 3Blue1Brown，《But what is a GPT? Visual intro to transformers》和《Attention in transformers, visually explained》，按标题搜索
- 李宏毅，《自注意力机制 Self-attention》上下两集，按标题搜索
- CMU Deep Learning Systems，https://dlsyscourse.org

### 书

- Hwu, Kirk, El Hajj，《Programming Massively Parallel Processors》第 4 版，读英文原版

## 自测

**1. 为什么要先攻推理，而不是先学分布式训练？说出至少两个理由。**

<details><summary>答案</summary>

一是资源门槛：分布式训练没有多张高端 GPU 什么实验都做不了，租金是推理实验的好几倍，最常见的结果是三个月后放弃。二是需求量：每家用模型的公司都要部署推理，只有少数公司训基座，推理岗位多一个数量级。三是可展示性：推理优化能产出「吞吐提升几倍、成本降多少」这种硬数字，训练侧的学习很难量化成简历上的一行。

</details>

**2. M4 止损点的判断标准是什么？为什么要现在写下来？**

<details><summary>答案</summary>

标准不是「学得好不好」，而是「做完产出物 01 的时候，是追着数字不肯睡，还是每次打开都靠意志力」。现在写下来是因为到了 M4，已经投入的四个月会变成沉没成本，让人倾向于硬撑。提前约定好判断标准，到时候才能用规则而不是情绪做决定。

</details>

**3. 我在现公司做 AI chatbot 项目一年，对 AI Infra 求职有多大帮助？**

<details><summary>答案</summary>

接近零。那些项目是 Vercel AI SDK 调 Anthropic 或 OpenAI 的 API，纯应用层，没有任何 GPU、tensor、并行相关的内容。这类经历只对「AI 应用工程」岗位有用，那不是我选的方向。

</details>

**4. 成本纪律里最重要的一条是什么？**

<details><summary>答案</summary>

跑完立刻销毁实例。月预算 30 到 60 美元的前提是不浪费机时，忘关一晚上的钱够一周实验。配套的规则是进实例前脚本必须调试完，不在按小时计费的机器上想逻辑。

</details>

**5. 三个出口的优先级排序是什么，为什么海外远程排第一？**

<details><summary>答案</summary>

海外远程、国内平台层、留现公司转应用。海外远程排第一是因为我已经在为美国公司做远程工作，英文和跨时区交付是现成的优势，而多数国内候选人卡死在跨国雇佣这一关；进入方式是社区可见度（GPU MODE、vLLM 的 PR），不是海投简历。

</details>

**6. W1 前置的五条知识是什么？为什么不去上一门深度学习课？**

<details><summary>答案</summary>

层结构骨架、每层矩阵形状、参数量怎么数、prefill 和 decode 的区别、KV cache 是什么。不上深度学习课是因为那些课讲的反向传播、梯度下降、attention 为什么有效是研究者的知识，几十个小时换不来这五条零件图级别的东西。

</details>

## 明天预告

Day 1 读 Horace He 的《Making Deep Learning Go Brrrr》。这篇文章给了整条路线的判断框架：任何一段深度学习代码慢，只有三种可能，compute-bound、memory-bandwidth-bound、overhead-bound。三种瓶颈各有各的判定方法和典型症状，治法完全不同。读完要能回答一个问题：为什么增大 batch size 有时几乎不增加延迟。
