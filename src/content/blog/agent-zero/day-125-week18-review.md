---
title: 'Day 125 · 第 18 周复习:大模型与 API(Day 119–124)'
description: '这一周讲了本地模型的内存账、注册 API、请求体、响应体、OpenAI 兼容协议和算钱。今天把它们画成「一次调用从 .env 到账单」的一张图,逐天一句话回顾,默写 call_cost 和 split_input,再写一个小项目:给 DeepSeek 和硅基流动各做一次调用体检,量出正常问答、截断、坏 key、缓存四件事,并算出每天一万次调用的月账单和本地跑要多少小时。'
pubDate: 2026-10-23
regime: none
tags: ['llm-basics', 'review', 'api', 'python', 'agent-zero']
series: 'agent-zero'
day: 125
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 124](/blog/agent-zero/day-124-cost/) 把 `usage` 换成了人民币。输入分缓存命中和未命中两种价,输出(含推理)一种价,公式是「命中数 × 命中价 + 未命中数 × 未命中价 + 输出数 × 输出价,再除以一百万」。我们写了 `common/cost.py`(`Price`、`parse_price`、`split_input`、`call_cost`)和 6 个测试,先故意把命中部分算了两遍,让测试抓住 0.01032 对 0.00432 的差;再用一段 2615 token 的系统提示词实测,第二次起命中 2432 个,单次从 0.0054 元降到 0.0006 元。最后算了一个每天一万次的客服 Agent,有没有缓存每月差 352 元和 1782 元。

这一周的六天,是我们第一次从「理解模型」走到「真的调用模型」:Day 119 算清楚本地能不能跑,Day 120 起拿 key 调 API,请求、响应、换厂商、算钱各占一天。今天不学新东西,把这六天接成一条线,再用一个小项目把它们一次用上。

## 今天要解决的问题

学完今天,你应该能做到:

1. 不看文章,画出「一次调用从 `.env` 到账单」的流程图,指出本周六天各管图里的哪一段。
2. 默写 `split_input` 和 `call_cost`,用四种形状的 `usage` 验证和 `common/cost.py` 的结果一模一样。
3. 写完 `week18_lab.py`:对两家厂商各做一次调用体检,用实跑数据回答三个问题:截断能不能被代码发现、换厂商要改几行、缓存省多少钱。
4. 对着本周的坑清单,每一条都能说出现象和修法。

预计用时:3 小时左右(复习日,默写和小项目占大头)。跑一遍小项目约 0.018 元,写文章时反复跑了几遍,合计不到 0.1 元(文末有算式)。前置:Day 119–124 全部,特别是 [Day 119](/blog/agent-zero/day-119-local-models-intro/) 的 `fit_check.py`、[Day 120](/blog/agent-zero/day-120-api-register/) 的 `.env` 和 `ask.py`、[Day 122](/blog/agent-zero/day-122-api-response/) 的 `ask2.py`、[Day 123](/blog/agent-zero/day-123-openai-compatible/) 的 `.env.sf`、[Day 124](/blog/agent-zero/day-124-cost/) 的 `common/cost.py`。

学法提示:先不看文章,把流程图在纸上画一遍,再对照下面的图;小项目对照逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,把 `probe_bad_key` 和 `probe_cache` 默写出来;动手练习做不出再展开参考答案,看完关掉,自己重写一遍。

## 本周知识地图

Day 118 那张图画的是「模型里面」:注意力、MoE、KV cache。这一周画的是「模型外面」:你的脚本怎么找到模型、怎么把话递过去、怎么读它回的话、怎么算钱。

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="第 18 周知识地图:配置文件里的 key、地址、模型和价格,变成请求体发给厂商服务器或者本机模型,返回响应里的 finish_reason 和 usage,usage 乘单价变成账单">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-soft)">你的脚本这一侧(琥珀色),模型那一侧(蓝色)</text>
<rect x="20" y="40" width="110" height="92" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="75" y="60" text-anchor="middle" fill="var(--ink)">.env</text>
<text x="75" y="80" text-anchor="middle" fill="var(--ink-soft)">key · base_url</text>
<text x="75" y="98" text-anchor="middle" fill="var(--ink-soft)">model · price</text>
<text x="75" y="118" text-anchor="middle" fill="var(--ink-faint)">120 · 123 · 124</text>
<rect x="150" y="40" width="110" height="92" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="205" y="60" text-anchor="middle" fill="var(--ink)">请求</text>
<text x="205" y="80" text-anchor="middle" fill="var(--ink-soft)">POST + JSON</text>
<text x="205" y="98" text-anchor="middle" fill="var(--ink-soft)">max_tokens</text>
<text x="205" y="118" text-anchor="middle" fill="var(--ink-faint)">121</text>
<rect x="280" y="40" width="110" height="92" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="335" y="60" text-anchor="middle" fill="var(--ink)">厂商服务器</text>
<text x="335" y="80" text-anchor="middle" fill="var(--ink-soft)">DeepSeek</text>
<text x="335" y="98" text-anchor="middle" fill="var(--ink-soft)">硅基流动</text>
<text x="335" y="118" text-anchor="middle" fill="var(--ink-faint)">兼容协议 123</text>
<rect x="410" y="40" width="110" height="92" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="465" y="60" text-anchor="middle" fill="var(--ink)">响应</text>
<text x="465" y="80" text-anchor="middle" fill="var(--ink-soft)">finish_reason</text>
<text x="465" y="98" text-anchor="middle" fill="var(--ink-soft)">usage</text>
<text x="465" y="118" text-anchor="middle" fill="var(--ink-faint)">122</text>
<rect x="540" y="40" width="80" height="92" rx="4" fill="none" stroke="var(--rule)"/>
<text x="580" y="60" text-anchor="middle" fill="var(--ink)">账单</text>
<text x="580" y="80" text-anchor="middle" fill="var(--ink-soft)">× 单价</text>
<text x="580" y="98" text-anchor="middle" fill="var(--ink-soft)">÷ 10⁶</text>
<text x="580" y="118" text-anchor="middle" fill="var(--ink-faint)">124</text>
<line x1="130" y1="86" x2="150" y2="86" stroke="var(--ink-soft)"/>
<line x1="260" y1="86" x2="280" y2="86" stroke="var(--ink-soft)"/>
<line x1="390" y1="86" x2="410" y2="86" stroke="var(--ink-soft)"/>
<line x1="520" y1="86" x2="540" y2="86" stroke="var(--ink-soft)"/>
<line x1="335" y1="132" x2="335" y2="176" stroke="var(--ink-soft)" stroke-dasharray="4 3"/>
<text x="345" y="158" fill="var(--ink-faint)">或者不出门</text>
<rect x="240" y="176" width="190" height="64" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="335" y="198" text-anchor="middle" fill="var(--ink)">本机模型 · Day 119</text>
<text x="335" y="218" text-anchor="middle" fill="var(--ink-soft)">0.6 GB / 1B · 带宽 ÷ 字节</text>
<text x="20" y="188" fill="var(--ink-soft)">出错的位置:</text>
<text x="20" y="208" fill="var(--ink-faint)">key 错 → 401</text>
<text x="20" y="226" fill="var(--ink-faint)">模型名错 → 400</text>
<text x="20" y="262" fill="var(--ink-faint)">说一半就停了:HTTP 200,finish_reason 是 length</text>
<text x="20" y="284" fill="var(--ink-faint)">账单看着对、其实算了两遍:没有任何报错,只有测试能抓住</text>
<text x="20" y="306" fill="var(--ink-faint)">配置串味:文件写的是 A 家,请求发去了 B 家(override=True 不写)</text>
</g>
</svg>
<figcaption>第 18 周的地图。上一排是一次调用的五步,下面那块是「不调 API、在自己电脑上跑」的另一条路。左下角列的是这一周踩过的三类坑:报错的、不报错但结果不对的、配置读串的。</figcaption>
</figure>

这张图上最值得记住的是左下角那三行。**报错的坑最好修**,401 和 400 当场就知道哪里错了;难的是不报错的:`max_tokens` 不够时状态码照样是 200,命中缓存算两遍时程序照样跑完,配置串味时代码照样拿到回答,只是拿的不是你以为的那家。今天的小项目就是把这三类各设一个「探针」,让代码自己发现。

