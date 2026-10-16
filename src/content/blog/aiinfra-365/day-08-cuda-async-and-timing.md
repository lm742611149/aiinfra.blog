---
title: 'Day 8 · CUDA 是异步的：不 synchronize 的计时全是假的'
description: 'CPU 把 kernel 扔进队列就往下走，GPU 在后面慢慢干。不加 synchronize,perf_counter 测到的是「派活的时间」，不是「干完活的时间」，能差几个数量级。今天把这件事画成时间线，对比两种正确的计时法，把 Day 7 的计时代码改成以后一年都用的最终版。'
pubDate: 2026-09-05
regime: none
tags: ['cuda', 'async', 'synchronize', 'timing', 'benchmark', 'aiinfra-365']
series: 'aiinfra-365'
day: 8
lang: 'zh'
---

## 今天要解决的问题

Day 7 的代码里有一行我只说了「照抄」:`torch.cuda.synchronize()`。今天把它讲透。

这不是一个 API 细节。路线图把「CUDA 是异步的」列为 W2 第一个坑,原因是它会让一个完全没写错的程序测出完全错误的数字,而且错的方向是**快得不真实**,最容易让人高兴地相信。以后 M3 到 M8 所有产出物的核心都是「我把某个数字改善了多少」,如果计时方法本身是假的,后面所有数字一起作废。面试里那道必考题「你这个数字怎么保证可信」,第一句答的就是今天的内容。

今天结束时要能做到三件事:

1. 画出 CPU 和 GPU 各自的时间线,指出不 sync 时计时器量到的是哪一段。
2. 说清 `torch.cuda.synchronize()` 和 `torch.cuda.Event` 两种计时法各自量的是什么,什么时候用哪个。
3. 把 Day 7 的计时代码改成一个以后一直能用的 `bench()` 函数。

## CPU 和 GPU 是两台机器

先把模型建对。写 PyTorch 代码的时候,Python 跑在 CPU 上,张量运算跑在 GPU 上。这两个东西不是「同一个程序的两个部分」,是**两台各有自己时钟的机器**,中间靠一条队列连着。

CPU 这边执行 `y = x @ w` 时,实际做的事是:检查形状、选好 kernel、把「请执行这个 kernel,参数是这些」这条指令**塞进队列**,然后立刻返回,继续执行下一行 Python。塞一条指令要几微秒到几十微秒。GPU 那边从队列里按顺序取指令执行,一个矩阵乘可能要几百微秒到几毫秒。

所以在任何一个时刻,CPU 往往已经跑到了很后面,而 GPU 还在啃前面的活。这条队列在 CUDA 里叫 stream,默认所有操作进同一条 stream,严格按提交顺序执行。

