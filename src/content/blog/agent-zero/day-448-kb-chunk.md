---
title: 'Day 448 · 知识库(一):按小标题切块,给每块戴帽子'
description: '把 62 篇帮助中心文章按 ## 小标题切成 150 块,每块只带自己的原文,送去向量化时再戴上一顶「文章标题 > 小标题」的帽子。用 40 条客户问法实测:不戴帽子第一名对 34 条,戴了 39 条;让模型给每块写一句话当帽子,反而回到 34 条。顺手把 LLMClient 搬进 SupportPilot,并抓出滑窗切块的一个真 bug。'
pubDate: 2026-10-27
regime: none
tags: ['capstone', 'supportpilot', 'rag', 'chunking', 'agent-zero']
series: 'agent-zero'
day: 448
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 447](/blog/agent-zero/day-447-week64-review/) 把骨架这一周收了尾:仓库、配置、数据库、62 篇帮助中心文章、200 个客户和 459 张账单、Makefile 和测试都在。可是到现在为止,`data/kb/` 里的文章还只是躺在磁盘上的 markdown,Agent 一篇都读不了。

今天开始往仓库里放真正的功能,第一个是知识库。Agent 回答政策问题,靠的是先从知识库里找出几段相关的话,再让模型照着答。找之前得先把文章加工成「能找」的样子:一篇文章拆成一小块一小块,每块配上它的来历。这件事你在 [Day 224](/blog/agent-zero/day-224-chunking/) 对着 42 块的小语料做过一遍,今天换成 SupportPilot 自己的 62 篇,写进仓库,配上测试。

## 今天要解决的问题

今天只有两个新东西:**按小标题切块**,和给每块**戴帽子**。学完你应该能:

1. 写出 `src/supportpilot/kb/chunker.py`,把 62 篇文章切成 150 块,每块知道自己出自哪篇、哪一节。
2. 说清「帽子」是什么、为什么只戴在送去向量化的那份文本上,并且会用一组带标准答案的问法,量出帽子到底有没有用。
3. 把练习仓库里的 `LLMClient` 搬进 SupportPilot(Day 439 发现它得提前到今天),并知道搬的时候要改哪几行。

预计用时 3 小时。花费:模型调用约 ¥0.09(给 150 块各写一句话当对照,下面有算式;练习 3 再花 ¥0.08),embedding 用硅基流动的 bge-m3,免费。前置:[Day 443](/blog/agent-zero/day-443-database/) 的 `kb.chunks` 表、[Day 444](/blog/agent-zero/day-444-kb-generate/) 生成的 `data/kb/`、[Day 50](/blog/agent-zero/day-050-dataclass/) 的 dataclass、[Day 43](/blog/agent-zero/day-043-classes-3/) 的 `@property`、[Day 217](/blog/agent-zero/day-217-embed-service/) 的 embedding、[Day 135](/blog/agent-zero/day-135-llm-client-1/) 到 [Day 137](/blog/agent-zero/day-137-llm-client-3/) 的 `LLMClient`。

学法照旧:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `chunk_article()` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端的角度看一眼

一篇帮助中心文章,说白了就是一页 markdown:一个 `# 标题`,几个 `## 小标题`,每个小标题下面一两段话。前端同学拆这种东西很熟:`html.split(/^## /m)`,每一段变成一张卡片。切块就是这件事,只是卡片不是给人翻的,是给检索用的。

用户问「月付能退钱吗」,检索系统在库里找最像的几张卡片,把卡片原文交给模型。所以卡片要满足两条:**够小**,一张卡片只讲一件事,找回来的东西不夹带无关内容;**自带出处**,卡片被单独拿出来时,看得出它出自哪篇文章。切块解决第一条,帽子解决第二条。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="一篇文章按小标题切成块,每块拼上帽子后送去向量化,原文单独存进数据库">
<g font-family="var(--font-mono)" font-size="11">
<rect x="10" y="30" width="150" height="150" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="85" y="50" text-anchor="middle" fill="var(--ink)">KB-refund-004.md</text>
<text x="22" y="76" fill="var(--ink-soft)"># 月付可以退款吗</text>
<text x="22" y="104" fill="var(--ink)">## 规则</text>
<text x="22" y="120" fill="var(--ink-soft)">月付订阅不支持退款…</text>
<text x="22" y="148" fill="var(--ink)">## 例外</text>
<text x="22" y="164" fill="var(--ink-soft)">重复扣款可以退…</text>
<rect x="215" y="40" width="190" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="225" y="58" fill="var(--ink)">帽子:月付可以退款吗 &gt; 规则</text>
<text x="225" y="78" fill="var(--ink-soft)">原文:月付订阅不支持退款…</text>
<rect x="215" y="118" width="190" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="225" y="136" fill="var(--ink)">帽子:月付可以退款吗 &gt; 例外</text>
<text x="225" y="156" fill="var(--ink-soft)">原文:重复扣款可以退…</text>
<rect x="460" y="40" width="170" height="56" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="545" y="62" text-anchor="middle" fill="var(--ink)">帽子 + 原文 → bge-m3</text>
<text x="545" y="80" text-anchor="middle" fill="var(--ink-soft)">得到 1024 个数</text>
<rect x="460" y="118" width="170" height="56" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="545" y="140" text-anchor="middle" fill="var(--ink)">只存原文</text>
<text x="545" y="158" text-anchor="middle" fill="var(--ink-soft)">kb.chunks.content</text>
</g>
<g stroke="var(--ink-faint)" stroke-width="1.3">
<line x1="160" y1="95" x2="213" y2="68"/><line x1="160" y1="125" x2="213" y2="146"/>
<line x1="405" y1="68" x2="458" y2="68"/><line x1="405" y1="146" x2="458" y2="146"/>
</g>
</svg>
<figcaption>一节一块。帽子只拼在送去向量化的那份文本前面;存进数据库、拿去给模型和用户看的,仍然是不带帽子的原文。</figcaption>
</figure>

## 第一步:先切一刀,看看切出来是什么

先别急着写类,拿 Day 444 生成的一篇小文章,用一个正则切一刀,看清楚切出来的每一段是什么。在 `~/supportpilot` 里新建 `scratch/s1_split.py`(`scratch/` 是 Day 441 建的草稿目录,README 里写了它不提交),从仓库根目录运行:

```python
# supportpilot/scratch/s1_split.py
import re
from pathlib import Path

raw = Path("data/kb/KB-refund-002.md").read_text(encoding="utf-8")
parts = re.split(r"^## +", raw, flags=re.M)
print(len(parts))
for i, p in enumerate(parts):
    print(i, repr(p))
```

<div class="line-notes">

- `import re` Python 自带的正则表达式模块,相当于 JS 里的 `RegExp`。
- `from pathlib import Path` [Day 37](/blog/agent-zero/day-037-pathlib/) 学过的路径对象。
- `raw = Path("data/kb/KB-refund-002.md").read_text(encoding="utf-8")` 整个文件读成一个字符串。路径是相对仓库根目录的,所以要在 `~/supportpilot` 里运行。
- `parts = re.split(r"^## +", raw, flags=re.M)` 按「行首的 `## ` 加若干空格」切。`r"..."` 是原始字符串,反斜杠不用写两遍。`^` 默认只匹配整个字符串的开头,加了 `flags=re.M`(MULTILINE)才变成匹配每一行的开头。忘了 `re.M` 会怎样?一刀都切不出来,`parts` 里只有整篇文章一段。
- `print(len(parts))` 这篇文章有两个小标题,所以切出 3 段:第 0 段是第一个 `## ` 之前的东西,后面每个小标题各一段。
- `for i, p in enumerate(parts):` `enumerate` 同时给出序号和内容,相当于 JS 的 `parts.forEach((p, i) => ...)`。
- `print(i, repr(p))` `repr` 把换行显示成 `\n`,空白看得清楚。
</div>

```bash
uv run python scratch/s1_split.py
```

```text
3
0 '---\nid: KB-refund-002\ntitle: 年付 14 天无理由退款\ncategory: refund\nupdated_at: 2026-09-15\nurl_path: /help/refund/002\n---\n\n# 年付 14 天无理由退款\n\n'
1 '条件\n\n首次购买的年付订阅,从付款日起 14 天内(含第 14 天)申请,全额退款,不需要说明理由。\n\n'
2 '不适用\n\n续费订单、企业版合同订单不适用 14 天无理由退款。续费订单按续费 7 天规则处理。\n'
```

三段里,第 1、2 段就是我们要的:开头是小标题的名字(`条件`、`不适用`),然后一个空行,然后正文。第 0 段不是内容,它是文件开头那一截:`---` 夹着的 frontmatter(文章的编号、标题、分类这些元数据),再加一行 `# 年付 14 天无理由退款`。这一段要单独处理,不能当成一块。

## 第二步:读出 frontmatter

frontmatter 是文章最前面两条 `---` 之间的几行 `键: 值`。前端同学应该在 Astro、Hexo 这类静态站点里见过。要把它拆成字典,同时留下后面的正文。新建 `scratch/s2_meta.py`:

```python
# supportpilot/scratch/s2_meta.py
import re
from pathlib import Path

raw = Path("data/kb/KB-refund-002.md").read_text(encoding="utf-8")
m = re.match(r"^---\n(.*?)\n---\n(.*)$", raw, re.S)
assert m is not None
head, body = m.group(1), m.group(2)
print(repr(head))
pairs = [line.split(": ", 1) for line in head.splitlines() if ": " in line]
print(pairs)
meta = dict(pairs)
print(meta["title"], meta["url_path"])
print(repr(body.strip()[:40]))
```

<div class="line-notes">

- `m = re.match(r"^---\n(.*?)\n---\n(.*)$", raw, re.S)` 两个括号是两个「捕获组」:第 1 组是两条 `---` 之间的 frontmatter,第 2 组是剩下的全部。`.*?` 里的 `?` 表示「尽量少吃」,遇到第一个 `\n---\n` 就停,不会一路吃到文件末尾。`re.S` 让 `.` 也能匹配换行符,不加的话 `.*?` 到行尾就断了。
- `assert m is not None` 没匹配上时 `re.match` 返回 `None`。这里先用 `assert` 挡一下,正式代码里会换成抛异常。
- `head, body = m.group(1), m.group(2)` 取出两个捕获组,同时赋给两个变量(元组解包,[Day 22](/blog/agent-zero/day-022-tuples-unpack/))。
- `print(repr(head))` 五行,每行 `键: 值`,行与行之间是 `\n`。
- `pairs = [line.split(": ", 1) for line in head.splitlines() if ": " in line]` 列表推导式([Day 23](/blog/agent-zero/day-023-comprehensions/))。`splitlines()` 把 `head` 按行切开,每行再按第一个 `": "` 切成两半。第二个参数 `1` 是「只切一刀」,所以值里再出现冒号也不怕,比如以后有人把标题写成 `退款:年付`。
- `print(pairs)` 五个两元素列表,比如 `['title', '年付 14 天无理由退款']`。
- `meta = dict(pairs)` `dict()` 能把「两元素列表组成的列表」直接变成字典,相当于 JS 的 `Object.fromEntries(pairs)`。
- `print(meta["title"], meta["url_path"])` 按名字取值。少了任何一个键会抛 `KeyError`,这是好事:文章格式不对就该立刻停下来。
- `print(repr(body.strip()[:40]))` 正文去掉首尾空白后,开头是 `# 年付 14 天无理由退款\n\n## 条件…`。
</div>

```bash
uv run python scratch/s2_meta.py
```

```text
'id: KB-refund-002\ntitle: 年付 14 天无理由退款\ncategory: refund\nupdated_at: 2026-09-15\nurl_path: /help/refund/002'
[['id', 'KB-refund-002'], ['title', '年付 14 天无理由退款'], ['category', 'refund'], ['updated_at', '2026-09-15'], ['url_path', '/help/refund/002']]
年付 14 天无理由退款 /help/refund/002
'# 年付 14 天无理由退款\n\n## 条件\n\n首次购买的年付订阅,从付款日起 1'
```

元数据和正文分开了。接下来只切正文。

## 第三步:一节一块,装进 Chunk

现在把「按小标题切」和「装进对象」合在一起。块用 [Day 50](/blog/agent-zero/day-050-dataclass/) 学的 dataclass 来装:一块有序号、小标题、原文三样东西。换一篇有五个小节的文章试试,新建 `scratch/s3_chunks.py`:

```python
# supportpilot/scratch/s3_chunks.py
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Chunk:
    index: int
    heading: str
    text: str


body = Path("data/kb/KB-refund-001.md").read_text(encoding="utf-8").split("---\n", 2)[2]
parts = re.split(r"^## +", body, flags=re.M)
print(len(parts), "段;第 0 段是", repr(parts[0]))
chunks: list[Chunk] = []
for part in parts[1:]:
    heading, _, text = part.partition("\n")
    chunks.append(Chunk(len(chunks), heading.strip(), text.strip()))
for c in chunks:
    print(c.index, c.heading, len(c.text), c.text[:30])
```

<div class="line-notes">

- `@dataclass` 自动生成 `__init__`,所以下面可以直接 `Chunk(0, "条件", "...")`。
- `class Chunk:` 一块的三个字段:`index` 是这篇文章里的第几块,`heading` 是小标题,`text` 是原文。
- `body = Path("data/kb/KB-refund-001.md").read_text(encoding="utf-8").split("---\n", 2)[2]` 偷个懒:按 `"---\n"` 最多切两刀,得到三段,取下标 2 那一段就是正文。第二步的正则才是正式写法,这里只为了让脚本短。
- `parts = re.split(r"^## +", body, flags=re.M)` 和第一步一样。
- `print(len(parts), "段;第 0 段是", repr(parts[0]))` 退款政策总览有 5 个小节,所以是 6 段;第 0 段只剩 `'\n# 退款政策总览\n\n'`,没有任何内容。
- `chunks: list[Chunk] = []` 先准备一个空列表,类型标注告诉 Zed 里面装的是 `Chunk`。
- `for part in parts[1:]:` 跳过第 0 段。`parts[1:]` 是切片,从下标 1 取到末尾。
- `heading, _, text = part.partition("\n")` `partition` 按第一个换行符把字符串切成三份:前面、分隔符、后面。`'年付首次购买\n\n年付订阅首次购买后…'` 得到 `heading='年付首次购买'`,`text='\n年付订阅首次购买后…'`。中间的分隔符用不上,用 `_` 接住。
- `chunks.append(Chunk(len(chunks), heading.strip(), text.strip()))` 序号用 `len(chunks)`:追加之前列表里有几个,这一块就是第几号,天然从 0 开始递增。两个 `strip()` 去掉首尾的空行。
- `print(c.index, c.heading, len(c.text), c.text[:30])` 打印序号、小标题、字数和前 30 个字。
</div>

```bash
uv run python scratch/s3_chunks.py
```

```text
6 段;第 0 段是 '\n# 退款政策总览\n\n'
0 年付首次购买 35 年付订阅首次购买后 14 天内(含第 14 天)可无理由申请
1 年付超过 14 天 69 超过 14 天的年付订阅,按剩余完整月份比例退款,并扣除 1
2 年付续费 20 年付自动续费后 7 天内可申请全额退款。
3 月付 45 月付订阅不支持退款,可以关闭自动续费,当期到期后停止。重复扣
4 审核 41 所有退款都要经过人工审核,审核通过后才会发起退款。客服和智能
```

5 个小节切出 5 块,最短 20 个字(年付续费),最长 69 个字。你可能觉得这也太短了。帮助中心的文章就是这样,一节一两句话。块的大小没有标准答案,要看你的文档长什么样:几百页的 PDF 一块也许要几百字,我们这种问答式的短文,一节一块正好。

## 第四步:一节太长怎么办

62 篇文章里没有哪一节长到需要再切,但知识库会增长,总会来一篇长文章。所以要有个兜底:一节超过上限,就按句子攒,攒到快超了就收一块。收块的时候,下一块要从上一块的末尾带一小段重复的字(叫**重叠**,overlap),免得一句话刚好被拦腰切断,两边都看不懂。新建 `scratch/s4_window.py`:

```python
# supportpilot/scratch/s4_window.py
import re


def split_long(text: str, max_chars: int, overlap: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    sentences = re.split(r"(?<=[。！？；\n])", text)
    pieces: list[str] = []
    cur = ""
    for s in sentences:
        if len(cur) + len(s) > max_chars and cur:
            pieces.append(cur)
            cur = cur[-overlap:]
        cur += s
    if cur.strip():
        pieces.append(cur)
    return pieces


text = "".join(f"第{i}条:付款后第{i}天内提交申请,系统会自动核对订单。" for i in range(1, 21))
print(len(text), repr(text[:28]))
pieces = split_long(text, max_chars=200, overlap=30)
for n, p in enumerate(pieces):
    print(n, len(p), repr(p[:12]), "…", repr(p[-12:]))
print(pieces[1][:30] == pieces[0][-30:])
print(repr(pieces[0][-30:]))
```

<div class="line-notes">

- `def split_long(text: str, max_chars: int, overlap: int) -> list[str]:` 输入一段长文本、每块最多多少字、重叠多少字,返回切好的字符串列表。
- `if len(text) <= max_chars:` 不超长就原样返回,帮助中心的文章全走这一条。
- `return [text]` 包成只有一个元素的列表,让调用方永远拿到列表。
- `sentences = re.split(r"(?<=[。！？；\n])", text)` `(?<=...)` 叫「后行断言」:在这些标点的**后面**切,标点留在前一句的末尾,不会丢。方括号里是全角的句号、感叹号、问号、分号和换行。
- `pieces: list[str] = []` 收好的块放这里。
- `cur = ""` 正在攒的这一块。
- `for s in sentences:` 一句一句往里加。
- `if len(cur) + len(s) > max_chars and cur:` 再加这一句就超了,并且手里已经攒着东西。`and cur` 防止一句话本身就超过上限时,先塞出一个空块。
- `pieces.append(cur)` 把攒好的这块收走。
- `cur = cur[-overlap:]` 新的一块不从零开始,而是从刚收走那块的最后 `overlap` 个字开始,这就是重叠。`cur[-30:]` 是切片,取最后 30 个字。
- `cur += s` 把这一句接在后面。
- `if cur.strip():` 循环结束,手里可能还剩一点,收进最后一块。
- `text = "".join(f"第{i}条:付款后第{i}天内提交申请,系统会自动核对订单。" for i in range(1, 21))` 造 20 句假话,每句 27 个字。`"".join(...)` 把它们连成一个 542 个字的长文本。
- `pieces = split_long(text, max_chars=200, overlap=30)` 每块最多 200 字,重叠 30 字。
- `print(n, len(p), repr(p[:12]), "…", repr(p[-12:]))` 打印每块的序号、字数、开头 12 个字和结尾 12 个字。
- `print(pieces[1][:30] == pieces[0][-30:])` 验证重叠:第 1 块的前 30 个字,应该正好等于第 0 块的最后 30 个字。
</div>

```bash
uv run python scratch/s4_window.py
```

```text
542 '第1条:付款后第1天内提交申请,系统会自动核对订单。第2'
0 182 '第1条:付款后第1天内提' … '请,系统会自动核对订单。'
1 194 '对订单。第7条:付款后第' … '请,系统会自动核对订单。'
2 198 '单。第13条:付款后第1' … '请,系统会自动核对订单。'
3 58 '单。第19条:付款后第1' … '请,系统会自动核对订单。'
True
'对订单。第7条:付款后第7天内提交申请,系统会自动核对订单。'
```

542 个字切成 4 块:182、194、198、58。每块都不超过 200,最后一块是剩下的零头。验证那一行打印 `True`:第 1 块的开头确实是第 0 块的结尾。最后一行把重叠的那 30 个字打出来:`对订单。第7条:付款后第7天内提交申请,系统会自动核对订单。`,可以看到重叠是从一句话的中间(「对订单。」)开始的,所以新一块的开头会是半句话。这是重叠的代价,换来的是跨块的句子不会完全丢失。

## 第五步:拼成 chunker.py,然后抓一个 bug

四个零件都齐了,拼成项目里的文件。下面这张表是零件和最终文件的对应关系:

| 零件 | 在 `chunker.py` 里的位置 |
| --- | --- |
| 第二步的 `re.match` + `dict(pairs)` | `parse_article()`,返回一个 `Article` |
| 第三步的 `Chunk` | 加了 `doc_id`、`title` 两个字段 |
| 第三步的按 `##` 切 | `chunk_article()` 的前半 |
| 第四步的 `split_long` | 原样搬进来,`chunk_article()` 的后半调用它 |
| 戴帽子 | 第六步讲,先看 `Chunk.hat` 和 `make_hat()` |
| 读整个目录 | `load_articles()`,后面几天的脚本都要用 |

先在 `src/supportpilot/kb/` 下建 `__init__.py`(空文件,[Day 33](/blog/agent-zero/day-033-packages/) 讲过包为什么需要它),再新建 `chunker.py`。注意这是**我第一次拼出来的版本**,`split_long` 照第四步原样搬,后面马上会看到它有个毛病:

```bash
mkdir -p src/supportpilot/kb && touch src/supportpilot/kb/__init__.py
```

```python
# supportpilot/src/supportpilot/kb/chunker.py
"""把一篇帮助中心文章读成 Article,再按 ## 小标题切成 Chunk,每块带一顶「帽子」。"""

import re
from dataclasses import dataclass
from pathlib import Path

MAX_CHARS = 400  # 一节超过这个字数,就按句子再切
OVERLAP = 60  # 再切时,下一块带上上一块末尾的这么多字


@dataclass
class Article:
    id: str
    title: str
    category: str
    url_path: str
    updated_at: str
    body: str  # 去掉 frontmatter 之后的 markdown 正文


@dataclass
class Chunk:
    doc_id: str
    index: int  # 这是这篇文章的第几块,从 0 开始
    title: str  # 所属文章的标题
    heading: str  # 所属小标题
    text: str  # 原文片段:给模型看、给人看、给用户点开

    @property
    def hat(self) -> str:
        return make_hat(self.title, self.heading)

    @property
    def embed_text(self) -> str:
        """送去向量化的文本:帽子 + 原文。"""
        return f"{self.hat}\n{self.text}"


def make_hat(title: str, heading: str) -> str:
    """帽子:这块话出自哪篇文章的哪一节。"""
    return f"{title} > {heading}"


def parse_article(raw: str) -> Article:
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", raw, re.S)
    if not m:
        raise ValueError("缺少 frontmatter")
    meta = dict(line.split(": ", 1) for line in m.group(1).splitlines() if ": " in line)
    return Article(
        id=meta["id"],
        title=meta["title"],
        category=meta["category"],
        url_path=meta["url_path"],
        updated_at=meta["updated_at"],
        body=m.group(2).strip(),
    )


def load_articles(kb_dir: Path) -> list[Article]:
    """读一个目录下所有 .md 文章,按文件名排序,每次顺序都一样。"""
    return [parse_article(p.read_text(encoding="utf-8")) for p in sorted(kb_dir.glob("*.md"))]


def split_long(text: str, max_chars: int = MAX_CHARS, overlap: int = OVERLAP) -> list[str]:
    """一节太长时,按句子攒到快超过 max_chars 就收一块,下一块带上上一块的尾巴。"""
    if len(text) <= max_chars:
        return [text]
    sentences = re.split(r"(?<=[。！？；\n])", text)
    pieces: list[str] = []
    cur = ""
    for s in sentences:
        if len(cur) + len(s) > max_chars and cur:
            pieces.append(cur)
            cur = cur[-overlap:]
        cur += s
    if cur.strip():
        pieces.append(cur)
    return pieces


def chunk_article(article: Article, max_chars: int = MAX_CHARS, overlap: int = OVERLAP) -> list[Chunk]:
    """按 ## 小标题切。没有任何小标题的文章,整篇当一节,小标题用文章标题。"""
    parts = re.split(r"^## +", article.body, flags=re.M)
    sections: list[tuple[str, str]] = []
    if len(parts) == 1:
        sections.append((article.title, article.body.removeprefix(f"# {article.title}").strip()))
    else:
        for part in parts[1:]:  # parts[0] 是 "# 标题" 那一行,不是内容
            heading, _, text = part.partition("\n")
            sections.append((heading.strip(), text.strip()))
    chunks: list[Chunk] = []
    for heading, text in sections:
        if not text:
            continue
        for piece in split_long(text, max_chars, overlap):
            chunks.append(Chunk(article.id, len(chunks), article.title, heading, piece))
    return chunks
```

<div class="line-notes">

