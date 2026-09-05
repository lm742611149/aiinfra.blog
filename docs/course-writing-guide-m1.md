> 本文件是 2026-09-05 写 M1(Day 7–30)时给写手用的规范与规划,M2 起沿用第 1–3、5 节,第 4 节换成新月份的逐日规划。校验:`python3 scripts/check-course.py [--links]`;写完/改完标题后跑 `npm run og` 生成社交预览图(public/og/,要一起提交)。

# aiinfra-365 · M1(Day 7–30)写作规范与逐日规划

所有写手(子代理)必须读完本文件再动笔。文件路径:`~/Documents/blog/src/content/blog/aiinfra-365/day-NN-<slug>.md`。

## 1. 不变的骨架(和 Day 0–6 完全一致)

frontmatter:

```yaml
---
title: 'Day N · 标题'                 # 必须以 “Day N · ” 开头(中间点 · 两侧各一个空格)
description: '一两句话,会出现在目录页和 RSS。'
pubDate: 2026-09-05                   # 实际发布的那天,绝不能是未来;界面不显示日期,只显示 Day N(日期只给 RSS/sitemap/JSON-LD 用)
regime: memory                        # memory | compute | none,按当天主题真实归类,不是装饰
tags: ['profiler', 'colab', 'aiinfra-365']   # 最后一个固定 'aiinfra-365'
series: 'aiinfra-365'
day: 7
lang: 'zh'
---
```

正文章节顺序(二级标题 `##`,一个都不能少,顺序不能换):

1. `## 今天要解决的问题` —— 先说今天结束时要能回答什么、算出什么、看到什么。
2. 正文若干节(自由命名,3–7 节)。
3. `## 名词解释` —— 表格,两列「名词 | 意思」或三列加「首次出现」。
4. `## 常见误区` —— 写「我」会犯的错,每条加粗一句话开头再解释。
5. `## 参考资料` —— 分「文章 / 视频 / 文档或代码」小节,每条一句话说它有什么用。
6. `## 自测` —— 5–6 题,每题答案放 `<details><summary>答案</summary>` 里,details 内部前后各留空行。
7. `## 明天预告` —— 必须和下面规划表里**下一天**的标题和内容一致(复习日写「下周预告」)。

## 2. 语气与内容口径

- 第一人称学习日志,写给三个月后复习的自己。中文正文,术语保留英文。**不要 AI 报告腔**:不用「总结来说」「值得注意的是」,少用加粗小标题式的句子。
- **一次一小块**:每个新概念先假设读者没听过这个词,用已经学过的东西做锚点(Day 1 三种瓶颈、Day 2 矩阵形状、Day 4 KV cache、Day 5 roofline/ridge point 153)。
- **每个数字都要能算出来**。给出算式,不只给结论。
- 长度目标:每篇 **4,500–6,500 纯汉字**(`[一-鿿]` 口径;含代码/标点/SVG 的总字符约 2–3 万),内容要充实:算式、代码、表格、图、可执行的步骤。(原稿写的 9–13k 是按总字符口径误标,M1 实际产出 4.3k–9k 汉字。)
- 代码块要能直接跑(Python/bash),注明在哪跑(Colab / 本机终端 / GPU 实例)。
- 全系列统一数字口径:
  - Llama-2-7B:32 层、d=4096、32 头、head_dim 128、FFN 中间 11008、参数 6.74B、fp16 权重 13.5 GB、KV cache 512 KB/token。
  - A100 80GB SXM:BF16 312 TFLOP/s、HBM 2039 GB/s、ridge point ≈ 153。
  - **Colab 免费卡 T4**:16 GB GDDR6、带宽 320 GB/s、fp16 tensor core 65 TFLOP/s、fp32 8.1 TFLOP/s、ridge point ≈ 203、Turing 架构、**不支持 bf16**。
  - W2/W3 用的实验模型:**TinyLlama-1.1B**(22 层、d=2048、32 个 q 头、**4 个 KV 头(GQA)**、head_dim 64、FFN 中间 5632、参数 1.1B、fp16 权重约 2.2 GB、KV cache 每 token = 2 × 22 × (4×64) × 2 B = 22.5 KB)。备选 Qwen2.5-0.5B。
  - 由此 T4 上 TinyLlama decode batch 1 的理论下限 = 2.2 GB ÷ 320 GB/s ≈ 6.9 ms ≈ 145 tok/s。
