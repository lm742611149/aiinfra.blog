---
title: 'Day 31 · 小项目:纯 Python 工单分类器'
description: '不学新语法,把前五周的东西拼成一个真正能用的分类器:20 张工单、规则写成一张可配置的关键词表、按命中次数计分、拿不准的交给人工,再算准确率和混淆矩阵看规则错在哪。四个零件各自先单独跑通,最后拼成 ticket_classifier.py。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'agent-zero']
series: 'agent-zero'
day: 31
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 30](/blog/agent-zero/day-030-functions-3/) 把函数讲完了:`*args` 把多余的位置实参打包成元组、`**kwargs` 把多余的关键字实参打包成字典,调用时的 `*`、`**` 反过来把列表和字典拆开;函数里能读外面的变量,一赋值就变成自己的,改外面的要靠 `return` 或原地修改;`lambda` 是一行的小函数,用在 `key=` 和规则表里。小项目写了一个规则和权重都从外面传进来的打分函数。

到今天为止,Python 的基础语法你学了四周:变量、数字、字符串、`if`、循环、列表、元组、推导式、字典、集合、嵌套数据、函数。今天不学新东西,用这些做一个比 Day 20 日报大一号、也更像真实软件的东西。

## 今天要解决的问题

学完今天,你应该能:

1. 把 Day 28 的「先到先得」分类规则改成**可配置的关键词表加计分**:规则是一个 `{类别: [关键词, ...]}` 的字典,每个类别按命中几个关键词计分,分高的赢,同分按优先级,一个都没命中就交给人工(`未知`),并能说清计分比先到先得好在哪、哪里仍然会错。
2. 写出 `evaluate(pairs)`,算出准确率和**混淆矩阵**(人工说是 A、规则说是 B 的各有几张),会用 `dict.setdefault` 造「字典套字典」,会把矩阵对齐打印出来,并能从矩阵里读出规则错在哪一类。
3. 四个零件(`load`、`classify`、`evaluate`、`report`)各自先用几行样本单独跑通,再拼成 `part01/ticket_classifier.py`,对 20 张工单跑出「读入、评测、日报」三段输出,准确率 18/20。
4. 做完练习 4 以后能说出:在手里这 20 张上调规则调到 20/20,拿到新数据照样会错,为什么评测数据和调规则的数据要分开(Day 20 练习 4 的那个道理,今天再撞一次)。

预计用时:3.5 小时。项目日比平时长,建议分两段:前四步 2 小时,拼大代码和练习 1.5 小时。

前置:[Day 16](/blog/agent-zero/day-016-strings-2/)(`NFKC`、`split`、`lower`)、[Day 20](/blog/agent-zero/day-020-week03-review/)(`daily_report.py` 的三道坏行关卡)、[Day 23](/blog/agent-zero/day-023-comprehensions/)(推导式)、[Day 24](/blog/agent-zero/day-024-dicts/)(`.get` 计数句式、`.items()`)、[Day 28](/blog/agent-zero/day-028-functions-1/)(`clean`、`parse`、`extract_fen`)、[Day 29](/blog/agent-zero/day-029-functions-2/)(默认参数)、[Day 30](/blog/agent-zero/day-030-functions-3/)(`max(..., key=lambda ...)`、`*` 后的仅限关键字参数)。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐行敲一遍(代码自己敲,不复制粘贴)并跑通;第二天合上文章,把 `classify` 和 `evaluate` 两个函数默写出来,用第二步、第三步里的几行样本验证;然后做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚我是在哪跑的

输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh)上用演示家目录真跑的,家目录显示成 `/Users/你`,`~/agent-zero-lab` 接着 Day 30 的状态,`uv run python` 是 3.12.13,Ruff 是 0.17.2,basedpyright 是 standard 档。今天的脚本都放在 `part01/`,在仓库根目录用 `uv run python part01/文件名.py` 运行。

## 组长要什么

还是云簿 CloudLedger 的客服组。Day 20 的日报组长用了一个月,提了三个新要求:

1. 分类规则要**能改**。上个月「发票」归计费,这个月产品组说发票抬头的问题归功能;组长不想每次都让人改 `if` 链,想要一张「类别对应关键词」的表,改表就行。
2. 一张工单同时命中好几个类别时,别「谁先出现谁赢」。「发票PDF下载不了,还被多扣了299元」明明是计费问题,Day 28 的规则因为先检查功能类的 `pdf`,把它判成了功能。
3. 规则拿不准的别硬猜。一个关键词都没命中的工单,标成「未知」,组长自己看。顺便告诉组长:**规则到底错在哪一类**,不只是一个「7/8」的数字。

第三条是今天最有价值的部分。第六部分做 Agent 评测时,「准确率多少」只是起点,「错在哪、怎么错」才是能改进的依据,今天用最朴素的工具(字典套字典)把这件事做一遍。

和 Day 28 的 `ticket_funcs.py` 比,变化在这几处:

| 环节 | Day 28 `ticket_funcs.py` | 今天 `ticket_classifier.py` |
| --- | --- | --- |
| 数据 | 12 行写在列表里 | 24 行写在一个三引号字符串里,20 张有效 |
| 记录 | `(工单号, 人工类别, 描述)` 元组 | 字典,后面还要往里加 `rule`、`scores`、`fen` |
| 规则 | 写死在 `if` 链里,先到先得 | 一张 `RULES` 字典,按命中数计分 |
| 拿不准 | 默认判成功能 | 标成「未知」 |
| 成绩 | 分对几张 | 准确率、混淆矩阵、每张错的证据 |

整个流程画出来是一条线,四个零件各管一段:

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="工单分类器流程:原始文本经过 load(清洗加解析)变成工单字典列表,classify 给每张打上规则类别和计分,evaluate 把人工类别和规则类别对比算出准确率和混淆矩阵,report 汇总计数、金额和需要人工的工单">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="12" y="20" width="110" height="56" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="22" y="42" fill="var(--ink)">RAW</text>
<text x="22" y="62" fill="var(--ink-faint)">24 行文本</text>
<rect x="150" y="20" width="110" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="160" y="42" fill="var(--ink)">load()</text>
<text x="160" y="62" fill="var(--ink-soft)">clean + parse</text>
<rect x="288" y="20" width="110" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="298" y="42" fill="var(--ink)">classify()</text>
<text x="298" y="62" fill="var(--ink-soft)">RULES 计分</text>
<rect x="426" y="20" width="96" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="436" y="42" fill="var(--ink)">evaluate()</text>
<text x="436" y="62" fill="var(--ink-soft)">对答案</text>
<rect x="550" y="20" width="78" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="560" y="42" fill="var(--ink)">report()</text>
<text x="560" y="62" fill="var(--ink-soft)">日报</text>
<line x1="122" y1="48" x2="150" y2="48" stroke="var(--ink-soft)"/>
<line x1="260" y1="48" x2="288" y2="48" stroke="var(--ink-soft)"/>
<line x1="398" y1="48" x2="426" y2="48" stroke="var(--ink-soft)"/>
<line x1="522" y1="48" x2="550" y2="48" stroke="var(--ink-soft)"/>
<text x="150" y="104" fill="var(--ink-soft)">20 张字典:id / human / customer / desc</text>
<text x="288" y="124" fill="var(--ink-soft)">每张加上 rule / scores / fen</text>
<text x="426" y="144" fill="var(--ink-soft)">18/20,混淆矩阵,2 张错的证据</text>
<text x="150" y="176" fill="var(--ink-faint)">琥珀色:处理每一张;蓝色:看整批。四个零件各自能单独跑。</text>
</g>
</svg>
<figcaption>一条流水线四个零件。前两个对每张工单干活,后两个看整批的结果。</figcaption>
</figure>

## 第一步:读入 20 张工单

数据这次有 24 行,放在一个三引号字符串里(Day 27 的看板就是这么放 JSON 的),里面故意混了四处脏东西:一个空行、一行全角 `Ｔ` 加前后空格、一行只有两段的 `T321 计费`、一行类别是「其他」的 `T322`。`clean` 和 `parse` 直接沿用 Day 28 的,只有两处改动:`parse` 交回的记录从元组改成字典(后面要往里加字段),多一个 `load` 把「逐行清洗、解析、记下坏行」包起来。新建 `part01/tc_step1_parse.py`:

```python
# agent-zero-lab/part01/tc_step1_parse.py
import unicodedata

RAW = """T301 计费 C023 8月2日重复扣款299元,要求退款
T302 登录 C007 验证码收不到
T303 计费 C015 年付多扣了468元
T304 功能 C031 导出PDF乱码
  Ｔ305 计费 C042 发票金额对不上,多收了49元
T306 登录 C007 Forgot password
T307 计费 C015 我想要发票PDF

T308 功能 C023 报表页面按钮点不动
T309 计费 C055 发票PDF下载不了,还被多扣了299元
T310 登录 C031 登不上,提示密码错误
T311 功能 C042 发票抬头能不能改成英文
T312 计费 C007 月付改年付,差价怎么算
T313 登录 C099 扫码登录后一直转圈
T314 功能 C015 想要深色模式
T321 计费
T315 计费 C023 invoice 上的金额少了一位
T316 登录 C042 2FA 验证码过期太快
T317 功能 C031 导出的报表少了一列
T322 其他 C099 随便问问
T318 计费 C055 为什么扣了我两次钱
T319 登录 C015 换了手机号收不到登录验证码
T320 功能 C007 PDF 里中文显示成方框
"""

VALID_CATEGORIES = ("计费", "登录", "功能")


def clean(raw):
    return unicodedata.normalize("NFKC", raw).strip()


def parse(line):
    if line == "":
        return None, "空行"
    parts = line.split(maxsplit=3)
    if len(parts) < 4:
        return None, f"只有 {len(parts)} 段「{line}」"
    ticket_id, human, customer, desc = parts
    if human not in VALID_CATEGORIES:
        return None, f"{ticket_id} 的类别「{human}」不认识"
    ticket = {"id": ticket_id, "human": human, "customer": customer, "desc": desc}
    return ticket, ""


def load(raw_text):
    tickets = []
    problems = []
    for no, raw in enumerate(raw_text.split("\n"), start=1):
        ticket, reason = parse(clean(raw))
        if ticket is None:
            problems.append(f"第 {no:2} 行:{reason}")
            continue
        tickets.append(ticket)
    return tickets, problems


tickets, problems = load(RAW)
print(f"有效 {len(tickets)} 张,跳过 {len(problems)} 行")
for p in problems:
    print(" ", p)
print("第一张:", tickets[0])
print("最后一张:", tickets[-1])
print("人工类别:", {t["human"] for t in tickets})
```