- `import re` 三个导入:正则、dataclass、路径。
- `MAX_CHARS = 400  # 一节超过这个字数,就按句子再切` 两个常量放在文件顶部,想调的时候一眼找得到。400 字是个够宽的上限,我们最长的节只有 178 字。
- `OVERLAP = 60` 重叠 60 字。
- `class Article:` 一篇文章。五个元数据字段加一个 `body`,就是第二步的 `meta` 和 `body`。
- `body: str  # 去掉 frontmatter 之后的 markdown 正文` 开头是 `# 标题`,然后是各个 `## 小节`。
- `class Chunk:` 一块,比第三步多了 `doc_id` 和 `title`:块被单独拿出来时,要知道自己出自哪篇、那篇叫什么。
- `index: int  # 这是这篇文章的第几块,从 0 开始` 和 `doc_id` 一起,`(doc_id, index)` 就是一块的唯一编号,`kb.chunks` 表的 `UNIQUE (doc_id, chunk_index)` 也是这个意思。
- `text: str  # 原文片段` 只放原文,不带任何前缀。给模型看、给客户点开,都用它。
- `@property` 让方法像属性一样用,调用写 `c.hat` 不带括号([Day 43](/blog/agent-zero/day-043-classes-3/))。
- `def hat(self) -> str:` 帽子是算出来的,不存。
- `return make_hat(self.title, self.heading)` 帽子怎么写,统一交给 `make_hat()`,只此一处。
- `def embed_text(self) -> str:` 送去向量化的文本。
- `return f"{self.hat}\n{self.text}"` 帽子一行,原文接在下面一行。
- `def make_hat(title: str, heading: str) -> str:` 帽子的写法:`文章标题 > 小标题`。`>` 和 Day 224 的面包屑写法保持一致。
- `def parse_article(raw: str) -> Article:` 第二步的代码正式版。
- `m = re.match(` 同第二步。
- `raise ValueError("缺少 frontmatter")` 第二步用 `assert` 偷了懒,这里换成真的异常。传一个 `"# 没有 frontmatter"` 进来,报的就是 `ValueError: 缺少 frontmatter`。
- `meta = dict(line.split(": ", 1)` 第二步的两行合成一行。
- `return Article(` 五个字段按名字取,正文 `.strip()` 去掉首尾空白。
- `def load_articles(kb_dir: Path) -> list[Article]:` 读一个目录里所有 `.md`。
- `sorted(kb_dir.glob("*.md"))` `glob` 找出所有匹配的文件,`sorted` 让顺序固定。顺序固定很重要:以后评测、导入的日志都要能逐行对上。
- `def split_long(` 第四步的函数,原样搬进来(这是有 bug 的版本)。
- `sentences = re.split(` 同第四步。
- `def chunk_article(` 正式的切块函数,参数里的 `max_chars`、`overlap` 默认取文件顶部的常量。
- `parts = re.split(r"^## +", article.body, flags=re.M)` 第一步和第三步的那一刀。
- `if len(parts) == 1:` 只有一段,说明整篇文章一个 `## ` 都没有。这种文章整篇当一节,小标题借用文章标题。第三步没处理这种情况,正式代码要考虑。
- `article.body.removeprefix(f"# {article.title}").strip()` 去掉开头那行 `# 标题`,剩下的才是正文。`removeprefix` 是 Python 3.9 起有的字符串方法。
- `for part in parts[1:]:  # parts[0]` 有小标题的文章,跳过第 0 段。
- `heading, _, text = part.partition("\n")` 第三步同样的一行。
- `if not text:` 小标题下面什么都没有的空节,直接跳过,不产生空块。空文本送去 embedding 会报错([Day 217](/blog/agent-zero/day-217-embed-service/) 的 `_clean`)。
- `for piece in split_long(text, max_chars, overlap):` 一节正常是一块;超长才会变几块。
- `chunks.append(Chunk(article.id, len(chunks), article.title, heading, piece))` 序号用 `len(chunks)`,所以即使跳过了空节,序号仍然连续。
</div>

先让它把 62 篇全切一遍,看数字对不对。这里还要一个「报告脚本」,以后每次改切块规则都跑一下。新建 `scripts/chunk_report.py`:

```python
# supportpilot/scripts/chunk_report.py
"""把 data/kb/ 全部切一遍,打印块数和长度,看切得对不对。"""

from collections import Counter
from pathlib import Path

from supportpilot.kb.chunker import chunk_article, load_articles

KB_DIR = Path(__file__).resolve().parent.parent / "data" / "kb"


def main() -> None:
    articles = load_articles(KB_DIR)
    chunks = [c for a in articles for c in chunk_article(a)]
    lengths = [len(c.text) for c in chunks]
    print(f"文章 {len(articles)} 篇,切出 {len(chunks)} 块")
    print(f"每块字数:最短 {min(lengths)},最长 {max(lengths)},平均 {sum(lengths) / len(lengths):.1f}")
    docs_of: dict[str, set[str]] = {}
    for c in chunks:
        docs_of.setdefault(c.heading, set()).add(c.doc_id)
    shared = [c for c in chunks if len(docs_of[c.heading]) > 1]
    print(f"不同的小标题 {len(docs_of)} 个;小标题在不止一篇文章里出现的块有 {len(shared)} 块")
    print("出现最多的小标题:", Counter(c.heading for c in chunks).most_common(5))


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from collections import Counter` 数数用的字典,传一个列表给它,它返回「每个元素出现几次」。
- `KB_DIR = Path(__file__).resolve().parent.parent / "data" / "kb"` 脚本在 `scripts/` 里,往上两级是仓库根目录,再进 `data/kb`。用 `__file__` 定位,从哪个目录运行都找得到。
- `articles = load_articles(KB_DIR)` 读 62 篇。
- `chunks = [c for a in articles for c in chunk_article(a)]` 双层推导式:对每篇文章,把它切出的每一块都收进同一个扁平列表。
- `lengths = [len(c.text) for c in chunks]` 每块原文的字数。
- `print(f"文章 {len(articles)} 篇,切出 {len(chunks)} 块")` 62 篇切出 150 块。
- `docs_of: dict[str, set[str]] = {}` 键是小标题,值是「用过这个小标题的文章编号集合」。集合([Day 25](/blog/agent-zero/day-025-sets/))自带去重。
- `docs_of.setdefault(c.heading, set()).add(c.doc_id)` `setdefault` 在键不存在时先放进一个空集合,再返回它,然后 `.add` 加一个编号。
- `shared = [c for c in chunks if len(docs_of[c.heading]) > 1]` 小标题在不止一篇文章里出现的块,第六步要用这个数字。
- `Counter(c.heading for c in chunks).most_common(5)` 出现次数最多的 5 个小标题。
</div>

```bash
uv run python scripts/chunk_report.py
```

```text
文章 62 篇,切出 150 块
每块字数:最短 13,最长 178,平均 40.2
不同的小标题 91 个;小标题在不止一篇文章里出现的块有 71 块
出现最多的小标题: [('原因', 13), ('报错含义', 12), ('处理步骤', 12), ('仍未解决', 12), ('操作', 6)]
```

62 篇切出 150 块,最短 13 个字,最长 178,平均 40 个字。记住 150 这个数字,Day 449 导入以后库里也应该是 150 行。

最后一行先放一边,第六步会讲。现在把切块参数调小,逼出长文本的路径。真实数据里没有哪一节超过 400 字,`split_long` 从来没被调用过,它对不对,只能故意用小参数去试。新建 `scratch/c4.py`:

```python
# supportpilot/scratch/c4.py
from pathlib import Path

from supportpilot.kb.chunker import chunk_article, load_articles

arts = load_articles(Path("data/kb"))
for max_chars, overlap in [(400, 60), (100, 20), (60, 10)]:
    chunks = [c for a in arts for c in chunk_article(a, max_chars, overlap)]
    lens = [len(c.text) for c in chunks]
    print(max_chars, overlap, len(chunks), max(lens))
chunks = [c for a in arts for c in chunk_article(a, 60, 10)]
for c in chunks:
    if c.doc_id == "KB-plans-001" and c.heading == "价格":
        print(c.index, len(c.text), repr(c.text))
```

<div class="line-notes">

- `arts = load_articles(Path("data/kb"))` 读 62 篇。
- `for max_chars, overlap in [(400, 60), (100, 20), (60, 10)]:` 三组参数:默认的、小一点的、很小的。元组直接在 `for` 里解包。
- `chunks = [c for a in arts for c in chunk_article(a, max_chars, overlap)]` 每组参数把 62 篇重切一遍。
- `print(max_chars, overlap, len(chunks), max(lens))` 打印参数、总块数、最长一块的字数。
- `chunks = [c for a in arts for c in chunk_article(a, 60, 10)]` 再用最小的那组切一遍,留着下面看细节。
- `if c.doc_id == "KB-plans-001" and c.heading == "价格":` 挑出一篇最长的节,这一节有 126 个字。
- `print(c.index, len(c.text), repr(c.text))` 打印每一块的序号、字数和全文。
</div>

```bash
uv run python scratch/c4.py
```

```text
400 60 150 178
100 20 153 93
60 10 169 80
0 48 '免费版 0 元。标准版 39 元/月,年付 374 元。专业版 99 元/月,年付 950 元。'
1 23 ',年付 950 元。年付相当于月付价格打八折。'
2 75 '当于月付价格打八折。企业版按席位计费,每人每月 59 元,最少 5 席,只能年付(起步 3,540 元/年),含专属客户成功经理和 SSO 单点登录。'
3 10 ' SSO 单点登录。'
```

两处不对劲。**第一,最后一块只有 10 个字,`' SSO 单点登录。'`,它和第 2 块的结尾一模一样。** 这一块里没有一个字是新的,纯粹是上一块尾巴的重复,而且检索时它会和第 2 块抢名次。**第二,第 2 块有 75 个字,超过了上限 60。** 这个不是 bug:这一节有一句话 65 个字,没有任何标点可以切,`split_long` 只按句子切,一句话再长也不拆。这是已知限制,留着,在注释里写清楚就行。

第一个才是 bug。顺着代码想:`re.split` 切一段以「。」结尾的文本,会在最后多出一个空字符串 `''`(正则「在句号后面切」,最后一个句号后面还有一个「空」)。循环走到这个空串时,条件 `len(cur) + len(s) > max_chars and cur` 里,`len(s)` 是 0,但 `cur` 已经是 75 个字、超过 60,条件成立,于是把 `cur` 收走,再把 `cur` 换成它的最后 10 个字当新一块的开头。循环结束,`cur` 里剩的就是这 10 个字的重叠,`cur.strip()` 不为空,又被当成一块收进去。

修法分两步。一,碰到空串直接跳过。二,用一个标记 `fresh` 记住「`cur` 里有没有新内容」,只剩重叠的尾巴时不算。`chunker.py` 里 `split_long` 的循环改成:

```python
    cur = ""
    fresh = False  # cur 里有没有「新内容」;只剩上一块的尾巴时不算
    for s in sentences:
        if not s:  # re.split 在句号结尾处会多给一个空串
            continue
        if fresh and len(cur) + len(s) > max_chars:
            pieces.append(cur)
            cur = cur[-overlap:]
            fresh = False
        cur += s
        fresh = True
    if fresh:
        pieces.append(cur)
    return pieces
```

<div class="line-notes">

- `fresh = False` 刚开始手里没有任何新内容。
- `if not s:` 空串直接跳过,`continue` 进入下一轮。这一条治「多出来的空串」。
- `if fresh and len(cur) + len(s) > max_chars:` 原来的 `and cur` 换成 `fresh`:手里只有重叠尾巴时,哪怕再来一个很长的句子,也不能把尾巴单独收成一块。
- `fresh = False` 刚收走一块,新的 `cur` 只有重叠,算「没有新内容」。
- `cur += s` 接上这一句。
- `fresh = True` 接上以后就有新内容了。
- `if fresh:` 最后一块只有真的有新内容才收。原来的 `cur.strip()` 不管这个。
</div>

(最终的 `chunker.py` 里 `split_long` 就是上面这个样子,这一段是替换原来的循环部分。)再跑一次:

```bash
uv run python scratch/c4.py
```

```text
400 60 150 178
100 20 153 93
60 10 162 80
0 48 '免费版 0 元。标准版 39 元/月,年付 374 元。专业版 99 元/月,年付 950 元。'
1 23 ',年付 950 元。年付相当于月付价格打八折。'
2 75 '当于月付价格打八折。企业版按席位计费,每人每月 59 元,最少 5 席,只能年付(起步 3,540 元/年),含专属客户成功经理和 SSO 单点登录。'
```

最小参数下的块数从 169 降到 162:7 篇文章各少了一个重复的尾巴块。默认参数和 `(100, 20)` 那一组本来就没触发这个问题,数字不变。这个 bug 在真实数据上、默认参数下根本不会出现,是故意用小参数才逼出来的。**不跑一遍极端参数,你永远不知道兜底的那条路是不是通的。** 回头给它补一条测试,第九步写。

## 第六步:为什么要戴帽子

回到 `chunk_report.py` 最后两行输出:

```text
不同的小标题 91 个;小标题在不止一篇文章里出现的块有 71 块
出现最多的小标题: [('原因', 13), ('报错含义', 12), ('处理步骤', 12), ('仍未解决', 12), ('操作', 6)]
```

