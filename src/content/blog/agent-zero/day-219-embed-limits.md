---
title: 'Day 219 · embedding 的两个短板:否定句和错误码'
description: '专门找让 embedding 出错的反例。「支持」和「不支持」两句意思相反,余弦却有 0.906;客户问 E1042,向量检索把 E1043 的文章排第一。今天把两个反例各跑一遍,看它们在去重和检索里分别会造成什么事故,再看一行精确匹配怎么救场。'
pubDate: 2026-10-22
regime: none
tags: ['embedding', 'bge-m3', 'rag', 'negation', 'agent-zero']
series: 'agent-zero'
day: 219
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 218](/blog/agent-zero/day-218-sim-matrix/) 我们用 `vecs @ vecs.T` 一行算出六句客服话的 6×6 相似度矩阵,学会了三种读法:先看对角线和对称做体检,再把每一行当成一次检索,最后把 15 对排个队。那天最有信息量的是一格「意外」:「年付套餐买错了」和「发票抬头填错了」话题不同,却因为句式相近拿到 0.63。读矩阵时专门找和预测不一样的格子,这个习惯今天接着用。

昨天的意外还算温和,只是排名偏了一点。今天找两个真会出事故的反例:意思完全相反的两句话,embedding 认为几乎一样;客户报的错误码,embedding 分不太清。做客服 Agent 一定会撞上这两件事,面试也爱问。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用实测数字说明 embedding 对否定词不敏感:「企业版支持按比例退款」和「企业版不支持按比例退款」余弦 0.906,比它和一句真正相关的「年付可以退钱吗」(0.74)还高;并说出这在「检索」和「相似度当答案」两种用法里,哪种问题大、哪种问题小。
2. 用实测数字说明 embedding 对错误码这类编号只有一点点感觉:编号以外一字不差的两篇文章,正确那篇只领先 0.05;措辞更像问题的错误文章能以 0.799 对 0.651 反超。
3. 会用一行 `in` 和一个正则做精确匹配,找出包含错误码的那篇,知道它为什么能补上 embedding 的短板,以及它自己的坑(大小写、空格)。
4. 被问到「RAG 召回不准怎么办」时,能先举这两个具体反例,再说怎么量、怎么改。

预计用时 2 小时:六个小脚本各 10–15 分钟,讲原因的那一节 15 分钟,剩下做练习。前置:[Day 217](/blog/agent-zero/day-217-embed-service/) 的 `common/embed.py`(今天每个脚本都 import 它),[Day 218](/blog/agent-zero/day-218-sim-matrix/) 读矩阵和「看排序别看阈值」,[Day 212](/blog/agent-zero/day-212-why-vectors/) 关键词搜索为什么不够。

今天所有 embedding 调用都走硅基流动的 `BAAI/bge-m3`,免费;练习 2 加一个同样免费的 `BAAI/bge-large-zh-v1.5`。实跑花费 0 元,全天一共发了二十来次请求、不到 2000 个 token。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写 `neg_dedup.py` 里的去重循环和 `err_keyword.py`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 什么是反例,为什么要专门找

**反例**(counterexample)就是让一个规则或工具出错的具体例子。前端同学天天在做这件事,只是不这么叫:写完一个表单校验,你会故意输一个空字符串、一个全角空格、一个超长的邮箱,看它会不会放过去。这些输入就是反例。

embedding 的「规则」是 Day 217 那句话:意思相近的文字,向量方向相近。Day 218 的矩阵基本支持这条规则,三句退款问题聚在一起,天气句离谁都远。但「基本支持」不等于「总是成立」。一个工具哪里会坏,你只能靠专门去找它坏的例子来知道,靠看它表现好的例子是看不出来的。

今天找的两类反例,在旧课和各种 RAG 实践里都被反复提到:**否定句**和**错误码**。我们一个一个跑。

## 短板一:否定句

### 第一个实验:支持还是不支持

新建 `part04/neg_pair.py`(在 `agent-zero-lab` 根目录下,`common/embed.py` 是 Day 217 建的):

```python
# agent-zero-lab/part04/neg_pair.py
from common.embed import embed, usage

a, b, c = embed([
    "企业版支持按比例退款",
    "企业版不支持按比例退款",
    "年付可以退钱吗",
])

print("支持 vs 不支持:", round(float(a @ b), 4))
print("支持 vs 年付可以退钱吗:", round(float(a @ c), 4))
print("不支持 vs 年付可以退钱吗:", round(float(b @ c), 4))
print("请求次数:", usage["requests"], " token:", usage["tokens"])
```

<div class="line-notes">

- `from common.embed import embed, usage` Day 217 的模块,`embed` 批量编码,`usage` 是记请求次数和 token 的字典。
- `a, b, c = embed([` 三条文本一次编码,返回 `(3, 1024)` 的数组。左边写三个变量,numpy 会按**行**拆开:`a` 是第 0 行,`b` 是第 1 行,`c` 是第 2 行,每个形状都是 `(1024,)`。相当于 JS 的 `const [a, b, c] = rows`。左边变量个数必须和行数一样,下面会故意写错一次。
- `"企业版支持按比例退款",` 帮助中心里可能出现的一句话。
- `"企业版不支持按比例退款",` 只多一个「不」字,意思完全相反。
- `"年付可以退钱吗",` 一句真正和退款有关的客户问题,当参照物。
- `round(float(a @ b), 4)` 两个一维向量 `@` 是点积,`embed` 已经归一化过,点积就是余弦。`float()` 把 numpy 的 `float32` 转成普通 Python 数字,`round(..., 4)` 保留四位。实测 0.9065。
- `round(float(a @ c), 4)` 「支持」那句和参照问题,实测 0.7401。
- `round(float(b @ c), 4)` 「不支持」那句和参照问题,实测 0.7347,和上一行几乎一样。
- `print("请求次数:", usage["requests"]` 3 条一次请求,30 个 token。

</div>

```bash
cd agent-zero-lab
uv run python -m part04.neg_pair
```

真实输出:

```text
支持 vs 不支持: 0.9065
支持 vs 年付可以退钱吗: 0.7401
不支持 vs 年付可以退钱吗: 0.7347
请求次数: 1  token: 30
```

我又跑了一次,三个数变成 0.9058、0.7406、0.7337,差在第三四位,这是 Day 217 说过的服务端抖动。结论不变:**意思相反的两句,比一对真正相关的话还像**。0.906 这个分数放在 Day 218 那张矩阵里,会是整张表最高的一格,比「年付套餐买错了」和退款政策原文的 0.74 高出一大截。

顺手把刚才的「按行拆开」故意写错一次([Day 22](/blog/agent-zero/day-022-tuples-unpack/) 学过解包)。新建 `part04/err_unpack.py`,三行数据只给两个变量:

```python
# agent-zero-lab/part04/err_unpack.py
from common.embed import embed

a, b = embed(["企业版支持按比例退款", "企业版不支持按比例退款", "年付可以退钱吗"])
```

<div class="line-notes">

- `a, b = embed([` 左边两个变量,右边是 `(3, 1024)`,三行,对不上。

</div>

```bash
uv run python -m part04.err_unpack
```

真实报错(最后四行,路径前半段我用 `...` 省略了):

```text
  File ".../agent-zero-lab/part04/err_unpack.py", line 4, in <module>
    a, b = embed(["企业版支持按比例退款", "企业版不支持按比例退款", "年付可以退钱吗"])
    ^^^^
ValueError: too many values to unpack (expected 2)
```

`too many values to unpack (expected 2)` 的意思是「右边拿出来的东西太多了,左边只准备了 2 个位置」。JS 的 `const [a, b] = [1, 2, 3]` 会默默扔掉第三个,Python 不会,直接报错。这其实是好事:今天的脚本经常一次编码好几句再拆开,拆错位置会让后面每个分数都张冠李戴,报错比默默错好查得多。修法是左边补上 `c`,或者用下标 `vecs[0]`、`vecs[1]` 取。

