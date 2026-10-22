---
title: 'Day 112 · 采样(二):top_p、seed 和可复现'
description: 'top_p 把概率从高到低累加,到 p 为止,砍掉温度抬起来的长尾;seed 让随机数每次从同一个起点出发。本地实现两者都很简单,可在 DeepSeek 上实测,非思考模式下 top_p 被直接忽略,seed 有影响却不保证一样,temperature=0 同一问题问 5 次出了 5 种答案。今天把这些现象和背后的原因讲清楚,再说工程上怎么跟「不可复现」相处。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'sampling', 'python', 'agent-zero']
series: 'agent-zero'
day: 112
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 111](/blog/agent-zero/day-111-week16-review/) 复习了第 16 周,把「文字 → token → 窗口 → 概率表 → 采样 → 接回」画成一条线,还用一张手写的概率表拼了一个迷你生成器,看到温度越高回复越多样、越容易撞上 `max_steps`。

[Day 110](/blog/agent-zero/day-110-sampling-1/) 留下了两个尾巴。一是温度调高时,词表里成千上万个原本几乎不可能的 token 都被抬起来,输出容易胡言乱语,我们只用前 10 名算 t=2.0,结果和 API 差了一截。二是 temperature=0 问 8 次,API 还是给了「轻账」「简账」两种答案。今天把这两件事接着讲完:第一件的解法叫 top_p,第二件牵出 seed 和「可复现」。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清楚 top_p(核采样)在做什么,亲手写出 `apply_top_p`,并说出它和 temperature 谁先谁后。
2. 用 `random.seed` 让本地采样每次跑出同样的结果,说出「伪随机」是什么意思。
3. 看懂三个 API 实测:DeepSeek 非思考模式下 top_p 被忽略、seed 有影响但不保证一样、temperature=0 同题跑 5 次各不相同,并能解释原因。
4. 说出工程上应对「输出不可复现」的几种做法,能在面试里讲清楚。

预计用时:2.5 小时左右。前置:[Day 110](/blog/agent-zero/day-110-sampling-1/) 的 `temperature_math.py`、`sampler.py` 和 `data/next_token_dist.json`,[Day 21](/blog/agent-zero/day-021-lists/) 的列表排序,[Day 30](/blog/agent-zero/day-030-functions-3/) 的 lambda。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `apply_top_p` 默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## top_p:按累计概率砍掉长尾

先回想 Day 110 那张表:t=2.0 时,「金」从 0.6% 涨到了 3.2%,而且前 10 名之外那十几万个 token 也一起被抬了起来。温度高本来是想要「多样」,可我们想要的多样是在「简」「轻」「账」「易」这些靠谱的候选之间换着来,不是让名字开头冒出一个标点或英文字母。

能不能只在「靠谱的那一小撮」里采样?**top_p** 就是干这个的,它还有个名字叫**核采样(nucleus sampling)**,出自 2019 年 Holtzman 等人的论文《The Curious Case of Neural Text Degeneration》。做法一句话:**把候选按概率从高到低排,一个个往下加,加到累计概率达到 p 就停,后面的全部扔掉,剩下的重新归一,再掷骰子。**

拿今天的数据手算一遍 p=0.9:

| 排名 | 候选 | 概率 | 累计 | 留不留 |
| --- | --- | --- | --- | --- |
| 1 | 简 | 0.321 | 0.321 | 留 |
| 2 | 轻 | 0.3129 | 0.634 | 留 |
| 3 | 账 | 0.1913 | 0.825 | 留 |
| 4 | 易 | 0.0882 | 0.913 | 留,加完这个达到 0.9,停 |
| 5 | 云 | 0.0456 | | 扔 |
| 6 及以后 | 随手、金…… | | | 扔 |

留下 4 个,它们加起来 0.913,各自除以 0.913 重新归一后再采样。「云」「随手」「金」这次一点机会都没有了。

为什么叫「核」?因为留下来的那一撮就是概率表的「核心」。它和直接说「只留前 4 名」(这种做法叫 **top_k**,固定留 k 个)的区别是:top_p 留几个是**自适应**的。模型很有把握时(比如 Day 110 的工单分类,「计」占 99.9997%),p=0.9 只留 1 个;模型犹豫时(起名字),就多留几个。top_k 不管分布什么形状都留 k 个,有把握时会白白放进几个垃圾候选。DeepSeek 的 API 没有 top_k 参数,开源模型的推理框架里一般都有,知道这个名字就行。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="top_p=0.9:按概率从高到低累加,到 0.9 为止,后面的候选被砍掉">
<rect x="0" y="0" width="640" height="200" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink)">top_p = 0.9:从高到低累加到 0.9,后面的不要</text>
<rect x="20" y="44" width="193" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="116" y="66" text-anchor="middle" fill="var(--ink)">简 0.321</text>
<rect x="213" y="44" width="188" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="307" y="66" text-anchor="middle" fill="var(--ink)">轻 0.313</text>
<rect x="401" y="44" width="115" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="458" y="66" text-anchor="middle" fill="var(--ink)">账 0.191</text>
<rect x="516" y="44" width="53" height="34" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="542" y="66" text-anchor="middle" fill="var(--ink)">易</text>
<rect x="569" y="44" width="27" height="34" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<rect x="596" y="44" width="24" height="34" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<line x1="560" y1="36" x2="560" y2="96" stroke="var(--ink-soft)"/>
<text x="560" y="112" text-anchor="middle" fill="var(--ink-soft)">0.9</text>
<text x="20" y="112" fill="var(--ink-faint)">0</text>
<text x="612" y="112" text-anchor="middle" fill="var(--ink-faint)">1</text>
<text x="20" y="140" fill="var(--ink-soft)">实线 = 留下(加完「易」累计 0.913,刚过 0.9)</text>
<text x="20" y="160" fill="var(--ink-soft)">虚线 = 云、随手、金……以及词表里另外十几万个 token,全部砍掉</text>
<text x="20" y="184" fill="var(--ink-faint)">宽度按概率画;留下的 4 个各除以 0.913 重新归一,再掷骰子</text>
</g>
</svg>
<figcaption>top_p 像在一条 0 到 1 的尺子上从左往右切,切到 p 为止。尺子右端那条很长很薄的尾巴,就是温度会抬起来的那些候选。</figcaption>
</figure>