150 块里有 71 块的小标题和别的文章撞名。报错码那 12 篇文章,每篇都有「报错含义」「原因」「处理步骤」「仍未解决」四节。看两块:

```text
KB-account-005「开启两步验证」的「操作」块:
    「设置 - 账户安全 - 两步验证」,用验证器 App 扫码绑定。开启后每次在新设备登录都要输入 6 位动态码。
KB-billing-002「如何关闭自动续费」的「操作」块:
    进入「设置 - 订阅与账单」,点击「关闭自动续费」。关闭后当前周期照常使用,到期后不再扣款。
```

单看原文,第二块讲的是关闭自动续费,第一块讲的是两步验证,看得出来。可是有些块就不行:`KB-refund-004`「月付可以退款吗」的「规则」块,原文是「月付订阅不支持退款。如果不想继续使用,关闭自动续费即可,当期结束后不再扣款。」它和「怎么关闭自动续费」那篇的「操作」块说的话重叠很多,只靠这 40 来个字,向量分不清客户问的是哪件事。

办法是给每块**戴一顶帽子**:送去向量化的时候,在原文前面加一行「文章标题 > 小标题」,变成:

```text
月付可以退款吗 > 规则
月付订阅不支持退款。如果不想继续使用,关闭自动续费即可,当期结束后不再扣款。
```

这样向量里就带上了「这是在讲月付能不能退款」。这个做法是 Anthropic 那篇 [Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) 的简化版:原文的做法是让模型给每一块写一段上下文再拼上去,效果更好,但每块要多调一次模型。我们的文章结构规整,标题本身就是现成的上下文,直接拼,零成本。

两个设计要点,都已经体现在 `chunker.py` 里了。**帽子只加在 `embed_text` 上,`text` 不动。** `kb.chunks.content` 存的是 `text`,模型和客户看到的引用原文是干净的;帽子只在算向量那一刻拼上。**帽子的写法只在 `make_hat()` 一处。** 以后想换格式,改一个函数,不会出现导入用一种、检索用另一种。(这一点第九步的测试和 Day 449 的指纹都会用到。)

先别信「帽子有用」这句话,量一下。

## 第七步:先把 LLMClient 搬进项目

下面的对照实验里有一组要让模型给每块写一句话当帽子,会用到 `LLMClient`。正好,[Day 439](/blog/agent-zero/day-439-schedule-cost/) 的排期检查发现一个错:`llm.py` 当初排在 Day 457,可是知识库的导入和检索都要它,所以得提前到今天。Day 457 要做的是往里**加**东西,不是**建**它。

底子就是你在 Day 135–137 写的 `common/llm.py`。把它复制进项目:

```bash
cp ~/agent-zero-lab/common/llm.py src/supportpilot/llm.py
```

(`~/agent-zero-lab` 是 [Day 10](/blog/agent-zero/day-010-uv-1/) 建的练习仓库,路径以你自己的为准。)复制过来不改也能跑,但有一个很隐蔽的坑,因为它读配置的方式和 SupportPilot 不一样。练习仓库的 `LLMClient` 自己调 `load_dotenv()`,再去 `os.environ` 里取 `LLM_MODEL`、`LLM_PRICE` 这些变量。SupportPilot 的配置全部归 [Day 442](/blog/agent-zero/day-442-config/) 的 `Settings` 管,而且 `Settings` 里没有 `LLM_PRICE`,价格是 `PRICE_IN_PER_M` 和 `PRICE_OUT_PER_M` 两项(元/百万 token,没有缓存命中价那一档,按最贵的算)。原封不动的版本我试了一次:能回答,`r.cost` 却是 `0.0`,因为读不到价格,悄悄当成了全 0。输出是 `你好!很高兴见到你……  5 10 0.0`(5 个输入、10 个输出 token,价格 0 元)。不报错的错最麻烦,所以要改:只改三处,导入、`__init__` 的签名、`__init__` 的函数体。

1. 文件开头,删掉 `import json`、`import os` 和 `from dotenv import load_dotenv`,在 `from openai import OpenAI` 后面加一行 `from .config import Settings, get_settings`。
2. `__init__` 整个换成下面这样:

```python
    def __init__(self, settings: Settings | None = None, **overrides: Any) -> None:
        s = settings or get_settings()
        self.model: str = overrides.get("model") or s.llm_model
        self.price = overrides.get("price") or Price(s.price_in_per_m, s.price_in_per_m, s.price_out_per_m)
        self.extra_body: dict[str, Any] = dict(s.llm_extra_body)
        self.client = OpenAI(
            base_url=overrides.get("base_url") or s.llm_base_url,
            api_key=overrides.get("api_key") or s.llm_api_key.get_secret_value(),
            max_retries=overrides.get("max_retries", 3),
            timeout=overrides.get("timeout", 120.0),
        )
        self.ledger = Ledger()
```

<div class="line-notes">

- `def __init__(self, settings: Settings | None = None, **overrides: Any) -> None:` 原来第一个参数是 `env_file`,现在换成 `settings`:传一个 `Settings` 对象进来,不传就用全局的。`**overrides` 保留,测试里想临时换模型或密钥时还是这么传。
- `s = settings or get_settings()` 没传就取 [Day 442](/blog/agent-zero/day-442-config/) 的全局配置对象。
- `self.model: str = overrides.get("model") or s.llm_model` 模型名先看有没有临时覆盖,再取配置里的 `deepseek-flash`。
- `self.price = overrides.get("price") or Price(s.price_in_per_m, s.price_in_per_m, s.price_out_per_m)` `Price` 三个数是缓存命中价、未命中价、输出价。`Settings` 只有输入和输出两个价,缓存命中那一档也填输入价。DeepSeek 的命中价其实低得多,这样算出的钱会偏高,宁可高估。
- `self.extra_body: dict[str, Any] = dict(s.llm_extra_body)` 配置里已经是字典了(Day 442 让 pydantic 解析了 JSON),拷一份,以免调用方改动影响全局配置。
- `base_url=overrides.get("base_url") or s.llm_base_url,` 厂商地址取配置。
- `api_key=overrides.get("api_key") or s.llm_api_key.get_secret_value(),` 密钥在 `Settings` 里是 `SecretStr`,打印出来是一串星号,只有 `get_secret_value()` 能拿到原文。
- `self.ledger = Ledger()` 账本不变,和练习仓库一样。
</div>

其余 `chat()`、`stream()`、`Conversation` 一行不动。`from __future__ import annotations` 那行也留着。接口名字和 Day 135–137 完全一致,Day 457 要加的东西到时候直接往上加。试一下,新建 `scratch/llm_try.py`:

```python
# supportpilot/scratch/llm_try.py
from supportpilot.llm import LLMClient

llm = LLMClient()
r = llm.chat([{"role": "user", "content": "用一句话说:帮助中心文章为什么要按小标题切块?"}], max_tokens=80)
print(r.content)
print(r.prompt_tokens, r.completion_tokens, round(r.cost, 6), "元", f"{r.latency:.2f} 秒")
print(llm.ledger)
```

<div class="line-notes">

- `from supportpilot.llm import LLMClient` 现在是从项目自己的包里导入,不再是 `common.llm`。
- `llm = LLMClient()` 不传参数,配置全从 `.env` 来。
- `r = llm.chat([{"role": "user", "content": "用一句话说:帮助中心文章为什么要按小标题切块?"}], max_tokens=80)` 一轮对话,限制最多输出 80 个 token,省钱。
- `print(r.content)` 模型的回答。
- `print(r.prompt_tokens, r.completion_tokens, round(r.cost, 6), "元", f"{r.latency:.2f} 秒")` 输入 18、输出 30 个 token,算出来 ¥0.000276。按价格算:`18 × 2 + 30 × 8 = 276`,单位是「元/百万 token」,所以是 276 / 1,000,000 = 0.000276 元。
- `print(llm.ledger)` 账本记了一次调用。
</div>

```bash
uv run python scratch/llm_try.py
```

```text
帮助中心文章按小标题切块，是为了让用户快速定位所需信息、降低阅读负担，同时提升内容的可扫描性和检索效率。
18 30 0.000276 元 1.21 秒
1 次调用 | 输入 18 / 输出 30 tokens | 约 ¥0.0003
```

通了。一次调用不到三百分之一毛钱。


## 第八步:量一量,帽子到底有没有用

要量,得有一把尺子:一批「客户会怎么问」的话,每句配上标准答案(应该找到哪篇文章)。我写了 40 条,放在 `scratch/queries.py`,每条是 `(问法, 算对的文章编号集合)`,比如「怎么让它别再自动扣钱了」对应 `KB-billing-002`。问法故意写得不像文章标题:「被收了两次钱」「设备被陌生人登录过」「打印出来的凭证位置偏了」。

```python
# supportpilot/scratch/queries.py
# (客户的话, 算对的文章编号集合):文章级判定,一个问题可以有不止一篇算对
QUERIES: list[tuple[str, set[str]]] = [
    ("想把手机号换成新的", {"KB-account-002"}),
    ("怎么让别人的设备下线", {"KB-account-007"}),
    ("我想把账号永久删除", {"KB-account-006"}),
    ("怎么让它别再自动扣钱了", {"KB-billing-002"}),
    ("公司转账能付年费吗", {"KB-billing-005"}),
    ("老客户会跟着涨价吗", {"KB-billing-008"}),
    ("退了款发票怎么办", {"KB-invoice-004"}),
    ("外国公司想要发票", {"KB-invoice-005"}),
    ("年付比月付便宜多少", {"KB-plans-002", "KB-plans-001"}),
    ("免费版能连银行吗", {"KB-plans-006", "KB-technical-003"}),
    ("手机上和电脑上看到的数不一样", {"KB-technical-006"}),
    ("结账有一步没做完会怎样", {"KB-technical-005", "KB-error-007"}),
    ("怎么把数据导出来", {"KB-technical-002"}),
    ("能用 IE 打开吗", {"KB-technical-007"}),
    ("汇率多久更新一次", {"KB-technical-008"}),
    ("最多能建几个账套", {"KB-technical-004"}),
    ("收到 429 该怎么办", {"KB-api-002", "KB-error-011"}),
    ("Webhook 推送失败会重试吗", {"KB-api-004"}),
    ("密钥泄露了怎么办", {"KB-api-003"}),
    ("月付能退钱吗", {"KB-refund-004", "KB-refund-001"}),
    ("减少席位会退钱吗", {"KB-billing-007", "KB-plans-005"}),
    ("退款多久能到账", {"KB-refund-005"}),
    ("试用结束后会自动扣费吗", {"KB-plans-007"}),
    ("开两步验证要怎么弄", {"KB-account-005"}),
    ("开通 API 要什么套餐", {"KB-api-001"}),
    ("降级以后我的数据会没吗", {"KB-plans-004"}),
    ("升级要补多少钱", {"KB-plans-003"}),
    ("扣款失败几次会被取消", {"KB-billing-003"}),
    ("优惠券遇到退款怎么算", {"KB-billing-009"}),
    ("被收了两次钱", {"KB-billing-004"}),
    ("老手机号丢了怎么改绑定", {"KB-account-002"}),
    ("取消订阅后账套还在吗", {"KB-plans-008"}),
    ("企业版最少要买几个席位", {"KB-plans-005", "KB-plans-001"}),
    ("抬头跟营业执照对不上", {"KB-invoice-006"}),
    ("开错的发票能重开吗", {"KB-invoice-003"}),
    ("增值税专用发票和普通的有啥不同", {"KB-invoice-002"}),
    ("银行授权多久过期", {"KB-technical-003"}),
    ("反结账怎么操作", {"KB-technical-005"}),
    ("打印出来的凭证位置偏了", {"KB-technical-009"}),
    ("设备被陌生人登录过", {"KB-account-007"}),
]
```

<div class="line-notes">

- `QUERIES: list[tuple[str, set[str]]] = [` 一个列表,每个元素是 `(字符串, 字符串集合)` 的元组。
- `("想把手机号换成新的", {"KB-account-002"}),` 第一条:客户的话,和算对的文章。
- `("年付比月付便宜多少", {"KB-plans-002", "KB-plans-001"}),` 有的问题两篇文章都讲了答案,都算对,所以标准答案是集合。
- `("结账有一步没做完会怎样", {"KB-technical-005", "KB-error-007"}),` 这条的答案既在「期末结账步骤」,也在报错码 E3003 那篇。
- `("设备被陌生人登录过", {"KB-account-007"}),` 最后一条,共 40 条。
</div>

判分按**文章**算,不按块算:检索结果从最像的块往下看,同一篇文章的几块只记第一次出现,正确文章排第几名就是第几名。看两个数:「第一名对几条」和「前三名里有几条」。

