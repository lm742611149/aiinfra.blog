---
title: 'Day 11 · 好工具怎么设计:命名、描述、参数、返回值和报错'
description: '同一个模型,换一组工具定义,表现可以从「到处乱翻」变成「两步命中」。今天对照 Anthropic《Writing effective tools for agents》,把一组能用但难用的笔记工具改造成模型顺手的样子,并用实测的字符数说明为什么返回值要精简。'
pubDate: 2026-10-12
regime: none
tags: ['tool-design', 'tool-use', 'context', 'agent-60']
series: 'agent-60'
day: 11
lang: 'zh'
---

## 今天要解决的问题

这三天你已经注意到一个现象:工具描述里加一句「不要心算」,模型就老实调计算器;参数从 `string` 改成 `enum`,模型就不再乱填单位。工具定义对 Agent 行为的影响,比大多数人以为的大得多。Anthropic 在 2025 年 9 月那篇工程博客里说,他们为 SWE-bench 调整工具描述后,Claude 3.5 Sonnet 拿到了当时的最好成绩;Claude 官方文档的工具定义最佳实践第一条就是「写极其详细的描述,这是影响工具效果最重要的因素」。

工具设计也是 Agent 工程师和「会调 API 的人」拉开差距的地方。后者把现有接口原样包一层丢给模型,前者知道接口是给程序员用的,工具是给模型用的,两者的使用者完全不同。今天学完你应该能:

1. 说出工具和普通 API 的根本区别,以及由此推出的六条设计原则。
2. 写出一段让模型「知道什么时候用、什么时候不用、怎么用」的工具描述。
3. 设计参数:名字无歧义、能枚举就枚举、宽进严出。
4. 设计返回值:只给高信号字段,大结果分页或截断,并用返回值引导下一步。
5. 写出能让模型自己纠错的报错信息,并知道工具太多时该怎么办。

预计用时 3–4 小时。前置是 Day 9 的 `agent_loop.py`。今天的例子换成一个「会议纪要助手」,数据由脚本生成,不需要联网。

## 工具不是 API,使用者变了

先想一个问题:你给新入职的同事写一份内部接口文档,和你给一个刚认识的外包写一份任务说明,写法一样吗?不一样。前者你可以假设他慢慢会熟悉,后者你得把背景、边界、注意事项全写清楚,因为他只看这一份说明就要开工。

模型就是那个外包,而且是一个每次都失忆的外包。它对你的系统一无所知,每次请求都从零开始读你给的工具定义,只能靠这几十到几百个 token 理解每个工具能干什么。它还有两个和人类开发者很不一样的特点。一是**上下文是稀缺资源**:你返回 5 万字符的结果,程序员可以 Ctrl+F,模型得把它全部读进来,既花钱又挤掉了其他信息。二是**它会照字面理解**:你的参数叫 `f`,它就只能猜;你的描述写「搜索」,它就不知道是正则还是关键词、是搜文件名还是搜内容。

Anthropic 那篇文章把这件事说得很准:工具是确定性系统和非确定性 Agent 之间的契约,不能按写给开发者的函数或 API 的方式来写。下面的六条原则都是从这句话推出来的。

## 先看一组「能用但难用」的工具

先生成实验数据。下面的脚本造 40 篇会议纪要,每篇几十到一百多行,其中藏着一条「超过 30 天的订单退款需要财务主管审批」的决定:

```python
# agent-60-lab/w2/make_notes.py  造 40 篇假的会议纪要,给今天的工具当数据
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

- `import random` 用伪随机数造数据。
- `random.seed(7)` 种子固定成 7,每次运行抽到的数字序列都一样,你造出来的 40 篇和我的一字不差。实测第一篇抽到:主题「价格调整」、负责人「陈静」、日期 2026-08-11、39 条讨论。
- `root = Path("workspace/notes")` 相对路径,相对的是你运行命令的目录。在仓库根目录跑,就会生成 `agent-60-lab/workspace/notes/`。
- `root.mkdir(parents=True, exist_ok=True)` `parents=True`:workspace 不存在就一起建出来;`exist_ok=True`:目录已经有了也不报错,所以脚本可以反复运行。
- `topics = [` 8 个主题。只有主题刚好是「退款流程」的那几篇,才有机会藏进那条决定。
- `people = [` 5 个负责人,写进每篇的第 2 行。
- `for i in range(1, 41):` i 从 1 到 40,对应 meeting-01 到 meeting-40。
- `topic = random.choice(topics)` 从列表里随机挑一个。实测 40 篇里主题是退款流程的有 6 篇:meeting-11、17、21、22、23、26。
- `owner = random.choice(people)` 每次调用 random 都会消耗一个随机数,所以调用的顺序也会影响后面的结果。改了这里的顺序,整批数据都会变。
- `lines = [f"# {topic} 周会纪要 #{i}"` 前 4 行是:标题、负责人、日期、空行。日期写成 `2026-0{randint(7, 9)}`,硬拼一个 0,是因为月份只会是一位数的 7~9。实测 meeting-01 的前 3 行是 `# 价格调整 周会纪要 #1`、`负责人: 陈静`、`日期: 2026-08-11`。
- `for j in range(random.randint(30, 120)):` 每篇 30~120 条讨论。`randint` 两头都包含。实测 meeting-01 抽到 39 条,加上 4 行开头一共 43 行。
- `lines.append(f"- 第 {j + 1} 条讨论` 讨论内容里也会随机提到「退款流程」,这是故意的。实测 meeting-01 的第 5 行就是 `- 第 1 条讨论:关于退款流程的细节,结论是需要客户确认`,所以搜「退款」会命中大量噪音,下面坏版本 grep 的那几万字符就是这么来的。
- `if topic == "退款流程" and i % 3 == 0:` 两个条件都满足才写决定。`%` 是取余数,`i % 3 == 0` 就是 i 能被 3 整除。退款流程的 6 篇里只有 21 能被 3 整除,所以实测全库只有 **meeting-21** 有这条决定。
- `lines.append("- 决定:` 追加在最后一行。meeting-21 有 37 条讨论,4 + 37 + 1 = 42,这条决定正好在第 42 行。
- `(root / f"meeting-{i:02d}.md").write_text(` `{i:02d}` 表示补零到两位:1 → `01`,21 → `21`。`"\n".join(lines)` 用换行把每一行连起来。
- `print("生成"` 实测输出 `生成 40 篇`。

</div>

然后是一组很多人第一反应会写出来的工具,本质上是把 `ls`、`cat`、`grep` 三个命令包了一层:

```python
# agent-60-lab/w2/notes_tools_bad.py  能用,但模型用起来很痛苦的一组工具
import re
from pathlib import Path

from w2.agent_loop import ToolRegistry

ROOT = Path("workspace/notes").resolve()
bad = ToolRegistry()


@bad.tool
def ls() -> dict:
    """列出文件"""
    return {"files": [{"path": str(p), "size": p.stat().st_size, "mtime": p.stat().st_mtime} for p in sorted(ROOT.iterdir())]}


@bad.tool
def cat(f: str) -> dict:
    """读文件"""
    return {"content": Path(f).read_text(encoding="utf-8")}


@bad.tool
def grep(p: str) -> dict:
    """搜索"""
    hits = []
    for file in sorted(ROOT.glob("*.md")):
        for n, line in enumerate(file.read_text(encoding="utf-8").splitlines(), 1):
            if re.search(p, line):
                hits.append(f"{file}:{n}:{line}")
    return {"result": hits}
```

<div class="line-notes">

- `import re` grep 用正则搜索,这是后面的一个坑。
- `from w2.agent_loop import ToolRegistry` 复用 Day 9 的注册表,导入方式和 Day 9、Day 10 一样带 `w2.` 前缀,所以要在仓库根目录调用,比如 `uv run python -c "from w2.notes_tools_bad import grep; print(len(str(grep('退款'))))"`。
- `ROOT = Path("workspace/notes").resolve()` 转成绝对路径,下面 ls 和 grep 返回的路径都会带上这一长串。
- `bad = ToolRegistry()` 用 Day 9 的注册表,schema 照样自动生成。只是因为下面的参数没写 Annotated,生成出来的 schema 里没有任何参数说明。
- `def ls() -> dict:` 名字是 Unix 黑话,模型大概能猜到意思,但说不准。
- `"""列出文件"""` 描述只有 4 个字:列哪里的文件?什么时候该用?都没说。
- `return {"files": [{"path": str(p)` 每个文件返回绝对路径、字节数和修改时间戳。实测第一条是 `{'path': '/…/workspace/notes/meeting-01.md', 'size': 2807, 'mtime': 1792624099.921519}`,40 条加起来 7,406 个字符(正文里写 7,158,差别来自我这边的目录路径更长,路径越长这个数越大)。`mtime` 是 Unix 时间戳,模型基本用不上。
- `def cat(f: str) -> dict:` 参数叫 `f`,生成的 schema 实测是 `{"f": {"type": "string"}}`,没有任何描述。模型不知道该填文件名还是路径。
- `return {"content": Path(f).read_text` `Path(f)` 是相对**当前工作目录**解析的,跟 ROOT 没有关系。实测 `cat("meeting-03.md")` 直接报 `FileNotFoundError`,一定要传 ls 返回的那串绝对路径才读得到。返回的还是**整篇**内容,不分段。
- `def grep(p: str) -> dict:` 参数叫 `p`。是 pattern 还是 path?模型只能猜。
- `hits = []` 收集所有命中的行,没有任何数量上限。
- `for file in sorted(ROOT.glob("*.md")):` 40 篇全部扫一遍。
- `for n, line in enumerate(` `enumerate(..., 1)` 让行号从 1 开始。
- `if re.search(p, line):` 把模型给的字符串**当正则**来用。模型如果搜 `退款(`,括号不配对,实测通过注册表返回 `{"error": "error: missing ), unterminated subpattern at position 2"}`。描述里一个字都没提「这是正则」,模型很难猜到问题出在哪。
- `hits.append(f"{file}:{n}:{line}")` 每条命中都带完整的绝对路径。
- `return {"result": hits}` 实测 `grep("退款")` 命中 **412 行**,返回 67,570 个字符(正文的 65,098 同样是路径长度不同造成的)。模型真正需要的只是 meeting-21 第 42 行那一条。

</div>

这组工具功能上没有任何问题,一个耐心的程序员用它们完全可以找到答案。但交给模型,问题一大堆。名字 `ls`、`cat`、`grep` 是 Unix 黑话,模型大概能猜到意思,但不知道这里的 `grep` 搜的是内容还是文件名、支不支持中文。参数叫 `f`、`p`,没有描述,模型不知道 `cat` 要的是绝对路径还是文件名。描述只有两三个字,没说什么时候该用。`ls` 返回 40 条记录,每条带绝对路径、字节数、时间戳,模型既用不上 mtime 也看不懂 st_size 的意义。`grep` 没有任何数量限制。

最后一点最致命。我在本机实际跑了一下:用 `grep` 搜「退款」,返回结果有 **65,098 个字符**(每条命中都带绝对路径,你的仓库路径长短不同,这个数会差几千,量级一样)。中文大致一个字一个 token 左右,这一次工具调用就可能吃掉几万 token 的上下文,而模型真正需要的只是其中一行。`ls` 一次也返回 7,158 个字符(同样随路径长短浮动),几乎全是模型用不上的绝对路径和时间戳。

## 六条原则

### 一、按任务设计,不按接口设计

Anthropic 文章里的例子是:不要给模型一个 `list_contacts`,让它把几千个联系人全读一遍再找人;给它一个 `search_contacts`。不要给 `list_users`、`list_events`、`create_event` 三个工具让它自己拼,给一个 `schedule_event` 把查空闲和建会议一起做了。

判断标准是:**一个人类专家完成这个任务时,会怎么操作?** 没有人找会议纪要是先列出全部文件、一篇篇打开读的,大家都是先搜关键词,再打开命中的那篇看上下文。所以工具应该是「搜索」和「读取指定位置」,而不是「列出」和「读取全部」。

Claude 文档里还有一条相关建议:相关操作合并成少数几个功能更强的工具,比如不要拆成 `create_pr`、`review_pr`、`merge_pr` 三个,而是一个带 `action` 参数的工具。工具越少,模型选错的概率越低。

### 二、名字要无歧义,多了就加命名空间

工具名就是模型选工具时最先看的东西。`notes_search` 比 `grep` 好,因为它说清了搜的是什么。当你的工具来自多个系统时(毕业项目里会有知识库、订单系统、工单系统),加上前缀做命名空间:`kb_search`、`orders_search`、`tickets_search`。不然三个都叫 `search`,模型就得靠描述去猜。

参数名同理。Anthropic 举的例子是:别叫 `user`,叫 `user_id`。前者模型可能填用户名、邮箱或者 ID,后者没有歧义。

### 三、描述写给一个聪明但完全不了解背景的新同事

Claude 官方文档给了一个很具体的标准:**每个工具描述至少三四句话**,写清楚四件事:它做什么;什么时候该用,什么时候不该用;每个参数是什么意思、怎么影响行为;有什么限制或注意事项,比如它不返回哪些信息。

看改造后的 `notes_search` 描述:第一句说做什么,第二句说什么场景用、用完下一步该干嘛,第三句说限制(只是关键词匹配,不懂同义词)并给出应对办法,第四句说不该用它干什么。这四句话每一句都在消除模型的一个可能的误判。

### 四、参数:能枚举就枚举,宽进严出

参数设计有三个要点。第一,能用 enum 就别用自由文本,`response_format` 只能是 concise 或 detailed,模型没有机会填出第三种。第二,给合理的默认值,让最常见的调用只需要一个参数。第三,**宽进严出**:对模型可能的「合理但不精确」的输入保持宽容。改造后的 `notes_read` 会把 `3`、`meeting-3` 都自动规范成 `meeting-03`,因为模型从笔记标题「周会纪要 #3」推断文件名时,很自然会写出这种形式。与其让它报错再重试一轮,不如在工具里多写两行。

### 五、返回值:高信号、可控大小、引导下一步

返回值是今天最值得花时间的地方,因为它直接决定上下文被什么东西填满。

**只返回模型推理需要的字段。** 笔记名、行号、那一行的文字,够了。绝对路径、文件大小、修改时间,除非任务需要,否则都是噪音。Anthropic 特别提到,UUID、MIME 类型这类底层技术标识对模型几乎没有意义,能换成有语义的名字就换。

**让模型选择详细程度。** `response_format` 参数让模型自己决定要简洁版还是详细版。Anthropic 文章里的数据是,简洁版大约只用详细版三分之一的 token。大部分时候模型只需要定位,定位到了再要细节。

**大结果分页或截断,并告诉模型还有多少。** `notes_search` 默认只返回 5 条,超出时在 `hint` 里写「还有 407 条没显示,可以加关键词缩小范围」。`notes_read` 默认读 40 行,还有内容时返回 `next_start_line`。注意不是简单地砍掉,而是告诉模型「被砍了多少、怎么拿到剩下的」。Claude Code 默认把单次工具返回限制在 25,000 token,这是一个可以参考的量级,我们这里收得更紧。

**用返回值引导下一步。** `hint` 字段、`next_start_line` 字段,以及 Day 10 待办清单工具返回的 `next`,都是在告诉模型接下来该怎么做。工具返回值本身就是提示词的一部分,别浪费它。

### 六、报错信息要能指导纠正

对比两种报错:`FileNotFoundError: [Errno 2] No such file or directory: 'meetng-03'` 和「没有叫 'meetng-03' 的笔记。笔记名格式是 'meeting-两位数字'。你是不是想找 ['meeting-03', ...]?」。前者模型大概能看懂,但要自己猜怎么改;后者直接告诉了它格式规则和最可能的正确答案。

好的报错信息回答三个问题:错在哪,正确的格式或取值是什么,建议的下一步是什么。改造版里用 `difflib.get_close_matches` 做了一个简单的「你是不是想找」,一行代码,能省掉模型好几轮瞎试。

## 改造后的版本

```python
# agent-60-lab/w2/notes_tools.py  按 Anthropic 工具设计原则改造后的版本
import difflib
import re
from pathlib import Path
from typing import Annotated, Literal

from w2.agent_loop import ToolRegistry

ROOT = Path("workspace/notes").resolve()
good = ToolRegistry()


def _note_names() -> list[str]:
    return sorted(p.stem for p in ROOT.glob("*.md"))


@good.tool
def notes_search(
    query: Annotated[str, "要找的关键词或短语,普通文本,不是正则。例如 '退款 审批'。多个词用空格分开,表示都要出现"],
    limit: Annotated[int, "最多返回几条命中,默认 5,最大 20"] = 5,
    response_format: Annotated[Literal["concise", "detailed"], "concise 只给笔记名和命中的那一行;detailed 额外给负责人、日期和上下文"] = "concise",
) -> dict:
    """在团队的会议纪要库(约 40 篇)里按关键词搜索,返回命中的笔记名和对应的行。
    用户问「之前开会怎么定的」「谁负责 X」这类问题时先用它定位,再用 notes_read 读具体内容。
    搜索是简单的关键词包含匹配,不理解同义词:搜不到时换个说法再试,比如「退钱」换成「退款」。
    不要用它来列出全部笔记。"""
    words = query.split()
    limit = max(1, min(limit, 20))
    hits = []
    for path in sorted(ROOT.glob("*.md")):
        lines = path.read_text(encoding="utf-8").splitlines()
        for n, line in enumerate(lines, 1):
            if all(w in line for w in words):
                hit = {"note": path.stem, "line": n, "text": line.strip()[:120]}
                if response_format == "detailed":
                    hit["title"] = lines[0].lstrip("# ")
                    hit["owner"] = lines[1].replace("负责人: ", "")
                    hit["date"] = lines[2].replace("日期: ", "")
                    hit["context"] = [s.strip()[:80] for s in lines[max(0, n - 2):n + 1]]
                hits.append(hit)
    if not hits:
        return {"total": 0, "hits": [], "hint": f"没有一行同时包含 {words}。试试更少或更换关键词,比如只搜其中一个词。"}
    out = {"total": len(hits), "hits": hits[:limit]}
    if len(hits) > limit:
        out["hint"] = f"还有 {len(hits) - limit} 条没显示。可以加关键词缩小范围,或调大 limit(最大 20)。"
    return out


@good.tool
def notes_read(
    note: Annotated[str, "笔记名,用 notes_search 返回的 note 字段,例如 'meeting-03'"],
    start_line: Annotated[int, "从第几行开始读,默认 1"] = 1,
    max_lines: Annotated[int, "最多读几行,默认 40,最大 200"] = 40,
) -> dict:
    """读取一篇会议纪要的指定行范围,每行带行号。
    通常先用 notes_search 找到笔记名和行号,再从那一行附近开始读。长笔记会分段返回,用 next_start_line 继续读。"""
    note = note.strip().removesuffix(".md")
    m = re.fullmatch(r"(?:meeting-?)?(\d{1,2})", note)  # 宽容输入:'3'、'meeting-3' 都当成 meeting-03
    if m:
        note = f"meeting-{int(m.group(1)):02d}"
    path = ROOT / f"{note}.md"
    if not path.exists():
        close = difflib.get_close_matches(note, _note_names(), n=3)
        tip = f"你是不是想找 {close}?" if close else "请先用 notes_search 按内容搜索,拿到 note 字段再来读。"
        return {"error": f"没有叫 '{note}' 的笔记。笔记名格式是 'meeting-两位数字'。{tip}"}
    lines = path.read_text(encoding="utf-8").splitlines()
    max_lines = max(1, min(max_lines, 200))
    start = max(1, start_line)
    chunk = lines[start - 1:start - 1 + max_lines]
    end = start + len(chunk) - 1
    out = {"note": path.stem, "total_lines": len(lines), "lines": [f"{i}: {s}" for i, s in enumerate(chunk, start)]}
    if end < len(lines):
        out["next_start_line"] = end + 1
    return out
```

<div class="line-notes">

- `import difflib` 标准库,做「你是不是想找」的模糊匹配,不用装任何东西。
- `from w2.agent_loop import ToolRegistry` 同上,带 `w2.` 前缀,从仓库根目录运行。
- `ROOT = Path("workspace/notes").resolve()` 和坏版本一样,但下面不会再把这串路径返回给模型。
- `good = ToolRegistry()` 新的注册表,只放两个工具。
- `def _note_names() -> list[str]:` 下划线开头,不加 `@good.tool`,所以它不是工具,只是内部的小帮手。
- `return sorted(p.stem for p in ROOT.glob("*.md"))` `.stem` 是去掉扩展名的文件名:`meeting-03.md` → `meeting-03`。括号里的写法是生成器表达式,直接交给 sorted 排序。
- `def notes_search(` 名字带上了 `notes_` 前缀:搜的是会议纪要,以后工具多了也不会和别的 search 混淆。
- `query: Annotated[str` 说明写清楚了「普通文本,不是正则」和「多个词空格分开,表示都要出现」。实测生成的 schema 里,这段话原样出现在 description 中。
- `limit: Annotated[int` 默认 5,说明里写了最大 20。
- `response_format: Annotated[Literal` 生成 `"enum": ["concise", "detailed"]`,模型只能二选一,填不出第三种。
- `"""在团队的会议纪要库` 描述的第一句:做什么、范围多大(约 40 篇)、返回什么。
- `用户问「之前开会怎么定的」` 第二句:什么时候用,用完下一步该干嘛。
- `搜索是简单的关键词包含匹配` 第三句:限制和对策。实测搜「退钱」返回 total 0,换成「退款」就有结果。
- `不要用它来列出全部笔记。"""` 第四句:什么时候不该用。
- `words = query.split()` `split()` 不带参数时按任意空白切开,并去掉空串。实测 `"退款 审批".split()` 得到 `['退款', '审批']`。
- `limit = max(1, min(limit, 20))` 把 limit 夹在 1~20 之间。实测传 99,返回 20 条;传 0,返回 1 条。这就是「宽进严出」:模型传错也不报错,直接帮它修正到合理范围。
- `hits = []` 先收集全部命中,最后再截断,这样才知道总共有多少条。
- `for path in sorted(ROOT.glob("*.md")):` 按文件名顺序扫,结果顺序是稳定的。
- `lines = path.read_text(encoding="utf-8").splitlines()` 拆成行列表,下面的 detailed 模式要用 `lines[0]`、`lines[1]`、`lines[2]` 取标题、负责人和日期。
- `for n, line in enumerate(lines, 1):` 行号从 1 开始,和编辑器里看到的一致,模型拿去给 notes_read 用时不用换算。
- `if all(w in line for w in words):` `all(...)` 要求每个词都在这一行里,用的是 `in` 做子串判断,不是正则。实测「退款 审批」只命中 1 行:meeting-21 第 42 行。只搜「退款」则命中 412 行。
- `hit = {"note": path.stem` 只给三样东西:笔记名、行号、这一行的文字。`.strip()[:120]` 去掉首尾空白,最多保留 120 个字符。
- `if response_format == "detailed":` 模型说要细节时才多给。
- `hit["title"] = lines[0].lstrip("# ")` 注意 `lstrip("# ")` 的意思是「从左边去掉所有 `#` 和空格字符」,不是去掉 `"# "` 这个前缀。这里碰巧效果一样。实测得到 `退款流程 周会纪要 #21`。
- `hit["owner"] = lines[1].replace(` 实测 `负责人: 张伟` → `张伟`。
- `hit["date"] = lines[2].replace(` 实测 `2026-09-21`。
- `hit["context"] = [` 本意是取「上一行 + 这一行 + 下一行」。n 是从 1 开始的行号,列表下标从 0 开始,所以切片 `lines[n-2:n+1]` 对应的是第 n-1、n、n+1 行。实测 n=42 是最后一行,没有下一行,只拿到 2 条:`['- 第 37 条讨论:关于价格调整的细节,结论是继续观察', '- 决定:超过 30 天的订单退款需要财务主管审批']`。
- `hits.append(hit)` 实测 concise 版本的一条命中是 `{"note": "meeting-21", "line": 42, "text": "- 决定:超过 30 天的订单退款需要财务主管审批"}`。
- `if not hits:` 一条都没命中时,不返回空列表让模型干瞪眼。
- `return {"total": 0, "hits": []` 实测搜「退钱」返回 `{'total': 0, 'hits': [], 'hint': "没有一行同时包含 ['退钱']。试试更少或更换关键词,比如只搜其中一个词。"}`。
- `out = {"total": len(hits), "hits": hits[:limit]}` total 是总数,hits 只给前 limit 条。
- `if len(hits) > limit:` 实测搜「退款」:412 > 5,条件成立。
- `out["hint"] = f"还有` 实测 hint 是 `还有 407 条没显示。可以加关键词缩小范围,或调大 limit(最大 20)。`(412 - 5 = 407)。
- `return out` 实测「退款 审批」的完整返回是 `{"total": 1, "hits": [{"note": "meeting-21", "line": 42, "text": "- 决定:超过 30 天的订单退款需要财务主管审批"}]}`,一共 95 个字符。
- `def notes_read(` 读取「指定的行范围」,而不是整篇。
- `note: Annotated[str` 说明里直接告诉模型「用 notes_search 返回的 note 字段」,把两个工具串了起来。
- `start_line: Annotated[int` 默认从第 1 行开始。
- `max_lines: Annotated[int` 默认读 40 行,最多 200 行。
- `"""读取一篇会议纪要的指定行范围` 描述里写了分段读的方法:看 `next_start_line`。
- `note = note.strip().removesuffix(".md")` `removesuffix`(Python 3.9+)只去掉结尾的 `.md`,没有就原样返回。实测 `'meeting-03.md'` → `'meeting-03'`。
- `m = re.fullmatch(` `fullmatch` 要求**整个字符串**都符合模式。`(?:meeting-?)?` 表示「meeting 加可有可无的横杠」这一整段都可以省略,`(?:...)` 是不捕获的分组。实测 `'3'`、`'meeting-3'`、`'meeting03'` 都能匹配,`'meeting-003'` 不行(超过两位数字)。
- `if m:` 能匹配上就统一改写成标准格式。
- `note = f"meeting-{int(m.group(1)):02d}"` `int('3')` → 3,再补零 → `meeting-03`。实测 `'3'`、`'meeting-3'`、`' meeting03 '` 三种写法都读到了同一篇:`# 订阅升级 周会纪要 #3`。
- `path = ROOT / f"{note}.md"` 拼出完整路径。注意这里没有坏版本那种「相对当前目录」的问题。
- `if not path.exists():` 找不到文件时,给出能指导模型改正的报错。
- `close = difflib.get_close_matches(` 按相似度找最接近的名字,最多 3 个。实测 `'meetng-03'` 得到 `['meeting-03', 'meeting-40', 'meeting-39']`,排第一的就是正确答案。
- `tip = f"你是不是想找` 有相近的就列出来;一个都没有(实测传 `'会议3'`),就建议先用 notes_search 搜。
- `return {"error": f"没有叫` 实测:`{"error": "没有叫 'meetng-03' 的笔记。笔记名格式是 'meeting-两位数字'。你是不是想找 ['meeting-03', 'meeting-40', 'meeting-39']?"}`。错在哪、正确格式是什么、下一步怎么做,三样都有了。
- `lines = path.read_text(encoding="utf-8").splitlines()` meeting-21 实测一共 42 行。
- `max_lines = max(1, min(max_lines, 200))` 和 search 里的 limit 一样,把取值夹在合理范围内。
- `start = max(1, start_line)` 模型传 0 或负数,都当成从第 1 行开始。
- `chunk = lines[start - 1:start - 1 + max_lines]` 行号转成下标要减 1。代入 `notes_read("meeting-21", start_line=40, max_lines=5)`:切片 `lines[39:44]`,但文件只有 42 行,切片越界不会报错,只返回 3 行。
- `end = start + len(chunk) - 1` 实际读到的最后一行号:40 + 3 - 1 = 42。
- `out = {"note": path.stem, "total_lines"` 每行前面加上行号,`enumerate(chunk, start)` 让编号从 start 开始。上面的例子返回 `["40: - 第 36 条讨论:…", "41: - 第 37 条讨论:…", "42: - 决定:超过 30 天的订单退款需要财务主管审批"]`。
- `if end < len(lines):` 后面还有内容,才给出继续读的位置。上面的例子 42 < 42 不成立,所以没有 next_start_line。
- `out["next_start_line"] = end + 1` 代入默认参数 `notes_read("meeting-21")`:读到第 1~40 行,`end=40 < 42`,返回 `next_start_line: 41`,模型下一次从 41 行接着读就行。
- `return out` 实测 `notes_read("meeting-3", max_lines=3)` 返回 `{"note": "meeting-03", "total_lines": 46, "lines": ["1: # 订阅升级 周会纪要 #3", "2: 负责人: 陈静", "3: 日期: 2026-08-11"], "next_start_line": 4}`,和正文给出的真实输出一致。

</div>

我在本机不调模型、直接调用工具函数,对比了两组工具的返回(这些是真实输出):

```text
# 坏版本 grep("退款") 返回的字符数
65098
# 好版本 notes_search("退款 审批") 的完整返回(95 个字符)
{"total": 1, "hits": [{"note": "meeting-21", "line": 42, "text": "- 决定:超过 30 天的订单退款需要财务主管审批"}]}
# 好版本对模糊输入 notes_read("meeting-3", max_lines=3)
{"note": "meeting-03", "total_lines": 46, "lines": ["1: # 订阅升级 周会纪要 #3", "2: 负责人: 陈静", "3: 日期: 2026-08-11"], "next_start_line": 4}
# 好版本对拼错的输入 notes_read("meetng-03")
{"error": "没有叫 'meetng-03' 的笔记。笔记名格式是 'meeting-两位数字'。你是不是想找 ['meeting-03', 'meeting-40', 'meeting-39']?"}
```

65,098 对 95,同一个问题,上下文开销差了将近 700 倍。当然这里有点不公平,好版本搜了两个词、坏版本搜了一个,但这恰恰是设计的一部分:好版本的描述告诉了模型「多个词用空格分开、表示都要出现」,鼓励它做更精确的搜索。Anthropic 的原话是引导 Agent 采用「多次小而精准的搜索」,而不是一次宽泛的搜索。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="坏工具与好工具单次返回字符数对比条形图">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="30" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">单次工具返回的字符数(本机实测,同一份 40 篇笔记)</text>
  <text x="20" y="72" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">grep("退款")</text>
  <rect x="190" y="58" width="420" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="600" y="74" text-anchor="end" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">65,098</text>
  <text x="20" y="112" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">ls()</text>
  <rect x="190" y="98" width="46" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="244" y="114" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">7,158</text>
  <text x="20" y="152" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">notes_search(…)</text>
  <rect x="190" y="138" width="2" height="22" fill="var(--mem)"/>
  <text x="200" y="154" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">95</text>
  <text x="20" y="200" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">条形长度按比例画;95 个字符在这个比例下不到 1 像素,所以画成一条细线</text>
</svg>
<figcaption>返回值设计对上下文开销的影响。坏版本把整个结果集倒给模型,好版本只给定位所需的最少信息,剩下的按需再取。</figcaption>
</figure>

## 工具太多怎么办

一个实际系统的工具数量很容易膨胀。接一个 GitHub MCP server 就是几十个工具,再接 Slack、Jira、数据库,上百个不稀奇。这会带来两个问题:每次请求都要发送全部工具定义,光定义就能占几万 token;工具越多,模型越容易选错,尤其是功能相近的工具。

Anthropic 在 2025 年 11 月的《Introducing advanced tool use》里提到,工具定义和结果在 Agent 读到用户请求之前就可能消耗 5 万以上 token。应对办法大致有几层,从简单到复杂:

**合并和裁剪。** 先看看是不是真需要这么多。很多工具可以用 action 参数合并,很多工具在当前场景根本用不上。按场景只挂载需要的子集,是最便宜也最有效的办法。

**分层路由。** 先用一个分类步骤判断这次请求属于哪个领域(订单、知识库、账号),只把这个领域的工具交给 Agent。这其实是 Day 13 要讲的 routing 模式。

**工具搜索。** 给模型一个「搜索工具」的工具,其他工具的定义先不加载,模型需要时先搜、再加载匹配的那几个。Anthropic 平台提供了原生的 Tool Search Tool(把工具标成延迟加载即可),你也可以用 Day 15 学的 embedding 自己实现一个。

**让模型写代码来调工具。** 同一篇文章里的另一个思路叫 Programmatic Tool Calling:与其让模型一轮一轮地调工具、每轮都把中间结果塞进上下文,不如让它写一段代码在沙箱里批量调用,只把最终结果返回。这个方向变化很快,知道有这么回事即可,具体用法以官方文档为准。

## 怎么知道工具改好了

最后一个问题:你改了描述、改了返回值,怎么证明变好了?凭感觉跑几次是不够的,模型的行为有随机性,三次成功可能只是运气。

Anthropic 推荐的流程是评测驱动的:先准备一批真实的多步任务,每个任务配一个可验证的结果;让 Agent 在简单循环里跑这些任务,记录每次的耗时、工具调用次数、token 消耗和报错;然后读轨迹,找规律。比如同一个工具被反复调用,通常说明分页或返回数量有问题;某个参数经常填错,通常说明描述不清楚。改完再跑一遍,并且留一部分任务不参与调优,防止过拟合。

他们还提到一个很有意思的做法:把轨迹交给 Claude Code,让它分析并改写工具描述。用 Agent 优化给 Agent 用的工具。这套流程我们在 W5 会完整实践,今天的练习先做一个简化版。

## 动手练习

**练习 1:生成数据并对比返回大小。** 在仓库根目录运行 `uv run python -m w2.make_notes`,然后不调模型,直接调用两组工具,把返回的字符数记下来。确认你得到的数字和上文的量级一致。

**练习 2:同一个问题,两组工具。** 用 Day 9 的 `Agent` 分别挂坏工具和好工具,问同一个问题:「之前开会对超过 30 天的订单退款是怎么定的?谁负责的那次会?」。每组跑 3 次,填下表(空表,填你的实测):

| 工具组 | 平均模型调用次数 | 平均 prompt_tokens 总数 | 答对次数(3 次) | 典型的失败方式 |
| --- | --- | --- | --- | --- |
| 坏版本 | | | | |
| 好版本 | | | | |

**练习 3:改一个你自己的工具。** 回到 Day 8–9 的 `get_weather`,按六条原则审一遍:描述有没有三四句话?返回值里 `country` 字段模型用得上吗?城市找不到时的报错能指导纠正吗?改完写一段 100 字的改动说明。

**练习 4:加一个命名空间冲突。** 再写一个 `docs_search` 工具(搜另一个目录的产品文档),描述故意写得和 `notes_search` 很像,观察模型会不会选错。然后改描述,讲清两者的区别(一个是内部会议记录,一个是对外产品文档),再测。

**验收标准:** 练习 2 的表格填满,好版本的 token 总量明显低于坏版本(量级上的差距,不是百分之几),答对率不低于坏版本;练习 3 和练习 4 各有一份改动前后的描述对比和一句话结论。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 工具定义(tool definition) | 名字、描述、参数 schema 的组合,模型据此决定是否及如何调用 |
| 命名空间(namespacing) | 用前缀区分不同系统的工具,如 `kb_search`、`orders_search` |
| 宽进严出 | 对输入宽容地规范化,对输出严格控制格式和大小 |
| response_format | 让模型选择返回简洁版还是详细版的参数 |
| 分页 / 截断 | 只返回部分结果,同时告诉模型总数和如何获取剩余部分 |
| 高信号字段 | 对模型下一步推理真正有用的信息,与之相对的是 UUID、时间戳等噪音 |
| 可操作的报错 | 说明错在哪、正确格式是什么、建议下一步怎么做的错误信息 |
| 工具过载 | 工具太多导致上下文膨胀和选择错误 |
| Tool Search / 延迟加载 | 工具定义先不发给模型,需要时再搜索加载 |
| Programmatic Tool Calling | 让模型写代码批量调用工具,只把最终结果放回上下文 |

## 常见误区

**把现有 REST 接口原样包成工具。** 接口是按资源和 CRUD 设计的,工具应该按任务设计。原样包装通常意味着模型要调很多次、读很多无用字段。

**描述越短越好,省 token。** 描述省下的几十个 token,和模型选错工具、填错参数导致的多轮重试相比微不足道。Claude 文档的建议是每个工具至少三四句。真正该省的是返回值。

**返回值什么都给,反正模型会挑。** 模型会挑,但读进来的每个字都要花钱、都会挤占上下文,还会干扰注意力。只给需要的,按需再取。

**截断时不告诉模型。** 静默截断会让模型以为它看到的就是全部,得出错误结论。截断必须附带「总共多少、还剩多少、怎么取」。

**报错直接抛 Python traceback。** 模型能看懂一部分,但 traceback 里大半是无关的调用栈。写一句人话,告诉它怎么改。

**改了工具不做对比测试。** 一次成功不说明问题。至少固定一组问题,改前改后各跑几次,比较调用次数、token 和正确率。

## 学习资料

### 文档与文章

- [Anthropic · Writing effective tools for agents — with agents](https://www.anthropic.com/engineering/writing-tools-for-agents):今天的核心读物,2025 年 9 月发布,通读,1 小时。
- [Claude 文档 · 定义工具](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools):「Best practices for tool definitions」一节,三四句话的标准、合并操作、命名空间都在这里,20 分钟。
- [Anthropic · Introducing advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use):工具太多时的三个新办法(Tool Search、Programmatic Tool Calling、工具使用示例),30 分钟。
- [OpenAI · Function calling 指南](https://platform.openai.com/docs/guides/function-calling):里面也有一节函数定义最佳实践,和 Anthropic 的说法基本一致,可以对照,15 分钟。
- [MCP 规范 · Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools):MCP 的工具定义格式,先扫一眼,Day 22 会细讲,10 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aaxyz8ELY&p=15&autoplay=0&high_quality=1" title="吴恩达《Agentic AI》中英双语 · 模块3 创建工具" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达机器学习(搬运)· (中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程 · 第 15 P「创建工具」,5 分钟,讲工具描述怎么写才能让模型正确选择。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ymrCBeESA&autoplay=0&high_quality=1" title="【Agent入门】3.工具调用实现原理" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>花里胡哨的汤无际 · 【Agent入门】3.工具调用实现原理 · 39 分钟,讲工具定义如何被渲染进提示词,看完就明白为什么描述的每个字都会影响模型。</figcaption>
</figure>

- 朱老师AI课堂《工具越多,Agent越傻?「工具过载」怎么解决?》(BV1ePKb6REi4,2 分钟):对应「工具太多怎么办」一节的快速版。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · Anthropic 工程师的圆桌对话,里面谈到「站在模型的角度看工具」这个习惯,和今天的主题直接相关。</figcaption>
</figure>

- Anthropic《Prompting for Agents | Code w/ Claude》(YouTube `XSZP9GhhuAc`):讲 Agent 场景的提示词和工具说明怎么写,有很多具体例子。
- AI Papers《Writing effective tools for AI agents (feat. Anthropic)》(YouTube `07Ugw2WTjFk`):对 Anthropic 文章的逐段讲解,读原文吃力时看。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agents 部分的「Tools」一节,讲工具清单怎么选、工具多了模型为什么会变差,以及只读工具和写操作工具的区别。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly, 2024):第 8 章「Conversational Agency」的 Tool Usage 部分,从提示词工程的角度讲工具定义,两位作者都参与过 GitHub Copilot 的开发。

### 开源项目与代码

- [anthropics/claude-cookbooks · tool_use](https://github.com/anthropics/claude-cookbooks/tree/main/tool_use):Anthropic 官方的工具调用示例集,看看他们自己的工具描述怎么写,1 小时。
- [modelcontextprotocol.io](https://modelcontextprotocol.io/):挑一两个官方或热门 MCP server,读它们的工具描述,好的和坏的都会看到,作为设计参考。

## 自测

1. 工具和普通 REST API 的使用者有什么不同?由此推出的最重要的一条设计原则是什么?

<details><summary>答案</summary>

API 的使用者是程序员,能看文档、能 Ctrl+F、会慢慢熟悉系统;工具的使用者是模型,每次从零读定义、上下文有限且昂贵、按字面理解。最重要的原则是按任务设计工具,而不是按接口原样包装,同时让每个工具的定义自带足够的上下文。

</details>

2. `search_contacts` 为什么比 `list_contacts` 更适合给 Agent 用?

<details><summary>答案</summary>

`list_contacts` 会把所有联系人倒进上下文,模型得自己逐条找,既浪费 token 又容易漏看;`search_contacts` 让查找发生在工具内部,只返回命中的少量结果。这对应「按任务设计」和「返回高信号信息」两条原则。

</details>

3. 工具结果需要截断时,只截断而不说明会有什么问题?正确的做法是什么?

<details><summary>答案</summary>

模型会以为看到的就是全部数据,可能得出错误结论(比如以为只有 5 条记录)。正确做法是同时返回总数、已返回的数量,以及如何获取剩余部分(下一页参数、缩小范围的建议)。

</details>

4. 下面这个参数定义有什么问题,怎么改?`{"name": "user", "type": "string", "description": "用户"}`

<details><summary>答案</summary>

名字和描述都有歧义,模型不知道该填用户名、邮箱还是 ID。改成 `user_id`,描述写清格式和来源,例如「用户的数字 ID,形如 '10086',可以从 customers_search 的结果里拿到」。

</details>

5. (面试题)「你的 Agent 接了 80 个工具,效果变差、成本变高,你怎么优化?」

<details><summary>答案</summary>

分层回答:先审计,合并功能相近的工具、删掉场景用不到的;按场景只挂载子集,或者先做一次意图路由再挂对应领域的工具;工具数量仍然很大时用工具搜索/延迟加载;每个工具加命名空间、改进描述减少混淆;返回值精简、加分页;最后用一组固定任务做对比评测,看调用准确率、步数和 token 的变化来证明优化有效。

</details>

6. 「返回值里加 hint 字段告诉模型下一步」,这算不算把业务逻辑塞进了工具?你怎么看?

<details><summary>答案</summary>

算是一种轻量的引导,不是业务逻辑。它不替模型做决定,只是提供「下一步可以怎么做」的信息,相当于给新同事的使用提示。好处是减少模型的无效尝试;需要注意的是 hint 要准确,错误的 hint 会把模型引向歧途,所以 hint 也应该被评测覆盖。

</details>

## 明天预告

工具设计得再好,Agent 也会出错:参数解析失败、工具超时、同一个调用来回重复、模型编出一个不存在的工具名。明天(Day 12)讲 **Agent 的失败模式**:把常见的失败分成几类,逐类给出代码层面的治法,包括重试与退避、超时、预算上限、循环检测和优雅地转人工。
