---
title: 'Day 329 · 多 Agent(一):两篇吵架的文章,多 Agent 带来什么'
description: '多 Agent 是最热也最容易被滥用的架构。先读 Cognition 和 Anthropic 2025 年 6 月那两篇观点相反的文章,再看 Cognition 2026 年 4 月的续篇改口改在哪;然后用三个不调模型的小脚本把取舍算清楚:拆不拆得开、并行省多少时间、token 多花多少。'
pubDate: 2026-10-23
regime: none
tags: ['multi-agent', 'python', 'agent-zero']
series: 'agent-zero'
day: 329
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 328](/blog/agent-zero/day-328-week47-review/) 是第 47 周的复习:时间旅行、三种 stream_mode、子图三件工具,加上一个由事件驱动、停在收件箱等人的后台 Agent。那一整周,系统里始终只有**一个** Agent,一张工单从头到尾归它管。

这周换个问题:一件事交给好几个 Agent 分工,是变强了还是变乱了?招聘 JD 里「多智能体」「Multi-Agent」出现得很多,面试官问到它,想听的通常不是「我用过某某框架」,而是你知不知道多 Agent 什么时候有用、什么时候是在烧钱。今天先不写一行调模型的代码,把这个取舍想清楚,明天再动手搭。

## 今天要解决的问题

学完今天,你要能做到:

1. 用具体数字讲清 Cognition 和 Anthropic 两篇文章各自的论点,以及 Cognition 2026 年的续篇改了什么、没改什么。
2. 说出多 Agent 真正能带来的三种收益和两个代价。
3. 拿到一个任务,能用「有没有先后依赖」「有没有共同要拍板的决定」两个问题判断它拆不拆得开,并用 `split_check.py` 跑出结论。
4. 用 `token_bill.py` 这个小模型解释:为什么有时多 Agent 只多花两成 token,有时会多花好几倍。

预计用时 2 小时:读两篇原文 40 分钟,三个脚本各 15 分钟,练习 30 分钟。前置:[Day 67](/blog/agent-zero/day-067-async-2/) 和 [Day 68](/blog/agent-zero/day-068-async-3/) 的 `async`、`await`、`asyncio.gather`;[Day 109](/blog/agent-zero/day-109-context-window/) 的上下文窗口;[Day 170](/blog/agent-zero/day-170-agent-full/) 的 Agent 循环;[Day 200](/blog/agent-zero/day-200-orchestrator/) 的编排者-工作者模式。今天所有脚本都不调模型,一分钱不花。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `run_loop()` 和 `check()` 默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

## 先说清楚:什么叫多 Agent

[Day 170](/blog/agent-zero/day-170-agent-full/) 写的 Agent 是一个循环:调模型,模型要工具就执行工具,把结果塞回 messages,再调模型,直到模型不再要工具。一个 Agent 就是「一份系统提示词 + 一组工具 + 一个不断变长的 messages 列表」。

**多 Agent(multi-agent)** 就是同时有好几个这样的循环,每个都有自己的系统提示词、自己的工具、自己的 messages,它们之间通过某种方式传话。打个前端的比方:单 Agent 像一个巨大的 React 组件,所有状态都在它自己身上;多 Agent 像几个组件,各管各的 state,靠 props 和回调传数据。组件拆开以后,每个都更好读,但「数据怎么在组件之间流」立刻变成了新问题。多 Agent 也一样,难点从来不在单个 Agent,而在它们之间传什么、传多少。

这里容易和 [Day 200](/blog/agent-zero/day-200-orchestrator/) 搞混。Day 200 的编排者-工作者是一种**工作流**:编排者调一次模型把任务拆开,每个工作者也只是调一次模型,没有循环、没有工具。今天说的多 Agent,每个「工作者」自己就是一个完整的 Agent 循环,能自己决定查几次工具。结构图长得像,但每个格子里装的东西重得多。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="左边是单 Agent:一份 messages 里装着系统提示词、用户问题、所有工具调用和结果;右边是多 Agent:主管一份 messages,两个专员各一份 messages,中间只传任务描述和结论">
  <rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="12">
    <text x="150" y="24" text-anchor="middle" fill="var(--ink)">单 Agent</text>
    <rect x="40" y="36" width="220" height="196" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="150" y="58" text-anchor="middle" fill="var(--ink-soft)">一份 messages</text>
    <g font-size="11" fill="var(--ink)">
      <text x="56" y="84">system</text>
      <text x="56" y="104">user 的问题</text>
      <text x="56" y="124">调 find_customer</text>
      <text x="56" y="144">  结果 600 token</text>
      <text x="56" y="164">调 list_invoices</text>
      <text x="56" y="184">  结果 600 token</text>
      <text x="56" y="204">调 search_help</text>
      <text x="56" y="224">  结果 600 token …越来越长</text>
    </g>
    <text x="470" y="24" text-anchor="middle" fill="var(--ink)">多 Agent</text>
    <rect x="390" y="36" width="160" height="54" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="470" y="58" text-anchor="middle" fill="var(--ink)">主管的 messages</text>
    <text x="470" y="78" text-anchor="middle" font-size="11" fill="var(--ink-soft)">只有任务和结论</text>
    <rect x="300" y="140" width="150" height="92" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="375" y="162" text-anchor="middle" fill="var(--ink)">账务的 messages</text>
    <text x="375" y="184" text-anchor="middle" font-size="11" fill="var(--ink-soft)">客户、发票结果</text>
    <text x="375" y="202" text-anchor="middle" font-size="11" fill="var(--ink-soft)">留在这里</text>
    <rect x="480" y="140" width="150" height="92" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="555" y="162" text-anchor="middle" fill="var(--ink)">技术的 messages</text>
    <text x="555" y="184" text-anchor="middle" font-size="11" fill="var(--ink-soft)">帮助文章结果</text>
    <text x="555" y="202" text-anchor="middle" font-size="11" fill="var(--ink-soft)">留在这里</text>
    <g stroke="var(--ink-soft)" fill="none">
      <line x1="440" y1="90" x2="380" y2="140"/>
      <line x1="500" y1="90" x2="550" y2="140"/>
    </g>
    <text x="470" y="122" text-anchor="middle" font-size="10" fill="var(--ink-faint)">往下:任务描述 往上:结论</text>
  </g>
</svg>
<figcaption>同样查客户、发票、帮助中心三样东西。单 Agent 把所有工具结果都堆在一份上下文里;多 Agent 把它们分散在专员各自的上下文里,主管只看到几句话。</figcaption>
</figure>

## 两篇吵架的文章

2025 年 6 月,两家做 Agent 最出名的公司隔了一天各发了一篇文章,结论几乎相反。这两篇到今天还是理解多 Agent 最好的入口,建议先读原文再往下看(链接在文末「学习资料」)。

**6 月 12 日,Cognition(做编程 Agent Devin 的公司)发了《Don't Build Multi-Agents》**,作者 Walden Yan。他举的例子是让 Agent 做一个 Flappy Bird 克隆:主 Agent 把任务拆成「做会动的背景和绿色水管」「做一只上下飞的小鸟」两个子任务,交给两个子 Agent。结果一个子 Agent 理解偏了,做出了超级马里奥风格的背景;另一个做的鸟既不像游戏素材,飞起来也不像 Flappy Bird。最后汇总的那个 Agent 手里是两块拼不到一起的东西。他又试了一版,把原始任务也抄给子 Agent,结果两边画风还是对不上,因为它们看不到彼此在做什么。

