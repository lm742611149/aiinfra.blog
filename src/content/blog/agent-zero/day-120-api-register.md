---
title: 'Day 120 · 注册 API、充值和第一次调用'
description: '这门课第一次自己拿 API key:在 DeepSeek 开放平台实名、充值、建 key,写进 .env 并确认 git 不会提交它,装 openai SDK,用十几行的 ask.py 完成第一次调用,算出这一次花了 0.00014 元。然后把最常见的五种报错各制造一次:.env 丢了、没用 uv run、key 写错、key 后面多了个空格、模型名拼错,贴出原文和修法。'
pubDate: 2026-10-22
regime: none
tags: ['api', 'deepseek', 'python', 'agent-zero']
series: 'agent-zero'
day: 120
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 119](/blog/agent-zero/day-119-local-models-intro/) 算了「自己跑模型」这条路的账:4 位量化后每 1B 参数约 0.6 GB,16 GB 的笔记本上限是 9B 左右,生成速度上限是内存带宽除以每个 token 要读的数据量,我这台 2019 款 Intel Mac 跑 9B 每秒只有两个 token 左右。结论是本地模型适合隐私场景和批量小任务,这门课的主路还是调厂商的 API。

从 [Day 108](/blog/agent-zero/day-108-tokens-2/) 起,好几篇里都有一段「这段要调 API,你现在不用跑,看我的结果」。今天就把这个欠账还上:你会拿到自己的 key,亲手跑通第一次调用。从明天起,文章里调 API 的代码你都要自己跑。

## 今天要解决的问题

学完今天,你应该能做到:

1. 在 DeepSeek 开放平台完成实名认证、充值 10 元、创建一个 API key,并说清楚 key 丢了或泄露了怎么办。
2. 把 key 和 `base_url` 写进 `agent-zero-lab/.env`,用 `git check-ignore` 和 `git status` 确认它不会被提交。
3. 装好 openai SDK,写出 `part02/ask.py`,从命令行问一个问题、拿到回答和 token 用量,并按价格表算出这次花了多少钱。
4. 看到 `KeyError`、`ModuleNotFoundError`、`401`、`Connection error`、`400` 这五种报错时,知道分别是哪一步出了问题。

今天只有两个新概念:**API key**(你的身份和钱包)和 **base_url**(请求发到哪台服务器)。请求里每个字段是什么,明天 Day 121 拆;响应里每个字段是什么,Day 122 拆。

预计用时:2 小时左右,其中实名认证和充值大约 15 分钟。今天的实跑花费不到 0.01 元(文末有算式),但要先充值,我建议充 10 元。前置:[Day 2](/blog/agent-zero/day-002-setup-budget/) 注册过 DeepSeek 开放平台(没注册今天注册也行)、[Day 10](/blog/agent-zero/day-010-uv-1/) 的 `uv add` 和 `uv run`、[Day 53](/blog/agent-zero/day-053-env-secrets/) 的 `.env`、python-dotenv 和 `.gitignore`、[Day 56](/blog/agent-zero/day-056-git-1/) 的 `git status`、[Day 60](/blog/agent-zero/day-060-http-2/) 的状态码和 header。

学法提示:注册和充值照着做一遍就行;代码部分先对照逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `ask.py` 默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 先看全景:key 从哪来,到哪去

动手之前先看一张图。今天做的所有事,就是把一串叫 API key 的字符,从 DeepSeek 的网站搬到你代码发出去的每一个请求里。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="API key 从开放平台到 .env、再到请求头、最后由 DeepSeek 校验并扣费的路径">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="170" height="80" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="105" y="52" text-anchor="middle" fill="var(--mem)">DeepSeek 开放平台</text>
<text x="105" y="74" text-anchor="middle" fill="var(--ink)">实名 → 充值</text>
<text x="105" y="94" text-anchor="middle" fill="var(--ink)">创建 key(只显示一次)</text>
<rect x="235" y="30" width="170" height="80" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="52" text-anchor="middle" fill="var(--compute)">agent-zero-lab/.env</text>
<text x="320" y="74" text-anchor="middle" fill="var(--ink)">LLM_BASE_URL=...</text>
<text x="320" y="94" text-anchor="middle" fill="var(--ink)">LLM_API_KEY=sk-...</text>
<rect x="450" y="30" width="170" height="80" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="52" text-anchor="middle" fill="var(--compute)">ask.py</text>
<text x="535" y="74" text-anchor="middle" fill="var(--ink)">load_dotenv()</text>
<text x="535" y="94" text-anchor="middle" fill="var(--ink)">OpenAI(base_url, key)</text>
<line x1="190" y1="70" x2="235" y2="70" stroke="var(--ink-soft)"/>
<text x="212" y="64" text-anchor="middle" fill="var(--ink-faint)">复制</text>
<line x1="405" y1="70" x2="450" y2="70" stroke="var(--ink-soft)"/>
<text x="427" y="64" text-anchor="middle" fill="var(--ink-faint)">读</text>
<rect x="150" y="150" width="340" height="44" rx="6" fill="none" stroke="var(--ink-soft)"/>
<text x="320" y="170" text-anchor="middle" fill="var(--ink)">POST {base_url}/chat/completions</text>
<text x="320" y="186" text-anchor="middle" fill="var(--ink-soft)">Authorization: Bearer sk-...</text>
<line x1="535" y1="110" x2="440" y2="150" stroke="var(--ink-soft)"/>
<line x1="200" y1="150" x2="105" y2="110" stroke="var(--ink-soft)"/>
<text x="20" y="140" fill="var(--mem)">校验 key、算 token、扣余额</text>
<text x="20" y="226" fill="var(--ink-faint)">.env 只在你电脑上;.gitignore 挡住它,不进 git、不进前端代码</text>
</g>
</svg>
<figcaption>key 的一生。蓝色是厂商那边,琥珀色是你电脑上的文件。请求发出去时 key 放在 Authorization 头里,DeepSeek 靠它认出是你、从你的余额里扣钱。</figcaption>
</figure>

