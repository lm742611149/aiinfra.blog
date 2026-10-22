---
title: 'Day 123 · OpenAI 兼容协议:一份代码切换多家'
description: '为什么 DeepSeek、硅基流动、百炼、Kimi、智谱都能用同一个 openai SDK 调:它们照着 OpenAI 的 /chat/completions 格式实现了接口。今天把厂商配置挪进 .env.sf 这类文件,用 ENV_FILE 环境变量切换,DeepSeek 和硅基流动实跑同一个问题;踩两个坑:忘了 override=True 时脚本说用的是硅基流动、请求却发去了 DeepSeek,JSON 不加引号让 source .env 报错。最后看兼容的边界:同一个 DeepSeek V4 Flash,两家默认思考开关不同,硅基流动 3 次只答对 1 次。'
pubDate: 2026-10-23
regime: none
tags: ['api', 'deepseek', 'siliconflow', 'python', 'agent-zero']
series: 'agent-zero'
day: 123
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 122](/blog/agent-zero/day-122-api-response/) 把一次调用的响应拆开了:外层的 `id`、`created`、`model`、`system_fingerprint`,`choices[0]` 里的 `message` 和 `finish_reason`,还有 `usage` 这张账单。我们亲眼看到开着思考、`max_tokens` 只给 40 时,40 个 token 全被推理用掉,`content` 是空字符串;最后写了会检查 `finish_reason` 的 `ask2.py`。

这两天看到的请求格式和响应格式,严格说都不是 DeepSeek 发明的,是 OpenAI 定的。DeepSeek 照着实现,再加上几个自己的字段(`thinking`、`reasoning_content`、`prompt_cache_hit_tokens`)。很多厂商都这么干,这就是今天要讲的「OpenAI 兼容」。它带来的好处很直接:同一份代码,换一个地址、一把 key、一个模型名,就能去调另一家。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚什么是 OpenAI 兼容协议、为什么这么多厂商都兼容它,能查到一家厂商的兼容地址和模型名。
2. 把每家厂商的配置写进单独的文件(`.env`、`.env.sf`),用一个环境变量 `ENV_FILE` 选用哪一家,代码一行不改就能在 DeepSeek 和硅基流动之间切换。
3. 知道 `load_dotenv(..., override=True)` 为什么必须写,亲眼看一次不写时「脚本说用的是硅基流动、请求却发去了 DeepSeek」。
4. 说出「兼容」的边界:扩展参数各家不同、响应字段有多有少、同名模型的默认行为和回答质量也可能不一样。

今天的两个新概念:**OpenAI 兼容协议**和**用环境变量切换厂商**。

预计用时:2–2.5 小时,其中注册硅基流动、实名、充值大约 15 分钟。实跑花费:DeepSeek 和硅基流动一共调用 20 次左右,每次几十个 token,两家合计不到 0.01 元(文末有算式)。前置:[Day 120](/blog/agent-zero/day-120-api-register/) 的 `.env` 和 `.gitignore`,[Day 121](/blog/agent-zero/day-121-api-request/) 的 `extra_body`,[Day 122](/blog/agent-zero/day-122-api-response/) 的响应字段,[Day 53](/blog/agent-zero/day-053-env-secrets/) 的 python-dotenv,[Day 39](/blog/agent-zero/day-039-json/) 的 `json.loads`。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `ask_any.py` 默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## OpenAI 兼容是怎么来的

OpenAI 是最早大规模开放大模型 API 的公司,它的 `/chat/completions` 接口用了好几年,大量的 SDK、框架、教程、开源工具都是照着这个格式写的。后来的厂商面前有两条路:自己设计一套新格式,让开发者重新学、让框架重新适配;或者直接照抄 OpenAI 的格式,开发者把地址一换就能用。绝大多数厂商选了后者。

前端同学可以这样理解:这很像各家浏览器都实现同一个 `fetch` 标准。你写 `fetch(url, {method: "POST", body})`,在 Chrome、Firefox、Safari 上都能跑,不用关心底层是谁实现的;但每家浏览器又都有一些自己的私有 API 和细节差异,写到边角时还是要查兼容性表。OpenAI 兼容协议就是大模型 API 里的这个「`fetch` 标准」,只不过它不是哪个标准组织定的,是 OpenAI 先做、大家跟着做,成了事实上的标准。

所谓「兼容」,具体是指这几样东西一样:

- 地址:`{base_url}/chat/completions`,用 POST。
- 鉴权:请求头 `Authorization: Bearer 你的key`。
- 请求体:`model`、`messages`(`role` 和 `content`)、`max_tokens`、`temperature`、`stream`、`tools` 这些字段的名字和含义。
- 响应:`choices[0].message.content`、`finish_reason`、`usage.prompt_tokens` 这一套结构。

所以 openai 的 Python SDK 根本不知道你连的是谁。它只是把 `base_url` 拼上 `/chat/completions`,带上 key 发出去,再把回来的 JSON 按 OpenAI 的格式解析。Day 121 我们已经验证过:SDK 发的就是一个普通 POST。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="同一份代码通过不同的配置文件,把请求发往不同厂商的兼容接口">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="90" width="150" height="80" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="95" y="116" text-anchor="middle" fill="var(--mem)">ask_any.py</text>
<text x="95" y="138" text-anchor="middle" fill="var(--ink)">一份代码</text>
<text x="95" y="158" text-anchor="middle" fill="var(--ink-soft)">openai SDK</text>
<rect x="215" y="30" width="150" height="40" rx="6" fill="none" stroke="var(--ink-faint)"/>
<text x="290" y="55" text-anchor="middle" fill="var(--ink)">.env</text>
<rect x="215" y="110" width="150" height="40" rx="6" fill="none" stroke="var(--ink-faint)"/>
<text x="290" y="135" text-anchor="middle" fill="var(--ink)">.env.sf</text>
<rect x="215" y="190" width="150" height="40" rx="6" fill="none" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<text x="290" y="215" text-anchor="middle" fill="var(--ink-soft)">.env.bailian</text>
<line x1="170" y1="130" x2="215" y2="50" stroke="var(--ink-soft)"/>
<line x1="170" y1="130" x2="215" y2="130" stroke="var(--ink-soft)"/>
<line x1="170" y1="130" x2="215" y2="210" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="20" y="200" fill="var(--ink-faint)">ENV_FILE 选一个</text>
<rect x="410" y="30" width="210" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="420" y="55" fill="var(--ink)">api.deepseek.com</text>
<rect x="410" y="110" width="210" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="420" y="135" fill="var(--ink)">api.siliconflow.cn/v1</text>
<rect x="410" y="190" width="210" height="40" rx="6" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="420" y="215" fill="var(--ink-soft)">dashscope…/compatible-mode/v1</text>
<line x1="365" y1="50" x2="410" y2="50" stroke="var(--ink-soft)"/>
<line x1="365" y1="130" x2="410" y2="130" stroke="var(--ink-soft)"/>
<line x1="365" y1="210" x2="410" y2="210" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="410" y="250" fill="var(--ink-faint)">都收 POST {base_url}/chat/completions</text>
</g>
</svg>
<figcaption>代码不变,换的是配置文件。每个文件里是一家的地址、key、模型名和扩展参数。虚线的百炼今天没有实跑。</figcaption>
</figure>

