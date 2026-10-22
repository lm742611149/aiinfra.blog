---
title: 'Day 121 · 一次调用到底发了什么:请求逐字段'
description: '给 openai SDK 挂一个小钩子,把它真正发出去的 HTTP 请求原样打印出来:一行 POST、十几个请求头、一段 JSON。再不用 SDK、只用 httpx 手写一遍同样的请求,拿到同样的回答。然后逐个试 model、messages、max_tokens、temperature、stop、n 和 thinking,每个字段都实跑一次,其中 n=2、temperature=3、role 写错各得到一个 400 或 422,把 thinking 直接写成参数则在本机就报 TypeError,顺便讲清 extra_body 是干什么的。'
pubDate: 2026-10-22
regime: none
tags: ['api', 'http', 'deepseek', 'python', 'agent-zero']
series: 'agent-zero'
day: 121
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 120](/blog/agent-zero/day-120-api-register/) 你拿到了自己的 API key:实名、充值、建 key,写进 `.env`,确认 `.gitignore` 挡住了它;然后用 `part02/ask.py` 完成了第一次调用,花了 0.000144 元。最后把五种常见报错各制造了一次,其中最阴险的是 key 后面多一个空格,报出来像断网,其实请求在本机就被拦下了。

`ask.py` 里真正干活的只有一行 `client.chat.completions.create(...)`。这一行背后到底往网上发了什么?SDK 替我们做了哪些事?昨天留了一个问题没答:关思考为什么要写成 `extra_body={"thinking": ...}`,不能直接写 `thinking=...`?今天把这个请求拆开看。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 httpx 的事件钩子,把 openai SDK 发出去的 HTTP 请求(方法、地址、请求头、请求体)原样打印出来,说出 SDK 的每个参数变成了请求体里的哪一段。
2. 不用 SDK,只用 httpx 手写一个同样的请求并拿到回答,理解「SDK 只是帮你拼 HTTP 请求」。
3. 说出请求体里 `model`、`messages`、`max_tokens`、`temperature`、`stop`、`n`、`thinking` 各管什么,每个都实跑过一次,知道 DeepSeek 对它们的限制(比如 `n` 只能是 1)。
4. 分清两类错误:SDK 在本机就拦下的(`TypeError`),和发到服务器后被拒的(400、422);知道 `extra_body` 是给 SDK 不认识的字段用的。

今天的两个新概念:**请求体的结构**(SDK 参数和 HTTP 请求的对应关系)和**常用请求参数**。返回的那一大坨(`choices`、`finish_reason`、`usage`)明天 Day 122 拆,今天只在需要时瞄一眼。

预计用时:2–2.5 小时。实跑花费:今天全部脚本加练习一共调用了大约二十次,每次几十个 token,按昨天的算法合计不到 0.01 元(文末有算式)。前置:[Day 120](/blog/agent-zero/day-120-api-register/) 的 `.env` 和 `ask.py`、[Day 59](/blog/agent-zero/day-059-http-1/) 到 [Day 61](/blog/agent-zero/day-061-http-3/) 的 HTTP 请求行、header、JSON 请求体、[Day 64](/blog/agent-zero/day-064-httpx-1/) 的 httpx、[Day 39](/blog/agent-zero/day-039-json/) 的 `json.dumps`、[Day 110](/blog/agent-zero/day-110-sampling-1/) 的 temperature。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `raw_request.py` 默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 把 SDK 发出去的请求打印出来

前端同学看请求,第一反应是打开 DevTools 的 Network 面板,点一下就能看到请求头和请求体。Python 脚本没有 Network 面板,但我们可以自己做一个:在 SDK 发请求的那一刻插一个函数,把请求打印出来。

Day 120 说过,openai SDK 底层用 httpx2 发请求。httpx(和 httpx2)有一个功能叫**事件钩子**(event hooks):你给它一个函数,每次发请求之前它都会先调用这个函数,把要发的请求对象传进来。这和前端 axios 的**请求拦截器** `axios.interceptors.request.use(config => {...})` 是一个思路。openai SDK 允许你自己传一个 HTTP 客户端进去,我们就传一个挂了钩子的。

新建 `part02/show_request.py`(在 Day 120 的 `agent-zero-lab` 根目录,`.env` 已经配好):

```python
# agent-zero-lab/part02/show_request.py
import json
import os

from dotenv import load_dotenv
from openai import DefaultHttpxClient, OpenAI

load_dotenv()


def log_request(request):
    print(request.method, request.url)
    for name in ("content-type", "authorization", "user-agent"):
        value = request.headers.get(name, "")
        if name == "authorization":
            value = value[:10] + "****"
        print(f"  {name}: {value}")
    body = json.loads(request.content)
    print(json.dumps(body, ensure_ascii=False, indent=2))


client = OpenAI(
    base_url=os.environ["LLM_BASE_URL"],
    api_key=os.environ["LLM_API_KEY"],
    http_client=DefaultHttpxClient(event_hooks={"request": [log_request]}),
)

resp = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[
        {"role": "system", "content": "你是云簿 CloudLedger 的客服助手,回答简洁。"},
        {"role": "user", "content": "发票抬头开错了能改吗?"},
    ],
    max_tokens=100,
    temperature=0.3,
    extra_body={"thinking": {"type": "disabled"}},
)
print("---- 回答 ----")
print(resp.choices[0].message.content)
```

<div class="line-notes">

- `from openai import DefaultHttpxClient, OpenAI` `DefaultHttpxClient` 是 SDK 提供的 HTTP 客户端类,本质是一个预设好超时等参数的 `httpx2.Client`。用它而不是自己 `httpx2.Client()`,是为了保留 SDK 的默认设置。
- `def log_request(request):` 钩子函数,参数是即将发出的请求对象。参数没写类型标注,basedpyright standard 档不会因此报错;要写的话类型是 `httpx2.Request`。
- `print(request.method, request.url)` 请求方法和完整地址。实跑:`POST https://api.deepseek.com/chat/completions`。
- `for name in ("content-type", "authorization", "user-agent"):` 先只挑三个重要的头看。HTTP 头的名字不分大小写,httpx 统一存成小写。
- `value = value[:10] + "****"` 鉴权头只露前 10 个字符,也就是 `Bearer sk-`,后面打码。Day 120 的规矩:任何输出里都不出现完整 key。
- `body = json.loads(request.content)` `request.content` 是要发出去的请求体,类型是字节串(bytes),里面是 JSON 文本。`json.loads` 把它解析成字典,相当于 `JSON.parse`。
- `print(json.dumps(body, ensure_ascii=False, indent=2))` 再转回 JSON 字符串打印,`indent=2` 缩进好读,`ensure_ascii=False` 让中文原样显示([Day 39](/blog/agent-zero/day-039-json/))。
- `http_client=DefaultHttpxClient(event_hooks={"request": [log_request]}),` 关键这一行。`event_hooks` 是一个字典,`"request"` 键对应「发请求前」要调用的函数列表;还有 `"response"` 键,对应「收到响应后」。
- `{"role": "system", "content": "你是云簿 CloudLedger 的客服助手,回答简洁。"},` 这次多了一条 system 消息,给模型交代身份和要求。system 放什么,Day 130 专门讲。
- `max_tokens=100,` 最多输出 100 个 token,下面会单独试。
- `temperature=0.3,` Day 110 讲过的温度。客服回答要稳定,调低一点。
- `extra_body={"thinking": {"type": "disabled"}},` 关思考,看它在请求体里变成什么样。

