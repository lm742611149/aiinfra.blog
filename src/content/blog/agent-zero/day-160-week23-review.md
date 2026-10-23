---
title: 'Day 160 · 第 23 周复习:工具与 Agent 循环(Day 154–159)'
description: '这一周把聊天机器人收了尾(成本行、切换厂商、被打断的调用、保存会话),然后从「模型不会执行,它只写一段 JSON」走到完整的两轮工具调用。今天画知识地图,用不联网的检查脚本验收默写的 execute_call 和 two_rounds,把本周八个坑一次性复现,做一个发票客服小项目(8 道题,第一版 7/8,把内部异常名说给了用户),并发现两处周内模块拼不上:Day 155 的会话保存读不回带 tool 消息的对话,Day 154 的成本行只算了最后一次请求。'
pubDate: 2026-10-23
regime: none
tags: ['function-calling', 'tool-use', 'review', 'agent-zero']
series: 'agent-zero'
day: 160
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 把工具调用的第二半补完了:原样放回模型那条带 `tool_calls` 的 assistant 消息,按 `tool_call_id` 一条一条放回 `role` 为 `tool` 的结果,再发第二次请求。故意违反每条规矩,拿到了两个 400、两个 422,还有一个没有报错的现象:工具结果是空字符串时,模型编出了「北京 26°C」,真实温度是 12.5°C。

今天是第 23 周的复习日,不学新东西。这一周从 Day 154 到 Day 159,前两天是聊天机器人的收尾,后四天是第三部分的开头:工具调用的整条链路第一次完整地走通了。链路里每一环都有一两个「不会报错、但结果是错的」的坑,值得停下来一次性理一遍,并且验证一下这几天写的东西拼在一起会不会出问题。

## 今天要解决的问题

学完今天你应该能做到:

1. 不看文章,按顺序说出一次工具调用的七个步骤,每一步由谁做(模型还是我们的代码),以及本周遇到的每一个坑出在哪一步。
2. 默写 `execute_call()` 和 `two_rounds()` 两段核心代码,用今天的检查脚本验收,16 项全部打勾。
3. 用本周的东西做一个发票客服小工具,用 8 道题验收,并能看出「格式没问题、但对用户不友好」的那一类问题。

