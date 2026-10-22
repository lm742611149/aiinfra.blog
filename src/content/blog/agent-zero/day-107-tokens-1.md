---
title: 'Day 107 · Token(一):模型看到的不是字'
description: '模型不认识汉字和字母,只认识编号。今天从「文字在电脑里是几个字节」讲起,用 40 行纯 Python 亲手训练一个迷你 BPE 分词器,再打开 DeepSeek 真实的 12.8 万词表看一眼。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'tokenizer', 'python', 'agent-zero']
series: 'agent-zero'
day: 107
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 106](/blog/agent-zero/day-106-next-token/) 讲了大模型唯一会做的事:给它一串 token,它算出「下一个 token 是词表里每一项的概率」,挑一个接到末尾,再算下一个,这叫自回归生成。那节课里「token」这个词出现了几十次,但一直没说清它到底是什么,我们只是先把它当成「一小块文字」用着。

今天就把这块补上。你会发现,模型其实连「一小块文字」都看不到,它看到的只是一串整数。文字是怎么变成整数的,决定了后面很多事情:为什么 API 按 token 收钱,为什么模型抄长订单号会抄错一位,为什么它数不清 strawberry 里有几个 r。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚 tokenizer(分词器)干的两件事:把文字切成小块,再把每一块换成一个编号;并能说出「按字切」「按词切」各自的毛病。
2. 用自己写的 40 行 Python,在一小份工单语料上跑出 BPE 的合并过程,解释「发」和「票」为什么会被合成一个 token。
3. 用学到的合并规则去切一句训练时没见过的话,说出为什么 BPE 永远不会遇到「不认识的字」。
4. 下载 DeepSeek 官方的分词器文件,用 Day 39 学的 `json` 读出它的词表大小和最早的几条合并规则。

预计用时:2 到 2.5 小时(视频另算 30 分钟)。前置:[Day 16](/blog/agent-zero/day-016-strings-2/) 的字符串和编码、[Day 24](/blog/agent-zero/day-024-dicts/) 的字典、[Day 39](/blog/agent-zero/day-039-json/) 的 JSON、[Day 106](/blog/agent-zero/day-106-next-token/) 的自回归生成。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `toy_bpe.py` 的 `count_pairs` 和 `merge` 两个函数默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 模型只认数字

先从你熟悉的地方讲起。前端里你一定写过这种代码:后端返回的数据里,状态字段是 `1`、`2`、`3`,前端拿一个 `Map` 把它翻译成「待支付」「已支付」「已退款」显示出来。数据库和接口里存数字,给人看的时候才换成文字。

大模型也是这么干的,只不过方向反过来,而且表大得多。模型本体是一大堆矩阵运算,矩阵只能吃数字,不能吃字符串。所以在文字进模型之前,必须先有一个程序把文字切成一小块一小块,再查一张表,把每一块换成一个整数编号。这个程序叫 **tokenizer(分词器)**,切出来的每一小块叫 **token**,那张「小块 → 编号」的表叫 **词表(vocabulary)**。模型输出的时候也是先吐出编号,再由分词器查表换回文字。

说白了,分词器就是一个特别大的 `Map<string, number>`,加上一套「怎么切」的规则。DeepSeek 现在用的分词器,词表里有 128,000 项,这个数字今天最后一节我们会亲手读出来。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="文字经过分词器变成编号,模型只处理编号,输出编号再由分词器换回文字">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink-faint)">你写的字符串</text>
<rect x="20" y="40" width="150" height="34" rx="4" fill="none" stroke="var(--rule)"/>
<text x="95" y="62" text-anchor="middle" fill="var(--ink)">我的发票被重复扣款了</text>
<line x1="170" y1="57" x2="200" y2="57" stroke="var(--ink-soft)"/>
<rect x="200" y="40" width="110" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="255" y="62" text-anchor="middle" fill="var(--ink)">分词器 切+查表</text>
<line x1="310" y1="57" x2="340" y2="57" stroke="var(--ink-soft)"/>
<rect x="340" y="40" width="280" height="34" rx="4" fill="none" stroke="var(--rule)"/>
<text x="480" y="62" text-anchor="middle" fill="var(--ink)">[3728, 38278, 1415, 16761, …]</text>
<line x1="480" y1="74" x2="480" y2="104" stroke="var(--ink-soft)"/>
<rect x="400" y="104" width="160" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="480" y="126" text-anchor="middle" fill="var(--ink)">模型 只见编号</text>
<line x1="400" y1="121" x2="310" y2="121" stroke="var(--ink-soft)"/>
<rect x="200" y="104" width="110" height="34" rx="4" fill="none" stroke="var(--rule)"/>
<text x="255" y="126" text-anchor="middle" fill="var(--ink)">下一个: 429</text>
<line x1="255" y1="138" x2="255" y2="168" stroke="var(--ink-soft)"/>
<rect x="200" y="168" width="110" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="255" y="190" text-anchor="middle" fill="var(--ink)">分词器 查回去</text>
<line x1="310" y1="185" x2="340" y2="185" stroke="var(--ink-soft)"/>
<text x="350" y="190" fill="var(--ink)">429 → 「了」</text>
<text x="20" y="126" fill="var(--ink-faint)">琥珀 = 分词器</text>
<text x="20" y="146" fill="var(--ink-faint)">蓝 = 模型</text>
</g>
</svg>
<figcaption>文字进出模型都要经过分词器。图里的编号是 DeepSeek 分词器对这句话的真实结果(明天 Day 108 会亲手跑出来),「了」的编号是 429。</figcaption>
</figure>

这里有个容易误会的地方:分词器不是模型的一部分,它是模型训练之前就单独「训」好的一个小程序,训完就定死了,之后模型的整个训练和使用过程中都不会再变。所以不同公司的模型,分词器各不相同,同一句话在 DeepSeek 和在 GPT 那里会被切成不一样的块数。这件事明天会用代码对比。

## 第一步:文字在电脑里是几个字节

要搞懂分词器怎么切,得先回到最底层:一个字在电脑里到底存成什么。[Day 16](/blog/agent-zero/day-016-strings-2/) 讲过编码,这里只用到一点:现在几乎所有文本都用 UTF-8 编码,一个英文字母占 1 个字节,一个常用汉字占 3 个字节,一个 emoji 占 4 个字节。字节就是 0 到 255 之间的一个整数。

在 `agent-zero-lab` 目录(Day 10 用 `uv init` 建的那个)下新建 `part02` 文件夹,第二部分的脚本都放这里:

```bash
cd agent-zero-lab
mkdir -p part02
```

然后新建 `part02/bytes_demo.py`:

```python
# agent-zero-lab/part02/bytes_demo.py
for ch in ["a", "Z", "7", " ", "é", "发", "票", "😀"]:
    b = ch.encode("utf-8")
    print(f"{ch!r:6} -> {len(b)} 个字节 -> {list(b)}")

text = "发票 INV"
print(len(text), "个字符,", len(text.encode("utf-8")), "个字节")
```

<div class="line-notes">

- `for ch in ["a", "Z", "7", " ", "é", "发", "票", "😀"]:` 挑了 8 个有代表性的字符:英文大小写、数字、空格、带重音的法语字母、两个汉字、一个 emoji。
- `b = ch.encode("utf-8")` 把字符串按 UTF-8 编码成 `bytes`(字节串)。相当于 JS 里的 `new TextEncoder().encode(ch)`,那边得到的是 `Uint8Array`。第一轮 `ch="a"`,`b` 是 `b'a'`。
- `print(f"{ch!r:6} -> {len(b)} 个字节 -> {list(b)}")` `{ch!r:6}` 里 `!r` 表示用 `repr()` 显示(带引号,空格也看得见),`:6` 表示占 6 格宽、对齐好看。`list(b)` 把字节串转成整数列表,每个数在 0 到 255 之间。实跑:`'a'` 是 `[97]`,`'发'` 是 `[229, 143, 145]`,`'😀'` 是 `[240, 159, 152, 128]`。
- `text = "发票 INV"` 两个汉字、一个空格、三个字母,一共 6 个字符。
- `print(len(text), "个字符,", len(text.encode("utf-8")), "个字节")` 同一段文字,字符数和字节数不一样:2 个汉字各 3 字节,加上 4 个 1 字节的字符,实跑是 `6 个字符, 10 个字节`。

</div>

```bash
uv run part02/bytes_demo.py
```

实跑输出:

```text
'a'    -> 1 个字节 -> [97]
'Z'    -> 1 个字节 -> [90]
'7'    -> 1 个字节 -> [55]
' '    -> 1 个字节 -> [32]
'é'    -> 2 个字节 -> [195, 169]
'发'    -> 3 个字节 -> [229, 143, 145]
'票'    -> 3 个字节 -> [231, 165, 168]
'😀'    -> 4 个字节 -> [240, 159, 152, 128]
6 个字符, 10 个字节
```

前端同学注意一个差别:在 JS 里 `"😀".length` 是 2,因为 JS 字符串内部用 UTF-16,emoji 要占两个「码元」;Python 的 `len("😀")` 是 1,它按字符数。我在 Node 里跑了一下 `"😀".length, "发".length, new TextEncoder().encode("发").length`,输出 `2 1 3`。这个差别在前后端对接「最多 500 字」这种校验时经常出 bug,今天顺手记住。

为什么要先讲字节?因为现在主流的分词器(DeepSeek、GPT、Llama 都是)最底层的起点就是这 256 个字节值。任何文字,不管是中文、阿拉伯文还是 emoji,最差的情况也能拆成字节,而字节只有 256 种,全在词表里。这一点是后面「BPE 不会遇到不认识的字」的根本原因。

## 为什么不按字切,也不按词切

有了字节,最笨的办法是一个字节一个 token。词表只要 256 项,非常小,但代价是序列太长:「我的发票被重复扣款了」10 个汉字就是 30 个字节,也就是 30 个 token。模型每生成一个 token 都要完整算一遍(Day 106 讲过),序列长 3 倍,生成就慢 3 倍,能塞进去的内容也少 3 倍。

反过来,按「词」切行不行?把每个词都放进词表。英文还好办,按空格切就有词;中文没有空格,得先做分词。更麻烦的是词太多了:英文光是 charge、charged、charging、charges 就是四个词,再加上人名、产品名、网络新词、拼写错误,词表永远收不全。遇到不在表里的词,只能标成一个「未知」符号,信息直接丢了。客服工单里满是 `INV-2026-004417` 这种编号,每个都是新词,按词切等于全变成「未知」。

所以实际用的是夹在中间的办法,叫 **子词(subword)**:常见的组合当一个整块,比如「发票」「 the」「ing」;不常见的拆成更小的块,最差拆到字节。这样词表大小可控(几万到十几万项),常用内容切得很省,生僻内容也一定能表示出来。怎么决定哪些组合算「常见」?最流行的方法就是下面要亲手写的 BPE。

## BPE:数一数谁和谁最常挨着

**BPE(Byte Pair Encoding,字节对编码)** 的想法简单到让人意外:

1. 先把所有文字拆成最小的单位;
2. 数一遍,看哪两个相邻的单位一起出现的次数最多;
3. 把这一对合并成一个新单位,加进词表,并把这条合并规则记下来;
4. 回到第 2 步,重复成千上万次,直到词表够大。

真实的分词器从字节开始拆,我们为了看得清楚,从单个汉字开始拆,道理完全一样。语料用 7 句云簿 CloudLedger 的工单片段(云簿是这门课一直用的虚构 SaaS 公司)。

新建 `part02/toy_bpe.py`:

```python
# agent-zero-lab/part02/toy_bpe.py
from collections import Counter

CORPUS = [
    "发票重复扣款", "发票没收到", "重复扣款了", "申请退款",
    "退款到账了吗", "发票抬头写错了", "又被重复扣款",
]


def count_pairs(words: list[list[str]]) -> Counter[tuple[str, str]]:
    pairs: Counter[tuple[str, str]] = Counter()
    for w in words:
        for a, b in zip(w, w[1:]):
            pairs[(a, b)] += 1
    return pairs


def merge(words: list[list[str]], pair: tuple[str, str]) -> list[list[str]]:
    a, b = pair
    result: list[list[str]] = []
    for w in words:
        new: list[str] = []
        i = 0
        while i < len(w):
            if i < len(w) - 1 and w[i] == a and w[i + 1] == b:
                new.append(a + b)
                i += 2
            else:
                new.append(w[i])
                i += 1
        result.append(new)
    return result


words = [list(s) for s in CORPUS]
print("开始:", words[0], "共", sum(len(w) for w in words), "个片段")

merges: list[tuple[str, str]] = []
for step in range(1, 7):
    pairs = count_pairs(words)
    best, n = pairs.most_common(1)[0]
    if n < 2:
        print("剩下的相邻组合都只出现 1 次,停。")
        break
    words = merge(words, best)
    merges.append(best)
    print(f"第 {step} 次: {best[0]}+{best[1]} 出现 {n} 次 -> 共 {sum(len(w) for w in words)} 个片段")

print("合并规则:", merges)
for w in words:
    print(" | ".join(w))
```