他从这个例子里总结了两条原则。第一条:**共享上下文,而且要共享完整的执行轨迹,不只是几条消息**。第二条:**每个动作都隐含着决定,相互冲突的决定会带来坏结果**。画背景这个动作,隐含着「画风是什么」「画面多大」这些决定;画小鸟也隐含着「画风是什么」。两个子 Agent 各自拍板,冲突就是必然的。他的建议是默认用单线程的线性 Agent;任务长到上下文装不下时,用一个专门的模型把历史压缩成关键事件和决定,并且承认这个压缩很难做好。

**6 月 13 日,Anthropic 发了《How we built our multi-agent research system》**,讲的是 Claude 的 Research 功能。一个主 Agent(Claude Opus 4)负责规划,并行派出 3 到 5 个子 Agent(Claude Sonnet 4)去搜不同方向,子 Agent 内部也会同时调 3 个以上工具,最后主 Agent 汇总。在他们内部的研究类评测上,这套系统比单个 Opus 4 Agent 高出 90.2%;复杂问题上,并行让研究时间最多缩短了 90%。

但同一篇文章也很坦白地写了代价:**普通 Agent 消耗的 token 大约是聊天的 4 倍,多 Agent 系统大约是 15 倍**。他们在 BrowseComp 这个评测上做了分析,三个因素能解释 95% 的表现差异,其中**光是 token 用量一项就解释了 80%**,另外两个是工具调用次数和模型选择。换句话说,多 Agent 效果好,很大一部分原因是它花了更多 token 去干更多活。文章还明确说,需要所有 Agent 共享同一份上下文、Agent 之间依赖很多的领域不适合多 Agent,大多数编程任务就属于这一类。

把两篇放在一起看,其实不矛盾。研究类任务天然能拆成互不相干的方向(查 A 公司、查 B 公司),每个子 Agent 只需要知道自己那一块,汇总时也不太会冲突;写代码、做设计这类任务,每一步都依赖前面的决定,拆开就会出 Flappy Bird 那种事。**能不能拆,取决于子任务之间的依赖有多少。** 这句话就是面试里回答「什么时候用多 Agent」的核心。

## 2026 年 4 月,Cognition 又写了一篇

十个月后,2026 年 4 月 22 日,Walden Yan 发了续篇《Multi-Agents: What's Actually Working》。很多人把它读成「Cognition 改口了」,细看会发现改的范围很窄。

没改的部分:让好几个 Agent 同时写代码(文中叫 parallel-writer swarms)依然不行,原因还是那条「各自做隐含决定会冲突」;让一群 Agent 随意互相谈判的结构,他直接说「大多是在分心」,实际能用的形状是「map-reduce 加一个管事的」。

改了的部分是这样一个模式:**写操作只留在一个 Agent 手里,其他 Agent 只贡献判断,不动手**。原文的话是「writes stay single-threaded and the additional agents contribute intelligence rather than actions」。他列了几种已经在 Devin 里跑通的用法:

- 一个写代码,一个审代码。Devin Review 平均在每个 Devin 写的 PR 里找出 2 个 bug,其中约 58% 是严重的。审查者用一份干净的上下文效果最好,不带写代码那一方之前的对话。
- 主 Agent 碰到难题时,把上下文分一份给一个更强的模型去问意见。前提是主 Agent 自己不能太弱,否则上限卡在它身上。
- 只读的子 Agent:去网上搜、去代码库里搜,搜完交回结论。
- 一个管理者 Agent 拆大任务、协调几个子 Devin。这个能用,但他们花了不少功夫解决管理者指令写得过细、子 Agent 误以为彼此共享状态这些问题。

这篇续篇其实把 2025 年那两篇的结论收拢到了一起:**能并行的是「查」和「审」,不能并行的是「改」**。研究系统里子 Agent 只查不改,所以拆得开;Flappy Bird 里两个子 Agent 都在「改」同一个作品,所以拆不开。

## 第 1 步:拆之前先体检

把上面的道理变成两个能问出口的问题:

1. 子任务之间有没有先后依赖?后一个要用前一个的结果,就只能排队。
2. 有没有两个子任务要各自拍板同一个决定?有,就是 Cognition 说的冲突风险。

写个小脚本把这两个问题自动问一遍。先建今天的目录(`agent-zero-lab` 是 [Day 10](/blog/agent-zero/day-010-uv-1/) 建的练习仓库,`part05/` 是第五部分的目录):

```bash
cd ~/agent-zero-lab
mkdir -p part05/multi
cd part05/multi
```

```python
# agent-zero-lab/part05/multi/split_check.py
"""拆之前先体检:子任务之间有没有先后依赖,有没有共同要拍板的隐含决定。"""

TASKS = {
    "客服两件事": {
        "查扣款": {"needs": [], "decides": ["退款金额"]},
        "查导出报错": {"needs": [], "decides": ["排查步骤"]},
    },
    "做 Flappy Bird": {
        "画背景和水管": {"needs": [], "decides": ["画风", "画面尺寸"]},
        "画小鸟": {"needs": [], "decides": ["画风", "下落速度"]},
        "拼成游戏": {"needs": ["画背景和水管", "画小鸟"], "decides": ["画面尺寸"]},
    },
}


def check(tasks: dict[str, dict[str, list[str]]]) -> None:
    free = [name for name, t in tasks.items() if not t["needs"]]
    waits = {name: t["needs"] for name, t in tasks.items() if t["needs"]}
    print(f"  可以同时开工:{free}")
    for name, needs in waits.items():
        print(f"  {name} 要等:{needs}")
    owners: dict[str, list[str]] = {}
    for name, t in tasks.items():
        for d in t["decides"]:
            owners.setdefault(d, []).append(name)
    clashes = {d: who for d, who in owners.items() if len(who) > 1}
    for d, who in clashes.items():
        print(f"  冲突风险:「{d}」由 {who} 各自决定")
    verdict = "适合拆" if len(free) > 1 and not clashes else "先别拆,或者先把共同决定定好再拆"
    print(f"  结论:{verdict}")


if __name__ == "__main__":
    for title, tasks in TASKS.items():
        print(title)
        check(tasks)
```

<div class="line-notes">

