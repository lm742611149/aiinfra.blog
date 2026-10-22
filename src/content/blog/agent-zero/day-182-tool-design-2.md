---
title: 'Day 182 · 好工具(二):六条原则'
description: '拿着 Day 180 那张难用工具清单,按六条原则一条一条改会议纪要工具:按任务设计、名字带命名空间、描述写四句话、参数能枚举就枚举并且宽进严出、返回值有上限有提示、报错告诉模型下一步。每改一条就用同一组输入探一次,看「搜退款」的返回从 70,454 个字符缩到 454 个,顺带踩一次工具重名的 400。'
pubDate: 2026-10-22
regime: none
tags: ['tool-design', 'aci', 'function-calling', 'agent-zero']
series: 'agent-zero'
day: 182
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 181](/blog/agent-zero/day-181-week26-review/) 是复习日,把这一周串成了一张图:让模型把事做对,力气可以花在模型内部(思考档位)、模型外部(投票)、代码结构(计划和待办清单)和工具上。小项目「先便宜地问三次、不一致再开思考」准确率够了,却比每题都开 low 还贵 38%,又一次说明在同一个模型上多花算力不划算,该回头把工具做好。

[Day 180](/blog/agent-zero/day-180-tool-design-1/) 留下了一张「难用工具清单」:按命令设计、名字是黑话、描述 9 个字、参数叫 `f` 和 `p`、返回值没有上限、全是噪音字段、「30天」搜不到「30 天」、报错看不懂、成本随用法剧烈波动。今天就拿这张清单开刀。

## 今天要解决的问题

学完你应该能:

1. 说出工具设计的六条原则,每一条都能指着 Day 180 轨迹里的一个现象说「这条就是为了解决它」。
2. 把 Day 180 的 `ls` / `cat` / `grep` 一步步改成 `notes_search` 和 `notes_read`,每改一步都用同一组输入验证效果。
3. 用 `Annotated` 给参数写说明、用 `Literal` 做枚举,让 Day 169 的注册表自动生成带 `description` 和 `enum` 的 schema。
4. 写出能指导模型改正的返回值和报错:总数、截断提示、翻页位置、「你是不是想找」。

预计用时 2.5 小时。前置:[Day 168](/blog/agent-zero/day-168-tool-registry-1/) 和 [Day 169](/blog/agent-zero/day-169-tool-registry-2/)(`ToolRegistry`,今天会用到它对 `Annotated` 和 `Literal` 的支持)、[Day 180](/blog/agent-zero/day-180-tool-design-1/)(40 篇会议纪要和坏工具,今天直接用它的 `workspace/notes/`)。代码在 `agent-zero-lab/part03/`,命令都在 `agent-zero-lab/` 根目录跑。今天大部分步骤直接调用工具函数,不调模型,不花钱;调模型的只有两个小脚本,加上练习一共花了不到五分钱。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把六条原则各写一句话,再默写 `notes_search`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先搭一个探针

今天要把同一个文件 `part03/notes_tools_good.py` 改六遍。每改一遍,都想知道「这一条原则到底改变了什么」。所以先写一个固定的探针:用同一组六个输入调用工具,打印每次返回多少字符、开头长什么样。不调模型,随便跑。

六个输入是从 Day 180 的轨迹里挑的,每个都对应清单上的一个问题:

- 搜「退款」:最自然的关键词,Day 180 返回了 70,454 个字符;
- 搜「退款 审批」:两个词,看工具认不认「同时出现」;
- 搜「退钱」:一个搜不到的同义词,看搜不到时模型能拿到什么;
- 读 meeting-21 的第 40 行起 5 行:那条决定在第 42 行;
- 读「3」:模型从标题「周会纪要 #3」推断笔记名时很自然会这么写;
- 读「meetng-03」:拼错了一个字母。

```python
# agent-zero-lab/part03/probe_good.py  不调模型,用同一组输入探一探好工具,每改一条原则跑一次
import json

from part03.notes_tools_good import good

s_name, r_name = [s["function"]["name"] for s in good.schemas]
CASES = [
    (s_name, {"query": "退款"}),
    (s_name, {"query": "退款 审批"}),
    (s_name, {"query": "退钱"}),
    (r_name, {"note": "meeting-21", "start_line": 40, "max_lines": 5}),
    (r_name, {"note": "3", "max_lines": 3}),
    (r_name, {"note": "meetng-03"}),
]
for name, args in CASES:
    out = good.call(name, json.dumps(args, ensure_ascii=False))
    show = out if len(out) <= 160 else out[:160] + "…"
    print(f"{name}({json.dumps(args, ensure_ascii=False)}) -> {len(out)} 字符\n    {show}")
```

<div class="line-notes">

- `from part03.notes_tools_good import good` 今天要一直改的那个文件,`good` 是里面的注册表。还没建这个文件的话先往下看第一条原则。
- `s_name, r_name = [s["function"]["name"] for s in good.schemas]` 从注册表里取出两个工具的名字,第一个是搜索,第二个是读取。这样写是因为第二条原则会给工具改名,探针不用跟着改。左边两个变量接收一个两元素的列表,相当于 JS 的 `const [sName, rName] = ...`。
- `CASES = [` 每一项是「工具名 + 参数字典」的二元组。
- `(r_name, {"note": "meeting-21", "start_line": 40, "max_lines": 5}),` 第一版就有 `start_line` 和 `max_lines` 两个参数,下面会讲为什么。
- `out = good.call(name, json.dumps(args, ensure_ascii=False))` 走注册表的 `call`,和 Agent 循环里执行工具一模一样:参数是 JSON 字符串,返回的也是要塞进 tool 消息的字符串。
- `show = out if len(out) <= 160 else out[:160] + "…"` 太长的只看前 160 个字符,字符数照样打全。Python 的 `a if 条件 else b` 相当于 JS 的 `条件 ? a : b`。

</div>

## 原则一:按任务设计,不按命令设计

Day 180 的模型找一条会议决定,要先 `ls` 拿路径,再 `grep` 拿到四百多行,再 `cat` 读整篇。这是程序员在终端里的操作习惯,不是找纪要的习惯。

想一想一个人在公司的文档系统里找「之前开会怎么定的」:他在搜索框里敲几个关键词,看搜索结果里命中的那一行,点进去看那一段的上下文。**两步:搜,然后读命中位置附近的一段。** 没有人先把全部文件列一遍。