**API key** 是一串 `sk-` 开头的字符,作用有两个:证明「这个请求是你发的」,以及「从你的余额里扣钱」。前端同学可以把它想成一个永不过期的登录 token,而且绑着你的钱包。任何人拿到它,都能用你的余额调模型,所以它的保管要求和密码一样。

**base_url** 是请求要发去的服务器地址。DeepSeek 的是 `https://api.deepseek.com`。SDK 会在它后面拼上具体的路径,比如对话接口是 `/chat/completions`,完整地址就是 `https://api.deepseek.com/chat/completions`。这和前端里 `axios.create({ baseURL: "https://api.example.com" })` 之后再 `axios.post("/users")` 是一回事。为什么要单独配置它?因为 Day 123 会讲,国内外很多厂商都兼容同一套接口格式,换厂商时代码不动,换掉 `base_url`、key 和模型名三个值就行。

## 第一步:登录开放平台,完成实名认证

打开 [platform.deepseek.com](https://platform.deepseek.com),用手机号登录。Day 2 说过,这个「开放平台」和聊天用的 chat.deepseek.com 不是一个地方:账号是通用的,但网页聊天免费,API 要在开放平台单独充值、按 token 扣钱。

登录后左边有一列菜单,今天会用到四个:「API keys」「充值」「用量信息」「账单」。我写这篇时没有办法替你截图,页面布局可能会改版,以你看到的为准,找这几个名字就行。

**先实名认证。** DeepSeek 官方 FAQ 写的是「完成实名认证后,您可以在『充值』页面使用支付宝/微信进行在线充值」,也就是说不实名充不了钱。点「充值」,页面会引导你去认证。个人认证和企业认证在功能上没有区别(FAQ 原话:「在用户权益和产品功能上目前无差异」),自己学习选个人。如果认证失败,FAQ 列的常见原因是同一个证件号绑定的账号太多,或者证件号连续输错被临时锁定。

## 第二步:充值

认证完回到「充值」页面,用支付宝或微信付款。具体有哪几档金额、能不能自定义,以页面为准。**我建议先充 10 元**,理由下面会算:今天第一次调用花了 0.00014 元,10 元够这样的调用好几万次;Day 2 给的建议也是这一天先充 10 到 20 元。

充值之前,有几条规则值得知道(都来自 DeepSeek 官方 FAQ 和价格页,2026 年 10 月查):

- **余额不会过期。**FAQ 原话是「您的充值余额永久有效,不会过期」。所以不用怕充多了浪费。
- **没用完的可以退。**「未消费金额支持退款」,在「账单」页面的「退款管理」里自助操作。
- **赠送余额优先扣。**如果平台给过你赠送余额,两者并存时先扣赠送的。
- **注销账号后余额不能转。**重新注册的新账号和旧账号互相独立。

充完在「账单」页面能看到充值记录。

## 第三步:创建 API key

点「API keys」,再点「创建 API key」,名字随便起,建议写清楚用途,比如 `agent-zero-lab`。以后你可能会给不同项目各建一个 key,名字清楚,出了问题好知道是哪个漏了;FAQ 里也说「用量信息」页面可以按 key 分开看用量。

点确定后,会弹出一串 `sk-` 开头的字符。**这串字符只显示这一次**,关掉窗口就再也看不到了。马上点复制,先粘贴到一个临时的地方,等下第四步写进 `.env`。万一没复制就关了,也不要紧:删掉这个 key 重新建一个就行,key 不花钱。

如果哪天 key 泄露了(比如不小心提交到了公开的 GitHub 仓库、贴到了群里),马上去「API keys」页面,点那个 key 后面的回收站图标删掉,确认后它立刻失效,然后建一个新的换上。FAQ 原话还有一句:「不要与他人共享,或将其暴露在浏览器或其他客户端代码中。」

最后这句对前端同学特别重要。你写 Vite 项目时用过 `VITE_` 开头的环境变量吧?那些变量在构建时会被**原样打进 JS 包**,任何用户打开 DevTools 的 Sources 面板都能看到。所以 API key 永远不能放进前端代码,哪怕写在 `.env.local` 里也不行;前端要用模型,必须经过你自己的后端转发(Day 79 起学的 FastAPI 就是干这个的)。今天的 key 只在你电脑上的 Python 脚本里用。

## 第四步:写进 .env,并确认 git 不会提交它

[Day 53](/blog/agent-zero/day-053-env-secrets/) 学过 `.env`:一个放在项目根目录、每行 `名字=值` 的文本文件,python-dotenv 读它,把每一行放进环境变量。今天正式往里写真东西。

在 `agent-zero-lab` 根目录新建(或打开)`.env`,写三行:

```bash
# agent-zero-lab/.env
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-你刚复制的那串
LLM_MODEL=deepseek-flash
```

<div class="line-notes">

- `LLM_BASE_URL=https://api.deepseek.com` 请求发去的地址。DeepSeek 文档首页给的就是这个,末尾不用加斜杠。我试过写成 `https://api.deepseek.com/v1` 也能通,但官方示例不带 `/v1`,我们跟官方走。
- `LLM_API_KEY=sk-你刚复制的那串` 等号两边**不要加空格**,值**不要加引号**,后面**不要多一个空格**。后面会实测「引号里多一个空格」会出什么事。
- `LLM_MODEL=deepseek-flash` 模型名。2026 年 10 月 DeepSeek 只有两个:`deepseek-flash`(背后是 DeepSeek-V4.1-Flash-1017)和 `deepseek-v4-pro`。这门课默认用便宜的 flash。名字放在 `.env` 里而不是写死在代码里,是因为厂商隔几个月就改一次模型名。

</div>

三个变量名统一叫 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`,整门课都用这三个名字。DeepSeek 官方示例里的变量名是 `DEEPSEEK_API_KEY`,我们不用它,因为换厂商时不想改变量名。

`.env` 以点开头,在 macOS 的 Finder 里默认是隐藏的,按 `Cmd + Shift + .` 能显示;终端里用 `ls -a`。

接下来确认 git 不会提交它。Day 53 你应该已经在 `.gitignore` 里写过 `.env` 了,但这件事值得每次都验证一遍。我在一个用 uv 0.13 新建的项目里试过,`uv init` 自动生成的 `.gitignore` 里**没有** `.env` 这一行:

```bash
git check-ignore -v .env
echo $?
```

实跑输出(还没加的时候):

```text
1
```

`git check-ignore` 什么都没打印,`echo $?` 显示上一条命令的退出码是 1,意思是「这个文件没有被忽略」,下一次 `git add .` 它就会进仓库。打开 `.gitignore`,在末尾加上:

```bash
# agent-zero-lab/.gitignore 末尾
# 密钥
.env
.env.*
!.env.example
```

<div class="line-notes">

- `.env` 忽略 `.env` 本身。
- `.env.*` 忽略 `.env.local`、`.env.ollama` 这类变体。Day 428 会建一个 `.env.ollama`。
- `!.env.example` 感叹号表示「上面那条规则的例外」:`.env.example` 要提交,它是给别人看的模板,里面只放占位符。练习 3 会建它。

</div>

再查一次:

```bash
git check-ignore -v .env
```

实跑输出:

```text
.gitignore:13:.env	.env
```

这次打印出了「`.gitignore` 第 13 行的 `.env` 规则匹配了 `.env` 文件」,说明已经被忽略了。行号取决于你的 `.gitignore` 有多长,不用和我一样。最后跑一下 `git status`,确认待提交的列表里没有 `.env`。

## 第五步:装 openai SDK

DeepSeek 没有自己的 Python SDK,它让大家直接用 OpenAI 官方的 SDK,因为它的接口和 OpenAI 的格式一样(Day 123 讲为什么)。在 `agent-zero-lab` 根目录:

```bash
uv add openai python-dotenv
```

<div class="line-notes">

- `uv add openai python-dotenv` 一次装两个包,相当于 `npm install openai dotenv`。python-dotenv 你 Day 53 可能已经装过了,uv 发现版本满足就不会重复装。

</div>

我 2026 年 10 月 22 日装到的是 `openai==3.36.1`(当天刚发布)和 `python-dotenv==1.2.4`。uv 输出的列表里你会看到 `openai` 还顺带装了十几个依赖,其中有 `httpx2` 和 `pydantic`:openai SDK 底层用 httpx2 发 HTTP 请求(httpx 的新一代,和 Day 64 学的 httpx 用法基本一样,是两个独立的包,互不影响),用 pydantic([Day 51](/blog/agent-zero/day-051-pydantic-1/))把返回的 JSON 变成带类型的对象。装完 `pyproject.toml` 的 `dependencies` 里会多出 `"openai>=3.36.1"` 这样一行。

## 第六步:先确认 .env 读到了,但不打印 key

第一次调用之前,先写一个不花钱的小脚本,确认三个变量都读进来了。这一步看起来多余,但它能把「配置问题」和「网络/账号问题」分开:这一步过了,后面再报错就不是 `.env` 的事。

新建 `part02/env_check.py`:

```python
# agent-zero-lab/part02/env_check.py
import os

from dotenv import load_dotenv

print("读之前:", "LLM_API_KEY" in os.environ)
found = load_dotenv()
print("找到 .env 了吗:", found)
print("读之后:", "LLM_API_KEY" in os.environ)

key = os.environ["LLM_API_KEY"]
print("BASE_URL =", os.environ["LLM_BASE_URL"])
print("MODEL    =", os.environ["LLM_MODEL"])
print("KEY 开头 =", key[:3], f"长度 {len(key)}")
print("KEY 前后有空格吗:", key != key.strip())
```

<div class="line-notes">

- `import os` 用它的 `os.environ`:当前进程的环境变量,相当于 Node 的 `process.env`。
- `from dotenv import load_dotenv` 包名叫 python-dotenv,import 时叫 `dotenv`,两个名字对不上是正常的。
- `print("读之前:", "LLM_API_KEY" in os.environ)` `in` 判断字典里有没有这个键,相当于 JS 的 `"LLM_API_KEY" in process.env`。实跑是 `False`。
- `found = load_dotenv()` 读 `.env`,把每一行塞进环境变量。它从**脚本所在的目录**开始往上一级一级找 `.env`:脚本在 `part02/`,找不到就去上一级 `agent-zero-lab/`,在那找到了。返回值 `True` 表示找到并读了文件。
- `print("读之后:", "LLM_API_KEY" in os.environ)` 读完变成 `True`。
- `key = os.environ["LLM_API_KEY"]` 用方括号取值,没有这个变量就立刻报 `KeyError`,不会悄悄给你一个 `None`。这正是我们想要的:配置缺了就早点炸。
- `print("KEY 开头 =", key[:3], f"长度 {len(key)}")` **只打印前 3 个字符和长度**,不打印整串。终端输出可能会被截图、被录屏、被你贴到群里问问题,养成从不打印完整 key 的习惯。`key[:3]` 是切片,相当于 JS 的 `key.slice(0, 3)`。我的 key 长度是 35。
- `print("KEY 前后有空格吗:", key != key.strip())` `strip()` 去掉首尾空白,相当于 JS 的 `trim()`。去掉前后不相等,说明有空格。这一行是专门防后面要演示的那个坑。

</div>

```bash
uv run part02/env_check.py
```

实跑输出:

```text
读之前: False
找到 .env 了吗: True
读之后: True
BASE_URL = https://api.deepseek.com
MODEL    = deepseek-flash
KEY 开头 = sk- 长度 35
KEY 前后有空格吗: False
```

开头是 `sk-`、长度 35、没有空格,配置没问题。你的长度如果和我不一样也正常,以平台显示的为准;要是长度明显短了一截,多半是复制时没选全。

## 第七步:第一次调用

新建 `part02/ask.py`:

```python
# agent-zero-lab/part02/ask.py
import os
import sys

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    base_url=os.environ["LLM_BASE_URL"],
    api_key=os.environ["LLM_API_KEY"],
)

