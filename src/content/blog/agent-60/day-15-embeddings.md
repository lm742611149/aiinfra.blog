---
title: 'Day 15 · Embedding:把文字变成向量,余弦相似度手算一遍'
description: 'W3 第一天。搞懂 embedding 到底是什么,手算一遍余弦相似度,调通一个 embedding API,再用 CloudLedger 的客服问句做一张相似度矩阵,亲眼看到「我想把钱要回来」和「退款政策」挨得有多近。'
pubDate: 2026-10-12
regime: none
tags: ['embedding', 'cosine-similarity', 'rag', 'agent-60']
series: 'agent-60'
day: 15
lang: 'zh'
---

## 今天要解决的问题

W2 结束的时候,你手里已经有一个能调工具的命令行 Agent 了。它会算数、会读文件、会搜网页。可是如果你把它放到 CloudLedger 的客服岗位上,客户问一句「年付的话买错了能退吗」,它就只能瞎编,因为它根本没读过 CloudLedger 的退款政策。

这一周要解决的就是这个问题:怎么让 Agent 在回答之前,先从一堆文档里找到相关的那几段。

这套做法叫 **RAG**(Retrieval-Augmented Generation,检索增强生成),说白了就是「先查资料,再回答」,分三步:

1. **检索(Retrieval)**:拿用户的问题去文档库里搜,找出最相关的几段,比如「退款政策:年付中途取消按剩余月数比例退款」。
2. **增强(Augmented)**:把搜到的几段塞进 prompt,告诉模型「根据下面的资料回答」。
3. **生成(Generation)**:模型读着资料写答案,而不是凭记忆编。

打个比方:模型像一个聪明但没看过公司文档的新同事,RAG 就是每次回答前先帮他把相关的 wiki 页翻出来放在面前。第 1 步搜出来的那几段叫**召回**结果。「召回不准」就是该找到的没找到,或者找回来的不相关;第 1 步错了,模型读的资料就是错的,后面答得再好也没用,所以面试特别爱问。整个 W3 都围绕这件事,而第一块砖就是今天的 embedding。

今天结束时你应该能做到:

1. 用自己的话讲清楚 embedding 是什么,为什么它能让「怎么退钱」找到「退款政策」。
2. 不用电脑,手算两个三维向量的余弦相似度,并说出结果在什么范围、各代表什么。
3. 调通一个 OpenAI 兼容的 embedding 接口,拿到 1024 维的向量,知道钱怎么算。
4. 用 numpy 算出一组客服问句的相似度矩阵,并能解释哪几对高、哪几对低。
5. 说出 embedding 的两个典型短板(否定词和精确编号),为 Day 18 的混合检索埋下伏笔。

预计用时 3–4 小时,其中手算和读视频大概 1 小时,剩下都在写代码和做实验。前置:Day 1(token 是什么)、Day 2(uv 和 dotenv)、Day 3(环境变量切厂商)。

## 关键词搜索为什么不够

先说一个我在真实客服系统里见过的场景。帮助中心有一篇文章,标题叫《退款政策》,正文写着「年付套餐中途取消的,按剩余的整月数比例退款」。客户在搜索框里输入的是「买错了能把钱要回来吗」。

这两句话几乎一个词都不重合。「退款」没出现,「年付」没出现,「整月」也没出现。如果你的搜索是 `LIKE '%关键词%'` 或者 Elasticsearch 的默认分词匹配,这篇文章的得分就是零,客户看到的是「没有找到相关结果」。

人一眼就知道这两句话说的是一件事。我们想要的是让程序也能这样「看懂意思」。embedding 就是目前最实用的办法:把每段文字变成一串数字,意思相近的文字,数字也相近。然后「找相关文档」这件事就变成了「找离得最近的点」,这是计算机非常擅长的事情。

这里先打个预防针。embedding 不是万能的,关键词搜索也没有过时。Day 18 你会看到,遇到「错误码 E1042」这种东西,关键词搜索反而比 embedding 靠谱得多。生产系统几乎都是两者一起用。但今天我们先把 embedding 这一半弄明白。

## 向量是什么:先从二维说起

如果你高中数学还记得一点,向量就是一个带方向的箭头,写成一串数字。二维向量 `(3, 4)` 就是从原点出发,往右 3、往上 4 的那个箭头。

现在想象我们给每个词在一张平面图上找个位置,横轴代表「这东西有多像动物」,纵轴代表「这东西有多像交通工具」。那么:

- 「猫」大概在 `(0.9, 0.1)`
- 「狗」大概在 `(0.85, 0.15)`
- 「汽车」大概在 `(0.05, 0.95)`
- 「马」有点意思,既是动物也能骑,可能在 `(0.7, 0.5)`

