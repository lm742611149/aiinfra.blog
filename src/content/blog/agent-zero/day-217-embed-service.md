---
title: 'Day 217 · 选 embedding 服务,写 embed 函数'
description: '把手工编的四个数换成模型算的 1024 个数。先发现 DeepSeek 没有 embedding 接口,另配一家硅基流动的 bge-m3(免费);再看清一次 embedding 请求和响应长什么样,学会一次发一批,最后写成以后每天都要用的 common/embed.py。'
pubDate: 2026-10-22
regime: none
tags: ['embedding', 'bge-m3', 'rag', 'openai-sdk', 'agent-zero']
series: 'agent-zero'
day: 217
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 216](/blog/agent-zero/day-216-week31-review/) 复习了这一周:关键词搜索搜不到同义句,于是要向量;距离会被长度带偏,于是要余弦;零向量会变成 `nan`,要在入库时拦住。复习日的小项目 `w31_search.py` 里,《退款政策》的向量是 `[0.9, 0.2, 0.0, 0.1]`,四个数全是我拍脑袋编的。

编的数能演示机制,但没法用。真实知识库有几百篇文章,你不可能给每篇手工打分,更不可能提前想好「钱、发票、登录、情绪」这四个维度就够了。今天把这件事交给模型:给它一段文字,它还给你一串数字,这串数字就叫 **embedding**。今天只做两件事,选一家 embedding 服务,写一个能批量调用的 `embed` 函数。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚为什么 `.env` 里要多一组 `EMB_*` 配置,能在 `.env` 里配好硅基流动的 bge-m3,跑通第一次 embedding 调用,并读懂响应里的 `data`、`index`、`embedding`、`usage` 四个字段。
2. 会**批量**调用:一次请求发 20 条文本,和一条一条发比较耗时;知道两次调用拿到的向量不会逐位相同,该用余弦而不是 `==` 去比。
3. 写出 `common/embed.py`:输入 N 条文本,输出 `(N, 1024)` 的归一化数组;按批切分、按 `index` 排序、记 token、空文本直接报错。
4. 记住一条铁律:建索引和查询必须用同一个模型,并能用实测数字说明混用为什么不报错却全错。

预计用时 2.5 小时:配账号和 `.env` 30 分钟,六个脚本各 15 分钟左右,剩下做练习。前置:[Day 53](/blog/agent-zero/day-053-env-secrets/) 的 `.env` 和 python-dotenv、[Day 120](/blog/agent-zero/day-120-api-register/) 第一次调 API、[Day 122](/blog/agent-zero/day-122-api-response/) 读响应字段、[Day 123](/blog/agent-zero/day-123-openai-compatible/) OpenAI 兼容协议、[Day 33](/blog/agent-zero/day-033-packages/) 的 `-m` 运行,以及 [Day 214](/blog/agent-zero/day-214-numpy-basics/)、[Day 215](/blog/agent-zero/day-215-cosine/) 的 numpy 和归一化。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `common/embed.py` 里的 `embed()` 函数;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## embedding 是什么:一个把文字变成向量的模型

Day 213 我们用手给「猫」打了两个分:像动物 0.9,像交通工具 0.1。**embedding 模型**做的是同一件事,只是它不需要你告诉它维度是什么。它在训练时读了海量文本,自己学出了 1024 个(或者更多)维度,每段文字进去,出来一串 1024 个小数。这串小数本身就叫这段文字的 embedding,中文常译「嵌入」或「向量表示」。

你不需要知道每一维代表什么,模型自己也说不清。你只需要相信一件事,这件事明天的相似度矩阵会验证:**意思相近的文字,向量方向相近**。于是 Day 215 的余弦相似度可以原样拿来用。

和 Day 106 开始用的聊天模型比,embedding 模型简单得多。聊天模型一个 token 一个 token 往外吐字,按输入和输出两头收钱;embedding 模型只吃输入,一次性吐出一串固定长度的数字,只按输入 token 收钱,而且便宜一到两个数量级。

## 先撞一次墙:DeepSeek 没有 embedding 接口

既然 Day 123 讲过 OpenAI 兼容协议「一份代码切换多家」,最自然的想法是拿现成的 DeepSeek 配置去调 embedding。openai SDK 里调 embedding 的方法是 `client.embeddings.create`,对应 HTTP 接口 `POST /embeddings`,和聊天用的 `POST /chat/completions` 是两个不同的地址。试一下。

新建 `part04/emb_deepseek.py`:

```python
# agent-zero-lab/part04/emb_deepseek.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
resp = client.embeddings.create(model=os.environ["LLM_MODEL"], input=["年付套餐买错了能退款吗"])
print(len(resp.data[0].embedding))
```

<div class="line-notes">

- `from dotenv import load_dotenv` [Day 53](/blog/agent-zero/day-053-env-secrets/) 学的 python-dotenv,作用和前端的 `.env` 一样:把文件里的 `KEY=value` 读进环境变量。
- `from openai import OpenAI` openai 官方 SDK,Day 120 起一直在用。
- `load_dotenv()` 读当前目录的 `.env`。它要在下面 `os.environ[...]` 之前执行。
- `client = OpenAI(base_url=os.environ["LLM_BASE_URL"]` 用的是聊天那一组配置,实测 `LLM_BASE_URL` 是 `https://api.deepseek.com`。
- `client.embeddings.create(model=os.environ["LLM_MODEL"]` `LLM_MODEL` 实测是 `deepseek-flash`。`input` 传一个字符串列表,这里只有一条。SDK 会往 `https://api.deepseek.com/embeddings` 发 POST。
- `print(len(resp.data[0].embedding))` 如果成功,打印向量长度。不会走到这一行。

</div>

```bash
cd agent-zero-lab
uv run python -m part04.emb_deepseek
```

真实报错(中间几十行 SDK 内部调用栈省略了):

```text
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
...
    raise self._make_status_error_from_response(err.response) from None
openai.NotFoundError: Error code: 404
```