这样设计的理由很实在:如果每提交一个 kernel 都要等它干完,CPU 会大量时间在等,GPU 在两个 kernel 之间也会空等 CPU 准备下一条。异步让 CPU 提前把一堆活排好,GPU 一个接一个不停歇地干。Day 11 讲 timeline 上的 gap 时会看到,这条队列排得满不满,直接决定 GPU 有没有在空转。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="CPU 提交与 GPU 执行的两条时间线,标出错误和正确的计时窗口">
<text x="8" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">同一段代码的两条时间线(横轴 = 真实时间)</text>
<text x="8" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">CPU</text>
<line x1="50" y1="54" x2="632" y2="54" stroke="var(--rule)" stroke-width="1"/>
<rect x="50" y="46" width="18" height="16" fill="var(--ink-faint)"/>
<rect x="72" y="46" width="18" height="16" fill="var(--ink-faint)"/>
<rect x="94" y="46" width="18" height="16" fill="var(--ink-faint)"/>
<rect x="116" y="46" width="18" height="16" fill="var(--ink-faint)"/>
<text x="50" y="40" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">提交 k1 k2 k3 k4,每个几十 µs</text>
<text x="142" y="58" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">→ 继续跑 Python(空闲或准备下一批)</text>
<text x="8" y="118" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">GPU</text>
<line x1="50" y1="114" x2="632" y2="114" stroke="var(--rule)" stroke-width="1"/>
<rect x="60" y="106" width="130" height="16" fill="var(--mem)"/>
<rect x="192" y="106" width="140" height="16" fill="var(--mem)"/>
<rect x="334" y="106" width="120" height="16" fill="var(--mem)"/>
<rect x="456" y="106" width="150" height="16" fill="var(--mem)"/>
<text x="110" y="118" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">k1</text>
<text x="252" y="118" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">k2</text>
<text x="386" y="118" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">k3</text>
<text x="522" y="118" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">k4</text>
<line x1="50" y1="150" x2="134" y2="150" stroke="var(--compute)" stroke-width="3"/>
<line x1="50" y1="144" x2="50" y2="156" stroke="var(--compute)" stroke-width="2"/>
<line x1="134" y1="144" x2="134" y2="156" stroke="var(--compute)" stroke-width="2"/>
<text x="50" y="172" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">不 sync:perf_counter 量到的只是这一段(派活时间)</text>
<line x1="50" y1="200" x2="606" y2="200" stroke="var(--mem)" stroke-width="3"/>
<line x1="50" y1="194" x2="50" y2="206" stroke="var(--mem)" stroke-width="2"/>
<line x1="606" y1="194" x2="606" y2="206" stroke="var(--mem)" stroke-width="2"/>
<text x="50" y="222" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">sync 之后再读表:量到的才是 GPU 真正干完活的时间</text>
<text x="8" y="244" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">synchronize() 的作用 = 让 CPU 停在这里,直到 GPU 队列里所有活都干完。</text>
</svg>
<figcaption>不 sync 的计时器停在 CPU 派完活的那一刻,GPU 还有一大半没干。两段的长度可以差几个数量级。</figcaption>
</figure>

## 不 sync 测到的到底是什么

把图里那段琥珀色的线换成数字。TinyLlama decode 一步大约要经过 22 层,每层十来个 kernel(几个矩阵乘、attention、rmsnorm、silu、加法),再加 embedding 和 lm_head,一步大约 250 到 300 个 kernel。CPU 提交一个 kernel 按 20 µs 算,一步的**提交时间**大约:

```
280 个 kernel × 20 µs ≈ 5.6 ms
```

而 GPU 真正干完这一步要多久?Day 7 记下的 6.9 ms 是纯搬权重的下限,实际比这多。看起来两个数好像差不多?这正是 decode 阶段的特殊之处,Day 11 会专门讲:decode 每步的活太碎,提交时间和执行时间是同一个量级,这就是 overhead-bound 的来源。

但换一个场景就完全不一样了。prefill 阶段一次算 2000 个 token,kernel 数量和 decode 一步差不多(还是那 280 个),提交时间还是 5 到 6 ms,但每个矩阵乘要处理的数据多了 2000 倍,GPU 执行时间可能是几百毫秒。不 sync 的话,测到的 6 ms 和真实的几百毫秒差两个数量级。

更极端的是单个大矩阵乘。提交一次 20 µs,一个 8192 × 8192 的 fp16 矩阵乘在 T4 上要:

```
2 × 8192³ FLOP ≈ 1.1e12 FLOP ÷ 65e12 FLOP/s ≈ 17 ms(打满算力的理想值)
```

不 sync 测出 20 µs,以为 T4 做到了 5.5e16 FLOP/s,比 H100 还快一千倍。这种荒谬的数字反而好发现;真正危险的是差 3 到 5 倍那种,看着像真的。

所以「不 sync 测到的是什么」的准确答案是:**测到的是 CPU 把指令塞进队列所花的时间,和 GPU 干活的时间之间没有固定关系。**它可能接近真实值(decode 这种碎活),也可能差几百倍(大矩阵乘),取决于每个 kernel 里有多少活。一个和真实值没有固定关系的数,就是假的。

## 隐式同步:有时候救你,有时候坑你

有几种操作会**偷偷地** sync,因为它们需要 GPU 的结果才能继续:

- `tensor.item()`:把一个标量搬回 CPU 变成 Python 数字,必须等 GPU 算完。
- `tensor.cpu()`、`tensor.numpy()`、`tensor.tolist()`:同理。
- `print(tensor)`:打印要看内容,内部会搬回 CPU。
- `if tensor > 0:`:条件判断需要具体值。
- `torch.cuda.memory_allocated()` 这类查询**不会** sync,它读的是 PyTorch 自己的账本。

这解释了一个常见的错觉:有人的计时代码没写 sync,数字看着却很正常。多半是因为代码里有 `.item()` 或者 `print(loss)`,它替你 sync 了。这种「正确」是偶然的,换一段代码就不成立。

反过来,隐式同步也是性能坑。训练循环里每步 `loss.item()` 打日志,每次都让 CPU 停下来等 GPU 清空队列,GPU 干完之后又得等 CPU 重新把下一批活排上,队列断了一次。Day 11 在 timeline 上会看到这种「断流」长什么样:一个 gap。`generate` 内部每生成一个 token 都要检查是不是 EOS,这就是一次隐式同步,也是 decode 阶段 gap 的来源之一。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="隐式同步打断 GPU 队列造成空隙的对比时间线">
<text x="8" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">每步 .item() 对 GPU 队列的影响(示意)</text>
<text x="8" y="50" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">无隐式同步</text>
<line x1="100" y1="46" x2="632" y2="46" stroke="var(--rule)" stroke-width="1"/>
<rect x="100" y="38" width="120" height="16" fill="var(--mem)"/>
<rect x="222" y="38" width="120" height="16" fill="var(--mem)"/>
<rect x="344" y="38" width="120" height="16" fill="var(--mem)"/>
<rect x="466" y="38" width="120" height="16" fill="var(--mem)"/>
<text x="100" y="72" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">GPU 连着干,CPU 提前排好了队</text>
<text x="8" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每步 .item()</text>
<line x1="100" y1="116" x2="632" y2="116" stroke="var(--rule)" stroke-width="1"/>
<rect x="100" y="108" width="120" height="16" fill="var(--mem)"/>
<rect x="250" y="108" width="120" height="16" fill="var(--mem)"/>
<rect x="400" y="108" width="120" height="16" fill="var(--mem)"/>
<rect x="550" y="108" width="82" height="16" fill="var(--mem)"/>
<rect x="220" y="108" width="30" height="16" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1"/>
<rect x="370" y="108" width="30" height="16" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1"/>
<rect x="520" y="108" width="30" height="16" fill="var(--compute-wash)" stroke="var(--compute)" stroke-width="1"/>
<text x="100" y="142" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">琥珀色 = gap:GPU 空转,等 CPU 拿到结果、跑完 Python、再排下一批</text>
<text x="8" y="176" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">同样的活,下面那条总时间更长。每个 gap 几十到几百 µs,decode 一步几百个 kernel,攒起来不小。</text>
<text x="8" y="192" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">这是 Day 1 三分法里 overhead-bound 的机制,Day 11 在 Perfetto 里找它。</text>
</svg>
<figcaption>隐式同步替你「修好」了计时,代价是 GPU 队列被反复打断。计时要显式 sync,生产代码要避免不必要的 sync,两件事方向相反。</figcaption>
</figure>

## 第一种正确计时法:synchronize + perf_counter

最直接的办法:开始前 sync 一次(保证之前排的活不混进来),跑要测的代码,结束后再 sync 一次,然后读表。

```python
import time, torch

def time_sync(fn, *args):
    torch.cuda.synchronize()          # 清空之前的队列
    t0 = time.perf_counter()
    fn(*args)
    torch.cuda.synchronize()          # 等这次的活全部干完
    return time.perf_counter() - t0   # 秒
```

开始前那次 sync 容易被忘。没有它,如果上一段代码还有活没干完,这次测的时间会把别人的尾巴算进来。

