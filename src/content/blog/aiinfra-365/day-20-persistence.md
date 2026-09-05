---
title: 'Day 20 · 实例销毁后什么会丢：代码、数据、模型权重各放哪'
description: '租来的机器是一次性的，销毁之后盘上的一切都没了。今天把 RunPod 和 Vast 的几种存储在 stop 和 delete 时的命运搞清楚，算一笔「存着」和「重下」哪个便宜的账，然后给代码、模型权重、实验结果三类东西各定一个去处，画成决策树。'
pubDate: 2026-09-18
regime: none
tags: ['storage', 'runpod', 'vast', 'huggingface', 'cost', 'aiinfra-365']
series: 'aiinfra-365'
day: 20
lang: 'zh'
---

## 今天要解决的问题

昨天在 RunPod 上开了第一台机器,跑了 nvidia-smi 和 5 秒验货,然后销毁。销毁的那一刻,容器里装的所有东西,包括刚 pip 装好的依赖、刚下好的模型、刚跑出来的数字,全部消失。这是租卡和自己的电脑最大的区别:**机器是一次性的**。

Day 0 定的纪律是「跑完立刻销毁」。这条纪律要能执行,前提是销毁不心疼,也就是丢掉的东西要么不值钱、要么几分钟能重造、要么已经存到别处。今天回答三个问题:

1. 两家平台各有几种存储,stop 和 delete 时各自什么命运,停机不用还要不要付钱。
2. 「把盘留着」和「每次重下」哪个便宜。这是一道算术题,不是感觉题。
3. 代码、模型权重、实验结果三类东西各放哪。定下来之后 Day 21 的 bootstrap 脚本才知道要拉什么、Day 22 的自动销毁才敢放心删。

今天不开机,全是查文档和算账,零成本。

## 先搞清「机器」是什么:一个容器,不是一台电脑

两家平台租给你的都不是裸机,是一个 Docker 容器。这一点决定了后面所有存储行为,值得先讲透。

容器从一个**镜像**(image)启动。镜像是只读的、分层的文件系统快照,比如 `runpod/pytorch:...` 这个镜像里已经装好了 Ubuntu、CUDA、PyTorch、Jupyter。容器启动时,平台在镜像最上面叠一层**可写层**,你 pip 装的包、下载的文件、改的配置全写在这一层。RunPod 叫它容器盘,Vast 叫它容器存储,本质是同一个东西:容器的可写层。

**卷**(volume)是另一回事:一块独立的磁盘,挂载到容器的某个路径下,RunPod 默认挂在 `/workspace`。写到那个路径下的东西不进可写层,进卷。

这样一看,RunPod 三种盘的行为就都有了解释。stop 一个 Pod,平台丢掉整个容器,重启时从镜像重新建一个,可写层自然是空的,这就是「容器盘 stop 即清空」;卷是挂进来的外部磁盘,容器没了它还在,重启再挂回去,这就是「卷盘 stop 保留」;delete 把卷也一起删,网络卷因为不属于任何 Pod 才活下来。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="容器结构示意:底部是只读镜像层(Ubuntu、CUDA、PyTorch),上面是可写层即容器盘,右侧一块独立的卷挂载到 /workspace;stop 时可写层随容器丢弃,卷保留">
<text x="16" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一个 Pod 的文件系统长什么样</text>
<rect x="40" y="170" width="340" height="30" rx="2" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="210" y="190" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">镜像层 · Ubuntu 22.04(只读)</text>
<rect x="40" y="138" width="340" height="30" rx="2" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="210" y="158" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">镜像层 · CUDA 12.x + 驱动库(只读)</text>
<rect x="40" y="106" width="340" height="30" rx="2" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="210" y="126" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">镜像层 · PyTorch、Jupyter、SSH(只读)</text>
<rect x="40" y="60" width="340" height="44" rx="2" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="210" y="78" font-family="var(--font-mono)" font-size="10" fill="var(--ink)" text-anchor="middle">可写层 = 容器盘:pip 装的包、~/.cache、/root 下一切</text>
<text x="210" y="95" font-family="var(--font-mono)" font-size="9" fill="var(--compute)" text-anchor="middle">stop → 容器被丢弃 → 这一层消失</text>
<rect x="420" y="60" width="200" height="140" rx="2" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="1.5"/>
<text x="520" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">卷盘 / 网络卷</text>
<text x="520" y="104" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">独立磁盘,挂载到</text>
<text x="520" y="120" font-family="var(--font-mono)" font-size="10" fill="var(--mem)" text-anchor="middle">/workspace</text>
<text x="520" y="150" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)" text-anchor="middle">stop → 卸下,保留</text>
<text x="520" y="166" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)" text-anchor="middle">delete → 卷盘删,网络卷留</text>
<line x1="380" y1="130" x2="420" y2="130" stroke="var(--mem)" stroke-width="1.5"/>
<text x="16" y="228" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">镜像层是别人做好的,每次开机一样;可写层和卷是你自己的东西,一个随容器死,一个随 Pod 死。</text>
<text x="16" y="244" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">Day 21 的两条路:把「每次都装的东西」做进镜像层,或者用脚本每次往可写层重装。</text>
</svg>
<figcaption>Pod 是叠在只读镜像上的一个容器。容器盘就是容器的可写层,随容器消亡;卷是挂进来的独立磁盘。搞清这一层,三种盘的存亡规则不用背。</figcaption>
</figure>

这个结构还预告了 Day 21 的一个选择:每次开机都要装的依赖,是做进镜像层(自定义 Docker 镜像,一次构建、以后开机即有),还是用脚本每次往可写层重装。前者开机快但维护镜像麻烦,后者慢两三分钟但一个 bash 文件就够。明天比较。

## RunPod 的三种盘,三种死法

RunPod 文档把 Pod 的存储分三种,名字容易混,先用一张表钉死:

| | Container Disk 容器盘 | Volume Disk 卷盘 | Network Volume 网络卷 |
| --- | --- | --- | --- |
| 挂在哪 | 系统盘,`/` 和 `/root` 等 | `/workspace`(默认) | `/workspace`(替代卷盘) |
| Pod stop 时 | **清空** | 保留 | 保留 |
| Pod delete 时 | 清空 | **清空** | 保留,独立于 Pod |
| 能否跨 Pod | 不能 | 不能 | 能,可挂到同数据中心的多个 Pod |
| 速度 | 本地,最快 | 本地,快 | 网络,浮动 |
| 运行时费率 | 0.10 美元/GB/月 | 0.10 美元/GB/月 | 0.07 美元/GB/月(1 TB 以下) |
| 停机时费率 | 不收(已清空) | **0.20 美元/GB/月,翻倍** | 0.07 美元/GB/月 |
| 大小能否改 | 能 | 只能增不能减 | 能 |

三点要盯住。第一,容器盘停机就清空,所以任何「以后还要」的东西放 `/workspace` 之外等于放垃圾桶。第二,卷盘停机费率翻倍,0.20 美元/GB/月,一块 50 GB 的卷盘停着不用一个月 10 美元,是月预算的六分之一到三分之一。第三,网络卷是唯一能活过 delete 的,而且比卷盘还便宜,但必须在创建 Pod 时挂上,之后不能加,并且把你锁在某一个数据中心里,那个中心没有空闲 GPU 时你的数据就在那儿等着。

