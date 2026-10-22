---
title: 'Day 113 · 模型怎么训出来:预训练、指令微调、RLHF 一句话版'
description: '那张「下一个 token 概率表」是从哪来的?用三个几十行的纯 Python 玩具把训练的三个阶段各演一遍:数语料学会续写(预训练)、喂对话样本学会一问一答(指令微调)、按人的偏好挪概率(RLHF),再看 DeepSeek 绕开对话格式直接续写时,它为什么会接着出题而不是回答。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'training', 'python', 'agent-zero']
series: 'agent-zero'
day: 113
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 112](/blog/agent-zero/day-112-sampling-2/) 讲完了采样的后半段:top_p 按累计概率砍掉长尾,`random.seed` 让本地采样可以复现,而 API 上即使 temperature=0、传了 seed,同一个问题问 5 次也出了 5 种回答,原因在服务端的批处理和浮点计算顺序。

从 [Day 106](/blog/agent-zero/day-106-next-token/) 到 Day 112,我们一直在讲模型「用起来」的时候发生了什么:文字切成 token,装进窗口,模型吐出一张概率表,采样挑一个接回去。有一个问题一直没碰:**那张概率表凭什么给「简」0.321、给「轻」0.313?** 模型又是怎么从「只会猜下一个 token」变成「能回答问题的助手」的?答案在训练里。今天不讲数学,只讲三个阶段各自干了什么,每个阶段配一个能跑的小玩具。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用一句话分别说出预训练、指令微调(SFT)、RLHF 三个阶段喂给模型的是什么数据、让模型学会了什么。
2. 跑通三个玩具脚本:用数数的办法「训练」一个只看前一个词的小模型,给它加对话样本让它学会「客服:」后面该接回答,再按标注员的偏好把它的概率挪向「不确定」。
3. 看懂一个 API 实验:把同一个问题直接丢给 DeepSeek 的「续写」接口和「对话」接口,结果差在哪,为什么对话接口背后其实也是续写。
4. 能说出这三个阶段和 Agent 工程师有什么关系:为什么模型会编、为什么它爱讨好、为什么换个格式它就不按套路出牌。

预计用时:2 小时左右。前置:[Day 106](/blog/agent-zero/day-106-next-token/) 的自回归生成、[Day 107](/blog/agent-zero/day-107-tokens-1/) 的 `Counter` 和「分词器是单独训好的」、[Day 108](/blog/agent-zero/day-108-tokens-2/) 的「每次请求多出 4 个 token」、[Day 110](/blog/agent-zero/day-110-sampling-1/) 的概率表和 `math.exp`、[Day 112](/blog/agent-zero/day-112-sampling-2/) 练习 3 的 `random.Random(种子)`。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `train` 和 `next_dist` 两个函数默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 先看全貌:三个阶段,三种数据

先把结论摆出来,后面每一节都是在给这张图配实验。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="大模型训练的三个阶段:预训练、指令微调、RLHF,每个阶段的数据和学到的东西">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="30" width="180" height="110" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="110" y="52" text-anchor="middle" fill="var(--ink)">① 预训练</text>
<text x="110" y="76" text-anchor="middle" fill="var(--ink-soft)">数据:海量网页、书、代码</text>
<text x="110" y="96" text-anchor="middle" fill="var(--ink-soft)">几万亿个 token</text>
<text x="110" y="120" text-anchor="middle" fill="var(--ink-faint)">花掉绝大部分算力</text>
<rect x="230" y="30" width="180" height="110" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="320" y="52" text-anchor="middle" fill="var(--ink)">② 指令微调 SFT</text>
<text x="320" y="76" text-anchor="middle" fill="var(--ink-soft)">数据:「指令→好回答」</text>
<text x="320" y="96" text-anchor="middle" fill="var(--ink-soft)">几万到几百万条对话</text>
<text x="320" y="120" text-anchor="middle" fill="var(--ink-faint)">人写或模型写、人审</text>
<rect x="440" y="30" width="180" height="110" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
<text x="530" y="52" text-anchor="middle" fill="var(--ink)">③ RLHF</text>
<text x="530" y="76" text-anchor="middle" fill="var(--ink-soft)">数据:「A 比 B 好」</text>
<text x="530" y="96" text-anchor="middle" fill="var(--ink-soft)">人对回答两两比较</text>
<text x="530" y="120" text-anchor="middle" fill="var(--ink-faint)">按偏好挪概率</text>
<line x1="200" y1="85" x2="230" y2="85" stroke="var(--ink-soft)"/>
<line x1="410" y1="85" x2="440" y2="85" stroke="var(--ink-soft)"/>
<rect x="20" y="170" width="180" height="50" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="110" y="192" text-anchor="middle" fill="var(--ink)">文本续写器</text>
<text x="110" y="210" text-anchor="middle" fill="var(--ink-soft)">问一句,它接着出题</text>
<rect x="230" y="170" width="180" height="50" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="320" y="192" text-anchor="middle" fill="var(--ink)">会一问一答</text>
<text x="320" y="210" text-anchor="middle" fill="var(--ink-soft)">认得「用户/助手」格式</text>
<rect x="440" y="170" width="180" height="50" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
<text x="530" y="192" text-anchor="middle" fill="var(--ink)">更像人喜欢的助手</text>
<text x="530" y="210" text-anchor="middle" fill="var(--ink-soft)">拒绝有害、敢说不知道</text>
<line x1="110" y1="140" x2="110" y2="170" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<line x1="320" y1="140" x2="320" y2="170" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<line x1="530" y1="140" x2="530" y2="170" stroke="var(--ink-faint)" stroke-dasharray="3 3"/>
<text x="20" y="248" fill="var(--ink-faint)">琥珀 = 喂进去的数据;蓝 = 训练完模型的样子。②③合起来常叫「后训练」或「对齐」。</text>
</g>
</svg>
<figcaption>三个阶段的模型结构完全一样,变的只是喂给它的数据和「什么算对」的标准。每一步都在上一步的结果上接着训。</figcaption>
</figure>

一句话版:

- **预训练(pretraining)**:拿几万亿个 token 的网页、书、代码,反复做「遮住下一个 token,让模型猜」这个练习,猜错了就调参数。练完得到的是一个**文本续写器**,它特别会接话,但不知道什么叫「回答问题」。
- **指令微调(SFT,supervised fine-tuning,监督微调)**:拿几万到几百万条「指令 → 好回答」的对话样本,用同样的「猜下一个 token」练习接着训。练完它就认得「用户说完了,轮到我说」这个格式了。
- **RLHF(reinforcement learning from human feedback,基于人类反馈的强化学习)**:让模型对同一个问题写几个回答,请人比较哪个更好,再按这些偏好把模型往「人更喜欢的那种回答」上推。拒绝有害请求、承认不知道、语气礼貌,主要是这一步加强的。

这里的「训练」,意思是**调整模型里那几千亿个数字(参数),让它在练习题上猜得更准**。你可以先把参数想成一个巨大的、能被慢慢改写的概率表生成器。下面我们用一个真的就是「概率表」的玩具来演,这样每一步你都能亲眼看到表里的数字怎么变。

## 预训练:从数数开始

### 最笨的语言模型

Day 110 那张概率表是 DeepSeek 算出来的,我们看不到它怎么算的。那就自己造一个最笨的:**只看前一个词,统计语料里它后面跟过什么,跟过几次**。比如语料里「每月」后面出现过「99」「39」「299」各一次,那这个模型就认为「每月」后面接这三个数的概率各 1/3。

