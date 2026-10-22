---
title: 'Day 220 · 维度、存储、花多少钱,怎么挑模型'
description: '做工程要会算账。先用 numpy 量出一个 1024 维向量占 4096 字节,再实测中文每个字大约 0.7 到 0.9 个 token,算出 1 万篇帮助中心文章在六家模型上建一次索引的钱和存储;然后学怎么读 MTEB 排行榜,最后用 6 道自己的题实测:榜单第一的 Qwen3-Embedding 不加指令时反而输给 bge-m3。'
pubDate: 2026-10-22
regime: none
tags: ['embedding', 'cost', 'mteb', 'qwen3-embedding', 'agent-zero']
series: 'agent-zero'
day: 220
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 219](/blog/agent-zero/day-219-embed-limits/) 专门找让 embedding 出错的反例:「企业版支持按比例退款」和「不支持」余弦 0.906,客户问 E1042,措辞更像问题的 E1043 文章以 0.80 对 0.65 排第一。练习 2 换成 bge-large-zh-v1.5 再测,两个短板一个没少,反而更严重。那天的结论是:这是把整句话压成一个向量的共性,不是哪个模型没选好。

那模型还要不要挑?要挑,只是挑的理由不是「它没有短板」。今天把挑模型这件事拆成两半:前一半算账,一个向量占多少地方、建一次索引要花多少钱、维度砍掉一半能省多少;后一半看榜单,学会读 MTEB 排行榜,再用自己的 6 道题验证一下榜单靠不靠谱。

## 今天要解决的问题

学完今天,你应该能做到:

1. 不看文章算出 1 万个 1024 维 `float32` 向量占多少空间,知道 pgvector 每个向量多出来的 8 字节是什么,以及为什么 4096 维的模型在 pgvector 里要多想一步。
2. 用 `usage` 实测出 bge-m3 上中文每个字大约多少 token,写一个小脚本算出「1 万篇文章在六家模型上建一次索引各要多少钱」,并说出 embedding 的钱和大模型回答的钱差几个数量级。
3. 用 `dimensions` 参数把 Qwen3-Embedding 的向量从 1024 维缩到 256、128、64 维,在自己的小数据上看检索结果变没变,说出维度、存储和效果之间怎么取舍。
4. 会读 MTEB 排行榜:只看哪一栏、哪几列,以及为什么榜单第一的模型在自己的数据上不一定第一。

