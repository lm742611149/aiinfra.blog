---
title: 'Day 10 · torch.profiler 抓一次 generate，在 Perfetto 里看懂 timeline'
description: '计时器只给一个数，profiler 给每个 kernel 的名字和时长。今天把 Day 9 那个比值拆开：一步 decode 里 GPU 真正在跑的是哪几个 kernel，各对应模型的哪一部分，CPU 那边又在干什么。'
pubDate: 2026-09-08
regime: none
tags: ['profiler', 'perfetto', 'trace', 'kernel', 'colab', 'aiinfra-365']
series: 'aiinfra-365'
day: 10
lang: 'zh'
---

## 今天要解决的问题

Day 9 算出一个比值:实测 TPOT 除以 6.9 ms 的理论下限。假设它是 3。这个 3 说明一步 decode 的 20 多毫秒里,只有 7 毫秒是在搬权重,剩下十几毫秒去哪了?

计时器回答不了这个问题。CUDA event 只能告诉我两个点之间过了多久,不知道中间发生了什么。要看到「发生了什么」,得换工具:**profiler**。它记录每一个 kernel 的名字、什么时候开始、跑了多久、是谁发起的,再把这些画在一条时间轴上。

今天做四件事:

1. 用 `torch.profiler` 把一步 decode 抓下来,导出 trace 文件。
2. 在 Perfetto 里打开 trace,认识 timeline 上每一行是什么。
3. 用 `key_averages()` 表列出 top 5 耗时的 kernel。
4. 把每个 kernel 的名字对应回模型的哪一部分:哪些是线性层的矩阵乘,哪些是 attention,哪些是 FFN 的激活函数,哪些是归一化。

验收标准是路线图 W2 D3 那条:**列出 top 5 耗时 kernel,并说出各自对应模型的哪部分**。今天不看 gap,gap 是 Day 11 的事;今天只把 GPU 上真正跑了的东西认全。

## 计时器和 profiler 量的不是一回事

先分清两个工具。

Day 8、9 用的 CUDA event 是**计时器**:在时间线上打两个点,报告两点间的 GPU 时间。它便宜、准、不打扰程序,但只给一个数。想知道这段时间里 GPU 在干什么,它无能为力。

**profiler** 是在程序旁边挂一个记录员。PyTorch 每发一个算子(`aten::linear`、`aten::softmax`),记录员记一笔:名字、CPU 上的开始和结束时间、输入形状。GPU 每跑完一个 kernel,CUDA 的记录工具(CUPTI)也记一笔:kernel 名、在 GPU 上的开始和结束时间、在哪条 stream 上。最后把这两份记录合成一个文件,就是 trace。

代价是记录本身要花时间。CPU 端每个算子多几微秒,记录越细(带形状、带调用栈)越慢。所以 profiler 抓出来的绝对时间会比真实运行偏大,尤其是 CPU 那部分。**profiler 看的是比例和结构,绝对数字以计时器为准**。这两个工具要配着用,不是替代关系。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="计时器与 profiler 对比:计时器在时间线上打两个点得一个数;profiler 记下每个算子和每个 kernel 的名字与区间">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">计时器(CUDA event)</text>
<line x1="20" y1="60" x2="620" y2="60" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="60" y1="48" x2="60" y2="72" stroke="var(--ink)" stroke-width="2"/>
<line x1="560" y1="48" x2="560" y2="72" stroke="var(--ink)" stroke-width="2"/>
<text x="60" y="90" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">start.record()</text>
<text x="500" y="90" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">end.record()</text>
<text x="250" y="52" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">elapsed_time = 21.3 ms,中间是黑箱</text>
<text x="20" y="128" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">profiler(torch.profiler)</text>
<text x="20" y="152" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">CPU</text>
<g fill="var(--rule-soft)" stroke="var(--ink-faint)" stroke-width="0.8">
<rect x="60" y="142" width="34" height="14"/><rect x="98" y="142" width="22" height="14"/><rect x="124" y="142" width="40" height="14"/><rect x="168" y="142" width="26" height="14"/><rect x="198" y="142" width="34" height="14"/><rect x="236" y="142" width="22" height="14"/><rect x="262" y="142" width="40" height="14"/><rect x="306" y="142" width="26" height="14"/><rect x="336" y="142" width="34" height="14"/><rect x="374" y="142" width="22" height="14"/><rect x="400" y="142" width="40" height="14"/>
</g>
<text x="62" y="153" font-family="var(--font-mono)" font-size="8" fill="var(--ink-soft)">linear</text>
<text x="126" y="153" font-family="var(--font-mono)" font-size="8" fill="var(--ink-soft)">sdpa</text>
<text x="200" y="153" font-family="var(--font-mono)" font-size="8" fill="var(--ink-soft)">linear</text>
<text x="264" y="153" font-family="var(--font-mono)" font-size="8" fill="var(--ink-soft)">silu·mul</text>
<text x="338" y="153" font-family="var(--font-mono)" font-size="8" fill="var(--ink-soft)">linear</text>
<text x="20" y="186" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">GPU</text>
<g fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="0.8">
<rect x="76" y="176" width="40" height="14"/><rect x="140" y="176" width="14" height="14"/><rect x="180" y="176" width="40" height="14"/><rect x="278" y="176" width="10" height="14"/><rect x="292" y="176" width="10" height="14"/><rect x="352" y="176" width="40" height="14"/><rect x="416" y="176" width="40" height="14"/>
</g>
<text x="78" y="187" font-family="var(--font-mono)" font-size="8" fill="var(--mem)">gemm</text>
<text x="182" y="187" font-family="var(--font-mono)" font-size="8" fill="var(--mem)">gemm</text>
<text x="354" y="187" font-family="var(--font-mono)" font-size="8" fill="var(--mem)">gemm</text>
<text x="418" y="187" font-family="var(--font-mono)" font-size="8" fill="var(--mem)">gemm</text>
<text x="20" y="216" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">每一块都有名字、起止时间、形状;上下两行之间的对应关系也记着</text>
</svg>
<figcaption>计时器只给两点之间的一个数。profiler 把 CPU 上发的每个算子和 GPU 上跑的每个 kernel 都记下来,画成两行,黑箱变成一张时间表。</figcaption>
</figure>