### 换五组话再测一遍

一组数据可能是巧合。新建 `part04/neg_more.py`,换五组不同说法的否定:「不」「不能」「还没有」「没有」「不可以」。

```python
# agent-zero-lab/part04/neg_more.py
from common.embed import embed, usage

PAIRS = [
    ("企业版支持按比例退款", "企业版不支持按比例退款"),
    ("可以开增值税专用发票", "不能开增值税专用发票"),
    ("退款已经到账了", "退款还没有到账"),
    ("这个账号开启了两步验证", "这个账号没有开启两步验证"),
    ("年付套餐可以中途取消", "年付套餐不可以中途取消"),
]

flat = [s for pair in PAIRS for s in pair]
vecs = embed(flat)

for i, (s1, s2) in enumerate(PAIRS):
    v1, v2 = vecs[2 * i], vecs[2 * i + 1]
    print(f"{float(v1 @ v2):.4f}  {s1}  |  {s2}")
print("请求次数:", usage["requests"], " token:", usage["tokens"])
```

<div class="line-notes">

- `PAIRS = [` 一个列表,里面每个元素是一个**元组**(tuple)`(肯定句, 否定句)`。元组是 [Day 22](/blog/agent-zero/day-022-tuples-unpack/) 学的「不能改的小列表」,这里用来表示「这两句是一对」。
- `("退款已经到账了", "退款还没有到账"),` 这一对连句式都变了,不只是加一个字。
- `flat = [s for pair in PAIRS for s in pair]` 两层推导式([Day 23](/blog/agent-zero/day-023-comprehensions/) 学过一层的),把 5 对拍平成 10 句:先取第一对的两句,再取第二对的两句……相当于 JS 的 `PAIRS.flat()`。读法是从左往右,和写两层 `for` 循环的顺序一样。
- `vecs = embed(flat)` 10 句正好一批(`EMB_BATCH=10`),一次请求,得到 `(10, 1024)`。
- `for i, (s1, s2) in enumerate(PAIRS):` `enumerate` 同时给出编号 `i` 和元素;元素是元组,用 `(s1, s2)` 直接拆开。第一轮 `i=0`、`s1="企业版支持按比例退款"`。
- `v1, v2 = vecs[2 * i], vecs[2 * i + 1]` 拍平之后,第 i 对的两句在第 `2i` 行和第 `2i+1` 行。`i=2` 时取第 4、5 行,正好是「已经到账」和「还没有到账」。
- `print(f"{float(v1 @ v2):.4f}  {s1}  |  {s2}")` f-string 里 `:.4f` 是「保留四位小数」,相当于 JS 的 `x.toFixed(4)`。

</div>

```bash
uv run python -m part04.neg_more
```

真实输出:

```text
0.9070  企业版支持按比例退款  |  企业版不支持按比例退款
0.8878  可以开增值税专用发票  |  不能开增值税专用发票
0.9207  退款已经到账了  |  退款还没有到账
0.9390  这个账号开启了两步验证  |  这个账号没有开启两步验证
0.9575  年付套餐可以中途取消  |  年付套餐不可以中途取消
```

五组全在 0.88 到 0.96 之间。最离谱的是最后一组,「可以取消」和「不可以取消」0.9575。句子越长、否定词在里面占的比例越小,分数越高,这和直觉一致:一个「不」字在十个字里是十分之一的分量,在二十个字里只剩二十分之一。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="否定句对的向量方向几乎重合,而真正相关的问题方向反而离得更远">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<circle cx="120" cy="210" r="4" fill="var(--ink-soft)"/>
<text x="60" y="235" fill="var(--ink-soft)">原点</text>
<line x1="120" y1="210" x2="470" y2="60" stroke="var(--mem)" stroke-width="2"/>
<text x="478" y="56" fill="var(--ink)">企业版支持按比例退款</text>
<line x1="120" y1="210" x2="480" y2="88" stroke="var(--compute)" stroke-width="2"/>
<text x="488" y="94" fill="var(--ink)">企业版不支持…</text>
<line x1="120" y1="210" x2="500" y2="180" stroke="var(--ink-faint)" stroke-width="2"/>
<text x="508" y="184" fill="var(--ink)">年付可以退钱吗</text>
<path d="M 300 133 A 190 190 0 0 1 306 151" fill="none" stroke="var(--ink-soft)"/>
<text x="318" y="140" fill="var(--ink-soft)">0.906,夹角很小</text>
<path d="M 250 155 A 140 140 0 0 1 258 199" fill="none" stroke="var(--ink-soft)"/>
<text x="268" y="214" fill="var(--ink-soft)">0.740,夹角更大</text>
<text x="20" y="28" fill="var(--ink-soft)">意思相反的两句方向几乎重合;意思相关的问题反而离得更远</text>
</g>
</svg>
<figcaption>示意图,把 1024 维压成二维画的,角度只表示大小关系。蓝线和琥珀线就差一个「不」字,在 embedding 眼里几乎是同一个方向。</figcaption>
</figure>

### 这在检索里是大问题吗

先说结论:**在检索里问题不大,在「拿相似度直接下结论」的地方问题很大**。分开看。

检索的用法是:用户问一个问题,我们找出最相关的几篇,交给大模型去读。新建 `part04/neg_search.py`,问「企业版能按比例退款吗」,文档里两句都有:

```python
# agent-zero-lab/part04/neg_search.py
import numpy as np

from common.embed import embed, embed_one

DOCS = [
    "企业版支持按比例退款",
    "企业版不支持按比例退款",
    "专业版和企业版有什么区别",
    "发票抬头填错了怎么改",
    "重置密码的邮件收不到",
]

doc_vecs = embed(DOCS)
q = embed_one("企业版能按比例退款吗")
scores = doc_vecs @ q
for rank, i in enumerate(np.argsort(-scores), start=1):
    print(rank, f"{scores[i]:.4f}", DOCS[i])
```

<div class="line-notes">

- `DOCS = [` 五篇「文档」,真实知识库里一篇文章会长得多,这里只用一句话代表。注意一个知识库里同时有「支持」和「不支持」是完全可能的,比如一篇讲专业版、一篇讲企业版,或者一篇旧政策没删。
- `doc_vecs = embed(DOCS)` 五篇一次编码,`(5, 1024)`。这一步相当于「建索引」。
- `q = embed_one("企业版能按比例退款吗")` 用户的问题,`(1024,)`。
- `scores = doc_vecs @ q` `(5, 1024) @ (1024,)` 得到 `(5,)`,一次算出问题和五篇的余弦。Day 218 的「每一行就是一次检索」,这里就是那一行。
- `for rank, i in enumerate(np.argsort(-scores), start=1):` `np.argsort(-scores)` 给出从大到小的下标顺序(Day 218 学过,取负号是为了倒序);`enumerate(..., start=1)` 让名次从 1 开始数而不是从 0。
- `print(rank, f"{scores[i]:.4f}", DOCS[i])` 打印名次、分数和原文。

</div>

```bash
uv run python -m part04.neg_search
```

真实输出:

```text
1 0.9489 企业版支持按比例退款
2 0.9280 企业版不支持按比例退款
3 0.6397 专业版和企业版有什么区别
4 0.5743 发票抬头填错了怎么改
5 0.4961 重置密码的邮件收不到
```

两句都排进了前两名,和第三名拉开了 0.3。对 RAG 来说这其实是可以接受的结果:后面 [Day 226](/blog/agent-zero/day-226-retrieve-answer/) 会把前几名的**原文**塞给大模型,大模型读得懂「不」字,它会看到两段互相矛盾的资料,要么指出矛盾,要么根据上下文判断哪段适用。embedding 负责「把相关的找出来」,判断对错交给读原文的大模型,分工没问题。