- **诚实原则(最重要)**:W2–W4 涉及实际运行,这些文章写的时候还没有真实实测数据。所以:
  - 规格数字(带宽、TFLOPS、价格)必须来自公开资料并可核对。
  - 理论数字要给算式。
  - **凡是「跑出来」的数字,只能写成「预期区间」并说明依据**(例如「实测带宽通常是标称的 75–90%」),同时在文中放一张**留空的记录表**让以后填真实数值。不得编造「我测到 X ms」这类第一人称实测结论。
  - 云 GPU 价格写「2026 年 9 月查到的大致区间」,给出处链接。

## 3. 图片与视频(本轮新增要求,每篇必有)

### 3.1 图:用内联 SVG,每篇 2–4 张

- 用 `<figure>` 包裹,内部一个 `<svg viewBox="0 0 640 H" role="img" aria-label="…">`,下方 `<figcaption>` 用一两句中文说明这张图在看什么。
- 只用站点 token 上色,保证明暗双模式都能看:文字 `var(--ink)` / 次要 `var(--ink-soft)` / 淡 `var(--ink-faint)`,线 `var(--rule)`,底 `var(--paper-raised)`,**memory-bound 相关用 `var(--mem)` 和 `var(--mem-wash)`,compute-bound 相关用 `var(--compute)` 和 `var(--compute-wash)`**,不要出现别的颜色。
- SVG 内的 `<text>` 写 `font-family="var(--font-mono)"`,字号 11–13,文字要短(中文可用)。
- 图要讲机制,不是装饰:时间线、内存条分块、roofline、流程图、层次结构、对比条。坐标手工摆好,别重叠。
- HTML 块和 markdown 之间前后都留空行;`<figure>` 内部不要写 markdown。
- 不要热链外站图片(许可和失效风险),需要真实截图的地方用文字描述「截图长什么样、看哪里」,并留一行 `<!-- TODO: 截图 xxx -->`。

### 3.2 视频:每篇 1–2 个,只嵌**已验证**的

YouTube 写法:

```html
<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/VIDEO_ID" title="视频标题" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>作者 · 标题 · 看哪几分钟、看什么。</figcaption>
</figure>
```

Bilibili 写法(国内访问友好,优先找 B 站有的):

```html
<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BVxxxxxxxx&autoplay=0&high_quality=1" title="视频标题" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>UP 主 · 标题 · 看哪一段。</figcaption>
</figure>
```

**验证命令(必须跑,把返回的标题写进 figcaption)**:

```bash
# YouTube:200 且返回 JSON 里有 title 才算通过
curl -s -o /dev/null -w "%{http_code}\n" "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=VIDEO_ID&format=json"
curl -s "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=VIDEO_ID&format=json"
# Bilibili:code 为 0 才算通过
curl -s "https://api.bilibili.com/x/web-interface/view?bvid=BVxxxxxxxx" | head -c 400
```

已知可用的 YouTube ID(仍要自己 curl 一遍再用):Karpathy《Let's build GPT》= `kCc8FmEb1nY`;3Blue1Brown《But what is a GPT?》= `wjZofJX0v4M`;3Blue1Brown《Attention in transformers》= `eMlx5fFNoYc`。其余自己搜(可用 `curl -s "https://www.youtube.com/results?search_query=..."` 从结果里抓 `videoId`,再 oEmbed 验证)。验证不过的**一律不嵌**,改成参考资料里「按标题搜索」。

### 3.3 外链

参考资料里的每个 URL 都要 `curl -s -o /dev/null -w "%{http_code}" -L URL` 得到 200(个别站返回 403 给爬虫的,注明「需浏览器打开」)。拿不准的写「按标题搜索」不写 URL。

## 4. Day 7–30 逐日规划(标题、内容、regime 已定,不要改动标题)

### W2(Day 7–12)· 第一次上手:Colab + torch.profiler

