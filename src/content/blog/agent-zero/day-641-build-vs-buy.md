---
title: 'Day 641 · AI 立项:该不该用 AI,自己做还是买,回本测算'
description: '老板问「客服能不能上个 Agent」,资深工程师要能在一页纸里回答三件事:这个场景适不适合 AI、自己做还是买、多久回本。今天用 CloudLedger 客服当例子,先过一遍用例评估,再用 Python 把回本周期、自建和购买的交叉点、每个假设的敏感度都算出来。'
pubDate: 2026-10-22
regime: none
tags: ['roi', 'build-vs-buy', 'staff-engineer', 'python', 'agent-zero']
series: 'agent-zero'
day: 641
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 640](/blog/agent-zero/day-640-design-docs-1/) 讲了设计文档和 ADR:取舍要约束在前、同一组维度比较、承认代价、写推翻条件,还写了一个 `doc_lint.py` 检查文档里的数字有没有标「预期 / 实测 / 假设」,最后让模型扮演评审人挑刺,把意见分成三类处理。

设计文档回答的是「怎么做」。可在它之前还有一个更容易被跳过的问题:「值不值得做」。很多 Agent 项目死掉,不是因为做得不好,而是一开始就不该做,或者该买现成的。今天把这个问题拆开算清楚。

## 今天要解决的问题

学完今天,你应该能做到:

1. 用四个问题判断一个场景适不适合上 AI,以及第一期该把 AI 放在流程里的什么位置。
2. 说出「自己做还是买」要看的四件事,并用脚本算出两条成本曲线的交叉点。
3. 写一个回本测算脚本,每个假设都有名字、有注释,换一个数一秒钟重算。
4. 用敏感性分析找出最影响结论的那两三个假设,知道评审时别人会追问哪里。

预计用时:2.5 小时。前置:[Day 396](/blog/agent-zero/day-396-cost-1/)(一张工单花多少钱)、[Day 397](/blog/agent-zero/day-397-prompt-caching/)(prompt caching)、[Day 623](/blog/agent-zero/day-623-tech-selection/)(敏感性分析)、[Day 50](/blog/agent-zero/day-050-dataclass/)(dataclass)。

学法提示:先对照文章逐行敲一遍代码(不复制粘贴)并跑通;第二天合上文章,把 `roi.py` 的 `monthly()` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 立项要回答的三个问题

资深工程师经常被拉进立项讨论。老板说「客服上个 Agent 吧」,你要在一页纸里回答:这个场景适不适合用 AI;自己做还是买;多久能回本。这一页通常就是设计文档的「背景与目标」一节,也可能单独成一份立项提案。

立项(project initiation)这个词你在公司里大概听过,意思是正式决定「这件事要做,给人、给钱、给时间」。在那之前的讨论,就是今天要练的东西。

Chip Huyen 在《AI Engineering》第 1 章「Planning AI Applications」一节把这件事拆成四步:用例评估、设定预期、里程碑规划、维护。我们按这个顺序,用 CloudLedger 客服当例子。CloudLedger(云簿)是这门课一直用的那家虚构 SaaS 公司,客服每天处理账单、发票、退款类工单,SupportPilot 就是给它做的。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="立项四步:用例评估、设定预期、里程碑、维护">
<rect x="20" y="60" width="135" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="87" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">用例评估</text>
<text x="87" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">动机/角色/风险</text>
<rect x="175" y="60" width="135" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="242" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">设定预期</text>
<text x="242" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">业务数字+叫停线</text>
<rect x="330" y="60" width="135" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="397" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">里程碑</text>
<text x="397" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">能用→可靠单独排</text>
<rect x="485" y="60" width="135" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="552" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">维护</text>
<text x="552" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">谁维护/每月多少</text>
<line x1="155" y1="95" x2="175" y2="95" stroke="var(--rule)" stroke-width="2"/>
<line x1="310" y1="95" x2="330" y2="95" stroke="var(--rule)" stroke-width="2"/>
<line x1="465" y1="95" x2="485" y2="95" stroke="var(--rule)" stroke-width="2"/>
<text x="320" y="165" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">后两步的成本,就是回本测算里最常被低估的两行</text>
</svg>
<figcaption>立项四步,按 Chip Huyen《AI Engineering》第 1 章的拆法。蓝色两步决定做不做,琥珀色两步决定要花多少。</figcaption>
</figure>

## 用例评估:先问四个问题

**动机是哪一种?** 不做会被用了 AI 的竞争对手甩开;做了能明显省钱或提效;还是只是「大家都在做,我们也试试」。第三种最常见,也最该先做两周的小实验,而不是立项。

**AI 在流程里是关键路径还是辅助?** 关键路径是 AI 错了业务就错了,比如 Agent 直接给客户退款。辅助是 AI 给建议、人来定,比如 Agent 起草回复、客服点发送。

**被动还是主动?** 被动是用户问了才答,主动是 AI 自己发现问题去处理,比如半夜扫一遍账单、发现重复扣款就自动发邮件。

**错了代价多大、能不能撤回?** 答错一个「发票在哪下载」,用户再问一次就好;错发一笔退款,钱就出去了。

关键路径加主动出击加不可撤回,这个组合风险最高,第一期别选它。CloudLedger 的退款一直让人来批,就是把 AI 放在辅助位置上。[Day 619](/blog/agent-zero/day-619-agent-ux-1/) 讲过自主程度和动作分级,这里的判断和那边是同一套,只是现在是站在立项的角度:第一期选风险低的那一档,用它攒数据、攒信任,再往上放权。

**设定预期**要写成业务方关心的数字,不是模型指标。「准确率 92%」老板听不懂,也不关心。客服场景常用的是:多少比例的工单完全不用人工(自动解决率)、客服处理一张工单的平均时长降了多少、客户满意度不能降多少、答错造成的赔付不能超过多少。还要写清「叫停线」:比如试点两个月,自动解决率低于 30% 就不扩大。有了这条线,做到一半时才能理直气壮地叫停,而不是因为「已经投了三个月」硬着头皮做下去。

**里程碑**最容易低估最后一段。LinkedIn 工程博客公开写过他们做生成式 AI 产品的经历:第一个月就做到了想要体验的 80%,之后又花了四个多月才超过 95%。原文是「The team achieved 80% of the basic experience we were aiming to provide within the first month and then spent an additional four months attempting to surpass 95%」。排期时别按第一个月的速度线性外推,把「从能用到可靠」单独排成一个阶段,并且给它定一个退出条件。