## 抓一次 trace

接着 Day 9 的手写 decode 循环。之所以不直接 profile `generate`,是因为 `generate` 一次跑 64 步,trace 会很大,而且 64 步长得一模一样,看 3 步就够。手写循环让每步的边界清楚,还能用 `prof.step()` 告诉 profiler 步与步的分界。

```python
# Colab,接着 Day 9 的 model / tokenizer / inputs
import torch
from torch.profiler import profile, ProfilerActivity, schedule, tensorboard_trace_handler

@torch.no_grad()
def one_prefill(model, input_ids):
    out = model(input_ids=input_ids, use_cache=True)
    return out.logits[:, -1].argmax(-1, keepdim=True), out.past_key_values

@torch.no_grad()
def one_decode_step(model, tok, past):
    out = model(input_ids=tok, past_key_values=past, use_cache=True)
    return out.logits[:, -1].argmax(-1, keepdim=True), out.past_key_values

# 先在 profiler 外面 warmup,并把 prefill 做掉,只 profile decode
for _ in range(3):
    tok, past = one_prefill(model, inputs["input_ids"])
    for _ in range(4):
        tok, past = one_decode_step(model, tok, past)
torch.cuda.synchronize()

tok, past = one_prefill(model, inputs["input_ids"])

sched = schedule(wait=1, warmup=2, active=3, repeat=1)
with profile(
    activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA],
    schedule=sched,
    on_trace_ready=tensorboard_trace_handler("./trace_decode"),
    record_shapes=True,
    with_stack=False,          # True 会慢很多,先关
    profile_memory=False,
) as prof:
    for step in range(1 + 2 + 3):          # wait + warmup + active
        tok, past = one_decode_step(model, tok, past)
        torch.cuda.synchronize()
        prof.step()                        # 告诉 profiler 一步结束

print(prof.key_averages().table(sort_by="cuda_time_total", row_limit=15))
```

几个参数逐个说。

`activities` 选 CPU 和 CUDA 两边都记。只记 CPU 的话看不到 kernel,只记 CUDA 的话看不到是谁发的。

`schedule(wait=1, warmup=2, active=3)` 是让 profiler 分阶段工作:第 1 步什么都不记(wait),第 2、3 步记但丢掉(warmup,让 profiler 自己的缓存和状态稳定),第 4 到 6 步真正记录(active)。循环要跑够 1 + 2 + 3 = 6 步,每步末尾调 `prof.step()`。**忘了调 `prof.step()`,schedule 就不会往前走,active 阶段永远到不了,trace 是空的**。这是第一次用最容易踩的坑。

`on_trace_ready=tensorboard_trace_handler(dir)` 让 profiler 在 active 阶段结束时自动把 trace 写到目录里,文件名带时间戳和主机名,后缀 `.pt.trace.json`。也可以不用 handler,在 `with` 块结束后手动 `prof.export_chrome_trace("decode.json")`,效果一样。前者的好处是 schedule 有多个 repeat 时每轮各存一份。

`record_shapes=True` 记每个算子的输入形状。有了形状才能把 `aten::linear` 对应回「这是 q 投影还是 FFN 的 up 投影」,因为它们的形状不一样。

`with_stack=True` 记 Python 调用栈,能看到每个算子是模型代码的哪一行发出来的,但开销大,trace 文件也大好几倍。第一次先关,认全 kernel 名之后再开一次对照。

每步末尾的 `torch.cuda.synchronize()` 不是必需的,但它让每步在 trace 里干净地隔开,Day 11 看 gap 时更好读。真实服务里不会每步 sync,那是另一种 trace,以后再抓。

跑完,`./trace_decode/` 里会有一个 `.pt.trace.json` 文件,几 MB 到几十 MB。从 Colab 左侧文件栏下载到本机。

## 先看表:key_averages

trace 文件还没打开,先看上面打印出来的表。`key_averages()` 把 3 步 active 里所有同名的算子和 kernel 各自合并,`sort_by="cuda_time_total"` 按 GPU 总时间降序。表长这样(列名是真的,数字是示意,自己跑出来的填进后面的记录表):

```
Name                          Self CPU %  Self CPU   CPU total  Self CUDA %  Self CUDA  CUDA total  # of Calls
aten::linear                       2.1%    0.42ms     9.80ms       0.0%     0.00us    14.20ms        465
aten::matmul                       1.8%    0.36ms     8.90ms       0.0%     0.00us    14.20ms        465
turing_fp16_s1688gemm_fp16_...     0.0%    0.00us     0.00us      61.3%    12.10ms    12.10ms        399
aten::scaled_dot_product_...       0.9%    0.18ms     3.10ms       0.0%     0.00us     2.40ms         66
vectorized_elementwise_kernel      0.0%    0.00us     0.00us      11.2%     2.20ms     2.20ms        861
...
```

读这张表要抓住三对列的区别。

