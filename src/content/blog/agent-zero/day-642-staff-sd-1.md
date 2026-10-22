---
title: 'Day 642 · Staff 系统设计(一):面试官看什么,45 分钟框架,真题一'
description: '资深和 Staff 的系统设计面试,面试官默认你会画架构图,他看的是你能不能从业务目标和约束出发,找到决定架构的那个数字,主动挑出最难的点深挖,讲清取舍和演进。今天先对照中级和 Staff 的评分差别,再用 45 分钟框架完整答一遍「设计企业级 Agent 平台」,估算、权限模型和模拟面试官都用脚本实跑。'
pubDate: 2026-10-22
regime: none
tags: ['system-design', 'interview', 'staff-engineer', 'python', 'agent-zero']
series: 'agent-zero'
day: 642
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 641](/blog/agent-zero/day-641-build-vs-buy/) 算了 CloudLedger 客服 Agent 的立项账:回本 8 个月,自建和购买的交叉点约 4,984 张工单/月,敏感性分析发现最要命的假设是「人工处理一张工单要几分钟」。那一课的思路是:先找到决定结论的那个数,再围绕它讨论。

今天把同样的思路搬到面试里。资深岗位的系统设计面试,本质上就是在 45 分钟里口头做一遍设计文档加立项测算:问清约束、估出关键数字、讲取舍和演进。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说出 Staff 级系统设计和中级在评分上差在哪七个维度,知道面试官在每个阶段想听到什么。
2. 用一个固定的时间分配,在 45 分钟里走完一道开放题,不会在某一步卡死。
3. 完整答出「设计企业级 Agent 平台」:用脚本估出 QPS、并发、月成本,找出决定架构的那个数,深挖三个难点,讲出演进路线。
4. 用模型扮演面试官,针对你回答里最薄弱的地方追问一次并打分。

预计用时:3 小时,其中至少 45 分钟是对着计时器自己讲一遍。前置:[Day 508](/blog/agent-zero/day-508-sysdesign-1/) 和 [Day 509](/blog/agent-zero/day-509-sysdesign-2/)(中级系统设计)、[Day 583](/blog/agent-zero/day-583-platform-1/)(什么时候该做平台)、[Day 638](/blog/agent-zero/day-638-agentops-load/)(利特尔定律)、[Day 640](/blog/agent-zero/day-640-design-docs-1/)(取舍四要素)。

学法提示:先对照文章逐行敲一遍代码(不复制粘贴)并跑通;第二天合上文章,把 45 分钟的六段时间分配和真题一的三个深挖点默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## Staff 面试官在看什么

[Day 508](/blog/agent-zero/day-508-sysdesign-1/) 讲过系统设计面试,那时的目标是中级岗位:能画出一个合理的架构,讲清每个组件干什么。今天往上走一档。资深和 Staff 的面试官默认你会画架构图,他想看的是别的东西。

Staff 是 Staff Engineer 的简称,在很多海外公司是 Senior 之上的一级,国内大致对应「资深专家」或 P8 上下。这一级的工作重心从「把一块做好」变成「定一片区域的技术方向」,面试也跟着变了。

我把中级和 Staff 的评分差别整理成一张表。这不是哪家公司的官方标准,是综合 Hello Interview 这类面试辅导平台公开的分级说明和一些公开面经整理的,算二手归纳:

| 维度 | 中级能过的表现 | Staff 能过的表现 |
| --- | --- | --- |
| 需求 | 问清功能需求 | 主动追问业务目标、成功指标、约束,把模糊的需求收敛成能设计的范围 |
| 估算 | 算出 QPS | 算出 QPS、成本、容量瓶颈,并指出哪个数字决定了架构 |
| 架构 | 画出合理的组件 | 架构是从约束推出来的,能说清每个组件为什么存在 |
| 深挖 | 面试官问到才深入 | 自己挑出最难的两三个点主动深入 |
| 取舍 | 知道有别的方案 | 用同一组维度比较,讲代价和推翻条件 |
| 演进 | 很少涉及 | 讲清 MVP、三个月后、一年后分别长什么样,组织和成本怎么跟着变 |
| 风险 | 提一句「要监控」 | 讲失败模式、评测、灰度、回滚、安全和合规 |

你会发现「取舍」那一行就是 [Day 640](/blog/agent-zero/day-640-design-docs-1/) 的四要素,「估算」那一行就是昨天回本测算的思路。系统设计面试并不是一项独立的技能,它是你平时写设计文档、做立项测算的能力在限时、口头条件下的版本。平时没写过设计文档的人,面试时很难临时装出 Staff 的样子。

Agent 系统的面试还多一层:面试官会特别留意你有没有把「模型不可靠」当成一等公民的约束。普通后端的服务要么返回正确结果,要么报错。Agent 系统会返回一个看起来对、其实错的结果,而且错误率随模型、提示词和数据漂移。能把这一点贯穿到架构、评测和上线策略里,是 Staff 候选人和熟练的中级候选人之间最明显的分界线。

这对应到招聘上也看得到。海外 Staff 级 Agent 岗位的描述里反复出现 technical direction(技术方向)和 cross-team design(跨团队设计),国内资深岗写的是「主导整体架构」「可靠性体系」。系统设计面试就是在验证这件事。

## 45 分钟的时间框架

时间不够是最常见的失败原因。很多人前 25 分钟在画登录注册和数据库表,到真正难的地方只剩 5 分钟。我用的分配是这样:

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="45 分钟系统设计面试的时间分配">
<rect x="20" y="50" width="70" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="55" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">需求</text>
<text x="55" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5-8 分</text>
<rect x="90" y="50" width="60" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="120" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">估算</text>
<text x="120" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5 分</text>
<rect x="150" y="50" width="110" height="50" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="205" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">高层架构</text>
<text x="205" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">8-10 分</text>
<rect x="260" y="50" width="190" height="50" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="355" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">深挖 2-3 个难点</text>
<text x="355" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">15 分</text>
<rect x="450" y="50" width="90" height="50" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="495" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">评测与风险</text>
<text x="495" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">5 分</text>
<rect x="540" y="50" width="80" height="50" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="580" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">演进</text>
<text x="580" y="90" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">3-5 分</text>
<text x="320" y="135" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">琥珀色那段拉开差距,别把时间花在画登录注册上</text>
</svg>
<figcaption>Staff 面试的时间分配。需求和估算加起来十分钟以上不算浪费,它们决定了后面所有取舍。</figcaption>
</figure>

**需求阶段要「收」。** 题目往往故意给得很大。你要做的是问出业务目标和约束,然后主动缩小范围:「我们先聚焦在文字渠道,语音放到演进部分,可以吗?」面试官通常会同意,而且会给你加分,因为这正是 Staff 在真实工作里该做的事。前端的类比是接到一个「做个后台管理系统」的需求,你不会直接开写,会先问用户是谁、最常用的三个页面是什么、哪些功能下期再说。