先试试 embedding 接口通不通。`scratch/emb_try.py`(Day 449 才会把 embedding 写成项目里的正式模块,今天用最土的写法,直接调 openai SDK):

```python
# supportpilot/scratch/emb_try.py
import time

from openai import OpenAI

from supportpilot.config import get_settings

s = get_settings()
client = OpenAI(base_url=s.emb_base_url, api_key=s.emb_api_key.get_secret_value())
t0 = time.time()
resp = client.embeddings.create(model=s.emb_model, input=["月付可以退款吗", "月付可以退款吗 > 规则"])
print(len(resp.data), len(resp.data[0].embedding), resp.usage.total_tokens, round(time.time() - t0, 2), "秒")
print([round(x, 4) for x in resp.data[0].embedding[:3]])
```

<div class="line-notes">

- `s = get_settings()` [Day 442](/blog/agent-zero/day-442-config/) 的配置对象,embedding 的地址、模型名、密钥都在里面。
- `client = OpenAI(base_url=s.emb_base_url, api_key=s.emb_api_key.get_secret_value())` 和调聊天模型是同一个 SDK,只是地址换成硅基流动。
- `resp = client.embeddings.create(model=s.emb_model, input=["月付可以退款吗", "月付可以退款吗 > 规则"])` 一次送两条文本。
- `print(len(resp.data), len(resp.data[0].embedding), resp.usage.total_tokens, round(time.time() - t0, 2), "秒")` 两条结果、每条 1024 个数、共用了 21 个 token、用了 0.33 秒。
- `print([round(x, 4) for x in resp.data[0].embedding[:3]])` 第一条向量的前三个数。
</div>

```bash
uv run python scratch/emb_try.py
```

```text
2 1024 17 0.31 秒
[-0.0072, 0.0193, -0.034]
```

两条文本,每条 1024 个数,用了 21 个 token,0.33 秒。通了。

对照实验里有一组帽子是让模型写的。新建 `scratch/llm_hat.py`,给 150 块各调一次 `deepseek-flash`,让它用一句话说明「这块出自哪篇文章、在讲什么」,结果存进 JSON 文件(跑过的下次不重跑):

```python
# supportpilot/scratch/llm_hat.py
"""让模型给每一块写一句「这块出自哪、在讲什么」,存进 scratch/llm_hats.json,做对照用。"""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from supportpilot.kb.chunker import Chunk, chunk_article, load_articles
from supportpilot.llm import LLMClient

PROMPT = """下面是一篇帮助中心文章,和从中切出来的一个片段。
请用一句话(不超过 40 字)说明这个片段出自哪篇文章、在讲什么场景,方便以后用客户的话检索到它。
只输出这一句话,不要复述片段原文。

<文章>
{doc}
</文章>

<片段>
{chunk}
</片段>"""

OUT = Path("scratch/llm_hats.json")
llm = LLMClient()
articles = {a.id: a for a in load_articles(Path("data/kb"))}
chunks = [c for a in articles.values() for c in chunk_article(a)]
done: dict[str, str] = json.loads(OUT.read_text()) if OUT.exists() else {}


def write_hat(c: Chunk) -> tuple[str, str]:
    key = f"{c.doc_id}#{c.index}"
    if key in done:  # 跑过的不重跑,中断了可以接着来
        return key, done[key]
    prompt = PROMPT.format(doc=articles[c.doc_id].body, chunk=c.text)
    r = llm.chat([{"role": "user", "content": prompt}], temperature=0, max_tokens=120)
    return key, r.content.strip()


with ThreadPoolExecutor(6) as pool:
    for key, hat in pool.map(write_hat, chunks):
        done[key] = hat
OUT.write_text(json.dumps(done, ensure_ascii=False, indent=1), encoding="utf-8")
print(len(done), "块", llm.ledger)
```

<div class="line-notes">

- `from concurrent.futures import ThreadPoolExecutor` 线程池:同时发几个请求。150 次调用一个一个等太慢,Intel 笔记本上要好几分钟。它相当于 JS 里 `Promise.all` 的线程版,不过这里用的是 [Day 68](/blog/agent-zero/day-068-async-3/) 之外的另一种并发办法,不需要 `async/await`。
- `PROMPT = """下面是一篇帮助中心文章,和从中切出来的一个片段。` 三引号字符串可以跨行。提示词给了背景(这是什么)、任务(一句话、不超过 40 字)、限制(不要复述原文)。
- `<文章>` 用标签把整篇文章和片段分开,[Day 143](/blog/agent-zero/day-143-prompt-5/) 讲过。
- `OUT = Path("scratch/llm_hats.json")` 结果存这个文件,键是 `KB-billing-005#1` 这种「文章编号#块序号」。
- `llm = LLMClient()` 刚搬进来的那个。
- `articles = {a.id: a for a in load_articles(Path("data/kb"))}` 字典推导式:文章编号 → 文章对象,下面要用编号找整篇正文。
- `chunks = [c for a in articles.values() for c in chunk_article(a)]` 150 块。
- `done: dict[str, str] = json.loads(OUT.read_text()) if OUT.exists() else {}` 文件已经有就读进来,没有就从空字典开始。
- `def write_hat(c: Chunk) -> tuple[str, str]:` 给一块写帽子,返回 `(键, 帽子)`。
- `if key in done:  # 跑过的不重跑` 命中缓存直接返回。中断后重跑,只补没做完的。
- `prompt = PROMPT.format(doc=articles[c.doc_id].body, chunk=c.text)` 把整篇文章和这一块填进模板。
- `r = llm.chat([{"role": "user", "content": prompt}], temperature=0, max_tokens=120)` `temperature=0` 让输出尽量稳定,最多 120 个 token。
- `with ThreadPoolExecutor(6) as pool:` 同时最多 6 个请求。
- `for key, hat in pool.map(write_hat, chunks):` `pool.map` 把 150 块分给 6 个线程,结果按原来的顺序返回。
- `OUT.write_text(json.dumps(done, ensure_ascii=False, indent=1), encoding="utf-8")` `ensure_ascii=False` 让中文原样写进文件,不变成 `月` 这种转义。
- `print(len(done), "块", llm.ledger)` 打印总块数和账本。
</div>

我先用 6 块试了水(¥0.0035),确认提示词出来的东西能看,才放开跑全部。全量那次:

```text
150 块 144 次调用 | 输入 27805 / 输出 3923 tokens | 约 ¥0.0870
```

算式:27,805 × 2 + 3,923 × 8 = 87,034,除以一百万得 ¥0.087。24 秒跑完(6 个线程同时发)。加上试水那次,这一步一共 ¥0.09。模型写出来的帽子是这样的:

```text
KB-technical-002#0  该片段出自《导出账套数据》,讲的是在设置中选择账套和期间导出 xlsx、大账套邮件通知下载的场景。
KB-refund-004#0     片段出自《月付可以退款吗》,讲月付订阅不支持退款、关闭自动续费即可停止扣费的场景。
KB-api-003#1        API Key 管理文章中的安全场景:Key 仅创建时显示一次,泄露需在开放平台重置。
```

最后是对照实验。四种做法,同样的 150 块、同样的 40 条问法:不戴帽子;戴「标题 > 小标题」;戴模型写的那一句;两顶都戴。新建 `scratch/hat_compare.py`:

```python
# supportpilot/scratch/hat_compare.py
"""同一批块、同一批问题,换四种帽子,看正确文章排第几。"""

import json
from pathlib import Path

import numpy as np
from openai import OpenAI

from scratch.queries import QUERIES
from supportpilot.config import get_settings
from supportpilot.kb.chunker import Chunk, chunk_article, load_articles

s = get_settings()
client = OpenAI(base_url=s.emb_base_url, api_key=s.emb_api_key.get_secret_value())
tokens = 0


def embed(texts: list[str]) -> np.ndarray:
    global tokens
    rows: list[list[float]] = []
    for i in range(0, len(texts), 10):  # 一次最多送 10 条
        resp = client.embeddings.create(model=s.emb_model, input=texts[i : i + 10])
        tokens += resp.usage.total_tokens if resp.usage else 0
        rows += [d.embedding for d in sorted(resp.data, key=lambda d: d.index)]
    arr = np.asarray(rows, dtype=np.float32)
    return arr / np.linalg.norm(arr, axis=1, keepdims=True)


chunks = [c for a in load_articles(Path("data/kb")) for c in chunk_article(a)]
llm_hats: dict[str, str] = json.loads(Path("scratch/llm_hats.json").read_text(encoding="utf-8"))


def model_hat(c: Chunk) -> str:
    return llm_hats[f"{c.doc_id}#{c.index}"]


variants = {
    "没帽子": [c.text for c in chunks],
    "标题/小标题": [c.embed_text for c in chunks],
    "模型写的": [model_hat(c) + "\n" + c.text for c in chunks],
    "两顶都戴": [c.hat + "\n" + model_hat(c) + "\n" + c.text for c in chunks],
}
qv = embed([q for q, _ in QUERIES])
for name, texts in variants.items():
    sims = qv @ embed(texts).T  # (问题数, 块数) 的相似度表;向量都归一化过,点积就是余弦
    top1 = top3 = 0
    for i, (q, gold) in enumerate(QUERIES):
        docs: list[str] = []
        for j in np.argsort(-sims[i]):  # 从最像的块往下看,同一篇文章只记第一次
            if chunks[j].doc_id not in docs:
                docs.append(chunks[j].doc_id)
        rank = next((r for r, d in enumerate(docs, 1) if d in gold), 99)
        top1 += rank == 1
        top3 += rank <= 3
        if rank > 1:
            print(f"  [{name}] 第 {rank} 名:{q} → 第一名是 {docs[0]}")
    print(f"{name}: 第一名对 {top1}/{len(QUERIES)},前三名里有 {top3}/{len(QUERIES)}")
print("embedding 共", tokens, "token")
```

<div class="line-notes">

- `from scratch.queries import QUERIES` 从 `scratch/queries.py` 导入,这要求在仓库根目录用 `-m` 运行,并且 `scratch/` 里有个空的 `__init__.py`(`touch scratch/__init__.py`),原因 [Day 33](/blog/agent-zero/day-033-packages/) 讲过。
- `s = get_settings()` 配置。
- `client = OpenAI(` 直接调 embedding,今天先不封装。
- `tokens = 0` 累计 embedding 用掉的 token。
- `def embed(texts: list[str]) -> np.ndarray:` 一个十几行的临时版:输入文本列表,输出 `(N, 1024)` 的数组。
- `global tokens` 函数里要改外面的整数变量,得先声明 `global`。(Day 217 用字典记账,就是为了躲开这一行。)
- `for i in range(0, len(texts), 10):  # 一次最多送 10 条` 150 块分 15 批。
- `resp = client.embeddings.create(model=s.emb_model, input=texts[i : i + 10])` 一批一次请求。
- `rows += [d.embedding for d in sorted(resp.data, key=lambda d: d.index)]` 按 `index` 排回输入顺序再追加。
- `arr = np.asarray(rows, dtype=np.float32)` 变成 numpy 数组,`float32` 比默认的 `float64` 省一半内存。
- `return arr / np.linalg.norm(arr, axis=1, keepdims=True)` 每行除以自己的长度,变成长度 1 的向量。这样点积就等于余弦相似度([Day 215](/blog/agent-zero/day-215-cosine/))。
- `chunks = [c for a in load_articles(Path("data/kb")) for c in chunk_article(a)]` 今天写的 `chunker.py` 派上用场:150 块。
- `llm_hats: dict[str, str] = json.loads(` 读上一步存下的模型帽子。
- `def model_hat(c: Chunk) -> str:` 按块的「文章编号#序号」查帽子。
- `"没帽子": [c.text for c in chunks],` 只用原文。
- `"标题/小标题": [c.embed_text for c in chunks],` 我们的做法:`chunker.py` 里的 `embed_text`。
- `"模型写的": [model_hat(c) + "\n" + c.text for c in chunks],` 模型写的那一句,接原文。
- `"两顶都戴": [c.hat + "\n" + model_hat(c) + "\n" + c.text for c in chunks],` 两顶叠起来。
- `qv = embed([q for q, _ in QUERIES])` 40 条问法一次变成向量。
- `sims = qv @ embed(texts).T` `@` 是矩阵乘法:`(40, 1024) @ (1024, 150)` 得到 `(40, 150)`,第 i 行第 j 列是第 i 条问法和第 j 块的余弦。([Day 218](/blog/agent-zero/day-218-sim-matrix/) 的相似度矩阵。)
- `for j in np.argsort(-sims[i]):` 对第 i 行从大到小排序,`argsort` 给出下标。前面加负号等于倒序。
- `if chunks[j].doc_id not in docs:` 同一篇文章只记第一次出现。
- `rank = next((r for r, d in enumerate(docs, 1) if d in gold), 99)` 找第一个属于标准答案的文章,它的名次就是 `rank`;一个都没找到就记 99。
- `top1 += rank == 1` 布尔值能直接当 0/1 相加。
- `print(f"  [{name}] 第 {rank} 名:{q} → 第一名是 {docs[0]}")` 没排第一的,把问法和错答案都打出来,方便看原因。
</div>