**Self 和 total**。`aten::linear` 自己在 CPU 上只花 0.42 ms(Self CPU),但它调用的子算子加起来 9.8 ms(CPU total)。看 CPU 端瓶颈用 Self,看一个功能整体多贵用 total。

**CPU 和 CUDA**。`aten::linear` 这一行 Self CUDA 是 0,因为算子本身不在 GPU 上跑,它发起的 kernel 才在。所以 GPU 时间要看那些名字像 `turing_fp16_s1688gemm_...`、`vectorized_elementwise_kernel` 的行,它们是 kernel,Self CPU 是 0。**算子在 CPU 行有数、kernel 在 CUDA 行有数,两类行别混着比**。

**# of Calls**。3 步 active 里 `aten::linear` 被调了 465 次,除以 3 是每步 155 次。TinyLlama 22 层,每层 attention 4 个投影加 FFN 3 个矩阵,一共 7 × 22 = 154,再加 lm_head 一次,正好 155。**这个数能和 Day 2 数矩阵的结果对上,说明 trace 抓的就是完整的一步 decode**。这种对账比任何教程都能让人相信自己看懂了。

表的第一个用处就是列 top 5。按 Self CUDA 排,只看 kernel 行,前五个就是验收要的答案。

## 再看图:Perfetto

打开 https://ui.perfetto.dev ,点左上 Open trace file,选下载下来的 `.pt.trace.json`。几秒后出现 timeline。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="Perfetto 界面示意:上方时间轴,左侧行名,python 线程行是算子色块,stream 7 行是 kernel 色块,选中一个 kernel 底部弹出详情并有箭头连回发起它的算子">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<rect x="0" y="0" width="640" height="26" fill="var(--rule-soft)"/>
<text x="12" y="17" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">ui.perfetto.dev · 时间轴(拖选一段可看该段汇总)</text>
<line x1="130" y1="26" x2="130" y2="240" stroke="var(--rule)" stroke-width="1"/>
<text x="140" y="42" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">0 ms</text>
<text x="380" y="42" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">10 ms</text>
<text x="600" y="42" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">20 ms</text>
<text x="12" y="76" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">ProfilerStep#4</text>
<rect x="140" y="62" width="470" height="18" fill="var(--rule-soft)" stroke="var(--rule)"/>
<text x="150" y="75" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)">ProfilerStep#4(一步 decode)</text>
<text x="12" y="110" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">python 线程</text>
<text x="12" y="122" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">CPU:算子</text>
<g fill="var(--rule-soft)" stroke="var(--ink-faint)" stroke-width="0.7">
<rect x="140" y="96" width="30" height="12"/><rect x="172" y="96" width="18" height="12"/><rect x="192" y="96" width="30" height="12"/><rect x="224" y="96" width="24" height="12"/><rect x="250" y="96" width="30" height="12"/><rect x="282" y="96" width="18" height="12"/><rect x="302" y="96" width="30" height="12"/><rect x="334" y="96" width="24" height="12"/><rect x="360" y="96" width="30" height="12"/><rect x="392" y="96" width="18" height="12"/><rect x="412" y="96" width="30" height="12"/><rect x="444" y="96" width="24" height="12"/><rect x="470" y="96" width="30" height="12"/><rect x="502" y="96" width="18" height="12"/><rect x="522" y="96" width="30" height="12"/><rect x="554" y="96" width="24" height="12"/>
<rect x="140" y="110" width="14" height="10"/><rect x="156" y="110" width="12" height="10"/><rect x="192" y="110" width="14" height="10"/><rect x="208" y="110" width="12" height="10"/><rect x="250" y="110" width="14" height="10"/><rect x="266" y="110" width="12" height="10"/>
</g>
<text x="142" y="105" font-family="var(--font-mono)" font-size="7" fill="var(--ink-soft)">aten::linear</text>
<text x="194" y="105" font-family="var(--font-mono)" font-size="7" fill="var(--ink-soft)">aten::linear</text>
<text x="226" y="105" font-family="var(--font-mono)" font-size="7" fill="var(--ink-soft)">sdpa</text>
<text x="142" y="118" font-family="var(--font-mono)" font-size="7" fill="var(--ink-faint)">matmul</text>
<text x="12" y="160" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">stream 7</text>
<text x="12" y="172" font-family="var(--font-mono)" font-size="9" fill="var(--ink-faint)">GPU:kernel</text>
<g fill="var(--mem-wash)" stroke="var(--mem)" stroke-width="0.8">
<rect x="150" y="150" width="26" height="14"/><rect x="202" y="150" width="26" height="14"/><rect x="260" y="150" width="26" height="14"/><rect x="312" y="150" width="26" height="14"/><rect x="370" y="150" width="26" height="14"/><rect x="422" y="150" width="26" height="14"/><rect x="480" y="150" width="26" height="14"/><rect x="532" y="150" width="26" height="14"/>
</g>
<g fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="0.8">
<rect x="232" y="150" width="8" height="14"/><rect x="242" y="150" width="6" height="14"/><rect x="342" y="150" width="8" height="14"/><rect x="352" y="150" width="6" height="14"/><rect x="452" y="150" width="8" height="14"/><rect x="462" y="150" width="6" height="14"/>
</g>
<text x="152" y="161" font-family="var(--font-mono)" font-size="7" fill="var(--mem)">gemm</text>
<text x="204" y="161" font-family="var(--font-mono)" font-size="7" fill="var(--mem)">gemm</text>
<text x="262" y="161" font-family="var(--font-mono)" font-size="7" fill="var(--mem)">gemm</text>
<path d="M155 108 L155 150" stroke="var(--ink-faint)" stroke-width="0.8" stroke-dasharray="2 2" fill="none"/>
<path d="M207 108 L207 150" stroke="var(--ink-faint)" stroke-width="0.8" stroke-dasharray="2 2" fill="none"/>
<text x="580" y="161" font-family="var(--font-mono)" font-size="8" fill="var(--ink-faint)">…</text>
<rect x="0" y="250" width="640" height="80" fill="var(--rule-soft)"/>
<text x="12" y="270" font-family="var(--font-mono)" font-size="10" fill="var(--ink)">Current Selection(点中一个 kernel 块)</text>
<text x="12" y="290" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)">Name  turing_fp16_s1688gemm_fp16_256x64_ldg8_f2f_tn</text>
<text x="12" y="305" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)">Duration  31.2 us    stream 7    grid [88,1,1]  block [128,1,1]</text>
<text x="12" y="320" font-family="var(--font-mono)" font-size="9" fill="var(--ink-soft)">Launched by  aten::linear → aten::matmul → cudaLaunchKernel(虚线箭头指回 CPU 行)</text>
</svg>
<figcaption>Perfetto 的三层结构:最上面一行是 ProfilerStep 的框,中间是 python 线程(CPU 上的算子,一层套一层),下面是 GPU stream(真正跑的 kernel)。点任何一块,底部显示名字、时长、grid/block,以及它是被哪个算子发起的。</figcaption>
</figure>