还有一条昨天的误区里提过的:RunPod 文档写明,停机的 Pod 重启时**可能分到零张 GPU**,因为那台机器的卡已经被别人租走。所以「stop 过夜明天接着用」这条路,即便付了双倍存储费也不保证明天有卡。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="RunPod 三种存储在 Pod 运行、停机、销毁三个阶段的存亡示意:容器盘停机即清空;卷盘停机保留但费率翻倍,销毁清空;网络卷全程保留">
<text x="16" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">RunPod:一个 Pod 的三个阶段,三种盘各自的命运</text>
<text x="200" y="52" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">Running</text>
<text x="370" y="52" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">Stopped</text>
<text x="540" y="52" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">Deleted</text>
<line x1="285" y1="40" x2="285" y2="250" stroke="var(--rule)" stroke-dasharray="3 3"/>
<line x1="455" y1="40" x2="455" y2="250" stroke="var(--rule)" stroke-dasharray="3 3"/>
<text x="16" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">容器盘</text>
<rect x="120" y="76" width="160" height="26" rx="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="200" y="94" font-family="var(--font-mono)" font-size="10" fill="var(--ink)" text-anchor="middle">$0.10/GB/月</text>
<rect x="290" y="76" width="160" height="26" rx="2" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<text x="370" y="94" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)" text-anchor="middle">已清空 · 不收费</text>
<rect x="460" y="76" width="160" height="26" rx="2" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<text x="540" y="94" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)" text-anchor="middle">已清空</text>
<text x="16" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">卷盘</text>
<text x="16" y="166" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">/workspace</text>
<rect x="120" y="136" width="160" height="26" rx="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="200" y="154" font-family="var(--font-mono)" font-size="10" fill="var(--ink)" text-anchor="middle">$0.10/GB/月</text>
<rect x="290" y="136" width="160" height="26" rx="2" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1.5"/>
<text x="370" y="154" font-family="var(--font-mono)" font-size="10" fill="var(--ink)" text-anchor="middle">保留 · $0.20/GB/月 翻倍</text>
<rect x="460" y="136" width="160" height="26" rx="2" fill="var(--paper-raised)" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<text x="540" y="154" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)" text-anchor="middle">已清空</text>
<text x="16" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">网络卷</text>
<text x="16" y="226" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">创建时挂载</text>
<rect x="120" y="196" width="160" height="26" rx="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="200" y="214" font-family="var(--font-mono)" font-size="10" fill="var(--ink)" text-anchor="middle">$0.07/GB/月</text>
<rect x="290" y="196" width="160" height="26" rx="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="370" y="214" font-family="var(--font-mono)" font-size="10" fill="var(--ink)" text-anchor="middle">保留 · $0.07/GB/月</text>
<rect x="460" y="196" width="160" height="26" rx="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="540" y="214" font-family="var(--font-mono)" font-size="10" fill="var(--ink)" text-anchor="middle">保留 · 独立于 Pod</text>
<text x="16" y="268" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">stop 释放 GPU 但不释放盘;重启时可能分到零张 GPU。只有 delete 才停止全部计费(网络卷除外)。</text>
<text x="16" y="284" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">费率来自 RunPod 文档 2026-09,以官网为准。</text>
</svg>
<figcaption>RunPod 三种盘在 running、stopped、deleted 三个阶段的命运。橙色那格是最容易被忽略的钱:卷盘停机后费率翻倍,而且重启不保证有 GPU。</figcaption>
</figure>

## Vast 那边:容器盘、绑机器的卷,和流量费

Vast 的存储更简单,也更容易踩坑。

**容器盘**。创建实例时用滑块定大小,最小 10 GB,之后不能改。实例存在期间一直计费,**停机也计费**,而且文档明说停机时的费率可能比运行时更高,具体多少看房东。实例销毁即清空。

**卷(Volume)**。能活过实例销毁,但**绑定物理机器**:只能挂到同一台机器上的新实例,不能迁移。这个限制在 Vast 上几乎让它失去意义,因为下次那台机器多半被别人租了。除非你连续几天都租同一位房东的同一台机,否则别用。

**流量费**。这是 Vast 独有的一项,RunPod 不收。房东对上传和下载分别定价,按 GB 计。我查公开报价接口时看了单卡 4090 的 64 个 offer,下载费率中位数约 0.0026 美元/GB,便宜到可以忽略;但同一批里有房东标到 0.039 美元/GB,是中位数的 15 倍。下载 13.5 GB 的 7B 权重,前者花 3.5 美分,后者花 53 美分。看着都不多,但 B 站有位 UP 主复盘过自己的账单:下载一个 174 GB 的模型,流量费是 GPU 费的四倍。房东的存储费率在同一批报价里中位数是 0.20 美元/GB/月,和 RunPod 停机卷盘一样贵。

所以在 Vast 上,`search offers` 里要多加两个过滤:`inet_down_cost<0.01` 和 `storage_cost<0.3`。昨天的搜索命令补全成:

```bash
# 本机终端
vastai search offers 'gpu_name=RTX_4090 num_gpus=1 verified=true reliability>0.98 inet_down>200 inet_down_cost<0.01 storage_cost<0.3' -o 'dph'
```

## 停机不等于免费:算一算存着值不值

现在算那道算术题。场景是 W5 到 W7 的典型一周:每周开机三次,每次两小时,用 7B fp16 模型,权重 13.5 GB,加上依赖和代码,盘上有效数据约 20 GB。

**方案 A:留一块 50 GB 卷盘,跑完 stop 不 delete**。50 GB 是因为容器盘要给系统和 pip 依赖留空间,卷盘要装权重加实验输出,取整。一周 168 小时里运行 6 小时、停机 162 小时:

```
运行:50 GB × 0.10 美元/GB/月 × (6 / 720) 月    ≈ 0.04 美元
停机:50 GB × 0.20 美元/GB/月 × (162 / 720) 月  ≈ 2.25 美元
一周 ≈ 2.3 美元,一个月 ≈ 10 美元
```

月预算 30 到 60 美元,10 美元是 17% 到 33%,买的是「省下每次开机重下权重的几分钟」,还附带「重启可能没 GPU」的风险。

**方案 B:网络卷 30 GB,Pod 每次 delete**。30 GB 够装权重和结果:

```
30 GB × 0.07 美元/GB/月 = 2.1 美元/月,不管开不开机
```

便宜五倍,但把自己锁在一个数据中心,并且那个中心的 Community Cloud 便宜卡不一定有货。

**方案 C:什么都不留,每次重下**。成本是时间。13.5 GB 用不同带宽下载要多久:

| 实例下行带宽 | 换算成字节速率 | 13.5 GB 要多久 |
| --- | --- | --- |
| 200 Mbps(Vast 过滤的下限) | 25 MB/s | 540 s = 9 分钟 |
| 1 Gbps | 125 MB/s | 108 s ≈ 2 分钟 |
| 10 Gbps(数据中心常见) | 1.25 GB/s | 11 s(实际受 HF 服务端和磁盘限制,一般 30 到 90 秒) |

