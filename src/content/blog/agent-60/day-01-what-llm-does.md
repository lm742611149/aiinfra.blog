---
title: 'Day 1 · 大模型到底在干什么：token、上下文窗口、下一个词预测'
description: '不讲数学，只讲做 Agent 必须有的模型直觉：模型一次只猜一个 token，它看到的世界只有上下文窗口里那一段，temperature 决定它敢不敢猜冷门答案。幻觉、中文更贵、聊久了忘事，都能从这三件事推出来。'
pubDate: 2026-10-12
regime: none
tags: ['llm-basics', 'tokenizer', 'sampling', 'agent-60']
series: 'agent-60'
day: 1
lang: 'zh'
---

## 今天要解决的问题

做 Agent 不需要会训练模型，但你得知道模型是怎么「想」的，不然很多现象解释不了：为什么同一个问题问两遍答案不一样；为什么让它算 37 × 89 偶尔会错；为什么给它一份 200 页的文档它会漏掉中间的内容；为什么中文提示词比英文贵。

今天结束时你应该能：

1. 说清楚「下一个 token 预测」和「自回归生成」是什么意思，并用它解释幻觉。
2. 知道 token 是什么，能用代码数出一段中文和一段英文各是多少 token。
3. 知道上下文窗口是什么，以及「窗口有 1M」不等于「1M 都能用好」。
4. 知道 temperature 和 top_p 调的是什么，Agent 场景下一般怎么设。
5. 知道「推理模型 / 思考模式」和普通模式的区别，以及什么时候该开。

预计用时：3 到 4 小时，其中视频大约 1.5 小时。前置：Day 0 的环境已经跑通。

## 模型只做一件事：猜下一个 token

把大模型想成一个巨大的函数。输入是一串 token，输出是「下一个 token 是词表里每一个词的概率」。比如输入「北京是中国的」，它输出的概率分布里，「首」可能是 0.92，「政」0.03，「一」0.01……一共十几万个候选，每个都有一个概率。

然后程序从这个分布里挑一个 token 出来（怎么挑后面讲），比如挑了「首」。把「首」接到输入后面，变成「北京是中国的首」，再喂进去，得到下一个分布，挑出「都」。如此循环，直到挑出一个特殊的「结束」token，或者达到你设的最大长度。

这就叫**自回归生成**：每一步都把自己上一步的输出当作下一步的输入。ChatGPT 打字一个一个往外蹦，不是故意做的动画效果，它就是这么一个一个算出来的。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="自回归生成：每一步把输出接回输入，再预测下一个 token">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="34" fill="var(--ink-faint)">第 1 步</text>
<rect x="80" y="18" width="200" height="26" rx="4" fill="none" stroke="var(--rule)"/>
<text x="90" y="36" fill="var(--ink)">北京 是 中国 的</text>
<rect x="320" y="18" width="80" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="360" y="36" text-anchor="middle" fill="var(--ink)">模型</text>
<text x="420" y="36" fill="var(--ink-soft)">首 0.92 / 政 0.03 / …</text>
<text x="20" y="94" fill="var(--ink-faint)">第 2 步</text>
<rect x="80" y="78" width="200" height="26" rx="4" fill="none" stroke="var(--rule)"/>
<text x="90" y="96" fill="var(--ink)">北京 是 中国 的 </text>
<text x="228" y="96" fill="var(--compute)">首</text>
<rect x="320" y="78" width="80" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="360" y="96" text-anchor="middle" fill="var(--ink)">模型</text>
<text x="420" y="96" fill="var(--ink-soft)">都 0.98 / 府 0.01 / …</text>
<text x="20" y="154" fill="var(--ink-faint)">第 3 步</text>
<rect x="80" y="138" width="200" height="26" rx="4" fill="none" stroke="var(--rule)"/>
<text x="90" y="156" fill="var(--ink)">北京 是 中国 的 首 </text>
<text x="252" y="156" fill="var(--compute)">都</text>
<rect x="320" y="138" width="80" height="26" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="360" y="156" text-anchor="middle" fill="var(--ink)">模型</text>
<text x="420" y="156" fill="var(--ink-soft)">。 0.71 / ， 0.20 / …</text>
<line x1="280" y1="31" x2="320" y2="31" stroke="var(--ink-soft)"/>
<line x1="280" y1="91" x2="320" y2="91" stroke="var(--ink-soft)"/>
<line x1="280" y1="151" x2="320" y2="151" stroke="var(--ink-soft)"/>
<text x="20" y="205" fill="var(--ink-faint)">琥珀色 = 上一步挑出来的 token，接回输入末尾。概率数字是示意，不是实测。</text>
</g>
</svg>
<figcaption>自回归生成的三步。模型本身没有「记住刚才说了什么」的能力，它能接着说下去，只是因为你每一步都把完整的前文重新喂给了它。</figcaption>
</figure>

