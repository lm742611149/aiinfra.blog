---
title: 'Day 180 · 好工具(一):工具不是 API,使用者变了'
description: '工具的使用者从程序员变成了模型,好用的标准就变了,这就是 ACI(Agent-Computer Interface)的视角。造 40 篇会议纪要,写一组把 ls/cat/grep 包了一层的「能用但难用」的工具,先站在模型的位置量它们的定义和返回值,再让 Agent 真的去用,看一次简单查询吃掉多少 token,最后整理成一张难用工具清单。'
pubDate: 2026-10-22
regime: none
tags: ['tool-design', 'aci', 'function-calling', 'agent-zero']
series: 'agent-zero'
day: 180
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 178](/blog/agent-zero/day-178-thinking-budget/) 和 [Day 179](/blog/agent-zero/day-179-self-consistency/) 都在想办法让模型把计费题算对:开思考、投票、加验证器。两天得出同一个结论:能用程序精确算的东西,与其让模型多想、多投几票,不如给它一个好工具。验证器写到最完整,其实就是一个算退款的函数。

工具我们从 [Day 156](/blog/agent-zero/day-156-fc-idea/) 就开始写了:天气工具、注册表、自动生成 schema、完整的 Agent 循环。但一直没认真问过一个问题:**什么样的工具算好用?** 今天先不讲答案,先反过来,写一组功能完全正确但模型用起来很痛苦的工具,把「难用」量出来。

## 今天要解决的问题

学完你应该能:

1. 说清工具和普通 API 的使用者有什么不同,解释 ACI(Agent-Computer Interface)这个词。
2. 不调模型,先「站在模型的位置」审一组工具:看它的定义里写了什么、没写什么,量它的返回值有多大、报错能不能看懂。
3. 让 Agent 真的用这组工具做一次查询,读懂每一步的 token 账,整理出一张「难用工具清单」。

预计用时 2 小时。前置:[Day 157](/blog/agent-zero/day-157-tool-schema/)(工具定义)、[Day 168](/blog/agent-zero/day-168-tool-registry-1/) 和 [Day 169](/blog/agent-zero/day-169-tool-registry-2/)(`ToolRegistry`,用装饰器登记工具、从函数签名生成 schema)、[Day 170](/blog/agent-zero/day-170-agent-full/)(完整的 Agent 循环)。命令都在 `agent-zero-lab/` 根目录跑,今天全部实验花了两毛五左右。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,不看代码列出这组坏工具的五个以上问题;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 工具不是 API,使用者变了

先想一个前端每天都在经历的场景。后端同事给你一个接口 `GET /api/customers/:id`,文档就一行「获取客户」,返回 30 个字段,`status` 是 1 到 5 的数字。你会怎么做?你打开 DevTools 看几次真实返回,在 Slack 上问一句「status 4 是什么意思」,第二天就熟了。文档写得差,你有很多办法补。

现在把使用者换成模型。它每次请求都从零开始,能看到的关于这个工具的全部信息,就是你写在 `tools` 里的那几十个 token:名字、描述、参数。它不能问同事,不能打开 DevTools 多试几次再说,也不记得上一次会话里摸索出来的经验。它更像一个每次都失忆、只能读一页任务说明就开工的外包。

和人类开发者比,它还有两个很不一样的地方。

**上下文是它的工作台,而且很小、很贵。** 你调接口拿回 5 万字符的 JSON,浏览器不在乎,你 Ctrl+F 找到要的那一行就行。模型拿回 5 万字符,得把它全部读进上下文,每一个字都按输入 token 收钱,而且挤掉了别的信息。后面每一轮调用,这 5 万字符都还在历史里,再收一遍(有缓存会便宜,但不是零)。

**它照字面理解。** 参数叫 `f`,它只能猜是文件名还是路径;描述写「搜索」,它不知道是正则还是关键词,是搜文件名还是搜内容。你觉得「这还用说吗」的东西,对它来说都没说。

