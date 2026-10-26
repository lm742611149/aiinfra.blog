---
title: 'Day 163 · tool_choice 和思考模式的坑'
description: 'tool_choice 是你发给模型的请求参数,管「这一轮能不能用工具」:auto 让它自己定,none 不许用,required 必须用,还能指定一个函数。今天四种各实测一遍:required 遇到「你好,你是谁」会硬造一个 {"city": "北京"};none 不等于模型不想调,它会把调用写成一段 DSML 标记文字漏进 content,连不带 tools 也一样;指定函数可以当结构化输出用,四张工单全部分对。再看思考模式的两个坑:开着思考时 required 和指定函数直接 400「Thinking mode does not support this tool_choice」;带 tools 时文档要求原样回传 reasoning_content(实测去掉也没报错,但按文档来)。'
pubDate: 2026-10-23
regime: none
tags: ['function-calling', 'tool-use', 'tool-choice', 'agent-zero']
series: 'agent-zero'
day: 163
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 162](/blog/agent-zero/day-162-parallel-tools/) 把模型一次提的几个请求并发执行了:`asyncio.gather` 加 `asyncio.to_thread`,三个城市从 8.5 秒变成 2.9 秒;有副作用的按顺序;最后写了带超时和并发上限的执行器 `run_all`。那天还有一个没解决的问题:想让模型「别并行」,DeepSeek 上既没有参数也劝不住,`parallel_tool_calls=False` 和提示词都被静默忽略。

今天看另一个控制模型用不用工具的参数,`tool_choice`。它和昨天那个不一样,DeepSeek 是认的,而且行为很明确。但它有两处容易踩的地方:一处是 `none` 不等于「模型不想调」,模型会把调用写成一段奇怪的文字塞进回答里;另一处是思考模式开着的时候,强制调用会直接 400。这两处都实测给你看。

## 今天要解决的问题

学完今天你应该能做到:

1. 分清 `tool_choice`(请求参数,你发给模型)和 `tool_calls`(响应字段,模型回给你),说出 `auto`、`none`、`required`、指定函数四种取值各自让模型做什么,以及每种对应的 `finish_reason` 和 `tool_calls`。
2. 用「指定函数」把 function calling 当结构化输出用:强制模型调一个 `classify_ticket`,只读它填的参数、从不执行,并用 Day 157 的 jsonschema 在本地检查。
3. 说出思考模式下的两条限制:`required` 和指定函数会 400;带 `tools` 时 `reasoning_content` 要原样回传。并能解释为什么 `LLMClient` 已经帮你做对了后一条。

今天有两个新概念:**`tool_choice`**(控制模型要不要用工具的请求参数)和**思考模式下的工具调用限制**(哪些组合会 400、哪些字段要回传)。思考模式本身是 [Day 115](/blog/agent-zero/day-115-reasoning-models/) 学过的。