### 用这件事解释幻觉

模型在训练时学到的是「什么样的文字在什么样的上下文后面出现得多」。它没有一个「事实数据库」可以查，也没有「我不确定」这个内置开关。你问它「云簿 CloudLedger 公司的退款政策是什么」，这家公司是我们虚构的，它从没见过。但「XX 公司的退款政策是」后面接「自购买之日起 30 天内可申请全额退款」，在训练数据里是非常常见的文字模式。于是它就很流畅地编了一段。

这就是幻觉的本质：**生成流畅的文字和说出真实的事实是两件事，模型只被训练成擅长前一件**。后来的指令微调和 RLHF 让它学会了在一些情况下说「我不知道」，但这个能力不可靠。

对 Agent 工程师来说，结论很直接：凡是需要事实的地方，都不要指望模型自己知道，要通过工具或检索把事实送到它眼前（W2 和 W3 的全部内容）。然后还要让它引用出处，方便检查。

### 为什么它算术会错

37 × 89 = 3293。模型算这个不是在做乘法，是在「猜下一个 token」。如果「3293」在它的词表里被切成「329」「3」两个 token，它要先猜对「329」再猜对「3」。常见的小乘法它见得多，猜得准；大一点的数就开始不靠谱。现在的模型在这方面已经好了很多，特别是开了思考模式之后，但原理没变。

所以 Agent 里遇到计算，正确做法是给它一个计算器工具，或者让它写代码去算。Day 14 的小项目里就有一个计算器工具。

## Token：模型看到的不是字，是 token

模型不直接处理汉字或字母，处理的是 token。一个 token 可能是一个英文单词、半个单词、一个汉字、半个汉字，甚至几个汉字的组合，取决于这个模型的**分词器（tokenizer）**。

分词器是怎么来的？最常见的方法叫 BPE（Byte Pair Encoding）。简单说：一开始把所有文字拆成最小的字节，然后统计训练语料里哪两个相邻片段一起出现得最多，就把它们合并成一个新 token，加进词表。重复几万到十几万次，词表就建好了。常见的组合（比如英文的 "ing"、" the"，中文的「的」「我们」）会变成单个 token，罕见的组合就被拆成好几个。

这带来几个直接影响 Agent 工程的后果。

**中文通常比英文贵。** DeepSeek 官方文档给的经验比例是：1 个英文字符约 0.3 个 token，1 个中文字符约 0.6 个 token。同样的意思，英文一个单词平均五六个字母，大约 1.5 到 2 个 token；中文表达同样的意思可能要三四个字，2 到 2.5 个 token。不同模型差别很大，国产模型的分词器对中文优化得更好，有些海外模型的中文会切得更碎。计费按 token 算，所以这直接影响成本。

**数字和代码会被切得很碎。** 订单号 `INV-2026-004417` 可能变成七八个 token。这也是模型偶尔会把长编号抄错一位的原因之一。Agent 里涉及编号的地方，尽量让工具返回原样，不要让模型「转述」。

**字母级的任务对模型很别扭。** 经典的例子是问「strawberry 里有几个 r」。模型看到的可能是 "str" "aw" "berry" 三个 token，它看不到单个字母。