几家常见厂商的兼容地址(2026 年 10 月逐个查的官方文档,用之前再去核对一次,模型名变得很快):

| 厂商 | base_url | 文档示例里的模型名 | 关思考的写法 |
| --- | --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` | `{"thinking": {"type": "disabled"}}` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V4-Flash` 等,名字带厂商前缀 | 实测 `thinking` 和 `enable_thinking` 都认 |
| 阿里云百炼 | 旧域名 `https://dashscope.aliyuncs.com/compatible-mode/v1` 仍可用;文档现在推荐业务空间专属域名 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | `qwen3.8-max`、`qwen3.8-flash` | `{"enable_thinking": false}` |
| Kimi(月之暗面) | `https://api.moonshot.cn/v1` | `kimi-k3` | 看文档 |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-5.3` | 看文档 |
| OpenAI | 不传 `base_url`,SDK 默认 `https://api.openai.com/v1` | 看文档 | 无 |

我对没有 key 的几家各发了一个不带 key 的请求,Kimi、智谱、百炼的地址都回了 401,说明地址是对的,只是要鉴权。表里最右一列是今天的重点之一:扩展参数没有标准,每家写法不同。

还有一类叫**聚合平台**,硅基流动、OpenRouter 都算:它们自己不训练模型(或不只卖自己的),而是把很多家的模型部署好,用一个兼容接口统一卖。硅基流动上就能调到 DeepSeek、千问、Kimi、GLM 等。今天用它当第二家,原因有三:它有 DeepSeek V4 Flash,和我们默认的模型同源,方便对比;国内注册,支付宝能充值;Day 148 讲结构化输出时要用它支持的 `json_schema`,今天顺手把配置建好。

## 第一步:拿到第二家的 key

打开 [硅基流动控制台](https://cloud.siliconflow.cn),手机号注册,按提示完成实名认证(和 Day 120 的 DeepSeek 一样,不实名不能充值),充几块钱就够这门课用很久。然后进 [API 密钥页](https://cloud.siliconflow.cn/account/ak) 新建一个 key,复制下来。规矩和 Day 120 一样:key 只显示一次,不进 git,不进前端代码,不贴到任何聊天窗口里。

价格先说一句,Day 124 细算:2026 年 10 月它的[定价页](https://siliconflow.cn/pricing)上,`deepseek-ai/DeepSeek-V4-Flash` 是输入 3 元、输出 9 元每百万 token,缓存命中 0.3 元;凌晨 2 点到 8 点半价。比 DeepSeek 官方的高峰价(2 元、8 元)贵一些。

## 第二步:每家一个配置文件

在 `agent-zero-lab` 根目录新建 `.env.sf`:

```bash
# agent-zero-lab/.env.sf
LLM_BASE_URL=https://api.siliconflow.cn/v1
LLM_API_KEY=sk-你的硅基流动key
LLM_MODEL=deepseek-ai/DeepSeek-V4-Flash
LLM_EXTRA_BODY='{"thinking": {"type": "disabled"}}'
```

<div class="line-notes">

- `LLM_BASE_URL=https://api.siliconflow.cn/v1` 硅基流动的兼容地址,末尾的 `/v1` 要带上;DeepSeek 不带。每家以自己文档为准,别凭感觉补。
- `LLM_API_KEY=sk-你的硅基流动key` 换成你刚复制的那串。和 DeepSeek 的 key 一样都是 `sk-` 开头,长得像,别填混。
- `LLM_MODEL=deepseek-ai/DeepSeek-V4-Flash` 聚合平台的模型名带「出品方/」前缀,和 DeepSeek 官方的 `deepseek-flash` 写法完全不同。模型名是最容易出错的地方,从控制台的模型广场复制,别手打。
- `LLM_EXTRA_BODY='{"thinking": {"type": "disabled"}}'` 新变量:这家需要的扩展参数,写成一行 JSON。整串用**单引号**包起来,原因下面会演示。python-dotenv 读的时候会去掉外面的单引号。

</div>

同时打开 Day 120 建的 `.env`,在最后加一行同名变量,让 DeepSeek 也有自己的扩展参数:

```bash
# agent-zero-lab/.env(在原来三行后面加这一行)
LLM_EXTRA_BODY='{"thinking": {"type": "disabled"}}'
```

现在两份文件有一样的四个变量名,值各是各的。确认 `.env.sf` 不会被 git 提交:

```bash
git check-ignore -v .env.sf
```

```text
.gitignore:14:.env.*	.env.sf
```

Day 120 写 `.gitignore` 时加的那条 `.env.*` 规则已经把它挡住了(行号和你的不一定一样)。如果什么都没打印,说明没挡住,回 Day 120 把那三行补上。

**为什么 JSON 要加单引号?** Day 121 练习 5 我们用 `set -a; source .env; set +a` 把 `.env` 读进终端。我第一次写的时候没加引号,就是 `LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`,再 `source` 时 zsh 直接报错:

```text
.env:4: parse error near `{'
```

`.env` 本来不是 shell 脚本,只是长得像。花括号、空格、双引号在 shell 里都有特殊含义,不加引号 shell 就读不懂了。python-dotenv 对这种写法宽容一些,不加引号也能读,但为了两边都能用,统一加单引号。

## 第三步:用 ENV_FILE 选厂商

现在写一个脚本,读哪份配置由环境变量 `ENV_FILE` 决定,没设就读 `.env`。新建 `part02/ask_any.py`:

```python
# agent-zero-lab/part02/ask_any.py
import json
import os
import sys

from dotenv import load_dotenv
from openai import OpenAI

env_file = os.environ.get("ENV_FILE", ".env")
load_dotenv(env_file, override=True)

client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
extra_body = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
question = sys.argv[1] if len(sys.argv) > 1 else "发票抬头开错了能改吗?一句话回答。"

resp = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": question}],
    max_tokens=500,
    extra_body=extra_body,
)

print("配置文件:", env_file, "| 地址:", client.base_url, "| 模型:", resp.model)
print(resp.choices[0].message.content)
u = resp.usage
if u is not None:
    detail = u.completion_tokens_details
    print("finish_reason:", resp.choices[0].finish_reason, "| 输入", u.prompt_tokens, "输出", u.completion_tokens,
          "其中推理", detail.reasoning_tokens if detail else None)
```

<div class="line-notes">

- `env_file = os.environ.get("ENV_FILE", ".env")` 先看环境变量 `ENV_FILE` 有没有设。`os.environ.get(名字, 默认值)` 取不到时返回默认值,相当于 JS 的 `process.env.ENV_FILE ?? ".env"`。实跑第一次没设,得到 `.env`;第二次命令行设了,得到 `.env.sf`。
- `load_dotenv(env_file, override=True)` 读指定的文件。两处和 Day 120 不同:第一,传了文件名,它就只读这一个文件,按**当前目录**找,不再从脚本所在目录往上找,所以要在 `agent-zero-lab` 根目录跑;第二,`override=True` 让文件里的值**覆盖**已经存在的同名环境变量。不写会怎样,第四步专门演示。
- `client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])` 和 `ask.py` 一模一样。代码里没有任何一个字提到 DeepSeek 或硅基流动。
- `extra_body = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` 把那行 JSON 字符串变成字典。没配就用 `"{}"`,得到空字典,等于什么扩展参数都不传。实跑两家都是 `{'thinking': {'type': 'disabled'}}`。
- `question = sys.argv[1] if len(sys.argv) > 1 else "发票抬头开错了能改吗?一句话回答。"` 和 `ask.py` 一样,命令行给了问题就用,没给用默认的。
- `extra_body=extra_body,` 扩展参数从配置来,不写死在代码里。百炼要的是 `enable_thinking`,改配置文件就行,代码不动。
- `print("配置文件:", env_file, "| 地址:", client.base_url, "| 模型:", resp.model)` 把「我以为用的是谁」和「实际发去了哪」都打出来。`client.base_url` 是客户端真正用的地址,`resp.model` 是服务器说的模型名。这一行第四步会救你。
- `detail = u.completion_tokens_details` 推理 token 的明细([Day 122](/blog/agent-zero/day-122-api-response/))。

</div>

先不设 `ENV_FILE`,再设成 `.env.sf`,各跑一次:

```bash
uv run part02/ask_any.py
ENV_FILE=.env.sf uv run part02/ask_any.py
```

第二行开头的 `ENV_FILE=.env.sf` 是 Day 120 报错三里用过的写法:在命令前面写 `名字=值`,只对这一条命令生效,跑完就没了。

实跑输出:

```text
配置文件: .env | 地址: https://api.deepseek.com | 模型: deepseek-flash
能，但需分情况：当月可作废重开，跨月或已认证通常需开红字发票冲销后再重开。
finish_reason: stop | 输入 15 输出 31 其中推理 None
配置文件: .env.sf | 地址: https://api.siliconflow.cn/v1/ | 模型: deepseek-ai/DeepSeek-V4-Flash
不能，发票抬头开错需作废或红冲后重开。
finish_reason: stop | 输入 15 输出 16 其中推理 0
```

同一份代码,两家都通了。几个细节值得看一眼:

- 硅基流动的地址打印出来末尾多了个 `/`,是 SDK 自己补的,不影响。
- 两家的输入都是 15 个 token,说明硅基流动用的是同一个分词器。
- 关思考时,DeepSeek 不返回 `completion_tokens_details`(打印 `None`),硅基流动返回了,里面 `reasoning_tokens` 是 0。Day 122 写的 `if detail` 判断这时派上了用场。
- 硅基流动回答的是「不能」。抬头开错了其实是能处理的(作废或红冲后重开),说「不能」是把「不能直接在原发票上改」说成了「不能改」。同一个模型、同一个问题,两家给的结论正好相反。后面「兼容的边界」一节专门比。

## 第四步:override=True 不写会怎样

这一步演示一个很隐蔽的坑。把 `ask_any.py` 复制一份叫 `part02/ask_any_noover.py`,只把 `load_dotenv(env_file, override=True)` 改成 `load_dotenv(env_file)`,别的都不动。

然后模拟一个很常见的场景:你在终端里曾经把 DeepSeek 的配置读成了环境变量。比如做 Day 121 练习 5 时用过 `set -a; source .env; set +a`,或者在 `~/.zshrc` 里 `export` 过 `LLM_*`。在一个子 shell 里复现,两个版本各跑一次:

```bash
(set -a; source .env; set +a
  ENV_FILE=.env.sf uv run part02/ask_any_noover.py | head -1
  ENV_FILE=.env.sf uv run part02/ask_any.py | head -1)
