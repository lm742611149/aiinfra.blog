---
title: 'Day 7 · 第一次真上手：Colab 上跑通 TinyLlama 推理'
description: 'W1 一行代码没写，今天开始写。在 Colab 的免费 T4 上加载一个 1.1B 的模型跑通 generate，搞清第一次为什么慢好几倍，再把连续十次运行的延迟方差压到 10% 以内。这周所有实测数字的可信度，从今天的 warmup 开始。'
pubDate: 2026-09-05
regime: none
tags: ['colab', 't4', 'tinyllama', 'transformers', 'warmup', 'aiinfra-365']
series: 'aiinfra-365'
day: 7
lang: 'zh'
---

## 今天要解决的问题

W1 六天算出来一堆数:13.5 GB、512 KB、150 token/s、153。全部是纸上的。它们对不对,得有一台真机器来对账,W2 就是干这件事的。

但对账之前有个更基础的问题:我得先让一个模型在 GPU 上跑起来,而且跑出来的时间要**稳定**。不稳定的数字什么都对不了。所以今天的目标只有三条,一条都不涉及性能优化:

1. 在 Colab 的免费 GPU 上,用 transformers 加载一个 1B 级的模型,跑通 `generate`,吐出一段像样的文字。
2. 解释第一次运行为什么比后面慢好几倍,并且知道怎么跳过它。
3. 连续跑 10 次同样的生成,延迟的方差压到 10% 以内。做不到就是没 warmup,今天不算过。

第三条是路线图定下的验收标准。路线图还提前警告过:这周的坑几乎全在环境和 CUDA 异步上,跟深度学习没关系。今天会碰到其中的前几个。

## 为什么是 Colab,为什么是 T4

W1 说过成本纪律:Colab 免费版起步,付费从 W4 才开始。Colab 免费给的卡通常是 NVIDIA T4,偶尔会换成别的,所以每次开机第一件事就是看清楚拿到的是什么卡。

T4 是 2018 年的卡,Turing 架构,给推理场景设计的,功耗只有 70 瓦。它和 W1 用来算账的 A100 差得很远,先把关键数摆在一起:

| 指标 | T4(Colab 免费) | A100 80GB SXM(W1 口径) | 差几倍 |
| --- | --- | --- | --- |
| 显存 | 16 GB GDDR6 | 80 GB HBM2e | 5× |
| 显存带宽 | 320 GB/s | 2039 GB/s | 6.4× |
| fp16 tensor core 算力 | 65 TFLOP/s | 312 TFLOP/s(BF16) | 4.8× |
| fp32 算力 | 8.1 TFLOP/s | 19.5 TFLOP/s | 2.4× |
| ridge point(算力 ÷ 带宽) | 65e12 ÷ 320e9 ≈ 203 | 312e12 ÷ 2039e9 ≈ 153 | |
| 支持 bf16 | **不支持** | 支持 | |
| 架构 | Turing(2018) | Ampere(2020) | |

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="T4 与 A100 在显存、带宽、算力三项上的对比条形图">
<text x="8" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">T4(上)vs A100(下),按 A100 归一化</text>
<text x="8" y="52" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">显存</text>
<rect x="80" y="40" width="108" height="12" fill="var(--mem)" opacity="0.55"/>
<rect x="80" y="56" width="540" height="12" fill="var(--mem)"/>
<text x="192" y="50" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">16 GB</text>
<text x="565" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--paper-raised)">80 GB</text>
<text x="8" y="106" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">带宽</text>
<rect x="80" y="94" width="85" height="12" fill="var(--mem)" opacity="0.55"/>
<rect x="80" y="110" width="540" height="12" fill="var(--mem)"/>
<text x="170" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">320 GB/s</text>
<text x="536" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--paper-raised)">2039 GB/s</text>
<text x="8" y="160" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">fp16 算力</text>
<rect x="80" y="148" width="112" height="12" fill="var(--compute)" opacity="0.55"/>
<rect x="80" y="164" width="540" height="12" fill="var(--compute)"/>
<text x="197" y="158" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">65 TFLOP/s</text>
<text x="522" y="174" font-family="var(--font-mono)" font-size="11" fill="var(--paper-raised)">312 TFLOP/s</text>
<text x="8" y="200" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">带宽差 6.4 倍,算力差 4.8 倍。所以 T4 的 ridge point(203)反而比 A100(153)高:算力相对带宽更富余。</text>
</svg>
<figcaption>T4 各项都是 A100 的五分之一到六分之一。这意味着 W1 算出的所有「A100 上限」到了 T4 上都要重算,但算法一样。</figcaption>
</figure>

