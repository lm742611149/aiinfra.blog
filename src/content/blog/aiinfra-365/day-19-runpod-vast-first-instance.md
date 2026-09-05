---
title: 'Day 19 · 第一次租 GPU:RunPod / Vast 开 spot 实例，SSH 进去看 nvidia-smi'
description: 'W4 第一天，从免费 Colab 换到按秒计费的租卡。两家平台怎么选、便宜的可中断实例到底便宜在哪、选哪张卡要先算显存再看价，以及第一次 SSH 进去必须做的三件事。全程只充 10 到 20 美元。'
pubDate: 2026-09-17
regime: none
tags: ['runpod', 'vast', 'nvidia-smi', 'cost', 'aiinfra-365']
series: 'aiinfra-365'
day: 19
lang: 'zh'
---

## 今天要解决的问题

前三周所有实测都在 Colab 的免费 T4 上做。T4 够用是够用,但它有三条限制在 W3 已经撞到了:16 GB 显存装不下 7B fp16 的 13.5 GB 权重;320 GB/s 的带宽只有 A100 的六分之一,decode 的每个数都要重算一遍口径;而且会话会断连、会换卡型,前后两天的数字不能直接比。W5 起要做 KV cache 开关对比、batch 扫到 128、量化三角,这些实验需要一张自己能控制的卡。

所以 W4 全周不碰模型,只干一件工程活:把「租一张卡、跑完、销毁」变成一条命令。今天是第一步,目标很小:

1. 搞清 RunPod 和 Vast 两家的差别,以及「spot」「interruptible」这些便宜实例到底是什么、被抢占时会发生什么。
2. 用 W1 的显存算式决定该租哪张卡,不是看广告。
3. 只充 10 到 20 美元,不绑自动续费,起一台实例,SSH 进去,把 `nvidia-smi` 的每一格读懂。
4. 记下三件事:卡型、驱动与 CUDA 版本、实测带宽是不是和标称对得上。然后**销毁**,不是停机。

今天结束时账户里应该还剩 18 美元以上。花掉的那一两美元买的是「知道按钮在哪」。

## 两家怎么选:RunPod 和 Vast 的结构不一样

两家都是租 GPU 的,但商业结构完全不同,这决定了价格、可靠性和坑在哪。

**RunPod** 是自己运营或签约数据中心,统一定价。控制台里分 Secure Cloud(数据中心级机器)和 Community Cloud(合作方机器,便宜一档)。计费按秒,文档写明不收流入流出流量费。2026 年 9 月查文档,Pods 的计费方式只有两种:On-demand(按用付费,资源独占)和 Savings plan(预付 3 或 6 个月换折扣)。**曾经的 Spot 实例在当前文档和价格页里已经找不到了**,这一点和一年前的攻略不一样,别照旧文照做。

**Vast.ai** 是一个市场。房东(host)把自己的机器挂上来自己定价,从数据中心到个人矿机都有,所以同一张 RTX 4090 的报价能差四倍。计费同样按秒,但**存储和流量都要另外收钱**,每个房东的费率不同。实例分三种:On-demand(固定价、高优先级)、Reserved(预付折扣)、Interruptible(出价制、最便宜、可能被暂停)。

| 维度 | RunPod | Vast.ai |
| --- | --- | --- |
| 结构 | 平台统一定价,Secure / Community 两档 | 市场,房东各自定价 |
| 计费粒度 | 按秒 | 按秒 |
| 流量费 | 不收 | 收,上传下载都按 GB 计,房东自定 |
| 存储费 | 固定费率,停机后仍收 | 房东自定,停机后仍收,通常比运行时贵 |
| 便宜的可中断实例 | 文档里已无 Spot(2026-09) | Interruptible,出价制 |
| 机器质量 | 均一 | 参差,看房东的 reliability 分 |
| 余额归零时 | 停机;无 network volume 的 Pod 直接销毁 | 停机;没绑卡则排期删除实例和数据 |
| CLI | `runpodctl` | `vastai`(pip 装) |
| 起步余额要求 | 部署 on-demand 需至少 1 小时的余额 | 先充值才能开机 |

结论先说:**RunPod 适合第一次,Vast 适合省钱**。RunPod 的机器和网络稳定,坑少,先在它上面把流程跑通;流程稳了之后,长时间的实验换到 Vast 出价便宜一半。今天两家都注册,但只在 RunPod 真开一台。

## 还有哪些选项,为什么不选

租 GPU 的地方不止这两家。把常见的几种摆在一起,说清楚为什么这条路线只留 RunPod 和 Vast:

| 选项 | 计费方式 | 有没有 24 GB 消费卡 | 起步门槛 | 为什么不作为主力 |
| --- | --- | --- | --- | --- |
| Colab 免费 | 免费,有配额 | 只有 T4(16 GB) | 无 | W1 到 W3 已经用完它的价值:16 GB 装不下 7B,不支持 bf16,会断连换卡 |
| Colab Pro | 按月订阅,消耗 compute unit | 有 A100 / L4,拿到哪张看运气 | 月费 | 卡型不可控,compute unit 折算不透明,不适合需要固定口径的实验 |
| Lambda 之类的 GPU 云 | 按小时 | 没有,只有 A100 / H100 级 | 常缺货,部分要预约 | 卡贵、没有消费卡,对 memory-bound 的实验每美元买到的带宽最少 |
| AutoDL 之类的国内平台 | 按小时,人民币 | 有 3090 / 4090,便宜 | 国内实名 | 两个问题:访问 Hugging Face 要走镜像,以及以后要写进英文简历和海外社区时,实验环境和目标岗位的工具链脱节 |
| 阿里云、腾讯云、AWS 等大厂云 | 按小时,但起步实例贵,常要包月才划算 | 基本没有 | 账号、配额审批 | 单卡实验用不到它们的优势(网络、合规、多卡互联),价格是 RunPod 的两三倍 |
| RunPod | 按秒 | 有 | 充 10 美元 | 主力,流程稳、坑少 |
| Vast.ai | 按秒 | 有,而且最便宜 | 充 10 美元 | 省钱用,机器参差要过滤 |

筛选标准就三条:**按秒计费**(实验一次十几分钟,按小时计费浪费一半)、**有 24 GB 消费卡**(Day 5 的结论,memory-bound 实验的性价比在消费卡上)、**没有月费和承诺**(月预算 30 到 60 美元,任何固定支出都是负担)。两家同时满足,别的都缺一条。

AutoDL 要多说一句,因为它对国内用户确实方便。它的 4090 小时价换算成美元比 RunPod 便宜,界面全中文。没选它是路线原因不是它不好:这条路的出口一是海外远程,简历和社区帖子里写的环境要和目标读者的一致,RunPod、Vast、Lambda 是海外社区默认的词汇;另外国内平台访问 Hugging Face 要配 `HF_ENDPOINT=https://hf-mirror.com` 这样的镜像,多一层和主线无关的环境差异。如果预算实在紧,W5 到 W7 的实验在 AutoDL 上做结果也是一样的,数字不会因为平台不同而变。

## 便宜的那种叫什么,被抢占时会发生什么

路线图里写的「spot」是云计算的通用叫法:云厂商把闲置算力便宜卖给你,但有人出正价的时候随时收回。这个概念在两家的具体形态不同。

