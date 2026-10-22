---
title: 'Day 152 · 小项目(一):命令行聊天机器人,多轮和流式'
description: '把第二部分的零件拼成一个能用的命令行聊天机器人:input 循环、流式打印、用 Conversation 记住前几轮、/help /clear /history /quit 四个命令。顺带修两个手感问题(方向键打出 ^[[D、管道输入不回显),再故意制造 401 和 Ctrl+C,看「出错不回滚」会让被取消的问题在下一轮又冒出来。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'streaming', 'cli', 'agent-zero']
series: 'agent-zero'
day: 152
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 151](/blog/agent-zero/day-151-structured-5/) 收尾了结构化输出:推理字段放在答案前面,正确率从 9/24 到 24/24;可能缺的字段要留 `null` 的出口,不然模型会拿 `''` 和 `0` 填坑;抽出来的编号要能在原文里找到;instructor 做的事和我们手写的 `extract()` 是一回事。

这五天都在跟「一次调用、一个 JSON」打交道。今天换个节奏,做第二部分的小项目。从 Day 120 第一次调 API 到现在,我们攒了不少零件:流式输出、`LLMClient`、`Conversation`、错误码、重试。可它们一直散在各个脚本里,从没拼成一个能连续聊天的东西。今天把它拼起来。

## 今天要解决的问题

学完今天你应该能做到:

1. 写出一个命令行聊天循环:读一行输入,流式打印回答,用 `Conversation` 记住前几轮,支持 `/help`、`/clear`、`/history`、`/quit` 四个命令。
2. 说清这个程序在 401、断网、Ctrl+C 三种情况下怎么保持历史干净,并演示「不回滚」会出什么问题。
3. 知道 `import readline` 解决了什么问题,知道管道喂输入时屏幕上为什么看不到你敲的字。

预计用时:2.5 小时。前置:[Day 134](/blog/agent-zero/day-134-streaming-code/)(读流)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)–[Day 137](/blog/agent-zero/day-137-llm-client-3/)(`common/llm.py` 的 `LLMClient` 和 `Conversation`)、[Day 129](/blog/agent-zero/day-129-messages/)(messages 就是记忆)、[Day 126](/blog/agent-zero/day-126-error-codes/)(错误码)、[Day 42](/blog/agent-zero/day-042-classes-2/)(继承和 `super()`)、[Day 22](/blog/agent-zero/day-022-tuples-unpack/)(解包)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `chatbot.py` 里的 `ask()` 和 `run()`;再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先想清楚要做什么

这个聊天机器人分三天做完,今天只做骨架:

| 哪天 | 做什么 |
| --- | --- |
| 今天 Day 152 | 输入循环、流式输出、多轮历史、`/help` `/clear` `/history` `/quit`、出错不弄乱历史 |
| [Day 154](/blog/agent-zero/day-154-chatbot-2/) | 切换厂商(`/env`)、每轮打印花费和首 token 延迟、`/cost` |
| [Day 155](/blog/agent-zero/day-155-chatbot-3/) | 保存和加载对话、知识地图、面试题 |

为什么做命令行而不是网页?你会前端,网页版当然能做,但网页要处理接口、跨域、前端状态,注意力会被分走。命令行版本两百行以内,所有注意力都在「多轮历史怎么管、流怎么读、出错怎么办」这几件 Agent 工程师真正要想的事上。第七部分做服务化、第八部分做 SupportPilot 时会有网页,到时候今天的 `ChatBot` 逻辑基本能原样搬过去。

先看整个程序跑起来是什么流程:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="聊天机器人主循环:读输入,斜杠开头交给命令处理,否则 ask;ask 里先加 user,流式请求,成功补 assistant,出错删掉这一轮">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<rect x="20" y="20" width="150" height="36" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="34" y="43" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">input("你:")</text>
<line x1="170" y1="38" x2="210" y2="38" stroke="var(--ink-faint)"/>
<rect x="210" y="20" width="150" height="36" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="222" y="43" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">以 / 开头?</text>
<line x1="360" y1="38" x2="400" y2="38" stroke="var(--ink-faint)"/>
<text x="366" y="32" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">是</text>
<rect x="400" y="20" width="220" height="36" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="412" y="43" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">handle_command → /quit 退出</text>
<line x1="285" y1="56" x2="285" y2="90" stroke="var(--ink-faint)"/>
<text x="292" y="78" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">否</text>
<rect x="210" y="90" width="150" height="36" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="222" y="113" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">ask:add_user</text>
<line x1="285" y1="126" x2="285" y2="156" stroke="var(--ink-faint)"/>
<rect x="160" y="156" width="250" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="172" y="179" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">stream(messages) 边收边打印</text>
<line x1="230" y1="192" x2="120" y2="230" stroke="var(--ink-faint)"/>
<line x1="340" y1="192" x2="450" y2="230" stroke="var(--ink-faint)"/>
<rect x="20" y="230" width="220" height="36" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="253" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">成功:add_assistant</text>
<rect x="360" y="230" width="260" height="36" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="372" y="253" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">401/断网/Ctrl+C:turns.pop()</text>
<text x="20" y="290" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">两条路都回到 input,历史里永远只有「问+答」完整的轮次</text>
</svg>
<figcaption>主循环只做分流;真正要小心的是 ask():先把问题记进历史,拿到完整回答再补上回答,任何一步出错就把这一轮整个删掉。</figcaption>
</figure>

一步一步来,每一步都能跑。

## 第一步:最小的循环

最小的聊天程序就三件事:读一行、发出去、打印回答。新建 `part02/chat_loop.py`:

```python
# agent-zero-lab/part02/chat_loop.py
import readline  # noqa: F401

from common.llm import LLMClient

SYSTEM = "你是云簿 CloudLedger 的客服助手。回答简短,不确定就说不确定。"


def main() -> None:
    client = LLMClient()
    while True:
        try:
            line = input("\n你:").strip()
        except EOFError:
            break
        if not line:
            continue
        messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": line}]
        print("助手:", end="", flush=True)
        for piece in client.stream(messages, temperature=0.5, max_tokens=300):
            print(piece, end="", flush=True)
        print()
    print("\n再见。", client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import readline  # noqa: F401` 导入了但代码里不用它,所以 Ruff 会报 F401「导入了没用」,`# noqa: F401` 让它别报。为什么要导入一个不用的模块,第二步专门讲,先照抄。
