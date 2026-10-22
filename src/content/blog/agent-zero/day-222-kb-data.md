---
title: 'Day 222 · 造一份数据:CloudLedger 帮助中心'
description: '第四部分后面的切块、建索引、检索和评估,全都要用同一份资料。今天用一个脚本造出 CloudLedger 帮助中心的 20 篇 Markdown 文章,讲清每篇为什么是「frontmatter + 一级标题 + 二级小节」这个结构,再写一个检查脚本把格式错误挡在建索引之前,顺手踩三个坑:在错的目录跑、全角冒号、import 一个没有 main guard 的脚本。'
pubDate: 2026-10-22
regime: none
tags: ['rag', 'markdown', 'pathlib', 'knowledge-base', 'agent-zero']
series: 'agent-zero'
day: 222
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 221](/blog/agent-zero/day-221-why-rag/) 回答了「为什么要 RAG」:模型不知道 CloudLedger 的私有规定,直接问它只会给通用建议;资料少的时候全塞进 prompt 最省事,资料一多就装不下也付不起,所以要先「找」出相关的几段再交给模型。那天还拆出了两条流水线,索引线(读文档 → 编码 → 存起来)和查询线(编码问题 → 找 top-k → 拼 prompt → 回答),用 `toy_index.py` 和 `toy_query.py` 各跑了一遍。

不过那天的知识库是一个只有 6 句话的字典 `mini_kb.py`,每篇一两句,连「切块」这一步都省掉了。真实的帮助中心是一篇篇有标题、有小节的文章。今天就造一份像样的,后面整个第四部分都用它。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用 `part04/make_kb.py` 生成 `data/kb/` 下 20 篇 CloudLedger 帮助中心文章,说清每篇文件的三层结构:frontmatter(`id`、`title`、`category`)、一级标题、若干个 `##` 小节,以及每一层后面会被谁用到。
2. 写出 `part04/kb_check.py`,检查每篇的 frontmatter 字段齐不齐、`id` 和文件名对不对得上,数出一共 42 个小节;能用它抓住全角冒号和 id 写错这两类手工编辑的错误。
3. 说出这份数据里刻意埋的几个「考点」(长得像的错误码、三种退款情况、两个不同的天数期限),知道后面哪几天会用它们考检索。
4. 遇到「在错的目录里运行,文件写到了别处」和「import 一个脚本,它把自己的活也干了一遍」这两个坑,能马上认出来并改好。

