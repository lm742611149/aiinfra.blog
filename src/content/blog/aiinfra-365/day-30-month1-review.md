---
title: 'Day 30 · M1 总复习：一页笔记、20 道全月自测、错题本汇总与 M2 预告'
description: '把 M1 四周加加餐周压成一页：W1 的账本、W2 的计时与 profiler、W3 的实测屋顶、W4 的环境流水线、加餐周的硬件与数值地基。然后合上笔记做 20 道全月自测，把三十天的错题按形状、单位、异步、标称、计费五类归根，对照 Day 0 的目标逐条打勾，最后写 M2 的预告。'
pubDate: 2026-09-05
regime: memory
tags: ['review', 'quiz', 'month-1', 'roofline', 'aiinfra-365']
series: 'aiinfra-365'
day: 30
lang: 'zh'
---

## 这个月解决了什么

Day 0 给 M1 定的目标只有一句话：搞清算力和内存花在哪，建立一辈子受用的性能直觉，这个月一行 kernel 都不用写。

三十天过去，这句话可以拆成四件具体的事，每件都对应一周：

1. **W1，纸笔算账。** 从 Llama-2-7B 的配置文件出发，算出 6.74B 参数、13.5 GB 权重、每 token 512 KB 的 KV cache、batch 1 时 150 tok/s 的 decode 上限、算术强度 1 对 ridge point 153。
2. **W2，第一次上手。** 在 Colab 的 T4 上跑通 TinyLlama，把计时改对，把 TTFT 和 TPOT 拆开，用 profiler 看到 kernel 和 gap。产出是一个比值：实测 TPOT 除以理论下限。
3. **W3，戳破标称值。** 测自己这张卡的带宽和算力，用实测值画 roofline，扫 batch 看曲线什么时候弯，弄清哪些 kernel 能碰到屋顶、哪些永远碰不到。
4. **W4，环境工程化。** 租卡、持久化、bootstrap、三层自动销毁、成本账本。一条命令起环境，跑完自己消失。

加餐周补的是前四周一直在用却没打开看的四样东西：GPU 里面有什么、数值格式怎么分位、一个 kernel 怎么被切开跑、规格表哪些数字会骗人。最后一天用真实 JD 校准了一次路线。

这些数字和结论本身都会过期，换一张卡、换一个模型全变。不会过期的是四条算法：**参数藏在矩阵形状里，显存是参数乘字节，速度上限是带宽除以要搬的字节，判断卡在哪要看算术强度和 ridge point 谁大。** M1 三十天做的所有事，都是在把这四条从纸上搬到真机上，再搬回纸上。

这篇是 M1 的收口。先把五周压成一页，然后做 20 道题，然后把错题归根，最后对照 Day 0 的目标打勾。

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="M1 知识地图：从参数量一路推到 roofline，再到实测、环境和硬件地基的总链路">
<text x="8" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">M1 知识地图：一条链，四周加一周</text>
<g font-family="var(--font-mono)" font-size="10">
<rect x="8" y="40" width="110" height="44" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="63" y="58" text-anchor="middle" fill="var(--ink)">W1 · 参数 = 格子</text>
<text x="63" y="74" text-anchor="middle" fill="var(--ink-soft)">6.74B → 13.5 GB</text>
<rect x="138" y="40" width="110" height="44" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="193" y="58" text-anchor="middle" fill="var(--ink)">带宽 ÷ 字节</text>
<text x="193" y="74" text-anchor="middle" fill="var(--ink-soft)">6.6 ms → 150 tok/s</text>
<rect x="268" y="40" width="110" height="44" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="323" y="58" text-anchor="middle" fill="var(--ink)">算术强度 1</text>
<text x="323" y="74" text-anchor="middle" fill="var(--ink-soft)">vs ridge 153</text>
<rect x="398" y="40" width="110" height="44" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="453" y="58" text-anchor="middle" fill="var(--ink)">roofline</text>
<text x="453" y="74" text-anchor="middle" fill="var(--ink-soft)">斜线 / 屋顶 / 交点</text>
<rect x="528" y="40" width="104" height="44" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="580" y="58" text-anchor="middle" fill="var(--ink)">KV cache</text>
<text x="580" y="74" text-anchor="middle" fill="var(--ink-soft)">512 KB → 32 GB</text>
<line x1="118" y1="62" x2="138" y2="62" stroke="var(--ink-faint)" stroke-width="1.5"/>
<line x1="248" y1="62" x2="268" y2="62" stroke="var(--ink-faint)" stroke-width="1.5"/>
<line x1="378" y1="62" x2="398" y2="62" stroke="var(--ink-faint)" stroke-width="1.5"/>
<line x1="508" y1="62" x2="528" y2="62" stroke="var(--ink-faint)" stroke-width="1.5" stroke-dasharray="3 3"/>
<line x1="453" y1="84" x2="453" y2="118" stroke="var(--ink-faint)" stroke-width="1.5"/>
<rect x="8" y="118" width="200" height="44" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="108" y="136" text-anchor="middle" fill="var(--ink)">W2 · 真机对账</text>
<text x="108" y="152" text-anchor="middle" fill="var(--ink-soft)">sync · TTFT/TPOT · profiler · gap</text>
<rect x="228" y="118" width="200" height="44" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="328" y="136" text-anchor="middle" fill="var(--ink)">W3 · 实测屋顶</text>
<text x="328" y="152" text-anchor="middle" fill="var(--ink-soft)">带宽 · 算力 · 自己的 roofline · batch 扫描</text>
<rect x="448" y="118" width="184" height="44" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="540" y="136" text-anchor="middle" fill="var(--ink)">W4 · 环境流水线</text>
<text x="540" y="152" text-anchor="middle" fill="var(--ink-soft)">租卡 · 持久化 · bootstrap · 三层销毁 · 账本</text>
<line x1="208" y1="140" x2="228" y2="140" stroke="var(--ink-faint)" stroke-width="1.5"/>
<line x1="428" y1="140" x2="448" y2="140" stroke="var(--ink-faint)" stroke-width="1.5"/>
<text x="108" y="184" text-anchor="middle" fill="var(--mem)">产出：实测 TPOT ÷ 6.9 ms 的比值</text>
<text x="328" y="184" text-anchor="middle" fill="var(--mem)">产出：实测 ridge、转折 batch</text>
<text x="540" y="184" text-anchor="middle" fill="var(--mem)">产出：一条命令，跑完消失</text>
<line x1="320" y1="196" x2="320" y2="222" stroke="var(--ink-faint)" stroke-width="1.5"/>
<rect x="8" y="222" width="150" height="56" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="83" y="240" text-anchor="middle" fill="var(--ink)">Day 25 GPU 解剖</text>
<text x="83" y="256" text-anchor="middle" fill="var(--ink-soft)">SM · tensor core</text>
<text x="83" y="270" text-anchor="middle" fill="var(--ink-soft)">五层存储金字塔</text>
<rect x="168" y="222" width="150" height="56" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="243" y="240" text-anchor="middle" fill="var(--ink)">Day 26 数值格式</text>
<text x="243" y="256" text-anchor="middle" fill="var(--ink-soft)">fp16/bf16/fp8/int4</text>
<text x="243" y="270" text-anchor="middle" fill="var(--ink-soft)">量化 = 省字节</text>
<rect x="328" y="222" width="150" height="56" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="403" y="240" text-anchor="middle" fill="var(--ink)">Day 27 执行模型</text>
<text x="403" y="256" text-anchor="middle" fill="var(--ink-soft)">grid/block/warp/stream</text>
<text x="403" y="270" text-anchor="middle" fill="var(--ink-soft)">launch 开销 → gap</text>
<rect x="488" y="222" width="144" height="56" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="560" y="240" text-anchor="middle" fill="var(--ink)">Day 28 规格表</text>
<text x="560" y="256" text-anchor="middle" fill="var(--ink-soft)">dense/sparse · SXM/PCIe</text>
<text x="560" y="270" text-anchor="middle" fill="var(--ink-soft)">$/1M token</text>
<text x="320" y="300" text-anchor="middle" fill="var(--ink-faint)">加餐周：把前四周一直在用的四个「黑箱」打开</text>
<rect x="8" y="322" width="624" height="34" fill="none" stroke="var(--rule)" stroke-width="1" stroke-dasharray="4 3"/>
<text x="320" y="343" text-anchor="middle" fill="var(--ink-soft)">Day 29 市场校准：JD 验证「推理优先」，加六个勾，不改骨架 → Day 30 收口 → M2</text>
<text x="8" y="385" fill="var(--ink-faint)">靛蓝 = memory-bound 那条链；琥珀 = 算力屋顶；灰 = 工具与工程。整个 M1 只有一条主线：字节。</text>
</g>
</svg>
<figcaption>M1 的知识地图。第一行是 W1 的推导链，五个数一步推一步；第二行是 W2 到 W4 把这条链搬到真机和真实账单上；第三行是加餐周把链上一直当常数用的硬件、格式、执行模型、规格表各打开一次。所有箭头最后都汇到同一个词：字节。</figcaption>
</figure>

