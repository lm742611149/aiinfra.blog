---
title: 'Day 110 · 采样(一):概率分布和 temperature'
description: '模型每一步给出的不是一个字,而是一张「下一个 token 是谁」的概率表,最后输出哪个,靠按概率掷骰子。今天拿 DeepSeek 返回的真实概率表,用纯 Python 掷一千次骰子,再亲手实现 temperature,看它怎么把概率表压尖或拍平,以及为什么 temperature=0 也会出两种答案。'
pubDate: 2026-10-22
regime: none
tags: ['llm-basics', 'sampling', 'python', 'agent-zero']
series: 'agent-zero'
day: 110
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 109](/blog/agent-zero/day-109-context-window/) 量了上下文窗口:DeepSeek 一次调用最多装 1,048,576 个 token,输入和输出共用;一本繁体《西游记》就占掉六成多;超了窗口 API 直接回 400。我们还写了第一个截断函数 `trim`,保住系统提示词,从最早的消息开始丢。

107 到 109 这三天讲的都是模型「看到」什么。今天转到另一头,模型「说出」什么。[Day 106](/blog/agent-zero/day-106-next-token/) 说过,模型每一步算出的是「下一个 token 是词表里每个 token 的概率」,那最后到底输出哪一个?这一步叫**采样**,调 API 时最常改的那个参数 `temperature` 管的就是它。

## 今天要解决的问题

学完今天,你应该能做到:

1. 看懂一张真实的「下一个 token 概率表」,并用 Python 按这张表掷骰子,验证掷一千次的频率和概率对得上。
2. 亲手写出 `apply_temperature` 函数,说清楚 temperature 调低、调高时概率表怎么变,以及 temperature=0 为什么要单独处理。
3. 解释为什么同一个分类任务在 temperature=2 时几乎不受影响,而起名字的任务会变得五花八门。
4. 知道 Agent 里不同步骤 temperature 大致怎么设,以及 DeepSeek 开着思考模式时 temperature 不生效。

预计用时:2.5 小时左右。前置:[Day 106](/blog/agent-zero/day-106-next-token/) 的自回归生成、[Day 107](/blog/agent-zero/day-107-tokens-1/) 的 `Counter`、[Day 24](/blog/agent-zero/day-024-dicts/) 的字典、[Day 39](/blog/agent-zero/day-039-json/) 的 JSON 读写、[Day 32](/blog/agent-zero/day-032-modules/) 的 `if __name__ == "__main__"`。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `apply_temperature` 和 `sample` 两个函数默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 先看一张真实的概率表

讲道理之前先看数据。下面这段代码要调 API,而这门课 [Day 120](/blog/agent-zero/day-120-api-register/) 才注册拿 key,**这段你现在不用跑,看我的实跑结果**。我做的事很简单:让 DeepSeek 给一家记账软件公司起个名字,只让它输出 1 个 token,同时要它把「第一个 token 的前 10 名候选和各自的概率」一起返回。

```python
# agent-zero-lab/part02/peek_next_token.py
import json
import math
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

PROMPT = "给一家在线记账软件公司起一个中文名字,只输出名字本身,不要解释。"

resp = client.chat.completions.create(
    model="deepseek-flash",
    messages=[{"role": "user", "content": PROMPT}],
    max_tokens=1,
    temperature=1.0,
    logprobs=True,
    top_logprobs=10,
    extra_body={"thinking": {"type": "disabled"}},
)

logprobs = resp.choices[0].logprobs
assert logprobs is not None and logprobs.content
first = logprobs.content[0]
dist = {c.token: round(math.exp(c.logprob), 4) for c in first.top_logprobs}
for token, p in dist.items():
    print(f"{token!r:8} {p:.4f}")
print("前 10 个加起来:", round(sum(dist.values()), 4))
print("这次抽中的是:", repr(first.token))
Path("data/next_token_dist.json").write_text(json.dumps(dist, ensure_ascii=False, indent=2), encoding="utf-8")
```

<div class="line-notes">

- `from dotenv import load_dotenv` 从 `.env` 文件读出 key 等配置放进环境变量,Day 120 会细讲。今天只要知道它让 `os.environ["LLM_API_KEY"]` 能取到值。
- `from openai import OpenAI` OpenAI 官方的 Python SDK。DeepSeek 兼容这套接口,所以同一个 SDK 换个地址就能调 DeepSeek(Day 123 详讲)。
- `client = OpenAI(base_url=` 建一个客户端,`base_url` 是 `https://api.deepseek.com`,相当于前端里先 `axios.create({ baseURL })`。
- `PROMPT = "给一家在线记账软件公司起一个中文名字` 选起名字,是因为这个任务没有标准答案,候选会比较分散,好观察。
- `max_tokens=1,` 只要第 1 个 token。我们只想看「第一步」的概率表,多生成没意义还多花钱。
- `temperature=1.0,` 今天的主角,1.0 是 DeepSeek 的默认值。先记住它,后面会看到它为什么叫「原样」。
- `logprobs=True,` 要求返回每个输出 token 的对数概率(logprob,下面解释)。
- `top_logprobs=10,` 每个位置再附上概率最高的前 10 个候选。DeepSeek 文档写的上限是 20。
- `extra_body={"thinking": {"type": "disabled"}},` 关掉思考模式。DeepSeek 默认开着思考,而文档写明「思考模式下 temperature 不生效」,不关的话今天的实验全白做。
- `logprobs = resp.choices[0].logprobs` 取出返回里的概率信息。返回的结构 Day 122 逐字段讲。
- `assert logprobs is not None and logprobs.content` SDK 把这个字段标成「可能是 None」,不先排除掉,编辑器会画红线。`assert` 条件不成立就直接报错停下,相当于 JS 里 `if (!x) throw new Error()`。
- `first = logprobs.content[0]` 第一个(也是唯一一个)输出位置。
- `dist = {c.token: round(math.exp(c.logprob), 4) for c in first.top_logprobs}` 字典推导式([Day 23](/blog/agent-zero/day-023-comprehensions/) 的推导式写法用在字典上),把每个候选的 logprob 换回普通概率。`math.exp` 相当于 JS 的 `Math.exp`。实跑第一项:`'简': 0.321`。
- `print(f"{token!r:8} {p:.4f}")` `!r` 表示用 `repr()` 显示,字符串会带上引号,这样空格、换行这种看不见的 token 也能看清;`:8` 是占 8 格对齐。
- `print("这次抽中的是:", repr(first.token))` 服务端真正采样出来的那个 token。
- `Path("data/next_token_dist.json").write_text(` 把概率表存成 JSON 文件,后面所有脚本都读它,不用再调 API。`ensure_ascii=False` 让中文原样写进文件,不变成 `简` 这种转义([Day 39](/blog/agent-zero/day-039-json/) 讲过)。

</div>

我的实跑输出:

```text
'简'      0.3210
'轻'      0.3129
'账'      0.1913
'易'      0.0882
'云'      0.0456
'随手'     0.0263
'金'      0.0059
'慧'      0.0019
'智'      0.0012
'优'      0.0006
前 10 个加起来: 0.9949
这次抽中的是: '易'
```

这就是 Day 106 说的那张「下一个 token 的概率表」的真身。模型认为名字最可能以「简」开头(32.1%),「轻」几乎一样可能(31.3%),然后是「账」「易」「云」,再往后的「慧」「智」「优」都不到千分之二。前 10 名加起来 99.49%,剩下 0.51% 分散在词表里另外十几万个 token 上。

注意最后一行:这一次服务端抽中的是「易」,排第四,只有 8.8% 的可能。模型并没有选概率最高的那个。**模型只负责给出概率表,选哪个是另一个步骤**,这个步骤就叫采样(sampling)。今天整节课就讲这一步。

### logprob 是什么

API 返回的不是概率,是**对数概率(logprob)**,也就是概率取自然对数。`0.321` 的对数是 `-1.136`,`0.0006` 的对数是 `-7.42`。概率越接近 1,logprob 越接近 0;概率越小,logprob 越负。为什么不直接给概率?因为长尾候选的概率可能小到 0.0000001,用对数表示既不丢精度,算起来也方便(下面实现 temperature 就要用到它)。换回概率只要 `math.exp(logprob)`,就是上面代码里那一步。

因为你还没有 key,请在 `agent-zero-lab/data/` 下手动新建 `next_token_dist.json`,把我跑出来的内容粘进去(这是数据,不是代码,可以复制):

```json
{
  "简": 0.321,
  "轻": 0.3129,
  "账": 0.1913,
  "易": 0.0882,
  "云": 0.0456,
  "随手": 0.0263,
  "金": 0.0059,
  "慧": 0.0019,
  "智": 0.0012,
  "优": 0.0006
}
```

今天后面所有脚本都只读这个文件,完全离线,不花钱。

## 按概率掷骰子

「按概率挑一个」到底是什么意思?想象一个十面骰子,但每一面的大小不一样:「简」那一面占 32.1% 的面积,「优」那一面只有 0.06%。每掷一次,落到哪一面就输出哪个 token。大面更容易被掷到,小面不是不可能,只是很少。

Python 标准库 `random` 里的 `random.choices` 干的就是这件事。JS 没有现成的对应函数,你通常得自己写:先 `Math.random()` 生成一个 0 到 1 的数,再沿着累计概率找它落在哪一格。Python 帮你包好了。

新建 `part02/dice.py`(在 `agent-zero-lab` 目录下):

```python
# agent-zero-lab/part02/dice.py
import json
import random
from collections import Counter
from pathlib import Path

dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))
tokens = list(dist.keys())
weights = list(dist.values())

print("抽 10 次:", random.choices(tokens, weights=weights, k=10))

N = 1000
counts = Counter(random.choices(tokens, weights=weights, k=N))
for token in tokens:
    print(f"{token!r:6} 概率 {dist[token]:.3f}  抽中 {counts[token]:>3} 次  占 {counts[token] / N:.3f}")
```

<div class="line-notes">

- `import random` 标准库的随机数模块,不用 `uv add`。`random.random()` 相当于 JS 的 `Math.random()`。
- `from collections import Counter` [Day 107](/blog/agent-zero/day-107-tokens-1/) 用过的计数字典,没出现过的键默认是 0。
- `dist: dict[str, float] = json.loads(` 读出刚才那个 JSON,得到 `{"简": 0.321, "轻": 0.3129, ...}`。类型标注写上 `dict[str, float]`,编辑器就知道里面是「字符串 → 小数」。
- `tokens = list(dist.keys())` 所有候选:`['简', '轻', '账', '易', '云', '随手', '金', '慧', '智', '优']`。字典在 Python 3.7 以后保持插入顺序,和 JS 对象的字符串键一样。
- `weights = list(dist.values())` 对应的权重:`[0.321, 0.3129, ...]`,顺序和 `tokens` 一一对应。
- `print("抽 10 次:", random.choices(tokens, weights=weights, k=10))` `choices` 是复数,按权重**有放回**地抽 `k` 次,返回一个列表。权重不需要加起来等于 1,它会自己按比例换算,所以 0.9949 也没关系。
- `N = 1000` 掷一千次,次数多了频率才稳定。
- `counts = Counter(random.choices(tokens, weights=weights, k=N))` 一次抽 1000 个,直接丢进 `Counter` 数每个 token 出现几次。实跑「简」334 次。
- `for token in tokens:` 按概率表的顺序打印,方便对照。
- `print(f"{token!r:6} 概率 {dist[token]:.3f}  抽中 {counts[token]:>3} 次` `:>3` 是右对齐占 3 格。`counts[token] / N` 是频率,「简」是 334 ÷ 1000 = 0.334,和概率 0.321 差一点点,这就是随机。

</div>

```bash
uv run part02/dice.py
```

实跑输出(你的每一行数字会不一样,下面马上解释):

```text
抽 10 次: ['金', '随手', '金', '账', '简', '账', '简', '轻', '轻', '轻']
'简'    概率 0.321  抽中 334 次  占 0.334
'轻'    概率 0.313  抽中 326 次  占 0.326
'账'    概率 0.191  抽中 173 次  占 0.173
'易'    概率 0.088  抽中  91 次  占 0.091
'云'    概率 0.046  抽中  37 次  占 0.037
'随手'   概率 0.026  抽中  27 次  占 0.027
'金'    概率 0.006  抽中   9 次  占 0.009
'慧'    概率 0.002  抽中   2 次  占 0.002
'智'    概率 0.001  抽中   0 次  占 0.000
'优'    概率 0.001  抽中   1 次  占 0.001
```

先看下面那张表:掷一千次,每个 token 的出现频率和它的概率非常接近,「简」0.334 对 0.321,「账」0.173 对 0.191。这就是「按概率采样」的意思,概率表决定了长期来看谁出现得多。

再看第一行,只抽 10 次就很「不讲道理」:概率只有 0.6% 的「金」居然出现了两次。这不是代码错了,是真实的运气。把这件事放到大模型身上想:一段 300 个 token 的回答要连续掷 300 次骰子,每一次都有一点机会掷到冷门的面,而且一旦掷到,后面的 token 都会接着这个冷门开头往下写(Day 106 的自回归)。同一个问题问两次答案不一样,根子就在这里。

你再跑一遍 `dice.py`,数字会变。这是因为每次运行 `random` 用的「起点」都不同。怎么让它每次一样,是 [Day 112](/blog/agent-zero/day-112-sampling-2/) 的内容。

## temperature:把概率表压尖或者拍平

现在问题来了:如果我想让模型更「保守」,尽量只说最可能的那个;或者更「放飞」,多给冷门候选一点机会,该怎么办?总不能去改模型本身。办法是在掷骰子**之前**,先把概率表变个形。temperature 就是这个变形的旋钮。