**估算要找到「决定架构的那个数字」。** 算 QPS 不是目的。目的是找到一个数,它一出来,某个设计就必须这样做。比如算出高峰并发接近供应商的账号上限,那多供应商路由就不是锦上添花,而是必需。这和昨天敏感性分析找「最要命的假设」是一个思路。

**深挖要自己挑。** 画完高层架构后主动说:「我认为这个系统最难的是这三个地方,我们按风险从高到低聊。」别等面试官点名。

**最后两分钟留给总结。** 用三句话复述关键取舍和演进路线。面试官写评价时,常常就是照着你最后这几句写的。

这六段时间有没有分配对,可以用一个十几行的小脚本检查,放在练习 3 里。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19f4y1a7DZ&autoplay=0&high_quality=1" title="系统设计面试6个技巧|我面Google前的准备方法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>TerryChen_泰瑞 · 系统设计面试6个技巧|我面Google前的准备方法 · 12 分钟,讲需求澄清和时间控制,和上面的框架对照着听。</figcaption>
</figure>

## 真题一:设计一个企业级 Agent 平台

**题目(大致原话)**:公司有十几个业务团队都在做 Agent,各自调模型、各自接工具、各自做评测。设计一个平台,让他们更快、更安全地上线 Agent。

你在 [Day 583](/blog/agent-zero/day-583-platform-1/) 讨论过「什么时候该做平台」,又花了十几天把 AgentOps 做了出来。这道题就是让你把那些经历压缩成 45 分钟讲出来。

### 需求阶段(5 到 8 分钟)

我会问这几个问题,每个问题后面写的是它决定了什么:

- 平台的用户是谁?业务团队的工程师,还是也包括不写代码的运营?(决定要不要做可视化编排。)
- 现在最痛的是什么?成本失控、安全事故,还是重复造轮子?(决定先做哪一块。)
- 有没有合规要求?数据能不能出境?要不要支持私有化部署的模型?(决定能用哪些供应商。)
- 规模:多少团队、多少 Agent、每天多少次模型调用?(决定估算的输入。)

假设面试官的回答是:15 个团队、60 个 Agent、每天 500 万次模型请求;最痛的是上个月有团队把额度打爆连累别人,还有两次 prompt injection 导致的数据泄露;数据不能出境;用户主要是工程师。

prompt injection 是 [Day 403](/blog/agent-zero/day-403-injection-1/) 讲过的提示词注入:用户或外部内容里藏着指令,让 Agent 干了不该干的事。面试里听到这个词,要立刻意识到它会影响权限设计。

### 估算(5 分钟)

面试时你在白板上口算。今天我们先用脚本把它算准,练熟了口算才不会出错。`part10/estimate.py`(还是在 `agent-zero-lab/` 根目录下,和昨天的脚本放一起):

```python
# agent-zero-lab/part10/estimate.py
CALLS_PER_DAY = 5_000_000   # 面试官给的:日调用 500 万次模型请求
TEAMS = 15                  # 面试官给的:15 个团队
PEAK_FACTOR = 5             # 假设:白天高峰是平均的 5 倍
IN_TOKENS = 3000            # 假设:每次调用平均输入
OUT_TOKENS = 300            # 假设:每次调用平均输出
HIT_RATE = 0.5              # 假设:前缀缓存命中一半
LATENCY_S = 4.0             # 假设:一次调用 4 秒(实测 170 token 输出约 2 秒,往上推)
PRICE = (0.04, 2.0, 8.0)    # deepseek-flash 高峰价 命中/未命中/输出,元/百万 token,2026-10-22 查
CONCURRENCY_LIMIT = 2500    # deepseek-flash 每账号并发上限,限速文档 2026-10-22 查

avg_qps = CALLS_PER_DAY / 86_400
peak_qps = avg_qps * PEAK_FACTOR
peak_concurrency = peak_qps * LATENCY_S          # 利特尔定律:在途请求 = 到达速率 × 停留时间
hit, miss, out = PRICE
per_call = (IN_TOKENS * HIT_RATE * hit + IN_TOKENS * (1 - HIT_RATE) * miss + OUT_TOKENS * out) / 1e6
monthly = per_call * CALLS_PER_DAY * 30

print(f"平均 {avg_qps:.1f} QPS,高峰 {peak_qps:.0f} QPS")
print(f"高峰在途请求 {peak_concurrency:.0f} 个,占账号并发上限 {peak_concurrency / CONCURRENCY_LIMIT:.0%}")
print(f"平均每个团队分到 {CONCURRENCY_LIMIT / TEAMS:.0f} 个并发")
print(f"每次调用 ¥{per_call:.5f},每月 ¥{monthly:,.0f},平均每团队 ¥{monthly / TEAMS:,.0f}")
```

<div class="line-notes">

- `CALLS_PER_DAY = 5_000_000` 面试官给的数,不是假设,注释里分开写。面试时也要口头分清「这是你给的」和「这是我假设的」。
- `PEAK_FACTOR = 5` 业务团队的 Agent 大多白天用,高峰是平均的 5 倍是个常见的估法。面试时说一句「我假设高峰是平均的 5 倍,您那边有实际数据吗?」
- `IN_TOKENS = 3000` 每次调用带系统提示词、工具定义、几轮历史,3000 token 是 Agent 场景比较保守的估计。
- `LATENCY_S = 4.0` 一次调用从发出到完整返回的时间。我实跑了 3 次 deepseek-flash,输出 160 到 179 个 token,耗时 1.6 到 2.0 秒;这里输出按 300 算、再加上 3000 token 输入的处理时间,取 4 秒。这个实测脚本放在练习 1 的答案里。
- `PRICE = (0.04, 2.0, 8.0)` 元组,下面用解构一次拿出三个值。
- `CONCURRENCY_LIMIT = 2500` 我查 DeepSeek 限速文档时发现,它不限每分钟请求数和 token 数,只限每个账号的并发:deepseek-flash 2500 个,deepseek-v4-pro 500 个,超了返回 429,扩容要提工单申请。不同供应商限法不一样,OpenAI 这类按每分钟 token 数(TPM)和请求数(RPM)限。面试时说「我按主力供应商的账号并发上限算」就行,数字可以问面试官。
- `avg_qps = CALLS_PER_DAY / 86_400` 一天 86,400 秒,`5,000,000 / 86,400 = 57.9`。这个数口算要会:一天十万秒左右,所以「日调用数除以十万」再稍微往上调一点就是平均 QPS。
- `peak_qps = avg_qps * PEAK_FACTOR` `57.9 × 5 ≈ 289`。
- `peak_concurrency = peak_qps * LATENCY_S` [Day 638](/blog/agent-zero/day-638-agentops-load/) 学的利特尔定律:系统里同时在途的请求数 = 每秒进来多少个 × 每个停留多久。`289 × 4 ≈ 1157`。QPS 不直接决定你会不会被限流,在途请求数才决定。
- `hit, miss, out = PRICE` 解构赋值,相当于 JS 的 `const [hit, miss, out] = PRICE`。
- `per_call = (IN_TOKENS * HIT_RATE * hit` 一次调用:`1500×0.04 + 1500×2 + 300×8 = 60 + 3000 + 2400 = 5460`,除以一百万是 ¥0.00546。`1e6` 就是一百万,科学计数法写法和 JS 一样。
- `monthly = per_call * CALLS_PER_DAY * 30` `0.00546 × 500 万 × 30 = 819,000` 元。
- `{peak_concurrency / CONCURRENCY_LIMIT:.0%}` `:.0%` 把 0.463 打印成 `46%`。

