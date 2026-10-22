---
title: 'Day 114 · 幻觉从哪来,怎么让它少一点'
description: '模型编东西不是故障,是训练目标的直接结果。先用昨天的玩具模型看它怎么把「专业版 99 元」说成「39 元」,再在 DeepSeek 上问五个问题,看它什么时候老实、什么时候编;最后实测三招:允许说不知道、多问几次看一致性、把资料塞给它并用代码核对引文,各自管用到什么程度。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'hallucination', 'python', 'agent-zero']
series: 'agent-zero'
day: 114
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 113](/blog/agent-zero/day-113-training/) 讲了模型怎么训出来:预训练从海量文本里学「什么后面接什么」,得到一个只会续写的模型;指令微调教它认识「轮到我回答了」;RLHF 按人的偏好挪概率,让它学会礼貌、学会承认不知道。我们用一个只看前一个词的玩具模型把三步都演了一遍,还在练习 3 里看到:标注员偏爱自信的回答时,「不确定」从 20% 掉到了 1.6%。

昨天有两处伏笔今天要收。一是玩具模型生成了「云簿 专业版 每月 39 元」,而语料里专业版明明是 99 元;二是 DeepSeek 续写接口给虚构的云簿编了一套「控制台-费用中心-发票管理」。这两件事有个共同的名字:**幻觉**。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用自己的话说清幻觉是什么、为什么它是训练方式的直接结果,能指出哪类问题最容易让模型编。
2. 跑通玩具实验,量出 bigram 模型说错价格的比例,并解释为什么多看一个词就不错了。
3. 看懂 DeepSeek 上三招缓解手段的实测:允许说不知道、多次采样看一致性、给资料并用代码核对引文,说出每招管什么、不管什么。
4. 写出 `quote_ok` 这样的引文检查函数,知道它为什么比「相信模型说的依据」可靠。

预计用时:2.5 小时左右。前置:[Day 113](/blog/agent-zero/day-113-training/) 的 `part02/toy_lm.py`,[Day 112](/blog/agent-zero/day-112-sampling-2/) 练习 4 的一致率函数 `agreement`,[Day 110](/blog/agent-zero/day-110-sampling-1/) 的 temperature,[Day 16](/blog/agent-zero/day-016-strings-2/) 的字符串方法 `split`/`strip`。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `parse_reply` 和 `quote_ok` 默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 幻觉是什么

**幻觉(hallucination)** 指模型生成了听起来流畅、自信,但和事实不符、或者找不到依据的内容。它不是乱码,也不是语法错误,恰恰相反,它最危险的地方就是**读起来和真话一模一样**。

常见的有这么几种,今天都会碰到:

- 编事实:问一本不存在的书的作者,它报出一个人名。
- 编细节:问「退款几天到账」,它说「1–5 个工作日」,可这家公司根本没公布过。
- 接受错误前提:问「DeepSeek 为什么在 2023 年收购了 Stripe」,它顺着编一个收购理由(今天的实测里它没上当)。
- 不忠实于给它的资料:资料里写的是 30 天,它回答时说成 60 天。这一种在 Agent 里最常见,第四部分讲 RAG 时会专门测。

对写 Agent 的人来说,幻觉的代价很具体。客服 Agent 给用户承诺了一个不存在的退款政策,用户截图投诉;账单 Agent 编了一个发票号去查,查不到又编一个理由解释。所以「怎么让它少编」是这门课后面一半内容的出发点。

## 玩具模型为什么会说错价格

先回到昨天那一行。Day 113 的 `toy_lm.py` 只做了一件事:数语料里每个词后面跟过什么。语料里三种套餐的价格写得清清楚楚,它怎么会说错?

我们量一下它到底错得多频繁。新建 `part02/toy_hallucination.py`,让它从「云簿 专业版 每月」开始往下接 1000 次,看接出来的价格:

```python
# agent-zero-lab/part02/toy_hallucination.py
import random
from collections import Counter

from toy_lm import PRETRAIN, generate, train

FACTS = {"专业版": "99", "基础版": "39", "企业版": "299"}

model = train(PRETRAIN)
rng = random.Random(0)
for plan, price in FACTS.items():
    said = Counter(generate(model, f"云簿 {plan} 每月", rng).split()[3] for _ in range(1000))
    wrong = sum(n for p, n in said.items() if p != price)
    print(f"{plan}(真价 {price}): {dict(said)} -> 说错 {wrong / 1000:.0%}")
```

<div class="line-notes">

- `from toy_lm import PRETRAIN, generate, train` 这是 Day 113 建的 `part02/toy_lm.py`,语料、训练函数、生成函数都在里面。
- `FACTS = {"专业版": "99", "基础版": "39", "企业版": "299"}` 标准答案,和语料里写的一致。价格存成字符串,因为生成出来的 token 是字符串,好直接比较。
- `model = train(PRETRAIN)` 和 Day 113 一样的 bigram 模型。
- `rng = random.Random(0)` 种子 0,你跑出来应该和我完全一样。
- `for plan, price in FACTS.items():` 三种套餐各测一次。
- `said = Counter(generate(model, f"云簿 {plan} 每月", rng).split()[3] for _ in range(1000))` 从里往外读:`generate` 从「云簿 专业版 每月」开始接,得到比如 `"云簿 专业版 每月 39 元 。"`;`.split()` 切成词列表;`[3]` 取第 4 个词,也就是价格;外面套一层生成器表达式跑 1000 次,`Counter` 数每种价格出现几次。
- `wrong = sum(n for p, n in said.items() if p != price)` 把不等于真价的次数加起来。生成器表达式里带 `if` 过滤,相当于 JS 的 `Object.entries(said).filter(([p]) => p !== price).reduce((s, [, n]) => s + n, 0)`。
- `print(f"{plan}(真价 {price}): {dict(said)} -> 说错 {wrong / 1000:.0%}")` `:.0%` 换成百分比、不留小数(Day 112 用过)。

</div>

```bash
uv run part02/toy_hallucination.py
```

实跑输出:

```text
专业版(真价 99): {'299': 345, '99': 318, '39': 337} -> 说错 68%
基础版(真价 39): {'99': 353, '39': 318, '299': 329} -> 说错 68%
企业版(真价 299): {'99': 346, '39': 314, '299': 340} -> 说错 66%
```

三种套餐都错了三分之二。原因 Day 113 已经埋下了:模型只看最后一个词「每月」,而「每月」后面 99、39、299 各出现过一次,它根本不知道前面说的是哪个套餐。每一句话单看都通顺,语法完美,「云簿专业版每月 39 元」读起来和真话没有任何区别。

这就是幻觉最朴素的样子:**模型学到的是「什么词常常挨着出现」,不是「哪句话是真的」**。语料里所有片段都是真的,拼在一起却成了假的。练习 1 会给它多看一个词,错误率会直接降到 0,但问它语料里没有的「旗舰版」时又会出现另一种情况。

