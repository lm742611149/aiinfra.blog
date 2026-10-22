---
title: 'Day 142 · 提示词(四):让模型先想再答'
description: '同一道退款计算题,只要数字时 deepseek-flash 8 道里只对 3 道,让它先把步骤写出来就 8 道全对,代价是输出 token 多了五六倍。今天用云簿的退款规则,把「先想再答」(思维链)从一句话做到用标签分开推理和答案,再和模型自带的思考模式比一比对错、token 和钱。'
pubDate: 2026-10-22
regime: none
tags: ['prompt-engineering', 'chain-of-thought', 'agent-zero']
series: 'agent-zero'
day: 142
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 141](/blog/agent-zero/day-141-prompt-3/) 讲了 few-shot:说不清楚的要求,给模型看几个例子,它照着做。再往前,[Day 140](/blog/agent-zero/day-140-prompt-2/) 讲的是给背景、给定义、给理由。这两招解决的都是「模型不知道你要什么」。

今天换一类问题:模型知道你要什么,规则也看懂了,可就是算错。这种错很多时候不是它笨,是你没给它算的机会。今天的手段只有一个:让它先想再答。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清楚「先想再答」为什么能让模型少算错,用 [Day 106](/blog/agent-zero/day-106-next-token/) 学过的「一个 token 一个 token 往外猜」来解释。
2. 写一个提示词,让模型把推理写在 `<thinking>` 里、答案写在 `<answer>` 里,再用一个十行的函数把答案抠出来。
3. 在 8 道退款题上跑出三组数字(直接答、标签先想、开思考模式),能说出哪种该用在哪。
4. 遇到「答案抠不出来」时知道先查哪两处:标签有没有写、输出是不是被 `max_tokens` 截断了。

预计用时:2.5 小时。前置:[Day 115](/blog/agent-zero/day-115-reasoning-models/)(思考模式)、[Day 135](/blog/agent-zero/day-135-llm-client-1/)–[Day 136](/blog/agent-zero/day-136-llm-client-2/)(`common/llm.py` 里的 `LLMClient`)、[Day 124](/blog/agent-zero/day-124-cost/)(从 usage 算钱)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `between()` 和 `cot_compare.py` 的主循环默写出来;再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先准备一道真要算的题

前几天的工单分类太简单了,现在的模型直接答也几乎全对,看不出「先想」有什么用。所以今天换一个要算好几步的任务:按云簿 CloudLedger 的退款规则算退多少钱。

规则是我为这门课编的,四条:

- 月付不退。
- 年付在 30 天内申请,全额退。
- 年付超过 30 天,按没用完的月份退,用了的月份有零头就算一整个月。
- 按第三条退的,再扣 6% 手续费,四舍五入到元。

拿第一道题手算一遍:年付实付 2388 元,9 月 1 日买,10 月 20 日申请。9 月 1 日到 10 月 20 日是 49 天,超过 30 天,走第三条;9 月 1 日到 10 月 1 日是一个整月,剩下 19 天是零头,所以算用了 2 个月;2388 ÷ 12 = 199,199 × (12 − 2) = 1990;扣 6% 手续费,1990 × 0.94 = 1870.6,四舍五入是 1871。

你算的时候也是一步一步来的:先判断走哪条,再数月份,再乘,再扣。跳过任何一步直接写数字,人也容易错。记住这个感觉,后面模型的表现跟这个一模一样。

先把规则和 8 道题写成一个数据文件。在 `agent-zero-lab` 目录下新建 `part02/refund_cases.py`(`part02/` 和里面的 `__init__.py` 是 [Day 134](/blog/agent-zero/day-134-streaming-code/) 前后就建好的;没有的话先 `mkdir -p part02 && touch part02/__init__.py`):

```python
# agent-zero-lab/part02/refund_cases.py
POLICY = """云簿 CloudLedger 退款规则:
1. 月付套餐不退款,退款金额为 0。
2. 年付套餐:申请日期减去购买日期的天数小于等于 30 天,全额退还实付金额。
3. 年付套餐超过 30 天:已用月数 = 从购买日到申请日经过的整月数,有零头再加 1;退款 = 实付金额 ÷ 12 × (12 − 已用月数)。
4. 按第 3 条退款时,再扣 6% 手续费,最后四舍五入到元。"""

# (工单, 正确退款金额)。金额是人按上面四条规则手算的
CASES: list[tuple[str, int]] = [
    ("年付,实付 2388 元,2026-09-01 购买,2026-10-20 申请退款", 1871),  # 49 天,用 2 个月
    ("月付,实付 199 元,2026-10-01 购买,2026-10-03 申请退款", 0),  # 月付不退
    ("年付,实付 1188 元,2026-03-10 购买,2026-04-05 申请退款", 1188),  # 26 天,全额
    ("年付,实付 2188 元,2026-01-15 购买,2026-06-15 申请退款", 1200),  # 正好 5 个月
    ("年付,实付 3588 元,2026-02-20 购买,2026-03-25 申请退款", 2811),  # 33 天,用 2 个月
    ("年付,实付 960 元,2025-12-05 购买,2026-08-28 申请退款", 226),  # 用 9 个月
    ("年付,实付 2388 元,2026-05-08 购买,2026-06-07 申请退款", 2388),  # 正好 30 天,全额
    ("年付,实付 1788 元,2026-04-12 购买,2026-07-11 申请退款", 1261),  # 差一天满 3 个月
]
```

<div class="line-notes">

- `POLICY = """云簿 CloudLedger 退款规则:` 三引号字符串可以跨行,相当于 JS 的反引号模板字符串(只是不插值)。这段规则后面每个脚本都会拼进 system 提示词里,实测 `len(POLICY)` 是 189 个字符。
- `2. 年付套餐:申请日期减去购买日期的天数小于等于 30 天` 「30 天内」这种说法人和模型都会有歧义(含不含第 30 天?),所以我写成了能直接算的形式。规则本身写不清楚,再怎么让模型想也没用。
- `3. 年付套餐超过 30 天:已用月数 =` 这一条是整个任务里最容易错的地方:要数整月,还要看有没有零头。
- `CASES: list[tuple[str, int]] = [` 类型标注读作「一个列表,每个元素是 (字符串, 整数) 二元组」,相当于 TS 的 `Array<[string, number]>`。元组见 [Day 22](/blog/agent-zero/day-022-tuples-unpack/)。
- `("年付,实付 2388 元,2026-09-01 购买,2026-10-20 申请退款", 1871),` 就是上面手算的那道。`CASES[0]` 是 `('年付,实付 2388 元,…', 1871)`。
- `("月付,实付 199 元,2026-10-01 购买,2026-10-03 申请退款", 0),` 月付,一步就能判断,用来看模型会不会被「才用了两天」带偏。
- `("年付,实付 2188 元,2026-01-15 购买,2026-06-15 申请退款", 1200),` 1 月 15 日到 6 月 15 日正好 5 个整月,没有零头,不加 1。2188 ÷ 12 × 7 = 1276.33,× 0.94 = 1199.75,四舍五入 1200。
- `("年付,实付 3588 元,2026-02-20 购买,2026-03-25 申请退款", 2811),` 33 天,刚过 30 天这条线。3588 ÷ 12 = 299,× 10 = 2990,× 0.94 = 2810.6 → 2811。
- `("年付,实付 2388 元,2026-05-08 购买,2026-06-07 申请退款", 2388),` 5 月 8 日到 6 月 7 日正好 30 天,按规则「小于等于 30」全额退。边界题。
- `("年付,实付 1788 元,2026-04-12 购买,2026-07-11 申请退款", 1261),` 差一天满 3 个月:整月 2 个,有零头加 1,还是 3 个月。1788 ÷ 12 = 149,× 9 = 1341,× 0.94 = 1260.54 → 1261。

