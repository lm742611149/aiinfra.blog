---
title: 'Day 397 · 成本(二):prompt caching 原理和命中规矩'
description: 'Day 396 的长提示词实验里,2369 个输入 token 有 2176 个按 1/50 的价格收了钱。今天把这件事搞透:厂商缓存的是什么、为什么只认开头、改在哪里会让命中掉多少,再把工单 worker 的起草提示词按「不变的在前」重排,同一批 8 张工单的模型费从 1.39 分降到 0.30 分。'
pubDate: 2026-10-22
regime: none
tags: ['cost', 'prompt-caching', 'deepseek', 'agent-zero']
series: 'agent-zero'
day: 397
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 396](/blog/agent-zero/day-396-cost-1/) 给工单 worker 装上了记账:每次模型调用一返回就往 `logs/llm_usage.jsonl` 写一行,再用 `pricing.py` 的 `call_cost` 算钱。最后那个长提示词实验留了个尾巴:一份 120 条的客服规范,输入 2369 个 token,其中 2176 个「命中缓存」,一次起草按原价要 0.5 分,实际只花了 0.07 分。昨天只说了「同一个长开头,第一次原价,之后几乎免费」。今天把它拆开:缓存住的到底是什么,什么情况下会命中、什么情况下悄悄失效,怎么把我们的 worker 改成稳定命中。

## 今天要解决的问题

今天结束时你应该能:

1. 用一个不调模型的小模拟说清 prompt caching 为什么只认「开头一模一样」,以及为什么命中数总是一块一块的。
2. 在 DeepSeek 上实测五种改动(换工单、时间放末尾、时间放开头、规范中间改一个字、工具换顺序)分别让命中掉多少。
3. 记住四条命中规矩,并把 Day 394 工单 worker 的起草提示词改成「不变的在前、会变的在后」,用一个新报表 `cache_report.py` 看前后两批的命中率和花费。
4. 说出 DeepSeek、OpenAI、Anthropic 三家缓存做法的主要区别:谁自动、谁要标记、写缓存要不要加钱。

预计用时 2.5 小时。前置:[Day 117](/blog/agent-zero/day-117-moe-kvcache/) 的 KV cache、[Day 394](/blog/agent-zero/day-394-ticket-worker/) 的工单 worker、[Day 396](/blog/agent-zero/day-396-cost-1/) 的 `pricing.py`、`ask_metered` 和 usage 日志。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先从前端看:打包产物的 content hash

你一定见过这种文件名:`main.3f9a2c1e.js`。打包工具按文件内容算一个 hash 拼进文件名,CDN 和浏览器就可以放心地长期缓存它:内容一个字节不变,hash 就不变,缓存一直有效;改了一个字节,hash 全变,缓存作废,用户重新下载整个文件。

Prompt caching 的规矩和这个很像,只多了一个「前缀」的概念:厂商不是给整个请求算一个 hash,而是从第一个 token 开始一段一段往后算。前面 2000 个 token 和上次一样、第 2001 个开始不同,那前 2000 个照样能用缓存,后面的重新算。所以你改动的**位置**决定了损失多少:改在最后,几乎不损失;改在第一行,全部作废。

还有一个和前端缓存不一样的地方:浏览器缓存是你自己控制的,`Cache-Control` 写多久就是多久;厂商的 prompt cache 什么时候清、给不给命中,DeepSeek 的文档原话是「尽力而为,不保证 100% 缓存命中」。所以今天所有结论都要靠 usage 里的数去验证,不能想当然。

## 第一步:不花钱,先模拟一个前缀缓存

[Day 117](/blog/agent-zero/day-117-moe-kvcache/) 讲过 KV cache:模型从左到右处理 token,每个 token 算出的中间结果(K 和 V)只取决于它自己和它前面所有的 token。那一课的玩具是在**一次请求内部**省掉重复计算。厂商的 prompt caching 是把这些中间结果**跨请求**存起来:这次请求的开头和上次一样,就直接拿上次存的结果接着算。

先用纯 Python 模拟一下。不用懂注意力,只要抓住一个性质:第 i 步的状态由第 i−1 步的状态和第 i 个 token 决定。这和 JS 的 `reduce` 一模一样,`tokens.reduce(step, 0)` 算到第 i 个时的累加值,只取决于 `tokens[0..i]`。

```python
# agent-zero-lab/part07/prefix_sim.py
BLOCK = 4  # 每 4 个 token 存一次中间结果
cache: dict[tuple[str, ...], int] = {}


def step(state: int, token: str) -> int:
    return (state * 31 + sum(map(ord, token))) % 1_000_003


def run(tokens: list[str]) -> tuple[int, int]:
    start, state = 0, 0
    for k in range(len(tokens) // BLOCK * BLOCK, 0, -BLOCK):
        if tuple(tokens[:k]) in cache:
            start, state = k, cache[tuple(tokens[:k])]
            break
    for i in range(start, len(tokens)):
        state = step(state, tokens[i])
        if (i + 1) % BLOCK == 0:
            cache[tuple(tokens[: i + 1])] = state
    return start, state


SYSTEM = "你 是 云簿 的 客服 , 称呼 用 您 , 不 承诺 到账 时间 。".split()
requests = {
    "第 1 张工单": SYSTEM + "INV-0123 重复 扣款".split(),
    "第 2 张工单": SYSTEM + "导出 PDF 一直 转圈".split(),
    "开头加时间": ["10:31"] + SYSTEM + "导出 PDF 一直 转圈".split(),
}
for name, tokens in requests.items():
    hit, state = run(tokens)
    print(f"{name}: 共 {len(tokens)} 个 token,复用 {hit} 个,重算 {len(tokens) - hit} 个,最终状态 {state}")
```

<div class="line-notes">

- `BLOCK = 4  # 每 4 个 token 存一次中间结果` 不是每个 token 都存,而是攒满一块存一次。真实厂商也是这样,下面实测 DeepSeek 的命中数都是 128 的整数倍。
- `cache: dict[tuple[str, ...], int] = {}` 键是「从头开始的一段 token」,值是算到这里的状态。键用元组不用列表,因为字典的键必须不可变([Day 22](/blog/agent-zero/day-022-tuples-unpack/) 讲过元组)。`tuple[str, ...]` 表示任意长度、元素都是字符串的元组。
- `def step(state: int, token: str) -> int:` 假装是模型的一步计算。真实模型这一步是几十层矩阵乘法,这里随便写个数学式子,只要满足「新状态由旧状态和当前 token 决定」就行。
- `return (state * 31 + sum(map(ord, token))) % 1_000_003` `ord` 取字符的编码,`sum(map(ord, token))` 把一个 token 里所有字符的编码加起来。乘 31、取余都是为了让结果对顺序敏感,换个顺序就算出不同的数。
- `def run(tokens: list[str]) -> tuple[int, int]:` 处理一次请求,返回「复用了几个 token」和最终状态。
- `start, state = 0, 0` 默认从头算。
- `for k in range(len(tokens) // BLOCK * BLOCK, 0, -BLOCK):` 从最长的、块对齐的前缀开始往短里找。`//` 是整除,第 2 张工单 19 个 token,`19 // 4 * 4` 是 16,所以依次试 16、12、8、4。`range` 第三个参数 `-BLOCK` 表示每次减 4。
- `if tuple(tokens[:k]) in cache:` `tokens[:k]` 是前 k 个,和 JS 的 `slice(0, k)` 一样。前 k 个在缓存里有,就是命中。
- `start, state = k, cache[tuple(tokens[:k])]` 从第 k 个接着算,状态直接用存好的。
- `break` 找到最长的就停,不用再试更短的。
- `for i in range(start, len(tokens)):` 只算没命中的那部分。实测第 2 张工单从 12 开始算,只算 7 个。
- `if (i + 1) % BLOCK == 0:` 每攒满 4 个存一次。这一行保证下一个请求能用上这次算的结果。
- `SYSTEM = "你 是 云簿 的 客服 , 称呼 用 您 , 不 承诺 到账 时间 。".split()` 用空格切出 15 个「token」,假装是系统提示词。`.split()` 不带参数就是按空白切,相当于 JS 的 `str.split(/\s+/)`。
- `"开头加时间": ["10:31"] + SYSTEM + "导出 PDF 一直 转圈".split(),` 和第 2 张工单内容完全一样,只在最前面多了一个时间。
- `hit, state = run(tokens)` 解构返回的两个值。
- `print(f"{name}: 共 {len(tokens)} 个 token,复用 {hit} 个,重算 {len(tokens) - hit} 个,最终状态 {state}")` 最终状态打出来只是为了让你看到:不管复用没复用,同样的输入算出的结果一样,缓存只省计算、不改结果。

