---
title: 'Day 157 · 工具定义:写给模型看的 JSON Schema'
description: '昨天为了看原始响应,照抄了一份能用的工具定义。今天认真写:name、description、parameters 三块各自管什么。用 60 次真实调用量出来:两个工具名字看不出区别时,描述写含糊选对率 3/12,写清楚 12/12,名字和描述互相打架时模型听描述的;参数上 enum 能管住词汇,example 会被原样抄走,「做不到就别调」要写进描述;最后用 jsonschema 在本地二次检查,并用 pydantic 生成同一份 schema。'
pubDate: 2026-10-23
regime: none
tags: ['function-calling', 'json-schema', 'tool-use', 'agent-zero']
series: 'agent-zero'
day: 157
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 156](/blog/agent-zero/day-156-fc-idea/) 拆掉了一个误会:模型不执行任何函数,它只写出「请调用 get_weather,city 是北京」这样一段请求,执行的是你的程序;一次工具调用是两次模型请求,中间夹着你的一段代码。我们还看了官方 `tools` 参数返回的原始响应,`finish_reason` 是 `tool_calls`,`arguments` 是字符串,并且参数是不可信的输入,要自己校验。

昨天那份工具定义是照抄的,只管能跑。但你应该已经注意到,整份定义里每个字都是写给模型看的:它靠这些字决定要不要调、调哪个、参数怎么填。今天就把这一份东西认真写一遍,并且量一量「写得好」和「写得差」到底差多少。

## 今天要解决的问题

学完今天你应该能做到:

1. 说出一份工具定义的三块内容 `name`、`description`、`parameters` 各自影响模型的哪个决定,并能读懂别人写的定义。
2. 用实验确认:当两个工具名字区分不开的时候,模型选哪个几乎完全看 `description`;写出一份能让模型选对的描述。
3. 用 `parameters` 里的 `description`、`enum`、`required` 管住模型填的参数,说清楚这些东西**管得住什么、管不住什么**,并用 `jsonschema` 在本地对参数做第二道检查。

今天有两个新概念:**描述决定选择**(模型靠 `name` 和 `description` 选工具)和**参数的约束**(`parameters` 怎么限制它填的值)。JSON Schema 本身是 [Day 95](/blog/agent-zero/day-095-json-schema/) 和 [Day 148](/blog/agent-zero/day-148-structured-2/) 学过的,今天不重讲关键字,只讲它放在工具定义里是干什么的。