Mbps 是每秒兆比特,除以 8 才是字节。RunPod 的数据中心机器一般是千兆到万兆,重下 13.5 GB 在一到两分钟之间;Vast 上如果没过滤 `inet_down>200`,挑到一台 50 Mbps 的机器,就要等 36 分钟。这两分钟按 4090 的小时价折算不到 3 美分,而且和 pip 装依赖并行,几乎不占实际时间。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="三种方案的月成本对比条:卷盘停机保留约 10 美元,网络卷约 2.1 美元,每次重下约 0.5 美元(按时间折算),并标出月预算 30 美元">
<text x="16" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一个月 12 次开机,20 GB 有效数据:三种方案的月成本</text>
<text x="16" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">A 卷盘 stop 保留</text>
<rect x="160" y="48" width="300" height="20" rx="2" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="468" y="63" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">≈ $10 / 月(预算的 17%–33%)</text>
<text x="16" y="107" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">B 网络卷 30 GB</text>
<rect x="160" y="93" width="63" height="20" rx="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="231" y="108" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">≈ $2.1 / 月,锁定一个数据中心</text>
<text x="16" y="152" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">C 每次重下</text>
<rect x="160" y="138" width="15" height="20" rx="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="183" y="153" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">≈ $0.5 / 月(12 次 × 2 分钟 GPU 时间折算),Vast 加流量费 12 × 3.5 美分</text>
<line x1="160" y1="40" x2="160" y2="170" stroke="var(--rule)"/>
<text x="16" y="200" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">条长按金额线性;A 是 B 的 5 倍、C 的 20 倍。A 还附带「重启可能分到零张 GPU」。</text>
<text x="16" y="216" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">费率:RunPod 文档 2026-09;Vast 流量费取 64 个 4090 报价的中位数 0.0026 美元/GB。</text>
</svg>
<figcaption>同样的数据、同样的开机次数,三种存法差 20 倍。停机保留卷盘看着省事,实际是月预算里最贵的一项固定支出。</figcaption>
</figure>

计费粒度顺带记一下:RunPod 文档写明容器盘和卷盘按秒计费,网络卷按小时计费。所以上面方案 A 和 C 的存储费精确到秒,开机 25 分钟就付 25 分钟的盘钱;网络卷开着不用也是整点整点地扣。文档还专门写了一句:RunPod 不是为长期存储设计的,重要数据备份到本机或专门的存储服务。这句话和今天的结论是同一个意思。

结论:**默认方案 C,每次 delete、每次重下**。两个例外:一是同一实验连续几天都在跑、每天开机不止一次,那么 stop 过夜的代价是 50 GB × 0.20 ÷ 30 天 ≈ 0.33 美元一晚,可以接受,但不能过周;二是 M3 之后数据集和多个模型加起来超过 100 GB、每次重下超过十分钟,那时候再开一块网络卷,现在不开。

## 重下有多快,取决于三段路

「每次重下」成立的前提是重下够快。13.5 GB 从 Hugging Face 到实例的显存要过三段路,每段有自己的上限,实际速度是三者的最小值:

| 段 | 上限量级 | 怎么测 |
| --- | --- | --- |
| Hugging Face 服务端到实例网卡 | 实例的下行带宽,1 到 10 Gbps;HF 侧对单连接也有限速 | `curl -o /dev/null -w '%{speed_download}\n' <一个大文件的 URL>` |
| 网卡到磁盘 | 本地 NVMe 写入 1 到 3 GB/s;网络卷慢得多且浮动 | `dd if=/dev/zero of=/workspace/t bs=1M count=2048 oflag=direct` 看报告的速率 |
| 磁盘到显存 | 加载时 safetensors 按 PCIe 带宽走,PCIe 4.0 x16 约 25 GB/s | 记 `from_pretrained` 的用时减去下载时间 |

一般是第一段最慢。HF 对单个连接限速,所以下载器会并发多个连接;huggingface_hub 现在的加速方案是 `hf_xet`,基于按块去重的 Xet 存储,`pip install "huggingface_hub[hf_xet]"` 装上后 `hf download` 自动用它。老攻略里的 `hf_transfer` 已经被官方标记为弃用,别再照抄。

所以明天 bootstrap 开机后要顺手测两个数:`curl` 的下载速率,和 `dd` 的写入速率。这两个数和 Day 13 的显存带宽一样,是这台机器的体检指标,低于预期就换机器。RunPod 数据中心机器的下行一般在 500 MB/s 以上,13.5 GB 半分钟;Vast 上过滤了 `inet_down>200` 也只保证 25 MB/s 的下限,能挑到千兆的最好挑千兆。

顺手记一个换算:HF 上模型页的文件大小按 1000 进制显示,`model.safetensors` 写 13.5 GB 就是 13.5 × 10⁹ 字节;`df -h` 和 `du -h` 默认按 1024 进制,同一个文件显示 12.6 GiB。Day 2 的 1024 坑第三次出现。

## 核对和清理缓存

重下之前先看有没有:同一台实例里第二次 `from_pretrained` 不会再下,因为 `refs/main` 里的 commit 和远端一致时直接用 `snapshots` 里的链接。两条命令管缓存:

```bash
# GPU 实例里
hf cache scan          # 列出缓存里每个仓库占多少、有几个版本
hf cache delete        # 交互式选择删哪些版本
du -sh $HF_HOME/hub/models--*   # 最直接的看法
```

`hf cache scan` 在 W7 量化实验时有用:同一个模型会有 fp16 原版、AWQ 版、GPTQ 版三个仓库,加起来二三十 GB,30 GB 的卷盘一下就满。满了的症状是下载中途报磁盘错误,不是提示空间不足,所以开机后先 `df -h /workspace` 看一眼剩多少。

## 三类东西各放哪

盘上的东西按「丢了怎么办」分三类,各有各的家。

### 代码:git,私有仓库

代码是最不该丢也最容易保住的。所有脚本、配置、bootstrap 都进一个私有 git 仓库,实例开机时 clone,跑完 push。两条规矩:

一,**任何密钥不进 git**。HF token、RunPod / Vast 的 API key、通知用的 webhook 地址,全部放环境变量,通过 `.env` 文件在开机时注入,`.env` 写进 `.gitignore`。这条做不到,一次误 push 就等于把账户余额送人。

二,实例上用只读的 deploy key 或者 https 加 token 拉代码,不要把自己的私人 SSH 私钥拷到租来的机器上。机器是别人的,尤其 Vast 上是某个房东的。

```bash
# GPU 实例里,bootstrap 会做的事(Day 21 完整版)
git clone https://oauth2:${GIT_TOKEN}@github.com/<you>/aiinfra-lab.git /workspace/lab
# 跑完:
cd /workspace/lab && git add results/*.csv && git commit -m "day20 run" && git push
```

结果里的小文件(几 KB 到几 MB 的 CSV、JSON、图)直接跟代码一起 push,方便;大文件另说,下面讲。

