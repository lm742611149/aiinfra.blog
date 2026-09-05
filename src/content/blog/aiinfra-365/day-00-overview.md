---
title: 'Day 0 · 这条路为什么是 AI Infra，以及 12 个月怎么走'
description: '开工前把三件事写死：为什么选 AI Infra 而不是 AI 应用层，为什么先攻推理不碰分布式训练，以及 12 个月每一段要交出什么东西。这一篇是整个 365 天系列的地图，也是三个月后动摇时要回来读的那一篇。'
pubDate: 2026-08-29
regime: none
tags: ['roadmap', 'aiinfra-365']
series: 'aiinfra-365'
day: 0
lang: 'zh'
---

## 今天要解决的问题

三个月后我一定会怀疑自己：这条路是不是选错了，是不是该回去做熟悉的东西。所以在写第一行代码、算第一个数字之前，先把「为什么走这条路」和「走到哪一步算走通」写下来，以后动摇的时候回来读这一篇，而不是凭当时的情绪重新做决定。

这篇没有任何技术内容，全部是选择和规则。写完要能回答四个问题：

1. 为什么是 AI Infra，不是更容易上手的 AI 应用层。
2. 为什么先攻推理，把分布式训练放到第九个月。
3. 12 个月每一段交什么，每个月的钱花在哪。
4. 什么时候止损，止损了往哪走。

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

### 什么算 infra，什么不算

「AI 相关」这个词太宽，容易自欺。我给自己画了一条线，以后判断一件事值不值得花时间就对这张表：

| 这件事 | 算不算 infra | 为什么 |
| --- | --- | --- |
| 用 vLLM 部署一个 7B 模型，把吞吐从 200 tok/s 调到 800 tok/s | 算 | 改的是推理引擎的参数、batch 策略、显存分配，产出是硬数字 |
| 写一个 Triton kernel 替换 PyTorch 的 layernorm，快 1.8 倍 | 算 | 碰到了 GPU 内存层次和 kernel 本身 |
| 给公司 chatbot 加一个 RAG 检索步骤 | 不算 | 调 API、拼 prompt，模型对你是黑盒 |
| 写一个 MCP server 让模型能查数据库 | 不算 | 同上，应用层胶水 |
| 用 LangChain 做一个 agent 工作流 | 不算 | 同上 |
| 把训练任务从单卡改成 4 卡 FSDP，测出通信占比 | 算 | 并行策略、NCCL、显存分片 |
| 微调一个模型让它说话像客服 | 边缘 | 数据和训练配方为主，只有「怎么让它训得快」那部分算 |
| 部署一套 K8s 上的 GPU 调度 | 算，平台层 | 国内平台类岗位的主要内容，但离模型本身远 |

判据只有一句话：**你改动的东西，是不是决定了模型「跑多快、占多少显存、花多少钱」**。是就算，不是就不算，哪怕它带着 AI 两个字。

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

把钱算一遍就更清楚了。2026 年 9 月查到的云 GPU 大致小时价（RunPod 和 Vast 的 spot 或社区价，会浮动，只看量级）：

| 实验 | 需要的卡 | 小时价量级 | 一次实验（3 小时） | 一个月做 8 次 |
| --- | --- | --- | --- | --- |
| 推理：7B 模型 batch 扫参 | 1 × A100 40/80GB | 1 到 2 美元 | 3 到 6 美元 | 24 到 48 美元 |
| 推理：1B 模型 profiler | Colab 免费 T4 | 0 | 0 | 0 |
| 训练：小模型 FSDP 两卡 | 2 × A100 | 2 到 4 美元 | 6 到 12 美元 | 48 到 96 美元 |
| 训练：真正的 8 卡实验 | 8 × H100 | 20 到 30 美元 | 60 到 90 美元 | 480 到 720 美元 |

推理实验一个月几十美元，8 卡训练实验一个月几百美元，差一个数量级。而且推理实验的每一步都能落成一个数字。训练侧放到 M9 到 M10 再碰，那时候手里已经有推理产出物，租多卡的钱花得值，也知道该测什么。

## 12 个月路线

