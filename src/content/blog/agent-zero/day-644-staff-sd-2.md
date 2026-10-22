---
title: 'Day 644 · Staff 系统设计(二):真题二、真题三和追问清单'
description: '接着 Day 642 再练两道 Staff 级系统设计真题。真题二是大促十万并发会话的客服 Agent,核心是估算:利特尔定律算出 3.3 万个在途请求、每小时 14 万的模型费,再用分诊和缓存把它砍下来,并且算出人工坐席只扛得住 6% 的转人工率。真题三是代码 Agent 的评测体系,没有大流量,考 pass@k 和 pass^k、配对比较。最后用八条追问做 30 秒快答训练。'
pubDate: 2026-10-22
regime: none
tags: ['system-design', 'interview', 'evals', 'staff-engineer', 'python', 'agent-zero']
series: 'agent-zero'
day: 644
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 643](/blog/agent-zero/day-643-week92-review/) 是复习日,把这一周从 AgentOps 安全加固到 Staff 系统设计串成了一张图,默写了 `monthly()` 和三层权限的 `decide()`,还拼了一个生成「成本估算」一节的小工具。那个工具跑出来一个很说明问题的数:CloudLedger 一个月 3000 张工单,高峰在途请求只有 0.04 个,并发根本不是问题。

今天换两道规模和性质都不一样的题。真题二的规模是 CloudLedger 的几万倍,并发和成本会变成决定一切的数;真题三几乎没有流量,难点全在「怎么证明变好了」。两道题放在一起练,是想让你体会到:45 分钟框架是固定的,每道题「决定架构的那个数」完全不同。

## 今天要解决的问题

学完今天,你应该能做到:

1. 答出真题二「大促十万并发会话的客服 Agent」:用脚本算出模型 QPS、在途请求、需要几个供应商账号、每小时成本,说出分诊和缓存各砍掉多少;用利特尔定律算出人工坐席能扛的最高转人工率。
2. 答出真题三「代码 Agent 的评测体系」:说清评测集怎么从内部仓库挖、怎么防污染,会算 pass@k 和 pass^k,能用配对比较说明一次改进是不是真的。
3. 对八条高频追问,每条能在 30 秒内给出带数字、带代价、带边界的回答,并用模型给自己的回答打分。

预计用时:3 小时,其中两道题各留 20 分钟对着计时器自己讲一遍。前置:[Day 642](/blog/agent-zero/day-642-staff-sd-1/)(45 分钟框架和真题一)、[Day 638](/blog/agent-zero/day-638-agentops-load/)(利特尔定律)、[Day 548](/blog/agent-zero/day-548-eval-stats-2/)(配对比较)、[Day 558](/blog/agent-zero/day-558-bench-1/)(τ-bench 和 SWE-bench)、[Day 577](/blog/agent-zero/day-577-distill-1/)(蒸馏和分诊小模型)。

学法提示:先对照文章逐行敲一遍代码(不复制粘贴)并跑通;第二天合上文章,把真题二的两个决定架构的数和真题三的四类指标默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 真题二:大促时十万个并发会话的客服 Agent

**题目(大致原话)**:一家电商平台大促期间,客服 Agent 要同时服务 10 万个在线会话。设计这个系统。

这道题和真题一最大的区别是,它几乎是一道估算题。很多人一听「十万并发」就开始画负载均衡、消息队列、分库分表,然后面试官问一句「你的模型调用量是多少」就卡住了。普通后端的十万并发,瓶颈在连接数和数据库;Agent 的十万并发,瓶颈在模型供应商的额度和钱包。

### 需求阶段:先问出四个数

我会问这几个问题,括号里写它决定了什么:

- 用户在一个会话里多久发一条消息?(决定消息速率。)
- Agent 处理一条消息平均调几次模型、几次工具?(决定模型 QPS。)
- 首字延迟要求多少?能不能转人工,人工坐席有多少?(决定能不能用慢模型、转人工的容量上限。)
- 会话里最常见的问题是哪几类?(决定能不能分流。)

假设面试官的回答是:用户平均 30 秒发一条;每条消息平均 2.5 次模型调用(先分类,检索后回答,一部分要查订单);首字延迟 P95 小于 2 秒;人工坐席 2000 人;大促期间六七成问题是「快递到哪了」「怎么退货」这类高频问题。

首字延迟就是用户发完消息到看到第一个字的时间,你在 [Day 133](/blog/agent-zero/day-133-sse-principle/) 讲流式输出时量过,英文叫 TTFT(time to first token)。2 秒的要求意味着回答必须流式输出,而且不能在回答前串行跑太多步。

### 估算:找到决定架构的两个数

`part10/estimate_cs.py`,和 Day 642 的 `estimate.py` 放在一起。价格和并发上限我今天又在 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 核对了一次:deepseek-flash 高峰时段输入命中 0.04 元、未命中 2 元、输出 8 元(每百万 token),每个账号并发上限 2500。

```python
# agent-zero-lab/part10/estimate_cs.py
import math

SESSIONS = 100_000        # 面试官给的:大促高峰同时在线会话
MSG_INTERVAL_S = 30       # 假设:用户平均 30 秒发一条
CALLS_PER_MSG = 2.5       # 假设:每条消息平均调 2.5 次模型
IN_TOKENS, OUT_TOKENS = 3000, 200   # 假设:每次调用的输入和输出
LATENCY_S = 4.0           # 假设:一次调用 4 秒
PRICE = (0.04, 2.0, 8.0)  # deepseek-flash 高峰价 命中/未命中/输出,元/百万 token,2026-10-22 查
LIMIT = 2500              # deepseek-flash 每账号并发上限,2026-10-22 查

def per_call(hit_rate: float) -> float:
    hit, miss, out = PRICE
    return (IN_TOKENS * hit_rate * hit + IN_TOKENS * (1 - hit_rate) * miss + OUT_TOKENS * out) / 1e6

def plan(big_share: float, hit_rate: float) -> None:
    msg_rate = SESSIONS / MSG_INTERVAL_S
    qps = msg_rate * CALLS_PER_MSG * big_share
    inflight = qps * LATENCY_S
    hourly = qps * 3600 * per_call(hit_rate)
    print(f"大模型承担 {big_share:.0%}、缓存命中 {hit_rate:.0%}:"
          f"{qps:,.0f} QPS,在途 {inflight:,.0f},要 {math.ceil(inflight / LIMIT)} 个账号,"
          f"每小时 ¥{hourly:,.0f}")

if __name__ == "__main__":
    print(f"用户消息 {SESSIONS / MSG_INTERVAL_S:,.0f} 条/秒")
    plan(big_share=1.0, hit_rate=0.5)
    plan(big_share=0.35, hit_rate=0.5)
    plan(big_share=0.35, hit_rate=0.7)
```

<div class="line-notes">