仓库的样子现在就定下来,免得三周后 results 和 scripts 混成一锅:

```
aiinfra-lab/
├── bootstrap/
│   ├── bootstrap.sh          # Day 21 写
│   ├── watchdog.sh           # Day 22 的空闲检测
│   └── requirements.txt      # 固定版本,torch==2.x.y 这种写法
├── experiments/
│   ├── day09_ttft_tpot.py
│   ├── day13_bandwidth.py
│   └── day16_batch_sweep.py
├── results/                  # 只放 < 10 MB 的产物
│   ├── day16_sweep_4090.csv
│   └── day16_sweep_4090.png
├── cost/
│   └── gpu-ledger.csv        # Day 23 的成本看板数据
├── .gitignore
└── README.md                 # 每次实验的一行结论,链到博客
```

`.gitignore` 至少有这几行:

```
.env
*.json.gz
traces/
__pycache__/
*.safetensors
```

`*.safetensors` 那行是防手滑:万一在仓库目录里下了模型,git 不会把 13.5 GB 加进去。提交信息用 `day16: batch sweep on 4090, 5 points` 这种格式,和博客的 Day 编号对齐,以后回头找数据是哪天跑的一眼就能对上。

### 模型权重:HF cache,重下,把缓存目录指到卷盘

模型权重从 Hugging Face 下,transformers 会把文件放进本地缓存目录,默认是 `~/.cache/huggingface/hub`。缓存目录的结构值得看一眼,以后排查「为什么又下了一遍」全靠它:

```
~/.cache/huggingface/hub/
└── models--TinyLlama--TinyLlama-1.1B-Chat-v1.0/
    ├── blobs/            # 实际文件,按内容哈希命名
    ├── refs/main         # 分支名 → commit 哈希
    └── snapshots/
        └── <commit哈希>/  # 符号链接指向 blobs,看起来像完整的模型目录
            ├── config.json
            ├── model.safetensors
            └── tokenizer.json
```

`snapshots/<哈希>/` 里的文件是链接,真身在 `blobs/`,同一个文件被两个版本引用只存一份。`refs/main` 记着当前 `main` 对应哪个 commit,transformers 加载时先查它,再决定要不要联网核对。

两个环境变量控制它放哪:`HF_HOME` 是整个 Hugging Face 目录的根(默认 `~/.cache/huggingface`),`HF_HUB_CACHE` 单独控制 hub 缓存(默认 `$HF_HOME/hub`)。在 RunPod 上,`~` 在容器盘,停机就清空;所以要把 `HF_HOME` 指到 `/workspace`,不然连 stop 过夜都保不住权重:

```bash
# GPU 实例里,写进 ~/.bashrc 或 bootstrap
export HF_HOME=/workspace/hf
export HF_TOKEN=<从 .env 注入,不要写在这里>
# 预热下载,和 pip 装依赖并行跑
hf download TinyLlama/TinyLlama-1.1B-Chat-v1.0 &
```

`hf download` 是 huggingface_hub 的命令行(老版本叫 `huggingface-cli download`),比在 Python 里第一次 `from_pretrained` 时顺带下载更可控,能看到进度、能放后台。

`hf download` 还有一个 `--local-dir` 参数,把文件下到一个普通目录而不是缓存结构里,目录下就是 `config.json`、`model.safetensors` 这些文件本身,没有 blobs 和符号链接。M3 起 vLLM 这类引擎有时要传一个模型目录路径,用它更直接。两种方式别混用,同一个模型下两份就是白占 13.5 GB。

重下的时间上面算过,千兆网一到两分钟。这就是为什么权重可以不存:它是**公开、可重复获取、几分钟能重造**的东西,和代码、和自己跑出来的结果性质完全不同。Llama 系列有的仓库需要在 HF 上申请访问,申请通过后 token 就能下,这是一次性的事。

### 数据集:和权重同一条规则

W7 的量化要用校准数据,GPTQ 和 AWQ 都要几百条文本样本让它们统计激活分布,常用的是 wikitext-2 或 C4 的一个小切片,几十到几百 MB。M3 测吞吐要一批真实长度分布的 prompt,几 MB。这些全是公开数据集,`datasets` 库下载后缓存在 `$HF_HOME/datasets`,和权重同一个根目录,`HF_HOME` 指到 `/workspace` 之后它们自动跟过去。

规则和权重一样:公开、可重下、不存。唯一要存的是**自己筛出来的那批 prompt**:比如为了让每次吞吐测试的请求分布一致,固定一个 200 条、长度分层抽样的 prompt 文件。它是几百 KB 的 JSON,是自己的劳动成果,进 git。路线图 M3 那句「吞吐测量必须固定请求分布,否则前后数字不可比」,落到存储上就是这个文件要有版本。

### 实验结果:小的进 git,大的推到对象存储

W2 的 profiler trace 是 JSON,一次 generate 抓下来几十到几百 MB;W3 的 batch 扫描输出是几 KB 的 CSV;matplotlib 的图几十 KB。分两档:

**小于 10 MB**:CSV、JSON 摘要、PNG,跟代码一起 push 到 git。

10 MB 这条线怎么定的:GitHub 对单个文件有 100 MB 的硬上限,50 MB 起就警告;更实际的约束是 clone 时间,每次开机都要 clone,仓库超过几百 MB 就开始拖慢 bootstrap;还有 git 对二进制文件不做增量,一个 CSV 改一行只多几字节,一个 PNG 改一次就多一份完整拷贝。10 MB 是留了余量的经验线,以后觉得紧再调。

结果文件的命名现在就定,不然三周后分不清哪张卡跑的:`results/day16_batch_sweep_rtx4090_2026-10-12.csv`,文件头两行用 `#` 注释写卡型、驱动、torch 版本、commit 哈希,也就是 Day 19 记录表的第一行。这样 CSV 自己就能回答「这数字是哪台机器、哪版代码出的」,不用去翻别的记录。

```
# gpu=RTX 4090 24GB, driver=570.xx, cuda=12.8, torch=2.9.1, commit=3f2a1c9
# model=TinyLlama-1.1B-Chat fp16, seq=2048, warmup=3, repeats=10
batch,tokens_per_s_median,ms_per_step_median,mem_used_gb
1,412.3,2.43,3.9
4,1580.1,2.53,4.1
```

**大于 10 MB**:trace 文件、模型的量化产物、以后 M7 的日志,推到对象存储。对象存储是「按 GB 收钱、按请求收钱、通过 HTTP 存取文件」的服务,S3 是原型。对我们这个量级,Cloudflare R2 合适:每月 10 GB 存储免费,出站流量不收费,S3 兼容,`rclone` 直接用。同类的还有 Backblaze B2、AWS S3,选 R2 是因为出站免费,以后从任何一台租来的机器拉回结果都不额外花钱。

```bash
# GPU 实例里
rclone copy /workspace/lab/traces r2:aiinfra-lab/traces --progress
```