<div class="line-notes">

- `import unicodedata` 清洗全角字符用(Day 16)。
- `RAW = """T301 计费 C023 8月2日重复扣款299元,要求退款` 三引号字符串,第一行紧跟在引号后面。格式和 Day 5 的 `tickets.txt` 一样:工单号、人工类别、客户号、描述。
- `  Ｔ305 计费 C042 发票金额对不上,多收了49元` 第 5 行:全角的 `Ｔ`,前面还有两个空格,交给 `clean` 收拾。
- `T307 计费 C015 我想要发票PDF` Day 20 里那张判错的工单,今天还会错,后面讲为什么。
- `` 第 8 行是空行。
- `T309 计费 C055 发票PDF下载不了,还被多扣了299元` 今天的主角:同时有功能词 `pdf` 和计费词「发票」「扣」。
- `T314 功能 C015 想要深色模式` 一个关键词都不会命中的工单。
- `T321 计费` 只有两段。
- `T322 其他 C099 随便问问` 类别不认识。
- `"""` 字符串结束。最后一行「T320 …」后面有个换行,所以 `split("\n")` 之后末尾会多出一个空串,它会被当成第 24 行的空行跳过,不影响结果。
- `VALID_CATEGORIES = ("计费", "登录", "功能")` 认识的人工类别,用元组,Day 28 里写在 `if` 里的那三个字符串搬出来起了个名字。
- `def clean(raw):` Day 28 原样。
- `return unicodedata.normalize("NFKC", raw).strip()` 全角变半角、去两头空白。
- `def parse(line):` 三道关卡和 Day 28 一样。
- `return None, "空行"` 第一道。
- `return None, f"只有 {len(parts)} 段「{line}」"` 第二道。
- `ticket_id, human, customer, desc = parts` 这次客户号也留下(练习里要按客户统计),不再用 `_`。
- `if human not in VALID_CATEGORIES:` 第三道,查的是那个元组。
- `ticket = {"id": ticket_id, "human": human, "customer": customer, "desc": desc}` 记录改成字典:四个键。`human` 是人工标的类别,后面规则判的类别会叫 `rule`,两个名字摆在一起不会混。
- `return ticket, ""` 好行:字典加空原因。
- `def load(raw_text):` 新零件:把整段文本变成「工单列表 + 坏行清单」。
- `tickets = []` 好的。
- `problems = []` 坏的,只记原因文本。
- `for no, raw in enumerate(raw_text.split("\n"), start=1):` 按换行拆成一行一行,带行号。
- `ticket, reason = parse(clean(raw))` 两层调用,Day 28 的句式。
- `if ticket is None:` 坏行。
- `problems.append(f"第 {no:2} 行:{reason}")` 不打印,先记下来,由调用方决定怎么显示。零件只交数据不 `print`,是它能被别的脚本复用的前提(Day 28 自测第 6 题说的事)。
- `continue` 下一行。
- `tickets.append(ticket)` 好行入列。
- `return tickets, problems` 两样一起交回。
- `tickets, problems = load(RAW)` 试跑:解包两个返回值。
- `print(f"有效 {len(tickets)} 张,跳过 {len(problems)} 行")` 数量。
- `for p in problems:` 把坏行原因逐条打印。
- `print(" ", p)` 缩进两格。
- `print("第一张:", tickets[0])` 看看字典长什么样。
- `print("最后一张:", tickets[-1])` 最后一张,确认末尾的空行没混进来。
- `print("人工类别:", {t["human"] for t in tickets})` 集合推导式(Day 25),确认只有三种。

</div>

```text
$ uv run python part01/tc_step1_parse.py
有效 20 张,跳过 4 行
  第  8 行:空行
  第 16 行:只有 2 段「T321 计费」
  第 20 行:T322 的类别「其他」不认识
  第 24 行:空行
第一张: {'id': 'T301', 'human': '计费', 'customer': 'C023', 'desc': '8月2日重复扣款299元,要求退款'}
最后一张: {'id': 'T320', 'human': '功能', 'customer': 'C007', 'desc': 'PDF 里中文显示成方框'}
人工类别: {'计费', '功能', '登录'}
```

<div class="line-notes">

- `有效 20 张,跳过 4 行` 24 行里 20 张好的。
- `  第  8 行:空行` 中间那个空行。
- `  第 16 行:只有 2 段「T321 计费」` 段数不够。
- `  第 20 行:T322 的类别「其他」不认识` 类别关卡。
- `  第 24 行:空行` 字符串末尾换行产生的空串,也被当空行跳过了,正好。
- `第一张: {'id': 'T301', 'human': '计费', 'customer': 'C023', 'desc': '8月2日重复扣款299元,要求退款'}` 四个键的字典。
- `最后一张: {'id': 'T320', 'human': '功能', 'customer': 'C007', 'desc': 'PDF 里中文显示成方框'}` 第 5 行那张全角的 `Ｔ305` 没在这里,但它在列表里(被 `clean` 修成了 `T305`),你可以自己打印 `tickets[4]` 确认。
- `人工类别: {'计费', '功能', '登录'}` 三种,集合打印顺序不固定。

</div>

## 第二步:规则表和计分

现在把 Day 28 那条 `if` 链改成一张表,再改掉「先到先得」。思路:对每个类别,数一数它的关键词在描述里出现了几个,得分最高的类别赢;同分按一个优先级列表决定;全是 0 分就交给人工。新建 `part01/tc_step2_rules.py`,里面顺便留了一个 Day 28 写法的 `classify_first_match` 用来对比:

```python
# agent-zero-lab/part01/tc_step2_rules.py
RULES = {
    "功能": ["导出", "抬头", "pdf", "方框", "乱码", "报表", "按钮"],
    "计费": ["扣", "退款", "发票", "金额", "月付", "年付", "refund", "invoice"],
    "登录": ["登录", "登不上", "验证码", "密码", "password", "2fa"],
}
PRIORITY = ["功能", "计费", "登录"]


def classify(desc, rules=RULES, priority=PRIORITY):
    text = desc.lower()
    scores = {}
    for category, keywords in rules.items():
        scores[category] = sum(1 for kw in keywords if kw in text)
    best = max(priority, key=lambda c: scores[c])
    if scores[best] == 0:
        return "未知", scores
    return best, scores


def classify_first_match(desc):
    text = desc.lower()
    for category in PRIORITY:
        for kw in RULES[category]:
            if kw in text:
                return category
    return "功能"


for desc in [
    "发票PDF下载不了,还被多扣了299元",
    "我想要发票PDF",
    "想要深色模式",
    "换了手机号收不到登录验证码",
]:
    best, scores = classify(desc)
    print(f"{desc}")
    print(f"  计分:{scores} → {best};先到先得 → {classify_first_match(desc)}")
```

<div class="line-notes">

- `RULES = {` 规则表:键是类别,值是关键词列表。Day 28 `classify` 里三组 `or` 连起来的关键词,原样搬进来,再补了几个这批工单里会出现的词(乱码、报表、按钮、登不上、2fa)。关键词全小写,因为描述会先 `lower()`。
- `"功能": ["导出", "抬头", "pdf", "方框", "乱码", "报表", "按钮"],` 功能类 7 个词。
- `"计费": ["扣", "退款", "发票", "金额", "月付", "年付", "refund", "invoice"],` 计费类 8 个词。
- `"登录": ["登录", "登不上", "验证码", "密码", "password", "2fa"],` 登录类 6 个词。
- `PRIORITY = ["功能", "计费", "登录"]` 同分时谁赢:排前面的赢。和 Day 28 一样让功能排第一,原因后面讲。
- `def classify(desc, rules=RULES, priority=PRIORITY):` 规则表和优先级都做成参数,默认用上面两个。练习里会传别的表进来。默认值是字典和列表,但函数里只读不改,Day 29 的陷阱不会发作。
- `text = desc.lower()` 转小写。
- `scores = {}` 每个类别的得分,局部变量,每次调用新的。
- `for category, keywords in rules.items():` 遍历规则表的每一对(Day 24)。
- `scores[category] = sum(1 for kw in keywords if kw in text)` 这一行是新句式。`1 for kw in keywords if kw in text` 是**去掉方括号的推导式**:对每个在 `text` 里出现的关键词产出一个 1,`sum` 把这些 1 加起来,就是命中了几个词。它叫生成器表达式,和 Day 23 的列表推导式唯一的区别是不先造列表、边产边加(Day 99 细讲);今天你把它读成「推导式直接喂给 `sum`」就行。第一条描述里,功能类只有 `pdf` 命中,得 1;计费类「发票」「扣」命中,得 2;登录类 0。
- `best = max(priority, key=lambda c: scores[c])` Day 30 的句式:在优先级列表里找得分最高的类别。`max` 遇到并列时**保留第一个**,而遍历的是 `priority`,所以同分按优先级顺序赢,一行就把「分高者胜、同分看优先级」两条规则都做了。
- `if scores[best] == 0:` 最高分都是 0,说明一个词都没命中。
- `return "未知", scores` 不猜,标成「未知」,把计分一起交回去当证据。
- `return best, scores` 正常情况:类别和计分。
- `def classify_first_match(desc):` Day 28 的写法,用表重写一遍,专门用来对比。
- `for category in PRIORITY:` 按优先级一个类别一个类别看。
- `for kw in RULES[category]:` 这个类别的每个词。
- `return category` 命中第一个词就交出类别,后面全不看。
- `return "功能"` 都没命中默认功能,Day 28 就是这么写的。
- `for desc in [` 四条描述试一遍。
- `best, scores = classify(desc)` 计分版。
- `print(f"  计分:{scores} → {best};先到先得 → {classify_first_match(desc)}")` 两种结果并排。