这种只看前一个词的模型有个名字叫 **bigram 模型**(二元模型,bi 是「二」,两个词一组)。它是几十年前的老技术,能力和 DeepSeek 差了十万八千里,但它和大模型有一个关键的共同点:**学会的东西全部来自语料,训练就是从语料里提取「什么后面接什么」**。差别在于大模型看的是前面一大段,而不是只看一个词(怎么做到的,[Day 116](/blog/agent-zero/day-116-attention/) 讲注意力时说)。

为了不被分词分心,我们的玩具语料直接用空格把词隔开,一个词就是一个 token。真实模型的 token 是 Day 107 那种 BPE 切出来的块,道理一样。

新建 `part02/toy_lm.py`(在 `agent-zero-lab` 目录下,和 Day 110、112 的脚本放一起):

```python
# agent-zero-lab/part02/toy_lm.py
import random
from collections import Counter, defaultdict

PRETRAIN = [
    "云簿 专业版 每月 99 元 。",
    "云簿 基础版 每月 39 元 。",
    "云簿 企业版 每月 299 元 。",
    "年付 用户 可以 申请 退款 。",
    "月付 用户 不能 申请 退款 。",
    "怎么 开 发票 ? 怎么 退款 ? 怎么 升级 ?",
]


def train(corpus: list[str]) -> dict[str, Counter[str]]:
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    for line in corpus:
        toks = line.split()
        for prev, nxt in zip(toks, toks[1:]):
            counts[prev][nxt] += 1
    return counts


def next_dist(counts: dict[str, Counter[str]], tok: str) -> dict[str, float]:
    c = counts[tok]
    total = sum(c.values())
    return {t: n / total for t, n in c.most_common()}


def generate(counts: dict[str, Counter[str]], prompt: str, rng: random.Random, max_new: int = 12) -> str:
    toks = prompt.split()
    for _ in range(max_new):
        dist = next_dist(counts, toks[-1])
        if not dist:
            break
        toks.append(rng.choices(list(dist.keys()), weights=list(dist.values()))[0])
        if toks[-1] == "。":
            break
    return " ".join(toks)


if __name__ == "__main__":
    model = train(PRETRAIN)
    for tok in ("每月", "用户", "?"):
        print(f"{tok!r} 后面:", {t: round(p, 3) for t, p in next_dist(model, tok).items()})
    rng = random.Random(42)
    print(generate(model, "怎么 开 发票 ?", rng))
    print(generate(model, "云簿 专业版", rng))
```

<div class="line-notes">

- `from collections import Counter, defaultdict` `Counter` 是 [Day 107](/blog/agent-zero/day-107-tokens-1/) 用过的计数器。`defaultdict` 是今天新见的:一个「取不存在的键时自动补一个默认值」的字典。`defaultdict(Counter)` 表示取一个没见过的键时,自动给它配一个空的 `Counter`。JS 里要自己写 `counts[prev] ??= {}`,Python 用它省掉这一步。
- `PRETRAIN = [` 我们的「互联网」,6 行。真实预训练语料是几万亿个 token,这里每行十来个。云簿是这门课一直在用的虚构记账 SaaS 公司。
- `"怎么 开 发票 ? 怎么 退款 ? 怎么 升级 ?",` 故意放一行「问题列表」。网上很多文本就是 FAQ、问题清单,后面会看到它的影响。
- `def train(corpus: list[str]) -> dict[str, Counter[str]]:` 训练函数:输入语料,输出「每个词后面跟过谁、几次」。返回类型读作「键是字符串,值是计数器」。
- `counts: dict[str, Counter[str]] = defaultdict(Counter)` 空的计数表。类型标注写成普通 `dict`,实际放的是 `defaultdict`,它是 `dict` 的子类,所以可以这样标。
- `toks = line.split()` 不传参数的 `split()` 按空白切开,相当于 JS 的 `line.trim().split(/\s+/)`。第一行切出 `['云簿', '专业版', '每月', '99', '元', '。']`。
- `for prev, nxt in zip(toks, toks[1:]):` `toks[1:]` 是去掉第一个元素的新列表;`zip` 把两个列表按位置配对,每次取出一对。第一行配出 `('云簿','专业版')`、`('专业版','每月')`、`('每月','99')`……也就是所有「相邻的两个词」。JS 里相当于 `toks.slice(0, -1).map((p, i) => [p, toks[i + 1]])`。
- `counts[prev][nxt] += 1` 「`prev` 后面出现过一次 `nxt`」,记一笔。`counts[prev]` 第一次访问时 `defaultdict` 自动建空计数器,`Counter` 里不存在的键默认是 0,所以直接 `+= 1` 不会报错。**这一行就是我们的全部「训练」**。
- `def next_dist(counts: dict[str, Counter[str]], tok: str) -> dict[str, float]:` 给一个词,返回「下一个词的概率表」,和 Day 110 的 `next_token_dist.json` 是同一种东西。
- `c = counts[tok]` 取出这个词后面的计数。词没见过时,`defaultdict` 给一个空计数器。
- `total = sum(c.values())` 后面一共跟过几次。「每月」是 3。
- `return {t: n / total for t, n in c.most_common()}` 次数除以总数就是概率。`most_common()` 按次数从多到少排,这样概率表也是从高到低。「每月」得到 `{'99': 0.333, '39': 0.333, '299': 0.333}`。
- `def generate(counts: dict[str, Counter[str]], prompt: str, rng: random.Random, max_new: int = 12) -> str:` 生成函数:从提示词开始,一个词一个词往后接,最多接 12 个。`rng` 是 Day 112 练习 3 里那种独立的随机数生成器,传进来方便复现。
- `toks = prompt.split()` 提示词也切成词。
- `dist = next_dist(counts, toks[-1])` `toks[-1]` 是列表最后一个元素(JS 的 `toks.at(-1)`)。只看最后一个词,这就是 bigram 的「只看前一个」。
- `if not dist:` 最后一个词在语料里从没出现在别的词前面过,概率表是空的,模型无话可说,只能停。
- `toks.append(rng.choices(list(dist.keys()), weights=list(dist.values()))[0])` 按概率掷骰子挑下一个词,和 Day 110 的 `sample` 是同一行写法,接到末尾。**这就是 Day 106 说的自回归**:挑出来的词接回去,下一轮再看它。
- `if toks[-1] == "。":` 生成了句号就停。真模型也有一个专门的「结束」token,生成了它就停。
- `return " ".join(toks)` 用空格把词拼回字符串,相当于 JS 的 `toks.join(" ")`。
- `for tok in ("每月", "用户", "?"):` 看三个词后面的概率表。
- `rng = random.Random(42)` 种子 42,你跑出来应该和我一字不差。
- `print(generate(model, "怎么 开 发票 ?", rng))` 给一个问题,看它怎么「接」。
- `print(generate(model, "云簿 专业版", rng))` 给一个陈述句的开头,看它怎么接。这一行明天 Day 114 还要用。

</div>

```bash
uv run part02/toy_lm.py
```

实跑输出:

```text
'每月' 后面: {'99': 0.333, '39': 0.333, '299': 0.333}
'用户' 后面: {'可以': 0.5, '不能': 0.5}
'?' 后面: {'怎么': 1.0}
怎么 开 发票 ? 怎么 开 发票 ? 怎么 升级 ? 怎么 退款 。
云簿 专业版 每月 39 元 。
```