### 真正出事故的地方:拿相似度当答案

问题出在另一种用法:直接拿相似度下结论,不再让谁读原文。最常见的是**去重**。比如你从客服聊天记录里整理 FAQ,几百条里有很多重复的说法,想自动合并:相似度大于 0.9 的算同一条,只留第一条。

新建 `part04/neg_dedup.py`:

```python
# agent-zero-lab/part04/neg_dedup.py
import numpy as np

from common.embed import embed

FAQ = [
    "年付套餐中途取消,按剩余整月数比例退款",
    "年付套餐中途取消的话,剩下的整月按比例退钱",
    "企业版支持按比例退款",
    "企业版不支持按比例退款",
    "发票抬头填错了可以作废重开",
    "退款一般 3 到 5 个工作日到账",
]
THRESHOLD = 0.9

vecs = embed(FAQ)
kept: list[int] = []
for i in range(len(FAQ)):
    if kept:
        sims = vecs[kept] @ vecs[i]
        j = kept[int(np.argmax(sims))]
        best = float(sims.max())
        if best > THRESHOLD:
            print(f"丢弃 [{i}] {FAQ[i]}  (和 [{j}] 相似 {best:.4f})")
            continue
    kept.append(i)

print("保留:")
for i in kept:
    print(f"  [{i}] {FAQ[i]}")
```

<div class="line-notes">

- `FAQ = [` 六条。第 0、1 条是同一件事的两种说法,应该合并;第 2、3 条意思相反,绝不能合并。
- `THRESHOLD = 0.9` 「大于 0.9 算重复」。这个数看起来很保守,Day 218 那张矩阵里没有一对超过 0.75。
- `kept: list[int] = []` 已经保留下来的条目编号。类型标注 `list[int]` 是 [Day 46](/blog/agent-zero/day-046-type-hints-2/) 学的写法,告诉编辑器这里只放整数。
- `for i in range(len(FAQ)):` 从第 0 条开始,一条一条决定留不留。
- `if kept:` 第 0 条进来时 `kept` 是空列表,空列表在 `if` 里算假,直接跳到 `kept.append(0)`。
- `sims = vecs[kept] @ vecs[i]` `vecs[kept]` 是 numpy 的**花式下标**:用一个下标列表一次取出好几行。`kept` 是 `[0, 2]` 时,`vecs[[0, 2]]` 就是第 0 行和第 2 行组成的 `(2, 1024)`。再 `@ vecs[i]`,得到新条目和每条已保留条目的相似度。
- `j = kept[int(np.argmax(sims))]` `np.argmax` 返回最大值的位置,是在 `sims` 里的位置(0、1、2…),要再通过 `kept[...]` 换回 FAQ 里的真实编号。处理第 3 条时 `kept=[0, 2]`,最大值在位置 1,`kept[1]` 是 2。
- `best = float(sims.max())` 最大的那个相似度。
- `if best > THRESHOLD:` 超过阈值,判为重复。
- `continue` 跳过本轮剩下的代码,也就是不执行下面的 `kept.append(i)`。和 JS 循环里的 `continue` 一样。
- `kept.append(i)` 没被判重复,保留。

</div>

```bash
uv run python -m part04.neg_dedup
```

真实输出:

```text
丢弃 [1] 年付套餐中途取消的话,剩下的整月按比例退钱  (和 [0] 相似 0.9713)
丢弃 [3] 企业版不支持按比例退款  (和 [2] 相似 0.9072)
保留:
  [0] 年付套餐中途取消,按剩余整月数比例退款
  [2] 企业版支持按比例退款
  [4] 发票抬头填错了可以作废重开
  [5] 退款一般 3 到 5 个工作日到账
```

第一条丢弃是对的,0.9713,两种说法确实是一回事。第二条丢弃是事故:「企业版不支持按比例退款」被当成重复删掉了,FAQ 里只剩下「企业版支持按比例退款」。如果这份 FAQ 后来被当成知识库,客服 Agent 会言之凿凿地告诉企业版客户「可以按比例退款」,而这句话恰好和公司政策相反。

注意这里没有任何一步「出错」:没有报错,阈值也不激进,合并对的那一对分数 0.97 也很合理。坏就坏在 0.9072 和 0.9713 落在了阈值的同一侧。同样的坑还出现在「用户问题和 FAQ 问题相似度大于 0.9 就直接返回 FAQ 答案」这种不经过大模型的快速通道里。练习 3 给去重加一道保险。

## 短板二:错误码

### 第一个实验:只差一个编号

CloudLedger 的帮助中心有一组错误码文章:E1042 是文件编码问题,E1043 是日期格式问题,E2017 是银行账户没授权。客户报错时通常直接把错误码贴过来。

先做一个最干净的对照:两篇文档除了编号以外一字不差,看 embedding 能不能分出来。新建 `part04/err_same.py`:

```python
# agent-zero-lab/part04/err_same.py
from common.embed import embed

q, d42, d43 = embed([
    "E1042 是什么错",
    "导入银行流水时报错 E1042:文件编码不是 UTF-8,请另存为 CSV UTF-8 后重新上传",
    "导入银行流水时报错 E1043:文件编码不是 UTF-8,请另存为 CSV UTF-8 后重新上传",
])
print("问题 vs E1042 那篇:", round(float(q @ d42), 4))
print("问题 vs E1043 那篇:", round(float(q @ d43), 4))
print("两篇文档之间:", round(float(d42 @ d43), 4))
```

<div class="line-notes">

- `q, d42, d43 = embed([` 三条一次编码,按行拆成三个 `(1024,)`,这次三个变量对三行,不会报错。
- `"E1042 是什么错",` 客户的问题,几乎只有一个编号。
- `"导入银行流水时报错 E1042:文件编码` 正确文章。
- `"导入银行流水时报错 E1043:文件编码` 故意造的对照组,只把 2 换成 3,其余一字不差。真实知识库里不会这么写,这里是为了把「编号」这一个变量单独拎出来。
- `round(float(q @ d42), 4)` 问题和正确文章,实测 0.6013。
- `round(float(q @ d43), 4)` 问题和对照组,实测 0.5547。
- `round(float(d42 @ d43), 4)` 两篇文档之间,实测 0.9667,在 embedding 眼里它们几乎是同一篇。

</div>

```bash
uv run python -m part04.err_same
```

真实输出:

```text
问题 vs E1042 那篇: 0.6013
问题 vs E1043 那篇: 0.5547
两篇文档之间: 0.9667
```

方向是对的,E1042 那篇赢了。所以 embedding 对编号不是完全没感觉。但领先只有 0.05,而且两篇文档互相之间 0.9667,说明在它的世界里「E1042」和「E1043」只是两个长得很像的字符串。0.05 这点领先,只要别的因素稍微动一动就会被抵消,下一个实验就是这种情况。

### 第二个实验:措辞更像问题的错误文章

真实知识库里,不同错误码的文章写法各不相同。有的作者喜欢开门见山「E1042:……」,有的喜欢把客户的问法写成标题「导入银行流水报错 E1043 怎么办?」。新建 `part04/err_wording.py`:

```python
# agent-zero-lab/part04/err_wording.py
from common.embed import embed

q, d42, d43 = embed([
    "导入银行流水报错 E1042 怎么办",
    "E1042:文件编码不是 UTF-8。用 Excel 另存为 CSV UTF-8 后重新上传。",
    "导入银行流水报错 E1043 怎么办?这是日期格式无法识别,请把日期列改成 YYYY-MM-DD。",
])
print("问题 vs E1042(正确答案):", round(float(q @ d42), 4))
print("问题 vs E1043(错误答案):", round(float(q @ d43), 4))
```

