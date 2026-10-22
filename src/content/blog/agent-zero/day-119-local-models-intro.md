---
title: 'Day 119 · 哪些模型能本地跑,自己训一个要做什么'
description: '把 2026 年 10 月的开源模型版图过一遍:开放权重到底开放了什么、许可证要看什么、各家现在最新的是哪几个。再写三个十几行的小脚本算账:一个模型占多少内存(4 位量化大约每 1B 参数 0.6 GB,拿 5 个真实文件验证过)、一台 16 GB 的笔记本放得下谁、放下了每秒能出几个字;最后用「6 × 参数 × token」算清从零训一个模型要多少 GPU 小时和钱。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'open-models', 'python', 'agent-zero']
series: 'agent-zero'
day: 119
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 118](/blog/agent-zero/day-118-week17-review/) 是第 17 周复习。那一周分两条线:Day 112–115 讲「模型用起来什么样」(top_p 和种子、训练三阶段、幻觉、思考模式),Day 116–117 第一次打开模型内部(注意力、MoE、KV cache)。复习日的小项目给 Day 113 的玩具模型做了一次体检,用实跑数据回答了 top_p 降不降得了幻觉、种子能不能复现。

到这里,「大模型是什么」这一块就讲完了。明天(Day 120)要正式注册 API、充值、第一次调用。在那之前还有一个问题值得先弄清楚:**模型非得调别人的 API 吗,能不能放在自己电脑上跑?** 这个问题面试会问,做公司项目也会被问(「客户数据不能出内网,能不能自己部署?」)。Day 117 讲的「显存看总参数、速度看激活参数」和「KV cache 每个 token 一百多 KB」,今天正好拿来算账。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清「开源模型」(开放权重)开放的是什么、没开放什么,看到一个模型能找到它的参数量和许可证;说出 2026 年 10 月几家主要厂商最新的开源模型和大致尺寸。
2. 用一个公式估出任意模型 4 位量化后占多少内存(每 1B 参数约 0.6 GB),再加上 KV cache 和余量,判断自己的电脑放不放得下。
3. 用「内存带宽 ÷ 每个 token 要读的字节数」估出生成速度的上限,解释为什么 MoE 模型在笔记本上反而跑得快。
4. 说出从零训一个大模型的七个步骤,用「6 × 参数量 × 训练 token 数」算出要多少 GPU 小时,并说清楚 Agent 工程师在这件事上该学到哪一步。

今天只讲两个新概念:**开放权重模型**(版图和许可证)和**量化后的内存账**(含速度估算)。「从零训练」是用 Day 113 学过的三阶段加一个算式,不算新概念。

预计用时:2 小时左右。今天全是本地小脚本,不调 API,花费 0 元。前置:[Day 113](/blog/agent-zero/day-113-training/) 的三个训练阶段、[Day 117](/blog/agent-zero/day-117-moe-kvcache/) 的总参数/激活参数和 `kv_size.py`、[Day 32](/blog/agent-zero/day-032-modules/) 的 `if __name__ == "__main__"`、[Day 64](/blog/agent-zero/day-064-httpx-1/) 的 httpx(练习 3 用)。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `need_gb` 和 `train_cost` 两个函数默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 「开源模型」到底开放了什么

我们从 Day 106 一直在说的「模型」,落到硬盘上其实就是两样东西:一堆数字,和一段用这些数字做计算的代码。Karpathy 有个很好记的说法:Llama 2 70B 就是两个文件,一个 140 GB 的参数文件,一个几百行的 C 代码文件,拷到一台没联网的 Mac 上照样能跑。140 GB 是怎么来的?700 亿个参数,每个用 2 字节存,70 × 2 = 140。今天后面所有的账,都从这个乘法开始。

厂商把训练好的参数文件公开出来让人下载,这种模型叫**开放权重模型**(open-weight model)。中文圈习惯叫「开源模型」,但这个叫法不太准。前端里说「开源」,比如 React 开源,意思是源代码全在 GitHub 上,你能看到每一行是怎么写的,也能自己从源码构建一份一模一样的出来。大模型的「开源」通常只开放了最终的参数文件和推理代码,**训练数据和训练过程一般不公开**。打个比方,这像是给了你一个打包压缩好的 `bundle.min.js`,能用、能改一点,但你没法从源码重新构建出它,因为源码(数据)和构建脚本(训练流程)都不在你手里。

能下载到的参数文件,一般放在 **Hugging Face** 上。这个网站你可以理解成「模型界的 npm + GitHub」:每个模型一个仓库,地址是 `huggingface.co/厂商/模型名`,里面有参数文件(`.safetensors` 结尾,很多个分片)、配置文件 `config.json`(层数、头数这些,Day 117 算 KV cache 时读过),还有一份说明页(model card)写着参数量、怎么用、许可证。

**许可证**是第一件要看的事,和你在 npm 上挑包要看 MIT 还是 GPL 一个道理。今天查到的大致分三类:

- **Apache-2.0 / MIT**:最宽松,商用、改、再分发都可以。Qwen3.5 全系列、Qwen3.8-27B、Gemma 4、gpt-oss 是 Apache-2.0;DeepSeek V4 系列、GLM-5.3-Flash 是 MIT。
- **厂商自定义许可证**:仓库标签写的是 `license:other`,点进去是厂商自己写的条款。常见的限制是用户量或收入到了一定规模要另外签协议,或者不能用来训练别的模型。Qwen3.8 的 2.4T 超大号和 Flash-Next、Kimi K3、GLM-5.3、MiniMax-M3、Meta 的 Muse Spark Open 都是这一类。
- **不开放**:GPT-5 系列、Claude、Gemini 的旗舰模型,只能调 API。

所以「能下载」不等于「随便用」。做公司项目选模型时,许可证要和法务一起看,这是 Agent 工程师选型清单里的一项。

## 2026 年 10 月的开源模型版图

下面这张表是我 2026 年 10 月 22 日用 Hugging Face 的公开接口(`huggingface.co/api/models/...`,练习 3 会教你自己查)查出来的,参数量是仓库里参数文件的总数,激活参数来自各家说明页。B 是十亿,T 是万亿,「A3B」这种写法是 Day 117 讲的激活 3B。

| 系列 | 厂商 | 2026-10 最新的几个 | 尺寸跨度 | 特点 |
| --- | --- | --- | --- | --- |
| Qwen(通义千问) | 阿里 | Qwen3.8-27B(8 月)、Qwen3.8-Flash-Next(125B 激活 6B)、Qwen3.5 小尺寸(2 月) | 0.8B 到 2.4T | 尺寸最全,中文强,社区下载量最大,本地跑首选 |
| DeepSeek | 深度求索 | V4.1-Flash-1017(10 月 17 日)、V4-Pro-0813 | 主干 284B 到 1.6T | 我们 API 用的就是它;全是大号 MoE,个人电脑跑不动 |
| GLM | 智谱 | GLM-5.3、GLM-5.3-Flash(8 月,320B 激活 18B) | 几百 B | 偏 Agent 和写代码 |
| Kimi | 月之暗面 | Kimi K3(6 月) | 文件里约 2.8T | 超大 MoE,擅长 Agent 和工具调用 |
| MiMo | 小米 | MiMo-V2.6-Pro / Flash(9 月) | Pro 约 1T | 2026 年新冒头的一家,榜单排名靠前 |
| MiniMax | 稀宇科技 | MiniMax-M3(6 月,约 428B 激活 23B) | 几百 B | 1M 上下文,多模态 |
| Gemma | Google | Gemma 4(3–5 月) | E2B、E4B、12B、26B-A4B、31B | 小尺寸做得好,适合笔记本和手机 |
| gpt-oss | OpenAI | gpt-oss-20b、120b(2025 年 8 月) | 20B、117B | 一年多没更新,但 20b 仍是常用的本地模型 |
| Muse Spark Open | Meta | 9–10 月 | 816B 激活 42B | Meta 接替 Llama 的新系列,TechCrunch 引 Engadget 说本地跑要 1 TB 内存 |
| Mistral | Mistral AI | Mistral Medium 3.5(128B,3 月) | 中大尺寸 | 欧洲厂商 |

