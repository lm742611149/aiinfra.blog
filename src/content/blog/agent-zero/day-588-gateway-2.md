---
title: 'Day 588 · 模型网关(二):预算配额、路由降级、成本归因,写一个最小网关'
description: '把 Day 586 的透传网关长成能上岗的样子:预算用完是拒绝还是降级,什么错误该换供应商、什么不该换,熔断器什么时候断开,每一笔账怎么记才能和供应商月账单对上;最后写成一个 200 行左右、带 8 个测试的最小网关,真上游只用 deepseek-flash,贵模型用本机假上游。'
pubDate: 2026-10-27
regime: none
tags: ['gateway', 'budget', 'circuit-breaker', 'cost-attribution', 'agent-zero']
series: 'agent-zero'
day: 588
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 586](/blog/agent-zero/day-586-gateway-1/) 写了一个 40 行的透传网关:业务方只改 `base_url` 和虚拟 key,真 key 留在网关里。后半天讲了为什么限流要按 token,写了令牌桶 `token_bucket.py`,还有「先预扣、拿到响应再按真实用量结算」。[Day 587](/blog/agent-zero/day-587-week84-review/) 的复习日把这周的东西串成了一个 `front_door.py`:请求进来要依次过认租户、核对请求体、暂停开关、模型策略、token 预扣五道关,但它的上游是假函数,没有预算,没有熔断,账本只是一个列表。

今天把这些补齐,接到真的上游上。你会看到网关在平台里最让人安心的三个能力:有人写了死循环,烧到预算上限就被拦住;主供应商一直 429,请求自动换到备用,而且换之前不会让每个请求都白等一次超时;月底财务问「每个部门花了多少」,你能拿出按项目、按 Agent 拆开的账,而且这份账和供应商的账单对得上。最后把所有东西写进一个带测试的最小网关,测试里的假上游不花一分钱。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清预算的三种处理方式(拒绝、降级到便宜模型、只告警)各适合什么场景,并在网关里实现「按月预算 + 超限后拒绝或降级 + 花到 80% 在响应头里提醒」。
2. 区分「换个地方可能就好了」和「换哪家都一样错」的错误,实现模型组里的顺序降级,写出熔断器并说清它为什么能省掉每个请求白白多等的那一次超时;解释为什么流式请求只能在第一个 chunk 之前降级。
3. 每次调用记一行账(租户、项目、Agent、run id、实际用了哪个部署、缓存命中、金额、价格版本),月底和供应商账单对账,并能从差额的大小和方向判断问题出在哪。
4. 写出一个带测试的最小网关,并用「故意改坏再看测试变红」确认测试有用。

预计用时 3 小时。前置:[Day 586](/blog/agent-zero/day-586-gateway-1/)(透传网关、令牌桶、预扣和结算)、[Day 587](/blog/agent-zero/day-587-week84-review/)(前门的五道关)、[Day 584](/blog/agent-zero/day-584-platform-2/)(租户策略和配额)、[Day 127](/blog/agent-zero/day-127-retry-backoff/)(429 和退避)、[Day 124](/blog/agent-zero/day-124-cost/)(从 usage 算钱)。

今天真调用了 deepseek-flash 8 次(每次 `max_tokens=20`),合计输入 77 token、输出 116 token。按 Day 586 用的价格(未命中 2 元、输出 8 元每百万 token)算,77 × 2 ÷ 1,000,000 + 116 × 8 ÷ 1,000,000 ≈ 0.0011 元,不到一分钱。所谓「贵模型」是本机的假上游,价格是我编的,只为了演示路由。测试全部走假上游,不联网。

代码放在 `agent-zero-lab/part10/gateway/`(Day 586 建的目录,`token_bucket.py` 已经在里面)。今天的新文件用相对导入,所以目录里要有两个空的 `__init__.py`,还要装三样东西:

```bash
cd agent-zero-lab
touch part10/__init__.py part10/gateway/__init__.py
uv add pyyaml
uv add --dev pytest
```

(`fastapi`、`uvicorn`、`httpx`、`openai`、`python-dotenv` 是 Day 586 装过的。`__init__.py` 相当于告诉 Python「这个目录是一个包」,有点像 JS 里目录下的 `index.js`;不加的话 pytest 会把测试文件当成顶层模块导入,相对导入就报错。)

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`gateway_v2.py` 里 `chat` 函数的五个步骤、`breaker.py` 的 `allow` 和 `record`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 今天往网关里加什么

Day 586 的网关只有三步:认虚拟 key、换真 key、记一行。今天它变成六步,每一步失败时回给业务方的状态码都不一样,这一点在排查问题时很重要:

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="最小网关处理一个请求的流程:鉴权失败回 401 或 403,预算用完回 402 或改走便宜组,限流不够回 429,路由降级全部失败回 503,成功则结算并记账">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="14" y="20" width="96" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="62" y="40" text-anchor="middle" fill="var(--ink)">1 鉴权</text><text x="62" y="56" text-anchor="middle" fill="var(--ink-soft)">虚拟 key→租户</text>
    <rect x="134" y="20" width="96" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="182" y="40" text-anchor="middle" fill="var(--ink)">2 预算</text><text x="182" y="56" text-anchor="middle" fill="var(--ink-soft)">本月花了多少</text>
    <rect x="254" y="20" width="96" height="46" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="302" y="40" text-anchor="middle" fill="var(--ink)">3 限流</text><text x="302" y="56" text-anchor="middle" fill="var(--ink-soft)">按 token 预扣</text>
    <rect x="374" y="20" width="116" height="46" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="432" y="40" text-anchor="middle" fill="var(--ink)">4 路由+降级</text><text x="432" y="56" text-anchor="middle" fill="var(--ink-soft)">熔断器把关</text>
    <rect x="514" y="20" width="112" height="46" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="570" y="40" text-anchor="middle" fill="var(--ink)">5 结算+记账</text><text x="570" y="56" text-anchor="middle" fill="var(--ink-soft)">多退少补</text>
  </g>
  <g stroke="var(--ink-faint)" stroke-width="1.2" fill="none">
    <path d="M110 43 L134 43"/><path d="M230 43 L254 43"/><path d="M350 43 L374 43"/><path d="M490 43 L514 43"/>
    <path d="M62 66 L62 110"/><path d="M182 66 L182 110"/><path d="M302 66 L302 110"/><path d="M432 66 L432 110"/>
  </g>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
    <rect x="14" y="110" width="96" height="70" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="62" y="130" text-anchor="middle">401</text><text x="62" y="148" text-anchor="middle" fill="var(--ink-soft)">key 不认识</text><text x="62" y="164" text-anchor="middle" fill="var(--ink-soft)">403 组不许用</text>
    <rect x="134" y="110" width="96" height="70" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="182" y="130" text-anchor="middle">402</text><text x="182" y="148" text-anchor="middle" fill="var(--ink-soft)">超预算拒绝</text><text x="182" y="164" text-anchor="middle" fill="var(--ink-soft)">或改走 cheap</text>
    <rect x="254" y="110" width="96" height="70" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="302" y="130" text-anchor="middle">429</text><text x="302" y="148" text-anchor="middle" fill="var(--ink-soft)">额度不够</text><text x="302" y="164" text-anchor="middle" fill="var(--ink-soft)">带 Retry-After</text>
    <rect x="374" y="110" width="116" height="70" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="432" y="130" text-anchor="middle">503</text><text x="432" y="148" text-anchor="middle" fill="var(--ink-soft)">组里全挂了</text><text x="432" y="164" text-anchor="middle" fill="var(--ink-soft)">400 原样还</text>
  </g>
  <g font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">
    <text x="14" y="214">· 预扣之后上游又失败了:预扣的额度要还回桶里(练习 3)</text>
    <text x="14" y="234">· 预算查的是「已经花的」,不含这一单,所以最多超一单</text>
    <text x="14" y="254">· 降级只在「换个地方可能就好了」时发生:429、5xx、超时、连不上</text>
    <text x="14" y="274">· 每次成功的调用写一行账:租户/项目/Agent/run id/实际部署/金额</text>
    <text x="14" y="294">· 响应头 x-gateway-deployment 告诉业务方实际用了哪个部署</text>
  </g>
</svg>
<figcaption>网关的六个出口。排查时先看状态码:401 和 403 是门没进去,402 是预算,429 是桶里额度不够,503 是组里的每个部署都试过了。</figcaption>
</figure>

下面按这个顺序一块一块讲,讲完再把它们写成一个文件。

## 预算和配额:拒绝、降级、还是只告警

限流管的是速率,预算管的是总量。令牌桶(Day 586)防的是一个租户在一分钟之内把所有人的额度挤光,预算防的是一个租户在一个月里把全部经费花光。两样都要有,而且它们拦下来的是不同的事故:死循环的批处理会被限流先拦住一部分,但把限流调得再松,月底的总额也不能超。

预算超了怎么办,有三种做法。

**拒绝**(HTTP 402):到了就不让调。适合内部的实验项目、个人 key。代价是业务停摆,所以它不适合线上的客服 Agent:客服停了一小时,损失往往比多花的那点钱大得多。

**只告警**:超了照常放行,但通知负责人。适合线上生产。缺点是没有硬刹车,死循环会一直烧到有人看到告警为止。所以我习惯把它拆成两档:花到 80% 时在响应头里带一条提醒,同时通知负责人;花到 100% 时再按租户的配置选拒绝还是降级。

**降级**:超了之后改走便宜的模型,调用方不会收到错误。LiteLLM 有个 `budget_fallbacks` 配置专门做这件事。这是三种里最需要小心的,因为它是产品决策而不是纯技术决策:回复质量会悄悄变差,而用户不知道。我的建议是只在评测过备用模型、确认质量能接受之后才开,并且一定要在响应头里标出实际用的是哪个模型和从哪个组降下来的,出了质量问题好追。今天的网关里就是这样做的:`x-gateway-downgraded-from: smart`。

预算检查还有一个不太明显的坑:它查的是「已经花的钱」,不包括正在处理的这一单,所以最多超一单。这在今天的演示里很明显:销售租户的月预算只有 0.005 元,而一次「贵模型」的调用要花 0.00984 元,第一次调用时账本里是 0,检查通过,调完花了 0.00984,已经超了接近一倍。要做到一分钱都不超,得预扣金额(像预扣 token 一样),复杂度会上一个台阶,而且并发请求同时检查时仍然会各自看到「还没超」。大多数内部平台接受「最多超一单、并发时超几单」,配合 80% 的提前提醒,够用了。

## 路由和降级

业务方调用时传的 `model` 不是具体的模型名,而是一个**模型组**的名字,比如 `fast`、`smart`。组背后是一个有序的部署列表,顺序就是降级顺序。这样平台可以在不通知业务方的情况下换供应商、换版本。

**什么错误该降级?** 判断标准只有一条:换个地方可能就好了。

- 429(被限流)、5xx(对方出故障)、超时、连不上:换一家很可能就成功,降级。
- 400(参数错)、401、403:换哪家都一样错,甚至错得更隐蔽,不降级,把错误原样还给调用方。
- 上下文超长:可以降级到上下文窗口更大的模型,这是一种单独的降级,今天没做。
- 内容安全拦截:有的供应商会拒绝某类内容,换一家可能就过了。这种降级要很小心,因为它可能是在绕开本该生效的安全策略,我的建议是不要自动做。

**熔断器**(circuit breaker)。假如主供应商挂了,而每个请求都先去敲它一下、等它超时、再切备用,那每个请求都多等了一次超时,而且你的网关还在持续打一个已经倒下的服务。熔断器的想法来自电路里的保险丝:某个部署连续失败 N 次,就「断开」一段时间,这段时间里直接跳过它;冷却时间过后放**一个**请求过去试探,成功了就恢复,失败了再断开一轮。

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="熔断器三个状态:正常、断开、半开;连续失败三次从正常变断开,冷却 30 秒后变半开放一个请求试探,试探成功回到正常,失败回到断开重新计时">
  <rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="30" y="70" width="130" height="56" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="95" y="94" text-anchor="middle" fill="var(--ink)">正常</text><text x="95" y="112" text-anchor="middle" fill="var(--ink-soft)">请求照常发</text>
    <rect x="255" y="70" width="130" height="56" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="320" y="94" text-anchor="middle" fill="var(--ink)">断开</text><text x="320" y="112" text-anchor="middle" fill="var(--ink-soft)">直接跳过,不去敲</text>
    <rect x="480" y="70" width="130" height="56" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="545" y="94" text-anchor="middle" fill="var(--ink)">半开</text><text x="545" y="112" text-anchor="middle" fill="var(--ink-soft)">放一个去试探</text>
    <text x="207" y="62" text-anchor="middle" fill="var(--ink-soft)">连续失败 3 次</text>
    <text x="432" y="62" text-anchor="middle" fill="var(--ink-soft)">冷却 30 秒</text>
    <text x="320" y="170" text-anchor="middle" fill="var(--ink-soft)">试探成功 → 回到正常;试探失败 → 回到断开,重新计时</text>
  </g>
  <g stroke="var(--ink-faint)" stroke-width="1.4" fill="none">
    <path d="M160 98 L255 98"/><path d="M385 98 L480 98"/>
    <path d="M545 126 L545 150 L95 150 L95 126" stroke-dasharray="4 3"/>
    <path d="M545 126 L545 140 L320 140 L320 126" stroke-dasharray="4 3"/>
  </g>