## 一页笔记

以下全部沿用 M1 的数字口径：Llama-2-7B fp16，A100 80GB SXM；实验卡 Colab 免费 T4，实验模型 TinyLlama-1.1B fp16。换模型换卡时重算，不要背数。

### W1 · 算账（Day 1–6）

三种瓶颈（Day 1）：compute-bound 卡算力，memory-bandwidth-bound 卡搬运，overhead-bound 卡 CPU 发指令。症状各不同，治法各不同，判断顺序是先看 GPU 有没有空转（overhead），再算算术强度落在 ridge 哪一侧。

参数量（Day 2）：`N = 2·V·d + L·(4·d² + 3·d·d_ff)`。7B 代入：词表两头 0.26B，一层注意力 67.1M 加 FFN 135.3M 等于 202.4M，32 层 6.48B，合计 6.74B。矩阵形状永远是「输入长度 × 输出长度」，向量只有长度、矩阵才有形状。

注意力（Day 3）：q 来查，k 被查，v 被混合；输出是 Σ(相似度 × v)。多头各有独立的 W^q/W^k/W^v，拼接后过 W^o。自回归一步一 token，temperature 缩放概率。

FLOPs 与 KV cache（Day 4）：每 token 前向 ≈ 2N；attention 平方项 ≈ 4·L·n²·d，几万 token 以上才追上参数项。KV cache 每 token = 2 × L × (n_kv·d_head) × 字节，MHA 时 n_kv·d_head = d，7B 是 512 KB；GQA 时要查 `num_key_value_heads`，Llama-3-8B 只有 128 KB，TinyLlama 22.5 KB。

显存与 roofline（Day 5）：显存四项，权重常驻 13.5 GB、KV cache 随 batch × 序列长涨、激活层算完就扔、框架开销 1 到 2 GB；batch 32 × 2048 时 KV cache 32 GB 是权重的 2.4 倍。decode 上限 = 带宽 ÷ 权重字节 = 2039 ÷ 13.5 ≈ 150 tok/s。算术强度 = FLOP ÷ 字节，decode batch 1 是 1；ridge point = 算力 ÷ 带宽 = 153。强度低于 ridge 在斜线上卡带宽，高于 ridge 在屋顶上卡算力。prefill 在屋顶，decode 在斜线。

W1 那张七行表：

| 要算出的数 | 答案 | 怎么来的 |
| --- | --- | --- |
| 权重（fp16） | 13.5 GB | 6.74e9 × 2 B |
| KV cache / token | 512 KB | 2 × 32 × 4096 × 2 B |
| KV cache @ 32 × 2048 | 32 GB | 65536 × 512 KB |
| decode 上限（batch 1） | ~150 tok/s | 2039 GB/s ÷ 13.5 GB |
| 算术强度（batch 1） | 1 FLOP/byte | 2 FLOP ÷ 2 B |
| A100 ridge point | ~153 | 312e12 ÷ 2039e9 |
| 打到 compute-bound | batch ≈ 153 | 上两行相除 |

换模型换卡的三个对照点（Day 6）：13B 是 13.02B / 26 GB / 800 KB / 78 tok/s；Llama-3-8B 是 8.03B / 16 GB / 128 KB / 127 tok/s；H100 SXM 带宽 3350、算力 989，ridge 295，7B 上限 248 tok/s。卡越新 ridge 越高，decode 离屋顶越远。

### W2 · 真机对账（Day 7–12）

环境（Day 7）：Colab T4，16 GB GDDR6，320 GB/s，fp16 tensor core 65 TFLOP/s，fp32 8.1，ridge 203，Turing 架构**不支持 bf16**。7B fp16 权重 13.5 GB 加框架开销贴着 16 GB，装不下，换 TinyLlama-1.1B：22 层、d 2048、32 个 q 头、4 个 KV 头、d_ff 5632，权重 2.2 GB。第一次 generate 慢好几倍是 CUDA context 初始化加 kernel 挑选；warmup 三次不计，连跑十次，(最大 − 最小) ÷ 中位数 < 10% 才算稳。

计时（Day 8）：CUDA 是异步的，CPU 把 kernel 塞进 stream 就往下走。不 `torch.cuda.synchronize()` 测到的是提交时间，可以比真实时间小几个数量级。synchronize 法量端到端墙钟，Event 法量 GPU 两点之间；测 TPOT 用前者，测单个 kernel 用后者，两者之差就是 overhead。`.item()`、`.cpu()`、`print(tensor)` 会隐式同步。计时要 sync，服务代码要少 sync，方向相反。

TTFT 与 TPOT（Day 9）：TTFT 对应 prefill，TPOT 对应 decode，必须分开报。TinyLlama 在 T4 的 TPOT 理论下限 2.2 GB ÷ 320 GB/s ≈ 6.9 ms，约 145 tok/s。**整周的产出是实测 TPOT ÷ 6.9 ms 这个比值**：1.5 到 3 倍说明 memory-bound 的判断成立，W1 的表可以信；10 倍说明有别的东西在拖，大概率是 overhead。这个比值是全年调优的基线。

profiler（Day 10）：`torch.profiler` 配 `schedule(wait, warmup, active)`，每步 `prof.step()`，导出 chrome trace 在 Perfetto 里看。CPU 行是算子，GPU 行是 kernel。kernel 名对模型部件：gemm/gemv 是线性层（一步 155 次，能和 Day 2 数的矩阵对账），fmha/sdpa 是 attention，silu/mul/add 是 FFN 激活和残差，pow/mean/rsqrt 四五个小块是 RMSNorm。profiler 看比例，Event 报绝对时间。

gap（Day 11）：GPU 行上 kernel 之间的空白就是 overhead-bound 的实物证据，那段时间 CPU 在跑 Python 和 dispatcher。TinyLlama 一步 decode 三四百个 kernel，每个 CPU 侧几十微秒，加起来和 6.9 ms 同量级。加大 batch 后 GPU 段变长、gap 占比下降。两种治法：减少 launch 次数（CUDA graph、`torch.compile` 的 fusion），或让每次 launch 干更多活（batching）。overhead-bound 和 memory-bound 都有「加 batch 时间不变」的症状，靠 timeline 上有没有空白区分。

### W3 · 实测屋顶（Day 13–18）

带宽（Day 13）：大张量 `y = x + 1`，字节 = 读加写，除以 sync 后的中位时间。张量要远大于 L2（T4 4 MB，A100 40 MB），否则测的是 L2。预期是标称的 75 到 90%，差的部分是 DRAM 刷新、行切换、读写切换、降频，代码消不掉。标称的来路：T4 是 256 bit × 10 Gbps ÷ 8 = 320 GB/s，A100 是 5120 bit × 3.19 Gbps ÷ 8 ≈ 2039 GB/s。

算力（Day 14）：大方阵 matmul，FLOPs = 2MNK。fp16 走 tensor core 才对 65 TFLOPS，fp32 对 8.1，A100 的 fp32 开 tf32 对 156、关了对 19.5，dense 312 不是 sparse 624。方阵算术强度 = N ÷ 3，T4 上 N > 609、A100 上 N > 459 才跨过 ridge，所以矩阵至少 4096。预期打到标称的 70 到 90%。

自己的 roofline（Day 15）：用实测带宽和实测算力替换标称值，实测 ridge = 实测算力 ÷ 实测带宽。画图需要四个数：卡的带宽和算力是测的，workload 的 FLOP 和字节是算的，唯一实测的是时间。decode batch 1 的点在斜线下方，到斜线的距离是 overhead 和 kernel 效率，到屋顶的距离是算术强度；前者靠减 launch，后者靠加 batch 或量化，方向不同。实测值只在 ridge 附近改变判断，离 ridge 两个量级的点不受影响。

batch 扫描（Day 16）：只测 decode 段，等长 prompt，扫 1/4/16/64/128。W1 的近似「AI = batch」漏了 KV cache 的字节：`AI(b) = 2Nb ÷ (2N + b·n·kv)`，b 无穷大时趋于 `AI_max = 2N ÷ (n·kv)`。7B 在 2048 上下文下 AI_max ≈ 12.9，永远低于 153，**加 batch 拉不到屋顶**，能做的是减 KV 字节。曲线弯的原因是 KV 字节随 batch 涨，不是算力到瓶颈；最左端比线性还线性是 overhead 给的免费。实际服务里 batch 上限是显存给的，不是 ridge 给的。