预计用时:2.5 小时,实跑花费约 ¥0.22(各脚本的账单在文中,一共两百次左右的调用)。前置:[Day 156](/blog/agent-zero/day-156-fc-idea/)(工具调用的本质、`tools` 参数)、[Day 148](/blog/agent-zero/day-148-structured-2/)(JSON Schema 和 `jsonschema` 库)、[Day 149](/blog/agent-zero/day-149-structured-3/)(pydantic 生成 schema)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)(`LLMClient`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `weather_tool.py` 里那份工具定义和 `check_args.py` 的核心函数;再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

今天所有实验用的工具都是「只描述、不执行」:模型返回要调哪个、参数是什么,我们只打印,没有任何一个函数真的被调用。真正接上函数是明天的事。

## 模型到底看到了什么

先回答一个问题:你写的那个字典,模型是怎么「读」到的?

模型不认识 Python 字典。服务端会把你的 `tools` 列表渲染成一段文字,放进模型实际读到的提示词里(通常在 system 的位置),然后让模型接着往下写。Anthropic 的文档把这件事讲得很直白:调用时,API 会用工具定义、工具配置和你写的 system 提示词拼出一个特殊的 system prompt,开头大意是「你可以使用下面这些工具」,后面接着你的工具定义(2026 年 10 月查,[文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools))。DeepSeek 和 OpenAI 没有公开渲染成什么样,但道理一样:**工具定义就是提示词的一部分**。

这个事实有三个推论,后面的实验都是在验证它们:

- 工具定义占 token,每次请求都占。昨天量过,一个很短的工具就多 269 个。
- 写得好不好,等于提示词写得好不好。含糊、矛盾、缺信息,模型就会猜。
- 模型是「读」它而不是「执行」它,所以光有形式上合法的 schema 不够,它不会像编译器那样替你挡住错的参数。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="一份工具定义的三块内容各自影响模型的哪个决定:name 和 description 影响选哪个工具,parameters 里的每个字段说明和约束影响参数怎么填,required 影响缺了信息时是追问还是乱填">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">一份工具定义(tools 列表的一项)</text>
<rect x="20" y="40" width="270" height="270" rx="3" fill="none" stroke="var(--rule)"/>
<rect x="32" y="52" width="246" height="44" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="44" y="70" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">name</text>
<text x="44" y="87" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">get_weather</text>
<rect x="32" y="106" width="246" height="62" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="44" y="124" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">description</text>
<text x="44" y="141" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">查询一个城市当前的天气。</text>
<text x="44" y="157" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">用户问到气温、带伞时使用…</text>
<rect x="32" y="178" width="246" height="120" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="44" y="196" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">parameters</text>
<text x="44" y="214" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">city: string + 说明</text>
<text x="44" y="231" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">unit: enum[celsius,fahrenheit]</text>
<text x="44" y="248" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">required: [city]</text>
<text x="44" y="270" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每个字段自己还有 description</text>
<line x1="290" y1="74" x2="350" y2="74" stroke="var(--mem)"/>
<line x1="290" y1="137" x2="350" y2="90" stroke="var(--mem)"/>
<rect x="350" y="52" width="270" height="52" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="362" y="72" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型的决定 ①</text>
<text x="362" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">要不要调?调哪一个?</text>
<line x1="290" y1="226" x2="350" y2="170" stroke="var(--mem)"/>
<rect x="350" y="130" width="270" height="70" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="362" y="150" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型的决定 ②</text>
<text x="362" y="170" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">参数填什么值?什么格式?</text>
<text x="362" y="188" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">取值落在 enum 里吗?</text>
<line x1="290" y1="248" x2="350" y2="246" stroke="var(--mem)"/>
<rect x="350" y="226" width="270" height="52" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="362" y="246" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型的决定 ③</text>
<text x="362" y="264" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">缺了必填信息:追问还是瞎猜?</text>
</svg>
<figcaption>琥珀色是你写的定义,蓝色是模型因此做出的三个决定。三个决定都靠「读」这些文字,没有任何一处是程序在强制。</figcaption>
</figure>

## 第一步:一份认真写的定义

先把昨天那份定义升级成「认真写」的版本。新建 `part03/weather_tool.py`,以后几天都会 `from part03.weather_tool import WEATHER_TOOL`:

```python
# agent-zero-lab/part03/weather_tool.py
from typing import Any

# 一份认真写的工具定义:名字、描述、参数,每一块都有它的用处
WEATHER_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "查询一个城市当前的天气(温度、天气状况、风速)。用户问到天气、气温、冷不冷、要不要带伞、穿什么时使用。只能查当前,不能查预报。",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "城市名,中文或英文都行,例如 北京、Shanghai。只填城市,不要带省、国家或「市」字。",
                },
                "unit": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"],
                    "description": "温度单位。用户没有特别说明就用 celsius。",
                },
            },
            "required": ["city"],
        },
    },
}
```

<div class="line-notes">

- `from typing import Any` 工具定义是嵌套很深的字典,每一层都写类型太累,整体标成 `dict[str, Any]`,相当于 TS 里的 `Record<string, any>`。
- `WEATHER_TOOL: dict[str, Any] = {` 全大写表示当常量用。字典的形状和昨天一样:外面一层 `type` 加 `function`,里面是 `name`、`description`、`parameters`。
- `"type": "function",` 固定写法,目前所有厂商只有这一种。
- `"name": "get_weather",` 名字用动词加名词,小写加下划线。模型回请求时写的就是这个字符串,你的分发表要和它一字不差。
- `"description": "查询一个城市当前的天气` 描述分四个意思:做什么(查当前天气)、返回什么(温度、天气状况、风速)、什么时候用(问到气温、冷不冷、带伞、穿什么)、做不到什么(只能查当前,不能查预报)。最后一句「不能查预报」是在**劝退**:用户问「明天会下雨吗」时,模型就不该硬调它。
- `"parameters": {` 参数的 JSON Schema,最外层固定是 `"type": "object"`,因为模型填的参数最后是一个 JSON 对象。
- `"city": {` 一个参数一个 key,key 的名字就是模型写进 `arguments` 的 key,也是你函数的形参名(明天用 `**args` 展开时,两边必须一致)。
- `"description": "城市名,中文或英文都行,例如 北京、Shanghai。只填城市,不要带省、国家或「市」字。"` 参数自己的说明:格式(中文或英文)、例子、**不要什么**。例子里的「北京」「Shanghai」会被模型当作样板抄(后面实验会看到它抄得有多认真)。
- `"enum": ["celsius", "fahrenheit"],` 枚举:`unit` 只能是这两个值之一。比起在描述里写「只能填 celsius 或 fahrenheit」,枚举是更明确的信号。
- `"description": "温度单位。用户没有特别说明就用 celsius。",` 默认值怎么办也写在描述里:模型看见这句,用户没提单位时就会填 `celsius` 或者干脆不填。
- `"required": ["city"],` 只有 `city` 必填;`unit` 不在里面,模型可以不填。

</div>

再写一个小脚本,把这份定义的几个关键数字读出来,算是练一练「读懂别人写的定义」这件事。新建 `part03/show_tool.py`:

```python
# agent-zero-lab/part03/show_tool.py
import json

from part03.weather_tool import WEATHER_TOOL

fn = WEATHER_TOOL["function"]
print("name       :", fn["name"])
print("description:", fn["description"])
print("参数个数   :", len(fn["parameters"]["properties"]))
print("必填       :", fn["parameters"]["required"])
text = json.dumps(WEATHER_TOOL, ensure_ascii=False)
print("整份定义序列化后:", len(text), "个字符")
```

<div class="line-notes">

- `from part03.weather_tool import WEATHER_TOOL` 从刚才的文件导入。要在 `agent-zero-lab` 根目录用 `uv run python -m part03.show_tool` 运行,`-m` 的写法和 Day 156 一样。
- `fn = WEATHER_TOOL["function"]` 工具真正的内容在 `"function"` 这一层里,取出来后面少写几个字。
- `print("name       :", fn["name"])` 打印名字,冒号前面补空格只是为了对齐。
- `print("参数个数   :", len(fn["parameters"]["properties"]))` `properties` 是个字典,`len` 数它有几个 key,这里是 2(`city` 和 `unit`)。
- `print("必填       :", fn["parameters"]["required"])` 是个列表,`['city']`。
- `text = json.dumps(WEATHER_TOOL, ensure_ascii=False)` 把整份定义序列化成 JSON 文字,模型看到的就是这样一段文字(顺序和格式也许不同)。`ensure_ascii=False` 让中文原样保留。
- `print("整份定义序列化后:", len(text), "个字符")` 409 个字符。注意是**字符**不是 token:中文字符通常一个就超过一个 token,下面会量真正的 token 数。

</div>

```bash
uv run python -m part03.show_tool
```

我的输出:

```text
name       : get_weather
description: 查询一个城市当前的天气(温度、天气状况、风速)。用户问到天气、气温、冷不冷、要不要带伞、穿什么时使用。只能查当前,不能查预报。
参数个数   : 2
必填       : ['city']
整份定义序列化后: 409 个字符
```

好,现在有一份「像样」的定义了。问题是:像样到底有什么用?下面用实验回答,先看最上面那个决定:选哪个工具。

## 第二步:描述决定选择,但要看情况

为了测「选哪个工具」,至少得有两个工具。用云簿的发票场景造两个:`lookup_invoice`(按编号查单张发票)和 `list_invoices`(列出一个客户的多张发票)。同样的两个工具,写成四种版本:描述写好、描述留空、名字换成无意义的 `tool_a` / `tool_b`、描述只写「查发票」(两个一模一样)。新建 `part03/tool_variants.py`:

```python
# agent-zero-lab/part03/tool_variants.py
from typing import Any

# 两个云簿的工具:查一张发票、列出一批发票。五种写法,看模型靠什么选
LOOKUP_DESC = "按发票编号查询单张发票的详情:金额、状态、开票日期。用户给了具体编号(形如 INV-2026-0042)时使用。"
LIST_DESC = "列出某个客户的多张发票,可按状态筛选。用户问「有哪些」「哪几张」「列一下」时使用。"

ID_PARAM = {"invoice_id": {"type": "string", "description": "发票编号,例如 INV-2026-0042"}}
LIST_PARAMS = {
    "customer": {"type": "string", "description": "客户名,例如 ACME"},
    "status": {"type": "string", "enum": ["paid", "unpaid", "overdue"], "description": "只看这个状态"},
}


def tool(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    fn: dict[str, Any] = {
        "name": name,
        "parameters": {"type": "object", "properties": properties, "required": required},
    }
    if description:
        fn["description"] = description
    return {"type": "function", "function": fn}


def make_tools(variant: str) -> list[dict[str, Any]]:
    """variant: good / no_desc / opaque_names / vague"""
    lookup = ("lookup_invoice", LOOKUP_DESC)
    listing = ("list_invoices", LIST_DESC)
    if variant == "no_desc":
        lookup, listing = ("lookup_invoice", ""), ("list_invoices", "")
    elif variant == "opaque_names":
        lookup, listing = ("tool_a", LOOKUP_DESC), ("tool_b", LIST_DESC)
    elif variant == "vague":
        lookup, listing = ("lookup_invoice", "查发票"), ("list_invoices", "查发票")
    return [
        tool(lookup[0], lookup[1], ID_PARAM, ["invoice_id"]),
        tool(listing[0], listing[1], LIST_PARAMS, ["customer"]),
    ]
```

<div class="line-notes">

- `from typing import Any` 同上,schema 用 `dict[str, Any]`。
- `LOOKUP_DESC = "按发票编号查询单张发票的详情` 写清返回什么(金额、状态、开票日期)和触发条件(用户给了具体编号,形如 INV-2026-0042)。
- `LIST_DESC = "列出某个客户的多张发票` 触发条件换成「有哪些」「哪几张」「列一下」这些口语。两个描述各自从**用户会怎么问**写起,而不是从函数内部怎么实现写起。
- `ID_PARAM = {"invoice_id": {"type": "string", "description": "发票编号,例如 INV-2026-0042"}}` 查单张的参数:一个字符串编号,带例子。
- `LIST_PARAMS = {` 列一批的参数:`customer` 客户名,`status` 状态(枚举三个值)。
- `def tool(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:` 一个小工厂函数,拼出一份工具定义,少写重复的外层结构。
- `fn: dict[str, Any] = {` 先造里面那层 `function`,此时还没有 `description`。
- `if description:` 空字符串为假。描述是空的时候**整个 key 都不放**,和「写了一个空字符串」对模型来说差不多,但更接近很多人忘了写的真实情况。
- `fn["description"] = description` 有描述才加。
- `return {"type": "function", "function": fn}` 套上外层返回。
- `def make_tools(variant: str) -> list[dict[str, Any]]:` 按变体名返回两个工具的列表。
- `lookup = ("lookup_invoice", LOOKUP_DESC)` 默认(`good`)版本:元组 `(名字, 描述)`,先给两个工具各放一个。
- `if variant == "no_desc":` 版本二,名字照旧,两个描述都换成空字符串,模型只能靠名字和参数。
- `elif variant == "opaque_names":` 版本三,名字换成 `tool_a`、`tool_b`,描述照旧写好,模型只能靠描述。
- `elif variant == "vague":` 版本四,两个描述都是「查发票」,一模一样。
- `tool(lookup[0], lookup[1], ID_PARAM, ["invoice_id"]),` 第一个工具:`lookup[0]` 是名字,`lookup[1]` 是描述,参数用 `ID_PARAM`。
- `tool(listing[0], listing[1], LIST_PARAMS, ["customer"]),` 第二个工具,`customer` 必填。

</div>

再写测它的脚本:四个问题,每个重复 3 次,统计选对几次。新建 `part03/pick_tool.py`:

```python
# agent-zero-lab/part03/pick_tool.py
from collections import Counter

from common.llm import LLMClient
from part03.tool_variants import make_tools

# (问题, 期望选到的是第几个工具:0 是查单张,1 是列一批)
CASES = [
    ("INV-2026-0042 付了吗?", 0),
    ("ACME 有哪几张发票没付?", 1),
    ("帮我看一下发票 INV-2026-0107 的金额", 0),
    ("列一下 Globex 的发票", 1),
]
VARIANTS = ["good", "no_desc", "opaque_names", "vague"]
REPEAT = 3

client = LLMClient()
SYSTEM = "你是云簿 CloudLedger 的客服助手。"
for variant in VARIANTS:
    tools = make_tools(variant)
    names = [t["function"]["name"] for t in tools]  # names[0] 是查单张那个位置,names[1] 是列一批
    right = 0
    picked: Counter[str] = Counter()
    for q, want in CASES:
        for _ in range(REPEAT):
            r = client.chat(
                [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}],
                tools=tools,
                temperature=0,
                max_tokens=150,
            )
            calls = r.message.get("tool_calls", [])
            got = calls[0]["function"]["name"] if calls else "(没调用)"
            picked[got] += 1
            if got == names[want]:
                right += 1
    print(f"{variant:13} 名字={names} 选对 {right}/{len(CASES) * REPEAT}  实际选择={dict(picked)}")
print(client.ledger)
```

<div class="line-notes">

- `from collections import Counter` 数数用的字典,`Counter()["a"] += 1` 不用先初始化。
- `from part03.tool_variants import make_tools` 导入上面的工厂函数。
- `("INV-2026-0042 付了吗?", 0),` 每条用例是 `(问题, 期望选哪个位置的工具)`,`0` 是「查单张」,`1` 是「列一批」。
- `VARIANTS = ["good", "no_desc", "opaque_names", "vague"]` 四个版本的名字。
- `REPEAT = 3` 同一个问题发 3 次。`temperature=0` 也不保证每次完全一样,重复几次才知道稳不稳。
- `names = [t["function"]["name"] for t in tools]` 列表推导式([Day 23](/blog/agent-zero/day-023-comprehensions/)):取出这一版两个工具的名字。注意 `opaque_names` 版里它们是 `tool_a`、`tool_b`,所以不能直接比字符串,要用位置去取。
- `picked: Counter[str] = Counter()` 记录模型实际选了谁,最后一起打印。
- `r = client.chat(` 每次只发 system 加一个问题,不带历史,`tools=tools` 带上本版本的定义。
- `calls = r.message.get("tool_calls", [])` 没请求时没有这个 key,用 `get` 给空列表。
- `got = calls[0]["function"]["name"] if calls else "(没调用)"` 取第一个请求的函数名;没请求就记一个占位字符串。
- `if got == names[want]:` 选对了:和期望位置的名字比。
- `print(f"{variant:13} 名字={names} 选对 {right}/{len(CASES) * REPEAT}  实际选择={dict(picked)}")` `{variant:13}` 占 13 位宽对齐;总次数是 4 个问题乘 3 次等于 12。
- `print(client.ledger)` 全部调用的合计账单。

</div>

```bash
uv run python -m part03.pick_tool
```

我的输出(2026-10-23,DeepSeek `deepseek-flash`):

```text
good          名字=['lookup_invoice', 'list_invoices'] 选对 12/12  实际选择={'lookup_invoice': 6, 'list_invoices': 6}
no_desc       名字=['lookup_invoice', 'list_invoices'] 选对 12/12  实际选择={'lookup_invoice': 6, 'list_invoices': 6}
opaque_names  名字=['tool_a', 'tool_b'] 选对 12/12  实际选择={'tool_a': 6, 'tool_b': 6}
vague         名字=['lookup_invoice', 'list_invoices'] 选对 12/12  实际选择={'lookup_invoice': 6, 'list_invoices': 6}
48 次调用 | 输入 19824 / 输出 2313 tokens | 约 ¥0.0379
```

四个版本**全部 12/12**。这个结果有点扫兴,但很有信息量:没有描述的版本照样选对了,名字换成 `tool_a` 也选对了,「查发票」两个一样也选对了。原因是这两个工具太好区分了:一个参数是 `invoice_id`,一个是 `customer` 加 `status`;问题里一个带着编号,一个问「哪几张」。模型靠参数的名字和问题的形状就猜对了。

所以别急着得出「描述不重要」。**描述的价值在区分不开的时候才显出来**,现实里这种情况太多了。再造一对更像真实系统的:两个接口参数一模一样,名字是历史遗留的 `ledger_v1` 和 `ledger_v2`,只有描述知道谁是谁。v1 返回某客户某月的全部流水明细,v2 只返回合计。新建 `part03/ledger_variants.py`:

```python
# agent-zero-lab/part03/ledger_variants.py
from typing import Any

# 名字看不出区别的两个工具:参数完全一样,只有描述能说清谁是谁
ROWS_DESC = "返回该客户该月的全部流水明细,每一笔一行。用户要看明细、逐笔、列出每一笔时使用。"
TOTAL_DESC = "只返回该客户该月的合计金额,不含明细。用户问总共、合计、一共多少钱时使用。"
PARAMS = {
    "type": "object",
    "properties": {
        "customer": {"type": "string", "description": "客户名,例如 ACME"},
        "month": {"type": "string", "description": "月份,格式 YYYY-MM,例如 2026-10"},
    },
    "required": ["customer", "month"],
}


def make_ledger_tools(variant: str) -> list[dict[str, Any]]:
    """v1 是明细,v2 是合计。variant: good / no_desc / vague / swapped / name_only"""
    d1, d2 = ROWS_DESC, TOTAL_DESC
    if variant == "no_desc":
        d1, d2 = "", ""
    elif variant == "vague":
        d1, d2 = "查询客户流水", "查询客户流水"
    elif variant == "swapped":
        d1, d2 = TOTAL_DESC, ROWS_DESC
    elif variant == "name_only":
        d1, d2 = "ledger_v1 工具", "ledger_v2 工具"
    out: list[dict[str, Any]] = []
    for name, desc in (("ledger_v1", d1), ("ledger_v2", d2)):
        fn: dict[str, Any] = {"name": name, "parameters": PARAMS}
        if desc:
            fn["description"] = desc
        out.append({"type": "function", "function": fn})
    return out
```

<div class="line-notes">

- `ROWS_DESC = "返回该客户该月的全部流水明细` v1 的描述:返回什么(明细,每一笔一行)加什么时候用(要看明细、逐笔、列出每一笔)。
- `TOTAL_DESC = "只返回该客户该月的合计金额,不含明细。` v2 的描述,里面有「只返回」和「不含明细」,是把**边界**说清楚。
- `PARAMS = {` 两个工具共用同一份参数:`customer` 和 `month`,所以光看参数完全分不出谁是谁。
- `"description": "月份,格式 YYYY-MM,例如 2026-10"` 格式和例子都写进参数说明。
- `def make_ledger_tools(variant: str) -> list[dict[str, Any]]:` 和上一个文件一样,按变体名返回两个工具。
- `d1, d2 = ROWS_DESC, TOTAL_DESC` 默认版本:各用各的好描述。
- `if variant == "no_desc":` 版本二:两个描述都空。
- `elif variant == "vague":` 版本三:两个都写「查询客户流水」。
- `elif variant == "swapped":` 版本四:**故意把两个描述对调**,v1 的位置放了「只返回合计」。名字说一套,描述说另一套,看模型信谁。
- `elif variant == "name_only":` 版本五:描述只是复述名字「ledger_v1 工具」,等于没写。
- `for name, desc in (("ledger_v1", d1), ("ledger_v2", d2)):` 把两个工具依次造出来。
- `fn: dict[str, Any] = {"name": name, "parameters": PARAMS}` 先放名字和参数。
- `if desc:` 描述为空就不放 `description` key。
- `out.append({"type": "function", "function": fn})` 套上外层追加进列表。

</div>

再写测它的脚本 `part03/pick_ledger.py`(把实验放进 `main()`,明天练习要 `import` 它的 `CASES`,不能一导入就跑实验,这是 Day 156 踩过的坑):

```python
# agent-zero-lab/part03/pick_ledger.py
from collections import Counter

from common.llm import LLMClient
from part03.ledger_variants import make_ledger_tools

# (问题, 期望的工具名)
CASES = [
    ("ACME 2026 年 10 月一共收了多少钱?", "ledger_v2"),
    ("把 ACME 2026 年 10 月的每一笔流水列出来", "ledger_v1"),
    ("Globex 2026 年 9 月总共多少?", "ledger_v2"),
    ("Globex 2026 年 9 月都有哪些流水?", "ledger_v1"),
]
VARIANTS = ["good", "no_desc", "vague", "name_only", "swapped"]
REPEAT = 3


def main() -> None:
    client = LLMClient()
    for variant in VARIANTS:
        tools = make_ledger_tools(variant)
        right = 0
        picked: Counter[str] = Counter()
        for q, want in CASES:
            for _ in range(REPEAT):
                r = client.chat(
                    [{"role": "system", "content": "你是云簿 CloudLedger 的客服助手。"}, {"role": "user", "content": q}],
                    tools=tools,
                    temperature=0,
                    max_tokens=150,
                )
                calls = r.message.get("tool_calls", [])
                got = calls[0]["function"]["name"] if calls else "(没调用)"
                picked[got] += 1
                right += got == want
        print(f"{variant:10} 选对 {right}/{len(CASES) * REPEAT}  实际选择={dict(picked)}")
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from part03.ledger_variants import make_ledger_tools` 导入上一个文件的工厂函数。
- `("ACME 2026 年 10 月一共收了多少钱?", "ledger_v2"),` 这次用例直接写期望的**工具名**,因为两个工具名字固定,不用再按位置取。问「一共多少」的该选 v2(合计)。
- `("把 ACME 2026 年 10 月的每一笔流水列出来", "ledger_v1"),` 要明细的该选 v1。
- `VARIANTS = ["good", "no_desc", "vague", "name_only", "swapped"]` 五个版本。
- `def main() -> None:` 实验放进函数,文件末尾用 `if __name__ == "__main__"` 调它。
- `right += got == want` 布尔值参与加法:`True` 当 1,`False` 当 0,一行数出选对几次。
- `print(f"{variant:10} 选对 {right}/{len(CASES) * REPEAT}  实际选择={dict(picked)}")` 4 个问题乘 3 次,总数 12。
- `if __name__ == "__main__":` 直接运行时才执行 `main()`,被别的文件 `import` 时不执行。

</div>

```bash
uv run python -m part03.pick_ledger
```

我的输出:

```text
good       选对 12/12  实际选择={'ledger_v2': 6, 'ledger_v1': 6}
no_desc    选对 6/12  实际选择={'ledger_v1': 12}
vague      选对 3/12  实际选择={'ledger_v1': 9, 'ledger_v2': 3}
name_only  选对 6/12  实际选择={'ledger_v1': 12}
swapped    选对 0/12  实际选择={'ledger_v1': 6, 'ledger_v2': 6}
60 次调用 | 输入 26133 / 输出 5870 tokens | 约 ¥0.0716
```

逐行读:

- **`good` 12/12。** 描述写清楚,问「一共」就选合计,问「每一笔」就选明细,一次没错。
- **`no_desc` 6/12,实际选择 `ledger_v1`: 12。** 没有描述,模型分不出来,**不管问什么都选了 v1**(列表里排第一的那个)。选对的 6 次只是因为那 6 次期望的刚好是 v1。这是最典型的症状:不是偶尔错,是**一边倒**。看到「模型永远只用其中一个工具」,先去检查描述。
- **`vague` 3/12。** 两个都写「查询客户流水」,选择反而有点乱(9 次 v1、3 次 v2),比什么都不写还差一点。含糊的描述不是中立的,它会引入噪声。
- **`name_only` 6/12。** 描述只是把名字再说一遍,和没写一样。
- **`swapped` 0/12。** 这一行最有意思:v1 的位置上放着「只返回合计」的描述,v2 上放着「返回明细」。结果**一次都没选对**,而且 v1、v2 各选了 6 次。意思是:模型信的是描述,不是名字。名字叫 `ledger_v1`,描述说我只返回合计,问到「一共多少」它就去选了描述说合计的那个(在这里就是 v1),所以按「名字对应明细」的期望算全错。

这给了一个很实用的结论:**描述和名字不一致比没有描述更糟**。重构代码改了函数的行为、忘了改描述,模型就会一本正经地用错。Anthropic 那篇讲怎么给 Agent 写工具的文章里有一句话,大意是工具描述的小改动能带来很大的效果差异,他们甚至靠只改描述把一个评测榜上的错误率压下去(2026 年 10 月查,[文章](https://www.anthropic.com/engineering/writing-tools-for-agents))。这次实测的数字比一句话更直观:3/12 到 12/12,函数一行没动。

### 描述该怎么写

从上面的 `good` 和 `swapped` 倒推,一份能打的描述至少回答四件事,Anthropic 的文档(上面那份 define-tools)给的清单几乎一样,我按今天的实验重新排了顺序:

1. **做什么、返回什么。** 「返回该客户该月的全部流水明细,每一笔一行」比「查流水」好得多,因为它同时说了粒度。
2. **什么时候用。** 用**用户会说的话**来写:「问到一共、总共、合计时使用」。模型是拿用户的话和你的描述做匹配的。
3. **什么时候不用,边界在哪。** 「只返回合计,不含明细」「只能查当前,不能查预报」。有近亲工具时,最好直接点名:「要看每一笔时用 ledger_v1」。
4. **参数的格式和例子。** 放在参数自己的 `description` 里,下一步细讲。

Anthropic 的文档建议每个工具的描述至少写三四句,工具复杂就更多,并且说描述是影响工具表现「最重要的因素」。我的经验是别追求长,追求**每一句都回答上面某个问题**。最后一个练习让你亲手把 `vague` 版的 3/12 改到 12/12,改完你会很有体感。

## 第三步:参数怎么管:说明、例子、枚举

选对了工具,下一个决定是参数填什么。同一个 `list_invoices` 工具,参数写三个深度:

- `bare`:每个参数只有 `"type": "string"`,别的什么都没有。
- `described`:每个参数加一句说明,月份还带格式和例子。
- `enum`:在 `described` 的基础上,`status` 再加 `enum` 限定三个值。

新建 `part03/param_variants.py`:

```python
# agent-zero-lab/part03/param_variants.py
from typing import Any


def make_list_tool(variant: str) -> dict[str, Any]:
    """variant: bare(参数只有类型) / described(加说明和例子) / enum(状态再加枚举) / enum_rule(再加一句「做不到就别调」)"""
    props: dict[str, Any] = {
        "customer": {"type": "string"},
        "status": {"type": "string"},
        "month": {"type": "string"},
    }
    if variant != "bare":
        props["customer"]["description"] = "客户名,例如 ACME"
        props["status"]["description"] = "发票状态:paid 已付清,unpaid 未付,overdue 已逾期"
        props["month"]["description"] = "开票月份,格式 YYYY-MM,例如 2026-10;不限月份就不要填"
    if variant in ("enum", "enum_rule"):
        props["status"]["enum"] = ["paid", "unpaid", "overdue"]
    description = "列出某个客户的发票,可以按状态和开票月份筛选。"
    if variant == "enum_rule":
        description += "状态只支持 paid、unpaid、overdue 三种;用户要的筛选条件不在其中时,不要调用本工具,直接告诉用户做不到。"
    return {
        "type": "function",
        "function": {
            "name": "list_invoices",
            "description": description,
            "parameters": {"type": "object", "properties": props, "required": ["customer"]},
        },
    }
```

<div class="line-notes">

- `def make_list_tool(variant: str) -> dict[str, Any]:` 按版本名返回一个工具定义(只一个工具,这一步只看参数)。
- `props: dict[str, Any] = {` 三个参数先都只有类型,这就是 `bare` 版本的全部样子。
- `if variant != "bare":` 只要不是 `bare`,就给三个参数补上说明。
- `props["customer"]["description"] = "客户名,例如 ACME"` 给 `customer` 补一句。
- `props["status"]["description"] = "发票状态:paid 已付清,unpaid 未付,overdue 已逾期"` 状态的说明里把三个词各自的意思写了,但这时它还只是「建议」,模型想填别的也不拦。
- `props["month"]["description"] = "开票月份,格式 YYYY-MM,例如 2026-10;不限月份就不要填"` 格式、例子、**不填的条件**三样都在。
- `if variant in ("enum", "enum_rule"):` `enum_rule` 是最后一步才用的第四个版本,先不管。
- `props["status"]["enum"] = ["paid", "unpaid", "overdue"]` 加上枚举:这一步是**写进 schema 的约束**,不再只是建议。
- `description = "列出某个客户的发票,可以按状态和开票月份筛选。"` 工具自己的描述,四个版本里都有。
- `description += "状态只支持 paid、unpaid、overdue 三种;` 只有 `enum_rule` 才追加这句:明说「不在三种里就别调用,告诉用户做不到」。
- `"description": description,` 把拼好的描述放进工具定义。
- `"parameters": {"type": "object", "properties": props, "required": ["customer"]},` 只有 `customer` 必填,状态和月份都是可选筛选条件。

</div>

测它的脚本 `part03/pick_params.py`,问三个问题,系统提示词分「没写今天日期」和「写了今天日期」两种,看模型填出来的 `status` 和 `month`:

```python
# agent-zero-lab/part03/pick_params.py
import json
from collections import Counter

from common.llm import LLMClient
from part03.param_variants import make_list_tool

QUESTIONS = [
    "ACME 2026 年 10 月没付的发票",
    "ACME 上个月逾期的发票",
    "ACME 九月已经付清的有哪些",
]
SYSTEMS = {
    "无日期": "你是云簿 CloudLedger 的客服助手。",
    "有日期": "你是云簿 CloudLedger 的客服助手。今天是 2026-10-23。",
}
REPEAT = 3

client = LLMClient()
for variant in ["bare", "described", "enum"]:
    tool = make_list_tool(variant)
    for sys_name, system in SYSTEMS.items():
        print(f"== {variant} / {sys_name}")
        for q in QUESTIONS:
            seen: Counter[str] = Counter()
            for _ in range(REPEAT):
                r = client.chat(
                    [{"role": "system", "content": system}, {"role": "user", "content": q}],
                    tools=[tool],
                    temperature=0,
                    max_tokens=150,
                )
                calls = r.message.get("tool_calls", [])
                if calls:
                    a = json.loads(calls[0]["function"]["arguments"])
                    a.pop("customer", None)
                    seen[json.dumps(a, ensure_ascii=False)] += 1
                else:
                    seen["(没调用)" + r.content[:20]] += 1
            print(f"  {q} -> {dict(seen)}")
print(client.ledger)
```

<div class="line-notes">

- `import json` 要把模型给的 `arguments` 字符串解析成字典。
- `"ACME 上个月逾期的发票",` 这个问题里的「上个月」要换算成具体月份,需要知道今天是哪天。
- `"ACME 九月已经付清的有哪些",` 「九月」没写年份,同样需要知道今年是哪年。
- `SYSTEMS = {` 同一批问题用两种 system 各跑一遍,看有没有日期差多少。
- `"有日期": "你是云簿 CloudLedger 的客服助手。今天是 2026-10-23。",` 把日期**直接告诉模型**。模型没有时钟,它不知道今天几号,除非你写进提示词。
- `for variant in ["bare", "described", "enum"]:` 外层循环三个版本。
- `tool = make_list_tool(variant)` 造本版本的工具,每次请求只带这一个。
- `seen: Counter[str] = Counter()` 记录三次重复里每种参数组合各出现几次。
- `a = json.loads(calls[0]["function"]["arguments"])` 解析参数字符串。
- `a.pop("customer", None)` 去掉 `customer`(三个问题都是 ACME,没意思),只看 `status` 和 `month`。第二个参数 `None` 是默认值,`customer` 不存在时不抛 `KeyError`。
- `seen[json.dumps(a, ensure_ascii=False)] += 1` 把剩下的参数转成字符串当 key 计数。
- `seen["(没调用)" + r.content[:20]] += 1` 模型没提请求的话,记下它说的前 20 个字。
- `print(f"  {q} -> {dict(seen)}")` 每个问题打印一行:出现过哪几种参数组合,各几次。

</div>

```bash
uv run python -m part03.pick_params
```

我的输出(完整输出有 24 行,三个版本各两种系统提示词、每种三个问题,这里挑了最能说明问题的几行;每个问题调了 3 次):

```text
== bare / 无日期
  ACME 2026 年 10 月没付的发票 -> {'{"status": "unpaid", "month": "2026-10"}': 2, '{"month": "2026-10", "status": "unpaid"}': 1}
  ACME 上个月逾期的发票 -> {'{"status": "overdue", "month": "last_month"}': 3}
  ACME 九月已经付清的有哪些 -> {'{"month": "2025-09", "status": "paid"}': 3}
== bare / 有日期
  ACME 上个月逾期的发票 -> {'{"status": "overdue", "month": "2026-09"}': 3}
  ACME 九月已经付清的有哪些 -> {'{"month": "2026-09", "status": "paid"}': 3}
== described / 无日期
  ACME 上个月逾期的发票 -> {'{"status": "overdue", "month": "2026-10"}': 3}
  ACME 九月已经付清的有哪些 -> {'{"status": "paid", "month": "2026-09"}': 3}
== described / 有日期
  ACME 上个月逾期的发票 -> {'{"status": "overdue", "month": "2026-09"}': 3}
== enum / 无日期
  ACME 上个月逾期的发票 -> {'{"status": "overdue", "month": "2026-10"}': 1, '{"status": "overdue"}': 2}
```

三个值得停下来的现象:

**`bare` 的 `month` 随便填。** 没有任何说明时,「上个月」被模型写成字面量 `"last_month"`,三次一模一样,拿去查数据库一定查不到;「九月」被补成了 `2025-09`,年份是它凭训练时的印象猜的。key 的顺序也不稳定(第一行里 `status` 和 `month` 谁在前都出现过),所以**别拿参数字符串做字符串比较**,要解析成字典再比。

**写了日期,三个版本都对了。** 「上个月」必须要有一个「现在」才算得出来,而模型没有时钟。凡是工具参数里有相对时间(上个月、昨天、最近一周),**把今天的日期写进系统提示词**,或者干脆让工具自己接收相对值再由代码算。这个结论比任何 schema 技巧都更重要。

**`described` 的例子被原样抄了。** 我在月份说明里写了「例如 2026-10」,结果 `described / 无日期` 里,「上个月」三次都填了 `2026-10`,错了一个月,因为模型把例子当成了默认值。这是我故意埋的坑,也是真实会发生的事:**例子会被当样板抄**。写例子时,挑一个不会被当成「答案」的,或者像月份这种和「现在」有关的值,干脆不写具体例子,写 `YYYY-MM` 格式就够了。

`enum / 无日期` 那行更有趣:三次里有两次模型**干脆没填 `month`**(那是个可选参数),一次填了 `2026-10`。可选参数让模型多了一条退路:拿不准就不填,结果是查出一堆不是用户想要的发票,而且不报错。

### 枚举到底管了什么

上面的实验里,状态都碰巧填对了。换几个说法再试,专门看 `status`。新建 `part03/pick_status.py`:

```python
# agent-zero-lab/part03/pick_status.py
import json
from collections import Counter

from common.llm import LLMClient
from part03.param_variants import make_list_tool

QUESTIONS = ["ACME 还欠着钱的发票", "ACME 已经结清的发票", "ACME 拖欠的发票", "ACME 作废的发票"]
SYSTEM = "你是云簿 CloudLedger 的客服助手。今天是 2026-10-23。"

client = LLMClient()
for variant in ["bare", "enum", "enum_rule"]:
    tool = make_list_tool(variant)
    for q in QUESTIONS:
        seen: Counter[str] = Counter()
        for _ in range(3):
            r = client.chat(
                [{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}],
                tools=[tool],
                temperature=0,
                max_tokens=150,
            )
            calls = r.message.get("tool_calls", [])
            if calls:
                args = json.loads(calls[0]["function"]["arguments"])
                seen[f"status={args.get('status')!r}"] += 1
            else:
                seen["没调用:" + r.content[:24]] += 1
        print(f"{variant:9} {q} -> {dict(seen)}")
print(client.ledger)
```

<div class="line-notes">

- `QUESTIONS = ["ACME 还欠着钱的发票", "ACME 已经结清的发票", "ACME 拖欠的发票", "ACME 作废的发票"]` 四种说法:前三个都能对应三个状态之一,**「作废」不在任何一个里**,是故意设的陷阱。
- `SYSTEM = "你是云簿 CloudLedger 的客服助手。今天是 2026-10-23。"` 这次日期写上了,别让日期干扰。
- `for variant in ["bare", "enum", "enum_rule"]:` 三个版本:什么都不加、加枚举、再加一句「做不到就别调」。
- `seen[f"status={args.get('status')!r}"] += 1` `args.get('status')` 没填时得到 `None`;`!r` 让字符串带引号显示,这样 `'unpaid'` 和 `None` 一眼能分开。注意 f-string 里面用单引号,外面才能用双引号。
- `seen["没调用:" + r.content[:24]] += 1` 没调用时记下模型说的前 24 个字。

</div>

```bash
uv run python -m part03.pick_status
```

我的输出:

```text
bare      ACME 还欠着钱的发票 -> {"status='unpaid'": 3}
bare      ACME 已经结清的发票 -> {"status='已结清'": 3}
bare      ACME 拖欠的发票 -> {"status='overdue'": 3}
bare      ACME 作废的发票 -> {"status='作废'": 3}
enum      ACME 还欠着钱的发票 -> {"status='unpaid'": 3}
enum      ACME 已经结清的发票 -> {"status='paid'": 3}
enum      ACME 拖欠的发票 -> {"status='overdue'": 3}
enum      ACME 作废的发票 -> {'status=None': 3}
enum_rule ACME 还欠着钱的发票 -> {"status='unpaid'": 3}
enum_rule ACME 已经结清的发票 -> {"status='paid'": 3}
enum_rule ACME 拖欠的发票 -> {"status='overdue'": 3}
enum_rule ACME 作废的发票 -> {'没调用:我无法按“作废”这个状态查询发票——系统只支持已': 2, '没调用:您想查 ACME 作废的发票,但发票状态只支持「': 1}
36 次调用 | 输入 13644 / 输出 2497 tokens | 约 ¥0.0327
```

读出三层意思:

1. **`bare`:模型会发明词汇。** 「已经结清」被写成中文 `'已结清'`,「作废」被写成 `'作废'`,你的后端根本没有这两个状态。没有枚举,约束只存在于模型的善意里。
2. **`enum`:词汇管住了,但「没有合适的值」时它选择不填。** `已经结清` 被映射成了 `'paid'`,这是枚举最典型的用处:用户的各种说法统一落到你定义的值上。可是「作废」没有对应的值,模型没有发明新词,而是把 `status` **整个省掉**了(`status=None`)。结果呢?这次调用会返回 ACME 的**全部**发票,用户问的是作废的,看到的却是所有的,而且没有任何报错。这是静默的错,比报错更危险。
3. **`enum_rule`:把「做不到」写进描述,它才会停下来。** 工具描述里加了一句「用户要的筛选条件不在其中时,不要调用本工具,直接告诉用户做不到」,「作废」那一行三次都没有调用,模型直接回答用户「系统只支持已付清、未付、逾期」之类。

所以枚举的作用是**约束词汇**,不是**约束意图**。用户想要的东西你的接口提供不了时,schema 帮不上忙,要靠描述里明确写一句「做不到就别调」。这是我这次实验里收获最大的一条。

## 第四步:required 能保证什么

`required: ["invoice_id"]` 看起来像是「模型必须填」。实际上它的效果是**让模型知道这个必须有**,至于用户没给的时候模型是追问还是瞎填,是另一回事。测一下。新建 `part03/pick_required.py`:

```python
# agent-zero-lab/part03/pick_required.py
import json
from collections import Counter
from typing import Any

from common.llm import LLMClient


def lookup_tool(id_desc: str) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": "lookup_invoice",
            "description": "按发票编号查询单张发票的金额和状态。",
            "parameters": {
                "type": "object",
                "properties": {"invoice_id": {"type": "string", "description": id_desc}},
                "required": ["invoice_id"],
            },
        },
    }


DESCS = {
    "只写例子": "发票编号,例如 INV-2026-0042",
    "写明不许猜": "发票编号,形如 INV-2026-0042。必须是用户明确说出的编号;用户没给就先问用户,不要自己编。",
}
QUESTIONS = ["帮我查一下那张发票付了没", "我上周收到一张发票,金额不对"]

client = LLMClient()
for name, desc in DESCS.items():
    tool = lookup_tool(desc)
    for q in QUESTIONS:
        seen: Counter[str] = Counter()
        for _ in range(3):
            r = client.chat(
                [{"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"}, {"role": "user", "content": q}],
                tools=[tool],
                temperature=0,
                max_tokens=150,
            )
            calls = r.message.get("tool_calls", [])
            if calls:
                seen["调用 " + calls[0]["function"]["arguments"]] += 1
            else:
                seen["追问:" + r.content[:30]] += 1
        print(f"[{name}] {q}")
        for k, v in seen.items():
            print(f"    {v}次 {k}")
print(client.ledger)
```

<div class="line-notes">

- `def lookup_tool(id_desc: str) -> dict[str, Any]:` 造一个只有 `invoice_id` 一个必填参数的查发票工具,参数的说明由调用方传入,这样可以对比两种写法。
- `"description": "按发票编号查询单张发票的金额和状态。",` 工具描述故意写得很短,变量只留在参数说明上。
- `"required": ["invoice_id"],` 必填。
- `DESCS = {` 两种参数说明:只写例子,以及写明「必须是用户明确说出的编号,没给就先问,不要自己编」。
- `QUESTIONS = ["帮我查一下那张发票付了没", "我上周收到一张发票,金额不对"]` 两个都**没有给编号**的请求。
- `seen["调用 " + calls[0]["function"]["arguments"]] += 1` 如果模型调用了,把它填的 `arguments` 原样记下,看它编了什么。
- `seen["追问:" + r.content[:30]] += 1` 没调用就记下它追问的话。
- `for k, v in seen.items():` 遍历计数字典的键和值。

</div>

```bash
uv run python -m part03.pick_required
```

我的输出:

```text
[只写例子] 帮我查一下那张发票付了没
    3次 追问:请问发票编号是多少?例如 INV-2026-0042。
[只写例子] 我上周收到一张发票,金额不对
    3次 追问:我可以帮您查一下。请提供发票编号(例如 INV-2026-0
[写明不许猜] 帮我查一下那张发票付了没
    3次 追问:请问发票编号是多少?我需要编号才能查询。
[写明不许猜] 我上周收到一张发票,金额不对
    1次 追问:请问发票编号是多少?您可以在发票上找到形如 INV-2026
    2次 追问:请问发票编号是多少?您方便提供一下吗(形如 INV-2026
12 次调用 | 输入 3846 / 输出 212 tokens | 约 ¥0.0066
```

这次**两种写法的效果没有差别**:12 次全部追问编号,没有一次瞎编。我想制造一个「模型乱填」的反例,没造出来。诚实地说:这个模型在这种明显缺信息的场景下很守规矩。但别因此放心,理由有两个。一是小一点的、便宜的模型在这里经常会编一个 `INV-2026-0001` 出来;二是这份实验里「缺」得太明显,真实对话里缺的往往是边角信息,比如用户说「帮我查 ACME 的发票」,没说是哪个月,模型可能直接填上它觉得合理的月份。所以「写明不许猜」是便宜的保险,我会写,但**不指望它**:下一步的本地检查才是真的防线。

## 第五步:每一个字都在花钱

工具定义是提示词,按 token 收费,每次请求都收。上面这份 `WEATHER_TOOL` 到底占多少 token?一块一块拆掉量一下。新建 `part03/token_cost.py`:

```python
# agent-zero-lab/part03/token_cost.py
import copy
from typing import Any

from common.llm import LLMClient
from part03.weather_tool import WEATHER_TOOL

client = LLMClient()
messages = [{"role": "user", "content": "北京现在多少度?"}]


def prompt_tokens(tools: list[dict[str, Any]] | None) -> int:
    kw: dict[str, Any] = {"tools": tools} if tools else {}
    return client.chat(messages, max_tokens=1, temperature=0, **kw).prompt_tokens


# 从完整版开始,一块一块拆掉
full = copy.deepcopy(WEATHER_TOOL)
no_param_desc = copy.deepcopy(full)
for p in no_param_desc["function"]["parameters"]["properties"].values():
    p.pop("description")
no_desc = copy.deepcopy(no_param_desc)
no_desc["function"].pop("description")
only_city = copy.deepcopy(no_desc)
only_city["function"]["parameters"]["properties"].pop("unit")

rows = [
    ("没有 tools", None),
    ("只剩名字和 city", [only_city]),
    ("名字 + city + unit(枚举)", [no_desc]),
    ("再加两个参数的说明", [no_param_desc]),
    ("再加工具的 description(完整版)", [full]),
]
base = prompt_tokens(None)
for label, tools in rows:
    n = prompt_tokens(tools)
    print(f"{label:28} 输入 {n:4} token(比没有 tools 多 {n - base})")
```

<div class="line-notes">

- `import copy` 要深拷贝工具定义,避免拆的时候把原件改了。
- `def prompt_tokens(tools: list[dict[str, Any]] | None) -> int:` 发一次请求,只返回「输入用了多少 token」。`| None` 表示可以不传工具(没有 `tools` 的对照组)。
- `kw: dict[str, Any] = {"tools": tools} if tools else {}` 有工具就带 `tools`,没有就什么都不带。
- `return client.chat(messages, max_tokens=1, temperature=0, **kw).prompt_tokens` `max_tokens=1` 让它最多写一个 token 就停,我们只关心输入量,不想为回答付钱。`**kw` 把字典展开成关键字参数。
- `full = copy.deepcopy(WEATHER_TOOL)` 完整版,作为起点。
- `for p in no_param_desc["function"]["parameters"]["properties"].values():` 遍历每个参数。
- `p.pop("description")` 删掉参数说明,得到「没有参数说明」的版本。
- `no_desc["function"].pop("description")` 在上一版基础上再删掉工具的描述。
- `only_city["function"]["parameters"]["properties"].pop("unit")` 再删掉整个 `unit` 参数,得到最小版本:名字加一个 `city`。
- `("没有 tools", None),` 对照组,什么工具都不带。
- `base = prompt_tokens(None)` 先量对照组,得到 9 个 token(就是那句「北京现在多少度?」)。
- `print(f"{label:28} 输入 {n:4} token(比没有 tools 多 {n - base})")` 每一版和对照组做差。

</div>

```bash
uv run python -m part03.token_cost
```

我的输出:

```text
没有 tools                     输入    9 token(比没有 tools 多 0)
只剩名字和 city                   输入  263 token(比没有 tools 多 254)
名字 + city + unit(枚举)         输入  283 token(比没有 tools 多 274)
再加两个参数的说明                    输入  323 token(比没有 tools 多 314)
再加工具的 description(完整版)       输入  373 token(比没有 tools 多 364)
```

逐行读:

- 最小的那份工具,**光是名字加一个参数就多了 254 个 token**。这一块是固定开销,大概是服务端渲染工具定义时加的开头和格式文字,你写不写描述它都在。所以「工具越少越省」的另一面是:再少也有底。
- 加 `unit` 和它的枚举,多了 20 个。
- 两个参数的说明加起来多了 40 个。
- 工具自己的描述(那句 60 来个汉字)多了 50 个。

把这些放在一起看:**认真写的描述,一个工具大约多花 90 个 token**,按 DeepSeek 未命中输入 ¥2 每百万算(`LLM_PRICE=0.04,2,8`,2026 年 10 月核过),一次请求多花 ¥0.00018。一万次不到 ¥2。描述写得好值这个价,所以别为了省 token 把描述砍成一个词。真正要小心的是**工具数量**:二十个工具,按每个 250 加 90 线性外推,一次请求光工具就是 6800 多 token(这是估算,没实测,工具之间可能共享一部分开头)。第三部分后面的「工具检索」会专门处理这件事。

## 第六步:在本地再检查一遍

schema 写给模型看,但模型不一定守。无论模型表现多好,代码里还是要把它给的 `arguments` 拿同一份 schema 检查一遍:schema 既是给模型的说明书,也是你自己的验货单。这正是 Day 148 学的 `jsonschema` 库的用处,今天把它接到工具定义上。新建 `part03/check_args.py`:

```python
# agent-zero-lab/part03/check_args.py
import copy
from typing import Any

from jsonschema import Draft202012Validator

from part03.weather_tool import WEATHER_TOOL


def check_args(tool: dict[str, Any], args: Any) -> list[str]:
    """用工具自己的 parameters 检查参数,返回错误列表;空列表表示合格。"""
    schema = tool["function"]["parameters"]
    validator = Draft202012Validator(schema)
    return [f"{'/'.join(map(str, e.path)) or '(整体)'}: {e.message}" for e in validator.iter_errors(args)]


if __name__ == "__main__":
    cases: list[object] = [
        {"city": "北京"},
        {"city": "北京", "unit": "fahrenheit"},
        {},
        {"city": 123},
        {"city": "北京", "unit": "kelvin"},
        {"city": "北京", "country": "CN"},
        ["北京"],
    ]
    for c in cases:
        print(f"{str(c):42} -> {check_args(WEATHER_TOOL, c) or '合格'}")

    # 默认允许多余的键;想挡住就在 schema 里加 additionalProperties: false
    strict = copy.deepcopy(WEATHER_TOOL)
    strict["function"]["parameters"]["additionalProperties"] = False
    print("加了 additionalProperties:false 之后:", check_args(strict, {"city": "北京", "country": "CN"}))
```

<div class="line-notes">

- `import copy` 下面要拷贝一份定义再改。
- `from jsonschema import Draft202012Validator` JSON Schema 2020-12 版的校验器类,[Day 148](/blog/agent-zero/day-148-structured-2/) 用过。
- `def check_args(tool: dict[str, Any], args: Any) -> list[str]:` 输入整份工具定义和模型给的参数,返回错误列表。`args` 标成 `Any` 是因为它从模型来,检查之前不能假定它是字典。
- `schema = tool["function"]["parameters"]` 取出 schema,就是发给模型的那一份。**同一份**,不是另外维护一份,这样不会两边不一致。
- `validator = Draft202012Validator(schema)` 用它造一个校验器。
- `return [f"{'/'.join(map(str, e.path)) or '(整体)'}: {e.message}" for e in validator.iter_errors(args)]` 一次返回**所有**错误,不是遇到第一个就停。`e.path` 是出错位置(比如 `city`),整体就出错时是空的,用 `or '(整体)'` 兜底;`e.message` 是 jsonschema 自己写的人话错误。
- `{"city": "北京"},` 第一个用例:合格。
- `{},` 缺必填的 `city`。
- `{"city": 123},` 类型不对。
- `{"city": "北京", "unit": "kelvin"},` 枚举之外的值。
- `{"city": "北京", "country": "CN"},` 多塞了 schema 里没写的参数。
- `["北京"],` 整体就不是对象。
- `strict = copy.deepcopy(WEATHER_TOOL)` 拷一份,下面要在拷贝上加一条规则,不能动原件。
- `strict["function"]["parameters"]["additionalProperties"] = False` 加 `additionalProperties: false`:schema 里没写的参数一律不收。

</div>

```bash
uv run python -m part03.check_args
```

我的输出:

```text
{'city': '北京'}                             -> 合格
{'city': '北京', 'unit': 'fahrenheit'}       -> 合格
{}                                         -> ["(整体): 'city' is a required property"]
{'city': 123}                              -> ["city: 123 is not of type 'string'"]
{'city': '北京', 'unit': 'kelvin'}           -> ["unit: 'kelvin' is not one of ['celsius', 'fahrenheit']"]
{'city': '北京', 'country': 'CN'}            -> 合格
['北京']                                     -> ["(整体): ['北京'] is not of type 'object'"]
加了 additionalProperties:false 之后: ["(整体): Additional properties are not allowed ('country' was unexpected)"]
```

注意第六行:`{'city': '北京', 'country': 'CN'}` **默认是合格的**。JSON Schema 的规则是「没禁止的就允许」,多出来的键不算错。这在工具调用里不安全:你的函数如果是 `get_weather(**args)` 这样展开,多出来的键会变成多出来的函数参数,轻则 `TypeError`,重则有人把一个你没打算开放的参数(比如 `timeout`、`debug`、`path`)也传了进去。所以**自己用的校验里默认加 `additionalProperties: false`**。明天把校验接进执行函数时,就是这么做的,你会看到一个真实的例子。

另外:OpenAI 和 DeepSeek 的 strict 模式要求你在 schema 里写 `additionalProperties: false` 并且把所有字段列进 `required`(2026 年 10 月查文档,Day 148 提过),DeepSeek 的 strict 还是 Beta。今天先不用它,记住有这回事就行,[Day 163](/blog/agent-zero/day-163-tool-choice/) 起会碰到相关的坑。

## 第七步:schema 不想手写,让 pydantic 生成

手写 schema 的毛病是容易和函数的真实签名脱节,字段改了名,schema 忘了改。Python 里更常见的做法是先写一个 pydantic 模型,再生成 schema(Day 149 学过 `model_json_schema()`)。新建 `part03/schema_from_model.py`:

```python
# agent-zero-lab/part03/schema_from_model.py
import json
from typing import Any, Literal

from pydantic import BaseModel, Field


class WeatherArgs(BaseModel):
    city: str = Field(description="城市名,中文或英文都行,例如 北京、Shanghai。只填城市,不要带省、国家或「市」字。")
    unit: Literal["celsius", "fahrenheit"] = Field(
        default="celsius", description="温度单位。用户没有特别说明就用 celsius。"
    )


def strip_titles(node: Any) -> Any:
    """pydantic 会给每个字段加 title(从字段名生成),模型用不上,递归删掉省 token。
    只删值是字符串的 title;一个字段如果恰好就叫 title,它的值是字典,要留着。"""
    if isinstance(node, dict):
        return {k: strip_titles(v) for k, v in node.items() if not (k == "title" and isinstance(v, str))}
    if isinstance(node, list):
        return [strip_titles(x) for x in node]
    return node


def tool_from_model(name: str, description: str, model: type[BaseModel]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": strip_titles(model.model_json_schema()),
        },
    }


if __name__ == "__main__":
    raw = WeatherArgs.model_json_schema()
    print("pydantic 原样生成:")
    print(json.dumps(raw, ensure_ascii=False, indent=2))
    tool = tool_from_model("get_weather", "查询一个城市当前的天气。", WeatherArgs)
    print("去掉 title 之后的 parameters:")
    print(json.dumps(tool["function"]["parameters"], ensure_ascii=False))
```

<div class="line-notes">

- `from typing import Any, Literal` `Literal["a", "b"]` 表示「只能是这几个字面值」,[Day 47](/blog/agent-zero/day-047-type-hints-3/) 学过,生成 schema 时会变成 `enum`。
- `from pydantic import BaseModel, Field` `BaseModel` 是模型基类,`Field` 给字段加描述和默认值([Day 52](/blog/agent-zero/day-052-pydantic-2/))。
- `class WeatherArgs(BaseModel):` 用一个类描述「参数长什么样」,相当于 TS 里先写 `interface` 再用 zod 生成 schema。
- `city: str = Field(description="城市名,中文或英文都行,` 没有默认值,所以是必填;`description` 就是模型要读的那句说明。
- `unit: Literal["celsius", "fahrenheit"] = Field(` 类型是字面值联合,会生成 `enum`;下面的 `default="celsius"` 让它变成可选。
- `def strip_titles(node: Any) -> Any:` pydantic 会给每个字段和整个对象加一个 `title`(从名字生成,比如 `City`),模型用不上,还多占 token。这个函数递归删掉它。
- `if isinstance(node, dict):` 字典就逐项处理。
- `return {k: strip_titles(v) for k, v in node.items() if not (k == "title" and isinstance(v, str))}` 字典推导式:只删「key 叫 title 且值是字符串」的项。**值是字符串**这个条件是留给一种情况:如果有个参数恰好就叫 `title`,它在 `properties` 里的值是字典,不能删。
- `if isinstance(node, list):` 列表就对每一项递归。
- `def tool_from_model(name: str, description: str, model: type[BaseModel]) -> dict[str, Any]:` 把「名字、描述、模型类」拼成一份完整的工具定义。`type[BaseModel]` 表示参数是个**类**,不是实例。
- `"parameters": strip_titles(model.model_json_schema()),` 先生成再去 title。
- `raw = WeatherArgs.model_json_schema()` 类方法,直接从类生成 schema 字典,不用先造实例。
- `print(json.dumps(raw, ensure_ascii=False, indent=2))` 缩进打印,方便读。
- `tool = tool_from_model("get_weather", "查询一个城市当前的天气。", WeatherArgs)` 拼出完整的工具定义。
- `print(json.dumps(tool["function"]["parameters"], ensure_ascii=False))` 去掉 title 之后压成一行打印。

</div>

```bash
uv run python -m part03.schema_from_model
```

我的输出:

```text
pydantic 原样生成:
{
  "properties": {
    "city": {
      "description": "城市名,中文或英文都行,例如 北京、Shanghai。只填城市,不要带省、国家或「市」字。",
      "title": "City",
      "type": "string"
    },
    "unit": {
      "default": "celsius",
      "description": "温度单位。用户没有特别说明就用 celsius。",
      "enum": [
        "celsius",
        "fahrenheit"
      ],
      "title": "Unit",
      "type": "string"
    }
  },
  "required": [
    "city"
  ],
  "title": "WeatherArgs",
  "type": "object"
}
去掉 title 之后的 parameters:
{"properties": {"city": {"description": "城市名,中文或英文都行,例如 北京、Shanghai。只填城市,不要带省、国家或「市」字。", "type": "string"}, "unit": {"default": "celsius", "description": "温度单位。用户没有特别说明就用 celsius。", "enum": ["celsius", "fahrenheit"], "type": "string"}}, "required": ["city"], "type": "object"}
```

和手写版几乎一样,多了每个字段的 `title`,以及 `unit` 上的 `"default": "celsius"`。`required` 是自动算出来的:只有没默认值的 `city`。好处是函数的参数模型只写一次,既生成发给模型的 schema,也能拿同一个类做 `model_validate` 校验([Day 52](/blog/agent-zero/day-052-pydantic-2/)),两边不会脱节。[Day 169](/blog/agent-zero/day-169-tool-registry-2/) 会更进一步,直接从函数签名生成。

### 零件对照

| 概念 | 今天的文件 | 以后哪天用 |
| --- | --- | --- |
| 一份认真写的工具定义 | `weather_tool.py` 的 `WEATHER_TOOL` | [Day 158](/blog/agent-zero/day-158-fc-first-run/) 接上真的天气函数 |
| 描述决定选哪个工具 | `ledger_variants.py`、`pick_ledger.py` | [Day 169](/blog/agent-zero/day-169-tool-registry-2/) 自动生成时,描述从函数的文档字符串来 |
| 参数的说明、枚举、「做不到就别调」 | `param_variants.py`、`pick_status.py` | 第三部分每个工具都用 |
| 本地二次检查 | `check_args.py` | 明天并进 `tool_runner.py` 的执行函数 |
| pydantic 生成 schema | `schema_from_model.py` | Day 169 的注册表 |
| 工具定义的 token 开销 | `token_cost.py` | 「工具太多怎么办」那几天 |

## 动手练习

三道题加起来约 20 次调用,不到 ¥0.02。

**练习 1:给「查发票」写一份工具定义,并写测试。** 工具叫 `get_invoice`,参数 `invoice_id`(必填,格式 `INV-年份-四位序号`,要有正则约束)和 `include_lines`(布尔,默认不返回明细行)。要求:工具描述写清楚「什么时候用、没编号时怎么办」;不允许多余参数;写成 pytest,至少测 2 个合格、6 个不合格的参数。再用四个问题问模型,看它填的参数能不能过自己的检查。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex157_invoice_tool.py
from typing import Any

from jsonschema import Draft202012Validator

INVOICE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_invoice",
        "description": "按编号查一张发票的金额、状态和开票日期。只在用户明确给出发票编号时使用;没给编号就先问用户。",
        "parameters": {
            "type": "object",
            "properties": {
                "invoice_id": {
                    "type": "string",
                    "pattern": r"^INV-\d{4}-\d{4}$",
                    "description": "发票编号,格式 INV-年份-四位序号,例如 INV-2026-0042。",
                },
                "include_lines": {
                    "type": "boolean",
                    "default": False,
                    "description": "要不要同时返回发票的明细行。用户没提明细就不要填 true。",
                },
            },
            "required": ["invoice_id"],
            "additionalProperties": False,
        },
    },
}


def errors(args: Any) -> list[str]:
    validator = Draft202012Validator(INVOICE_TOOL["function"]["parameters"])
    return [e.message for e in validator.iter_errors(args)]


if __name__ == "__main__":
    cases: list[object] = [
        {"invoice_id": "INV-2026-0042"},
        {"invoice_id": "INV-2026-0042", "include_lines": True},
        {"invoice_id": "inv-2026-42"},
        {"include_lines": True},
        {"invoice_id": "INV-2026-0042", "include_lines": "yes"},
        {"invoice_id": "INV-2026-0042", "customer": "ACME"},
    ]
    for c in cases:
        print(f"{str(c):58} -> {errors(c) or '合格'}")
```

<div class="line-notes">

- `from jsonschema import Draft202012Validator` 本地检查用。
- `INVOICE_TOOL: dict[str, Any] = {` 整份工具定义放在一个常量里,测试和问模型的脚本都 `import` 它。
- `"description": "按编号查一张发票的金额、状态和开票日期。` 做什么、返回什么,然后是触发条件和**没编号时的处理**:只在用户明确给出编号时使用,没给就先问。
- `"pattern": r"^INV-\d{4}-\d{4}$",` 正则:`INV-`、四位数字、`-`、四位数字。前面的 `r` 表示原始字符串,里面的反斜杠不被 Python 当转义字符处理。`^` 和 `$` 保证整个字符串都要匹配,而不是中间某一段。
- `"description": "发票编号,格式 INV-年份-四位序号,例如 INV-2026-0042。",` 正则是给你本地检查用的,**模型读的是这句说明**,所以格式要用人话再写一遍。
- `"type": "boolean",` 布尔类型,JSON 里是 `true` 或 `false`,Python 里是 `True` 或 `False`。
- `"default": False,` 默认值。注意写的是 Python 的 `False`,序列化成 JSON 时变成 `false`。
- `"description": "要不要同时返回发票的明细行。用户没提明细就不要填 true。",` 把「什么时候该填 true」写清楚,否则模型可能顺手都填 true,每次多返回一堆数据。
- `"required": ["invoice_id"],` 只有编号必填。
- `"additionalProperties": False,` 不收多余参数,第六步说过为什么。
- `def errors(args: Any) -> list[str]:` 返回错误信息列表,空表示合格。
- `return [e.message for e in validator.iter_errors(args)]` 这里只取 `message`,不带位置。
- `{"invoice_id": "inv-2026-42"},` 小写加序号只有两位,正则不匹配。
- `{"include_lines": True},` 缺必填的 `invoice_id`。
- `{"invoice_id": "INV-2026-0042", "include_lines": "yes"},` 布尔字段给了字符串。
- `{"invoice_id": "INV-2026-0042", "customer": "ACME"},` 多了一个 `customer`,被 `additionalProperties: false` 挡住。

</div>

```bash
uv run python -m part03.ex157_invoice_tool
```

```text
{'invoice_id': 'INV-2026-0042'}                            -> 合格
{'invoice_id': 'INV-2026-0042', 'include_lines': True}     -> 合格
{'invoice_id': 'inv-2026-42'}                              -> ["'inv-2026-42' does not match '^INV-\\\\d{4}-\\\\d{4}$'"]
{'include_lines': True}                                    -> ["'invoice_id' is a required property"]
{'invoice_id': 'INV-2026-0042', 'include_lines': 'yes'}    -> ["'yes' is not of type 'boolean'"]
{'invoice_id': 'INV-2026-0042', 'customer': 'ACME'}        -> ["Additional properties are not allowed ('customer' was unexpected)"]
```

(正则那行的反斜杠显示成四个,是因为错误信息整个被 `repr` 了一遍,又被列表的 `repr` 转义一遍,本身没毛病。)写成测试:

```python
# agent-zero-lab/tests/test_ex157_invoice_tool.py
import pytest

from part03.ex157_invoice_tool import errors


@pytest.mark.parametrize(
    "args",
    [
        {"invoice_id": "INV-2026-0042"},
        {"invoice_id": "INV-2026-0042", "include_lines": True},
    ],
)
def test_good_args_pass(args: object) -> None:
    assert errors(args) == []


@pytest.mark.parametrize(
    "args",
    [
        {"invoice_id": "inv-2026-42"},
        {"include_lines": True},
        {"invoice_id": "INV-2026-0042", "include_lines": "yes"},
        {"invoice_id": "INV-2026-0042", "customer": "ACME"},
        {},
        "INV-2026-0042",
    ],
)
def test_bad_args_rejected(args: object) -> None:
    assert errors(args) != []
```

<div class="line-notes">

- `import pytest` 用它的 `parametrize` 装饰器。
- `from part03.ex157_invoice_tool import errors` 测的就是上面那个函数。
- `@pytest.mark.parametrize(` 同一个测试函数换不同参数跑多次,每组算一条用例。
- `def test_good_args_pass(args: object) -> None:` 参数名 `args` 要和 `parametrize` 第一个参数的名字一致,pytest 靠名字把值传进来。
- `assert errors(args) == []` 合格的参数没有任何错误。
- `{"invoice_id": "INV-2026-0042", "customer": "ACME"},` 多余参数的用例,和上面脚本里同一条。
- `"INV-2026-0042",` 整个参数是个字符串(不是对象),也要被拒绝。
- `assert errors(args) != []` 不合格的必须至少有一个错误。

</div>

```bash
uv run pytest -q tests/test_ex157_invoice_tool.py
```

```text
........                                                                 [100%]
8 passed in 0.08s
```

再让模型填一次。新建 `part03/ex157_invoice_ask.py`:

```python
# agent-zero-lab/part03/ex157_invoice_ask.py
import json

from common.llm import LLMClient
from part03.ex157_invoice_tool import INVOICE_TOOL, errors

QUESTIONS = [
    "INV-2026-0042 付了吗?",
    "把 INV-2026-0042 的明细行也给我看看",
    "查一下发票 inv-2026-42",
    "我那张发票多少钱?",
]

client = LLMClient()
for q in QUESTIONS:
    r = client.chat(
        [{"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"}, {"role": "user", "content": q}],
        tools=[INVOICE_TOOL],
        temperature=0,
        max_tokens=150,
    )
    calls = r.message.get("tool_calls", [])
    print(f"问:{q}")
    if not calls:
        print(f"  没调用,模型说:{r.content[:40]!r}")
    for c in calls:
        args = json.loads(c["function"]["arguments"])
        print(f"  参数 {args} -> 检查:{errors(args) or '合格'}")
```

<div class="line-notes">

- `from part03.ex157_invoice_tool import INVOICE_TOOL, errors` 复用上面的定义和检查函数。
- `"查一下发票 inv-2026-42",` 编号写成小写、序号只有两位,看模型会不会照抄。
- `"我那张发票多少钱?",` 完全没给编号,看是追问还是编。
- `print(f"  没调用,模型说:{r.content[:40]!r}")` 没有请求就打印模型说的话的开头。
- `print(f"  参数 {args} -> 检查:{errors(args) or '合格'}")` 模型填什么就当场检查一遍,`or` 在 `errors` 返回空列表(为假)时给出 `'合格'`。

</div>

```bash
uv run python -m part03.ex157_invoice_ask
```

```text
问:INV-2026-0042 付了吗?
  参数 {'invoice_id': 'INV-2026-0042'} -> 检查:合格
问:把 INV-2026-0042 的明细行也给我看看
  参数 {'invoice_id': 'INV-2026-0042', 'include_lines': True} -> 检查:合格
问:查一下发票 inv-2026-42
  参数 {'invoice_id': 'INV-2026-0042'} -> 检查:合格
问:我那张发票多少钱?
  没调用,模型说:'请问发票编号是多少?格式是 INV-年份-四位序号,例如 INV-2026-00'
```

第三个问题有点出人意料:用户写的是 `inv-2026-42`,模型传出来的是 `INV-2026-0042`,**自己把格式规范化了**。这是参数说明里那句「格式 INV-年份-四位序号」起的作用。第四个问题没给编号,它追问了,而且追问里直接复述了格式。到这里这份定义算是写到位了。

</details>

**练习 2:把 `vague` 的 3/12 改到 12/12。** 只改两个描述的文字(不动名字和参数),让 `ledger_v1`、`ledger_v2` 在同样 4 个问题、每个 3 次的测试里全部选对。改完说说你改了哪几处。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex157_rewrite.py
from typing import Any

from common.llm import LLMClient
from part03.ledger_variants import PARAMS
from part03.pick_ledger import CASES  # 同样的四个问题

# 改写后的两句描述:先说返回什么,再说什么时候用,最后说明和另一个工具的分工
NEW_DESCS = {
    "ledger_v1": "返回流水明细:该客户该月每一笔收款一行。想看具体每笔时用它;只问合计金额时用 ledger_v2。",
    "ledger_v2": "返回月度合计:该客户该月收款的总金额,一个数字。问「一共」「总共」「合计」时用它;要看每一笔时用 ledger_v1。",
}
tools: list[dict[str, Any]] = [
    {"type": "function", "function": {"name": n, "description": d, "parameters": PARAMS}} for n, d in NEW_DESCS.items()
]

client = LLMClient()
right = 0
for q, want in CASES:
    for _ in range(3):
        r = client.chat(
            [{"role": "system", "content": "你是云簿 CloudLedger 的客服助手。"}, {"role": "user", "content": q}],
            tools=tools,
            temperature=0,
            max_tokens=150,
        )
        calls = r.message.get("tool_calls", [])
        got = calls[0]["function"]["name"] if calls else "(没调用)"
        right += got == want
print(f"改写后选对 {right}/{len(CASES) * 3}")
```

<div class="line-notes">

- `from part03.pick_ledger import CASES  # 同样的四个问题` 直接导入上一步的用例。因为 `pick_ledger.py` 的实验放在 `main()` 里,这样导入不会把整段实验再跑一遍(没这么做的话会多花 ¥0.07)。
- `NEW_DESCS = {` 两句新描述。
- `"ledger_v1": "返回流水明细` 先说返回什么(明细,每笔一行),再说什么时候用(想看具体每笔),最后一句「只问合计金额时用 ledger_v2」**点名了近亲**。两个描述互相指路,模型就不用猜。
- `"ledger_v2": "返回月度合计` 「一个数字」是个很具体的边界,和「每笔一行」对着说;触发词用的是用户的口语(「一共」「总共」「合计」),最后一句反过来指向 ledger_v1。
- `{"type": "function", "function": {"name": n, "description": d, "parameters": PARAMS}} for n, d in NEW_DESCS.items()` 列表推导式,按字典里的名字和描述各拼一个工具。
- `right += got == want` 选对加一。
- `print(f"改写后选对 {right}/{len(CASES) * 3}")` 总数 12。

</div>

```bash
uv run python -m part03.ex157_rewrite
```

```text
改写后选对 12/12
```

我改的三处:①每句话都以「返回什么」开头,把粒度(每笔一行、一个数字)写出来;②触发词用用户的口语(「一共」「总共」「每一笔」),不用内部术语;③两个描述互相点名,告诉模型「不是我就去找它」。要提醒一句:12/12 是 12 次调用的结果,不是统计意义上的「一定对」,工具一多、近亲一多,还得靠评测集持续量,那是第六部分的事。

</details>

**练习 3:让 pydantic 生成的 schema 和手写的对齐。** 写一个 pytest,断言 `WeatherArgs` 生成的 `parameters`(去掉 title 之后)和 `WEATHER_TOOL` 里手写的 `parameters` 完全相等。先让它红,看清差在哪,再修到绿,并说明你选择怎么修、为什么。

<details><summary>参考答案</summary>

第一版测试直接比较:

```python
# agent-zero-lab/tests/test_schema_from_model.py(第一版,红)
from part03.schema_from_model import WeatherArgs, strip_titles
from part03.weather_tool import WEATHER_TOOL


def test_generated_schema_matches_hand_written() -> None:
    generated = strip_titles(WeatherArgs.model_json_schema())
    hand = WEATHER_TOOL["function"]["parameters"]
    assert generated == hand
```

```bash
uv run pytest -q tests/test_schema_from_model.py
```

输出里关键的一段(pytest 把两边的差别并排打了出来;省略号是我为了缩短手动删的):

```text
E         Differing items:
E         {'properties': {'city': {'description': '城市名,中文或英文都行,……', 'type': 'string'}, 'unit': {'default': 'celsius', 'description': '温度单位。用户没有特别说明就用 celsius。', 'enum': ['celsius', 'fahrenheit'], 'type': 'string'}}} != {'properties': {'city': {'type': 'string', 'description': '城市名,……'}, 'unit': {'type': 'string', 'enum': ['celsius', 'fahrenheit'], 'description': '温度单位。用户没有特别说明就用 celsius。'}}}
FAILED tests/test_schema_from_model.py::test_generated_schema_matches_hand_written
1 failed in 0.18s
```

肉眼比一遍:key 的顺序不同不影响(字典相等不看顺序),真正的差别只有一处,生成版的 `unit` 多了 `'default': 'celsius'`。这一处是 pydantic 额外给的。修法有两个:把 `"default": "celsius"` 补进手写版,或者比较之前去掉它。我选后者,理由是手写版已经在描述里写了「用户没有特别说明就用 celsius」,默认值模型已经读到了,不想为了让测试好看去改被其他天依赖的 `weather_tool.py`:

```python
# agent-zero-lab/tests/test_schema_from_model.py
from part03.schema_from_model import WeatherArgs, strip_titles
from part03.weather_tool import WEATHER_TOOL


def test_generated_schema_matches_hand_written() -> None:
    generated = strip_titles(WeatherArgs.model_json_schema())
    # pydantic 额外写了 "default": "celsius";手写版把默认值写在 description 里,这里先去掉再比
    generated["properties"]["unit"].pop("default")
    hand = WEATHER_TOOL["function"]["parameters"]
    assert generated == hand
```

<div class="line-notes">

- `generated = strip_titles(WeatherArgs.model_json_schema())` 先生成再去 title,和 `tool_from_model` 里是同一个做法。
- `generated["properties"]["unit"].pop("default")` 去掉那一处已知的差别。注释里写明原因:以后有人看到这行,知道不是随手糊弄。
- `hand = WEATHER_TOOL["function"]["parameters"]` 手写版的参数部分。
- `assert generated == hand` 字典相等不看 key 的顺序。

</div>

```bash
uv run pytest -q tests/test_schema_from_model.py
```

```text
.                                                                        [100%]
1 passed in 0.12s
```

这个测试以后有价值:谁改了手写的 `WEATHER_TOOL` 或 `WeatherArgs` 其中一边、忘了另一边,它会变红。

</details>

**验收标准:** 能画出「定义三块 → 模型三个决定」的对应关系;能解释为什么 `no_desc` 会一边倒选第一个工具,以及 `swapped` 为什么 0/12;能说出枚举管得住什么、管不住什么,以及「做不到就别调」该写在哪;知道相对时间必须配今天的日期;`check_args.py` 和练习 1 的 8 个测试全过。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 工具定义 | `tools` 列表里的一项:`name`、`description`、`parameters` 三块,服务端会把它渲染成文字放进提示词,模型读的是这段文字 |
| `name` | 工具的名字,模型回请求时写的就是它,你的分发表要和它一字不差。Anthropic 的文档要求匹配 `^[a-zA-Z0-9_-]{1,128}$` |
| `description` | 一段写给模型看的话:做什么、返回什么、什么时候用、什么时候不用。模型选工具主要看它 |
| `parameters` | 参数的 JSON Schema,最外层固定是 `"type": "object"`,模型填的参数就是一个符合它的 JSON 对象 |
| 参数说明 | `parameters` 里每个字段自己的 `description`,管格式、例子、默认值,影响模型填什么值 |
| 枚举(`enum`) | 字段只能取列表里的某一个值。约束的是**词汇**,不是**意图** |
| `required` | 必填字段名列表。模型会知道它必须有,但缺信息时是追问还是瞎填取决于模型,不是强制 |
| `additionalProperties` | schema 里没写的字段允不允许出现。JSON Schema 默认允许,工具参数里建议显式设成 `false` |
| 近亲工具 | 功能相近、容易选混的两个工具(比如明细和合计)。描述里要互相点名,告诉模型何时选哪个 |
| 工具定义的固定开销 | 一份最小的工具定义也要占 254 个输入 token(实测),描述和参数说明是在它上面再加 |
| 相对时间 | 「上个月」「昨天」这类要靠今天的日期才能算出来的说法;模型没有时钟,要把日期写进提示词 |
| `jsonschema` | Python 的 JSON Schema 校验库,用同一份 schema 在本地检查模型给的参数 |

## 常见误区

**以为描述是给同事看的注释。** 它是提示词。「查询发票」对同事够了,对模型不够:它要知道返回什么、什么时候选你、什么时候别选你。`ledger_v1/v2` 的实验里,描述含糊时选对率是 3/12。

**名字起得很好就不用写描述。** 名字区分得开时确实可以(第一组实验四个版本全 12/12),区分不开时名字没用,而且**描述和名字矛盾比没有描述更糟**,`swapped` 版是 0/12。改了函数行为不改描述,是线上最常见的来源。

**看到模型总是只用一个工具,就怪模型笨。** 那是 `no_desc` 的特征:一边倒选第一个。先查描述。

**在参数说明里写一个具体的例子,以为只是示范。** 例子会被当成默认值抄。月份说明里写「例如 2026-10」,模型把「上个月」都填成了 `2026-10`。

**以为有了 `enum` 就不会出错。** 它管住了词汇,没管住意图:用户要「作废」的发票,模型没有发明新状态,而是把 `status` 整个省掉,查回了所有发票,而且没有报错。要把「条件不在这几种里就别调用、告诉用户做不到」写进工具描述。

**以为 `required` 是强制的。** 它只是告诉模型;强制要靠你本地校验。今天测的模型缺编号时都会追问,小模型不一定。

**参数里有「上个月」「昨天」却不告诉模型今天几号。** 模型没有时钟,会猜。`bare / 无日期` 里「九月」被写成 `2025-09`,「上个月」被写成字面量 `last_month`。

**校验用的 schema 和发给模型的不是同一份。** 两份总会慢慢脱节。从同一个来源生成(手写一份常量,或者 pydantic 模型),本地检查和发给模型的用同一个对象。

**忘了 JSON Schema 默认允许多余的参数。** `{'city': '北京', 'country': 'CN'}` 默认合格。你的函数如果是 `**args` 展开,多余的键就是多余的函数参数。本地检查时显式加 `additionalProperties: false`。

**把 pydantic 生成的 `title` 也发给模型。** 它不影响正确性,但每个字段多几个 token,而且没有信息量,去掉。

## 学习资料

### 文档与文章

- [Anthropic 文档:Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools):英文,专门讲怎么写工具定义。看「Best practices for tool definitions」那一节:要求每个工具描述至少三四句、写清「什么时候用、什么时候不用」,还讲了命名空间和合并近亲工具。今天实验的结论和它完全吻合。
- [Anthropic:Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):英文,Anthropic 工程团队的文章,讲工具描述的小改动能带来多大的效果差异,参数命名(用 `user_id` 而不是 `user`)。昨天推荐过,今天回头读前半部分。
- [DeepSeek 文档:Tool Calls](https://api-docs.deepseek.com/zh-cn/guides/tool_calls):中文,看工具定义的格式和 strict 模式(Beta)的要求。
- [OpenAI 文档:Function calling](https://platform.openai.com/docs/guides/function-calling):英文,看工具定义字段的说明和 strict 模式的限制。
- [Understanding JSON Schema](https://json-schema.org/understanding-json-schema):英文,JSON Schema 官方入门,今天用到的 `type`、`properties`、`required`、`enum`、`pattern`、`additionalProperties` 都在里面。
- [python-jsonschema 文档](https://python-jsonschema.readthedocs.io/en/stable/):英文,`Draft202012Validator`、`iter_errors` 的用法。
- [pydantic 文档:JSON Schema](https://docs.pydantic.dev/latest/concepts/json_schema/):英文,`model_json_schema()` 能生成什么、怎么自定义。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ymrCBeESA&autoplay=0&high_quality=1" title="【Agent入门】3.工具调用实现原理" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>花里胡哨的汤无际 · 【Agent入门】3.工具调用实现原理 · 39 分钟,2026 年 1 月。系列课的第三集,讲工具调用怎么实现。时间长,不要求一口气看完,可以对照今天的「模型到底看到了什么」那一节,看它怎么描述工具被提供给模型的那一步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12rDYBcErz&autoplay=0&high_quality=1" title="面试官:如何保证 Agent 调用工具 (Function Calling) 的 可靠性?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵AI大模型 · 面试官:如何保证 Agent 调用工具 (Function Calling) 的 可靠性? · 3 分 48 秒,2026 年 4 月。短,面试口径的回答。看完对照今天的结论:描述写清楚、参数加约束、本地二次检查,看它讲到了哪几条。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/dtLl37W68g8" title="An Introduction to JSON Schema: A Practical Look" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Erik Wilde · An Introduction to JSON Schema: A Practical Look · 英文。JSON Schema 的实用入门,Day 95 和 Day 148 学过的关键字再过一遍,今天的工具定义里的 `parameters` 就是它。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/uhJJgc-0iTQ" title="Building more effective AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Building more effective AI agents · 英文。昨天推荐过。今天回头看,留意它怎么谈「给 Agent 的工具」这件事,和今天的描述写法对一下。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering: Building Applications with Foundation Models》(O'Reilly,2025):英文,书里 Agent 那一章讲工具,提到工具的描述和参数设计会明显影响模型的表现。[出版社页面](https://www.oreilly.com/library/view/ai-engineering/9781098166298/)(对爬虫返回 403,需浏览器打开)。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):我们一直在用的 SDK,可以在仓库里搜 `tools` 看类型定义里工具的字段。
- [python-jsonschema/jsonschema](https://github.com/python-jsonschema/jsonschema):今天用的校验库,`README` 里有最短的例子。

## 自测

1. 一份工具定义的三块内容,各自主要影响模型的哪个决定?

<details><summary>答案</summary>

`name` 和 `description` 主要影响「要不要调、调哪个」;`parameters`(每个字段的 `description`、`enum`、格式、`required`)影响「参数填什么值、缺信息时怎么办」。三块都是被渲染成文字读给模型的,没有任何一块是程序在强制。

</details>

2. 今天的实验里,`no_desc` 版本为什么「不管问什么都选 `ledger_v1`」?

<details><summary>答案</summary>

两个工具参数一模一样、名字又是历史遗留的 v1/v2,模型没有任何依据区分,就选了列表里排第一的。选择一边倒(12 次全是同一个)是描述缺失的典型症状,选对的 6 次只是因为期望刚好是 v1。

</details>

3. `swapped` 版本把两个工具的描述对调,结果 0/12,说明了什么?

<details><summary>答案</summary>

模型信的是描述,不是名字。名字叫 `ledger_v1`、描述却在说「只返回合计」,问到「一共多少」它就选了描述写着合计的那个,和名字对应的功能正好相反。所以改了函数行为必须同步改描述,描述和实际不符比没有描述更糟。

</details>

4. 用户问「ACME 作废的发票」,工具的 `status` 枚举只有三个值,模型实测怎么做的?怎么才能让它停下来告诉用户做不到?

<details><summary>答案</summary>

只有枚举时,模型没有发明新值,而是把 `status` 整个省略,调用等于查了全部发票,用户得到不相关的结果还不报错。要在工具描述里明确写「状态只支持 A、B、C;用户要的条件不在其中时不要调用本工具,直接告诉用户做不到」,加上之后实测三次都没有调用,模型直接回答用户做不到。

</details>

5. 面试题:「怎么写一份让模型用得好的工具定义?」

<details><summary>答案</summary>

把它当提示词来写。工具描述要回答:做什么、返回什么(含粒度)、什么时候用(用用户会说的话)、什么时候不用及边界、有近亲工具时互相点名。参数要写格式和例子(注意例子会被当样板抄),有限取值用 `enum` 约束词汇,可选和必填分清,「条件不满足就别调用」写进描述。凡涉及相对时间的参数,要把当前日期放进提示词。实际写完要拿一批代表性问题测选择率和参数正确率,而不是看着觉得好。最后,因为模型不一定遵守,调用前要用同一份 schema 在本地校验,并显式禁止多余参数。

</details>

6. 面试题:「工具定义对成本和延迟有什么影响?」

<details><summary>答案</summary>

工具定义是输入提示词的一部分,每次请求都要带,按输入 token 计费,也增加首 token 前的处理时间。实测一个最小的工具有约 254 个 token 的固定开销,认真写的描述和参数说明再加约 90 个。工具数量多时开销线性增长(估算),并且工具越多模型越容易选混。缓解办法:工具定义保持稳定的内容和顺序,让前缀缓存命中;工具特别多时用工具检索只放相关的几个;合并功能相近的工具。

</details>

## 明天预告

Day 158 · 第一次跑通:让模型查天气。今天的工具都只是「描述」,没有一个真的被执行。明天把 `WEATHER_TOOL` 接上一个真的天气函数(Open-Meteo,免费、不用 key):模型提出请求,我们用 `json.loads` 解析 `arguments`,用今天写的 schema 本地检查,然后真的去查,拿到结果。还会故意制造几个会出现的事故:模型的参数被 `max_tokens` 截断导致 JSON 不完整、模型多塞了一个参数、城市不存在、天气服务超时。明天的结尾,查到的结果还留在我们的程序里,模型还没看见它,这一步留到 Day 159。