界面上要认识的东西不多。

**最上面 ProfilerStep#N** 一行是 `prof.step()` 划出来的框,一步 decode 一个框。先点一个框,按 F 键把它放大到满屏。

**python 线程那一行**是 CPU 端的算子。色块一层套一层:`aten::linear` 里面是 `aten::matmul`,再里面是 `cudaLaunchKernel`。每一层都是一个 Python 或 C++ 调用。这一行的色块**密密麻麻几乎不断**,因为 CPU 一直在忙着发指令。

**stream 7(或别的数字)那一行**是 GPU。每个色块是一个 kernel,这一行才是「真正在算」的时间。**这一行会有缝**,色块之间的空白就是 GPU 什么都没做的时刻。Day 11 专门看它,今天先忍住。

点一个 GPU 上的色块,底部 Current Selection 显示它的名字、时长、grid 和 block 大小,还有一个 Launched by 或流程箭头,指回 CPU 行上发起它的那个算子。这条连线就是「kernel 名 → 算子 → 模型的哪一层」这条对应关系的物证。

操作用键盘:W/S 放大缩小,A/D 左右移,鼠标拖选一段区间后底部会给这段区间内所有 kernel 的汇总。拖选一步 decode,看 stream 行的总时长,和 CUDA event 测的 TPOT 对一下,应该接近。

早年 Chrome 内置的 `chrome://tracing` 也能打开这种文件,现在已经不再维护,Perfetto 是它的继任者,打开大文件更快。TensorBoard 的 profiler 插件也能看,但 Perfetto 什么都不用装。

## 把 kernel 名对应回模型

这是今天的核心。GPU 上跑的东西名字都很难看,`turing_fp16_s1688gemm_fp16_256x64_ldg8_f2f_tn` 这种。但它们只有几类,认全了就再也不会怕。

先把一层 decode 里模型做的事按 Day 2、3 的零件图排一遍,再看每样事在 trace 里叫什么。

<figure>
<svg viewBox="0 0 640 400" role="img" aria-label="一层 transformer decode 的零件图,每个零件旁标注它在 trace 里的 kernel 名">
<rect x="0" y="0" width="640" height="400" fill="var(--paper-raised)"/>
<text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一层 decode 做的事 → trace 里的名字(T4 · fp16 · eager)</text>
<rect x="20" y="46" width="180" height="30" fill="var(--rule-soft)" stroke="var(--rule)"/>
<text x="30" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">RMSNorm</text>
<text x="220" y="60" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">pow · mean · rsqrt · mul 四个小 kernel</text>
<text x="220" y="73" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">vectorized_elementwise_kernel / reduce_kernel</text>
<rect x="20" y="90" width="180" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="110" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">q/k/v 投影(3 个矩阵)</text>
<text x="220" y="104" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">3 次 aten::linear → 3 个 gemm/gemv</text>
<text x="220" y="117" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">turing_fp16_s1688gemm_… 或 gemv2T_kernel</text>
<rect x="20" y="134" width="180" height="30" fill="var(--rule-soft)" stroke="var(--rule)"/>
<text x="30" y="154" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">RoPE 位置编码</text>
<text x="220" y="148" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">cos/sin 乘加,几个 elementwise</text>
<text x="220" y="161" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">vectorized_elementwise_kernel · cat</text>
<rect x="20" y="178" width="180" height="30" fill="var(--rule-soft)" stroke="var(--rule)"/>
<text x="30" y="198" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">KV cache 追加</text>
<text x="220" y="192" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">新 k、v 拼到旧的后面(HF DynamicCache 用 torch.cat)</text>
<text x="220" y="205" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">CatArrayBatchedCopy · copy_</text>
<rect x="20" y="222" width="180" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="242" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">attention(q·k、softmax、·v)</text>
<text x="220" y="236" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">aten::scaled_dot_product_attention</text>
<text x="220" y="249" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">T4 无 flash:fmha_cutlassF_… 或 bmm + softmax + bmm</text>
<rect x="20" y="266" width="180" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="286" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">o 投影 + 残差</text>
<text x="220" y="280" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">1 次 aten::linear → gemm;aten::add → elementwise</text>
<rect x="20" y="310" width="180" height="30" fill="var(--rule-soft)" stroke="var(--rule)"/>
<text x="30" y="330" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">RMSNorm</text>
<text x="220" y="324" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">同上,又四个小 kernel</text>
<rect x="20" y="354" width="180" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="374" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">FFN:gate/up/down + SiLU</text>
<text x="220" y="368" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">3 次 aten::linear → 3 个 gemm;silu、mul、add → elementwise</text>
<text x="220" y="381" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">FFN 的 gemm 最大:2048×5632,是 q 投影的 2.75 倍</text>
</svg>
<figcaption>一层 decode 从上到下要做的事,右边是每件事在 trace 里的名字。蓝色块是矩阵乘,一层 7 个,GPU 时间的大头;琥珀色是 attention 的核心;灰色是归一化、位置编码、cache 拼接这些小活,单个便宜,但数量多。</figcaption>
</figure>

