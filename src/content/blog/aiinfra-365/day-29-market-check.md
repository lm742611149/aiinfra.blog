---
title: 'Day 29 · 2026-09 市场校准：JD 里要什么，路线图哪里要加勾'
description: '拿真实招聘要求对照 Day 0 定的路线：样本从哪来、有多不完整，JD 里反复出现哪些词，哪些是路线图已经覆盖的、哪些是缺口。由此在路线图上加了六个勾，记下薪资快照和四条必须正视的限制。不改骨架，只补缺口。'
pubDate: 2026-09-05
regime: none
tags: ['market', 'roadmap', 'jd', 'career', 'aiinfra-365']
series: 'aiinfra-365'
day: 29
lang: 'zh'
---

## 今天要解决的问题

Day 0 定路线的时候,依据是几篇文章、几个人的判断和我自己对岗位的想象。一个月过去,该拿真实的招聘要求对一次账:市场上叫「推理优化」「AI Infra」的岗位,到底要什么,和路线图差在哪。

这一天不学技术,只做三件事:

1. 把找到的 JD 样本摊开,先说清样本从哪来、有多不完整。样本不全就下结论,和拿标称值当实测值是同一个错。
2. 数 JD 里反复出现的要求,对照路线图,标出已覆盖的和缺口。
3. 缺口变成路线图上具体的勾,薪资和限制照实记下来。

先说结论,免得下面读着焦虑:**推理优先的方向被验证了,骨架不改。** 加的是六个勾,不是换路。但薪资和地域那几条,比 Day 0 写的更冷一些,要如实记。

数字口径和 Day 0 一致。Day 0 里的薪资参照(北京 3 到 5 年 60 到 100 万,海外 TC 30 到 50 万美元以上)当时来自零散的公开信息,今天的样本会把它们校准到一个更实在的区间。两边不矛盾,Day 0 的数是头部,今天的数是主流。

## 样本从哪来,有多不完整

先把局限写在前面。

**Boss 直聘抓不到。** 它对非登录环境全封:页面靠 JS 渲染,接口对脚本返回「环境异常」。国内最大的招聘平台样本为零,这是今天最大的一个洞。

实际拿到的样本:

| 来源 | 数量 | 性质 | 局限 |
| --- | --- | --- | --- |
| 猎聘「推理优化」相关岗位榜单 | 39 条 | 国内,中高端为主,有薪资区间 | 猎聘偏中高端,低端岗位少;39 条不够做统计,只能看趋势 |
| 牛客上两条 JD | 2 条 | 一条 50 到 80k,一条 20 到 25k | 只有两条,方差极大,只当两个坐标点 |
| 清昴智能 2026 校招简章 | 6 个岗 | 推理框架公司的岗位拆分方式 | 校招口径,对社招参考有限 |
| 博客园《2026 大厂 AI Infra 四象限》类文章 | 1 篇 | 岗位分层的框架 | 二手总结,作者口径 |
| 博客园 xmwblogs 的 AI Infra 面试题库 | 1 篇 | 面试考什么 | 题库不是 JD,但反映面试官关心什么 |
| Baseten 招聘页 | 若干 | 海外推理服务公司,给了薪资 band | 只有一家,且明确限美国和加拿大 |
| levels.fyi ML Infrastructure 分组 | 聚合数据 | 海外薪资分布 | 自报数据,偏大厂 |

合起来五十条左右,国内为主,海外只有一家公司加一个聚合站。这个量级能回答「JD 里哪些词反复出现」,不能回答「有多少岗位」「平均薪资是多少」。下面所有「高频」「中频」的判断都是在这五十条里数出来的趋势,不是市场统计。到 M5 试水面试时,要用真实面试反馈再校一次。

## JD 里反复出现的东西

把五十条 JD 的要求拆成条目,合并同义词,按出现频度分三档。频度是在这批样本里数出来的相对档位,不给具体百分比,样本量撑不起百分比。