<div class="line-notes">

- `from collections import Counter` `Counter` 是标准库里专门用来计数的字典:没出现过的键默认是 0,可以直接 `+= 1`,不用先判断键在不在。JS 里你会写 `counts[k] = (counts[k] ?? 0) + 1`,`Counter` 把这一步省了。
- `CORPUS = [` 训练语料,7 句工单片段。「发票」出现 3 次,「重复扣款」出现 3 次,「退款」出现 2 次,这几个数字决定了下面的合并顺序。
- `def count_pairs(words: list[list[str]]) -> Counter[tuple[str, str]]:` 输入是「句子列表」,每句话是一个「片段列表」;输出是「相邻的一对 → 出现次数」。类型标注是 [Day 45](/blog/agent-zero/day-045-type-hints-1/) 学的写法,`tuple[str, str]` 表示两个字符串组成的元组。
- `pairs: Counter[tuple[str, str]] = Counter()` 新建一个空计数器。
- `for w in words:` 一句一句看。第一轮 `w` 是 `['发', '票', '重', '复', '扣', '款']`。
- `for a, b in zip(w, w[1:]):` `w[1:]` 是去掉第一个元素的列表,`zip` 把两个列表按位置配对,于是得到每一对相邻元素。第一句配出来是 `('发','票') ('票','重') ('重','复') ('复','扣') ('扣','款')`,5 对。JS 里没有内置 `zip`,你大概会写 `w.slice(0, -1).map((x, i) => [x, w[i + 1]])`。
- `pairs[(a, b)] += 1` 这一对的次数加 1。7 句话数完,`('发','票')` 是 3,`('重','复')` 是 3,`('退','款')` 是 2。
- `def merge(words: list[list[str]], pair: tuple[str, str]) -> list[list[str]]:` 把所有句子里出现的这一对相邻片段合成一个。
- `a, b = pair` 元组解包([Day 22](/blog/agent-zero/day-022-tuples-unpack/)),第一次调用时 `a="发"`,`b="票"`。
- `while i < len(w):` 用 `while` 而不是 `for`,因为合并时要一次跳过两个元素,下标要自己控制。
- `if i < len(w) - 1 and w[i] == a and w[i + 1] == b:` 先确认后面还有元素(防止越界),再看当前和下一个是不是要合并的那一对。
- `new.append(a + b)` 两个字符串拼起来,`"发" + "票"` 得到 `"发票"`,作为一个片段放进新列表。
- `i += 2` 合并了两个,下标跳两格。
- `new.append(w[i])` 不是那一对,原样搬过去,下标走一格。
- `words = [list(s) for s in CORPUS]` 列表推导式([Day 23](/blog/agent-zero/day-023-comprehensions/)),`list("发票重复扣款")` 把字符串拆成单字列表 `['发','票','重','复','扣','款']`。
- `print("开始:", words[0], "共", sum(len(w) for w in words), "个片段")` 7 句话一共多少个字。实跑是 39。
- `for step in range(1, 7):` 最多合并 6 次。真实分词器要合并十几万次,我们的语料太小,合并几次就没东西可合了。
- `best, n = pairs.most_common(1)[0]` `most_common(1)` 返回次数最多的前 1 项,形如 `[(('发','票'), 3)]`;`[0]` 取出这一项,再解包成 `best=('发','票')`、`n=3`。次数相同时,`Counter` 按第一次出现的先后排,所以 `('发','票')` 排在同样是 3 次的 `('重','复')` 前面。
- `if n < 2:` 最多的一对也只出现 1 次,合并它对压缩没有帮助,停下。实跑在第 6 轮停的。
- `words = merge(words, best)` 用新的切法替换旧的。
- `merges.append(best)` 记下这条合并规则。**分词器真正保存下来的就是这份有顺序的规则列表**,外加词表。
- `print(f"第 {step} 次:` 每轮打印合并了谁、出现几次、合并后总片段数。实跑:第 1 次 `发+票` 3 次,39 → 36;第 2 次 `重+复`,36 → 33;第 3 次 `重复+扣`,第 4 次 `重复扣+款`,第 5 次 `退+款` 2 次,25 个片段。
- `print("合并规则:", merges)` 实跑:`[('发', '票'), ('重', '复'), ('重复', '扣'), ('重复扣', '款'), ('退', '款')]`。
- `print(" | ".join(w))` 用竖线把每句的片段连起来,看最终怎么切的。`" | ".join` 相当于 JS 的 `w.join(" | ")`,只是 Python 把分隔符写在前面。

</div>

```bash
uv run part02/toy_bpe.py
```

实跑输出:

```text
开始: ['发', '票', '重', '复', '扣', '款'] 共 39 个片段
第 1 次: 发+票 出现 3 次 -> 共 36 个片段
第 2 次: 重+复 出现 3 次 -> 共 33 个片段
第 3 次: 重复+扣 出现 3 次 -> 共 30 个片段
第 4 次: 重复扣+款 出现 3 次 -> 共 27 个片段
第 5 次: 退+款 出现 2 次 -> 共 25 个片段
剩下的相邻组合都只出现 1 次,停。
合并规则: [('发', '票'), ('重', '复'), ('重复', '扣'), ('重复扣', '款'), ('退', '款')]
发票 | 重复扣款
发票 | 没 | 收 | 到
重复扣款 | 了
申 | 请 | 退款
退款 | 到 | 账 | 了 | 吗
发票 | 抬 | 头 | 写 | 错 | 了
又 | 被 | 重复扣款
```

看最后 7 行。只合并了 5 次,39 个片段就压到了 25 个,少了三分之一。「发票」「重复扣款」「退款」这些在语料里反复出现的组合变成了整块,「抬」「头」「写」「错」这些只出现一次的字还是单独的。这就是 BPE 的全部思想:**出现得多的组合,值得用一个 token 表示**。

