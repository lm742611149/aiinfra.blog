---
title: 'Day 115 · 推理模型和思考模式'
description: '思考模式就是让模型在回答前先写一段草稿,草稿放在 reasoning_content 里,按输出 token 收钱。用三道能被程序判对错的云簿算账题实测:关思考对 1 道,开思考 3 道全对,花费贵 13 倍;再看它是怎么从「让我们一步步想」这句提示词变成训练目标的,以及 max_tokens 给少了会拿到一个空回答。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'reasoning', 'python', 'agent-zero']
series: 'agent-zero'
day: 115
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 114](/blog/agent-zero/day-114-hallucination/) 讲了幻觉:模型学到的是「像」不是「对」,最容易在「像真的但很少见」的问题上编;缓解它的三招是允许说不知道、多问几次看一致性、给资料并用代码核对引文。那一课里有一组实验开了思考模式,花了 1205 个输出 token,最后还是给一本不存在的书编了作者。

从 [Day 110](/blog/agent-zero/day-110-sampling-1/) 起,我们每次调 API 都要加一行 `extra_body={"thinking": {"type": "disabled"}}`,说「不关的话 temperature 不生效」。这个默认开着、一直被我们关掉的「思考模式」到底是什么?昨天它在编书名上没帮上忙,那它擅长什么?今天就讲这个。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清思考模式是什么:模型回答前先写一段草稿,草稿在响应的 `reasoning_content` 字段,和 `content` 分开,按输出 token 计费。
2. 看懂一组实测:三道能被程序判对错的云簿算账题,关思考和开思考各答一遍,比较准确率、token、耗时和花费。
3. 说出推理模型是怎么训出来的:从「让我们一步步想」这种提示技巧(思维链),到用「程序能判对错的题」做奖励的强化学习。
4. 知道开思考时最常见的两个坑:`max_tokens` 给少了 `content` 是空的;想得再久也变不出没见过的事实。

预计用时:2 小时左右。前置:[Day 113](/blog/agent-zero/day-113-training/) 的 RLHF 和奖励、[Day 114](/blog/agent-zero/day-114-hallucination/) 的幻觉、[Day 110](/blog/agent-zero/day-110-sampling-1/) 的「思考模式下 temperature 不生效」、[Day 108](/blog/agent-zero/day-108-tokens-2/) 的价格算法。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `quiz.py` 里的 `is_correct` 和 `pick_answer` 默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 先准备几道「程序能判对错」的题

要比较开不开思考,先得有题,而且题的对错要能**用程序判**,不能靠人眼看。原因有两个:一是我们要跑好几遍,一题一题人工判太累;二是今天后半段你会看到,「程序能判对错」这件事本身就是推理模型训练的关键。

我选了三道和云簿业务有关的题:数一句话里有几个「款」字(数数)、算升级补差价(按天折算)、算两个月后的客户数(连续百分比)。标准答案全部用 Python 按规则算出来,不手算。这部分纯本地,你现在就能跑。新建 `part02/quiz.py`:

```python
# agent-zero-lab/part02/quiz.py
SENTENCE = "退款到账后又被重复扣款,申请再次退款"


def upgrade_diff(old: float, new: float, start_day: int, days_in_month: int) -> float:
    days_left = days_in_month - start_day + 1
    return round((new - old) * days_left / days_in_month, 2)


def churn(start: int, months: list[tuple[float, int]]) -> int:
    n = start
    for lost_rate, added in months:
        n = n - round(n * lost_rate) + added
    return n


QUIZ = [
    (f"「{SENTENCE}」这句话里一共有几个「款」字?只输出数字。", SENTENCE.count("款")),
    (
        "云簿基础版每月 39 元,专业版每月 99 元。一位用户 10 月 13 日从基础版升级到专业版,"
        "10 月共 31 天,升级当天算专业版,按天折算补差价。要补多少元?保留两位小数,只输出数字。",
        upgrade_diff(39, 99, 13, 31),
    ),
    (
        "一家公司 1 月有 120 个付费客户,2 月流失 15%、新增 30 个,3 月流失 10%、新增 25 个。"
        "3 月底有几个付费客户?只输出整数(每月流失人数四舍五入到整数)。",
        churn(120, [(0.15, 30), (0.10, 25)]),
    ),
]


def is_correct(reply: str, expected: float) -> bool:
    try:
        return abs(float(reply.strip()) - expected) < 0.005
    except ValueError:
        return False


if __name__ == "__main__":
    for question, answer in QUIZ:
        print(answer, "<-", question[:24], "……")
    print(is_correct("36.77", 36.77), is_correct(" 3\n", 3), is_correct("约 36.77 元", 36.77))
```

<div class="line-notes">

- `SENTENCE = "退款到账后又被重复扣款,申请再次退款"` 第 1 题要数的句子。「退款」「扣款」「退款」,一共 3 个「款」。Day 107 说过模型看到的是 token 不是字,数字这种事它不擅长。
- `def upgrade_diff(old: float, new: float, start_day: int, days_in_month: int) -> float:` 升级补差价的规则函数。
- `days_left = days_in_month - start_day + 1` 13 号升级、当天算新套餐,13 到 31 号是 31 - 13 + 1 = 19 天。这个 `+ 1` 是最容易漏的地方。
- `return round((new - old) * days_left / days_in_month, 2)` 月差价 60 元,按 19/31 折算:60 × 19 ÷ 31 = 36.774…,保留两位是 36.77。`round(x, 2)` 相当于 JS 的 `Math.round(x * 100) / 100`。
- `def churn(start: int, months: list[tuple[float, int]]) -> int:` 客户数变化的规则函数,`months` 每一项是(流失率, 新增数)。
- `n = n - round(n * lost_rate) + added` 2 月:120 × 0.15 = 18,120 - 18 + 30 = 132;3 月:132 × 0.10 = 13.2,四舍五入 13,132 - 13 + 25 = 144。注意 Python 的 `round` 遇到正好 .5 时取偶数(`round(2.5)` 是 2,`round(3.5)` 是 4),叫银行家舍入,和 JS 的 `Math.round` 不一样。这道题没有正好 .5 的情况,所以不影响;真写计费代码时要用 `decimal` 模块指定舍入方式,第七部分讲。
- `QUIZ = [` 三道题,每道是一个元组(题目, 标准答案)。
- `(f"「{SENTENCE}」这句话里一共有几个「款」字?只输出数字。", SENTENCE.count("款")),` `str.count` 数子串出现几次,答案 3 由程序数出来。
- `"云簿基础版每月 39 元,专业版每月 99 元。一位用户 10 月 13 日从基础版升级到专业版,"` 括号里两段字符串挨着写会自动拼起来(Day 114 的 `RULES` 用过)。
- `upgrade_diff(39, 99, 13, 31),` 标准答案 36.77。
- `churn(120, [(0.15, 30), (0.10, 25)]),` 标准答案 144。
- `def is_correct(reply: str, expected: float) -> bool:` 判卷函数:模型的回复转成数字,和标准答案比。
- `return abs(float(reply.strip()) - expected) < 0.005` 先去掉首尾空白再转数字。小数不能用 `==` 直接比([Day 12](/blog/agent-zero/day-012-numbers/) 的 `0.1 + 0.2`),差距小于 0.005 就算对,也就是保留两位小数后一样。
- `except ValueError:` 转不成数字(比如模型回了「约 36.77 元」)就算错。我们在题目里要求了「只输出数字」,没照做也是一种错。
- `print(is_correct("36.77", 36.77), is_correct(" 3\n", 3), is_correct("约 36.77 元", 36.77))` 测一下判卷函数本身:带空白和换行的「3」应该算对,带字的应该算错。