RunPod 现在没有这个档位。它的便宜法是 Community Cloud(比 Secure 便宜两三成)和 Savings plan。所以在 RunPod 上「跑完立刻销毁」是唯一的省钱手段,没有抢占风险,也没有抢占折扣。

Vast 的 Interruptible 是**出价制**:你对一台机器出一个每小时的价,高于当前最低出价就能拿到;别人出价更高或者有人以 on-demand 价格租了这台机器,你的实例就被**暂停**(不是销毁)。暂停期间 GPU 被拿走、进程被冻结,但容器盘保留,存储费照收;等价格回落你的实例会恢复运行。文档说 interruptible 通常比 on-demand 便宜 50% 以上;我用公开报价接口查了一下 2026 年 9 月初的实际数据,单卡 RTX 4090 的 on-demand 中位价约 0.37 美元/小时,最低出价中位约 0.27 美元/小时,差 27%;A100 SXM on-demand 中位 0.83,最低出价 0.47,差 43%。便宜是真便宜,但没有广告里那么夸张。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="on-demand 与 interruptible 实例的时间线对比:on-demand 连续运行;interruptible 中途被更高出价者顶掉,暂停一段后恢复,期间容器盘仍在计费">
<text x="16" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">同一个 2 小时任务,两种实例的时间线</text>
<text x="16" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">on-demand</text>
<rect x="110" y="48" width="440" height="22" rx="2" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="120" y="63" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">GPU 连续运行 2h · 固定价 · 不会被打断</text>
<text x="16" y="122" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">interruptible</text>
<rect x="110" y="108" width="170" height="22" rx="2" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="118" y="123" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">运行 · 出价 $0.27/h</text>
<rect x="280" y="108" width="130" height="22" rx="2" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<text x="288" y="123" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">被顶掉,暂停</text>
<rect x="410" y="108" width="200" height="22" rx="2" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="418" y="123" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">恢复 · 进程从冻结处继续</text>
<line x1="280" y1="100" x2="280" y2="138" stroke="var(--ink)" stroke-width="1.5"/>
<text x="286" y="150" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">有人出价 $0.40/h</text>
<rect x="110" y="168" width="500" height="14" rx="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="118" y="179" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">容器盘全程存在,存储费全程计,包括暂停那 40 分钟</text>
<text x="16" y="215" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">暂停时:GPU 被拿走、进程冻结、显存里的东西全没了;盘上的文件还在。</text>
<text x="16" y="232" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">所以 interruptible 只适合「中断了重跑也不心疼」的任务,并且结果要边跑边落盘。</text>
</svg>
<figcaption>Vast 的 interruptible 实例被更高出价顶掉时是暂停不是销毁。显存内容丢失、磁盘保留、存储费照收,恢复后进程从冻结处继续。这决定了哪些任务能放上去。</figcaption>
</figure>

被抢占时具体丢什么:显存里的一切(模型权重、KV cache、正在算的张量)全没了,恢复后 Python 进程会从冻结处继续,但它以为还在显存里的东西已经不在,大多数情况下程序会报 CUDA 错误退出。磁盘上的文件不丢。所以放到 interruptible 上的任务必须满足两条:重跑不心疼,结果边跑边写盘。W5 到 W7 的实验都符合,一次 batch 扫描十几分钟,断了重跑就是。

W4 剩下几天里,Day 22 的自动销毁要专门处理「被抢占之后实例还挂着计存储费」这一种情况。今天先知道有这么回事。

### Community 还是 Secure

RunPod 部署页顶上那两个开关,今天选 Community Cloud。两档的差别是机器来源:Secure 是 RunPod 自己或签约数据中心的机器,Community 是合作方的机器,同一张 4090 便宜两三成。对我们的实验,数据是公开模型和自己的脚本,没有合规要求;机器偶尔换一台,数字也不会变,因为记录表里第一行就记了卡型和驱动。Secure 留给以后需要稍长时间稳定跑、或者要 network volume 的场合,网络卷只在部分数据中心提供。

### 把 Vast 的出价用对

真到 Vast 上走 interruptible 时,出价不是越低越好。规则是**比当前 `min_bid` 高一点点**,比如高 10%:出得太低,别人一抬价你就被顶掉,一晚上暂停三次比多付 10% 贵得多,因为每次暂停都要重新加载模型;出得太高,就失去了走 interruptible 的意义,不如直接 on-demand。判断一台机器适不适合出价,看 `dph_total` 和 `min_bid` 的差:差 30% 以上值得出价,差 10% 以内直接 on-demand。

被顶掉之后的收尾也要提前想。暂停的实例不会自己恢复到你面前,它挂在列表里等价格回落,期间存储费照收。所以 Day 22 的规则里要有一条:实例进入暂停状态超过 30 分钟就销毁。结果已经边跑边落盘、大文件已经推走,重开一台的成本是两分钟重下,不是丢数据。

## 选哪张卡:先算显存,再看带宽,最后看价

广告页按算力排序,但我们的 workload 在 Day 5 已经定性了:decode 是 memory-bound,速度上限 = 带宽 ÷ 权重字节数。所以选卡的顺序是:显存装得下 → 带宽决定快慢 → 每小时价格决定每美元能买多少 token。

先算装得下。7B fp16 权重 13.5 GB,框架开销 1.5 GB,剩下的全给 KV cache,每 token 512 KB:

```
24 GB 卡:(24 − 13.5 − 1.5) GB ÷ 512 KB/token ≈ 9 GB ÷ 0.5 MB ≈ 18,000 token
  → batch 8 × 2048 = 16,384 token,勉强;batch 16 × 2048 装不下
80 GB 卡:(80 − 13.5 − 1.5) GB ÷ 512 KB/token ≈ 130,000 token
  → batch 64 × 2048 = 131,072 token,正好
```

所以 W5 的 KV cache 开关对比、W7 的量化三角,24 GB 的卡够;Day 16 那种扫到 batch 128 的实验,7B 要 80 GB 的卡,或者换回 TinyLlama 在 24 GB 上扫。M3 的 2 卡张量并行实验才需要 A100。

再看带宽。用 Day 5 的公式算每张卡上 7B fp16 batch 1 的 decode 上限,以及 ridge point:

| 卡 | 显存 | 带宽 GB/s | fp16 tensor 峰值 TFLOP/s(dense) | ridge point | 7B decode 上限 tok/s | bf16 |
| --- | --- | --- | --- | --- | --- | --- |
| T4(Colab 免费) | 16 GB | 320 | 65 | 203 | 装不下 | 不支持 |
| RTX 3090 | 24 GB | 936 | 71 | 76 | 69 | 支持 |
| RTX 4090 | 24 GB | 1008 | 165 | 164 | 75 | 支持 |
| L4 | 24 GB | 300 | 121 | 403 | 22 | 支持 |
| A100 80GB PCIe | 80 GB | 1935 | 312 | 161 | 143 | 支持 |
| A100 80GB SXM | 80 GB | 2039 | 312 | 153 | 150 | 支持 |
| H100 80GB SXM | 80 GB | 3352 | 989 | 295 | 248 | 支持 |

decode 上限那列就是 2039 ÷ 13.5 那个除法换卡重算。L4 那一行值得看一眼:它和 3090、4090 同样 24 GB、价格也相近,但带宽只有 300 GB/s,decode 上限 22 tok/s,是 4090 的三分之一。**同显存不同带宽,memory-bound 的任务差三倍**,这是 Day 5 的结论第一次在价格表里显形。