猫和狗挨得很近,汽车离它们很远,马在中间。你看,只要位置摆得好,「意思像不像」就变成了「离得近不近」。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="二维平面上猫、狗、马、汽车四个词的位置,猫和狗挨得很近">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<line x1="80" y1="260" x2="600" y2="260" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="80" y1="260" x2="80" y2="30" stroke="var(--rule)" stroke-width="1.5"/>
<text x="600" y="282" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="end">像动物 →</text>
<text x="88" y="38" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">↑ 像交通工具</text>
<line x1="80" y1="260" x2="548" y2="234" stroke="var(--mem)" stroke-width="2"/>
<line x1="80" y1="260" x2="522" y2="221" stroke="var(--mem)" stroke-width="2"/>
<line x1="80" y1="260" x2="444" y2="130" stroke="var(--ink-faint)" stroke-width="1.5" stroke-dasharray="4 3"/>
<line x1="80" y1="260" x2="106" y2="53" stroke="var(--compute)" stroke-width="2"/>
<circle cx="548" cy="234" r="5" fill="var(--mem)"/>
<circle cx="522" cy="221" r="5" fill="var(--mem)"/>
<circle cx="444" cy="130" r="5" fill="var(--ink-soft)"/>
<circle cx="106" cy="53" r="5" fill="var(--compute)"/>
<text x="556" y="250" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">猫 (0.9, 0.1)</text>
<text x="470" y="210" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">狗 (0.85, 0.15)</text>
<text x="452" y="124" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">马 (0.7, 0.5)</text>
<text x="116" y="58" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">汽车 (0.05, 0.95)</text>
<text x="200" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">猫和狗的箭头几乎同向:夹角小 → 相似度高</text>
</svg>
<figcaption>一个手工摆的二维「词地图」。真实的 embedding 有上千个维度,每一维也不一定有人能解释的含义,但道理一样:意思近,箭头方向就近。</figcaption>
</figure>

真实世界里有两个不同。第一,维度不是 2,而是几百到几千。今天用的 `bge-m3` 是 1024 维,OpenAI 的 `text-embedding-3-small` 是 1536 维。第二,这些维度不是人手工设计的,是模型在海量文本上训练出来的。你没法指着第 387 维说「这一维代表退款」,它就是一堆数字,整体上恰好满足「意思近的文字,向量方向近」。

还有一点容易误会:embedding 不只是给单个词用的。早期的 word2vec 是一个词一个向量,现在我们用的 embedding 模型是把一整句、一整段(几百个字)压成一个向量。所以「买错了能把钱要回来吗」整句是一个 1024 维的点,《退款政策》那一段也是一个点,我们比较的是这两个点。

## 余弦相似度:手算一遍才算懂

「离得近」有好几种算法,RAG 里最常用的是余弦相似度(cosine similarity):看两个箭头之间夹角的余弦值。方向完全一样,夹角 0 度,余弦是 1;互相垂直,夹角 90 度,余弦是 0;方向完全相反,余弦是 -1。

公式长这样:

```text
cos(a, b) = (a · b) / (|a| × |b|)

a · b  = a1×b1 + a2×b2 + ... + an×bn      (点积:对应位置相乘再加起来)
|a|    = sqrt(a1² + a2² + ... + an²)       (长度)
```

别怕公式,直接拿三个三维向量算一遍。

```text
a = (1, 2, 2)
b = (2, 1, 2)
c = (-2, 1, 0)
```

先算 a 和 b:

- 点积:1×2 + 2×1 + 2×2 = 2 + 2 + 4 = 8
- |a| = sqrt(1 + 4 + 4) = sqrt(9) = 3
- |b| = sqrt(4 + 1 + 4) = sqrt(9) = 3
- cos(a, b) = 8 / (3 × 3) = 8/9 ≈ 0.889

再算 a 和 c:

- 点积:1×(-2) + 2×1 + 2×0 = -2 + 2 + 0 = 0
- 结果直接是 0,两个向量互相垂直,意思上「毫无关系」。

最后一个小问题:如果把 a 放大成 `(10, 20, 20)`,它和 b 的余弦相似度变不变?点积变成 80,|a| 变成 30,80 / (30 × 3) 还是 0.889。余弦只看方向,不看长度。这也是为什么大家喜欢它:一段长文和一段短文,只要讲的是同一件事,方向就接近,长度不应该影响判断。

这里有个工程上很有用的推论。如果你提前把所有向量都除以自己的长度(叫归一化,normalize),每个向量长度都变成 1,那么余弦相似度就等于点积,分母那一步可以省掉。向量库里存的几乎都是归一化以后的向量,检索时只算点积,快不少。很多 embedding API 返回的向量本身就已经归一化了,但不是全部,所以我习惯自己再归一化一次,多一行代码换一个确定性。

你可能还会在文档里看到另外两个距离:欧氏距离(L2,两点之间的直线距离)和内积(inner product,就是点积)。对归一化后的向量,三者的排序结果完全一致,只是数值方向不同:余弦和内积越大越近,欧氏距离越小越近。Day 17 在 pgvector 里你会看到 `<=>`(余弦距离)、`<->`(L2)、`<#>`(负内积)三个操作符,到时候别懵。

