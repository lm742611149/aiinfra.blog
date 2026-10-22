---
title: 'Day 224 · 切块:为什么切、怎么切'
description: '整篇编码会把多话题的文章稀释掉,所以要切块。今天只讲两件事:按标题切(用 re.split 按 ## 切小节,每块开头拼上「文章标题 > 小节标题」),和太长的小节按长度切并留重叠。中间踩两个坑:忘了 re.M 一刀都切不到,overlap 等于 max_chars 程序卡死。最后拼成 part04/chunking.py,20 篇切出 42 块。'
pubDate: 2026-10-22
regime: none
tags: ['rag', 'chunking', 'regex', 'embedding', 'agent-zero']
series: 'agent-zero'
day: 224
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 223](/blog/agent-zero/day-223-week32-review/) 复习了这一周,做了一个小项目:把 [Day 222](/blog/agent-zero/day-222-kb-data/) 造的 20 篇帮助中心文章**整篇**编码,问 6 个问题。5 道排对了,错的那道是「重复扣款多久能退回来」:答案在 kb-002《退款政策》里,却被整篇都在讲扣款的 kb-004 以 0.739 对 0.722 抢了第一。练习 2 把 kb-002 按小节拆开再量,「重复扣款」那一节单独拿出来是 0.820。

那个拆分是用 `split("\n## ")` 手工做的,只拆了一篇。今天把它做成正式的函数:20 篇全部切开,每一块带上编号、标题、分类,明天直接拿去建索引。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出为什么要切块的三个理由(模型有最大输入长度、长文的向量被稀释、整篇塞给大模型浪费又干扰),每个理由能举出本周实测的一个数字。
2. 用 `re.split(r"^## ", body, flags=re.M)` 按二级标题把文章切成小节,说清楚 `re.M` 是干什么的、忘了它会怎样;会给每块拼上「文章标题 > 小节标题」前缀,并用实测分数说明它为什么有用。
3. 写出 `split_long(text, max_chars, overlap)`:小节太长时按固定长度切,相邻两块重叠 `overlap` 个字;知道 `overlap >= max_chars` 时会死循环,并在函数开头挡住。
4. 拼出 `part04/chunking.py`,用 `load_chunks()` 把 20 篇切成 42 个 `Chunk`,能说出每个字段后面谁会用。

