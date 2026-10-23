---
title: 'Day 155 · 小项目(三):保存对话、知识地图和面试题'
description: '给聊天机器人加 /save、/load 和 /system:把 Conversation 存成 JSON 文件、读回来接着聊。存文件会碰到两件事,文件名里带 ../ 能写出目录之外,手改坏的文件读回来会让历史变形,所以文件名要白名单、文件内容要用 pydantic 校验。最后给第二部分(Day 106–155)画一张知识地图,整理一份面试题。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'json', 'cli', 'agent-zero']
series: 'agent-zero'
day: 155
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 154](/blog/agent-zero/day-154-chatbot-2/) 给聊天机器人加了每轮成本行和 `/env` 切换厂商。切换时配置文件缺一行,价格和模型名会悄悄沿用上一家的,所以先用 `dotenv_values` 检查再新建客户端;被 Ctrl+C 打断的调用拿不到 `usage`,按字数估一笔记进 `self.aborted`。

今天是聊天机器人的最后一天,也是第二部分(大模型与 API,Day 106–155)的最后一天。机器人现在有一个明显的缺点:退出就忘,下次启动从头开始。所以先加存取对话,然后把这 50 天回头看一遍。

## 今天要解决的问题

学完今天你应该能做到:

1. 把一个 `Conversation` 存成 JSON 文件再读回来,读回来的对象和存之前的 `messages()` 完全一样,并给聊天机器人加上 `/save`、`/load`、`/system` 三个命令。
2. 说清楚为什么文件名和文件内容都不能直接信:用户输入的名字可能让文件写到目录之外,手改过的文件可能让历史变形,并且用白名单和 pydantic 各挡一道。
3. 不看文章画出第二部分的知识地图,讲得出每一块解决什么问题,对着面试题清单能各讲两分钟。

今天有两个新概念:**序列化**(把内存里的对象变成能存盘的文字,再变回来)和**不信任外部输入**(文件名、文件内容都当作可能有毛病)。

