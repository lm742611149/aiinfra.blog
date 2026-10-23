---
title: 'Day 161 · 漏回 tool 消息会怎样'
description: '模型一次提了几个工具请求,每一个都必须得到一条 tool 消息,少一条整个请求就是 400(insufficient tool messages)。今天用 9 种缺法实测服务端的反应:漏哪一个都一样,顺序可以乱,重复 id 是另一种错,悄悄把 assistant 消息改小能骗过服务端但模型会重新提请求;再看四种「悄悄漏回」的真实写法(只取第一个、失败就 continue、没登记的名字被过滤、遇错就 break),以及已经漏了怎么办:把悬空的请求补一条「没有执行」的 tool 消息。'
pubDate: 2026-10-23
regime: none
tags: ['function-calling', 'tool-use', 'messages', 'agent-zero']
series: 'agent-zero'
day: 161
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 160](/blog/agent-zero/day-160-week23-review/) 是第 23 周的复习日:默写了 `execute_call` 和 `two_rounds`,复现了本周八个坑,做了发票客服小项目。小项目第一版有一道题失败,原因是工具抛了异常、`execute_call` 把它变成一句含糊的「错误」,模型把内部异常名说给了用户。复习里还有一个没展开的细节:[Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 的实验一、二故意写错 `tool_call_id`,拿到的是服务端点名指出「哪个 id 没有回应」的 400。

今天专门讲这个 400 的另一种长相:**模型一次提了好几个请求,我们少回了一条**。它不是你写错了某个字段,而是你的代码在某个地方悄悄漏掉了一个请求。这类 bug 在只有一个工具请求时永远不会出现,等模型开始一次提两三个请求,它才冒出来,而且往往是在线上。

## 今天要解决的问题

学完今天你应该能做到:

1. 说出「每个请求必须有一条 tool 消息回应」这条规矩的细节:漏哪一个都不行、顺序可以乱、重复 id 不行、中间不能插别的消息。并认得出对应的 400 报错原文。
2. 认出四种最常见的「悄悄漏回」写法,并能用 Day 159 的 `check_messages` 在发请求之前抓住它们,报错里要点出缺的是哪几个 id。
3. 写出两样防御:一个**保证每个请求都回一条**的 `answer_all`,和一个给已经漏了的历史**补齐**的 `close_dangling`。

今天有两个新概念:**每个请求必须有回应**(服务端怎么检查它),和**悬空请求**(dangling:已经提出、永远没有得到回应的请求,以及怎么收拾)。

预计用时:2.5 小时,实跑花费约 ¥0.03(算式在文末)。前置:[Day 159](/blog/agent-zero/day-159-tool-roundtrip/)(`tool` 消息、`tool_call_id`、`check_messages`)、[Day 160](/blog/agent-zero/day-160-week23-review/)(`dictation160.py`、`review160_check.py` 里的假客户端 `FakeClient` 和 `call_of`、`invoice_data.py`、`sessions_tools.py`)、[Day 158](/blog/agent-zero/day-158-fc-first-run/)(`execute_call`、`weather_api.py`)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `close_dangling` 的主循环(紧跟着的 tool 消息收起来、没回应的补上);再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

今天的实验和前几天一样的边界:天气函数只查 Open-Meteo,发票函数只读代码里写死的三张虚构发票,不读写任何文件(练习 3 的会话文件放在系统临时目录),不执行任何模型给的字符串。

## 规矩长什么样

先看图,这是今天所有实验的对照:

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="一条 assistant 消息提了三个请求 c1 c2 c3,后面跟的 tool 消息有四种情况:三条齐全返回 200,漏了 c2 返回 400,顺序打乱仍然返回 200,c2 重复返回 400">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">assistant 提了三个请求 c1 c2 c3,后面的 tool 消息一个都不能少</text>
<rect x="20" y="44" width="130" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="68" fill="var(--ink)">assistant c1 c2 c3</text>
<rect x="170" y="44" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="180" y="68" fill="var(--ink)">tool c1</text>
<rect x="270" y="44" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="280" y="68" fill="var(--ink)">tool c2</text>
<rect x="370" y="44" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="380" y="68" fill="var(--ink)">tool c3</text>
<text x="490" y="68" fill="var(--ink)">→ 200</text>
<rect x="20" y="104" width="130" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="128" fill="var(--ink)">assistant c1 c2 c3</text>
<rect x="170" y="104" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="180" y="128" fill="var(--ink)">tool c1</text>
<rect x="270" y="104" width="90" height="40" rx="4" fill="none" stroke="var(--ink-faint)" stroke-dasharray="4 3"/>
<text x="280" y="128" fill="var(--ink-faint)">(漏了)</text>
<rect x="370" y="104" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="380" y="128" fill="var(--ink)">tool c3</text>
<text x="490" y="128" fill="var(--ink)">→ 400</text>
<rect x="20" y="164" width="130" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="188" fill="var(--ink)">assistant c1 c2 c3</text>
<rect x="170" y="164" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="180" y="188" fill="var(--ink)">tool c3</text>
<rect x="270" y="164" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="280" y="188" fill="var(--ink)">tool c1</text>
<rect x="370" y="164" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="380" y="188" fill="var(--ink)">tool c2</text>
<text x="490" y="188" fill="var(--ink)">→ 200 顺序不限</text>
<rect x="20" y="224" width="130" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="248" fill="var(--ink)">assistant c1 c2 c3</text>
<rect x="170" y="224" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="180" y="248" fill="var(--ink)">tool c1</text>
<rect x="270" y="224" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="280" y="248" fill="var(--ink)">tool c2</text>
<rect x="370" y="224" width="90" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="380" y="248" fill="var(--ink)">tool c2</text>
<text x="490" y="248" fill="var(--ink)">→ 400 重复</text>
<text x="20" y="296" fill="var(--ink-faint)" font-size="11">规矩:每个 id 恰好一条;中间不能插别的角色;顺序不限</text>
<text x="20" y="314" fill="var(--ink-faint)" font-size="11">c3 没被回应和 c2 没被回应,服务端的报错是同一句,它不告诉你缺的是谁</text>
</g>
</svg>
<figcaption>四行是今天实测过的四种情形。漏的位置不同,报错一样;所以要自己在本地数,而不是等服务端告诉你缺了哪个。</figcaption>
</figure>

规矩一句话:**assistant 消息里有几个请求,紧跟着就必须有几条 tool 消息,每个请求的 id 恰好出现一次。**今天一一实测。

## 第一步:九种缺法,服务端怎么说

两个请求要靠模型自己提出来。先问「北京和上海现在哪个更热?」确认它一次提两个:我连问了三次,每次都是 `get_weather(北京)` 和 `get_weather(上海)` 两个请求,同时出现,id 是 `call_00_…` 和 `call_01_…`(`00`、`01` 是 DeepSeek 给的序号)。再问「北京、上海、广州各多少度」,三次都是三个请求。

新建 `part03/missing_result.py`,对同一份第一次回复,造出九种第二次请求:

```python
# agent-zero-lab/part03/missing_result.py
import copy
import re
from typing import Any

import openai

from common.llm import LLMClient
from part03.tool_runner import execute_call
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]
client = LLMClient(max_retries=0)  # 400 重试一百遍也一样,别白等

base: list[dict[str, Any]] = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
    {"role": "user", "content": "北京和上海现在哪个更热?"},
]
first = client.chat(base, tools=TOOLS, temperature=0, max_tokens=300)
calls = first.message.get("tool_calls") or []
if len(calls) != 2:
    raise SystemExit(f"这个实验要模型一次提 2 个请求,这次是 {len(calls)} 个,重跑一次")

c1, c2 = calls
print("模型这次提的两个请求:", [(c["id"][:12] + "…", c["function"]["arguments"]) for c in calls])


def tool_msg(call: dict[str, Any]) -> dict[str, Any]:
    return {"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS)}


def try_send(label: str, messages: list[dict[str, Any]]) -> None:
    try:
        r = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=150)
        again = [c["function"]["arguments"] for c in r.message.get("tool_calls") or []]
        shown = f"又提了请求 {again}" if again else f"回答:{r.content.replace(chr(10), ' ')[:60]}"
        print(f"{label}\n    HTTP 200 {shown}")
    except openai.APIStatusError as e:
        body: Any = e.body or {}
        msg = re.sub(r" \(request_id: [^)]*\)", "", str(body.get("message", e.message)))
        print(f"{label}\n    HTTP {e.status_code} {msg}")


m1, m2 = tool_msg(c1), tool_msg(c2)
try_send("A. 两个都回(对照)", [*base, first.message, m1, m2])
try_send("B. 只回第一个", [*base, first.message, m1])
try_send("C. 只回第二个", [*base, first.message, m2])
try_send("D. 一个都不回,直接接用户的下一句", [*base, first.message, {"role": "user", "content": "快点"}])
try_send("E. 两个都回,但顺序反过来", [*base, first.message, m2, m1])
try_send("F. 第二条的 id 抄成了第一个", [*base, first.message, m1, {**m2, "tool_call_id": c1["id"]}])
try_send("G. 回了两个,中间插了一句用户的话", [*base, first.message, m1, {"role": "user", "content": "快点"}, m2])

shrunk = copy.deepcopy(first.message)
shrunk["tool_calls"] = shrunk["tool_calls"][:1]  # 把 assistant 消息里的第二个请求直接删掉
try_send("H. 悄悄把 assistant 消息改小:只留第一个请求,也只回第一个", [*base, shrunk, m1])
try_send("I. 历史以带请求的 assistant 消息结尾,后面什么都没有", [*base, first.message])
print(client.ledger)
```

<div class="line-notes">

- `import copy` 深拷贝 assistant 消息,最后一个实验要改它的 `tool_calls` 又不能动原件。
- `import re` 去掉报错里每次都不同的 `request_id`。
- `import openai` 捕获 `openai.APIStatusError`(服务端回了非 2xx)。
- `from part03.tool_runner import execute_call` Day 158 的执行函数,拼 tool 消息用。
- `client = LLMClient(max_retries=0)  # 400 重试一百遍也一样,别白等` 参数错误不会因为重试变对,关掉自动重试。
- `first = client.chat(base, tools=TOOLS, temperature=0, max_tokens=300)` 请求 1。`max_tokens` 给 300,因为一次要写两个请求,200 可能被截断(Day 158)。
- `calls = first.message.get("tool_calls") or []` 取出请求。
- `if len(calls) != 2:` 这个实验的前提是模型提了两个。偶尔只提一个的话,后面的实验没意义。
- `raise SystemExit(f"这个实验要模型一次提 2 个请求,这次是 {len(calls)} 个,重跑一次")` `SystemExit` 打印这句话然后结束程序,不打一大段 traceback。
- `c1, c2 = calls` 列表解包,正好两个。`c1` 是北京(id 以 `call_00_` 开头),`c2` 是上海。
- `print("模型这次提的两个请求:", [(c["id"][:12] + "…", c["function"]["arguments"]) for c in calls])` 实测 `call_00_veot…` 对 `{"city": "北京"}`,`call_01_lXqJ…` 对 `{"city": "上海"}`。
- `def tool_msg(call: dict[str, Any]) -> dict[str, Any]:` 给一个请求造一条 tool 消息:真的执行,结果放进去。
- `return {"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS)}` 三个字段,和 Day 159 一样。
- `def try_send(label: str, messages: list[dict[str, Any]]) -> None:` 发一次,200 就打印回答,非 2xx 就打印状态码和原文。
- `again = [c["function"]["arguments"] for c in r.message.get("tool_calls") or []]` 200 的时候也要看一眼:模型是回答了,还是又提了新的请求。
- `shown = f"又提了请求 {again}" if again else f"回答:{r.content.replace(chr(10), ' ')[:60]}"` 有新请求就显示请求,否则显示回答前 60 个字。
- `msg = re.sub(r" \(request_id: [^)]*\)", "", str(body.get("message", e.message)))` 报错正文,去掉结尾的 `(request_id: …)`。
- `m1, m2 = tool_msg(c1), tool_msg(c2)` 先把两条正确的 tool 消息造好,下面的实验只是把它们拿掉、换位置或改坏。
- `try_send("A. 两个都回(对照)", [*base, first.message, m1, m2])` 对照组:`[*base, ...]` 是列表展开,相当于 JS 的 `[...base, msg, m1, m2]`。
- `try_send("B. 只回第一个", [*base, first.message, m1])` 漏了上海。
- `try_send("C. 只回第二个", [*base, first.message, m2])` 漏了北京。
- `try_send("D. 一个都不回,直接接用户的下一句"` 两个都没回,后面直接是一条 user 消息:模拟「程序在执行工具时崩了,用户等不及又问了一句」。
- `try_send("E. 两个都回,但顺序反过来", [*base, first.message, m2, m1])` 先放上海再放北京。
- `{**m2, "tool_call_id": c1["id"]}` 字典展开后覆盖一个字段:第二条 tool 消息的 id 也写成北京的,于是北京回了两条、上海一条都没有。
- `try_send("G. 回了两个,中间插了一句用户的话", [*base, first.message, m1, {"role": "user", "content": "快点"}, m2])` 两个都回了,但中间被插了一条别的消息。
- `shrunk["tool_calls"] = shrunk["tool_calls"][:1]  # 把 assistant 消息里的第二个请求直接删掉` 切片 `[:1]` 只留第一个。这是「想骗过服务端」的做法:既然上海的请求没法回,就假装模型从来没提过。
- `try_send("H. 悄悄把 assistant 消息改小:只留第一个请求,也只回第一个", [*base, shrunk, m1])` 改小了的历史,一个请求一条回应,格式上没问题。
- `try_send("I. 历史以带请求的 assistant 消息结尾,后面什么都没有", [*base, first.message])` 最后一条是 assistant 的请求,后面空着。
- `print(client.ledger)` 账本只记成功的调用:第一次请求加上 A、E、H 三次,共 4 次。

</div>

```bash
uv run python -m part03.missing_result
```

我的输出(2026-10-23,DeepSeek;每次运行 id 不同):

```text
模型这次提的两个请求: [('call_00_veot…', '{"city": "北京"}'), ('call_01_lXqJ…', '{"city": "上海"}')]
A. 两个都回(对照)
    HTTP 200 回答:上海更热：上海 22.0°C（小毛毛雨），北京 13.6°C（晴）。
B. 只回第一个
    HTTP 400 An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)
C. 只回第二个
    HTTP 400 An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)
D. 一个都不回,直接接用户的下一句
    HTTP 400 An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)
E. 两个都回,但顺序反过来
    HTTP 200 回答:上海更热：上海 22.0°C（小毛毛雨），北京 13.6°C（晴）。
F. 第二条的 id 抄成了第一个
    HTTP 400 Duplicate value for 'tool_call_id' of call_00_veotUaDMAJR1yhUR0Aca4772 in message[4]
G. 回了两个,中间插了一句用户的话
    HTTP 400 An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)
H. 悄悄把 assistant 消息改小:只留第一个请求,也只回第一个
    HTTP 200 又提了请求 ['{"city": "上海"}']
I. 历史以带请求的 assistant 消息结尾,后面什么都没有
    HTTP 400 An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)
4 次调用 | 输入 1999 / 输出 157 tokens | 约 ¥0.0027
```

逐条读:

**A、E:通过,而且顺序不限。** E 把上海放在北京前面,服务端照收,回答和 A 一样。对应关系靠的是 `tool_call_id`,不是位置。这条下一课有用:并发执行的结果是谁先跑完谁先到,不用特意排回原顺序。(这是 DeepSeek 实测;规矩由各家文档定,Anthropic 的文档也明确说结果的执行顺序由你决定,只要每个请求都有对应的结果。)

**B、C、D、G、I:同一句 400。**`An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)`。括号里那半句是关键词,搜索引擎里搜 `insufficient tool messages` 能搜到一大串别人踩过的同样的坑。这一句有两个特点。

第一,**它不告诉你缺的是哪个**。B 缺上海,C 缺北京,D 两个都缺,I 是后面干脆没有,报错一字不差。对比 Day 159 的实验二:那里 id 写错时,报错末尾点名了「The following tool_call_ids did not have response messages: call_00_abcdefg」。同一个服务端,不同的情形用了不同的措辞,所以别靠背报错原文,靠规矩。

第二,**G 说明「紧跟」是真的紧跟**。m1 和 m2 都回了,但中间隔着一条 user 消息,照样 400:服务端检查的是「assistant 之后连续的 tool 消息」覆盖了所有请求。

**F:另一句 400。**`Duplicate value for 'tool_call_id' of call_00_… in message[4]`。北京回了两次,上海没回,但服务端先发现的是重复,点名了重复的 id 和位置(`message[4]`,从 0 数,正好是第二条 tool 消息)。这是我实测里唯一一条会直接说出具体 id 的。

**H 最值得看。**我把 assistant 消息里的上海请求悄悄删掉,再只回北京:服务端放行了,返回 200。但模型的反应是**又提了一次上海的请求**(`[{"city": "上海"}]`),因为用户问的是「北京和上海哪个更热」,它发现缺上海的数据,于是重新来过。这个现象有两层意思。一,服务端只检查「格式上请求和回应成对」,不检查你有没有改过它的话,所以「改小历史」这条路是通的;二,**通的不等于好**:你偷偷改了模型说过的话,模型下一步的行为就和你以为的不一样。这次它重新提了请求,算好的;换一个场景,比如请求是「发送邮件」,你删掉它再回别的,模型就可能以为邮件还没发,再发一次。所以**别靠改历史来绕开 400,要靠回应每一个请求**。

## 第二步:请求是怎么悄悄漏掉的

故意漏回很好理解,真正的问题是**没打算漏、代码里却漏了**。四种我在别人的代码和自己的草稿里都见过的写法。它们的共同点是,工具请求只有一个的时候都正常,所以测试通得过,上线以后模型一次提两三个请求才炸。

用 Day 160 检查脚本里的假客户端的那套造法,造一次「模型一口气提三个请求」:北京(能查)、一个没登记的 `get_invoice`(忘了登记)、火星城(会失败)。不联网。新建 `part03/how_it_goes_missing.py`:

```python
# agent-zero-lab/part03/how_it_goes_missing.py
"""四种「悄悄漏回请求」的写法,和正确的写法对比。全部不联网。"""
import json
from collections.abc import Callable
from typing import Any

from part03.check_messages import check_messages
from part03.review160_check import call_of
from part03.tool_runner import execute_call
from part03.weather_api import WeatherError
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]


def fake_weather(city: str, unit: str = "celsius") -> dict[str, Any]:
    if city == "火星城":
        raise WeatherError("找不到叫 '火星城' 的城市,请换个写法")
    return {"city": city, "temperature": 12.5, "unit": unit}


FUNCS: dict[str, Callable[..., Any]] = {"get_weather": fake_weather}  # 注意:没有登记 get_invoice

# 假模型这一次一口气提了三个请求:北京(能查)、一个没登记的发票工具、火星城(会失败)
CALLS = [
    call_of('{"city": "北京"}', name="get_weather", cid="c1"),
    call_of('{"invoice_id": "INV-2026-0042"}', name="get_invoice", cid="c2"),
    call_of('{"city": "火星城"}', name="get_weather", cid="c3"),
]
ASSISTANT: dict[str, Any] = {"role": "assistant", "content": "", "tool_calls": CALLS}
START: list[dict[str, Any]] = [
    {"role": "system", "content": "s"},
    {"role": "user", "content": "北京现在多少度?再查一下 INV-2026-0042,以及火星城。"},
]


def tool_msg(call: dict[str, Any], content: str) -> dict[str, Any]:
    return {"role": "tool", "tool_call_id": call["id"], "content": content}


def bug_first_only() -> list[dict[str, Any]]:
    """只取 tool_calls[0](Day 156 的坑)。"""
    call = ASSISTANT["tool_calls"][0]
    return [*START, ASSISTANT, tool_msg(call, execute_call(call, TOOLS, FUNCS))]


def bug_skip_failed() -> list[dict[str, Any]]:
    """工具抛异常就 continue,以为「跳过」就没事了。"""
    out = [*START, ASSISTANT]
    for call in CALLS:
        try:
            fn = FUNCS[call["function"]["name"]]
            result = json.dumps(fn(**json.loads(call["function"]["arguments"])), ensure_ascii=False)
        except Exception:  # noqa: BLE001
            continue
        out.append(tool_msg(call, result))
    return out


def bug_skip_unknown() -> list[dict[str, Any]]:
    """只处理白名单里有的名字,没登记的悄悄过滤掉。"""
    out = [*START, ASSISTANT]
    for call in [c for c in CALLS if c["function"]["name"] in FUNCS]:
        out.append(tool_msg(call, execute_call(call, TOOLS, FUNCS)))
    return out


def bug_break_on_error() -> list[dict[str, Any]]:
    """遇到第一个「错误:…」就 break,不处理后面的。"""
    out = [*START, ASSISTANT]
    for call in CALLS:
        result = execute_call(call, TOOLS, FUNCS)
        out.append(tool_msg(call, result))
        if result.startswith("错误:"):
            break
    return out


def right() -> list[dict[str, Any]]:
    """每个请求都回一条,失败的也回,内容是「错误:…」。"""
    return [*START, ASSISTANT, *(tool_msg(c, execute_call(c, TOOLS, FUNCS)) for c in CALLS)]


if __name__ == "__main__":
    for name, build in [
        ("只取 tool_calls[0]", bug_first_only),
        ("失败就 continue", bug_skip_failed),
        ("没登记的名字悄悄过滤", bug_skip_unknown),
        ("遇到第一个错误就 break", bug_break_on_error),
        ("正确写法", right),
    ]:
        msgs = build()
        answered = [m["tool_call_id"] for m in msgs if m["role"] == "tool"]
        print(f"{name}: 提了 3 个请求,回了 {len(answered)} 个 {answered}")
        print(f"    本地检查:{check_messages(msgs) or '没发现问题'}")
```

<div class="line-notes">

- `import json` 第二种写法里自己解析 `arguments`。
- `from collections.abc import Callable` 白名单的类型。
- `from part03.check_messages import check_messages` Day 159 的本地检查,最后用它抓四种写法。
- `from part03.review160_check import call_of` Day 160 检查脚本里的小函数,造一条请求。
- `from part03.tool_runner import execute_call` Day 158 的四道关。
- `from part03.weather_api import WeatherError` 假工具要抛的异常。
- `def fake_weather(city: str, unit: str = "celsius") -> dict[str, Any]:` 一个不联网的假天气函数,检查才不会因为网络抖动变得不稳定。
- `if city == "火星城":` 专门留一个会失败的城市。
- `raise WeatherError("找不到叫 '火星城' 的城市,请换个写法")` 和真的 `get_weather` 找不到城市时的消息一模一样。
- `return {"city": city, "temperature": 12.5, "unit": unit}` 其他城市都返回 12.5 度。
- `FUNCS: dict[str, Callable[..., Any]] = {"get_weather": fake_weather}  # 注意:没有登记 get_invoice` 白名单里只有天气。
- `CALLS = [` 假模型这一次提的三个请求。
- `call_of('{"city": "北京"}', name="get_weather", cid="c1"),` c1:北京,能查。
- `call_of('{"invoice_id": "INV-2026-0042"}', name="get_invoice", cid="c2"),` c2:调发票工具,但白名单里没有。
- `call_of('{"city": "火星城"}', name="get_weather", cid="c3"),` c3:火星城,执行时会抛 `WeatherError`。
- `ASSISTANT: dict[str, Any] = {"role": "assistant", "content": "", "tool_calls": CALLS}` 那条 assistant 消息。
- `START: list[dict[str, Any]] = [` system 和 user 两条,问题里一口气问了三件事。
- `def tool_msg(call: dict[str, Any], content: str) -> dict[str, Any]:` 造 tool 消息的小函数。
- `def bug_first_only() -> list[dict[str, Any]]:` 第一种漏法。
- `call = ASSISTANT["tool_calls"][0]` 只取下标 0,Day 156 误区里提过「无条件取 `tool_calls[0]`」,那时说的是会漏掉后面的请求,今天看到它的后果:400。
- `return [*START, ASSISTANT, tool_msg(call, execute_call(call, TOOLS, FUNCS))]` 只回了 c1。
- `def bug_skip_failed() -> list[dict[str, Any]]:` 第二种漏法。
- `out = [*START, ASSISTANT]` 先放起始历史和 assistant 消息,再往后追加。
- `for call in CALLS:` 逐个请求。
- `fn = FUNCS[call["function"]["name"]]` 直接从白名单字典里取函数。c2 的名字是 `get_invoice`,字典里没有,这里抛 `KeyError`。
- `result = json.dumps(fn(**json.loads(call["function"]["arguments"])), ensure_ascii=False)` 自己解析参数并调用,没有走 `execute_call` 的四道关。c3 的火星城在这里抛 `WeatherError`。
- `except Exception:  # noqa: BLE001` 想「出错就跳过这个,继续做下一个」。
- `continue` 跳到下一个请求,**没有往 `out` 里放任何东西**。c2、c3 都被跳过了,这就是漏回。
- `out.append(tool_msg(call, result))` 只有成功的才会走到这一行。
- `def bug_skip_unknown() -> list[dict[str, Any]]:` 第三种漏法。
- `for call in [c for c in CALLS if c["function"]["name"] in FUNCS]:` 先把请求过滤一遍,只留白名单里有的名字。动机很合理:「没登记的我不执行」。结果是没登记的请求没有得到回应。
- `def bug_break_on_error() -> list[dict[str, Any]]:` 第四种漏法。
- `result = execute_call(call, TOOLS, FUNCS)` 这次用了 `execute_call`,失败会变成「错误:…」字符串,不抛异常。
- `if result.startswith("错误:"):` 看到错误就觉得「后面的不用做了」。
- `break` 退出循环。c1 成功、c2 是「错误:没有叫 'get_invoice'…」,c2 已经 `append` 了,然后 `break`,c3 没处理。
- `def right() -> list[dict[str, Any]]:` 正确写法。
- `return [*START, ASSISTANT, *(tool_msg(c, execute_call(c, TOOLS, FUNCS)) for c in CALLS)]` 每个请求一条,包括失败的,失败的内容就是「错误:…」。`*(生成器)` 把生成器的元素展开进列表。
- `for name, build in [` 五个函数登记成列表,逐个跑。
- `answered = [m["tool_call_id"] for m in msgs if m["role"] == "tool"]` 回了哪几个 id。
- `print(f"    本地检查:{check_messages(msgs) or '没发现问题'}")` 用 Day 159 的检查函数;检查出缺哪几个 id,而服务端不会告诉你。

</div>

```bash
uv run python -m part03.how_it_goes_missing
```

```text
只取 tool_calls[0]: 提了 3 个请求,回了 1 个 ['c1']
    本地检查:["结尾还有请求没收到结果:['c2', 'c3']"]
失败就 continue: 提了 3 个请求,回了 1 个 ['c1']
    本地检查:["结尾还有请求没收到结果:['c2', 'c3']"]
没登记的名字悄悄过滤: 提了 3 个请求,回了 2 个 ['c1', 'c3']
    本地检查:["结尾还有请求没收到结果:['c2']"]
遇到第一个错误就 break: 提了 3 个请求,回了 2 个 ['c1', 'c2']
    本地检查:["结尾还有请求没收到结果:['c3']"]
正确写法: 提了 3 个请求,回了 3 个 ['c1', 'c2', 'c3']
    本地检查:没发现问题
```

四种写法漏的位置各不相同(`['c2', 'c3']`、`['c2']`、`['c3']`),本地检查把缺的 id 一个个点了出来,服务端那句 400 做不到这一点。

这四种写法看起来各有各的动机,放在一起看,是同一个心智错误:**把「请求」当成可以丢弃的东西。**实际上请求提出来以后,就是一个欠着的回应。失败了要回「错误:…」,没执行要回「没有执行」,跳过也要回一句「跳过了」,总之一个都不能不回。Anthropic 的文档说得很直白:如果你因为前一个调用失败而选择不运行后面的某个调用,仍然要为它返回一个 `tool_result`,`is_error` 设为 `true`,内容写一句简短的解释,比如 `Not executed: the preceding write_file call failed.`。我们的 OpenAI 兼容格式没有 `is_error` 字段,所以直接把「错误:…」写在 `content` 里。

最容易漏的是第三种,因为它在「没登记的工具」这个本来就是例外的情形里出现。拿真的模型来试一次。

## 第三步:忘了登记的工具,真实的 400

场景:发给模型两个工具(天气和发票),但白名单里只登记了天气,忘了登记发票。用户一句话问了两件事。新建 `part03/unknown_tool_real.py`:

```python
# agent-zero-lab/part03/unknown_tool_real.py
import re
from typing import Any

import openai

from common.llm import LLMClient
from part03.invoice_data import INVOICE_TOOL
from part03.tool_runner import FUNCS, execute_call
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL, INVOICE_TOOL]  # 发给模型两个工具……
print("白名单里登记了:", list(FUNCS))  # ……但白名单里只有 get_weather,忘了登记 get_invoice

client = LLMClient(max_retries=0)
messages: list[dict[str, Any]] = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
    {"role": "user", "content": "北京现在多少度?另外帮我查一下 INV-2026-0042 的状态。"},
]
first = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)
calls = first.message.get("tool_calls") or []
print("模型提的请求:", [(c["id"][:12] + "…", c["function"]["name"]) for c in calls])


def send(label: str, history: list[dict[str, Any]]) -> None:
    try:
        r = client.chat(history, tools=TOOLS, temperature=0, max_tokens=200)
        print(f"{label}\n    HTTP 200 回答:{r.content.replace(chr(10), ' ')[:70]}")
    except openai.APIStatusError as e:
        body: Any = e.body or {}
        msg = re.sub(r" \(request_id: [^)]*\)", "", str(body.get("message", e.message)))
        print(f"{label}\n    HTTP {e.status_code} {msg}")


# 写法一:只处理白名单里有的名字,其余悄悄过滤
history = [*messages, first.message]
for call in [c for c in calls if c["function"]["name"] in FUNCS]:
    history.append({"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS)})
send("写法一:没登记的请求直接过滤掉", history)

# 写法二:每个请求都回一条,没登记的由 execute_call 回「错误:没有叫……」
history = [*messages, first.message]
for call in calls:
    history.append({"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS)})
print("写法二给 get_invoice 的 tool 消息:", history[-1]["content"])  # get_invoice 是最后一个请求
send("写法二:每个请求都回一条", history)
print(client.ledger)
```

<div class="line-notes">

- `from part03.invoice_data import INVOICE_TOOL` Day 160 小项目里的发票工具定义。
- `from part03.tool_runner import FUNCS, execute_call` 这次直接用 Day 158 的 `FUNCS`,里面只有 `get_weather`。
- `TOOLS = [WEATHER_TOOL, INVOICE_TOOL]  # 发给模型两个工具……` 发给模型的是两个。
- `print("白名单里登记了:", list(FUNCS))  # ……但白名单里只有 get_weather,忘了登记 get_invoice` 实测 `['get_weather']`。发给模型的和登记的不一致,正是「新加了一个工具,只改了定义忘了改白名单」的样子。
- `client = LLMClient(max_retries=0)` 不重试。
- `{"role": "user", "content": "北京现在多少度?另外帮我查一下 INV-2026-0042 的状态。"}` 一句话两件事,模型会同时提两个请求。
- `print("模型提的请求:", [(c["id"][:12] + "…", c["function"]["name"]) for c in calls])` 实测 `get_weather` 和 `get_invoice` 各一个。
- `def send(label: str, history: list[dict[str, Any]]) -> None:` 发一次、打印结果的小函数,和 `try_send` 一样。
- `msg = re.sub(r" \(request_id: [^)]*\)", "", str(body.get("message", e.message)))` 去掉 `request_id`。
- `history = [*messages, first.message]` 起始历史加上模型那条 assistant 消息。
- `for call in [c for c in calls if c["function"]["name"] in FUNCS]:` 写法一:没登记的悄悄过滤。
- `history.append({"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS)})` 只有 `get_weather` 得到回应。
- `send("写法一:没登记的请求直接过滤掉", history)` 实测 400。
- `for call in calls:` 写法二:每个请求都回一条。
- `history.append({"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS)})` `execute_call` 第一道关就会拒绝没登记的名字,返回「错误:没有叫 'get_invoice' 的工具,可用的工具:['get_weather']」。
- `print("写法二给 get_invoice 的 tool 消息:", history[-1]["content"])  # get_invoice 是最后一个请求` 把那条错误打印出来。
- `send("写法二:每个请求都回一条", history)` 实测 200。
- `print(client.ledger)` 成功的调用只有两次(请求 1 和写法二的请求 2)。

</div>

```bash
uv run python -m part03.unknown_tool_real
```

```text
白名单里登记了: ['get_weather']
模型提的请求: [('call_00_8m2g…', 'get_weather'), ('call_01_1Set…', 'get_invoice')]
写法一:没登记的请求直接过滤掉
    HTTP 400 An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. (insufficient tool messages following tool_calls message)
写法二给 get_invoice 的 tool 消息: 错误:没有叫 'get_invoice' 的工具,可用的工具:['get_weather']
写法二:每个请求都回一条
    HTTP 200 回答:北京现在 13.6°C，晴，风速约 5.6 km/h。  发票查询这边暂时不可用（系统里没有可用的发票查询工具），麻烦稍后再试或联系人工客服
2 次调用 | 输入 1319 / 输出 120 tokens | 约 ¥0.0018
```

写法一 400;写法二 200,而且回答很得体:北京的天气照常说了,发票那一半说「这边暂时不可用,稍后再试或联系人工」。模型看到那句「没有叫 'get_invoice' 的工具」,没有编造一个发票状态,而是如实告诉用户这一半办不到。

**所以 Day 158 的 `execute_call` 第一道关,返回错误字符串而不是直接跳过,不只是为了「让模型知道」,也是为了满足「每个请求必须有回应」。**这是当时没点出来的第二个理由。

## 第四步:已经漏了,怎么办

前面都是「怎么不漏」。但有一类情况你控制不了:**历史已经是坏的了**。比如程序在工具执行到一半被杀掉,历史已经存进了会话文件(Day 155);或者用户按了 Ctrl+C,历史里留着一条带请求的 assistant 消息;或者你是接手别人的老数据。下一次请求带着这段历史,就是 400,而且每次都是,用户永远卡在这一轮。

办法是在发请求之前,把**悬空的请求**补上一条「没有执行」的 tool 消息。新建 `part03/repair_history.py`:

```python
# agent-zero-lab/part03/repair_history.py
from typing import Any

DEFAULT_NOTE = "错误:这个请求没有执行,没有结果(程序在执行前被中断了)"


def close_dangling(messages: list[dict[str, Any]], note: str = DEFAULT_NOTE) -> list[dict[str, Any]]:
    """给每个没得到回应的工具请求补一条 tool 消息,放在它该在的位置。返回新列表,不改原列表。"""
    out: list[dict[str, Any]] = []
    i = 0
    while i < len(messages):
        m = messages[i]
        out.append(m)
        i += 1
        calls = m.get("tool_calls") if m.get("role") == "assistant" else None
        if not calls:
            continue
        answered: set[str] = set()
        while i < len(messages) and messages[i].get("role") == "tool":  # 紧跟着的 tool 消息
            out.append(messages[i])
            answered.add(messages[i].get("tool_call_id", ""))
            i += 1
        for c in calls:
            if c["id"] not in answered:
                out.append({"role": "tool", "tool_call_id": c["id"], "content": note})
    return out
```

<div class="line-notes">

- `from typing import Any` 消息是字典。
- `DEFAULT_NOTE = "错误:这个请求没有执行,没有结果(程序在执行前被中断了)"` 补上去的话。写成真话:这个请求**没有执行**,模型才知道要不要重新提。
- `def close_dangling(messages: list[dict[str, Any]], note: str = DEFAULT_NOTE) -> list[dict[str, Any]]:` 输入一段历史,输出补齐后的**新列表**。名字里的 dangling 是「悬着的」。
- `out: list[dict[str, Any]] = []` 结果列表,原列表不动(下面有测试验证)。
- `i = 0` 手动管理下标,因为内层循环也要往前走。
- `while i < len(messages):` 外层循环,逐条处理。
- `m = messages[i]` 当前消息。
- `out.append(m)` 先原样放进结果。
- `i += 1` 下标先加一,指向下一条。
- `calls = m.get("tool_calls") if m.get("role") == "assistant" else None` 只有 assistant 消息才可能带请求。
- `if not calls:` 普通消息(user、普通 assistant、孤零零的 tool)。
- `continue` 回到外层循环处理下一条。
- `answered: set[str] = set()` 记下「紧跟着的 tool 消息」回应了哪些 id。集合([Day 25](/blog/agent-zero/day-025-sets/))。
- `while i < len(messages) and messages[i].get("role") == "tool":  # 紧跟着的 tool 消息` 内层循环:只要下一条还是 tool 消息就继续收。遇到 user 或别的角色就停,这对应了「G:中间不能插别的消息」。
- `out.append(messages[i])` 这条 tool 消息原样放进结果。
- `answered.add(messages[i].get("tool_call_id", ""))` 记下它回应的 id。
- `i += 1` 继续往后。
- `for c in calls:` 内层收完了,检查每个请求。
- `if c["id"] not in answered:` 没有被紧跟着的 tool 消息回应的。
- `out.append({"role": "tool", "tool_call_id": c["id"], "content": note})` 补一条,放在已经收下的 tool 消息**后面**、下一条非 tool 消息**前面**,正好是服务端要求的位置。

</div>

用一个具体例子走一遍。历史是 `[system, user, assistant(c1,c2,c3), tool(c1), user("快点")]`。下标 0、1 普通,原样放进 `out`。下标 2 是 assistant,`calls` 是 c1 c2 c3;内层循环收下下标 3 的 tool(c1),`answered = {"c1"}`;下标 4 是 user,内层循环停止。`for c in calls` 发现 c2、c3 不在 `answered` 里,依次补两条 tool 消息。外层继续处理下标 4,user 消息放在最后。结果是 `[system, user, assistant, tool(c1), tool(c2), tool(c3), user]`,服务端满意。

测试(不联网):

```python
# agent-zero-lab/tests/test_repair_history.py
import copy
from typing import Any

from part03.check_messages import check_messages
from part03.how_it_goes_missing import ASSISTANT, START, tool_msg
from part03.repair_history import DEFAULT_NOTE, close_dangling

C1, C2, C3 = ASSISTANT["tool_calls"]


def test_good_history_is_unchanged() -> None:
    good = [*START, ASSISTANT, tool_msg(C1, "a"), tool_msg(C2, "b"), tool_msg(C3, "c")]
    assert close_dangling(good) == good


def test_fills_the_missing_ones_in_place() -> None:
    broken = [*START, ASSISTANT, tool_msg(C1, "a")]
    fixed = close_dangling(broken)
    assert [m.get("tool_call_id") for m in fixed[-3:]] == ["c1", "c2", "c3"]
    assert fixed[-1]["content"] == DEFAULT_NOTE
    assert check_messages(fixed) == []


def test_placeholders_go_before_the_next_user_message() -> None:
    broken = [*START, ASSISTANT, {"role": "user", "content": "快点"}]
    fixed = close_dangling(broken)
    assert [m["role"] for m in fixed[2:]] == ["assistant", "tool", "tool", "tool", "user"]
    assert check_messages(fixed) == []


def test_original_list_is_not_modified() -> None:
    broken = [*START, ASSISTANT]
    before = copy.deepcopy(broken)
    close_dangling(broken)
    assert broken == before


def test_is_idempotent() -> None:
    once = close_dangling([*START, ASSISTANT, tool_msg(C2, "b")])
    assert close_dangling(once) == once


def test_two_dangling_rounds_in_one_history() -> None:
    second: dict[str, Any] = {"role": "assistant", "content": "", "tool_calls": [{**C1, "id": "d1"}]}
    broken = [*START, ASSISTANT, tool_msg(C1, "a"), tool_msg(C2, "b"), tool_msg(C3, "c"), {"role": "user", "content": "再来"}, second]
    fixed = close_dangling(broken)
    assert fixed[-1]["tool_call_id"] == "d1"
    assert check_messages(fixed) == []
```

<div class="line-notes">

- `import copy` 深拷贝原列表,测「没有被修改」。
- `from part03.how_it_goes_missing import ASSISTANT, START, tool_msg` 复用刚才造好的三请求假数据。
- `from part03.repair_history import DEFAULT_NOTE, close_dangling` 被测对象。
- `C1, C2, C3 = ASSISTANT["tool_calls"]` 把三个请求拆成三个变量。
- `good = [*START, ASSISTANT, tool_msg(C1, "a"), tool_msg(C2, "b"), tool_msg(C3, "c")]` 一份没问题的历史。
- `assert close_dangling(good) == good` 没问题的历史,补齐之后原样不动。
- `broken = [*START, ASSISTANT, tool_msg(C1, "a")]` 只回了 c1。
- `assert [m.get("tool_call_id") for m in fixed[-3:]] == ["c1", "c2", "c3"]` 补完后最后三条是 c1、c2、c3,补的两条跟在已有的后面。
- `assert fixed[-1]["content"] == DEFAULT_NOTE` 补的那条内容是默认的话。
- `assert check_messages(fixed) == []` 补完后能通过 Day 159 的检查。
- `broken = [*START, ASSISTANT, {"role": "user", "content": "快点"}]` 一个都没回,后面接了用户的话。
- `assert [m["role"] for m in fixed[2:]] == ["assistant", "tool", "tool", "tool", "user"]` 三条补的 tool 消息必须在 user 之前。
- `before = copy.deepcopy(broken)` 先存一份拷贝。
- `assert broken == before` 调用之后原列表没变。
- `once = close_dangling([*START, ASSISTANT, tool_msg(C2, "b")])` 只回了 c2,补齐一次。
- `assert close_dangling(once) == once` 补两次和补一次结果一样(幂等):已经补好的历史再来一遍什么都不会改。
- `second: dict[str, Any] = {"role": "assistant", "content": "", "tool_calls": [{**C1, "id": "d1"}]}` 第二轮又提了一个请求,id 是 d1。
- `broken = [*START, ASSISTANT, tool_msg(C1, "a"), tool_msg(C2, "b"), tool_msg(C3, "c"), {"role": "user", "content": "再来"}, second]` 第一轮完整,第二轮悬空:历史里有两条带请求的 assistant 消息。
- `assert fixed[-1]["tool_call_id"] == "d1"` 只补第二轮的,放在最后。

</div>

```bash
uv run pytest -q tests/test_repair_history.py
```

```text
......                                                                   [100%]
6 passed in 0.20s
```

六个测试通过。再让真的模型看一次。两种坏历史,每种「原样发」和「补齐后发」各一次。新建 `part03/repair_demo.py`:

```python
# agent-zero-lab/part03/repair_demo.py
from typing import Any

import openai

from common.llm import LLMClient
from part03.repair_history import close_dangling
from part03.tool_runner import execute_call
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]
client = LLMClient(max_retries=0)
base: list[dict[str, Any]] = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
    {"role": "user", "content": "北京和上海现在哪个更热?"},
]
first = client.chat(base, tools=TOOLS, temperature=0, max_tokens=300)
c1, c2 = first.message["tool_calls"]
m1 = {"role": "tool", "tool_call_id": c1["id"], "content": execute_call(c1, TOOLS)}

cases: dict[str, list[dict[str, Any]]] = {
    "只回了北京(上海那个执行时程序崩了)": [*base, first.message, m1],
    "两个都没回,用户已经又发了一句": [*base, first.message, {"role": "user", "content": "怎么这么慢?"}],
}
for label, history in cases.items():
    print(f"== {label}")
    for tag, h in [("原样发", history), ("补齐后发", close_dangling(history))]:
        try:
            r = client.chat(h, tools=TOOLS, temperature=0, max_tokens=150)
            again = [c["function"]["arguments"] for c in r.message.get("tool_calls") or []]
            shown = f"又提了请求 {again}" if again else r.content.replace("\n", " ")[:70]
            print(f"   {tag}: HTTP 200 {shown}")
        except openai.APIStatusError as e:
            print(f"   {tag}: HTTP {e.status_code}")
print(client.ledger)
```

<div class="line-notes">

- `from part03.repair_history import close_dangling` 刚写的函数。
- `c1, c2 = first.message["tool_calls"]` 两个请求拆开,这一课前面用过同样的问法。
- `m1 = {"role": "tool", "tool_call_id": c1["id"], "content": execute_call(c1, TOOLS)}` 只造北京那条 tool 消息。
- `cases: dict[str, list[dict[str, Any]]] = {` 两种坏历史。
- `"只回了北京(上海那个执行时程序崩了)": [*base, first.message, m1],` 第一种:一条 tool 消息,缺上海。
- `"两个都没回,用户已经又发了一句": [*base, first.message, {"role": "user", "content": "怎么这么慢?"}],` 第二种:一条都没有,后面接了用户的催促。
- `for tag, h in [("原样发", history), ("补齐后发", close_dangling(history))]:` 同一段坏历史,两种发法。
- `shown = f"又提了请求 {again}" if again else r.content.replace("\n", " ")[:70]` 200 时显示模型的反应。
- `print(f"   {tag}: HTTP {e.status_code}")` 400 时只打状态码,原文前面见过很多遍了。

</div>

```bash
uv run python -m part03.repair_demo
```

```text
== 只回了北京(上海那个执行时程序崩了)
   原样发: HTTP 400
   补齐后发: HTTP 200 又提了请求 ['{"city": "上海"}']
== 两个都没回,用户已经又发了一句
   原样发: HTTP 400
   补齐后发: HTTP 200 又提了请求 ['{"city": "北京"}', '{"city": "上海"}']
3 次调用 | 输入 1436 / 输出 215 tokens | 约 ¥0.0028
```

两种坏历史,原样发都是 400,补齐后都是 200。有意思的是模型的反应:**它没有直接回答,而是把没拿到结果的请求重新提了一遍**。第一种只重提了上海,第二种两个都重提了(北京和上海,因为都标着「没有执行」)。这正是我们想要的:补的那句话是真话,模型据此认为「还没拿到,重新来」,而不是对着一条假结果瞎编。

补齐之后要注意三件事:

**补齐是「恢复」,不是「掩盖」。**历史里多了几条没有真实结果的 tool 消息,而且模型会据此重新提请求。线上用的话,补了就要记一条日志(哪个会话、补了几条),不然一个反复崩在同一个工具上的会话,会无声地反复补、反复重试。

**模型重新提的请求会被再执行一次。**如果被中断的是「发邮件」这类有副作用的工具,补齐之后模型再提一次,真的会再发一次。补齐只适合只读的、重复执行没有害处的工具;有副作用的工具,更合理的做法是补一句「结果未知,请先确认是否已经执行」,而不是「没有执行」。第七部分讲幂等性时会再来。

**有上限。**补齐加重试,遇到一个永远失败的工具会循环下去。Day 166 的 Agent 循环会加一个最大步数,先记住有这回事。

### 零件对照

| 概念 | 今天的文件 | 以后哪天用 |
| --- | --- | --- |
| 每个请求恰好一条回应 | `missing_result.py` 的 A 到 I | [Day 162](/blog/agent-zero/day-162-parallel-tools/) 并行,[Day 166](/blog/agent-zero/day-166-agent-min/) 循环的每一圈 |
| 四种悄悄漏回的写法 | `how_it_goes_missing.py` | 写任何「遍历请求」的代码前过一遍 |
| 没登记的工具也要回 | `unknown_tool_real.py` | Day 158 的 `execute_call` 第一道关 |
| 本地数 id | Day 159 的 `check_messages` | 每次发请求之前 |
| 补齐悬空请求 | `repair_history.py` | 会话读回来之后(练习 3)、Agent 循环被中断之后 |

## 动手练习

三道题。练习 1 联网(一共发 15 次请求,其中 7 次是 400,真正计费的 8 次),练习 2、3 不联网。

**练习 1:穷举一遍。** 让模型一次提三个请求(北京、上海、广州),把「回哪几个」的八种组合全部发一遍,再把三个都回的六种顺序全部发一遍,记下每种的状态码。结论应该是:八种里只有「全回」是 200,六种顺序全是 200。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex161_subsets.py
import itertools
import re
from typing import Any

import openai

from common.llm import LLMClient
from part03.tool_runner import execute_call
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]
client = LLMClient(max_retries=0)
base: list[dict[str, Any]] = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
    {"role": "user", "content": "北京、上海、广州现在各多少度?"},
]
first = client.chat(base, tools=TOOLS, temperature=0, max_tokens=300)
calls = first.message.get("tool_calls") or []
if len(calls) != 3:
    raise SystemExit(f"这个实验要模型一次提 3 个请求,这次是 {len(calls)} 个,重跑一次")