### 用代码实现

新建 `part02/top_p.py`(在 `agent-zero-lab` 目录下):

```python
# agent-zero-lab/part02/top_p.py
import json
from pathlib import Path

from temperature_math import apply_temperature


def apply_top_p(dist: dict[str, float], p: float) -> dict[str, float]:
    ranked = sorted(dist.items(), key=lambda item: item[1], reverse=True)
    kept: dict[str, float] = {}
    running = 0.0
    for tok, prob in ranked:
        kept[tok] = prob
        running += prob
        if running >= p:
            break
    total = sum(kept.values())
    return {tok: prob / total for tok, prob in kept.items()}


if __name__ == "__main__":
    dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))
    for p in (0.1, 0.5, 0.9, 0.99):
        cut = apply_top_p(dist, p)
        print(f"top_p={p}: 留下 {len(cut)} 个 -> " + ", ".join(f"{t} {v:.3f}" for t, v in cut.items()))
    hot = apply_temperature(dist, 2.0)
    print("t=2.0 之后再 top_p=0.9:", len(apply_top_p(hot, 0.9)), "个")
```

<div class="line-notes">

- `from temperature_math import apply_temperature` Day 110 写的温度函数,最后一行要用它看「先升温再 top_p」。
- `def apply_top_p(dist: dict[str, float], p: float) -> dict[str, float]:` 输入概率表和 p,输出砍过尾巴、重新归一的新表。
- `ranked = sorted(dist.items(), key=lambda item: item[1], reverse=True)` `dist.items()` 是一串 `(token, 概率)` 元组;`key=lambda item: item[1]` 按第二个元素(概率)排;`reverse=True` 从大到小。相当于 JS 的 `Object.entries(dist).sort((a, b) => b[1] - a[1])`。`sorted` 返回新列表,不改原字典([Day 21](/blog/agent-zero/day-021-lists/) 讲过 `sorted` 和 `.sort()` 的区别)。我们的 JSON 本来就是排好序的,但别的概率表不一定,所以必须排。
- `kept: dict[str, float] = {}` 留下来的候选。
- `running = 0.0` 累计概率,从 0 开始。
- `for tok, prob in ranked:` 从概率最高的开始往下走。
- `kept[tok] = prob` 先把当前这个留下,再判断够不够。顺序很重要:先留后判断,保证至少留 1 个,哪怕 p 很小。
- `running += prob` 累加。p=0.9 时依次是 0.321、0.634、0.825、0.913。
- `if running >= p:` 累计达到 p 就停。0.913 ≥ 0.9,停在「易」。
- `total = sum(kept.values())` 留下的几个加起来,p=0.9 时是 0.913。
- `return {tok: prob / total for tok, prob in kept.items()}` 重新归一,让它们加起来等于 1。「简」:0.321 ÷ 0.913 = 0.351。
- `for p in (0.1, 0.5, 0.9, 0.99):` 四档 p 看留下几个。
- `hot = apply_temperature(dist, 2.0)` 先把概率表拍平,再看 top_p=0.9 留几个。

</div>

```bash
uv run part02/top_p.py
```

实跑输出:

```text
top_p=0.1: 留下 1 个 -> 简 1.000
top_p=0.5: 留下 2 个 -> 简 0.506, 轻 0.494
top_p=0.9: 留下 4 个 -> 简 0.351, 轻 0.343, 账 0.209, 易 0.097
top_p=0.99: 留下 7 个 -> 简 0.324, 轻 0.316, 账 0.193, 易 0.089, 云 0.046, 随手 0.027, 金 0.006
t=2.0 之后再 top_p=0.9: 6 个
```

p 越小,留下的越少。top_p=0.1 只剩「简」一个,效果和贪心一样,因为第一名一个就超过 0.1 了。p=0.9 留 4 个,和上面手算的一致。

最后一行值得多想一下。同样是 top_p=0.9,原始表留 4 个,升温到 2.0 之后留 6 个。温度把分布拍平了,要更多候选才能凑够 90%。这说明两件事:**temperature 和 top_p 会互相影响,而且先后顺序有讲究**。常见的实现(比如 Hugging Face transformers 的生成代码)是先除以温度,再做 top_p,所以你调高温度时 top_p 留下的范围也会跟着变宽。练习 2 会对比两种顺序。

这也是为什么各家文档都有一句类似的话,DeepSeek 的原文是「我们通常建议修改这个值或者更改 temperature,但不建议同时对两者进行修改」。两个旋钮都在改「从哪些候选里、以多大概率挑」,同时拧,很难说清最后的效果是谁造成的。我的习惯是只调 temperature,top_p 保持默认值 1(1 就是累计到 100% 才停,等于不砍)。

## 在 DeepSeek 上,top_p 管不管用

本地实现很清楚了,接下来看真模型。先查文档。2026 年 10 月查 [DeepSeek 对话补全接口文档](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion),`top_p` 那一条写的是:「该参数仅在思考模式下生效,有效取值范围为 0.95–1.0,低于 0.95 的取值会按 0.95 处理;在非思考模式下恒为 1.0,传入的值会被忽略。」

也就是说,我们关掉思考模式时传 top_p 没有任何效果;开着思考模式时 temperature 又不生效(Day 110 讲过)。在 DeepSeek 上,这两个旋钮**同一时间只有一个能用**。文档这么写,实际是不是这样?做个实验,**这段要调 API,你现在不用跑,看我的结果**。

思路是:temperature 拉到 1.5,名字本来会很分散。如果 top_p=0.1 真的生效,那每次只能从第一名里挑,8 次应该几乎全一样;如果被忽略,就和 top_p=1.0 一样分散。

```python
# agent-zero-lab/part02/top_p_api.py
import os
from collections import Counter

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

PROMPT = "给一家在线记账软件公司起一个中文名字,只输出名字本身,不要解释。"

for top_p in (1.0, 0.1):
    names: list[str] = []
    for _ in range(8):
        resp = client.chat.completions.create(
            model="deepseek-flash",
            messages=[{"role": "user", "content": PROMPT}],
            temperature=1.5,
            top_p=top_p,
            max_tokens=20,
            extra_body={"thinking": {"type": "disabled"}},
        )
        names.append((resp.choices[0].message.content or "").strip())
    print(f"top_p={top_p}: {len(set(names))} 种 -> {Counter(names).most_common()}")
```