</div>

```text
$ uv run python part01/tc_step2_rules.py
发票PDF下载不了,还被多扣了299元
  计分:{'功能': 1, '计费': 2, '登录': 0} → 计费;先到先得 → 功能
我想要发票PDF
  计分:{'功能': 1, '计费': 1, '登录': 0} → 功能;先到先得 → 功能
想要深色模式
  计分:{'功能': 0, '计费': 0, '登录': 0} → 未知;先到先得 → 功能
换了手机号收不到登录验证码
  计分:{'功能': 0, '计费': 0, '登录': 2} → 登录;先到先得 → 登录
```

<div class="line-notes">

- `  计分:{'功能': 1, '计费': 2, '登录': 0} → 计费;先到先得 → 功能` 第一条:计分版靠「发票」加「扣」两票赢了 `pdf` 一票,判对了;先到先得版被 `pdf` 抢先,判错。这就是组长的第二条要求。
- `  计分:{'功能': 1, '计费': 1, '登录': 0} → 功能;先到先得 → 功能` 第二条「我想要发票PDF」:`pdf` 一票对「发票」一票,平了,按优先级功能赢。人工标的是计费,**两种写法都错**。计分不是万能的,同分时它和先到先得一样靠优先级猜。
- `  计分:{'功能': 0, '计费': 0, '登录': 0} → 未知;先到先得 → 功能` 第三条一个词都没有:计分版老实说「未知」,先到先得版硬猜功能(碰巧对了,但那是运气)。
- `  计分:{'功能': 0, '计费': 0, '登录': 2} → 登录;先到先得 → 登录` 第四条两种都对。

</div>

为什么优先级还是功能排第一?因为功能类的词(`pdf`、导出、抬头)更「专」,计费类的「扣」「发票」太常见,「发票抬头能不能改成英文」这种同分的,让专的赢更划算。这是一个取舍,不是定律,练习 1 会换一种办法处理同分。

## 第三步:评测,准确率和混淆矩阵

分类器判完了,成绩怎么算?Day 20 只数「分对几张」。今天多算一样东西:**混淆矩阵**,一张表,行是人工的类别,列是规则的类别,格子里是张数。对角线上是分对的,对角线外的每个格子都在告诉你「人工说 A 的,规则错判成了 B,有几张」。

这一步的零件只收「(人工类别, 规则类别)」这样的元组列表,不需要真的工单,所以可以先拿六对手写的数据把它跑通。新建 `part01/tc_step3_eval.py`:

```python
# agent-zero-lab/part01/tc_step3_eval.py
def evaluate(pairs):
    correct = 0
    confusion = {}
    for human, rule in pairs:
        if human == rule:
            correct += 1
        row = confusion.setdefault(human, {})
        row[rule] = row.get(rule, 0) + 1
    return correct, confusion


def show_confusion(confusion, labels):
    print("人工\\规则 " + "".join(f"{c:>6}" for c in labels))
    for human in labels:
        row = confusion.get(human, {})
        print(f"{human:>8}  " + "".join(f"{row.get(c, 0):>6}" for c in labels))


pairs = [
    ("计费", "计费"),
    ("计费", "功能"),
    ("登录", "登录"),
    ("功能", "未知"),
    ("功能", "功能"),
    ("计费", "计费"),
]
correct, confusion = evaluate(pairs)
print(f"分对 {correct}/{len(pairs)},准确率 {correct / len(pairs):.0%}")
print(confusion)
show_confusion(confusion, ["计费", "登录", "功能", "未知"])
```

<div class="line-notes">

- `def evaluate(pairs):` 收一个「(人工, 规则)」元组的列表。
- `correct = 0` 分对的张数。
- `confusion = {}` 混淆矩阵,用**字典套字典**装:外层键是人工类别,内层键是规则类别,值是张数。
- `for human, rule in pairs:` 循环变量直接解包(Day 22)。
- `if human == rule:` 一致就对了一张。
- `correct += 1` 计数。
- `row = confusion.setdefault(human, {})` 新方法 `setdefault`:如果 `human` 这个键已经在字典里,交回它对应的值;不在,就先放进去一个 `{}` 再交回这个 `{}`。两种情况下 `row` 都是**字典里那个真正的内层字典**,往 `row` 里写就是往 `confusion` 里写。它等价于 Day 27 看板里的三行 `if who not in d: d[who] = []` 加取值,压成了一行。
- `row[rule] = row.get(rule, 0) + 1` 内层用 Day 24 的计数句式。第一对 `("计费", "计费")` 之后,`confusion` 是 `{'计费': {'计费': 1}}`。
- `return correct, confusion` 交回两样。
- `def show_confusion(confusion, labels):` 把字典套字典打印成对齐的表。`labels` 是列的顺序。
- `print("人工\\规则 " + "".join(f"{c:>6}" for c in labels))` 表头。`\\` 是一个反斜杠(Day 15 的转义)。`f"{c:>6}"` 让每个类别名**右对齐占 6 格**,`>` 是右对齐,6 是宽度(Day 15 用过 `:2`,这是它的完整版)。`"".join(... for ...)` 又是生成器表达式,把每个格子连成一行。
- `for human in labels:` 一行一个人工类别。
- `row = confusion.get(human, {})` 这个人工类别一张都没有的话(比如「未知」),`get` 给空字典,下面全打 0。
- `print(f"{human:>8}  " + "".join(f"{row.get(c, 0):>6}" for c in labels))` 行名右对齐 8 格,然后每一列用 `get(c, 0)` 取张数,没有就 0,也右对齐 6 格。中文字符在终端里占两格,所以对齐不会完全整齐,够看就行。
- `pairs = [` 六对手写数据:四对对的,一对计费被判成功能,一对功能被判成未知。
- `correct, confusion = evaluate(pairs)` 跑。
- `print(f"分对 {correct}/{len(pairs)},准确率 {correct / len(pairs):.0%}")` `:.0%` 把 0.6667 显示成 `67%`:`%` 自动乘 100 加百分号,`.0` 是零位小数。
- `print(confusion)` 先看原始的字典套字典。
- `show_confusion(confusion, ["计费", "登录", "功能", "未知"])` 再看表格。

</div>

```text
$ uv run python part01/tc_step3_eval.py
分对 4/6,准确率 67%
{'计费': {'计费': 2, '功能': 1}, '登录': {'登录': 1}, '功能': {'未知': 1, '功能': 1}}
人工\规则     计费    登录    功能    未知
      计费       2     0     1     0
      登录       0     1     0     0
      功能       0     0     1     1
      未知       0     0     0     0
```

<div class="line-notes">

- `分对 4/6,准确率 67%` 六张对四张。
- `{'计费': {'计费': 2, '功能': 1}, '登录': {'登录': 1}, '功能': {'未知': 1, '功能': 1}}` 字典套字典的原貌:人工计费的 3 张里,规则判计费 2 张、功能 1 张。
- `人工\规则     计费    登录    功能    未知` 表头。
- `      计费       2     0     1     0` 第一行:人工说计费的,2 张判对(对角线),1 张被判成功能。
- `      功能       0     0     1     1` 人工说功能的,1 张对,1 张判成未知。
- `      未知       0     0     0     0` 人工不会标「未知」,这一行永远是 0,留着是为了表格方正。

</div>

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="怎么读混淆矩阵:对角线上的格子是分对的;同一行往右看是人工某一类被规则错判成了什么;同一列往下看是规则判成某一类的里面混进了哪些别的类">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="110" y="30" fill="var(--ink-faint)">规则说:计费</text>
<text x="230" y="30" fill="var(--ink-faint)">功能</text>
<text x="310" y="30" fill="var(--ink-faint)">未知</text>
<text x="16" y="66" fill="var(--ink-faint)">人工说:计费</text>
<text x="16" y="110" fill="var(--ink-faint)">人工说:功能</text>
<rect x="120" y="44" width="80" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="152" y="66" fill="var(--ink)">2</text>
<rect x="210" y="44" width="80" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="242" y="66" fill="var(--ink)">1</text>
<rect x="300" y="44" width="80" height="34" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<text x="332" y="66" fill="var(--ink-faint)">0</text>
<rect x="120" y="88" width="80" height="34" rx="4" fill="var(--paper)" stroke="var(--rule)"/>
<text x="152" y="110" fill="var(--ink-faint)">0</text>
<rect x="210" y="88" width="80" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="242" y="110" fill="var(--ink)">1</text>
<rect x="300" y="88" width="80" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="332" y="110" fill="var(--ink)">1</text>
<text x="400" y="66" fill="var(--ink-soft)">← 这一行:人工说计费的 3 张</text>
<text x="400" y="84" fill="var(--ink-soft)">   去了哪里(1 张被当成功能)</text>
<text x="400" y="124" fill="var(--ink-soft)">← 功能类有 1 张规则不敢判</text>
<text x="16" y="166" fill="var(--ink)">蓝色对角线 = 分对的;琥珀色 = 错的,每个格子都是一条线索</text>
<text x="16" y="190" fill="var(--ink-soft)">横着读:某一类人工工单被判成了什么;竖着读:规则判成某一类的里面混进了谁</text>
<text x="16" y="212" fill="var(--ink-faint)">准确率 = 对角线之和 ÷ 总数 = 4 ÷ 6</text>
</g>
</svg>
<figcaption>混淆矩阵把「错了几张」拆成「谁被错成了谁」。横着读是漏判,竖着读是误判。</figcaption>
</figure>