</div>

```bash
uv run part02/show_request.py
```

实跑输出:

```text
POST https://api.deepseek.com/chat/completions
  content-type: application/json
  authorization: Bearer sk-****
  user-agent: OpenAI/Python 3.36.1
{
  "model": "deepseek-flash",
  "messages": [
    {
      "role": "system",
      "content": "你是云簿 CloudLedger 的客服助手,回答简洁。"
    },
    {
      "role": "user",
      "content": "发票抬头开错了能改吗?"
    }
  ],
  "max_tokens": 100,
  "temperature": 0.3,
  "thinking": {
    "type": "disabled"
  }
}
---- 回答 ----
可以改。分两种情况:

1. **当月开具、未跨月**:直接作废重开即可。
2. **已跨月或已认证**:需开具红字发票冲销后重开。

请提供发票号码和正确抬头,我帮你走流程。
```

这就是一次调用的真身,和 Day 59–61 学的 HTTP 请求一模一样,三部分:

- **请求行**:`POST` 方法,地址 `https://api.deepseek.com/chat/completions`。`base_url` 加上 SDK 拼的 `/chat/completions`。
- **请求头**:`content-type: application/json` 说请求体是 JSON;`authorization: Bearer sk-...` 是 Day 120 那把 key,`Bearer` 是一种约定写法,意思是「持有这个 token 的人」;`user-agent` 说是谁发的,这里是 OpenAI 的 Python SDK 3.36.1 版。
- **请求体**:一个 JSON 对象。你传给 `create()` 的每个参数,几乎原样变成了这里的一个键。

注意 `thinking` 那一项:我们写的是 `extra_body={"thinking": ...}`,到了请求体里,`extra_body` 这一层不见了,`thinking` 直接和 `model`、`messages` 平级。这就是 `extra_body` 的作用,后面单独讲。

还有一个细节:回答里有 `**当月开具、未跨月**` 这样的双星号。这是 Markdown 的加粗语法,模型很喜欢输出 Markdown。网页聊天界面会把它渲染成粗体,我们在终端里打印就原样显示星号了。以后做界面时(第八部分),前端要用 Markdown 渲染器来显示模型的回答。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="SDK 的 create 参数和 HTTP 请求三部分的对应关系">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="250" height="260" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="35" y="42" fill="var(--compute)">你写的 Python</text>
<text x="35" y="70" fill="var(--ink)">OpenAI(base_url=...,</text>
<text x="35" y="88" fill="var(--ink)">       api_key=...)</text>
<text x="35" y="124" fill="var(--ink)">.create(</text>
<text x="45" y="144" fill="var(--ink)">model=...,</text>
<text x="45" y="164" fill="var(--ink)">messages=[...],</text>
<text x="45" y="184" fill="var(--ink)">max_tokens=100,</text>
<text x="45" y="204" fill="var(--ink)">temperature=0.3,</text>
<text x="45" y="224" fill="var(--ink)">extra_body={</text>
<text x="55" y="244" fill="var(--ink)">"thinking": ...})</text>
<rect x="370" y="20" width="250" height="56" rx="6" fill="none" stroke="var(--mem)"/>
<text x="385" y="42" fill="var(--mem)">请求行</text>
<text x="385" y="62" fill="var(--ink)">POST {base_url}/chat/completions</text>
<rect x="370" y="88" width="250" height="56" rx="6" fill="none" stroke="var(--mem)"/>
<text x="385" y="110" fill="var(--mem)">请求头</text>
<text x="385" y="130" fill="var(--ink)">Authorization: Bearer sk-...</text>
<rect x="370" y="156" width="250" height="124" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="385" y="178" fill="var(--mem)">请求体(JSON)</text>
<text x="385" y="198" fill="var(--ink)">"model": ...</text>
<text x="385" y="216" fill="var(--ink)">"messages": [...]</text>
<text x="385" y="234" fill="var(--ink)">"max_tokens": 100</text>
<text x="385" y="252" fill="var(--ink)">"temperature": 0.3</text>
<text x="385" y="270" fill="var(--ink)">"thinking": ...(拍平)</text>
<line x1="230" y1="70" x2="370" y2="48" stroke="var(--ink-soft)"/>
<line x1="230" y1="88" x2="370" y2="118" stroke="var(--ink-soft)"/>
<line x1="270" y1="184" x2="370" y2="220" stroke="var(--ink-soft)"/>
<line x1="270" y1="236" x2="370" y2="266" stroke="var(--ink-soft)"/>
</g>
</svg>
<figcaption>左边是你写的代码,右边是实际发出去的 HTTP 请求。base_url 进了请求行,api_key 进了请求头,create() 的参数变成请求体的键;extra_body 里的内容被拍平,和 model 平级。</figcaption>
</figure>

## 不用 SDK,手写同一个请求

既然请求就是这么一个 POST,那不用 SDK、直接用 Day 64 学的 httpx 也能发。手写一遍的好处是,以后不管哪种语言、哪个框架,你都知道它底下就是这几样东西。

如果你的 `agent-zero-lab` 里还没有 httpx(Day 64 装过就有;注意 openai 带进来的是 httpx2,是另一个包),先装:

```bash
uv add httpx
```

新建 `part02/raw_request.py`:

```python
# agent-zero-lab/part02/raw_request.py
import os

import httpx
from dotenv import load_dotenv

load_dotenv()

url = os.environ["LLM_BASE_URL"] + "/chat/completions"
headers = {"Authorization": "Bearer " + os.environ["LLM_API_KEY"]}
body = {
    "model": os.environ["LLM_MODEL"],
    "messages": [
        {"role": "system", "content": "你是云簿 CloudLedger 的客服助手,回答简洁。"},
        {"role": "user", "content": "发票抬头开错了能改吗?"},
    ],
    "max_tokens": 100,
    "temperature": 0.3,
    "thinking": {"type": "disabled"},
}

r = httpx.post(url, headers=headers, json=body, timeout=60)
print("状态码:", r.status_code)
data = r.json()
print(data["choices"][0]["message"]["content"])
print(data["usage"]["prompt_tokens"], data["usage"]["completion_tokens"])
```

<div class="line-notes">