- `import math` 只用到 `math.ceil`,向上取整,≈ JS 的 `Math.ceil`。账号数不能是 13.3 个。
- `SESSIONS = 100_000` 面试官给的数。注释里照例分开写「面试官给的」和「假设」。
- `MSG_INTERVAL_S = 30` 平均 30 秒发一条。这里其实又是一次利特尔定律:10 万个会话「在途」,每个会话每 30 秒「产出」一条消息,所以消息速率是 `100,000 / 30`。
- `IN_TOKENS, OUT_TOKENS = 3000, 200` 一行给两个变量赋值,≈ JS 的 `const [a, b] = [3000, 200]`。客服回答比 Day 642 真题一的平台调用短,输出按 200 算。
- `LATENCY_S = 4.0` 和 Day 642 一样取 4 秒。Day 642 练习 1 实测过 deepseek-flash 输出 170 个 token 左右要 2 秒。
- `def per_call(hit_rate: float) -> float:` 一次调用多少钱,缓存命中率做参数,后面要比较 50% 和 70% 两种情况。
- `return (IN_TOKENS * hit_rate * hit` 命中率 50% 时:`1500×0.04 + 1500×2 + 200×8 = 60 + 3000 + 1600 = 4660`,除以一百万是 ¥0.00466。
- `def plan(big_share: float, hit_rate: float) -> None:` `big_share` 是最终还要走大模型的流量比例。分诊小模型能直接答掉的那部分不走大模型。
- `msg_rate = SESSIONS / MSG_INTERVAL_S` `100,000 / 30 = 3,333` 条/秒。
- `qps = msg_rate * CALLS_PER_MSG * big_share` 全走大模型时 `3,333 × 2.5 = 8,333` 次/秒。
- `inflight = qps * LATENCY_S` 利特尔定律,`8,333 × 4 = 33,333` 个在途请求。
- `hourly = qps * 3600 * per_call(hit_rate)` 一小时的调用次数乘单价:`8,333 × 3600 × 0.00466 ≈ 139,800` 元。
- `f"{qps:,.0f} QPS,在途 {inflight:,.0f},要 {math.ceil(inflight / LIMIT)} 个账号,"` 三个 f-string 挨着写会自动拼成一个,和 JS 里用 `+` 拼字符串效果一样,Python 连 `+` 都不用写。`33,333 / 2500 = 13.3`,向上取整是 14 个账号。
- `plan(big_share=0.35, hit_rate=0.5)` 假设分诊小模型吃掉 65% 的流量,大模型只承担 35%。

</div>

```bash
uv run python -m part10.estimate_cs
```

```text
用户消息 3,333 条/秒
大模型承担 100%、缓存命中 50%:8,333 QPS,在途 33,333,要 14 个账号,每小时 ¥139,800
大模型承担 35%、缓存命中 50%:2,917 QPS,在途 11,667,要 5 个账号,每小时 ¥48,930
大模型承担 35%、缓存命中 70%:2,917 QPS,在途 11,667,要 5 个账号,每小时 ¥36,582
```

第一行就是决定架构的两个数。

**一是 33,333 个在途请求,是单账号上限的 13 倍多。** 所以单一供应商、单一账号从一开始就不可能,必须多账号、多供应商,或者自部署一部分流量。这一步要在面试里说出来,而且要说出代价:多供应商意味着同一个提示词要在两三个模型上分别评测,回答风格不一样,这是 [Day 634](/blog/agent-zero/day-634-agentops-router/) 做级联路由时遇到过的问题。DeepSeek 的并发上限可以提工单申请扩容,但大促前几天临时申请,你不能把系统设计押在「对方一定批」上。

**二是每小时 14 万元。** 大促按 10 个高峰小时算就是 140 万,这个数一出来,降本就不是优化项,是上线前提。

后两行是两个降本手段的效果。**分诊**(triage)是先用便宜的手段判断请求类型,把简单请求分流出去,不让它们碰大模型。「快递到哪了」这种问题,一个自部署的小分类模型判断出意图,查一下物流接口,套模板回答就行。[Day 577](/blog/agent-zero/day-577-distill-1/) 讲过怎么用大模型给数据打标、再蒸馏出这种小模型。分诊吃掉 65%,在途请求降到 11,667,账号从 14 个降到 5 个,每小时成本从 14 万降到 4.9 万。再把前缀缓存命中率从 50% 提到 70%(系统提示词和知识库片段固定放在前面,[Day 397](/blog/agent-zero/day-397-prompt-caching/) 讲过),又降到 3.7 万。

这里有两件事要诚实地说。第一,65% 这个比例是假设,面试时要说「需要用去年大促的会话日志验证」。第二,自部署小模型的成本没算进去:GPU 租金、部署、维护的人力都不是零。脚本里我没给它编一个价格,面试时可以说「小模型的 GPU 成本按每小时几千元量级估,和省下的十万相比是小头」,并且承认这是个要单独算的数。

### 转人工:第二次用利特尔定律

这是我认为这道题最能拉开差距的一点,大多数候选人想不到。2000 个人工坐席,每人同时接 4 个会话,同时最多 8000 个。Agent 转人工率 15% 听起来不高,10 万个会话的 15% 就是 1.5 万……这么算其实不对,10 万是「同时在线」的会话数,转人工的是「新进来的会话」里的一部分,人工处理又有自己的时长。三个量之间的关系,还是利特尔定律。`part10/handoff.py`:

```python
# agent-zero-lab/part10/handoff.py
SESSIONS = 100_000       # 同时在线会话
SESSION_MIN = 6          # 假设:一个会话平均持续 6 分钟
AGENTS = 2000            # 面试官给的:人工坐席
PER_AGENT = 4            # 假设:一个坐席同时接 4 个会话
HUMAN_MIN = 8            # 假设:转人工后人工平均处理 8 分钟

new_per_s = SESSIONS / (SESSION_MIN * 60)    # 利特尔定律倒过来:到达速率 = 在途 / 停留时间
capacity = AGENTS * PER_AGENT
print(f"每秒新进会话 {new_per_s:.0f} 个,人工同时能接 {capacity:,} 个")
for rate in (0.05, 0.10, 0.15):
    need = new_per_s * rate * HUMAN_MIN * 60
    flag = "够" if need <= capacity else f"缺 {need - capacity:,.0f} 个,排队每分钟多 {(need - capacity) / HUMAN_MIN:,.0f} 人"
    print(f"转人工率 {rate:.0%}:人工在途 {need:,.0f},{flag}")
print(f"人工能扛住的最高转人工率 {capacity / (new_per_s * HUMAN_MIN * 60):.1%}")
```

<div class="line-notes">

- `SESSION_MIN = 6` 一个会话从开始到结束平均 6 分钟。这是新假设,需求阶段可以问面试官。
- `HUMAN_MIN = 8` 转到人工以后,人平均要处理 8 分钟。被转人工的往往是难问题,所以比 Agent 的会话长。
- `new_per_s = SESSIONS / (SESSION_MIN * 60)` 利特尔定律是「在途 = 到达速率 × 停留时间」,倒过来就是「到达速率 = 在途 ÷ 停留时间」。同时在线 10 万个、每个停留 360 秒,所以每秒新进 `100,000 / 360 ≈ 278` 个会话。
- `capacity = AGENTS * PER_AGENT` 人工同时能接 `2000 × 4 = 8,000` 个会话。
- `need = new_per_s * rate * HUMAN_MIN * 60` 再用一次利特尔定律:每秒转人工 `278 × 0.15 ≈ 41.7` 个,每个人工处理 480 秒,人工那边的在途是 `41.7 × 480 ≈ 20,000` 个。
- `flag = "够" if need <= capacity else` 超了的话,排队每分钟多多少人:人工每分钟能处理完 `8000 / 8 = 1000` 个,转人工率 10% 时每分钟进来 `278 × 0.1 × 60 ≈ 1,667` 个,差 667。`(need - capacity) / HUMAN_MIN` 算出来是同一个数。
- `capacity / (new_per_s * HUMAN_MIN * 60)` 反过来求人工正好扛住时的转人工率:`8000 / (278 × 480) = 6.0%`。

</div>

```bash
uv run python -m part10.handoff
```

```text
每秒新进会话 278 个,人工同时能接 8,000 个
转人工率 5%:人工在途 6,667,够
转人工率 10%:人工在途 13,333,缺 5,333 个,排队每分钟多 667 人
转人工率 15%:人工在途 20,000,缺 12,000 个,排队每分钟多 1,500 人
人工能扛住的最高转人工率 6.0%
```

**人工只扛得住 6% 的转人工率。** 转人工率 10% 时,排队每分钟多 667 人,一小时就是 4 万人在排队。这意味着转人工率本身就是这个系统最重要的业务指标,也意味着设计里必须有:转人工排队并告诉用户预计等多久;排队太长时,Agent 先给出保守的模板答复并让用户选「继续等」还是「留言回电」;大促前就要用历史数据评估转人工率能不能压到 6% 以下,压不到就要提前和客服部门谈加临时坐席。