- `TASKS = {` 一个两层的字典(dict,相当于 JS 的嵌套对象):第一层是任务名,第二层是这个任务拆出来的子任务。每个子任务有两个键,`needs` 是它要等哪些子任务先做完,`decides` 是它做的时候会顺手拍板哪些事。
- `"查扣款": {"needs": [], "decides": ["退款金额"]},` 查扣款不用等任何人,会决定「退多少钱」。
- `"画背景和水管": {"needs": [], "decides": ["画风", "画面尺寸"]},` 这就是 Cognition 说的「动作隐含决定」:画背景的人,画的同时就定下了画风和画面尺寸,没人通知它这两件事别人也在定。
- `"拼成游戏": {"needs": ["画背景和水管", "画小鸟"], "decides": ["画面尺寸"]},` 拼装要等两块素材都做完,而且它也要定画面尺寸。
- `def check(tasks: dict[str, dict[str, list[str]]]) -> None:` 参数类型读作「字典,键是子任务名,值是一个『键是字符串、值是字符串列表』的字典」。`dict[str, ...]` 这种容器类型是 [Day 46](/blog/agent-zero/day-046-type-hints-2/) 学的。
- `free = [name for name, t in tasks.items() if not t["needs"]]` 列表推导式,相当于 JS 的 `Object.entries(tasks).filter(([n, t]) => t.needs.length === 0).map(([n]) => n)`。空列表在 Python 里是假值,`not []` 是 `True`。客服那组跑出来是 `['查扣款', '查导出报错']`。
- `waits = {name: t["needs"] for name, t in tasks.items() if t["needs"]}` 字典推导式,只留下要等别人的子任务。Flappy Bird 那组是 `{'拼成游戏': ['画背景和水管', '画小鸟']}`。
- `owners: dict[str, list[str]] = {}` 反过来记账:每个决定由哪些子任务在拍板。
- `owners.setdefault(d, []).append(name)` `setdefault` 的意思是「键不存在就先放一个空列表,然后把这个列表返回」,所以可以直接 `.append`。跑完 Flappy Bird 那组,`owners` 是 `{'画风': ['画背景和水管', '画小鸟'], '画面尺寸': ['画背景和水管', '拼成游戏'], '下落速度': ['画小鸟']}`。
- `clashes = {d: who for d, who in owners.items() if len(who) > 1}` 同一个决定有两个以上的子任务在拍板,就是冲突风险。
- `verdict = "适合拆" if len(free) > 1 and not clashes else "先别拆,或者先把共同决定定好再拆"` 条件表达式,相当于 JS 的三元运算 `a ? b : c`。能同时开工的超过一个、并且没有冲突,才说适合拆。
- `if __name__ == "__main__":` 直接运行这个文件时才执行下面的代码,别的文件 `import` 它时不执行。练习里会 import `check`,所以要有这一行。

</div>

```bash
uv run python split_check.py
```

实跑输出:

```text
客服两件事
  可以同时开工:['查扣款', '查导出报错']
  结论:适合拆
做 Flappy Bird
  可以同时开工:['画背景和水管', '画小鸟']
  拼成游戏 要等:['画背景和水管', '画小鸟']
  冲突风险:「画风」由 ['画背景和水管', '画小鸟'] 各自决定
  冲突风险:「画面尺寸」由 ['画背景和水管', '拼成游戏'] 各自决定
  结论:先别拆,或者先把共同决定定好再拆
```

注意 Flappy Bird 那组的「可以同时开工」也有两个子任务。只看依赖,它看起来完全可以并行,这正是它骗人的地方:依赖图上没有边,不代表没有冲突。拆任务的人往往只想到第一个问题,忘了第二个。

当然,这个脚本里的 `decides` 是我手填的,真实任务里最难的恰恰是把隐含决定找全。脚本的价值不在自动判断,而在逼你在拆之前把这两列写出来。写不出来,说明你对任务还没想清楚,更不该急着拆给几个 Agent。

## 多 Agent 到底带来什么

把各家文档和上面三篇文章的观点归拢一下,多 Agent 真正的收益只有三种。

**并行。** 子任务互不依赖时,同时跑能把总耗时压下来。Anthropic 说复杂问题上研究时间最多缩短 90%,靠的就是同时派出几个子 Agent。注意前提是「互不依赖」,有依赖的部分照样得排队。

**上下文隔离。** 这一点最容易被低估。一个子 Agent 去翻 30 个网页,中间产生的几万 token 搜索结果留在它自己的 messages 里,只把几百字的结论交回给主 Agent,主 Agent 的上下文一直是干净的。[Day 262](/blog/agent-zero/day-262-context-budget/) 讲过,窗口大不等于该塞满,上下文越长,模型越容易忽略中间的东西,每次调用也越贵。子 Agent 本质上是一种上下文管理手段,这一点 Day 332 会单独讲。

**分工维护。** 不同团队维护不同的 Agent,各有各的提示词、工具和评测集,通过约定好的接口协作。这更像组织架构上的收益,在大公司的平台型产品里常见,对一个人写的项目基本用不上。

代价也很明确,两个。**token 成本成倍增长**:每个子 Agent 都要重新发一遍系统提示词和任务描述,主 Agent 还要多一轮汇总。**协调失败**:子 Agent 理解偏了、结果互相矛盾、主 Agent 汇总时漏了或者编了东西。第二个比第一个难处理得多,因为它不报错,只会给你一个看起来很合理的错误答案。明天实跑时你会亲眼看到一次。

下面用两个小脚本把「并行」和「token 成本」量一下。

## 第 2 步:并行到底省多少时间

[Day 68](/blog/agent-zero/day-068-async-3/) 学过 `asyncio.gather`,它相当于 JS 的 `Promise.all`:把几个协程同时跑,等全部完成。这里用 `asyncio.sleep` 假装两个专员在干活,不用真调模型,也能看清并行的效果。

```python
# agent-zero-lab/part05/multi/parallel_sleep.py
"""不调模型,用 asyncio.sleep 假装两个专员在干活,比较一个接一个跑和同时跑各要多久。"""
import asyncio
import time


async def worker(name: str, seconds: float) -> str:
    print(f"  {name} 开工")
    await asyncio.sleep(seconds)  # 假装在调模型、查数据库
    print(f"  {name} 交活")
    return f"{name} 的结论"


async def one_by_one() -> list[str]:
    a = await worker("billing", 1.5)
    b = await worker("tech", 1.0)
    return [a, b]


async def together() -> list[str]:
    a, b = await asyncio.gather(worker("billing", 1.5), worker("tech", 1.0))
    return [a, b]


if __name__ == "__main__":
    for label, job in (("一个接一个", one_by_one), ("同时跑", together)):
        print(label)
        t0 = time.perf_counter()
        results = asyncio.run(job())
        print(f"  结果 {results},用时 {time.perf_counter() - t0:.2f} 秒")
```

<div class="line-notes">

- `async def worker(name: str, seconds: float) -> str:` 一个协程函数,模拟一个专员。`billing` 是账务专员,`tech` 是技术支持,明天真正的多 Agent 里就是这两个角色。
- `await asyncio.sleep(seconds)  # 假装在调模型、查数据库` 让出控制权,等 `seconds` 秒。等待期间事件循环可以去跑别的协程,这和真实调模型时「发出请求、等响应」是同一回事。
- `async def one_by_one() -> list[str]:` 一个接一个:先等 billing 做完,再让 tech 开工。
- `a = await worker("billing", 1.5)` 账务专员要 1.5 秒。真实场景里它要查客户、查订阅、查发票,通常比技术支持慢,明天实跑时 billing 也确实总是后交活。
- `a, b = await asyncio.gather(worker("billing", 1.5), worker("tech", 1.0))` 两个协程同时开始。`gather` 返回结果的顺序和传进去的顺序一致,不管谁先完成,所以 `a` 永远是 billing 的结论。这里把它拆成 `a, b` 再拼回列表,是为了让返回类型和 `one_by_one` 一样都是 `list[str]`,类型检查不报错。
- `for label, job in (("一个接一个", one_by_one), ("同时跑", together)):` 函数也是值,可以放进元组里循环,和 JS 里把函数放进数组一样。
- `t0 = time.perf_counter()` 一个高精度计时器,只用来算差值。
- `results = asyncio.run(job())` 每次 `asyncio.run` 都新建一个事件循环,跑完关掉。
- `print(f"  结果 {results},用时 {time.perf_counter() - t0:.2f} 秒")` 实跑:一个接一个 2.50 秒,同时跑 1.50 秒。