| Day | slug | 标题 | regime | 内容要点 |
| --- | --- | --- | --- | --- |
| 7 | day-07-colab-first-inference | Day 7 · 第一次真上手:Colab 上跑通 TinyLlama 推理 | none | 为什么选 Colab 免费 T4 和 1B 级模型(7B fp16 在 16 GB 上 OOM 的算式);Colab 开 GPU、`nvidia-smi` 记卡型;transformers 加载 TinyLlama-1.1B fp16、`generate` 跑通;第一次慢好几倍的两个原因(CUDA context 初始化 + kernel 选择/缓存);warmup 2–3 次;**验收:连续 10 次运行延迟方差 < 10%**,给计算方差的代码;记录表留空。T4 规格与 A100 对比表;T4 不支持 bf16 的坑。 |
| 8 | day-08-cuda-async-and-timing | Day 8 · CUDA 是异步的:不 synchronize 的计时全是假的 | none | CPU 提交 kernel、GPU 排队执行的模型(画时间线图);不 sync 测到的是「提交时间」;`torch.cuda.synchronize()` 与 `torch.cuda.Event` 两种计时法;`time.perf_counter` 位置;warmup 与 profiler 自身开销;多次取中位数不取平均;把 Day 7 的计时代码改对前后对比(预期差几个数量级,说明依据)。 |
| 9 | day-09-ttft-tpot-vs-theory | Day 9 · 把 TTFT 和 TPOT 分开测,再和 W1 的理论下限对账 | memory | TTFT/TPOT 定义;为什么 TTFT 大(prefill compute-bound,一次算整段 prompt);用 streamer 或分两次 generate 分开测的代码;TinyLlama 在 T4 的理论下限 6.9 ms(算式);**整周真正的产出:实测 TPOT ÷ 理论下限的比值**,1.5–3 倍 vs 10 倍各说明什么;比值是全年调优的基线;记录表留空。GQA 让 KV cache 变小对 TPOT 影响很小(权重才是大头)。 |
| 10 | day-10-torch-profiler-perfetto | Day 10 · torch.profiler 抓一次 generate,在 Perfetto 里看懂 timeline | none | `torch.profiler.profile` 参数(activities、record_shapes、schedule wait/warmup/active)、`export_chrome_trace`;Perfetto 打开(ui.perfetto.dev)、CPU 线程行 vs GPU stream 行;`key_averages().table(sort_by="cuda_time_total")`;**top 5 kernel 各对应模型哪部分**:gemm/cutlass/cublas = 线性层矩阵乘,attention kernel(sdpa/flash/mem-efficient),elementwise(silu、mul、add = FFN 激活与残差),layernorm/rmsnorm,embedding/index、softmax;画一张「kernel 名 → 模型部件」映射图;记录表留空。 |
| 11 | day-11-gaps-overhead-bound | Day 11 · timeline 上的 gap:overhead-bound 的实物证据 | none | gap 是什么(GPU 空转,CPU 在发 kernel/做 Python);decode 每步几十到上百个小 kernel,每个几微秒,launch 开销 5–10 µs 量级;batch 1 下 gap 占比高、加大 batch 后 GPU 段变长 gap 占比降(画两条对比时间线);两种缩小办法:减少 launch 次数(CUDA graphs、`torch.compile` 的 fusion)/ 让每次 launch 干更多活(batching);和 Day 1 三分法接上;截图要看哪里(文字描述 + TODO)。 |
| 12 | day-12-week2-review | Day 12 · W2 复习:理论 vs 实测对比报告、五道验收题、错题本 | memory | 一页对比报告模板(理论下限、实测 TPOT、比值、top 5 kernel、gap 占比);路线图 W2 五道验收题逐题答;错题本(计时不 sync、把 util 100% 当算力满、bf16 在 T4 报错等);W3 预告(戳破标称值)。 |

### W3(Day 13–18)· 戳破标称值:测出自己这张卡的真实屋顶

| Day | slug | 标题 | regime | 内容要点 |
| --- | --- | --- | --- | --- |
| 13 | day-13-measure-bandwidth | Day 13 · 实测显存带宽:一次 copy 能搬多快 | memory | 为什么标称 320 GB/s 永远达不到;测法:大张量 `y = x + 1` 或 `x.clone()`,字节数 = 读 + 写,除以 sync 后的时间;张量大小要远大于 L2(T4 4 MB、A100 40 MB);预期区间 75–90%;不同 dtype 结果一样(带宽按字节);记录表留空;画「HBM → L2 → SM」带宽层次图。 |
| 14 | day-14-measure-peak-flops | Day 14 · 实测峰值算力:大方阵 matmul 能打到几成 | compute | FLOPs = 2MNK;矩阵多大才打满(T4 建议 4096–8192);fp16 走 tensor core 才对得上 65 TFLOPS,fp32 是 8.1 另一个数;`torch.backends.cuda.matmul.allow_tf32`;A100 的 dense 312 vs sparse 624 标称陷阱;预期 70–90%;记录表留空;画「N 从 256 到 8192 时算力爬升曲线」示意。 |
| 15 | day-15-draw-your-roofline | Day 15 · 用实测值画自己的 roofline,算实测 ridge point | memory | 用 Day 13/14 实测值替换标称值;matplotlib 完整代码(log-log 轴、两条线、标注点);实测 ridge = 实测算力 ÷ 实测带宽;把 Day 9 的 TPOT 换算成实际达到的算力和算术强度标上去;为什么用实测屋顶做判断而不是标称。 |
| 16 | day-16-batch-sweep | Day 16 · batch 从 1 扫到 128:吞吐曲线在哪里离开斜线 | memory | 扫 1/4/16/64/128 的代码(同 prompt 复制、pad 一致、只测 decode 段);吞吐 = batch ÷ 每步时间;曲线预期形状(近线性爬升→压平);转折点可能远早于 ridge 的三个原因(显存装不下、kernel 效率、attention 项随 batch×序列涨);这是对 W1「batch ≈ 153」预测的检验;T4 上 TinyLlama 的 ridge 203 换算;记录表留空。 |
| 17 | day-17-nominal-vs-measured | Day 17 · 标称 vs 实测:哪些 kernel 能打到屋顶,哪些永远打不到 | compute | 对比表:标称/实测/百分比/原因(时钟降频、功耗墙、tile 利用率、数据搬运不完全重叠);MFU 的定义与训练界常见 40–60%;能打满的 = 大 GEMM;永远打不到的 = elementwise、softmax、layernorm、embedding(算术强度 <1–2);为什么 fusion 是 M5 的主题;画「不同 op 落在 roofline 上的位置」图。 |
| 18 | day-18-week3-review | Day 18 · W3 复习:自己的 roofline、五道验收题、错题本 | memory | 一页笔记(实测流程、公式、预期区间);路线图 W3 五道验收题;错题本(矩阵太小、fp32 对 fp16 标称、字节只算读没算写、没 sync);W4 预告(环境工程化)。 |