## 本周每天一句话

- [Day 119](/blog/agent-zero/day-119-local-models-intro/) · 本地模型:开放权重只给参数文件不给训练过程;4 位量化后每 1B 参数约 0.6 GB,16 GB 的笔记本放 9B 左右就到头;放得下还要看内存带宽,我这台 2019 款 Intel MBP 的 9B 理论上限每秒 6 个 token,实测大约只有三分之一;从零训练的账是「6 × 参数量 × 训练 token」。
- [Day 120](/blog/agent-zero/day-120-api-register/) · 注册 API:key 是身份和钱包,`base_url` 是请求发去哪台服务器;`.env` 放 key、`.gitignore` 挡住它;第一次调用写 `ask.py`;`KeyError`、`ModuleNotFoundError`、401、`Connection error`、400 五种报错各对应不同的一步出错。
- [Day 121](/blog/agent-zero/day-121-api-request/) · 请求体:SDK 发出去的就是一个 POST 加几个头加一段 JSON,用 httpx 手写同样能通;`extra_body` 放 SDK 不认识的厂商字段,拼错了不报错、只是不生效;`n=2` 在 DeepSeek 上 400。
- [Day 122](/blog/agent-zero/day-122-api-response/) · 响应体:`choices[0].message.content` 取回答,`finish_reason` 每次都要先看,`length` 时状态码仍是 200;`usage` 里输入拆成命中和未命中,推理 token 包含在输出里。
- [Day 123](/blog/agent-zero/day-123-openai-compatible/) · 兼容协议:每家一个配置文件,用 `ENV_FILE` 选厂商,代码一行不改;`load_dotenv(..., override=True)` 不写会「文件说 A、请求发 B」;同一个模型两家的默认行为和答题准确率也不一样,兼容的是格式不是效果。
- [Day 124](/blog/agent-zero/day-124-cost/) · 算钱:三种 token 三个单价,命中价是未命中的 1/50;`common/cost.py` 加 6 个测试;缓存只认开头,所以不变的放前面;客服 Agent 每天一万次,有无缓存每月差 5 倍。

哪一句你读完没法接着讲两分钟,就回那一天重读正文,再做一遍那天的练习 1。

## 本周的几个关键数字

这些数字都是这一周实跑或从官方页面查到的:

| 数字 | 出处 | 用途 |
| --- | --- | --- |
| 4 位量化每 1B 参数约 0.6 GB | Day 119,5 个真实文件验证 | 心算本地模型要多大内存 |
| 16 GB 内存、按可用 10 GB:9B 放得下(7.5 GB),20B 放不下 | Day 119 `fit_check.py` | 选本地模型的尺寸 |
| Intel MBP 的速度上限 6 token/秒,实测约三分之一 | Day 119 | 老机器本地跑 9B「能跑但没法用」 |
| 第一次调用约 0.000144 元 | Day 120 | 建立「一次调用有多便宜」的感觉 |
| `max_tokens=12` 返回半句话,状态码 200 | Day 121 | 不会报错,要自己看 `finish_reason` |
| `n=2` 返回 400「currently only n = 1 is supported」 | Day 121 | OpenAI 支持的参数 DeepSeek 不一定支持 |
| 开思考、`max_tokens=40`:`content` 是空字符串 | Day 122 | 思考模式下上限管推理加正文 |
| 同一道退款题关思考后,DeepSeek 3/3 对、硅基流动 1/3 对 | Day 123 | 兼容的是格式,不是效果 |
| 命中价 0.04 元、未命中价 2 元、输出价 8 元每百万 token(高峰) | Day 124,DeepSeek 价格页 | 算钱 |
| 单次 0.0054 元降到 0.0006 元 | Day 124 实测 | 缓存省 88% 左右 |
| 每天 1 万次:有缓存 352 元、无缓存 1782 元每月 | Day 124 练习 4 | 系统提示词是否命中,每月差 5 倍 |

## 小项目:给两家厂商做一次调用体检

本周的小项目只用这一周学的东西。目标和 Day 118 的「体检」一脉相承:Day 118 体检的是玩具模型,今天体检的是**一家 API 厂商**。每家做四件事:

1. 一次正常问答:耗时、花多少钱(Day 120、124)。
2. 故意把 `max_tokens` 压到 30,看代码能不能发现「没说完」(Day 122)。
3. 用一个假 key 调用,看服务器回什么状态码(Day 120)。
4. 同一段 2600 多 token 的系统提示词问两次,看第二次命中多少、省多少钱(Day 117、124)。

两家厂商用的就是 Day 123 的 `.env` 和 `.env.sf`,**体检代码里一个厂商的名字都不会出现**。最后再用测到的数估一个月账单,并和 Day 119 的「本地跑」比一比。

新建 `part02/week18_lab.py`,它会用到 Day 124 的 `common/cost.py`,所以要在仓库根目录用 `-m` 方式运行:

```python
# agent-zero-lab/part02/week18_lab.py
import json
import os
import random
import sys
import time
from dataclasses import dataclass

import openai
from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletion, ChatCompletionMessageParam

from common.cost import Price, call_cost, parse_price, split_input


class IncompleteAnswer(Exception):
    pass


@dataclass
class Vendor:
    env_file: str
    base_url: str
    model: str
    client: OpenAI
    extra_body: dict
    price: Price


def load_vendor(env_file: str) -> Vendor:
    load_dotenv(env_file, override=True)
    base_url = os.environ["LLM_BASE_URL"]
    return Vendor(
        env_file=env_file,
        base_url=base_url,
        model=os.environ["LLM_MODEL"],
        client=OpenAI(base_url=base_url, api_key=os.environ["LLM_API_KEY"]),
        extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),
        price=parse_price(os.environ["LLM_PRICE"]),
    )


def ask(v: Vendor, messages: list[ChatCompletionMessageParam], max_tokens: int) -> tuple[ChatCompletion, float]:
    t0 = time.perf_counter()
    resp = v.client.chat.completions.create(
        model=v.model, messages=messages, max_tokens=max_tokens, extra_body=v.extra_body
    )
    return resp, time.perf_counter() - t0


def read_answer(resp: ChatCompletion) -> str:
    choice = resp.choices[0]
    if choice.finish_reason != "stop":
        raise IncompleteAnswer(f"finish_reason={choice.finish_reason}")
    return choice.message.content or ""


@dataclass
class Normal:
    stop: bool
    sec: float
    cost: float


def probe_normal(v: Vendor) -> Normal:
    resp, sec = ask(v, [{"role": "user", "content": "发票抬头开错了能改吗?一句话回答。"}], 200)
    assert resp.usage is not None
    return Normal(resp.choices[0].finish_reason == "stop", sec, call_cost(resp.usage, v.price))


def probe_truncate(v: Vendor) -> bool:
    resp, _ = ask(v, [{"role": "user", "content": "写一段 300 字的云簿 CloudLedger 产品介绍"}], 30)
    try:
        read_answer(resp)
    except IncompleteAnswer:
        return True
    return False


def probe_bad_key(v: Vendor) -> int | str:
    bad = OpenAI(base_url=v.base_url, api_key="sk-" + "0" * 32, max_retries=0)
    try:
        bad.chat.completions.create(model=v.model, messages=[{"role": "user", "content": "hi"}], max_tokens=5,
                                    extra_body=v.extra_body)
    except openai.AuthenticationError as e:
        return e.status_code
    except openai.APIStatusError as e:
        return e.status_code
    return "没报错"


def make_system() -> str:
    topics = [
        "发票抬头开错,当月可作废重开,跨月需红字冲销后重开",
        "年付套餐 468 元,中途退订按剩余整月折算退款",
        "重复扣款在 3 个工作日内原路退回",
        "团队版每增加一个席位每月加收 15 元",
        "导出账簿支持 Excel 和 PDF 两种格式",
        "电子发票在付款后 24 小时内发到注册邮箱",
    ]
    tag = random.Random().randint(100_000, 999_999)
    rules = "\n".join(f"第 {i} 条:{topics[i % len(topics)]}。" for i in range(1, 121))
    return f"你是云簿 CloudLedger 客服。版本 {tag}。只根据下面的规则回答,一句话。\n{rules}"


@dataclass
class CacheProbe:
    hit2: int
    first: float
    second: float


def probe_cache(v: Vendor) -> CacheProbe:
    system = make_system()
    costs: list[float] = []
    hits: list[int] = []
    for q in ["第 7 条说了什么?", "第 99 条说了什么?"]:
        resp, _ = ask(v, [{"role": "system", "content": system}, {"role": "user", "content": q}], 100)
        assert resp.usage is not None
        costs.append(call_cost(resp.usage, v.price))
        hits.append(split_input(resp.usage)[0])
    return CacheProbe(hits[1], costs[0], costs[1])


def local_hours(calls: int, out_tokens: int, tok_per_s: float) -> float:
    return calls * out_tokens / tok_per_s / 3600


def main(env_files: list[str]) -> None:
    second_costs: list[float] = []
    for f in env_files:
        v = load_vendor(f)
        normal = probe_normal(v)
        caught = probe_truncate(v)
        bad_key = probe_bad_key(v)
        cache = probe_cache(v)
        print(f"[{f}] {v.model}")
        print(f"  正常问答 {normal.sec:.2f} 秒 ¥{normal.cost:.6f}  finish_reason=stop: {normal.stop}")
        print(f"  截断被发现: {caught}  坏 key 状态码: {bad_key}")
        saved = 1 - cache.second / cache.first
        print(f"  缓存: 第二次命中 {cache.hit2}, ¥{cache.first:.6f} -> ¥{cache.second:.6f}, 省 {saved:.0%}")
        second_costs.append(cache.second)
    best = min(second_costs)
    month = best * 10_000 * 30
    print(f"按最低的一次 ¥{best:.6f} 算, 每天 1 万次、30 天: ¥{month:,.0f}")
    print(f"本地 9B 模型(约 2 token/秒)吐 1 万次 × 80 token 要 {local_hours(10_000, 80, 2):.0f} 小时")


if __name__ == "__main__":
    main(sys.argv[1:] or [".env"])
```