最后看价。RunPod 价格页 2026 年 9 月查到的 on-demand 大致价格,和 Vast 公开报价接口同期查到的单卡 on-demand 区间(最低到中位数):

| 卡 | RunPod on-demand 美元/小时 | Vast on-demand 美元/小时(最低 ~ 中位) | 每美元每小时买到的 7B decode tok/s |
| --- | --- | --- | --- |
| RTX 3090 | ~0.50 | 0.07 ~ 0.15 | RunPod 138 / Vast 中位 460 |
| RTX 4090 | ~0.74 | 0.14 ~ 0.37 | RunPod 101 / Vast 中位 203 |
| L4 | ~0.49 | 0.13 ~ 0.33 | RunPod 45 |
| A100 80GB PCIe | ~1.39 | 0.27 ~ 0.94 | RunPod 103 |
| A100 80GB SXM | ~1.59 | 0.34 ~ 0.83 | RunPod 94 / Vast 中位 181 |
| H100 80GB SXM | ~3.29 | 1.34 ~ 2.07 | RunPod 75 |

价格以官网实时为准,这张表只是量级。最后一列是 decode 上限 ÷ 小时价,单位是「每小时花一美元能换到多少 tok/s」。它说的是:**对 memory-bound 的推理实验,消费卡的性价比远高于数据中心卡**。3090 每美元买到的带宽是 H100 的近两倍。H100 贵在算力和 NVLink,那是 prefill 和多卡训练的事,M9 之前用不上。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="七张卡按显存带宽和 RunPod 小时价摆放的散点示意:3090 与 4090 在便宜且带宽较高的位置,L4 便宜但带宽低,A100 与 H100 带宽高但价格高">
<text x="16" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">显存带宽 vs 小时价(RunPod on-demand,2026-09 量级)</text>
<line x1="70" y1="250" x2="610" y2="250" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="70" y1="250" x2="70" y2="40" stroke="var(--rule)" stroke-width="1.5"/>
<text x="330" y="282" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)" text-anchor="middle">美元/小时 →</text>
<text x="24" y="150" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)" transform="rotate(-90 24 150)" text-anchor="middle">带宽 GB/s ↑</text>
<text x="70" y="265" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)" text-anchor="middle">0</text>
<text x="205" y="265" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)" text-anchor="middle">1</text>
<text x="340" y="265" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)" text-anchor="middle">2</text>
<text x="475" y="265" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)" text-anchor="middle">3</text>
<text x="610" y="265" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)" text-anchor="middle">4</text>
<text x="62" y="253" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)" text-anchor="end">0</text>
<text x="62" y="193" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)" text-anchor="end">1000</text>
<text x="62" y="133" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)" text-anchor="end">2000</text>
<text x="62" y="73" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)" text-anchor="end">3000</text>
<circle cx="136" cy="232" r="5" fill="var(--mem)"/>
<text x="146" y="236" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">L4 · 300</text>
<circle cx="137" cy="194" r="5" fill="var(--mem)"/>
<text x="147" y="190" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">3090 · 936</text>
<circle cx="170" cy="190" r="5" fill="var(--mem)"/>
<text x="180" y="204" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">4090 · 1008</text>
<circle cx="258" cy="134" r="5" fill="var(--compute)"/>
<text x="268" y="138" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">A100 PCIe · 1935</text>
<circle cx="285" cy="128" r="5" fill="var(--compute)"/>
<text x="295" y="122" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">A100 SXM · 2039</text>
<circle cx="514" cy="49" r="5" fill="var(--compute)"/>
<text x="524" y="53" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">H100 SXM · 3352</text>
<line x1="70" y1="250" x2="285" y2="128" stroke="var(--ink-faint)" stroke-width="1" stroke-dasharray="3 3"/>
<text x="180" y="150" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">虚线上方 = 每美元带宽更多</text>
<rect x="400" y="180" width="200" height="56" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="410" y="198" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">● 24 GB 消费卡 / L4</text>
<text x="410" y="214" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">● 80 GB 数据中心卡</text>
<text x="410" y="230" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">价格以官网实时为准</text>
</svg>
<figcaption>横轴是小时价,纵轴是显存带宽。decode 是 memory-bound,所以每美元买到的带宽才是这周的性价比。3090 和 4090 落在虚线上方,L4 便宜但带宽垫底,H100 的钱花在带宽以外的东西上。</figcaption>
</figure>

今天的决定:**第一次开机租 RTX 4090 或 3090,24 GB**。一小时不到一美元,W5 到 W7 全部实验都装得下,bf16 支持,带宽是 T4 的三倍,重算所有口径时顺手就能和 Day 9 的 T4 数据对比。A100 留到 M3 的 2 卡实验再租。

## 只充 10 到 20 美元,不绑自动续费

这一条是纪律,不是建议。原因在 Day 0 写过:预算失控在这条路上只有一个原因,忘记关机。充值上限是最后一道保险,在所有脚本和 cron 都失效的时候兜底。

两家在余额归零时的行为不同,要搞清楚:

**RunPod**:余额到 0,Pod 自动停止。有 network volume 的 Pod 保留数据;没有的 Pod 直接销毁,数据不可恢复。部署 on-demand 实例时账户里要有至少 1 小时该配置的余额。账户默认有一个 80 美元/小时的总支出上限,对我们来说等于没有,用不到。

**Vast**:余额到 0,实例自动停止,GPU 释放。如果绑了信用卡,会自动扣款补余额,实例和数据保留;如果没绑卡,实例和数据会被排期删除。

RunPod 的文档在同一页给了两个「避免中断」的选项:开低余额通知,或者开 auto-pay。选前者,不选后者。低余额通知是免费的告警,auto-pay 是把上限交出去。Day 22 的第三层保险「余额上限加告警」说的就是这个通知。

注意 Vast 那句「如果绑了信用卡会自动扣款」。这正是要避免的:自动扣款意味着上限失效。所以在 Vast **只用一次性充值,不保存卡**;余额用完实例被删,这是我们想要的失败方式,不是事故。RunPod 同理,不开 auto-pay,充 10 到 20 美元就停。

## 第一次开机,一步一步

以 RunPod 为例,控制台路径(2026 年 9 月的界面,以后可能挪位置,但步骤不会变):

1. 注册,充值 10 美元。不开 auto-pay。
2. Settings 里贴上本机的 SSH 公钥。没有就先在 Mac 上生成:

```bash
# 本机终端
ssh-keygen -t ed25519 -C "gpu-rental" -f ~/.ssh/id_ed25519_gpu
cat ~/.ssh/id_ed25519_gpu.pub    # 复制这一行贴到 RunPod / Vast 的 SSH 设置里
```

3. Pods → Deploy。选 GPU 时切到 Community Cloud 看便宜的那档,挑 RTX 4090 或 3090。
4. 模板选 RunPod 官方的 PyTorch 镜像(名字类似 `runpod/pytorch:...-cu12x-torch2xx-ubuntu2204`)。自带 CUDA、PyTorch、Jupyter、SSH,今天不需要自定义。
5. 容器盘(Container Disk)给 20 GB,Volume Disk 给 20 GB。这两个盘的区别明天专门讲,今天只要知道:容器盘停机就清空、volume 停机保留、两者销毁 Pod 都没了。
6. 勾上 SSH Terminal Access。不需要 Jupyter 就取消勾选,少一个暴露端口。
7. Deploy。等状态变成 Running,一般一两分钟。