规则一句话就能说清:**temperature 小于 1,大的更大、小的更小,概率表变尖;temperature 大于 1,差距被缩小,概率表变平;等于 1,原样不动。**

它具体怎么算?分三步,我们直接用今天的真实数据走一遍,以「简」(0.321)和「金」(0.0059)两个为例,temperature 取 0.5:

1. 先取对数,变回 logprob:`log(0.321) = -1.136`,`log(0.0059) = -5.133`。这一步其实就是把 API 给的 logprob 还原回来。
2. 每个数除以 temperature:`-1.136 ÷ 0.5 = -2.273`,`-5.133 ÷ 0.5 = -10.27`。除以一个小于 1 的数,负数会变得更负,而且越负的变得越多,两者的差距从 4 个单位拉大到 8 个。
3. 用 `exp` 变回正数,再除以总和,让所有候选加起来重新等于 1。这一步叫 **softmax**:把一组任意大小的分数变成一组加起来为 1 的概率。

所以 temperature 本质上是「先把差距按比例放大或缩小,再重新归一」。真实的模型内部,第一步之前的那组分数叫 **logit**(模型最后一层直接吐出来的原始分数,还没变成概率),服务端是拿 logit 除以 temperature 再做 softmax 的。我们手上只有概率,取对数得到的数和 logit 只差一个对所有候选都相同的常数,而 softmax 对「所有分数同时加减同一个数」不敏感,所以结果完全一样。

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="采样流水线:模型给出分数,除以 temperature,softmax 变成概率,按概率抽一个 token">
<rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="40" width="110" height="50" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="71" y="62" text-anchor="middle" fill="var(--ink)">模型</text>
<text x="71" y="80" text-anchor="middle" fill="var(--ink-soft)">给每个候选打分</text>
<line x1="126" y1="65" x2="160" y2="65" stroke="var(--ink-soft)"/>
<rect x="160" y="40" width="130" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="225" y="62" text-anchor="middle" fill="var(--ink)">÷ temperature</text>
<text x="225" y="80" text-anchor="middle" fill="var(--ink-soft)">放大或缩小差距</text>
<line x1="290" y1="65" x2="324" y2="65" stroke="var(--ink-soft)"/>
<rect x="324" y="40" width="130" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="389" y="62" text-anchor="middle" fill="var(--ink)">softmax</text>
<text x="389" y="80" text-anchor="middle" fill="var(--ink-soft)">变成加起来=1</text>
<line x1="454" y1="65" x2="488" y2="65" stroke="var(--ink-soft)"/>
<rect x="488" y="40" width="136" height="50" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="556" y="62" text-anchor="middle" fill="var(--ink)">按概率掷骰子</text>
<text x="556" y="80" text-anchor="middle" fill="var(--ink-soft)">输出一个 token</text>
<text x="16" y="124" fill="var(--ink-faint)">蓝 = 模型本身,每次都一样;琥珀 = 采样,发生在模型之外,由你传的参数控制</text>
<text x="16" y="146" fill="var(--ink-faint)">输出的 token 接回输入末尾,下一步再走一遍这条线(Day 106 的自回归)</text>
</g>
</svg>
<figcaption>一个 token 是怎么从模型里出来的。temperature 不改模型,只改掷骰子之前的那张概率表。</figcaption>
</figure>

### 用代码实现

新建 `part02/temperature_math.py`:

```python
# agent-zero-lab/part02/temperature_math.py
import json
import math
from pathlib import Path


def apply_temperature(dist: dict[str, float], t: float) -> dict[str, float]:
    scores = {tok: math.log(p) / t for tok, p in dist.items()}
    exps = {tok: math.exp(s) for tok, s in scores.items()}
    total = sum(exps.values())
    return {tok: e / total for tok, e in exps.items()}


if __name__ == "__main__":
    dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))
    show = ["简", "轻", "账", "易", "云", "随手", "金"]
    print("温度   " + "  ".join(f"{tok:>4}" for tok in show))
    for t in (0.2, 0.5, 1.0, 1.5, 2.0):
        new = apply_temperature(dist, t)
        print(f"{t:<5}" + "  ".join(f"{new[tok]:>5.3f}" for tok in show))
```

<div class="line-notes">

- `import math` 数学函数模块,`math.log` 是自然对数(JS 的 `Math.log`),`math.exp` 是 e 的几次方(JS 的 `Math.exp`)。
- `def apply_temperature(dist: dict[str, float], t: float) -> dict[str, float]:` 输入一张概率表和一个温度,输出变形后的新概率表。不改原来的字典,返回新的。
- `scores = {tok: math.log(p) / t for tok, p in dist.items()}` 第一步和第二步合在一起:取对数再除以温度。t=0.5 时「简」:`log(0.321) = -1.136`,除以 0.5 得 `-2.273`。
- `exps = {tok: math.exp(s) for tok, s in scores.items()}` 第三步前半:用 `exp` 变回正数。「简」:`exp(-2.273) = 0.103`,正好是 0.321 的平方。
- `total = sum(exps.values())` 所有候选加起来。t=0.5 时是 0.248 左右。
- `return {tok: e / total for tok, e in exps.items()}` 第三步后半:每个除以总和,重新归一。「简」:0.103 ÷ 0.248 = 0.415。这三行合起来就是 softmax。
- `if __name__ == "__main__":` [Day 32](/blog/agent-zero/day-032-modules/) 学过:只有直接运行这个文件时才执行下面的代码,被别的文件 `import` 时不执行。后面两个脚本会 import `apply_temperature`,不加这一行的话一 import 就会把整张表打印一遍。
- `show = ["简", "轻", "账", "易", "云", "随手", "金"]` 只看前 7 个,后面三个太小,打印出来全是 0.000。
- `print("温度   " + "  ".join(f"{tok:>4}" for tok in show))` 表头。`"  ".join(...)` 用两个空格把字符串拼起来,相当于 JS 的 `arr.join("  ")`,不过 Python 是「分隔符.join(列表)」,顺序反过来。
- `for t in (0.2, 0.5, 1.0, 1.5, 2.0):` 五档温度,DeepSeek 允许 0 到 2。
- `print(f"{t:<5}" + "  ".join(f"{new[tok]:>5.3f}" for tok in show))` 每档一行,每个概率保留 3 位小数。

</div>

```bash
uv run part02/temperature_math.py
```

实跑输出:

```text
温度      简     轻     账     易     云    随手     金
0.2  0.511  0.450  0.038  0.001  0.000  0.000  0.000
0.5  0.415  0.395  0.147  0.031  0.008  0.003  0.000
1.0  0.323  0.315  0.192  0.089  0.046  0.026  0.006
1.5  0.269  0.265  0.191  0.114  0.073  0.051  0.019
2.0  0.235  0.232  0.181  0.123  0.088  0.067  0.032
```

从上往下读每一列:

- t=1.0 那一行和原始概率几乎一样(「简」0.321 变成 0.323,是因为只在前 10 名里重新归一,把那 0.51% 的长尾分掉了)。所以 1.0 就是「原样」。
- 往上看,温度越低,「简」「轻」越来越大,后面的越来越小。到 0.2 时,「简」和「轻」两个加起来占了 96%,「易」只剩千分之一。
- 往下看,温度越高,大家越来越接近。到 2.0 时,「金」从 0.6% 涨到了 3.2%,翻了 5 倍多;「简」从 32% 掉到 23.5%。

有个反直觉的地方值得多看一眼:**t=0.2 时「简」和「轻」还是差不多一样大**(0.511 对 0.450)。温度能拉开「大」和「小」之间的差距,但两个本来就几乎打平的候选,压得再尖也还是差不多打平。记住这个现象,后面解释 temperature=0 时会用到。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="同一张概率表在 temperature 0.5、1.0、2.0 下的柱状图,温度越高越平">
<rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="11">
<text x="20" y="22" fill="var(--ink)">t = 0.5</text>
<text x="230" y="22" fill="var(--ink)">t = 1.0</text>
<text x="440" y="22" fill="var(--ink)">t = 2.0</text>
<line x1="20" y1="170" x2="202" y2="170" stroke="var(--rule)"/>
<line x1="230" y1="170" x2="412" y2="170" stroke="var(--rule)"/>
<line x1="440" y1="170" x2="622" y2="170" stroke="var(--rule)"/>
<rect x="22" y="87" width="20" height="83" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="48" y="91" width="20" height="79" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="74" y="141" width="20" height="29" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="100" y="164" width="20" height="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="126" y="168" width="20" height="2" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="152" y="169" width="20" height="1" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="178" y="170" width="20" height="0" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="232" y="105" width="20" height="65" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="258" y="107" width="20" height="63" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="284" y="132" width="20" height="38" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="310" y="152" width="20" height="18" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="336" y="161" width="20" height="9" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="362" y="165" width="20" height="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="388" y="169" width="20" height="1" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="442" y="123" width="20" height="47" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="468" y="124" width="20" height="46" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="494" y="134" width="20" height="36" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="520" y="145" width="20" height="25" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="546" y="152" width="20" height="18" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="572" y="157" width="20" height="13" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="598" y="164" width="20" height="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="32" y="186" text-anchor="middle" fill="var(--ink-soft)">简</text>
<text x="58" y="186" text-anchor="middle" fill="var(--ink-soft)">轻</text>
<text x="84" y="186" text-anchor="middle" fill="var(--ink-soft)">账</text>
<text x="110" y="186" text-anchor="middle" fill="var(--ink-soft)">易</text>
<text x="136" y="186" text-anchor="middle" fill="var(--ink-soft)">云</text>
<text x="162" y="186" text-anchor="middle" fill="var(--ink-soft)">随</text>
<text x="188" y="186" text-anchor="middle" fill="var(--ink-soft)">金</text>
<text x="242" y="186" text-anchor="middle" fill="var(--ink-soft)">简</text>
<text x="268" y="186" text-anchor="middle" fill="var(--ink-soft)">轻</text>
<text x="294" y="186" text-anchor="middle" fill="var(--ink-soft)">账</text>
<text x="320" y="186" text-anchor="middle" fill="var(--ink-soft)">易</text>
<text x="346" y="186" text-anchor="middle" fill="var(--ink-soft)">云</text>
<text x="372" y="186" text-anchor="middle" fill="var(--ink-soft)">随</text>
<text x="398" y="186" text-anchor="middle" fill="var(--ink-soft)">金</text>
<text x="452" y="186" text-anchor="middle" fill="var(--ink-soft)">简</text>
<text x="478" y="186" text-anchor="middle" fill="var(--ink-soft)">轻</text>
<text x="504" y="186" text-anchor="middle" fill="var(--ink-soft)">账</text>
<text x="530" y="186" text-anchor="middle" fill="var(--ink-soft)">易</text>
<text x="556" y="186" text-anchor="middle" fill="var(--ink-soft)">云</text>
<text x="582" y="186" text-anchor="middle" fill="var(--ink-soft)">随</text>
<text x="608" y="186" text-anchor="middle" fill="var(--ink-soft)">金</text>
<text x="20" y="208" fill="var(--ink-faint)">柱高 = temperature_math.py 实跑的概率(0.415 最高);「随」是「随手」</text>
</g>
</svg>
<figcaption>同一张概率表,左边压尖、右边拍平。模型没变,变的只是掷骰子前的那一步。</figcaption>
</figure>

### 和 API 对一对

我们自己写的公式,和 DeepSeek 服务端做的是不是一回事?我把 `peek_next_token.py` 原样再跑了两次,只把 `temperature=1.0` 分别改成 `0.5` 和 `2.0`(这段同样不用跑)。API 返回的 logprob 是**已经按 temperature 变形之后**的概率,正好拿来对答案:

| 候选 | API t=0.5 | 我们算的 t=0.5 | API t=2.0 | 我们算的 t=2.0 |
| --- | --- | --- | --- | --- |
| 简 | 0.4153 | 0.415 | 0.1818 | 0.235 |
| 轻 | 0.3946 | 0.395 | 0.1795 | 0.232 |
| 账 | 0.1474 | 0.147 | 0.1403 | 0.181 |
| 易 | 0.0313 | 0.031 | 0.0953 | 0.123 |
| 云 | 0.0084 | 0.008 | 0.0686 | 0.088 |
| 随手 | 0.0028 | 0.003 | 0.0520 | 0.067 |

t=0.5 那两列一模一样,说明服务端做的就是我们写的这件事。t=2.0 那两列却差了不少,我们算的普遍偏大。原因在我们只有前 10 名的数据:t=1 时,前 10 名之外那十几万个 token 加起来只占 0.51%,可以忽略;但温度拉到 2,长尾被抬起来,那十几万个小概率加起来就分走了相当大的一块。我们只在 10 个里面重新分配,自然每个都分多了。

这个差别本身就是一个重要结论:**temperature 调高,受益的不只是第 4、第 5 名,而是词表里成千上万个本来几乎不可能出现的 token**。其中大多数放在这里是不通顺的,比如名字开头冒出一个英文字母或者标点。temperature 太高时输出会「胡言乱语」,原因就在这。Day 112 的 top_p 就是专门对付这个长尾的。

## temperature=0:先踩一个坑

上面的表里没有 0。文档里常说「temperature 设成 0 就是每次选最大的那个」,那我们传 0 进去试试。新建 `part02/temperature_zero.py`:

```python
# agent-zero-lab/part02/temperature_zero.py
import json
from pathlib import Path

from temperature_math import apply_temperature

dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))
print(apply_temperature(dist, 0))
```

<div class="line-notes">

- `from temperature_math import apply_temperature` 从同一个目录下的 `temperature_math.py` 导入函数。用 `uv run part02/temperature_zero.py` 运行时,Python 会把脚本所在的 `part02/` 加进模块搜索路径,所以能直接按文件名导入。
- `print(apply_temperature(dist, 0))` 温度传 0。

</div>