预计用时:2.5 小时,实跑花费约 ¥0.04(算式在文末)。前置:[Day 159](/blog/agent-zero/day-159-tool-roundtrip/)(`tool` 消息、`check_messages`)、[Day 160](/blog/agent-zero/day-160-week23-review/)(`review160_check.py` 里的 `FakeClient` 和 `call_of`)、[Day 158](/blog/agent-zero/day-158-fc-first-run/)(`execute_call`)、[Day 157](/blog/agent-zero/day-157-tool-schema/)(`Draft202012Validator`)、[Day 150](/blog/agent-zero/day-150-structured-4/)(结构化输出的校验和重试)、[Day 115](/blog/agent-zero/day-115-reasoning-models/)(思考模式、`reasoning_content`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `extract_by_tool.py` 里的 `classify` 函数(强制调用、取参数、本地检查三步);再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

今天的实验边界和前几天一样:天气函数只查 Open-Meteo,工单是内存里的几句话,不读写任何文件,不执行任何模型给的字符串。

## 先分清方向:tool_choice 是请求,tool_calls 是响应

这两个名字只差一个词,方向正好相反。`tool_choice` 是你在 `client.chat(..., tool_choice=...)` 里**发给模型**的,规定这一轮能不能、必须不必须用工具;`tool_calls` 是模型**回给你**的,在 `r.message["tool_calls"]` 里,是它实际想调的工具和参数。前端的类比:`tool_choice` 像传进函数的 `options.mode`,`tool_calls` 像函数的返回值。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="tool_choice 在请求里,从我们这边发往模型;tool_calls 在响应里,从模型发回我们">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="30" y="40" width="200" height="150" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="130" y="64" text-anchor="middle" fill="var(--ink)">我们的代码</text>
<text x="46" y="92" fill="var(--ink-soft)">messages</text>
<text x="46" y="112" fill="var(--ink-soft)">tools=[...]</text>
<text x="46" y="132" fill="var(--ink)">tool_choice="required"</text>
<text x="46" y="170" fill="var(--ink-faint)" font-size="11">请求参数:我 → 模型</text>
<rect x="410" y="40" width="200" height="150" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="510" y="64" text-anchor="middle" fill="var(--ink)">模型</text>
<text x="426" y="92" fill="var(--ink-soft)">finish_reason</text>
<text x="426" y="112" fill="var(--ink-soft)">content</text>
<text x="426" y="132" fill="var(--ink)">tool_calls=[{...}]</text>
<text x="426" y="170" fill="var(--ink-faint)" font-size="11">响应字段:模型 → 我</text>
<line x1="230" y1="90" x2="410" y2="90" stroke="var(--compute)" stroke-width="2"/>
<polygon points="410,90 400,85 400,95" fill="var(--compute)"/>
<text x="320" y="82" text-anchor="middle" fill="var(--compute)" font-size="11">tool_choice 往这边走</text>
<line x1="410" y1="150" x2="230" y2="150" stroke="var(--mem)" stroke-width="2"/>
<polygon points="230,150 240,145 240,155" fill="var(--mem)"/>
<text x="320" y="170" text-anchor="middle" fill="var(--mem)" font-size="11">tool_calls 往这边回</text>
</g>
</svg>
<figcaption>tool_choice 是「我规定」,tool_calls 是「它想做」。规定得再严,模型实际填了什么参数还是要检查。</figcaption>
</figure>

四种取值,按 DeepSeek 接口文档(2026 年 10 月查,链接在文末)的原话整理:

| `tool_choice` | 意思 | 对 `tool_calls` 的影响 | 什么时候用 |
| --- | --- | --- | --- |
| `"auto"` | 模型自己决定:生成一段话,或者调一个或多个工具 | 可能有,可能没有 | 默认。带了 `tools` 时不传就是它 |
| `"none"` | 模型不调任何工具,只生成一段话 | 一定没有 | 「查完了,现在只许总结」;预算到头了 |
| `"required"` | 模型必须调一个或多个工具 | 至少一个 | 你明确知道这一步就是要调 |
| `{"type": "function", "function": {"name": "x"}}` | 必须调 `x` 这一个 | 一定是 `x` | 抽取、分类:把工具当结构化输出用 |

不带 `tools` 时默认是 `none`,带了就是 `auto`。文档末尾还有一句今天后半场会撞上的话:「`required` 和指定函数在思考模式下不支持,接口会返回 400」。

## 第一步:同一个问题,四种取值各问一次

先不讲道理,把四种都跑一遍看结果。两个问题:一个该查天气的,一个和天气毫无关系的。新建 `part03/tool_choice_demo.py`:

```python
# agent-zero-lab/part03/tool_choice_demo.py
"""同一个问题,四种 tool_choice 各问一次,看模型的回复长什么样。"""
from typing import Any

from common.llm import LLMClient
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]
NAMED: dict[str, Any] = {"type": "function", "function": {"name": "get_weather"}}
CHOICES: list[tuple[str, Any]] = [
    ("auto", "auto"),
    ("none", "none"),
    ("required", "required"),
    ("指定 get_weather", NAMED),
]

client = LLMClient(max_retries=0)
for question in ["北京现在多少度?", "你好,你是谁?"]:
    print(f"\n问:{question}")
    for label, choice in CHOICES:
        msgs: list[dict[str, Any]] = [
            {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
            {"role": "user", "content": question},
        ]
        r = client.chat(msgs, tools=TOOLS, tool_choice=choice, temperature=0, max_tokens=200)
        calls = r.message.get("tool_calls") or []
        args = [c["function"]["arguments"] for c in calls]
        print(f"  tool_choice={label:14} finish_reason={r.finish_reason:10} 请求 {len(calls)} 个 {args} 回答:{r.content[:30]!r}")
print(client.ledger)
```

<div class="line-notes">

- `from common.llm import LLMClient` Day 135 的客户端。`chat()` 的关键字参数会原样透传给 openai SDK,所以 `tool_choice=` 直接写就行,不用改它。
- `from part03.weather_tool import WEATHER_TOOL` Day 157 的天气工具定义,`city` 参数的描述里有「例如 北京、Shanghai」,等一下会看到这个例子的副作用。
- `NAMED: dict[str, Any] = {"type": "function", "function": {"name": "get_weather"}}` 指定函数的写法:外面 `type: function`,里面只写 `name`,不用带参数定义。
- `CHOICES: list[tuple[str, Any]] = [` 四种取值,每项是「标签、实际传的值」。前三种是字符串,第四种是字典,所以类型标成 `Any`。
- `client = LLMClient(max_retries=0)` 不重试,有报错立刻看到。
- `for question in ["北京现在多少度?", "你好,你是谁?"]:` 一个该查天气,一个和天气无关。
- `for label, choice in CHOICES:` 每个问题问四次。
- `msgs: list[dict[str, Any]] = [` 每次都用一份新的历史,免得互相影响。
- `r = client.chat(msgs, tools=TOOLS, tool_choice=choice, temperature=0, max_tokens=200)` 今天的主角:`tool_choice=choice`。`tools` 四次都带,只有 `tool_choice` 在变。
- `calls = r.message.get("tool_calls") or []` 取出请求,没有就是空列表。
- `args = [c["function"]["arguments"] for c in calls]` 只看参数字符串。
- `print(f"  tool_choice={label:14} finish_reason={r.finish_reason:10} 请求 {len(calls)} 个 {args} 回答:{r.content[:30]!r}")` 一行一种:结束原因、几个请求、参数、回答的前 30 个字。
- `print(client.ledger)` 八次调用的合计。

</div>

```bash
uv run python -m part03.tool_choice_demo
```

```text
问:北京现在多少度?
  tool_choice=auto           finish_reason=tool_calls 请求 1 个 ['{"city": "北京"}'] 回答:''
  tool_choice=none           finish_reason=stop       请求 0 个 [] 回答:'我无法实时获取天气信息，建议查看天气App或中国天气网。'
  tool_choice=required       finish_reason=tool_calls 请求 1 个 ['{"city": "北京"}'] 回答:''
  tool_choice=指定 get_weather finish_reason=tool_calls 请求 1 个 ['{"city": "北京"}'] 回答:''

问:你好,你是谁?
  tool_choice=auto           finish_reason=stop       请求 0 个 [] 回答:'你好！我是云簿 CloudLedger 的客服助手，可以帮你'
  tool_choice=none           finish_reason=stop       请求 0 个 [] 回答:'你好！我是云簿 CloudLedger 的客服助手，很高兴为'
  tool_choice=required       finish_reason=tool_calls 请求 1 个 ['{"city": "北京"}'] 回答:''
  tool_choice=指定 get_weather finish_reason=tool_calls 请求 1 个 ['{"city": "北京"}'] 回答:''
8 次调用 | 输入 2380 / 输出 234 tokens | 约 ¥0.0039
```

逐行读。第一个问题该查天气,`auto`、`required`、指定函数三种都提了 `{"city": "北京"}`,`finish_reason` 都是 `tool_calls`,表现一致。`none` 不许调,模型只能用嘴回答,它说「我无法实时获取天气信息,建议查看天气 App」。这是诚实的,它没有编一个温度。

第二个问题才是看点。「你好,你是谁?」和天气八竿子打不着,`auto` 和 `none` 都正常打招呼。但 **`required` 和指定函数两种下,模型硬提了一个 `{"city": "北京"}`**。它没有城市可查,但你规定它必须调,它就得往 `city` 里填点什么,填的是 Day 157 工具描述里「例如 北京、Shanghai」那个例子。Day 157 说过例子会被当样板抄,这里抄得最彻底:整个参数都是抄来的。

所以 `required` 和指定函数要配一个前提:**你确定这一步就是要调这个工具**。它们保证的是「一定会调」,不保证「调得有道理」。参数照样要过 Day 157 的本地检查,而且检查通过也不等于参数来自用户,「北京」就是完全合法又完全凭空的参数。练习 1 会拿五句无关的话再试一遍。

## 第二步:none 是「这一轮不许查」,但模型可能把调用写成文字

`none` 的典型用法是收尾:工具已经查完了,或者预算到头了,这一轮只许用手里的信息回答,不许再提请求。第一步里 `none` 表现得很乖,但那是在一段没有任何工具历史的对话里。换一个场景:对话里已经成功查过一次天气,用户追问两个新城市,这时候我们不想再查了。新建 `part03/tool_choice_none.py`:

```python
# agent-zero-lab/part03/tool_choice_none.py
"""none 的本意:这一轮不许再查,只许用手里的信息收尾。对比 auto,再对比「干脆不带 tools」。"""
from typing import Any

from common.llm import LLMClient
from part03.tool_runner import execute_call
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]
client = LLMClient(max_retries=0)

# 先正常走一轮:问北京,查到,答完
messages: list[dict[str, Any]] = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
    {"role": "user", "content": "北京现在多少度?"},
]
first = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=200)
messages.append(first.message)
for call in first.message.get("tool_calls") or []:
    messages.append({"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS)})
answer = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=200)
messages.append(answer.message)
print("第一轮回答:", answer.content.replace("\n", " "))

# 用户追问两个城市。假设这一轮的查询预算已经用完,我们不想再执行工具
messages.append({"role": "user", "content": "那上海和广州呢?"})
variants: list[tuple[str, dict[str, Any]]] = [
    ("auto", {"tools": TOOLS, "tool_choice": "auto"}),
    ("none", {"tools": TOOLS, "tool_choice": "none"}),
    ("不带 tools", {}),
]
for label, kw in variants:
    r = client.chat(messages, temperature=0, max_tokens=200, **kw)
    calls = r.message.get("tool_calls") or []
    print(f"\n追问 {label}:finish_reason={r.finish_reason},tool_calls {len(calls)} 个 {[c['function']['arguments'] for c in calls]}")
    print("  content:", repr(r.content))
print(client.ledger)
```

<div class="line-notes">

- `from part03.tool_runner import execute_call` Day 158 的执行函数,第一轮要真的查一次。
- `first = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=200)` 第一轮请求 1:模型提北京的请求。
- `messages.append(first.message)` 放回 assistant 消息。
- `messages.append({"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS)})` 执行,放回 tool 消息。
- `answer = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=200)` 第一轮请求 2:模型看到温度,回答。
- `messages.append(answer.message)` 回答也放回历史。到这里历史是 system、user、assistant(带请求)、tool、assistant(回答)五条,一段完整的、成功过的工具对话。
- `print("第一轮回答:", answer.content.replace("\n", " "))` 实测「北京现在 15.3°C,晴,风速约 9.4 km/h」。
- `messages.append({"role": "user", "content": "那上海和广州呢?"})` 用户追问两个新城市。
- `variants: list[tuple[str, dict[str, Any]]] = [` 同一份历史发三次,区别只在关键字参数。
- `("auto", {"tools": TOOLS, "tool_choice": "auto"}),` 对照组:正常允许调工具。
- `("none", {"tools": TOOLS, "tool_choice": "none"}),` 今天的主角:带着工具定义,但这一轮不许用。
- `("不带 tools", {}),` 第三种:连 `tools` 都不传。Day 159 第四步说过第二次请求不带 `tools` 也能成功,看看在这个场景下还成不成立。
- `r = client.chat(messages, temperature=0, max_tokens=200, **kw)` `**kw` 展开,空字典就是什么都不传。
- `print("  content:", repr(r.content))` 这次把 `content` 完整打出来,用 `repr` 让换行显示成 `\n`。

</div>

```bash
uv run python -m part03.tool_choice_none
```

```text
第一轮回答: 北京现在 15.3°C，晴，风速约 9.4 km/h。

追问 auto:finish_reason=tool_calls,tool_calls 2 个 ['{"city": "上海"}', '{"city": "广州"}']
  content: ''

追问 none:finish_reason=stop,tool_calls 0 个 []
  content: '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="get_weather">\n<｜｜DSML｜｜ parameter name="city" string="true">上海</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>\n<｜｜DSML｜｜ invoke name="get_weather">\n<｜｜DSML｜｜ parameter name="city" string="true">广州</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>'

追问 不带 tools:finish_reason=stop,tool_calls 0 个 []
  content: '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="get_weather">\n<｜｜DSML｜｜ parameter name="city" string="true">上海</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>\n<｜｜DSML｜｜ invoke name="get_weather">\n<｜｜DSML｜｜ parameter name="city" string="true">广州</｜｜DSML｜｜ parameter>\n</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>'
5 次调用 | 输入 1668 / 输出 259 tokens | 约 ¥0.0039
```

`auto` 正常:提了上海、广州两个请求。`none` 这一行就有意思了:`finish_reason` 是 `stop`,`tool_calls` 是空的,从字段上看服务端完全遵守了「不调工具」。可是 `content` 里是一大段 `<｜｜DSML｜｜ calls>`、`invoke name="get_weather"`、`parameter name="city"`,里面写着上海、广州。**模型把它想调的两个工具用一种标记语言写成了文字,放进了回答里。**第三种「不带 tools」一模一样。

我把这个实验又跑了三遍 `none`、两遍「不带 tools」,还把温度调到 1 试了一次(脚本没放进文章),六次全是这段文字,一字不差。这不是偶然。

发生了什么?[Day 156](/blog/agent-zero/day-156-fc-idea/) 说过,模型不会执行工具,它只是输出一段特定格式的文本,服务端把这段文本解析成你看到的 `tool_calls` 结构。DeepSeek 这一代模型用的格式叫 DSML,就是上面那些 `<｜DSML｜>` 标记。正常情况下,服务端看到这些标记就解析成 JSON,放进 `tool_calls`,`content` 里不会出现。可是你传了 `tool_choice="none"`(或者干脆不传 `tools`),从结果看,服务端这一轮没有做解析(内部怎么实现我看不到,这是按现象的推断),模型吐出来的标记原封不动地变成了「正文」。而模型为什么还要吐?因为对话历史里刚刚有一次成功的工具调用,用户紧接着问了两个一模一样的问题,它学过的最自然的下一步就是再调两次。`none` 管住了服务端,没管住模型的脑子。明天 Day 164 会专门讲这段文字,它正好揭开了「模型怎么学会调工具」的盖子。

这件事和 Day 159 第四步的结论要放在一起看。那天实测「第二次请求不带 `tools` 也成功」,是对的,但那是在「请求、结果、回答」这个紧凑的两轮里,模型拿到结果以后没有再调的动机。今天的场景多了一个追问,动机就回来了。所以 Day 159 的建议「整个对话里每次请求都带同一份 `tools`」现在有了更硬的理由:**不带 `tools` 不是「关掉工具」,而是「关掉解析」**。

那 `none` 还能不能用?能,但要**检查 `content`**。它仍然是「这一轮不许执行」的正确开关,服务端确实没有给你 `tool_calls`,你也不会漏回什么。只是收到的回答可能是一段标记而不是人话,直接发给用户就是事故。练习 2 会写一个检测器,认出这种漏出来的调用,换成一句人话。另一个更根本的做法是把「不许再查」也告诉模型,在最后一条 user 消息里加一句说明,Day 165 的练习会用到。

## 第三步:指定函数,把工具当结构化输出用

指定函数有个和「执行」无关的妙用。[Day 150](/blog/agent-zero/day-150-structured-4/) 讲结构化输出时提过 DeepSeek 不支持 `json_schema`,要 schema 约束得换硅基流动。今天有第二条路:定义一个 `classify_ticket(category, priority, reason)` 工具,用 `tool_choice` 强制模型调它,然后**只读它填的参数,根本不执行**。`parameters` 就是你要的 schema,`arguments` 就是你要的结构化结果,枚举、必填都在 Day 157 的那套本地检查里。新建 `part03/extract_by_tool.py`:

```python
# agent-zero-lab/part03/extract_by_tool.py
"""把「指定工具」当结构化输出用:强制模型调 classify_ticket,只读它填的参数,从不执行。"""
import copy
import json
from typing import Any, Protocol

from jsonschema import Draft202012Validator

CLASSIFY_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "classify_ticket",
        "description": "给一张客服工单打标签:类别、优先级,并用一句话说明理由。",
        "parameters": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "enum": ["billing", "bug", "feature", "other"],
                    "description": "billing 账单与发票;bug 功能故障;feature 新功能建议;other 其他",
                },
                "priority": {
                    "type": "string",
                    "enum": ["low", "medium", "high"],
                    "description": "影响付款或系统不可用是 high;影响使用但有绕法是 medium;建议和闲聊是 low",
                },
                "reason": {"type": "string", "description": "一句话,不超过 30 个字"},
            },
            "required": ["category", "priority", "reason"],
        },
    },
}
FORCE_CLASSIFY: dict[str, Any] = {"type": "function", "function": {"name": "classify_ticket"}}


class ChatClient(Protocol):
    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> Any: ...


def classify(client: ChatClient, text: str) -> dict[str, Any]:
    """返回 {"category", "priority", "reason"};模型填得不合格就抛 ValueError。"""
    messages = [
        {"role": "system", "content": "你是云簿 CloudLedger 的工单分拣员。"},
        {"role": "user", "content": f"工单内容:{text}"},
    ]
    r = client.chat(messages, tools=[CLASSIFY_TOOL], tool_choice=FORCE_CLASSIFY, temperature=0, max_tokens=200)
    calls = r.message.get("tool_calls") or []
    if not calls:
        raise ValueError(f"模型没有调用 classify_ticket,finish_reason={r.finish_reason}")
    try:
        args = json.loads(calls[0]["function"]["arguments"])
    except json.JSONDecodeError as e:
        raise ValueError(f"arguments 不是合法的 JSON:{e.msg}") from e
    schema = copy.deepcopy(CLASSIFY_TOOL["function"]["parameters"])
    schema["additionalProperties"] = False
    problems = [e.message for e in Draft202012Validator(schema).iter_errors(args)]
    if problems:
        raise ValueError("参数不合格:" + ";".join(problems))
    return args


if __name__ == "__main__":
    from common.llm import LLMClient

    client = LLMClient(max_retries=0)
    tickets = [
        "发票 INV-2026-0043 的金额不对,多收了我们 200 块,这个月要报销,请尽快处理",
        "导出报表的按钮点了没反应,控制台里是 500,换浏览器也一样",
        "希望能支持按季度自动开票,现在每个月手动点太麻烦了",
        "你们公司在哪个城市?有没有线下办公室?",
    ]
    for t in tickets:
        print(classify(client, t))
    print(client.ledger)
```

<div class="line-notes">

- `import copy` 下面要在 schema 的拷贝上加 `additionalProperties`,和 Day 158 的 `execute_call` 一样的手法。
- `from typing import Any, Protocol` `Protocol` 是 [Day 150](/blog/agent-zero/day-150-structured-4/) 用过的「鸭子类型」:只要有 `chat` 方法就行,测试里可以传 Day 160 的 `FakeClient`。
- `from jsonschema import Draft202012Validator` Day 157 的校验器。
- `CLASSIFY_TOOL: dict[str, Any] = {` 一个**永远不会被执行**的工具。它存在的意义是它的 `parameters`。
- `"description": "给一张客服工单打标签:类别、优先级,并用一句话说明理由。",` 描述照样认真写,它决定模型填参数的质量。
- `"enum": ["billing", "bug", "feature", "other"],` 四个类别用枚举钉死,Day 157 实测枚举是最明确的信号。
- `"description": "billing 账单与发票;bug 功能故障;feature 新功能建议;other 其他",` 每个枚举值是什么意思,写在描述里。
- `"enum": ["low", "medium", "high"],` 优先级三档。
- `"description": "影响付款或系统不可用是 high;影响使用但有绕法是 medium;建议和闲聊是 low",` 分档的规则,等于把分类标准写进了 schema。
- `"reason": {"type": "string", "description": "一句话,不超过 30 个字"},` 让模型说理由,方便人工抽查。
- `"required": ["category", "priority", "reason"],` 三个都必填。
- `FORCE_CLASSIFY: dict[str, Any] = {"type": "function", "function": {"name": "classify_ticket"}}` 指定函数的 `tool_choice`。
- `class ChatClient(Protocol):` 只要求有 `chat(messages, **kw)`。
- `def classify(client: ChatClient, text: str) -> dict[str, Any]:` 输入工单文字,输出一个字典。
- `{"role": "system", "content": "你是云簿 CloudLedger 的工单分拣员。"},` system 很短,规则都在 schema 里。
- `r = client.chat(messages, tools=[CLASSIFY_TOOL], tool_choice=FORCE_CLASSIFY, temperature=0, max_tokens=200)` 关键一行:只给一个工具,并且强制调它。
- `if not calls:` 按理不可能,但别的厂商或者思考模式下可能出现(第四步会看到 400,那是另一种失败),防一手。
- `raise ValueError(f"模型没有调用 classify_ticket,finish_reason={r.finish_reason}")` 抛出去让调用方决定重试还是放弃,和 Day 150 的 `ExtractionError` 一个思路。
- `args = json.loads(calls[0]["function"]["arguments"])` 取第一个请求的参数,解析。
- `raise ValueError(f"arguments 不是合法的 JSON:{e.msg}") from e` 被截断的 JSON 走这里。
- `schema = copy.deepcopy(CLASSIFY_TOOL["function"]["parameters"])` 拷一份 schema。
- `schema["additionalProperties"] = False` 多塞的字段不收。
- `problems = [e.message for e in Draft202012Validator(schema).iter_errors(args)]` 一次收集所有问题:枚举外的值、缺字段、类型不对。
- `raise ValueError("参数不合格:" + ";".join(problems))` 不合格就抛。
- `return args` 合格就返回,**到这里结束,没有任何「执行」**。
- `if __name__ == "__main__":` 联网的部分只在直接运行时跑,被测试 import 时不跑,也就不花钱。
- `tickets = [` 四张工单,故意一类一张。
- `print(classify(client, t))` 每张打印分拣结果。

</div>

```bash
uv run python -m part03.extract_by_tool
```

```text
{'category': 'billing', 'priority': 'high', 'reason': '发票金额多收200元,影响报销付款'}
{'category': 'bug', 'priority': 'high', 'reason': '导出功能报500不可用,换浏览器无效,无绕法'}
{'category': 'feature', 'priority': 'low', 'reason': '建议增加季度自动开票，属功能建议不影响现有使用'}
{'category': 'other', 'priority': 'low', 'reason': '咨询公司地址与线下办公室，属一般信息询问'}
4 次调用 | 输入 1730 / 输出 309 tokens | 约 ¥0.0044
```

四张全对,`reason` 还把分档规则复述了一遍(「无绕法」「不影响现有使用」),说明它读了 schema 里的描述。整个过程没有任何函数被执行,`classify_ticket` 连函数都没写。

和 Day 150 的 `extract` 比,这条路的好处是 DeepSeek 原生支持,不用换厂商;缺点是约束仍然是「软」的,模型填了枚举外的值服务端不会拦(DeepSeek 的 strict 模式是 Beta,要换 `/beta` 的 base URL,文末文档链接里有),所以本地校验不能省。校验失败怎么办,Day 150 的办法照搬:把错误喂回去重试。

测试用 Day 160 的 `FakeClient`,不联网:

```python
# agent-zero-lab/tests/test_extract_by_tool.py
import pytest

from part03.extract_by_tool import FORCE_CLASSIFY, classify
from part03.review160_check import FakeClient, call_of

GOOD = '{"category": "billing", "priority": "high", "reason": "发票金额错误影响报销"}'


def reply(args: str) -> dict:
    return {"role": "assistant", "content": "", "tool_calls": [call_of(args, name="classify_ticket", cid="c1")]}


def test_sends_named_tool_choice_and_parses_arguments() -> None:
    fake = FakeClient([reply(GOOD)])
    out = classify(fake, "发票多收了 200")
    assert out == {"category": "billing", "priority": "high", "reason": "发票金额错误影响报销"}
    assert fake.kws[0]["tool_choice"] == FORCE_CLASSIFY
    assert [t["function"]["name"] for t in fake.kws[0]["tools"]] == ["classify_ticket"]


def test_value_outside_enum_is_rejected() -> None:
    fake = FakeClient([reply('{"category": "refund", "priority": "high", "reason": "x"}')])
    with pytest.raises(ValueError, match="参数不合格"):
        classify(fake, "退款")


def test_missing_field_is_rejected() -> None:
    fake = FakeClient([reply('{"category": "bug", "priority": "low"}')])
    with pytest.raises(ValueError, match="reason"):
        classify(fake, "按钮没反应")


def test_no_tool_call_is_rejected() -> None:
    fake = FakeClient([{"role": "assistant", "content": "这是一张账单类工单。"}])
    with pytest.raises(ValueError, match="没有调用"):
        classify(fake, "发票")


def test_truncated_json_is_rejected() -> None:
    fake = FakeClient([reply('{"category": "bug", "prio')])
    with pytest.raises(ValueError, match="不是合法的 JSON"):
        classify(fake, "按钮没反应")
```

<div class="line-notes">

- `from part03.review160_check import FakeClient, call_of` Day 160 的假客户端:按顺序吐预先写好的回复,并把每次收到的 `messages` 和关键字参数记在 `seen`、`kws` 里。
- `GOOD = '{"category": "billing", "priority": "high", "reason": "发票金额错误影响报销"}'` 一份合格的参数。
- `def reply(args: str) -> dict:` 造一条「假模型调了 classify_ticket」的 assistant 消息。
- `assert out == {"category": "billing", "priority": "high", "reason": "发票金额错误影响报销"}` 返回的就是解析后的参数字典。
- `assert fake.kws[0]["tool_choice"] == FORCE_CLASSIFY` **检查我们发出去的请求**:`tool_choice` 必须是指定函数,这是整个办法成立的前提。
- `assert [t["function"]["name"] for t in fake.kws[0]["tools"]] == ["classify_ticket"]` 只发了这一个工具。
- `fake = FakeClient([reply('{"category": "refund", "priority": "high", "reason": "x"}')])` `refund` 不在枚举里。
- `with pytest.raises(ValueError, match="参数不合格"):` 必须抛 `ValueError`,消息里带「参数不合格」。
- `fake = FakeClient([reply('{"category": "bug", "priority": "low"}')])` 缺 `reason`。
- `with pytest.raises(ValueError, match="reason"):` 错误消息里要点出缺的是哪个字段。
- `fake = FakeClient([{"role": "assistant", "content": "这是一张账单类工单。"}])` 假模型没调工具,直接用文字回答。
- `fake = FakeClient([reply('{"category": "bug", "prio')])` 被截断的 JSON,Day 158 第六步见过。

</div>

```bash
uv run pytest -q tests/test_extract_by_tool.py
```

```text
.....                                                                    [100%]
5 passed in 0.11s
```

## 第四步:思考模式的两个坑

到现在为止,`.env` 里的 `LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}` 一直把思考关着。[Day 115](/blog/agent-zero/day-115-reasoning-models/) 学过,DeepSeek 默认是开的,回答前先输出一段 `reasoning_content`。打开它再跑今天的东西,会撞上两件事。DeepSeek 文档(2026 年 10 月查)写了:一,`required` 和指定函数在思考模式下不支持,返回 400;二,带 `tools` 的请求里,之前各轮的 `reasoning_content` 必须原样回传,否则 400。新建 `part03/thinking_trap.py` 验证:

```python
# agent-zero-lab/part03/thinking_trap.py
"""开着思考模式时,tool_choice 和 reasoning_content 的两个 400。"""
from typing import Any

from openai import BadRequestError

from common.llm import LLMClient
from part03.tool_runner import execute_call
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]
THINK: dict[str, Any] = {"thinking": {"type": "enabled"}}  # 覆盖 .env 里的 disabled
NAMED: dict[str, Any] = {"type": "function", "function": {"name": "get_weather"}}
client = LLMClient(max_retries=0)


def ask(choice: Any, **kw: Any) -> None:
    msgs: list[dict[str, Any]] = [
        {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
        {"role": "user", "content": "北京现在多少度?"},
    ]
    try:
        r = client.chat(msgs, tools=TOOLS, tool_choice=choice, max_tokens=500, **kw)
    except BadRequestError as e:
        print(f"  tool_choice={choice!s:60} -> 400:{e.body['message'] if isinstance(e.body, dict) else e.body}")
        return
    calls = r.message.get("tool_calls") or []
    print(f"  tool_choice={choice!s:60} -> {r.finish_reason},请求 {len(calls)} 个,思考 {len(r.reasoning or '')} 字")


print("思考模式开着:")
for choice in ["auto", "none", "required", NAMED]:
    ask(choice, extra_body=THINK)
print("思考模式关着(.env 里的默认):")
for choice in ["required", NAMED]:
    ask(choice)

print("\n第二坑:带 tools 时 reasoning_content 必须原样回传")
msgs: list[dict[str, Any]] = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
    {"role": "user", "content": "北京现在多少度?"},
]
first = client.chat(msgs, tools=TOOLS, max_tokens=500, extra_body=THINK)
print("  assistant 消息的字段:", list(first.message))
call = first.message["tool_calls"][0]
tool_msg = {"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS)}

stripped = {k: v for k, v in first.message.items() if k != "reasoning_content"}
for label, assistant in [("原样回传", first.message), ("去掉 reasoning_content", stripped)]:
    try:
        second = client.chat([*msgs, assistant, tool_msg], tools=TOOLS, max_tokens=500, extra_body=THINK)
        print(f"  {label:22} -> 200,回答:{second.content[:30]!r}")
    except BadRequestError as e:
        print(f"  {label:22} -> 400:{e.body['message'] if isinstance(e.body, dict) else e.body}")
print(client.ledger)
```

<div class="line-notes">

- `from openai import BadRequestError` 400 对应的异常类,[Day 126](/blog/agent-zero/day-126-errors-1/) 的异常树里的一员。
- `THINK: dict[str, Any] = {"thinking": {"type": "enabled"}}  # 覆盖 .env 里的 disabled` 开思考的请求体。`LLMClient._kwargs` 会把你传的 `extra_body` 和 `.env` 里的合并,后传的覆盖前面的,所以这一份能把 `disabled` 盖成 `enabled`。
- `def ask(choice: Any, **kw: Any) -> None:` 问一次「北京现在多少度」,`choice` 是 `tool_choice`,`kw` 是额外参数(有没有 `extra_body=THINK`)。
- `r = client.chat(msgs, tools=TOOLS, tool_choice=choice, max_tokens=500, **kw)` 思考要占输出 token,`max_tokens` 放宽到 500。没传 `temperature`,因为文档说思考模式下它没有效果。
- `except BadRequestError as e:` 400 进这里。
- `print(f"  tool_choice={choice!s:60} -> 400:{e.body['message'] if isinstance(e.body, dict) else e.body}")` `e.body` 是服务端返回的 JSON,取里面的 `message`。`{choice!s:60}` 先转成字符串再左对齐占 60 位。
- `print(f"  tool_choice={choice!s:60} -> {r.finish_reason},请求 {len(calls)} 个,思考 {len(r.reasoning or '')} 字")` 成功时看结束原因、请求数、思考了多少字。`r.reasoning` 是 `ChatResult` 里 `reasoning_content` 的快捷方式。
- `for choice in ["auto", "none", "required", NAMED]:` 思考开着,四种都试。
- `ask(choice, extra_body=THINK)` 带上 `THINK`。
- `for choice in ["required", NAMED]:` 对照:思考关着再试两种会 400 的。
- `ask(choice)` 不传 `extra_body`,用 `.env` 的 `disabled`。
- `first = client.chat(msgs, tools=TOOLS, max_tokens=500, extra_body=THINK)` 第二坑:思考开着提一个天气请求。
- `print("  assistant 消息的字段:", list(first.message))` 看 `LLMClient` 给我们的 assistant 消息里有哪些 key。
- `call = first.message["tool_calls"][0]` 这一次 `auto` 肯定会调(第一步验证过),直接取。
- `tool_msg = {"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS)}` 执行,造 tool 消息。
- `stripped = {k: v for k, v in first.message.items() if k != "reasoning_content"}` 故意造一份**去掉** `reasoning_content` 的 assistant 消息。
- `for label, assistant in [("原样回传", first.message), ("去掉 reasoning_content", stripped)]:` 两份各发一次第二次请求。
- `second = client.chat([*msgs, assistant, tool_msg], tools=TOOLS, max_tokens=500, extra_body=THINK)` 带 `tools`、开思考,按文档这是必须回传的场景。
- `print(f"  {label:22} -> 200,回答:{second.content[:30]!r}")` 成功就打印回答开头。

</div>

```bash
uv run python -m part03.thinking_trap
```

```text
思考模式开着:
  tool_choice=auto                                                         -> tool_calls,请求 1 个,思考 0 字
  tool_choice=none                                                         -> stop,请求 0 个,思考 63 字
  tool_choice=required                                                     -> 400:Thinking mode does not support this tool_choice (request_id: bc9549bb-9dd4-499f-9a0a-704e75ddf4c8)
  tool_choice={'type': 'function', 'function': {'name': 'get_weather'}}    -> 400:Thinking mode does not support this tool_choice (request_id: b7d6ac2e-f1c0-4b3e-96ba-8f182477cd91)
思考模式关着(.env 里的默认):
  tool_choice=required                                                     -> tool_calls,请求 1 个,思考 0 字
  tool_choice={'type': 'function', 'function': {'name': 'get_weather'}}    -> tool_calls,请求 1 个,思考 0 字

第二坑:带 tools 时 reasoning_content 必须原样回传
  assistant 消息的字段: ['content', 'role', 'tool_calls', 'reasoning_content']
  原样回传                   -> 200,回答:'北京现在 **15.5°C**，天气晴，风速约 10 km/'
  去掉 reasoning_content   -> 200,回答:'北京现在 **15.5°C**，晴，风速约 10 km/h。'
7 次调用 | 输入 2663 / 输出 284 tokens | 约 ¥0.0051
```

第一坑完全按文档:思考开着,`required` 和指定函数都是 400,报错原文 **`Thinking mode does not support this tool_choice`**。关掉思考同样的两种就正常。所以第三步的 `classify` 在思考模式下根本跑不起来,会抛 `BadRequestError`;要分拣就得关思考(今天的 `.env` 就是关的),或者退回 `auto` 加提示词「必须调用」,练习 3 会比较这两条路的花费。另外两行也值得看一眼:`auto` 调工具时思考了 0 字,`none` 不许调时倒思考了 63 字,它在想怎么用嘴回答。

第二坑**和文档对不上**。`LLMClient` 给的 assistant 消息里确实有 `reasoning_content`(四个字段里的最后一个),原样回传当然 200;可是我故意去掉它再发,也是 200,回答照样正确。我又换了一个要思考更久的问题试(脚本没放进文章),模型在提请求前思考了 485 个字,去掉再发,还是 200。文档说「会返回 400」,2026 年 10 月在 `deepseek-flash` 上我没有触发它。

这种时候怎么办?**按文档做,不按实测偷懒。**理由有三。第一,服务端的宽容是今天的行为,明天升级就可能变严,而文档是厂商承诺的接口。第二,回传思考内容对效果有好处:模型上一轮想好的计划(「先查天气再判断穿什么」)不丢。第三,做对不花力气:`LLMClient.chat` 用 `model_dump(exclude_none=True)` 把 `reasoning_content` 留在了 `message` 里,你只要一直 `messages.append(r.message)`,就什么都不用改。Day 162 的 `parallel_min.py`、Day 160 的 `invoice_bot.py` 都是这么写的。真正会丢的写法是自己手工拼 `{"role": "assistant", "content": ..., "tool_calls": ...}`,Day 159 的 `check_messages` 不检查这个字段,所以手工拼的时候要自己记得。

把今天的组合整理成一张表:

| 思考 | `tool_choice` | 结果 |
| --- | --- | --- |
| 关 | 四种 | 都正常;`required`/指定会硬造参数 |
| 开 | `auto` / `none` | 正常;`none` 下会思考 |
| 开 | `required` / 指定函数 | 400 `Thinking mode does not support this tool_choice` |
| 开 + 带 `tools` | 多轮回传 | 文档要求带 `reasoning_content`;实测去掉也 200,仍按文档带 |

### 零件对照

| 概念 | 今天的文件 | 以后哪天用 |
| --- | --- | --- |
| 四种 `tool_choice` | `tool_choice_demo.py` | [Day 166](/blog/agent-zero/day-166-agent-min/) 循环里每一圈的请求参数 |
| `none` 收尾 + 漏出的标记 | `tool_choice_none.py`、练习 2 `leaked_call.py` | [Day 165](/blog/agent-zero/day-165-agent-what/) 练习里「转满步数怎么收尾」 |
| 指定函数当结构化输出 | `extract_by_tool.py` | 第四部分以后所有「分类、抽取」类任务 |
| 思考模式的限制 | `thinking_trap.py` | Day 170 完整 Agent 里决定思考开不开 |

## 动手练习

三道题。练习 1 和 3 联网(各几分钱),练习 2 不联网。

**练习 1:required 遇到无关的话会填什么?** 对五句和天气无关的话用 `tool_choice="required"`,把模型填进 `city` 的值打出来。想一想:这些值从哪来的?如果工具描述里没有「例如 北京」这个例子,它会填什么?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex163_required_chat.py
"""练习 1:对五句和天气无关的话用 required,看模型往 city 里填了什么。"""
import json

from common.llm import LLMClient
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]
client = LLMClient(max_retries=0)
questions = ["你好,你是谁?", "帮我写一首关于秋天的诗", "1 加 1 等于几?", "我的发票 INV-2026-0043 付了没?", "随便聊聊吧"]
for q in questions:
    msgs = [{"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"}, {"role": "user", "content": q}]
    r = client.chat(msgs, tools=TOOLS, tool_choice="required", temperature=0, max_tokens=200)
    calls = r.message.get("tool_calls") or []
    print(f"{q:22} -> {len(calls)} 个请求,参数 {[json.loads(c['function']['arguments']) for c in calls]}")