| 要求 | 频度 | 路线图里对应哪里 | 状态 |
| --- | --- | --- | --- |
| Python + C++/CUDA 阅读或编写能力 | 高,几乎每条 | M5 Triton;裸 CUDA 原计划只在 PMPP 里读 | **缺口**:几乎所有 JD 要 C++/CUDA,原路线图没有一次真写裸 CUDA |
| 熟悉 vLLM / SGLang / TensorRT-LLM 至少一种,部分要求「精通源码」 | 高 | M3 读 vLLM 源码 | 部分覆盖:vLLM 有,**SGLang 没有** |
| 量化(INT8/INT4/FP8、GPTQ/AWQ/SmoothQuant) | 高 | W7 与 W14 | 覆盖 |
| KV cache 优化、PagedAttention、prefix caching | 高 | W5、W11 | 覆盖 |
| continuous batching、调度 | 高 | W6、W10、W27 到 W29 | 覆盖 |
| 分布式推理:TP / PP / 多机多卡部署 | 中高 | 原计划推理侧全单卡,M9 才碰多卡 | **缺口**:没有任何推理侧多卡实证 |
| speculative decoding | 中 | 无 | **缺口** |
| GQA / MoE 等架构对推理的影响 | 中 | Day 4 提过 GQA 一句 | **缺口**:MoE 完全没有 |
| 算子开发、kernel 性能优化(FlashAttention 类) | 中,算子岗为硬性 | M5 到 M6 | 覆盖,但见下文「别冲算子岗」 |
| K8s、GPU 调度、容器化部署、监控 | 中,平台层岗位为主 | 无 | **缺口**,但属于平台层 |
| 模型服务化:Triton Inference Server、API 网关、灰度 | 中 | 无 | 平台层,暂不补 |
| profiler:Nsight Systems / Nsight Compute / torch.profiler | 中 | W2 torch.profiler | 部分覆盖,Nsight 到 M5 顺带 |
| 训练框架:Megatron / DeepSpeed / FSDP | 中低,训练岗 | M9 到 M10 | 覆盖,时间点合理 |
| 论文跟踪、复现最新推理优化工作 | 低 | 无 | 不补,研究岗口径 |

数完这张表,两个观察。

第一,路线图的骨架是对的。高频的五项里四项已经在路线里,而且时间点安排得合理,W5 到 W7 正好是 KV cache、batching、量化。这不是巧合,Day 0 的判断「先攻推理」在 JD 里得到了直接验证:推理侧的词占了高频区的全部。

第二,缺口集中在两类。一类是「知识补丁」,GQA、MoE、speculative decoding,各花一两天读懂原理就够,不需要实测;另一类是「实证补丁」,SGLang 对照、两卡 TP、裸 CUDA、K8s,每个都要真动手,但可以控制在一到两周内,而且能挂在已有的周上。

## 四象限:岗位分层在哪

博客园那篇四象限文章给了一个分层框架,我拿 JD 样本对了一遍,基本吻合。横轴是技术门槛,纵轴是岗位数量:

<figure>
<svg viewBox="0 0 640 380" role="img" aria-label="AI Infra 岗位四象限:平台层岗位多门槛低,推理引擎岗位中等,算子内核岗位少门槛高,训练框架岗位少且集中在大厂">
  <line x1="80" y1="320" x2="600" y2="320" stroke="var(--rule)"/>
  <line x1="80" y1="40" x2="80" y2="320" stroke="var(--rule)"/>
  <line x1="340" y1="40" x2="340" y2="320" stroke="var(--rule-soft)" stroke-dasharray="4 4"/>
  <line x1="80" y1="180" x2="600" y2="180" stroke="var(--rule-soft)" stroke-dasharray="4 4"/>
  <text x="340" y="352" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">技术门槛 →</text>
  <text x="30" y="36" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">岗位量 ↑</text>
  <rect x="96" y="60" width="228" height="104" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="210" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">平台层 / MLOps</text>
  <text x="210" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">GPU 调度、K8s、模型服务化、监控</text>
  <text x="210" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">岗位最多,约占一半;30+ 后端转行最常见入口</text>
  <text x="210" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">路线图:W42+ 保底两周</text>
  <rect x="356" y="60" width="228" height="104" rx="4" fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="2"/>
  <text x="470" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">推理引擎 / 推理优化</text>
  <text x="470" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">vLLM/SGLang、量化、KV cache、batching</text>
  <text x="470" y="128" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">岗位中等,溢价高,JD 高频词全在这</text>
  <text x="470" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">路线图主线:M1–M8</text>
  <rect x="96" y="196" width="228" height="104" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="210" y="222" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">训练框架 / 集群</text>
  <text x="210" y="244" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Megatron、FSDP、NCCL、千卡容错</text>
  <text x="210" y="264" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">岗位少,集中在训基座的大厂和实验室</text>
  <text x="210" y="286" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">路线图:M9–M10</text>
  <rect x="356" y="196" width="228" height="104" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="470" y="222" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">算子 / kernel</text>
  <text x="470" y="244" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">CUDA/Triton 手写、FlashAttention 级优化</text>
  <text x="470" y="264" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">岗位少,门槛最高,硬性要求手写 CUDA</text>
  <text x="470" y="286" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">路线图:M5–M6 只做到能读、能写一个</text>
</svg>
<figcaption>岗位分层的四象限。主线压在右上的推理引擎象限,左上的平台层是保底,右下的算子岗不作为目标,只做到能读能写一个。</figcaption>
</figure>

对照我的路线,主线压在右上角「推理引擎」这一格。这一格的特点是:JD 高频词几乎全部落在这里,岗位量比平台层少但比算子岗多,门槛卡在「懂原理、能实测、能读源码」,正好是路线图 M1 到 M8 在做的事。

左上角「平台层」岗位最多,JD 里 K8s、调度、服务化那几条都来自这一格。它对我这种后端背景的人最友好,但 infra 的溢价也最低,因为它更像「带 GPU 的运维」。路线图 W42 的保底两周就是给这一格留的门,不做主线。

右下角「算子」是门槛最高的一格。算子岗的 JD 写的是「精通 CUDA,有 FlashAttention 级别优化经验」,这不是 12 个月业余时间能补到的,而且 M5 到 M6 的产出物 02 只需要证明「能碰底层」,不需要「能靠这个吃饭」。下面「正视四条」里的「别冲算子岗」就是说这一格。

## 由此加的六个勾

缺口变成路线图上的具体条目,每条挂在已有的周上,不新开月份。加勾的原则:能读懂原理就行的,一两天;要实证的,不超过一周;全部加起来不超过三周,不动 M12 的终点。