标称 vs 实测（Day 17）：65 TFLOPS = 40 SM × 8 tensor core × 64 FMA × 2 × 1.59 GHz，实际最先缩水的是时钟。MFU = 模型公式 FLOP ÷ 耗时 ÷ 峰值，decode batch 1 的 MFU 不到 1% 是物理决定的，不是代码问题。能碰到屋顶的是大 GEMM 和 prefill 的线性层；永远碰不到的是 elementwise、softmax、RMSNorm、embedding、decode 的一切，算术强度不到 1。后一组的治法叫 fusion：SiLU 和乘法分开搬 5 个张量，融成一个只搬 3 个，字节少 40%。

### W4 · 环境流水线（Day 19–24）

租卡（Day 19）：RunPod 平台统一定价，2026 年 9 月已没有 Spot 档，只有 On-demand、Savings plan 和 Secure / Community 两档机器；Vast 是市场，房东各自定价，便宜实例叫 interruptible，被顶掉时暂停不销毁、显存内容全丢、磁盘照收费。选卡按 decode 的逻辑：先看显存装不装得下（Day 5 四项），再看带宽，每美元买到多少带宽，算力排最后。只充 10 到 20 美元，不绑卡，不开 auto-pay。任务结束是 delete，不是 stop。nvidia-smi 的 CUDA Version 是驱动上限不是 PyTorch 在用的版本，GPU-Util 是「有没有 kernel 在跑」不是算力利用率，功耗那格更诚实。

持久化（Day 20）：RunPod 容器盘 stop 即清空；卷盘 stop 保留但费率从 0.10 翻倍到 0.20 美元/GB/月；网络卷 0.07 美元/GB/月但锁定数据中心。决策树第一问是「丢了 5 分钟能重造吗」：能重造的（依赖、权重、数据集）一律不存，不可重造的（代码、结果）进 git 或对象存储。7B 权重 13.5 GB 在 200 Mbps 下要 9 分钟，1 Gbps 下 2 分钟，Mbps 要除以 8。密钥只走环境变量，不进 git。

bootstrap（Day 21）：选自带 torch 的官方镜像是最省时间的决定，装 torch 一项就吃光 5 分钟。脚本幂等：先查再动、交给工具去重、只追加不覆盖，连跑两次第二次接近零秒。requirements 锁版本，否则 W2 和 W3 的数字不可比。长任务进 tmux，脚本在便宜 CPU pod 上调，最后在 GPU 上验收。

三层销毁（Day 22）：第一层 run.sh 退出路径的 trap，顺序是推结果 → 通知 → 销毁；第二层看门程序每分钟读 GPU 利用率、python 进程、ssh 会话，三者同时空闲 20 分钟就销毁并推送通知，读不到就当忙、不开 `set -e`；第三层只预充值不绑卡，余额归零厂商自动停机，最坏损失等于余额。第一层最容易失效，第二层是主力。验收是故意跑完一个任务，看实例自己消失。

账本（Day 23）：一次实验一行 CSV，开机写前半行，销毁补后半行并 git push 再调销毁 API。$/1M token = 小时价 ÷ (tok/s × 3600) × 1e6。A100 SXM 1.39 美元/时，7B batch 1 约 2.57 美元，batch 32 约 0.08 美元，差 32 倍，因为搬权重的 6.6 ms 是固定成本。便宜卡调试，贵卡出数。

### 加餐周 · 硬件与数值地基（Day 25–29）

GPU 解剖（Day 25）：A100 108 个 SM，每个 SM 64 个 FP32 core、4 个第三代 tensor core、256 KB 寄存器、192 KB L1/shared；312 TFLOPS = 4 × 256 × 2 × 108 × 1.41 GHz，fp32 19.5 是它的十六分之一，因为走的是另一套电路。五层存储金字塔：寄存器、shared/L1（约 19 TB/s）、L2 40 MB（约 7 TB/s）、HBM 80 GB（2039 GB/s）、PCIe/NVLink。上面三层加起来不到 100 MB，权重只能住 HBM，所以 decode 每步都搬。roofline 其实有三条斜线，tiling 就是把数据从 HBM 那条线挪到 shared 那条线。

数值格式（Day 26）：总位数固定，范围靠指数、精度靠尾数，此消彼长。fp16 是 1+5+10 最大 65504，bf16 是 1+8+7 范围同 fp32、精度粗 8 倍，训练偏爱 bf16 因为怕溢出。T4 没有 bf16 电路，PyTorch 可能用 fp32 模拟、慢好几倍不报错。fp8 有 e4m3 和 e5m2 两种分法，Hopper 起支持。int8/int4 没有指数，靠每组一个 scale，一个 outlier 就撑坏整组。量化在 roofline 上挪的是算术强度：7B 从 fp16 的 151 tok/s 到 int8 的 302、int4 的 586。对 prefill 没收益，batch 大了收益缩水。

执行模型（Day 27）：kernel 被切成 grid → block → thread，block 整捆放到一个 SM 上，SM 再按 32 个线程一个 warp 调度，block 大小取 32 的倍数。stream 是有序队列，同一 stream 严格按序、不同 stream 可并发；「异步」说 CPU、「有序」说 GPU，不矛盾。一次 launch 经 PyTorch 约 10 µs，decode 一步 400 个 kernel 就是 4 ms 量级，和 6.9 ms 同级，且不随 batch 变。CUDA graph 把 400 次 launch 录成 1 次 replay，形状固定才能用，所以 vLLM 只对 decode 开。Triton 只让你写 grid 和 block 两层。

规格表（Day 28）：带星号的是 2:4 稀疏，推理一律用 dense；SXM 和 PCIe 是两张卡，A100 带宽 2039 对 1935，ridge 153 对 161；TFLOPS 前面的精度标签决定该对哪一行；容量和带宽是两个数，H200 只换显存就让 decode 快 30%。NVLink 600 GB/s 对 PCIe Gen4 64 GB/s 差十倍，M9 多卡时是主角。八步阅读清单填完就有那张卡版本的 W1 七行表。

市场校准（Day 29）：五十条 JD 样本，Boss 直聘为零。推理优先被验证，骨架不改，加六个勾：W5+ GQA/MoE、W7+ speculative decoding、W10+ SGLang、W13+ 两卡 TP、W20+ 裸 CUDA、W42+ K8s 保底。薪资主流是 30 到 60k 乘 15 薪，Day 0 的 60 到 100 万是头部；海外 band 16.5 到 33 万美元但限美加，境内 contractor 拿 40 到 70%。正视四条：年龄红线、别冲算子岗、学历分布、海外地域。「远程也不难」这个念头要掐掉，难的是入口不是技术。

## 四周产出对照