</div>

```bash
cd agent-zero-lab
uv run python -m part07.prefix_sim
```

```text
第 1 张工单: 共 18 个 token,复用 0 个,重算 18 个,最终状态 489966
第 2 张工单: 共 19 个 token,复用 12 个,重算 7 个,最终状态 20251
开头加时间: 共 20 个 token,复用 0 个,重算 20 个,最终状态 99890
```

三行各说明一件事:

- 第 1 张工单什么都没缓存,全部重算。
- 第 2 张工单的前 15 个 token(系统提示词)和第 1 张一样,但只复用了 12 个。因为缓存按 4 个一块存,15 个凑满 3 块是 12 个,剩下 3 个不满一块,没存。
- 「开头加时间」和第 2 张工单的系统提示词一字不差,但第一个 token 变了,后面每个 token 的状态都跟着变,一个都复用不了。

这三条就是 prompt caching 的全部原理。剩下的内容都是它们在真实厂商身上的表现。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="前缀缓存示意:两次请求从第一个 token 开始逐块比较,相同的块命中,遇到第一个不同的 token 之后全部重算;改动位置越靠前,命中越少">
<text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">缓存按块存,从头逐块比,遇到第一处不同就停</text>
<text x="20" y="62" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">上一次</text>
<rect x="110" y="48" width="60" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="170" y="48" width="60" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="230" y="48" width="60" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="290" y="48" width="60" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="350" y="48" width="60" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="410" y="48" width="100" height="22" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="230" y="40" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">系统提示词(不变)</text>
<text x="420" y="63" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">工单 A</text>
<text x="20" y="112" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">换工单</text>
<rect x="110" y="98" width="300" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="410" y="98" width="100" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="200" y="113" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">命中 5 块</text>
<text x="420" y="113" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">工单 B 重算</text>
<text x="20" y="162" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">中间改字</text>
<rect x="110" y="148" width="120" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<rect x="230" y="148" width="280" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="130" y="163" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">命中 2 块</text>
<text x="300" y="163" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">从改动处起全部重算</text>
<text x="20" y="212" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">开头加时间</text>
<rect x="110" y="198" width="400" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="250" y="213" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">0 命中,全部重算</text>
<rect x="530" y="98" width="14" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="550" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">命中</text>
<rect x="530" y="122" width="14" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="550" y="132" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">重算</text>
<text x="20" y="242" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">每块在 DeepSeek 上实测是 128 个 token</text>
</svg>
<figcaption>前缀缓存的命中规则。缓存一块一块地存,新请求从第一个 token 开始逐块和缓存比,第一处不同之前的整块算命中,之后的全部重算。同样是改一个字,改在哪里决定了损失多少。</figcaption>
</figure>

## 第二步:在 DeepSeek 上看第一次和第二次

模拟归模拟,真实厂商要实测。先建一个放客服规范的小模块,今天和后面几天都用它。规范内容就是 Day 396 `long_prompt_cost.py` 里那 120 条,挪到单独的文件里,不然别的脚本 import 它时会把那个实验也跑一遍(那个文件没写 main guard):

```python
# agent-zero-lab/part07/policy.py
RULES = [
    "称呼客户用「您」,不用「亲」。",
    "退款申请提交后要说明需要主管审批,不承诺到账时间。",
    "涉及金额时写清楚币种和小数点后两位。",
    "不要在回复里出现内部系统名、表名和字段名。",
    "客户情绪激动时先致歉再说明处理进度。",
    "技术问题要告诉客户已转给技术团队,并给出工单号。",
    "不能确认的事实一律不写,改成「我们会核实后回复您」。",
    "回复结尾不要加营销内容。",
]
POLICY = "\n".join(f"第 {i + 1} 条:{RULES[i % len(RULES)]}" for i in range(120))
SYSTEM = f"你是云簿 CloudLedger 的客服,严格遵守下面的规范。\n{POLICY}"
```

<div class="line-notes">

- `RULES = [` 和 Day 396 一样的八条规范。
- `POLICY = "\n".join(f"第 {i + 1} 条:{RULES[i % len(RULES)]}" for i in range(120))` 循环拼成 120 条,大约 2300 个 token。真实系统的系统提示词、工具说明、知识库片段加起来上几千 token 很常见。
- `SYSTEM = f"你是云簿 CloudLedger 的客服,严格遵守下面的规范。\n{POLICY}"` 完整的系统提示词。它是模块级常量,程序跑起来以后一个字都不会变,这一点今天特别重要。

</div>

然后连着发三次一模一样的请求:

```python
# agent-zero-lab/part07/cache_first_hit.py
import json
import os
import sys
import time

from dotenv import load_dotenv
from openai import OpenAI

from part07.policy import SYSTEM

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
tag = sys.argv[1]  # 每次实验换一个标签,保证是全新的开头

for i in range(3):
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[
            {"role": "system", "content": f"实验 {tag}\n{SYSTEM}"},
            {"role": "user", "content": "INV-0123 被重复扣款,请退款。写一段不超过 80 字的回复。"},
        ],
        max_tokens=100,
        extra_body=EXTRA,
    )
    u = resp.usage
    assert u is not None
    hit = getattr(u, "prompt_cache_hit_tokens", 0) or 0
    print(f"第 {i + 1} 次: 输入 {u.prompt_tokens}  命中 {hit}  命中率 {hit / u.prompt_tokens:.0%}")
    time.sleep(1)
```

<div class="line-notes">

- `from part07.policy import SYSTEM` 刚建的规范模块。
- `tag = sys.argv[1]  # 每次实验换一个标签,保证是全新的开头` 这是个小技巧:缓存几小时到几天才清,我跑过一次以后你再跑,开头一样就会直接命中,看不到「第一次没命中」。在最前面加一个自己起的标签,开头就和以前任何请求都不同。这一行正好用了第一步的结论:开头变了,后面全部作废。
- `{"role": "system", "content": f"实验 {tag}\n{SYSTEM}"},` 系统消息放规范。`system` 角色在 [Day 130](/blog/agent-zero/day-130-system-prompt/) 讲过。
- `{"role": "user", "content": "INV-0123 被重复扣款,请退款。写一段不超过 80 字的回复。"},` 三次的用户消息也完全一样。
- `assert u is not None` 和 Day 396 的 `if u else 0` 是同一个意思的另一种写法:usage 为 None 就直接报错停下。实验脚本里宁可停下也不要算出一个假的 0。它还能让 basedpyright 知道下面的 `u` 一定不是 None。
- `hit = getattr(u, "prompt_cache_hit_tokens", 0) or 0` Day 396 讲过的读法,DeepSeek 自己加的字段要用 `getattr` 取。
- `print(f"第 {i + 1} 次: 输入 {u.prompt_tokens}  命中 {hit}  命中率 {hit / u.prompt_tokens:.0%}")` 命中率 = 命中的 token / 全部输入 token。
- `time.sleep(1)` 等一秒再发下一次。DeepSeek 文档说缓存要「落盘」后才能命中,连着秒发可能还没写好。

</div>

```bash
uv run python -m part07.cache_first_hit A1
uv run python -m part07.cache_first_hit A2
```

```text
第 1 次: 输入 2371  命中 0  命中率 0%
第 2 次: 输入 2371  命中 2176  命中率 92%
第 3 次: 输入 2371  命中 2176  命中率 92%
第 1 次: 输入 2371  命中 0  命中率 0%
第 2 次: 输入 2371  命中 2176  命中率 92%
第 3 次: 输入 2371  命中 2176  命中率 92%
```

两轮实验,换了标签,结果一模一样。读出三件事:

**第一次一定原价。** 缓存是第一次请求「顺手」建出来的,建的那次不打折。DeepSeek 不额外收写缓存的钱,但也不省。