```

<div class="line-notes">

- `(set -a; source .env; set +a` 括号开了一个子 shell,在里面把 `.env` 的四个变量变成环境变量。出了括号就消失,不会污染你的终端。
- `ENV_FILE=.env.sf uv run part02/ask_any_noover.py | head -1` 没有 `override` 的版本,只看第一行「配置文件 / 地址 / 模型」。`| head -1` 是 [Day 5](/blog/agent-zero/day-005-terminal-3/) 学的管道,只要输出的第一行。
- `ENV_FILE=.env.sf uv run part02/ask_any.py | head -1)` 有 `override=True` 的正常版本,对照。

</div>

实跑输出:

```text
配置文件: .env.sf | 地址: https://api.deepseek.com | 模型: deepseek-flash
配置文件: .env.sf | 地址: https://api.siliconflow.cn/v1/ | 模型: deepseek-ai/DeepSeek-V4-Flash
```

第一行是最危险的那种错:**不报错,也说着「配置文件:.env.sf」,请求却发去了 DeepSeek**。原因是 `load_dotenv` 默认「已经存在的环境变量不覆盖」:`LLM_BASE_URL` 等四个变量在子 shell 里已经是 DeepSeek 的值了,读 `.env.sf` 时一个都没换掉。如果不是第一行把实际地址打了出来,你会以为自己在测硅基流动,写出一份「硅基流动比 DeepSeek 快」的对比报告,其实两边都是 DeepSeek。

再看半套被覆盖的情况。终端里只 `export` 了一个模型名:

```bash
(export LLM_MODEL=deepseek-flash
  ENV_FILE=.env.sf uv run part02/ask_any_noover.py)