真模型比这个玩具强得多,它看的是前面一大段,不会在三个价格之间乱跳。可它面对的问题是同一类:**它没有一个「事实库」可以查,也没有一个内置的开关告诉它「这个我其实不知道」**。它只能按概率往下接,而「流畅」和「真实」在概率上不是一回事。

## 真模型:五个问题,看它什么时候编

现在换 DeepSeek。我准备了五个问题,有的是真的查不到,有的是故意埋了坑。这段要调 API,[Day 120](/blog/agent-zero/day-120-api-register/) 才注册拿 key,**这段你现在不用跑,看我的结果**。

```python
# agent-zero-lab/part02/hallucination.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

QUESTIONS = [
    "云簿 CloudLedger 公司的退款政策是什么?一句话回答。",
    "Python 标准库 json 模块里的 loads_safe 函数有哪些参数?一句话回答。",
    "DeepSeek 为什么在 2023 年收购了 Stripe?一句话回答。",
    "《增值税发票实务精讲》这本书(2019 年,中国税务出版社)的作者是谁?一句话回答。",
    "云簿的退款一般几个工作日到账?一句话回答。",
]
total_in = total_out = 0
for q in QUESTIONS:
    resp = client.chat.completions.create(
        model="deepseek-flash",
        messages=[{"role": "user", "content": q}],
        temperature=0,
        max_tokens=200,
        extra_body={"thinking": {"type": "disabled"}},
    )
    assert resp.usage is not None
    total_in += resp.usage.prompt_tokens
    total_out += resp.usage.completion_tokens
    print("问:", q)
    print("答:", resp.choices[0].message.content, "\n")
print(f"输入 {total_in} token, 输出 {total_out} token")
```

<div class="line-notes">

- `"云簿 CloudLedger 公司的退款政策是什么?一句话回答。",` 第 1 题:虚构公司,模型不可能知道。
- `"Python 标准库 json 模块里的 loads_safe 函数有哪些参数?一句话回答。",` 第 2 题:`loads_safe` 是我编的函数名,标准库里只有 `loads`。
- `"DeepSeek 为什么在 2023 年收购了 Stripe?一句话回答。",` 第 3 题:错误前提,这件事没发生过。
- `"《增值税发票实务精讲》这本书(2019 年,中国税务出版社)的作者是谁?一句话回答。",` 第 4 题:书名是我编的。我写之前搜过,没找到这本书。出版社是真的,题材也很常见,所以它「看起来很像存在」。
- `"云簿的退款一般几个工作日到账?一句话回答。",` 第 5 题:和第 1 题一样是虚构公司,但问的是一个很具体的细节。
- `total_in = total_out = 0` 连续赋值,两个变量都设成 0,用来累计花了多少 token。
- `temperature=0,` 尽量稳定,让结果主要反映问题本身,不是采样的运气(Day 112 说过 0 也不保证完全一样)。
- `assert resp.usage is not None` SDK 把 `usage` 标成可能为 None,先排除掉,编辑器才不画红线(Day 110 同样的写法)。
- `total_in += resp.usage.prompt_tokens` 累计输入 token。

</div>

我的实跑输出(第 4 题的人名我换成了「人名甲」,原文是一个真实存在的税务领域作者的名字,我不想把一本不存在的书安到真人头上):

```text
问: 云簿 CloudLedger 公司的退款政策是什么?一句话回答。
答: 抱歉，我无法用一句话回答，因为我没有关于“云簿 CloudLedger”这家公司退款政策的信息。建议你查阅其官网服务条款或联系客服确认。

问: Python 标准库 json 模块里的 loads_safe 函数有哪些参数?一句话回答。
答: Python 标准库 json 模块里没有 loads_safe 函数。

问: DeepSeek 为什么在 2023 年收购了 Stripe?一句话回答。
答: 这是不实信息，DeepSeek 从未收购 Stripe。

问: 《增值税发票实务精讲》这本书(2019 年,中国税务出版社)的作者是谁?一句话回答。
答: 《增值税发票实务精讲》的作者是人名甲。

问: 云簿的退款一般几个工作日到账?一句话回答。
答: 云簿退款一般1-5个工作日到账（具体以支付渠道为准）。

输入 109 token, 输出 96 token
```

五道题,前三道它表现得很好:不知道的公司说不知道,不存在的函数直接指出,错误前提当场驳回。新模型在这些「明显的坑」上比两三年前强了很多,这就是 Day 113 讲的后训练的功劳。

后两道它编了。第 4 题报出一个具体的人名,没有任何犹豫;第 5 题更值得警惕,它第 1 题刚说过「没有关于云簿退款政策的信息」,换个问法问细节,它就给出了「1–5 个工作日」。前后矛盾,自己却不知道。

花费:输入 109 个、输出 96 个 token,按 2026 年 10 月 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) `deepseek-flash` 高峰价(未命中缓存的输入 2 元、输出 8 元每百万 token)算,109 × 2 ÷ 1,000,000 + 96 × 8 ÷ 1,000,000 ≈ 0.001 元。

### 哪类问题最容易编

把五道题排一排,规律很明显:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="三类问题:见得多的答对,明显不对劲的会拒绝,看起来合理但很少见的最容易编">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">同一个模型,三类问题</text>
<rect x="20" y="44" width="190" height="130" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="115" y="66" text-anchor="middle" fill="var(--ink)">训练里见得多</text>
<text x="115" y="90" text-anchor="middle" fill="var(--ink-soft)">《人月神话》的作者</text>
<text x="115" y="110" text-anchor="middle" fill="var(--ink-soft)">json.loads 的参数</text>
<text x="115" y="150" text-anchor="middle" fill="var(--ink)">→ 基本答对</text>
<rect x="225" y="44" width="190" height="130" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="320" y="66" text-anchor="middle" fill="var(--ink)">一看就不对劲</text>
<text x="320" y="90" text-anchor="middle" fill="var(--ink-soft)">没听过的公司名</text>
<text x="320" y="110" text-anchor="middle" fill="var(--ink-soft)">不存在的函数、假收购</text>
<text x="320" y="150" text-anchor="middle" fill="var(--ink)">→ 多半会拒绝或纠正</text>
<rect x="430" y="44" width="190" height="130" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="525" y="66" text-anchor="middle" fill="var(--ink)">像真的,但很少见</text>
<text x="525" y="90" text-anchor="middle" fill="var(--ink-soft)">冷门书的作者</text>
<text x="525" y="110" text-anchor="middle" fill="var(--ink-soft)">某公司的具体天数</text>
<text x="525" y="150" text-anchor="middle" fill="var(--ink)">→ 最容易编</text>
<text x="20" y="200" fill="var(--ink-soft)">右边那类的特点:同类问题在训练里有大量「标准答法」(书→作者,退款→几个工作日),</text>
<text x="20" y="220" fill="var(--ink-soft)">而这一个具体对象它没见过。它知道答案该长什么样,不知道答案是什么。</text>
</g>
</svg>
<figcaption>幻觉主要集中在右边。Agent 里你问模型的事情,恰恰大多属于右边:你们公司的政策、某个客户的订单、某张发票的金额。</figcaption>
</figure>