print(client.ledger)
```

<div class="line-notes">

- `questions = ["你好,你是谁?", "帮我写一首关于秋天的诗", "1 加 1 等于几?", "我的发票 INV-2026-0043 付了没?", "随便聊聊吧"]` 五句话,没有一句提到城市或天气;第四句甚至是另一个工具的活。
- `r = client.chat(msgs, tools=TOOLS, tool_choice="required", temperature=0, max_tokens=200)` 强制至少调一个工具,而工具只有 `get_weather`。
- `print(f"{q:22} -> {len(calls)} 个请求,参数 {[json.loads(c['function']['arguments']) for c in calls]}")` 把参数解析成字典打印。

</div>

```bash
uv run python -m part03.ex163_required_chat
```

```text
你好,你是谁?                -> 1 个请求,参数 [{'city': '北京', 'unit': 'celsius'}]
帮我写一首关于秋天的诗            -> 1 个请求,参数 [{'city': '北京'}]
1 加 1 等于几?             -> 1 个请求,参数 [{'city': '北京'}]
我的发票 INV-2026-0043 付了没? -> 1 个请求,参数 [{'city': '北京'}]
随便聊聊吧                  -> 1 个请求,参数 [{'city': '北京'}]
5 次调用 | 输入 1966 / 输出 182 tokens | 约 ¥0.0039
```

五句全是「北京」,第一句还顺手补了 `unit: celsius`(描述里说「用户没有特别说明就用 celsius」)。来源就是 Day 157 描述里的例子「例如 北京、Shanghai」。我没有做「删掉例子」的对照(那要改 Day 157 的文件),但 Day 157 的实验已经说明模型会抄例子,可以推测删掉以后它会找别的锚点,比如 system 里的公司名,或者干脆编一个。结论不变:`required` 只保证「调」,参数是否有依据要靠你在调用前判断这一步该不该强制。

</details>

**练习 2:认出漏出来的调用。** 写 `looks_like_leaked_call(text)`,判断一段 `content` 是不是第二步那种 DSML 标记;再写 `final_answer(client, messages, tools)`,用 `none` 要一个收尾的回答,漏出标记就换成一句人话。用 Day 160 的 `FakeClient` 写五个测试,不联网。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/leaked_call.py
"""练习 2:模型把「想调工具」写成了文字(DSML 标记)漏进 content,把它认出来。不联网。"""
import re
from typing import Any

# 实测漏出来的长相:<｜｜DSML｜｜ calls> … </｜｜DSML｜｜ calls>,中间是 invoke / parameter
# DeepSeek 官方仓库写的标准形态是 <｜DSML｜tool_calls>(Day 164 会看到),两种都认
LEAK = re.compile(r"<｜+DSML｜+\s*(?:tool_)?calls>")


def looks_like_leaked_call(text: str) -> bool:
    """content 里出现了工具调用标记,说明模型想调工具但这一轮没被允许。"""
    return bool(LEAK.search(text or ""))


def final_answer(client: Any, messages: list[dict[str, Any]], tools: list[dict[str, Any]], **kw: Any) -> str:
    """用 none 要一个「只许总结」的回答;漏出标记就换成一句人话,绝不把标记发给用户。"""
    r = client.chat(messages, tools=tools, tool_choice="none", **kw)
    if looks_like_leaked_call(r.content):
        return "这一步还需要查询才能回答,但这一轮已经不允许再查了。请换个问法,或者稍后再问。"
    return r.content
```