预计用时:3 小时,实跑花费不到 ¥0.05(每个联网脚本几厘到一分钱,算式在文末汇总)。前置:[Day 154](/blog/agent-zero/day-154-chatbot-2/) 到 [Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 的全部文件,在 `agent-zero-lab/part02/`、`part03/` 里;`part03/tool_runner.py`、`part03/weather_tool.py`、`part03/weather_api.py`、`part03/check_messages.py` 今天都会用到。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把「默写」那一节的两段代码再默写一次,跑检查脚本;做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

今天的实验和前几天一样的边界:天气函数联网只查 Open-Meteo,发票工具只读代码里写死的三张虚构发票,不读写任何文件(练习 2 的会话文件写在系统临时目录里,脚本结束就删),不执行任何模型给的字符串。

## 本周知识地图

这一周其实在回答一个问题:**模型想用一个工具,我们的程序要做哪些事,才能让它安全、准确地拿到结果,并且每一步出错了都看得见。**

<figure>
<svg viewBox="0 0 640 372" role="img" aria-label="第 23 周知识地图:左上是聊天机器人的三个收尾,右上是工具调用四天各自的主题,下面是一次工具调用的五个环节,模型一侧的是蓝色,我们的代码一侧的是琥珀色">
<rect x="0" y="0" width="640" height="372" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">聊天机器人收尾(154–155)</text>
<rect x="20" y="34" width="250" height="34" rx="4" fill="none" stroke="var(--rule)"/>
<text x="30" y="55" fill="var(--ink-soft)">154 每轮成本行 + /env 切换</text>
<rect x="20" y="76" width="250" height="34" rx="4" fill="none" stroke="var(--rule)"/>
<text x="30" y="97" fill="var(--ink-soft)">154 被打断的调用只能估算</text>
<rect x="20" y="118" width="250" height="34" rx="4" fill="none" stroke="var(--rule)"/>
<text x="30" y="139" fill="var(--ink-soft)">155 /save /load:文件名白名单</text>
<text x="30" y="166" fill="var(--ink-faint)" font-size="11">读回来的文件也不能信,要校验</text>
<text x="320" y="24" fill="var(--ink)">工具调用(156–159)</text>
<rect x="320" y="34" width="300" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="330" y="55" fill="var(--ink)">156 模型只写请求,不执行</text>
<rect x="320" y="76" width="300" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="330" y="97" fill="var(--ink)">157 name/description/parameters</text>
<rect x="320" y="118" width="300" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="330" y="139" fill="var(--ink)">158 解析、校验、执行,失败变字符串</text>
<rect x="320" y="160" width="300" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="330" y="181" fill="var(--ink)">159 tool 消息按 id 放回,发请求 2</text>
<line x1="20" y1="214" x2="620" y2="214" stroke="var(--rule)"/>
<text x="20" y="238" fill="var(--ink)">一次工具调用的五个环节</text>
<rect x="20" y="250" width="108" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="272" fill="var(--ink)">请求 1</text>
<text x="30" y="290" fill="var(--ink-soft)" font-size="11">带 tools</text>
<rect x="143" y="250" width="108" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="153" y="272" fill="var(--ink)">模型回</text>
<text x="153" y="290" fill="var(--ink-soft)" font-size="11">tool_calls</text>
<rect x="266" y="250" width="108" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="276" y="272" fill="var(--ink)">本地检查</text>
<text x="276" y="290" fill="var(--ink-soft)" font-size="11">再执行</text>
<rect x="389" y="250" width="108" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="399" y="272" fill="var(--ink)">tool 消息</text>
<text x="399" y="290" fill="var(--ink-soft)" font-size="11">按 id 放回</text>
<rect x="512" y="250" width="108" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="522" y="272" fill="var(--ink)">请求 2</text>
<text x="522" y="290" fill="var(--ink-soft)" font-size="11">模型回答</text>
<line x1="128" y1="278" x2="143" y2="278" stroke="var(--ink-faint)"/>
<line x1="251" y1="278" x2="266" y2="278" stroke="var(--ink-faint)"/>
<line x1="374" y1="278" x2="389" y2="278" stroke="var(--ink-faint)"/>
<line x1="497" y1="278" x2="512" y2="278" stroke="var(--ink-faint)"/>
<text x="20" y="328" fill="var(--ink-faint)" font-size="11">157 管「模型看到什么」,158 管第三个框,159 管第四、五个框,156 是整张图的前提</text>
<text x="20" y="348" fill="var(--ink-faint)" font-size="11">共同点:模型给的东西先别信,我们给模型的东西也别留空,每一步出错都要变成一句看得懂的话</text>
</g>
</svg>
<figcaption>蓝色是模型一侧产生的,琥珀色是我们的代码做的。五个环节里有三个是我们自己的代码,所以工具调用里大部分「出了问题」,出在我们这一侧。</figcaption>
</figure>

用一句话串起来:**模型只负责写请求和写回答,中间所有的事(检查、执行、配对、兜底)都是我们的代码,而且每一环出错都不一定会报错。**

这周最容易混的是「没报错」和「没问题」之间的距离。Day 157 的 `enum` 管住了词汇,却管不住意图,用户要「作废」的发票,模型把 `status` 整个省掉,查回了所有发票,没有任何错误。Day 158 的 `finish_reason` 变成 `length`,`tool_calls` 里躺着半截 JSON,也没有错误。Day 159 的空字符串让模型编出 26°C,同样没有错误。三次都是程序一路绿灯,用户看到的是一个看起来正常的错误答案。

## 本周每天一句话

- [Day 154](/blog/agent-zero/day-154-chatbot-2/):聊天机器人每轮回答后打印首字延迟、token 和本轮花费;`/env` 在 DeepSeek 和硅基流动之间切换,故意踩了一次配置串味(价格悄悄沿用上一家的,少算了 14%);被 Ctrl+C 打断的调用没进账单,只能按字数估算。
- [Day 155](/blog/agent-zero/day-155-chatbot-3/):`/save`、`/load`、`/system`;`Conversation` 要加 `to_dict` 和 `from_dict` 才能存;文件名用白名单(`../x` 和 `/etc/hosts` 都能跳出目录),读回来的文件用 pydantic 校验;改 system 开头那句话会让缓存全部失效,末尾加一句不会。
- [Day 156](/blog/agent-zero/day-156-fc-idea/):模型不会执行函数,它只写一段 JSON 请求;先不用 `tools` 参数,纯聊天加 `json.loads` 手搓一次,再看官方通道返回的原始响应:`finish_reason` 是 `tool_calls`,`arguments` 是字符串,参数是不可信的输入。
- [Day 157](/blog/agent-zero/day-157-tool-schema/):工具定义是写给模型看的提示词;两个工具名字区分不开时,描述含糊选对率 3/12,写清 12/12,名字和描述互相矛盾 0/12;`enum` 管词汇不管意图,`required` 只是提示;本地用 jsonschema 再检查一遍,并显式加 `additionalProperties: false`。
- [Day 158](/blog/agent-zero/day-158-fc-first-run/):接上真的天气函数,写了 `execute_call` 的四道关(白名单、解析 JSON、schema 检查、执行),所有失败都变成「错误:…」字符串而不是抛异常;`max_tokens` 把 `arguments` 截断时 `finish_reason` 是 `length`;不能把模型给的城市名拼进 URL。
- [Day 159](/blog/agent-zero/day-159-tool-roundtrip/):第二次请求要放回 assistant 消息和每个请求对应的 tool 消息;漏 assistant 是 400、id 写错是 400、`content` 放字典是 422、漏 `tool_call_id` 是 422;`content` 为空时模型会编数字;`Conversation` 按「轮」截断,保护请求和结果成对。

## 默写两段核心代码

这周要能默写的是两段:`execute_call()`(Day 158 的四道关)和 `two_rounds()`(Day 159 `roundtrip_min.py` 里 `main()` 的三个动作,今天包成一个函数)。

先合上前面的文章,新建 `part03/dictation160.py`,把这两段写出来。开头的 `import`、`FUNCS` 字典、`ChatLike` 这个小类型和两个函数的函数头,可以直接从本节末尾折叠起来的参考写法里抄(`ChatLike` 的意思在那里解释),函数体自己写。写完别急着对答案,先跑下面的检查脚本。它用一个假客户端和一个本地的假工具测每个分支,**不联网、不花钱**,哪条打叉就回去看哪一段。

新建 `part03/review160_check.py`:

```python
# agent-zero-lab/part03/review160_check.py
"""默写完 execute_call()、two_rounds() 后跑这个脚本,不联网、不花钱。"""
import copy
import json
from collections.abc import Callable
from types import SimpleNamespace
from typing import Any

from part03.dictation160 import execute_call, two_rounds

# 一个本地的假工具,不碰网络
ECHO_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "echo",
        "description": "把 text 原样返回。",
        "parameters": {
            "type": "object",
            "properties": {"text": {"type": "string"}, "times": {"type": "integer", "minimum": 1}},
            "required": ["text"],
        },
    },
}


def echo(text: str, times: int = 1) -> dict[str, Any]:
    return {"echo": text * times}


def boom(**_: Any) -> None:
    raise RuntimeError("数据库密码是 hunter2")  # 不应该出现在发给模型的字符串里


def empty(**_: Any) -> str:
    return ""


FUNCS = {"echo": echo}


def call_of(args: str, name: str = "echo", cid: str = "call_00_x") -> dict[str, Any]:
    return {"id": cid, "type": "function", "function": {"name": name, "arguments": args}}


class FakeClient:
    """按顺序吐预先写好的回复,同时把每次收到的 messages 拷贝下来。"""

    def __init__(self, replies: list[dict[str, Any]]) -> None:
        self.replies = list(replies)
        self.seen: list[list[dict[str, Any]]] = []
        self.kws: list[dict[str, Any]] = []

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> Any:
        self.seen.append(copy.deepcopy(messages))
        self.kws.append(kw)
        m = self.replies.pop(0)
        return SimpleNamespace(message=m, content=m.get("content") or "", finish_reason="stop")


def check(name: str, test: Callable[[], bool]) -> None:
    """跑一条检查。默写错了可能让检查本身抛异常(比如列表下标越界),这也算没通过,不要让整个脚本崩掉。"""
    try:
        ok = test()
    except Exception as e:  # noqa: BLE001
        print("✗", name, f"(抛了 {type(e).__name__})")
        return
    print("✓" if ok else "✗", name)


def check_execute() -> None:
    tools = [ECHO_TOOL]
    r = execute_call(call_of('{"text": "北京"}'), tools, FUNCS)
    check("execute_call:正常调用返回 JSON 字符串、中文不转义", lambda: r == '{"echo": "北京"}')
    check("execute_call:没登记的名字 → 错误", lambda: execute_call(call_of("{}", name="rm_all"), tools, FUNCS).startswith("错误:没有叫 'rm_all'"))
    check("execute_call:arguments 被截断 → 错误,不抛异常", lambda: execute_call(call_of('{"text": "北'), tools, FUNCS).startswith("错误:arguments 不是合法的 JSON"))
    check("execute_call:缺必填 → 错误", lambda: "text" in execute_call(call_of("{}"), tools, FUNCS))
    check("execute_call:类型不对 → 错误", lambda: execute_call(call_of('{"text": "a", "times": "3"}'), tools, FUNCS).startswith("错误:参数不合格"))
    check("execute_call:多塞的参数 → 错误", lambda: execute_call(call_of('{"text": "a", "admin": true}'), tools, FUNCS).startswith("错误:参数不合格"))
    r = execute_call(call_of('{"text": "a"}', name="echo"), tools, {"echo": boom})
    check("execute_call:工具自己抛异常 → 只给类型名,不泄露原文", lambda: r == "错误:工具内部出错(RuntimeError)" and "hunter2" not in r)


def check_two_rounds() -> None:
    tools = [ECHO_TOOL]
    asst = {"role": "assistant", "content": "", "tool_calls": [call_of('{"text": "hi", "times": 2}', cid="call_00_abc")]}
    final = {"role": "assistant", "content": "结果是 hihi"}

    msgs: list[dict[str, Any]] = [{"role": "system", "content": "s"}, {"role": "user", "content": "q"}]
    fake = FakeClient([asst, final])
    out = two_rounds(fake, msgs, tools, FUNCS)
    second = fake.seen[1]
    check("two_rounds:返回第二次请求的回答", lambda: out == "结果是 hihi")
    check("two_rounds:第二次请求的角色顺序是 system/user/assistant/tool", lambda: [m["role"] for m in second] == ["system", "user", "assistant", "tool"])
    check("two_rounds:assistant 消息原样放回(含 tool_calls)", lambda: second[2] == asst)
    check("two_rounds:tool_call_id 抄的是请求的 id", lambda: second[3]["tool_call_id"] == "call_00_abc")
    check("two_rounds:tool 的 content 是字符串且是执行结果", lambda: second[3]["content"] == json.dumps({"echo": "hihi"}))
    check("two_rounds:两次请求都带 tools", lambda: all(kw.get("tools") == tools for kw in fake.kws))

    fake = FakeClient([{"role": "assistant", "content": "你好"}])
    out = two_rounds(fake, [{"role": "user", "content": "你好"}], tools, FUNCS)
    check("two_rounds:模型没提请求就直接返回,只发一次请求", lambda: out == "你好" and len(fake.seen) == 1)

    fake = FakeClient([asst, final])
    two_rounds(fake, [{"role": "user", "content": "q"}], tools, {"echo": empty})
    check("two_rounds:工具返回空字符串 → tool 消息的 content 也不是空的", lambda: fake.seen[1][-1]["content"].strip() != "")

    two = {"role": "assistant", "content": "", "tool_calls": [call_of('{"text": "a"}', cid="c1"), call_of('{"text": "b"}', cid="c2")]}
    fake = FakeClient([two, final])
    two_rounds(fake, [{"role": "user", "content": "q"}], tools, FUNCS)
    tail = fake.seen[1][-2:]
    check("two_rounds:两个请求 → 两条 tool 消息,id 各对各的", lambda: [m["tool_call_id"] for m in tail] == ["c1", "c2"])


if __name__ == "__main__":
    check_execute()
    check_two_rounds()
```

<div class="line-notes">

- `import copy` 假客户端要把每次收到的 `messages` 深拷贝一份存下来。原因下面会讲:`two_rounds` 会往同一个列表里 `append`,不拷贝的话,事后回头看第一次请求发了什么,看到的已经是被改过的列表。
- `import json` 用来算「正确的 tool 消息内容应该是什么」。
- `from collections.abc import Callable` 给下面 `check` 的参数标类型:一个不带参数、返回 `bool` 的函数。
- `from types import SimpleNamespace` 随手造一个带属性的对象,假客户端的返回值用它,相当于 JS 里随手写 `{ message, content }`。
- `from part03.dictation160 import execute_call, two_rounds` 被检查的对象:你默写的那个文件。
- `ECHO_TOOL: dict[str, Any] = {` 一个本地的假工具定义,名字叫 `echo`,参数 `text` 必填、`times` 可选且至少是 1,检查脚本全靠它,不碰网络。
- `def echo(text: str, times: int = 1) -> dict[str, Any]:` 对应的函数:`echo("hi", 2)` 返回 `{"echo": "hihi"}`。
- `def boom(**_: Any) -> None:` 一个一定抛异常的工具,专门测「工具自己出了 bug」这一关。
- `raise RuntimeError("数据库密码是 hunter2")  # 不应该出现在发给模型的字符串里` 故意把一句「机密」塞进异常原文。Day 158 的规矩是只给模型看异常的类型名,这句话就是用来验证这一点的。
- `def empty(**_: Any) -> str:` 一个只返回空字符串的工具,测 Day 159 的空结果。
- `FUNCS = {"echo": echo}` 白名单,只登记了 `echo` 一个。
- `def call_of(args: str, name: str = "echo", cid: str = "call_00_x") -> dict[str, Any]:` 造一条请求。`args` 是字符串,正好模拟模型给的 `arguments`(字符串形式的 JSON),可以故意传一个被截断的。
- `class FakeClient:` 一个假的模型客户端:按顺序吐出提前写好的回复。
- `self.replies = list(replies)` 拷贝一份,后面 `pop(0)` 不会改到调用者的列表。
- `self.seen: list[list[dict[str, Any]]] = []` 每次 `chat` 收到的 `messages`(深拷贝)。`fake.seen[1]` 就是第二次请求发出去的完整历史。
- `self.kws: list[dict[str, Any]] = []` 每次收到的关键字参数,用来查「第二次请求有没有带 `tools`」。
- `self.seen.append(copy.deepcopy(messages))` 存拷贝而不是引用。`two_rounds` 先发请求 1,再往同一个列表里 `append`,要是存引用,`seen[0]` 事后也会变成 4 条。
- `m = self.replies.pop(0)` 取出这一次该返回的回复,先进先出。
- `return SimpleNamespace(message=m, content=m.get("content") or "", finish_reason="stop")` 返回值只带 `two_rounds` 会用到的三个属性。`m.get("content") or ""` 对付 `content` 是 `None` 的回复。
- `def check(name: str, test: Callable[[], bool]) -> None:` 跑一条检查。参数是一个函数而不是一个值,为什么这样写,看下面的 `except`。
- `ok = test()` 真正执行检查。
- `except Exception as e:  # noqa: BLE001` 默写错了的代码可能让检查本身抛异常:比如漏了 `append`,`second[3]` 就是列表下标越界。这种情况也算没通过,打一个叉并写上异常的名字,别让整个脚本崩掉、后面的项一个都看不到。
- `print("✗", name, f"(抛了 {type(e).__name__})")` 实测漏掉 `append` 时会看到 `(抛了 IndexError)`。
- `print("✓" if ok else "✗", name)` 通过打勾,不通过打叉。
- `def check_execute() -> None:` 七项 `execute_call` 的检查。
- `r = execute_call(call_of('{"text": "北京"}'), tools, FUNCS)` 正常调用:`echo("北京")` 返回 `{"echo": "北京"}`,所以 `r` 应该是字符串 `'{"echo": "北京"}'`,中文原样,没有 `北`。
- `lambda: execute_call(call_of("{}", name="rm_all"), tools, FUNCS).startswith("错误:没有叫 'rm_all'")` 模型要调一个没登记的名字,必须返回「错误:没有叫 'rm_all' 的工具…」。
- `call_of('{"text": "北')` 手工造一段被截断的 `arguments`,和 Day 158 实验里 `max_tokens` 截断的样子一样,期望返回「错误:arguments 不是合法的 JSON」,而不是抛 `JSONDecodeError`。
- `"text" in execute_call(call_of("{}"), tools, FUNCS)` 缺必填参数,jsonschema 的报错会点出缺 `text`。
- `call_of('{"text": "a", "times": "3"}')` `times` 应该是整数,传了字符串 `"3"`,类型检查要拦住。
- `call_of('{"text": "a", "admin": true}')` 多塞一个 schema 里没有的参数 `admin`,靠 `additionalProperties: false` 拦住。
- `r = execute_call(call_of('{"text": "a"}', name="echo"), tools, {"echo": boom})` 把 `echo` 换成会抛异常的 `boom`,看返回什么。
- `lambda: r == "错误:工具内部出错(RuntimeError)" and "hunter2" not in r` 两个条件:只有异常的类型名,并且「机密」没有出现在返回值里。
- `def check_two_rounds() -> None:` 九项 `two_rounds` 的检查。
- `asst = {"role": "assistant", "content": "", "tool_calls": [call_of('{"text": "hi", "times": 2}', cid="call_00_abc")]}` 假模型的第一次回复:要调 `echo("hi", 2)`,请求 id 是 `call_00_abc`。
- `final = {"role": "assistant", "content": "结果是 hihi"}` 假模型的第二次回复,也就是最终回答。
- `msgs: list[dict[str, Any]] = [{"role": "system", "content": "s"}, {"role": "user", "content": "q"}]` 起始历史两条。
- `fake = FakeClient([asst, final])` 先返回 `asst`,再返回 `final`。
- `out = two_rounds(fake, msgs, tools, FUNCS)` 跑你默写的函数。
- `second = fake.seen[1]` 第二次请求发出去的历史,后面几项都在检查它。
- `lambda: [m["role"] for m in second] == ["system", "user", "assistant", "tool"]` 角色顺序,4 条。
- `lambda: second[2] == asst` 第三条必须和模型回的那条一模一样(Day 159 说的「原样放回」)。
- `lambda: second[3]["tool_call_id"] == "call_00_abc"` tool 消息抄的是请求的 id,不是自己编的。
- `lambda: second[3]["content"] == json.dumps({"echo": "hihi"})` 内容是结果的 JSON 字符串。
- `lambda: all(kw.get("tools") == tools for kw in fake.kws)` 两次请求都带了 `tools`(Day 159 的习惯)。
- `fake = FakeClient([{"role": "assistant", "content": "你好"}])` 模型这次没提请求,直接回答。
- `lambda: out == "你好" and len(fake.seen) == 1` 应该直接返回回答,并且只发了一次请求。
- `two_rounds(fake, [{"role": "user", "content": "q"}], tools, {"echo": empty})` 工具返回空字符串。
- `lambda: fake.seen[1][-1]["content"].strip() != ""` 最后一条 tool 消息的 `content` 不能是空的。注意这一项检查的是「不是空」,没有要求等于某句固定的话,原因在后面的「坑」那一节。
- `two = {"role": "assistant", "content": "", "tool_calls": [call_of('{"text": "a"}', cid="c1"), call_of('{"text": "b"}', cid="c2")]}` 一次提了两个请求,id 分别是 `c1` 和 `c2`(后天 Day 162 的主题,今天只确认写成循环的代码自然就支持)。
- `tail = fake.seen[1][-2:]` 取最后两条,应该是两条 tool 消息。
- `lambda: [m["tool_call_id"] for m in tail] == ["c1", "c2"]` 两条消息的 id 各对各的,顺序和请求一致。

</div>

`dictation160.py` 还没写的时候跑它,会直接报 `ModuleNotFoundError`,这是正常的。写完再跑:

```bash
uv run python -m part03.review160_check
```

下面是我的默写版本通过的样子:

```text
✓ execute_call:正常调用返回 JSON 字符串、中文不转义
✓ execute_call:没登记的名字 → 错误
✓ execute_call:arguments 被截断 → 错误,不抛异常
✓ execute_call:缺必填 → 错误
✓ execute_call:类型不对 → 错误
✓ execute_call:多塞的参数 → 错误
✓ execute_call:工具自己抛异常 → 只给类型名,不泄露原文
✓ two_rounds:返回第二次请求的回答
✓ two_rounds:第二次请求的角色顺序是 system/user/assistant/tool
✓ two_rounds:assistant 消息原样放回(含 tool_calls)
✓ two_rounds:tool_call_id 抄的是请求的 id
✓ two_rounds:tool 的 content 是字符串且是执行结果
✓ two_rounds:两次请求都带 tools
✓ two_rounds:模型没提请求就直接返回,只发一次请求
✓ two_rounds:工具返回空字符串 → tool 消息的 content 也不是空的
✓ two_rounds:两个请求 → 两条 tool 消息,id 各对各的
```

16 项全部打勾。我还故意做了一个常见的默写错误,删掉 `messages.append(first.message)` 那一行(忘了把模型那条消息放回去),看检查脚本怎么说:

```text
✗ two_rounds:第二次请求的角色顺序是 system/user/assistant/tool
✗ two_rounds:assistant 消息原样放回(含 tool_calls)
✗ two_rounds:tool_call_id 抄的是请求的 id (抛了 IndexError)
✗ two_rounds:tool 的 content 是字符串且是执行结果 (抛了 IndexError)
```

四项变成叉,其中两项带着 `IndexError`:列表只有 3 条,`second[3]` 不存在。读这个结果有个窍门:**先看角色顺序那一项**,它直接告诉你历史长什么样不对,后面的 `IndexError` 只是连锁反应。

下面是我的参考写法。别急着看,先自己默写,跑过检查脚本之后再对照:

<details><summary>参考写法:part03/dictation160.py</summary>

```python
# agent-zero-lab/part03/dictation160.py
"""Day 160 默写文件:execute_call(Day 158)和 two_rounds(Day 159 的三个动作)。"""
import copy
import json
from collections.abc import Callable
from typing import Any, Protocol

from jsonschema import Draft202012Validator

from part03.weather_api import WeatherError, get_weather

FUNCS: dict[str, Callable[..., Any]] = {"get_weather": get_weather}


class ChatLike(Protocol):
    """只要有 chat(messages, **kw) 方法、返回值带 .message 和 .content 就行:LLMClient 满足,测试里的假客户端也满足。"""

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> Any: ...


def execute_call(
    call: dict[str, Any],
    tools: list[dict[str, Any]],
    funcs: dict[str, Callable[..., Any]] = FUNCS,
) -> str:
    fn = call.get("function", {})
    name = fn.get("name")
    schemas = {t["function"]["name"]: t["function"]["parameters"] for t in tools}
    if name not in funcs or name not in schemas:
        return f"错误:没有叫 {name!r} 的工具,可用的工具:{list(funcs)}"

    try:
        args = json.loads(fn.get("arguments", ""))
    except json.JSONDecodeError as e:
        return f"错误:arguments 不是合法的 JSON({e.msg},第 {e.pos} 个字符)"

    schema = copy.deepcopy(schemas[name])
    schema["additionalProperties"] = False
    problems = [e.message for e in Draft202012Validator(schema).iter_errors(args)]
    if problems:
        return "错误:参数不合格:" + ";".join(problems)

    try:
        result = funcs[name](**args)
    except WeatherError as e:
        return f"错误:{e}"
    except Exception as e:  # noqa: BLE001
        return f"错误:工具内部出错({type(e).__name__})"
    return json.dumps(result, ensure_ascii=False)


def two_rounds(
    client: ChatLike,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    funcs: dict[str, Callable[..., Any]] = FUNCS,
) -> str:
    first = client.chat(messages, tools=tools, temperature=0, max_tokens=300)
    calls = first.message.get("tool_calls") or []
    if not calls:
        return first.content

    messages.append(first.message)
    for call in calls:
        result = execute_call(call, tools, funcs) or "(工具没有返回内容)"
        messages.append({"role": "tool", "tool_call_id": call["id"], "content": result})
    second = client.chat(messages, tools=tools, temperature=0, max_tokens=300)
    return second.content
```

<div class="line-notes">

- `import copy` 下面要深拷贝 schema,再往拷贝上加规矩,不动原来的。
- `import json` 解析 `arguments`,序列化结果。
- `from collections.abc import Callable` 给 `funcs` 的类型用。
- `from typing import Any, Protocol` `Protocol` 是 Python 的「结构类型」:只要长得像就算,不需要继承,类似 TypeScript 的 interface。
- `from jsonschema import Draft202012Validator` Day 157 学的本地校验器。
- `from part03.weather_api import WeatherError, get_weather` Day 158 的天气函数和它的专用异常。
- `FUNCS: dict[str, Callable[..., Any]] = {"get_weather": get_weather}` 白名单。模型只能点这张表里有的名字。
- `class ChatLike(Protocol):` 声明「一个客户端要有什么」:`LLMClient` 满足,检查脚本里的 `FakeClient` 也满足,不需要继承任何东西。相当于 TS 里 `interface ChatLike { chat(messages, ...kw): any }`。
- `def chat(self, messages: list[dict[str, Any]], **kw: Any) -> Any: ...` 方法只写签名,函数体用 `...` 占位。
- `def execute_call(` 函数头:一个请求、工具定义列表、白名单。`funcs` 默认就是 `FUNCS`,测试时可以换成假的。
- `fn = call.get("function", {})` 请求里的 `function` 字段,没有就当空字典。
- `name = fn.get("name")` 模型要调的函数名,比如 `"get_weather"`。
- `schemas = {t["function"]["name"]: t["function"]["parameters"] for t in tools}` 字典推导式:从工具定义里取出「名字 → 参数 schema」。
- `if name not in funcs or name not in schemas:` 第一关:名字不在白名单,或者没有对应的定义,都拒绝。
- `return f"错误:没有叫 {name!r} 的工具,可用的工具:{list(funcs)}"` `{name!r}` 带引号显示,检查脚本里 `rm_all` 会显示成 `'rm_all'`。
- `args = json.loads(fn.get("arguments", ""))` 第二关:`arguments` 是字符串,先解析。没有这个字段就当空字符串,`json.loads("")` 同样会失败,走下面的分支。
- `except json.JSONDecodeError as e:` 被截断或写错的 JSON。
- `return f"错误:arguments 不是合法的 JSON({e.msg},第 {e.pos} 个字符)"` 检查脚本里 `'{"text": "北'` 会得到 `Unterminated string starting at`,第 9 个字符。
- `schema = copy.deepcopy(schemas[name])` 拷一份,下一行要改它。
- `schema["additionalProperties"] = False` 我们自己加的规矩:schema 里没写的参数一律不收。
- `problems = [e.message for e in Draft202012Validator(schema).iter_errors(args)]` 第三关:把所有不合格的地方一次收集起来,而不是遇到第一个就停。
- `return "错误:参数不合格:" + ";".join(problems)` 多个问题用分号连起来。
- `result = funcs[name](**args)` 第四关:真的执行。`**args` 把字典展开成关键字参数,`{"text": "hi", "times": 2}` 就是 `echo(text="hi", times=2)`。
- `except WeatherError as e:` 预料之内的失败(找不到城市、超时),原文是我们自己写的人话,可以给模型看。**具体的异常写在前面**,这是 Day 158 的坑。
- `return f"错误:{e}"` 直接用消息。
- `except Exception as e:  # noqa: BLE001` 兜底:工具自己的 bug 不能把整个程序带崩。
- `return f"错误:工具内部出错({type(e).__name__})"` 只给类型名,不给原文,因为原文里可能有路径、SQL、密码。
- `return json.dumps(result, ensure_ascii=False)` 成功:结果转成 JSON 字符串,中文原样(Day 159 练习 3 量过,默认写法每个中文多花 token)。
- `def two_rounds(` 函数头:客户端、历史、工具定义、白名单,返回最终回答。
- `first = client.chat(messages, tools=tools, temperature=0, max_tokens=300)` 请求 1。
- `calls = first.message.get("tool_calls") or []` 模型没提请求时没有这个 key,`.get` 不会 `KeyError`;`or []` 兜住 `None`。
- `if not calls:` 没有请求。
- `return first.content` 模型直接回答了,一次请求就结束。
- `messages.append(first.message)` 动作一:把模型那条消息原样放回去。漏了这一行是 Day 159 的实验一(400)。
- `for call in calls:` 一个请求一轮,今天只有一个,以后可能有好几个。
- `result = execute_call(call, tools, funcs) or "(工具没有返回内容)"` 动作二:执行。`or` 是 Day 159 的兜底:如果拿到的是空字符串,换成一句话。
- `messages.append({"role": "tool", "tool_call_id": call["id"], "content": result})` 动作二的另一半:结果带着请求的 id 放回去。
- `second = client.chat(messages, tools=tools, temperature=0, max_tokens=300)` 动作三:请求 2,还是带 `tools`。
- `return second.content` 最终回答。

</div>

</details>

两个小提醒。第一,`two_rounds` 会**原地修改**传进来的 `messages`(往里 `append`),调用完之后列表比调用前多了几条。这在多轮对话里正是想要的,但如果你拿同一个列表去发第二个独立的问题,就会把上一次的工具消息带进去。第二,有一个细节在这里先点一下,后面的「坑」会展开:`execute_call` 返回的永远不是空字符串。工具返回 `""`,`json.dumps("")` 是两个引号 `'""'`;所以那个 `or "(工具没有返回内容)"` 在这条路径上不会触发,它只是防着以后别的运行器返回空串。

## 本周的坑,不联网复现八个

上一节验的是「写对了」,这一节反过来:**把本周踩过的坑原样再踩一遍**。八个坑,每个是一个小函数,全部不联网,几毫秒跑完。这样做有个好处:以后在别的项目里看到类似的报错,你一眼认得出它是第几天见过的。

新建 `part03/review160_traps.py`:

```python
# agent-zero-lab/part03/review160_traps.py
"""本周 8 个坑,全部不联网地复现一遍。每个坑一个小函数,返回一行现象。"""
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx
from jsonschema import Draft202012Validator

from part03.check_messages import check_messages
from part03.weather_api import WeatherError
from part03.weather_tool import WEATHER_TOOL

CALL: dict[str, Any] = {"id": "call_00_a", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "北京"}'}}


def trap_arguments_is_string() -> str:  # Day 156
    try:
        return CALL["function"]["arguments"]["city"]
    except TypeError as e:
        return f"TypeError: {e}"


def trap_no_tool_calls_key() -> str:  # Day 156
    reply = {"role": "assistant", "content": "你好"}
    try:
        return str(reply["tool_calls"][0])
    except KeyError as e:
        return f"KeyError: {e}"


def trap_truncated_json() -> str:  # Day 158
    cut = CALL["function"]["arguments"][:-3]  # {"city": "北  ← 被 max_tokens 截断的样子
    try:
        return str(json.loads(cut))
    except json.JSONDecodeError as e:
        return f"JSONDecodeError: {e.msg} (第 {e.pos} 个字符),截断的文本是 {cut!r}"


def trap_path_join() -> str:  # Day 155
    return f"Path('sessions') / '/etc/hosts' = {Path('sessions') / '/etc/hosts'}   |   Path('sessions') / '../x.json' = {Path('sessions') / '../x.json'}"


def trap_url_concat() -> str:  # Day 158
    city = "北京&count=100"
    glued = f"https://geocoding-api.open-meteo.com/v1/search?name={city}"
    safe = httpx.Request("GET", "https://geocoding-api.open-meteo.com/v1/search", params={"name": city}).url
    return f"拼接:{glued}  ← count=100 被当成了第二个参数\n      params=:{safe}"


def trap_extra_params_allowed() -> str:  # Day 157
    schema = WEATHER_TOOL["function"]["parameters"]
    ok = not list(Draft202012Validator(schema).iter_errors({"city": "北京", "country": "CN"}))
    return f"{{'city': '北京', 'country': 'CN'}} 对原 schema 合格吗?{ok}"


def trap_broad_except_first() -> str:  # Day 158
    def run(raiser: Callable[[], None]) -> str:
        try:
            raiser()
        except Exception as e:  # noqa: BLE001  宽的写在前面
            return f"错误:工具内部出错({type(e).__name__})"
        except WeatherError as e:  # 永远走不到  # pyright: ignore[reportUnusedExcept]
            return f"错误:{e}"
        return "没出错"

    def raiser() -> None:
        raise WeatherError("找不到叫 '火星城' 的城市,请换个写法")

    return run(raiser)


def trap_tool_content_dict() -> str:  # Day 159
    msgs = [
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "", "tool_calls": [CALL]},
        {"role": "tool", "tool_call_id": "call_00_a", "content": {"temperature": 12.5}},
    ]
    return str(check_messages(msgs))


TRAPS: list[tuple[str, str, Callable[[], str]]] = [
    ("156", "arguments 当字典用", trap_arguments_is_string),
    ("156", "无条件取 tool_calls[0]", trap_no_tool_calls_key),
    ("158", "arguments 被截断", trap_truncated_json),
    ("155", "文件名直接拼路径", trap_path_join),
    ("158", "城市名拼进 URL", trap_url_concat),
    ("157", "JSON Schema 默认放行多余参数", trap_extra_params_allowed),
    ("158", "except Exception 写在前面", trap_broad_except_first),
    ("159", "tool 消息 content 放字典", trap_tool_content_dict),
]

if __name__ == "__main__":
    for day, name, fn in TRAPS:
        print(f"[Day {day}] {name}\n    {fn()}")
```

<div class="line-notes">

- `import json` 解析被截断的 `arguments`。
- `from collections.abc import Callable` 给最下面那张坑的清单标类型:三元组里最后一项是个函数。
- `from pathlib import Path` 复现 Day 155 的路径拼接。
- `import httpx` 只用来在**本地**拼出请求的 URL(`httpx.Request(...)`),不会发出任何请求。
- `from jsonschema import Draft202012Validator` Day 157 的校验器。
- `from part03.check_messages import check_messages` Day 159 练习 2 写的本地检查函数,最后一个坑用它。
- `from part03.weather_api import WeatherError` Day 158 的天气专用异常。
- `from part03.weather_tool import WEATHER_TOOL` Day 157 的工具定义,用它的 `parameters`。
- `CALL: dict[str, Any] = {"id": "call_00_a", "type": "function", "function": {"name": "get_weather", "arguments": '{"city": "北京"}'}}` 一条手工造的请求。注意 `arguments` 是**字符串**,单引号里面套着一段 JSON 文本。
- `def trap_arguments_is_string() -> str:  # Day 156` 第一个坑。
- `return CALL["function"]["arguments"]["city"]` 把字符串当字典用。`CALL["function"]["arguments"]` 是 `'{"city": "北京"}'`,再对它取 `["city"]`,Python 说字符串的下标必须是整数。
- `except TypeError as e:` 抓住这个 `TypeError`。
- `return f"TypeError: {e}"` 实测 `string indices must be integers, not 'str'`。相当于 JS 里对字符串写 `s.city` 得到 `undefined`,Python 里是直接报错,反而更容易发现。
- `reply = {"role": "assistant", "content": "你好"}` 模型直接回答、没提请求时的 assistant 消息。
- `return str(reply["tool_calls"][0])` 无条件取 `tool_calls[0]`,而这条消息里根本没有 `tool_calls` 这个 key。
- `except KeyError as e:` 抓住 `KeyError`。
- `cut = CALL["function"]["arguments"][:-3]  # {"city": "北  ← 被 max_tokens 截断的样子` 字符串切片:去掉最后 3 个字符(`京"}`),剩下 `{"city": "北`,这就是 `max_tokens` 刚好卡在半截时 `arguments` 的样子。
- `return str(json.loads(cut))` 想解析它。
- `except json.JSONDecodeError as e:` 解析失败。
- `return f"JSONDecodeError: {e.msg} (第 {e.pos} 个字符),截断的文本是 {cut!r}"` 实测第 9 个字符:数一下 `{"city": "` 刚好 9 个字符,第 9 位是字符串开头的那个引号,所以报「字符串从这里开始,却一直没有结束」。
- `return f"Path('sessions') / '/etc/hosts' = {Path('sessions') / '/etc/hosts'}` 只打印路径对象,**不会读也不会写**任何文件。拼接的右边是绝对路径时,左边整个被丢掉,结果是 `/etc/hosts`;右边是 `../x.json` 时保留 `..`,结果 `sessions/../x.json` 指向 `sessions` 的上一层。
- `city = "北京&count=100"` 模型(或者对模型下手的人)给了一个带 `&` 的「城市名」。
- `glued = f"https://geocoding-api.open-meteo.com/v1/search?name={city}"` 直接拼:URL 变成 `...?name=北京&count=100`,服务端会把 `count=100` 当成第二个参数。
- `safe = httpx.Request("GET", "https://geocoding-api.open-meteo.com/v1/search", params={"name": city}).url` 用 `params=`:`&` 被转义成 `%26`、`=` 变成 `%3D`,整串都是 `name` 的值。`httpx.Request(...)` 只是造一个请求对象,`.url` 是它拼好的地址,没有发送。
- `schema = WEATHER_TOOL["function"]["parameters"]` 取出 Day 157 那份天气工具的参数 schema。
- `ok = not list(Draft202012Validator(schema).iter_errors({"city": "北京", "country": "CN"}))` 把多塞了一个 `country` 的参数交给校验器,没有错误就是合格。
- `return f"{{'city': '北京', 'country': 'CN'}} 对原 schema 合格吗?{ok}"` f-string 里 `{{` 输出一个字面的 `{`。实测 `True`:JSON Schema 默认放行多余参数。
- `def run(raiser: Callable[[], None]) -> str:` 一个小的内部函数:执行传进来的函数,把异常翻译成字符串,模仿 `execute_call` 最后一关。
- `except Exception as e:  # noqa: BLE001  宽的写在前面` 兜底的 `except Exception` 写在了具体异常前面。
- `return f"错误:工具内部出错({type(e).__name__})"` 所有异常都走到这里。
- `except WeatherError as e:  # 永远走不到  # pyright: ignore[reportUnusedExcept]` 具体的写在后面,永远走不到。basedpyright 会提醒这一行,所以加了 `pyright: ignore` 让它闭嘴。真实的代码里不要写这个忽略,直接把顺序调过来。
- `raise WeatherError("找不到叫 '火星城' 的城市,请换个写法")` 模拟天气函数找不到城市。
- `return run(raiser)` 实测输出 `错误:工具内部出错(WeatherError)`:本该给模型的是那句人话「找不到叫 '火星城' 的城市,请换个写法」,变成了一个只有类型名的错误,模型没法重试。
- `{"role": "tool", "tool_call_id": "call_00_a", "content": {"temperature": 12.5}},` tool 消息的 `content` 放了字典。
- `return str(check_messages(msgs))` 本地检查抓到:`tool 消息的 content 必须是字符串,现在是 dict`。
- `TRAPS: list[tuple[str, str, Callable[[], str]]] = [` 把八个坑登记成列表:哪天、什么坑、复现函数。
- `for day, name, fn in TRAPS:` 逐个跑,元组直接拆成三个变量。
- `print(f"[Day {day}] {name}\n    {fn()}")` 先打标题,再打复现函数返回的那一行。

</div>

```bash
uv run python -m part03.review160_traps
```

```text
[Day 156] arguments 当字典用
    TypeError: string indices must be integers, not 'str'
[Day 156] 无条件取 tool_calls[0]
    KeyError: 'tool_calls'
[Day 158] arguments 被截断
    JSONDecodeError: Unterminated string starting at (第 9 个字符),截断的文本是 '{"city": "北'
[Day 155] 文件名直接拼路径
    Path('sessions') / '/etc/hosts' = /etc/hosts   |   Path('sessions') / '../x.json' = sessions/../x.json
[Day 158] 城市名拼进 URL
    拼接:https://geocoding-api.open-meteo.com/v1/search?name=北京&count=100  ← count=100 被当成了第二个参数
      params=:https://geocoding-api.open-meteo.com/v1/search?name=%E5%8C%97%E4%BA%AC%26count%3D100
[Day 157] JSON Schema 默认放行多余参数
    {'city': '北京', 'country': 'CN'} 对原 schema 合格吗?True
[Day 158] except Exception 写在前面
    错误:工具内部出错(WeatherError)
[Day 159] tool 消息 content 放字典
    ['[2] tool 消息的 content 必须是字符串,现在是 dict']
```

八个坑,按出现的位置看:

**第一、二个(Day 156)在「模型回来之后」。** `arguments` 是字符串,不能直接当字典用;`tool_calls` 不是每条 assistant 消息都有,取之前要先判断。这两个都会直接抛异常,最容易发现。

**第三个(Day 158)是「模型的 JSON 本身是坏的」。** 截断只是一种,模型也可能漏掉引号。`execute_call` 里这一步必须 `try`,结果变成「错误:…」字符串,而不是让程序崩。

**第四、五个是「拼字符串当路径、当 URL」。** 两个看起来毫无关系,其实是同一件事:**从外面来的字符串被当成了「结构」的一部分**。路径里的 `/` 和 `..` 是结构,URL 里的 `&` 和 `=` 是结构。解法也相同:不拼字符串,用 `fullmatch` 的白名单(Day 155)或者库的参数化接口(`params=`)。SQL、命令行是同一个道理,后面都会再见到。

**第六个(Day 157)是「校验器的默认值太松」。** JSON Schema 默认放行 schema 里没写的字段,要自己加 `additionalProperties: false`。

**第七个(Day 158)是 Python 的 `except` 顺序。** 它按顺序匹配,宽的写在前面,窄的就永远没有机会。这一类 bug 没有任何报错,代码能跑,只是返回的信息变差了。工具链(basedpyright、ruff)能帮你抓到,所以跑一下检查器是有用的。

**第八个(Day 159)是本地检查抢在服务端之前。** `check_messages` 把一个原本会让服务端返回 422 的问题,变成了本地一行人话。

### 一个联网的坑:空的 tool 消息

Day 159 最危险的发现是:`content` 是真的空字符串时,模型会编数字。写 `two_rounds` 的时候我顺手加了 `or "(工具没有返回内容)"`,但检查脚本里那一项,我只要求「不是空」,没有要求「等于那句话」。这是因为实测发现一个细节:`execute_call` 末尾是 `json.dumps(result, ensure_ascii=False)`,**无论工具返回什么,它都不会返回真正的空字符串**。工具返回 `""`,序列化出来是两个引号 `""`。那么 Day 159 的兜底在这条路上是不是白写了?模型对 `""`(两个引号)和 `null` 又会怎么反应?要实测,这是今天第一个联网的脚本:

```python
# agent-zero-lab/part03/review160_empty.py
import json
from typing import Any

from common.llm import LLMClient
from part03.weather_tool import WEATHER_TOOL

TOOLS = [WEATHER_TOOL]

print("json.dumps('') =", repr(json.dumps("")), "| json.dumps(None) =", repr(json.dumps(None)), "| json.dumps([]) =", repr(json.dumps([])))

client = LLMClient()
base: list[dict[str, Any]] = [
    {"role": "system", "content": "你是云簿 CloudLedger 的客服助手。回答简短。"},
    {"role": "user", "content": "北京现在多少度?"},
]
first = client.chat(base, tools=TOOLS, temperature=0, max_tokens=200)
call = first.message["tool_calls"][0]

for label, content in {"真的空字符串": "", "json.dumps('') 的结果": json.dumps(""), "json.dumps(None) 的结果": json.dumps(None)}.items():
    print(f"== tool 消息的 content 是:{label}")
    for _ in range(3):
        msgs = [*base, first.message, {"role": "tool", "tool_call_id": call["id"], "content": content}]
        r = client.chat(msgs, tools=TOOLS, temperature=0, max_tokens=120)
        print("   ", r.content.replace("\n", " ")[:46])
print(client.ledger)
```

<div class="line-notes">

- `import json` 要用 `json.dumps` 算几种「看起来空」的内容的序列化结果。
- `from common.llm import LLMClient` Day 135 的客户端。
- `from part03.weather_tool import WEATHER_TOOL` 还是 Day 157 的天气工具。
- `print("json.dumps('') =", repr(json.dumps("")), "| json.dumps(None) =", repr(json.dumps(None)), "| json.dumps([]) =", repr(json.dumps([])))` 先不联网,看三种「空」序列化出来是什么:`''` 变成两个引号,`None` 变成 `null`,空列表变成 `[]`。`repr` 带着引号打印,好看出字符串是不是空的。
- `client = LLMClient()` 正常客户端,默认重试。
- `base: list[dict[str, Any]] = [` 和 Day 159 一样的起始历史。
- `first = client.chat(base, tools=TOOLS, temperature=0, max_tokens=200)` 拿一份真的第一次回复,为的是得到真的请求 id。
- `call = first.message["tool_calls"][0]` 取出请求。
- `for label, content in {"真的空字符串": "", "json.dumps('') 的结果": json.dumps(""), "json.dumps(None) 的结果": json.dumps(None)}.items():` 三种 `content`:真的空的,以及 `execute_call` 在工具返回 `""` 和 `None` 时实际会放进 tool 消息的内容。
- `print(f"== tool 消息的 content 是:{label}")` 标一下是哪一组。
- `for _ in range(3):` 每组问三次,看稳不稳。
- `msgs = [*base, first.message, {"role": "tool", "tool_call_id": call["id"], "content": content}]` 同一份第一次回复,只换 `content`。
- `r = client.chat(msgs, tools=TOOLS, temperature=0, max_tokens=120)` 第二次请求。
- `print("   ", r.content.replace("\n", " ")[:46])` 回答里的换行换成空格,截前 46 个字。
- `print(client.ledger)` 十次调用的合计。

</div>

```bash
uv run python -m part03.review160_empty
```

```text
json.dumps('') = '""' | json.dumps(None) = 'null' | json.dumps([]) = '[]'
== tool 消息的 content 是:真的空字符串
    北京现在 26°C，晴，风速 3 米/秒。
    北京现在 26°C，晴，风速 3 米/秒。
    北京现在 26°C，晴，风速 3 米/秒。
== tool 消息的 content 是:json.dumps('') 的结果
    抱歉，天气查询暂时没有返回结果，请稍后再试。
    抱歉，天气查询暂时没有返回结果，请稍后再试。
    抱歉，天气查询暂时没有返回结果，请稍后再试。
== tool 消息的 content 是:json.dumps(None) 的结果
    抱歉，天气查询暂时没有返回结果，我这边没能拿到北京的实时温度。您可以稍后再问我一次，或者告诉
    抱歉，暂时查不到北京的天气数据，请稍后再试。
    抱歉，天气查询暂时没有返回结果，我这边没能拿到北京的实时温度。您可以稍后再问我一次，或者告诉
10 次调用 | 输入 4313 / 输出 231 tokens | 约 ¥0.0055
```

两个结论。

**一,`json.dumps` 帮我们挡住了最危险的那一种。** 真的空字符串三次都编出「北京现在 26°C,晴,风速 3 米/秒」(和 Day 159 编出来的是同一个数 26,真实温度是 12.5 左右,每次都不一样,它编的这个数倒是很稳定),而把空字符串序列化成两个引号 `""`,三次都老实说「天气查询暂时没有返回结果」。`null` 也一样。所以走 `execute_call` 这条路的话,Day 159 兜底的那个 `or` 永远不会触发,但这是好事:保护是在更上游的 `json.dumps` 那里,效果等价。

**二,这个保护是个巧合,不要依赖它。** 如果以后有人写了另一个运行器,工具结果不走 `json.dumps` 而是直接 `str(result)`,工具返回 `""` 时 `str("")` 还是空串,这个洞就又打开了。所以 `or` 兜底仍然值得留着,它防的是「换了运行器」。更好的办法是让拼 tool 消息的地方自己检查,就是 Day 159 练习 2 的 `check_messages`:它会抓到空内容。


## 小项目:发票客服

前面都是单点检查,现在把本周的东西拼成一个小工具,看拼起来以后哪里还会出问题。场景:云簿 CloudLedger 的客服助手,能按编号查发票。用到的东西:工具定义(Day 157)、`execute_call` 的四道关(Day 158)、两次请求和 `tool_call_id`(Day 159)、发请求前的 `check_messages`(Day 159 练习 2)。**不联网查别的**,数据是代码里写死的三张虚构发票。

### 第 1 步:数据、函数和工具定义

新建 `part03/invoice_data.py`。这里先写两个版本的 `get_invoice`:第一版找不到发票就抛异常(程序员最自然的写法),第二版把「找不到」当成一个正常的结果返回。先放着,下面的实验会看到两者的差别。

```python
# agent-zero-lab/part03/invoice_data.py
"""Day 160 小项目的数据和工具:三张虚构发票、get_invoice 函数、给模型看的定义。不联网。"""
from typing import Any

INVOICES: dict[str, dict[str, Any]] = {
    "INV-2026-0042": {
        "customer": "星河科技",
        "amount": 1280.0,
        "currency": "CNY",
        "status": "paid",
        "issued": "2026-09-03",
        "due": "2026-10-03",
        "lines": [
            {"item": "云簿专业版 · 10 席位", "amount": 1000.0},
            {"item": "额外存储 200GB", "amount": 280.0},
        ],
    },
    "INV-2026-0043": {
        "customer": "北辰物流",
        "amount": 4560.0,
        "currency": "CNY",
        "status": "open",
        "issued": "2026-10-01",
        "due": "2026-10-31",
        "lines": [{"item": "云簿企业版 · 30 席位", "amount": 4560.0}],
    },
    "INV-2026-0050": {
        "customer": "青禾农业",
        "amount": 300.0,
        "currency": "CNY",
        "status": "void",
        "issued": "2026-10-10",
        "due": "2026-11-10",
        "lines": [{"item": "云簿基础版 · 3 席位", "amount": 300.0}],
    },
}


class InvoiceNotFound(Exception):
    pass


def get_invoice_v1(invoice_id: str, include_lines: bool = False) -> dict[str, Any]:
    """第一版:找不到就抛异常。"""
    inv = INVOICES.get(invoice_id)
    if inv is None:
        raise InvoiceNotFound(invoice_id)
    out = {"invoice_id": invoice_id, **{k: v for k, v in inv.items() if k != "lines"}}
    if include_lines:
        out["lines"] = inv["lines"]
    return out


def get_invoice(invoice_id: str, include_lines: bool = False) -> dict[str, Any]:
    """第二版:「没有这张发票」是一个正常的查询结果,不是出错,照实返回。"""
    inv = INVOICES.get(invoice_id)
    if inv is None:
        return {"found": False, "invoice_id": invoice_id, "message": "系统里没有这张发票"}
    out: dict[str, Any] = {"found": True, "invoice_id": invoice_id, **{k: v for k, v in inv.items() if k != "lines"}}
    if include_lines:
        out["lines"] = inv["lines"]
    return out


INVOICE_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "get_invoice",
        "description": (
            "按编号查一张发票的客户、金额、状态(paid 已付款 / open 待付款 / void 已作废)、开票日期和到期日。"
            "只在用户明确给出发票编号时使用;没给编号就先问用户。"
            "只能查询,不能作废、修改或退款。"
        ),
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
                    "description": "要不要同时返回发票的明细行。用户没提明细就不要填 true。",
                },
            },
            "required": ["invoice_id"],
        },
    },
}

if __name__ == "__main__":
    print(get_invoice("INV-2026-0042"))
    print(get_invoice("INV-2026-0043", include_lines=True))
    print(get_invoice("INV-2026-0099"))
    try:
        get_invoice_v1("INV-2026-0099")
    except InvoiceNotFound as e:
        print("v1 抛出:", type(e).__name__, e)
```

<div class="line-notes">

- `from typing import Any` 字典值类型不统一(字符串、数字、列表),标 `Any`。
- `INVOICES: dict[str, dict[str, Any]] = {` 三张虚构发票:键是发票编号,值是字典。
- `"INV-2026-0042": {` 第一张:星河科技,1280 元,已付款(`paid`),开票日 2026-09-03,到期日 2026-10-03,有两行明细(1000 + 280)。
- `"INV-2026-0043": {` 第二张:北辰物流,4560 元,待付款(`open`),到期日 2026-10-31,一行明细。
- `"INV-2026-0050": {` 第三张:青禾农业,300 元,已作废(`void`)。
- `class InvoiceNotFound(Exception):` 一个自定义异常,第一版用。`pass` 表示什么都不加,有个名字就够了。
- `def get_invoice_v1(invoice_id: str, include_lines: bool = False) -> dict[str, Any]:` 第一版。
- `inv = INVOICES.get(invoice_id)` 字典的 `.get` 找不到时返回 `None`,不抛异常。
- `raise InvoiceNotFound(invoice_id)` 找不到就抛,异常的内容是编号。
- `out = {"invoice_id": invoice_id, **{k: v for k, v in inv.items() if k != "lines"}}` 先拷出除明细以外的所有字段。`**{...}` 把字典展开进新字典,相当于 JS 的 `{ invoice_id, ...rest }`。
- `if include_lines:` 用户要明细才加上去,省 token(Day 157 讲过工具结果也是 token)。
- `out["lines"] = inv["lines"]` 加上明细。
- `def get_invoice(invoice_id: str, include_lines: bool = False) -> dict[str, Any]:` 第二版,后面的项目默认用它。
- `return {"found": False, "invoice_id": invoice_id, "message": "系统里没有这张发票"}` 找不到也是一个正常的答案:`found` 为 `False`,附一句人话。
- `out: dict[str, Any] = {"found": True, "invoice_id": invoice_id, **{k: v for k, v in inv.items() if k != "lines"}}` 找到的时候多加一个 `found: True`,让两种情况的结构对齐。
- `INVOICE_TOOL: dict[str, Any] = {` 发给模型的工具定义。
- `"description": (` 描述用括号包起来拼成三句话,一句管「查什么」,一句管「什么时候用」,一句管「做不到什么」。
- `"按编号查一张发票的客户、金额、状态(paid 已付款 / open 待付款 / void 已作废)、开票日期和到期日。"` 返回哪些字段,以及三种状态值是什么意思(模型看到 `paid` 才知道怎么用中文说)。
- `"只在用户明确给出发票编号时使用;没给编号就先问用户。"` Day 157 的「什么时候用」。
- `"只能查询,不能作废、修改或退款。"` Day 157 的「做不到就别调」,专门挡「帮我作废」这类请求。
- `"pattern": r"^INV-\d{4}-\d{4}$",` 编号格式:`INV-` + 4 位年份 + `-` + 4 位序号。`r"..."` 原始字符串,反斜杠不用写两遍。
- `"description": "发票编号,格式 INV-年份-四位序号,例如 INV-2026-0042。",` 说明里写了一个例子。Day 157 警告过例子会被抄走,这里的例子格式和测试题里的编号相同,是有意为之,只拿来对格式,不影响选发票。
- `"description": "要不要同时返回发票的明细行。用户没提明细就不要填 true。",` 一个布尔参数,默认不填,描述里写清楚什么时候用。
- `"required": ["invoice_id"],` 只有编号必填。
- `print(get_invoice("INV-2026-0042"))` 自测:找到,没有明细。
- `print(get_invoice("INV-2026-0043", include_lines=True))` 找到,带一行明细。
- `print(get_invoice("INV-2026-0099"))` 找不到,返回 `found: False`。
- `get_invoice_v1("INV-2026-0099")` 第一版找不到就抛。
- `print("v1 抛出:", type(e).__name__, e)` 打印异常的类型名和内容。

</div>

```bash
uv run python -m part03.invoice_data
```

```text
{'found': True, 'invoice_id': 'INV-2026-0042', 'customer': '星河科技', 'amount': 1280.0, 'currency': 'CNY', 'status': 'paid', 'issued': '2026-09-03', 'due': '2026-10-03'}
{'found': True, 'invoice_id': 'INV-2026-0043', 'customer': '北辰物流', 'amount': 4560.0, 'currency': 'CNY', 'status': 'open', 'issued': '2026-10-01', 'due': '2026-10-31', 'lines': [{'item': '云簿企业版 · 30 席位', 'amount': 4560.0}]}
{'found': False, 'invoice_id': 'INV-2026-0099', 'message': '系统里没有这张发票'}
v1 抛出: InvoiceNotFound INV-2026-0099
```

函数本身没问题,先测通再接模型,这是 Day 158 的规矩。

### 第 2 步:一道题从头到尾,每一步留痕

新建 `part03/invoice_bot.py`。除了跑通以外,它还要**留下痕迹**:模型提了什么请求、工具回了什么、最后说了什么、发了几次请求。验收靠这些痕迹,而不是肉眼看回答。8 道题和各自的判定函数也写在里面:

```python
# agent-zero-lab/part03/invoice_bot.py
"""Day 160 小项目:发票客服。一个工具、两次请求、每一步留痕,再用 8 道题验收。"""
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from common.llm import LLMClient
from part03.check_messages import check_messages
from part03.dictation160 import ChatLike, execute_call
from part03.invoice_data import INVOICE_TOOL, get_invoice, get_invoice_v1

TOOLS = [INVOICE_TOOL]
SYSTEM = "你是云簿 CloudLedger 的客服助手。回答简短。发票信息必须来自工具,不要编造。"


@dataclass
class Trace:
    """一道题从头到尾留下的痕迹:模型提了什么请求、工具回了什么、最后说了什么。"""

    question: str
    calls: list[dict[str, Any]] = field(default_factory=list)  # 解析后的参数
    results: list[str] = field(default_factory=list)  # 每个请求对应的 tool 消息内容
    answer: str = ""
    requests: int = 0  # 一共发了几次模型请求


def run_question(client: ChatLike, question: str, funcs: dict[str, Callable[..., Any]]) -> Trace:
    trace = Trace(question)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": question},
    ]
    first = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)
    trace.requests = 1
    calls = first.message.get("tool_calls") or []
    if not calls:
        trace.answer = first.content
        return trace

    messages.append(first.message)
    for call in calls:
        try:
            trace.calls.append(json.loads(call["function"]["arguments"]))
        except json.JSONDecodeError:
            trace.calls.append({"解析失败": call["function"]["arguments"]})
        result = execute_call(call, TOOLS, funcs) or "(工具没有返回内容)"
        trace.results.append(result)
        messages.append({"role": "tool", "tool_call_id": call["id"], "content": result})

    problems = check_messages(messages)  # 发请求之前自己先查一遍
    if problems:
        raise ValueError(f"发第二次请求之前发现问题:{problems}")
    second = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)
    trace.requests = 2
    trace.answer = second.content
    return trace


# ---------- 8 道验收题 ----------
def has_any(text: str, words: list[str]) -> bool:
    return any(w in text for w in words)


def judge_status(t: Trace) -> str | None:
    if t.calls != [{"invoice_id": "INV-2026-0042"}]:
        return f"请求不对:{t.calls}"
    return None if has_any(t.answer, ["已付款", "已支付", "paid"]) else "回答里没说清「已付款」"


def judge_lines(t: Trace) -> str | None:
    if len(t.calls) != 1 or t.calls[0].get("include_lines") is not True:
        return f"该带 include_lines=true,实际是 {t.calls}"
    return None if has_any(t.answer, ["4560", "4,560"]) else "回答里没有明细金额 4560"


def judge_no_id(t: Trace) -> str | None:
    if t.calls:
        return f"用户没给编号,不该调用,实际是 {t.calls}"
    return None if "编号" in t.answer else "没有向用户要编号"


def judge_not_found(t: Trace) -> str | None:
    if not t.calls:
        return "给了编号,应该去查"
    if "InvoiceNotFound" in t.answer:
        return "把内部的异常名 InvoiceNotFound 说给用户了"
    if not has_any(t.answer, ["没有", "找不到", "不存在", "未找到", "查不到"]):
        return "回答里没有说清「查不到这张发票」"
    return "回答里出现了金额" if has_any(t.answer, ["¥", "元", "CNY"]) else None


def judge_lowercase(t: Trace) -> str | None:
    if not t.calls:
        return None if "编号" in t.answer else "没调用也没追问"
    if t.calls != [{"invoice_id": "INV-2026-0042"}]:
        return f"规范化成了别的编号:{t.calls}"
    return None if has_any(t.answer, ["1280", "1,280"]) else "回答里没有金额 1280"


def judge_off_topic(t: Trace) -> str | None:
    return f"问天气不该调发票工具:{t.calls}" if t.calls else None


def judge_cannot_void(t: Trace) -> str | None:
    if has_any(t.answer, ["已作废", "已为您作废", "已经作废"]):
        return "谎称已经作废了"
    return None if has_any(t.answer, ["不能", "无法", "没办法", "不支持", "没有权限"]) else "没有说清自己做不到"


def judge_due(t: Trace) -> str | None:
    if t.calls != [{"invoice_id": "INV-2026-0043"}]:
        return f"请求不对:{t.calls}"
    return None if "2026-10-31" in t.answer or "10 月 31" in t.answer or "10月31" in t.answer else "回答里没有到期日 10-31"


CASES: list[tuple[str, Callable[[Trace], str | None]]] = [
    ("INV-2026-0042 现在是什么状态?", judge_status),
    ("把 INV-2026-0043 的明细给我看看", judge_lines),
    ("帮我查一下我的发票", judge_no_id),
    ("INV-2026-0099 是多少钱?", judge_not_found),
    ("inv-2026-42 多少钱?", judge_lowercase),
    ("今天北京天气怎么样?", judge_off_topic),
    ("能帮我把 INV-2026-0043 作废吗?", judge_cannot_void),
    ("INV-2026-0043 什么时候到期?", judge_due),
]


def main(version: str) -> None:
    funcs: dict[str, Callable[..., Any]] = {"get_invoice": get_invoice_v1 if version == "v1" else get_invoice}
    client = LLMClient()
    passed = 0
    for i, (question, judge) in enumerate(CASES, start=1):
        t = run_question(client, question, funcs)
        reason = judge(t)
        passed += reason is None
        print(f"{i}. {'通过' if reason is None else '失败'} | {question}")
        print(f"   请求 {t.requests} 次,调用 {t.calls or '无'}")
        if t.results:
            print(f"   工具结果:{t.results[0][:70]}")
        print(f"   回答:{t.answer.replace(chr(10), ' ')[:70]}")
        if reason:
            print(f"   原因:{reason}")
    print(f"\n{passed}/{len(CASES)} 通过 | {client.ledger}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "v2")
```

<div class="line-notes">

- `import json` 解析 `arguments` 存进痕迹。
- `import sys` 读命令行参数,选 `v1` 还是 `v2`。
- `from collections.abc import Callable` 白名单和判定函数的类型。
- `from dataclasses import dataclass, field` [Day 50](/blog/agent-zero/day-050-dataclass/) 学的数据类,下面存痕迹用。
- `from common.llm import LLMClient` 真的客户端,`run_question` 只依赖 `ChatLike`,所以测试时可以换成假的。
- `from part03.check_messages import check_messages` Day 159 练习 2 的本地检查。
- `from part03.dictation160 import ChatLike, execute_call` 今天默写的文件。
- `from part03.invoice_data import INVOICE_TOOL, get_invoice, get_invoice_v1` 工具定义和两版函数。
- `TOOLS = [INVOICE_TOOL]` 只有一个工具。
- `SYSTEM = "你是云簿 CloudLedger 的客服助手。回答简短。发票信息必须来自工具,不要编造。"` system 提示词:最后一句防编造。
- `class Trace:` 一道题的痕迹。`@dataclass` 让它自动有构造函数。
- `question: str` 问题。
- `calls: list[dict[str, Any]] = field(default_factory=list)` 解析后的请求参数,比如 `[{"invoice_id": "INV-2026-0042"}]`。可变默认值(列表)要用 `field(default_factory=list)`,不能直接写 `= []`,否则所有实例共用同一个列表。
- `results: list[str] = field(default_factory=list)` 每个请求对应的 tool 消息内容。
- `answer: str = ""` 最终回答。
- `requests: int = 0  # 一共发了几次模型请求` 1 次是没调工具,2 次是调了一次工具。
- `def run_question(client: ChatLike, question: str, funcs: dict[str, Callable[..., Any]]) -> Trace:` 一道题的完整流程。
- `trace = Trace(question)` 新建痕迹。
- `{"role": "system", "content": SYSTEM},` 起始历史:system 和 user。
- `first = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)` 请求 1。
- `trace.requests = 1` 记一次。
- `calls = first.message.get("tool_calls") or []` 有没有请求。
- `if not calls:` 模型没调工具。
- `trace.answer = first.content` 回答就是第一次的内容。
- `return trace` 一次请求就结束,比如「请提供发票编号」。
- `messages.append(first.message)` 放回 assistant 消息。
- `for call in calls:` 逐个请求处理。
- `trace.calls.append(json.loads(call["function"]["arguments"]))` 解析参数存起来,验收时用。
- `except json.JSONDecodeError:` 参数是坏的也别崩,验收需要看见它。
- `trace.calls.append({"解析失败": call["function"]["arguments"]})` 记一个标记。
- `result = execute_call(call, TOOLS, funcs) or "(工具没有返回内容)"` 同 `two_rounds`:执行,空就兜底。
- `trace.results.append(result)` 存下 tool 消息内容。
- `messages.append({"role": "tool", "tool_call_id": call["id"], "content": result})` 放回 tool 消息。
- `problems = check_messages(messages)  # 发请求之前自己先查一遍` 本周的护栏:请求 2 发出去之前,本地检查历史。
- `raise ValueError(f"发第二次请求之前发现问题:{problems}")` 有问题就停,不浪费一次请求。
- `second = client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)` 请求 2。
- `trace.requests = 2` 记两次。
- `trace.answer = second.content` 最终回答。
- `def has_any(text: str, words: list[str]) -> bool:` 小工具:文本里有没有出现词表里的任何一个。
- `return any(w in text for w in words)` `any` 遇到第一个 `True` 就停。
- `def judge_status(t: Trace) -> str | None:` 第 1 题的判定:返回 `None` 表示通过,返回字符串是失败原因。
- `if t.calls != [{"invoice_id": "INV-2026-0042"}]:` 请求必须恰好是查 0042,没有多余参数。
- `return None if has_any(t.answer, ["已付款", "已支付", "paid"]) else "回答里没说清「已付款」"` 回答里要说出状态。
- `def judge_lines(t: Trace) -> str | None:` 第 2 题:要明细。
- `t.calls[0].get("include_lines") is not True` 必须明确传了 `include_lines=true`。
- `["4560", "4,560"]` 回答里要有明细金额,模型可能写 `4560` 也可能写 `4,560`。
- `def judge_no_id(t: Trace) -> str | None:` 第 3 题:用户没给编号。
- `return f"用户没给编号,不该调用,实际是 {t.calls}"` 调了就失败。
- `return None if "编号" in t.answer else "没有向用户要编号"` 没调的话,回答里要有「编号」,说明在追问。
- `def judge_not_found(t: Trace) -> str | None:` 第 4 题:查一张不存在的发票,今天最重要的一道。
- `if "InvoiceNotFound" in t.answer:` 回答里不能出现内部的异常名。
- `return "把内部的异常名 InvoiceNotFound 说给用户了"` 这是第一版会栽的地方。
- `["没有", "找不到", "不存在", "未找到", "查不到"]` 要明确说查不到。
- `return "回答里出现了金额" if has_any(t.answer, ["¥", "元", "CNY"]) else None` 不能编金额。
- `def judge_lowercase(t: Trace) -> str | None:` 第 5 题:`inv-2026-42`,格式不合规的编号。接受两种合理做法:要么规范化成 `INV-2026-0042`,要么追问。
- `return None if "编号" in t.answer else "没调用也没追问"` 没调用的话必须有追问。
- `return f"规范化成了别的编号:{t.calls}"` 调了但改成了别的编号,不行。
- `def judge_off_topic(t: Trace) -> str | None:` 第 6 题:问天气,工具只有发票,不该调。
- `def judge_cannot_void(t: Trace) -> str | None:` 第 7 题:要求作废。
- `["已作废", "已为您作废", "已经作废"]` 谎称做到了就失败。
- `["不能", "无法", "没办法", "不支持", "没有权限"]` 要说明自己做不到。
- `def judge_due(t: Trace) -> str | None:` 第 8 题:问到期日,必须查 0043,回答里有 `2026-10-31`。
- `CASES: list[tuple[str, Callable[[Trace], str | None]]] = [` 八道题,每项是「问题 + 判定函数」。
- `("INV-2026-0042 现在是什么状态?", judge_status),` 第 1 题。
- `("inv-2026-42 多少钱?", judge_lowercase),` 第 5 题,编号写成小写、序号只有两位。
- `def main(version: str) -> None:` 跑全部 8 题。
- `funcs: dict[str, Callable[..., Any]] = {"get_invoice": get_invoice_v1 if version == "v1" else get_invoice}` 按命令行参数选哪一版函数,白名单里的名字都叫 `get_invoice`,模型看到的工具定义不变,变的只是背后的实现。
- `client = LLMClient()` 一个客户端跑完 8 题,账本累计。
- `for i, (question, judge) in enumerate(CASES, start=1):` 编号从 1 开始,同时拆开元组。
- `t = run_question(client, question, funcs)` 跑一题。
- `reason = judge(t)` 判定。
- `passed += reason is None` 布尔值可以直接加,`True` 当 1。
- `print(f"{i}. {'通过' if reason is None else '失败'} | {question}")` 第一行:题号、结果、问题。
- `print(f"   请求 {t.requests} 次,调用 {t.calls or '无'}")` 第二行:几次请求、调了什么。
- `print(f"   工具结果:{t.results[0][:70]}")` 第三行:工具结果前 70 个字。
- `print(f"   回答:{t.answer.replace(chr(10), ' ')[:70]}")` 第四行:回答前 70 个字,换行换成空格。
- `print(f"   原因:{reason}")` 失败才打。
- `print(f"\n{passed}/{len(CASES)} 通过 | {client.ledger}")` 汇总和账本。
- `main(sys.argv[1] if len(sys.argv) > 1 else "v2")` 命令行带 `v1` 就用第一版,否则用第二版。

</div>

先跑第一版(找不到就抛异常):

```bash
uv run python -m part03.invoice_bot v1
```

```text
1. 通过 | INV-2026-0042 现在是什么状态?
   请求 2 次,调用 [{'invoice_id': 'INV-2026-0042'}]
   工具结果:{"invoice_id": "INV-2026-0042", "customer": "星河科技", "amount": 1280.0, 
   回答:INV-2026-0042（客户：星河科技，金额 1280.00 CNY）当前状态是 **paid（已付款）**。开票日 2026-09-0
2. 通过 | 把 INV-2026-0043 的明细给我看看
   请求 2 次,调用 [{'invoice_id': 'INV-2026-0043', 'include_lines': True}]
   工具结果:{"invoice_id": "INV-2026-0043", "customer": "北辰物流", "amount": 4560.0, 
   回答:INV-2026-0043（北辰物流）：  - 明细：云簿企业版 · 30 席位 — 4,560.00 CNY - 合计：4,560.00 
3. 通过 | 帮我查一下我的发票
   请求 1 次,调用 无
   回答:请提供发票编号（格式如 INV-2026-0042），我才能帮您查询。
4. 失败 | INV-2026-0099 是多少钱?
   请求 2 次,调用 [{'invoice_id': 'INV-2026-0099'}]
   工具结果:错误:工具内部出错(InvoiceNotFound)
   回答:抱歉，查询 INV-2026-0099 时出错了（系统返回 InvoiceNotFound，未找到该发票）。请确认编号是否正确，或稍后再试。
   原因:把内部的异常名 InvoiceNotFound 说给用户了
5. 通过 | inv-2026-42 多少钱?
   请求 2 次,调用 [{'invoice_id': 'INV-2026-0042'}]
   工具结果:{"invoice_id": "INV-2026-0042", "customer": "星河科技", "amount": 1280.0, 
   回答:INV-2026-0042：金额 1280.00 CNY，客户星河科技，状态已付款（开票日 2026-09-03，到期日 2026-10-0
6. 通过 | 今天北京天气怎么样?
   请求 1 次,调用 无
   回答:我这边只能查云簿的发票信息，查不了天气。你可以看看手机自带的天气应用，或者问我发票相关的问题。
7. 通过 | 能帮我把 INV-2026-0043 作废吗?
   请求 1 次,调用 无
   回答:我无法作废发票，只能查询。需要我帮你查一下 INV-2026-0043 的状态吗？作废需要走其他流程。
8. 通过 | INV-2026-0043 什么时候到期?
   请求 2 次,调用 [{'invoice_id': 'INV-2026-0043'}]
   工具结果:{"invoice_id": "INV-2026-0043", "customer": "北辰物流", "amount": 4560.0, 
   回答:INV-2026-0043（北辰物流，4560 元）到期日是 **2026-10-31**，目前状态为待付款。

7/8 通过 | 13 次调用 | 输入 6205 / 输出 579 tokens | 约 ¥0.0095
```

7/8。读第 4 题:

```text
4. 失败 | INV-2026-0099 是多少钱?
   工具结果:错误:工具内部出错(InvoiceNotFound)
   回答:抱歉,查询 INV-2026-0099 时出错了(系统返回 InvoiceNotFound,未找到该发票)……
```

模型把工具里的一个内部异常名**原样说给了用户**。再往上追一层:`get_invoice_v1` 抛的是 `InvoiceNotFound`,`execute_call` 只认识 `WeatherError`,别的异常一律走兜底分支,变成「错误:工具内部出错(InvoiceNotFound)」。这条信息有两个毛病:模型看不出这是「用户给错了编号」还是「系统坏了」,于是它把两种可能都说了一遍;而且异常名是我们内部的实现细节,不该出现在客服的嘴里。

这个问题不是模型笨,是我们的设计问题。**「没有这张发票」不是出错,是一个正常的查询结果。** 所以第二版不抛异常,返回 `{"found": false, ..., "message": "系统里没有这张发票"}`。同样的 8 题:

```bash
uv run python -m part03.invoice_bot v2
```

```text
1. 通过 | INV-2026-0042 现在是什么状态?
   请求 2 次,调用 [{'invoice_id': 'INV-2026-0042'}]
   工具结果:{"found": true, "invoice_id": "INV-2026-0042", "customer": "星河科技", "am
   回答:INV-2026-0042（客户：星河科技，金额 1280.00 CNY）当前状态是**已付款（paid）**。开票日期 2026-09-0
2. 通过 | 把 INV-2026-0043 的明细给我看看
   请求 2 次,调用 [{'invoice_id': 'INV-2026-0043', 'include_lines': True}]
   工具结果:{"found": true, "invoice_id": "INV-2026-0043", "customer": "北辰物流", "am
   回答:INV-2026-0043（北辰物流）：  - 明细：云簿企业版 · 30 席位 — 4560.00 CNY - 合计：4560.00 CN
3. 通过 | 帮我查一下我的发票
   请求 1 次,调用 无
   回答:请提供发票编号（格式如 INV-2026-0042），我才能帮您查询。
4. 通过 | INV-2026-0099 是多少钱?
   请求 2 次,调用 [{'invoice_id': 'INV-2026-0099'}]
   工具结果:{"found": false, "invoice_id": "INV-2026-0099", "message": "系统里没有这张发票"
   回答:系统里查不到 INV-2026-0099 这张发票，请确认编号是否正确。
5. 通过 | inv-2026-42 多少钱?
   请求 2 次,调用 [{'invoice_id': 'INV-2026-0042'}]
   工具结果:{"found": true, "invoice_id": "INV-2026-0042", "customer": "星河科技", "am
   回答:INV-2026-0042（客户：星河科技）金额为 **1280.00 CNY**，状态：已付款。开票日 2026-09-03，到期日 20
6. 通过 | 今天北京天气怎么样?
   请求 1 次,调用 无
   回答:我这边只能查云簿的发票信息，查不了天气。你可以看看手机自带的天气应用。有发票需要查询的话，把发票编号告诉我。
7. 通过 | 能帮我把 INV-2026-0043 作废吗?
   请求 1 次,调用 无
   回答:我无法作废发票，只能查询。需要我帮你查一下 INV-2026-0043 的状态吗？作废需要走其他流程。
8. 通过 | INV-2026-0043 什么时候到期?
   请求 2 次,调用 [{'invoice_id': 'INV-2026-0043'}]
   工具结果:{"found": true, "invoice_id": "INV-2026-0043", "customer": "北辰物流", "am
   回答:INV-2026-0043（客户：北辰物流，金额 4,560 CNY）到期日是 **2026-10-31**，目前状态为待付款。

8/8 通过 | 13 次调用 | 输入 6246 / 输出 569 tokens | 约 ¥0.0093
```

8/8。第 4 题现在是「系统里没有查到 INV-2026-0099 这张发票,请确认编号是否正确」,准确、不带内部细节。

这个对比里有一条值得带走:**工具的返回值本身就是给模型的提示词。** 同一个事实(发票不存在),一种写法(`错误:工具内部出错(InvoiceNotFound)`)让模型说出了异常名,另一种写法(`found: false` 加一句人话)让它说出了准确的话。以后写任何工具,都要想一遍:这个函数的每种返回值,模型读到以后会对用户说什么。

再看两个小细节。第 5 题 `inv-2026-42`,模型自己把它规范化成了 `INV-2026-0042` 去查,回答是 1280 元,这次对了。但它是**猜**的:`42` 补成 `0042` 是一个合理的猜测,换成 `inv-2026-420` 就没法猜了。在账单这类场景里,我更倾向于让它追问「您说的是 INV-2026-0042 吗」。这属于 system 提示词的问题,以后讲 Agent 的行为约束时再回来。第 7 题,用户要作废发票,模型一次工具都没调,直接说「我无法作废发票,只能查询」,这是 Day 157 里「只能查询,不能作废」那句描述起的作用。

## 本周错题与坑清单

把这周踩过的坑集中放在一张表里,最后一列是「在这周的哪个脚本里能复现」,方便回头翻。

| 哪天 | 坑 | 现象 | 防法 | 复现 |
| --- | --- | --- | --- | --- |
| 154 | 切厂商后配置串味 | 价格沿用上一家,少算 14%,不报错 | 先用 `dotenv_values` 检查文件再建客户端 | `stale_price.py` |
| 154 | 被打断的调用没进账 | 长回答中途 Ctrl+C,钱照花 | 按字数估算,标明是估算 | `interrupt_driver.py` |
| 155 | 文件名直接拼路径 | `/etc/hosts` 让左边整个被丢掉 | 白名单加 `fullmatch` | `review160_traps.py` |
| 155 | 读回的文件不校验 | 形状不对的历史下次提问才出错 | pydantic 当场校验 | `load_demo.py` |
| 155 | 改 system 开头 | 缓存掉到 0,那一轮贵 10 倍 | 要改就加在末尾 | `system_cache.py` |
| 156 | `arguments` 当字典 | `TypeError: string indices must be integers` | 先 `json.loads`,包 `try` | `review160_traps.py` |
| 156 | 无条件取 `tool_calls[0]` | `KeyError`,或漏掉后面的请求 | 先判断有没有,再遍历 | `review160_traps.py` |
| 157 | 描述含糊或和名字矛盾 | 选对率 3/12,矛盾时 0/12 | 描述写「什么时候用、什么时候别用」 | `ledger_variants.py` |
| 157 | 以为 `enum`、`required` 是强制 | 用户要「作废」,模型省掉 `status` | 本地校验,描述里写做不到 | `pick_status.py` |
| 158 | `finish_reason` 是 `length` | `arguments` 被截断,不是 `tool_calls` | 看 `tool_calls` 是否非空,`length` 要报警 | `truncated.py` |
| 158 | 城市名拼进 URL | `北京&count=100` 变成第二个参数 | `params=` | `review160_traps.py` |
| 158 | `except Exception` 在前 | 具体异常的人话变成类型名 | 具体的写前面 | `review160_traps.py` |
| 159 | 漏 assistant 消息 | 400 | 先放 assistant,再放 tool | `roundtrip_errors.py` |
| 159 | `tool_call_id` 写错、漏写 | 400 / 422 | 永远从 `call["id"]` 取 | `roundtrip_errors.py` |
| 159 | `content` 是真的空字符串 | 模型编出 26°C | 兜底 + 本地检查 | `review160_empty.py` |
| 160 | 工具抛异常 | 内部异常名被说给用户 | 「没找到」是结果不是错误 | `invoice_bot.py v1` |

最后一行是今天新增的。另外今天还会在练习里发现两条这周的东西**拼起来**才出现的问题,它们不在上表里,因为单独看任何一天都发现不了。

## 动手练习

三道题,前两道不联网,第三道联网两次。每道都是「这周的东西拼在一起」会出的问题。

**练习 1:把 `check_messages` 接成护栏。** 写 `guarded_two_rounds`:在每次发请求之前先用 `check_messages` 检查,有问题就抛 `BadHistory`,一次请求都不发。给它加一个只给练习用的开关 `forget_assistant`,模拟「忘了放回 assistant 那条」的 bug,写三个 pytest 证明:正常路径发 2 次请求;漏 assistant 时第二次请求被拦在本地(`seen` 里只有 1 次);起始历史就坏时一次都没发。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex160_guard.py
from collections.abc import Callable
from typing import Any

from part03.check_messages import check_messages
from part03.dictation160 import FUNCS, ChatLike, execute_call


class BadHistory(Exception):
    """发请求之前就发现 messages 不合规矩。"""


def guarded_two_rounds(
    client: ChatLike,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    funcs: dict[str, Callable[..., Any]] = FUNCS,
    forget_assistant: bool = False,  # 只给练习用:故意漏放 assistant 消息,模拟忘了这一步的 bug
) -> str:
    problems = check_messages(messages)
    if problems:
        raise BadHistory(f"第一次请求前:{problems}")
    first = client.chat(messages, tools=tools, temperature=0, max_tokens=300)
    calls = first.message.get("tool_calls") or []
    if not calls:
        return first.content

    if not forget_assistant:
        messages.append(first.message)
    for call in calls:
        result = execute_call(call, tools, funcs) or "(工具没有返回内容)"
        messages.append({"role": "tool", "tool_call_id": call["id"], "content": result})

    problems = check_messages(messages)
    if problems:
        raise BadHistory(f"第二次请求前:{problems}")
    return client.chat(messages, tools=tools, temperature=0, max_tokens=300).content
```

<div class="line-notes">

- `from collections.abc import Callable` 白名单的类型。
- `from part03.check_messages import check_messages` Day 159 练习 2 的检查函数,发请求前的护栏。
- `from part03.dictation160 import FUNCS, ChatLike, execute_call` 复用今天默写的文件。
- `class BadHistory(Exception):` 自己的异常类型。调用者可以 `except BadHistory` 专门处理「我们自己拦下来的」,和网络错误区分开。
- `forget_assistant: bool = False,  # 只给练习用:故意漏放 assistant 消息,模拟忘了这一步的 bug` 一个故意制造 bug 的开关,默认关。真实代码里没有这种参数,放在这里只为了让测试能「复现一个真的 bug 然后看护栏拦不拦得住」。
- `problems = check_messages(messages)` 第一次请求之前检查:传进来的历史本身合不合规矩。
- `raise BadHistory(f"第一次请求前:{problems}")` 有问题就抛,`problems` 是一个列表,会原样出现在消息里。
- `first = client.chat(messages, tools=tools, temperature=0, max_tokens=300)` 通过检查才发请求 1。
- `if not forget_assistant:` 开关打开时跳过下面这一行,模拟漏掉。
- `messages.append(first.message)` 正常路径放回 assistant 消息。
- `messages.append({"role": "tool", "tool_call_id": call["id"], "content": result})` 放回 tool 消息。
- `problems = check_messages(messages)` 第二次请求之前再检查一遍,这一次检查的是拼好的历史。
- `raise BadHistory(f"第二次请求前:{problems}")` 漏了 assistant 时,tool 消息「对不上前面任何一个请求」,在这里被拦住。
- `return client.chat(messages, tools=tools, temperature=0, max_tokens=300).content` 通过检查才发请求 2。

</div>

测试:

```python
# agent-zero-lab/tests/test_ex160_guard.py
from typing import Any

import pytest

from part03.ex160_guard import BadHistory, guarded_two_rounds
from part03.review160_check import ECHO_TOOL, FUNCS, FakeClient, call_of

ASST = {"role": "assistant", "content": "", "tool_calls": [call_of('{"text": "hi"}', cid="c1")]}
FINAL = {"role": "assistant", "content": "好了"}


def start() -> list[dict[str, Any]]:
    return [{"role": "system", "content": "s"}, {"role": "user", "content": "q"}]


def test_good_path_sends_two_requests() -> None:
    fake = FakeClient([ASST, FINAL])
    assert guarded_two_rounds(fake, start(), [ECHO_TOOL], FUNCS) == "好了"
    assert len(fake.seen) == 2


def test_forgot_assistant_is_caught_before_second_request() -> None:
    fake = FakeClient([ASST, FINAL])
    with pytest.raises(BadHistory, match="第二次请求前"):
        guarded_two_rounds(fake, start(), [ECHO_TOOL], FUNCS, forget_assistant=True)
    assert len(fake.seen) == 1  # 第二次请求根本没发出去


def test_bad_history_is_caught_before_first_request() -> None:
    fake = FakeClient([FINAL])
    bad = [*start(), {"role": "tool", "tool_call_id": "zzz", "content": "x"}]
    with pytest.raises(BadHistory, match="第一次请求前"):
        guarded_two_rounds(fake, bad, [ECHO_TOOL], FUNCS)
    assert fake.seen == []  # 一次请求都没发
```

<div class="line-notes">

- `import pytest` 用 `pytest.raises` 断言「这里应该抛异常」,相当于 jest 的 `expect(() => ...).toThrow()`。
- `from part03.review160_check import ECHO_TOOL, FUNCS, FakeClient, call_of` 直接复用今天检查脚本里的假客户端和假工具,不用再写一遍。
- `ASST = {"role": "assistant", "content": "", "tool_calls": [call_of('{"text": "hi"}', cid="c1")]}` 假模型的第一次回复:要调 `echo`,请求 id 是 `c1`。
- `FINAL = {"role": "assistant", "content": "好了"}` 假模型的第二次回复。
- `def start() -> list[dict[str, Any]]:` 每个测试用一份新的起始历史,因为 `guarded_two_rounds` 会原地修改它,共用的话测试之间会互相影响。
- `fake = FakeClient([ASST, FINAL])` 先回请求,再回答。
- `assert guarded_two_rounds(fake, start(), [ECHO_TOOL], FUNCS) == "好了"` 正常路径返回第二次的回答。
- `assert len(fake.seen) == 2` 发了 2 次请求。
- `with pytest.raises(BadHistory, match="第二次请求前"):` 期望抛 `BadHistory`,并且消息里有「第二次请求前」(`match` 是正则搜索)。
- `guarded_two_rounds(fake, start(), [ECHO_TOOL], FUNCS, forget_assistant=True)` 打开漏 assistant 的开关。
- `assert len(fake.seen) == 1  # 第二次请求根本没发出去` 假客户端只收到过 1 次请求,说明护栏在第二次请求之前就拦下来了。真服务端的话,这里省了一次 400 往返。
- `bad = [*start(), {"role": "tool", "tool_call_id": "zzz", "content": "x"}]` 起始历史就是坏的:一条没头没尾的 tool 消息。
- `with pytest.raises(BadHistory, match="第一次请求前"):` 应该在第一次请求前就拦住。
- `assert fake.seen == []  # 一次请求都没发` 假客户端一次请求都没收到。

</div>

```bash
uv run pytest -q tests/test_ex160_guard.py
```

```text
...                                                                      [100%]
3 passed in 0.17s
```

这里有一个取舍:护栏会让每次请求前多一次 O(n) 的扫描,n 是消息条数,几十上百条的话是微秒级,可以忽略。真正的代价是你多维护了一份「规矩」,服务端哪天放宽了规则(比如某个厂商允许 tool 消息之间插别的消息),你的检查反而会误报。所以我只把它当开发期的护栏,线上遇到 400 还是要认真读报错。

</details>

**练习 2:带工具的对话存得进去,读不回来?** Day 155 的 `/save` 存的是 `Conversation`,Day 159 起 `Conversation` 里多了 `tool` 消息和带 `tool_calls` 的 assistant 消息。真的把一段带工具的对话存下来,再用 Day 155 的 `load_session` 读回来,看会发生什么。然后写一个认识 tool 消息的加载器,并且要保留 Day 155 的原则:读回来的文件不能信,请求和结果不成对的文件要拒绝。

<details><summary>参考答案</summary>

先把问题复现出来。新建 `part03/ex160_sessions.py`,它真的问两个发票问题(会联网调用模型 4 次),把对话存到系统临时目录,分别用旧加载器、新加载器读,再手工改坏一份文件看新加载器拦不拦得住:

```python
# agent-zero-lab/part03/ex160_sessions.py
import json
import tempfile
from pathlib import Path
from typing import Any

from common.llm import Conversation, LLMClient
from part02.sessions import SessionError, load_session, save_session
from part03.dictation160 import execute_call
from part03.invoice_data import INVOICE_TOOL, get_invoice
from part03.sessions_tools import load_session_tools

TOOLS = [INVOICE_TOOL]
FUNCS = {"get_invoice": get_invoice}


def tool_turn(client: LLMClient, conv: Conversation, question: str) -> None:
    conv.add_user(question)
    r = client.chat(conv.messages(), tools=TOOLS, temperature=0, max_tokens=300)
    conv.add_assistant(r.message)
    for call in r.message.get("tool_calls") or []:
        conv.add_assistant({"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS, FUNCS)})
    conv.add_assistant(client.chat(conv.messages(), tools=TOOLS, temperature=0, max_tokens=300).message)


def attempt(label: str, loader: Any, name: str, base: Path) -> None:
    try:
        conv = loader(name, base)
        print(f"{label}: 读回来了,{len(conv.turns)} 轮,每轮的角色 {[[m['role'] for m in t] for t in conv.turns]}")
    except SessionError as e:
        print(f"{label}: 失败 | {str(e).replace(str(base), '<目录>')}")


def main() -> None:
    client = LLMClient()
    conv = Conversation("你是云簿客服。回答简短。")
    tool_turn(client, conv, "INV-2026-0042 现在是什么状态?")
    tool_turn(client, conv, "那 INV-2026-0043 呢?")
    with tempfile.TemporaryDirectory() as d:
        base = Path(d)
        save_session(conv, "ok", base)
        attempt("Day 155 的 load_session   ", load_session, "ok", base)
        attempt("新的 load_session_tools   ", load_session_tools, "ok", base)

        # 手工把文件改坏:删掉第一轮的 assistant(带 tool_calls)那条,tool 消息就成了没头没尾的东西
        data = json.loads((base / "ok.json").read_text(encoding="utf-8"))
        del data["turns"][0][1]
        (base / "broken.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        attempt("改坏的文件 + 新的加载器   ", load_session_tools, "broken", base)
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import json` 读写会话文件、手工改坏文件时用。
- `import tempfile` 临时目录:`TemporaryDirectory()` 在 `with` 结束时整个删掉,不会在你的仓库里留任何会话文件。
- `from pathlib import Path` 路径对象。
- `from part02.sessions import SessionError, load_session, save_session` Day 155 的存取。`save_session` 不挑内容,存什么都行;`load_session` 才会校验。
- `from part03.sessions_tools import load_session_tools` 下面要写的新加载器。
- `TOOLS = [INVOICE_TOOL]` 今天小项目的发票工具。
- `FUNCS = {"get_invoice": get_invoice}` 白名单,用第二版函数。
- `def tool_turn(client: LLMClient, conv: Conversation, question: str) -> None:` 在 `Conversation` 里走一整轮带工具的对话。
- `conv.add_user(question)` 开一个新的「轮」。
- `r = client.chat(conv.messages(), tools=TOOLS, temperature=0, max_tokens=300)` 请求 1,发出去的是 system 加全部历史。
- `conv.add_assistant(r.message)` 追加 assistant 消息(Day 159 讲过,`add_assistant` 其实是「往当前轮末尾追加一条」)。
- `for call in r.message.get("tool_calls") or []:` 逐个请求。
- `conv.add_assistant({"role": "tool", "tool_call_id": call["id"], "content": execute_call(call, TOOLS, FUNCS)})` 追加 tool 消息。
- `conv.add_assistant(client.chat(conv.messages(), tools=TOOLS, temperature=0, max_tokens=300).message)` 请求 2,最终回答追加进去。
- `def attempt(label: str, loader: Any, name: str, base: Path) -> None:` 试着读一次,成功就打印每轮的角色,失败就打印报错。
- `conv = loader(name, base)` `loader` 是函数,所以旧的和新的加载器可以传同一个位置。
- `print(f"{label}: 读回来了,{len(conv.turns)} 轮,每轮的角色 {[[m['role'] for m in t] for t in conv.turns]}")` 嵌套推导式取角色。
- `except SessionError as e:` Day 155 的专用异常。
- `print(f"{label}: 失败 | {str(e).replace(str(base), '<目录>')}")` 报错里有临时目录的真实路径,换成 `<目录>`。
- `conv = Conversation("你是云簿客服。回答简短。")` 新对话。
- `tool_turn(client, conv, "INV-2026-0042 现在是什么状态?")` 第 1 轮,4 条消息。
- `tool_turn(client, conv, "那 INV-2026-0043 呢?")` 第 2 轮,「那…呢」靠历史才懂。
- `with tempfile.TemporaryDirectory() as d:` 进入 `with` 时建目录,离开时删。
- `save_session(conv, "ok", base)` 存成 `ok.json`。
- `attempt("Day 155 的 load_session   ", load_session, "ok", base)` 旧加载器读。
- `attempt("新的 load_session_tools   ", load_session_tools, "ok", base)` 新加载器读。
- `data = json.loads((base / "ok.json").read_text(encoding="utf-8"))` 把存好的文件读成字典,准备手工改。
- `del data["turns"][0][1]` 删掉第 1 轮里下标 1 的消息,也就是带 `tool_calls` 的 assistant 那条。剩下 user、tool、assistant 三条,tool 消息成了没头没尾的东西。
- `(base / "broken.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")` 存成另一个文件。
- `attempt("改坏的文件 + 新的加载器   ", load_session_tools, "broken", base)` 新加载器应该拒绝它。
- `print(client.ledger)` 4 次调用的合计。

</div>

```bash
uv run python -m part03.ex160_sessions
```

```text
Day 155 的 load_session   : 失败 | <目录>/ok.json 格式不对,turns.0.2.role:Input should be 'user' or 'assistant'
新的 load_session_tools   : 读回来了,2 轮,每轮的角色 [['user', 'assistant', 'tool', 'assistant'], ['user', 'assistant', 'tool', 'assistant']]
改坏的文件 + 新的加载器   : 失败 | <目录>/broken.json 格式不对,turns:Value error, 第 1 轮的工具消息不成对:[1] tool_call_id 'call_00_lzwHsWzBs8GsvHnkHH5N5504' 对不上前面任何一个请求
4 次调用 | 输入 2312 / 输出 194 tokens | 约 ¥0.0032
```

第一行就是问题:Day 155 的 `load_session` 读不了带 tool 消息的对话,报 `turns.0.2.role:Input should be 'user' or 'assistant'`,意思是第 0 轮第 2 条(下标 2,也就是 tool 消息)的 `role` 不在白名单里。存的时候没有任何报错,**存进去了、读不回来**,等你第二天想 `/load` 昨天的对话时才发现。如果用户的对话是半小时的排查记录,就是半小时的内容丢了。

(`call_00_…` 后面那串 id 每次运行都不一样,你的输出里它会是别的字符。)

修法是写一个认识 tool 消息的校验模型。新建 `part03/sessions_tools.py`,它只重写校验的那两个类和加载函数,路径白名单、`SessionError`、`save_session` 都沿用 Day 155 的:

```python
# agent-zero-lab/part03/sessions_tools.py
"""Day 155 的 sessions.py 只认 user/assistant;这里是认 tool 消息的版本(Day 160 练习 2)。"""
import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from common.llm import Conversation
from part02.sessions import SESSIONS, SessionError, session_path
from part03.check_messages import check_messages


class Message(BaseModel):
    model_config = ConfigDict(extra="allow")  # tool_calls、tool_call_id、reasoning_content 都原样放行

    role: Literal["user", "assistant", "tool"]
    content: str  # assistant 只提请求时是 "",不是 None


class SessionFile(BaseModel):
    system: str
    max_turns: int = 20
    turns: list[list[Message]]

    @field_validator("turns")
    @classmethod
    def check_shape(cls, turns: list[list[Message]]) -> list[list[Message]]:
        for i, turn in enumerate(turns, start=1):
            if not turn or turn[0].role != "user":
                raise ValueError(f"第 {i} 轮必须以 user 消息开头")
            if any(m.role == "user" for m in turn[1:]):
                raise ValueError(f"第 {i} 轮里 user 消息只能在开头")
            problems = check_messages([m.model_dump() for m in turn])  # 请求和结果必须成对、整轮都在
            if problems:
                raise ValueError(f"第 {i} 轮的工具消息不成对:{problems[0]}")
        return turns


def load_session_tools(name: str, base: Path = SESSIONS) -> Conversation:
    path = session_path(name, base)
    if not path.is_file():
        raise SessionError(f"没有这个会话:{path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        SessionFile.model_validate(data)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise SessionError(f"{path} 不是合法的 JSON 文本:{e}") from e
    except ValidationError as e:
        first = e.errors()[0]
        where = ".".join(str(x) for x in first["loc"])
        raise SessionError(f"{path} 格式不对,{where}:{first['msg']}") from e
    return Conversation.from_dict(data)
```

<div class="line-notes">

- `import json` 读文件。
- `from typing import Literal` `Literal` 把字符串限定在几个值里,Day 155 用过,相当于 TS 的 `"user" | "assistant"`。
- `from pydantic import BaseModel, ConfigDict, ValidationError, field_validator` Day 51 的 pydantic。
- `from part02.sessions import SESSIONS, SessionError, session_path` 沿用 Day 155 的目录常量、专用异常和文件名白名单(`session_path` 里有 `fullmatch`)。
- `from part03.check_messages import check_messages` Day 159 的检查函数,下面用它检查「请求和结果成对」。
- `class Message(BaseModel):` 一条消息的校验模型。
- `model_config = ConfigDict(extra="allow")  # tool_calls、tool_call_id、reasoning_content 都原样放行` 多余的字段放行,`tool_calls`、`tool_call_id`、`reasoning_content` 以后要什么都能存。
- `role: Literal["user", "assistant", "tool"]` 和 Day 155 唯一的不同:多放行一个 `"tool"`。
- `content: str  # assistant 只提请求时是 "",不是 None` DeepSeek 的 assistant 消息只提请求时 `content` 是空字符串,所以 `str` 就够了。如果你换的厂商给 `None`,这里要改成 `str | None`,读回来才不会报错。
- `class SessionFile(BaseModel):` 整个会话文件的校验模型。
- `max_turns: int = 20` 早期的文件没有这个字段,默认 20。
- `turns: list[list[Message]]` 每一轮是一个消息列表。
- `@field_validator("turns")` 对整个 `turns` 字段做额外检查。
- `if not turn or turn[0].role != "user":` 每一轮必须以 user 消息开头。
- `if any(m.role == "user" for m in turn[1:]):` 一轮里 user 消息只能在开头。Day 155 的写法是「user 后面只能跟 assistant」,现在多了 tool,换成反过来说更简单。
- `problems = check_messages([m.model_dump() for m in turn])  # 请求和结果必须成对、整轮都在` 把每条消息还原成字典,直接用 Day 159 的检查函数。它检查的规矩正好就是我们要的:tool 消息的 id 要对得上前面的请求,请求不能没有回应。
- `raise ValueError(f"第 {i} 轮的工具消息不成对:{problems[0]}")` 只报第一个问题,够定位了。
- `def load_session_tools(name: str, base: Path = SESSIONS) -> Conversation:` 新的加载函数,签名和 Day 155 的 `load_session` 一样。
- `path = session_path(name, base)` 文件名白名单,沿用。
- `if not path.is_file():` 不存在的文件。
- `SessionFile.model_validate(data)` 用新的模型校验。通过了就继续,不通过抛 `ValidationError`。
- `except (json.JSONDecodeError, UnicodeDecodeError) as e:` 文件不是合法 JSON 文本。
- `first = e.errors()[0]` 取第一个校验错误。
- `where = ".".join(str(x) for x in first["loc"])` 把错误位置 `("turns", 0, 2, "role")` 拼成 `turns.0.2.role`。
- `return Conversation.from_dict(data)` 校验通过才还原成对话对象。

</div>

测试(不联网,手工造三种坏文件):

```python
# agent-zero-lab/tests/test_sessions_tools.py
import copy
import json
from pathlib import Path
from typing import Any

import pytest

from common.llm import Conversation
from part02.sessions import SessionError, save_session
from part03.sessions_tools import load_session_tools

CALL = {"id": "c1", "type": "function", "function": {"name": "get_invoice", "arguments": '{"invoice_id": "INV-2026-0042"}'}}
TURN: list[dict[str, Any]] = [
    {"role": "user", "content": "INV-2026-0042 什么状态?"},
    {"role": "assistant", "content": "", "tool_calls": [CALL]},
    {"role": "tool", "tool_call_id": "c1", "content": '{"status": "paid"}'},
    {"role": "assistant", "content": "已付款。"},
]


def make(tmp_path: Path, turn: list[dict[str, Any]]) -> None:
    conv = Conversation("你是客服。")
    conv.turns = [copy.deepcopy(turn)]
    save_session(conv, "t", tmp_path)


def test_tool_turn_round_trips(tmp_path: Path) -> None:
    make(tmp_path, TURN)
    loaded = load_session_tools("t", tmp_path)
    assert [m["role"] for m in loaded.turns[0]] == ["user", "assistant", "tool", "assistant"]
    assert loaded.turns[0][1]["tool_calls"][0]["id"] == "c1"  # tool_calls 没有被校验丢掉


def test_missing_assistant_is_rejected(tmp_path: Path) -> None:
    make(tmp_path, [TURN[0], TURN[2], TURN[3]])
    with pytest.raises(SessionError, match="不成对"):
        load_session_tools("t", tmp_path)


def test_unanswered_request_is_rejected(tmp_path: Path) -> None:
    make(tmp_path, TURN[:2])  # 提了请求,程序在执行时崩了,tool 消息没存下来
    with pytest.raises(SessionError, match="没收到结果"):
        load_session_tools("t", tmp_path)


def test_user_message_in_the_middle_is_rejected(tmp_path: Path) -> None:
    make(tmp_path, [*TURN, {"role": "user", "content": "再问一句"}])
    with pytest.raises(SessionError, match="只能在开头"):
        load_session_tools("t", tmp_path)


def test_plain_chat_still_loads(tmp_path: Path) -> None:
    make(tmp_path, [{"role": "user", "content": "你好"}, {"role": "assistant", "content": "你好!"}])
    assert len(load_session_tools("t", tmp_path).turns) == 1


def test_bad_json_text(tmp_path: Path) -> None:
    (tmp_path / "t.json").write_text("{坏的", encoding="utf-8")
    with pytest.raises(SessionError, match="不是合法的 JSON"):
        load_session_tools("t", tmp_path)


def test_file_written_as_utf8(tmp_path: Path) -> None:
    make(tmp_path, TURN)
    assert "已付款" in json.loads((tmp_path / "t.json").read_text(encoding="utf-8"))["turns"][0][3]["content"]
```

<div class="line-notes">

- `import copy` 拷贝标准的一轮消息再改。
- `import json` 读回写好的文件检查中文。
- `import pytest` 断言抛异常。
- `from common.llm import Conversation` 手工造对话。
- `from part02.sessions import SessionError, save_session` 存用 Day 155 的,读用新的。
- `from part03.sessions_tools import load_session_tools` 被测对象。
- `CALL = {"id": "c1", "type": "function", "function": {"name": "get_invoice", "arguments": '{"invoice_id": "INV-2026-0042"}'}}` 一条手工造的请求,id 是 `c1`。
- `TURN: list[dict[str, Any]] = [` 一轮标准的带工具对话:user、assistant(带请求)、tool(结果)、assistant(回答)。
- `def make(tmp_path: Path, turn: list[dict[str, Any]]) -> None:` 辅助函数:把一轮消息存成会话文件。`tmp_path` 是 pytest 自带的临时目录,每个测试一个,测完自动清理。
- `conv.turns = [copy.deepcopy(turn)]` 直接塞进去,绕过 `add_user` 的流程。
- `save_session(conv, "t", tmp_path)` 存成 `t.json`。
- `def test_tool_turn_round_trips(tmp_path: Path) -> None:` 往返测试:存了再读,角色顺序一样。
- `assert loaded.turns[0][1]["tool_calls"][0]["id"] == "c1"  # tool_calls 没有被校验丢掉` `extra="allow"` 的意义:校验只放行、不丢字段。
- `make(tmp_path, [TURN[0], TURN[2], TURN[3]])` 去掉带请求的 assistant 消息。
- `with pytest.raises(SessionError, match="不成对"):` 应该拒绝。
- `make(tmp_path, TURN[:2])  # 提了请求,程序在执行时崩了,tool 消息没存下来` 只剩 user 和带请求的 assistant:模拟「执行工具时程序崩了,对话存到一半」。
- `match="没收到结果"` 检查函数的结尾那条报错「结尾还有请求没收到结果」被带出来了。
- `make(tmp_path, [*TURN, {"role": "user", "content": "再问一句"}])` 一轮里中间混进了第二条 user 消息。
- `match="只能在开头"` 应该被「user 消息只能在开头」拦住。
- `def test_plain_chat_still_loads(tmp_path: Path) -> None:` 回归测试:不带工具的普通对话,新加载器照样读得了。
- `(tmp_path / "t.json").write_text("{坏的", encoding="utf-8")` 手写一份坏 JSON。
- `match="不是合法的 JSON"` 走 `JSONDecodeError` 那条分支。
- `assert "已付款" in json.loads((tmp_path / "t.json").read_text(encoding="utf-8"))["turns"][0][3]["content"]` 文件里的中文可读(`ensure_ascii=False`)。

</div>

```bash
uv run pytest -q tests/test_sessions_tools.py
```

```text
.......                                                                  [100%]
7 passed in 1.03s
```

实际接进聊天机器人要改 `ChatBot` 的 `/load`,让它调 `load_session_tools`。这个改动不到十行,但那是以后「聊天机器人加上工具」那一天的事,今天不动 Day 152–155 的文件。

</details>

**练习 3:每轮成本行要加上所有请求。** Day 154 的 `turn_line` 一轮只显示一个 `ChatResult`。现在一轮可能有两次模型请求(请求 1 提工具,请求 2 回答),如果只传最后一次,显示的钱会少多少?写 `merge_results`,把一轮里所有请求的用量和花费加起来,真的问一个要调工具的问题,对比「只看最后一次」和「加起来」两种成本行。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/ex160_turn_cost.py
from dataclasses import replace
from typing import Any

from common.llm import ChatResult, LLMClient
from part02.chatbot import turn_line
from part03.dictation160 import execute_call
from part03.invoice_data import INVOICE_TOOL, get_invoice

TOOLS = [INVOICE_TOOL]


def merge_results(results: list[ChatResult]) -> ChatResult:
    """一轮里可能有好几次模型请求:用量和花费加起来,回答、结束原因取最后一次。"""
    last = results[-1]
    return replace(
        last,
        prompt_tokens=sum(r.prompt_tokens for r in results),
        completion_tokens=sum(r.completion_tokens for r in results),
        cache_hit_tokens=sum(r.cache_hit_tokens for r in results),
        cost=sum(r.cost for r in results),
        latency=sum(r.latency for r in results),
        ttft=None,  # 非流式没有首字延迟
    )


def one_turn(client: LLMClient, question: str) -> list[ChatResult]:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": "你是云簿客服。回答简短。"},
        {"role": "user", "content": question},
    ]
    results = [client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)]
    calls = results[0].message.get("tool_calls") or []
    if calls:
        messages.append(results[0].message)
        for call in calls:
            result = execute_call(call, TOOLS, {"get_invoice": get_invoice})
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": result})
        results.append(client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300))
    return results