<div class="line-notes">

- `"导入银行流水报错 E1042 怎么办",` 客户问的是 E1042。
- `"E1042:文件编码不是 UTF-8。` 正确文章,开头就是 E1042,但后面的字和问题几乎没有重合。
- `"导入银行流水报错 E1043 怎么办?` 错误文章,前十几个字和问题一模一样,只有编号不同。
- `round(float(q @ d42), 4)` 实测 0.6509。
- `round(float(q @ d43), 4)` 实测 0.7993。

</div>

```bash
uv run python -m part04.err_wording
```

真实输出:

```text
问题 vs E1042(正确答案): 0.6509
问题 vs E1043(错误答案): 0.7993
```

错的那篇高了将近 0.15,排第一。客户问 E1042,向量检索把「请把日期列改成 YYYY-MM-DD」递给了大模型。和否定句不一样,这次大模型很难救场:如果 top-k 只取 1 篇,正确答案根本不在资料里;就算取了 3 篇,大模型看到的第一篇标题和问题几乎一字不差,它很可能就照着答了。客户按说明改了日期格式,问题当然没解决。

旧课同一组句子测出来是 0.651 和 0.799,今天重跑是 0.6509 和 0.7993,一致。

### embedding 为什么会这样

下面是一个直觉解释,不是严格的证明,但足够帮你预判哪些地方会出问题。

embedding 模型的训练目标大致是:让「问题」和「能回答它的段落」靠近,让不相关的离远(训练数据通常是海量的「问题-答案」对)。在这种数据里,「企业版支持退款吗」和「企业版不支持退款」都是在聊同一个话题,对检索任务来说它们都算「相关」,模型没有动力把它们分开。它学到的是「这段话在聊什么」,而不是「这段话断言了什么」。

再加上一个结构上的原因:不管句子多长,最后都要被压成 1024 个数。一个「不」字、一个「3」变成「2」,在整句话里分量很小。新建 `part04/short_words.py` 把这件事放大看,只比较几个短词:

```python
# agent-zero-lab/part04/short_words.py
from common.embed import embed

PAIRS = [
    ("支持", "不支持"),
    ("支持", "反对"),
    ("E1042", "E1043"),
    ("E1042", "E9999"),
    ("E1042", "退款"),
]
vecs = embed([s for p in PAIRS for s in p])
for i, (s1, s2) in enumerate(PAIRS):
    print(f"{float(vecs[2 * i] @ vecs[2 * i + 1]):.4f}  {s1} | {s2}")
```

<div class="line-notes">

- `("支持", "不支持"),` 一个词和它的否定。
- `("支持", "反对"),` 一个词和它的反义词,字面上一个字都不重合。
- `("E1042", "E1043"),` 只差最后一位的两个编号。
- `("E1042", "E9999"),` 同样是 E 开头四位数字,但数字完全不同。
- `("E1042", "退款"),` 编号和一个普通词。
- `vecs = embed([s for p in PAIRS for s in p])` 和 `neg_more.py` 一样先拍平再一次编码,10 条一批。
- `vecs[2 * i] @ vecs[2 * i + 1]` 第 i 对的两句在第 2i 行和 2i+1 行。

</div>

```bash
uv run python -m part04.short_words
```

真实输出:

```text
0.8487  支持 | 不支持
0.6743  支持 | 反对
0.7538  E1042 | E1043
0.4937  E1042 | E9999
0.3509  E1042 | 退款
```

两件事很清楚。第一,「支持」和「不支持」0.85,比「支持」和「反对」的 0.67 高得多:模型更看重字面重合,而不是意思是否相反。第二,E1042 和 E1043 是 0.75,和 E9999 只有 0.49:模型把编号当成一串**字符**来看,字符越像向量越近。它不知道 E1042 和 E1043 是两个完全不同的错误,就像你不会觉得 1042 号房间和 1043 号房间住的是同一个人。

这也解释了昨天那张矩阵里「买错了」和「填错了」的 0.63:字面和句式的重合,会被算进相似度里。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="精确匹配和向量检索在错误码问题上的对比:向量检索把E1043排第一,精确匹配只命中E1042">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">问题:导入银行流水报错 E1042 怎么办</text>
<text x="20" y="62" fill="var(--ink-soft)">向量检索(看意思和字面)</text>
<rect x="20" y="74" width="280" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="96" fill="var(--ink)">1. E1043 那篇  0.7993  ✗</text>
<rect x="20" y="116" width="280" height="34" rx="4" fill="none" stroke="var(--rule)"/>
<text x="30" y="138" fill="var(--ink)">2. E1042 那篇  0.6509  ✓</text>
<text x="340" y="62" fill="var(--ink-soft)">精确匹配(只看 E1042 在不在)</text>
<rect x="340" y="74" width="280" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="350" y="96" fill="var(--ink)">kb-E1042  命中  ✓</text>
<rect x="340" y="116" width="280" height="34" rx="4" fill="none" stroke="var(--rule)"/>
<text x="350" y="138" fill="var(--ink)">kb-E1043  没命中</text>
<text x="20" y="190" fill="var(--ink-soft)">各有短板:向量分不清编号;精确匹配不懂同义词(Day 212)</text>
<text x="20" y="212" fill="var(--ink-soft)">两路合起来用,是 Day 235–236 的混合检索</text>
</g>
</svg>
<figcaption>蓝色是 embedding 那一路,琥珀色是精确匹配那一路。错误码这种「要么一字不差、要么完全不对」的东西,正好是关键词匹配的强项。</figcaption>
</figure>

## 精确匹配来救场

错误码有一个好性质:它要么一字不差地出现在文章里,要么不出现。这正是 Day 212 讲的关键词搜索最擅长的事。那天我们嫌关键词搜索不懂同义词,今天轮到 embedding 不懂编号,两边正好互补。

新建 `part04/err_keyword.py`:

```python
# agent-zero-lab/part04/err_keyword.py
import re

DOCS = {
    "kb-E1042": "E1042:文件编码不是 UTF-8。用 Excel 另存为 CSV UTF-8 后重新上传。",
    "kb-E1043": "导入银行流水报错 E1043 怎么办?这是日期格式无法识别,请把日期列改成 YYYY-MM-DD。",
    "kb-E2017": "E2017:银行账户未授权。到「设置 → 银行连接」重新授权。",
}

query = "导入银行流水报错 E1042 怎么办"
codes = re.findall(r"E\d{4}", query)
print("问题里的错误码:", codes)

for doc_id, text in DOCS.items():
    hit = [c for c in codes if c in text]
    print(doc_id, "命中" if hit else "没命中", hit)

print(re.findall(r"E\d{4}", "报错 e1042,还有 E 1042"))
```

<div class="line-notes">

- `import re` Python 自带的正则表达式模块,不用装。
- `DOCS = {` 一个字典,键是文章编号,值是正文。今天的文章都是一句话,Day 222 会造出真正的 CloudLedger 帮助中心。
- `codes = re.findall(r"E\d{4}", query)` 在问题里找出所有「E 加四位数字」。`r"..."` 是**原始字符串**,反斜杠不转义,写正则时总是加上 `r`。`re.findall(pattern, text)` 相当于 JS 的 `text.match(/E\d{4}/g)`,区别是没找到时 Python 返回空列表 `[]`,JS 返回 `null`。这里得到 `['E1042']`。
- `for doc_id, text in DOCS.items():` 字典的 `.items()` 同时给出键和值,相当于 JS 的 `Object.entries(DOCS)`。
- `hit = [c for c in codes if c in text]` 问题里的每个错误码,看它是否出现在这篇文章里。`c in text` 是子串判断,相当于 JS 的 `text.includes(c)`。kb-E1042 得到 `['E1042']`,另外两篇是 `[]`。
- `print(doc_id, "命中" if hit else "没命中", hit)` `A if 条件 else B` 是 Python 的三元表达式,相当于 JS 的 `hit.length ? "命中" : "没命中"`。空列表算假。
- `re.findall(r"E\d{4}", "报错 e1042,还有 E 1042")` 故意试两种客户的真实写法:小写 e,和 E 后面多一个空格。