<div class="line-notes">

- `PROMPT = "给一家在线记账软件公司起一个中文名字` 和 Day 110 同一个问题,第一个 token 的概率表就是 `next_token_dist.json` 那张。
- `for top_p in (1.0, 0.1):` 先跑「不砍」的对照组,再跑「砍得只剩第一名」的实验组。
- `temperature=1.5,` 故意设高,让两组的差别更容易看出来。
- `top_p=top_p,` 这一组的 top_p。openai SDK 直接支持这个参数。
- `extra_body={"thinking": {"type": "disabled"}},` 关思考模式,temperature 才生效;按文档,这时 top_p 应该被忽略。
- `print(f"top_p={top_p}: {len(set(names))} 种` 和 Day 110 的 `temperature.py` 一样,数 8 次里有几种不同的名字。

</div>

我的实跑输出:

```text
top_p=1.0: 6 种 -> [('易账通', 3), ('账房', 1), ('简易账', 1), ('云账通', 1), ('轻账', 1), ('易记账', 1)]
top_p=0.1: 4 种 -> [('轻账', 5), ('金算盘', 1), ('云账通', 1), ('随手记', 1)]
```

top_p=0.1 那一组出了 4 种名字,还有「金算盘」。按我们本地的 `apply_top_p`,p=0.1 时第一个 token 只能是第一名,8 次的开头应该全是同一个字;可这里有「轻」「金」「云」「随」四种开头,「金」在概率表里只有 0.6%。top_p=0.1 显然没起作用,和文档说的一致:**非思考模式下,DeepSeek 忽略 top_p,而且不报错**。6 种和 4 种的差别只是 8 次抽样的运气。

这个实验的教训比 top_p 本身更重要:**同一个参数名,在不同厂商、不同模式下的行为可能完全不一样**,而且传了无效参数,API 往往不报错,默默忽略。OpenAI 兼容协议只保证「参数名长得一样」,不保证「每家都实现了」。换一家模型、换一个模式,先翻那家的接口文档,再用一个像这样的小实验确认。

## seed:让随机每次从同一个地方开始

第二个尾巴:同样的请求,能不能让输出每次一样?先在本地把这件事搞清楚。

Day 110 说过,你每次跑 `dice.py`,数字都不一样。其实计算机里的「随机」大多是**伪随机**:用一个公式从一个起点(叫**种子 seed**)出发,一步步算出一串看起来毫无规律的数。公式是固定的,所以**起点一样,算出来的整串数就完全一样**。你不设种子时,Python 会用当前时间之类的东西当起点,所以每次不同。

前端同学可能没碰过这个,因为 JS 的 `Math.random()` 不能设种子,想要可复现的随机数得装 `seedrandom` 这类库。Python 标准库直接支持:`random.seed(42)`。

新建 `part02/seed_local.py`:

```python
# agent-zero-lab/part02/seed_local.py
import json
import random
from pathlib import Path

from sampler import sample

dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))

print("不设种子:", [sample(dist, 1.0) for _ in range(8)])
print("不设种子:", [sample(dist, 1.0) for _ in range(8)])

random.seed(42)
print("种子 42 :", [sample(dist, 1.0) for _ in range(8)])
random.seed(42)
print("种子 42 :", [sample(dist, 1.0) for _ in range(8)])
random.seed(7)
print("种子 7  :", [sample(dist, 1.0) for _ in range(8)])
```

<div class="line-notes">

- `from sampler import sample` Day 110 的 `sample(dist, t)`,里面用的是 `random.choices`,也就是 `random` 模块那个全局的随机数生成器。
- `print("不设种子:", [sample(dist, 1.0) for _ in range(8)])` 连抽 8 个 token。两行「不设种子」的结果会不一样。
- `random.seed(42)` 把全局随机数生成器的起点设成 42。42 没有特别含义,只是程序员的习惯(出自《银河系漫游指南》)。
- `print("种子 42 :", [sample(dist, 1.0) for _ in range(8)])` 从 42 这个起点抽 8 个。
- `random.seed(42)` 再设一次 42,起点拨回原处。不重新设的话,第二次抽会接着上一串往下走,结果就不同了。
- `random.seed(7)` 换一个种子,换一串结果。

</div>

```bash
uv run part02/seed_local.py
```

实跑输出:

```text
不设种子: ['轻', '轻', '轻', '账', '账', '简', '轻', '账']
不设种子: ['易', '简', '轻', '轻', '账', '轻', '账', '轻']
种子 42 : ['账', '简', '简', '简', '账', '账', '易', '简']
种子 42 : ['账', '简', '简', '简', '账', '账', '易', '简']
种子 7  : ['轻', '简', '账', '简', '轻', '轻', '简', '轻']
```

两行「种子 42」一模一样。我又把整个脚本跑了一遍,前两行变了,后三行和上面**一个字都不差**,你在自己电脑上跑,「种子 42」那两行也应该和我这里完全相同(同样的 Python 版本、同样的概率表)。这就是可复现:**同样的输入、同样的种子,同样的输出**。写测试、调 bug 时这非常有用,出问题的那次随机结果可以原样重放。

注意温度是 1.0,我们并没有让采样变得「不随机」,每一次挑选仍然是按概率掷骰子,只是骰子的每一次结果被种子提前定好了。可复现和不随机是两回事。

## 真模型能复现吗:三个实验

本地一切都很完美。到了 API 上,情况就复杂了。下面三个实验**都要调 API,你现在不用跑,看我的结果**。

### 实验一:传 seed 管不管用

openai SDK 的 `create` 方法有个 `seed` 参数。我装的 openai 3.36.1 里,这个参数的说明原文是:「This feature is in Beta. If specified, our system will make a best effort to sample deterministically ... Determinism is not guaranteed」,意思是「测试功能,会尽力确定地采样,但不保证」。这是 OpenAI 对自家服务的说法。DeepSeek 的接口文档里压根没有列 `seed` 这个参数。那传过去会怎样?

```python
# agent-zero-lab/part02/seed_api.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

PROMPT = "给一款在线记账软件写一句 20 字左右的广告语,只输出广告语。"

for seed in (42, 123, None):
    print(f"seed={seed}")
    for _ in range(5):
        resp = client.chat.completions.create(
            model="deepseek-flash",
            messages=[{"role": "user", "content": PROMPT}],
            temperature=1.0,
            seed=seed,
            max_tokens=60,
            extra_body={"thinking": {"type": "disabled"}},
        )
        print("   ", (resp.choices[0].message.content or "").strip())
```