| 勾 | 挂在哪 | 做什么 | 验收 | 依据 |
| --- | --- | --- | --- | --- |
| W5+ GQA / MoE | M2 W5 之后 | GQA 怎么改 KV cache 公式(n_kv_heads × head_dim 代替 d,Day 4 已经提了一句);MoE 的 expert 是什么,为什么「激活参数」远小于总参数,对 decode 的字节数意味着什么。ZOMI 模块 6.2 正好 | 能重算 Llama-3-8B 的 KV cache/token,能解释 MoE 模型「总参数 100B+ 但每 token 只搬十几 B」 | 智谱、Kimi、MiniMax 面试题集中在这里 |
| W7+ speculative decoding | M2 W7 之后 | 读 vLLM 的实现:draft 模型出候选、目标模型一次验证、接受率决定收益。不实测,能讲清为什么它能加速 memory-bound 的 decode 就行 | 用 Day 5 的框架说出:一次搬权重验证多个 token = 变相提高算术强度 | 字节、美团、Meta、OpenAI 题库必考 |
| W10+ SGLang 对照 | M3 W10 之后 | 对照读 SGLang 的 scheduler 和 RadixAttention,记下和 vLLM 调度思路的三点差别。长上下文和 Agent 场景它更常被问 | 三点差别写成一页 | 清昴等要求「精通 SGLang/vLLM/TensorRT-LLM 源码」 |
| W13+ 两卡 TP | M3 W13 之后 | 租两张卡跑一次 `--tensor-parallel-size 2`,测通信在每步里占多少、吞吐比单卡涨多少。几十块钱 | 一张表:单卡 vs 两卡的 TPOT、吞吐、通信占比 | 百融、清昴、猎聘多条「多机多卡部署」 |
| W20+ 裸 CUDA | M5 W20 之后 | 跟 PMPP 写一个 reduce 或 softmax 的裸 CUDA 版,和 W17 的 Triton 版对比;顺手把 vLLM 里一个 attention kernel 的 C++ 读通 | 能说出那个 kernel 里每个 block 在干什么 | Python + C++/CUDA 是所有 JD 的公共分母 |
| W42+ K8s 保底 | M11 W42 之后 | 把产出物 03 用 K8s 部署起来:GPU device plugin、资源请求、按负载扩缩。**保底不是主线,主线四个产出物没做完别碰它** | 一条 `kubectl apply` 起服务,压测时能看到扩缩 | 平台层岗位占招聘量一半,是国内出口的入场券 |

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="路线图时间线上六个新增勾的位置:W5+、W7+、W10+、W13+、W20+、W42+">
  <line x1="40" y1="100" x2="610" y2="100" stroke="var(--rule)" stroke-width="2"/>
  <g font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">
    <text x="40" y="128" text-anchor="middle">W1</text>
    <text x="146" y="128" text-anchor="middle">W8</text>
    <text x="252" y="128" text-anchor="middle">W16</text>
    <text x="358" y="128" text-anchor="middle">W24</text>
    <text x="464" y="128" text-anchor="middle">W32</text>
    <text x="570" y="128" text-anchor="middle">W40</text>
    <text x="610" y="128" text-anchor="middle">W48</text>
  </g>
  <g stroke="var(--rule)" stroke-width="1">
    <line x1="40" y1="94" x2="40" y2="106"/><line x1="146" y1="94" x2="146" y2="106"/><line x1="252" y1="94" x2="252" y2="106"/>
    <line x1="358" y1="94" x2="358" y2="106"/><line x1="464" y1="94" x2="464" y2="106"/><line x1="570" y1="94" x2="570" y2="106"/><line x1="610" y1="94" x2="610" y2="106"/>
  </g>
  <rect x="40" y="86" width="330" height="28" fill="var(--mem-wash)" opacity="0.6"/>
  <text x="205" y="150" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">推理主线 M1–M8</text>
  <g font-family="var(--font-mono)" font-size="11">
    <circle cx="106" cy="100" r="5" fill="var(--mem)"/><text x="106" y="66" text-anchor="middle" fill="var(--ink)">W5+ GQA/MoE</text>
    <circle cx="133" cy="100" r="5" fill="var(--mem)"/><text x="150" y="44" text-anchor="middle" fill="var(--ink)">W7+ spec decoding</text>
    <circle cx="173" cy="100" r="5" fill="var(--mem)"/><text x="190" y="66" text-anchor="middle" fill="var(--ink)">W10+ SGLang</text>
    <circle cx="212" cy="100" r="5" fill="var(--mem)"/><text x="240" y="44" text-anchor="middle" fill="var(--ink)">W13+ 两卡 TP</text>
    <circle cx="305" cy="100" r="5" fill="var(--compute)"/><text x="305" y="66" text-anchor="middle" fill="var(--ink)">W20+ 裸 CUDA</text>
    <circle cx="596" cy="100" r="5" fill="var(--ink-faint)"/><text x="570" y="66" text-anchor="middle" fill="var(--ink)">W42+ K8s 保底</text>
  </g>
  <text x="325" y="184" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">六个勾全部挂在已有的周上,总量不超过三周,M12 终点不动</text>
</svg>
<figcaption>六个新勾在 48 周时间线上的位置。四个落在推理主线里,一个在 kernel 月,一个在收口期当保底。</figcaption>
</figure>