路线图给每周定了一个产出和一条验收线。三十天后逐条对：

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="M1 四周加加餐周的产出与验收对照">
<g font-family="var(--font-mono)" font-size="10">
<text x="8" y="18" font-size="12" fill="var(--ink)">M1 五周：路线图定的产出 vs 实际交出的东西</text>
<rect x="8" y="36" width="60" height="240" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="68" y="36" width="270" height="240" fill="var(--paper-raised)" stroke="var(--rule)"/>
<rect x="338" y="36" width="294" height="240" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="38" y="52" text-anchor="middle" fill="var(--ink-faint)">周</text>
<text x="203" y="52" text-anchor="middle" fill="var(--ink-faint)">路线图要的产出</text>
<text x="485" y="52" text-anchor="middle" fill="var(--ink-faint)">实际交出 · 状态</text>
<line x1="8" y1="60" x2="632" y2="60" stroke="var(--rule)"/>
<text x="38" y="84" text-anchor="middle" fill="var(--mem)">W1</text>
<text x="76" y="80" fill="var(--ink)">能回答「7B 推理时显存花在哪」</text>
<text x="76" y="94" fill="var(--ink-soft)">一组数字，五道验收题全对</text>
<text x="346" y="80" fill="var(--ink)">七行表 + 13B / Llama-3-8B / H100 重算</text>
<text x="346" y="94" fill="var(--mem)">■ 已完成，数字全部自己算出</text>
<line x1="8" y1="104" x2="632" y2="104" stroke="var(--rule-soft)"/>
<text x="38" y="128" text-anchor="middle" fill="var(--mem)">W2</text>
<text x="76" y="124" fill="var(--ink)">能指出哪个 op 最耗时、为什么</text>
<text x="76" y="138" fill="var(--ink-soft)">实测 TPOT ÷ 理论下限的比值</text>
<text x="346" y="124" fill="var(--ink)">方法、脚本、记录表齐；实测列待填</text>
<text x="346" y="138" fill="var(--compute)">□ 方法完成，真机数字待上 Colab 跑</text>
<line x1="8" y1="148" x2="632" y2="148" stroke="var(--rule-soft)"/>
<text x="38" y="172" text-anchor="middle" fill="var(--mem)">W3</text>
<text x="76" y="168" fill="var(--ink)">自己画的 roofline 加实测点</text>
<text x="76" y="182" fill="var(--ink-soft)">实测 ridge、batch 曲线的转折点</text>
<text x="346" y="168" fill="var(--ink)">画图脚本参数化，AI(b) 公式补上</text>
<text x="346" y="182" fill="var(--compute)">□ 方法完成，实测带宽/算力待填</text>
<line x1="8" y1="192" x2="632" y2="192" stroke="var(--rule-soft)"/>
<text x="38" y="216" text-anchor="middle" fill="var(--mem)">W4</text>
<text x="76" y="212" fill="var(--ink)">一条命令起环境，跑完自动销毁</text>
<text x="76" y="226" fill="var(--ink-soft)">能立刻回答「这个月花了多少」</text>
<text x="346" y="212" fill="var(--ink)">bootstrap、三层销毁、账本脚本写好</text>
<text x="346" y="226" fill="var(--compute)">□ 脚本完成，两次验收待真机触发</text>
<line x1="8" y1="236" x2="632" y2="236" stroke="var(--rule-soft)"/>
<text x="38" y="260" text-anchor="middle" fill="var(--ink-soft)">加餐</text>
<text x="76" y="256" fill="var(--ink)">路线图没要求，自己加的</text>
<text x="76" y="270" fill="var(--ink-soft)">补硬件、格式、执行模型、规格表</text>
<text x="346" y="256" fill="var(--ink)">312 乘出来了，位分配画出来了</text>
<text x="346" y="270" fill="var(--mem)">■ 已完成，六个勾写进路线图</text>
<text x="8" y="294" fill="var(--ink-faint)">■ 纸笔部分全部闭环；□ 三周的实测列还空着，这是 M2 开工前要先补的债。</text>
</g>
</svg>
<figcaption>五周对照。W1 和加餐周是纯纸笔，已经闭环。W2 到 W4 的方法、脚本、记录表都齐了，但「实测」那一列到今天还是空的，这不是写作的省略，是真实状态：文章先于实验写完。M2 开工前第一件事是回 Colab 把这三周的记录表填满。</figcaption>
</figure>

这张图上要诚实的一点：**W2、W3、W4 三周的文章是先于真机实验写出来的。** 文中所有「测出来」的数字都标了预期区间和依据，记录表留着空。这不是缺陷，是这个系列的写法决定的：先把方法、预期和坑想清楚写下来，再上机，上机时只做对照不做设计，符合 Day 0「不在按小时计费的机器上想逻辑」的纪律。但债就是债，M2 的第一个动作不是学 KV cache，是把 Day 7、9、13、14、16 五张记录表填满。填完才知道 Day 9 那个比值是 2 还是 10，才知道 M2 该先治 overhead 还是先治字节。

## M1 全月自测

合上笔记做。20 题覆盖五块，每题标了主考哪一天，答不出来回那一天重读。W1 的题只出 4 道，因为 Day 6 已经考过 9 道。

### W1 · 算账（4 题）

**1. 一个模型 L = 36、d = 5120、h = 40、n_kv = 8、d_ff = 13824、V = 128256、fp16。算参数量、权重字节、KV cache 每 token。（考 Day 2、Day 4、Day 6）**

<details><summary>答案</summary>

d_head = 5120 ÷ 40 = 128，n_kv·d_head = 1024。

词表两头：2 × 128256 × 5120 ≈ 1.313B。
一层注意力（GQA 通式）：2 × 5120² + 2 × 5120 × 1024 = 52.4M + 10.5M = 62.9M。
一层 FFN：3 × 5120 × 13824 = 212.3M。
一层合计 275.2M，36 层 9.91B，总计约 11.2B。

权重 11.2e9 × 2 B ≈ 22.4 GB。
KV cache 每 token = 2 × 36 × 1024 × 2 B = 147,456 B = 144 KB。若错用 d = 5120 会算成 720 KB，差 5 倍，正好是 h ÷ n_kv。

</details>

**2. decode batch 1 的算术强度为什么和模型大小无关？换到 H100 后这个数变不变？ridge point 变不变？（考 Day 5、Day 6）**

<details><summary>答案</summary>

每个参数搬 2 字节做 2 FLOP，参数量 N 在分子分母约掉，强度恒为 1，7B 和 70B 一样。换卡不改 workload，强度还是 1。ridge point 是卡的属性，A100 153、H100 SXM 295，卡越新 ridge 越高，decode 离屋顶越远，算力利用率从 0.65% 掉到 0.34%。

</details>

**3. batch 32 × 2048 时 7B 的显存四项各多少？把 batch 降到 1 哪些变哪些不变？换成 Llama-3-8B 后 KV cache 和权重的比例变成多少？（考 Day 5、Day 6）**

<details><summary>答案</summary>

权重 13.5 GB、KV cache 32 GB、激活约 1.4 GB、框架开销约 1.5 GB，合计约 48 GB。batch 降到 1：权重和框架开销不变，KV cache 和激活缩 32 倍。Llama-3-8B 权重 16 GB、KV cache 每 token 128 KB，65536 token 是 8 GB，缓存变成权重的一半而不是 2.4 倍，这就是 GQA 存在的理由：参数只省 6%，KV cache 省 75%。

</details>

**4. 为什么 continuous batching 大幅提高吞吐却几乎不改善单请求延迟？（考 Day 5）**

<details><summary>答案</summary>

吞吐涨是因为 batch 把算术强度从 1 往 153 拉：搬一遍权重 6.6 ms 不变，服务的 token 从 1 个变 32 个。单请求延迟不变是因为每个 token 仍要等权重完整搬一遍，6.6 ms 是物理下限，多 31 个搭车的请求不会让车更快，实际还会略慢一点，因为 KV cache 读取多了。

</details>

### W2 · 计时与 profiler（4 题）

**5. 一段代码不加 synchronize 测出 8192 方阵 fp16 matmul 20 µs，算出多少 TFLOPS？为什么不可能？测到的是什么？（考 Day 8）**

<details><summary>答案</summary>

2 × 8192³ ≈ 1.1e12 FLOP ÷ 20e-6 s = 5.5e16 FLOP/s = 55,000 TFLOPS，是 T4 标称 65 的八百多倍，比 H100 还快几十倍。测到的是 CPU 把 kernel 塞进 stream 的提交时间，和 kernel 干多少活无关。真实值应接近 1.1e12 ÷ 65e12 ≈ 17 ms。

</details>

**6. 实测 TPOT 是理论下限的 4 倍，能说「带宽只用了 25%」吗？怎么才能分清是带宽没用满还是 GPU 在等 CPU？（考 Day 9、Day 11）**

<details><summary>答案</summary>

不能。比值大可能是 GPU 在等 CPU 发 kernel，不是搬运本身慢。带宽利用率要看 GPU 真正跑 kernel 那段时间里搬了多少字节。分清的方法是看 profiler 的 timeline：GPU 行有大量空白是 overhead-bound，色块连续、matmul 占主体才是 memory-bound。两个能同时存在，先治 overhead。

</details>

**7. trace 里 top 5 kernel 各对应模型哪部分？一步 decode 里 gemm 类 kernel 应该出现多少次，怎么和 Day 2 对账？（考 Day 10）**

<details><summary>答案</summary>

gemm/gemv 是全部 `nn.Linear`（q/k/v/o 四个投影加 FFN 的 gate/up/down 三个）；fmha_cutlass 或 bmm + softmax 是 attention（T4 上没有 FlashAttention 2）；silu、mul、add 是 FFN 激活和残差；pow、mean、rsqrt、mul 四五个小块是 RMSNorm；index/embedding 是查表。TinyLlama 22 层 × 7 = 154 加 lm_head 一个，每步 155 次，`aten::linear` 的 # of Calls 除以 active 步数应等于 155。

</details>

**8. 让 gap 变小的两种办法是什么？为什么换更快的 GPU 会让 gap 更宽？（考 Day 11、Day 27）**

<details><summary>答案</summary>

一是减少 launch 次数：fusion 把相邻小 kernel 融成一个，CUDA graph 把整步录下来一次 replay。二是让每次 launch 干更多活：加大 batch，launch 次数不变但每个 kernel 处理更多 token，GPU 段变长填掉空白。gap 的长度由 CPU 发 kernel 的速度决定，更快的 GPU 把每个 kernel 做得更快、等得更久，空白比例反而更高。