最后一行值得停一下。T4 的 ridge point 是 203,比 A100 的 153 还高。第一反应可能是「T4 更容易 compute-bound」,反了。ridge point 高的意思是**要达到更高的算术强度才能碰到算力屋顶**,也就是说在 T4 上,decode 这种强度为 1 的活离屋顶更远,memory-bound 得更彻底。这是 Day 5 那张图的第一次实战应用:换卡先算 ridge point,再判断 workload 落在哪一侧。

## 7B 为什么装不进 16 GB

Day 5 的显存四项在这里直接用。Llama-2-7B fp16 权重 13.5 GB,框架开销按 1.5 GB 算,加起来 15 GB。T4 标称 16 GB,实际可用大约 15 GB(驱动和显示会占一点),KV cache 一个字节都没放就已经贴着天花板了。batch 1、序列 512 的 KV cache 是 512 × 512 KB = 256 MB,加上激活,必爆。

所以 W2 用不了 7B,得换一个 1B 级的模型。这不影响结论:memory-bound 的现象在 1B 模型上和在 7B 上是一样的,因为 decode 的算术强度是 1,跟参数量无关(Day 5 算过,N 在分子分母约掉了)。换模型只是把「要搬多少字节」这个数变小,规律不变。

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="T4 的 16 GB 显存分别装 7B 和 1.1B 模型时的占用示意">
<text x="8" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">T4 的 16 GB 显存条(每格 1 GB)</text>
<g stroke="var(--rule)" stroke-width="1">
<rect x="8" y="34" width="624" height="26" fill="var(--paper-raised)"/>
<rect x="8" y="98" width="624" height="26" fill="var(--paper-raised)"/>
</g>
<rect x="8" y="34" width="526" height="26" fill="var(--mem)"/>
<rect x="534" y="34" width="59" height="26" fill="var(--ink-faint)"/>
<rect x="593" y="34" width="39" height="26" fill="var(--compute)"/>
<text x="14" y="52" font-family="var(--font-mono)" font-size="11" fill="var(--paper-raised)">Llama-2-7B fp16 权重 13.5 GB</text>
<text x="8" y="78" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">灰 = 框架开销 ~1.5 GB;琥珀 = 驱动预留 ~1 GB;KV cache 没地方放 → OOM</text>
<rect x="8" y="98" width="86" height="26" fill="var(--mem)"/>
<rect x="94" y="98" width="59" height="26" fill="var(--ink-faint)"/>
<rect x="153" y="98" width="9" height="26" fill="var(--mem)" opacity="0.5"/>
<rect x="593" y="98" width="39" height="26" fill="var(--compute)"/>
<text x="14" y="116" font-family="var(--font-mono)" font-size="11" fill="var(--paper-raised)">1.1B 2.2 GB</text>
<text x="170" y="116" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">剩 ~11 GB,够放 batch 32 × 2048 的 KV cache(1.5 GB)还绰绰有余</text>
<text x="8" y="150" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">同一张卡,换模型之后从「一个请求都放不下」变成「能开 batch 扫参」。W3 的 batch 扫描就靠这 11 GB。</text>
</svg>
<figcaption>7B 的权重加框架开销就把 T4 填满了,1.1B 只用七分之一。W2、W3 的所有实验都在下面这条上做。</figcaption>
</figure>

## 为什么是 TinyLlama-1.1B