按业余每周 10 到 15 小时安排。前两个月不产出项目，只建判断力。这两个月省掉的话，后面所有优化都是瞎调。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="12 个月路线时间线：M1 到 M2 建判断力，M3 到 M4 推理报告，M5 到 M6 kernel，M7 到 M8 推理引擎，M9 到 M10 训练侧，M11 到 M12 投递；四个产出物和一个止损点标在线上">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">12 个月 · 四个产出物 · 一个止损点</text>
<rect x="20" y="60" width="100" height="34" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="70" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">M1–M2</text>
<rect x="120" y="60" width="100" height="34" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="170" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">M3–M4</text>
<rect x="220" y="60" width="100" height="34" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="270" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">M5–M6</text>
<rect x="320" y="60" width="100" height="34" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="370" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">M7–M8</text>
<rect x="420" y="60" width="100" height="34" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="470" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">M9–M10</text>
<rect x="520" y="60" width="100" height="34" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="570" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">M11–M12</text>
<text x="70" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">建判断力</text>
<text x="70" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">roofline · profiler</text>
<text x="170" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">读 vLLM · 做实验</text>
<text x="170" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">推理优化报告</text>
<text x="270" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">Triton kernel</text>
<text x="270" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">三方对比</text>
<text x="370" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">最小推理引擎</text>
<text x="370" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">简历核爆点</text>
<text x="470" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">DDP · FSDP</text>
<text x="470" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">故障恢复</text>
<text x="570" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">作品集 · 面试</text>
<text x="570" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">投</text>
<line x1="20" y1="170" x2="620" y2="170" stroke="var(--rule)" stroke-width="1.5"/>
<circle cx="220" cy="170" r="6" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="2"/>
<text x="220" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">产出物 01</text>
<text x="220" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">⚑ 止损点</text>
<circle cx="320" cy="170" r="6" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="2"/>
<text x="320" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">产出物 02</text>
<circle cx="420" cy="170" r="6" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="2"/>
<text x="420" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">产出物 03</text>
<circle cx="520" cy="170" r="6" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="2"/>
<text x="520" y="196" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">产出物 04</text>
<line x1="270" y1="150" x2="270" y2="164" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="3 3"/>
<text x="270" y="236" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">M5–M6 开始试水面试、提第一个开源 PR，不等到 M12</text>
<text x="20" y="46" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">■ 推理侧（单卡起步）</text>
<text x="160" y="46" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">■ 写 kernel / 写引擎 / 训练侧（开始花多卡钱）</text>
</svg>
<figcaption>整条路线一眼看完。前四个月一行 kernel 都不写，只建判断力和做实验；产出物 01 做完就是止损点，过了这个点才开始烧更多的钱。</figcaption>
</figure>

| 阶段 | 时间 | 目标 | 产出物 |
| --- | --- | --- | --- |
| M1–M2 | W1–W8 | 建判断力：算力和内存花在哪，roofline，KV cache，batching，量化 | 第一篇公开技术帖 |
| M3–M4 | W9–W16 | 读 vLLM 源码，做推理优化实验 | 产出物 01：推理优化报告 |
| M5–M6 | W17–W24 | Triton 写 kernel | 产出物 02：一个 kernel 加三方对比 |
| M7–M8 | W25–W32 | 从零写最小推理引擎 | 产出物 03：开源引擎加实现笔记 |
| M9–M10 | W33–W40 | 训练侧：DDP、FSDP、NCCL、故障恢复 | 产出物 04：训练侧文章 |
| M11–M12 | W41–W48 | 作品集统一格式、简历重写、面试、投 | offer 或校准后的下一轮计划 |

### 四个产出物的验收标准

「我学过什么」不值钱，「我把什么指标改善了多少」才值钱。每个产出物的验收标准就是能不能把下面那行空填满。现在填不了，但先把格式定下来，以后做的每个实验都知道自己是在往哪个空里填数。

| 产出物 | 内容 | 必须填满的数字 |
| --- | --- | --- |
| 01 单卡推理优化报告（M3–M4） | 拿一个开源模型，量化 + batching 策略 + KV cache 调优，附 roofline 分析解释瓶颈 | 吞吐 ×__ · P99 延迟 ↓__ · 显存 ↓__ · 每百万 token 成本 ↓__ |
| 02 Triton fused kernel（M5–M6） | 手写 fused layernorm 或 attention，和 PyTorch eager、torch.compile 三方对比 | 相对 PyTorch ×__ · 带宽利用率 __% · kernel 发射次数 ↓__ |
| 03 最小推理引擎（M7–M8） | 从零实现 continuous batching + paged KV cache，逐 token 和 transformers 对比正确性 | 对比 vLLM 达到 __% 吞吐 · 支持 __ 并发 · 代码 __ 行 |
| 04 训练故障恢复（M9–M10） | FSDP 多卡跑训练，故意杀掉一个 rank 并恢复 | 恢复耗时 __ s · checkpoint 开销 __% · 最大并行 __ 卡 |

每一个空后面都得有一行「怎么测的」：warmup 几次、synchronize 在哪、负载分布是什么。这是面试必考题「你这个数字怎么保证可信」的答案，M11 再补就晚了。

### M1 每周任务

M1 的每一周都拆到了天，每天对应这个系列的一篇文章。第四列是文章编号，路线和日志一一对应，以后复习哪一周直接跳。