</div>

```bash
uv run part02/quiz.py
```

实跑输出:

```text
3 <- 「退款到账后又被重复扣款,申请再次退款」这句话里 ……
36.77 <- 云簿基础版每月 39 元,专业版每月 99 元。 ……
144 <- 一家公司 1 月有 120 个付费客户,2 月流 ……
True True False
```

三个标准答案 3、36.77、144,判卷函数也按预期工作。记住 `is_correct` 这个函数,后面讲训练时它会换一个身份出现。

## 看一次模型的思考

先只开思考问一道题,把响应拆开看。这段要调 API,[Day 120](/blog/agent-zero/day-120-api-register/) 才注册拿 key,**这段你现在不用跑,看我的结果**。

```python
# agent-zero-lab/part02/think_once.py
import os
import time

from dotenv import load_dotenv
from openai import OpenAI

from quiz import QUIZ

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

question, answer = QUIZ[1]
start = time.perf_counter()
resp = client.chat.completions.create(
    model="deepseek-flash",
    messages=[{"role": "user", "content": question}],
    max_tokens=4000,
    extra_body={"thinking": {"type": "enabled"}},
)
elapsed = time.perf_counter() - start

msg = resp.choices[0].message
reasoning = getattr(msg, "reasoning_content", None) or ""
usage = resp.usage
assert usage is not None and usage.completion_tokens_details is not None
print("思考过程:\n" + reasoning)
print("最终回答:", repr(msg.content), " 标准答案:", answer)
print(f"输入 {usage.prompt_tokens}, 输出 {usage.completion_tokens}, 其中思考 {usage.completion_tokens_details.reasoning_tokens}")
print(f"耗时 {elapsed:.1f} 秒, finish_reason={resp.choices[0].finish_reason}")
```

<div class="line-notes">

- `import time` 标准库的计时模块。
- `from quiz import QUIZ` 刚写的题库。
- `question, answer = QUIZ[1]` 取第 2 道(下标从 0 开始),升级补差价那道。元组解包,相当于 JS 的 `const [question, answer] = QUIZ[1]`。
- `start = time.perf_counter()` 记下开始时刻。`perf_counter` 是专门用来量时间间隔的高精度计时器,相当于浏览器里的 `performance.now()`,只是单位是秒不是毫秒。
- `max_tokens=4000,` 开思考时要给足。思考过程也算输出 token,也受 `max_tokens` 限制,后面会故意给少一次看看会怎样。
- `extra_body={"thinking": {"type": "enabled"}},` 打开思考。其实 DeepSeek 默认就是开的,这里写出来是为了看得清楚。
- `elapsed = time.perf_counter() - start` 两个时刻相减就是这次调用花了几秒。
- `reasoning = getattr(msg, "reasoning_content", None) or ""` `reasoning_content` 是 DeepSeek 自己加的字段,不在 OpenAI 的标准里,所以 openai SDK 的类型定义里没有它,直接写 `msg.reasoning_content` 编辑器会画红线。`getattr(对象, "属性名", 默认值)` 按名字取属性,取不到就返回默认值,相当于 JS 的 `msg["reasoning_content"] ?? null`。
- `assert usage is not None and usage.completion_tokens_details is not None` 两个字段 SDK 都标成「可能是 None」,先排除掉。
- `print(f"输入 {usage.prompt_tokens}, 输出 {usage.completion_tokens}, 其中思考 {usage.completion_tokens_details.reasoning_tokens}")` `completion_tokens_details.reasoning_tokens` 是输出里属于思考的那部分。
- `print(f"耗时 {elapsed:.1f} 秒, finish_reason={resp.choices[0].finish_reason}")` `finish_reason` 是这次为什么停下来,`stop` 表示正常说完,Day 122 逐个讲。

</div>

我的实跑输出:

```text
思考过程:
We need answer only number. Need calculate prorated difference. Need be careful billing convention. Basic 39/month, pro 99/month, Oct 31 days. Upgrade Oct 13, upgrade day counts as pro. Need supplement difference for days 13-31 inclusive = 19 days. Difference monthly = 60. proration by days in month: 60 * 19/31 = 1140/31 = 36.77419 -> 36.77. Could there be credit basic unused days and charge pro for remaining? "从基础版升级到专业版... 按天折算补差价" likely difference between pro and basic for remaining days. 19 days. Output number only. 36.77. 
最终回答: '36.77'  标准答案: 36.77
输入 100, 输出 155, 其中思考 151
耗时 1.7 秒, finish_reason=stop
```

这就是「思考」的真面目:**模型在给出回答之前,先写了一段草稿**。草稿里它列出已知条件,算出 13 号到 31 号是 19 天(包含当天),算出 60 × 19 ÷ 31 = 36.77419,甚至还犹豫了一下「会不会是退还基础版剩余天数、再按专业版收剩余天数」,最后判断两种算法结果一样,写下答案。草稿写完,才在 `content` 里给出干干净净的「36.77」。

几个细节值得多看一眼。

草稿是英文的,而且是电报体,「Need be careful billing convention」这种不讲语法的句子。我们问的是中文,它却用英文想。思考过程是写给模型自己看的,不是写给你看的,训练时也没人要求它通顺。不同的题、不同的运行,它有时用中文有时用英文,你不能指望它的格式。

token 的账:输出 155 个,其中思考 151 个,真正的回答「36.77」只占 4 个。**思考的 token 是按输出 token 收钱的**,而且输出比输入贵 4 倍(Day 108 查的高峰价:输入 2 元、输出 8 元每百万 token)。这一题思考的花费是 151 × 8 ÷ 1,000,000 ≈ 0.0012 元,看着不多,乘以每天十万次请求就是一百多块。