这六个勾已经写进路线图 artifact,标签「2026-09 market check」。加完之后勾选项从 88 变成 94。

## 薪资快照

样本里能看到薪资的只有猎聘 39 条、牛客 2 条、Baseten 一家、levels.fyi 一个分组。写下来只是一个快照,不是结论。

**国内。** 猎聘榜单上「推理优化」岗 3 到 5 年经验的主流区间是月薪 30 到 60k,乘 15 到 16 薪,年包 45 到 95 万。牛客那两条是两个极端:一条 50 到 80k(推理框架方向,要求源码级),一条 20 到 25k(部署运维方向)。Day 0 写的「北京 3 到 5 年 60 到 100 万」对应的是这个区间的上半段加头部大厂,不矛盾,但要清楚**主流是 30 到 60k,不是 60 到 100 万**。5 到 8 年、带过团队或有知名开源贡献的,才进 Day 0 说的 100 到 180 万那一档。

**海外。** Baseten 的推理相关岗位标的 band 是 16.5 到 33 万美元,**明确限美国和加拿大境内**。levels.fyi 的 ML Infrastructure 分组里大厂中级到高级在 30 到 50 万美元,这是 Day 0 那个「30 到 50 万美元以上」的出处。但这两个数对我的实际意义要打折:

- 远程岗按全美 band 比旧金山低 10 到 15%。
- 中国境内以 contractor 或 EOR 方式受雇,通常只拿到美国 band 的 40 到 70%。

也就是说,如果真的拿到一个 band 20 万美元的远程岗,到手大概率是 8 到 14 万美元。这仍然远高于国内主流区间,但不是「30 到 50 万美元」那个数字给人的想象。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="薪资区间对比条:国内主流 45–95 万人民币,国内头部 100–180 万,海外 band 16.5–50 万美元,海外远程 contractor 折后约 8–14 万美元">
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="46" fill="var(--ink)">国内 3–5 年主流</text>
    <rect x="200" y="34" width="120" height="16" fill="var(--mem)"/>
    <text x="328" y="46" fill="var(--ink-soft)">45–95 万 RMB(猎聘 39 条)</text>
    <text x="20" y="86" fill="var(--ink)">国内 5–8 年头部</text>
    <rect x="260" y="74" width="160" height="16" fill="var(--mem)" opacity="0.6"/>
    <text x="428" y="86" fill="var(--ink-soft)">100–180 万 RMB(Day 0 口径)</text>
    <text x="20" y="126" fill="var(--ink)">海外 band(美加境内)</text>
    <rect x="300" y="114" width="260" height="16" fill="var(--compute)"/>
    <text x="300" y="146" fill="var(--ink-soft)">16.5–50 万 USD(Baseten / levels.fyi)</text>
    <text x="20" y="186" fill="var(--ink)">海外远程,境内 contractor</text>
    <rect x="230" y="174" width="110" height="16" fill="var(--compute)" opacity="0.55"/>
    <text x="348" y="186" fill="var(--ink-soft)">约 8–14 万 USD(band × 40–70%)</text>
  </g>
  <text x="320" y="218" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">横向长度只示意相对量级,人民币与美元条不按同一比例;样本量小,是快照不是统计</text>
</svg>
<figcaption>四个区间摆在一起看。海外 band 那条最长,但对我实际适用的是最下面那条折过的。</figcaption>
</figure>

## 正视四条

对照 JD 和样本,有四条限制是路线图里没写、今天必须补上的。

**一、30 到 35 岁是一条红线,在国内尤其明显。** 多条 JD 直接写「35 岁以下」,更多的没写但校招和 3 到 5 年经验的岗位占了大头。我转过去时是按 AI 年限重新定级的,第一份大概率降级,而年龄会让「降级进」这件事比年轻人更难。这不改变路线,但改变节奏:M5 到 M6 试水面试不能拖,越早知道市场怎么看我这个年龄段的转行者,越早调整。