候选有两个:TinyLlama-1.1B 和 Qwen2.5-0.5B。选 TinyLlama 的原因只有一个:它的结构和 Llama-2 一模一样,W1 学的所有零件名字都能直接对上,配置文件读起来不用换词。Qwen2.5-0.5B 留作备选,Colab 某天加载 TinyLlama 出问题就换它,数字重算一遍就行。

TinyLlama 的 `config.json` 关键字段:

```json
{
  "hidden_size": 2048,
  "intermediate_size": 5632,
  "num_hidden_layers": 22,
  "num_attention_heads": 32,
  "num_key_value_heads": 4,
  "vocab_size": 32000,
  "torch_dtype": "bfloat16"
}
```

用 Day 2 的方法把参数数一遍,顺便检验一下 W1 学的东西换个模型还灵不灵:

| 部件 | 形状 | 参数量 |
| --- | --- | --- |
| embedding | 32000 × 2048 | 65.5M |
| 每层 W^q | 2048 × 2048 | 4.19M |
| 每层 W^k | 2048 × (4 × 64) = 2048 × 256 | 0.52M |
| 每层 W^v | 2048 × 256 | 0.52M |
| 每层 W^o | 2048 × 2048 | 4.19M |
| 每层 FFN 三个矩阵 | 3 × 2048 × 5632 | 34.6M |
| 每层合计 | | 44.0M |
| 22 层 | 44.0M × 22 | 969M |
| lm_head(不和 embedding 共享) | 2048 × 32000 | 65.5M |
| 总计 | | **1.10B** |

对上了,名字里的 1.1B 就是这么来的。这里有一个 W1 没遇到的新东西:`num_key_value_heads` 是 4,不是 32。这就是 Day 4 末尾提过一句的 GQA(grouped-query attention):32 个 q 头共享 4 组 k、v 头,所以 W^k 和 W^v 不是 2048 × 2048 的方阵,而是 2048 × 256。head_dim 还是 2048 ÷ 32 = 64。

GQA 对今天的影响是 KV cache 变得很小:

```
每 token KV cache = 2 × 22 层 × (4 × 64) × 2 字节 = 22,528 字节 ≈ 22 KB
```

Llama-2-7B 是 512 KB,TinyLlama 只有它的二十三分之一。2048 token 的序列全部 KV cache 才 45 MB。这意味着在 W2、W3 的实验里,KV cache 几乎不会成为显存瓶颈,占大头的始终是 2.2 GB 的权重。

权重字节数:1.10e9 × 2 = 2.2 GB。这是今天最重要的一个数,因为 Day 9 要拿它算 decode 的理论下限:

```
2.2 GB ÷ 320 GB/s ≈ 6.9 ms/token → 约 145 token/s
```

先记下来,Day 9 用。

## 开机:拿到 GPU,记下卡型

Colab 新建 notebook 后,菜单 修改 → 笔记本设置 → 硬件加速器 选 GPU(免费版通常给 T4)。然后第一个 cell 永远是这个:

```bash
!nvidia-smi
```

输出的顶部一行有驱动版本和 CUDA 版本,中间那张表有卡名(`Tesla T4`)、显存(`15360MiB` 总量,已用几百 MiB)、功耗和利用率。现在只看两样:卡名和显存总量。卡名决定 Day 9 用哪个带宽数算下限;显存总量决定 W3 能开多大的 batch。`nvidia-smi` 那张表每一列的含义 Day 19 租实例时会完整讲一遍,今天不展开。

为什么每次都要记卡型?路线图那张坑表里写了:Colab 会断连、会换卡型,前后数字不可比。今天拿到 T4,明天可能是 L4 或者别的,带宽差一倍,同一段代码测出来的数完全不同。所以 W2 每篇的记录表第一列都是卡型,不是可选项。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1PgJDz7EHT&autoplay=0&high_quality=1" title="10分钟掌握Google Colab 最强薅羊毛!白嫖GPU!AI入门服务器!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿钟AI算法 · 《10分钟掌握Google Colab 最强薅羊毛!白嫖GPU!AI入门服务器!》· 14 分钟。没用过 Colab 的话先把它看完,重点看怎么切 GPU 运行时、怎么挂 Google Drive,以及免费额度用完的表现是什么样。</figcaption>
</figure>