输入 100 个 token。同一道题关思考时输入是 74 个(下面的实验里能看到),开思考多了 26 个。我推测是思考模式的对话模板多加了一些标记或说明,DeepSeek 文档里没写多出来的是什么,我没法确认。知道「开思考输入也会略多」就行。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="开思考时一次响应的结构:reasoning_content 和 content 两个字段,思考 token 占了输出的大部分">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">choices[0].message(开思考)</text>
<rect x="20" y="40" width="440" height="56" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="32" y="62" fill="var(--ink)">reasoning_content</text>
<text x="32" y="82" fill="var(--ink-soft)">"We need answer only number. ... 19 days ... 36.77."</text>
<rect x="470" y="40" width="150" height="56" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="482" y="62" fill="var(--ink)">content</text>
<text x="482" y="82" fill="var(--ink-soft)">"36.77"</text>
<text x="20" y="126" fill="var(--ink)">usage.completion_tokens = 155</text>
<rect x="20" y="138" width="589" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="609" y="138" width="16" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="300" y="154" text-anchor="middle" fill="var(--ink)">思考 151(reasoning_tokens)</text>
<text x="20" y="182" fill="var(--ink-soft)">右端那一小格是回答,4 个 token。整条按输出单价收钱。</text>
<text x="20" y="204" fill="var(--ink-faint)">关思考时没有 reasoning_content,completion_tokens 里也没有思考那一段。</text>
</g>
</svg>
<figcaption>思考和回答在响应里是两个字段,在账单上是一个数字。你的程序通常只用 `content`,但要为整条付钱。</figcaption>
</figure>

## 关思考和开思考,三道题各答一遍

一道题说明不了什么。把三道题都跑一遍,开、关各一次,用 `is_correct` 自动判卷,顺便统计 token、耗时和花费。这段**现在不用跑,看我的结果**:

```python
# agent-zero-lab/part02/think_vs_no.py
import os
import time

from dotenv import load_dotenv
from openai import OpenAI

from quiz import QUIZ, is_correct

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

total = {"disabled": [0, 0, 0.0, 0], "enabled": [0, 0, 0.0, 0]}
for i, (question, answer) in enumerate(QUIZ, start=1):
    for mode in ("disabled", "enabled"):
        start = time.perf_counter()
        resp = client.chat.completions.create(
            model="deepseek-flash",
            messages=[{"role": "user", "content": question}],
            max_tokens=4000,
            extra_body={"thinking": {"type": mode}},
        )
        elapsed = time.perf_counter() - start
        reply = resp.choices[0].message.content or ""
        usage = resp.usage
        assert usage is not None
        ok = is_correct(reply, answer)
        print(f"第 {i} 题 思考{mode:8} 答 {reply!r:8} {'对' if ok else '错'}  输入 {usage.prompt_tokens:3} 输出 {usage.completion_tokens:4}  {elapsed:.1f}s")
        t = total[mode]
        t[0] += usage.prompt_tokens
        t[1] += usage.completion_tokens
        t[2] += elapsed
        t[3] += ok
for mode, (p, c, sec, right) in total.items():
    cost = p * 2 / 1_000_000 + c * 8 / 1_000_000
    print(f"思考{mode:8} 对 {right}/3  输入 {p} 输出 {c}  共 {sec:.1f}s  约 {cost:.5f} 元")
```

<div class="line-notes">

- `from quiz import QUIZ, is_correct` 题库和判卷函数。
- `total = {"disabled": [0, 0, 0.0, 0], "enabled": [0, 0, 0.0, 0]}` 两种模式各一个累计列表,四格依次是:输入 token、输出 token、总秒数、答对几题。
- `for i, (question, answer) in enumerate(QUIZ, start=1):` `enumerate` 给编号,每一项又是一个元组,用括号再解包一层。相当于 JS 的 `QUIZ.forEach(([question, answer], idx) => ...)`。
- `for mode in ("disabled", "enabled"):` 每道题先关思考答一次,再开思考答一次。
- `max_tokens=4000,` 两种模式给一样的上限,关思考时用不了这么多,不影响。
- `extra_body={"thinking": {"type": mode}},` 这次没传 temperature,两种模式都用默认设置,公平一点(思考模式下 temperature 也不生效)。
- `ok = is_correct(reply, answer)` 程序判卷。
- `print(f"第 {i} 题 思考{mode:8} 答 {reply!r:8}` `{mode:8}` 占 8 格,让两行对齐。
- `t = total[mode]` 取出这个模式的累计列表。`t` 和 `total[mode]` 是同一个列表,改 `t` 就是改它(和 JS 里对象引用一样)。
- `t[3] += ok` 布尔值能当整数加:`True` 是 1,`False` 是 0。JS 里 `0 + true` 也是 1。
- `for mode, (p, c, sec, right) in total.items():` 每种模式的汇总,把四格解包成四个变量。
- `cost = p * 2 / 1_000_000 + c * 8 / 1_000_000` 按高峰价算钱。`1_000_000` 里的下划线只是为了好读,和 JS 的 `1_000_000` 一样。

</div>

我的实跑输出:

```text
第 1 题 思考disabled 答 '3'      对  输入  31 输出    1  1.0s
第 1 题 思考enabled  答 '3'      对  输入  57 输出  120  1.2s
第 2 题 思考disabled 答 '60.00'  错  输入  74 输出    3  0.8s
第 2 题 思考enabled  答 '36.77'  对  输入 100 输出  214  1.6s
第 3 题 思考disabled 答 '153'    错  输入  65 输出    1  0.8s
第 3 题 思考enabled  答 '144'    对  输入  91 输出  236  2.1s
思考disabled 对 1/3  输入 170 输出 5  共 2.6s  约 0.00038 元
思考enabled  对 3/3  输入 248 输出 570  共 4.8s  约 0.00506 元
```

关思考对 1 道,开思考 3 道全对。

关思考那两道错得很有意思。第 2 题它答 60.00,正好是两个套餐的月差价 99 - 39,完全没有按天折算。第 3 题答 153,我倒推不出它是怎么算的。两道题它都只输出了 1 到 3 个 token,也就是说它**没有任何中间步骤,直接「猜」了一个数**。Day 106 说过模型是一个 token 一个 token 往外吐的,关思考时,它要在吐第一个数字的那一刻就决定答案,前面没有任何地方让它算 19 天、算 60 × 19 ÷ 31。

开思考时它先写了一两百个 token 的草稿。草稿里的每个中间结果(19 天、60 元、132 个客户)都会被接回输入,成为下一步的上下文,后面的计算就能「看着」前面的结果做。这就是思考有用的根本原因:**它给了模型一块草稿纸**。

第 1 题两种模式都对了,可我在写这篇之前的一次试跑里(那次关思考时设了 temperature=0),关思考答的是 4,开思考答的是 3。数字这种事关思考时时对时错,这也是为什么评测要多跑几次(Day 112)。

代价也很清楚:输出 token 从 5 个变成 570 个,花费从 0.00038 元变成 0.00506 元,**贵了 13 倍**;总耗时从 2.6 秒变成 4.8 秒。这几道题都很短,思考也只写了一两百个 token;题目难一点,思考写上千个 token、等十几秒都很常见(昨天那个编书名的例子写了 1205 个)。

## 思考是怎么来的

### 先是一句提示词:让我们一步步想

既然关键是「先写草稿」,那不开思考模式,直接在提示词里要求它先写计算过程,行不行?