**命中数是 128 的整数倍。** 2176 = 17 × 128。和第一步的 `BLOCK = 4` 一个道理,只是块大一些。今天后面所有实测的命中数(1024、2304、2560、2816、3072)也都是 128 的倍数。DeepSeek 文档没写块有多大,128 是我从数字里看出来的,别把它当官方承诺。

**一模一样的请求也不是 100% 命中。** 第二、三次连用户消息都没变,还是只命中 2176,剩下 195 个 token 照原价。文档说缓存在「用户输入结束位置」「多次请求的公共前缀」和「按固定 token 间隔」这几种地方落盘,具体切在哪由它决定。你能控制的是把不变的部分做长、做稳,不用纠结最后那一两百个。

算一下这 92% 值多少钱(flash 高峰价,命中 0.04、未命中 2,单位元/百万 token):

```text
不命中:2371 × 2                    = 4742
命中:  2176 × 0.04 + 195 × 2       = 87.04 + 390 = 477.04
```

输入部分只要原价的十分之一。

## 第三步:改在哪里,掉多少

现在做今天的主实验。先用新标签发一次预热,然后在同一个开头的基础上做五种改动,每种看命中多少:

```python
# agent-zero-lab/part07/where_change.py
import json
import os
import sys
import time

from dotenv import load_dotenv
from openai import OpenAI

from part07.policy import SYSTEM

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
tag = sys.argv[1]
base = f"实验 {tag}\n{SYSTEM}"
ticket = "INV-0123 被重复扣款,请退款。写一段不超过 80 字的回复。"


def hit_of(system: str, user: str) -> str:
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=60,
        extra_body=EXTRA,
    )
    u = resp.usage
    assert u is not None
    hit = getattr(u, "prompt_cache_hit_tokens", 0) or 0
    time.sleep(1)
    return f"输入 {u.prompt_tokens:>4}  命中 {hit:>4}  命中率 {hit / u.prompt_tokens:.0%}"


now = time.strftime("%H:%M:%S")
print("预热(全新开头)    ", hit_of(base, ticket))
print("原样再发一次      ", hit_of(base, ticket))
print("换一张工单        ", hit_of(base, "导出 PDF 发票的时候页面一直转圈。写一段不超过 80 字的回复。"))
print("时间放在用户消息末尾", hit_of(base, ticket + f"\n当前时间 {now}"))
print("时间放在系统提示开头", hit_of(f"当前时间 {now}\n{base}", ticket))
print("规范中间改了一个字 ", hit_of(base.replace("第 60 条", "第 六十 条"), ticket))
```

<div class="line-notes">

- `base = f"实验 {tag}\n{SYSTEM}"` 这一轮实验的「标准开头」,下面的改动都相对它来说。
- `def hit_of(system: str, user: str) -> str:` 发一次请求,返回一行说明命中情况的文字。把重复的调用代码收进函数,下面六行只写不同的地方。
- `return f"输入 {u.prompt_tokens:>4}  命中 {hit:>4}  命中率 {hit / u.prompt_tokens:.0%}"` `:>4` 右对齐占 4 格,Day 396 用过。
- `now = time.strftime("%H:%M:%S")` 当前时间,形如 `23:46:12`。很多人喜欢让模型「知道现在几点」,这就是那一行。
- `print("换一张工单        ", hit_of(base, "导出 PDF 发票的时候页面一直转圈。写一段不超过 80 字的回复。"))` 系统提示词不变,用户消息换掉。这就是正常线上的情况:规范固定,每张工单不同。
- `print("时间放在用户消息末尾", hit_of(base, ticket + f"\n当前时间 {now}"))` 时间放在整个请求的最后面。
- `print("时间放在系统提示开头", hit_of(f"当前时间 {now}\n{base}", ticket))` 时间放在整个请求的最前面。内容和上一行一模一样,只是位置不同。
- `print("规范中间改了一个字 ", hit_of(base.replace("第 60 条", "第 六十 条"), ticket))` `str.replace` 和 JS 的 `replaceAll` 一样,会替换所有出现的地方;这里「第 60 条」只出现一次,在 120 条规范的正中间。模拟「运营同学改了一条规范」。

</div>

```bash
uv run python -m part07.where_change B1
```

```text
预热(全新开头)     输入 2371  命中    0  命中率 0%
原样再发一次       输入 2371  命中 2176  命中率 92%
换一张工单         输入 2367  命中 2176  命中率 92%
时间放在用户消息末尾 输入 2379  命中 2176  命中率 91%
时间放在系统提示开头 输入 2380  命中    0  命中率 0%
规范中间改了一个字  输入 2371  命中 1024  命中率 43%
```

把这张表和第一步的模拟对上:

- **换一张工单,命中一点不少。** 系统提示词在前、工单在后,工单变了只影响最后那一小段。这就是我们想要的线上状态。
- **同样一行时间,放末尾 91%,放开头 0%。** 内容完全一样,只差位置。放开头的那行让后面 2300 多个 token 全部作废,这次调用按原价付。[Day 117](/blog/agent-zero/day-117-moe-kvcache/) 已经见过一次这个坑,今天把它放进对比里,是因为它在真实项目里实在太常见:「当前时间」「请求 ID」「用户名」这类东西,写系统提示词模板时很顺手就放到第一行了。
- **规范中间改一个字,命中掉到 1024。** 1024 = 8 × 128,正好是改动位置之前的那几块。改在中间,损失一半。

最后一条有个实际意义:规范、工具说明这类内容,改一次就会让缓存重新建一遍。改一次没关系,第一次原价,之后又命中了。怕的是**每次请求都在变**,那就永远是第一次。

## 第四步:工具定义的顺序

Agent 的请求里除了消息还有 `tools`(工具定义,[Day 156](/blog/agent-zero/day-156-fc-idea/) 开始用的那个参数)。工具定义也会被厂商拼进模型的输入里,也是前缀的一部分。一个常见的写法是从字典或者配置里动态拼工具列表,比如按客户权限过滤,顺序就可能每次不同。实测一下:

```python
# agent-zero-lab/part07/tool_order.py
import json
import os
import random
import sys
import time

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionFunctionToolParam

from part07.policy import SYSTEM

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
tag = sys.argv[1]


def tool(name: str, desc: str) -> ChatCompletionFunctionToolParam:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
        },
    }


TOOLS = {
    "find_customer": tool("find_customer", "按客户编号查客户"),
    "get_subscription": tool("get_subscription", "查客户当前订阅"),
    "list_invoices": tool("list_invoices", "列出客户的发票"),
    "create_refund_request": tool("create_refund_request", "提交退款申请,需主管审批"),
}


def send(tools: list[ChatCompletionFunctionToolParam]) -> str:
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[
            {"role": "system", "content": f"实验 {tag}\n{SYSTEM}"},
            {"role": "user", "content": "INV-0123 被重复扣款,请退款"},
        ],
        tools=tools,
        max_tokens=60,
        extra_body=EXTRA,
    )
    u = resp.usage
    assert u is not None
    time.sleep(1)
    return f"输入 {u.prompt_tokens}  命中 {getattr(u, 'prompt_cache_hit_tokens', 0) or 0}"


names = list(TOOLS)
print("预热       ", names, send([TOOLS[n] for n in names]))
print("同样顺序   ", names, send([TOOLS[n] for n in names]))
random.seed(7)
shuffled = random.sample(names, k=len(names))
print("打乱顺序   ", shuffled, send([TOOLS[n] for n in shuffled]))
print("排序后再发 ", sorted(names), send([TOOLS[n] for n in sorted(names)]))
print("排序后再发 ", sorted(names), send([TOOLS[n] for n in sorted(names)]))
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletionFunctionToolParam` openai SDK 给工具定义写好的类型,相当于 TS 里库导出的 interface。函数返回值标成它,basedpyright 才不会在 `tools=tools` 那里报类型不匹配。
- `def tool(name: str, desc: str) -> ChatCompletionFunctionToolParam:` 造一个工具定义的小工厂,四个工具结构一样,只有名字和描述不同。
- `"parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},` JSON Schema,[Day 157](/blog/agent-zero/day-157-tool-schema/) 讲过。这里都只要一个 `id`,今天不真调工具,只看缓存。
- `TOOLS = {` 四个工具名和第五部分的 CloudLedger MCP server 一致。
- `tools=tools,` 工具列表的顺序就是这个列表的顺序。
- `names = list(TOOLS)` 字典转列表得到所有键,Python 3.7 以后字典保持插入顺序。
- `random.seed(7)` 固定随机种子,让「打乱」每次打乱成同一个样子,结果可复现。
- `shuffled = random.sample(names, k=len(names))` 从 4 个里随机抽 4 个,也就是打乱顺序,不改原列表。相当于 lodash 的 `_.shuffle`。
- `print("排序后再发 ", sorted(names), send([TOOLS[n] for n in sorted(names)]))` `sorted` 按字母排序,返回新列表。排序是最省事的「固定顺序」办法,不管工具从哪来、怎么过滤,排完都是同一个顺序。连发两次,看第一次和第二次的区别。

