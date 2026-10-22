---
title: 'Day 251 · 第 36 周复习:RAG 与上下文(Day 245–250)'
description: '这一周六天讲的都是「资料不是干净 Markdown 时怎么办」:图片、PDF、截图、代码、超长日志、要跨文章串起来的关系。今天画一张知识地图,每天一句话回顾,然后用 ast 加三元组做一个小项目:回答「改了这个文件会影响谁」,把 Day 248 和 Day 250 接起来。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'rag', 'knowledge-graph', 'agent-zero']
series: 'agent-zero'
day: 251
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 250](/blog/agent-zero/day-250-kg-basics/) 手写了 16 条 CloudLedger 三元组,用列表、邻接表和 SQLite 各查了一遍:枚举题按关系类型查,多跳题从问题里的实体出发沿边走,还故意写反一条边,看到枚举悄悄漏掉一项。

这是第 36 周的最后一天。这一周的六天看起来很散,多模态、代码检索、RLM、知识图谱,其实在回答同一个问题:Day 224 到 Day 243 搭的那条 RAG 流水线默认资料是切得开、搜得到的文字,资料不是这样的时候该怎么办。今天把它们串起来。

## 今天要解决的问题

1. 能对着一张图说出本周六天各解决了哪种「不规整的资料」,以及各自的代价。
2. 不看文章默写出两段核心代码:按函数切代码块(Day 248)、三元组查询和沿边走(Day 250),并跑通。
3. 完成一个只用本周知识的小项目 `part04/review36_deps.py`:用 `ast` 把练习仓库里的 import 关系抽成三元组,回答「改了这个文件会影响谁」。

预计用时 3 小时。花费 ¥0,今天不调模型。

前置:本周的 [Day 245](/blog/agent-zero/day-245-vision-1/) 到 [Day 250](/blog/agent-zero/day-250-kg-basics/)。小项目用到 Day 248 的 `ast` 和 Day 250 的三元组、BFS,另外要用到 Day 249 和 Day 250 在 `part04/` 里建的那些文件(`rlm_mini.py`、`kg_triples.py` 等),因为小项目就是拿它们当分析对象。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。复习日的默写特别重要,练习 1 和练习 2 请真的合上文章写。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 36 周知识地图:中间是 Day 224 到 243 的文字 RAG 流水线,四周是六种不规整的资料和对应的办法:图片用视觉模型,PDF 三条路,截图转检索词,代码按 AST 切块,超长输入用 RLM,跨文章关系用知识图谱">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="230" y="135" width="180" height="60" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="160" fill="var(--ink)" text-anchor="middle">文字 RAG 流水线</text>
<text x="320" y="180" fill="var(--ink-soft)" text-anchor="middle" font-size="11">切块→检索→rerank→回答</text>
<rect x="20" y="20" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="42" fill="var(--ink)" text-anchor="middle">245 图片怎么进模型</text>
<text x="110" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">image_url;detail 档位</text>
<rect x="230" y="20" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="42" fill="var(--ink)" text-anchor="middle">246 PDF 三条路</text>
<text x="320" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">文字层/OCR/VLM;对账</text>
<rect x="440" y="20" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="530" y="42" fill="var(--ink)" text-anchor="middle">247 截图进检索</text>
<text x="530" y="62" fill="var(--ink-soft)" text-anchor="middle" font-size="11">截图→检索词;ColPali</text>
<rect x="20" y="254" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="110" y="276" fill="var(--ink)" text-anchor="middle">248 代码库检索</text>
<text x="110" y="296" fill="var(--ink-soft)" text-anchor="middle" font-size="11">AST 切块;repo map</text>
<rect x="230" y="254" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="276" fill="var(--ink)" text-anchor="middle">249 RLM</text>
<text x="320" y="296" fill="var(--ink-soft)" text-anchor="middle" font-size="11">资料进变量;子调用</text>
<rect x="440" y="254" width="180" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="530" y="276" fill="var(--ink)" text-anchor="middle">250 知识图谱</text>
<text x="530" y="296" fill="var(--ink-soft)" text-anchor="middle" font-size="11">三元组;沿边走</text>
<line x1="110" y1="76" x2="250" y2="135" stroke="var(--ink-soft)"/>
<line x1="320" y1="76" x2="320" y2="135" stroke="var(--ink-soft)"/>
<line x1="530" y1="76" x2="390" y2="135" stroke="var(--ink-soft)"/>
<line x1="110" y1="254" x2="250" y2="195" stroke="var(--ink-soft)"/>
<line x1="320" y1="254" x2="320" y2="195" stroke="var(--ink-soft)"/>
<line x1="530" y1="254" x2="390" y2="195" stroke="var(--ink-soft)"/>
<text x="320" y="110" fill="var(--ink-faint)" text-anchor="middle" font-size="11">上排:先把资料变成文字,再进原来的流水线</text>
<text x="320" y="232" fill="var(--ink-faint)" text-anchor="middle" font-size="11">下排:资料变不成好切的文字,换一种找法</text>
</g>
</svg>
<figcaption>本周六天的位置。上排三天是「入口改造」:图片、PDF、截图想办法变成文字或检索词,后面的流水线不用动。下排三天是「换一种找法」:代码按结构、长文按代码、关系按图。</figcaption>
</figure>