第 3、4 次合并值得多看一眼。合并的不是两个单字,而是已经合好的「重复」再加「扣」,然后「重复扣」再加「款」。所以 token 可以越合越长,真实词表里有「是怎么回事」这种五个字的 token,也有 ` strawberry`(前面带空格)这种完整的英文单词。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="BPE 合并过程:从单字开始,每次把出现最多的相邻一对合成一个">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink-faint)">开始</text>
<g fill="none" stroke="var(--rule)">
<rect x="110" y="16" width="30" height="24" rx="3"/><rect x="144" y="16" width="30" height="24" rx="3"/><rect x="178" y="16" width="30" height="24" rx="3"/><rect x="212" y="16" width="30" height="24" rx="3"/><rect x="246" y="16" width="30" height="24" rx="3"/><rect x="280" y="16" width="30" height="24" rx="3"/>
</g>
<g fill="var(--ink)" text-anchor="middle">
<text x="125" y="33">发</text><text x="159" y="33">票</text><text x="193" y="33">重</text><text x="227" y="33">复</text><text x="261" y="33">扣</text><text x="295" y="33">款</text>
</g>
<text x="330" y="33" fill="var(--ink-soft)">6 个片段</text>
<text x="20" y="80" fill="var(--ink-faint)">第 1 次</text>
<rect x="110" y="66" width="64" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="142" y="83" text-anchor="middle" fill="var(--ink)">发票</text>
<g fill="none" stroke="var(--rule)"><rect x="178" y="66" width="30" height="24" rx="3"/><rect x="212" y="66" width="30" height="24" rx="3"/><rect x="246" y="66" width="30" height="24" rx="3"/><rect x="280" y="66" width="30" height="24" rx="3"/></g>
<g fill="var(--ink)" text-anchor="middle"><text x="193" y="83">重</text><text x="227" y="83">复</text><text x="261" y="83">扣</text><text x="295" y="83">款</text></g>
<text x="330" y="83" fill="var(--ink-soft)">发+票 在语料里出现 3 次</text>
<text x="20" y="130" fill="var(--ink-faint)">第 2 次</text>
<rect x="110" y="116" width="64" height="24" rx="3" fill="none" stroke="var(--rule)"/><text x="142" y="133" text-anchor="middle" fill="var(--ink)">发票</text>
<rect x="178" y="116" width="64" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="210" y="133" text-anchor="middle" fill="var(--ink)">重复</text>
<g fill="none" stroke="var(--rule)"><rect x="246" y="116" width="30" height="24" rx="3"/><rect x="280" y="116" width="30" height="24" rx="3"/></g>
<g fill="var(--ink)" text-anchor="middle"><text x="261" y="133">扣</text><text x="295" y="133">款</text></g>
<text x="330" y="133" fill="var(--ink-soft)">重+复 也是 3 次,排在后面</text>
<text x="20" y="180" fill="var(--ink-faint)">第 3–4 次</text>
<rect x="110" y="166" width="64" height="24" rx="3" fill="none" stroke="var(--rule)"/><text x="142" y="183" text-anchor="middle" fill="var(--ink)">发票</text>
<rect x="178" y="166" width="132" height="24" rx="3" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="244" y="183" text-anchor="middle" fill="var(--ink)">重复扣款</text>
<text x="330" y="183" fill="var(--ink-soft)">已合好的块还能继续合</text>
<text x="20" y="226" fill="var(--ink-faint)">保存下来的 = 有顺序的合并规则 + 词表。真实分词器从 256 个字节起步,合并十几万次。</text>
</g>
</svg>
<figcaption>toy_bpe.py 第一句话「发票重复扣款」的合并过程,数字来自实跑。琥珀色是这一步刚合并出来的块。</figcaption>
</figure>

## 用学到的规则去切新句子

训练只做一次。之后每次有新文字进来,分词器做的事是:先拆成最小单位,然后**按训练时的顺序**把合并规则一条条套上去。新建 `part02/toy_encode.py`,把上一步实跑得到的 5 条规则抄进来:

```python
# agent-zero-lab/part02/toy_encode.py
MERGES = [("发", "票"), ("重", "复"), ("重复", "扣"), ("重复扣", "款"), ("退", "款")]


def encode(text: str) -> list[str]:
    pieces = list(text)
    for a, b in MERGES:
        i = 0
        while i < len(pieces) - 1:
            if pieces[i] == a and pieces[i + 1] == b:
                pieces[i : i + 2] = [a + b]
            else:
                i += 1
    return pieces


vocab: dict[str, int] = {}
for text in ["发票重复扣款了两次", "退票", "我要退款"]:
    pieces = encode(text)
    ids = [vocab.setdefault(p, len(vocab)) for p in pieces]
    print(f"{text} -> {pieces} -> {ids}")

print("词表:", vocab)
```

<div class="line-notes">

- `MERGES = [` 直接把上一个脚本的输出抄过来。顺序很重要,先学到的规则先用。
- `pieces = list(text)` 先拆成单字。`"发票重复扣款了两次"` 变成 9 个单字。
- `for a, b in MERGES:` 规则一条一条来,每条规则把整句扫一遍。
- `while i < len(pieces) - 1:` 只要后面还有一个元素可以配对,就继续看。
- `pieces[i : i + 2] = [a + b]` 切片赋值:把第 i 和 i+1 两个元素整体替换成一个合并后的元素,列表长度少 1。相当于 JS 的 `pieces.splice(i, 2, a + b)`。替换完 `i` 不动,因为新元素可能和下一个元素又能配上(这条规则内部)。
- `i += 1` 没配上,往后走一格。
- `return pieces` 第一句实跑返回 `['发票', '重复扣款', '了', '两', '次']`,9 个字变 5 个 token。
- `vocab: dict[str, int] = {}` 编号表。真实分词器的词表在训练时就定死了,这里为了演示「换成编号」这一步,按第一次见到的先后现编号。
- `ids = [vocab.setdefault(p, len(vocab)) for p in pieces]` `setdefault(键, 默认值)` 的意思是:键已经在字典里就返回它的值;不在就先把「键 → 默认值」放进去,再返回默认值。默认值用 `len(vocab)`,第一个新片段拿到 0,第二个拿到 1,依次往后。
- `print(f"{text} -> {pieces} -> {ids}")` 实跑三行:<br>`发票重复扣款了两次 -> ['发票', '重复扣款', '了', '两', '次'] -> [0, 1, 2, 3, 4]`<br>`退票 -> ['退', '票'] -> [5, 6]`<br>`我要退款 -> ['我', '要', '退款'] -> [7, 8, 9]`
- `print("词表:", vocab)` 实跑:`{'发票': 0, '重复扣款': 1, '了': 2, '两': 3, '次': 4, '退': 5, '票': 6, '我': 7, '要': 8, '退款': 9}`。

</div>

```bash
uv run part02/toy_encode.py
```

输出在上面的 line-notes 里已经逐行贴了。看第二句「退票」:语料里从没出现过这个词,也没有「退+票」这条规则,于是它被切成「退」「票」两个单独的块。没有报错,也没有变成「未知」,只是切得碎一点、多花一个 token。「我」「要」「两」「次」这些语料里根本没出现过的字,同样以单字的形式保留下来。