</div>

```bash
uv run python -m part07.tool_order C1
```

```text
预热        ['find_customer', 'get_subscription', 'list_invoices', 'create_refund_request'] 输入 2760  命中 0
同样顺序    ['find_customer', 'get_subscription', 'list_invoices', 'create_refund_request'] 输入 2760  命中 2560
打乱顺序    ['list_invoices', 'find_customer', 'get_subscription', 'create_refund_request'] 输入 2760  命中 2304
排序后再发  ['create_refund_request', 'find_customer', 'get_subscription', 'list_invoices'] 输入 2760  命中 2304
排序后再发  ['create_refund_request', 'find_customer', 'get_subscription', 'list_invoices'] 输入 2760  命中 2560
```

这个结果和我预想的不太一样,值得细看。

打乱顺序后命中从 2560 掉到 2304,只少了 256 个,不是掉到 0。说明 **DeepSeek 把工具定义放在系统提示词后面**:2304 正好是系统提示词那段的命中,工具那段没了。如果工具定义在最前面,一打乱就是 0。

这一点各家不一样。Anthropic 的文档写得很明白,它的顺序是 tools → system → messages,工具定义一变,三层全部失效。所以同一份代码,换到 Claude 上,打乱工具顺序的代价可能是全部 2760 个 token。

我们这四个工具每个只有几十个 token,所以只损失 256。真实 Agent 的工具常常有十几二十个,每个带详细描述和参数说明,工具段几千 token 很正常,那时候顺序不稳定就很疼了。

最后两行:排好序后第一次发还是 2304(因为这个顺序是第一次出现),第二次就回到 2560。排序本身不会让缓存命中,它保证的是**以后每次都一样**。

## 第五步:四条命中规矩

把前面的实验整理成四条,写提示词时逐条对照:

**一、不变的在前,会变的在后。** 系统提示词、工具定义、固定的 few-shot 示例、知识库里不变的文档放最前面;工单内容、检索结果、当前时间、用户名放最后面,最好放进用户消息。第三步实测,时间放开头 0%,放末尾 91%。

**二、不变的部分要真的不变。** 工具列表排序后再发;从字典、集合、配置文件里拼出来的东西,确认每次顺序一样;JSON 序列化时字段顺序固定(Python 的 `json.dumps` 默认按插入顺序,想彻底稳就加 `sort_keys=True`)。规范要改就改,但别让它每次请求都变。

**三、对话历史只往后加,不改前面。** 多轮对话里,每一轮把新消息追加在后面,前面的轮次原样不动,上一轮的整个请求就是这一轮的前缀,能一直命中。如果每轮都在前面重写一段「对话摘要」,摘要后面的所有内容都要重算。练习 2 会实测这两种写法。

**四、不同用途的调用,能共享前缀就共享,但要算账。** 比如分类和起草如果用同一段系统提示词开头,分类也能吃到起草建好的缓存。但这会让分类的输入变长,下一步会实测这条在我们的系统里**不划算**。

## 第六步:改造工单 worker

Day 396 的 worker 提示词很短,classify 三十几个 token、draft 一百个出头,短到根本没东西可缓存(不满一块 128 个 token,命中只能是 0)。真实的客服 Agent 一定会带上规范。我们先按直觉把规范加进 draft,看看会怎样。

### 第一版:规范加在后面

很多人加规范的第一反应是把它接在已有提示词的后面,改动最小:

```python
# agent-zero-lab/part07/ticket_agent.py(第一版,只列 draft 节点)
    async def draft(state: TicketState) -> dict:
        facts = facts_for_model(state)
        text, call = await ask_metered(
            "draft",
            f"工单:{state['text']}\n事实:{json.dumps(facts, ensure_ascii=False)}\n{SYSTEM}\n"
            "根据事实写一段不超过 80 字的中文回复,事实里没有的不要承诺。",
            200,
            state["ticket_id"],
        )
        maybe_crash("draft")
        return {"draft": text, "steps": ["draft"], "llm_calls": [call]}
```

<div class="line-notes">

- `f"工单:{state['text']}\n事实:{json.dumps(facts, ensure_ascii=False)}\n{SYSTEM}\n"` 工单和事实在前,2300 token 的规范在后。文件开头要加一行 `from part07.policy import SYSTEM`。
- `"根据事实写一段不超过 80 字的中文回复,事实里没有的不要承诺。",` 两个相邻的字符串字面量会被 Python 自动拼成一个,和上一行连起来是一个完整的提示词。

</div>

为了看命中率,再写一个按节点汇总的报表。它读 Day 396 建的 usage 日志,只看某个前缀的工单:

```python
# agent-zero-lab/part07/cache_report.py
import json
import sys
from collections import defaultdict
from datetime import datetime

from part07.pricing import call_cost, period_at
from part07.ticket_agent import USAGE_LOG

prefix = sys.argv[1] + "-"
by_node: dict[str, list[dict]] = defaultdict(list)
for line in USAGE_LOG.read_text(encoding="utf-8").splitlines():
    c = json.loads(line)
    if c["ticket_id"].startswith(prefix):
        by_node[c["node"]].append(c)

total_real = total_full = 0.0
for node, calls in by_node.items():
    prompt = sum(c["prompt"] for c in calls)
    hit = sum(c["hit"] for c in calls)
    real = full = 0.0
    for c in calls:
        period = period_at(datetime.fromisoformat(c["at"]))
        real += call_cost("deepseek-flash", c["prompt"], c["hit"], c["completion"], period)
        full += call_cost("deepseek-flash", c["prompt"], 0, c["completion"], period)
    total_real += real
    total_full += full
    print(f"{node:<9} 调用 {len(calls):>2} 次  输入 {prompt:>6}  命中 {hit:>6}({hit / prompt:.0%})  实付 {real * 100:.4f} 分  不算缓存 {full * 100:.4f} 分")
print(f"合计 实付 {total_real * 100:.4f} 分,不算缓存 {total_full * 100:.4f} 分,省了 {1 - total_real / total_full:.0%}")
```

<div class="line-notes">

- `from part07.ticket_agent import USAGE_LOG` Day 396 定义的日志路径 `logs/llm_usage.jsonl`,和 worker 写的是同一个文件。
- `prefix = sys.argv[1] + "-"` 命令行给批次前缀,比如 `P`,就只看 `P-01`、`P-02`……。加 `-` 是为了不把 `PX-01` 也算进来。
- `by_node: dict[str, list[dict]] = defaultdict(list)` 按节点分组,Day 396 的 `usage_report.py` 是按工单分组,这里换个角度。
- `if c["ticket_id"].startswith(prefix):` `startswith` 和 JS 的同名方法一样。
- `prompt = sum(c["prompt"] for c in calls)` 这个节点所有调用的输入 token 加起来。
- `hit = sum(c["hit"] for c in calls)` 命中的加起来。命中率用总数相除,而不是每次命中率取平均,因为长请求和短请求的权重不一样。
- `period = period_at(datetime.fromisoformat(c["at"]))` 每次调用按它自己的时间判断峰谷,Day 396 的函数。
- `real += call_cost("deepseek-flash", c["prompt"], c["hit"], c["completion"], period)` 按实际命中算,这是厂商真收的钱。
- `full += call_cost("deepseek-flash", c["prompt"], 0, c["completion"], period)` 假设一个都没命中,算出「原价」。两者一比就知道缓存省了多少。
- `print(f"合计 实付 {total_real * 100:.4f} 分,不算缓存 {total_full * 100:.4f} 分,省了 {1 - total_real / total_full:.0%}")` 「省了」= 1 − 实付 / 原价。