</div>

```bash
uv run python parallel_sleep.py
```

```text
一个接一个
  billing 开工
  billing 交活
  tech 开工
  tech 交活
  结果 ['billing 的结论', 'tech 的结论'],用时 2.50 秒
同时跑
  billing 开工
  tech 开工
  tech 交活
  billing 交活
  结果 ['billing 的结论', 'tech 的结论'],用时 1.50 秒
```

并行的总耗时等于**最慢的那一个**,不是两个加起来。2.5 秒变 1.5 秒,省下的正好是 tech 那 1 秒。由此可以推出一个容易忽略的事实:如果一个子任务特别慢(比如账务要 10 秒,技术只要 1 秒),并行最多只能帮你省 1 秒,瓶颈还在最慢的那个身上。

还要注意,真实的多 Agent 里,主管自己也要花时间:先调一次模型决定怎么拆,两个专员跑完后再调一次模型汇总。这两次是串行的,并行省下的时间会被它们吃掉一部分。明天实跑时会看到,多 Agent 版本反而比单 Agent 慢。

## 第 3 步:算一笔 token 账

[Day 109](/blog/agent-zero/day-109-context-window/) 讲过,模型是无状态的,每次调用都要把整份 messages 重新发一遍。Agent 循环每多一轮,messages 就长一截,下一次调用的输入 token 也跟着涨。按这条规则写一个不调模型的小模型,把单 Agent 和多 Agent 的 token 数算出来。

```python
# agent-zero-lab/part05/multi/token_bill.py
"""不调模型,用一个简化模型算「单 Agent vs 多 Agent」各要发多少 token。
规则只有一条:每次调模型,都要把当前 messages 里的全部内容再发一遍。"""

SYSTEM = 300   # 一段系统提示词约 300 token
QUESTION = 80  # 客户的一句话
CALL = 40      # 模型发出一次工具调用(那条 assistant 消息)
RESULT = 600   # 一次工具结果(发票列表、帮助文章)
ANSWER = 250   # 最终回复


def run_loop(name: str, first_user: int, tool_rounds: int) -> tuple[int, int, int]:
    """模拟一个 Agent 循环:tool_rounds 轮工具调用 + 1 轮最终回答。返回 (调用次数, 输入, 输出)。"""
    context = SYSTEM + first_user
    calls = inp = out = 0
    for _ in range(tool_rounds):
        calls += 1
        inp += context            # 这一轮要把整个上下文发过去
        out += CALL
        context += CALL + RESULT  # 调用和结果都追加进上下文
    calls += 1
    inp += context
    out += ANSWER
    print(f"  {name:<8} 调用 {calls} 次  输入 {inp:>6}  输出 {out:>5}  结束时上下文 {context:>5}")
    return calls, inp, out


def main() -> None:
    print("单 Agent:一个 Agent 自己查 3 轮工具(客户、发票、帮助中心)")
    single = run_loop("solo", QUESTION, tool_rounds=3)

    print("多 Agent:主管派 2 个活,账务查 2 轮,技术查 1 轮")
    TASK = 120  # 主管写给专员的任务描述
    lead1 = (1, SYSTEM + QUESTION, 2 * CALL)  # 主管第一次:一口气发出两个派活调用
    print(f"  {'lead-1':<8} 调用 1 次  输入 {lead1[1]:>6}  输出 {lead1[2]:>5}")
    billing = run_loop("billing", TASK, tool_rounds=2)
    tech = run_loop("tech", TASK, tool_rounds=1)
    # 主管第二次:上下文里多了两条派活调用和两段专员结论
    lead2 = (1, SYSTEM + QUESTION + 2 * CALL + 2 * ANSWER, ANSWER)
    print(f"  {'lead-2':<8} 调用 1 次  输入 {lead2[1]:>6}  输出 {lead2[2]:>5}")
    multi = [sum(x) for x in zip(lead1, billing, tech, lead2)]

    for label, (c, i, o) in (("单 Agent", single), ("多 Agent", multi)):
        print(f"{label}: {c} 次调用, 共 {i + o} token")
    print(f"多 Agent / 单 Agent = {sum(multi[1:]) / sum(single[1:]):.2f} 倍")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `SYSTEM = 300   # 一段系统提示词约 300 token` 这五个常数是我拍的量级,不是测出来的。明天会用真实的 `usage` 字段对一下,量级是对得上的。全大写的变量名是 Python 里「常量」的约定,语言本身不拦你改。
- `RESULT = 600   # 一次工具结果(发票列表、帮助文章)` 工具结果是最占地方的。明天实跑时,`list_invoices` 返回 6 张发票的 JSON 就有好几百 token。
- `def run_loop(name: str, first_user: int, tool_rounds: int) -> tuple[int, int, int]:` 模拟一个 Agent 循环。`first_user` 是第一条用户消息的长度:单 Agent 是客户原话,专员是主管写的任务描述。
- `context = SYSTEM + first_user` 循环开始时的上下文:系统提示词加第一条消息。单 Agent 是 300 + 80 = 380。
- `calls = inp = out = 0` 连续赋值,三个变量都是 0。
- `inp += context            # 这一轮要把整个上下文发过去` 关键的一行。单 Agent 第 1 轮发 380,第 2 轮发 1020,第 3 轮发 1660。
- `context += CALL + RESULT  # 调用和结果都追加进上下文` 每轮多 40 + 600 = 640。三轮下来上下文从 380 涨到 2300。
- `inp += context` 最后一轮(回答)还要再发一次完整上下文,单 Agent 这一次是 2300。四次加起来 380 + 1020 + 1660 + 2300 = 5360,和输出里的 `输入 5360` 对得上。
- `print(f"  {name:<8} 调用 {calls} 次  输入 {inp:>6}  输出 {out:>5}  结束时上下文 {context:>5}")` `:<8` 左对齐占 8 格,`:>6` 右对齐占 6 格,和 JS 的 `padEnd`/`padStart` 一个意思。
- `return calls, inp, out` 返回一个三元组(tuple,可以当成不能改的数组)。
- `TASK = 120  # 主管写给专员的任务描述` 主管写的任务通常比客户原话长,因为要写清客户是谁、查什么、返回什么。明天实跑时主管写的任务确实有一百多字。
- `lead1 = (1, SYSTEM + QUESTION, 2 * CALL)  # 主管第一次:一口气发出两个派活调用` 主管第一次调用:输入 380,输出两个工具调用 80。主管不查数据,所以它这里只有这一笔。
- `billing = run_loop("billing", TASK, tool_rounds=2)` 账务专员查客户、查发票两轮。它的起点是 300 + 120 = 420,不是 380,因为任务描述比客户原话长。
- `tech = run_loop("tech", TASK, tool_rounds=1)` 技术支持只查一次帮助中心。
- `lead2 = (1, SYSTEM + QUESTION + 2 * CALL + 2 * ANSWER, ANSWER)` 主管第二次调用:上下文是原来的 380,加两条派活调用 80,加两个专员的结论 500,一共 960。专员查到的 1800 token 工具结果一条都没进来,这就是上下文隔离。
- `multi = [sum(x) for x in zip(lead1, billing, tech, lead2)]` `zip` 把四个三元组按位置配对:第 0 位都是调用次数,第 1 位都是输入,第 2 位都是输出,各自加起来。结果是 `[7, 6000, 950]`。
- `for label, (c, i, o) in (("单 Agent", single), ("多 Agent", multi)):` 循环变量里直接解构,相当于 JS 的 `for (const [label, [c, i, o]] of ...)`。
- `print(f"多 Agent / 单 Agent = {sum(multi[1:]) / sum(single[1:]):.2f} 倍")` `multi[1:]` 是去掉调用次数,只留输入和输出。6950 / 5730 = 1.21。

