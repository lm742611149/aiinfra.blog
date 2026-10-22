---
title: 'Day 124 · 算钱:从 usage 到人民币'
description: '把 usage 换成人民币:输入分缓存命中和未命中两种价,输出(含推理)一种价,DeepSeek 还分高峰和空闲。写 common/cost.py(Price、parse_price、split_input、call_cost)和 6 个测试,先故意写一个把命中部分算两遍的 bug 让测试抓住;再用一段 2615 token 的系统提示词实测:第二次起命中 2432 个,单次从 0.0054 元降到 0.0006 元。最后算一个每天一万次的客服 Agent,有没有缓存每月差 352 元和 1782 元。'
pubDate: 2026-10-23
regime: none
tags: ['api', 'cost', 'deepseek', 'pytest', 'python', 'agent-zero']
series: 'agent-zero'
day: 124
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 123](/blog/agent-zero/day-123-openai-compatible/) 我们把每家厂商的配置放进单独的文件:`.env` 是 DeepSeek,`.env.sf` 是硅基流动,每个文件里四个同名变量 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`LLM_EXTRA_BODY`,用 `ENV_FILE` 选一家,代码一行不改。还踩了 `override=True` 不写时「说是硅基流动、发去 DeepSeek」的坑,看到了兼容的边界:同一个 DeepSeek V4 Flash,两家的默认思考开关和答题准确率都不一样。

两家还有一个不一样的地方昨天没细说:价格。Day 120 我们手算过第一次调用花了 0.000144 元,Day 122 认全了 `usage` 里的每个数。今天把这两件事接起来,写一个以后每个脚本都能用的算钱模块。做 Agent 的人必须会算这笔账:Agent 一个任务要调好几次模型,每次都带着长长的系统提示词和工具定义,钱花在哪里、能省多少,全在今天这个算式里。

## 今天要解决的问题

学完今天,你应该能做到:

1. 看懂 DeepSeek 和硅基流动的价格表,会用「命中 × 命中价 + 未命中 × 未命中价 + 输出 × 输出价」手算一次调用花了多少钱,知道推理 token 按输出价算。
2. 说清楚缓存命中价为什么便宜、什么样的请求能命中,并在 DeepSeek 上实测出缓存省了多少钱。
3. 写出 `common/cost.py` 和它的测试 `tests/test_llm_cost.py`,能处理「DeepSeek 有命中字段」「别家只有 `cached_tokens`」「什么都没有」三种情况。
4. 给每个配置文件加上 `LLM_PRICE`,用它估算一个 Agent 一个月的模型费用。

今天的两个新概念:**计费算式**和**缓存价**。

预计用时:2–2.5 小时。实跑花费:DeepSeek 3 次长提示词调用合计约 0.0067 元,硅基流动 3 次约 0.0185 元,加上零碎调用,全天不到 0.03 元(文末有算式)。前置:[Day 122](/blog/agent-zero/day-122-api-response/) 的 `usage` 字段和 `data/responses.jsonl`,[Day 123](/blog/agent-zero/day-123-openai-compatible/) 的 `.env.sf` 和 `ENV_FILE`,[Day 117](/blog/agent-zero/day-117-moe-kvcache/) 的 KV cache,[Day 71](/blog/agent-zero/day-071-pytest-1/) 到 [Day 73](/blog/agent-zero/day-073-pytest-3/) 的 pytest,[Day 50](/blog/agent-zero/day-050-dataclass/) 的 dataclass。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `common/cost.py` 和测试默写出来;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 价格表:三种 token,两个时段

先看 DeepSeek 的官方价格(2026 年 10 月 22 日查 [DeepSeek 价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing),单位:元每百万 token):

| 模型 | 时段 | 输入(缓存命中) | 输入(缓存未命中) | 输出 |
| --- | --- | --- | --- | --- |
| deepseek-flash | 高峰 | 0.04 | 2 | 8 |
| deepseek-flash | 空闲 | 0.02 | 1 | 4 |
| deepseek-v4-pro | 高峰 | 0.30 | 9 | 27 |
| deepseek-v4-pro | 空闲 | 0.15 | 4.5 | 13.5 |

高峰时段是北京时间周一到周五(法定节假日除外)的 9:00–12:00 和 14:00–18:00,其余时间都是空闲价,正好是高峰价的一半。

