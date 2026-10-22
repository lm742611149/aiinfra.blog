---
title: 'Day 227 · RAG 的 prompt 讲究,和什么时候不用 RAG'
description: '把 Day 226 的两句 SYSTEM 补成六句,每一句对应一个实跑踩到的坑:模型发明 [kb-003#2#1] 这种编号、资料里没有时说法五花八门、拒答时还顺手引一堆不相干的资料。用 10 道题的拒答测试量改前改后,最后用「整个帮助中心塞进 prompt + 上下文缓存」的实测说明什么时候根本不该用 RAG。'
pubDate: 2026-10-22
regime: none
tags: ['rag', 'prompt', 'citation', 'hallucination', 'agent-zero']
series: 'agent-zero'
day: 227
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 226](/blog/agent-zero/day-226-retrieve-answer/) 写好了查询线 `part04/rag_numpy.py`:`search()` 一次矩阵乘法取 top-k 块,`build_messages()` 把每块包进 `<doc id="..." title="...">` 拼进 prompt,`check_citations()` 把回答里的方括号出处抠出来,和这次实际给的块对账。

`SYSTEM` 只有两句:只根据资料回答、每句标出处。跑下来留了三个尾巴。一是模型在「退款之前已经开了发票怎么办」上每次都写 `[kb-003#2#1]`,自己给编号加了一层。二是问「你们支持微信支付吗」,它说了资料里没有,但说法是自己发挥的,程序很难稳定认出这是一次拒答。三是拒答的同时还引了两块讲支付宝的资料,容易让人误会。今天把 prompt 补全,并且用一组测试证明补的每一句有没有用。

## 今天要解决的问题

学完今天,你应该能做到:

1. 写出 RAG 回答用的六句 `SYSTEM`,每句说得出它防的是哪个坑,并用实测数据说明「出处只能原样照抄 id」把编造编号从 3/3 降到 0/3。
2. 说清**拒答**是什么、为什么要把拒答话术写死:同样 5 道资料里没有的题,不写死时模型 5 次都拒了,但用固定话术去判,一次都认不出来;写死以后 5/5。
3. 写一个 10 道题的拒答测试 `part04/refusal_test.py`,一半该答、一半该拒,能跑出「对几道」,并知道检索漏了导致的拒答不算好事。
4. 能按顺序判断一个需求该不该用 RAG:资料小就全塞加缓存,要查结构化数据就用工具,要全局汇总就别指望 top-k。今天实测把 20 篇全塞进去,缓存命中后一次只要 ¥0.0006,比 RAG 还便宜。

预计用时 2.5 小时:逐句讲 prompt 和引用实验 40 分钟,拒答测试 50 分钟,什么时候不用 RAG 30 分钟,剩下做练习。前置:[Day 226](/blog/agent-zero/day-226-retrieve-answer/) 的 `part04/rag_numpy.py`(`SYSTEM`、`search`、`build_messages`、`check_citations`),[Day 225](/blog/agent-zero/day-225-numpy-index/) 建好的 `index/`,[Day 221](/blog/agent-zero/day-221-why-rag/) 的「全塞」实验,[Day 143](/blog/agent-zero/day-143-prompt-5/) 的标签分隔,[Day 144](/blog/agent-zero/day-144-prompt-6/) 的「提示词是代码」。

实跑花费:embedding 免费;大模型 `deepseek-flash`,按 2026 年 10 月 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 的高峰价记账(缓存命中 0.04、未命中 2、输出 8 元每百万 token)。正文和练习一共调了 70 多次,最大的一项是拒答测试 20 次 ¥0.019,合计约 ¥0.08。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写六句 `SYSTEM` 和 `refusal_test.py` 的 `run()`;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 六句 SYSTEM,每一句都有来历

先给出改完的样子。打开 Day 226 的 `part04/rag_numpy.py`,只换掉 `SYSTEM` 这一段,其余一行不动:

```python
# agent-zero-lab/part04/rag_numpy.py(只改 SYSTEM,其余同 Day 226)
SYSTEM = """你是云簿 CloudLedger 的客服助手。
只根据 <资料> 里的内容回答用户问题,不要用你自己的常识补充 CloudLedger 的规则。
每一个事实性的句子后面,用方括号标注出处,例如 [kb-002#1]。一句话用到多块资料就都标上。
出处只能原样照抄 <doc> 标签里的 id,不要在后面再加编号。
如果资料里没有足够的信息回答,就直接说「帮助中心里没有找到这个问题的说明,建议转人工客服」,不要猜。
回答用简洁的中文,先给结论,再给条件和步骤。"""
```

<div class="line-notes">

- `SYSTEM = """你是云簿 CloudLedger 的客服助手。` 身份。告诉模型它在替谁说话,回答的语气和立场跟着定下来。这句 Day 226 就有。
- `只根据 <资料> 里的内容回答用户问题,不要用你自己的常识补充 CloudLedger 的规则。` 前半句 Day 226 就有;后半句是新加的,点名「常识」。练习 3 会看到,一句规矩都不给时,模型会说「建议您以收银台实际展示的支付选项为准」「理论上可以通过 API 对接」:CloudLedger 的帮助中心里根本没有「收银台」,这是模型拿一般 SaaS 产品的常识补的。
- `每一个事实性的句子后面,用方括号标注出处,例如 [kb-002#1]。一句话用到多块资料就都标上。` 前半句 Day 226 就有。后半句是新加的:不说的话,模型一句话综合了两块资料时只标一块,对账时看着干净,其实漏了来源。
- `出处只能原样照抄 <doc> 标签里的 id,不要在后面再加编号。` 专治 `[kb-003#2#1]`。下一节量它的效果。
- `如果资料里没有足够的信息回答,就直接说「帮助中心里没有找到这个问题的说明,建议转人工客服」,不要猜。` 今天的核心:拒答,而且话术**一字不差地写死**。为什么要写死,拒答那一节用数据说。
- `回答用简洁的中文,先给结论,再给条件和步骤。` 格式。客服场景用户最想先知道「能不能、多少钱」。改之前问 351 元那道题,第一句是在复述规则;改之后第一句就是「可退剩余 9 个月的费用,共 351 元」(拒答测试里能看到)。

</div>

这六句我都不是一次想好的,是一边跑一边加的。写 prompt 和写代码一样,每加一句都应该能说出它修的是哪个 bug,[Day 144](/blog/agent-zero/day-144-prompt-6/) 说过提示词是代码,这里就是活例子。另外几处 prompt 结构上的讲究 Day 226 已经做了,这里补一句为什么。资料放在问题前面,是 Anthropic 提示词文档对长资料的建议(长文档放上面、问题放最后),我在中文模型上没有专门量过,Day 255 有了评估集可以自己比一下。每块用 `<doc>` 标签包起来、编号写在属性上,是为了让模型有东西可抄、我们有白名单可对。`temperature=0` 是为了让对比实验尽量稳定,但它不保证每次一样,所以下面每个实验都跑不止一次。

## 引用格式:一句话治好编号

**引用格式**说的是出处长什么样、怎么写:我们约定方括号里放块编号,一句话多个来源就并列写多个方括号。约定写得越死,前端越好渲染,对账越好做。Day 226 的问题是模型自己「升级」了格式,加了一层句子编号。

把新旧两版 `SYSTEM` 对同一个问题各跑三次。新建 `part04/cite_repeat.py`:

```python
# agent-zero-lab/part04/cite_repeat.py
from part04 import rag_numpy
from part04.rag_numpy import build_messages, check_citations, client, search

V1 = """你是云簿 CloudLedger 的客服助手。只根据 <资料> 里的内容回答用户问题。
每一个事实性的句子后面,用方括号标注出处,例如 [kb-002#1]。"""
V2 = rag_numpy.SYSTEM

question = "退款之前已经开了发票怎么办"
chunks = [c for c, _ in search(question, 4)]
for name, system in [("v1", V1), ("v2", V2)]:
    rag_numpy.SYSTEM = system
    for n in range(3):
        reply = client.chat(build_messages(question, chunks), temperature=0).content
        cited, unknown = check_citations(reply, chunks)
        print(f"{name} 第{n + 1}次  引用 {cited}  不合法 {unknown}")
print("---", client.ledger)
```

<div class="line-notes">

- `from part04 import rag_numpy` 拿到模块对象,后面通过 `rag_numpy.SYSTEM = ...` 换提示词,不用改文件。Day 226 练习 3 讲过为什么要这样改而不是 `from ... import SYSTEM`。
- `V1 = """你是云簿 CloudLedger 的客服助手。` Day 226 的两句版,原样抄过来当对照组。
- `V2 = rag_numpy.SYSTEM` 文件里现在的六句版。一定要在下面改 `rag_numpy.SYSTEM` 之前先存一份,不然就找不回来了。
- `chunks = [c for c, _ in search(question, 4)]` 只检索一次,六次调用用同样的 4 块(`kb-003#2`、`kb-007#1`、`kb-006#2`、`kb-003#1`),保证唯一的变量是提示词。做对比实验时这一点很重要。
- `rag_numpy.SYSTEM = system` 换上这一轮的提示词。`build_messages` 每次调用时才读 `SYSTEM`,所以立刻生效。
- `for n in range(3):` 每版跑三次。`temperature=0` 也不保证每次一样(Day 112),只跑一次的结论不可信。
- `cited, unknown = check_citations(reply, chunks)` Day 226 的对账函数,`unknown` 是编出来的编号。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part04.cite_repeat
```

真实输出:

```text
v1 第1次  引用 ['kb-003#2#1', 'kb-003#2#2']  不合法 ['kb-003#2#1', 'kb-003#2#2']
v1 第2次  引用 ['kb-003#2#1', 'kb-003#2#2']  不合法 ['kb-003#2#1', 'kb-003#2#2']
v1 第3次  引用 ['kb-003#2#1', 'kb-003#2#2']  不合法 ['kb-003#2#1', 'kb-003#2#2']
v2 第1次  引用 ['kb-003#2', 'kb-003#1']  不合法 []
v2 第2次  引用 ['kb-003#2', 'kb-003#1']  不合法 []
v2 第3次  引用 ['kb-003#2', 'kb-003#1']  不合法 []
--- 6 次调用 | 输入 2493 / 输出 504 tokens | 约 ¥0.0070
```

旧版三次全错,新版三次全对,而且新版多引了一块 `kb-003#1`(「操作步骤」):它把「红冲完成后去哪里申请退款」也答上了,这正是「先给结论,再给条件和步骤」那句的效果。换成新版以后用命令行跑一次,看完整的回答:

```bash
uv run python -m part04.rag_numpy 退款之前已经开了发票怎么办
```

真实输出:

```text
问:退款之前已经开了发票怎么办
检索到:
  0.795  kb-003#2  如何申请退款 > 已经开了发票怎么办
  0.669  kb-007#1  修改发票抬头 > 开错了怎么办
  0.663  kb-006#2  发票类型与开具 > 怎么申请
  0.647  kb-003#1  如何申请退款 > 操作步骤
  引用了 ['kb-003#2', 'kb-003#1'],不在资料里的 []
答:需要先申请发票红冲(作废),红冲完成后才能退款。[kb-003#2]

具体说明:
- 电子普通发票红冲一般当天完成。[kb-003#2]
- 增值税专用发票需要你方配合退回或开具红字信息表。[kb-003#2]

红冲完成后,再进入「设置 → 订阅 → 申请退款」,选择退款原因并提交,客服主管会在 1 个工作日内审批。[kb-003#1]
--- 1 次调用 | 输入 458 / 输出 104 tokens | 约 ¥0.0012
```

结论在第一句,条件和步骤在后面,每句一个合法出处。输入从 373 涨到 458 token,多出来的 85 个就是新加的四句规矩,每次调用多花约 85 × 2 / 10⁶ = ¥0.00017,值得。

六句里到底是哪一句起的作用?不能凭感觉。练习 2 只在旧版上加「出处只能原样照抄」这一句,把 k 开到 8(Day 226 里 k=8 最容易编号),结果 6 次全部合法。所以治编号的就是这一句,和其他几句无关。

## 拒答:资料里没有,就说没有

今天第二个新概念是**拒答**:资料里没有足够信息时,模型不编,明确说「不知道」,并把用户引到别处(转人工)。它和幻觉是一对:**幻觉**(hallucination)是模型说出资料里没有、而且不对的内容,比如告诉用户「支持微信支付」;拒答就是用来挡幻觉的。

客服场景里这两件事的代价很不对称。答不出来转人工,用户多等几分钟;编一条不存在的退款规则,用户照着做了,后面就是投诉甚至赔钱。所以宁可多拒几次,也不能编。但拒得太多也不行,资料里明明有的也说「没找到」,这个 Agent 就没用了。所以测拒答一定要两类题一起测:该答的答没答,该拒的拒没拒。

### 拒答测试

新建 `part04/refusal_test.py`。10 道题,前 5 道帮助中心里有答案(其中两道答案是「不能」,用来防止模型把「不能」和「不知道」混为一谈),后 5 道帮助中心里没有。题目都用 Day 222 那份数据核对过,比如「专属客服」在 kb-001 里出现过,但电话号码没有,这道是故意出的半真半假题。

```python
# agent-zero-lab/part04/refusal_test.py
"""拒答测试:5 道资料里有答案的,5 道资料里没有的,看模型该答的答没答、该拒的拒没拒。"""
import re
import sys

from part04 import rag_numpy
from part04.rag_numpy import build_messages, check_citations, client, search

V1 = """你是云簿 CloudLedger 的客服助手。只根据 <资料> 里的内容回答用户问题。
每一个事实性的句子后面,用方括号标注出处,例如 [kb-002#1]。"""

CASES = [
    ("年付专业版用到第 3 个月想退,能退多少", "答"),
    ("导入流水提示 E1042 怎么办", "答"),
    ("专业版最多几个人", "答"),
    ("月付的专业版能开增值税专用发票吗", "答"),
    ("免费版能用开放 API 吗", "答"),
    ("你们支持微信支付吗", "拒"),
    ("有没有手机 App 可以记账", "拒"),
    ("账本能直接导到金蝶里吗", "拒"),
    ("企业版专属客服的电话是多少", "拒"),
    ("发票可以邮寄纸质版吗", "拒"),
]
REFUSED = re.compile(r"没有找到|没有(相关|提到|关于)|未(涉及|提及|提到|说明)|无法回答")


def run(system: str) -> None:
    rag_numpy.SYSTEM = system
    right = 0
    for question, expect in CASES:
        chunks = [c for c, _ in search(question, 4)]
        reply = client.chat(build_messages(question, chunks), temperature=0).content
        got = "拒" if REFUSED.search(reply) else "答"
        _, unknown = check_citations(reply, chunks)
        ok = got == expect
        right += ok
        print(f"{'✓' if ok else '✗'} 该{expect} 实际{got}  {question:<18} {reply[:46]!r}{'  坏引用' + str(unknown) if unknown else ''}")
    print(f"对 {right}/{len(CASES)}\n")


if __name__ == "__main__":
    versions = {"v1": V1, "v2": rag_numpy.SYSTEM}
    for name in sys.argv[1:] or ["v1", "v2"]:
        print(f"===== {name} =====")
        run(versions[name])
    print("---", client.ledger)
```