- `from common.llm import LLMClient` [Day 135](/blog/agent-zero/day-135-llm-client-1/) 封装的客户端,今天要用它的 `stream()`。
- `SYSTEM = "你是云簿 CloudLedger 的客服助手。` 我们的虚构公司。「不确定就说不确定」是给模型留一个出口,和 Day 151 给字段留 `null` 一个道理。
- `client = LLMClient()` 读 `agent-zero-lab/.env`,也就是 DeepSeek 官方的 `deepseek-flash`。
- `while True:` 死循环,靠 `break` 退出。相当于 JS 的 `while (true)`。
- `line = input("\n你:").strip()` `input()` 先打印提示文字,然后**卡住等你输入**,按回车后把这一行(不含换行符)作为字符串返回。相当于 Node 里 `readline.question()`,但它是同步的,不用 await。`\n` 让每次提示前空一行,`.strip()` 去掉两头空格。
- `except EOFError:` 按 Ctrl+D(Mac 和 Linux 上表示「输入结束」)时 `input()` 会抛这个异常。用管道喂输入、内容读完时也会抛。接住它就退出循环。
- `if not line:` 空行(直接回车)跳过,不发给模型浪费钱。
- `messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": line}]` 每一轮都是全新的两条消息,**不带之前聊过的内容**。这就是这个版本的问题,马上就能看到。
- `print("助手:", end="", flush=True)` `end=""` 不换行;`flush=True` 立刻刷到屏幕上。Python 的 `print` 默认会先攒在缓冲区里,不加 flush 的话「助手:」可能要等回答全到了才一起出来。
- `for piece in client.stream(messages, temperature=0.5, max_tokens=300):` `stream()` 是 [Day 134](/blog/agent-zero/day-134-streaming-code/) 讲过的生成器,模型每吐出一小段文字就 yield 一段。`temperature=0.5` 聊天时让回答稍微灵活一点;抽字段时我们用 0。
- `print(piece, end="", flush=True)` 来一段打一段,屏幕上的字就是一个个「冒」出来的。
- `print()` 回答结束,补一个换行。
- `print("\n再见。", client.ledger)` 退出时打印账单。`ledger` 的 `__str__` 是 Day 136 写的,打印出来是「N 次调用 | 输入 … / 输出 … tokens | 约 ¥…」。

</div>

正常用法是在终端里运行,然后自己一句一句敲:

```bash
cd ~/agent-zero-lab
uv run python -m part02.chat_loop
```

为了让输出可重复、能贴进文章,我用管道一次把三行输入喂给它(第二行是空行,测试 `if not line`):

```bash
printf '我叫小林,买的是年付套餐\n\n我叫什么?买的什么套餐?\n' | uv run python -m part02.chat_loop
```

`printf` 和 `echo` 类似,但能识别 `\n` 换行。`|` 是 [Day 5](/blog/agent-zero/day-005-terminal-3/) 学的管道,把前一个命令的输出接到后一个命令的输入上,`input()` 就从这里一行一行读。

我的输出(2026-10-23,`deepseek-flash`):

```text
你:助手:小林你好，请问有什么可以帮你的？

你:
你:助手:我不确定你的身份信息,也看不到你的账户或购买记录,所以无法知道你的名字和套餐。请提供订单号或登录后查看,我也可以帮你说明怎么查。

你:
再见。 2 次调用 | 输入 63 / 输出 47 tokens | 约 ¥0.0005
```

先说输出为什么长这样。「你:」后面看不到我输入的那句话,因为字是从管道来的,不是从键盘敲的,终端不会把它显示出来(这叫「回显」,只有键盘输入才有)。你自己在终端里敲就能看到。空行那里连着出现了两个「你:」,中间那个就是被 `continue` 跳过的空行。最后一个「你:」后面是 `EOFError`:管道里的内容读完了。

再看内容:第二个问题模型完全不知道我叫小林。它说得很老实,「看不到你的账户」,但真正的原因是**我们没把第一句话发给它**。[Day 129](/blog/agent-zero/day-129-messages/) 讲过:模型没有记忆,你发过去的 messages 列表就是它的全部记忆。

## 第二步:为什么要 import readline

先插一个手感问题,不修它,后面敲长问题会很难受。

把第一步脚本里的 `import readline` 删掉跑一次,输入 `abc`,按两下左方向键,再输入 `X`,回车。你期望得到 `aXbc`,实际屏幕上是这样的:

```text
你:abc^[[D^[[DX
收到: 'abc\x1b[D\x1b[DX'
```

这是我用两个 6 行的小脚本测的(`part02/input_plain.py` 只有 `input()` 和 `print(repr(...))`,`part02/input_readline.py` 多一行 `import readline`),按键是用 Python 的 `pty` 模块模拟敲进去的,和你手敲效果一样。没导入 readline 时,左方向键没有让光标左移,而是变成了 `^[[D` 三个字符原样进了字符串(`\x1b[D` 是方向键在终端里的编码)。导入以后:

```text
你:abcXbc
收到: 'aXbc'
```

屏幕上的显示因为光标来回移动有点乱,但收到的字符串是对的 `'aXbc'`,而且上方向键能翻出上一次输入的内容。

原因是:Python 的 `input()` 自己只会最原始的「读到回车为止」,行内编辑(方向键移光标、上下键翻历史)是 readline 这个模块提供的。Python 文档写得很清楚:**如果 readline 模块已经加载,`input()` 会用它提供行编辑和历史功能**。交互式的 Python 命令行(REPL)会自动加载它,所以你在 REPL 里用方向键没问题;运行脚本时不会自动加载,要自己 import。

macOS 上用 uv 装的 Python 3.12,`readline` 背后是 libedit(`readline.__doc__` 里写着「using libedit readline」),功能够用。导入这一行就生效,不用调用它的任何函数,这就是第一步那行「导入了但不用」的原因。

## 第三步:接上 Conversation,让它记住前几轮

[Day 135](/blog/agent-zero/day-135-llm-client-1/)–[Day 137](/blog/agent-zero/day-137-llm-client-3/) 在 `common/llm.py` 里写过一个 `Conversation` 类,专门管多轮历史。复习一下它的样子:

| 成员 | 作用 |
| --- | --- |
| `Conversation(system, max_turns=20)` | 建一个对话,system 提示词永远保留 |
| `.turns` | 列表的列表,每一轮是一组消息:`[user, assistant]` |
| `.add_user(text)` | 新开一轮,放进 user 消息 |
| `.add_assistant(message)` | 把 assistant 消息补进最新那一轮 |
| `.messages()` | 拼出要发给模型的列表:system + 最近 `max_turns` 轮 |
| `.max_turns` | 滑动窗口大小,只发最近这么多轮 |