面试时这一段大概这样说:「我算了一下人工这边,按会话 6 分钟、人工处理 8 分钟,2000 个坐席只扛得住 6% 的转人工率。所以这个系统真正的瓶颈有两个:模型额度和人工坐席。后者很多设计会忽略。」

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="十万并发客服 Agent 架构:接入层、会话服务、分诊小模型、Agent 工作者、模型网关、人工排队">
<rect x="10" y="105" width="90" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="55" y="127" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">接入层</text>
<text x="55" y="144" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">SSE 长连接</text>
<rect x="125" y="105" width="100" height="50" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="175" y="127" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">会话服务</text>
<text x="175" y="144" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">状态在 Redis</text>
<rect x="250" y="30" width="125" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="312" y="52" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">分诊小模型</text>
<text x="312" y="69" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">吃掉 65%(假设)</text>
<rect x="250" y="105" width="125" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="312" y="127" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Agent 工作者</text>
<text x="312" y="144" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">无状态,水平扩</text>
<rect x="250" y="180" width="125" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="312" y="202" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">工具和知识库</text>
<text x="312" y="219" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">订单只读副本</text>
<rect x="400" y="105" width="110" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="455" y="127" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型网关</text>
<text x="455" y="144" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5 个账号+缓存</text>
<rect x="535" y="75" width="95" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="582" y="100" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">供应商 A/B</text>
<rect x="535" y="145" width="95" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="582" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">自部署池</text>
<rect x="110" y="195" width="125" height="50" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="172" y="217" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">人工排队</text>
<text x="172" y="234" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">上限 6% 转人工率</text>
<line x1="100" y1="130" x2="125" y2="130" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="225" y1="130" x2="250" y2="130" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="225" y1="120" x2="250" y2="60" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="312" y1="155" x2="312" y2="180" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="375" y1="130" x2="400" y2="130" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="510" y1="122" x2="535" y2="97" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="510" y1="138" x2="535" y2="163" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="175" y1="155" x2="172" y2="195" stroke="var(--compute)" stroke-width="1.5" stroke-dasharray="4 3"/>
</svg>
<figcaption>真题二的架构。分诊小模型、5 个账号的网关、人工排队上限,三处都是从上面两个脚本的输出推出来的。</figcaption>
</figure>

### 深挖:三个点

**深挖一:流量分层。** 就是上面的分诊。要讲清两种做法:规则加关键词(便宜,但「我的快递三天没动了是不是丢了」这种会被误判成查物流),还是小模型分类(准,但要训练和部署)。我的选择是小模型分类加一个置信度阈值,低于阈值的走大模型,[Day 578](/blog/agent-zero/day-578-distill-2/) 讲过怎么画阈值曲线选这个值。代价是要维护一个模型;推翻条件是去年大促日志显示高频问题占比不到四成,分诊省下的钱覆盖不了它的成本。

**深挖二:转人工的容量。** 上面算过了。要补一句设计:转人工请求进排队,排队长度和预计等待时间实时推给前端,超过阈值时 Agent 主动提供「留言回电」。

**深挖三:降级策略。** 供应商限流或者故障时,按顺序一级级降:

| 级别 | 触发条件(示例) | 做什么 | 用户看到什么 |
| --- | --- | --- | --- |
| 1 | 主供应商 429 比例超过 5% | 流量切到备用账号和备用供应商 | 基本无感 |
| 2 | 整体 P95 首字超过 3 秒 | 关掉回答后的自检步骤,每条少调一次模型 | 回答略粗糙 |
| 3 | 大模型可用容量不到需求一半 | 分诊阈值调低,更多问题走小模型模板 | 复杂问题答得笼统 |
| 4 | 大模型基本不可用 | 只回答模板能答的,其余进人工排队或留言 | 明确提示稍后处理 |

触发条件里的数字是示例,面试时说清楚「每一级都写成指标阈值,自动触发,不靠人半夜判断」。降级的思路和 [Day 642](/blog/agent-zero/day-642-staff-sd-1/) 网关的紧急旁路是一回事:先想好最坏情况下系统长什么样,再往回设计。

### 评测、风险和演进

上线前拿去年大促的会话回放做压测和质量评测;上线按流量 1%、10%、50% 灰度。灰度时盯的叫**护栏指标**(guardrail metric):不是你要优化的目标,而是一旦变坏就要回滚的指标。这里是转人工率、用户重复提问率、差评率。退款这类写操作一律要用户确认,防止批量错误退款这种一次就是几百万的事故。

演进:第一期只覆盖物流和退换货两类高频问题;第二期扩到售前咨询;第三期做语音渠道。

最后两分钟总结:「这个系统决定架构的是两个数:3.3 万个在途模型请求和每小时 14 万的成本,所以分诊小模型、多账号网关和前缀缓存是上线前提;第二个瓶颈是人工坐席,只扛得住 6% 的转人工率,所以排队和降级要从第一天就设计进去。」

## 真题三:设计代码 Agent 的评测体系

**题目(大致原话)**:公司内部有一个代码 Agent,能根据 issue 改代码并提 MR(合并请求,GitHub 上叫 PR)。设计一套评测体系,让团队知道每次改动是变好了还是变差了。

这道题没有大流量,估算不是重点。它考的是评测科学,也就是你在 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 到 [Day 550](/blog/agent-zero/day-550-eval-stats-4/) 学的那几天。很多候选人的答案是「建一个测试集,每次跑一下看分数」,这在 Staff 面试里是不及格的。

### 需求:评测给谁看

先问:评测的用户是谁?如果是 Agent 团队自己(每次改提示词、换模型都要回归),要的是快、稳定、能定位问题;如果是管理层(决定要不要推广到全公司),要的是和业务结果挂钩。两者的指标不一样,我会说「我先设计团队自用的离线评测,再接上给管理层看的线上指标」。

### 评测集怎么构造

- **从内部仓库的历史里挖。** 找「一个 issue + 修复它的 MR + MR 里带了新测试」的组合。修复前的代码当起点,MR 里新加的测试当判定标准。这就是 [Day 558](/blog/agent-zero/day-558-bench-1/) 拆解过的 SWE-bench 的思路,搬到公司内部。
- **人工筛一遍。** SWE-bench 后来出了一个 Verified 子集,就是因为原始数据里很多任务的 issue 描述不清、或者测试和 issue 对不上。内部数据一样要筛:描述够不够、测试是不是只测这一个修复、环境能不能稳定复现。
- **防污染。** **数据污染**指评测任务出现在了训练数据、提示词示例或者检索库里,分数虚高。按时间切是最简单的办法:只用某个日期之后合并的 MR 做评测集,并且检索库里排除这些 MR。
- **起步不用太大。** Anthropic 2026 年 1 月那篇《Demystifying evals for AI agents》的建议是从真实失败里挑 20 到 50 个简单任务就是很好的开始。先有一个小而准的集,比一开始就追求几百个更重要。

### 判定和指标:pass@k 和 pass^k

这是今天的第二个新概念。代码 Agent 同一个任务跑两次,结果可能不一样,这是 [Day 549](/blog/agent-zero/day-549-eval-stats-3/) 说的「Agent 自己在抖」。所以一个任务不能只跑一次,要跑 n 次,然后看两个数:

- **pass@k**:在 k 次尝试里**至少成功一次**的概率。它回答「这个 Agent 有没有能力做出来」。
- **pass^k**(读作 pass hat k):k 次尝试**全部成功**的概率。它回答「这个 Agent 靠不靠得住」。这个指标是 τ-bench 论文提出来的,对要上生产的 Agent 更重要:用户不会让你重试五次挑一个好的。

假设每个任务跑了 n 次,成功 c 次。用这 n 次去估 k 次的情况,公式是组合数(从 n 个里选 k 个的选法数,写作 C(n, k)):pass@k = 1 − C(n−c, k) / C(n, k),意思是「随机挑 k 次全失败的概率」取反;pass^k = C(c, k) / C(n, k),意思是「随机挑 k 次全成功的概率」。前者来自 OpenAI 2021 年的 Codex 论文。直觉比公式重要,看代码和数字:

```python
# agent-zero-lab/part10/passk.py
from math import comb

def pass_at_k(n: int, c: int, k: int) -> float:
    if n - c < k:
        return 1.0
    return 1 - comb(n - c, k) / comb(n, k)

def pass_hat_k(n: int, c: int, k: int) -> float:
    return comb(c, k) / comb(n, k)

TASKS = {"改日期格式": 10, "修分页越界": 7, "加缓存失效": 3}  # 每个任务跑 10 次,成功几次
N = 10

if __name__ == "__main__":
    for k in (1, 3, 5):
        at = sum(pass_at_k(N, c, k) for c in TASKS.values()) / len(TASKS)
        hat = sum(pass_hat_k(N, c, k) for c in TASKS.values()) / len(TASKS)
        print(f"k={k}:pass@k {at:.2f}   pass^k {hat:.2f}")
    for name, c in TASKS.items():
        print(f"{name}:10 次成功 {c} 次,pass^5 = {pass_hat_k(N, c, 5):.3f}")
```

<div class="line-notes">

- `from math import comb` `comb(n, k)` 算组合数,从 n 个里选 k 个有几种选法。`comb(10, 3) = 120`。JS 没有内置,要自己写。
- `if n - c < k:` 失败的次数比 k 还少,随便挑 k 次都至少挑到一次成功,概率是 1。不加这个判断,`comb` 会返回 0,结果也是 1,但写出来读者更容易看懂。
- `return 1 - comb(n - c, k) / comb(n, k)` 代入「修分页越界」,n=10、c=7、k=3:3 次失败里挑 3 次的选法是 `comb(3, 3) = 1`,总选法 `comb(10, 3) = 120`,全失败的概率 1/120,pass@3 ≈ 0.992。
- `return comb(c, k) / comb(n, k)` 代入同一个任务,k=5:7 次成功里挑 5 次的选法 `comb(7, 5) = 21`,总选法 `comb(10, 5) = 252`,pass^5 = 21/252 ≈ 0.083。
- `TASKS = {"改日期格式": 10,` 三个虚构的任务,各跑 10 次,分别成功 10、7、3 次。一个稳的,一个大多数时候行的,一个偶尔行的。
- `at = sum(pass_at_k(N, c, k) for c in TASKS.values()) / len(TASKS)` 每个任务算一个值,再对任务取平均,得到整个评测集的 pass@k。
- `for name, c in TASKS.items():` 最后逐个任务看 pass^5,解释平均值背后是什么。

</div>

```bash
uv run python -m part10.passk
```

```text
k=1:pass@k 0.67   pass^k 0.67
k=3:pass@k 0.90   pass^k 0.43
k=5:pass@k 0.97   pass^k 0.36
改日期格式:10 次成功 10 次,pass^5 = 1.000
修分页越界:10 次成功 7 次,pass^5 = 0.083
加缓存失效:10 次成功 3 次,pass^5 = 0.000
```

k=1 时两个指标相等,都是平均成功率 `(10 + 7 + 3) / 30 = 0.67`。k 一变大,两条线往相反方向走:pass@5 涨到 0.97,看起来这个 Agent 几乎什么都能做;pass^5 掉到 0.36,意思是连续用五次都靠谱的概率只有三成多。

最该看的是第二个任务。10 次成功 7 次,单看成功率 70% 好像还行,pass^5 只有 0.083。如果这是一个每天要跑几十次的自动化任务,用户几乎每天都会遇到失败。**汇报给团队的数字用 pass@k 会好看很多,但决定能不能上生产的应该是 pass^k。** 面试里把这一层讲出来,通常是加分很多的地方。

除了这两个,完整的指标还有三类:任务解决率之外的**成本和效率**(每个任务的 token 成本、工具调用次数、耗时);**过程质量**(改动行数合不合理、有没有动了不该动的文件,用规则检查;代码风格用 linter);**线上指标**(MR 被合并的比例、合并后被回滚的比例、人工 review 时改了多少行、开发者采纳率)。离线分数和线上指标要定期对照,两者脱节,说明评测集该更新了。

### 统计:两个版本到底谁好

团队改了一版提示词,评测集 300 个任务,老版本 52%,新版本 58%,涨了 6 个点。这是真的变好了,还是运气?

你在 [Day 548](/blog/agent-zero/day-548-eval-stats-2/) 学过配对比较:两个版本跑的是**同一批**任务,所以应该逐题比较,而不是把两个百分比当成两组独立样本。这里用最简单的一种配对检验,叫**符号检验**(sign test):只看两个版本结果不一样的那些题,如果新版本没有真的变好,「只有新版做对」和「只有老版做对」的题数应该差不多,像抛硬币;差得越多,越不像运气。我们用模拟数据看看两种比法差多少:

```python
# agent-zero-lab/part10/paired.py
import random
from math import comb, sqrt

random.seed(644)
N = 300
# 每个任务有自己的难度:三成很容易,三成基本做不出,四成看运气
difficulty = [random.choice([0.95] * 3 + [0.05] * 3 + [0.5] * 4) for _ in range(N)]
a = [random.random() < p for p in difficulty]                       # 基线版本
b = [random.random() < min(p + 0.08, 1.0) for p in difficulty]      # 新版本:每题成功率高 8 个点

pa, pb = sum(a) / N, sum(b) / N
se = sqrt(pa * (1 - pa) / N + pb * (1 - pb) / N)
print(f"A 通过 {sum(a)}/{N} = {pa:.1%},B 通过 {sum(b)}/{N} = {pb:.1%},差 {pb - pa:+.1%}")
print(f"当成两组独立样本:95% 区间 {pb - pa - 1.96 * se:+.1%} ~ {pb - pa + 1.96 * se:+.1%}")

only_b = sum(1 for x, y in zip(a, b) if y and not x)
only_a = sum(1 for x, y in zip(a, b) if x and not y)
n = only_b + only_a
p_value = 2 * sum(comb(n, i) for i in range(min(only_a, only_b) + 1)) / 2 ** n
print(f"配对看:只有 B 做对 {only_b} 题,只有 A 做对 {only_a} 题,其余 {N - n} 题两边一样")
print(f"符号检验双侧 p = {min(p_value, 1.0):.3f}")
```

<div class="line-notes">

- `random.seed(644)` 固定种子,结果可复现。这是一次模拟,换个种子数字会变,练习 3 会看换 200 个种子的情况。
- `difficulty = [random.choice([0.95] * 3 + [0.05] * 3 + [0.5] * 4) for _ in range(N)]` 给每个任务随机一个「基线版本的成功概率」。`[0.95] * 3 + [0.05] * 3 + [0.5] * 4` 是一个 10 个元素的列表,`random.choice` 从里面随机挑一个,所以 30% 的任务很容易、30% 几乎做不出、40% 一半一半。真实评测集也是这样,任务难度差别很大,这正是配对比较有用的原因。`_` 表示循环变量用不到。
- `a = [random.random() < p for p in difficulty]` `random.random()` 给 0 到 1 之间的随机小数,小于 p 就算这题做对。得到 300 个 True/False。
- `b = [random.random() < min(p + 0.08, 1.0) for p in difficulty]` 新版本每题成功率加 8 个点,但不超过 1。注意 A 和 B 用的是同一个 `difficulty`,这就是「同一批任务」。
- `se = sqrt(pa * (1 - pa) / N + pb * (1 - pb) / N)` 把两个通过率当成两组独立样本时,差值的标准误。[Day 547](/blog/agent-zero/day-547-eval-stats-1/) 讲过单个通过率的标准误,两组独立时方差相加再开根号。
- `print(f"当成两组独立样本:95% 区间 {pb - pa - 1.96 * se:+.1%}` 差值 ±1.96 倍标准误。`:+.1%` 让正数也带上加号。
- `only_b = sum(1 for x, y in zip(a, b) if y and not x)` 逐题配对,数「B 对 A 错」的题。`zip(a, b)` 把两个列表按位置配成对。
- `only_a = sum(1 for x, y in zip(a, b) if x and not y)` 数「A 对 B 错」的题。两边一样的题(都对或都错)对判断谁好没有信息,符号检验直接丢掉。
- `p_value = 2 * sum(comb(n, i) for i in range(min(only_a, only_b) + 1)) / 2 ** n` 假设两个版本其实一样好,那 n 道不一样的题里,每道是「B 赢」还是「A 赢」就像抛硬币。p 值是「抛 n 次硬币,少的一面出现次数不超过 `min(only_a, only_b)` 次」的概率再乘 2(两个方向都算)。`2 ** n` 是 2 的 n 次方,≈ JS 的 `2 ** n`,写法一样。代入 n=77、少的一边 29:算出来 0.040。
- `min(p_value, 1.0)` 两边题数相等时乘 2 会超过 1,截到 1。