```bash
uv run part02/temperature_zero.py
```

实跑报错(路径前缀我删短了):

```text
Traceback (most recent call last):
  File ".../agent-zero-lab/part02/temperature_zero.py", line 8, in <module>
    print(apply_temperature(dist, 0))
          ^^^^^^^^^^^^^^^^^^^^^^^^^^
  File ".../agent-zero-lab/part02/temperature_math.py", line 8, in apply_temperature
    scores = {tok: math.log(p) / t for tok, p in dist.items()}
                   ~~~~~~~~~~~~^~~
ZeroDivisionError: float division by zero
```

除以 0 了。[Day 35](/blog/agent-zero/day-035-exceptions-1/) 学过怎么读 Traceback:从下往上,最后一行是错误类型 `ZeroDivisionError`,上面一行指出是 `temperature_math.py` 第 8 行的 `/ t`。JS 里 `1 / 0` 会得到 `Infinity` 不报错,Python 的除零会直接抛异常,前端同学这里容易想当然。

数学上,温度越来越接近 0,差距被放大得越来越夸张,最后最大的那个占 100%,其他全是 0。所以「temperature=0」在所有实现里都是当成一个特殊情况处理的:不算公式,直接挑概率最大的那个。这种挑法有个名字叫**贪心解码(greedy decoding)**,每一步都只拿眼前最好的。

把它写进一个真正的采样函数里。新建 `part02/sampler.py`:

```python
# agent-zero-lab/part02/sampler.py
import json
import random
from collections import Counter
from pathlib import Path

from temperature_math import apply_temperature


def sample(dist: dict[str, float], t: float) -> str:
    if t == 0:
        return max(dist, key=lambda tok: dist[tok])
    new = apply_temperature(dist, t)
    return random.choices(list(new.keys()), weights=list(new.values()))[0]


if __name__ == "__main__":
    dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))
    for t in (0, 0.5, 1.0, 2.0):
        counts = Counter(sample(dist, t) for _ in range(1000))
        print(f"t={t}: {len(counts)} 种开头, 最多的 {counts.most_common(3)}")
```

<div class="line-notes">

- `def sample(dist: dict[str, float], t: float) -> str:` 给一张概率表和温度,返回抽中的一个 token。这就是服务端每生成一个 token 都要做一次的那件事。
- `if t == 0:` 温度为 0 单独处理,避开除零。
- `return max(dist, key=lambda tok: dist[tok])` `max` 遍历字典的键,用 `key` 指定「按什么比大小」,这里按概率。`lambda tok: dist[tok]` 是 [Day 30](/blog/agent-zero/day-030-functions-3/) 的 lambda,相当于 JS 的 `tok => dist[tok]`。整行相当于 JS 的 `Object.keys(dist).reduce((a, b) => dist[a] >= dist[b] ? a : b)`。实跑返回 `'简'`。
- `new = apply_temperature(dist, t)` 其他温度先变形。
- `return random.choices(list(new.keys()), weights=list(new.values()))[0]` 不写 `k` 时默认抽 1 个,返回的仍然是列表,所以取 `[0]`。
- `for t in (0, 0.5, 1.0, 2.0):` 四档温度,每档掷 1000 次。
- `counts = Counter(sample(dist, t) for _ in range(1000))` 括号里是生成器表达式,和列表推导式一样的写法,只是不先建好整个列表。`_` 表示循环变量用不上。
- `print(f"t={t}: {len(counts)} 种开头, 最多的 {counts.most_common(3)}")` `len(counts)` 是出现过几种不同的 token;`most_common(3)` 是次数最多的前三。

</div>

```bash
uv run part02/sampler.py
```

实跑输出:

```text
t=0: 1 种开头, 最多的 [('简', 1000)]
t=0.5: 6 种开头, 最多的 [('简', 411), ('轻', 406), ('账', 140)]
t=1.0: 9 种开头, 最多的 [('简', 338), ('轻', 302), ('账', 181)]
t=2.0: 10 种开头, 最多的 [('简', 231), ('轻', 212), ('账', 161)]
```

温度从 0 到 2,一千次里出现的不同开头从 1 种涨到 10 种,10 个候选全被抽到过。t=0 时一千次全是「简」,我们自己写的程序是完全确定的。

## 真模型上跑一遍

最后看 temperature 在真实 API 上的效果。这是大纲里的 `temperature.py`:同一个起名字的问题,四档温度各问 8 次,数一数出了几种不同的名字。**这段你现在不用跑,看我的结果**。

```python
# agent-zero-lab/part02/temperature.py
import os
from collections import Counter

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])

PROMPT = "给一家在线记账软件公司起一个中文名字,只输出名字本身,不要解释。"

for t in (0.0, 1.0, 1.5, 2.0):
    names: list[str] = []
    for _ in range(8):
        resp = client.chat.completions.create(
            model="deepseek-flash",
            messages=[{"role": "user", "content": PROMPT}],
            temperature=t,
            max_tokens=20,
            extra_body={"thinking": {"type": "disabled"}},
        )
        names.append((resp.choices[0].message.content or "").strip())
    print(f"temperature={t}: {len(set(names))} 种 -> {Counter(names).most_common()}")
```

<div class="line-notes">

- `PROMPT = "给一家在线记账软件公司起一个中文名字` 和 `peek_next_token.py` 同一个问题,所以第一个 token 的概率表就是我们今天一直在用的那张。
- `for t in (0.0, 1.0, 1.5, 2.0):` 外层四档温度。
- `names: list[str] = []` 每档开始前清空,只装这一档的 8 个名字。
- `for _ in range(8):` 同一个问题问 8 次。
- `temperature=t,` 这一档的温度。
- `max_tokens=20,` 名字很短,20 个 token 够了,也防止它不听话写一大段解释。
- `extra_body={"thinking": {"type": "disabled"}},` 关思考模式,不关的话 temperature 不生效。
- `names.append((resp.choices[0].message.content or "").strip())` 取出回答文本。SDK 把 `content` 标成「可能是 None」,`or ""` 把 None 换成空字符串;`.strip()` 去掉前后空白,不然 `"轻账"` 和 `"轻账\n"` 会被当成两个名字。
- `print(f"temperature={t}: {len(set(names))} 种 -> {Counter(names).most_common()}")` `set(names)` 去重([Day 25](/blog/agent-zero/day-025-sets/) 的集合)后的个数就是「几种不同的名字」。

</div>

我的实跑输出:

```text
temperature=0.0: 2 种 -> [('轻账', 4), ('简账', 4)]
temperature=1.0: 5 种 -> [('简账', 3), ('简账通', 2), ('账小满', 1), ('易账通', 1), ('云账通', 1)]
temperature=1.5: 6 种 -> [('轻账', 3), ('米账', 1), ('简账', 1), ('账房通', 1), ('云账房', 1), ('账途', 1)]
temperature=2.0: 7 种 -> [('轻账', 2), ('拾记账', 1), ('账准通', 1), ('简约记账', 1), ('账簿通', 1), ('易账通', 1), ('简账', 1)]
```