```bash
uv run python -m scratch.hat_compare
```

```text
  [没帽子] 第 2 名:公司转账能付年费吗 → 第一名是 KB-plans-005
  [没帽子] 第 2 名:怎么把数据导出来 → 第一名是 KB-error-004
  [没帽子] 第 2 名:月付能退钱吗 → 第一名是 KB-plans-002
  [没帽子] 第 2 名:开通 API 要什么套餐 → 第一名是 KB-error-011
  [没帽子] 第 2 名:被收了两次钱 → 第一名是 KB-refund-004
  [没帽子] 第 2 名:打印出来的凭证位置偏了 → 第一名是 KB-error-010
没帽子: 第一名对 34/40,前三名里有 40/40
  [标题/小标题] 第 2 名:公司转账能付年费吗 → 第一名是 KB-plans-002
标题/小标题: 第一名对 39/40,前三名里有 40/40
  [模型写的] 第 2 名:公司转账能付年费吗 → 第一名是 KB-plans-002
  [模型写的] 第 2 名:怎么把数据导出来 → 第一名是 KB-error-004
  [模型写的] 第 2 名:密钥泄露了怎么办 → 第一名是 KB-error-002
  [模型写的] 第 2 名:月付能退钱吗 → 第一名是 KB-plans-002
  [模型写的] 第 4 名:开通 API 要什么套餐 → 第一名是 KB-plans-001
  [模型写的] 第 2 名:抬头跟营业执照对不上 → 第一名是 KB-error-010
模型写的: 第一名对 34/40,前三名里有 39/40
  [两顶都戴] 第 2 名:密钥泄露了怎么办 → 第一名是 KB-error-002
两顶都戴: 第一名对 39/40,前三名里有 40/40
embedding 共 31601 token
```


先看数字:

<figure>
<svg viewBox="0 0 640 190" role="img" aria-label="四种帽子的对照:没帽子 34 条,标题加小标题 39 条,模型写的 34 条,两顶都戴 39 条,满分 40">
<g font-family="var(--font-mono)" font-size="12">
<text x="10" y="35" fill="var(--ink)">没帽子</text>
<rect x="150" y="20" width="340" height="22" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="500" y="36" fill="var(--ink-soft)">34 / 40</text>
<text x="10" y="75" fill="var(--ink)">标题 &gt; 小标题</text>
<rect x="150" y="60" width="390" height="22" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="548" y="76" fill="var(--ink-soft)">39 / 40</text>
<text x="10" y="115" fill="var(--ink)">模型写的一句</text>
<rect x="150" y="100" width="340" height="22" rx="3" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="500" y="116" fill="var(--ink-soft)">34 / 40</text>
<text x="10" y="155" fill="var(--ink)">两顶都戴</text>
<rect x="150" y="140" width="390" height="22" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="548" y="156" fill="var(--ink-soft)">39 / 40</text>
</g>
</svg>
<figcaption>40 条问法里,正确文章排第一名的条数(bge-m3,150 块)。条的长度按条数画,满分 40。</figcaption>
</figure>

不戴帽子时有 6 条没排第一,戴上「标题 > 小标题」以后只剩 1 条。看那 6 条错在哪:「被收了两次钱」排第一的是 `KB-refund-004`(月付不支持退款),本该是 `KB-billing-004`(被重复扣款怎么办)。后者的块只有「自动退回」「人工处理」两个小标题,正文里甚至不出现「两次」这个词,标题「被重复扣款怎么办」才是它和问法之间的桥。「打印出来的凭证位置偏了」排第一的是 `KB-error-010`(发票税号校验失败),本该是 `KB-technical-009`(凭证打印排版),原因一样:原文里「打印偏移通常是浏览器缩放不是 100% 导致的」那一句没有「凭证」二字,标题有。

让模型写一句话当帽子,结果和没戴一样,34 条,前三名里还少了 1 条(「开通 API 要什么套餐」掉到第 4 名)。两顶叠着戴,39 条,和只戴标题一样,多戴那一顶没带来好处。为什么模型写的帽子没帮上忙?我的猜测是:它写的是描述腔(「该片段出自《……》,讲的是……场景」),和客户口语化的问法隔着一层,而且每一块都有「该片段出自」「场景」这些套话,等于给 150 块戴了同一个口头禅。但这只是猜测,我没有做对照实验去验证,不要当结论。

这组数字要打折扣来读:

- **只有 40 条。** 一条之差就是 2.5 个百分点,别把 39 对 34 当成精确的倍数。同一组配置重跑,结果偶尔也会差 1 条(「两顶都戴」我这边遇到过 37 和 38,embedding 服务不是每次返回逐位相同的数)。
- **问法是我自己写的,写的时候看过文章标题。** 带标题的帽子占了便宜。真正的检验是拿没见过文章的人写的问法,或者线上真实的问法。Day 451 做检索基线时会用更大的一批,再比。
- **模型写的帽子只试了一版提示词。** 换个提示词结果可能不同,练习 3 就换了一版。Day 241 会用更长的文档,正式比较 Contextual Retrieval。

这些局限不影响今天的决定。**帽子用「标题 > 小标题」**:零成本,一行代码,稳定可复现,结果不比模型写的差;模型写的那个贵(¥0.09,每次文章一改就要重来)而且这次没赢。`chunker.py` 里已经是这个写法了。

## 第九步:给 chunker 写测试

最后一步,把今天的行为钉住。新建 `tests/test_chunker.py`:

```python
# supportpilot/tests/test_chunker.py
from pathlib import Path

import pytest

from supportpilot.kb.chunker import Article, chunk_article, load_articles, make_hat, parse_article, split_long

KB_DIR = Path(__file__).resolve().parent.parent / "data" / "kb"

RAW = """---
id: KB-test-001
title: 测试文章
category: test
updated_at: 2026-09-15
url_path: /help/test/001
---

# 测试文章

## 第一节

第一节的内容。

## 第二节

第二节的内容。
"""


def article(body: str) -> Article:
    return Article("KB-test-001", "测试文章", "test", "/help/test/001", "2026-09-15", body)


def test_parse_article():
    a = parse_article(RAW)
    assert (a.id, a.title, a.category) == ("KB-test-001", "测试文章", "test")
    assert a.body.startswith("# 测试文章")


def test_parse_without_frontmatter_raises():
    with pytest.raises(ValueError, match="frontmatter"):
        parse_article("# 没有 frontmatter")


def test_one_chunk_per_heading():
    chunks = chunk_article(parse_article(RAW))
    assert [(c.index, c.heading, c.text) for c in chunks] == [
        (0, "第一节", "第一节的内容。"),
        (1, "第二节", "第二节的内容。"),
    ]


def test_hat_goes_into_embed_text_only():
    c = chunk_article(parse_article(RAW))[0]
    assert c.hat == make_hat("测试文章", "第一节") == "测试文章 > 第一节"
    assert c.embed_text == "测试文章 > 第一节\n第一节的内容。"
    assert c.text == "第一节的内容。"  # 给用户看的原文不带帽子


def test_article_without_headings_is_one_chunk():
    chunks = chunk_article(article("# 测试文章\n\n只有一段话,没有小标题。"))
    assert len(chunks) == 1
    assert chunks[0].heading == "测试文章"
    assert chunks[0].text == "只有一段话,没有小标题。"


def test_empty_section_is_skipped():
    chunks = chunk_article(article("# 测试文章\n\n## 空节\n\n## 有内容\n\n内容。"))
    assert [c.heading for c in chunks] == ["有内容"]
    assert chunks[0].index == 0  # 跳过空节后,序号仍然从 0 连续


def test_split_long_keeps_overlap_and_limit():
    text = "".join(f"第{i}条:付款后第{i}天内提交申请,系统会自动核对订单。" for i in range(1, 21))
    pieces = split_long(text, max_chars=200, overlap=30)
    assert len(pieces) == 4
    assert all(len(p) <= 200 for p in pieces)
    assert pieces[1][:30] == pieces[0][-30:]


def test_short_text_is_not_split():
    assert split_long("很短的一段。") == ["很短的一段。"]


def test_split_long_never_ends_with_a_pure_overlap_piece():
    """回归:最后一句话很长时,曾多出一块只有上一块尾巴的重复块。"""
    text = "短句一。短句二。" + "很长的一句话" * 20 + "。"
    pieces = split_long(text, max_chars=50, overlap=10)
    assert pieces[-1] != pieces[-2][-10:]
    assert "".join(p for p in pieces).count("很长的一句话") >= 20


@pytest.mark.skipif(not any(KB_DIR.glob("*.md")), reason="先运行 scripts/gen_kb.py 生成 data/kb/")
def test_real_kb_chunks_cover_every_article():
    arts = load_articles(KB_DIR)
    assert len(arts) == 62
    for a in arts:
        chunks = chunk_article(a)
        assert chunks, a.id
        assert [c.index for c in chunks] == list(range(len(chunks)))
        assert all(c.text and len(c.text) <= 400 for c in chunks)
```

<div class="line-notes">

- `import pytest` 要用 `pytest.raises`、`pytest.mark.skipif`。
- `KB_DIR = Path(__file__).resolve().parent.parent / "data" / "kb"` 测试文件在 `tests/` 里,往上两级是仓库根目录,再进 `data/kb`。
- `RAW = """---` 一篇只有两个小节的迷你文章,写在测试里。用真实文章的话,Day 444 改了事实源,这里的断言就会跟着失效。
- `def article(body: str) -> Article:` 小工具:只给正文,其余五个字段填死,省得每条测试都写一遍。
- `def test_parse_article():` 第一条:五个元数据字段读对,正文以 `# 测试文章` 开头。
- `with pytest.raises(ValueError, match="frontmatter"):` 期望抛 `ValueError`,而且错误信息里要有「frontmatter」。不抛、或者抛了别的异常,测试都会红。
- `def test_one_chunk_per_heading():` 两个小节,正好两块,序号 0、1,原文不带小标题那一行。
- `assert c.hat == make_hat("测试文章", "第一节") == "测试文章 > 第一节"` 连着写两个 `==`:`c.hat`、`make_hat(...)`、字符串三个相等。
- `assert c.embed_text == "测试文章 > 第一节\n第一节的内容。"` 帽子一行,原文一行。
- `assert c.text == "第一节的内容。"  # 给用户看的原文不带帽子` 钉住第六步的第一条设计要点。
- `def test_article_without_headings_is_one_chunk():` 一个 `## ` 都没有的文章,整篇一块,小标题借用文章标题。
- `def test_empty_section_is_skipped():` 空节不产生块,而且序号仍然从 0 连续。
- `def test_split_long_keeps_overlap_and_limit():` 第四步那份 542 字的文本,断言切成 4 块、每块不超过 200 字、重叠对得上。
- `assert len(pieces) == 4` 和第四步实跑的 4 块对上。
- `def test_short_text_is_not_split():` 不超长就原样返回,一块。
- `def test_split_long_never_ends_with_a_pure_overlap_piece():` 第五步抓到的那个 bug 的回归测试:最后一句话是一个 120 字的长句,上限 50 字。
- `assert pieces[-1] != pieces[-2][-10:]` 最后一块不能等于倒数第二块的最后 10 个字(重叠长度)。有 bug 的版本这里会红。
- `assert "".join(p for p in pieces).count("很长的一句话") >= 20` 顺带确认长句的内容没丢:20 个「很长的一句话」,拼回去至少有 20 个(重叠会让个别重复,所以是 `>=`)。
- `@pytest.mark.skipif(not any(KB_DIR.glob("*.md")), reason="先运行 scripts/gen_kb.py 生成 data/kb/")` 没生成过文章的话(新克隆、还没 `make data`),这条自动跳过,提示怎么补。
- `assert len(arts) == 62` 62 篇是 Day 444 的约定。
- `assert [c.index for c in chunks] == list(range(len(chunks)))` 每篇的块序号都是 0、1、2……连续。
- `assert all(c.text and len(c.text) <= 400 for c in chunks)` 没有空块,没有超过上限的块。
</div>

```bash
uv run pytest tests/test_chunker.py -q
```

```text
..........                                                               [100%]
10 passed in 0.05s
```

回归测试要证明它真的能抓到 bug,不然它可能只是摆设。我把 `split_long` 临时换回第四步那个有 bug 的版本,再跑一次:

```text
>       assert pieces[-1] != pieces[-2][-10:]
E       AssertionError: assert '一句话很长的一句话。' != '一句话很长的一句话。'

FAILED tests/test_chunker.py::test_split_long_never_ends_with_a_pure_overlap_piece
1 failed, 9 passed in 0.09s
```

红了,而且红在该红的地方:最后一块和倒数第二块的尾巴一模一样。换回修好的版本,10 条全绿。最后过一遍 `ruff` 和类型检查(类型标注已经写在代码里了,编辑器里不应该有红线):

```bash
uv run ruff check . && uv run ruff format --check . && uv run basedpyright
```

```text
All checks passed!
N files already formatted
0 errors, 0 warnings, 0 notes
```

(`N` 是你仓库里 Python 文件的个数,每个人不一样。)

今天结束时仓库里多了这些:

```text
src/supportpilot/llm.py            从练习仓库搬来,只改了配置那一段
src/supportpilot/kb/__init__.py
src/supportpilot/kb/chunker.py     Article、Chunk、parse_article、chunk_article、split_long、load_articles
scripts/chunk_report.py            切块报告
tests/test_chunker.py
```

(`scratch/` 下的实验脚本留着,练习还要用,但不提交。)

## 动手练习

**练习 1:切一篇很长的文章。** 造一篇有两个小节的文章,第二节是 30 个步骤、共 732 个字,用默认参数(上限 400、重叠 60)切块。这篇文章会切成几块?每块的小标题和帽子是什么?

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/ex1.py
from supportpilot.kb.chunker import Article, chunk_article

steps = "".join(f"第{i}步:进入设置页,找到第{i}个开关并确认状态。" for i in range(1, 31))
body = f"# 长文章\n\n## 第一节\n\n很短的一节。\n\n## 操作步骤\n\n{steps}\n"
a = Article("KB-x-001", "长文章", "x", "/help/x/001", "2026-09-15", body)
print(len(steps))
for c in chunk_article(a):
    print(c.index, repr(c.heading), len(c.text), repr(c.text[:10]), "…", repr(c.text[-10:]))
print([c.embed_text[:14] for c in chunk_article(a)])
```

<div class="line-notes">

- `steps = "".join(f"第{i}步:进入设置页,找到第{i}个开关并确认状态。" for i in range(1, 31))` 30 句话连成一段,每句 24 到 25 个字,总共 732 个字(下面第一行输出)。
- `body = f"# 长文章\n\n## 第一节\n\n很短的一节。\n\n## 操作步骤\n\n{steps}\n"` 手工拼出文章正文:一个很短的节,一个超长的节。
- `a = Article("KB-x-001", "长文章", "x", "/help/x/001", "2026-09-15", body)` 直接构造 `Article`,不用读文件。
- `for c in chunk_article(a):` 默认参数,不传 `max_chars`。
- `print(c.index, repr(c.heading), len(c.text), repr(c.text[:10]), "…", repr(c.text[-10:]))` 序号、小标题、字数、头尾各 10 个字。
- `print([c.embed_text[:14] for c in chunk_article(a)])` 看每一块送去向量化的文本开头,也就是帽子。
</div>

```text
732
0 '第一节' 6 '很短的一节。' … '很短的一节。'
1 '操作步骤' 382 '第1步:进入设置页,' … '6个开关并确认状态。'
2 '操作步骤' 385 '4个开关并确认状态。' … '9个开关并确认状态。'
3 '操作步骤' 85 '7个开关并确认状态。' … '0个开关并确认状态。'
['长文章 > 第一节\n很短的一', '长文章 > 操作步骤\n第1步', '长文章 > 操作步骤\n4个开', '长文章 > 操作步骤\n7个开']
```

732 个字的一节被切成 3 块(382、385、85 个字),加上很短的第一节,共 4 块。**三块共用同一个小标题「操作步骤」**,所以三块的帽子也一样,都是 `长文章 > 操作步骤`。帽子只说明块出自哪一节,不区分是这一节的第几段,这是帽子的边界。第 2 块的开头是 `4个开关并确认状态。`,是第 1 块结尾的重叠,不是第 4 步,看到半句话的开头不要慌。

</details>

**练习 2:半角标点。** 把下面这段英文用 `split_long(text, 100, 10)` 切一下,看切成几块,再想办法让它在 `!`、`?`、`;` 和句号后面也能切。

```python
text = "Step one: open settings! Step two: open billing? Step three: close it; done! " * 5
```

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/ex2.py
from supportpilot.kb.chunker import split_long

text = "Step one: open settings! Step two: open billing? Step three: close it; done! " * 5
print(len(text), [len(p) for p in split_long(text, 100, 10)])
```

<div class="line-notes">

- `from supportpilot.kb.chunker import split_long` 用今天写的函数。
- `text = "Step one: open settings! Step two: open billing? Step three: close it; done! " * 5` 一句话重复 5 遍,385 个字符,只有半角标点。
- `print(len(text), [len(p) for p in split_long(text, 100, 10)])` 打印总字数和切出来的每块字数。
</div>

```text
385 [385]
```

385 个字符,一块都没切开。原因:`split_long` 里的 `re.split(r"(?<=[。！？；\n])", text)` 只认全角的 `。！？；` 和换行,半角的 `! ? ;` 它不认识,整段文本变成「一句话」,而一句话是不拆的。帮助中心现在全是中文,不碰到这个问题,哪天导入一篇英文文章就会撞上。修法是把半角标点也加进去,半角句号要小心:`3.5`、`e.g.` 里的点不能切,所以只在「句号后面紧跟空白」时才切。新建 `scratch/ex2_fix.py` 验证这个正则:

```python
# supportpilot/scratch/ex2_fix.py
import re


def split_sentences(text: str) -> list[str]:
    """全角标点后面切;半角的 ! ? ; 后面也切;半角句号只有后面跟空白才切(避开 3.5、e.g.)。"""
    return [s for s in re.split(r"(?<=[。！？；!?;\n])|(?<=\.)(?=\s)", text) if s]


print(split_sentences("Step one: open settings! Step two: version 3.5 is out. Done?"))
print(split_sentences("第一步:点设置!第二步:点账单。"))
```

<div class="line-notes">

- `def split_sentences(text: str) -> list[str]:` 只演示切句子这一步。
- `return [s for s in re.split(r"(?<=[。！？；!?;\n])|(?<=\.)(?=\s)", text) if s]` 正则分两半,用 `|` 连起来:左边是「在这些全角和半角标点后面切」;右边 `(?<=\.)(?=\s)` 是「前面是句号、后面是空白」才切,两个括号都是零宽的断言,不消耗字符。最后 `if s` 滤掉空串。
- `print(split_sentences("Step one: open settings! Step two: version 3.5 is out. Done?"))` 其中 `3.5` 的点后面不是空白,不切;`out.` 的点后面是空格,切。
- `print(split_sentences("第一步:点设置!第二步:点账单。"))` 全角的照样能切。
</div>

```text
['Step one: open settings!', ' Step two: version 3.5 is out.', ' Done?']
['第一步:点设置!', '第二步:点账单。']
```

`3.5` 没被拆开,`out.` 后面切开了。把 `split_long` 里那行 `re.split` 换成这个正则(同一个函数里,别的不动),再跑 `scratch/ex2.py`:

```text
385 [76, 87, 87, 87, 88]
```

切成 5 块,每块 76 到 88 个字符,都在 100 以内。`tests/test_chunker.py` 10 条仍然全绿。这份修改我没有留在最终的 `chunker.py` 里:知识库现在全是中文,多一层正则就多一份维护成本。真的导入英文文章那天再换。

</details>

**练习 3:再试三种帽子。** 在 `hat_compare.py` 的基础上,试三种新的做法:只戴小标题、只戴文章标题、让模型写「文章标题 / 客户会问的一个问题」(这个要重新调一遍模型,150 次,约 ¥0.08)。哪种最好?只戴标题和戴「标题 > 小标题」差在哪?

<details><summary>参考答案</summary>

模型那一版的提示词,是把 `llm_hat.py` 里 `PROMPT` 的第二、三行换成:

```text
请先原样写出文章标题,再用客户会说的话,写一句这个片段能回答的问题,合起来不超过 50 字。
格式:文章标题 / 客户的问题。只输出这一行。
```

输出文件改成 `scratch/llm_hats_v2.json`。150 次调用,输入 28,960、输出 2,511 个 token,算式 28,960 × 2 + 2,511 × 8 = 78,008,约 ¥0.078。生成出来的帽子:

```text
KB-refund-004#0  月付可以退款吗 / 月付能退款吗?不想用了怎么办?
KB-api-003#1     API Key 管理 / 我的 Key 泄露了怎么办?
```

然后 `scratch/ex_hat.py` 和 `hat_compare.py` 只有 `variants` 字典不同(其余代码一样,包括 `embed()`):

```python
variants = {
    "只有小标题": [f"{c.heading}\n{c.text}" for c in chunks],
    "只有标题": [f"{c.title}\n{c.text}" for c in chunks],
    "模型帽子 v2": [hats_v2[f"{c.doc_id}#{c.index}"] + "\n" + c.text for c in chunks],
}
```

<div class="line-notes">

- `variants = {` 还是「名字 → 150 条送去向量化的文本」。
- `"只有小标题": [f"{c.heading}\n{c.text}" for c in chunks],` 只拼小标题。注意「原因」「操作」这类小标题单独拼上去没有信息量。
- `"只有标题": [f"{c.title}\n{c.text}" for c in chunks],` 只拼文章标题,同一篇文章的几块帽子相同。
- `"模型帽子 v2": [hats_v2[f"{c.doc_id}#{c.index}"] + "\n" + c.text for c in chunks],` 读的是新提示词生成的那个文件。
</div>

```text
  [只有小标题] 第 2 名:公司转账能付年费吗 → 第一名是 KB-plans-002
  [只有小标题] 第 2 名:怎么把数据导出来 → 第一名是 KB-plans-008
  [只有小标题] 第 2 名:月付能退钱吗 → 第一名是 KB-plans-002
  [只有小标题] 第 2 名:被收了两次钱 → 第一名是 KB-refund-004
只有小标题: 第一名对 36/40,前三名里有 40/40
  [只有标题] 第 2 名:开通 API 要什么套餐 → 第一名是 KB-plans-001
只有标题: 第一名对 39/40,前三名里有 40/40
  [模型帽子 v2] 第 2 名:我想把账号永久删除 → 第一名是 KB-account-007
  [模型帽子 v2] 第 2 名:月付能退钱吗 → 第一名是 KB-plans-002
  [模型帽子 v2] 第 3 名:开通 API 要什么套餐 → 第一名是 KB-plans-001
模型帽子 v2: 第一名对 37/40,前三名里有 40/40
embedding 共 18364 token
```

只戴文章标题 39 条,和「标题 > 小标题」的 39 条一样好;只戴小标题 36 条,比不戴(34)好一点,比戴标题差;模型帽子 v2(带上了原样的标题和一个客户问题)37 条,比 v1 的 34 好,但仍然追不上直接拼标题。(这个数我前一次跑是 36,又是 embedding 服务的小抖动,所以只看大趋势。)

所以这批文章里,**起主要作用的是文章标题**,小标题是加分项而不是主力。原因不难想:我们的块很短(平均 40 个字),单独拿出来几乎没有主题,而标题(「被重复扣款怎么办」「凭证打印排版」)恰好是主题。如果你的文档标题很泛(比如「说明」「FAQ」),这个结论就不成立,要重新量。「标题 > 小标题」也不比「只有标题」差,又能把同一篇文章的不同块区分开,所以保留。

</details>

**练习 4:同名小标题。** 一篇文章里有两个「注意」小节,中间隔着一个「价格」。切出来的块会不会互相覆盖?序号和帽子是什么样?写一条测试把结论钉住。

<details><summary>参考答案</summary>

```python
# supportpilot/scratch/ex4.py
from supportpilot.kb.chunker import Article, chunk_article

body = "# 退款\n\n## 注意\n\n年付的注意事项。\n\n## 价格\n\n年付 950 元。\n\n## 注意\n\n月付的注意事项。\n"
a = Article("KB-x-002", "退款", "x", "/help/x/002", "2026-09-15", body)
for c in chunk_article(a):
    print(c.index, c.heading, c.text, "|", c.embed_text.replace("\n", " ⏎ "))
```

<div class="line-notes">