还有个数值范围的小坑。理论上余弦在 -1 到 1 之间,但现代 embedding 模型输出的句子向量,彼此的余弦相似度基本都落在 0.3 到 0.9 之间,很少出现负数。所以「0.5 算相关还是不相关」没有通用答案,换一个模型阈值就变。这件事我第一次做 RAG 时就踩过:在一个模型上调好的阈值 0.75,换模型后一条结果都召回不了。**不要依赖绝对阈值,依赖排序**,取前 k 个,这是 Day 16 的做法。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="余弦相似度与夹角的关系:同向为1,垂直为0,反向为-1">
<rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<line x1="60" y1="170" x2="170" y2="110" stroke="var(--mem)" stroke-width="2.5"/>
<line x1="60" y1="170" x2="180" y2="125" stroke="var(--mem)" stroke-width="2.5"/>
<text x="60" y="205" fill="var(--ink)">夹角小</text>
<text x="60" y="222" fill="var(--mem)">cos ≈ 0.89</text>
<line x1="270" y1="170" x2="380" y2="170" stroke="var(--mem)" stroke-width="2.5"/>
<line x1="270" y1="170" x2="270" y2="60" stroke="var(--compute)" stroke-width="2.5"/>
<rect x="270" y="158" width="12" height="12" fill="none" stroke="var(--ink-faint)"/>
<text x="270" y="205" fill="var(--ink)">垂直</text>
<text x="270" y="222" fill="var(--ink-soft)">cos = 0</text>
<line x1="510" y1="130" x2="600" y2="130" stroke="var(--mem)" stroke-width="2.5"/>
<line x1="510" y1="130" x2="420" y2="130" stroke="var(--compute)" stroke-width="2.5"/>
<circle cx="510" cy="130" r="3" fill="var(--ink)"/>
<text x="460" y="205" fill="var(--ink)">反向</text>
<text x="460" y="222" fill="var(--compute)">cos = -1</text>
<text x="60" y="35" fill="var(--ink-soft)">余弦相似度只看方向,不看长度。实际句向量之间多在 0.3–0.9。</text>
</g>
</svg>
<figcaption>三种典型夹角。左边是今天手算的 a 和 b,中间是 a 和 c。右边的完全反向在句子 embedding 里几乎见不到。</figcaption>
</figure>

## 选一个 embedding 服务