</div>

```bash
uv run python -m part10.paired
```

```text
A 通过 156/300 = 52.0%,B 通过 175/300 = 58.3%,差 +6.3%
当成两组独立样本:95% 区间 -1.6% ~ +14.3%
配对看:只有 B 做对 48 题,只有 A 做对 29 题,其余 223 题两边一样
符号检验双侧 p = 0.040
```

同一份数据,两种比法得出相反的结论。当成独立样本,95% 区间是 −1.6% 到 +14.3%,包含 0,结论是「说不清有没有变好」。配对看,300 题里 223 题两个版本结果一样(要么都很容易、要么都做不出),真正有信息的是剩下 77 题:B 赢 48 题、A 赢 29 题,p = 0.040,小于常用的 0.05,结论是「大概率真的变好了」。

原因是那 223 道两边一样的题。独立样本的算法把它们的随机性也算进了误差里,误差被放大;配对只看有差别的题,把「任务难度不同」这个噪声消掉了。**在面试里说出「两个版本跑的是同一批任务,要用配对比较,而不是比两个百分比」,大多数候选人做不到这一步。**

这里有两点要诚实交代。这个例子是模拟的,我设定了真实提升 8 个点,是知道答案再去验证方法;真实场景你不知道真实提升是多少。另外 p = 0.040 也只是这一次随机的结果,换个种子可能是 0.08,练习 3 会看这件事。所以 [Day 550](/blog/agent-zero/day-550-eval-stats-4/) 讲样本量时说过:评测集多大、要检测多大的提升,事先就要算,不能跑完看 p 值碰运气。

### 基础设施和演进

每个任务要一个隔离的沙箱,一般是容器,要能并行跑几百个;依赖环境的构建要缓存,不然每个任务装一遍依赖要十分钟;测试里有 flaky 的(时好时坏,和改动无关)要识别出来剔除,否则评测分数自己就在抖。

演进:先用 50 个人工精选的任务做冒烟集,每次改动都跑;再扩到 300 个做每日回归,每题跑 5 次,同时报 pass@1 和 pass^5;最后接上线上指标做季度评审。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="代码 Agent 评测体系的三层:冒烟集、每日回归、线上指标">
<rect x="20" y="30" width="180" height="150" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="54" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">冒烟集 50 题</text>
<text x="32" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">人工精选</text>
<text x="32" y="100" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每次改动都跑</text>
<text x="32" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">几分钟出结果</text>
<text x="32" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">挡住明显回退</text>
<rect x="230" y="30" width="180" height="150" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="54" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">每日回归 300 题</text>
<text x="242" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">按日期切,防污染</text>
<text x="242" y="100" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每题 5 次</text>
<text x="242" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">pass@1 + pass^5</text>
<text x="242" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">配对比较定输赢</text>
<rect x="440" y="30" width="180" height="150" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="530" y="54" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">线上指标</text>
<text x="452" y="80" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">MR 合并率</text>
<text x="452" y="100" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">合并后回滚率</text>
<text x="452" y="120" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">review 改动行数</text>
<text x="452" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">季度和离线对照</text>
<line x1="200" y1="105" x2="230" y2="105" stroke="var(--ink-soft)" stroke-width="1.5"/>
<line x1="410" y1="105" x2="440" y2="105" stroke="var(--ink-soft)" stroke-width="1.5"/>
<text x="320" y="210" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">从左到右:越来越慢,越来越贴近真实结果</text>
</svg>
<figcaption>真题三的评测体系分三层。左边快而粗,右边慢而真,中间那层是统计方法起作用的地方。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1mCrCBTEhm&autoplay=0&high_quality=1" title="驯服随机性:Agent 评估中的 Pass@k 与 Pass^k" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>慢学AI · 驯服随机性:Agent 评估中的 Pass@k 与 Pass^k:Anthropic《Demystifying evals for AI agents》③ · 5 分钟,把 Anthropic 那篇文章里讲这两个指标的部分讲成中文,和 passk.py 的输出对照着看。</figcaption>
</figure>

## 追问清单:每条准备 30 秒

两道题讲完,面试官会往深挖。我按出现频率整理了八条,其中最后两条是 Staff 面试特别爱问的:

1. 如果流量突然涨到 10 倍,哪个组件先扛不住?
2. 如果主力模型供应商宕机两小时,用户看到的是什么?
3. 怎么知道这个 Agent 上线后比原来好?好多少算显著?
4. 一个提示词改动,怎么保证没有让某类小众问题变差?
5. 有人通过用户输入注入指令,让 Agent 调用了不该调的工具,你的设计在哪一层挡住?
6. 这个系统一个月花多少钱?哪一项占大头?怎么砍一半?
7. 如果只有两个人、一个月时间,你先做哪一部分?
8. 这个架构一年后最可能需要推翻的是哪个决定?

第 7 条考你在资源约束下做取舍,[Day 642](/blog/agent-zero/day-642-staff-sd-1/) 自测第 5 题答过一个示范。第 8 条考你对自己方案的诚实程度,回答「我觉得没有需要推翻的」基本等于失分。

一个好的 30 秒回答,我的标准是三样东西都有:**具体的数字或机制、代价、边界**(在什么条件下这个回答不成立)。比如第 2 条,「切到备用供应商」只有机制的名字。好一点的回答是:「网关检测到主供应商 429 或超时比例超过 5% 就自动切备用账号和备用供应商;备用模型的提示词提前评测过,质量会掉几个点,所以退款这类写操作在切换期间一律进人工;备用账号只够撑六成流量,剩下的按降级表第 3 级走小模型模板。」

光看我写的不够,要自己练。下面这个脚本从八条里随机抽两条问你,你在终端里打字回答,模型按三样东西打分。`part10/drill.py`,用 [Day 136](/blog/agent-zero/day-136-llm-client-2/) 的 `LLMClient`:

```python
# agent-zero-lab/part10/drill.py
import json
import random
import sys

from common.llm import LLMClient

QUESTIONS = [
    "如果流量突然涨到 10 倍,哪个组件先扛不住?",
    "如果主力模型供应商宕机两小时,用户看到的是什么?",
    "怎么知道这个 Agent 上线后比原来好?好多少算显著?",
    "一个提示词改动,怎么保证没有让某类小众问题变差?",
    "有人通过用户输入注入指令,让 Agent 调用了不该调的工具,你的设计在哪一层挡住?",
    "这个系统一个月花多少钱?哪一项占大头?怎么砍一半?",
    "如果只有两个人、一个月时间,你先做哪一部分?",
    "这个架构一年后最可能需要推翻的是哪个决定?",
]
GRADER = """你是 Staff 级系统设计面试官。题目背景:大促期间十万并发会话的客服 Agent。
候选人用 30 秒回答了一个追问。按三条打分:有没有具体数字或机制、有没有说代价、有没有说清边界。
只输出 JSON:{"score": 1到3的整数, "missing": "最缺的一点,一句话"}"""

if len(sys.argv) > 1:
    random.seed(int(sys.argv[1]))
llm = LLMClient()
for q in random.sample(QUESTIONS, 2):
    print("追问:", q)
    answer = input("你:")
    r = llm.chat(
        [{"role": "system", "content": GRADER},
         {"role": "user", "content": f"追问:{q}\n回答:{answer}"}],
        temperature=0, response_format={"type": "json_object"},
    )
    verdict = json.loads(r.content)
    print(f"\n  {verdict['score']} 分,缺:{verdict['missing']}")
print(llm.ledger)
```