| 周 | 任务 | 产出 | 对应文章 |
| --- | --- | --- | --- |
| W1 | 读 Horace He《Making Deep Learning Go Brrrr》，手算一个 transformer 的 FLOPs 和显存占用 | 能回答「7B 模型推理时显存到底花在哪」 | Day 1–6：三种瓶颈 → 零件与参数量 → attention 与自回归 → FLOPs 与 KV cache → 显存四项与 roofline → W1 复习 |
| W2 | Colab 上跑通小模型推理，用 `torch.profiler` 抓 trace 并看懂 timeline | 能指出哪个 op 最耗时、为什么 | Day 7–12：跑通 TinyLlama → CUDA 异步与计时 → TTFT/TPOT 对账 → profiler 与 Perfetto → timeline 上的 gap → W2 复习 |
| W3 | 算出所租 GPU 的峰值算力和显存带宽，判断 workload 落在 roofline 哪一侧 | 自己画的 roofline 图加实测点 | Day 13–18：实测带宽 → 实测算力 → 画自己的 roofline → batch 扫描 → 标称 vs 实测 → W3 复习 |
| W4 | 环境工程化：RunPod/Vast 开机脚本、SSH、持久化存储、成本监控 | 一条命令起环境，跑完自动销毁 | Day 19–24：第一次租 GPU → 持久化 → bootstrap 脚本 → 三层自动销毁 → 成本看板 → W4 复习 |
| 加餐周 | 补硬件与数值地基：GPU 解剖、数值格式、CUDA 执行模型、读规格表、市场校准 | 能读懂一张 GPU 规格表，能解释 T4 为什么不支持 bf16 | Day 25–30：GPU 解剖 → 数值格式 → CUDA 执行模型 → 读规格表 → 2026-09 市场校准 → M1 总复习 |

加餐周不在原路线图里，是写到 W2 时发现的：profiler 里的 kernel 名、T4 上 bf16 报错、规格表上 312 和 624 两个算力数，这些东西 W1 到 W4 都会撞到但没地方系统讲，与其每次撞到查一下，不如集中补一周。M1 按 30 天算正好放得下。

### M2 每周任务

| 周 | 任务 | 产出 |
| --- | --- | --- |
| W5 | KV cache 从原理到实测：关掉和开启对比延迟和显存 | 数据加解释为什么差这么多 |
| W5+ | 补两条架构知识：GQA 怎么改 KV cache 公式，MoE 的「激活参数」为什么远小于总参数 | 能重算 Llama-3 和 MoE 模型的显存 |
| W6 | 静态 batching 的问题、continuous batching 解决什么，读 vLLM 的 scheduler | 自己画的请求时序图 |
| W7 | 量化初步：跑 GPTQ 或 AWQ 版本，测精度、速度、显存三角 | 对比表 |
| W7+ | 读 vLLM 的 speculative decoding 实现，讲清为什么它能加速 memory-bound 的 decode | 一页解释，不用实测 |
| W8 | 整合前 7 周的东西，写成第一篇公开技术帖 | 发出去的文章，不是草稿 |

带加号的两行是 2026 年 9 月对照招聘 JD 之后补进去的，Day 29 会专门讲为什么。M3 之后的每周任务在路线图里也拆好了，到时候再抄过来，现在写出来只会让我分心。

## 成本纪律

这条路的钱花在 GPU 租金上，纪律比预算重要。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="各阶段月预算示意柱状图：M1 接近零，M2 到 M8 每月 30 到 60 美元，M9 到 M10 多卡实验上限约 100 美元，M11 到 M12 接近零">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">每月 GPU 预算（美元，规划值不是账单）</text>
<line x1="60" y1="200" x2="620" y2="200" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="60" y1="200" x2="60" y2="40" stroke="var(--rule)" stroke-width="1.5"/>
<text x="52" y="204" text-anchor="end" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">0</text>
<line x1="56" y1="140" x2="620" y2="140" stroke="var(--rule-soft)" stroke-width="1"/>
<text x="52" y="144" text-anchor="end" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">60</text>
<line x1="56" y1="100" x2="620" y2="100" stroke="var(--rule-soft)" stroke-width="1"/>
<text x="52" y="104" text-anchor="end" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">100</text>
<rect x="80" y="185" width="70" height="15" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="115" y="220" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">M1</text>
<text x="115" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">0–20</text>
<rect x="170" y="140" width="70" height="60" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="205" y="220" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">M2–M4</text>
<text x="205" y="131" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">30–60</text>
<rect x="260" y="140" width="70" height="60" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="295" y="220" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">M5–M6</text>
<text x="295" y="131" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">30–60</text>
<rect x="350" y="140" width="70" height="60" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="385" y="220" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">M7–M8</text>
<text x="385" y="131" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">30–60</text>
<rect x="440" y="100" width="70" height="100" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="475" y="220" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">M9–M10</text>
<text x="475" y="91" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">60–100</text>
<rect x="530" y="190" width="70" height="10" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="565" y="220" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">M11–M12</text>
<text x="565" y="181" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">≈ 10</text>
<text x="340" y="248" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">全年合计 300 到 500 美元。忘关一晚上 A100（约 15 美元）= 一周的实验预算。</text>
</svg>
<figcaption>预算按阶段画出来。M1 几乎不花钱，多卡的 M9 到 M10 上限也就一百美元。这条路的钱不是花不起，是怕忘关机。</figcaption>
</figure>