## 第四步:日报

最后一个零件:按规则类别计数、各类提到的金额、金额最大的几张、以及规则标成「未知」要人工看的清单。`extract_fen` 还是 Day 28 的。这一步只需要带 `rule` 和 `fen` 两个键的字典,先用四条手写数据试。新建 `part01/tc_step4_report.py`:

```python
# agent-zero-lab/part01/tc_step4_report.py
def extract_fen(desc):
    pos = desc.find("元")
    if pos == -1:
        return 0
    start = pos
    while start > 0 and desc[start - 1].isdigit():
        start -= 1
    if start == pos:
        return 0
    return int(desc[start:pos]) * 100


def report(tickets, *, top=3):
    counts = {}
    fen_by_category = {}
    for t in tickets:
        c = t["rule"]
        counts[c] = counts.get(c, 0) + 1
        fen_by_category[c] = fen_by_category.get(c, 0) + t["fen"]
    print("规则分类:", counts)
    print(
        "各类提到的金额:",
        {c: f"{fen / 100:.2f} 元" for c, fen in fen_by_category.items()},
    )
    with_money = sorted(
        [t for t in tickets if t["fen"] > 0], key=lambda t: (-t["fen"], t["id"])
    )
    print(f"金额最大的 {top} 张:")
    for t in with_money[:top]:
        print(f"  {t['id']} {t['fen'] // 100} 元 {t['desc']}")
    unknown = [t["id"] for t in tickets if t["rule"] == "未知"]
    print("规则拿不准、需要人工看的:", unknown if unknown else "无")


sample = [
    {"id": "T301", "rule": "计费", "fen": 29900, "desc": "重复扣款299元"},
    {"id": "T302", "rule": "登录", "fen": 0, "desc": "验证码收不到"},
    {"id": "T303", "rule": "计费", "fen": 46800, "desc": "多扣了468元"},
    {"id": "T314", "rule": "未知", "fen": 0, "desc": "想要深色模式"},
]
print(extract_fen("重复扣款299元"), extract_fen("验证码收不到"), extract_fen("人民币元"))
report(sample, top=2)
```

<div class="line-notes">

- `def extract_fen(desc):` Day 28 原样:从「元」往前退,切出数字。
- `return 0` 没有「元」。
- `return int(desc[start:pos]) * 100` 转成整数分。
- `def report(tickets, *, top=3):` `top` 放在 `*` 后面,只能按名字传(Day 30)。
- `counts = {}` 各类张数。
- `fen_by_category = {}` 各类金额合计。
- `c = t["rule"]` 这里用的是**规则判的类别**,不是人工的。日报给组长看规则的结果,人工类别在真实系统里是没有的(有的话还要规则干什么)。
- `counts[c] = counts.get(c, 0) + 1` 计数句式。
- `fen_by_category[c] = fen_by_category.get(c, 0) + t["fen"]` 同一句式,累加的是金额。
- `print("规则分类:", counts)` 打印计数。
- `print(` 这条被 Ruff 折成三行。
- `{c: f"{fen / 100:.2f} 元" for c, fen in fen_by_category.items()},` 字典推导式(Day 26):把分换成「元」字符串,只在显示这一刻除以 100。
- `with_money = sorted(` 也被折了行。
- `[t for t in tickets if t["fen"] > 0], key=lambda t: (-t["fen"], t["id"])` 有金额的工单按金额从大到小、同额按工单号,Day 30 的 lambda。
- `print(f"金额最大的 {top} 张:")` 小标题。
- `for t in with_money[:top]:` 切前几张。
- `print(f"  {t['id']} {t['fen'] // 100} 元 {t['desc']}")` 一行一张。
- `unknown = [t["id"] for t in tickets if t["rule"] == "未知"]` 规则放弃的工单号。
- `print("规则拿不准、需要人工看的:", unknown if unknown else "无")` 空列表显示「无」。
- `sample = [` 四条手写数据,只要有 `id`、`rule`、`fen`、`desc` 四个键。
- `print(extract_fen("重复扣款299元"), extract_fen("验证码收不到"), extract_fen("人民币元"))` 顺手试三种情况:有金额、没有「元」、「元」前面不是数字。
- `report(sample, top=2)` 只看前 2 张。

</div>

```text
$ uv run python part01/tc_step4_report.py
29900 0 0
规则分类: {'计费': 2, '登录': 1, '未知': 1}
各类提到的金额: {'计费': '767.00 元', '登录': '0.00 元', '未知': '0.00 元'}
金额最大的 2 张:
  T303 468 元 多扣了468元
  T301 299 元 重复扣款299元
规则拿不准、需要人工看的: ['T314']
```

<div class="line-notes">

- `29900 0 0` 299 元是 29900 分;另两条都是 0。
- `规则分类: {'计费': 2, '登录': 1, '未知': 1}` 按规则类别计数。
- `各类提到的金额: {'计费': '767.00 元', '登录': '0.00 元', '未知': '0.00 元'}` 299 + 468。
- `  T303 468 元 多扣了468元` 最大的一张。
- `规则拿不准、需要人工看的: ['T314']` 「未知」的清单。

</div>

## 拼起来:ticket_classifier.py

四个零件都单独跑通了,现在把它们放进一个文件,加一个 `main` 把流程串起来。`main` 做的事只有三件:调 `load`,给每张工单补上 `rule`、`scores`、`fen` 三个键,然后调 `evaluate`、`show_confusion`、`report` 打印三段。新建 `part01/ticket_classifier.py`(零件的代码和上面四步一模一样,这里为了完整再贴一遍,你可以直接从四个步骤文件里复制过来):

```python
# agent-zero-lab/part01/ticket_classifier.py
import unicodedata

RAW = """T301 计费 C023 8月2日重复扣款299元,要求退款
T302 登录 C007 验证码收不到
T303 计费 C015 年付多扣了468元
T304 功能 C031 导出PDF乱码
  Ｔ305 计费 C042 发票金额对不上,多收了49元
T306 登录 C007 Forgot password
T307 计费 C015 我想要发票PDF

T308 功能 C023 报表页面按钮点不动
T309 计费 C055 发票PDF下载不了,还被多扣了299元
T310 登录 C031 登不上,提示密码错误
T311 功能 C042 发票抬头能不能改成英文
T312 计费 C007 月付改年付,差价怎么算
T313 登录 C099 扫码登录后一直转圈
T314 功能 C015 想要深色模式
T321 计费
T315 计费 C023 invoice 上的金额少了一位
T316 登录 C042 2FA 验证码过期太快
T317 功能 C031 导出的报表少了一列
T322 其他 C099 随便问问
T318 计费 C055 为什么扣了我两次钱
T319 登录 C015 换了手机号收不到登录验证码
T320 功能 C007 PDF 里中文显示成方框
"""

VALID_CATEGORIES = ("计费", "登录", "功能")
RULES = {
    "功能": ["导出", "抬头", "pdf", "方框", "乱码", "报表", "按钮"],
    "计费": ["扣", "退款", "发票", "金额", "月付", "年付", "refund", "invoice"],
    "登录": ["登录", "登不上", "验证码", "密码", "password", "2fa"],
}
PRIORITY = ["功能", "计费", "登录"]
LABELS = PRIORITY + ["未知"]


def clean(raw):
    return unicodedata.normalize("NFKC", raw).strip()


def parse(line):
    if line == "":
        return None, "空行"
    parts = line.split(maxsplit=3)
    if len(parts) < 4:
        return None, f"只有 {len(parts)} 段「{line}」"
    ticket_id, human, customer, desc = parts
    if human not in VALID_CATEGORIES:
        return None, f"{ticket_id} 的类别「{human}」不认识"
    ticket = {"id": ticket_id, "human": human, "customer": customer, "desc": desc}
    return ticket, ""


def load(raw_text):
    tickets = []
    problems = []
    for no, raw in enumerate(raw_text.split("\n"), start=1):
        ticket, reason = parse(clean(raw))
        if ticket is None:
            problems.append(f"第 {no:2} 行:{reason}")
            continue
        tickets.append(ticket)
    return tickets, problems


def classify(desc, rules=RULES, priority=PRIORITY):
    text = desc.lower()
    scores = {}
    for category, keywords in rules.items():
        scores[category] = sum(1 for kw in keywords if kw in text)
    best = max(priority, key=lambda c: scores[c])
    if scores[best] == 0:
        return "未知", scores
    return best, scores


def extract_fen(desc):
    pos = desc.find("元")
    if pos == -1:
        return 0
    start = pos
    while start > 0 and desc[start - 1].isdigit():
        start -= 1
    if start == pos:
        return 0
    return int(desc[start:pos]) * 100


def evaluate(pairs):
    correct = 0
    confusion = {}
    for human, rule in pairs:
        if human == rule:
            correct += 1
        row = confusion.setdefault(human, {})
        row[rule] = row.get(rule, 0) + 1
    return correct, confusion


def show_confusion(confusion, labels):
    print("人工\\规则 " + "".join(f"{c:>6}" for c in labels))
    for human in labels:
        row = confusion.get(human, {})
        print(f"{human:>8}  " + "".join(f"{row.get(c, 0):>6}" for c in labels))


def report(tickets, *, top=3):
    counts = {}
    fen_by_category = {}
    for t in tickets:
        c = t["rule"]
        counts[c] = counts.get(c, 0) + 1
        fen_by_category[c] = fen_by_category.get(c, 0) + t["fen"]
    print("规则分类:", counts)
    print(
        "各类提到的金额:",
        {c: f"{fen / 100:.2f} 元" for c, fen in fen_by_category.items()},
    )
    with_money = sorted(
        [t for t in tickets if t["fen"] > 0], key=lambda t: (-t["fen"], t["id"])
    )
    print(f"金额最大的 {top} 张:")
    for t in with_money[:top]:
        print(f"  {t['id']} {t['fen'] // 100} 元 {t['desc']}")
    unknown = [t["id"] for t in tickets if t["rule"] == "未知"]
    print("规则拿不准、需要人工看的:", unknown if unknown else "无")


def main(raw_text, *, rules=RULES, priority=PRIORITY, show_errors=True):
    tickets, problems = load(raw_text)
    print(f"== 读入:有效 {len(tickets)} 张,跳过 {len(problems)} 行")
    for p in problems:
        print("  ", p)

    for t in tickets:
        t["rule"], t["scores"] = classify(t["desc"], rules, priority)
        t["fen"] = extract_fen(t["desc"]) if t["rule"] == "计费" else 0

    print("== 评测")
    correct, confusion = evaluate([(t["human"], t["rule"]) for t in tickets])
    print(f"分对 {correct}/{len(tickets)},准确率 {correct / len(tickets):.0%}")
    show_confusion(confusion, LABELS)
    if show_errors:
        for t in tickets:
            if t["rule"] != t["human"]:
                print(
                    f"  错:{t['id']} 人工={t['human']} 规则={t['rule']} 计分={t['scores']} 「{t['desc']}」"
                )

    print("== 日报")
    report(tickets)
    return correct, tickets


main(RAW)
```