## 加载模型,跑通第一次 generate

Colab 自带的 PyTorch 和 transformers 版本够用,不用重装。完整代码:

```python
# Colab cell
import time, torch
from transformers import AutoModelForCausalLM, AutoTokenizer

model_id = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"

tok = AutoTokenizer.from_pretrained(model_id)
model = AutoModelForCausalLM.from_pretrained(
    model_id,
    torch_dtype=torch.float16,   # T4 不支持 bf16,必须显式指定 fp16
    device_map="cuda",
)
model.eval()

print(torch.cuda.get_device_name(0))
print(f"权重占用 {torch.cuda.memory_allocated() / 1e9:.2f} GB")

prompt = "Explain in two sentences why GPUs are fast at matrix multiplication."
inputs = tok(prompt, return_tensors="pt").to("cuda")

t0 = time.perf_counter()
with torch.no_grad():
    out = model.generate(**inputs, max_new_tokens=64, do_sample=False)
torch.cuda.synchronize()
print(f"第一次 generate 耗时 {time.perf_counter() - t0:.2f} s")
print(tok.decode(out[0], skip_special_tokens=True))
```

三个地方要停一下。

**`torch_dtype=torch.float16` 不能省。**config.json 里写的 `torch_dtype` 是 bfloat16,不指定的话 transformers 有可能按 bf16 加载。T4 是 Turing 架构,硬件没有 bf16 的 tensor core,PyTorch 会报错,或者退回到极慢的软件模拟路径,测出的数字全部作废。这是路线图坑表里加粗的那一条,今天第一次撞上。A100 之后的卡(Ampere 起)才有 bf16。

**`memory_allocated()` 那一行是给 W1 对账的。**刚加载完、还没生成任何东西的时候,PyTorch 手里的张量就是权重,这个数应该非常接近 2.2 GB。如果差得多,要么 dtype 不对(fp32 会是 4.4 GB),要么加载了多余的东西。这是 W1 算出来的第一个数第一次被真机验证。

**`torch.cuda.synchronize()` 在计时结束前。**没有它,`time.perf_counter()` 测到的不是生成的耗时。为什么,明天一整篇讲。今天先照抄,记住「计时结束前 sync」是铁律。

`do_sample=False` 是贪心解码,每步取概率最大的 token,同样输入一定给同样输出。这对测性能很重要:不然每次生成的长度可能不同,时间自然不可比。

## 第一次为什么慢好几倍

跑完上面那段,再原样跑一遍。第二次的时间大概只有第一次的几分之一。同样的模型、同样的输入、同样的 64 个 token,差在哪?两个原因,都跟模型无关。

**CUDA context 初始化。**进程第一次真正碰 GPU 的时候,驱动要建 CUDA context:加载驱动、给这个进程分配 GPU 上的资源、初始化 cuBLAS 这类库的句柄、把 PyTorch 显存池的第一批块申请下来。这些事只做一次,但要几百毫秒到一两秒。它们被算进了第一次 generate 的时间里。

**kernel 选择和缓存填充。**一个矩阵乘法在 GPU 上有很多种实现(不同的 tile 大小、不同的内存布局),cuBLAS 第一次遇到某个形状的矩阵乘时,要挑一个实现,有时还要试跑几个候选(autotune)。挑完的结果会缓存,同样形状下次直接用。TinyLlama 有 22 层,每层十来种形状,第一次 generate 要把它们全部挑一遍。此外 PyTorch 的显存池第一次分配时要真的向驱动申请显存,之后同样大小的块直接从池里拿,也快很多。