这张图里最值得记的是上下两排的区别。上排的办法是「变成文字」,好处是后面 Day 224 到 Day 243 写的东西全部能复用,BM25 也照样能精确匹配错误码;代价是转换时会丢信息(OCR 认错字,视觉模型漏掉描述)。下排三种资料硬变成文字块效果很差:代码切断了就没意义,超长日志的计数题 top-k 装不下,跨文章的关系每一块单看都不像问题。所以下排三天各换了一种「找」的方式。

## 本周每天一句话

- [Day 245 · 多模态(一):模型怎么「看」图,第一次发图](/blog/agent-zero/day-245-vision-1/):图片被切成小方块,每块变成一个视觉 token 和文字拼在一起送进模型;`detail` 档位决定切多细,那一课实测同一张账单图 high 约 716 个 token、low 约 195 个。
- [Day 246 · 多模态(二):读 PDF 的三条路,账单抽取和对账](/blog/agent-zero/day-246-vision-2/):有文字层就抽文字,扫描件走 OCR 或视觉模型;模型只负责读出数字,算对不对、和业务库对不对得上由代码判断,改过合计的账单就是这样抓出来的。
- [Day 247 · 多模态(三):截图进检索,解析工具和多模态 RAG](/blog/agent-zero/day-247-vision-3/):客户的报错截图里有他自己说不清的错误码,先让视觉模型把截图读成检索词,kb-011 就能命中;知识库里本身有图时,要么先转文字描述,要么用 ColPali 这类直接检索页面图片的方法。
- [Day 248 · 代码库检索:AST 切块和 repo map](/blog/agent-zero/day-248-code-retrieval/):代码按语法树一个函数一块,每块带文件路径;按名字数引用会把 `client.chat` 算成调用了 `chat()`,要回答调用关系得靠真正的符号解析或者查引用的工具。
- [Day 249 · 递归语言模型 RLM](/blog/agent-zero/day-249-rlm/):2000 张工单整份塞进 prompt,计数题 22 答成 8;RLM 把资料放进 REPL 变量,让模型写代码筛选,看不懂的片段再调子模型,答对了,每题一两分钱。
- [Day 250 · 知识图谱三分钟入门](/blog/agent-zero/day-250-kg-basics/):事实写成(头,关系,尾),枚举题按关系类型查,多跳题沿边走;图对不对全看建图,方向写反一条,查询不报错,只是悄悄漏答案。

## 本周小项目:改了这个文件会影响谁

前端同学对这个问题一定不陌生。改了一个公共组件,心里没底到底有多少页面在用它,于是全局搜一下组件名。webpack、Vite 打包时其实已经建好了一张模块依赖图,热更新(HMR)就是靠这张图知道「这个文件变了,要通知哪些模块」。今天我们给自己的 Python 练习仓库建一张这样的图,只用本周学过的东西:

- 用 Day 248 的 `ast` 把每个文件里的 `from part04.xxx import ...` 找出来;
- 每找到一个,写成 Day 250 的三元组(文件 A,导入,文件 B,出处是第几行);
- 「改了 B 会影响谁」就是从 B 出发,**逆着**「导入」的箭头走:谁导入了 B,谁又导入了那个文件。

分析对象就是 `part04/` 自己。Day 249 的 `rlm_mini.py` 导入了 `repl_demo.py`,`rlm_define.py` 又导入了 `rlm_mini.py`,这已经是一条两跳的链了。

```python
# agent-zero-lab/part04/review36_deps.py  第 36 周小项目:用 ast 把 import 关系抽成三元组,回答「改了这个文件影响谁」
import ast
import sys
from collections import defaultdict
from pathlib import Path

Triple = tuple[str, str, str, str]


def import_triples(root: Path) -> list[Triple]:
    triples: list[Triple] = []
    for path in sorted(root.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith(f"{root.name}."):
                target = node.module.replace(".", "/") + ".py"
                triples.append((str(path), "导入", target, f"第 {node.lineno} 行"))
    return triples


def affected(changed: str, triples: list[Triple], max_hops: int = 3) -> list[tuple[int, str]]:
    users: dict[str, list[str]] = defaultdict(list)
    for h, _r, t, _src in triples:
        users[t].append(h)
    result: list[tuple[int, str]] = []
    seen = {changed}
    frontier = [changed]
    for hop in range(1, max_hops + 1):
        nxt: list[str] = []
        for f in frontier:
            for u in users[f]:
                if u not in seen:
                    seen.add(u)
                    result.append((hop, u))
                    nxt.append(u)
        frontier = nxt
    return result


if __name__ == "__main__":
    triples = import_triples(Path("part04"))
    print(f"{len(triples)} 条导入关系,例如:{triples[0]}")
    changed = sys.argv[1] if len(sys.argv) > 1 else "part04/repl_demo.py"
    print(f"改了 {changed},会影响:")
    for hop, f in affected(changed, triples):
        print(f"  {hop} 步  {f}")
```