<div class="line-notes">

- `PROMPT = "给一款在线记账软件写一句 20 字左右的广告语` 换成写广告语,输出有十几个 token,能看出是「只有开头一样」还是「整句一样」。
- `for seed in (42, 123, None):` 两个种子各跑 5 次,再加一组不传种子的对照。
- `temperature=1.0,` 正常的随机程度。如果 seed 真的能复现,同一个种子的 5 次应该完全一样。
- `seed=seed,` `None` 时 SDK 会发 `"seed": null`,等于没设。
- `max_tokens=60,` 一句广告语够用了。

</div>

我的实跑输出:

```text
seed=42
    随手记清每笔账，钱花哪儿一目了然。
    随手记清每笔账，钱花哪儿一目了然。
    随手记清每笔账，钱花哪儿心有数。
    随手记清每笔账，钱花哪儿心有数。
    随手记清每笔账，钱花哪儿心有数。
seed=123
    记账不费力，钱包更清晰。
    记账不费心，花钱有分寸，生活更轻松。
    记账不费心，生活更轻松。
    记账不费心，收支一目清，随手理好每笔账。
    记账不费心，花钱有分寸，生活更轻松。
seed=None
    记账不费力，每一笔都清晰。
    记账不费力，生活更有底。
    记账不费力，生活更有底。
    记一笔，心里有数；每一天，花得明白。
    记账不头疼，每笔都轻松，生活更从容。
```

这个结果很微妙。seed=42 的 5 次全部以「随手记清每笔账，钱花哪儿」开头,seed=123 的 5 次全部以「记账」开头,不传种子的那组开头就杂一些。看起来 DeepSeek 的服务端确实接收了 seed,而且它对采样有影响。我在写这篇之前还跑过一次同样的实验(每组 6 次),seed=42 那次也是 6 次全以「随手记清每笔账」开头,seed=123 全以「记账不」开头,规律一致。

但 seed=42 的 5 次里有两种结尾,seed=123 的 5 次里有 4 种。**同一个种子,没能做到每次一样**。所以对 DeepSeek 的 seed,我能下的结论只有:它没写进文档,实测有影响,但不保证复现,不能依赖。这和 OpenAI 自己文档里那句「Determinism is not guaranteed」是同一个意思。

### 实验二:temperature=0,同一个问题问 5 次

既然 seed 靠不住,把温度设成 0 呢?Day 110 说过 0 就是贪心,每步都选最大的,本地是完全确定的。这是大纲里的「同题跑 5 次」:

```python
# agent-zero-lab/part02/same_question_5x.py
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

PROMPT = "用 100 字左右向新用户介绍什么是增值税专用发票。"

answers: list[str] = []
for i in range(5):
    resp = client.chat.completions.create(
        model="deepseek-flash",
        messages=[{"role": "user", "content": PROMPT}],
        temperature=0,
        max_tokens=300,
        extra_body={"thinking": {"type": "disabled"}},
    )
    answers.append(resp.choices[0].message.content or "")

first = answers[0]
for i, ans in enumerate(answers, start=1):
    same = 0
    while same < min(len(first), len(ans)) and first[same] == ans[same]:
        same += 1
    if ans == first:
        print(f"第 {i} 次: {len(ans)} 字, 和第 1 次完全一样")
    else:
        print(f"第 {i} 次: {len(ans)} 字, 从第 {same + 1} 个字开始不同: …{first[same - 8:same + 6]}… / …{ans[same - 8:same + 6]}…")
print("一共", len(set(answers)), "种不同的回答")
print("第 1 次全文:", first)
```

<div class="line-notes">

- `PROMPT = "用 100 字左右向新用户介绍什么是增值税专用发票。"` 一个有标准知识的问题,回答一百多字,要连续采样上百个 token。
- `temperature=0,` 贪心。
- `max_tokens=300,` 一百多个汉字约八九十个 token(Day 108 的 0.62),300 足够,不会被截断。
- `answers.append(resp.choices[0].message.content or "")` 这次不 `.strip()`,要比较原文是否一字不差。
- `first = answers[0]` 以第 1 次为基准。
- `for i, ans in enumerate(answers, start=1):` `enumerate` 边遍历边给编号,`start=1` 从 1 开始数,相当于 JS 的 `answers.forEach((ans, i) => ...)` 再把 `i` 加 1。
- `while same < min(len(first), len(ans)) and first[same] == ans[same]:` 从头逐字比较,找到第一个不同的位置。`min(...)` 防止下标超出较短的那个字符串。
- `print(f"第 {i} 次: {len(ans)} 字, 从第 {same + 1} 个字开始不同:` `same` 是从 0 数的下标,加 1 变成「第几个字」。后面用切片把分歧点前 8 个字、后 6 个字打印出来对比。
- `print("一共", len(set(answers)), "种不同的回答")` 去重后有几种。

</div>

我的实跑输出:

```text
第 1 次: 128 字, 和第 1 次完全一样
第 2 次: 111 字, 从第 38 个字开始不同: …的发票，是购买方抵扣增值税进… / …的发票，是购买方支付增值税额…
第 3 次: 118 字, 从第 38 个字开始不同: …的发票，是购买方抵扣增值税进… / …的发票，是购买方支付增值税额…
第 4 次: 142 字, 从第 38 个字开始不同: …的发票，是购买方抵扣增值税进… / …的发票，是购买方支付增值税额…
第 5 次: 124 字, 从第 72 个字开始不同: …税凭证，记载交易双方信息、货… / …税凭证，记载交易金额和税额，…
一共 5 种不同的回答
第 1 次全文: 增值税专用发票是增值税一般纳税人销售货物或提供应税劳务开具的发票，是购买方抵扣增值税进项税额的法定凭证。它既是商事凭证，也是计税凭证，记载交易双方信息、货物或服务内容、金额及税额。与普通发票不同，专票可用于抵扣，直接关系企业税负，因此开具和使用需严格合规。
```