</div>

这个文件不调 API,不花钱。每道题的正确答案我都手算过一遍,又用一小段 Python 按规则算了一遍对上了。**测试数据的正确答案(gold label)一定要人确认过**,不然后面算准确率就是在拿错的尺子量。

## 第一步:只要数字,看它错

先用最省事的问法:把规则放进 system,要求只输出数字。新建 `part02/cot_direct.py`:

```python
# agent-zero-lab/part02/cot_direct.py
from common.llm import LLMClient
from part02.refund_cases import CASES, POLICY

SYSTEM = POLICY + "\n\n只输出退款金额的数字,不要任何其他内容。"

client = LLMClient()
ticket, gold = CASES[0]
r = client.chat(
    [{"role": "system", "content": SYSTEM}, {"role": "user", "content": ticket}],
    temperature=0,
    max_tokens=800,
)
print("工单:", ticket)
print("模型:", repr(r.content))
print("正确:", gold)
print(f"输出 {r.completion_tokens} token,花费 ¥{r.cost:.6f}")
```

<div class="line-notes">

- `from common.llm import LLMClient` 这是 Day 135–136 写的封装,`chat()` 返回一个 `ChatResult`,里面有 `content`、`completion_tokens`、`cost` 等字段。它会读项目根目录的 `.env`,我的 `.env` 里 `LLM_MODEL=deepseek-flash`,`LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`,也就是默认关掉思考模式。
- `SYSTEM = POLICY + "\n\n只输出退款金额的数字,不要任何其他内容。"` 字符串用 `+` 拼接,和 JS 一样。`\n\n` 是空一行,让规则和要求分开。实测这个 SYSTEM 长 211 个字符。
- `ticket, gold = CASES[0]` 元组拆包,相当于 JS 的 `const [ticket, gold] = CASES[0]`。拆完 `ticket` 是第一道题的文字,`gold = 1871`。
- `[{"role": "system", "content": SYSTEM}, {"role": "user", "content": ticket}],` 两条消息:规则和要求放 system,题目放 user。为什么这样分见 [Day 130](/blog/agent-zero/day-130-system-prompt/)。
- `temperature=0,` 让它每次尽量挑概率最高的 token。注意是「尽量」,下面就会看到同样的输入照样会变。
- `max_tokens=800,` 给够空间。只要一个数字的话用不了几个 token,但后面的版本要写推理,统一给 800。
- `print("模型:", repr(r.content))` `repr()` 会把字符串连引号一起打出来,多了空格或换行一眼能看见。实测 `'2388'`。
- `print(f"输出 {r.completion_tokens} token,花费 ¥{r.cost:.6f}")` 实测 `输出 2 token,花费 ¥0.000376`。按 Day 124 的算法倒推:输出 2 × 8 元/百万,剩下的是输入,(376 − 16) ÷ 2 = 180 个输入 token。

</div>

在 `agent-zero-lab` 目录下跑:

```bash
cd agent-zero-lab
uv run python -m part02.cot_direct
```

我的输出(2026-10-22,deepseek-flash,关思考):

```text
工单: 年付,实付 2388 元,2026-09-01 购买,2026-10-20 申请退款
模型: '2388'
正确: 1871
输出 2 token,花费 ¥0.000376
```

它直接给了全额 2388,相当于把 49 天当成了 30 天以内。我又连跑了两次,第二次还是 `'2388'`,第三次变成了 `'0'`,把年付当成了月付。`temperature=0` 也不保证每次一样,[Day 112](/blog/agent-zero/day-112-sampling-2/) 讲过原因。

一个数字答错了还看不出错在哪,这是只要答案的另一个问题:你没法 debug。

## 为什么「先写过程」会更准

回到 [Day 106](/blog/agent-zero/day-106-next-token/) 那句话:大模型只做一件事,猜下一个 token。上面那次调用,模型读完规则和题目,下一步要猜的就是答案的第一个 token。也就是说,判断走哪条规则、数月份、乘、扣手续费,这些全得在「猜一个 token」的那一下里完成。人心算也会在这种时候出错。

如果让它先写过程,情况就变了。它先写出「相差 49 天」,这几个字就成了上文的一部分;接下来猜「49 > 30,走第 3 条」的时候,它能「看到」前面写的 49;再往后猜「已用 2 个月」「1990」「1870.6」,每一步都能看到前面已经写下来的中间结果。写出来的每一行,都相当于给后面的计算留了一张草稿纸。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="直接答和先想再答的生成过程对比">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="30" fill="var(--ink)">直接答:读完题,下一个 token 就得是答案</text>
<rect x="20" y="44" width="150" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="65" fill="var(--ink)">规则 + 题目</text>
<rect x="190" y="44" width="80" height="32" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="206" y="65" fill="var(--ink)">2388</text>
<text x="284" y="65" fill="var(--ink-soft)">所有计算挤在这一步里</text>
<line x1="170" y1="60" x2="190" y2="60" stroke="var(--rule)"/>
<text x="20" y="116" fill="var(--ink)">先想再答:每写一步,下一步都能看到它</text>
<rect x="20" y="130" width="150" height="32" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="151" fill="var(--ink)">规则 + 题目</text>
<rect x="180" y="130" width="64" height="32" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="190" y="151" fill="var(--ink)">49 天</text>
<rect x="252" y="130" width="78" height="32" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="262" y="151" fill="var(--ink)">走第 3 条</text>
<rect x="338" y="130" width="70" height="32" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="346" y="151" fill="var(--ink)">用 2 月</text>
<rect x="416" y="130" width="56" height="32" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="426" y="151" fill="var(--ink)">1990</text>
<rect x="480" y="130" width="64" height="32" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="486" y="151" fill="var(--ink)">1870.6</text>
<rect x="552" y="130" width="68" height="32" rx="4" fill="var(--mem)" stroke="var(--mem)"/>
<text x="566" y="151" fill="var(--paper-raised)">1871</text>
<path d="M212 166 C 212 196, 590 196, 590 166" fill="none" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<path d="M290 166 C 290 186, 440 186, 440 166" fill="none" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<text x="20" y="226" fill="var(--ink-faint)">虚线:后面的 token 生成时能看到前面写下的中间结果。代价是多输出了几百个 token。</text>
</g>
</svg>
<figcaption>同一道题的两种生成方式。直接答只有一步可猜;先想再答把计算拆成很多步,每一步都站在前面写出来的结果上。</figcaption>
</figure>