msgs = [{"role": "tool", "tool_call_id": c["id"], "content": execute_call(c, TOOLS)} for c in calls]


def status(history: list[dict[str, Any]]) -> str:
    try:
        client.chat(history, tools=TOOLS, temperature=0, max_tokens=60)
        return "200"
    except openai.APIStatusError as e:
        body: Any = e.body or {}
        msg = re.sub(r" \(request_id: [^)]*\)", "", str(body.get("message", e.message)))
        tail = re.search(r"\(([^()]*)\)\s*$", msg)  # 取结尾括号里的那句简短原因
        return f"{e.status_code} {tail.group(1) if tail else msg[:40]}"


print("== 回哪几个(1 表示回了,顺序是 北京 上海 广州)")
for mask in itertools.product([1, 0], repeat=3):
    answered = [m for m, keep in zip(msgs, mask) if keep]
    print(f"   {mask}  {status([*base, first.message, *answered])}")

print("== 三个都回,换六种顺序")
for order in itertools.permutations(range(3)):
    print(f"   {order}  {status([*base, first.message, *(msgs[i] for i in order)])}")
print(client.ledger)
```

<div class="line-notes">

- `import itertools` 标准库里生成排列组合的工具。
- `calls = first.message.get("tool_calls") or []` 取请求。
- `if len(calls) != 3:` 前提:模型一次提三个。我问了三次「北京、上海、广州现在各多少度?」,三次都是三个。
- `msgs = [{"role": "tool", "tool_call_id": c["id"], "content": execute_call(c, TOOLS)} for c in calls]` 三条正确的 tool 消息,联网查三次天气。
- `def status(history: list[dict[str, Any]]) -> str:` 发一次,只返回状态码和简短原因,不看回答。
- `client.chat(history, tools=TOOLS, temperature=0, max_tokens=60)` 回答只要有就行,`max_tokens` 压到 60 省钱。
- `return "200"` 成功就返回字符串 `"200"`。
- `tail = re.search(r"\(([^()]*)\)\s*$", msg)  # 取结尾括号里的那句简短原因` 正则:匹配结尾的一对括号,括号里不含括号,捕获括号里的内容。
- `return f"{e.status_code} {tail.group(1) if tail else msg[:40]}"` 有括号就取括号里的话,没有就取前 40 个字。
- `for mask in itertools.product([1, 0], repeat=3):` `product([1, 0], repeat=3)` 生成三位的所有 0/1 组合:`(1,1,1)`、`(1,1,0)`……共 2³ = 8 个。`1` 表示回了这个城市。
- `answered = [m for m, keep in zip(msgs, mask) if keep]` `zip` 把三条 tool 消息和三个 0/1 并排拼起来,只留 `keep` 为 1 的。比如 `mask = (1, 0, 1)` 留下北京和广州。
- `print(f"   {mask}  {status([*base, first.message, *answered])}")` 发出去并打印。
- `for order in itertools.permutations(range(3)):` `permutations(range(3))` 是 0、1、2 的全部排列:`(0,1,2)`、`(0,2,1)`……共 3! = 6 个。
- `status([*base, first.message, *(msgs[i] for i in order)])` 按这个顺序放三条 tool 消息。
- `print(client.ledger)` 账本只记成功的:第一次请求、全回的 1 次、六种顺序的 6 次,共 8 次。