- `import httpx` Day 64 学的 HTTP 库,用法很像浏览器的 `fetch`。
- `url = os.environ["LLM_BASE_URL"] + "/chat/completions"` 自己拼地址,和 SDK 拼出来的一样:`https://api.deepseek.com/chat/completions`。
- `headers = {"Authorization": "Bearer " + os.environ["LLM_API_KEY"]}` 自己拼鉴权头。`Bearer` 后面**有一个空格**。`Content-Type` 不用写,下面 `json=` 会自动加。
- `body = {` 请求体就是一个普通字典,和上一个脚本打印出来的 JSON 一字不差。
- `"thinking": {"type": "disabled"},` 自己拼请求体时,`thinking` 直接写在第一层,不需要什么 `extra_body`。`extra_body` 是 SDK 才有的概念。
- `r = httpx.post(url, headers=headers, json=body, timeout=60)` 发 POST。`json=body` 会把字典转成 JSON 字符串放进请求体,并加上 `Content-Type: application/json`,相当于 `fetch(url, { method: "POST", headers, body: JSON.stringify(body) })`。`timeout=60` 最多等 60 秒,模型回答慢,httpx 默认的 5 秒不够([Day 65](/blog/agent-zero/day-065-httpx-2/) 讲过超时)。
- `print("状态码:", r.status_code)` 200 表示成功。
- `data = r.json()` 把响应体从 JSON 解析成字典。注意这里拿到的是**普通字典**,要用方括号取值;SDK 返回的是对象,用点号取值(`resp.choices[0].message.content`)。
- `print(data["choices"][0]["message"]["content"])` 一层层取到回答正文。这几层是什么,明天讲。
- `print(data["usage"]["prompt_tokens"], data["usage"]["completion_tokens"])` 输入和输出各多少 token。

</div>

```bash
uv run part02/raw_request.py
```

实跑输出:

```text
状态码: 200
可以改。发票抬头开错后,需联系开票方(销售方)处理:

- **当月开具的发票**:通常可直接作废重开。
- **跨月发票**:需开具红字发票冲销后,再重新开具正确抬头的发票。

请尽快联系开票方,并提供正确的抬头信息。
27 69
```

回答内容和上一个脚本不完全一样(模型每次措辞会变,Day 112 讲过 temperature 调低也不保证一样),但请求是同一个请求。输入 27 个 token:system 和 user 两条消息加起来,再加上一些格式标记。

那 SDK 到底帮了我们什么?对比一下两个脚本:SDK 替你拼了地址和鉴权头、把参数转成 JSON、把返回的 JSON 变成带类型的对象(编辑器能补全 `resp.choices[0].message`),出错时抛出分好类的异常(Day 120 见过的 `AuthenticationError`、`BadRequestError`),还会在网络出问题时自动重试。手写版这些都得自己来,这就是我们平时还是用 SDK 的原因。练习 1 会把 SDK 发的全部请求头打印出来,你能看到它多带了哪些东西。

## 请求体逐字段

DeepSeek 的 API 文档里,「对话补全」接口的请求体有二十来个字段,必填的只有两个:`model` 和 `messages`。下面挨个讲常用的,每个都实跑一次。其他的放在最后的表里,用到的那天再讲。

### model:用哪个模型

一个字符串。2026 年 10 月 DeepSeek 只接受 `deepseek-flash` 和 `deepseek-v4-pro` 两个名字,写错会 400,报错里直接列出这两个名字(Day 120 报错五)。我们一直从 `.env` 的 `LLM_MODEL` 读,不写死。

### messages:这一次你给模型看的全部内容

一个列表,每一项是一条消息,有 `role`(谁说的)和 `content`(说了什么)。role 有四种:

- `system`:给模型的「岗位说明」,比如「你是云簿的客服助手,回答简洁」。
- `user`:用户说的话。
- `assistant`:模型之前说过的话。多轮对话时,你要把它之前的回答也放进列表里再发一次。
- `tool`:工具执行的结果,第三部分讲工具调用时用。

这里先记住一件事:**模型这一次能看到的,只有这个列表里的内容**。它不记得你上一次问过什么,没有会话,也没有登录状态,每个请求都是独立的。想让它「记得」,你得自己把之前的对话一条条放进 `messages` 里再发过去。这件事 [Day 129](/blog/agent-zero/day-129-messages/) 专门讲,今天先知道列表的形状。

role 写错会怎样?我把 role 写成 `boss` 试了一下(下面的 `bad_params.py` 里有这个分支):

```text
openai.UnprocessableEntityError: Error code: 422 - {'error': {'message': 'Failed to deserialize the JSON body into the target type: messages[0].role: unknown variant `boss`, expected one of `system`, `user`, `assistant`, `tool`, `latest_reminder` at line 1 column 52 (request_id: be35c7f6-5671-4382-97ad-8239632ba6ac)', 'type': 'i...
```

这次是 **422**,和前面见过的 400 不太一样。DeepSeek 错误码文档写 400 是「请求体格式错误」,422 是「请求体参数错误」;实际上两者的边界各家不统一,你只要知道 4 开头都是「请求的问题,改请求,别重试」就行。报错里列的合法 role 除了那四个,还有一个 `latest_reminder`,这是 DeepSeek 自己加的,文档的请求参数说明里没写,我们不用它。

再试一个空列表 `messages=[]`:

```text
openai.BadRequestError: Error code: 400 - {'error': {'message': 'Empty input messages (request_id: 1be7cc6a-ed17-4aa7-8067-78591feda182)', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

至少要有一条消息。

### max_tokens、temperature、stop、n:四个常用旋钮

把它们放在一个脚本里试。新建 `part02/try_params.py`:

```python
# agent-zero-lab/part02/try_params.py
import os

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
NO_THINK = {"thinking": {"type": "disabled"}}
Q: list[ChatCompletionMessageParam] = [{"role": "user", "content": "用三句话说说发票抬头开错了怎么办。"}]

r1 = client.chat.completions.create(model=MODEL, messages=Q, max_tokens=12, extra_body=NO_THINK)
print("max_tokens=12 :", repr(r1.choices[0].message.content), r1.choices[0].finish_reason)