</div>

```bash
uv run python -m part10.estimate
```

```text
平均 57.9 QPS,高峰 289 QPS
高峰在途请求 1157 个,占账号并发上限 46%
平均每个团队分到 167 个并发
每次调用 ¥0.00546,每月 ¥819,000,平均每团队 ¥54,600
```

读这几行数,你要能当场说出它们意味着什么。289 QPS 本身不大,一个普通的网关几台机器就扛得住,所以**决定架构的不是 QPS**。决定架构的是另外两个数:

一是 15 个团队共用一个 2500 的并发池。整体高峰只用了 46%,看起来很宽裕,可平均下来每个团队只有 167 个并发。只要有一个团队跑一个批量任务,比如半夜把三万张历史工单丢进去重新分类,几分钟就能把 2500 占满,另外 14 个团队的线上 Agent 一起 429。这正好就是面试官说的「上个月有团队把额度打爆」。所以平台第一优先级是**租户级配额和隔离**。

二是每月 82 万的模型费。量级到了这个程度,财务一定会问「哪个团队花了多少、花在哪个 Agent 上」,所以**成本归因必须进网关**,不能事后从供应商账单里猜。

再加上面试官说的两次 prompt injection 数据泄露,平台的三个核心诉求就出来了:隔离、成本归因、工具权限。性能排在后面。面试时这一段大概这样说:「算下来高峰 300 QPS 不到,性能不是主要矛盾;主要矛盾是共享额度和两次安全事故,所以我的架构会围绕隔离和治理来设计。」

### 高层架构(8 到 10 分钟)

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="企业级 Agent 平台高层架构">
<rect x="20" y="20" width="600" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="45" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">15 个业务团队的 Agent(用平台 SDK,或托管在平台运行时)</text>
<rect x="20" y="90" width="180" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="113" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型网关</text>
<text x="110" y="131" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">配额/路由/记账/切换</text>
<rect x="230" y="90" width="180" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="113" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">MCP 工具中心</text>
<text x="320" y="131" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">注册/授权/审批/审计</text>
<rect x="440" y="90" width="180" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="530" y="113" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">控制台</text>
<text x="530" y="131" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">租户/密钥/配额/策略</text>
<rect x="20" y="180" width="180" height="40" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="110" y="205" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">多家模型供应商</text>
<rect x="230" y="180" width="180" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="205" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">业务系统/数据库</text>
<rect x="20" y="245" width="290" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="165" y="270" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">评测平台:数据集/回归/A/B</text>
<rect x="330" y="245" width="290" height="40" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="475" y="270" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">可观测:OTel 链路+租户成本看板</text>
<line x1="110" y1="60" x2="110" y2="90" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="320" y1="60" x2="320" y2="90" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="110" y1="146" x2="110" y2="180" stroke="var(--mem)" stroke-width="1.5"/>
<line x1="320" y1="146" x2="320" y2="180" stroke="var(--compute)" stroke-width="1.5"/>
<line x1="440" y1="118" x2="410" y2="118" stroke="var(--rule)" stroke-width="1.5" stroke-dasharray="4 4"/>
<line x1="440" y1="108" x2="200" y2="108" stroke="var(--rule)" stroke-width="1" stroke-dasharray="4 4"/>
<text x="530" y="235" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">虚线:控制台下发配置</text>
</svg>
<figcaption>真题一的高层架构。所有模型调用必经网关,所有工具调用必经工具中心,这两条「必经之路」是治理落地的地方。</figcaption>
</figure>

六个组件,每个都要说出「为什么存在」,而且理由要能追溯到需求阶段问出来的东西:

- **模型网关**:统一入口,做租户配额、路由、成本记账、故障切换。存在的理由是共享额度被打爆和每月 82 万的成本归因。你在 [Day 626](/blog/agent-zero/day-626-agentops-gw-1/) 和 [Day 627](/blog/agent-zero/day-627-agentops-gw-2/) 亲手写过。
- **MCP 工具中心**:工具注册、OAuth 授权、按租户和用户的权限、调用审计。存在的理由是两次 prompt injection 泄露。[Day 628](/blog/agent-zero/day-628-agentops-mcp-1/) 写过它的默认拒绝策略。
- **Agent 运行时**:提供标准的 harness(循环、上下文管理、人工审批、持久化)。团队可以只用 SDK,也可以托管运行。存在的理由是重复造轮子。
- **评测平台**:数据集管理、离线回归、线上 A/B,[Day 633](/blog/agent-zero/day-633-agentops-eval/) 做过。存在的理由是「模型不可靠」这个一等约束。
- **可观测**:OpenTelemetry 全链路,按租户的成本和质量看板,[Day 635](/blog/agent-zero/day-635-agentops-obs/) 做过。
- **控制台**:租户、密钥、配额、审批策略的管理界面。

讲架构图的时候,一个容易忽略的点是:**这张图在 45 分钟里只占 8 到 10 分钟**。你会很想把每个框里面的东西都展开讲,忍住。框内部的细节留给深挖阶段,而深挖只挑最难的。

### 深挖:我会主动挑的三个点(15 分钟)

画完图以后我会说:「我认为这个系统最难的是三件事:租户隔离做到什么程度、工具权限怎么设计、平台管不管提示词和编排。按风险从高到低聊。」

**深挖一:租户隔离做到什么程度。** 有两种做法。逻辑隔离是同一套服务,按租户 ID 分配额、分数据;物理隔离是给敏感的租户独立部署一套。我的选择:默认逻辑隔离,对处理个人敏感信息的租户提供独立的工具执行沙箱和独立的日志存储。代价是运维复杂度上升,两套部署形态要分别测试。推翻条件:出现合规要求必须物理隔离的业务线。

这里配额的实现要讲到具体机制:每个租户一个令牌桶([Day 627](/blog/agent-zero/day-627-agentops-gw-2/) 写过),桶的容量按租户的并发份额配;批量任务走单独的低优先级队列,只能用全局池里线上流量剩下的部分。这样一个团队跑批量,最多把自己的份额用完,碰不到别人的线上流量。

**深挖二:工具权限模型。** 这是直接回应两次安全事故的地方,也是我觉得最能拉开差距的一点。Agent 能调什么工具,不能只看 Agent 自己的配置,还要看「它代表谁在调」。我会设计成三层取交集:租户允许的工具、Agent 声明需要的工具、最终用户授权的范围。写操作默认要人确认,可以按工具和金额阈值放宽。