</div>

```bash
uv run python -m part04.err_keyword
```

真实输出:

```text
问题里的错误码: ['E1042']
kb-E1042 命中 ['E1042']
kb-E1043 没命中 []
kb-E2017 没命中 []
[]
```

精确匹配一步到位,只有正确那篇命中。但最后一行是精确匹配自己的坑:客户写成 `e1042` 或者 `E 1042`,正则一个都没找到,返回空列表。精确就意味着死板。最简单的补法是匹配前先统一大小写(`query.upper()`),练习 4 会这么做;空格、全角字母这类花样,要在后面 [Day 235](/blog/agent-zero/day-235-bm25/) 学 BM25 的分词时一起处理。

这里我只用了 `in` 和一个正则,是为了让你看清「精确匹配」这件事本身。真实项目里不会给每种编号手写正则,而是用 BM25 这种通用的关键词检索,再和向量检索的结果合并,这叫**混合检索**,是 [Day 235](/blog/agent-zero/day-235-bm25/) 和 [Day 236](/blog/agent-zero/day-236-rrf/) 的内容。今天先记住它为什么必要。

## 面试里怎么讲这两个短板

「RAG 召回不准怎么办」几乎是 Agent 岗的必考题。只会说「换个更好的 embedding 模型」的回答很常见,面试官听得出来没踩过坑。我的建议是按三层说:

第一层,举具体反例。「我测过,bge-m3 上『企业版支持按比例退款』和『不支持』两句余弦 0.906,比它和一个真正相关的问题还高;客户问 E1042,措辞更像问题的 E1043 文章以 0.80 对 0.65 排第一。」有数字、有场景,一句话就能证明你亲手做过。

第二层,说怎么定位。不靠感觉,建一份检索评估集,把「带错误码的问题」「带否定的问题」单独标出来,量这几类的召回率,确认问题到底有多大。这是 [Day 255](/blog/agent-zero/day-255-rag-eval-1/) 开始的 RAG 评估。

第三层,说手段,并说清每个手段对付哪个短板。错误码、产品型号、人名这类精确字符串,加关键词检索做混合检索;否定和细节,靠 rerank 精排([Day 238](/blog/agent-zero/day-238-rerank/))和最后让大模型读原文判断;任何「拿相似度直接下结论」的地方(去重、FAQ 直出),都不要只信一个阈值。

## 动手练习

**练习 1:数字也一样吗?** 错误码是编号,那普通数字呢?测四对:「退款 7 天内到账」和「退款 30 天内到账」、「专业版每月 99 元」和「专业版每月 999 元」、「最多邀请 5 个成员」和「最多邀请 50 个成员」,再加一对意思相同的「退款 7 天内到账」和「退款一周内到账」做参照。先猜,再跑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_numbers.py
from common.embed import embed

PAIRS = [
    ("退款 7 天内到账", "退款 30 天内到账"),
    ("专业版每月 99 元", "专业版每月 999 元"),
    ("最多邀请 5 个成员", "最多邀请 50 个成员"),
    ("退款 7 天内到账", "退款一周内到账"),
]
vecs = embed([s for p in PAIRS for s in p])
for i, (s1, s2) in enumerate(PAIRS):
    print(f"{float(vecs[2 * i] @ vecs[2 * i + 1]):.4f}  {s1}  |  {s2}")
```

<div class="line-notes">

- `("退款 7 天内到账", "退款 30 天内到账"),` 数字不同,对客户来说差别巨大。
- `("专业版每月 99 元", "专业版每月 999 元"),` 价格差十倍,字面上只多一个 9。
- `("退款 7 天内到账", "退款一周内到账"),` 意思完全相同的参照组。
- `vecs = embed([s for p in PAIRS for s in p])` 8 条一次请求。
- `vecs[2 * i] @ vecs[2 * i + 1]` 第 i 对。

</div>

```bash
uv run python -m part04.ex_numbers
```

真实输出:

```text
0.9413  退款 7 天内到账  |  退款 30 天内到账
0.9766  专业版每月 99 元  |  专业版每月 999 元
0.9564  最多邀请 5 个成员  |  最多邀请 50 个成员
0.9553  退款 7 天内到账  |  退款一周内到账
```

数字比否定还不敏感。99 元和 999 元 0.9766,是今天所有句对里最高的;「5 个成员」和「50 个成员」0.9564,比意思真正相同的「7 天」和「一周」(0.9553)还高一点点。所以第一个短板其实可以扩大成「否定、数字、编号这类细节都不敏感」。对检索来说,这意味着涉及价格、期限、人数上限的问题,检索到的文章话题会对,但具体数字必须让大模型从原文里读,不能靠向量分数判断「是不是同一个价格」。

</details>

**练习 2:换个模型会好吗?** 用硅基流动上同样免费的 `BAAI/bge-large-zh-v1.5`,把「支持 / 不支持 / 年付退钱」和 E1042 的三句再测一遍,和 bge-m3 并排比较。注意 `common/embed.py` 的模型是从 `.env` 读的,这里要像 Day 217 的 `emb_two_models.py` 那样单独建客户端。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_other_model.py
import os

import numpy as np
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["EMB_BASE_URL"], api_key=os.environ["EMB_API_KEY"])

TEXTS = [
    "企业版支持按比例退款",
    "企业版不支持按比例退款",
    "年付可以退钱吗",
    "导入银行流水报错 E1042 怎么办",
    "E1042:文件编码不是 UTF-8。用 Excel 另存为 CSV UTF-8 后重新上传。",
    "导入银行流水报错 E1043 怎么办?这是日期格式无法识别,请把日期列改成 YYYY-MM-DD。",
]


def embed_with(model: str) -> np.ndarray:
    resp = client.embeddings.create(model=model, input=TEXTS)
    arr = np.array([d.embedding for d in sorted(resp.data, key=lambda d: d.index)])
    return arr / np.linalg.norm(arr, axis=1, keepdims=True)


for model in ["BAAI/bge-m3", "BAAI/bge-large-zh-v1.5"]:
    v = embed_with(model)
    print(model)
    print("  支持 vs 不支持:", round(float(v[0] @ v[1]), 4), " 支持 vs 年付退钱:", round(float(v[0] @ v[2]), 4))
    print("  E1042 问题 vs 正确:", round(float(v[3] @ v[4]), 4), " vs 错误:", round(float(v[3] @ v[5]), 4))
```

<div class="line-notes">

- `client = OpenAI(base_url=os.environ["EMB_BASE_URL"]` 和 `common/embed.py` 用同一个地址和 key,只是模型名由我们自己传。
- `TEXTS = [` 六句:前三句是否定实验,后三句是错误码实验。
- `def embed_with(model: str) -> np.ndarray:` 指定模型编码这六句,返回归一化后的 `(6, 1024)`。两个模型恰好都是 1024 维。
- `arr = np.array([d.embedding for d in sorted(resp.data, key=lambda d: d.index)])` Day 217 学的按 `index` 排序再取向量。
- `return arr / np.linalg.norm(arr, axis=1, keepdims=True)` 按行归一化。
- `for model in ["BAAI/bge-m3", "BAAI/bge-large-zh-v1.5"]:` 两个模型各跑一遍。注意每个模型只和**自己**的向量比,Day 217 讲过混用没有意义。
- `round(float(v[0] @ v[1]), 4)` 支持 vs 不支持。
- `round(float(v[3] @ v[4]), 4)` E1042 问题 vs 正确文章;后面 `v[3] @ v[5]` 是 vs 错误文章。