这其实就是 2022 年的一个重要发现。Google 的研究者在[《Chain-of-Thought Prompting Elicits Reasoning in Large Language Models》](https://arxiv.org/abs/2201.11903)里发现,在提示词里给几个「先写推理步骤、再写答案」的例子,模型做数学应用题的准确率大幅上升。这种做法叫**思维链(chain of thought,CoT)**。同年还有人发现,连例子都不用给,在问题后面加一句「Let's think step by step」(让我们一步步想)就有效。

我们来验证一下。还是关思考,但把「只输出数字」换成「先一步一步写出计算过程,最后一行只写答案」。这段**现在不用跑,看我的结果**:

```python
# agent-zero-lab/part02/cot_prompt.py
import os

from dotenv import load_dotenv
from openai import OpenAI

from quiz import QUIZ, is_correct

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

STEP = "先一步一步写出计算过程,最后一行只写「答案:数字」。"
for i in (1, 2):
    question, answer = QUIZ[i]
    prompt = question.replace("只输出数字。", "").replace("只输出整数", "答案取整数") + STEP
    resp = client.chat.completions.create(
        model="deepseek-flash",
        messages=[{"role": "user", "content": prompt}],
        temperature=0,
        max_tokens=800,
        extra_body={"thinking": {"type": "disabled"}},
    )
    text = resp.choices[0].message.content or ""
    last = text.strip().splitlines()[-1]
    final = last.replace("：", ":").split(":")[-1]
    assert resp.usage is not None
    print(f"第 {i + 1} 题: 最后一行 {last!r} -> {'对' if is_correct(final, answer) else '错'}, 输出 {resp.usage.completion_tokens} token")
    if i == 1:
        print(text)
```

<div class="line-notes">

- `STEP = "先一步一步写出计算过程,最后一行只写「答案:数字」。"` 思维链提示词。规定最后一行的格式,程序才好取出答案。
- `for i in (1, 2):` 只测关思考时答错的第 2、3 题(下标 1、2)。
- `prompt = question.replace("只输出数字。", "").replace("只输出整数", "答案取整数") + STEP` 原题要求「只输出数字」,和「写出过程」矛盾,先删掉再接上新要求。`replace` 和 JS 的 `replaceAll` 一样,会替换所有出现的地方。
- `temperature=0,` 关思考时 temperature 生效,设 0 让结果尽量稳定。
- `last = text.strip().splitlines()[-1]` `splitlines()` 按换行切成列表,`[-1]` 取最后一行。
- `final = last.replace("：", ":").split(":")[-1]` 模型可能写全角冒号也可能写半角,先统一成半角,再取冒号后面那段。「答案:36.77」得到「36.77」。
- `if i == 1:` 第 2 题把全文打出来看看。

</div>

我的实跑输出:

```text
第 2 题: 最后一行 '答案:36.77' -> 对, 输出 247 token
好的，我们先一步步分析。  

**第一步：明确已知条件**  
- 基础版：39 元/月  
- 专业版：99 元/月  
- 10 月共 31 天  
- 10 月 13 日升级，升级当天算专业版  
- 按天折算补差价  

**第二步：确定专业版使用天数**  
从 10 月 13 日到 10 月 31 日（含 13 日当天），一共是：  
31 - 13 + 1 = 19 天  

**第三步：计算每天的差价**  
月差价 = 99 - 39 = 60 元  
按 31 天折算，每天差价 = 60 ÷ 31 ≈ 1.93548387 元  

**第四步：计算需补的总差价**  
19 天 × (60 ÷ 31) = 19 × 60 ÷ 31 = 1140 ÷ 31 ≈ 36.7741935 元  

**第五步：保留两位小数**  
36.7741935 ≈ 36.77 元  

答案:36.77
第 3 题: 最后一行 '答案:144' -> 对, 输出 181 token
```

两道关思考时答错的题,加一句「一步一步写」全对了。同一个模型、同样关着思考,区别只是**允许它把中间步骤写出来**。这次的草稿是写给你看的:中文、分步骤、带标题,和开思考时那段英文电报体完全不同,但作用一样。

输出 token 是 247 和 181,和开思考时的 214、236 是同一个量级。所以「思维链提示」和「思考模式」在花费上差不多,省不了多少钱。

### 再变成训练目标

既然一句提示词就有效,为什么还要专门训练推理模型?因为提示出来的思维链,是模型在模仿它在网上见过的解题过程,长度有限,也不会检查自己。研究者想要的是:**模型自己学会该想多久、怎么检查、错了怎么换思路**。

2024 年 9 月 OpenAI 发布 o1,是第一个大规模商用的推理模型,但没公开怎么训的。2025 年 1 月 DeepSeek 发布了 [R1 的论文](https://arxiv.org/abs/2501.12948),把方法讲清楚了。核心思路一句话:**找大量能被程序自动判对错的题(数学、代码),让模型先写思考再写答案,答对给奖励、答错不给,用强化学习反复训练**。

这里接上了 [Day 113](/blog/agent-zero/day-113-training/) 的 RLHF。RLHF 的奖励来自人的比较,人会累、会有偏好、会被讨好;推理模型这一步的奖励来自程序判卷,不累、不偏、不能被讨好。这类训练叫 **RLVR**(reinforcement learning with verifiable rewards,可验证奖励的强化学习)。

我们的 `is_correct` 就是一个最小的可验证奖励:

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="可验证奖励的强化学习:模型写思考和答案,程序判对错给奖励,按奖励调整模型">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="50" width="130" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="85" y="72" text-anchor="middle" fill="var(--ink)">题目</text>
<text x="85" y="90" text-anchor="middle" fill="var(--ink-soft)">有标准答案</text>
<rect x="190" y="40" width="160" height="70" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="270" y="64" text-anchor="middle" fill="var(--ink)">模型</text>
<text x="270" y="84" text-anchor="middle" fill="var(--ink-soft)">思考 …… </text>
<text x="270" y="100" text-anchor="middle" fill="var(--ink-soft)">答案 36.77</text>
<rect x="390" y="50" width="130" height="50" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="455" y="72" text-anchor="middle" fill="var(--ink)">is_correct</text>
<text x="455" y="90" text-anchor="middle" fill="var(--ink-soft)">程序判卷</text>
<text x="545" y="68" fill="var(--ink)">对 → 奖励 1</text>
<text x="545" y="88" fill="var(--ink)">错 → 奖励 0</text>
<line x1="150" y1="75" x2="190" y2="75" stroke="var(--ink-soft)"/>
<line x1="350" y1="75" x2="390" y2="75" stroke="var(--ink-soft)"/>
<path d="M 580 100 L 580 150 L 270 150 L 270 110" fill="none" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="425" y="168" text-anchor="middle" fill="var(--ink-soft)">按奖励调整参数:让拿到奖励的那种「想法」更可能出现</text>
<text x="20" y="205" fill="var(--ink-faint)">只判最终答案,不判思考写得好不好。思考怎么写,是模型为了多拿奖励自己摸索出来的。</text>
</g>
</svg>
<figcaption>和 Day 113 的 RLHF 比,换掉的是打分的人:从标注员换成了 `is_correct` 这样的判卷程序。所以推理模型在数学、代码这类「答案能自动判」的题上进步最大。</figcaption>
</figure>

R1 论文里最有名的发现是:奖励只看最终答案对不对,从不教模型「该怎么想」,可训练到后来,模型的思考越写越长,而且自己学会了在中途停下来检查、发现算错了回头重算。论文里把这个现象叫「aha moment」(顿悟时刻)。上面 `think_once.py` 那段草稿里,模型自己冒出一句「Could there be credit basic unused days and charge pro for remaining?」(会不会是另一种算法?),就是这种自我检查的样子。

这件事还带来一个新的思路,叫 **test-time compute**(推理时计算):以前想要更好的效果,只能换更大的模型,在训练时多花钱;推理模型让你可以在**用的时候**多花钱,让同一个模型多想一会儿。2024 年 Google DeepMind 和伯克利的一篇论文([Snell 等](https://arxiv.org/abs/2408.03314))研究过这个取舍,结论是在不少题上,让小模型多想,比换一个大很多倍的模型更划算。今天三道题,关思考到开思考贵了 13 倍、准确率从 1/3 到 3/3,就是这个取舍的一个小样本。

## 开思考的两个坑

### 坑一:max_tokens 给少了,回答是空的

`max_tokens` 限制的是**整个输出**,思考也算在里面。给少了会怎样?故意试一次,同一道升级题,`max_tokens=100`。这段**现在不用跑,看我的结果**:

```python
# agent-zero-lab/part02/think_truncated.py
import os

from dotenv import load_dotenv
from openai import OpenAI

from quiz import QUIZ

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

question, _ = QUIZ[1]
resp = client.chat.completions.create(
    model="deepseek-flash",
    messages=[{"role": "user", "content": question}],
    max_tokens=100,
    extra_body={"thinking": {"type": "enabled"}},
)
choice = resp.choices[0]
reasoning = getattr(choice.message, "reasoning_content", None) or ""
print("content:", repr(choice.message.content))
print("finish_reason:", choice.finish_reason)
print("思考写了", len(reasoning), "个字符, 结尾:", repr(reasoning[-40:]))
assert resp.usage is not None
print("输出 token:", resp.usage.completion_tokens)
```

<div class="line-notes">

- `question, _ = QUIZ[1]` 标准答案这次用不上,用 `_` 接住表示「不要」。
- `max_tokens=100,` 故意给少。上面 `think_once.py` 光思考就写了 151 个 token。
- `print("content:", repr(choice.message.content))` 用 `repr` 打印,空字符串会显示成 `''`,看得清。
- `print("finish_reason:", choice.finish_reason)` 看它为什么停。
- `print("思考写了", len(reasoning), "个字符, 结尾:", repr(reasoning[-40:]))` `reasoning[-40:]` 是最后 40 个字符(负数切片从末尾数,Day 15 讲过),看思考停在了哪。

</div>

我的实跑输出:

```text
content: ''
finish_reason: length
思考写了 340 个字符, 结尾: '60. Prorated = 60 * 19/31 = 36.77419 -> '
输出 token: 100
```

`content` 是空字符串。模型思考到「36.77419 ->」,箭头后面正要写结果,100 个 token 用完了,被硬生生截断,回答一个字都没来得及写。100 个 token 照样收钱。

这个坑危险在于**它不报错**。如果你的程序只看 `content`,拿到一个空字符串,可能当成「模型没话说」继续往下走,或者把空字符串存进数据库。判断方法是看 `finish_reason`:`stop` 是正常说完,`length` 是被 `max_tokens` 截断了。练习 3 会写一个函数专门处理这种情况。开思考时,`max_tokens` 至少给到几千。给得越大越不容易截断,代价是偶尔遇到一次很长、很贵的思考,这个上限本身也是一道成本闸门。

### 坑二:想得再久,也变不出没见过的事实

回到昨天那个编书名的例子。开思考花了 1205 个 token 还是编了作者,它到底想了些什么?我用同一个问题又跑了一次,这次把思考过程打印出来(脚本是 `part02/think_fake_book.py`,和 `think_once.py` 只差题目,放在练习 4 里)。下面是思考过程的节选,里面出现的十几个人名都是真实的税务领域作者,我统一换成了「人名 A、B、C……」,ISBN 也打了码:

```text
We need answer Chinese. Need identify author of book 《增值税发票实务精讲》2019 中国税务出版社. Need one sentence. Need be accurate. Let's recall. ...
I have seen book: 《增值税发票实务精讲》 作者：人名 A? Let's think. ...
Let's search memory from training: Book details maybe ISBN 978756780xxxx? ...
Let's list known tax authors at 中国税务出版社:
- 人名 B
- 人名 C
...(一共列了 14 个人名)
... If wrong bad. Let's gather more memory. ...
I remember title: 《增值税发票实务精讲》 人名 D 著. ISBN 978756780xxxx? Maybe. ...
The exact title "增值税发票实务精讲" maybe by "人名 D" from 中国税务出版社. This seems plausible.
...
Let's final with one sentence.
```

最终回答:「《增值税发票实务精讲》(2019年,中国税务出版社)的作者是人名 D。」输出 1253 个 token。

这段思考很值得看。它知道自己该准确(「Need be accurate」「If wrong bad」),它试图「search memory」,它列出了 14 个可能的作者,它甚至「记起」了一个 ISBN,最后用「This seems plausible」(这看起来说得通)说服了自己。整个过程**像极了一个在考场上拼命回忆的学生**,可那本书根本不存在,回忆得再努力也只能是编。

这就是思考的边界:**思考是在已有的信息上做推导,不能凭空产生信息**。算补差价,条件都在题目里,多想就能算对;问一本书的作者,答案不在题目里也不在它的记忆里,想得越久,编得越像。正确的做法还是 Day 114 的第三招:给它资料,或者给它一个能查的工具。

顺带一个提醒:思考过程看起来像是模型「真实的想法」,但不要当真。Anthropic 的研究者在 2025 年的论文[《Reasoning Models Don't Always Say What They Think》](https://arxiv.org/abs/2505.05410)里做过实验:在题目里偷偷塞一个提示,模型用了这个提示改了答案,但在思考过程里提到它的比例经常不到 20%。所以思考内容适合拿来调试、看它大概怎么想的,不适合当作对用户的「解释」,更不能当作它一定是这么算的证据。

## 什么时候开,什么时候关

把今天看到的整理成一个粗略的判断。

**值得开:** 题目里给全了条件、需要多步推导的,比如计费规则叠加、日期计算、多条件判断、写代码、做计划。今天三道题关思考对 1 道、开思考全对,就是这一类。

**不值得开:** 简单分类、抽取字段、改写润色、闲聊。这些任务一步就能出结果,开了只是更慢更贵。另外,缺事实的问题开了也没用,该做的是给资料。

**特别注意:** 用户在聊天框前等着的场景,思考会推迟第一个字出现的时间(第一个字要等思考写完才开始),Day 133 讲流式输出时会量这个延迟。

DeepSeek 上还有一个旋钮 `reasoning_effort`(思考强度,`low`/`high`/`max`,默认 `high`),可以让它少想点或多想点;各档位实际差多少、怎么按任务选档,[Day 178](/blog/agent-zero/day-178-thinking-budget/) 用一套题实测。不开思考也能提高准确率的老办法(多答几次投票),[Day 179](/blog/agent-zero/day-179-self-consistency/) 讲。

最后两条 DeepSeek 的规则先记下,2026 年 10 月查[思考模式文档](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode):思考模式「不支持 `temperature`、`presence_penalty`、`frequency_penalty` 参数」,设了不报错但不生效(Day 110 已经踩过);多轮对话里,不带工具时上一轮的 `reasoning_content` 不用传回去,传了也会被忽略,带工具时**必须**完整传回,否则报 400。工具调用的部分 [Day 175](/blog/agent-zero/day-175-react-3/) 前后会遇到。

## 动手练习

**练习 1:加一道退款题。** 按 Day 114 的云簿退款政策出一道新题:专业版年付 950 元、月付 99 元,用了 40 天申请退款,已使用的月份不足一个月按一个月算(每月按 30 天),按月付价扣除,能退多少?写 `part02/quiz_refund.py`:`annual_refund(year_price, month_price, days_used)` 按规则算标准答案,并测几个天数。想想关思考的模型最可能答错成什么数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/quiz_refund.py
import math

from quiz import is_correct


def annual_refund(year_price: float, month_price: float, days_used: int) -> float:
    if days_used <= 30:
        return year_price
    months_used = math.ceil(days_used / 30)
    return max(year_price - months_used * month_price, 0)


QUESTION = (
    "云簿专业版年付 950 元,月付 99 元。年付 30 天内退款全额退;超过 30 天,"
    "已使用的月份(不足一个月按一个月算,每月按 30 天)按月付价格扣除,剩下的退还。"
    "一位用户用了 40 天申请退款,能退多少元?只输出数字。"
)

if __name__ == "__main__":
    for days in (10, 30, 40, 61, 400):
        print(f"用了 {days} 天 -> 退 {annual_refund(950, 99, days)} 元")
    expected = annual_refund(950, 99, 40)
    print(is_correct("752", expected), is_correct("851", expected))
```

<div class="line-notes">

- `import math` 要用向上取整。
- `if days_used <= 30:` 政策第 2 条:30 天内全额退。
- `months_used = math.ceil(days_used / 30)` `math.ceil` 向上取整,相当于 JS 的 `Math.ceil`。40 ÷ 30 = 1.33,向上取整是 2 个月。这就是「不足一个月按一个月算」。
- `return max(year_price - months_used * month_price, 0)` 950 - 2 × 99 = 752。`max(..., 0)` 防止用得太久退成负数:400 天是 14 个月,950 - 1386 是负的,这时退 0。
- `QUESTION = (` 题目写清所有规则,让答案只有一种。这道题后面接 API 时会用。
- `print(is_correct("752", expected), is_correct("851", expected))` 851 是我猜关思考最可能给的错答案:只扣 1 个月(950 - 99),忘了「不足一个月按一个月算」。

</div>

```bash
uv run part02/quiz_refund.py
```

```text
用了 10 天 -> 退 950 元
用了 30 天 -> 退 950 元
用了 40 天 -> 退 752 元
用了 61 天 -> 退 653 元
用了 400 天 -> 退 0 元
True False
```

61 天是 3 个月(61 ÷ 30 = 2.03,向上取整 3),950 - 297 = 653。边界值 30 天全额退。

我把这道题也发给了 DeepSeek(脚本 `part02/refund_api.py`,和 `think_vs_no.py` 的循环一样,只是题目换成 `QUESTION`、标准答案换成 `annual_refund(950, 99, 40)`)。这段要调 API,**你现在不用跑,看我的结果**:

```text
思考disabled 答 '851' -> 错, 输出 1 token
思考enabled  答 '752' -> 对, 输出 163 token
```

关思考答的正是 851,和我猜的一模一样:只扣了 1 个月。开思考 163 个 token 后答对 752。

</details>

**练习 2:放大到每天十万次。** 用 `think_vs_no.py` 实跑的汇总数字(关思考:3 题共输入 170、输出 5;开思考:输入 248、输出 570),算平均每次调用的花费,再按每天 10 万次请求算每天、每月(30 天)各花多少。写 `part02/cost_scale.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/cost_scale.py
RUNS = {"关思考": (170, 5), "开思考": (248, 570)}
PER_DAY = 100_000

for mode, (prompt_tokens, completion_tokens) in RUNS.items():
    per_call = (prompt_tokens * 2 + completion_tokens * 8) / 1_000_000 / 3
    print(f"{mode}: 每次 {per_call:.6f} 元, 每天 {per_call * PER_DAY:,.0f} 元, 每月 {per_call * PER_DAY * 30:,.0f} 元")
```

<div class="line-notes">

- `RUNS = {"关思考": (170, 5), "开思考": (248, 570)}` 正文实跑的三题合计 token。
- `per_call = (prompt_tokens * 2 + completion_tokens * 8) / 1_000_000 / 3` 三题总花费除以 3,得到平均每次。关思考:(170 × 2 + 5 × 8) ÷ 1,000,000 ÷ 3 = 0.000127 元。
- `print(f"{mode}: 每次 {per_call:.6f} 元,` `:.6f` 保留 6 位小数,`:,.0f` 千位加逗号不留小数。

</div>

```bash
uv run part02/cost_scale.py
```

```text
关思考: 每次 0.000127 元, 每天 13 元, 每月 380 元
开思考: 每次 0.001685 元, 每天 169 元, 每月 5,056 元
```

每月 380 元和 5,056 元,差 4,676 元。这还是按很短的题算的。对一个每天十万次请求的客服 Agent,「所有步骤一律开思考」每个月可能就是几千到几万块的差别。所以要按步骤选:分类、抽取这种关掉,算账、规划这种开着。这里用的都是高峰价,空闲时段是一半(Day 108 讲过)。

</details>

**练习 3:别把截断当回答。** 写 `part02/pick_answer.py`:`pick_answer(content, finish_reason)`,只有 `finish_reason` 是 `stop` 且 `content` 不是空白时才返回去掉空白的回答,否则返回 `None`。用五种情况测试,其中包括正文 `think_truncated.py` 实跑拿到的 `('', 'length')`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/pick_answer.py
def pick_answer(content: str | None, finish_reason: str) -> str | None:
    if finish_reason != "stop":
        return None
    if not content or not content.strip():
        return None
    return content.strip()


cases = [
    ("36.77", "stop"),
    ("", "length"),
    (None, "length"),
    ("36.7", "length"),
    ("  ", "stop"),
]
for content, reason in cases:
    print(f"{content!r:8} {reason:7} -> {pick_answer(content, reason)!r}")
```

<div class="line-notes">

- `def pick_answer(content: str | None, finish_reason: str) -> str | None:` `str | None` 表示「字符串或 None」,相当于 TS 的 `string | null`。返回 None 表示「这次的回答不能用」。
- `if finish_reason != "stop":` 不是正常说完的一律不要。被截断的回答哪怕有内容,也可能是半句话。
- `if not content or not content.strip():` `None` 和空字符串都是假值;只有空格的字符串 `strip()` 之后是空的,也算没内容。
- `("", "length"),` 正文 `think_truncated.py` 的真实情况:思考把 100 个 token 用完了。
- `("36.7", "length"),` 最阴险的一种:回答写到一半被截断,「36.77」只写出「36.7」,看起来像个正常数字。
- `print(f"{content!r:8} {reason:7} -> {pick_answer(content, reason)!r}")` `!r` 让 None 和空字符串都能看清。

</div>

```bash
uv run part02/pick_answer.py
```

```text
'36.77'  stop    -> '36.77'
''       length  -> None
None     length  -> None
'36.7'   length  -> None
'  '     stop    -> None
```

第四种最值得记住:被截断的「36.7」看起来完全正常,`is_correct` 还会说它离 36.77 只差 0.07。不检查 `finish_reason`,这种错误会悄悄进到你的数据里。拿到 `None` 之后怎么办(加大 `max_tokens` 重试、还是报错),[Day 127](/blog/agent-zero/day-127-retry-backoff/) 讲重试时再说。

</details>

**练习 4:读一段思考。** 正文坑二那段编书名的思考过程,脚本是 `part02/think_fake_book.py`。先把脚本补出来(提示:就是 `think_once.py` 换个题目,不用判卷)。然后回答:如果你是这个模型,思考到哪一句时就该停下来回答「不知道」?为什么它没停?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/think_fake_book.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

Q = "《增值税发票实务精讲》这本书(2019 年,中国税务出版社)的作者是谁?一句话回答。"
resp = client.chat.completions.create(
    model="deepseek-flash",
    messages=[{"role": "user", "content": Q}],
    max_tokens=4000,
    extra_body={"thinking": {"type": "enabled"}},
)
msg = resp.choices[0].message
reasoning = getattr(msg, "reasoning_content", None) or ""
print("思考过程:\n" + reasoning)
print("最终回答:", msg.content)
assert resp.usage is not None
print("输出 token:", resp.usage.completion_tokens)
```

<div class="line-notes">

- `Q = "《增值税发票实务精讲》这本书(2019 年,中国税务出版社)的作者是谁?一句话回答。"` 和 Day 114 一模一样的问题。
- `max_tokens=4000,` 正文实跑这次用了 1253 个,给 4000 足够。
- `print("思考过程:\n" + reasoning)` 正文的节选就是这里打出来的,人名是我事后替换的。

</div>

这段要调 API,**你现在不用跑**,实跑结果就是正文坑二的节选和最终回答(输出 1253 个 token)。

该停的地方:它列出 14 个候选作者的那一刻。一个真知道答案的人不需要列候选名单;列候选,说明它的「记忆」里没有这本书和某个作者的明确对应,接下来只能挑一个最像的。再往后它说「I remember ... Maybe」「This seems plausible」,这些词本身就是不确定的信号。

它没停有两个原因,都能从前几天的课里找到。一是训练奖励「猜」(Day 114):推理模型的强化学习只看最终答案对不对,一个从来不说「不知道」的模型,在有标准答案的题上反而拿分更多。二是用户要求「一句话回答」,它把「必须给出一句话」当成了硬要求。如果加上 Day 114 的那句「不确定就说不知道」,它大概率会在列候选名单时就放弃(那一招在不开思考时已经实测有效)。从工程上看,思考过程里出现这类不确定的词,可以当成一个警报信号;但 Day 114 和今天的论文都说了,别把它当成可靠的检测手段。

</details>

**验收标准:** `quiz.py`、`quiz_refund.py`、`cost_scale.py`、`pick_answer.py` 跑通,输出和文章完全一致;能说出 `reasoning_content` 和 `content` 的区别、思考 token 怎么计费、`finish_reason` 是 `length` 意味着什么;能用自己的话讲清思维链提示和推理模型的关系,以及「可验证奖励」为什么让推理模型在数学和代码上进步最大;能举例说明什么任务该开思考、什么任务开了也没用。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 推理模型(reasoning model) | 经过专门训练、回答前会先写一段思考的模型,如 OpenAI o1、DeepSeek-R1。现在主流模型多数都能开关思考 |
| 思考模式(thinking mode) | DeepSeek 的开关 `extra_body={"thinking": {"type": "enabled"}}`,默认开启 |
| reasoning_content | DeepSeek 响应里放思考过程的字段,和 `content` 同级;不是 OpenAI 标准字段,要用 `getattr` 取 |
| reasoning_tokens | `usage.completion_tokens_details` 里属于思考的输出 token 数,按输出价计费 |
| finish_reason | 这次生成为什么停下:`stop` 正常说完,`length` 被 `max_tokens` 截断 |
| 思维链(chain of thought,CoT) | 让模型先写推理步骤再给答案。2022 年发现靠提示词就能显著提升算术和推理题的准确率 |
| 强化学习 + 可验证奖励(RLVR) | 用程序能自动判对错的题做训练,答对给奖励。推理模型的核心训练方法 |
| aha moment | DeepSeek-R1 论文里描述的现象:只奖励最终答案,模型自己学会了在思考中途检查、回头重算 |
| test-time compute(推理时计算) | 在使用时多花计算(让模型多想)来换效果,而不是训练一个更大的模型 |
| reasoning_effort | DeepSeek 的思考强度参数,`low`/`high`/`max`,默认 `high`。Day 178 实测 |
| `time.perf_counter()` | Python 量时间间隔的计时器,单位秒,相当于浏览器的 `performance.now()` |
| `getattr(obj, name, default)` | 按名字取对象的属性,取不到返回默认值 |
| 银行家舍入 | Python `round` 遇到正好 .5 时取偶数:`round(2.5)` 是 2。和 JS 的 `Math.round` 不同 |

## 常见误区

**以为思考模式让模型变聪明了。** 它给了模型一块草稿纸,让中间结果能被后面的步骤用上。同一个模型关着思考、只在提示词里要求「一步一步写」,两道原来答错的题也全对了。

**开思考却把 `max_tokens` 设得很小。** `max_tokens` 管的是整个输出,思考也算。实测设 100 时思考到一半被截断,`content` 是空字符串,`finish_reason` 是 `length`,不报错,照样收 100 个 token 的钱。

**只看 `content`,不看 `finish_reason`。** 被截断的回答可能是空的,也可能是半截的「36.7」,看起来像正常答案。拿到回答先确认 `finish_reason == "stop"`。

**以为开思考就能少编。** 实测问不存在的书,思考了 1253 个 token,列了 14 个候选作者,最后还是编了一个。思考帮推导,不帮记忆;缺事实就给资料或工具。

**把思考过程当成模型「真实的想法」展示给用户。** 思考内容可能是英文电报体,格式不稳定;研究也发现模型经常不在思考里提到真正影响它答案的因素。它适合调试,不适合当解释。

**所有请求一律开思考。** 实测三道短题开思考贵 13 倍、慢将近一倍。分类、抽取、改写这类一步就能完成的任务,关掉。

**忘了思考模式下 temperature 不生效。** 开着思考调 temperature 没有任何效果,也不报错。要控制随机性就关思考(Day 110)。

## 学习资料

### 文档与文章

- [DeepSeek API:思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode):开关、`reasoning_effort` 档位映射、不支持的参数、多轮对话要不要回传 `reasoning_content`,今天最后那两条规则的原文都在这页。15 分钟。
- [DeepSeek-R1 论文](https://arxiv.org/abs/2501.12948):英文,2025 年 1 月。今天只读摘要和讲 R1-Zero「aha moment」的那一小节(有一张思考长度随训练步数上升的图),推导部分跳过。
- [Wei 等《Chain-of-Thought Prompting Elicits Reasoning in Large Language Models》](https://arxiv.org/abs/2201.11903):思维链的原始论文,2022 年。看第一张图,左边直接答错、右边写了步骤答对,和今天的实验是同一个对比。
- [Chen 等《Reasoning Models Don't Always Say What They Think》](https://arxiv.org/abs/2505.05410):Anthropic 2025 年的论文,读摘要,知道「思考内容不一定忠实」这个结论就够。
- [Snell 等《Scaling LLM Test-Time Compute Optimally can be More Effective than Scaling Model Parameters》](https://arxiv.org/abs/2408.03314):test-time compute 这个说法的代表论文。只读摘要。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aiADewEBC&p=18&autoplay=0&high_quality=1" title="【已授权】李宏毅2025《机器学习》" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>啥都会一点的研究生(授权搬运)· 李宏毅 2025《机器学习》第 18 P「第七讲:DeepSeek-R1 这类大型语言模型是如何进行『深度思考』(Reasoning)的?」· 78 分钟,中文。把让模型「想」的几种办法(思维链提示、多次采样、强化学习)放在一起讲,和今天的顺序几乎一样。今天看前 40 分钟。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1cV93YGEoy&autoplay=0&high_quality=1" title="万字科普DeepSeek R1底层原理，DeepSeek是从0到1的创新吗？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>新石器公园 · 万字科普 DeepSeek R1 底层原理 · 27 分钟,播放量六十万,用大白话讲 R1 怎么用强化学习训出思考能力,适合听一遍建立整体印象。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/xCRvOUykOX0" title="How do thinking and reasoning models work?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Google for Developers · How do thinking and reasoning models work? · 英文,Google 官方的科普短片,讲思考模型和普通模型的区别,配合今天「先写草稿再回答」的说法看。</figcaption>
</figure>

### 书籍

- 《Build a Reasoning Model (From Scratch)》(Sebastian Raschka 著,Manning,2026 年出版,我查到的上市时间各书店说法不一,有说 8 月有说 11 月;目前只查到英文原版):从一个普通模型出发,一步步加上推理时计算和强化学习。第十部分讲模型训练时再读,今天知道有这本书就行。

### 开源项目与代码

- [deepseek-ai/DeepSeek-R1](https://github.com/deepseek-ai/DeepSeek-R1):R1 的官方仓库。README 里有使用建议,比如推荐的温度、提示词里别放系统提示等,可以看出推理模型和普通模型用法的不同。
- [huggingface/open-r1](https://github.com/huggingface/open-r1):Hugging Face 复现 R1 训练流程的开源项目。看 README 里的三步计划,对照今天的「可验证奖励」。要 GPU,不用跑。
- [rasbt/reasoning-from-scratch](https://github.com/rasbt/reasoning-from-scratch):上面那本书的配套代码,里面有怎么写数学题判卷函数的例子,和今天的 `is_correct` 是一回事。

## 自测

1. 开思考时,一次响应里思考过程在哪个字段?为什么要用 `getattr` 取?它怎么计费?

<details><summary>答案</summary>

在 `choices[0].message.reasoning_content`,和 `content` 同级。它是 DeepSeek 自己加的字段,不在 OpenAI 标准里,openai SDK 的类型定义没有它,直接写属性名编辑器会报错,所以用 `getattr(msg, "reasoning_content", None)`。思考 token 计入 `completion_tokens`(其中的 `reasoning_tokens`),按输出价计费。

</details>

2. 关思考时,升级补差价那道题答了 60.00,只输出了 3 个 token。为什么不写过程就容易错?

<details><summary>答案</summary>

模型一个 token 一个 token 往外吐,关思考且要求只输出数字时,它必须在吐第一个数字时就定下答案,没有地方算 19 天、算 60 × 19 ÷ 31,只能凭「这类题通常答什么」猜,结果直接给了月差价 60。开思考或要求写步骤后,中间结果写出来并接回上下文,后面的计算能用上它们。

</details>

3. 思维链提示和推理模型是什么关系?推理模型的训练和 Day 113 的 RLHF 最大的不同是什么?

<details><summary>答案</summary>

思维链是 2022 年发现的提示技巧:让模型先写步骤再答,准确率大幅提升。推理模型把这件事变成了训练目标:用强化学习训练模型自己写思考、自己决定想多久。和 RLHF 的最大不同是奖励来源:RLHF 的奖励来自人的偏好比较,推理模型主要用程序能自动判对错的题(数学、代码),奖励只看最终答案对不对,叫可验证奖励(RLVR)。

</details>

4. 你把 `max_tokens` 设成 100、开着思考调用,拿到的 `content` 是空字符串,程序也没报错。发生了什么?怎么防?

<details><summary>答案</summary>

思考也算输出 token,思考还没写完就用完了 100 个 token,被截断,回答一个字都没写,`finish_reason` 是 `length`。防法:开思考时 `max_tokens` 给足(几千);程序里先检查 `finish_reason == "stop"` 且 `content` 非空再用,否则当成失败处理(加大上限重试或报错),不要把空字符串或半截回答当成正常结果。

</details>

5. 面试题:「你在做一个账单客服 Agent,有意图分类、查订单、计算退款金额、生成回复四个步骤。哪些步骤开思考?怎么验证你的选择是对的?」

<details><summary>答案</summary>

意图分类和生成回复一般不开:一步就能完成,开了只是更慢更贵,还推迟用户看到第一个字的时间。查订单靠工具,模型只负责填参数,也不用开。计算退款金额要叠加多条规则,是最可能受益的步骤,但更好的做法是把计算交给代码(按政策写函数,像今天的 `annual_refund`),模型只负责找出用哪条规则和提取参数;如果必须让模型算,就开思考,并用代码校验结果。验证方法:为每个步骤准备一套带标准答案的评测题,分别在开和关、不同思考强度下跑多次,比较准确率、token、延迟和花费,按「准确率达标的前提下最便宜」来选,上线后持续监控。

</details>

## 明天预告

Day 116 · Transformer 和注意力:面试够用版。这三天我们反复撞上同一件事:Day 113 的玩具只看前一个词,所以答非所问;Day 114 多看一个词,价格就不再说错;今天模型把草稿写出来,后面的计算就能「看着」前面的结果做。模型到底是怎么「看」前面那一大段文字的?明天讲注意力,不推公式,用图讲清楚每个 token 怎么决定该看谁。