- **W1 零成本**。纸、笔、免费 Colab。第一周的产出是一组数字，不需要任何付费资源。
- **Colab 免费版起步**，够跑小模型推理和 profiler。W2 和 W3 全部在上面做。
- **付费从 RunPod 或 Vast 的 spot 实例开始**，按小时计费，目标月支出 30 到 60 美元。按 A100 每小时 1 到 2 美元算，一个月 30 到 60 美元是 15 到 60 个 GPU 小时，一周 4 到 15 小时。业余每周 10 到 15 小时学习时间里真正需要开着 GPU 的只有跑实验那一段，够用。
- **跑完立刻销毁实例**。忘记关机一晚上的钱够买一周的实验。进实例之前脚本必须调试完，不在按小时计费的机器上想逻辑。W4 整周都在做这件事：一条命令起环境，跑完自己消失。
- **2018 年的 Intel MacBook Pro 只当终端**。Intel Mac 没有 MPS，本地跑不了任何 GPU 相关的东西，也别试。它的工作是写代码、SSH、看图表。

## M4 止损点

M4 结束、产出物 01 做完的时候，问自己一个问题：这两个月是追着数字不肯睡，还是每次打开都靠意志力？

如果是后者，止损。四个月加两百美元，是很便宜的试错。这一条现在写下来，是为了到时候不要因为「已经投入了四个月」而硬撑。沉没成本不是继续的理由。

为了到时候不能耍赖，把判断标准写成可以打勾的清单，M4 最后一周对着填：

| 问题 | 继续的信号 | 止损的信号 |
| --- | --- | --- |
| 产出物 01 做完了吗 | 做完了，数字填满了 | 拖了超过四周还没收口 |
| 过去八周里有几周实际学习时间达到 10 小时 | 6 周以上 | 3 周以下 |
| 遇到一个测不出来的数字时的反应 | 想弄明白，会主动多开一次实例 | 想绕过去，或者放着不管 |
| 读 vLLM 源码时的感受 | 越读越想读 | 每次打开都要先做心理准备 |
| 有没有主动跟外面的人聊过（Discord、issue、评论） | 有 | 没有，觉得自己还不够格 |

三条以上落在右边就止损。落在中间不算左边。

## 三个出口

不等到 M12 才想出口，现在就排好序。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="三个出口按优先级排列：海外远程最优先，国内平台层其次，留现公司转应用保底；通向前两个出口的路是产出物和社区可见度">
<rect x="20" y="110" width="150" height="80" rx="6" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="1.5"/>
<text x="95" y="138" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">四个产出物</text>
<text x="95" y="156" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">+ GPU MODE / vLLM</text>
<text x="95" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">社区里的可见度</text>
<line x1="170" y1="130" x2="270" y2="60" stroke="var(--mem)" stroke-width="2"/>
<polygon points="272,58 262,62 267,68" fill="var(--mem)"/>
<line x1="170" y1="150" x2="270" y2="150" stroke="var(--mem)" stroke-width="2"/>
<polygon points="272,150 262,144 262,156" fill="var(--mem)"/>
<line x1="170" y1="170" x2="270" y2="240" stroke="var(--rule)" stroke-width="2" stroke-dasharray="6 4"/>
<polygon points="272,242 262,238 267,232" fill="var(--rule)"/>
<rect x="272" y="26" width="348" height="68" rx="6" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2"/>
<text x="284" y="48" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">① 海外远程 · 最优先，岗位最少</text>
<text x="284" y="66" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">存量优势：已在为美国公司远程工作，英文 + 跨时区交付</text>
<text x="284" y="82" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">难点在地域限制（多数限美加）不在技术；contractor 拿 40–70% band</text>
<rect x="272" y="116" width="348" height="68" rx="6" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="284" y="138" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">② 国内 AI Infra · 平台层入口</text>
<text x="284" y="156" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">GPU 调度、推理服务部署；按 AI 年限定级，首份大概率降级</text>
<text x="284" y="172" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">北京参照：3–5 年 60–100 万，5–8 年 100–180 万</text>
<rect x="272" y="206" width="348" height="68" rx="6" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="284" y="228" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">③ 留现公司转 AI 应用 · 保底</text>
<text x="284" y="246" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">随时可以，不需要产出物</text>
<text x="284" y="262" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">infra 履历价值 ≈ 0，只是兜底</text>
<text x="95" y="222" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">实线 = 要靠产出物</text>
<text x="95" y="238" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">虚线 = 不需要</text>
</svg>
<figcaption>三个出口和通向它们的路。前两个都要靠产出物和社区可见度，第三个不需要任何东西，所以它只是兜底，不是目标。</figcaption>
</figure>

**出口一，海外远程，最优先**。我已经在为一家美国公司做远程工作，英文沟通和跨时区交付是存量优势，多数国内候选人卡死在跨国雇佣这一关。进入方式不是投简历，是 GPU MODE 和 vLLM 社区里的可见度：认真提交过 kernel、被 maintainer review 过的 PR、公开的排行榜成绩。薪资参照：海外 CUDA 和推理优化岗 TC 在 30 万到 50 万美元以上，远程按全美 band 比旧金山低 10 到 15%，但中国境内 contractor 或 EOR 通常只拿美国 band 的 40 到 70%。