预计用时 2.5 小时:三笔账三个脚本 50 分钟,维度实验 30 分钟,榜单和自测小评估 40 分钟,剩下做练习。前置:[Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py` 和练习 4(那天第一次用了 `dimensions`),[Day 218](/blog/agent-zero/day-218-sim-matrix/) 的六句话和 `argsort`,[Day 219](/blog/agent-zero/day-219-embed-limits/) 的 E1042 反例,[Day 37](/blog/agent-zero/day-037-pathlib/) 的 `pathlib`,[Day 107](/blog/agent-zero/day-107-tokens-1/) 讲过的 token。

实跑花费:bge-m3 和 bge-large-zh-v1.5 免费;Qwen3-Embedding-0.6B 每百万 token 0.07 元、8B 0.28 元,照着文章跑一遍大约用 3000 个 Qwen3 token,就算全按 8B 的价格算也只有 3000 ÷ 1,000,000 × 0.28 ≈ 0.0008 元;我写这篇时反复跑了好几遍,合计不到 1 万个 token,上限 0.003 元。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `cost_10k.py` 的算式和 `own_eval.py` 里算名次那三行;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 第一笔账:一个向量占多少地方

先不调任何接口,纯算。新建 `part04/vec_bytes.py`:

```python
# agent-zero-lab/part04/vec_bytes.py
from pathlib import Path

import numpy as np

one = np.zeros(1024, dtype=np.float32)
print("一个 1024 维 float32 向量:", one.nbytes, "字节")
print("同样的向量用 float64:", one.astype(np.float64).nbytes, "字节")

index = np.random.rand(10_000, 1024).astype(np.float32)
print("1 万个向量:", index.shape, index.nbytes, "字节 =", round(index.nbytes / 1024 / 1024, 2), "MB")

path = Path("part04/tmp_index.npy")
np.save(path, index)
print("存成 .npy 文件:", path.stat().st_size, "字节")
path.unlink()

print("pgvector 里每个向量:", 4 * 1024 + 8, "字节")
```

<div class="line-notes">

- `from pathlib import Path` [Day 37](/blog/agent-zero/day-037-pathlib/) 学的路径对象,下面用它查文件大小、删文件。
- `one = np.zeros(1024, dtype=np.float32)` 一个 1024 个 0 组成的向量。内容是什么不影响大小,1024 个 `float32` 永远占同样多的地方。
- `one.nbytes` numpy 数组的属性,告诉你这些数字一共占多少字节。实测 4096,也就是 1024 × 4。`float32` 每个数 4 字节,Day 217 说过会用到这个 4。
- `one.astype(np.float64).nbytes` 转成 `float64` 再看,8192,翻倍。Python 自己的 `float` 和 numpy 默认的类型都是 64 位,所以 `common/embed.py` 里特意写了 `dtype=np.float32`。
- `index = np.random.rand(10_000, 1024).astype(np.float32)` 造 1 万个随机向量,模拟一个 1 万块的索引。`10_000` 里的下划线只是为了好读,等于 `10000`,和 JS 的 `10_000` 写法一样。
- `round(index.nbytes / 1024 / 1024, 2)` 字节除以两次 1024 换算成 MB。实测 40,960,000 字节,39.06 MB。
- `path = Path("part04/tmp_index.npy")` 临时文件的路径。在 `agent-zero-lab` 根目录跑,所以相对路径是 `part04/...`。
- `np.save(path, index)` 把数组存成 numpy 自己的 `.npy` 二进制格式,[Day 225](/blog/agent-zero/day-225-numpy-index/) 建索引时会正式用它。
- `path.stat().st_size` 文件在磁盘上的大小。实测 40,960,128 字节,比数组本身多 128 字节,那是 `.npy` 文件头,记录了形状和类型。
- `path.unlink()` 删掉临时文件,40 MB 别留在练习仓库里。`unlink` 是 Unix 里「删文件」的老名字,相当于 Node 的 `fs.unlinkSync`。
- `print("pgvector 里每个向量:", 4 * 1024 + 8, "字节")` pgvector 文档写的公式是每个向量 `4 × 维度 + 8` 字节,多出的 8 字节是头信息(记录维度等)。[Day 229](/blog/agent-zero/day-229-pgvector-1/) 开始用它。

</div>

```bash
cd agent-zero-lab
uv run python -m part04.vec_bytes
```

真实输出:

```text
一个 1024 维 float32 向量: 4096 字节
同样的向量用 float64: 8192 字节
1 万个向量: (10000, 1024) 40960000 字节 = 39.06 MB
存成 .npy 文件: 40960128 字节
pgvector 里每个向量: 4104 字节
```

记住一个数就够了:**1024 维 ≈ 4 KB 一个向量**。1 万块 40 MB,一台笔记本的内存随便放;100 万块 4 GB,还能放进一台普通服务器的内存,但这时候「每次查询都把 100 万个向量全部点积一遍」就开始慢了,要用 [Day 233](/blog/agent-zero/day-233-hnsw/) 的 HNSW 索引。存储本身很少是瓶颈,维度对存储的影响是线性的:4096 维的模型,同样的块数要 4 倍空间。

还有一个和维度有关的硬限制,现在先知道:pgvector 文档写明 `vector` 类型最多存 16,000 维,但 HNSW 和 IVFFlat 两种索引最多只支持 **2,000 维**;用半精度的 `halfvec`(每个数 2 字节)可以索引到 4,000 维。2026 年 10 月我查到的 pgvector 是 0.8.7。所以如果你挑了一个默认输出 4096 维的模型,存进去没问题,建索引那一步会直接失败。这个坑 Day 229 和 Day 233 细讲。

## 第二笔账:一个中文字是几个 token

embedding 按**输入 token** 收费,没有输出费。要算钱,先得知道你的文字会变成多少 token。[Day 107](/blog/agent-zero/day-107-tokens-1/) 讲过,token 是模型切文字的单位,中英文切法不一样,不同模型的切法也不一样。不用猜,用 Day 217 写的 `usage` 字典实测。

新建 `part04/count_tokens.py`:

```python
# agent-zero-lab/part04/count_tokens.py
from common.embed import embed, usage

TEXTS = [
    "退款政策:年付套餐中途取消的,按剩余的整月数比例退款。退款在审批通过后 3 到 5 个工作日原路退回。",
    "发票抬头填错了怎么办?已开具的电子发票可以在「账单 → 发票」页面申请作废,作废后重新填写抬头再开一次。",
    "导入银行流水报错 E1042:文件编码不是 UTF-8。用 Excel 另存为 CSV UTF-8 后重新上传。",
    "How do I reset my password? Click 'Forgot password' on the login page and check your inbox.",
]

for text in TEXTS:
    before = usage["tokens"]
    embed([text])
    tokens = usage["tokens"] - before
    print(f"{len(text):>3} 字符  {tokens:>3} token  每字符 {tokens / len(text):.2f} token  {text[:14]}")
```

<div class="line-notes">

- `from common.embed import embed, usage` `usage` 是 Day 217 在模块里放的记账字典,每次请求后 `usage["tokens"]` 会加上这次的 token 数。
- `TEXTS = [` 四段典型的帮助中心文字:两段纯中文、一段中文夹错误码和英文、一段纯英文。
- `before = usage["tokens"]` 发请求前先记下当前累计值。
- `embed([text])` 一条一条发,这样每次的 token 数能单独算出来。平时别这么干,Day 217 说过一批发更快;这里是为了量。
- `tokens = usage["tokens"] - before` 前后一减,就是这一条的 token 数。
- `print(f"{len(text):>3} 字符` 这一行有三个新东西。`len(text)` 数的是**字符**个数,一个汉字算 1,一个英文字母也算 1,和 JS 的 `text.length` 基本一样(JS 遇到 emoji 这类字符会多算,Python 不会)。`:>3` 是右对齐、占 3 格,让几行数字对齐,相当于 JS 的 `String(n).padStart(3)`。`{tokens / len(text):.2f}` 是每个字符平均几个 token,保留两位。

</div>

```bash
uv run python -m part04.count_tokens
```

真实输出:

```text
 51 字符   45 token  每字符 0.88 token  退款政策:年付套餐中途取消的
 52 字符   43 token  每字符 0.83 token  发票抬头填错了怎么办?已开具
 56 字符   38 token  每字符 0.68 token  导入银行流水报错 E1042
 91 字符   25 token  每字符 0.27 token  How do I reset
```

纯中文在 bge-m3 上大约 **每字 0.85 个 token**;夹了英文和编号的,降到 0.68;纯英文只有 0.27,因为一个英文单词好几个字母才算一个 token。每条的计数里大概还包含一两个模型自己加的开头结尾标记,文本越短这点误差越明显。

换一个模型,同一段话的 token 数也会变。新建 `part04/token_compare.py`,拿第一段在四个模型上各发一次:

```python
# agent-zero-lab/part04/token_compare.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])

TEXT = "退款政策:年付套餐中途取消的,按剩余的整月数比例退款。退款在审批通过后 3 到 5 个工作日原路退回。"
print("字符数:", len(TEXT))
for model in ["BAAI/bge-m3", "BAAI/bge-large-zh-v1.5", "Qwen/Qwen3-Embedding-0.6B", "Qwen/Qwen3-Embedding-8B"]:
    r = client.embeddings.create(model=model, input=[TEXT])
    print(f"{model:<28} {r.usage.total_tokens:>3} token  {len(r.data[0].embedding):>4} 维")
```

<div class="line-notes">

- `client = OpenAI(base_url=os.environ["EMB_BASE_URL"]` 这次要换着模型调,`common/embed.py` 的模型是从 `.env` 读死的,所以像 Day 217 的 `emb_two_models.py` 那样自己建客户端。四个模型都在硅基流动上,地址和 key 不用变。
- `for model in [` 两个 bge 是免费的,两个 Qwen3 是收费的,这一段话 37 个 token,8B 的价格算下来是 0.00001 元。
- `print(f"{model:<28} {r.usage.total_tokens:>3} token` `{model:<28}` 左对齐占 28 格,模型名长短不一,对齐了好看;`r.usage.total_tokens` 是这一次请求的 token 数;`len(r.data[0].embedding)` 是向量的长度,也就是维度。

</div>

```bash
uv run python -m part04.token_compare
```

真实输出:

```text
字符数: 51
BAAI/bge-m3                   45 token  1024 维
BAAI/bge-large-zh-v1.5        49 token  1024 维
Qwen/Qwen3-Embedding-0.6B     37 token  1024 维
Qwen/Qwen3-Embedding-8B       37 token  4096 维
```

同一段 51 个字,bge-large-zh 切成 49 个 token,Qwen3 只要 37 个,差了三成。两个 Qwen3 用的是同一套分词器,所以 token 数一样,但 8B 默认给出 **4096 维**,正好撞上刚才说的 pgvector 2000 维索引上限。算钱时我统一按每字 0.9 个 token 估,偏保守,不同模型的真实数字只会更少。

## 第三笔账:1 万篇文章建一次索引多少钱

有了价格和 token 比例,就能算账了。价格是我 2026 年 10 月查的:硅基流动的 [价格页](https://siliconflow.cn/pricing) 上,bge-m3、bge-large-zh-v1.5 免费,Qwen3-Embedding 的 0.6B、4B、8B 分别是每百万 token 0.07、0.14、0.28 元;阿里云百炼的 text-embedding-v4 是每千 token 0.0005 元,也就是每百万 0.5 元;OpenAI 的 text-embedding-3-small 每百万 0.02 美元、3-large 0.13 美元。美元按 1 美元约 6.8 元粗算(美联储公布的 2026 年 6 月数据在 6.76 左右,写这篇时没查到 10 月的)。

假设 CloudLedger 长大了,帮助中心有 1 万篇文章,每篇 1500 字,[Day 224](/blog/agent-zero/day-224-chunking/) 会讲切块,这里先假设每 500 字切一块。新建 `part04/cost_10k.py`:

```python
# agent-zero-lab/part04/cost_10k.py
ARTICLES = 10_000
CHARS_PER_ARTICLE = 1_500
TOKENS_PER_CHAR = 0.9
CHUNK_CHARS = 500
USD_TO_CNY = 6.8

PRICES = {
    "硅基流动 BAAI/bge-m3": (0.0, 1024),
    "硅基流动 Qwen3-Embedding-0.6B": (0.07, 1024),
    "硅基流动 Qwen3-Embedding-8B": (0.28, 4096),
    "百炼 text-embedding-v4": (0.5, 1024),
    "OpenAI text-embedding-3-small": (0.02 * USD_TO_CNY, 1536),
    "OpenAI text-embedding-3-large": (0.13 * USD_TO_CNY, 3072),
}

tokens = ARTICLES * CHARS_PER_ARTICLE * TOKENS_PER_CHAR
chunks = ARTICLES * CHARS_PER_ARTICLE // CHUNK_CHARS
print(f"总字数 {ARTICLES * CHARS_PER_ARTICLE:,}  估算 token {tokens:,.0f}  切成 {chunks:,} 块")
for name, (price, dim) in PRICES.items():
    cost = tokens / 1_000_000 * price
    storage_mb = chunks * (4 * dim + 8) / 1024 / 1024
    print(f"{name:<32} {price:>5.3f} 元/百万  建一次 ¥{cost:>6.2f}  {dim:>4} 维  存储 {storage_mb:>6.1f} MB")

rag_prompt_tokens = 2_000
llm_price = 2.0
per_question = rag_prompt_tokens / 1_000_000 * llm_price
print(f"对比:每个问题把 {rag_prompt_tokens} token 资料塞给 DeepSeek,输入费 ¥{per_question:.4f},一天 1000 个问题 ¥{per_question * 1000:.2f}")
```

<div class="line-notes">

- `ARTICLES = 10_000` 文章数。脚本顶部这五个全大写的常量就是全部假设,想换场景只改这里。
- `TOKENS_PER_CHAR = 0.9` 比刚才实测的 0.83–0.88 略高,偏保守。
- `USD_TO_CNY = 6.8` 粗略汇率。
- `PRICES = {` 字典,键是模型名,值是元组 `(每百万 token 的价格, 默认维度)`。
- `"OpenAI text-embedding-3-small": (0.02 * USD_TO_CNY, 1536),` 美元价换成人民币,0.136 元。3-small 默认 1536 维,3-large 3072 维。
- `tokens = ARTICLES * CHARS_PER_ARTICLE * TOKENS_PER_CHAR` 10,000 × 1,500 × 0.9 = 13,500,000 个 token。
- `chunks = ARTICLES * CHARS_PER_ARTICLE // CHUNK_CHARS` `//` 是整除,相当于 JS 的 `Math.floor(a / b)`。1500 万字 ÷ 500 = 30,000 块。
- `print(f"总字数 {ARTICLES * CHARS_PER_ARTICLE:,}` f-string 里的 `:,` 给数字加千分位逗号,`15000000` 显示成 `15,000,000`,相当于 JS 的 `n.toLocaleString("en-US")`。
- `for name, (price, dim) in PRICES.items():` `.items()` 给出键和值,值是元组,用 `(price, dim)` 当场拆开。
- `cost = tokens / 1_000_000 * price` 费用 = token 数 ÷ 一百万 × 每百万的价格。0.6B 那行:13.5 × 0.07 = 0.945 元。
- `storage_mb = chunks * (4 * dim + 8) / 1024 / 1024` 按 pgvector 的公式算存储。1024 维:30,000 × 4,104 字节 ≈ 117.4 MB。
- `rag_prompt_tokens = 2_000` 对照组:回答一个问题时,把检索到的几块资料加问题拼成 prompt,大约 2000 token。
- `llm_price = 2.0` DeepSeek 未命中缓存时的输入价,每百万 2 元,和 `.env` 里 `LLM_PRICE=0.04,2,8` 的中间那个数一致(高峰价)。这里只算输入,输出另算。
- `per_question = rag_prompt_tokens / 1_000_000 * llm_price` 每个问题 0.004 元。

</div>

```bash
uv run python -m part04.cost_10k
```

真实输出:

```text
总字数 15,000,000  估算 token 13,500,000  切成 30,000 块
硅基流动 BAAI/bge-m3                 0.000 元/百万  建一次 ¥  0.00  1024 维  存储  117.4 MB
硅基流动 Qwen3-Embedding-0.6B        0.070 元/百万  建一次 ¥  0.95  1024 维  存储  117.4 MB
硅基流动 Qwen3-Embedding-8B          0.280 元/百万  建一次 ¥  3.78  4096 维  存储  469.0 MB
百炼 text-embedding-v4             0.500 元/百万  建一次 ¥  6.75  1024 维  存储  117.4 MB
OpenAI text-embedding-3-small    0.136 元/百万  建一次 ¥  1.84  1536 维  存储  176.0 MB
OpenAI text-embedding-3-large    0.884 元/百万  建一次 ¥ 11.93  3072 维  存储  351.8 MB
对比:每个问题把 2000 token 资料塞给 DeepSeek,输入费 ¥0.0040,一天 1000 个问题 ¥4.00
```

1500 万字的知识库,最贵的 OpenAI 3-large 建一次索引 12 元,最便宜的免费。而回答问题那一侧,一天 1000 个问题光输入费就 4 元,三天就超过了最贵的建索引。**embedding 的钱几乎可以忽略,RAG 真正的成本在后面把资料塞给大模型那一步**。这也是为什么 [Day 221](/blog/agent-zero/day-221-why-rag/) 讲 RAG 为什么存在时,核心论点是「只给模型看相关的那几段」。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="建一次索引的费用和每天回答问题的费用对比条形图">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">1 万篇文章(1500 万字):一次性 vs 每天</text>
<text x="20" y="62" fill="var(--ink-soft)">建索引 bge-m3</text>
<rect x="230" y="50" width="2" height="18" fill="var(--compute)"/>
<text x="240" y="64" fill="var(--ink)">¥0</text>
<text x="20" y="92" fill="var(--ink-soft)">建索引 Qwen3-0.6B</text>
<rect x="230" y="80" width="9" height="18" fill="var(--compute)"/>
<text x="246" y="94" fill="var(--ink)">¥0.95</text>
<text x="20" y="122" fill="var(--ink-soft)">建索引 百炼 v4</text>
<rect x="230" y="110" width="68" height="18" fill="var(--compute)"/>
<text x="305" y="124" fill="var(--ink)">¥6.75</text>
<text x="20" y="152" fill="var(--ink-soft)">建索引 OpenAI 3-large</text>
<rect x="230" y="140" width="119" height="18" fill="var(--compute)"/>
<text x="356" y="154" fill="var(--ink)">¥11.93</text>
<line x1="20" y1="172" x2="620" y2="172" stroke="var(--rule)" stroke-dasharray="4 4"/>
<text x="20" y="196" fill="var(--ink-soft)">回答问题 1 天</text>
<rect x="230" y="184" width="40" height="18" fill="var(--mem)"/>
<text x="278" y="198" fill="var(--ink)">¥4(1000 问 × 2000 token 输入)</text>
<text x="20" y="226" fill="var(--ink-soft)">回答问题 30 天</text>
<rect x="230" y="214" width="380" height="18" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="228" fill="var(--ink)">¥120,还没算输出费</text>
</g>
</svg>
<figcaption>琥珀色是建索引(只在文档变化时花),蓝色是调大模型回答(每个问题都花),条长按金额比例画,30 天那条按比例应更长,画到边就截了。选 embedding 模型时价格几乎不用考虑。</figcaption>
</figure>

钱不是挑 embedding 模型的主要理由,但别把这个结论推得太远:如果文档每天都在大量更新,要反复重建,或者你在做的是几十亿条数据的搜索引擎,这笔账就要重算了。课程里的规模,用免费的 bge-m3 完全够。

## 维度:砍掉四分之三会丢多少

Day 217 的练习 4 第一次用了 `dimensions` 参数,让 Qwen3-Embedding 直接返回 256 维的向量,当时只用了三句话。今天用 Day 218 那六句话,看 1024、256、64 三档维度下整张相似度矩阵的结构变没变。

新建 `part04/dims.py`:

```python
# agent-zero-lab/part04/dims.py
import os

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])
MODEL = "Qwen/Qwen3-Embedding-0.6B"

SENTENCES = [
    "年付套餐买错了能把钱要回来吗",
    "退款政策:年付套餐中途取消的,按剩余的整月数比例退款",
    "怎么申请退款",
    "发票抬头填错了怎么改",
    "导入银行流水时报错 E1042",
    "今天北京天气不错",
]

tokens = 0
for dim in [1024, 256, 64]:
    resp = client.embeddings.create(model=MODEL, input=SENTENCES, dimensions=dim)
    tokens += resp.usage.total_tokens
    v = np.array([d.embedding for d in sorted(resp.data, key=lambda d: d.index)])
    v = v / np.linalg.norm(v, axis=1, keepdims=True)
    sim = v @ v.T
    np.fill_diagonal(sim, -1)
    best = sim.argmax(axis=1)
    print(f"dim={dim:<5} 形状 {v.shape}  每行最像: {best.tolist()}  0-1: {sim[0, 1]:.4f}  0-5: {sim[0, 5]:.4f}")
print("一共 token:", tokens)
```

<div class="line-notes">

- `MODEL = "Qwen/Qwen3-Embedding-0.6B"` 硅基流动上支持 `dimensions` 的只有 Qwen3 系列,0.6B 最便宜。bge-m3 传这个参数会报 400,Day 217 练习 4 试过。
- `SENTENCES = [` Day 218 那六句,编号 0 到 5 不变。
- `for dim in [1024, 256, 64]:` 三档维度,每档一次请求。
- `resp = client.embeddings.create(model=MODEL, input=SENTENCES, dimensions=dim)` `dimensions` 告诉服务端「我只要这么长」。
- `tokens += resp.usage.total_tokens` 三次请求累加,最后打印。
- `v = v / np.linalg.norm(v, axis=1, keepdims=True)` 按行归一化,和 `common/embed.py` 的最后一行一样。
- `sim = v @ v.T` 6×6 相似度矩阵,Day 218 的那一行。
- `np.fill_diagonal(sim, -1)` 把对角线(自己和自己的 1)改成 -1,下一行找「最像的另一句」时就不会选中自己。Day 218 用的是 `argsort` 取第二名,这是另一种写法。
- `best = sim.argmax(axis=1)` 每一行最大值所在的列号,也就是每句话最像的另一句的编号。`axis=1` 表示沿着每一行找,得到 6 个数。
- `print(f"dim={dim:<5} 形状 {v.shape}` `best.tolist()` 把 numpy 数组转成普通列表,打印出来更干净;`sim[0, 1]` 是 0 号(客户问退款)和 1 号(退款政策原文)的相似度,这是我们最关心的一对;`sim[0, 5]` 是 0 号和天气句,一对该很低的。

</div>

```bash
uv run python -m part04.dims
```

真实输出:

```text
dim=1024  形状 (6, 1024)  每行最像: [1, 0, 0, 4, 3, 0]  0-1: 0.7699  0-5: 0.2680
dim=256   形状 (6, 256)  每行最像: [1, 0, 0, 4, 3, 2]  0-1: 0.7919  0-5: 0.2152
dim=64    形状 (6, 64)  每行最像: [1, 0, 0, 4, 3, 4]  0-1: 0.7820  0-5: 0.1207
一共 token: 171
```

读这三行:前五句「最像谁」在三档维度下一模一样(0 最像 1,1 和 2 都最像 0,发票和错误码互相最像),只有天气句那一格在变,而天气句本来就和谁都不像,它的「最像」是从一堆低分里挑的,没有意义。0 和 1 那一对三档都在 0.77 到 0.79,天气那对反而越来越低。维度砍到 64,每个向量从 4096 字节变成 256 字节,在这六句话上几乎没有损失。

顺便注意一个对比:Qwen3 上天气句和退款问题只有 0.27,bge-m3 在 Day 218 是 0.37。两个模型的分数区间不一样,这又一次说明「阈值要跟着模型定」。

### 为什么能直接砍维度

不是所有模型都能这么砍。Qwen3-Embedding、OpenAI 的 text-embedding-3 系列能砍,是因为它们训练时用了一种叫 **Matryoshka 表示学习**(MRL,俄罗斯套娃)的方法:训练时不仅要求完整的 1024 维好用,还要求前 512 维、前 256 维、前 64 维单独拿出来也好用。结果是重要的信息被「挤」到了向量的前面,后面的维度是在补细节,就像套娃,小的那个也是完整的一个娃娃。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="套娃式向量:前64维、前256维、前1024维各自都是一个可用的向量">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">一条 1024 维的 Qwen3 向量,从左往右是第 0 维到第 1023 维</text>
<rect x="20" y="50" width="600" height="30" rx="3" fill="none" stroke="var(--rule)"/>
<rect x="20" y="50" width="150" height="30" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="20" y="50" width="38" height="30" rx="3" fill="var(--mem)"/>
<text x="24" y="100" fill="var(--ink-soft)">前 64</text>
<text x="100" y="100" fill="var(--ink-soft)">前 256</text>
<text x="540" y="100" fill="var(--ink-soft)">全部 1024</text>
<text x="20" y="134" fill="var(--ink)">取前 k 维 → 除以长度归一化 → 一个能单独用的 k 维向量</text>
<text x="20" y="158" fill="var(--ink-soft)">64 维 256 字节 / 256 维 1024 字节 / 1024 维 4096 字节</text>
<text x="20" y="182" fill="var(--ink-soft)">只对用套娃方法训练的模型成立;bge-m3 不行</text>
</g>
</svg>
<figcaption>重要的信息被训练「挤」到了前面的维度,越往后越是补细节。所以截断前面一段,信息损失比你想象的小。</figcaption>
</figure>

所以服务端的 `dimensions=256` 其实就是「取前 256 维,再归一化」,练习 2 会亲手验证这一点。没用这种方法训练的模型(比如 bge-m3),你自己截断前 256 维,效果会差很多,所以硅基流动干脆不让 bge-m3 传这个参数。

### 故意踩坑:维度不是随便填的

`dimensions` 不是填多少都行。新建 `part04/dims_err.py`,先填一个 128,再填一个 100:

```python
# agent-zero-lab/part04/dims_err.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])

for dim in [128, 100]:
    resp = client.embeddings.create(model="Qwen/Qwen3-Embedding-0.6B", input=["怎么申请退款"], dimensions=dim)
    print(dim, "维:成功,拿到", len(resp.data[0].embedding), "个数")
```

<div class="line-notes">

- `for dim in [128, 100]:` 128 在支持列表里,100 不在。
- `dimensions=dim)` 第二轮传 100。
- `print(dim, "维:成功,拿到"` 第一轮会打印,第二轮走不到这一行。

</div>

```bash
uv run python -m part04.dims_err
```

真实输出(最后几行):

```text
128 维:成功,拿到 128 个数
...
openai.BadRequestError: Error code: 400 - {'code': 20015, 'message': 'The parameter is invalid. Please check again.', 'data': None}
```

还是 Day 217 那句熟悉的「参数无效」。硅基流动的文档列了每个模型允许的值:Qwen3-Embedding-0.6B 只能是 64、128、256、512、768、1024 之一,4B 最高到 2560,8B 最高到 4096。我还试了 32,同样 400,虽然 Qwen3 的模型卡上写的是 32 起。模型本身支持什么和某家平台开放什么,是两回事,以平台文档为准。

## 怎么读 MTEB 排行榜

账算完了,该说效果了。挑 embedding 模型,几乎所有人都会去看 [MTEB 排行榜](https://huggingface.co/spaces/mteb/leaderboard)。**MTEB** 是 Massive Text Embedding Benchmark 的缩写,一套公开的评测集合,2022 年发布,主要作者来自 Hugging Face(论文见学习资料),后来扩展到多语言。它把分类、聚类、检索、句子相似度等很多种任务放在一起,给每个模型打分排名。中文有一套单独的 **C-MTEB**,按 BGE 团队教程的说法,包含 6 类任务、35 个数据集(二手来源,见学习资料)。

排行榜页面的布局每年都会改,下面是我 2026 年 10 月去看时要找的几样东西,换了布局也按这个思路找:

**先选对榜。** 页面上方能切换基准,中文为主就选中文那套(名字里带 cmn 或 Chinese),中英混合选多语言的那套。别看英文榜挑中文模型。

**只看检索那一列。** 总分是各类任务的平均,里面混了分类、聚类,这些跟 RAG 关系不大。我们做的是「问题找文章」,看 Retrieval 那一列。

**看最大输入长度和维度。** 表里一般有 Max Tokens、Embedding Dimensions 这样的列。最大长度决定你的块能切多大(bge-large-zh 只有 512,Day 224 切块时会撞上);维度决定存储,以及 pgvector 那条 2000 维的线。

**看模型大小和能不能用 API 调。** 榜首常常是几十亿参数的模型,只能自己部署,要显卡。对我们这门课,有现成 API、价格合适的模型更实际。

**最后,也是最重要的:榜单分数是在公开数据集上测的。** 那些数据集大多是新闻、百科、学术问答,不是「年付买错了能退吗」这种客服口语。榜单能帮你把候选从几百个缩到三五个,不能替你做最后的决定。

举个具体的数:Qwen3-Embedding-8B 的模型卡写着,它在 MTEB 多语言榜上排第一(截至 2025 年 6 月 5 日,得分 70.58),中文 C-MTEB 上平均分 73.84。这是模型作者自己写的,属于二手数据。它真的在我们的数据上第一吗?下一节测。

## 在自己的数据上比一比

不用等 Day 255 的正式评估集,先造一份最小的:8 篇 CloudLedger 风格的短文档,6 个客户问题,每个问题标好正确答案是哪一篇,然后让四个模型各跑一遍,看正确答案排第几。

新建 `part04/own_eval.py`:

```python
# agent-zero-lab/part04/own_eval.py
import os

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])

DOCS = [
    "退款政策:年付套餐中途取消的,按剩余的整月数比例退款。",
    "月付套餐不支持退款,取消后当月仍可使用到月底。",
    "发票抬头填错了:在「账单 → 发票」申请作废,再重新开具。",
    "E1042:文件编码不是 UTF-8。用 Excel 另存为 CSV UTF-8 后重新上传。",
    "导入银行流水报错 E1043 怎么办?这是日期格式无法识别,请把日期列改成 YYYY-MM-DD。",
    "收不到重置密码的邮件:检查垃圾箱,或者把 noreply@cloudledger.cn 加入白名单。",
    "两步验证换手机:用备用码登录后,在「安全设置」里重新绑定。",
    "专业版和企业版的区别:企业版多了审批流、多账套和专属客服。",
]
QUESTIONS = [
    ("年付买错了能退钱吗", 0),
    ("按月付的能退款吗", 1),
    ("开票的时候公司名称写错了", 2),
    ("导入银行流水报错 E1042 怎么办", 3),
    ("找回密码的邮件一直没来", 5),
    ("换了新手机,验证码收不到登录不上", 6),
]
MODELS = ["BAAI/bge-m3", "BAAI/bge-large-zh-v1.5", "Qwen/Qwen3-Embedding-0.6B", "Qwen/Qwen3-Embedding-8B"]


def encode(model: str, texts: list[str]) -> tuple[np.ndarray, int]:
    resp = client.embeddings.create(model=model, input=texts)
    v = np.array([d.embedding for d in sorted(resp.data, key=lambda d: d.index)])
    return v / np.linalg.norm(v, axis=1, keepdims=True), resp.usage.total_tokens


for model in MODELS:
    doc_vecs, t1 = encode(model, DOCS)
    q_vecs, t2 = encode(model, [q for q, _ in QUESTIONS])
    scores = q_vecs @ doc_vecs.T
    ranks = []
    for row, (_, answer) in zip(scores, QUESTIONS):
        order = np.argsort(-row).tolist()
        ranks.append(order.index(answer) + 1)
    hit1 = sum(r == 1 for r in ranks)
    print(f"{model:<28} 命中第一 {hit1}/{len(QUESTIONS)}  正确答案的名次 {ranks}  token {t1 + t2}")
```

<div class="line-notes">

- `DOCS = [` 8 篇「文档」,下标 0 到 7。第 3、4 篇是 Day 219 那对 E1042 / E1043 反例,第 1 篇带「不支持」。
- `QUESTIONS = [` 每个元素是 `(问题, 正确文档的下标)`。问法故意和文档说法不同:「公司名称写错了」对「发票抬头填错了」,「验证码收不到」对「两步验证换手机」,考的是同义理解。
- `("导入银行流水报错 E1042 怎么办", 3),` Day 219 的反例原样放进来,看谁能扛住。
- `def encode(model: str, texts: list[str]) -> tuple[np.ndarray, int]:` 返回两个东西:归一化后的向量和这次用了多少 token。返回类型 `tuple[np.ndarray, int]` 就是「一个二元组,第一个是数组,第二个是整数」。
- `return v / np.linalg.norm(v, axis=1, keepdims=True), resp.usage.total_tokens` 逗号隔开的两个值会被打包成一个元组返回,调用方用 `a, b = encode(...)` 拆开。[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 学过「函数返回两个值」。
- `q_vecs, t2 = encode(model, [q for q, _ in QUESTIONS])` 推导式里 `q, _` 拆开每个元组,只要问题文本,下标用 `_` 占位不要。`_` 在 Python 里是「我不用这个变量」的约定写法。
- `scores = q_vecs @ doc_vecs.T` `(6, D) @ (D, 8)` 得 `(6, 8)`:每一行是一个问题对 8 篇文档的分数。D 是维度,bge 系列 1024,8B 是 4096。
- `for row, (_, answer) in zip(scores, QUESTIONS):` `zip` 把两个序列按位置配对,相当于同时遍历第 i 行分数和第 i 个问题。第一轮 `row` 是问题 0 的 8 个分数,`answer` 是 0。
- `order = np.argsort(-row).tolist()` 从高到低的文档下标顺序,转成普通列表。
- `ranks.append(order.index(answer) + 1)` `list.index(x)` 返回 x 在列表里的位置,相当于 JS 的 `indexOf`。正确答案在第 0 位就是第 1 名,所以加 1。
- `hit1 = sum(r == 1 for r in ranks)` `r == 1` 是真假值,`sum` 把 True 当 1 加起来,数出有几个第 1 名。相当于 JS 的 `ranks.filter(r => r === 1).length`。

</div>

```bash
uv run python -m part04.own_eval
```

真实输出:

```text
BAAI/bge-m3                  命中第一 5/6  正确答案的名次 [1, 1, 1, 2, 1, 1]  token 295
BAAI/bge-large-zh-v1.5       命中第一 5/6  正确答案的名次 [1, 1, 1, 2, 1, 1]  token 341
Qwen/Qwen3-Embedding-0.6B    命中第一 4/6  正确答案的名次 [2, 1, 1, 2, 1, 1]  token 248
Qwen/Qwen3-Embedding-8B      命中第一 4/6  正确答案的名次 [2, 1, 1, 2, 1, 1]  token 248
```

榜单第一的 Qwen3-Embedding-8B,在这 6 道题上输给了免费的 bge-m3:第一题「年付买错了能退钱吗」它把正确答案排到了第二。四个模型在 E1042 那题上全军覆没,都是第二名,Day 219 说这是单向量的共性,今天又看到一次。

这里有个要老实交代的地方:Qwen3-Embedding 的模型卡写着,**查询**前面要加一句任务说明(格式是 `Instruct: 任务描述\nQuery:问题`),文档不用加,不加的话效果会打折扣(作者说加了通常好 1% 到 5%)。上面我没加。练习 3 把它加上,结果会变。这本身就是今天最重要的教训之一:**榜单分数是按作者推荐的用法测出来的,你没按模型卡用,就拿不到那个分数**。

6 道题当然太少,一道题的差别不能说明谁更好。Day 255 到 Day 259 会建 30 条的正式评估集,算 recall 和 MRR。但即使只有 6 道,它也已经教会你两件事:榜单排名不能直接搬到你的数据上;换模型前,先在自己的题上跑一遍,一下午就够。

我自己的选法很朴素:中文为主,先用 bge-m3,免费、8192 token 长度、1024 维正好在 pgvector 索引上限以内;已经在用某家云,就用那家的 embedding,少一个供应商;英文为主,用 OpenAI 的 text-embedding-3-small。等评估集建起来,再把两三个候选在自己的题上跑一遍,用数据决定。

## 动手练习

**练习 1:半精度省多少。** pgvector 还有一种 `halfvec` 类型,每个数只用 2 字节,文档写的公式是 `2 × 维度 + 8`。改 `cost_10k.py`,给每个模型多打印一列 `halfvec` 下的存储,并标出哪些模型的默认维度超过了 `vector` 的 2000 维索引上限、但在 `halfvec` 的 4000 维上限以内。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_halfvec.py
from part04.cost_10k import PRICES, chunks

VECTOR_INDEX_MAX = 2_000
HALFVEC_INDEX_MAX = 4_000

for name, (_, dim) in PRICES.items():
    full_mb = chunks * (4 * dim + 8) / 1024 / 1024
    half_mb = chunks * (2 * dim + 8) / 1024 / 1024
    if dim <= VECTOR_INDEX_MAX:
        note = "vector 能建索引"
    elif dim <= HALFVEC_INDEX_MAX:
        note = "要用 halfvec 才能建索引"
    else:
        note = "两种都不行,要降维"
    print(f"{name:<32} {dim:>4} 维  vector {full_mb:>6.1f} MB  halfvec {half_mb:>6.1f} MB  {note}")
```

<div class="line-notes">

- `from part04.cost_10k import PRICES, chunks` 直接复用 `cost_10k.py` 里的价格表和块数。注意:import 一个模块会把它从头执行一遍,所以 `cost_10k.py` 的那几行 `print` 也会先打印出来。想避免,就像 Day 217 那样把打印放进 `if __name__ == "__main__":`。
- `VECTOR_INDEX_MAX = 2_000` pgvector 文档写的 `vector` 类型 HNSW / IVFFlat 索引上限。
- `HALFVEC_INDEX_MAX = 4_000` `halfvec` 的索引上限。
- `for name, (_, dim) in PRICES.items():` 价格这次用不上,用 `_` 占位。
- `half_mb = chunks * (2 * dim + 8) / 1024 / 1024` 半精度公式,每个数 2 字节。
- `if dim <= VECTOR_INDEX_MAX:` 三档判断,`elif` 相当于 JS 的 `else if`。

</div>

```bash
uv run python -m part04.ex_halfvec
```

真实输出(前 8 行是 import `cost_10k` 时它自己打印的,这里省略):

```text
硅基流动 BAAI/bge-m3                 1024 维  vector  117.4 MB  halfvec   58.8 MB  vector 能建索引
硅基流动 Qwen3-Embedding-0.6B        1024 维  vector  117.4 MB  halfvec   58.8 MB  vector 能建索引
硅基流动 Qwen3-Embedding-8B          4096 维  vector  469.0 MB  halfvec  234.6 MB  两种都不行,要降维
百炼 text-embedding-v4             1024 维  vector  117.4 MB  halfvec   58.8 MB  vector 能建索引
OpenAI text-embedding-3-small    1536 维  vector  176.0 MB  halfvec   88.1 MB  vector 能建索引
OpenAI text-embedding-3-large    3072 维  vector  351.8 MB  halfvec  176.0 MB  要用 halfvec 才能建索引
```

半精度正好省一半。Qwen3-8B 的 4096 维两种索引都超了,要么用 `dimensions` 降到 2048 以下,要么不建索引全量扫描。OpenAI 3-large 的 3072 维只能用 `halfvec`。这就是为什么「维度」要在选模型时就想好,而不是建表时才发现。

</details>

**练习 2:亲手验证套娃。** 用 Qwen3-Embedding-0.6B 编码同一句话两次:一次完整 1024 维,一次 `dimensions=256`。自己把完整向量取前 256 维再归一化,和服务端给的 256 维算余弦。如果真的是「取前面再归一化」,余弦应该是多少?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_truncate.py
import os

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])
MODEL = "Qwen/Qwen3-Embedding-0.6B"
TEXT = ["年付套餐买错了能把钱要回来吗"]

full = np.array(client.embeddings.create(model=MODEL, input=TEXT).data[0].embedding)
short = np.array(client.embeddings.create(model=MODEL, input=TEXT, dimensions=256).data[0].embedding)

mine = full[:256] / np.linalg.norm(full[:256])
print("完整向量长度:", round(float(np.linalg.norm(full)), 4), " 前 256 维的长度:", round(float(np.linalg.norm(full[:256])), 4))
print("服务端 256 维的长度:", round(float(np.linalg.norm(short)), 4))
print("自己截断再归一化 vs 服务端 256 维:", round(float(mine @ short), 6))
```

<div class="line-notes">

- `full = np.array(client.embeddings.create(model=MODEL, input=TEXT).data[0].embedding)` 不传 `dimensions`,拿到默认的 1024 维。一行里连着点了好几层属性,从左往右读:发请求 → 取 `data` 第 0 个 → 取 `embedding` → 转数组。
- `short = np.array(client.embeddings.create(model=MODEL, input=TEXT, dimensions=256)` 同一句话,要 256 维。
- `mine = full[:256] / np.linalg.norm(full[:256])` 切片取前 256 个数,再除以它自己的长度,归一化。
- `np.linalg.norm(full[:256])` 前 256 维的长度,实测 0.4938。完整向量长度是 1,只取一部分当然不到 1,所以必须重新归一化。
- `round(float(mine @ short), 6)` 两个 256 维单位向量的余弦。

</div>

```bash
uv run python -m part04.ex_truncate
```

真实输出:

```text
完整向量长度: 1.0  前 256 维的长度: 0.4938
服务端 256 维的长度: 1.0
自己截断再归一化 vs 服务端 256 维: 1.0
```

余弦是 1.0(保留六位小数都是 1),说明服务端的 `dimensions=256` 就是「取前 256 维再归一化」,没有别的魔法。还有一个有意思的数:前 256 维(四分之一的维度)的长度是 0.4938,平方是 0.24,也就是说长度上它只占四分之一左右,但检索效果几乎不掉。实用的推论是:如果你已经用 1024 维建了索引,想试试 256 维的效果,不用重新调接口,直接把存好的向量截断再归一化就行。前提是这个模型是用套娃方法训练的。

</details>

**练习 3:按模型卡用 Qwen3。** 给 `own_eval.py` 里 Qwen3 的**问题**加上任务说明 `Instruct: Given a customer question, retrieve the help center article that answers it\nQuery:`,文档不加,重新跑两个 Qwen3 模型。

<details><summary>参考答案</summary>

`own_eval.py` 里只改两处:`MODELS` 换成两个 Qwen3,问题的编码那一行加前缀。完整文件:

```python
# agent-zero-lab/part04/ex_qwen_instruct.py
import os

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])

DOCS = [
    "退款政策:年付套餐中途取消的,按剩余的整月数比例退款。",
    "月付套餐不支持退款,取消后当月仍可使用到月底。",
    "发票抬头填错了:在「账单 → 发票」申请作废,再重新开具。",
    "E1042:文件编码不是 UTF-8。用 Excel 另存为 CSV UTF-8 后重新上传。",
    "导入银行流水报错 E1043 怎么办?这是日期格式无法识别,请把日期列改成 YYYY-MM-DD。",
    "收不到重置密码的邮件:检查垃圾箱,或者把 noreply@cloudledger.cn 加入白名单。",
    "两步验证换手机:用备用码登录后,在「安全设置」里重新绑定。",
    "专业版和企业版的区别:企业版多了审批流、多账套和专属客服。",
]
QUESTIONS = [
    ("年付买错了能退钱吗", 0),
    ("按月付的能退款吗", 1),
    ("开票的时候公司名称写错了", 2),
    ("导入银行流水报错 E1042 怎么办", 3),
    ("找回密码的邮件一直没来", 5),
    ("换了新手机,验证码收不到登录不上", 6),
]
MODELS = ["Qwen/Qwen3-Embedding-0.6B", "Qwen/Qwen3-Embedding-8B"]
TASK = "Given a customer question, retrieve the help center article that answers it"


def encode(model: str, texts: list[str]) -> tuple[np.ndarray, int]:
    resp = client.embeddings.create(model=model, input=texts)
    v = np.array([d.embedding for d in sorted(resp.data, key=lambda d: d.index)])
    return v / np.linalg.norm(v, axis=1, keepdims=True), resp.usage.total_tokens


for model in MODELS:
    doc_vecs, t1 = encode(model, DOCS)
    q_vecs, t2 = encode(model, [f"Instruct: {TASK}\nQuery:{q}" for q, _ in QUESTIONS])
    scores = q_vecs @ doc_vecs.T
    ranks = []
    for row, (_, answer) in zip(scores, QUESTIONS):
        order = np.argsort(-row).tolist()
        ranks.append(order.index(answer) + 1)
    hit1 = sum(r == 1 for r in ranks)
    print(f"{model:<28} 命中第一 {hit1}/{len(QUESTIONS)}  正确答案的名次 {ranks}  token {t1 + t2}")
```

<div class="line-notes">

- `MODELS = ["Qwen/Qwen3-Embedding-0.6B", "Qwen/Qwen3-Embedding-8B"]` 只测两个 Qwen3,bge 系列不需要指令。
- `TASK = "Given a customer question, retrieve the help center article that answers it"` 任务描述。模型卡建议用英文写,因为训练时的指令大多是英文。
- `doc_vecs, t1 = encode(model, DOCS)` 文档原样编码,**不加**指令。模型卡原话是检索文档不需要加。
- `q_vecs, t2 = encode(model, [f"Instruct: {TASK}\nQuery:{q}" for q, _ in QUESTIONS])` 每个问题前面拼上 `Instruct: ...\nQuery:`。格式照抄模型卡里的 `get_detailed_instruct` 函数,`Query:` 后面没有空格。
- `print(f"{model:<28} 命中第一` 输出格式和 `own_eval.py` 一样,方便对比。

</div>

```bash
uv run python -m part04.ex_qwen_instruct
```

真实输出:

```text
Qwen/Qwen3-Embedding-0.6B    命中第一 5/6  正确答案的名次 [1, 1, 1, 2, 1, 1]  token 362
Qwen/Qwen3-Embedding-8B      命中第一 5/6  正确答案的名次 [1, 1, 1, 2, 1, 1]  token 362
```

加了一句话,第一题从第二名变回第一名,两个 Qwen3 和 bge-m3 打平。token 从 248 涨到 362,因为每个问题前面多了二十来个 token 的指令。这个练习说明两件事:一是用模型前先读模型卡的「Usage」部分,很多模型有自己的规矩(有的要求查询前加 `query: `,有的要求指令);二是在 6 道题上,四个模型其实分不出高下,要区分它们得有更大、更难的评估集。

</details>

**练习 4:维度砍到多少开始掉分。** 用加了指令的 Qwen3-Embedding-0.6B,在 `own_eval.py` 的 6 道题上分别试 1024、256、128、64 维,看每题正确答案的名次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_dim_eval.py
import os

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])
MODEL = "Qwen/Qwen3-Embedding-0.6B"
TASK = "Given a customer question, retrieve the help center article that answers it"

DOCS = [
    "退款政策:年付套餐中途取消的,按剩余的整月数比例退款。",
    "月付套餐不支持退款,取消后当月仍可使用到月底。",
    "发票抬头填错了:在「账单 → 发票」申请作废,再重新开具。",
    "E1042:文件编码不是 UTF-8。用 Excel 另存为 CSV UTF-8 后重新上传。",
    "导入银行流水报错 E1043 怎么办?这是日期格式无法识别,请把日期列改成 YYYY-MM-DD。",
    "收不到重置密码的邮件:检查垃圾箱,或者把 noreply@cloudledger.cn 加入白名单。",
    "两步验证换手机:用备用码登录后,在「安全设置」里重新绑定。",
    "专业版和企业版的区别:企业版多了审批流、多账套和专属客服。",
]
QUESTIONS = [
    ("年付买错了能退钱吗", 0),
    ("按月付的能退款吗", 1),
    ("开票的时候公司名称写错了", 2),
    ("导入银行流水报错 E1042 怎么办", 3),
    ("找回密码的邮件一直没来", 5),
    ("换了新手机,验证码收不到登录不上", 6),
]


def encode(texts: list[str], dim: int) -> np.ndarray:
    resp = client.embeddings.create(model=MODEL, input=texts, dimensions=dim)
    v = np.array([d.embedding for d in sorted(resp.data, key=lambda d: d.index)])
    return v / np.linalg.norm(v, axis=1, keepdims=True)


for dim in [1024, 256, 128, 64]:
    doc_vecs = encode(DOCS, dim)
    q_vecs = encode([f"Instruct: {TASK}\nQuery:{q}" for q, _ in QUESTIONS], dim)
    scores = q_vecs @ doc_vecs.T
    ranks = [np.argsort(-row).tolist().index(ans) + 1 for row, (_, ans) in zip(scores, QUESTIONS)]
    print(f"dim={dim:<5} 每个向量 {4 * dim:>5} 字节  名次 {ranks}  命中第一 {sum(r == 1 for r in ranks)}/6")
```

<div class="line-notes">

- `DOCS = [` 和 `QUESTIONS = [` 从 `own_eval.py` 复制过来。我没有 `from part04.own_eval import DOCS`,因为那个文件没有 `if __name__ == "__main__":`,import 它会把四个模型全跑一遍。
- `def encode(texts: list[str], dim: int) -> np.ndarray:` 这次模型固定,变的是维度。
- `resp = client.embeddings.create(model=MODEL, input=texts, dimensions=dim)` 文档和问题必须用**同一个维度**编码,不然 `@` 会报形状错误,Day 213 说过。
- `for dim in [1024, 256, 128, 64]:` 0.6B 允许的值里挑四档,64 是最小的。
- `ranks = [np.argsort(-row).tolist().index(ans) + 1 for row, (_, ans) in zip(scores, QUESTIONS)]` 把 `own_eval.py` 里的四行循环压成一行推导式。读法:对每一对(分数行, 问题),算正确答案的名次。
- `{4 * dim:>5} 字节` 每个向量的存储,1024 维 4096 字节,64 维 256 字节。

</div>

```bash
uv run python -m part04.ex_dim_eval
```

真实输出:

```text
dim=1024  每个向量  4096 字节  名次 [1, 1, 1, 2, 1, 1]  命中第一 5/6
dim=256   每个向量  1024 字节  名次 [1, 1, 1, 2, 1, 1]  命中第一 5/6
dim=128   每个向量   512 字节  名次 [1, 1, 1, 2, 1, 1]  命中第一 5/6
dim=64    每个向量   256 字节  名次 [1, 1, 1, 3, 1, 1]  命中第一 5/6
```

砍到 128 维,6 道题的名次一个没变;64 维时 E1042 那题从第 2 名掉到第 3 名,开始掉了。存储从 4096 字节降到 512 字节,省了八分之七。在这么小的数据上,我的结论只能是「128 维看起来够用」,真要上线,还是要在几十上百道题的评估集上比 recall 再定。课程里我们继续用 bge-m3 的 1024 维:它免费,1024 维在 pgvector 索引上限以内,存储也完全不是问题,没有降维的理由。

</details>

**验收标准:** 能不看文章说出「1024 维 float32 ≈ 4 KB」和「pgvector HNSW 最多 2000 维」两个数;`cost_10k.py` 跑通,并能改假设(比如 5 万篇、每篇 800 字)重算;`own_eval.py` 跑通,能解释为什么 Qwen3 不加指令会吃亏;能用一两句话说清「为什么 embedding 的钱不是挑模型的主要理由」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `ndarray.nbytes` | numpy 数组里的数据一共占多少字节,`(10000, 1024)` 的 `float32` 是 40,960,000 |
| `.npy` 文件 | numpy 自己的二进制存储格式,比数据本身多 128 字节的文件头,`np.save` / `np.load` 读写 |
| `halfvec` | pgvector 的半精度向量类型,每个数 2 字节,存储减半,索引上限 4000 维 |
| 维度上限 | pgvector 的 `vector` 类型能存 16,000 维,但 HNSW / IVFFlat 索引最多 2,000 维 |
| 输入 token 计费 | embedding 只收输入的钱,没有输出费。bge-m3 上中文约每字 0.85 个 token |
| `dimensions` 参数 | 让服务端返回更短的向量。硅基流动只有 Qwen3 系列支持,且只能取文档列出的几个值 |
| Matryoshka 表示学习(MRL) | 一种训练方法,让向量的前 k 维单独也好用,所以能直接截断。Qwen3-Embedding、OpenAI 3 系列用了 |
| MTEB | Massive Text Embedding Benchmark,公开的 embedding 评测集合和排行榜,覆盖检索、分类、聚类等任务 |
| C-MTEB | MTEB 的中文版,6 类任务 35 个数据集 |
| 模型卡(model card) | 模型作者写的说明页,讲用途、限制和正确用法,比如 Qwen3 的查询要加指令 |
| 查询指令(instruction) | 加在查询前面、告诉模型当前任务的一句话,Qwen3-Embedding 的格式是 `Instruct: ...\nQuery:...` |
| 命中第一(hit@1) | 正确答案排在第一名的题目占多少。`own_eval.py` 里的 `5/6` |

## 常见误区

**用 `float64` 存向量。** numpy 和 Python 默认都是 64 位,`np.array(resp.data[0].embedding)` 不指定类型就是 `float64`,存储翻倍,精度对检索没有任何好处。存之前 `.astype(np.float32)`。

**以为 embedding 很贵,花很多时间比价格。** 1500 万字的知识库,最贵的模型建一次 12 元;而回答问题一天 1000 问就是 4 元输入费。省钱的功夫要花在「塞给大模型的资料少一点」上,不是 embedding 上。

**选了 4096 维的模型,建表时才发现建不了索引。** pgvector 的 `vector` 索引上限 2000 维。Qwen3-Embedding-8B 默认 4096,OpenAI 3-large 3072,选模型时就要想好是降维还是用 `halfvec`。

**`dimensions` 随便填一个数。** 实测 Qwen3-0.6B 填 100 和 32 都是 400「参数无效」,只能取 64、128、256、512、768、1024。模型卡写的范围和平台开放的范围不一样,以平台文档为准。

**自己截断一个不是套娃训练的模型。** bge-m3 没用 MRL 训练,取前 256 维效果会差很多。能截断的前提是模型卡明确写了支持自定义维度或 MRL。

**直接按榜单排名选模型。** Qwen3-Embedding-8B 是多语言榜第一,在我们 6 道题上不加指令时输给了免费的 bge-m3。榜单用来缩小候选范围,最后一步在自己的数据上比。

**没读模型卡就下结论说某个模型不行。** 同一个 Qwen3,加一句查询指令,第一题就从第二名回到第一名。很多模型对查询有格式要求,不按要求用拿不到它的真实水平。

## 学习资料

### 文档与文章

- [硅基流动 · 价格页](https://siliconflow.cn/pricing):今天的 Qwen3-Embedding 价格就是从这里查的。页面按厂商分组,Qwen 那一组要点「展开更多」才看得到 embedding 模型。
- [硅基流动 · 创建嵌入请求](https://docs.siliconflow.cn/docs/api/embeddings-post):看 `dimensions` 参数下每个模型允许的取值列表,以及每个模型的最大输入 token。
- [阿里云百炼 · 文本向量](https://help.aliyun.com/zh/model-studio/embedding):text-embedding-v4 的价格(每千 token 0.0005 元)、可选维度(64 到 2048)和单批 10 条的限制。
- [OpenAI · 价格页](https://developers.openai.com/api/docs/pricing):找 Embeddings 那一栏,3-small、3-large 每百万 token 的美元价。
- [pgvector README](https://github.com/pgvector/pgvector):搜「4 * dimensions + 8」和「up to 2,000 dimensions」两处,今天的两个数都在这里。
- [Qwen3-Embedding-8B 模型卡](https://huggingface.co/Qwen/Qwen3-Embedding-8B):看 Usage 里的 `get_detailed_instruct` 函数和「加指令通常好 1% 到 5%」那句,以及 MTEB 分数表。
- [Muennighoff 等 · MTEB: Massive Text Embedding Benchmark(arXiv 2210.07316)](https://arxiv.org/abs/2210.07316):MTEB 的原始论文。读摘要,知道它有哪几类任务就够了。
- [BGE 教程 · C-MTEB](https://bge-model.com/tutorial/4_Evaluation/4.2.3.html):BGE 团队对中文评测集 C-MTEB 的介绍,6 类任务 35 个数据集的说法出自这里。
- [Hugging Face 博客 · Introduction to Matryoshka Embedding Models](https://huggingface.co/blog/matryoshka):用图讲清套娃训练为什么能让前几维单独可用,比论文好读。原始论文是 [Kusupati 等 · Matryoshka Representation Learning(arXiv 2205.13147)](https://arxiv.org/abs/2205.13147)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1spMX62EWu&autoplay=0&high_quality=1" title="RAG中Embedding 模型如何选择?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>安逸_i · RAG中Embedding 模型如何选择? · 9 分钟。把挑模型要看的几个维度过一遍,和今天「怎么读 MTEB 排行榜」那一节对照,看你同不同意他的排序。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1S8He6KEtL&autoplay=0&high_quality=1" title="【千问Embedding10】模型更大就更好?实测0.6B、4B、8B的质量、耗时与成本" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>转瞬之澜 · 【千问Embedding10】模型更大就更好?实测0.6B、4B、8B的质量、耗时与成本 · 8 分钟。作者在本地显卡上跑三个尺寸的 Qwen3-Embedding,把质量、耗时和向量文件大小分开算,和今天「大模型不一定在你的数据上更好」的结论能互相印证。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/0KUHkwkThyc" title="Stop Picking Embedding Models Off The MTEB Leaderboard" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · Stop Picking Embedding Models Off The MTEB Leaderboard · 英文,22 分钟。标题就是今天后半节的观点。Hamel 是做评测出名的工程师,第六部分讲评测时还会遇到他。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/djp4205tHGU" title="How to choose an embedding model" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Weaviate vector database · How to choose an embedding model · 英文,4 分钟。向量数据库厂商讲挑模型,短,适合当作今天的复习。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)。第 6 章讲检索算法时比较了关键词检索和 embedding 检索在效果和成本上的取舍,今天读这一小节,对照我们算的账。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024),中文版《图解大模型:生成式AI原理与实践》(人民邮电出版社,2025)。第 8 章讲语义搜索和 RAG,Day 218 推荐过。今天带着「怎么挑模型、怎么评」这个问题重读一遍,看书里的做法和我们的 `own_eval.py` 有什么不同。

### 开源项目与代码

- [embeddings-benchmark/mteb](https://github.com/embeddings-benchmark/mteb):MTEB 的代码仓库。README 里几行代码就能在本机跑某个基准,以后想在自己的数据上用 MTEB 的方式评测,从这里开始。
- [QwenLM/Qwen3-Embedding](https://github.com/QwenLM/Qwen3-Embedding):Qwen3-Embedding 的官方仓库,有各尺寸的评测结果和指令写法示例。
- [pgvector/pgvector](https://github.com/pgvector/pgvector):Day 229 起用的向量扩展,今天只看 README 里讲存储和索引上限的段落。

## 自测

**1. 50 万块、每块一个 1024 维 `float32` 向量,放在 numpy 里大约多大?存进 pgvector 呢?如果换成 Qwen3-Embedding-8B 的默认维度呢?**

<details><summary>答案</summary>

numpy:500,000 × 1024 × 4 = 2,048,000,000 字节,约 1.9 GB。pgvector:500,000 × (4 × 1024 + 8) = 2,052,000,000 字节,也约 1.9 GB,多出的 8 字节头几乎可以忽略。Qwen3-8B 默认 4096 维,存储变 4 倍,约 7.6 GB,而且超过了 pgvector `vector` 类型 2000 维的索引上限,建不了 HNSW 索引,要先用 `dimensions` 降维。

</details>

**2. 一个 80 万字的中文知识库,用百炼 text-embedding-v4(每百万 token 0.5 元)建一次索引大约多少钱?写出算式。**

<details><summary>答案</summary>

按每字 0.9 个 token 保守估:800,000 × 0.9 = 720,000 token;720,000 ÷ 1,000,000 × 0.5 = 0.36 元。实际 token 数会因模型的分词器不同而变,今天实测同一段话 bge-m3 是 45 个 token、Qwen3 是 37 个,百炼没有实测,所以只是估算。

</details>

**3. 为什么 Qwen3-Embedding 可以直接用 `dimensions=256`,而你自己把 bge-m3 的向量截成前 256 维效果会差很多?**

<details><summary>答案</summary>

Qwen3-Embedding 训练时用了 Matryoshka 表示学习,要求向量的前 k 维单独拿出来也好用,重要信息被集中到了前面。练习 2 实测,服务端的 256 维和「自己取前 256 维再归一化」余弦是 1.0,完全一样。bge-m3 没有这样训练,信息分散在全部 1024 维里,截断会丢掉大量信息,所以硅基流动也不允许给 bge-m3 传 `dimensions`。

</details>

**4. 同事看了 MTEB 排行榜,说「Qwen3-Embedding-8B 是第一,我们把 bge-m3 换掉吧」。你会问他哪几个问题?**

<details><summary>答案</summary>

看的是哪个榜(多语言、中文还是英文),看的是总分还是检索那一列;它默认 4096 维,我们 pgvector 的索引上限 2000 维,打算怎么处理;查询有没有按模型卡加指令;最关键的是,在我们自己的评估题上比过没有。今天 6 道题实测,不加指令时它输给 bge-m3,加了才打平。另外换模型意味着全量重建索引(Day 217 的铁律),要算进成本。

</details>

**5. 面试题:「你们的 RAG 系统的成本大头在哪里?embedding 模型选贵的还是便宜的?」**

<details><summary>答案</summary>

成本大头在生成那一侧,不在 embedding。我算过:1500 万字、1 万篇文章,embedding 建一次索引最便宜免费、最贵的 OpenAI 3-large 也就 12 元左右;而每个问题把约 2000 token 的检索结果送进 DeepSeek,输入费 0.004 元,一天 1000 个问题就是 4 元,一个月 120 元,还没算输出。所以 embedding 模型按效果选,价格基本不是因素,除非数据量到了几十亿条或者需要频繁全量重建。

降成本的手段应该放在生成侧:检索更准从而 top-k 可以取小,控制每块的长度,用 prompt caching 让系统提示和固定前缀命中缓存(Day 397),简单问题走便宜的模型。选 embedding 时真正要权衡的是效果(在自己的评估集上比)、最大输入长度、维度和数据库索引的兼容性,以及能不能用 API 还是要自己部署。

</details>

## 明天预告

明天是 [Day 221 · RAG 为什么存在:两条流水线](/blog/agent-zero/day-221-why-rag/)。这几天我们一直在练「找」:把文字变成向量、比相似度、知道它哪里会找错、花多少钱。明天退一步问,为什么要找?大模型不知道 CloudLedger 的退款规则,把整个帮助中心塞进 prompt 不行吗?你会亲手试一次「直接问」和「全塞进去」,算出全塞的账,然后画出 RAG 的两条流水线:文档变了才跑的索引线,和每个问题都要跑的查询线。