用 CLI 做同样的事,以后 Day 21 的脚本会用到:

```bash
# 本机终端,先装 runpodctl 并配 API key(key 在控制台 Settings → API Keys 生成)
runpodctl config --apiKey "$RUNPOD_API_KEY"
runpodctl pod create --name day19 --gpu-id "NVIDIA GeForce RTX 4090" \
  --image "runpod/pytorch:1.0.3-cu1281-torch291-ubuntu2404"
runpodctl pod list                 # 看状态和 pod id
runpodctl pod get <pod-id>         # 拿 SSH 连接信息
# 用完:
runpodctl pod delete <pod-id>      # 销毁。不是 stop
```

Vast 的流程平行,只是多一步「挑房东」:

```bash
# 本机终端
pip install vastai
vastai set api-key "$VAST_API_KEY"
# 搜单卡 4090、经过验证的机器、可靠性 > 0.98、按每美元性能排序
vastai search offers 'gpu_name=RTX_4090 num_gpus=1 verified=true reliability>0.98 inet_down>200' -o 'dph'
# 拿到 offer id 后开机;--onstart-cmd 里的命令会在容器起来后自动跑
vastai create instance <offer-id> --image pytorch/pytorch:2.4.0-cuda12.4-cudnn9-runtime \
  --disk 20 --ssh --onstart-cmd "nvidia-smi"
vastai ssh-url <instance-id>       # 拿到 ssh 地址和端口
# 用完:
vastai destroy instance <instance-id>   # 销毁。stop 只是暂停 GPU,磁盘继续计费
```

`search offers` 里那几个过滤条件很重要:`verified=true` 只看平台验证过的机器,`reliability>0.98` 过滤掉经常掉线的房东,`inet_down>200` 要求下行带宽大于 200 Mbps,否则下载 13.5 GB 权重要等十几分钟。Vast 是市场,不加过滤挑到的最便宜机器往往有便宜的理由。

## Vast 挑房东时那几个字段是什么意思

`vastai search offers` 的过滤条件是 Vast 独有的一层功课,RunPod 没有,因为 RunPod 的机器是均一的。每个 offer 是一位房东挂出来的一台机器的一部分,字段几十个,真正要看的是这几个:

| 字段 | 意思 | 我的过滤 | 为什么 |
| --- | --- | --- | --- |
| `gpu_name` | 卡型,用下划线代替空格,如 `RTX_4090` | `=RTX_4090` | |
| `num_gpus` | 这个 offer 包含几张卡 | `=1` | 单卡实验 |
| `dph_total` | dollars per hour,每小时总价,含 GPU 和房东标的基础存储 | 排序用 `-o dph` | 最终花的钱 |
| `min_bid` | interruptible 的当前最低出价 | 看一眼和 dph 差多少 | 决定值不值得走出价 |
| `verified` | 平台验证过的机器 | `=true` | 未验证的机器质量没有下限 |
| `reliability` | 房东历史在线率,0 到 1 | `>0.98` | 0.95 意味着一天掉线一小时多 |
| `inet_down` / `inet_up` | 下行 / 上行带宽,Mbps | `inet_down>200` | 明天算重下权重的时间要用 |
| `inet_down_cost` / `inet_up_cost` | 流量费,美元/GB | `inet_down_cost<0.01` | 房东之间差 15 倍 |
| `storage_cost` | 存储费,美元/GB/月 | `<0.3` | 中位数 0.20 |
| `cuda_max_good` | 这台机器驱动支持的最高 CUDA 版本 | `>=12.4` | 太低的驱动跑不了新 PyTorch |
| `dlperf` | Vast 自己测的深度学习性能分 | 排序可用 `-o dlperf_usd` | 每美元性能,但它按训练 workload 测,对 memory-bound 的推理参考价值有限 |
| `rentable` | 现在能不能租 | 默认已过滤 | |

排序选项 `-o dph` 是按价格升序,`-o dlperf_usd` 是按每美元性能降序。我用前者,因为 `dlperf` 是按算力型 workload 测的,和 Day 5 说的 decode 性质不符;同一张 4090 的带宽是固定的,价格才是变量。

这张表和 RunPod 的对照是:RunPod 上这些字段都不存在,因为它替你做了选择,代价是价格没有 Vast 的下限。

## 把 Colab 的口径搬到 4090

W2 和 W3 所有数字的口径是 T4:带宽 320 GB/s、ridge point 203、TinyLlama decode 下限 6.9 ms。换到 4090 全部要重算,W5 起的实验记录表第一行就是这些新口径,现在算好:

| 量 | T4(W2 / W3 口径) | RTX 4090(W5 起口径) | 怎么来的 |
| --- | --- | --- | --- |
| 带宽 | 320 GB/s | 1008 GB/s | 标称 |
| fp16 tensor 峰值 | 65 TFLOP/s | 165 TFLOP/s | 标称,dense |
| ridge point | 203 | 164 | 峰值 ÷ 带宽 |
| TinyLlama-1.1B decode 下限(batch 1) | 2.2 GB ÷ 320 ≈ 6.9 ms,145 tok/s | 2.2 GB ÷ 1008 ≈ 2.2 ms,458 tok/s | 权重字节 ÷ 带宽 |
| 7B fp16 decode 下限(batch 1) | 装不下 | 13.5 GB ÷ 1008 ≈ 13.4 ms,75 tok/s | 同上 |
| 7B 的 KV cache 最多装 | | ≈ 18,000 token,batch 8 × 2048 | (24 − 13.5 − 1.5) GB ÷ 512 KB |
| TinyLlama 的 KV cache 最多装 | ≈ 550,000 token | ≈ 900,000 token | (显存 − 2.2 − 1.5) GB ÷ 22.5 KB |
| 打到 compute-bound 需要的 batch | ≈ 203 | ≈ 164 | 等于 ridge point(Day 5 的推导) |

最后两行放在一起看有个有意思的结论。4090 上跑 7B,序列 2048 时 KV cache 只装得下 batch 8,离 ridge point 164 差二十倍,**7B 在 24 GB 卡上永远是 memory-bound,加 batch 加到显存爆也到不了屋顶**。TinyLlama 的 KV cache 每 token 只有 22.5 KB(GQA 的功劳,Day 4 讲过),batch 128 × 2048 = 262,144 token 才占 6 GB,轻松扫过 164。所以 Day 16 那种「扫到 batch 128 看曲线在哪离开斜线」的实验,在 4090 上要用 TinyLlama 做才看得到转折;用 7B 做只能看到斜线那一段。这不是实验设计的缺陷,这本身就是结论:**显存决定你能不能爬到屋顶,和算力无关**。

## SSH 进去

RunPod 给两种 SSH 方式。一种是经过它代理的 `ssh <pod-id>@ssh.runpod.io`,不支持 scp 和端口转发;另一种是直连机器的 TCP 端口,形式是 `ssh root@<ip> -p <port>`,支持一切。用后一种。连接信息在 Pod 详情页的 Connect 里,或者 `runpodctl pod get` 的输出里。