这条要提前泼一次冷水：它优先级最高，但岗位最少，而且多数远程岗限美国和加拿大境内。「远程也不难」这个想法我冒出来过，被打回去了：不难的是技术门槛之外的那部分，难的正是地域限制和岗位数量。别拿某家公司 JD 写得松就觉得好进。

**出口二，国内 AI Infra，走平台层入口**。GPU 调度、推理服务部署这类岗位。按 AI 年限定级，第一份大概率降级。北京参照：3 到 5 年 60 到 100 万，5 到 8 年 100 到 180 万。2026 年 9 月对照招聘市场的细节在 Day 29，那一篇会把 JD 里的高频要求列出来，逐条对回路线图。

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

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kCc8FmEb1nY" title="Let's build GPT: from scratch, in code, spelled out." loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · Let's build GPT: from scratch, in code, spelled out. 两小时，从字符级 bigram 一直写到一个能训练的小 GPT。W1 前置的五条知识里，「层结构骨架」和「每层矩阵形状」在这个视频里能亲眼看见变量的 shape。不需要跟着敲完，看懂每个矩阵是什么形状就够。</figcaption>
</figure>

**Stanford CS336 2025**（Language Modeling from Scratch），YouTube playlist ID `PLoROMvodv4rOY23Y0BoGoBGgQ1zmU_MT_`。19 讲，和 M1 到 M10 几乎一一对应。先看第 1 到 3、5 到 8、10 讲。课程主页 https://stanford-cs336.github.io/spring2025/ 上有每讲的讲义和作业。

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

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/wjZofJX0v4M" title="Transformers, the tech behind LLMs | Deep Learning Chapter 5" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · Transformers, the tech behind LLMs（Deep Learning Chapter 5）。27 分钟，前置五条里的第一、二、三条都在里面：数据怎么一层层流过去、每个矩阵多大、GPT-3 的 1750 亿参数是怎么加出来的。看完直接去 bbycroft.net/llm 把同样的东西转着看一遍。</figcaption>
</figure>

每一条对应到 W1 的哪一天，以及「懂了」的检验标准：

| 前置 | 检验标准 | W1 哪天用到 |
| --- | --- | --- |
| 层结构骨架 | 能默画：输入 token → embedding → 32 层 → 输出头，每层里有 attention 和 FFN 两块 | Day 2 |
| 矩阵形状 | 能说出「矩阵形状 = 输入长度 × 输出长度」，并写出 W^q 是 4096 × 4096 | Day 2、Day 3 |
| 参数量 | 能从形状算出一层多少参数，乘层数加两头对账到 6.74B | Day 2 |
| prefill vs decode | 能说出一个是一次处理整段 prompt、一个是每次生成一个 token，以及为什么后者更慢 | Day 4、Day 5 |
| KV cache | 能说出缓存的是每个 token 的 k 和 v，为什么 q 不用缓存 | Day 4 |

**别去上深度学习课**。那些课讲的正好是我不需要的部分，几十个小时换不来这五条。等 M9 训练侧再按需补。

## 学习方法，也是这个系列的规则

这 365 天系列每天一篇，记录当天学到的所有东西，包括错题。规则写死：

**一次只推进一小块**。W1 第一天我就被「一次甩一张公式表」打回过：`4d²`、`11008`、KV cache 公式一起出现，我一个都看不懂。改成一次一小块、每块结尾问「哪句没跟上」之后才走通。以后自己学新东西也按这个粒度。

**每块结尾必须检验**。检验的形式是具体问题，不是「我觉得懂了」。一个矩阵有多少参数，说不出算式就是没懂。

**算不出数字就是没通过**。「建立直觉」听着虚，最容易变成收藏夹里躺着的文章。所以每周的产出是一组具体的数字，跟读了几篇文章无关。

**错题要记**。被打回的地方就是知识的断点，比学会的东西更值得记录。这个系列每篇文章都会有「常见误区」一节，写的全是我自己犯过的错。

**用已经懂的东西做锚点**。学新概念时先找到它和已学内容的连接点。比如 KV cache 的大小可以从「一个矩阵有多少格子」一路推出来，不需要新公式。

### 一天 1.5 到 2 小时怎么分

业余时间学，每天能挤出来的是 1.5 到 2 小时。按这个粒度分：

| 时段 | 做什么 | 为什么 |
| --- | --- | --- |
| 前 10 分钟 | 合上笔记，答昨天那篇的自测题 | 忘了的当天补，不往后拖 |
| 中间 60 到 80 分钟 | 当天的正课：读、算、跑 | 一次一小块，每块结尾复述 |
| 最后 20 到 30 分钟 | 写日志：今天算出的数、卡住的地方、明天从哪开始 | 写不出来就是没学会 |

日志就是这个系列的每一篇。写的时候不追求好看，追求三个月后的自己能照着重算一遍。

### 每篇日志的固定结构