<figure>
<svg viewBox="0 0 640 190" role="img" aria-label="同一句话被切成 token 的示意">
<rect x="0" y="0" width="640" height="190" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink-faint)">原文：我的发票 INV-2026-004417 被重复扣款了</text>
<text x="20" y="62" fill="var(--ink-soft)">切分示意：</text>
<rect x="20" y="74" width="40" height="26" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="40" y="92" text-anchor="middle" fill="var(--ink)">我的</text>
<rect x="64" y="74" width="40" height="26" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="84" y="92" text-anchor="middle" fill="var(--ink)">发票</text>
<rect x="108" y="74" width="40" height="26" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="128" y="92" text-anchor="middle" fill="var(--ink)"> INV</text>
<rect x="152" y="74" width="22" height="26" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="163" y="92" text-anchor="middle" fill="var(--ink)">-</text>
<rect x="178" y="74" width="46" height="26" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="201" y="92" text-anchor="middle" fill="var(--ink)">2026</text>
<rect x="228" y="74" width="22" height="26" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="239" y="92" text-anchor="middle" fill="var(--ink)">-</text>
<rect x="254" y="74" width="40" height="26" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="274" y="92" text-anchor="middle" fill="var(--ink)">004</text>
<rect x="298" y="74" width="40" height="26" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="318" y="92" text-anchor="middle" fill="var(--ink)">417</text>
<rect x="342" y="74" width="28" height="26" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="356" y="92" text-anchor="middle" fill="var(--ink)">被</text>
<rect x="374" y="74" width="40" height="26" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="394" y="92" text-anchor="middle" fill="var(--ink)">重复</text>
<rect x="418" y="74" width="28" height="26" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="432" y="92" text-anchor="middle" fill="var(--ink)">扣</text>
<rect x="450" y="74" width="28" height="26" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="464" y="92" text-anchor="middle" fill="var(--ink)">款</text>
<rect x="482" y="74" width="28" height="26" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="496" y="92" text-anchor="middle" fill="var(--ink)">了</text>
<text x="20" y="130" fill="var(--ink-soft)">蓝 = 文字 token　琥珀 = 编号被切成 6 段</text>
<text x="20" y="156" fill="var(--ink-faint)">这只是示意，真实切法因模型而异。用今天练习里的代码或</text>
<text x="20" y="174" fill="var(--ink-faint)">tiktokenizer 网站看你用的模型实际怎么切。</text>
</g>
</svg>
<figcaption>一句工单文本的 token 切分示意。中文常用词往往是一个 token，编号被切成很多段。模型对这种被切碎的字符串最容易出错。</figcaption>
</figure>

## 上下文窗口：模型能看到的全部世界

模型每次调用能接收的 token 总数是有上限的，叫**上下文窗口**（context window）。输入加输出都要算在里面。2026 年主流模型的窗口普遍很大：DeepSeek 的 `deepseek-flash` 官方写的是 1M（一百万）token，Claude 的当前模型也是 1M。

这里有两个重要事实，比数字本身更重要。

**第一，模型没有记忆，窗口就是全部。** API 是无状态的。你和它聊了二十轮，第二十一轮它之所以「记得」前面的内容，是因为你的程序把前二十轮对话全部重新发了一遍。窗口外的东西，对模型来说就是不存在。Day 4 会写代码亲手管理这件事。

**第二，窗口大不等于都能用好。** 大量测试发现，塞进去的内容越多，模型对中间部分的注意力越容易下降，业内叫「lost in the middle」，最近也有人叫「上下文腐烂」（context rot）。而且塞得越多，每次调用越贵、越慢。一个 Agent 跑了 30 步，每步都把前面所有工具结果带上，窗口很快就被垃圾填满。所以上下文窗口要当作稀缺资源来管理，这就是 Day 20 要讲的「上下文工程」。

算一笔账感受一下：一个客服 Agent 每处理一张工单要调用模型 8 次，平均每次输入 6,000 token。用 `deepseek-flash` 高峰价（输入 2 元 / 百万 token），一张工单输入部分是 8 × 6,000 × 2 ÷ 1,000,000 ≈ 0.1 元。一天一万张工单就是一千元。如果你偷懒把整个知识库都塞进去，每次 10 万 token，那就是十几倍。

## 采样：temperature 和 top_p

模型给的是概率分布，最后输出哪个 token 由「采样」决定。

**temperature（温度）** 控制分布的「尖锐程度」。temperature 低，高概率的 token 更占优势，输出更确定、更保守；temperature 高，分布被拉平，冷门 token 被选中的机会变大，输出更多样，也更容易跑偏。temperature = 0 时（或接近 0）基本就是每次都选概率最高的那个。

**top_p** 是另一种截断方式：只在累计概率达到 p 的那些候选里采样。比如 top_p = 0.9，就是把概率从高到低排，加到 90% 为止，剩下的长尾候选直接不考虑。

Agent 场景下的经验：需要稳定、可复现的步骤（分类、抽取字段、决定调哪个工具），temperature 设低，0 到 0.3；需要创意的（起草营销文案）可以高一点。一般只调 temperature，不同时调 top_p。另外要知道：**temperature = 0 也不保证每次输出完全一样**，服务端的批处理、浮点运算顺序都可能带来微小差异。不要把系统正确性建立在「每次输出一字不差」上。