光说不够具体,我们用代码把这个模型跑一遍。`part10/tool_permission.py`:

```python
# agent-zero-lab/part10/tool_permission.py
TENANT_ALLOWED = {"billing-team": {"search_kb", "get_invoice", "refund", "send_email"}}
AGENT_DECLARED = {"refund-agent": {"search_kb", "get_invoice", "refund", "delete_customer"}}
USER_GRANTED = {"alice": {"search_kb", "get_invoice", "refund"}, "bob": {"search_kb"}}
WRITE_TOOLS = {"refund", "send_email", "delete_customer"}
AUTO_APPROVE_LIMIT = 100  # 元,退款低于这个数不用人确认(假设的策略)

def decide(tenant: str, agent: str, user: str, tool: str, amount: float = 0) -> str:
    allowed = TENANT_ALLOWED[tenant] & AGENT_DECLARED[agent] & USER_GRANTED[user]
    if tool not in allowed:
        return "拒绝"
    if tool in WRITE_TOOLS and amount >= AUTO_APPROVE_LIMIT:
        return "等人工确认"
    return "放行"

if __name__ == "__main__":
    cases = [
        ("alice", "get_invoice", 0),
        ("alice", "refund", 30),
        ("alice", "refund", 99.5),
        ("alice", "refund", 500),
        ("bob", "refund", 30),
        ("alice", "delete_customer", 0),
    ]
    for user, tool, amount in cases:
        print(f"{user:<6}{tool:<16}{amount:>6} -> {decide('billing-team', 'refund-agent', user, tool, amount)}")
```

<div class="line-notes">

- `TENANT_ALLOWED = {"billing-team": {` 第一层:租户(业务团队)整体允许用哪些工具。花括号里没有冒号的是集合 `set`,[Day 25](/blog/agent-zero/day-025-sets/) 学过,相当于 JS 的 `new Set([...])`。账单团队允许 4 个工具。
- `AGENT_DECLARED = {"refund-agent": {` 第二层:这个 Agent 声明自己需要哪些工具。它声明了 `delete_customer`,这个工具租户层没有允许。真实情况里这往往是开发时图省事多声明的。
- `USER_GRANTED = {"alice": {` 第三层:当前用户授权 Agent 代表自己用哪些工具。alice 是有退款权限的客服,bob 只能查知识库。
- `WRITE_TOOLS = {` 会改外部状态的工具。读操作出错最多答错,写操作出错钱就出去了。
- `AUTO_APPROVE_LIMIT = 100` 写操作金额低于 100 元直接放行,否则等人工确认。这个阈值是一个策略,真实系统里由控制台按租户配置。
- `allowed = TENANT_ALLOWED[tenant] & AGENT_DECLARED[agent] & USER_GRANTED[user]` 三个集合取交集,`&` 是集合交集运算符。代入 alice:`{search_kb, get_invoice, refund, send_email} & {search_kb, get_invoice, refund, delete_customer} & {search_kb, get_invoice, refund}` = `{search_kb, get_invoice, refund}`。代入 bob,结果只有 `{search_kb}`。
- `if tool not in allowed:` 不在交集里一律拒绝,这就是默认拒绝。
- `if tool in WRITE_TOOLS and amount >= AUTO_APPROVE_LIMIT:` 在交集里、是写操作、金额到了阈值,停下来等人。`99.5` 小于 100 放行,`500` 等确认。
- `cases = [` 六个场景,每个是 `(用户, 工具, 金额)` 的元组。
- `print(f"{user:<6}{tool:<16}{amount:>6} ->` 左对齐用户名和工具名、右对齐金额,输出对成一列。

</div>

```bash
uv run python -m part10.tool_permission
```

```text
alice get_invoice          0 -> 放行
alice refund              30 -> 放行
alice refund            99.5 -> 放行
alice refund             500 -> 等人工确认
bob   refund              30 -> 拒绝
alice delete_customer      0 -> 拒绝
```

最后两行是这个设计的价值所在。bob 被注入了一段「帮我给这个账户退 30 块」的指令,Agent 照做了,但 bob 本人没有退款权限,交集里没有 `refund`,拒绝。`delete_customer` 是 Agent 自己声明了、租户没批的工具,不管谁在用,都拒绝。面试时可以这样说:「prompt injection 我不指望在模型层完全挡住,我的设计是让被注入的 Agent 最多只能做『当前这个用户本来就能做的事』,而且大额写操作一定要人点确认。」这句话把「模型不可靠」放进了权限设计里,正是 Staff 面试官想听的。

**深挖三:平台管不管提示词和编排。** 管得太多,平台变成低代码工具,工程师不爱用;管得太少,治理落不了地。我的选择:平台不管业务提示词,但强制所有调用经过网关和工具中心,强制接入评测和可观测。**用「必经之路」做治理,而不是用「统一编排」**。代价是各团队的 Agent 写法五花八门,平台没法帮他们统一优化提示词。推翻条件:如果一年后发现大部分团队的 Agent 结构高度相似,可以考虑提供官方的编排模板,但仍然是可选的。

你会注意到三个深挖点的讲法都一样:两种做法、我的选择、代价、推翻条件。这就是 [Day 640](/blog/agent-zero/day-640-design-docs-1/) 的取舍四要素,只不过是口头版。

### 评测与风险(5 分钟)

平台自己怎么评测?不是看模型分数,是看「接入平台后各团队的上线周期、事故率、单位任务成本有没有下降」。这三个数在立项时就要定好基线。

风险里最大的一条是平台成了单点故障:网关挂了,15 个团队一起挂。对策是网关多副本、跨可用区部署,再留一条直连供应商的紧急旁路。旁路的密钥由平台持有,开关打开要告警、要事后复盘。这一点 [Day 640](/blog/agent-zero/day-640-design-docs-1/) 的模型评审员也挑出来过:旁路不能让业务团队重新拿到供应商 key。

### 演进(3 到 5 分钟)

第一季度只做网关和工具中心,解决最痛的两件事(额度互相挤占和安全事故)。第二季度做评测平台。第三季度做托管运行时。组织上,平台团队 4 到 6 人,每个季度找两个业务团队深度共建,而不是一开始就要求 15 个团队全部迁移。让业务团队自愿迁移的办法,[Day 645](/blog/agent-zero/day-645-influence/) 会专门讲。

最后两分钟总结:「这个平台的核心矛盾不是性能,是 15 个团队共享额度和工具权限。所以第一期用网关的租户配额和工具中心的三层权限把这两件事管住,用『必经之路』而不是『统一编排』做治理,评测和托管运行时放到后两个季度。一年后最可能推翻的决定是逻辑隔离,如果有业务线需要物理隔离,工具执行沙箱是第一个要拆出去的。」

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1F43y6XETn&autoplay=0&high_quality=1" title="面试官问:设计一个生产级Agent系统,你怎么从头到尾把架构搭起来?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Agent开发实战 · 面试官问:设计一个生产级Agent系统,你怎么从头到尾把架构搭起来? · 5 分钟,一个国内面经里的标准答法。看完对照上面的 Staff 版本,找出它缺了哪几层(提示:估算、权限的「代表谁在调」、演进)。</figcaption>
</figure>