这个方法量到的是**从 CPU 开始提交,到 GPU 全部干完**的墙上时间,包含了 Python 开销、提交开销、GPU 执行,以及 GPU 排队等 CPU 的所有空隙。这正是用户感受到的端到端延迟,所以测「一次 generate 要多久」「TPOT 是多少」用它是对的。

它的代价是 sync 本身会让 CPU 停下来,量完之后队列是空的,如果在循环里连续测很多次,每次之间 GPU 都会空一下。测单段代码没问题,想把计时嵌进真实的服务流程里就不合适了。

## 第二种正确计时法:CUDA Event

CUDA Event 是往 stream 里塞一个「记时间戳」的标记。GPU 执行到这个标记时,记下 GPU 自己的时钟。两个 Event 之间的差就是这两个位置之间 GPU 实际花的时间。

```python
def time_event(fn, *args):
    start = torch.cuda.Event(enable_timing=True)
    end = torch.cuda.Event(enable_timing=True)
    start.record()                    # 塞进队列,不阻塞 CPU
    fn(*args)
    end.record()                      # 塞进队列,不阻塞 CPU
    end.synchronize()                 # 这时才等,只等到 end 这个标记
    return start.elapsed_time(end) / 1000   # elapsed_time 返回毫秒,转成秒
```

和第一种的区别在于**时间戳是 GPU 打的,不是 CPU 打的**。`start.record()` 这一行 CPU 立刻返回,GPU 什么时候执行到它才打戳。所以 Event 量到的是「GPU 从执行到 start 标记,到执行到 end 标记」的时间,不含 start 之前 CPU 提交的那段等待。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="synchronize 计时与 CUDA Event 计时各自覆盖的时间段">
<text x="8" y="18" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">两种计时法量的区间(横轴 = 真实时间)</text>
<text x="8" y="58" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">CPU</text>
<line x1="50" y1="54" x2="632" y2="54" stroke="var(--rule)" stroke-width="1"/>
<circle cx="60" cy="54" r="4" fill="var(--compute)"/>
<text x="68" y="44" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">perf_counter t0</text>
<rect x="70" y="46" width="14" height="16" fill="var(--ink-faint)"/>
<rect x="88" y="46" width="14" height="16" fill="var(--ink-faint)"/>
<rect x="106" y="46" width="14" height="16" fill="var(--ink-faint)"/>
<text x="126" y="58" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">提交 start.record / k1 / k2 / end.record</text>
<circle cx="560" cy="54" r="4" fill="var(--compute)"/>
<text x="470" y="44" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">sync 返回,读 t1</text>
<text x="8" y="118" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">GPU</text>
<line x1="50" y1="114" x2="632" y2="114" stroke="var(--rule)" stroke-width="1"/>
<line x1="150" y1="104" x2="150" y2="124" stroke="var(--mem)" stroke-width="2"/>
<text x="120" y="98" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">start 戳</text>
<rect x="156" y="106" width="180" height="16" fill="var(--mem)"/>
<rect x="340" y="106" width="200" height="16" fill="var(--mem)"/>
<text x="236" y="118" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">k1</text>
<text x="430" y="118" font-family="var(--font-mono)" font-size="10" fill="var(--paper-raised)">k2</text>
<line x1="546" y1="104" x2="546" y2="124" stroke="var(--mem)" stroke-width="2"/>
<text x="530" y="98" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">end 戳</text>
<line x1="60" y1="150" x2="560" y2="150" stroke="var(--compute)" stroke-width="3"/>
<text x="60" y="170" font-family="var(--font-mono)" font-size="10" fill="var(--compute)">synchronize 法:t1 − t0,含 CPU 提交 + GPU 等第一条指令到达的空隙</text>
<line x1="150" y1="186" x2="546" y2="186" stroke="var(--mem)" stroke-width="3"/>
<text x="150" y="204" font-family="var(--font-mono)" font-size="10" fill="var(--mem)">Event 法:end − start,只含 GPU 从 start 戳到 end 戳之间</text>
</svg>
<figcaption>两种方法量的不是同一段。工作量大时两者接近;活很碎、CPU 提交跟不上时,Event 法会明显小于 synchronize 法,差的那部分就是 overhead。</figcaption>
</figure>