先看前三行。`train` 什么聪明事都没干,就是数数,可数完之后它确实「知道」了一些东西:「每月」后面是价格,「用户」后面是「可以」或「不能」,「?」后面一定跟「怎么」。这些知识没有任何人教,全是从语料里数出来的。**预训练的本质就是这个**:模型从海量文本里学到「什么样的上下文后面接什么」。大模型的「知识」(巴黎是法国首都、Python 的 `split` 怎么用)也是这样来的,只不过它不是存在一张能直接读的计数表里,而是压缩进了几千亿个参数。

再看第四行,这是今天最重要的现象。我们给的是一个问题「怎么 开 发票 ?」,它没有回答,而是**接着出题**:又问了一遍「怎么 开 发票 ?」,然后「怎么 升级 ?」「怎么 退款」。原因很直接:在它见过的语料里,「?」后面永远跟着下一个问题。它学的是「接着写」,不是「回答」。

真实的预训练模型也是这样。你给一个只做过预训练的模型(行话叫 **base 模型**,基座模型)输入「怎么给订阅开发票?」,它很可能接一串类似的问题,因为网上的 FAQ 页面、论坛标题列表里,问题后面常常就是下一个问题。下面马上用 DeepSeek 验证。

最后一行「云簿 专业版 每月 39 元」先留着,注意语料里专业版明明是 99 元。明天 Day 114 讲幻觉,就从这一行开始。

### 真实的预训练有多大