<div class="line-notes">

- `import unicodedata` 唯一的 import。
- `RAW = """T301 计费 C023 8月2日重复扣款299元,要求退款` 第一步的 24 行。
- `VALID_CATEGORIES = ("计费", "登录", "功能")` 第一步。
- `RULES = {` 第二步的规则表。
- `PRIORITY = ["功能", "计费", "登录"]` 第二步的优先级。
- `LABELS = PRIORITY + ["未知"]` 新增:混淆矩阵的行列顺序,三个类别加「未知」。列表相加得到新列表(Day 21)。
- `def clean(raw):` 第一步。
- `def parse(line):` 第一步。
- `def load(raw_text):` 第一步。
- `def classify(desc, rules=RULES, priority=PRIORITY):` 第二步。
- `def extract_fen(desc):` 第四步。
- `def evaluate(pairs):` 第三步。
- `def show_confusion(confusion, labels):` 第三步。
- `def report(tickets, *, top=3):` 第四步。
- `def main(raw_text, *, rules=RULES, priority=PRIORITY, show_errors=True):` 串流程的函数。规则表和优先级做成参数,练习里换一张表就能整体重跑;`show_errors` 控制要不要列出判错的工单。
- `tickets, problems = load(raw_text)` 第一段:读入。
- `print(f"== 读入:有效 {len(tickets)} 张,跳过 {len(problems)} 行")` 三段输出各用 `==` 开头。
- `print("  ", p)` 坏行原因。
- `for t in tickets:` 给每张工单补字段。
- `t["rule"], t["scores"] = classify(t["desc"], rules, priority)` `classify` 交回两个值,直接解包赋给字典的两个新键(Day 22 的解包可以赋给任何「能放在等号左边的东西」)。
- `t["fen"] = extract_fen(t["desc"]) if t["rule"] == "计费" else 0` 和 Day 20、28 一样,只对规则判成计费的抠金额。
- `print("== 评测")` 第二段。
- `correct, confusion = evaluate([(t["human"], t["rule"]) for t in tickets])` 推导式造出「(人工, 规则)」对的列表,喂给 `evaluate`。
- `print(f"分对 {correct}/{len(tickets)},准确率 {correct / len(tickets):.0%}")` 准确率。
- `show_confusion(confusion, LABELS)` 矩阵。
- `if show_errors:` 要证据吗?
- `if t["rule"] != t["human"]:` 判错的。
- `print(` 被折行的长 print。
- `f"  错:{t['id']} 人工={t['human']} 规则={t['rule']} 计分={t['scores']} 「{t['desc']}」"` 把计分和描述一起打出来,一眼能看出为什么错。
- `print("== 日报")` 第三段。
- `report(tickets)` 默认前 3 张。
- `return correct, tickets` 交回成绩和补齐字段的工单列表,练习 4 用得上。
- `main(RAW)` 跑。

</div>

```text
$ uv run python part01/ticket_classifier.py
== 读入:有效 20 张,跳过 4 行
   第  8 行:空行
   第 16 行:只有 2 段「T321 计费」
   第 20 行:T322 的类别「其他」不认识
   第 24 行:空行
== 评测
分对 18/20,准确率 90%
人工\规则     功能    计费    登录    未知
      功能       5     0     0     1
      计费       1     7     0     0
      登录       0     0     6     0
      未知       0     0     0     0
  错:T307 人工=计费 规则=功能 计分={'功能': 1, '计费': 1, '登录': 0} 「我想要发票PDF」
  错:T314 人工=功能 规则=未知 计分={'功能': 0, '计费': 0, '登录': 0} 「想要深色模式」
== 日报
规则分类: {'计费': 7, '登录': 6, '功能': 6, '未知': 1}
各类提到的金额: {'计费': '1115.00 元', '登录': '0.00 元', '功能': '0.00 元', '未知': '0.00 元'}
金额最大的 3 张:
  T303 468 元 年付多扣了468元
  T301 299 元 8月2日重复扣款299元,要求退款
  T309 299 元 发票PDF下载不了,还被多扣了299元
规则拿不准、需要人工看的: ['T314']
```

<div class="line-notes">

- `== 读入:有效 20 张,跳过 4 行` 和第一步一样。
- `分对 18/20,准确率 90%` 20 张对 18 张。
- `      功能       5     0     0     1` 人工功能 6 张:5 张对,1 张规则不敢判(T314)。
- `      计费       1     7     0     0` 人工计费 8 张:7 张对,1 张被判成功能(T307)。
- `      登录       0     0     6     0` 登录 6 张全对。登录类的词(验证码、密码、登录)和别的类几乎不重叠,所以最稳。
- `  错:T307 人工=计费 规则=功能 计分={'功能': 1, '计费': 1, '登录': 0} 「我想要发票PDF」` 第一个错:同分,优先级让功能赢了。证据就在计分里。
- `  错:T314 人工=功能 规则=未知 计分={'功能': 0, '计费': 0, '登录': 0} 「想要深色模式」` 第二个错:规则表里没有能对上「深色模式」的词。这不算「判错」,是「不会判」,它进了人工清单。
- `规则分类: {'计费': 7, '登录': 6, '功能': 6, '未知': 1}` 按规则类别计数,和混淆矩阵竖着加是一致的:计费那一列 0 + 7 + 0 = 7。
- `各类提到的金额: {'计费': '1115.00 元'` 299 + 468 + 49 + 299 = 1115:T301、T303、T305、T309 四张。T307 虽然人工是计费,但规则判成了功能,没抠金额,这正是判错的代价。
- `  T303 468 元 年付多扣了468元` 金额前三。
- `规则拿不准、需要人工看的: ['T314']` 一张给组长。

</div>

Ruff 对今天六个脚本都通过,basedpyright 零报错(`t["rule"], t["scores"] = ...` 这种往字典里加新键的写法它不挑,因为字典的值类型在这里推断成了 `Any`;Day 47 学了 TypedDict 之后会把它收紧)。

对照表,每个零件的来历:

| 零件 | 来自 | 今天改了什么 |
| --- | --- | --- |
| `clean`、`parse` | Day 28 `ticket_funcs.py` | 记录改成字典,类别列表提成 `VALID_CATEGORIES` |
| `load` | Day 20 主循环的前半 | 只收集、不打印,坏行原因交回去 |
| `classify` | Day 28 的 `if` 链 | 规则表 + 计分 + 优先级 + 未知 |
| `extract_fen` | Day 28 | 没改 |
| `evaluate`、`show_confusion` | 新写 | 字典套字典的混淆矩阵 |
| `report` | Day 20 的日报段 | 多了各类金额、前几张、未知清单 |
| `main` | Day 20 主循环的后半 | 串起四个零件,返回结果 |

## 两张错的怎么办

T307 和 T314 的错,病因不同,解法也不同:

- T307 是**同分**。可以调优先级(让计费排功能前面),但那会让 T311「发票抬头能不能改成英文」反过来错;可以给关键词加权重(「发票」比 `pdf` 更能说明问题),这是练习 1。
- T314 是**没词**。往功能类加一个「模式」就能对,但每加一个词都可能在别的工单上误伤,这是练习 4 要演示的事。

无论哪种,改完都要**重跑整个评测**看准确率和矩阵,不能只盯着那一张。一个只在手里这 20 张上调出来的 20/20,拿到下个月的工单未必还有 18/20。

## 动手练习

### 练习 1:给关键词加权重

把 `RULES` 从「类别对应关键词列表」改成「类别对应 `{关键词: 权重}` 字典」,命中一个词就加它的权重而不是加 1。写 `part01/ex31_1_weights.py`:

- 功能类:`pdf`、「导出」、「报表」权重 1,其余 2,并新增「模式」权重 2;计费类:「金额」「月付」「年付」权重 1,其余 2;登录类全部 2。
- `classify(desc, rules=WEIGHTED_RULES, priority=PRIORITY)` 和今天的同名函数只差一行。
- 用「我想要发票PDF」「想要深色模式」「发票PDF下载不了,还被多扣了299元」「导出PDF乱码」四条验证,前两条应该从错变对。