</div>

```bash
uv run python -m part04.ex_other_model
```

真实输出:

```text
BAAI/bge-m3
  支持 vs 不支持: 0.9065  支持 vs 年付退钱: 0.7396
  E1042 问题 vs 正确: 0.6513  vs 错误: 0.7998
BAAI/bge-large-zh-v1.5
  支持 vs 不支持: 0.9067  支持 vs 年付退钱: 0.5525
  E1042 问题 vs 正确: 0.6371  vs 错误: 0.869
```

换模型没有救场,反而更糟。bge-large-zh 上「支持 / 不支持」同样是 0.9067,但它和真正相关问题的分数掉到 0.5525,两者差距从 0.17 拉大到 0.35;错误码那组,错误文章领先从 0.15 拉大到 0.23。这说明两个短板不是 bge-m3 一家的毛病,而是「把整句话压成一个向量」这种做法的共性。Google DeepMind 2025 年有一篇论文专门从理论上讨论单向量检索能表达什么、不能表达什么(见学习资料)。这也是为什么面试时说「换个更好的模型」不够,要说「加关键词检索、加 rerank」。

</details>

**练习 3:给去重加一道保险。** 改 `neg_dedup.py`:当两条相似度超过 0.9 时,先数一数两条里否定词(不、没、未、无、非、别)的个数,个数不一样就不删,而是打印「疑似反义,交给人看」。跑完说说这个办法有什么漏洞。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_dedup_fix.py
import numpy as np

from common.embed import embed

FAQ = [
    "年付套餐中途取消,按剩余整月数比例退款",
    "年付套餐中途取消的话,剩下的整月按比例退钱",
    "企业版支持按比例退款",
    "企业版不支持按比例退款",
    "发票抬头填错了可以作废重开",
    "退款一般 3 到 5 个工作日到账",
]
THRESHOLD = 0.9
NEG_WORDS = ["不", "没", "未", "无", "非", "别"]


def neg_count(text: str) -> int:
    return sum(text.count(w) for w in NEG_WORDS)


vecs = embed(FAQ)
kept: list[int] = []
for i in range(len(FAQ)):
    if kept:
        sims = vecs[kept] @ vecs[i]
        j = kept[int(np.argmax(sims))]
        best = float(sims.max())
        if best > THRESHOLD:
            if neg_count(FAQ[i]) != neg_count(FAQ[j]):
                print(f"疑似反义,交给人看: [{i}] 和 [{j}]  相似 {best:.4f}")
            else:
                print(f"丢弃 [{i}]  (和 [{j}] 相似 {best:.4f})")
                continue
    kept.append(i)