<figure>
<svg viewBox="0 0 640 190" role="img" aria-label="第一次 generate 与之后几次的时间构成对比时间线">
<text x="8" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">同一段 generate,前后几次的时间构成(示意,横轴 = 时间)</text>
<text x="8" y="52" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">第 1 次</text>
<rect x="70" y="40" width="150" height="16" fill="var(--ink-faint)"/>
<rect x="220" y="40" width="200" height="16" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1"/>
<rect x="420" y="40" width="200" height="16" fill="var(--mem)"/>
<text x="76" y="52" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">CUDA context 初始化</text>
<text x="226" y="52" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">kernel 挑选 + 显存池首次分配</text>
<text x="426" y="52" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">真正的生成 64 token</text>
<text x="8" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">第 2 次</text>
<rect x="70" y="80" width="30" height="16" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1"/>
<rect x="100" y="80" width="200" height="16" fill="var(--mem)"/>
<text x="106" y="92" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">生成 64 token</text>
<text x="8" y="132" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">第 3 次起</text>
<rect x="70" y="120" width="200" height="16" fill="var(--mem)"/>
<text x="76" y="132" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">生成 64 token</text>
<line x1="70" y1="150" x2="270" y2="150" stroke="var(--rule)" stroke-width="1"/>
<text x="70" y="166" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">只有第 3 次起的时间是「模型本身的速度」。前两次叫 warmup,测量时丢掉。</text>
<text x="8" y="184" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">第 1 次比稳定值慢几倍是正常的;差 10 倍以上通常是还在下载权重或 Colab 磁盘冷启动。</text>
</svg>
<figcaption>第一次运行里有一大半时间在做和模型无关的一次性准备。这就是 warmup 要跳过的东西。</figcaption>
</figure>

所以「warmup」这个词的意思很具体:**先空跑两三次,把一次性的东西做完,再开始计时。**它不是玄学,是把图里灰色和琥珀色的段落从测量窗口里剔掉。

还有第三个较小的因素,以后会碰到:GPU 有时钟频率的动态调节。空闲时降频省电,负载上来后过几十毫秒才升到满频。连续跑的话它一直在高频,单独跑一次可能测在低频段。warmup 顺手也解决了这个。

## 验收:十次运行,方差压到 10% 以内

现在把「跑通」变成「跑稳」。规则:warmup 3 次不计,然后连续跑 10 次,每次都 sync 之后再读时间。

```python
# Colab cell
import statistics

def timed_generate(n_new=64):
    inputs = tok(prompt, return_tensors="pt").to("cuda")
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    with torch.no_grad():
        model.generate(**inputs, max_new_tokens=n_new, do_sample=False,
                       pad_token_id=tok.eos_token_id)
    torch.cuda.synchronize()
    return time.perf_counter() - t0

for _ in range(3):            # warmup,不计
    timed_generate()

runs = [timed_generate() for _ in range(10)]
med = statistics.median(runs)
spread = (max(runs) - min(runs)) / med
print(f"10 次耗时 (s): {[round(r, 3) for r in runs]}")
print(f"中位数 {med:.3f} s,极差/中位数 = {spread:.1%}")
print(f"每 token 约 {med / 64 * 1000:.1f} ms")
```

「方差 < 10%」我用的口径是**极差除以中位数**:最慢一次和最快一次的差,除以中位数,小于 0.1 算过。比标准差直观,而且对性能测量来说,极差更能暴露偶发的抖动。用中位数不用平均数,是因为偶尔一次被别的进程抢了 GPU,平均数会被拖歪,中位数不会。

如果这个比值压不下去,按顺序排查:

1. warmup 次数不够,把 3 改成 5 再试。
2. Colab 后台有别的 notebook 也在用这张卡(免费版偶尔发生),看 `nvidia-smi` 的已用显存是不是比自己的多很多。
3. 生成长度不固定。检查 `do_sample=False`,以及模型有没有提前吐出 EOS 结束。可以把 `min_new_tokens=64` 加上强制生成满。
4. 没有在计时结束前 sync。这个明天讲。