这个做法叫**思维链**(Chain-of-Thought,简称 CoT):让模型先写出推理过程,再给结论。出处是 Google 2022 年的论文《Chain-of-Thought Prompting Elicits Reasoning in Large Language Models》,当时的做法是在 few-shot 例子里把解题步骤写出来,模型就跟着写步骤。同年另一篇论文《Large Language Models are Zero-Shot Reasoners》发现连例子都不用给,在问题后面加一句「Let's think step by step」就有效。

现在不用再纠结哪种写法。2026 年的模型,你一句话说「先一步步算」它就会照做。下面直接试。

## 第二步:加一句「先一步步算」

`part02/cot_steps.py` 跟上一个脚本只差一行,把「只输出数字」换成「先一步步算」:

```python
# agent-zero-lab/part02/cot_steps.py
from common.llm import LLMClient
from part02.refund_cases import CASES, POLICY

SYSTEM = POLICY + "\n\n先一步步算出结果,把每一步写出来,最后一行写「答案:金额数字」。"

client = LLMClient()
ticket, gold = CASES[0]
r = client.chat(
    [{"role": "system", "content": SYSTEM}, {"role": "user", "content": ticket}],
    temperature=0,
    max_tokens=800,
)
print(r.content)
print("-----")
print("正确:", gold)
print(f"输出 {r.completion_tokens} token,花费 ¥{r.cost:.6f},耗时 {r.latency:.1f}s")
```

<div class="line-notes">

- `SYSTEM = POLICY + "\n\n先一步步算出结果` 唯一的改动。「最后一行写答案」是给程序留的抓手:推理一大段,程序总得知道去哪找数字。
- `print(r.content)` 这次把完整输出打出来看看它写了什么。
- `print(f"输出 {r.completion_tokens} token,花费 ¥{r.cost:.6f},耗时 {r.latency:.1f}s")` `r.latency` 是 `LLMClient` 量的请求耗时(秒),`:.1f` 保留一位小数。实测 `输出 335 token,花费 ¥0.003056,耗时 1.7s`。

</div>

```bash
uv run python -m part02.cot_steps
```

我的输出:

```text
好的，我们一步步来算。  

**第一步：判断天数差**  
购买日期：2026-09-01  
申请日期：2026-10-20  
9月1日到10月1日是30天，10月1日到10月20日是19天，所以一共是 30 + 19 = 49 天。  
49 天 > 30 天，所以不适用全额退款，进入第3条规则。  

**第二步：计算已用月数**  
从 2026-09-01 到 2026-10-20：  
- 整月：9月1日到10月1日 = 1 个整月  
- 剩余零头：10月1日到10月20日，有零头，所以加 1 个月  
已用月数 = 1 + 1 = 2 个月  

**第三步：按第3条计算退款（未扣手续费）**  
退款 = 实付金额 ÷ 12 × (12 − 已用月数)  
= 2388 ÷ 12 × (12 − 2)  
= 199 × 10  
= 1990 元  

**第四步：扣 6% 手续费**  
手续费 = 1990 × 6% = 119.4 元  
扣手续费后 = 1990 − 119.4 = 1870.6 元  

**第五步：四舍五入到元**  
1870.6 元 → 1871 元  

答案:1871
-----
正确: 1871
输出 335 token,花费 ¥0.003056,耗时 1.7s
```

对了,而且每一步你都能检查。它的步骤和你前面手算的几乎一样。

代价也很清楚:输出从 2 个 token 变成 335 个,花费从 ¥0.000376 变成 ¥0.003056,差不多 8 倍。DeepSeek 的输出单价(8 元/百万 token)是未命中输入(2 元/百万)的 4 倍,多写的每个字都按贵的那个价算。

还有个麻烦:程序要从这一大段里把 1871 拿出来。「最后一行写答案」不太靠得住,它前面加了「好的,我们一步步来算」,用了 markdown 加粗,中英文冒号也可能混着用。下一步解决这个。

## 第三步:用标签把推理和答案分开

办法是让模型把两部分各自装进一对标签里:推理放 `<thinking>…</thinking>`,答案放 `<answer>…</answer>`。程序只认标签,标签外面写了什么都不管。标签长得像 HTML,但它不是给浏览器的,只是一个约定好的记号,模型和你的代码都按这个记号找东西。明天会专门讲标签,今天只用它来切答案。

先写抠标签内容的函数。最直觉的写法是用 `split`,我第一次就这么写的。新建 `part02/naive_split.py` 试一下:

```python
# agent-zero-lab/part02/naive_split.py
good = "<thinking>49 天,超过 30 天……</thinking>\n<answer>1871</answer>"
bad = "2388"

print(good.split("<answer>")[1].split("</answer>")[0])
print(bad.split("<answer>"))
print(bad.split("<answer>")[1].split("</answer>")[0])
```

<div class="line-notes">

- `good = "<thinking>49 天,超过 30 天……</thinking>\n<answer>1871</answer>"` 模拟模型乖乖按格式输出的情况。
- `bad = "2388"` 模拟模型没按格式写,只给了一个数字。真实情况里这很常见,第一步的输出就是这个样子。
- `print(good.split("<answer>")[1].split("</answer>")[0])` `split` 和 JS 的 `split` 一样,按分隔符切成列表。先按 `<answer>` 切,取第 2 段(下标 1)`'1871</answer>'`,再按 `</answer>` 切取第 1 段,得到 `1871`。
- `print(bad.split("<answer>"))` 字符串里没有分隔符时,`split` 返回只有一个元素的列表,实测 `['2388']`。
- `print(bad.split("<answer>")[1]` 对只有一个元素的列表取下标 1,Python 直接报错。JS 里 `['2388'][1]` 只会得到 `undefined`,Python 不会默默给你一个空值。

</div>

```bash
uv run python -m part02.naive_split
```

```text
1871
['2388']
Traceback (most recent call last):
  File "<frozen runpy>", line 198, in _run_module_as_main
  File "<frozen runpy>", line 88, in _run_code
  File ".../agent-zero-lab/part02/naive_split.py", line 7, in <module>
    print(bad.split("<answer>")[1].split("</answer>")[0])
          ~~~~~~~~~~~~~~~~~~~~~^^^
IndexError: list index out of range
```

`IndexError: list index out of range` 就是「列表没有这么多个元素」([Day 35](/blog/agent-zero/day-035-exceptions-1/) 讲过怎么读报错)。traceback 里 `~~~^^^` 那一行把出错的位置标了出来:正是 `[1]`。模型的输出你控制不了,所以解析代码不能假设它一定守规矩。找不到就返回 `None`,让调用方自己决定怎么办。

新建 `part02/tags.py`,这个函数明天和后天还会用:

```python
# agent-zero-lab/part02/tags.py
def between(text: str, start: str, end: str) -> str | None:
    """取 start 和 end 之间的文字;找不到就返回 None。"""
    i = text.find(start)
    if i == -1:
        return None
    i += len(start)
    j = text.find(end, i)
    if j == -1:
        return None
    return text[i:j].strip()


if __name__ == "__main__":
    print(repr(between("<thinking>49 天</thinking>\n<answer> 1871 </answer>", "<answer>", "</answer>")))
    print(repr(between("2388", "<answer>", "</answer>")))
    print(repr(between("<answer>1871", "<answer>", "</answer>")))
```

<div class="line-notes">