预计用时 2 小时:看结构和手写一篇 20 分钟,敲 `make_kb.py` 40 分钟(数据多,主要是打字),检查脚本和三个坑 40 分钟,剩下做练习。前置:[Day 37](/blog/agent-zero/day-037-pathlib/) 的 `Path`、[Day 38](/blog/agent-zero/day-038-files-with/) 的文件读写和编码、[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 的元组解包、[Day 32](/blog/agent-zero/day-032-modules/) 的 `__name__`、[Day 33](/blog/agent-zero/day-033-packages/) 的 `-m` 运行,以及 [Day 221](/blog/agent-zero/day-221-why-rag/) 的两条流水线。

今天不调任何接口,API 花费 0 元。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;`make_kb.py` 里 20 篇文章的正文可以只敲前 5 篇,其余从文章复制,但函数部分必须自己敲;第二天合上文章默写 `kb_check.py` 的 `read_meta()`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么要专门造一份数据

你可能会想,网上有那么多公开数据集,随便下一份不行吗?不太行,原因有两个。

第一,公开数据集大多是英文百科、新闻或者论文摘要,和「客服回答订阅软件的退款问题」差得很远。拿维基百科练出来的感觉,搬到客服场景经常不灵。第二,也是更重要的,**你得知道每个问题的标准答案**。后面 [Day 257](/blog/agent-zero/day-257-rag-eval-3/) 要建检索评估集,要判断「用户问 E1042,检索到的是不是 kb-010」。这要求你对资料里每一条规定都心里有数。自己造的数据,每个数字都是你写下的,判对错毫不含糊。

所以从今天起,第四部分的例子都用虚构公司「云簿 CloudLedger」,一家做在线记账和订阅的 SaaS 公司。它的帮助中心 20 篇文章,覆盖套餐、退款、发票、导入导出、错误码、团队、账号安全和开放 API。

我故意把规则写得很具体:有价格、有天数、有错误码、有「仅限企业版」这种限定条件。模糊的数据测不出 RAG 的问题。比如「退款会在几天内到账」这种话,检索到哪篇都差不多对;而「支付宝 1 到 3 个工作日、银行卡 3 到 7 个工作日」,检索错一篇,答案就错了。

还有一件事要先说清楚。Day 221 的 `mini_kb.py` 是为了演示随手编的,里面「专业版年付 1200 元」「3 到 5 个工作日到账」这些数字**和今天的正式数据不一样**。正式数据里专业版年付是 468 元,用 4 个月退款也不是 800 元。`mini_kb.py` 和 `toy_*` 那几个文件到此为止,后面不再用;从今天起,一切以 `data/kb/` 为准。

## 一篇文章长什么样

先看成品。下面是 `data/kb/kb-002.md`,也就是《退款政策》,一会儿脚本生成的就是这个文件:

```markdown
---
id: kb-002
title: 退款政策
category: 退款
---

# 退款政策

## 年付套餐
年付套餐(专业版和企业版)中途取消的,按剩余的整月数比例退款。已经使用的月份和当前所在的月份不退。
例如年付专业版 468 元,折合每月 39 元。在第 3 个月中途取消,前 2 个月加当月共 3 个月不退,退剩余 9 个月,即 351 元。

## 月付套餐
月付套餐不支持中途退款。取消订阅后,当期结束时停止服务,不再续费,当期费用不退。

## 重复扣款
同一笔订阅被重复扣款的,核实后全额退还重复的那一笔,3 个工作日内原路退回。

## 审批与到账
所有退款都需要客服主管审批后执行。审批通过后原路退回,支付宝 1 到 3 个工作日到账,银行卡 3 到 7 个工作日到账。
```

<div class="line-notes">

- `---` 第一行三个短横线,frontmatter 开始。必须是文件的第一行,前面不能有空行。
- `id: kb-002` 文章编号。它是这篇文章的「身份证号」,标题可以改,编号永远不变。
- `title: 退款政策` 标题,和下面 `# 退款政策` 那行是同一个字。
- `category: 退款` 分类。20 篇一共 8 个分类,练习 1 会数。
- `---` 第二个三短横线,frontmatter 结束。
- `# 退款政策` 一级标题,一篇只有一个。
- `## 年付套餐` 二级标题,一篇文章分几个小节就有几行这样的。`kb-002` 有 4 个,是全部 20 篇里最多的。
- `例如年付专业版 468 元` 规则后面跟一个算好的例子。客服最常被问的就是「我能退多少」,有了例子,模型照着算就不容易错。
- `## 审批与到账` 第 4 个小节。到账时间按支付方式分了两种,这是专门埋的考点。

</div>

这个文件分三层,每一层都有后面的用处。

最上面两条 `---` 夹着的几行叫 **frontmatter**(前置元数据),是一种在 Markdown 文件开头写「关于这篇文章的信息」的约定,格式是 YAML 的「键: 值」。你其实天天在见:这个网站的每一篇课程文章,开头都有一段 frontmatter(`title`、`pubDate`、`day`……),Astro 读它来生成目录和页面标题;在 JS 生态里解析它的库叫 `gray-matter`。Python 里也有同类的库 `python-frontmatter`(PyPI 上 2026 年 10 月查到的最新版是 1.3.0),但我们的格式简单到自己写十行就能解析,今天不装它。

frontmatter 里的东西叫**元数据**(metadata):不是正文,而是描述正文的数据。`id` 用来引用,回答末尾标「[kb-002]」靠它,[Day 231](/blog/agent-zero/day-231-pgvector-2/) 做增量更新、判断哪篇改了也靠它。`category` 用来过滤,比如「只在退款类文章里找」([Day 234](/blog/agent-zero/day-234-filter-pitfall/))。`title` 后天切块时会拼到每一块开头。我见过不少 RAG 项目一开始只存正文,后来要按产品线过滤,只好把几十万篇文档重新导一遍。元数据在导入时就带上,成本几乎是零。

中间的 `# 退款政策` 是给人看的标题。下面的 `##` 小节才是重头:**每个小节只讲一件事**,年付、月付、重复扣款、审批到账,互不掺和。这是后天切块的依据。[Day 224](/blog/agent-zero/day-224-chunking/) 会按 `##` 把每篇切开,一个小节一块,20 篇一共 42 块。真实的帮助中心不一定这么规整,但好的帮助中心基本都是这个样子,因为人读起来也舒服。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="一篇帮助中心文章的三层结构,以及每一层后面被谁用到">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">data/kb/kb-002.md</text>
<rect x="20" y="36" width="300" height="92" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="56" fill="var(--ink-soft)">---</text>
<text x="32" y="74" fill="var(--ink)">id: kb-002</text>
<text x="32" y="92" fill="var(--ink)">title: 退款政策</text>
<text x="32" y="110" fill="var(--ink)">category: 退款</text>
<text x="200" y="56" fill="var(--ink-soft)">---</text>
<rect x="20" y="140" width="300" height="34" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="32" y="162" fill="var(--ink)"># 退款政策</text>
<rect x="20" y="186" width="300" height="128" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="208" fill="var(--ink)">## 年付套餐</text>
<text x="32" y="236" fill="var(--ink)">## 月付套餐</text>
<text x="32" y="264" fill="var(--ink)">## 重复扣款</text>
<text x="32" y="292" fill="var(--ink)">## 审批与到账</text>
<line x1="330" y1="82" x2="370" y2="82" stroke="var(--ink-faint)" marker-end="url(#m222)"/>
<text x="378" y="66" fill="var(--ink)">元数据</text>
<text x="378" y="86" fill="var(--ink-soft)" font-size="11">id → 引用 [kb-002]、增量更新</text>
<text x="378" y="104" fill="var(--ink-soft)" font-size="11">category → 按分类过滤</text>
<text x="378" y="122" fill="var(--ink-soft)" font-size="11">title → 拼到每块开头</text>
<line x1="330" y1="157" x2="370" y2="157" stroke="var(--ink-faint)" marker-end="url(#m222)"/>
<text x="378" y="161" fill="var(--ink-soft)" font-size="11">给人看的标题,一篇一个</text>
<line x1="330" y1="250" x2="370" y2="250" stroke="var(--ink-faint)" marker-end="url(#m222)"/>
<text x="378" y="232" fill="var(--ink)">小节:一节只讲一件事</text>
<text x="378" y="252" fill="var(--ink-soft)" font-size="11">Day 224 按 ## 切块</text>
<text x="378" y="270" fill="var(--ink-soft)" font-size="11">kb-002 → 4 块,20 篇 → 42 块</text>
<defs><marker id="m222" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>琥珀色是元数据,不送去 embedding,但检索结果要靠它引用和过滤;蓝色的小节是正文,后天按它切块,每块就是检索的最小单位。</figcaption>
</figure>

## 先手写一篇:三引号字符串和 write_text

20 篇一下子写出来,出错了不好找。先用一个十几行的脚本写**一篇**,看清字符串里的换行是怎么变成文件里的换行的。

在 `agent-zero-lab` 根目录新建 `part04/kb_one.py`(`part04/` 是 [Day 212](/blog/agent-zero/day-212-why-vectors/) 起放第四部分脚本的目录,Day 217 以后的脚本都在根目录用 `-m part04.xxx` 跑):

```python
# agent-zero-lab/part04/kb_one.py
from pathlib import Path

OUT = Path("data/kb_demo")
OUT.mkdir(parents=True, exist_ok=True)

body = """
## 月付套餐
月付套餐不支持中途退款。取消订阅后,当期结束时停止服务,不再续费,当期费用不退。
"""
text = f"---\nid: kb-002\ntitle: 退款政策\ncategory: 退款\n---\n\n# 退款政策\n{body}"
path = OUT / "kb-002.md"
path.write_text(text, encoding="utf-8")

print(repr(text[:40]))
print(len(text), "个字符 →", path)
```

<div class="line-notes">

- `from pathlib import Path` Day 37 学的,用对象表示路径。
- `OUT = Path("data/kb_demo")` 一个**相对路径**,相对于你运行命令时所在的目录。我们约定所有命令都在 `agent-zero-lab` 根目录跑,所以它指的是 `agent-zero-lab/data/kb_demo`。这里先写到 `kb_demo`,不碰正式目录。
- `OUT.mkdir(parents=True, exist_ok=True)` 建目录。`parents=True` 把中间缺的 `data/` 一起建出来,相当于终端的 `mkdir -p`([Day 4](/blog/agent-zero/day-004-terminal-2/));`exist_ok=True` 已经存在也不报错。两个参数都不写的话,第二次运行就会报 `FileExistsError`。
- `body = """` 三个双引号开头的字符串可以跨行,中间的换行原样保留。JS 里对应的是反引号模板字符串 `` `...` ``,只是 Python 的三引号里不能直接插变量(插变量要用 f-string)。注意开头的 `"""` 后面紧跟一个换行,所以 `body` 是以 `\n` 开头的。
- `## 月付套餐` 为了短,今天这一篇只放一个小节。
- `text = f"---\nid: kb-002` 用 f-string 拼出整篇文件。`\n` 是换行符。从左往右读:`---` 换行、`id: kb-002` 换行、`title: 退款政策` 换行、`category: 退款` 换行、`---`、两个换行(中间空一行)、`# 退款政策`、一个换行,然后接 `body`。`body` 自己以 `\n` 开头,所以标题和 `## 月付套餐` 之间又空了一行。
- `path = OUT / "kb-002.md"` `/` 拼路径,得到 `data/kb_demo/kb-002.md`。
- `path.write_text(text, encoding="utf-8")` 一次把字符串写成文件,文件不存在就新建,存在就整个覆盖。`encoding="utf-8"` 一定要写,Day 38 讲过,不写时用的是系统默认编码,在 Windows 上中文会变乱码。
- `print(repr(text[:40]))` `repr()` 把字符串「原样」显示出来,换行显示成 `\n` 而不是真的换行,看结构最清楚。相当于 JS 里 `JSON.stringify(text.slice(0, 40))`。
- `print(len(text), "个字符 →", path)` 整篇的字符数,实测 102。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.kb_one
cat data/kb_demo/kb-002.md
```

真实输出:

```text
'---\nid: kb-002\ntitle: 退款政策\ncategory: 退款\n'
102 个字符 → data/kb_demo/kb-002.md
---
id: kb-002
title: 退款政策
category: 退款
---

# 退款政策

## 月付套餐
月付套餐不支持中途退款。取消订阅后,当期结束时停止服务,不再续费,当期费用不退。
```

第一行是 `repr` 的结果,能看清前 40 个字符里每个 `\n` 在哪。下面是 `cat` 打出来的文件内容,换行已经变成了真的换行,和上一节的成品格式一致。这个 demo 目录用完就删:

```bash
rm -r data/kb_demo
```

## 造 20 篇:make_kb.py

格式验证过了,现在把 20 篇的内容写进一个列表,循环写文件。新建 `part04/make_kb.py`。代码很长,但结构很简单:上面一大段是数据,下面两个短函数。

```python
# agent-zero-lab/part04/make_kb.py
"""造 CloudLedger 帮助中心的 20 篇文章,写到 data/kb/kb-001.md … kb-020.md。内容全部虚构。"""
from pathlib import Path

OUT = Path("data/kb")

ARTICLES = [
    ("kb-001", "套餐与价格", "套餐与计费", """
## 三种套餐
CloudLedger 提供免费版、专业版和企业版三种套餐。
免费版:1 个账本,每月最多记录 200 条流水,1 名成员。
专业版:每月 49 元,或按年付 468 元(相当于每月 39 元)。最多 5 个账本,流水不限条数,最多 3 名成员,支持多币种。
企业版:每月 199 元,或按年付 1908 元。账本和成员都不限,包含开放 API、专属客服和增值税专用发票。

## 怎么选
个人记账用免费版就够了。小团队或者需要多个账本的,选专业版。需要对接自己系统、或者成员超过 3 人的,选企业版。
"""),
    ("kb-002", "退款政策", "退款", """
## 年付套餐
年付套餐(专业版和企业版)中途取消的,按剩余的整月数比例退款。已经使用的月份和当前所在的月份不退。
例如年付专业版 468 元,折合每月 39 元。在第 3 个月中途取消,前 2 个月加当月共 3 个月不退,退剩余 9 个月,即 351 元。

## 月付套餐
月付套餐不支持中途退款。取消订阅后,当期结束时停止服务,不再续费,当期费用不退。

## 重复扣款
同一笔订阅被重复扣款的,核实后全额退还重复的那一笔,3 个工作日内原路退回。

## 审批与到账
所有退款都需要客服主管审批后执行。审批通过后原路退回,支付宝 1 到 3 个工作日到账,银行卡 3 到 7 个工作日到账。
"""),
    ("kb-003", "如何申请退款", "退款", """
## 操作步骤
进入「设置 → 订阅 → 申请退款」,选择退款原因并提交。客服主管会在 1 个工作日内审批。
审批通过后进入退款流程,退款金额和到账时间见《退款政策》。

## 已经开了发票怎么办
如果这笔订单已经开具发票,需要先申请发票红冲(作废),红冲完成后才能退款。电子普通发票红冲一般当天完成,增值税专用发票需要你方配合退回或开具红字信息表。
"""),
    ("kb-004", "自动续费与扣款规则", "套餐与计费", """
## 什么时候扣款
开启自动续费的订阅,会在到期前 3 天自动扣款。

## 扣款失败
扣款失败后,系统每 24 小时重试一次,最多重试 3 次。到期后有 7 天宽限期,宽限期内所有功能正常。
宽限期结束仍未付款的,账户降为免费版。超出免费版额度的数据会保留 90 天,补缴后恢复。
"""),
    ("kb-005", "升级与降级", "套餐与计费", """
## 升级
升级立即生效。差价按当前周期剩余天数折算,只需补差价。

## 降级
降级在当前计费周期结束后生效,不退差价。降级后,超出新套餐额度的账本会变成只读,数据不会删除。
例如从专业版降到免费版,5 个账本里只有 1 个可以继续编辑,其余 4 个只读。
"""),
    ("kb-006", "发票类型与开具", "发票", """
## 可以开哪种发票
所有付费订单都可以开电子普通发票。增值税专用发票仅限企业版,或年付的专业版。

## 怎么申请
付款后 90 天内,在「账单 → 发票」里提交申请,填写抬头和税号。发票会在 1 到 2 个工作日内开出,发送到你填写的邮箱。
超过 90 天未申请的订单,不再支持开票。
"""),
    ("kb-007", "修改发票抬头", "发票", """
## 开错了怎么办
发票开具后 30 天内,可以在「账单 → 发票」里申请红冲并重新开具,每张发票只能重开一次。
超过 30 天的,需要联系客服,并提供加盖公章的情况说明。
"""),
    ("kb-008", "优惠码使用规则", "套餐与计费", """
## 使用方法
在结算页面输入优惠码即可。每笔订单只能使用一个优惠码,不能叠加。
优惠码不适用于企业版。

## 退款时怎么算
使用优惠码的订单退款时,按实际支付的金额退款,优惠部分不退现金。
"""),
    ("kb-009", "导入银行流水", "数据导入导出", """
## 支持的格式
支持 CSV 和 XLSX 文件。单个文件不超过 10 MB,不超过 5 万行。
工商银行、招商银行、建设银行网银导出的流水文件可以自动识别格式,其他银行请使用模板。

## 模板字段
模板包含四列:日期、金额、对方户名、摘要。日期格式必须是 YYYY-MM-DD,金额支出为负数。
"""),
    ("kb-010", "错误码 E1042:银行流水导入失败", "错误码", """
## 原因
E1042 表示文件的列名和模板不匹配,或者日期列的格式不是 YYYY-MM-DD。最常见的情况是 Excel 自动把日期转成了 2026/10/1 这种格式。

## 解决办法
下载最新的导入模板,把日期列的单元格格式设置为「文本」,重新填写日期后再导入。
"""),
    ("kb-011", "错误码 E1043:文件编码错误", "错误码", """
## 原因
E1043 表示文件不是 UTF-8 编码。用 Excel 直接另存为 CSV 时,默认编码通常是 GBK,就会出现这个错误。

## 解决办法
在 Excel 里选择「另存为 → CSV UTF-8(逗号分隔)」,或者直接上传 XLSX 文件。
"""),
    ("kb-012", "错误码 E2017:发票识别失败", "错误码", """
## 原因
E2017 表示发票图片无法识别。常见原因有三个:图片模糊,图片短边分辨率低于 1000 像素,或者上传的 PDF 文件设置了密码。

## 解决办法
重新拍摄清晰的照片,或上传发票原始 PDF。加密的 PDF 需要先去掉密码。识别失败的发票也可以手动录入。
"""),
    ("kb-013", "错误码 E3001:支付失败", "错误码", """
## 原因
E3001 表示支付渠道拒绝了这笔付款,常见原因是银行卡余额不足、超过单笔限额,或者银行风控拦截。

## 解决办法
更换银行卡或改用支付宝支付。同一账户连续 5 次支付失败,会锁定支付功能 1 小时。
"""),
    ("kb-014", "导出数据和报表", "数据导入导出", """
## 导出格式
支持导出 CSV、Excel 和 PDF 报表。

## 次数限制
免费版每天可以导出 1 次,专业版和企业版每天 20 次。
超过 10 万行的导出会在后台异步生成,完成后发送下载链接到你的邮箱,链接 7 天内有效。
"""),
    ("kb-015", "团队成员与权限", "团队与权限", """
## 角色
团队有三种角色:管理员可以管理账单和成员;记账员可以新增和修改流水;只读成员只能查看和导出。

## 人数上限
免费版只有 1 名成员,专业版最多 3 名,企业版不限。

## 邀请成员
在「设置 → 团队」生成邀请链接,链接 7 天内有效,过期需要重新生成。
"""),
    ("kb-016", "账号安全与两步验证", "账号与安全", """
## 两步验证
支持短信验证码和验证器 App 两种方式,建议开启。

## 更换手机号
在「设置 → 账号」里更换手机号,需要旧手机号接收验证码。旧手机号已经不用了的,可以提交人工审核,上传身份证明,2 个工作日内处理。
"""),
    ("kb-017", "注销账号", "账号与安全", """
## 注销流程
在「设置 → 账号 → 注销账号」提交申请。提交后有 30 天冷静期,期间可以随时撤销。
有未结束的付费订阅时,需要先取消订阅才能注销。

## 数据处理
冷静期结束后账号正式注销,所有数据在 30 天后永久删除,无法恢复。
"""),
    ("kb-018", "数据安全与备份", "账号与安全", """
## 数据存在哪
所有数据存储在中国大陆杭州的数据中心,传输全程 TLS 加密。

## 备份
每天自动备份,备份保留 30 天。
企业版客户误删数据后,可以申请从备份恢复,每次收费 500 元。其他套餐不提供备份恢复服务。
"""),
    ("kb-019", "开放 API", "开发者", """
## 谁能用
开放 API 仅对企业版开放。在「设置 → 开发者」创建 API Key。

## 速率限制
每个 API Key 每分钟最多 60 次请求。超过限制会返回 HTTP 429,错误码 E4029,请等待一分钟后重试。
"""),
    ("kb-020", "多币种记账", "套餐与计费", """
## 支持范围
专业版和企业版支持多币种记账,共支持 30 种货币。

## 汇率
汇率每天早上 8 点更新,数据来源是中国银行外汇牌价。你也可以在单笔流水上手动修改汇率。
"""),
]


def render(doc_id: str, title: str, category: str, body: str) -> str:
    return f"---\nid: {doc_id}\ntitle: {title}\ncategory: {category}\n---\n\n# {title}\n{body}"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for doc_id, title, category, body in ARTICLES:
        (OUT / f"{doc_id}.md").write_text(render(doc_id, title, category, body), encoding="utf-8")
    print(f"写入 {len(ARTICLES)} 篇到 {OUT}")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `"""造 CloudLedger 帮助中心的 20 篇文章` 文件开头的三引号字符串是**文档字符串**(docstring),说明这个文件是干什么的,相当于 JS 文件顶部的 `/** ... */` 注释。
- `OUT = Path("data/kb")` 正式目录。后面所有用到帮助中心的脚本都读这个相对路径,所以都要在 `agent-zero-lab` 根目录运行。
- `ARTICLES = [` 一个列表,里面 20 个元组。每个元组 4 个元素:`(编号, 标题, 分类, 正文)`。相当于 TS 里的 `Array<[string, string, string, string]>`。
- `("kb-001", "套餐与价格", "套餐与计费", """` 第一篇。正文用三引号,里面直接换行。
- `专业版:每月 49 元,或按年付 468 元` 后面很多问题都要用到的价格。年付 468 ÷ 12 = 39,所以括号里写「相当于每月 39 元」。
- `("kb-002", "退款政策", "退款", """` 上一节看过的那篇,4 个小节。
- `("kb-003", "如何申请退款", "退款", """` 和 kb-002 都在「退款」分类下,但讲的是操作步骤。「已经开了发票怎么办」这一节把退款和发票两个话题连在一起,是后面多跳问题的素材。
- `("kb-004", "自动续费与扣款规则"` 「到期前 3 天扣款、重试 3 次、7 天宽限期、数据保留 90 天」,四个数字挤在一篇里,很容易答串。
- `("kb-006", "发票类型与开具"` 「付款后 90 天内申请」。
- `("kb-007", "修改发票抬头"` 「开具后 30 天内可以红冲重开」。90 天和 30 天是两个不同的期限,问「发票能改吗」时检索到 kb-006 就会答错。全部 20 篇里只有这一篇只有 1 个小节。
- `("kb-010", "错误码 E1042:银行流水导入失败"` 标题里有冒号,但冒号后面没有空格。记住这一点,一会儿解析 frontmatter 时用得上。
- `("kb-011", "错误码 E1043:文件编码错误"` 和 kb-010 只差一位数字。[Day 219](/blog/agent-zero/day-219-embed-limits/) 已经证明 embedding 分不太清这种编号。
- `## 原因` kb-010 到 kb-013 四篇错误码文章,小节标题都是「原因」和「解决办法」。这一点练习 2 会数出来,后天切块时它会带来一个具体的问题。
- `("kb-015", "团队成员与权限"` 3 个小节,小节数第二多。
- `("kb-019", "开放 API"` 「每分钟最多 60 次」「HTTP 429」「E4029」,这篇里的错误码不在标题里,只在正文里。
- `("kb-020", "多币种记账"` 最后一篇。
- `def render(doc_id: str, title: str, category: str, body: str) -> str:` 把一个元组的四样东西拼成文件内容。格式和 `kb_one.py` 里那一行完全一样,只是写成了函数。
- `def main() -> None:` 真正干活的函数。
- `OUT.mkdir(parents=True, exist_ok=True)` 同 `kb_one.py`,第一次运行会建出 `data/` 和 `data/kb/`。
- `for doc_id, title, category, body in ARTICLES:` 循环时直接把元组拆成 4 个变量(Day 22 的解包,相当于 JS 的 `for (const [docId, title, category, body] of ARTICLES)`)。第二轮拿到的就是 `doc_id="kb-002"`、`title="退款政策"`、`category="退款"`。
- `(OUT / f"{doc_id}.md").write_text(` 文件名就是编号:`kb-001.md` 到 `kb-020.md`。编号和文件名一致,一会儿的检查脚本会核对这一点。
- `print(f"写入 {len(ARTICLES)} 篇到 {OUT}")` 实跑输出 `写入 20 篇到 data/kb`。
- `if __name__ == "__main__":` Day 32 学的 main guard:直接运行这个文件时才调用 `main()`,被别的文件 import 时不调用。一会儿你会看到少了它会怎样。

</div>

```bash
uv run python -m part04.make_kb
ls data/kb | head -3
ls data/kb | wc -l
wc -m data/kb/*.md | tail -1
```

真实输出:

```text
写入 20 篇到 data/kb
kb-001.md
kb-002.md
kb-003.md
      20
    4070 total
```

`wc -m` 数字符数(`-c` 数的是字节,一个汉字在 UTF-8 里占 3 个字节,会大很多)。20 篇一共 4070 个字符,包括 frontmatter。按 [Day 220](/blog/agent-zero/day-220-embed-cost/) 测的中文每字 0.7 到 0.9 个 token 算,大约三千来个 token。是的,这份知识库小到可以直接全塞进 prompt,Day 221 说过这种规模全塞最省事。我们还是要拿它练 RAG,因为它小,每一步的结果你都能用眼睛核对;规模变大以后要处理的问题(增量更新、过滤、评估)第四部分后面会一个个讲。

这个脚本可以随便重复跑,每次都把 20 个文件覆盖成同样的内容。想改某条规定,**改 `make_kb.py` 里的数据再重跑**,不要直接去改 `data/kb/` 下的文件,否则下次重跑你的修改就被覆盖了。

## 刻意埋下的考点

数据是为了考检索才造的,所以有几处我故意写得容易混。先用 Day 5 学的 `grep` 看两组:

```bash
grep -rn "E104" data/kb
```

真实输出:

```text
data/kb/kb-010.md:3:title: 错误码 E1042:银行流水导入失败
data/kb/kb-010.md:7:# 错误码 E1042:银行流水导入失败
data/kb/kb-010.md:10:E1042 表示文件的列名和模板不匹配,或者日期列的格式不是 YYYY-MM-DD。最常见的情况是 Excel 自动把日期转成了 2026/10/1 这种格式。
data/kb/kb-011.md:3:title: 错误码 E1043:文件编码错误
data/kb/kb-011.md:7:# 错误码 E1043:文件编码错误
data/kb/kb-011.md:10:E1043 表示文件不是 UTF-8 编码。用 Excel 直接另存为 CSV 时,默认编码通常是 GBK,就会出现这个错误。
```

`-r` 是在整个目录里递归找,`-n` 是显示行号。两篇错误码文章,标题和正文只差一位数字,讲的却是完全不同的两件事:一个是日期格式,一个是文件编码,而且两篇都提到了 Excel。

```bash
grep -rn "90 天\|30 天" data/kb
```

真实输出:

```text
data/kb/kb-018.md:13:每天自动备份,备份保留 30 天。
data/kb/kb-006.md:13:付款后 90 天内,在「账单 → 发票」里提交申请,填写抬头和税号。发票会在 1 到 2 个工作日内开出,发送到你填写的邮箱。
data/kb/kb-006.md:14:超过 90 天未申请的订单,不再支持开票。
data/kb/kb-007.md:10:发票开具后 30 天内,可以在「账单 → 发票」里申请红冲并重新开具,每张发票只能重开一次。
data/kb/kb-007.md:11:超过 30 天的,需要联系客服,并提供加盖公章的情况说明。
data/kb/kb-017.md:10:在「设置 → 账号 → 注销账号」提交申请。提交后有 30 天冷静期,期间可以随时撤销。
data/kb/kb-017.md:14:冷静期结束后账号正式注销,所有数据在 30 天后永久删除,无法恢复。
data/kb/kb-004.md:14:宽限期结束仍未付款的,账户降为免费版。超出免费版额度的数据会保留 90 天,补缴后恢复。
```

`\|` 是 grep 里「或」的写法。90 天和 30 天在五篇文章里出现了八次,意思各不相同。注意输出的顺序不是按文件名排的,`grep -r` 按文件系统给它的顺序走,这一点和后天要讲的 `sorted()` 有关。

我把埋的考点整理成一张表。后面检索出错时,先回来对照这张表,看是不是踩中了其中一个:

| 考点 | 在哪几篇 | 容易出的错 | 哪天会考 |
| --- | --- | --- | --- |
| 两个错误码只差一位 | kb-010 / kb-011 | 问 E1042 检索到 E1043 | Day 219 已演示,混合检索那几天再考 |
| 三种退款情况 | kb-002 的前三节 | 把年付规则答给月付用户 | 切块、检索 |
| 退款要先红冲发票 | kb-003 + kb-006/007 | 只答退款步骤,漏掉发票 | 多跳问题 |
| 90 天开票 vs 30 天重开 | kb-006 / kb-007 | 问「发票能改吗」答成 90 天 | 检索评估 |
| 「仅限企业版」 | kb-006、kb-018、kb-019 | 对专业版用户说可以 | 过滤、拒答 |
| 两种到账时间 | kb-002「审批与到账」 | 不分支付宝和银行卡 | 生成 |
| 错误码只在正文里 | kb-019 的 E4029 | 只按标题找错误码会漏掉 | 精确匹配 |

这份退款规则和第五部分 CloudLedger MCP server([Day 280](/blog/agent-zero/day-280-mcp-seed/) 起)里的退款工具是同一套,第六部分的评测也按它判。所以数据一旦定下来,别随手改里面的数字。

## 写一个检查脚本

20 篇现在是脚本生成的,格式肯定整齐。但真实的帮助中心是人写的,有人在网页后台编辑,有人直接改 Markdown 文件。格式错误一旦混进索引线,轻则那篇搜不到,重则整条索引线在半夜报错。所以索引之前,先跑一遍检查。

新建 `part04/kb_check.py`。注意这一版我**故意没写 main guard**,原因一会儿揭晓:

```python
# agent-zero-lab/part04/kb_check.py
"""检查 data/kb/ 里每篇文章的结构:frontmatter 三个字段齐不齐、id 和文件名对不对得上、有几个小节。"""
import sys
from pathlib import Path

KB = Path("data/kb")
REQUIRED = ("id", "title", "category")


def read_meta(text: str) -> dict[str, str]:
    lines = text.splitlines()
    if lines[0] != "---":
        raise ValueError("第一行不是 ---")
    end = lines.index("---", 1)
    meta: dict[str, str] = {}
    for line in lines[1:end]:
        key, sep, value = line.partition(": ")
        if not sep:
            raise ValueError(f"这一行不是「键: 值」: {line!r}")
        meta[key] = value
    return meta


paths = sorted(KB.glob("*.md"))
problems = 0
total_chars = 0
for path in paths:
    text = path.read_text(encoding="utf-8")
    total_chars += len(text)
    try:
        meta = read_meta(text)
    except ValueError as e:
        print(f"✗ {path.name}: {e}")
        problems += 1
        continue
    missing = [k for k in REQUIRED if k not in meta]
    if missing:
        print(f"✗ {path.name}: 缺字段 {missing}")
        problems += 1
        continue
    if meta["id"] != path.stem:
        print(f"✗ {path.name}: id 写的是 {meta['id']}")
        problems += 1
        continue
    sections = sum(1 for line in text.splitlines() if line.startswith("## "))
    print(f"{meta['id']}  {sections} 节  {len(text):>3} 字符  [{meta['category']}] {meta['title']}")

print(f"--- 共 {len(paths)} 篇,{total_chars} 字符,问题 {problems} 个")
sys.exit(1 if problems else 0)
```

<div class="line-notes">

- `import sys` 最后要用 `sys.exit` 设置退出码。
- `KB = Path("data/kb")` 和 `make_kb.py` 的 `OUT` 是同一个目录。
- `REQUIRED = ("id", "title", "category")` 三个必须有的字段,用元组是因为它不会被改。
- `def read_meta(text: str) -> dict[str, str]:` 输入整篇文件的内容,返回 frontmatter 变成的字典,比如 `{"id": "kb-002", "title": "退款政策", "category": "退款"}`。
- `lines = text.splitlines()` 按行切成列表。`kb-002.md` 切出 20 行,`lines[0]` 是 `"---"`。
- `if lines[0] != "---":` 第一行必须是 `---`,否则这篇根本没有 frontmatter。
- `raise ValueError("第一行不是 ---")` Day 36 学的主动抛异常。不在这里 `print`,而是抛出去,让调用的人决定怎么处理。
- `end = lines.index("---", 1)` 从第 1 行(第二行)开始找下一个 `"---"`,得到 frontmatter 结束的行号。`kb-002.md` 里是 4。相当于 JS 的 `lines.indexOf("---", 1)`,区别是 Python 找不到时直接抛 `ValueError`,JS 返回 `-1`。
- `for line in lines[1:end]:` 取第 1 到第 3 行,也就是 `id: kb-002`、`title: 退款政策`、`category: 退款` 这三行。切片不包括 `end` 本身。
- `key, sep, value = line.partition(": ")` `partition` 在**第一个** `": "` 处把字符串切成三段:前面、分隔符本身、后面。`"title: 退款政策"` 得到 `("title", ": ", "退款政策")`。找不到分隔符时它也一定返回三段,只是后两段是空字符串:`("title：退款政策", "", "")`。这比 `split(": ")` 稳,`split` 遇到一行里有两个 `": "` 会切出三段,解包就报错。
- `if not sep:` 分隔符是空字符串,说明这一行不是「键: 值」的格式。kb-010 的标题 `错误码 E1042:银行流水导入失败` 里也有冒号,但后面没有空格,所以不会被当成分隔符;`title: ` 后面那个才是。
- `raise ValueError(f"这一行不是「键: 值」: {line!r}")` `{line!r}` 是 f-string 里的 `repr` 写法,会给字符串加上引号,空格、全角字符看得清楚。
- `meta[key] = value` 存进字典。
- `paths = sorted(KB.glob("*.md"))` `glob("*.md")` 找出目录里所有 `.md` 文件,`sorted` 按文件名排序,保证每次输出顺序一样(刚才 `grep -r` 的顺序就是乱的)。
- `problems = 0` 有问题的文章数。
- `except ValueError as e:` 抓住 `read_meta` 抛出来的错,打印出来,接着检查下一篇,而不是一篇出错整个脚本就停。
- `continue` 跳过这一篇剩下的检查,进入下一轮循环。
- `missing = [k for k in REQUIRED if k not in meta]` Day 23 的列表推导式:三个必填字段里,哪些不在字典里。全齐时是 `[]`。
- `if meta["id"] != path.stem:` `path.stem` 是去掉后缀的文件名,`kb-002.md` 的 stem 是 `"kb-002"`。编号和文件名不一致,说明有人复制了一篇文章改内容却忘了改编号,这在真实项目里非常常见,而它会让两篇文章抢同一个 id。
- `sections = sum(1 for line in text.splitlines() if line.startswith("## "))` 数以 `## ` 开头的行,也就是小节数。`sum(1 for ...)` 是 Python 里「数一数满足条件的有几个」的惯用写法,相当于 JS 的 `lines.filter(l => l.startsWith("## ")).length`。注意 `"## "` 后面有空格,不会把 `###` 三级标题算进来。
- `print(f"{meta['id']}  {sections} 节  {len(text):>3} 字符` `:>3` 是右对齐占 3 格,让字符数那一列对齐。
- `sys.exit(1 if problems else 0)` 有问题退出码 1,没问题 0。退出码是给别的程序看的:以后把检查接进 CI 或 Makefile,退出码非 0 就会中止后面的建索引。

</div>

```bash
uv run python -m part04.kb_check
echo "exit=$?"
```

真实输出:

```text
kb-001  2 节  318 字符  [套餐与计费] 套餐与价格
kb-002  4 节  353 字符  [退款] 退款政策
kb-003  2 节  233 字符  [退款] 如何申请退款
kb-004  2 节  208 字符  [套餐与计费] 自动续费与扣款规则
kb-005  2 节  188 字符  [套餐与计费] 升级与降级
kb-006  2 节  204 字符  [发票] 发票类型与开具
kb-007  1 节  144 字符  [发票] 修改发票抬头
kb-008  2 节  159 字符  [套餐与计费] 优惠码使用规则
kb-009  2 节  212 字符  [数据导入导出] 导入银行流水
kb-010  2 节  218 字符  [错误码] 错误码 E1042:银行流水导入失败
kb-011  2 节  208 字符  [错误码] 错误码 E1043:文件编码错误
kb-012  2 节  214 字符  [错误码] 错误码 E2017:发票识别失败
kb-013  2 节  182 字符  [错误码] 错误码 E3001:支付失败
kb-014  2 节  181 字符  [数据导入导出] 导出数据和报表
kb-015  3 节  199 字符  [团队与权限] 团队成员与权限
kb-016  2 节  178 字符  [账号与安全] 账号安全与两步验证
kb-017  2 节  177 字符  [账号与安全] 注销账号
kb-018  2 节  175 字符  [账号与安全] 数据安全与备份
kb-019  2 节  174 字符  [开发者] 开放 API
kb-020  2 节  145 字符  [套餐与计费] 多币种记账
--- 共 20 篇,4070 字符,问题 0 个
exit=0
```

把「节」那一列加起来:kb-002 是 4 节,kb-015 是 3 节,kb-007 是 1 节,剩下 17 篇都是 2 节,一共 4 + 3 + 1 + 17 × 2 = 42。这就是后天切块要切出的块数,先记住。最长的一篇 353 个字符,最短的 144 个,都很短。

## 故意踩坑一:手工改文件时打了全角冒号

现在模拟一个同事直接编辑了文件。打开 `data/kb/kb-007.md`,把 `title: 修改发票抬头` 里的英文冒号和空格换成中文输入法打出来的全角冒号 `：`;再打开 `data/kb/kb-013.md`,把 `id: kb-013` 改成 `id: kb-031`(手滑把两位数字打反了)。改完再检查:

```bash
uv run python -m part04.kb_check | grep -v "^kb-"
echo "exit=${pipestatus[1]}"
```

`grep -v "^kb-"` 把正常的那些行过滤掉,只看出问题的行和最后一行汇总。因为中间隔了一个管道,`$?` 拿到的是 grep 的退出码;zsh 里要用 `${pipestatus[1]}` 拿管道里第一个命令(也就是 Python 脚本)的退出码。

真实输出:

```text
✗ kb-007.md: 这一行不是「键: 值」: 'title：修改发票抬头'
✗ kb-013.md: id 写的是 kb-031
--- 共 20 篇,4069 字符,问题 2 个
exit=1
```

两处都抓住了。全角冒号在屏幕上和 `: ` 很难分清,这正是 `{line!r}` 带引号显示的价值:你能看到冒号后面没有空格,字形也不一样。字符数少了 1,是因为两个字符 `: ` 换成了一个 `：`。

如果没有这道检查会怎样?kb-007 的 `title` 键根本不存在,后天切块时 `meta["title"]` 会直接 `KeyError`;kb-013 的块会被编成 `kb-031#1`,引用时用户点过去是一篇不存在的文章。前者至少会报错,后者完全安静。

修好的办法不是去手改文件,而是重跑生成脚本,让数据回到唯一的来源:

```bash
uv run python -m part04.make_kb
uv run python -m part04.kb_check | tail -1
```

真实输出:

```text
写入 20 篇到 data/kb
--- 共 20 篇,4070 字符,问题 0 个
```

## 故意踩坑二:在错的目录里运行

`OUT = Path("data/kb")` 是相对路径,相对于你**运行命令时所在的目录**,不是相对于脚本文件所在的目录。在前端里你也遇到过同样的事:Node 里 `fs.writeFileSync("data/x.json")` 写到 `process.cwd()` 下面,而不是脚本旁边。

试一下进到 `part04/` 里面直接运行:

```bash
cd part04
uv run python make_kb.py
ls data/kb | head -3
cd ..
```

真实输出:

```text
写入 20 篇到 data/kb
kb-001.md
kb-002.md
kb-003.md
```

没有任何报错,输出看着也一模一样。但文件写到了 `part04/data/kb/` 下面,而不是 `agent-zero-lab/data/kb/`。如果你在 `part04/` 里改了数据、重跑,再回根目录建索引,索引用的还是旧数据,而且你会花很久才想明白为什么。

这个脚本恰好没有 import `common` 或 `part04` 里的东西,所以在子目录里也跑得起来;那些 import 了的脚本,在子目录里直接跑会报 `ModuleNotFoundError: No module named 'part04'`,反而容易发现。修法就是一条纪律:**所有命令都在 `agent-zero-lab` 根目录用 `uv run python -m part04.xxx` 跑**([Day 33](/blog/agent-zero/day-033-packages/))。把误写出来的目录删掉:

```bash
rm -r part04/data
```

另一种做法是在脚本里用 `Path(__file__).resolve().parent.parent / "data" / "kb"` 算出绝对路径,在哪跑都写到同一个地方。旧版课程就是这么写的。新课统一用「根目录 + `-m`」的约定,和 Day 221 的 `Path("part04/toy_index")` 一致,后面的脚本也都这样。

## 故意踩坑三:import 一个没有 main guard 的脚本

写练习时我想数一数每个分类有几篇,`read_meta()` 已经写好了,自然想 import 它。新建 `part04/ex_kb_category.py`(练习 1 的参考答案就是它):

```python
# agent-zero-lab/part04/ex_kb_category.py
from pathlib import Path

from part04.kb_check import read_meta

counts: dict[str, list[str]] = {}
for path in sorted(Path("data/kb").glob("*.md")):
    meta = read_meta(path.read_text(encoding="utf-8"))
    counts.setdefault(meta["category"], []).append(meta["id"])

for category, ids in sorted(counts.items(), key=lambda kv: -len(kv[1])):
    print(f"{category:<8} {len(ids)} 篇  {' '.join(ids)}")
```

跑一下:

```bash
uv run python -m part04.ex_kb_category | tail -2
echo "exit=${pipestatus[1]}"
```

真实输出:

```text
kb-020  2 节  145 字符  [套餐与计费] 多币种记账
--- 共 20 篇,4070 字符,问题 0 个
exit=0
```

打出来的是 `kb_check.py` 的表,我们自己的分类统计一行都没有,退出码还是 0。发生了什么?`from part04.kb_check import read_meta` 这一行会**从头到尾执行一遍** `kb_check.py`([Day 32](/blog/agent-zero/day-032-modules/) 讲过,import 就是运行那个文件)。它顶层的循环把 20 篇检查了一遍、打了表,最后一行 `sys.exit(0)` 直接把整个程序结束了。我们的代码还没来得及跑。

JS 里也有一样的事:`import "./check.js"` 会执行那个文件顶层的所有语句。只是 JS 模块很少在顶层写 `process.exit()`,所以没这么显眼。

修法就是 main guard:把「干活」的部分收进 `main()`,只在直接运行时调用。改好的 `part04/kb_check.py` 后半段:

```python
# agent-zero-lab/part04/kb_check.py(后半段,read_meta 不变)
def main() -> int:
    paths = sorted(KB.glob("*.md"))
    problems = 0
    total_chars = 0
    for path in paths:
        text = path.read_text(encoding="utf-8")
        total_chars += len(text)
        try:
            meta = read_meta(text)
        except ValueError as e:
            print(f"✗ {path.name}: {e}")
            problems += 1
            continue
        missing = [k for k in REQUIRED if k not in meta]
        if missing:
            print(f"✗ {path.name}: 缺字段 {missing}")
            problems += 1
            continue
        if meta["id"] != path.stem:
            print(f"✗ {path.name}: id 写的是 {meta['id']}")
            problems += 1
            continue
        sections = sum(1 for line in text.splitlines() if line.startswith("## "))
        print(f"{meta['id']}  {sections} 节  {len(text):>3} 字符  [{meta['category']}] {meta['title']}")

    print(f"--- 共 {len(paths)} 篇,{total_chars} 字符,问题 {problems} 个")
    return problems


if __name__ == "__main__":
    sys.exit(1 if main() else 0)
```

<div class="line-notes">

- `def main() -> int:` 原来顶层的循环原封不动地缩进到这个函数里,返回有问题的篇数。
- `return problems` 原来的 `sys.exit` 改成返回值。函数只负责算,退不退出交给调用它的人。
- `if __name__ == "__main__":` 用 `-m part04.kb_check` 直接运行时,`__name__` 是 `"__main__"`,条件成立;被 import 时,`__name__` 是 `"part04.kb_check"`,下面这行不会执行。
- `sys.exit(1 if main() else 0)` 直接运行时行为和原来一样。

</div>

函数上面的 `read_meta` 不用动。再跑两次:

```bash
uv run python -m part04.kb_check | tail -1
uv run python -m part04.ex_kb_category
```

真实输出:

```text
--- 共 20 篇,4070 字符,问题 0 个
套餐与计费    5 篇  kb-001 kb-004 kb-005 kb-008 kb-020
错误码      4 篇  kb-010 kb-011 kb-012 kb-013
账号与安全    3 篇  kb-016 kb-017 kb-018
退款       2 篇  kb-002 kb-003
发票       2 篇  kb-006 kb-007
数据导入导出   2 篇  kb-009 kb-014
团队与权限    1 篇  kb-015
开发者      1 篇  kb-019
```

这回对了。我的习惯是,凡是 `part04/` 下面以后可能被 import 的脚本,一开始就写 main guard,`make_kb.py` 也是这样。`kb_check.py` 第一版没写,是为了让你看一次这个坑。

## 动手练习

**练习 1:数一数每个分类有几篇。** 读 `data/kb/` 下全部文章,按 `category` 分组,打印每组的篇数和编号,篇数多的排前面。复用 `kb_check.py` 的 `read_meta`。

<details><summary>参考答案</summary>

就是上一节的 `part04/ex_kb_category.py`(前提是 `kb_check.py` 已经改成带 main guard 的版本):

```python
# agent-zero-lab/part04/ex_kb_category.py
from pathlib import Path

from part04.kb_check import read_meta

counts: dict[str, list[str]] = {}
for path in sorted(Path("data/kb").glob("*.md")):
    meta = read_meta(path.read_text(encoding="utf-8"))
    counts.setdefault(meta["category"], []).append(meta["id"])

for category, ids in sorted(counts.items(), key=lambda kv: -len(kv[1])):
    print(f"{category:<8} {len(ids)} 篇  {' '.join(ids)}")
```

<div class="line-notes">

- `from part04.kb_check import read_meta` 只 import 函数。`kb_check.py` 有 main guard 之后,这一行不会再触发检查。
- `counts: dict[str, list[str]] = {}` 键是分类名,值是这个分类下的编号列表。类型标注是 [Day 46](/blog/agent-zero/day-046-type-hints-2/) 学的写法。
- `for path in sorted(Path("data/kb").glob("*.md")):` 20 篇按文件名顺序读。
- `meta = read_meta(path.read_text(encoding="utf-8"))` 第一轮拿到 `{"id": "kb-001", "title": "套餐与价格", "category": "套餐与计费"}`。
- `counts.setdefault(meta["category"], []).append(meta["id"])` `setdefault(键, 默认值)`:键不存在就先放进默认值 `[]`,再返回这个键对应的值。所以这一行等于「没有这个分类就建一个空列表,然后把编号追加进去」。JS 里要写成 `(counts[c] ??= []).push(id)`。
- `sorted(counts.items(), key=lambda kv: -len(kv[1]))` `items()` 得到 `(分类, 编号列表)` 的元组;按列表长度取负数排序,就是从多到少。长度相同时保持原来出现的顺序(Python 的排序是稳定的),所以「退款」排在「发票」前面。
- `print(f"{category:<8} {len(ids)} 篇` `:<8` 左对齐占 8 格。你会发现输出里那一列并没有对齐:Python 按**字符**数补空格,而一个汉字在终端里占两个英文字符的宽度。真要对齐中文得按显示宽度算,打日志时不值得费这个劲。

</div>

真实输出见上一节:8 个分类,「套餐与计费」5 篇最多,「团队与权限」和「开发者」各 1 篇。

</details>

**练习 2:哪些小节标题重复了?** 统计全部文章里所有 `## ` 开头的小节标题,打印小节总数、不同标题的个数,以及出现超过一次的标题和它们所在的文章。然后想一想:后天按小节切块时,这些重复的标题会带来什么问题?

<details><summary>参考答案</summary>

新建 `part04/ex_kb_sections.py`:

```python
# agent-zero-lab/part04/ex_kb_sections.py
from pathlib import Path

where: dict[str, list[str]] = {}
for path in sorted(Path("data/kb").glob("*.md")):
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            where.setdefault(line[3:], []).append(path.stem)

print("小节总数:", sum(len(v) for v in where.values()), " 不同的小节标题:", len(where))
for section, ids in where.items():
    if len(ids) > 1:
        print(f"「{section}」出现 {len(ids)} 次: {' '.join(ids)}")
```

<div class="line-notes">

- `where: dict[str, list[str]] = {}` 键是小节标题,值是出现在哪几篇。
- `for line in path.read_text(encoding="utf-8").splitlines():` 逐行看。
- `if line.startswith("## "):` 只要二级标题。
- `where.setdefault(line[3:], []).append(path.stem)` `line[3:]` 去掉开头的 `"## "` 三个字符,`"## 原因"` 变成 `"原因"`。
- `print("小节总数:", sum(len(v) for v in where.values())` 把每个标题出现的次数加起来,就是小节总数。
- `if len(ids) > 1:` 只打印重复的。

</div>

```bash
uv run python -m part04.ex_kb_sections
```

真实输出:

```text
小节总数: 42  不同的小节标题: 36
「原因」出现 4 次: kb-010 kb-011 kb-012 kb-013
「解决办法」出现 4 次: kb-010 kb-011 kb-012 kb-013
```

42 个小节,和检查脚本数的一样。四篇错误码文章的小节都叫「原因」和「解决办法」。问题在这里:如果切块时每块只保留小节里的正文,kb-012「解决办法」那一块的内容是「重新拍摄清晰的照片,或上传发票原始 PDF……」,里面**一个字都没提 E2017**。客户问「E2017 怎么解决」,这一块的向量里没有任何关于 E2017 的信息。后天的修法是给每块开头拼上「文章标题 > 小节标题」,到时候会用 embedding 实测加和不加的差别。

</details>

**练习 3:删掉一篇文章,目录里却还在。** 在 `make_kb.py` 的 `ARTICLES` 末尾临时加一篇 kb-021(随便写一个小节),运行生成和检查;然后把这篇从列表里删掉,再运行一次。观察 `data/kb/` 里有几个文件,并修好 `make_kb.py`。

<details><summary>参考答案</summary>

我加的是这一篇:

```python
    ("kb-021", "账本归档", "套餐与计费", """
## 怎么归档
在「设置 → 账本」里选择归档。归档后的账本只读,不占套餐的账本数量。
"""),
```

加上以后跑:

```bash
uv run python -m part04.make_kb
uv run python -m part04.kb_check | tail -2
```

```text
写入 21 篇到 data/kb
kb-021  1 节  100 字符  [套餐与计费] 账本归档
--- 共 21 篇,4170 字符,问题 0 个
```

从列表里删掉 kb-021 再跑同样两条命令:

```text
写入 20 篇到 data/kb
kb-021  1 节  100 字符  [套餐与计费] 账本归档
--- 共 21 篇,4170 字符,问题 0 个
```

生成脚本说写了 20 篇,目录里却还是 21 篇。`write_text` 只会新建和覆盖,不会删除;kb-021.md 是上一次留下来的「孤儿文件」。真实场景里它对应的是「帮助中心下线了一篇文章,索引里还在」,用户会被引用到一篇已经不存在的文章。修法是生成前先清掉旧的 `kb-*.md`。`main()` 改成:

```python
# agent-zero-lab/part04/make_kb.py(只改 main)
def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    stale = sorted(OUT.glob("kb-*.md"))
    for old in stale:
        old.unlink()
    for doc_id, title, category, body in ARTICLES:
        (OUT / f"{doc_id}.md").write_text(render(doc_id, title, category, body), encoding="utf-8")
    print(f"删掉旧文件 {len(stale)} 个,写入 {len(ARTICLES)} 篇到 {OUT}")
```

<div class="line-notes">

- `stale = sorted(OUT.glob("kb-*.md"))` 先把目录里现有的文章列出来。只匹配 `kb-` 开头的 `.md`,万一目录里有别的文件(比如以后放一个 `README.md`)不会被误删。
- `old.unlink()` 删除文件,相当于终端的 `rm`、Node 的 `fs.unlinkSync`。`unlink` 是 Unix 里删除文件的系统调用的名字。
- `print(f"删掉旧文件 {len(stale)} 个,写入 {len(ARTICLES)} 篇到 {OUT}")` 把删了几个也打出来,数字对不上一眼能看到。

</div>

```bash
uv run python -m part04.make_kb
ls data/kb | wc -l
```

```text
删掉旧文件 21 个,写入 20 篇到 data/kb
      20
```

孤儿文件没了。以后都用这个修好的版本。「全删再全写」在 20 篇时没问题;到了上万篇、每次只改几篇的规模,就要按内容指纹只动变了的那几篇,这是 Day 231 的增量更新。

</details>

**验收标准:** `data/kb/` 下正好 20 个文件;`kb_check.py` 输出 42 个小节、问题 0 个、退出码 0;能复现全角冒号被抓住的那次输出;`ex_kb_category.py` 能 import `read_meta` 而不触发检查;`make_kb.py` 已经带上清理旧文件的逻辑;能不看文章说出 frontmatter 里三个字段各自的用途。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 帮助中心(help center / knowledge base) | SaaS 公司给用户看的常见问题文章合集,RAG 客服最常见的资料来源 |
| frontmatter(前置元数据) | Markdown 文件开头两条 `---` 之间的「键: 值」,描述这篇文章本身,比如 `id: kb-002` |
| 元数据(metadata) | 描述数据的数据。文章的编号、标题、分类是元数据,正文不是 |
| YAML | 一种用缩进和「键: 值」写配置的格式,frontmatter 用的就是它的最简单子集 |
| 文档字符串(docstring) | 写在文件、函数开头的三引号字符串,说明它是干什么的 |
| 三引号字符串 | `"""..."""`,可以跨行,换行原样保留,类似 JS 的反引号字符串 |
| `str.partition(sep)` | 在第一个 `sep` 处切成 `(前, sep, 后)` 三段,找不到时后两段是空字符串 |
| `path.stem` | 去掉后缀的文件名,`kb-002.md` → `kb-002` |
| `Path.unlink()` | 删除这个文件 |
| 退出码(exit code) | 程序结束时交给系统的数字,0 表示成功,非 0 表示出错,CI 靠它判断要不要继续 |
| 孤儿文件 | 来源里已经删掉、输出目录里却还留着的文件 |
| 考点 | 这份数据里故意写得容易混的地方,用来检验检索有没有找对 |

## 常见误区

**以为随便下载一份公开数据集就能练 RAG。** 练 RAG 最需要的是「每个问题的标准答案」,你得知道 E1042 应该检索到 kb-010。自己造的数据每个数字都是自己写的,判对错没有含糊。

**直接改 `data/kb/` 下的文件。** 下次重跑 `make_kb.py` 修改就被覆盖了。数据只有一个来源,改来源再生成。真实项目里来源是帮助中心的后台或者 CMS,同一个道理。

**frontmatter 用 `split(": ")` 解析。** 值里本身带 `": "` 的行会被切成三段,解包报 `ValueError: too many values to unpack (expected 2)`。用 `partition` 或者 `split(": ", 1)`,只切第一刀。

**手工编辑时打了全角冒号 `：`。** 屏幕上几乎看不出来,今天的检查脚本报的是 `'title：修改发票抬头'`。打印可疑字符串时用 `repr` 或 `!r`,空格和全角字符都能看清。

**在子目录里运行脚本。** `Path("data/kb")` 相对的是你所在的目录,今天在 `part04/` 里跑,文件悄悄写进了 `part04/data/kb/`,不报错。所有命令都在 `agent-zero-lab` 根目录用 `-m` 跑。

**写了能被 import 的脚本却不加 main guard。** 今天 import `read_meta` 时,`kb_check.py` 把检查又跑了一遍,还用 `sys.exit(0)` 把整个程序结束了,我们自己的代码一行没执行,退出码却是 0。

**以为重跑生成脚本就会和列表保持一致。** `write_text` 只覆盖不删除,从列表里删掉的文章还留在目录里。生成前先清理旧文件,或者做按指纹的增量同步。

## 学习资料

### 文档与文章

- [Jekyll · Front Matter](https://jekyllrb.com/docs/front-matter/):frontmatter 这种写法是被静态博客工具带火的,这一页讲得最短最清楚,看第一屏就够。
- [Astro · Markdown in Astro](https://docs.astro.build/en/guides/markdown-content/):这个网站自己就是 Astro 搭的,读其中讲 frontmatter 的那一段,看前端框架怎么用它。
- [gray-matter(GitHub)](https://github.com/jonschlinkert/gray-matter):JS 生态里解析 frontmatter 的标准库,看 README 的第一个例子,对照我们的 `read_meta`。
- [python-frontmatter(PyPI)](https://pypi.org/project/python-frontmatter/):Python 版的同类库,2026 年 10 月最新 1.3.0。格式复杂起来(列表、多行值)就该换成它。
- [Python 文档 · pathlib](https://docs.python.org/zh-cn/3.12/library/pathlib.html):今天用到的 `mkdir`、`write_text`、`read_text`、`glob`、`stem`、`unlink` 都在这一页,中文版。
- [Markdown Guide · Basic Syntax](https://www.markdownguide.org/basic-syntax/):如果你平时只在 GitHub 上写过 README,扫一眼标题层级那部分。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15j24BJERo&autoplay=0&high_quality=1" title="RAG落地第一步:文档格式解析与统一处理!别让垃圾文档废了你的RAG!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ManusAI模型教程- · RAG落地第一步:文档格式解析与统一处理!别让垃圾文档废了你的RAG! · 34 分钟。讲真实项目里资料是 PDF、Word、网页一大堆格式时,怎么先统一成干净的文本。我们今天直接造了干净的 Markdown,跳过了这一步,看前 15 分钟知道真实世界难在哪。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JA411h7Gw&autoplay=0&high_quality=1" title="8分钟让你快速掌握Markdown" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>请叫我AXin · 8分钟让你快速掌握Markdown · 8 分钟,播放 65 万。已经熟悉 Markdown 的可以跳过;只看标题层级那一段,弄清 `#` 和 `##` 的关系。</figcaption>
</figure>

### 其他经典视频

今天这组不需要。造数据是体力活,后天切块那一课再推荐英文视频。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)。第 8 章「Dataset Engineering」讲数据怎么造、怎么检查质量,虽然主要讲训练数据,但「数据先于模型」「每条数据要能核对」的思路和今天一致。挑开头讲数据质量的部分读。

### 开源项目与代码

- [datawhalechina/all-in-rag](https://github.com/datawhalechina/all-in-rag):中文 RAG 教程,看它数据准备那一章用的是什么样的示例文档,和我们的 `data/kb/` 对比一下结构。

## 自测

**1. frontmatter 里的 `id`、`title`、`category` 三个字段,后面分别会被用来做什么?**

<details><summary>答案</summary>

`id` 用来引用(回答末尾标 [kb-002])和增量更新时判断是哪一篇变了,它永远不变;`title` 后天切块时拼到每一块的开头,让只剩正文的小节也带着文章主题;`category` 用来过滤,比如只在「退款」分类里检索。

</details>

**2. 为什么帮助中心文章要用 `##` 分小节、每个小节只讲一件事?**

<details><summary>答案</summary>

后天切块按 `##` 切,一个小节就是一块,也就是检索的最小单位。一块只讲一件事,它的向量就只代表这件事,检索时更容易命中;如果年付和月付写在同一段里,检索到它时模型拿到两种规则,容易张冠李戴。20 篇一共 42 个小节,后天就是 42 块。

</details>

**3. 有人在 `part04/` 目录里运行了 `uv run python make_kb.py`,没有报错。会发生什么?怎么避免?**

<details><summary>答案</summary>

`Path("data/kb")` 是相对当前目录的,文件被写进了 `part04/data/kb/`,正式的 `data/kb/` 没变。之后在根目录建索引,用的还是旧数据,而且没有任何报错。避免办法:约定所有命令都在 `agent-zero-lab` 根目录用 `uv run python -m part04.make_kb` 跑;或者脚本里用 `Path(__file__)` 算出绝对路径。

</details>

**4. `from part04.kb_check import read_meta` 这一行为什么会打印出整张检查表,还让程序直接结束?**

<details><summary>答案</summary>

import 一个模块会从头到尾执行它的顶层代码。第一版 `kb_check.py` 的检查循环和 `sys.exit` 都写在顶层,所以一 import 就检查一遍、打印、然后 `sys.exit(0)` 结束整个进程,后面的代码根本没机会执行。修法是把这些放进 `main()`,用 `if __name__ == "__main__":` 保护起来。

</details>

**5. 面试题:「你们 RAG 的知识库数据是怎么管理的?文档更新、下线时怎么保证索引跟着变?」**

<details><summary>答案</summary>

先说来源和格式:资料只有一个来源(CMS 或者生成脚本),导出成带元数据的结构化文件,每篇有稳定的 id、标题、分类、更新时间,正文按小节组织,方便按结构切块。入索引前先跑格式检查,字段缺失、id 和文件名不一致、全角符号这类问题直接让流水线失败(退出码非 0),不让坏数据进索引。

再说同步:新增和修改靠内容指纹判断哪篇变了,只重建变了的块;下线最容易漏,因为「只覆盖不删除」的写法会留下孤儿文件和孤儿向量,所以同步时要拿来源的 id 集合和索引里的 id 集合做差集,索引里多出来的删掉。最后在每条回答的日志里记下引用了哪些 id,用户投诉时能马上查到是不是引用了已下线的文章。

</details>

## 明天预告

明天是 [Day 223 · 第 32 周复习:RAG 与上下文(Day 217–222)](/blog/agent-zero/day-223-week32-review/)。这一周从调 embedding 服务开始,读相似度矩阵、找反例、算成本、拆两条流水线,今天造好了正式数据。明天把这些串起来,默写 `common/embed.py`,再用一个小项目把今天的 20 篇**整篇**编码、检索一遍,看看不切块会出什么问题,为后天的切块攒下第一手证据。