</details>

### W3 · 实测屋顶（4 题）

**9. 用 `y = x + 1` 测带宽，x 是 256 MiB fp16，一次 1.8 ms，带宽多少？占标称几成？为什么张量要远大于 L2？（考 Day 13、Day 25）**

<details><summary>答案</summary>

读 x 加写 y 共 512 MiB ≈ 537 MB，537 MB ÷ 1.8 ms ≈ 298 GB/s，占 320 的 93%。只算读会得到 149 GB/s，少一半。张量小于 L2（T4 4 MB，A100 40 MB）时数据第一次读进来就留在 L2，后续读写都在 L2 完成，测出来是 L2 带宽（A100 上约 7 TB/s），是 HBM 的三倍多，数字漂亮但测错了对象。

</details>

**10. 方阵 matmul 的算术强度是多少？T4 上 N 多大才跨过 ridge？为什么 A100 规格表上不能用 624？（考 Day 14、Day 28）**

<details><summary>答案</summary>

2N³ FLOP ÷ (3N² × 2 B) = N ÷ 3。T4 ridge 203，N > 609；A100 ridge 153，N > 459。所以测算力要 4096 起。624 是 2:4 结构化稀疏的数，要求权重每 4 个连续元素恰有 2 个零，正常训练的模型不满足；用它做分母实测百分比低一半，ridge 会算成 306，「batch 多大才 compute-bound」的判断翻倍错。

</details>

**11. 写出 batch 为 b、上下文 n 时 decode 一步的算术强度 AI(b)。7B 在 2048 上下文下 b 无穷大时 AI 趋于多少？这意味着什么？（考 Day 16）**

<details><summary>答案</summary>

字节 = 2N + b·n·kv，FLOP = 2Nb，AI(b) = 2Nb ÷ (2N + b·n·kv)。b 无穷大时趋于 2N ÷ (n·kv) = 权重字节 ÷ 一个序列的 KV cache 字节 = 13.5 GB ÷ (2048 × 512 KB) ≈ 12.9。A100 的 ridge 是 153，所以不管 batch 多大 7B 在 2048 上下文下永远 memory-bound，加 batch 拉不到屋顶。能做的是减 KV 字节：GQA、KV cache 量化、缩短上下文。

</details>

**12. 给出三种能碰到屋顶的 kernel 和三种永远碰不到的，说出算术强度量级。碰不到的那组怎么治？（考 Day 17）**

<details><summary>答案</summary>

能碰到：大方阵 matmul（4096 方阵约 1365）、prefill 的线性层（强度约等于序列长度）、FlashAttention 式的 prefill attention（几千）。碰不到：elementwise add（约 0.17）、SiLU/RMSNorm/softmax（0.6 到 1）、decode 的线性层和 attention（恒为 1）、embedding（0）。后一组的时间全是搬字节，算力多少都一样，治法是 fusion 减字节：SiLU 和乘法分开搬 5 个张量，融成一个只搬 3 个，字节少 40%，launch 次数减半。

</details>

### W4 · 环境（4 题）

**13. RunPod 三种存储在 stop 和 delete 时各是什么命运？一块 50 GB 卷盘每周用 6 小时、停 162 小时，一个月存储费多少？占预算几成？（考 Day 20）**

<details><summary>答案</summary>

容器盘 stop 即清空、不收停机费；卷盘 stop 保留但费率从 0.10 翻倍到 0.20 美元/GB/月，delete 清空；网络卷 stop 和 delete 都保留，0.07 美元/GB/月，但必须创建 Pod 时挂上且锁定数据中心。50 GB 卷盘停机部分 50 × 0.20 × 162 ÷ 720 ≈ 2.25 美元/周，一个月约 10 美元，占 30 到 60 美元预算的 17% 到 33%，而且重启不保证有 GPU。

</details>

**14. 三层自动销毁分别防哪种失败？哪一层最容易失效，谁兜底？auto-pay 为什么是第三层的敌人？（考 Day 22）**

<details><summary>答案</summary>

第一层 run.sh 的 trap 防「任务正常跑完但我不在场」；第二层看门程序防「实例活着但没在干活」；第三层余额上限防「前两层都失效」。第一层最容易失效，因为它依赖任务通过 run.sh 起并走到退出路径，调试阶段大部分时间不满足；第二层兜底，它只看 GPU 有没有人用。auto-pay 让余额永远不归零，第三层「损失上界等于余额」的保证直接作废，上界变成银行卡额度。

</details>

**15. bootstrap 5 分钟预算里哪一步最可能把预算吃光？在脚本里还是脚本外解决？为什么必须幂等？（考 Day 21）**

<details><summary>答案</summary>

装 PyTorch，2.5 GB 流量、2 到 5 分钟，一项就超预算。在脚本外解决：选自带 torch 的官方镜像，脚本里只做 `import torch` 检查。必须幂等因为脚本会重复执行：中途断线重跑、第二天接着用同一台、配成启动命令后 stop/resume 再跑一次。不幂等会在 `git clone` 报目录已存在或重装依赖，配成启动命令时严重到 ssh 起不来。

</details>

**16. A100 SXM 1.39 美元/时，7B batch 1 和 batch 32 的 $/1M token 各多少？为什么账本要在销毁 API 之前 git push？（考 Day 23、Day 28）**

<details><summary>答案</summary>

batch 1：150 tok/s × 3600 = 540,000 tok/h，1.39 ÷ 0.54 ≈ 2.57 美元。batch 32：4,800 tok/s，17.28M tok/h，1.39 ÷ 17.28 ≈ 0.08 美元。差 32 倍因为搬权重 6.6 ms 是固定成本，同一遍搬运服务了 32 个 token。账本留在实例上，销毁后容器盘就没了，等于没记；所有要留下的东西在销毁前必须离开实例，这是 Day 20 那条规则的应用。

</details>

### 加餐周 · 硬件与数值（4 题）

**17. 把 A100 的 312 TFLOPS 从零件表乘出来。fp32 为什么只有十六分之一？elementwise kernel 把算术强度拉到 200 能达到 312 吗？（考 Day 25）**

<details><summary>答案</summary>

每 SM 每时钟 4 个 tensor core × 256 次 FMA × 2 FLOP = 2048 FLOP，× 108 个 SM × 1.41 GHz ≈ 3.12e14 = 312 TFLOP/s。fp32 走 64 个 CUDA core 每时钟各 1 次 FMA：64 × 2 × 108 × 1.41e9 ≈ 19.5，比值 16 来自 1024 对 64。elementwise 走 CUDA core 不走 tensor core，屋顶是 19.5 那条虚线，强度再高也只能顶到 19.5，所以要和 GEMM fuse 藏进读写间隙里。

</details>

**18. fp16 和 bf16 位怎么分？为什么 T4 上 bf16 会出事、怎么提前知道？7B 量化到 int8、int4（g128 scale）后 A100 上 decode 上限各多少？（考 Day 26）**

<details><summary>答案</summary>

fp16 是 1+5+10，最大 65504；bf16 是 1+8+7，范围同 fp32、精度粗 8 倍。Turing 的 tensor core 没有 bf16 电路，PyTorch 要么报错，要么用 fp32 CUDA core 模拟，走 8.1 TFLOPS 的低屋顶而不是 65，慢好几倍不报错。提前查 `torch.cuda.is_bf16_supported()` 或 `get_device_capability()` 小于 (8, 0)。int8：6.74 GB ÷ 2039 GB/s = 3.3 ms，约 302 tok/s；int4 每权重 0.5 + 2/128 ≈ 0.516 B，3.48 GB，1.7 ms，约 586 tok/s。量化挪的是算术强度，算力屋顶一点没动。

</details>

**19. 一百万个元素、block 256，grid 多大？warp 为什么是 32？一次 launch 多少微秒，decode 一步 400 个 kernel 的开销和 6.9 ms 比是什么关系？CUDA graph 为什么只对 decode 好用？（考 Day 27）**

<details><summary>答案</summary>

grid = ceil(1e6 ÷ 256) = 3907 个 block，最后一个 block 多出 192 个线程没活干，所以要 `if (i < n)`。32 是硬件常量，SM 按 32 一组切 warp，block 不是 32 的倍数会浪费调度名额。launch 经 PyTorch 约 10 µs，400 个是 4 ms 量级，和 6.9 ms 同级，且不随 batch 变，所以 batch 越大占比越小。CUDA graph 要求形状和显存地址固定，decode 每步一个 token 形状固定能录，prefill 每个请求 prompt 长度不同难录，vLLM 只对 decode 开。

</details>