```

最后一行报错:

```text
openai.BadRequestError: Error code: 400 - {'code': 20012, 'message': 'Model does not exist. Please check it carefully.', 'data': None}
```

这次地址和 key 是硅基流动的(终端里没有),模型名却是终端里那个 `deepseek-flash`,硅基流动上没有这个名字,回了 400。顺便看一眼报错格式:DeepSeek 的报错是 `{'error': {'message': ..., 'type': ...}}`,硅基流动是 `{'code': 20012, 'message': ..., 'data': None}`。**报错格式不在兼容范围里**,各家各写各的;好在 SDK 按状态码把它们都分到了 `BadRequestError`,你的 `except` 照样接得住。

所以规矩是:**切换配置文件时一定写 `override=True`,并且把实际的 `base_url` 和 `model` 打出来看一眼**。Day 120 说过「命令行临时设的环境变量比 `.env` 优先」,那是不写 `override` 时的行为;写了 `override=True`,就变成文件优先。两种行为都对,取决于你要什么:默认配置文件用不覆盖(方便临时改),切换厂商用覆盖(保证整套换掉)。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="不写 override 时,终端里已有的变量挡住了配置文件里的新值">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">终端里已有(source .env 留下的)</text>
<rect x="20" y="40" width="270" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="62" fill="var(--ink)">LLM_BASE_URL=api.deepseek.com</text>
<text x="32" y="82" fill="var(--ink)">LLM_MODEL=deepseek-flash</text>
<text x="350" y="28" fill="var(--ink-soft)">.env.sf 文件里</text>
<rect x="350" y="40" width="270" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="362" y="62" fill="var(--ink)">LLM_BASE_URL=api.siliconflow.cn</text>
<text x="362" y="82" fill="var(--ink)">LLM_MODEL=deepseek-ai/...</text>
<text x="20" y="130" fill="var(--ink)">load_dotenv(".env.sf")</text>
<text x="250" y="130" fill="var(--compute)">→ 已有的不动,还是 DeepSeek</text>
<text x="20" y="160" fill="var(--ink)">load_dotenv(".env.sf", override=True)</text>
<text x="330" y="160" fill="var(--mem)">→ 整套换成硅基流动</text>
<text x="20" y="188" fill="var(--ink-faint)">不写 override 不报错,只能靠打印实际地址发现</text>
</g>
</svg>
<figcaption>load_dotenv 默认不覆盖已有的环境变量。切换厂商时要整套换掉,所以写 override=True。</figcaption>
</figure>

## 兼容的边界:同一个模型,两家不一样

`ask_any.py` 那次,硅基流动把「能改」答成了「不能」。是偶然吗?再加上 Day 121 留下的疑问,`thinking` 这个 DeepSeek 自己的参数,硅基流动认不认?不传的话两家默认一样吗?写一个对比脚本,同一个问题,两家各跑「不传扩展参数」和「用配置里的」两种。

这个脚本要在一个程序里同时用两家,不能再靠 `load_dotenv` 往全局环境变量里写(第二家会覆盖第一家)。python-dotenv 还有一个函数 `dotenv_values`,只把文件读成一个字典,不碰环境变量,正好合适。新建 `part02/compare_vendors.py`:

```python
# agent-zero-lab/part02/compare_vendors.py
import json
import time

from dotenv import dotenv_values
from openai import OpenAI

QUESTION = "年付 468 元的套餐用了 3 个月想退,按月折算该退多少?只给数字。"

for env_file in (".env", ".env.sf"):
    cfg = dotenv_values(env_file)
    client = OpenAI(base_url=cfg["LLM_BASE_URL"], api_key=cfg["LLM_API_KEY"])
    model = cfg["LLM_MODEL"] or ""
    configured = json.loads(cfg.get("LLM_EXTRA_BODY") or "{}")
    for label, extra in (("不传扩展参数", {}), ("用配置里的", configured)):
        start = time.perf_counter()
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": QUESTION}],
            max_tokens=2000,
            extra_body=extra,
        )
        seconds = time.perf_counter() - start
        u = resp.usage
        detail = u.completion_tokens_details if u else None
        print(
            f"{env_file:<8} {label}: 回答 {resp.choices[0].message.content!r}"
            f"  输出 {u.completion_tokens if u else None}"
            f"(推理 {detail.reasoning_tokens if detail else None})  {seconds:.1f}s"
        )