</svg>
<figcaption>熔断器的三个状态。「半开」不需要单独存状态:断开之后只要过了冷却时间,下一次 allow() 就放行,等于进入半开。</figcaption>
</figure>

先把熔断器单独写出来,它是个很小的类:

```python
# agent-zero-lab/part10/gateway/breaker.py
"""熔断器:连续失败 threshold 次就「断开」cooldown 秒,冷却后放一个请求去试探。时钟可注入。
用法:uv run python part10/gateway/breaker.py
"""
import time
from typing import Callable


class CircuitBreaker:
    def __init__(self, threshold: int = 3, cooldown: float = 30.0, clock: Callable[[], float] = time.monotonic) -> None:
        self.threshold = threshold
        self.cooldown = cooldown
        self.clock = clock
        self.failures = 0
        self.opened_at: float | None = None

    def allow(self) -> bool:
        if self.opened_at is None:
            return True
        return self.clock() - self.opened_at >= self.cooldown      # 冷却够了:半开,放一个去试探

    def record(self, ok: bool) -> None:
        if ok:
            self.failures, self.opened_at = 0, None
            return
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened_at = self.clock()                           # 试探失败也会走到这里,重新计时


if __name__ == "__main__":
    now = [0.0]
    b = CircuitBreaker(threshold=3, cooldown=30, clock=lambda: now[0])
    for t, ok in [(0, False), (1, False), (2, False), (10, None), (31, None), (32, None), (32, False), (40, None), (63, None), (64, True), (65, None)]:
        now[0] = t
        if ok is None:
            print(f"t={t:>2}s 问一下 allow() → {b.allow()}")
        else:
            b.record(ok)
            state = "断开" if b.opened_at is not None else "正常"
            print(f"t={t:>2}s 记一次{'成功' if ok else '失败'} → 连续失败 {b.failures},状态 {state}")
```

<div class="line-notes">

- `def __init__(self, threshold: int = 3, cooldown: float = 30.0, clock: Callable[[], float] = time.monotonic) -> None:` 连续失败 3 次就断开,冷却 30 秒。`clock` 和 Day 586 的令牌桶一样可以注入,测试和演示用假时钟,不用真的等 30 秒。
- `self.failures = 0` 连续失败的次数。注意是「连续」:一次成功就清零。
- `self.opened_at: float | None = None` 断开的时刻。`None` 表示没断开,这一个字段就够表示整个状态,不需要另存「正常/断开/半开」。
- `if self.opened_at is None:` 没断开,放行。
- `return self.clock() - self.opened_at >= self.cooldown      # 冷却够了:半开,放一个去试探` 断开了就看过没过冷却时间。代入演示里 t=2 秒断开:t=10 时 10 − 2 = 8 < 30,不放行;t=31 时 29 < 30,不放行;t=32 时 30 ≥ 30,放行。
- `self.failures, self.opened_at = 0, None` 成功了:失败计数清零,断开状态解除。
- `self.failures += 1` 失败了计数加一。
- `self.opened_at = self.clock()                           # 试探失败也会走到这里,重新计时` 达到阈值就记下现在的时刻。半开状态下试探失败时 `failures` 本来就在阈值以上,所以会再走一次这一行,冷却时间从头算。
- `now = [0.0]` 和 Day 586 令牌桶里一样的假时钟技巧:时间装在列表里,lambda 才能读到最新值。
- `for t, ok in [(0, False), (1, False), (2, False), (10, None), (31, None), (32, None), (32, False), (40, None), (63, None), (64, True), (65, None)]:` 每个元组是「在第 t 秒发生什么」:`False` 记一次失败,`True` 记一次成功,`None` 只是问一下 `allow()`。

</div>

```bash
uv run python part10/gateway/breaker.py
```

```text
t= 0s 记一次失败 → 连续失败 1,状态 正常
t= 1s 记一次失败 → 连续失败 2,状态 正常
t= 2s 记一次失败 → 连续失败 3,状态 断开
t=10s 问一下 allow() → False
t=31s 问一下 allow() → False
t=32s 问一下 allow() → True
t=32s 记一次失败 → 连续失败 4,状态 断开
t=40s 问一下 allow() → False
t=63s 问一下 allow() → True
t=64s 记一次成功 → 连续失败 0,状态 正常
t=65s 问一下 allow() → True
```

对着图看:前三行连续失败,第三次(t=2 秒)状态变成「断开」。t=10 和 t=31 问,都不放行(31 − 2 = 29 秒,还差 1 秒冷却)。t=32 放行,这就是半开:放一个去试探,试探失败(第 5 行),连续失败变成 4,断开的时刻更新成 32 秒。所以 t=40 不放行,t=63 才放行(63 − 32 = 31 秒)。这次试探成功了,t=64 记成功,恢复正常。

熔断器省下的是什么,等会儿跑真网关时有一个具体的数字:主用部署永远回 429,连发 5 个请求,它只被敲了 3 次,后面两个请求根本没去敲它。

**降级的隐性成本。** 换一家模型,回复的风格、格式稳定性、工具调用的可靠性都可能变。所以降级目标必须在你的评测集上跑过(第 11 周的评测平台要把备用模型也纳入回归)。还有两个技术细节:推理模型的加密推理内容不能跨供应商使用,多轮对话中途切了供应商,之前的推理上下文就丢了;流式请求只能在第一个 token 返回之前降级,这一点放到后面单独演示。

## 成本归因

成本归因是网关最容易被低估的功能。没有它,财务问你每个部门花了多少,你只能按人头平摊,然后被各部门质疑。

做法是每一次成功的调用都记一行账。要记的东西分三类:

维度,也就是「这笔钱算在谁头上」:租户、项目、Agent、run id(一次任务)、模型组、实际用的部署。项目、Agent 和 run id 不需要业务方改 SDK,让他们在请求头里带 `X-Project`、`X-Agent`、`X-Run-Id` 就行(openai SDK 的 `extra_headers` 参数可以加)。注意记**实际**用的部署:请求的是 `smart` 组,实际落到了备用的 flash,账要记在 flash 上,不然对不上供应商的账单。

用量:输入 token、其中命中缓存的 token、输出 token。缓存命中的价格只有未命中的几十分之一(DeepSeek 是 0.04 对 2,差 50 倍),不区分的话成本会算得很离谱。不同供应商报缓存命中的字段名不一样:DeepSeek 叫 `prompt_cache_hit_tokens`,OpenAI 风格的叫 `prompt_tokens_details.cached_tokens`,网关该替业务方把这个差异抹平,`cost_of` 里两个都认。

价格版本:供应商调价后,历史账单应该按当时的价格算,所以价格表要有版本号,每一行账记下用的是哪一版。我们的配置里 `price_version: "2026-10-27"`。

**月底对账。** 每个月底拿网关的账和供应商的发票对一次。差额在 2% 以内通常正常(四舍五入、个别没走网关的调用);差额大了要查,而且差额的**方向和大小**能告诉你查哪里:

- 账单比账本多一截,而且多出来的钱集中在一两个部署上:有人绕过网关,拿着真 key 直连。
- 账本比账单大很多,而且集中在用了缓存的部署上:网关漏解析了缓存命中字段,把命中的 token 也按未命中价格算了。
- 全部部署都差一个固定比例:价格表没更新,或者汇率、折扣没算。

后面实跑里我会用一份手写的「假账单」把这三种情况各演示一遍。

账拿到以后怎么用,有两种模式。**Showback**(展示)只给各部门看他们花了多少,不真扣钱;**chargeback**(回收)真的从各部门预算里扣。内部平台起步时建议先 showback,等数据准确、大家认可了口径再谈 chargeback,否则第一个月就会陷入「这个钱凭什么算我的」的扯皮。

## 写一个最小网关

下面把所有东西写成文件。先是配置。真实系统里这些在控制面([Day 585](/blog/agent-zero/day-585-platform-3/)),今天放在一个 YAML 里。

```yaml
# agent-zero-lab/part10/gateway/config.yaml
price_version: "2026-10-27"          # 价格表也要有版本:事后对账才知道当时按什么价算的

deployments:                          # 价格:元 / 百万 token,三个数依次是 缓存命中、未命中、输出
  flash:                              # 真的 DeepSeek,价格沿用 Day 586 用的那一组
    base_url: ${LLM_BASE_URL}
    api_key_env: LLM_API_KEY
    model: ${LLM_MODEL}
    price: {hit: 0.04, miss: 2.0, out: 8.0}
  pro-fake:                           # 「贵模型」:本机假上游,价格是我编的,只为了演示路由
    base_url: http://127.0.0.1:8590/ok
    api_key_env: FAKE_KEY
    model: fake-pro
    price: {hit: 0.4, miss: 12.0, out: 48.0}
  flaky-fake:                         # 永远回 429 的假上游,演示降级和熔断
    base_url: http://127.0.0.1:8590/limited
    api_key_env: FAKE_KEY
    model: fake-flaky
    price: {hit: 0.04, miss: 2.0, out: 8.0}

model_groups:                         # 业务方只认组名;组内的顺序就是降级顺序
  fast: [flash]
  fast-ha: [flaky-fake, flash]        # 主用一个会 429 的,备用真 flash
  smart: [pro-fake, flash]
  cheap: [flash]                      # 超预算后「降级」去的地方

tenants:                              # 真实系统里在控制面,key 只存哈希
  support:
    virtual_key: vk-support-001       # 演示用,明文写在这里;网关启动时马上变成哈希,之后只比哈希
    allowed_groups: [fast, fast-ha, smart]
    tpm: 60000
    monthly_budget_cny: 5.0
    on_budget_exceeded: reject        # reject = 402;downgrade = 改走 cheap 组
  sales:
    virtual_key: vk-sales-002
    allowed_groups: [smart, cheap]
    tpm: 20000
    monthly_budget_cny: 0.005
    on_budget_exceeded: downgrade
```

<div class="line-notes">

- `price_version: "2026-10-27"          # 价格表也要有版本:事后对账才知道当时按什么价算的` 每行账都会记下这个版本号。供应商调价时改价格同时改这个版本号。
- `flash:                              # 真的 DeepSeek,价格沿用 Day 586 用的那一组` 唯一一个真实的上游。`${LLM_BASE_URL}` 和 `${LLM_MODEL}` 在加载时会被换成环境变量的值(`.env` 里是 `https://api.deepseek.com` 和 `deepseek-flash`)。
- `price: {hit: 0.04, miss: 2.0, out: 8.0}` 元每百万 token:缓存命中 0.04,未命中 2,输出 8。
- `pro-fake:                           # 「贵模型」:本机假上游,价格是我编的,只为了演示路由` 我不用 `deepseek-v4-pro` 做实跑(课程规定只用 flash),所以「贵模型」指向本机 8590 端口上的假上游,价格(未命中 12 元、输出 48 元)是随手编的。
- `base_url: http://127.0.0.1:8590/ok` 假上游的 `/ok` 路径,正常返回。
- `flaky-fake:                         # 永远回 429 的假上游,演示降级和熔断` 指向 `/limited` 路径,永远回 429。
- `fast: [flash]` 最简单的组,只有一个部署。
- `fast-ha: [flaky-fake, flash]        # 主用一个会 429 的,备用真 flash` 带降级的组:先试 flaky-fake,失败再试 flash。`ha` 是 high availability(高可用)的缩写。
- `smart: [pro-fake, flash]` 贵模型在前,flash 兜底。
- `cheap: [flash]                      # 超预算后「降级」去的地方` 预算超限后改走的组。
- `virtual_key: vk-support-001       # 演示用,明文写在这里;网关启动时马上变成哈希,之后只比哈希` 真实系统里配置里只有哈希。
- `monthly_budget_cny: 5.0` 客服租户月预算 5 元。
- `on_budget_exceeded: reject        # reject = 402;downgrade = 改走 cheap 组` 超了怎么办,租户自己的配置。
- `allowed_groups: [smart, cheap]` 销售租户只能用这两个组,所以它调 `fast` 会得到 403。
- `monthly_budget_cny: 0.005` 销售租户预算只有半分钱,为了一次调用就超。
- `on_budget_exceeded: downgrade` 超了降级。

</div>

然后是假上游。它就是一个只绑 `127.0.0.1` 的小 FastAPI 应用,四种脾气,还会记自己被敲了几次:

```python
# agent-zero-lab/part10/gateway/fake_upstream.py
"""本机假上游,只绑 127.0.0.1:8590。四种脾气:/ok 正常、/limited 回 429、/broken 回 500、/bad 回 400。
每种被调用了几次记在 /calls 里,用来证明「熔断后根本没去敲它」。
用法:uv run uvicorn part10.gateway.fake_upstream:app --host 127.0.0.1 --port 8590
"""
from collections import Counter

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()
calls: Counter[str] = Counter()


def completion(model: str) -> dict:
    return {
        "id": "fake-1", "object": "chat.completion", "created": 0, "model": model,
        "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "(假上游)好的"}}],
        "usage": {"prompt_tokens": 1000, "completion_tokens": 100, "total_tokens": 1100, "prompt_cache_hit_tokens": 600},
    }


@app.post("/{mode}/chat/completions")
async def chat(mode: str, request: Request) -> JSONResponse:
    calls[mode] += 1
    body = await request.json()
    if mode == "limited":
        return JSONResponse({"error": {"message": "rate limited"}}, status_code=429, headers={"Retry-After": "5"})
    if mode == "broken":
        return JSONResponse({"error": {"message": "upstream exploded"}}, status_code=500)
    if mode == "bad":
        return JSONResponse({"error": {"message": "max_tokens must be positive"}}, status_code=400)
    return JSONResponse(completion(body.get("model", "fake")))


@app.get("/calls")
async def get_calls() -> dict[str, int]:
    return dict(calls)
```

<div class="line-notes">

- `calls: Counter[str] = Counter()` 记每种脾气被调用了几次。`Counter` 是 Python 标准库里的计数字典,不存在的键默认是 0,相当于 JS 里 `counts[k] = (counts[k] ?? 0) + 1` 的简写。
- `"usage": {"prompt_tokens": 1000, "completion_tokens": 100, "total_tokens": 1100, "prompt_cache_hit_tokens": 600},` 固定的用量:输入 1000 其中 600 命中缓存,输出 100。这样算钱的结果是确定的,后面测试里的 0.001624 就是从这来的。
- `@app.post("/{mode}/chat/completions")` 路径里的 `{mode}` 是 FastAPI 的路径参数,`/ok/...`、`/limited/...` 分别走不同的分支。
- `calls[mode] += 1` 每次被敲就加一。
- `return JSONResponse({"error": {"message": "rate limited"}}, status_code=429, headers={"Retry-After": "5"})` 永远回 429,并带上 `Retry-After`。
- `return JSONResponse(completion(body.get("model", "fake")))` 正常模式:把请求里的 model 名放进响应,返回固定用量。
- `@app.get("/calls")` 查看每种脾气被敲了几次,证明熔断真的生效。

</div>

账本在 Day 586 是内存里的一个列表,今天换成 SQLite 里的一张表。SQLite 是一个只有一个文件的数据库,Python 标准库自带,够演示,也够你在本机分析:

```python
# agent-zero-lab/part10/gateway/ledger.py
"""账本:每次成功的模型调用记一行。SQLite 够演示,也够你在本机分析。
金额一律用「元」,价格表版本跟着每一行走。
用法(只自检):uv run python part10/gateway/ledger.py
"""
import sqlite3
import time
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY,
  ts REAL NOT NULL,
  month TEXT NOT NULL,
  tenant TEXT NOT NULL,
  project TEXT,
  agent TEXT,
  run_id TEXT,
  model_group TEXT NOT NULL,
  deployment TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  cached_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_cny REAL NOT NULL,
  price_version TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_tenant_month ON usage(tenant, month);
"""


def month_of(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m")


class Ledger:
    def __init__(self, path: str = ":memory:") -> None:
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.executescript(SCHEMA)

    def record(self, *, tenant: str, project: str | None, agent: str | None, run_id: str | None, model_group: str,
               deployment: str, attempts: int, input_tokens: int, cached_tokens: int, output_tokens: int,
               cost_cny: float, price_version: str) -> None:
        ts = time.time()
        self.db.execute(
            "INSERT INTO usage (ts, month, tenant, project, agent, run_id, model_group, deployment, attempts,"
            " input_tokens, cached_tokens, output_tokens, cost_cny, price_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (ts, month_of(ts), tenant, project, agent, run_id, model_group, deployment, attempts,
             input_tokens, cached_tokens, output_tokens, cost_cny, price_version))
        self.db.commit()

    def month_spend(self, tenant: str) -> float:
        row = self.db.execute("SELECT COALESCE(SUM(cost_cny), 0) FROM usage WHERE tenant=? AND month=?",
                              (tenant, month_of(time.time()))).fetchone()
        return float(row[0])

    def breakdown(self, tenant: str) -> list[tuple]:
        """按 项目 / Agent / 实际部署 汇总,给 showback 用。"""
        return self.db.execute(
            "SELECT project, agent, deployment, COUNT(*), SUM(input_tokens), SUM(output_tokens), ROUND(SUM(cost_cny), 6)"
            " FROM usage WHERE tenant=? GROUP BY project, agent, deployment ORDER BY 7 DESC", (tenant,)).fetchall()

    def total_by_deployment(self) -> dict[str, float]:
        rows = self.db.execute("SELECT deployment, SUM(cost_cny) FROM usage GROUP BY deployment").fetchall()
        return {d: float(c) for d, c in rows}


if __name__ == "__main__":
    led = Ledger()
    led.record(tenant="support", project="refund", agent="triage", run_id="r1", model_group="fast", deployment="flash",
               attempts=1, input_tokens=1000, cached_tokens=600, output_tokens=100, cost_cny=0.001624, price_version="t")
    print(led.month_spend("support"), led.breakdown("support"))
```

<div class="line-notes">

- `month TEXT NOT NULL,` 月份单独存一列(如 `2026-10`),按月累计预算时直接 `WHERE month=?`,不用每次算时间范围。
- `attempts INTEGER NOT NULL,` 这一单试了几个部署才成功。`attempts=2` 说明发生了降级,事后分析哪个供应商不稳定要用。
- `cost_cny REAL NOT NULL,` 金额,单位元。
- `price_version TEXT NOT NULL` 用的是哪一版价格表。
- `CREATE INDEX IF NOT EXISTS idx_usage_tenant_month ON usage(tenant, month);` 查「某租户本月花了多少」是每个请求都要做的事,给 (tenant, month) 建索引。
- `self.db = sqlite3.connect(path, check_same_thread=False)` FastAPI 会在不同线程里处理请求,SQLite 默认不允许跨线程用同一个连接,这里关掉这个检查。演示够用;生产里应该每个线程一个连接,或者直接用 Postgres。
- `def record(self, *, tenant: str,` 参数前面的 `*` 表示后面的参数必须写名字(`record(tenant="support", ...)`),不能靠位置传。字段这么多,靠位置传一定会传错顺序。
- `row = self.db.execute("SELECT COALESCE(SUM(cost_cny), 0) FROM usage WHERE tenant=? AND month=?",` `COALESCE(x, 0)` 的意思是「x 是空就当 0」:这个租户本月一行账都没有时,`SUM` 返回空,要当成 0。
- `"SELECT project, agent, deployment, COUNT(*), SUM(input_tokens), SUM(output_tokens), ROUND(SUM(cost_cny), 6)"` showback 的核心查询:按项目、Agent、实际部署分组,数次数、加 token、加金额。

</div>

```bash
uv run python part10/gateway/ledger.py
```

```text
0.001624 [('refund', 'triage', 'flash', 1, 1000, 100, 0.001624)]
```

自检只有一行:这个租户本月累计 0.001624 元,按项目、Agent、部署分组后是 1 次调用、输入 1000、输出 100。这 0.001624 是手填进去的数,算式是 (1000 − 600) × 2 + 600 × 0.04 + 100 × 8 = 800 + 24 + 800 = 1624,再除以 1,000,000。后面测试里会用同一个数,看网关自己算出来的是不是这个值。

接下来是网关本体。它的骨架和 Day 586 的 `passthrough.py` 是同一个:一个 FastAPI 应用,一个 `/v1/chat/completions`。区别是多了 `create_app` 这个工厂函数,它接收配置、账本,以及一个可选的 `client_factory`。生产里不传,用真的 httpx 客户端;测试里传一个用 `MockTransport` 的假客户端,这样不花钱就能测故障切换。

```python
# agent-zero-lab/part10/gateway/gateway_v2.py
"""Day 588 的最小网关:在 Day 586 的透传网关上加 预算、token 限流(预扣+结算)、路由降级、熔断、成本归因。
只支持非流式。上游用 httpx 调,测试时换成假传输层,不花钱就能测故障切换。
用法:uv run uvicorn part10.gateway.main_v2:app --host 127.0.0.1 --port 8586
uv add fastapi uvicorn httpx pyyaml
"""
import hashlib
import json
import os
import string
import time
from dataclasses import dataclass
from typing import Any, Callable

import httpx
import yaml
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from .breaker import CircuitBreaker
from .ledger import Ledger
from .token_bucket import TokenBucket

DEFAULT_MAX_TOKENS = 512          # 调用方没写 max_tokens:网关替他定一个,否则预扣没有上限
MAX_ALLOWED_MAX_TOKENS = 4096     # 写太大的直接拒绝


@dataclass
class Deployment:
    name: str
    base_url: str
    api_key: str
    model: str
    price: dict[str, float]


@dataclass
class Tenant:
    name: str
    allowed_groups: list[str]
    bucket: TokenBucket
    budget_cny: float
    on_exceeded: str


class Retryable(Exception):
    """换个地方可能就好了的错误:429、5xx、超时、连不上。"""


def load_config(path: str) -> dict[str, Any]:
    raw = string.Template(open(path, encoding="utf-8").read()).safe_substitute(os.environ)
    return yaml.safe_load(raw)


def estimate_input(messages: list[dict[str, Any]]) -> int:
    text = json.dumps(messages, ensure_ascii=False)
    cjk = sum(1 for ch in text if "一" <= ch <= "鿿")
    return round(cjk / 1.7 + (len(text) - cjk) / 3.0)         # Day 586 练习 1 的估算


def cost_of(usage: dict[str, Any], price: dict[str, float]) -> tuple[int, int, int, float]:
    inp, out = int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0))
    cached = int(usage.get("prompt_cache_hit_tokens") or (usage.get("prompt_tokens_details") or {}).get("cached_tokens") or 0)
    cny = ((inp - cached) * price["miss"] + cached * price["hit"] + out * price["out"]) / 1e6
    return inp, cached, out, cny


def create_app(config: dict[str, Any], ledger: Ledger, client_factory: Callable[[], httpx.AsyncClient] | None = None,
               clock: Callable[[], float] = time.monotonic) -> FastAPI:
    deployments = {n: Deployment(n, d["base_url"].rstrip("/"), os.environ.get(d["api_key_env"], "fake-key"), d["model"], d["price"])
                   for n, d in config["deployments"].items()}
    breakers = {n: CircuitBreaker(threshold=3, cooldown=30, clock=clock) for n in deployments}
    tenants = {hashlib.sha256(t["virtual_key"].encode()).hexdigest():
               Tenant(name, t["allowed_groups"], TokenBucket(capacity=t["tpm"], rate=t["tpm"] / 60, clock=clock),
                      t["monthly_budget_cny"], t.get("on_budget_exceeded", "reject"))
               for name, t in config["tenants"].items()}
    http = client_factory() if client_factory else httpx.AsyncClient(timeout=30)
    app = FastAPI()

    async def call_upstream(dep: Deployment, body: dict[str, Any]) -> dict[str, Any]:
        try:
            r = await http.post(f"{dep.base_url}/chat/completions", json={**body, "model": dep.model},
                                headers={"Authorization": f"Bearer {dep.api_key}"})
        except (httpx.TimeoutException, httpx.TransportError) as e:
            raise Retryable(type(e).__name__) from e
        if r.status_code == 429 or r.status_code >= 500:
            raise Retryable(f"HTTP {r.status_code}")
        if r.status_code >= 400:                                   # 400/401/403 换谁都一样错,原样还给调用方
            raise HTTPException(r.status_code, f"{dep.name}: {r.text[:200]}")
        return r.json()

    @app.post("/v1/chat/completions")
    async def chat(request: Request, authorization: str = Header(""), x_project: str | None = Header(None),
                   x_agent: str | None = Header(None), x_run_id: str | None = Header(None)) -> JSONResponse:
        # 1 鉴权
        tenant = tenants.get(hashlib.sha256(authorization.removeprefix("Bearer ").strip().encode()).hexdigest())
        if tenant is None:
            raise HTTPException(401, "unknown virtual key")
        body = await request.json()
        if body.get("stream"):
            raise HTTPException(400, "this minimal gateway does not support stream")
        group = body.pop("model", "")
        if group not in tenant.allowed_groups or group not in config["model_groups"]:
            raise HTTPException(403, f"tenant {tenant.name} cannot use model group {group!r}")
        max_tokens = int(body.get("max_tokens") or DEFAULT_MAX_TOKENS)
        if max_tokens > MAX_ALLOWED_MAX_TOKENS:
            raise HTTPException(400, f"max_tokens {max_tokens} > {MAX_ALLOWED_MAX_TOKENS}")
        body["max_tokens"] = max_tokens

        # 2 预算:查「已经花的」,不含这一单,最多超一单
        extra: dict[str, str] = {}
        spent = ledger.month_spend(tenant.name)
        if spent >= tenant.budget_cny:
            if tenant.on_exceeded == "downgrade":
                extra["x-gateway-downgraded-from"] = group
                group = "cheap"
            else:
                raise HTTPException(402, f"monthly budget exhausted: spent {spent:.4f} of {tenant.budget_cny} CNY")
        elif spent >= 0.8 * tenant.budget_cny:
            extra["x-gateway-budget-warning"] = f"{spent / tenant.budget_cny:.0%} used"

        # 3 限流:预扣
        reserve = estimate_input(body.get("messages", [])) + max_tokens
        ok, wait = tenant.bucket.try_take(reserve)
        if not ok:
            retry = "60" if wait == float("inf") else str(int(wait) + 1)
            return JSONResponse({"error": "tenant token rate limit"}, status_code=429, headers={"Retry-After": retry})

        # 4 路由 + 降级 + 熔断
        errors: list[str] = []
        for attempt, name in enumerate(config["model_groups"][group], 1):
            dep, br = deployments[name], breakers[name]
            if not br.allow():
                errors.append(f"{name}: circuit open")
                continue
            try:
                data = await call_upstream(dep, body)
            except Retryable as e:
                br.record(False)
                errors.append(f"{name}: {e}")
                continue
            except HTTPException:
                tenant.bucket.give_back(reserve)
                raise
            br.record(True)
            # 5 结算 + 记账
            inp, cached, out, cny = cost_of(data.get("usage") or {}, dep.price)
            if inp + out <= reserve:
                tenant.bucket.give_back(reserve - (inp + out))
            else:
                tenant.bucket.take_anyway(inp + out - reserve)
            ledger.record(tenant=tenant.name, project=x_project, agent=x_agent, run_id=x_run_id, model_group=group,
                          deployment=name, attempts=attempt, input_tokens=inp, cached_tokens=cached, output_tokens=out,
                          cost_cny=cny, price_version=config["price_version"])
            return JSONResponse(data, headers={"x-gateway-deployment": name, "x-gateway-cost-cny": f"{cny:.6f}", **extra})
        tenant.bucket.give_back(reserve)
        raise HTTPException(503, "all deployments failed: " + "; ".join(errors))

    return app
```