rclone 是一个统一操作几十种云存储的命令行工具,配置一次(`rclone config`,填 R2 的 access key)后,`copy`、`sync`、`ls` 对所有后端语法一样。它的配置文件也是密钥,同样走 `.env` 注入,不进 git,不留在实例上。

为什么不用 git-lfs 存大文件?它能把大文件放到 git 之外、仓库里只留指针,看着正好。但 GitHub 给 LFS 的免费额度是按存储量和每月下载带宽算的,每次开机 clone 都要把 LFS 对象拉一遍,几百 MB 的 trace 拉几次就把带宽额度用完,然后要付费。R2 出站免费,而且 trace 只在本机看 Perfetto 时才拉,实例上根本不需要它。对象存储和 git 各干各的事,不硬凑在一起。

本机这边也有一条:Mac 的硬盘不是仓库。W2 的 trace 看完就删,或者留在 R2 上,本机只保留 git 仓库那份代码和小结果。这台 2018 年的机器硬盘本来就紧,囤 GPU 上跑出来的几个 GB 中间产物没有意义。

一次性的、不想配 rclone 的传输,两家平台各有现成工具:RunPod 的 `runpodctl send <file>` 在实例上生成一个一次性码,本机 `runpodctl receive <code>` 就能收;Vast 的 `vastai copy instance:/path local:/path`。还有最原始的 `scp -P <port> root@<ip>:/workspace/lab/out.csv .`,昨天说过要用直连 TCP 端口的那种 SSH,代理那种不支持 scp。

## 密钥怎么进实例:三种做法

上面反复说「密钥通过环境变量注入」,具体有三条路,各有取舍:

| 做法 | 怎么做 | 好处 | 坏处 |
| --- | --- | --- | --- |
| scp 一个 `.env` 上去再 `source` | 开机后 `scp .env gpu:/root/.env`,bootstrap 里 `set -a; source /root/.env; set +a` | 最简单,两家通用,密钥只在本机和实例的可写层 | 多一步手动操作;`.env` 落在容器盘上,stop 后消失是好事,但运行期间任何能读这台机器的人都能读 |
| 平台的 Secrets 功能 | RunPod 在控制台建 Secret,模板里引用为环境变量;Vast 在 `create instance` 时用 `--env '-e HF_TOKEN=...'` 传 | 开机即有,脚本里不用处理;RunPod 的 Secret 不在 Pod 详情页明文显示 | 密钥存在平台侧,多一个信任对象;Vast 的 `--env` 会出现在本机的 shell 历史里,要注意 |
| 用后即焚的短期 token | HF 支持给 token 设只读和过期;云 API key 给最小权限 | 泄露了损失有限 | 要定期换,麻烦 |

我的选择是第一条加第三条:`.env` 用 scp 送上去,里面的 token 全是最小权限的(HF 只读、RunPod / Vast 只开 Pod 读写、R2 只开一个 bucket 的读写)。Day 21 的 bootstrap 会在开头检查 `/root/.env` 存在且权限是 600,不存在就退出,免得跑到一半才发现没 token。

不管哪条路,一条铁律:**脚本里不要 `echo $HF_TOKEN`,不要 `env` 全打印,不要 `set -x` 跑到 source 那一行**。日志会进 tmux 的回滚缓冲、会进 Day 23 的记录,一次打印等于一次泄露。

## 决策树

把上面的规则画成一棵树,以后每样新东西问一遍:

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="存储决策树:先问 5 分钟能否重造;能则不存;不能则按大小和是否需要跨机器分流到 git、对象存储或网络卷">
<rect x="220" y="14" width="200" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/>
<text x="320" y="36" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">这东西丢了,5 分钟能重造吗?</text>
<line x1="270" y1="48" x2="150" y2="90" stroke="var(--ink-faint)"/>
<text x="190" y="66" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">能</text>
<line x1="370" y1="48" x2="470" y2="90" stroke="var(--ink-faint)"/>
<text x="428" y="66" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">不能</text>
<rect x="40" y="90" width="220" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="150" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">不存。写进 bootstrap 每次重造</text>
<text x="150" y="128" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)" text-anchor="middle">pip 依赖 · 模型权重 · 数据集 · 编译缓存</text>
<rect x="380" y="90" width="200" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/>
<text x="480" y="112" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">多大?</text>
<line x1="430" y1="124" x2="380" y2="170" stroke="var(--ink-faint)"/>
<text x="378" y="150" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">&lt; 10 MB</text>
<line x1="530" y1="124" x2="560" y2="170" stroke="var(--ink-faint)"/>
<text x="556" y="150" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">≥ 10 MB</text>
<rect x="280" y="170" width="200" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="380" y="190" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">git 私有仓库</text>
<text x="380" y="208" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)" text-anchor="middle">代码 · 配置 · CSV · 图 · 笔记</text>
<rect x="490" y="170" width="140" height="34" rx="4" fill="var(--paper-raised)" stroke="var(--ink)"/>
<text x="560" y="192" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">要跨机器读吗?</text>
<line x1="530" y1="204" x2="470" y2="250" stroke="var(--ink-faint)"/>
<text x="478" y="230" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">要</text>
<line x1="590" y1="204" x2="600" y2="250" stroke="var(--ink-faint)"/>
<text x="604" y="230" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">同一 Pod</text>
<rect x="360" y="250" width="220" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="470" y="270" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">对象存储(R2),rclone 推</text>
<text x="470" y="288" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)" text-anchor="middle">profiler trace · 量化产物 · 日志</text>
<rect x="590" y="250" width="44" height="48" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="612" y="270" font-family="var(--font-mono)" font-size="9" fill="var(--ink)" text-anchor="middle">卷盘</text>
<text x="612" y="285" font-family="var(--font-mono)" font-size="8" fill="var(--ink-soft)" text-anchor="middle">当次</text>
<rect x="40" y="320" width="590" height="60" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="52" y="340" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">例外一:同一实验连续几天、每天多次开机 → stop 过夜(≈ $0.33/晚,50 GB),不过周。</text>
<text x="52" y="356" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">例外二:M3 后数据集 + 多模型 &gt; 100 GB、重下 &gt; 10 分钟 → 开网络卷,接受锁定数据中心。</text>
<text x="52" y="372" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">密钥永远不在树上:环境变量注入,不进 git,不留实例。</text>
</svg>
<figcaption>每样要落盘的东西先问「5 分钟能重造吗」。能重造的一律不存,由 bootstrap 负责重造;存的东西按大小和是否跨机器分流。卷盘只在同一个 Pod 的生命周期内当工作区。</figcaption>
</figure>

树的第一问是关键。pip 依赖、模型权重、数据集看着都是「大文件」,但它们全是公开的、可重复获取的,重造成本是几分钟网络时间,不是自己的劳动。自己敲的代码、自己跑出来的数字才是不可重造的,而它们通常很小。**不可重造的东西小,可重造的东西大**,这个规律让「每次 delete」变得便宜。

把手头几样具体的东西过一遍树,看规则是不是真的够用:

| 东西 | 5 分钟能重造? | 大小 | 跨机器? | 去处 |
| --- | --- | --- | --- | --- |
| torch、transformers 的 wheel | 能,pip 两三分钟 | 5 到 8 GB | | 不存 |
| TinyLlama-1.1B 权重 | 能,下载十几秒 | 2.2 GB | | 不存,`HF_HOME=/workspace/hf` |
| Day 10 的 profiler trace | 能重跑,但要开机 | 200 MB | 要,本机 Perfetto 要看 | R2 |
| Day 16 的 batch 扫描 CSV | 能重跑,但要开机 20 分钟 | 5 KB | 要 | git |
| Day 16 的 matplotlib 图 | 从 CSV 秒出 | 80 KB | 要 | git(方便直接看) |
| W7 自己量化出来的 AWQ 权重 | **不能**,量化要跑 20 到 40 分钟 GPU | 4 GB | 要,下次实验直接加载 | R2 |
| bootstrap.sh、实验脚本 | 不能,是劳动成果 | 20 KB | 要 | git |
| `.env` 里的密钥 | 能重新生成,但泄露有代价 | 1 KB | 不 | 只在本机 |

第六行是这棵树上最有意思的一个例子。AWQ 权重理论上「可重造」,原版模型和量化脚本都有,但重造要烧 20 到 40 分钟 GPU,按 4090 的价算是 0.25 到 0.5 美元,而存 4 GB 在 R2 上免费。所以「5 分钟能重造」这个门槛里的 5 分钟指的是**几乎零成本的时间**,有 GPU 时间参与就算不能重造。这样想清楚之后,W7 的量化产物一律推 R2,下次实验直接拉,不再重量化。

## 我的方案,写死

汇总成一张表,Day 21 的 bootstrap 和 Day 22 的自动销毁都按它来:

| 资产 | 大小量级 | 放哪 | 开机时怎么来 | 关机前怎么走 | 月成本 |
| --- | --- | --- | --- | --- | --- |
| 代码、配置、bootstrap | < 1 MB | 私有 git | clone | push | 0 |
| 密钥(HF / 云 API / R2 / webhook) | 几百字节 | 本机 `.env`,不进 git | 开机时注入环境变量 | 随实例销毁 | 0 |
| pip 依赖 | 5 到 8 GB | 不存 | bootstrap 装,固定版本 | 销毁 | 0 |
| 模型权重(TinyLlama 2.2 GB / 7B 13.5 GB) | 2 到 14 GB | 不存,`HF_HOME=/workspace/hf` | `hf download` 后台预热 | 销毁 | 0(Vast 加几美分流量) |
| 实验小结果(CSV / JSON / PNG) | < 10 MB | git,跟代码 | 无 | push | 0 |
| 大结果(trace / 量化产物) | 10 MB 到几 GB | Cloudflare R2 | 需要时 rclone 拉 | rclone 推 | 10 GB 内 0 |
| 卷盘 `/workspace` | 30 GB | 当次工作区 | 随 Pod 创建 | 随 Pod 销毁 | 运行时 ≈ 0.3 美元/月 |
| 网络卷 | 不开 | | | | 0 |

卷盘那一行的月成本是按每月 12 小时运行、30 GB、0.10 美元/GB/月算的:30 × 0.10 × 12 / 720 ≈ 0.05 美元,取整写 0.3 以内。整张表的存储支出接近零,月预算全部留给 GPU 时间。

## Vast 上的对应做法

上面的方案以 RunPod 的名词写,搬到 Vast 上有四处不同。

**盘只有一块**。Vast 没有容器盘和卷盘的区分,`--disk` 指定的就是容器存储,停机照收费,销毁即没。所以 Vast 上「stop 过夜」比 RunPod 更不划算,一律 destroy。

**盘要给够**。默认 10 GB 装不下:镜像自身几个 GB、torch 及依赖 5 GB 上下、7B 权重 13.5 GB、再留几 GB 给输出,`--disk 30` 起步,跑量化实验 `--disk 50`。创建后不能改,少了只能销毁重开。

**结果怎么出来**。`vastai copy instance_id:/workspace/lab/results ./results` 直接拉回本机,或者和 RunPod 一样 rclone 推 R2。Vast 也有 Cloud Sync 功能,可以在控制台把实例目录同步到 S3 或 Google Drive,一次性备份用它,自动化还是 rclone。

**流量费要算进去**。每次开机重下 13.5 GB,按中位数 0.0026 美元/GB 是 3.5 美分,一个月 12 次 42 美分;挑到 0.039 美元/GB 的房东就是 6 美元。`inet_down_cost<0.01` 这个过滤条件的价值就是这 5 美元多。

补一条本地这边的事。所有实验结果最终都要回到这台 Mac 上写博客、画图,所以 git 仓库在本机 clone 一份,R2 上的 trace 需要时 `rclone copy r2:aiinfra-lab/traces/xxx.json .` 拉一个。R2 有对象生命周期规则,可以设「traces 目录 90 天后自动删」,免得免费的 10 GB 被一年的 trace 慢慢占满。

## 一次完整生命周期,东西在哪

把 Day 21 到 Day 23 要自动化的流程先用人话过一遍,标出每一步东西在哪、什么时候还在:

| 步骤 | 动作 | 此刻存在的东西 |
| --- | --- | --- |
| 1 | 本机:`runpodctl pod create`,容器盘 20 GB、卷盘 30 GB | 镜像层(平台的)、空的可写层、空的 `/workspace` |
| 2 | 本机:`scp .env gpu:/root/.env` | `.env` 在可写层 |
| 3 | 实例:bootstrap 装依赖 | torch 等在可写层(`/usr/lib/python3/...`) |
| 4 | 实例:`git clone` 到 `/workspace/lab` | 代码在卷盘 |
| 5 | 实例:`hf download` 到 `/workspace/hf` | 权重在卷盘 |
| 6 | 实例:跑实验,输出写 `/workspace/lab/results` 和 `/workspace/lab/traces` | 结果在卷盘 |
| 7 | 实例:`git push`(小结果),`rclone copy traces r2:...`(大结果) | 结果的副本在 GitHub 和 R2 |
| 8 | 本机:`runpodctl pod delete` | 可写层和卷盘全部消失;GitHub 和 R2 上的副本、本机的 `.env` 还在 |
| 9 | 本机:`git pull`,需要时 `rclone copy r2:... .` | 结果回到本机 |

第 8 步删掉的东西里,只有第 3 步的依赖和第 5 步的权重「体积大」,而它们都能重造;第 4、6 步是自己的东西,已经在第 7 步出去了。这就是为什么 delete 可以毫不犹豫。如果第 7 步失败(网络断、R2 配置错),第 8 步就不能执行,Day 22 的自动销毁脚本要把「先同步、同步成功再销毁」写成硬依赖。

## 今天的记录表

这张表在真正跑通一遍开机、下载、销毁之后填。预期值列是按标称推的。