读法和 [Day 126](/blog/agent-zero/day-126-error-codes/) 一样,只看最后一行:`NotFoundError`,HTTP 404,也就是「这个地址不存在」。不是 key 错了(那是 401),不是没钱(402),是 DeepSeek 根本没有 `/embeddings` 这个接口。我 2026 年 10 月查了 [DeepSeek API 文档](https://api-docs.deepseek.com/),列出来的只有聊天补全、Anthropic 兼容格式和新出的搜索接口,没有 embedding。

运行命令这次用的是 `-m part04.emb_deepseek`,不是 Day 213 那种 `part04/xxx.py`。原因在后面:今天最后要写 `common/embed.py`,别的脚本要 `from common.embed import ...`,必须从根目录用 `-m` 跑,Python 才找得到 `common` 这个包([Day 33](/blog/agent-zero/day-033-packages/) 讲过)。为了一致,今天所有调 API 的脚本都用 `-m` 跑。

结论:**聊天和 embedding 可以是两家厂商**。这在工作里非常常见,聊天用 A 家最强的模型,embedding 用 B 家中文效果好又便宜的,互不影响。

## 选一家:2026 年 10 月的三个选择

我按国内读者的方便程度排,价格都是 2026 年 10 月当场查的:

**硅基流动(SiliconFlow)的 `BAAI/bge-m3`,课程默认。** 它的[价格页](https://siliconflow.cn/pricing)上 `BAAI/bge-m3` 标「免费」,带 `Pro/` 前缀的 `Pro/BAAI/bge-m3` 是 ¥0.07/百万 token。bge-m3 是北京智源研究院(BAAI)开源的多语言模型,中文好,单条输入最长 8192 token,输出 1024 维。硅基流动的接口是 OpenAI 兼容的,所以代码和调 DeepSeek 一模一样,只换 base_url、key 和模型名。第四部分后面的 rerank(Day 238)也在这一家,一个 key 管到底。免费的东西随时可能改规则,用之前自己再看一眼价格页。

**阿里云百炼的 `text-embedding-v4`。** [百炼 embedding 文档](https://help.aliyun.com/zh/model-studio/embedding)上写的北京地域价格是每千 token 0.0005 元,也就是 0.5 元/百万 token;维度可选 64 到 2048,默认 1024;**单批最多 10 条**,每条不超过 8192 token。页面上还列了更新的 `qwen3.7-text-embedding` 和 flash 版。公司本来就在阿里云上的,选它省事。

**OpenAI 的 `text-embedding-3-small`。** 海外读者直接用。[OpenAI embedding 指南](https://developers.openai.com/api/docs/guides/embeddings)上写的是默认 1536 维,单条最长 8192 token,价格写成「约 62,500 页/美元,按每页 800 token 算」,换算下来是 0.02 美元/百万 token。

三家都走 `client.embeddings.create`,换厂商只改 `.env`,这是 Day 123 讲的兼容协议又兑现了一次。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一个项目两组配置:LLM_* 指向 DeepSeek 做聊天,EMB_* 指向硅基流动做 embedding">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="70" width="170" height="110" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="32" y="92" fill="var(--ink)">agent-zero-lab/.env</text>
<text x="32" y="118" fill="var(--mem)">LLM_BASE_URL=…</text>
<text x="32" y="136" fill="var(--mem)">LLM_MODEL=…</text>
<text x="32" y="158" fill="var(--compute)">EMB_BASE_URL=…</text>
<text x="32" y="176" fill="var(--compute)" font-size="11">EMB_MODEL / DIM / BATCH</text>
<rect x="240" y="30" width="170" height="60" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="252" y="54" fill="var(--ink)">common/llm.py</text>
<text x="252" y="74" fill="var(--ink-soft)" font-size="11">chat / stream</text>
<rect x="240" y="160" width="170" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="252" y="184" fill="var(--ink)">common/embed.py</text>
<text x="252" y="204" fill="var(--ink-soft)" font-size="11">embed / embed_one</text>
<rect x="460" y="30" width="160" height="60" rx="5" fill="none" stroke="var(--mem)"/>
<text x="472" y="54" fill="var(--ink)">DeepSeek</text>
<text x="472" y="74" fill="var(--ink-soft)" font-size="11">/chat/completions</text>
<rect x="460" y="160" width="160" height="60" rx="5" fill="none" stroke="var(--compute)"/>
<text x="472" y="184" fill="var(--ink)">硅基流动 bge-m3</text>
<text x="472" y="204" fill="var(--ink-soft)" font-size="11">/embeddings</text>
<line x1="190" y1="110" x2="240" y2="64" stroke="var(--mem)" marker-end="url(#m217a)"/>
<line x1="190" y1="160" x2="240" y2="188" stroke="var(--compute)" marker-end="url(#m217a)"/>
<line x1="410" y1="60" x2="460" y2="60" stroke="var(--mem)" marker-end="url(#m217a)"/>
<line x1="410" y1="190" x2="460" y2="190" stroke="var(--compute)" marker-end="url(#m217a)"/>
<line x1="540" y1="90" x2="540" y2="160" stroke="var(--rule)" stroke-dasharray="4 4"/>
<text x="548" y="130" fill="var(--ink-faint)" font-size="11">DeepSeek 上</text>
<text x="548" y="146" fill="var(--ink-faint)" font-size="11">这条是 404</text>
<defs><marker id="m217a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>蓝色是模型侧的聊天,琥珀色是今天新加的 embedding。两组配置互不干扰,同一个 `.env` 里各管各的;`common/llm.py` 是 Day 135–137 写的,`common/embed.py` 今天写。</figcaption>
</figure>

## 配好 `.env`

去 [siliconflow.cn](https://siliconflow.cn/) 注册(手机号即可),在控制台的「API 密钥」页面新建一个 key,形如 `sk-` 开头的一长串。然后在 `agent-zero-lab/.env` 里,在已有的 `LLM_*` 几行下面追加五行:

```bash
# agent-zero-lab/.env (在 LLM_* 下面追加)
EMB_BASE_URL=https://api.siliconflow.cn/v1
EMB_API_KEY=sk-你的硅基流动key
EMB_MODEL=BAAI/bge-m3
EMB_DIM=1024
EMB_BATCH=10
```

<div class="line-notes">

- `EMB_BASE_URL=https://api.siliconflow.cn/v1` 硅基流动的 OpenAI 兼容地址。注意结尾是 `/v1`,SDK 会在后面拼 `/embeddings`。
- `EMB_API_KEY=sk-你的硅基流动key` 和 DeepSeek 的 key 是两个东西,别填混。`.env` 在 Day 53 就进了 `.gitignore`,不会被提交。
- `EMB_MODEL=BAAI/bge-m3` 模型名要带组织前缀 `BAAI/`,少了会报 400。
- `EMB_DIM=1024` bge-m3 的输出维度。代码里只在「空列表」时用它来造一个形状正确的空数组,别的地方不靠它。
- `EMB_BATCH=10` 一次请求最多发几条。硅基流动实测一次发 2000 条也能成功,但百炼上限是 10,取小的,换厂商不用改代码。

</div>

依赖在 Day 120 和 Day 214 应该已经装过。没装过的,在 `agent-zero-lab` 根目录跑一次:

```bash
uv add openai python-dotenv numpy
```

我 2026 年 10 月装到的版本是 openai 3.36.1、python-dotenv 1.2.4、numpy 2.5.4。

## 第一次调用:看清请求和响应

先不写任何封装,用最少的代码调一次。新建 `part04/emb_first.py`:

```python
# agent-zero-lab/part04/emb_first.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])
resp = client.embeddings.create(model=os.environ["EMB_MODEL"], input=["年付套餐买错了能退款吗"])

vec = resp.data[0].embedding
print("返回的模型:", resp.model)
print("data 里有几条:", len(resp.data))
print("这条的 index:", resp.data[0].index)
print("向量类型:", type(vec).__name__, " 维度:", len(vec))
print("前 5 个数:", [round(x, 4) for x in vec[:5]])
print("usage:", resp.usage)
```

<div class="line-notes">

- `client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])` 换成 `EMB_*` 那一组。用 `os.environ[...]` 而不是 `.get()`:没配就立刻报 `KeyError: 'EMB_BASE_URL'`,好过拿一个空地址跑半天才失败。
- `resp = client.embeddings.create(model=os.environ["EMB_MODEL"], input=["年付套餐买错了能退款吗"])` `model` 是 `BAAI/bge-m3`;`input` 可以传单个字符串,也可以传列表,我习惯永远传列表,后面批量时不用改写法。
- `vec = resp.data[0].embedding` `resp.data` 是一个列表,每条输入对应一项;每项的 `.embedding` 就是那串数字。
- `print("返回的模型:", resp.model)` 服务端回显用的是哪个模型,实测 `BAAI/bge-m3`。排查「是不是用错模型了」时先看这里。
- `print("data 里有几条:", len(resp.data))` 输入 1 条,返回 1 条。
- `print("这条的 index:", resp.data[0].index)` 这一项对应输入列表里的第几条,从 0 开始。一条的时候没用,批量的时候很重要。
- `type(vec).__name__` 打印类型名。SDK 返回的是普通 Python 列表 `list`,不是 numpy 数组,要做向量运算得自己转。
- `[round(x, 4) for x in vec[:5]]` 前 5 个数各保留 4 位小数。
- `print("usage:", resp.usage)` 用了多少 token。embedding 只有输入,所以 `completion_tokens` 是 0。

</div>

```bash
uv run python -m part04.emb_first
```

真实输出:

```text
返回的模型: BAAI/bge-m3
data 里有几条: 1
这条的 index: 0
向量类型: list  维度: 1024
前 5 个数: [-0.0202, 0.0098, -0.0355, 0.0093, -0.0055]
usage: Usage(prompt_tokens=12, total_tokens=12, completion_tokens=0)
```

一句 11 个字的话,变成了 1024 个小数,前五个是 `-0.0202, 0.0098, …`。这些数单独看没有任何意义,有意义的是它们和别的句子的向量放在一起比方向。12 个 token 是 11 个字加上模型自己加的首尾标记,下面练习 1 会测出「空字符串也要 2 个 token」。

前端同学可能更习惯直接看 HTTP。同一个请求用 curl 发一次(在 `agent-zero-lab` 目录里,把 key 从 `.env` 里取出来):

```bash
K=$(grep ^EMB_API_KEY= .env | cut -d= -f2-)
curl -s https://api.siliconflow.cn/v1/embeddings \
  -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -d '{"model":"BAAI/bge-m3","input":["年付套餐买错了能退款吗"]}'
```

返回的 JSON 很长,1024 个数我只留了前 3 个,其余原样:

```json
{
  "object": "list",
  "data": [
    {
      "embedding": [
        -0.020239491015672684,
        0.009819901548326015,
        -0.03553155064582825,
        "..."
      ],
      "index": 0,
      "object": "embedding"
    }
  ],
  "model": "BAAI/bge-m3",
  "usage": {
    "prompt_tokens": 12,
    "completion_tokens": 0,
    "total_tokens": 12
  }
}
```

和 [Day 122](/blog/agent-zero/day-122-api-response/) 的聊天响应对比:聊天响应的主体是 `choices[0].message.content`,一段文字;embedding 响应的主体是 `data[i].embedding`,一串数字。`usage` 结构一样。SDK 做的事情就是把这段 JSON 解析成带属性的对象,`resp.data[0].embedding` 就是 JS 里的 `json.data[0].embedding`。

## 一次发一批

真实场景从来不是一条。Day 222 我们会造一份 CloudLedger 帮助中心,切块以后是几十上百段,每段都要变成向量。一条一条发,每次都要付一次网络往返的时间;embedding 接口允许 `input` 传一个列表,一次请求处理一整批,这就是**批量**(batch)。

新建 `part04/emb_batch.py`,用 20 条文本比两种发法:

```python
# agent-zero-lab/part04/emb_batch.py
import os
import time

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])
MODEL = os.environ["EMB_MODEL"]

texts = [f"第 {i} 号工单:年付套餐买错了能退款吗" for i in range(20)]

t0 = time.perf_counter()
one_by_one = []
for t in texts:
    r = client.embeddings.create(model=MODEL, input=[t])
    one_by_one.append(r.data[0].embedding)
t1 = time.perf_counter()
print(f"一条一条发:{len(texts)} 次请求,{t1 - t0:.2f} 秒")

r = client.embeddings.create(model=MODEL, input=texts)
t2 = time.perf_counter()
print(f"一批发完:  1 次请求,{t2 - t1:.2f} 秒")
print("返回条数:", len(r.data), " 前 3 个 index:", [d.index for d in r.data[:3]])
print("usage:", r.usage)

a = np.array(one_by_one)
b = np.array([d.embedding for d in sorted(r.data, key=lambda d: d.index)])
print("逐位最大差:", round(float(np.abs(a - b).max()), 6))
print("对应两条的余弦,最小的那个:", round(float((a * b).sum(axis=1).min()), 6))
```

<div class="line-notes">

- `import time` 标准库,下面用它计时。
- `texts = [f"第 {i} 号工单:年付套餐买错了能退款吗" for i in range(20)]` 列表推导式造 20 条只差编号的文本,`range(20)` 是 0 到 19。
- `t0 = time.perf_counter()` 记下开始时间,单位秒,相当于浏览器里的 `performance.now()`(那个是毫秒)。
- `one_by_one = []` 装一条一条发回来的向量。
- `r = client.embeddings.create(model=MODEL, input=[t])` 每条单独一次请求,20 条就是 20 次网络往返。
- `one_by_one.append(r.data[0].embedding)` 每次只有一条,取 `data[0]`。
- `print(f"一条一条发:{len(texts)} 次请求,{t1 - t0:.2f} 秒")` 两个时间点相减就是耗时,实测 2.39 秒。
- `r = client.embeddings.create(model=MODEL, input=texts)` 整个列表一次发出去。
- `print(f"一批发完:  1 次请求,{t2 - t1:.2f} 秒")` 实测 0.20 秒。
- `[d.index for d in r.data[:3]]` 看前三项的 `index`,实测是 `[0, 1, 2]`。OpenAI 的接口约定是按输入顺序返回,但每项都带着 `index`,按它对号入座最保险。
- `print("usage:", r.usage)` 20 条一共 360 个 token,每条 18 个。批量不省 token,省的是时间和请求次数。
- `a = np.array(one_by_one)` 20 个长度 1024 的列表变成 `(20, 1024)` 的数组。
- `sorted(r.data, key=lambda d: d.index)` 按 `index` 排序后再取向量,保证第 i 行对应第 i 条输入。`lambda d: d.index` 就是 JS 的 `d => d.index`。
- `np.abs(a - b).max()` 两种方式得到的向量逐位相减,取绝对值的最大值。实测 0.002608,不是 0。
- `(a * b).sum(axis=1)` `a * b` 是逐位相乘,`.sum(axis=1)` 每行加起来,等于每对向量各自做点积,得到 20 个数。bge-m3 返回的向量长度已经是 1(下一节验证),所以点积就是余弦。`.min()` 取最小的那个,实测 0.999915。

</div>

```bash
uv run python -m part04.emb_batch
```

真实输出:

```text
一条一条发:20 次请求,2.39 秒
一批发完:  1 次请求,0.20 秒
返回条数: 20  前 3 个 index: [0, 1, 2]
usage: Usage(prompt_tokens=360, total_tokens=360, completion_tokens=0)
逐位最大差: 0.002608
对应两条的余弦,最小的那个: 0.999915
```

快了 12 倍左右,token 一个没少。这就是批量的全部意义:**每次请求有固定的网络和排队开销,批量把 20 份开销压成 1 份**。你在前端把 20 个 `fetch` 合成一个批量接口,是同一个道理。具体倍数取决于你的网络,我在国内家宽上跑了两次,分别是 2.52 秒对 0.18 秒、2.39 秒对 0.20 秒。

后两行是我第一次写这个脚本时没想到的。我原本写的是「逐位差小于 0.0001 就算一样」,结果打印 `False`。查下去发现,不只是批量和单条不一样,**同一句话单独发两次,向量也不完全一样**:我另外测了 5 条,单条对单条的逐位最大差是 0.0012。原因是服务端在 GPU 上用低精度浮点数计算,批里有几条、和谁一起算,都会让最后几位小数略有不同。这对检索没有任何影响,余弦 0.9999 和 1 在排序上没有区别。但它告诉你两件事:比较两个向量是否「一样」要用余弦或 Day 215 的 `np.allclose` 加宽容差,别用 `==`;以及你的测试用例不能写死向量的第几位等于多少。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="一条一条发要20次网络往返,批量只要1次,token数相同">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">一条一条发:20 次往返,2.39 秒</text>
<g fill="var(--compute-wash)" stroke="var(--compute)">
<rect x="20" y="40" width="26" height="22"/><rect x="50" y="40" width="26" height="22"/><rect x="80" y="40" width="26" height="22"/><rect x="110" y="40" width="26" height="22"/><rect x="140" y="40" width="26" height="22"/>
<rect x="170" y="40" width="26" height="22"/><rect x="200" y="40" width="26" height="22"/><rect x="230" y="40" width="26" height="22"/><rect x="260" y="40" width="26" height="22"/><rect x="290" y="40" width="26" height="22"/>
<rect x="320" y="40" width="26" height="22"/><rect x="350" y="40" width="26" height="22"/><rect x="380" y="40" width="26" height="22"/><rect x="410" y="40" width="26" height="22"/><rect x="440" y="40" width="26" height="22"/>
<rect x="470" y="40" width="26" height="22"/><rect x="500" y="40" width="26" height="22"/><rect x="530" y="40" width="26" height="22"/><rect x="560" y="40" width="26" height="22"/><rect x="590" y="40" width="26" height="22"/>
</g>
<text x="20" y="80" fill="var(--ink-soft)" font-size="11">每格 = 1 次请求:建连接、排队、算、返回</text>
<text x="20" y="118" fill="var(--ink)">一批发完:1 次往返,0.20 秒</text>
<rect x="20" y="130" width="52" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="80" y="146" fill="var(--ink-soft)" font-size="11">input=[20 条],一次请求带回 20 个向量</text>
<text x="20" y="184" fill="var(--ink-faint)" font-size="11">两种方式都是 360 个 token,钱一样;省下的是时间和请求次数</text>
</g>
</svg>
<figcaption>格子的宽度是示意,不是按比例画的。批量的那一格比单条的一格宽一点:一次算 20 条比算 1 条稍慢,但远远比不上 20 次往返。</figcaption>
</figure>

批量有上限吗?硅基流动的[接口文档](https://docs.siliconflow.cn/docs/api/embeddings-post)没写数组最多几条,我试了一次发 2000 条,5.8 秒成功返回。百炼是硬性的 10 条。所以 `.env` 里 `EMB_BATCH=10`,代码按 10 条一批切,在哪家都能跑。

## 故意踩坑:一条文本太长

批量解决的是「条数多」,另一个限制是「每条多长」。bge-m3 每条最多 8192 个 token。超了会怎样?新建 `part04/emb_too_long.py`:

```python
# agent-zero-lab/part04/emb_too_long.py
import os

from dotenv import load_dotenv
from openai import BadRequestError, OpenAI

load_dotenv()

client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])
MODEL = os.environ["EMB_MODEL"]

for n in [4000, 4100]:
    text = "退款" * n
    try:
        r = client.embeddings.create(model=MODEL, input=[text])
        print(f"{len(text)} 个字:成功,用了 {r.usage.prompt_tokens} 个 token")
    except BadRequestError as e:
        print(f"{len(text)} 个字:失败,状态码 {e.status_code},返回 {e.body}")
```

<div class="line-notes">

- `from openai import BadRequestError, OpenAI` `BadRequestError` 是 SDK 给 HTTP 400 准备的异常类,Day 126 见过它的兄弟 `AuthenticationError`(401)、`RateLimitError`(429)。
- `for n in [4000, 4100]:` 两个长度,一个在上限内,一个刚超。
- `text = "退款" * n` 字符串乘整数是重复拼接,相当于 JS 的 `"退款".repeat(n)`。4000 次就是 8000 个字。
- `print(f"{len(text)} 个字:成功,用了 {r.usage.prompt_tokens} 个 token")` 实测 8000 个字用了 8003 个 token:每个「退款」2 个 token,再加首尾标记。
- `except BadRequestError as e:` 只接 400,别的错误照常抛出去。
- `e.status_code` 实测 400;同一行里的 `e.body` 是服务端返回的 JSON 主体。

</div>

```bash
uv run python -m part04.emb_too_long
```

真实输出:

```text
8000 个字:成功,用了 8003 个 token
8200 个字:失败,状态码 400,返回 {'code': 20015, 'message': 'The parameter is invalid. Please check again.', 'data': None}
```

8003 个 token 刚好在 8192 以内,8200 个字大约 8203 个 token,超了。报错信息只有一句「参数无效」,一个字都没提长度。我第一次碰到这个 400 时花了十来分钟检查模型名和 key,最后才想到是文本太长。记住这个对应关系:**embedding 接口报 400 又说不清原因,先查最长那条有多少 token**。

真正的解决办法不在 `embed` 函数里,而是不让长文本进来:Day 224 会把文章按标题切成小块,每块几百字,离上限远得很。今天的 `embed` 不做截断,截断会悄悄丢掉后半篇的内容,宁可报错让你看见。

还有一个和长度相关的细节:不同模型的上限差很多。硅基流动接口文档里写的是 bge-m3 8192,`BAAI/bge-large-zh-v1.5` 只有 512,Qwen3-Embedding 系列 32768。换模型前先看这个数。

## 故意踩坑:空文本也能拿到一个向量

Day 215 说过,有的服务遇到空字符串会返回全 0 向量,算余弦时变成 `nan`。硅基流动的接口文档写着输入「不能为空字符串」。实际试一下,新建 `part04/emb_empty.py`:

```python
# agent-zero-lab/part04/emb_empty.py
import os

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])
texts = ["", "怎么申请退款", "今天北京天气不错", "导入银行流水时报错 E1042"]
resp = client.embeddings.create(model=os.environ["EMB_MODEL"], input=texts)

vecs = np.array([d.embedding for d in resp.data])
print("空字符串的向量长度:", round(float(np.linalg.norm(vecs[0])), 4))
print("空字符串和另外三句的余弦:", (vecs[1:] @ vecs[0]).round(4))
print("usage:", resp.usage)
```

<div class="line-notes">

- `texts = ["", "怎么申请退款", "今天北京天气不错", "导入银行流水时报错 E1042"]` 第 0 条是空字符串,另外三句话题各不相同。
- `vecs = np.array([d.embedding for d in resp.data])` `(4, 1024)` 的数组。
- `np.linalg.norm(vecs[0])` 空字符串那个向量的长度,看它是不是零向量。
- `vecs[1:] @ vecs[0]` `vecs[1:]` 是后三行,形状 `(3, 1024)`,`@` 一个 `(1024,)` 的向量,得到 3 个点积。向量长度都是 1,点积就是余弦。

</div>

```bash
uv run python -m part04.emb_empty
```

真实输出:

```text
空字符串的向量长度: 1.0
空字符串和另外三句的余弦: [0.5843 0.571  0.525 ]
usage: Usage(prompt_tokens=28, total_tokens=28, completion_tokens=0)
```

文档说不行,实际上没报错,还返回了一个长度为 1 的正常向量。它不是零向量,所以 Day 215 那套 `nan` 检查拦不住它。更麻烦的是,它和三句毫不相干的话余弦都在 0.52 到 0.58 之间,不高不低。明天你会看到,bge-m3 上「话题无关」的两句话大约 0.33 到 0.45,「有点像」的大约 0.5 到 0.6。一篇空文档进了索引,会以 0.55 左右的分数混在各种问题的结果里,怎么看都像一篇「有点相关」的文章。

文档和实际行为对不上,这种事在第三方 API 上很常见,哪天它真的开始拒绝空字符串也说不定。不管它返回什么,我们都在自己这一侧拦住:**空文本不送去 embedding,直接报错**。这条规矩会写进下面的 `_clean` 函数里。

## 拼起来:common/embed.py

零件都齐了。现在把它们收进一个模块,放在 `common/` 下面,因为后面第四部分到毕业项目都要用它,和 Day 135–137 写的 `common/llm.py` 并排。如果你的 `common/` 目录里还没有 `__init__.py`,先建一个空的(Day 33 讲过,有了它 `common` 才是一个正常的包):

```bash
touch common/__init__.py
```

新建 `common/embed.py`:

```python
# agent-zero-lab/common/embed.py
"""embedding 封装。配置读 .env 里的 EMB_* 一组。"""
import os

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

EMB_MODEL = os.environ["EMB_MODEL"]
EMB_DIM = int(os.environ.get("EMB_DIM", "1024"))
EMB_BATCH = int(os.environ.get("EMB_BATCH", "10"))
_client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])

usage = {"requests": 0, "tokens": 0}


def _clean(text: str) -> str:
    cleaned = " ".join(text.split())
    if not cleaned:
        raise ValueError("空文本不能送去 embedding(检查一下是不是读到了空段落)")
    return cleaned


def embed(texts: list[str]) -> np.ndarray:
    """把 N 条文本变成 (N, EMB_DIM) 的数组,每行都归一化成长度 1。"""
    if not texts:
        return np.zeros((0, EMB_DIM), dtype=np.float32)
    vectors: list[list[float]] = []
    for start in range(0, len(texts), EMB_BATCH):
        batch = [_clean(t) for t in texts[start : start + EMB_BATCH]]
        resp = _client.embeddings.create(model=EMB_MODEL, input=batch)
        usage["requests"] += 1
        if resp.usage:
            usage["tokens"] += resp.usage.total_tokens
        vectors.extend(d.embedding for d in sorted(resp.data, key=lambda d: d.index))
    arr = np.asarray(vectors, dtype=np.float32)
    return arr / np.linalg.norm(arr, axis=1, keepdims=True)


def embed_one(text: str) -> np.ndarray:
    """单条文本的快捷方式,返回形状 (EMB_DIM,)。"""
    return embed([text])[0]


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """通用余弦(Day 215 的公式)。对 embed() 的结果,它等于 a @ b。"""
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))


if __name__ == "__main__":
    texts = [
        "年付套餐买错了能把钱要回来吗",
        "退款政策:年付套餐中途取消的,\n按剩余的整月数比例退款",
        "怎么申请退款",
        "发票抬头填错了怎么改",
        "导入银行流水时报错 E1042",
        "今天北京天气不错",
        "重置密码的邮件收不到",
        "企业版支持按比例退款",
        "企业版不支持按比例退款",
        "专业版和企业版有什么区别",
        "  可以开增值税专用发票吗  ",
        "账号被锁了怎么办",
    ]
    vecs = embed(texts)
    print("形状:", vecs.shape, " 类型:", vecs.dtype)
    print("每行长度(前 3 行):", np.linalg.norm(vecs[:3], axis=1))
    print("请求次数:", usage["requests"], " token:", usage["tokens"])
    print("空列表:", embed([]).shape)
    q = embed_one("买错了想退钱")
    print("单条形状:", q.shape)
    print("和第 0 条的余弦:", round(float(vecs[0] @ q), 4))
    try:
        embed(["退款", "   \n  "])
    except ValueError as e:
        print("报错:", e)
```

<div class="line-notes">

- `"""embedding 封装。配置读 .env 里的 EMB_* 一组。"""` 模块开头的文档字符串,别人 `help(common.embed)` 时能看到。
- `load_dotenv()` 模块一被 import 就读 `.env`。它默认**不覆盖**已经存在的环境变量,练习 2 会利用这一点在命令行临时改批大小。
- `EMB_MODEL = os.environ["EMB_MODEL"]` 实测是 `BAAI/bge-m3`。全大写的模块级变量是 Python 里「常量」的约定写法,相当于 JS 文件顶部的 `const EMB_MODEL = ...`。
- `EMB_DIM = int(os.environ.get("EMB_DIM", "1024"))` 环境变量永远是字符串,`int()` 转成数字。
- `EMB_BATCH = int(os.environ.get("EMB_BATCH", "10"))` 实测 10。
- `_client = OpenAI(` 名字前的下划线是「模块内部用,别从外面碰」的约定,和 JS 里给私有字段起 `_` 开头的名字一样,只是约定,不强制。整个进程只建一个客户端,复用连接。
- `usage = {"requests": 0, "tokens": 0}` 记账用的字典。用字典而不是两个整数变量,是因为函数里改字典的值不需要 `global` 声明,改整数变量就需要。别的模块 `from common.embed import usage` 拿到的是同一个字典,能读到最新的数。
- `def _clean(text: str) -> str:` 清洗一条文本,同样是下划线开头的内部函数。
- `cleaned = " ".join(text.split())` `split()` 不带参数,按任意空白(空格、换行、制表符、全角空格)切开,并扔掉首尾空白;`" ".join(...)` 再用单个空格拼回去。`"退款政策:年付套餐中途取消的,\n按剩余的整月数比例退款"` 变成换行处一个空格;`"  可以开增值税专用发票吗  "` 首尾空格没了。相当于 JS 的 `text.trim().split(/\s+/).join(" ")`。
- `if not cleaned:` 清洗完是空字符串,说明原文全是空白。
- `raise ValueError(` 直接报错,不送去服务端。原因就是上一节:空字符串会拿回一个「看起来正常」的向量。
- `def embed(texts: list[str]) -> np.ndarray:` 输入 N 条文本,输出 `(N, 1024)` 的数组。
- `if not texts:` 空列表直接返回,不发请求。
- `return np.zeros((0, EMB_DIM), dtype=np.float32)` 一个 0 行 1024 列的空数组。不这样处理的话,下面 `np.asarray([])` 得到形状 `(0,)` 的一维数组,`axis=1` 会报错。返回正确形状的空数组,调用方 `vecs @ q` 也能正常得到一个空结果。
- `vectors: list[list[float]] = []` 先用普通列表攒每一批的结果,最后一次性转成 numpy 数组。
- `for start in range(0, len(texts), EMB_BATCH):` 分批。12 条文本、批大小 10,`range(0, 12, 10)` 产生 0 和 10 两个起点。相当于 `for (let start = 0; start < texts.length; start += EMB_BATCH)`。
- `batch = [_clean(t) for t in texts[start : start + EMB_BATCH]]` 第一批 `texts[0:10]` 10 条,第二批 `texts[10:20]` 只剩 2 条,切片超出末尾不会报错。每条都过一遍 `_clean`。
- `resp = _client.embeddings.create(model=EMB_MODEL, input=batch)` 一批一次请求。
- `usage["requests"] += 1` 请求次数加一。12 条文本最后是 2。
- `if resp.usage:` 有的服务不返回 usage,这时就不记,避免 `None.total_tokens` 报错。
- `usage["tokens"] += resp.usage.total_tokens` 12 条两批一共记了 138 个 token。
- `vectors.extend(d.embedding for d in sorted(resp.data, key=lambda d: d.index))` 按 `index` 排好序,把这一批的向量逐个追加进去。`extend` 相当于 JS 的 `push(...xs)`;写成 `append` 会把整批当成一个元素塞进去,变成列表套列表套列表。
- `arr = np.asarray(vectors, dtype=np.float32)` 12 个长度 1024 的列表变成 `(12, 1024)` 的数组。`float32` 每个数占 4 字节,比默认的 `float64` 省一半内存,精度对向量检索足够,Day 220 算存储账时会用到这个 4。
- `return arr / np.linalg.norm(arr, axis=1, keepdims=True)` Day 215 的按行归一化,`keepdims=True` 一个都不能少。实测 bge-m3 返回的向量**本来就是**长度 1,这一步相当于除以 1。保留它是因为换个模型不一定这样,多除一次几乎不花时间,漏了就会让点积不等于余弦。
- `def embed_one(text: str) -> np.ndarray:` 单条快捷方式。
- `return embed([text])[0]` 包成一条的列表传进去,拿回 `(1, 1024)`,`[0]` 取第一行,形状变成 `(1024,)`。
- `def cosine(a: np.ndarray, b: np.ndarray) -> float:` Day 215 的通用公式,放在这里给后面几天用,对付那些不是 `embed()` 产出的向量。
- `if __name__ == "__main__":` [Day 32](/blog/agent-zero/day-032-modules/) 讲过:只有直接运行这个文件时才执行下面的自测,被别的文件 import 时不执行。
- `"退款政策:年付套餐中途取消的,\n按剩余的整月数比例退款",` 故意带一个换行,验证 `_clean`。
- `"  可以开增值税专用发票吗  ",` 故意带首尾空格。
- `print("形状:", vecs.shape, " 类型:", vecs.dtype)` 应为 `(12, 1024)` 和 `float32`。
- `np.linalg.norm(vecs[:3], axis=1)` 前三行的长度,应该都是 1。
- `print("请求次数:", usage["requests"]` 12 条按 10 条一批,应该是 2 次。
- `print("空列表:", embed([]).shape)` 应为 `(0, 1024)`,而且不发请求。
- `q = embed_one("买错了想退钱")` 单条,这是第 3 次请求。
- `round(float(vecs[0] @ q), 4)` 「年付套餐买错了能把钱要回来吗」和「买错了想退钱」的余弦,实测 0.7846。
- `embed(["退款", "   \n  "])` 第二条全是空白,`_clean` 会报错。注意它在发请求**之前**就报了,整批都没发出去。

</div>

```bash
uv run python -m common.embed
```

真实输出:

```text
形状: (12, 1024)  类型: float32
每行长度(前 3 行): [1. 1. 1.]
请求次数: 2  token: 138
空列表: (0, 1024)
单条形状: (1024,)
和第 0 条的余弦: 0.7846
报错: 空文本不能送去 embedding(检查一下是不是读到了空段落)
```

逐行对一下:12 条变成 `(12, 1024)` 的 `float32`;长度全是 1;两次请求;空列表不发请求,形状正确;单条是一维;两句意思接近的话余弦 0.78;空白文本在本地就被拦下。

零件和大代码的对照:

| 零件 | 来自哪一节 | 在 `embed.py` 的哪一段 |
| --- | --- | --- |
| `EMB_*` 单独一组配置 | 「先撞一次墙」「配好 .env」 | 顶部四个常量和 `_client` |
| `embeddings.create` 和 `data[i].embedding` | 「第一次调用」 | `embed` 循环里的请求那一行 |
| 一次发一批、按 `index` 排序 | 「一次发一批」 | `for start in range(...)` 和 `sorted(...)` |
| 记 token | 「第一次调用」的 `usage` | `usage` 字典 |
| 空文本直接报错 | 「空文本也能拿到一个向量」 | `_clean` |
| 太长就报 400,不截断 | 「一条文本太长」 | 刻意没写,交给 Day 224 切块 |
| 按行归一化 | Day 215 | `embed` 最后一行 |

## 铁律:建索引和查询用同一个模型

最后一件事,也是最容易出、最难查的事故。用 bge-m3 给文档建好向量,查询时不小心换了一个模型给问题编码,会发生什么?

挑一个最阴险的情况:硅基流动上的 `BAAI/bge-large-zh-v1.5` 也是 1024 维,维度一模一样,Day 213 学的「维度对不上会报错」那道保险完全不起作用。新建 `part04/emb_two_models.py`:

```python
# agent-zero-lab/part04/emb_two_models.py
import os

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])


def vec(model: str, text: str) -> np.ndarray:
    r = client.embeddings.create(model=model, input=[text])
    v = np.array(r.data[0].embedding)
    return v / np.linalg.norm(v)


doc = "退款政策:年付套餐中途取消的,按剩余的整月数比例退款"
query = "年付套餐买错了能把钱要回来吗"
other = "今天北京天气不错"

m3_doc = vec("BAAI/bge-m3", doc)
zh_doc = vec("BAAI/bge-large-zh-v1.5", doc)
m3_query = vec("BAAI/bge-m3", query)
zh_query = vec("BAAI/bge-large-zh-v1.5", query)
m3_other = vec("BAAI/bge-m3", other)

print("两个模型的维度:", m3_doc.shape, zh_doc.shape)
print("同一句话,两个模型的向量余弦:", round(float(m3_doc @ zh_doc), 4))
print("都用 bge-m3:       问题 vs 退款政策", round(float(m3_query @ m3_doc), 4))
print("都用 bge-m3:       天气 vs 退款政策", round(float(m3_other @ m3_doc), 4))
print("都用 bge-large-zh: 问题 vs 退款政策", round(float(zh_query @ zh_doc), 4))
print("混着用:            问题(zh) vs 退款政策(m3)", round(float(zh_query @ m3_doc), 4))
```

<div class="line-notes">

- `def vec(model: str, text: str) -> np.ndarray:` 一个临时小函数:指定模型,编码一句话,归一化后返回。这里不用 `common.embed`,因为那边模型是从 `.env` 读死的。
- `v = np.array(r.data[0].embedding)` 列表转成 numpy 数组。
- `return v / np.linalg.norm(v)` 一维向量的归一化,不需要 `axis`。
- `m3_doc = vec("BAAI/bge-m3", doc)` 用 bge-m3 编码文档,相当于「建索引」。
- `zh_doc = vec("BAAI/bge-large-zh-v1.5", doc)` 同一篇文档用另一个模型再编一次,只为了比较。
- `m3_query = vec("BAAI/bge-m3", query)` 正确的查询:和索引同一个模型。
- `zh_query = vec("BAAI/bge-large-zh-v1.5", query)` 错误的查询:换了模型。
- `print("两个模型的维度:", m3_doc.shape, zh_doc.shape)` 都是 `(1024,)`,`@` 不会报错。
- `m3_doc @ zh_doc` 同一句话、两个模型,两个向量的余弦。
- `zh_query @ m3_doc` 事故现场:bge-large-zh 的问题向量去比 bge-m3 的文档向量。

</div>

```bash
uv run python -m part04.emb_two_models
```

真实输出:

```text
两个模型的维度: (1024,) (1024,)
同一句话,两个模型的向量余弦: 0.015
都用 bge-m3:       问题 vs 退款政策 0.7442
都用 bge-m3:       天气 vs 退款政策 0.3893
都用 bge-large-zh: 问题 vs 退款政策 0.721
混着用:            问题(zh) vs 退款政策(m3) 0.0251
```

第二行最说明问题:**同一句话**,两个模型给的向量余弦只有 0.015,几乎垂直。两个模型的 1024 维各自代表什么完全不同,就像两个人各自发明了一套坐标系。每个模型自己内部是讲理的:都用 bge-m3,问题和《退款政策》0.7442,天气只有 0.3893;都用 bge-large-zh,问题和《退款政策》0.721。一混用,0.0251,比无关的天气句还低得多。

更糟的是整个过程没有一个报错。真实事故通常是这样发生的:有人在 `.env` 里把 `EMB_MODEL` 换成了「据说更好」的新模型,查询立刻用上了新模型,但索引是三个月前用旧模型建的,没人重建。检索结果变成随机的,模型拿着不相关的资料一本正经地回答,用户投诉「最近答得乱七八糟」。

所以铁律是:**换 embedding 模型 = 全量重建索引**。工程上的做法是把模型名和索引存在一起,查询前核对一遍,不一致就拒绝查询。Day 225 把索引存成文件时,你可以顺手多存一个模型名。

## 动手练习

**练习 1:数 token,算一笔账。** 分别对空字符串、「退款」、一句中文、一句英文、一句带错误码的中文各调一次 embedding,打印 token 数和字符数。再估算:CloudLedger 帮助中心如果有 1 万篇文章、每篇 800 字,在硅基流动 bge-m3、Pro/bge-m3、百炼 text-embedding-v4 上各要多少钱。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_emb_tokens.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])
MODEL = os.environ["EMB_MODEL"]

samples = [
    "",
    "退款",
    "年付套餐买错了能把钱要回来吗",
    "How do I get a refund for my annual plan?",
    "导入银行流水时报错 E1042",
]
for s in samples:
    r = client.embeddings.create(model=MODEL, input=[s])
    print(f"{r.usage.prompt_tokens:>3} token  {len(s):>3} 个字符  {s!r}")

chars_per_doc = 800
docs = 10_000
tokens = chars_per_doc * docs
for name, price in [("硅基流动 bge-m3", 0.0), ("硅基流动 Pro/bge-m3", 0.07), ("百炼 text-embedding-v4", 0.5)]:
    print(f"{name}: {tokens:,} token × {price} 元/百万 = {tokens / 1_000_000 * price:.2f} 元")
```

<div class="line-notes">

- `samples = [` 五条样本。这里直接调 SDK 而不用 `common.embed`,因为 `embed()` 会拒绝空字符串,而我们正想看空字符串收几个 token。
- `r = client.embeddings.create(model=MODEL, input=[s])` 每条单独一次,才能拿到每条各自的 token 数。
- `f"{r.usage.prompt_tokens:>3} token  {len(s):>3} 个字符  {s!r}"` `:>3` 右对齐占 3 格;`len(s)` 是字符数,一个汉字算 1。
- `docs = 10_000` 数字里的下划线只是为了好读,等于 10000,JS 里也能这么写。
- `tokens = chars_per_doc * docs` 粗估:按 1 个字 1 个 token 算,800 万 token。依据就是上面实测的中文基本是一字一 token。
- `{tokens:,}` `:,` 加千分位逗号。同一行的 `tokens / 1_000_000 * price`:价格是「元/百万 token」,先除以一百万再乘单价。

</div>

```bash
uv run python -m part04.ex_emb_tokens
```

真实输出:

```text
  2 token    0 个字符  ''
  5 token    2 个字符  '退款'
 14 token   14 个字符  '年付套餐买错了能把钱要回来吗'
 13 token   41 个字符  'How do I get a refund for my annual plan?'
 13 token   15 个字符  '导入银行流水时报错 E1042'
硅基流动 bge-m3: 8,000,000 token × 0.0 元/百万 = 0.00 元
硅基流动 Pro/bge-m3: 8,000,000 token × 0.07 元/百万 = 0.56 元
百炼 text-embedding-v4: 8,000,000 token × 0.5 元/百万 = 4.00 元
```

空字符串也收 2 个 token,这是模型给每条输入加的首尾标记。中文基本一字一 token(「退款」2 个字收 5 个,是因为短文本里首尾标记占比大);英文 41 个字符只要 13 个 token,一个 token 大约一个单词,[Day 108](/blog/agent-zero/day-108-tokens-2/) 讲过中文为什么费 token。一万篇文章建一次索引最贵也就 4 块钱。embedding 便宜到可以忽略,真正花钱的是 Day 226 把检索结果塞进 prompt 让聊天模型读。

</details>

**练习 2:不改代码,把批大小临时改成 3。** 用命令行环境变量让 `common/embed.py` 的自测按 3 条一批发,看请求次数变成多少,并解释为什么 `.env` 里写的 10 没有生效。

<details><summary>参考答案</summary>

```bash
EMB_BATCH=3 uv run python -m common.embed
```

真实输出(只看第三行,其余和上面一样):

```text
请求次数: 4  token: 138
```

12 条按 3 条一批,`range(0, 12, 3)` 产生 0、3、6、9 四个起点,所以是 4 次请求;token 还是 138,批大小不影响 token。

`.env` 里写的 10 没生效,是因为 `load_dotenv()` 默认不覆盖已经存在的环境变量。命令行前面的 `EMB_BATCH=3` 在 Python 启动前就设好了,`load_dotenv` 看到它已经有值,就跳过 `.env` 里那一行。前端里 `VITE_X=1 npm run dev` 覆盖 `.env` 里的值,是同一个优先级规则。这个技巧排查问题时很好用:临时换个模型、临时换个批大小,都不用改文件。

</details>

**练习 3:跳过空段落,但保住下标。** 一篇文章切出 5 段,其中第 1、3 段是空的。只把非空段落送去 `embed`,并且之后还能用原来的下标(0–4)查到每段的向量。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_skip_empty.py
import numpy as np

from common.embed import embed, usage

paragraphs = ["退款政策", "", "年付套餐中途取消按剩余整月退款", "   ", "月付不退"]

keep = [i for i, p in enumerate(paragraphs) if p.strip()]
print("要送去 embedding 的下标:", keep)

vecs = embed([paragraphs[i] for i in keep])
print("拿回来的形状:", vecs.shape)

by_index = dict(zip(keep, vecs, strict=True))
print("第 2 段的向量前 3 个数:", np.round(by_index[2][:3], 4))
print("第 1 段有没有向量:", 1 in by_index)
print("请求次数:", usage["requests"])
```

<div class="line-notes">

- `from common.embed import embed, usage` 今天写的模块。必须从根目录用 `-m` 跑,否则找不到 `common`。
- `keep = [i for i, p in enumerate(paragraphs) if p.strip()]` `enumerate` 同时给出下标和内容;`p.strip()` 去掉首尾空白后为空字符串就是「假」,被过滤掉。实测 `[0, 2, 4]`。
- `vecs = embed([paragraphs[i] for i in keep])` 只送三段,得到 `(3, 1024)`。
- `by_index = dict(zip(keep, vecs, strict=True))` 把原下标和向量配对成字典 `{0: 向量, 2: 向量, 4: 向量}`,相当于 JS 的 `Object.fromEntries(keep.map((k, j) => [k, vecs[j]]))`。遍历二维数组每次拿到一行,所以 `zip` 配的是「下标, 一行向量」。
- `by_index[2][:3]` 用原来的下标 2 取向量,再看前三个数。
- `1 in by_index` 第 1 段是空的,字典里没有它。

</div>

```bash
uv run python -m part04.ex_skip_empty
```

真实输出:

```text
要送去 embedding 的下标: [0, 2, 4]
拿回来的形状: (3, 1024)
第 2 段的向量前 3 个数: [-0.0197  0.0463 -0.0389]
第 1 段有没有向量: False
请求次数: 1
```

为什么不在 `embed` 里面自动跳过空文本?因为那样返回的行数会比输入少,调用方按位置对号入座就全乱了,第 3 行其实是第 4 段。`embed` 保证「进 N 条、出 N 行」,过滤这件事交给调用方显式地做,下标关系一目了然。

</details>

**练习 4(观察题):维度能不能改小?** 硅基流动上的 `Qwen/Qwen3-Embedding-0.6B` 支持 `dimensions` 参数。分别用 1024 维和 256 维编码「年付套餐买错了能把钱要回来吗」「退款政策…」「今天北京天气不错」三句,比较问题和另外两句的余弦,以及每条向量的存储大小。再试试给 bge-m3 传 `dimensions=256` 会怎样。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_qwen_dims.py
import os

import numpy as np
from dotenv import load_dotenv
from openai import BadRequestError, OpenAI

load_dotenv()

client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])
texts = ["年付套餐买错了能把钱要回来吗", "退款政策:年付套餐中途取消的,按剩余的整月数比例退款", "今天北京天气不错"]

for dims in [1024, 256]:
    r = client.embeddings.create(model="Qwen/Qwen3-Embedding-0.6B", input=texts, dimensions=dims)
    v = np.array([d.embedding for d in r.data])
    v = v / np.linalg.norm(v, axis=1, keepdims=True)
    print(f"{dims} 维:问题-退款 {v[0] @ v[1]:.4f}  问题-天气 {v[0] @ v[2]:.4f}  每条 {v.shape[1] * 4} 字节")

try:
    client.embeddings.create(model="BAAI/bge-m3", input=texts[:1], dimensions=256)
except BadRequestError as e:
    print("bge-m3 带 dimensions:", e.status_code, e.body)
```

<div class="line-notes">

- `client.embeddings.create(model="Qwen/Qwen3-Embedding-0.6B", input=texts, dimensions=dims)` `dimensions` 是 OpenAI 协议里的可选参数,要求服务端直接返回指定长度的向量。硅基流动文档写明只有 Qwen3 系列支持,0.6B 可选 64 到 1024。
- `v = v / np.linalg.norm(v, axis=1, keepdims=True)` 自己再归一化一次,保证点积就是余弦。
- `v.shape[1] * 4` 维度乘以 4 字节,按 `float32` 存储估算。
- `client.embeddings.create(model="BAAI/bge-m3", input=texts[:1], dimensions=256)` bge-m3 不支持这个参数。

</div>

```bash
uv run python -m part04.ex_qwen_dims
```

真实输出:

```text
1024 维:问题-退款 0.7703  问题-天气 0.2685  每条 4096 字节
256 维:问题-退款 0.7935  问题-天气 0.2152  每条 1024 字节
bge-m3 带 dimensions: 400 {'code': 20015, 'message': 'The parameter is invalid. Please check again.', 'data': None}
```

截到 256 维以后,排序没变(退款远高于天气),存储只要四分之一。三句话太少,不能说明 256 维和 1024 维效果一样,但能看出「维度可以用存储换一点精度」这个方向,Day 220 讲维度和成本时会接着说。bge-m3 带上 `dimensions` 又是那句「参数无效」,和文本太长时的报错一字不差,所以看到这个 400 时,长度和参数两个方向都要查。

这道题用的 Qwen3-Embedding-0.6B 是付费的,价格页上写 ¥0.07/百万 token。两次请求一共不到 100 个 token,花费不到 0.00001 元。

</details>

**验收标准:** `uv run python -m common.embed` 跑出和上面一样形状、长度、请求次数的输出;能说出 DeepSeek 调 embedding 为什么是 404 而不是 401;能解释批量省的是什么、不省的是什么;能用 `emb_two_models.py` 里的 0.015 和 0.0251 两个数说明为什么换模型必须重建索引。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| embedding / 嵌入 | 一段文字经过模型得到的一串固定长度的小数,意思相近的文字方向相近。bge-m3 给 1024 个数 |
| embedding 模型 | 专门把文字变成向量的模型,只吃输入、不生成文字,按输入 token 收费 |
| bge-m3 | 北京智源研究院开源的多语言 embedding 模型,1024 维,单条最长 8192 token,硅基流动上免费 |
| 硅基流动(SiliconFlow) | 国内的模型 API 平台,接口兼容 OpenAI,课程用它做 embedding 和后面的 rerank |
| `client.embeddings.create` | openai SDK 调 embedding 的方法,对应 `POST /embeddings`,`input` 传字符串列表 |
| `data[i].index` | 响应里每个向量对应第几条输入,批量时按它对号入座 |
| 批量(batch) | 一次请求发多条文本,省请求次数和时间,不省 token |
| 批大小(batch size) | 一次请求最多发几条。百炼上限 10,硅基流动实测 2000 条也能过 |
| `float32` | 每个数占 4 字节的小数类型,比 Python 默认的 `float64` 省一半,存向量够用 |
| `dimensions` 参数 | 让服务端直接返回更短的向量,只有部分模型支持(如 Qwen3-Embedding) |
| 索引和查询同模型 | 文档向量和问题向量必须出自同一个模型,混用不报错但结果没有意义 |

## 常见误区

**以为 OpenAI 兼容就什么接口都有。** 兼容的是请求格式,不是功能清单。DeepSeek 兼容 OpenAI 的聊天接口,但没有 embedding,调了就是 404。用之前看文档里列了哪些接口。

**一条一条调 embedding。** 实测 20 条单发 2.39 秒,一批 0.20 秒。几百段文本单发要等一两分钟,而且更容易撞上限速([Day 128](/blog/agent-zero/day-128-rate-limit/))。

**拿 `==` 比较两次的向量。** 同一句话发两次,逐位最大差 0.0012;单发和批量 0.0026。这是服务端浮点计算的正常抖动,比较要用余弦或 `np.allclose` 加宽容差。写测试时别断言向量的某一位等于多少。

**看到 400「参数无效」只查参数。** 硅基流动对文本太长、传了不支持的 `dimensions`,都回同一句 `The parameter is invalid`。先查最长那条有多少 token,再查参数。

**相信文档说的「空字符串会报错」。** 实测不报错,还返回一个和什么都 0.55 左右相似的向量。不管服务端怎么处理,空文本都在自己这一侧拦住。

**换了 `EMB_MODEL` 没重建索引。** 两个模型都是 1024 维,不报错;同一句话两个模型的向量余弦 0.015,混用以后问题和正确文章的余弦 0.0251。换模型就是全量重建。

**在 `embed` 里偷偷截断超长文本。** 截断会把文章后半段悄悄丢掉,检索时那部分内容永远搜不到,而你不会知道。宁可报错,把长文本交给切块。

## 学习资料

### 文档与文章

- [硅基流动 · 创建嵌入请求](https://docs.siliconflow.cn/docs/api/embeddings-post):今天用的接口的官方文档。看各模型的最大 token 数(bge-m3 8192、bge-large-zh-v1.5 512、Qwen3-Embedding 32768)和 `dimensions` 只支持 Qwen3 系列那两段。
- [硅基流动 · 价格页](https://siliconflow.cn/pricing):找「嵌入」那一栏,确认 bge-m3 还是不是免费。
- [阿里云百炼 · 文本向量](https://help.aliyun.com/zh/model-studio/embedding):如果你用百炼,看批大小 10 条和 8192 token 的限制,以及 base_url 怎么填。
- [OpenAI · Embeddings 指南](https://developers.openai.com/api/docs/guides/embeddings):看「How to get embeddings」的示例,和今天的代码几乎一样;再看 `dimensions` 参数那段,讲的就是练习 4。
- [BAAI/bge-m3 模型卡](https://huggingface.co/BAAI/bge-m3):模型作者写的说明,看开头介绍它支持的语言、长度和三种检索方式(今天只用到其中的稠密向量那一种)。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oNv8BPE2m&autoplay=0&high_quality=1" title="15分钟弄懂Token和Embedding -- 详解LLM与RAG的数据处理机制" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · 15分钟弄懂Token和Embedding -- 详解LLM与RAG的数据处理机制 · 15 分钟。把 token 和 embedding 放在一条线上讲,正好对应今天「按 token 计费、输出一串向量」这两件事。</figcaption>
</figure>

- Boujoy的日记《一条视频搞懂Embedding 向量空间和余弦相似度!》(BV1vfNk6hEvp,10 分钟):Day 215 推荐过,今天有了真向量再看一遍,体会会不一样。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/OATCgQtNX2o" title="Text embeddings & semantic search" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hugging Face · Text embeddings & semantic search · 英文。Hugging Face 课程里的一集,讲句子怎么变成向量、再拿向量做语义搜索,和今天加明天的内容是一回事。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/8kJStTRuMcs" title="OpenAI Embeddings Explained in 5 Minutes" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Cooper Codes · OpenAI Embeddings Explained in 5 Minutes · 英文,5 分钟。用 OpenAI 的接口走一遍调用,你会发现代码和今天调硅基流动的几乎一模一样。</figcaption>
</figure>

### 书籍

- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024),中文版《图解大模型:生成式AI原理与实践》(人民邮电出版社,2025)。第 2 章讲 token 和 embedding 是怎么来的,第 8 章讲语义搜索,今天读第 2 章。
- Chip Huyen《AI Engineering》(O'Reilly,2025)。第 6 章「RAG and Agents」讲检索增强,里面有 embedding 检索的部分,适合读完 Day 221 讲 RAG 为什么存在以后再看。

### 开源项目与代码

- [FlagOpen/FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding):bge 系列的官方仓库。如果以后要在自己机器上跑 bge-m3(需要显卡才快),从这里开始。
- [openai/openai-python](https://github.com/openai/openai-python):openai SDK 源码。想看 `embeddings.create` 到底发了什么请求,搜 `embeddings.py`。
- [MTEB 排行榜](https://huggingface.co/spaces/mteb/leaderboard):embedding 模型的公开榜单,Day 220 讲怎么挑模型时会用,今天先认个门。

## 自测

**1. 拿 DeepSeek 的 base_url 调 `client.embeddings.create`,报 `NotFoundError: Error code: 404`。这是 key 错了吗?怎么解决?**

<details><summary>答案</summary>

不是。key 错是 401。404 是「地址不存在」:DeepSeek 没有 `/embeddings` 接口。解决办法是另配一家 embedding 服务,在 `.env` 里单独放一组 `EMB_BASE_URL`、`EMB_API_KEY`、`EMB_MODEL`,和聊天的 `LLM_*` 分开。

</details>

**2. 25 条文本,`EMB_BATCH=10`,`embed()` 会发几次请求?每次各几条?**

<details><summary>答案</summary>

3 次。`range(0, 25, 10)` 产生 0、10、20,三批分别是 `texts[0:10]` 10 条、`texts[10:20]` 10 条、`texts[20:30]` 5 条(切片超出末尾不报错)。

</details>

**3. `embed()` 里为什么要 `sorted(resp.data, key=lambda d: d.index)`?不排序会怎样?**

<details><summary>答案</summary>

`index` 标明每个向量对应第几条输入。接口约定是按顺序返回,实测也是按顺序的,但如果哪天某个服务打乱了顺序而你没排序,第 3 段文字会配上第 5 段的向量,检索结果全错,而且不报错,很难查。排序只多一行,买的是确定性。

</details>

**4. 同事说:「我把 `EMB_MODEL` 从 bge-m3 换成了 bge-large-zh-v1.5,都是 1024 维,不用重建索引吧?」你怎么回?**

<details><summary>答案</summary>

必须重建。维度相同只保证 `@` 不报错,不保证结果有意义。两个模型各自的 1024 维代表的东西完全不同,实测同一句话在两个模型下的向量余弦只有 0.015;用新模型编码问题去比旧模型的文档向量,问题和正确文章的余弦掉到 0.0251。另外 bge-large-zh-v1.5 单条只能 512 token,原来按 bge-m3 的 8192 切的块可能直接超长报 400。

</details>

**5. 面试题:「你们的 RAG 系统突然开始答非所问,检索日志里分数都很低但没有任何报错。你会先查什么?」**

<details><summary>答案</summary>

先查索引和查询用的 embedding 模型是否一致。这是「没报错但全错」最典型的原因:有人改了查询侧的模型配置,索引没重建,维度如果碰巧一样就不会有任何异常,分数会整体掉到接近 0。具体做法:打印查询时实际用的模型名(响应里的 `model` 字段),和索引元数据里记录的模型名比较;拿索引里的一篇文档原文,用当前查询模型重新编码,和库里存的向量算余弦,正常应该接近 1(会有 0.999 左右的浮点抖动),如果只有零点零几就确认是模型不一致。排除了这个,再查是不是有空文档或超长文本被截断进了索引、切块方式有没有变。预防上,把模型名和索引存在一起,查询前核对,不一致就拒绝服务并报警。

</details>

## 明天预告

明天是 [Day 218 · 实验:一张相似度矩阵](/blog/agent-zero/day-218-sim-matrix/)。今天的 `common/embed.py` 一次能把一批句子变成 `(N, 1024)` 的数组,明天就用它把六句 CloudLedger 客服的话两两比一遍,得到一张 6×6 的表。你会学怎么读这张表:对角线、对称、每行找最像的那一句,以及为什么「年付套餐买错了」会和「发票抬头填错了」意外地相似。Day 215 留下的那句「看排序,别看绝对阈值」,明天用真实数字来验证。