</div>

跑一批 8 张(四种工单各两张),前缀用 P:

```bash
uv run python -m part07.ticket_intake P 8
uv run arq --burst part07.ticket_worker.WorkerSettings
uv run python -m part07.cache_report P
```

```text
P-01 入队
...
P-08 入队
[P-04] try 1 PermanentError: 发票 INV-9999 不存在 -> 转人工
23:49:08:   1.00s ← ticket-P-04:process_ticket ● 'needs_human'
...
23:49:11:   2.16s ← ticket-P-06:process_ticket ● 'draft_ready'
classify  调用  8 次  输入    290  命中      0(0%)  实付 0.0346 分  不算缓存 0.0346 分
draft     调用  6 次  输入  14530  命中   2176(15%)  实付 1.3542 分  不算缓存 1.5674 分
合计 实付 1.3888 分,不算缓存 1.6020 分,省了 13%
```

(晚上 11 点多跑的,空闲时段。8 张里两张 `INV-9999` 转人工,没走到 draft,所以 draft 只有 6 次。)

draft 命中率只有 15%,6 次里只有一次命中了 2176 个。规范放在工单后面,每张工单的开头都不一样,规范那 2300 个 token 自然没法复用。唯一命中的那次,是 `P-07`:它和 `P-03` 是同一种技术工单,正文一字不差,事实里也没有退款单号,整段开头碰巧完全相同。这种「碰巧」线上几乎不会发生。

### 第二版:规范放进 system,放在最前面

按规矩一改。`ask_metered` 加一个可选的 `system` 参数,draft 把规范作为系统消息传进去,工单和事实放在用户消息里:

```python
# agent-zero-lab/part07/ticket_agent.py(第二版,改动部分)
from openai.types.chat import ChatCompletionMessageParam

from part07.policy import SYSTEM


async def ask_metered(
    node: str, prompt: str, max_tokens: int, ticket_id: str = "", system: str = ""
) -> tuple[str, dict]:
    messages: list[ChatCompletionMessageParam] = [{"role": "system", "content": system}] if system else []
    messages.append({"role": "user", "content": prompt})
    resp = await llm.chat.completions.create(
        model=MODEL,
        messages=messages,
        max_tokens=max_tokens,
        extra_body=EXTRA,
    )
    # 下面记 usage、写日志的部分和 Day 396 完全一样

    # build_graph 里的 draft:
    async def draft(state: TicketState) -> dict:
        facts = facts_for_model(state)
        text, call = await ask_metered(
            "draft",
            "根据事实写一段不超过 80 字的中文回复,事实里没有的不要承诺。\n"
            f"工单:{state['text']}\n事实:{json.dumps(facts, ensure_ascii=False)}",
            200,
            state["ticket_id"],
            system=SYSTEM,
        )
        maybe_crash("draft")
        return {"draft": text, "steps": ["draft"], "llm_calls": [call]}
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletionMessageParam` 消息的类型。下面 `messages` 是先建再 `append` 的,不标类型的话 basedpyright 会把它推断成「只能装 system 消息的列表」,append 用户消息时报红。
- `from part07.policy import SYSTEM` 第二步建的规范。
- `node: str, prompt: str, max_tokens: int, ticket_id: str = "", system: str = ""` 参数太多一行写不下,拆成多行。`system` 默认空字符串,classify 和 `ask` 这些不传它的调用,行为和 Day 396 完全一样。
- `messages: list[ChatCompletionMessageParam] = [{"role": "system", "content": system}] if system else []` 有系统提示词就放在第一条,没有就是空列表。`A if 条件 else B` 是 Python 的三元表达式,相当于 JS 的 `条件 ? A : B`。
- `messages.append({"role": "user", "content": prompt})` 用户消息永远在最后。`append` 相当于 JS 的 `push`。
- `messages=messages,` 原来写死的单条用户消息换成刚拼好的列表。
- `"根据事实写一段不超过 80 字的中文回复,事实里没有的不要承诺。\n"` 指令也挪到用户消息里了。它本身不变,放在 system 末尾也可以;放在这里是为了让 system 只装规范,以后别的节点想复用同一段 system 也方便。
- `f"工单:{state['text']}\n事实:{json.dumps(facts, ensure_ascii=False)}",` 会变的内容全部在最后。
- `system=SYSTEM,` 关键字参数,一眼看出传的是什么。

</div>

新开一批,前缀用 Q。这一版我还顺手试了第四条规矩:让 classify 也带上同样的 `system=SYSTEM`,共享前缀。

```bash
uv run python -m part07.ticket_intake Q 8
uv run arq --burst part07.ticket_worker.WorkerSettings
uv run python -m part07.cache_report Q
```

```text
classify  调用  8 次  输入  19010  命中   8704(46%)  实付 1.0536 分  不算缓存 1.9066 分
draft     调用  6 次  输入  14540  命中  13312(92%)  实付 0.2658 分  不算缓存 1.5704 分
合计 实付 1.3194 分,不算缓存 3.4770 分,省了 62%
```

draft 命中率从 15% 涨到 92%,实付从 1.35 分降到 0.27 分,只有原来的五分之一。这是今天想要的结果。

classify 那一行才是值得停下来看的地方。共享前缀以后,它的命中率是 46%,看起来不错,可实付从 0.0346 分涨到了 1.0536 分,**贵了 30 倍**。手算一下就明白(空闲价,命中 0.02、未命中 1、输出 4):

```text
原来一次 classify:  约 36 × 1 + 2 × 4                     = 44      (元 / 百万)
共享前缀、没命中:   约 2376 × 1 + 2 × 4                   = 2384
共享前缀、命中:     2176 × 0.02 + 200 × 1 + 2 × 4         ≈ 251.5
```

就算命中,一次也要 251.5,是原来 44 的近 6 倍。命中只是让多出来的那 2176 个 token 便宜,并不是免费,而 classify 本来只需要三十几个 token。第四条规矩在旧课的例子里划算,是因为那里的分类节点本来就带一段 800 token 的独立提示词;我们的分类提示词很短,加规范纯属多花钱。**所以 classify 不带 system,保持 Day 396 的样子。** 这就是第五步说的「要算账」。

还有一个细节:classify 的 8 次里正好 4 次没命中(8704 = 4 × 2176)。worker 的 `max_jobs` 是 4,开始时 4 张工单同时跑 classify,四个请求同时发出去,谁也等不到别人建好的缓存。这叫冷启动,练习 1 专门做。

### 定稿:只有 draft 带规范

把 classify 改回去(它那一行和 Day 396 一样,不传 `system`),再跑一批 R:

```bash
uv run python -m part07.ticket_intake R 8
uv run arq --burst part07.ticket_worker.WorkerSettings
uv run python -m part07.cache_report R
```

```text
classify  调用  8 次  输入    290  命中      0(0%)  实付 0.0346 分  不算缓存 0.0346 分
draft     调用  6 次  输入  14536  命中  13312(92%)  实付 0.2622 分  不算缓存 1.5668 分
合计 实付 0.2968 分,不算缓存 1.6014 分,省了 81%
```

和第一版比:同样 8 张工单,同样带着 2300 token 的规范,花费从 1.3888 分降到 0.2968 分,只是把规范从后面挪到了前面。