还有一点：开了思考模式的推理模型，很多厂商会限制或忽略 temperature 参数。用之前看文档。

## 模型是怎么训出来的（一句话版）

你只需要知道三个阶段的大意，面试偶尔会问：

- **预训练**：用海量互联网文本训练「猜下一个 token」。得到的是一个「文本续写器」，你给它一个问题，它可能接着写出更多问题，因为网上很多文本就是问题列表。
- **指令微调（SFT）**：用大量「指令 - 好回答」的对话样本继续训练，让它学会「你问我答」的格式。
- **人类反馈强化学习（RLHF）及其变体**：让人（或别的模型）对回答打分，训练它倾向于给出被打高分的回答。拒绝有害请求、承认不知道，都是这个阶段加强的。

后来又多了一类：用强化学习专门训练模型在回答前先「思考」，就是推理模型。

## 推理模型和思考模式

2025 年以后，主流模型基本都有「思考」能力：回答之前先生成一段很长的推理过程，再给最终答案。DeepSeek 2026 年的模型是默认开启思考模式的，思考内容在返回的 `reasoning_content` 字段里，和最终回答 `content` 分开；Claude 当前的模型叫自适应思考，由 effort 参数控制想多少。

对 Agent 工程师，思考模式是个成本和效果的权衡：

- 开：复杂多步任务、需要规划、需要算数和推理的场景，准确率明显更高。
- 关：简单分类、抽取、闲聊，开了只是更慢更贵（思考的 token 也按输出计费）。

这门课 W1 的练习默认关掉思考模式，让你更快看到结果、更省钱。W2 开始做 Agent 时会再讨论什么时候打开。顺便提前说一个坑：DeepSeek 文档要求，带了 `tools` 参数的对话里，历史轮次的 `reasoning_content` 必须完整回传，否则会报 400。Day 8 会遇到。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV16cNEeXEer&autoplay=0&high_quality=1" title="安德烈·卡帕西：深入探索像ChatGPT这样的大语言模型" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>KrillinAI俊希（搬运）· 【1080P】安德烈·卡帕西：深入探索像ChatGPT这样的大语言模型｜Andrej Karpathy · 3.5 小时，今天必看前 1 小时（预训练、token、推理过程），后面讲 SFT、RLHF、幻觉和工具使用的部分有空再看，对理解 Agent 很有帮助。</figcaption>
</figure>


## 补充:哪些模型能本地部署?自己训一个要做什么?

能下载到自己机器上跑的叫「开放权重」(open-weight)模型。截至 2026 年年中的主流系列:

| 系列 | 厂商 | 特点 |
| --- | --- | --- |
| Qwen(通义千问) | 阿里 | 尺寸最全(零点几 B 到几百 B),中文强,社区最常用 |
| DeepSeek | 深度求索 | 旗舰是几百 B 的 MoE,效果接近闭源一线,完整版要多卡服务器 |
| GLM | 智谱 | 中文好,有 Agent / 代码方向的版本 |
| Kimi K2 | 月之暗面 | 万亿参数级 MoE,擅长 Agent 和工具调用 |
| Llama | Meta | 开源生态的老大哥,英文为主 |
| Gemma | Google | 小尺寸做得好,适合笔记本和手机 |
| Mistral | Mistral AI | 中小尺寸,许可宽松 |
| gpt-oss | OpenAI | 2025 年发布的开放权重模型,20B / 120B 两档 |
| Phi | 微软 | 小参数做推理 |

**用什么跑:** 个人电脑用 Ollama(一条命令下载并运行)、LM Studio(图形界面)、llama.cpp(底层引擎,CPU 也能跑)、MLX(Apple Silicon 专用);服务器用 vLLM、SGLang(生产主流,吞吐高)。

**要多大内存(粗算):** 4-bit 量化 ≈ 参数量(B)× 0.6 GB,7B 约 4–5 GB、32B 约 20 GB;不量化(FP16)≈ 参数量 × 2 GB;另加 KV cache,上下文越长越多。没有独立显卡的 Intel 笔记本只能用 CPU 跑 1–4B 的小模型,每秒几个 token;16 GB 内存的 M 芯片 Mac 能流畅跑 7–8B。