## 让模型当面试官追问一次

自己讲完一遍以后,最难的是知道自己哪里薄弱。找朋友模拟最好;没人的时候,可以让模型扮演面试官,规则是每次只问一个问题、不给提示、专挑薄弱的地方。`part10/mock_interviewer.py`:

```python
# agent-zero-lab/part10/mock_interviewer.py
import json

from common.llm import LLMClient

SYSTEM = """你是一位 Staff 级系统设计面试官,题目是「设计一个企业级 Agent 平台」。
规则:每次只问一个问题,不给提示,不夸奖。问题优先挑候选人回答里最薄弱的地方。"""
RUBRIC = "需求、估算、架构、深挖、取舍、演进、风险"
ANSWER = """我会做一个模型网关、一个 MCP 工具中心、一个评测平台和可观测。
网关做路由和限流,工具中心管权限。高峰大概 289 QPS,一个月模型费 82 万左右。"""
FOLLOW_UP = """主力供应商挂两小时的话,网关会切到备用供应商,备用的提示词没调过,
所以只切只读类的 Agent,写操作类的 Agent 直接排队,前端提示稍后处理。"""

llm = LLMClient()
msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": ANSWER}]
q = llm.chat(msgs, temperature=0)
print("面试官:", q.content)
msgs += [q.message, {"role": "user", "content": FOLLOW_UP}]
msgs.append({"role": "user", "content": f"面试结束。按 {RUBRIC} 七个维度各打 1-3 分,只输出 JSON,键用中文维度名,值是分数。"})
score = llm.chat(msgs, temperature=0, response_format={"type": "json_object"})
print("打分:", json.loads(score.content))
print(llm.ledger)
```

<div class="line-notes">

- `SYSTEM = """你是一位 Staff 级系统设计面试官` 系统提示词定规则。「不夸奖」很重要,不加的话模型每次都会先说「您的回答非常全面」。
- `RUBRIC = "需求、估算、架构、深挖、取舍、演进、风险"` 打分的七个维度,就是正文那张表。
- `ANSWER = """我会做一个模型网关` 一个故意写得很薄的候选人回答:有组件、有两个数,但没讲数是怎么来的、没讲为什么、没讲取舍和演进。
- `FOLLOW_UP = """主力供应商挂两小时的话` 预先写好的第二轮回答。我写的时候以为模型会问供应商故障,结果它问的是别的,所以这一轮答非所问,打分时会被扣。这正是真实面试里背答案会出的事。
- `msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": ANSWER}]` 消息列表,和 [Day 136](/blog/agent-zero/day-136-llm-client-2/) 的格式一样。
- `q = llm.chat(msgs, temperature=0)` 让面试官问第一个问题。
- `msgs += [q.message, {"role": "user", "content": FOLLOW_UP}]` 把面试官的提问原样追加进历史,再追加候选人的第二轮回答。`+=` 对列表是原地拼接,相当于 `msgs.push(...[a, b])`。
- `msgs.append({"role": "user", "content": f"面试结束。按 {RUBRIC} 七个维度` 连续两条 user 消息,DeepSeek 接受这种写法,会把它们当成一段连续的输入。
- `response_format={"type": "json_object"}` 打分要机器可读,用 JSON mode。提示词里有「JSON」字样,满足 DeepSeek 的要求。
- `print(llm.ledger)` 两次调用的总花费。

</div>

```bash
uv run python -m part10.mock_interviewer
```

实跑输出(模型的提问每次可能不同):

```text
面试官: 你说的 289 QPS 和 82 万月费,这两个数字是怎么来的?是峰值还是均值,对应多少并发会话、什么模型组合?
打分: {'需求': 2, '估算': 1, '架构': 2, '深挖': 1, '取舍': 2, '演进': 1, '风险': 2}
2 次调用 | 输入 341 / 输出 76 tokens | 约 ¥0.0013
```

两次调用 ¥0.0013,算式 `341 × 2 + 76 × 8 = 1290`,除以一百万。

面试官一上来就盯住了估算:你报了两个数,但没说怎么来的。这就是中级和 Staff 的差别之一,中级报数,Staff 报数的同时报假设,并且说出这个数决定了什么。我预先写好的第二轮回答讲的是供应商故障,和它问的完全不沾边,所以估算得了 1 分。

这个工具有两个局限要心里有数。一是模型给的分数很粗,同一份回答换个时间跑可能差一分,别拿它当准确的评分,只当「找薄弱点」的工具。二是它只看文字,看不到你画的图、听不到你的语速和停顿,真实面试里这些都算。所以它能替代的是「自己对着墙讲」,替代不了「找一个人模拟」。

练这道题的正确用法是把 `ANSWER` 换成你自己讲的版本(录音转成文字),把 `FOLLOW_UP` 改成交互输入,一轮一轮地答。练习 4 做这个。

## 今天的文件

| 文件 | 干什么 | 花钱吗 |
| --- | --- | --- |
| `part10/estimate.py` | 真题一的 QPS、在途请求、月成本估算 | 不花 |
| `part10/tool_permission.py` | 三层取交集的工具权限模型加金额阈值 | 不花 |
| `part10/mock_interviewer.py` | 模型扮演面试官追问一次并打分 | 两次共 ¥0.0013 |
| `part10/mock_interviewer_loop.py`(练习 4) | 连续追问三轮的交互版 | 三次共 ¥0.0017 |
| `part10/measure_latency.py`(练习 1) | 实测一次调用的耗时,给估算提供依据 | 三次共 ¥0.0042 |

## 动手练习

**练习 1:换一组假设重新估算,并实测延迟。** 先写一个脚本实测 deepseek-flash 输出 150 到 200 个 token 要多少秒。然后把高峰倍数(5、8)和单次耗时(4 秒、10 秒)两两组合,算四种情况下的高峰在途请求数,看哪几种超过了 2500 的账号上限。10 秒对应的是一次调用要输出很长内容、或者开了深度思考的情况。

<details><summary>参考答案</summary>

先实测延迟:

```python
# agent-zero-lab/part10/measure_latency.py
from common.llm import LLMClient

llm = LLMClient()
msgs = [{"role": "user", "content": "用大约 250 个汉字解释什么是发票冲红,面向客服新人。"}]
for i in range(3):
    r = llm.chat(msgs, max_tokens=400)
    print(f"第 {i + 1} 次:输出 {r.completion_tokens} tokens,耗时 {r.latency:.1f} 秒")
print(llm.ledger)
```

<div class="line-notes">

- `msgs = [{"role": "user", "content": "用大约 250 个汉字` 让它输出一段固定长度的文字,输出 token 数可控,方便算吐字速度。
- `r = llm.chat(msgs, max_tokens=400)` `max_tokens` 留够余量,不让它被截断。
- `耗时 {r.latency:.1f} 秒` `latency` 是 `LLMClient` 用 `time.perf_counter()` 量的非流式总耗时,包括网络往返。