temperature=0,5 次,5 种回答。前 37 个字五次都一样,到第 38 个字,第 1 次写的是「抵扣」,第 2、3、4 次写的是「支付」;一旦这里分了岔,后面就各写各的了(自回归,Day 106)。第 5 次和第 1 次一路相同到第 71 个字才分开。

我更早还用同一个脚本跑过一次(那时还没加打印分歧片段的那两行),5 次里 3 次完全一样,另外两次分别从第 28 个字和第 90 个字开始不同,一共 3 种。两次实验的结论一样:**temperature=0 时 DeepSeek 不保证同样的输入得到同样的输出**,而且不同的程度时多时少。

### 实验三:连概率表本身都在变

为什么贪心解码还会变?贪心只会选最大的,如果每次的概率表完全一样,结果不可能不同。那就直接看概率表。还是 Day 110 那个起名字的请求,一模一样发 5 次,每次只看第一个 token 的前 3 名:

```python
# agent-zero-lab/part02/peek_5x.py
import math
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

PROMPT = "给一家在线记账软件公司起一个中文名字,只输出名字本身,不要解释。"

for i in range(5):
    resp = client.chat.completions.create(
        model="deepseek-flash",
        messages=[{"role": "user", "content": PROMPT}],
        max_tokens=1,
        temperature=1.0,
        logprobs=True,
        top_logprobs=3,
        extra_body={"thinking": {"type": "disabled"}},
    )
    logprobs = resp.choices[0].logprobs
    assert logprobs is not None and logprobs.content
    top3 = ", ".join(f"{c.token} {math.exp(c.logprob):.3f}" for c in logprobs.content[0].top_logprobs)
    print(f"第 {i + 1} 次: {top3}")
```

<div class="line-notes">

- `for i in range(5):` 完全相同的请求发 5 次。
- `temperature=1.0,` 用 1.0,返回的 logprob 就是模型原始的概率,不被温度变形(Day 110 验证过 API 返回的是变形后的概率)。
- `top_logprobs=3,` 只看前 3 名。
- `top3 = ", ".join(f"{c.token} {math.exp(c.logprob):.3f}" for c in logprobs.content[0].top_logprobs)` 把前 3 名拼成一行,概率保留 3 位。

</div>

我的实跑输出:

```text
第 1 次: 轻 0.380, 简 0.224, 账 0.186
第 2 次: 账 0.303, 轻 0.292, 简 0.216
第 3 次: 账 0.303, 轻 0.292, 简 0.216
第 4 次: 轻 0.577, 简 0.253, 账 0.101
第 5 次: 账 0.303, 轻 0.292, 简 0.216
```

同一个输入,5 次里出现了 3 张不一样的概率表。第一名一会儿是「轻」一会儿是「账」;「轻」的概率在 0.292 到 0.577 之间跳。Day 110 存下来的那张表(「简」0.321、「轻」0.313)又是另一张。也就是说,**模型这一侧算出来的概率本身就不稳定**,不是采样那一步的问题。概率表都变了,贪心选出来的第一名自然会变,temperature=0 也挡不住。

## 为什么同样的输入会算出不同的概率

直觉上,模型就是一个函数,同样的输入就该有同样的输出。问题出在服务端「怎么算」。

计算机里的小数加法不满足结合律,`(a + b) + c` 和 `a + (b + c)` 的结果可能在最后几位不一样。[Day 12](/blog/agent-zero/day-012-numbers/) 见过 `0.1 + 0.2` 不等于 `0.3`,就是这类舍入误差。模型一次计算要做几十亿次乘加,换一个加的顺序,最后的概率就可能差一点点。平时差一点点无所谓,可一旦两个候选几乎打平(Day 110 的「简」和「轻」),一点点就能让第一名换人,后面整段话从此分岔。

那加的顺序为什么会变?2025 年 9 月,Thinking Machines Lab 的 Horace He 等人发表了一篇很有名的文章[《Defeating Nondeterminism in LLM Inference》](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/)。以前流行的说法是「GPU 并行计算 + 浮点数」造成随机,他们认为这不是全部:单独一次计算其实是可以每次一样的,真正的原因是服务端会把很多用户的请求**拼成一批(batch)一起算**,而一批里有多少个请求取决于那一刻的服务器负载;很多计算步骤在批大小不同时会换一种加法顺序。于是你的结果取决于「和你同时发请求的有多少人」,这对你来说就是随机的。

他们做了一个实验:用 Qwen3-235B 模型、temperature=0,对同一个提示词生成 1000 次,每次 1000 个 token,结果有 80 种不同的回答;前 102 个 token 全部一样,第 103 个 token 才开始分岔。改用他们写的「不受批大小影响」的计算方法后,1000 次完全一样。这些数字来自那篇文章,属于二手资料,我没有能力在 DeepSeek 上复现。DeepSeek 服务端用的是什么方法我也不知道,上面三个实验只能说明现象:概率表会变,输出会变。

所以这件事的结论是:**不确定性主要来自服务端的工程实现,不是你的参数没设对**。你能控制的是 temperature 和 seed,控制不了服务器那一刻有多忙。

## 工程上怎么和「不可复现」相处

既然 API 的输出保证不了一样,写 Agent 时就要把这当成前提来设计,而不是假设它不存在。下面这几条是我觉得最实用的,后面的课会一条条展开:

**测试不要断言整段原文。** `assert answer == "增值税专用发票是……"` 这种测试今天跑过、明天就挂,挂了也说明不了任何问题。断言结构和关键事实:回复里有没有提到「抵扣」、JSON 能不能解析、分类结果是不是三个合法值之一。

**把一次调用的「现场」记下来。** 模型名、temperature、seed、完整的输入、输出、API 返回的 `system_fingerprint`(服务端配置的标识,文档说它用来判断后端配置有没有变过,Day 122 讲响应字段时会看到)。出了问题,至少知道当时发生了什么。后面学可观测性时,这件事有专门的工具。

**测试时把模型的回答录下来重放。** 单元测试里不真的调 API,而是用事先录好的回答(第一次真调,存成文件,之后读文件),测试就完全可复现,也不花钱。[Day 71](/blog/agent-zero/day-071-pytest-1/) 学过 pytest,后面会讲怎么在测试里替换掉真实调用。

**评测跑多次,看比例。** 一个分类 Agent 好不好,不是跑一次看对不对,而是同一批题跑几次,统计准确率和一致率。练习 4 写一个最小的一致率检查。用多次采样投票提高稳定性的办法叫自洽(self-consistency),[Day 179](/blog/agent-zero/day-179-self-consistency/) 讲。