<div class="line-notes">

- `import openai` 这次要写 `except openai.AuthenticationError`,所以导入整个包;下一行 `from openai import OpenAI` 只取客户端类,两种写法同时存在不冲突。
- `from dotenv import load_dotenv` Day 53、Day 120 的老朋友,把配置文件读进环境变量。
- `from openai.types.chat import ChatCompletion, ChatCompletionMessageParam` 两个类型,只给类型标注用:前者是整个响应对象,后者是 `messages` 里每一项的类型。写成 `list[ChatCompletionMessageParam]` 编辑器才不会对字典字面量画红线(Day 121 的坑)。
- `from common.cost import Price, call_cost, parse_price, split_input` Day 124 的共享模块,今天是它第一次被别人当库用。
- `class IncompleteAnswer(Exception):` Day 122 `ask2.py` 里的同名自定义异常,表示「模型没说完」。那边是脚本里的一个类,这里再写一遍,因为 `ask2.py` 没有 main guard,导入它会直接发请求。
- `@dataclass` Day 50 的装饰器,下面这个类只装数据,不写 `__init__`。
- `class Vendor:` 一家厂商的全部信息打成一包:配置文件名、地址、模型名、已经建好的客户端、扩展参数、价格。后面每个探针只收一个 `Vendor`,函数签名短,也不会把参数顺序传错。
- `extra_body: dict` 扩展参数,比如 `{"thinking": {"type": "disabled"}}`。
- `price: Price` Day 124 的冻结 dataclass。
- `def load_vendor(env_file: str) -> Vendor:` 读一个配置文件,返回一个 `Vendor`。换厂商就是换文件名。
- `load_dotenv(env_file, override=True)` Day 123 的写法:`override=True` 让文件盖过终端里残留的同名变量。体检要连着读两个文件(`.env` 然后 `.env.sf`),第二次读如果不覆盖,变量还是第一家的。
- `base_url = os.environ["LLM_BASE_URL"]` 实跑 `.env` 得到 `https://api.deepseek.com`,`.env.sf` 得到 `https://api.siliconflow.cn/v1`。先放进变量,因为下面建客户端和存进 `Vendor` 要用两次。
- `return Vendor(` 用关键字参数一项一项填,比按位置传更不容易错位。
- `client=OpenAI(base_url=base_url, api_key=os.environ["LLM_API_KEY"]),` 这一步还不发请求,只是把地址和 key 存进客户端(Day 120)。
- `extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")),` 把配置里那行 JSON 字符串变成字典,没配就是空字典(Day 123)。
- `price=parse_price(os.environ["LLM_PRICE"]),` `"0.04,2,8"` 变成 `Price(hit=0.04, miss=2.0, out=8.0)`(Day 124)。这里用 `[]` 而不是 `.get`:价格没配,体检就没意义,直接 `KeyError` 停下来。
- `def ask(v: Vendor, messages: list[ChatCompletionMessageParam], max_tokens: int) -> tuple[ChatCompletion, float]:` 体检里所有调用都走这一个函数,返回响应和耗时两个值。
- `t0 = time.perf_counter()` 高精度计时器,只拿来做减法。`time.time()` 受系统时钟调整影响,量耗时用 `perf_counter`。
- `resp = v.client.chat.completions.create(` 真正发请求的一行(Day 120)。
- `model=v.model, messages=messages, max_tokens=max_tokens, extra_body=v.extra_body` 每家的模型名和扩展参数都从 `Vendor` 里取,代码里没有任何一个字提到 DeepSeek。
- `return resp, time.perf_counter() - t0` 请求返回的这一刻减去开始的时刻。实跑 DeepSeek 一次短问答 0.98 秒,硅基流动 1.44 秒。
- `def read_answer(resp: ChatCompletion) -> str:` Day 122 `ask2.py` 的同名函数,先查 `finish_reason` 再取内容。
- `if choice.finish_reason != "stop":` 不是 `stop` 就当没说完。以后有了工具调用,`tool_calls` 也是正常结束,到时候再放宽(Day 122 说过)。
- `raise IncompleteAnswer(f"finish_reason={choice.finish_reason}")` 把原因写进报错信息。实跑截断探针这里是 `finish_reason=length`。
- `return choice.message.content or ""` `content` 在类型上可能是 `None`,`or ""` 保证返回字符串。
- `@dataclass` 第二个数据类:一次正常问答的结果。
- `class Normal:` 三个字段:是不是正常结束、耗时、花费。不用元组返回,是因为三个值类型不同,用名字取比用下标取不容易记错。
- `def probe_normal(v: Vendor) -> Normal:` 探针一(probe,往系统里放一个已知输入、看输出对不对)。
- `resp, sec = ask(v, [{"role": "user", "content": "发票抬头开错了能改吗?一句话回答。"}], 200)` 问题和 Day 123 的 `ask_any.py` 一样,`max_tokens=200` 足够说完。
- `assert resp.usage is not None` `usage` 在类型上可能是 `None`,断言一下编辑器就不画红线(Day 124)。
- `return Normal(resp.choices[0].finish_reason == "stop", sec, call_cost(resp.usage, v.price))` 实跑 DeepSeek:输入 15、输出 42,(15 × 2 + 42 × 8) ÷ 1,000,000 = 0.000366 元。硅基流动:输入 15、输出 25,(15 × 3 + 25 × 9) ÷ 1,000,000 = 0.000270 元。注意这一次便宜的是「输出短」,不是「单价低」,所以一次调用比不出哪家便宜。
- `def probe_truncate(v: Vendor) -> bool:` 探针二:能不能发现「没说完」。返回 `True` 表示发现了。
- `resp, _ = ask(v, [{"role": "user", "content": "写一段 300 字的云簿 CloudLedger 产品介绍"}], 30)` 要 300 字却只给 30 个 token,一定写不完。`_` 表示「耗时我不要」。
- `read_answer(resp)` 这一行如果没抛异常,说明模型居然在 30 个 token 里说完了。实跑两家都抛了。
- `except IncompleteAnswer:` 只接我们自己抛的这一种,别的错照常往外飞。
- `return True` 抛了异常 = 发现了截断,体检通过。下面那个 `return False` 是没发现,体检不通过。
- `def probe_bad_key(v: Vendor) -> int | str:` 探针三:假 key 会得到什么。返回类型 `int | str` 读作「整数或字符串」:正常是状态码(整数),异常情况返回一句中文。
- `bad = OpenAI(base_url=v.base_url, api_key="sk-" + "0" * 32, max_retries=0)` 新建一个只用于这次探针的客户端:同一个地址,key 是 `sk-` 加 32 个 0。`"0" * 32` 是字符串重复。`max_retries=0` 的意思是别自动重试,401 本来就不会重试,写上是为了让探针「一次请求,一个结果」,重试的事 Day 127 讲。
- `bad.chat.completions.create(model=v.model, messages=[{"role": "user", "content": "hi"}], max_tokens=5,` 发一个最短的请求。真 key 才有权限、假 key 一定被挡在门口,所以这次调用不花钱。
- `except openai.AuthenticationError as e:` 401 对应的异常类(Day 120 的报错四)。
- `return e.status_code` 实跑两家都是 `401`。
- `except openai.APIStatusError as e:` 所有 HTTP 错误的父类,放在后面兜底:万一某家对假 key 回的不是 401(比如 403),也能拿到状态码,不至于探针自己崩掉。顺序不能反,父类放前面会把子类全吞掉。
- `return "没报错"` 假 key 居然通了,这是一个严重的安全信号,所以用一句话而不是数字表示。
- `def make_system() -> str:` 生成缓存实验用的长系统提示词,和 Day 124 `cache_cost.py` 里是同一套写法。
- `topics = [` 六条云簿规则,下面循环用,凑出 120 条。
- `tag = random.Random().randint(100_000, 999_999)` 版本号放在提示词开头,每次运行都不一样,保证「第一次一定不命中」,不会蹭到上一次运行留下的缓存(Day 117、124)。
- `rules = "\n".join(f"第 {i} 条:{topics[i % len(topics)]}。" for i in range(1, 121))` 120 行规则,`i % 6` 让六条循环使用。
- `return f"你是云簿 CloudLedger 客服。版本 {tag}。只根据下面的规则回答,一句话。\n{rules}"` 实跑在 DeepSeek 上是 2615 个输入 token(含问题)。
- `@dataclass` 第三个数据类:缓存探针的结果。
- `class CacheProbe:` 三个字段:第二次命中多少个 token、第一次花多少、第二次花多少。
- `def probe_cache(v: Vendor) -> CacheProbe:` 探针四。
- `system = make_system()` 两次调用共用同一个系统提示词,变量只生成一次,否则两次的开头不同,缓存永远命不中。
- `costs: list[float] = []` 先写上类型,空列表编辑器推断不出里面装什么。
- `for q in ["第 7 条说了什么?", "第 99 条说了什么?"]:` 两个不同的问题,变的放后面、不变的放前面。
- `resp, _ = ask(v, [{"role": "system", "content": system}, {"role": "user", "content": q}], 100)` system 在前、user 在后。
- `costs.append(call_cost(resp.usage, v.price))` 把每次调用的花费存起来。DeepSeek 两次是 0.005422 和 0.000623。
- `hits.append(split_input(resp.usage)[0])` `split_input` 返回(命中,未命中),`[0]` 取命中数。DeepSeek 两次是 0 和 2432,硅基流动是 0 和 2048。
- `return CacheProbe(hits[1], costs[0], costs[1])` 只留第二次的命中数,和两次的花费。
- `def local_hours(calls: int, out_tokens: int, tok_per_s: float) -> float:` 按 Day 119 的速度估算,本地吐这么多 token 要多少小时。
- `return calls * out_tokens / tok_per_s / 3600` 总 token 数 ÷ 每秒速度得到秒,再 ÷ 3600 得到小时。代入 1 万次 × 80 个 token ÷ 2 ÷ 3600 = 111.1。这个数只算了输出,没算读 2650 个输入 token 的时间,所以是下限。
- `def main(env_files: list[str]) -> None:` 命令行传几个配置文件就体检几家。
- `second_costs: list[float] = []` 收集每家第二次(命中缓存时)的花费,最后挑最低的估月账单。
- `for f in env_files:` 一家一家来。
- `v = load_vendor(f)` 换厂商只发生在这一行。
- `normal = probe_normal(v)` 四个探针依次跑,结果都存进变量,先全部跑完再统一打印,打印格式改起来就不用动探针。
- `print(f"[{f}] {v.model}")` 表头:配置文件名和模型名。
- `print(f"  正常问答 {normal.sec:.2f} 秒 ¥{normal.cost:.6f}  finish_reason=stop: {normal.stop}")` `:.2f` 两位小数的秒,`:.6f` 六位小数的钱。
- `saved = 1 - cache.second / cache.first` 省了百分之几。DeepSeek:1 - 0.000623 ÷ 0.005422 = 0.885。
- `print(f"  缓存: 第二次命中 {cache.hit2}, ¥{cache.first:.6f} -> ¥{cache.second:.6f}, 省 {saved:.0%}")` `:.0%` 把 0.885 显示成 `89%`,自带乘 100 和百分号。
- `best = min(second_costs)` 两家里命中缓存时最便宜的一次,实跑是 DeepSeek 的 0.000623。
- `month = best * 10_000 * 30` 每天一万次,30 天:0.000623 × 300,000 = 186.9。
- `print(f"按最低的一次 ¥{best:.6f} 算, 每天 1 万次、30 天: ¥{month:,.0f}")` `:,.0f` 加千位分隔、不要小数,打印 `¥187`。
- `print(f"本地 9B 模型(约 2 token/秒)吐 1 万次 × 80 token 要 {local_hours(10_000, 80, 2):.0f} 小时")` 2 token/秒是 Day 119 里「Intel MBP 上 9B 的理论上限 6 除以 3」得出的。
- `if __name__ == "__main__":` 练习 3 要从这个文件里 `import local_hours`,加上 main guard,导入时就不会先把四个探针跑一遍、花一次钱。
- `main(sys.argv[1:] or [".env"])` `sys.argv[1:]` 是命令行里脚本名后面的全部参数,没给就是空列表,空列表在 `or` 里算假,于是退回只体检 `.env` 一家。