r2 = client.chat.completions.create(model=MODEL, messages=Q, stop=["。"], extra_body=NO_THINK)
print("stop=['。']   :", repr(r2.choices[0].message.content), r2.choices[0].finish_reason)
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletionMessageParam` SDK 给「一条消息」定义的类型。为什么要它,看下面 `Q` 那一行。
- `NO_THINK = {"thinking": {"type": "disabled"}}` 关思考的那一包,存成常量,每次调用传 `extra_body=NO_THINK`,省得重复写。
- `Q: list[ChatCompletionMessageParam] = [` 把消息列表单独存进变量时,要给它标上类型。不标的话,basedpyright 会把它推断成 `list[dict[str, str]]`,传给 `messages=` 时画红线:`"list[dict[str, str]]" is not assignable to "Iterable[ChatCompletionMessageParam]"`。直接写在 `create(messages=[...])` 里面时检查器能自己推断出来,所以 `ask.py` 不用标。这是 [Day 46](/blog/agent-zero/day-046-type-hints-2/) 学的 `list[...]` 写法的实际用处。
- `r1 = client.chat.completions.create(model=MODEL, messages=Q, max_tokens=12, extra_body=NO_THINK)` 只允许输出 12 个 token。
- `print("max_tokens=12 :", repr(r1.choices[0].message.content), r1.choices[0].finish_reason)` `repr` 让字符串带引号显示,能看清结尾在哪。后面顺便打印了 `finish_reason`(模型为什么停下),明天详讲。
- `r2 = client.chat.completions.create(model=MODEL, messages=Q, stop=["。"], extra_body=NO_THINK)` `stop` 是一个字符串列表,模型生成到其中任何一个就停。这里给一个中文句号。

</div>

```bash
uv run part02/try_params.py
```

实跑输出:

```text
max_tokens=12 : '1. 发票抬头开错后，应第一时间联系' length
stop=['。']   : '1. 当月发现且未认证：直接在开票系统中作废重开，确保抬头信息准确无误' stop
```

**max_tokens** 是这一次最多输出多少 token。第一行被拦腰截断在「联系」,话没说完。`finish_reason` 是 `length`,意思是「撞到长度上限停的」,不是模型自己说完的。**被截断时不会报错**,你拿到的就是半句话。如果你让模型输出 JSON,截断的 JSON 必然解析失败,所以 Day 122 会要求你每次调用都检查 `finish_reason`。不传的话,DeepSeek 文档写的默认值是非思考模式 8K、思考模式 64K,最大 393216。设大了不会多花钱,只按实际输出计费。

**stop** 是停止序列。第二行生成到第一个句号就停了,而且**句号本身没有出现在结果里**,`finish_reason` 是 `stop`。DeepSeek 最多允许 16 个停止序列。它的用处是让模型只输出你要的那一段,省输出 token,练习 3 会看到具体省了多少。

**temperature** 是 Day 110 的老朋友,DeepSeek 默认 1,允许 0 到 2,思考模式下不生效(Day 115)。超出范围会怎样?

**n** 是一次生成几个候选回答。OpenAI 支持 n 大于 1,一次拿好几个不同的回答。DeepSeek 呢?

这两个我放进一个专门「故意出错」的脚本里。新建 `part02/bad_params.py`,用命令行参数选要试哪一种:

```python
# agent-zero-lab/part02/bad_params.py
import os
import sys

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
Q: list[ChatCompletionMessageParam] = [{"role": "user", "content": "只回复 OK"}]
case = sys.argv[1]

if case == "top":
    client.chat.completions.create(model=os.environ["LLM_MODEL"], messages=Q, thinking={"type": "disabled"})  # pyright: ignore[reportCallIssue]
elif case == "temp":
    client.chat.completions.create(model=os.environ["LLM_MODEL"], messages=Q, temperature=3)
elif case == "role":
    client.chat.completions.create(model=os.environ["LLM_MODEL"], messages=[{"role": "boss", "content": "只回复 OK"}])  # pyright: ignore[reportArgumentType]
elif case == "n":
    client.chat.completions.create(model=os.environ["LLM_MODEL"], messages=Q, n=2)
elif case == "nomsg":
    client.chat.completions.create(model=os.environ["LLM_MODEL"], messages=[])
```

<div class="line-notes">

- `case = sys.argv[1]` 命令行第一个参数决定试哪一种,比如 `uv run part02/bad_params.py temp`。
- `client.chat.completions.create(model=os.environ["LLM_MODEL"], messages=Q, thinking={"type": "disabled"})  # pyright: ignore[reportCallIssue]` 把 `thinking` 直接当参数传。行尾的注释是告诉 basedpyright「这一行我故意写错,别画红线」,方括号里是要忽略的那条规则名。正常代码不要这么写,这里是为了演示。
- `client.chat.completions.create(model=os.environ["LLM_MODEL"], messages=Q, temperature=3)` 温度超出 0–2。
- `messages=[{"role": "boss", "content": "只回复 OK"}])  # pyright: ignore[reportArgumentType]` role 写错。编辑器其实能发现这个错:SDK 的类型里 role 只能是那几个固定的字符串,写 `boss` 会画红线。所以这一行也要加忽略注释才能演示。
- `client.chat.completions.create(model=os.environ["LLM_MODEL"], messages=Q, n=2)` 要两个候选。
- `client.chat.completions.create(model=os.environ["LLM_MODEL"], messages=[])` 空消息列表,上面已经贴过结果。

</div>

```bash
uv run part02/bad_params.py temp
uv run part02/bad_params.py n
```

实跑输出(各取最后一行):

```text
openai.BadRequestError: Error code: 400 - {'error': {'message': 'Invalid temperature value, the valid range of temperature is [0, 2] (request_id: aebf221b-ca51-431f-8bd1-9cdccb184c11)', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
openai.BadRequestError: Error code: 400 - {'error': {'message': 'Invalid n value (currently only n = 1 is supported) (request_id: c24f4c31-189b-409c-87f0-9fc323957ac7)', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

温度超范围,400,报错直接告诉你合法范围是 [0, 2]。`n=2` 也是 400:DeepSeek 目前只支持 1。这就是 Day 123 要讲的「OpenAI 兼容」的边界:请求格式一样,但不是每个参数每家都支持。想要多个候选,只能自己调多次。

### thinking 和 extra_body:SDK 不认识的字段怎么传

现在回答 Day 120 留下的问题。试一下把 `thinking` 直接当参数传:

```bash
uv run part02/bad_params.py top
```

```text
TypeError: Completions.create() got an unexpected keyword argument 'thinking'
```

注意这次的报错不是 `openai.BadRequestError`,没有错误码,也没有 `request_id`。它是一个 Python 的 `TypeError`:**请求根本没发出去**,在你电脑上调用函数那一刻就失败了。原因是 `create()` 这个函数的参数列表是 OpenAI 按自己的接口定义的,里面有 `model`、`messages`、`max_tokens`、`temperature` 等等,没有 `thinking`,因为思考开关是 DeepSeek 自己加的字段。Python 函数收到一个不认识的关键字参数,就报这个错,和你自己写的函数多传了一个参数一样([Day 29](/blog/agent-zero/day-029-functions-2/) 的关键字参数)。

`extra_body` 就是为这种情况留的口袋。你放进去的字典,SDK 不做任何检查,在拼请求体时原样合并到最外层。上面 `show_request.py` 的输出已经证明了:请求体里只有 `"thinking": {...}`,没有 `extra_body` 这一层。所以记一条规则:**OpenAI 标准里有的参数直接写;某个厂商自己加的参数,放进 `extra_body`**。DeepSeek 的 `thinking`、`user_id` 都属于后一类。

那 SDK 为什么不干脆什么参数都放行?因为直接写的参数有类型检查和编辑器补全:你把 `temperature` 拼成 `temprature`,编辑器当场画红线,运行也会 `TypeError`;放进 `extra_body` 的东西 SDK 完全不管,拼错了就原样发出去,能不能被发现全看服务器。练习 4 最后会看到,DeepSeek 收到拼错的字段时一声不吭地忽略了。

### 其他字段一览

剩下的字段,今天只认识一下,标了哪天讲。内容来自 [DeepSeek 对话补全接口文档](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion),2026 年 10 月查。

| 字段 | 干什么 | DeepSeek 的特殊之处 | 哪天讲 |
| --- | --- | --- | --- |
| `stream` | 一个字一个字地流式返回 | 和 OpenAI 一样 | Day 133–134 |
| `top_p` | 核采样 | 只在思考模式生效;非思考模式恒为 1.0,传了也被忽略 | Day 112 讲过 |
| `logprobs` / `top_logprobs` | 返回 token 的概率 | `top_logprobs` 最多 20 | Day 110 用过 |
| `response_format` | 要求输出 JSON | 只支持 `text` 和 `json_object` | Day 147 起 |
| `tools` / `tool_choice` | 工具调用 | 思考模式下不支持指定函数 | 第三部分 |
| `reasoning_effort` | 思考强度 | 取值 `none`/`low`/`high`/`max`,`none` 也能关思考 | Day 115 讲过 |
| `user_id` | 标记终端用户 | DeepSeek 自有字段,放 `extra_body`;不要放用户隐私 | 用到再说 |
| `frequency_penalty` / `presence_penalty` | 减少重复 | 文档写「已弃用,传入无效果」 | 不用 |

## SDK 还偷偷带了什么

最后回头看一眼请求头。`show_request.py` 只挑了三个头打印,完整的有十几个,练习 1 会全部打出来。这里先说结论:除了你认识的 `authorization`、`content-type`,SDK 还带了一组 `x-stainless-*` 开头的头,告诉服务器「我是什么语言、什么版本的 SDK,在什么系统上跑,这是第几次重试,读超时设了多少秒」。Stainless 是帮 OpenAI 生成这套 SDK 代码的公司,这些头主要给厂商做统计和排查用。其中两个对你有用:`x-stainless-retry-count: 0` 说明这是第一次发,不是重试;`x-stainless-read-timeout: 600` 说明 SDK 默认最多等 10 分钟。Day 120 那个「key 带空格」的坑之所以等了 3 秒多才报错,就是因为 SDK 在自动重试,Day 127 讲重试时会再碰到这个头。

## 动手练习

**练习 1:看全部请求头。** 改写钩子,把 SDK 发出去的**全部**请求头打印出来(鉴权头照样打码)。请求随便发一个最短的。数一数一共几个头,哪些是你在 `raw_request.py` 里没写的。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/all_headers.py
import os

from dotenv import load_dotenv
from openai import DefaultHttpxClient, OpenAI

load_dotenv()


def log_headers(request):
    for name, value in request.headers.items():
        if name == "authorization":
            value = value[:10] + "****"
        print(f"{name}: {value}")


client = OpenAI(
    base_url=os.environ["LLM_BASE_URL"],
    api_key=os.environ["LLM_API_KEY"],
    http_client=DefaultHttpxClient(event_hooks={"request": [log_headers]}),
)
client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": "只回复 OK"}],
    max_tokens=5,
    extra_body={"thinking": {"type": "disabled"}},
)
```

<div class="line-notes">

- `for name, value in request.headers.items():` 请求头对象可以像字典一样用 `.items()` 遍历,每次拿到一个 (名字, 值)。
- `value = value[:10] + "****"` 鉴权头打码,只留 `Bearer sk-`。
- `max_tokens=5,` 只是为了看请求头,回答越短越省钱。

</div>

```bash
uv run part02/all_headers.py
```

实跑输出:

```text
host: api.deepseek.com
accept-encoding: gzip, deflate
connection: keep-alive
authorization: Bearer sk-****
accept: application/json
content-type: application/json
user-agent: OpenAI/Python 3.36.1
x-stainless-lang: python
x-stainless-package-version: 3.36.1
x-stainless-os: MacOS
x-stainless-arch: x64
x-stainless-runtime: CPython
x-stainless-runtime-version: 3.12.13
x-stainless-async: false
x-stainless-retry-count: 0
x-stainless-read-timeout: 600
content-length: 126
```

一共 17 个。`raw_request.py` 里我们只写了 `Authorization`,httpx 自动加了 `host`、`accept-encoding`、`connection`、`content-type`(因为用了 `json=`)、`content-length` 和它自己的 `user-agent`。SDK 多出来的是 `accept: application/json` 和那 9 个 `x-stainless-*`。`content-length: 126` 是请求体的字节数;`x-stainless-arch: x64` 是因为我这台是 Intel Mac,Apple 芯片会显示 `arm64`。

</details>

**练习 2:没写 key,或者忘了写 Bearer。** 改 `raw_request.py` 的思路,写 `part02/raw_no_key.py`,发两次请求:第一次完全不带 `Authorization` 头,第二次带了但只写 key、不写 `Bearer `。打印状态码和返回内容的前 160 个字符。两次的报错一样吗?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/raw_no_key.py
import os

import httpx
from dotenv import load_dotenv

load_dotenv()

url = os.environ["LLM_BASE_URL"] + "/chat/completions"
body = {"model": os.environ["LLM_MODEL"], "messages": [{"role": "user", "content": "只回复 OK"}]}

for headers in ({}, {"Authorization": os.environ["LLM_API_KEY"]}):
    r = httpx.post(url, headers=headers, json=body, timeout=60)
    print(r.status_code, r.text[:160])
```

<div class="line-notes">

- `body = {"model": os.environ["LLM_MODEL"], "messages": [{"role": "user", "content": "只回复 OK"}]}` 最小的合法请求体,只有两个必填字段。
- `for headers in ({}, {"Authorization": os.environ["LLM_API_KEY"]}):` 遍历两种请求头:空字典(没有鉴权头),和只有 key 没有 `Bearer ` 前缀的。
- `print(r.status_code, r.text[:160])` `r.text` 是响应体的原始文本,截前 160 个字符,防止太长。

</div>

```bash
uv run part02/raw_no_key.py
```

实跑输出:

```text
401 Authentication Fails (governor)
401 Authentication Fails (auth header format should be Bearer sk-...)
```

都是 401,但说明不一样。第二次 DeepSeek 直接提示「头的格式应该是 `Bearer sk-...`」。这两种错用 SDK 时都不会犯,因为 SDK 替你拼头;手写请求、或者在别的工具里(比如 Postman、前端代码)配 API 时最常见。另外注意,这两次返回的不是 JSON 而是一句纯文本,所以如果你这时调 `r.json()` 会再报一个解析错误,手写请求时先看状态码再解析。

</details>

**练习 3:stop 能省多少钱。** 让模型「列出处理退款的三个步骤,每步一行,不要标题」,分别不带 `stop` 和带 `stop=["\n"]` 各调一次,打印回答和输出 token 数。写 `part02/first_line.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/first_line.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

for stop in (None, ["\n"]):
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "user", "content": "列出处理退款的三个步骤,每步一行,不要标题。"}],
        stop=stop,
        extra_body={"thinking": {"type": "disabled"}},
    )
    print(f"stop={stop!r}:")
    print(resp.choices[0].message.content)
    print("输出 token:", resp.usage.completion_tokens if resp.usage else None)
    print()