<div class="line-notes">

- `import re` 正则,[Day 17](/blog/agent-zero/day-017-strings-2/) 学过。
- `LEAK = re.compile(r"<｜+DSML｜+\s*(?:tool_)?calls>")` 只认开头那个标记:`<`、一个或多个全角竖线 `｜`、`DSML`、一个或多个 `｜`、可有可无的空白、可有可无的 `tool_`、`calls>`。实测漏出来的是两根竖线、一个空格、`calls`;而 DeepSeek 官方仓库里写的标准形态是一根竖线、`tool_calls`(明天 Day 164 会看到)。我不知道两者为什么不一样,也不敢保证以后一直是哪种,所以 `+`、`\s*`、`(?:tool_)?` 都放宽。
- `return bool(LEAK.search(text or ""))` `text` 可能是 `None`,`or ""` 兜一下;找到就是 `True`。
- `def final_answer(client: Any, messages: list[dict[str, Any]], tools: list[dict[str, Any]], **kw: Any) -> str:` 收尾函数:`tools` 照 Day 159 的习惯还是带着,`kw` 透传 `max_tokens` 之类。
- `r = client.chat(messages, tools=tools, tool_choice="none", **kw)` 这一轮不许执行。
- `if looks_like_leaked_call(r.content):` 检查回答。
- `return "这一步还需要查询才能回答,但这一轮已经不允许再查了。请换个问法,或者稍后再问。"` 一句诚实的人话,比标记强。更好的做法是把「不许再查」提前告诉模型,Day 165 练习 3 会做。
- `return r.content` 正常就原样返回。