- `def between(text: str, start: str, end: str) -> str | None:` 返回类型 `str | None` 读作「要么字符串,要么 None」,相当于 TS 的 `string | null`([Day 46](/blog/agent-zero/day-046-type-hints-2/))。
- `i = text.find(start)` `find` 返回子串第一次出现的位置,找不到返回 -1,和 JS 的 `indexOf` 一模一样。第一个测试里 `start` 是 `<answer>`,实测 `i = 26`。
- `if i == -1:` 没有开始标签,说明模型没按格式写,直接返回 None。
- `i += len(start)` 跳过 `<answer>` 这 8 个字符本身,`i` 变成 34,指向答案的第一个字符。
- `j = text.find(end, i)` 第二个参数是「从哪开始找」,JS 的 `indexOf(end, i)` 也是这样。从答案开头往后找结束标签。
- `if j == -1:` 有开始没结束,常见原因是输出被 `max_tokens` 截断了,练习 4 会故意造一次。
- `return text[i:j].strip()` 切片取 `[i, j)` 这一段([Day 15](/blog/agent-zero/day-015-strings-1/)),`strip()` 去掉首尾空白,相当于 JS 的 `trim()`。第一个测试实测得到 `'1871'`,前后的空格被去掉了。
- `if __name__ == "__main__":` 只有直接运行这个文件时才执行下面三行测试;被别的文件 `import` 时不执行([Day 32](/blog/agent-zero/day-032-modules/))。这行后面会救我们一次。
- `print(repr(between("2388", "<answer>", "</answer>")))` 没有标签,实测 `None`,不再报错。
- `print(repr(between("<answer>1871", "<answer>", "</answer>")))` 有开始没结束,实测也是 `None`。

</div>

```bash
uv run python -m part02.tags
```

```text
'1871'
None
None
```

然后写带标签的版本 `part02/cot_tags.py`:

```python
# agent-zero-lab/part02/cot_tags.py
from common.llm import LLMClient
from part02.refund_cases import CASES, POLICY
from part02.tags import between

SYSTEM = POLICY + """

先在 <thinking> 标签里一步步算:套餐类型、相差天数、已用月数、退款金额、手续费。
然后在 <answer> 标签里只写最后的金额数字,不带单位。"""

client = LLMClient()
ticket, gold = CASES[0]
r = client.chat(
    [{"role": "system", "content": SYSTEM}, {"role": "user", "content": ticket}],
    temperature=0,
    max_tokens=800,
)
thinking = between(r.content, "<thinking>", "</thinking>")
answer = between(r.content, "<answer>", "</answer>")
print("推理:", thinking)
print("答案:", repr(answer))
print("对不对:", answer is not None and int(answer) == gold)
print(f"输出 {r.completion_tokens} token,花费 ¥{r.cost:.6f}")
```

<div class="line-notes">

- `先在 <thinking> 标签里一步步算:套餐类型、相差天数、已用月数、退款金额、手续费。` 和第二步比多了两样东西:标签,以及「算哪几步」的清单。清单是从我手算的步骤里抄来的,它让模型不会漏掉「扣手续费」这种容易忘的步骤。
- `然后在 <answer> 标签里只写最后的金额数字,不带单位。` 「不带单位」是给下面 `int()` 准备的,`int("1871元")` 会报错。
- `thinking = between(r.content, "<thinking>", "</thinking>")` 推理那段也抠出来,打印给人看。线上系统里这段可以存进日志,出了错回头查它是哪一步算歪的。
- `answer = between(r.content, "<answer>", "</answer>")` 实测 `'1871'`,注意是字符串。
- `print("对不对:", answer is not None and int(answer) == gold)` `and` 是短路的,和 JS 的 `&&` 一样:`answer` 是 None 时后面的 `int(answer)` 根本不会执行,不会报错。`int("1871")` 把字符串转成整数,相当于 JS 的 `parseInt`,但更严格,`int("1871。")` 会抛 `ValueError`。实测 `True`。
- `print(f"输出 {r.completion_tokens} token,花费 ¥{r.cost:.6f}")` 实测 `输出 222 token,花费 ¥0.002198`,比第二步的 335 token 少,因为没写「好的,我们一步步来算」和 markdown 加粗。

</div>

```bash
uv run python -m part02.cot_tags
```

```text
推理: 套餐类型：年付。
购买日期：2026-09-01，申请日期：2026-10-20。
相差天数：9月1日到10月1日是30天，10月1日到10月20日是19天，共49天。49 > 30，不适用全额退款，走第3条。
已用月数：从2026-09-01到2026-10-20，整月数为1（9月1日到10月1日），有零头（10月1日到10月20日）再加1，已用月数 = 2。
退款 = 2388 ÷ 12 × (12 − 2) = 199 × 10 = 1990 元。
手续费：1990 × 6% = 119.4 元。
扣手续费后：1990 − 119.4 = 1870.6 元。
四舍五入到元：1871 元。
答案: '1871'
对不对: True
输出 222 token,花费 ¥0.002198
```

推理和答案分开了,程序拿到干净的 `'1871'`,人要看过程就看 `thinking`。

## 第四步:8 道题,三种做法一起比

一道题说明不了什么。现在把 8 道题都跑一遍,比三种做法:

- **直接答**:第一步那种,只要数字。
- **标签先想**:第三步那种,关掉思考模式,靠提示词让它在 `<thinking>` 里写推理。
- **思考模式**:提示词还是「只要数字」,但打开 DeepSeek 自带的思考模式([Day 115](/blog/agent-zero/day-115-reasoning-models/) 讲过),让模型在 `reasoning_content` 里自己想。

第三种你可能会问:提示词里不让它想,开了思考模式它还是会想吗?会。思考模式下,模型在正式回答前先生成一段推理,这段推理走的是 `reasoning_content` 字段,不在 `content` 里。本质上就是厂商把「先想再答」做进了模型本身。

新建 `part02/cot_compare.py`:

```python
# agent-zero-lab/part02/cot_compare.py
import time

from common.llm import LLMClient
from part02.refund_cases import CASES, POLICY
from part02.tags import between

DIRECT = POLICY + "\n\n只输出退款金额的数字,不要任何其他内容。"
COT = POLICY + """

先在 <thinking> 标签里一步步算:套餐类型、相差天数、已用月数、退款金额、手续费。
然后在 <answer> 标签里只写最后的金额数字,不带单位。"""

MODES = {
    "直接答": (DIRECT, {"thinking": {"type": "disabled"}}),
    "标签先想": (COT, {"thinking": {"type": "disabled"}}),
    "思考模式": (DIRECT, {"thinking": {"type": "enabled"}}),
}


def to_int(text: str | None) -> int | None:
    if text is None:
        return None
    try:
        return int(text.strip())
    except ValueError:
        return None


def main() -> None:
    client = LLMClient()
    for name, (system, extra) in MODES.items():
        before = client.ledger.cost
        out_tokens = 0
        correct = 0
        start = time.perf_counter()
        for ticket, gold in CASES:
            r = client.chat(
                [{"role": "system", "content": system}, {"role": "user", "content": ticket}],
                temperature=0,
                max_tokens=4000,
                extra_body=extra,
            )
            raw = between(r.content, "<answer>", "</answer>") if name == "标签先想" else r.content
            pred = to_int(raw)
            out_tokens += r.completion_tokens
            if pred == gold:
                correct += 1
            else:
                print(f"  ✗ [{name}] {ticket[:22]}… 正确 {gold},得到 {r.content[-20:]!r}")
        cost = client.ledger.cost - before
        seconds = time.perf_counter() - start
        print(f"{name}: 对 {correct}/{len(CASES)}  输出 {out_tokens} token  ¥{cost:.4f}  {seconds:.0f}s")
    print("合计:", client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import time` 标准库,下面用 `time.perf_counter()` 计时,相当于浏览器里的 `performance.now()`,只是单位是秒。