```

<div class="line-notes">

- `for stop in (None, ["\n"]):` 第一次 `stop=None`,等于没传;第二次遇到换行就停。`None` 相当于 JS 的 `null`。
- `stop=stop,` 传 `None` 时 SDK 会把这个参数整个省略,请求体里不出现 `stop`。
- `print(f"stop={stop!r}:")` `!r` 用 `repr` 显示,换行符会显示成 `'\n'` 而不是真的换一行。
- `print("输出 token:", resp.usage.completion_tokens if resp.usage else None)` SDK 把 `usage` 标成「可能是 None」,直接 `.completion_tokens` 编辑器会画红线,所以先判断一下。

</div>

```bash
uv run part02/first_line.py
```

实跑输出:

```text
stop=None:
核实退款申请与订单信息是否一致。
按原支付方式或约定方式发起退款操作。
记录退款结果并通知客户及相关方。
输出 token: 29

stop=['\n']:
核实退款申请与订单信息是否相符。
输出 token: 9
```

只要第一行时,输出从 29 个 token 降到 9 个。单次省的钱微不足道,但如果一个任务每天跑十万次,而你只需要第一行,`stop` 就能省下三分之二的输出费。它也有风险:模型要是先输出一个空行再说正事,你拿到的就是空字符串。所以 `stop` 适合格式非常固定的输出。

</details>

**练习 4:默认值不会出现在请求体里。** 用钩子只打印请求体,发两次请求:第一次只传 `model` 和 `messages`;第二次加上 `max_tokens=5`、`stop=["\n"]`,并在 `extra_body` 里放 `thinking` 和一个 `"user_id": "lab-day121"`。对比两个请求体。想一想:第一次请求,思考模式是开着还是关着?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/body_only.py
import json
import os

from dotenv import load_dotenv
from openai import DefaultHttpxClient, OpenAI

load_dotenv()


def log_body(request):
    print(json.dumps(json.loads(request.content), ensure_ascii=False))


client = OpenAI(
    base_url=os.environ["LLM_BASE_URL"],
    api_key=os.environ["LLM_API_KEY"],
    http_client=DefaultHttpxClient(event_hooks={"request": [log_body]}),
)
client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": "只回复 OK"}],
)
client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": "只回复 OK"}],
    max_tokens=5,
    stop=["\n"],
    extra_body={"thinking": {"type": "disabled"}, "user_id": "lab-day121"},
)
```