### W4(Day 19–24)· 环境工程化:一条命令起环境,跑完自己消失

| Day | slug | 标题 | regime | 内容要点 |
| --- | --- | --- | --- | --- |
| 19 | day-19-runpod-vast-first-instance | Day 19 · 第一次租 GPU:RunPod / Vast 开 spot 实例,SSH 进去看 nvidia-smi | none | 两家对比(界面、计费粒度、spot 叫法:RunPod Spot vs Vast interruptible);只充 $10–20 不绑自动续费;选卡表(RTX 4090 24 GB / A100 40·80 GB / L4 / H100)大致小时价区间与出处;spot vs on-demand 差价与抢占风险;镜像选 PyTorch 官方;SSH key、端口;`nvidia-smi` 各列怎么读(画一张注释图);第一次进去就要做的三件事;**成本纪律**。 |
| 20 | day-20-persistence | Day 20 · 实例销毁后什么会丢:代码、数据、模型权重各放哪 | none | 容器盘 vs network volume vs 对象存储;network volume 关机仍计费(给价格出处)算值不值;代码进 git、数据每次重下(HF cache `HF_HOME`)、结果推到 git 或 rclone 到对象存储;7B 权重 13.5 GB 重下要多久(带宽算式);决策树图。 |
| 21 | day-21-bootstrap-script | Day 21 · bootstrap 脚本:从零到能跑代码 5 分钟 | none | 完整 `bootstrap.sh`(apt 最小依赖、uv/pip 装 torch 与 transformers 固定版本、拉代码、写 HF token 到环境变量、预热模型下载、打印 nvidia-smi);幂等;用 `time` 计每一步耗时找最慢一步;Docker 自定义镜像 vs 启动脚本取舍;流程图。 |
| 22 | day-22-three-layer-auto-shutdown | Day 22 · 三层自动销毁:脚本末尾关机、空闲检测、余额上限 | none | 三层分别防哪种失败(正常收尾 / 中途走开 / 前两层失效);实现:① `trap` + 云厂商 CLI/API 销毁(runpodctl / vastai CLI 示例);② cron 每 5 分钟读 `nvidia-smi --query-gpu=utilization.gpu`,低于阈值 N 分钟就销毁,并推送通知(和 CF Worker 推送同一模式);③ 账户余额上限与告警;**验收:故意跑完一个任务,看实例自己消失**;时序图。 |
| 23 | day-23-cost-dashboard | Day 23 · 成本看板:每次实验的 GPU 时长和花费一眼可查 | none | 记录格式(CSV:日期、实验名、卡型、小时价、时长、花费、结论一行);启动/销毁脚本自动追加;一段 Python 汇总本月;$/实验、$/1M token 换算(用 Day 9 的 tok/s 算);月预算 30–60 美元怎么分;示例表用「示例数据」标注。 |
| 24 | day-24-week4-review | Day 24 · W4 复习:一条命令起环境的完整清单、五道验收题、错题本 | none | 环境 checklist;路线图 W4 五道验收题;错题本(volume 计费、忘关机、脚本不幂等、token 泄漏进 git);M1 加餐周预告。 |

### M1 加餐周(Day 25–30)· 补硬件与数值地基,M1 收口