再看昨天的第二家,硅基流动的 `deepseek-ai/DeepSeek-V4-Flash`(同一天查 [硅基流动定价页](https://siliconflow.cn/pricing)):

| 时段 | 输入 | 输出 | 缓存命中 |
| --- | --- | --- | --- |
| 0:00–2:00、8:00–24:00 | 3 | 9 | 0.30 |
| 2:00–8:00 | 1.5 | 4.5 | 0.15 |

同一个模型,硅基流动的输入贵 50%,缓存命中价贵 7.5 倍,时段也是另一套划法。这又是一个「兼容不管」的地方。

这张表里有三种 token,单价各不相同:

- **输入,缓存未命中**:正常的输入价。你发过去的 `messages` 里,DeepSeek 以前没见过的那部分。
- **输入,缓存命中**:你发过去的开头部分,和之前某次请求一模一样,DeepSeek 直接从缓存里读,按命中价算。DeepSeek 是未命中的 1/50。
- **输出**:模型生成的每个 token,**包括思考模式下的推理 token**。输出比输入贵 4 倍,因为输出要一个一个地生成,每个都要跑一遍模型([Day 106](/blog/agent-zero/day-106-next-token/));输入可以一次性并行算完。

注意价格表上没有「推理 token」这一列。[Day 122](/blog/agent-zero/day-122-api-response/) 说过,`completion_tokens` 已经包含了 `reasoning_tokens`,推理就按输出价收钱。

## 手算两次

**第一次**,拿 Day 122 `show_response.py` 那次调用:`prompt_cache_hit_tokens=0`、`prompt_cache_miss_tokens=27`、`completion_tokens=67`。按高峰价:

```text
(0 × 0.04 + 27 × 2 + 67 × 8) ÷ 1,000,000
= (0 + 54 + 536) ÷ 1,000,000
= 0.00059 元
```

那次是晚上 11 点 50 分跑的,空闲时段,实际减半,0.000295 元。你会发现大头在输出:67 个输出 token 花的钱是 27 个输入的 10 倍。短问题、长回答的场景,省钱的重点在输出。

**第二次**,拿 Day 122 练习 2 存下的第三条,开着思考问退款题:输入 51(未命中)、输出 275(其中推理 168)。

```text
(51 × 2 + 275 × 8) ÷ 1,000,000
= (102 + 2200) ÷ 1,000,000
= 0.002302 元
```

275 个输出里推理占 168 个,这次 0.0023 元里有 168 × 8 ÷ 1,000,000 ≈ 0.0013 元是买「思考过程」的,超过一半。所以 Day 121 起我们默认关思考,只在真需要推理时打开。

把算式写成一般形式,下面的代码就是照着它写的:

```text
花费(元) = (命中数 × 命中价 + 未命中数 × 未命中价 + 输出数 × 输出价) ÷ 1,000,000
```

其中命中数加未命中数等于 `prompt_tokens`,输出数就是 `completion_tokens`(已含推理)。除以一百万是因为单价按「每百万 token」报。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="一次调用的花费拆成三段:缓存命中输入、未命中输入、输出,命中部分单价只有未命中的五十分之一">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">同一个请求的 token(cache_cost.py 第二次调用)</text>
<rect x="20" y="40" width="420" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="60" fill="var(--mem)">命中 2432 × 0.04</text>
<rect x="440" y="40" width="40" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="490" y="60" fill="var(--compute)">未命中 183 × 2</text>
<rect x="20" y="78" width="4" height="30" fill="var(--ink-soft)"/>
<text x="32" y="98" fill="var(--ink)">输出 20 × 8</text>
<text x="20" y="140" fill="var(--ink-soft)">换成钱(元,×10⁻⁶)</text>
<rect x="20" y="152" width="61" height="30" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="30" y="172" fill="var(--mem)">97</text>
<rect x="81" y="152" width="229" height="30" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="150" y="172" fill="var(--compute)">366</text>
<rect x="310" y="152" width="100" height="30" fill="none" stroke="var(--ink-soft)"/>
<text x="340" y="172" fill="var(--ink)">160</text>
<text x="420" y="172" fill="var(--ink)">= 623</text>
<text x="20" y="214" fill="var(--ink-faint)">token 数最多的命中部分,钱最少;183 个未命中反而是大头</text>
<text x="20" y="234" fill="var(--ink-faint)">同样 2615 个输入全不命中:5230 + 160 = 5390</text>
</g>
</svg>
<figcaption>上面一行按 token 数画宽度,下面一行按钱画宽度。命中缓存的 2432 个 token 在账单上只占 97,这就是缓存价的威力。数字来自下面的实跑。</figcaption>
</figure>

## 缓存价:同样的字为什么便宜 50 倍

[Day 117](/blog/agent-zero/day-117-moe-kvcache/) 讲过 KV cache:模型读输入时,要给每个 token 算出 key 和 value;因为有因果遮罩,前面 token 的 key 和 value 只取决于它和它之前的 token,和后面是什么无关。所以,如果这次请求的**开头**和之前某次请求一模一样,这段开头的 key 和 value 就和上次完全相同,厂商把它们存起来,下次直接读,不用重算。省掉了计算,DeepSeek 就把这部分按 1/50 的价格卖给你。DeepSeek 管这个叫「上下文硬盘缓存」,默认对所有人开启,不用改代码。

三条规则决定了能不能命中:

- **只看开头**。缓存的是「从第一个 token 开始的一段前缀」。两次请求中间有一个字不同,从这个字往后就全部不命中了。所以 Day 117 实测时,把时间戳放在提示词开头会让缓存全部失效。
- **按块存**。不是每个 token 都能命中,Day 117 观察到命中数总是 64 的整数倍,零头不命中。[DeepSeek 的缓存文档](https://api-docs.deepseek.com/zh-cn/guides/kv_cache)只说「以一定的 token 数量为间隔」切分,没写具体多少。
- **尽力而为**。文档说缓存不保证 100% 命中,一段时间不用会被清掉。

落到写代码上就一句话:**不变的东西放前面,变的东西放后面**。Agent 每一步都带着同样的系统提示词和工具定义,把它们放在 `messages` 最前面,用户的问题和每一步的新结果放后面,这样从第二步开始,开头那一大段都按命中价算。第四部分讲上下文工程时会反复用到这条。

## 写 common/cost.py

以后几乎每个脚本都要算钱,所以把它写成一个共享模块,放在练习仓库的 `common/` 目录。这是 `common/` 的第一个文件,先把目录和空的 `__init__.py` 建好(和 [Day 33](/blog/agent-zero/day-033-packages/) 给 `part01/` 建 `__init__.py` 是一个道理,让 `common` 成为一个包):

```bash
mkdir -p common
touch common/__init__.py
```

你可能记得 [Day 71](/blog/agent-zero/day-071-pytest-1/) 写过 `part01/cost.py` 的 `total_cost(prompt_tokens, completion_tokens, price_in, price_out)`。它只有输入和输出两种价,不认识缓存。今天的版本多了缓存、直接吃 SDK 的 `usage` 对象、能处理不同厂商的字段差异。`part01/cost.py` 留着不动,那是学 pytest 的教具。

新建 `common/cost.py`:

```python
# agent-zero-lab/common/cost.py
from dataclasses import dataclass

from openai.types import CompletionUsage


@dataclass(frozen=True)
class Price:
    """三个单价,单位:元 / 百万 token。"""

    hit: float
    miss: float
    out: float


def parse_price(raw: str) -> Price:
    parts = [float(x) for x in raw.split(",")]
    if len(parts) != 3:
        raise ValueError(f"价格要写 3 个数(命中,未命中,输出),你给了 {len(parts)} 个:{raw!r}")
    return Price(parts[0], parts[1], parts[2])


def split_input(usage: CompletionUsage) -> tuple[int, int]:
    extra = usage.model_extra or {}
    hit = extra.get("prompt_cache_hit_tokens")
    if hit is None and usage.prompt_tokens_details is not None:
        hit = usage.prompt_tokens_details.cached_tokens
    hit = hit or 0
    return hit, usage.prompt_tokens - hit


def call_cost(usage: CompletionUsage, price: Price) -> float:
    hit, miss = split_input(usage)
    return (hit * price.hit + miss * price.miss + usage.completion_tokens * price.out) / 1_000_000
```

<div class="line-notes">

- `from dataclasses import dataclass` [Day 50](/blog/agent-zero/day-050-dataclass/) 学的 dataclass,用来定义「只装数据」的小类。
- `from openai.types import CompletionUsage` `usage` 的类型。Day 122 的 `resp.usage` 就是它的实例。
- `@dataclass(frozen=True)` `frozen=True` 让对象建好以后不能改字段。价格是一组配置,算到一半被谁改了会很难查,冻住更安全;改了会直接报错。
- `class Price:` 三个单价打包成一个对象。比传三个散的 `float` 好:函数签名短,也不会把命中价和未命中价传反。Day 71 的 bug 正是「两个价格传反了」。
- `hit: float` 缓存命中的输入价。DeepSeek 高峰 0.04。
- `miss: float` 缓存未命中的输入价。DeepSeek 高峰 2。
- `out: float` 输出价,推理也算在这里。DeepSeek 高峰 8。
- `def parse_price(raw: str) -> Price:` 把配置文件里的 `"0.04,2,8"` 这种字符串变成 `Price`。
- `parts = [float(x) for x in raw.split(",")]` 先按逗号切成 `["0.04", "2", "8"]`,再逐个转成浮点数,得到 `[0.04, 2.0, 8.0]`。[Day 23](/blog/agent-zero/day-023-comprehensions/) 的列表推导式,相当于 JS 的 `raw.split(",").map(Number)`。
- `if len(parts) != 3:` 少写或多写一个数,在读配置时就报错,而不是算出一个莫名其妙的数。
- `raise ValueError(f"价格要写 3 个数(命中,未命中,输出),你给了 {len(parts)} 个:{raw!r}")` 实跑 `parse_price("2,8")` 报 `ValueError: 价格要写 3 个数(命中,未命中,输出),你给了 2 个:'2,8'`。报错信息里把原始字符串也带上,一看就知道配置写错了哪里。
- `return Price(parts[0], parts[1], parts[2])` 实跑 `parse_price("0.04,2,8")` 得到 `Price(hit=0.04, miss=2.0, out=8.0)`。
- `def split_input(usage: CompletionUsage) -> tuple[int, int]:` 把输入拆成(命中,未命中)两个数。单独拆成一个函数,是因为各家厂商在这里差别最大,测试也好单独测。
- `extra = usage.model_extra or {}` Day 122 讲过,DeepSeek 自己加的字段在 `model_extra` 这个字典里。
- `hit = extra.get("prompt_cache_hit_tokens")` 先找 DeepSeek 的字段。DeepSeek 和硅基流动都有,实跑 `cache_cost.py` 第二次调用得到 `2432`。没有这个字段的厂商得到 `None`。
- `if hit is None and usage.prompt_tokens_details is not None:` DeepSeek 的字段没有,再找 OpenAI 标准的 `prompt_tokens_details.cached_tokens`。很多兼容厂商只给这一个。
- `hit = usage.prompt_tokens_details.cached_tokens` 这个值本身也可能是 `None`(厂商给了 `prompt_tokens_details` 但没填它)。
- `hit = hit or 0` 两处都没找到,就当没命中:全部按未命中价算,宁可算贵,不算便宜。
- `return hit, usage.prompt_tokens - hit` 未命中数用总输入减命中数,不去读 `prompt_cache_miss_tokens`,因为别家没有这个字段。DeepSeek 文档写明两者之和等于 `prompt_tokens`,所以结果一样。实跑第二次调用:`(2432, 183)`。
- `def call_cost(usage: CompletionUsage, price: Price) -> float:` 一次调用花多少元。
- `hit, miss = split_input(usage)` 元组解包([Day 22](/blog/agent-zero/day-022-tuples-unpack/)),相当于 JS 的 `const [hit, miss] = splitInput(usage)`。
- `return (hit * price.hit + miss * price.miss + usage.completion_tokens * price.out) / 1_000_000` 就是上面那个算式。代入第二次调用:(2432 × 0.04 + 183 × 2 + 20 × 8) ÷ 1,000,000 = (97.28 + 366 + 160) ÷ 1,000,000 ≈ 0.000623 元。

</div>

## 测试:先让它抓住一个 bug

算钱的代码错了不会报错,只会悄悄给你一个错的数,所以一定要有测试。[Day 72](/blog/agent-zero/day-072-pytest-2/) 已经在 `pyproject.toml` 里配好了 `pythonpath = ["."]` 和 `testpaths = ["tests"]`,`tests/` 里的测试能直接 `from common.cost import ...`。

`tests/` 里已经有 Day 71 的 `test_cost.py`(测 `part01/cost.py` 的),新文件起名 `test_llm_cost.py`,别重名。新建 `tests/test_llm_cost.py`:

```python
# agent-zero-lab/tests/test_llm_cost.py
import pytest
from openai.types import CompletionUsage

from common.cost import Price, call_cost, parse_price, split_input

PEAK = Price(hit=0.04, miss=2, out=8)


def make_usage(data: dict) -> CompletionUsage:
    return CompletionUsage.model_validate(data)


def test_parse_price():
    assert parse_price("0.04,2,8") == PEAK


def test_parse_price_wrong_count():
    with pytest.raises(ValueError, match="3 个数"):
        parse_price("2,8")


def test_deepseek_usage_no_cache():
    u = make_usage({"prompt_tokens": 27, "completion_tokens": 67, "total_tokens": 94,
                    "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 27})
    assert split_input(u) == (0, 27)
    assert call_cost(u, PEAK) == pytest.approx(0.00059)


def test_deepseek_usage_with_cache():
    u = make_usage({"prompt_tokens": 3500, "completion_tokens": 400, "total_tokens": 3900,
                    "prompt_cache_hit_tokens": 3000, "prompt_cache_miss_tokens": 500})
    assert call_cost(u, PEAK) == pytest.approx(0.00432)


def test_openai_style_cached_tokens():
    u = make_usage({"prompt_tokens": 3500, "completion_tokens": 400, "total_tokens": 3900,
                    "prompt_tokens_details": {"cached_tokens": 3000}})
    assert split_input(u) == (3000, 500)


def test_no_cache_info_counts_all_as_miss():
    u = make_usage({"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110})
    assert split_input(u) == (0, 100)
    assert call_cost(u, PEAK) == pytest.approx(0.00028)
```

<div class="line-notes">

- `from common.cost import Price, call_cost, parse_price, split_input` 能这样导入,靠的是 Day 72 配的 `pythonpath = ["."]`。
- `PEAK = Price(hit=0.04, miss=2, out=8)` DeepSeek flash 的高峰价,几个测试共用。按字段名传参,比按位置传更不容易搞错顺序。
- `def make_usage(data: dict) -> CompletionUsage:` 不调 API,用一个字典造出一个假的 `usage` 对象。测试不花钱、不联网、每次结果一样。
- `return CompletionUsage.model_validate(data)` [Day 52](/blog/agent-zero/day-052-pydantic-2/) 学的 `model_validate`:用字典建 pydantic 对象。字典里 DeepSeek 自己的字段(`prompt_cache_hit_tokens`)也会被收下,放进 `model_extra`,和真实响应一模一样。
- `assert parse_price("0.04,2,8") == PEAK` dataclass 自动生成了 `==`,按字段逐个比。`2.0 == 2` 在 Python 里是 `True`。
- `with pytest.raises(ValueError, match="3 个数"):` [Day 73](/blog/agent-zero/day-073-pytest-3/) 学的:断言下面这行一定抛 `ValueError`,而且报错信息里包含「3 个数」。
- `u = make_usage({"prompt_tokens": 27, "completion_tokens": 67, "total_tokens": 94,` 第一个用例用的是 Day 122 `show_response.py` 的真实数字。
- `assert call_cost(u, PEAK) == pytest.approx(0.00059)` 上面手算的结果。浮点数有误差,`0.1 + 0.2` 在 Python 和 JS 里都不等于 `0.3`,所以比较浮点数用 `pytest.approx`,它允许极小的误差。
- `"prompt_cache_hit_tokens": 3000, "prompt_cache_miss_tokens": 500})` 带缓存的情况:3000 命中、500 未命中、400 输出。手算 (3000 × 0.04 + 500 × 2 + 400 × 8) ÷ 1,000,000 = (120 + 1000 + 3200) ÷ 1,000,000 = 0.00432。
- `"prompt_tokens_details": {"cached_tokens": 3000}})` 模拟只给 OpenAI 标准字段的厂商,看 `split_input` 能不能退到 `cached_tokens`。
- `u = make_usage({"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110})` 什么缓存信息都没有的厂商。
- `assert split_input(u) == (0, 100)` 全部按未命中算。100 × 2 + 10 × 8 = 280,所以下一行是 0.00028。

</div>

先别急着跑通。我第一次写 `call_cost` 时犯过一个很自然的错:脑子里想着「输入按输入价、命中的再按命中价」,写成了 `hit * price.hit + usage.prompt_tokens * price.miss + ...`,也就是**命中的那部分算了两遍**,一遍按命中价,一遍又混在 `prompt_tokens` 里按未命中价。你可以把 `common/cost.py` 最后一行临时改成这样,跑测试看看:

```bash
uv run pytest tests/test_llm_cost.py -q
```

```text
...F..                                                                   [100%]
=================================== FAILURES ===================================
________________________ test_deepseek_usage_with_cache ________________________

    def test_deepseek_usage_with_cache():
        u = make_usage({"prompt_tokens": 3500, "completion_tokens": 400, "total_tokens": 3900,
                        "prompt_cache_hit_tokens": 3000, "prompt_cache_miss_tokens": 500})
>       assert call_cost(u, PEAK) == pytest.approx(0.00432)
E       assert 0.01032 == 0.00432 ± 4.3e-09
E         
E         comparison failed
E         Obtained: 0.01032
E         Expected: 0.00432 ± 4.3e-09

tests/test_llm_cost.py:33: AssertionError
=========================== short test summary info ============================
FAILED tests/test_llm_cost.py::test_deepseek_usage_with_cache - assert 0.0103...
1 failed, 5 passed in 1.88s
```

有意思的是,6 个测试只挂了 1 个。其他几个用例要么没有命中(命中数是 0,算两遍也是 0),要么只测 `split_input`,都发现不了这个 bug。只有「命中数不为 0、并且检查了金额」的那个用例抓住了它:算出 0.01032 元,是正确值的 2.4 倍。这说明测试用例要覆盖「有缓存」这种真实情况,只测最简单的路径不够。改回 `miss * price.miss`,再跑:

```bash
uv run pytest tests/test_llm_cost.py -v
```

```text
tests/test_llm_cost.py::test_parse_price PASSED                          [ 16%]
tests/test_llm_cost.py::test_parse_price_wrong_count PASSED              [ 33%]
tests/test_llm_cost.py::test_deepseek_usage_no_cache PASSED              [ 50%]
tests/test_llm_cost.py::test_deepseek_usage_with_cache PASSED            [ 66%]
tests/test_llm_cost.py::test_openai_style_cached_tokens PASSED           [ 83%]
tests/test_llm_cost.py::test_no_cache_info_counts_all_as_miss PASSED     [100%]

============================== 6 passed in 1.84s ===============================
```

## 价格放进配置文件

价格和地址、模型名一样,跟着厂商走,所以也放进 Day 123 的配置文件。打开 `.env`,在最后加一行:

```bash
# agent-zero-lab/.env(加在最后)
LLM_PRICE=0.04,2,8
```

<div class="line-notes">

- `LLM_PRICE=0.04,2,8` 顺序固定是「命中,未命中,输出」,和 `Price` 的字段顺序一样。DeepSeek 我填的是高峰价:写代码时宁可把成本估高,空闲时段实际只花一半。

</div>

`.env.sf` 也加一行:

```bash
# agent-zero-lab/.env.sf(加在最后)
LLM_PRICE=0.3,3,9
```

<div class="line-notes">

- `LLM_PRICE=0.3,3,9` 硅基流动 0:00–2:00 和 8:00–24:00 的价格,同样取贵的那档。

</div>

价格会变,DeepSeek 页面最后一句就是「保留调整价格的权利,建议定期查看」。我的习惯是在这一行上面加一句注释,写上查价的日期,例如 `# 2026-10-22 查 DeepSeek 价格页`。python-dotenv 会跳过 `#` 开头的行。

## 实测:缓存到底省多少

最后在 DeepSeek 上实测缓存。做一段两千多 token 的系统提示词:云簿的 120 条客服规则。连问 3 个不同的问题,系统提示词不变,看每次命中多少、花多少,再算出「如果没有缓存要花多少」。

新建 `part02/cache_cost.py`:

```python
# agent-zero-lab/part02/cache_cost.py
import json
import os
import random

from dotenv import load_dotenv
from openai import OpenAI

from common.cost import Price, call_cost, parse_price, split_input

env_file = os.environ.get("ENV_FILE", ".env")
load_dotenv(env_file, override=True)
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
extra_body = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
price = parse_price(os.environ["LLM_PRICE"])
no_cache = Price(hit=price.miss, miss=price.miss, out=price.out)

TOPICS = [
    "发票抬头开错,当月可作废重开,跨月需红字冲销后重开",
    "年付套餐 468 元,中途退订按剩余整月折算退款",
    "重复扣款在 3 个工作日内原路退回",
    "团队版每增加一个席位每月加收 15 元",
    "导出账簿支持 Excel 和 PDF 两种格式",
    "电子发票在付款后 24 小时内发到注册邮箱",
]
run_tag = random.Random().randint(100_000, 999_999)
rules = "\n".join(f"第 {i} 条:{TOPICS[i % len(TOPICS)]}。" for i in range(1, 121))
SYSTEM = f"你是云簿 CloudLedger 客服。版本 {run_tag}。只根据下面的规则回答,一句话。\n{rules}"

for question in ["第 7 条说了什么?", "第 99 条说了什么?", "第 120 条说了什么?"]:
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"],
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": question}],
        max_tokens=100,
        extra_body=extra_body,
    )
    u = resp.usage
    assert u is not None
    hit, miss = split_input(u)
    print(
        f"命中 {hit:>4} 未命中 {miss:>4} 输出 {u.completion_tokens:>3}"
        f"  实付 ¥{call_cost(u, price):.6f}  若无缓存 ¥{call_cost(u, no_cache):.6f}"
    )
```

<div class="line-notes">

- `from common.cost import Price, call_cost, parse_price, split_input` 用刚写的模块。因为要从 `part02/` 里导入 `common/`,这个脚本必须用 `-m` 方式从仓库根目录运行,下面会演示不这样做会怎样。
- `env_file = os.environ.get("ENV_FILE", ".env")` Day 123 的切厂商写法,练习 3 用它切到硅基流动。
- `price = parse_price(os.environ["LLM_PRICE"])` 从配置读价格。实跑 `.env` 得到 `Price(hit=0.04, miss=2.0, out=8.0)`。
- `no_cache = Price(hit=price.miss, miss=price.miss, out=price.out)` 造一个「命中也按未命中价算」的假价格,用来算「如果没有缓存要花多少」。因为 `Price` 是冻住的,不能改原来那个,只能新建一个。
- `TOPICS = [` 六条云簿规则,下面轮流用,凑出 120 条。
- `run_tag = random.Random().randint(100_000, 999_999)` 每次运行随机一个版本号放进提示词开头,保证每次运行的第一个请求都是「没见过的开头」,不会命中我上一次运行留下的缓存。这招是 Day 117 用过的。
- `rules = "\n".join(f"第 {i} 条:{TOPICS[i % len(TOPICS)]}。" for i in range(1, 121))` 生成 120 行规则,`i % len(TOPICS)` 让六条规则循环使用。`"\n".join(...)` 相当于 JS 的 `arr.join("\n")`。
- `SYSTEM = f"你是云簿 CloudLedger 客服。版本 {run_tag}。只根据下面的规则回答,一句话。\n{rules}"` 不变的系统提示词,放在 `messages` 最前面。实跑 2600 多个 token。
- `for question in ["第 7 条说了什么?", "第 99 条说了什么?", "第 120 条说了什么?"]:` 三个不同的问题,放在系统提示词后面。变的东西放后面,缓存才能命中。
- `assert u is not None` 告诉编辑器 `usage` 一定有值,下面就不用每次判断;真遇到 `None` 会直接报错。
- `hit, miss = split_input(u)` 实跑三次分别是 `(0, 2615)`、`(2432, 183)`、`(2432, 183)`。
- `f"  实付 ¥{call_cost(u, price):.6f}  若无缓存 ¥{call_cost(u, no_cache):.6f}"` 同一个 `usage`,用两种价格各算一次。`:.6f` 保留 6 位小数。

</div>

先犯一个错,用 Day 120 起一直用的方式运行:

```bash
uv run part02/cache_cost.py
```

```text
ModuleNotFoundError: No module named 'common'
```

[Day 72](/blog/agent-zero/day-072-pytest-2/) 遇到过同类问题(当时是 `No module named 'part01'`):`uv run part02/cache_cost.py` 时,Python 把**脚本所在的 `part02/` 目录**当成找模块的起点,那里没有 `common`。用 `-m` 方式运行,Python 从**当前目录**(仓库根目录)找,`common` 就找得到了。注意写法:点号代替斜杠,不带 `.py`:

```bash
uv run python -m part02.cache_cost
```

实跑输出(10 月 22 日 23:59 左右跑的):

```text
命中    0 未命中 2615 输出  24  实付 ¥0.005422  若无缓存 ¥0.005422
命中 2432 未命中  183 输出  20  实付 ¥0.000623  若无缓存 ¥0.005390
命中 2432 未命中  183 输出  29  实付 ¥0.000695  若无缓存 ¥0.005462
```

第一次全部未命中,这段开头 DeepSeek 没见过,花了 0.005422 元,验算一下:(2615 × 2 + 24 × 8) ÷ 1,000,000 = (5230 + 192) ÷ 1,000,000 = 0.005422。第二、三次问题不同,但开头 2432 个 token 命中了缓存,只有 183 个没命中(问题本身,加上系统提示词末尾凑不够一整块的零头;2432 正好是 64 × 38,和 Day 117 观察到的规律一样)。单次花费从 0.0054 元降到 0.0006 元,**省了约 88%**。

0.0054 元和 0.0006 元看起来都是零头。但 Agent 的特点是调用次数多、每次都带长提示词,练习 4 会算一个每天一万次的账,差别就不是零头了。另外这里按高峰价算,我跑的时候是空闲时段,实际扣的钱是这里的一半。

## 拼起来:零件对照

今天的代码就是 `common/cost.py` 这一个模块,加上用它的脚本:

| 零件 | 在哪 | 做什么 |
| --- | --- | --- |
| 价格表 + 手算 | 本文开头 | 搞清楚三种 token、两个时段 |
| `Price`、`parse_price` | `common/cost.py` 上半 | 把配置里的 `LLM_PRICE` 变成三个单价 |
| `split_input` | `common/cost.py` | 从 `usage` 拆出命中、未命中,兼容不同厂商 |
| `call_cost` | `common/cost.py` 最后 | 套算式 |
| 6 个测试 | `tests/test_llm_cost.py` | 保证算式和三种厂商情况都对,抓住「命中算两遍」 |
| `LLM_PRICE` | `.env`、`.env.sf` | 价格跟着厂商的配置走 |
| `cache_cost.py` | `part02/` | 实测缓存,用 `-m` 运行 |

Day 135 封装 `LLMClient` 时,`ChatResult` 里有一个 `cost` 字段、客户端有一个 `ledger` 账本累计花费,背后就是今天这个算式。

## 动手练习

**练习 1:给 Day 122 存下的响应算账。** [Day 122](/blog/agent-zero/day-122-api-response/) 练习 2 存了 `data/responses.jsonl`,三条响应。写 `part02/bill_saved.py`,不调 API,按 DeepSeek 高峰价和空闲价各算一遍每条的花费和合计。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/bill_saved.py
from pathlib import Path

from openai.types.chat import ChatCompletion

from common.cost import Price, call_cost

PEAK = Price(hit=0.04, miss=2, out=8)
IDLE = Price(hit=0.02, miss=1, out=4)

total_peak = 0.0
total_idle = 0.0
for line in Path("data/responses.jsonl").read_text(encoding="utf-8").splitlines():
    resp = ChatCompletion.model_validate_json(line)
    if resp.usage is None:
        continue
    peak = call_cost(resp.usage, PEAK)
    idle = call_cost(resp.usage, IDLE)
    total_peak += peak
    total_idle += idle
    print(f"{resp.id[:8]}  高峰 ¥{peak:.6f}  空闲 ¥{idle:.6f}")
print(f"合计      高峰 ¥{total_peak:.6f}  空闲 ¥{total_idle:.6f}")
```

<div class="line-notes">

- `from openai.types.chat import ChatCompletion` Day 122 练习 3 用过,把存下来的 JSON 变回响应对象。
- `IDLE = Price(hit=0.02, miss=1, out=4)` 空闲价,每项都是高峰价的一半。
- `total_peak = 0.0` 累加器,写成 `0.0` 让编辑器知道它是浮点数。
- `resp = ChatCompletion.model_validate_json(line)` 存下来时 DeepSeek 的缓存字段也存了,读回来照样在 `usage.model_extra` 里,`split_input` 能找到。
- `peak = call_cost(resp.usage, PEAK)` 同一个 `usage` 用两种价格各算一次。

</div>

```bash
uv run python -m part02.bill_saved
```

实跑输出:

```text
2476f5f6  高峰 ¥0.000326  空闲 ¥0.000163
b8acbd9d  高峰 ¥0.000276  空闲 ¥0.000138
6d143a98  高峰 ¥0.002302  空闲 ¥0.001151
合计      高峰 ¥0.002904  空闲 ¥0.001452
```

第一条:15 × 2 + 37 × 8 = 326。第三条就是上面手算的开思考那次,一条占了合计的 79%。把每次调用的响应存下来,事后想怎么算账都行,不用再花钱重跑。

</details>

**练习 2:按时间选价格。** 写 `part02/peak.py`,两个函数:`is_peak(when)` 判断一个时间是不是 DeepSeek 的高峰时段(周一到周五 9–12 点、14–18 点,节假日先不管);`price_at(when, peak)` 返回那个时间该用的价格(空闲时三个价都减半)。用 4 个时间试一下:周四 10:30、周四 12:30、周四 17:59、周六 10:30。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/peak.py
from datetime import datetime

from common.cost import Price

PEAK = Price(hit=0.04, miss=2, out=8)


def is_peak(when: datetime) -> bool:
    if when.weekday() >= 5:
        return False
    return 9 <= when.hour < 12 or 14 <= when.hour < 18


def price_at(when: datetime, peak: Price = PEAK) -> Price:
    if is_peak(when):
        return peak
    return Price(hit=peak.hit / 2, miss=peak.miss / 2, out=peak.out / 2)


if __name__ == "__main__":
    for text in ["2026-10-22 10:30", "2026-10-22 12:30", "2026-10-22 17:59", "2026-10-24 10:30"]:
        when = datetime.strptime(text, "%Y-%m-%d %H:%M")
        print(text, "周", when.weekday() + 1, "高峰" if is_peak(when) else "空闲", price_at(when))
```

<div class="line-notes">

- `from datetime import datetime` Day 122 用它转过时间戳,今天用它的星期和小时。
- `if when.weekday() >= 5:` `weekday()` 周一是 0、周日是 6,所以 5 和 6 是周六周日。注意 JS 的 `getDay()` 是周日为 0,两边不一样。
- `return 9 <= when.hour < 12 or 14 <= when.hour < 18` Python 可以连着写比较 `9 <= x < 12`,相当于 JS 的 `x >= 9 && x < 12`。用小于号表示 12:00 整已经不是高峰。
- `def price_at(when: datetime, peak: Price = PEAK) -> Price:` 第二个参数有默认值,不传就用 DeepSeek flash 的高峰价;换 v4-pro 时传它的高峰价进来。
- `return Price(hit=peak.hit / 2, miss=peak.miss / 2, out=peak.out / 2)` 空闲价是高峰价的一半,`Price` 冻住了,所以新建一个。
- `if __name__ == "__main__":` 只有直接运行这个文件时才执行下面的演示;别的文件 `import` 它时不执行。和 Node 里 `require.main === module` 一个意思。
- `when = datetime.strptime(text, "%Y-%m-%d %H:%M")` 按格式把字符串解析成时间。`%Y` 四位年、`%m` 月、`%d` 日、`%H` 小时、`%M` 分钟。

</div>

```bash
uv run python -m part02.peak
```

实跑输出:

```text
2026-10-22 10:30 周 4 高峰 Price(hit=0.04, miss=2, out=8)
2026-10-22 12:30 周 4 空闲 Price(hit=0.02, miss=1.0, out=4.0)
2026-10-22 17:59 周 4 高峰 Price(hit=0.04, miss=2, out=8)
2026-10-24 10:30 周 6 空闲 Price(hit=0.02, miss=1.0, out=4.0)
```

中午 12:30 是空闲价,17:59 还是高峰,周六上午也是空闲。没处理的情况:法定节假日(要一张节假日表),以及时区(`datetime` 默认用本机时间,服务器在国外时要换成北京时间)。一个任务跑很久、跨过 12 点时,按每次调用的时间分别算,别按任务开始的时间算。硅基流动的时段划法不同(2 点到 8 点半价),要另写一个函数。

</details>

**练习 3:硅基流动的缓存。** 用 Day 123 的 `ENV_FILE` 把 `cache_cost.py` 切到硅基流动跑一次,和 DeepSeek 的结果对比。

<details><summary>参考答案</summary>

不用改代码:

```bash
ENV_FILE=.env.sf uv run python -m part02.cache_cost
```

实跑输出(10 月 23 日 0:01 跑的,硅基流动这个时段是全价):

```text
命中    0 未命中 2614 输出  18  实付 ¥0.008004  若无缓存 ¥0.008004
命中 2048 未命中  566 输出  14  实付 ¥0.002438  若无缓存 ¥0.007968
命中    0 未命中 2614 输出  23  实付 ¥0.008049  若无缓存 ¥0.008049
```

三处和 DeepSeek 不一样:

- 第二次命中了 2048 个,比 DeepSeek 的 2432 少,看起来它的缓存块更大(2048 正好是 2 的 11 次方,具体规则它的文档没写)。
- **第三次一个都没命中**,前缀明明完全一样。聚合平台背后通常有很多台机器,两次请求被分到不同的机器上,缓存就用不上了。所以「缓存省钱」在不同厂商那里稳定程度不同,估算成本时不能照搬 DeepSeek 的命中率。
- 输入是 2614 个,比 DeepSeek 的 2615 少 1 个,两家给系统提示词套的格式标记有一点差别。

价格上,硅基流动全不命中一次 0.008 元,比 DeepSeek 高峰价的 0.0054 元贵 48%。昨天看到的「同名模型效果不同」加上今天的「价格和缓存不同」,换厂商之前这几样都要测。

</details>

**练习 4:一个客服 Agent 一个月花多少。** 假设云簿上线了一个客服 Agent,每天 1 万次调用,每次输入 2650 个 token(其中系统提示词和规则约 2430 个,能命中缓存),输出 80 个 token。按 DeepSeek 高峰价,算「命中缓存」和「全不命中」两种情况下,单次和每月(30 天)各花多少。写 `part02/budget.py`,不调 API。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/budget.py
from openai.types import CompletionUsage

from common.cost import Price, call_cost

PEAK = Price(hit=0.04, miss=2, out=8)
CALLS_PER_DAY = 10_000
DAYS = 30

with_cache = CompletionUsage.model_validate({
    "prompt_tokens": 2650, "completion_tokens": 80, "total_tokens": 2730,
    "prompt_cache_hit_tokens": 2432, "prompt_cache_miss_tokens": 218,
})
no_cache = CompletionUsage.model_validate({
    "prompt_tokens": 2650, "completion_tokens": 80, "total_tokens": 2730,
    "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 2650,
})

for name, usage in (("命中缓存", with_cache), ("全不命中", no_cache)):
    one = call_cost(usage, PEAK)
    month = one * CALLS_PER_DAY * DAYS
    print(f"{name}: 单次 ¥{one:.6f}  每月 ¥{month:,.0f}")
```

<div class="line-notes">

- `CALLS_PER_DAY = 10_000` 数字里的下划线只为好读,等于 10000。
- `with_cache = CompletionUsage.model_validate({` 和测试里一样,用字典造一个 `usage`。命中数取 2432,是 64 的整数倍,和实测的规律一致。
- `"prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 2650,` 最坏情况:每次开头都不一样(比如把当前时间放在了系统提示词最前面)。
- `month = one * CALLS_PER_DAY * DAYS` 单次 × 每天次数 × 30 天。
- `print(f"{name}: 单次 ¥{one:.6f}  每月 ¥{month:,.0f}")` `:,.0f` 加千位分隔符、不要小数。

</div>

```bash
uv run python -m part02.budget
```

实跑输出:

```text
命中缓存: 单次 ¥0.001173  每月 ¥352
全不命中: 单次 ¥0.005940  每月 ¥1,782
```

同样的 Agent、同样的调用量,只因为系统提示词有没有命中缓存,每月差了 1430 元,是 5 倍。再看命中时那 0.001173 元的构成:命中部分 97、未命中 436、输出 640(单位百万分之一元),输出成了大头。这时候再想省钱,就该去缩短输出(Day 121 的 `stop`、提示词里要求简短),而不是继续抠输入。算账的意义就在这里:先知道钱花在哪,再决定优化什么。这只是模型费,真实预算还要加上重试、思考模式、高峰空闲的比例,第七部分做生产化时会做一份完整的成本模型。

</details>

**验收标准**:能手算出 `(0 × 0.04 + 27 × 2 + 67 × 8) ÷ 1,000,000 = 0.00059`;`uv run pytest tests/test_llm_cost.py` 6 个全过,并且能复现「命中算两遍」那次失败;`.env` 和 `.env.sf` 都有 `LLM_PRICE`;`uv run python -m part02.cache_cost` 第二次起命中数大于 0,能说出这次省了百分之多少。

今天的花费:DeepSeek 长提示词 3 次,按上面的输出合计 0.005422 + 0.000623 + 0.000695 ≈ 0.0067 元(高峰价口径,实际空闲时段减半);硅基流动 3 次合计 0.008004 + 0.002438 + 0.008049 ≈ 0.0185 元;写文章时零碎试跑几次,每次不到 0.001 元。全天不到 0.03 元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 缓存命中价 | 输入里和之前请求开头一模一样、被厂商从缓存里读出来的那部分的单价。DeepSeek flash 高峰 0.04 元每百万 token,是未命中的 1/50 |
| 缓存未命中价 | 正常的输入单价,DeepSeek flash 高峰 2 元每百万 token |
| 输出价 | 模型生成的每个 token 的单价,包括推理 token。DeepSeek flash 高峰 8 元每百万 token |
| 高峰 / 空闲时段 | DeepSeek 按北京时间分时计价:工作日 9–12 点、14–18 点是高峰,其余是空闲,空闲价减半 |
| 上下文硬盘缓存 | DeepSeek 对「请求前缀缓存」的叫法,默认开启,命中的部分按命中价算 |
| 前缀 | 从第一个 token 开始的一段。缓存只认前缀,中间改一个字,后面都不命中 |
| `Price` | 我们在 `common/cost.py` 里定义的冻结 dataclass,装命中、未命中、输出三个单价 |
| `LLM_PRICE` | 配置文件里的价格变量,格式「命中,未命中,输出」,如 `0.04,2,8` |
| `frozen=True` | dataclass 的参数,建好后字段不能改,改了报错 |
| `pytest.approx` | 比较浮点数时允许极小误差,避免 `0.1 + 0.2 != 0.3` 这种问题 |
| `python -m 包.模块` | 以模块方式运行,从当前目录找包;脚本要导入 `common/` 时用这种方式 |

## 常见误区

**用 `total_tokens` 乘一个单价。** 输入、输出、命中三种价差 4 倍到 200 倍,混在一起乘出来的数没有意义。实测命中缓存那次,按 `total_tokens` × 输入价算是 (2635 × 2) ÷ 1,000,000 ≈ 0.0053 元,真实是 0.0006 元。

**命中的部分又按未命中价算了一遍。** 写成 `hit × 命中价 + prompt_tokens × 未命中价`,实测算出 0.01032 元,真实是 0.00432 元。`prompt_tokens` 已经包含了命中的部分,要用 `prompt_tokens - hit`。

**忘了推理 token 要按输出价付钱。** 实测开思考问退款题,275 个输出里 168 个是推理,0.0023 元里一半多是推理的钱。价格表上没有「推理」这一列,它就在输出里。

**以为缓存跨厂商通用,命中率能照搬。** 实测同一段前缀,DeepSeek 第二、三次都命中 2432 个;硅基流动第二次命中 2048 个,第三次一个都没命中。

**把时间戳、随机 ID 放在系统提示词开头。** 每次开头都不一样,缓存永远命中不了。我们实验里故意把版本号放在开头,就是为了让第一次不命中;正式代码里会变的东西要放到最后。

**直接 `uv run part02/xxx.py` 运行要导入 `common` 的脚本。** 实测报 `ModuleNotFoundError: No module named 'common'`。在仓库根目录用 `uv run python -m part02.xxx`。

**价格写死在代码里。** 价格会调整,每家也不同。放进配置文件的 `LLM_PRICE`,旁边注释写上查价日期。

**把新测试也叫 `test_cost.py`。** Day 71 已经有一个 `tests/test_cost.py` 了,重名会覆盖掉旧的。今天的叫 `test_llm_cost.py`。

## 学习资料

### 文档与文章

- [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):中文,今天价格表的出处,还写了扣费规则(先扣赠送余额,再扣充值余额)。价格会变,每次估算前看一眼。
- [DeepSeek 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):中文,缓存怎么命中、哪些情况不命中、`usage` 里两个缓存字段的含义,配了多轮对话的例子,十分钟读完。
- [硅基流动定价](https://siliconflow.cn/pricing):中文,搜「DeepSeek-V4-Flash」看分时段价格和缓存价。
- [Python 文档:dataclasses](https://docs.python.org/zh-cn/3.12/library/dataclasses.html):中文,`frozen=True` 那一节,讲冻结后改字段会报什么错。
- [pytest 文档:pytest.approx](https://docs.pytest.org/en/stable/reference/reference.html#pytest-approx):英文,浮点数比较的默认误差是多少、怎么自己设。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1keLp6GERQ&autoplay=0&high_quality=1" title="什么是缓存命中?8分钟说清楚KVCache与Prompt Cache" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>费曼学徒冬瓜 · 什么是缓存命中?8 分钟说清楚 KVCache 与 Prompt Cache · 8 分钟,2026 年 5 月。把 Day 117 的 KV cache 和今天的缓存命中价连起来讲,看完就明白「为什么只认前缀」。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19Z4Q6BExr&autoplay=0&high_quality=1" title="国产大模型API价格比拼:DeepSeek、Qwen、GLM、MiMo、MiniMax、Kimi" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>FutureAI实验室 · 国产大模型 API 价格比拼 · 不到 3 分钟,2026 年 8 月。几家国产模型的价格放在一起比,看完对「DeepSeek 便宜在哪」有个整体印象。价格两个月就可能变,数字以各家价格页为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NqeY6dEPP&autoplay=0&high_quality=1" title="DeepSeek 公布最新 API 峰谷计费规则;Step 5 Preview 现身知名评测网站与官方订阅【AI 早报 2026-09-20】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>橘鸦Juya · AI 早报 2026-09-20 · 4 分钟。开头讲 DeepSeek 公布峰谷计费规则,就是今天表里高峰、空闲两档价格的来历,只看前一分钟就行。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/U2VskjzlxZ4" title="Prompt Caching Explained Visually — Cut Your LLM API Bill (2026)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Balaji Chippada · Prompt Caching Explained Visually · 英文,2026 年。用动画讲提示词缓存怎么省钱、提示词该怎么排顺序,和今天的 `cache_cost.py` 实验对照看。</figcaption>
</figure>

### 书籍

今天这组不需要。价格和计费规则变得太快,书上的数字出版时就过期了,以厂商价格页为准。

### 开源项目与代码

- [BerriAI/litellm](https://github.com/BerriAI/litellm):Day 123 提过的统一调用库。它维护着一份各家模型价格表(仓库里的 `model_prices_and_context_window.json`),用来自动算每次调用的花费,和今天 `call_cost` 是同一件事的大规模版本。翻一下这个文件,看它怎么记命中价、未命中价、输出价。

## 自测

1. 一次调用 `prompt_cache_hit_tokens=3000`、`prompt_cache_miss_tokens=500`、`completion_tokens=400`,DeepSeek flash 高峰价,花多少?如果完全没命中呢?

<details><summary>答案</summary>

(3000 × 0.04 + 500 × 2 + 400 × 8) ÷ 1,000,000 = (120 + 1000 + 3200) ÷ 1,000,000 = 0.00432 元。完全没命中:(3500 × 2 + 400 × 8) ÷ 1,000,000 = (7000 + 3200) ÷ 1,000,000 = 0.0102 元,是命中时的 2.4 倍。这时输出已经占大头,缓存只能省输入那部分。

</details>

2. 开着思考模式,`completion_tokens=275`、`reasoning_tokens=168`。算钱时输出按 275 算还是按 107 算?

<details><summary>答案</summary>

按 275 算。`completion_tokens` 已经包含了推理 token,推理按输出价计费。107 是正文的 token 数,只用来理解「钱花在了哪」,不用来算钱。

</details>

3. 你把 Agent 的系统提示词改成了 `f"当前时间:{now}\n你是云簿客服……(2000 字规则)"`,上线后账单涨了好几倍。为什么?怎么改?

<details><summary>答案</summary>

缓存只认前缀。时间放在最开头,每次请求的第一行都不一样,后面 2000 字规则再相同也命中不了,全部按未命中价算,输入费涨约 50 倍。改法:把不变的规则放在最前面,当前时间这类会变的信息放到系统提示词末尾,或者放进用户消息里。

</details>

4. `split_input` 为什么用 `prompt_tokens - hit` 算未命中数,而不直接读 `prompt_cache_miss_tokens`?

<details><summary>答案</summary>

`prompt_cache_miss_tokens` 是 DeepSeek 自己加的字段,只给 OpenAI 标准字段 `cached_tokens` 的厂商没有它。DeepSeek 文档写明命中加未命中等于 `prompt_tokens`,所以用减法在 DeepSeek 上结果一样,在别家也能用。只依赖兼容范围里的字段,代码才能跨厂商。

</details>

5. 面试题:「你们的客服 Agent 月度模型费用超预算,老板让你降一半。你怎么分析、从哪下手?」

<details><summary>答案</summary>

先算账再动手。第一步,确认每次调用都记录了 `usage`(命中、未命中、输出、推理),按「每个任务调了几次模型」「每次的命中、未命中、输出各占多少钱」拆开,找出大头。第二步,按大头对症:如果未命中输入占大头,检查提示词顺序,把系统提示词、工具定义这些不变的放前面,去掉开头的时间戳、随机 ID,命中率上去输入费能降一个数量级(我实测一段 2615 token 的提示词,单次从 0.0054 元降到 0.0006 元);如果输出占大头,限制回答长度、用 `stop`、关掉不需要的思考模式(推理 token 按输出价收);如果调用次数多,看 Agent 是不是在空转重试、能不能合并步骤。第三步,利用时段价差,能离线跑的批量任务放到空闲时段,价格减半。最后,每项改动前后用同一批真实流量回放对比,确认省了钱、质量没掉。

</details>

## 明天预告

Day 125 · 第 18 周复习:大模型与 API(Day 119–124)。这一周从「哪些模型能本地跑」讲到拿 key、拆请求、拆响应、切厂商、算钱,你已经能独立调通一家模型、读懂它的每个字段、算出每次花了多少。明天画一张这一周的知识地图,把错题和坑过一遍,再默写一段核心代码:一个读 `ENV_FILE`、检查 `finish_reason`、用 `common/cost.py` 打印花费的完整调用脚本。