「每 token 约多少 ms」那一行是给 Day 9 用的粗值,它把 prefill 和 decode 混在了一起,还不能拿去和 6.9 ms 直接比。Day 9 会把两者拆开。

记录表,今天只填前四列,后面的列是这周后面几天填的:

| 日期 | 卡型 | 模型 / dtype | 10 次中位数 (s) | 极差/中位数 | 权重占用 (GB) | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| | | TinyLlama-1.1B / fp16 | | | | |
| | | | | | | |

预期在哪个范围?给一个依据不是结论:64 个 token、TinyLlama、T4。Day 9 会算出 decode 每 token 的理论下限 6.9 ms,路线图说实测通常是理论下限的 1.5 到 3 倍,也就是每 token 10 到 20 ms,64 个 token 加上 prefill 大约落在 0.7 到 1.5 秒之间。落在这个区间说明机器正常;远大于这个区间(比如 5 秒以上)先怀疑 dtype 加载成了 fp32,或者卡不是 T4。真实数字以自己跑出来的为准,填进表里。

## 顺手把显存对一次账

加载完就打印过 `memory_allocated()`,现在生成过几次了,再看两个数:

```python
print(f"当前已分配 {torch.cuda.memory_allocated() / 1e9:.2f} GB")
print(f"峰值已分配 {torch.cuda.max_memory_allocated() / 1e9:.2f} GB")
print(f"显存池保留 {torch.cuda.memory_reserved() / 1e9:.2f} GB")
```

三个数的关系,用 Day 5 的四项对:

- **已分配**:PyTorch 手里活着的张量总大小。生成结束后 KV cache 已经释放,这个数应该回到权重的 2.2 GB 附近。
- **峰值已分配**:生成过程中的最高点,等于权重加上 KV cache 加上当时最宽的激活。64 个 token 加十几个 token 的 prompt,KV cache 不到 2 MB,激活也小,所以峰值只比 2.2 GB 高一点。
- **显存池保留**:PyTorch 向驱动要下来但还没还的显存,包含分配了的和空闲待复用的。它比已分配大,大出来的那部分是 Day 5 说的「框架开销」的一部分。`nvidia-smi` 看到的已用显存又比它还大,多出来的是 CUDA context 和 cuBLAS workspace。

这一步对不上账没关系,记下三个数就行。W3 开大 batch 的时候再回来看它们怎么涨。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ytunfDaUJ_A" title="Hot To Use CUDA for Free on Google Colab (Quick Tutorial)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sharing What I'm Learning · 《How To Use CUDA for Free on Google Colab (Quick Tutorial)》· 几分钟的短片,看 Colab 里怎么确认 CUDA 可用、怎么看 nvidia-smi。英文,内容和上面的 B 站视频互补。</figcaption>
</figure>

## 名词解释

| 名词 | 意思 | 首次出现 |
| --- | --- | --- |
| Colab | Google Colaboratory,浏览器里的 Jupyter notebook,免费版送有限时长的 GPU | Day 7 |
| T4 | NVIDIA Tesla T4,2018 年 Turing 架构推理卡,16 GB、320 GB/s、fp16 65 TFLOP/s | Day 7 |
| Turing / Ampere | NVIDIA GPU 的架构代号,T4 是 Turing(2018),A100 是 Ampere(2020) | Day 7 |
| bf16 | bfloat16,16 位浮点,指数位和 fp32 一样多。Ampere 起硬件支持,T4 没有 | Day 7 |
| GQA | grouped-query attention,多个 q 头共享一组 k、v 头,KV cache 按 kv 头数算 | Day 4 提过,Day 7 首次实际用到 |
| num_key_value_heads | 配置里 k、v 的头数。等于 q 头数是 MHA,小于是 GQA,等于 1 是 MQA | Day 7 |
| CUDA context | 一个进程在 GPU 上的运行环境,第一次用 GPU 时创建,耗时几百毫秒到秒级 | Day 7 |
| warmup | 正式计时前先跑几次,把一次性开销(context、kernel 挑选、显存池、时钟升频)做完 | Day 7 |
| autotune | 库在几种 kernel 实现里试跑挑最快的,结果按形状缓存 | Day 7 |
| 贪心解码 | `do_sample=False`,每步取概率最高的 token,同输入必同输出,测性能时用它保证可复现 | Day 7 |
| memory_allocated / reserved | PyTorch 报的两个显存数:活着的张量总量 / 从驱动要下来的总量(含空闲待复用) | Day 7 |
| 极差 | 一组数里最大值减最小值,今天用它除以中位数当稳定性指标 | Day 7 |