表要这么读:**大号模型拿来比效果,小号模型拿来本地跑**。榜单上和闭源旗舰掰手腕的都是几百 B 到上万亿参数的 MoE,个人电脑完全装不下;真正能在笔记本上跑的,是 Qwen3.5 的 0.8B–9B、Gemma 4 的 E2B–12B 这一档。

顺便更正一个数。Day 117 用的 DeepSeek-V4-Flash 是 284B 总参数、13B 激活。我今天去看了 `deepseek-flash` 现在背后那个 V4.1-Flash 的说明页,它写的是主干 552B、预填充阶段每 token 激活 8B、解码阶段 16B,结构也改了。Day 117 说「V4.1 的规模官方没单独写」,写那篇时可能还没公布,现在有了。这件事本身也说明了一点:**这张表一个季度就会过时**,学的是怎么查,不是背名字。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="开源模型按尺寸分三档:笔记本能跑、单台工作站能跑、只能上服务器">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<line x1="40" y1="200" x2="610" y2="200" stroke="var(--rule)"/>
<text x="40" y="222" fill="var(--ink-faint)">1B</text>
<text x="210" y="222" fill="var(--ink-faint)">10B</text>
<text x="380" y="222" fill="var(--ink-faint)">100B</text>
<text x="550" y="222" fill="var(--ink-faint)">1T</text>
<text x="400" y="242" fill="var(--ink-faint)">总参数(对数刻度)</text>
<rect x="40" y="40" width="190" height="150" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="50" y="60" fill="var(--compute)">笔记本 8–16 GB</text>
<text x="50" y="84" fill="var(--ink)">Qwen3.5-0.8B / 4B / 9B</text>
<text x="50" y="104" fill="var(--ink)">Gemma 4 E2B / E4B / 12B</text>
<text x="50" y="128" fill="var(--ink-soft)">Q4 约 0.5–7 GB</text>
<text x="50" y="148" fill="var(--ink-soft)">每秒几个到二十几个 token</text>
<rect x="240" y="40" width="160" height="150" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="250" y="60" fill="var(--ink)">32–64 GB 工作站</text>
<text x="250" y="84" fill="var(--ink)">Qwen3.8-27B</text>
<text x="250" y="104" fill="var(--ink)">Qwen3.5-35B-A3B</text>
<text x="250" y="124" fill="var(--ink)">gpt-oss-20b</text>
<text x="250" y="148" fill="var(--ink-soft)">Q4 约 12–22 GB</text>
<rect x="410" y="40" width="200" height="150" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="420" y="60" fill="var(--mem)">多卡服务器</text>
<text x="420" y="84" fill="var(--ink)">DeepSeek V4 / V4.1</text>
<text x="420" y="104" fill="var(--ink)">Kimi K3 · GLM-5.3</text>
<text x="420" y="124" fill="var(--ink)">MiMo · Muse Spark Open</text>
<text x="420" y="148" fill="var(--ink-soft)">几百 GB 到 1 TB 以上</text>
<text x="420" y="168" fill="var(--ink-soft)">个人一般用它们的 API</text>
</g>
</svg>
<figcaption>按总参数把开源模型分成三档。左边琥珀色这档是在你自己的机器上跑,右边蓝色这档基本只能通过 API 用(数字是今天下面几个脚本算出来的)。</figcaption>
</figure>

## 一个模型占多少内存

开头那个乘法:参数个数 × 每个参数占几个字节。Day 117 的名词表里有:BF16 每个参数 2 字节,FP8 是 1 字节,FP4 半个字节。厂商发布的原版一般是 BF16,所以 9B 的模型原版就要 18 GB 左右,16 GB 内存的笔记本连文件都装不下。

所以本地跑模型几乎都要先**量化**(quantization):把每个参数从 16 位压到 8 位、4 位,文件小一半到四分之三,代价是回答质量掉一点。打个前端熟悉的比方,把一张 PNG 存成 JPG,压到 80% 质量肉眼几乎看不出差别,压到 30% 就开始糊了。本地最常用的是 4 位,文件名里写着 `Q4_K_M` 这种标记;Day 428 会下载一个 `Q8_0` 的,也就是 8 位。

按纯理论,4 位就是每个参数半个字节,9B 模型 = 4.5 GB。真实文件是不是这样?我在 Hugging Face 上查了 unsloth(一个专门做量化版本的团队)发布的 5 个 Qwen 模型的 `Q4_K_M` 文件大小,写个脚本对一下。

`part02/` 是 Day 110 起一直在用的目录。新建 `part02/weights_size.py`:

```python
# agent-zero-lab/part02/weights_size.py
def weights_gb(params_b: float, bits: int) -> float:
    return params_b * bits / 8


REAL_Q4 = [
    ("Qwen3.5-0.8B", 0.87, 0.53),
    ("Qwen3.5-4B", 4.66, 2.74),
    ("Qwen3.5-9B", 9.65, 5.68),
    ("Qwen3.8-27B", 27.78, 16.46),
    ("Qwen3.5-35B-A3B", 35.95, 22.02),
]

print(f"{'model':16}{'16bit':>8}{'4bit':>8}{'Q4real':>8}{'GB/B':>7}")
for name, params_b, real_gb in REAL_Q4:
    full = weights_gb(params_b, 16)
    q4 = weights_gb(params_b, 4)
    print(f"{name:16}{full:8.1f}{q4:8.1f}{real_gb:8.2f}{real_gb / params_b:7.2f}")
```

<div class="line-notes">

- `def weights_gb(params_b: float, bits: int) -> float:` 参数个数用「多少 B」表示,9.65 就是 96.5 亿。类型标注是 [Day 45](/blog/agent-zero/day-045-type-hints-1/) 学的写法,相当于 TS 的 `(paramsB: number, bits: number): number`。
- `return params_b * bits / 8` 参数个数 × 每个几位 ÷ 8 = 字节数。单位巧了:十亿个 × 字节 = 十亿字节 = 1 GB(这里 1 GB 按 10 亿字节算,和 Hugging Face 显示文件大小的口径一样)。代入 9.65 和 16:9.65 × 16 ÷ 8 = 19.3。
- `REAL_Q4 = [` 一个列表,每项是三元组:名字、参数量(B)、真实 `Q4_K_M` 文件大小(GB)。参数量是仓库的参数总数,比如 Qwen3.5-9B 实际是 9,653,104,368 个,写成 9.65;文件大小取自 unsloth 的 GGUF 仓库。
- `("Qwen3.8-27B", 27.78, 16.46),` 这一个用的是 unsloth 的 `UD-Q4_K_M`(他们自己调过的 4 位),其他四个是标准 `Q4_K_M`。
- `print(f"{'model':16}{'16bit':>8}{'4bit':>8}{'Q4real':>8}{'GB/B':>7}")` 表头。`:16` 占 16 格左对齐,`:>8` 占 8 格右对齐。表头故意用英文:f-string 按「字符个数」对齐,一个汉字在终端里占两格宽,用中文表头列就歪了,我第一版就是这么歪的。
- `for name, params_b, real_gb in REAL_Q4:` 每次取出一个三元组,拆成三个变量(元组解包),相当于 JS 的 `for (const [name, paramsB, realGb] of REAL_Q4)`。
- `print(f"{name:16}{full:8.1f}{q4:8.1f}{real_gb:8.2f}{real_gb / params_b:7.2f}")` 最后一列是「真实文件 ÷ 参数量」,也就是每 1B 参数实际占多少 GB。Qwen3.5-9B 那行:5.68 ÷ 9.65 = 0.59。

</div>

在项目根目录 `agent-zero-lab` 里运行:

```bash
uv run part02/weights_size.py
```

实跑输出:

```text
model              16bit    4bit  Q4real   GB/B
Qwen3.5-0.8B         1.7     0.4    0.53   0.61
Qwen3.5-4B           9.3     2.3    2.74   0.59
Qwen3.5-9B          19.3     4.8    5.68   0.59
Qwen3.8-27B         55.6    13.9   16.46   0.59
Qwen3.5-35B-A3B     71.9    18.0   22.02   0.61
```