期望输出:

```text
我想要发票PDF → 计费 {'功能': 1, '计费': 2, '登录': 0}
想要深色模式 → 功能 {'功能': 2, '计费': 0, '登录': 0}
发票PDF下载不了,还被多扣了299元 → 计费 {'功能': 1, '计费': 4, '登录': 0}
导出PDF乱码 → 功能 {'功能': 4, '计费': 0, '登录': 0}
```

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex31_1_weights.py
WEIGHTED_RULES = {
    "功能": {
        "导出": 1,
        "抬头": 2,
        "pdf": 1,
        "方框": 2,
        "乱码": 2,
        "报表": 1,
        "按钮": 2,
        "模式": 2,
    },
    "计费": {
        "扣": 2,
        "退款": 2,
        "发票": 2,
        "金额": 1,
        "月付": 1,
        "年付": 1,
        "refund": 2,
        "invoice": 2,
    },
    "登录": {"登录": 2, "登不上": 2, "验证码": 2, "密码": 2, "password": 2, "2fa": 2},
}
PRIORITY = ["功能", "计费", "登录"]


def classify(desc, rules=WEIGHTED_RULES, priority=PRIORITY):
    text = desc.lower()
    scores = {}
    for category, keywords in rules.items():
        scores[category] = sum(weight for kw, weight in keywords.items() if kw in text)
    best = max(priority, key=lambda c: scores[c])
    if scores[best] == 0:
        return "未知", scores
    return best, scores


for desc in [
    "我想要发票PDF",
    "想要深色模式",
    "发票PDF下载不了,还被多扣了299元",
    "导出PDF乱码",
]:
    best, scores = classify(desc)
    print(f"{desc} → {best} {scores}")