<div class="line-notes">

- `Triple = tuple[str, str, str, str]` 和 Day 250 的 `kg_triples.py` 同一个类型别名。这里重新写一遍,不 import,是为了让这个文件只依赖标准库。
- `for path in sorted(root.glob("*.py")):` 只看 `part04/` 这一层的 `.py` 文件。`sorted` 让输出顺序固定,你我的结果才能对得上。
- `tree = ast.parse(path.read_text(encoding="utf-8"))` 和 Day 248 一样,把源码解析成语法树。这一步要用 Python 3.12 跑(`uv run`),否则新语法会 `SyntaxError`。
- `for node in ast.walk(tree):` Day 248 用的是 `tree.body`,只看最外层;这里用 `ast.walk` 把整棵树每个节点都走一遍,写在函数里面的 import 也能找到。
- `if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith(f"{root.name}."):` `ast.ImportFrom` 就是 `from X import Y` 这种语句,`node.module` 是 X。`root.name` 是 `"part04"`,所以只留 `part04.` 开头的,`from pathlib import Path` 这种标准库导入被过滤掉。`node.module` 可能是 `None`(`from . import x` 这种相对导入),先判断一下。
- `target = node.module.replace(".", "/") + ".py"` 把模块名 `part04.repl_demo` 换成文件路径 `part04/repl_demo.py`,头和尾才是同一种写法,后面才能对上。
- `triples.append((str(path), "导入", target, f"第 {node.lineno} 行"))` 一条三元组:(谁, 导入, 谁),出处是那条 import 在第几行。比如 `('part04/rlm_mini.py', '导入', 'part04/repl_demo.py', '第 9 行')`。
- `users: dict[str, list[str]] = defaultdict(list)` Day 250 练习 2 的入边表:键是被导入的文件,值是所有导入它的文件。
- `seen = {changed}` 记住走过的点。仓库里 A 导入 B、B 又导入 A 的循环导入虽然少见,但一旦有就会转圈。
- `frontier = [changed]` 按圈往外扩:第 1 圈是直接导入它的,第 2 圈是导入了第 1 圈的。
- `if u not in seen:` 同一个文件可能从两条路都能走到(`rlm_budget.py` 同时导入了 `repl_demo.py` 和 `rlm_mini.py`),只记最先走到的那一次,也就是步数最少的那次。
- `changed = sys.argv[1] if len(sys.argv) > 1 else "part04/repl_demo.py"` 默认问 `repl_demo.py`,也可以在命令行指定别的文件。

</div>

在 `agent-zero-lab/` 下跑:

```bash
uv run python -m part04.review36_deps
uv run python -m part04.review36_deps part04/kg_triples.py
```

我的输出(这时我的 `part04/` 里只有 Day 249、Day 250 的 17 个文件加上刚写的 `review36_deps.py`,一共 18 个;你的 `part04/` 里还有 Day 212 以来的其他文件,条数会更多,但这几行应该都在。做完下面的练习 3、4 再跑,`review36_why.py` 和 `review36_common.py` 各自导入了 `review36_deps.py`,会变成 14 条):

```text
12 条导入关系,例如:('part04/kg_direction.py', '导入', 'part04/kg_triples.py', '第 2 行')
改了 part04/repl_demo.py,会影响:
  1 步  part04/rlm_budget.py
  1 步  part04/rlm_mini.py
  2 步  part04/rlm_define.py
12 条导入关系,例如:('part04/kg_direction.py', '导入', 'part04/kg_triples.py', '第 2 行')
改了 part04/kg_triples.py,会影响:
  1 步  part04/kg_direction.py
  1 步  part04/kg_ex1.py
  1 步  part04/kg_ex2.py
  1 步  part04/kg_ex2_fixed.py
  1 步  part04/kg_ex4.py
  1 步  part04/kg_hops.py
  1 步  part04/kg_sqlite.py
```

第一个问题的答案对照 Day 249 检查一下:`rlm_mini.py` 第 9 行 `from part04.repl_demo import run_code`,`rlm_budget.py` 也直接导入了它;`rlm_define.py` 没有直接导入 `repl_demo.py`,但它导入了 `rlm_mini.py`,所以是 2 步。这就是多跳:你改了 `run_code` 的返回格式,`rlm_define.py` 一行没改也可能坏掉,而全局搜「repl_demo」是搜不到它的。