```bash
# 本机终端
ssh -i ~/.ssh/id_ed25519_gpu root@<ip> -p <port>
```

进去第一件事开 tmux。SSH 断了 tmux 里的进程还活着,W5 起跑十几分钟的实验都在 tmux 里跑:

```bash
# GPU 实例里
tmux new -s work        # 新开会话
# 断线后重连:
tmux attach -t work
```

给这台机器在本机 `~/.ssh/config` 里起个别名,以后 scp、rsync、端口转发都省得敲 ip 和端口:

```
# 本机 ~/.ssh/config
Host gpu
    HostName <ip>
    Port <port>
    User root
    IdentityFile ~/.ssh/id_ed25519_gpu
    StrictHostKeyChecking accept-new
```

有了别名,`ssh gpu` 就进去了。`StrictHostKeyChecking accept-new` 是因为每次开机 ip 和主机指纹都变,不加这条每次都要手动确认。三个以后常用的动作:

```bash
# 本机终端
scp gpu:/workspace/lab/out.csv .                  # 拿一个文件回来
rsync -avz gpu:/workspace/lab/results/ ./results/  # 同步整个目录,只传变化的部分
ssh -L 9001:localhost:9001 gpu                    # 端口转发:实例里 9001 端口的服务在本机 localhost:9001 打开
```

端口转发在 W2 用过的 Perfetto 场景会派上用场:trace 文件几百 MB 不想传回本机,就在实例里 `python -m http.server 9001` 起一个静态服务,转发到本机后浏览器直接打开。

两条安全习惯从第一天养成:只用密钥登录,不设密码;不需要 Jupyter 就不要暴露它的端口,RunPod 模板默认会开,部署时取消勾选。租来的机器 ip 是公网的,开着密码登录和公网 Jupyter 等于开着门。

## 读懂 nvidia-smi 的每一格

`nvidia-smi` 是 NVIDIA 的系统管理工具,进任何一台 GPU 机器第一条命令就是它。输出是一张固定格式的表,每一格都有含义,读错了后面所有判断都歪。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="nvidia-smi 输出的示意图,标出驱动版本、CUDA 版本、GPU 名称、温度、功耗、显存使用、GPU 利用率和进程列表各在哪一格">
<rect x="16" y="16" width="608" height="196" rx="3" fill="var(--code-bg)" stroke="var(--code-rule)"/>
<text x="28" y="36" font-family="var(--font-mono)" font-size="10" fill="var(--code-fg)">NVIDIA-SMI 570.xx      Driver Version: 570.xx      CUDA Version: 12.8</text>
<text x="28" y="56" font-family="var(--font-mono)" font-size="10" fill="var(--code-fg)">GPU  Name            Persistence-M | Bus-Id        Disp.A | Volatile Uncorr. ECC</text>
<text x="28" y="72" font-family="var(--font-mono)" font-size="10" fill="var(--code-fg)">Fan  Temp  Perf  Pwr:Usage/Cap  |    Memory-Usage    | GPU-Util  Compute M.</text>
<line x1="28" y1="80" x2="612" y2="80" stroke="var(--code-rule)"/>
<text x="28" y="98" font-family="var(--font-mono)" font-size="10" fill="var(--code-fg)">  0  NVIDIA GeForce RTX 4090   Off | 00000000:01:00.0 Off |                N/A</text>
<text x="28" y="114" font-family="var(--font-mono)" font-size="10" fill="var(--code-fg)">30%  41C   P0    68W / 450W       |  14210MiB / 24564MiB |   100%     Default</text>
<line x1="28" y1="124" x2="612" y2="124" stroke="var(--code-rule)"/>
<text x="28" y="142" font-family="var(--font-mono)" font-size="10" fill="var(--code-fg)">Processes:</text>
<text x="28" y="158" font-family="var(--font-mono)" font-size="10" fill="var(--code-fg)">  GPU   PID   Type   Process name                    GPU Memory Usage</text>
<text x="28" y="174" font-family="var(--font-mono)" font-size="10" fill="var(--code-fg)">    0  1234    C    python                                  14196MiB</text>
<text x="28" y="198" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">(示意输出,数字是编的,格式是真的)</text>
<line x1="560" y1="36" x2="560" y2="228" stroke="var(--compute)" stroke-width="1" stroke-dasharray="3 3"/>
<text x="470" y="244" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">① CUDA Version = 驱动能支持的最高 CUDA</text>
<text x="470" y="258" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">   不是 PyTorch 实际用的版本</text>
<line x1="120" y1="118" x2="120" y2="262" stroke="var(--mem)" stroke-width="1" stroke-dasharray="3 3"/>
<text x="16" y="276" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">② Pwr 68W/450W:memory-bound 时功耗远低于上限</text>
<text x="16" y="290" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">   算力没吃满的旁证,和 Day 5 的 0.65% 利用率一致</text>
<line x1="330" y1="118" x2="330" y2="296" stroke="var(--mem)" stroke-width="1" stroke-dasharray="3 3"/>
<text x="240" y="310" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">③ Memory-Usage 14210MiB:权重 13.5 GB + 框架开销</text>
<text x="240" y="324" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">   Day 5 那张饼的前两项,在这里第一次看见</text>
<line x1="455" y1="118" x2="455" y2="212" stroke="var(--compute)" stroke-width="1" stroke-dasharray="3 3"/>
<text x="345" y="226" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">④ GPU-Util 100% ≠ 算力用满</text>
</svg>
<figcaption>nvidia-smi 的四个最常读错的格子。CUDA Version 是驱动的上限不是 PyTorch 在用的;GPU-Util 100% 只说明有 kernel 在跑;功耗和显存两格反而是 Day 5 那些纸上数字的实物。</figcaption>
</figure>

逐格说:

**Driver Version / CUDA Version**。驱动版本决定这台机器能跑的 CUDA 上限。右上角的 CUDA Version 是「驱动支持的最高 CUDA 版本」,不是 PyTorch 实际链接的版本。PyTorch 自带的 CUDA runtime 只要不高于这个数就能跑。`python -c "import torch; print(torch.version.cuda)"` 才是 PyTorch 在用的版本。两个数不一样是正常的。

**Name**。卡的型号。Vast 上要核对它和你租的 offer 一致,房东挂错型号的事有过。

**Persistence-M**。持久模式,决定没有进程用 GPU 时驱动是否卸载。对我们无关紧要。

**Bus-Id**。PCIe 地址,多卡机器上区分卡用,M3 的 2 卡实验会看。

**Fan / Temp / Perf / Pwr:Usage/Cap**。风扇转速、温度、性能状态(P0 最高)、当前功耗对功耗上限。功耗这格有用:decode 阶段 memory-bound,算力大部分在等,功耗会远低于上限;大矩阵乘法打满算力时功耗会顶到上限附近,有的卡还会因此降频。Day 17 讲标称打不满的原因时会回来看这一格。

**Memory-Usage**。已用显存对总显存。这就是 Day 5 那张饼的实物:模型加载后这一格约等于权重 + 框架开销,开始生成后随 KV cache 涨。注意 PyTorch 有显存池,释放张量后这个数不一定降,`torch.cuda.memory_allocated()` 才是张量真实占用。

**GPU-Util**。Day 5 误区里那一条。它的定义是采样周期内有 kernel 在跑的时间占比,一个 99% 时间在等显存的 kernel 也算 100%。它回答「GPU 忙不忙」,不回答「算力用了多少」。