</div>

```python
# agent-zero-lab/tests/test_leaked_call.py
from part03.leaked_call import final_answer, looks_like_leaked_call
from part03.review160_check import FakeClient

LEAKED = (
    '<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="get_weather">\n'
    '<｜｜DSML｜｜ parameter name="city" string="true">上海</｜｜DSML｜｜ parameter>\n'
    "</｜｜DSML｜｜ invoke>\n</｜｜DSML｜｜ calls>"
)


def test_detects_the_markup_we_saw() -> None:
    assert looks_like_leaked_call(LEAKED)


def test_single_bar_variant_and_leading_text() -> None:
    assert looks_like_leaked_call('我来查一下。<｜DSML｜calls><｜DSML｜invoke name="x"></｜DSML｜invoke></｜DSML｜calls>')


def test_official_form_with_tool_prefix() -> None:
    assert looks_like_leaked_call('<｜DSML｜tool_calls>\n<｜DSML｜invoke name="get_weather">')


def test_plain_text_and_empty_are_fine() -> None:
    assert not looks_like_leaked_call("上海 19.7°C,广州 28.9°C。")
    assert not looks_like_leaked_call("")
    assert not looks_like_leaked_call("DSML 是 DeepSeek 的标记语言")  # 只提到名字,没有标记


def test_final_answer_replaces_leak_and_sends_none() -> None:
    fake = FakeClient([{"role": "assistant", "content": LEAKED}])
    out = final_answer(fake, [{"role": "user", "content": "那上海呢?"}], tools=[], max_tokens=50)
    assert out.startswith("这一步还需要查询")
    assert fake.kws[0]["tool_choice"] == "none"
    assert fake.kws[0]["max_tokens"] == 50


def test_final_answer_passes_normal_text_through() -> None:
    fake = FakeClient([{"role": "assistant", "content": "上海 19.7°C。"}])
    assert final_answer(fake, [], tools=[]) == "上海 19.7°C。"
```