</div>

```bash
uv run python -m part03.ex161_subsets
```

```text
== 回哪几个(1 表示回了,顺序是 北京 上海 广州)
   (1, 1, 1)  200
   (1, 1, 0)  400 insufficient tool messages following tool_calls message
   (1, 0, 1)  400 insufficient tool messages following tool_calls message
   (1, 0, 0)  400 insufficient tool messages following tool_calls message
   (0, 1, 1)  400 insufficient tool messages following tool_calls message
   (0, 1, 0)  400 insufficient tool messages following tool_calls message
   (0, 0, 1)  400 insufficient tool messages following tool_calls message
   (0, 0, 0)  400 insufficient tool messages following tool_calls message
== 三个都回,换六种顺序
   (0, 1, 2)  200
   (0, 2, 1)  200
   (1, 0, 2)  200
   (1, 2, 0)  200
   (2, 0, 1)  200
   (2, 1, 0)  200
8 次调用 | 输入 4913 / 输出 452 tokens | 约 ¥0.0059
```

八种组合里只有全回(1, 1, 1)是 200,其余七种(包括只漏最后一个的 (1, 1, 0))全是同一句 `insufficient tool messages following tool_calls message`。六种顺序全是 200。账本显示 8 次调用(失败的 7 次没计入)、约 ¥0.0059。这就是规矩的完整边界:**恰好一条、不限顺序、紧跟着**。