8 次里的不同名字,随温度从 2 种涨到 7 种,和我们本地模拟的趋势一致。到 2.0 时开始出现「拾记账」「账准通」这种有点怪的名字。

最值得看的是第一行:**temperature=0,8 次居然出了两种答案,「轻账」4 次、「简账」4 次。** 按刚才的说法,0 应该是贪心、每次一样才对。还记得上面那个现象吗:「简」和「轻」的概率几乎打平(0.321 对 0.313)。贪心解码要选「最大的那个」,当两个候选只差不到 1% 时,服务端计算里一点点微小的数值波动就足以让第一名换人。我们本地的概率表是写死在文件里的,当然每次一样;服务端的那张表每次都是重新算出来的,而它并不保证每次算得一模一样。这件事背后的原因和应对办法,Day 112 专门讲。今天先记住结论:**temperature=0 只是「尽量确定」,不是「保证一样」**。

## 那 temperature 该怎么设

回到写 Agent 的实际问题。先看一个和起名字完全相反的任务:工单分类。我用同样的办法看了「把『我的发票被重复扣款了』分到计费、技术、账号之一」时第一个 token 的概率表(t=1.0),前三名的 logprob 是:「计」-0.00001、「账号」-12.87、「技术」-17.13。换成概率,「计」是 99.9997%,第二名「账号」只有百万分之三。这种概率表叫「尖」的分布,模型非常有把握。动手练习 1 会算给你看:就算把温度拉到 2,「计」也还有 99.8%。

这就是 temperature 的第二个关键直觉:**它的效果取决于概率表本来的形状**。模型很有把握的地方(分类、抽字段、调哪个工具),温度高一点影响不大;模型本来就犹豫的地方(起名字、写文案),温度一变,输出就天差地别。但「影响不大」不等于没有影响:Agent 一次任务要做几十上百次这样的决定,每次 0.2% 的意外,乘起来就不小了。