**20. 拿到一张新卡的规格表，八步各填什么？H100 PCIe 带宽 2.0 TB/s、算力 756，ridge 多少？这对 decode 意味着什么？（考 Day 28）**

<details><summary>答案</summary>

一算力：FP16/BF16 tensor core 不带星号的 dense 值，看清 SXM 还是 PCIe 列；二带宽：同一列的 GPU Memory Bandwidth；三 ridge = 一 ÷ 二；四 decode 上限 = 二 ÷ 权重字节；五容量够不够装四项；六互联 NVLink 还是 PCIe；七功耗决定持续性能打几成；八 $/1M token = 小时价 ÷ (吞吐 × 3600) × 1e6。H100 PCIe：756e12 ÷ 2.0e12 ≈ 378，比 A100 的 153 高一倍多，同样的 batch 离 compute-bound 更远、算力利用率更低；H100 对 decode 的收益来自带宽让单步更快，不是更接近屋顶。

</details>

20 题做完，W1 和加餐周的 8 题必须全对，因为它们是纯纸笔，没有任何借口。W2 到 W4 的 12 题如果只能背出方法说不出数字，说明那三张记录表没填，回去填。

## 错题本汇总

三十天的误区分散在每篇的「常见误区」里，合起来有六十多条。归根之后只有五类。每类先写根源，再列这个月在哪些地方以不同面目出现过。看清根源比记住每一条更有用，因为下个月它们还会换个地方出现。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="M1 全月错题按五类根源归纳：形状、单位、异步、标称、计费">
<g font-family="var(--font-mono)" font-size="10">
<text x="8" y="18" font-size="12" fill="var(--ink)">六十多条误区，五个根源</text>
<rect x="8" y="36" width="118" height="200" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="67" y="56" text-anchor="middle" font-size="11" fill="var(--ink)">形状</text>
<text x="67" y="72" text-anchor="middle" fill="var(--ink-faint)">W1 为主</text>
<text x="14" y="96" fill="var(--ink-soft)">· 向量答成矩阵</text>
<text x="14" y="112" fill="var(--ink-soft)">· d_ff 代进 KV</text>
<text x="14" y="128" fill="var(--ink-soft)">· GQA 用 d 不用</text>
<text x="14" y="142" fill="var(--ink-soft)">  n_kv·d_head</text>
<text x="14" y="158" fill="var(--ink-soft)">· 混的是 v 不是</text>
<text x="14" y="172" fill="var(--ink-soft)">  「关系」</text>
<text x="14" y="188" fill="var(--ink-soft)">· 缓存 k/v 不缓存 q</text>
<text x="14" y="222" fill="var(--mem)">规律：输入长 × 输出长</text>
<rect x="136" y="36" width="118" height="200" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="195" y="56" text-anchor="middle" font-size="11" fill="var(--ink)">单位</text>
<text x="195" y="72" text-anchor="middle" fill="var(--ink-faint)">全月都有</text>
<text x="142" y="96" fill="var(--ink-soft)">· 只算读不算写</text>
<text x="142" y="112" fill="var(--ink-soft)">· FLOP 忘乘 2</text>
<text x="142" y="128" fill="var(--ink-soft)">· Mbps 当 MB/s</text>
<text x="142" y="144" fill="var(--ink-soft)">· 4-bit 按 0.5 B 算</text>
<text x="142" y="160" fill="var(--ink-soft)">· GB 与 GiB</text>
<text x="142" y="176" fill="var(--ink-soft)">· 位 ÷ 8 = 字节</text>
<text x="142" y="222" fill="var(--mem)">规律：写下单位再算</text>
<rect x="264" y="36" width="118" height="200" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="323" y="56" text-anchor="middle" font-size="11" fill="var(--ink)">异步</text>
<text x="323" y="72" text-anchor="middle" fill="var(--ink-faint)">W2 · Day 27</text>
<text x="270" y="96" fill="var(--ink-soft)">· 不 sync 就计时</text>
<text x="270" y="112" fill="var(--ink-soft)">· 第一次当典型</text>
<text x="270" y="128" fill="var(--ink-soft)">· util 100% 当满载</text>
<text x="270" y="144" fill="var(--ink-soft)">· 加 batch 不变就</text>
<text x="270" y="158" fill="var(--ink-soft)">  判 memory-bound</text>
<text x="270" y="174" fill="var(--ink-soft)">· 换快卡治 gap</text>
<text x="270" y="190" fill="var(--ink-soft)">· 服务代码到处 sync</text>
<text x="270" y="222" fill="var(--ink-soft)">规律：CPU、GPU 两条线</text>
<rect x="392" y="36" width="118" height="200" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="451" y="56" text-anchor="middle" font-size="11" fill="var(--ink)">标称</text>
<text x="451" y="72" text-anchor="middle" fill="var(--ink-faint)">W3 · Day 28</text>
<text x="398" y="96" fill="var(--ink-soft)">· 624 当 312</text>
<text x="398" y="112" fill="var(--ink-soft)">· fp32 比 fp16 标称</text>
<text x="398" y="128" fill="var(--ink-soft)">· 矩阵太小打不满</text>
<text x="398" y="144" fill="var(--ink-soft)">· 张量小于 L2</text>
<text x="398" y="160" fill="var(--ink-soft)">· SXM/PCIe 看串</text>
<text x="398" y="176" fill="var(--ink-soft)">· boost 时钟当常态</text>
<text x="398" y="192" fill="var(--ink-soft)">· 追 100%</text>
<text x="398" y="222" fill="var(--compute)">规律：先问怎么算出来的</text>
<rect x="520" y="36" width="112" height="200" fill="var(--paper-raised)" stroke="var(--rule)" stroke-width="1.5"/>
<text x="576" y="56" text-anchor="middle" font-size="11" fill="var(--ink)">计费</text>
<text x="576" y="72" text-anchor="middle" fill="var(--ink-faint)">W4</text>
<text x="526" y="96" fill="var(--ink-soft)">· stop 当 delete</text>
<text x="526" y="112" fill="var(--ink-soft)">· 开 auto-pay</text>
<text x="526" y="128" fill="var(--ink-soft)">· 先销毁再推结果</text>
<text x="526" y="144" fill="var(--ink-soft)">· 手动记账</text>
<text x="526" y="160" fill="var(--ink-soft)">· 贵卡上调脚本</text>
<text x="526" y="176" fill="var(--ink-soft)">· token 进 git</text>
<text x="526" y="192" fill="var(--ink-soft)">· 只比小时价</text>
<text x="526" y="222" fill="var(--ink-soft)">规律：靠机制不靠记性</text>
<text x="8" y="254" fill="var(--ink-faint)">前两类是数学地基，第三类是 GPU 的工作方式，第四类是对厂商数字的态度，第五类是对自己记性的态度。</text>
</g>
</svg>
<figcaption>全月错题按根源归成五类。形状和单位是 W1 埋下的地基问题，后面每周都会换个地方冒出来；异步是 GPU 的工作方式，不理解它所有计时都是假的；标称是对厂商数字的态度问题；计费是对自己记性的态度问题。</figcaption>
</figure>

### 形状：向量和矩阵没分开

根源是 W1 第一天就暴露的：向量是一排数字只有长度，矩阵是一张表有行有列，矩阵形状永远是「输入长度 × 输出长度」。这条没落地时犯的错：

- 一个头的 q 向量答成 128 × 128，W^v 也答成 128 × 128（Day 3、Day 6）。q 是向量，长 4096 ÷ 32 = 128；W^v 要把 4096 长的向量变成 128 长，是 4096 × 128。
- 把 FFN 宽度 13824 代进 KV cache 公式（Day 6）。KV cache 存的是 k、v 向量，长度是 d，d_ff 只出现在参数量和激活里。
- 「attention 混合的是关系」（Day 3）。混合的是 v 的内容，相似度只是权重。
- 「为什么不缓存 q」答成「每次的 q 都不一样」（Day 4）。真正的原因是旧 k、v 每步都被查，旧 q 用过即弃。
- GQA 模型用 d 算 KV cache（Day 4、Day 6、Day 7）。要用 n_kv × d_head，差的倍数正好是 h ÷ n_kv。

这一类到 W2 之后就没再犯，因为 Day 10 用 profiler 数出一步 155 个 gemm 和 Day 2 数的矩阵对上了，形状这件事从纸上变成了 trace 里能数的东西。

### 单位：字节、位、Mbps、GB 与 GiB

根源是算式里的量没带单位就开始乘除。这个月出现的面目：