Anthropic 那篇[《Writing effective tools for agents》](https://www.anthropic.com/engineering/writing-tools-for-agents)举的例子是同一个道理:与其给一个 `list_contacts` 让 Agent 把几千个联系人全读一遍,不如给一个 `search_contacts`。判断标准就一句话:**一个熟练的人做这个任务时会怎么操作,工具就照着这个操作来切。**

所以三个命令合成两个工具:`search` 只告诉你「哪篇、第几行、那一行写的是什么」,`read` 只读你指定的那一段。第一版先只做这一件事,其他问题(名字、描述、上限)一个都不改,这样才看得出这一条原则单独带来了什么。

```python
# agent-zero-lab/part03/notes_tools_good.py  第一版:按任务拆成「搜」和「读一段」
from pathlib import Path
from typing import Any

from part03.agent_loop import ToolRegistry

ROOT = Path("workspace/notes").resolve()
good = ToolRegistry()


@good.tool
def search(query: str) -> dict[str, Any]:
    """搜索"""
    hits: list[dict[str, Any]] = []
    for path in sorted(ROOT.glob("*.md")):
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if query in line:
                hits.append({"note": path.stem, "line": n, "text": line})
    return {"hits": hits}


@good.tool
def read(note: str, start_line: int = 1, max_lines: int = 40) -> dict[str, Any]:
    """读取"""
    lines = (ROOT / f"{note}.md").read_text(encoding="utf-8").splitlines()
    chunk = lines[start_line - 1:start_line - 1 + max_lines]
    return {"note": note, "lines": [f"{i}: {s}" for i, s in enumerate(chunk, start_line)]}
```

<div class="line-notes">

- `ROOT = Path("workspace/notes").resolve()` 和 Day 180 的坏工具指向同一个目录。不同的是,下面不会再把这串绝对路径返回给模型。
- `good = ToolRegistry()` 新的注册表,只放两个工具。坏工具的 `bad` 不动,Day 183 两组要放在一起比。
- `def search(query: str) -> dict[str, Any]:` 故意先用一个很普通的名字和一句话描述,第二、三条原则再改。
- `for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):` 和坏版本的 `grep` 一样逐行扫,行号从 1 开始。
- `if query in line:` 用 `in` 做子串判断,不再当正则用,所以 `退款(` 这种括号不配对的输入不会再报 `unterminated subpattern`。相当于 JS 的 `line.includes(query)`。
- `hits.append({"note": path.stem, "line": n, "text": line})` 每条命中只给三样东西:笔记名(`.stem` 是去掉扩展名的文件名,`meeting-21.md` → `meeting-21`)、行号、那一行。没有绝对路径、字节数、时间戳。
- `def read(note: str, start_line: int = 1, max_lines: int = 40) -> dict[str, Any]:` 读「一段」而不是「一整篇」。参数带默认值,所以只传 `note` 也能用,Day 169 的注册表会把有默认值的参数标成非必填。
- `lines = (ROOT / f"{note}.md").read_text(encoding="utf-8").splitlines()` 模型只给笔记名,路径由工具自己拼。坏版本的 `cat` 要求模型传绝对路径,所以它每次都得先 `ls`。
- `chunk = lines[start_line - 1:start_line - 1 + max_lines]` 行号转下标要减 1。切片越界不报错,文件只有 42 行时 `lines[39:44]` 只给 3 行,相当于 JS 的 `slice`。
- `return {"note": note, "lines": [f"{i}: {s}" for i, s in enumerate(chunk, start_line)]}` 每行前面带上真实行号,`enumerate(chunk, start_line)` 让编号从 `start_line` 开始而不是从 0。

</div>

跑探针 `uv run python -m part03.probe_good`(错误信息里的绝对路径我缩短成了 `/…/`,你的会是自己的目录):

```text
search({"query": "退款"}) -> 31312 字符
    {"hits": [{"note": "meeting-01", "line": 5, "text": "- 第 1 条讨论:关于退款流程的细节,结论是需要客户确认"}, {"note": "meeting-01", "line": 9, "text": "- 第 5 条讨论:关于退款流程的细节,结论是下周上线"}, …
search({"query": "退款 审批"}) -> 12 字符
    {"hits": []}
search({"query": "退钱"}) -> 12 字符
    {"hits": []}
read({"note": "meeting-21", "start_line": 40, "max_lines": 5}) -> 138 字符
    {"note": "meeting-21", "lines": ["40: - 第 36 条讨论:关于发票同步的细节,结论是继续观察", "41: - 第 37 条讨论:关于价格调整的细节,结论是继续观察", "42: - 决定:超过 30 天的订单退款需要财务主管审批"]}
read({"note": "3", "max_lines": 3}) -> 197 字符
    {"error": "FileNotFoundError: [Errno 2] No such file or directory: '/…/agent-zero-lab/workspace/notes/3.md'"}
read({"note": "meetng-03"}) -> 205 字符
    {"error": "FileNotFoundError: [Errno 2] No such file or directory: '/…/agent-zero-lab/workspace/notes/meetng-03.md'"}
```

只改了「工具怎么切」,搜「退款」就从 Day 180 的 70,454 个字符降到 31,312 个,少掉的那一半多全是绝对路径。读一段只要 138 个字符,不用再读整篇的 1,187 个。

但问题还多着:412 条命中一条不少地全倒了出来;「退款 审批」两个词被当成一个带空格的整串去找,一条也没有;读「3」直接报 `FileNotFoundError`,报错里还暴露了服务器上的绝对路径。后面五条原则一条一条收拾。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="改造前三个命令和改造后两个工具的调用流程对比">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">改造前:按命令切(Day 180)</text>
  <rect x="20" y="42" width="150" height="40" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="95" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">ls()</text>
  <text x="95" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">40 条绝对路径</text>
  <line x1="170" y1="62" x2="230" y2="62" stroke="var(--rule)"/>
  <rect x="230" y="42" width="170" height="40" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="315" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">grep("退款")</text>
  <text x="315" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">412 行,70,454 字符</text>
  <line x1="400" y1="62" x2="460" y2="62" stroke="var(--rule)"/>
  <rect x="460" y="42" width="160" height="40" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="540" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">cat(绝对路径)</text>
  <text x="540" y="75" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">整篇 1,187 字符</text>
  <text x="20" y="126" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">改造后:按任务切(今天)</text>
  <rect x="20" y="140" width="290" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="165" y="158" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">notes_search("退款 审批")</text>
  <text x="165" y="173" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">meeting-21 第 42 行,95 字符</text>
  <line x1="310" y1="160" x2="350" y2="160" stroke="var(--rule)"/>
  <rect x="350" y="140" width="270" height="40" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="485" y="158" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">notes_read("meeting-21", 1, 3)</text>
  <text x="485" y="173" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">标题、负责人、日期</text>
  <text x="20" y="206" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">人怎么找纪要,工具就怎么切:先搜到位置,再读那一小段</text>
</svg>
<figcaption>上面一行是 Day 180 坏工具的典型轨迹,三步都在搬运大块数据;下面是改完六条原则后的两步,每一步只拿下一步需要的东西。数字都来自实跑。</figcaption>
</figure>

## 原则二:名字要无歧义,多了就加命名空间

工具名是模型选工具时最先看的东西。`search` 搜的是什么?现在只有一组工具,模型猜得到。可是到了第八部分的 SupportPilot,会同时挂上知识库、订单、工单几组工具,如果每一组都有一个 `search`,会发生什么?

先故意制造一次。下面用两个小函数模拟「两个模块各自写了一个叫 `search` 的工具」,一起登记进同一个注册表:

```python
# agent-zero-lab/part03/name_clash.py  两个系统各有一个 search,登记进同一个注册表会怎样
from openai import BadRequestError

from common.llm import LLMClient
from part03.agent_loop import ToolRegistry

reg = ToolRegistry()


def make_notes_search():
    def search(query: str) -> dict[str, str]:
        """搜索"""
        return {"from": "会议纪要", "query": query}
    return search


def make_tickets_search():
    def search(query: str) -> dict[str, str]:
        """搜索"""
        return {"from": "工单系统", "query": query}
    return search


reg.tool(make_notes_search())
reg.tool(make_tickets_search())
print("schemas 里的名字:", [s["function"]["name"] for s in reg.schemas])
print("funcs 里的名字:  ", list(reg.funcs))
print("调用 search ->", reg.call("search", '{"query": "退款"}'))

llm = LLMClient()
try:
    llm.chat([{"role": "user", "content": "帮我查一下关于退款的工单"}], tools=reg.schemas)
except BadRequestError as e:
    print("发给模型 ->", e.status_code, e.body)
```

<div class="line-notes">

- `from openai import BadRequestError` openai SDK 里 HTTP 400 对应的异常类型,下面要接住它。
- `def make_notes_search():` 一个「造函数的函数」:调用它,返回里面定义的那个 `search`。这里用它只是为了在一个文件里造出两个同名函数,模拟两个模块各写各的。
- `def search(query: str) -> dict[str, str]:` 两个工厂里的函数都叫 `search`,`fn.__name__` 都是 `"search"`,注册表就是按这个名字登记的。
- `reg.tool(make_notes_search())` 平时我们写 `@reg.tool` 装饰器,其实就等于把函数交给 `reg.tool(...)` 调一次([Day 96](/blog/agent-zero/day-096-decorators/) 讲过装饰器就是这个语法糖)。
- `print("funcs 里的名字:  ", list(reg.funcs))` `funcs` 是字典,同一个键写两次,后一次覆盖前一次,和 JS 对象 `obj.search = ...` 写两次一样。
- `print("调用 search ->", reg.call("search", '{"query": "退款"}'))` 看真正被执行的是哪一个。
- `llm.chat([{"role": "user", "content": "帮我查一下关于退款的工单"}], tools=reg.schemas)` 把两份同名的 schema 一起发给 DeepSeek。
- `print("发给模型 ->", e.status_code, e.body)` `e.body` 是服务端返回的错误详情,打出来看原文。

</div>

运行 `uv run python -m part03.name_clash`:

```text
schemas 里的名字: ['search', 'search']
funcs 里的名字:   ['search']
调用 search -> {"from": "工单系统", "query": "退款"}
发给模型 -> 400 {'message': 'Tool names must be unique. (request_id: 5bf36be3-b3fa-4fc8-9244-7d2b3b29e4d7)', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}
```

两层问题。我们自己的注册表**不报错**:`schemas` 里有两个 `search`,`funcs` 里却只剩后登记的那个,调用「会议纪要的 search」实际执行的是工单系统的。这种 bug 很难发现。DeepSeek 那边倒是直接拒绝了:`Tool names must be unique`,工具名必须唯一。这次请求被拒,没有扣钱。

就算名字不完全一样,`search` 和 `search_docs` 这种也够模型犹豫的。办法是加**命名空间**:名字前面带上它属于哪个系统,`notes_search`、`tickets_search`、`orders_search`。Claude 的[工具定义文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)给的例子是 `github_list_prs`、`slack_send_message`;Anthropic 的文章还提到,用前缀还是后缀(`notes_search` 还是 `search_notes`)在他们的评测里对效果有不小的影响,具体哪种好要在自己的任务上测,但同一个项目里要统一。

第二版只改两个函数名:

```python
# agent-zero-lab/part03/notes_tools_good.py  第二版:名字带上 notes_ 前缀(只列出改动的两行)
def notes_search(query: str) -> dict[str, Any]:
def notes_read(note: str, start_line: int = 1, max_lines: int = 40) -> dict[str, Any]:
```

<div class="line-notes">

- `def notes_search(query: str) -> dict[str, Any]:` 名字说清楚了「搜的是纪要」。以后再加一个产品文档的搜索,叫 `docs_search`,两个一眼能分开(练习 2 会实测)。
- `def notes_read(note: str, start_line: int = 1, max_lines: int = 40) -> dict[str, Any]:` 和 `notes_search` 用同一个前缀,模型看到前缀就知道这两个是一组。

</div>

探针的六行数字和第一版一模一样,只是名字变了(`notes_search(...)`、`notes_read(...)`)。名字的作用不在返回值,在模型**选哪个工具、怎么理解它**,这要调模型才看得到,放到下一条一起看。参数名也是同一个道理:Anthropic 举的例子是别叫 `user`,叫 `user_id`,前者模型可能填用户名、邮箱或者 ID。Day 180 的 `f` 和 `p` 已经在第一版里改成了 `note` 和 `query`。

## 原则三:描述写给一个聪明但不了解背景的新同事

到现在为止两个工具的描述还是「搜索」「读取」各两个字。Claude 的工具定义文档把描述列为「对工具表现影响最大的一个因素」,并给了一个很具体的标准:**每个工具的描述至少三四句话**,写清楚四件事:

- 它做什么;
- 什么时候该用(以及什么时候不该用);
- 每个参数是什么意思、怎么影响行为;
- 有什么限制,比如它不返回哪些信息。

想象你在给一个刚入职、很聪明但完全不了解云簿的同事写便条:「这个搜索能搜什么、搜不到怎么办、搜完下一步干嘛」。第三版把两个工具的 docstring 换掉,其他不动:

```python
# agent-zero-lab/part03/notes_tools_good.py  第三版:描述写成四句话(只列出两个 docstring)
    """在团队的会议纪要库(40 篇周会纪要)里按关键词搜索,返回命中的笔记名、行号和那一行的文字。
    用户问「之前开会怎么定的」「谁负责的那次会」这类问题时先用它定位,再用 notes_read 读命中位置附近的内容。
    匹配方式是逐字包含,不理解同义词:搜不到时换个说法。
    不要用它列出全部笔记。"""

    """读一篇会议纪要的一段,每行带行号。前三行固定是标题、负责人、日期。
    通常先用 notes_search 拿到笔记名和行号,再从那一行附近开始读;想知道负责人就读第 1 到 3 行。
    note 填 notes_search 返回的 note 字段,比如 'meeting-03'。"""
```

<div class="line-notes">

- `"""在团队的会议纪要库(40 篇周会纪要)里按关键词搜索` 第一句:做什么、范围多大、返回什么。「40 篇」让模型知道这不是一个海量库。
- `用户问「之前开会怎么定的」` 第二句:什么时候用,用完下一步干嘛。两个工具在描述里互相提到对方,模型就知道它们是先后配合的。
- `匹配方式是逐字包含,不理解同义词` 第三句:限制和对策。Day 180 的模型不知道 `grep` 是逐字的,搜「30天」落空后只能瞎猜。
- `不要用它列出全部笔记。"""` 第四句:什么时候不该用。
- `"""读一篇会议纪要的一段,每行带行号。前三行固定是标题、负责人、日期。` 把文件格式告诉模型。这一句对第二问「谁负责的那次会」特别有用,它不用读整篇就知道负责人在第 2 行。
- `note 填 notes_search 返回的 note 字段,比如 'meeting-03'。"""` 告诉模型参数从哪来、长什么样。第四条原则会把这句搬进参数自己的说明里。

</div>

描述有没有用,要看模型的行为。写一个只看第一步的小脚本:同一个问题问三次,只打印模型第一下调了什么。每改完一条原则跑一次,一次大约三厘钱。

```python
# agent-zero-lab/part03/first_call.py  只看第一步:描述改了,模型第一下怎么调工具
from common.llm import LLMClient
from part03.notes_tools_good import good

SYSTEM = "你是团队助理,可以用工具查会议纪要。回答要说出依据在哪篇纪要。"  # 和 Day 180 run_bad.py 一样
QUESTION = "之前开会对超过 30 天的订单退款是怎么定的?谁负责的那次会?"
llm = LLMClient()
msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": QUESTION}]
for i in range(3):
    r = llm.chat(msgs, tools=good.schemas, temperature=1.0)
    calls = [(tc["function"]["name"], tc["function"]["arguments"]) for tc in r.message.get("tool_calls") or []]
    print(f"第 {i + 1} 次 输入 {r.prompt_tokens} tok ->", calls)
print(llm.ledger)
```

<div class="line-notes">

- `SYSTEM = "你是团队助理,可以用工具查会议纪要。回答要说出依据在哪篇纪要。"` 和 Day 180 一字不差,保证只有工具在变。
- `r = llm.chat(msgs, tools=good.schemas, temperature=1.0)` 只调一次模型,不执行工具,所以每次只花第一步的钱。温度 1 让三次之间有差异,看的是倾向而不是某一次的偶然。
- `calls = [(tc["function"]["name"], tc["function"]["arguments"]) for tc in r.message.get("tool_calls") or []]` 把每个工具调用压成「名字 + 参数字符串」的二元组,方便一行打印。
- `print(f"第 {i + 1} 次 输入 {r.prompt_tokens} tok ->", calls)` 输入 token 里包含了工具定义,描述写长了这里会涨。

</div>

第二版(描述只有两个字)和第三版各跑一次 `uv run python -m part03.first_call`:

```text
# 第二版:描述「搜索」「读取」
第 1 次 输入 357 tok -> [('notes_search', '{"query": "超过30天 订单 退款"}'), ('notes_search', '{"query": "退款政策 30天"}')]
第 2 次 输入 357 tok -> [('notes_search', '{"query": "超过30天 订单退款"}'), ('notes_search', '{"query": "退款 超期订单 政策"}')]
第 3 次 输入 357 tok -> [('notes_search', '{"query": "超过30天订单退款"}'), ('notes_search', '{"query": "退款 30天 规则"}')]
3 次调用 | 输入 1071 / 输出 242 tokens | 约 ¥0.0036
# 第三版:四句话的描述
第 1 次 输入 521 tok -> [('notes_search', '{"query": "30天"}'), ('notes_search', '{"query": "退款"}')]
第 2 次 输入 521 tok -> [('notes_search', '{"query": "30 天"}'), ('notes_search', '{"query": "退款"}')]
第 3 次 输入 521 tok -> [('notes_search', '{"query": "30 天"}'), ('notes_search', '{"query": "退款"}')]
3 次调用 | 输入 1563 / 输出 221 tokens | 约 ¥0.0034
```

第二版的模型把 `notes_search` 当成了搜索引擎,传的是「超过30天 订单 退款」这种带空格的短语。可我们的工具是逐字包含,这串字原文里根本没有,六次搜索全会落空。它不知道,因为没人告诉它。

第三版的模型读到了「逐字包含」,马上改用短关键词:「30 天」「退款」。这是对的方向。但新问题来了:单独搜「退款」在第三版里还是那 31,312 个字符。**描述能改变模型怎么用工具,但它管不了工具自己返回多少。** 后面两条原则就是干这个的。

描述的代价也看得见:输入从 357 涨到 521,多了 164 个 token。Agent 每一步都要带上工具定义,按 Day 180 那个四步的任务算,一次任务多 656 个输入 token,高峰价约 0.0013 元。和一次搜「退款」灌进来的三万多 token 比,这笔钱可以忽略。

## 原则四:参数能枚举就枚举,宽进严出

参数这一条有三个要点。

**每个参数都写说明。** Day 169 的注册表支持 `Annotated[类型, "说明"]` 这种写法:`Annotated` 是 Python 标准库 `typing` 里的,意思是「类型还是这个类型,我顺手贴一张标签」。注册表把标签放进 schema 的 `description`。相当于 TS 里给 interface 字段写一行 JSDoc 注释,只不过这行注释会被发给模型。

**能枚举就枚举。** 用 `Literal["concise", "detailed"]` 声明参数只能取这两个值之一,注册表会生成 `"enum": ["concise", "detailed"]`,模型就填不出第三种。相当于 TS 里的联合类型 `"concise" | "detailed"`。

**宽进严出。** 对模型「合理但不精确」的输入保持宽容,在工具里把它规范成标准格式,而不是报错让它重试一轮。比如模型从标题「周会纪要 #3」推断笔记名,很自然会写 `3` 或 `meeting-3`;模型按自己的习惯写「30天」,原文却是「30 天」。这些都该在工具里多写两行接住。「严出」是说工具返回的东西要格式统一、稳定,别模型传什么就原样回什么。

第四版改动比较多,完整列出来:

```python
# agent-zero-lab/part03/notes_tools_good.py  第四版:参数写说明、能枚举就枚举、宽进严出
import re
from pathlib import Path
from typing import Annotated, Any, Literal

from part03.agent_loop import ToolRegistry

ROOT = Path("workspace/notes").resolve()
good = ToolRegistry()


@good.tool
def notes_search(
    query: Annotated[str, "要找的关键词,普通文本,不是正则。多个词用空格分开,表示同一行里都要出现,例如 '退款 审批'"],
    response_format: Annotated[Literal["concise", "detailed"], "concise 只给笔记名、行号和那一行;detailed 再加标题、负责人、日期"] = "concise",
) -> dict[str, Any]:
    """在团队的会议纪要库(40 篇周会纪要)里按关键词搜索,返回命中的笔记名、行号和那一行的文字。
    用户问「之前开会怎么定的」「谁负责的那次会」这类问题时先用它定位,再用 notes_read 读命中位置附近的内容。
    匹配时忽略大小写和空格,但不理解同义词:搜不到时换个说法或少用几个词。
    不要用它列出全部笔记。"""
    words = [w.lower() for w in query.split()]
    hits: list[dict[str, Any]] = []
    for path in sorted(ROOT.glob("*.md")):
        lines = path.read_text(encoding="utf-8").splitlines()
        for n, line in enumerate(lines, 1):
            flat = line.replace(" ", "").lower()
            if all(w in flat for w in words):
                hit: dict[str, Any] = {"note": path.stem, "line": n, "text": line}
                if response_format == "detailed":
                    hit["title"] = lines[0].removeprefix("# ")
                    hit["owner"] = lines[1].removeprefix("负责人: ")
                    hit["date"] = lines[2].removeprefix("日期: ")
                hits.append(hit)
    return {"hits": hits}


@good.tool
def notes_read(
    note: Annotated[str, "笔记名,用 notes_search 返回的 note 字段,例如 'meeting-03'"],
    start_line: Annotated[int, "从第几行开始读,默认 1"] = 1,
    max_lines: Annotated[int, "最多读几行,默认 40,最大 200"] = 40,
) -> dict[str, Any]:
    """读一篇会议纪要的一段,每行带行号。前三行固定是标题、负责人、日期。
    通常先用 notes_search 拿到笔记名和行号,再从那一行附近开始读;想知道负责人就读第 1 到 3 行。
    note 填 notes_search 返回的 note 字段,比如 'meeting-03'。"""
    note = note.strip().removesuffix(".md")
    m = re.fullmatch(r"(?:meeting-?)?(\d{1,2})", note)
    if m:
        note = f"meeting-{int(m.group(1)):02d}"
    max_lines = max(1, min(max_lines, 200))
    start = max(1, start_line)
    lines = (ROOT / f"{note}.md").read_text(encoding="utf-8").splitlines()
    chunk = lines[start - 1:start - 1 + max_lines]
    return {"note": note, "lines": [f"{i}: {s}" for i, s in enumerate(chunk, start)]}
```

<div class="line-notes">

- `from typing import Annotated, Any, Literal` 两个新东西都来自标准库,不用 `uv add`。
- `query: Annotated[str, "要找的关键词,普通文本,不是正则。` 类型还是 `str`,后面那句话会原样出现在 schema 的 `description` 里。说清了「不是正则」「空格分开表示都要出现」,还给了一个例子。
- `response_format: Annotated[Literal["concise", "detailed"],` `Annotated` 里面套 `Literal`,注册表先拆出说明,再把 `Literal` 变成 `"enum"`。默认 `"concise"`,所以是非必填。
- `匹配时忽略大小写和空格,但不理解同义词` 描述跟着实现一起改了。描述和实现说的不一样,比不写还糟。
- `words = [w.lower() for w in query.split()]` `split()` 不带参数时按任意空白切开,`"退款 审批".split()` 得到 `['退款', '审批']`。`.lower()` 统一成小写,英文关键词不分大小写。
- `flat = line.replace(" ", "").lower()` 把这一行的空格全去掉再比。原文「超过 30 天」变成「超过30天」,模型搜「30天」或「30 天」(后者被切成 `30` 和 `天` 两个词)都能命中。Day 180 清单上的「搜索太死」就是这一行修的。
- `if all(w in flat for w in words):` `all(...)` 要求每个词都在这一行里,相当于 JS 的 `words.every(w => flat.includes(w))`。
- `hit: dict[str, Any] = {"note": path.stem, "line": n, "text": line}` 返回的 `text` 还是原文,只是比较时用去掉空格的版本。
- `if response_format == "detailed":` 模型说要细节才多给三个字段。
- `hit["title"] = lines[0].removeprefix("# ")` `removeprefix` 只去掉开头的 `"# "` 这一段(Python 3.9 起有),得到 `退款流程 周会纪要 #21`。
- `hit["owner"] = lines[1].removeprefix("负责人: ")` 得到 `张伟`。
- `note: Annotated[str, "笔记名,用 notes_search 返回的 note 字段,例如 'meeting-03'"],` 第三版写在描述最后一句的话,搬到参数自己的说明里,离用它的地方最近。
- `max_lines: Annotated[int, "最多读几行,默认 40,最大 200"] = 40,` 说明里写了上限,下面代码也真的按这个上限来。
- `note = note.strip().removesuffix(".md")` 宽进第一步:去掉首尾空白和多写的扩展名,`' meeting-03.md '` → `'meeting-03'`。
- `m = re.fullmatch(r"(?:meeting-?)?(\d{1,2})", note)` `fullmatch` 要求整个字符串都符合模式。`(?:meeting-?)?` 表示「meeting 加可有可无的横杠」这一整段都可以没有,`(?:...)` 是不捕获的分组;`(\d{1,2})` 是一到两位数字。`'3'`、`'meeting-3'`、`'meeting03'` 都能匹配。
- `note = f"meeting-{int(m.group(1)):02d}"` `m.group(1)` 是括号里抓到的数字字符串 `'3'`,转成整数再补零到两位,得到 `meeting-03`。
- `max_lines = max(1, min(max_lines, 200))` 把取值夹在 1 到 200 之间。模型传 999 不报错,按 200 读;传 0 按 1 读。
- `start = max(1, start_line)` 模型传 0 或负数,都当成从第 1 行开始。

</div>

跑探针:

```text
notes_search({"query": "退款"}) -> 31312 字符
    {"hits": [{"note": "meeting-01", "line": 5, "text": "- 第 1 条讨论:关于退款流程的细节,结论是需要客户确认"}, {"note": "meeting-01", "line": 9, "text": "- 第 5 条讨论:关于退款流程的细节,结论是下周上线"}, …
notes_search({"query": "退款 审批"}) -> 83 字符
    {"hits": [{"note": "meeting-21", "line": 42, "text": "- 决定:超过 30 天的订单退款需要财务主管审批"}]}
notes_search({"query": "退钱"}) -> 12 字符
    {"hits": []}
notes_read({"note": "meeting-21", "start_line": 40, "max_lines": 5}) -> 138 字符
    {"note": "meeting-21", "lines": ["40: - 第 36 条讨论:关于发票同步的细节,结论是继续观察", "41: - 第 37 条讨论:关于价格调整的细节,结论是继续观察", "42: - 决定:超过 30 天的订单退款需要财务主管审批"]}
notes_read({"note": "3", "max_lines": 3}) -> 89 字符
    {"note": "meeting-03", "lines": ["1: # 订阅升级 周会纪要 #3", "2: 负责人: 陈静", "3: 日期: 2026-08-11"]}
notes_read({"note": "meetng-03"}) -> 205 字符
    {"error": "FileNotFoundError: [Errno 2] No such file or directory: '/…/agent-zero-lab/workspace/notes/meetng-03.md'"}
```

两个变化。「退款 审批」现在一次命中,83 个字符,正好是那条决定。读「3」被规范成了 `meeting-03`,前三行就是标题、负责人、日期。

再跑一次 `first_call.py`:

```text
第 1 次 输入 665 tok -> [('notes_search', '{"query": "退款 30天", "response_format": "detailed"}'), ('notes_search', '{"query": "退款 超过 30 天", "response_format": "detailed"}')]
第 2 次 输入 665 tok -> [('notes_search', '{"query": "退款 30 天"}'), ('notes_search', '{"query": "退款 订单"}')]
第 3 次 输入 665 tok -> [('notes_search', '{"query": "退款 30天", "response_format": "detailed"}'), ('notes_search', '{"query": "超时 订单 退款"}')]
3 次调用 | 输入 1995 / 输出 310 tokens | 约 ¥0.0042
```

模型学会了组合关键词,「退款 30天」「退款 超过 30 天」都会命中第 42 行。有两次它主动要了 `detailed`,因为问题里还问了负责人,它想一次把负责人一起拿到。这就是枚举参数的好处:选项写在 schema 里,模型能看懂每个选项是干嘛的,自己会挑。

## 原则五:返回值要高信号、可控大小、引导下一步

单独搜「退款」还是 31,312 个字符,这是清单上最贵的一项。Day 180 第二遍就是第一步搜了「退款」,后面每一步都背着三万多 token。

返回值这一条分三层。

**只返回模型推理需要的东西。** 第一版已经去掉了绝对路径、字节数和时间戳。再加一刀:每条命中的文字最多保留 120 个字符,防止某一行特别长。

**大小可控,而且告诉模型被砍了多少。** 加一个 `limit` 参数,默认只返回前 5 条;同时返回 `total`(一共命中多少条)。超出时在 `hint` 里写「还有 407 条没显示,加一个关键词缩小范围」。注意不是简单地砍掉,而是让模型知道「被砍了、砍了多少、怎么拿到想要的」。SWE-agent 的搜索最多返回 50 条,Claude Code 默认把单次工具返回限制在 25,000 token,我们这里收得更紧,因为我们的任务本来就只需要定位一行。

**引导下一步。** `notes_read` 返回 `total_lines`(这篇一共多少行),还有内容没读完时返回 `next_start_line`(下一次从哪行接着读)。这和 [Day 177](/blog/agent-zero/day-177-todo-reflection/) 待办清单工具返回的 `next` 是同一个思路:工具的返回值本身就是提示词的一部分,别浪费它。

第五版的改动(其他部分和第四版一样):

```python
# agent-zero-lab/part03/notes_tools_good.py  第五版:返回值有上限、有总数、能翻页(只列出改动的部分)
@good.tool
def notes_search(
    query: Annotated[str, "要找的关键词,普通文本,不是正则。多个词用空格分开,表示同一行里都要出现,例如 '退款 审批'"],
    limit: Annotated[int, "最多返回几条命中,默认 5,最大 20"] = 5,
    response_format: Annotated[Literal["concise", "detailed"], "concise 只给笔记名、行号和那一行;detailed 再加标题、负责人、日期"] = "concise",
) -> dict[str, Any]:
    ...
    words = [w.lower() for w in query.split()]
    limit = max(1, min(limit, 20))
    hits: list[dict[str, Any]] = []
    for path in sorted(ROOT.glob("*.md")):
        lines = path.read_text(encoding="utf-8").splitlines()
        for n, line in enumerate(lines, 1):
            flat = line.replace(" ", "").lower()
            if all(w in flat for w in words):
                hit: dict[str, Any] = {"note": path.stem, "line": n, "text": line.strip()[:120]}
                ...
                hits.append(hit)
    out: dict[str, Any] = {"total": len(hits), "hits": hits[:limit]}
    if len(hits) > limit:
        out["hint"] = f"还有 {len(hits) - limit} 条没显示。加一个关键词缩小范围,或调大 limit(最大 20)。"
    return out

# ↓ notes_read 的描述最后一句换成这句
    长笔记分段返回,结果里有 next_start_line 时,说明后面还有,用它接着读。"""
# ↓ notes_read 函数体的后半段
    path = ROOT / f"{note}.md"
    lines = path.read_text(encoding="utf-8").splitlines()
    max_lines = max(1, min(max_lines, 200))
    start = max(1, start_line)
    chunk = lines[start - 1:start - 1 + max_lines]
    end = start + len(chunk) - 1
    out: dict[str, Any] = {"note": path.stem, "total_lines": len(lines),
                           "lines": [f"{i}: {s}" for i, s in enumerate(chunk, start)]}
    if end < len(lines):
        out["next_start_line"] = end + 1
    return out
```

<div class="line-notes">

- `limit: Annotated[int, "最多返回几条命中,默认 5,最大 20"] = 5,` 默认 5 条。为什么是 5:我们的任务只需要定位,5 条足够看出「命中在哪几篇」。
- `...` 省略号表示这里和第四版一样,别真的敲一个 `...`。
- `limit = max(1, min(limit, 20))` 和 `max_lines` 一样夹住。实测传 99,返回 20 条。
- `hit: dict[str, Any] = {"note": path.stem, "line": n, "text": line.strip()[:120]}` `.strip()` 去掉首尾空白,`[:120]` 最多保留 120 个字符。
- `hits.append(hit)` 先把全部命中收集起来再截断,这样才知道总数是 412。
- `out: dict[str, Any] = {"total": len(hits), "hits": hits[:limit]}` `total` 是总数,`hits` 只给前 `limit` 条。
- `if len(hits) > limit:` 只有真的被截断了才加提示,没截断就不啰嗦。
- `out["hint"] = f"还有 {len(hits) - limit} 条没显示。` 搜「退款」时 412 − 5 = 407。提示里给了两个出路:加关键词,或者调大 limit。
- `长笔记分段返回,结果里有 next_start_line 时` 新加的返回字段要在描述里说一句,否则模型不知道它是干嘛的。
- `path = ROOT / f"{note}.md"` 单独拿出一个变量,下一条原则要先判断它存不存在。
- `end = start + len(chunk) - 1` 这次实际读到的最后一行。读 meeting-21 第 40 行起 5 行:文件只有 42 行,`chunk` 只有 3 行,`end` = 40 + 3 − 1 = 42。
- `out: dict[str, Any] = {"note": path.stem, "total_lines": len(lines),` 告诉模型这篇一共多少行,它可以自己判断还要不要往下读。
- `if end < len(lines):` 后面还有内容才给 `next_start_line`。上面那个例子 42 < 42 不成立,所以没有。
- `out["next_start_line"] = end + 1` 读 meeting-03 前 3 行:`end` 是 3,文件 46 行,返回 `next_start_line: 4`。

</div>

跑探针:

```text
notes_search({"query": "退款"}) -> 454 字符
    {"total": 412, "hits": [{"note": "meeting-01", "line": 5, "text": "- 第 1 条讨论:关于退款流程的细节,结论是需要客户确认"}, {"note": "meeting-01", "line": 9, "text": "- 第 5 条讨论:关于退款流程的…
notes_search({"query": "退款 审批"}) -> 95 字符
    {"total": 1, "hits": [{"note": "meeting-21", "line": 42, "text": "- 决定:超过 30 天的订单退款需要财务主管审批"}]}
notes_search({"query": "退钱"}) -> 24 字符
    {"total": 0, "hits": []}
notes_read({"note": "meeting-21", "start_line": 40, "max_lines": 5}) -> 157 字符
    {"note": "meeting-21", "total_lines": 42, "lines": ["40: - 第 36 条讨论:关于发票同步的细节,结论是继续观察", "41: - 第 37 条讨论:关于价格调整的细节,结论是继续观察", "42: - 决定:超过 30 天的订单退款需要财务主管审批"]}
notes_read({"note": "3", "max_lines": 3}) -> 130 字符
    {"note": "meeting-03", "total_lines": 46, "lines": ["1: # 订阅升级 周会纪要 #3", "2: 负责人: 陈静", "3: 日期: 2026-08-11"], "next_start_line": 4}
notes_read({"note": "meetng-03"}) -> 205 字符
    {"error": "FileNotFoundError: [Errno 2] No such file or directory: '/…/agent-zero-lab/workspace/notes/meetng-03.md'"}
```

搜「退款」从 31,312 个字符变成 **454** 个。这是今天最大的一笔:最自然的用法,现在也是便宜的用法。Day 180 清单上「成本随用法剧烈波动」的根子就在这里,不管模型第一步碰巧搜什么词,单次返回都被压在一千字符以内。

`response_format` 这个设计也来自 Anthropic 的文章,他们的例子里详细版 206 个 token,简洁版 72 个,大约三分之一。我们这里 concise 一条命中约 90 个字符,detailed 约 150 个,比例差不多。

## 原则六:报错要能指导模型改正

剩下两个难看的输出:搜「退钱」只返回 `{"total": 0, "hits": []}`,模型不知道该怎么办;读「meetng-03」还是一句 `FileNotFoundError`,带着服务器的绝对路径。

对比两种报错:

- `FileNotFoundError: [Errno 2] No such file or directory: '/…/meetng-03.md'`
- `没有叫 'meetng-03' 的笔记。笔记名格式是 'meeting-两位数字'。你是不是想找 ['meeting-03', 'meeting-40', 'meeting-39']?`

前者模型大概能看懂「没找到」,但要自己猜怎么改;后者回答了三个问题:**错在哪,正确的格式是什么,建议的下一步是什么。** Anthropic 的原话是返回能指导行动的报错,而不是不透明的错误码或者 traceback(异常的调用栈)。顺带,好的报错也不会把服务器上的目录结构暴露出去。

「你是不是想找」用 Python 标准库的 `difflib` 一行就能做。`difflib.get_close_matches(词, 候选列表, n=3)` 按相似度返回最接近的几个候选,和你在浏览器地址栏里打错网址时它给的建议是一个意思。

第六版的三处改动:

```python
# agent-zero-lab/part03/notes_tools_good.py  第六版:报错告诉模型下一步(只列出改动的三处)
import difflib


def _note_names() -> list[str]:
    return sorted(p.stem for p in ROOT.glob("*.md"))

# ↓ notes_search 里,在 out = {...} 之前加上
    if not hits:
        return {"total": 0, "hits": [], "hint": f"没有一行同时包含 {words}。试试少用几个词,或者换个说法。"}

# ↓ notes_read 里,path = ... 的下一行加上
    if not path.exists():
        close = difflib.get_close_matches(note, _note_names(), n=3)
        tip = f"你是不是想找 {close}?" if close else "先用 notes_search 按内容搜,拿到 note 字段再来读。"
        return {"error": f"没有叫 '{note}' 的笔记。笔记名格式是 'meeting-两位数字'。{tip}"}
```

<div class="line-notes">

- `import difflib` 标准库,做模糊匹配,不用装任何东西。放在文件最上面,和 `import re` 并排。
- `def _note_names() -> list[str]:` 下划线开头,不加 `@good.tool`,所以它不是工具,只是内部的帮手函数。下划线是 Python 社区「这是内部用的」的约定,相当于 JS 里不 export。
- `return sorted(p.stem for p in ROOT.glob("*.md"))` 全部笔记名,`['meeting-01', ..., 'meeting-40']`。
- `if not hits:` 一条都没命中时不返回干巴巴的空列表。
- `return {"total": 0, "hits": [], "hint": f"没有一行同时包含 {words}。` 把模型实际搜的词列出来(`['退钱']`),再给出路:少用几个词,或者换说法。描述里已经写了「不理解同义词」,两边呼应。
- `if not path.exists():` 先判断文件在不在,不让 `read_text` 抛出那个带绝对路径的异常。
- `close = difflib.get_close_matches(note, _note_names(), n=3)` 实测 `'meetng-03'` 得到 `['meeting-03', 'meeting-40', 'meeting-39']`,排第一的就是正确答案。
- `tip = f"你是不是想找 {close}?" if close else "先用 notes_search 按内容搜,拿到 note 字段再来读。"` 一个相近的都没有时(实测传 `'会议3'`),就建议先去搜。
- `return {"error": f"没有叫 '{note}' 的笔记。笔记名格式是 'meeting-两位数字'。{tip}"}` 用 `error` 这个键,和注册表捕获异常时的格式一致,模型在两种情况下看到的结构一样。

</div>

最后跑一次探针:

```text
notes_search({"query": "退款"}) -> 454 字符
    {"total": 412, "hits": [{"note": "meeting-01", "line": 5, "text": "- 第 1 条讨论:关于退款流程的细节,结论是需要客户确认"}, {"note": "meeting-01", "line": 9, "text": "- 第 5 条讨论:关于退款流程的…
notes_search({"query": "退款 审批"}) -> 95 字符
    {"total": 1, "hits": [{"note": "meeting-21", "line": 42, "text": "- 决定:超过 30 天的订单退款需要财务主管审批"}]}
notes_search({"query": "退钱"}) -> 67 字符
    {"total": 0, "hits": [], "hint": "没有一行同时包含 ['退钱']。试试少用几个词,或者换个说法。"}
notes_read({"note": "meeting-21", "start_line": 40, "max_lines": 5}) -> 157 字符
    {"note": "meeting-21", "total_lines": 42, "lines": ["40: - 第 36 条讨论:关于发票同步的细节,结论是继续观察", "41: - 第 37 条讨论:关于价格调整的细节,结论是继续观察", "42: - 决定:超过 30 天的订单退款需要财务主管审批"]}
notes_read({"note": "3", "max_lines": 3}) -> 130 字符
    {"note": "meeting-03", "total_lines": 46, "lines": ["1: # 订阅升级 周会纪要 #3", "2: 负责人: 陈静", "3: 日期: 2026-08-11"], "next_start_line": 4}
notes_read({"note": "meetng-03"}) -> 105 字符
    {"error": "没有叫 'meetng-03' 的笔记。笔记名格式是 'meeting-两位数字'。你是不是想找 ['meeting-03', 'meeting-40', 'meeting-39']?"}
```

再跑一次 `first_call.py`,看完整版的模型第一步:

```text
第 1 次 输入 692 tok -> [('notes_search', '{"query": "30天 退款"}'), ('notes_search', '{"query": "超过 30 天 订单 退款"}')]
第 2 次 输入 692 tok -> [('notes_search', '{"query": "退款 30天", "response_format": "detailed"}'), ('notes_search', '{"query": "超过30天 退款", "response_format": "detailed"}')]
第 3 次 输入 692 tok -> [('notes_search', '{"query": "退款 30天", "limit": 10}'), ('notes_search', '{"query": "退款 超期", "limit": 10}')]
3 次调用 | 输入 2076 / 输出 311 tokens | 约 ¥0.0044
```

六次搜索里五次能直接命中第 42 行(「退款 超期」那次不会,原文没有「超期」,但它会拿到带 hint 的空结果)。注意第一次的「30天 退款」:这里「30天」没有空格,第四版的去空格比较让它照样能命中。如果没有那一行,这正是 Day 180 里落空的那种搜法。

## 拼起来:完整的 notes_tools_good.py

六版合在一起就是下面这个文件。前面每一段都是它的一部分,这里完整敲一遍,和你一步步改出来的对一下。

```python
# agent-zero-lab/part03/notes_tools_good.py  按六条原则改完的会议纪要工具
import difflib
import re
from pathlib import Path
from typing import Annotated, Any, Literal

from part03.agent_loop import ToolRegistry

ROOT = Path("workspace/notes").resolve()
good = ToolRegistry()


def _note_names() -> list[str]:
    return sorted(p.stem for p in ROOT.glob("*.md"))


@good.tool
def notes_search(
    query: Annotated[str, "要找的关键词,普通文本,不是正则。多个词用空格分开,表示同一行里都要出现,例如 '退款 审批'"],
    limit: Annotated[int, "最多返回几条命中,默认 5,最大 20"] = 5,
    response_format: Annotated[Literal["concise", "detailed"], "concise 只给笔记名、行号和那一行;detailed 再加标题、负责人、日期"] = "concise",
) -> dict[str, Any]:
    """在团队的会议纪要库(40 篇周会纪要)里按关键词搜索,返回命中的笔记名、行号和那一行的文字。
    用户问「之前开会怎么定的」「谁负责的那次会」这类问题时先用它定位,再用 notes_read 读命中位置附近的内容。
    匹配时忽略大小写和空格,但不理解同义词:搜不到时换个说法或少用几个词。
    不要用它列出全部笔记。"""
    words = [w.lower() for w in query.split()]
    limit = max(1, min(limit, 20))
    hits: list[dict[str, Any]] = []
    for path in sorted(ROOT.glob("*.md")):
        lines = path.read_text(encoding="utf-8").splitlines()
        for n, line in enumerate(lines, 1):
            flat = line.replace(" ", "").lower()
            if all(w in flat for w in words):
                hit: dict[str, Any] = {"note": path.stem, "line": n, "text": line.strip()[:120]}
                if response_format == "detailed":
                    hit["title"] = lines[0].removeprefix("# ")
                    hit["owner"] = lines[1].removeprefix("负责人: ")
                    hit["date"] = lines[2].removeprefix("日期: ")
                hits.append(hit)
    if not hits:
        return {"total": 0, "hits": [], "hint": f"没有一行同时包含 {words}。试试少用几个词,或者换个说法。"}
    out: dict[str, Any] = {"total": len(hits), "hits": hits[:limit]}
    if len(hits) > limit:
        out["hint"] = f"还有 {len(hits) - limit} 条没显示。加一个关键词缩小范围,或调大 limit(最大 20)。"
    return out


@good.tool
def notes_read(
    note: Annotated[str, "笔记名,用 notes_search 返回的 note 字段,例如 'meeting-03'"],
    start_line: Annotated[int, "从第几行开始读,默认 1"] = 1,
    max_lines: Annotated[int, "最多读几行,默认 40,最大 200"] = 40,
) -> dict[str, Any]:
    """读一篇会议纪要的一段,每行带行号。前三行固定是标题、负责人、日期。
    通常先用 notes_search 拿到笔记名和行号,再从那一行附近开始读;想知道负责人就读第 1 到 3 行。
    长笔记分段返回,结果里有 next_start_line 时,说明后面还有,用它接着读。"""
    note = note.strip().removesuffix(".md")
    m = re.fullmatch(r"(?:meeting-?)?(\d{1,2})", note)
    if m:
        note = f"meeting-{int(m.group(1)):02d}"
    path = ROOT / f"{note}.md"
    if not path.exists():
        close = difflib.get_close_matches(note, _note_names(), n=3)
        tip = f"你是不是想找 {close}?" if close else "先用 notes_search 按内容搜,拿到 note 字段再来读。"
        return {"error": f"没有叫 '{note}' 的笔记。笔记名格式是 'meeting-两位数字'。{tip}"}
    lines = path.read_text(encoding="utf-8").splitlines()
    max_lines = max(1, min(max_lines, 200))
    start = max(1, start_line)
    chunk = lines[start - 1:start - 1 + max_lines]
    end = start + len(chunk) - 1
    out: dict[str, Any] = {"note": path.stem, "total_lines": len(lines),
                           "lines": [f"{i}: {s}" for i, s in enumerate(chunk, start)]}
    if end < len(lines):
        out["next_start_line"] = end + 1
    return out
```

<div class="line-notes">

- `def _note_names() -> list[str]:` 原则六加的帮手,只给报错里的「你是不是想找」用。
- `def notes_search(` 原则一(按任务切)+ 原则二(`notes_` 前缀)。
- `query: Annotated[str` 原则四:参数自己的说明,讲清不是正则、空格表示都要出现。
- `limit: Annotated[int` 原则五:返回大小可控,默认 5。
- `response_format: Annotated[Literal` 原则四(枚举)+ 原则五(让模型选详细程度)。
- `"""在团队的会议纪要库` 原则三:四句话的描述,做什么、什么时候用、限制、什么时候不用。
- `flat = line.replace(" ", "").lower()` 原则四的宽进:「30天」也能搜到「30 天」。
- `hit: dict[str, Any] = {"note": path.stem, "line": n, "text": line.strip()[:120]}` 原则五:只给定位需要的三样,文字截到 120 字。
- `if not hits:` 原则六:搜不到时告诉模型怎么办。
- `out["hint"] = f"还有` 原则五:截断了就说截了多少、怎么缩小范围。
- `def notes_read(` 原则一 + 原则二。
- `"""读一篇会议纪要的一段` 原则三,最后一句是原则五加的翻页说明。
- `m = re.fullmatch(` 原则四的宽进:`3`、`meeting-3` 都规范成 `meeting-03`。
- `if not path.exists():` 原则六:错在哪、正确格式、下一步。
- `max_lines = max(1, min(max_lines, 200))` 原则四:参数夹在合理范围,不报错。
- `out["next_start_line"] = end + 1` 原则五:引导下一步从哪读。

</div>

写完先做两件检查:`uv run basedpyright part03/notes_tools_good.py` 应该是 `0 errors`;再打印一次 schema,确认 `Annotated` 的说明和 `Literal` 的 enum 都进去了:

```bash
# 在 agent-zero-lab/ 下跑
uv run python -c "
import json
from part03.notes_tools_good import good
print(json.dumps(good.schemas[0]['function']['parameters'], ensure_ascii=False))"
```

<div class="line-notes">

- `print(json.dumps(good.schemas[0]['function']['parameters'], ensure_ascii=False))` 只看 `notes_search` 的参数部分,这是模型看到的样子。

</div>

```text
{"type": "object", "properties": {"query": {"type": "string", "description": "要找的关键词,普通文本,不是正则。多个词用空格分开,表示同一行里都要出现,例如 '退款 审批'"}, "limit": {"type": "integer", "description": "最多返回几条命中,默认 5,最大 20"}, "response_format": {"type": "string", "enum": ["concise", "detailed"], "description": "concise 只给笔记名、行号和那一行;detailed 再加标题、负责人、日期"}}, "required": ["query"]}
```

只有 `query` 是必填,`response_format` 带着 `enum`,三个参数都有说明。

### 前后对照

把六版探针里「搜退款」这一行的大小画出来:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="搜退款这一次工具调用,每一版返回的字符数">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="26" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">搜「退款」一次返回多少字符(实测)</text>
  <text x="140" y="58" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Day 180 grep</text>
  <rect x="150" y="44" width="420" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="560" y="58" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">70,454</text>
  <text x="140" y="96" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">原则一</text>
  <rect x="150" y="82" width="187" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="345" y="96" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">31,312(去掉了绝对路径)</text>
  <text x="140" y="134" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">原则二到四</text>
  <rect x="150" y="120" width="187" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="345" y="134" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">31,312(改的是模型怎么用,不是返回多少)</text>
  <text x="140" y="172" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">原则五、六</text>
  <rect x="150" y="158" width="3" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="162" y="172" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">454(前 5 条 + total 412 + hint)</text>
  <text x="140" y="210" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">退款 审批</text>
  <rect x="150" y="196" width="1" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="162" y="210" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">95(模型按描述组合关键词时)</text>
  <text x="20" y="240" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">条长按每 168 个字符 1 像素画,454 和 95 在这个比例下只剩一条细线</text>
</svg>
<figcaption>名字、描述、参数这三条原则不改变单次返回的大小,它们改变的是模型怎么用工具:选对工具、组合关键词、要不要详细版。真正把单次返回压下来的是第五条。两类改动都要有。</figcaption>
</figure>

再把 Day 180 的难用工具清单逐行对上今天的改法:

| Day 180 的问题 | 今天怎么改的 | 对应原则 |
| --- | --- | --- |
| 按命令设计,三四步才找到 | 拆成「搜 → 读一段」两个工具 | 一 |
| 名字是黑话 | `notes_search`、`notes_read`,带命名空间 | 二 |
| 描述等于没写 | 每个工具三四句:做什么、何时用、限制、何时不用 | 三 |
| 参数名猜不出来、`cat` 只认绝对路径 | `query`/`note` 带说明;`note` 接受 `3`、`meeting-3` | 二、四 |
| 返回值没有上限 | `limit` 默认 5,`total` + `hint` | 五 |
| 返回值全是噪音字段 | 只给笔记名、行号、那一行,文字截到 120 字 | 五 |
| 搜索太死 | 去空格、不分大小写比较;多词表示都要出现 | 四 |
| 报错不指导下一步 | 「你是不是想找」+ 格式说明;搜不到给 hint | 六 |
| 成本随用法剧烈波动 | 不管搜什么词,单次返回都在一千字符以内 | 五 |

最后一行还只是推断。单次返回小了,整次任务是不是真的便宜、成功率有没有掉,要让 Agent 真的去跑一批任务才知道。这是明天的事。

## 动手练习

### 练习 1:改造 Day 180 的查客户工具

[Day 180](/blog/agent-zero/day-180-tool-design-1/) 练习 3 那个 `get(id)` 你已经审过了:只能按 UUID 查、编码不解释、16 个字段一大半是噪音、报错是 `KeyError`。按今天的六条原则,写一个 `customers_search(name)`:按公司名的一部分查,`plan_code`、`billing_cycle`、`status`、`tax_rate_bp` 翻译成文字,只返回回答客户问题需要的字段,搜不到给 hint。编码含义按这个假设:套餐 1/2/3 是基础版/专业版/企业版;周期 M/Y 是月付/年付;状态 1–5 是试用中/正常/欠费/已暂停/已注销;`tax_rate_bp` 是万分之几(600 就是 6%)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/customer_tool_good.py  练习 1:把 Day 180 的 get 按六条原则改成 customers_search
import json
from typing import Annotated, Any

from part03.agent_loop import ToolRegistry
from part03.customer_tool_bad import ROW

reg = ToolRegistry()
PLANS = {1: "基础版", 2: "专业版", 3: "企业版"}
CYCLES = {"M": "月付", "Y": "年付"}
STATUS = {1: "试用中", 2: "正常", 3: "欠费", 4: "已暂停", 5: "已注销"}
ROWS = [ROW]


@reg.tool
def customers_search(
    name: Annotated[str, "客户公司名的一部分,例如 '青禾'。不区分大小写,忽略空格"],
) -> dict[str, Any]:
    """按公司名查云簿的客户,返回套餐、计费周期、席位数、状态和税率,编码都已翻译成文字。
    用户提到某个客户、问他的套餐或者状态时用它。名字只要包含关键词就算命中,最多返回 5 个。
    不返回付款记录和发票,那些要用别的工具查。"""
    key = name.replace(" ", "").lower()
    hits = [r for r in ROWS if key in str(r["name"]).replace(" ", "").lower()]
    if not hits:
        return {"total": 0, "customers": [], "hint": f"没有公司名包含 '{name}' 的客户。试试更短的关键词,比如只用两个字。"}
    return {"total": len(hits), "customers": [{
        "name": r["name"],
        "plan": PLANS.get(r["plan_code"], f"未知套餐({r['plan_code']})"),
        "billing_cycle": CYCLES.get(r["billing_cycle"], r["billing_cycle"]),
        "seats": r["seats"],
        "status": STATUS.get(r["status"], f"未知状态({r['status']})"),
        "tax_rate": f"{r['tax_rate_bp'] / 100:g}%",
    } for r in hits[:5]]}


if __name__ == "__main__":
    print(json.dumps(reg.schemas[0]["function"], ensure_ascii=False))
    for q in ["杭州青禾科技", "青禾", "绿叶"]:
        out = reg.call("customers_search", json.dumps({"name": q}, ensure_ascii=False))
        print(q, "->", len(out), "字符", out)
```

<div class="line-notes">

- `from part03.customer_tool_bad import ROW` 直接复用 Day 180 练习 3 那一行原始数据,数据不变,只改工具。导入时那个文件的 `if __name__` 部分不会执行。
- `PLANS = {1: "基础版", 2: "专业版", 3: "企业版"}` 编码到文字的对照表。这些含义本来只在后端代码里,现在搬进工具,模型不用猜。
- `ROWS = [ROW]` 假装数据库里有一张客户表,目前只有一行。真实项目里这里会换成 SQL 查询(第一部分学过的 `SELECT ... WHERE name LIKE`)。
- `def customers_search(` 原则一和二:按用户会说的东西(公司名)查,名字带 `customers_` 命名空间。
- `name: Annotated[str, "客户公司名的一部分,例如 '青禾'。` 原则四:说清楚可以只给一部分,还给了例子。
- `"""按公司名查云簿的客户` 原则三:做什么、何时用、命中规则和上限、不返回什么。
- `key = name.replace(" ", "").lower()` 原则四的宽进:去空格、转小写再比。
- `hits = [r for r in ROWS if key in str(r["name"]).replace(" ", "").lower()]` 包含关键词就算命中。`str(...)` 是给类型检查看的,`ROW` 的值类型是 `Any`。
- `return {"total": 0, "customers": [], "hint": f"没有公司名包含 '{name}' 的客户。` 原则六:搜不到给出路。
- `"plan": PLANS.get(r["plan_code"], f"未知套餐({r['plan_code']})"),` `.get(键, 默认值)` 查不到时不报错,返回默认值,相当于 JS 的 `PLANS[code] ?? "未知套餐"`。未知编码也原样带上,方便排查。
- `"tax_rate": f"{r['tax_rate_bp'] / 100:g}%",` 600 ÷ 100 = 6.0,`:g` 格式去掉多余的 `.0`,得到 `6%`。
- `} for r in hits[:5]]}` 原则五:最多 5 个,只保留 6 个有用字段,去掉了 UUID、`tenant_id`、时间戳、`stripe_cus`、`ext` 等。

</div>

运行 `uv run python -m part03.customer_tool_good`:

```text
{"name": "customers_search", "description": "按公司名查云簿的客户,返回套餐、计费周期、席位数、状态和税率,编码都已翻译成文字。\n用户提到某个客户、问他的套餐或者状态时用它。名字只要包含关键词就算命中,最多返回 5 个。\n不返回付款记录和发票,那些要用别的工具查。", "parameters": {"type": "object", "properties": {"name": {"type": "string", "description": "客户公司名的一部分,例如 '青禾'。不区分大小写,忽略空格"}}, "required": ["name"]}}
杭州青禾科技 -> 132 字符 {"total": 1, "customers": [{"name": "杭州青禾科技", "plan": "专业版", "billing_cycle": "年付", "seats": 3, "status": "已暂停", "tax_rate": "6%"}]}
青禾 -> 132 字符 {"total": 1, "customers": [{"name": "杭州青禾科技", "plan": "专业版", "billing_cycle": "年付", "seats": 3, "status": "已暂停", "tax_rate": "6%"}]}
绿叶 -> 75 字符 {"total": 0, "customers": [], "hint": "没有公司名包含 '绿叶' 的客户。试试更短的关键词,比如只用两个字。"}
```

Day 180 用名字查直接 `KeyError`,现在全名和简称都能查到。返回从 350 个字符降到 132 个,字段少了一大半,剩下的每个字段模型都能直接读懂:「专业版、年付、3 个席位、已暂停、税率 6%」,算退款时不用再猜编码。

</details>

### 练习 2:两个搜索工具,模型会选错吗

在 `notes_search` 旁边再挂一个 `docs_search`(搜对外的产品帮助文档,今天只要 schema,不用实现)。先给它一句含糊的描述「在文档里按关键词搜索,返回命中的文档名和那一行」,问两个模棱两可的问题,每题问三次,看模型第一步选哪个工具;再把两边的描述都写清楚(一个是内部会议记录,一个是给客户看的产品文档),重跑一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/pick_tool.py  练习 2:两个搜索工具描述很像时,模型会不会选错
import copy
import sys
from typing import Any

from common.llm import LLMClient
from part03.notes_tools_good import good

VAGUE = "在文档里按关键词搜索,返回命中的文档名和那一行。"
CLEAR = ("搜索云簿对外发布的产品帮助文档(给客户看的功能说明和操作步骤),返回文章标题和段落。"
         "用户问「产品怎么用」「功能支持什么」时用它。不包含团队内部的会议记录,内部开会的决定请用 notes_search。")
docs_search: dict[str, Any] = {"type": "function", "function": {
    "name": "docs_search",
    "description": CLEAR if "clear" in sys.argv else VAGUE,
    "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "关键词"}}, "required": ["query"]},
}}
tools = [*copy.deepcopy(good.schemas), docs_search]
if "clear" in sys.argv:  # 给 notes_search 的描述也补一句「这是内部会议记录」
    tools[0]["function"]["description"] += "\n这里只有团队内部的周会纪要,不是给客户看的产品文档。"

QUESTIONS = ["超过 30 天的订单退款要谁批?", "客户想退款,流程是什么?"]
llm = LLMClient()
for q in QUESTIONS:
    picks = []
    for _ in range(3):
        r = llm.chat([{"role": "user", "content": q}], tools=tools, temperature=1.0)
        picks.append([tc["function"]["name"] for tc in r.message.get("tool_calls") or []])
    print(q, "->", picks)
print(llm.ledger)
```

<div class="line-notes">

- `import copy` 标准库,`copy.deepcopy` 做深拷贝,相当于 JS 的 `structuredClone`。
- `docs_search: dict[str, Any] = {"type": "function", "function": {` 不写函数,直接手写一份 schema。我们只看模型选哪个,不执行。
- `"description": CLEAR if "clear" in sys.argv else VAGUE,` 命令行带 `clear` 用清楚的描述,否则用含糊的。
- `tools = [*copy.deepcopy(good.schemas), docs_search]` `[*a, b]` 和 JS 的展开一样。先深拷贝,下面改 `notes_search` 描述时不会改到 `good` 里的原件。
- `tools[0]["function"]["description"] += "\n这里只有团队内部的周会纪要` 两边都写清楚「我是什么、不是什么」。
- `QUESTIONS = ["超过 30 天的订单退款要谁批?", "客户想退款,流程是什么?"]` 两个问题都没说去哪查。第一个更像内部决定,第二个更像产品操作。

</div>

`uv run python -m part03.pick_tool` 和 `uv run python -m part03.pick_tool clear`:

```text
# 含糊的描述
超过 30 天的订单退款要谁批? -> [['notes_search', 'notes_search'], ['notes_search', 'notes_search'], ['notes_search', 'notes_search']]
客户想退款,流程是什么? -> [['notes_search', 'notes_search'], ['notes_search', 'docs_search'], ['notes_search', 'docs_search']]
6 次调用 | 输入 4674 / 输出 630 tokens | 约 ¥0.0069
# 清楚的描述
超过 30 天的订单退款要谁批? -> [['notes_search', 'notes_search'], ['notes_search', 'notes_search'], ['notes_search', 'docs_search']]
客户想退款,流程是什么? -> [['docs_search', 'notes_search'], ['notes_search', 'docs_search'], ['docs_search', 'notes_search']]
6 次调用 | 输入 5004 / 输出 491 tokens | 约 ¥0.0064
```

结果没有我预想的那么戏剧化。第一个问题两种描述下都主要找 `notes_search`;第二个问题,含糊描述时有一次完全没碰 `docs_search`,清楚描述后三次都两个一起查,其中两次先查文档。

说明两件事。一是工具名本身已经有很强的信号,`notes_` 和 `docs_` 前缀让模型在含糊描述下也大致分得开,这就是原则二的价值。二是**问题本身模棱两可时,描述写得再清楚,模型也会两边都查一遍**,这其实是合理的保险行为,代价是多一次调用。想彻底避免,要么在 system prompt 里说清楚这个助理服务谁,要么像 Day 184 以后那样按场景只挂一组工具。另外我先试过两个说得很明确的问题(「之前开会……」「帮助文档里……」),两种描述下模型都没选错,所以测选择错误一定要用模棱两可的问题。

</details>

### 练习 3:把「宽进」再放宽一点

模型有时会写 `#21`、`第 21 次`、`Meeting-21`。写一个 `normalize(note)` 函数,把这些都规范成 `meeting-21`,`meeting-003` 和 `会议3` 这种不认识的原样返回(交给原则六的报错去处理)。用十个输入测一下。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part03/note_name.py  练习 3:把「宽进」再放宽一点,'#21'、'第 21 次'、'Meeting-21' 都认
import re

NOTE_RE = re.compile(r"(?:meeting-?|#|第)?\s*(\d{1,2})\s*(?:次)?", re.IGNORECASE)


def normalize(note: str) -> str:
    note = note.strip().removesuffix(".md")
    m = NOTE_RE.fullmatch(note)
    return f"meeting-{int(m.group(1)):02d}" if m else note


if __name__ == "__main__":
    for s in ["3", "meeting-3", "meeting03", "Meeting-21", "#21", "第 21 次", "第21次", "meeting-21.md", "meeting-003", "会议3"]:
        print(f"{s!r:16} -> {normalize(s)!r}")
```

<div class="line-notes">

- `NOTE_RE = re.compile(r"(?:meeting-?|#|第)?\s*(\d{1,2})\s*(?:次)?", re.IGNORECASE)` 前缀可以是 `meeting`(横杠可有可无)、`#`、`第` 三者之一,也可以没有;中间允许空格;后面可以跟一个「次」。`re.IGNORECASE` 让 `Meeting` 也能匹配,相当于 JS 正则的 `i` 标志。
- `m = NOTE_RE.fullmatch(note)` 整串匹配,所以 `meeting-003`(三位数)不会被截成 `00` 硬凑。
- `return f"meeting-{int(m.group(1)):02d}" if m else note` 匹配上就规范化,否则原样返回,让后面的 `path.exists()` 去报一个带建议的错。
- `print(f"{s!r:16} -> {normalize(s)!r}")` `!r` 打印带引号的形式,看得出有没有多余的空格;`:16` 补宽对齐。

</div>

运行 `uv run python -m part03.note_name`:

```text
'3'              -> 'meeting-03'
'meeting-3'      -> 'meeting-03'
'meeting03'      -> 'meeting-03'
'Meeting-21'     -> 'meeting-21'
'#21'            -> 'meeting-21'
'第 21 次'         -> 'meeting-21'
'第21次'           -> 'meeting-21'
'meeting-21.md'  -> 'meeting-21'
'meeting-003'    -> 'meeting-003'
'会议3'            -> '会议3'
```

(中文字符在终端里占两个宽度,所以那两行箭头没对齐。)八种写法都认了。宽进要有边界:`会议3` 我故意不认,因为「会议」后面跟数字太宽泛,在别的库里可能是别的意思。认不出的交给报错,报错会告诉模型正确格式,这比猜错一篇笔记要好。想用这个函数,把 `notes_read` 里 `m = re.fullmatch(...)` 那三行换成 `note = normalize(note)` 就行。

</details>

**验收标准:** 你的 `notes_tools_good.py` 跑探针,六行输出和「原则六」那一节一致(字符数会因为路径长度略有不同的只有报错那一行,而原则六之后报错里已经没有路径了,所以应该完全一致);basedpyright 0 errors;不看文章能写出六条原则,每条配一个 Day 180 轨迹里的现象。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 按任务设计 | 照着一个熟练的人完成这件事的操作来切工具,而不是照着底层命令或接口来切。找纪要就是「搜 → 读一段」 |
| 命名空间(namespace) | 在工具名前面加上它属于哪个系统的前缀,如 `notes_search`、`tickets_search`,工具一多也不会撞名 |
| `Annotated` | Python `typing` 里的写法,`Annotated[str, "说明"]` 表示类型还是 `str`,外加一张标签。我们的注册表把标签放进参数的 description |
| `Literal` | `Literal["a", "b"]` 表示只能是这几个值之一,相当于 TS 的联合类型 `"a" | "b"`,注册表会生成 JSON Schema 的 `enum` |
| enum | JSON Schema 里列出参数允许的取值,模型只能从里面选 |
| 宽进严出 | 对模型合理但不精确的输入保持宽容并规范化,工具自己的输出保持统一格式 |
| `response_format` | 让模型选择返回详细程度的参数,concise 省 token,detailed 多给字段 |
| 截断提示 | 返回被截断时告诉模型总数、截掉了多少、怎么拿到想要的,今天是 `total` 和 `hint` |
| `next_start_line` | 分段读取时告诉模型下一段从哪行开始,是「引导下一步」的返回字段 |
| `difflib` | Python 标准库的文本比较模块,`get_close_matches` 按相似度找最接近的几个候选 |
| traceback | 异常的调用栈,一层层写着出错时在哪个文件哪一行。给程序员看的,不适合直接回给模型 |

## 常见误区

**描述写好了就够了。** 第三版的描述让模型学会了用短关键词,可单独搜「退款」还是 31,312 个字符。描述改变的是模型怎么用工具,单次返回多大要靠返回值设计(原则五)。两类改动都要有。

**描述和实现不一致。** 第四版改成去空格比较之后,描述里那句「逐字包含」也要跟着改。描述说的和工具做的不一样,模型会按描述去用,结果和预期不符,比不写还难排查。每次改实现都回头看一眼描述。

**截断时悄悄砍掉。** 只返回前 5 条却不说一共 412 条,模型会以为只有这 5 条,可能就此下结论。截断一定要带上总数和出路。

**宽进没有边界。** `会议3` 这种也硬猜成 `meeting-03`,猜错了模型会拿着错的笔记一本正经地回答。认得准的规范化,认不准的交给报错,让模型自己改。

**把异常原样回给模型。** `FileNotFoundError` 带着服务器上的绝对路径,既不指导下一步,也把内部目录结构暴露了出去。工具里先判断、再返回人话报错。

**工具重名以为不会出事。** 我们的注册表不报错,后登记的悄悄覆盖了先登记的;DeepSeek 直接 400 `Tool names must be unique`。工具多了一定要用命名空间,最好在注册表里加一个重名检查(Day 183 之后的练习可以做)。

**以为描述越长越好。** 描述也按输入 token 收钱,每一步都要带。今天四句话多了 164 个 token,换来的是模型少走弯路,值;但写成一页说明书就过了。三四句、每句消除一个具体的误判,是比较好的长度。

## 学习资料

### 文档与文章

- [Anthropic · Writing effective tools for agents — with agents](https://www.anthropic.com/engineering/writing-tools-for-agents):今天六条原则的主要来源。重点读「Principles for writing effective tools」下面的五小节,从「Choosing the right tools for agents」到「Prompt-engineering your tool descriptions and specs」,40 分钟,英文。
- [Claude 文档 · Define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools):「Best practices for tool definitions」一节,「至少三四句话」和描述要写的四件事出自这里;还有一个好描述和坏描述的对照例子,15 分钟,英文。
- [Python 文档 · typing.Annotated](https://docs.python.org/3/library/typing.html#typing.Annotated):`Annotated` 和 `Literal` 的官方说明,看例子就行,英文。
- [Python 文档 · difflib.get_close_matches](https://docs.python.org/3/library/difflib.html#difflib.get_close_matches):参数 `n` 和 `cutoff` 的含义,`cutoff` 决定多不像就不算候选,英文。
- [SWE-agent 文档 · ACI](https://swe-agent.com/latest/background/aci/):Day 180 读过,今天对照着看他们的搜索命令怎么处理「结果太多」,10 分钟,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12rDYBcErz&autoplay=0&high_quality=1" title="面试官：如何保证 Agent 调用工具 (Function Calling) 的 可靠性？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵AI大模型 · 面试官:如何保证 Agent 调用工具(Function Calling)的可靠性? · 不到 4 分钟,面试题的讲法,听完对照今天的六条原则,看哪几条它提到了、哪几条没提到。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qpQRB2EZ9&autoplay=0&high_quality=1" title="AI Agent 智能体 tools 工具模块的架构设计" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>双越AI_club · AI Agent 智能体 tools 工具模块的架构设计 · 16 分钟,讲一个 Agent 项目里工具模块怎么组织,可以和我们的 ToolRegistry 对照,看工具注册和描述放在哪一层。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/uhJJgc-0iTQ" title="Building more effective AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Building more effective AI agents · Anthropic 官方频道的对谈,里面有工具和 Agent 界面的设计经验,适合读完今天的文章后听一遍,英文可开字幕。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 的「Tools」一节,讲工具清单怎么选、工具多了为什么会变差,和今天的原则一、二对得上,英文。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly, 2024):讲对话式 Agent 的章节里有工具定义的部分,从「工具定义也是提示词」的角度讲描述怎么写,英文。

### 开源项目与代码

- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers):MCP 官方的参考 server 集合,打开 `src/filesystem` 看它的读文件、搜文件工具怎么写描述、怎么限制返回(比如按行范围读),和今天的 `notes_read` 对照,第五部分讲 MCP 时还会回来。
- [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent):看 `tools/` 目录里搜索工具对「结果太多」的处理,和今天的 `limit` + `hint` 是一个思路。

## 自测

1. 六条原则分别是什么?各用一句话说。

<details><summary>答案</summary>

一、按任务设计,照着熟练的人怎么做事来切工具;二、名字无歧义,工具多了加命名空间;三、描述写给聪明但不了解背景的新同事,至少三四句,讲做什么、何时用、参数、限制;四、参数写说明,能枚举就枚举,对合理但不精确的输入宽进严出;五、返回值只给高信号的字段,大小可控,截断要说明,并引导下一步;六、报错要说清错在哪、正确格式是什么、下一步怎么做。

</details>

2. 第三版改了描述,探针的数字一个都没变,为什么还说描述有用?

<details><summary>答案</summary>

探针是直接调用工具,不经过模型,而描述影响的是模型怎么用工具。`first_call.py` 实测:描述只有「搜索」时模型传「超过30天 订单 退款」这种短语,在逐字匹配下全会落空;写清「逐字包含」后它改用「30 天」「退款」这种短关键词。描述改变了行为,但单次返回大小要靠原则五去管。

</details>

3. 把两个都叫 `search` 的工具登记进同一个注册表,会发生什么?

<details><summary>答案</summary>

我们的 `ToolRegistry` 不报错:`schemas` 里有两个 `search`,`funcs` 字典里后登记的覆盖了先登记的,调用时永远执行后一个。发给 DeepSeek 时直接返回 400:`Tool names must be unique`。修法是加命名空间,并在注册表里做重名检查。

</details>

4. `notes_search` 返回 `total` 和 `hint` 有什么用?只返回前 5 条不行吗?

<details><summary>答案</summary>

只返回前 5 条,模型会以为一共就这 5 条,可能据此下错误结论。`total: 412` 告诉它结果被截了,`hint` 告诉它怎么缩小范围(加关键词)或者怎么多拿一点(调大 limit,最大 20)。截断加说明,是「大小可控」和「引导下一步」两件事一起做。

</details>

5. (面试题)你接手一个内部工具 `get_order(id)`,返回订单表的 40 个原始字段。业务方说 Agent「经常查不到订单」「回答里状态说错」。你会怎么改?

<details><summary>答案</summary>

要点:①先读轨迹确认问题:查不到多半是用户说的是订单号或客户名,模型手里没有内部 ID(按接口设计而不是按任务设计);状态说错多半是状态码没翻译,模型在猜;②改成 `orders_search`,按用户会说的东西查(订单号、客户名、日期),带命名空间;③描述写三四句:能查什么、何时用、不返回什么(比如不含发票);④参数写说明,状态这类做成 enum,订单号格式宽进(去空格、大小写、有无前缀);⑤返回只留回答问题需要的字段,编码翻译成文字,结果多时 `limit` + `total` + `hint`;⑥查不到时报错写清格式和下一步,比如「订单号是 ORD- 开头的 8 位数字,你是不是想找 …」;⑦改完用一批真实问题前后对比成功率和 token,不凭感觉。

</details>

## 明天预告

明天是 **Day 183 · 好工具(三):改造前后实测**。今天的探针只证明了单次返回变小了,还没证明 Agent 真的更好用了。明天准备五个带标准答案的任务,让 Agent 分别拿 Day 180 的坏工具和今天的好工具各跑两遍,数成功率、模型调用次数、工具调用次数、报错和 token;再读一遍好工具的轨迹找它的毛病,改两句描述,用一个没参与调优的任务验证有没有改过头。