<div class="line-notes">

- `QUESTIONS = [` 八条追问原样放进列表。你可以往里加自己面试时被问到的。
- `GRADER = """你是 Staff 级系统设计面试官。` 系统提示词。把打分标准写死成三条,模型的打分会比「你觉得这个回答怎么样」稳定得多。
- `只输出 JSON:{"score": 1到3的整数, "missing": "最缺的一点,一句话"}` 这里没用 `.format()`,所以花括号不用写成双的。Day 640 的 `review_bot.py` 用了 `.format()`,才需要 `{{ }}`。
- `if len(sys.argv) > 1:` 命令行传了一个数字就拿它当随机种子,同一个种子抽到的题一样,方便我下面验证;平时练习不传,每次抽到的不一样。
- `for q in random.sample(QUESTIONS, 2):` `random.sample` 从列表里不重复地随机抽 2 个,≈ 先洗牌再取前两个。
- `answer = input("你:")` 在终端里等你打一行字回车,≈ Node 的 `readline.question`。
- `{"role": "user", "content": f"追问:{q}\n回答:{answer}"}` 每道题单独打分,不带上一题的历史,两题互不影响。
- `temperature=0, response_format={"type": "json_object"},` 打分要稳定、要机器可读。提示词里有「JSON」字样,满足 DeepSeek 对 JSON mode 的要求。
- `verdict = json.loads(r.content)` 解析成字典,`verdict['score']` 是分数。
- `print(f"\n  {verdict['score']} 分,缺:{verdict['missing']}")` 前面加个换行,因为管道输入时「你:」后面不会换行。

</div>

为了验证代码能跑,我用种子 7 抽题,用 `printf` 把两行预先写好的回答从管道喂给 `input()`。第一行是一个认真的回答,第二行故意只写了机制名字:

```bash
printf '全量走大模型每小时约 14 万,大头是输入未命中的部分。砍一半靠两招:小模型分诊吃掉 65%% 流量,前缀缓存命中从 50%% 提到 70%%,算下来到每小时 3.7 万左右,代价是自部署小模型要 GPU 和一个人维护。\n切到备用供应商。\n' | uv run python -m part10.drill 7
```

```text
追问: 这个系统一个月花多少钱?哪一项占大头?怎么砍一半?
你:
  3 分,缺:无
追问: 如果主力模型供应商宕机两小时,用户看到的是什么?
你:
  1 分,缺:没有说明切换机制(健康检查、超时阈值、降级路由)、切换期间的代价(会话上下文丢失、延迟上升、备用模型质量下降)以及边界(备用容量能撑多少并发、两小时是否够)
2 次调用 | 输入 321 / 输出 70 tokens | 约 ¥0.0012
```

两次调用 ¥0.0012,算式 `321 × 2 + 70 × 8 = 1202`,除以一百万(没命中缓存,按 deepseek-flash 高峰价)。

第二题 1 分,模型列出的三样缺失正好对应三条标准,这一点它做得不错。但第一题有个它没发现的问题:**题目问的是「一个月花多少钱」,我答的是「每小时」。** 大促和平时的流量差几十倍,把高峰小时成本乘以 720 得到的月成本是错的,真正的回答要分「大促 10 个高峰小时」和「平时」两部分算。模型给了满分,说明它在按关键词打分,没在核对题意。和 [Day 642](/blog/agent-zero/day-642-staff-sd-1/) 的模拟面试官一样,这个工具的用处是找出明显缺了什么,不是给你一个准确的分数;题意有没有答准,得你自己回头对。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV16s9qBuEo8&autoplay=0&high_quality=1" title="面试官问:Agent Benchmark 怎么造?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI深度幻觉 · 面试官问:Agent Benchmark 怎么造? · 7 分钟,一个国内面试里的真实追问。听完对照真题三,看它讲到了评测集构造的哪几条、漏了哪几条(提示:防污染和配对比较)。</figcaption>
</figure>

## 今天的文件

| 文件 | 干什么 | 花钱吗 |
| --- | --- | --- |
| `part10/estimate_cs.py` | 真题二的 QPS、在途请求、账号数、小时成本,以及分诊和缓存的效果 | 不花 |
| `part10/handoff.py` | 用利特尔定律算人工坐席能扛的转人工率 | 不花 |
| `part10/passk.py` | pass@k 和 pass^k 的无偏估计 | 不花 |
| `part10/paired.py` | 同一份模拟数据,独立样本区间和配对符号检验的对比 | 不花 |
| `part10/drill.py` | 随机抽两条追问,模型按三条标准打分 | 两次共 ¥0.0012 |
| `part10/ex644_*.py`(练习) | 练习 1 到 3 的参考答案 | 不花 |

## 动手练习

**练习 1:重算真题二。** 换一组假设:用户 20 秒发一条、每条 3 次模型调用、输入 4000 token,其他不变。算出全量走大模型时的在途请求、账号数和每小时成本;再算分诊吃掉 65%、缓存命中 70% 时的情况。成本降了几成?

<details><summary>参考答案</summary>

不用改 `estimate_cs.py` 本身,写一个小脚本把它的常量改掉再调 `plan`:

```python
# agent-zero-lab/part10/ex644_recalc.py
from part10 import estimate_cs as e

e.MSG_INTERVAL_S = 20
e.CALLS_PER_MSG = 3
e.IN_TOKENS = 4000

print(f"用户消息 {e.SESSIONS / e.MSG_INTERVAL_S:,.0f} 条/秒")
e.plan(big_share=1.0, hit_rate=0.5)
e.plan(big_share=0.35, hit_rate=0.7)
```

<div class="line-notes">

- `from part10 import estimate_cs as e` 把整个模块导入并起个短名字 `e`,≈ JS 的 `import * as e from "./estimate_cs"`。
- `e.MSG_INTERVAL_S = 20` 直接改模块里的全局变量。`plan` 和 `per_call` 每次调用时才去读这些变量,所以改完再调就用新值。这种写法在练习里图省事可以,正式代码里我会把假设做成参数或 dataclass,像 Day 641 的 `Assumptions` 那样。
- `e.IN_TOKENS = 4000` `per_call` 里读的是 `IN_TOKENS`,改了它,单价跟着变:`2000×0.04 + 2000×2 + 200×8 = 5680`,¥0.00568 一次。

</div>

```bash
uv run python -m part10.ex644_recalc
```

```text
用户消息 5,000 条/秒
大模型承担 100%、缓存命中 50%:15,000 QPS,在途 60,000,要 24 个账号,每小时 ¥306,720
大模型承担 35%、缓存命中 70%:5,250 QPS,在途 21,000,要 9 个账号,每小时 ¥77,717
```

全量时每小时 30.7 万,分诊加缓存后 7.8 万,降了约 75%。和正文那组数比,消息速率涨 1.5 倍、调用次数涨 1.2 倍、单价涨约 22%,三个乘在一起成本翻了一倍多。面试官换一组数字让你重算是常见操作,这时候脚本没用,要能口算:先算消息速率,乘调用次数,乘耗时得在途,乘单价乘 3600 得小时成本。

</details>