Anthropic 2025 年 9 月那篇[《Writing effective tools for agents》](https://www.anthropic.com/engineering/writing-tools-for-agents)里有一句话说得很准:工具是一种新的软件,它是确定性系统和非确定性 Agent 之间的契约。所以不能按写给开发者的函数或 API 的方式来写。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="同一个工具,程序员和模型各自能看到什么">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <text x="160" y="28" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">程序员用 API</text>
  <text x="480" y="28" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">模型用工具</text>
  <line x1="320" y1="15" x2="320" y2="235" stroke="var(--rule)"/>
  <rect x="30" y="45" width="260" height="34" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="160" y="67" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">文档 + 源码 + 问同事 + 多试几次</text>
  <rect x="30" y="92" width="260" height="34" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="160" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">返回 5 万字符?Ctrl+F 找一行</text>
  <rect x="30" y="139" width="260" height="34" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="160" y="161" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">报错看不懂?打断点、查日志</text>
  <rect x="30" y="186" width="260" height="34" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="160" y="208" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">今天摸熟了,明天还记得</text>
  <rect x="350" y="45" width="260" height="34" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="480" y="67" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">只有 name / description / 参数</text>
  <rect x="350" y="92" width="260" height="34" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="480" y="114" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">返回 5 万字符?全部读进上下文、按 token 付钱</text>
  <rect x="350" y="139" width="260" height="34" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="480" y="161" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">报错看不懂?只能换个参数瞎试</text>
  <rect x="350" y="186" width="260" height="34" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="480" y="208" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">每次请求都从零开始</text>
</svg>
<figcaption>同一个工具,使用者换了,能依赖的信息和能承受的代价都变了。左边琥珀色是程序员手里的外部手段,右边蓝色是模型那一侧能看到的全部。</figcaption>
</figure>

### ACI:给 Agent 设计的界面

这件事有一个专门的名字。2024 年普林斯顿的 SWE-agent 论文(Yang 等,[arXiv 2405.15793](https://arxiv.org/abs/2405.15793))提出了 **ACI**,Agent-Computer Interface,和 HCI(人机界面)对应。论文的出发点是:语言模型 Agent 是一种新的终端用户,就像程序员需要 IDE 而不是裸终端,Agent 也需要专门为它设计的界面。

他们在改代码这个场景里做了大量对比,定下几条原则,有几个具体数字我核对过论文原文:搜索命令每次最多返回 50 条结果,超过就告诉 Agent「写一个更具体的查询」;看文件一次只显示 100 行的窗口;编辑之后自动跑 linter,语法错误的修改直接驳回让它重来,去掉这个检查后 SWE-bench Lite 上的解决率从 18.0% 掉到 15.0%。他们总结的原则用大白话说就是:命令要简单,一步要能干成一件有意义的事,反馈要有信息量但别啰嗦,还要有护栏防止一个错误越滚越大。

这几条原则后面 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 会展开成六条。今天只要建立这个视角:**你设计工具时,用户是模型,不是你自己。** 判断一个工具好不好,不是看它功能对不对,而是看模型拿着它能不能又快又省地把事办成。

## 第一步:造 40 篇会议纪要

要量「难用」,得有一个具体的任务。场景是这样的:云簿团队有 40 篇周会纪要,其中某一篇里藏着一条决定「超过 30 天的订单退款需要财务主管审批」。用户问 Agent:「之前开会对超过 30 天的订单退款是怎么定的?谁负责的那次会?」

先造数据。纪要里大量提到「退款流程」作为噪音,只有一篇有那条决定:

```python
# agent-zero-lab/part03/make_notes.py  造 40 篇假会议纪要,给今天的工具当数据
import random
from pathlib import Path

random.seed(7)
root = Path("workspace/notes")
root.mkdir(parents=True, exist_ok=True)
topics = ["发票同步", "退款流程", "登录失败", "订阅升级", "数据导出", "价格调整", "税率配置", "客户迁移"]
people = ["王磊", "陈静", "李娜", "张伟", "刘洋"]
for i in range(1, 41):
    topic = random.choice(topics)
    owner = random.choice(people)
    lines = [f"# {topic} 周会纪要 #{i}", f"负责人: {owner}", f"日期: 2026-0{random.randint(7, 9)}-{random.randint(10, 28)}", ""]
    for j in range(random.randint(30, 120)):
        lines.append(f"- 第 {j + 1} 条讨论:关于{random.choice(topics)}的细节,结论是{random.choice(['继续观察', '下周上线', '需要客户确认', '已解决'])}")
    if topic == "退款流程" and i % 3 == 0:
        lines.append("- 决定:超过 30 天的订单退款需要财务主管审批")
    (root / f"meeting-{i:02d}.md").write_text("\n".join(lines), encoding="utf-8")
print("生成", len(list(root.glob("*.md"))), "篇")
```

<div class="line-notes">

- `import random` Python 自带的伪随机数模块,相当于 JS 的 `Math.random()`,但能设种子。
- `random.seed(7)` 种子固定成 7,每次运行抽到的数字序列都一样,你造出来的 40 篇和我的一字不差。[Day 112](/blog/agent-zero/day-112-sampling-2/) 讲 seed 和可复现时是同一个道理。
- `root = Path("workspace/notes")` 相对路径,相对的是你运行命令的目录。在 `agent-zero-lab/` 根目录跑,就生成 `agent-zero-lab/workspace/notes/`。
- `root.mkdir(parents=True, exist_ok=True)` `parents=True`:`workspace` 不存在就一起建;`exist_ok=True`:已经有了也不报错,脚本可以反复跑。相当于 Node 的 `fs.mkdirSync(p, { recursive: true })`。
- `topics = [` 8 个主题。只有主题刚好是「退款流程」的几篇,才有机会藏进那条决定。
- `topic = random.choice(topics)` 随机挑一个,相当于 `topics[Math.floor(Math.random() * topics.length)]`。
- `owner = random.choice(people)` 每调用一次 random 就消耗一个随机数,调用顺序也影响后面的结果。改了这两行的顺序,整批数据都会变。
- `lines = [f"# {topic} 周会纪要 #{i}"` 前 4 行:标题、负责人、日期、空行。实测 meeting-01 的前 3 行是 `# 价格调整 周会纪要 #1`、`负责人: 陈静`、`日期: 2026-08-11`。
- `for j in range(random.randint(30, 120)):` 每篇 30 到 120 条讨论,`randint` 两头都包含。
- `lines.append(f"- 第 {j + 1} 条讨论:关于{random.choice(topics)}的细节` 讨论内容里也会随机提到「退款流程」,这是故意的噪音。实测 meeting-01 的第 5 行就是 `- 第 1 条讨论:关于退款流程的细节,结论是需要客户确认`。
- `if topic == "退款流程" and i % 3 == 0:` 两个条件都满足才写决定。`%` 是取余,`i % 3 == 0` 就是能被 3 整除。实测全库只有 **meeting-21** 满足。
- `lines.append("- 决定:超过 30 天的订单退款需要财务主管审批")` 追加在最后一行。注意「30」和「天」之间有个空格,这个细节等会儿会让模型踩一次坑。
- `(root / f"meeting-{i:02d}.md").write_text("\n".join(lines), encoding="utf-8")` `Path` 对象可以用 `/` 拼路径;`{i:02d}` 补零到两位(1 → `01`);`"\n".join(lines)` 相当于 JS 的 `lines.join("\n")`。

</div>

运行 `uv run python -m part03.make_notes`,输出 `生成 40 篇`。用命令行确认一下那条决定在哪:

```bash
# 在 agent-zero-lab/ 下跑
grep -l "决定" workspace/notes/*
grep -n "决定" workspace/notes/meeting-21.md
head -3 workspace/notes/meeting-21.md
```

<div class="line-notes">

- `grep -l "决定" workspace/notes/*` 系统自带的 grep([Day 5](/blog/agent-zero/day-005-terminal-3/) 学过),`-l` 只列出包含这个词的文件名。
- `grep -n "决定" workspace/notes/meeting-21.md` `-n` 带上行号。
- `head -3 workspace/notes/meeting-21.md` 看前 3 行,负责人和日期就在这里。

</div>

```text
workspace/notes/meeting-21.md
42:- 决定:超过 30 天的订单退款需要财务主管审批
# 退款流程 周会纪要 #21
负责人: 张伟
日期: 2026-09-21
```

标准答案就清楚了:决定在 meeting-21 第 42 行,那次会的负责人是张伟。

## 第二步:一组「能用但难用」的工具

下面这组工具,是很多人第一反应会写出来的:把 `ls`、`cat`、`grep` 三个命令包一层,用 Day 168 的注册表登记。功能上没有任何问题,一个耐心的程序员用它完全能找到答案。

```python
# agent-zero-lab/part03/notes_tools_bad.py  能用,但模型用起来很痛苦的一组工具
import re
from pathlib import Path
from typing import Any

from part03.agent_loop import ToolRegistry

ROOT = Path("workspace/notes").resolve()
bad = ToolRegistry()


@bad.tool
def ls() -> dict[str, Any]:
    """列出文件"""
    return {"files": [{"path": str(p), "size": p.stat().st_size, "mtime": p.stat().st_mtime} for p in sorted(ROOT.iterdir())]}


@bad.tool
def cat(f: str) -> dict[str, Any]:
    """读文件"""
    return {"content": Path(f).read_text(encoding="utf-8")}


@bad.tool
def grep(p: str) -> dict[str, Any]:
    """搜索"""
    hits: list[str] = []
    for file in sorted(ROOT.glob("*.md")):
        for n, line in enumerate(file.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(p, line):
                hits.append(f"{file}:{n}:{line}")
    return {"result": hits}
```

<div class="line-notes">

- `from part03.agent_loop import ToolRegistry` Day 168–170 写的注册表。`@bad.tool` 会读函数名、docstring 和参数类型,自动生成 schema(Day 169 的内容)。
- `ROOT = Path("workspace/notes").resolve()` `resolve()` 转成绝对路径。下面 `ls` 和 `grep` 返回的每条记录都会带上这一长串。
- `bad = ToolRegistry()` 起名 `bad`,明天的好版本叫别的名字,两组可以同时存在。
- `def ls() -> dict[str, Any]:` 名字是 Unix 黑话,模型大概猜得到,但说不准列的是哪里的文件。
- `"""列出文件"""` 描述 4 个字。注册表把 docstring 当成 description,所以模型看到的就是这 4 个字。
- `return {"files": [{"path": str(p), "size": p.stat().st_size, "mtime": p.stat().st_mtime}` 每个文件返回绝对路径、字节数、修改时间戳。`mtime` 是 Unix 时间戳(一个浮点秒数),模型用不上。
- `def cat(f: str) -> dict[str, Any]:` 参数叫 `f`,没有描述,生成的 schema 里只有 `{"type": "string"}`。
- `return {"content": Path(f).read_text(encoding="utf-8")}` `Path(f)` 是相对**当前工作目录**解析的,和 `ROOT` 没关系。传文件名 `meeting-21.md` 会找不到,一定要传绝对路径。返回的还是整篇,不分段。
- `def grep(p: str) -> dict[str, Any]:` 参数叫 `p`,pattern 还是 path?模型只能猜。
- `hits: list[str] = []` 收集所有命中的行,没有任何数量上限。
- `for n, line in enumerate(file.read_text(encoding="utf-8").splitlines(), 1):` `enumerate(..., 1)` 让行号从 1 开始,相当于 JS 的 `lines.forEach((line, i) => ...)` 再加 1。
- `if re.search(p, line):` 把模型给的字符串**当正则**用。描述里一个字都没提这是正则。
- `hits.append(f"{file}:{n}:{line}")` 每条命中都带完整的绝对路径。

</div>

## 第三步:站在模型的位置看

先不调模型。把自己当成模型,看看它能拿到什么:工具定义长什么样,每个工具返回多少东西,出错时看到什么。最后一段调一次 DeepSeek,让它告诉我们这些返回值到底是多少 token。

```python
# agent-zero-lab/part03/measure_bad.py  站在模型的位置看看这组工具(只有最后一段调模型数 token)
import json

from common.llm import LLMClient
from part03.notes_tools_bad import ROOT, bad

print("== 模型看到的工具定义")
for s in bad.schemas:
    print(json.dumps(s["function"], ensure_ascii=False))

print("== 直接调用,看返回多大")
out_ls = bad.call("ls", "{}")
print("ls()            ->", len(out_ls), "字符 | 开头", out_ls[:110])
out_grep = bad.call("grep", json.dumps({"p": "退款"}))
print("grep('退款')    ->", len(out_grep), "字符 | 命中", len(json.loads(out_grep)["result"]), "行")
print("grep('退款(')   ->", bad.call("grep", json.dumps({"p": "退款("})))
print("cat('meeting-21.md') ->", bad.call("cat", json.dumps({"f": "meeting-21.md"}))[:120])
full = str(ROOT / "meeting-21.md")
print("cat(绝对路径)   ->", len(bad.call("cat", json.dumps({"f": full}))), "字符")

print("== 让 DeepSeek 数一下 token(只要 1 个输出 token)")
llm = LLMClient()
for name, text in [("ls", out_ls), ("grep('退款')", out_grep)]:
    r = llm.chat([{"role": "user", "content": text}], max_tokens=1)
    print(f"{name:14} prompt_tokens = {r.prompt_tokens}")
print(llm.ledger)
```

<div class="line-notes">

- `for s in bad.schemas:` 注册表生成的 schema 列表,就是 Agent 循环里传给 `tools=` 的东西。
- `print(json.dumps(s["function"], ensure_ascii=False))` 只打印 `function` 那一层(名字、描述、参数)。`ensure_ascii=False` 让中文原样输出,不变成 `列`。
- `out_ls = bad.call("ls", "{}")` 用注册表的 `call` 调,和 Agent 循环里执行工具的路径完全一样,返回的是要塞进 tool 消息的那个字符串。第二个参数是 JSON 字符串,因为模型给的 arguments 就是字符串。
- `out_grep = bad.call("grep", json.dumps({"p": "退款"}))` 搜「退款」,模拟一个用户最自然会想到的关键词。
- `print("grep('退款(')   ->", bad.call("grep", json.dumps({"p": "退款("})))` 故意给一个括号不配对的字符串。模型想搜「退款(30 天)」这类写法时很容易这样传。
- `print("cat('meeting-21.md') ->", bad.call("cat", json.dumps({"f": "meeting-21.md"}))[:120])` 只给文件名,看会怎样。
- `full = str(ROOT / "meeting-21.md")` 拼出绝对路径再读一次。
- `r = llm.chat([{"role": "user", "content": text}], max_tokens=1)` 把工具返回值当成一条消息发过去,只要 1 个输出 token,看 `prompt_tokens` 就知道它在模型那边是多少 token。这是最准的数法,本机的 tokenizer 和服务端不一定一样。

</div>

运行 `uv run python -m part03.measure_bad`:

```text
== 模型看到的工具定义
{"name": "ls", "description": "列出文件", "parameters": {"type": "object", "properties": {}, "required": []}}
{"name": "cat", "description": "读文件", "parameters": {"type": "object", "properties": {"f": {"type": "string"}}, "required": ["f"]}}
{"name": "grep", "description": "搜索", "parameters": {"type": "object", "properties": {"p": {"type": "string"}}, "required": ["p"]}}
== 直接调用,看返回多大
ls()            -> 7677 字符 | 开头 {"files": [{"path": "/private/tmp/claude-501/-Users-minliu/88ea62fa-1615-4df5-9a78-45a67cbdcb31/scratchpad/d17
grep('退款')    -> 70454 字符 | 命中 412 行
grep('退款(')   -> {"error": "error: missing ), unterminated subpattern at position 2"}
cat('meeting-21.md') -> {"error": "FileNotFoundError: [Errno 2] No such file or directory: 'meeting-21.md'"}
cat(绝对路径)   -> 1187 字符
== 让 DeepSeek 数一下 token(只要 1 个输出 token)
ls             prompt_tokens = 3316
grep('退款')     prompt_tokens = 32911
2 次调用 | 输入 36227 / 输出 2 tokens | 约 ¥0.0725
```

先说明一下路径:我是在一个沙箱目录里跑的,`ROOT` 有 122 个字符长,你的路径大概是 `/Users/你/agent-zero-lab/workspace/notes/` 这样,短很多,所以你看到的 `ls` 和 `grep` 字符数会小一些(练习 2 会算出路径占了多少),量级是一样的。

一行一行看模型的处境。

**定义里几乎什么都没有。** 三个描述一共 9 个字。`cat` 的参数 `f` 没有描述,模型不知道该填文件名还是路径;`grep` 的 `p` 也没有,它不知道这是正则。

**一次搜索 3 万多 token。** `grep('退款')` 命中 412 行,70,454 个字符,DeepSeek 数出来是 32,911 个 token。模型真正需要的只是其中一行:`meeting-21.md:42:- 决定:超过 30 天的订单退款需要财务主管审批`,46 个字符。也就是说返回值里 99.9% 是噪音。按高峰价,这一次工具返回光读进去就要 32,911 × 2 ÷ 100 万 ≈ 0.066 元,而且之后每一轮调用它都还在历史里。

**`ls` 一次 3 千多 token,大半是路径和时间戳。** 40 条记录,每条带 122 个字符的绝对路径、字节数和一个像 `1792624099.92` 这样的时间戳,模型一个都用不上。

**报错是给程序员看的。** `missing ), unterminated subpattern at position 2` 说的是正则语法,模型如果不知道自己的参数被当成正则,很难从这句话猜出该怎么改。`FileNotFoundError` 只说找不到,不说「要传绝对路径」或者「可用的文件名是 meeting-01.md 到 meeting-40.md」。

## 第四步:让 Agent 真的去用

光看不够,得让 Agent 实际拿着它干一次活。用 Day 170 的循环,我这里的版本每一步都打印输入输出 token 和每个工具返回的大小。你的 `agent_loop.py` 写法可能和我的不完全一样,关键是这两行打印,没有就加上:

```python
# agent-zero-lab/part03/agent_loop.py  (Day 170 建的;只列出 run_agent,ToolRegistry 部分不变)
def run_agent(registry: ToolRegistry, system: str, user: str, max_steps: int = 10) -> tuple[str, LLMClient]:
    llm = LLMClient()
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    for step in range(1, max_steps + 1):
        r = llm.chat(messages, tools=registry.schemas)
        messages.append(r.message)  # model_dump 出来的完整消息,reasoning_content/tool_calls 都在
        calls = r.message.get("tool_calls") or []
        print(f"[step {step}] 输入 {r.prompt_tokens} tok | 输出 {r.completion_tokens} tok")
        if not calls:
            return r.content, llm
        for tc in calls:
            name, args = tc["function"]["name"], tc["function"]["arguments"]
            out = registry.call(name, args)
            print(f"    调用 {name}({args}) -> 返回 {len(out)} 字符")
            messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})
    return f"到了最大步数 {max_steps} 还没做完", llm
```

<div class="line-notes">

- `def run_agent(registry: ToolRegistry, system: str, user: str, max_steps: int = 10) -> tuple[str, LLMClient]:` 返回最终回答和 `LLMClient`,后者带着整次任务的账本 `ledger`。
- `r = llm.chat(messages, tools=registry.schemas)` 每一步都把完整的 messages 和全部工具定义发过去。`.env` 里默认关思考。
- `messages.append(r.message)  # model_dump 出来的完整消息` 用 SDK 返回的完整消息,`tool_calls` 和(开思考时的)`reasoning_content` 都在里面。DeepSeek 开思考带工具时少了 `reasoning_content` 会 400,用完整消息就不用操心。
- `calls = r.message.get("tool_calls") or []` 字典的 `.get` 取不到返回 `None`,`or []` 让它变成空列表,相当于 JS 的 `msg.tool_calls ?? []`。
- `print(f"[step {step}] 输入 {r.prompt_tokens} tok | 输出 {r.completion_tokens} tok")` 今天最重要的一行:每一步的输入 token。工具返回值越大,下一步的这个数越大。
- `if not calls:` 模型不再调工具,说明它要给最终回答了,循环结束。
- `print(f"    调用 {name}({args}) -> 返回 {len(out)} 字符")` 打印每个工具的参数和返回大小,读轨迹时一眼能看出哪个工具在灌水。
- `messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})` 回传结果,`tool_call_id` 对上这次调用(Day 159)。
- `return f"到了最大步数 {max_steps} 还没做完", llm` 步数上限,防止它在一组难用的工具里无限打转(Day 170)。

</div>

然后是今天的实验脚本:

```python
# agent-zero-lab/part03/run_bad.py  让 Agent 用这组难用的工具去找一条会议决定
from part03.agent_loop import run_agent
from part03.notes_tools_bad import bad

SYSTEM = "你是团队助理,可以用工具查会议纪要。回答要说出依据在哪篇纪要。"
QUESTION = "之前开会对超过 30 天的订单退款是怎么定的?谁负责的那次会?"

answer, llm = run_agent(bad, SYSTEM, QUESTION, max_steps=8)
print("== 回答\n" + answer)
print("== 账单", llm.ledger)
```

<div class="line-notes">

- `SYSTEM = "你是团队助理,可以用工具查会议纪要。回答要说出依据在哪篇纪要。"` system prompt 故意写得很普通,不教它怎么用这三个工具。真实项目里,工具好不好用不应该靠 system prompt 去补。
- `QUESTION = "之前开会对超过 30 天的订单退款是怎么定的?谁负责的那次会?"` 两问:决定是什么,负责人是谁。第二问逼它必须打开那篇纪要看开头。
- `answer, llm = run_agent(bad, SYSTEM, QUESTION, max_steps=8)` 最多 8 步,够它找到了。
- `print("== 账单", llm.ledger)` 整个任务的调用次数、输入输出 token 和花费。

</div>

运行 `uv run python -m part03.run_bad`。我跑了三遍,第一遍的完整输出:

```text
[step 1] 输入 368 tok | 输出 54 tok
    调用 ls({}) -> 返回 7677 字符
    调用 grep({"p": "30天"}) -> 返回 14 字符
[step 2] 输入 3757 tok | 输出 79 tok
    调用 grep({"p": "退款"}) -> 返回 70454 字符
    调用 grep({"p": "超过.*天"}) -> 返回 180 字符
[step 3] 输入 36842 tok | 输出 107 tok
    调用 cat({"f": "/private/tmp/claude-501/-Users-minliu/88ea62fa-1615-4df5-9a78-45a67cbdcb31/scratchpad/d178/agent-zero-lab/workspace/notes/meeting-21.md"}) -> 返回 1187 字符
[step 4] 输入 37741 tok | 输出 188 tok
== 回答
找到了。

**结论：超过 30 天的订单退款，需要财务主管审批。**

依据在 **《退款流程 周会纪要 #21》**（notes/meeting-21.md）的最后一条决定：
> 决定:超过 30 天的订单退款需要财务主管审批

**那次会的负责人是张伟**，会议日期为 2026-09-21（见该纪要抬头的“负责人: 张伟”“日期: 2026-09-21”）。

补充两点说明：
- 我在全部 40 篇纪要中搜索“超过…天”这类表述，只有 #21 这一篇出现了该决定，其他纪要没有对这条规则做过修订或推翻。
- 不过 #21 里只写了“财务主管审批”，没有指定具体由谁审批，也没有写审批时效。如果你需要这些细节，可能得另找财务侧的文件确认。
== 账单 4 次调用 | 输入 78708 / 输出 428 tokens | 约 ¥0.0806
```

(模型的回答里用的是全角标点,我原样贴的。)

另外两遍只看工具调用和账单:

```text
# 第二遍
[step 1] 输入 368 tok | 输出 55 tok
    调用 grep({"p": "退款"}) -> 返回 70454 字符
    调用 ls({}) -> 返回 7677 字符
[step 2] 输入 36660 tok | 输出 108 tok
    调用 cat({"f": "/private/tmp/.../workspace/notes/meeting-21.md"}) -> 返回 1187 字符
[step 3] 输入 37560 tok | 输出 218 tok
== 账单 3 次调用 | 输入 74588 / 输出 381 tokens | 约 ¥0.0792
# 第三遍
[step 1] 输入 368 tok | 输出 55 tok
    调用 grep({"p": "30"}) -> 返回 7192 字符
    调用 ls({}) -> 返回 7677 字符
[step 2] 输入 7098 tok | 输出 118 tok
    调用 cat({"f": "/private/tmp/.../workspace/notes/meeting-21.md"}) -> 返回 1187 字符
[step 3] 输入 8008 tok | 输出 210 tok
== 账单 3 次调用 | 输入 15474 / 输出 383 tokens | 约 ¥0.0190
```

(第二、三遍的路径我用 `...` 缩短了,实际和第一遍一样长。)

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="第一遍每一步的输入 token">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">第一遍:每一步发给模型的输入 token</text>
  <text x="70" y="62" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">step 1</text>
  <rect x="80" y="48" width="5" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="92" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">368(问题 + 三个工具定义)</text>
  <text x="70" y="100" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">step 2</text>
  <rect x="80" y="86" width="50" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="138" y="100" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3,757(+ ls 的 7,677 字符)</text>
  <text x="70" y="138" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">step 3</text>
  <rect x="80" y="124" width="491" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="560" y="160" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">36,842(+ grep('退款') 的 70,454 字符)</text>
  <text x="70" y="190" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">step 4</text>
  <rect x="80" y="176" width="503" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="560" y="214" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">37,741 · 四步合计 78,708,真正有用的是 46 个字符</text>
</svg>
<figcaption>输入 token 一旦被某个工具返回值撑大,后面每一步都背着它。琥珀色那两步的大头都是 grep('退款') 那 412 行。条长按 75 个 token 一个像素画。</figcaption>
</figure>

三遍都答对了:决定、负责人、日期,还引用了原文。**所以这组工具「能用」**,这正是它危险的地方:你测一下发现能跑通,就上线了。但看账单:

同一个问题,三遍的输入 token 是 78,708、74,588、15,474,差了五倍。差别全在第一步模型选了什么关键词。搜「退款」就背上 3 万多 token,搜「30」只有 7 千字符。一个工具的成本取决于模型这一次碰巧怎么用它,这本身就是设计问题:好的工具应该让「自然的用法」也是便宜的用法。

第一遍里还有两个细节,都是工具设计造成的。

**模型搜「30天」什么都没搜到。** 返回 14 个字符,就是 `{"result": []}`。原文写的是「30 天」,中间有空格。`grep` 是逐字匹配,不做任何宽容处理,而模型又不知道它是逐字匹配的。它接着改用正则 `超过.*天` 才找到,这次是它运气好猜到了 `grep` 支持正则。

**每一遍都调了 `ls`,而且都是为了拿绝对路径。** 三遍里模型都在第一步就调了 `ls`,然后在 `cat` 里原样填了那一长串绝对路径。它从 `ls` 的返回里学到了「`cat` 要这种路径」,这个推断是对的,但代价是每次多背 3 千多 token。如果 `cat` 接受文件名,`ls` 根本不需要调。

## 难用工具清单

把今天看到的问题整理成一张表。这张表就是明天改造的输入,每一行对应 [Day 182](/blog/agent-zero/day-182-tool-design-2/) 六条原则里的一条:

| 问题 | 今天看到的现象 | 根子在哪 |
| --- | --- | --- |
| 按命令设计,不按任务设计 | 找一条决定要 `ls` + `grep` + `cat` 三四步 | 人找纪要是「搜关键词 → 看命中的那段」,工具却是「列出全部 → 读全部」 |
| 名字是黑话 | `ls`、`cat`、`grep` 不说清是哪里的文件、搜内容还是文件名 | 名字没带领域,将来工具一多(工单、订单、知识库都有 search)更乱 |
| 描述等于没写 | 三个描述共 9 个字 | 没说什么时候用、参数什么意思、有什么限制 |
| 参数名猜不出来 | `f`、`p` 没有描述;`cat` 只认绝对路径 | 参数按实现起名,不按使用者起名 |
| 返回值没有上限 | `grep('退款')` 412 行、32,911 token,有用的 46 个字符 | 没有条数上限、没有截断提示、没有「还有多少条」 |
| 返回值全是噪音字段 | 每条都带 122 字符的绝对路径;`ls` 带字节数和时间戳 | 把底层数据原样吐出来,没想模型要什么 |
| 搜索太死 | 「30天」搜不到「30 天」 | 逐字正则匹配,没做空格和大小写的宽容 |
| 报错不指导下一步 | `unterminated subpattern`、`FileNotFoundError` | 报错是给程序员看的,没说正确格式和可用取值 |
| 成本随用法剧烈波动 | 同一个问题 15,474 到 78,708 token | 最自然的用法恰好是最贵的用法 |

Anthropic 那篇文章里有两个细节可以直接对上这张表:他们建议别返回 `uuid`、`mime_type` 这类底层技术标识,能换成有语义的名字就换;Claude Code 默认把单次工具返回限制在 25,000 token。我们的 `grep` 一次就超过了这个上限。

最后说一下「怎么知道工具难用」这件事本身。今天用的办法就是 ACI 的基本功:**读轨迹**。不是看最终回答对不对,而是看每一步调了什么、参数是什么、返回多大、下一步输入涨了多少。最终回答对了的任务,轨迹里照样能看出一堆问题。这个习惯在第六部分做可观测时会变成一整套工具,今天先用两行 `print` 养成。

## 动手练习

### 练习 1:工具定义本身占多少 token

每次请求都要带上全部工具定义。写一个 `schema_tokens.py`:同一句「你好」,不带工具和带上这 3 个坏工具各发一次(`max_tokens=1`),用 `prompt_tokens` 的差算出工具定义占了多少 token。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/schema_tokens.py  练习 1:三个工具的定义本身占多少 token
from common.llm import LLMClient
from part03.notes_tools_bad import bad

msgs = [{"role": "user", "content": "你好"}]
llm = LLMClient()
without = llm.chat(msgs, max_tokens=1)
with_tools = llm.chat(msgs, max_tokens=1, tools=bad.schemas)
print("不带工具", without.prompt_tokens, "| 带 3 个工具", with_tools.prompt_tokens,
      "| 工具定义约占", with_tools.prompt_tokens - without.prompt_tokens, "token")
print(llm.ledger)
```

<div class="line-notes">

- `without = llm.chat(msgs, max_tokens=1)` 只要 1 个输出 token,花费几乎全是输入,便宜。实测 `prompt_tokens` 是 5。
- `with_tools = llm.chat(msgs, max_tokens=1, tools=bad.schemas)` 同一句话带上工具,实测 333。
- `"| 工具定义约占", with_tools.prompt_tokens - without.prompt_tokens, "token")` 差值 328。

</div>

运行 `uv run python -m part03.schema_tokens`:

```text
不带工具 5 | 带 3 个工具 333 | 工具定义约占 328 token
2 次调用 | 输入 338 / 输出 2 tokens | 约 ¥0.0007
```

三个工具的 JSON 定义加起来不到 300 个字符,却多了 328 个 token。多出来的不全是我们写的 schema:服务端在带工具的请求里会把工具定义套进一段固定的模板(告诉模型有哪些工具、怎么输出调用),这段模板本身也占 token。所以 `run_bad` 第一步的输入是 368(328 加上 system prompt 和问题)。工具越多,这个固定开销越大,Day 184 会专门量 60 个工具的情况。

</details>

### 练习 2:绝对路径占了多少

`grep('退款')` 的 70,454 个字符里,有多少是那串绝对路径?写一个 `strip_paths.py`,把每条命中前面的 `ROOT/` 去掉只留文件名,比较前后大小;再只留含「决定」的那一条,看真正有用的有多大。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/strip_paths.py  练习 2:grep 的返回里有多少是绝对路径
import json

from part03.notes_tools_bad import ROOT, bad

hits: list[str] = json.loads(bad.call("grep", json.dumps({"p": "退款"})))["result"]
prefix = str(ROOT) + "/"
short = [h.removeprefix(prefix) for h in hits]
full_size = len(json.dumps({"result": hits}, ensure_ascii=False))
short_size = len(json.dumps({"result": short}, ensure_ascii=False))
print("ROOT 长度", len(prefix), "| 命中", len(hits), "行")
print("原样", full_size, "字符 | 只留文件名", short_size, "字符 | 省了", f"{1 - short_size / full_size:.0%}")
print("第一条:", short[0])
only_decision = [h for h in short if "决定" in h]
print("真正有用的:", only_decision, len(json.dumps(only_decision, ensure_ascii=False)), "字符")
```

<div class="line-notes">

- `hits: list[str] = json.loads(bad.call("grep", json.dumps({"p": "退款"})))["result"]` 走注册表调用拿到字符串,再 `json.loads` 解析回列表,和模型拿到的完全是同一份数据。
- `prefix = str(ROOT) + "/"` 我这里是 122 个字符。
- `short = [h.removeprefix(prefix) for h in hits]` `removeprefix` 去掉开头的那段(Python 3.9 起有),相当于 JS 的 `h.startsWith(p) ? h.slice(p.length) : h`。
- `full_size = len(json.dumps({"result": hits}, ensure_ascii=False))` 用和注册表一样的方式序列化再量,保证和 70,454 对得上。
- `print("原样", full_size, "字符 | 只留文件名", short_size, "字符 | 省了", f"{1 - short_size / full_size:.0%}")` `:.0%` 把小数格式化成不带小数位的百分比,0.713 → `71%`。
- `only_decision = [h for h in short if "决定" in h]` 字符串的 `in` 是子串判断,相当于 JS 的 `h.includes("决定")`。

</div>

运行 `uv run python -m part03.strip_paths`:

```text
ROOT 长度 122 | 命中 412 行
原样 70454 字符 | 只留文件名 20190 字符 | 省了 71%
第一条: meeting-01.md:5:- 第 1 条讨论:关于退款流程的细节,结论是需要客户确认
真正有用的: ['meeting-21.md:42:- 决定:超过 30 天的订单退款需要财务主管审批'] 46 字符
```

在我这个长路径下,路径占了 71%。你的路径如果是 40 个字符左右,412 行 × 少 80 个字符 ≈ 少 3 万多字符,原样大概在 3 万 7 千字符上下,路径占比会低一些。但就算去掉全部路径,还剩 20,190 个字符,真正有用的只有 46 个。去路径只是减肥,真正的问题是「没有上限地返回所有命中」。

</details>

### 练习 3:审一个你会在真实项目里遇到的工具

下面是一个「后端同事顺手包出来」的查客户工具。不调模型,站在模型的位置列出它所有难用的地方,对照今天的清单分类。然后运行它,看用客户名去查会发生什么。

```python
# agent-zero-lab/part03/customer_tool_bad.py  练习 3:一个「后端同事顺手包出来」的查客户工具
import json
from typing import Any

from part03.agent_loop import ToolRegistry

reg = ToolRegistry()
ROW: dict[str, Any] = {
    "id": "8f14e45f-ceea-467f-a0e6-1b2c3d4e5f60", "tenant_id": "t_01", "name": "杭州青禾科技",
    "plan_code": 2, "billing_cycle": "Y", "seats": 3, "status": 4, "created_at": 1767225600,
    "updated_at": 1792624099, "deleted": 0, "stripe_cus": "cus_Q8xY2", "tax_rate_bp": 600,
    "coupon_id": None, "owner_uid": 1042, "region": "cn-east-1", "ext": "{\"legacy\":true}",
}


@reg.tool
def get(id: str) -> dict[str, Any]:
    """获取"""
    if id != ROW["id"]:
        raise KeyError(id)
    return ROW


if __name__ == "__main__":
    print(json.dumps(reg.schemas[0]["function"], ensure_ascii=False))
    print(reg.call("get", json.dumps({"id": "杭州青禾科技"})))
    print(len(reg.call("get", json.dumps({"id": ROW["id"]}))), "字符")
```

<div class="line-notes">

- `ROW: dict[str, Any] = {` 模拟数据库里的一行原始记录,字段名就是表的列名。
- `"plan_code": 2, "billing_cycle": "Y", "seats": 3, "status": 4,` 套餐、计费周期、状态全是编码,含义只在后端代码里。
- `def get(id: str) -> dict[str, Any]:` 名字叫 `get`,参数叫 `id`。`id` 还和 Python 内置函数重名,能跑,但不推荐。
- `raise KeyError(id)` 找不到就抛异常,注册表会把它变成 `{"error": "KeyError: ..."}` 回给模型。
- `print(reg.call("get", json.dumps({"id": "杭州青禾科技"})))` 模拟模型最自然的用法:用户说了客户名,模型就拿名字去查。

</div>

<details><summary>参考答案</summary>

运行 `uv run python -m part03.customer_tool_bad`:

```text
{"name": "get", "description": "获取", "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}}
{"error": "KeyError: '杭州青禾科技'"}
350 字符
```

一个示范的审查结果,按今天的清单分类:

- **按接口设计,不按任务设计**:只能按 UUID 查,但用户只会说客户名。模型手里没有 UUID,第一步就卡住,除非再给它一个「列出所有客户」的工具,那又回到了 `ls` 的老路。
- **名字是黑话**:`get` 不说获取什么。以后有了工单、发票,三个 `get` 模型怎么分?
- **描述等于没写**:「获取」两个字,没说要传什么、返回什么。
- **参数名猜不出来**:`id` 是客户 UUID、客户编号还是名字?实测模型传名字直接报错。
- **返回值全是噪音**:16 个字段里,`tenant_id`、`deleted`、`stripe_cus`、`owner_uid`、`region`、`ext` 对回答客户问题基本没用;`created_at` 是时间戳,模型要自己换算日期,容易算错。
- **编码不解释**:`plan_code: 2`、`status: 4`、`billing_cycle: "Y"`、`tax_rate_bp: 600`,模型只能猜「2 是专业版?」「600 个基点是 6%?」。猜错了,后面算退款全错。
- **报错不指导下一步**:`KeyError: '杭州青禾科技'` 没说「要传 UUID」,也没说「可以先用 xxx 工具按名字搜」。

这一行只有 350 个字符,看起来不大,所以容易被放过。但它的问题和大小无关:模型拿着它根本完成不了「按名字查客户」这个最常见的任务,拿到数据也读不懂。改造的方向明天讲:按名字搜、编码翻译成「专业版 / 年付 / 已暂停」这样的文字、只返回回答问题需要的字段、报错里写清楚下一步。

</details>

**验收标准:** 自己跑出 `measure_bad.py` 和三遍 `run_bad.py` 的数字,填出「三遍各多少输入 token、各调了哪些工具」;不看文章能列出这组坏工具至少六个问题,每个问题都能指着轨迹里的一行说出证据。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| ACI(Agent-Computer Interface) | 为 Agent 设计的计算机界面,和 HCI(人机界面)对应。2024 年 SWE-agent 论文提出,核心是「Agent 是一种新的用户」 |
| SWE-agent | 普林斯顿做的改代码 Agent 和同名论文,ACI 这个概念就出自这里 |
| 工具契约 | Anthropic 的说法:工具是确定性系统和非确定性 Agent 之间的约定,名字、描述、参数、返回值都是约定的一部分 |
| 读轨迹 | 不只看最终回答,而是逐步看每次调了什么工具、参数、返回大小、输入 token 涨了多少 |
| 噪音字段 | 返回值里模型推理用不上的字段,比如绝对路径、时间戳、UUID、内部编码 |
| 返回值上限 | 一次工具调用最多返回多少条或多少 token。SWE-agent 的搜索最多 50 条,Claude Code 默认 25,000 token |
| 逐字匹配 | 搜索时一个字符一个字符地比,「30天」和「30 天」就是两个不同的串 |
| 工具定义开销 | 每次请求都要带上的工具 schema 加上服务端模板占用的输入 token,今天 3 个小工具约 328 个 |

## 常见误区

**能跑通就是好工具。** 今天三遍都答对了,但一个只需要 46 个字符信息的问题,花了最多 78,708 个输入 token。功能正确只是及格线,ACI 关心的是模型用它的代价和稳定性。

**只测一次就下结论。** 同一个问题三遍差了五倍的 token,取决于模型第一步碰巧搜了什么词。工具改没改好,要多跑几遍看范围。

**工具返回原样透传底层数据。** 绝对路径、字节数、时间戳、UUID、状态码,对写代码的人有用,对模型大多是噪音,还要按 token 付钱,并且在后面每一轮里重复付。

**靠 system prompt 弥补工具的问题。** 在 system 里写「cat 要传绝对路径」「grep 支持正则」也能让它少走弯路,但这是把工具的说明书写到了别处。工具一换、system 一改就失效,而且每次请求都多一份 token。说明应该写在工具自己的描述和参数里。

**以为报错信息模型都能看懂。** `unterminated subpattern at position 2` 对知道这是正则的人才有意义。报错要告诉它错在哪、正确格式是什么、下一步该干什么。

**只看最终回答,不读轨迹。** 回答对了,轨迹里照样有「搜 30天 落空」「每次都调 ls 拿路径」这些浪费。习惯在 Agent 循环里打印每一步的输入 token 和工具返回大小。

## 学习资料

### 文档与文章

- [Anthropic · Writing effective tools for agents — with agents](https://www.anthropic.com/engineering/writing-tools-for-agents):2025 年 9 月,这三天的核心读物。今天先读开头到「Choosing the right tools for agents」之前,理解「工具是契约」这个视角,30 分钟,英文。
- [SWE-agent 论文](https://arxiv.org/abs/2405.15793):ACI 的出处。不用读全文,看第 2 节讲 ACI 设计原则的部分,搜索 50 条、文件窗口 100 行、linter 护栏的数字都在这里,英文。
- [SWE-agent 文档 · ACI](https://swe-agent.com/latest/background/aci/):官方文档对 ACI 的简短解释,比论文好读,10 分钟,英文。
- [Claude 文档 · 定义工具](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools):「Best practices for tool definitions」一节,先扫一眼,Day 182 会细讲。
- [Anthropic · Building effective agents](https://www.anthropic.com/research/building-effective-agents):附录 2「Prompt engineering your tools」讲的就是 ACI,里面「花在 ACI 上的功夫应该和花在 HCI 上的一样多」这个说法值得记住,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aaxyz8ELY&p=15&autoplay=0&high_quality=1" title="(中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程,附示例代码!_deeplearning.ai" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达机器学习 · (中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程 · 第 15 P「创建工具」,5 分钟,讲工具描述怎么写模型才会正确选用。可以接着看第 14 P「什么是工具」。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ymrCBeESA&autoplay=0&high_quality=1" title="【Agent入门】3.工具调用实现原理" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>花里胡哨的汤无际 · 【Agent入门】3.工具调用实现原理 · 39 分钟,讲工具定义怎么被渲染进提示词。看完就明白练习 1 里那 328 个 token 是从哪来的,也明白描述的每个字为什么都会影响模型。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RJ6NN8Y-xok" title="SWE-agent: A deep dive" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Ofir Press · SWE-agent: A deep dive · 论文作者之一亲自讲 SWE-agent 和 ACI 的设计,重点看他讲搜索和文件查看命令为什么要限制返回量的那部分,英文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · Anthropic 工程师的圆桌对话,里面谈到「站在模型的角度看工具和上下文」这个习惯,和今天的主题直接相关,英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 部分的「Tools」一节,讲工具清单怎么选、工具多了模型为什么会变差。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly, 2024):讲对话式 Agent 的章节里有工具使用的部分,从「工具定义也是提示词」的角度讲,两位作者参与过 GitHub Copilot 的开发,英文。

### 开源项目与代码

- [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent):看 `tools/` 目录下几个搜索和查看文件的工具怎么写描述、怎么截断返回值,对照今天的坏工具看差别。
- [anthropics/claude-cookbooks · tool_use](https://github.com/anthropics/claude-cookbooks/tree/main/tool_use):官方工具调用示例集,看他们自己的工具描述写多长。

## 自测

1. 工具和普通 REST API 的使用者有什么不同?举两个具体的差别。

<details><summary>答案</summary>

API 的使用者是程序员,能看文档、读源码、问同事、多试几次,学会了还记得;工具的使用者是模型,每次请求从零开始,能看到的只有名字、描述和参数。差别一:返回值大小,程序员拿到 5 万字符能 Ctrl+F,模型要全部读进上下文按 token 付钱,还会在后面每一轮重复出现;差别二:模型照字面理解,参数叫 `f` 它只能猜,报错看不懂它只能换参数瞎试。

</details>

2. ACI 是什么?出自哪里?

<details><summary>答案</summary>

Agent-Computer Interface,为 Agent 设计的计算机界面,和人机界面 HCI 对应。出自 2024 年普林斯顿的 SWE-agent 论文,核心观点是 Agent 是一种新的终端用户,需要专门为它设计的命令和反馈,比如搜索最多返回 50 条、看文件一次 100 行、编辑后用 linter 拦住语法错误。

</details>

3. 今天三遍 `run_bad` 都答对了,为什么还说这组工具难用?

<details><summary>答案</summary>

因为代价:一个只需要 46 个字符信息的问题,输入 token 最多花了 78,708 个,而且三遍之间差了五倍,取决于模型碰巧搜了什么词。轨迹里还有「搜 30天 落空」「每次都要先 ls 拿绝对路径」这些浪费。能用只是及格,好用要看模型用它的成本和稳定性。

</details>

4. 模型搜「30天」为什么一条都没搜到?这暴露了工具设计的什么问题?

<details><summary>答案</summary>

原文是「30 天」,中间有个空格,而 `grep` 是逐字匹配。问题有两层:搜索本身太死,没做空格这类宽容处理;描述里也没告诉模型它是逐字(正则)匹配,模型无从得知要换写法。

</details>

5. 为什么每次请求都带的工具定义也要算成本?今天 3 个工具大约多少?

<details><summary>答案</summary>

Agent 循环每一步都会把全部工具定义发一遍,它们按输入 token 计费。实测「你好」不带工具 5 个 token,带上 3 个坏工具 333 个,多了 328 个,其中一部分是服务端套在工具定义外面的固定模板。工具越多这个开销越大。

</details>

6. (面试题)你接手一个 Agent,同事说「功能都好的,就是有点贵、偶尔慢」。你会先看什么?

<details><summary>答案</summary>

要点:①先读轨迹,而不是先改提示词或换模型:每一步调了哪个工具、参数是什么、返回多大、下一步输入 token 涨了多少;②重点找三类问题:某个工具返回值特别大(没有上限、带噪音字段)、某个工具总被连续调用(按命令设计而不是按任务,或者报错不指导纠正导致重试)、同一个任务 token 波动很大(工具成本取决于模型怎么用);③同一个任务多跑几遍看范围;④改工具时先改返回值上限和字段,这通常是最大的一笔;⑤改完用同一批任务对比前后的 token 和成功率,而不是凭感觉。

</details>

## 明天预告

明天是 **Day 181 · 第 26 周复习:工具与 Agent 循环(Day 175–180)**。这一周从 ReAct 的 Thought 去哪了讲起,经过 Plan-and-Execute、待办清单和反思、思考档位、投票和验证器,最后落到「工具不是 API」。复习日把这六天串成一张知识地图,默写 `effort_sweep.py` 的核心部分并跑通,整理这周踩过的坑(全角冒号就是其中之一)。今天这张难用工具清单先留着,复习日之后的 Day 182 会逐条改造它。