**举例:32 GB 内存的 Mac mini 能跑多大?** macOS 默认只让 GPU 用约 2/3–3/4 的统一内存,32 GB 机器大约 21–24 GB 可用。4-bit 量化下 7–8B(约 5 GB)很轻松;14B(约 9 GB)最舒服;32B(约 19–20 GB)能跑但紧,上下文不能开太长;70B(40 GB 以上)跑不了。速度上限 ≈ 内存带宽 ÷ 每个 token 要读的模型大小:普通 M4(约 120 GB/s)跑 32B 理论上每秒约 6 个 token,M4 Pro(约 273 GB/s)约 14 个。最划算的是 30B 左右的 MoE 模型(如 Qwen3-30B-A3B、gpt-oss-20b):总参数大,但每个 token 只激活约 3B,速度接近 3B 模型,效果接近 30B。所以同样 32 GB,选机器要看内存带宽,它决定生成速度。

**开发板能跑吗?** 国内常见的是 RK3588 开发板(香橙派 5 系列等):芯片自带 6 TOPS 的 NPU,用瑞芯微官方的 RKLLM 工具链把 Qwen 这类小模型转换后放到 NPU 上跑。1.5B–3B 比较流畅,7B 能跑但慢(社区实测大致 1.5B 每秒十几个 token、7B 每秒几个)。瓶颈是内存带宽而不是 NPU 算力:每生成一个 token 都要把整个模型从内存读一遍。适合离线语音助手、机器人这类边缘场景,或者学嵌入式部署。ESP32 这类单片机只有几 MB 内存,只能跑几十万参数的玩具模型,实际用法是收音、联网后转发给云端模型。

**本地跑和用厂商服务有什么区别?** 能力上,个人电脑一般只能跑 7–32B,比厂商的旗舰模型弱一档,更容易胡编;隐私上,数据不出本机,适合公司代码、合同这类敏感内容;成本上,硬件一次投入、之后只有电费,不按 token 付费;网络上,断网也能用,不受限流和宕机影响;维护上,下载、升级、调参都得自己来。

**本地跑是不是没有限制?** 不是。厂商服务的限制大致三层:①**模型自身的训练**,后训练阶段学会的拒绝行为写在权重里,下载到本地照样拒绝,国内模型训练时按国内内容要求做的对齐也一样还在;②**服务端审核**,厂商在模型前后加的内容过滤和系统提示词,本地没有了;③**账号和条款**,违规会被封号、请求会被记录,本地也没有了。所以本地跑只是少了外面两层。社区里有去掉拒绝行为的改版模型,但质量通常下降。另外开源许可证本身有使用限制(比如 Llama 的可接受使用政策),用模型做了什么,法律责任始终在使用者自己。对 Agent 工程师来说,本地模型的价值主要是隐私和省钱,不是「没限制」。

**自己从零训一个大模型**,就是把上面「三个阶段」真做一遍,再加前后两头:

1. **数据**:抓海量文本(网页、书、代码、论文),清洗、去重、过滤,定好各类数据配比。最费人力,也最决定效果。
2. **分词器**:用自己的数据训 BPE 词表。
3. **结构**:基本都是 decoder-only Transformer,定层数、宽度、注意力头数、要不要 MoE、上下文多长。
4. **预训练**:几千张 GPU 训几周到几个月。工程难点是分布式并行(数据 / 张量 / 流水线)、断点恢复、loss 突刺。
5. **后训练**:SFT → 偏好对齐(RLHF / DPO)→ 可验证奖励的强化学习(数学、代码,推理模型靠这一步)。
6. **评测**:公开基准 + 自建评测集 + 安全红队。
7. **推理部署**:量化、推理引擎、上线。

**成本粗算:** 训练算力 ≈ 6 × 参数量 × 训练 token 数。7B 模型训 2T token ≈ 8×10²² FLOPs,按 H100 跑到峰值 40% 左右算约 6 万 GPU 小时,光算力十几万美元,还不算人力和失败重来。一线水平的大模型是几千万到上亿美元。