| Day | slug | 标题 | regime | 内容要点 |
| --- | --- | --- | --- | --- |
| 25 | day-25-gpu-anatomy | Day 25 · GPU 解剖:SM、tensor core、寄存器/shared/L2/HBM 到底是什么 | none | SM 是什么、A100 108 个 / T4 40 个;CUDA core vs tensor core(tensor core 做小块矩阵乘,fp16 才有峰值);存储层次和各层带宽量级(寄存器 > shared/L1 > L2 > HBM > PCIe);A100/T4/H100 规格对比表;画层次图;把 Day 5 的 roofline 和 Day 13 的带宽接上。 |
| 26 | day-26-number-formats | Day 26 · 数值格式:fp32/tf32/fp16/bf16/fp8/int8/int4 各占几位、差在哪 | memory | 符号/指数/尾数位分配图;范围 vs 精度;fp16 溢出、bf16 范围同 fp32;T4 不支持 bf16、A100 起支持、H100 加 fp8;int8/int4 量化 = 省字节 = decode 提速(用 Day 5 的带宽算式重算 13.5→6.7→3.4 GB);精度损失怎么衡量(为 M2 W7 铺路)。 |
| 27 | day-27-cuda-execution-model | Day 27 · CUDA 执行模型:kernel、grid、block、warp、stream 与 launch 开销 | none | 一个 kernel 怎么被切成 grid/block/thread,warp 32 线程同步执行;stream 是有序队列,默认 stream;launch 开销数量级;为什么 decode 一步几十个小 kernel 会 overhead-bound(接 Day 11);CUDA graph 做什么;为 M5 Triton 铺路(Triton 隐藏 thread 层只写 block);画 grid/block 图和 stream 时间线。 |
| 28 | day-28-reading-spec-sheets | Day 28 · 怎么读一张 GPU 规格表:dense 与 sparse、SXM 与 PCIe、NVLink 与 $/token | compute | A100 312 dense vs 624 sparse 陷阱;SXM 2039 vs PCIe 1935 GB/s;TDP;NVLink 600 GB/s vs PCIe 4.0 x16 64 GB/s(为 M9 铺路);FP8/FP4 标称怎么比;从小时价算 $/1M token(用 Day 5 150 tok/s 和 Day 9 的 T4 数);规格表阅读 checklist。 |
| 29 | day-29-market-check | Day 29 · 2026-09 市场校准:JD 里要什么,路线图哪里要加勾 | none | 样本来源(猎聘推理优化榜单 39 条、牛客 JD、清昴简章、博客园四象限文章、Baseten JD);JD 高频要求表(vLLM/SGLang/TensorRT-LLM、CUDA/C++、量化、TP/PP、K8s);由此在路线图加的 6 个勾(W5+ GQA/MoE、W7+ spec decoding、W10+ SGLang、W13+ 2 卡 TP、W20+ 裸 CUDA、W42+ K8s);薪资快照(国内 3–5 年 30–60k·15;海外 $165–330K 多限美加,contractor 40–70%);正视四条(30–35 红线、别冲算子岗、学历、海外地域);不要乐观化「远程不难」。**数字口径与 Day 0 一致**。 |
| 30 | day-30-month1-review | Day 30 · M1 总复习:一页笔记、20 道全月自测、错题本汇总与 M2 预告 | memory | M1 四周各自的一页笔记压成一页;全月 20 道自测(覆盖 W1 算账、W2 计时与 profiler、W3 实测屋顶、W4 环境、加餐周硬件与数值);错题本汇总按「形状/单位/异步/标称」分类;M2 预告(W5 KV cache 开关实测、W5+ GQA/MoE、W6 continuous batching、W7 量化、W8 第一篇公开技术帖)。 |

## 5. 完成后自检清单(每篇)

- [ ] frontmatter 七个字段齐全,`day`、`pubDate`、`title` 与规划表一致。
- [ ] 七个骨架章节齐全、顺序正确;明天预告与下一天标题一致。
- [ ] 2–4 张 SVG 图,只用 token 颜色;1–2 个视频,ID 已 curl 验证,figcaption 写了验证到的标题。
- [ ] 所有 URL 已 curl 通过;实测类数字全部标为「预期」并给依据;有留空记录表。
- [ ] 纯汉字数 4,500–6,500(复习日可到 9,000)(`cat file | tr -cd '一-鿿' | wc -m` 或 python 统计)。
- [ ] `cd ~/Documents/blog && source ~/.nvm/nvm.sh && nvm use && npx astro check` 不必跑;只需保证 markdown 里 HTML 块前后有空行、`<details>` 内前后有空行。