我们的玩具从单字开始,如果遇到一个连单字都不在表里的生僻字,还是会出问题。真实分词器从 256 个字节开始,任何字最差拆成 3 到 4 个字节,而 256 个字节全在词表里,所以**真实的 BPE 分词器永远不会遇到不认识的输入**,代价只是生僻内容切得更碎、更费 token。明天你会看到「饕餮」两个字在 DeepSeek 那里要 4 个 token,而「发票」两个字只要 1 个。

## 看一眼真家伙:DeepSeek 的词表

玩具写完,打开一个真实的分词器看看。DeepSeek 在官方文档的 [Token 用量计算](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage) 页面提供了分词器文件下载(2026 年 10 月查到的链接,文件名是 `deepseek_v4_tokenizer.zip`,1.9 MB)。在 `agent-zero-lab` 目录下:

```bash
mkdir -p data
curl -L -o data/deepseek_v4_tokenizer.zip https://cdn.deepseek.com/api-docs/deepseek_v4_tokenizer.zip
unzip data/deepseek_v4_tokenizer.zip -d data/
ls data/deepseek_v4_tokenizer
```

`ls` 应该看到三个文件:`deepseek_tokenizer.py`、`tokenizer.json`、`tokenizer_config.json`。主角是 `tokenizer.json`,解压后 6.4 MB,本质就是一个大 JSON 文件,里面装着词表和合并规则。既然是 JSON,用 [Day 39](/blog/agent-zero/day-039-json/) 学的 `json` 模块就能读。

先故意犯一个错。如果你跳过了上面的下载步骤,直接跑下面的脚本,会看到:

```text
FileNotFoundError: [Errno 2] No such file or directory: 'data/deepseek_v4_tokenizer/tokenizer.json'
```

意思很直白:相对路径 `data/deepseek_v4_tokenizer/tokenizer.json` 下没有这个文件。要么是没下载解压,要么是你不在 `agent-zero-lab` 目录下运行([Day 37](/blog/agent-zero/day-037-pathlib/) 讲过,相对路径是相对「你在哪个目录运行」,不是相对脚本文件所在的目录)。先 `pwd` 看一眼自己在哪。

新建 `part02/peek_vocab.py`:

```python
# agent-zero-lab/part02/peek_vocab.py
import json
from pathlib import Path

path = Path("data/deepseek_v4_tokenizer/tokenizer.json")
data = json.loads(path.read_text(encoding="utf-8"))

model = data["model"]
vocab: dict[str, int] = model["vocab"]
merges = model["merges"]
print("算法:", model["type"])
print("词表大小:", len(vocab))
print("合并规则条数:", len(merges))
print("最早的 8 条合并:", merges[:8])
print("特殊 token 数:", len(data["added_tokens"]))
print("前 3 个特殊 token:", [t["content"] for t in data["added_tokens"][:3]])

for word in ["hello", "Ġhello", "Ġthe", "ing"]:
    print(f"{word!r} 的编号:", vocab.get(word))
```

<div class="line-notes">

- `path = Path("data/deepseek_v4_tokenizer/tokenizer.json")` 相对路径,所以要在 `agent-zero-lab` 目录下运行。
- `data = json.loads(path.read_text(encoding="utf-8"))` 先把整个文件读成字符串,再解析成 Python 字典。6.4 MB 的 JSON,这一步在我的 2019 款 Intel MacBook 上不到一秒。顶层键有 `version`、`truncation`、`padding`、`added_tokens`、`normalizer`、`pre_tokenizer`、`post_processor`、`decoder`、`model` 九个。
- `model = data["model"]` 词表和合并规则都在 `model` 这个键下面。
- `vocab: dict[str, int] = model["vocab"]` 词表就是一个「token 字符串 → 编号」的字典,和我们玩具里的 `vocab` 是同一种东西,只是大得多。
- `merges = model["merges"]` 合并规则列表,每条是一个字符串,两个片段用空格隔开。
- `print("算法:", model["type"])` 实跑是 `BPE`,和我们手写的是同一种算法。
- `print("词表大小:", len(vocab))` 实跑 `128000`,12.8 万项。
- `print("合并规则条数:", len(merges))` 实跑 `127741`。比词表少 259 条:起步的 256 个单字节不需要合并规则,另外 3 项是直接写进词表的特殊 token(句子开始、句子结束、填充)。256 + 127741 + 3 正好是 128000。
- `print("最早的 8 条合并:", merges[:8])` 实跑:`['Ġ t', 'Ġ a', 'i n', 'Ġ Ġ', 'h e', 'e r', 'o n', 'r e']`。`Ġ` 代表空格(下面正文解释)。最先学到的是「空格+t」「空格+a」「i+n」「h+e」,也就是英文里最常见的字母组合,和我们玩具里最先学到「发+票」是一个道理。
- `print("特殊 token 数:", len(data["added_tokens"]))` 实跑 `1283`。特殊 token 是人为加进去的标记,不是从语料里合并出来的。它们的编号一直排到 129279,所以模型实际认识的编号有 129,280 个,比 `vocab` 里的 128000 多出一截。
- `print("前 3 个特殊 token:"` 实跑:`['<｜begin▁of▁sentence｜>', '<｜end▁of▁sentence｜>', '<｜▁pad▁｜>']`。「句子结束」就是 Day 106 说的那个让生成停下来的结束 token。
- `print(f"{word!r} 的编号:", vocab.get(word))` `.get` 查不到时返回 `None` 而不是报错。实跑:`'hello'` 是 33310,`'Ġhello'`(前面带空格的 hello)是 44388,`'Ġthe'` 是 270,`'ing'` 是 288。

</div>

```bash
uv run part02/peek_vocab.py
```

实跑输出:

```text
算法: BPE
词表大小: 128000
合并规则条数: 127741
最早的 8 条合并: ['Ġ t', 'Ġ a', 'i n', 'Ġ Ġ', 'h e', 'e r', 'o n', 'r e']
特殊 token 数: 1283
前 3 个特殊 token: ['<｜begin▁of▁sentence｜>', '<｜end▁of▁sentence｜>', '<｜▁pad▁｜>']
'hello' 的编号: 33310
'Ġhello' 的编号: 44388
'Ġthe' 的编号: 270
'ing' 的编号: 288
```

这里有两个反直觉的地方。

第一,`hello` 和 ` hello`(前面带空格)是两个不同的 token,编号一个 33310、一个 44388。英文里单词前面通常有空格,分词器干脆把空格和后面的单词合成一块。`Ġ` 这个奇怪的字符就是空格在词表里的写法。为什么不直接写空格?因为词表要把 256 个字节都表示成「看得见的字符」才好存进 JSON,空格、换行这些看不见的字节就被映射成了 `Ġ`、`Ċ` 这类字符。