把第一步的循环改成用它。新建 `part02/chat_memory.py`:

```python
# agent-zero-lab/part02/chat_memory.py
import readline  # noqa: F401

from common.llm import Conversation, LLMClient

SYSTEM = "你是云簿 CloudLedger 的客服助手。回答简短,不确定就说不确定。"


def main() -> None:
    client = LLMClient()
    conv = Conversation(SYSTEM, max_turns=10)
    while True:
        try:
            line = input("\n你:").strip()
        except EOFError:
            break
        if not line:
            continue
        conv.add_user(line)
        sent = conv.messages()
        print("助手:", end="", flush=True)
        for piece in client.stream(sent, temperature=0.5, max_tokens=300):
            print(piece, end="", flush=True)
        conv.add_assistant(client.last.message)
        print(f"\n  [这一轮发了 {len(sent)} 条消息 | 输入 {client.last.prompt_tokens} token]")
    print("\n再见。", client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from common.llm import Conversation, LLMClient` 多导入一个 `Conversation`。
- `conv = Conversation(SYSTEM, max_turns=10)` 最多发最近 10 轮。一轮就是「一问一答」,10 轮通常够客服场景用,再多就越聊越贵([Day 131](/blog/agent-zero/day-131-conversation-cost/) 算过平方级增长)。
- `conv.add_user(line)` 先把问题记进去,`turns` 从 `[]` 变成 `[[{"role": "user", "content": "我叫小林,买的是年付套餐"}]]`。
- `sent = conv.messages()` 拼出这一轮要发的消息,存进变量,后面要打印它的条数。第一轮是 system + user 共 2 条。
- `for piece in client.stream(sent, temperature=0.5, max_tokens=300):` 和第一步一样,只是发的不再是写死的两条。
- `conv.add_assistant(client.last.message)` `stream()` 结束时把完整结果放在 `client.last` 上(Day 136 的设计),`message` 是一条完整的 assistant 消息字典。补进这一轮,这一轮才完整。
- `print(f"\n  [这一轮发了 {len(sent)} 条消息 | 输入 {client.last.prompt_tokens} token]")` 每轮多打一行,看历史是不是真的发出去了。

</div>

这次喂三个问题,第二个问名字,第三个问点别的:

```bash
printf '我叫小林,买的是年付套餐\n我叫什么?买的什么套餐?\n年付能退吗?一句话\n' | uv run python -m part02.chat_memory
```

我的输出:

```text
你:助手:小林你好!请问有什么可以帮你的?
  [这一轮发了 2 条消息 | 输入 32 token]

你:助手:你叫小林,买的是年付套餐。
  [这一轮发了 4 条消息 | 输入 52 token]

你:助手:年付套餐能否退款要看具体退款政策,我不确定,建议联系人工客服确认。
  [这一轮发了 6 条消息 | 输入 73 token]

你:
再见。 3 次调用 | 输入 157 / 输出 38 tokens | 约 ¥0.0006
```

这次记住了。每轮发出去的消息从 2 条涨到 4 条、6 条,输入 token 从 32 涨到 52、73。这就是 Day 131 说的「越聊越贵」:每一轮都要把之前所有的问答再发一遍。

第三个问题模型说不确定,因为退款规则(Day 142 的 `POLICY`)根本不在 system 里。想让它答对,要么把规则写进 system,要么等第四部分用 RAG 去查。今天的重点是骨架,不管答得好不好。

## 第四步:拼成完整的 chatbot.py

现在加命令和出错处理,顺便把代码组织成一个类。为什么要类?因为程序里有两份状态(客户端、对话)要在好几个函数之间共享,放进一个对象里比用全局变量清楚([Day 40](/blog/agent-zero/day-040-classes-1/) 讲过类把数据和操作放在一起)。新建 `part02/chatbot.py`:

```python
# agent-zero-lab/part02/chatbot.py
"""命令行聊天机器人(一):多轮 + 流式 + 几个基本命令。运行:uv run python -m part02.chatbot [--env .env.sf]"""
import argparse
import readline  # noqa: F401

import openai

from common.llm import Conversation, LLMClient

DEFAULT_SYSTEM = "你是云簿 CloudLedger 的客服助手。回答简短,不确定就说不确定。"
HELP = """命令:
  /help     显示帮助
  /clear    清空历史,从头聊
  /history  看现在记着几轮
  /quit     退出"""


class ChatBot:
    def __init__(self, env_file: str | None) -> None:
        self.client = LLMClient(env_file)
        self.conv = Conversation(DEFAULT_SYSTEM, max_turns=10)

    def handle_command(self, line: str) -> bool:
        """处理斜杠命令。返回 False 表示退出。"""
        cmd, _, arg = line.partition(" ")
        if cmd == "/quit":
            return False
        if cmd == "/help":
            print(HELP)
        elif cmd == "/clear":
            self.conv.turns.clear()
            print("历史已清空")
        elif cmd == "/history":
            print(f"记着 {len(self.conv.turns)} 轮,最多发最近 {self.conv.max_turns} 轮给模型")
        else:
            print(f"未知命令 {cmd}{' ' + arg if arg else ''},输入 /help 查看")
        return True

    def ask(self, text: str) -> None:
        self.conv.add_user(text)
        print("助手:", end="", flush=True)
        try:
            for piece in self.client.stream(self.conv.messages(), temperature=0.5, max_tokens=1000):
                print(piece, end="", flush=True)
        except openai.APIStatusError as e:
            self.conv.turns.pop()
            print(f"\n[出错 HTTP {e.status_code}] 这一轮没记进历史")
            return
        except openai.APIConnectionError:
            self.conv.turns.pop()
            print("\n[连不上服务器,检查网络或代理] 这一轮没记进历史")
            return
        except KeyboardInterrupt:
            self.conv.turns.pop()
            print("\n[已中断] 这一轮没记进历史")
            return
        r = self.client.last
        self.conv.add_assistant(r.message)
        if r.finish_reason == "length":
            print("\n[回答被 max_tokens 截断了]", end="")
        print()

    def run(self) -> None:
        print(f"已连接 {self.client.model}。输入 /help 查看命令。")
        while True:
            try:
                line = input("\n你:").strip()
            except (EOFError, KeyboardInterrupt):
                break
            if not line:
                continue
            if line.startswith("/"):
                if not self.handle_command(line):
                    break
            else:
                self.ask(line)
        print("\n再见。", self.client.ledger)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", default=None, help="配置文件,默认 .env")
    ChatBot(parser.parse_args().env).run()


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `"""命令行聊天机器人(一)` 模块文档字符串,顺手写上怎么运行。`[--env .env.sf]` 方括号表示可选参数,命令行工具的帮助里都这么写。
- `import argparse` 标准库的命令行参数解析,相当于 Node 的 commander / yargs。[Day 44](/blog/agent-zero/day-044-notebook-project/) 用 `sys.argv` 手动解析过,参数一多就容易乱,argparse 帮你处理 `--env xxx` 这种写法、自动生成 `--help`。
- `import openai` 只为了下面 `except openai.APIStatusError` 这几个异常类型。
- `HELP = """命令:` 三引号字符串可以跨多行,换行和缩进原样保留,`print(HELP)` 打出来就是这个样子。
- `class ChatBot:` 两份状态(客户端、对话)加三个方法(处理命令、问一轮、主循环)。
- `def __init__(self, env_file: str | None) -> None:` `env_file` 不传 `--env` 时是 `None`,`LLMClient` 就读默认的 `.env`。
- `self.conv = Conversation(DEFAULT_SYSTEM, max_turns=10)` 每个 `ChatBot` 对象有自己的一份对话。
- `def handle_command(self, line: str) -> bool:` 返回 `True` 继续聊,`False` 退出。只有 `/quit` 返回 False。
- `cmd, _, arg = line.partition(" ")` `partition` 在**第一个**空格处把字符串切成三段 `(前面, 空格, 后面)`,再用 [Day 22](/blog/agent-zero/day-022-tuples-unpack/) 的解包分给三个变量。中间那段用不上,用 `_` 接住,相当于 JS 的 `const [cmd, , arg] = ...`。实跑 `"/foo bar".partition(" ")` 得到 `('/foo', ' ', 'bar')`;`"/clear".partition(" ")` 得到 `('/clear', '', '')`,没有空格也不报错。用 `split(" ")` 的话后面带空格的参数会被切碎,Day 154 的 `/env 文件名` 和以后的 `/system 一段话` 都要靠 partition。
- `if cmd == "/quit":` 直接 return,不看后面的分支。
- `self.conv.turns.clear()` `list.clear()` 原地清空列表。system 提示词不在 `turns` 里,不受影响。
- `print(f"记着 {len(self.conv.turns)} 轮,最多发最近 {self.conv.max_turns} 轮给模型")` 「记着」和「发出去」是两回事:超过 10 轮后,前面的还在 `turns` 里,只是不再发给模型。
- `print(f"未知命令 {cmd}{' ' + arg if arg else ''},输入 /help 查看")` f-string 里嵌了一个三元表达式:有参数就在前面加个空格拼上,没参数就是空字符串。f-string 外层是双引号,里面的字符串用单引号。
- `def ask(self, text: str) -> None:` 处理一轮对话,是整个程序最要紧的部分,读法见下面的四段式。
- `self.conv.add_user(text)` 第一段:先把问题记进历史,新开一轮。
- `for piece in self.client.stream(self.conv.messages(), temperature=0.5, max_tokens=1000):` 第二段:流式拿回答,整段包在 `try` 里,因为网络请求随时可能失败。`max_tokens` 给 1000,聊天回答比第三步的测试长一些。
- `except openai.APIStatusError as e:` 第三段:出错。服务器回了错误码,401 key 错、429 限流、5xx 服务器出问题都是这个类型([Day 126](/blog/agent-zero/day-126-error-codes/))。`e.status_code` 是 HTTP 状态码。注意 `LLMClient` 里 openai 客户端本身有 `max_retries=3`,429 和 5xx 会先自己重试几次,还不行才抛到这里。
- `self.conv.turns.pop()` 删掉刚才 `add_user` 加的那一轮。不删的后果第五步演示。
- `return` 出错就结束这一轮,不走下面的记账。
- `except openai.APIConnectionError:` 根本连不上:断网、代理没开、DNS 解析失败。
- `except KeyboardInterrupt:` 回答到一半按 Ctrl+C。Python 收到 Ctrl+C 会在当前执行的地方抛出这个异常,这里接住,只打断这一轮,程序不退出。
- `r = self.client.last` 第四段:成功。拿完整结果。
- `self.conv.add_assistant(r.message)` 把回答补进这一轮,凑成完整的「问 + 答」。
- `if r.finish_reason == "length":` 回答被 `max_tokens` 截断时提醒一句,用户就知道不是模型只想说这么多。
- `def run(self) -> None:` 主循环,和第三步差不多,多了命令分流。
- `except (EOFError, KeyboardInterrupt):` 用一个元组同时接住两种异常:Ctrl+D 和**在等输入时**按 Ctrl+C,都是退出程序。和 `ask()` 里那个 Ctrl+C 不同:那个是在模型回答时按的,只打断这一轮。
- `if line.startswith("/"):` 斜杠开头的是命令,其余都是问题。
- `if not self.handle_command(line):` 只有 `/quit` 返回 False,跳出循环。
- `parser.add_argument("--env", default=None, help="配置文件,默认 .env")` 声明一个可选参数。运行 `python -m part02.chatbot --env .env.sf` 时 `parse_args().env` 是 `".env.sf"`,不传就是 `None`。
- `ChatBot(parser.parse_args().env).run()` 建对象、进主循环,一行。
- `if __name__ == "__main__":` 直接运行时才进 `main()`;练习里别的文件 `from part02.chatbot import ChatBot` 时不会启动循环([Day 32](/blog/agent-zero/day-032-modules/))。

</div>

`ask()` 是整个程序的核心,用一句话记:**先记问题 → 流式拿回答 → 出错就删掉这一轮 → 成功就补上回答。**这样不管中间出什么事,历史里永远只有完整的轮次。

试一遍所有命令,顺便验证 `/clear` 真的清掉了历史:

```bash
printf '/help\n我叫小林,买的是年付套餐\n/history\n我叫什么?\n/foo bar\n/clear\n我叫什么?\n/quit\n这句不会被读到\n' | uv run python -m part02.chatbot
```

我的输出:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:命令:
  /help     显示帮助
  /clear    清空历史,从头聊
  /history  看现在记着几轮
  /quit     退出

你:助手:小林你好,年付套餐已了解。请问有什么可以帮你的?

你:记着 1 轮,最多发最近 10 轮给模型

你:助手:你叫小林。

你:未知命令 /foo bar,输入 /help 查看

你:历史已清空

你:助手:抱歉,我不知道你的名字——我们的对话里没有你的个人信息。你可以直接告诉我,我怎么称呼你?

你:
再见。 3 次调用 | 输入 113 / 输出 40 tokens | 约 ¥0.0005
```