## 常见误区

**不指定 dtype 直接加载。**TinyLlama 的 config 写的是 bf16,T4 不支持,后果是报错或者慢到离谱。所有在 T4 上的加载都要写 `torch_dtype=torch.float16`。反过来,到了 A100 之后 bf16 才是更好的选择(范围大,不容易溢出),Day 26 讲数值格式时展开。

**把第一次的时间当成模型速度。**第一次里一大半是 CUDA context 和 kernel 挑选,和模型无关。任何性能数字都要先 warmup 再测,这条以后不再重复提醒,默认已经做了。

**用平均数报告延迟。**偶尔一次抖动会把平均数拉偏,中位数不会。报延迟一律报中位数,顺带报极差或者 P99。这也是后面产出物里「延迟 P99 下降多少」那一栏的由来。

**觉得换成 1B 模型「不真实」。**decode 的算术强度是 1,和参数量无关,memory-bound 的规律在 1B 和 70B 上一样成立。1B 只是让 16 GB 的卡能开 batch 做实验。W4 租到大卡之后再回到 7B,把 W1 的数字重新对一遍。

**每次开机不看卡型。**Colab 换了卡不会告诉你。同一段代码在 T4 和 L4 上差一倍,不记卡型的数字前后没法比。

## 参考资料

### 文章与文档

- HuggingFace transformers,《Generation with LLMs》,`generate` 的基本用法,`do_sample`、`max_new_tokens` 这些参数的官方解释。https://huggingface.co/docs/transformers/main/en/llm_tutorial
- HuggingFace transformers,《LLM inference optimization》,今天用不上,但 Day 11 讲 gap 时会回来看它讲的 static cache 和 torch.compile。https://huggingface.co/docs/transformers/en/llm_optims
- TinyLlama 模型卡和 config.json,今天数参数用的就是它。https://huggingface.co/TinyLlama/TinyLlama-1.1B-Chat-v1.0
- TinyLlama 项目仓库,里面有训练细节,想知道 1.1B 是怎么训出来的看这个。https://github.com/jzhang38/TinyLlama
- Qwen2.5-0.5B-Instruct 模型卡,备选模型。结构也是 GQA,但 tie_word_embeddings 为 true,数参数时 lm_head 不单算。https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct
- NVIDIA T4 产品页,16 GB、320 GB/s、65 TFLOP/s 这几个数的官方出处。https://www.nvidia.com/en-us/data-center/tesla-t4/
- TechPowerUp GPU 数据库 T4 页,规格汇总得更全,含 SM 数量和时钟。https://www.techpowerup.com/gpu-specs/tesla-t4.c3316
- NVIDIA Turing 架构白皮书,想知道 tensor core 为什么只支持 fp16/int8 而没有 bf16 的看第三章。https://images.nvidia.com/aem-dam/en-zz/Solutions/design-visualization/technologies/turing-architecture/NVIDIA-Turing-Architecture-Whitepaper.pdf
- Colab 官方 FAQ,免费版 GPU 时长限制、会分配到哪些卡、为什么会断连。https://research.google.com/colaboratory/faq.html
- PyTorch,《Understanding CUDA Memory Usage》,memory_allocated 和 memory_reserved 的区别,以及显存池怎么工作。https://docs.pytorch.org/docs/stable/torch_cuda_memory.html

### 视频