**维护**是模型会换代、价格会变、供应商 API 会改、评测集要跟着业务更新。立项时就要算进「谁来维护、每个月花多少人力」,这一项是自建方案里最常被漏掉的成本,一会儿算账时它占了大头。

## 自己做还是买:看四件事

这是今天的第一个新概念,英文叫 build vs buy。同一个「客服 Agent」需求,2026 年至少有三条路:直接买 SaaS,比如 Intercom 的 Fin;用 Dify 这类平台自部署搭([Day 336](/blog/agent-zero/day-336-low-code-1/) 讲过);完全自建,也就是 SupportPilot 那条路。

我 2026 年 10 月 22 日查了 [Intercom 定价页](https://www.intercom.com/pricing):Fin 按「outcome」计费,每个 0.99 美元;客服席位另算,Essential、Advanced、Expert 三档分别是每席位每月 29、85、132 美元。outcome 大致是「Fin 独立解决了一次对话」,具体口径以它的条款为准。这种按结果收费的模式在 2025、2026 年越来越多,好处是量小时很便宜,问题是量大了会超过自建的边际成本。

判断的关键不是哪个技术上更好,而是下面四件事:

- **差异化在哪。** 如果客服回答的质量就是你产品的卖点,或者需要深度接你自己的账单库和退款审批流,自建或平台方案更合适;如果只是回答标准 FAQ,买现成的通常更快更便宜。
- **数据能不能给第三方、能不能出境。** 国内公司把客户数据交给海外 SaaS,很多时候合规上就过不去,这一条可以直接一票否决。
- **量有多大。** 按次计费在量小时划算,量大时不划算,中间有个交叉点,值得算出来写进文档。下面第二个脚本就算这个。
- **有没有人长期维护。** 没有的话,自建出来的系统半年后会变成没人敢动的东西。

前两条是定性的,后两条能算。我们先把回本算出来。

## 第一步:模型费到底多少钱

回本测算里有一行是「模型和检索的费用」,很多人第一反应觉得这一行最大。先算一下。在 `agent-zero-lab/` 根目录建 `part10/model_cost.py`,它用到 [Day 136](/blog/agent-zero/day-136-llm-client-2/) 写的 `common/llm.py`。价格是我 2026 年 10 月 22 日在 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 查的:`deepseek-flash` 高峰时段输入缓存命中 0.04 元、未命中 2 元、输出 8 元,都是每百万 token;空闲时段是一半。

```python
# agent-zero-lab/part10/model_cost.py
from common.llm import LLMClient

PRICE = {"hit": 0.04, "miss": 2.0, "out": 8.0}  # deepseek-flash 高峰价,元/百万 token,2026-10-22 查

def per_ticket(calls: int, prompt: int, hit_rate: float, completion: int) -> float:
    hit = prompt * hit_rate
    miss = prompt - hit
    one = (hit * PRICE["hit"] + miss * PRICE["miss"] + completion * PRICE["out"]) / 1_000_000
    return calls * one

SYSTEM = "你是云簿 CloudLedger 的客服助手。只根据帮助中心回答,不确定就转人工。" + "帮助中心:发票可在「账单-发票」下载;退款 7 个工作日内原路退回;" * 20
TICKET = "我上个月被扣了两次 99 元,发票也只有一张,能退一笔吗?"

if __name__ == "__main__":
    print(f"公式估算:¥{per_ticket(calls=3, prompt=6000, hit_rate=0.6, completion=400):.4f} / 张")
    llm = LLMClient()
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": TICKET}]
    for i in range(2):
        r = llm.chat(msgs, max_tokens=300)
        print(f"第 {i + 1} 次:输入 {r.prompt_tokens}(命中 {r.cache_hit_tokens})/ 输出 {r.completion_tokens},¥{r.cost:.5f}")
    print(llm.ledger)
```

<div class="line-notes">

- `PRICE = {"hit": 0.04, "miss": 2.0, "out": 8.0}` 三个单价。缓存命中比未命中便宜 50 倍,这就是 [Day 397](/blog/agent-zero/day-397-prompt-caching/) 要你把系统提示词放前面、保持前缀稳定的原因。
- `def per_ticket(calls: int, prompt: int, hit_rate: float, completion: int) -> float:` 一张工单的模型费。`calls` 是一张工单要调几次模型(分类、检索后回答、自检,算 3 次),`prompt` 是每次平均输入多少 token,`hit_rate` 是其中多大比例命中缓存。
- `hit = prompt * hit_rate` 代入 `6000 × 0.6 = 3600` 个命中 token。
- `miss = prompt - hit` 剩下 2400 个按全价。
- `one = (hit * PRICE["hit"] + miss * PRICE["miss"] + completion * PRICE["out"]) / 1_000_000` 一次调用:`3600×0.04 + 2400×2 + 400×8 = 144 + 4800 + 3200 = 8144`,除以一百万是 ¥0.008144。`1_000_000` 里的下划线只是方便读,和 JS 的 `1_000_000` 一样。
- `return calls * one` 乘 3 次,¥0.0244。
- `SYSTEM = "你是云簿 CloudLedger 的客服助手。` 一个假的系统提示词,把一句帮助中心内容重复 20 次,凑出几百个 token,这样第二次调用才有足够长的前缀能命中缓存。字符串乘整数是重复,昨天用过。
- `TICKET = "我上个月被扣了两次 99 元` 一张典型的 CloudLedger 工单。
- `for i in range(2):` 同样的消息发两次,看第二次的缓存命中。
- `r = llm.chat(msgs, max_tokens=300)` `max_tokens` 限制输出长度,防止它写长文。
- `print(f"第 {i + 1} 次:输入 {r.prompt_tokens}(命中 {r.cache_hit_tokens})` `cache_hit_tokens` 是 `LLMClient` 从 DeepSeek 返回的 `prompt_cache_hit_tokens` 字段读出来的。
- `print(llm.ledger)` `Ledger` 累计了这个客户端所有调用的 token 和花费。

</div>

```bash
uv run python -m part10.model_cost
```

实跑输出:

```text
公式估算:¥0.0244 / 张
第 1 次:输入 488(命中 0)/ 输出 62,¥0.00147
第 2 次:输入 488(命中 256)/ 输出 81,¥0.00112
2 次调用 | 输入 976 / 输出 143 tokens | 约 ¥0.0026
```

第二次命中了 256 个 token,花费从 ¥0.00147 降到 ¥0.00112,虽然输出还多了 19 个 token。DeepSeek 的缓存是按块存的,488 个 token 里只有前 256 个凑成了完整的块,所以没有全部命中。真实的客服 Agent 每次调用要带系统提示词、工具定义、检索回来的文档,输入在几千 token,所以公式里用了 6000。

结论很清楚:一张工单的模型费是两三分钱。就算你在 [Day 396](/blog/agent-zero/day-396-cost-1/) 实测出来的数字比这高十倍,也就三毛钱。一会儿你会看到,在回本测算里模型费几乎可以忽略,真正的大头在别处。

## 第二步:回本测算

这是今天的第二个新概念。**回本周期(payback period)= 一次性投入 ÷ 每月净收益**。比如开发花了 6 万,上线后每月净省 7,500,那 8 个月回本。概念很简单,难的是每月净收益里那一串假设。

我们把每个假设都写成一个有名字、有注释的字段,放进 dataclass。dataclass 在 [Day 50](/blog/agent-zero/day-050-dataclass/) 学过,相当于一个带类型、带默认值的 TS `interface` 加构造函数。`part10/roi.py`:

```python
# agent-zero-lab/part10/roi.py
from dataclasses import dataclass, replace

@dataclass
class Assumptions:
    tickets: int = 3000            # 每月工单数(假设)
    human_minutes: float = 12      # 人工处理一张的分钟数(假设)
    wage_per_hour: float = 60      # 客服全成本 元/小时(假设)
    auto_rate: float = 0.40        # 完全自动解决的比例(假设,要试点验证)
    draft_rate: float = 0.30       # Agent 起草、人工审核的比例(假设)
    draft_minutes: float = 5       # 审核一张草稿的分钟数(假设)
    model_per_ticket: float = 0.0244  # 模型费 元/张(按 DeepSeek 价格算,见正文)
    infra: float = 800             # 服务器+数据库+可观测 元/月(假设)
    maintain: float = 7500         # 0.25 个工程师 元/月(假设)
    error_rate: float = 0.02       # 自动解决里答错的比例(假设)
    error_cost: float = 200        # 一次答错的平均损失 元(假设)
    build_cost: float = 60000      # 一次性开发:2 人 × 1 个月(假设)

def monthly(a: Assumptions) -> dict[str, float]:
    per_min = a.wage_per_hour / 60
    saved_auto = a.tickets * a.auto_rate * a.human_minutes * per_min
    saved_draft = a.tickets * a.draft_rate * (a.human_minutes - a.draft_minutes) * per_min
    model = a.tickets * a.model_per_ticket
    errors = a.tickets * a.auto_rate * a.error_rate * a.error_cost
    spend = model + a.infra + a.maintain + errors
    return {"省下": saved_auto + saved_draft, "花掉": spend, "其中答错": errors,
            "净收益": saved_auto + saved_draft - spend}

def payback_months(a: Assumptions) -> float:
    net = monthly(a)["净收益"]
    return a.build_cost / net if net > 0 else float("inf")

if __name__ == "__main__":
    base = Assumptions()
    for k, v in monthly(base).items():
        print(f"{k}: ¥{v:,.0f}")
    print(f"回本: {payback_months(base):.1f} 个月")
    bad = replace(base, auto_rate=0.20)
    print(f"自动解决率只有 20% 时:回本 {payback_months(bad):.1f} 个月")
```

<div class="line-notes">

- `from dataclasses import dataclass, replace` `replace` 是今天新用的:复制一个 dataclass 实例并改掉其中几个字段,相当于 JS 的 `{...base, auto_rate: 0.2}`。原对象不变。
- `tickets: int = 3000` 每个字段都写了「(假设)」。这是故意的:昨天 `doc_lint.py` 查的就是这个,立项提案里的每个数字都要能说出来源。写你自己的提案时,这些数要换成真实数据,比如工单量从客服系统导出。
- `human_minutes: float = 12` 人工处理一张工单平均 12 分钟。这个数看起来不起眼,敏感性分析会告诉你它是最要命的一个。
- `wage_per_hour: float = 60` 客服的「全成本」,不只是工资,还有社保、工位、管理成本,每小时 60 元。
- `auto_rate: float = 0.40` 40% 的工单完全不用人工。这是整张表里最需要试点数据支撑的数,评审时一定会被问「40% 哪来的」。
- `draft_rate: float = 0.30` 另外 30% 由 Agent 起草,人工审核后发出。
- `draft_minutes: float = 5` 审核一张草稿 5 分钟,比从头写的 12 分钟省 7 分钟。
- `model_per_ticket: float = 0.0244` 上一步算出来的。
- `maintain: float = 7500` 0.25 个工程师,按全成本每月 3 万元算。这一行就是「维护」那一步的成本。
- `error_rate: float = 0.02` 自动解决的那 40% 里,有 2% 答错了。
- `error_cost: float = 200` 一次答错平均损失 200 元,包括补偿、客户流失的折算、客服善后的时间。**这一行经常被忘掉**,不写的话测算会偏乐观。
- `build_cost: float = 60000` 两个工程师干一个月,一次性投入。
- `per_min = a.wage_per_hour / 60` 每分钟人力成本,60 / 60 = 1 元。
- `saved_auto = a.tickets * a.auto_rate * a.human_minutes * per_min` 自动解决省下的:`3000 × 0.4 × 12 × 1 = 14,400` 元。
- `saved_draft = a.tickets * a.draft_rate * (a.human_minutes - a.draft_minutes) * per_min` 起草省下的:`3000 × 0.3 × (12 − 5) × 1 = 6,300` 元。
- `model = a.tickets * a.model_per_ticket` `3000 × 0.0244 = 73.2` 元。和上面两行比,小了两个数量级。
- `errors = a.tickets * a.auto_rate * a.error_rate * a.error_cost` 答错的损失:`3000 × 0.4 × 0.02 × 200 = 4,800` 元。比模型费大 65 倍。
- `spend = model + a.infra + a.maintain + errors` `73 + 800 + 7500 + 4800 = 13,173` 元。
- `return {"省下": saved_auto + saved_draft,` 返回一个字典,中文键是为了打印好看。Python 字典保持插入顺序,打印出来的顺序就是这里写的顺序。
- `return a.build_cost / net if net > 0 else float("inf")` 净收益不是正数就永远回不了本,用正无穷 `float("inf")` 表示,相当于 JS 的 `Infinity`。代入 `60000 / 7527 = 7.97`。
- `for k, v in monthly(base).items():` `.items()` 拿键值对,≈ `Object.entries()`。
- `print(f"{k}: ¥{v:,.0f}")` `:,.0f` 是千分位逗号、不留小数,`20700.0` 打印成 `20,700`。
- `bad = replace(base, auto_rate=0.20)` 只改自动解决率,别的假设不动。

</div>

```bash
uv run python -m part10.roi
```

```text
省下: ¥20,700
花掉: ¥13,173
其中答错: ¥4,800
净收益: ¥7,527
回本: 8.0 个月
自动解决率只有 20% 时:回本 22.0 个月
```

这张账有几处值得停下来想。花掉的 13,173 元里,维护人力 7,500,答错的损失 4,800,模型费 73。很多人做 AI 立项时盯着模型费讨价还价,其实它在这里是零头。这和 [Day 396](/blog/agent-zero/day-396-cost-1/) 算单张工单时的感觉不一样:单看一张工单,模型费是唯一会动的数;放到整个项目里,人才是贵的。

自动解决率从 40% 掉到 20%,回本从 8 个月拉到 22 个月。22 个月对一个 Agent 项目来说基本等于不回本,因为到那时模型和供应商都换了两轮,系统很可能要重写。这就是为什么立项时要写叫停线:试点阶段先测自动解决率,低于某个值就不扩大。练习 3 会算出这个值具体是多少。

**这张表最有价值的地方不是「8 个月」这个结论,而是它逼你把假设写出来。** 评审时没人会和你争「8.0 个月」,大家会争「40% 自动解决率哪来的」「12 分钟是平均值还是中位数」。所以每个假设后面最好跟一个依据:试点数据、[Day 476](/blog/agent-zero/day-476-eval-scenarios/) 那套评测的分数、同行公开的数字。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1YY411x7NW&autoplay=0&high_quality=1" title="AI For Everyone 第二课 建立AI项目 2.5如何选择一个人工智能项目1" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>deeplearning_ai · AI For Everyone 第二课 建立AI项目 2.5如何选择一个人工智能项目1 · 7 分钟,吴恩达讲怎么挑 AI 项目:技术上可行和业务上有价值的交集。视频是 2021 年的,讲的是机器学习项目,但挑项目的思路今天照样适用。</figcaption>
</figure>

## 第三步:自己做和买,交叉点在哪

回本算的是「做这件事值不值」。接下来算「自己做还是买」。把两条路的月成本都写成工单量的函数,找它们相交的那个工单量。`part10/crossover.py`:

```python
# agent-zero-lab/part10/crossover.py
USD_CNY = 6.8          # 假设汇率(2026 年 6 月 FRED 数据约 6.76)
FIN_PER_OUTCOME = 0.99 # 美元/次,Intercom 定价页 2026-10-22 查
AUTO_RATE = 0.40       # 自动解决比例(假设,两边一样)

def buy(tickets: int) -> float:
    return tickets * AUTO_RATE * FIN_PER_OUTCOME * USD_CNY

def build(tickets: int) -> float:
    fixed = 7500 + 800 + 60000 / 12   # 维护 + 服务器 + 开发费摊到 12 个月
    return fixed + tickets * 0.0244

def crossover() -> float:
    fixed = build(0)
    per_ticket_gap = AUTO_RATE * FIN_PER_OUTCOME * USD_CNY - 0.0244
    return fixed / per_ticket_gap

if __name__ == "__main__":
    for n in (1000, 3000, 5000, 10000, 30000):
        b, s = buy(n), build(n)
        cheaper = "买" if b < s else "自建"
        print(f"{n:>6} 张/月  买 ¥{b:>8,.0f}  自建 ¥{s:>8,.0f}  更便宜:{cheaper}")
    print(f"交叉点约 {crossover():,.0f} 张/月")
```

<div class="line-notes">

- `USD_CNY = 6.8` 汇率是假设。我查到的最近一手数据是美联储 FRED 的 2026 年 6 月中旬,约 6.76。用的时候换成你算账当天的汇率。
- `FIN_PER_OUTCOME = 0.99` 每次自动解决 0.99 美元。
- `AUTO_RATE = 0.40` 两边用同一个自动解决率,这样比较才公平。现实里买来的产品和你自建的效果不一样,这本身就是一个要单独验证的假设。
- `return tickets * AUTO_RATE * FIN_PER_OUTCOME * USD_CNY` 买的方案完全是变动成本:`3000 × 0.4 × 0.99 × 6.8 = 8,078` 元。没有固定成本,量越小越便宜。
- `fixed = 7500 + 800 + 60000 / 12` 自建的固定成本:维护 7,500、服务器 800、6 万开发费摊到 12 个月是 5,000,合计 13,300 元。摊销(amortization)就是把一次性的大钱按月平摊,好和月成本放在一起比。
- `return fixed + tickets * 0.0244` 自建的变动成本只有模型费,每张两分多钱。
- `per_ticket_gap = AUTO_RATE * FIN_PER_OUTCOME * USD_CNY - 0.0244` 每多一张工单,买比自建多花多少:`0.4 × 0.99 × 6.8 − 0.0244 = 2.669` 元。
- `return fixed / per_ticket_gap` 交叉点:固定成本要靠每张工单的差价慢慢「赚回来」,`13300 / 2.669 ≈ 4,984` 张。这和回本周期是同一个思路,只是一个除以月数、一个除以工单数。
- `cheaper = "买" if b < s else "自建"` 条件表达式,≈ JS 的三元运算符。
- `print(f"{n:>6} 张/月` `:>6` 右对齐到 6 个字符宽,数字列对得齐。

</div>

```bash
uv run python -m part10.crossover
```

```text
  1000 张/月  买 ¥   2,693  自建 ¥  13,324  更便宜:买
  3000 张/月  买 ¥   8,078  自建 ¥  13,373  更便宜:买
  5000 张/月  买 ¥  13,464  自建 ¥  13,422  更便宜:自建
 10000 张/月  买 ¥  26,928  自建 ¥  13,544  更便宜:自建
 30000 张/月  买 ¥  80,784  自建 ¥  14,032  更便宜:自建
交叉点约 4,984 张/月
```

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="买和自建的月成本随工单量变化,交叉点约 5000 张">
<line x1="70" y1="210" x2="610" y2="210" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="70" y1="30" x2="70" y2="210" stroke="var(--rule)" stroke-width="1.5"/>
<text x="340" y="245" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每月工单数(0 到 10000)</text>
<text x="20" y="40" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">月成本</text>
<line x1="70" y1="210" x2="610" y2="30" stroke="var(--mem)" stroke-width="2"/>
<text x="520" y="52" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">买:按次计费</text>
<line x1="70" y1="121" x2="610" y2="120" stroke="var(--compute)" stroke-width="2"/>
<text x="470" y="140" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">自建:固定成本为主</text>
<circle cx="339" cy="120" r="5" fill="var(--paper-raised)" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="339" y1="120" x2="339" y2="210" stroke="var(--ink-faint)" stroke-dasharray="4 4"/>
<text x="339" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">约 4984</text>
<text x="200" y="195" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">左边买便宜</text>
<text x="480" y="195" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">右边自建便宜</text>
</svg>
<figcaption>按上面脚本的数字画的示意图(纵轴 0 到约 2.7 万元)。买是一条过原点的斜线,自建几乎是一条水平线,两线交在约 4,984 张/月。</figcaption>
</figure>

CloudLedger 现在每月 3,000 张,在交叉点左边,单看钱是买更便宜,每月差 5,000 多元。但这时候决定因素就回到了前面那几个非价格的问题:数据能不能交给海外 SaaS?CloudLedger 的退款要接自己的审批流,买来的产品接不接得上?如果业务预计一年内涨到 1 万张,现在自建就是在为明年省钱。

还有一点,这个交叉点只算了 AI 那部分的钱。真实比较里,买 SaaS 通常还要算席位费,练习 2 加上它;自建那边可能还要算安全审查、合规评估的一次性成本。**把交叉点写进文档,目的不是让数字替你做决定,是让讨论从「我觉得买更好」变成「我们在交叉点左边,但预计 X 个月后到右边」**。

## 第四步:哪个假设最要命

[Day 623](/blog/agent-zero/day-623-tech-selection/) 做选型报告时用过敏感性分析:把一个输入改一点,看结论变多少。这里用同样的办法,每个假设单独上下浮动 30%,看回本周期的范围有多宽,最宽的那几个就是评审时一定会被追问的地方。`part10/sensitivity.py`:

```python
# agent-zero-lab/part10/sensitivity.py
from dataclasses import asdict, replace

from part10.roi import Assumptions, payback_months

def swing(base: Assumptions, field: str, factor: float) -> tuple[float, float]:
    value = asdict(base)[field]
    low = payback_months(replace(base, **{field: value * (1 - factor)}))
    high = payback_months(replace(base, **{field: value * (1 + factor)}))
    return low, high

def fmt(months: float) -> str:
    return "不回本" if months == float("inf") else f"{months:.1f}"

if __name__ == "__main__":
    base = Assumptions()
    print(f"基准回本 {payback_months(base):.1f} 个月,每个假设单独 ±30%:")
    rows = []
    for field in asdict(base):
        low, high = swing(base, field, 0.3)
        rows.append((abs(high - low), field, low, high))
    for width, field, low, high in sorted(rows, reverse=True)[:6]:
        print(f"{field:<16}{fmt(low):>6} ~ {fmt(high):>6} 个月")
```

<div class="line-notes">

- `from dataclasses import asdict, replace` `asdict` 把 dataclass 实例转成普通字典,`{"tickets": 3000, "human_minutes": 12, ...}`,方便按字段名遍历。
- `from part10.roi import Assumptions, payback_months` 复用上一步的模型,算法只写一处。
- `value = asdict(base)[field]` 拿到某个字段的基准值,比如 `field="auto_rate"` 时是 0.4。
- `low = payback_months(replace(base, **{field: value * (1 - factor)}))` `**{...}` 把字典展开成关键字参数,相当于 JS 的 `{...base, [field]: value * 0.7}`。字段名是变量,所以只能这样写。代入 `auto_rate`,就是 `replace(base, auto_rate=0.28)`。
- `high = payback_months(replace(base, **{field: value * (1 + factor)}))` 上浮 30%,`auto_rate=0.52`。
- `return "不回本" if months == float("inf") else f"{months:.1f}"` 无穷大打印成「不回本」。
- `rows.append((abs(high - low), field, low, high))` 把范围宽度放在元组第一位,排序时就按它排。无穷大减任何数还是无穷大,所以「不回本」的那个字段会排在最前面。
- `for width, field, low, high in sorted(rows, reverse=True)[:6]:` 从宽到窄排,只看前 6 个。这种「按影响大小从上往下排」的图在咨询报告里叫龙卷风图(tornado chart),因为画出来上宽下窄像龙卷风。

</div>

```bash
uv run python -m part10.sensitivity
```

```text
基准回本 8.0 个月,每个假设单独 ±30%:
human_minutes      不回本 ~    4.0 个月
wage_per_hour     45.6 ~    4.4 个月
tickets           21.6 ~    4.9 个月
auto_rate         12.9 ~    5.8 个月
maintain           6.1 ~   11.4 个月
build_cost         5.6 ~   10.4 个月
```

这个结果我第一次跑的时候有点意外。最要命的不是自动解决率,而是**人工处理一张工单要几分钟**:从 12 分钟改成 8.4 分钟(下浮 30%),项目直接不回本。验算一下:自动解决省 `3000 × 0.4 × 8.4 = 10,080`,起草省 `3000 × 0.3 × (8.4 − 5) = 3,060`,一共 13,140,而花掉的是 13,173,净收益是负 33 元。

道理也说得通:Agent 省的是人的时间,人本来每张就只花几分钟的话,能省的天花板就很低。所以立项时最该花力气测准的,是现状:客服现在每张工单到底花多少分钟、全成本到底多少。这两个数不是 AI 指标,是业务数据,要找客服主管从系统里导出来,而不是拍脑袋。

自动解决率排第四。它重要,但它是你能通过改 Agent 去提升的;前三个是你改不了的现状。在提案里,我会把前三个的数据来源写得最详细。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19h411x7Lj&autoplay=0&high_quality=1" title="AI For Everyone 第二课 建立AI项目 2.6如何选择一个人工智能项目2" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>deeplearning_ai · AI For Everyone 第二课 建立AI项目 2.6如何选择一个人工智能项目2 · 8 分钟,接上一集,讲技术尽调和业务尽调,以及 build vs buy 的几条经验。</figcaption>
</figure>

## 把它们写进一页纸

算完以后,立项提案的核心大概就是这几段。示范,CloudLedger 客服 Agent:

> **用例。** 第一期只做账单和发票类工单的自动回答和起草,AI 在辅助位置,退款仍由人批。不做主动外呼。
>
> **预期。** 试点两个月,目标自动解决率 40%(假设,来自 SupportPilot 评测集 + 两周影子试运行)、起草覆盖 30%。叫停线:自动解决率低于 30%(对应 12 个月内回不了本)就不扩大。满意度不低于现状。
>
> **自建还是买。** 按 0.99 美元一次计,现在 3,000 张/月时买每月便宜约 5,300 元;交叉点约 5,000 张/月。选自建,理由是退款审批流要接内部系统,且客户数据不出境;代价是每月 0.25 人维护。工单量一年内若没有超过 5,000 张且审批流接口问题被 SaaS 解决,重新评估购买。
>
> **回本。** 开发 2 人月(假设),净收益每月约 7,500 元,约 8 个月回本。最敏感的是现状处理时长(下浮 30% 即不回本),已请客服主管导出近三个月真实数据核对。
>
> **里程碑。** 第 1 个月出能用的版本;第 2 到 4 个月单独排「从能用到可靠」阶段,退出条件是评测集通过率连续两周稳定。

注意这一页里每个数字后面都带了来源或标签,最后一段给「能用到可靠」单独排了三个月。这一页拿去给老板,他能问的问题你基本都提前回答了。

## 今天的文件

| 文件 | 干什么 | 花钱吗 |
| --- | --- | --- |
| `part10/model_cost.py` | 公式算一张工单的模型费,再实跑两次看缓存命中 | 两次共 ¥0.0026 |
| `part10/roi.py` | 回本测算,所有假设集中在一个 dataclass 里 | 不花 |
| `part10/crossover.py` | 买和自建的月成本曲线和交叉点 | 不花 |
| `part10/sensitivity.py` | 每个假设 ±30%,按影响大小排序 | 不花 |

## 动手练习

**练习 1:换上你自己测的模型费。** 把 `model_per_ticket` 分别换成 0.0244、0.30、1.00 元三个值,打印每月模型费、净收益和回本周期。0.30 大致是一个更贵的模型、更长的上下文时可能出现的量级,1.00 是很夸张的情况。看看模型费要涨到多少才会明显影响结论。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex641_old_cost.py
from dataclasses import replace

from part10.roi import Assumptions, monthly, payback_months

for cost in (0.0244, 0.30, 1.00):
    a = replace(Assumptions(), model_per_ticket=cost)
    m = monthly(a)
    print(f"模型 ¥{cost}/张:模型费 ¥{a.tickets * cost:,.0f}/月,净收益 ¥{m['净收益']:,.0f},回本 {payback_months(a):.1f} 个月")
```

<div class="line-notes">

- `for cost in (0.0244, 0.30, 1.00):` 三档模型费。
- `a = replace(Assumptions(), model_per_ticket=cost)` 每次从默认假设出发,只改这一个字段,其余不动,这样比较的才是模型费一个变量的影响。
- `m = monthly(a)` 拿到那个四个键的字典。
- `print(f"模型 ¥{cost}/张:模型费 ¥{a.tickets * cost:,.0f}/月` f-string 里可以写表达式,`3000 × 0.30 = 900`。`m['净收益']` 在 f-string 里用单引号,因为外层已经是双引号。

</div>

```bash
uv run python -m part10.ex641_old_cost
```

```text
模型 ¥0.0244/张:模型费 ¥73/月,净收益 ¥7,527,回本 8.0 个月
模型 ¥0.3/张:模型费 ¥900/月,净收益 ¥6,700,回本 9.0 个月
模型 ¥1.0/张:模型费 ¥3,000/月,净收益 ¥4,600,回本 13.0 个月
```

模型费涨 12 倍(0.0244 到 0.30),回本只多了 1 个月。涨到每张 1 块钱,也才 13 个月。在这个量级的客服场景里,模型选型对回本的影响比你想象的小得多,选一个效果更好但贵一点的模型,如果能把自动解决率提高几个点,大概率是划算的。

</details>

**练习 2:买的方案加上席位费。** 假设用 Intercom 时客服要 5 个 Essential 席位(每席位每月 29 美元,2026 年 10 月 22 日定价页)。写 `part10/ex641_seats.py`,重算 3,000、4,000、5,000 张时两边的月成本和新的交叉点。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex641_seats.py
from part10.crossover import AUTO_RATE, FIN_PER_OUTCOME, USD_CNY, build

SEATS = 5
SEAT_USD = 29  # Essential 档每席位每月,定价页 2026-10-22 查

def buy_with_seats(tickets: int) -> float:
    return SEATS * SEAT_USD * USD_CNY + tickets * AUTO_RATE * FIN_PER_OUTCOME * USD_CNY

def crossover_with_seats() -> float:
    gap = AUTO_RATE * FIN_PER_OUTCOME * USD_CNY - 0.0244
    return (build(0) - SEATS * SEAT_USD * USD_CNY) / gap

if __name__ == "__main__":
    print(f"席位费 ¥{SEATS * SEAT_USD * USD_CNY:,.0f}/月")
    for n in (3000, 4000, 5000):
        print(f"{n} 张:买 ¥{buy_with_seats(n):,.0f}  自建 ¥{build(n):,.0f}")
    print(f"交叉点约 {crossover_with_seats():,.0f} 张/月")
```

<div class="line-notes">

- `from part10.crossover import AUTO_RATE, FIN_PER_OUTCOME, USD_CNY, build` 常量和自建成本函数都复用,不复制数字。
- `return SEATS * SEAT_USD * USD_CNY + tickets` 买的方案多了一块固定成本:`5 × 29 × 6.8 = 986` 元/月。
- `return (build(0) - SEATS * SEAT_USD * USD_CNY) / gap` 两边都有固定成本了,交叉点 = 固定成本之差 ÷ 每张差价:`(13300 − 986) / 2.669 ≈ 4,615`。

</div>

```bash
uv run python -m part10.ex641_seats
```

```text
席位费 ¥986/月
3000 张:买 ¥9,064  自建 ¥13,373
4000 张:买 ¥11,757  自建 ¥13,398
5000 张:买 ¥14,450  自建 ¥13,422
交叉点约 4,615 张/月
```

交叉点从 4,984 降到 4,615。要注意这个比较的前提:席位费是用 Intercom 当客服工作台的钱,如果你现在已经在付另一个客服系统的席位费,换过去只是替换,不该全算进去。算账时每一行都要问一句「不做这件事,这笔钱是不是本来就要花」。

</details>

**练习 3:叫停线定在多少。** 写 `part10/ex641_min_rate.py`,用二分查找算出:要在 6、12、24 个月内回本,自动解决率最低要多少。其他假设用默认值。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/ex641_min_rate.py
from dataclasses import replace

from part10.roi import Assumptions, payback_months

def min_auto_rate(target_months: float, lo: float = 0.0, hi: float = 0.7) -> float:
    for _ in range(40):
        mid = (lo + hi) / 2
        if payback_months(replace(Assumptions(), auto_rate=mid)) <= target_months:
            hi = mid
        else:
            lo = mid
    return hi

if __name__ == "__main__":
    for months in (6, 12, 24):
        print(f"{months} 个月内回本,自动解决率至少 {min_auto_rate(months):.1%}")
```

<div class="line-notes">

- `def min_auto_rate(target_months: float, lo: float = 0.0, hi: float = 0.7) -> float:` 上限取 0.7,因为默认假设里起草覆盖了 30%,自动解决率加起草率不能超过 100%。
- `for _ in range(40):` 二分 40 次,区间缩小到 0.7 / 2⁴⁰,远小于需要的精度。`_` 表示这个循环变量用不到。二分查找的前提是「自动解决率越高,回本越快」这个单调关系,在这个模型里成立。
- `mid = (lo + hi) / 2` 取中点。
- `if payback_months(replace(Assumptions(), auto_rate=mid)) <= target_months:` 中点已经能在目标内回本,说明答案在左半边或就是它,把上界收到中点。
- `lo = mid` 否则答案在右半边。
- `{min_auto_rate(months):.1%}` `:.1%` 把 0.295 格式化成 `29.5%`。

</div>

```bash
uv run python -m part10.ex641_min_rate
```

```text
6 个月内回本,自动解决率至少 50.3%
12 个月内回本,自动解决率至少 29.5%
24 个月内回本,自动解决率至少 19.1%
```

正文一页纸里写的「叫停线 30%」就是从这里来的:12 个月回本对应约 29.5%,取整写 30%。这样叫停线就不是拍脑袋,而是「低于它,一年内回不了本」。

</details>

**练习 4:写你自己的一页纸立项提案。** 选一个你工作或生活里的场景(公司内部 IT 工单、电商售后、你自己的 readmandarin 读者问答都行),按正文最后那一页的五段结构写。要求:每个数字带来源或「假设」标签;跑一遍 `roi.py` 和 `sensitivity.py`(改成你的假设),把最敏感的两个假设写进提案并说明你打算怎么核实。

<details><summary>参考答案</summary>

示范:某公司内部 IT 服务台,每月 1,200 张工单(密码重置、VPN、软件安装),人工每张 15 分钟,IT 全成本每小时 80 元。把 `Assumptions` 改成 `tickets=1200, human_minutes=15, wage_per_hour=80, auto_rate=0.5, draft_rate=0.2, error_cost=50`,其余默认,在 Python 里直接算:

```bash
uv run python -c "
from dataclasses import replace
from part10.roi import Assumptions, monthly, payback_months
a = replace(Assumptions(), tickets=1200, human_minutes=15, wage_per_hour=80, auto_rate=0.5, draft_rate=0.2, error_cost=50)
print(monthly(a)); print(round(payback_months(a), 1))
"
```

<div class="line-notes">

- `uv run python -c "` `-c` 直接运行引号里的代码,适合这种一次性的试算,不用建文件。
- `a = replace(Assumptions(), tickets=1200,` IT 服务台的假设。密码重置这类工单答错的损失小,所以 `error_cost` 降到 50。
- `print(monthly(a)); print(round(payback_months(a), 1))` 分号让两条语句写在一行。

</div>

实跑输出:

```text
{'省下': 15200.0, '花掉': 8929.28, '其中答错': 600.0, '净收益': 6270.719999999999}
9.6
```

`6270.719999999999` 这种尾巴是浮点数的老问题,JS 里 `0.1 + 0.2` 也是 `0.30000000000000004`,打印时用 `:,.0f` 格式化就看不到了。

9.6 个月,看起来还行。但看构成:花掉的 8,929 元里,维护 7,500 元占了 84%,这个场景的工单量只有 CloudLedger 的四成,撑固定成本很吃力。把 `tickets` 改成 840(下浮 30%)再跑一次,回本拉长到 31.6 个月(实跑)。所以提案里我会写:最敏感的两个假设是工单量和维护人力;工单量从 IT 系统导出近六个月数据核对;维护人力找一个用过 Dify 的同事估,我顺手试了把 `maintain` 改成 3,000(约 0.1 人),回本是 5.6 个月(实跑),所以如果平台能把维护压到这个程度,自建就该换成平台方案。

</details>

**验收标准**:四个脚本都能跑出和文中一致的结果;一页纸提案里每个数字都有来源或标签;能指着敏感性分析的输出说出「评审时别人最可能追问的是哪两个数,我怎么核实」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 立项 | 正式决定一件事要做,给人、给钱、给时间 |
| 用例评估 | 立项前判断一个场景值不值得用 AI:动机、关键路径还是辅助、主动还是被动、错了代价多大 |
| 关键路径 / 辅助 | AI 错了业务就错了 / AI 给建议、人来定 |
| 叫停线 | 试点阶段事先定好的门槛,低于它就不扩大,比如自动解决率 30% |
| build vs buy | 自建还是购买现成产品的决策,看差异化、数据合规、量和维护能力 |
| outcome 计费 | 按结果收费,比如 Intercom Fin 每次独立解决对话 0.99 美元 |
| 回本周期 | 一次性投入 ÷ 每月净收益,8 个月回本就是 6 万 ÷ 7,500 |
| 全成本 | 一个人的工资加社保、工位、管理等所有成本,算人力时要用它 |
| 摊销 | 把一次性的大投入按月平摊,好和月成本放在一起比 |
| 交叉点 | 两种方案月成本相等时的业务量,比如约 4,984 张/月 |
| 敏感性分析 | 一个输入改一点看结论变多少,找出最影响结论的假设 |
| 龙卷风图 | 把各个假设的影响范围从宽到窄排列的图,上宽下窄 |
| `dataclasses.replace` | 复制一个 dataclass 实例并改掉部分字段,≈ JS 的 `{...obj, key: value}` |

## 常见误区

**只盯模型费。** 正文算出来模型费每月 73 元,维护人力 7,500 元。在立项讨论里为了换个便宜一半的模型争半天,不如花这时间把现状处理时长测准。

**忘了答错的成本。** 把 `error_cost` 设成 0,净收益从 7,527 变成 12,327,回本从 8 个月变成不到 5 个月。不写这一行的测算,评审时一定会被风控或客服主管指出来,而且会让整份提案的可信度掉一截。

**现状数据拍脑袋。** 敏感性分析里排第一的是人工处理时长,下浮 30% 项目就不回本。这个数要从客服系统导出来,不能用「我感觉大概十几分钟」。

**把第一个月的进度线性外推。** LinkedIn 一个月到 80%、又花了四个多月才过 95%。排期里不单独排「能用到可靠」的阶段,第二个月就会开始延期。

**买和建只比价格。** 交叉点算出来以后,决定往往还是靠数据合规、能不能接内部系统、有没有人维护这些非价格因素。交叉点的作用是让讨论有个共同的数字基础,不是替你做决定。

**算席位费时重复计算。** 练习 2 加了 5 个席位的钱,但如果现在已经在付别家客服系统的席位,换过去只是替换。每一行都要问「不做这件事,这笔钱是不是本来就要花」。

**没有叫停线就开工。** 做到第三个月效果不好,没有事先定的门槛,团队很难开口说停,最后变成「已经投了这么多,再坚持一下」。

## 学习资料

### 文档与文章

- [LinkedIn Engineering · Musings on building a Generative AI product](https://www.linkedin.com/blog/engineering/generative-ai/musings-on-building-a-generative-ai-product):「一个月到 80%、再四个多月才过 95%」的原文,排里程碑之前读一遍,20 分钟。
- [Chip Huyen《AI Engineering》目录](https://github.com/chiphuyen/aie-book/blob/main/ToC.md):先看第 1 章各节标题,知道立项要回答哪几个问题。
- [Intercom 定价页](https://www.intercom.com/pricing):买现成客服 AI 的真实价格参照,算交叉点时用,价格会变,用之前重新查。
- [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天模型费的来源,注意高峰和空闲时段价格不同。
- [Chip Huyen:Building A Generative AI Platform](https://huyenchip.com/2024/07/25/genai-platform.html):自建方案到底要建哪些组件,估维护人力时可以对着它数。

### B 站视频

- deeplearning_ai 的《AI For Everyone》第二课 2.5、2.6 两集已经嵌在正文里,一共 15 分钟。这门课整体偏入门,今天只看这两集。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/qbvY0dQgSJ4" title="Al Engineering 101 with Chip Huyen (Nvidia, Stanford, Netflix)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lenny's Podcast · AI Engineering 101 with Chip Huyen · 一期长访谈,今天只需要听她讲企业怎么判断该不该做一个 AI 应用、为什么很多项目卡在「能用到可靠」那一段。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Jt6j5jb31zY" title="How Intercom Built the Highest-Performing AI Agent Using Outcome Based Pricing" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>GTMnow · How Intercom Built the Highest-Performing AI Agent Using Outcome Based Pricing · 卖方视角讲按结果计费,听听他们为什么这么定价,反过来理解买方的交叉点。</figcaption>
</figure>

### 书籍

- Chip Huyen,《AI Engineering: Building Applications with Foundation Models》,O'Reilly,2025。第 1 章「Planning AI Applications」一节(用例评估、设定预期、里程碑规划、维护)是今天的底子,半小时能读完。O'Reilly 平台上有机器翻译的中文版《AI工程》,没查到大陆出版社的正式中译本。

### 开源项目与代码

- 今天这组不需要。四个脚本都只用标准库和 `common/llm.py`,自己敲一遍比读别人的代码有用。

## 自测

1. 回本周期怎么算?CloudLedger 的例子里,为什么说「8 个月」这个结论本身没那么重要?

<details><summary>答案</summary>

一次性投入 ÷ 每月净收益,6 万 ÷ 7,527 ≈ 8 个月。结论本身没那么重要,是因为评审时没人会争 8.0 还是 8.5,大家会争「40% 自动解决率哪来的」「12 分钟是怎么测的」。测算的价值在于把假设一条条写出来,让讨论落到具体的数上。

</details>

2. 自建和购买的交叉点约 4,984 张/月,CloudLedger 现在 3,000 张。是不是就该买?

<details><summary>答案</summary>

单看钱是买便宜,每月约便宜 5,300 元。但还要看非价格因素:客户数据能不能交给海外 SaaS(国内公司常常一票否决)、退款审批流要不要接内部系统、业务量一年后会不会过交叉点、有没有人长期维护自建系统。交叉点让讨论有共同的数字基础,决定还得综合这几条。

</details>

3. 敏感性分析里,为什么「人工处理时长」比「自动解决率」更要命?这对立项有什么启发?

<details><summary>答案</summary>

Agent 省的是人的时间,省钱的天花板就是「人本来花多少时间」。人工处理时长从 12 分钟降到 8.4 分钟,起草和自动解决能省的钱一起往下掉,净收益变成负 33 元,永远回不了本。启发是:立项时最该花力气测准的是现状数据,这些是业务数据,要从客服系统里导出,不是模型指标。

</details>

4. 用例评估时,哪种组合风险最高、第一期别选?CloudLedger 第一期怎么选的?

<details><summary>答案</summary>

关键路径(AI 错了业务就错)加主动出击(AI 自己发起动作)加不可撤回(比如打款)。CloudLedger 第一期只做账单发票类工单的自动回答和起草,AI 在辅助位置,退款仍由人批,不做主动外呼。

</details>

5. 资深面试题:老板说「客服上个 Agent,下个月上线」。你会在立项文档里先写清楚哪几件事,才同意排期?

<details><summary>答案</summary>

四件事。一是用例:AI 是辅助还是关键路径,第一期选风险低的那部分(起草加人工审核,退款仍由人批)。二是可测的成功标准和叫停线:自动解决率、处理时长、满意度不降、答错赔付上限,叫停线要能算出来(比如低于 30% 一年内不回本)。三是自建还是买:比较按次计费的 SaaS、平台自部署和完全自建,写清差异化、数据合规、量的交叉点和维护人力。四是回本测算和里程碑:每个假设写依据,点出最敏感的两三个怎么核实,把「从能用到可靠」单独排期。所以「下个月上线」只能是试点范围,不是全量。答的时候要体现取舍:不是说「不行」,而是说「下个月能上的是什么,全量要满足什么条件」。

</details>

## 明天预告

明天是 Day 642 · Staff 系统设计(一):面试官看什么,45 分钟框架,真题一。这两天写的设计文档和立项测算,到了面试里要能在 45 分钟的白板上讲出来。明天先看 Staff 面试官和中级面试官打分差在哪,再用一个固定的时间框架完整答一遍「设计一个企业级 Agent 平台」,估算那一步会用到今天这种「找出决定结论的那个数」的思路。