什么时候用哪个:

| 要测的东西 | 用哪个 | 原因 |
| --- | --- | --- |
| 端到端延迟(一次 generate、TTFT、TPOT) | synchronize + perf_counter | 用户感受到的就是墙上时间,CPU 那部分不能剔掉 |
| 一个 kernel 或一小段 GPU 计算的纯执行时间(Day 13、14 测带宽和算力) | CUDA Event | 不想把 Python 和提交开销混进来 |
| 两者同时测 | 都用 | 差值就是 overhead 的大小,Day 11 用这个思路 |

有一个精度上的补充。Event 的时间戳精度大约 0.5 µs,perf_counter 在 CPU 上是纳秒级,但 sync 本身有几微秒的开销。测毫秒级的东西两者都够;测微秒级的单个 kernel,Event 更准,而且 Day 10 会看到 profiler 给的是更细的数。

## 把 Day 7 的计时代码改成最终版

综合今天的内容,把 Day 7 那个 `timed_generate` 升级成一个通用的 `bench()`。要求:开始前 sync;warmup 次数可配;多次取中位数;同时报极差;可选 Event 计时。

```python
import time, statistics, torch

def bench(fn, *args, warmup=3, iters=10, use_event=False, **kw):
    """返回 (中位数秒, 极差/中位数, 全部样本)。fn 里的 GPU 工作全部计入。"""
    for _ in range(warmup):
        fn(*args, **kw)
    torch.cuda.synchronize()

    samples = []
    for _ in range(iters):
        if use_event:
            s = torch.cuda.Event(enable_timing=True)
            e = torch.cuda.Event(enable_timing=True)
            s.record()
            fn(*args, **kw)
            e.record()
            e.synchronize()
            samples.append(s.elapsed_time(e) / 1000)
        else:
            torch.cuda.synchronize()
            t0 = time.perf_counter()
            fn(*args, **kw)
            torch.cuda.synchronize()
            samples.append(time.perf_counter() - t0)

    med = statistics.median(samples)
    spread = (max(samples) - min(samples)) / med
    return med, spread, samples
```

用它重测 Day 7 的 generate:

```python
def gen64():
    with torch.no_grad():
        model.generate(**inputs, max_new_tokens=64, min_new_tokens=64,
                       do_sample=False, pad_token_id=tok.eos_token_id)

med, spread, _ = bench(gen64)
print(f"generate 64 tok: 中位数 {med*1000:.0f} ms,极差/中位数 {spread:.1%}")
```

`min_new_tokens=64` 是 Day 7 排查清单里提过的,强制生成满 64 个,防止模型提前吐 EOS 让长度不一致。

再做一个对照实验,亲眼看一次「不 sync 有多假」。用一个大矩阵乘,三种方式各测一次:

```python
a = torch.randn(8192, 8192, device="cuda", dtype=torch.float16)
b = torch.randn(8192, 8192, device="cuda", dtype=torch.float16)

def mm():
    return a @ b

# 方式 1:错误,不 sync
mm(); torch.cuda.synchronize()          # 先 warmup 一次
t0 = time.perf_counter(); mm(); t_wrong = time.perf_counter() - t0

# 方式 2:synchronize 法
t_sync, _, _ = bench(mm, warmup=2, iters=5)

# 方式 3:Event 法
t_evt, _, _ = bench(mm, warmup=2, iters=5, use_event=True)

flops = 2 * 8192**3
print(f"不 sync      : {t_wrong*1e3:8.3f} ms → 假算力 {flops/t_wrong/1e12:9.1f} TFLOP/s")
print(f"synchronize : {t_sync*1e3:8.3f} ms → 实测算力 {flops/t_sync/1e12:9.1f} TFLOP/s")
print(f"Event       : {t_evt*1e3:8.3f} ms → 实测算力 {flops/t_evt/1e12:9.1f} TFLOP/s")
```

预期是什么,依据是什么:

- **不 sync 那一行**会是几十微秒量级,算出来的「算力」是几万 TFLOP/s,比任何存在的 GPU 都高几百倍。它量的是提交一个 kernel 的时间。
- **synchronize 和 Event 两行**应该都在十几到二十几毫秒。理想值是 1.1e12 ÷ 65e12 ≈ 17 ms,实际达不到峰值,Day 14 会讲为什么。两者之间差不到一毫秒,因为这个 kernel 足够大,CPU 提交那点时间相对可以忽略。
- 8192 的 fp16 方阵每个 128 MB,三个共 384 MB,T4 放得下。如果 Colab 给的卡显存更小,改成 4096。

这三个数字填进记录表。它们是 W3 测算力的预演,Day 14 会用同一段代码正式测。

| 日期 | 卡型 | 不 sync (ms) | synchronize (ms) | Event (ms) | 由 sync 值算出的 TFLOP/s | 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

## 顺带:PyTorch 自带的 benchmark 工具

PyTorch 有一个 `torch.utils.benchmark.Timer`,做的就是上面 `bench()` 干的事,而且更细:自动 sync、自动 warmup、按目标时长决定跑多少次、报中位数和四分位距。

```python
from torch.utils.benchmark import Timer

t = Timer(stmt="a @ b", globals={"a": a, "b": b})
m = t.blocked_autorange(min_run_time=2.0)   # 至少跑 2 秒
print(m)            # 打印中位数、IQR、跑了多少次
print(m.median)     # 秒
```

以后测单个 op 优先用它,省得自己维护 `bench()`。但 `generate` 这种一次跑一秒多的东西,`blocked_autorange` 会跑很多次,用自己的 `bench()` 控制次数更方便。两个都留着。

还有一件事今天先埋一个钩子:Day 10 要用 `torch.profiler`。profiler 本身也有开销,它要在每个 kernel 前后记录时间戳和元数据,跑在 profiler 下的代码比不跑慢。所以 profiler 给的绝对时间比 `bench()` 大,但它给的是**每个 kernel 各占多少**的比例,这是 `bench()` 给不了的。两个工具回答不同的问题:`bench()` 答「总共多久」,profiler 答「时间花在哪」。

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dKZxUcuOb8A" title="PyTorch and CPU-GPU Synchronizations [PyCon DE & PyData 2026]" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>PyData · 《PyTorch and CPU-GPU Synchronizations》(PyCon DE &amp; PyData 2026)· 整场讲的就是今天这件事:哪些操作会隐式同步、怎么在 profiler 里看到同步点、为什么它们拖慢训练。看完 Day 11 找 gap 会更快。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kF411f71X&autoplay=0&high_quality=1" title="CUDA编程模型系列十( CUDA Stream / CUDA 流 / 多流执行)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>扫地的小何尚 · 《CUDA编程模型系列十(CUDA Stream / CUDA 流 / 多流执行)》· 34 分钟,中文。讲 stream 是什么、默认 stream 的行为、多 stream 怎么重叠计算和拷贝。今天只需要前半段「stream 是有序队列」的部分,多 stream 到 M5 再说。</figcaption>
</figure>

## 名词解释

| 名词 | 意思 | 首次出现 |
| --- | --- | --- |
| 异步执行 | CPU 提交 GPU 操作后不等它完成就继续,GPU 在后台按队列执行 | Day 8 |
| stream | CUDA 里的有序任务队列,同一 stream 内严格按提交顺序执行。PyTorch 默认所有操作走默认 stream | Day 8 |
| kernel launch / 提交 | CPU 把「执行某个 kernel」的指令塞进 stream,耗时几微秒到几十微秒,和 kernel 里有多少活无关 | Day 8 |
| torch.cuda.synchronize() | 让 CPU 阻塞,直到当前设备所有 stream 的活全部干完 | Day 7 用,Day 8 讲 |
| 隐式同步 | 某些操作(.item()、.cpu()、print 张量、条件判断)因为需要结果而自动等待 GPU | Day 8 |
| CUDA Event | 塞进 stream 的时间戳标记,GPU 执行到它时打戳;两个 Event 的 elapsed_time 是 GPU 侧的耗时 | Day 8 |
| 端到端延迟 | 从 CPU 发起到结果可用的墙上时间,含 CPU、提交、GPU、排队空隙 | Day 8 |
| 墙上时间 | wall-clock time,现实中流逝的时间,对应 perf_counter 量的东西 | Day 8 |
| torch.utils.benchmark.Timer | PyTorch 自带的微基准工具,自动 warmup、sync、多次取中位数 | Day 8 |
| overhead | Day 1 三分法里的第三种瓶颈:时间花在 CPU 和提交上,GPU 在等 | Day 1,Day 8 有了机制 |