- `DIRECT = POLICY + "\n\n只输出退款金额的数字` 和 `cot_direct.py` 里的 SYSTEM 一字不差。
- `COT = POLICY + """` 和 `cot_tags.py` 里的 SYSTEM 一字不差,实测长 269 个字符。两份复制我不喜欢,但今天先这样,Day 144 会把提示词搬进文件,就不用复制了。
- `MODES = {` 一个字典([Day 24](/blog/agent-zero/day-024-dicts/)),键是名字,值是 (提示词, 额外请求参数) 的二元组。Python 3.7 起字典保持插入顺序,所以下面会按「直接答 → 标签先想 → 思考模式」的顺序跑。
- `"直接答": (DIRECT, {"thinking": {"type": "disabled"}}),` 这个字典会原样放进请求体的 `thinking` 字段。DeepSeek 文档(2026-10 查)写的开关就是 `{"thinking": {"type": "enabled/disabled"}}`,用 OpenAI SDK 时要放在 `extra_body` 里传。
- `"思考模式": (DIRECT, {"thinking": {"type": "enabled"}}),` 提示词还是只要数字,区别只在开了思考。DeepSeek 默认就开思考,我的 `.env` 里把它默认关了,所以这里要显式打开。
- `def to_int(text: str | None) -> int | None:` 把模型的输出转成整数,转不了就返回 None。`try/except` 见 [Day 35](/blog/agent-zero/day-035-exceptions-1/),相当于 JS 的 `try/catch`,只是要写清楚接哪种异常。
- `return int(text.strip())` `int(" 1871\n".strip())` 得 1871;`int("四舍五入到元：1200\n\n1200")` 抛 `ValueError`,被下面接住返回 None。
- `for name, (system, extra) in MODES.items():` `.items()` 一次拿到键和值,值又是二元组,直接在括号里拆开。第一圈:`name = "直接答"`,`system = DIRECT`。
- `before = client.ledger.cost` `ledger` 是 `LLMClient` 里的累计账本,跑之前记一下,跑完相减就是这一种做法自己花的钱。
- `max_tokens=4000,` 比前面大,因为思考模式的推理也算在输出 token 里,也受 `max_tokens` 限制。给小了推理没写完就被截断。
- `extra_body=extra,` `LLMClient` 会把这里的 `extra_body` 盖在 `.env` 的 `LLM_EXTRA_BODY` 上面,所以每种做法用自己的思考开关。
- `raw = between(r.content, "<answer>", "</answer>") if name == "标签先想" else r.content` 这是 Python 的条件表达式,相当于 JS 的 `name === "标签先想" ? between(...) : r.content`。只有标签版需要抠标签,另外两种答案就是整个 content。
- `pred = to_int(raw)` 格式不对的输出在这里变成 None,和正确答案比肯定不相等,算错。
- `print(f"  ✗ [{name}] {ticket[:22]}… 正确 {gold},得到 {r.content[-20:]!r}")` `[-20:]` 取最后 20 个字符,`!r` 等于套一层 `repr()`。错的时候看结尾就知道它到底给了什么。
- `print(f"{name}: 对 {correct}/{len(CASES)}` 每种做法一行汇总,实测三行见下面。
- `print("合计:", client.ledger)` 实测 `合计: 24 次调用 | 输入 4762 / 输出 4332 tokens | 约 ¥0.0442`。

</div>

```bash
uv run python -m part02.cot_compare
```

我的输出(2026-10-22):

```text
  ✗ [直接答] 年付,实付 2388 元,2026-09-0… 正确 1871,得到 '2388'
  ✗ [直接答] 年付,实付 2188 元,2026-01-1… 正确 1200,得到 '  \n四舍五入到元：1200\n\n1200'
  ✗ [直接答] 年付,实付 3588 元,2026-02-2… 正确 2811,得到 '3588'
  ✗ [直接答] 年付,实付 960 元,2025-12-05… 正确 226,得到 '6，四舍五入到元 = 226。\n\n226'
  ✗ [直接答] 年付,实付 1788 元,2026-04-1… 正确 1261,得到 '4，四舍五入 = 1261。\n\n1261'
直接答: 对 3/8  输出 327 token  ¥0.0055  7s
标签先想: 对 8/8  输出 2109 token  ¥0.0202  11s
思考模式: 对 8/8  输出 1896 token  ¥0.0184  13s
合计: 24 次调用 | 输入 4762 / 输出 4332 tokens | 约 ¥0.0442
```

直接答的 5 个错里有两种错法,很值得细看。

第 1 题和第 5 题是**真算错了**:都给了全额(2388、3588),而它们分别是 49 天和 33 天,都过了 30 天的线。一步到位的时候,「超过 30 天」这个判断被跳过了。

另外 3 道(第 4、6、8 题)更有意思:数字其实算对了(1200、226、1261),但模型没听「只输出数字」的话,自己偷偷写了一段过程,最后才把数字写出来,`int()` 转不了,只能算错。题越难,模型越忍不住要先想。这本身就说明了「先想」有多重要,只不过它在不该写的地方写了。如果线上用的是直接答的格式,这 3 条会变成解析失败。

两种「先想」的做法都 8 道全对,钱和时间也差不多:标签先想 ¥0.0202,思考模式 ¥0.0184,都是直接答 ¥0.0055 的 3 倍多。输出 token 是 6 倍左右。

8 道题太少,一道题就是 12.5 个百分点,这里的数字只能看趋势,不能当结论。正式的评测要多少条数据,第六部分再讲。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="三种做法的对题数和花费">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink)">8 道退款题,deepseek-flash,2026-10-22 实测</text>
<text x="20" y="66" fill="var(--ink)">直接答</text>
<rect x="110" y="52" width="120" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="68" fill="var(--ink-soft)">对 3/8</text>
<rect x="330" y="52" width="55" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="395" y="68" fill="var(--ink-soft)">¥0.0055 · 327 token</text>
<text x="20" y="116" fill="var(--ink)">标签先想</text>
<rect x="110" y="102" width="320" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="118" fill="var(--ink)">对 8/8</text>
<text x="20" y="166" fill="var(--ink)">思考模式</text>
<rect x="110" y="152" width="320" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="168" fill="var(--ink)">对 8/8</text>
<text x="440" y="118" fill="var(--compute)">¥0.0202 · 2109 token</text>
<text x="440" y="168" fill="var(--compute)">¥0.0184 · 1896 token</text>
<text x="20" y="204" fill="var(--ink-faint)">蓝条长度 = 对的题数(满格 8 道);琥珀 = 这一种做法 8 次调用的花费和输出 token</text>
</g>
</svg>
<figcaption>直接答最便宜,但 8 道只对 3 道(2 道算错、3 道格式不对)。两种「先想」都全对,花费是它的 3 倍多。</figcaption>
</figure>