<div class="line-notes">

- `print(json.dumps(json.loads(request.content), ensure_ascii=False))` 先解析再转回字符串,不加 `indent`,一个请求体打成一行,方便对比。
- `messages=[{"role": "user", "content": "只回复 OK"}],` 第一次只传两个必填字段。
- `extra_body={"thinking": {"type": "disabled"}, "user_id": "lab-day121"},` `user_id` 是 DeepSeek 自己的字段,文档说用来做内容安全和缓存隔离,只能用字母、数字、`-` 和 `_`。它不在 OpenAI 的参数表里,所以也放进 `extra_body`。

</div>

```bash
uv run part02/body_only.py
```

实跑输出:

```text
{"model": "deepseek-flash", "messages": [{"role": "user", "content": "只回复 OK"}]}
{"model": "deepseek-flash", "messages": [{"role": "user", "content": "只回复 OK"}], "max_tokens": 5, "stop": ["\n"], "thinking": {"type": "disabled"}, "user_id": "lab-day121"}
```

第一个请求体里只有两个键。你没传的参数,SDK 一个都不发,`temperature`、`max_tokens` 用的都是**服务器那边的默认值**。所以第一次请求的思考模式是**开着的**:DeepSeek 文档写 `thinking` 默认是 `enabled`。这次「只回复 OK」的请求,会先产生一段推理内容再回答,多花的输出 token 也要付钱(Day 115 算过思考模式贵十几倍)。这就是为什么这门课每次调用都要显式关思考,Day 136 封装 LLMClient 时会把它放进配置。

第二个请求体里,`extra_body` 的两个键都被拍平到了最外层。

最后验证一下正文里说的「`extra_body` 拼错了 SDK 不管」。我故意把 `thinking` 拼成 `thinkng`,新建 `part02/typo_extra.py`:

```python
# agent-zero-lab/part02/typo_extra.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

resp = client.chat.completions.create(
    model=os.environ["LLM_MODEL"],
    messages=[{"role": "user", "content": "只回复 OK"}],
    extra_body={"thinkng": {"type": "disabled"}},
)
msg = resp.choices[0].message
print("回答:", repr(msg.content))
print("有推理内容吗:", bool(getattr(msg, "reasoning_content", None)))
print(resp.usage.completion_tokens if resp.usage else None, resp.usage.completion_tokens_details if resp.usage else None)
```

<div class="line-notes">

- `extra_body={"thinkng": {"type": "disabled"}},` 少了一个 i。SDK 不检查 `extra_body`,原样发出去。
- `print("有推理内容吗:", bool(getattr(msg, "reasoning_content", None)))` DeepSeek 开思考时会在消息里多一个 `reasoning_content` 字段(Day 115 见过)。它不是 OpenAI 标准字段,SDK 的类型里没有,所以用 `getattr(对象, 名字, 默认值)` 取,取不到就给 `None`,相当于 JS 的 `msg.reasoning_content ?? null`。
- `print(resp.usage.completion_tokens if resp.usage else None,` 输出 token 总数,后面那个 `completion_tokens_details` 里有一项 `reasoning_tokens`,是其中花在推理上的部分。

</div>

```bash
uv run part02/typo_extra.py
```

实跑输出:

```text
回答: 'OK'
有推理内容吗: True
12 CompletionTokensDetails(accepted_prediction_tokens=None, audio_tokens=None, reasoning_tokens=10, rejected_prediction_tokens=None, text_tokens=None)
```

没有任何报错,状态码 200,回答也正常。但思考模式根本没关上:12 个输出 token 里有 10 个是推理。DeepSeek 对这个不认识的字段 `thinkng` 默默忽略了。这种错误只会体现在账单上,所以放进 `extra_body` 的东西,最好用今天的钩子看一眼请求体,再看看返回结果有没有按你想的变化。

</details>

**练习 5:用 curl 发同一个请求。** 不写 Python,用 curl 发一个最小的对话请求(`max_tokens` 5、关思考),key 从 `.env` 读,把返回的 JSON 格式化打印出来。

<details><summary>参考答案</summary>