**二、别冲算子岗。** 算子岗的 JD 写「精通 CUDA、有 FlashAttention 级别优化经验、熟悉 Hopper 架构特性」,这是全职做了几年 kernel 的人的画像,不是业余 12 个月能到的。M5 到 M6 做产出物 02 的目的是证明「能读懂 vLLM 里的 kernel、能写一个正确且比 eager 快的」,面试时能讲清 tiling 和 shared memory,够用了。把算子岗当目标会在 M6 陷入无止境的优化,拖垮 M7 到 M8 的引擎项目。

**三、学历。** 样本里推理优化岗以本科为主要求,硕士优先的不少,算子岗和训练框架岗博士优先的比例明显更高。本科够进推理引擎象限,但在算子和训练象限会被简历筛掉一部分。这又是一条「主线压在推理引擎象限」的理由。

**四、海外地域限制是真的。** Baseten 明确限美加,levels.fyi 上的数据也几乎全是北美。海外远程在 Day 0 排出口第一,这个排序不变,因为它的期望值仍然最高;但要清楚它同时是**岗位数量最少**的那个出口,多数公司连申请入口都没给境外候选人留。进入方式仍然是社区可见度,不是投简历。

## 「远程也不难吧」这个念头

写到这里我自己冒出过一个念头:Baseten 的 JD 读起来要求不算苛刻,列的技术点我 M8 之后大部分都会碰过,海外远程好像也不难。

这个念头要掐掉。**难的不是技术门槛,是地域限制和岗位数量。** JD 写得松,是因为它假设申请人已经在美加境内、已经有合法工作身份,技术要求只是筛选的第二关。对境外候选人来说,第一关就没开门。一条要求写得松的 JD,不等于一个好进的岗位。

所以海外远程这条路的正确读法是:期望值最高,概率最低,靠社区可见度而不是投递。M5 到 M6 的第一个开源 PR、GPU MODE 排行榜上的成绩,是给这条路开门的唯一钥匙。技术学得再好,不在社区里露面,这条路上就没有入口。

## 这次校准改了什么,没改什么

没改的:

- 推理优先,不先碰分布式训练。JD 高频词全部落在推理侧,验证了这个判断。
- 四个产出物和 M12 终点不动。
- 六样资源不加。SGLang 是拿来对照读的,不是新资源。
- 三个出口的排序不动:海外远程、国内平台层、留现公司转应用。

改的:

- 加六个勾,总量不超过三周,全部挂在已有的周上。
- 薪资参照从「头部」校准到「主流」,并且把海外 band 折算成境内 contractor 的实际到手。
- 补四条限制:年龄红线、不冲算子岗、学历分布、海外地域。
- 试水面试的时间点从「M5 到 M6」改成「M5 一到就开始」,年龄这条让校准不能等。

下一次校准放在 M5 结束,那时候手里有产出物 01 和至少一次真实面试反馈,样本质量会比今天这五十条 JD 好得多。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| JD | Job Description,招聘岗位描述。今天的样本单位 |
| 推理引擎 | 把训练好的模型跑起来对外提供服务的软件,vLLM、SGLang、TensorRT-LLM 都是。四象限右上那一格 |
| 平台层 / MLOps | GPU 调度、K8s 部署、模型服务化、监控这一层,岗位最多,溢价最低。四象限左上 |
| 算子 / kernel 岗 | 手写 CUDA 或 Triton kernel 做性能优化的岗位,门槛最高。四象限右下 |
| TP / PP | Tensor Parallel / Pipeline Parallel,把一个模型切到多张卡上的两种方式。W13+ 要实测 TP |
| speculative decoding | 用小模型先猜几个 token,大模型一次验证,用一次搬权重换多个 token。W7+ 读原理 |
| GQA | Grouped-Query Attention,多个 q 头共享一组 k、v 头,KV cache 缩小。Day 4 提过 |
| MoE | Mixture of Experts,FFN 拆成多个 expert 每个 token 只走其中几个,总参数大但每 token 激活参数小 |
| RadixAttention | SGLang 用前缀树管理 KV cache 复用的机制,W10+ 对照读 |
| band | 一个岗位级别的薪资区间 |
| contractor / EOR | 境外人员为美国公司工作的两种常见形式:独立合同工,或通过第三方雇主(Employer of Record)代雇。通常拿美国 band 的 40 到 70% |
| TC | Total Compensation,总包,含基本工资、奖金、股票 |