</details>

**练习 2:写一个保证每个请求都回的函数。** 写 `answer_all(calls, tools, funcs, run)`,返回和 `calls` 一一对应的 tool 消息列表。要求:不管请求是正常的、JSON 被截断的、缺必填的、多余参数的、没登记的、工具自己失败的,还是**连 `run`(执行函数)自己都出了 bug**,每个请求都有一条非空字符串内容的回应,顺序和请求一致。用 pytest 把这几种全部覆盖,再用一个循环把「哪些请求成功、哪些失败」的 2³ 种组合全部测一遍。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/answer_all.py
from collections.abc import Callable
from typing import Any

from part03.tool_runner import FUNCS, execute_call


def answer_all(
    calls: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    funcs: dict[str, Callable[..., Any]] = FUNCS,
    run: Callable[..., str] = execute_call,
) -> list[dict[str, Any]]:
    """每个请求一定回一条 tool 消息,不管执行时发生了什么。"""
    out: list[dict[str, Any]] = []
    for call in calls:
        try:
            content = run(call, tools, funcs) or "(工具没有返回内容)"
        except Exception as e:  # noqa: BLE001  最后一道保险:执行函数本身出 bug 也要回一条
            content = f"错误:执行时出了意外({type(e).__name__})"
        out.append({"role": "tool", "tool_call_id": call["id"], "content": content})
    return out