```

<div class="line-notes">

- `WEIGHTED_RULES = {` 外层还是类别,内层从列表换成字典。Ruff 把长的内层字典折成了一行一个词。
- `"pdf": 1,` `pdf` 太泛(发票 PDF、报表 PDF 都带它),给 1 分。
- `"模式": 2,` 新加的词,让「深色模式」能命中。
- `"发票": 2,` 「发票」在计费里给 2 分,这样「发票」对 `pdf` 就是 2 比 1。
- `scores[category] = sum(weight for kw, weight in keywords.items() if kw in text)` 唯一改动的一行:遍历内层字典的 `(词, 权重)`,命中就把权重加进去,不再是加 1。
- `best = max(priority, key=lambda c: scores[c])` 其余不变。
- `for desc in [` 四条验证。

</div>

```text
$ uv run python part01/ex31_1_weights.py
我想要发票PDF → 计费 {'功能': 1, '计费': 2, '登录': 0}
想要深色模式 → 功能 {'功能': 2, '计费': 0, '登录': 0}
发票PDF下载不了,还被多扣了299元 → 计费 {'功能': 1, '计费': 4, '登录': 0}
导出PDF乱码 → 功能 {'功能': 4, '计费': 0, '登录': 0}
```

<div class="line-notes">

- `我想要发票PDF → 计费 {'功能': 1, '计费': 2, '登录': 0}` T307 对了:「发票」2 分赢了 `pdf` 1 分,不再靠优先级。
- `想要深色模式 → 功能 {'功能': 2, '计费': 0, '登录': 0}` T314 对了:「模式」命中。
- `发票PDF下载不了,还被多扣了299元 → 计费 {'功能': 1, '计费': 4, '登录': 0}` 「发票」2 加「扣」2。
- `导出PDF乱码 → 功能 {'功能': 4, '计费': 0, '登录': 0}` 导出 1、pdf 1、乱码 2。

</div>

把这张表接进 `ticket_classifier.py` 的 `main(RAW, rules=WEIGHTED_RULES)`,20 张会变成 20/20。先别高兴,做完练习 4 再说。

</details>

### 练习 2:先猜,再跑

不要先运行。用一张故意简化的规则表(关键词是单个字母),下面六行输出分别是什么?重点看第 1 行(两类同分,谁赢)、第 2 行(大写的 `B`)和第 5 行(换了优先级)。

```python
# agent-zero-lab/part01/ex31_2_guess.py
RULES = {"甲": ["a", "b"], "乙": ["b", "c"], "丙": ["d"]}
PRIORITY = ["乙", "甲", "丙"]


def classify(desc, rules=RULES, priority=PRIORITY):
    text = desc.lower()
    scores = {}
    for category, keywords in rules.items():
        scores[category] = sum(1 for kw in keywords if kw in text)
    best = max(priority, key=lambda c: scores[c])
    if scores[best] == 0:
        return "未知", scores
    return best, scores


print(classify("abc"))
print(classify("B"))
print(classify("ad"))
print(classify("xyz"))
print(classify("abc", priority=["甲", "乙", "丙"]))
print(classify("aaa"))
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex31_2_guess.py
('乙', {'甲': 2, '乙': 2, '丙': 0})
('乙', {'甲': 1, '乙': 1, '丙': 0})
('甲', {'甲': 1, '乙': 0, '丙': 1})
('未知', {'甲': 0, '乙': 0, '丙': 0})
('甲', {'甲': 2, '乙': 2, '丙': 0})
('甲', {'甲': 1, '乙': 0, '丙': 0})
```

<div class="line-notes">

- `('乙', {'甲': 2, '乙': 2, '丙': 0})` 第 1 行。甲命中 a、b,乙命中 b、c,同分 2;`max` 遍历的是 `priority`,乙排第一,保留第一个最大值,乙赢。
- `('乙', {'甲': 1, '乙': 1, '丙': 0})` 第 2 行。`lower()` 把 `B` 变成 `b`,甲和乙各命中一个,同分,乙赢。
- `('甲', {'甲': 1, '乙': 0, '丙': 1})` 第 3 行。甲和丙各 1 分,甲在优先级里排丙前面。
- `('未知', {'甲': 0, '乙': 0, '丙': 0})` 第 4 行。全 0,未知。
- `('甲', {'甲': 2, '乙': 2, '丙': 0})` 第 5 行。同样的描述,优先级换成甲在前,甲赢。计分没变,赢家变了,说明同分时的结果完全由优先级决定。
- `('甲', {'甲': 1, '乙': 0, '丙': 0})` 第 6 行。`"a" in "aaa"` 只算命中一次,不是三次:计的是「命中了几个关键词」,不是「关键词出现了几次」。

</div>

</details>

### 练习 3:找出三个错

`part01/ex31_3_bug.py` 里有三个坑,一个会报错,两个不报错但结果不对。先照原样跑,修掉报错的那个;再对照「预期每条描述应该判成什么」找出剩下两个。预期:「重复扣款」计费、「验证码收不到」登录、「导出乱码」**未知**(这张表里没有功能类)、「Refund please」计费。

```python
# agent-zero-lab/part01/ex31_3_bug.py
RULES = {"计费": ["扣", "退款", "refund"], "登录": ["验证码", "密码"]}
PRIORITY = ["计费", "登录"]


def classify(desc, rules=RULES, priority=PRIORITY):
    scores = {}
    for category, keywords in rules.items():
        scores[category] = sum(1 for kw in keywords if kw in desc)
    best = max(priority, key=lambda c: scores[c])
    if best == 0:
        return "未知", scores
    return best, scores


def evaluate(pairs):
    correct = 0
    confusion = {}
    for human, rule in pairs:
        if human == rule:
            correct += 1
        confusion[human][rule] = confusion[human].get(rule, 0) + 1
    return correct, confusion


tickets = [
    ("计费", "重复扣款"),
    ("登录", "验证码收不到"),
    ("功能", "导出乱码"),
    ("计费", "Refund please"),
]
pairs = []
for human, desc in tickets:
    rule, scores = classify(desc)
    pairs.append((human, rule))
    print(f"{desc} → {rule} {scores}")
correct, confusion = evaluate(pairs)
print(f"分对 {correct}/{len(pairs)}")
print(confusion)
```

<details><summary>参考答案</summary>

```text
$ uv run python part01/ex31_3_bug.py
重复扣款 → 计费 {'计费': 1, '登录': 0}
验证码收不到 → 登录 {'计费': 0, '登录': 1}
导出乱码 → 计费 {'计费': 0, '登录': 0}
Refund please → 计费 {'计费': 0, '登录': 0}
Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ex31_3_bug.py", line 37, in <module>
    correct, confusion = evaluate(pairs)
                         ^^^^^^^^^^^^^^^
  File "/Users/你/agent-zero-lab/part01/ex31_3_bug.py", line 22, in evaluate
    confusion[human][rule] = confusion[human].get(rule, 0) + 1
                             ~~~~~~~~~^^^^^^^
KeyError: '计费'
```

<div class="line-notes">

- `导出乱码 → 计费 {'计费': 0, '登录': 0}` 全 0 分却判成了计费,先记下,这是不报错的坑之一。
- `Refund please → 计费 {'计费': 0, '登录': 0}` `refund` 没命中(大写的 R),也是 0 分却判计费。
- `confusion[human][rule] = confusion[human].get(rule, 0) + 1` **第一个坑,报错的**:`confusion` 一开始是空字典,`confusion["计费"]` 这个键还不存在,直接取就是 `KeyError`(Day 24)。修:`row = confusion.setdefault(human, {})`,再对 `row` 操作。
- `KeyError: '计费'` 报错里的键就是第一对的人工类别。

</div>

修好 `setdefault` 之后再跑:

```text
$ uv run python part01/ex31_3_bug.py
重复扣款 → 计费 {'计费': 1, '登录': 0}
验证码收不到 → 登录 {'计费': 0, '登录': 1}
导出乱码 → 计费 {'计费': 0, '登录': 0}
Refund please → 计费 {'计费': 0, '登录': 0}
分对 3/4
{'计费': {'计费': 2}, '登录': {'登录': 1}, '功能': {'计费': 1}}
```

<div class="line-notes">

- `导出乱码 → 计费 {'计费': 0, '登录': 0}` **第二个坑,不报错**:全 0 分应该是「未知」。看 `classify`:写的是 `if best == 0`,可 `best` 是类别名字符串(`"计费"`),永远不等于 0,这个 `if` 永远不成立。要比的是分数:`if scores[best] == 0`。
- `分对 3/4` 3 对 1 错,但「Refund please」是蒙对的:它 0 分,被同一个坑判成了计费,恰好人工也是计费。

</div>

修好 `scores[best]` 之后再跑:

```text
$ uv run python part01/ex31_3_bug.py
重复扣款 → 计费 {'计费': 1, '登录': 0}
验证码收不到 → 登录 {'计费': 0, '登录': 1}
导出乱码 → 未知 {'计费': 0, '登录': 0}
Refund please → 未知 {'计费': 0, '登录': 0}
分对 2/4
{'计费': {'计费': 1, '未知': 1}, '登录': {'登录': 1}, '功能': {'未知': 1}}
```

<div class="line-notes">

- `导出乱码 → 未知 {'计费': 0, '登录': 0}` 对了,这张表判不了功能类,老实说未知。
- `Refund please → 未知 {'计费': 0, '登录': 0}` **第三个坑露出来了**:修掉第二个坑以后,准确率反而从 3/4 掉到 2/4。`refund` 这个关键词是小写,描述里是 `Refund`,`classify` 忘了 `text = desc.lower()`,直接拿 `desc` 比。修:加回 `lower()`,用 `text`。
- `分对 2/4` 修 bug 让分数变低,是常事:之前的分里有蒙对的。

</div>

三个都改好的 `part01/ex31_3_fixed.py`:

```python
# agent-zero-lab/part01/ex31_3_fixed.py
RULES = {"计费": ["扣", "退款", "refund"], "登录": ["验证码", "密码"]}
PRIORITY = ["计费", "登录"]


def classify(desc, rules=RULES, priority=PRIORITY):
    text = desc.lower()
    scores = {}
    for category, keywords in rules.items():
        scores[category] = sum(1 for kw in keywords if kw in text)
    best = max(priority, key=lambda c: scores[c])
    if scores[best] == 0:
        return "未知", scores
    return best, scores


def evaluate(pairs):
    correct = 0
    confusion = {}
    for human, rule in pairs:
        if human == rule:
            correct += 1
        row = confusion.setdefault(human, {})
        row[rule] = row.get(rule, 0) + 1
    return correct, confusion


tickets = [
    ("计费", "重复扣款"),
    ("登录", "验证码收不到"),
    ("功能", "导出乱码"),
    ("计费", "Refund please"),
]
pairs = []
for human, desc in tickets:
    rule, scores = classify(desc)
    pairs.append((human, rule))
    print(f"{desc} → {rule} {scores}")
correct, confusion = evaluate(pairs)
print(f"分对 {correct}/{len(pairs)}")
print(confusion)
```

<div class="line-notes">

- `text = desc.lower()` 第三个坑:补回小写。
- `scores[category] = sum(1 for kw in keywords if kw in text)` 用 `text` 比。
- `if scores[best] == 0:` 第二个坑:比分数,不比名字。
- `row = confusion.setdefault(human, {})` 第一个坑:先保证内层字典存在。
- `row[rule] = row.get(rule, 0) + 1` 再计数。

</div>

```text
$ uv run python part01/ex31_3_fixed.py
重复扣款 → 计费 {'计费': 1, '登录': 0}
验证码收不到 → 登录 {'计费': 0, '登录': 1}
导出乱码 → 未知 {'计费': 0, '登录': 0}
Refund please → 计费 {'计费': 1, '登录': 0}
分对 3/4
{'计费': {'计费': 2}, '登录': {'登录': 1}, '功能': {'未知': 1}}
```

<div class="line-notes">

- `Refund please → 计费 {'计费': 1, '登录': 0}` 小写后 `refund` 命中,这次是真的对。
- `分对 3/4` 和第一次「修好 setdefault」时一样是 3/4,但这次三个对的都有计分证据,「导出乱码」的错是「不会判」而不是「判错」。两个 3/4 不一样,**看矩阵和证据比看准确率重要**。

</div>

</details>

### 练习 4:用没见过的数据量真实水平

练习 1 的权重表能把手里 20 张调到 20/20。但组长下个月的工单你现在没有。写 `part01/ex31_4_holdout.py`:

- 造 8 张新工单(人工类别加描述),里面故意有「想要上个月的发票」(计费)和「想要英文界面」(功能)这种带「想要」的;
- 两张规则表:原版 `RULES`,和一张「调过的」`TUNED_RULES`,后者给功能类加了「模式」「下载」「想要」三个词(「想要」是看到 T314「想要深色模式」后顺手加的);
- 对两张表各算新数据上的准确率,逐条打印对错。

观察:调过的表在新数据上是不是更好?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part01/ex31_4_holdout.py
RULES = {
    "功能": ["导出", "抬头", "pdf", "方框", "乱码", "报表", "按钮"],
    "计费": ["扣", "退款", "发票", "金额", "月付", "年付", "refund", "invoice"],
    "登录": ["登录", "登不上", "验证码", "密码", "password", "2fa"],
}
TUNED_RULES = {
    "功能": RULES["功能"] + ["模式", "下载", "想要"],
    "计费": RULES["计费"],
    "登录": RULES["登录"],
}
PRIORITY = ["功能", "计费", "登录"]

NEW_TICKETS = [
    ("功能", "报表能不能导出成Excel"),
    ("计费", "想要上个月的发票"),
    ("登录", "密码重置邮件没收到"),
    ("计费", "Please refund, charged twice"),
    ("功能", "手机上打不开PDF"),
    ("计费", "年付想退款"),
    ("功能", "想要英文界面"),
    ("登录", "Can't login with 2FA"),
]


def classify(desc, rules, priority=PRIORITY):
    text = desc.lower()
    scores = {}
    for category, keywords in rules.items():
        scores[category] = sum(1 for kw in keywords if kw in text)
    best = max(priority, key=lambda c: scores[c])
    if scores[best] == 0:
        return "未知", scores
    return best, scores


def accuracy(tickets, rules):
    correct = 0
    for human, desc in tickets:
        best, _ = classify(desc, rules)
        if best == human:
            correct += 1
    return correct


for name, rules in [("原版规则", RULES), ("调过的规则", TUNED_RULES)]:
    correct = accuracy(NEW_TICKETS, rules)
    print(f"{name}:新数据上 {correct}/{len(NEW_TICKETS)}")
    for human, desc in NEW_TICKETS:
        best, scores = classify(desc, rules)
        mark = "对" if best == human else "错"
        print(f"  {mark} {desc} 人工={human} 规则={best}")
```

<div class="line-notes">

- `RULES = {` 今天的原版。
- `TUNED_RULES = {` 调过的版本:功能类的列表用 `+` 接上三个新词,得到新列表,原版 `RULES` 不受影响(Day 21)。
- `"功能": RULES["功能"] + ["模式", "下载", "想要"],` 「想要」就是那个看着 T314 顺手加的词。
- `NEW_TICKETS = [` 8 张新工单,规则没「见过」它们。
- `("计费", "想要上个月的发票"),` 带「想要」的计费工单。
- `("功能", "想要英文界面"),` 带「想要」的功能工单。
- `def classify(desc, rules, priority=PRIORITY):` 这次 `rules` 没有默认值,逼调用方说清用哪张表。
- `def accuracy(tickets, rules):` 对一批工单算分对几张。
- `best, _ = classify(desc, rules)` 计分用不着,`_` 接住(Day 22)。
- `for name, rules in [("原版规则", RULES), ("调过的规则", TUNED_RULES)]:` 两张表各跑一遍。
- `mark = "对" if best == human else "错"` 逐条标记。

</div>

```text
$ uv run python part01/ex31_4_holdout.py
原版规则:新数据上 7/8
  对 报表能不能导出成Excel 人工=功能 规则=功能
  对 想要上个月的发票 人工=计费 规则=计费
  对 密码重置邮件没收到 人工=登录 规则=登录
  对 Please refund, charged twice 人工=计费 规则=计费
  对 手机上打不开PDF 人工=功能 规则=功能
  对 年付想退款 人工=计费 规则=计费
  错 想要英文界面 人工=功能 规则=未知
  对 Can't login with 2FA 人工=登录 规则=登录
调过的规则:新数据上 7/8
  对 报表能不能导出成Excel 人工=功能 规则=功能
  错 想要上个月的发票 人工=计费 规则=功能
  对 密码重置邮件没收到 人工=登录 规则=登录
  对 Please refund, charged twice 人工=计费 规则=计费
  对 手机上打不开PDF 人工=功能 规则=功能
  对 年付想退款 人工=计费 规则=计费
  对 想要英文界面 人工=功能 规则=功能
  对 Can't login with 2FA 人工=登录 规则=登录
```

<div class="line-notes">

- `原版规则:新数据上 7/8` 原版在新数据上 7/8。
- `  错 想要英文界面 人工=功能 规则=未知` 原版的唯一错:没词,老实说未知。
- `调过的规则:新数据上 7/8` 调过的版本**也是 7/8**,没有变好。
- `  错 想要上个月的发票 人工=计费 规则=功能` 调过的版本修好了「想要英文界面」,却把「想要上个月的发票」弄错了:「想要」给功能加了 1 分,和「发票」给计费的 1 分打平,优先级让功能赢。
- `  对 想要英文界面 人工=功能 规则=功能` 修好的那张。

</div>

「想要」这个词和类别没有关系,任何类的客户都会说「想要」。它在手里那 20 张上碰巧只出现在一张功能工单里,于是看起来像功能词。加进去,手里的分涨了,新数据的分没涨,还换了一个错法。这就是 Day 20 练习 4 讲的事:**调规则用的数据和打分用的数据要分开**,分开以后才知道涨的分是真的还是碰巧。第六部分做 Agent 评测时,这条规则会以「训练集、验证集、测试集」的名字再出现,道理和今天一模一样。

</details>

**验收标准:** `ticket_classifier.py` 跑出 18/20 和上面一样的混淆矩阵,并且你能不看文章写出 `classify` 和 `evaluate`;练习 2 先自己写出六行再核对;练习 3 能说清为什么修掉第二个坑后准确率反而降了;练习 4 能用一句话解释为什么「想要」不该进规则表。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 规则表 | 「类别对应关键词」的字典,改规则就是改数据,不用改代码 |
| 计分(scoring) | 每个类别数命中几个关键词,分高者胜 |
| 先到先得(first match) | Day 28 的办法:按顺序查,第一个命中的类别赢 |
| 优先级(priority) | 同分时谁赢的顺序;`max(priority, key=...)` 并列时保留第一个 |
| 未知 / 拒答 | 一个词都没命中时不猜,交给人工。Agent 里叫 abstain,比猜错便宜 |
| 准确率(accuracy) | 分对的张数 ÷ 总张数 |
| 混淆矩阵(confusion matrix) | 行是人工类别、列是规则类别的计数表;对角线是对的,其余是「谁被错成了谁」 |
| `dict.setdefault(k, v)` | 键在就交回已有的值,不在就先放进 `v` 再交回;用来造「字典套字典」 |
| 生成器表达式 | 去掉方括号的推导式,直接喂给 `sum`、`join`,边产边用(Day 99 细讲) |
| `f"{x:>6}"` | 右对齐占 6 格;`<` 左对齐,`^` 居中 |
| `f"{x:.0%}"` | 把 0.9 显示成 `90%` |
| 留出数据(holdout) | 调规则时不看的那部分数据,用来量真实水平 |

## 常见误区

**把人工类别当成系统里本来就有的。** 真实系统里只有规则(或模型)判的类别,人工标注是专门为了评测准备的。日报用 `rule`,评测才用 `human`。

**计分表里一个词算多次。** `"a" in "aaa"` 只命中一次。计的是命中了几个关键词,不是出现了几次。

**`max(d, key=...)` 并列时以为随机。** 它保留遍历顺序里的第一个最大值。遍历 `priority` 而不是 `scores`,就是为了让并列规则可控。

**往字典套字典里写值前没造内层字典。** `confusion[human][rule] = ...` 在 `human` 第一次出现时是 `KeyError`。用 `setdefault` 或先 `if human not in confusion`。

**拿类别名和 0 比。** `if best == 0` 永远为假,因为 `best` 是字符串。要比的是 `scores[best]`。

**忘了 `lower()`,英文关键词悄悄失效。** 不报错,只是英文工单全部 0 分。评测里「英文工单全进未知」就是信号。

**修好 bug 后准确率下降就改回去。** 之前的分里可能有蒙对的。看矩阵和每张的计分证据,不只看一个数。

**在同一批数据上调规则又打分。** 调到 20/20 很容易,但那是「背答案」。留一批没调过的数据量真实水平。

**每个零件都在函数里 `print`。** `load` 交回坏行清单而不是打印,`evaluate` 交回字典而不是打印,打印交给 `main` 或 `show_*`。零件不打印,才能被别的脚本复用(明天拆模块就靠这一点)。

## 学习资料

### 文档与文章

- [Python 库参考 · 格式规格迷你语言](https://docs.python.org/zh-cn/3.12/library/string.html#format-specification-mini-language):中文,`:>6`、`:.0%`、`:,.2f` 这些格式写法的完整表,今天第一次用到对齐和百分号。
- [Python 库参考 · `dict.setdefault`](https://docs.python.org/zh-cn/3.12/library/stdtypes.html#dict.setdefault):中文,一句话的说明,配今天 `evaluate` 里的用法看。
- [Python 参考 · 生成器表达式](https://docs.python.org/zh-cn/3.12/reference/expressions.html#generator-expressions):中文,`sum(1 for ...)` 这种写法的正式名字,现在只需要知道它和列表推导式长得一样、少一对方括号。
- [Google 机器学习速成课 · 准确率、精确率和召回率](https://developers.google.com/machine-learning/crash-course/classification/accuracy-precision-recall?hl=zh-cn):中文,用混淆矩阵引出几个指标,今天只用到准确率,后面评测课会用到另外几个。
- [维基百科 · 混淆矩阵](https://zh.wikipedia.org/wiki/%E6%B7%B7%E6%B7%86%E7%9F%A9%E9%98%B5):中文,一张表加几个定义,够用。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1oz4y1R71a&autoplay=0&high_quality=1" title="【小萌五分钟】机器学习 | 混淆矩阵 Confusion Matrix" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小萌Annie · 【小萌五分钟】机器学习 | 混淆矩阵 · 5 分钟,用最简单的两类例子讲矩阵的四个格子怎么读,对应今天第三步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1dr4y1q7jT&autoplay=0&high_quality=1" title="【Python】5分钟重构代码从此更简洁美观" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>羽芋羊 · 5分钟重构代码从此更简洁美观 · 5 分钟,把一大段脚本拆成函数的几个习惯,今天「零件先单独跑通再拼」就是这么来的。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Kdsp6soqA7o" title="Machine Learning Fundamentals: The Confusion Matrix" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>StatQuest with Josh Starmer · The Confusion Matrix · 英文,7 分钟,讲混淆矩阵最有名的一集,看完就知道为什么对角线以外的格子才是重点。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/daefaLgNkw0" title="Python Tutorial for Beginners 5: Dictionaries - Working with Key-Value Pairs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Corey Schafer · Dictionaries - Working with Key-Value Pairs · 英文,10 分钟,字典的复习,`get`、`items` 和更新,今天的计数和矩阵全靠这些。</figcaption>
</figure>

### 书籍

- Allen B. Downey《Think Python》第 3 版,O'Reilly,2024。第 11 章「Dictionaries」里的「Dictionary as a collection of counters」和第 10 章的「Debugging」,和今天计数、找坑的思路一样。全书在作者网站 [greenteapress.com](https://greenteapress.com/wp/think-python-3rd-edition/) 免费在线读。
- Al Sweigart《Automate the Boring Stuff with Python》第 2 版,No Starch Press,2019。第 5 章「Dictionaries and Structuring Data」,用字典给数据建模,2025 年出了第 3 版。

### 开源项目与代码

- 今天这组不需要:项目日的代码全在文章里,练习仓库就是最好的参考。

## 自测

1. 「发票PDF下载不了,还被多扣了299元」在先到先得规则下为什么判成功能,计分规则下为什么判成计费?

<details><summary>答案</summary>

先到先得按优先级先查功能类,`pdf` 命中就直接返回,不再看别的。计分规则把三类都数一遍:功能 1 分(`pdf`),计费 2 分(「发票」「扣」),分高的计费赢。

</details>

2. `max(["功能", "计费", "登录"], key=lambda c: scores[c])`,当三类得分是 `{"功能": 1, "计费": 1, "登录": 0}` 时交回什么?为什么?

<details><summary>答案</summary>

`"功能"`。`max` 遇到并列的最大值保留第一个遇到的,而遍历顺序是传进去的列表,功能排第一。

</details>

3. 下面的混淆矩阵里,哪一类最容易被规则漏掉?哪一类最容易混进别人的工单?

```text
人工\规则  功能  计费  登录
     功能    5    0    1
     计费    2    6    0
     登录    0    0    6
```

<details><summary>答案</summary>

横着看漏判:计费有 2 张被判成了功能,漏得最多。竖着看误判:功能那一列有 2 张本来是计费的混进来了,功能类混进的最多。两个结论指向同一件事:功能类的词抢了计费类的工单。

</details>

4. `confusion.setdefault(human, {})` 和 `confusion.get(human, {})` 的区别?

<details><summary>答案</summary>

`get` 只读:键不在就交回一个临时的 `{}`,字典本身不变,往这个临时字典里写不会影响 `confusion`。`setdefault` 会把 `{}` 真的放进字典再交回,后续往里写就是写进 `confusion`。造「字典套字典」要用 `setdefault`。

</details>

5. 为什么规则表里不该加「想要」这个词?

<details><summary>答案</summary>

它和类别没关系,哪一类的客户都会说。在手里的数据上它碰巧只出现在功能类,加进去手里的准确率涨了,但在新数据上会把带「想要」的计费、登录工单拉向功能。只能用没调过的数据判断一个词值不值得加。

</details>

6. **面试题**:一个分类器准确率 90%,你还想看什么才敢说它好用?

<details><summary>答案</summary>

至少三样:混淆矩阵(错在哪一类、是漏判还是误判,各类别的错是不是集中在少数几类);这 90% 是在哪批数据上量的(调规则或训练时见过的数据,还是留出的新数据);以及拿不准时它怎么办(是硬猜还是会说「未知」交给人工,拒答率多少)。只有一个准确率数字,既不知道怎么改,也不知道上线后会不会掉。

</details>

## 明天预告

Day 32 · 模块:import 和 from ... import。今天的 `ticket_classifier.py` 有 160 多行,`clean`、`parse`、`classify` 这些零件下周的项目还要用,总不能每次复制一遍。明天把它拆成两个文件:规则和零件放一个文件,数据和流程放另一个,用 `import` 接起来。你已经写过很多次 `import unicodedata`、`import json`,明天讲清楚 `import` 到底做了什么、`from ... import` 和它的区别、为什么 Day 10 的 `main.py` 里有一句 `if __name__ == "__main__":`。