</div>

在 `agent-zero-lab` 根目录运行,把两家一起测:

```bash
uv run python -m part02.week18_lab .env .env.sf
```

实跑输出(10 月 23 日 11:19,周五上午,DeepSeek 在高峰价;硅基流动 8 点到 24 点是同一档价):

```text
[.env] deepseek-flash
  正常问答 0.98 秒 ¥0.000366  finish_reason=stop: True
  截断被发现: True  坏 key 状态码: 401
  缓存: 第二次命中 2432, ¥0.005422 -> ¥0.000623, 省 89%
[.env.sf] deepseek-ai/DeepSeek-V4-Flash
  正常问答 1.44 秒 ¥0.000270  finish_reason=stop: True
  截断被发现: True  坏 key 状态码: 401
  缓存: 第二次命中 2048, ¥0.007986 -> ¥0.002438, 省 69%
按最低的一次 ¥0.000623 算, 每天 1 万次、30 天: ¥187
本地 9B 模型(约 2 token/秒)吐 1 万次 × 80 token 要 111 小时
```

一行一行读,每一行都对应本周的一个结论。

**正常问答。** 两家都在一秒多回来,都是 `finish_reason=stop`。DeepSeek 0.000366 元,硅基流动 0.000270 元,硅基流动「更便宜」。这个比较是假的:两家的单价明明是硅基流动更贵(输入 3 对 2、输出 9 对 8)。差在输出长度,DeepSeek 这次写了 42 个 token,硅基流动写了 25 个,输出价是大头。Day 124 说过「先知道钱花在哪」,一次调用比不出哪家便宜,要比就测几十次取平均,并且固定住输出长度。