<div class="line-notes">

- `V1 = """你是云簿 CloudLedger 的客服助手。` 和 `cite_repeat.py` 一样的旧版。两个文件各写一份有点重复,练习 2 会直接 `from part04.refusal_test import V1` 复用这里的。
- `CASES = [` 每项是 `(问题, 期望)` 元组,期望是「答」或「拒」。测试数据和测试代码写在一起,一眼能看到全部题目,相当于 jest 里 `test.each([...])` 那张表。
- `("月付的专业版能开增值税专用发票吗", "答"),` kb-006 写的是「增值税专用发票仅限企业版,或年付的专业版」,所以正确答案是「不能」。这道题考的是:资料里有答案而且答案是否定的,模型要答「不能」,不能说「没找到」。
- `("企业版专属客服的电话是多少", "拒"),` 半真半假:「专属客服」确实存在,电话号码帮助中心里没有。模型最容易在这种题上顺着编一个号码。
- `REFUSED = re.compile(r"没有找到|没有(相关|提到|关于)|未(涉及|提及|提到|说明)|无法回答")` 判断「这是不是一次拒答」。`|` 是「或」,圆括号把几种说法分组。旧版模型的拒答说法不固定,所以只能列一长串可能的说法;这个列表是我看了旧版的真实输出以后凑出来的,换一批题很可能就漏。下面会看到这件事的后果。
- `def run(system: str) -> None:` 用指定的提示词把 10 道题跑一遍,打印每道的结果和总分。
- `rag_numpy.SYSTEM = system` 换提示词,同 `cite_repeat.py`。
- `chunks = [c for c, _ in search(question, 4)]` 每道题检索 4 块,和正式使用时一样。
- `got = "拒" if REFUSED.search(reply) else "答"` 条件表达式,相当于 JS 的 `REFUSED.test(reply) ? "拒" : "答"`。`search` 在字符串任何位置找到一处匹配就算。
- `_, unknown = check_citations(reply, chunks)` 顺便对账,有编造的出处就在这一行末尾标出来。
- `right += ok` 布尔值能当整数加,`True` 是 1、`False` 是 0,和 JS 的 `+true === 1` 一样。
- `print(f"{'✓' if ok else '✗'} 该{expect} 实际{got}  {question:<18} {reply[:46]!r}` 每道题一行:对错、期望、实际、问题、回答前 46 个字符。`!r` 用 `repr` 打印,换行会显示成 `\n`,不会把一行撑成好几行。行尾那段 `{'  坏引用' + str(unknown) if unknown else ''}` 有编造出处才打印,没有就是空字符串。
- `for name in sys.argv[1:] or ["v1", "v2"]:` 命令行可以只跑一版,`uv run python -m part04.refusal_test v2`;不给参数就两版都跑。

</div>

```bash
uv run python -m part04.refusal_test
```

真实输出:

```text
===== v1 =====
✓ 该答 实际答  年付专业版用到第 3 个月想退,能退多少 '年付套餐(专业版和企业版)中途取消的,按剩余的整月数比例退款,已经使用的月份和当前所在的月份'
✓ 该答 实际答  导入流水提示 E1042 怎么办   'E1042 表示文件的列名和模板不匹配，或者日期列的格式不是 YYYY-MM-DD；最常见的'
✓ 该答 实际答  专业版最多几个人           '专业版最多 3 名成员。[kb-015#2]'
✓ 该答 实际答  月付的专业版能开增值税专用发票吗   '不能。增值税专用发票仅限企业版，或年付的专业版 [kb-006#1]。月付的专业版不在可开具'
✓ 该答 实际答  免费版能用开放 API 吗      '不能。开放 API 仅对企业版开放 [kb-019#1]。'
✓ 该拒 实际拒  你们支持微信支付吗          '资料中没有关于是否支持微信支付的信息。目前资料里只提到支付失败时可改用支付宝支付 [kb-0'
✓ 该拒 实际拒  有没有手机 App 可以记账     '资料中没有关于手机 App 的信息，无法回答这个问题。'
✓ 该拒 实际拒  账本能直接导到金蝶里吗        '资料里没有提到与金蝶对接或导出的相关内容，无法确认账本能否直接导入金蝶。\n\n目前资料中与数据'
✓ 该拒 实际拒  企业版专属客服的电话是多少      '资料里没有企业版专属客服电话的信息,我无法回答这个问题。建议你通过其他官方渠道咨询。[kb-'
✓ 该拒 实际拒  发票可以邮寄纸质版吗         '资料中没有关于邮寄纸质发票的信息。根据现有资料，所有付费订单都可以开电子普通发票 [kb-0'
对 10/10

===== v2 =====
✓ 该答 实际答  年付专业版用到第 3 个月想退,能退多少 '年付专业版在第 3 个月中途取消，可退剩余 9 个月的费用，共 351 元。\n\n计算方式：年'
✓ 该答 实际答  导入流水提示 E1042 怎么办   'E1042 表示文件的列名和模板不匹配，或者日期列的格式不是 YYYY-MM-DD；最常见的'
✓ 该答 实际答  专业版最多几个人           '专业版最多 3 名成员。[kb-015#2]'
✓ 该答 实际答  月付的专业版能开增值税专用发票吗   '不能。增值税专用发票仅限企业版，或年付的专业版 [kb-006#1]。月付的专业版不在可开专'
✓ 该答 实际答  免费版能用开放 API 吗      '不能。开放 API 仅对企业版开放 [kb-019#1]。'
✓ 该拒 实际拒  你们支持微信支付吗          '帮助中心里没有找到这个问题的说明,建议转人工客服。'
✓ 该拒 实际拒  有没有手机 App 可以记账     '帮助中心里没有找到这个问题的说明,建议转人工客服。'
✓ 该拒 实际拒  账本能直接导到金蝶里吗        '帮助中心里没有找到这个问题的说明,建议转人工客服。'
✓ 该拒 实际拒  企业版专属客服的电话是多少      '帮助中心里没有找到这个问题的说明,建议转人工客服。'
✓ 该拒 实际拒  发票可以邮寄纸质版吗         '帮助中心里没有找到这个问题的说明,建议转人工客服。'
对 10/10

--- 20 次调用 | 输入 7764 / 输出 839 tokens | 约 ¥0.0190
```

两版都是 10/10。我得老实说,这个结果出乎我的预料:我本来以为旧版至少会在「客服电话」这道上编一个号码出来。2026 年的新模型在「资料里没有」这件事上已经相当克制,`deepseek-flash` 只靠「只根据资料回答」一句就没有编。

那新版的价值在哪?看后五行的回答原文。

**旧版的拒答说法每次都不一样**:「资料中没有关于……的信息」「资料里没有提到……」「无法回答这个问题」「建议你通过其他官方渠道咨询」。上面那个 `REFUSED` 正则是我对着这些输出凑出来的,能判对是因为我先看了答案。练习 1 把判定换成只认新版那句固定话术,旧版的 5 次拒答**一次也认不出来**,得分掉到 5/10。在真实系统里,「这次是不是拒答」要被程序判断很多次:统计拒答率、拒答时自动转人工、评估时算指标。说法不固定,这些全都做不准。