```

<div class="line-notes">

- `import time` 用来计时。
- `from dotenv import dotenv_values` 和 `load_dotenv` 同一个包里的另一个函数。`load_dotenv` 把文件写进 `os.environ`,`dotenv_values` 只返回一个字典,两家的配置互不干扰。
- `QUESTION = "年付 468 元的套餐用了 3 个月想退,按月折算该退多少?只给数字。"` 一道要算一下的题:468 ÷ 12 × 9 = 351。有标准答案,方便比对错;「只给数字」让输出尽量短。
- `cfg = dotenv_values(env_file)` 实跑 `.env.sf` 时得到 `{'LLM_BASE_URL': 'https://api.siliconflow.cn/v1', 'LLM_API_KEY': 'sk-...', 'LLM_MODEL': 'deepseek-ai/DeepSeek-V4-Flash', 'LLM_EXTRA_BODY': '{"thinking": {"type": "disabled"}}'}`。外面的单引号已经去掉了。
- `client = OpenAI(base_url=cfg["LLM_BASE_URL"], api_key=cfg["LLM_API_KEY"])` 每家建一个自己的客户端。
- `model = cfg["LLM_MODEL"] or ""` `dotenv_values` 返回的值类型是「字符串或 None」(文件里可能写了 `LLM_MODEL` 却没写值),`create` 的 `model` 要字符串,`or ""` 让编辑器不画红线。真是空字符串的话服务器会回 400,不会悄悄出错。
- `configured = json.loads(cfg.get("LLM_EXTRA_BODY") or "{}")` 配置文件里的扩展参数。
- `for label, extra in (("不传扩展参数", {}), ("用配置里的", configured)):` 每家跑两次:什么都不传,和用配置里的(两家都是关思考)。
- `start = time.perf_counter()` 一个精确的计时器读数,单位秒。相当于浏览器里的 `performance.now()`,只是单位是秒不是毫秒。
- `seconds = time.perf_counter() - start` 两次读数相减就是这次调用花的时间。
- `f"{env_file:<8} {label}: 回答 {resp.choices[0].message.content!r}"` `!r` 用 `repr` 显示,带引号,能看清回答里有没有多余的字。

</div>

```bash
uv run part02/compare_vendors.py
```

实跑输出:

```text
.env     不传扩展参数: 回答 '351'  输出 94(推理 92)  1.5s
.env     用配置里的: 回答 '351'  输出 1(推理 None)  0.7s
.env.sf  不传扩展参数: 回答 '351'  输出 111(推理 110)  14.1s
.env.sf  用配置里的: 回答 '390'  输出 1(推理 0)  0.6s
```

四行信息量很大。

**硅基流动认 `thinking` 参数。** 第四行传了 `{"thinking": {"type": "disabled"}}`,推理是 0,说明它关掉了思考。我另外单独试过,它也认百炼那种写法 `{"enable_thinking": true}`,传了就会思考。这是硅基流动自己做的兼容,文档里我只找到了 `enable_thinking` 的写法,`thinking` 能用是实测出来的。

**不传参数时,两家默认行为不一样。** DeepSeek 官方默认开思考,第一行推理了 92 个 token。硅基流动不传参数时,这道算术题推理了 110 个 token;可我前面用「发票抬头开错了能改吗」这种简单问题试了三次,不传参数时推理都是 0。看起来硅基流动这边是让模型自己决定要不要想,它的文档我没找到明确说法,只能说实测如此。结论不变:**扩展参数每家的默认值不同,每个配置文件都要显式写清楚**,别指望默认值。

**慢了十倍的那一次。** 硅基流动开着思考那次花了 14.1 秒,DeepSeek 只要 1.5 秒,推理 token 数差不多。聚合平台的速度和它当时的负载有关,一次说明不了什么,但第五步练习 2 会多跑几次看看。

**同一个模型名,答案不一样。** 关掉思考以后,DeepSeek 答 351(对),硅基流动答 390(错)。这不是巧合,练习 2 我让两家各答三次,DeepSeek 三次全对,硅基流动三次只对一次。我的猜测(没有官方证据):DeepSeek 官方的 `deepseek-flash` 背后是 V4.1-Flash-1017(价格页写的),硅基流动上的 `DeepSeek-V4-Flash` 从名字看是开源的 V4-Flash,版本不同;部署方式、精度设置也可能不同。所以**换厂商不能只看模型名一样,要用你自己的题重新测一遍**,第六部分评测会正式做这件事。

把兼容的边界整理成一张表:

| 方面 | 兼容吗 | 今天的实测 |
| --- | --- | --- |
| 地址、鉴权、`messages`、`max_tokens` | 兼容 | 同一份代码两家都通 |
| 响应的 `choices`、`finish_reason`、`usage` 主体 | 兼容 | 两家结构一样,输入 token 数都是 15 |
| 扩展参数(思考开关等) | 不兼容,各家自己定 | DeepSeek 用 `thinking`;百炼用 `enable_thinking`;硅基流动两种都认 |
| 扩展参数的默认值 | 不兼容 | DeepSeek 默认思考;硅基流动简单题不思考、算术题思考 |
| 响应里多出来的字段 | 有多有少 | 关思考时 DeepSeek 没有 `completion_tokens_details`,硅基流动有;硅基流动的 `system_fingerprint` 是空字符串 |
| 报错的 JSON 格式 | 不兼容 | DeepSeek `{'error': {...}}`,硅基流动 `{'code': 20012, ...}` |
| 同名模型的质量 | 不保证 | 同一道题 DeepSeek 3/3,硅基流动 1/3 |

工程上的做法因此很清楚:主流程按 OpenAI 格式写;厂商之间的差异(地址、key、模型名、扩展参数、价格)全部放进配置文件,不要在代码里写 `if vendor == "deepseek"`。Day 135 封装 `LLMClient` 时,`LLMClient(env_file=".env.sf")` 就是今天这套配置文件的用法;Day 124 会再往配置里加一行价格。

## 百炼的配置(没实跑)

大纲里本来要切的第二家是阿里云百炼,我手上没有百炼的 key,所以这一段**没有实跑**,只给出按官方文档写的配置。你有百炼账号的话可以自己试,把结果和上面两家对比。

```bash
# agent-zero-lab/.env.bailian(没实跑)
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=sk-你的百炼key
LLM_MODEL=qwen3.8-flash
LLM_EXTRA_BODY='{"enable_thinking": false}'
```

<div class="line-notes">

- `LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1` 百炼的旧兼容地址。2026 年 10 月的文档说北京地域推荐迁到「业务空间专属域名」`https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`,旧域名仍可用。我对旧地址发了一个不带 key 的请求,返回 401,说明地址还在。用新域名的话,`{WorkspaceId}` 换成你控制台里的业务空间 ID。
- `LLM_API_KEY=sk-你的百炼key` 百炼控制台里建的 key。官方示例的环境变量名是 `DASHSCOPE_API_KEY`,我们照样统一叫 `LLM_API_KEY`。
- `LLM_MODEL=qwen3.8-flash` 百炼文档模型列表里的 Flash 型号。名字变得很快,以控制台为准。
- `LLM_EXTRA_BODY='{"enable_thinking": false}'` 百炼的思考开关叫 `enable_thinking`,是一个布尔值,不是 DeepSeek 那种嵌套对象。文档的深度思考页写着 Qwen3.8 Flash 默认开启思考,所以要显式关掉。

</div>

用法和硅基流动一样:`ENV_FILE=.env.bailian uv run part02/ask_any.py`。

## 动手练习

**练习 1:不花钱地检查配置文件。** 配置文件多了,容易出现「key 还是占位符」「JSON 写坏了」这种低级错,而且要等到真发请求才炸。写 `part02/check_envs.py`:命令行传入任意几个配置文件,对每个检查三件事:`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL` 都有值;key 不是带「你的」二字的占位符;`LLM_EXTRA_BODY` 是合法 JSON。打印每个文件的地址、模型、key 前 3 位,有问题就列出来,任何一个有问题就以退出码 1 结束。不调 API。拿 `.env`、`.env.sf`、`.env.bailian` 和一个故意写坏 JSON 的 `.env.broken` 试一下。

<details><summary>参考答案</summary>

先造一个坏文件(JSON 里 `type` 没加双引号):

```bash
printf 'LLM_BASE_URL=https://api.deepseek.com\nLLM_API_KEY=sk-x\nLLM_MODEL=deepseek-flash\nLLM_EXTRA_BODY={"thinking": {type: "disabled"}}\n' > .env.broken
```

```python
# agent-zero-lab/part02/check_envs.py
import json
import sys

from dotenv import dotenv_values

REQUIRED = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL")

bad = 0
for env_file in sys.argv[1:]:
    cfg = dotenv_values(env_file)
    problems = [name for name in REQUIRED if not cfg.get(name)]
    key = cfg.get("LLM_API_KEY") or ""
    if "你的" in key:
        problems.append("LLM_API_KEY 还是占位符")
    try:
        json.loads(cfg.get("LLM_EXTRA_BODY") or "{}")
    except json.JSONDecodeError as e:
        problems.append(f"LLM_EXTRA_BODY 不是合法 JSON:{e}")
    status = "OK " if not problems else "坏 "
    print(f"{status} {env_file:<12} {cfg.get('LLM_BASE_URL')}  {cfg.get('LLM_MODEL')}  key={key[:3]}***")
    for p in problems:
        print("      -", p)
    bad += len(problems)