| 项 | 预期 | 实测(留空) |
| --- | --- | --- |
| RunPod 实例下行带宽(`curl -o /dev/null <大文件URL>` 看速率) | 500 MB/s 以上 | |
| `hf download TinyLlama-1.1B` 用时 | 2.2 GB,10 到 30 秒 | |
| `hf download` 7B 用时 | 13.5 GB,1 到 2 分钟 | |
| pip 装 torch + transformers 用时 | 1 到 3 分钟 | |
| 两者并行后总等待 | 取较长者,约 2 到 3 分钟 | |
| `du -sh /workspace/hf` | 权重大小 + 几十 MB tokenizer | |
| rclone 推 200 MB trace 到 R2 用时 | 10 到 30 秒 | |
| 一次完整开机到销毁的存储费 | 不到 1 美分 | |
| Vast 实测流量费(如果用 Vast) | 13.5 GB × 房东费率 | |

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Container Disk 容器盘 | RunPod Pod 的系统盘,stop 即清空,不收停机费 |
| Volume Disk 卷盘 | RunPod Pod 挂在 `/workspace` 的本地盘,stop 保留但费率翻倍,delete 清空 |
| Network Volume 网络卷 | RunPod 独立于 Pod 的存储,delete 后仍在,可跨同数据中心的 Pod 挂载,创建 Pod 时必须挂上 |
| Vast Volume | Vast 的持久卷,绑定物理机器,只能挂回同一台机 |
| 流量费(bandwidth cost) | Vast 房东对上传下载按 GB 收的费用,RunPod 不收。中位数约 0.0026 美元/GB,个别房东 15 倍 |
| HF_HOME / HF_HUB_CACHE | Hugging Face 缓存目录的环境变量。前者是根(默认 `~/.cache/huggingface`),后者单独控制 hub 缓存 |
| blobs / snapshots / refs | HF 缓存的三层结构:按哈希存的真身、按 commit 组织的符号链接目录、分支名到 commit 的映射 |
| `hf download` | huggingface_hub 的命令行下载,老版本叫 `huggingface-cli download` |
| 对象存储 | 按 GB 和请求计费、通过 HTTP 存取文件的云服务,S3 是原型。R2、B2 同类 |
| Cloudflare R2 | 出站流量免费的对象存储,每月 10 GB 存储免费,S3 兼容 |
| rclone | 统一操作各种云存储的命令行工具,`copy` / `sync` / `ls` 对所有后端一样 |
| deploy key | 只对一个仓库有效的只读 SSH 密钥,放在租来的机器上比放私人密钥安全 |
| runpodctl send / receive | RunPod 的一次性文件传输,实例侧生成码,本机侧凭码接收 |
| 镜像(image)/ 可写层 | 容器启动自的只读分层快照,和叠在其上的可写层。容器盘就是可写层 |
| hf_xet | huggingface_hub 的加速下载后端,按块去重;取代已弃用的 hf_transfer |
| `hf cache scan` / `delete` | 查看和清理 HF 缓存的命令 |
| 校准数据 | 量化时用来统计激活分布的几百条文本样本,常用 wikitext-2 或 C4 切片,公开可重下 |
| `$HF_HOME/datasets` | `datasets` 库的缓存目录,与 `hub` 同根 |
| Secrets(RunPod) | 平台侧存密钥、模板里引用为环境变量的功能 |
| Cloud Sync | RunPod 和 Vast 控制台里把实例目录同步到 S3 / Google Drive 的功能 |
| 对象生命周期 | R2 / S3 按前缀和天数自动删除对象的规则 |
| Mbps vs MB/s | 兆比特每秒与兆字节每秒,差 8 倍。1 Gbps = 125 MB/s |

## 常见误区

**以为 stop 了就不花钱**。RunPod 卷盘停机后费率翻倍到 0.20 美元/GB/月,Vast 容器盘停机照收且可能更贵。50 GB 停一个月 10 美元,是月预算的两三成。stop 是为「今晚停明早接着用」准备的,不是为「先放着」准备的。

**把权重存在容器盘还指望 stop 后还在**。RunPod 的 `~/.cache/huggingface` 在容器盘,stop 即清空。要保住权重至少要 `HF_HOME=/workspace/hf`。当然按今天的结论,权重根本不需要保,重下两分钟。

**把私人 SSH 私钥、HF token 拷进租来的机器**。机器是别人的,Vast 上更是某位房东的。用 deploy key 或带 token 的 https 拉代码,密钥通过环境变量注入且随实例销毁。任何密钥进了 git 历史就当已经泄露,立刻吊销重新生成。

**在 Vast 上只比 GPU 小时价**。同一张 4090,房东的流量费能差 15 倍、存储费在 0.20 美元/GB/月上下。下 174 GB 模型流量费是 GPU 费四倍的账单真实存在。搜索时过滤 `inet_down_cost<0.01 storage_cost<0.3`。

**觉得网络卷「便宜又永久」就开一块**。它把你锁在一个数据中心,那里的便宜卡缺货时你的数据在别处用不了;而且必须创建 Pod 时挂上,忘了挂就等于没有。我们现在的数据量重下只要两分钟,网络卷解决的问题还不存在。等 M3 数据超过 100 GB 再说。

**把 trace 文件 push 进 git**。一次 profiler trace 几百 MB,git 仓库很快膨胀到 clone 要几分钟,而 clone 是每次开机的必经步骤。大于 10 MB 的走对象存储。

**照老攻略装 hf_transfer 加速下载**。官方文档已把它标为弃用,现在的加速路径是 `hf_xet`,`pip install "huggingface_hub[hf_xet]"` 即可。

**Vast 上 `--disk` 用默认 10 GB**。镜像加 torch 加 7B 权重就要 25 GB 以上,10 GB 在下载中途报磁盘错误,创建后不能扩,只能销毁重开。30 起步。

**混淆 Mbps 和 MB/s**。房东标的 200 Mbps 下行是 25 MB/s,13.5 GB 要 9 分钟,不是 1 分钟。算下载时间先除以 8。

**用 git-lfs 代替对象存储**。LFS 的免费额度按存储和月下载带宽算,每次开机 clone 都消耗带宽额度,几百 MB 的 trace 反复拉很快就要付费。大文件走出站免费的 R2,git 只管代码和小结果。

**只备份不验证**。rclone 推完不看返回码,结果 R2 上是空的,实例一删数据就真没了。Day 22 的脚本要把「同步成功」写成销毁的前置条件,今天手动做时也要 `rclone ls r2:aiinfra-lab/traces` 看一眼再删。

## 参考资料

文章与文档