</div>

```bash
uv run python -m part10.measure_latency
```

```text
第 1 次:输出 160 tokens,耗时 2.0 秒
第 2 次:输出 172 tokens,耗时 2.0 秒
第 3 次:输出 179 tokens,耗时 1.6 秒
3 次调用 | 输入 63 / 输出 511 tokens | 约 ¥0.0042
```

大约每秒 90 个 token。输出 300 个就是 3 秒多,再加上几千 token 输入的处理,正文取 4 秒是合理的。再算四种组合:

```python
# agent-zero-lab/part10/ex642_estimate.py
CALLS_PER_DAY = 5_000_000
LIMIT = 2500

def peak_concurrency(peak_factor: float, latency_s: float) -> float:
    return CALLS_PER_DAY / 86_400 * peak_factor * latency_s

for factor, latency in [(5, 4), (8, 4), (5, 10), (8, 10)]:
    c = peak_concurrency(factor, latency)
    flag = "超了" if c > LIMIT else "没超"
    print(f"高峰 {factor} 倍、每次 {latency} 秒:在途 {c:,.0f},{flag}({c / LIMIT:.0%})")
```

<div class="line-notes">

- `def peak_concurrency(peak_factor: float, latency_s: float) -> float:` 利特尔定律写成函数:平均 QPS × 高峰倍数 × 停留时间。
- `for factor, latency in [(5, 4), (8, 4), (5, 10), (8, 10)]:` 四种组合,每个元组在循环里被解构成两个变量。
- `flag = "超了" if c > LIMIT else "没超"` 和 2500 比。

</div>

```bash
uv run python -m part10.ex642_estimate
```

```text
高峰 5 倍、每次 4 秒:在途 1,157,没超(46%)
高峰 8 倍、每次 4 秒:在途 1,852,没超(74%)
高峰 5 倍、每次 10 秒:在途 2,894,超了(116%)
高峰 8 倍、每次 10 秒:在途 4,630,超了(185%)
```

单次耗时对结果的影响比高峰倍数大。如果各团队都开深度思考、单次调用到 10 秒,即使高峰只有 5 倍,一个账号的并发池也不够了,多账号或多供应商路由就从「锦上添花」变成「必需」。面试时可以把这个变化讲成演进的一部分:「第一期按 4 秒估,并发够用;如果后面推理模型用得多,单次耗时上去,第二期要加多供应商路由。」

</details>

**练习 2:给权限决策加审计日志。** 写 `part10/ex642_audit.py`,包一层 `decide`,每次决策都往 `part10/samples/audit.jsonl` 追加一行 JSON,记录时间、租户、Agent、用户、工具、金额和结果。跑 bob 退款 30 元和 alice 退款 500 元两个场景,打印日志内容。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex642_audit.py
import json
from datetime import datetime, timezone
from pathlib import Path

from part10.tool_permission import decide

AUDIT = Path("part10/samples/audit.jsonl")

def decide_and_log(tenant: str, agent: str, user: str, tool: str, amount: float = 0) -> str:
    result = decide(tenant, agent, user, tool, amount)
    record = {"ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "tenant": tenant, "agent": agent, "user": user,
              "tool": tool, "amount": amount, "result": result}
    with AUDIT.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return result

if __name__ == "__main__":
    AUDIT.parent.mkdir(parents=True, exist_ok=True)
    AUDIT.write_text("", encoding="utf-8")
    decide_and_log("billing-team", "refund-agent", "bob", "refund", 30)
    decide_and_log("billing-team", "refund-agent", "alice", "refund", 500)
    print(AUDIT.read_text(encoding="utf-8"), end="")
```

<div class="line-notes">

- `from datetime import datetime, timezone` 审计时间一律用 UTC,不同时区的服务器写出来的日志才能放在一起排序。
- `AUDIT = Path("part10/samples/audit.jsonl")` JSONL 是每行一个 JSON 对象的文件格式,[Day 348](/blog/agent-zero/day-348-testcase-structure/) 存测试用例时用过。追加写很方便,一行坏了不影响别的行。
- `result = decide(tenant, agent, user, tool, amount)` 先决策,决策逻辑不变,审计是包在外面的一层。这样权限逻辑和审计逻辑可以分别测试。
- `"ts": datetime.now(timezone.utc).isoformat(timespec="seconds")` 生成 `2026-10-22T04:06:11+00:00` 这种格式,≈ JS 的 `new Date().toISOString()`,只是精度到秒。
- `with AUDIT.open("a", encoding="utf-8") as f:` `"a"` 是追加模式,不会覆盖已有内容。`with` 块结束时自动关文件。
- `f.write(json.dumps(record, ensure_ascii=False) + "\n")` `ensure_ascii=False` 让中文「拒绝」原样写出,而不是 `拒绝`。[Day 39](/blog/agent-zero/day-039-json/) 讲过。
- `AUDIT.write_text("", encoding="utf-8")` 演示前先清空,不然多跑几次日志会越来越长。真实系统里当然不能清。

</div>

```bash
uv run python -m part10.ex642_audit
```

```text
{"ts": "2026-10-22T04:06:11+00:00", "tenant": "billing-team", "agent": "refund-agent", "user": "bob", "tool": "refund", "amount": 30, "result": "拒绝"}
{"ts": "2026-10-22T04:06:11+00:00", "tenant": "billing-team", "agent": "refund-agent", "user": "alice", "tool": "refund", "amount": 500, "result": "等人工确认"}
```

面试时被问「出了事怎么查」,就可以说:每次工具调用的决策都有审计记录,能按租户、用户、工具查到谁在什么时候被拒绝或放行。被拒绝的记录尤其有用,一个用户短时间内被拒绝很多次,往往说明他的会话被注入了。

</details>

**练习 3:检查你的时间分配。** 写 `part10/ex642_plan.py`,输入一个「阶段 → 分钟」的字典,检查四条规则:加起来等于 45;深挖至少占三分之一;需求加估算至少 10 分钟;演进不能是 0。用一个典型的第一次分配和调整后的分配各跑一次。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex642_plan.py
def check(plan: dict[str, int], total: int = 45) -> list[str]:
    problems: list[str] = []
    used = sum(plan.values())
    if used != total:
        problems.append(f"加起来 {used} 分钟,不是 {total}")
    if plan.get("深挖", 0) < total / 3:
        problems.append(f"深挖只有 {plan.get('深挖', 0)} 分钟,少于三分之一")
    if plan.get("需求", 0) + plan.get("估算", 0) < 10:
        problems.append("需求加估算不到 10 分钟,后面的取舍没有依据")
    if plan.get("演进", 0) == 0:
        problems.append("没留演进的时间")
    return problems

if __name__ == "__main__":
    mine = {"需求": 3, "估算": 2, "高层架构": 25, "深挖": 15}
    good = {"需求": 6, "估算": 5, "高层架构": 9, "深挖": 15, "评测与风险": 5, "演进": 5}
    for name, plan in (("我第一次的分配", mine), ("调整后", good)):
        print(name, check(plan) or "没问题")
```