## 标签先想和思考模式,选哪个

两种都是让模型先想,区别在推理写在哪、谁说了算。

**思考模式**的推理在 `reasoning_content` 里,格式是模型自己定的,你管不着,也不保证每家都返回给你(有的厂商只给摘要,有的完全不给)。练习 3 你会看到,deepseek-flash 的思考内容是英文写的,开头是一句「We need answer only number」。好处是省事,提示词不用改,而且模型在这上面专门训练过,复杂题往往比你手写的步骤清单想得更周全。

**标签先想**的推理在 `content` 里,格式你说了算:你可以规定它按「套餐类型、天数、月数、金额、手续费」的顺序写,可以把这段推理原样存档、给客服主管看、拿来做审计。代价是提示词要多写几行,还得自己解析标签。

我自己的选法:

- 任务难、只关心答案:开思考模式,提示词里不用再写「一步步想」。
- 推理过程本身要给人看、要存档(比如退款理由、审批意见):用标签先想,关掉思考模式,免得模型想两遍、钱花两遍。
- 任务简单(比如 Day 140 那种工单分类):两个都不开。Day 145 会量给你看,简单任务加「先想」只是更慢更贵。

还有一个 2026 年才有的情况要知道:有些厂商的最新模型不让你这么干了。Anthropic 的提示词最佳实践文档(2026-10 查)写着,在 Claude Opus 5.5、Fable 5.1 等几款最新模型上,应该依靠模型自己的思考、需要省钱就调低 effort;如果提示词要求模型把推理写进 `<thinking>` 这类标签,请求「可能会被拒绝」。思考关得掉的模型,文档仍然推荐手写思维链作为后备,并且建议把最终答案放进 `<answer>` 标签方便提取,和今天的做法一样。换模型的时候,先看一眼那家的文档。

## 动手练习

所有练习都在 `agent-zero-lab` 目录下用 `uv run python -m part02.文件名` 跑。

**练习 1:把标签先想版跑完 8 道,逐题打印对错。** `cot_tags.py` 只跑了第一题。写一个 `part02/ex142_loop.py`,用同样的提示词把 8 道题都跑一遍,每题打一行「第几题、对/错、模型答案、正确答案、输出 token」,最后打印账本。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex142_loop.py
from common.llm import LLMClient
from part02.cot_compare import COT
from part02.refund_cases import CASES
from part02.tags import between

client = LLMClient()
for i, (ticket, gold) in enumerate(CASES, start=1):
    r = client.chat(
        [{"role": "system", "content": COT}, {"role": "user", "content": ticket}],
        temperature=0,
        max_tokens=800,
    )
    answer = between(r.content, "<answer>", "</answer>")
    mark = "对" if answer is not None and int(answer) == gold else "错"
    print(f"{i}. {mark}  模型 {answer}  正确 {gold}  输出 {r.completion_tokens} token")
print(client.ledger)
```

<div class="line-notes">

- `from part02.cot_compare import COT` 从 `cot_compare.py` 拿提示词,而不是从 `cot_tags.py` 拿。原因见「常见误区」第一条:我第一次写的是 `from part02.cot_tags import SYSTEM`,结果 import 的时候把 `cot_tags.py` 的调用也执行了一遍。`cot_compare.py` 的调用代码在 `if __name__ == "__main__":` 下面,import 它是安全的。
- `for i, (ticket, gold) in enumerate(CASES, start=1):` `enumerate` 给每个元素配一个序号,`start=1` 让序号从 1 开始,相当于 JS 的 `CASES.forEach(([ticket, gold], idx) => …)` 再加 1。第一圈 `i = 1`。
- `mark = "对" if answer is not None and int(answer) == gold else "错"` 条件表达式,和正文里一样。第一圈 `answer = '1871'`,`mark = "对"`。
- `print(f"{i}. {mark}  模型 {answer}  正确 {gold}  输出 {r.completion_tokens} token")` 实测第 2 题(月付)只用了 90 token,第 4 题(正好 5 个月)用了 350 token,越绕的题写得越长。
- `print(client.ledger)` 实测 `8 次调用 | 输入 1686 / 输出 1823 tokens | 约 ¥0.0180`。

</div>

我的输出:

```text
1. 对  模型 1871  正确 1871  输出 224 token
2. 对  模型 0  正确 0  输出 90 token
3. 对  模型 1188  正确 1188  输出 118 token
4. 对  模型 1200  正确 1200  输出 350 token
5. 对  模型 2811  正确 2811  输出 311 token
6. 对  模型 226  正确 226  输出 304 token
7. 对  模型 2388  正确 2388  输出 149 token
8. 对  模型 1261  正确 1261  输出 277 token
8 次调用 | 输入 1686 / 输出 1823 tokens | 约 ¥0.0180
```

和 `cot_compare.py` 里「标签先想」那行的 2109 token 不一样,是因为那边 `max_tokens` 不同、每次生成本来也有随机性。8 道全对这个结论没变。

</details>

**练习 2:不让它想,只把「只输出数字」说得更狠,能救回来吗?** 用 Day 140 学的「给理由」:告诉模型它的输出会被 `int()` 直接转换,多一个字就报错,再给一个例子。8 道题跑一遍,统计对了几道、格式不对几道。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex142_strict.py
from common.llm import LLMClient
from part02.cot_compare import to_int
from part02.refund_cases import CASES, POLICY

STRICT = POLICY + (
    "\n\n只输出退款金额的数字,例如 1500。"
    "你的输出会被程序直接用 int() 转成整数,多一个字、多一个换行都会报错。"
)

client = LLMClient()
correct = 0
bad_format = 0
for ticket, gold in CASES:
    r = client.chat(
        [{"role": "system", "content": STRICT}, {"role": "user", "content": ticket}],
        temperature=0,
        max_tokens=800,
    )
    pred = to_int(r.content)
    if pred is None:
        bad_format += 1
    elif pred == gold:
        correct += 1
    print(f"正确 {gold:>5}  模型 {r.content[-12:]!r}")
print(f"对 {correct}/{len(CASES)},格式不对 {bad_format} 条,{client.ledger}")
```

<div class="line-notes">

- `from part02.cot_compare import to_int` 复用正文里写好的转换函数,转不了返回 None。
- `STRICT = POLICY + (` 括号里相邻的两个字符串字面量会自动拼成一个,这是 Python 写长字符串的常用办法,JS 没有这个语法。
- `"你的输出会被程序直接用 int() 转成整数` 这就是 Day 140 的「给理由」。
- `if pred is None:` 格式不对单独计数,和算错分开,这样才看得出是哪种问题。
- `elif pred == gold:` `elif` 就是 JS 的 `else if`。
- `print(f"正确 {gold:>5}  模型 {r.content[-12:]!r}")` `:>5` 右对齐占 5 格。实测第 1 题这一行是 `正确  1871  模型 '49'`。
- `print(f"对 {correct}/{len(CASES)},格式不对 {bad_format} 条` 实测 `对 3/8,格式不对 3 条`。