```bash
(set -a; source .env; set +a;
  curl -s "$LLM_BASE_URL/chat/completions" \
    -H "Authorization: Bearer $LLM_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model": "deepseek-flash", "messages": [{"role": "user", "content": "只回复 OK"}], "max_tokens": 5, "thinking": {"type": "disabled"}}') \
  | python3 -m json.tool
```

<div class="line-notes">

- `(set -a; source .env; set +a;` Day 120 练习 2 的写法:在子 shell 里把 `.env` 读成环境变量,出了括号就消失。
- `curl -s "$LLM_BASE_URL/chat/completions" \` 地址。行尾的反斜杠表示「命令还没完,下一行接着」。
- `-H "Authorization: Bearer $LLM_API_KEY" \` 鉴权头。
- `-H "Content-Type: application/json" \` curl 不会自动加这个头,要自己写([Day 61](/blog/agent-zero/day-061-http-3/))。
- `-d '{"model": "deepseek-flash"` `-d` 是请求体,有了它 curl 自动用 POST。JSON 用单引号包起来,里面的双引号就不用转义。这里模型名直接写死了,因为单引号里 shell 不会替换 `$LLM_MODEL`。

</div>

实跑输出:

```json
{
    "id": "cd955685-9b71-40f9-9db4-148a5d3f8d79",
    "object": "chat.completion",
    "created": 1792669839,
    "model": "deepseek-flash",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "content": "OK"
            },
            "logprobs": null,
            "finish_reason": "stop"
        }
    ],
    "usage": {
        "prompt_tokens": 7,
        "completion_tokens": 1,
        "total_tokens": 8,
        "prompt_tokens_details": {
            "cached_tokens": 0
        },
        "prompt_cache_hit_tokens": 0,
        "prompt_cache_miss_tokens": 7
    },
    "system_fingerprint": "e72d3c7f663d3e1383b00b3884cb4501"
}
```

curl、httpx、SDK 三种方式发的是同一个请求,拿到的是同样结构的响应。这一大段响应,就是明天 Day 122 要逐字段拆的东西。

</details>

**验收标准**:`show_request.py` 能打印出请求行、三个请求头和请求体,你能指着请求体说出每个键对应 `create()` 的哪个参数;`raw_request.py` 不用 SDK 拿到状态码 200 和回答;能说出 `TypeError: ... unexpected keyword argument 'thinking'` 和 `400 Invalid n value` 的区别(一个没发出去,一个被服务器拒了)。

今天的花费:我一共调用了大约 20 次,绝大多数输入不到 30 个 token、输出不到 70 个;按高峰价最坏情况估,20 × (30 × 2 + 70 × 8) ÷ 1,000,000 ≈ 0.0124 元。实际是在晚上的空闲时段跑的,价格减半,而且大部分请求的输出只有几个 token,真实花费不到这个数的一半。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 请求行 | HTTP 请求的第一行:方法 + 地址,这里是 `POST https://api.deepseek.com/chat/completions` |
| 请求体(body) | POST 请求里放数据的部分,大模型 API 用 JSON,`model`、`messages` 等都在这里 |
| `Authorization: Bearer sk-...` | 放 API key 的请求头。Bearer 是一种约定写法,意思是「持有这个令牌的人」 |
| 事件钩子(event hooks) | httpx 的功能:发请求前或收响应后自动调用你给的函数,类似 axios 的拦截器 |
| `DefaultHttpxClient` | openai SDK 提供的 HTTP 客户端类,可以传 `event_hooks` 等参数,再交给 `OpenAI(http_client=...)` |
| `model` | 用哪个模型。DeepSeek 只接受 `deepseek-flash`、`deepseek-v4-pro` |
| `messages` | 这一次给模型看的全部内容,列表里每条有 `role` 和 `content` |
| role | 消息是谁说的:`system`(岗位说明)、`user`(用户)、`assistant`(模型之前的回答)、`tool`(工具结果) |
| `max_tokens` | 本次最多输出多少 token,撞到上限时回答被截断,`finish_reason` 是 `length`,不报错 |
| `stop` | 停止序列,生成到其中任一字符串就停,该字符串不出现在结果里;DeepSeek 最多 16 个 |
| `n` | 一次生成几个候选。DeepSeek 只支持 1 |
| `extra_body` | SDK 给非标准字段留的口袋,内容原样合并到请求体最外层,SDK 不检查 |
| `TypeError: unexpected keyword argument` | Python 函数收到不认识的参数名时的报错,发生在本机,请求没发出去 |
| 422 | 「请求体参数错误」,DeepSeek 在 role 写错时返回;和 400 一样都是请求的问题,改请求别重试 |
| `x-stainless-*` 请求头 | openai SDK 自动带的一组头,说明 SDK 版本、系统、第几次重试、超时多少 |
| `ChatCompletionMessageParam` | openai SDK 里「一条消息」的类型,单独存消息列表时用它标注,避免编辑器红线 |

## 常见误区

**以为 SDK 做了什么神奇的事。** 用钩子打印出来就一个 POST、几个头、一段 JSON。用 httpx 手写一遍,同样拿到 200 和回答。SDK 帮你的是拼请求、解析返回、分类报错和自动重试。

**把厂商自己的参数直接写进 `create()`。** 实测 `thinking={"type": "disabled"}` 直接报 `TypeError: Completions.create() got an unexpected keyword argument 'thinking'`,请求没发出去。厂商扩展字段放进 `extra_body`。

**手写请求时把 `extra_body` 也写进请求体。** `extra_body` 是 SDK 的概念,真实请求体里没有这一层。用 httpx 或 curl 时,`thinking` 直接写在 JSON 最外层。

**以为 `extra_body` 拼错了会报错。** 实测把 `thinking` 拼成 `thinkng`,状态码 200、回答正常,但 12 个输出 token 里 10 个是推理,思考根本没关上。SDK 不检查 `extra_body`,DeepSeek 也默默忽略不认识的字段。

**以为没传的参数会用 SDK 的默认值。** 实测没传的参数根本不出现在请求体里,用的是服务器的默认值。DeepSeek 的思考模式默认是开的,不显式关掉,每次都会多付一段推理的钱。

**以为 `max_tokens` 不够时会报错。** 不会。实测 `max_tokens=12` 返回了半句话「应第一时间联系」,状态码照样 200,只有 `finish_reason` 变成了 `length`。

**以为 OpenAI 支持的参数 DeepSeek 都支持。** 实测 `n=2` 返回 400「currently only n = 1 is supported」;文档里 `frequency_penalty`、`presence_penalty` 标着「已弃用,传入无效果」。用之前查厂商自己的文档。

**手写鉴权头忘了 `Bearer `。** 实测只写 key 返回 401「auth header format should be Bearer sk-...」,而且返回的是纯文本不是 JSON,接着调 `r.json()` 会再报一个解析错误。