<div class="line-notes">

- `used = sum(plan.values())` `.values()` 拿所有值,≈ `Object.values(plan)`,求和。
- `if plan.get("深挖", 0) < total / 3:` 45 的三分之一是 15。`get` 的第二个参数是默认值,没有这一项就当 0。
- `if plan.get("需求", 0) + plan.get("估算", 0) < 10:` 需求和估算压得太短,后面讲取舍时就说不出「因为什么约束所以这么选」。
- `mine = {"需求": 3, "估算": 2, "高层架构": 25, "深挖": 15}` 典型的第一次分配:架构图画了 25 分钟。
- `print(name, check(plan) or "没问题")` 空列表是假值,`or` 会返回右边的字符串,≈ JS 的 `check(plan).length ? check(plan) : "没问题"`。

</div>

```bash
uv run python -m part10.ex642_plan
```

```text
我第一次的分配 ['需求加估算不到 10 分钟,后面的取舍没有依据', '没留演进的时间']
调整后 没问题
```

第一次的分配加起来正好 45、深挖也有 15 分钟,看起来没问题,但架构图吃掉了 25 分钟,挤掉了需求、估算和演进。调整后把架构压到 9 分钟,时间就够了。

</details>

**练习 4:完整模拟一次。** 开 45 分钟计时器,在纸上或 Excalidraw 上完整答一遍真题一,不看正文的示范。录音,转成文字(手机自带的录音转文字就行),把文字替换进 `mock_interviewer.py` 的 `ANSWER`,再把 `FOLLOW_UP` 改成 `input("你:")`,让模型连续追问三轮。最后用 Staff 那张七维度表给自己打分,写下差距最大的两个维度。

<details><summary>参考答案</summary>

改成交互式的版本只需要改主体部分:

```python
# agent-zero-lab/part10/mock_interviewer_loop.py(只列出和 mock_interviewer.py 不同的部分)
llm = LLMClient()
msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": ANSWER}]
for _ in range(3):
    q = llm.chat(msgs, temperature=0.7)
    print("面试官:", q.content)
    msgs += [q.message, {"role": "user", "content": input("你:")}]
```

<div class="line-notes">

- `for _ in range(3):` 追问三轮。
- `q = llm.chat(msgs, temperature=0.7)` 交互练习时温度调高一点,每次练问题不完全一样。
- `msgs += [q.message, {"role": "user", "content": input("你:")}]` `input()` 等你在终端里敲一行回答再回车,≈ Node 里 `readline.question`。

</div>

正常用法是你在终端里一轮一轮打字。为了验证代码能跑,我用 `printf` 把三行预先写好的回答从管道喂给 `input()`,所以终端里「你:」后面看不到回答内容(管道输入不会回显):

```bash
printf '按日调用 500 万除以 86400 得到平均 57.9,高峰按 5 倍假设。月费按每次 3000 输入 300 输出、缓存命中一半算。\n并发用利特尔定律,289 乘 4 秒约 1157,占 deepseek-flash 账号上限 2500 的 46%%。\n批量任务走单独的低优先级队列,只用线上流量剩下的并发。\n' | uv run python -m part10.mock_interviewer_loop
```

```text
面试官: 你说的 289 QPS 和 82 万月费是怎么来的?给我拆一下这两个数的构成。
你:面试官: 500 万次日调用是从哪来的?是现有业务量还是你估的?另外 3000 输入 token 这个数代表什么场景?
你:面试官: 你在用账号上限 2500 做容量规划。如果高峰期超过 46%,比如到 80%,你的网关怎么处理?具体说降级和排队策略。
你:3 次调用 | 输入 507 / 输出 91 tokens | 约 ¥0.0017
```

`printf` 里的 `%%` 是转义,输出一个 `%`。三轮追问一路往估算的假设和容量规划里挖,这正是 Staff 面试的样子:你给出一个数,下一个问题就是这个数的来源和它被突破时怎么办。

自评怎么写,给一个示范格式(数字是举例,不是我的真实成绩):需求 2、估算 2、架构 3、深挖 2、取舍 2、演进 1、风险 2,差距最大的两个是演进和深挖。演进只说了一句「后面再做评测平台」,没讲组织怎么配合;深挖是等面试官点名才开始讲。下次的改法要具体:画完架构图后第一句话就说「最难的是三件事」,演进按季度讲,每个季度说清做什么、几个人、找哪个团队共建。

</details>

**验收标准**:四个脚本能跑出和文中一致的结果(模型输出允许不同);至少一次计时 45 分钟的完整模拟,有录音或文字稿;七维度自评表,写清差距最大的两项和下次怎么改;能不看稿说出真题一「决定架构的那个数」是什么、为什么不是 QPS。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Staff 工程师 | Senior 之上的一级,工作重心是定一片区域的技术方向,国内大致对应资深专家 |
| 需求收敛 | 把开放的题目缩成能在面试时间内设计的范围,并和面试官确认 |
| 决定架构的数字 | 估算里那个一出来就迫使你采用某种设计的数,真题一里是共享并发池和月成本,不是 QPS |
| 在途请求(并发) | 同一时刻已经发出、还没返回的请求数,用利特尔定律从 QPS × 耗时算出来 |
| 账号并发上限 | 供应商按账号限制同时在途的请求数,DeepSeek 的 deepseek-flash 是 2500(2026-10 查) |
| 逻辑隔离 / 物理隔离 | 同一套服务按租户 ID 隔离 / 给租户独立部署一套 |
| 三层权限交集 | 租户允许的、Agent 声明的、用户授权的工具三者取交集,不在交集里一律拒绝 |
| 金额阈值审批 | 写操作金额达到阈值就停下等人工确认,低于阈值直接放行 |
| 必经之路治理 | 不统一编排,但强制所有调用经过网关和工具中心,在这两处做治理 |
| 紧急旁路 | 网关故障时绕过网关直连供应商的通道,密钥仍由平台持有,打开要告警 |
| 七维度评分 | 需求、估算、架构、深挖、取舍、演进、风险,对照中级和 Staff 的表现 |

## 常见误区

**一上来就画图。** 需求没问清就开始画组件,面试官后面一个约束就能让你的架构推倒重来。前五分钟用来问问题,不会被扣分。

**估算只算 QPS。** 真题一算出来 289 QPS,看起来是个不大的数,如果停在这里,就会得出「没什么难的」的结论。真正决定架构的是 15 个团队共享 2500 并发和每月 82 万的成本。Agent 系统里,成本和并发上限是和 QPS 同一量级的约束。

**用 QPS 去比供应商的限流。** DeepSeek 限的是并发,不是每秒请求数。289 QPS 和 2500 直接比是错的,要先乘以单次耗时换算成在途请求。练习 1 里耗时从 4 秒变成 10 秒,结论就从「够用」变成「超了」。