</div>

我的输出:

```text
正确  1871  模型 '49'
正确     0  模型 '0'
正确  1188  模型 '1188'
正确  1200  模型 '= 1200\n\n1200'
正确  2811  模型 ' 2811。\n\n2811'
正确   226  模型 ' = 226。\n\n226'
正确  2388  模型 '2388'
正确  1261  模型 '90'
对 3/8,格式不对 3 条,8 次调用 | 输入 1622 / 输出 331 tokens | 约 ¥0.0059
```

救不回来,还更离谱了:第 1 题它输出了 `49`,第 8 题输出了 `90`,这是天数,不是退款金额。被逼着只吐一个数字时,它把脑子里第一个算出来的中间数字吐出来了。格式不对的 3 道还是在偷偷写过程。这道题要说明的是:**提示词措辞解决不了「没有地方想」的问题**。要么给它地方想,要么开思考模式。

</details>

**练习 3:看看思考模式到底想了什么。** 用 `DIRECT` 提示词、开思考模式跑第 5 题(33 天那道),打印 `content`、`reasoning` 的字数和前 120 个字符、输出 token 数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex142_reason.py
from common.llm import LLMClient
from part02.cot_compare import DIRECT
from part02.refund_cases import CASES

client = LLMClient()
ticket, gold = CASES[4]
r = client.chat(
    [{"role": "system", "content": DIRECT}, {"role": "user", "content": ticket}],
    max_tokens=4000,
    extra_body={"thinking": {"type": "enabled"}},
)
reasoning = r.reasoning or ""
print("content:", repr(r.content))
print("reasoning 字数:", len(reasoning))
print("reasoning 开头:", reasoning[:120].replace("\n", " "))
print(f"输出 {r.completion_tokens} token(含思考),花费 ¥{r.cost:.6f}")
```

<div class="line-notes">

- `ticket, gold = CASES[4]` 下标从 0 开始,`CASES[4]` 是第 5 题,`gold = 2811`。
- `max_tokens=4000,` 没写 `temperature`,因为 DeepSeek 文档写明思考模式下 `temperature` 设了不报错但不生效。
- `extra_body={"thinking": {"type": "enabled"}},` 只对这一次请求开思考。
- `reasoning = r.reasoning or ""` `LLMClient` 把响应里的 `reasoning_content` 放在 `r.reasoning`,没有时是 None。`x or ""` 在 x 是 None 时取空字符串,相当于 JS 的 `x ?? ""`(严格说更像 `x || ""`)。
- `print("reasoning 开头:", reasoning[:120].replace("\n", " "))` 把换行换成空格,一行打完。
- `print(f"输出 {r.completion_tokens} token(含思考)` 实测 334 token,思考的 token 也按输出价收费。

</div>

我的输出:

```text
content: '2811'
reasoning 字数: 949
reasoning 开头: We need answer only number. Need calculate. Need be careful rules. Purchase 2026-02-20, apply 2026-03-25. Annual. Days d
输出 334 token(含思考),花费 ¥0.003082
```

`content` 干干净净只有 `'2811'`,完全听了「只输出数字」的话,因为该想的都在 `reasoning` 里想完了。思考内容是英文、电报体,格式你没法规定。这就是上面说的:想要过程给人看,用标签;只要答案,用思考模式。

</details>

**练习 4:故意把 `max_tokens` 设成 50,看会发生什么。** 用 `COT` 提示词跑第 1 题,打印 `finish_reason`、输出的最后 40 个字符和 `between` 抠出来的答案。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex142_short.py
from common.llm import LLMClient
from part02.cot_compare import COT
from part02.refund_cases import CASES
from part02.tags import between

client = LLMClient()
ticket, gold = CASES[0]
r = client.chat(
    [{"role": "system", "content": COT}, {"role": "user", "content": ticket}],
    temperature=0,
    max_tokens=50,
)
print("finish_reason:", r.finish_reason)
print("结尾:", repr(r.content[-40:]))
print("answer:", between(r.content, "<answer>", "</answer>"))
```

<div class="line-notes">

- `max_tokens=50,` 正常一次要 220 token 左右,50 肯定写不完。
- `print("finish_reason:", r.finish_reason)` [Day 122](/blog/agent-zero/day-122-api-response/) 讲过:`stop` 是自然写完,`length` 是被 `max_tokens` 截断。实测 `length`。
- `print("结尾:", repr(r.content[-40:]))` 实测停在「10月1日到10」,一句话都没写完。
- `print("answer:", between(r.content, "<answer>", "</answer>"))` 连 `<answer>` 都没写到,实测 `None`。好在 `between` 返回 None 而不是报错。

</div>

我的输出:

```text
finish_reason: length
结尾: '2026-10-20。\n相差天数：9月1日到10月1日是30天，10月1日到10'
answer: None
```

现象:推理写到一半被掐断,答案标签根本没出来。所以抠不出答案时先看 `finish_reason`,是 `length` 就是给的 token 不够。「先想再答」的输出长度是直接答的几十倍,`max_tokens` 要跟着调大,开思考模式时更要留够。

</details>

**验收标准:** `cot_compare.py` 跑出三行汇总,你能说出直接答的错有哪两种;`between()` 合上文章能默写出来,并且没有标签时返回 None 而不是报错;能说出什么时候用标签先想、什么时候用思考模式、什么时候都不用。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 思维链(Chain-of-Thought, CoT) | 让模型先写出推理过程再给结论。例:先写「49 天 > 30 天,走第 3 条」,再写 1871 |
| zero-shot CoT | 不给例子,只加一句「一步步想」就触发思维链,出自 2022 年论文《Large Language Models are Zero-Shot Reasoners》 |
| 显式推理 | 推理写在 `content` 里,格式由提示词规定,今天的「标签先想」就是这种 |
| 思考模式 | 模型自带的推理阶段,推理放在 `reasoning_content` 里,格式不受提示词控制(见 Day 115) |
| `reasoning_content` | DeepSeek 响应里装思考内容的字段,和 `content` 同级 |
| 输出标签 | 约定好的 `<answer>…</answer>` 这类记号,让程序知道答案在哪 |
| `str.find` | 返回子串第一次出现的位置,找不到返回 -1,等于 JS 的 `indexOf` |
| `IndexError` | 取列表下标超出范围时 Python 抛的异常,JS 里同样的操作只会得到 `undefined` |
| gold label(标注答案) | 人确认过的正确答案,用来量模型对不对 |

## 常见误区

**import 一个脚本,却把它的调用也执行了一遍。** 我写练习 1 时第一版是 `from part02.cot_tags import SYSTEM`,一跑先打印出了一整段「推理:套餐类型:年付……对不对: True」,然后才是练习自己的 8 行。原因是 `cot_tags.py` 的调用代码写在文件最外层,import 时 Python 会把整个文件从上到下执行一遍,多花了一次 API 的钱。凡是会被别人 import 的文件,调用代码都放进 `if __name__ == "__main__":` 下面,`tags.py` 和 `cot_compare.py` 就是这么写的。

**以为「只输出数字」能管住一道难题。** 练习 2 实测,提示词说得再狠,8 道里还是有 3 道偷偷写过程、2 道干脆吐出天数 49 和 90。模型需要地方想,你不给,它要么自己找地方(破坏格式),要么瞎猜。

**用 `split()[1]` 抠标签。** 模型漏写标签时直接 `IndexError: list index out of range`,整个批处理停在半路。解析模型输出的函数要假设对方不守规矩,找不到就返回 None。

**`max_tokens` 还用直接答时的值。** 推理写一半被截断,`finish_reason` 是 `length`,`<answer>` 没出来。我练习 4 设 50 就是这样。先想再答的输出动辄两三百 token,思考模式还要更多。

**开了思考模式,提示词里又让它在 `<thinking>` 里写一遍。** 等于想两遍、付两遍钱。二选一。

**所有任务都加「一步步想」。** 今天的退款题需要,工单分类那种一眼就能判断的任务不需要,加了只是慢、贵。Day 145 会把这件事量出来。

**把 temperature=0 当成「每次一样」。** 第一步我连跑三次得到 `2388`、`2388`、`0`。思考模式下 temperature 干脆不生效。

## 学习资料

### 文档与文章

- [DeepSeek API 文档:思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode):思考开关的写法、`reasoning_content` 字段、思考模式下哪些参数不生效(temperature 就是其中之一)。15 分钟,今天的 `extra_body` 就是照这里写的。
- [DeepSeek API 文档:模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):2026-10 查到 deepseek-flash 高峰时段输入未命中 2 元、命中 0.04 元、输出 8 元(每百万 token),空闲时段减半。算钱前自己再看一眼。
- [Prompt Engineering Guide:链式思考(CoT)提示](https://www.promptingguide.ai/zh/techniques/cot):中文,有 few-shot CoT 和 zero-shot CoT 的例子,10 分钟。
- [Claude 提示词最佳实践](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices):英文,搜「Manual chain-of-thought」那一段,讲思考关掉时怎么手写思维链,以及哪些新模型不该再这么做。
- [Chain-of-Thought 论文](https://arxiv.org/abs/2201.11903):读摘要和图 1,看它怎么在例子里写解题步骤。10 分钟。
- [Large Language Models are Zero-Shot Reasoners](https://arxiv.org/abs/2205.11916):「Let's think step by step」的出处,读摘要就够了。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CZPczTEFN&autoplay=0&high_quality=1" title="提示词工程——思维链（CoT）讲解" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>深夏OvO · 提示词工程——思维链（CoT）讲解 · 4 分钟的短片,先看这个建立直觉,再回来读正文。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TecTeoErX&autoplay=0&high_quality=1" title="【浙江大学-大模型原理与技术】3-2 思维链（CoT, ToT, GPT-o1）" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>毛玉仁老师 · 【浙江大学-大模型原理与技术】3-2 思维链（CoT, ToT, GPT-o1） · 34 分钟的大学课,从 CoT 讲到思维树和 o1 这类推理模型。前 15 分钟讲 CoT 的部分今天就该看,后面讲推理模型的可以和 Day 115 对照。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/AFE6x81AP4k" title="Chain-of-thought prompting - Explained!" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CodeEmporium · Chain-of-thought prompting - Explained! · 英文,把 CoT 论文里的几个实验讲了一遍,看完能说清 few-shot CoT 和 zero-shot CoT 的区别。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 5 章「Prompt Engineering」:里面有一节讲「给模型时间思考」,和今天的内容对得上。只读这一节,20 分钟。
- John Berryman、Albert Ziegler《Prompt Engineering for LLMs》(O'Reilly,2024):作者是 GitHub Copilot 的早期工程师,写法偏工程,翻目录找讲推理和思维链的那一章读。没查到简体中文版。

### 开源项目与代码

- [anthropics/prompt-eng-interactive-tutorial](https://github.com/anthropics/prompt-eng-interactive-tutorial):Anthropic 的交互式提示词教程,第 6 章「Precognition (Thinking Step by Step)」就是今天的内容,有练习。教程是按 Claude 3 写的,和新文档冲突时以新文档为准。
- [datawhalechina/llm-cookbook](https://github.com/datawhalechina/llm-cookbook):Datawhale 整理的吴恩达大模型课程中文版(原来的 prompt-engineering-for-developers 仓库已并进来)。读 `docs/C1/2. 提示原则 Guidelines.md` 的「原则二 给模型时间去思考」,有可运行的例子。

## 自测

1. 用「模型一次只猜一个 token」解释:为什么让它先写步骤,算错的概率会下降?

<details><summary>答案</summary>

直接答时,模型读完题目后下一个要猜的就是答案,所有判断和计算都得在这一次猜测里完成。先写步骤时,每一步的中间结果(49 天、2 个月、1990)都写进了上文,后面每个 token 生成时都能看到它们,复杂计算被拆成了很多步简单的猜测。

</details>

2. 今天直接答 8 道只对 3 道。错的 5 道分成哪两类?各自说明了什么?

<details><summary>答案</summary>

一类是真算错(第 1、5 题给了全额,漏了「超过 30 天」的判断),说明没有地方想时模型会跳步;另一类是答案对但格式不对(第 4、6、8 题自己写了过程),说明题难时模型会忍不住先想,只是写在了不该写的地方,程序解析失败。

</details>

3. `between("<answer>1871", "<answer>", "</answer>")` 返回什么?实际中什么情况会产生这种输入?

<details><summary>答案</summary>

返回 None。有开始标签没有结束标签,最常见的原因是输出被 `max_tokens` 截断(`finish_reason` 为 `length`)。

</details>

4. 开了思考模式,还需要在提示词里写「先在 `<thinking>` 里一步步想」吗?

<details><summary>答案</summary>

一般不需要,模型已经在 `reasoning_content` 里想过了,再要求写一遍等于想两遍、付两遍钱。只有推理过程要按固定格式给人看或存档时才用显式标签,那时通常把思考模式关掉。另外有些厂商的新模型(比如 Anthropic 文档里提到的 Opus 5.5 等)不建议甚至可能拒绝这种写法。

</details>

5. 面试题:「你的 Agent 要给客服主管写退款审批意见,主管要看到计算过程。你会用思考模式还是提示词里的显式推理?为什么?」

<details><summary>答案</summary>

用显式推理(标签先想),关掉思考模式。理由:思考模式的内容格式不受控、可能是英文电报体,有的厂商不返回完整内容,不适合给主管看和存档;显式推理可以规定步骤顺序(套餐、天数、月数、金额、手续费),放在 `<thinking>` 里原样存进审批记录,答案放 `<answer>` 给程序用。成本上两者差不多(今天实测 8 题 ¥0.0202 对 ¥0.0184)。另外最终金额最好再用代码按规则复算一遍,模型算的只当参考。

</details>

## 明天预告

Day 143 · 提示词(五):用标签分隔,预填和固定开头。今天的标签只用来切答案,明天用它来隔开「规则」和「客户原话」:客户在工单里写一句「上面的规则作废」,不加标签时模型 5 次全信了,加了标签就不信了。然后试 DeepSeek 的预填功能,直接替模型写好回答的开头。