**Compute M.**。计算模式,Default 允许多进程共享。

**Processes**。哪些进程占着显存。Vast 上开机就有别的进程在这里,说明房东的机器不干净,直接销毁换一台。

手工看表不方便记录,查询模式更好用,Day 22 的空闲检测 cron 就靠它:

```bash
# GPU 实例里
nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,utilization.gpu,power.draw,temperature.gpu \
  --format=csv,noheader
# 每 2 秒刷一次,跑实验时开在 tmux 的另一个窗格
watch -n 2 nvidia-smi
```

### nvidia-smi 之外的三个子命令

默认那张表是快照,还有三个子命令以后会反复用:

```bash
# GPU 实例里
nvidia-smi dmon -s u -d 1        # 每秒一行:sm% 和 mem%,跑实验时开在旁边
nvidia-smi -q -d CLOCK,POWER     # 当前时钟、最高时钟、功耗上限,Day 17 查降频用
nvidia-smi topo -m               # 多卡之间是 NVLink 还是 PCIe,M3 两卡实验用
```

`dmon` 那两列值得单独说。`sm%` 就是默认表里的 GPU-Util,有 kernel 在跑就高;`mem%` 是**显存控制器忙碌的时间占比**,它才更接近「带宽用了多少」。decode 阶段的典型画面是 `sm%` 接近 100、`mem%` 也很高,说明 kernel 一直在跑而且一直在等显存;大矩阵乘法打满算力时 `mem%` 反而会降下来。这两列并排看,是 Day 5 那张 roofline 在终端里最便宜的近似。它不是 profiler,粒度只有一秒,但判断「这一步是不是 memory-bound」够用。Day 22 的空闲检测也可以用它:连续 N 分钟 `sm%` 为 0 就销毁。

## 进去就要做的三件事

**第一件:记下这台机器的身份**。卡型、驱动、CUDA 版本、PyTorch 版本、PyTorch 认到的设备名和显存总量。以后每次实验的记录表第一行都是这些,不然两周后不知道数字是哪张卡出的。

```python
# GPU 实例里,python
import torch, subprocess
print(subprocess.check_output(["nvidia-smi", "--query-gpu=name,driver_version,memory.total",
                               "--format=csv,noheader"]).decode().strip())
print("torch", torch.__version__, "| cuda", torch.version.cuda,
      "| device", torch.cuda.get_device_name(0),
      "| mem GB", round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1),
      "| bf16", torch.cuda.is_bf16_supported())
```

**第二件:5 秒验货**。用 Day 13 的带宽测法跑一次,看实测带宽是不是这张卡该有的量级。这一步在 Vast 上尤其重要,房东的机器可能散热差、PCIe 插槽降速、或者干脆型号不对。4090 标称 1008 GB/s,实测预期落在 75% 到 90%,也就是 750 到 900 GB/s;如果只测到 400,这台机器有问题,销毁换一台,别在它上面浪费一晚上。

```python
# GPU 实例里,python;Day 13 的代码原样搬过来
import torch, time
x = torch.empty(256 * 1024 * 1024, dtype=torch.float16, device="cuda")  # 512 MB
for _ in range(3): y = x + 1                                              # warmup
torch.cuda.synchronize(); t0 = time.perf_counter()
for _ in range(20): y = x + 1
torch.cuda.synchronize(); dt = (time.perf_counter() - t0) / 20
gbps = 2 * x.numel() * 2 / dt / 1e9        # 读一次写一次,每元素 2 字节
print(f"{gbps:.0f} GB/s")
```

**第三件:把销毁命令先写好**。在本机终端另开一个窗口,把 `runpodctl pod delete <pod-id>` 或 `vastai destroy instance <id>` 敲好不回车,或者设一个 60 分钟的闹钟。今天的任务不超过一小时,一小时到了不管做到哪,销毁。这是 Day 22 自动化之前的手动版,W4 剩下四天就是把这个动作变成脚本。

## API key 放哪

`runpodctl config --apiKey` 和 `vastai set api-key` 都会把 key 写进本机的配置文件,这是本机,没问题。要防的是两件事:key 进 git,和 key 被拷到租来的实例上。

RunPod 的 API key 在控制台 Settings 里生成,可以给 key 设权限范围,给自动化脚本用的 key 只开 Pod 的读写,不要用全权限的。Vast 的控制台默认生成全权限 key,同样只放本机。Day 21 的 bootstrap 会通过环境变量把需要的 token 注入实例,实例销毁 token 就没了。RunPod 另有一个 Secrets 功能,可以把 token 存在平台侧、在 Pod 模板里引用为环境变量,明天讨论持久化时再决定用不用。

一条底线:**任何 key 出现在 git 历史里就当已经泄露,立刻吊销重新生成**。有人的余额就是这么被刷光的。

## 第一小时的账单预演

按秒计费的好处是可以精确预演今天花多少钱。RTX 4090 按 0.74 美元/小时算,每秒 0.0002 美元:

| 步骤 | 用时 | GPU 费 |
| --- | --- | --- |
| 点 Deploy 到 Running | 1 到 3 分钟 | 已开始计费,约 0.02 到 0.04 美元 |
| SSH 进去,开 tmux,`nvidia-smi` | 2 分钟 | 0.02 美元 |
| 5 秒验货(含 torch 导入) | 1 分钟 | 0.01 美元 |
| 把 nvidia-smi 每一格对着上面的图读一遍,`--query-gpu` 试几个字段 | 15 分钟 | 0.19 美元 |
| 填记录表,截图 | 5 分钟 | 0.06 美元 |
| `runpodctl pod delete` | 立刻 | 停止计费 |
| 容器盘 20 GB × 0.10 美元/GB/月 × 0.4 小时 | | 0.001 美元 |
| 合计 | 约 25 分钟 | 约 0.3 美元 |

充的 10 美元花掉 3%。这个数字和「忘关机一晚」对比一下:8 小时 × 0.74 = 5.9 美元,是今天预算的二十倍,是月预算的一到两成。Day 22 的三层自动销毁就是为了让「忘关机一晚」在物理上不可能发生。

## 第一次开机的检查清单

把今天的动作压成一张清单,以后每次开机对一遍,直到 Day 21 把它变成脚本:

1. 本机:确认账户余额不超过 20 美元,没有 auto-pay,没有保存的信用卡。
2. 本机:`~/.ssh/config` 里 `gpu` 那一项的 ip 和端口改成这次的。
3. 控制台:卡型是想租的那张,不是「同名的低配版」(4090 有 24 GB 一种,A100 有 40 和 80 两种,H100 有 PCIe / SXM / NVL 三种)。
4. 控制台:模板是 PyTorch 官方镜像,Jupyter 端口没勾。
5. 控制台:容器盘和卷盘的大小按明天的方案填,不留超过需要的空间,因为盘也计费。
6. 进去:`tmux new -s work`。
7. 进去:`nvidia-smi` 核对卡型、驱动、显存总量,Processes 一栏为空。
8. 进去:5 秒验货,带宽在标称的 75% 到 90% 之间。低于 60% 直接销毁换机器。
9. 进去:另开一个 tmux 窗格 `nvidia-smi dmon -s u -d 2`,全程挂着。
10. 本机另一个终端:销毁命令敲好不回车,或者闹钟设好。
11. 任务结束:结果按明天的方案拉走,然后 `pod delete` / `destroy instance`,回控制台确认列表里没有实例。
12. 本机:记录表填上这次的花费和余额。