</div>

```bash
uv run python token_bill.py
```

```text
单 Agent:一个 Agent 自己查 3 轮工具(客户、发票、帮助中心)
  solo     调用 4 次  输入   5360  输出   370  结束时上下文  2300
多 Agent:主管派 2 个活,账务查 2 轮,技术查 1 轮
  lead-1   调用 1 次  输入    380  输出    80
  billing  调用 3 次  输入   3180  输出   330  结束时上下文  1700
  tech     调用 2 次  输入   1480  输出   290  结束时上下文  1060
  lead-2   调用 1 次  输入    960  输出   250
单 Agent: 4 次调用, 共 5730 token
多 Agent: 7 次调用, 共 6950 token
多 Agent / 单 Agent = 1.21 倍
```

只多了 21%,离 Anthropic 说的 15 倍差得很远。这不是 Anthropic 说错了,是两边干的活不一样多。我们这个例子里,多 Agent 和单 Agent 一共都只查了 3 次工具,多出来的只是主管那两次调用和专员重发的系统提示词。而且上下文隔离还帮了忙:单 Agent 最后一次调用要发 2300 token,多 Agent 里最长的一次只有 1700。

把 `RESULT` 改成 3000(模拟工具结果很大,比如一次返回一整篇帮助文章或几十行日志),再跑一次,结果反过来了:

```text
单 Agent: 4 次调用, 共 20130 token
多 Agent: 7 次调用, 共 16550 token
多 Agent / 单 Agent = 0.82 倍
```

多 Agent 反而省了 18%。原因是单 Agent 每一轮都要把前面所有的大块结果重发一遍,结果越大,这个「滚雪球」越厉害;多 Agent 把大块结果分在两个专员各自的上下文里,谁都滚不了太大。这就是「上下文隔离」在账单上的样子。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="柱状对比:工具结果 600 token 时,单 Agent 5730,多 Agent 6950;工具结果 3000 token 时,单 Agent 20130,多 Agent 16550;调研任务 4 个子 Agent 各搜 8 轮时,单 Agent 27030,多 Agent 111890">
  <rect x="0" y="0" width="640" height="220" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <text x="20" y="22" fill="var(--ink)">总 token(token_bill.py 和练习 1 实跑)</text>
    <text x="20" y="56" fill="var(--ink-soft)">结果 600</text>
    <rect x="110" y="44" width="26" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="142" y="55" fill="var(--ink)">单 5730</text>
    <rect x="110" y="60" width="31" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="147" y="71" fill="var(--ink)">多 6950(1.21 倍)</text>
    <text x="20" y="106" fill="var(--ink-soft)">结果 3000</text>
    <rect x="110" y="94" width="91" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="207" y="105" fill="var(--ink)">单 20130</text>
    <rect x="110" y="110" width="75" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="191" y="121" fill="var(--ink)">多 16550(0.82 倍)</text>
    <text x="20" y="156" fill="var(--ink-soft)">调研 4×8</text>
    <rect x="110" y="144" width="122" height="12" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="238" y="155" fill="var(--ink)">单 27030</text>
    <rect x="110" y="160" width="505" height="12" fill="var(--compute-wash)" stroke="var(--compute)"/>
    <text x="440" y="190" fill="var(--ink)">多 111890(4.1 倍)</text>
    <text x="20" y="210" fill="var(--ink-faint)">蓝 = 单 Agent  琥珀 = 多 Agent  柱长按 token 数等比例</text>
  </g>
</svg>
<figcaption>同一个小模型,三组参数。多 Agent 贵不贵,取决于它是在「把同样的活分开干」还是「干了更多的活」。</figcaption>
</figure>

那 15 倍是怎么来的?看练习 1:让 4 个子 Agent 各自搜 8 轮,和一个 Agent 自己搜 8 轮比,是 4.1 倍。多 Agent 系统之所以效果好,是因为它真的多干了活:4 个方向同时搜,每个方向都搜得很深。Anthropic 那句「token 用量解释了 80% 的表现差异」说的就是这个。所以面试里被问「多 Agent 贵在哪」,好的回答是:**一部分是协调开销(主管的调用、重发的系统提示词),大头是它让系统能并行地干更多活;如果任务本身不需要那么多活,这钱就白花了。**

## 我的默认立场

讲到这里,我的立场是:**先用单 Agent 做,遇到明确的瓶颈再拆**。明确的瓶颈是指下面三种之一:

单个 Agent 的工具多到它开始选错。[Day 184](/blog/agent-zero/day-184-tool-search-1/) 量过 60 个工具的定义有多贵,一般二三十个以上就要警惕。上下文长到它开始遗忘,或者每次调用都很贵,工具结果又特别大(上面 `RESULT = 3000` 那种情况)。任务确实有可以并行的大块,而且这些大块只是「查」,不是一起「改」同一个东西。

反过来,下面任何一条成立,我都会坚持单 Agent:子任务之间有依赖;子任务会各自拍板同一个决定;对成本敏感,任务又不需要并行提速;还没有评测集。最后这条特别要紧,多 Agent 的协调失败不报错,没有评测你根本不知道它在哪坏了。评测是第六部分的内容,到时候会回来用它量多 Agent。

明天动手搭第一种拓扑,主管派活,你会看到上面说的协调开销和「看起来合理的错误答案」都是真实存在的。

## 动手练习

**练习 1:调研类任务的账。** 在 `part05/multi/ex329_research.py` 里 import `token_bill.py` 的常数和 `run_loop`,算两种做法:单 Agent 自己搜 8 轮;主管派 4 个子 Agent,每个各搜 8 轮(任务描述 120 token),主管第一次输出 4 个派活调用,第二次汇总 4 段结论。打印两边的调用次数、总 token 和倍数,并解释这个倍数为什么比 `token_bill.py` 的 1.21 大得多。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/multi/ex329_research.py
"""练习 1:调研类任务。多 Agent 不只是多了开销,它还多干了很多活。"""
from token_bill import ANSWER, CALL, QUESTION, SYSTEM, run_loop

print("单 Agent:自己搜 8 轮")
single = run_loop("solo", QUESTION, tool_rounds=8)