DeepSeek 文档的[参数设置页](https://api-docs.deepseek.com/zh-cn/quick_start/parameter_settings)给了一张建议表(2026 年 10 月查到,默认值 1.0):

| 场景 | 建议 temperature |
| --- | --- |
| 代码生成 / 数学解题 | 0.0 |
| 数据抽取 / 分析 | 1.0 |
| 通用对话 | 1.3 |
| 翻译 | 1.3 |
| 创意类写作 / 诗歌创作 | 1.5 |

这张表是 DeepSeek 针对自家模型的建议,别的厂商的「1.0」不一定是同一个手感,换模型时要重新试。我自己写 Agent 时的做法是:分类、抽字段、决定调哪个工具这种「有标准答案」的步骤,温度设低(0 到 0.3 之间,DeepSeek 上我直接用 0),追求稳定;给用户写回复、起草邮件这种步骤,用默认值或者文档建议的值;真要多样性的(一次生成 5 个候选标题让人挑),才往上调。

还有两条容易忽略的事实:

- **DeepSeek 默认开着思考模式,思考模式下 temperature 不生效**(文档原文「思考模式下不生效」)。你传了 0 却发现输出还是在变,先检查是不是忘了关思考。思考模式是什么,[Day 115](/blog/agent-zero/day-115-reasoning-models/) 讲。
- temperature 影响的是**每一步**的采样,不是只影响开头。一段 300 字的回答,每个 token 都走一遍今天这条流水线。

## 动手练习

**练习 1:尖的概率表,温度管不管用。** 用正文里那张工单分类的概率表(logprob:「计」-0.00001、「账号」-12.8748、「技术」-17.1276),先换回概率,再用 `apply_temperature` 算出 t=0.5、1.0、2.0、5.0 时三个候选各自的概率,保留 6 位小数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/classify_temp.py
import math

from temperature_math import apply_temperature

LOGPROBS = {"计": -0.00001, "账号": -12.8748, "技术": -17.1276}
dist = {tok: math.exp(lp) for tok, lp in LOGPROBS.items()}

for t in (0.5, 1.0, 2.0, 5.0):
    new = apply_temperature(dist, t)
    print(f"t={t}: " + ", ".join(f"{tok} {p:.6f}" for tok, p in new.items()))
```

<div class="line-notes">

- `from temperature_math import apply_temperature` 复用正文写好的函数,这就是加 `if __name__ == "__main__":` 的好处,import 时不会把那张表打印出来。
- `LOGPROBS = {"计": -0.00001, "账号": -12.8748, "技术": -17.1276}` API 返回的是 `-0.0000`(四舍五入后),这里写成 `-0.00001`,意思一样。只取了前三名,所以下面的概率是在这三个里面重新分配的。
- `dist = {tok: math.exp(lp) for tok, lp in LOGPROBS.items()}` 换回概率:`exp(-12.8748) ≈ 0.0000026`。
- `for t in (0.5, 1.0, 2.0, 5.0):` 5.0 已经超出 DeepSeek 允许的范围(最大 2),这里只是在本地看个极端。
- `print(f"t={t}: " + ", ".join(f"{tok} {p:.6f}" for tok, p in new.items()))` 实跑 t=2.0:「账号」0.001598,是 t=1.0 时 0.000003 的五百多倍,但绝对值仍然只有千分之 1.6。

</div>

```bash
uv run part02/classify_temp.py
```

```text
t=0.5: 计 1.000000, 账号 0.000000, 技术 0.000000
t=1.0: 计 0.999997, 账号 0.000003, 技术 0.000000
t=2.0: 计 0.998212, 账号 0.001598, 技术 0.000191
t=5.0: 计 0.901966, 账号 0.068691, 技术 0.029343
```

温度在 DeepSeek 允许的 0 到 2 之间,「计」始终在 99.8% 以上;要拉到 5 才掉到 90%。模型有把握的问题,温度几乎改不了结果。但 t=2.0 的 0.18% 也意味着大约每 560 张工单会有一张分错到「账号」,批量跑几万张时就是上百张,所以分类步骤还是该设低温。

</details>

**练习 2:t=0.5 就是「平方再归一」。** 正文说 t=0.5 时「简」的 `exp(-2.273)` 正好是 0.321 的平方。不用 `log` 和 `exp`,只用「每个概率平方,再除以总和」算一遍 t=0.5 的概率表,和 `apply_temperature(dist, 0.5)` 比较,打印「简」「轻」「账」「易」两种算法的结果和所有候选里的最大差距。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/square_check.py
import json
from pathlib import Path

from temperature_math import apply_temperature

dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))

by_formula = apply_temperature(dist, 0.5)
squares = {tok: p * p for tok, p in dist.items()}
total = sum(squares.values())
by_square = {tok: s / total for tok, s in squares.items()}

for tok in ["简", "轻", "账", "易"]:
    print(f"{tok}: 公式 {by_formula[tok]:.6f}  平方再归一 {by_square[tok]:.6f}")
print("最大差距:", max(abs(by_formula[t] - by_square[t]) for t in dist))
```

<div class="line-notes">

- `by_formula = apply_temperature(dist, 0.5)` 用正文的公式算。
- `squares = {tok: p * p for tok, p in dist.items()}` 每个概率平方:「简」0.321 × 0.321 = 0.103。
- `by_square = {tok: s / total for tok, s in squares.items()}` 除以总和归一。
- `print("最大差距:", max(abs(by_formula[t] - by_square[t]) for t in dist))` `abs` 是绝对值(JS 的 `Math.abs`)。实跑 `1.1102230246251565e-16`,也就是 0.0000000000000001 量级,这是浮点数的舍入误差([Day 12](/blog/agent-zero/day-012-numbers/) 的 0.1+0.2),可以当成完全相等。

</div>

```bash
uv run part02/square_check.py
```

```text
简: 公式 0.415264  平方再归一 0.415264
轻: 公式 0.394571  平方再归一 0.394571
账: 公式 0.147484  平方再归一 0.147484
易: 公式 0.031351  平方再归一 0.031351
最大差距: 1.1102230246251565e-16
```

两种算法完全一样。推广一下:温度为 t,就是把每个概率变成它的 1/t 次方再归一。t=0.5 是平方,t=2 是开平方。平方会让大的更占优(0.3 的平方是 0.09,0.03 的平方是 0.0009,差距从 10 倍变成 100 倍),开方则把差距缩小。这比记公式好懂得多。

</details>

**练习 3:低温也打不破的平局。** 把 `sampler.py` 改成只看 t=0.1、0.2、0.3 三档,每档掷 1000 次,把所有出现过的 token 和次数都打印出来(另存为 `part02/sampler_low.py`)。观察「简」和「轻」的比例,解释为什么这能说明 API 在 t=0 时出两种名字。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/sampler_low.py
import json
from collections import Counter
from pathlib import Path

from sampler import sample

dist: dict[str, float] = json.loads(Path("data/next_token_dist.json").read_text(encoding="utf-8"))
for t in (0.1, 0.2, 0.3):
    counts = Counter(sample(dist, t) for _ in range(1000))
    print(f"t={t}: {counts.most_common()}")
```

<div class="line-notes">

- `from sampler import sample` 复用正文的 `sample` 函数。`sampler.py` 里也有 `if __name__ == "__main__":`,所以导入时不会把那四行打印出来。
- `for t in (0.1, 0.2, 0.3):` 三档都很低。
- `print(f"t={t}: {counts.most_common()}")` 不传数字就是全部按次数排好。

</div>

```bash
uv run part02/sampler_low.py
```

```text
t=0.1: [('简', 542), ('轻', 452), ('账', 6)]
t=0.2: [('简', 512), ('轻', 454), ('账', 34)]
t=0.3: [('简', 503), ('轻', 428), ('账', 62), ('易', 6), ('云', 1)]
```

温度低到 0.1,「账」及以后几乎消失了,但「简」和「轻」仍然是五五开左右。因为 t=0.1 是把概率变成 10 次方再归一,0.321 和 0.313 的 10 次方之比是 (0.321/0.313)^10 ≈ 1.29,还是差不多大。两个几乎打平的候选,任何温度都分不出明显的胜负;到了 t=0 这个极限,只要服务端算出来的两个概率谁稍微大一点点,就全选谁。服务端每次算的结果有细微差别,于是有时是「简」有时是「轻」,正好对上 API 那 8 次里「轻账」4 次、「简账」4 次。

</details>

**练习 4:给 Agent 的每一步定温度。** 一个客服 Agent 有下面 5 个步骤,用 DeepSeek,给每一步定一个 temperature 并说出理由:①判断工单属于计费、技术还是账号;②从工单里抽出发票号;③决定要不要调用「查发票」工具;④给用户写一段道歉回复;⑤为同一个问题生成 3 种不同语气的回复让人工挑。

<details><summary>参考答案</summary>

这是开放题,下面是一种合理的设法:

| 步骤 | temperature | 理由 |
| --- | --- | --- |
| ① 分类 | 0 | 有标准答案,同一张工单今天分到计费、明天分到账号是 bug |
| ② 抽发票号 | 0 | 抽错一位就查不到,只要最可能的那个 |
| ③ 是否调工具 | 0 | Agent 的「方向盘」,随机性会让同一个请求时而查、时而不查,很难排查 |
| ④ 道歉回复 | 1.0 到 1.3 | 要自然,不需要每次一字不差;DeepSeek 建议通用对话 1.3 |
| ⑤ 3 种语气 | 1.3 到 1.5 | 要的就是不一样,温度太低三条会几乎相同 |

示范对比:正文 `temperature.py` 的实跑就是 ⑤ 的情况,t=0 时 8 次只有 2 种名字,t=1.5 时有 6 种。如果你在 ⑤ 用了 0,让人挑的 3 条回复很可能有两条一字不差。再补一句:①②③ 设 0 也不代表万无一失,上面 t=0 出两种名字就是证据,所以分类结果还要有校验和评测(第六部分讲),不能只靠温度。记得这些步骤都要关掉思考模式,temperature 才生效。

</details>

**验收标准:** `dice.py`、`temperature_math.py`、`sampler.py` 跑通,`temperature_math.py` 的输出和文章一字不差(它不含随机);`temperature_zero.py` 能复现 `ZeroDivisionError`,并能说出为什么 t=0 要单独处理;能用「1/t 次方再归一」解释 temperature;能解释 API 在 t=0 时为什么出了两种名字。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 概率分布 / 概率表 | 模型每一步对「下一个 token 是谁」给出的一组概率,所有候选加起来等于 1。今天的例子里「简」0.321、「轻」0.313 |
| 采样(sampling) | 按概率表随机挑一个 token 输出。大概率的更常被挑中,小概率的偶尔也会被挑中 |
| logprob(对数概率) | 概率取自然对数。0.321 的 logprob 是 -1.136;越接近 0 越可能,越负越不可能。`math.exp(logprob)` 换回概率 |
| top_logprobs | API 参数,让返回里附上每个位置概率最高的前 N 个候选,DeepSeek 最多 20 |
| logit | 模型最后一层给每个候选打的原始分数,还没变成概率 |
| softmax | 把一组任意分数变成加起来为 1 的概率:每个取 exp,再除以总和 |
| temperature(温度) | 采样前给概率表变形的参数。小于 1 变尖、大于 1 变平、等于 1 不变;效果等于每个概率取 1/t 次方再归一。DeepSeek 允许 0 到 2,默认 1 |
| 贪心解码(greedy decoding) | 每一步都直接选概率最大的 token,不随机。temperature=0 就是这么处理的 |
| `random.choices` | Python 标准库函数,按权重有放回地抽 k 个,返回列表 |
| ZeroDivisionError | Python 除以 0 时抛出的异常。JS 的 `1/0` 得到 `Infinity`,Python 直接报错 |

## 常见误区

**以为模型「决定」了输出哪个字。** 模型只给出概率表,选哪个是采样这一步做的,而且是随机的。实跑里服务端抽中了只有 8.8% 的「易」。

**以为 temperature=0 就保证每次一样。** 实跑 t=0 问 8 次出了「轻账」「简账」两种。两个候选几乎打平时,服务端一点微小的数值差别就能让第一名换人。Day 112 讲原因。

**传了 temperature 发现没效果,以为是模型的问题。** DeepSeek 默认开思考模式,文档写明思考模式下 temperature 不生效。要用 temperature 就带上 `extra_body={"thinking": {"type": "disabled"}}`。

**以为调高温度只是让第二、第三名多出现一点。** 温度高了,词表里成千上万个原本几乎不可能的 token 都被抬起来。我们只用前 10 名算 t=2.0,结果和 API 差了一截,差的那部分就是被长尾分走的。温度太高会胡言乱语,原因在这。

**自己实现 temperature 时直接 `/ t`,不处理 0。** 实跑报 `ZeroDivisionError: float division by zero`。t=0 要单独走「选最大的」分支。

**分类任务用默认温度,觉得反正模型很有把握。** 尖的分布在 t=2 时仍有 0.18% 会选错,批量跑几万张就是上百张错。有标准答案的步骤用低温。

## 学习资料

### 文档与文章

- [DeepSeek API:对话补全](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion):`temperature`、`logprobs`、`top_logprobs`、`thinking` 几个参数的原文说明都在这页,重点看「思考模式下不生效」那几句。10 分钟。
- [DeepSeek:Temperature 设置](https://api-docs.deepseek.com/zh-cn/quick_start/parameter_settings):正文那张场景建议表的出处,很短。
- [Python 文档:random 模块](https://docs.python.org/zh-cn/3.12/library/random.html):中文,只看 `random.choices` 那一条和开头的说明。
- [Python 文档:math 模块](https://docs.python.org/zh-cn/3.12/library/math.html):中文,查 `math.exp` 和 `math.log`。
- [Hugging Face:How to generate text](https://huggingface.co/blog/how-to-generate):英文,讲开源模型生成文本时的几种解码方式,今天先看 greedy search 和 sampling 两节,配图很清楚。剩下的 top-k、top-p 留到 Day 112。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1taSFBNEG4&autoplay=0&high_quality=1" title="Temperature & Top-p:掌控大模型的创造力开关" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>马克的技术工作坊 · Temperature & Top-p:掌控大模型的创造力开关 · 17 分钟,今天看前半段 temperature 的部分,top-p 留到 Day 112 再看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1xm421g7f8&autoplay=0&high_quality=1" title="使用大模型时可调节的温度指的是什么?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI老兵文哲 · 使用大模型时可调节的温度指的是什么? · 10 分钟,换一个人再讲一遍温度的直觉,和正文的柱状图对照着看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/wjZofJX0v4M" title="Transformers, the tech behind LLMs | Deep Learning Chapter 5" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · Transformers, the tech behind LLMs · 英文(B 站有中文字幕搬运,按标题搜索)。今天只看最后讲 softmax 和 temperature 的那一段(视频后四分之一),动画把「除以温度再 softmax」画得很直观。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》(Chip Huyen 著,O'Reilly,2025,目前只查到英文原版):第 2 章「Understanding Foundation Models」里的「Sampling」一节,讲 temperature、logprobs,以及为什么采样让模型的输出不稳定,站在应用工程师的角度写的。
- 《图解大模型:生成式 AI 原理与实战》(Jay Alammar、Maarten Grootendorst 著,人民邮电出版社,2025;英文原版《Hands-On Large Language Models》,O'Reilly,2024):讲提示词那一章开头有一节讲控制模型输出的参数,图很多,适合 0 基础。

### 开源项目与代码

- [karpathy/nanoGPT](https://github.com/karpathy/nanoGPT):一个几百行的 GPT 实现。`model.py` 里的 `generate` 函数只有十几行,你能在里面找到 `logits / temperature`、`softmax` 和按概率抽样三步,和今天写的 `sample` 一一对应。今天只找这几行,不用看懂其余部分。
- [Transformer Explainer](https://poloclub.github.io/transformer-explainer/):浏览器里跑一个小 GPT-2,右上角有 temperature 滑块,拖动时能实时看到下一个 token 的概率柱状图变尖变平。玩 10 分钟比读三页文字有用。

## 自测

1. 模型给出的概率表里「简」0.321、「易」0.088,结果输出了「易」。这是模型出错了吗?

<details><summary>答案</summary>

不是。模型只负责给出概率表,输出哪个由采样决定,而采样是按概率随机挑的。「易」有 8.8% 的机会被挑中,掷 100 次大约会出现 9 次。只有在 temperature=0(贪心)时才总是选最大的。

</details>

2. temperature 从 1.0 调到 0.5,概率表怎么变?用「几次方」的说法解释。

<details><summary>答案</summary>

变尖:每个概率变成它的 1/0.5 = 2 次方,再归一。大的概率平方后相对更大,小的相对更小。实跑「简」从 0.323 变成 0.415,「金」从 0.006 变成几乎 0。

</details>

3. 自己实现 `apply_temperature` 时传 0 会怎样?正确的处理是什么?

<details><summary>答案</summary>

`math.log(p) / 0` 会抛 `ZeroDivisionError: float division by zero`。t=0 不走公式,直接选概率最大的 token,即贪心解码:`max(dist, key=lambda tok: dist[tok])`。

</details>

4. 同样把 temperature 从 1 调到 2,为什么起名字的输出变化很大,工单分类的输出几乎不变?

<details><summary>答案</summary>

temperature 的效果取决于概率表原本的形状。起名字时前几名本来就接近(0.32、0.31、0.19),拍平后很多候选都有机会。工单分类时「计」是 99.9997%,第二名只有百万分之三,开平方再归一后「计」仍有 99.8%。

</details>

5. 面试题:「我们的工单分类 Agent 已经把 temperature 设成 0 了,为什么同一张工单偶尔还是分到不同的类?」你怎么回答,怎么排查?

<details><summary>答案</summary>

先查两件事:一是有没有真的生效,比如用的是推理模型或开了思考模式,很多厂商在这种模式下忽略 temperature(DeepSeek 文档明确写了不生效);二是这张工单在模型眼里是不是本来就模棱两可,前两名概率几乎打平,用 logprobs 把第一个 token 的前几名概率打出来就能看到。打平时,temperature=0 也挡不住服务端的细微数值差别让第一名换人。解决思路:把类别定义写清楚、给示例,让分布变尖;对低置信度的结果走人工或多次投票;在评测里允许并统计这种波动,而不是假设输出完全确定。

</details>

## 明天预告

Day 111 · 第 16 周复习:大模型与 API(Day 105–110)。这一周从「模型只做一件事」走到 token、窗口和今天的采样,概念多、数字也多。明天不讲新东西,把这一周画成一张图,把 token 计数、截断和采样拼成一个小项目,再把这几天踩过的坑过一遍。