<div class="line-notes">

- `LEAKED = (` 从第二步的真实输出里抄下来的一段,只留一个城市。
- `assert looks_like_leaked_call(LEAKED)` 实测的长相必须认出来。
- `assert looks_like_leaked_call('我来查一下。<｜DSML｜calls><｜DSML｜invoke name="x"></｜DSML｜invoke></｜DSML｜calls>')` 单竖线、没有空格、前面还有一句正常的话,也要认出来。
- `assert looks_like_leaked_call('<｜DSML｜tool_calls>\n<｜DSML｜invoke name="get_weather">')` 官方仓库文档里的标准形态(带 `tool_`)也要认出来。
- `assert not looks_like_leaked_call("DSML 是 DeepSeek 的标记语言")  # 只提到名字,没有标记` 正文里提到 DSML 这个词不算,不能误伤。
- `fake = FakeClient([{"role": "assistant", "content": LEAKED}])` 假模型漏了标记。
- `assert out.startswith("这一步还需要查询")` 用户看到的是人话。
- `assert fake.kws[0]["tool_choice"] == "none"` 发出去的请求确实是 `none`。
- `assert fake.kws[0]["max_tokens"] == 50` 额外参数透传了。
- `assert final_answer(fake, [], tools=[]) == "上海 19.7°C。"` 正常回答原样放行。