每篇都是同一个骨架，方便复习时跳着找：今天要解决的问题 → 正文 → 名词解释 → 常见误区 → 参考资料 → 自测（答案折叠，先自己写再展开）→ 明天预告。复习日（每周最后一篇）多一节错题本。

## 这条路最可能怎么失败

选方向的时候只想成功的样子没用，把失败的方式先列出来，每一条配一个现在就能做的对策，比事后总结便宜。这是我能想到的五种：

| 失败方式 | 它长什么样 | 对策 | 落在哪一天 |
| --- | --- | --- | --- |
| 没有 GPU 卡死 | 「等我买了卡再开始」，或者一上来就想租 8 卡 | W1 到 W3 全部零成本：纸笔加 Colab 免费 T4；付费从 W4 的 10 到 20 美元开始 | Day 1–18 |
| 只读不算 | 收藏了三十篇文章，一个数字没算出来，觉得自己「有感觉了」 | 每周的验收是五道题，合上笔记做，答不出数字就是没过 | 每周最后一天 |
| 信息过载 | 今天看 vLLM，明天看 TensorRT-LLM，后天看 SGLang，每个都开了头 | 资源锁死六样；新东西先记到「以后」清单，不打开 | Day 0 |
| 预算失控 | 跑完实验去睡觉，第二天早上账单是平时十倍 | W4 三层自动销毁，成本看板每次实验一行 | Day 22–23 |
| 方向摇摆 | 三个月后觉得应用层更好找工作，回头做 RAG | 这一篇。摇摆的时候先重读「为什么是 AI Infra」和止损清单，按规则不按情绪 | Day 0，M4 |

五条里最危险的是第二条和第五条，因为它们不会报错。没有 GPU 会立刻卡住，预算失控会收到账单，信息过载自己能感觉到，但「只读不算」和「方向摇摆」发生的时候人是舒服的，觉得自己在进步。所以这个系列的每一篇都带自测题，每周最后一天做验收，就是给这两条装的报警器。

## 每周 10 到 15 小时从哪来

业余学，时间是最硬的约束。按工作日和周末分：

| 时段 | 时间 | 做什么 | 要不要开 GPU |
| --- | --- | --- | --- |
| 工作日 × 5 | 每天 1.5 到 2 小时，共 7.5 到 10 小时 | 读、算、写日志；W2 起在 Colab 上跑小实验 | Colab 免费的开，付费的不开 |
| 周末 | 3 到 5 小时，一次连着做 | 需要付费 GPU 的实验集中在这一段：脚本工作日调好，周末进实例只跑 | 开，跑完立刻销毁 |
| 合计 | 10.5 到 15 小时 | | 付费 GPU 时间控制在每周 4 到 15 小时以内 |

把付费实验集中到周末有两个原因。一是脚本在工作日的 Colab 上就能调通，进付费实例之前不该再改逻辑；二是连续几小时比切碎的几个半小时更不容易忘关机，实验做完人还在电脑前。

## 开工前的准备清单

W1 不需要任何付费资源，但有几件零成本的事现在做完，后面每一周都省事：

1. Google 账号开好 Colab，随手跑一个 `!nvidia-smi` 确认能分到 GPU。W2 第一天要用。
2. HuggingFace 账号注册，生成一个 read 权限的 token。W2 下载模型要它，Llama 系列还要在模型页点一次同意。
3. GitHub 上建一个仓库放实验代码和日志。所有代码进 git，W4 讲持久化时会说为什么这一条不能省。
4. 一张成本记录表，哪怕现在只有表头：日期、实验、卡型、小时价、时长、花费、一句话结论。W1 到 W3 全是零，但表头先立着。
5. 把这个系列的骨架抄一份当模板：今天要解决的问题、正文、名词解释、常见误区、参考资料、自测、明天预告。每天写日志时往里填。
6. 加入 GPU MODE 的 Discord，先不说话，看别人在讨论什么。出口一说的社区可见度从潜水开始。

这六件事加起来不到一小时。

## 名词解释