**截断被发现。** 两家都是 `True`。`max_tokens=30` 时 HTTP 状态码仍是 200,SDK 不报错,是 `read_answer` 里那一句 `finish_reason != "stop"` 抓住的。这就是流程图里「说一半就停了」那一类。

**坏 key。** 两家都回 401,和 Day 120 的结论一致。注意这一行是体检里唯一不花钱的探针:没通过鉴权的请求不会进到计费。

**缓存。** DeepSeek 第二次命中 2432 个,单次从 0.005422 元降到 0.000623 元,省 89%,和 Day 124 的实测完全一致(2432 也是 64 的整数倍)。硅基流动命中 2048 个,0.007986 元降到 0.002438 元,省 69%。同一个模型、同样的提示词,命中数少了 384 个,省的比例就从 89% 掉到 69%。另外要记得 Day 124 练习 3 看到的:硅基流动的第三次可能一个都不命中,所以 69% 是它「运气好的时候」。

**两个估算。** 每天 1 万次、每次 20 个 token 的输出,最便宜的一档每月 187 元(和 Day 124 练习 4 的 352 元不矛盾:那里输出是 80 个 token,输入也更长)。同样的活放在我这台 2019 款 MBP 上,按每秒 2 个 token 算,光吐字就要 111 小时,一天只有 24 小时。本地跑的价值在隐私和离线,不在便宜和快,在这台老机器上更不是。

### 零件 → 小项目对照

| 本周学的零件 | 在 `week18_lab.py` 的哪里 |
| --- | --- |
| Day 119 本地速度估算 | `local_hours` 和最后一行 |
| Day 120 `.env`、`base_url`、401 | `load_vendor`、`probe_bad_key` |
| Day 121 `extra_body`、`max_tokens` | `ask` 里的两个参数、`probe_truncate` 的 30 |
| Day 122 `finish_reason`、`usage` | `read_answer`、`probe_cache` 里的 `resp.usage` |
| Day 123 `ENV_FILE` 式的多配置、`override=True` | `load_vendor`、`main` 里的循环 |
| Day 124 `call_cost`、缓存价 | `probe_normal`、`probe_cache`、`month` |

## 本周错题与坑清单

把这一周「常见误区」里最容易再犯的挑出来。复习时盖住右边两列,看左边能不能说出现象和修法。

| 坑 | 现象 | 修法 |
| --- | --- | --- |
| 只算权重不算 KV cache 和系统占用 | 9B 模型 Q4 文件 5.68 GB,8 GB 内存的机器却跑不起来 | 权重 + KV + 余量,再扣掉系统占的(Day 119) |
| 以为放得下就能用 | Intel MBP 上 0.6B 实测每秒 16.96 个 token,9B 约两个 | 速度按带宽估,实际打三折(Day 119) |
| key 加引号还多一个空格 | `Illegal header value b'Bearer sk-**** '`,报成 `Connection error` | 值不加引号,让 python-dotenv 去掉末尾空格(Day 120) |
| 改了 `.env` 不生效 | 终端里已有同名变量,`load_dotenv()` 默认不覆盖 | `echo $LLM_API_KEY` 看一眼,或者写 `override=True`(Day 120、123) |
| `uv init` 的 `.gitignore` 没有 `.env` | `git status` 里 `.env` 是待提交 | 自己加,再用 `git check-ignore -v .env` 验证(Day 120) |
| 厂商字段直接写进 `create()` | `TypeError: ... unexpected keyword argument 'thinking'`,没发出去 | 放进 `extra_body`(Day 121) |
| `extra_body` 拼错 | 状态码 200,思考没关上,12 个输出里 10 个是推理 | 配置文件里写一次、复制,别手打(Day 121) |
| 以为没传的参数用 SDK 默认值 | 请求体里根本没有它,用的是服务器默认值,DeepSeek 默认开思考 | 要关就显式关(Day 121) |
| 只看 `content`、不看 `finish_reason` | 半句话、状态码 200 | 先确认 `finish_reason == "stop"`(Day 122) |
| 开思考 + 小 `max_tokens` | `content` 是空字符串,`finish_reason` 是 `length`,钱照付 | 开思考给足几千(Day 122) |
| 点号取厂商字段 | 编辑器红线,换一家就 `AttributeError` | `usage.model_extra.get(键, 默认值)`(Day 122) |
| 切配置时没写 `override=True` | 打印「.env.sf」,请求发去 DeepSeek,不报错 | 加 `override=True`,并打印实际 `base_url`(Day 123) |
| 以为兼容就等于一样 | 同一道题 DeepSeek 3/3 对、硅基流动 1/3 对 | 换厂商前把自己的题测一遍(Day 123) |
| 用 `total_tokens` 乘一个单价 | 0.0053 元,真实是 0.0006 元 | 三种 token 分开算(Day 124) |
| 命中的部分算了两遍 | 0.01032 元对 0.00432 元,没有任何报错 | 未命中数用 `prompt_tokens - hit`;用测试抓(Day 124) |
| 会变的东西放在系统提示词开头 | 缓存永远命不中,每月贵 5 倍 | 不变的放前面,变的放后面(Day 124) |
| `uv run part02/xxx.py` 运行要导入 `common` 的脚本 | `ModuleNotFoundError: No module named 'common'` | 仓库根目录 `uv run python -m part02.xxx`(Day 124) |

## 动手练习

**练习 1:默写 `split_input` 和 `call_cost`。** 不看 Day 124,在 `part02/review_week18.py` 里写出 `my_split(u)` 和 `my_cost(u, p)`,再造四种形状的 `usage`(DeepSeek 无缓存、DeepSeek 命中 2432、只有 `cached_tokens`、什么缓存信息都没有),逐个和 `common/cost.py` 比对。价格用高峰价 `Price(hit=0.04, miss=2, out=8)`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/review_week18.py
from openai.types import CompletionUsage

from common.cost import Price, call_cost, split_input

PEAK = Price(hit=0.04, miss=2, out=8)


def my_split(u: CompletionUsage) -> tuple[int, int]:
    extra = u.model_extra or {}
    hit = extra.get("prompt_cache_hit_tokens")
    if hit is None and u.prompt_tokens_details is not None:
        hit = u.prompt_tokens_details.cached_tokens
    hit = hit or 0
    return hit, u.prompt_tokens - hit


def my_cost(u: CompletionUsage, p: Price) -> float:
    hit, miss = my_split(u)
    return (hit * p.hit + miss * p.miss + u.completion_tokens * p.out) / 1_000_000


CASES = {
    "DeepSeek 无缓存": {"prompt_tokens": 27, "completion_tokens": 67, "total_tokens": 94,
                        "prompt_cache_hit_tokens": 0, "prompt_cache_miss_tokens": 27},
    "DeepSeek 命中 2432": {"prompt_tokens": 2615, "completion_tokens": 20, "total_tokens": 2635,
                           "prompt_cache_hit_tokens": 2432, "prompt_cache_miss_tokens": 183},
    "只有 cached_tokens": {"prompt_tokens": 3500, "completion_tokens": 400, "total_tokens": 3900,
                           "prompt_tokens_details": {"cached_tokens": 3000}},
    "什么都没有": {"prompt_tokens": 100, "completion_tokens": 10, "total_tokens": 110},
}
for name, data in CASES.items():
    u = CompletionUsage.model_validate(data)
    mine, ref = my_cost(u, PEAK), call_cost(u, PEAK)
    print(f"{name:12} 拆分 {my_split(u)} 花费 ¥{mine:.6f}  和 common/cost.py 一样: {my_split(u) == split_input(u) and mine == ref}")