和 Day 248 的 repo map 比一下。那一课按名字数引用次数,同名的函数分不清、`client.chat` 被算成调用了 `chat()`。今天的 import 关系是精确的:`from part04.repl_demo import run_code` 明确写了是哪个文件,不会张冠李戴。代价是粒度粗,只到文件,不到函数。`kg_triples.py` 改了 `find()` 的参数,我们只知道 7 个文件导入了这个模块,不知道其中哪些真的调用了 `find()`(实际上只有 `kg_triples.py` 自己的演示代码用了它,那 7 个文件导入的是 `TRIPLES`)。要精确到函数,得像 Day 248 说的那样接语言服务器做符号解析。

零件对照表,看看小项目的每一段来自哪一天:

| 零件 | 来自 | 在小项目里是 |
| --- | --- | --- |
| `ast.parse`、按节点类型筛选 | Day 248 | `import_triples` 里找 `ast.ImportFrom` |
| 每块带「文件:行号」出处 | Day 248 的 `id` | 三元组第四项 `第 9 行` |
| 三元组(头,关系,尾,出处) | Day 250 `kg_triples.py` | `(文件, "导入", 文件, 行号)` |
| 入边表、反着走 | Day 250 练习 2 | `users` 和 `affected` |
| `seen` 防环、按步数分层 | Day 250 `kg_hops.py` | `affected` 的 `seen`、`frontier` |

## 本周错题与坑清单

这一周我自己踩过、或者在实跑里看到的坑,按天列出来。复习时一条条问自己:这个坑我还会不会踩?

- **图片 token 不是固定的。** 同一张图,`detail` 档位不同、分辨率不同,token 数能差好几倍(Day 245 的 716 对 195)。先用 low 档试,看不清再升。
- **只认字的 OCR 会把形近字认错。** Day 246 那张扫描账单,OCR 把「客户」认成「客广」。金额这类关键字段,抽出来以后要用代码校验(明细加起来等不等于合计),不能直接信。
- **Intel Mac 上 `uv add onnxruntime` 装不上。** 最新版不再提供 `macosx_x86_64` 的包,要写 `"onnxruntime<1.23"`。这是 Day 243、Day 246 用 RapidOCR 时的坑。
- **让客户自己描述问题,会丢掉最关键的信息。** Day 247 里「导入银行流水失败」检索到的是 E1042,截图里写的其实是 E1043。截图里的原文比转述可靠。
- **多模态 RAG「先转文字」时,描述写得太笼统。** 一句「这是一张设置页面的截图」什么都搜不到,提示词里要求它抄录图里所有文字。
- **代码按字数切块。** 函数被拦腰切断,半块代码既不完整也不知道属于谁。
- **按名字计数当引用关系。** 同名函数分不清,属性访问被算成函数调用。今天的小项目用 import 语句,精确但只到文件级。
- **以为窗口装得下就能答对。** Day 249 的 7 万 token 只占 1M 窗口的 7%,计数照样错。
- **RLM 不截断回传的输出。** 模型一 `print(context)`,就退化成全塞进 prompt。
- **RLM 的子 prompt 带偏子模型。** Day 249 第 6 轮根模型在子 prompt 里写了「应判否」,子模型就照着答了。看轨迹要连子 prompt 一起看。
- **三元组方向写反、把「包含」写成「仅限」。** 查询不报错,答案悄悄漏掉或者凭空多出来。
- **遍历图不记走过的点。** Day 250 练习 2 第一次就绕回了起点。

## 动手练习

**练习 1:默写 Day 248 的 AST 切块。** 合上文章,写一个 `chunk_file(path)`,把一个 Python 文件按最外层的函数和类切块,每块带 `id`(文件:行号)、`symbol`(名字)、`text`(前面加上文件路径的源码)。用它切 `part04/rlm_mini.py` 和 `part04/kg_hops.py`,打印每块的 id、名字和行数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/review36_chunks.py  默写 Day 248 的核心:按函数和类切代码块
import ast
import sys
from pathlib import Path


def chunk_file(path: Path) -> list[dict[str, str]]:
    source = path.read_text(encoding="utf-8")
    chunks: list[dict[str, str]] = []
    for node in ast.parse(source).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            code = ast.get_source_segment(source, node) or ""
            chunks.append({"id": f"{path}:{node.lineno}", "symbol": node.name, "text": f"# 文件 {path}\n{code}"})
    return chunks


if __name__ == "__main__":
    for c in chunk_file(Path(sys.argv[1])):
        print(f"{c['id']:<28} {c['symbol']:<10} {len(c['text'].splitlines())} 行")