分类说。

### 矩阵乘:gemm、gemv、cutlass、cublas

名字里带 `gemm` 的都是矩阵乘,general matrix multiply。T4 是 Turing 架构,cuBLAS 在 T4 上挑的 fp16 tensor core kernel 名字以 `turing_fp16_s1688gemm` 开头;A100 上是 `ampere_fp16_s16816gemm`;后面跟的 `256x64`、`ldg8`、`tn` 是 tile 大小和内存布局,W3 以后再管。也可能看到 `cutlass_` 开头的,CUTLASS 是 NVIDIA 的开源矩阵乘模板库,cuBLAS 内部和 PyTorch 都会用。

batch 1 decode 时输入只有一行(一个 token 的向量),矩阵乘退化成矩阵乘向量,cuBLAS 可能改派 `gemv` kernel(`gemv2T_kernel_val` 之类)。名字不一样,干的是同一件事。

**它们全部对应 `aten::linear`**,也就是模型里的 `nn.Linear`:q、k、v、o 四个投影,FFN 的 gate、up、down 三个,加最后的 lm_head。一层 7 个,22 层 154 个,加 lm_head 155 个。每步 decode 这 155 个矩阵乘要把 2.2 GB 权重全部读一遍,所以**它们的 GPU 时间加起来,就是 Day 9 那 6.9 ms 下限的主要承担者**。预期它们占 GPU 时间的 60% 到 80%。

用 `record_shapes` 能分辨它们谁是谁。TinyLlama 的形状:q 和 o 投影是 [1, 2048] × [2048, 2048];k、v 投影因为 GQA 只有 4 个头,是 [1, 2048] × [2048, 256],小 8 倍;FFN 的 gate、up 是 [1, 2048] × [2048, 5632],down 是 [1, 5632] × [5632, 2048];lm_head 是 [1, 2048] × [2048, 32000],单个最大。按字节数算,一层里 FFN 三个矩阵 3 × 2048 × 5632 × 2 = 69 MB,attention 四个矩阵(2048² × 2 + 2048 × 256 × 2)× 2 = 18.9 MB,FFN 是 attention 的 3.7 倍。**所以 trace 里 FFN 的 gemm 应该比 attention 投影的 gemm 明显更长**,这个比例能和 Day 2 数出的参数分布对上。

### attention 核心:sdpa、fmha、flash、bmm + softmax

q 和所有 k 算相似度、softmax、再按权重混 v,这三步在 HF 里走 `aten::scaled_dot_product_attention`(简称 sdpa)。PyTorch 会根据硬件挑后端:

- **flash**:FlashAttention 2,名字 `flash_fwd_kernel`。需要 Ampere 及以上,**T4 上没有**。
- **mem-efficient**:xformers 风格的 kernel,名字 `fmha_cutlassF_f16_aligned_…`。T4 上多半走这个。
- **math**:退化成普通算子,`aten::bmm`(批量矩阵乘)+ `aten::softmax` + 再一个 `bmm`。如果 mask 或 dtype 不满足前两种的条件就走这里。

所以 T4 的 trace 里 attention 核心要么是一个 `fmha_cutlassF` kernel,要么是 bmm、softmax、bmm 三个 kernel。这三步是 Day 4 讲的「和参数无关的那一项」,序列 200 多个 token、batch 1 时它很小,预期只占 GPU 时间的 5% 到 10%。序列到几千、batch 开大,它才长起来。

在 A100 上同样的代码,这里会变成 `flash_fwd_kernel`,一个 kernel 干完三件事。这是 M5 fusion 主题的一个预告。

### 逐元素运算:vectorized_elementwise_kernel

名字带 `elementwise` 的,是对张量每个元素独立做同一件事:加、乘、SiLU、开方。它们对应一堆小算子:

- 残差连接的 `aten::add`
- FFN 的 `aten::silu` 和 gate × up 的 `aten::mul`
- RMSNorm 拆出来的 `aten::pow`、`aten::mul`、`aten::rsqrt`(mean 那一步是 `reduce_kernel`)
- RoPE 的 cos、sin 乘加

每个都很快,几微秒,但每层十几个,22 层加起来两三百个。**它们单个的 GPU 时间不值一提,但 launch 次数占了整步的一半以上**,这就是 Day 11 gap 的主要来源。今天先记下:elementwise 在 GPU 时间里预期占 10% 到 20%,在 kernel 数量里占一半以上。这两个比例的落差本身就是一条重要信息。

### 归一化:RMSNorm 在 eager 下没有自己的 kernel

Llama 系用 RMSNorm,HF 的实现是几行 PyTorch:先 `pow(2)`,再 `mean`,再 `rsqrt`,再乘回去,再乘权重。eager 模式下这几行各自是一个 kernel,trace 里看不到叫 RMSNorm 的东西,只看到 pow、reduce、rsqrt、mul 四五个小块紧挨着。**一层两个 RMSNorm,就是十个小 kernel**。`torch.compile` 或专用库会把它们融成一个,这也是 M5 的内容。