<div class="line-notes">

- `from .breaker import CircuitBreaker` 前面带点的是相对导入:从同一个包里导入。所以这个文件要用 `uvicorn part10.gateway.main_v2:app` 或 pytest 来跑,不能 `python part10/gateway/gateway_v2.py` 直接跑。
- `DEFAULT_MAX_TOKENS = 512          # 调用方没写 max_tokens:网关替他定一个,否则预扣没有上限` Day 586 讲过,`max_tokens` 就是预扣单。业务方不写时,网关替他写 512。
- `MAX_ALLOWED_MAX_TOKENS = 4096     # 写太大的直接拒绝` 写 100,000 的会被 400 拦下,免得一个请求一次占满桶。
- `class Retryable(Exception):` 自己定义的一种异常,专门表示「换个地方可能就好了」。后面 `except Retryable` 才降级,别的异常(比如 400)不会被它接住。
- `cjk = sum(1 for ch in text if "一" <= ch <= "鿿")` Day 586 练习 1 的估算,数中文字符。
- `return round(cjk / 1.7 + (len(text) - cjk) / 3.0)         # Day 586 练习 1 的估算` 中文按 1.7 字符一个 token,其他按 3。代入 `[{"role": "user", "content": "退款"}]` 这个 messages:转成 JSON 字符串是 35 个字符,其中 2 个中文,2 ÷ 1.7 + 33 ÷ 3 ≈ 1.2 + 11 = 12.2,四舍五入得 12(实跑 `estimate_input` 返回 12)。
- `cached = int(usage.get("prompt_cache_hit_tokens") or (usage.get("prompt_tokens_details") or {}).get("cached_tokens") or 0)` 两种缓存字段都认。`a or b or 0` 取第一个非空的值,都没有就是 0。
- `cny = ((inp - cached) * price["miss"] + cached * price["hit"] + out * price["out"]) / 1e6` 金额公式:未命中的输入 × 未命中价 + 命中的输入 × 命中价 + 输出 × 输出价,价格单位是元每百万 token,所以除以 1e6。代入假上游的用量:(1000 − 600) × 2 + 600 × 0.04 + 100 × 8 = 1624,÷ 1e6 = 0.001624 元。
- `def create_app(config: dict[str, Any], ledger: Ledger, client_factory: Callable[[], httpx.AsyncClient] | None = None,` 工厂函数。`clock` 参数让熔断器和令牌桶都能用假时钟。
- `deployments = {n: Deployment(n, d["base_url"].rstrip("/"), os.environ.get(d["api_key_env"], "fake-key"), d["model"], d["price"])` 把配置里的每个部署变成对象,真 key 在这里才从环境变量取。假上游的 `FAKE_KEY` 不存在,就用字面值 `fake-key`,这个值没有任何意义。
- `breakers = {n: CircuitBreaker(threshold=3, cooldown=30, clock=clock) for n in deployments}` 每个部署一个熔断器。
- `tenants = {hashlib.sha256(t["virtual_key"].encode()).hexdigest():` 用虚拟 key 的 SHA-256 哈希当字典的键。之后来请求时,把 `Authorization` 里的 key 也算一遍哈希去查,进程内存里不再保留明文。
- `TokenBucket(capacity=t["tpm"], rate=t["tpm"] / 60, clock=clock),` 每个租户一个令牌桶,容量是每分钟 token 数,每秒补 tpm/60。就是 Day 586 的那个类,没改。
- `http = client_factory() if client_factory else httpx.AsyncClient(timeout=30)` 生产用真客户端,测试用假的。
- `async def call_upstream(dep: Deployment, body: dict[str, Any]) -> dict[str, Any]:` 调一个部署,返回响应体,出错时抛两种不同的异常。
- `r = await http.post(f"{dep.base_url}/chat/completions", json={**body, "model": dep.model},` 同一个请求体,把 `model` 换成这个部署的真实模型名。`{**body, "model": ...}` 是字典展开,相当于 JS 的 `{...body, model: dep.model}`。
- `except (httpx.TimeoutException, httpx.TransportError) as e:` 超时和连不上都算「换个地方可能就好了」。
- `if r.status_code == 429 or r.status_code >= 500:` 429 和 5xx 抛 `Retryable`,让外面降级。
- `if r.status_code >= 400:                                   # 400/401/403 换谁都一样错,原样还给调用方` 剩下的 4xx 抛 `HTTPException`,它不是 `Retryable`,外面的循环不会接住它。
- `async def chat(request: Request, authorization: str = Header(""), x_project: str | None = Header(None),` FastAPI 会把请求头 `X-Project` 自动匹配到参数 `x_project`(下划线对应横杠),没带就是 `None`。
- `tenant = tenants.get(hashlib.sha256(authorization.removeprefix("Bearer ").strip().encode()).hexdigest())` 第 1 步鉴权:去掉前缀、算哈希、查字典。查不到就是 `None`。
- `if body.get("stream"):` 不支持流式,明确拒绝,而不是悄悄变成非流式。
- `group = body.pop("model", "")` 业务方传的 `model` 其实是组名。`pop` 把它从请求体里取出来并删掉,因为后面会换成部署的真实模型名。
- `max_tokens = int(body.get("max_tokens") or DEFAULT_MAX_TOKENS)` 没写就用默认值。
- `spent = ledger.month_spend(tenant.name)` 第 2 步预算:查账本里这个租户本月花了多少。
- `if tenant.on_exceeded == "downgrade":` 超了而且这个租户配置的是降级:记下从哪个组降的,把 `group` 换成 `cheap`。
- `elif spent >= 0.8 * tenant.budget_cny:` 还没超但已经用了 80%:响应头里带一句提醒。
- `reserve = estimate_input(body.get("messages", [])) + max_tokens` 第 3 步限流:预扣额 = 估的输入 + `max_tokens`,和 Day 586 一样。
- `ok, wait = tenant.bucket.try_take(reserve)` 尝试从桶里拿。
- `retry = "60" if wait == float("inf") else str(int(wait) + 1)` 比整个桶还大的请求(等无穷久)给个 60 秒;其他的给「等待秒数向上取整」,放进 `Retry-After`。
- `for attempt, name in enumerate(config["model_groups"][group], 1):` 第 4 步路由:按组里的顺序逐个试,`attempt` 从 1 开始数,记账时写进 `attempts` 列。
- `if not br.allow():` 熔断器说不行,直接跳过这个部署,连请求都不发。
- `except Retryable as e:` 可以换地方的错误:记一次失败,把原因存起来,继续试下一个。
- `except HTTPException:` 400 之类的错误:先把预扣的额度还回去,再把错误抛给调用方。不还的话,每个被 400 拒绝的请求都会白占一份额度。
- `br.record(True)` 成功了,熔断器清零。
- `if inp + out <= reserve:` 第 5 步结算:实际用量比预扣少就还差额,否则补扣(桶里余额可以变负)。
- `ledger.record(tenant=tenant.name, project=x_project, agent=x_agent, run_id=x_run_id, model_group=group,` 记一行账:注意 `model_group=group` 记的是**实际**走的组(降级之后是 `cheap`),`deployment=name` 是实际部署。
- `return JSONResponse(data, headers={"x-gateway-deployment": name, "x-gateway-cost-cny": f"{cny:.6f}", **extra})` 把供应商响应原样还给业务方,并在头里告诉他实际部署和这一单的金额。
- `raise HTTPException(503, "all deployments failed: " + "; ".join(errors))` 组里每个部署都试过了(或被熔断跳过了),还给调用方 503,带上每个部署的失败原因,值班的人看到就知道从哪查。

</div>

注意 `tenant.bucket.give_back(reserve)` 这一行在 503 之前:组里全挂了的请求,预扣的额度也要还回去,不然上游一出故障,租户的额度就被一堆失败的请求占光,故障恢复后还会被误判成 429。这是练习 3。

最后是启动入口,几行而已:

```python
# agent-zero-lab/part10/gateway/main_v2.py
"""启动入口:读 config.yaml,账本放在 gateway_usage.db。
用法:uv run uvicorn part10.gateway.main_v2:app --host 127.0.0.1 --port 8586
"""
import os

from dotenv import load_dotenv

from .gateway_v2 import create_app, load_config
from .ledger import Ledger

load_dotenv()
HERE = os.path.dirname(__file__)
app = create_app(load_config(os.path.join(HERE, "config.yaml")), Ledger(os.environ.get("LEDGER_PATH", "gateway_usage.db")))
```

<div class="line-notes">

- `load_dotenv()` 把 `.env` 里的变量读进环境,这样 `config.yaml` 里的 `${LLM_BASE_URL}` 才有值。
- `HERE = os.path.dirname(__file__)` 这个文件所在的目录,用它拼出 `config.yaml` 的路径,不管你在哪个目录启动都找得到。
- `app = create_app(load_config(os.path.join(HERE, "config.yaml")), Ledger(os.environ.get("LEDGER_PATH", "gateway_usage.db")))` 账本文件默认叫 `gateway_usage.db`(在你启动命令所在的目录),可以用环境变量 `LEDGER_PATH` 换位置。

</div>

## 先写测试,不花钱就能测故障切换

网关里的每一条分支(降级、熔断、预算、限流)都是「出了事才走」的路径,平时手动点不到,所以测试比功能代码更值钱。测试里不联网,上游是 `httpx.MockTransport`:你给它一个函数,每个出去的请求都会被这个函数接住,由你决定返回什么。