</div>

```bash
uv run pytest -q tests/test_leaked_call.py
```

```text
......                                                                   [100%]
6 passed in 0.05s
```

</details>

**练习 3:思考模式下不能强制,那分拣怎么办?** 思考开着时第三步的 `classify` 会 400。写一个 `classify_auto`:`tool_choice` 用默认的 `auto`,在 system 里写「每一张工单都必须调用 classify_ticket」。同一批四张工单,思考关和开各跑一遍,看模型听不听话、花费差多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex163_thinking_cost.py
"""练习 3:同一批工单,思考模式开/关各分拣一遍,比 token、花费和用时。"""
from typing import Any

from common.llm import LLMClient
from part03.extract_by_tool import CLASSIFY_TOOL

TICKETS = [
    "发票 INV-2026-0043 的金额不对,多收了我们 200 块,这个月要报销,请尽快处理",
    "导出报表的按钮点了没反应,控制台里是 500,换浏览器也一样",
    "希望能支持按季度自动开票,现在每个月手动点太麻烦了",
    "你们公司在哪个城市?有没有线下办公室?",
]


def classify_auto(client: LLMClient, text: str, **kw: Any) -> str:
    """思考模式下不能强制,只能 auto:描述里写明「必须调用」,看它听不听。"""
    messages = [
        {"role": "system", "content": "你是云簿 CloudLedger 的工单分拣员。每一张工单都必须调用 classify_ticket 打标签,不要直接回答。"},
        {"role": "user", "content": f"工单内容:{text}"},
    ]
    r = client.chat(messages, tools=[CLASSIFY_TOOL], temperature=0, max_tokens=800, **kw)
    calls = r.message.get("tool_calls") or []
    return calls[0]["function"]["arguments"] if calls else f"(没调工具:{r.content[:30]!r})"


for label, kw in [("思考关", {}), ("思考开", {"extra_body": {"thinking": {"type": "enabled"}}})]:
    client = LLMClient(max_retries=0)
    for t in TICKETS:
        out = classify_auto(client, t, **kw)
        print(f"  {label} {out[:70]}")
    print(f"{label}:{client.ledger}\n")