```

<div class="line-notes">

- `for node in ast.parse(source).body:` 只看最外层。`rlm_mini.py` 最外层有两个函数 `llm_query` 和 `rlm`,`SYSTEM`、`TASKS` 这些常量不是函数也不是类,不成块。
- `if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):` 三种节点各成一块。`isinstance` 的第二个参数可以是元组,意思是「是其中任意一种」。
- `code = ast.get_source_segment(source, node) or ""` 按节点的起止位置把原文完整切出来,函数不会被切断。
- `"text": f"# 文件 {path}\n{code}"` 每块前面带上路径,检索时这条信息也能被搜到。
- `print(f"{c['id']:<28} {c['symbol']:<10} {len(c['text'].splitlines())} 行")` `:<28` 是左对齐补到 28 个字符,让输出排成整齐的列。

</div>

```bash
uv run python -m part04.review36_chunks part04/rlm_mini.py
uv run python -m part04.review36_chunks part04/kg_hops.py
```

```text
part04/rlm_mini.py:24        llm_query  3 行
part04/rlm_mini.py:28        rlm        24 行
part04/kg_hops.py:11         walk       17 行
```

`rlm` 那一块 24 行,正好是 Day 249 那个循环的全部,没有被切断。行数里多出来的 1 行是我们加在前面的「# 文件 ...」。如果你默写时用了 `ast.walk` 而不是 `.body`,`rlm` 里面没有嵌套函数,结果一样;但遇到类的时候,`ast.walk` 会把类里每个方法也单独切一次,类和方法就重复了。

</details>

**练习 2:默写 Day 250 的 `find()` 和 `walk()`。** 合上文章,在一个新文件里写出 `find(head, rel, tail)`(哪一位不填就不限制)和 `walk(start, max_hops)`(BFS,带 `seen`),导入 `kg_triples.py` 的 `TRIPLES`,回答「哪些东西仅限企业版」和「从 E4029 出发走 3 步能到哪」。输出要和 Day 250 一致。

<details><summary>参考答案</summary>

参考答案就是 Day 250 的 `part04/kg_triples.py` 里的 `find` 和 `part04/kg_hops.py` 里的 `walk`,不重复贴了,写完对照那两个文件逐行比。默写时最容易错的是两处:一是 `find` 的条件写成 `t[0] == head or head is None` 也能跑,但把 `is None` 放前面更好读,也能在 `head` 是 `None` 时不做无意义的比较;二是 `walk` 里把 `seen.add(t)` 放在了 `queue.popleft()` 之后才加,结果同一个点会被不同的路径重复放进队列好几次。正确的位置是「发现这个点、放进队列的那一刻」就加进 `seen`。

跑出来应该是:仅限企业版的有开放 API(kb-019)和备份恢复(kb-018);从 E4029 出发,1 步到开放 API,2 步到企业版,3 步到 1908 元、专属客服、增值税专用发票。

</details>

**练习 3:不光说影响谁,还要说为什么。** 小项目只打印了文件名。改一下,让每一行带上完整的链条和每一跳的 import 行号,比如 `part04/rlm_define.py(第 4 行)-> part04/rlm_mini.py(第 9 行)-> part04/repl_demo.py`。这和 Day 250 里沿边走时把出处带上是同一件事:回答要有证据。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/review36_why.py  练习 3:不光说影响谁,还要说「为什么」,把每一跳的 import 行号带出来
import sys
from pathlib import Path

from part04.review36_deps import import_triples

triples = import_triples(Path("part04"))
changed = sys.argv[1] if len(sys.argv) > 1 else "part04/repl_demo.py"
frontier = [(changed, changed)]
seen = {changed}
for hop in range(1, 4):
    nxt: list[tuple[str, str]] = []
    for target, chain in frontier:
        for h, _r, t, src in triples:
            if t == target and h not in seen:
                seen.add(h)
                line = f"{h}({src})-> {chain}"
                print(f"{hop} 步  {line}")
                nxt.append((h, line))
    frontier = nxt
```

<div class="line-notes">

- `from part04.review36_deps import import_triples` 复用小项目抽三元组的函数。注意这一行本身又给图加了一条边:`review36_why.py` 导入 `review36_deps.py`。
- `frontier = [(changed, changed)]` 和 Day 250 练习 2 一样,每个点带着「从它到目标」的那串文字。
- `for h, _r, t, src in triples:` 这次没建入边表,直接扫全部三元组找「尾等于当前点」的。这时一共 13 条边(多了本文件导入 `review36_deps.py` 那一条),扫一遍很快,文件多了再换成 dict。
- `line = f"{h}({src})-> {chain}"` 新的一跳加在链条左边,括号里是这一跳的 import 在第几行。

</div>

```bash
uv run python -m part04.review36_why
```

```text
1 步  part04/rlm_budget.py(第 6 行)-> part04/repl_demo.py
1 步  part04/rlm_mini.py(第 9 行)-> part04/repl_demo.py
2 步  part04/rlm_define.py(第 4 行)-> part04/rlm_mini.py(第 9 行)-> part04/repl_demo.py
```

第三行就是一条完整的证据链,打开 `rlm_define.py` 第 4 行、`rlm_mini.py` 第 9 行就能核对。Day 253 的 local search 交给模型的也是这种「路径加出处」。