**把消息列表存进变量后编辑器画红线。** 不标类型时它被推断成 `list[dict[str, str]]`,传给 `messages=` 时报 `is not assignable to "Iterable[ChatCompletionMessageParam]"`。写成 `Q: list[ChatCompletionMessageParam] = [...]`。

## 学习资料

### 文档与文章

- [DeepSeek API:对话补全](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion):中文,今天所有字段的权威说明,每个参数的类型、默认值、取值范围都在这里。今天的「其他字段一览」表就是从这页整理的。花 20 分钟从头翻一遍。
- [DeepSeek 错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes):400 和 422 各自的描述。
- [httpx 文档:Event Hooks](https://www.python-httpx.org/advanced/event-hooks/):英文,今天 `show_request.py` 用的钩子,还有 `response` 钩子的例子,很短。
- [MDN:Authorization 请求头](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Reference/Headers/Authorization):中文,前端同学熟悉的 MDN,讲 `Bearer`、`Basic` 这些鉴权方式。
- [OpenAI API Reference:Create chat completion](https://platform.openai.com/docs/api-reference/chat/create):英文,OpenAI 自己的字段定义,对比着看能知道哪些是 DeepSeek 没有的(比如 `n`)。这个站对命令行访问返回 403,需浏览器打开。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DQag6FEsH&autoplay=0&high_quality=1" title="第19讲:LLM请求参数详解——temperature、top_p、max_tokens的实际影响" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Mooxesther · 第 19 讲:LLM 请求参数详解,temperature、top_p、max_tokens 的实际影响 · 16 分钟,2026 年 9 月。同一个 prompt 换不同参数对比输出,和今天的 `try_params.py` 是一个思路,可以对照看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18hVN6eECg&autoplay=0&high_quality=1" title="API 参数全解,temperature 到 logprobs" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>陶欤冰 · API 参数全解,temperature 到 logprobs · 31 分钟,2026 年 5 月。比今天讲得更全,把请求参数从头到尾过了一遍,适合当参考,挑今天表里列的几个看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/czvVibB2lRA" title="The OpenAI (Python) API | Introduction & Example Code" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Shaw Talebi · The OpenAI (Python) API | Introduction & Example Code · 英文,2023 年。Day 120 推荐过,今天看后半段讲 `messages`、`max_tokens`、`temperature`、`n` 的部分。他演示的 `n` 在 OpenAI 上能用,在 DeepSeek 上会 400。</figcaption>
</figure>

### 书籍

- 《HTTP 权威指南》(David Gourley、Brian Totty 等著;英文原版 *HTTP: The Definitive Guide*,O'Reilly,2002 年;中译本由人民邮电出版社的图灵程序设计丛书出版):老书,但请求行、请求头、请求体这些基础二十年没变。今天只需要翻第 3 章「HTTP 报文」,看一个请求由哪几部分组成。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):SDK 源码。README 里搜「extra_body」能看到官方对它的说明(「Undocumented request params」那一节);`src/openai/_base_client.py` 是拼请求和重试的地方,今天不用读,知道在哪就行。
- [httpx](https://www.python-httpx.org/):手写请求用的库。

## 自测

1. `client.chat.completions.create(model=..., messages=..., max_tokens=100)` 发出去的 HTTP 请求,请求行、`Authorization` 头和请求体分别是什么?

<details><summary>答案</summary>

请求行是 `POST https://api.deepseek.com/chat/completions`(`base_url` 加 SDK 拼的路径)。`Authorization` 头是 `Bearer sk-...`,值来自建客户端时传的 `api_key`。请求体是 JSON:`{"model": "deepseek-flash", "messages": [...], "max_tokens": 100}`,没传的参数不会出现。

</details>

2. 为什么 DeepSeek 的 `thinking` 要写在 `extra_body` 里?用 httpx 手写请求时也要这样写吗?

<details><summary>答案</summary>

`create()` 的参数列表是按 OpenAI 的接口定义的,没有 `thinking`,直接传会在本机报 `TypeError: unexpected keyword argument 'thinking'`,请求发不出去。`extra_body` 里的内容 SDK 不检查,原样合并到请求体最外层。用 httpx 手写时没有 SDK 这一层,直接在 JSON 最外层写 `"thinking": {"type": "disabled"}`,不需要 `extra_body`。

</details>

3. 你设了 `max_tokens=50` 让模型输出一段 JSON,程序后面 `json.loads` 偶尔报错。最可能是什么原因?怎么确认?

<details><summary>答案</summary>

输出撞到了 50 个 token 的上限被截断,JSON 不完整。截断时 API 不报错,状态码还是 200。确认方法是看 `finish_reason`:是 `length` 就说明被截断了,`stop` 才是模型自己说完的。修法是把 `max_tokens` 调大,并且每次调用都检查 `finish_reason`(Day 122 讲)。

</details>

4. 下面两个报错,哪个请求发到了服务器,哪个没有?各自该怎么修?
`TypeError: Completions.create() got an unexpected keyword argument 'temprature'`
`openai.BadRequestError: Error code: 400 - ... Invalid temperature value, the valid range of temperature is [0, 2]`

<details><summary>答案</summary>

第一个没发出去:参数名拼错了(`temprature`),Python 函数调用时就失败了,没有错误码和 request_id。修法是改正拼写,编辑器其实会提前画红线。第二个发到了服务器,服务器检查后拒绝:温度值超出 0–2 的范围。修法是把值改到范围内。两个都不该重试,重试一万次结果也一样。

</details>

5. 面试题:「你们的 Agent 用 openai SDK 调 DeepSeek,线上发现账单比预期高很多,但代码里每个请求都很短。你会从请求层面查哪些东西?」

<details><summary>答案</summary>

先用 httpx 事件钩子(或网关日志)把真实发出去的请求体打出来看,而不是只看代码。重点查三件事:第一,思考模式有没有显式关掉,没传 `thinking` 时 DeepSeek 默认开启,每次都多一段按输出计费的推理;如果是用 `extra_body` 传的,确认它真的出现在请求体最外层、拼写正确。第二,`messages` 是不是越来越长,模型无状态,多轮对话每次都要把历史全发一遍,输入 token 会累积(Day 131 讲)。第三,`max_tokens` 和 `stop` 有没有设,输出是不是比需要的长。再看响应的 `usage` 和请求头里的 `x-stainless-retry-count`,确认有没有大量重试把同一个请求发了好几次。最后按 `usage` 拆账,定位是输入、输出还是重试贵。

</details>

## 明天预告

Day 122 · 响应逐字段:choices、finish_reason、usage。今天练习 5 用 curl 拿到了一整段响应 JSON,里面有 `id`、`choices`、`message`、`finish_reason`、`usage`、`system_fingerprint`。明天把它一层层拆开:为什么 `choices` 是个列表、`finish_reason` 有哪几种值、每次调用后为什么一定要检查它、`usage` 里五个 token 数各是什么意思,以及 SDK 返回的对象和原始 JSON 怎么对应。