- `body = "# 退款\n\n## 注意\n\n年付的注意事项。\n\n## 价格\n\n年付 950 元。\n\n## 注意\n\n月付的注意事项。\n"` 三个小节,第一个和第三个同名。
- `a = Article("KB-x-002", "退款", "x", "/help/x/002", "2026-09-15", body)` 手工构造文章。
- `for c in chunk_article(a):` 切块。
- `print(c.index, c.heading, c.text, "|", c.embed_text.replace("\n", " ⏎ "))` 把帽子和原文之间的换行换成可见的符号 `⏎`,一行打完。
</div>

```text
0 注意 年付的注意事项。 | 退款 > 注意 ⏎ 年付的注意事项。
1 价格 年付 950 元。 | 退款 > 价格 ⏎ 年付 950 元。
2 注意 月付的注意事项。 | 退款 > 注意 ⏎ 月付的注意事项。
```

三块,序号 0、1、2,谁也没覆盖谁:块的编号靠 `(doc_id, index)`,不靠小标题。两个「注意」的帽子完全一样(`退款 > 注意`),只有原文不同,向量会因为原文而分开。要是你想让帽子也能区分,可以把序号放进帽子里,但这会让所有帽子都带上和内容无关的数字,我没这么做。测试写成:

```python
def test_same_heading_twice_keeps_both_chunks():
    body = (
        "# 退款\n\n## 注意\n\n年付的注意事项。\n\n## 价格\n\n年付 950 元。\n\n## 注意\n\n月付的注意事项。\n"
    )
    chunks = chunk_article(article(body))
    assert [c.index for c in chunks] == [0, 1, 2]
    assert [c.heading for c in chunks] == ["注意", "价格", "注意"]
    assert chunks[0].text != chunks[2].text
```

<div class="line-notes">

- `def test_same_heading_twice_keeps_both_chunks():` 加在 `tests/test_chunker.py` 里,用文件里已有的 `article()` 小工具。
- `body = (` 括号里是同一份三节的正文。`ruff format` 会把它排成括号里的一整行,不用管。
- `assert [c.index for c in chunks] == [0, 1, 2]` 三块,序号连续。
- `assert [c.heading for c in chunks] == ["注意", "价格", "注意"]` 小标题按原来的顺序,重名的两个都在。
- `assert chunks[0].text != chunks[2].text` 两个「注意」的原文不同,说明没有互相覆盖。
</div>

加进去之后 `uv run pytest tests/test_chunker.py -q` 是 `11 passed`。

</details>

**验收标准:** `chunk_report.py` 打印「62 篇,切出 150 块」;`scratch/hat_compare.py` 打出四行对照,你的数字不必和我的完全相同,但「标题 > 小标题」应该明显好于「没帽子」;`pytest tests/test_chunker.py` 全绿;你能不看稿说出为什么帽子只拼在 `embed_text` 上而 `text` 不动。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 切块(chunking) | 把一篇长文章拆成一小段一小段,每段单独存、单独检索。例:62 篇文章切成 150 块。 |
| 块(chunk) | 切块以后的一小段。检索返回的是块,不是整篇文章。例:「月付订阅不支持退款……」这一节。 |
| frontmatter | 文章最前面两条 `---` 之间的元数据,写着编号、标题、分类。例:`id: KB-refund-002`。 |
| 重叠(overlap) | 一节太长要再切时,下一块带上上一块末尾的几十个字,避免一句话被切断后两边都读不懂。 |
| 帽子 | 我给的叫法:拼在块原文前面、只用来算向量的一行出处。例:`月付可以退款吗 > 规则`。 |
| `embed_text` | 送去向量化的文本,等于「帽子 + 换行 + 原文」。数据库里存的 `content` 是不带帽子的 `text`。 |
| Contextual Retrieval | Anthropic 提出的做法:让模型给每块写一段上下文再拼上去,检索更准,代价是每块多调一次模型。今天的帽子是它的零成本简化版,[Day 241](/blog/agent-zero/day-241-contextual-retrieval/) 细讲。 |
| `re.M` | 正则的 MULTILINE 标志,让 `^` 匹配每一行的开头,不只是整个字符串的开头。 |
| 回归测试 | 专门为了抓一个已经出现过的 bug 写的测试,防止它以后再回来。今天的例子:最后一块是重复尾巴。 |
| 标准答案(gold) | 评测里给每个问法预先标好的「应该找到哪篇文章」。判分就是看检索结果和它对不对得上。 |

## 常见误区

**把帽子也存进数据库。** 帽子只是给向量算法看的辅助信息。要是 `kb.chunks.content` 里也带着「月付可以退款吗 > 规则」,模型引用原文时会多出一行莫名其妙的前缀,客户点开出处看到的也不干净。`text` 和 `embed_text` 是两份,今天就是为了不犯这个错。

**忘了 `re.M`。** `re.split(r"^## +", body)` 不带 `flags=re.M`,`^` 只匹配整个字符串的开头,正文一个小标题也切不出来,`parts` 只有一段,整篇文章变成一块。而且不报错,只是检索质量悄悄变差,所以要有个报告脚本看块数。

**以为默认参数下兜底的那条路也是通的。** 62 篇文章没有一节超过 400 字,`split_long` 一次也没被调用过。我第一版就带着一个藏着的 bug,是故意用小参数跑出来的。这类只在极端输入下才走到的分支,一定要专门造数据跑一遍,并且补测试。

**用 40 条问法下定论。** 今天的数字只说明「帽子大概率有用,模型写的这一版没比标题强」,不是 39/40 就比 34/40 好 14%。样本小、问法是我写的、embedding 偶尔差一条。下结论之前先问:换一批问法还成立吗?

**直接复制 `llm.py` 就用。** 我试过,原封不动复制过来,它居然能跑:`load_dotenv()` 会顺着目录往上找到仓库根目录的 `.env`,模型、地址、密钥都读得到。出问题的是价格:`.env` 里没有 `LLM_PRICE`,它悄悄用全 0 的价格,每次调用算出来的钱都是 `0.0`,不报任何错。账本永远显示 ¥0,花了多少钱谁也不知道。搬代码先问:它读配置的方式,在新项目里还成立吗?

## 学习资料

### 文档与文章

- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):今天的帽子是它的零成本简化版。读「chunks 缺上下文」那个例子,Day 241 再细读。
- [Pinecone · Chunking Strategies for LLM Applications](https://www.pinecone.io/learn/chunking-strategies/):固定长度、按结构、语义几种切法和怎么选,对照今天「按小标题切」是哪一类。
- [Chroma Research · Evaluating Chunking Strategies for Retrieval](https://research.trychroma.com/evaluating-chunking):用同一套评估比较各种切块方法,看结论部分和那张结果表,讲的就是「别迷信某一种参数」。
- [LangChain · Markdown 标题切分器](https://docs.langchain.com/oss/python/integrations/splitters/markdown_header_metadata_splitter):框架里按 Markdown 标题切、并把标题存进元数据的现成实现,对照我们的 `chunk_article` 看它多做了什么。
- [Python 文档 · re](https://docs.python.org/zh-cn/3.12/library/re.html):中文版,查 `re.split`、`re.MULTILINE`、后行断言 `(?<=...)` 三个条目。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dr421x7Su&autoplay=0&high_quality=1" title="一站帮你选择RAG中的文本切分策略" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>果粒奶优有果粒 · 一站帮你选择RAG中的文本切分策略 · 27 分钟。从固定长度到按结构、语义切分逐个讲,带代码演示。看完对照今天按小标题切的那一类。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14GWizWEsT&autoplay=0&high_quality=1" title="【RAG成败,始于分块】从“无脑”切分到“智能”切割!手把手教你文本分块策略" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大模型教程K · 【RAG成败,始于分块】从“无脑”切分到“智能”切割 · 23 分钟。讲重叠为什么有用、块太大太小各会怎样,和今天的 `split_long` 对应。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/8OJC21T2SL4" title="The 5 Levels Of Text Splitting For Retrieval" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Greg Kamradt · The 5 Levels Of Text Splitting For Retrieval · 英文,约一小时,引用最多的切块视频。今天看前两个 level(固定长度、递归切分)和按文档结构切的部分,能对上第三步和第四步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ZTOtxiWb2bE" title="Chunking Strategies Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Redis · Chunking Strategies Explained · 英文。用图把几种切法和重叠讲一遍,适合看完长视频后快速回顾。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)。第 6 章「RAG and Agents」里讲 chunking strategy 的那一小节,可以对照今天的做法看看她给的取舍。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024),中文版《图解大模型:生成式AI原理与实践》(人民邮电出版社,2025)。第 8 章讲语义搜索和 RAG,里面有长文本怎么切块的图示。

### 开源项目与代码

- [FullStackRetrieval-com/RetrievalTutorials](https://github.com/FullStackRetrieval-com/RetrievalTutorials):Greg Kamradt 那个视频配套的仓库,5 种切法每种都有可跑的笔记本。
- [datawhalechina/all-in-rag](https://github.com/datawhalechina/all-in-rag):中文 RAG 教程,看它讲文本分块的那一章,对比框架切分器和我们手写的版本。

## 自测

**1. 为什么帽子只拼在 `embed_text` 上,不存进 `kb.chunks.content`?**

<details><summary>答案</summary>

帽子的作用只是让向量里带上「这块出自哪篇哪节」。`content` 是要给模型当引用原文、给客户点开看的,带上帽子会多一行莫名其妙的前缀,还会让引用和原文对不上。所以算向量用 `embed_text`(帽子加原文),存库和展示用 `text`(纯原文)。

</details>

**2. `re.split(r"^## +", body)` 不加 `flags=re.M`,会得到什么?为什么不报错?**

<details><summary>答案</summary>

只得到一段(整篇文章),因为 `^` 默认只匹配整个字符串的开头,正文里行首的 `## ` 都不算。不报错是因为「没切开」在正则看来是一个合法结果,返回的就是 `[整个字符串]`。这类静默的错只能靠报告脚本(块数不对)或者测试发现。

</details>

**3. 今天的 `split_long` 第一版有什么 bug?在什么条件下才会出现?怎么修?**

<details><summary>答案</summary>

最后一句话很长时,会多出一块只含上一块末尾重叠部分的重复块。触发条件有两个:文本以句号结尾(`re.split` 在末尾多给一个空串),并且手里攒的内容已经超过上限。修法是跳过空串,用 `fresh` 标记记住「手里有没有新内容」,只有重叠尾巴时不收块。默认参数下、真实数据里不会出现,要用小参数才逼得出来。

</details>

**4. 40 条问法里,「没帽子」34 条对、「标题 > 小标题」39 条对。能不能说帽子让准确率提高了 14.7%?**

<details><summary>答案</summary>

不能。样本只有 40 条,差 5 条;问法是我自己写的,写时看过标题,带标题的帽子占便宜;embedding 服务重跑偶尔差 1 条。只能说「在这批文章、这批问法上,戴标题帽子明显好于不戴」,换一批问法要重量。

</details>

**5. (面试题)你们的 RAG 知识库文章切块,块太大和太小各有什么问题?你怎么选大小?**

<details><summary>答案</summary>

块太大:一块里混着好几个主题,向量变成「平均值」,和具体问题的相似度被稀释;还会把无关内容一起塞给模型,浪费 token、分散注意力。块太小:单块失去上下文,孤立地看不出在讲什么(比如只有「月付订阅不支持退款」,不知道是哪篇的)。选法:先看文档自己的结构,优先按天然边界切(标题、段落、问答对),再给块补上下文(标题前缀);大小不要抄别人的数字,切完打印块数和长度分布,再用带标准答案的问法量检索效果,拿数字调。

</details>

**6. `LLMClient` 从练习仓库搬到 SupportPilot,改了哪三处?不改会怎样?**

<details><summary>答案</summary>

导入(去掉 `os`、`json`、`dotenv`,加 `from .config import ...`)、`__init__` 的签名(`env_file` 换成 `settings`)、`__init__` 的函数体(模型、价格、`extra_body`、地址、密钥全从 `Settings` 取)。原因:SupportPilot 的配置统一由 `Settings` 管,价格的形式和练习仓库不同(没有 `LLM_PRICE`,只有输入、输出两个价)。不改的话能跑,但读不到价格,每次调用的费用都是 0.0,不报错。`chat`、`stream`、`Conversation` 不用动。

</details>

## 明天预告

明天是 Day 449 · 知识库(二):向量化和增量导入。今天把 62 篇文章变成了 150 块,每块有原文和帽子,但还都在内存里。明天做两件事:把 embedding 写成项目里的正式模块 `kb/embed.py`(接口和 [Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py` 一样),再写 `kb/ingest.py`,把 150 块连同向量写进 Postgres 的 `kb.docs` 和 `kb.chunks`。重点是「增量」:文章没变就跳过,变了只重做这一篇,中途出错不留半篇。而且今天的帽子会在那里再出场一次,改了帽子的写法,怎么让旧向量跟着更新。