```python
# agent-zero-lab/part10/gateway/test_gateway.py
"""网关测试:上游全部是假的(httpx.MockTransport),不花一分钱,也不需要网络。
用法:uv run pytest -q part10/gateway/test_gateway.py
"""
from typing import Any

import httpx
from fastapi.testclient import TestClient

from .gateway_v2 import create_app
from .ledger import Ledger

PRICE = {"hit": 0.04, "miss": 2.0, "out": 8.0}
KEY_A, KEY_B = "vk-test-a", "vk-test-b"


def make_config(tpm: int = 400_000, budget: float = 300.0, on_exceeded: str = "reject") -> dict[str, Any]:
    dep = lambda host: {"base_url": f"http://{host}.invalid/v1", "api_key_env": "NOPE", "model": f"m-{host}", "price": PRICE}
    return {
        "price_version": "test",
        "deployments": {"primary": dep("primary"), "backup": dep("backup"), "cheap": dep("cheap")},
        "model_groups": {"fast": ["primary", "backup"], "cheap": ["cheap"]},
        "tenants": {
            "a": {"virtual_key": KEY_A, "allowed_groups": ["fast", "cheap"], "tpm": tpm, "monthly_budget_cny": budget, "on_budget_exceeded": on_exceeded},
            "b": {"virtual_key": KEY_B, "allowed_groups": [], "tpm": tpm, "monthly_budget_cny": budget},
        },
    }


def completion(model: str) -> dict[str, Any]:
    return {"id": "c", "object": "chat.completion", "created": 0, "model": model,
            "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "好的"}}],
            "usage": {"prompt_tokens": 1000, "completion_tokens": 100, "prompt_cache_hit_tokens": 600}}


def fake_upstream(primary_status: int = 200) -> tuple[list[str], Any]:
    seen: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req.url.host)
        if req.url.host == "primary.invalid" and primary_status != 200:
            return httpx.Response(primary_status, json={"error": {"message": "boom"}})
        return httpx.Response(200, json=completion(req.url.host))

    return seen, (lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def post(client: TestClient, key: str = KEY_A, model: str = "fast", **extra: Any) -> Any:
    body = {"model": model, "max_tokens": 200, "messages": [{"role": "user", "content": "退款"}], **extra}
    return client.post("/v1/chat/completions", headers={"Authorization": f"Bearer {key}", "X-Project": "refund", "X-Agent": "triage"}, json=body)


def test_happy_path_records_cost() -> None:
    ledger = Ledger()
    seen, factory = fake_upstream()
    r = post(TestClient(create_app(make_config(), ledger, factory)))
    assert r.status_code == 200 and r.headers["x-gateway-deployment"] == "primary"
    # (1000-600)*2 + 600*0.04 + 100*8 = 800 + 24 + 800 = 1624 -> 除以 1e6 = 0.001624 元
    assert abs(ledger.month_spend("a") - 0.001624) < 1e-9
    assert ledger.breakdown("a")[0][:3] == ("refund", "triage", "primary")


def test_fallback_on_429_and_5xx() -> None:
    for status in (429, 500):
        seen, factory = fake_upstream(status)
        r = post(TestClient(create_app(make_config(), Ledger(), factory)))
        assert r.status_code == 200 and r.headers["x-gateway-deployment"] == "backup"
        assert seen == ["primary.invalid", "backup.invalid"]


def test_bad_request_is_not_retried() -> None:
    seen, factory = fake_upstream(400)
    assert post(TestClient(create_app(make_config(), Ledger(), factory))).status_code == 400
    assert seen == ["primary.invalid"]


def test_breaker_opens_then_half_opens() -> None:
    now = [0.0]
    seen, factory = fake_upstream(500)
    client = TestClient(create_app(make_config(), Ledger(), factory, clock=lambda: now[0]))
    for _ in range(3):
        post(client)                                  # 连续 3 次:primary 都失败了,熔断打开
    seen.clear()
    post(client)
    assert seen == ["backup.invalid"]                 # 第 4 次根本没去敲 primary
    now[0] = 31
    post(client)
    assert seen == ["backup.invalid", "primary.invalid", "backup.invalid"]   # 冷却后放一个去试探


def test_auth_group_and_max_tokens() -> None:
    _, factory = fake_upstream()
    client = TestClient(create_app(make_config(), Ledger(), factory))
    assert post(client, key="vk-nobody").status_code == 401
    assert post(client, key=KEY_B).status_code == 403
    assert post(client, max_tokens=100_000).status_code == 400
    assert post(client, stream=True).status_code == 400


def test_token_rate_limit_with_retry_after() -> None:
    _, factory = fake_upstream()
    client = TestClient(create_app(make_config(tpm=400), Ledger(), factory))
    assert post(client).status_code == 200            # 预扣约 200 多,桶 400,过;实际 1100,桶欠账
    r = post(client)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1


def test_budget_reject_and_downgrade() -> None:
    _, factory = fake_upstream()
    client = TestClient(create_app(make_config(budget=0.001), Ledger(), factory))
    assert post(client).status_code == 200            # 这一单 0.001624 元,超了 0.001
    assert post(client).status_code == 402
    client = TestClient(create_app(make_config(budget=0.001, on_exceeded="downgrade"), Ledger(), factory))
    post(client)
    r = post(client)
    assert r.status_code == 200 and r.headers["x-gateway-deployment"] == "cheap"
    assert r.headers["x-gateway-downgraded-from"] == "fast"


def test_all_down_gives_503_with_reasons() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={})
    cfg = make_config()
    cfg["model_groups"]["fast"] = ["primary", "backup"]
    client = TestClient(create_app(cfg, Ledger(), lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))))
    r = post(client)
    assert r.status_code == 503 and "primary: HTTP 500" in r.json()["detail"] and "backup: HTTP 500" in r.json()["detail"]
```

<div class="line-notes">

- `PRICE = {"hit": 0.04, "miss": 2.0, "out": 8.0}` 测试里用的价格,和配置里的 flash 一样。
- `dep = lambda host: {"base_url": f"http://{host}.invalid/v1", "api_key_env": "NOPE", "model": f"m-{host}", "price": PRICE}` 造一个部署配置的小函数。`.invalid` 是专门保留给「保证不存在」的域名后缀,就算 MockTransport 没拦住也不会真的发出去。
- `"model_groups": {"fast": ["primary", "backup"], "cheap": ["cheap"]},` 测试里的两个组:`fast` 有主备,`cheap` 只有一个。
- `"b": {"virtual_key": KEY_B, "allowed_groups": [], "tpm": tpm, "monthly_budget_cny": budget},` 租户 b 不允许用任何组,用来测 403。
- `"usage": {"prompt_tokens": 1000, "completion_tokens": 100, "prompt_cache_hit_tokens": 600}}` 固定的用量,算出来的金额是确定的 0.001624。
- `def fake_upstream(primary_status: int = 200) -> tuple[list[str], Any]:` 返回两样东西:一个列表,记录每次请求发到了哪个主机;一个工厂函数,给 `create_app` 用。
- `seen.append(req.url.host)` 每个出去的请求把主机名记下来,测试里用它断言「到底敲了谁、敲了几次」。
- `if req.url.host == "primary.invalid" and primary_status != 200:` 主用部署按指定的状态码失败,备用部署永远正常。
- `return seen, (lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))` 工厂函数每次调用返回一个用假传输层的客户端。
- `assert abs(ledger.month_spend("a") - 0.001624) < 1e-9` 金额是浮点数,不能用 `==` 比,要比「差得足够小」。
- `assert ledger.breakdown("a")[0][:3] == ("refund", "triage", "primary")` 账里的项目、Agent、部署分别是请求头里带的 `X-Project`、`X-Agent` 和实际走的主用部署。
- `for status in (429, 500):` 同一个测试跑两种失败,断言一样:都降级到备用。
- `assert seen == ["primary.invalid", "backup.invalid"]` 按顺序敲了主用,再敲了备用。
- `assert seen == ["primary.invalid"]` 400 不降级:只敲了主用,备用一次都没敲。
- `post(client)                                  # 连续 3 次:primary 都失败了,熔断打开` 前三次请求每次都先敲 primary 失败、再用 backup,primary 的连续失败到了 3。
- `assert seen == ["backup.invalid"]                 # 第 4 次根本没去敲 primary` 熔断打开后,第 4 次请求只敲了 backup。
- `now[0] = 31` 假时钟拨到 31 秒,过了冷却时间(30 秒)。
- `assert seen == ["backup.invalid", "primary.invalid", "backup.invalid"]   # 冷却后放一个去试探` 前面那个 `backup.invalid` 是上一次请求留下的,接着是试探的 `primary.invalid`(又失败了),然后降级到 `backup.invalid`。
- `assert post(client, max_tokens=100_000).status_code == 400` 写太大的 `max_tokens` 被拒。
- `client = TestClient(create_app(make_config(tpm=400), Ledger(), factory))` 桶只有 400,第一个请求预扣约 200 能过,实际用了 1100,桶欠账 700 左右;第二个请求就要等。
- `assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1` 429 必须带 `Retry-After`,而且至少 1 秒。
- `assert post(client).status_code == 200            # 这一单 0.001624 元,超了 0.001` 预算 0.001,第一单花了 0.001624,已经超了。
- `assert post(client).status_code == 402` 第二单被拒。
- `assert r.status_code == 200 and r.headers["x-gateway-deployment"] == "cheap"` 换成降级配置后,第二单走了 `cheap` 组的部署。
- `assert r.status_code == 503 and "primary: HTTP 500" in r.json()["detail"] and "backup: HTTP 500" in r.json()["detail"]` 全挂时 503,而且错误信息里两个部署的失败原因都在。

</div>

```bash
uv run pytest -v part10/gateway/test_gateway.py
```

输出里只留结果行:

```text
test_gateway.py::test_happy_path_records_cost PASSED
test_gateway.py::test_fallback_on_429_and_5xx PASSED
test_gateway.py::test_bad_request_is_not_retried PASSED
test_gateway.py::test_breaker_opens_then_half_opens PASSED
test_gateway.py::test_auth_group_and_max_tokens PASSED
test_gateway.py::test_token_rate_limit_with_retry_after PASSED
test_gateway.py::test_budget_reject_and_downgrade PASSED
test_gateway.py::test_all_down_gives_503_with_reasons PASSED
============================== 8 passed in 0.50s ===============================
```

8 个测试全绿。但绿的测试可能是假的:它真的在检查我们以为的东西吗?我的习惯是故意改坏一处,看对应的测试是不是变红。比如把 `call_upstream` 里的 `r.status_code >= 500` 改成 `>= 400`(让 400 也被当成可以降级的错误),再跑:

```text
..F.....                                                                 [100%]
_______________________ test_bad_request_is_not_retried ________________________
    def test_bad_request_is_not_retried() -> None:
>       assert post(TestClient(create_app(make_config(), Ledger(), factory))).status_code == 400
E       AssertionError: assert 200 == 400
part10/gateway/test_gateway.py:73: AssertionError
FAILED part10/gateway/test_gateway.py::test_bad_request_is_not_retried - Asse...
1 failed, 7 passed in 0.60s
```

`test_bad_request_is_not_retried` 变红了,而且别的七个都没红。红的原因读得出来:本来应该回 400,现在备用部署成功了,回了 200,说明 400 被错误地当成了「可以换一家」。改回去再跑,又是 8 个全绿。**能被改坏的地方测试都能抓到,这个测试才算数。**

## 接上真上游跑一遍

测试验证了逻辑,但我们还没见过它真的转起来。开三个终端,都在 `agent-zero-lab` 目录下。终端 1 起假上游(只绑 127.0.0.1):

```bash
uv run uvicorn part10.gateway.fake_upstream:app --host 127.0.0.1 --port 8590
```

终端 2 起网关,账本放在 `gateway_demo.db`:

```bash
LEDGER_PATH=gateway_demo.db uv run uvicorn part10.gateway.main_v2:app --host 127.0.0.1 --port 8586
```

终端 3 跑业务方的脚本,它依次发五组请求,最后把账本读出来:

```python
# agent-zero-lab/part10/gateway/try_gateway_v2.py
"""业务方视角的端到端演示:先起 fake_upstream.py(8590)和 main_v2 网关(8586),再跑这个。
真上游只有 deepseek-flash,「贵模型」pro-fake 是本机假上游。
用法:uv run python part10/gateway/try_gateway_v2.py
"""
import json
import os
import sqlite3

import httpx
from dotenv import load_dotenv
from openai import APIStatusError, OpenAI

load_dotenv()
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))


def ask(vkey: str, group: str, project: str, agent: str, run_id: str) -> None:
    client = OpenAI(base_url="http://127.0.0.1:8586/v1", api_key=vkey, max_retries=0)
    try:
        raw = client.chat.completions.with_raw_response.create(
            model=group, max_tokens=20, extra_body=EXTRA, messages=[{"role": "user", "content": "用一句话说:什么是退款?"}],
            extra_headers={"X-Project": project, "X-Agent": agent, "X-Run-Id": run_id})
    except APIStatusError as e:
        print(f"{group:<8} → HTTP {e.status_code} {e.message[:70]}")
        return
    h = raw.headers
    extra = {k: v for k, v in h.items() if k.startswith("x-gateway") and k not in ("x-gateway-deployment", "x-gateway-cost-cny")}
    print(f"{group:<8} → 实际走了 {h['x-gateway-deployment']:<10} 花费 {h['x-gateway-cost-cny']} 元 {extra or ''}")


print("1. support 走 fast(只有真 flash)")
ask("vk-support-001", "fast", "refund", "triage", "run-1")
print("2. support 走 fast-ha:主用 flaky-fake 永远 429,备用是真 flash,连发 5 次")
for i in range(5):
    ask("vk-support-001", "fast-ha", "refund", "triage", f"run-ha-{i}")
print("   假上游被敲了几次:", httpx.get("http://127.0.0.1:8590/calls").json())
print("3. support 走 smart(假的贵模型)")
ask("vk-support-001", "smart", "refund", "writer", "run-smart")
print("4. sales 预算只有 0.005 元:先用 smart(假贵模型),再发一次")
ask("vk-sales-002", "smart", "lead", "scorer", "run-s1")
ask("vk-sales-002", "smart", "lead", "scorer", "run-s2")
print("5. 不允许的组 / 乱猜的 key")
ask("vk-support-001", "cheap", "refund", "triage", "x")
ask("vk-guess", "fast", "x", "x", "x")

print("\n账本(showback):租户 / 项目 / Agent / 实际部署 / 次数 / 输入 / 输出 / 元")
db = sqlite3.connect(os.environ["LEDGER_PATH"])
for row in db.execute("SELECT tenant, project, agent, deployment, COUNT(*), SUM(input_tokens), SUM(output_tokens), ROUND(SUM(cost_cny), 6)"
                      " FROM usage GROUP BY 1,2,3,4 ORDER BY 1,2,3,4"):
    print(" ", row)
print("每月合计:", db.execute("SELECT tenant, ROUND(SUM(cost_cny), 6) FROM usage GROUP BY tenant").fetchall())
```