## 常见误区

**以为代码正确就不需要 sync。**异步是设计,不是 bug。代码完全正确的情况下,不 sync 的计时也是错的。`synchronize` 只影响计时,不影响结果的正确性。

**看到数字正常就觉得计时没问题。**可能是别的地方有 `.item()` 或 `print` 偷偷 sync 了。换一段没有隐式同步的代码,同样的计时方法就错了。计时永远显式 sync,不靠偶然。

**忘记开始前也要 sync。**只在结束后 sync,如果前面还有活没干完,这次测的时间会包含别人的尾巴。`bench()` 里 warmup 后那一次 sync 就是干这个的。

**在生产代码里到处 sync。**计时要 sync,服务代码要尽量不 sync,方向相反。每步 `.item()` 打日志会把 GPU 队列反复切断,这是训练和推理里常见的 overhead 来源。要打日志就攒几步一起搬回来。

**Event 和 synchronize 混用后拿两个数直接比。**两者量的区间不同,Event 不含 start 之前 CPU 提交的等待。差值有意义(是 overhead),但不能说「Event 测得更准所以以它为准」,要看测的是什么问题。

**测很小的东西却用 perf_counter。**sync 本身有几微秒开销,测一个 5 µs 的 kernel 误差就是 100%。微秒级用 Event 或者干脆用 profiler。

## 参考资料

### 文章与文档

- PyTorch,《CUDA semantics》,官方对异步执行、stream、同步的说明,「Asynchronous execution」一节是今天的原始出处。https://pytorch.org/docs/stable/notes/cuda.html
- PyTorch,`torch.cuda.synchronize` 文档。https://pytorch.org/docs/stable/generated/torch.cuda.synchronize.html
- PyTorch,`torch.cuda.Event` 文档,`record`、`synchronize`、`elapsed_time` 三个方法。https://pytorch.org/docs/stable/generated/torch.cuda.Event.html
- PyTorch,《PyTorch Benchmark》recipe,`torch.utils.benchmark.Timer` 的用法,以及为什么直接用 `time` 模块测 GPU 会错。https://pytorch.org/tutorials/recipes/recipes/benchmark.html
- NVIDIA 开发者博客,《How to Implement Performance Metrics in CUDA C/C++》,CUDA Event 计时的原始讲法,C++ 版,PyTorch 的 Event 就是它的封装。https://developer.nvidia.com/blog/how-implement-performance-metrics-cuda-cc/
- NVIDIA,《CUDA C++ Programming Guide》,「Asynchronous Concurrent Execution」一章讲 stream 和 event 的完整语义,今天只需要读前几页。https://docs.nvidia.com/cuda/cuda-c-programming-guide/index.html
- Horace He,《Making Deep Learning Go Brrrr From First Principles》,overhead 那一节今天有了机制层面的解释,值得回去重读。https://horace.io/brrr_intro.html

### 视频

- PyData,《PyTorch and CPU-GPU Synchronizations》(PyCon DE &amp; PyData 2026),YouTube,已嵌在正文。
- 扫地的小何尚,《CUDA编程模型系列十(CUDA Stream / CUDA 流 / 多流执行)》,B 站 BV1kF411f71X,已嵌在正文。
- GPU MODE,《Lecture 1: How to profile CUDA kernels in PyTorch》,Day 10 正式看,今天可以先看前 10 分钟,里面演示了不 sync 的计时有多离谱。讲义仓库 https://github.com/gpu-mode/lectures