**把模型当成可靠的组件。** 架构图里模型是一个方框,箭头进去箭头出来,好像它一定返回正确结果。Staff 级的回答要把「模型会错、会被注入」体现在权限、评测、人工确认和降级里,真题一的三层权限就是例子。

**被动深挖。** 画完架构图就停下来等面试官问。主动说出最难的三个点并按风险排序,本身就是 Staff 级的表现。

**背答案。** `mock_interviewer.py` 里我预先写好的第二轮回答和面试官的提问完全不沾边,估算只得了 1 分。面试官的追问是跟着你的回答走的,准备的应该是「框架 + 几个能现场套用的取舍」,而不是一份逐字稿。

**拿模型打分当真。** 模型打的分很粗,同一份回答换个时间跑可能差一分。它的用处是找薄弱点,不是给你一个准确的分数。

## 学习资料

### 文档与文章

- [Hello Interview:Delivery Framework](https://www.hellointerview.com/learn/system-design/in-a-hurry/delivery):系统设计面试的答题框架,和今天的 45 分钟分配对照着看。
- [Hello Interview:Mastering Estimation](https://www.hellointerview.com/blog/mastering-estimation):估算的方法和常见错误,20 分钟。
- [Chip Huyen:Building A Generative AI Platform](https://huyenchip.com/2024/07/25/genai-platform.html):从零到完整的生成式 AI 平台架构,真题一可以拿它当参考答案的骨架。
- [DeepSeek 限速说明](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit):今天估算里 2500 并发上限的来源,也是一个「供应商按什么限流」的真实例子。
- [Anthropic:How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):真实的多 Agent 系统设计,里面的 token 成本倍数和评测方法都是系统设计面试的好素材。
- [system-design-primer](https://github.com/donnemartin/system-design-primer):经典的系统设计开源教程,当作基础组件的查漏补缺。

### B 站视频

- TerryChen_泰瑞《系统设计面试6个技巧》和 Agent开发实战《设计一个生产级Agent系统》已经嵌在正文里。
- 假如今天可以躺平,《我的AI Agent面试复盘》(BV1hubZ6WEfU),36 分钟。一个候选人的真实面经复盘,听国内面试官会怎么追问 Agent 系统设计。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Ru54dxzCyD0" title="How to Prepare for System Design Interviews w/ Meta Staff Engineer" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hello Interview · How to Prepare for System Design Interviews w/ Meta Staff Engineer · 前 Meta Staff 工程师讲不同级别的面试官期望,重点听他讲 Senior 和 Staff 在「主动性」上的差别。</figcaption>
</figure>

- Hello Interview,《Design Uber w/ a Ex-Meta Staff Engineer: System Design Interview breakdown》(YouTube ID lsKU38RKQSo)。不是 Agent 题,但能完整看到一个 Staff 面试官期望的节奏。

### 书籍

- Alex Xu,《System Design Interview – An Insider's Guide》第 1 卷(2020),自出版。繁体中文版书名《內行人才知道的系統設計面試指南》。第 2 章讲估算,第 3 章讲答题框架,今天重点读这两章。
- Tanya Reilly,《The Staff Engineer's Path》,O'Reilly,2022。第 1 章讲 Staff 工程师的工作到底是什么,读完你会更明白面试官为什么那样打分。

### 开源项目与代码

- [ByteByteGoHq/system-design-101](https://github.com/ByteByteGoHq/system-design-101):常见系统设计概念的图解,面试前快速复习用。
- 自己的 `agentops/` 仓库:真题一最好的参考答案就是你自己做过的这个平台。准备一个 10 分钟的讲述版本,讲业务问题、关键数字、三个取舍、一个你后来推翻的决定。

## 自测

1. Staff 级和中级系统设计面试,评分上差别最大的三个维度是什么?

<details><summary>答案</summary>

估算(中级算 QPS,Staff 要找出决定架构的那个数)、深挖(中级等面试官问,Staff 主动挑最难的点按风险排序)、演进(中级很少讲,Staff 要讲 MVP、三个月、一年后分别长什么样,组织和成本怎么跟着变)。取舍和风险也有明显差别,答出其中三个、每个说清差在哪就行。

</details>

2. 真题一里,为什么说决定架构的不是 289 QPS?

<details><summary>答案</summary>

289 QPS 几台网关机器就扛得住,性能不是主要矛盾。决定架构的是:15 个团队共用一个 2500 的并发池,平均每个团队只有 167 个,一个团队跑批量就能挤爆所有人,所以必须做租户配额和隔离;每月约 82 万的模型费,必须在网关里做成本归因;再加上两次 prompt injection 泄露,工具权限必须单独设计。

</details>

3. 用利特尔定律算:平均 57.9 QPS,高峰 8 倍,单次调用 10 秒,高峰在途请求是多少?超没超 deepseek-flash 的账号上限?

<details><summary>答案</summary>

`57.9 × 8 × 10 ≈ 4,630`,是 2500 的 185%,超了。这时候单账号不够用,需要多账号或多供应商路由,同时要靠租户配额保证超出时先限批量任务、保线上流量。

</details>

4. 三层权限取交集里,bob 被注入了「退款 30 元」的指令,为什么会被拒绝?这个设计对 prompt injection 的思路是什么?

<details><summary>答案</summary>

bob 本人的授权里只有 `search_kb`,三层交集里没有 `refund`,所以拒绝。思路是不指望在模型层完全挡住注入,而是让被注入的 Agent 最多只能做「当前用户本来就能做的事」,并且大额写操作一定要人工确认。这样即使注入成功,损害也被限制在用户自己的权限和金额阈值以内。

</details>

5. 资深面试题:面试官追问「如果只有两个人、一个月,你先做这个平台的哪一部分?」你怎么答?

<details><summary>答案</summary>

先做模型网关里的租户配额和成本记账,外加工具调用的三层权限检查(可以先作为网关旁边的一个库,而不是完整的工具中心)。理由是这两件事直接对应面试官说的最痛的两个问题:额度互相挤占和安全事故;而且它们是「必经之路」,一旦所有调用都经过它们,后面加评测、加可观测都有了落点。明确不做的:托管运行时、评测平台、控制台界面(配置先用文件)。代价是第一个月业务团队体验很粗糙,只能手改配置;推翻条件是如果第一个接入的团队反馈配置成本太高、阻碍接入,第二个月优先做最小的控制台。答这题的关键是说出「不做什么」和「为什么先做这个」,而不是把所有组件都缩小一号。

</details>

## 明天预告

明天是 Day 643 · 第 92 周复习:进阶(Day 637–642)。这一周从 AgentOps 的安全加固、压测、作品包装,一路走到设计文档、立项测算和 Staff 系统设计,明天把这六天串成一张知识地图,默写一遍 `roi.py` 和三层权限的核心代码。复习完之后的 Day 644,接着讲真题二(十万并发客服 Agent)、真题三(代码 Agent 的评测体系)和追问清单。