<div class="line-notes">

- `EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` `.env` 里 `{"thinking": {"type": "disabled"}}`,不让模型开思考,输出才短。
- `client = OpenAI(base_url="http://127.0.0.1:8586/v1", api_key=vkey, max_retries=0)` 业务方的视角:`base_url` 是网关,`api_key` 是虚拟 key。`max_retries=0` 关掉 SDK 自带的重试,否则网关回 429 时 SDK 会自己再发,我们就看不清网关的行为了。
- `raw = client.chat.completions.with_raw_response.create(` `with_raw_response` 让 SDK 把原始的 HTTP 响应也交给我们,这样才读得到 `x-gateway-*` 这些响应头。
- `extra_headers={"X-Project": project, "X-Agent": agent, "X-Run-Id": run_id})` 成本归因的维度,通过请求头带进去,业务代码只多这一行。
- `except APIStatusError as e:` 网关回 4xx/5xx 时,SDK 抛这个异常,`e.status_code` 就是网关回的状态码。
- `extra = {k: v for k, v in h.items() if k.startswith("x-gateway") and k not in ("x-gateway-deployment", "x-gateway-cost-cny")}` 把除了部署和金额之外的 `x-gateway-*` 头挑出来(比如降级提示、预算提醒),有就打印。
- `for i in range(5):` 对 `fast-ha` 连发 5 次,看熔断器什么时候起作用。
- `print("   假上游被敲了几次:", httpx.get("http://127.0.0.1:8590/calls").json())` 直接问假上游自己被敲了几次,这是熔断「真的没去敲」的证据。
- `db = sqlite3.connect(os.environ["LEDGER_PATH"])` 直接读网关写的账本文件。所以这个脚本也要带上同样的 `LEDGER_PATH`。

</div>

```bash
LEDGER_PATH=gateway_demo.db uv run python part10/gateway/try_gateway_v2.py
```

我的输出:

```text
1. support 走 fast(只有真 flash)
fast     → 实际走了 flash      花费 0.000182 元 
2. support 走 fast-ha:主用 flaky-fake 永远 429,备用是真 flash,连发 5 次
fast-ha  → 实际走了 flash      花费 0.000118 元 
fast-ha  → 实际走了 flash      花费 0.000118 元 
fast-ha  → 实际走了 flash      花费 0.000182 元 
fast-ha  → 实际走了 flash      花费 0.000182 元 
fast-ha  → 实际走了 flash      花费 0.000118 元 
   假上游被敲了几次: {'limited': 3}
3. support 走 smart(假的贵模型)
smart    → 实际走了 pro-fake   花费 0.009840 元 
4. sales 预算只有 0.005 元:先用 smart(假贵模型),再发一次
smart    → 实际走了 pro-fake   花费 0.009840 元 
smart    → 实际走了 flash      花费 0.000182 元 {'x-gateway-downgraded-from': 'smart'}
5. 不允许的组 / 乱猜的 key
cheap    → HTTP 403 Error code: 403
fast     → HTTP 401 Error code: 401

账本(showback):租户 / 项目 / Agent / 实际部署 / 次数 / 输入 / 输出 / 元
  ('sales', 'lead', 'scorer', 'flash', 1, 11, 20, 0.000182)
  ('sales', 'lead', 'scorer', 'pro-fake', 1, 1000, 100, 0.00984)
  ('support', 'refund', 'triage', 'flash', 6, 66, 96, 0.0009)
  ('support', 'refund', 'writer', 'pro-fake', 1, 1000, 100, 0.00984)
每月合计: [('sales', 0.010022), ('support', 0.01074)]
```

一块一块看。

**第 1 组**,`fast` 只有一个部署,走真 flash,花了 0.000182 元(输入 11、输出 20:11 × 2 + 20 × 8 = 182,÷ 1e6)。

**第 2 组**,`fast-ha` 主用 `flaky-fake` 永远 429,连发 5 次,每次都落到了 flash。关键是下面那一行:假上游被敲了 `{'limited': 3}`,也就是 5 个请求里只有前 3 个去敲了它,后 2 个因为熔断器已经断开,根本没去。这就是熔断的价值:第 4、5 个请求省掉了一次必败的请求和它的等待。花费不同(0.000118 和 0.000182)是因为模型每次回答的长短不同,输出 12 个 token 和 20 个 token 差出来的,和网关无关。

**第 3 组**,`smart` 走假的贵模型,花费 0.00984 元,我们编的价格算出来的:400 × 12 + 600 × 0.4 + 100 × 48 = 4800 + 240 + 4800 = 9840,÷ 1e6。

**第 4 组**,销售租户预算 0.005 元。第一次调用时账本里没有这个租户的账,检查通过,走了假的贵模型,花了 0.00984,已经超了。第二次调用同样请求 `smart`,网关发现超预算,而销售租户配置的是降级,于是改走 `cheap` 组,实际部署是 flash,响应头里带着 `x-gateway-downgraded-from: smart`,业务方收到了正常回答,但网关留下了记录。

**第 5 组**,客服租户请求 `cheap` 组,它的 `allowed_groups` 里没有,403;`vk-guess` 是乱编的 key,401。

最后是账本。四行就是 showback 的雏形:销售的 `lead` 项目、`scorer` 这个 Agent,一次在 `pro-fake` 花了 0.00984,一次在 flash 花了 0.000182;客服的 `refund` 项目,`triage` 这个 Agent 在 flash 上 6 次共 0.0009 元,`writer` 在 `pro-fake` 上 1 次 0.00984 元。注意账里记的是实际部署,销售那次降级的账记在了 flash 上,和供应商账单对得上。

## 月底对账

上面的账本是网关自己的账。对账就是拿它和供应商账单比。我没有真的发票可比,所以下面用的是手写的「假账单」:场景 A 是账本乘 1.01,场景 B 是在 flash 的账本上硬加 0.0004,场景 C 是把账本重算一遍但故意漏掉缓存命中字段。这三个数字都是我设的,目的是看差额怎么暴露问题。

```python
# agent-zero-lab/part10/gateway/reconcile.py
"""月底对账:网关账本 vs 供应商账单。差额在 2% 以内正常,超了就查。
供应商账单这里是「假账单」(手写的数字,不是真发票),重点是看差额怎么暴露问题。
用法:LEDGER_PATH=led_demo.db uv run python part10/gateway/reconcile.py
"""
import os
import sqlite3

THRESHOLD = 0.02


def ledger_totals(db: sqlite3.Connection) -> dict[str, float]:
    return {d: float(c) for d, c in db.execute("SELECT deployment, SUM(cost_cny) FROM usage GROUP BY deployment")}


def check(ledger: dict[str, float], bill: dict[str, float]) -> None:
    for dep in sorted(bill):
        mine, theirs = ledger.get(dep, 0.0), bill[dep]
        diff = (theirs - mine) / theirs if theirs else 0.0
        verdict = "正常" if abs(diff) <= THRESHOLD else "要查"
        print(f"  {dep:<9} 账本 {mine:.6f}  账单 {theirs:.6f}  差额 {diff:+.1%}  {verdict}")


def recompute_ignoring_cache(db: sqlite3.Connection, price: dict[str, dict[str, float]]) -> dict[str, float]:
    """假设网关把「缓存命中」字段漏解析了:命中的 token 也按未命中价格算。"""
    out: dict[str, float] = {}
    for dep, inp, out_tok in db.execute("SELECT deployment, SUM(input_tokens), SUM(output_tokens) FROM usage GROUP BY deployment"):
        p = price[dep]
        out[dep] = (inp * p["miss"] + out_tok * p["out"]) / 1e6
    return out


if __name__ == "__main__":
    db = sqlite3.connect(os.environ["LEDGER_PATH"])
    ledger = ledger_totals(db)
    print("账本里各部署的合计(元):", {k: round(v, 6) for k, v in ledger.items()})

    print("场景 A:账单和账本基本一致(假账单 = 账本 × 1.01,四舍五入造成的零头)")
    check(ledger, {d: v * 1.01 for d, v in ledger.items()})

    print("场景 B:有人拿着真 key 绕过网关直连,账单比账本多出一截(假账单 = 账本 + 0.0004)")
    check(ledger, {**ledger, "flash": ledger["flash"] + 0.0004})

    print("场景 C:网关漏解析了缓存命中字段(用 pro-fake 那几行重算,命中的 600 token 被当成未命中)")
    wrong = recompute_ignoring_cache(db, {"flash": {"miss": 2.0, "out": 8.0}, "pro-fake": {"miss": 12.0, "out": 48.0}})
    check(wrong, {d: ledger[d] for d in ledger})
```

<div class="line-notes">

- `THRESHOLD = 0.02` 差额在 2% 以内算正常。
- `return {d: float(c) for d, c in db.execute("SELECT deployment, SUM(cost_cny) FROM usage GROUP BY deployment")}` 账本里每个部署的合计金额。
- `diff = (theirs - mine) / theirs if theirs else 0.0` 差额 = (账单 − 账本) / 账单。账单比账本大时是正数,小时是负数,符号本身就携带信息。
- `verdict = "正常" if abs(diff) <= THRESHOLD else "要查"` 不管正负,绝对值超过 2% 就要查。
- `for dep, inp, out_tok in db.execute("SELECT deployment, SUM(input_tokens), SUM(output_tokens) FROM usage GROUP BY deployment"):` 重算时只取每个部署的输入和输出合计,不用缓存命中那一列。
- `out[dep] = (inp * p["miss"] + out_tok * p["out"]) / 1e6` 缓存命中的 token 也按未命中价算,这就是「漏解析缓存字段」的后果。
- `check(ledger, {d: v * 1.01 for d, v in ledger.items()})` 场景 A:每个部署的账单都比账本大 1%。
- `check(ledger, {**ledger, "flash": ledger["flash"] + 0.0004})` 场景 B:flash 的账单比账本多 0.0004,模拟有人绕过网关。
- `check(wrong, {d: ledger[d] for d in ledger})` 场景 C:「网关算的」是 `wrong`(漏了缓存),「账单」用原来的账本数(它按真实命中算的),谁大谁小一目了然。

</div>

```bash
LEDGER_PATH=gateway_demo.db uv run python part10/gateway/reconcile.py
```

```text
账本里各部署的合计(元): {'flash': 0.001082, 'pro-fake': 0.01968}
场景 A:账单和账本基本一致(假账单 = 账本 × 1.01,四舍五入造成的零头)
  flash     账本 0.001082  账单 0.001093  差额 +1.0%  正常
  pro-fake  账本 0.019680  账单 0.019877  差额 +1.0%  正常
场景 B:有人拿着真 key 绕过网关直连,账单比账本多出一截(假账单 = 账本 + 0.0004)
  flash     账本 0.001082  账单 0.001482  差额 +27.0%  要查
  pro-fake  账本 0.019680  账单 0.019680  差额 +0.0%  正常
场景 C:网关漏解析了缓存命中字段(用 pro-fake 那几行重算,命中的 600 token 被当成未命中)
  flash     账本 0.001082  账单 0.001082  差额 +0.0%  正常
  pro-fake  账本 0.033600  账单 0.019680  差额 -70.7%  要查
```

场景 A 差 1%,在门槛里,正常。场景 B 的差额是 +27.0%,只出在 flash 上,`pro-fake` 一分不差,指向「有人绕过网关直连了 flash」。场景 C 在 `pro-fake` 上差了 −70.7%(网关算出 0.0336,账单只有 0.01968),而 flash 一分不差:`pro-fake` 的用量里有 600 个缓存命中的 token,漏解析之后全按未命中价算,所以多算了;flash 因为这几次请求都很短、没命中缓存,漏不漏都一样。你看,差额出现在哪个部署上、是正还是负,基本就把嫌疑缩到了一两处。

## 流式请求怎么办

真实的 Agent 大量用流式输出(Day 4),最小网关不支持只是为了让代码短。加上流式要处理三件事。

转发:网关要把上游的 SSE 流原样转给客户端,FastAPI 用 `StreamingResponse` 包一个异步生成器就行。

成本:流式响应默认不带 `usage`,要在请求里加 `stream_options={"include_usage": true}`,让最后一个 chunk 带上用量,网关在流结束时记账。