第二,你可能想查一下「发票」的编号,于是写 `vocab["发票"]`,结果是:

```text
KeyError: '发票'
```

不是没有这个 token,是它在词表里不长「发票」这个样子。汉字每个是 3 个字节,词表把这 6 个字节各自映射成一个可见字符存起来,「发票」在 JSON 里的样子是 `åıĳç¥¨`,看上去像乱码。它的编号是 38278,明天用正经的分词器库一跑就能看到。动手练习第 4 题会带你写一个小函数,把 `åıĳç¥¨` 翻译回「发票」。

## 这件事对写 Agent 有什么影响

今天学的东西,做 Agent 时会在这几个地方碰到。

**计费和限额都按 token 算。** API 账单上的数字、上下文窗口的上限,单位都是 token,不是字数。同样 100 个字,内容不同 token 数可以差好几倍。明天就专门数这件事。

**长编号容易被抄错。** 订单号、发票号这种每个都不一样的字符串,训练语料里不可能反复出现,BPE 不会把它合成整块,只能切成很多小段。模型要逐段「猜」出来,哪一段猜错都会抄错一位。所以 Agent 里涉及编号的地方,尽量让工具把原文返回,不要让模型自己转述。

**字母级任务对模型很别扭。** 问「strawberry 里有几个 r」,模型看到的可能是 ` strawberry` 一整块(前面有空格时),或者 `st`、`raw`、`berry` 三块(没有空格时,DeepSeek 分词器实际就是这么切的,明天的脚本里能看到)。不管哪种,它都看不到一个个字母,只能靠「记忆」去答。这类任务应该交给代码。

**不同模型,不同分词器。** 词表是各家自己训的。DeepSeek 用大量中文语料训,「发票」「是怎么回事」都是整块;早期 GPT-4 的分词器中文语料少,很多汉字连一个整块都没有,要拆成字节。同一段中文在两家的 token 数能差将近一倍,这直接就是钱。

## 动手练习

**练习 1:emoji 有多长。** 在 `bytes_demo.py` 的列表里加上 `"👍🏻"`(带肤色的点赞)和 `"龘"`,先猜它们各是几个字符、几个字节,再跑。然后在浏览器 DevTools 控制台里跑 `"👍🏻".length`,对比 Python 的 `len`。

<details><summary>参考答案</summary>

新建 `part02/bytes_emoji.py`:

```python
# agent-zero-lab/part02/bytes_emoji.py
for ch in ["👍🏻", "龘"]:
    b = ch.encode("utf-8")
    print(f"{ch!r}: {len(ch)} 个字符, {len(b)} 个字节")
```

<div class="line-notes">

- `for ch in ["👍🏻", "龘"]:` 带肤色的 emoji 其实是两个字符拼起来显示的:一个点赞,一个肤色修饰符。
- `print(f"{ch!r}: {len(ch)} 个字符, {len(b)} 个字节")` 实跑:`'👍🏻': 2 个字符, 8 个字节`,`'龘': 1 个字符, 3 个字节`。

</div>

```bash
uv run part02/bytes_emoji.py
```

```text
'👍🏻': 2 个字符, 8 个字节
'龘': 1 个字符, 3 个字节
```

带肤色的点赞在屏幕上看是一个图案,Python 算 2 个字符,UTF-8 下是 8 个字节(两个 4 字节的字符)。在 JS 里 `"👍🏻".length` 是 4,因为每个 4 字节的字符在 UTF-16 里要两个码元。同一个图案,屏幕上 1 个、Python 说 2 个、JS 说 4 个、字节有 8 个,分词器从这 8 个字节出发去切。

</details>

**练习 2:多喂几句语料。** 在 `toy_bpe.py` 的 `CORPUS` 里加三句 `"退款失败", "退款多久到账", "退款到账了"`,另存为 `part02/toy_bpe_more.py`,先猜第一条合并规则会变成什么,再跑。

<details><summary>参考答案</summary>

只改 `CORPUS` 那一处,其余和 `toy_bpe.py` 完全一样:

```python
# agent-zero-lab/part02/toy_bpe_more.py(只列出改动的部分)
CORPUS = [
    "发票重复扣款", "发票没收到", "重复扣款了", "申请退款",
    "退款到账了吗", "发票抬头写错了", "又被重复扣款", "退款失败", "退款多久到账", "退款到账了"
]
```

<div class="line-notes">

- `"退款到账了吗", "发票抬头写错了", "又被重复扣款", "退款失败", "退款多久到账", "退款到账了"` 新加的三句里有三个「退款」、两个「到账」。加上原来的,「退款」一共 5 次,「到账」3 次。

</div>

```bash
uv run part02/toy_bpe_more.py
```

```text
开始: ['发', '票', '重', '复', '扣', '款'] 共 54 个片段
第 1 次: 退+款 出现 5 次 -> 共 49 个片段
第 2 次: 发+票 出现 3 次 -> 共 46 个片段
第 3 次: 重+复 出现 3 次 -> 共 43 个片段
第 4 次: 重复+扣 出现 3 次 -> 共 40 个片段
第 5 次: 重复扣+款 出现 3 次 -> 共 37 个片段
第 6 次: 到+账 出现 3 次 -> 共 34 个片段
合并规则: [('退', '款'), ('发', '票'), ('重', '复'), ('重复', '扣'), ('重复扣', '款'), ('到', '账')]
...
```

「退+款」从第 5 名跳到第 1 名,还多学到一条「到+账」。结论:**词表长什么样完全取决于训练语料**。语料里什么多,什么就被合成整块。这也是国产模型的分词器对中文更省的原因,它们的语料里中文多。

</details>

**练习 3:规则的顺序。** 用 `toy_encode.py` 的 5 条规则切 `"重复扣费"`、`"发发票"`、`"票发"` 三个字符串。先在纸上按规则顺序手推,再跑,看「重复扣费」为什么切成两块而不是一块或四块。

<details><summary>参考答案</summary>

把 `toy_encode.py` 里 `for text in [...]` 那一行的列表换掉,另存为 `part02/toy_encode_ex.py`:

```python
# agent-zero-lab/part02/toy_encode_ex.py(只列出改动的那一行)
for text in ["重复扣费", "发发票", "票发"]:
```

<div class="line-notes">

- `for text in ["重复扣费", "发发票", "票发"]:` 三个故意挑的输入:一个只能合一部分,一个前面多一个「发」,一个顺序反了。

</div>

```bash
uv run part02/toy_encode_ex.py
```