```

<div class="line-notes">

- `from part03.tool_runner import FUNCS, execute_call` 默认的白名单和默认的执行函数。
- `calls: list[dict[str, Any]],` 模型提的所有请求。
- `run: Callable[..., str] = execute_call,` 执行函数做成参数,默认是 `execute_call`。这样测试里可以换成会爆炸的假函数,验证最后一道保险。
- `out: list[dict[str, Any]] = []` 结果列表,和 `calls` 一一对应。
- `for call in calls:` 一个请求一轮,**一轮必然往 `out` 里放一条**:这是整个函数的不变量。
- `try:` 包住执行。
- `content = run(call, tools, funcs) or "(工具没有返回内容)"` 执行,空就兜底。
- `except Exception as e:  # noqa: BLE001  最后一道保险:执行函数本身出 bug 也要回一条` `execute_call` 自己的设计是不抛异常,但「设计上不会」不等于「实际上不会」(比如以后有人改了它)。这里再兜一层,宁可多写一层也不能漏掉一个请求。
- `content = f"错误:执行时出了意外({type(e).__name__})"` 只给类型名。
- `out.append({"role": "tool", "tool_call_id": call["id"], "content": content})` 一条回应。`try` 和 `except` 里都给 `content` 赋了值,所以走到这里它一定有值。