```

<div class="line-notes">

- `from part03.extract_by_tool import CLASSIFY_TOOL` 复用第三步的工具定义,`FORCE_CLASSIFY` 不能用了。
- `def classify_auto(client: LLMClient, text: str, **kw: Any) -> str:` 和 `classify` 的区别只在 `tool_choice`。为了看清楚,这里不做校验,直接返回参数字符串。
- `{"role": "system", "content": "你是云簿 CloudLedger 的工单分拣员。每一张工单都必须调用 classify_ticket 打标签,不要直接回答。"},` 强制的要求搬进了提示词。
- `r = client.chat(messages, tools=[CLASSIFY_TOOL], temperature=0, max_tokens=800, **kw)` 没有 `tool_choice`,默认 `auto`;思考要地方,`max_tokens` 给 800。
- `return calls[0]["function"]["arguments"] if calls else f"(没调工具:{r.content[:30]!r})"` 调了就返回参数,没调就把它的回答打出来。
- `for label, kw in [("思考关", {}), ("思考开", {"extra_body": {"thinking": {"type": "enabled"}}})]:` 两种配置。
- `client = LLMClient(max_retries=0)` 每种一个新客户端,账本分开。
- `print(f"{label}:{client.ledger}\n")` 各自的四次合计。

</div>

```bash
uv run python -m part03.ex163_thinking_cost
```

```text
  思考关 {"category": "billing", "priority": "high", "reason": "发票金额多收200元,影响报销
  思考关 {"category": "bug", "priority": "high", "reason": "导出功能500报错,换浏览器仍复现,功
  思考关 {"category": "feature", "priority": "low", "reason": "建议增加季度自动开票,属功能建议
  思考关 {"category": "other", "priority": "low", "reason": "咨询公司地址与线下办公室,属一般信息
思考关:4 次调用 | 输入 1778 / 输出 330 tokens | 约 ¥0.0047

  思考开 {"category": "billing", "priority": "high", "reason": "发票多收200元，影响本月报销
  思考开 {"category": "bug", "priority": "high", "reason": "导出报表接口 500,功能完全不可用且
  思考开 {"category": "feature", "priority": "low", "reason": "建议增加季度自动开票,属新功能
  思考开 {"category": "other", "priority": "low", "reason": "咨询公司所在城市与线下办公室,属一般
思考开:4 次调用 | 输入 1878 / 输出 679 tokens | 约 ¥0.0077
```

两种都八张全对,提示词里的「必须调用」在这个任务上管用了。花费差在输出 token:思考开着 679 对 330,多出来的 349 个 token 是四次思考,总价 ¥0.0077 对 ¥0.0047,贵了六成多。分拣这种有明确 schema 的任务,思考没有带来可见的收益,我会关掉。但要记住两点:`auto` 加提示词是「请求」,不是「保证」,模型有不调的自由,所以 `classify_auto` 的调用方要处理「没调工具」这个分支;而真正需要推理的任务(比如要先查两张发票再判断该不该退款)另说。

</details>

**验收标准:** 能不看文章说出四种 `tool_choice` 各自的 `finish_reason` 和 `tool_calls`;能解释「`none` 之后 `content` 里为什么会出现 `<｜DSML｜>` 标记」以及为什么不带 `tools` 也一样;能默写 `classify` 的三步(强制调用、解析参数、本地校验)并说出它和 Day 150 `extract` 的取舍;能说出思考模式下哪两种 `tool_choice` 会 400、报错原文是什么,以及 `reasoning_content` 为什么要原样回传;`tests/test_extract_by_tool.py`(5 个)和 `tests/test_leaked_call.py`(6 个)全部通过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| `tool_choice` | 请求参数,你发给模型的,规定这一轮能不能、必须不必须用工具。和响应里的 `tool_calls` 方向相反 |
| `auto` | 默认值(带了 `tools` 时):模型自己决定调不调 |
| `none` | 这一轮不许调工具,服务端不解析工具调用,`tool_calls` 一定为空。模型仍可能把调用写成文字 |
| `required` | 必须至少调一个工具。没有合理参数时模型会硬造一个 |
| 指定函数 | `{"type": "function", "function": {"name": "x"}}`,必须调 `x`。可以把工具当结构化输出用 |
| DSML | DeepSeek 这一代模型写工具调用用的标记语言,`<｜DSML｜>` 开头。服务端正常会把它解析成 `tool_calls`,`none` 或不带 `tools` 时不解析,就漏进 `content` |
| 漏出的调用(leaked call) | 本应被解析成 `tool_calls` 的标记文本出现在了 `content` 里。本课自己起的名字 |
| 结构化输出(用工具实现) | 定义一个只为了它的 `parameters` 而存在的工具,强制调用,只读 `arguments`、从不执行 |
| 思考模式(thinking) | Day 115 学的:模型回答前先输出 `reasoning_content`。DeepSeek 默认开,`.env` 里用 `{"thinking": {"type": "disabled"}}` 关 |
| `reasoning_content` | 思考模式下 assistant 消息里的思维链字段。带 `tools` 的多轮里文档要求原样回传 |
| strict 模式 | DeepSeek 的 Beta 功能,服务端强制参数符合 schema,要换 `/beta` 的 base URL。今天没用 |

## 常见误区

**把 `tool_choice` 和 `tool_calls` 搞混。** 一个是你发的请求参数,一个是模型回的响应字段。写 `r.message["tool_choice"]` 是取不到任何东西的。

**以为 `required` 等于「模型判断需要调」。** 它是「不管需不需要都得调」。「你好,你是谁」也会得到一个 `{"city": "北京"}`。用它之前你自己得先判断这一步该不该强制。

**以为 `none` 就万事大吉。** 服务端确实不给 `tool_calls`,但模型可能把调用写成 `<｜DSML｜>` 标记塞进 `content`,实测六次全漏。`none` 之后要检查回答,别原样发给用户。

**以为不带 `tools` 就是关掉了工具。** 不带 `tools` 关掉的是服务端的解析,模型照样会按历史里的习惯写出调用标记。整个对话每次请求都带同一份 `tools`(Day 159 的习惯),这一轮不想执行就用 `none` 加检查。

**思考开着还用 `required` 或指定函数。** 直接 400 `Thinking mode does not support this tool_choice`。要强制就关思考,或者退回 `auto` 加提示词并处理「没调」的分支。

**手工拼 assistant 消息时丢了 `reasoning_content`。** 文档要求带 `tools` 时原样回传。实测 2026 年 10 月去掉也不报错,但按文档做:用 `LLMClient` 给的 `r.message` 整条放回,别自己挑字段。

**把指定函数拿到的参数当成已经校验过的。** 服务端不拦枚举外的值(strict 是 Beta),`classify` 里那段 `Draft202012Validator` 不能省。

**在思考模式下传 `temperature=0` 以为能稳定输出。** 文档写了思考模式下 `temperature` 没有效果,不报错也不生效,又一个静默忽略。

## 学习资料

### 文档与文章

- [DeepSeek 接口文档:对话补全(中文)](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion):找 `tool_choice` 那一项,四种取值的原话和「思考模式不支持 required 和指定函数,返回 400」那一句都在这里。`finish_reason` 的全部取值也在响应说明里,Day 165 会用到。
- [DeepSeek 文档:思考模式(中文)](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode):`thinking` 参数怎么开关、哪些采样参数在思考模式下无效、带 `tools` 时 `reasoning_content` 的回传要求。
- [DeepSeek 文档:Tool Calls(中文)](https://api-docs.deepseek.com/zh-cn/guides/tool_calls):strict 模式(Beta)怎么开、支持哪些 JSON Schema 关键字。
- [OpenAI 文档:Function calling](https://developers.openai.com/api/docs/guides/function-calling):英文,找「Tool choice」一节,四种取值的定义和 OpenAI 自己的说法,和 DeepSeek 对照着读。
- [Anthropic 文档:Implement tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use):英文,找「Forcing tool use」,Anthropic 把 `required` 叫 `any`,明天会细讲。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1G3ERzuEpe&autoplay=0&high_quality=1" title="3.Function Calling并行调用与强制调用" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>码农野蛮生长 · 3.Function Calling并行调用与强制调用 · 10 分 59 秒,2025 年 5 月。Day 162 推荐过,今天看后半段「强制调用」,对照第一步的四种取值。我只核对了标题和时长,没有逐帧看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12rDYBcErz&autoplay=0&high_quality=1" title="面试官:如何保证 Agent 调用工具 (Function Calling) 的 可靠性?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵AI大模型 · 面试官:如何保证 Agent 调用工具 (Function Calling) 的可靠性? · 3 分 48 秒,2026 年 4 月。Day 157 推荐过的面试口径短视频。今天看完 `required` 硬造参数的实验,再听它讲「可靠性」,想想它有没有讲到「强制调用不等于参数可靠」这一条。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/N880XH-0W3Q" title="Function Calling vs Structured Outputs (OpenAI API) Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ARE AGI · Function Calling vs Structured Outputs (OpenAI API) Explained · 英文。讲 function calling 和结构化输出什么时候该用哪个,对照今天第三步「把工具当结构化输出用」。按标题选的,我没有逐帧看。</figcaption>
</figure>

### 书籍

今天这组不需要。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):我们用的 SDK。在仓库里搜 `tool_choice`,能看到它的类型定义(`ChatCompletionToolChoiceOptionParam`),四种取值的形状和今天一致。

## 自测

1. `tool_choice` 和 `tool_calls` 各在请求还是响应里?各是什么意思?

<details><summary>答案</summary>

`tool_choice` 在请求里,是你发给模型的参数,规定这一轮能不能、必须不必须用工具(`auto`、`none`、`required`、指定函数)。`tool_calls` 在响应的 `message` 里,是模型实际要调的工具和参数。一个是规定,一个是结果。

</details>

2. 用 `required` 问「你好,你是谁?」会发生什么?为什么?

<details><summary>答案</summary>

模型仍然会提一个 `get_weather` 请求,参数是 `{"city": "北京"}`。因为 `required` 规定它必须调,而它没有城市可查,只好从工具描述里的例子「例如 北京、Shanghai」抄一个。`required` 保证「一定调」,不保证参数有依据。

</details>

3. `tool_choice="none"` 时 `tool_calls` 一定是空的,那为什么还要检查 `content`?

<details><summary>答案</summary>

因为 `none` 只是让服务端不解析工具调用,模型本身可能仍然想调,于是把调用写成 DSML 标记文本(`<｜DSML｜> calls` …)放进 `content`。实测在「刚成功查过一次、用户追问」的场景下六次全漏。不带 `tools` 也一样。所以 `none` 之后要检测这种标记,换成人话再给用户。

</details>

4. 思考模式开着的时候,哪些 `tool_choice` 会 400?报错原文是什么?

<details><summary>答案</summary>

`required` 和指定函数两种,报错是 `Thinking mode does not support this tool_choice`。`auto` 和 `none` 正常。要强制调用就关思考,或者退回 `auto` 加提示词并处理「没调」的分支。

</details>

5. 面试题:「DeepSeek 不支持 `json_schema`,你怎么在它上面做稳定的结构化抽取?」

<details><summary>答案</summary>

定义一个只为了它的 `parameters` 而存在的工具(比如 `classify_ticket`),`tool_choice` 指定它,强制模型调用,然后只读 `arguments`、从不执行。schema 里用 `enum` 和 `required` 钉死取值和必填,本地再用 jsonschema 校验一遍(服务端不拦枚举外的值,strict 是 Beta),校验失败把错误喂回去重试。注意思考模式下指定函数会 400,这条路要关思考。另一条路是换支持 `json_schema` 的厂商(Day 150 用硅基流动)。

</details>

6. 面试题:「带工具的多轮对话里,DeepSeek 的 `reasoning_content` 要不要回传?你怎么保证不丢?」

<details><summary>答案</summary>

文档要求带 `tools` 时之前各轮的 `reasoning_content` 原样回传,否则 400;实测 2026 年 10 月去掉也没报错,但按文档做,一来服务端可能变严,二来回传能保住模型上一轮的计划。保证不丢的办法是别手工拼 assistant 消息:`LLMClient.chat` 用 `model_dump(exclude_none=True)` 把这个字段留在 `r.message` 里,每一圈直接 `messages.append(r.message)` 就行。

</details>

## 明天预告

Day 164 · Anthropic 的写法,以及模型怎么学会调工具。今天 `none` 漏出来的那段 `<｜DSML｜>` 标记,其实就是模型「真正」输出的东西,`tool_calls` 那个整齐的 JSON 是服务端替你解析过的。明天先把另一家的格式(Anthropic 的 `tool_use` / `tool_result` 内容块)和 OpenAI 兼容格式放在一起对照,写一个两边互转的小函数,再用 Anthropic 官方 SDK 对着 DeepSeek 的兼容端点真跑一次;然后用分词器自带的对话模板把一段带工具调用的对话渲染成模型看到的纯文本,数一数那些特殊 token,讲清楚模型是怎么被训练成「会写这段文字」的。

实跑花费:`tool_choice_demo` ¥0.0039 + `tool_choice_none` ¥0.0039 + `extract_by_tool` ¥0.0044 + `thinking_trap` ¥0.0051 + 练习 1 ¥0.0039 + 练习 3 ¥0.0047 和 ¥0.0077,合计约 ¥0.034;加上写文章时反复试 `none` 和思考模式的几次探路,总共约 ¥0.06。价格按 `.env` 里 `LLM_PRICE=0.04,2,8`(缓存命中 / 未命中 / 输出,元每百万 token)算,和 DeepSeek 定价页 2026 年 10 月的 `deepseek-flash` 峰时价(每百万输入 $0.3、输出 $1.2)基本一致。