sys.exit(1 if bad else 0)
```

<div class="line-notes">

- `REQUIRED = ("LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL")` 必须有值的三个变量。
- `for env_file in sys.argv[1:]:` `sys.argv[1:]` 是除脚本名以外的所有参数,可以一次检查任意多个文件。
- `problems = [name for name in REQUIRED if not cfg.get(name)]` [Day 23](/blog/agent-zero/day-023-comprehensions/) 的列表推导式:没有值(不存在、或者是空字符串、或者是 `None`)的变量名收进列表。
- `if "你的" in key:` 文章里的配置模板都用「你的…key」当占位符,忘了换就会被抓出来。
- `json.loads(cfg.get("LLM_EXTRA_BODY") or "{}")` 只是试着解析,不用结果。解析失败抛 `json.JSONDecodeError`。
- `problems.append(f"LLM_EXTRA_BODY 不是合法 JSON:{e}")` 把 json 模块的原始报错带上,它会告诉你第几个字符出的错。
- `key={key[:3]}***` key 只露前 3 个字符 `sk-`,其他打码。日志里永远不出现完整 key。
- `sys.exit(1 if bad else 0)` 有任何问题退出码就是 1。以后放进 CI 或者部署脚本里,检查不过就不往下走。

</div>

```bash
uv run part02/check_envs.py .env .env.sf .env.bailian .env.broken
echo "exit=$?"
```

实跑输出:

```text
OK  .env         https://api.deepseek.com  deepseek-flash  key=sk-***
OK  .env.sf      https://api.siliconflow.cn/v1  deepseek-ai/DeepSeek-V4-Flash  key=sk-***
坏  .env.bailian https://dashscope.aliyuncs.com/compatible-mode/v1  qwen3.8-flash  key=sk-***
      - LLM_API_KEY 还是占位符
坏  .env.broken  https://api.deepseek.com  deepseek-flash  key=sk-***
      - LLM_EXTRA_BODY 不是合法 JSON:Expecting property name enclosed in double quotes: line 1 column 15 (char 14)
exit=1
```

百炼的 key 还是占位符,被抓出来了;坏文件的报错指到第 15 列,正好是没加引号的 `type`。JSON 的键必须用双引号,这一点和 JS 的对象字面量不一样,前端同学最容易在这里顺手写错。检查完把 `.env.broken` 删掉:`rm .env.broken`。

</details>

**练习 2:同一道题,各答三次。** 用 `compare_vendors.py` 里那道退款题(正确答案 351),两家都用配置文件里的扩展参数(关思考),`max_tokens=50`,各问 3 次。打印每家的回答列表、答对几次、平均耗时。写 `part02/same_question.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/same_question.py
import json
import time

from dotenv import dotenv_values
from openai import OpenAI

QUESTION = "年付 468 元的套餐用了 3 个月想退,按月折算该退多少?只给数字。"
ROUNDS = 3

for env_file in (".env", ".env.sf"):
    cfg = dotenv_values(env_file)
    client = OpenAI(base_url=cfg["LLM_BASE_URL"], api_key=cfg["LLM_API_KEY"])
    extra = json.loads(cfg.get("LLM_EXTRA_BODY") or "{}")
    answers: list[str] = []
    seconds: list[float] = []
    for _ in range(ROUNDS):
        start = time.perf_counter()
        resp = client.chat.completions.create(
            model=cfg["LLM_MODEL"] or "",
            messages=[{"role": "user", "content": QUESTION}],
            max_tokens=50,
            extra_body=extra,
        )
        seconds.append(time.perf_counter() - start)
        answers.append(resp.choices[0].message.content or "")
    right = answers.count("351")
    print(f"{env_file:<8} 回答 {answers}  答对 {right}/{ROUNDS}  平均 {sum(seconds) / ROUNDS:.2f}s")
```

<div class="line-notes">

- `ROUNDS = 3` 每家问几次。想看得更准可以加大,花费按比例涨。
- `answers: list[str] = []` 空列表要标类型,不然编辑器推断不出里面放什么([Day 46](/blog/agent-zero/day-046-type-hints-2/))。
- `for _ in range(ROUNDS):` 循环变量用不上时习惯写 `_`。
- `answers.append(resp.choices[0].message.content or "")` `content` 可能是 `None`,`or ""` 保证列表里都是字符串。
- `right = answers.count("351")` 列表的 `.count(值)` 数有几个等于它。要求一字不差,多一个「元」字也算错,这是为了简单,真实评测会更宽松地比对。
- `sum(seconds) / ROUNDS` 平均耗时。

</div>

```bash
uv run part02/same_question.py
```

实跑输出:

```text
.env     回答 ['351', '351', '351']  答对 3/3  平均 0.62s
.env.sf  回答 ['351', '324', '390']  答对 1/3  平均 1.45s
```

DeepSeek 三次全对,硅基流动三次给了三个不同的数,只对一次,而且平均慢一倍多。这个结果只代表我跑的这一刻、这一道题,换个时间、换道题都可能不一样。它说明的道理不会变:模型名一样不代表效果一样,换厂商之前用自己的题测一遍。另外也提醒你,这类要算数的题关掉思考是有代价的,第三部分讲工具调用时会让模型调计算器,而不是靠它心算。

</details>

**练习 3:半套配置的报错。** 在一个子 shell 里只 `export LLM_BASE_URL=https://api.deepseek.com`,然后用 `ask_any_noover.py`(没写 `override` 的那份)读 `.env.sf`。先猜会发生什么,再跑。

<details><summary>参考答案</summary>

```bash
(export LLM_BASE_URL=https://api.deepseek.com
  ENV_FILE=.env.sf uv run part02/ask_any_noover.py 2>&1 | tail -1)
```

<div class="line-notes">

- `(export LLM_BASE_URL=https://api.deepseek.com` 子 shell 里只设地址,key 和模型名没设。
- `ENV_FILE=.env.sf uv run part02/ask_any_noover.py 2>&1 | tail -1)` `2>&1` 把报错也并进正常输出,再用 `tail -1` 只看最后一行。

</div>

猜测:地址是终端里的 DeepSeek,key 和模型名来自 `.env.sf`(硅基流动的 key、带前缀的模型名)。拿硅基流动的 key 去 DeepSeek,应该在鉴权这一步就被拒,报 401。

实跑输出:

```text
openai.AuthenticationError: Error code: 401 - {'error': {'message': 'Authentication Fails, Your api key: ****xxxx is invalid (request_id: 5c3e453d-b9a2-4390-92c4-6465f28b8eef)', 'type': 'authentication_error', 'param': None, 'code': 'invalid_request_error'}}
```

(报错里 DeepSeek 会显示 key 的末 4 位,我替换成了 `xxxx`。)和猜的一样是 401。注意它的说法是「你的 key 无效」,很容易让人去控制台检查 DeepSeek 的 key,其实 DeepSeek 的 key 好好的,是 key 和地址配错了对。看到 401 时先打印实际的 `base_url`,确认 key 和地址是不是同一家的。把脚本里的 `load_dotenv(env_file)` 换回 `override=True`,同样的命令就正常了。

</details>

**练习 4:让 `ask2.py` 也能切厂商。** 把 Day 122 的 `ask2.py` 改成也读 `ENV_FILE` 和 `LLM_EXTRA_BODY`,存成 `part02/ask3.py`,用硅基流动跑一次 30 token 截断的情况,确认 `finish_reason` 检查对硅基流动同样有效。