为什么偏偏是「像真的但很少见」?可以从 Day 113 的三个阶段各找一个原因。

**预训练只教了「像」。** 网上有成千上万条「《XX》的作者是 YY」「退款一般 N 个工作日到账」,模型学到了这种句式后面该接一个人名、一个数字。对于一本它从没见过的书,它知道这里该填一个人名,而且能填出一个「像税务书作者」的名字(中国税务出版社的作者里确实有这些名字)。和玩具模型在「每月」后面填价格是同一回事。

**模型分不清「知道」和「猜」。** 你可能会想,模型说「人名甲」时,概率会不会很低,我们能不能用 logprob(Day 110)看出它在猜?有时候能,但不可靠:一个编出来的名字可能概率很高,因为同类句式见得太多了。练习里的多次采样实验会让你看到,它编的名字甚至可以 5 次里 4 次一样。

**训练和评测奖励猜。** 这是 2025 年 9 月 OpenAI 的研究者发表的论文[《Why Language Models Hallucinate》](https://arxiv.org/abs/2509.04664)(Kalai 等)的核心观点。他们打了个比方:像学生考试遇到不会的题,蒙一个答案还有机会得分,空着一定是零分。现在大多数评测都只看对错,「不知道」和答错一样是零分,于是模型在训练中被一次次鼓励去蒙。Day 113 练习 3 里,标注员偏爱自信的回答,「不确定」就从 20% 掉到 1.6%,就是这个机制的玩具版。他们的建议是改评测规则:答错扣分,不知道不扣分。这是论文作者的观点,不是定论,但和我们看到的现象对得上。

## 第一招:明确允许它说不知道

既然模型在训练里被鼓励「蒙」,最直接的办法是在提示词里告诉它:不会就别蒙。这段同样**现在不用跑,看我的结果**。

```python
# agent-zero-lab/part02/idk_prompt.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

Q = "《增值税发票实务精讲》这本书(2019 年,中国税务出版社)的作者是谁?一句话回答。"
IDK = "如果你不确定这本书是否存在,直接说不知道,不要猜。"

for label, content, thinking in (
    ("原问题", Q, "disabled"),
    ("加一句允许不知道", Q + IDK, "disabled"),
    ("原问题 + 开思考", Q, "enabled"),
):
    resp = client.chat.completions.create(
        model="deepseek-flash",
        messages=[{"role": "user", "content": content}],
        max_tokens=2000,
        extra_body={"thinking": {"type": thinking}},
    )
    assert resp.usage is not None
    print(f"{label}: {resp.choices[0].message.content}  (输出 {resp.usage.completion_tokens} token)")
```

<div class="line-notes">

- `IDK = "如果你不确定这本书是否存在,直接说不知道,不要猜。"` 要加的那一句。IDK 是英文「I don't know」的缩写。
- `for label, content, thinking in (` 三组对照,每组是一个三元组:标签、发给模型的内容、思考开关。
- `("原问题 + 开思考", Q, "enabled"),` 第三组打开思考模式,让模型先「想一想」再回答。思考模式是什么明天 [Day 115](/blog/agent-zero/day-115-reasoning-models/) 讲,今天只看结果。
- `max_tokens=2000,` 开思考时模型会先写一大段思考过程,也算在输出里,给少了回答会被截断(明天会故意演示一次)。
- `extra_body={"thinking": {"type": thinking}},` 这次没传 temperature,用默认值 1.0。思考模式下 temperature 本来也不生效(Day 110)。
- `print(f"{label}: {resp.choices[0].message.content}  (输出 {resp.usage.completion_tokens} token)")` 顺便打印输出 token 数,看开思考多花了多少。

</div>

我的实跑输出(人名同样替换了):

```text
原问题: 《增值税发票实务精讲》的作者是人名乙。  (输出 13 token)
加一句允许不知道: 不知道。  (输出 2 token)
原问题 + 开思考: 《增值税发票实务精讲》（2019年，中国税务出版社）的作者是人名丙。  (输出 1205 token)
```

三组结果各有一个教训。

第一行:没加那句话,它又编了,而且这次编的名字和上面 `hallucination.py` 那次不一样(上面是人名甲,这里是人名乙)。temperature 是默认的 1.0,每次掷骰子落在不同的名字上。这个细节很重要,下一招就靠它。

第二行:加了一句「不确定就说不知道」,它立刻老实了,只用了 2 个 token。这一招几乎零成本,应该成为你写提示词的习惯。但别高估它:它让模型**更愿意**承认不知道,不保证它**能识别出**自己不知道。如果书名再像一点、或者问的是一个真实存在但很冷门的细节,它照样可能自信地答错。

第三行最出乎很多人意料:开了思考模式,花了 1205 个输出 token(是不开的 90 多倍),最后还是编了一个人名。**思考能帮模型把推理步骤算对,却变不出它没见过的事实**。一本书的作者是谁,想多久都想不出来,只能查。明天讲思考模式时,会看到它在算账题上的表现完全不同。

## 第二招:多问几次,看它自己一不一致

第一招的第一行给了一个思路:编出来的东西,每次可能编得不一样;真知道的东西,每次都一样。那就同一个问题问 5 次,看答案一不一致。这个想法有一篇有名的论文叫 [SelfCheckGPT](https://arxiv.org/abs/2303.08896)(2023),它不需要任何外部资料,只靠模型自己多答几次互相比对。

[Day 112](/blog/agent-zero/day-112-sampling-2/) 练习 4 写过一致率函数 `agreement`,正好用上。不过我第一次写这个脚本时直接 `from stable_check import agreement`,一运行,屏幕上先冒出两行「工单 A: 多数答案 计费……」。原因是 Day 112 那个文件的演示代码没放进 `if __name__ == "__main__":`,import 时整个文件都会执行一遍([Day 32](/blog/agent-zero/day-032-modules/) 讲过这个坑)。所以这里把那三行函数抄过来。这段**现在不用跑,看我的结果**:

```python
# agent-zero-lab/part02/selfcheck.py
import os
from collections import Counter

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])


def agreement(outputs: list[str]) -> tuple[str, float]:
    answer, n = Counter(outputs).most_common(1)[0]
    return answer, n / len(outputs)


BOOKS = ["《增值税发票实务精讲》(2019 年,中国税务出版社)", "《人月神话》"]

for book in BOOKS:
    names: list[str] = []
    for _ in range(5):
        resp = client.chat.completions.create(
            model="deepseek-flash",
            messages=[{"role": "user", "content": f"{book}的作者是谁?只输出作者姓名。"}],
            temperature=1.0,
            max_tokens=30,
            extra_body={"thinking": {"type": "disabled"}},
        )
        names.append((resp.choices[0].message.content or "").strip())
    answer, rate = agreement(names)
    verdict = "可信" if rate >= 0.8 else "答案不稳定,很可能是编的"
    print(f"{book}: {names}")
    print(f"  多数答案 {answer}, 一致率 {rate:.0%} -> {verdict}")
```

<div class="line-notes">

- `def agreement(outputs: list[str]) -> tuple[str, float]:` 和 Day 112 练习 4 一模一样:返回出现最多的答案和它占的比例。
- `BOOKS = ["《增值税发票实务精讲》(2019 年,中国税务出版社)", "《人月神话》"]` 一本假书,一本真书。《人月神话》是软件工程的经典,作者弗雷德里克·布鲁克斯,训练语料里一定出现过很多次。
- `messages=[{"role": "user", "content": f"{book}的作者是谁?只输出作者姓名。"}],` 要求只输出姓名,方便直接比较字符串。
- `temperature=1.0,` 这次故意用 1.0。温度为 0 时 5 次大概率一样,就看不出「它是不是在猜」了。
- `names.append((resp.choices[0].message.content or "").strip())` `content` 可能是 None,用 `or ""` 兜底再去掉首尾空白。
- `verdict = "可信" if rate >= 0.8 else "答案不稳定,很可能是编的"` 和 Day 112 一样,80% 当及格线。

</div>

我的实跑输出(假书那一行的人名替换了,甲出现 4 次,乙 1 次):

```text
《增值税发票实务精讲》(2019 年,中国税务出版社): ['人名甲', '人名甲', '人名甲', '人名乙', '人名甲']
  多数答案 人名甲, 一致率 80% -> 可信
《人月神话》: ['小弗雷德里克·布鲁克斯', '布鲁克斯', '小弗雷德里克·布鲁克斯', '弗雷德里克·布鲁克斯', '布鲁克斯']
  多数答案 小弗雷德里克·布鲁克斯, 一致率 40% -> 答案不稳定,很可能是编的
```

结论**完全反了**:假书被判「可信」,真书被判「很可能是编的」。

我第一次看到这个结果也愣了一下,但仔细看,两个错误各有原因,而且都很有代表性。

真书判错,是因为我们的比较方法太笨。「小弗雷德里克·布鲁克斯」「弗雷德里克·布鲁克斯」「布鲁克斯」是同一个人,只是写法不同,`Counter` 却把它们当成三种答案。这是**字符串相等不等于意思相同**,SelfCheckGPT 论文里比较的是意思(用另一个模型判断两句话是否矛盾),不是逐字比较。练习 2 会加一个归一化函数,把这一行修成 100%。

假书判错更值得记住:**一致不等于真实**。模型 5 次里有 4 次编了同一个名字。可能这个名字在它的语料里和「增值税」「中国税务出版社」绑得特别紧,概率最高,于是每次都抽到它。前面 `hallucination.py` 用 temperature=0 时也是这个名字。在我写这篇之前的一次试跑里(那次问法是「一句话回答」,不是「只输出姓名」),5 次编出了 4 个不同的人名,一致性检查就能抓住。同一个方法,换一次运行结论就不同。

所以这一招的定位是:**不一致是很强的警报,一致却不能当证明**。它适合当一层便宜的筛子,把明显在猜的回答拦下来,不能当最后一道关。代价也要算:每个问题调 5 次,钱和时间都是 5 倍。

花费:10 次调用,每次输入约 25 个、输出约 8 个 token,总共约 250 × 2 ÷ 1,000,000 + 80 × 8 ÷ 1,000,000 ≈ 0.0011 元。

## 第三招:把资料给它,让它引用原文,再用代码核对

前两招都在跟模型的「记忆」较劲。真正解决问题的办法是换个思路:**不要让它凭记忆回答,把资料直接放进这次请求里,让它照着资料答**。云簿的退款政策它不可能知道,那就把政策原文给它。

光给资料还不够,它还是可能「不忠实」,资料里写 30 天它说成 60 天。所以再加两步:要求它写出依据,而且依据必须**一字不改地抄原文**;然后**用代码检查这句依据是不是真的在原文里**。模型说的话可以编,`in` 运算符不会编。

### 先写检查函数

这部分纯本地,你现在就能跑。新建 `part02/check_quote.py`:

```python
# agent-zero-lab/part02/check_quote.py
POLICY = """云簿退款政策(2026 年 10 月版)
1. 月付订阅不支持退款,取消后当前计费周期结束前仍可使用。
2. 年付订阅在购买后 30 天内可申请全额退款。
3. 年付订阅超过 30 天申请退款的,按未使用的整月退款,已使用的月份按月付价格扣除。
4. 退款原路退回到付款账户。"""


def parse_reply(reply: str) -> tuple[str, str]:
    answer, quote = reply.strip(), ""
    if "依据:" in reply:
        answer, quote = reply.split("依据:", 1)
    return answer.strip(), quote.strip().strip("「」\"")


def quote_ok(quote: str, source: str) -> bool:
    return quote != "" and quote in source


if __name__ == "__main__":
    tests = [
        "可以。\n依据:年付订阅在购买后 30 天内可申请全额退款。",
        "可以,3 个工作日到账。\n依据:退款将在 3 个工作日内原路退回。",
        "不知道。",
    ]
    for reply in tests:
        answer, quote = parse_reply(reply)
        print(f"{answer!r:24} 引文在原文里: {quote_ok(quote, POLICY)}")
```

<div class="line-notes">

- `POLICY = """云簿退款政策(2026 年 10 月版)` 三个引号是多行字符串,相当于 JS 的反引号模板字符串(不带插值)。这份政策是虚构的,后面整门课的云簿数据都按它来。
- `2. 年付订阅在购买后 30 天内可申请全额退款。` 注意第 4 条只说了「原路退回」,**没写几天到账**。上面 `hallucination.py` 第 5 题模型说的「1–5 个工作日」,在这份政策里是找不到的。
- `def parse_reply(reply: str) -> tuple[str, str]:` 把模型的回复拆成「答案」和「依据」两部分。
- `answer, quote = reply.strip(), ""` 默认整段都是答案,依据为空。
- `if "依据:" in reply:` `in` 判断子串,相当于 JS 的 `reply.includes("依据:")`。
- `answer, quote = reply.split("依据:", 1)` 只在第一个「依据:」处切一刀,切成两段。第二个参数 1 表示最多切一次,JS 的 `split` 没有这个能力,要自己用 `indexOf` 和 `slice`。
- `return answer.strip(), quote.strip().strip("「」\"")` 先去掉首尾空白,再去掉模型可能加上的引号。`strip("「」\"")` 的意思是:从两头去掉这几个字符里的任意一个,不是去掉这一整串。`\"` 是在双引号字符串里写一个双引号。
- `def quote_ok(quote: str, source: str) -> bool:` 检查依据是否真的出现在原文里。
- `return quote != "" and quote in source` 两个条件:不能是空的(否则空字符串 `"" in 任何字符串` 都是 True,这里很容易踩坑),而且必须是原文的子串。
- `"可以,3 个工作日到账。\n依据:退款将在 3 个工作日内原路退回。",` 第二个测试故意伪造一句「看起来像政策」的依据,看能不能抓住。
- `print(f"{answer!r:24} 引文在原文里: {quote_ok(quote, POLICY)}")` `!r` 加引号显示,`:24` 占 24 格对齐。

</div>

```bash
uv run part02/check_quote.py
```

实跑输出:

```text
'可以。'                    引文在原文里: True
'可以,3 个工作日到账。'           引文在原文里: False
'不知道。'                   引文在原文里: False
```

第二行就是我们要抓的那种:依据写得像模像样,「退款将在 3 个工作日内原路退回」,可原文里根本没这句话,`quote_ok` 返回 False。第三行没有依据,也是 False,这是对的,没有依据的回答不能直接当事实用。(中文和英文字符宽度不同,第一列没有完全对齐,不影响结果。)

### 再让模型来答

这段**现在不用跑,看我的结果**:

```python
# agent-zero-lab/part02/grounded.py
import os

from dotenv import load_dotenv
from openai import OpenAI

from check_quote import POLICY, parse_reply, quote_ok

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

RULES = (
    "你是云簿的客服。只根据下面的资料回答,资料里没有的就回答「资料里没有写」。\n"
    "回答格式:第一行写答案;第二行写「依据:」,后面一字不改地抄资料里支撑答案的那一句。\n\n"
    "资料:\n" + POLICY
)
QUESTIONS = ["我年付了专业版,用了 40 天,还能退款吗?", "月付能退款吗?", "退款一般几个工作日到账?"]

for q in QUESTIONS:
    resp = client.chat.completions.create(
        model="deepseek-flash",
        messages=[{"role": "system", "content": RULES}, {"role": "user", "content": q}],
        temperature=0,
        max_tokens=200,
        extra_body={"thinking": {"type": "disabled"}},
    )
    answer, quote = parse_reply(resp.choices[0].message.content or "")
    print("问:", q)
    print("答:", answer)
    print("引文:", quote or "(无)", "| 在原文里:", quote_ok(quote, POLICY), "\n")
```

<div class="line-notes">

- `from check_quote import POLICY, parse_reply, quote_ok` 刚写的检查函数和政策原文。这次 `check_quote.py` 的演示放在了 `if __name__ == "__main__":` 下,import 时不会打印东西。
- `RULES = (` 括号里几段字符串挨着写,Python 会自动把它们拼成一个(JS 要用 `+`)。最后一段用 `+ POLICY` 把政策原文接上。
- `"你是云簿的客服。只根据下面的资料回答,资料里没有的就回答「资料里没有写」。\n"` 两条规矩:只用资料;没有就明说。这就是第一招,和第三招一起用。
- `"回答格式:第一行写答案;第二行写「依据:」,后面一字不改地抄资料里支撑答案的那一句。\n\n"` 规定格式,`parse_reply` 才能拆开。
- `QUESTIONS = ["我年付了专业版,用了 40 天,还能退款吗?", "月付能退款吗?", "退款一般几个工作日到账?"]` 前两个资料里有答案,第三个就是 `hallucination.py` 第 5 题,资料里没有。
- `messages=[{"role": "system", "content": RULES}, {"role": "user", "content": q}],` 规矩和资料放在 `system` 消息里,问题放在 `user` 消息里。`system` 是给模型定总规矩的那条消息,[Day 130](/blog/agent-zero/day-130-system-prompt/) 细讲,今天知道它放在最前面、模型会优先遵守就够了。
- `answer, quote = parse_reply(resp.choices[0].message.content or "")` 拆出答案和依据。
- `print("引文:", quote or "(无)", "| 在原文里:", quote_ok(quote, POLICY), "\n")` 依据为空时显示「(无)」,并用代码核对。

</div>

我的实跑输出:

```text
问: 我年付了专业版,用了 40 天,还能退款吗?
答: 可以退款，按未使用的整月退款，已使用的月份按月付价格扣除。
引文: 年付订阅超过 30 天申请退款的,按未使用的整月退款,已使用的月份按月付价格扣除。 | 在原文里: True

问: 月付能退款吗?
答: 不能。
引文: 月付订阅不支持退款,取消后当前计费周期结束前仍可使用。 | 在原文里: True

问: 退款一般几个工作日到账?
答: 资料里没有写。
引文: 资料里没有写 | 在原文里: False
```

同一个模型,同一个「几个工作日到账」的问题,没给资料时它说「1–5 个工作日」,给了资料并要求它只照资料答,它说「资料里没有写」。前两题它找对了条款,而且依据一字不差,代码核对通过。

第三题的「引文」一栏是「资料里没有写」,核对结果 False。这个 False 是对的,它确实没有从资料里引用任何东西,程序就不该把它当成有依据的回答。真实系统里,这种情况会走「转人工」或「告诉用户去查」的分支。

花费:3 次调用,每次输入两百个 token 左右(大部分是政策原文和规矩)、输出约 50 个,按每次 230 个粗算,总共约 690 × 2 ÷ 1,000,000 + 150 × 8 ÷ 1,000,000 ≈ 0.0026 元。

这一招有个专门的名字,叫**有据回答(grounding)**:回答必须以给定的资料为依据。它是 RAG(检索增强生成,第四部分的主题)的核心。RAG 解决的是「资料从哪来」:政策有几百条、文档有几千页时,不可能全塞进去,要先检索出相关的几段。今天我们手动塞了一份,原理一模一样。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="有据回答的流程:资料和问题一起给模型,模型输出答案和引文,代码核对引文是否在原文里">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="40" width="120" height="44" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="80" y="66" text-anchor="middle" fill="var(--ink)">政策原文</text>
<rect x="20" y="110" width="120" height="44" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="80" y="136" text-anchor="middle" fill="var(--ink)">用户问题</text>
<rect x="190" y="70" width="120" height="54" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="250" y="94" text-anchor="middle" fill="var(--ink)">模型</text>
<text x="250" y="112" text-anchor="middle" fill="var(--ink-soft)">答案 + 依据</text>
<rect x="360" y="70" width="120" height="54" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="420" y="94" text-anchor="middle" fill="var(--ink)">quote_ok</text>
<text x="420" y="112" text-anchor="middle" fill="var(--ink-soft)">依据在原文里?</text>
<text x="540" y="76" fill="var(--ink)">是 → 回复用户</text>
<text x="540" y="128" fill="var(--ink)">否 → 转人工</text>
<line x1="140" y1="62" x2="190" y2="90" stroke="var(--ink-soft)"/>
<line x1="140" y1="132" x2="190" y2="104" stroke="var(--ink-soft)"/>
<line x1="310" y1="97" x2="360" y2="97" stroke="var(--ink-soft)"/>
<line x1="480" y1="90" x2="535" y2="72" stroke="var(--ink-soft)"/>
<line x1="480" y1="104" x2="535" y2="124" stroke="var(--ink-soft)"/>
<line x1="80" y1="84" x2="420" y2="84" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<text x="20" y="185" fill="var(--ink-faint)">虚线:核对时用的是同一份原文。蓝 = 模型,琥珀 = 我们的数据和代码。</text>
</g>
</svg>
<figcaption>关键在最后一步由代码完成。模型负责理解问题、找到条款、组织语言;「这句依据是不是真的在原文里」交给不会编的代码。</figcaption>
</figure>

它也有管不到的地方,心里要有数:引文在原文里,不代表答案对。模型可以引对了条款、却把结论说反,或者答案里多加了一句原文没有的承诺。字符串核对只能证明「它确实看了这一句」,更细的检查(答案和引文是否一致、有没有多说)要靠评测,第六部分讲。另外模型抄原文时可能顺手改了标点,比如把半角逗号改成全角,严格的 `in` 就会误判,练习 3 处理这个。

## 回到 Agent:幻觉要在设计上防

三招讲完,可以总结成几条写 Agent 时的习惯,后面每一部分都会用到:

**事实不靠模型记忆。** 政策、价格、订单、发票号,一律通过工具或检索拿到,放进上下文再让模型用。Day 107 说过长编号容易抄错,今天又看到它连作者名都敢编,这类东西从来就不该让它「回忆」。

**允许不知道,并且给「不知道」留出路。** 提示词里写清楚没有资料就说没有;程序里给这种回答设计好去向,转人工、追问用户,而不是当成失败。

**能用代码核对的,就用代码核对。** 引文在不在原文里、金额是不是等于数据库里的数、JSON 能不能解析。模型的输出先过一遍不会编的检查,再交给用户。

**不一致是警报。** 关键步骤可以多采样几次,答案对不上就降级处理。但别把一致当成真实。

**开思考救不了缺事实。** 思考帮的是推理,不是记忆,今天它想了 1205 个 token 还是编了作者。

## 动手练习

**练习 1:多看一个词。** 写一个只看前两个词的模型(trigram,三元模型):`train2` 统计每两个相邻词后面跟什么,`generate2` 用最后两个词查表。量一下它说「云簿 专业版 每月」后面的价格,再分别用二元和三元模型接「云簿 旗舰版 每月」(语料里没有旗舰版)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/trigram.py
import random
from collections import Counter, defaultdict

from toy_lm import PRETRAIN, generate, train


def train2(corpus: list[str]) -> dict[tuple[str, str], Counter[str]]:
    counts: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for line in corpus:
        toks = line.split()
        for a, b, c in zip(toks, toks[1:], toks[2:]):
            counts[(a, b)][c] += 1
    return counts


def generate2(counts: dict[tuple[str, str], Counter[str]], prompt: str, rng: random.Random, max_new: int = 12) -> str:
    toks = prompt.split()
    for _ in range(max_new):
        c = counts[(toks[-2], toks[-1])]
        if not c:
            break
        toks.append(rng.choices(list(c.keys()), weights=list(c.values()))[0])
        if toks[-1] == "。":
            break
    return " ".join(toks)


bi = train(PRETRAIN)
tri = train2(PRETRAIN)
rng = random.Random(0)
said = Counter(generate2(tri, "云簿 专业版 每月", rng).split()[3] for _ in range(1000))
print("三元模型说专业版每月:", dict(said))
print("二元模型问旗舰版:", generate(bi, "云簿 旗舰版 每月", random.Random(0)))
print("三元模型问旗舰版:", generate2(tri, "云簿 旗舰版 每月", random.Random(0)))
```

<div class="line-notes">

- `def train2(corpus: list[str]) -> dict[tuple[str, str], Counter[str]]:` 键从一个词变成「两个词组成的元组」。元组可以当字典的键,列表不行(列表能改,不能当键),这是元组和列表的一个实际区别。
- `for a, b, c in zip(toks, toks[1:], toks[2:]):` `zip` 可以同时配三个列表,每次取出相邻的三个词。第一行配出 `('云簿','专业版','每月')`、`('专业版','每月','99')`……
- `counts[(a, b)][c] += 1` 「a、b 后面出现过一次 c」。
- `c = counts[(toks[-2], toks[-1])]` 用最后两个词查表。从「专业版 每月」查,后面只有 99。
- `if not c:` 两个词的组合从没见过,就停。
- `bi = train(PRETRAIN)` Day 113 的二元模型,做对照。
- `print("二元模型问旗舰版:", generate(bi, "云簿 旗舰版 每月", random.Random(0)))` 二元模型只看「每月」,不管前面是什么。

</div>

```bash
uv run part02/trigram.py
```

```text
三元模型说专业版每月: {'99': 1000}
二元模型问旗舰版: 云簿 旗舰版 每月 299 元 。
三元模型问旗舰版: 云簿 旗舰版 每月
```

多看一个词,1000 次全部答对。语料里「专业版 每月」后面只有 99,不再和别的套餐串。这就是为什么真模型要看很长的上下文:上下文越完整,越不容易张冠李戴。

后两行更有意思。语料里根本没有旗舰版,二元模型照样给出了「每月 299 元」,一句流畅的假话;三元模型从没见过「旗舰版 每月」这个组合,查不到,直接停了,什么都没说。三元模型的「沉默」其实是一种诚实。真模型不会沉默,它的参数总能给出一张概率表,所以它面对没见过的东西时更像二元模型:总能接点什么。这就是为什么要在提示词里给它「不知道」这条路。

</details>

**练习 2:修好一致性检查。** 正文 `selfcheck.py` 把真书判成了「答案不稳定」,因为同一个人有三种写法。不调 API,把我实跑得到的 10 个答案写进代码,写一个 `normalize(name)` 只保留「·」后面的最后一段,再分别算原样比和归一后比的一致率。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/selfcheck_norm.py
from collections import Counter

FAKE = ["人名甲", "人名甲", "人名甲", "人名乙", "人名甲"]
REAL = ["小弗雷德里克·布鲁克斯", "布鲁克斯", "小弗雷德里克·布鲁克斯", "弗雷德里克·布鲁克斯", "布鲁克斯"]


def normalize(name: str) -> str:
    return name.split("·")[-1].strip()


def agreement(outputs: list[str]) -> tuple[str, float]:
    answer, n = Counter(outputs).most_common(1)[0]
    return answer, n / len(outputs)


for label, names in (("不存在的书", FAKE), ("人月神话", REAL)):
    print(label, "原样比:", agreement(names), " 归一后比:", agreement([normalize(n) for n in names]))
```

<div class="line-notes">

- `FAKE = ["人名甲", "人名甲", "人名甲", "人名乙", "人名甲"]` 正文实跑的假书答案,人名已替换。
- `REAL = ["小弗雷德里克·布鲁克斯", "布鲁克斯", "小弗雷德里克·布鲁克斯", "弗雷德里克·布鲁克斯", "布鲁克斯"]` 正文实跑的真书答案,原样照抄。
- `return name.split("·")[-1].strip()` 按间隔号「·」切开取最后一段。「小弗雷德里克·布鲁克斯」切成 `['小弗雷德里克', '布鲁克斯']`,取 `'布鲁克斯'`;没有「·」的「布鲁克斯」切完还是它自己。
- `print(label, "原样比:", agreement(names), " 归一后比:", agreement([normalize(n) for n in names]))` 列表推导式先把 5 个名字都归一,再算一致率。

</div>

```bash
uv run part02/selfcheck_norm.py
```

```text
不存在的书 原样比: ('人名甲', 0.8)  归一后比: ('人名甲', 0.8)
人月神话 原样比: ('小弗雷德里克·布鲁克斯', 0.4)  归一后比: ('布鲁克斯', 1.0)
```

归一之后,真书的一致率从 40% 变成 100%,判断修对了。假书还是 80%,一致性检查依然拦不住它。归一化只能修「写法不同」的问题,修不了「一致地编」的问题。真实系统里归一化也不会这么简单,人名、日期、金额各有各的写法,所以 SelfCheckGPT 这类方法用模型来判断两个回答意思是否相同。

</details>

**练习 3:引文核对别被标点坑了。** 模型抄原文时可能把半角逗号写成全角逗号、把「30 天」里的空格去掉。写 `quote_norm.py`:`norm(text)` 把全角逗号、句号、括号换成半角,再删掉空格;`quote_ok_loose` 先归一再比较。用三句话测试:原文照抄、全角逗号版、把 30 改成 60 的篡改版,对比严格版和宽松版的结果。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/quote_norm.py
from check_quote import POLICY, quote_ok

PUNCT = str.maketrans({"，": ",", "。": ".", "（": "(", "）": ")", " ": ""})


def norm(text: str) -> str:
    return text.translate(PUNCT)


def quote_ok_loose(quote: str, source: str) -> bool:
    return quote != "" and norm(quote) in norm(source)


q1 = "年付订阅在购买后 30 天内可申请全额退款。"
q2 = "月付订阅不支持退款，取消后当前计费周期结束前仍可使用。"
q3 = "年付订阅在购买后 60 天内可申请全额退款。"
for q in (q1, q2, q3):
    print(f"严格: {quote_ok(q, POLICY)!s:5}  宽松: {quote_ok_loose(q, POLICY)!s:5}  {q}")
```

<div class="line-notes">

- `PUNCT = str.maketrans({"，": ",", "。": ".", "（": "(", "）": ")", " ": ""})` `str.maketrans` 建一张「字符替换表」:全角逗号换成半角逗号,中文句号换成英文句号,全角括号换成半角,空格换成空字符串(也就是删掉)。JS 里没有对应的内置方法,要连写几个 `replaceAll`。
- `return text.translate(PUNCT)` 按表一次性替换所有字符。
- `return quote != "" and norm(quote) in norm(source)` 引文和原文都先归一,再判断子串。两边用同一套规则,才不会一边改了一边没改。
- `q2 = "月付订阅不支持退款，取消后当前计费周期结束前仍可使用。"` 中间是全角逗号,原文是半角逗号。肉眼几乎看不出区别。
- `q3 = "年付订阅在购买后 60 天内可申请全额退款。"` 篡改版,30 改成了 60。这才是我们真正要抓的。
- `print(f"严格: {quote_ok(q, POLICY)!s:5}` `!s` 把 True/False 转成字符串再按 5 格对齐,布尔值直接用 `:5` 会被当成数字 1/0 格式化。

</div>

```bash
uv run part02/quote_norm.py
```

```text
严格: True   宽松: True   年付订阅在购买后 30 天内可申请全额退款。
严格: False  宽松: True   月付订阅不支持退款，取消后当前计费周期结束前仍可使用。
严格: False  宽松: False  年付订阅在购买后 60 天内可申请全额退款。
```

严格版把全角逗号那句误判成假引文,宽松版放过了它;篡改了数字的那句,两个版本都拦住了。归一化要有分寸:只抹平「不影响意思」的差异(标点、空格),数字、否定词一个都不能动。如果你顺手把数字也归一了,第三句就会溜过去。

</details>

**练习 4(开放题):给五个问题配方案。** 正文 `hallucination.py` 的五个问题,如果放在云簿的客服 Agent 里,你会分别怎么处理?写出思路,并挑一个问题给出「改之前 / 改之后」的实测对比。

<details><summary>参考答案</summary>

示范解法:先看问题需要的事实在哪。第 1、5 题问的是云簿自己的政策,事实在公司的政策文档里,用第三招:检索政策、放进上下文、要求引用、代码核对,没有依据就转人工。第 2 题问的是公开的编程知识,模型大概率知道,但客服 Agent 根本不该答这种问题,在提示词里限定服务范围,超出范围礼貌拒绝。第 3 题是错误前提,模型这次自己驳回了,提示词里再加一句「用户的说法与资料冲突时以资料为准并指出」作保险。第 4 题问外部事实,客服 Agent 也不该答;如果真是业务需要(比如推荐参考书),就接一个书目查询工具,只推荐查得到的书。

实测对比用第 5 题,两次结果都在正文里,不用再跑:

```text
改之前(hallucination.py,不给资料):云簿退款一般1-5个工作日到账（具体以支付渠道为准）。
改之后(grounded.py,给资料并要求引用):资料里没有写。  引文核对 False -> 转人工
```

同一个模型、同一个问题,改之前给了一个找不到出处的具体数字,改之后老实说没有,而且程序能自动识别这是一条无依据的回答,走转人工分支。这个对比就是第四部分 RAG 要解决的事情的最小版本。

</details>

**验收标准:** `toy_hallucination.py`、`check_quote.py` 和练习 1–3 的脚本跑通,输出和文章完全一致;能说出幻觉最容易出现在哪类问题上、原因是什么;能说出三招各自管什么、不管什么(允许不知道管「愿不愿意承认」,不管「能不能识别」;一致性检查不一致是警报、一致不是证明;引文核对证明它看了原文,不证明答案对);能写出 `quote_ok` 并解释为什么要先判断非空。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 幻觉(hallucination) | 模型生成流畅自信、但与事实不符或找不到依据的内容。比如给一本不存在的书报出作者 |
| 错误前提 | 问题本身包含一个假的事实,比如「DeepSeek 为什么收购了 Stripe」。模型可能顺着编 |
| 不忠实(unfaithful) | 给了资料,模型的回答却和资料不符,比如把 30 天说成 60 天 |
| trigram 模型 | 看前两个词来猜下一个词的模型,比 bigram 多看一个词 |
| 自洽检查 / SelfCheckGPT | 同一问题多问几次,答案彼此矛盾就判定可能在编。不需要外部资料 |
| 归一化(normalize) | 比较前先把写法不同但意思相同的东西变成同一种写法,比如去掉人名前缀、统一标点 |
| 有据回答(grounding) | 要求模型只根据给定的资料回答,并给出依据 |
| 引文核对 | 用代码检查模型给出的依据是否真的出现在原文里,今天的 `quote_ok` |
| RAG(检索增强生成) | 先从资料库里检索相关片段,放进上下文,再让模型回答。第四部分的主题 |
| system 消息 | `messages` 里 `role` 为 `system` 的那条,用来给模型定总规矩,Day 130 细讲 |
| `str.maketrans` / `translate` | Python 字符串的批量字符替换:先建替换表,再一次性替换 |

## 常见误区

**以为新模型已经不会编了。** 实测它在明显的坑上表现很好(不存在的函数、假收购都驳回了),但在「像真的但很少见」的问题上照编不误:第 1 题刚说没有云簿的信息,第 5 题就报出「1–5 个工作日」。

**以为开思考就不会编。** 思考帮推理,不帮记忆。实测开思考花了 1205 个输出 token,最后还是给不存在的书编了一个作者。

**以为温度调到 0 就能防幻觉。** 温度只决定从概率表里怎么挑。`hallucination.py` 用的就是 temperature=0,它照样编了作者。编不编取决于概率表本身,不取决于怎么挑。

**以为答案一致就是对的。** 实测假书 5 次里 4 次编了同一个名字,一致率 80% 被判「可信」。一致性检查只能当筛子,不能当证明。

**用 `quote in source` 却忘了判空。** 空字符串是任何字符串的子串,`"" in POLICY` 是 True。模型没给依据时,不判空的检查会直接放行。

**相信模型自己说的「依据」。** 模型可以编出一句看起来像政策的依据(`check_quote.py` 第二个测试就是这种)。依据是不是真的,要用代码对照原文核对。

**把「引文核对通过」当成「答案正确」。** 它只证明模型看了这一句,结论可能说反、可能多加了承诺。答案和依据是否一致要靠评测。

## 学习资料

### 文档与文章

- [Kalai 等《Why Language Models Hallucinate》](https://arxiv.org/abs/2509.04664):英文,2025 年 9 月,作者来自 OpenAI 和佐治亚理工。今天「训练和评测奖励猜」那段的出处。读摘要和引言就够,中间的理论推导可以跳过。OpenAI 官网也有一篇同名的科普博客,按标题搜索(官网对命令行访问返回 403,需浏览器打开)。
- [Lilian Weng:Extrinsic Hallucinations in LLMs](https://lilianweng.github.io/posts/2024-07-07-hallucination/):英文,2024 年 7 月,把幻觉的成因、检测方法、缓解方法整理得最全的一篇综述博客。今天读前两节(成因和检测),后面的训练方法以后再看。1 小时。
- [Manakul 等《SelfCheckGPT》](https://arxiv.org/abs/2303.08896):第二招的出处。看摘要和第一张图,理解「多采样、互相比对」的想法就行。
- [Huang 等《A Survey on Hallucination in Large Language Models》](https://arxiv.org/abs/2311.05232):幻觉的综述论文,分类讲得很细。今天只看讲幻觉分类的那一节,当一张地图留着。顺带一提,这篇和上面那篇 SelfCheckGPT 都是我让 DeepSeek「推荐 3 篇幻觉论文」时它给出的,我逐个查了 arXiv 编号,三篇都是真的,热门论文它记得很准,和今天的结论一致。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CmK8zWEHY&autoplay=0&high_quality=1" title="【漫士】AI为什么会出现幻觉？该如何解决?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>漫士沉思录 · AI 为什么会出现幻觉?该如何解决?· 12 分钟,播放量很高的一期,从训练方式讲为什么模型会编,和今天的「三个原因」可以互相印证。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Uy411i7eQ&autoplay=0&high_quality=1" title="什么是大模型幻觉？为什么会产生幻觉？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI老兵文哲 · 什么是大模型幻觉?为什么会产生幻觉?· 5 分钟,短而直白,适合看完正文后快速复习一遍概念。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7xTGNNLPyMI" title="Deep Dive into LLMs like ChatGPT" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · Deep Dive into LLMs like ChatGPT · 英文(B 站中文字幕搬运见 Day 113)。今天看讲 hallucinations 和 tool use 的那一章:他讲模型怎么被训练成「不知道就说不知道」,以及为什么让模型去搜索比让它回忆更可靠,和今天第一招、第三招一一对应。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》(Chip Huyen 著,O'Reilly,2025,目前只查到英文原版):第 2 章讲模型输出的概率性质时,专门有一节讲幻觉的两种成因假说;第 6 章讲 RAG。今天读第 2 章那一节。

### 开源项目与代码

- [potsawee/selfcheckgpt](https://github.com/potsawee/selfcheckgpt):SelfCheckGPT 论文的官方代码。今天只看 README 里的几种比较方法(BERTScore、NLI、用大模型判断),理解它为什么不用字符串相等。需要装深度学习的包,不用跑。

## 自测

1. 玩具 bigram 模型的语料里每条价格都是对的,为什么它会说「专业版每月 39 元」?三元模型为什么不会?

<details><summary>答案</summary>

bigram 只看最后一个词「每月」,而「每月」后面 99、39、299 各出现过一次,它不知道前面是哪个套餐,只能三选一,实测错 68%。三元模型看「专业版 每月」两个词,语料里这个组合后面只有 99,所以 1000 次全对。真实的片段拼在一起成了假话,这是幻觉最朴素的来源。

</details>

2. 为什么「冷门书的作者」「某公司退款几天到账」这类问题最容易编,而「不存在的 Python 函数」反而不容易?

<details><summary>答案</summary>

前者的同类问题在训练语料里有大量标准答法(书名后面接作者名、退款后面接几个工作日),模型知道答案该长什么样,能填出一个很像的人名或数字,而这个具体对象它没见过。后者它对 json 模块非常熟,`loads_safe` 和它记得的东西明显冲突,所以能识别出来。越像真的、越少见,越危险。

</details>

3. 提示词里加「不确定就说不知道」之后,实测模型回答了「不知道」。这能说明它以后都不会编了吗?

<details><summary>答案</summary>

不能。这一句让模型更愿意承认不知道,但不保证它能识别出自己不知道。书名再像一点、或者问一个真实存在但很冷门的细节,它照样可能自信地答错。这一招成本几乎为零,应该每次都加,但不能当唯一的防线。

</details>

4. `quote_ok` 为什么要先判断 `quote != ""`?引文核对通过,能不能说明答案正确?

<details><summary>答案</summary>

空字符串是任何字符串的子串,`"" in POLICY` 为 True,不判空的话模型不给依据也会被放行。核对通过只证明依据确实出自原文,不证明答案正确:模型可能引对了条款却把结论说反,或在答案里多加原文没有的承诺。

</details>

5. 面试题:「你们的客服 Agent 给用户承诺了一个公司根本没有的退款政策。你会怎么排查和改进?」

<details><summary>答案</summary>

先查这次调用的现场:上下文里有没有放政策资料、放的是不是最新版、检索有没有漏掉相关条款;再看模型的回答有没有给依据。改进分几层:事实一律来自检索到的政策文档,提示词要求只依据资料回答、没有就明说;回答必须附原文引用,用代码核对引用是否在资料里,核对不过或没有引用的走转人工;涉及金额、天数这类承诺的,用代码按规则算或从数据库查,不让模型生成;高风险回答多采样几次,不一致就降级;最后把这个案例加进评测集,以后每次改提示词或换模型都回归测一遍。

</details>

## 明天预告

Day 115 · 推理模型和思考模式。今天开了思考的那一组,花了 1205 个 token 还是编了作者,看起来思考没什么用。明天换一类题:算升级补差价、算客户流失,看关思考和开思考谁算得对,打开 `reasoning_content` 看模型到底「想」了些什么,再说清楚思考模式是怎么训出来的、什么时候值得开。