## 自测

合上笔记做。

1. 不加 `synchronize()`,`time.perf_counter()` 测出来的时间实际是什么?它和真实执行时间之间是什么关系?

<details><summary>答案</summary>

是 CPU 把 kernel 指令塞进 stream 队列所花的时间(提交时间),每个 kernel 几微秒到几十微秒,和 kernel 里有多少活无关。它和 GPU 真实执行时间之间没有固定关系:活很碎时(decode)两者是同一量级,活很大时(prefill、大矩阵乘)可以差两三个数量级。没有固定关系的数就是假的。

</details>

2. 一个 8192 × 8192 的 fp16 矩阵乘在 T4 上不 sync 测出 20 µs,算出的算力是多少?这个数为什么不可能?

<details><summary>答案</summary>

2 × 8192³ ≈ 1.1e12 FLOP,除以 20e-6 s 得 5.5e16 FLOP/s,即 55,000 TFLOP/s,是 T4 标称 65 TFLOP/s 的八百多倍,比 H100 还快几十倍。物理上不可能,说明测到的是提交时间。真实值应接近 1.1e12 ÷ 65e12 ≈ 17 ms 或更长。

</details>

3. 列出至少三种会隐式同步的操作,并说明它们为什么会同步。

<details><summary>答案</summary>

`.item()`、`.cpu()` / `.numpy()` / `.tolist()`、`print(tensor)`、`if tensor > 0` 这类条件判断。共同点是它们需要 GPU 上的具体数值才能继续执行 CPU 侧的逻辑,所以必须等 GPU 算完并把结果搬回来。相反,`torch.cuda.memory_allocated()` 读的是 PyTorch 自己的账本,不会同步。

</details>

4. synchronize 法和 CUDA Event 法各自量的是哪一段时间?测 TPOT 应该用哪个,测单个 kernel 的执行时间应该用哪个?

<details><summary>答案</summary>

synchronize 法量的是从 CPU 读 t0 到 GPU 全部干完的墙上时间,含 Python、提交、GPU 执行和排队空隙。Event 法量的是 GPU 从执行到 start 标记到执行到 end 标记之间的时间,不含 start 之前 CPU 提交的等待。TPOT 是用户感受的端到端延迟,用 synchronize 法;单个 kernel 的纯执行时间用 Event 法。两者的差值就是 overhead 的大小。

</details>

5. `bench()` 函数里 warmup 之后、正式计时之前那一次 `synchronize()` 是干什么的?去掉会怎样?

<details><summary>答案</summary>

清空 warmup 留在队列里的活,保证第一次正式计时不会把 warmup 的尾巴算进去。去掉的话,第一个样本会偏大,极差随之变大,可能让「方差 < 10%」的验收失败,而且原因很难查。

</details>

6. 为什么说「计时要 sync,生产代码要少 sync」两件事方向相反?

<details><summary>答案</summary>

计时要 sync 是为了让 CPU 等到 GPU 干完再读表,否则数字是假的。生产代码里 sync(包括 `.item()` 这类隐式的)会让 CPU 停下来等 GPU 清空队列,GPU 干完之后又要等 CPU 排下一批,队列断一次就产生一个 gap,GPU 空转。前者追求测量正确,后者追求 GPU 不空转,所以计时代码里的 sync 不能原样留在服务代码里。

</details>

## 明天预告

Day 9 把 Day 7 那个混在一起的「64 个 token 多少秒」拆成两个数:TTFT(首 token 时间,对应 prefill)和 TPOT(之后每个 token 的时间,对应 decode)。然后做这周真正的产出:拿实测的 TPOT 除以 Day 7 算出的理论下限 6.9 ms,看这个比值落在 1.5 到 3 倍之间,还是差到 10 倍。前者说明 W1 对 memory-bound 的判断是对的,那张表以后八个月都能用来估算;后者说明有别的东西在拖,大概率是今天讲的 overhead,Day 11 会在 timeline 上亲眼看到它。