<details><summary>参考答案</summary>

只需要改三处,其余和 `ask2.py` 一样:

```python
# agent-zero-lab/part02/ask3.py
import json
import os
import sys

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletion

load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
extra_body = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))


class IncompleteAnswer(Exception):
    pass


def read_answer(resp: ChatCompletion) -> str:
    choice = resp.choices[0]
    if choice.finish_reason != "stop":
        raise IncompleteAnswer(f"模型没说完:finish_reason={choice.finish_reason}")
    return choice.message.content or ""


question = sys.argv[1] if len(sys.argv) > 1 else "用一句话介绍你自己"
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 500

resp = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": question}],
    max_tokens=limit,
    extra_body=extra_body,
)
print("模型:", resp.model, "| finish_reason:", resp.choices[0].finish_reason)
try:
    print(read_answer(resp))
except IncompleteAnswer as e:
    print("出错了:", e)
    sys.exit(1)
```

<div class="line-notes">

- `load_dotenv(os.environ.get("ENV_FILE", ".env"), override=True)` 第一处:按 `ENV_FILE` 读配置,整套覆盖。
- `extra_body = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` 第二处:扩展参数从配置来。
- `extra_body=extra_body,` 第三处:不再写死 DeepSeek 的 `thinking`。
- `print("模型:", resp.model, "| finish_reason:", resp.choices[0].finish_reason)` 为了这个练习把模型名打出来,确认真的是硅基流动在回答。`usage_line` 省掉了,Day 124 会换成带价钱的版本。

</div>

```bash
ENV_FILE=.env.sf uv run part02/ask3.py "写一段 300 字的云簿 CloudLedger 产品介绍" 30
echo "exit=$?"
```

实跑输出:

```text
模型: deepseek-ai/DeepSeek-V4-Flash | finish_reason: length
出错了: 模型没说完:finish_reason=length
exit=1
```

`finish_reason` 是兼容范围里的字段,硅基流动截断时同样返回 `length`,检查逻辑一行不用改。

</details>

**验收标准**:`.env` 和 `.env.sf` 都有四个同名变量,`git check-ignore -v .env.sf` 有输出;`ENV_FILE=.env.sf uv run part02/ask_any.py` 第一行打印的地址是硅基流动;能复现 `ask_any_noover.py` 那次「说是 .env.sf、发去 DeepSeek」,并说出原因;能说出兼容范围里的三样东西和不在范围里的三样东西。

今天的花费:DeepSeek 大约 10 次,每次输入 15 左右、输出 1 到 100(含推理);硅基流动大约 10 次,其中开思考那次输出 111。按两家的贵价最坏情况估:DeepSeek 10 × (20 × 2 + 100 × 8) ÷ 1,000,000 ≈ 0.0084 元,硅基流动 10 × (20 × 3 + 120 × 9) ÷ 1,000,000 ≈ 0.0114 元。实际大部分请求只输出几个到三十几个 token,我又是在深夜跑的(DeepSeek 空闲价减半),两家合计不到 0.01 元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| OpenAI 兼容协议 | 照着 OpenAI 的 `/chat/completions` 格式实现的接口:同样的地址后缀、`Bearer` 鉴权、请求体和响应结构,所以 openai SDK 换个 `base_url` 就能调 |
| 事实标准 | 不是标准组织定的,而是先行者做了、大家跟着做,最后人人都按它来 |
| 聚合平台 | 自己部署很多家的模型、用一个兼容接口统一售卖的平台,比如硅基流动、OpenRouter |
| 硅基流动(SiliconFlow) | 国内的聚合平台,兼容地址 `https://api.siliconflow.cn/v1`,模型名带出品方前缀 |
| 阿里云百炼 | 阿里云的大模型平台,千问系列在这里调,兼容地址以 `/compatible-mode/v1` 结尾 |
| 扩展参数 | 某家厂商自己加的、OpenAI 标准里没有的请求字段,比如 DeepSeek 的 `thinking`、百炼的 `enable_thinking`,用 SDK 时放进 `extra_body` |
| `ENV_FILE` | 我们自己约定的环境变量,值是要读的配置文件名,用来在不改代码的情况下切厂商 |
| `LLM_EXTRA_BODY` | 配置文件里写扩展参数的变量,值是一行 JSON,用单引号包起来 |
| `override=True` | `load_dotenv` 的参数,让文件里的值覆盖已经存在的同名环境变量;切厂商时必须写 |
| `dotenv_values` | python-dotenv 的函数,把配置文件读成字典,不改环境变量,适合一个程序里同时用几家 |
| `time.perf_counter()` | 高精度计时器,两次读数相减得到耗时(秒),相当于浏览器的 `performance.now()` |

## 常见误区

**以为兼容就是什么都一样。** 实测同一个 DeepSeek V4 Flash,关思考后同一道退款题 DeepSeek 3 次全对,硅基流动 3 次只对 1 次;不传扩展参数时两家的思考行为也不同。兼容的是格式,不是效果。

**切配置文件时没写 `override=True`。** 实测终端里留着 DeepSeek 的变量时,脚本打印「配置文件:.env.sf」,请求却发去了 `https://api.deepseek.com`,没有任何报错。

**只覆盖了半套配置。** 实测只有 `LLM_MODEL` 被终端变量挡住时,硅基流动回 400「Model does not exist」;只有地址被挡住时,DeepSeek 回 401「api key is invalid」。看到这两种报错,先打印实际的 `base_url` 和 `model`。

**以为模型名各家通用。** DeepSeek 官方叫 `deepseek-flash`,硅基流动叫 `deepseek-ai/DeepSeek-V4-Flash`。模型名跟着厂商走,写进各自的配置文件。

**以为 `base_url` 都要带 `/v1`(或都不带)。** DeepSeek 不带,硅基流动带 `/v1`,百炼是 `/compatible-mode/v1`。照各家文档抄。

**`.env` 里的 JSON 不加引号。** python-dotenv 能读,但 `source .env` 时 zsh 报 `parse error near '{'`。统一用单引号把整串 JSON 包起来。

**JSON 的键忘了加双引号。** `{"thinking": {type: "disabled"}}` 在 JS 里是合法对象字面量,在 JSON 里不合法,`json.loads` 报 `Expecting property name enclosed in double quotes`。

**指望扩展参数的默认值。** DeepSeek 默认开思考,百炼文档说 Qwen3.8 Flash 默认开,硅基流动看题目。每个配置文件都显式写清楚开还是关。

## 学习资料

### 文档与文章