- 阿钟AI算法,《10分钟掌握Google Colab 最强薅羊毛!白嫖GPU!AI入门服务器!》,B 站 BV1PgJDz7EHT,已嵌在正文。
- Sharing What I'm Learning,《How To Use CUDA for Free on Google Colab (Quick Tutorial)》,YouTube,已嵌在正文。

## 自测

合上笔记做。

1. 为什么 Llama-2-7B fp16 在 Colab 的 T4 上跑不起来?用 Day 5 的四项算给出算式。

<details><summary>答案</summary>

权重 6.74e9 × 2 字节 = 13.5 GB,框架开销约 1.5 GB,合计 15 GB。T4 标称 16 GB,实际可用约 15 GB,KV cache 和激活一个字节都还没放就贴着上限了。哪怕 batch 1、序列 512 的 KV cache 也要 512 × 512 KB = 256 MB,必然 OOM。

</details>

2. TinyLlama-1.1B 的 `num_key_value_heads` 是 4,这对 W^k 的形状和每 token 的 KV cache 有什么影响?算出数字。

<details><summary>答案</summary>

这是 GQA。W^k 的形状从 2048 × 2048 变成 2048 × (4 × 64) = 2048 × 256,参数量从 4.19M 降到 0.52M。每 token KV cache = 2 × 22 层 × 256 × 2 字节 ≈ 22 KB,是 Llama-2-7B(512 KB)的二十三分之一。2048 token 的序列全部 KV cache 只有 45 MB。

</details>

3. 第一次 generate 比之后慢好几倍,至少说出两个原因。

<details><summary>答案</summary>

一是 CUDA context 初始化:进程第一次碰 GPU 要加载驱动、建 context、初始化 cuBLAS 等库、申请显存池的第一批块,耗时几百毫秒到秒级。二是 kernel 挑选和缓存填充:每种矩阵形状第一次出现时 cuBLAS 要选实现(可能试跑几个候选),22 层十几种形状全要挑一遍;PyTorch 显存池第一次分配也要真的向驱动要显存。第三个次要因素是 GPU 时钟从空闲的低频升到满频需要几十毫秒。

</details>

4. 「延迟方差 < 10%」我用的具体口径是什么?为什么用中位数不用平均数?

<details><summary>答案</summary>

warmup 3 次不计,连续跑 10 次,每次计时结束前 `torch.cuda.synchronize()`,取(最大值 − 最小值)÷ 中位数 < 0.1。用中位数是因为偶发抖动(比如被别的进程抢了一次 GPU)会把平均数拉偏,中位数对单次离群值不敏感。

</details>

5. 加载 TinyLlama 时为什么必须写 `torch_dtype=torch.float16`?

<details><summary>答案</summary>

config.json 里的 `torch_dtype` 是 bfloat16。T4 是 Turing 架构,硬件没有 bf16 tensor core,按 bf16 加载会报错或退到极慢的路径,所有计时作废。Ampere(A100)起才支持 bf16。另外不指定也可能加载成 fp32,权重变 4.4 GB,速度慢一倍。

</details>

6. 加载完模型、还没生成时,`torch.cuda.memory_allocated()` 应该接近哪个数?为什么这个检查有价值?

<details><summary>答案</summary>

接近 2.2 GB(1.10e9 参数 × 2 字节)。这是 W1「参数量 × 字节数 = 权重占用」这条公式第一次被真机验证。如果看到 4.4 GB 说明加载成了 fp32,看到差很多说明加载了多余的东西。

</details>

## 明天预告

Day 8 讲今天代码里那行没解释的 `torch.cuda.synchronize()`。CUDA 是异步的:CPU 把 kernel 扔进队列就往下走,GPU 在后面慢慢执行。不 sync 的话,`time.perf_counter()` 测到的是「CPU 把活派完的时间」,不是「GPU 干完活的时间」,可能差几个数量级。明天用一张时间线图把这件事画清楚,再对比两种正确的计时方法:`synchronize()` 和 `torch.cuda.Event`,并把今天的计时代码改成最终版。