**真要确定的事,别交给模型。** 退款金额、发票号、权限判断,这些要求每次一样的结果,用代码和数据库来算,让模型只负责理解意图、组织语言。这是写 Agent 最重要的设计原则之一,后面会反复出现。

## 动手练习

**练习 1:top_p 的边界。** 不运行代码,先手算:用 `next_token_dist.json` 那张表,top_p 分别取 0.6、0.64、0.95 时各留下哪几个?然后写 `part02/top_p_hand.py` 验证。

<details><summary>参考答案</summary>

手算:累计概率依次是 0.321、0.6339、0.8252、0.9134、0.959……

- p=0.6:加到「轻」是 0.6339 ≥ 0.6,留「简」「轻」2 个。
- p=0.64:加到「轻」是 0.6339,还差一点点没到 0.64,要再加「账」到 0.8252,留 3 个。
- p=0.95:加到「易」是 0.9134 不够,加「云」到 0.959,留 5 个。

```python
# agent-zero-lab/part02/top_p_hand.py
import json
from pathlib import Path

from top_p import apply_top_p

dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))
for p in (0.6, 0.64, 0.95):
    cut = apply_top_p(dist, p)
    print(f"top_p={p}: {list(cut.keys())}")
```

<div class="line-notes">

- `from top_p import apply_top_p` 复用正文的函数,`top_p.py` 的演示代码在 `if __name__ == "__main__":` 下,不会被执行。
- `for p in (0.6, 0.64, 0.95):` 0.64 是故意挑的边界值,刚好比前两名之和 0.6339 大一点。
- `print(f"top_p={p}: {list(cut.keys())}")` 只看留下了谁。

</div>

```bash
uv run part02/top_p_hand.py
```

```text
top_p=0.6: ['简', '轻']
top_p=0.64: ['简', '轻', '账']
top_p=0.95: ['简', '轻', '账', '易', '云']
```

和手算一致。0.64 这一档最容易算错:前两名加起来 0.6339,和 0.64 只差 0.0061,一眼扫过去很容易当成「够了」。代码里 `if running >= p` 是在加完当前这个之后才判断,加完「轻」还不够,所以「账」也被留下。写测试时专门挑这种贴着边界的值,是抓 bug 的好办法。

</details>

**练习 2:先温度还是先 top_p。** 用 t=2.0、top_p=0.9,分别按「先温度后 top_p」和「先 top_p 后温度」两种顺序处理概率表,打印各留下几个、是哪几个。解释为什么不一样。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/order_matters.py
import json
from pathlib import Path

from temperature_math import apply_temperature
from top_p import apply_top_p

dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))

a = apply_top_p(apply_temperature(dist, 2.0), 0.9)
b = apply_temperature(apply_top_p(dist, 0.9), 2.0)
print("先温度后 top_p:", len(a), "个", list(a.keys()))
print("先 top_p 后温度:", len(b), "个", list(b.keys()))
```

<div class="line-notes">

- `a = apply_top_p(apply_temperature(dist, 2.0), 0.9)` 从里往外读:先升温拍平,再按 0.9 砍尾巴。Hugging Face transformers 等常见实现是这个顺序。
- `b = apply_temperature(apply_top_p(dist, 0.9), 2.0)` 先在原始表上砍到 4 个,再对这 4 个升温。
- `print("先温度后 top_p:", len(a), "个", list(a.keys()))` 实跑 6 个。

</div>

```bash
uv run part02/order_matters.py
```

```text
先温度后 top_p: 6 个 ['简', '轻', '账', '易', '云', '随手']
先 top_p 后温度: 4 个 ['简', '轻', '账', '易']
```

先升温,分布变平,要 6 个才凑够 90%,「云」「随手」被放了进来;先砍尾巴,范围已经定死在 4 个,温度只能在这 4 个之间重新分配。所以同样的两个参数值,顺序不同,能被选中的候选范围就不同。用 API 时顺序是服务端定的,你改不了,这也是不建议两个参数同时调的原因之一:效果取决于你看不见的实现细节。

</details>

**练习 3:各用各的随机数生成器。** `random.seed` 设的是全局生成器,程序里别处只要调了一次 `random.random()`,你的序列就被打乱了。写 `part02/rng_instances.py`:用 `random.Random(42)` 建两个独立的生成器 A 和 B,写一个 `sample_with(rng, dist, t)` 函数用指定的生成器采样;A 先抽 3 个,然后在全局调一次 `random.random()`,B 再抽 3 个,然后 A、B 各再抽 3 个。看 A 和 B 的结果是不是一样。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/rng_instances.py
import json
import random
from pathlib import Path

from temperature_math import apply_temperature


def sample_with(rng: random.Random, dist: dict[str, float], t: float) -> str:
    new = apply_temperature(dist, t)
    return rng.choices(list(new.keys()), weights=list(new.values()))[0]


dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))

user_a = random.Random(42)
user_b = random.Random(42)
print("A 先抽 3 个:", [sample_with(user_a, dist, 1.0) for _ in range(3)])
random.random()
print("B 抽 3 个  :", [sample_with(user_b, dist, 1.0) for _ in range(3)])
print("A 再抽 3 个:", [sample_with(user_a, dist, 1.0) for _ in range(3)])
print("B 再抽 3 个:", [sample_with(user_b, dist, 1.0) for _ in range(3)])
```

<div class="line-notes">

- `def sample_with(rng: random.Random, dist: dict[str, float], t: float) -> str:` 多了一个参数 `rng`,指定用哪个生成器。类型 `random.Random` 是 `random` 模块里的类([Day 40](/blog/agent-zero/day-040-classes-1/) 学的类),全局的 `random.choices` 其实就是一个隐藏的 `Random` 对象的方法。
- `return rng.choices(list(new.keys()), weights=list(new.values()))[0]` 和 Day 110 的 `sample` 一样,只是 `random.choices` 换成了 `rng.choices`。
- `user_a = random.Random(42)` 建一个独立的生成器,种子 42。
- `user_b = random.Random(42)` 再建一个,种子也是 42,它和 A 互不影响。
- `random.random()` 在全局生成器上抽一次。它会打乱全局序列,但碰不到 A 和 B。
- `print("A 再抽 3 个:", [sample_with(user_a, dist, 1.0) for _ in range(3)])` A 接着自己的序列往下走。