如果 `with_stack=True` 再抓一次,点开这些小块能看到调用栈里有 `LlamaRMSNorm.forward`,就能确认。

### KV cache 拼接:cat、copy_

HF 的 `DynamicCache` 每步把新 token 的 k、v 用 `torch.cat` 拼到旧 cache 后面。这会出现 `CatArrayBatchedCopy` 或 `copy_` 这类 kernel,每层两个(k 一个 v 一个)。序列越长这个拷贝越贵,因为 `cat` 要把整个旧 cache 复制一遍再加一行。这是 HF 实现的一个已知低效点,vLLM 的 PagedAttention 用预分配的块彻底绕开了它,M3 读源码时会碰到。

### 其余:embedding、argmax、softmax

每步开头一个 `aten::embedding`(`index_select` 或 `indexSelectLargeIndex` kernel),把 token id 换成向量。每步结尾一个 `aten::argmax`(贪心解码)或 `softmax` + `multinomial`(采样)。都只做一次,时间可以忽略,但它们标出了一步 decode 的头和尾,在 timeline 上很好找。

## 预期的 top 5 长什么样

把上面的分类套到 T4 上 TinyLlama batch 1 decode,跑之前先写下预期,跑完对照:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="预期的 GPU 时间分布横条:gemm 占六到八成,elementwise 一到两成,attention 核心和 cat、norm 各占一小段">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<text x="20" y="26" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">一步 decode 的 GPU 时间预期怎么分(跑之前写下,跑完对照)</text>
<text x="20" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">gemm / gemv</text>
<rect x="170" y="54" width="300" height="18" fill="var(--mem)"/>
<text x="480" y="68" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">60–80%,155 次</text>
<text x="20" y="102" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">elementwise</text>
<rect x="170" y="90" width="64" height="18" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="244" y="104" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">10–20%,250 次以上</text>
<text x="20" y="138" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">attention 核心</text>
<rect x="170" y="126" width="30" height="18" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="210" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5–10%,22 次(或 66 次)</text>
<text x="20" y="174" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">cat / copy(KV cache)</text>
<rect x="170" y="162" width="20" height="18" fill="var(--rule)"/>
<text x="200" y="176" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3–6%,44 次,随序列长度涨</text>
<text x="20" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">reduce(norm 的 mean)</text>
<rect x="170" y="198" width="14" height="18" fill="var(--rule)"/>
<text x="194" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">2–4%,44 次</text>
<text x="20" y="240" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">比例是按字节数和 kernel 数量推的预期,不是实测。次数按 22 层 × 每层个数算,能和 # of Calls 列对账。</text>
</svg>
<figcaption>预期的 GPU 时间分布。矩阵乘占大头是因为 2.2 GB 权重全在那 155 个 kernel 里搬;elementwise 时间不多但次数最多。跑完拿 key_averages 的 Self CUDA 列对照,差得远的地方就是要追问的地方。</figcaption>
</figure>

预期 top 5(按 Self CUDA 总时间):

| 名次 | kernel 名(模式) | 对应模型部件 | 预期占比 | 每步次数 |
| --- | --- | --- | --- | --- |
| 1 | `turing_fp16_s1688gemm_…` 或 `gemv2T_kernel` | 全部 `nn.Linear`:q/k/v/o、gate/up/down、lm_head | 60–80% | 155 |
| 2 | `vectorized_elementwise_kernel` | add、mul、silu、pow、rsqrt,RoPE | 10–20% | 250+ |
| 3 | `fmha_cutlassF_…` 或 `bmm` + `softmax` | attention 核心(q·k、softmax、·v) | 5–10% | 22 或 66 |
| 4 | `CatArrayBatchedCopy` / `copy_` | KV cache 追加 | 3–6% | 44 |
| 5 | `reduce_kernel` | RMSNorm 里的 mean | 2–4% | 44 |

占比是按字节数和 kernel 数量推出来的,不是测的。实测和它差在哪,就是接下来要追问的地方。比如 gemm 占比如果只有 40%,要问剩下的时间被谁拿走了;如果 elementwise 占到 30%,要问是不是 T4 上这类 kernel 效率特别差。

还有一个数值上的对账:把 gemm 类 kernel 的 Self CUDA 总时间除以 3(3 步 active),得到每步矩阵乘的 GPU 时间。它应该接近但略大于 6.9 ms,因为这 155 个 kernel 就是搬那 2.2 GB 的。如果算出来是 8 ms,说明矩阵乘 kernel 的带宽效率是 6.9 ÷ 8 ≈ 86%,这是 W3 Day 13 要正式测的东西,今天先有个预感。

## 记录表

| 项 | 值 | 备注 |
| --- | --- | --- |
| 卡型号 | | `nvidia-smi` |
| trace 文件大小 | MB | 3 步 active,record_shapes 开 |
| 一步 decode 的 ProfilerStep 时长 | ms | Perfetto 拖选整步 |
| stream 行 kernel 总时长 | ms | 拖选后底部汇总,和上一行的差就是 Day 11 的 gap |
| `aten::linear` 每步调用次数 | | # of Calls ÷ 3,预期 155 |
| top 1 kernel 名 / Self CUDA / 占比 | | |
| top 2 kernel 名 / Self CUDA / 占比 | | |
| top 3 kernel 名 / Self CUDA / 占比 | | |
| top 4 kernel 名 / Self CUDA / 占比 | | |
| top 5 kernel 名 / Self CUDA / 占比 | | |
| gemm 类每步 GPU 时间 | ms | 预期略大于 6.9 |
| 6.9 ÷ 上一行 | % | 矩阵乘的带宽效率预感,W3 正式测 |
| attention 后端 | | flash / mem-efficient / math,看 kernel 名 |
| kernel 总数 / 步 | | 预期 500 以上 |