**练习 2:算一个更真实的月成本。** 用正文那组数(分诊 65%、缓存 70% 后每小时 ¥36,582),假设大促有 3 天、每天 10 个高峰小时;平时流量是大促高峰的 5%,一个月 30 天、每天 24 小时都按平时算(大促那 3 天的非高峰时段也按平时)。算出这个月的总模型费,以及大促 30 个小时占了多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex644_month.py
PEAK_HOURLY = 36_582      # 正文 estimate_cs.py 第三行的输出
PEAK_HOURS = 3 * 10       # 假设:大促 3 天,每天 10 个高峰小时
NORMAL_SHARE = 0.05       # 假设:平时流量是高峰的 5%
NORMAL_HOURS = 30 * 24 - PEAK_HOURS

peak = PEAK_HOURLY * PEAK_HOURS
normal = PEAK_HOURLY * NORMAL_SHARE * NORMAL_HOURS
print(f"大促 {PEAK_HOURS} 小时:¥{peak:,.0f}")
print(f"平时 {NORMAL_HOURS} 小时:¥{normal:,.0f}")
print(f"合计 ¥{peak + normal:,.0f},大促占 {peak / (peak + normal):.0%}")
print(f"如果直接用高峰小时 × 720:¥{PEAK_HOURLY * 720:,.0f}")
```

<div class="line-notes">

- `NORMAL_HOURS = 30 * 24 - PEAK_HOURS` 一个月 720 小时,扣掉 30 个高峰小时,剩 690 个。
- `normal = PEAK_HOURLY * NORMAL_SHARE * NORMAL_HOURS` 平时每小时按高峰的 5% 算:`36,582 × 0.05 × 690`。这里假设成本和流量成正比,分诊比例和缓存命中率平时也一样。
- `print(f"如果直接用高峰小时 × 720:` 这就是 drill.py 里我那个回答的错误算法,打出来对比。

</div>

```bash
uv run python -m part10.ex644_month
```

```text
大促 30 小时:¥1,097,460
平时 690 小时:¥1,262,079
合计 ¥2,359,539,大促占 47%
如果直接用高峰小时 × 720:¥26,339,040
```

一个月约 236 万,大促 30 个小时占了将近一半。直接用高峰小时乘 720 得到 2,634 万,高估了 11 倍。所以面试官问「一个月花多少」时,第一句应该是「分大促和平时两部分算」。另一个有意思的结论是,平时那 690 个小时加起来比大促还贵,所以「平时用便宜模型、大促才扩容」这类策略也值得提。

</details>

**练习 3:配对比较是不是每次都赢?** `paired.py` 只跑了一个种子。写 `part10/ex644_seeds.py`,用种子 0 到 199 各模拟一次(真实提升都是 8 个点),数一数「独立样本区间不含 0」和「配对符号检验 p < 0.05」各发生了多少次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex644_seeds.py
import random
from math import comb, sqrt

def trial(seed: int, n: int = 300, lift: float = 0.08) -> tuple[bool, bool]:
    random.seed(seed)
    diff = [random.choice([0.95] * 3 + [0.05] * 3 + [0.5] * 4) for _ in range(n)]
    a = [random.random() < p for p in diff]
    b = [random.random() < min(p + lift, 1.0) for p in diff]
    pa, pb = sum(a) / n, sum(b) / n
    se = sqrt(pa * (1 - pa) / n + pb * (1 - pb) / n)
    unpaired = pb - pa - 1.96 * se > 0
    only_b = sum(1 for x, y in zip(a, b) if y and not x)
    only_a = sum(1 for x, y in zip(a, b) if x and not y)
    m = only_a + only_b
    p = 2 * sum(comb(m, i) for i in range(min(only_a, only_b) + 1)) / 2 ** m
    return unpaired, p < 0.05

if __name__ == "__main__":
    runs = [trial(s) for s in range(200)]
    print("200 次模拟,真实提升 8 个点:")
    print(f"  独立样本区间不含 0 的次数 {sum(u for u, _ in runs)}")
    print(f"  配对符号检验 p<0.05 的次数 {sum(p for _, p in runs)}")
```

<div class="line-notes">

- `def trial(seed: int, n: int = 300, lift: float = 0.08) -> tuple[bool, bool]:` 把 `paired.py` 包成一个函数,返回两个布尔值:独立样本法有没有判定显著、配对法有没有判定显著。
- `unpaired = pb - pa - 1.96 * se > 0` 区间下界大于 0,就是区间不含 0。只看「新版更好」这一个方向。
- `return unpaired, p < 0.05` 返回元组,≈ JS 返回 `[a, b]`。
- `runs = [trial(s) for s in range(200)]` 200 个种子各跑一次。
- `sum(u for u, _ in runs)` 解构每个元组,只取第一个值求和,True 当 1 算。

</div>

```bash
uv run python -m part10.ex644_seeds
```

```text
200 次模拟,真实提升 8 个点:
  独立样本区间不含 0 的次数 74
  配对符号检验 p<0.05 的次数 121
```

真实提升明明是 8 个点,独立样本法 200 次里只有 74 次(37%)看出来了,配对法 121 次(61%)。配对法强得多,但也远不是每次都能看出来:300 题、8 个点的提升,有四成的概率配对法也会说「不显著」。这个比例在统计里叫**检验功效**,[Day 550](/blog/agent-zero/day-550-eval-stats-4/) 讲样本量时算过。面试里这能接着往下讲:「如果团队想稳定地检测出 5 个点的提升,300 题不够,要么扩大评测集,要么每题多跑几次降低 Agent 自身的抖动。」

</details>

**练习 4:准备你自己的追问回答。** 从八条追问里挑三条,按「数字或机制、代价、边界」三样写成 30 秒的回答,用 `drill.py` 打分。至少有一条要拿到 3 分,并且自己检查一遍是否答准了题意(像正文那条「每小时」答成「每月」的错误)。

<details><summary>参考答案</summary>

给一个第 8 条的示范回答,对应真题二:

「一年后最可能推翻的是分诊小模型。我现在选它,是因为大模型按 deepseek-flash 价格每小时要 14 万、单账号并发只有 2500。如果一年后大模型价格再降一个数量级、或者供应商给到十万级并发,分诊省下的钱可能抵不过维护一个小模型的人力,那时就该把分诊撤掉,全部走大模型,把精力放到回答质量上。我会每季度用当时的价格重跑一次估算脚本来判断。」

它有数字(14 万、2500)、有代价(维护小模型的人力)、有边界(价格降一个数量级或并发到十万级)。拿它去跑 `drill.py` 时,把 `random.sample(QUESTIONS, 2)` 临时改成 `[QUESTIONS[7]]` 就能只抽这一条。

</details>

**验收标准**:六个脚本都跑出和文中一致的结果(模型输出允许不同);两道真题各计时讲一遍,有录音或文字稿;能不看稿说出真题二的两个决定架构的数和人工 6% 的上限是怎么算的;能用三条任务的例子讲清 pass@k 和 pass^k 的差别;追问清单里至少三条有自己写的 30 秒回答。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| TTFT / 首字延迟 | 用户发完消息到看到第一个字的时间,Day 133 量过,真题二要求 P95 小于 2 秒 |
| 分诊(triage) | 先用便宜的手段判断请求类型,把简单请求分流出去,真题二假设吃掉 65% |
| 转人工容量 | 人工坐席同时能接的会话数,用利特尔定律换算成能扛的最高转人工率,真题二是 6% |
| 降级 | 系统部分不可用时按预定顺序关闭功能,保住核心体验,每一级有自动触发的指标阈值 |
| 护栏指标 | 灰度时一旦变坏就回滚的指标,不是要优化的目标,比如转人工率、差评率 |
| 数据污染 | 评测任务出现在训练数据、提示词示例或检索库里,导致分数虚高 |
| pass@k | k 次尝试里至少成功一次的概率,衡量「有没有能力做出来」 |
| pass^k | k 次尝试全部成功的概率,衡量「靠不靠得住」,τ-bench 提出 |
| 组合数 C(n, k) | 从 n 个里选 k 个的选法数,Python 里是 `math.comb` |
| 符号检验 | 最简单的配对检验:只看两个版本结果不同的题,像抛硬币一样检验谁赢得多 |
| 检验功效 | 真实存在某个提升时,检验能把它看出来的概率,练习 3 里配对法约 61% |
| flaky 测试 | 时好时坏、和代码改动无关的测试,要从评测集里剔除 |

## 常见误区

**把十万并发当成普通后端的十万并发。** 普通后端的瓶颈是连接数和数据库,Agent 的瓶颈是模型额度和成本。一上来就画分库分表,说明你没意识到 3.3 万个在途模型请求意味着什么。

**按「同时在线」直接乘转人工率。** 10 万在线乘 15% 等于 1.5 万,这个数没有意义。转人工的是新进会话的一部分,人工还有自己的处理时长,要用利特尔定律算两次。

**降本只想着换便宜模型。** 真题二里分诊把成本砍掉 65%,缓存又砍掉四分之一,两招都不换模型。而且换模型要重新评测,大促前没时间。

**评测只报 pass@k。** pass@5 = 0.97 很好看,pass^5 = 0.36 才是用户每天的体验。要上生产,报 pass^k。

**两个版本比百分比。** 同一批任务上跑出来的两个结果,当成独立样本比,会把任务难度的噪声算进误差。正文那份数据,独立样本说「不确定」,配对说「大概率变好了」。

**看到 p < 0.05 就宣布胜利。** 练习 3 里,同样是真实提升 8 个点,配对法也只有六成的概率判定显著。p 值是这一次的运气,评测集要多大应该事先算。

**让模型打分就不用自己检查了。** `drill.py` 给「每小时」答成「每月」的回答打了满分。模型擅长找缺了什么,不擅长核对你有没有答偏题。

## 学习资料

### 文档与文章

- [Anthropic:Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):2026 年 1 月,pass@k 和 pass^k 的定义、评测集从 20 到 50 个真实失败起步的建议都出自这里。真题三最好的参考资料,30 分钟。
- [τ-bench 论文](https://arxiv.org/abs/2406.12045):pass^k 的出处,读第 1 节和讲指标的那一节就行,英文。
- [Codex 论文《Evaluating Large Language Models Trained on Code》](https://arxiv.org/abs/2107.03374):pass@k 无偏估计公式的出处,看第 2.1 节。
- [SWE-bench 官网](https://www.swebench.com/):排行榜和 Verified 子集的说明,看它怎么从 GitHub 历史里构造任务。
- [Hello Interview:Delivery Framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery):Day 642 推荐过,今天两道题答完再对照一遍时间分配。
- [Hamel Husain:Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/):真题三「评测给谁看」那一段的思路来源之一。

### B 站视频

- 慢学AI《驯服随机性:Agent 评估中的 Pass@k 与 Pass^k》和 AI深度幻觉《面试官问:Agent Benchmark 怎么造?》已经嵌在正文里。
- 古希腊掌管代码的神,《【评测原理】pass@k 怎么推导计算:无偏估计公式》(BV1DMK46VEAW),3 分钟。想弄懂 passk.py 里那个组合数公式怎么来的,看这个。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/eGYR5RvnoAY" title="AI Agent Reliability: pass@k vs pass^k, Release Gates" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>The Modern SDE · AI Agent Reliability: pass@k vs pass^k, Release Gates · 英文,讲怎么拿 pass^k 当发布门槛。可以开 YouTube 自动翻译字幕,重点听 release gate 那段,对应真题三的冒烟集。</figcaption>
</figure>

- Keerti Purswani,《20 Agentic AI System Design Interview Questions & Solutions》(YouTube ID I4sGn8Z1vpI)。二十道 Agent 系统设计题的快速过一遍,用来补充追问清单。

### 书籍

- Alex Xu,《System Design Interview – An Insider's Guide》第 1 卷(2020),自出版。真题二的估算方法和第 2 章一致。
- Chip Huyen,《AI Engineering》,O'Reilly,2025。第 3、4 章讲评测方法和评测流水线,真题三的大部分内容在这两章里都能找到更系统的讲法。

### 开源项目与代码

- [SWE-bench/SWE-bench](https://github.com/SWE-bench/SWE-bench):评测框架的代码,看它怎么给每个任务起一个隔离的 Docker 环境,对应真题三的基础设施部分。
- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):τ-bench 的代码,README 里有 pass^k 的计算方式。

## 自测

1. 真题二里,决定架构的两个数是什么?它们分别逼出了哪些设计?

<details><summary>答案</summary>

一是 33,333 个在途模型请求,是 deepseek-flash 单账号并发上限 2500 的 13 倍多,逼出了多账号、多供应商网关和分诊小模型(分诊后降到 11,667 个、5 个账号)。二是每小时约 14 万元的模型费,逼出了分诊和前缀缓存这两个降本手段,让它们成为上线前提而不是优化项。另外人工坐席只扛得住 6% 的转人工率,是第三个约束,逼出了排队和降级设计。

</details>

2. 同时在线 10 万个会话,会话平均 6 分钟,转人工率 10%,人工处理 8 分钟。人工那边同时有多少个会话?怎么算的?

<details><summary>答案</summary>

用两次利特尔定律。先倒过来算到达速率:`100,000 / 360 ≈ 278` 个新会话/秒。转人工的到达速率 `278 × 0.1 ≈ 27.8` 个/秒。人工那边的在途 = 到达速率 × 处理时间 = `27.8 × 480 ≈ 13,333` 个。2000 个坐席每人接 4 个,上限 8000,缺 5,333 个。

</details>

3. 一个任务跑 10 次成功 7 次,它的 pass@1、pass^5 大概是多少?为什么差这么多?

<details><summary>答案</summary>

pass@1 就是成功率 0.7。pass^5 = C(7,5)/C(10,5) = 21/252 ≈ 0.083。差这么多是因为 pass^5 要求五次全成功,每多要求一次,概率就乘上一个小于 1 的数,掉得很快。70% 的单次成功率,对一个每天要跑很多次的生产任务来说其实很不可靠。

</details>

4. 两个版本在同一批 300 个任务上分别是 52% 和 58%,为什么不应该把它们当成两组独立样本比?配对比较具体看什么?

<details><summary>答案</summary>

因为跑的是同一批任务,任务难度差异很大,很多题两个版本结果一样(都对或都错)。当成独立样本,任务难度的噪声会被算进误差,区间变宽,看不出差别。配对比较只看两个版本结果不同的题:「只有新版对」和「只有老版对」各多少题,如果两个版本一样好,这两个数应该差不多,像抛硬币。正文例子里是 48 比 29,符号检验 p = 0.040。

</details>

5. 面试题:面试官问「你的代码 Agent 评测集分数涨了 6 个点,我凭什么相信它真的变好了?」你怎么回答?

<details><summary>答案</summary>

分三层答。第一,统计上:两个版本跑的是同一批任务,我用配对比较而不是比两个百分比,并报出 p 值或置信区间;同时说明评测集的大小事先按要检测的提升算过,不是跑完看运气。第二,稳定性上:每题跑多次,除了 pass@1 还报 pass^k,确认不是靠偶尔成功拉上去的;flaky 测试已经剔除。第三,有效性上:评测集按日期切防污染,而且定期和线上指标(MR 合并率、合并后回滚率)对照,如果离线涨了线上没动,说明评测集需要更新。最后主动说边界:300 题检测 8 个点的提升,配对法也只有大约六成功效,所以单次结果显著我会再跑一轮或扩大评测集确认。

</details>

## 明天预告

明天是 Day 645 · 带人和推动:一页纸、让别人自愿迁移、带新人、回应「AI 不靠谱」。这两天的面试是在 45 分钟里说服一个面试官,明天讲入职以后在几周甚至几个月里说服一群人:给管理层写一页纸,用 Day 641 的回本测算和今天的配对比较当论据;在没有行政权力的情况下让业务团队自愿迁移到平台;带一个新人做 Agent 项目;以及有人说「AI 不靠谱」时怎么用数据回应。