```text
重复扣费 -> ['重复扣', '费'] -> [0, 1]
发发票 -> ['发', '发票'] -> [2, 3]
票发 -> ['票', '发'] -> [4, 2]
词表: {'重复扣': 0, '费': 1, '发': 2, '发票': 3, '票': 4}
```

「重复扣费」:第 2 条规则把「重复」合上,第 3 条把「重复扣」合上,第 4 条要找「重复扣」后面跟着「款」,这里跟的是「费」,合不上,所以停在两块。「发发票」:第 1 条规则从左往右扫,第一个「发」后面是「发」不是「票」,跳过;第二个「发」后面是「票」,合上。「票发」:顺序反了,规则是有方向的,「发+票」不等于「票+发」,所以两个都单独留着。

</details>

**练习 4(选做):把乱码翻译回汉字。** 词表里「发票」存成了 `åıĳç¥¨`。规则是这样的:256 个字节里,能直接显示的那些(33–126、161–172、174–255)就用同编号的字符表示;剩下的 68 个(空格、控制字符等)按顺序映射到从 256 开始的字符上。写一个函数,把 `Ġthe`、`åıĳç¥¨`、`æĪĳçļĦ`、`éĩįå¤į` 翻译回原文。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/decode_vocab_key.py
def byte_to_char_table() -> dict[str, int]:
    keep = list(range(33, 127)) + list(range(161, 173)) + list(range(174, 256))
    table: dict[str, int] = {chr(b): b for b in keep}
    extra = 0
    for b in range(256):
        if b not in keep:
            table[chr(256 + extra)] = b
            extra += 1
    return table


TABLE = byte_to_char_table()


def decode_key(key: str) -> str:
    raw = bytes(TABLE[ch] for ch in key)
    return raw.decode("utf-8", errors="replace")


for key in ["Ġthe", "åıĳç¥¨", "æĪĳçļĦ", "éĩįå¤į"]:
    print(f"{key!r} -> {decode_key(key)!r}")