预计用时 2.5 小时:为什么切和三种切法 20 分钟,按标题切和前缀实验 50 分钟,按长度切和死循环 30 分钟,拼大代码 20 分钟,剩下做练习。前置:[Day 222](/blog/agent-zero/day-222-kb-data/) 的 `data/kb/` 和 `part04/kb_check.py`(带 main guard 的版本,今天要 import 它的 `read_meta`),[Day 223](/blog/agent-zero/day-223-week32-review/) 的练习 2,[Day 219](/blog/agent-zero/day-219-embed-limits/) 第一次用的 `re` 模块,[Day 50](/blog/agent-zero/day-050-dataclass/) 的 dataclass,[Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py`。

实跑花费:embedding 走硅基流动的 `BAAI/bge-m3`,免费,不调大模型,API 花费 0 元。正文加练习一共发了十几次请求、约 4500 个 token。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `split_long()` 和 `chunk_article()`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么要切

**切块**(chunking)就是把一篇文档切成若干小段,每一段叫一个**块**(chunk),之后每块单独算向量、单独被检索。检索的最小单位从「一篇」变成「一块」。理由有三个,本周每一个都量过。

第一,embedding 模型有最大输入长度。[Day 217](/blog/agent-zero/day-217-embed-service/) 试过,bge-m3 每条最多 8192 个 token,超了直接 400。我们的文章最长才 353 个字符,离这个上限很远;但真实的帮助中心、合同、产品手册,一篇几万字很常见,不切连编码都做不了。

第二,稀释。这是昨天亲手量出来的:kb-002 整篇 0.722,其中「重复扣款」小节单独 0.820。一个向量要代表整篇文章,文章讲的事越多,向量越像这些事的平均,和任何一个具体问题都只能「有点像」。

第三,就算检索到了,整篇塞给大模型也划不来。[Day 221](/blog/agent-zero/day-221-why-rag/) 和 [Day 220](/blog/agent-zero/day-220-embed-cost/) 都说过,RAG 真正花钱的是塞进 prompt 的那些资料。问「重复扣款多久退」,给模型 50 个字的那一节就够了,整篇 353 个字里另外 300 个字不但白花钱,还可能让模型把年付的规则错用到这个问题上。

那切多小?太小也不行。如果把「年付套餐中途取消的,按剩余的整月数比例退款」和后面「已经使用的月份和当前所在的月份不退」切成两块,检索到前一块的模型会以为当月也能退。**一块要小到只讲一件事,又要大到把这件事讲完整**。

## 三种常见切法

**固定长度切。** 不管内容,每 N 个字切一刀,相邻两块重叠几个字。最简单,对没有任何结构的长文本(比如一大段聊天记录、OCR 出来的扫描件)是唯一的选择。缺点是刀落在哪全凭运气,常常把一句话从中间切断。

**按结构切。** 按文档本来的结构切:Markdown 按标题,HTML 按段落和 `<section>`,代码按函数(Day 248 会讲代码检索)。帮助中心这种结构清楚的文档,按 `##` 切最自然,每一块恰好是作者自己划分好的一个小主题。

**语义切分。** 用 embedding 算相邻句子的相似度,在话题跳变的地方切。听起来最聪明,但要先给每一句编码,慢;Chroma 做过一组对比实验,语义切分并没有稳定地胜过简单的切法(链接在学习资料里)。

我的经验是:有结构就按结构切,没结构就固定长度加重叠,先跑起来,再用评估集([Day 257](/blog/agent-zero/day-257-rag-eval-3/) 起)决定要不要换。今天我们用第二种,再拿第一种兜底:某一节特别长,就在这一节里面按长度再切。这就是今天的两个知识点。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="kb-002 按二级标题切成四块,每块开头拼上文章标题和小节标题;太长的小节再按长度切并重叠">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">kb-002.md 正文</text>
<rect x="20" y="36" width="200" height="236" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="32" y="58" fill="var(--ink-soft)"># 退款政策</text>
<text x="32" y="88" fill="var(--ink)">## 年付套餐</text>
<text x="32" y="106" fill="var(--ink-soft)" font-size="11">按剩余整月比例退…</text>
<text x="32" y="136" fill="var(--ink)">## 月付套餐</text>
<text x="32" y="154" fill="var(--ink-soft)" font-size="11">不支持中途退款…</text>
<text x="32" y="184" fill="var(--ink)">## 重复扣款</text>
<text x="32" y="202" fill="var(--ink-soft)" font-size="11">3 个工作日内原路退回</text>
<text x="32" y="232" fill="var(--ink)">## 审批与到账</text>
<text x="32" y="250" fill="var(--ink-soft)" font-size="11">支付宝 1–3 天…</text>
<line x1="220" y1="98" x2="290" y2="62" stroke="var(--ink-faint)" marker-end="url(#m224)"/>
<line x1="220" y1="146" x2="290" y2="118" stroke="var(--ink-faint)" marker-end="url(#m224)"/>
<line x1="220" y1="194" x2="290" y2="174" stroke="var(--ink-faint)" marker-end="url(#m224)"/>
<line x1="220" y1="242" x2="290" y2="230" stroke="var(--ink-faint)" marker-end="url(#m224)"/>
<rect x="294" y="40" width="326" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="304" y="58" fill="var(--ink)">kb-002#1  133 字符</text>
<text x="304" y="75" fill="var(--compute)" font-size="11">退款政策 &gt; 年付套餐</text>
<rect x="294" y="96" width="326" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="304" y="114" fill="var(--ink)">kb-002#2  52 字符</text>
<text x="304" y="131" fill="var(--compute)" font-size="11">退款政策 &gt; 月付套餐</text>
<rect x="294" y="152" width="326" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="304" y="170" fill="var(--ink)">kb-002#3  50 字符</text>
<text x="304" y="187" fill="var(--compute)" font-size="11">退款政策 &gt; 重复扣款</text>
<rect x="294" y="208" width="326" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="304" y="226" fill="var(--ink)">kb-002#4  74 字符</text>
<text x="304" y="243" fill="var(--compute)" font-size="11">退款政策 &gt; 审批与到账</text>
<text x="294" y="282" fill="var(--ink-soft)" font-size="11">某节超过 max_chars:节内再按长度切,相邻重叠 overlap 字</text>
<defs><marker id="m224" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>一级标题那一段没有正文,丢掉;每个二级小节变成一块,块的开头(琥珀色)是拼上去的「文章标题 > 小节标题」。字符数是今天实测的,包括前缀。我们的小节都不长,所以按长度切那一步这次一刀都没切。</figcaption>
</figure>

## 第一步:用 re.split 按 ## 切小节

昨天用的是 `doc.split("\n## ")`,能用,但有两个小毛病:要求 `##` 前面紧挨一个换行(第一节要是正好在文件开头就切不到);写法也只能表达「一个固定的字符串」。正式版用正则:在**每一行的开头**出现 `## ` 的地方切。

新建 `part04/chunk_sections.py`,先故意少写一个参数,看看会怎样:

```python
# agent-zero-lab/part04/chunk_sections.py
import re
from pathlib import Path

raw = Path("data/kb/kb-002.md").read_text(encoding="utf-8")
body = raw.split("---", 2)[2].strip()

wrong = re.split(r"^## ", body)
right = re.split(r"^## ", body, flags=re.M)
print("不加 re.M:", len(wrong), "段")
print("加了 re.M:", len(right), "段")
for i, part in enumerate(right):
    print(i, repr(part[:16]))
```

<div class="line-notes">

- `import re` Python 自带的正则模块,[Day 219](/blog/agent-zero/day-219-embed-limits/) 用过它的 `re.findall`。
- `raw = Path("data/kb/kb-002.md").read_text(encoding="utf-8")` 读整篇,包括 frontmatter。
- `body = raw.split("---", 2)[2].strip()` Day 223 用过的写法:最多切两刀,第 2 段是正文。`strip()` 去掉首尾空白,所以 `body` 以 `"# 退款政策"` 开头。
- `wrong = re.split(r"^## ", body)` `re.split(模式, 文本)` 在每个匹配的地方切开,返回列表,匹配到的部分本身被丢掉。相当于 JS 的 `body.split(/^## /)`。`^` 表示「开头」,但默认只是**整段文字的开头**。`body` 的开头是 `# 退款政策`,不是 `## `,所以一个匹配都没有。
- `right = re.split(r"^## ", body, flags=re.M)` `re.M` 是 `re.MULTILINE` 的缩写,**多行模式**:让 `^` 匹配每一行的开头。相当于 JS 正则的 `m` 标志,`/^## /m`。
- `print("不加 re.M:", len(wrong), "段")` 实测 1 段,原文整个原样返回,一刀没切。
- `print("加了 re.M:", len(right), "段")` 实测 5 段:一级标题 1 段,4 个小节各 1 段。
- `for i, part in enumerate(right):` 把每段的前 16 个字符打出来看。
- `print(i, repr(part[:16]))` `repr` 让换行显示成 `\n`。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.chunk_sections
```

真实输出:

```text
不加 re.M: 1 段
加了 re.M: 5 段
0 '# 退款政策\n\n'
1 '年付套餐\n年付套餐(专业版和企业'
2 '月付套餐\n月付套餐不支持中途退款'
3 '重复扣款\n同一笔订阅被重复扣款的'
4 '审批与到账\n所有退款都需要客服主'
```

不加 `re.M` 的那次最阴险:**不报错**,原文整个原样返回,只有一段。放进后面的正式代码里会更糟:`chunk_article` 要扔掉第 0 段(一级标题),而这时第 0 段就是全部内容,于是每篇都切出 0 块。我把正式版里的 `re.M` 去掉试过,`load_chunks()` 返回的是一个空列表,一行报错都没有,下一步建索引会安安静静地建出一个空索引。

加了 `re.M` 以后,第 0 段是一级标题和两个换行,没有正文,扔掉。第 1 到 4 段都是同一个形状:小节标题、一个换行、小节正文。注意 `## ` 本身已经被切掉了,所以每段直接以「年付套餐」这样的标题开头。

把每段拆成「标题」和「正文」,用 Day 222 学的 `partition`:`"年付套餐\n年付套餐(专业版……".partition("\n")` 在第一个换行处切成 `("年付套餐", "\n", "年付套餐(专业版……")`。和 `split("\n", 1)` 比,好处还是那一条:就算某一节只有标题没有正文,它也一定返回三段,解包不会出错。

## 第二步:给每块拼上「文章标题 > 小节标题」

切开以后有一个新问题。Day 222 练习 2 数过,kb-010 到 kb-013 四篇错误码文章的小节都叫「原因」和「解决办法」。看 kb-012《错误码 E2017:发票识别失败》的「解决办法」这一节,正文是:

> 重新拍摄清晰的照片,或上传发票原始 PDF。加密的 PDF 需要先去掉密码。识别失败的发票也可以手动录入。

一个字都没提 E2017。整篇编码的时候,标题里的 E2017 还在同一个向量里;切开以后,这一块的向量里就没有任何关于 E2017 的信息了。客户问「E2017 怎么办」,它凭什么被找到?

办法很朴素:每一块的开头拼上它的「来历」,写成 `错误码 E2017:发票识别失败 > 解决办法` 这样一行,再接正文。别猜效果,量一下。新建 `part04/chunk_prefix.py`:

```python
# agent-zero-lab/part04/chunk_prefix.py
import re
from pathlib import Path

from common.embed import embed, embed_one

raw = Path("data/kb/kb-012.md").read_text(encoding="utf-8")
body = raw.split("---", 2)[2].strip()
title = "错误码 E2017:发票识别失败"

sections: dict[str, str] = {}
for part in re.split(r"^## ", body, flags=re.M)[1:]:
    section, _, content = part.partition("\n")
    sections[section] = content.strip()

bare = sections["解决办法"]
prefixed = f"{title} > 解决办法\n{bare}"

print(repr(bare))
print(repr(prefixed))
q = embed_one("E2017 怎么办")
v_bare, v_prefixed = embed([bare, prefixed])
print(f"不加前缀 {v_bare @ q:.3f}   加前缀 {v_prefixed @ q:.3f}")
```

<div class="line-notes">

- `from common.embed import embed, embed_one` Day 217 的模块。
- `raw = Path("data/kb/kb-012.md").read_text(encoding="utf-8")` 这次拿 kb-012。
- `title = "错误码 E2017:发票识别失败"` 文章标题。正式版里它从 frontmatter 读,这里为了短直接写上。
- `sections: dict[str, str] = {}` 小节标题 → 小节正文。
- `for part in re.split(r"^## ", body, flags=re.M)[1:]:` 上一步的切法,`[1:]` 扔掉一级标题那段。
- `section, _, content = part.partition("\n")` 第二轮拿到 `section="解决办法"`,`content` 是正文,中间的 `"\n"` 用 `_` 接住不要。
- `sections[section] = content.strip()` 存起来。kb-012 有两节,字典里两个键。
- `bare = sections["解决办法"]` 不带前缀的块,也就是只有正文。
- `prefixed = f"{title} > 解决办法\n{bare}"` 带前缀的块。`>` 只是一个分隔符号,人看着像面包屑导航(前端里 `首页 > 设置 > 账号` 那种),换成别的也行,关键是全课保持一致。
- `print(repr(bare))` 把两种块都打出来看。
- `v_bare, v_prefixed = embed([bare, prefixed])` 一次编码两条,得到 `(2, 1024)`,解包成两行。Day 219 提醒过:左边变量个数要和行数一样。
- `print(f"不加前缀 {v_bare @ q:.3f}   加前缀 {v_prefixed @ q:.3f}")` 两种块各自和问题的余弦。

</div>

```bash
uv run python -m part04.chunk_prefix
```

真实输出:

```text
'重新拍摄清晰的照片,或上传发票原始 PDF。加密的 PDF 需要先去掉密码。识别失败的发票也可以手动录入。'
'错误码 E2017:发票识别失败 > 解决办法\n重新拍摄清晰的照片,或上传发票原始 PDF。加密的 PDF 需要先去掉密码。识别失败的发票也可以手动录入。'
不加前缀 0.502   加前缀 0.571
```

一行前缀,分数从 0.502 涨到 0.571。0.07 看着不多,但 Day 223 量过,四篇错误码文章在整篇编码时彼此只差零点零几,0.07 足够决定排第几。练习 2 会在全部 42 块里排一次名,你会看到不带前缀时这一块掉到第 4 名。

这个技巧有个名字叫「块前缀」或者「加上下文」。[Day 241](/blog/agent-zero/day-241-contextual-retrieval/) 会讲 Anthropic 提出的 Contextual Retrieval,它把这个思路推到了极致:让大模型给每一块写一两句「这一块在整篇里讲的是什么」,拼到块前面。我们今天的版本是零成本的简化版,只拼标题。

前缀拼进 `text` 以后,它既会被送去编码,也会在检索到以后被拼进给大模型的 prompt。这是好事:模型读到 `错误码 E2017:发票识别失败 > 解决办法`,就知道下面这几句是在说哪个错误。

## 第三步:太长的小节按长度切,留重叠

我们的小节都很短,最长的 kb-001「三种套餐」带上前缀也才 199 个字符。但真实的帮助中心总有几节写得特别长,一节塞了两千字。按标题切完,这种块还是太大,就要在它内部再按长度切。这是今天的第二个知识点。

固定长度切有一个问题:刀落的位置可能正好在一句关键的话中间。**重叠**(overlap)就是为此准备的:下一块不从上一块的结尾开始,而是往回退几个字,让相邻两块共享一小段。这样被一刀切断的句子,至少在其中一块里是完整的。

新建 `part04/chunk_overlap.py`,先用 20 个字的玩具文本看清楚:

```python
# agent-zero-lab/part04/chunk_overlap.py
def split_long(text: str, max_chars: int, overlap: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    pieces, start = [], 0
    while start < len(text):
        pieces.append(text[start : start + max_chars])
        if start + max_chars >= len(text):
            break
        start += max_chars - overlap
    return pieces


if __name__ == "__main__":
    text = "一二三四五六七八九十ABCDEFGHIJ"
    print(len(text), "个字符")
    for piece in split_long(text, 8, 3):
        print(repr(piece))
    print("不重叠:", split_long(text, 8, 0))
    print("够短不切:", split_long("短句子", 8, 3))
```

<div class="line-notes">

- `def split_long(text: str, max_chars: int, overlap: int) -> list[str]:` 输入一段文字、每块最多多少字、相邻两块重叠多少字,输出切好的列表。
- `if len(text) <= max_chars:` 够短就不切,原样放进列表返回。我们真实数据里每一节都走这一条。
- `pieces, start = [], 0` 同时给两个变量赋值,相当于 JS 的 `let pieces = [], start = 0`。`start` 是下一刀从哪开始。
- `while start < len(text):` 还没切到末尾就继续(Day 19 的 while)。
- `pieces.append(text[start : start + max_chars])` 切片取 `[start, start+8)` 这一段。超出末尾不报错,有多少取多少,和 JS 的 `slice` 一样。
- `if start + max_chars >= len(text):` 这一块已经碰到末尾,停。不加这一行,还会多出一两块只有重叠部分的短尾巴。
- `start += max_chars - overlap` 下一刀往前走 `8 - 3 = 5` 个字,而不是 8 个,所以每块开头 3 个字和上一块结尾 3 个字相同。起点依次是 0、5、10、15。
- `text = "一二三四五六七八九十ABCDEFGHIJ"` 20 个字符,中英文各 10 个,方便数。
- `for piece in split_long(text, 8, 3):` 每块最多 8 个字,重叠 3 个。
- `print("不重叠:", split_long(text, 8, 0))` 对照组:`overlap=0` 就是一刀接一刀。
- `print("够短不切:", split_long("短句子", 8, 3))` 3 个字,不到 8,走第一个 `return`。

</div>

```bash
uv run python -m part04.chunk_overlap
```

真实输出:

```text
20 个字符
'一二三四五六七八'
'六七八九十ABC'
'ABCDEFGH'
'FGHIJ'
不重叠: ['一二三四五六七八', '九十ABCDEF', 'GHIJ']
够短不切: ['短句子']
```

看前两块:第一块以「六七八」结尾,第二块以「六七八」开头,这就是 3 个字的重叠。第二块和第三块共享「ABC」,第三块和第四块共享「FGH」。不重叠时只有 3 块,总字数正好 20;重叠时 4 块,总字数 8 + 8 + 8 + 5 = 29,多出来的 9 个字就是三处重叠。重叠是用存储和 token 换完整性。

重叠设多少?常见的起点是块长的 10% 到 20%,我们默认 `max_chars=300`、`overlap=50`。真实项目里还会让刀尽量落在句号、换行这些地方,而不是死板地数字符,那是 LangChain 的 `RecursiveCharacterTextSplitter` 这类工具做的事。我们的数据用不上,先知道有这回事。

## 故意踩坑:overlap 等于 max_chars

把 `start += max_chars - overlap` 这一行盯一会儿:如果 `overlap` 等于 `max_chars`,每次加 0,`start` 永远不动。新建 `part04/chunk_hang.py`:

```python
# agent-zero-lab/part04/chunk_hang.py
from part04.chunk_overlap import split_long

print("开始切")
print(split_long("一二三四五六七八九十ABCDEFGHIJ", 8, 8))
```

这个程序会一直跑下去,所以用 perl 的 `alarm` 给它定一个 3 秒的闹钟,到点把它杀掉(macOS 没有自带 `timeout` 命令,这是一个常见的替代写法)。`-u` 让 Python 不缓冲输出,被杀之前打的字也能看到:

```bash
perl -e 'alarm 3; exec @ARGV' uv run python -u -m part04.chunk_hang
echo "exit=$?"
```

真实输出:

```text
开始切
exit=142
```

打出「开始切」以后就再也没有动静,3 秒后被闹钟信号杀掉,退出码 142(128 + 14,14 是 SIGALRM 的编号)。如果没有闹钟,它会一直卡着,而且 `pieces` 列表每一轮都在追加同一段字,内存会越吃越多。没有任何报错信息,你只能看到终端停在那里。

这种「参数组合不合法」的情况,应该在函数一开头就挡住,而不是指望调用的人记得。正式版的 `split_long` 第一行会加上:

```python
    if not 0 <= overlap < max_chars:
        raise ValueError(f"overlap 必须在 0 和 max_chars 之间,现在是 {overlap}/{max_chars}")
```

`0 <= overlap < max_chars` 是 Python 的**链式比较**,等于 `0 <= overlap and overlap < max_chars`,JS 里不能这么写(`0 <= x < 8` 在 JS 里永远是 true,因为前半截先变成布尔值再和 8 比)。加上以后再用 8 和 8 调,得到的是一个清清楚楚的报错:

```text
ValueError: overlap 必须在 0 和 max_chars 之间,现在是 8/8
```

卡死变成报错,这就是 Day 223 坑清单里反复说的:能让它报错,就别让它安静地出问题。

## 拼起来:part04/chunking.py

零件都齐了。新建 `part04/chunking.py`,这是明天建索引要 import 的模块:

```python
# agent-zero-lab/part04/chunking.py
"""把 data/kb/ 的帮助中心文章切成块:按 ## 小节切,太长的小节再按长度切并重叠。"""
import re
from dataclasses import asdict, dataclass
from pathlib import Path

from part04.kb_check import read_meta

DATA = Path("data/kb")


@dataclass
class Chunk:
    id: str        # kb-002#3,引用时用
    doc_id: str    # kb-002
    title: str     # 文章标题
    category: str  # 分类,以后过滤用
    section: str   # 小节标题
    text: str      # 送去 embedding、拼进 prompt 的正文,开头带「标题 > 小节」


def parse_article(path: Path) -> tuple[dict[str, str], str]:
    raw = path.read_text(encoding="utf-8")
    body = raw.split("---", 2)[2].strip()
    return read_meta(raw), body


def split_long(text: str, max_chars: int, overlap: int) -> list[str]:
    if not 0 <= overlap < max_chars:
        raise ValueError(f"overlap 必须在 0 和 max_chars 之间,现在是 {overlap}/{max_chars}")
    if len(text) <= max_chars:
        return [text]
    pieces, start = [], 0
    while start < len(text):
        pieces.append(text[start : start + max_chars])
        if start + max_chars >= len(text):
            break
        start += max_chars - overlap
    return pieces


def chunk_article(path: Path, max_chars: int = 300, overlap: int = 50) -> list[Chunk]:
    meta, body = parse_article(path)
    parts = re.split(r"^## ", body, flags=re.M)
    chunks: list[Chunk] = []
    for part in parts[1:]:
        section, _, content = part.partition("\n")
        section = section.strip()
        for piece in split_long(content.strip(), max_chars, overlap):
            chunks.append(Chunk(
                id=f"{meta['id']}#{len(chunks) + 1}",
                doc_id=meta["id"],
                title=meta["title"],
                category=meta["category"],
                section=section,
                text=f"{meta['title']} > {section}\n{piece}",
            ))
    return chunks


def load_chunks(max_chars: int = 300, overlap: int = 50) -> list[Chunk]:
    out: list[Chunk] = []
    for path in sorted(DATA.glob("kb-*.md")):
        out.extend(chunk_article(path, max_chars, overlap))
    return out


if __name__ == "__main__":
    chunks = load_chunks()
    lengths = [len(c.text) for c in chunks]
    print(f"{len(chunks)} 块,最长 {max(lengths)} 字符,最短 {min(lengths)} 字符")
    for c in chunks[2:4]:
        print(asdict(c))
```

<div class="line-notes">

- `from dataclasses import asdict, dataclass` [Day 50](/blog/agent-zero/day-050-dataclass/) 学的。`@dataclass` 自动生成 `__init__`,`asdict` 把对象转成普通字典,方便打印和以后存 JSON。
- `from part04.kb_check import read_meta` Day 222 写的 frontmatter 解析,不重复写。
- `DATA = Path("data/kb")` 和 `make_kb.py` 的 `OUT` 是同一个目录,所以也要在根目录运行。
- `@dataclass` 下面这个类相当于 TS 里一个只有字段的 interface 加一个构造函数,`Chunk(id=..., doc_id=..., ...)` 就能建。
- `id: str        # kb-002#3` 块编号 = 文章编号 + `#` + 文章内第几块(从 1 开始)。回答里引用、日志里记录都用它。
- `doc_id: str    # kb-002` 所属文章。检索到一块以后想把整篇调出来看,靠它。
- `category: str  # 分类` 从 frontmatter 带过来,[Day 234](/blog/agent-zero/day-234-filter-pitfall/) 讲过滤时用。元数据跟着每一块走,不用回头去查文章。
- `text: str      # 送去 embedding` 唯一送去编码的字段,开头带前缀。
- `def parse_article(path: Path) -> tuple[dict[str, str], str]:` 一篇文件 → (元数据字典, 正文)。
- `body = raw.split("---", 2)[2].strip()` 正文。
- `return read_meta(raw), body` `kb-002.md` 返回 `({"id": "kb-002", "title": "退款政策", "category": "退款"}, "# 退款政策\n\n## 年付套餐\n……")`。frontmatter 有问题时 `read_meta` 会抛 `ValueError`,切块直接失败,不会带着坏数据往下走。
- `if not 0 <= overlap < max_chars:` 上一节加的那道闸。
- `def chunk_article(path: Path, max_chars: int = 300, overlap: int = 50) -> list[Chunk]:` 一篇 → 一组块。两个参数有默认值(Day 29),调用时不写就用 300 和 50。下面用 `kb-002.md` 逐行追踪。
- `meta, body = parse_article(path)` 拿到上面那份元数据和正文。
- `parts = re.split(r"^## ", body, flags=re.M)` 第一步,5 段。
- `for part in parts[1:]:` 跳过一级标题那段,循环 4 次。
- `section, _, content = part.partition("\n")` 第一轮 `section="年付套餐"`。
- `section = section.strip()` 防止标题后面有多余空格。手写的 Markdown 里 `## 年付套餐 ` 末尾带个空格很常见,肉眼看不出来。
- `for piece in split_long(content.strip(), max_chars, overlap):` 第三步。我们的数据每节都不到 300 字,所以每次只循环一轮,`piece` 就是整节正文。
- `id=f"{meta['id']}#{len(chunks) + 1}",` 用「已经有几块」加 1 当序号,不需要单独的计数器。第一块时 `chunks` 是空的,得到 `kb-002#1`;四块依次是 `#1` 到 `#4`。
- `section=section,` → `"年付套餐"`。
- `text=f"{meta['title']} > {section}\n{piece}",` 第二步的前缀:`"退款政策 > 年付套餐\n年付套餐(专业版……"`。实测 kb-002 四块的 `text` 长度是 133、52、50、74。
- `return chunks` kb-002 返回 4 个 `Chunk`。
- `def load_chunks(max_chars: int = 300, overlap: int = 50) -> list[Chunk]:` 全部文章 → 全部块,明天 `build_index` 就调它。
- `for path in sorted(DATA.glob("kb-*.md")):` `sorted` 保证每次块的顺序一样。不排序的话,顺序取决于文件系统(Day 222 的 `grep -r` 就是乱序),索引里第 i 行是哪一块每次都可能不同,评测结果也跟着变。
- `out.extend(chunk_article(path, max_chars, overlap))` `extend` 把一篇的块逐个追加,相当于 JS 的 `out.push(...chunks)`。写成 `append` 会变成列表套列表。
- `lengths = [len(c.text) for c in chunks]` 每块的字符数(含前缀)。
- `print(f"{len(chunks)} 块,最长 {max(lengths)} 字符` 实测 42 块,最长 199(kb-001#1),最短 38(kb-005#1)。
- `for c in chunks[2:4]:` 第 3、4 块,正好是 kb-002 的前两块。
- `print(asdict(c))` 每块打印成一个字典。

</div>

```bash
uv run python -m part04.chunking
```

真实输出:

```text
42 块,最长 199 字符,最短 38 字符
{'id': 'kb-002#1', 'doc_id': 'kb-002', 'title': '退款政策', 'category': '退款', 'section': '年付套餐', 'text': '退款政策 > 年付套餐\n年付套餐(专业版和企业版)中途取消的,按剩余的整月数比例退款。已经使用的月份和当前所在的月份不退。\n例如年付专业版 468 元,折合每月 39 元。在第 3 个月中途取消,前 2 个月加当月共 3 个月不退,退剩余 9 个月,即 351 元。'}
{'id': 'kb-002#2', 'doc_id': 'kb-002', 'title': '退款政策', 'category': '退款', 'section': '月付套餐', 'text': '退款政策 > 月付套餐\n月付套餐不支持中途退款。取消订阅后,当期结束时停止服务,不再续费,当期费用不退。'}
```

42 块,和 Day 222 检查脚本数出来的 42 个小节一致。kb-002#1 这一块很能说明「一块讲完一件事」:年付怎么退、当月退不退、一个算好的例子,全在一块里。

零件和大代码的对应关系:

| 零件(今天的小脚本) | 在 `chunking.py` 的哪一段 |
| --- | --- |
| `chunk_sections.py` 的 `re.split(..., flags=re.M)` | `chunk_article` 的 `parts = ...` 那一行 |
| `chunk_prefix.py` 的 `partition` 和前缀 | `chunk_article` 的循环体和 `text=f"..."` |
| `chunk_overlap.py` 的 `split_long` | `split_long`,外加第一行的参数检查 |
| `chunk_hang.py` 的教训 | `if not 0 <= overlap < max_chars` |
| Day 222 的 `read_meta` | `parse_article` |

## 块切多大

这个问题没有标准答案,只有几条经验。太小(比如 50 字)会把一条规则和它的例外切开;太大(比如 2000 字)又回到了稀释和浪费。中文客服文档 300 到 800 字一块是常见的起点。

我们的文章很短,所有小节都不到 300 字,所以实际效果就是「一个小节一块」。练习 1 会把 `max_chars` 调到 100 和 60,看块数从 42 涨到 45、63,以及块被切成了什么样子。

最终怎么定,要靠评估集。第四部分后面会换几组 `max_chars`,看检索的 recall 哪组最高。现在记住一件事:**块大小是一个要测的参数,不是拍脑袋的常数**,所以我们把它做成了 `load_chunks` 的参数,而不是写死在函数里。

## 动手练习

**练习 1:把块切小一点。** 分别用 `(300, 50)`、`(100, 20)`、`(60, 15)` 三组参数调用 `load_chunks`,打印块数;再把 `(100, 20)` 下 kb-001「三种套餐」切出的每一块打出来,找到重叠的部分。

<details><summary>参考答案</summary>

新建 `part04/ex_chunk_size.py`:

```python
# agent-zero-lab/part04/ex_chunk_size.py
from part04.chunking import load_chunks

for max_chars, overlap in [(300, 50), (100, 20), (60, 15)]:
    chunks = load_chunks(max_chars, overlap)
    print(f"max_chars={max_chars:<3} overlap={overlap:<2} → {len(chunks)} 块")

for c in load_chunks(100, 20):
    if c.doc_id == "kb-001" and c.section == "三种套餐":
        print(c.id, repr(c.text[:40]), "…", repr(c.text[-20:]))
```

<div class="line-notes">

- `for max_chars, overlap in [(300, 50), (100, 20), (60, 15)]:` 三组参数,循环时直接解包。重叠都取块长的 15% 到 25%。
- `chunks = load_chunks(max_chars, overlap)` 每组重新切一遍。
- `print(f"max_chars={max_chars:<3}` 打印块数。
- `for c in load_chunks(100, 20):` 再切一次 100/20,找 kb-001 的「三种套餐」。
- `print(c.id, repr(c.text[:40]), "…", repr(c.text[-20:]))` 每块的开头 40 个字符和结尾 20 个字符,刚好能看到重叠。

</div>

```bash
uv run python -m part04.ex_chunk_size
```

真实输出:

```text
max_chars=300 overlap=50 → 42 块
max_chars=100 overlap=20 → 45 块
max_chars=60  overlap=15 → 63 块
kb-001#1 '套餐与价格 > 三种套餐\nCloudLedger 提供免费版、专业版和企业版三种' … '468 元(相当于每月 39 元)。最多'
kb-001#2 '套餐与价格 > 三种套餐\n468 元(相当于每月 39 元)。最多 5 个账本,' … '都不限,包含开放 API、专属客服和增值'
kb-001#3 '套餐与价格 > 三种套餐\n都不限,包含开放 API、专属客服和增值税专用发票。' … '开放 API、专属客服和增值税专用发票。'
```

100 字时只多了 3 块,说明只有少数几节超过 100 字;60 字时多了 21 块。看 kb-001 的三块:第 1 块结尾的「468 元(相当于每月 39 元)。最多」正是第 2 块正文的开头,这就是 20 个字的重叠;第 2、3 块共享「都不限,包含开放 API、专属客服和增值」。每块开头都重复了前缀「套餐与价格 > 三种套餐」,因为前缀是在 `split_long` 切完之后才拼上去的,每一片都带。

也能看到固定长度切的毛病:第 1 块结尾停在「最多」,后面的「5 个账本」到了第 2 块。好在有重叠,「最多 5 个账本」在第 2 块里是完整的。对我们这份数据,`(300, 50)` 最合适。

</details>

**练习 2:42 块里排名次,前缀到底有多大用?** 把 42 块分别用「带前缀」和「不带前缀」(去掉 `text` 的第一行)两种写法编码,问三个问题,看正确那一块各排第几:「重复扣款多久能退回来」应为 kb-002#3,「E2017 怎么办」应为 kb-012#2,「E1042 怎么解决」应为 kb-010#2。

<details><summary>参考答案</summary>

新建 `part04/ex_chunk_search.py`:

```python
# agent-zero-lab/part04/ex_chunk_search.py
import numpy as np

from common.embed import embed, embed_one, usage
from part04.chunking import load_chunks

QUESTIONS = [
    ("重复扣款多久能退回来", "kb-002#3"),
    ("E2017 怎么办", "kb-012#2"),
    ("E1042 怎么解决", "kb-010#2"),
]

chunks = load_chunks()
ids = [c.id for c in chunks]
with_prefix = embed([c.text for c in chunks])
without = embed([c.text.split("\n", 1)[1] for c in chunks])
print(f"{len(chunks)} 块 × 2 种写法,{usage['requests']} 次请求 {usage['tokens']} token")

for question, expected in QUESTIONS:
    q = embed_one(question)
    for name, vecs in [("带前缀", with_prefix), ("不带  ", without)]:
        scores = vecs @ q
        order = [ids[i] for i in np.argsort(-scores)]
        rank = order.index(expected) + 1
        print(f"{question:<12} {name} 第{rank}名 {scores[ids.index(expected)]:.3f}  top1={order[0]}")
```

<div class="line-notes">

- `QUESTIONS = [` 三道题,答案是块编号,不再是文章编号。
- `chunks = load_chunks()` 默认参数,42 块。
- `with_prefix = embed([c.text for c in chunks])` 带前缀的写法,42 条分 5 批。
- `without = embed([c.text.split("\n", 1)[1] for c in chunks])` `split("\n", 1)` 只切第一个换行,`[1]` 是前缀之后的正文。
- `print(f"{len(chunks)} 块 × 2 种写法` 实测 10 次请求、3978 个 token(两种写法各 5 批)。
- `for name, vecs in [("带前缀", with_prefix), ("不带  ", without)]:` 同一个问题在两套向量上各排一次。
- `order = [ids[i] for i in np.argsort(-scores)]` 从高到低的块编号列表。
- `rank = order.index(expected) + 1` 正确那块排第几。
- `top1={order[0]}` 第一名是谁,用来判断排错时被谁抢了。

</div>

```bash
uv run python -m part04.ex_chunk_search
```

真实输出:

```text
42 块 × 2 种写法,10 次请求 3978 token
重复扣款多久能退回来   带前缀 第1名 0.821  top1=kb-002#3
重复扣款多久能退回来   不带   第1名 0.830  top1=kb-002#3
E2017 怎么办    带前缀 第1名 0.571  top1=kb-012#2
E2017 怎么办    不带   第4名 0.502  top1=kb-012#1
E1042 怎么解决   带前缀 第2名 0.622  top1=kb-010#1
E1042 怎么解决   不带   第8名 0.489  top1=kb-010#1
```

三件事。第一,「重复扣款」昨天整篇编码时排第二,今天切块后两种写法都是第一,0.82 左右,切块本身就解决了稀释。第二,前缀不是每次都加分:这道题不带前缀反而高 0.009,因为「重复扣款」这一节的正文自己就把话题说清楚了,前缀「退款政策」对它没帮上忙。第三,前缀真正救命的是正文里不提主题的块:「E2017 怎么办」不带前缀掉到第 4,「E1042 怎么解决」掉到第 8,带上前缀分别回到第 1 和第 2。E1042 那道带前缀时排第一的是同一篇的「原因」那一块,也是对的文章,问「怎么解决」时把原因一起给模型反而更好。

所以前缀是一个「大多数时候不亏、关键时候救命」的做法,我们保留它。

</details>

**练习 3(观察题):块编号稳定吗?** 复制一份 kb-002 到临时目录,在「月付套餐」和「重复扣款」之间插入一个新小节「退到哪里」,分别切块,对比同一个块编号在改前改后指的是哪一节。想一想这会给以后的「增量更新」和「日志里记下的引用」带来什么麻烦。

<details><summary>参考答案</summary>

新建 `part04/ex_chunk_ids.py`:

```python
# agent-zero-lab/part04/ex_chunk_ids.py
from pathlib import Path

from part04.chunking import chunk_article

src = Path("data/kb/kb-002.md")
tmp = Path("part04/tmp_kb/kb-002.md")
tmp.parent.mkdir(exist_ok=True)

new_section = "## 退到哪里\n退款一律原路退回,不支持退到其他账户。\n\n## 重复扣款"
tmp.write_text(src.read_text(encoding="utf-8").replace("## 重复扣款", new_section), encoding="utf-8")

before = {c.id: c.section for c in chunk_article(src)}
after = {c.id: c.section for c in chunk_article(tmp)}
for chunk_id in sorted(before.keys() | after.keys()):
    print(f"{chunk_id}  改前 {before.get(chunk_id, '—'):<6} 改后 {after.get(chunk_id, '—')}")
```

<div class="line-notes">

- `tmp = Path("part04/tmp_kb/kb-002.md")` 改的是副本,不碰 `data/kb/`。`data/kb/` 只由 `make_kb.py` 生成(Day 222 的规矩)。
- `new_section = "## 退到哪里\n退款一律原路退回` 新小节,后面接回原来的 `## 重复扣款`。
- `.replace("## 重复扣款", new_section)` 在「重复扣款」前面插进去。
- `before = {c.id: c.section for c in chunk_article(src)}` 字典推导式(Day 26):块编号 → 小节标题。
- `for chunk_id in sorted(before.keys() | after.keys()):` 两个字典的键取并集(Day 25 的集合运算,`dict.keys()` 支持 `|`),改前改后出现过的编号都列出来。
- `before.get(chunk_id, '—')` 没有这个编号就显示一个破折号。

</div>

```bash
uv run python -m part04.ex_chunk_ids
rm -r part04/tmp_kb
```

真实输出:

```text
kb-002#1  改前 年付套餐   改后 年付套餐
kb-002#2  改前 月付套餐   改后 月付套餐
kb-002#3  改前 重复扣款   改后 退到哪里
kb-002#4  改前 审批与到账  改后 重复扣款
kb-002#5  改前 —      改后 审批与到账
```

插一节,后面所有块的编号都往后挪了一位。`kb-002#3` 改前是「重复扣款」,改后变成「退到哪里」。麻烦有两个:日志里一周前记下的「这次回答引用了 kb-002#3」,现在点过去看到的是另一段内容;增量更新时如果按编号判断「哪块变了」,会以为 #3、#4 都变了、#5 是新的,其实只是插了一块。

修法有几种:编号里用小节标题代替序号(`kb-002#重复扣款`,但标题也可能改);或者给每块算内容指纹,按指纹判断变没变,编号只用来展示。[Day 231](/blog/agent-zero/day-231-pgvector-2/) 做增量更新时用的就是指纹。今天先知道序号编号是会漂的。

</details>

**练习 4:默写 `split_long`。** 合上文章写出带参数检查的 `split_long`,然后用 `("一二三四五六七八九十ABCDEFGHIJ", 8, 3)`、`(同上, 8, 0)`、`("短句子", 8, 3)`、`(同上, 8, 8)` 四组参数调用,和正文的输出对比。

<details><summary>参考答案</summary>

标准答案就是 `chunking.py` 里那个函数。前三组的输出应该和 `chunk_overlap.py` 那一节完全一样:4 块、3 块、1 块;第四组应该立刻报 `ValueError: overlap 必须在 0 和 max_chars 之间,现在是 8/8`,而不是卡住。最常见的默写错误有两个。一是把 `start += max_chars - overlap` 写成 `start += max_chars`,重叠就没了,第一组变成和第二组一样的 3 块。二是漏了 `if start + max_chars >= len(text): break`,这个错用 20 个字的例子看不出来(起点走到 20 时 `while` 自己就停了),换成 18 个字的 `"一二三四五六七八九十ABCDEFGH"` 才露馅:正确版本切出 3 块,最后一块 `'ABCDEFGH'` 已经到末尾;漏了 `break` 的版本起点再走到 15,多出一块 `'FGH'`,这三个字完全包含在上一块里,是一块纯重复的短尾巴。我两个版本都实跑过,所以练习时多加这第五组参数。

</details>

**验收标准:** `chunk_sections.py` 能复现「不加 re.M 只有 1 段」;`chunk_prefix.py` 量出前缀前后两个分数;`chunk_hang.py` 被闹钟杀掉(退出码 142),加了参数检查后变成 `ValueError`;`uv run python -m part04.chunking` 输出 42 块;能说出 `Chunk` 六个字段各自给谁用;能解释为什么块大小要做成参数。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 切块(chunking) | 把一篇文档切成若干小段,每段单独编码、单独检索 |
| 块(chunk) | 切出来的一段,检索的最小单位。今天的 `Chunk` 带编号、文章编号、标题、分类、小节和正文 |
| 固定长度切 | 每 N 个字切一刀,不管内容 |
| 按结构切 | 按文档本来的结构切,Markdown 按标题、代码按函数 |
| 语义切分 | 按相邻句子的 embedding 相似度,在话题跳变处切 |
| 重叠(overlap) | 相邻两块共享的字数,防止关键句被一刀切断 |
| 块前缀 | 拼在每块开头的「文章标题 > 小节标题」,让正文里不提主题的块也带着主题 |
| `re.split(pattern, s)` | 按正则匹配的位置切字符串,相当于 JS 的 `s.split(/.../)` |
| `re.M`(`re.MULTILINE`) | 多行模式,让 `^` 匹配每一行的开头,相当于 JS 正则的 `m` 标志 |
| 链式比较 | `0 <= x < n`,等于 `0 <= x and x < n`;JS 里不能这么写 |
| SIGALRM / 退出码 142 | 闹钟信号,进程被它杀掉时退出码是 128 + 14 = 142 |

## 常见误区

**忘了 `re.M`。** `re.split(r"^## ", body)` 不报错,返回只有一段的列表;放进 `chunk_article` 以后第 0 段被当成一级标题扔掉,每篇 0 块,`load_chunks()` 返回空列表。切完先数一下块数,和预期(42)对一对。

**以为块越小越准。** 小到把一条规则和它的例外切开,模型拿到半条规则就开始回答。练习 1 里 60 字一块时,「最多 5 个账本」被切成了两半。一块要讲完一件事。

**切完只剩正文,丢了标题。** kb-012「解决办法」不带前缀时和「E2017 怎么办」只有 0.502,在 42 块里排第 4;带上前缀 0.571,排第 1。小节标题重复(「原因」「解决办法」)的文档尤其要拼前缀。

**overlap 设成和 max_chars 一样大。** `start` 永远加 0,程序卡死不报错,内存还在涨。函数开头用 `if not 0 <= overlap < max_chars` 挡住。

**`glob` 不排序。** 块的顺序跟着文件系统走,每次可能不同,索引行号和块对不上,评测结果也会变。`sorted(DATA.glob(...))`。

**把块大小写死在函数里。** 300 只是起点,后面要用评估集比几组参数。做成 `load_chunks(max_chars, overlap)` 的参数,调参时只改调用处。

**以为块编号是永久的。** 序号编号在文章插入新小节后会整体后移(练习 3),日志里的旧引用会指错。判断「变没变」要靠内容指纹。

## 学习资料

### 文档与文章

- [宝玉 · 文本分割的五个层次(译)](https://baoyu.io/translations/rag/5-levels-of-text-splitting):Greg Kamradt 那个视频的中文文字版,不想看一小时英文视频就读这篇。
- [Pinecone · Chunking Strategies for LLM Applications](https://www.pinecone.io/learn/chunking-strategies/):把固定长度、按结构、语义几种切法和怎么选讲得很完整,今天读全文。
- [Chroma Research · Evaluating Chunking Strategies for Retrieval](https://research.trychroma.com/evaluating-chunking):Chroma 用同一套评估比较了各种切块方法,结论是简单的切法配合合适的参数往往不输复杂的。看结论部分和那张结果表。
- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):今天的块前缀是它的零成本简化版。读讲「chunks 缺上下文」的那个例子,Day 241 再细读。
- [LangChain · Markdown 标题切分器](https://docs.langchain.com/oss/python/integrations/splitters/markdown_header_metadata_splitter):框架里按 Markdown 标题切、并把标题存进元数据的现成实现,对照我们的 `chunk_article` 看它多做了什么。
- [Python 文档 · re](https://docs.python.org/zh-cn/3.12/library/re.html):查 `re.split` 和 `re.MULTILINE` 两个条目,中文版。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dr421x7Su&autoplay=0&high_quality=1" title="一站帮你选择RAG中的文本切分策略" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>果粒奶优有果粒 · 一站帮你选择RAG中的文本切分策略 · 27 分钟。从固定长度到按结构、语义切分逐个讲,带代码演示。看完对照今天的「三种常见切法」一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14GWizWEsT&autoplay=0&high_quality=1" title="【RAG成败,始于分块】从“无脑”切分到“智能”切割!手把手教你文本分块策略" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大模型教程K · 【RAG成败,始于分块】从“无脑”切分到“智能”切割 · 23 分钟。讲重叠为什么有用、块太大太小各会怎样,和今天的 `split_long` 对应。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/8OJC21T2SL4" title="The 5 Levels Of Text Splitting For Retrieval" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Greg Kamradt · The 5 Levels Of Text Splitting For Retrieval · 英文,约一小时。从按字数切一直讲到让 Agent 切,讲切块被引用最多的一个视频。今天看前两个 level(固定长度、递归切分)和第三个 level 开头讲按文档结构切的部分。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ZTOtxiWb2bE" title="Chunking Strategies Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Redis · Chunking Strategies Explained · 英文。用图把几种切法和重叠讲一遍,适合看完长视频后快速回顾。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)。第 6 章「RAG and Agents」里讲 chunking strategy 的那一小节,接着 Day 223 读到的地方往下读。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024),中文版《图解大模型:生成式AI原理与实践》(人民邮电出版社,2025)。第 8 章讲语义搜索和 RAG,里面有长文本怎么切块的图示。

### 开源项目与代码

- [FullStackRetrieval-com/RetrievalTutorials](https://github.com/FullStackRetrieval-com/RetrievalTutorials):Greg Kamradt 那个视频配套的代码仓库,5 种切法每种都有可跑的笔记本。
- [datawhalechina/all-in-rag](https://github.com/datawhalechina/all-in-rag):中文 RAG 教程,看它讲文本分块的那一章,对比它用的框架切分器和我们手写的版本。

## 自测

**1. 切块的三个理由是什么?各举一个本周实测的数字。**

<details><summary>答案</summary>

一是模型有最大输入长度:bge-m3 每条 8192 token,Day 217 超了直接 400。二是稀释:kb-002 整篇和「重复扣款多久能退回来」0.722,被 kb-004 抢了第一;切块后「重复扣款」那一块 0.82,排第一。三是整篇塞给大模型浪费又干扰:这道题只需要 50 字的那一块,整篇 353 字里另外 300 字是白花的 token,还可能让模型错用年付规则。

</details>

**2. `re.split(r"^## ", body)` 和加了 `flags=re.M` 有什么区别?忘了加会怎样?**

<details><summary>答案</summary>

不加时 `^` 只匹配整段文字的开头,`body` 以 `# 退款政策` 开头,一个匹配都没有,返回只有一个元素的列表(原文);加了 `re.M` 以后 `^` 匹配每一行的开头,kb-002 切出 5 段。忘了加不报错,在我们的 `chunk_article` 里第 0 段会被当成一级标题扔掉,结果每篇 0 块,`load_chunks()` 返回空列表,只能靠检查块数发现。

</details>

**3. 为什么要给每块拼上「文章标题 > 小节标题」?什么情况下它几乎没用?**

<details><summary>答案</summary>

切开以后,有的块正文里不提主题,比如 kb-012「解决办法」一节没提 E2017,不带前缀时它的向量里没有 E2017 的信息,和「E2017 怎么办」只有 0.502,在 42 块里排第 4;带上前缀 0.571,排第 1。如果小节正文自己就把话题说清楚了(比如「重复扣款」那一节),前缀几乎没用,练习 2 里不带前缀还高了 0.009。它是一个不太亏、关键时候救命的做法。

</details>

**4. `split_long("一二三四五六七八九十ABCDEFGHIJ", 8, 3)` 返回什么?起点依次是多少?为什么 `overlap` 不能等于 `max_chars`?**

<details><summary>答案</summary>

返回 `['一二三四五六七八', '六七八九十ABC', 'ABCDEFGH', 'FGHIJ']`,起点依次是 0、5、10、15(每次前进 8 − 3 = 5)。`overlap` 等于 `max_chars` 时每次前进 0,`start` 永远不动,`while` 死循环,程序卡住不报错,`pieces` 还在不停追加。所以函数开头要用 `if not 0 <= overlap < max_chars: raise ValueError(...)` 挡住。

</details>

**5. 面试题:「你们 RAG 的切块策略是什么?块大小怎么定的?」**

<details><summary>答案</summary>

先说文档类型决定切法:帮助中心是结构清楚的 Markdown,按二级标题切,一个小节一块,每块带上「文章标题 > 小节标题」前缀和文章编号、分类等元数据;超长的小节在内部按固定长度再切,留 15% 左右的重叠。没有结构的文本(聊天记录、OCR)才直接固定长度加重叠,代码按函数切。

再说块大小不是拍脑袋的:先按经验取一个起点(中文客服文档 300 到 800 字),然后在检索评估集上换几组 `max_chars`/`overlap` 比 recall 和 top-k 命中,选最好的一组,换文档类型或 embedding 模型时重测。最后补两个踩过的坑:块编号用序号会在插入小节后整体漂移,增量更新要按内容指纹判断;切完要检查块数和最长最短块的长度,`re.M` 漏了这种错误是不报错的。

</details>

## 明天预告

明天是 [Day 225 · 建索引:向量存成 numpy 文件](/blog/agent-zero/day-225-numpy-index/)。今天的 `load_chunks()` 给出了 42 个 `Chunk`,明天把它们的 `text` 编码成 `(42, 1024)` 的数组存进 `.npy`,其余字段存进 JSON,加上模型名,就是 Day 221 玩具索引线的正式版。