降级:只能在拿到**第一个 chunk 之前**切换。道理很简单:一旦网关已经把「退」这个字发给了客户端,再换一家从头生成,客户端看到的就是「退退款」或者两段拼起来的乱码,你没法收回已经发出去的字节。所以实现上是先 await 第一个 chunk,拿到了才开始往客户端推;拿第一个 chunk 就失败的,可以试下一个部署;已经推了一部分才失败的,只能给客户端发一个错误事件,让它自己重试。下面用进程内的假 ASGI 应用演示这两种情况,不联网:

```python
# agent-zero-lab/part10/gateway/stream_first_chunk.py
"""流式请求的降级:只能在「第一个 chunk 到手之前」换供应商。上游是进程内的假 ASGI 应用,不联网。
用法:uv run python part10/gateway/stream_first_chunk.py
"""
import asyncio
from collections.abc import AsyncIterator

import httpx
from fastapi import FastAPI
from fastapi.responses import StreamingResponse


def make_upstream(mode: str) -> FastAPI:
    app = FastAPI()

    @app.post("/chat/completions")
    async def chat() -> StreamingResponse:
        async def gen() -> AsyncIterator[bytes]:
            if mode == "dead-before":
                raise RuntimeError("连接一建立就崩了")           # 还没吐出任何字节
            yield 'data: {"delta": "退"}\n\n'.encode()
            if mode == "dead-middle":
                raise RuntimeError("说到一半崩了")
            yield 'data: {"delta": "款"}\n\n'.encode()
            yield b"data: [DONE]\n\n"
        return StreamingResponse(gen(), media_type="text/event-stream")

    return app


async def stream_with_fallback(order: list[str]) -> AsyncIterator[bytes]:
    for name in order:
        client = httpx.AsyncClient(transport=httpx.ASGITransport(app=make_upstream(name), raise_app_exceptions=False), base_url="http://up")
        try:
            async with client.stream("POST", "/chat/completions", json={}) as resp:
                if resp.status_code >= 500:
                    print(f"  [{name}] 在第一个 chunk 之前失败(HTTP {resp.status_code}),换下一个")
                    continue
                chunks = resp.aiter_bytes()
                first = await anext(chunks)                    # 关键:先拿到第一个 chunk,再决定要不要开始往客户端推
                print(f"  [{name}] 拿到第一个 chunk,之后不能再换了")
                yield first
                finished = b"[DONE]" in first
                try:
                    async for c in chunks:
                        finished = finished or b"[DONE]" in c
                        yield c
                except (httpx.HTTPError, RuntimeError):
                    finished = False
                if not finished:                               # 流断了却没收到 [DONE]:告诉客户端出错了,不能偷偷换一家重来
                    yield b'data: {"error": "upstream failed mid-stream"}\n\n'
                return
        except (httpx.HTTPError, StopAsyncIteration, RuntimeError) as e:
            print(f"  [{name}] 在第一个 chunk 之前失败({type(e).__name__}),换下一个")
    yield b'data: {"error": "all deployments failed"}\n\n'


async def main() -> None:
    for label, order in [("主用在第一个 chunk 前挂了", ["dead-before", "ok"]), ("主用说到一半挂了", ["dead-middle", "ok"])]:
        print(label)
        got = [c async for c in stream_with_fallback(order)]
        print("  客户端收到:", [c.decode().strip() for c in got])


asyncio.run(main())
```

<div class="line-notes">

- `def make_upstream(mode: str) -> FastAPI:` 造一个假上游,`mode` 决定它在哪里出问题。
- `raise RuntimeError("连接一建立就崩了")           # 还没吐出任何字节` `dead-before` 模式:生成器一开始就抛异常,一个字节都没发出去。
- `if mode == "dead-middle":` `dead-middle` 模式:先发出了「退」,再崩。
- `async def stream_with_fallback(order: list[str]) -> AsyncIterator[bytes]:` 网关侧的逻辑:按 `order` 里的顺序试每个上游,是个异步生成器,每 `yield` 一次就往客户端推一段。
- `client = httpx.AsyncClient(transport=httpx.ASGITransport(app=make_upstream(name), raise_app_exceptions=False), base_url="http://up")` `ASGITransport` 让 httpx 直接调进程内的 FastAPI 应用,不走网络。`raise_app_exceptions=False` 表示应用内部崩了不要把异常抛给调用方,而是让响应「断掉」,这更像真实网络里连接被对方掐断。
- `first = await anext(chunks)                    # 关键:先拿到第一个 chunk,再决定要不要开始往客户端推` 就是这一行。`anext` 取异步迭代器的下一个元素。没有任何字节的时候它会抛 `StopAsyncIteration`,被下面的 `except` 接住,走「换下一个」。
- `finished = b"[DONE]" in first` 流正常结束时最后一块是 `data: [DONE]`。边转发边看有没有收到它。
- `if not finished:                               # 流断了却没收到 [DONE]:告诉客户端出错了,不能偷偷换一家重来` 已经推出去的东西收不回,只能补一个错误事件。
- `except (httpx.HTTPError, StopAsyncIteration, RuntimeError) as e:` 第一个 chunk 之前的任何失败都走这里,换下一个上游。

</div>

```bash
uv run python part10/gateway/stream_first_chunk.py
```

```text
主用在第一个 chunk 前挂了
  [dead-before] 在第一个 chunk 之前失败(StopAsyncIteration),换下一个
  [ok] 拿到第一个 chunk,之后不能再换了
  客户端收到: ['data: {"delta": "退"}\n\ndata: {"delta": "款"}\n\ndata: [DONE]']
主用说到一半挂了
  [dead-middle] 拿到第一个 chunk,之后不能再换了
  客户端收到: ['data: {"delta": "退"}', 'data: {"error": "upstream failed mid-stream"}']
```

第一种,主用在第一个 chunk 之前就挂了(没吐出任何字节),网关换到 `ok`,客户端拿到了完整的「退款」加 `[DONE]`,完全不知道发生了换家。第二种,主用已经发出了「退」,之后才挂,网关没法换了,客户端收到的是「退」加一个错误事件。流式的降级就是这么不对称,也是我前面说「先用现成的网关」的理由之一:这些细节自己写要花很多时间。

## 多实例

网关一定是多实例部署的。今天的令牌桶、熔断器和账本月累计,都在单个进程里,多实例下会各数各的。令牌桶搬到 Valkey 在 [Day 586 的练习 3](/blog/agent-zero/day-586-gateway-1/) 已经写过一遍(用 Lua 脚本在服务端一步完成补水、判断、扣减)。熔断器的状态可以放 Valkey,也可以接受每个实例各自熔断,多一两次失败的代价不大,是个可以偷懒的地方。预算查的是账本,账本换成 Postgres 之后所有实例读同一张表,不用额外处理。

## 动手练习

**练习 1(写测试)**:预算「软告警」已经写在网关里了(花到 80% 在响应头里带 `x-gateway-budget-warning`),但还没有测试。写一个测试:预算 0.002 元,每单 0.001624 元,第一单之后已用 81%,第二单的响应头里应该有告警,而且请求照常放行;第三单已经超了,要 402。

<details><summary>参考答案</summary>

新建 `part10/gateway/test_budget_warning.py`:

```python
# agent-zero-lab/part10/gateway/test_budget_warning.py
"""练习 1 参考答案:软预算告警。花到 80% 以上,请求照常放行,但响应头里带一条警告。
用法:uv run pytest -q part10/gateway/test_budget_warning.py
"""
from fastapi.testclient import TestClient

from .gateway_v2 import create_app
from .ledger import Ledger
from .test_gateway import fake_upstream, make_config, post


def test_warning_between_80_and_100_percent() -> None:
    _, factory = fake_upstream()
    # 每单 0.001624 元;预算 0.002 → 第一单后已用 81.2%,还没超
    client = TestClient(create_app(make_config(budget=0.002), Ledger(), factory))
    first = post(client)
    assert first.status_code == 200 and "x-gateway-budget-warning" not in first.headers     # 花之前是 0%,没警告
    second = post(client)
    assert second.status_code == 200                                                         # 没超,照常放行
    assert second.headers["x-gateway-budget-warning"] == "81% used"
    third = post(client)
    assert third.status_code == 402                                                          # 现在超了(已花 0.003248)
```

<div class="line-notes">

- `from .test_gateway import fake_upstream, make_config, post` 直接复用上面测试文件里的几个帮手函数,不用重写。
- `client = TestClient(create_app(make_config(budget=0.002), Ledger(), factory))` 预算 0.002 元,每单 0.001624。
- `assert first.status_code == 200 and "x-gateway-budget-warning" not in first.headers     # 花之前是 0%,没警告` 第一单请求进来时账本是空的,花了 0%,所以没有告警头。
- `assert second.headers["x-gateway-budget-warning"] == "81% used"` 第二单进来时已花 0.001624,0.001624 ÷ 0.002 = 81.2%,`:.0%` 格式化成 `81%`。
- `assert third.status_code == 402                                                          # 现在超了(已花 0.003248)` 两单合计 0.003248 > 0.002,第三单被拒。

</div>

```bash
uv run pytest -q part10/gateway/test_budget_warning.py
```

```text
.                                                                        [100%]
1 passed in 0.45s
```

通过。想想为什么这条告警头对运维有用:它让业务方在被 402 拒绝之前就有机会发现自己快超了,而不是某天早上突然所有请求都失败。

</details>

**练习 2(预测)**:设想把 `gateway_v2.py` 里 503 前面那行 `tenant.bucket.give_back(reserve)` 删掉。租户桶只有 1000 token,时钟固定、桶不补水,每个请求预扣 212(估算 12 加 `max_tokens` 200),上游全部返回 500,连发 10 个请求。先不要跑,预测一下返回的状态码序列。

<details><summary>参考答案</summary>

不还额度的话,每个失败的请求都白白占掉 212,桶里只能放得下 4 个(4 × 212 = 848,第 5 个需要 212 但只剩 152),所以前 4 个是 503,从第 5 个起变成 429:`[503, 503, 503, 503, 429, 429, 429, 429, 429, 429]`。这就是练习 3 的测试在被改坏后会报告的现象(下标 4 开始 `429 != 503`)。

意思是:上游出故障时,本来应该告诉业务方「上游挂了」(503),结果租户被误告知「你限流了」(429),业务方的代码会照 429 去退避等待,而不是切换到别的方案;而且故障恢复以后,桶里的额度还是空的,要等它自己补回来。

</details>

**练习 3(写测试)**:写一个测试证明:上游全挂的请求不会占着限流额度。桶 1000 token、时钟固定(桶不会自己补水),上游永远 500,连发 10 个请求,断言都是 503。先写好,再把 503 前面那行 `give_back` 删掉确认它变红,最后改回去。

<details><summary>参考答案</summary>

新建 `part10/gateway/test_refund_on_failure.py`:

```python
# agent-zero-lab/part10/gateway/test_refund_on_failure.py
"""练习 3 参考答案:上游全挂的请求不该占着限流额度。桶只有 1000,每个请求预扣约 200 多,
如果失败后不还回去,第 4 个请求起就会被误判成 429,而不是 503。
用法:uv run pytest -q part10/gateway/test_refund_on_failure.py
"""
import httpx
from fastapi.testclient import TestClient

from .gateway_v2 import create_app
from .ledger import Ledger
from .test_gateway import make_config, post


def test_failed_requests_give_back_their_reservation() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": {"message": "down"}})

    factory = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    # tpm=1000 且 clock 固定:桶不会自己补水,额度只能靠「还回去」保住
    client = TestClient(create_app(make_config(tpm=1000), Ledger(), factory, clock=lambda: 0.0))
    codes = [post(client).status_code for _ in range(10)]
    assert codes == [503] * 10        # 10 次都是「上游挂了」,没有一次变成 429
```

<div class="line-notes">

- `def handler(request: httpx.Request) -> httpx.Response:` 假上游的处理函数,不管收到什么都回 500。
- `factory = lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))` 这次没用 `fake_upstream`,因为我们要的是「全部失败」,自己写一个更直接。
- `client = TestClient(create_app(make_config(tpm=1000), Ledger(), factory, clock=lambda: 0.0))` `clock=lambda: 0.0` 把时间固定在 0:桶永远不会自己补水,所以额度只能靠 `give_back` 保住。
- `codes = [post(client).status_code for _ in range(10)]` 连发 10 次,收集状态码。
- `assert codes == [503] * 10        # 10 次都是「上游挂了」,没有一次变成 429` `[503] * 10` 是 10 个 503 的列表。

</div>

```bash
uv run pytest -q part10/gateway/test_refund_on_failure.py
```

```text
.                                                                        [100%]
1 passed in 0.45s
```

删掉 `give_back` 那一行之后再跑,红的输出:

```text
_______________ test_failed_requests_give_back_their_reservation _______________
    def test_failed_requests_give_back_their_reservation() -> None:
E       assert [503, 503, 50...429, 429, ...] == [503, 503, 50...503, 503, ...]
E         
E         At index 4 diff: 429 != 503
E         Use -v to get more diff
```

`At index 4 diff: 429 != 503`,下标 4 就是第 5 个请求,和练习 2 里算的一致。改回去,10 个测试全绿。