</div>

```bash
uv run part02/rng_instances.py
```

```text
A 先抽 3 个: ['账', '简', '简']
B 抽 3 个  : ['账', '简', '简']
A 再抽 3 个: ['简', '账', '账']
B 再抽 3 个: ['简', '账', '账']
```

A 和 B 每一步都一样,中间那次全局 `random.random()` 对它们毫无影响。真实程序里,你调用的某个库可能偷偷用了全局随机数,如果你的可复现依赖 `random.seed`,就会被它打乱,而且很难查。需要可复现的地方,自己建一个 `random.Random(种子)` 传下去,更稳。

</details>

**练习 4:一致率检查。** 既然模型输出会变,评测时就跑多次看一致率。写一个 `agreement(outputs)` 函数,返回多数答案和它占的比例;一致率 ≥ 80% 算通过,否则标记「不稳定,转人工」。用两组假设的 5 次分类结果测试:工单 A 是 `计费 ×4、账号 ×1`,工单 B 是 `计费、账号、计费、账号、技术`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/stable_check.py
from collections import Counter


def agreement(outputs: list[str]) -> tuple[str, float]:
    answer, n = Counter(outputs).most_common(1)[0]
    return answer, n / len(outputs)


runs_ok = ["计费", "计费", "计费", "计费", "账号"]
runs_bad = ["计费", "账号", "计费", "账号", "技术"]

for name, runs in (("工单 A", runs_ok), ("工单 B", runs_bad)):
    answer, rate = agreement(runs)
    verdict = "通过" if rate >= 0.8 else "不稳定,转人工"
    print(f"{name}: 多数答案 {answer}, 一致率 {rate:.0%} -> {verdict}")