question = sys.argv[1] if len(sys.argv) > 1 else "用一句话介绍你自己"

resp = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": question}],
    extra_body={"thinking": {"type": "disabled"}},
)

print(resp.choices[0].message.content)
print(resp.usage)
```

<div class="line-notes">

- `import sys` 用 `sys.argv` 读命令行参数,Day 44 的工单记事本用过。
- `from openai import OpenAI` OpenAI 官方 SDK 的客户端类。DeepSeek 兼容这套接口,所以用同一个类,只是地址换成 DeepSeek 的。
- `load_dotenv()` 和上一个脚本一样,把 `.env` 读进环境变量。这一行必须在下面用 `os.environ` 之前。
- `client = OpenAI(` 建一个客户端对象。这一步**还不会发请求**,只是把地址和 key 存起来,相当于前端的 `const api = axios.create({...})`。
- `base_url=os.environ["LLM_BASE_URL"],` 实跑值是 `https://api.deepseek.com`。不传这个参数的话,SDK 默认发去 OpenAI 自己的服务器 `https://api.openai.com/v1`,拿着 DeepSeek 的 key 去 OpenAI,只会得到 401。
- `api_key=os.environ["LLM_API_KEY"],` 你的 key。SDK 会把它放进每个请求的 `Authorization: Bearer sk-...` 头里(明天 Day 121 会把这个头打印出来看)。
- `question = sys.argv[1] if len(sys.argv) > 1 else "用一句话介绍你自己"` 命令行给了问题就用它,没给就用默认问题。`sys.argv[0]` 是脚本名,`[1]` 才是第一个参数。
- `resp = client.chat.completions.create(` **这一行才真正发出 HTTP 请求**:POST 到 `https://api.deepseek.com/chat/completions`。它是同步的,模型回答完之前,程序就停在这一行等着。DeepSeek 文档把这个接口叫「对话补全」。
- `model=os.environ["LLM_MODEL"],` 实跑值 `deepseek-flash`。
- `messages=[{"role": "user", "content": question}],` 发给模型的消息列表。现在只有一条「用户说的话」,Day 121 讲字段,Day 129 讲多轮。
- `extra_body={"thinking": {"type": "disabled"}},` 关掉 DeepSeek 默认开着的思考模式([Day 115](/blog/agent-zero/day-115-reasoning-models/) 讲过,开着会多一大段推理,按输出 token 收钱)。为什么要包一层 `extra_body`,明天讲。
- `print(resp.choices[0].message.content)` 回答正文。`choices` 是个列表,一般只有一个元素,所以取 `[0]`。这一串点号每一层是什么,Day 122 逐层拆。
- `print(resp.usage)` 这次用了多少 token,也就是账单。

</div>

在 `agent-zero-lab` 根目录运行:

```bash
uv run part02/ask.py
```

我的实跑输出:

```text
我是DeepSeek，由深度求索公司创造的AI助手，能帮你解答问题、处理文本、分析文件，还支持联网搜索，而且完全免费！
CompletionUsage(completion_tokens=34, prompt_tokens=8, total_tokens=42, completion_tokens_details=None, prompt_tokens_details=PromptTokensDetails(audio_tokens=None, cache_write_tokens=None, cached_tokens=0, image_tokens=None, text_tokens=None), prompt_cache_hit_tokens=0, prompt_cache_miss_tokens=8)
```

恭喜,这是你的第一次调用。你那边的回答措辞多半和我不一样,Day 110 讲过为什么。

先挑一个刺:它说自己「完全免费」。网页版聊天确实免费,可你刚刚是花钱调的 API。模型并不知道你是从哪个入口来的,它只是按训练时见过的说法接下去,这正是 [Day 114](/blog/agent-zero/day-114-hallucination/) 讲的幻觉,而且它出现在你的第一次调用里。

再看第二行的账单。`prompt_tokens=8` 是你的问题占了 8 个 token,`completion_tokens=34` 是回答用了 34 个;`prompt_cache_miss_tokens=8` 表示这 8 个输入都没命中缓存(Day 117 讲过缓存命中会便宜 50 倍)。这些字段 Day 122 逐个讲,今天先用它算钱。

我跑这次的时间是 10 月 22 日周四 19:28(北京时间),不在高峰时段(工作日 9–12 点、14–18 点),按空闲价:输入未命中 1 元、输出 4 元每百万 token(2026 年 10 月查 [DeepSeek 价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing),空闲价是高峰价的一半)。

8 × 1 ÷ 1,000,000 + 34 × 4 ÷ 1,000,000 = 0.000008 + 0.000136 = 0.000144 元

不到万分之二元。10 元除以 0.000144,大约能问 7 万次这样的问题。你在「用量信息」页面里大概要过几分钟才能看到这次调用,金额小到可能显示为 0.00。

换一个问题,从命令行传进去(问题里有空格或标点,要用引号包起来):

```bash
uv run part02/ask.py "发票抬头开错了能改吗?请用两句话回答。"
```

实跑输出:

```text
发票抬头开错了能否修改取决于发票类型和是否已跨月：增值税普通发票当月可作废重开、跨月需红冲后重开，增值税专用发票则无论是否跨月通常都需红冲后重开。建议尽快联系开票方按规定流程处理。
CompletionUsage(completion_tokens=61, prompt_tokens=18, total_tokens=79, completion_tokens_details=None, prompt_tokens_details=PromptTokensDetails(audio_tokens=None, cache_write_tokens=None, cached_tokens=0, image_tokens=None, text_tokens=None), prompt_cache_hit_tokens=0, prompt_cache_miss_tokens=18)
```

这个问题我们以后会一直用:它就是云簿 CloudLedger 的客服会被问到的那种问题。现在模型是按「一般常识」回答的,它根本不知道云簿的开票规则是什么;让它按我们自己的帮助中心文章回答,是第四部分 RAG 要做的事。

## 故意出错:五种最常见的报错

第一次调用最容易卡住的地方,我都替你踩了一遍。每个报错只贴最后一两行,Python 的报错从下往上读,最后一行说的是「出了什么事」,上面几行说的是「在哪出的事」([Day 35](/blog/agent-zero/day-035-exceptions-1/) 讲过)。

### 报错一:.env 不见了

我把 `.env` 临时改名成 `env.bak`,再运行:

```text
    base_url=os.environ["LLM_BASE_URL"],
             ~~~~~~~~~~^^^^^^^^^^^^^^^^
  File "<frozen os>", line 714, in __getitem__
KeyError: 'LLM_BASE_URL'
```

`KeyError: 'LLM_BASE_URL'` 意思是环境变量里没有这个名字。`load_dotenv()` 没找到文件不会报错(它只是返回 `False`),一直到用方括号取值时才炸。常见原因:文件名写错了(写成 `env`、`.env.txt`,macOS 的文本编辑器有时会偷偷加 `.txt`),或者文件放错了目录。修法:用 `ls -a` 在 `agent-zero-lab` 根目录确认有一个名字就叫 `.env` 的文件。

### 报错二:没用 uv run

直接用系统的 python3 运行:

```bash
python3 part02/ask.py
```

```text
  File "part02/ask.py", line 5, in <module>
    from dotenv import load_dotenv
ModuleNotFoundError: No module named 'dotenv'
```

我电脑上系统的 `python3` 是 3.10,它不知道项目的 `.venv` 里装了什么,所以找不到 dotenv。这和你在一个没 `npm install` 过的地方跑 `node index.js` 报 `Cannot find module` 是一回事。修法:在项目根目录用 `uv run`,它会自动用项目自己的 `.venv`([Day 11](/blog/agent-zero/day-011-uv-2/) 讲过)。

### 报错三:key 不对(401)

为了不改 `.env`,我用一个假 key 在命令行前面临时设一个环境变量:

```bash
LLM_API_KEY=sk-0000000000000000000000000000000 uv run part02/ask.py
```

```text
openai.AuthenticationError: Error code: 401 - {'error': {'message': 'Authentication Fails, Your api key: ****0000 is invalid (request_id: 2a325965-f49e-4d5c-bd79-f1de6fb18da6)', 'type': 'authentication_error', 'param': None, 'code': 'invalid_request_error'}}
```

401 是 Day 60 学过的状态码,意思是「没认出你是谁」。DeepSeek 的错误码文档写的是「API key 错误,认证失败」,它还贴心地打印了你传上去的 key 的最后 4 位(`****0000`),方便你对照是不是用错了 key。看到 401,先跑 `env_check.py` 看 key 的长度和开头对不对,还不行就回平台删掉重建。

这里还藏着一个知识点:**命令行里临时设的环境变量,比 `.env` 里的优先**。`load_dotenv()` 默认不会覆盖已经存在的环境变量,所以我 `.env` 里的真 key 没生效,用的是命令行那个假的。反过来,如果你曾经在 `~/.zshrc` 里 `export` 过一个旧 key,它会一直压着 `.env`,怎么改 `.env` 都没用。练习 1 专门练这个。

### 报错四:key 后面多了一个空格

这是我觉得最阴险的一个。我把 `.env` 里那一行写成带引号、引号里末尾多一个空格:

```bash
LLM_API_KEY="sk-...(真 key) "
```

先跑 `env_check.py`:

```text
KEY 开头 = sk- 长度 36
KEY 前后有空格吗: True
```

长度从 35 变成 36,多出来的就是那个空格。再跑 `ask.py`,等了 3 秒多(`time` 测的是 3.43 秒)之后:

```text
openai.APIConnectionError: Connection error.
```

报的是「连接错误」,看起来像网络不通,其实网络好好的。往上翻报错的中间几行,能看到真正的原因(key 我用 `****` 遮掉了):

```text
httpx2.LocalProtocolError: Illegal header value b'Bearer sk-**** '
```

HTTP 头的值不能以空格结尾,请求在你自己电脑上就被拦下了,根本没发出去。等的那几秒,是 SDK 以为网络出了问题在自动重试([Day 127](/blog/agent-zero/day-127-retry-backoff/) 讲重试)。修法:`.env` 里的值不加引号、不留空格。我还试了不带引号、末尾多几个空格的写法,python-dotenv 会自动去掉,`env_check.py` 显示长度还是 35,所以不加引号反而更安全。

### 报错五:模型名拼错(400)

```bash
LLM_MODEL=deepseek-flsh uv run part02/ask.py
```

```text
openai.BadRequestError: Error code: 400 - {'error': {'message': 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-flsh. (request_id: ad30147d-cbfe-48df-a51d-27e638efbabc)', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

400 是「请求本身有问题」。这个报错信息写得很好,直接告诉你支持哪两个名字。顺带一提,我试了 DeepSeek 以前的老名字 `deepseek-chat`,现在还能调通,回答正常;但文档只列了 `deepseek-flash` 和 `deepseek-v4-pro`,老名字随时可能停用,别用。

### 还有一个我没法演示的:402

如果你还没充值就调用,会得到 402。DeepSeek 错误码文档写的是「余额不足」,解决方法是「确认账户余额,并前往充值页面进行充值」。我的账户里有钱,没法演示真实报错原文,所以下面表格里这一行写的是文档的说法。看到 402 反而是好消息:说明 key、地址、代码都对了,请求已经到了 DeepSeek,只是没钱。

把这六种整理成一张表,第一次跑不通时从上往下对:

| 看到什么 | 卡在哪一步 | 怎么修 |
| --- | --- | --- |
| `KeyError: 'LLM_BASE_URL'` | `.env` 没读到 | 确认根目录有名为 `.env` 的文件,变量名拼写一致 |
| `ModuleNotFoundError: No module named 'dotenv'`(或 `'openai'`) | 没用项目的环境 | 在根目录 `uv add openai python-dotenv`,用 `uv run` 运行 |
| `401 ... Authentication Fails` | key 不对 | `env_check.py` 看长度和开头;查 `~/.zshrc` 有没有旧的 `export`;删掉重建 key |
| `APIConnectionError: Connection error.` | 请求没发出去 | 往上翻找真正原因:key 带空格、`base_url` 写错、代理问题 |
| `400 ... supported API model names are ...` | 请求内容不对 | 按报错里列的名字改 `LLM_MODEL` |
| `402`(文档:余额不足) | 账户没钱 | 去「充值」;说明其他都对了 |

401、429、5xx 这些错误码完整的分类和「谁的问题、要不要重试」,[Day 126](/blog/agent-zero/day-126-error-codes/) 专门讲。

## 动手练习

**练习 1:谁说了算,.env 还是命令行?** 不改 `.env`,用两种方式运行 `env_check.py`:直接运行;在命令前面加 `LLM_MODEL=deepseek-v4-pro`。看 `MODEL =` 那一行分别打印什么。然后回答:如果你想让 `.env` 的值盖过已有的环境变量,`load_dotenv` 要怎么写?

<details><summary>参考答案</summary>

```bash
uv run part02/env_check.py | grep MODEL
LLM_MODEL=deepseek-v4-pro uv run part02/env_check.py | grep MODEL
```

<div class="line-notes">

- `uv run part02/env_check.py | grep MODEL` `|` 把前一个命令的输出交给后一个,`grep MODEL` 只留下含 MODEL 的行([Day 4](/blog/agent-zero/day-004-terminal-2/) 讲过管道)。
- `LLM_MODEL=deepseek-v4-pro uv run part02/env_check.py | grep MODEL` 命令前面写 `名字=值`,只对这一条命令生效,跑完就没了,不会改你的 `.env`,也不会留在终端里。

</div>

实跑输出:

```text
MODEL    = deepseek-flash
MODEL    = deepseek-v4-pro
```

第二次用的是命令行给的值,`.env` 里的 `deepseek-flash` 被压住了。原因是 `load_dotenv()` 默认 `override=False`:环境变量里已经有这个名字,就不覆盖。想让 `.env` 说了算,写成 `load_dotenv(override=True)`。我们不这么写,因为「命令行临时改一个值」在后面切换厂商、跑实验时很好用;代价是要记住:`.env` 改了不生效时,先查有没有同名的环境变量,`echo $LLM_API_KEY` 有输出就说明有(注意别把输出贴给别人)。

</details>

**练习 2:查余额。** DeepSeek 有一个查余额的接口:`GET https://api.deepseek.com/user/balance`,也要带 `Authorization: Bearer 你的key`。用 curl 调一次,看看你的余额。key 不要直接写在命令里(会留在终端历史里),从 `.env` 读。

<details><summary>参考答案</summary>

```bash
(set -a; source .env; set +a;
  curl -s https://api.deepseek.com/user/balance \
    -H "Authorization: Bearer $LLM_API_KEY") \
  | python3 -m json.tool
```

<div class="line-notes">

- `(set -a; source .env; set +a;` 外面的圆括号开了一个子 shell,里面设的变量出了括号就消失,不会留在你的终端里。`set -a` 让接下来定义的变量自动导出成环境变量,`source .env` 把 `.env` 当成 shell 脚本执行一遍(每行 `名字=值` 正好就是 shell 的赋值语法),`set +a` 关掉自动导出。
- `curl -s https://api.deepseek.com/user/balance` GET 请求,`-s` 不显示进度条([Day 59](/blog/agent-zero/day-059-http-1/) 的 curl)。
- `-H "Authorization: Bearer $LLM_API_KEY")` 加一个请求头。`$LLM_API_KEY` 由 shell 替换成真 key,命令历史里存下来的只是 `$LLM_API_KEY` 这几个字。
- `| python3 -m json.tool` 把返回的一行 JSON 排成好读的缩进格式。这里用系统的 python3 没关系,`json.tool` 是标准库。

</div>

实跑输出:

```json
{
    "is_available": true,
    "balance_infos": [
        {
            "currency": "CNY",
            "total_balance": "43.15",
            "granted_balance": "0.00",
            "topped_up_balance": "43.15"
        }
    ]
}
```

`is_available` 表示余额够不够调用;`total_balance` 是总余额,等于 `granted_balance`(赠送的)加 `topped_up_balance`(你充的)。金额是字符串而不是数字,这是处理钱的常见做法,避免浮点数精度问题。这个接口不扣钱,DeepSeek 的 API 文档里叫「查询余额」。以后写自动跑一晚上的脚本,开头先查一次余额是个好习惯。

</details>

**练习 3:给别人一份 .env.example。** 在根目录建 `.env.example`,内容和 `.env` 一样,只是 key 换成占位符。然后验证:`.env` 被忽略、`.env.example` 没被忽略。

<details><summary>参考答案</summary>

```bash
# agent-zero-lab/.env.example
LLM_BASE_URL=https://api.deepseek.com
LLM_API_KEY=sk-你的key
LLM_MODEL=deepseek-flash
```

<div class="line-notes">

- `LLM_API_KEY=sk-你的key` 占位符。别人 clone 你的仓库后,复制一份改名成 `.env`,填上自己的 key 就能跑。这和前端项目里常见的 `.env.example` 是同一个习惯。

</div>

```bash
git check-ignore -v .env.example
echo $?
git status --short
```

实跑输出:

```text
.gitignore:15:!.env.example	.env.example
0
?? .env.example
?? .gitignore
?? .python-version
?? README.md
?? part02/
?? pyproject.toml
?? pyrightconfig.json
?? uv.lock
```

这里有个容易看错的地方:`git check-ignore -v .env.example` 也打印了一行,退出码还是 0,看着像「被忽略了」。仔细看,匹配到的规则是带感叹号的 `!.env.example`,也就是「例外,不忽略」;`-v` 模式会把匹配到的规则都打印出来,不管是忽略还是反忽略。最可靠的确认是 `git status --short`:`.env.example` 出现在 `??`(未跟踪、可以提交)列表里,`.env` 没有出现。我这份是在新建的练习目录里跑的,所以全是 `??`,`pyrightconfig.json` 是我给类型检查加的配置;你的仓库 Day 56 起已经有提交记录,列表会短得多,只要里面没有 `.env` 就对了。

</details>

**练习 4:今天花了多少钱?** 正文两次调用的用量是:8 输入 + 34 输出、18 输入 + 61 输出,都没命中缓存。写 `part02/first_cost.py`,分别按高峰价(输入 2 元、输出 8 元每百万 token)和空闲价(1 元、4 元)算两次一共多少钱,以及 10 元够这样的调用多少次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/first_cost.py
PRICES = {"高峰": (2.0, 8.0), "空闲": (1.0, 4.0)}
CALLS = [(8, 34), (18, 61)]

for period, (input_price, output_price) in PRICES.items():
    total = 0.0
    for prompt_tokens, completion_tokens in CALLS:
        total += prompt_tokens * input_price / 1_000_000 + completion_tokens * output_price / 1_000_000
    print(f"{period}: 两次共 {total:.6f} 元, 10 元够这样的调用 {10 / (total / len(CALLS)):,.0f} 次")
```

<div class="line-notes">

- `PRICES = {"高峰": (2.0, 8.0), "空闲": (1.0, 4.0)}` 时段 → (输入未命中价, 输出价),单位元每百万 token,2026 年 10 月 `deepseek-flash` 的价格。
- `CALLS = [(8, 34), (18, 61)]` 两次调用各自的 (prompt_tokens, completion_tokens),抄自正文的 `usage`。
- `for period, (input_price, output_price) in PRICES.items():` `.items()` 每次给一个 (键, 值),值本身又是元组,可以用括号直接拆两层。
- `total += prompt_tokens * input_price / 1_000_000 + completion_tokens * output_price / 1_000_000` 输入和输出分开按各自单价算再相加。空闲时第一次:8 × 1 / 1e6 + 34 × 4 / 1e6 = 0.000144。
- `{10 / (total / len(CALLS)):,.0f}` 平均每次多少钱,再看 10 元能分几份。`:,.0f` 千分位加逗号、不要小数。

</div>

```bash
uv run part02/first_cost.py
```

实跑输出:

```text
高峰: 两次共 0.000812 元, 10 元够这样的调用 24,631 次
空闲: 两次共 0.000406 元, 10 元够这样的调用 49,261 次
```

同样的调用,白天上班时间问比晚上贵一倍。学习时间在晚上和周末,天然享受半价。这个算式 [Day 124](/blog/agent-zero/day-124-cost/) 会写成带缓存价和测试的正式版 `cost.py`。

</details>

**验收标准**:`uv run part02/env_check.py` 显示 key 以 `sk-` 开头、没有空格;`uv run part02/ask.py "任意问题"` 打印出回答和 `CompletionUsage(...)`;`git status` 里看不到 `.env`;能对着报错表说出五种报错各自卡在哪一步。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| API key | 调用厂商 API 的凭证,一串 `sk-` 开头的字符,既认人又扣钱,等同于密码 |
| base_url | 请求要发去的服务器地址,DeepSeek 是 `https://api.deepseek.com`,SDK 在后面拼上 `/chat/completions` 这样的路径 |
| 开放平台 | 厂商给开发者用的网站(platform.deepseek.com),在这里实名、充值、建 key、看用量 |
| 实名认证 | DeepSeek 要求完成后才能在线充值,个人和企业认证功能一样 |
| SDK | 厂商提供的代码库,把发 HTTP 请求、处理返回包装成函数调用,如 openai 这个包 |
| openai SDK | OpenAI 官方的 Python 包,DeepSeek 等兼容厂商也用它调用,`from openai import OpenAI` |
| `client.chat.completions.create` | 发起一次对话补全请求的方法,调用这一行才真正发出 HTTP 请求 |
| `extra_body` | 给 SDK 不认识的参数用的口袋,里面的内容原样合并进请求体,Day 121 详讲 |
| `usage` | 返回里的用量:输入 token、输出 token、缓存命中多少,用来算钱 |
| `load_dotenv(override=...)` | 读 `.env`;默认 `override=False`,已有的同名环境变量不会被 `.env` 覆盖 |
| `.env.example` | 只放占位符的配置模板,提交到 git 给别人参考,真 `.env` 不提交 |
| `git check-ignore -v` | 查一个文件被 `.gitignore` 里哪条规则匹配;带 `!` 的规则表示例外 |
| 退出码 | 命令结束时返回的数字,0 表示成功,非 0 表示失败或「否」,用 `echo $?` 看 |
| 空闲时段 / 高峰时段 | DeepSeek 按北京时间分两档价,工作日 9–12、14–18 点是高峰,其余时间半价 |

## 常见误区

**以为 chat.deepseek.com 聊天免费,API 也免费。** 网页聊天和开放平台是两套账,API 要单独充值。连模型自己都会说错:我第一次调用,它回答「而且完全免费」。

**把 key 放进前端代码或 `VITE_` 环境变量。** 前端构建时 `VITE_` 开头的变量会被原样打进 JS 包,任何人在 DevTools 里都能看到。key 只能放在后端或你本机的脚本里,前端要调模型必须经过自己的后端。

**`.env` 里给 key 加引号还多了个空格。** 实测 `LLM_API_KEY="sk-... "` 读出来长度 36,调用报 `APIConnectionError: Connection error.`,看着像网络问题,真正原因藏在中间:`Illegal header value b'Bearer sk-**** '`。值不加引号,python-dotenv 会自动去掉末尾空格。

**改了 `.env` 不生效。** 多半是终端里或 `~/.zshrc` 里已经有同名环境变量,`load_dotenv()` 默认不覆盖它。`echo $LLM_API_KEY` 看一眼(别把输出发给别人),有输出就去 `~/.zshrc` 删掉那行 `export`,重开终端。

**以为 `uv init` 生成的 `.gitignore` 会忽略 `.env`。** 我用 uv 0.13 新建项目实测,默认的 `.gitignore` 里只有 `__pycache__`、`.venv` 这些,没有 `.env`。每个新项目都要自己加,再用 `git check-ignore -v .env` 验证。

**把 `git check-ignore -v` 有输出就当成「被忽略了」。** 带 `-v` 时,匹配到 `!.env.example` 这种反忽略规则也会打印、退出码也是 0。看规则前面有没有感叹号,最终以 `git status` 为准。

**用 `python3 part02/ask.py` 运行。** 系统 Python 不认识项目 `.venv` 里的包,报 `ModuleNotFoundError: No module named 'dotenv'`。在项目根目录用 `uv run`。

**把 key 打印出来或者贴进群里问问题。** 报错信息、`env_check.py` 这类调试输出里只露前几个字符和长度。真漏了,马上去「API keys」页面删掉,删掉立刻失效,再建一个新的。

## 学习资料

### 文档与文章

- [DeepSeek API 文档首页「首次调用 API」](https://api-docs.deepseek.com/zh-cn/):中文,官方给的 `base_url`、Python 示例和模型名说明。注意它的示例默认开了思考,我们关掉了。5 分钟。
- [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):中文,今天算钱用的价格、高峰和空闲时段的定义、「优先扣减赠送余额」的规则。
- [DeepSeek 错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes):中文,七个错误码各一行:原因和解决方法。402 的说法出自这里。
- [DeepSeek 常见问题(API 相关)](https://static.deepseek.com/faq/index.html?lang=zh):中文,实名认证、充值、退款、余额是否过期、key 泄露怎么办,今天引用的 FAQ 原话都在「API 相关」这一类里。需浏览器打开。
- [DeepSeek API:查询余额](https://api-docs.deepseek.com/zh-cn/api/get-user-balance):练习 2 那个接口的说明,返回字段的含义。
- [python-dotenv](https://github.com/theskumar/python-dotenv):英文 README,`override`、引号和空格怎么处理、`find_dotenv` 怎么往上找文件都写了。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1y69TYTEMQ&autoplay=0&high_quality=1" title="手把手教你:充值DeepSeek API,Python调用DeepSeek API" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大熊课堂 · 手把手教你:充值 DeepSeek API,Python 调用 DeepSeek API · 7 分钟,2025 年 2 月。Day 2 看过前半段的平台页面,今天看后半段的 Python 调用,对照我们的 `ask.py`。视频里的模型名(deepseek-chat)和价格已经过时,以今天文章为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1VJp9zUEmg&autoplay=0&high_quality=1" title="Python教程:使用DotEnv安全管理密码和API密钥" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小书包AIGC · Python 教程:使用 DotEnv 安全管理密码和 API 密钥 · 16 分钟,2025 年 9 月,中文字幕搬运。把 `.env`、`load_dotenv` 和 `.gitignore` 从头讲一遍,Day 53 没记牢的可以补一下。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/czvVibB2lRA" title="The OpenAI (Python) API | Introduction & Example Code" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Shaw Talebi · The OpenAI (Python) API | Introduction & Example Code · 英文,2023 年。从「什么是 API、什么是 key」讲到第一次调用,讲得慢、适合第一次接触。用的是 OpenAI 自己的服务器和老模型名,看思路就行。</figcaption>
</figure>

### 书籍

今天这组不需要。注册、充值、配置这类内容变得太快,书里写的流程大多已经过时,以官方文档和 FAQ 为准。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):今天装的 SDK 的源码仓库。README 开头的「Usage」就是今天 `ask.py` 的原型,往下翻有错误处理和重试的说明,Day 126–127 会用到。
- [openai 在 PyPI 上的页面](https://pypi.org/project/openai/):看当前最新版本和发布时间。这个包更新很勤,我装的 3.36.1 就是写这篇当天发的。

## 自测

1. API key 和 base_url 分别是干什么的?为什么都放在 `.env` 里,而不是写在代码里?

<details><summary>答案</summary>

API key 是凭证:厂商靠它认出请求是谁发的,并从谁的余额里扣钱。base_url 是请求发去的服务器地址,SDK 在后面拼上具体路径。都放进 `.env`:key 是密钥,不能进代码仓库;base_url 和模型名放在配置里,换厂商、换模型时只改 `.env`,代码不动。

</details>

2. 你运行 `ask.py` 得到 `KeyError: 'LLM_API_KEY'`,而同学得到的是 `401 Authentication Fails`。你们各自卡在哪一步?

<details><summary>答案</summary>

`KeyError` 是在你自己电脑上就失败了:环境变量里没有这个名字,通常是 `.env` 没建、名字写错或者放错了目录,请求根本没发出去。401 说明请求已经发到了 DeepSeek,但 key 不对:复制少了、多了字符、用了已删除的 key,或者被一个旧的同名环境变量盖住了。

</details>

3. `.env` 里写了 `LLM_API_KEY="sk-xxxx "`(引号里末尾一个空格),会发生什么?为什么报错信息看起来像网络问题?

<details><summary>答案</summary>

读出来的 key 多了一个空格(实测长度从 35 变 36)。SDK 把它拼进请求头 `Authorization: Bearer sk-xxxx `,HTTP 头的值不能以空格结尾,底层的 httpx2 在本机就拒绝发送,抛出 `LocalProtocolError: Illegal header value`;openai SDK 把这类「请求没发出去」的错误统一包装成 `APIConnectionError: Connection error.`,还会自动重试几次,所以看起来像断网。修法是去掉引号和空格。

</details>

4. 一次调用输入 18 个 token、输出 61 个 token,都没命中缓存,按 `deepseek-flash` 高峰价算多少钱?

<details><summary>答案</summary>

高峰价输入未命中 2 元、输出 8 元每百万 token:18 × 2 ÷ 1,000,000 + 61 × 8 ÷ 1,000,000 = 0.000036 + 0.000488 = 0.000524 元。空闲时段减半,0.000262 元。

</details>

5. 面试题:「前端同事想在 React 页面里直接调大模型 API,把 key 放在 `.env.local` 的 `VITE_LLM_KEY` 里,你怎么看?」

<details><summary>答案</summary>

不行。`VITE_` 前缀的变量构建时会被原样打进前端 JS 包,任何访问者在 DevTools 里都能拿到 key,然后用你的余额随便调用,厂商文档也明确说不要把 key 暴露在浏览器或客户端代码里。正确做法是加一层自己的后端(比如 FastAPI):key 只放在服务端环境变量里,前端调自己的接口,后端再转发给模型厂商。顺便还能在后端做鉴权、限流、记录用量和过滤输入。万一 key 已经发到线上,马上在开放平台删掉重建。

</details>

## 明天预告

Day 121 · 一次调用到底发了什么:请求逐字段。今天的 `ask.py` 里,`client.chat.completions.create(...)` 一行就把请求发出去了,SDK 帮你藏掉了所有细节。明天把它拆开:用一个小钩子把 SDK 真正发出去的 HTTP 请求原样打印出来,再不用 SDK、只用 httpx 手写一遍同样的请求;然后挨个试 `model`、`messages`、`max_tokens`、`temperature`、`stop` 这些字段,顺便解释今天留下的那个问题:关思考为什么要包一层 `extra_body`。