第 11 条的「回控制台确认」不是多余的。CLI 返回成功不代表实例真的没了,网络抖一下命令可能没发出去;而账单是按控制台里的状态算的。

## 今天的记录表

第一次开机的记录。**全部留空,等真开机那天填**;预期值那列是按标称推的,填完对比。

| 项 | 预期 | 实测(留空) |
| --- | --- | --- |
| 平台 / 云档 | RunPod Community Cloud | |
| 卡型 | RTX 4090 24 GB | |
| 小时价 | ~0.7 美元(官网实时) | |
| 驱动 / CUDA Version(nvidia-smi) | 5xx / 12.x | |
| torch.version.cuda | 12.x,≤ 上一格 | |
| 显存总量(torch) | ~24.0 GB(GiB 显示为 ~23.6) | |
| bf16 支持 | True | |
| 5 秒验货带宽 | 750 ~ 900 GB/s(标称 1008 的 75% 到 90%) | |
| 从点 Deploy 到 SSH 进去 | 1 ~ 3 分钟 | |
| 本次花费 | < 1 美元 | |
| 销毁时间 / 方式 | 手动 `pod delete` | |
| 账户余额(销毁后) | ≥ 9 美元 | |

显存那格提前说一个坑:`nvidia-smi` 报的 24564 MiB 是 MiB(1024 进制),24564 MiB ≈ 25.76 GB ≈ 24.0 GiB;广告说的「24 GB」实际是 24 GiB。Day 2 讲过的 1024 坑在这里又出现一次。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| on-demand | 按用付费、资源独占、不会被打断的实例。两家的标准档 |
| spot / interruptible | 可中断的便宜实例。RunPod 2026-09 文档已无 Spot;Vast 叫 interruptible,出价制 |
| 出价(bid) | Vast interruptible 的定价方式:你出每小时价,高于当前最低出价就拿到机器,被更高出价顶掉就暂停 |
| 抢占 / 暂停 | 可中断实例被收回 GPU。显存内容丢失、磁盘保留、存储费照收 |
| Secure Cloud / Community Cloud | RunPod 的两档机器来源,前者数据中心级,后者合作方机器更便宜 |
| Savings plan | RunPod 预付 3 或 6 个月换 GPU 折扣,不含存储 |
| reliability | Vast 房东机器的可靠性评分,过滤时要求 > 0.98 |
| Container Disk / Volume Disk | RunPod Pod 的两块盘。前者停机清空,后者停机保留、销毁清空。明天详讲 |
| runpodctl / vastai | 两家的命令行工具,Day 21 的脚本靠它们开机和销毁 |
| nvidia-smi | NVIDIA System Management Interface,查看驱动、显存、利用率、功耗、进程的工具 |
| GPU-Util | nvidia-smi 里的利用率格,含义是采样期内有 kernel 在跑的时间占比,不是算力利用率 |
| Persistence Mode | 驱动在没有进程时是否保持加载,对我们无关 |
| tmux | 终端复用器,SSH 断线后进程继续跑 |
| dph_total | Vast offer 的每小时总价(dollars per hour),排序 `-o dph` 就是按它 |
| dlperf | Vast 自测的深度学习性能分,按算力型 workload 测,对 memory-bound 推理参考价值有限 |
| `nvidia-smi dmon` | 每秒采样的监控模式,`sm%` 是有 kernel 在跑的时间占比,`mem%` 是显存控制器忙碌占比,后者更接近带宽利用率 |
| `nvidia-smi topo -m` | 打印多卡之间的连接拓扑(NVLink / PCIe),M3 两卡实验用 |
| 端口转发 | `ssh -L 本机端口:localhost:远端端口`,把实例里的服务映射到本机浏览器 |
| compute unit | Colab Pro 的计费单位,不同卡型消耗速度不同,折算不透明 |
| MiB vs GB | 1 MiB = 1024² 字节,1 GB = 10⁹ 字节。nvidia-smi 用 MiB,广告用 GB,24564 MiB ≈ 24.0 GiB ≈ 25.8 GB |

## 常见误区

**按算力排序选卡**。decode 是 memory-bound,选卡看显存装不装得下、带宽多大、每美元买到多少带宽。L4 和 4090 同 24 GB,带宽差 3.4 倍,decode 慢 3 倍,价格差不多。H100 每美元买到的带宽还不如 3090。算力那列在 M5 写 kernel 之前都排最后。

**照着一年前的攻略找 RunPod 的 Spot 按钮**。2026 年 9 月的 RunPod 文档和价格页里没有 Spot 这个档位,只有 On-demand、Savings plan,以及 Secure 和 Community 两档机器。可中断的便宜实例要去 Vast 的 interruptible。云平台的产品线变得比教程快,以文档为准。

**用 stop 代替 destroy**。两家的 stop 都只是释放 GPU,磁盘继续计费:RunPod 的 volume disk 停机后费率还翻倍(0.10 变 0.20 美元/GB/月),Vast 的容器盘停机后也可能比运行时贵。而且 RunPod 文档明说,停机的 Pod 重启时可能分到零张 GPU,因为机器已经被别人租走。今天的任务结束是 delete / destroy,不是 stop。

**绑了卡开自动扣款**。Vast 绑卡后余额归零会自动扣款补上,RunPod 的 auto-pay 同理。这让「充 10 美元」这道保险失效。只做一次性充值,余额用完实例被停或被删,是想要的结果。

**把 nvidia-smi 右上角的 CUDA Version 当成 PyTorch 的 CUDA 版本**。那是驱动支持的上限。PyTorch 用的版本看 `torch.version.cuda`,两个数经常不一样,只要后者不高于前者就没问题。

**看到 GPU-Util 100% 就觉得卡用满了**。Day 5 的老误区,今天在真机上第一次看见这个格子。它说的是有 kernel 在跑,不是算力用了多少。decode 时 100% 和算力利用率 1% 同时成立,旁边的功耗格反而更诚实,memory-bound 时功耗远低于上限。

**在 Vast 上不加过滤挑最便宜的**。最便宜的机器往往有便宜的理由:掉线、散热差、下行带宽只有几十 Mbps、显卡货不对板。`verified=true reliability>0.98 inet_down>200` 三个条件不能省,进去后 5 秒验货不能省。

**只看每小时价,不看每美元买到什么**。同一张 4090,RunPod 0.74、Vast 中位 0.37、最低 0.14,差五倍;但最低价的那台可能下行只有 50 Mbps、流量费 15 倍、reliability 0.9。每小时价要和带宽、流量费、可靠性一起看,Day 20 会把这几项合成一笔账。

**在租来的机器上「想逻辑」**。Day 0 的纪律:进实例之前脚本必须调试完。今天的 5 秒验货代码、nvidia-smi 查询命令都是在本机写好、复制进去的。按秒计费的机器上每犹豫一分钟都在花钱,思考留给本机的免费时间。

## 参考资料

文章与文档