```

<div class="line-notes">

- `answer, n = Counter(outputs).most_common(1)[0]` 出现最多的那个答案和次数。打平时 `Counter` 按第一次出现的先后排([Day 107](/blog/agent-zero/day-107-tokens-1/) 讲过),所以工单 B 的「计费」和「账号」都是 2 次,取先出现的「计费」。
- `return answer, n / len(outputs)` 一致率 = 多数答案次数 ÷ 总次数。工单 A:4 ÷ 5 = 0.8。
- `runs_ok = ["计费", "计费", "计费", "计费", "账号"]` 假设数据,不是实跑 API 得来的。真实做法是把同一张工单发 5 次,收集 5 个分类结果。
- `verdict = "通过" if rate >= 0.8 else "不稳定,转人工"` 条件表达式,相当于 JS 的 `rate >= 0.8 ? "通过" : "不稳定,转人工"`。
- `print(f"{name}: 多数答案 {answer}, 一致率 {rate:.0%} -> {verdict}")` `:.0%` 乘 100、不留小数、加百分号。

</div>

```bash
uv run part02/stable_check.py
```

```text
工单 A: 多数答案 计费, 一致率 80% -> 通过
工单 B: 多数答案 计费, 一致率 40% -> 不稳定,转人工
```

工单 B 一致率只有 40%,说明模型对这张工单本身就拿不准,这时与其信任某一次的结果,不如交给人。这就是把「不可复现」从麻烦变成信号:模型自己答案都不稳定的题,往往就是它不该独自决定的题。代价是每张工单要调 5 次,钱也是 5 倍,所以一般只在评测或高风险步骤里这么做。

</details>

**验收标准:** `top_p.py`、`order_matters.py`、`seed_local.py`、`rng_instances.py`、`stable_check.py` 跑通,其中不含随机或设了种子的输出和文章完全一致;能手算任意 p 下 top_p 留下哪几个;能说出 DeepSeek 非思考模式下 top_p 被忽略、seed 未写进文档且不保证复现;能用「批处理导致计算顺序变化」解释 temperature=0 为什么还会变;能说出至少三条工程上应对不可复现的做法。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| top_p / 核采样(nucleus sampling) | 把候选按概率从高到低累加,到 p 为止,只在这些候选里重新归一再采样。p=0.9 时今天的表留 4 个 |
| top_k | 固定只留概率最高的 k 个候选。DeepSeek API 没有这个参数,开源推理框架里常见 |
| 长尾 | 概率表里排在后面、每个都很小但数量极多的那些候选,温度一高就会被抬起来 |
| 伪随机 | 用固定公式从一个起点算出的「看起来随机」的数列,起点相同,整串数相同 |
| seed(种子) | 伪随机数列的起点。`random.seed(42)` 设全局的,`random.Random(42)` 建独立的 |
| 可复现(reproducible) | 同样的输入、同样的设置,得到同样的输出。本地设了种子可以做到,API 不保证 |
| 不确定性(nondeterminism) | 同样的输入在不同时间得到不同的结果。大模型 API 即使 temperature=0 也有 |
| batch(批) | 服务端把多个用户的请求拼在一起同时计算,批的大小随负载变化 |
| system_fingerprint | API 响应里的一个字段,标识服务端当时的配置,配置变了它会变,Day 122 讲 |

## 常见误区

**以为在 DeepSeek 上传 top_p 会生效。** 非思考模式下 top_p 恒为 1.0,传的值被忽略,不报错。实测 top_p=0.1 仍出了 4 种名字、包括只有 0.6% 概率的「金」开头。用之前查那家厂商的接口文档。

**temperature 和 top_p 一起调。** 两个都在改采样范围,效果还取决于服务端谁先谁后(练习 2 实测两种顺序留下 6 个和 4 个)。只调一个,另一个保持默认。

**以为设了 seed 就一定能复现。** OpenAI 的 SDK 说明写着「Determinism is not guaranteed」;DeepSeek 文档没有 seed,实测同一个种子 5 次出了 2 到 4 种结尾。

**以为 temperature=0 就每次一样。** 实测同题 5 次 5 种回答,从第 38 个字开始分岔;连第一个 token 的概率表都在 3 种之间跳。原因在服务端的批处理和浮点计算顺序,不在你的参数。

**用 `random.seed` 做可复现,却被别的代码打乱。** 全局生成器谁都能用,中间任何一次 `random.random()` 都会让后面的序列变掉。用 `random.Random(种子)` 建自己的生成器。

**测试里断言模型输出的整段原文。** 这样的测试会随机失败,失败了也说明不了问题。断言结构和关键事实,或者把模型回答录下来重放。

## 学习资料

### 文档与文章

- [DeepSeek API:对话补全](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion):`top_p` 和 `temperature` 两条的原文,重点看「仅在思考模式下生效」「在非思考模式下恒为 1.0」这两句。10 分钟。
- [Thinking Machines:Defeating Nondeterminism in LLM Inference](https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/):英文,2025 年 9 月,讲清楚 temperature=0 为什么还会变。前半部分(到 1000 次实验那张图)不需要懂 GPU 也能读,后半部分讲怎么改计算方法,可以跳过。40 分钟。
- [OpenAI Cookbook:Reproducible outputs with the seed parameter](https://developers.openai.com/cookbook/examples/reproducible_outputs_with_the_seed_parameter):英文,2023 年 seed 刚推出时的官方示例,看它怎么用 `system_fingerprint` 判断后端有没有变。注意这是 OpenAI 自家服务的行为,不代表别家。
- [Hugging Face:How to generate text](https://huggingface.co/blog/how-to-generate):英文,Day 110 读了前半,今天读 Top-K Sampling 和 Top-p (nucleus) sampling 两节,图把「留几个」画得很清楚。
- [Holtzman 等《The Curious Case of Neural Text Degeneration》](https://arxiv.org/abs/1904.09751):提出核采样的论文。偏学术,只看摘要和第一张图(模型生成的文本越写越重复、越写越怪的例子)就够了。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1nK421Y72d&autoplay=0&high_quality=1" title="10分钟搞明白如何设置大模型推理参数,top_k,top_p, temperature, num_beams。温度,beam search。" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>RethinkFun · 10分钟搞明白如何设置大模型推理参数,top_k、top_p、temperature、num_beams · 9 分钟,把 top_k、top_p、temperature 放在一起对比讲,beam search 那段了解即可,API 用不到。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1taSFBNEG4&autoplay=0&high_quality=1" title="Temperature & Top-p:掌控大模型的创造力开关" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · Temperature & Top-p:掌控大模型的创造力开关 · Day 110 看了前半段,今天看后半段 top-p 的部分。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7xTGNNLPyMI" title="Deep Dive into LLMs like ChatGPT" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · Deep Dive into LLMs like ChatGPT · 英文,3 个多小时(B 站有中文字幕搬运,按标题搜索)。今天只看讲 inference(推理)的那一段,他现场演示同一个开头每次生成都不一样,解释「模型是个随机的 token 生成器」。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》(Chip Huyen 著,O'Reilly,2025,目前只查到英文原版):第 2 章「Sampling」一节讲了 top-k、top-p,后面专门有一段讲模型输出的不一致(inconsistency)和怎么缓解,和今天最后一节对得上。

### 开源项目与代码

- [huggingface/transformers 的 logits_process.py](https://github.com/huggingface/transformers/blob/main/src/transformers/generation/logits_process.py):开源模型生成文本时真实用的采样代码。搜 `class TopPLogitsWarper`,看它怎么排序、累加、把累计超过 p 的候选设成负无穷,和今天的 `apply_top_p` 是同一个思路;旁边的 `TemperatureLogitsWarper` 就是「除以温度」那一行。
- [thinking-machines-lab/batch_invariant_ops](https://github.com/thinking-machines-lab/batch_invariant_ops):上面那篇文章配套的代码,今天只看 README 了解「批不变」想解决什么,代码要 GPU,不用跑。

## 自测

1. 用今天的概率表,top_p=0.5 留下哪几个?重新归一后「简」的概率是多少?

<details><summary>答案</summary>

累计到「轻」是 0.6339 ≥ 0.5,留「简」「轻」两个。「简」= 0.321 ÷ 0.6339 ≈ 0.506,和 `top_p.py` 实跑一致。

</details>

2. top_p 和 top_k 都是「只留一部分候选」,top_p 好在哪?

<details><summary>答案</summary>

top_p 留几个是自适应的:模型有把握时(第一名就占 99%)只留 1 个,犹豫时多留几个。top_k 不管分布形状都固定留 k 个,模型有把握时也会放进几个本该排除的候选。

</details>

3. 你在 DeepSeek 上关了思考模式,把 top_p 设成 0.1 想让输出更稳定,结果没变化。为什么?该怎么做?

<details><summary>答案</summary>

DeepSeek 文档写明非思考模式下 top_p 恒为 1.0,传入的值被忽略,也不报错。想让输出更稳定,在非思考模式下调低 temperature;同时接受 temperature=0 也不能保证完全一样。

</details>

4. 本地 `random.seed(42)` 能保证结果一样,为什么同样的思路放到 API 上(传 seed、temperature=0)就不行?

<details><summary>答案</summary>

本地的概率表是固定的,种子只决定掷骰子的结果。API 上连概率表本身都会变:服务端把多个请求拼成批一起算,批大小随负载变化,计算顺序跟着变,浮点舍入误差让概率在最后几位不同;候选接近时第一名就会换,后面整段分岔。种子管得了掷骰子,管不了概率表。

</details>

5. 面试题:「我们的 Agent 上线后,同一个用户问题偶尔得到不同的处理结果,测试也时好时坏。你会怎么分析和改进?」

<details><summary>答案</summary>

先说原因:大模型 API 即使 temperature=0 也不保证确定,原因在服务端的批处理和浮点计算,不是参数没设对;另外要检查推理模型或思考模式是否让 temperature 失效、top_p 等参数是否被忽略。然后分几层改进:要求确定的决策(金额、权限、发票号)挪到代码和数据库里,模型只负责理解和表达;关键的模型判断步骤用低温、写清楚定义和示例让分布更尖,高风险的跑多次看一致率,不一致就转人工;测试不断言原文,断言结构和关键事实,单元测试用录好的回答重放;每次调用记录模型名、参数、输入输出和 system_fingerprint,方便事后定位;评测按多次运行的比例来报告。

</details>

## 明天预告

Day 113 · 模型怎么训出来:预训练、指令微调、RLHF 一句话版。这三天我们一直在讲模型「用起来」时发生了什么:token、窗口、概率表、采样。明天往回看一步,那张概率表是怎么来的,为什么它会给「简」0.32 而不是别的数,答案在训练的三个阶段里。