- RunPod 文档《Storage options》,容器盘 / 卷盘 / 网络卷的对比表和费率,本文第一张表的出处。https://docs.runpod.io/pods/storage/types
- RunPod 文档《Pods · Pricing》,存储计费表(运行 / 停机两栏)、余额归零时有无网络卷的不同处理。https://docs.runpod.io/pods/pricing
- RunPod 文档《Manage Pods》,stop 释放 GPU 但卷盘继续计费、重启可能分到零 GPU。https://docs.runpod.io/pods/manage-pods
- RunPod 文档《Create network volumes》,网络卷的创建与限制(创建 Pod 时挂载、锁定数据中心)。https://docs.runpod.io/pods/storage/create-network-volumes
- RunPod 文档《Transfer files》,scp / rsync / runpodctl send 与 receive / 云同步几种传输方式。https://docs.runpod.io/pods/storage/transfer-files
- RunPod 文档 runpodctl send。https://docs.runpod.io/runpodctl/reference/runpodctl-send
- Vast.ai 文档《Storage》,容器盘停机计费、卷绑定物理机、怎样避免存储费的原文。https://docs.vast.ai/instances/storage
- Vast.ai 文档《Volumes》。https://docs.vast.ai/instances/volumes
- Vast.ai 文档《Pricing》,流量费和存储费由房东定价的说明。https://docs.vast.ai/instances/rental-types
- Hugging Face 文档《Manage your cache》,blobs / snapshots / refs 三层结构和清理方法。https://huggingface.co/docs/huggingface_hub/guides/manage-cache
- Hugging Face 文档《Environment variables》,HF_HOME、HF_HUB_CACHE、HF_TOKEN 的定义。https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables
- Hugging Face 文档《Download files》,`hf download` 命令行与 Python 两种下载方式。https://huggingface.co/docs/huggingface_hub/guides/download
- RunPod 文档《Manage secrets》,平台侧存密钥并注入为环境变量。https://docs.runpod.io/pods/templates/secrets
- Vast.ai 文档《Cloud Sync》,实例目录同步到 S3 / Google Drive。https://docs.vast.ai/instances/cloud-sync
- Cloudflare R2《Object lifecycles》,按前缀设自动过期。https://developers.cloudflare.com/r2/buckets/object-lifecycles/
- Docker 文档《What is an image?》和《Storage》,镜像分层与卷的概念,解释容器盘为什么随 stop 消失。https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-an-image/ 和 https://docs.docker.com/engine/storage/
- Hugging Face 文档《Download files · Faster downloads》,hf_xet 的说明,以及 hf_transfer 已弃用。https://huggingface.co/docs/huggingface_hub/guides/download#faster-downloads
- GitHub 文档《About large files on GitHub》,单文件 50 MB 警告、100 MB 上限的出处。https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
- Cloudflare R2 价格页,免费额度 10 GB 存储、出站流量不计费的出处。https://developers.cloudflare.com/r2/pricing/
- rclone 官网。https://rclone.org/

视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Uk8v6xEmg&autoplay=0&high_quality=1" title="下载174GB模型,流量费竟是GPU费的4倍?Vast.ai真实账单复盘" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>春日野穹b · 《下载174GB模型,流量费竟是GPU费的4倍?Vast.ai真实账单复盘》(5 分钟)。一份真实账单,Vast 流量费那一节的最好注脚。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/MwxbX6PNiWA" title="A Beginner's Guide To Rclone" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>DeAndre Wilson · 《A Beginner's Guide To Rclone》。rclone 的配置、上传、下载、同步各一小段,看到 sync 那节就够用。</figcaption>
</figure>

## 自测

合上笔记做。

1. RunPod 的容器盘、卷盘、网络卷在 stop 和 delete 时各是什么命运?停机时各收多少钱?

<details><summary>答案</summary>

容器盘 stop 即清空,不收停机费;卷盘 stop 保留但费率从 0.10 翻倍到 0.20 美元/GB/月,delete 清空;网络卷 stop 和 delete 都保留,0.07 美元/GB/月不变,但必须创建 Pod 时挂上且锁定数据中心。

</details>

2. 一块 50 GB 卷盘,每周运行 6 小时、停机 162 小时,一个月存储费大约多少?占月预算几成?

<details><summary>答案</summary>

停机部分 50 × 0.20 × 162/720 ≈ 2.25 美元/周,运行部分可忽略,一个月约 10 美元。月预算 30 到 60 美元,占 17% 到 33%。而且重启不保证有 GPU。

</details>

3. 13.5 GB 的 7B 权重在 200 Mbps 和 1 Gbps 下行带宽下各要下多久?为什么 Vast 搜索要加 `inet_down>200`?

<details><summary>答案</summary>

200 Mbps = 25 MB/s,540 秒 = 9 分钟;1 Gbps = 125 MB/s,108 秒约 2 分钟。Mbps 要除以 8 才是字节速率。不加过滤可能挑到几十 Mbps 的房东机器,重下权重要等半小时以上,「每次重下」的方案就不成立了。

</details>

4. 决策树的第一个问题是什么?为什么它能让「每次 delete」变便宜?

<details><summary>答案</summary>

「这东西丢了,5 分钟能重造吗?」能重造的(pip 依赖、模型权重、数据集)一律不存,由 bootstrap 重造。不可重造的东西(代码、自己的结果)通常很小,进 git 或对象存储成本接近零。可重造的大、不可重造的小,所以什么都不留在盘上几乎不花钱。

</details>

5. HF 缓存目录里 blobs、snapshots、refs 各是什么?为什么在 RunPod 上要把 HF_HOME 指到 /workspace?

<details><summary>答案</summary>

blobs 是按内容哈希存的真实文件;snapshots/<commit>/ 是符号链接组成的、看起来像完整模型目录的视图;refs/main 记录分支对应的 commit。默认缓存在 `~/.cache/huggingface`,RunPod 上 `~` 在容器盘,stop 即清空,指到 `/workspace` 才能在 stop 后保住。

</details>

6. 为什么大于 10 MB 的结果不进 git?推到哪里,为什么选它?

<details><summary>答案</summary>

trace 一次几百 MB,进 git 会让仓库膨胀,而 clone 是每次开机的必经步骤。推到对象存储 Cloudflare R2:每月 10 GB 存储免费、出站流量不收费,从任何租来的机器拉回结果不额外花钱,rclone 直接支持。

</details>

7. 密钥怎么处理?为什么不把自己的 SSH 私钥拷到实例上?

<details><summary>答案</summary>

HF token、云 API key、R2 key、webhook 全部放本机 `.env`,开机时注入环境变量,随实例销毁,`.env` 进 `.gitignore`。实例是别人的机器(Vast 上是某位房东的),拉代码用只读 deploy key 或带 token 的 https,私人私钥留在本机。

</details>

8. 一次完整生命周期的第 7 步(推结果)失败了,第 8 步(销毁)该怎么办?这条规则怎么进 Day 22 的脚本?

<details><summary>答案</summary>

不能销毁。卷盘上的结果此刻是唯一副本,删了就没了。先修好同步(检查网络、R2 配置、`rclone ls` 核对),确认副本存在再销毁。Day 22 的自动销毁脚本要把「同步命令返回成功且远端能列出文件」写成硬前置条件,同步失败就只关 GPU 进程、发通知、不删实例。

</details>

## 明天预告

Day 21 把今天的方案写成脚本:一个 `bootstrap.sh`,开机后自动装固定版本的 torch 和 transformers、clone 代码、注入密钥、后台预热模型下载、打印 nvidia-smi 和 5 秒验货结果。目标是从点 Deploy 到能跑代码不到 5 分钟,全程不用手敲第二条命令。脚本要幂等,重复跑不出错;每一步用 `time` 记耗时,找出最慢的那一步;顺便比较「自定义 Docker 镜像」和「启动脚本」两条路各自的取舍。