</div>

测试:

```python
# agent-zero-lab/tests/test_answer_all.py
import itertools
from typing import Any

from part03.answer_all import answer_all
from part03.check_messages import check_messages
from part03.how_it_goes_missing import ASSISTANT, CALLS, FUNCS, START, TOOLS
from part03.review160_check import call_of


def history(calls: list[dict[str, Any]], tool_msgs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    asst = {"role": "assistant", "content": "", "tool_calls": calls}
    return [*START, asst, *tool_msgs]


def test_every_call_gets_a_message_in_the_same_order() -> None:
    msgs = answer_all(CALLS, TOOLS, FUNCS)
    assert [m["tool_call_id"] for m in msgs] == ["c1", "c2", "c3"]
    assert check_messages([*START, ASSISTANT, *msgs]) == []


def test_all_kinds_of_bad_calls_are_still_answered() -> None:
    bad = [
        call_of('{"city": "北京"}', name="get_weather", cid="a"),  # 正常
        call_of('{"city": "北', name="get_weather", cid="b"),  # JSON 被截断
        call_of("{}", name="get_weather", cid="c"),  # 缺必填
        call_of('{"city": "北京", "x": 1}', name="get_weather", cid="d"),  # 多余参数
        call_of("{}", name="rm_all", cid="e"),  # 没登记
        call_of('{"city": "火星城"}', name="get_weather", cid="f"),  # 工具自己失败
    ]
    msgs = answer_all(bad, TOOLS, FUNCS)
    assert [m["tool_call_id"] for m in msgs] == list("abcdef")
    assert all(isinstance(m["content"], str) and m["content"] for m in msgs)
    assert check_messages(history(bad, msgs)) == []


def test_even_if_the_runner_itself_blows_up() -> None:
    def broken(*_: Any, **__: Any) -> str:
        raise ZeroDivisionError("runner 自己的 bug")

    msgs = answer_all(CALLS, TOOLS, FUNCS, run=broken)
    assert [m["content"] for m in msgs] == ["错误:执行时出了意外(ZeroDivisionError)"] * 3
    assert check_messages([*START, ASSISTANT, *msgs]) == []


def test_every_subset_of_failures() -> None:
    for mask in itertools.product([True, False], repeat=3):
        def run(call: dict[str, Any], tools: list[dict[str, Any]], funcs: Any, mask: tuple[bool, ...] = mask) -> str:
            if not mask[int(call["id"][1]) - 1]:
                raise RuntimeError("x")
            return "ok"

        msgs = answer_all(CALLS, TOOLS, FUNCS, run=run)
        assert check_messages([*START, ASSISTANT, *msgs]) == []
```

<div class="line-notes">