## 名词解释

| 名词 | 意思 |
| --- | --- |
| profiler | 记录程序运行时每个算子和 kernel 的名字、时间、形状的工具,`torch.profiler` 是 PyTorch 内置的 |
| CUPTI | CUDA Profiling Tools Interface,NVIDIA 提供的底层接口,torch.profiler 靠它拿到 GPU 侧的 kernel 记录 |
| trace | profiler 输出的时间线文件,PyTorch 导出的是 Chrome trace 格式的 JSON |
| Perfetto | Google 的开源 trace 查看器,网页版 ui.perfetto.dev,`chrome://tracing` 的继任者 |
| 算子(op) | PyTorch 层面的一次操作,`aten::linear`、`aten::softmax`,在 CPU 上被调用,可能发起零个到多个 kernel |
| kernel | 在 GPU 上跑的一段程序,一个算子可能发一个或多个 kernel,也可能不发(纯 CPU 操作) |
| stream | GPU 上的一条有序执行队列,同一条 stream 上的 kernel 按顺序跑。默认只用一条,Perfetto 里显示为 stream 7 之类 |
| schedule | profiler 的分阶段设置,wait 不记、warmup 记了丢掉、active 真正记录,靠 `prof.step()` 推进 |
| Self CPU / CPU total | 算子自己在 CPU 上花的时间 / 含它调用的所有子算子的时间 |
| Self CUDA | kernel 自己在 GPU 上跑的时间;算子行这一列一般是 0,因为算子本身不在 GPU 跑 |
| # of Calls | 记录窗口内该名字出现的次数,除以 active 步数得每步次数 |
| gemm | general matrix multiply,矩阵乘 kernel 的通称;gemv 是矩阵乘向量,batch 1 decode 常退化成它 |
| CUTLASS | NVIDIA 开源的 CUDA 矩阵乘模板库,cuBLAS 和 PyTorch 内部都用,kernel 名里会出现 |
| sdpa | `scaled_dot_product_attention`,PyTorch 的 attention 算子,根据硬件挑 flash / mem-efficient / math 三种后端 |
| elementwise | 逐元素运算,对张量每个元素独立做同一件事,加、乘、激活函数都是 |
| eager 模式 | PyTorch 默认执行方式,每个算子立刻单独发 kernel,不做融合,和 `torch.compile` 相对 |
| DynamicCache | HF transformers 里 KV cache 的默认实现,每步用 `torch.cat` 追加 |

## 常见误区

**忘了 `prof.step()`,trace 是空的还以为是 GPU 没跑**。用了 schedule 就必须每步调 `prof.step()`,不然永远停在 wait 阶段。不用 schedule 的话就不需要,但那样 warmup 阶段的噪音会混进来。

**把算子行的 CPU total 当成 GPU 时间**。`aten::linear` 的 CPU total 是 9.8 ms,不代表矩阵乘在 GPU 上跑了 9.8 ms。它是 CPU 上从进入 linear 到返回的时间,包含发 kernel 的开销,而 kernel 可能在 CPU 返回之后才在 GPU 上真正跑。GPU 时间只看 kernel 行的 Self CUDA。

**拿 profiler 抓到的绝对时间当性能数字**。profiler 让 CPU 端每个算子多几微秒,一步几百个算子就多出一两毫秒,而且 `record_shapes`、`with_stack` 开得越多越慢。用 profiler 看比例和结构,用 CUDA event 报绝对时间。两个数不一致是正常的。

**只看 top 5 的时间,不看 # of Calls**。elementwise 时间占 15% 但次数占一半,这两个数放在一起才说明问题:它们不是慢在算,是慢在多。少看一列就得不出 Day 11 的结论。

**在 T4 上找 flash attention 的 kernel 找不到就以为 attention 没跑**。T4 是 Turing,FlashAttention 2 需要 Ampere。T4 上 sdpa 走 mem-efficient 或 math 后端,kernel 名是 `fmha_cutlassF` 或 bmm + softmax。看到这些就是 attention。

**trace 太大打不开**。profile 整个 `generate` 64 步,再开 `with_stack`,文件能到几百 MB,Perfetto 会卡。只 profile 3 步 active,先关 `with_stack`。

**以为 kernel 名是随机的**。每个名字都有规律:架构前缀(turing / ampere)、精度(fp16)、tensor core 指令形状(s1688 / s16816)、tile(256x64)、布局(tn)。认识前缀就能判断走的是不是 tensor core、是不是 fp16。这些在 W3 测算力时会用到。

## 参考资料

文档

- torch.profiler 官方文档。`profile`、`schedule`、`ProfilerActivity`、`key_averages` 每个参数的说明。https://pytorch.org/docs/stable/profiler.html
- PyTorch Profiler recipe。官方入门教程,从抓 trace 到看表到导出,今天的代码骨架来自这里。https://pytorch.org/tutorials/recipes/recipes/profiler_recipe.html
- Perfetto UI 与文档。打开 trace 的地方,以及键盘操作、拖选汇总的说明。https://ui.perfetto.dev 、 https://perfetto.dev/docs/
- `scaled_dot_product_attention` 文档。三种后端(flash / mem-efficient / math)各自的硬件和 dtype 条件,解释 T4 为什么没有 flash。https://pytorch.org/docs/stable/generated/torch.nn.functional.scaled_dot_product_attention.html
- CUDA Profiler User's Guide。CUPTI 和 NVIDIA 自家 profiler 的底层说明,今天不用读,知道 torch.profiler 底下是它就行。https://docs.nvidia.com/cuda/profiler-users-guide/
- Nsight Systems。下一层级的工具,能看到 CUDA runtime 调用、多进程、多卡,W4 有了自己的实例后可以试。https://developer.nvidia.com/nsight-systems