## 常见误区

**拿五十条 JD 当市场统计。** 五十条能看趋势,不能算比例和平均值。今天所有「高频」「中频」都是相对档位,写百分比就是在造数。Boss 直聘的空白是最大的洞,国内低端和中端岗位的分布今天基本看不到。

**把 Day 0 的薪资数当主流。** Day 0 的 60 到 100 万是头部,猎聘样本的主流是 30 到 60k 月薪。两个数都对,但衡量进度时要用主流那个,否则会一直觉得自己「还不够」。

**看到 JD 写得松就以为岗位好进。** 海外 JD 松是因为它假设你已经在境内。地域是第一关,技术是第二关。

**因为 JD 要 C++/CUDA 就去冲算子岗。** 所有 JD 要 C++/CUDA 阅读能力,这是公共分母,W20+ 补一个裸 CUDA kernel 就够。算子岗要的是「精通」和「FlashAttention 级别经验」,那是另一个量级,不是我的目标。

**因为平台层岗位多就把主线换成 K8s。** 平台层岗位多,溢价也最低,而且不需要 M1 到 M8 这套判断力,做它就浪费了前面八个月。K8s 是 W42 的保底两周,主线做完再碰。

**校准一次就不管了。** 今天的样本质量一般,M5 有了产出物和面试反馈要再校一次。JD 是滞后指标,面试官的问题才是实时的。

## 参考资料

### 招聘与薪资

- 猎聘,「推理优化」相关岗位榜单。需要登录浏览器查看,样本 39 条摘录于 2026 年 9 月 4 日。https://www.liepin.com
- 牛客网,两条 JD 的出处,需按岗位名搜索。https://www.nowcoder.com
- Baseten 招聘页,海外推理服务公司的岗位与薪资 band,明确限美加。https://www.baseten.co/careers/
- levels.fyi,ML Infrastructure 分组的薪资分布,自报数据。https://www.levels.fyi/t/software-engineer/focus/ml-infrastructure
- 清昴智能 2026 校招简章,推理框架公司的六个岗位拆分,按「清昴智能 2026 校招」搜索。
- 博客园,《2026 大厂 AI Infra 四象限》类文章,岗位分层框架的出处,按标题关键词搜索。
- 博客园 xmwblogs,AI Infra 面试题库,反映面试官关心的点,W5+ 到 W20+ 几个勾的题目依据。https://www.cnblogs.com/xmwblogs/p/19669357

### 缺口对应的技术入口

- vLLM 文档,W10 主线要读的引擎。https://docs.vllm.ai
- SGLang 文档,W10+ 对照读的引擎,重点是 RadixAttention 和 scheduler。https://docs.sglang.ai
- NVIDIA TensorRT-LLM 仓库,JD 里第三个常见名字,只需知道它是什么、和前两者的定位差别。https://github.com/NVIDIA/TensorRT-LLM
- Kubernetes 文档,Schedule GPUs,W42+ 保底那两周的入口。https://kubernetes.io/docs/tasks/manage-gpus/scheduling-gpus/
- GPU MODE lectures 仓库,W20+ 裸 CUDA 和社区可见度的入口。https://github.com/gpu-mode/lectures

### 视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/yhAdULfnERw" title="The rise of inference engineering with Philip Kiely | Sigsum 2025" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Statsig 频道,Philip Kiely(Baseten)《The rise of inference engineering》,Sigsum 2025。一个推理服务公司的人讲「推理工程」这个岗位是怎么长出来的、要什么人。对照本文四象限右上那一格听,他说的每一项都能在 JD 高频表里找到。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/SQ3fZ1sAqXI" title="Stanford CS336 Language Modeling from Scratch | Spring 2025 | Lecture 1: Overview and Tokenization" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Stanford Online,CS336 Language Modeling from Scratch 2025 第 1 讲 Overview and Tokenization。Day 0 定的视频主线之一,开头那段讲课程为什么要「从零写」和课程结构,可以对照今天的六个勾看哪几讲能补上 GQA/MoE、并行和推理那几块。</figcaption>
</figure>