最后一列 5 个模型全落在 0.59–0.61 之间。真实文件比「纯 4 位」大了两成左右,原因是 `Q4_K_M` 并不是每个参数都压到 4 位:它按小块压缩,每块要多存几个缩放系数;而且对质量影响大的几层会保留更高的精度。M 是 medium,还有 S(更小)和 L(更大)。

所以得到一条很好用的经验:**4 位量化后,每 1B 参数约 0.6 GB**。8B 的模型约 5 GB,27B 约 16 GB,70B 约 42 GB。记住 0.6 这个数,面试被问「这个模型本地要多大内存」时可以当场心算。

例外也有。gpt-oss-20b 发布时专家部分就已经是 4 位格式(MXFP4),所以它的 `Q4_K_M` 文件是 11.62 GB,比 20.9 × 0.6 = 12.5 还小一点;它连 16 位版的文件也只有 13.79 GB,因为原本就没有 16 位的专家可以还原。Day 117 说的 DeepSeek-V4-Flash 权重文件 159.6 GB,也是因为专家用了 FP4。遇到这种模型,以真实文件大小为准。

## 我的电脑放得下吗

权重只是第一笔。模型跑起来,内存里还有两样东西:

- **KV cache**。Day 117 算过,Qwen3-8B 每个 token 要 144 KB,上下文越长占得越多。
- **运行时的余量**。推理程序本身、中间计算结果。我按 0.5 GB 粗算。

另外还有一个前端同学容易忽略的事:**你的电脑不是只跑模型**。macOS 自己、浏览器、编辑器、微信一起开着,16 GB 的机器能留给模型的,实际也就 10 GB 上下。我这台 2019 款 Intel MacBook Pro 是 16 GB 内存,平时开着浏览器和编辑器,空闲内存经常不到 1 GB。下面先按「总内存减 6 GB」算可用内存,这是我的粗估,你可以按自己的情况改。

新建 `part02/fit_check.py`:

```python
# agent-zero-lab/part02/fit_check.py
GB_PER_B = 0.6
KV_KB_PER_TOKEN = 144
CONTEXT = 8_000


def need_gb(params_b: float) -> float:
    weights = params_b * GB_PER_B
    kv = KV_KB_PER_TOKEN * 1024 * CONTEXT / 1e9
    return weights + kv + 0.5


def main() -> None:
    ram_gb = 16
    free_gb = ram_gb - 6
    for name, params_b in [("Qwen3.5-4B", 4.66), ("Qwen3.5-9B", 9.65), ("gpt-oss-20b", 20.9),
                           ("Qwen3.8-27B", 27.78), ("DeepSeek-V4-Flash", 284)]:
        need = need_gb(params_b)
        verdict = "放得下" if need <= free_gb else "放不下"
        print(f"{name:18} 约需 {need:6.1f} GB  可用 {free_gb} GB  {verdict}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `GB_PER_B = 0.6` 上一个脚本验证出来的经验值。全大写是 Python 的约定,表示「这是常量,别改它」,相当于 JS 里大写的 `const MAX_SIZE`。
- `KV_KB_PER_TOKEN = 144` Day 117 `kv_size.py` 算出来的 Qwen3-8B 每 token 的 KV cache。不同模型不一样(Qwen3-30B-A3B 是 96 KB),这里拿它当一个中等模型的代表值。
- `CONTEXT = 8_000` 按一次对话 8000 个 token 算。数字里的下划线只是为了好读,和 JS 的 `8_000` 一样。
- `weights = params_b * GB_PER_B` 权重:9.65 × 0.6 = 5.79 GB。
- `kv = KV_KB_PER_TOKEN * 1024 * CONTEXT / 1e9` 144 × 1024 字节 × 8000 个 token ÷ 10 亿 = 1.18 GB。`1e9` 是科学计数法的 10 亿,JS 里也这么写。
- `return weights + kv + 0.5` 再加 0.5 GB 余量。Qwen3.5-9B:5.79 + 1.18 + 0.5 = 7.47,打印出来是 7.5。
- `def main() -> None:` 演示代码放进 `main`,配合最后两行的 main guard。练习 1 要 `import` 这个文件里的 `need_gb`,不加 guard 的话一 import 就会先把下面五行打印一遍([Day 32](/blog/agent-zero/day-032-modules/) 讲过)。
- `free_gb = ram_gb - 6` 16 GB 减掉系统和其他程序大约占的 6 GB,剩 10 GB。
- `("DeepSeek-V4-Flash", 284)]:` 放一个服务器级的进来对比。它真实文件是 159.6 GB(专家是 FP4),按 0.6 算会偏大,但放不放得下的结论不变。
- `verdict = "放得下" if need <= free_gb else "放不下"` Python 的三元表达式,顺序和 JS 不一样:JS 是 `条件 ? A : B`,Python 是 `A if 条件 else B`。
- `print(f"{name:18} 约需 {need:6.1f} GB` `:6.1f` 占 6 格、保留 1 位小数。

</div>

```bash
uv run part02/fit_check.py
```

实跑输出:

```text
Qwen3.5-4B         约需    4.5 GB  可用 10 GB  放得下
Qwen3.5-9B         约需    7.5 GB  可用 10 GB  放得下
gpt-oss-20b        约需   14.2 GB  可用 10 GB  放不下
Qwen3.8-27B        约需   18.3 GB  可用 10 GB  放不下
DeepSeek-V4-Flash  约需  172.1 GB  可用 10 GB  放不下
```

16 GB 的笔记本,上限就是 9B 左右的模型。gpt-oss-20b 按真实文件 11.62 GB 算,加上 KV 和余量是 13.3 GB,也放不下。把这个结果画出来:

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="16 GB 内存里放 9B 模型和 27B 模型的对比:9B 放得下,27B 超出">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="40" y="34" fill="var(--ink)">Qwen3.5-9B · Q4</text>
<rect x="40" y="44" width="144" height="34" fill="var(--rule)"/>
<text x="52" y="66" fill="var(--ink)">系统+其他 6</text>
<rect x="184" y="44" width="139" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="196" y="66" fill="var(--mem)">权重 5.8</text>
<rect x="323" y="44" width="28" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="351" y="44" width="12" height="34" fill="var(--ink-faint)"/>
<text x="372" y="66" fill="var(--ink-soft)">剩 2.5 GB</text>
<text x="40" y="122" fill="var(--ink)">Qwen3.8-27B · Q4</text>
<rect x="40" y="132" width="144" height="34" fill="var(--rule)"/>
<text x="52" y="154" fill="var(--ink)">系统+其他 6</text>
<rect x="184" y="132" width="400" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="300" y="154" fill="var(--mem)">权重 16.7</text>
<rect x="584" y="132" width="28" height="34" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="612" y="132" width="12" height="34" fill="var(--ink-faint)"/>
<line x1="424" y1="24" x2="424" y2="186" stroke="var(--ink)" stroke-dasharray="4 3"/>
<text x="430" y="200" fill="var(--ink)">16 GB 到这里</text>
<rect x="40" y="190" width="12" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="58" y="201" fill="var(--ink-soft)">KV cache 1.2(8K token)</text>
<rect x="240" y="190" width="12" height="12" fill="var(--ink-faint)"/>
<text x="258" y="201" fill="var(--ink-soft)">余量 0.5</text>
</g>
</svg>
<figcaption>同一台 16 GB 的机器。9B 模型放完还剩 2.5 GB;27B 模型光权重就越过了虚线,系统会开始拿硬盘当内存用(交换),速度掉到没法用,或者干脆加载失败。</figcaption>
</figure>

如果你的电脑是 Apple M 系列芯片,这里有一个好消息:M 芯片的内存是 CPU 和 GPU 共用的(统一内存),模型能直接用 GPU 加速;但 macOS 默认只让 GPU 用大约 2/3 到 3/4 的内存,算的时候把可用内存再打个折。Intel Mac 和普通 Windows 笔记本没有能跑模型的独立显卡时,只能靠 CPU 算,能放下也会慢,这就是下一节。

## 放得下,不等于跑得快

Day 106 说过,模型一次只生成一个 token,生成每个 token 都要把整个模型从头算一遍。这对内存意味着:**每生成一个 token,模型的全部参数(MoE 是激活的那部分)都要从内存里读一遍**。在个人电脑上,这一步通常比算本身还慢,瓶颈卡在「每秒能从内存搬多少字节」上,这个数叫**内存带宽**。

这就得到一个估算速度上限的公式:

每秒最多生成的 token 数 ≈ 内存带宽(GB/s)÷ 每个 token 要读的数据量(GB)

几台机器的带宽:我这台 2019 款 Intel MacBook Pro 是 LPDDR3-2133 双通道内存(`system_profiler SPMemoryDataType` 能看到型号),理论带宽 2133 × 16 字节 ≈ 34.1 GB/s;Apple 官方公布的 M4 是 120 GB/s、M5 是 153 GB/s、M4 Pro 是 273 GB/s。

新建 `part02/speed_guess.py`:

```python
# agent-zero-lab/part02/speed_guess.py
MACHINES = {"2019 Intel MBP": 34.1, "M4": 120, "M5": 153, "M4 Pro": 273}

MODELS = [
    ("Qwen3-0.6B Q8", 0.64),
    ("Qwen3.5-9B Q4", 5.68),
    ("Qwen3.5-35B-A3B Q4", 3 * 0.6),
]

for machine, bandwidth in MACHINES.items():
    cells = []
    for name, read_gb in MODELS:
        cells.append(f"{name} {bandwidth / read_gb:5.1f}")
    print(f"{machine:15}", " | ".join(cells))
```

<div class="line-notes">

- `MACHINES = {"2019 Intel MBP": 34.1, "M4": 120, "M5": 153, "M4 Pro": 273}` 字典:机器名 → 内存带宽(GB/s)。相当于 JS 的对象字面量。
- `("Qwen3-0.6B Q8", 0.64),` 每个 token 要读的数据量:稠密模型就是整个文件。这个 0.64 GB 是 Day 428 会下载的那个 8 位小模型的文件大小(639 MB)。
- `("Qwen3.5-9B Q4", 5.68),` 上一节的真实文件 5.68 GB。
- `("Qwen3.5-35B-A3B Q4", 3 * 0.6),` MoE 模型每个 token 只用激活的 3B 参数,按 0.6 GB/B 算只读 1.8 GB,虽然内存里要装下全部 22 GB(Day 117:内存看总参数,速度看激活参数)。
- `for machine, bandwidth in MACHINES.items():` `.items()` 同时取键和值([Day 24](/blog/agent-zero/day-024-dicts/)),相当于 JS 的 `Object.entries()`。
- `cells.append(f"{name} {bandwidth / read_gb:5.1f}")` 带宽 ÷ 每 token 数据量。第一格:34.1 ÷ 0.64 = 53.3。
- `print(f"{machine:15}", " | ".join(cells))` `" | ".join(列表)` 用 ` | ` 把几段字符串连起来,相当于 JS 的 `cells.join(" | ")`,只是 Python 把分隔符写在前面。

</div>

```bash
uv run part02/speed_guess.py
```

实跑输出(单位:每秒 token 数,理论上限):

```text
2019 Intel MBP  Qwen3-0.6B Q8  53.3 | Qwen3.5-9B Q4   6.0 | Qwen3.5-35B-A3B Q4  18.9
M4              Qwen3-0.6B Q8 187.5 | Qwen3.5-9B Q4  21.1 | Qwen3.5-35B-A3B Q4  66.7
M5              Qwen3-0.6B Q8 239.1 | Qwen3.5-9B Q4  26.9 | Qwen3.5-35B-A3B Q4  85.0
M4 Pro          Qwen3-0.6B Q8 426.6 | Qwen3.5-9B Q4  48.1 | Qwen3.5-35B-A3B Q4 151.7
```

这是**上限**,真实速度要打折。我在这台 Intel Mac 上实际跑过那个 0.6B 模型(Day 428 会带你自己跑),Ollama 报告的生成速度是每秒 16.96 个 token,大约是理论值 53.3 的三分之一。CPU 本身算得不够快、内存带宽也跑不满,所以老机器的真实速度就是理论值的三成左右。这样推下去,9B 模型在我这台机器上每秒大概只有两个 token,一句话要等十几秒,能跑但没法用。

第三列很有意思:35B-A3B 这个 MoE 模型,参数量是 9B 的近 4 倍,速度上限却是它的 3 倍。这就是 Day 117 那句话在笔记本上的样子。前提是你得装得下它的 22 GB,也就是 32 GB 内存起步。这也是为什么 2026 年很多人推荐本地用 30B 左右的 MoE 模型:效果接近 30B 那一档,速度接近 3B。

还有一点:这个公式只管「一个字一个字往外吐」的阶段(Day 117 说的解码)。读你的输入那一步(预填充)是成批算的,更吃算力而不是带宽,Day 428 的 Ollama 输出里 `prompt eval rate` 和 `eval rate` 是分开的两个数,就是这个原因。

## 用什么软件跑

今天只认识名字,真动手在 [Day 428](/blog/agent-zero/day-428-local-models/):

- **Ollama**:一条命令下载并运行模型,自带一个 OpenAI 兼容的本地接口。个人电脑上最省事,Day 428 就用它。
- **LM Studio**:图形界面版,点几下就能下载、聊天、开本地接口。
- **llama.cpp**:上面两个的底层引擎之一,纯 C/C++,CPU 也能跑,今天说的 GGUF 文件格式就是它定的。
- **MLX**:Apple 为 M 芯片做的框架,在 Mac 上往往比 llama.cpp 快。
- **vLLM、SGLang**:服务器上的主流,一张卡同时服务很多人,吞吐高。进阶篇 [Day 567](/blog/agent-zero/day-567-self-host-1/) 起讲。

**GGUF** 是 llama.cpp 用的模型文件格式,一个文件里装着量化后的参数和模型配置。在 Hugging Face 上搜「模型名 + GGUF」,能找到各种量化版本,文件名里的 `Q4_K_M`、`Q8_0` 就是量化方式。

## 本地跑和调 API,到底差在哪

| | 调厂商 API(如 DeepSeek) | 自己电脑上跑开源模型 |
| --- | --- | --- |
| 能力 | 旗舰级,几百 B 到上万亿参数 | 个人电脑一般只能跑到 9B–32B,比旗舰弱一档,更容易胡编(Day 114) |
| 隐私 | 数据要发给厂商 | 数据不出本机,适合公司代码、合同、客户资料 |
| 成本 | 按 token 付费,很便宜(明天开始用) | 硬件一次投入,之后只有电费 |
| 网络 | 要联网,受限流和宕机影响 | 断网也能用 |
| 维护 | 什么都不用管 | 下载、升级、调参数都得自己来 |

有一个常见误会要专门说:**本地跑不等于「没有限制」**。厂商服务的限制大致有三层。第一层是模型训练时学会的拒绝行为(Day 113 讲的指令微调和 RLHF 那一步教出来的),写在参数里,下载到本地照样拒绝;第二层是厂商在模型前后加的内容审核和系统提示词;第三层是账号和服务条款。本地跑只是少了后两层。另外开源许可证本身也有使用限制,法律责任始终在使用者身上。对 Agent 工程师来说,本地模型的价值是隐私和大批量任务省钱,不是「没限制」。

再泼一盆冷水:本地跑一个 14B 模型来「赚钱」基本不成立。它的效果比 API 差,而 API 便宜到几分钱处理几十万字(明天你会自己算一遍),一台 32 GB Mac 的钱够调很多年 API。本地模型真正的用处有三个:数据不能出公司的场景;大批量简单任务(分类、打标签、抽字段)放一晚上跑,不按 token 花钱;还有就是学习本地部署和微调,做进作品集,这是加分项。

## 自己从零训一个,要做什么

Day 113 讲过训练的三个阶段:预训练、指令微调、RLHF。真要从零做一个,还要加上前后两头,一共七步:

1. **数据**:抓海量文本(网页、书、代码、论文),清洗、去重、过滤,定好各类数据的配比。最费人力,也最决定效果。
2. **分词器**:用自己的数据训一个 BPE 词表([Day 107](/blog/agent-zero/day-107-tokens-1/) 讲过 BPE 是怎么合并字符的)。
3. **结构**:基本都是 decoder-only Transformer(Day 116 那种只看前面的结构),定层数、宽度、注意力头数、要不要 MoE、上下文多长。
4. **预训练**:几千张 GPU 训几周到几个月。难点在工程:几千张卡怎么分工、一张卡坏了怎么从断点接着训、loss 突然飙高怎么办。
5. **后训练**:指令微调 → 偏好对齐(RLHF 或 DPO)→ 用能自动判对错的题目(数学、代码)做强化学习。Day 115 的推理模型主要靠最后这一步。
6. **评测**:公开基准 + 自己建的评测集 + 安全红队。
7. **推理部署**:量化、选推理引擎、上线。

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="从零训练大模型的七个步骤,预训练最花钱">
<rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="14" y="40" width="74" height="44" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="51" y="66" text-anchor="middle" fill="var(--ink)">1 数据</text>
<rect x="102" y="40" width="74" height="44" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="139" y="66" text-anchor="middle" fill="var(--ink)">2 分词器</text>
<rect x="190" y="40" width="74" height="44" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="227" y="66" text-anchor="middle" fill="var(--ink)">3 结构</text>
<rect x="278" y="40" width="84" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="66" text-anchor="middle" fill="var(--compute)">4 预训练</text>
<rect x="376" y="40" width="74" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="413" y="66" text-anchor="middle" fill="var(--mem)">5 后训练</text>
<rect x="464" y="40" width="74" height="44" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="501" y="66" text-anchor="middle" fill="var(--ink)">6 评测</text>
<rect x="552" y="40" width="74" height="44" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="589" y="66" text-anchor="middle" fill="var(--ink)">7 部署</text>
<text x="51" y="108" text-anchor="middle" fill="var(--ink-faint)">最费人</text>
<text x="320" y="108" text-anchor="middle" fill="var(--compute)">最费钱</text>
<text x="320" y="124" text-anchor="middle" fill="var(--ink-faint)">几千卡 × 几个月</text>
<text x="413" y="108" text-anchor="middle" fill="var(--mem)">个人能碰</text>
<text x="413" y="124" text-anchor="middle" fill="var(--ink-faint)">LoRA 微调</text>
<text x="589" y="108" text-anchor="middle" fill="var(--mem)">个人能碰</text>
<text x="589" y="124" text-anchor="middle" fill="var(--ink-faint)">Day 428/567</text>
<text x="320" y="156" text-anchor="middle" fill="var(--ink-soft)">Day 113 讲的三阶段 = 第 4、5 步</text>
</g>
</svg>
<figcaption>从零训练的七步。琥珀色的预训练是钱的大头,个人和小公司碰不了;蓝色的后训练(在别人的模型上微调)和部署是 Agent 工程师真正会用到的部分。</figcaption>
</figure>

### 训练要多少钱:一个算式

训练的计算量有一个流传很广的估算:**总计算次数 ≈ 6 × 参数量 × 训练 token 数**。为什么是 6?每个训练 token,前向算一遍(大约每个参数 2 次运算:一次乘、一次加),反向求梯度大约是前向的两倍(4 次),加起来 6 次。这是 OpenAI 和 DeepMind 的论文里常用的近似,我们直接拿来用。

计算次数的单位是 **FLOPs**(浮点运算次数)。一张 H100 显卡用 BF16 算,NVIDIA 公布的峰值是每秒约 989 万亿次(989 TFLOPS,不算稀疏加速);但真实训练里能用到峰值的 40% 左右就算不错了,这个比例叫 **MFU**(模型算力利用率)。租卡价格按 Karpathy 在 nanochat README 里写的「目前大约每卡每小时 3 美元」算。

新建 `part02/train_cost.py`:

```python
# agent-zero-lab/part02/train_cost.py
H100_FLOPS = 989e12
MFU = 0.4
USD_PER_GPU_HOUR = 3.0


def train_cost(params: float, tokens: float) -> tuple[float, float]:
    flops = 6 * params * tokens
    gpu_hours = flops / (H100_FLOPS * MFU) / 3600
    return flops, gpu_hours


def main() -> None:
    for label, params, tokens in [("7B / 2T token", 7e9, 2e12), ("0.6B / 36T token", 0.6e9, 36e12),
                                  ("27B / 36T token", 27e9, 36e12)]:
        flops, hours = train_cost(params, tokens)
        usd = hours * USD_PER_GPU_HOUR
        print(f"{label:18} {flops:.1e} FLOPs {hours:>12,.0f} GPU 小时  约 {usd:>14,.0f} 美元")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `H100_FLOPS = 989e12` 989 × 10¹²,一张 H100 每秒的 BF16 峰值运算次数。
- `MFU = 0.4` 真实能用到 40%。大规模训练里卡之间要通信、要等数据,很难更高。
- `USD_PER_GPU_HOUR = 3.0` 租一张 H100 一小时 3 美元,出处是 nanochat 的 README。不同平台、包年包月差别很大,这是个量级。
- `def train_cost(params: float, tokens: float) -> tuple[float, float]:` 返回两个值:总运算次数和 GPU 小时。`tuple[float, float]` 是「两个 float 组成的元组」的类型标注([Day 46](/blog/agent-zero/day-046-type-hints-2/) 一带讲过元组的标注)。
- `flops = 6 * params * tokens` 第一行:6 × 70 亿 × 2 万亿 = 8.4 × 10²²。
- `gpu_hours = flops / (H100_FLOPS * MFU) / 3600` 总次数 ÷ 每张卡每秒实际能算的次数 = 一张卡要算多少秒,再 ÷ 3600 换成小时。8.4e22 ÷ (989e12 × 0.4) ÷ 3600 ≈ 58,982。
- `return flops, gpu_hours` 一次返回两个值,其实返回的是一个元组。调用方用 `flops, hours = ...` 拆开,和 JS 的 `const [a, b] = f()` 一个意思。
- `("0.6B / 36T token", 0.6e9, 36e12),` Qwen 官方博客写 Qwen3 系列预训练用了大约 36 万亿 token,连最小的 0.6B 也是。
- `("27B / 36T token", 27e9, 36e12)]:` 假设一个 27B 的模型也训 36T token,看看规模翻 45 倍会怎样。这一行是我假设的,不是哪个模型的真实数据。
- `print(f"{label:18} {flops:.1e} FLOPs {hours:>12,.0f}` `:.1e` 用科学计数法显示,保留 1 位小数;`:>12,.0f` 占 12 格右对齐、千分位加逗号、不要小数。

</div>

```bash
uv run part02/train_cost.py
```

实跑输出:

```text
7B / 2T token      8.4e+22 FLOPs       58,982 GPU 小时  约        176,946 美元
0.6B / 36T token   1.3e+23 FLOPs       91,001 GPU 小时  约        273,003 美元
27B / 36T token    5.8e+24 FLOPs    4,095,046 GPU 小时  约     12,285,137 美元
```

几件事一看就清楚了:

- 训一个 7B 模型 2 万亿 token,光算力就要 6 万 GPU 小时、十几万美元。这还只是**一次成功的**预训练,不算数据团队的人力、调参时失败重来的那几次、后训练和评测。
- 第二行比第一行还贵。0.6B 的小模型喂了 36T token,数据量是第一行的 18 倍。现在厂商训小模型,会喂远超「够用」的数据,让小模型尽量强,因为训练是一次性的花费,而用的人每天都在为推理付钱。
- 第三行是一千多万美元,和外界说的「一线大模型训练一次几千万到上亿美元」是一个量级。

个人能做什么?Karpathy 的 [nanochat](https://github.com/karpathy/nanochat) 把七步全做成了一套小代码,README 里写着租一台 8 卡 H100 的机器,大约 2 小时、48 美元,就能训出一个 GPT-2 水平的小模型,还能在命令行里和它聊天。想真正弄懂原理,花几十美元把这个跑一遍很值。想做出有用的东西,在 Qwen 这类开源模型上做 LoRA 微调(进阶篇 [Day 572](/blog/agent-zero/day-572-finetune-2/)),几千条领域数据、一张卡几小时就够。

对 Agent 工程师来说,从零预训练基本用不上。会算本地内存账、会部署一个开源模型、会做 LoRA 微调,是招聘要求里常见的加分项;核心技能仍然是用 API 把 Agent 做好,也就是明天开始的事。

## 动手练习

**练习 1:换成你的内存。** 写 `part02/fit_ram.py`,从 `fit_check.py` 里 import `need_gb`,分别算 8 GB、16 GB、32 GB 内存(都按减 6 GB 当可用)时,Qwen3.5-0.8B、4B、9B、Qwen3.8-27B、Qwen3.5-35B-A3B 哪些放得下。顺便观察:import 的时候 `fit_check.py` 的五行表格有没有被打印出来?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/fit_ram.py
from fit_check import need_gb

MODELS = [("Qwen3.5-0.8B", 0.87), ("Qwen3.5-4B", 4.66), ("Qwen3.5-9B", 9.65), ("Qwen3.8-27B", 27.78), ("Qwen3.5-35B-A3B", 35.95)]

for ram_gb in (8, 16, 32):
    free_gb = ram_gb - 6
    ok = [name for name, params_b in MODELS if need_gb(params_b) <= free_gb]
    print(f"{ram_gb:2} GB 内存(可用 {free_gb:2} GB): {', '.join(ok) or '一个都放不下'}")
```

<div class="line-notes">

- `from fit_check import need_gb` 同一个目录下的文件可以直接 import。用 `uv run part02/fit_ram.py` 运行时,Python 会把脚本所在的 `part02/` 加进搜索路径,所以找得到 `fit_check.py`。
- `for ram_gb in (8, 16, 32):` 遍历一个元组,三种内存各算一次。
- `ok = [name for name, params_b in MODELS if need_gb(params_b) <= free_gb]` 带条件的列表推导式([Day 23](/blog/agent-zero/day-023-comprehensions/)),相当于 JS 的 `MODELS.filter(...).map(...)`。
- `{', '.join(ok) or '一个都放不下'}` 空列表 join 出来是空字符串 `""`,空字符串当真假判断是假,`or` 就取后面那个。和 JS 的 `"" || "默认值"` 一样。

</div>

实跑输出:

```text
 8 GB 内存(可用  2 GB): 一个都放不下
16 GB 内存(可用 10 GB): Qwen3.5-0.8B, Qwen3.5-4B, Qwen3.5-9B
32 GB 内存(可用 26 GB): Qwen3.5-0.8B, Qwen3.5-4B, Qwen3.5-9B, Qwen3.8-27B, Qwen3.5-35B-A3B
```

import 时没有打印那五行,因为 `fit_check.py` 的演示代码在 main guard 里。我第一版没加 guard,运行 `fit_ram.py` 时屏幕最上面先冒出了 `Qwen3.5-4B 约需 4.5 GB ...` 那五行,然后才是这三行。

8 GB 那一行值得想一下:0.8B 模型只有 0.52 GB,怎么会放不下?因为 KV cache 用的是 8B 模型的 144 KB 每 token,8000 个 token 就是 1.18 GB,对 0.8B 这种小模型估多了(小模型层数少、头少,KV cache 小得多)。估算公式里每个常数都有适用范围,结论在边界上时要去查真实配置。

</details>

**练习 2:MoE 和稠密,谁更划算。** 假设你有一台 M4 Pro(273 GB/s)的电脑,内存够大。写 `part02/moe_vs_dense.py`,比较 Qwen3.8-27B(稠密)和 Qwen3.5-35B-A3B(MoE)各占多少内存、生成速度上限多少,并用 Day 117 的话解释结果。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/moe_vs_dense.py
BANDWIDTH = 273
GB_PER_B = 0.6

for name, total_b, active_b in [("Qwen3.8-27B(稠密)", 27.78, 27.78), ("Qwen3.5-35B-A3B(MoE)", 35.95, 3)]:
    memory = total_b * GB_PER_B
    speed = BANDWIDTH / (active_b * GB_PER_B)
    print(f"{name}: 占内存约 {memory:.1f} GB, 速度上限约 {speed:.0f} token/s")
```

<div class="line-notes">

- `for name, total_b, active_b in [` 每个模型给两个参数量:总参数和激活参数。稠密模型两个一样。
- `memory = total_b * GB_PER_B` 内存按总参数算。35.95 × 0.6 = 21.6 GB。
- `speed = BANDWIDTH / (active_b * GB_PER_B)` 速度按激活参数算。273 ÷ (3 × 0.6) = 151.7,打印成 152。

</div>

实跑输出:

```text
Qwen3.8-27B(稠密): 占内存约 16.7 GB, 速度上限约 16 token/s
Qwen3.5-35B-A3B(MoE): 占内存约 21.6 GB, 速度上限约 152 token/s
```

MoE 多占了 5 GB 内存,速度上限却快了 9 倍。这就是 Day 117 那句「显存看总参数,速度看激活参数」:所有专家都要装在内存里,但每个 token 只读被选中的那几个。效果上 27B 稠密模型不一定比 35B-A3B 差,要按你的任务实测,但在内存够、带宽有限的个人电脑上,MoE 是更顺手的选择。

</details>

**练习 3:自己去 Hugging Face 查参数量。** 写 `part02/hf_params.py`,用 httpx 请求 `https://huggingface.co/api/models/{仓库名}`,从返回的 JSON 里取出参数总数和许可证,打印估算的 Q4 大小。命令行传几个仓库名进去。查 `Qwen/Qwen3.5-9B`、`google/gemma-4-12B-it`、`openai/gpt-oss-20b`、`moonshotai/Kimi-K3`。这个接口不用登录、不用 key。

<details><summary>参考答案</summary>

如果你的 `agent-zero-lab` 里还没有 httpx(Day 64 装过的话就有),先在项目根目录装:

```bash
uv add httpx
```

```python
# agent-zero-lab/part02/hf_params.py
import sys

import httpx

for repo in sys.argv[1:]:
    info = httpx.get(f"https://huggingface.co/api/models/{repo}", timeout=30).json()
    total = info["safetensors"]["total"]
    licenses = [t.removeprefix("license:") for t in info["tags"] if t.startswith("license:")]
    print(f"{repo:32} {total / 1e9:8.2f} B  许可证 {licenses[0]}  估 Q4 {total / 1e9 * 0.6:6.1f} GB")
```

<div class="line-notes">

- `for repo in sys.argv[1:]:` `sys.argv` 是命令行参数列表,第 0 个是脚本名,`[1:]` 取后面所有,相当于 Node 的 `process.argv.slice(2)`。
- `info = httpx.get(f"https://huggingface.co/api/models/{repo}", timeout=30).json()` 发 GET 请求,把返回的 JSON 转成字典([Day 64](/blog/agent-zero/day-064-httpx-1/))。相当于 `await (await fetch(url)).json()`。
- `total = info["safetensors"]["total"]` 返回里 `safetensors.total` 是参数文件里的参数总数。Qwen3.5-9B 是 9653104368。
- `licenses = [t.removeprefix("license:") for t in info["tags"] if t.startswith("license:")]` 许可证藏在 `tags` 列表里,形如 `license:apache-2.0`。挑出 `license:` 开头的,去掉前缀。`removeprefix` 是 Python 3.9 起有的字符串方法。
- `print(f"{repo:32} {total / 1e9:8.2f} B` 参数总数 ÷ 10 亿换成 B。

</div>

```bash
uv run part02/hf_params.py Qwen/Qwen3.5-9B google/gemma-4-12B-it openai/gpt-oss-20b moonshotai/Kimi-K3
```

实跑输出:

```text
Qwen/Qwen3.5-9B                      9.65 B  许可证 apache-2.0  估 Q4    5.8 GB
google/gemma-4-12B-it               11.96 B  许可证 apache-2.0  估 Q4    7.2 GB
openai/gpt-oss-20b                  20.91 B  许可证 apache-2.0  估 Q4   12.5 GB
moonshotai/Kimi-K3                2779.93 B  许可证 other  估 Q4 1668.0 GB
```

Kimi K3 的许可证是 `other`,也就是厂商自定义条款,要点进说明页去读。它的参数文件里有约 2.8 万亿个参数,4 位量化也要 1.6 TB 以上,个人只能用它的 API。gpt-oss-20b 的估值 12.5 GB 比真实 Q4 文件 11.62 GB 大一点,原因正文说过。

</details>

**练习 4:「刚好够」的数据量要花多少钱。** DeepMind 2022 年的 Chinchilla 论文给过一个经验:在算力固定时,训练 token 数大约是参数量的 20 倍最划算。写 `part02/chinchilla.py`,复用 `train_cost.py` 里的 `train_cost` 和 `USD_PER_GPU_HOUR`,算 0.5B、1B、7B 三个尺寸按 20 倍数据训练要多少 GPU 小时和钱,和正文第一行(7B 训 2T token)比较。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/chinchilla.py
from train_cost import USD_PER_GPU_HOUR, train_cost

for params in (0.5e9, 1e9, 7e9):
    tokens = 20 * params
    flops, hours = train_cost(params, tokens)
    print(f"{params / 1e9:>4.1f}B 参数 × {tokens / 1e9:>5.0f}B token: {hours:>8,.0f} GPU 小时, 约 {hours * USD_PER_GPU_HOUR:>9,.0f} 美元")
```

<div class="line-notes">

- `from train_cost import USD_PER_GPU_HOUR, train_cost` 一次 import 两个名字,一个常量一个函数。`train_cost.py` 有 main guard,所以不会打印正文那三行。
- `tokens = 20 * params` Chinchilla 的「每个参数 20 个 token」。7B 就是 1400 亿 token。
- `flops, hours = train_cost(params, tokens)` 拆开返回的元组。`flops` 这里没用上,写出来是为了看清函数返回了两个值;不想要可以写成 `_, hours = ...`。

</div>

实跑输出:

```text
 0.5B 参数 ×    10B token:       21 GPU 小时, 约        63 美元
 1.0B 参数 ×    20B token:       84 GPU 小时, 约       253 美元
 7.0B 参数 ×   140B token:    4,129 GPU 小时, 约    12,386 美元
```

按 Chinchilla 的「刚好够」,7B 只要 1.2 万美元,是正文 2T token 那一行(17.7 万美元)的 1/14。厂商不这么省,是因为 Chinchilla 只考虑了**训练**最划算,没考虑**推理**:模型训好以后要被调用几十亿次,同样的效果,模型越小每次推理越便宜。所以 2026 年的做法是用远超 20 倍的数据把小模型尽量喂强。0.5B 那一行的 63 美元,和 nanochat README 写的「48 美元训出 GPT-2 水平」是一个量级,个人确实能负担。

</details>

**验收标准**:`weights_size.py`、`fit_check.py`、`speed_guess.py`、`train_cost.py` 四个脚本都能在 `agent-zero-lab` 根目录用 `uv run` 跑通,输出和文章一致;能不看文章说出「4 位量化每 1B 约 0.6 GB」「速度上限 = 带宽 ÷ 每 token 读的数据量」「训练 ≈ 6 × 参数 × token」三个算式,并用它们估一个你没见过的模型。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 开放权重模型(open-weight) | 厂商公开参数文件、谁都能下载自己跑的模型。中文常叫开源模型,但训练数据和流程一般不公开 |
| 闭源模型 | 只能通过 API 调用、拿不到参数文件的模型,如 GPT-5、Claude、Gemini 旗舰 |
| Hugging Face | 存放和分享模型的网站,类似模型界的 npm + GitHub,地址形如 `huggingface.co/厂商/模型名` |
| safetensors | Hugging Face 上参数文件的常见格式,大模型会切成很多个分片 |
| 模型说明页(model card) | 模型仓库首页的说明,写参数量、用法、许可证 |
| 许可证(license) | 规定模型能怎么用。Apache-2.0、MIT 最宽松;`license:other` 是厂商自定义条款 |
| 量化(quantization) | 把每个参数从 16 位压到 8 位、4 位,文件变小、质量略降 |
| `Q4_K_M` / `Q8_0` | GGUF 文件名里的量化方式标记。Q4_K_M 平均每 1B 参数约 0.6 GB |
| GGUF | llama.cpp 定义的模型文件格式,一个文件装下量化后的参数和配置 |
| 内存带宽 | 每秒能从内存读多少字节。个人电脑上它决定生成速度的上限 |
| 统一内存 | Apple M 芯片上 CPU 和 GPU 共用的内存,模型能直接用 GPU 加速 |
| Ollama / LM Studio / llama.cpp / MLX | 个人电脑上跑开源模型的工具,Day 428 动手 |
| vLLM / SGLang | 服务器上的推理引擎,一张卡同时服务很多请求 |
| FLOPs | 浮点运算次数,衡量计算量。训练 ≈ 6 × 参数 × token 次 |
| TFLOPS | 每秒万亿次浮点运算,衡量显卡算力。H100 的 BF16 峰值约 989 |
| MFU | 模型算力利用率,真实训练用到峰值算力的比例,40% 左右算不错 |
| GPU 小时 | 一张 GPU 用一小时。租卡按它收钱 |
| Chinchilla 比例 | DeepMind 2022 年的经验:算力固定时训练 token 数约为参数量的 20 倍最划算 |
| nanochat | Karpathy 的小项目,用一套小代码走完训练全流程,几十美元训出 GPT-2 水平的模型 |
| LoRA 微调 | 在别人训好的模型上只训练一小部分新参数,便宜很多,Day 572 讲 |

## 常见误区

**把「开源模型」理解成和开源软件一样。** React 开源是源码全给你;大模型开源一般只给最终的参数文件,训练数据和训练过程不给,你没法从头复现一份。它更像给了你一个能用的 `bundle.min.js`。

**以为能下载就能随便商用。** 实查 Kimi K3、GLM-5.3、Muse Spark Open 等仓库的许可证标签都是 `license:other`,是厂商自定义条款。做公司项目前要读完条款,最好让法务看一眼。

**只算权重,忘了 KV cache 和系统本身。** 9B 模型 Q4 文件 5.68 GB,看着 8 GB 内存也放得下;实际加上 8K 上下文的 KV cache(约 1.2 GB)、运行余量,再加上 macOS 和浏览器占的那几 GB,8 GB 的机器根本跑不起来。

**以为放得下就能用。** 我这台 Intel Mac 跑 0.6B 模型实测每秒 16.96 个 token,只有理论上限的三分之一;按这个比例,9B 模型每秒两个 token 左右。放得下和用得了是两件事,速度要按带宽估。

**用中文表头做 f-string 对齐。** `f"{'模型':16}"` 是按字符数补空格,一个汉字在终端里占两格宽,表头和下面的数字列会错开。表头用英文,或者干脆不对齐表头。

**拿最新的模型名当知识背。** Day 117 写的 DeepSeek-V4-Flash 284B/13B,到今天 `deepseek-flash` 背后已经是主干 552B、激活 8B/16B 的 V4.1-Flash 了。这一行变化太快,学会去 Hugging Face 和说明页查,比记住名字有用。

**以为本地跑就没有任何限制。** 训练时学会的拒绝行为写在参数里,下载到本地照样拒绝;本地只是少了厂商的服务端审核和账号条款。许可证的限制和法律责任也都还在。

## 学习资料

### 文档与文章

- [Hugging Face 模型库](https://huggingface.co/models):今天表格的数据来源。左边可以按任务、许可证筛选,右上角按下载量或最近更新排序。10 分钟逛一圈。
- [Qwen3.5-9B 模型说明页](https://huggingface.co/Qwen/Qwen3.5-9B):看一个典型的说明页长什么样:参数量、上下文长度、许可证写在哪。
- [unsloth/Qwen3.5-9B-GGUF](https://huggingface.co/unsloth/Qwen3.5-9B-GGUF):点「Files and versions」能看到同一个模型的十几种量化文件和各自大小,今天 `weights_size.py` 的数就从这类页面来。
- [DeepSeek-V4.1-Flash 模型说明页](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash):英文,552B 主干、激活 8B/16B 的出处,也是我们明天开始调用的 `deepseek-flash` 背后的模型。
- [Hugging Face 文档:GGUF](https://huggingface.co/docs/hub/gguf):英文,GGUF 格式和各种量化类型(Q4_K、Q8_0 等)每个参数大概占几位,有一张对照表。
- [Qwen3 官方博客](https://qwenlm.github.io/blog/qwen3/):英文,「约 36 万亿 token、119 种语言」这句话的出处,也能看到一家厂商发布模型时会公开哪些信息。
- [Chinchilla 论文《Training Compute-Optimal Large Language Models》](https://arxiv.org/abs/2203.15556):英文,练习 4 那个「20 倍」的出处。只看摘要和图 1。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QWpK68EFA&autoplay=0&high_quality=1" title="普通电脑怎么本地跑大模型?显存、量化、7B/8B、Ollama 一次讲透" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI算法工程师Power · 普通电脑怎么本地跑大模型?显存、量化、7B/8B、Ollama 一次讲透 · 10 分钟,2026 年 10 月。和今天的内存账讲的是同一件事,可以拿视频里的数和 `fit_check.py` 对一下。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1GKpX6bECm&autoplay=0&high_quality=1" title="Q4_K_M、Q8_0该下哪个?本地模型文件名逐段拆解" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图解AI_Infra · Q4_K_M、Q8_0 该下哪个?本地模型文件名逐段拆解 · 2 分钟,2026 年 10 月。把一个 GGUF 文件名从左到右拆开讲,看完再去 Hugging Face 看文件列表就不懵了。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1emKb6sE93&autoplay=0&high_quality=1" title="2026本地大模型横评:13款开源模型,4000元丐版硬件本地部署实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>碳基生物退役指南 · 2026 本地大模型横评:13 款开源模型,4000 元丐版硬件本地部署实战 · 19 分钟,2026 年 7 月,播放 11 万。一个人真金白银试下来的体验,看看本地模型在普通硬件上到底能做到什么程度。视频里的模型版本比今天的表旧一点。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zjkBMFhNj_g" title="[1hr Talk] Intro to Large Language Models" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · [1hr Talk] Intro to Large Language Models · 英文,2023 年。开头几分钟就是今天开场那个「模型就是两个文件」的例子,接着讲训练要多少卡多少钱。模型名字过时了,道理没过时。</figcaption>
</figure>

### 书籍

- 《从零构建大模型》(Sebastian Raschka 著,覃立波、冯骁骋译,人民邮电出版社,2025 年;英文原版 *Build a Large Language Model (From Scratch)*,Manning,2024 年):Day 116、117 推荐过。今天七步里的第 2–5 步,书里都用一个能在笔记本上训练的小 GPT 走了一遍,最能让你体会「预训练到底在算什么」。

### 开源项目与代码

- [karpathy/nanochat](https://github.com/karpathy/nanochat):今天提到的「48 美元训一个 GPT-2」。今天只读 README 的前两节和那张「time to GPT-2」的表。
- [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp):GGUF 格式和本地推理的底层引擎,Ollama 等工具都建在它上面。README 里有支持的模型列表和量化说明。
- [Ollama](https://ollama.com):Day 428 要装的工具,今天先看看官网的模型库里有哪些模型、每个有几种尺寸。

## 自测

1. 「开源模型」通常开放了什么,没开放什么?为什么说它不像 React 那样的开源?

<details><summary>答案</summary>

开放了训练好的参数文件和推理代码,谁都能下载自己跑;一般没开放训练数据和训练过程。React 开源意味着你能从源码自己构建出一模一样的东西,大模型拿不到数据和训练流程,没法复现,所以更准确的叫法是「开放权重」。另外还要看许可证,有的是 Apache-2.0/MIT,有的是厂商自定义条款。

</details>

2. 一个 32B 的稠密模型,4 位量化后大约多大?放在 32 GB 内存的电脑上够不够?

<details><summary>答案</summary>

32 × 0.6 ≈ 19 GB。再加 8K 上下文的 KV cache 约 1.2 GB(按 144 KB/token 粗算)和 0.5 GB 余量,约 21 GB。32 GB 内存减掉系统和其他程序约 6 GB,剩 26 GB,放得下但不宽裕,上下文不能开太长。如果是 Apple M 芯片,还要考虑 macOS 默认只让 GPU 用约 2/3 到 3/4 的内存。

</details>

3. 为什么在个人电脑上,一个 35B-A3B 的 MoE 模型比一个 9B 的稠密模型生成得还快?

<details><summary>答案</summary>

生成每个 token 都要把用到的参数从内存读一遍,个人电脑上速度主要受内存带宽限制。速度上限 ≈ 带宽 ÷ 每 token 要读的数据量。MoE 每个 token 只用激活的 3B 参数,约 1.8 GB;9B 稠密模型每个 token 要读全部 5.68 GB。所以 MoE 的上限约是 9B 的 3 倍。代价是内存要装下 MoE 全部 35B 参数(约 22 GB)。

</details>

4. 用「6 × 参数 × token」估一下:训练一个 1B 参数、100B token 的模型,大约多少 GPU 小时?(H100 按 989 TFLOPS、MFU 40%)

<details><summary>答案</summary>

6 × 1e9 × 1e11 = 6e20 FLOPs。每张卡每秒实际算 989e12 × 0.4 ≈ 3.96e14 次。6e20 ÷ 3.96e14 ≈ 1.52e6 秒 ≈ 421 GPU 小时。按每卡时 3 美元,约 1,260 美元。这个结果也能用练习 4 的数推:1B × 20B token 是 84 GPU 小时,数据量多 5 倍,就是 84 × 5 = 420。

</details>

5. 面试题:「客户要求数据不能出内网,让你评估一下本地部署开源模型来做客服 Agent,你会怎么评估?」

<details><summary>答案</summary>

分四块说。第一,能力:先用候选开源模型(比如 Qwen3.8-27B、Qwen3.5-35B-A3B、GLM-5.3-Flash 这一档)在自己的客服评测集上跑一遍,和当前用的 API 模型比准确率,特别是工具调用和不乱答;够不够用由数据说话。第二,硬件:按「权重(Q4 每 1B 约 0.6 GB,或真实文件大小)+ 每个请求的 KV cache × 并发数 + 余量」算显存,再按带宽和激活参数估速度,定要几张什么卡。第三,许可证:Apache-2.0/MIT 可以直接用,`license:other` 的要读条款,看用户量、收入门槛和用途限制。第四,成本和运维:硬件一次投入加电费、加上部署、升级、监控的人力,和 API 的按量付费比一下打平点(Day 428 会算)。最后给结论时说清楚风险:本地模型通常比旗舰弱一档,要用更严格的评测和人工兜底。

</details>

## 明天预告

Day 120 · 注册 API、充值和第一次调用。从 Day 108 起,好几篇都有一段「这段你现在不用跑,看我的结果」,因为你还没有 key。明天把这件事办了:在 DeepSeek 开放平台实名认证、充值、建 API key,写进 `.env`,装好 openai SDK,用十几行代码完成你的第一次调用,再故意把 key 写错、把 `.env` 弄丢,看看各报什么错。今天算的是「自己跑模型」那条路,明天走的是这门课真正的主路。