**个人可行的两条路:** 想学懂原理,跑 Karpathy 的 [nanoGPT](https://github.com/karpathy/nanoGPT) / [nanochat](https://github.com/karpathy/nanochat),租几小时 GPU,把上面 1–6 步走一遍迷你版;想做出有用的东西,在 Qwen 这类开源模型上做 LoRA 微调(Unsloth、LLaMA-Factory),几千条领域数据、一张卡几小时就够。对 Agent 工程师来说,从零预训练基本用不上;会本地部署、会 LoRA 微调是加分项,Day 101 会把微调小模型接进网关做级联路由。

## 动手练习

今天写三个小脚本，都放在 `agent-60-lab/w1/` 下。

**练习 1：数 token。** 不同模型分词器不同，最可靠的办法是直接看 API 返回的 `usage`。

```python
# agent-60-lab/w1/count_tokens.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]

SAMPLES = {
    "中文": "我的发票被重复扣款了，请帮我查一下是怎么回事，谢谢。",
    "英文": "I was charged twice for my invoice. Could you check what happened? Thanks.",
    "编号": "INV-2026-004417 INV-2026-004418 INV-2026-004419",
}


def prompt_tokens(text: str) -> int:
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": text}],
        max_tokens=1,  # 只关心输入算了多少 token，输出 1 个就停
        extra_body={"thinking": {"type": "disabled"}},  # 非 DeepSeek 删掉这行
    )
    assert resp.usage is not None  # SDK 把 usage 标成「可能为空」，先断言一下，编辑器就不报红线了
    return resp.usage.prompt_tokens


baseline = prompt_tokens("a")  # 消息格式本身也占 token，先测一个空壳的开销
for name, text in SAMPLES.items():
    n = prompt_tokens(text) - baseline + 1
    print(f"{name}: {len(text)} 个字符 ≈ {n} 个 token，每字符 {n / len(text):.2f}")
```

```bash
cd agent-60-lab && uv run w1/count_tokens.py
```

如果你用 Zed、VS Code 这类带类型检查的编辑器，没有 `assert` 那行的话，`prompt_tokens` 下面会出现红色波浪线，提示 `"prompt_tokens" is not a known attribute of "None"`。原因是 openai SDK 把 `usage` 的类型写成了 `CompletionUsage | None`：协议允许服务端不返回用量，所以类型检查器要求你先排除 None。这只是静态检查的提示，不加 `assert` 照样能跑。加上它，一是消掉红线，二是万一真没返回用量，会在这一行直接报错，而不是在后面报一个看不懂的 `AttributeError`。后面的课凡是读 `resp.usage` 的地方，都是一样的道理。

输出是三行，每行给出字符数、估算的 token 数和比例。把结果和 DeepSeek 文档的 0.3 / 0.6 对照一下。如果你手上还有别家的 key，换一下 `.env` 再跑一遍，比较两家分词器的差别。

想直观看切分结果，可以打开 [tiktokenizer](https://tiktokenizer.vercel.app/)，选一个模型，把上面的三段文字贴进去，每个 token 会用不同颜色标出来。注意它展示的是 OpenAI 系等模型的分词器，不是 DeepSeek 的，看个大意就行。

**练习 2：temperature 实验。**

```python
# agent-60-lab/w1/temperature.py
import os
from collections import Counter

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

PROMPT = "给一家在线记账软件公司起一个中文名字，只输出名字本身，不要解释。"

for t in (0.0, 1.0, 1.5):
    names = []
    for _ in range(8):
        resp = client.chat.completions.create(
            model=os.environ["LLM_MODEL"],
            messages=[{"role": "user", "content": PROMPT}],
            temperature=t,
            max_tokens=20,
            extra_body={"thinking": {"type": "disabled"}},
        )
        names.append(resp.choices[0].message.content.strip())
    print(f"temperature={t}: {len(set(names))} 种不同答案 -> {Counter(names).most_common(3)}")
```

跑完你会看到：temperature 越高，8 次里出现的不同名字越多。temperature = 0 时多数情况下是同一个名字，偶尔会有一两个不同，这正好印证了上面说的「0 也不保证完全一样」。把观察记下来。

**练习 3：制造一次幻觉。** 问模型一个它不可能知道的问题，看它怎么答：

```python
# agent-60-lab/w1/hallucination.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

QUESTIONS = [
    "云簿 CloudLedger 公司的退款政策是什么？",
    "云簿 CloudLedger 公司的退款政策是什么？如果你不确定，直接说不知道，不要猜。",
]
for q in QUESTIONS:
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "user", "content": q}],
        temperature=0,
        extra_body={"thinking": {"type": "disabled"}},
    )
    print("问：", q)
    print("答：", resp.choices[0].message.content, "\n")
```

比较两个回答。第一个很可能编出一段像模像样的政策，或者给出「一般 SaaS 公司的做法」。第二个加了一句「不确定就说不知道」，多数现代模型会老实承认。这说明提示词能缓解幻觉，但不能根治，后面我们会用 RAG 把真实政策送到它眼前。

**验收标准：** 三个脚本都跑通；能说出你用的模型下中文每字大约多少 token；能用自己的话解释练习 3 里第一个回答为什么会「编」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Token | 模型处理文本的基本单位，可能是一个词、半个词、一个汉字或几个汉字 |
| 分词器（tokenizer） | 把文字切成 token、再把 token 转成编号的程序，每个模型有自己的 |
| BPE | 一种建词表的方法：反复合并语料中最常一起出现的相邻片段 |
| 下一个 token 预测 | 模型的唯一能力：给定前文，输出下一个 token 的概率分布 |
| 自回归生成 | 每生成一个 token 就接回输入，再预测下一个，循环往复 |
| 上下文窗口 | 一次调用里输入加输出能容纳的最大 token 数 |
| 幻觉（hallucination） | 模型生成流畅但不真实的内容 |
| temperature | 采样温度，越高输出越随机多样，越低越确定 |
| top_p | 只在累计概率前 p 的候选 token 中采样 |
| 预训练 / SFT / RLHF | 模型训练的三个阶段：学续写、学对话格式、学人类偏好 |
| 推理模型 / 思考模式 | 回答前先生成一段推理过程的模型或模式，思考 token 也计费 |
| reasoning_content | DeepSeek 返回思考过程的字段，与最终回答 content 分开 |

## 常见误区

**以为模型「知道」事实。** 它只知道什么样的文字常见。需要事实就给它工具或检索结果。

**以为 temperature = 0 就是确定性的。** 多数时候稳定，但不保证一字不差。测试和评测要允许合理的波动。

**按字数估算成本。** 计费按 token，中文、英文、代码、编号的比例都不一样。估算要用 `usage` 字段的真实数字。

**以为窗口越大越好，什么都往里塞。** 塞得越多越贵越慢，模型对中间内容的注意力还会下降。Agent 的上下文要精挑细选。

**所有任务都开思考模式。** 简单分类、抽取开了思考只会更慢更贵。按任务难度决定。

## 学习资料

### 文档与文章

- [DeepSeek：Token 用量计算](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage)：中英文字符和 token 的换算口径。5 分钟。
- [DeepSeek：思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)：怎么开关思考、`reasoning_content` 字段、带工具时要回传思考内容的规则。**必看**，10 分钟。
- [Claude 模型概览](https://platform.claude.com/docs/en/about-claude/models/overview)：看一下国外旗舰模型的上下文窗口、价格和思考模式说明，和 DeepSeek 对照。
- [bbycroft.net/llm](https://bbycroft.net/llm)：一个 3D 可视化网页，能看到一个小 GPT 里数据怎么一层层流过去。不用看懂每个矩阵，感受一下「输入一串 token，输出下一个 token 的概率」这件事。20 分钟。
- [Jay Alammar《The Illustrated GPT-2》](https://jalammar.github.io/illustrated-gpt2/)：图解 GPT-2 怎么一个一个生成 token。只看前半部分。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1tUy3BsEDK&autoplay=0&high_quality=1" title="大语言模型简明解析 - 3Blue1Brown" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI译片君（搬运）· 【中配】大语言模型简明解析 - 3Blue1Brown · 8 分钟，今天第一个看的视频，动画把「预测下一个词」讲得非常直观。</figcaption>
</figure>

- 卡帕西 3.5 小时深度讲解（上面正文里嵌的 BV16cNEeXEer）：今天看前 1 小时。
- 【中英字幕】Andrej Karpathy 一小时大语言模型介绍（BV1kC4y1P7Lt）：2023 年那场经典讲座的中字版，和 YouTube 上的原版是同一个内容，二选一看。
- 台大李宏毅：80 分钟快速了解大语言模型（BV1FM4m1Z7JZ，搬运合集）：李宏毅讲课节奏慢、例子好，适合喜欢中文讲解的人。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zjkBMFhNj_g" title="[1hr Talk] Intro to Large Language Models" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · [1hr Talk] Intro to Large Language Models · 1 小时。前 20 分钟讲模型是什么、怎么训的，后面讲「LLM 操作系统」的类比和安全问题（越狱、prompt injection），W6 讲安全时会回来看后半段。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LPZh9BOjkQs" title="Large Language Models explained briefly" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · Large Language Models explained briefly · 8 分钟，上面 B 站中配版的原版，看过中配就可以跳过。</figcaption>
</figure>

- Andrej Karpathy《Let's build the GPT Tokenizer》（YouTube ID zduSFxRajkE）：2 小时手写 BPE 分词器，想彻底搞懂 token 的人看，不是必需。

### 书籍

- 《图解大模型：生成式 AI 原理与实战》（Jay Alammar、Maarten Grootendorst 著，人民邮电出版社，2025；英文原版《Hands-On Large Language Models》，O'Reilly，2024）：读第 2 章（token 与嵌入）和第 3 章（Transformer 内部）的前半部分，图非常多，2 小时左右。
- 《从零构建大模型》（Sebastian Raschka 著，人民邮电出版社，2025；英文原版《Build a Large Language Model (From Scratch)》，Manning，2024）：读第 2 章「处理文本数据」，讲分词和 BPE。想走得更深的人可以读，这门课不要求。

### 开源项目与代码

- [karpathy/minbpe](https://github.com/karpathy/minbpe)：最小的 BPE 实现，几百行，配合上面的 tokenizer 视频看。
- [openai/tiktoken](https://github.com/openai/tiktoken)：OpenAI 的分词器库，本地数 token 用，W5 统计成本时可能用到。
- [Tokenizer Playground](https://huggingface.co/spaces/Xenova/the-tokenizer-playground)：在线比较多种开源模型分词器的切分结果。

## 自测

1. 用「下一个 token 预测」解释：为什么问模型一家它没听说过的公司的政策，它会编一段出来？

<details><summary>答案</summary>

模型的训练目标是生成在该上下文后面常见的文字。「某公司的退款政策是」后面接一段具体政策条款，在训练文本里非常常见，所以它会按这个模式流畅地续写，而不是去查证事实。它没有内置的事实数据库，也没有可靠的「不确定」机制。

</details>

2. 你和模型聊了 10 轮，第 11 轮它还记得第 1 轮你说的名字。这是因为模型有记忆吗？

<details><summary>答案</summary>

不是。API 是无状态的，你的程序在第 11 次调用时把前 10 轮的全部消息重新发给了模型，名字就在这次的输入里。如果程序只发最后一轮，它就「忘了」。

</details>

3. 一段工单文本 800 个汉字，按 DeepSeek 文档的经验比例大约多少 token？如果一天处理 2 万张这样的工单，只算这段文本的输入，用 deepseek-flash 高峰价多少钱？

<details><summary>答案</summary>

800 × 0.6 ≈ 480 token。2 万张 × 480 = 960 万 token。高峰输入价 2 元 / 百万 token，约 9.6 × 2 = 19.2 元。实际调用还有系统提示词、工具定义、检索结果，会比这个多很多。

</details>

4. 做一个「判断工单属于哪个类别」的步骤，temperature 应该怎么设？为什么？

<details><summary>答案</summary>

设低，0 到 0.3。分类需要稳定可复现，同一张工单不应该今天分到「计费」明天分到「技术」。高 temperature 会增加随机性，没有任何好处。

</details>

5. 面试题：面试官问「上下文窗口已经 1M token 了，为什么还需要 RAG？直接把整个知识库塞进去不行吗？」

<details><summary>答案</summary>

要点：一是成本和延迟，每次调用都带几十万 token，费用和响应时间成倍增加；二是效果，内容越多模型对中间部分的注意力越容易下降（lost in the middle / context rot），塞进去不等于用得好；三是规模和更新，真实知识库往往远超 1M，而且经常变；四是权限，不同用户能看的文档不同，检索时可以按权限过滤。所以更合理的做法是只把相关的少量内容检索出来放进上下文。可以补一句：知识库很小且固定时，直接塞进去配合 prompt caching 确实是可行的简化方案。

</details>

6. 为什么 `strawberry 里有几个 r` 这种问题对模型很难？Agent 里遇到类似的「字符级」任务该怎么办？

<details><summary>答案</summary>

模型看到的是 token 而不是字母，"strawberry" 可能被切成两三个 token，它没有直接看到每个字母。Agent 里遇到字符级、计算类任务，应该交给代码：给一个执行代码或字符串处理的工具，而不是让模型「看」出来。

</details>

## 明天预告

Day 2 · 写给后端工程师的 Python 速成：uv、类型标注、async、pydantic。用你熟悉的 Java、Go 或 JS 做对照，一天把写 Agent 需要的 Python 补上。不学全，只学够用的那一部分：项目怎么建、依赖怎么装、类型怎么标、异步怎么写、数据怎么校验、测试怎么跑。