print("保留:", kept)
```

<div class="line-notes">

- `NEG_WORDS = ["不", "没", "未", "无", "非", "别"]` 常见的中文否定字。
- `def neg_count(text: str) -> int:` 数一句话里一共有几个否定字。
- `return sum(text.count(w) for w in NEG_WORDS)` `text.count(w)` 数子串出现几次,`sum(...)` 加起来。「企业版不支持按比例退款」得 1,「企业版支持按比例退款」得 0。相当于 JS 的 `NEG_WORDS.reduce((n, w) => n + text.split(w).length - 1, 0)`。
- `if neg_count(FAQ[i]) != neg_count(FAQ[j]):` 相似度很高、否定字个数却不同,很可能是一对反义句。
- `print(f"疑似反义,交给人看: [{i}] 和 [{j}]` 不删,标出来让人决定。这里没有 `continue`,所以会走到下面的 `kept.append(i)`,先保留。
- `continue` 否定字个数相同,才真的当重复丢掉。

</div>

```bash
uv run python -m part04.ex_dedup_fix
```

真实输出:

```text
丢弃 [1]  (和 [0] 相似 0.9713)
疑似反义,交给人看: [3] 和 [2]  相似 0.9072
保留: [0, 2, 3, 4, 5]
```

「不支持」那条保住了。漏洞至少有三个:一是「无」会误伤,「日期格式无法识别」里的「无」并不是否定一个事实;二是双重否定「不是不能退」被数成 2 个,和 0 个的句子个数不同,会被误报;三是反义不一定靠否定字,「可以退款」和「拒绝退款」一个否定字都没有。所以这只是一道便宜的保险,把最常见的事故挡掉,真正可靠的做法是把高相似度的候选对交给大模型或人去判断,不要让阈值单独做决定。

</details>

**练习 4:给错误码加分。** 写一个 `search(query, doc_vecs)`:先算向量分数,再看问题里有没有错误码(先 `upper()` 再用正则找),文章里包含这个错误码的,分数加 0.3,按最终分数排序。用四篇文章(E1042、E1043、E2017、一篇讲导入格式的)测三个问题:「导入银行流水报错 E1042 怎么办」「导入流水报错 e2017」「流水导入支持什么格式」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_code_boost.py
import re

import numpy as np

from common.embed import embed, embed_one

DOCS = [
    "E1042:文件编码不是 UTF-8。用 Excel 另存为 CSV UTF-8 后重新上传。",
    "导入银行流水报错 E1043 怎么办?这是日期格式无法识别,请把日期列改成 YYYY-MM-DD。",
    "E2017:银行账户未授权。到「设置 → 银行连接」重新授权。",
    "导入银行流水支持哪些文件格式:CSV、XLSX 和 OFX。",
]
BOOST = 0.3


def search(query: str, doc_vecs: np.ndarray) -> list[tuple[float, float, int]]:
    scores = doc_vecs @ embed_one(query)
    codes = re.findall(r"E\d{4}", query.upper())
    results = []
    for i, text in enumerate(DOCS):
        bonus = BOOST if any(c in text for c in codes) else 0.0
        results.append((float(scores[i]) + bonus, float(scores[i]), i))
    return sorted(results, reverse=True)


doc_vecs = embed(DOCS)
for query in ["导入银行流水报错 E1042 怎么办", "导入流水报错 e2017", "流水导入支持什么格式"]:
    print("问题:", query)
    for final, raw, i in search(query, doc_vecs):
        print(f"  最终 {final:.4f}  向量 {raw:.4f}  {DOCS[i][:24]}")
```

<div class="line-notes">

- `BOOST = 0.3` 命中错误码加多少分。今天的向量分数挤在 0.4 到 0.8 之间,加 0.3 足够把命中的那篇顶到第一。这个数是我凭今天的数据拍的,不同模型分数区间不同,要重新定,这正是 Day 236 用「按名次合并」代替「分数相加」的原因。
- `def search(query: str, doc_vecs: np.ndarray) -> list[tuple[float, float, int]]:` 返回类型是「由三元组组成的列表」,三个位置分别是最终分、向量分、文章下标。
- `scores = doc_vecs @ embed_one(query)` 先算向量分,`(4,)`。
- `codes = re.findall(r"E\d{4}", query.upper())` 先转大写再找,`e2017` 变成 `E2017`,能找到了。
- `bonus = BOOST if any(c in text for c in codes) else 0.0` `any(...)` 只要有一个为真就是真,相当于 JS 的 `codes.some(c => text.includes(c))`。问题里没有错误码时 `codes` 是空列表,`any([])` 是假,不加分。
- `results.append((float(scores[i]) + bonus, float(scores[i]), i))` 把三个数打包成一个元组。
- `return sorted(results, reverse=True)` 元组排序时先比第一个元素,也就是最终分,`reverse=True` 从大到小。
- `print(f"  最终 {final:.4f}  向量 {raw:.4f}  {DOCS[i][:24]}")` `DOCS[i][:24]` 只打印前 24 个字符,免得一行太长。

</div>

```bash
uv run python -m part04.ex_code_boost
```

真实输出:

```text
问题: 导入银行流水报错 E1042 怎么办
  最终 0.9509  向量 0.6509  E1042:文件编码不是 UTF-8。用 Exc
  最终 0.7993  向量 0.7993  导入银行流水报错 E1043 怎么办?这是日期格
  最终 0.6502  向量 0.6502  E2017:银行账户未授权。到「设置 → 银行连
  最终 0.6348  向量 0.6348  导入银行流水支持哪些文件格式:CSV、XLSX 
问题: 导入流水报错 e2017
  最终 0.9232  向量 0.6232  E2017:银行账户未授权。到「设置 → 银行连
  最终 0.6814  向量 0.6814  导入银行流水报错 E1043 怎么办?这是日期格
  最终 0.5937  向量 0.5937  导入银行流水支持哪些文件格式:CSV、XLSX 
  最终 0.5693  向量 0.5693  E1042:文件编码不是 UTF-8。用 Exc
问题: 流水导入支持什么格式
  最终 0.8078  向量 0.8078  导入银行流水支持哪些文件格式:CSV、XLSX 
  最终 0.6075  向量 0.6075  导入银行流水报错 E1043 怎么办?这是日期格
  最终 0.5457  向量 0.5457  E1042:文件编码不是 UTF-8。用 Exc
  最终 0.4155  向量 0.4155  E2017:银行账户未授权。到「设置 → 银行连
```

三个问题都对了。第一个问题,E1042 从向量分第二(0.6509)加分后变成第一;第二个问题更说明问题,只看向量分 E2017 排第二(0.6232 比 E1043 的 0.6814 低),小写的 `e2017` 经过 `upper()` 被认出来后排到第一;第三个问题没有错误码,不加分,纯靠向量也排对了。这就是混合检索的雏形:关键词那一路管精确,向量那一路管意思。

</details>

**练习 5:观察会发生什么。** 用 `neg_search.py` 的五篇文档,换三个问题:「企业版能按比例退款吗」「哪个版本不支持按比例退款」「企业版不能按比例退款吗」,每个只看前两名。问题本身带了否定词,排序会变吗?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex_neg_query.py
import numpy as np

from common.embed import embed, embed_one

DOCS = [
    "企业版支持按比例退款",
    "企业版不支持按比例退款",
    "专业版和企业版有什么区别",
    "发票抬头填错了怎么改",
    "重置密码的邮件收不到",
]
doc_vecs = embed(DOCS)
for query in ["企业版能按比例退款吗", "哪个版本不支持按比例退款", "企业版不能按比例退款吗"]:
    scores = doc_vecs @ embed_one(query)
    top = np.argsort(-scores)[:2]
    print(query, "→", [(DOCS[i], round(float(scores[i]), 4)) for i in top])
```

<div class="line-notes">

- `doc_vecs = embed(DOCS)` 五篇只编码一次,三个问题共用。
- `scores = doc_vecs @ embed_one(query)` 每个问题一次请求。
- `top = np.argsort(-scores)[:2]` 从大到小排,切片取前两名。
- `[(DOCS[i], round(float(scores[i]), 4)) for i in top]` 把前两名做成「(原文, 分数)」的列表一次打印。

</div>

```bash
uv run python -m part04.ex_neg_query
```

真实输出:

```text
企业版能按比例退款吗 → [('企业版支持按比例退款', 0.9489), ('企业版不支持按比例退款', 0.928)]
哪个版本不支持按比例退款 → [('企业版不支持按比例退款', 0.9277), ('企业版支持按比例退款', 0.8368)]
企业版不能按比例退款吗 → [('企业版不支持按比例退款', 0.9537), ('企业版支持按比例退款', 0.9248)]
```

会变,但只是前两名互换。问题里有「不」,带「不」的那篇就排第一,这是字面重合在起作用,不是模型理解了否定。三个问题的前两名始终是这两句,差距最大 0.09、最小 0.02。对检索来说这是好消息:两句都会被召回,大模型读到原文自己判断。如果你只取 top-1,那么回答对不对就取决于客户问题里有没有那个「不」字,这就是为什么 top-k 一般不取 1。

</details>

**验收标准:** `neg_pair.py`、`neg_dedup.py`、`err_wording.py`、`err_keyword.py` 四个脚本都跑通,数字和文中接近(第三四位的抖动正常);能不看文章说出「否定句在检索里问题小、在去重里问题大」的原因;练习 4 三个问题全部排对;能用两句话加两个数字回答「RAG 召回不准怎么办」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 反例(counterexample) | 让一个规则或工具出错的具体例子,比如「支持 / 不支持」两句让「意思近才向量近」这条规则失灵 |
| 否定句 | 带「不、没、未、不能」等否定词的句子,embedding 对它和肯定句的区别很不敏感,实测 0.89–0.96 |
| 错误码 | 产品给每种错误起的编号,如 E1042。embedding 把它当成一串字符,E1042 和 E1043 实测 0.75 |
| 去重(dedup) | 把意思重复的条目合并只留一条,常用「相似度大于阈值算重复」来做 |
| 精确匹配 | 只看某个字符串是不是一字不差地出现,Python 里最简单的写法是 `c in text` |
| 正则表达式 / `re.findall` | 按模式找字符串的工具,`re.findall(r"E\d{4}", s)` 相当于 JS 的 `s.match(/E\d{4}/g)`,找不到返回 `[]` |
| 原始字符串 `r"..."` | 反斜杠不转义的字符串写法,写正则时用 |
| 花式下标 | numpy 用一个下标列表一次取多行,如 `vecs[[0, 2]]` |
| `np.argmax` | 返回数组里最大值的位置,不是最大值本身 |
| `any()` | 只要有一个为真就返回真,相当于 JS 的 `Array.prototype.some` |
| 混合检索(hybrid search) | 关键词检索和向量检索两路一起用再合并结果,Day 235–236 正式讲 |

## 常见误区

**以为相似度高就代表意思一样。** 「企业版支持按比例退款」和「不支持」0.906,「每月 99 元」和「999 元」0.9766。相似度高只说明两句在聊同一件事、字面很像,不说明它们断言的内容一致。

**以为否定句会让检索彻底失灵。** 检索时两句都会排进前几名,只要后面让大模型读原文,它分得清「不」字。真正危险的是不经过大模型、直接拿相似度下结论的地方:去重、FAQ 直出、「相似度大于 0.9 就当同一个问题」。

**以为换个更大更新的模型就好了。** 实测 bge-large-zh-v1.5 在两个反例上都比 bge-m3 更糟。这是单向量表示的共性,解决办法是加一路关键词检索、加 rerank,不是挑一个没有这毛病的模型。

**top-k 只取 1。** 练习 5 里前两名的分数最近只差 0.02,谁排第一取决于问题里有没有一个「不」字。只取 1 篇,另一篇连被大模型看到的机会都没有。

**精确匹配之前不做规范化。** 客户会写 `e1042`、`E 1042`、全角的 `E1042`,`re.findall(r"E\d{4}", ...)` 对前两种直接返回 `[]`。至少先 `upper()`,更多花样交给 BM25 的分词。

**左边变量个数和行数对不上。** `a, b = embed([三句话])` 报 `ValueError: too many values to unpack (expected 2)`。Python 不像 JS 解构那样默默丢掉多余的,数清楚再拆。

## 学习资料

### 文档与文章

- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval):Anthropic 官方工程文章,里面专门举了用户搜「Error code TS-999」时向量检索找不准、BM25 能精确命中的例子,和今天的 E1042 是同一个问题。今天只读「A primer on RAG」那一节讲 BM25 的几段,后半篇是 Day 241 的内容。
- [Weller 等 · On the Theoretical Limitations of Embedding-Based Retrieval(arXiv 2508.21038)](https://arxiv.org/abs/2508.21038):Google DeepMind 2025 年的论文,从理论上说明单个向量能表达的「哪些文档该一起被召回」的组合是有限的。只读摘要和引言,理解「这是方法的上限,不是某个模型没训练好」。
- [Weller 等 · NevIR: Negation in Neural Information Retrieval(arXiv 2305.07614)](https://arxiv.org/abs/2305.07614):专门测检索模型懂不懂否定的基准,结论是大部分模型在否定对上接近瞎猜。只读摘要,里面一句话就说清了做法:让检索模型给两篇只差一个否定的文档排序。
- [Python 文档 · re 模块(中文)](https://docs.python.org/zh-cn/3/library/re.html):看 `re.findall` 那一条和开头的语法表,`\d`、`{4}` 的写法和 JS 正则一样。
- [硅基流动 · 创建嵌入请求](https://docs.siliconflow.cn/docs/api/embeddings-post):练习 2 用到的 bge-large-zh-v1.5 也在这里列着,注意它单条只能 512 token。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1hdpC6PE47&autoplay=0&high_quality=1" title="RAG检索阶段,BM25和向量检索为什么互补?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵AI大模型 · RAG检索阶段,BM25和向量检索为什么互补? · 5 分钟。正好接今天的结论:向量管意思,关键词管精确。看完你就知道 Day 235 为什么要学一个「老派」的算法。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV154KE6FEnL&autoplay=0&high_quality=1" title="面试官问:BM25与向量检索核心底层区别是什么?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI应用开发入门 · 面试官问:BM25与向量检索核心底层区别是什么? · 4 分钟。面试题的讲法,和今天「面试里怎么讲」那一节对照着听,看看你能不能用自己跑出来的数字讲得更具体。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/zKohTkN0Fyk" title="[Paper Analysis] On the Theoretical Limitations of Embedding-Based Retrieval (Warning: Rant)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Yannic Kilcher · On the Theoretical Limitations of Embedding-Based Retrieval · 英文,49 分钟。对上面那篇论文的精读,作者自己说带吐槽。不用看完,看开头讲论文核心结论的部分,知道它证明了什么、没证明什么就行。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)。第 6 章「RAG and Agents」比较了基于关键词的检索和基于 embedding 的检索各自的长处,今天读这一小节。
- Doug Turnbull、John Berryman《Relevant Search》(Manning,2016)。讲关键词搜索怎么调相关性的经典书,早于 embedding 流行,但「精确匹配为什么重要、分词怎么影响结果」这些内容今天依然适用。Day 235 学 BM25 前翻翻前三章。

### 开源项目与代码

- [FlagOpen/FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding):bge-m3 的官方仓库。README 里说 bge-m3 除了今天用的稠密向量,还能输出「稀疏」的词权重,本质上就是模型自带的一路关键词匹配。硅基流动的接口只返回稠密向量,想用稀疏那一路要自己部署,了解即可。
- [dorianbrown/rank_bm25](https://github.com/dorianbrown/rank_bm25):一个很小的 Python BM25 实现,Day 235 会用到类似的东西,今天先看 README 里那十几行示例。

## 自测

**1. 「企业版支持按比例退款」和「企业版不支持按比例退款」在 bge-m3 上余弦 0.906。RAG 系统用 top-3 检索,用户问「企业版能按比例退款吗」,会出什么问题?**

<details><summary>答案</summary>

检索这一步问题不大:两句都会排进前两名(实测 0.9489 和 0.9280),大模型读到原文能看出它们互相矛盾,会根据上下文判断或者指出矛盾。真正要担心的是知识库本身为什么会同时有这两句,比如旧政策没删,这时应该修数据。如果系统只取 top-1,或者不经过大模型直接返回最像的那条,才会真的答反。

</details>

**2. 你用「相似度大于 0.9 算重复」给 500 条 FAQ 去重。为什么这个阈值看起来很保守,却仍然会删错?**

<details><summary>答案</summary>

因为反义句的相似度本来就高。实测五组肯定 / 否定句对全在 0.88 到 0.96 之间,「企业版支持按比例退款」和「不支持」0.9072,落在 0.9 以上,被当成重复删掉了。阈值保守只能防住「话题不同」的误判,防不住「话题相同、意思相反」的误判。补救办法是对高相似度的候选对做二次判断:便宜的做法是比较否定字个数,可靠的做法是交给大模型或人看。

</details>

**3. 客户问「导入银行流水报错 E1042 怎么办」,向量检索把 E1043 的文章排第一(0.7993 对 0.6509)。为什么?**

<details><summary>答案</summary>

embedding 把错误码当成一串字符,E1042 和 E1043 只差一位,向量很近(单独比较实测 0.75)。在编号几乎拉不开差距的情况下,决定分数的变成了其余文字:E1043 那篇的标题和问题前十几个字一模一样,而 E1042 那篇开门见山写解决办法,和问题的字面重合少,于是被反超。

</details>

**4. `re.findall(r"E\d{4}", "报错 e1042")` 返回什么?怎么改?**

<details><summary>答案</summary>

返回空列表 `[]`,因为正则区分大小写,`E` 匹配不到 `e`。最简单的改法是先把文本转大写:`re.findall(r"E\d{4}", text.upper())`。也可以给正则加 `re.IGNORECASE` 标志,但那样找出来的是原样的 `e1042`,和文章里的 `E1042` 做 `in` 比较时还是对不上,所以统一转大写更省事。

</details>

**5. 同事说:「bge-m3 对否定句不敏感,我们换成 bge-large-zh 就好了。」你怎么回?**

<details><summary>答案</summary>

实测不会更好。bge-large-zh-v1.5 上「支持 / 不支持」同样 0.9067,而且它和真正相关的问题只有 0.5525,反义句比相关问题高出 0.35,比 bge-m3 的 0.17 更糟;错误码那组错误文章领先也从 0.15 变成 0.23。这是「把整句话压成一个向量」的共性,不是某个模型的 bug。该做的是加关键词检索处理精确字符串、加 rerank 精排,并且让大模型读原文判断否定和数字。

</details>

**6. 面试题:「你们的 RAG 召回不准,你怎么排查和改进?」请用今天的内容回答。**

<details><summary>答案</summary>

先举具体的失败类型,不要一上来就说换模型。我会说:我测过 bge-m3,有两类问题它天生处理不好。一是否定和数字,「支持」和「不支持」余弦 0.906、「99 元」和「999 元」0.977;二是错误码这种精确字符串,客户问 E1042,措辞更像问题的 E1043 文章 0.80 对 0.65 排第一。

然后说怎么定位:建一份检索评估集,把带错误码、产品型号、否定、具体数字的问题单独标成几类,分别量 recall@k,看到底哪类拖了后腿、拖了多少。

最后说手段,对症下药:精确字符串类加 BM25 做混合检索,用 RRF 按名次合并;否定和数字类,靠 rerank 精排和让大模型读原文判断,top-k 不要只取 1;所有直接拿相似度下结论的地方(去重、FAQ 直出)加二次判断。每改一项都回到评估集上量,确认真的变好了。

</details>

## 明天预告

明天是 [Day 220 · 维度、存储、花多少钱,怎么挑模型](/blog/agent-zero/day-220-embed-cost/)。今天看到换一个模型并没有让短板消失,那到底该怎么挑 embedding 模型?明天先算三笔账:一个 1024 维的向量占多少字节,1 万篇帮助中心文章建一次索引要多少 token、多少钱,维度砍一半能省多少、会丢多少;然后学怎么读 MTEB 排行榜,以及为什么最后还是要在自己的数据上比。