</details>

**练习 4(开放题)**:三个租户的预算超了,各选「拒绝、降级到便宜模型、只告警」之一,写出理由和你最担心的一件事。①公司内部的实验平台,每个工程师一个 key;②线上的客服 Agent,每天几千个用户在用;③财务部门的月结对账 Agent,每月 1 号跑一次,用的是 `smart` 组里最强的模型。

<details><summary>参考答案</summary>

没有标准答案,下面是我的选择:

| 租户 | 选 | 理由 | 最担心 |
| --- | --- | --- | --- |
| ① 内部实验平台 | 拒绝(402) | 没有线上用户,停了只是工程师等一会儿;硬刹车能防一个死循环的脚本烧光整个团队的预算 | 工程师为了不被拦,开始互相借 key,绕过网关;所以拒绝时的错误信息要写清楚怎么申请加额度 |
| ② 线上客服 | 先告警(80%),100% 后降级,不拒绝 | 客服停摆的代价远大于多花的钱;降级后回复质量变差比没有回复好 | 降级后质量到底变差多少,没人知道;要事先在评测集上跑过备用模型,并且响应头里留好标记 |
| ③ 月结对账 | 只告警,不降级 | 一个月只跑一次,降级到便宜模型会让对账结果不可靠,比多花几十块钱糟糕得多;宁可超预算也要用对的模型 | 没有硬刹车,这个租户万一出 bug 会一直烧;所以限流(令牌桶)要设紧,同时设一个远高于正常用量的「绝对上限」做最后一道保险 |

评价标准:不是选哪个对,而是理由里有没有具体的约束(有没有线上用户、降级会不会让结果不可靠),以及担心的是不是一件具体的、能检查的事。

</details>

**验收标准**:8 个网关测试加练习 1、练习 3 的两个测试(共 10 个)全绿;能把 `gateway_v2.py` 里 `chat` 的五个步骤(鉴权、预算、限流、路由降级、结算记账)不看文章说一遍,每一步失败回什么状态码;`try_gateway_v2.py` 里能解释为什么假上游只被敲了 3 次;能说出场景 B 和场景 C 的差额分别指向什么问题;能解释为什么流式请求只能在第一个 chunk 之前降级。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 模型组 | 业务方请求时写的 `model` 值(如 `fast`、`smart`),背后是一个有序的部署列表,平台可以换底层模型而业务方不用改 |
| 部署(deployment) | 一个具体的「供应商 + 地址 + 模型名 + 价格」的组合,如 `flash`、`pro-fake` |
| 降级(fallback) | 请求在一个部署上失败后改走组里的下一个;和「预算降级」(超预算后改走便宜的组)是两回事 |
| 熔断器(circuit breaker) | 某个部署连续失败几次就暂时不去敲它,冷却后放一个请求试探,成功了才恢复 |
| 半开 | 熔断冷却时间过后,放一个请求过去试探的那个状态 |
| 硬预算 / 软预算 | 超了就拒绝 / 超了只告警和记录,请求照常放行 |
| 成本归因 | 把每次调用的钱算到具体的租户、项目、Agent 头上 |
| Showback / chargeback | 只给各部门看花了多少 / 真的从各部门预算里扣 |
| 价格版本 | 价格表的版本号,每行账记下用的哪一版,供应商调价后历史账单不会算错 |
| 缓存命中 token | 上游服务缓存了之前见过的提示词前缀,这部分输入按便宜很多的价格收费(DeepSeek 是 0.04 对 2) |
| 对账 | 把网关账本和供应商账单逐项比,差额超过 2% 就要查原因 |
| `MockTransport` | httpx 里的假传输层:自己写一个函数决定每个出去的请求得到什么响应,测试时不用联网 |
| 相对导入 | `from .xxx import yyy`,从同一个包里导入,前面的点表示「当前包」 |
| SSE | Server-Sent Events,服务器一段一段推送文本的 HTTP 响应格式,流式的聊天接口用它 |

## 常见误区

**预算超了一律拒绝。** 线上客服停摆的代价通常远大于多花的钱。按租户区分:内部实验可以拒绝,线上生产先告警再降级。

**降级到便宜模型却不告诉任何人。** 回复质量变了,用户不知道,出了问题你也追不到。降级必须在响应头和账本里留痕(`x-gateway-downgraded-from`、`model_group`),并且备用模型要在评测集上跑过。

**把 400 也当成「可以换一家」的错误。** 参数错了换谁都错,换一家只是多花一次钱、多等一次时间,还可能掩盖真正的 bug。实测:把 `>= 500` 改成 `>= 400`,`test_bad_request_is_not_retried` 立刻变红。

**没有熔断器。** 主用挂了,每个请求都要先等它超时再换备用,延迟加一次超时,而且你的网关还在持续打一个已经倒下的服务。实测 `fast-ha` 连发 5 次,假上游只被敲了 3 次。

**预扣之后上游失败了,不还额度。** 上游一出故障,租户的额度就被失败的请求占光,业务方收到的是 429 而不是 503,以为是自己限流了。桶 1000 token、每个预扣 212 时,从第 5 个请求起就变成 429。

**账里记的是请求的组,不是实际的部署。** 请求 `smart` 实际落到了备用的 flash,账记在 `smart` 的贵模型上,月底和供应商账单永远对不上。要记**实际**部署。

**漏解析缓存命中字段。** 命中的 token 也按未命中价算,账本比账单大。实测假账单场景 C,`pro-fake` 上差了 −70.7%。不同供应商的字段名不一样,网关要把它们抹平。

**只测 happy path。** 降级、熔断、预算、限流都是「出了事才走」的路径,平时手动点不到,只有测试才会走。测试写完要故意改坏一处,确认它会变红。

**流式请求中途出错后悄悄换一家重来。** 已经发给客户端的字节收不回,换一家从头生成,客户端看到的是两段拼起来的乱码。只能在第一个 chunk 之前降级,之后只能发一个错误事件。

## 学习资料

### 文档与文章

- [LiteLLM · 预算与限流(Budgets, Rate Limits)](https://docs.litellm.ai/docs/proxy/users):`max_budget`、`budget_duration`、`tpm_limit` 怎么配,超预算后的行为;对照我们今天的 `monthly_budget_cny` 和 `on_budget_exceeded`。
- [LiteLLM · 路由、重试与降级(Fallbacks)](https://docs.litellm.ai/docs/routing):真正的生产网关里 `fallbacks`、`cooldown`、`num_retries` 这些配置项分别对应我们今天写的什么。
- [Martin Fowler · Circuit Breaker](https://martinfowler.com/bliki/CircuitBreaker.html):熔断器模式的经典短文,一篇就能读完,和今天的 `breaker.py` 对着看。
- [DeepSeek · 错误码](https://api-docs.deepseek.com/quick_start/error_codes):429、500、503 在 DeepSeek 那里各是什么意思,决定哪些该降级。
- [DeepSeek · 上下文硬盘缓存](https://api-docs.deepseek.com/guides/kv_cache):`prompt_cache_hit_tokens` 和 `prompt_cache_miss_tokens` 从哪来,为什么命中的部分便宜 50 倍。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EGNGzhEQj&autoplay=0&high_quality=1" title="大模型网关 LiteLLM 零基础快速上手教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员暮闲 · 大模型网关 LiteLLM 零基础快速上手教程 · 16 分钟。从安装到配多个模型、生成虚拟 key、看花费,跟着做一遍,再对照今天的 `gateway_v2.py`,能看出每个配置项在防什么。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ADHcBxEXvFA" title="Circuit Breaker Pattern - Fault Tolerant Microservices" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Defog Tech · Circuit Breaker Pattern - Fault Tolerant Microservices · 英文,用动画讲熔断器三个状态怎么切换,对照今天的状态图。</figcaption>
</figure>

### 书籍

- Michael T. Nygard《Release It!》(第 2 版,Pragmatic Bookshelf,2018):熔断器(Circuit Breaker)、舱壁(Bulkhead)、超时这些稳定性模式的出处,今天的熔断器就来自这本书里的描述。英文原版。

### 开源项目与代码

- [BerriAI/litellm](https://github.com/BerriAI/litellm):对照今天的 `gateway_v2.py`,看它的 `proxy/` 和 `router.py` 里降级、冷却、预算检查各在哪。
- [maximhq/bifrost](https://github.com/maximhq/bifrost):Go 写的网关,看一个不同语言的实现怎么组织同样的几件事。
- [higress-group/higress](https://github.com/higress-group/higress):`ai-quota`、`ai-token-ratelimit` 插件的实现,对照我们的预算和令牌桶。

## 自测

1. 预算超了有哪三种处理方式,各适合什么场景?降级到便宜模型要特别注意什么?

<details><summary>答案</summary>

拒绝(402),适合内部实验、个人 key,硬刹车防死循环;只告警,适合线上生产,不停摆但要有提前提醒(比如 80%);降级到便宜模型,适合不想停又不想无限烧钱的场景。降级是产品决策而不是纯技术决策:回复质量会悄悄变差,所以备用模型要先在评测集上跑过,并且在响应头和账本里留下「从哪个组降下来的」的记录。

</details>

2. 为什么预算最多会超一单?要做到一分不超需要什么?

<details><summary>答案</summary>

预算检查查的是账本里「已经花的」,不包括正在处理的这一单,所以最后一单可能让总额超出预算。实测销售租户预算 0.005 元,一次调用 0.00984 元,第一次检查通过,调完就超了。要一分不超,得像预扣 token 那样预扣金额,复杂度更高,而且并发请求同时检查时仍会各自看到「还没超」。多数内部平台接受最多超一单,配合 80% 提前提醒。

</details>

3. 哪些错误该降级,哪些不该?为什么?

<details><summary>答案</summary>

标准是「换个地方可能就好了」。429、5xx、超时、连不上应该降级;400、401、403 换谁都一样错,应该把错误原样还给调用方,同时把预扣的限流额度还回去。内容安全拦截的降级要很小心,可能是在绕开本该生效的安全策略。把 400 也当可降级的错误会掩盖真正的 bug,还白花一次调用。

</details>

4. 熔断器解决什么问题?说出它的三个状态和切换条件。

<details><summary>答案</summary>

主用部署挂了时,如果每个请求都先去敲它、等超时、再切备用,每个请求都白等一次超时,还在持续打一个倒下的服务。熔断器在连续失败 N 次后「断开」,期间直接跳过它。三个状态:正常(照常发);断开(连续失败达到阈值,冷却时间内直接跳过);半开(冷却时间过后放一个请求试探,成功回到正常,失败回到断开并重新计时)。实测连发 5 次请求,假上游只被敲了 3 次。

</details>

5. 成本账里每一行要记什么?为什么要记「实际部署」而不是请求的组?

<details><summary>答案</summary>

维度:租户、项目、Agent、run id、模型组、实际部署;用量:输入 token、缓存命中 token、输出 token;金额和价格版本。记实际部署是因为月底要和供应商账单对账,供应商只认实际调用了哪家;请求 `smart` 实际降级到了 flash 的话,账记在 `smart` 的贵模型上就永远对不上。价格版本是为了供应商调价后历史账单仍按当时价格算。

</details>

6. (面试题)月底网关账本比供应商账单少了 27%,而且差额集中在一个部署上。你怎么查?反过来,账本比账单大了 70%,而且集中在用了缓存的部署上,又怎么查?

<details><summary>答案</summary>

账本比账单少:先怀疑有人绕过网关直连(拿着真 key 直接调),看供应商后台的调用来源和时间,再查真 key 有没有泄露到业务方手里;其次查价格表是不是没跟着供应商调价更新,以及网关有没有漏记某些请求(比如降级路径、错误路径上的扣费)。因为差额集中在一个部署上,更像绕过。账本比账单大且集中在用缓存的部署上:几乎可以确定是网关漏解析了缓存命中字段,命中的 token 被当成未命中价格;检查 `cost_of` 对该供应商的缓存字段名(DeepSeek 的 `prompt_cache_hit_tokens`、OpenAI 风格的 `prompt_tokens_details.cached_tokens`),用几行已知用量的假数据重算一遍确认。整体思路:差额的方向、大小、集中在哪个部署,三个信号一起缩小范围,不要凭感觉。

</details>

## 明天预告

明天是 Day 589 · MCP 网关(一):2026 规范变化和远程授权流程。今天管住了模型这一个出口,明天开始管工具那个出口。平台化以后,十几个 Agent 要按不同权限去调十几个 MCP server,每条连线一个凭证没人说得清谁能调什么,这和今天的模型网关是同一个问题。明天先读 2026-07-28 版 MCP 规范相对上一版变了什么(协议变成无状态的、动态客户端注册被废弃、授权响应多了 `iss` 校验),然后在本机用假的授权服务器和假的 MCP server,把整个 OAuth 流程从头到尾走一遍:401、受保护资源元数据、授权服务器元数据、Client ID Metadata Document、PKCE、`resource` 参数、令牌受众校验,最后故意制造几个攻击看它们怎么被挡住。