`/clear` 之前它知道我叫小林,之后就不知道了。`/quit` 后面那句「这句不会被读到」确实没被读:循环已经 break,程序退出了。命令不调模型,所以 9 行输入只有 3 次调用。

## 第五步:出错时别把历史弄乱

`ask()` 里那三处 `turns.pop()` 看起来不起眼,今天最值得花时间的就是它们。先看它们正常工作时是什么样子。

**key 错了(401)。** 复制一份 `.env`,把 key 改错:

```bash
sed 's/^LLM_API_KEY=.*/LLM_API_KEY=sk-wrong/' .env > .env.bad
printf '我叫小林\n/history\n/quit\n' | uv run python -m part02.chatbot --env .env.bad
```

`sed 's/旧/新/'` 是按行替换文字的命令行工具,这里把 `LLM_API_KEY=` 开头的那一行整行换掉,结果写进新文件 `.env.bad`。输出:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:助手:
[出错 HTTP 401] 这一轮没记进历史

你:记着 0 轮,最多发最近 10 轮给模型

你:
再见。 0 次调用 | 输入 0 / 输出 0 tokens | 约 ¥0.0000
```

401 被接住了,程序没崩,`/history` 显示 0 轮。401 是确定性的错误(Day 126),openai 客户端不会重试,很快就返回了。试完删掉 `.env.bad`,别让一个假 key 文件留在仓库里。

**回答到一半按 Ctrl+C。** 你自己试的话:运行 `uv run python -m part02.chatbot`,先说一句「我叫小林」,再让它写一份长东西,字还在往外冒的时候按 Ctrl+C,然后 `/history`,再问「我叫什么?」。

为了贴出可重复的输出,我写了个小脚本代替手按:用 `subprocess` 启动 chatbot,往它的输入里写字,在第二个问题发出 1.5 秒后给它发一个 SIGINT 信号(Ctrl+C 实际上就是让终端给程序发这个信号)。这个脚本不是今天的内容,不贴了,输出是:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:助手:你好，小林！我是云簿 CloudLedger 的客服助手，有什么可以帮你的吗？

你:助手:以下是给团队开发票的 10 条操作清单：

1. **确认开票主体**：先确定以公司还是个人名义开票，核对营业执照信息。主体信息错误会导致发票无效。

2. **收集开票资料**：向团队收集名称、税号、地址电话、开户
[已中断] 这一轮没记进历史

你:记着 1 轮,最多发最近 10 轮给模型

你:助手:你叫小林。

你:
再见。 2 次调用 | 输入 80 / 输出 25 tokens | 约 ¥0.0004
```

中断后历史还是 1 轮(只有「我叫小林」那一轮),下一个问题照常回答。

这里有一个账单上的坑:**最后显示 2 次调用,被中断的那次没记进去。** `LLMClient.stream()` 是在流全部读完以后才 `ledger.add()` 的,中途被打断就走不到那一行。可服务端已经生成了那些 token,DeepSeek 照样会收钱。所以本地账单会比实际少一点。Day 154 做每轮成本统计时要记住这一点。

**不回滚会怎样?** 动手练习 2 会把 `turns.pop()` 删掉重做这个实验,结果很有意思:被取消的那个问题会在下一轮「复活」,模型把两个问题一起回答了。先自己猜一下,再去看练习的参考答案。

### 零件和大代码的对照

| 零件 | 在 `chatbot.py` 的哪里 | 首次出现 |
| --- | --- | --- |
| `input()` + `EOFError` + 空行跳过 | `run()` 的循环 | 今天第一步 |
| `import readline` | 文件开头 | 今天第二步 |
| `print(..., end="", flush=True)` 流式打印 | `ask()` 第二段 | [Day 134](/blog/agent-zero/day-134-streaming-code/) |
| `Conversation` 的 `add_user` / `add_assistant` / `messages()` | `__init__` 和 `ask()` | [Day 135](/blog/agent-zero/day-135-llm-client-1/)–[137](/blog/agent-zero/day-137-llm-client-3/),今天第三步 |
| `client.last` 拿流式的完整结果 | `ask()` 第四段 | [Day 136](/blog/agent-zero/day-136-llm-client-2/) |
| `partition` 拆命令 | `handle_command()` 第一行 | 今天第四步 |
| 错误类型 401/429/5xx/连不上 | `ask()` 的三个 `except` | [Day 126](/blog/agent-zero/day-126-error-codes/) |
| 出错回滚 `turns.pop()` | `ask()` 第三段 | 今天第五步 |
| `argparse` | `main()` | 今天第四步 |

## 动手练习

三道题加起来调 DeepSeek 约 10 次,不到 1 分钱。

**练习 1:滑动窗口什么时候开始「忘事」。** 不用交互,写一个脚本按顺序问四个问题:「我叫小林,买的是年付套餐」「发票在哪里下载?」「能改抬头吗?」「我叫什么?」,`Conversation` 的 `max_turns` 设成 2。每轮打印发出去几条消息、每条的角色首字母、`turns` 里一共几轮。先猜:第四个问题它还记得名字吗?`max_turns=2` 的「2 轮」包不包括正在问的这一轮?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex152_window.py
from common.llm import Conversation, LLMClient

SYSTEM = "你是云簿 CloudLedger 的客服助手。回答简短,一句话以内。"
QUESTIONS = ["我叫小林,买的是年付套餐", "发票在哪里下载?", "能改抬头吗?", "我叫什么?"]