- [阿里云百炼:OpenAI 兼容](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope):中文,百炼兼容接口的地址、新旧域名、Python 示例。今天的 `.env.bailian` 按这页写。
- [阿里云百炼:深度思考](https://help.aliyun.com/zh/model-studio/deep-thinking):中文,列了哪些模型能开关思考、默认开还是关,还提到了硅基流动部署的 DeepSeek。对比着看能体会「扩展参数各家各样」。
- [硅基流动快速上手](https://docs.siliconflow.cn/cn/userguide/quickstart):中文,注册、建 key、第一次调用。
- [硅基流动:推理模型](https://docs.siliconflow.cn/cn/userguide/capabilities/reasoning):中文,它家文档里的思考开关写法 `enable_thinking` 和 `thinking_budget`。
- [Kimi API 快速开始](https://platform.kimi.com/docs/guide/start-using-kimi-api) 和 [智谱 OpenAI 兼容说明](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction):中文,两家的兼容地址和模型名,今天表格里的数据来自这两页。
- [python-dotenv](https://github.com/theskumar/python-dotenv):英文 README,`load_dotenv` 的 `override` 参数和 `dotenv_values` 都在这里有说明,还有一节讲变量里的引号怎么处理。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qDLf6TENj&autoplay=0&high_quality=1" title="LiteLLM 路由策略详解:让大模型 API 更稳定、更快、更省钱" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员暮闲 · LiteLLM 路由策略详解:让大模型 API 更稳定、更快、更省钱 · 17 分钟,2026 年 6 月。今天我们手动用配置文件切厂商;LiteLLM 把这件事做成了一个库和网关,还能按规则自动切。先看前半段理解它解决什么问题,怎么用以后第七部分再说。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kJPvzcEjV&autoplay=0&high_quality=1" title="手把手教你用30分钟学会Python调用大模型API" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>A1星球 · 手把手教你用 30 分钟学会 Python 调用大模型 API · 42 分钟,2026 年 3 月。Day 122 推荐过,今天看他换不同厂商调用的那段,注意每家的 base_url 和模型名写法。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sCy2-Sl7QzU" title="LiteLLM: One API for 100+ LLMs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CLI Stack · LiteLLM: One API for 100+ LLMs · 英文。讲「一个接口调上百家模型」这件事是怎么实现的,和今天的兼容协议是同一个思路往前走了一步。</figcaption>
</figure>

### 书籍

- *AI Engineering*(Chip Huyen 著,O'Reilly,2025 年;中文版情况我没能确认,先看英文原版):讲基于大模型做应用的工程书。和今天相关的是最后讲应用架构的那一章,里面有「模型网关」(model gateway)的说法:把调用不同厂商的差异收拢到一层里,就是今天配置文件做法的正规版。

### 开源项目与代码

- [BerriAI/litellm](https://github.com/BerriAI/litellm):把一百多家模型统一成 OpenAI 格式的开源库和网关。今天不用装,翻一下 README 里的厂商列表,感受一下「兼容」这件事的规模。
- [openai/openai-python](https://github.com/openai/openai-python):README 里搜「base_url」,官方自己就写了怎么指向别的兼容服务。

## 自测

1. 「OpenAI 兼容」具体是哪几样东西一样?举一个不在兼容范围里的东西。

<details><summary>答案</summary>

一样的是:地址后缀 `/chat/completions` 和 POST 方法、`Authorization: Bearer` 鉴权、请求体的标准字段(`model`、`messages`、`max_tokens` 等)、响应的主体结构(`choices[0].message.content`、`finish_reason`、`usage`)。不在范围里的:扩展参数(DeepSeek 的 `thinking`、百炼的 `enable_thinking`)、扩展参数的默认值、报错的 JSON 格式、各家多出来的响应字段、同名模型的质量。

</details>

2. 下面这段代码切到硅基流动后,请求还是发去了 DeepSeek,最可能是哪一行出了问题?

```python
env_file = os.environ.get("ENV_FILE", ".env")
load_dotenv(env_file)
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
```

<details><summary>答案</summary>

`load_dotenv(env_file)` 没写 `override=True`。终端里已经有 DeepSeek 的 `LLM_*` 环境变量(比如 `source .env` 过,或者 `~/.zshrc` 里 `export` 过),`load_dotenv` 默认不覆盖已有的变量,读 `.env.sf` 等于白读。改成 `load_dotenv(env_file, override=True)`,并把 `client.base_url` 打印出来确认。

</details>

3. 一个脚本里要同时调 DeepSeek 和硅基流动做对比,为什么用 `dotenv_values` 而不是两次 `load_dotenv`?

<details><summary>答案</summary>

`load_dotenv` 把值写进进程的全局环境变量,两家的变量名一样(都叫 `LLM_BASE_URL` 等),第二次读会把第一次的值覆盖掉(写了 `override=True` 时),或者第二次读不进来(没写时)。`dotenv_values` 只把文件读成一个字典,不碰环境变量,每家一个字典、一个客户端,互不干扰。

</details>

4. 你的配置文件里写的是 `LLM_EXTRA_BODY='{"thinking": {"type": "disabled"}}'`,现在要切到百炼,需要改代码吗?需要改什么?

<details><summary>答案</summary>

不改代码,只新建 `.env.bailian`:地址换成百炼的兼容地址,key 换成百炼的,模型名换成 `qwen3.8-flash` 这类千问的名字,`LLM_EXTRA_BODY` 换成百炼的写法 `'{"enable_thinking": false}'`。然后 `ENV_FILE=.env.bailian` 运行。这正是把厂商差异放进配置文件的好处。

</details>

5. 面试题:「老板说 DeepSeek 官方偶尔不稳定,让你把 Agent 切到另一家平台上的同一个模型做备份。你会怎么做,要注意什么?」

<details><summary>答案</summary>

代码层面,调用按 OpenAI 兼容格式写,厂商差异(地址、key、模型名、扩展参数、价格)全部放进配置,备用厂商就是多一份配置,出问题时切过去(或者用网关按规则自动切,比如 LiteLLM)。要注意的几点:第一,模型名一样不代表效果一样,我实测过同一个 DeepSeek V4 Flash,同一道算术题官方 3/3、某聚合平台 1/3,版本、部署方式都可能不同,切之前要用自己的评测集跑一遍,达标才能当备份;第二,扩展参数的写法和默认值要逐个核对,比如思考开关,默认值不同会让延迟和花费差好几倍;第三,报错格式、`usage` 里的缓存字段、价格都不同,监控、重试和算钱的代码要按兼容字段写,不能依赖某一家独有的字段;第四,两份 key 都要按密钥管理,配置文件不进 git。

</details>

## 明天预告

Day 124 · 算钱:从 usage 到人民币。今天往配置文件里放了地址、key、模型名和扩展参数,明天再加一行 `LLM_PRICE`:每家的缓存命中价、未命中价、输出价。然后写 `common/cost.py`,把 Day 122 读懂的 `usage` 换算成人民币,给它写测试,再用一段两千多 token 的系统提示词实测缓存命中能省多少钱。顺便你会发现,今天这两家的缓存表现也不一样。