print("多 Agent:主管派 4 个子 Agent,每个各搜 8 轮")
subs = [run_loop(f"sub{i}", 120, tool_rounds=8) for i in range(1, 5)]
lead1 = (1, SYSTEM + QUESTION, 4 * CALL)
lead2 = (1, SYSTEM + QUESTION + 4 * CALL + 4 * ANSWER, ANSWER)
multi = [sum(x) for x in zip(lead1, lead2, *subs)]

s, m = sum(single[1:]), sum(multi[1:])
print(f"单 Agent {single[0]} 次调用 {s} token;多 Agent {multi[0]} 次调用 {m} token;{m / s:.1f} 倍")
```

<div class="line-notes">

- `from token_bill import ANSWER, CALL, QUESTION, SYSTEM, run_loop` 直接复用今天的常数和函数。`token_bill.py` 末尾有 `if __name__ == "__main__":`,所以 import 它不会把它自己的那张表也打印出来。我第一版忘了加这一行,结果这里一 import 就先打出了整张单 Agent / 多 Agent 的表。
- `subs = [run_loop(f"sub{i}", 120, tool_rounds=8) for i in range(1, 5)]` `range(1, 5)` 是 1、2、3、4,相当于 JS 的 `[1,2,3,4]`。每个子 Agent 各跑一个 8 轮的循环,结果是 4 个三元组组成的列表。
- `lead2 = (1, SYSTEM + QUESTION + 4 * CALL + 4 * ANSWER, ANSWER)` 主管汇总时的上下文:380 + 160 + 1000 = 1540。四个子 Agent 各自滚到 5540 的上下文,一点都没进主管这里。
- `multi = [sum(x) for x in zip(lead1, lead2, *subs)]` `*subs` 把列表摊开成 4 个参数,相当于 JS 的展开运算符 `...subs`。
- `print(f"单 Agent {single[0]} 次调用 {s} token;多 Agent {multi[0]} 次调用 {m} token;{m / s:.1f} 倍")` 实跑 111890 / 27030 = 4.1。

</div>

```bash
uv run python ex329_research.py
```

```text
单 Agent:自己搜 8 轮
  solo     调用 9 次  输入  26460  输出   570  结束时上下文  5500
多 Agent:主管派 4 个子 Agent,每个各搜 8 轮
  sub1     调用 9 次  输入  26820  输出   570  结束时上下文  5540
  sub2     调用 9 次  输入  26820  输出   570  结束时上下文  5540
  sub3     调用 9 次  输入  26820  输出   570  结束时上下文  5540
  sub4     调用 9 次  输入  26820  输出   570  结束时上下文  5540
单 Agent 9 次调用 27030 token;多 Agent 38 次调用 111890 token;4.1 倍
```

为什么比 1.21 大得多:`token_bill.py` 里两边一共都只查了 3 次工具,多 Agent 只多了协调开销;这里多 Agent 一共查了 32 次,单 Agent 只查了 8 次,活本身就是 4 倍。倍数主要来自「多干的活」,不是来自「协调」。如果 8 轮就足够回答问题,多出来的 24 轮就是白花的钱。

</details>

**练习 2:换两组任务体检。** 在 `ex329_split.py` 里写两组子任务交给 `check()`:一组是「调研三家竞品的定价,再写一张对比表」;另一组是 Flappy Bird 第二版,先加一个「定美术规范」的子任务,把画风和画面尺寸都由它来定,另外两个画图的子任务要等它。跑完看两组的结论,第二组的结论对吗?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/multi/ex329_split.py
"""练习 2:加一个调研任务;再把 Flappy Bird 的共同决定提出来,看结论会不会变。"""
from split_check import check

research = {
    "查竞品 A 的定价": {"needs": [], "decides": []},
    "查竞品 B 的定价": {"needs": [], "decides": []},
    "查竞品 C 的定价": {"needs": [], "decides": []},
    "写对比表": {"needs": ["查竞品 A 的定价", "查竞品 B 的定价", "查竞品 C 的定价"], "decides": ["表格格式"]},
}
flappy_v2 = {
    "定美术规范": {"needs": [], "decides": ["画风", "画面尺寸"]},
    "画背景和水管": {"needs": ["定美术规范"], "decides": []},
    "画小鸟": {"needs": ["定美术规范"], "decides": ["下落速度"]},
    "拼成游戏": {"needs": ["画背景和水管", "画小鸟"], "decides": []},
}
if __name__ == "__main__":
    for title, tasks in (("调研三家竞品", research), ("Flappy Bird 第二版", flappy_v2)):
        print(title)
        check(tasks)
```

<div class="line-notes">

- `"查竞品 A 的定价": {"needs": [], "decides": []},` 只读的查询,什么都不拍板。这就是 Cognition 续篇里说的「只贡献判断,不动手」的那类活。
- `"写对比表": {"needs": ["查竞品 A 的定价",` 汇总那一步要等三个查询都做完,表格格式只有它一个人定,没有冲突。
- `"定美术规范": {"needs": [], "decides": ["画风", "画面尺寸"]},` 把原来两个画图子任务各自隐含的决定,提出来交给一个人先定。
- `"画背景和水管": {"needs": ["定美术规范"], "decides": []},` 它现在只照规范画,不再自己拍板画风。
- `if __name__ == "__main__":` 练习 3 要 import `flappy_v2`,所以这里也加上。

</div>

```bash
uv run python ex329_split.py
```

```text
调研三家竞品
  可以同时开工:['查竞品 A 的定价', '查竞品 B 的定价', '查竞品 C 的定价']
  写对比表 要等:['查竞品 A 的定价', '查竞品 B 的定价', '查竞品 C 的定价']
  结论:适合拆
Flappy Bird 第二版
  可以同时开工:['定美术规范']
  画背景和水管 要等:['定美术规范']
  画小鸟 要等:['定美术规范']
  拼成游戏 要等:['画背景和水管', '画小鸟']
  结论:先别拆,或者先把共同决定定好再拆
```

调研那组的结论是对的。Flappy Bird 第二版的结论不对:冲突已经没了,两个画图的子任务在规范定好之后完全可以同时做,但 `check()` 只看「一开始能同时开工的有几个」,第一批只有「定美术规范」一个,所以说不适合拆。这是 `check()` 太粗了,练习 3 修它。

</details>

**练习 3:按批排任务。** 写一个 `layers(tasks)`,把子任务排成若干「批」:第一批是不用等任何人的,第二批是只等第一批的,依此类推,同一批里的可以并行。拿练习 2 的 `flappy_v2` 跑一下;再构造一组 A 等 B、B 等 A 的任务,让函数报出循环依赖。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/multi/ex329_layers.py
"""练习 3:按「批」排任务。同一批里的任务互不依赖,可以同时开工。"""
from ex329_split import flappy_v2


def layers(tasks: dict[str, dict[str, list[str]]]) -> list[list[str]]:
    done: set[str] = set()
    batches: list[list[str]] = []
    while len(done) < len(tasks):
        ready = [n for n, t in tasks.items() if n not in done and set(t["needs"]) <= done]
        if not ready:
            raise ValueError(f"有循环依赖,卡住的是:{sorted(set(tasks) - done)}")
        batches.append(ready)
        done.update(ready)
    return batches


for i, batch in enumerate(layers(flappy_v2), 1):
    mark = "可并行" if len(batch) > 1 else "单独做"
    print(f"第 {i} 批({mark}):{batch}")