- `import itertools` 生成 2³ 种组合。
- `from part03.how_it_goes_missing import ASSISTANT, CALLS, FUNCS, START, TOOLS` 复用今天第二步的三请求假数据。
- `from part03.review160_check import call_of` Day 160 的造请求小函数。
- `def history(calls: list[dict[str, Any]], tool_msgs: list[dict[str, Any]]) -> list[dict[str, Any]]:` 辅助函数:用任意一组请求拼出一段完整历史,交给 `check_messages` 检查。
- `asst = {"role": "assistant", "content": "", "tool_calls": calls}` 带请求的 assistant 消息。
- `assert [m["tool_call_id"] for m in msgs] == ["c1", "c2", "c3"]` 顺序和请求一致。
- `call_of('{"city": "北京"}', name="get_weather", cid="a"),  # 正常` 六种请求的第一种:什么问题都没有。
- `call_of('{"city": "北', name="get_weather", cid="b"),  # JSON 被截断` 第二种:`arguments` 被截断。
- `call_of("{}", name="get_weather", cid="c"),  # 缺必填` 第三种:缺 `city`。
- `call_of('{"city": "北京", "x": 1}', name="get_weather", cid="d"),  # 多余参数` 第四种。
- `call_of("{}", name="rm_all", cid="e"),  # 没登记` 第五种。
- `call_of('{"city": "火星城"}', name="get_weather", cid="f"),  # 工具自己失败` 第六种:合法的参数,工具内部失败。
- `assert [m["tool_call_id"] for m in msgs] == list("abcdef")` `list("abcdef")` 把字符串拆成六个单字符,正好是六个 id。
- `assert all(isinstance(m["content"], str) and m["content"] for m in msgs)` 每条内容都是非空字符串。
- `def broken(*_: Any, **__: Any) -> str:` 一个接受任何参数、一调用就抛异常的假执行函数,模拟 `execute_call` 自己有 bug。
- `raise ZeroDivisionError("runner 自己的 bug")` 抛一个和天气毫无关系的异常。
- `msgs = answer_all(CALLS, TOOLS, FUNCS, run=broken)` 换上它。
- `assert [m["content"] for m in msgs] == ["错误:执行时出了意外(ZeroDivisionError)"] * 3` 三个请求都回了「执行时出了意外」,`* 3` 把单元素列表重复三遍。
- `for mask in itertools.product([True, False], repeat=3):` 三个请求各自「成功/失败」的八种组合。
- `def run(call: dict[str, Any], tools: list[dict[str, Any]], funcs: Any, mask: tuple[bool, ...] = mask) -> str:` 每轮循环定义一个假执行函数。`mask=mask` 是个小技巧:把当前这轮的 `mask` 绑定成默认参数,免得函数里读到的是循环结束时的最后一个值。
- `if not mask[int(call["id"][1]) - 1]:` `call["id"]` 是 `"c1"`,`[1]` 取字符 `"1"`,`int` 转成 1,再减 1 得到下标 0。
- `raise RuntimeError("x")` 这个请求在这种组合里「失败」。
- `assert check_messages([*START, ASSISTANT, *msgs]) == []` 不管哪种组合,历史都通过检查。

</div>

```bash
uv run pytest -q tests/test_answer_all.py
```

```text
....                                                                     [100%]
4 passed in 0.37s
```

四个测试通过。`answer_all` 的价值不在这十几行代码,而在**它把「每个请求都回」变成一个有名字、有测试的不变量**。以后任何地方要处理请求,调它,而不是自己再写一遍循环。Day 168 的工具注册表会把它吸收进去。

</details>

**练习 3:崩在中途的会话,读回来时补齐。** Day 160 练习 2 的严格加载器会拒绝「请求提了、结果没存」的会话文件(执行工具时程序崩了,文件却已经写了)。写 `load_session_repair`:读文件,对每一轮先用 `close_dangling` 补齐,再用 Day 160 的校验模型校验;返回对话和补了几条。要求不能把补齐的结果写回磁盘(读取不应该悄悄改文件),其他类型的坏文件仍然要被拒绝。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/sessions_repair.py
import json
from pathlib import Path

from pydantic import ValidationError

from common.llm import Conversation
from part02.sessions import SESSIONS, SessionError, session_path
from part03.repair_history import close_dangling
from part03.sessions_tools import SessionFile