代码

- GPU MODE lectures 仓库,Lecture 1 的 notebook。用 profiler 看 kernel 的完整示例,包括怎么读 key_averages 表。https://github.com/gpu-mode/lectures
- transformers 的 `torch.compile` 性能页。讲 eager 下那些小 kernel 怎么被融合,M5 之前先扫一眼知道方向。https://huggingface.co/docs/transformers/main/en/perf_torch_compile

视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LuhJEEJQgUM" title="Lecture 1 How to profile CUDA kernels in PyTorch" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE · Lecture 1 How to profile CUDA kernels in PyTorch。Mark Saroufim 从 torch.profiler 到 trace 到 kernel 名一路讲下来,和今天的路线几乎一样,看前 40 分钟。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/F_BazucyCMw" title="Lecture 44: NVIDIA Profiling" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GPU MODE · Lecture 44: NVIDIA Profiling。讲 Nsight Systems 和 Nsight Compute,是 torch.profiler 之后的下一层工具。今天不用看完,知道往上还有什么就行。</figcaption>
</figure>

## 自测

合上笔记做。

1. 计时器和 profiler 各自量的是什么?为什么两个都要用?

<details><summary>答案</summary>

计时器(CUDA event)在时间线上打两点,给两点之间一个准确的 GPU 时间,但中间是黑箱。profiler 记录每个算子和每个 kernel 的名字、起止、形状,能看到结构和比例,但记录本身有开销,绝对时间偏大。所以用 profiler 看「时间花在哪」,用计时器报「花了多少」。

</details>

2. `schedule(wait=1, warmup=2, active=3)` 三个阶段各干什么?循环要跑几步?漏了什么 trace 会是空的?

<details><summary>答案</summary>

wait 阶段不记录,warmup 阶段记录但丢弃(让 profiler 自身状态稳定),active 阶段真正记录。循环至少跑 1 + 2 + 3 = 6 步。每步末尾必须调 `prof.step()` 推进阶段,漏了它永远停在 wait,trace 为空。

</details>

3. key_averages 表里 `aten::linear` 的 Self CUDA 是 0,CPU total 是 9.8 ms,能说矩阵乘在 GPU 上没花时间或花了 9.8 ms 吗?

<details><summary>答案</summary>

都不能。`aten::linear` 是 CPU 上的算子,自己不在 GPU 跑,所以 Self CUDA 是 0;它发起的 gemm kernel 才有 GPU 时间,要看 kernel 行。CPU total 9.8 ms 是 CPU 上从进入到返回的时间,含发 kernel 的开销,不等于 GPU 执行时间。

</details>

4. T4 上 TinyLlama batch 1 decode,预期 GPU 时间最长的一类 kernel 是什么?对应模型哪些部分?每步应该出现多少次?怎么用这个次数对账?

<details><summary>答案</summary>

gemm / gemv 类矩阵乘 kernel,对应全部 `nn.Linear`:每层 q/k/v/o 四个投影加 FFN 的 gate/up/down 三个,22 层共 154 个,加 lm_head 一个,每步 155 次。`aten::linear` 的 # of Calls 除以 active 步数应该等于 155,能和 Day 2 数矩阵的结果对上。

</details>

5. trace 里看不到叫 RMSNorm 的 kernel,是模型没做归一化吗?

<details><summary>答案</summary>

不是。eager 模式下 HF 的 RMSNorm 是几行 PyTorch(pow、mean、rsqrt、mul),每行各发一个小 kernel,trace 里是四五个 elementwise 和 reduce 小块紧挨着,没有一个叫 RMSNorm 的整体。开 `with_stack` 能在调用栈里看到 `LlamaRMSNorm.forward`。融成一个 kernel 是 torch.compile 或专用库的事。

</details>

6. 在 T4 的 trace 里找不到 `flash_fwd_kernel`,attention 是怎么跑的?

<details><summary>答案</summary>

T4 是 Turing 架构,FlashAttention 2 需要 Ampere 及以上。sdpa 在 T4 上会走 mem-efficient 后端(kernel 名 `fmha_cutlassF_…`)或 math 后端(bmm + softmax + bmm 三个 kernel)。看到这些名字就是 attention 核心。

</details>

7. elementwise kernel 的 GPU 时间只占 15%,但次数占一半以上,这两个数放在一起说明什么?

<details><summary>答案</summary>

它们不是慢在算,是慢在多。每个只跑几微秒,但每个都要 CPU 发一次 launch,几百次 launch 的 CPU 开销比它们的 GPU 时间还大。这就是 Day 11 要看的 gap 的主要来源,也是 M5 fusion 的动机。

</details>

## 明天预告

Day 11 回到同一份 trace,这次只盯 stream 那一行色块之间的空白:gap。GPU 空转的每一段缝隙都是 Day 1 三分法里 overhead-bound 的实物证据。要算出一步 decode 里 gap 占多少比例,再把 batch 从 1 加到 8 重抓一次,看 GPU 段变长之后 gap 占比怎么变。最后讲两条缩小 gap 的路:让 CPU 少发 kernel,或者让每次 launch 的 kernel 干更多活。