先说一个会让人困惑的事实:W1 默认用的 DeepSeek 没有 embedding 接口。我 2026 年 10 月去看了 [DeepSeek API 文档](https://api-docs.deepseek.com/),只有 chat completions。所以 W3 起,你的 `.env` 里要多一组配置,专门给 embedding 用:

```bash
# agent-60-lab/.env  (在 W1 的 LLM_* 基础上新增)
EMB_BASE_URL=https://api.siliconflow.cn/v1
EMB_API_KEY=sk-xxxx
EMB_MODEL=BAAI/bge-m3
EMB_DIM=1024
EMB_BATCH=10
```

我推荐三个选择,按国内朋友的方便程度排:

硅基流动(SiliconFlow)上的 `BAAI/bge-m3`。我 2026-10-12 查了它的[价格页](https://siliconflow.cn/pricing),标准版的 `BAAI/bge-m3` 和 `BAAI/bge-reranker-v2-m3` 都标着免费(带 `Pro/` 前缀的是付费版,¥0.07/百万 token)。接口是 OpenAI 兼容的,base_url 就是上面那个。bge-m3 是智源开源的多语言模型,中文效果好,输入最长 8192 token,输出 1024 维。课程默认用它,因为免费、中文好、Day 18 的 rerank 也在同一家。免费的东西随时可能改规则,用之前自己再看一眼价格页。

阿里云百炼的 text-embedding 系列。2026-10 我在[百炼 embedding 文档](https://help.aliyun.com/zh/model-studio/embedding)上看到 `text-embedding-v4` 是 0.5 元/百万 token,维度可选 64 到 2048,默认 1024,单批最多 10 条;页面上还列了更新的 `qwen3.7-text-embedding` 和更便宜的 flash 版。百炼的 base_url 现在要带业务空间 ID,以控制台给你的为准。如果你公司本来就在阿里云上,选它省事。

OpenAI 的 `text-embedding-3-small`。1536 维,海外朋友直接用。[OpenAI embedding 指南](https://platform.openai.com/docs/guides/embeddings)写得很清楚,还讲了怎么用 `dimensions` 参数把维度截短。

三家都走 `openai` SDK 的 `client.embeddings.create`,换厂商只改 `.env`。这就是 Day 3 讲的 OpenAI 兼容协议的好处在 W3 又兑现了一次。

**一个规矩:索引和查询必须用同一个模型。** 用 bge-m3 给文档建的向量,查询时也得用 bge-m3 编码问题。不同模型的向量空间完全不同,混着比就像拿北京的经纬度去对上海的门牌号,算出来的数字没有任何意义,而且不会报错,这才是最坑的地方。

## 写一个 embed 函数

先把依赖装上。W3 所有代码放在 `agent-60-lab/w3/` 下面:

```bash
cd agent-60-lab
uv add openai numpy python-dotenv
mkdir -p w3
```

```python
# agent-60-lab/w3/embed.py
"""W3 共用的 embedding 封装。环境变量见 .env 的 EMB_* 一组。"""
import os

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

_client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])
EMB_MODEL = os.environ.get("EMB_MODEL", "BAAI/bge-m3")
EMB_BATCH = int(os.environ.get("EMB_BATCH", "10"))  # 百炼单批上限 10,硅基流动更宽松,取小的最保险

total_tokens = 0  # 粗略记账,用来算钱


def embed(texts: list[str]) -> np.ndarray:
    """把一批文本变成归一化后的向量,形状 (len(texts), 维度)。"""
    global total_tokens
    vectors: list[list[float]] = []
    for start in range(0, len(texts), EMB_BATCH):
        batch = [t.replace("\n", " ").strip() or " " for t in texts[start:start + EMB_BATCH]]
        resp = _client.embeddings.create(model=EMB_MODEL, input=batch)
        # 按 index 排序,防止服务端打乱顺序(规范里说按序返回,但我不想赌)
        vectors.extend(d.embedding for d in sorted(resp.data, key=lambda d: d.index))
        if resp.usage:
            total_tokens += resp.usage.total_tokens
    arr = np.asarray(vectors, dtype=np.float32)
    return arr / np.linalg.norm(arr, axis=1, keepdims=True)


def embed_one(text: str) -> np.ndarray:
    return embed([text])[0]


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """两个向量的余弦相似度。对 embed() 返回的向量,它就等于点积。"""
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


if __name__ == "__main__":
    v = embed_one("年付套餐买错了能退款吗")
    print("维度:", v.shape[0])
    print("前 5 个数:", np.round(v[:5], 4))
    print("长度(归一化后应为 1):", round(float(np.linalg.norm(v)), 6))
    print("本次消耗 token:", total_tokens)
```

**`embed()` 逐行在干什么:**

- `global total_tokens`:要修改文件顶部的全局变量。Python 在函数里给变量赋值时默认当成新的局部变量,不写 `global` 的话 `+=` 会报 `UnboundLocalError`(TS 函数里直接改外层 `let` 没这个限制)。
- `for start in range(0, len(texts), EMB_BATCH)`:分批,`range(0, 25, 10)` 产生 0、10、20,相当于 `for (let start = 0; start < texts.length; start += EMB_BATCH)`。embedding 接口一次能收的条数有上限,一次全发会报错。
- `[t.replace("\n", " ").strip() or " " for t in texts[start:start + EMB_BATCH]]`:取这一批并逐条清洗,相当于 `texts.slice(start, start + EMB_BATCH).map(t => t.replaceAll("\n", " ").trim() || " ")`。换行换成空格;清洗后变成空字符串就用一个空格代替,很多接口传空字符串会报 400(空字符串在 Python 里算「假」,`"" or " "` 得到 `" "`,和 JS 的 `||` 一样)。
- `sorted(resp.data, key=lambda d: d.index)`:按 `index` 排序,保证第 i 个向量对应第 i 条输入。顺序一旦乱了,检索结果全错还很难发现。`lambda d: d.index` 就是 `d => d.index`;`extend` 相当于 `push(...xs)`。
- `np.asarray(vectors, dtype=np.float32)`:嵌套列表转成 numpy 数组才能做矩阵运算,`float32` 比默认 `float64` 省一半内存,向量精度够用。
- `arr / np.linalg.norm(arr, axis=1, keepdims=True)`:归一化,把每个向量长度缩放成 1。`axis=1` 是按行算长度;`keepdims=True` 让结果保持 `(N, 1)` 形状,`(N, 1024)` 除以 `(N, 1)` 时每一行自动除以自己的长度(numpy 的「广播」)。归一化后余弦相似度就等于点积,后面一次矩阵乘法就能算出问题和所有文档的相似度。

跑一下:

```bash
uv run python w3/embed.py
```

输出大致长这样(具体数字每个模型都不一样,不用对):

```text
维度: 1024
前 5 个数: [-0.0213  0.0087 -0.0451  0.0132  0.0298]
长度(归一化后应为 1): 1.0
本次消耗 token: 10
```

几个细节解释一下。换行替换成空格,是 OpenAI 早期文档的建议,对新模型影响很小,但不伤害什么。空字符串换成一个空格,因为有的服务收到空串会直接返回 400,我在批量导入时被一篇空文档卡过半小时。`sorted(... key=index)` 是防御性写法。最后统一归一化,后面所有地方都可以直接用点积。

## 实验:一张相似度矩阵

光看一个向量没意思,比较才有意思。我们拿 CloudLedger 客服场景的几句话,算两两之间的相似度:

```python
# agent-60-lab/w3/sim_matrix.py
import numpy as np

from embed import embed

SENTENCES = [
    "年付套餐买错了能把钱要回来吗",       # 0 口语化的退款问题
    "退款政策:年付套餐中途取消的,按剩余的整月数比例退款",  # 1 帮助中心原文
    "怎么申请退款",                       # 2 短问题
    "发票抬头填错了怎么改",               # 3 发票
    "导入银行流水时报错 E1042",           # 4 错误码
    "今天北京天气不错",                   # 5 无关
]

vecs = embed(SENTENCES)
sim = vecs @ vecs.T  # 归一化后,矩阵乘法一次算出所有两两点积 = 余弦相似度

np.set_printoptions(precision=2, suppress=True)
print(sim)

# 每句话找出最像它的另一句
for i, s in enumerate(SENTENCES):
    order = np.argsort(-sim[i])
    j = next(k for k in order if k != i)
    print(f"[{i}] {s[:16]:<16} 最像 [{j}] {SENTENCES[j][:16]}  ({sim[i, j]:.2f})")
```

运行方式是 `uv run python w3/sim_matrix.py`(在 `agent-60-lab` 根目录)。注意这里**不要**用 W2 习惯的 `-m w3.sim_matrix`:脚本里写的是 `from embed import embed`,直接按文件路径运行时 Python 会把 `w3/` 加进搜索路径,所以找得到 `embed.py`;用 `-m` 运行时搜索路径是根目录,会报 `ModuleNotFoundError: No module named 'embed'`。

`vecs @ vecs.T` 这一行值得停一下。`vecs` 形状是 `(6, 1024)`,转置后 `(1024, 6)`,相乘得到 `(6, 6)` 的矩阵,第 i 行第 j 列就是第 i 句和第 j 句的点积。因为已经归一化,这就是余弦相似度。对角线全是 1(自己和自己)。Day 16 检索的时候,你会写一模一样的东西,只不过一边是 1 个问题,另一边是几百个文档块。

你大致会看到这样的规律(我不给具体数字,因为模型不同数字会差很多,你自己跑出来记在下面的表里):

- 0、1、2 三句两两之间的相似度明显高于它们和 3、4、5 的相似度。这就是 embedding 的价值:「把钱要回来」和「退款」没有一个字重合,但被放到了一起。
- 3(发票)和 4(错误码)跟退款那几句有一点相似,因为都是「软件客服」语境,但比 0/1/2 之间低。
- 5(天气)跟谁都最低。

我 2026-10-17 用硅基流动的 bge-m3 实跑的结果,供你对照(你的数字只要大致规律一样就行):

```text
[[1.   0.74 0.69 0.63 0.52 0.37]
 [0.74 1.   0.69 0.51 0.43 0.39]
 [0.69 0.69 1.   0.59 0.53 0.41]
 [0.63 0.51 0.59 1.   0.55 0.39]
 [0.52 0.43 0.53 0.55 1.   0.33]
 [0.37 0.39 0.41 0.39 0.33 1.  ]]
```

规律基本成立:0/1/2 互相最像,天气句跟谁都最低(0.33–0.41)。但有一处出乎意料:0 ↔ 3(「年付套餐**买错了**…」和「发票抬头**填错了**…」)是 0.63,比 2 ↔ 3 还高,和 0 ↔ 2 的 0.69 只差一点。两句都是「客户填错 / 买错东西想补救」的口吻,embedding 把这种语气也算进了相似度。这说明「同一话题」和「有点像」之间的分差往往只有零点零几,**不能靠一个固定阈值区分相关和不相关**,只能看排序。另外,打印时 `{s[:16]:<16}` 按字符数补空格,中文字符显示宽度是英文的两倍,所以输出的列会对不齐,这不是 bug。

| 句子对 | 你测到的相似度 | 符合预期吗 |
| --- | --- | --- |
| 0 ↔ 1 |  |  |
| 0 ↔ 2 |  |  |
| 0 ↔ 3 |  |  |
| 0 ↔ 5 |  |  |
| 4 ↔ 5 |  |  |

## embedding 的两个短板

如果 embedding 什么都能搞定,W3 就不需要后面六天了。它有两个硬伤,做客服 Agent 一定会撞上。

第一,否定和数字不敏感。 试试这两句:

```python
from embed import embed
a, b = embed(["企业版支持按比例退款", "企业版不支持按比例退款"])
print(float(a @ b))
```

意思完全相反,但只差一个「不」字。在很多模型上,这两句的相似度会非常高,往往比「企业版支持按比例退款」和「年付可以退钱吗」还高。我用 bge-m3 实测:「支持」和「不支持」两句是 0.906,而「企业版支持按比例退款」和「年付可以退钱吗」只有 0.741。因为 embedding 学的是「这段话在聊什么话题」,话题完全一样。对检索来说这其实问题不大,两段都会被召回,然后由大模型读原文判断;但如果你想用相似度直接当答案(比如「相似度 > 0.9 就认为是同一个问题」),就会出事。

第二,专有名词、编号、错误码。 embedding 对编号不是完全没感觉。我用 bge-m3 测过:问「E1042 是什么错」,两篇正文完全一样、只有编号不同的文章,E1042 那篇 0.691,E1043 那篇 0.628,方向是对的。但 0.06 的差距太小,只要错误那篇文章**措辞更像问题**,就会被压过去:

```python
from embed import embed
q, d42, d43 = embed(["导入银行流水报错 E1042 怎么办",
                     "E1042:文件编码不是 UTF-8。用 Excel 另存为 CSV UTF-8 后重新上传。",
                     "导入银行流水报错 E1043 怎么办?这是日期格式无法识别,请把日期列改成 YYYY-MM-DD。"])
print(float(q @ d42), float(q @ d43))  # 我实测:0.651  0.799
```

正确答案 E1042 那篇只有 0.651,写法和问题几乎一样的 E1043 那篇有 0.799,排在了第一。客户问 E1042,向量检索把 E1043 的解决办法递给了模型。这种场景关键词匹配是精确的:「E1042」这个词只出现在正确那篇里。这就是 Day 18 要讲混合检索(BM25 + 向量)的原因。

把这两个短板记住,它们会反复出现在面试里。被问到「RAG 召回不准怎么办」,能举出这两个具体例子的人,和只会说「换个更好的 embedding 模型」的人,面试官一听就分得出来。完整的回答可以按三层说:先举具体的失败例子(否定词、错误码);再说怎么定位,建检索评估集量出到底哪类问题召回不准(Day 19);最后说手段:调整切块(Day 16)、向量加关键词的混合检索和 rerank 重排序(Day 18)、改写用户的问题。

## 维度、存储和钱

做工程得会算账。三笔账:

存储。 一个 1024 维的 float32 向量,占 1024 × 4 = 4096 字节,约 4 KB。CloudLedger 帮助中心假设切成 1,000 个块,向量总共 4 MB,完全不是问题。如果是一家大公司的知识库,100 万个块,就是 4 GB,内存里放得下,但已经要认真考虑索引了(Day 17)。pgvector 文档里写的是每个向量占 `4 × 维度 + 8` 字节,多出来的 8 字节是头信息。

钱。 embedding 按输入 token 计费。中文在 bge-m3 这类模型的分词器里,大致 1 个汉字算 0.6 到 1 个 token(不同模型差别不小,Day 1 讲过中文费 token 的原因)。保守按 1 字 1 token 算,100 万字的知识库就是 100 万 token。按百炼 text-embedding-v4 的 0.5 元/百万 token,建一次索引 0.5 元;用硅基流动的免费版就是 0 元。比起 Day 3 里大模型生成的价格,embedding 便宜到可以忽略。真正贵的是 Day 16 把检索结果塞进 prompt 让大模型读,那部分按 chat 模型价格算。

维度。 维度高不一定好。高维向量存储、计算都更贵,而且效果提升常常很有限。OpenAI 和百炼都支持你指定更小的维度(比如 512)。我的建议是课程里就用默认的 1024,先跑通,等 Day 19 有了评估集,再去试降维对效果的影响,用数据说话。还有一个硬约束要提前知道:Day 17 的 pgvector,`vector` 类型的 HNSW 索引最多支持 2000 维。如果你选了 2048 维,建索引会直接失败,这个坑放到 Day 17 细讲。

## 怎么挑模型:看榜单,但别信榜单

挑 embedding 模型,大家都会去看 [MTEB 排行榜](https://huggingface.co/spaces/mteb/leaderboard)(Massive Text Embedding Benchmark),中文看 C-MTEB 那部分。看的时候注意四件事:

1. 只看 Retrieval 那一列,不要看总平均分。总分里混了分类、聚类等任务,跟 RAG 关系不大。
2. 看最大输入长度。 有的模型只吃 512 token,你的文档块切得太长,超出部分会被静默截断,后半段内容等于没进索引。bge-m3 是 8192,比较宽裕。
3. 看模型大小和部署方式。 榜首经常是几十亿参数的大模型,只能自己部署。对我们这门课,有现成 API 的模型更实际。
4. 最重要的:榜单分数是在公开数据集上测的,不代表在你的数据上好用。 我见过榜单差 5 分的两个模型,在一个具体的客服知识库上效果几乎一样。Day 19 我们会建自己的检索评估集,到时候换模型、换维度都在自己的数据上比。

我自己的选择逻辑很朴素:中文为主,先用 bge-m3;已经在用某家云,就用那家的 embedding;英文为主,用 OpenAI 的 3-small。等评估集建起来,再花一下午把两三个候选都跑一遍。

## 动手练习

**练习 1:手算(不许用电脑)。** 设 `p = (3, 0, 4)`,`q = (0, 5, 0)`,`r = (6, 0, 8)`。分别算 cos(p, q) 和 cos(p, r),再说说 r 和 p 是什么关系。答案在自测第 1 题。

**练习 2:跑通 embed.py。** 按上面配置 `.env`,`uv run python w3/embed.py` 输出维度 1024、长度 1.0。如果报 401,检查 `EMB_API_KEY`;报 404 或「model not found」,检查 `EMB_MODEL` 拼写,硅基流动的模型名是带组织前缀的 `BAAI/bge-m3`。

**练习 3:相似度矩阵。** 跑 `sim_matrix.py`,把结果填进上面的表。然后自己加 4 句话进去:两句意思一样但说法完全不同的,两句话题一样但意思相反的。看看 embedding 对哪种更敏感。

**练习 4:换厂商对比。** 如果你有两家的 key(比如硅基流动和百炼),把 `.env` 切过去重跑同一组句子。注意观察两点:同一对句子的相似度绝对值差多少;每句「最像谁」的排序变没变。你大概率会发现绝对值差很多,排序大体一致。这正好印证了「别信阈值,信排序」。

**练习 5(选做):手写余弦,和 numpy 对账。** 不用 numpy,只用 Python 的 for 循环写一个 `cosine_py(a, b)`,用 `embed()` 拿到的两个 1024 维向量(先 `.tolist()`)算一遍,和 `float(a @ b)` 对比,误差应该在 1e-6 量级。写这个的意义是让你确信 numpy 一行代码背后没有魔法。

**验收标准:** 练习 1 算对;`embed.py` 跑通;相似度矩阵里 0/1/2 三句互相之间的相似度高于它们和第 5 句的;你能对着自己的矩阵,讲清楚哪一对出乎意料、你猜是为什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| embedding(嵌入/向量化) | 把一段文字变成一串固定长度的浮点数,意思近的文字得到方向近的向量 |
| 向量(vector) | 一串有顺序的数字,可以看成高维空间里的一个箭头或一个点 |
| 维度(dimension) | 向量里数字的个数,bge-m3 是 1024 |
| 余弦相似度 | 两个向量夹角的余弦,1 表示同向,0 表示无关,只看方向不看长度 |
| 点积(dot product) | 对应位置相乘再求和;向量归一化后它就等于余弦相似度 |
| 归一化(normalize) | 把向量除以自己的长度,让长度变成 1 |
| 欧氏距离(L2) | 两点之间的直线距离,越小越近 |
| bge-m3 | 智源(BAAI)开源的多语言 embedding 模型,中文效果好,最长 8192 token |
| MTEB / C-MTEB | 文本 embedding 的公开评测榜单,C-MTEB 是中文部分 |
| 向量空间 | 一个 embedding 模型输出的所有向量所在的空间,不同模型的空间不能混用 |

## 常见误区

**把相似度当成概率。** 0.8 不代表「80% 相关」。它只是一个夹角余弦,不同模型的分布完全不同。拿来排序可以,拿来当绝对判断要先在自己数据上校准。

**索引和查询用了不同模型。** 最常见的场景是:建索引时用了 OpenAI,后来为了省钱查询换成 bge-m3,检索结果突然变成随机的,还不报错。换模型就必须全量重建索引。

**以为维度越高越准。** 维度只是容量,效果取决于模型训练得好不好。2048 维的模型不一定比 1024 维的好,而且存储和计算翻倍,pgvector 的 HNSW 还建不了。

**以为 embedding 能处理精确匹配。** 订单号、错误码、产品型号,这些东西用 embedding 找基本靠运气。要靠 Day 18 的关键词检索兜底。

**一段文字太长也照塞。** 超过模型最大输入长度的部分会被截断,有的服务直接报错,有的悄悄截断。悄悄截断最危险,你以为整篇进了索引,其实只有开头。Day 16 的切块就是为了解决这个。

**每次查询都重新给所有文档算 embedding。** 文档向量算一次存起来,查询时只算问题那一个。听起来理所当然,但我真见过有人在 for 循环里每次都把整个知识库重新 embed 一遍,一个问题花几十秒。

## 学习资料

### 文档与文章

- [OpenAI Embeddings 指南](https://platform.openai.com/docs/guides/embeddings):讲了 embedding 的用途、距离函数选择、`dimensions` 降维参数。20 分钟读完,即使你不用 OpenAI 也值得读。
- [BAAI/bge-m3 模型卡](https://huggingface.co/BAAI/bge-m3):看它支持的三种检索方式(稠密、稀疏、多向量)和最大长度,Day 18 会再回来。
- [阿里云百炼 · 文本向量模型](https://help.aliyun.com/zh/model-studio/embedding):国内用百炼的朋友看这里的模型列表、维度选项和价格。
- [硅基流动价格页](https://siliconflow.cn/pricing):确认 bge-m3 和 bge-reranker 当前是否还免费。
- [MTEB 排行榜](https://huggingface.co/spaces/mteb/leaderboard):按上面讲的四点去看,只看 Retrieval。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oNv8BPE2m&autoplay=0&high_quality=1" title="15分钟弄懂Token和Embedding -- 详解LLM与RAG的数据处理机制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · 15分钟弄懂Token和Embedding -- 详解LLM与RAG的数据处理机制 · 全看,把 Day 1 的 token 和今天的 embedding 串起来,讲得很直白。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV13z421U7cs&autoplay=0&high_quality=1" title="【官方双语】GPT是什么?直观解释Transformer | 深度学习第5章" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · 【官方双语】GPT是什么?直观解释Transformer | 深度学习第5章 · 只看讲词嵌入(word embedding)的那一段,大约在视频中段,「国王-男人+女人≈女王」那个动画是理解「方向代表含义」最好的画面。</figcaption>
</figure>

- 过拟合青年《【硬核】Embedding:AI 如何把万物变成向量》(BV1tgSdBoEsL,12 分钟):想多看一个角度可以看,讲得更偏原理。
- Forrest的数据科学站《Embedding是什么?有什么作用?是怎么得到的?》(BV13ndBYuExm,33 分钟):想知道 embedding 是怎么训练出来的再看,不看也不影响后面。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/gQddtTdmG_8" title="Vectoring Words (Word Embeddings) - Computerphile" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Computerphile · Vectoring Words (Word Embeddings) · 17 分钟,一个研究者对着纸讲词向量的由来,老视频但直觉讲得很好。</figcaption>
</figure>

- 3Blue1Brown 英文原版 Chapter 5《Transformers, the tech behind LLMs》(YouTube ID `wjZofJX0v4M`):B 站中配版看不了时用。

### 书籍

- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024)第 2 章「Tokens and Embeddings」。中文版叫《图解大模型:生成式AI原理与实践》(图灵/人民邮电出版社,2025 年 5 月)。这本书的图是全行业最好懂的,第 2 章 1–2 小时。
- Chip Huyen《AI Engineering》(O'Reilly,2025)第 6 章「RAG and Agents」开头讲检索的部分。今天先翻一下,Day 16 再细读。

### 开源项目与代码

- [FlagOpen/FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding):bge 系列模型的官方仓库,README 里有各模型的对比和用法。
- [HandsOnLLM/Hands-On-Large-Language-Models](https://github.com/HandsOnLLM/Hands-On-Large-Language-Models):上面那本书的配套 notebook,第 2 章有可视化 embedding 的代码。
- [datawhalechina/llm-universe](https://github.com/datawhalechina/llm-universe):Datawhale 的中文大模型应用开发教程,里面搭知识库的章节讲了 embedding 的调用,可以对照着看国内厂商的写法。

## 自测

**1. 手算:`p = (3, 0, 4)`,`q = (0, 5, 0)`,`r = (6, 0, 8)`,cos(p, q) 和 cos(p, r) 各是多少?**

<details><summary>答案</summary>

p·q = 0,所以 cos(p, q) = 0,完全无关。p·r = 18 + 0 + 32 = 50,|p| = 5,|r| = 10,cos = 50 / 50 = 1。r 就是 p 放大两倍,方向完全一样,余弦只看方向,所以是 1。

</details>

**2. 为什么向量库里通常存归一化后的向量?**

<details><summary>答案</summary>

归一化后每个向量长度都是 1,余弦相似度就等于点积,检索时省掉除法,一次矩阵乘法就能算出一批相似度。而且对归一化向量,余弦、内积、欧氏距离给出的排序完全一致,选哪种距离都不会出错。

</details>

**3. 同事说:「我们把相似度阈值定成 0.8,低于 0.8 就回答不知道。」你觉得有什么问题?**

<details><summary>答案</summary>

相似度的数值分布跟模型强相关,换模型、甚至同一模型换了文档风格,合适的阈值都会变。更稳妥的做法是取 top-k,再让大模型读原文判断能不能回答;如果一定要阈值,要在自己的评估集上校准,并且换模型后重新校准。

</details>

**4. 客户问「E1042 是什么错误」,纯向量检索可能出什么问题?**

<details><summary>答案</summary>

embedding 对编号不敏感,E1042 和 E1043、E2017 这类错误码的向量非常接近,可能把别的错误码文章排在前面。解决办法是加关键词检索(BM25),对精确字符串做匹配,再和向量检索结果融合,这是 Day 18 的内容。

</details>

**5. 估算:一个 50 万字的中文知识库,用 text-embedding-v4(0.5 元/百万 token)建一次索引大概多少钱?存 1024 维 float32 向量大概占多大空间(假设切成 2,500 块)?**

<details><summary>答案</summary>

按 1 字约 1 token 保守估计,50 万 token × 0.5 元/百万 = 0.25 元。存储:2,500 × 1024 × 4 字节 ≈ 10 MB(pgvector 每个向量再多 8 字节头,可忽略)。结论是 embedding 本身几乎不花钱,真正的成本在后面把检索结果送进大模型。

</details>

**6.(面试题)你们知识库原来用 OpenAI 的 embedding,现在为了合规要换成国产模型,迁移要注意什么?**

<details><summary>答案</summary>

要点:①不同模型向量空间不兼容,必须用新模型全量重建索引,查询端同步切换,不能新旧混用;②维度可能变化,表结构和索引要跟着改(比如 1536 → 1024),pgvector HNSW 有 2000 维上限;③分词和最大输入长度不同,切块策略可能要调;④用自己的检索评估集对比新旧模型的 recall@k,而不是看榜单;⑤迁移期间可以双写两套索引,灰度切流量,出问题能回滚。能说出评估集和灰度这两点,基本就是有生产经验的回答了。

</details>

## 明天预告

Day 16 · 第一个 RAG:切块、向量化、检索、拼 prompt。今天有了 `embed()`,明天就把它用起来:先用一个脚本造出 CloudLedger 的帮助中心(20 篇文章,有套餐、退款、发票、错误码),把文章切成块、全部向量化存成 numpy 文件,然后对用户问题做检索,把最相关的几块塞进 prompt,让大模型带着引用出处回答。全程不用任何向量数据库和框架,一百多行代码把 RAG 的骨架看个透。