def main() -> None:
    client = LLMClient()
    conv = Conversation(SYSTEM, max_turns=2)
    for q in QUESTIONS:
        conv.add_user(q)
        sent = conv.messages()
        r = client.chat(sent, temperature=0, max_tokens=100)
        conv.add_assistant(r.message)
        roles = [m["role"][0] for m in sent]
        print(f"你:{q}\n  发出 {len(sent)} 条 {roles} | 历史共 {len(conv.turns)} 轮\n  助手:{r.content}")
    print(client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `QUESTIONS = [` 四个问题写死在列表里,不用 `input()`,结果可重复。
- `conv = Conversation(SYSTEM, max_turns=2)` 窗口只有 2 轮。
- `r = client.chat(sent, temperature=0, max_tokens=100)` 这道题不需要流式,用非流式的 `chat()` 省事。
- `roles = [m["role"][0] for m in sent]` 列表推导式([Day 23](/blog/agent-zero/day-023-comprehensions/)),取每条消息角色的第一个字母:`s`ystem、`u`ser、`a`ssistant。

</div>

```bash
uv run python -m part02.ex152_window
```

我的输出:

```text
你:我叫小林,买的是年付套餐
  发出 2 条 ['s', 'u'] | 历史共 1 轮
  助手:小林您好,请问有什么可以帮您的?
你:发票在哪里下载?
  发出 4 条 ['s', 'u', 'a', 'u'] | 历史共 2 轮
  助手:在云簿官网「我的账户-账单与发票」页面即可下载。
你:能改抬头吗?
  发出 4 条 ['s', 'u', 'a', 'u'] | 历史共 3 轮
  助手:可以，在「账单与发票」页面点击对应发票的「修改抬头」即可重新开具。
你:我叫什么?
  发出 4 条 ['s', 'u', 'a', 'u'] | 历史共 4 轮
  助手:抱歉，我无法看到您的个人信息，不知道您叫什么。
4 次调用 | 输入 183 / 输出 58 tokens | 约 ¥0.0008
```

第四个问题忘了名字。从第三个问题起,发出去的都是 4 条:system、上一轮的问和答、这一轮的问。所以 `max_turns=2` 的 2 轮**包括正在问的这一轮**,真正能看到的历史只有 1 轮。`turns` 里记着 4 轮,只是前面的没发出去。

顺带一个小发现:第二、三个问题,模型编了一个「我的账户-账单与发票」页面和「修改抬头」按钮。云簿是虚构公司,这些页面根本不存在。system 里写了「不确定就说不确定」也没拦住,客服机器人只靠提示词是不够的,这是第四部分 RAG 要解决的问题。

</details>

**练习 2:去掉回滚,看被取消的问题怎么「复活」。** 写一个 `ChatBot` 的子类,重写 `ask()`,只接 `KeyboardInterrupt` 且**不** `pop()`;再加一个 `/roles` 命令打印当前要发出去的每条消息的角色。运行后:先说「我叫小林」,再让它写一份长清单并在中途按 Ctrl+C,然后 `/roles`,再问「我叫什么?」,再 `/roles`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex152_no_rollback.py
from part02.chatbot import ChatBot


class NoRollbackBot(ChatBot):
    """故意去掉回滚:中断后不删这一轮,并加一个 /roles 命令看历史里的角色。"""

    def ask(self, text: str) -> None:
        self.conv.add_user(text)
        print("助手:", end="", flush=True)
        try:
            for piece in self.client.stream(self.conv.messages(), temperature=0.5, max_tokens=1000):
                print(piece, end="", flush=True)
        except KeyboardInterrupt:
            print("\n[已中断] 但这一轮留在了历史里")
            return
        self.conv.add_assistant(self.client.last.message)
        print()

    def handle_command(self, line: str) -> bool:
        if line == "/roles":
            print([m["role"] for m in self.conv.messages()])
            return True
        return super().handle_command(line)


if __name__ == "__main__":
    NoRollbackBot(None).run()
```

<div class="line-notes">

- `from part02.chatbot import ChatBot` 因为 `chatbot.py` 有 `if __name__ == "__main__":`,导入它不会启动聊天循环。
- `class NoRollbackBot(ChatBot):` 继承([Day 42](/blog/agent-zero/day-042-classes-2/)),只改两个方法,`run()` 和 `__init__` 照用父类的。
- `def ask(self, text: str) -> None:` 子类里写同名方法,就把父类的 `ask` 覆盖了,`run()` 里调的 `self.ask(line)` 会走这个版本。
- `except KeyboardInterrupt:` 只接 Ctrl+C,也不 `pop()`。
- `def handle_command(self, line: str) -> bool:` 也覆盖,但只处理新加的 `/roles`。
- `return super().handle_command(line)` 其余命令交回父类处理,`/history`、`/quit` 照常能用。相当于 JS 的 `return super.handleCommand(line)`。
- `NoRollbackBot(None).run()` 传 `None` 就是用默认 `.env`。

</div>

```bash
uv run python -m part02.ex152_no_rollback
```

我还是用脚本代替手按 Ctrl+C,输出:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:助手:你好，小林！我是云簿 CloudLedger 的客服助手，有什么可以帮你的吗？

你:助手:以下是给团队开发票的 10 条操作清单：

1. **确认开票主体**：先确定用公司还是个人名义开票，核对营业执照信息。主体信息错误会导致发票作废。

2. **收集开票资料**：向团队汇总抬头、税号、地址电话、开户行及账号。一般纳税人还需确认专票还是普票。

3. **明确发票类型**：根据用途选择增值税专用发票或普通发票。专票可用于抵扣，普票不能。

4. **核对开票内容**：确认商品或服务名称、规格、数量、单价与合同一致。内容不符可能被税务退回。

5. **确认金额与税率**：核对含税/不含税金额及适用税率。税率选错需红冲重开。

6. **提交开票
[已中断] 但这一轮留在了历史里

你:['system', 'user', 'assistant', 'user']

你:助手:你叫小林。

以下是「怎么给团队开发票」的 10 条操作清单：

1. **确认开票主体**：先明确以公司还是团队名义开票，核对营业执照信息。主体不一致会导致发票无效。
2. **收集开票资料**：向客户索取名称、税号、地址电话、开户行及账号。信息不全无法开具增值税专用发票。
3. **确认发票类型**：问清对方要普票还是专票，专票需一般纳税人资质。类型开错需作废重开。
4. **核对金额与税率**：按合同金额和适用税率计算，注意含税与不含税区分。税率选错会影响对方抵扣。
5. **填写开票申请单**：在系统或表格中登记项目、金额、客户信息。留档便于后续查询和对账。
6. **内部审批**：提交负责人或财务审核，确认业务真实、金额无误。审批通过后再进入开票环节。
7. **在开票系统开具**：登录税控或电子发票平台录入信息并生成发票。开具后仔细核对每一项内容。
8. **交付发票**：电子发票发至客户指定邮箱，纸质发票邮寄并留存快递单号。交付后请对方确认签收。
9. **登记台账**：将发票号码、金额、开票日期、客户记入台账。方便后续催款和税务核对。
10. **跟进回款与红冲**：款项到账后标记完成；如有错误及时申请红冲或作废。跨月发票一般只能红冲不能作废。

需要我针对某一条再展开吗？

你:['system', 'user', 'assistant', 'user', 'user', 'assistant']

你:
再见。 2 次调用 | 输入 100 / 输出 368 tokens | 约 ¥0.0031
```

第一次 `/roles` 是 `system, user, assistant, user`:那个被取消的问题还挂在最后,没有回答。再问「我叫什么?」时,发出去的是**两条连续的 user 消息**。模型觉得两个问题都该答,先说「你叫小林」,然后把我已经按 Ctrl+C 取消掉的整份清单从头写了一遍。用户明明已经不要了,还要再看一遍、再付一遍钱(这一轮输出 368 token 里大部分是它)。

这还算好的。有些厂商对「两条连续 user」直接报 400,有些在工具调用场景下(第三部分)会因为消息顺序不合法整轮失败。回滚就是为了让历史永远是「问、答、问、答」这样合法的形状。

</details>

**练习 3:加一个 `/retry` 命令。** 用户对上一个回答不满意时,输入 `/retry` 让模型重新回答上一个问题:删掉最后一轮,用同一个问题再问一次。没有历史时提示「还没有可以重来的一轮」。和练习 2 一样用子类实现,不改 `chatbot.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex152_retry.py
from part02.chatbot import ChatBot


class RetryBot(ChatBot):
    def handle_command(self, line: str) -> bool:
        if line == "/retry":
            if not self.conv.turns:
                print("还没有可以重来的一轮")
                return True
            last = self.conv.turns.pop()
            text = last[0]["content"]
            print(f"重新回答:{text}")
            self.ask(text)
            return True
        return super().handle_command(line)


if __name__ == "__main__":
    RetryBot(None).run()
```

<div class="line-notes">

- `if not self.conv.turns:` 空列表是假值([Day 17](/blog/agent-zero/day-017-if-else/)),没有历史时直接提示。
- `last = self.conv.turns.pop()` `pop()` 不带参数删掉并返回最后一个元素,也就是最后一轮 `[user, assistant]`。
- `text = last[0]["content"]` 每一轮的第 0 条是 user 消息,取它的文字。
- `self.ask(text)` 复用 `ask()`:重新 `add_user`、流式回答、出错回滚,全套照旧。所以如果重答的过程中按 Ctrl+C,这一轮会被整个删掉,原来的回答也没了。想保留旧回答,要等新回答成功后再删旧的,这里先用简单版。

</div>

```bash
printf '/retry\n给云簿的年付套餐想一句 15 字以内的广告语\n/retry\n/history\n/quit\n' | uv run python -m part02.ex152_retry
```

我的输出:

```text
已连接 deepseek-flash。输入 /help 查看命令。

你:还没有可以重来的一轮

你:助手:云簿年付，省心一整年。

你:重新回答:给云簿的年付套餐想一句 15 字以内的广告语
助手:云簿年付，省心一整年。

你:记着 1 轮,最多发最近 10 轮给模型

你:
再见。 2 次调用 | 输入 78 / 输出 20 tokens | 约 ¥0.0003
```

`/retry` 之后历史还是 1 轮,说明旧的那轮确实被替换了,不是叠加。但两次回答一字不差。`temperature=0.5` 对这种很短的回答影响不大,模型每一步最可能的那个字概率太高了([Day 110](/blog/agent-zero/day-110-sampling-1/))。真想要「换个说法」,可以让 `/retry` 在重问时把 `temperature` 调高,或者在问题后面加一句「换一种说法」,这留给你自己改。

</details>

**验收标准:** 能默写 `ask()` 的四段;能说出 `run()` 里和 `ask()` 里的两个 Ctrl+C 各是什么效果;能解释 `max_turns=2` 实际只看得到 1 轮历史;能复现练习 2 里「被取消的问题复活」并解释原因;知道 `import readline` 解决的是什么问题。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| REPL / 交互循环 | Read-Eval-Print Loop,读一行、处理、打印、再读下一行。今天的聊天机器人就是一个 REPL |
| `input()` | Python 内置函数,打印提示后阻塞等待用户输入一行,返回不含换行的字符串 |
| `EOFError` | 输入流结束时 `input()` 抛的异常,键盘上是 Ctrl+D,管道里是内容读完 |
| `KeyboardInterrupt` | 按 Ctrl+C 时 Python 在当前执行位置抛出的异常,可以用 `except` 接住 |
| SIGINT | Ctrl+C 实际触发的系统信号,终端把它发给前台程序,Python 把它变成 `KeyboardInterrupt` |
| readline | Python 标准库模块,导入后 `input()` 支持方向键编辑和历史记录;macOS 上背后是 libedit |
| 回显 | 终端把键盘敲的字显示在屏幕上。管道喂进来的输入不会回显 |
| 斜杠命令 | 以 `/` 开头的输入,由程序自己处理,不发给模型,比如 `/help`、`/clear` |
| `str.partition(sep)` | 在第一次出现 `sep` 的地方把字符串切成三段 `(前, sep, 后)`,找不到时返回 `(原串, '', '')` |
| argparse | 标准库的命令行参数解析模块,用 `add_argument("--env")` 声明参数,`parse_args()` 读取 |
| 回滚(这一轮) | 请求失败时把刚加进历史的 user 消息删掉,保证历史里只有完整的问答轮次 |

## 常见误区

**每一轮只发当前这一句。** 第一步就是这样,第二个问题模型不知道我叫什么。多轮对话要把历史一起发,`Conversation.messages()` 负责拼。

**流式打印不加 `flush=True`。** 字会一坨一坨地出来,甚至等回答全到了才一起显示,流式就白做了。

**脚本里方向键打出 `^[[D`。** 少了 `import readline`。REPL 会自动加载它,脚本不会。

**出错后不删掉这一轮。** 被取消的问题会在下一轮和新问题一起发出去,模型两个都答(练习 2 实测把取消掉的清单又写了一遍),有的厂商还会对连续两条 user 报 400。

**把等输入时的 Ctrl+C 和回答时的 Ctrl+C 当成一回事。** 前者在 `run()` 里被接住,退出程序;后者在 `ask()` 里被接住,只打断这一轮。两个 `except` 位置不同,效果不同。

**以为中断了就不花钱。** 服务端已经生成的 token 照样计费,而 `LLMClient.stream()` 在读完流以后才记账,中断的那次不会出现在本地账单里。

**以为 `max_turns=10` 就是能看到前 10 轮。** 它包括当前这一轮,实际能看到的历史是 9 轮。练习 1 用 `max_turns=2` 实测只看到 1 轮。

**用 `split(" ")` 拆命令。** 参数里带空格就被切碎了。只在命令名后面切一刀,用 `partition(" ")`。

**用管道测试时以为程序没收到输入。** 屏幕上「你:」后面空着,是因为管道输入不回显,程序其实收到了。

## 学习资料

### 文档与文章

- [Python 文档:input()](https://docs.python.org/zh-cn/3.12/library/functions.html#input):中文,里面有一句「如果加载了 readline 模块,input() 将使用它来提供复杂的行编辑和历史记录功能」,第二步的出处。
- [Python 文档:readline](https://docs.python.org/zh-cn/3.12/library/readline.html):中文,开头说明了 macOS 上可能是 libedit,以及怎么把历史存进文件(练习之外的扩展)。
- [Python 文档:argparse 教程](https://docs.python.org/zh-cn/3.12/howto/argparse.html):中文,从零讲 argparse,看到「可选参数」一节就够今天用了。
- [Python 文档:str.partition](https://docs.python.org/zh-cn/3.12/library/stdtypes.html#str.partition):中文,两句话说清三段返回值。
- [Python 文档:KeyboardInterrupt](https://docs.python.org/zh-cn/3.12/library/exceptions.html#KeyboardInterrupt):中文,注意它继承的是 `BaseException` 不是 `Exception`,所以 `except Exception` 接不住 Ctrl+C。
- [DeepSeek 文档:多轮对话](https://api-docs.deepseek.com/zh-cn/guides/multi_round_chat):中文,官方示例把每轮的 assistant 消息追加回 messages,和我们的 `Conversation` 一个思路。
- [simonw/llm 文档:Usage](https://llm.datasette.io/en/stable/usage.html):英文,一个成熟的命令行大模型工具,看「llm chat」一节,对比它的命令和我们的 `/help`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Le9BYkEm1&autoplay=0&high_quality=1" title="几分钟学会deepseek_R1官网api调用支持多轮对话并计算花销" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Ai意思君 · 几分钟学会deepseek_R1官网api调用支持多轮对话并计算花销 · 8 分钟,2025 年 3 月。用 DeepSeek 官方接口写一个能多轮对话、算花销的小程序,和今天加上 Day 154 的内容差不多。模型名是当时的 R1,接口写法今天还通用。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1FvQuYaEKn&autoplay=0&high_quality=1" title="让DeepSeek API启动流式输出及不同模型的切换" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>我是悠悠哥 · 让DeepSeek API启动流式输出及不同模型的切换 · 2 分半。很短,演示 stream=True 后一段段打印,顺带讲换模型,正好连接今天和 Day 154。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/EWvNQjAaOHw" title="How I use LLMs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · How I use LLMs · 英文。前 20 分钟讲聊天界面背后就是一个不断变长的 token 序列、为什么聊久了要开新对话,和今天第三步看到的「每轮输入越来越多」是一回事。</figcaption>
</figure>

### 书籍

- 今天这组不需要。聊天循环的写法看上面的 Python 文档就够,Day 153 复习日会推荐本周相关的书。

### 开源项目与代码

- [simonw/llm](https://github.com/simonw/llm):Simon Willison 写的命令行大模型工具,`llm chat` 就是一个功能完整的聊天 REPL,源码里能看到它怎么处理多轮和中断。
- [openai/openai-python](https://github.com/openai/openai-python#streaming-responses):README 的「Streaming responses」一节,官方流式写法,和 Day 134 对照。

## 自测

1. 第一步的程序第二个问题答不出名字,原因是什么?第三步改了哪几行解决的?

<details><summary>答案</summary>

模型没有记忆,第一步每轮只发 system 和当前这一句,之前说过的话没发过去。第三步用 `Conversation`:问题先 `add_user`,发送 `conv.messages()`(system + 最近几轮),拿到回答后 `add_assistant(client.last.message)` 补进历史,下一轮就会一起发出去。

</details>

2. `ask()` 里为什么要先 `add_user` 再请求,而不是等成功了再一起加?

<details><summary>答案</summary>

因为要发给模型的 messages 里必须包含这个问题,`conv.messages()` 是从 `turns` 拼出来的,不先加进去就发不出去。代价是请求失败时历史里会留一条没有回答的 user,所以出错时要 `pop()` 掉。另一种写法是不改 `turns`,手动拼 `conv.messages() + [新 user]` 发出去,成功后再把问答一起加进历史,效果一样。

</details>

3. 程序在等输入时按 Ctrl+C,和在模型回答时按 Ctrl+C,分别发生什么?为什么不一样?

<details><summary>答案</summary>

等输入时按,`input()` 抛 `KeyboardInterrupt`,被 `run()` 里的 `except (EOFError, KeyboardInterrupt)` 接住,跳出循环,程序退出。回答时按,异常在 `ask()` 的 `for piece in ...stream(...)` 那里抛出,被 `ask()` 里的 `except KeyboardInterrupt` 接住,删掉这一轮后返回,回到输入提示。异常在哪儿抛出,就被离它最近的那个 `except` 接住。

</details>

4. 去掉回滚以后,中断一次再提问,发出去的 messages 长什么样?会有什么后果?

<details><summary>答案</summary>

最后是两条连续的 user:被取消的那个问题和新问题。实测模型把两个都答了,把用户已经取消的长清单又写了一遍,多花了 token;有的厂商对连续 user 直接报 400,在工具调用场景下消息顺序不合法会导致整轮失败。

</details>

5. 面试题:「做一个多轮对话的聊天服务,你怎么管理对话历史?」

<details><summary>答案</summary>

模型是无状态的,历史由服务端自己存,每次请求把 system 加最近若干轮一起发过去。我会按「轮」管理,一轮是 user 加 assistant(以后还有工具调用的消息),用滑动窗口只发最近 N 轮控制成本,因为每轮都重发历史,总 token 随轮数近似平方增长;窗口太小又会忘事,所以更长的对话要配合摘要或检索。写入上要保证一致性:请求失败、超时、用户中断都要把这一轮回滚,保证历史始终是合法的「问、答」交替,否则会出现连续 user 消息,有的厂商直接报错,也会让被取消的问题在下一轮被重新回答。另外流式中断时服务端已生成的 token 照样计费,本地记账要考虑这部分。

</details>

## 明天预告

Day 153 · 第 22 周复习:大模型与 API(Day 147–152)。这一周前五天在讲结构化输出(三个层次、schema 约束、pydantic、带错误重试、字段顺序和抽取的坑),今天做了聊天机器人的骨架。明天把它们串成一张知识地图,默写 `extract()` 和 `ask()`,再用本周的东西做一个小工具,把错题和坑整理一遍。聊天机器人的切换厂商和每轮成本统计在 Day 154 接着做。