loop = {"A": {"needs": ["B"], "decides": []}, "B": {"needs": ["A"], "decides": []}}
try:
    layers(loop)
except ValueError as e:
    print(e)
```

<div class="line-notes">

- `done: set[str] = set()` 已经排进某一批的子任务。集合(set)相当于 JS 的 `Set`,注意空集合要写 `set()`,写 `{}` 得到的是空字典。
- `while len(done) < len(tasks):` 还有没排的就继续。
- `ready = [n for n, t in tasks.items() if n not in done and set(t["needs"]) <= done]` 挑出「还没排、并且它要等的全都已经排过了」的子任务。`<=` 用在两个集合之间是「是不是子集」。空集合是任何集合的子集,所以不用等人的子任务第一轮就会被挑出来。
- `raise ValueError(f"有循环依赖,卡住的是:{sorted(set(tasks) - done)}")` 一轮下来一个都挑不出来,说明剩下的互相等着,永远排不完。不加这个判断,`while` 会死循环。`set(tasks)` 是字典所有键组成的集合,减去 `done` 就是卡住的那些。
- `done.update(ready)` 把这一批全部标记为已排,相当于对每个元素调一次 `add`。
- `for i, batch in enumerate(layers(flappy_v2), 1):` `enumerate(..., 1)` 让序号从 1 开始。
- `loop = {"A": {"needs": ["B"], "decides": []}, "B": {"needs": ["A"], "decides": []}}` 故意构造的循环依赖。

</div>

```bash
uv run python ex329_layers.py
```

```text
第 1 批(单独做):['定美术规范']
第 2 批(可并行):['画背景和水管', '画小鸟']
第 3 批(单独做):['拼成游戏']
有循环依赖,卡住的是:['A', 'B']
```

这就是 Anthropic 研究系统和 Cognition 续篇里都提到的形状:先有一个人把共同的决定定下来(规划、规范),然后把只需要照着做的部分并行派出去,最后一个人汇总。算法上它叫拓扑排序,[Day 305](/blog/agent-zero/day-305-lg-parallel/) LangGraph 的并行节点和扇入,底层也是按这个思路一批一批跑的。

</details>

**练习 4:有依赖还能并行吗?** 客户说「我的退款到哪一步了?退款到账后发票怎么作废?」,第二个问题要等第一个问题的答案。在 `ex329_chain.py` 里 import `parallel_sleep.py` 的 `worker`,让 tech 拿着 billing 的结论再开工,计时,和 `parallel_sleep.py` 的两个数比较。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part05/multi/ex329_chain.py
"""练习 4:tech 要用 billing 的结论才能开工,gather 还能省时间吗?"""
import asyncio
import time

from parallel_sleep import worker


async def chained() -> list[str]:
    a = await worker("billing", 1.5)
    b = await worker(f"tech(拿着「{a}」)", 1.0)
    return [a, b]


t0 = time.perf_counter()
print(asyncio.run(chained()), f"{time.perf_counter() - t0:.2f} 秒")
```

<div class="line-notes">

- `from parallel_sleep import worker` `parallel_sleep.py` 末尾有 main guard,import 它不会跑那两组计时。
- `a = await worker("billing", 1.5)` 必须先等 billing 做完,拿到 `a`。
- `b = await worker(f"tech(拿着「{a}」)", 1.0)` tech 的输入里用到了 `a`,这一行在 `a` 出来之前根本写不出来,所以没法放进 `gather`。
- `print(asyncio.run(chained()), f"{time.perf_counter() - t0:.2f} 秒")` 实跑 2.50 秒,和「一个接一个」完全一样。

</div>

```text
  billing 开工
  billing 交活
  tech(拿着「billing 的结论」) 开工
  tech(拿着「billing 的结论」) 交活
['billing 的结论', 'tech(拿着「billing 的结论」) 的结论'] 2.50 秒
```

有依赖的子任务只能排队,拆成两个 Agent 一秒也省不下来,反而多了一次主管调用和一次重发系统提示词。这种情况交给一个 Agent 顺着做更好:它查到退款状态之后,上下文里就有这个信息,接着回答第二个问题时不需要任何人转述。

</details>

验收标准:四个脚本都能跑出和上面一致的输出(计时那两个允许差几十毫秒);能用自己的话说出为什么练习 1 的倍数大、练习 2 的第二组结论错、练习 4 省不下时间。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 多 Agent(multi-agent) | 好几个 Agent 循环一起完成一件事,每个都有自己的系统提示词、工具和 messages。例:主管加账务专员加技术支持 |
| 子 Agent(subagent) | 被另一个 Agent 派活的 Agent,干完把结论交回去。今天先当成多 Agent 里的「下级」,Day 332 会讲它更精确的含义 |
| 主管 / 编排者(orchestrator、lead) | 负责拆任务、派活、汇总的那个 Agent,自己通常不查数据 |
| 隐含决定(implicit decision) | 做一个动作时顺手定下、但没人明说的事。例:画背景时定下了画风 |
| 上下文隔离(context isolation) | 子 Agent 的工具结果留在它自己的 messages 里,只把结论交回去,主 Agent 的上下文不被撑大 |
| 协调失败 | 多个 Agent 之间传话出错:理解偏、结果矛盾、汇总时漏掉或编造。不报错,所以最难发现 |
| 拓扑排序 | 把有先后依赖的任务排成「一批一批」,同批可以并行。练习 3 的 `layers()` 就是它 |
| BrowseComp | OpenAI 发布的一个评测集,考 Agent 上网查难找的信息,Anthropic 用它分析多 Agent 的表现 |

## 常见误区

**把「拆得开」等同于「没有依赖」。** Flappy Bird 那组在依赖图上完全可以并行,问题出在两个子任务各自拍板同一个决定。拆之前要问两个问题,只问一个会漏。

**以为多 Agent 一定贵 15 倍,或者一定只贵一点。** 倍数取决于多 Agent 是在「把同样的活分开干」还是「干了更多的活」。`token_bill.py` 里同样的活只贵 21%,工具结果大时还更便宜;调研那种多干活的场景是 4 倍以上。被问到时先问清楚是哪种。

**把 Cognition 的续篇读成「多 Agent 现在可以随便用了」。** 续篇明确说并行写代码的 swarm 依然不行。它放开的是「一个写,其他只查只审」这种窄模式。

**以为并行能把时间除以 Agent 个数。** 并行的总耗时等于最慢的那个,再加上主管前后两次串行的调用。`parallel_sleep.py` 里两个专员,时间只省了快的那个的 1 秒。

**把 Day 200 的编排者-工作者和多 Agent 当成一回事。** Day 200 的工作者只调一次模型,没有工具和循环;多 Agent 的每个工作者都是完整的 Agent 循环,成本和失控的可能都大得多。

**import 一个没有 main guard 的脚本。** 我写练习 1 时 `token_bill.py` 还没有 `if __name__ == "__main__":`,一 import 就先把整张表打印了一遍。被别的文件 import 的脚本,顶层只放定义,要跑的东西放进 main guard。

## 学习资料

### 文档与文章