有一点要说明白:R 批的 6 次 draft 全部命中,包括最早并发的那几个,是因为 Q 批刚刚建好了同一段规范的缓存,几分钟内还在。如果你直接从第一版跳到定稿,第一批会有几次 draft 没命中,之后的批次就稳定在九成左右。

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="三批工单的模型费对比:第一版规范放在后面 1.39 分,第二版规范在前且分类共享前缀 1.32 分,定稿只有起草带规范 0.30 分">
<text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">同一批 8 张工单的模型费(分,空闲价)</text>
<text x="20" y="64" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">P 规范在后</text>
<rect x="150" y="50" width="6" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="156" y="50" width="244" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="410" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">1.39 · draft 命中 15%</text>
<text x="20" y="114" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Q 共享前缀</text>
<rect x="150" y="100" width="185" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="335" y="100" width="47" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="392" y="116" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">1.32 · classify 变贵 30 倍</text>
<text x="20" y="164" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">R 定稿</text>
<rect x="150" y="150" width="6" height="22" fill="var(--compute-wash)" stroke="var(--compute)"/>
<rect x="156" y="150" width="46" height="22" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="212" y="166" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">0.30 · draft 命中 92%</text>
<rect x="150" y="198" width="14" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="170" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">classify</text>
<rect x="260" y="198" width="14" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="280" y="208" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">draft</text>
<text x="20" y="232" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">条形长度按金额画,1 分 ≈ 175 像素</text>
</svg>
<figcaption>三批工单的实测花费。规范从后面挪到前面,draft 的钱降到五分之一;给短小的 classify 也套上长规范,它反而贵了 30 倍,所以定稿只让 draft 带规范。</figcaption>
</figure>

## 第七步:三家厂商的做法

我们一直在 DeepSeek 上实验,但规矩是通用的,差别在「要不要你动手」和「写缓存要不要加钱」。下面是我 2026 年 10 月 22 日查三家官方文档整理的:

| | DeepSeek | OpenAI | Anthropic(Claude) |
| --- | --- | --- | --- |
| 怎么开 | 默认开,不用改代码 | 默认开,不用改代码 | 要在请求里加 `cache_control`,可以标在某个内容块上(最多 4 个断点),也可以在请求顶层开自动模式 |
| 最短多长才缓存 | 文档没写;实测按 128 token 一块 | GPT-5.6 起至少 1024 token | 按模型不同,512 到 4096 token |
| 命中价 | flash 高峰 0.04 元,是未命中的 1/50 | 新模型多为输入价的 0.1 倍 | 多数模型 0.1 倍,Opus 5.5、Sonnet 5.5 是 0.05 倍 |
| 写缓存加钱吗 | 不加 | GPT-5.6 起 30 分钟档 1.25 倍,12 小时档 2.5 倍;更早的模型不加 | 5 分钟档 1.25 倍,1 小时档 2 倍 |
| 存多久 | 几小时到几天,尽力而为 | 新模型默认 30 分钟,可选 12 小时 | 默认 5 分钟,可选 1 小时,每次命中刷新 |
| usage 字段 | `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` | Chat Completions 是 `prompt_tokens_details.cached_tokens`,Responses API 是 `input_tokens_details.cached_tokens` | `cache_read_input_tokens` / `cache_creation_input_tokens` |
| 工具定义的位置 | 实测在 system 后面 | 文档建议工具定义保持稳定,不要删,用 `tool_choice` 关 | 最前面,一改全部失效 |

两点我觉得最值得记住:

第一,**写缓存要加钱的厂商,缓存用错了会比不用还贵**。Anthropic 上如果你把 `cache_control` 标在每次都变的那条消息上,每次都是按 1.25 倍写一次、从来不读,比不开缓存多花 25%。Anthropic 文档专门写了这一条:断点要放在「所有请求里都一样的最后一块」上,不要放在时间戳或者新来的用户消息上。

第二,**DeepSeek 不加钱、自动开,所以最容易被忽视**。代码里看不出任何缓存相关的东西,命中率掉了不会报错,只有账单变贵。这就是为什么 `cache_report.py` 这种报表要每天看。

## 零件和完整改造的对照

| 今天的零件 | 放在哪 | 回答什么问题 |
| --- | --- | --- |
| `prefix_sim.py` | 不调模型的模拟 | 为什么只认开头、为什么按块命中 |
| `policy.py` 的 `SYSTEM` | 模块级常量 | 一段永远不变的长前缀 |
| `cache_first_hit.py` | 实验 | 第一次原价、第二次命中多少 |
| `where_change.py` | 实验 | 改在哪里、命中掉多少 |
| `tool_order.py` | 实验 | 工具顺序在 DeepSeek 上影响多大 |
| `ask_metered(..., system=...)` | `ticket_agent.py` | 让不变的规范作为第一条消息 |
| `draft` 节点 | `ticket_agent.py` | 规范在前,工单和事实在后 |
| `cache_report.py` | 离线报表 | 每个节点的命中率、实付和原价 |

## 动手练习

### 练习 1:冷启动和预热

第六步的 Q 批里,classify 最开始的 4 次并发调用全部没命中。写 `part07/cold_start.py`:用一个全新的开头,同时发 4 个请求看命中;再换一个全新开头,先单独发一个「预热」请求,等一秒,再同时发 4 个。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/cold_start.py
import asyncio
import json
import os
import sys

from dotenv import load_dotenv
from openai import AsyncOpenAI

from part07.policy import SYSTEM

load_dotenv()
llm = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))


async def one(system: str, text: str) -> int:
    resp = await llm.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "system", "content": system}, {"role": "user", "content": text}],
        max_tokens=40,
        extra_body=EXTRA,
    )
    return getattr(resp.usage, "prompt_cache_hit_tokens", 0) or 0


async def main(tag: str, warm: bool):
    system = f"规范版本 {tag}\n{SYSTEM}"
    if warm:
        print("预热:", await one(system, "你好"))
        await asyncio.sleep(1)
    texts = ["INV-0123 重复扣款", "INV-0456 重复扣费", "导出 PDF 一直转圈", "怎么改发票抬头"]
    hits = await asyncio.gather(*(one(system, t) for t in texts))
    print("并发 4 个:", hits)


asyncio.run(main(sys.argv[1], warm=len(sys.argv) > 2 and sys.argv[2] == "warm"))
```

<div class="line-notes">

- `llm = AsyncOpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])` 要并发,用异步客户端。
- `async def one(system: str, text: str) -> int:` 发一次,只返回命中数。
- `return getattr(resp.usage, "prompt_cache_hit_tokens", 0) or 0` `resp.usage` 是 None 时 `getattr` 也会返回默认值 0,所以这里不用先判断。
- `system = f"规范版本 {tag}\n{SYSTEM}"` 「规范版本」这一行在真实系统里也很常见:运营改了规范,版本号加一,缓存跟着重建一次。
- `print("预热:", await one(system, "你好"))` 预热请求的内容无所谓,只要开头是那段 system 就行。它自己当然是 0 命中。
- `await asyncio.sleep(1)` 给缓存落盘留一点时间。
- `hits = await asyncio.gather(*(one(system, t) for t in texts))` 4 个请求同时发出,[Day 68](/blog/agent-zero/day-068-async-3/) 学的 `gather`,相当于 `Promise.all`。返回值的顺序和传进去的顺序一致。
- `asyncio.run(main(sys.argv[1], warm=len(sys.argv) > 2 and sys.argv[2] == "warm"))` 第二个命令行参数写 `warm` 就预热。先判断长度再取 `sys.argv[2]`,不然没传第二个参数时会 IndexError。

</div>

```bash
uv run python -m part07.cold_start D1
uv run python -m part07.cold_start D2 warm
```

```text
并发 4 个: [0, 0, 0, 0]
预热: 0
并发 4 个: [2176, 2176, 2176, 2176]
```

没预热时 4 个全部原价;预热一次后 4 个全部命中。代价是多发了一个请求(输入两千多 token 原价一次),换来后面每个并发请求都打一折。在 worker 里的做法是 `startup` 里先发一个预热请求,或者规范改版发布时由发布脚本预热一次。一天只跑几张工单的系统不值得做,一批几百张同时进来的值得。

</details>

### 练习 2:历史只追加 vs 每轮重写摘要

模拟一个客户连续反馈 4 次「导出 PDF 还是转圈」,每次贴一段日志。写 `part07/history_cache.py`,比较两种写法每轮的输入和命中:`append` 把每轮的用户消息和模型回复都追加进历史;`rewrite` 不留历史,每轮在用户消息前面写一句更新过的摘要「客户已反馈 N 次」。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part07/history_cache.py
import json
import os
import sys
import time

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

from part07.policy import SYSTEM

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
LOG = "\n".join(f"10:{i:02d}:07 export_pdf job={i} status=pending retry={i % 3}" for i in range(12))
TURNS = [f"第 {n} 次反馈:导出 PDF 还是转圈,日志如下\n{LOG}" for n in range(1, 5)]


def run(mode: str, tag: str) -> None:
    system = f"会话 {tag}\n{SYSTEM}"
    history: list[ChatCompletionMessageParam] = []
    for n, text in enumerate(TURNS, start=1):
        if mode == "append":
            history.append({"role": "user", "content": text})
            messages: list[ChatCompletionMessageParam] = [{"role": "system", "content": system}, *history]
        else:
            summary = f"(摘要:客户已反馈 {n - 1} 次导出 PDF 转圈)"
            messages = [{"role": "system", "content": system}, {"role": "user", "content": summary + "\n" + text}]
        resp = client.chat.completions.create(
            model=os.environ["LLM_MODEL"], messages=messages, max_tokens=30, extra_body=EXTRA
        )
        u = resp.usage
        assert u is not None
        print(f"{mode:<7} 第 {n} 轮 输入 {u.prompt_tokens}  命中 {getattr(u, 'prompt_cache_hit_tokens', 0) or 0}")
        if mode == "append":
            history.append({"role": "assistant", "content": resp.choices[0].message.content or ""})
        time.sleep(1)


run(sys.argv[1], sys.argv[2])
```