## 自测

合上笔记做。

1. 今天的 JD 样本有哪几个来源?最大的一个洞是什么?为什么不能写百分比?

<details><summary>答案</summary>

猎聘 39 条、牛客 2 条、清昴 2026 校招简章 6 岗、博客园四象限文章和面试题库、Baseten 招聘页、levels.fyi。最大的洞是 Boss 直聘对非登录环境全封,国内最大平台样本为零。五十条左右只能看趋势档位,写百分比是在用小样本造统计。

</details>

2. JD 高频要求里哪几项路线图已经覆盖?哪几个是缺口?

<details><summary>答案</summary>

覆盖:vLLM 源码、量化、KV cache 与 PagedAttention、continuous batching、profiler。缺口:C++/CUDA 真写(原路线只读 PMPP)、SGLang 对照、分布式推理 TP、speculative decoding、GQA/MoE、K8s 平台层。

</details>

3. 六个新勾分别挂在哪一周?加勾的原则是什么?

<details><summary>答案</summary>

W5+ GQA/MoE、W7+ speculative decoding、W10+ SGLang、W13+ 两卡 TP、W20+ 裸 CUDA、W42+ K8s 保底。原则:全部挂在已有的周上,能读懂原理就行的一两天,要实证的不超过一周,总量不超过三周,M12 终点不动。

</details>

4. Day 0 写的「北京 3 到 5 年 60 到 100 万」和今天猎聘的「30 到 60k 月薪」矛盾吗?衡量进度用哪个?

<details><summary>答案</summary>

不矛盾。Day 0 的数是头部大厂加区间上半段,猎聘的 30 到 60k 乘 15 薪约 45 到 95 万是主流。衡量进度用主流那个,否则会一直觉得不够。

</details>

5. 一条海外 JD 技术要求写得不苛刻,能推出「这个岗位好进」吗?海外远程这条路真正的难点是什么?

<details><summary>答案</summary>

不能。JD 松是因为它假设申请人已在美加境内、有工作身份,技术只是第二关,地域是第一关。难点是岗位数量最少和地域限制,不是技术门槛。进入方式是社区可见度(开源 PR、GPU MODE 排行榜),不是投递。

</details>

6. 为什么所有 JD 要 C++/CUDA,路线图却写「别冲算子岗」?这两句话矛盾吗?

<details><summary>答案</summary>

不矛盾。C++/CUDA 阅读和写一个简单 kernel 是公共分母,W20+ 补一个裸 CUDA 的 reduce 或 softmax 就够。算子岗要的是「精通」加「FlashAttention 级别优化经验」,是全职几年的量级,业余 12 个月到不了;把它当目标会在 M6 陷入无止境优化,拖垮 M7 到 M8 的引擎项目。

</details>

## 明天预告

Day 30 是 M1 的总收口。把四周加加餐周的一页笔记再压成一页:W1 的账本(6.74B、13.5 GB、512 KB/token、150 tok/s、ridge 153),W2 的计时和 profiler(synchronize、TTFT/TPOT、top 5 kernel、gap),W3 的实测屋顶(带宽、算力、自己的 roofline、batch 扫描的转折点),W4 的环境流水线(开机、持久化、bootstrap、三层销毁、账本),加餐周的 GPU 解剖、数值格式、CUDA 执行模型、规格表阅读。然后合上笔记做 20 道全月自测,把错题本按「形状、单位、异步、标称」四类汇总,最后写 M2 的预告:W5 KV cache 开关实测、W5+ GQA/MoE、W6 continuous batching 时序图、W7 量化三角、W8 第一篇公开技术帖。