- 测带宽只算读没算写，带宽少一半（Day 13、Day 15）。`y = x + 1` 搬的是 x 加 y。
- 算 FLOP 忘了乘 2，一次乘加是 2 FLOP（Day 4、Day 15）。matmul 是 2MNK 不是 MNK，这个 2 在算术强度里约不掉。
- 房东标的 200 Mbps 当成 200 MB/s，下载时间少算 8 倍（Day 20）。
- 「4-bit 模型」按 0.5 字节算显存，漏了每组一个 fp16 scale，实际 4.1 到 4.5 位（Day 26）。
- 13.5 GB 和 14 GB 是同一个数按 1000 还是 1024 进制的两种舍入（Day 5）。
- 位数 ÷ 8 才是字节数，fp16 是 2、int8 是 1、int4 是 0.5（Day 2）。

对策只有一条：算式每一项先写单位再动笔，FLOP、byte、s 三个量纲对上再约。

### 异步：CPU 和 GPU 是两条时间线

根源是 Day 8 讲的那件事，CPU 把 kernel 塞进 stream 就往下走，GPU 在后面慢慢消化。不理解这条会在很多地方摔：

- 不 synchronize 就用 `time.perf_counter()` 计时，测到的是提交时间，可以比真实时间小几个数量级（Day 8、Day 13、Day 14）。
- 把第一次运行的时间当典型值，第一次里一大半是 CUDA context 和 kernel 挑选（Day 7）。
- 看到 nvidia-smi 的 GPU-Util 100% 就觉得算力用满了，它只说「有 kernel 在跑」，decode 时 100% 和算力利用率 1% 同时成立（Day 5、Day 11、Day 19）。
- 「加 batch 时间不变」直接判成 memory-bound，overhead-bound 也是这个症状，要看 timeline 有没有空白（Day 11、Day 16）。
- 用换更快的 GPU 治 gap，gap 由 CPU 决定，快卡让 gap 更宽（Day 11、Day 27）。
- 生产代码里到处 `.item()` 打日志，每次都切断 GPU 队列（Day 8）。
- 拿 profiler 的绝对时间当性能数字，profiler 自己有开销，看比例用 profiler，报数字用 Event（Day 10）。

Day 27 把这条追到了物理来源：launch 是按 kernel 个数收的固定税，约 10 µs 一次，decode 一步 400 次就是 4 ms，不随 batch 变。

### 标称：先问这个数是怎么算出来的

根源是把厂商规格表上的数当成能达到的数，或者拿错了行。这个月的面目：

- 拿 624 当 A100 的峰值，那是 2:4 稀疏的数，正常模型用不上，用它 ridge 会算成 306（Day 14、Day 28）。
- 用 fp32 的实测比 fp16 的标称，或反过来，19.5 和 312 差 16 倍（Day 14、Day 17、Day 28）。
- 矩阵太小打不满就说卡不行，N/3 低于 ridge 时它本来就是 memory-bound 的（Day 14）。
- 测带宽的张量小于 L2，测出超过标称的漂亮数字，其实测的是 L2（Day 13、Day 25）。
- SXM 和 PCIe 的规格看串行，A100 带宽 2039 对 1935，H100 差得更多（Day 28）。
- 按 boost 时钟算峰值然后责怪 kernel，满载降频 10 到 15% 是常态（Day 25、Day 17）。
- 优化到接近标称还不停，实测屋顶才是能到的地方，剩下的是功耗墙（Day 17）。
- 把 ridge point 高当成好事，它描述卡的性格不是分数，对 decode 来说越高越远（Day 25、Day 28）。

Day 25 和 Day 28 给了对策：任何 TFLOPS 都反问三件事，多少个 SM、每 SM 每时钟多少次乘加、什么时钟；任何带宽都反问总线多宽、每线多快。乘不出来的部分就是营销。

### 计费：靠机制，不靠记性

根源是 Day 22 那句话，靠记性的方案失败是确定的，只是时间未定。这个月的面目：

- 用 stop 代替 delete，磁盘照收费、卷盘费率还翻倍、重启不保证有 GPU（Day 19、Day 20、Day 22）。
- 绑卡开 auto-pay，让「只充 10 到 20 美元」这道最后保险失效（Day 19、Day 22）。
- trap 里先销毁再推结果，一小时的实验随实例消失（Day 22、Day 23）。
- 手动记账，三天必断（Day 23）。
- 在 A100 上调脚本，一小时里一半时间是在等 debug（Day 21、Day 23）。
- token 写进脚本「先跑通再说」然后 push 出去（Day 20、Day 21）。
- 只比小时价不比每美元买到的带宽、流量费、可靠性（Day 19、Day 23）。
- 看门程序开 `set -e`，一次 nvidia-smi 超时就让第二层静默消失（Day 22）。

这一类和前四类性质不同：前四类是知识，学会了就不会再犯；这一类是习惯，每次开机都要重新对抗一次。所以对策不是「记住」，是脚本、cron、余额上限三层机制。

## M1 结束时我能回答什么

Day 0 给 M1 列的目标和路线图的四周验收，逐条对：

| Day 0 / 路线图要求 | 状态 | 依据 |
| --- | --- | --- |
| 能回答「7B 模型推理时显存到底花在哪」 | 已达成 | 四项账、batch 32 × 2048 的饼、13B 与 Llama-3-8B 重算（Day 5、Day 6） |
| 能解释「为什么增大 batch 有时几乎不增加延迟」 | 已达成 | 搬权重固定成本 6.6 ms，算力藏在里面，到 153 才追上；「有时」的例外是 KV 字节和显存上限（Day 5、Day 16） |
| 能指出哪个 op 最耗时、为什么 | 方法达成，数字待填 | kernel 名到模型部件的映射、155 次 gemm 对账、gap 的两种治法（Day 10、Day 11）；真机 trace 待抓 |
| 自己画的 roofline 图加实测点 | 方法达成，数字待填 | 参数化脚本、AI(b) 公式、三段距离的含义（Day 15、Day 16）；实测带宽算力待测 |
| 一条命令起环境，跑完自动销毁 | 脚本达成，验收待做 | bootstrap、三层销毁、账本三套脚本（Day 21 到 23）；两次真机验收待触发 |
| 建立一辈子受用的性能直觉，一行 kernel 不写 | 已达成 | 四条算法 + 五类错题根源；确实一行 kernel 没写 |
| W1 零成本 | 已达成 | 纸笔加免费 Colab |
| 成本纪律：月 30 到 60 美元、跑完销毁 | 机制已建 | 三层销毁 + 账本 + 只预充值不绑卡（Day 22、Day 23） |

三个「待填」是同一件事：W2 到 W4 的文章先于真机写完，记录表还空着。这是 M2 第一周的第一个任务，也是 Day 6 里那句「算不出数字就是没过」在 M1 尾巴上的回响：方法全对，数字没有，就还差最后一步。

除了目标之外，这个月还多出三样 Day 0 没列的东西。一是加餐周把硬件、格式、执行模型、规格表四个黑箱打开了，M5 学 Triton 时 `tl.program_id` 那行不再是咒语。二是 Day 29 用真实 JD 校准了路线，加了六个勾，改了两个预期：薪资从头部校到主流，「海外远程不难」这个念头掐掉了。三是这个系列本身，三十篇、每篇有图有算式有自测有错题，是 M8 之前唯一能对外展示的东西。

## 参考资料

M1 反复回去查的几样，加上 M2 开工前要先扫一眼的几篇。全部 curl 核对过。

### M1 的核心资料

- Horace He，《Making Deep Learning Go Brrrr From First Principles》。整个 M1 的起点，三种瓶颈的出处，现在回头读会发现每一句话都在这三十天里变成了一个数字。https://horace.io/brrr_intro.html
- Kipply，《Transformer Inference Arithmetic》。W1 的账在这篇里有更严谨的版本，对账用。https://kipp.ly/transformer-inference-arithmetic/
- Lilian Weng，《Large Transformer Model Inference Optimization》。从显存和带宽出发的推理优化全景，M1 结束读正好，M2 每周都会回来翻。https://lilianweng.github.io/posts/2023-01-10-inference-optimization/
- GPU MODE lectures 仓库。第 1 讲 profiler、第 4 讲 compute/memory 基础、第 8 讲性能清单是 W2、W3 用过的，M5 起系统看。https://github.com/gpu-mode/lectures
- Stanford CS336 Language Modeling from Scratch，2025 春季课程主页。M1 到 M10 的深度主线，先看 1 到 3、5 到 8、10 讲。https://stanford-cs336.github.io/spring2025/
- ZOMI 酱《AIInfra》开源课文档。中文补充，M2 按模块 05 大模型推理往下看。https://infrasys-ai.github.io/aiinfra-docs/
- Andrej Karpathy，Zero to Hero 系列主页。《Let's build GPT》是 W1 形状问题的解药，M2 之前如果还没看完，先看完。https://karpathy.ai/zero-to-hero.html