预计用时:3 小时,实跑花费不到 ¥0.03。前置:[Day 154](/blog/agent-zero/day-154-chatbot-2/) 的 `part02/chatbot.py`,[Day 37](/blog/agent-zero/day-037-pathlib/) 的 `Path`,[Day 39](/blog/agent-zero/day-039-json/) 的 `json`,[Day 35](/blog/agent-zero/day-035-exceptions-1/)–[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的异常,[Day 51](/blog/agent-zero/day-051-pydantic-1/)–[Day 52](/blog/agent-zero/day-052-pydantic-2/) 的 pydantic,[Day 53](/blog/agent-zero/day-053-env-secrets/) 的 `.gitignore`。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `save_session()` 和 `load_session()`;再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先想清楚要做什么

| 哪天 | 做什么 |
| --- | --- |
| [Day 152](/blog/agent-zero/day-152-chatbot-1/) | 输入循环、流式输出、多轮历史、四个命令、出错回滚 |
| [Day 154](/blog/agent-zero/day-154-chatbot-2/) | 每轮成本行、`/env`、`/cost`、估算被打断的调用 |
| 今天 Day 155 | `/save`、`/load`、`/system`,然后回顾第二部分 |

存一次对话,要存哪些东西?`Conversation` 里有三样:system 提示词、`max_turns`、`turns`(每一轮是一个小列表,里面是 user 和 assistant 消息)。存成 JSON 后长这样,这是后面第五步实跑得到的真实文件:

```json
{
  "system": "你是云簿 CloudLedger 的客服助手。回答简短,不确定就说不确定。",
  "max_turns": 10,
  "turns": [
    [
      {"role": "user", "content": "我叫小林,买的是年付套餐"},
      {"role": "assistant", "content": "小林你好!请问有什么可以帮你的?"}
    ]
  ]
}
```

(真实文件里每个字典是展开成多行的,这里为了短写成了一行。)

整个今天做的事,可以用一张图看清:

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="存取会话的路径:存时 Conversation 经 to_dict 变成字典再写成 JSON 文件,文件名先过白名单;读时先 json.loads、再用 pydantic 校验形状、最后 from_dict 变回 Conversation">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">/save 名字</text>
<rect x="20" y="40" width="130" height="44" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="30" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">session_path</text>
<text x="30" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">名字白名单</text>
<line x1="150" y1="62" x2="180" y2="62" stroke="var(--ink-faint)"/>
<rect x="180" y="40" width="130" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="190" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">conv.to_dict()</text>
<text x="190" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">对象变字典</text>
<line x1="310" y1="62" x2="340" y2="62" stroke="var(--ink-faint)"/>
<rect x="340" y="40" width="130" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="350" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">json.dumps</text>
<text x="350" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">字典变文字</text>
<line x1="470" y1="62" x2="500" y2="62" stroke="var(--ink-faint)"/>
<rect x="500" y="40" width="120" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="510" y="60" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">sessions/名字.json</text>
<text x="510" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">磁盘上的文件</text>
<text x="20" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">/load 名字</text>
<rect x="500" y="142" width="120" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="510" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">读文件文字</text>
<text x="510" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">read_text</text>
<line x1="500" y1="164" x2="470" y2="164" stroke="var(--ink-faint)"/>
<rect x="340" y="142" width="130" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="350" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">json.loads</text>
<text x="350" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">文字变字典</text>
<line x1="340" y1="164" x2="310" y2="164" stroke="var(--ink-faint)"/>
<rect x="180" y="142" width="130" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="190" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">SessionFile 校验</text>
<text x="190" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">pydantic 查形状</text>
<line x1="180" y1="164" x2="150" y2="164" stroke="var(--ink-faint)"/>
<rect x="20" y="142" width="130" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">from_dict</text>
<text x="30" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">字典变回对象</text>
<text x="20" y="226" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">存的时候检查名字,读的时候检查内容;两头各挡一道,中间的 json 只负责转换</text>
</svg>
<figcaption>上排是存,下排是读。蓝色是格式转换,琥珀色是和外部世界打交道的地方:文件名和文件内容都从外面来,所以都要检查。</figcaption>
</figure>

一步一步来,每一步都能跑。

## 第一步:Conversation 不能直接存

最直接的想法是 `json.dumps(conv)`。试一下,新建 `part02/save_demo1.py`:

```python
# agent-zero-lab/part02/save_demo1.py
import json

from common.llm import Conversation, LLMClient

client = LLMClient()
conv = Conversation("你是云簿 CloudLedger 的客服助手。回答简短。", max_turns=10)
conv.add_user("发票抬头开错了怎么办?一句话")
conv.add_assistant(client.chat(conv.messages(), temperature=0, max_tokens=100).message)

try:
    print(json.dumps(conv))
except TypeError as e:
    print("TypeError:", e)

data = {"system": conv.system["content"], "max_turns": conv.max_turns, "turns": conv.turns}
print(json.dumps(data))
print(json.dumps(data, ensure_ascii=False, indent=2))
```

<div class="line-notes">

- `import json` [Day 39](/blog/agent-zero/day-039-json/) 的标准库,`dumps` 把 Python 数据变成 JSON 文字。
- `conv = Conversation("你是云簿 CloudLedger 的客服助手。回答简短。", max_turns=10)` 一个新对话,system 是这句话,窗口 10 轮。
- `conv.add_user("发票抬头开错了怎么办?一句话")` 加一轮,`turns` 变成 `[[{"role": "user", ...}]]`。
- `conv.add_assistant(client.chat(conv.messages(), temperature=0, max_tokens=100).message)` 真的问一次模型,把完整的 assistant 消息补进这一轮。一行里做了三件事:`conv.messages()` 拼出要发的消息,`client.chat(...)` 发出去,`.message` 取回答的消息字典。
- `print(json.dumps(conv))` 直接序列化整个对象。`json` 只认字典、列表、字符串、数字、布尔和 `None`,不认我们自己定义的类。
- `except TypeError as e:` 实测抛的就是 `TypeError`。
- `data = {"system": conv.system["content"], "max_turns": conv.max_turns, "turns": conv.turns}` 手工拆成一个普通字典:`conv.system` 本身是 `{"role": "system", "content": ...}`,只存里面的文字;`conv.turns` 本来就是列表套字典,可以直接存。
- `print(json.dumps(data))` 默认写法,看输出里的 `你`。
- `print(json.dumps(data, ensure_ascii=False, indent=2))` 加两个参数,`ensure_ascii=False` 让中文原样输出,`indent=2` 缩进两格。相当于 JS 的 `JSON.stringify(data, null, 2)`。

</div>

```bash
uv run python -m part02.save_demo1
```

我的输出(2026-10-23):

```text
TypeError: Object of type Conversation is not JSON serializable
{"system": "你是云簿 CloudLedger 的客服助手。回答简短。", "max_turns": 10, "turns": [[{"role": "user", "content": "发票抬头开错了怎么办?一句话"}, {"content": "联系开票方作废重开即可。", "role": "assistant"}]]}
{
  "system": "你是云簿 CloudLedger 的客服助手。回答简短。",
  "max_turns": 10,
  "turns": [
    [
      {
        "role": "user",
        "content": "发票抬头开错了怎么办?一句话"
      },
      {
        "content": "联系开票方作废重开即可。",
        "role": "assistant"
      }
    ]
  ]
}
```

三个现象。第一,类的实例不能直接存,要先变成普通字典。第二,默认的 `json.dumps` 把每个汉字变成 `你` 这种转义,文件里没法读也没法手改,要加 `ensure_ascii=False`。这是 JS 的 `JSON.stringify` 没有的坑,因为 JS 默认就保留中文。第三,assistant 那条消息的 key 顺序是 `content` 先 `role` 后,因为这条消息是 SDK 对象用 `model_dump` 导出的;顺序对 JSON 没有影响,字典是按名字取值的。

## 第二步:给 Conversation 加 to_dict 和 from_dict

手工拼字典的那一行,以后每个要存对话的地方都得写一遍,而且改了 `Conversation` 的字段就要到处改。所以让类自己负责:加两个方法,一个导出,一个导入。打开 `common/llm.py`,在 `Conversation` 类**最后**(`messages()` 方法后面,空一行)加上:

```python
    def to_dict(self) -> dict[str, Any]:
        return {"system": self.system["content"], "max_turns": self.max_turns, "turns": self.turns}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Conversation:
        conv = cls(data["system"], data.get("max_turns", 20))
        conv.turns = data["turns"]
        return conv
```

<div class="line-notes">

- `def to_dict(self) -> dict[str, Any]:` 导出方法。返回值类型 `dict[str, Any]`:key 是字符串,value 什么类型都行。`Any` 在 `llm.py` 开头已经 `from typing import Any`。
- `return {"system": self.system["content"], "max_turns": self.max_turns, "turns": self.turns}` 就是第一步手工拼的那个字典。注意返回的 `turns` 是**同一个列表**,不是复制,改返回值会改到原对象;这里只拿去序列化,不会改它。
- `@classmethod` [Day 43](/blog/agent-zero/day-043-classes-3/) 学过的装饰器:声明下面这个方法属于类,不属于某个实例。
- `def from_dict(cls, data: dict[str, Any]) -> Conversation:` 第一个参数是 `cls`,指类本身,相当于 JS 的 `static fromDict(data)` 里的 `this`。调用写 `Conversation.from_dict(data)`,不用先有一个对象。
- `conv = cls(data["system"], data.get("max_turns", 20))` `cls(...)` 就是 `Conversation(...)`。`data["system"]` 必须有,没有就 `KeyError`;`data.get("max_turns", 20)` 没有这个 key 就用 20,这样早期没有这个字段的文件也能读。
- `conv.turns = data["turns"]` 构造函数只会建空历史,这里把存下来的整个换进去。
- `return conv` 返回新建的对象。返回类型直接写 `Conversation` 不用加引号:`llm.py` 开头有 `from __future__ import annotations`。

</div>

用一个小脚本验证来回一趟不丢东西。新建 `part02/roundtrip_demo.py`:

```python
# agent-zero-lab/part02/roundtrip_demo.py
import json

from common.llm import Conversation

conv = Conversation("你是云簿 CloudLedger 的客服助手。回答简短。", max_turns=10)
conv.add_user("发票抬头开错了怎么办?一句话")
conv.add_assistant({"role": "assistant", "content": "联系开票方作废重开即可。"})

data = conv.to_dict()
print("to_dict 的 key:", list(data))
text = json.dumps(data, ensure_ascii=False)
print("存成文字,长度:", len(text))

back = Conversation.from_dict(json.loads(text))
print("读回来 max_turns:", back.max_turns, "| 轮数:", len(back.turns))
print("messages 一样吗:", back.messages() == conv.messages())
print("是同一个对象吗:", back is conv)
```

<div class="line-notes">

- `conv.add_assistant({"role": "assistant", "content": "联系开票方作废重开即可。"})` 这次不调模型,手写一条回答,脚本不花钱。
- `data = conv.to_dict()` 对象变字典。
- `print("to_dict 的 key:", list(data))` `list(字典)` 得到所有 key,顺序是插入顺序。
- `text = json.dumps(data, ensure_ascii=False)` 字典变文字,这时候已经是一个纯字符串,可以写进文件、可以发给别人。
- `print("存成文字,长度:", len(text))` 实测 169 个字符。
- `back = Conversation.from_dict(json.loads(text))` 文字变字典(`json.loads`),字典变对象(`from_dict`)。
- `print("messages 一样吗:", back.messages() == conv.messages())` 两个列表逐元素比较,字典比较的是内容。这是 roundtrip(来回)测试的核心:转过去再转回来,结果要和原来一样。
- `print("是同一个对象吗:", back is conv)` `is` 比较的是是不是内存里的同一个东西。`False` 说明 `back` 是新建出来的,不是原对象的别名。

</div>

```bash
uv run python -m part02.roundtrip_demo
```

输出:

```text
to_dict 的 key: ['system', 'max_turns', 'turns']
存成文字,长度: 169
读回来 max_turns: 10 | 轮数: 1
messages 一样吗: True
是同一个对象吗: False
```

## 第三步:文件名不能直接拼

要存到 `sessions/名字.json`,最顺手的写法是 `Path("sessions") / f"{名字}.json"`。名字是用户在 `/save 名字` 里输入的。看看会发生什么,新建 `part02/naive_path.py`:

```python
# agent-zero-lab/part02/naive_path.py
from pathlib import Path

SESSIONS = Path("sessions")

for name in ["s1", "../escape", "a/b", "/etc/hosts"]:
    print(f"{name!r:14} -> {SESSIONS / f'{name}.json'}")

# 真写一次:名字里带 ../ 会怎样(只在练习仓库里写,事后删掉)
SESSIONS.mkdir(exist_ok=True)
path = SESSIONS / "../escape.json"
path.write_text("{}", encoding="utf-8")
print("写到了:", path.resolve().relative_to(Path.cwd()))
```

<div class="line-notes">

- `SESSIONS = Path("sessions")` 相对路径,相对的是**运行时的当前目录**。在 `agent-zero-lab` 根目录跑,就是 `agent-zero-lab/sessions`。
- `for name in ["s1", "../escape", "a/b", "/etc/hosts"]:` 四个名字:一个正常的,三个别有用心(或者只是手滑)的。`/etc/hosts` 在这里**只是被拼进路径、被打印**,下面没有任何代码去读写它。
- `print(f"{name!r:14} -> {SESSIONS / f'{name}.json'}")` `{name!r:14}` 先 `repr` 再占 14 位宽。`Path / 字符串` 是拼路径。f-string 里嵌套 f-string,外层用双引号、内层用单引号。
- `SESSIONS.mkdir(exist_ok=True)` 建 `sessions/` 目录,已经存在不报错。
- `path = SESSIONS / "../escape.json"` 实际拼出 `sessions/../escape.json`,`..` 表示上一级。
- `path.write_text("{}", encoding="utf-8")` 真的写了一个空 JSON。路径里的 `sessions/..` 抵消了,文件落在 `sessions` 的**上一级**。
- `print("写到了:", path.resolve().relative_to(Path.cwd()))` `resolve()` 把 `..` 算掉得到绝对路径,`relative_to(Path.cwd())` 再变成相对当前目录的写法。

</div>

```bash
uv run python -m part02.naive_path
```

输出:

```text
's1'           -> sessions/s1.json
'../escape'    -> sessions/../escape.json
'a/b'          -> sessions/a/b.json
'/etc/hosts'   -> /etc/hosts.json
写到了: escape.json
```

最后一行:文件写到了 `sessions/` 的外面,直接落在 `agent-zero-lab` 根目录。把名字换成 `../../../something`,就能逃出整个项目。这类问题叫**路径穿越**(path traversal),OWASP 有专门的页面讲它(见学习资料)。

第四行更有意思:`/etc/hosts` 变成了 `/etc/hosts.json`,`sessions/` 前缀**消失了**。这是 `pathlib` 的规则:用 `/` 拼接时,右边如果是绝对路径,左边整个被丢掉。所以不光是 `..`,连绝对路径也能让文件写到任何你有权限的地方。

聊天机器人是自己在本机用,似乎没人会攻击自己。但这个模式以后会反复出现:第三部分起,模型会决定往哪个路径写文件,文件名来自模型的输出,和来自用户的输入一样不可信。现在养成习惯。

防法是**白名单**:不去想哪些字符危险,只允许明确安全的。我们允许汉字、字母、数字、下划线和短横线,最长 40 个。新建 `part02/sessions.py`,先写文件名这一部分,后面几步会往里加:

```python
# agent-zero-lab/part02/sessions.py
import re
from pathlib import Path

SESSIONS = Path("sessions")
NAME_RE = re.compile(r"[\w-]{1,40}")  # 字母、数字(含汉字)、下划线、短横线


class SessionError(Exception):
    """存取会话失败。消息写成能直接给用户看的话。"""


def session_path(name: str, base: Path = SESSIONS) -> Path:
    name = name or "default"
    if not NAME_RE.fullmatch(name):
        raise SessionError(f"会话名只能用字母、数字、汉字、下划线和短横线,最长 40 个字符:{name!r}")
    return base / f"{name}.json"
```

<div class="line-notes">

- `NAME_RE = re.compile(r"[\w-]{1,40}")` 正则:方括号里是允许的字符,`\w` 表示「字母、数字、下划线」,在 Python 3 里也包括汉字;`-` 放在最后,表示短横线本身。`{1,40}` 表示重复 1 到 40 次。`/`、`.`、空格、反斜杠都不在里面,所以 `../x`、`a/b`、`a.b` 都过不了。
- `class SessionError(Exception):` 自己的异常类型([Day 36](/blog/agent-zero/day-036-exceptions-2/)),继承 `Exception`,类体里只有一句文档字符串。单独一个类型的好处是调用方可以只接这一种,不会误接别的错误。
- `def session_path(name: str, base: Path = SESSIONS) -> Path:` 给名字、给目录,返回完整路径。`base` 有默认值 `SESSIONS`,测试里可以传临时目录。
- `name = name or "default"` 空字符串是假值,就换成 `default`。所以 `/save` 不写名字,存成 `sessions/default.json`。
- `if not NAME_RE.fullmatch(name):` `fullmatch` 要求**整个字符串**都符合规则。用 `match` 的话,`s1/../x` 的开头 `s1` 符合就过了,这是个常见的错。
- `raise SessionError(f"会话名只能用` 报错消息末尾的 `{name!r}` 用引号包着显示名字,方便看清有没有多余的空格。
- `return base / f"{name}.json"` 通过检查的名字才拼进路径。后缀 `.json` 由我们加,用户不能指定。

</div>

先放着,下一步接着往这个文件里加东西。

## 第四步:读回来的文件也不能信

存的时候有文件名风险,读的时候有内容风险。会话文件是文本,用户可以用编辑器打开改,可能手滑改坏,也可能两个版本的程序存的格式不同。读回来的内容直接交给 `Conversation`,会发生什么?

假设有人把某一轮的 `user` 改成了 `assistant`(或者删掉了一条),历史就变成了「开头是 assistant」或者「两条连续的 user」。Day 152 练习 2 已经看到后果:模型把两个问题一起回答,或者有的厂商直接报 400。而且这种错要等到下一次提问才发作,离出错的地方(读文件)已经隔了很远,很难查。

所以读文件时,当场检查它的形状。[Day 51](/blog/agent-zero/day-051-pydantic-1/)–[Day 52](/blog/agent-zero/day-052-pydantic-2/) 学的 pydantic 就是干这个的。往 `part02/sessions.py` 里补全:

```python
# agent-zero-lab/part02/sessions.py
import json
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from common.llm import Conversation

SESSIONS = Path("sessions")
NAME_RE = re.compile(r"[\w-]{1,40}")  # 字母、数字(含汉字)、下划线、短横线


class SessionError(Exception):
    """存取会话失败。消息写成能直接给用户看的话。"""


class Message(BaseModel):
    model_config = ConfigDict(extra="allow")  # reasoning_content 之类的字段原样放行

    role: Literal["user", "assistant"]
    content: str


class SessionFile(BaseModel):
    system: str
    max_turns: int = 20  # 早期的文件没有这个字段
    turns: list[list[Message]]

    @field_validator("turns")
    @classmethod
    def check_shape(cls, turns: list[list[Message]]) -> list[list[Message]]:
        for i, turn in enumerate(turns, start=1):
            if not turn or turn[0].role != "user":
                raise ValueError(f"第 {i} 轮必须以 user 消息开头")
            if any(m.role != "assistant" for m in turn[1:]):
                raise ValueError(f"第 {i} 轮 user 后面只能跟 assistant")
        return turns


def session_path(name: str, base: Path = SESSIONS) -> Path:
    name = name or "default"
    if not NAME_RE.fullmatch(name):
        raise SessionError(f"会话名只能用字母、数字、汉字、下划线和短横线,最长 40 个字符:{name!r}")
    return base / f"{name}.json"


def save_session(conv: Conversation, name: str, base: Path = SESSIONS) -> Path:
    path = session_path(name, base)
    base.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(conv.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_session(name: str, base: Path = SESSIONS) -> Conversation:
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

- `import json` 新增的导入。其余导入里,`Literal` 是类型标注里「只能是这几个值之一」的写法,`pydantic` 的四个名字下面一个个讲。
- `from common.llm import Conversation` 存取的对象。
- `class Message(BaseModel):` 描述会话文件里的**一条消息**应该长什么样。
- `model_config = ConfigDict(extra="allow")` 默认情况下 pydantic 会忽略模型里没写的字段。设成 `"allow"` 是明确放行:assistant 消息里还可能有 `reasoning_content`(开着思考模式时)和以后第三部分才有的 `tool_calls`,我们只检查 `role` 和 `content`,其余原样放过。注意:校验用的这个对象只是检查用,最后传给 `from_dict` 的是原始字典,所以多余字段不会丢。
- `role: Literal["user", "assistant"]` 角色只能是这两个字符串之一。写成 `tool` 或者拼错成 `usr` 都会被拦。system 不在这里,因为它在文件里是单独的 `system` 字段。
- `content: str` 内容必须是字符串。第三部分 assistant 调工具时 `content` 可能是 `null`,到那天要把这里改成 `str | None`。
- `class SessionFile(BaseModel):` 描述**整个文件**。
- `system: str` 必填,没有就报「Field required」。
- `max_turns: int = 20` 有默认值,所以不是必填。早期没存这个字段的文件也能通过,和 `from_dict` 里的 `data.get("max_turns", 20)` 是同一个默认值。
- `turns: list[list[Message]]` 列表的列表,里层每个元素必须符合 `Message`。pydantic 会递归检查每一轮每一条。
- `@field_validator("turns")` 装饰器([Day 52](/blog/agent-zero/day-052-pydantic-2/)):给 `turns` 字段加一个自定义检查,在类型检查通过之后运行。
- `@classmethod` 配合上一行,validator 必须是类方法。
- `def check_shape(cls, turns: list[list[Message]]) -> list[list[Message]]:` 参数是已经通过类型检查的 `turns`,检查完要原样返回。
- `for i, turn in enumerate(turns, start=1):` `enumerate` 同时给下标和元素,`start=1` 让下标从 1 开始,错误消息里写「第 1 轮」符合人的习惯。
- `if not turn or turn[0].role != "user":` 空的一轮,或者第一条不是 user,都不合法。
- `raise ValueError(f"第 {i} 轮必须以 user 消息开头")` 在 validator 里抛 `ValueError`,pydantic 会把它收集进 `ValidationError`。
- `if any(m.role != "assistant" for m in turn[1:]):` `turn[1:]` 是第一条之后的所有消息,`any(...)` 是「有没有任何一个不是 assistant」。这条规则是第二部分的形状:一问,一答。第三部分加了工具消息后要放宽。
- `return turns` validator 必须返回值。
- `def session_path(name: str, base: Path = SESSIONS) -> Path:` 第三步写的,没变。
- `def save_session(conv: Conversation, name: str, base: Path = SESSIONS) -> Path:` 存。返回写到哪个文件,给调用方打印。
- `path = session_path(name, base)` 第一件事就是检查名字,不合法这里就抛 `SessionError`,后面不会执行。
- `base.mkdir(parents=True, exist_ok=True)` 目录不存在就建。`parents=True` 连中间层一起建(`a/b/c`),`exist_ok=True` 已经存在不报错。
- `path.write_text(json.dumps(conv.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")` 第一步、第二步学的全用上:对象转字典、字典转文字、文字写文件。`encoding="utf-8"` 明确指定编码,不依赖系统默认。
- `def load_session(name: str, base: Path = SESSIONS) -> Conversation:` 读,返回一个新的 `Conversation`。
- `if not path.is_file():` 实测 `/load nope` 打印「没有这个会话:sessions/nope.json」。
- `data = json.loads(path.read_text(encoding="utf-8"))` 读文字、转字典。文字不是合法 JSON 时这里抛 `JSONDecodeError`;文件是二进制或别的编码时,`read_text` 抛 `UnicodeDecodeError`。
- `SessionFile.model_validate(data)` 把字典交给 pydantic 检查,形状不对就抛 `ValidationError`。返回值不用,所以不赋值。
- `except (json.JSONDecodeError, UnicodeDecodeError) as e:` 一个元组接两种异常。
- `raise SessionError(f"{path} 不是合法的 JSON 文本:{e}") from e` 换成我们自己的异常类型,消息给用户看。`from e` 把原异常挂在后面,调试时 traceback 里能看到两层。
- `except ValidationError as e:` 形状不对。
- `first = e.errors()[0]` `e.errors()` 是错误列表,每个是字典,我们只报第一个,免得一屏全是红字。
- `where = ".".join(str(x) for x in first["loc"])` `loc` 是出错位置的路径,比如 `("turns", 0, 0, "role")`,拼成 `turns.0.0.role`,意思是「turns 里第 0 轮第 0 条的 role」。
- `raise SessionError(f"{path} 格式不对,{where}:{first['msg']}") from e` `first['msg']` 是 pydantic 的说明。f-string 外层双引号,里面取字典用单引号。
- `return Conversation.from_dict(data)` 全部检查都过了,才用**原始字典**造对象。

</div>

现在拿几个坏文件试。新建 `part02/load_demo.py`,造五个文件加一个不存在的,再试各种名字:

```python
# agent-zero-lab/part02/load_demo.py
import json
import shutil
from pathlib import Path

from part02.sessions import SessionError, load_session, session_path

demo = Path("sessions_demo")
demo.mkdir(exist_ok=True)

good_turn = [{"role": "user", "content": "你好"}, {"role": "assistant", "content": "你好!"}]
files = {
    "old": json.dumps({"system": "SYS", "turns": [good_turn]}),
    "broken": '{"system": "SYS", "turns": [',
    "shape": json.dumps({"system": "SYS", "turns": [[{"role": "assistant", "content": "我先说"}]]}),
    "nosys": json.dumps({"turns": []}),
    "badrole": json.dumps({"system": "SYS", "turns": [[{"role": "tool", "content": "x"}]]}),
}
for name, text in files.items():
    (demo / f"{name}.json").write_text(text, encoding="utf-8")

for name in [*files, "missing"]:
    try:
        conv = load_session(name, demo)
        print(f"{name:8} 读成功:max_turns={conv.max_turns},{len(conv.turns)} 轮")
    except SessionError as e:
        print(f"{name:8} {e}")

for name in ["", "s1", "会话-1", "../escape", "a/b", "/etc/hosts", "x" * 41]:
    try:
        print(f"{name[:12]!r:14} -> {session_path(name, demo)}")
    except SessionError as e:
        print(f"{name[:12]!r:14} 拒绝:{e}")

shutil.rmtree(demo)
```

<div class="line-notes">

- `import shutil` 标准库,最后用它的 `rmtree` 整个删掉演示目录。
- `demo = Path("sessions_demo")` 用一个单独的演示目录,不碰真正的 `sessions/`。
- `good_turn = [{"role": "user", "content": "你好"}, {"role": "assistant", "content": "你好!"}]` 一轮合法的问答,下面几个文件重复用它。
- `"old": json.dumps({"system": "SYS", "turns": [good_turn]}),` 没有 `max_turns` 的老格式文件,模拟早期版本存的。`json.dumps` 这里不加参数,中文无所谓,反正后面是 `json.loads` 读回来。
- `"broken": '{"system": "SYS", "turns": ['` 故意写了一半的 JSON,模拟写到一半断电或者手改丢了括号。
- `"shape": json.dumps({"system": "SYS", "turns": [[{"role": "assistant", "content": "我先说"}]]}),` 第一条是 assistant,违反「必须以 user 开头」。
- `"nosys": json.dumps({"turns": []}),` 缺 `system`。
- `"badrole": json.dumps({"system": "SYS", "turns": [[{"role": "tool", "content": "x"}]]}),` `tool` 不在允许的角色里。
- `for name, text in files.items():` `.items()` 同时拿 key 和 value。
- `(demo / f"{name}.json").write_text(text, encoding="utf-8")` 逐个写成文件。
- `for name in [*files, "missing"]:` `*files` 展开字典的所有 key(只有 key),再加一个不存在的名字。
- `print(f"{name:8} 读成功:max_turns={conv.max_turns},{len(conv.turns)} 轮")` `old` 文件会走到这里,`max_turns` 是 20。
- `for name in ["", "s1", "会话-1", "../escape", "a/b", "/etc/hosts", "x" * 41]:` 七个名字:空的、正常的、汉字的、三个危险的、41 个 x(超长)。
- `print(f"{name[:12]!r:14} -> {session_path(name, demo)}")` `name[:12]` 只取前 12 个字符,免得 41 个 x 占满一行。
- `shutil.rmtree(demo)` 删目录和里面所有文件,小心使用:路径写错会删掉别的东西。这里的路径是脚本里写死的 `sessions_demo`。

</div>

```bash
uv run python -m part02.load_demo
```

输出:

```text
old      读成功:max_turns=20,1 轮
broken   sessions_demo/broken.json 不是合法的 JSON 文本:Expecting value: line 1 column 29 (char 28)
shape    sessions_demo/shape.json 格式不对,turns:Value error, 第 1 轮必须以 user 消息开头
nosys    sessions_demo/nosys.json 格式不对,system:Field required
badrole  sessions_demo/badrole.json 格式不对,turns.0.0.role:Input should be 'user' or 'assistant'
missing  没有这个会话:sessions_demo/missing.json
''             -> sessions_demo/default.json
's1'           -> sessions_demo/s1.json
'会话-1'         -> sessions_demo/会话-1.json
'../escape'    拒绝:会话名只能用字母、数字、汉字、下划线和短横线,最长 40 个字符:'../escape'
'a/b'          拒绝:会话名只能用字母、数字、汉字、下划线和短横线,最长 40 个字符:'a/b'
'/etc/hosts'   拒绝:会话名只能用字母、数字、汉字、下划线和短横线,最长 40 个字符:'/etc/hosts'
'xxxxxxxxxxxx' 拒绝:会话名只能用字母、数字、汉字、下划线和短横线,最长 40 个字符:'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
```

每种坏法都得到一句看得懂的话,而且程序没崩。注意 `broken` 那条的位置信息「line 1 column 29」,是 `JSONDecodeError` 自带的,用户据此能找到手改坏的地方。`old` 没有 `max_turns`,读成功后默认 20。汉字名字 `会话-1` 通过了。

## 第五步:接进聊天机器人

三个命令:`/save [名字]`、`/load [名字]`、`/system [内容]`。先备份 Day 154 的版本,方便对比:

```bash
cp part02/chatbot.py part02/chatbot_day154.py
```

然后对 `part02/chatbot.py` 做 5 处修改。**第 1 处**,文件顶部 `from part02.envcheck import missing_keys` 后面加一行导入:

```python
from part02.sessions import SESSIONS, SessionError, load_session, save_session
```

<div class="line-notes">

- `from part02.sessions import SESSIONS, SessionError, load_session, save_session` 把第三、四步写的四样东西导进来:默认目录、异常类型、读、写。

</div>

**第 2 处**,`HELP` 里 `/cost` 那行后面加三行(别漏掉最后的三引号结尾,原来的 `/clear`、`/history`、`/quit` 三行留在后面):

```text
  /system [内容]  不带内容看现在的 system,带内容就改掉(历史保留)
  /save [名字]  把对话存到 sessions/<名字>.json,不写名字就叫 default
  /load [名字]  读回来,会替换现在的对话
```

**第 3 处**,`ChatBot.__init__` 里 `self.aborted = Ledger()` 后面加一行:

```python
        self.session_dir = SESSIONS  # 会话文件放哪;测试里可以改成临时目录
```

<div class="line-notes">

- `self.session_dir = SESSIONS` 把目录存成对象的属性,而不是每次都直接用模块里的 `SESSIONS`。这样测试里写 `bot.session_dir = tmp_path` 就能让存取走临时目录,不会往真实的 `sessions/` 里写文件。

</div>

**第 4 处**,在 `handle_command` 方法**前面**加三个方法:

```python
    def change_system(self, text: str) -> None:
        if not text:
            print("现在的 system:", self.conv.system["content"])
            return
        self.conv.system = {"role": "system", "content": text}
        print("system 已更新,历史保留。system 在最前面,改动处往后的缓存会失效,改得越靠前下一轮越贵")

    def save(self, name: str) -> None:
        try:
            path = save_session(self.conv, name, self.session_dir)
        except SessionError as e:
            print(e)
            return
        print(f"已保存 {len(self.conv.turns)} 轮到 {path}")

    def load(self, name: str) -> None:
        try:
            conv = load_session(name, self.session_dir)
        except SessionError as e:
            print(e)
            return
        self.conv = conv
        print(f"已加载,共 {len(conv.turns)} 轮,最多发最近 {conv.max_turns} 轮")
```

<div class="line-notes">

- `def change_system(self, text: str) -> None:` `/system` 的实现。
- `if not text:` 不带内容就是「查看」。
- `print("现在的 system:", self.conv.system["content"])` 实测带内容之后再查,打印「现在的 system: 你是严格的审稿人,只回一个字」。
- `self.conv.system = {"role": "system", "content": text}` 只换 system 这一条,`turns` 没动,所以历史保留。`Conversation.system` 是一条完整的消息字典,不是字符串,所以要写成字典。
- `print("system 已更新,历史保留。` 提示缓存的影响,下面有实测:是「改动处往后」失效,不是整个失效。
- `def save(self, name: str) -> None:` `/save` 的实现。
- `path = save_session(self.conv, name, self.session_dir)` 返回写到哪个文件。名字不合法会抛 `SessionError`,被下面接住。
- `except SessionError as e:` 把异常消息直接打印给用户,然后 `return`,回到输入提示,程序不退出。
- `print(f"已保存 {len(self.conv.turns)} 轮到 {path}")` 实测「已保存 1 轮到 sessions/小林.json」。
- `def load(self, name: str) -> None:` `/load` 的实现。
- `conv = load_session(name, self.session_dir)` 先读到一个临时变量。
- `self.conv = conv` 读成功才换掉当前对话。读失败时 `self.conv` 完好无损,不会出现「读了一半,现在的对话也没了」。和 Day 154 `switch_env` 里先建 `new_client` 再替换是同一个习惯。
- `print(f"已加载,共 {len(conv.turns)} 轮,最多发最近 {conv.max_turns} 轮")` 提示读进来的窗口大小,因为 `/load` 会把 `max_turns` 也换成文件里的。

</div>

**第 5 处**,`handle_command` 里 `elif cmd == "/clear":` 之前加三个分支:

```python
        elif cmd == "/system":
            self.change_system(arg.strip())
        elif cmd == "/save":
            self.save(arg.strip())
        elif cmd == "/load":
            self.load(arg.strip())
```

<div class="line-notes">

- `elif cmd == "/system":` 三个分支,各自把 `arg.strip()` 交给对应方法。`arg` 是 `partition(" ")` 留下的第一个空格后面的全部,所以 `/system 你是 严格的 审稿人` 里的空格都保留。
- `self.save(arg.strip())` 不带名字时 `arg` 是空字符串,`session_path` 会把它换成 `default`。
- `self.load(arg.strip())` 同理。

</div>

(文件开头文档字符串里的「(二)」顺手改成「(三)」,不影响运行。)

改完对比一下,不放心就用 `diff` 看有没有漏:

```bash
diff part02/chatbot_day154.py part02/chatbot.py | head -20
```

`diff` 输出里 `>` 开头的行是新文件多出来的。最后跑一遍全部命令:

```bash
printf '我叫小林,买的是年付套餐\n/save 小林\n/clear\n我叫什么?\n/load 小林\n我叫什么?\n/save ../escape\n/load nope\n/system 你是严格的审稿人,只回一个字\n/system\n/save 审稿\n/quit\n' | uv run python -m part02.chatbot
```

我的输出:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:助手:小林您好,请问有什么可以帮您?
  [deepseek-flash | 首字 0.81s | 输入 32(缓存 0) | 输出 9 | ¥0.00014 | 累计 ¥0.0001]

你:已保存 1 轮到 sessions/小林.json

你:历史已清空

你:助手:你好,我这边看不到你的个人信息,所以不知道你叫什么。你可以告诉我你的名字,方便我称呼你。
  [deepseek-flash | 首字 0.32s | 输入 27(缓存 0) | 输出 23 | ¥0.00024 | 累计 ¥0.0004]

你:已加载,共 1 轮,最多发最近 10 轮

你:助手:您叫小林。
  [deepseek-flash | 首字 0.51s | 输入 48(缓存 0) | 输出 4 | ¥0.00013 | 累计 ¥0.0005]

你:会话名只能用字母、数字、汉字、下划线和短横线,最长 40 个字符:'../escape'

你:没有这个会话:sessions/nope.json

你:system 已更新,历史保留。system 在最前面,改动处往后的缓存会失效,改得越靠前下一轮越贵

你:现在的 system: 你是严格的审稿人,只回一个字

你:已保存 2 轮到 sessions/审稿.json

你:
再见。本次运行累计约 ¥0.0005
```

一步步看:存了「小林」,`/clear` 清空,问「我叫什么」它不知道(输入 27,历史已空);`/load 小林` 之后同一个问题,输入变成 48,它回答「您叫小林」。`/save ../escape` 被白名单拒绝,`/load nope` 报没有。最后 `/save 审稿` 存了 2 轮,因为 `/load` 之后又问了一轮。

看一眼存下来的文件:

```bash
cat sessions/小林.json
```

输出:

```text
{
  "system": "你是云簿 CloudLedger 的客服助手。回答简短,不确定就说不确定。",
  "max_turns": 10,
  "turns": [
    [
      {
        "role": "user",
        "content": "我叫小林,买的是年付套餐"
      },
      {
        "role": "assistant",
        "content": "小林你好!请问有什么可以帮你的?"
      }
    ]
  ]
}
```

中文直接可读,可以用编辑器手改。

### `/system` 对缓存的影响

`/system` 的提示里我写了缓存会失效。实际是怎么回事,量一下。用 Day 154 练习 3 的 `CacheBot`(带约 2000 token 的长 system),新建 `part02/system_cache.py`:

```python
# agent-zero-lab/part02/system_cache.py
from part02.ex154_cache import CacheBot

bot = CacheBot(None)
bot.ask("你好,一个字回答")
bot.ask("再问一次,一个字回答")
print("--- 在 system 末尾加一句话")
bot.change_system(bot.conv.system["content"] + "\n另外,回答不超过一个字。")
bot.ask("第三次,一个字回答")
print("--- 在 system 开头加一句话")
bot.change_system("先说结论。\n" + bot.conv.system["content"])
bot.ask("第四次,一个字回答")
bot.ask("第五次,一个字回答")
```

<div class="line-notes">

- `from part02.ex154_cache import CacheBot` Day 154 练习 3 建的文件,那个子类把 system 换成了长文字。
- `bot = CacheBot(None)` 默认 `.env`,DeepSeek。
- `bot.ask("你好,一个字回答")` 直接调用 `ask()`,不经过 `input`。流式回答和成本行照常打印。
- `bot.change_system(bot.conv.system["content"] + "\n另外,回答不超过一个字。")` 取出现在的 system 文字,在**末尾**加一句,再设回去。
- `bot.change_system("先说结论。\n" + bot.conv.system["content"])` 这次在**开头**加一句。

</div>

```bash
uv run python -m part02.system_cache
```

输出:

```text
助手:好
  [deepseek-flash | 首字 0.62s | 输入 2068(缓存 1920) | 输出 1 | ¥0.00038 | 累计 ¥0.0004]
助手:好
  [deepseek-flash | 首字 0.67s | 输入 2079(缓存 1920) | 输出 1 | ¥0.00040 | 累计 ¥0.0008]
--- 在 system 末尾加一句话
system 已更新,历史保留。system 在最前面,改动处往后的缓存会失效,改得越靠前下一轮越贵
助手:好
  [deepseek-flash | 首字 0.57s | 输入 2094(缓存 1920) | 输出 1 | ¥0.00043 | 累计 ¥0.0012]
--- 在 system 开头加一句话
system 已更新,历史保留。system 在最前面,改动处往后的缓存会失效,改得越靠前下一轮越贵
助手:好
  [deepseek-flash | 首字 0.39s | 输入 2106(缓存 0) | 输出 1 | ¥0.00422 | 累计 ¥0.0054]
助手:好
  [deepseek-flash | 首字 0.43s | 输入 2116(缓存 1920) | 输出 1 | ¥0.00048 | 累计 ¥0.0059]
```

第一轮就命中 1920,是因为 Day 154 练习 3 刚跑过同样的前缀,缓存还热着。**末尾**加一句话,缓存数还是 1920:前面 1920 个 token 没变,前缀照样对得上。**开头**加一句话,缓存数掉到 0,这一轮 ¥0.00422,是上一轮 ¥0.00043 的 10 倍。下一轮(第五次)新的前缀已经被缓存,又回到 1920。所以我最初在提示里写的「前缀缓存会整个失效」不准确,准确的说法是**从改动处往后失效**。改 system 的习惯:要变的内容放最后,不变的放最前,以后写长提示词([Day 144](/blog/agent-zero/day-144-prompt-6/) 的模板化)按这个顺序排。

### 零件和大代码的对照

| 零件 | 在哪里 | 首次出现 |
| --- | --- | --- |
| `to_dict` / `from_dict` | `common/llm.py` 的 `Conversation` | 今天第二步 |
| `json.dumps(..., ensure_ascii=False, indent=2)` | `save_session()` | 今天第一步 |
| 文件名白名单 `NAME_RE` | `session_path()` | 今天第三步 |
| 先读到临时变量再替换 | `ChatBot.load()` | 今天第五步 |
| pydantic 校验文件形状 | `SessionFile`、`load_session()` | 今天第四步 |
| 自定义异常给用户看 | `SessionError` | 今天第三步 |
| 改 system 只换那一条消息 | `change_system()` | 今天第五步 |

### 别把会话文件提交到 git

会话文件里是你和模型的全部对话,可能有客户名字、内部信息,甚至被你贴进去的 key。和 `.env` 一样别进仓库。在 `agent-zero-lab/.gitignore` 里加一行:

```text
sessions/
```

用 `git check-ignore` 确认([Day 53](/blog/agent-zero/day-053-env-secrets/) 用过它)。加之前:

```bash
git check-ignore -v sessions/小林.json || echo "没被忽略"
```

输出:

```text
没被忽略
```

加了 `sessions/` 以后:

```bash
git check-ignore -v sessions/小林.json
```

输出:

```text
.gitignore:6:sessions/	"sessions/\345\260\217\346\236\227.json"
```

意思是「被 `.gitignore` 第 6 行的 `sessions/` 规则忽略」。后面那串 `\345\260\217...` 是 git 把中文文件名转成了八进制转义,只是显示方式,不影响功能;想显示成汉字,运行 `git config core.quotepath false`。

## 给存取写测试

存取文件的代码最适合写测试:不联网、不花钱、`tmp_path` 保证不碰真实的 `sessions/`。新建 `tests/test_sessions.py`:

```python
# agent-zero-lab/tests/test_sessions.py
import json
from pathlib import Path

import pytest

from common.llm import Conversation
from part02.chatbot import ChatBot
from part02.sessions import SessionError, load_session, save_session, session_path

FAKE_ENV = """LLM_BASE_URL=https://example.invalid/v1
LLM_API_KEY=sk-fake
LLM_MODEL=fake-model
LLM_PRICE=0.04,2,8
"""


def make_conv() -> Conversation:
    conv = Conversation("SYS", max_turns=3)
    conv.add_user("你好")
    conv.add_assistant({"role": "assistant", "content": "你好!", "reasoning_content": "打招呼"})
    return conv


def test_roundtrip_keeps_everything(tmp_path: Path) -> None:
    conv = make_conv()
    path = save_session(conv, "s1", tmp_path)
    assert path == tmp_path / "s1.json"
    back = load_session("s1", tmp_path)
    assert back.messages() == conv.messages()
    assert back.max_turns == 3
    assert back.turns[0][1]["reasoning_content"] == "打招呼"


def test_file_is_readable_chinese(tmp_path: Path) -> None:
    _ = save_session(make_conv(), "s1", tmp_path)
    text = (tmp_path / "s1.json").read_text(encoding="utf-8")
    assert "你好!" in text
    assert "\\u" not in text


def test_save_creates_missing_directory(tmp_path: Path) -> None:
    base = tmp_path / "a" / "b"
    _ = save_session(make_conv(), "", base)
    assert (base / "default.json").is_file()


@pytest.mark.parametrize("name", ["../escape", "a/b", "/etc/hosts", "a.b", "x" * 41, "a b"])
def test_bad_names_rejected(name: str, tmp_path: Path) -> None:
    with pytest.raises(SessionError):
        _ = session_path(name, tmp_path)


@pytest.mark.parametrize("name", ["s1", "会话-1", "_last", "x" * 40])
def test_good_names_accepted(name: str, tmp_path: Path) -> None:
    assert session_path(name, tmp_path) == tmp_path / f"{name}.json"


def test_old_file_without_max_turns(tmp_path: Path) -> None:
    data = {"system": "SYS", "turns": [[{"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}]]}
    (tmp_path / "old.json").write_text(json.dumps(data), encoding="utf-8")
    assert load_session("old", tmp_path).max_turns == 20


@pytest.mark.parametrize(
    ("text", "expect"),
    [
        ('{"system": "S", "turns": [', "不是合法的 JSON"),
        ('{"turns": []}', "system"),
        ('{"system": "S", "turns": [[{"role": "assistant", "content": "x"}]]}', "必须以 user 消息开头"),
    ],
)
def test_bad_files_give_friendly_errors(text: str, expect: str, tmp_path: Path) -> None:
    (tmp_path / "bad.json").write_text(text, encoding="utf-8")
    with pytest.raises(SessionError, match=expect):
        _ = load_session("bad", tmp_path)


def test_missing_file(tmp_path: Path) -> None:
    with pytest.raises(SessionError, match="没有这个会话"):
        _ = load_session("nope", tmp_path)


def test_bot_save_and_load_commands(tmp_path: Path) -> None:
    env = tmp_path / ".env.fake"
    env.write_text(FAKE_ENV, encoding="utf-8")
    bot = ChatBot(str(env))
    bot.session_dir = tmp_path / "sessions"
    bot.conv.add_user("你好")
    bot.conv.add_assistant({"role": "assistant", "content": "你好!"})
    assert bot.handle_command("/save t1")
    bot.conv.turns.clear()
    assert bot.handle_command("/load t1")
    assert len(bot.conv.turns) == 1
    assert bot.handle_command("/load ../x")  # 被拒绝,但程序继续
    assert len(bot.conv.turns) == 1
```

<div class="line-notes">

- `FAKE_ENV = """LLM_BASE_URL=https://example.invalid/v1` 和 Day 154 测试里一样的假配置,用来建 `ChatBot`,不发请求。
- `def make_conv() -> Conversation:` 造一个现成的对话:system 是 `SYS`,窗口 3 轮,一轮问答,assistant 那条故意带上 `reasoning_content`,确认额外字段也能存取。
- `def test_roundtrip_keeps_everything(tmp_path: Path) -> None:` 存、读、比较。`tmp_path` 是 pytest 给每个测试的空临时目录。
- `path = save_session(conv, "s1", tmp_path)` 第三个参数传临时目录,覆盖默认的 `sessions/`。
- `assert back.messages() == conv.messages()` 来回一趟,发给模型的消息不变。
- `assert back.turns[0][1]["reasoning_content"] == "打招呼"` `[0]` 第一轮,`[1]` 这一轮的第二条消息(assistant)。额外字段没丢。
- `_ = save_session(make_conv(), "s1", tmp_path)` 返回值这里不关心。赋给 `_` 是 Python 里「我知道有返回值但不用」的写法,类型检查器也就不抱怨了。
- `assert "\\u" not in text` 文件里不应该有 `\u` 转义,中文是原样的。
- `base = tmp_path / "a" / "b"` 一个还不存在的两层目录,测 `mkdir(parents=True)`。
- `_ = save_session(make_conv(), "", base)` 名字传空字符串,应该落到 `default.json`。
- `@pytest.mark.parametrize("name", ["../escape", "a/b", "/etc/hosts", "a.b", "x" * 41, "a b"])` 参数化:同一个测试函数用六个不同的名字各跑一次,报告里显示成六条。六个都该被拒绝:两个路径穿越、一个带点、一个超长、一个带空格。
- `with pytest.raises(SessionError):` 断言里面那行必须抛 `SessionError`。
- `@pytest.mark.parametrize("name", ["s1", "会话-1", "_last", "x" * 40])` 四个好名字,包括汉字、下划线开头、刚好 40 个字符的边界。
- `def test_old_file_without_max_turns(tmp_path: Path) -> None:` 手写一个没有 `max_turns` 的老格式文件,读回来应该是默认的 20。
- `@pytest.mark.parametrize(` 第二个参数化,一次传两个值 `("text", "expect")`:坏文件的内容,和期望错误消息里出现的片段。三种坏法:JSON 写了一半、缺 `system`、第一条是 assistant。
- `with pytest.raises(SessionError, match=expect):` `match` 是正则,检查异常消息里包含期望片段。这样不光知道抛了异常,还知道是**对的那个**异常。
- `def test_missing_file(tmp_path: Path) -> None:` 读不存在的会话,消息里有「没有这个会话」。
- `bot.session_dir = tmp_path / "sessions"` 前面「第 3 处」那个属性在这里派上用场。
- `assert bot.handle_command("/save t1")` `handle_command` 返回 `True` 表示继续运行。
- `assert bot.handle_command("/load ../x")  # 被拒绝,但程序继续` 非法名字被拒绝,返回值仍是 `True`,历史也没变(下一行断言)。

</div>

```bash
uv run pytest -q tests/test_sessions.py
```

输出:

```text
...................                                                      [100%]
19 passed in 3.18s
```

19 个里,两个 `parametrize` 展开成 6 + 4 + 3 个,所以数字比函数个数多。

## 第二部分回头看

聊天机器人做完了,第二部分也到头了。从 Day 106 到今天 50 天,真正在讲的只有一个问题:**怎么把一个大模型当作一个可靠的零件接进程序里**。下面这张图把它们分成六块:

<figure>
<svg viewBox="0 0 640 340" role="img" aria-label="第二部分知识地图:模型直觉、API 调用、对话与流式、提示词、结构化输出五块,汇到底部的聊天机器人和 common 模块">
<rect x="0" y="0" width="640" height="340" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="20" width="190" height="84" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="42" fill="var(--ink)">模型直觉 106–119</text>
<text x="30" y="62" fill="var(--ink-soft)" font-size="11">token、窗口、采样</text>
<text x="30" y="80" fill="var(--ink-soft)" font-size="11">训练、幻觉、推理、MoE</text>
<rect x="225" y="20" width="190" height="84" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="235" y="42" fill="var(--ink)">API 调用 120–128</text>
<text x="235" y="62" fill="var(--ink-soft)" font-size="11">请求响应、兼容协议</text>
<text x="235" y="80" fill="var(--ink-soft)" font-size="11">算钱、错误码、重试、限速</text>
<rect x="430" y="20" width="190" height="84" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="440" y="42" fill="var(--ink)">对话与流式 129–137</text>
<text x="440" y="62" fill="var(--ink-soft)" font-size="11">messages、system</text>
<text x="440" y="80" fill="var(--ink-soft)" font-size="11">平方级成本、SSE、LLMClient</text>
<rect x="20" y="124" width="190" height="84" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="146" fill="var(--ink)">提示词 138–146</text>
<text x="30" y="166" fill="var(--ink-soft)" font-size="11">背景、示例、先想再答</text>
<text x="30" y="184" fill="var(--ink-soft)" font-size="11">标签、模板化、量化比较</text>
<rect x="225" y="124" width="190" height="84" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="235" y="146" fill="var(--ink)">结构化输出 147–153</text>
<text x="235" y="166" fill="var(--ink-soft)" font-size="11">三个层次、pydantic</text>
<text x="235" y="184" fill="var(--ink-soft)" font-size="11">重试、字段顺序、原文核对</text>
<rect x="430" y="124" width="190" height="84" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="440" y="146" fill="var(--ink)">小项目 152–155</text>
<text x="440" y="166" fill="var(--ink-soft)" font-size="11">多轮、流式、成本</text>
<text x="440" y="184" fill="var(--ink-soft)" font-size="11">切厂商、存取会话</text>
<line x1="115" y1="104" x2="160" y2="250" stroke="var(--ink-faint)"/>
<line x1="320" y1="104" x2="320" y2="250" stroke="var(--ink-faint)"/>
<line x1="525" y1="104" x2="480" y2="250" stroke="var(--ink-faint)"/>
<line x1="115" y1="208" x2="160" y2="250" stroke="var(--ink-faint)"/>
<line x1="320" y1="208" x2="320" y2="250" stroke="var(--ink-faint)"/>
<rect x="100" y="250" width="440" height="60" rx="4" fill="var(--compute)" stroke="var(--compute)"/>
<text x="320" y="276" text-anchor="middle" fill="var(--paper-raised)">common/llm.py · cost.py · structured.py</text>
<text x="320" y="296" text-anchor="middle" fill="var(--paper-raised)" font-size="11">第三部分起每一天都 import 它们</text>
</g>
</svg>
<figcaption>第二部分最后沉淀成三个共享文件和一个能用的聊天机器人。第三部分让模型第一次「做事」,要用到的调用、错误处理、成本、结构化输出,全在这里了。</figcaption>
</figure>

把这张图用几句话串一遍,试着自己说出来,说不顺的地方就是没学扎实的地方。

模型是一个「猜下一个 token」的函数([Day 106](/blog/agent-zero/day-106-next-token/)),它看到的不是字而是 token([Day 107](/blog/agent-zero/day-107-tokens-1/)),能看到的全部内容就是上下文窗口([Day 109](/blog/agent-zero/day-109-context-window/)),输出是按概率抽样出来的([Day 110](/blog/agent-zero/day-110-sampling-1/)),所以会有随机性,也会有幻觉([Day 114](/blog/agent-zero/day-114-hallucination/))。调用它是一个 HTTP 请求([Day 121](/blog/agent-zero/day-121-api-request/)),大多数厂商都兼容 OpenAI 的格式([Day 123](/blog/agent-zero/day-123-openai-compatible/)),按 token 计费,缓存命中的前缀便宜几十倍([Day 124](/blog/agent-zero/day-124-cost/))。出错要分清是谁的问题([Day 126](/blog/agent-zero/day-126-error-codes/)),该重试的重试([Day 127](/blog/agent-zero/day-127-retry-backoff/))。它没有记忆,你发过去的 messages 就是记忆([Day 129](/blog/agent-zero/day-129-messages/)),所以越聊越贵([Day 131](/blog/agent-zero/day-131-conversation-cost/)),流式输出降低首字延迟([Day 133](/blog/agent-zero/day-133-sse-principle/))。提示词是写给一个聪明的新同事看的说明([Day 138](/blog/agent-zero/day-138-prompt-1/)),要给背景、示例,让它先想再答,并且每次改动都用数字量一下([Day 145](/blog/agent-zero/day-145-prompt-lab/))。程序要用模型的输出时,用 schema 约束它,用 pydantic 校验它,失败了把错误喂回去重试([Day 147](/blog/agent-zero/day-147-structured-1/)–[Day 151](/blog/agent-zero/day-151-structured-5/))。最后四天把它们拼成一个能用的聊天机器人。

这五十天里,不少地方的数字都不是「模型有多聪明」,而是工程上的:一次调用 ¥0.0004,缓存命中让一轮从 ¥0.00414 降到 ¥0.00040,被打断的调用算 ¥0.001,存文件的名字要不要白名单。后面三个部分的 Agent,出问题的地方大半也在这类细节上。

## 面试题汇总

下面是第二部分内容在面试里的常见问法。不用背答案,用自己的话讲清楚,最好能举出自己代码里的例子。每道题后面标了对应的天,答不顺的回去重看。

- 大模型为什么会产生幻觉?工程上怎么缓解?([Day 114](/blog/agent-zero/day-114-hallucination/)、[Day 130](/blog/agent-zero/day-130-system-prompt/))
- token 是什么,为什么中文比英文费 token?([Day 107](/blog/agent-zero/day-107-tokens-1/)、[Day 108](/blog/agent-zero/day-108-tokens-2/)、今天的 `token_ratio` 实测见 [Day 154](/blog/agent-zero/day-154-chatbot-2/))
- 上下文窗口已经很大了,为什么还需要 RAG?([Day 109](/blog/agent-zero/day-109-context-window/))
- temperature 设成 0,输出就一定确定吗?([Day 110](/blog/agent-zero/day-110-sampling-1/)、[Day 112](/blog/agent-zero/day-112-sampling-2/))
- 推理模型和普通模型怎么选?思考的 token 怎么收费?([Day 115](/blog/agent-zero/day-115-reasoning-models/)、[Day 154](/blog/agent-zero/day-154-chatbot-2/) 练习 1)
- 你的系统要接多家模型厂商,怎么设计?([Day 123](/blog/agent-zero/day-123-openai-compatible/)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)、[Day 154](/blog/agent-zero/day-154-chatbot-2/))
- 哪些 API 错误应该重试,哪些不应该?重试怎么做?([Day 126](/blog/agent-zero/day-126-error-codes/)、[Day 127](/blog/agent-zero/day-127-retry-backoff/))
- 多轮对话越来越慢、越来越贵,怎么优化?([Day 129](/blog/agent-zero/day-129-messages/)、[Day 131](/blog/agent-zero/day-131-conversation-cost/))
- 流式输出是怎么实现的?首字延迟受哪些因素影响?([Day 133](/blog/agent-zero/day-133-sse-principle/)、[Day 134](/blog/agent-zero/day-134-streaming-code/))
- 怎么判断一个问题是提示词能解决的,还是需要别的手段?团队里多人改提示词,怎么管理?([Day 138](/blog/agent-zero/day-138-prompt-1/)–[Day 145](/blog/agent-zero/day-145-prompt-lab/))
- JSON mode 和 JSON Schema 约束有什么区别?([Day 147](/blog/agent-zero/day-147-structured-1/)、[Day 148](/blog/agent-zero/day-148-structured-2/))
- 怎么保证模型抽取的关键字段(金额、编号)是对的?([Day 150](/blog/agent-zero/day-150-structured-4/)、[Day 151](/blog/agent-zero/day-151-structured-5/))
- 流式请求被用户中断,费用怎么记?([Day 152](/blog/agent-zero/day-152-chatbot-1/)、[Day 154](/blog/agent-zero/day-154-chatbot-2/))
- 聊天服务要保存会话,文件名和文件内容为什么都不能直接信?(今天)

最后三题我在文末自测里给了完整答案,可以对照着写自己的版本。

## 动手练习

三道题加起来调 DeepSeek 约 4 次,不到 ¥0.01。

**练习 1:加 `/sessions` 命令。** 列出 `sessions/` 里所有会话:名字、最后修改时间、轮数、第一句话的前 16 个字。最近改过的排在前面;文件坏了不能让命令崩,显示「读不出来」。用子类写,不改 `chatbot.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex155_list.py
import json
import time

from part02.chatbot import ChatBot


class ListBot(ChatBot):
    """加 /sessions:列出 sessions/ 里所有会话,最近改过的在前。"""

    def handle_command(self, line: str) -> bool:
        if line.strip() != "/sessions":
            return super().handle_command(line)
        files = sorted(self.session_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        if not files:
            print("还没有保存过会话")
            return True
        for path in files:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                first = data["turns"][0][0]["content"] if data["turns"] else "(空)"
                info = f"{len(data['turns'])} 轮 | 第一句:{first[:16]}"
            except (json.JSONDecodeError, KeyError, IndexError):
                info = "(读不出来,文件可能坏了)"
            when = time.strftime("%m-%d %H:%M", time.localtime(path.stat().st_mtime))
            print(f"  {path.stem:12} {when} | {info}")
        return True


if __name__ == "__main__":
    ListBot(None).run()
```

<div class="line-notes">

- `import time` 标准库,下面用它把时间戳变成好看的字符串。
- `if line.strip() != "/sessions":` 不是自己的命令就交给父类。
- `files = sorted(self.session_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)` `glob("*.json")` 找出目录里所有 `.json` 文件。`sorted` 的 `key` 指定按什么排:`p.stat().st_mtime` 是文件最后修改时间(一个浮点数的秒数);`lambda p: ...` 是一个没有名字的小函数,冒号前是参数,冒号后是返回值;`reverse=True` 从大到小,也就是最近的在前。
- `if not files:` 空列表是假值。
- `data = json.loads(path.read_text(encoding="utf-8"))` 这里直接读,不走 `load_session`,因为只想看一眼概要,不需要校验形状。
- `first = data["turns"][0][0]["content"] if data["turns"] else "(空)"` `turns[0]` 是第一轮,`[0]` 是那一轮的第一条消息(user),取它的文字;没有轮时显示「(空)」。
- `info = f"{len(data['turns'])} 轮 | 第一句:{first[:16]}"` `first[:16]` 切片取前 16 个字。
- `except (json.JSONDecodeError, KeyError, IndexError):` 三种坏法:不是 JSON、缺 key、列表是空的取下标。接住后显示「读不出来」,一个坏文件不能让整个列表命令崩。
- `when = time.strftime("%m-%d %H:%M", time.localtime(path.stat().st_mtime))` `localtime` 把秒数变成本地时间,`strftime` 按格式写成字符串:月-日 时:分。
- `print(f"  {path.stem:12} {when} | {info}")` `path.stem` 是不带后缀的文件名(`小林.json` 得到 `小林`),`:12` 占 12 位宽。

</div>

```bash
printf '/sessions\n/quit\n' | uv run python -m part02.ex155_list
```

我的输出(目录里有三个文件:`_last`、`a` 是空会话、`think1` 是练习 3 存的):

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:  _last        10-23 08:09 | 2 轮 | 第一句:我叫小林
  a            10-23 08:09 | 0 轮 | 第一句:(空)
  think1       10-23 08:09 | 1 轮 | 第一句:一份年付 468 元的套餐,含 

你:
再见。本次运行累计约 ¥0.0000
```

几个文件时间相同是因为我是连续几分钟内建的。`_last` 来自练习 2。

</details>

**练习 2:退出时自动保存,`--resume` 接着聊。** 用子类覆盖 `run()`,不管怎么退出(`/quit`、Ctrl+D、甚至程序出异常)都把对话存成 `_last`;启动时加 `--resume` 就读回来。提示:`try ... finally`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex155_autosave.py
import argparse

from part02.chatbot import ChatBot
from part02.sessions import SessionError, load_session

LAST = "_last"


class AutoSaveBot(ChatBot):
    """退出时自动存成 _last,下次加 --resume 接着聊。"""

    def run(self) -> None:
        try:
            super().run()
        finally:
            if self.conv.turns:
                self.save(LAST)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", action="store_true", help="接着上次退出时的对话聊")
    args = parser.parse_args()
    bot = AutoSaveBot(None)
    if args.resume:
        try:
            bot.conv = load_session(LAST, bot.session_dir)
            print(f"接着上次聊,已有 {len(bot.conv.turns)} 轮")
        except SessionError as e:
            print(e)
    bot.run()


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `LAST = "_last"` 自动保存的会话名。下划线开头在我们的白名单里是合法字符,而且 `_` 排在字母前面,在文件列表里容易认出来是系统存的。
- `class AutoSaveBot(ChatBot):` 覆盖 `run()`。
- `super().run()` 调用父类原来的主循环。
- `finally:` 不管上面是正常退出还是抛了异常,都会执行这一块。[Day 36](/blog/agent-zero/day-036-exceptions-2/) 讲过。
- `if self.conv.turns:` 一轮都没聊就不保存,免得空会话把上一次有用的 `_last` 盖掉。
- `self.save(LAST)` 复用父类的 `save()`,它会打印「已保存 N 轮到 ...」。
- `parser.add_argument("--resume", action="store_true", help="接着上次退出时的对话聊")` `store_true` 表示这是个开关,不带值:写了 `--resume` 就是 `True`,不写是 `False`。
- `args = parser.parse_args()` 这次要用的不止一个参数,所以保存整个结果对象。
- `bot = AutoSaveBot(None)` 默认 `.env`。
- `bot.conv = load_session(LAST, bot.session_dir)` 读回来直接换掉对话。没有 `_last` 文件时抛 `SessionError`,被接住打印,然后照常开始一个新对话。

</div>

```bash
printf '我叫小林\n/quit\n' | uv run python -m part02.ex155_autosave
printf '我叫什么?\n/quit\n' | uv run python -m part02.ex155_autosave --resume
```

我的输出:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:助手:你好,小林!我是云簿 CloudLedger 的客服助手,有什么可以帮你的吗?
  [deepseek-flash | 首字 0.41s | 输入 26(缓存 0) | 输出 21 | ¥0.00022 | 累计 ¥0.0002]

你:
再见。本次运行累计约 ¥0.0002
已保存 1 轮到 sessions/_last.json
接着上次聊,已有 1 轮
已连接 deepseek-flash。输入 /help 查看命令。

你:助手:你叫小林。
  [deepseek-flash | 首字 0.50s | 输入 54(缓存 0) | 输出 4 | ¥0.00014 | 累计 ¥0.0001]

你:
再见。本次运行累计约 ¥0.0001
已保存 2 轮到 sessions/_last.json
```

第二次运行接着上次聊,模型答出了「你叫小林」,退出时又存成了 2 轮。

</details>

**练习 3:存一个开着思考模式的会话,看文件里多了什么。** 用 Day 154 练习 1 的 `ThinkBot`:`/think on`,问一道算术题,`/save think1`,打开文件看 assistant 那条消息有哪些 key;然后 `/clear`、`/load think1`,再问一个追问,确认读回来的历史能正常用。

<details><summary>参考答案</summary>

```bash
printf '/think on\n一份年付 468 元的套餐,含 13%% 税,不含税价是多少?只给数字\n/save think1\n/clear\n/load think1\n税额是多少?只给数字\n/quit\n' | uv run python -m part02.ex154_think
```

我的输出:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:思考模式 on(只对现在这个厂商生效,/env 切走再切回来会重置)

你:助手:414.16
  [deepseek-flash | 首字 1.40s | 输入 73(缓存 0) | 输出 126 | ¥0.00115 | 累计 ¥0.0012]

你:已保存 1 轮到 sessions/think1.json

你:历史已清空

你:已加载,共 1 轮,最多发最近 10 轮

你:助手:53.84
  [deepseek-flash | 首字 0.90s | 输入 86(缓存 0) | 输出 91 | ¥0.00090 | 累计 ¥0.0021]

你:
再见。本次运行累计约 ¥0.0021
```

看文件里 assistant 那条消息的 key:

```bash
uv run python -c "
import json
d = json.load(open('sessions/think1.json'))
m = d['turns'][0][1]
print(list(m.keys()))
print(repr(m['reasoning_content'][:80]), len(m['reasoning_content']))
"
```

输出:

```text
['role', 'content', 'reasoning_content']
'We need answer Chinese. Need compute tax inclusive price 468 includes 13% tax, t' 364
```

多了 `reasoning_content`,364 个字符的思考过程,而且是英文的。三点。第一,`SessionFile` 里 `Message` 用了 `extra="allow"`,所以带这个额外字段的文件能通过校验,`/load` 没问题。第二,读回来后追问「税额是多少」,模型接着答对了(53.84),说明带着 `reasoning_content` 的历史发回给 DeepSeek 没被拒绝(这是 DeepSeek 官方接口 2026 年 10 月实测,别的厂商不保证)。第三,这个追问的输入只有 86 个 token。历史只有「问题 + 答案 414.16」加上新问题,和 system,加起来本来就差不多这个数;如果 364 个字符的英文思考内容也被算进输入,会多出近一百个 token。所以至少在这次实测里,DeepSeek 没有把历史里的 `reasoning_content` 算进输入。这只是这一次、这一家的观察,换厂商或者换模型不保证,想确认可以自己多聊几轮,对照输入 token 的增长。

</details>

**验收标准:** 能默写 `to_dict`/`from_dict`;能解释 `session_path` 为什么用白名单而不是「过滤掉 `..`」,并说出 `fullmatch` 和 `match` 的区别;能说出 `load()` 为什么先读到临时变量再替换 `self.conv`;能复现「文件名带 `../` 写出了 `sessions/` 之外」;19 个测试全过(`uv run pytest -q tests/test_sessions.py`);能不看文章讲第二部分的六块和每块的一句话。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 序列化 / 反序列化 | 把内存里的对象变成能存盘、能传输的文字(JSON),以及反过来变回对象。`json.dumps` / `json.loads` 做字符串这一层,`to_dict` / `from_dict` 做对象这一层 |
| roundtrip(来回)测试 | 转过去再转回来,结果要和原来一样。序列化代码都该有一个 |
| `@classmethod` | 属于类而不是实例的方法,第一个参数是类本身 `cls`。`Conversation.from_dict(data)` 不用先有对象 |
| `ensure_ascii` | `json.dumps` 的参数,默认 `True` 会把汉字写成 `你`;设成 `False` 原样保留 |
| 路径穿越 | 用 `../` 或绝对路径让程序读写本来不该碰的位置的攻击方式 |
| 白名单 | 只允许明确列出的安全内容,其余一律拒绝。和「黑名单」(只拦已知危险的)相对,更不容易漏 |
| `fullmatch` | 正则的匹配方式,要求整个字符串都符合规则,而 `match` 只要求开头符合 |
| `Literal` | 类型标注,表示取值只能是列出的几个字面值之一,如 `Literal["user", "assistant"]` |
| `extra="allow"` | pydantic 的配置,允许模型里没声明的字段存在并原样保留 |
| `field_validator` | pydantic 的装饰器,给某个字段加自定义的检查函数 |
| 前缀缓存 | 厂商按请求开头相同的部分缓存计算结果;改动靠前的内容会让后面的缓存都对不上 |

## 常见误区

**用 `json.dumps` 存中文,文件里全是 `你`。** 默认 `ensure_ascii=True`。加 `ensure_ascii=False`,并且读写文件时都写 `encoding="utf-8"`。

**文件名直接拼 `f"{name}.json"`。** `../x` 能跳出目录,`/etc/hosts` 这种绝对路径会让前面的目录整个被丢掉(`pathlib` 的拼接规则)。只放行白名单里的字符,并用 `fullmatch`。

**只过滤掉 `..` 就当安全了。** 绝对路径、符号链接、编码绕过,还有更多手法。让人不用去想「还有哪些危险」的办法是只允许安全的。

**读回来的文件直接 `Conversation.from_dict`。** 文件可能被手改过。形状不对的历史会让下一次提问才出错,离出错的地方已经很远。读的时候当场校验。

**先替换当前对话再读文件。** 读到一半出错,当前对话也丢了。先读到临时变量,成功了才换。

**以为改 system 会让缓存整个失效。** 只从改动处往后失效。末尾加一句话缓存不变(实测 1920 仍命中),开头加一句话缓存掉到 0、那一轮贵 10 倍。

**把会话文件提交进 git。** 里面是完整对话,可能有隐私和密钥。`.gitignore` 加 `sessions/`。

**校验模型把 `extra` 设成 `forbid`。** assistant 消息会带 `reasoning_content`,以后还有 `tool_calls`,一律拒绝会让开着思考的会话存得进去读不回来。

## 学习资料

### 文档与文章

- [Python 文档:json](https://docs.python.org/zh-cn/3.12/library/json.html):中文,看 `dumps` 的 `ensure_ascii` 和 `indent`,以及 `JSONDecodeError`。
- [Python 文档:pathlib](https://docs.python.org/zh-cn/3.12/library/pathlib.html):中文,「基本使用」里写了拼接绝对路径会丢掉左边,第三步那个现象的出处。
- [Python 文档:re](https://docs.python.org/zh-cn/3.12/library/re.html):中文,`fullmatch` 和 `match` 的区别在「正则表达式对象」一节。
- [pydantic 文档:Validators](https://docs.pydantic.dev/latest/concepts/validators/):英文,`field_validator` 的写法。
- [pydantic 文档:Models](https://docs.pydantic.dev/latest/concepts/models/):英文,往下找 `extra` 配置那一节。
- [OWASP:Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal):英文,路径穿越是怎么回事,各种变形写法。
- [git 文档:gitignore](https://git-scm.com/docs/gitignore):英文,模式写法,今天只用到「目录名加斜杠」这一种。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1p2ZWBHEqQ&autoplay=0&high_quality=1" title="【Python 零基础】JSON 的基础使用与文件数据交互" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>水哥澎湃 · 【Python 零基础】JSON 的基础使用与文件数据交互 · 13 分 43 秒。讲 `json.dumps`、`json.loads` 和读写文件,正好是第一步到第二步用到的那一层。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/9N6a-VLBa2I" title="Python Tutorial: Working with JSON Data using the json Module" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Python Tutorial: Working with JSON Data using the json Module · 英文。看 `dump`/`dumps` 和 `load`/`loads` 的区别(带 s 的是字符串,不带的是文件对象),第二步要用。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/YwhOUyTxXVE" title="How to Use Pathlib in Python | Quickstart Guide or Beginners" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>PyCharm 官方频道 · How to Use Pathlib in Python | Quickstart Guide or Beginners · 英文。复习 `Path` 的拼接、`mkdir`、`read_text`,第三步的 `SESSIONS / name` 就是它。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering: Building Applications with Foundation Models》(O'Reilly,2025):英文,有关于评测、提示词、RAG、Agent、推理成本的整体框架。第二部分对应的是它前几章讲的基础模型和提示词,读一遍会发现我们这五十天里的很多取舍在书里有系统的说法。[出版社页面](https://www.oreilly.com/library/view/ai-engineering/9781098166298/)。

### 开源项目与代码

- [pydantic/pydantic](https://github.com/pydantic/pydantic):今天用到的校验库。想看 `ValidationError.errors()` 返回的结构,README 和文档里有示例。

## 自测

1. `json.dumps(conv)` 为什么会报 `TypeError`?`to_dict` 和 `from_dict` 各自做什么?

<details><summary>答案</summary>

`json` 只认字典、列表、字符串、数字、布尔和 `None`,不认自己定义的类的实例。`to_dict` 把对象里要保存的东西(system 的文字、`max_turns`、`turns`)拼成一个普通字典;`from_dict` 是类方法,用字典里的值新建一个 `Conversation`,并把 `turns` 放回去,`max_turns` 缺省 20 是为了兼容没有这个字段的老文件。来回转一趟后 `messages()` 应该和原来一样,这就是 roundtrip 测试。

</details>

2. `/save ../escape` 为什么危险?我们怎么防的?为什么用白名单而不是去掉 `..`?

<details><summary>答案</summary>

`Path("sessions") / "../escape.json"` 等于 `sessions/../escape.json`,文件会写到 `sessions/` 的上一级,换成更多层 `..` 就能逃出整个项目;名字是绝对路径时,`pathlib` 拼接还会把前面的目录整个丢掉。防法是 `session_path()` 用正则 `[\w-]{1,40}` 加 `fullmatch`,只允许字母、数字、汉字、下划线和短横线,最长 40 个字符,后缀由程序自己加。白名单只放行已知安全的,不用去穷举危险写法(`..`、绝对路径、编码绕过、符号链接都有可能),比黑名单不容易漏。

</details>

3. `load()` 里为什么先读到 `conv` 再 `self.conv = conv`?pydantic 校验在这里解决了什么问题?

<details><summary>答案</summary>

读文件可能失败(不存在、JSON 坏了、形状不对)。如果直接给 `self.conv` 赋值再出错,当前对话就丢了;先读到临时变量,成功才替换,失败时 `self.conv` 完好。pydantic 校验在读的时候就发现形状不对的文件(第一条不是 user、角色拼错、缺字段),把它变成一句用户看得懂的话;不校验的话,坏历史会被发给模型,到下一次提问才表现为模型乱答或者 400,离出错的地方很远。

</details>

4. 改 `/system` 以后缓存会怎样?为什么「要变的内容放最后」?

<details><summary>答案</summary>

厂商按请求开头相同的部分命中缓存,从第一处不同的地方往后都对不上。实测在长 system 的末尾加一句话,前面 1920 个 token 的缓存仍命中;在开头加一句话,缓存掉到 0,那一轮从 ¥0.00043 变成 ¥0.00422。所以写长提示词时把不变的规则放最前面,会变的内容(日期、用户信息、当次任务)放最后。

</details>

5. 面试题:「你做的聊天服务要保存用户的对话,有哪些要注意的地方?」

<details><summary>答案</summary>

存什么:system、窗口大小、按轮组织的消息,带上模型返回的原始消息(包括思考内容,以后还有工具调用),这样读回来和当时一样,前缀缓存也有机会命中。怎么存:对象先转成纯数据再序列化,中文不要转义成 `\u`,编码明确指定 utf-8。安全上有两点:文件名或会话 id 如果来自用户输入,要用白名单限制字符和长度,防止路径穿越,更好的做法是用服务端生成的随机 id 而不是用户给的名字;读回来的内容不能直接信,要校验形状(角色只能是几种、问答交替),因为文件可能被改过或者来自旧版本,坏历史会让下一次请求出错或者行为异常。还有隐私:对话里可能有个人信息和密钥,不要进版本库,按需设保留期限和访问控制。工程上加自动保存时要先写临时文件再改名,避免写一半崩溃留下坏文件;读失败要有清楚的报错,别让整个程序崩。

</details>

6. 面试题:「你的聊天机器人要接多家模型厂商,账怎么记、缓存会受什么影响?」

<details><summary>答案</summary>

每个客户端自带账本(次数、输入输出 token、花费),切换厂商时新建客户端并把旧账本收进列表,累计是各本账之和,按厂商分开能看出每家占多少。配置要在新建客户端前检查必填项齐全,不然价格或模型名会沿用上一家的值而不报错。缓存在服务端、按厂商分开:切走再切回来,原来那家的缓存还在(有过期时间),但切到另一家那一轮是全价,价格表也可能更贵(实测同一个模型,硅基流动的未命中价是 DeepSeek 官方的 1.5 倍)。所以请求不要在厂商之间随机分流,会把缓存打碎。

</details>

7. 面试题:「说说你对第二部分(大模型与 API)的整体理解,哪几件事是工程上最容易出问题的?」

<details><summary>答案</summary>

我会按「一次调用」展开:模型是无状态的,历史靠你每次发全,所以成本随轮数涨,需要窗口和缓存意识;输出是抽样的,要工程化就得约束格式、校验内容、失败重试并有上限;网络和服务是不可靠的,要分清哪些错误重试哪些不重试,流式被中断也要保证本地状态一致;钱要按 usage 的命中、未命中、输出分开算,并分清估算和对账。最容易出问题的是不报错的错:配置串味导致价格用错、提示词改动没有量化对比、抽取的字段是编的却通过了格式校验、中断后历史里留着孤零零的 user 消息。这些都要靠检查、测试和度量去防,不能靠「模型应该没问题」。

</details>

## 明天预告

Day 156 · Function calling:模型不会执行,它只写一段 JSON。第二部分做完了,进入第三部分,让模型第一次「做事」。工具调用的第一个误会是以为模型会运行你的函数。明天先把这个误会拆掉:用一个纯聊天的办法让模型提出「我想查天气」,你的程序自己执行,再看官方的 `tools` 参数帮你标准化了哪些事,以及为什么这套做法比自己约定格式靠得住。