- RunPod 价格页,GPU 小时价和存储费率的出处,以实时为准。https://www.runpod.io/pricing
- RunPod 文档《Pods · Pricing》,On-demand 与 Savings plan、余额归零行为、80 美元/小时默认支出上限、存储计费表。https://docs.runpod.io/pods/pricing
- RunPod 文档《Storage options》,容器盘 / volume / network volume 三种存储的对比表,明天的主料。https://docs.runpod.io/pods/storage/types
- RunPod 文档《Manage Pods》,stop 释放 GPU 但 volume 继续计费、重启可能分到零 GPU 的原文。https://docs.runpod.io/pods/manage-pods
- RunPod 文档《Connect to Pods》,两种 SSH 方式的区别。https://docs.runpod.io/pods/connect-to-a-pod
- RunPod 文档 runpodctl 的 pod 子命令(create / list / get / stop / delete)。https://docs.runpod.io/runpodctl/reference/runpodctl-pod
- RunPod 文档《Using TMUX for persistent sessions》。https://docs.runpod.io/tips-and-tricks/tmux
- Vast.ai 文档《Pricing》,市场定价、三种实例类型、存储与流量另计、余额归零时的行为。https://docs.vast.ai/instances/rental-types
- Vast.ai 文档《CLI · Get started》,`search offers` / `create instance` / `ssh-url` / `destroy instance` 的完整流程。https://docs.vast.ai/cli/get-started
- Vast.ai CLI 源码仓库。https://github.com/vast-ai/vast-cli
- RunPod 文档《Manage API keys》,创建、限权、禁用 API key。https://docs.runpod.io/get-started/api-keys
- Hugging Face 镜像站 hf-mirror.com,国内平台访问 HF 时用 `HF_ENDPOINT` 指向它。https://hf-mirror.com
- NVIDIA《nvidia-smi 文档》,每一列的官方定义和 `--query-gpu` 可用字段。https://docs.nvidia.com/deploy/nvidia-smi/index.html
- Vast.ai 公开报价接口 `https://console.vast.ai/api/v0/bundles/`,本文的 Vast 价格区间来自 2026-09-05 对它的查询(单卡、rentable、按 dph_total 排序),无需登录。

视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1YGsDzCE35&autoplay=0&high_quality=1" title="Runpod 设置完整教程 – 在云端运行大型AI模型!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>攒钱换房车的福叔 · 《Runpod 设置完整教程 – 在云端运行大型AI模型!》(28 分钟,中文配音版)。看注册、充值、选 GPU、模板、SSH 那几段就够,跟着点一遍按钮。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/DHRLd9xDAbI" title="How To Monitor and Manage GPUs with Nvidia-smi Command" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Liv4IT · 《How To Monitor and Manage GPUs with Nvidia-smi Command》。逐列解释 nvidia-smi 输出和 --query-gpu 用法,配合上面那张注释图看。</figcaption>
</figure>

- Bijan Bowen,《Runpod Setup FULL Tutorial – Run Large AI Models On The Cloud!》,上面 B 站视频的英文原版,YouTube 按标题搜索。
- mrkwong2016,《Vast.AI 快速入门指南演练》,B 站按标题搜索,Vast 控制台的界面走一遍。

## 自测

合上笔记做。

1. RunPod 和 Vast 在商业结构上的核心差别是什么?这个差别导致了哪两项费用只有 Vast 收?

<details><summary>答案</summary>

RunPod 是平台统一定价(Secure / Community 两档机器),Vast 是市场、房东各自定价。因为房东自己承担机器和网络成本,Vast 的存储费和上传下载流量费都由房东另计,RunPod 不收流量费、存储按固定费率。

</details>

2. Vast 的 interruptible 实例被更高出价顶掉时,发生什么?什么样的任务能放上去?

<details><summary>答案</summary>

实例被暂停不是销毁:GPU 被拿走、进程冻结、显存内容全部丢失;磁盘保留,存储费照收;价格回落后恢复。适合「中断了重跑不心疼、结果边跑边落盘」的任务,比如十几分钟的 batch 扫描。不适合跑几小时且中间结果只在内存里的任务。

</details>

3. 24 GB 的卡跑 7B fp16,KV cache 最多装多少 token?这个数怎么来的?

<details><summary>答案</summary>

(24 − 13.5 权重 − 1.5 框架开销)GB ≈ 9 GB,除以每 token 512 KB,约 18,000 token。batch 8 × 2048 = 16,384 勉强装下,batch 16 装不下。要扫到 batch 128 得用 80 GB 卡或换回 TinyLlama。

</details>

4. L4、RTX 3090、RTX 4090 都是 24 GB、价格相近,为什么 7B decode 的速度上限差三倍?

<details><summary>答案</summary>

decode 是 memory-bound,上限 = 带宽 ÷ 权重字节数。L4 带宽 300 GB/s,3090 是 936,4090 是 1008;13.5 GB 权重分别要 45 ms、14.4 ms、13.4 ms 搬完,上限约 22、69、75 tok/s。显存决定装不装得下,带宽决定快慢,算力在这个阶段用不上。

</details>

5. 为什么充值要限制在 10 到 20 美元且不绑卡?两家余额归零时分别发生什么?

<details><summary>答案</summary>

充值上限是所有脚本和 cron 都失效时的最后一道保险;绑卡自动扣款会让这道保险失效。RunPod 余额到 0 时 Pod 停止,没有 network volume 的 Pod 直接销毁;Vast 余额到 0 时实例停止,没绑卡则实例和数据排期删除,绑了卡则自动扣款续命。我们要的是前一种结果。

</details>

6. nvidia-smi 右上角的 CUDA Version、GPU-Util、Pwr 三格各说明什么?哪一格在 decode 时最能反映算力没用满?

<details><summary>答案</summary>

CUDA Version 是驱动支持的最高 CUDA 版本,不是 PyTorch 在用的;GPU-Util 是采样期内有 kernel 在跑的时间占比,不是算力利用率;Pwr 是当前功耗对上限。decode 时 GPU-Util 显示 100% 但算力只用了 1%,功耗会远低于上限,所以功耗那格最诚实。

</details>

7. 任务结束时为什么是 delete / destroy 而不是 stop?

<details><summary>答案</summary>

stop 只释放 GPU,磁盘继续计费,RunPod 的 volume disk 停机后费率还从 0.10 涨到 0.20 美元/GB/月,Vast 停机后存储费也可能更贵;而且 RunPod 停机 Pod 重启时可能分到零张 GPU。今天的环境几分钟就能重建,没有任何东西值得付过夜费。

</details>

8. Vast 的 `search offers` 至少要加哪三个过滤条件?各防什么?

<details><summary>答案</summary>

`verified=true` 防未经平台验证、质量没有下限的机器;`reliability>0.98` 防经常掉线的房东;`inet_down>200` 防下行带宽太低导致重下权重要等半小时以上。Day 20 还会再加 `inet_down_cost<0.01` 和 `storage_cost<0.3` 两条管费用。

</details>

## 明天预告

Day 20 讲实例销毁后什么会丢。RunPod 的容器盘、volume disk、network volume 三种存储在 stop 和 delete 时各是什么命运,Vast 的容器盘和绑机器的 volume 又是怎么算的;然后算一笔账:一块 50 GB 的盘停机放一个月要多少钱,占月预算几成,和「每次开机重下 13.5 GB 权重要几分钟」比哪个划算。最后把代码、模型权重、实验结果三类东西各自的存放方案定下来,画成一棵决策树。