| 术语 | 一句话解释 | 首次出现 |
| --- | --- | --- |
| AI Infra | AI 基础设施，让模型训得起、跑得快、跑得省的那一层，从 GPU 到推理框架 | Day 0 |
| 推理（inference） | 用训练好的模型生成结果的过程，和训练相对 | Day 0 |
| 分布式训练 | 用多张 GPU 甚至多台机器一起训一个模型 | Day 0 |
| roofline | 一张图，横轴是每字节数据配多少次计算，纵轴是能达到的算力，用来判断代码卡在算力还是卡在内存 | Day 0，详讲在 Day 5 |
| KV cache | 推理时缓存下来的 key 和 value 向量，避免每生成一个 token 都重算前文 | Day 0，详讲在 Day 4 |
| batching | 把多个请求合在一起算，让 GPU 一次搬权重服务多个 token | Day 0 |
| continuous batching | 请求随到随进、算完随出的 batching 方式，vLLM 吞吐高的主要原因之一 | Day 0，详讲在 W6 |
| 量化（quantization） | 把权重从 16 位浮点压到 8 位或 4 位整数，减少显存和搬运量 | Day 0 |
| Triton | OpenAI 出的写 GPU kernel 的 Python 方言，比裸 CUDA 好学 | Day 0 |
| kernel | 在 GPU 上跑的一段程序，一个矩阵乘法就是一个 kernel | Day 0 |
| vLLM | 目前最主流的开源推理引擎，PagedAttention 的出处 | Day 0 |
| PagedAttention | vLLM 管理 KV cache 的方式，像操作系统分页那样按块分配，减少显存碎片 | Day 0，详讲在 M3 |
| FSDP | Fully Sharded Data Parallel，PyTorch 的一种把参数切开分到多卡的训练方式 | Day 0 |
| NCCL | NVIDIA 的多卡通信库，训练时同步梯度靠它 | Day 0 |
| spot 实例 | 云厂商的闲置算力，便宜但随时可能被收回 | Day 0 |
| GPU MODE | 一个 GPU 编程社区，有讲座、Discord 和 kernel 排行榜 | Day 0 |
| TC | total compensation，海外岗位的年总包，含基本工资、股票和奖金 | Day 0 |
| EOR / contractor | 海外公司雇中国境内员工的两种方式：通过雇主代理，或按合同工；薪资通常按美国 band 打折 | Day 0 |
| MPS | Apple 芯片上 PyTorch 的 GPU 加速后端，Intel Mac 没有 | Day 0 |

## 常见误区

**误区一：觉得「AI 相关」就够了，不区分应用层和 infra**。公司内部的 chatbot 项目、MCP server 都是调 API 的应用层代码，做一年也攒不出 infra 履历。方向选定后，这类经历对目标岗位的价值要按零算。判据在上面那张表里：改的东西决定不了模型跑多快占多少显存，就不算。

**误区二：拿前端红利期类比**。前端门槛低所以培训班能批量供货、红利快结束；AI Infra 门槛高所以溢价久但入场慢。「找工作像喝水一样简单」这一半类比是错的，「两年翻倍」这一半反而可能对。

**误区三：一开始就学分布式训练**。没有 8 张 H100 就什么都做不了，三个月后放弃。先推理。上面那张成本表：推理实验一个月几十美元，8 卡训练实验几百美元。

**误区四：觉得需要先上一门深度学习课**。W1 只需要五条前置知识，几个小时够。深度学习课讲的反向传播、优化器、正则化是研究者的知识，和性能优化无关。

**误区五：资源越多越好**。锁死六样。收藏夹里的文章和实际算出来的数字之间没有任何关系。

**误区六：把「海外远程优先」读成「海外远程不难」**。它是优先级最高的出口，同时也是岗位最少、地域限制最严的出口。难点不在技术，在雇佣。

**误区七：以为预算失控是因为实验做多了**。不是。这条路上预算失控只有一个原因：忘了关机。所以 W4 整周不写 GPU 代码，只做自动销毁。

## 参考资料

### 文章

- Horace He，《Making Deep Learning Go Brrrr From First Principles》，https://horace.io/brrr_intro.html
- HuggingFace，《The Ultra-Scale Playbook: Training LLMs on GPU Clusters》，https://huggingface.co/spaces/nanotron/ultrascale-playbook
- Jay Alammar，《The Illustrated GPT-2》，https://jalammar.github.io/illustrated-gpt2/
- bbycroft，LLM Visualization，https://bbycroft.net/llm
- ZOMI酱，《AIInfra》开源课文档，https://infrasys-ai.github.io/aiinfra-docs/
- Infrasys-AI/AIInfra 仓库，https://github.com/Infrasys-AI/AIInfra
- GPU MODE lectures 仓库，https://github.com/gpu-mode/lectures
- Triton 官方 tutorials，https://triton-lang.org/main/getting-started/tutorials/index.html
- vLLM 仓库，https://github.com/vllm-project/vllm
- RunPod 价格页 https://www.runpod.io/pricing 和 Vast 价格页 https://vast.ai/pricing ，成本表里的小时价量级从这两页查的，会变，用之前再看一眼。

### 视频

- Andrej Karpathy，Neural Networks: Zero to Hero 系列索引，https://karpathy.ai/zero-to-hero.html ，《Let's build GPT》已嵌在上面。
- Stanford CS336 Language Modeling from Scratch（Spring 2025），课程主页 https://stanford-cs336.github.io/spring2025/ ，YouTube playlist https://www.youtube.com/playlist?list=PLoROMvodv4rOY23Y0BoGoBGgQ1zmU_MT_
- ZOMI酱，B 站空间 https://space.bilibili.com/517221395
- 3Blue1Brown，神经网络系列页 https://www.3blue1brown.com/topics/neural-networks ，第 5 集已嵌在上面，第 6 集《Attention in transformers, visually explained》Day 3 会用。
- 李宏毅，《自注意力机制 Self-attention》上下两集，按标题搜索。
- GPU MODE 的 YouTube 频道 https://www.youtube.com/@GPUMODE 和 Discord https://discord.gg/gpumode ，出口一说的「社区可见度」就在这两个地方。
- CMU Deep Learning Systems，https://dlsyscourse.org