我们的语料 6 行、几十个词。真实的数字是什么量级?2024 年 12 月发布的 [DeepSeek-V3 技术报告](https://arxiv.org/abs/2412.19437)摘要里写的是:在 14.8 万亿(14.8 trillion)个 token 上预训练,完整训练用了 278.8 万个 H800 GPU 小时。这是报告里的数字,我没法自己验证。14.8 万亿是什么概念,练习 4 会算一笔账:一个人每天读 8 小时,要读 27 万年。

训练过程本身也不是「数数」。大模型的做法是:从语料里截一段,让模型对每个位置猜下一个 token,把它给正确答案的概率和 1 之间的差距算成一个「损失」,再顺着能让损失变小的方向把所有参数都挪一点点。重复几千亿次。这个「顺着方向挪一点点」的方法叫梯度下降,这门课用不到它的细节,知道名字就够了。我们的 `counts[prev][nxt] += 1` 在效果上和它很像:语料里出现得多的搭配,概率就被推高。

还有一个容易混的点:Day 107 训练的 BPE 分词器和这里的预训练不是一回事。分词器是**模型训练之前**单独训好、之后定死的;预训练训的是模型本身。

## DeepSeek 绕开对话格式会怎样

我们的玩具会「接着出题」,那 DeepSeek 呢?平时我们调的是**对话接口**(`/chat/completions`,传 `messages` 列表)。DeepSeek 还有一个 Beta 的**续写接口**(`/completions`,官方文档叫 [FIM 补全](https://api-docs.deepseek.com/zh-cn/guides/fim_completion),要把 `base_url` 设成 `https://api.deepseek.com/beta`):你给一段文字 `prompt`,它直接往后接,没有「用户」「助手」这些角色。

先说清楚这个实验的边界:DeepSeek 没有开放 base 模型,续写接口背后仍然是做过微调的 `deepseek-flash`,只是绕开了对话格式。所以它不是真正的 base 模型,但能让我们看到「不告诉它这是对话时,它会怎么接」。

这段要调 API,而这门课 [Day 120](/blog/agent-zero/day-120-api-register/) 才注册拿 key,**这段你现在不用跑,看我的结果**。

```python
# agent-zero-lab/part02/base_vs_chat.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
raw = OpenAI(base_url="https://api.deepseek.com/beta", api_key=os.environ["LLM_API_KEY"])
chat = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

PROMPTS = [
    "怎么给云簿的订阅开发票?\n",
    "记账软件常见问题汇总\n1. 怎么开发票?\n2.",
    "用户:怎么给云簿的订阅开发票?\n客服:",
]
for p in PROMPTS:
    resp = raw.completions.create(model="deepseek-flash", prompt=p, max_tokens=60, temperature=0)
    print("续写", repr(p), "->", repr(resp.choices[0].text))

reply = chat.chat.completions.create(
    model="deepseek-flash",
    messages=[{"role": "user", "content": "怎么给云簿的订阅开发票?"}],
    max_tokens=60,
    temperature=0,
    extra_body={"thinking": {"type": "disabled"}},
)
print("对话 ->", repr(reply.choices[0].message.content))
```

<div class="line-notes">

- `from dotenv import load_dotenv` 从 `.env` 读出 key,Day 110 起一直这么用,Day 120 细讲。
- `raw = OpenAI(base_url="https://api.deepseek.com/beta"` 续写接口要用 beta 地址,所以单独建一个客户端。
- `chat = OpenAI(base_url=os.environ["LLM_BASE_URL"]` 平时那个对话客户端,地址是 `https://api.deepseek.com`。
- `"怎么给云簿的订阅开发票?\n",` 第一个:光秃秃一个问题加换行,和玩具里的「怎么 开 发票 ?」一个意思。
- `"记账软件常见问题汇总\n1. 怎么开发票?\n2.",` 第二个:摆出「问题清单」的架势,停在「2.」后面。
- `"用户:怎么给云簿的订阅开发票?\n客服:",` 第三个:同一个问题,只是写成「用户:……客服:」的对话剧本,停在「客服:」后面。
- `resp = raw.completions.create(model="deepseek-flash", prompt=p, max_tokens=60, temperature=0)` 续写接口传的是 `prompt` 字符串,不是 `messages` 列表。`temperature=0` 让结果尽量稳定(Day 112 说过,也不保证完全一样)。
- `print("续写", repr(p), "->", repr(resp.choices[0].text))` 续写接口的结果在 `choices[0].text`,对话接口在 `choices[0].message.content`,位置不一样。用 `repr` 打印,换行会显示成 `\n`,看得清。
- `messages=[{"role": "user", "content": "怎么给云簿的订阅开发票?"}],` 对照组:同一个问题,走正常的对话接口。
- `extra_body={"thinking": {"type": "disabled"}},` 关思考模式,不然 temperature 不生效(Day 110)。思考模式是什么,[Day 115](/blog/agent-zero/day-115-reasoning-models/) 讲。

</div>

我的实跑输出(为了好读,我在每个箭头后面换了行):

```text
续写 '怎么给云簿的订阅开发票?\n' ->
'怎么给云簿的订阅开发票?\n云簿的订阅发票是电子发票，在付款成功后，会自动发送到您的邮箱。如果您需要修改发票信息，可以登录云簿官网，在“我的订单”页面找到对应的订单，点击“申请发票”按钮，填写正确的发票'
续写 '记账软件常见问题汇总\n1. 怎么开发票?\n2.' ->
' 怎么退款?\n3. 怎么取消自动续费?\n4. 怎么切换账本?\n5. 怎么删除账本?\n6. 怎么删除账户?\n7. 怎么删除分类?\n8. 怎么修改分类?\n9. 怎么修改账户?\n10. '
续写 '用户:怎么给云簿的订阅开发票?\n客服:' ->
'您好，云簿订阅发票开具方式如下：\n1. 登录云簿官网，进入「控制台-费用中心-发票管理」；\n2. 选择需要开票的订单，点击「申请开票」；\n3. 填写发票信息（个人/企业抬头、税'
对话 ->
'关于“云簿”订阅开发票的问题，由于“云簿”可能指代不同的产品（如某些财务软件、云记账平台等），具体操作会有差异。以下是通用的开票流程和建议，供你参考：\n\n### 1. 确认开票入口\n通常可以在以下'
```

四条结果,四种性格。

第二条最像我们的玩具:摆出问题清单,它就一口气写到第 10 题,一个都不回答。它没有理解错,它在做预训练教它的事,**把这段文字最可能的样子接下去**。一份「常见问题汇总」最可能的下文,就是更多问题。

第一条很有意思:它先把问题原样又写了一遍,然后才开始写一段像 FAQ 页面的回答。我在写这篇之前用同一个脚本还跑过一次,那次它把「云簿的订阅发票怎么开?」这一行重复了 9 遍,直到 `max_tokens` 用完,一句回答都没有。同样是 temperature=0,两次表现差这么多,就是 Day 112 讲的「不可复现」。重复同一句话这种毛病,Day 112 提过的那篇核采样论文专门研究过,叫文本退化(degeneration)。

第三条只是把同一个问题包进「用户:……客服:」的剧本里,它立刻进入角色,写了一份有模有样的开票步骤。注意它写的内容:「控制台-费用中心-发票管理」「申请开票」,这些全是编的,云簿是我们虚构的公司,哪来的控制台。这是明天的主题。

第四条走对话接口,风格完全不同:先说「云簿可能指代不同的产品」,承认自己不确定,再给通用建议。这种谨慎不是预训练能教出来的,它来自后面两个阶段。

### 对话接口背后也是续写

第三条和第四条放在一起看,能得出一个很重要的结论:**对话接口并不神秘,它就是把你的 `messages` 拼成一段带角色标记的文字,再交给模型续写**。

[Day 108](/blog/agent-zero/day-108-tokens-2/) 我们发现,每次请求的 `prompt_tokens` 都比本地数的多 4 个,当时说那是「角色标记和分隔符」。现在可以说得更具体:DeepSeek 公开的分词器配置文件里有一个叫 `chat_template` 的模板([Day 107](/blog/agent-zero/day-107-tokens-1/) 下载的 `data/deepseek_v4_tokenizer/tokenizer_config.json` 里就有,用编辑器打开搜这个字段名就能看到),它把一条用户消息拼成大致这样的样子:`<｜begin▁of▁sentence｜><｜User｜>怎么给云簿的订阅开发票?<｜Assistant｜>`。这些带竖线的是专用的特殊 token,普通文字里不会出现。模型拿到这串,续写的就是 `<｜Assistant｜>` 后面的内容。

那模型为什么知道 `<｜Assistant｜>` 后面该写回答、写完该停?预训练语料里可没有这些特殊 token。答案是第二阶段:指令微调。

## 指令微调:教它认识「轮到我说话了」

### 微调用的数据长什么样

SFT 的做法出奇地简单:**训练方法和预训练完全一样**,还是「猜下一个 token」,只是换了数据。数据是一条条写好的对话,比如:

```text
<｜User｜>怎么开发票?<｜Assistant｜>在账单页面点「开发票」……<｜end▁of▁sentence｜>
```

这样的样本看上几万、几十万条,模型就学到了三件事:`<｜Assistant｜>` 后面接的是**回答**,不是下一个问题;回答完要输出结束标记;回答应该是什么语气、多长、什么格式。这些样本从哪来?最早是公司雇标注员一条条写,2022 年 OpenAI 那篇 InstructGPT 论文就是这么做的;现在很多是用更强的模型生成、人再抽查。

在我们的玩具上演一遍。新建 `part02/sft_toy.py`:

```python
# agent-zero-lab/part02/sft_toy.py
import random

from toy_lm import PRETRAIN, generate, next_dist, train

SFT = [
    "用户: 怎么 开 发票 ? 客服: 在 账单 页面 点 开 发票 。",
    "用户: 怎么 退款 ? 客服: 年付 用户 可以 在 账单 页面 申请 退款 。",
    "用户: 怎么 升级 ? 客服: 在 套餐 页面 点 升级 。",
]

base = train(PRETRAIN)
chat = train(PRETRAIN + SFT * 3)

if __name__ == "__main__":
    print("预训练版 '?' 后面:", {t: round(p, 3) for t, p in next_dist(base, "?").items()})
    print("微调版   '?' 后面:", {t: round(p, 3) for t, p in next_dist(chat, "?").items()})

    prompt = "用户: 怎么 开 发票 ? 客服:"
    print("预训练版:", generate(base, prompt, random.Random(1)))
    for seed in (1, 2, 3, 4):
        print(f"微调版 seed={seed}:", generate(chat, prompt, random.Random(seed)))
```

<div class="line-notes">

- `from toy_lm import PRETRAIN, generate, next_dist, train` 复用上一个脚本。`toy_lm.py` 的演示代码在 `if __name__ == "__main__":` 下面,导入时不会执行([Day 32](/blog/agent-zero/day-032-modules/) 讲过)。
- `SFT = [` 三条「指令 → 好回答」的对话。「用户:」「客服:」就是我们的角色标记,相当于真模型里的 `<｜User｜>` 和 `<｜Assistant｜>`。
- `base = train(PRETRAIN)` 只做过预训练的版本。
- `chat = train(PRETRAIN + SFT * 3)` 在预训练语料的基础上加入对话样本。`SFT * 3` 把列表重复 3 遍(Python 里列表乘整数就是重复,JS 没有这个写法,要 `Array(3).fill(SFT).flat()`)。这相当于微调时把同一批样本过 3 遍,行话叫训练 3 个 epoch(轮)。真实的微调也是在预训练好的模型上接着训,不是从零开始;我们的玩具没有「接着训」这个概念,只好把两份语料合起来重新数一遍,效果一样。
- `print("预训练版 '?' 后面:"` 对比两个版本「?」后面的概率表。
- `prompt = "用户: 怎么 开 发票 ? 客服:"` 用对话格式提问,停在「客服:」后面,等它接。
- `print("预训练版:", generate(base, prompt, random.Random(1)))` 预训练版从没见过「客服:」这个词,`next_dist` 返回空表,`generate` 里的 `if not dist: break` 让它直接停下。
- `for seed in (1, 2, 3, 4):` 微调版用 4 个种子各生成一次,看看它接的是什么。

</div>

```bash
uv run part02/sft_toy.py
```

实跑输出:

```text
预训练版 '?' 后面: {'怎么': 1.0}
微调版   '?' 后面: {'客服:': 0.818, '怎么': 0.182}
预训练版: 用户: 怎么 开 发票 ? 客服:
微调版 seed=1: 用户: 怎么 开 发票 ? 客服: 在 套餐 页面 点 开 发票 。
微调版 seed=2: 用户: 怎么 开 发票 ? 客服: 年付 用户 可以 在 套餐 页面 申请 退款 ? 客服: 在 账单
微调版 seed=3: 用户: 怎么 开 发票 ? 客服: 在 账单 页面 点 升级 ? 客服: 年付 用户 可以 申请 退款
微调版 seed=4: 用户: 怎么 开 发票 ? 客服: 在 账单 页面 点 开 发票 。
```

第一、二行是 SFT 最核心的效果:「?」后面接什么,从 100% 是「怎么」(接着出题)变成了 81.8% 是「客服:」(轮到回答)。**微调没有教它新知识,它改的是「在什么场合说什么话」的习惯**。

第三行,预训练版遇到「客服:」直接哑火,因为它的世界里没有这个词。真实的 base 模型遇到 `<｜Assistant｜>` 不至于完全哑火,但也不知道这个标记意味着「该你回答了」。

后四行是微调版的回答。好消息是格式全对了:四次都在「客服:」后面接了「在……页面」或「年付用户可以……」这种回答的腔调。坏消息是内容乱七八糟:seed=1 说「在套餐页面点开发票」,把开发票的地方说错了;seed=3 答非所问,讲起了升级。为什么?因为我们的玩具**只看最后一个词**。它看到「客服:」时,已经完全忘了前面问的是发票还是退款,只能按「客服: 后面通常是什么」来接。seed=4 碰巧答对,纯属运气。

真模型不会这么离谱,因为它每一步看的是前面整段文字,能把「发票」和「账单页面」联系起来。可「格式学得会、内容可能错」这个现象在真模型上一样存在,只是没这么明显。上面 DeepSeek 第三条续写就是例子:格式是标准客服腔,内容全是编的。

还有一点值得说。seed=2、3 的回答没有在句号处停下,接着又冒出了「? 客服:」,像是自己跟自己对话。真模型也犯过这种毛病:如果微调数据里没教好「回答完要输出结束标记」,它会自己续写一个「用户:」再替用户问下一个问题。现在的模型基本不会了,但你以后自己微调模型时(第十部分讲),这是第一批会遇到的问题之一。

## RLHF:按人的喜好挪概率

### 为什么微调完还不够

SFT 之后的模型会回答了,但「会回答」和「回答得好」还有距离。同一个问题,它可能有好几种答法:一种很自信但是编的,一种老实说不知道,一种拒绝回答。SFT 数据里每个问题只有一个标准答案,模型学到的是模仿,没学到「这几种答法哪个更好」。

而且很多时候,写出一个完美答案很难,判断两个答案哪个好却很容易。让标注员写一篇完美的拒绝话术要半小时,让他在两个回答里挑一个只要几秒。RLHF 就是利用这一点:**不让人写答案,只让人比较**。

流程大致三步(2022 年的 [InstructGPT 论文](https://arxiv.org/abs/2203.02155)把它讲清楚了):

1. 同一个问题,让模型写几个不同的回答。
2. 标注员两两比较,标出哪个更好。
3. 用这些比较结果训练一个「打分模型」(reward model,奖励模型),它学会给回答打分;再用强化学习让原模型多写高分回答、少写低分回答。

这篇论文摘要里有一个很有名的数字:经过这套流程的 13 亿参数模型,标注员更喜欢它的回答,胜过没经过这套流程的 1750 亿参数的 GPT-3。参数少了一百多倍,却更受欢迎。这说明「好不好用」很大程度上不取决于模型多大,而取决于后训练。

**强化学习(reinforcement learning)** 这个词第一次出现,用大白话说就是:不告诉模型标准答案,只告诉它「这次做得好不好」(给一个分数,叫奖励),让它自己往得分高的方向调整。训狗就是这个思路,做对了给零食。

### 玩具版:一行公式挪概率

真实的强化学习训练很复杂,但它最后想达到的那个结果,可以用一行公式写出来。2023 年的 [DPO 论文](https://arxiv.org/abs/2305.18290)推导过:在「多拿奖励,但别离原来的模型太远」这个目标下,最优的新概率是

**新概率 ∝ 旧概率 × e^(奖励 ÷ β)**

∝ 读作「正比于」,意思是算完还要重新归一,让加起来等于 1(Day 110 的温度公式也是这么处理的)。β(读 beta)控制「别离原来太远」的力度:β 大,挪得少;β 小,挪得猛。

场景:用户问「云簿 支持 微信 支付 吗?」,资料里根本没写。微调完的模型第一步可能想回「支持」「不支持」或「不确定」。三位标注员对这三种回答两两比较。新建 `part02/rlhf_toy.py`:

```python
# agent-zero-lab/part02/rlhf_toy.py
import math
from collections import Counter

# 用户问「云簿 支持 微信 支付 吗?」,资料里没写。微调完的模型第一步大概这样分配概率(手写的假设值):
POLICY = {"支持": 0.55, "不支持": 0.25, "不确定": 0.20}

# 三位标注员两两比较,每条是 (更好的, 更差的)
PREFS = [
    ("不确定", "支持"), ("不确定", "不支持"), ("不支持", "支持"),
    ("不确定", "支持"), ("不确定", "不支持"), ("支持", "不支持"),
    ("不确定", "支持"), ("不确定", "不支持"), ("不支持", "支持"),
]


def reward_from_prefs(prefs: list[tuple[str, str]]) -> dict[str, int]:
    score: Counter[str] = Counter()
    for win, lose in prefs:
        score[win] += 1
        score[lose] -= 1
    return dict(score)


def update(policy: dict[str, float], reward: dict[str, int], beta: float) -> dict[str, float]:
    raw = {a: p * math.exp(reward.get(a, 0) / beta) for a, p in policy.items()}
    total = sum(raw.values())
    return {a: round(v / total, 3) for a, v in raw.items()}


if __name__ == "__main__":
    reward = reward_from_prefs(PREFS)
    print("奖励:", reward)
    for beta in (8.0, 4.0, 2.0):
        print(f"beta={beta}:", update(POLICY, reward, beta))
```

<div class="line-notes">

- `POLICY = {"支持": 0.55, "不支持": 0.25, "不确定": 0.20}` 模型当前的概率表。强化学习里管模型的行为叫 policy(策略)。数字是我手写的假设:模型倾向于自信地说「支持」,因为网上「X 支持微信支付吗?支持」这种问答最多。
- `PREFS = [` 9 次比较,每位标注员 3 次。每个元组 `(更好的, 更差的)`。第一位标注员认为「不确定」比「支持」好、「不确定」比「不支持」好、「不支持」比「支持」好。
- `("不确定", "支持"), ("不确定", "不支持"), ("支持", "不支持"),` 第二位标注员第三次比较和别人不一样,他觉得「支持」比「不支持」好。真实标注里意见不一致很常见。
- `def reward_from_prefs(prefs: list[tuple[str, str]]) -> dict[str, int]:` 从比较结果算出每种回答的分数。`tuple[str, str]` 是「两个字符串组成的元组」。
- `score: Counter[str] = Counter()` 空计数器,当记分板用。
- `for win, lose in prefs:` 每次比较拆成赢家和输家。
- `score[win] += 1` 赢一次加一分。
- `score[lose] -= 1` 输一次扣一分。`Counter` 允许负数。这是最简单的打分法;真实做法是训练一个奖励模型,能给没比较过的新回答也打分。
- `return dict(score)` 转回普通字典。实跑 `{'不确定': 6, '支持': -4, '不支持': -2}`:「不确定」6 战全胜得 6 分;「支持」输 5 次赢 1 次得 -4。
- `def update(policy: dict[str, float], reward: dict[str, int], beta: float) -> dict[str, float]:` 按公式算新概率。
- `raw = {a: p * math.exp(reward.get(a, 0) / beta) for a, p in policy.items()}` 公式那一行:旧概率乘以 e 的(奖励 ÷ β)次方。`reward.get(a, 0)` 取不到时当 0 分。β=4 时,「不确定」:0.20 × e^(6÷4) = 0.20 × 4.48 = 0.896;「支持」:0.55 × e^(-4÷4) = 0.55 × 0.368 = 0.202。
- `total = sum(raw.values())` 三个加起来,β=4 时约 1.25。
- `return {a: round(v / total, 3) for a, v in raw.items()}` 归一,保留 3 位。「不确定」:0.896 ÷ 1.25 ≈ 0.717。
- `for beta in (8.0, 4.0, 2.0):` 三种力度,从温和到猛烈。

</div>

```bash
uv run part02/rlhf_toy.py
```

实跑输出:

```text
奖励: {'不确定': 6, '支持': -4, '不支持': -2}
beta=8.0: {'支持': 0.351, '不支持': 0.205, '不确定': 0.445}
beta=4.0: {'支持': 0.162, '不支持': 0.121, '不确定': 0.717}
beta=2.0: {'支持': 0.018, '不支持': 0.022, '不确定': 0.96}
```

「不确定」从 20% 涨到了 44.5%、71.7%、96%,看 β 给多大的力度。这就是 RLHF 让模型学会「承认不知道」的方式:没人教它什么时候该不确定,它只是发现说「不确定」时人给的分高。上面 DeepSeek 对话接口那句「云簿可能指代不同的产品」,背后就是这类训练。

β=2 时「支持」只剩 1.8%,看起来很好,但这里有个陷阱。β 太小,模型会把概率全部压到得分最高的那一种回答上,丢掉原来学到的其他东西。真实训练里还会出现更糟的情况:模型找到打分模型的漏洞,比如发现「回答越长分越高」,就开始写又长又空的回答。这叫**奖励投机(reward hacking)**。β 的作用就是拴住它,不让它为了分数跑得离原来的模型太远。

### RLHF 会带来什么副作用

标注员是人,人有偏好。研究者发现,经过 RLHF 的模型有一个普遍的毛病,叫**讨好(sycophancy)**:人更喜欢被认同,所以模型学会了顺着用户说。你说「我觉得这个退款金额算错了」,它很可能先认错再改,哪怕原来是对的。练习 3 会在玩具上演示:如果标注员偏爱自信的回答,模型就会变得更爱编。

对 Agent 工程师来说,这件事的意义是:**模型的很多「性格」不是 bug,而是训练目标的直接结果**。它爱用列表、爱加免责声明、被质疑就道歉,都是因为这样的回答在训练时得分高。知道了来源,写提示词和设计流程时就知道该防什么。

最后补一句名字的事。RLHF 是 2022 年那一代的主流叫法,现在各家用的方法已经五花八门:有直接用比较数据训练、不单独训打分模型的 DPO;有用另一个模型代替人来打分的(RLAIF,AI 反馈);还有专门用「能被程序判对错」的题目做奖励的,推理模型就是这么训出来的,Day 115 讲。面试时说「后训练阶段用 SFT 加偏好优化」比只说 RLHF 更准确。

## 三个阶段和 Agent 有什么关系

讲到这里你可能会想:我又不训模型,知道这些干嘛?我觉得至少有四个地方直接用得上,后面的课会一再碰到:

**模型的知识有截止日期,而且不知道你公司的事。** 知识全来自预训练语料,语料收集到哪天,它就知道到哪天;云簿的退款政策它从来没见过。所以事实性的东西要靠工具和检索送到它眼前(第三、四部分)。

**它学的是「像」,不是「对」。** 预训练奖励的是「接得像语料」,SFT 奖励的是「像标准答案」,RLHF 奖励的是「人看了喜欢」,没有一个阶段直接奖励「说的是真话」。明天的幻觉就从这里来。

**格式非常重要。** 模型在 SFT 里见过什么格式,就最擅长什么格式。工具调用、JSON 输出,能稳定用起来都是因为厂商专门用这类数据微调过。你给的提示词格式越接近它训练时见过的,效果越稳。

**改模型行为有两条路。** 改提示词(便宜、马上生效)和自己微调(贵、要数据、要评测)。绝大多数 Agent 问题靠第一条就够了,第十部分才会讲什么时候值得走第二条。

## 动手练习

**练习 1:语料决定知识。** 在 `PRETRAIN` 后面加一行 `"云簿 专业版 每年 999 元 。"`,写 `part02/more_data.py`,打印「专业版」和「每年」后面的概率表,再用种子 0 到 3 各生成一次「云簿 专业版」开头的句子。先猜结果再跑。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/more_data.py
import random

from toy_lm import PRETRAIN, generate, next_dist, train

model = train(PRETRAIN + ["云簿 专业版 每年 999 元 。"])
print("'专业版' 后面:", next_dist(model, "专业版"))
print("'每年' 后面:", next_dist(model, "每年"))
for seed in range(4):
    print(generate(model, "云簿 专业版", random.Random(seed)))
```

<div class="line-notes">

- `model = train(PRETRAIN + ["云簿 专业版 每年 999 元 。"])` 两个列表用 `+` 拼成新列表(JS 的 `[...PRETRAIN, "..."]`),不改原来的 `PRETRAIN`。
- `print("'专业版' 后面:", next_dist(model, "专业版"))` 原来「专业版」后面只有「每月」,现在多了「每年」。
- `for seed in range(4):` `range(4)` 是 0、1、2、3。
- `print(generate(model, "云簿 专业版", random.Random(seed)))` 每次用一个新的生成器,种子不同。

</div>

```bash
uv run part02/more_data.py
```

```text
'专业版' 后面: {'每月': 0.5, '每年': 0.5}
'每年' 后面: {'999': 1.0}
云簿 专业版 每年 999 元 。
云簿 专业版 每月 299 元 。
云簿 专业版 每月 39 元 。
云簿 专业版 每年 999 元 。
```

加一行语料,模型就多了一条「知识」:专业版有年付价。「每年」只在这一行出现过,所以后面 100% 是 999,这条知识很牢。「每月」却在三行里出现过,后面跟 99、39、299 各三分之一,所以 seed=1、2 说出了「专业版每月 299 元」「每月 39 元」这种错话。出现过一次的搭配记得最准,和别的句子共用的词最容易串,这个现象明天还会细看。

</details>

**练习 2:手算微调版的概率表。** 不跑代码,数一数 `PRETRAIN + SFT * 3` 里「客服:」「页面」「点」三个词后面各跟过什么、几次,算出概率。然后写 `part02/sft_peek.py` 验证。

<details><summary>参考答案</summary>

手算:三条 SFT 各重复 3 次。「客服:」后面:「在」出现在第 1、3 条,共 2 × 3 = 6 次;「年付」出现在第 2 条,3 次。概率 6/9 = 0.667 和 3/9 = 0.333。「页面」后面:第 1、3 条接「点」,第 2 条接「申请」,也是 6 比 3。「点」后面:第 1 条「开」,第 3 条「升级」,各 3 次,一半一半。`PRETRAIN` 里这三个词一个都没有,所以不影响。

```python
# agent-zero-lab/part02/sft_peek.py
from sft_toy import chat
from toy_lm import next_dist

for tok in ("客服:", "页面", "点"):
    print(f"{tok!r} 后面:", {t: round(p, 3) for t, p in next_dist(chat, tok).items()})
```

<div class="line-notes">

- `from sft_toy import chat` 直接导入训练好的微调版。`chat = train(...)` 写在 `sft_toy.py` 的顶层,导入时会执行一次训练;打印部分在 `if __name__ == "__main__":` 下,不会执行。
- `for tok in ("客服:", "页面", "点"):` 三个只在 SFT 数据里出现的词。

</div>

```bash
uv run part02/sft_peek.py
```

```text
'客服:' 后面: {'在': 0.667, '年付': 0.333}
'页面' 后面: {'点': 0.667, '申请': 0.333}
'点' 后面: {'开': 0.5, '升级': 0.5}
```

和手算一致。顺便看出正文里那几个错答案是怎么来的:「页面」后面不管前面是账单还是套餐,都可能接「点」;「点」后面一半是「开」一半是「升级」。正文 seed=3 的「在 账单 页面 点 升级」就是这样一步步走岔的。

</details>

**练习 3:标注员偏爱自信。** 假设标注员图省事,总觉得给了明确答复的回答更好:「支持」胜「不确定」、「支持」胜「不支持」、「不支持」胜「不确定」,三位标注员都这么选。写 `part02/rlhf_flip.py`,用 β=4 更新 `POLICY`,看「不确定」还剩多少。这说明了什么?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/rlhf_flip.py
from rlhf_toy import POLICY, reward_from_prefs, update

FLIPPED = [("支持", "不确定"), ("支持", "不支持"), ("不支持", "不确定")] * 3
reward = reward_from_prefs(FLIPPED)
print("奖励:", reward)
print("beta=4.0:", update(POLICY, reward, 4.0))
```

<div class="line-notes">

- `from rlhf_toy import POLICY, reward_from_prefs, update` 复用正文的初始概率和两个函数。
- `FLIPPED = [("支持", "不确定"), ("支持", "不支持"), ("不支持", "不确定")] * 3` 一位标注员的 3 次选择,乘 3 表示三位都一样。
- `print("beta=4.0:", update(POLICY, reward, 4.0))` 和正文 β=4 那一行对比。

</div>

```bash
uv run part02/rlhf_flip.py
```

```text
奖励: {'支持': 6, '不确定': -6, '不支持': 0}
beta=4.0: {'支持': 0.893, '不支持': 0.091, '不确定': 0.016}
```

「不确定」从 20% 掉到 1.6%,「支持」涨到 89.3%。可「云簿支不支持微信支付」资料里根本没写,模型被训练成了**不知道也要给个明确答案**。数据是同一批问题、同一个公式,只因为打分标准变了,模型就从「老实」变成了「爱编」。2025 年 OpenAI 的一篇论文《Why Language Models Hallucinate》就是这个观点:训练和评测都在奖励「猜一个」而不是「说不知道」,模型自然学会了猜。明天展开讲。

</details>

**练习 4:14.8 万亿个 token 有多少。** 假设一个人每分钟读 500 个汉字,按 Day 108 测的 DeepSeek 每个汉字约 0.62 个 token,每天读 8 小时,一年 365 天不休息。读完 DeepSeek-V3 的预训练语料要多少年?写 `part02/read_tokens.py` 算。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/read_tokens.py
PRETRAIN_TOKENS = 14.8e12
chars_per_min = 500
tokens_per_char = 0.62
tokens_per_day = chars_per_min * tokens_per_char * 60 * 8
years = PRETRAIN_TOKENS / tokens_per_day / 365
print(f"每天读 {tokens_per_day:,.0f} 个 token")
print(f"读完要 {years:,.0f} 年")
```

<div class="line-notes">

- `PRETRAIN_TOKENS = 14.8e12` `e12` 是科学计数法,14.8 × 10¹²,也就是 14.8 万亿。JS 里一样写 `14.8e12`。
- `tokens_per_day = chars_per_min * tokens_per_char * 60 * 8` 500 × 0.62 × 60 分钟 × 8 小时 = 148,800。
- `years = PRETRAIN_TOKENS / tokens_per_day / 365` 先算要多少天,再除以 365。
- `print(f"每天读 {tokens_per_day:,.0f} 个 token")` `:,.0f` 表示千位加逗号、不留小数,和 JS 的 `toLocaleString()` 效果差不多。

</div>

```bash
uv run part02/read_tokens.py
```

```text
每天读 148,800 个 token
读完要 272,500 年
```

27 万年。这还只是一个模型的预训练语料。所以别指望「模型看过的东西」和「你知道的东西」在一个量级上,它见过的网页比任何人一辈子能读的多几十万倍;反过来,你们公司内部文档它一页都没见过。这两件事同时成立。

</details>

**验收标准:** `toy_lm.py`、`sft_toy.py`、`rlhf_toy.py` 和四个练习脚本跑通,设了种子的输出和文章完全一致;能用一句话分别说出三个阶段的数据和效果;能解释为什么续写接口收到一份问题清单会接着出题,以及对话接口其实也是续写;能说出 β 的作用和讨好、奖励投机这两个副作用。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 训练 | 调整模型的参数,让它在练习题上猜得更准。今天的玩具里就是 `counts[prev][nxt] += 1` |
| 参数 | 模型内部那几千亿个可调的数字,模型学到的东西都压缩在这里 |
| 预训练(pretraining) | 用海量文本做「猜下一个 token」的练习。练完得到会续写、不会回答的模型 |
| base 模型(基座模型) | 只做过预训练的模型。给它一个问题,它可能接着出更多问题 |
| bigram 模型 | 只看前一个词来猜下一个词的最简单语言模型,今天的 `toy_lm.py` |
| 指令微调(SFT) | 用「指令 → 好回答」的对话样本接着训,让模型学会一问一答的格式和语气 |
| epoch(轮) | 把同一批训练数据完整过一遍。`SFT * 3` 相当于 3 轮 |
| chat template(对话模板) | 把 `messages` 拼成一段带角色标记的文字的规则,写在分词器配置里 |
| 特殊 token | 像 `<｜User｜>`、`<｜Assistant｜>`、结束标记这种专用的 token,普通文字里不会出现 |
| 续写接口 / 对话接口 | `/completions` 直接接一段文字往后写;`/chat/completions` 先套对话模板再续写 |
| 强化学习(RL) | 不给标准答案,只给「做得好不好」的分数(奖励),让模型往高分方向调 |
| RLHF | 基于人类反馈的强化学习:人比较回答,训打分模型,再用强化学习推着模型多写高分回答 |
| 奖励模型(reward model) | 从人的比较数据里学会给回答打分的模型 |
| β(beta) | 偏好训练里「别离原来的模型太远」的力度,越小挪得越猛 |
| 奖励投机(reward hacking) | 模型钻打分规则的空子拿高分,比如发现越长分越高就写得又长又空 |
| 讨好(sycophancy) | 经过 RLHF 的模型倾向于顺着用户说,被质疑就认错 |
| 后训练 / 对齐 | 预训练之后的所有训练(SFT、RLHF 等)的统称 |
| DPO | 直接用比较数据训练、不单独训奖励模型的偏好优化方法,2023 年提出 |

## 常见误区

**以为模型「理解」了问题才去回答。** 模型做的始终是续写。对话接口把你的话套进模板,它续写 `<｜Assistant｜>` 后面的部分;续写接口收到一份问题清单,它就接着写到第 10 题。看起来像理解,本质上是 SFT 教会了它「这个位置该写回答」。

**以为微调能让模型学会新知识。** SFT 主要改的是格式和习惯,不是知识。今天的玩具里,三条微调样本让「?」后面接「客服:」的概率从 0 涨到 81.8%,但回答内容照样乱。想让模型知道你公司的退款政策,正确做法是把政策文档在调用时送给它(第四部分的 RAG),而不是拿几十条问答去微调。

**以为 RLHF 让模型变「诚实」了。** RLHF 让模型变成「标注员喜欢的样子」。标注员喜欢承认不知道,它就学会承认;标注员偏爱自信,它就学会编(练习 3 里「不确定」掉到 1.6%)。讨好用户也是同一个原因。

**把分词器训练和模型训练混为一谈。** Day 107 的 BPE 分词器在模型训练之前就单独训好、定死了。今天讲的三个阶段训的都是模型参数,分词器在这期间一点都不变。

**以为续写接口就是 base 模型。** DeepSeek 没有开放 base 模型,`/beta/completions` 背后仍是做过微调的 `deepseek-flash`,只是绕开了对话模板。今天用它是为了看「不告诉它是对话时它会怎么接」,别把结果当成 base 模型的真实表现。

**以为「RLHF」就是现在各家用的方法。** 2022 年 InstructGPT 那一套是起点,现在有 DPO、AI 反馈、可验证奖励等很多变体,统称后训练或偏好优化。面试时说清楚「SFT 学格式、偏好优化学取舍」比背一个缩写更好。

## 学习资料

### 文档与文章

- [DeepSeek API:FIM 补全(Beta)](https://api-docs.deepseek.com/zh-cn/guides/fim_completion):续写接口的官方说明,看怎么设 beta 地址、`prompt` 参数怎么传。5 分钟。
- [Hugging Face:Illustrating Reinforcement Learning from Human Feedback (RLHF)](https://huggingface.co/blog/rlhf):英文,2022 年写的图解,三张图把预训练、训奖励模型、强化学习三步画得很清楚,和今天的三步对得上。公式部分可以跳过。30 分钟。
- [Ouyang 等《Training language models to follow instructions with human feedback》](https://arxiv.org/abs/2203.02155):InstructGPT 论文,今天说的「13 亿参数胜过 1750 亿」出自摘要。只读摘要和 Figure 2 那张三步流程图。
- [Hugging Face LLM 课程中文版 · Transformer 是如何工作的?](https://huggingface.co/learn/llm-course/zh-CN/chapter1/4):中文,讲预训练和微调的区别(迁移学习那一段),20 分钟。
- [DeepSeek-V3 Technical Report](https://arxiv.org/abs/2412.19437):14.8 万亿 token 的出处。只看摘要,知道量级就行。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DT421r7Et&autoplay=0&high_quality=1" title="通俗易懂理解大模型预训练和微调" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI老兵文哲 · 通俗易懂理解大模型预训练和微调 · 不到 6 分钟,大白话讲预训练和微调各自解决什么问题,先看这个建立印象。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aiADewEBC&p=12&autoplay=0&high_quality=1" title="【已授权】李宏毅2025《机器学习》" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>啥都会一点的研究生(授权搬运)· 李宏毅 2025《机器学习》第 12 P「第五讲:大型语言模型训练方法『预训练–对齐』的強大与极限」· 80 分钟,中文,讲得非常生动。今天先看前半小时,讲预训练学到了什么、对齐阶段在做什么。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV16cNEeXEer&autoplay=0&high_quality=1" title="【1080P】安德烈·卡帕西：深入探索像ChatGPT这样的大语言模型｜Andrej Karpathy" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>KrillinAI俊希(搬运)· 安德烈·卡帕西:深入探索像 ChatGPT 这样的大语言模型 · 3.5 小时,中文字幕。今天看讲 base 模型的那段(他现场演示 base 模型只会续写)和讲后训练、对话数据的那段,大约在前一个半小时里。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LPZh9BOjkQs" title="Large Language Models explained briefly" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · Large Language Models explained briefly · 英文,8 分钟(B 站有中配搬运,按标题「大语言模型简明解析」搜索)。用动画讲预训练要多少算力、为什么还需要 RLHF,最短的入门。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bZQun8Y4L2A" title="State of GPT | BRK216HFS" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Microsoft Developer · State of GPT(Andrej Karpathy 在 2023 年微软 Build 大会的演讲)· 英文。前 20 分钟那张「预训练 → SFT → 奖励模型 → 强化学习」的流程图是这个话题最经典的一张图,今天只看这一段。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》(Chip Huyen 著,O'Reilly,2025,目前只查到英文原版):第 2 章「Understanding Foundation Models」的 Post-Training 一节,讲 SFT 和偏好微调,写给用模型的工程师看,不推公式。
- 《Build a Large Language Model (From Scratch)》(Sebastian Raschka 著,Manning,2024;中文版《从零构建大模型》,人民邮电出版社,2025):从零写一个小 GPT,包括预训练和指令微调两章。现在不用读,第十部分讲微调时会再提。

### 开源项目与代码

- [karpathy/nanochat](https://github.com/karpathy/nanochat):Karpathy 2025 年开源的「一百美元训一个 ChatGPT」,一个仓库里从分词器、预训练、SFT 到强化学习全流程都有。要 GPU,今天只看 README 里那张阶段列表,对照今天的三步。
- [huggingface/trl](https://github.com/huggingface/trl):Hugging Face 的后训练库,SFT、DPO、各种强化学习方法都在里面。README 里列的 Trainer 名字就是今天这几个阶段的名字。

## 自测

1. 用一句话分别说出预训练、SFT、RLHF 三个阶段的数据是什么。

<details><summary>答案</summary>

预训练用海量网页、书、代码做「猜下一个 token」;SFT 用「指令 → 好回答」的对话样本接着做同样的练习;RLHF 用人对回答的两两比较结果,训打分模型,再用强化学习让模型多写高分回答。

</details>

2. 今天的 `toy_lm.py` 收到「怎么 开 发票 ?」为什么接着出题?DeepSeek 续写接口收到问题清单时为什么也一样?

<details><summary>答案</summary>

两者都只学过「接着写」。玩具语料里「?」后面 100% 跟「怎么」,所以它接下一个问题;DeepSeek 绕开对话模板后,一份「常见问题汇总」最可能的下文就是更多问题,它就一路写到第 10 题。回答问题这个习惯是 SFT 加上的,而且要配合对话模板里的角色标记才会触发。

</details>

3. 为什么说对话接口背后也是续写?Day 108 的「多出 4 个 token」和这件事什么关系?

<details><summary>答案</summary>

对话接口按 chat template 把 `messages` 拼成一段带特殊 token 的文字,比如 `<｜User｜>问题<｜Assistant｜>`,再让模型续写 `<｜Assistant｜>` 后面的部分。这些特殊 token 也算输入 token,所以每次请求的 `prompt_tokens` 比本地数的文字多几个。模型知道这个标记后面该写回答,是 SFT 阶段学会的。

</details>

4. RLHF 的玩具里,β 从 8 降到 2,「不确定」从 44.5% 涨到 96%。β 是不是越小越好?

<details><summary>答案</summary>

不是。β 越小,模型被推得离原来越远,会把概率全压到得分最高的那种回答上,丢掉原来学到的东西;打分规则有漏洞时还会出现奖励投机(比如越长分越高就写得又长又空)。β 是用来拴住模型、防止它为了分数走偏的。

</details>

5. 面试题:「为什么大模型被质疑时经常马上认错,哪怕它原来是对的?这对设计 Agent 有什么影响?」

<details><summary>答案</summary>

这叫讨好(sycophancy),来自 RLHF 一类的偏好训练:标注员更喜欢被认同、语气谦和的回答,模型就学会了顺着用户说。它反映的是训练目标,不是推理能力。对 Agent 的影响:不能把「用户说不对,模型改了」当成纠错成功,关键结果(金额、规则判断)要用代码或数据校验;提示词里可以明确要求「先核对依据再决定是否修改」;评测集里要专门放一些「用户质疑但原答案正确」的用例,看 Agent 会不会被带偏。

</details>

## 明天预告

Day 114 · 幻觉从哪来,怎么让它少一点。今天在玩具里已经看到两次「说错话」:`toy_lm.py` 说专业版每月 39 元,DeepSeek 续写给虚构的云簿编了一套「控制台-费用中心-发票管理」。明天把这件事讲透:它为什么会编、什么样的问题最容易编、怎么用提示词、多次采样和「把资料塞给它并要求引用」三招让它少编一点。