```

<div class="line-notes">

- `from openai.types import CompletionUsage` `usage` 的类型,用它的 `model_validate` 从字典造对象。
- `from common.cost import Price, call_cost, split_input` 要比对的原版。
- `PEAK = Price(hit=0.04, miss=2, out=8)` DeepSeek flash 的高峰价。
- `extra = u.model_extra or {}` DeepSeek 自己加的字段都在 `model_extra` 里,可能是 `None`,`or {}` 换成空字典。
- `hit = extra.get("prompt_cache_hit_tokens")` 先找 DeepSeek 的字段,没有得到 `None`。
- `if hit is None and u.prompt_tokens_details is not None:` DeepSeek 字段没有,再退到 OpenAI 标准的 `cached_tokens`。
- `hit = hit or 0` 两处都没有或者值是 `None`,按没命中算:宁可算贵。
- `return hit, u.prompt_tokens - hit` 未命中数 = 总输入 - 命中数。第二个用例:2615 - 2432 = 183。
- `return (hit * p.hit + miss * p.miss + u.completion_tokens * p.out) / 1_000_000` 第二个用例:(2432 × 0.04 + 183 × 2 + 20 × 8) ÷ 1,000,000 = 623.28 ÷ 1,000,000 ≈ 0.000623。
- `"DeepSeek 无缓存": {"prompt_tokens": 27,` 第一个用例是 Day 122 `show_response.py` 的真实数字,手算 (27 × 2 + 67 × 8) = 590,所以是 0.00059。
- `"只有 cached_tokens": {"prompt_tokens": 3500,` 模拟只给 OpenAI 标准字段的厂商:3000 命中、500 未命中、400 输出,(120 + 1000 + 3200) = 4320,所以是 0.00432。
- `"什么都没有": {"prompt_tokens": 100,` 一点缓存信息都没有,全按未命中:(200 + 80) = 280,所以是 0.00028。
- `for name, data in CASES.items():` 遍历字典的键和值(Day 24)。
- `u = CompletionUsage.model_validate(data)` 字典变 `usage` 对象。
- `mine, ref = my_cost(u, PEAK), call_cost(u, PEAK)` 同一个 `usage`,我的版本和原版各算一次。元组打包再解包,一行赋两个变量。
- `print(f"{name:12} 拆分 {my_split(u)} 花费 ¥{mine:.6f}  和 common/cost.py 一样: {my_split(u) == split_input(u) and mine == ref}")` 拆分结果和金额都相等才是 `True`。两边做的是同一顺序的浮点运算,按位相同,所以能直接用 `==`;不同算法算出来的小数要用差值或 `pytest.approx` 比。

</div>

```bash
uv run python -m part02.review_week18
```

实跑输出:

```text
DeepSeek 无缓存 拆分 (0, 27) 花费 ¥0.000590  和 common/cost.py 一样: True
DeepSeek 命中 2432 拆分 (2432, 183) 花费 ¥0.000623  和 common/cost.py 一样: True
只有 cached_tokens 拆分 (3000, 500) 花费 ¥0.004320  和 common/cost.py 一样: True
什么都没有        拆分 (0, 100) 花费 ¥0.000280  和 common/cost.py 一样: True
```

四个用例都过。默写时最容易错的是 `hit or 0` 那一行:忘了它,「什么都没有」那个用例就会拿 `None` 去做减法,报 `TypeError: unsupported operand type(s) for -: 'int' and 'NoneType'`。

</details>

**练习 2:配置串味的体检。** 不调 API,写 `part02/vendor_check.py`:读 `ENV_FILE` 指定的配置文件(默认 `.env`),打印配置文件名,以及读完以后环境变量里**实际**的 `LLM_BASE_URL` 和 `LLM_MODEL`。命令行带 `--no-override` 时用 `load_dotenv(env_file)`,否则用 `override=True`。先在终端里 `export` 一份 DeepSeek 的地址和模型名,再用 `ENV_FILE=.env.sf` 分别跑两种模式,把 Day 123 的串味现象自己重现一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/vendor_check.py
import os
import sys

from dotenv import load_dotenv

override = "--no-override" not in sys.argv
env_file = os.environ.get("ENV_FILE", ".env")
load_dotenv(env_file, override=override)
print(f"配置文件 {env_file}, override={override}")
print("实际 base_url:", os.environ["LLM_BASE_URL"])
print("实际 model   :", os.environ["LLM_MODEL"])
```

<div class="line-notes">

- `import sys` 要读命令行参数。
- `override = "--no-override" not in sys.argv` `sys.argv` 是命令行参数列表,`in` 判断列表里有没有这一项,`not in` 取反。没带 `--no-override` 时 `override` 是 `True`,带了就是 `False`。
- `env_file = os.environ.get("ENV_FILE", ".env")` Day 123 的选厂商写法,没设就读 `.env`。
- `load_dotenv(env_file, override=override)` 把「覆盖不覆盖」做成一个变量,同一份代码演示两种行为。
- `print(f"配置文件 {env_file}, override={override}")` 打印「我以为」的。
- `print("实际 base_url:", os.environ["LLM_BASE_URL"])` 打印「实际」的,读的是进程里的环境变量,和客户端真正会用的是同一个值。
- `print("实际 model   :", os.environ["LLM_MODEL"])` 模型名同理,等号对齐只是为了好看。

</div>

```bash
export LLM_BASE_URL=https://api.deepseek.com LLM_MODEL=deepseek-flash
ENV_FILE=.env.sf uv run python -m part02.vendor_check --no-override
ENV_FILE=.env.sf uv run python -m part02.vendor_check
unset LLM_BASE_URL LLM_MODEL
```

实跑输出:

```text
配置文件 .env.sf, override=False
实际 base_url: https://api.deepseek.com
实际 model   : deepseek-flash
配置文件 .env.sf, override=True
实际 base_url: https://api.siliconflow.cn/v1
实际 model   : deepseek-ai/DeepSeek-V4-Flash
```

第一组:文件写的是硅基流动,实际用的却是 DeepSeek 的地址和模型,没有任何报错。更危险的是 `LLM_API_KEY` 终端里没设,所以这一项被 `.env.sf` 填上了,于是这个请求会带着**硅基流动的 key 发给 DeepSeek**。最后一行 `unset` 别忘:`export` 出来的变量会留在这个终端窗口里,影响后面所有脚本。

</details>

**练习 3:本地跑还是调 API。** 沿用小项目最后一行的思路,写 `part02/local_vs_api.py`:从 `fit_check.py` 导入 `need_gb`,从 `week18_lab.py` 导入 `local_hours`,对 2019 款 Intel MBP(带宽 34.1)、M4(120)、M4 Pro(273)三台机器,按 Day 119 的公式算 Qwen3.5-9B Q4(5.68 GB)的速度上限,按「实际是上限的三分之一」折算,再算每天 1 万次、每次输出 80 个 token 要几个小时。API 那边直接用 Day 124 练习 4 的结果:每月 352 元。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/local_vs_api.py
from part02.fit_check import need_gb
from part02.week18_lab import local_hours

MACHINES = {"2019 Intel MBP": 34.1, "M4": 120, "M4 Pro": 273}
NINE_B_Q4_GB = 5.68
REAL_RATIO = 1 / 3
CALLS, OUT_TOKENS = 10_000, 80
API_MONTH_YUAN = 352

print(f"Qwen3.5-9B Q4 约需内存 {need_gb(9.65):.1f} GB")
for machine, bandwidth in MACHINES.items():
    upper = bandwidth / NINE_B_Q4_GB
    real = upper * REAL_RATIO
    hours = local_hours(CALLS, OUT_TOKENS, real)
    print(f"{machine:15} 上限 {upper:5.1f} 实际约 {real:5.1f} token/秒  一天的活要 {hours:6.1f} 小时")
print(f"同样一天的活,API 一个月 ¥{API_MONTH_YUAN},平均一天 ¥{API_MONTH_YUAN / 30:.1f}")
```

<div class="line-notes">

- `from part02.fit_check import need_gb` Day 119 的内存估算函数。能直接导入,是因为那个文件有 main guard;从 `part02` 包里导入要用 `-m` 方式运行。
- `from part02.week18_lab import local_hours` 小项目里的函数。这也是为什么小项目要加 main guard:不加的话,这一行导入就会把四个探针真的跑一遍。
- `MACHINES = {"2019 Intel MBP": 34.1, "M4": 120, "M4 Pro": 273}` 机器名对内存带宽(GB/s),Day 119 的表。
- `NINE_B_Q4_GB = 5.68` Qwen3.5-9B 的 `Q4_K_M` 文件大小。稠密模型每生成一个 token 要把整个文件读一遍。
- `REAL_RATIO = 1 / 3` Day 119 在 Intel Mac 上测的 0.6B 模型:实测 16.96 对理论 53.3,约三分之一。把这个比例套到别的机器上是一个粗估,M 系列实际可能更接近上限。
- `API_MONTH_YUAN = 352` Day 124 练习 4 的结果。
- `print(f"Qwen3.5-9B Q4 约需内存 {need_gb(9.65):.1f} GB")` 9.65 × 0.6 + 1.18 + 0.5 = 7.5 GB,放得下 16 GB 的机器。放得下是第一关,下面才是第二关。
- `upper = bandwidth / NINE_B_Q4_GB` 带宽 ÷ 每个 token 读的字节数。Intel MBP:34.1 ÷ 5.68 = 6.0。
- `real = upper * REAL_RATIO` 6.0 × 1/3 = 2.0。
- `hours = local_hours(CALLS, OUT_TOKENS, real)` 10,000 × 80 ÷ 2.0 ÷ 3600 = 111.1 小时。M4:10,000 × 80 ÷ 7.0 ÷ 3600 = 31.6。
- `print(f"同样一天的活,API 一个月 ¥{API_MONTH_YUAN},平均一天 ¥{API_MONTH_YUAN / 30:.1f}")` 352 ÷ 30 = 11.7。

</div>

```bash
uv run python -m part02.local_vs_api
```

实跑输出:

```text
Qwen3.5-9B Q4 约需内存 7.5 GB
2019 Intel MBP  上限   6.0 实际约   2.0 token/秒  一天的活要  111.0 小时
M4              上限  21.1 实际约   7.0 token/秒  一天的活要   31.6 小时
M4 Pro          上限  48.1 实际约  16.0 token/秒  一天的活要   13.9 小时
同样一天的活,API 一个月 ¥352,平均一天 ¥11.7
```

(第二行是 111.0,小项目里是 111:这里的速度是 34.1 ÷ 5.68 ÷ 3 = 2.0012,小项目里直接写死成 2,所以差了一点点。)

要在一天 24 小时内做完这一天的活,连 M4 Pro 都不够(13.9 小时,只够这一天,没有余量),笔记本更不行。API 一天 11.7 元。这个对比是粗估,没算输入的读取时间,也没算本地能同时跑几路,但量级已经说明问题:**本地模型适合隐私、离线和实验,不适合在笔记本上扛生产流量**。

</details>

**练习 4:故意写错模型名。** 写 `part02/wrong_model.py`,用 `week18_lab.py` 的 `load_vendor(".env")` 取得客户端,把模型名改成 `deepseek-nonexistent`,捕获 `openai.BadRequestError`,打印状态码和 `e.message`。回答:这个错误是谁的问题、该不该重试?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/wrong_model.py
import openai
from part02.week18_lab import load_vendor

v = load_vendor(".env")
try:
    v.client.chat.completions.create(
        model="deepseek-nonexistent",
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=5,
        extra_body=v.extra_body,
    )
except openai.BadRequestError as e:
    print("状态码:", e.status_code)
    print("消息:", e.message)
```

<div class="line-notes">

- `from part02.week18_lab import load_vendor` 复用小项目的函数,不用再写一遍读配置。
- `v = load_vendor(".env")` 读 DeepSeek 的配置。
- `model="deepseek-nonexistent",` 故意写错的模型名,请求体别的部分都是对的。
- `max_tokens=5,` 万一模型名碰巧对了,也只花几厘钱。
- `except openai.BadRequestError as e:` 400 对应的异常类,Day 120 的报错五。
- `print("状态码:", e.status_code)` 异常对象带着状态码。
- `print("消息:", e.message)` 厂商返回的说明,这一条还把正确的名字列出来了。

</div>

```bash
uv run python -m part02.wrong_model
```

实跑输出:

```text
状态码: 400
消息: Error code: 400 - {'error': {'message': 'The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-nonexistent. (request_id: 39539242-c277-4e3c-8b4f-dd0a110f165a)', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

这是**你的代码**的问题:请求本身就是错的,原样再发一百遍结果还是 400,所以**不该重试**,该改配置。消息里连支持的名字都列出来了(`deepseek-flash`、`deepseek-v4-pro`),看到 400 先读 `e.message`,答案经常就在里面。后面两天会把「谁的问题、该不该重试」整理成一张表,再写成代码。

</details>

**练习 5:三分钟讲清一次调用。** 面试开放题:「你在 Python 里调用一个大模型 API,从代码开始到拿到账单,中间发生了什么?」只用 Day 119–124 学过的东西,写一段三分钟能讲完的回答,要提到:key 和 `base_url` 放哪里、请求体里最关键的几个字段、响应里必看的两个字段、换厂商要改什么、怎么算钱。写在 `part02/explain_call.md` 里,读出来计时。

<details><summary>参考答案</summary>

这是一个示范,不是标准答案,你的版本只要每一环都讲对、每一环带一个具体数字就行:

> 我把 key、`base_url`、模型名、扩展参数和价格都放在 `.env` 里,`.env` 在 `.gitignore` 里,所以换厂商就是换一个配置文件,代码一行不改。脚本里用 openai SDK,它实际做的就是往 `base_url` 加 `/chat/completions` 发一个 POST,头里带 `Authorization: Bearer key`,体里是 JSON:`model`、`messages`、`max_tokens`,以及 DeepSeek 自己的字段比如 `thinking`,SDK 不认识的字段要放进 `extra_body`,拼错了不会报错、只是不生效。服务端回来的响应我先看 `choices[0].finish_reason`:`stop` 才是正常说完,`length` 是被 `max_tokens` 截断了,这种情况状态码照样是 200,不看就会把半句话当成答案。然后看 `usage`:输入分缓存命中和未命中,输出里包含推理 token。算钱就是命中数乘命中价、未命中数乘未命中价、输出数乘输出价,再除以一百万;DeepSeek 命中价 0.04 元、未命中价 2 元,差 50 倍,所以系统提示词和工具定义放前面、变的放后面,我实测过一段 2600 token 的提示词第二次命中 2432 个,单次从 0.0054 元降到 0.0006 元。换厂商时扩展参数、模型名、价格、缓存命中率都不一样,我会先用同一批题测一遍,不能只信「兼容」两个字。

我自己读了一遍,大约 2 分 30 秒。这一段能讲顺,说明本周的流程图已经装进脑子里了。

</details>

**验收标准:** `week18_lab.py` 对 `.env` 和 `.env.sf` 都跑通,输出和文章一致(耗时和花费有零头差别是正常的);`review_week18.py` 四个用例全 `True`;`vendor_check.py` 能重现配置串味;`local_vs_api.py` 的算式能手算出第一行;`wrong_model.py` 能看到 400 和 `e.message` 里的支持列表;流程图能默画,坑清单盖住右边能说出现象和修法;练习 5 三分钟内讲完。

今天的花费:`week18_lab.py` 跑一次,DeepSeek 一侧是 0.000366(正常问答)+ 截断那次(30 个输出,约 0.0003)+ 缓存两次 0.005422 + 0.000623,约 0.0067 元;硅基流动一侧约 0.0003 + 0.0003 + 0.007986 + 0.002438,约 0.0110 元;一遍合计约 0.0177 元;写文章时整套跑了三遍、又单独看了一遍每次调用的 token 数,加上练习 4 的一次 400(不计费),全天约 0.08 元。

## 名词解释

本周新词都在各天的表里,这里只列今天第一次出现、或者换了个角度用的:

| 名词 | 意思 |
| --- | --- |
| 调用体检(本课说法) | 用一组固定的探针,对一家 API 厂商各测一遍,量出耗时、花费、报错形态、缓存命中。和 Day 118 对玩具模型的体检同一个思路 |
| 探针(probe) | 往系统里放一个已知输入,看它的反应对不对。`probe_bad_key` 放假 key,期望 401;`probe_truncate` 放过小的 `max_tokens`,期望能被发现 |
| `time.perf_counter()` | Python 里量一小段耗时用的高精度计时器,只用来做两次读数的差,不代表现实时间 |
| `int \| str` | 联合类型的写法,表示「整数或者字符串」,[Day 46](/blog/agent-zero/day-046-type-hints-2/) 讲的 `X \| None` 是同一种写法 |
| `sys.argv[1:]` | 命令行里脚本名后面的全部参数,是个列表,没传参数时是空列表 |
| `:.0%` | f-string 的格式,把小数按百分数显示,`0.885` 显示为 `89%`,自带乘 100 |
| `unset` | shell 命令,删掉一个环境变量;`export` 出来的变量不删会一直留到关闭这个终端窗口 |

## 常见误区

**用一次调用的花费比两家厂商的贵贱。** 今天硅基流动那次正常问答 0.000270 元,比 DeepSeek 的 0.000366 元便宜,可它的单价明明更高,只是这一次输出短了 17 个 token。比价格要看单价表,比实际花费要测几十次、固定输出长度。

**以为 401 的探针会花钱。** 没通过鉴权的请求不会进到计费,所以假 key 探针是零成本的,可以放心地放进每次部署前的检查里。真正花钱的是通过了鉴权、模型开始算的请求。

**复习只看不写。** 读一遍觉得都懂,合上文章默写 `split_input` 时才发现 `hit or 0` 那一行想不起来,忘了它整个函数就会在「什么缓存信息都没有」的厂商上崩掉。默写比重读有效得多,写错的地方就是没懂的地方。

**把本周的数字当成永远成立。** 价格、缓存块大小、默认是否开思考、模型的开放版本,都是 2026 年 10 月查到或测到的。DeepSeek 的页面最后一句就是「保留调整价格的权利」。记住怎么测,比记住数字更重要。

**导入一个没有 main guard 的文件。** 小项目里重写了 `IncompleteAnswer`,是因为 `ask2.py` 导入时会直接发请求;练习 3 里导入 `local_hours` 没事,是因为小项目的最后两行放在 `if __name__ == "__main__":` 下面。自己写要被别人导入的文件,演示代码都放进 main guard。

**`export` 完忘了 `unset`。** 练习 2 里为了重现串味,在终端里设了 `LLM_BASE_URL` 和 `LLM_MODEL`。不 `unset`,之后在这个窗口跑的每个脚本都读到旧值,表现为「改了 `.env` 不生效」,查半天才发现是自己留下的。

## 学习资料

### 文档与文章

- [DeepSeek 价格与计费](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):Day 124 查价的页面。复习时重新打开,对一遍今天 `.env` 里的 `LLM_PRICE=0.04,2,8` 还是不是最新,养成「用之前先核价」的习惯。
- [DeepSeek 错误码](https://api-docs.deepseek.com/zh-cn/quick_start/error_codes):下一课 Day 126 的主角,今天先扫一眼 400、401、402、422、429、500、503 各写了什么。
- [openai-python 仓库的 README](https://github.com/openai/openai-python):官方 SDK 的说明。重点看「Handling errors」和「Retries」两节,它们是 Day 126、127 的底子;「Timeouts」一节顺便看看默认超时是多少。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1kJPvzcEjV&autoplay=0&high_quality=1" title="手把手教你用30分钟学会Python调用大模型API" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>A1星球 · 手把手教你用 30 分钟学会 Python 调用大模型 API · 42 分钟,2026 年 3 月。Day 122、123 各推荐过一部分,复习日完整看一遍:发请求、解析返回、换厂商,正好把本周的流程图走一遍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1keLp6GERQ&autoplay=0&high_quality=1" title="什么是缓存命中?8分钟说清楚KVCache与Prompt Cache" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>费曼学徒冬瓜 · 什么是缓存命中?8 分钟说清楚 KVCache 与 Prompt Cache · 8 分钟,2026 年 5 月。Day 124 推荐过。复习时再看一遍,这次试着在他讲每一步时,指出对应小项目 `probe_cache` 的哪一行。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/czvVibB2lRA" title="The OpenAI (Python) API | Introduction & Example Code" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Shaw Talebi · The OpenAI (Python) API | Introduction & Example Code · 英文,2023 年。Day 120、121 推荐过。复习时对照流程图看,用的是 OpenAI 自己的服务器和老模型名,只看思路。</figcaption>
</figure>

### 书籍

- 《AI Engineering》(Chip Huyen 著,O'Reilly,2025 年):今天这一周对应的是书里「模型选型」和「推理成本」两块,大致在第 4 章(评估 AI 系统)的选型一节和第 9 章(推理优化)开头讲成本与延迟的部分。复习日读这两处,看她怎么给「选哪家、花多少」下判断;我没核对过中文版的章节编号,以你手上那本的目录为准。

### 开源项目与代码

- [openai/openai-python](https://github.com/openai/openai-python):打开 `src/openai/_client.py`,找 `OpenAI.__init__` 里的 `max_retries` 和 `timeout`,看默认值写的是多少。这两个值是 Day 127 的内容,提前看一眼有个印象。

## 自测

1. 小项目里 DeepSeek 一次正常问答 0.000366 元,硅基流动 0.000270 元。能不能说硅基流动更便宜?

<details><summary>答案</summary>

不能。硅基流动的单价更高(输入 3 对 2、输出 9 对 8),这一次便宜是因为输出只有 25 个 token,DeepSeek 写了 42 个,输出价是大头。比价格看单价表,比实际花费要多次测量并固定输出长度。

</details>

2. 为什么 `max_tokens=30` 的截断探针不能靠 `try/except openai.APIError` 发现?

<details><summary>答案</summary>

因为这次请求在 HTTP 层面是成功的,状态码 200,SDK 没有任何理由抛异常。「说一半就停」是响应内容里的 `finish_reason == "length"`,只能自己读它再抛一个我们自己定义的异常。

</details>

3. `probe_bad_key` 里为什么要先写 `except openai.AuthenticationError`,再写 `except openai.APIStatusError`?顺序反过来会怎样?

<details><summary>答案</summary>

`AuthenticationError` 是 `APIStatusError` 的子类。`except` 从上往下匹配,父类放前面就会把所有 HTTP 错误(包括 401)全接走,下面那个更具体的永远用不上,代码看着分了类、实际没分。具体的放前面,通用的兜底放最后。

</details>

4. 同一段 2600 多 token 的系统提示词,DeepSeek 第二次命中 2432 个、硅基流动命中 2048 个,省的比例是 89% 和 69%。换厂商前,这件事说明要测什么?

<details><summary>答案</summary>

要测命中数和命中的稳定性,不能照搬一家的缓存数据去估另一家的账单。命中块大小、缓存价和「同样的前缀是不是每次都命中」都因厂商而异(Day 124 练习 3 还看到硅基流动第三次一个都没命中)。估成本时用自己测的数,并留余量。

</details>

5. 面试题:「你们的 Agent 上线后,模型调用的账单比预估高了 5 倍,请求量没变。你会怎么查?」只用这一周学过的东西回答。

<details><summary>答案</summary>

先看每次调用的 `usage`,拆成三个数:输入未命中、输入命中、输出。未命中占比高,查系统提示词开头有没有放会变的东西(时间、请求 ID),缓存命不中,Day 124 的实验里有无缓存每月差了 5 倍。输出多,查是不是默认开着思考模式(DeepSeek 默认开,Day 121),推理 token 按输出价收钱,或者 `max_tokens` 设得过大、回答没有限制长度。再看有没有重复调用和失败重试,最后看是不是高峰时段的比例变了(Day 124 的高峰价是空闲价的两倍)。这些都可以直接用 `call_cost` 对每次调用的 `usage` 逐条算出来,而不是只看月底总账单。

</details>

## 明天预告

[Day 126](/blog/agent-zero/day-126-error-codes/) · 错误码:401、429、5xx 谁的问题。这一周的 401 和 400 你已经亲手见过了,但生产里还有 402 余额不足、422 参数错、429 太快、500 和 503 厂商故障,还有连不上、超时这种根本没有状态码的错。明天先把它们分成「你的问题」「厂商的问题」「暂时的问题」三类,写一个 `classify` 函数,让代码自己判断出该不该重试;后天 Day 127 再讲重试怎么写。