<div class="line-notes">

- `LOG = "\n".join(f"10:{i:02d}:07 export_pdf job={i} status=pending retry={i % 3}" for i in range(12))` 造一段 12 行的假日志,大约 250 个 token,让每轮的新内容超过一块(128),命中的变化才看得出来。
- `TURNS = [f"第 {n} 次反馈:导出 PDF 还是转圈,日志如下\n{LOG}" for n in range(1, 5)]` 4 轮用户消息。
- `for n, text in enumerate(TURNS, start=1):` `enumerate` 同时拿到序号和元素,`start=1` 让序号从 1 开始。相当于 JS 的 `TURNS.forEach((text, i) => { const n = i + 1 })`。
- `messages: list[ChatCompletionMessageParam] = [{"role": "system", "content": system}, *history]` `*history` 把列表展开塞进新列表,相当于 JS 的 `[sys, ...history]`。
- `summary = f"(摘要:客户已反馈 {n - 1} 次导出 PDF 转圈)"` 摘要每轮都变,而且放在用户消息的最前面。
- `history.append({"role": "assistant", "content": resp.choices[0].message.content or ""})` 模型的回复也要追加,下一轮的前缀才和这一轮的完整请求一样。

</div>

```bash
uv run python -m part07.history_cache append E1
uv run python -m part07.history_cache rewrite E2
```

```text
append  第 1 轮 输入 2592  命中 0
append  第 2 轮 输入 2870  命中 2560
append  第 3 轮 输入 3147  命中 2816
append  第 4 轮 输入 3425  命中 3072
rewrite 第 1 轮 输入 2608  命中 0
rewrite 第 2 轮 输入 2608  命中 2176
rewrite 第 3 轮 输入 2608  命中 2176
rewrite 第 4 轮 输入 2608  命中 2176
```

append 的命中数每轮往上涨:上一轮的整个请求成了这一轮的前缀,所以第 4 轮 3425 个 token 里有 3072 个命中,没命中的只有 353 个,基本就是这一轮新加的内容。rewrite 的命中永远停在 2176,摘要后面的 432 个 token 每轮都原价。

这不是说「永远不要压缩历史」。append 的输入一直在长,聊到几十轮总会超出上下文或者变得很贵,到时候还是要压缩([Day 263](/blog/agent-zero/day-263-compaction/)讲过)。对缓存友好的做法是隔一段时间压缩一次,压缩完之后又只往后加,而不是每一轮都重写开头。

</details>

### 练习 3:时间放错位置要多花多少

假设你的 draft 节点每天处理 3000 张工单,规范 2300 token、工单和事实 150 token、输出 50 token,全部按 flash 高峰价。有人在 system 第一行加了「当前时间:时分秒」。估算一个月(30 天)多花多少钱。

<details><summary>参考答案</summary>

```text
时间在末尾(按实测,命中 2176):
  2176 × 0.04 + (2450 − 2176) × 2 + 50 × 8 = 87.04 + 548 + 400 = 1035.04  元 / 百万
时间在开头(0 命中):
  2450 × 2 + 50 × 8 = 4900 + 400 = 5300                              元 / 百万
每次多花:(5300 − 1035.04) / 1,000,000 ≈ 0.00426 元
一个月:0.00426 × 3000 × 30 ≈ 384 元
```

一行字,一个月多花 384 块。draft 一个月的总花费从约 93 元(1035.04 / 1,000,000 × 90000)变成约 477 元(5300 / 1,000,000 × 90000),涨到 5 倍多。这道题是纸面计算,用的是第三步实测的命中数。真遇到这种事,你会在 `cache_report.py` 里看到 draft 的命中率从九成掉到 0。

</details>

### 练习 4:命中率报警

给 `cache_report.py` 加一个检查:某个节点的输入总数超过 10000 token、但命中率低于 50% 时,在那一行后面打印 `!! 命中率偏低,检查前缀里是不是混进了会变的东西`。分别对 P 批和 R 批跑一次。

<details><summary>参考答案</summary>

在 `print(f"{node:<9} 调用 ...")` 那一行后面加两行(和它同样缩进,在 `for node, calls in by_node.items():` 循环里面):

```python
# agent-zero-lab/part07/cache_report.py(加在每个节点的 print 后面)
    if prompt > 10_000 and hit / prompt < 0.5:
        print("  !! 命中率偏低,检查前缀里是不是混进了会变的东西")
```

<div class="line-notes">

- `if prompt > 10_000 and hit / prompt < 0.5:` 输入总量太小的节点(比如 classify 一共 290 token)本来就没东西可缓存,不该报警,所以先卡一个量。阈值 10000 和 50% 是我随手定的,上线后按自己系统的正常水平调。
- `print("  !! 命中率偏低,检查前缀里是不是混进了会变的东西")` 真实系统里这里应该发告警(第六部分讲过的监控),而不是打印。

</div>

```bash
uv run python -m part07.cache_report P
uv run python -m part07.cache_report R
```

```text
classify  调用  8 次  输入    290  命中      0(0%)  实付 0.0346 分  不算缓存 0.0346 分
draft     调用  6 次  输入  14530  命中   2176(15%)  实付 1.3542 分  不算缓存 1.5674 分
  !! 命中率偏低,检查前缀里是不是混进了会变的东西
合计 实付 1.3888 分,不算缓存 1.6020 分,省了 13%
classify  调用  8 次  输入    290  命中      0(0%)  实付 0.0346 分  不算缓存 0.0346 分
draft     调用  6 次  输入  14536  命中  13312(92%)  实付 0.2622 分  不算缓存 1.5668 分
合计 实付 0.2968 分,不算缓存 1.6014 分,省了 81%
```

P 批的 draft 报警了,classify 虽然 0% 但量太小没报,R 批干净。

</details>

**验收标准**:能讲清 `prefix_sim.py` 三行输出各说明什么;能跑出 `where_change.py` 的六行,并说出时间放开头和放末尾为什么差这么多;能跑出 P、R 两批的 `cache_report.py`,解释 draft 命中率从 15% 到 92% 的原因;能说出为什么 classify 不该共享规范前缀。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| prompt caching(提示词缓存、前缀缓存) | 厂商把请求开头部分算好的中间结果存起来,下次请求开头一样时直接复用,这部分按很低的价格收费 |
| 前缀 | 从第一个 token 开始的一段连续内容。缓存只认前缀,中间某处不同,之后的全部不算 |
| 命中率 | 命中缓存的输入 token ÷ 全部输入 token。实测 draft 定稿后约 92% |
| 落盘 | DeepSeek 文档的说法,指前缀被写进缓存。没落盘的前缀不能命中 |
| 缓存块 | 缓存存储的最小单位。DeepSeek 实测命中数都是 128 token 的整数倍 |
| 冷启动 | 缓存还没建好时同时发出的一批请求,谁也用不上谁的缓存,全部原价 |
| 预热 | 在大批请求前先单独发一次,把缓存建好 |
| `cache_control` | Anthropic API 里标记缓存断点的字段,不标就不缓存 |
| 缓存写入费 | Anthropic 和 OpenAI 新模型在建缓存时额外收的钱,按输入价的 1.25 到 2.5 倍 |