def main() -> None:
    client = LLMClient()
    results = one_turn(client, "INV-2026-0042 现在是什么状态?")
    print(f"这一轮发了 {len(results)} 次请求,账本记了 {client.ledger.calls} 次")
    print("只看最后一次:", turn_line("deepseek", results[-1], client.ledger.cost))
    print("加起来      :", turn_line("deepseek", merge_results(results), client.ledger.cost))
    print(f"账本总花费 ¥{client.ledger.cost:.5f};两次分别 ¥{results[0].cost:.5f} + ¥{results[1].cost:.5f}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from dataclasses import replace` `replace(obj, 字段=新值)` 拷贝一个 dataclass,只改指定字段,原对象不动。类似 JS 的 `{ ...obj, field: newValue }`。
- `from common.llm import ChatResult, LLMClient` `ChatResult` 是一次请求的结果(Day 135)。
- `from part02.chatbot import turn_line` Day 154 的成本行格式化函数,直接复用。
- `def merge_results(results: list[ChatResult]) -> ChatResult:` 把一轮里的多次结果合成一个。
- `last = results[-1]` 回答、结束原因、`message` 都以最后一次为准。
- `return replace(` 以最后一次为底,覆盖用量字段。
- `prompt_tokens=sum(r.prompt_tokens for r in results),` 输入 token 相加。
- `completion_tokens=sum(r.completion_tokens for r in results),` 输出 token 相加。
- `cache_hit_tokens=sum(r.cache_hit_tokens for r in results),` 命中缓存的 token 相加。
- `cost=sum(r.cost for r in results),` 花费相加。
- `latency=sum(r.latency for r in results),` 耗时相加。
- `ttft=None,  # 非流式没有首字延迟` 两次非流式请求,「首字延迟」没有意义,成本行里会显示 `-`。
- `def one_turn(client: LLMClient, question: str) -> list[ChatResult]:` 走一轮,返回这一轮所有请求的结果。
- `results = [client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300)]` 先放请求 1 的结果。
- `calls = results[0].message.get("tool_calls") or []` 有没有请求。
- `result = execute_call(call, TOOLS, {"get_invoice": get_invoice})` 执行。
- `results.append(client.chat(messages, tools=TOOLS, temperature=0, max_tokens=300))` 请求 2 的结果也放进去。
- `print(f"这一轮发了 {len(results)} 次请求,账本记了 {client.ledger.calls} 次")` 对账:两个数应该相等。
- `print("只看最后一次:", turn_line("deepseek", results[-1], client.ledger.cost))` Day 154 原来的用法。
- `print("加起来      :", turn_line("deepseek", merge_results(results), client.ledger.cost))` 合并之后的用法。
- `print(f"账本总花费 ¥{client.ledger.cost:.5f};两次分别 ¥{results[0].cost:.5f} + ¥{results[1].cost:.5f}")` 账本总数,和两次各自的花费相加对一下。

</div>

```bash
uv run python -m part03.ex160_turn_cost
```

```text
这一轮发了 2 次请求,账本记了 2 次
只看最后一次:   [deepseek | 首字 - | 输入 545(缓存 384) | 输出 51 | ¥0.00075 | 累计 ¥0.0014]
加起来      :   [deepseek | 首字 - | 输入 962(缓存 640) | 输出 97 | ¥0.00145 | 累计 ¥0.0014]
账本总花费 ¥0.00145;两次分别 ¥0.00070 + ¥0.00075
```

只看最后一次,成本行显示输入 545、输出 51、花费 ¥0.00075;加起来是输入 962、输出 97、花费 ¥0.00145,和账本的总花费 ¥0.00145 对得上。用户看到的数字少了将近一半。越是工具多的对话,低估越多:Day 166 做循环以后,一个问题可能发五六次请求,那时成本行只看最后一次就差得更远了。(累计那一列 `¥0.0014` 是账本总数四舍五入到四位小数,所以和 `0.00145` 看起来差一点点。)

这个问题可以放在两个地方修:要么像上面这样在 `ChatBot` 里收集一轮的所有结果再合并,要么让 `LLMClient` 自己知道「这是同一轮」。后一种要改共享模块的接口,留给以后真的需要的那一天。

</details>

**验收标准:** 能不看文章说出一次工具调用的五个环节和每个环节由谁做;`review160_check.py` 16 项全部打勾;`invoice_bot.py v2` 能 8/8,并且你能解释 `v1` 的第 4 题为什么失败;三个练习的测试或脚本都跑通;能说出本周两处「模块拼起来才出现」的问题(带工具的会话读不回来、成本行少算)分别出在哪两天的哪个函数。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 复习日 | 不学新东西,只整理知识地图、错题,并默写本周核心代码的一天 |
| 默写 | 合上文章,凭记忆把代码写出来,再用检查脚本验收。比「看懂了」更能暴露哪里是真的记住了 |
| 假客户端(fake) | 一个只按预先写好的剧本回答的替身,不联网、不花钱,测试里用来代替 `LLMClient`,还能记下收到了什么 |
| Protocol | Python 的「结构类型」:只要对象有这些方法就算符合,不需要继承。类似 TypeScript 的 interface |
| 痕迹(trace) | 一次运行从头到尾留下的记录:提了什么请求、工具回了什么、最后说了什么。验收靠它而不是肉眼看回答 |
| 判定函数 | 一个小函数,输入痕迹、输出「通过」或「失败原因」。把「回答得好不好」变成能自动跑的检查 |
| 护栏(guard) | 在做危险动作之前先检查的一层代码,检查不过就停。这里是发请求之前检查 `messages` |
| 静默失败 | 没有报错、回答还像模像样,但内容是错的。本周的空结果、`length` 截断、`enum` 管不住意图都是 |
| 往返测试(round trip) | 存出去再读回来,看结果和原来一样。会话保存、序列化类的代码都该有 |

## 常见误区

**以为默写是考记忆力。** 它测的是你有没有真的理解每一步为什么在那里。漏了 `messages.append(first.message)` 的人,通常是只记住了「要放 tool 消息」,没有记住「tool 消息要回应前面的某条消息」。

**检查脚本只写正常路径。** `review160_check.py` 里一半的项是故意给坏输入(被截断的 JSON、多塞的参数、会抛异常的工具、空结果)。只测正常路径的检查,在你最需要它的地方不会拦住任何东西。

**把检查本身写得不能出错。** 默写错了的代码可能让检查抛异常。检查脚本里每一项都包 `try`,抛了也当作没通过并继续往下跑,不然你只能看到第一个错误。

**工具找不到数据就抛异常。** 「没有这张发票」是一个正常的查询结果,不是出错。抛异常的结果是模型看到「工具内部出错」,然后把内部类名说给用户。让工具返回 `found: false` 加一句人话。

**只测单个模块。** 这周的两处问题,会话保存读不回 tool 消息、成本行少算,单看 Day 155 或 Day 154 都没毛病,是和 Day 159 拼在一起才出现。每周复习里留一个「把这周的东西拼起来」的小项目,就是为了找这类问题。

**以为 `or "(工具没有返回内容)"` 在 `execute_call` 这条路上起作用。** `json.dumps("")` 是两个引号,不是空字符串,所以那个兜底其实不会触发。保护来自 `json.dumps`,不是 `or`。留着它是防备别人换一个不走 `json.dumps` 的运行器。

**用一次运行的结果下结论。** 今天的 8 道题我在 `v1` 和 `v2` 上各跑了两三次,回答的措辞每次略有不同(`temperature=0` 也不保证逐字相同),通过与否只在第 4 题上有稳定的区别。8 题不是统计,只是个冒烟测试。

**把自定义异常当成脚本里的摆设。** 练习 1 里的 `BadHistory` 看起来多余,实际是让调用者能「只处理我们自己拦下来的情况」,而不去吞掉网络超时之类别的错误。

## 学习资料

### 文档与文章

- [Anthropic:Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):英文,Anthropic 工程团队 2024 年底的文章,把「工作流」和「Agent」分开讲,工具是 Agent 的核心积木。第三部分后面每一天都会用到它的说法,趁复习日读一遍开头。
- [DeepSeek 文档:Tool Calls](https://api-docs.deepseek.com/zh-cn/guides/tool_calls):中文,本周一直在对照的示例。复习日再读一遍,看这周学的每一块能不能在示例里找到对应的行。
- [OpenAI 文档:Function calling](https://platform.openai.com/docs/guides/function-calling):英文,各家兼容协议的原版,文档里的流程图可以和今天的知识地图对照。
- [Anthropic 文档:Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls):英文,Claude 一侧怎么处理请求和结果,Day 164 才对照讲,先知道有这回事。
- [Python 文档:typing.Protocol](https://docs.python.org/zh-cn/3.12/library/typing.html):中文,页面很长,搜 `Protocol`,看「结构子类型」那一段。今天 `ChatLike` 用的就是它。
- [python-jsonschema 文档](https://python-jsonschema.readthedocs.io/en/stable/):英文,`iter_errors` 的用法,`execute_call` 第三关靠它。
- [pytest 文档:monkeypatch](https://docs.pytest.org/en/stable/how-to/monkeypatch.html):英文,测试里临时替换环境变量、函数的办法。今天没用到,但从 Day 154 的测试里遇到 `load_dotenv` 污染环境开始,以后会用。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV16ua161Ede&autoplay=0&high_quality=1" title="LLM API 加入 tools:tool_calls、role &quot;tool&quot;、工具loop一次看懂" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>CodingStartup起码课 · LLM API 加入 tools:tool_calls、role "tool"、工具loop一次看懂 · 9 分 2 秒,2026 年 10 月。Day 159 推荐过,复习日再看一遍,这次对着今天的知识地图,看它每一步对应哪个环节。我只核对了标题和时长,没有逐帧看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1vqNX6xEDC&autoplay=0&high_quality=1" title="大模型面试:Agent工具调用失败怎么处理?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI-Agent搭建 · 大模型面试:Agent工具调用失败怎么处理? · 3 分 11 秒,2026 年 7 月。短,面试口径。今天小项目第 4 题(工具找不到数据)和这条面试题是同一类问题,看它讲了几种处理办法,对比我们「变成字符串发回给模型」的做法。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12rDYBcErz&autoplay=0&high_quality=1" title="面试官:如何保证 Agent 调用工具 (Function Calling) 的 可靠性?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵AI大模型 · 面试官:如何保证 Agent 调用工具 (Function Calling) 的 可靠性? · 3 分 48 秒,2026 年 4 月。短,面试口径。看完对照今天「本周错题」那张表,数一数它讲到了其中几条。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/uhJJgc-0iTQ" title="Building more effective AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Building more effective AI agents · 英文,Anthropic 官方频道。Day 156、157 推荐过,这一周学完了工具调用的整条链路,再看一次,留意它怎么谈「给 Agent 的工具」。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/k6_WFGt8uoM" title="Function Calling Explained: How an LLM Uses Tools, Step by Step" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Zero 2 Concept · Function Calling Explained: How an LLM Uses Tools, Step by Step · 英文。一步步演示来回的过程,和今天知识地图下半部分的五个环节是一回事。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering: Building Applications with Foundation Models》(O'Reilly,2025):英文,Agent 一章讲工具调用的流程和常见失败。[出版社页面](https://www.oreilly.com/library/view/ai-engineering/9781098166298/)(对爬虫返回 403,需浏览器打开)。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):我们用的 SDK,可以搜 `ChatCompletionToolMessageParam` 看 tool 消息的类型定义。
- [python-jsonschema/jsonschema](https://github.com/python-jsonschema/jsonschema):`execute_call` 第三关用的校验库,`README` 里有最短的例子。

## 自测

1. 一次工具调用的五个环节是什么?每个环节是模型做的还是我们的代码做的?

<details><summary>答案</summary>

请求 1(我们发,带 `tools`)、模型回 `tool_calls`(模型)、本地检查再执行(我们)、tool 消息按 id 放回(我们)、请求 2 和模型的回答(模型)。五个环节里有三个是我们自己的代码,所以工具调用里大部分「出了问题」,出在我们这一侧:参数没检查、结果没放对位置、空结果没兜底。

</details>

2. `execute_call` 里 `except WeatherError` 为什么必须写在 `except Exception` 前面?写反了会怎样?

<details><summary>答案</summary>

Python 按顺序匹配 `except`,第一个匹配的就生效。`Exception` 是几乎所有异常的父类,写在前面就把所有异常都吃掉了,写在后面的 `WeatherError` 永远走不到。后果不是报错,而是给模型的信息变差:本来是「找不到叫 '火星城' 的城市,请换个写法」这句能让模型换参数重试的人话,变成了「工具内部出错(WeatherError)」。今天的 `review160_traps.py` 里第 7 个坑复现了它。

</details>

3. 工具返回 `""` 时,`execute_call` 放进 tool 消息的 `content` 是什么?为什么模型的反应和 Day 159 实验五不同?

<details><summary>答案</summary>

`json.dumps("")` 的结果是两个引号 `""`,不是真的空字符串。实测真的空字符串三次都编出「北京 26°C」,两个引号三次都说「天气查询暂时没有返回结果」。保护来自 `json.dumps`,所以 `or "(工具没有返回内容)"` 在 `execute_call` 这条路上不会触发。但这个保护是巧合,别的运行器不走 `json.dumps` 就会失效,所以兜底仍然值得保留。

</details>

4. 小项目 `v1` 第 4 题为什么失败?修的办法为什么是改工具而不是改提示词?

<details><summary>答案</summary>

`get_invoice_v1` 找不到发票就抛 `InvoiceNotFound`,`execute_call` 只认 `WeatherError`,走兜底变成「错误:工具内部出错(InvoiceNotFound)」。模型分不清这是「用户给错编号」还是「系统坏了」,于是把异常名原样说给了用户。「没有这张发票」是一个正常的查询结果,不是出错,所以改工具:返回 `found: false` 加一句人话。改提示词(「别提内部名字」)治标不治本,换个说法模型还会漏出别的内部细节;工具返回值本身就是给模型的提示词,从源头写对更稳。

</details>

5. 面试题:「实现一次完整的工具调用,有哪些地方要在本地检查?为什么不能全信模型?」

<details><summary>答案</summary>

至少四处。一,请求里的函数名要在白名单里,模型可能写出没登记的名字。二,`arguments` 是字符串,要 `json.loads` 并处理失败,被 `max_tokens` 截断或者模型写错都会解析失败。三,参数要按 schema 检查类型、必填和多余字段(JSON Schema 默认放行多余字段,要显式 `additionalProperties: false`)。四,发回去的历史要成对:每个请求一条 tool 消息、id 对得上、content 是非空字符串。不能全信模型,是因为它只是在「写一段看起来对的 JSON」,参数里可能带着用户或网页里夹带的内容(路径穿越、URL 拼接、提示词注入),格式对不代表内容对;所有失败还要变成一句模型看得懂的话(「错误:…」)发回去,而不是抛异常或者留空。

</details>

6. 面试题:「你写了会话保存功能,后来给聊天机器人加了工具,有什么要回头检查的?」

<details><summary>答案</summary>

会话的数据形状变了:历史里多了 `role: "tool"` 的消息和带 `tool_calls` 的 assistant 消息,`content` 可能是空字符串。回头要检查三件事:一,保存的校验模型(pydantic)是不是还只认 user 和 assistant,今天实测是只认这两个,存得进去、读不回来;二,读回来的校验要保留「请求和结果成对」的检查,不然手改坏的或者执行中途崩溃存下来的文件会让下一次请求直接 400;三,往返测试要覆盖带工具的轮次。做法是数据形状一变,就把「存再读」的往返测试补上。

</details>

## 明天预告

Day 161 · 漏回 tool 消息会怎样。Day 159 已经演示过「漏了 assistant 那条」和「id 写错」,那两个都是**消息顺序**的问题。明天换一个更隐蔽的:模型一次提了两个请求,我们只回了一个,另一个忘了。服务端会返回一个很有名的 400(`insufficient tool messages following tool_calls message`),我们要故意触发它,读懂它的原文,看一个请求没有回应是怎么出现的,再把今天练习 1 的护栏用上。明天开始,第三部分进入「模型一次要多个工具」的阶段。