def load_session_repair(name: str, base: Path = SESSIONS) -> tuple[Conversation, int]:
    """读会话;崩在工具执行中途存下来的轮,先补齐再校验。返回 (对话, 补了几条)。"""
    path = session_path(name, base)
    if not path.is_file():
        raise SessionError(f"没有这个会话:{path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        turns = data["turns"]
        fixed = [close_dangling(t) if isinstance(t, list) else t for t in turns]
        added = sum(len(f) - len(t) for f, t in zip(fixed, turns) if isinstance(t, list))
        data["turns"] = fixed
        SessionFile.model_validate(data)
    except (json.JSONDecodeError, UnicodeDecodeError, KeyError, TypeError) as e:
        raise SessionError(f"{path} 不是合法的会话文件:{type(e).__name__}") from e
    except ValidationError as e:
        first = e.errors()[0]
        where = ".".join(str(x) for x in first["loc"])
        raise SessionError(f"{path} 格式不对,{where}:{first['msg']}") from e
    return Conversation.from_dict(data), added
```

<div class="line-notes">

- `from part03.repair_history import close_dangling` 今天写的补齐函数。
- `from part03.sessions_tools import SessionFile` Day 160 练习 2 的校验模型,补齐之后用它校验。
- `def load_session_repair(name: str, base: Path = SESSIONS) -> tuple[Conversation, int]:` 返回一个元组:对话,和补了几条。
- `path = session_path(name, base)` 文件名白名单,沿用 Day 155。
- `data = json.loads(path.read_text(encoding="utf-8"))` 读成字典。
- `turns = data["turns"]` 取出所有轮。缺这个 key 会 `KeyError`,下面的 `except` 接住。
- `fixed = [close_dangling(t) if isinstance(t, list) else t for t in turns]` 每一轮补齐;如果某一「轮」根本不是列表(文件被改坏了),原样放过,让下面的校验去拒绝。
- `added = sum(len(f) - len(t) for f, t in zip(fixed, turns) if isinstance(t, list))` 补的条数:补齐前后的长度差之和。
- `data["turns"] = fixed` 用补齐后的轮替换。这只改内存里的字典,**没有写回文件**。
- `SessionFile.model_validate(data)` 用 Day 160 的校验模型检查补齐后的结果。像「第一条不是 user」这种问题不会被补齐掩盖。
- `except (json.JSONDecodeError, UnicodeDecodeError, KeyError, TypeError) as e:` 文件不是合法 JSON,或者形状不对(没有 `turns`、`turns` 不是列表)。
- `raise SessionError(f"{path} 不是合法的会话文件:{type(e).__name__}") from e` 统一成 Day 155 的专用异常。
- `return Conversation.from_dict(data), added` 返回补齐后的对话和补了几条。

</div>

测试:

```python
# agent-zero-lab/tests/test_sessions_repair.py
import copy
import json
from pathlib import Path
from typing import Any

import pytest

from common.llm import Conversation
from part02.sessions import SessionError, save_session
from part03.sessions_repair import load_session_repair
from part03.sessions_tools import load_session_tools

CALL = {"id": "c1", "type": "function", "function": {"name": "get_invoice", "arguments": '{"invoice_id": "INV-2026-0042"}'}}
USER: dict[str, Any] = {"role": "user", "content": "INV-2026-0042 什么状态?"}
ASST: dict[str, Any] = {"role": "assistant", "content": "", "tool_calls": [CALL]}


def save(tmp_path: Path, turn: list[dict[str, Any]]) -> None:
    conv = Conversation("你是客服。")
    conv.turns = [copy.deepcopy(turn)]
    save_session(conv, "t", tmp_path)


def test_crashed_turn_is_rejected_by_the_strict_loader(tmp_path: Path) -> None:
    save(tmp_path, [USER, ASST])
    with pytest.raises(SessionError, match="没收到结果"):
        load_session_tools("t", tmp_path)


def test_repair_loader_fills_it_in(tmp_path: Path) -> None:
    save(tmp_path, [USER, ASST])
    conv, added = load_session_repair("t", tmp_path)
    assert added == 1
    assert [m["role"] for m in conv.turns[0]] == ["user", "assistant", "tool"]
    assert conv.turns[0][2]["tool_call_id"] == "c1"


def test_healthy_file_needs_no_repair(tmp_path: Path) -> None:
    done = {"role": "tool", "tool_call_id": "c1", "content": "{}"}
    save(tmp_path, [USER, ASST, done, {"role": "assistant", "content": "好了"}])
    assert load_session_repair("t", tmp_path)[1] == 0


def test_repair_does_not_hide_other_problems(tmp_path: Path) -> None:
    save(tmp_path, [{"role": "assistant", "content": "没有 user 开头"}])
    with pytest.raises(SessionError, match="user"):
        load_session_repair("t", tmp_path)


def test_file_on_disk_is_not_rewritten(tmp_path: Path) -> None:
    save(tmp_path, [USER, ASST])
    before = (tmp_path / "t.json").read_text(encoding="utf-8")
    load_session_repair("t", tmp_path)
    assert (tmp_path / "t.json").read_text(encoding="utf-8") == before


def test_garbage_file(tmp_path: Path) -> None:
    (tmp_path / "t.json").write_text(json.dumps({"system": "s"}), encoding="utf-8")
    with pytest.raises(SessionError, match="不是合法的会话文件"):
        load_session_repair("t", tmp_path)
```

<div class="line-notes">

- `import copy` 深拷贝轮,免得改到共享的常量。
- `from part03.sessions_repair import load_session_repair` 被测对象。
- `from part03.sessions_tools import load_session_tools` Day 160 的严格加载器,对照用。
- `USER: dict[str, Any] = {"role": "user", "content": "INV-2026-0042 什么状态?"}` 一轮的开头。
- `ASST: dict[str, Any] = {"role": "assistant", "content": "", "tool_calls": [CALL]}` 带一个请求的 assistant 消息。
- `def save(tmp_path: Path, turn: list[dict[str, Any]]) -> None:` 辅助函数:把一轮存成会话文件。
- `save(tmp_path, [USER, ASST])` 崩在中途的会话:有请求,没有结果。
- `with pytest.raises(SessionError, match="没收到结果"):` 严格加载器拒绝。
- `assert added == 1` 补了一条。
- `assert [m["role"] for m in conv.turns[0]] == ["user", "assistant", "tool"]` 补完之后这一轮有三条。
- `assert conv.turns[0][2]["tool_call_id"] == "c1"` 补的那条回应的是 c1。
- `done = {"role": "tool", "tool_call_id": "c1", "content": "{}"}` 一个完整的轮需要的 tool 消息。
- `assert load_session_repair("t", tmp_path)[1] == 0` 健康的文件补 0 条。
- `save(tmp_path, [{"role": "assistant", "content": "没有 user 开头"}])` 另一种坏:第一条不是 user。
- `with pytest.raises(SessionError, match="user"):` 补齐不能把这种问题盖过去,仍然要拒绝。
- `before = (tmp_path / "t.json").read_text(encoding="utf-8")` 读之前文件的内容。
- `assert (tmp_path / "t.json").read_text(encoding="utf-8") == before` 读完以后文件一字未动。
- `(tmp_path / "t.json").write_text(json.dumps({"system": "s"}), encoding="utf-8")` 一个只有 `system` 的文件,没有 `turns`。
- `with pytest.raises(SessionError, match="不是合法的会话文件"):` 缺 `turns` 走 `KeyError` 那条分支,统一成 `SessionError`。

</div>

```bash
uv run pytest -q tests/test_sessions_repair.py
```

```text
......                                                                   [100%]
6 passed in 2.24s
```

六个测试通过。第三个测试和第五个测试看起来无关紧要,其实各守着一条边界:补齐不能把别的问题当成「小事」放过,读取也不能悄悄改文件。如果要把补齐的结果真的存回去,应该是一个明确的动作(比如 `/repair` 命令),并且先备份,而不是每次读都顺手改。

</details>

**验收标准:** 能不看文章画出「三个请求,漏哪个都 400,顺序不限,重复不行」的图,并说出为什么报错不告诉你缺哪个;能说出四种悄悄漏回的写法;`tests/test_repair_history.py`、`tests/test_answer_all.py`、`tests/test_sessions_repair.py` 全部通过(共 16 个);能解释为什么「悄悄改小 assistant 消息」能骗过服务端却不应该这样做。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 悬空请求(dangling) | 模型已经提出、历史里却没有对应 tool 消息的请求。带着它发请求就是 400 |
| `insufficient tool messages` | 服务端 400 的关键词:assistant 消息的 `tool_calls` 后面,tool 消息不够数。每个请求恰好一条,紧跟着,顺序不限 |
| 补齐(repair) | 给悬空的请求补一条「没有执行」的 tool 消息,放在它该在的位置。是恢复,不是掩盖,要记日志 |
| 不变量(invariant) | 无论怎么走都保持成立的性质。`answer_all` 的不变量:输出的 tool 消息和输入的请求一一对应 |
| 幂等(idempotent) | 做一次和做多次结果一样。`close_dangling` 对已经补好的历史再调用一次不会再改 |
| 重复 `tool_call_id` | 同一个 id 出现在两条 tool 消息里,另一种 400:`Duplicate value for 'tool_call_id'` |
| 白名单遗漏 | 工具定义发给模型了,但执行端的白名单里没登记。不回应这个请求就是 400,回一句「没有这个工具」就是 200 |

## 常见误区

**以为只有 id 写错才会 400。** 更常见的是根本没回:循环里 `continue`、`break`、过滤,都会让某个请求没有回应。请求只有一个时看不出来。

**把失败的请求跳过。** 失败了也要回一条,内容是「错误:…」。回应的作用是告诉模型「这个请求有结局了」,不管结局是好是坏。

**以为报错会告诉你缺哪个。** 今天实测只有重复 id 那一种会点名;缺回应的那句 400 不点名,漏第一个、第二个、最后一个报错一字不差。要自己在本地数,Day 159 的 `check_messages` 就干这个。

**用「改小 assistant 消息」绕过 400。** 服务端放行,模型会觉得自己没提过那个请求,或者重新提一遍。对有副作用的工具,这意味着重复执行。

**以为 tool 消息要按请求的顺序放。** 实测 DeepSeek 六种顺序全是 200。并发执行时谁先完成谁先放,不用特地排回去。(别的厂商以文档为准,我没有一一实测。)

**往已经坏了的历史后面继续发请求。** 一条悬空请求会让这段历史之后的每一次请求都是 400,用户在这个会话里永远卡住。要么补齐,要么新开会话。

**补齐后不留痕迹。** 补齐会让模型重新提请求,一个反复崩在同一个工具上的会话会无声地反复补、反复重试。补的时候写日志,Agent 循环里要有最大步数。

**以为 `execute_call` 不抛异常就万事大吉。** 它自己是安全的,但调用它的循环可能漏掉请求。保证「每个请求一条回应」要在循环这一层做,`answer_all` 就是为此写的。

## 学习资料

### 文档与文章

- [Anthropic 文档:Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls):英文,里面有一段明确列出了 tool_result 必须紧跟在 tool_use 之后,并给出了同类的报错关键词(`tool_use ids were found without tool_result blocks immediately after`)。格式和我们的不同,规矩是一回事。
- [Anthropic 文档:Parallel tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use):英文,讲一次多个请求怎么执行、怎么回传,里面有一句直接对应今天:选择不执行某个调用时,仍然要为它返回 `tool_result`,`is_error: true` 加一句说明。明天的内容也从这里开始。
- [OpenAI 文档:Function calling](https://developers.openai.com/api/docs/guides/function-calling):英文,各家兼容协议的原版。文档里的示例循环遍历每一个 `function_call` 并回一条输出,并建议「假设会有多个」。我查过,文档本身没有写漏回会怎样,今天的实测是自己做的。
- [DeepSeek 文档:Tool Calls](https://api-docs.deepseek.com/zh-cn/guides/tool_calls):中文,今天所有实验的服务端。
- [Python 文档:itertools](https://docs.python.org/zh-cn/3.12/library/itertools.html):中文,看 `product` 和 `permutations` 两节,练习 1 用到。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wSaR6gEFS&autoplay=0&high_quality=1" title="Agent系统里工具调用失败，你怎么重试、怎么兜底" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵AI大模型 · Agent系统里工具调用失败,你怎么重试、怎么兜底 · 5 分 23 秒,2026 年 10 月。讲工具失败以后的重试和兜底,对照今天:失败不是跳过,是要回一条「错误:…」,以及补齐之后模型会重试。我只核对了标题和时长,没有逐帧看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vqNX6xEDC&autoplay=0&high_quality=1" title="大模型面试:Agent工具调用失败怎么处理?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI-Agent搭建 · 大模型面试:Agent工具调用失败怎么处理? · 3 分 11 秒,2026 年 7 月。Day 160 推荐过的面试口径短视频,今天学完「每个请求都要回」,再看一遍,留意它有没有讲到这一点。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/eRoe82YZ9JY" title="LLM Tool Errors: Return Failures Your Agent Can Use" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AISLabs AI · LLM Tool Errors: Return Failures Your Agent Can Use · 英文。标题就是今天的主题:工具失败了要返回模型能用的信息。按标题和简介选的,我没有逐帧看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/kRgorBIe5IM" title="LLM Tool Calling Explained: Why Your AI Agent Keeps Failing" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Rahul Sharma · LLM Tool Calling Explained: Why Your AI Agent Keeps Failing · 英文。讲工具调用常见的失败原因。按标题选的,我没有逐帧看,看的时候对照今天的四种漏回写法。</figcaption>
</figure>

### 书籍

今天这组不需要。

### 开源项目与代码

- [anthropics/anthropic-sdk-python](https://github.com/anthropics/anthropic-sdk-python):Claude 的 Python SDK,它有一个 Tool Runner,替你处理「每个请求一条结果」这件事。想看官方是怎么在循环里保证不漏的,可以搜 `tool_result`。
- [openai/openai-python](https://github.com/openai/openai-python):我们用的 SDK,`examples` 里有带工具调用的完整循环可以对照。

## 自测

1. 一条 assistant 消息提了三个请求,后面只跟了两条 tool 消息,会怎样?漏第一个和漏最后一个的报错有区别吗?

<details><summary>答案</summary>

400,`insufficient tool messages following tool_calls message`。漏哪一个报错都一样,服务端不告诉你缺的是哪个,所以要在本地数 id(`check_messages`)。

</details>

2. 三条 tool 消息的顺序和三个请求的顺序不一致,可以吗?两条 tool 消息用了同一个 id 呢?

<details><summary>答案</summary>

顺序不限,实测六种排列全是 200,对应关系靠 `tool_call_id`。同一个 id 用两次是另一种 400:`Duplicate value for 'tool_call_id'`,并且那个没被回应的请求仍然是缺的。

</details>

3. 「过滤掉没登记的工具请求」这种写法错在哪?应该怎么写?

<details><summary>答案</summary>

没登记的请求同样是模型提出的请求,没有回应就是 400。应该让每个请求都走 `execute_call`,没登记的由第一道关返回「错误:没有叫 'xxx' 的工具,可用的工具:…」,这样既满足规矩,模型也能如实告诉用户这一半办不到。

</details>

4. 为什么「悄悄把 assistant 消息改小再回」能通过服务端,却不应该这样做?

<details><summary>答案</summary>

服务端只检查请求和回应成对,不检查你是否改过模型说的话。但改小以后模型会以为自己没提过那个请求,或者重新提一遍(实测重新提了上海的请求)。对发邮件、扣款这类有副作用的工具,重提就是重复执行。要处理的是回应每一个请求,不是改历史。

</details>

5. 面试题:「Agent 在工具执行到一半时进程崩了,会话已经存了盘。下次用户接着聊,会发生什么?你怎么处理?」

<details><summary>答案</summary>

历史里有一条带 `tool_calls` 的 assistant 消息但缺对应的 tool 消息,下一次请求会被服务端 400 拒绝(`insufficient tool messages`),而且之后每一次都会,用户在这个会话里卡死。处理分两层。预防:每个请求在循环里一定回一条(失败也回),并且 assistant 消息和它的结果作为一个整体保存或者都不保存。恢复:读取会话时检测悬空请求,补一条「没有执行(程序中断了)」的 tool 消息,让模型据此决定要不要重新提请求;只读工具可以这样重试,有副作用的工具要补「结果未知,请先确认」,并且记日志。

</details>

6. 面试题:「为什么只有一个工具请求时没问题,模型开始并行提多个请求才出 400?」

<details><summary>答案</summary>

因为漏回大多出在「遍历请求」的代码里:只取 `tool_calls[0]`、失败就 `continue`、过滤没登记的、遇错 `break`。请求只有一个时,这些写法恰好都处理到了唯一的那个;多个请求时才有「被漏掉的另一个」。所以测试要专门造一次提多个请求的情形,并且让其中某一个失败。

</details>

## 明天预告

Day 162 · 并行工具调用。今天的实验里模型已经多次一口气提了两三个请求(北京、上海、广州)。明天正面讲它:一次响应里有几个 `tool_calls`、怎么判断它们之间有没有依赖、怎么并发执行(`asyncio.gather` 和线程池,对照 JS 的 `Promise.all`)、并发执行时顺序怎么保证、有副作用的工具为什么要小心,以及怎么让模型别并行(`parallel_tool_calls`)。今天学的「每个请求都要回,顺序不限」就是明天并发执行的前提。