**旧版拒答时还在引资料。** 微信那道引了支付宝的块,电话那道引了一块,纸质发票那道引了电子发票的块。用户看到「资料中没有……但是所有付费订单都可以开电子普通发票 [kb-006#1]」,很可能理解成「只能开电子的」,而帮助中心并没有这么说。新版的拒答干干净净一句话,没有出处,前端也就不会渲染来源卡片。

**新版答题时先给结论。** 351 元那道,旧版第一句是在复述规则,新版第一句就是「可退剩余 9 个月的费用,共 351 元」。

所以这次测试证明的不是「新版防住了幻觉」(旧版也没幻觉),而是**新版让拒答变得可以被程序识别、并且不夹带误导信息**。这是工程上更实在的收益。

### 难一点的三道

上面 10 道还是太「干净」了。再出三道更刁的,每道两版各跑一次。新建 `part04/refusal_hard.py`:

```python
# agent-zero-lab/part04/refusal_hard.py
from part04 import rag_numpy
from part04.rag_numpy import build_messages, client, search
from part04.refusal_test import V1

V2 = rag_numpy.SYSTEM
HARD = [
    ("专业版的 7 天无理由退款怎么申请", 4),
    ("退款之前开了发票要怎么处理?退款多久能到支付宝?", 1),
    ("用微信付的款,退款能退回微信吗", 4),
]
for question, k in HARD:
    chunks = [c for c, _ in search(question, k)]
    print(f"### {question}  (k={k},检索到 {[c.id for c in chunks]})")
    for name, system in [("v1", V1), ("v2", V2)]:
        rag_numpy.SYSTEM = system
        reply = client.chat(build_messages(question, chunks), temperature=0).content
        print(f"[{name}] {reply}\n")
print("---", client.ledger)
```

<div class="line-notes">

- `from part04.refusal_test import V1` 复用上一个文件里的旧版。`refusal_test.py` 有 main guard,import 它不会把 10 道题跑一遍(Day 222 踩过没有 main guard 的坑)。
- `V2 = rag_numpy.SYSTEM` 同样,先存一份新版。
- `("专业版的 7 天无理由退款怎么申请", 4),` **错误前提**:问题里假设了一条不存在的规则。很多电商有 7 天无理由,模型的常识里也有,这是诱导它顺着编的典型问法。
- `("退款之前开了发票要怎么处理?退款多久能到支付宝?", 1),` 资料里有答案,但故意把 k 设成 1。Day 226 练习 1 看到,k=1 只检索到「审批与到账」,发票那一半没进来。
- `("用微信付的款,退款能退回微信吗", 4),` 又一个错误前提:帮助中心从没说过能用微信付款。
- `print(f"### {question}  (k={k},检索到 {[c.id for c in chunks]})")` f-string 的花括号里可以直接写列表推导式。

</div>

```bash
uv run python -m part04.refusal_hard
```

真实输出:

```text
### 专业版的 7 天无理由退款怎么申请  (k=4,检索到 ['kb-002#1', 'kb-003#1', 'kb-002#4', 'kb-003#2'])
[v1] 资料中没有关于「7 天无理由退款」的信息，无法据此回答该问题。

不过，资料中与专业版退款相关的内容如下，供你参考：

- 年付套餐（专业版和企业版）中途取消的，按剩余的整月数比例退款，已经使用的月份和当前所在的月份不退 [kb-002#1]。
- 申请退款的操作路径：进入「设置 → 订阅 → 申请退款」，选择退款原因并提交，客服主管会在 1 个工作日内审批 [kb-003#1]。
- 审批通过后原路退回，支付宝 1 到 3 个工作日到账，银行卡 3 到 7 个工作日到账 [kb-002#4]。
- 如果这笔订单已经开具发票，需要先申请发票红冲（作废），红冲完成后才能退款 [kb-003#2]。

如需确认是否存在「7 天无理由退款」，建议咨询客服主管。

[v2] 帮助中心里没有找到这个问题的说明,建议转人工客服。

资料里只说明了年付套餐中途取消按剩余整月数比例退款 [kb-002#1],以及退款申请入口是「设置 → 订阅 → 申请退款」、需客服主管审批 [kb-003#1],但没有关于「7 天无理由退款」的说明。

### 退款之前开了发票要怎么处理?退款多久能到支付宝?  (k=1,检索到 ['kb-002#4'])
[v1] 关于发票的处理方式，<资料>中没有相关信息，我无法回答。

关于退款到账时间：所有退款都需要客服主管审批后执行，审批通过后原路退回，支付宝 1 到 3 个工作日到账。[kb-002#4]

[v2] 关于发票:帮助中心里没有找到这个问题的说明,建议转人工客服。

关于支付宝到账:审批通过后原路退回,支付宝 1 到 3 个工作日到账 [kb-002#4]。前提是所有退款都需要客服主管审批后执行 [kb-002#4]。

### 用微信付的款,退款能退回微信吗  (k=4,检索到 ['kb-002#2', 'kb-008#2', 'kb-002#4', 'kb-002#3'])
[v1] 资料里没有关于微信支付退款渠道的说明，只提到退款审批通过后原路退回，支付宝 1 到 3 个工作日到账，银行卡 3 到 7 个工作日到账 [kb-002#4]。建议您联系客服确认微信支付的具体退款方式。

[v2] 帮助中心里没有找到这个问题的说明,建议转人工客服。

资料中只提到退款审批通过后原路退回,并分别说明了支付宝和银行卡的到账时间,没有关于微信支付退款渠道的说明 [kb-002#4]。
```

三道各说明一件事。

第一道,两版都没上当,没有人说「7 天内可以无理由退」。但旧版拒答之后列了四条「供你参考」,其中的「年付按比例退」对一个问 7 天无理由的月付用户来说是误导;新版也在固定话术后面补了一段说明,没做到 prompt 里写的「直接说」。模型对「只说一句」这种指令遵守得并不严格,所以测试里判拒答用的是「回答里**包含**固定话术」,不要求回答**只有**这一句。

第二道最值得记住。两版都把发票那一半拒了,这次拒答完全「正确」,资料里确实没给它发票的内容;但帮助中心其实有这条规则(kb-003#2),只是 k=1 没检索到。**检索漏了导致的拒答,看起来和真没有的拒答一模一样。** 所以拒答测试必须分开记两种题:资料里真没有的,拒了是对的;资料里有的,拒了就是一个 bug,要去查检索。Day 255 的 RAG 评估分「检索层」「生成层」两层判,就是为了把这两种区分开。新版对这种「一半能答一半不能」的问题处理得更好:能答的那半照答,不能答的那半用固定话术,程序依然能认出来。

第三道,两版都没说「能退回微信」。旧版说「建议您联系客服确认微信支付的具体退款方式」,话里默认了「用户真的用微信付过款」;新版没接这个前提。

## 什么时候不用 RAG

RAG 讲了五天,最后得说说什么时候别用它。面试官很爱问这个,因为它能看出你是在解决问题,还是为了用技术而用技术。我判断的顺序是这样的:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="判断要不要用 RAG 的顺序:资料小就全塞加缓存,要查结构化数据就用工具,要全局汇总就别用 top-k,剩下的才用 RAG">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<defs><marker id="m227" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
<rect x="20" y="20" width="300" height="44" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="34" y="40" fill="var(--ink)">① 资料加起来很小,也不常变?</text>
<text x="34" y="56" fill="var(--ink-soft)" font-size="11">我们 20 篇 ≈ 2100 token</text>
<line x1="320" y1="42" x2="376" y2="42" stroke="var(--ink-faint)" marker-end="url(#m227)"/>
<text x="348" y="36" fill="var(--ink-faint)" font-size="11" text-anchor="middle">是</text>
<rect x="380" y="20" width="240" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="394" y="40" fill="var(--ink)">全塞进 system + 缓存</text>
<text x="394" y="56" fill="var(--ink-soft)" font-size="11">实测命中后 ¥0.0006/次</text>
<line x1="170" y1="64" x2="170" y2="88" stroke="var(--ink-faint)" marker-end="url(#m227)"/>
<rect x="20" y="92" width="300" height="44" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="34" y="112" fill="var(--ink)">② 答案在数据库里,要精确查?</text>
<text x="34" y="128" fill="var(--ink-soft)" font-size="11">「C-1024 这个月账单多少」</text>
<line x1="320" y1="114" x2="376" y2="114" stroke="var(--ink-faint)" marker-end="url(#m227)"/>
<text x="348" y="108" fill="var(--ink-faint)" font-size="11" text-anchor="middle">是</text>
<rect x="380" y="92" width="240" height="44" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="394" y="112" fill="var(--ink)">做成工具,让模型调</text>
<text x="394" y="128" fill="var(--ink-soft)" font-size="11">Day 180 起,第五部分 MCP</text>
<line x1="170" y1="136" x2="170" y2="160" stroke="var(--ink-faint)" marker-end="url(#m227)"/>
<rect x="20" y="164" width="300" height="44" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="34" y="184" fill="var(--ink)">③ 要看全部资料才能答?</text>
<text x="34" y="200" fill="var(--ink-soft)" font-size="11">「总结所有退款相关规则」</text>
<line x1="320" y1="186" x2="376" y2="186" stroke="var(--ink-faint)" marker-end="url(#m227)"/>
<text x="348" y="180" fill="var(--ink-faint)" font-size="11" text-anchor="middle">是</text>
<rect x="380" y="164" width="240" height="44" rx="5" fill="none" stroke="var(--ink-soft)"/>
<text x="394" y="184" fill="var(--ink)">全量给,或先列目录再逐篇读</text>
<text x="394" y="200" fill="var(--ink-soft)" font-size="11">GraphRAG 全局问答 Day 254</text>
<line x1="170" y1="208" x2="170" y2="232" stroke="var(--ink-faint)" marker-end="url(#m227)"/>
<rect x="20" y="236" width="300" height="44" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="34" y="256" fill="var(--ink)">④ 资料多、是文字、靠几段就能答</text>
<text x="34" y="272" fill="var(--ink-soft)" font-size="11">这才是 RAG 的主场</text>
</g>
</svg>
<figcaption>从上往下问,前三个问题有一个答「是」就先别用 RAG。客服 Agent 往往同时有②和④:政策类问题走 RAG,订单账单类问题走工具,这就是毕业项目 SupportPilot 的结构。</figcaption>
</figure>

第一条最容易被忽略,值得量一下。Anthropic 在介绍 Contextual Retrieval 的文章里说得很直接:知识库小于 20 万 token 时,可以把整个知识库放进 prompt,配合 prompt caching 又快又便宜。[Day 221](/blog/agent-zero/day-221-why-rag/) 做过全塞的实验,那时是 6 篇小文章,也没看缓存。今天把正式的 20 篇全塞进去,连问三个问题,看 DeepSeek 的上下文缓存能省多少。新建 `part04/stuff_all_cached.py`:

```python
# agent-zero-lab/part04/stuff_all_cached.py
from pathlib import Path

from common.llm import LLMClient
from part04.chunking import parse_article

docs = []
for path in sorted(Path("data/kb").glob("kb-*.md")):
    meta, body = parse_article(path)
    docs.append(f'<doc id="{meta["id"]}">\n{body}\n</doc>')
system = "你是云簿 CloudLedger 的客服助手。只根据 <资料> 回答,句末用方括号标出文章编号。\n<资料>\n" + "\n".join(docs) + "\n</资料>"
print("system 长度:", len(system), "字符")

client = LLMClient()
for q in ["年付专业版用到第 3 个月想退,能退多少", "专业版最多几个人", "导入流水提示 E1042 怎么办"]:
    r = client.chat([{"role": "system", "content": system}, {"role": "user", "content": q}], temperature=0)
    print(f"输入 {r.prompt_tokens} (缓存命中 {r.cache_hit_tokens})  ¥{r.cost:.4f}  {r.content[:30]!r}")
print("---", client.ledger)
```

<div class="line-notes">

- `from part04.chunking import parse_article` Day 224 的函数,一篇文件 → (元数据, 正文)。这里不切块,整篇用。
- `for path in sorted(Path("data/kb").glob("kb-*.md")):` 20 篇按文件名排序。排序在这里不只是为了好看:缓存只认**一模一样的开头**,顺序一变,前缀就不一样了。
- `docs.append(f'<doc id="{meta["id"]}">\n{body}\n</doc>')` 每篇包一层 `<doc>`,编号用文章编号 `kb-002`,因为没切块。
- `system = "你是云簿 CloudLedger 的客服助手。` 规矩在前,全部资料在后,整段放进 system。三个问题的 system 完全相同,只有 user 消息不同,这样后两次的开头就能命中缓存。
- `print("system 长度:", len(system), "字符")` 实测 3605 个字符。
- `r.cache_hit_tokens` `LLMClient` 从 DeepSeek 返回的 `prompt_cache_hit_tokens` 里读出来的:这次输入里有多少 token 命中了缓存。命中的部分按 0.04 元每百万算,没命中的按 2 元。同一行末尾的 `r.content[:30]!r` 只看回答开头,确认答得对。

</div>

```bash
uv run python -m part04.stuff_all_cached
```

真实输出:

```text
system 长度: 3605 字符
输入 2134 (缓存命中 0)  ¥0.0047  '年付专业版 468 元，折合每月 39 元。在第 3 个月中'
输入 2122 (缓存命中 1920)  ¥0.0006  '专业版最多 3 名成员。[kb-001][kb-015]'
输入 2126 (缓存命中 1920)  ¥0.0011  'E1042 表示文件的列名和模板不匹配，或者日期列的格式不是'
--- 3 次调用 | 输入 6382 / 输出 149 tokens | 约 ¥0.0064
```

第一次没有缓存,2134 个 token 全按未命中算,¥0.0047,是 RAG 的四倍。第二次起,开头 1920 个 token 命中了缓存,花费掉到 ¥0.0006,**比 RAG 的一次 ¥0.0010 到 ¥0.0015 还便宜**。三道题都答对了,而且没有检索这一步,就不存在「检索漏了」的问题:Day 226 练习 1 里 k=1 漏掉的发票规则,在这里一定在。第二题模型还同时引了 kb-001(套餐里写着「最多 3 名成员」)和 kb-015(人数上限),两处都看到了。

算一下第二次的账:命中 1920 × 0.04 / 10⁶ + 未命中 202 × 2 / 10⁶ + 输出约 18 × 8 / 10⁶ ≈ 0.00008 + 0.0004 + 0.00014 ≈ ¥0.0006,和 `LLMClient` 记的一致。缓存的规则和保留时间各家不同,DeepSeek 是自动的、按前缀匹配,细节看学习资料里的文档。

那为什么这门课还要花五天做 RAG?因为第一条的前提是「小」。20 篇、两千多 token 是我们为了教学造的玩具规模。按这个比例,每篇约 107 token,真实的帮助中心有两千篇就是 21 万 token,一次调用就算全部命中缓存也要 ¥0.0086,没命中是 ¥0.43,每个问题还要让模型读完二十多万字,慢,也更容易漏看中间的内容(Day 226 学习资料里的 Lost in the Middle)。资料一大,RAG 只给相关的四块,这笔账就倒过来了。所以正确的说法是:**先看规模,小就别折腾 RAG**,规模涨上去了再换,换的时候也有评估集可以比。

第二条和第三条不需要实验,说清楚就行。「客户 C-1024 这个月的账单是多少」的答案在数据库的某一行里,要的是精确值,不是「意思相近的段落」,用向量检索去找只会找到讲账单的帮助文章。这类问题要做成工具,让模型调用 `list_invoices` 去查(第五部分 CloudLedger MCP server 就有这个工具)。「总结一下我们所有的退款规则」要的是全局视角,退款相关的内容散在 kb-002、kb-003、kb-005、kb-008 好几篇里,top-4 天然会漏,这类问题要么全量给,要么先列出目录让模型自己决定读哪几篇(Day 266 的 Agentic RAG),要么用 Day 254 的 GraphRAG 全局问答。

## 动手练习

**练习 1:只认固定话术,重新判一次。** 把 `refusal_test.py` 的 `REFUSED` 换成只认 `帮助中心里没有找到这个问题的说明`,两版各跑一遍,看旧版得几分。不要改 `refusal_test.py` 文件本身。

<details><summary>参考答案</summary>

新建 `part04/ex_strict.py`:

```python
# agent-zero-lab/part04/ex_strict.py
import re

from part04 import rag_numpy, refusal_test

refusal_test.REFUSED = re.compile(r"帮助中心里没有找到这个问题的说明")
V2 = rag_numpy.SYSTEM
for name, system in [("v1", refusal_test.V1), ("v2", V2)]:
    print(f"===== {name}(严格判定)=====")
    refusal_test.run(system)
print("---", refusal_test.client.ledger)
```

<div class="line-notes">

- `from part04 import rag_numpy, refusal_test` 两个模块对象都拿过来。
- `refusal_test.REFUSED = re.compile(r"帮助中心里没有找到这个问题的说明")` 换掉模块里的判定正则。`run()` 每次执行时才读 `REFUSED`,所以和改 `SYSTEM` 是同一个道理。
- `V2 = rag_numpy.SYSTEM` 先存新版,因为 `run(V1)` 会把 `rag_numpy.SYSTEM` 改成旧版。
- `refusal_test.run(system)` 直接调用 `refusal_test.py` 里的函数,10 道题的列表也是那里的。
- `refusal_test.client.ledger` `refusal_test` 里的 `client` 就是 `rag_numpy` 里的同一个对象(它是 `from part04.rag_numpy import client` 拿过去的),所以这里看到的是全部 20 次的合计。

</div>

```bash
uv run python -m part04.ex_strict
```

真实输出(该答的 10 行都是 ✓,省略):

```text
===== v1(严格判定)=====
✗ 该拒 实际答  你们支持微信支付吗          '资料中没有关于是否支持微信支付的信息。目前资料里只提到支付失败时可改用支付宝支付 [kb-0'
✗ 该拒 实际答  有没有手机 App 可以记账     '资料里没有提到手机 App 的相关信息，我无法确认 CloudLedger 是否提供手机 A'
✗ 该拒 实际答  账本能直接导到金蝶里吗        '资料里没有提到与金蝶对接或导出的相关内容，我无法确认账本能否直接导入金蝶。\n\n目前资料中与数'
✗ 该拒 实际答  企业版专属客服的电话是多少      '资料中没有企业版专属客服电话的相关信息，建议您通过其他渠道咨询。'
✗ 该拒 实际答  发票可以邮寄纸质版吗         '资料中没有关于邮寄纸质发票的信息。根据现有资料，所有付费订单都可以开电子普通发票 [kb-0'
对 5/10

===== v2(严格判定)=====
✓ 该拒 实际拒  你们支持微信支付吗          '帮助中心里没有找到这个问题的说明,建议转人工客服。'
✓ 该拒 实际拒  有没有手机 App 可以记账     '帮助中心里没有找到这个问题的说明,建议转人工客服。'
✓ 该拒 实际拒  账本能直接导到金蝶里吗        '帮助中心里没有找到这个问题的说明,建议转人工客服。'
✓ 该拒 实际拒  企业版专属客服的电话是多少      '帮助中心里没有找到这个问题的说明,建议转人工客服。'
✓ 该拒 实际拒  发票可以邮寄纸质版吗         '帮助中心里没有找到这个问题的说明,建议转人工客服。'
对 10/10

--- 20 次调用 | 输入 7764 / 输出 908 tokens | 约 ¥0.0153
```

旧版的模型其实都拒了,但用一句固定话术判,一次都认不出来,5/10;新版照样 10/10。这就是「拒答话术要写死」的全部理由:不是为了让模型更老实,而是为了让程序能认出它的老实。顺带注意这次旧版「手机 App」那道的措辞和正文那次又不一样(「我无法确认」对「无法回答」),说法真的每次都在变。

</details>

**练习 2:到底是哪一句治好了编号?** 在旧版 `V1` 后面只加「出处只能原样照抄 <doc> 标签里的 id,不要在后面再加编号。」这一句,k 开到 8,对「退款之前已经开了发票怎么办」和 Day 226 练习 1 那道跨块问题各跑三次,看还有没有编造的编号。

<details><summary>参考答案</summary>

新建 `part04/ex_one_line.py`:

```python
# agent-zero-lab/part04/ex_one_line.py
from part04 import rag_numpy
from part04.rag_numpy import build_messages, check_citations, client, search
from part04.refusal_test import V1

rag_numpy.SYSTEM = V1 + "\n出处只能原样照抄 <doc> 标签里的 id,不要在后面再加编号。"

for question in ["退款之前已经开了发票怎么办", "退款之前开了发票要怎么处理?退款多久能到支付宝?"]:
    chunks = [c for c, _ in search(question, 8)]
    for n in range(3):
        reply = client.chat(build_messages(question, chunks), temperature=0).content
        cited, unknown = check_citations(reply, chunks)
        print(f"k=8 第{n + 1}次 {question[:10]}…  引用 {cited}  不合法 {unknown}")
print("---", client.ledger)
```

<div class="line-notes">

- `rag_numpy.SYSTEM = V1 + "\n出处只能原样照抄` 旧版两句加这一句,其他几句都不加。一次只改一个变量,才知道效果是谁带来的。
- `chunks = [c for c, _ in search(question, 8)]` k=8。Day 226 练习 1 里 k=8 时旧版编出了 `kb-003#2#1` 和 `kb-002#4#1`,是最容易出错的设置。
- `question[:10]` 问题只打印前 10 个字,两道题的开头不一样,够区分。

</div>

```bash
uv run python -m part04.ex_one_line
```

真实输出:

```text
k=8 第1次 退款之前已经开了发票…  引用 ['kb-003#2']  不合法 []
k=8 第2次 退款之前已经开了发票…  引用 ['kb-003#2']  不合法 []
k=8 第3次 退款之前已经开了发票…  引用 ['kb-003#2']  不合法 []
k=8 第1次 退款之前开了发票要怎…  引用 ['kb-003#2', 'kb-002#4']  不合法 []
k=8 第2次 退款之前开了发票要怎…  引用 ['kb-003#2', 'kb-002#4']  不合法 []
k=8 第3次 退款之前开了发票要怎…  引用 ['kb-003#2', 'kb-002#4']  不合法 []
--- 6 次调用 | 输入 3915 / 输出 417 tokens | 约 ¥0.0077
```

6 次全部合法。一句话就够了,和「先给结论」「拒答话术」那几句无关。这种「一次只加一句、看效果」的做法叫**消融实验**(ablation),改提示词时很好用:加了五句发现变好了,你并不知道是哪一句起作用、有没有哪一句是多余的,一句一句加才知道。

</details>

**练习 3(观察题):一句规矩都不给会怎样?** 把 `SYSTEM` 换成只有身份的一句「你是云簿 CloudLedger 的客服助手。」,问「专业版的 7 天无理由退款怎么申请」「你们支持微信支付吗」「账本能直接导到金蝶里吗」,每道跑两次,看模型会不会开始编。

<details><summary>参考答案</summary>

新建 `part04/ex_bare.py`:

```python
# agent-zero-lab/part04/ex_bare.py
from part04 import rag_numpy
from part04.rag_numpy import build_messages, client, search

rag_numpy.SYSTEM = "你是云簿 CloudLedger 的客服助手。"

for question in ["专业版的 7 天无理由退款怎么申请", "你们支持微信支付吗", "账本能直接导到金蝶里吗"]:
    chunks = [c for c, _ in search(question, 4)]
    for n in range(2):
        reply = client.chat(build_messages(question, chunks), temperature=0).content
        print(f"[{question} 第{n + 1}次] {reply[:150]!r}\n")
print("---", client.ledger)
```

<div class="line-notes">

- `rag_numpy.SYSTEM = "你是云簿 CloudLedger 的客服助手。"` 只剩身份。资料还在 user 消息里,模型照样看得到,只是没人告诉它只能用资料、要标出处、没有就说没有。
- `reply[:150]!r` 每次只看前 150 个字符,够看出它的态度。

</div>

```bash
uv run python -m part04.ex_bare
```

真实输出:

```text
[专业版的 7 天无理由退款怎么申请 第1次] '您好，关于专业版退款，我按资料为您说明一下：\n\n**申请入口**：进入「设置 → 订阅 → 申请退款」，选择退款原因并提交即可。客服主管会在 1 个工作日内审批。\n\n**关于"7 天无理由退款"**：我查阅了现有资料，其中并没有"7 天无理由退款"这一条款。资料中规定的是：年付套餐（专业版和企业版）'

[专业版的 7 天无理由退款怎么申请 第2次] '您好，关于"7 天无理由退款"这个说法，我查了一下现有的退款政策资料，**并没有找到"7 天无理由退款"这一条款**。目前资料里能确认的退款规则是：\n\n**年付套餐（专业版/企业版）中途取消**：按剩余整月数比例退款，已使用月份和当前所在月份不退。例如年付专业版 468 元，第 3 个月中途取消，退'

[你们支持微信支付吗 第1次] '您好，关于支付方式，目前资料中没有明确说明是否支持微信支付。已知的支付相关内容包括：支付失败时可改用支付宝支付，退款会原路退回（支付宝 1-3 个工作日到账，银行卡 3-7 个工作日到账）。建议您以收银台实际展示的支付选项为准，或联系人工客服确认最新支持的支付渠道。'

[你们支持微信支付吗 第2次] '您好，关于支付方式，目前资料中没有提到支持微信支付。现有信息显示，支付失败时可以改用支付宝支付，退款也会原路退回（支付宝 1 到 3 个工作日到账，银行卡 3 到 7 个工作日到账）。建议您以收银台实际展示的支付方式为准，或联系人工客服进一步确认。'

[账本能直接导到金蝶里吗 第1次] '根据现有资料，暂时没有关于导出到金蝶（或第三方财务软件）的说明，无法确认是否支持直接导入金蝶。\n\n资料里只提到**导入银行流水**支持 CSV 和 XLSX 格式（单文件不超过 10 MB、5 万行），以及企业版包含**开放 API**——如果你需要和自有系统对接，企业版的开放 API 可能是一个途'

[账本能直接导到金蝶里吗 第2次] '目前资料里没有提到和金蝶对接的功能。企业版包含开放 API，理论上可以通过 API 把数据对接到你自己的系统，但具体能不能直接导入金蝶、需要怎么配置，建议联系客服确认一下。'

--- 6 次调用 | 输入 2068 / 输出 816 tokens | 约 ¥0.0099
```

没有编出不存在的规则,这点新模型确实做得好。但仔细看,有三处是模型自己的「常识」:「建议您以收银台实际展示的支付选项为准」,帮助中心里没有收银台这个东西;「理论上可以通过 API 把数据对接到你自己的系统」,是它推测的;第一次回答开头就教用户怎么申请退款,默认了「7 天无理由」这件事值得去申请。这些话单独看都合情合理,放在客服回答里就是在替公司做承诺。SYSTEM 第二句后半截「不要用你自己的常识补充 CloudLedger 的规则」防的就是这类。另外,6 次回答一个出处都没有;输出平均每次 136 个 token(816 ÷ 6),新版拒答一次只要 14 个,又啰嗦又没法核对。

</details>

**练习 4:默写六句 SYSTEM,每句写一个理由。** 合上文章写出六句,每句后面用一句话写它防的是今天或 Day 226 实测到的哪个现象。

<details><summary>参考答案</summary>

| 句子 | 防的是什么(实测) |
| --- | --- |
| 你是云簿 CloudLedger 的客服助手。 | 定身份和立场 |
| 只根据 <资料> 回答,不要用你自己的常识补充规则 | 练习 3:「以收银台为准」「理论上可以通过 API 对接」这类常识推测 |
| 每个事实句后面标 [kb-002#1],一句用到多块就都标 | Day 226 练习 3:不要求就一个出处都没有;一句综合两块时只标一块 |
| 出处只能原样照抄 id,不要再加编号 | `[kb-003#2#1]`,旧版 3/3 编造,加了这一句 0/6 |
| 没有就直接说「帮助中心里没有找到这个问题的说明,建议转人工客服」,不要猜 | 旧版拒答说法每次不同,严格判定 0/5 能认出;拒答时还夹带误导性的出处 |
| 简洁的中文,先给结论,再给条件和步骤 | 旧版 351 元那道第一句在复述规则;练习 3 回答啰嗦,输出 token 翻倍 |

默写时最容易漏的是第四句和第五句里那段固定话术。话术要和 `refusal_test.py`、以后的评估脚本里判定用的那句**一字不差**,差一个标点程序就认不出。Day 255 把这段 `SYSTEM` 挪到 `part04/prompts.py` 统一管理,就是为了全课只有一份。

</details>

**验收标准:** `rag_numpy.py` 的 `SYSTEM` 换成六句版;`cite_repeat.py` 复现「旧版 3 次编号、新版 0 次」;`refusal_test.py` 两版都能跑出分数,`ex_strict.py` 能看到旧版掉到 5/10;能说出 k=1 那道题的拒答为什么是 bug;能按四个问题的顺序判断一个需求该不该用 RAG,并说出全塞加缓存实测一次多少钱。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 引用格式 | 出处的写法约定,这里是方括号里放块编号 `[kb-002#1]`,多个来源并列写 |
| 拒答 | 资料里没有足够信息时,模型明确说不知道并引导用户去别处,而不是编 |
| 幻觉(hallucination) | 模型生成了资料里没有、而且不正确的内容 |
| 固定话术 | 写死在 prompt 里、要求模型原样说的一句话,方便程序识别 |
| 拒答测试 | 一组「该答」和「该拒」的题,分别统计答对和拒对的比例 |
| 错误前提 | 问题里假设了一个不存在的事实,如「7 天无理由退款怎么申请」 |
| 检索漏导致的拒答 | 资料里有答案但没检索到,模型因此拒答;看起来正常,其实是检索的 bug |
| 消融实验(ablation) | 一次只加或只去掉一个部分,看效果变化,用来确认是哪个部分起作用 |
| 上下文缓存 / prompt caching | 厂商把相同开头的输入缓存起来,命中部分按低价计费;DeepSeek 命中价 0.04、未命中 2 元每百万 token |
| 全塞(long context) | 不检索,把全部资料放进 prompt;资料小时配合缓存比 RAG 更简单 |

## 常见误区

**提示词一次写一大段,不知道哪句管用。** 练习 2 证明治编号的只是一句。一句一句加,每加一句跑一次对比,说得出每句的来历。

**拒答话术让模型自由发挥。** 模型 5 次都拒了,但说法每次不同,用固定话术判时一次都认不出(练习 1,旧版 5/10)。话术写死,并且和判定代码用同一份字符串。

**只测「该拒的」,不测「该答的」。** 只看拒答率会鼓励一个什么都说「没找到」的 Agent。测试集一半该答一半该拒,答案是「不能」的题也要有,防止模型把「不能」和「不知道」混为一谈。

**看到拒答就觉得模型很老实。** k=1 时发票那一半被拒,资料里其实有,是检索漏了。拒答要分「真没有」和「没检索到」,后者是 bug。

**拒答时也要标出处。** 旧版拒答时引了支付宝、电子发票的块,用户容易误读成「只支持支付宝」「只能开电子发票」。拒答就是一句话,不带资料。

**新模型不会幻觉,规矩可以省。** 今天 `deepseek-flash` 在错误前提题上确实没上当,但一句规矩都不给时会用「收银台」「理论上可以」这类常识替公司做承诺(练习 3)。换小模型、换问题,结果都可能不同,防线要靠测试证明有没有用,不靠感觉加或删。

**一上来就做 RAG。** 资料只有几万 token、不常变时,全塞进 system 加缓存更简单,今天实测命中后一次 ¥0.0006,比 RAG 还便宜,也不会检索漏。先看规模。

**用向量检索去查数据库里的数。** 「C-1024 的账单金额」是精确查询,做成工具。向量检索只会找到「讲账单的文章」。

## 学习资料

### 文档与文章

- [Anthropic · Reduce hallucinations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations):官方给的减少幻觉的几招,第一招就是「允许模型说不知道」,还有「要求先引用原文再回答」。对照今天的六句 `SYSTEM`。
- [Anthropic · Claude prompting best practices · Long context prompting](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#long-context-prompting):讲长资料放在 prompt 上面、问题放最后,用 XML 标签包文档。今天「资料在前问题在后」的出处。
- [Anthropic · Introducing Contextual Retrieval](https://www.anthropic.com/research/contextual-retrieval):开头那段「知识库小于 20 万 token 就直接全塞,配合 prompt caching」是「什么时候不用 RAG」第一条的出处。Day 241 再读后半。
- [DeepSeek API 文档 · 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/):中文。看缓存怎么按前缀匹配、`prompt_cache_hit_tokens` 字段是什么,解释了今天全塞实验第二次为什么便宜。
- [DeepSeek API 文档 · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天记账用的价格,2026 年 10 月查到,用前再核对一次。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CmK8zWEHY&autoplay=0&high_quality=1" title="【漫士】AI为什么会出现幻觉?该如何解决?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>漫士沉思录 · 【漫士】AI为什么会出现幻觉?该如何解决? · 12 分钟。从模型怎么生成文字讲幻觉的来历,再讲 RAG 和「让模型说不知道」为什么能缓解。今天拒答一节的背景知识。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1mr421T7UY&autoplay=0&high_quality=1" title="RAG实战中常见的问题" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI老兵文哲 · RAG实战中常见的问题 · 4 分钟。很短,把检索不到、检索错、模型乱答几类问题过一遍,看完对照今天「检索漏导致的拒答」那一段。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/UabBYexBD4k" title="Is RAG Still Needed? Choosing the Best Approach for LLMs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · Is RAG Still Needed? Choosing the Best Approach for LLMs · 英文。对比 RAG 和长上下文各自适合什么情况,和今天「什么时候不用 RAG」那张判断图是同一个话题。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)。第 6 章「RAG and Agents」讲 RAG 时讨论了它和长上下文各自的适用场景,今天读那一小节。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024),中文版《图解大模型:生成式AI原理与实践》(人民邮电出版社,2025)。第 8 章后半讲 RAG,里面给大模型的 prompt 模板可以和今天的六句对照。

### 开源项目与代码

- [anthropics/claude-cookbooks](https://github.com/anthropics/claude-cookbooks):Anthropic 官方的示例仓库,里面有带引用的问答、prompt caching 的笔记本。今天看和 citations、caching 相关的两个目录,了解厂商推荐的写法。
- [datawhalechina/all-in-rag](https://github.com/datawhalechina/all-in-rag):中文 RAG 教程,看它讲生成和评估的章节里怎么处理「资料不足」。

## 自测

**1. 「出处只能原样照抄 id,不要在后面再加编号」这句防的是什么?怎么证明是它起的作用?**

<details><summary>答案</summary>

防模型自己给编号加层级,写出 `[kb-003#2#1]` 这种 `chunks.json` 里不存在的出处。证明靠两个实验:旧版两句对同一问题跑三次,三次都编;六句版三次都不编;再做消融,旧版只加这一句、k 开到 8,6 次全合法。一次只改一个变量,才能把功劳归给这一句。

</details>

**2. 旧版模型其实每次都拒答了,为什么还要把拒答话术写死?**

<details><summary>答案</summary>

为了让程序能认出拒答。旧版的说法每次不同,用固定话术判,5 次拒答一次也认不出(严格判定 5/10);宽松的正则是对着答案凑的,换一批题就会漏。而统计拒答率、拒答时自动转人工、评估时算指标都要靠程序判断。另外旧版拒答时还夹带出处,容易误导用户。写死以后 10/10,拒答就是干净的一句话。

</details>

**3. 拒答测试为什么要同时放「该答」和「该拒」两类题?「该答」的题里为什么要有答案是「不能」的?**

<details><summary>答案</summary>

只放该拒的题,一个什么都说「没找到」的 Agent 也能拿满分。两类一起测,才能同时管住「编」和「拒得太多」。答案是「不能」的题(月付专业版能开专票吗、免费版能用开放 API 吗)用来防模型把「资料说不能」和「资料里没有」混在一起:前者要明确答「不能」并标出处,后者才拒答。

</details>

**4. k=1 时「退款之前开了发票要怎么处理?退款多久能到支付宝?」发票那一半被拒了,这次拒答对不对?该去修哪里?**

<details><summary>答案</summary>

就生成这一步来说是对的,模型拿到的资料里确实没有发票的内容,它没编。但从整个系统看是一个 bug:帮助中心有这条规则(kb-003#2),是检索没取到。该修的是检索(k 太小,或者检索方式要改进,如 Day 235 起的 BM25、混合检索),不是 prompt。所以 RAG 评估要分检索层和生成层两层判(Day 255)。

</details>

**5. 面试题:「你们的知识库问答为什么用 RAG?有没有考虑过直接把文档塞进上下文?」**

<details><summary>答案</summary>

先说判断顺序。资料小、更新不频繁时,我会优先考虑全塞加 prompt caching:不会检索漏,系统简单。我实测过 20 篇两千多 token 的帮助中心全塞进 system,第一次 ¥0.0047,后续命中缓存 ¥0.0006,比 RAG 一次 ¥0.001 左右还便宜;Anthropic 的建议是 20 万 token 以内都可以这么做。

再说为什么最后用 RAG:真实知识库按同样比例两千篇就到 21 万 token,每次调用即使全部命中缓存也要近一分钱、没命中要四毛多,延迟高,模型读长上下文中间部分也更容易漏。RAG 只给相关的几块,成本和延迟都和知识库大小基本无关。最后补两种不该用 RAG 的情况:答案在数据库里的精确查询,做成工具;需要全局汇总的问题,top-k 天然会漏,用全量、先列目录再读或 GraphRAG。客服 Agent 通常是政策问题走 RAG、账单订单走工具。

</details>

## 明天预告

明天是 [Day 228 · Postgres 入门:装 Postgres.app、psql 和建库](/blog/agent-zero/day-228-postgres-basics/)。这五天的索引是一个 numpy 数组加一个 JSON,两个文件靠下标对齐,Day 225 已经看到它在「只改了一个文件」时会安静地取错块。要支持增量更新、按分类过滤、和业务数据放在一起,就该换成数据库了。明天先把 Postgres 装起来、学会用 psql 建库,Day 229 再装 pgvector,把今天的 42 块搬进去。