- [Cognition · Don't Build Multi-Agents](https://cognition.ai/blog/dont-build-multi-agents):今天第一篇,2025-06-12,英文,Flappy Bird 例子和两条原则都在里面,20 分钟。
- [Anthropic · How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):今天第二篇,2025-06-13,英文。90.2%、4 倍、15 倍、80% 这些数字都出自这里,后半部分的八条提示词经验明天会用到,40 分钟。
- [Cognition · Multi-Agents: What's Actually Working](https://cognition.ai/blog/multi-agents-working):2026-04-22 的续篇,英文,重点看「哪些能用、哪些还不行」两部分,20 分钟。
- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):Day 200 读过的那篇,回去重看 orchestrator-workers 那一段,和今天的多 Agent 对比着理解,10 分钟。
- [LangChain · Multi-agent](https://docs.langchain.com/oss/python/langchain/multi-agent):把多 Agent 分成 subagents、handoffs、skills、router、custom workflow 五类,底部有一张按模型调用次数和 token 比较各模式的表,和今天的 token 账对照看,15 分钟。
- [Python · 协程与任务(中文)](https://docs.python.org/zh-cn/3.12/library/asyncio-task.html):复习 `gather` 的那一节,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1DYHB6SEoW&autoplay=0&high_quality=1" title="什么是多智能体系统?3分钟看懂多智能体系统" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵星球TuringPlanet · 什么是多智能体系统?3分钟看懂多智能体系统 · 3 分多钟,先建立一个直观印象,再回来看今天的取舍。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV11p6wB2EmX&autoplay=0&high_quality=1" title="挑战12分钟搞定,多智能体(Multi-Agent)架构" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大模型学习study · 挑战12分钟搞定,多智能体(Multi-Agent)架构 · 13 分钟,把常见的几种多 Agent 结构过一遍,看完能对上明天和后天要搭的两种拓扑。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Mi5wOpAgixw" title="Multi-agent Systems Explained in 17 Minutes" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Shaw Talebi · Multi-agent Systems Explained in 17 Minutes · 英文,17 分钟,讲多 Agent 是什么、几种常见结构和什么时候用,节奏适合入门。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · 英文,Anthropic 几位工程师聊什么时候该用 Agent、什么时候不该用,和今天「先单 Agent」的立场是一个思路。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025):第 6 章讲 Agent,其中规划与多步任务的部分可以和今天的取舍对照着读,英文原版。
- Michael Wooldridge《An Introduction to MultiAgent Systems》(第 2 版,Wiley,2009):多智能体在 LLM 之前是一门老学科,这本是经典教材。不用通读,翻目录看「协作」和「任务分配」相关的章节,知道这些问题前人早就在想,英文原版。

### 开源项目与代码

- [datawhalechina/hello-agents](https://github.com/datawhalechina/hello-agents):中文开源教程。第六章「框架开发实践」用 AutoGen、AgentScope、CAMEL 搭了几个多智能体例子(软件开发团队、狼人杀、AI 作家和心理学家合写科普书),先看它们各自怎么分工,再用今天的两个问题评一评哪个拆得合理。
- [microsoft/ai-agents-for-beginners · 08-multi-agent](https://github.com/microsoft/ai-agents-for-beginners/tree/main/08-multi-agent):微软入门课的多 Agent 一课,有中文翻译,看它列出的「什么时候用多 Agent」和今天的清单对比。

## 自测

1. Cognition 那篇文章的两条原则是什么?用 Flappy Bird 的例子各解释一句。

<details><summary>答案</summary>

一是共享上下文,而且要共享完整执行轨迹,不只是几条消息:两个子 Agent 只拿到自己那句子任务,不知道整体要做的是 Flappy Bird,一个就做成了马里奥风格。二是动作隐含决定,冲突的决定带来坏结果:即使把原任务也给它们,画背景和画小鸟的两个子 Agent 各自定了画风,拼起来对不上。

</details>

2. Anthropic 说多 Agent 系统大约用聊天 15 倍的 token,而 `token_bill.py` 只算出 1.21 倍。两个数为什么差这么多?

<details><summary>答案</summary>

`token_bill.py` 里两边干的活一样多(都只查 3 次工具),多出来的只是协调开销,而上下文隔离还抵消了一部分。Anthropic 的研究系统是派 3 到 5 个子 Agent 各自深挖,干的活本身就多很多,而且 15 倍是和「聊天」比,不是和单 Agent 比(单 Agent 本身就是聊天的 4 倍左右)。练习 1 里让 4 个子 Agent 各搜 8 轮,倍数就到了 4.1。

</details>

3. Cognition 2026 年 4 月的续篇里,哪种多 Agent 用法被认为能用,哪种依然不行?它们的共同规律是什么?

<details><summary>答案</summary>

能用的:一个写代码一个审代码、主 Agent 向更强的模型请教、只读的搜索子 Agent、管理者协调几个子 Agent。依然不行的:几个 Agent 同时写代码的 swarm、一群 Agent 随意互相谈判。规律是写操作只留在一个 Agent 手里,其他 Agent 只贡献判断、不动手。

</details>

4. 把 `token_bill.py` 的 `RESULT` 从 600 改成 3000,多 Agent 从贵 21% 变成便宜 18%。为什么?

<details><summary>答案</summary>

单 Agent 每轮都要把前面所有工具结果重发一遍,结果越大,后面每次调用的输入越大,总量增长得比结果大小快。多 Agent 把这些大块结果分散在两个专员各自的上下文里,每个专员只滚自己那一两块,主管完全不收。结果越大,隔离省下的越多,超过了协调开销。

</details>

5. 面试题:「我们的客服系统准备上多 Agent,一个查账务一个查技术问题,你觉得值得吗?」你怎么回答?

<details><summary>答案</summary>

先问三件事。一是两类问题在同一张工单里同时出现的比例高不高,不高的话并行省不了时间。二是工具数量和工具结果大小:两边加起来工具不多、结果也不大,单 Agent 完全装得下。三是有没有评测集,没有的话上了多 Agent 也不知道它是变好还是变坏。如果这三条都不支持,我会先用单 Agent 带全部工具,做好评测;等工具多到它开始选错、或者上下文明显太长再拆。拆的时候账务和技术都只是「查」,不是共同修改同一个东西,这一点是适合拆的;但最终给客户的回复只能由一个 Agent 写,不能让两个专员各写一段直接拼起来。

</details>

6. 「子任务之间没有先后依赖」是不是就足以说明可以拆给多个 Agent 并行?举个反例。

<details><summary>答案</summary>

不是。Flappy Bird 里画背景和画小鸟没有先后依赖,但它们各自隐含地决定了画风,拼起来对不上。还要检查有没有两个子任务要拍板同一个决定;有的话,先把这个决定单独拿出来定好(练习 2 的「定美术规范」),再并行。

</details>

## 明天预告

明天是 [Day 330 · 多 Agent(二):主管派活](/blog/agent-zero/day-330-multi-agent-2/)。今天的三个脚本都是「假装」:`asyncio.sleep` 假装干活,常数假装 token。明天把它们换成真的:写一个异步的小 Agent 类,让主管把账务专员和技术支持当成两个工具来调用,在 CloudLedger 上真跑一遍,看真实的 token 账、真实的并行耗时,以及主管汇总时编出来的那些「看起来很合理」的东西。