## 常见误区

**把会变的东西放在提示词最前面。** 当前时间、请求 ID、用户名、版本号写在 system 第一行,后面几千 token 每次都原价。实测时间放开头命中 0%,放末尾 91%。

**以为「内容一样」就能命中。** 缓存认的是位置加内容。同样的规范,接在工单后面(P 批)命中 15%,放在最前面(R 批)92%。

**工具列表顺序不固定。** 按权限过滤、从集合里拼出来的工具列表,顺序可能每次不同。排序后再发。在 DeepSeek 上实测只损失工具那一段(256 token),在 Anthropic 上工具在最前面,会全部失效。

**为了共享前缀把短提示词也加长。** classify 本来 36 个 token,套上 2300 token 的规范后,就算命中一次也要 251.5 元/百万,是原来的近 6 倍;没命中更是 50 多倍。共享前缀前先算账。

**以为同样的请求第二次一定 100% 命中。** 实测一字不差的第二次请求也只命中 2176/2371。DeepSeek 的缓存「尽力而为」,在哪里切块由它决定。

**以为第一次请求也打折。** 建缓存的那次是原价,Anthropic 上还要多付 25% 的写入费。一天只调几次的长提示词,缓存可能早就过期了,省不到钱。

**上线后不看命中率。** DeepSeek 的缓存自动生效,命中率掉了没有任何报错,只会账单变贵。用 `cache_report.py` 这类报表每天看一眼,或者像练习 4 一样加报警。

## 学习资料

### 文档与文章

- [DeepSeek API 文档 · 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):今天大部分实验的依据。「落盘」「尽力而为」「几个小时到几天」都出自这一页,两个例子(多轮对话、长文本问答)正好对应练习 2 和第二步。中文,10 分钟。
- [OpenAI · Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching):OpenAI 的自动缓存、`prompt_cache_key`、保留时长和写入费用。最后一节的结构建议和今天的四条规矩基本一致。英文,20 分钟。
- [Claude 文档 · Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching):显式断点、自动模式、写入和读取的价格倍数、tools → system → messages 的失效层级。今天第七步的表格大半来自这里。英文,30 分钟,很长,先看 How it works 和 What invalidates the cache 两节。
- [Manus · Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus):一个做通用 Agent 的团队把 KV cache 命中率当成最重要的指标,文中「保持前缀稳定」「只追加」「不要动态增删工具」几条和今天的实验一一对应。英文,20 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1keLp6GERQ&autoplay=0&high_quality=1" title="什么是缓存命中?8分钟说清楚KVCache与Prompt Cache" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>费曼学徒冬瓜 · 什么是缓存命中?8分钟说清楚KVCache与Prompt Cache · 约 8 分钟。从 KV cache 讲到跨请求的提示词缓存,和第一步的模拟是同一个思路,适合先看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1pdH765EUC&autoplay=0&high_quality=1" title="同样的字,「缓存命中」凭什么便宜九成?一期讲透 KV 缓存" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>辞月赴尘 · 同样的字,「缓存命中」凭什么便宜九成?一期讲透 KV 缓存 · 约 17 分钟。讲得更深一些,解释厂商为什么愿意把命中价降这么多。看完再回来看第七步的价格表会更有感觉。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/_0uiiJfsBPI" title="How and When to Use Anthropic's Prompt Caching Feature (with code examples)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Mark Kashef · How and When to Use Anthropic's Prompt Caching Feature (with code examples) · 英文。带代码演示 Anthropic 的 `cache_control` 怎么标、什么时候值得开,补上我们没在 Claude 上实跑的那一块。视频里的价格以 Claude 文档当天为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/80bIUggRJf4" title="The KV Cache: Memory Usage in Transformers" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Efficient NLP · The KV Cache: Memory Usage in Transformers · 英文,约 8 分钟。讲 KV cache 占多少显存,解释了为什么厂商的缓存要按块存、过一阵就要清。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》,Chip Huyen,O'Reilly,2025。推理优化那一章讲了 prompt caching 和 KV cache 的关系,以及它对延迟和成本的影响。英文原版,我没查到正式出版的中译本。

### 开源项目与代码

- [vllm-project/vllm](https://github.com/vllm-project/vllm):最常用的开源推理引擎,自动前缀缓存(Automatic Prefix Caching)的[设计文档](https://docs.vllm.ai/en/latest/design/prefix_caching.html)讲了它怎么按块算 hash、怎么判断命中,和第一步的 `prefix_sim.py` 是一个思路的工业版。
- [sgl-project/sglang](https://github.com/sgl-project/sglang):另一个推理引擎,用一棵前缀树(RadixAttention)管理缓存,[这篇博客](https://lmsys.org/blog/2024-01-17-sglang/)有图解。以后自己部署模型(第十部分)时会再见到它们。

## 自测

1. 为什么在 system 第一行加一个时间戳,会让后面 2000 多个 token 全部无法命中?

<details><summary>答案</summary>

模型从左到右处理 token,每个 token 的中间结果都取决于它前面所有的 token。第一个 token 变了,后面每个 token 的中间结果都跟着变,存下来的旧结果对不上。缓存只能从开头逐块比,第一块就不同,命中就是 0。实测时间放开头 0%,同样的时间放末尾 91%。

</details>

2. 一模一样的请求连发两次,第二次输入 2371、命中 2176。为什么不是 2371?

<details><summary>答案</summary>

DeepSeek 按块缓存(实测 128 token 一块),而且只在它自己决定的位置落盘,文档说缓存是「尽力而为」。2176 = 17 × 128,剩下的 195 个 token 不在已落盘的块里。能控制的是让不变的部分尽量长、尽量稳。

</details>

3. 在 DeepSeek 上打乱工具顺序,命中从 2560 掉到 2304;换到 Anthropic 上,同样的改动会怎样?为什么?

<details><summary>答案</summary>

Anthropic 会全部失效。DeepSeek 实测把工具定义放在系统提示词后面,打乱只影响工具那一段;Anthropic 的前缀顺序是 tools → system → messages,工具在最前面,文档写明工具定义一变,三层缓存都失效。所以工具列表要排序后再发,不管用哪家。

</details>

4. 第六步里,classify 共享了规范前缀,命中率 46%,为什么反而贵了 30 倍?

<details><summary>答案</summary>

命中只让那 2176 个 token 便宜,并不免费,而 classify 原来只需要 36 个 token。共享前缀后,命中的一次约 251.5 元/百万,是原来 44 的近 6 倍;再加上冷启动时 4 次并发没命中,每次 2384 元/百万。共享前缀只在被共享的那个调用本来就有一段长提示词时才划算。

</details>

5. (面试题)你接手一个 Agent 项目,发现 DeepSeek 账单上缓存命中率只有 10%,系统提示词有 3000 token。你会怎么排查和优化?

<details><summary>答案</summary>

参考答法:先按节点拆命中率(像 `cache_report.py` 那样),找出命中率低、输入量大的节点。然后看这个节点的请求是怎么拼的,逐条对照规矩:system 里有没有时间、请求 ID、用户名这类每次都变的内容;动态内容(检索结果、工单)是不是插在了规范前面;工具列表的顺序是不是固定的;多轮对话是不是每轮都在改前面的内容(比如重写摘要)。也要看并发:一大批请求同时进来的冷启动可以靠预热解决。改完用同一个报表对比前后命中率和每张工单成本,并跑评测确认回答质量没变,因为改提示词结构可能影响效果。如果换到 Anthropic,还要注意断点的位置,标错了会白付写入费。

</details>

## 明天预告

Day 398 · 第 57 周复习。这一周从超时、断点续跑、工单 worker 上线、Temporal 一路讲到成本的前两课,明天把这六天串成一张图,把最容易错的坑过一遍,再默写一个小程序:带超时、崩了能接着跑、每次调用都记账、规范前缀能命中缓存的批量起草脚本。