### 书

- Hwu, Kirk, El Hajj，《Programming Massively Parallel Processors》第 4 版，读英文原版

## 自测

**1. 为什么要先攻推理，而不是先学分布式训练？说出至少两个理由。**

<details><summary>答案</summary>

一是资源门槛：分布式训练没有多张高端 GPU 什么实验都做不了，租金是推理实验的好几倍（一个月几百美元对几十美元），最常见的结果是三个月后放弃。二是需求量：每家用模型的公司都要部署推理，只有少数公司训基座，推理岗位多一个数量级。三是可展示性：推理优化能产出「吞吐提升几倍、成本降多少」这种硬数字，训练侧的学习很难量化成简历上的一行。

</details>

**2. M4 止损点的判断标准是什么？为什么要现在写下来？**

<details><summary>答案</summary>

标准不是「学得好不好」，而是「做完产出物 01 的时候，是追着数字不肯睡，还是每次打开都靠意志力」，具体化成五个可以打勾的问题，三条以上落在止损一边就停。现在写下来是因为到了 M4，已经投入的四个月会变成沉没成本，让人倾向于硬撑。提前约定好判断标准，到时候才能用规则而不是情绪做决定。

</details>

**3. 我在现公司做 AI chatbot 项目一年，对 AI Infra 求职有多大帮助？**

<details><summary>答案</summary>

接近零。那些项目是 Vercel AI SDK 调 Anthropic 或 OpenAI 的 API，纯应用层，没有任何 GPU、tensor、并行相关的内容。判据是：你改的东西决定不了模型跑多快、占多少显存、花多少钱。这类经历只对「AI 应用工程」岗位有用，那不是我选的方向。

</details>

**4. 成本纪律里最重要的一条是什么？月预算 30 到 60 美元大概是多少 GPU 小时？**

<details><summary>答案</summary>

跑完立刻销毁实例。月预算 30 到 60 美元的前提是不浪费机时，忘关一晚上的钱够一周实验。按 A100 每小时 1 到 2 美元算，是 15 到 60 个 GPU 小时，一周 4 到 15 小时，够跑实验用。配套的规则是进实例前脚本必须调试完，不在按小时计费的机器上想逻辑。

</details>

**5. 三个出口的优先级排序是什么，为什么海外远程排第一？它最大的难点在哪？**

<details><summary>答案</summary>

海外远程、国内平台层、留现公司转应用。海外远程排第一是因为我已经在为美国公司做远程工作，英文和跨时区交付是现成的优势，而多数国内候选人卡死在跨国雇佣这一关；进入方式是社区可见度（GPU MODE、vLLM 的 PR），不是海投简历。最大的难点不在技术，在地域限制和岗位数量：多数远程岗限美加境内，中国境内 contractor 只拿 40 到 70% 的 band。

</details>

**6. W1 前置的五条知识是什么？为什么不去上一门深度学习课？**

<details><summary>答案</summary>

层结构骨架、每层矩阵形状、参数量怎么数、prefill 和 decode 的区别、KV cache 是什么。不上深度学习课是因为那些课讲的反向传播、梯度下降、attention 为什么有效是研究者的知识，几十个小时换不来这五条零件图级别的东西。

</details>

**7. 四个产出物各自要填满哪几个数字？为什么每个数字后面还要跟一行「怎么测的」？**

<details><summary>答案</summary>

01 推理报告：吞吐倍数、P99 延迟降幅、显存降幅、每百万 token 成本降幅。02 kernel：相对 PyTorch 的倍数、带宽利用率、kernel 发射次数降幅。03 引擎：对比 vLLM 的吞吐百分比、支持并发数、代码行数。04 训练：恢复耗时、checkpoint 开销、最大并行卡数。每个数字后面要写 warmup、synchronize、负载分布，因为「你这个数字怎么保证可信」是面试必考题，答不出来前面所有数字一起作废。

</details>

**8. M1 的 30 天是怎么分成五段的，每段的产出是什么？**

<details><summary>答案</summary>

W1（Day 1–6）纸笔算 7B 模型的账，产出一组数字；W2（Day 7–12）Colab 上跑通并用 profiler 看 timeline，产出实测与理论的比值；W3（Day 13–18）实测自己那张卡的带宽和算力，产出自己画的 roofline；W4（Day 19–24）环境工程化，产出一条命令起环境、跑完自动销毁；加餐周（Day 25–30）补 GPU 硬件、数值格式、CUDA 执行模型、规格表阅读和市场校准，产出 M1 总复习。

</details>

## 明天预告

Day 1 读 Horace He 的《Making Deep Learning Go Brrrr》。这篇文章给了整条路线的判断框架：任何一段深度学习代码慢，只有三种可能，compute-bound、memory-bandwidth-bound、overhead-bound。三种瓶颈各有各的判定方法和典型症状，治法完全不同。读完要能回答一个问题：为什么增大 batch size 有时几乎不增加延迟。