```

<div class="line-notes">

- `keep = list(range(33, 127)) + list(range(161, 173)) + list(range(174, 256))` 能直接显示的字节,一共 94 + 12 + 82 = 188 个。`range(33, 127)` 包含 33 不包含 127,和 JS 里常见的「左闭右开」习惯一样。
- `table: dict[str, int] = {chr(b): b for b in keep}` 字典推导式。`chr(97)` 是 `'a'`,相当于 JS 的 `String.fromCodePoint(97)`。我们要的是反方向的表:「词表里看到的字符 → 原来的字节」。
- `for b in range(256):` 再把剩下的 68 个字节补上。
- `table[chr(256 + extra)] = b` 第一个不能显示的字节是 0,映射到 `chr(256)`,也就是 `Ā`;空格是第 33 个不能显示的字节(0 到 32 共 33 个),映射到 `chr(256 + 32)`,也就是 `Ġ`。这就是 `Ġ` 代表空格的来历。
- `raw = bytes(TABLE[ch] for ch in key)` 把每个可见字符查回原字节,拼成字节串。`åıĳç¥¨` 6 个字符查回 `[229, 143, 145, 231, 165, 168]`,和 `bytes_demo.py` 里「发」「票」的字节完全一致。
- `return raw.decode("utf-8", errors="replace")` 按 UTF-8 解码回字符串。`errors="replace"` 表示万一字节不完整(比如一个汉字被切开了),用 `�` 代替,不报错。
- `print(f"{key!r} -> {decode_key(key)!r}")` 实跑四行:`'Ġthe' -> ' the'`,`'åıĳç¥¨' -> '发票'`,`'æĪĳçļĦ' -> '我的'`,`'éĩįå¤į' -> '重复'`。

</div>

```bash
uv run part02/decode_vocab_key.py
```

```text
'Ġthe' -> ' the'
'åıĳç¥¨' -> '发票'
'æĪĳçļĦ' -> '我的'
'éĩįå¤į' -> '重复'
```

这个映射规则来自 GPT-2 的开源代码,后来很多字节级 BPE 分词器都沿用了。你不需要记住它,只要知道「词表里的乱码是字节换了个写法」就够了。

</details>

**验收标准:** `bytes_demo.py`、`toy_bpe.py`、`toy_encode.py`、`peek_vocab.py` 四个脚本都能跑出和文章一样的输出;能不看文章说出 BPE 的四个步骤;能解释「退票」为什么被切成两块、而「重复扣款」是一块;能说出 DeepSeek 分词器的词表大小。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| token | 分词器切出来的一小块文字,模型处理的最小单位。可能是一个汉字、一个词、半个词,甚至一个字节。例:「发票」在 DeepSeek 里是 1 个 token |
| 分词器(tokenizer) | 把文字切成 token、再把 token 换成编号的程序;输出时反过来。每家模型有自己的分词器,训练好就固定不变 |
| 词表(vocabulary) | 「token → 编号」的对照表。DeepSeek 的词表有 128,000 项 |
| token ID(编号) | 一个 token 在词表里的编号,模型实际处理的就是这些整数。例:「了」是 429 |
| 字节(byte) | 0 到 255 之间的整数,电脑存文字的最小单位。UTF-8 下一个英文字母 1 字节,一个常用汉字 3 字节 |
| UTF-8 | 最常用的文字编码方式,规定每个字符存成几个字节、分别是什么 |
| 子词(subword) | 介于「单个字符」和「完整单词」之间的切法:常见组合当整块,罕见的拆小 |
| BPE | Byte Pair Encoding。反复把语料里出现最多的相邻一对合并成新 token,直到词表够大 |
| 合并规则(merges) | BPE 训练时按顺序记下的「谁和谁合并」列表,切新文字时按这个顺序套用 |
| 特殊 token | 人为加进词表的标记,比如「句子开始」「句子结束」,不是从语料里合并来的 |
| Counter | Python 标准库里专门计数的字典,没出现过的键默认是 0 |

## 常见误区

**以为一个汉字就是一个 token。** 有时是,有时不是。「发票」两个字合起来才 1 个 token,「是怎么回事」五个字也是 1 个,「饕餮」两个字却要 4 个。token 数只能用分词器数出来,明天就数。

**以为 token 是模型「学」出来的,会随着使用变化。** 分词器在模型训练之前就单独训好,之后完全固定。你跟模型聊多少次,它的词表都不会多一项。

**以为 BPE 会遇到不认识的字。** 字节级 BPE 从 256 个字节起步,任何文字最差都能拆成字节,而所有字节都在词表里。遇到生僻内容的代价是切得更碎、更费 token,而不是报错或丢信息。

**拿玩具的结论去套真实分词器。** 我们的玩具从单字起步、只合并了 5 次,真实分词器从字节起步、合并了 12 万多次,还有一步「预切分」(比如数字最多三位一组、汉字和字母分开切)。玩具用来理解思路,具体某句话切几块,以真实分词器的结果为准。

**用 `vocab["发票"]` 查中文 token 的编号。** 实跑会得到 `KeyError: '发票'`。字节级词表里汉字存成了字节映射后的「乱码」,要查编号就用分词器库去编码,不要直接翻 JSON。

## 学习资料

### 文档与文章

- [DeepSeek:Token 用量计算](https://api-docs.deepseek.com/zh-cn/quick_start/token_usage):今天下载的分词器就在这页,页面还给了中英文字符和 token 的经验换算比例,明天会用实测数字去对照。5 分钟。
- [Hugging Face LLM 课程中文版 · BPE tokenization 算法](https://huggingface.co/learn/llm-course/zh-CN/chapter6/5):用英文小语料一步步演示 BPE 训练和切分,代码思路和我们的 `toy_bpe.py` 几乎一样,能互相对照。20 分钟。同一章的[第 1 节](https://huggingface.co/learn/llm-course/zh-CN/chapter6/1)讲为什么要训练自己的分词器,可以顺手看。
- [MDN:TextEncoder](https://developer.mozilla.org/zh-CN/docs/Web/API/TextEncoder):前端这边把字符串变字节的 API,和 Python 的 `str.encode` 对照着看。
- [Sennrich 等《Neural Machine Translation of Rare Words with Subword Units》](https://arxiv.org/abs/1508.07909):2015 年把 BPE 用到神经网络翻译上的论文,今天不用读,知道「子词」这个思路是从这里流行起来的就行。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1S5miBvEsu&autoplay=0&high_quality=1" title="Token 到底是什么?—— 揭秘大模型背后的“文字压缩术”" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · Token 到底是什么?—— 揭秘大模型背后的“文字压缩术” · 10 分钟,今天第一个看。把「为什么不按字切也不按词切」讲得很清楚,和正文第三节对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1v9dSYLE6U&autoplay=0&high_quality=1" title="【分词:BPE算法】白板手推吃透LLM基石原理!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI扫地曾 · 【分词:BPE算法】白板手推吃透LLM基石原理! · 12 分钟,在白板上手推一遍 BPE 合并,看完再回头读 toy_bpe.py 会很顺。</figcaption>
</figure>

- 【精校】Andrej Karpathy「让我们构建 GPT Tokenizer」中英字幕(BV1wt421h7Cx,Web3天空之城搬运,2 小时 13 分):下面 YouTube 那个视频的中字版,想彻底搞懂的人周末再看。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zduSFxRajkE" title="Let's build the GPT Tokenizer" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · Let's build the GPT Tokenizer · 2 小时 13 分。今天只看开头约 25 分钟,他会讲 tokenization 惹出来的一串怪现象(拼写、算术、非英语更贵),然后开始从字节写 BPE。后面的代码部分不是必需。</figcaption>
</figure>

### 书籍

- 《从零构建大模型》(Sebastian Raschka 著,人民邮电出版社,2025;英文原版《Build a Large Language Model (From Scratch)》,Manning,2024):第 2 章「处理文本数据」讲分词、token ID 和 BPE,代码是 Python,今天学完再读会轻松很多。
- 《图解大模型:生成式 AI 原理与实战》(Jay Alammar、Maarten Grootendorst 著,人民邮电出版社,2025;英文原版《Hands-On Large Language Models》,O'Reilly,2024):第 2 章讲 token 和嵌入,图多,适合当睡前读物。

### 开源项目与代码

- [karpathy/minbpe](https://github.com/karpathy/minbpe):最小的字节级 BPE 实现,`basic.py` 一百来行,是我们玩具的「真字节」版本。
- [huggingface/tokenizers](https://github.com/huggingface/tokenizers):今天那个 `tokenizer.json` 就是这个库的格式,明天会装它来真正切文字。

## 自测

1. 模型为什么需要分词器?不要分词器,直接把字符串喂给模型行不行?

<details><summary>答案</summary>

模型本体是矩阵运算,只能处理数字。分词器负责把文字切块并换成编号,模型输出编号后再由分词器换回文字。没有这一步,字符串根本进不了模型。

</details>

2. 一个字节一个 token、一个词一个 token,各有什么毛病?BPE 是怎么折中的?

<details><summary>答案</summary>

按字节切词表很小(256 项),但序列太长,同一句中文 token 数是字数的 3 倍,生成慢、窗口装得少。按词切序列短,但词表收不全,新词、编号、拼写错误都会变成「未知」而丢信息。BPE 把常见组合合成整块、罕见的留成小块,最差拆到字节,词表大小可控,任何输入都能表示。

</details>

3. 在 `toy_bpe.py` 里,为什么第一条合并规则是「发+票」而不是「重+复」?两者都出现了 3 次。

<details><summary>答案</summary>

次数相同时,`Counter.most_common` 按第一次被计数的先后排序。「发+票」在第一句的开头就被数到了,比「重+复」早,所以排在前面。真实分词器在打平时也有自己的固定规则,结论是合并顺序由语料和实现细节共同决定。

</details>

4. 「退票」这个词在训练语料里从没出现过,我们的玩具分词器会怎么处理?真实的字节级分词器遇到一个极其生僻的字又会怎么处理?

<details><summary>答案</summary>

玩具会把它切成「退」「票」两个单字,不报错,只是多一个 token。真实分词器会把生僻字拆成它的 3 或 4 个 UTF-8 字节,每个字节都在词表里,同样能表示,只是更费 token。

</details>

5. 面试题:为什么大模型数不清「strawberry 里有几个 r」?在 Agent 里遇到类似的字符级任务该怎么设计?

<details><summary>答案</summary>

模型看到的是 token 编号,不是字母。DeepSeek 分词器把 `strawberry` 切成 `st`、`raw`、`berry` 三块(前面有空格时是 ` strawberry` 一整块),模型没有直接看到每个字母,只能凭训练中见过的说法去答。Agent 里遇到数字符、反转字符串、精确计算这类任务,应该给它一个执行代码或字符串处理的工具,让程序去算,模型只负责决定调用。

</details>

## 明天预告

Day 108 · Token(二):动手数 token,中文为什么费 token。今天我们只是从 JSON 里「看」了词表,明天装上 `tokenizers` 库,用 DeepSeek 真实的分词器去切工单原文,数出中文、英文、订单号各要多少 token,再和 OpenAI 的两代分词器比一比。你会看到「中文费 token」这句话在不同分词器下的答案并不一样,而且差别大到直接体现在账单上。