</details>

**练习 4:把 `common/` 也算进来。** 小项目只看 `part04.` 开头的导入。Day 249 的好几个文件都 `from common.llm import LLMClient`。改一下,扫描 `agent-zero-lab/` 下所有子目录的 `.py`,把 `common.` 开头的也算上,回答「改了 `common/llm.py` 会影响谁」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/review36_common.py  练习 4:把 common/ 也算进来,问「改了 common/llm.py 影响谁」
import ast
from pathlib import Path

from part04.review36_deps import Triple, affected

LOCAL = ("part04.", "common.")


def import_triples_all(root: Path) -> list[Triple]:
    triples: list[Triple] = []
    for path in sorted(root.glob("*/*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith(LOCAL):
                triples.append((str(path), "导入", node.module.replace(".", "/") + ".py", f"第 {node.lineno} 行"))
    return triples


triples = import_triples_all(Path("."))
print(f"{len(triples)} 条导入关系")
for hop, f in affected("common/llm.py", triples):
    print(f"  {hop} 步  {f}")
```

<div class="line-notes">

- `from part04.review36_deps import Triple, affected` `affected` 不用改,它只管图,不管图是怎么来的。抽取和查询分开写的好处就在这里。
- `LOCAL = ("part04.", "common.")` `str.startswith` 可以接一个元组,意思是「以其中任意一个开头」。
- `for path in sorted(root.glob("*/*.py")):` 从 `agent-zero-lab/` 往下一层,`common/`、`part04/` 等每个子目录的 `.py` 都扫到。`.venv` 里的第三方库都在更深的目录里,这个模式扫不到它们。
- `triples = import_triples_all(Path("."))` 在 `agent-zero-lab/` 下跑,`.` 就是仓库根目录。

</div>

```text
17 条导入关系
  1 步  part04/long_direct.py
  1 步  part04/long_direct_free.py
  1 步  part04/rlm_mini.py
  2 步  part04/rlm_budget.py
  2 步  part04/rlm_define.py
```

改 `common/llm.py` 一次会影响 5 个文件,其中两个是间接的。你的仓库里 `common/llm.py` 从 Day 135 用到现在,结果会长得多,`common/` 里其他文件(比如 Day 124 的 `cost.py` 如果被 `llm.py` 导入了)也会出现在链条上。这就是为什么 Day 137 要给 `LLMClient` 写测试:它是被依赖最多的那个文件。

</details>

**练习 5:选方法。** 下面五个需求,各说一句该用本周哪一天的方法,为什么。

1. 客户发来一张手机拍的账单照片,说「你们多扣了我钱」。
2. 研发同事问:「我想改 `LLMClient.chat()` 的返回值,会影响哪些地方?」
3. 运营要一份「上季度所有提到退款的工单里,客户最常抱怨的三个原因」。
4. 客服问:「企业版客户能不能用优惠码?」
5. 法务上传了一份 200 页的扫描版合同,问里面所有违约金条款。

<details><summary>参考答案</summary>

1. Day 246:照片没有文字层,走视觉模型把账单读成结构化字段,再由代码校验合计、和业务库里的账单对账。不要让模型自己判断「多扣了没有」。
2. Day 248 加今天的小项目:按 AST 找到 `chat` 的定义,import 图先圈出导入了 `common.llm` 的文件,再在这些文件里查真正调用了 `.chat(` 的位置。只靠按名字计数会把 `client.chat.completions` 也算进来。
3. Day 249:答案散在几百张工单里,要先筛「提到退款」再归类计数,一次性的后台分析不怕慢,适合 RLM。如果工单在数据库里,先用 SQL 筛出来再让模型归类更稳。
4. Day 250 或者普通 RAG 都行:答案就在 kb-008 一句话里,普通检索就能找到;如果已经建了图,(优惠码,不适用于,企业版)一步就查到,还不会被「仅限」「不适用于」这种意思相反的句子搞混。
5. Day 246 加 Day 249:扫描件先走 OCR 或视觉模型转成文字(这一步要抽查质量),再用 RLM 那种「代码切条款、粗筛关键词、子调用逐条抽金额和条件」的做法枚举。直接 top-k 检索会漏条款。

</details>

验收标准:练习 1、2 是合上文章写出来的,并且输出和文中一致;小项目和练习 3 跑通,能对着输出讲清楚 `rlm_define.py` 为什么是 2 步;练习 5 每一题都能说出「为什么不用另外几种方法」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 知识地图 | 复习日用的一张图,把一周的知识点按关系摆在一起 |
| 依赖图(dependency graph) | 点是文件或模块,边是「谁导入了谁」。webpack、Vite 内部都有一张,热更新靠它 |
| 影响分析(impact analysis) | 改了某处以后,找出所有可能受影响的地方。今天的小项目就是最简单的一种 |
| `ast.ImportFrom` | 语法树里 `from X import Y` 这种语句对应的节点类型,`node.module` 是 X |
| `ast.walk` | 把一棵语法树的每个节点都走一遍,和只看 `tree.body`(最外层)不同 |
| 相对导入 | `from . import x` 这种以点开头的写法,`node.module` 可能是 `None` |
| 循环导入 | A 导入 B、B 又导入 A,在依赖图里就是一个环 |

本周其他名词在各天的名词解释里:视觉 token 和 `detail` 见 Day 245,文字层、OCR、VLM 见 Day 246,ColPali 见 Day 247,AST 切块和 repo map 见 Day 248,RLM、REPL、子调用见 Day 249,三元组、多跳、BFS 见 Day 250。

## 常见误区

**以为本周六天是六个互不相关的技巧。** 它们都在回答「资料不是干净文字时怎么办」。上排三天把资料变成文字,下排三天换一种找法。面试里能把它们放进这一个框架讲,比逐个背更有说服力。

**import 图说「会影响」就一定会坏。** import 只说明这个文件用了那个模块里的某样东西,不说明用的是你改的那一个。今天 `kg_triples.py` 的 7 个下游都只用了 `TRIPLES`,改 `find()` 一个都不会坏。这是文件级依赖图天生的误报。

**以为 import 图能找到所有依赖。** `importlib.import_module("part04." + name)` 这种动态导入、通过字符串读文件(`Path("part04/data/kg.db")`)的依赖,`ast` 都看不出来。`kg_ex3.py` 依赖 `kg_sqlite.py` 先建好的 `kg.db`,小项目的图里就没有这条边。

**复习日只看不写。** 看懂和写得出来差得很远。`seen` 该在哪一行加、`ast.walk` 和 `.body` 有什么区别,这种细节不动手写一遍是发现不了的。

**用 grep 代替依赖分析。** 搜「repl_demo」只能找到直接导入它的文件,找不到 `rlm_define.py` 这种间接依赖。多跳是图的长处,这和 Day 250 开头讲向量检索答不好多跳题是一个道理。

## 学习资料

### 文档与文章

- [Python 文档 · ast](https://docs.python.org/zh-cn/3/library/ast.html):今天用到的 `ImportFrom`、`walk`、`get_source_segment` 都在这一页,中文版,查节点类型时用。
- [aider · Repository map](https://aider.chat/docs/repomap.html):Day 248 的出处,复习时再看一遍,对比它的「按图排序」和今天的「按依赖走」。
- [Recursive Language Models(arXiv 2512.24601)](https://arxiv.org/abs/2512.24601):Day 249 的论文,复习时把实验部分的成本对比读完。
- [ColPali(arXiv 2407.01449)](https://arxiv.org/abs/2407.01449):Day 247 讲的直接检索页面图片的方法,读摘要和图 1。
- [From Local to Global: A Graph RAG Approach(arXiv 2404.16130)](https://arxiv.org/abs/2404.16130):明天开始的 GraphRAG 三天都基于这篇,今天先读引言和方法概述。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZhH96TEq5&autoplay=0&high_quality=1" title="LlamaIndex 工程负责人：Grep 在代码库很好用，换成百万 PDF 就崩了——Agent 何时该用向量检索" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>全球AI科技不费眼 · LlamaIndex 工程负责人:Grep 在代码库很好用,换成百万 PDF 就崩了——Agent 何时该用向量检索 · 19 分钟,正好是本周的主题:不同的资料该用不同的找法。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18sLi6dENC&autoplay=0&high_quality=1" title="基于tree-sitter为你的编程agent添加语法树分析查找工具" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>苏瓦拉图 · 基于tree-sitter为你的编程agent添加语法树分析查找工具 · 7 分钟,今天的小项目用 Python 自带的 ast,这个视频讲多语言项目怎么用 tree-sitter 做同样的事。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qgGgzzEcd&autoplay=0&high_quality=1" title="深度解析和实战ColPali: RAG告别OCR和布局、从0开始多模态RAG" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>模鱼日记 · 深度解析和实战ColPali:RAG告别OCR和布局、从0开始多模态RAG · 近 2 小时,复习 Day 247 时只看开头讲原理的部分就够,后面的实战可以跳过。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/umbtFGPzdAM" title="MIT CSAIL Explains: Recursive Language Models" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>MIT CSAIL · MIT CSAIL Explains: Recursive Language Models · Day 249 推荐过,复习时开着字幕再看一遍,对照自己写的 60 行代码。</figcaption>
</figure>

- AI Learning Hub《ColPali Explained: Search PDFs as Images, Not Text》(YouTube ID `w_FYoEy-PhE`):ColPali 的短讲解,英文,复习 Day 247 用。

### 书籍

- Aidan Hogan 等《Knowledge Graphs》,[kgbook.org](https://kgbook.org/) 免费在线读。复习 Day 250 时读第 2 章,明天开始的 GraphRAG 也用得上。
- 王昊奋、漆桂林、陈华钧《知识图谱:方法、实践与应用》(电子工业出版社,2019),第 1、2 章。

### 开源项目与代码

- [tree-sitter/tree-sitter](https://github.com/tree-sitter/tree-sitter):多语言的语法解析器,Day 248 提过,今天的小项目想扩展到 JS/TS 项目就得用它。
- [illuin-tech/colpali](https://github.com/illuin-tech/colpali):ColPali 的官方实现,看 README 里的用法示例就行,要 GPU,本机跑不了。
- [alexzhang13/rlm](https://github.com/alexzhang13/rlm):Day 249 的官方实现,复习时读 `rlm/utils/prompts.py`。

## 自测

**1. 本周上排三天(245–247)和下排三天(248–250)的思路有什么根本区别?**

<details><summary>答案</summary>

上排是把图片、PDF、截图想办法变成文字或检索词,然后接进原来的文字 RAG 流水线,后面的东西不用改,代价是转换时会丢信息。下排的资料变成文字块效果很差(代码切断就没意义、计数题 top-k 装不下、跨文章关系每块都不像问题),所以换了找法:代码按语法结构切、长文让模型写代码去翻、关系存成图沿边走。

</details>

**2. 小项目里 `rlm_define.py` 为什么是「2 步」?全局搜「repl_demo」能不能找到它?**

<details><summary>答案</summary>

`rlm_define.py` 第 4 行导入的是 `rlm_mini.py`,`rlm_mini.py` 第 9 行导入了 `repl_demo.py`,要走两条「导入」边才连上。全局搜「repl_demo」找不到它,因为它的源码里根本没有这个词。这就是多跳依赖,图沿边走能找到,字面搜索找不到。

</details>

**3. 小项目说改 `kg_triples.py` 会影响 7 个文件,这个结论有什么问题?**

<details><summary>答案</summary>

是文件级的依赖,粒度太粗。7 个文件导入的都是 `TRIPLES`(有的还有 `Triple`),如果你改的是 `find()`,它们一个都不会坏;反过来,如果你改了 `TRIPLES` 里某条边的方向,`kg_direction.py` 的输出就会变。要精确到「用了哪个名字」,可以在 `ast.ImportFrom` 里读 `node.names`(导入的具体名字),或者接语言服务器做符号解析。另外动态导入和读文件这类依赖,`ast` 也看不出来。

</details>

**4. 一天 1 万张客户截图要过视觉模型,按 Day 245 实测的 high 约 716、low 约 195 个 token,输入价 2 元每百万 token,两档每天各花多少?差的这些钱值不值?**

<details><summary>答案</summary>

high:716 × 10000 × 2 / 1000000 ≈ ¥14.3;low:195 × 10000 × 2 / 1000000 ≈ ¥3.9。还要加上提示词和输出的 token。一天差 10 块左右,钱不多,但如果 low 档就能读清错误码,没有理由多花;真正要看的是准确率:先抽一批截图两档都跑,看 low 档读错多少,再决定。Day 245 的建议是先 low 后 high。

</details>

**5.(面试题)你接手一个 RAG 系统,知识库里有 Markdown 文档、扫描版 PDF、产品截图和一个代码仓库。用户反馈「有些问题明明知识库里有,却答不出来」。你会怎么排查和改进?**

<details><summary>答案</summary>

先分类,再按类型对症。第一步建一个带标注的问题集(每题标出答案在哪份资料、哪种类型),跑检索看漏在哪。常见几类:扫描 PDF 没有文字层,入库时就是空的,要补 OCR 或视觉模型解析,并抽查质量;截图里的信息没进索引,要么入库时让视觉模型写描述并抄录图中文字,要么上 ColPali 这类页面图片检索;代码被按字数切断,改成按 AST 切块、每块带路径,调用关系类问题给 Agent 加 grep、查引用这类工具;多跳和枚举问题(「哪些功能仅限企业版」),答案分散在几篇里,考虑抽知识图谱沿边查;需要通读全文的汇总问题,top-k 天生装不下,可以离线做汇总或用 RLM 这类按需读取的做法。每一项改动都用同一个问题集量前后的召回率,同时看成本和延迟。不要一上来就换向量库或换 embedding 模型,大部分「答不出来」是资料根本没被正确地变成可检索的东西。

</details>

## 明天预告

Day 252 · GraphRAG(一):用大模型抽三元组。Day 250 的 16 条三元组是我读着文章手写的,今天小项目的三元组是 `ast` 精确抽出来的。帮助中心这种自然语言文章没有语法树可用,明天让大模型来抽,你会看到 Day 250 讲的那些错误(方向反、「包含」写成「仅限」、同一个东西两个名字)在模型手里真实地出现,再用练习 4 那种类型检查把它们抓出来。