### M2 开工前预读

- vLLM 论文，《Efficient Memory Management for Large Language Model Serving with PagedAttention》，arXiv 2309.06180。W6 读 scheduler 之前先读它的引言和第 2 节，Day 5 第二题和 Day 16 的 AI_max 就是它要解决的问题。https://arxiv.org/abs/2309.06180
- Anyscale，《How continuous batching enables 23x throughput in LLM inference》。W6 的时序图从这篇开始画。https://www.anyscale.com/blog/continuous-batching-llm-inference
- Leviathan 等，《Fast Inference from Transformers via Speculative Decoding》，arXiv 2211.17192。W7+ 那个勾的原始论文，用 Day 5 的框架读：一次搬权重验证多个 token 等于变相提高算术强度。https://arxiv.org/abs/2211.17192
- GPTQ，arXiv 2210.17323；AWQ，arXiv 2306.00978。W7 量化三角要跑的两种方案，现在只读摘要，看它们各自怎么对付 Day 26 练习第 6 步那个 outlier。https://arxiv.org/abs/2210.17323 与 https://arxiv.org/abs/2306.00978
- HuggingFace Transformers 文档，Quantization overview。W7 选方案前看的一页对比。https://huggingface.co/docs/transformers/main/en/quantization/overview
- vLLM 文档与 SGLang 文档。M3 主线和 W10+ 对照读的两个引擎，现在只看首页知道它们是什么。https://docs.vllm.ai 与 https://docs.sglang.ai
- RunPod 价格页。M2 第一次真租 A100 之前重查一次价格，Day 23 的账本口径要带日期。https://www.runpod.io/pricing

### 视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/SQ3fZ1sAqXI" title="Stanford CS336 Language Modeling from Scratch | Spring 2025 | Lecture 1: Overview and Tokenization" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Stanford Online · CS336 Lecture 1: Overview and Tokenization。M1 结束、M2 开始之间正好看第 1 讲：前半是「为什么要从零写一遍」，他说不自己算过资源账就没法做设计决策，这句话就是 M1 三十天在做的事；后半 tokenizer 接 Day 2 的 BPE。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kCc8FmEb1nY" title="Let's build GPT: from scratch, in code, spelled out." loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · Let's build GPT: from scratch, in code, spelled out。M1 五类错题里「形状」那一类的解药：self-attention 那一段每个 tensor 的形状都写在注释里，配合 bbycroft 的 3D 图看，W1 的错题一和错题三就不会再犯。M2 开工前要看完。</figcaption>
</figure>

## M2 预告

M1 建的是判断力，M2 开始用它。路线图给 M2 的一句话是：每一项都要自己测出数据，不能只读文章，这个月结束时应该能解释清楚 vLLM 为什么快。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="M1 到 M2 的衔接：M1 的每个结论在 M2 里对应一次实测">
<g font-family="var(--font-mono)" font-size="10">
<text x="8" y="18" font-size="12" fill="var(--ink)">M1 说过的每句话，M2 都要上机验一次</text>
<text x="8" y="44" fill="var(--ink-faint)">M1 结论</text>
<text x="380" y="44" fill="var(--ink-faint)">M2 实测</text>
<rect x="8" y="54" width="330" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="16" y="73" fill="var(--ink)">KV cache 让旧 token 的 k/v 不重算（Day 4）</text>
<rect x="380" y="54" width="252" height="30" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="388" y="73" fill="var(--ink)">W5 · 关掉/开启 KV cache 对比延迟与显存</text>
<line x1="338" y1="69" x2="380" y2="69" stroke="var(--ink-faint)" stroke-width="1.5"/>
<rect x="8" y="92" width="330" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="16" y="111" fill="var(--ink)">GQA 用 n_kv·d_head 代替 d（Day 4、6）</text>
<rect x="380" y="92" width="252" height="30" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="388" y="111" fill="var(--ink)">W5+ · GQA 重算 + MoE 的「激活参数」</text>
<line x1="338" y1="107" x2="380" y2="107" stroke="var(--ink-faint)" stroke-width="1.5"/>
<rect x="8" y="130" width="330" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="16" y="149" fill="var(--ink)">batch 把强度从 1 往 153 拉，KV 是天花板（Day 5、16）</text>
<rect x="380" y="130" width="252" height="30" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="388" y="149" fill="var(--ink)">W6 · 静态 vs continuous batching，读 scheduler</text>
<line x1="338" y1="145" x2="380" y2="145" stroke="var(--ink-faint)" stroke-width="1.5"/>
<rect x="8" y="168" width="330" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="16" y="187" fill="var(--ink)">量化 = 省字节，int4 上限 586 tok/s（Day 26）</text>
<rect x="380" y="168" width="252" height="30" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="388" y="187" fill="var(--ink)">W7 · GPTQ/AWQ 精度-速度-显存三角</text>
<line x1="338" y1="183" x2="380" y2="183" stroke="var(--ink-faint)" stroke-width="1.5"/>
<rect x="8" y="206" width="330" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="16" y="225" fill="var(--ink)">三十篇学习日志，全是给自己看的</text>
<rect x="380" y="206" width="252" height="30" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="388" y="225" fill="var(--ink)">W8 · 第一篇发出去的公开技术帖</text>
<line x1="338" y1="221" x2="380" y2="221" stroke="var(--ink-faint)" stroke-width="1.5"/>
</g>
</svg>
<figcaption>M1 到 M2 的衔接。左列是 M1 用纸笔得出的结论，右列是 M2 要用真机把它们各验一次。最后一行不同：M1 的三十篇是学习日志，M2 结束时要交的是一篇写给别人看的文章。</figcaption>
</figure>

M2 四周加两个勾：

**W5，KV cache 从原理到实测。** Day 4 讲了它为什么能缓存，Day 5 算了它有多大，Day 16 推出它是 batching 的天花板。W5 上机把 `use_cache` 关掉和开启各跑一遍，对比延迟和显存。预期是关掉后每步 decode 要重算前面所有 token 的 k、v，时间随序列长度线性涨，长序列下差一个数量级；显存那边关掉反而省 KV cache 但多了激活。产出是数据加解释为什么差这么多。

**W5+，GQA 与 MoE。** Day 29 加的第一个勾。GQA 在 M1 已经算过三次（Llama-3-8B 128 KB、TinyLlama 22.5 KB、自测第 1 题 144 KB），W5+ 只补 MoE：FFN 拆成多个 expert，每个 token 只走其中几个，总参数 100B 以上但每 token 只搬十几 B 的权重。用 Day 5 的框架看，MoE 改的是 decode 每步「要搬的字节」这个分子，和量化是同一个方向的两条路。ZOMI 模块 6.2 正好。

**W6，静态 batching 的问题与 continuous batching。** Day 5 说 batch 免费，Day 16 说 KV 字节让它不完全免费，Day 11 说 batch 还能填 gap。W6 看的是另一个问题：一批请求长短不一，静态 batching 要等最长的那个跑完才能进下一批，GPU 大半时间在算 padding。continuous batching 让请求随到随进、随完随出。读 vLLM 的 scheduler 看它每一步怎么选下一批，产出是自己画的请求时序图。这是 M1 说过的「KV cache 是 batch 的天花板」在调度层面的解法。

**W7，量化初步。** Day 26 把格式讲完了，也算了 int8 302、int4 586 tok/s 的上限。W7 跑 GPTQ 或 AWQ 版本的 7B，测精度、速度、显存三角。Day 26 埋的两个坑到时候要验：一是 prefill 不会快甚至变慢，因为反量化是额外计算；二是 batch 大了收益缩水。精度用 perplexity 加真实任务两种都测。产出是对比表。

**W7+，speculative decoding。** Day 29 加的第二个勾。不实测，读 vLLM 的实现：小模型先猜几个 token，大模型一次验证。用 Day 5 的框架讲清它为什么能加速 memory-bound 的 decode：搬一遍权重验证多个 token，等于变相提高算术强度，接受率决定收益。

**W8，第一篇公开技术帖。** 整合前七周的东西，发出去，不是草稿。这是路线图上 M1 到 M2 唯一的对外产出物，也是 Day 29 说的「社区可见度」的第一步。M1 的三十篇是给自己复习的，W8 那篇要写给没读过这三十篇的人看。

M2 和 M1 的关系一句话：M1 每算出一个数，M2 就要用真机测一次那个数对不对。Day 9 那个比值是第一个，W5 到 W7 的三张对比表是后三个。M1 说的话如果 M2 测不出来，错的是 M1，回来改。

M1 结束。一行 kernel 没写，路线图说的没错，也不该写。但记录表还空着，M2 第一天先去 Colab 把它们填满，再开始 W5。
