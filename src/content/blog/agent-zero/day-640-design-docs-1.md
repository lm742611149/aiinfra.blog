---
title: 'Day 640 · 设计文档和 ADR:为什么是资深的主要产出,骨架和取舍'
description: '到了资深这一档,最值钱的产出常常不是代码,是一份能让十个人对齐的设计文档。今天拿 AgentOps 模型网关当例子,复习骨架,重点练「取舍」那一节怎么写才经得起追问,再写两个小工具:一个替评审人先挑一遍毛病,一个管 ADR 的编号和取代关系,最后让模型扮演评审人给草稿挑刺。'
pubDate: 2026-10-22
regime: none
tags: ['design-doc', 'adr', 'staff-engineer', 'python', 'agent-zero']
series: 'agent-zero'
day: 640
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 639](/blog/agent-zero/day-639-agentops-showcase/) 把 AgentOps 包装成了一个能拿出去给人看的作品:README 第一屏五秒钟能跑起来,架构图、评测数字、压测结果都摆在门口。做完那一天,AgentOps 这个项目在代码层面就收尾了。

可你回头想想,这十几天里真正难的地方,很少是「这段代码怎么写」,大多是「网关用现成的还是自己写」「配额按天还是按月」「MCP 代理默认拒绝会不会把业务团队逼走」这种选择题。这些选择当时是怎么做的、为什么这么做,代码里看不出来。今天开始的这几天,讲的就是把这类东西写下来、讲出来、推下去。

## 今天要解决的问题

学完今天,你应该能做到:

1. 说清设计文档、PRD、ADR、方案 PPT 各管什么,判断一件事值不值得写设计文档。
2. 把「我选了 A」写成一张同一组维度的对比表加一段话:约束在前,代价写出来,推翻条件写出来。
3. 用一个 40 行的小脚本检查自己的设计文档:缺没缺节、数字有没有标「预期/实测/假设」、取舍有没有代价和推翻条件。
4. 在评审时把每条意见分到「事实错误 / 方案分歧 / 需要升级」三类之一,并知道各自怎么处理。

预计用时:2.5 到 3 小时,一半以上是动手写文档。前置:[Day 519](/blog/agent-zero/day-519-senior-map/)(第一份 ADR)、[Day 542](/blog/agent-zero/day-542-design-doc-1/) 和 [Day 543](/blog/agent-zero/day-543-design-doc-2/)(设计文档骨架和示范)、[Day 626](/blog/agent-zero/day-626-agentops-gw-1/)(AgentOps 网关)。

学法提示:先对照文章逐行敲一遍代码(不复制粘贴)并跑通;第二天合上文章,把 `doc_lint.py` 和取舍那段话的四个要素默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 为什么到了资深,文档变成主要产出

先说一个从招聘数据里看得到的现象。资深、专家、架构师这类 Agent 岗位,职责描述里出现最多的句子是「负责整体架构设计」「主导技术方案评审」「推动跨团队落地」。你在 [Day 518](/blog/agent-zero/day-518-senior-gap/) 看过中级和资深的薪资差,那多出来的十几二十万,买的不是更快的打字速度。

原因很朴素:一个人写代码,上限是一个人;一份好的设计文档能让十个人朝同一个方向写代码。代码 review 一次影响几百行,设计评审一次影响几个月。资深工程师被付更多钱,是因为他能放大别人的产出,而放大的那个东西,落在纸面上就是设计文档。

Agent 系统还多一个理由。普通后端的方案对不对,很多时候看代码就能判断。Agent 的行为是概率性的,同一个方案换个模型、换一批数据,效果能差十几个点。所以 Agent 的设计文档必须写清楚「怎么证明这个方案是对的」,也就是评测计划。这一节写不出来的方案,基本可以认为还没想清楚。

拿前端的经验类比一下。你做过组件库的话,大概见过两种组件:一种只有代码,用的人只能去翻源码猜 props 为什么这么设计;另一种有一页设计说明,写了为什么 `size` 只有三档、为什么不支持 `className` 透传。半年后要改组件,第二种能改,第一种没人敢动。设计文档就是那一页说明,只不过范围从一个组件变成了一个系统。

## 设计文档、PRD、ADR、PPT 各管什么

很多团队把这几样东西混着用,结果哪个都没写好。分开看:

| 文档 | 回答什么问题 | 谁主写 | 生命周期 |
| --- | --- | --- | --- |
| PRD(需求文档) | 要解决谁的什么问题,做到什么程度算成功 | 产品经理 | 立项前后,需求变了就改 |
| 设计文档(Design Doc,也叫 RFC) | 打算怎么做,考虑过哪些做法,为什么选这个 | 工程师 | 写代码之前,定稿后很少大改 |
| ADR(架构决策记录) | 某一个具体决定是什么、在什么背景下做的、后果是什么 | 做决定的工程师 | 永久保留,只追加不修改 |
| 方案汇报 PPT | 让管理层在 15 分钟里拍板 | 负责人 | 一次性 |
| 代码注释和 README | 现在的代码怎么用、怎么改 | 写代码的人 | 跟着代码走 |

PRD 你可能在前端工作里天天见,就是产品经理给的那份「需求文档」。RFC 是 Request for Comments 的缩写,开源社区用这个词,意思是「这是个提案,请大家提意见」,性质和设计文档一样。Google 的 Malte Ubl 在《Design Docs at Google》里有一句话说得很准:设计文档是在写代码之前、改动还便宜的时候,把设计问题暴露出来的工具。如果团队习惯「先写完代码,评审时再补个文档」,那份文档只剩下归档价值。

那什么时候不值得写?改动小、没争议、做错了回滚很便宜,就别写,直接提 MR。我自己的门槛是满足下面任一条就写:预计超过两周工作量;影响两个以上团队;改了之后很难回退(数据格式、对外 API、计费逻辑);会改变 Agent 的模型、工具权限或用户能看到的行为。最后一条是 Agent 项目特有的,换个模型看起来只是改一行配置,实际上是换了一个「员工」。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="设计文档从草稿到回填的生命周期">
<rect x="10" y="80" width="100" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="60" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">草稿</text>
<text x="60" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">一个人 1-3 天</text>
<rect x="135" y="80" width="110" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="190" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">小范围预审</text>
<text x="190" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">找 2-3 个关键人</text>
<rect x="270" y="80" width="110" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="325" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">正式评审</text>
<text x="325" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">异步评论+一次会</text>
<rect x="405" y="80" width="100" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="455" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">定稿+ADR</text>
<text x="455" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">关键决定单独记</text>
<rect x="530" y="80" width="100" height="56" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="580" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">实现+回填</text>
<text x="580" y="122" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">和计划不同就记</text>
<line x1="110" y1="108" x2="135" y2="108" stroke="var(--rule)" stroke-width="2"/>
<line x1="245" y1="108" x2="270" y2="108" stroke="var(--rule)" stroke-width="2"/>
<line x1="380" y1="108" x2="405" y2="108" stroke="var(--rule)" stroke-width="2"/>
<line x1="505" y1="108" x2="530" y2="108" stroke="var(--rule)" stroke-width="2"/>
<path d="M 325 136 C 325 190, 190 190, 190 140" fill="none" stroke="var(--ink-faint)" stroke-width="1.5" stroke-dasharray="4 4"/>
<text x="258" y="205" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">大分歧:退回去改,再预审</text>
<text x="320" y="40" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">越往右,改动越贵</text>
</svg>
<figcaption>设计文档的一生。最容易被省掉的是「小范围预审」和「回填」,恰好这两步最值钱。</figcaption>
</figure>

## 骨架复习:九节,外加 Agent 专属的四节

骨架在 [Day 542](/blog/agent-zero/day-542-design-doc-1/) 讲过,这里只快速过一遍,重点放在资深写法和中级写法差在哪。

**标题、作者、状态、评审人、日期。** 状态写「草稿 / 评审中 / 已接受 / 已废弃」。评审人写具体人名,不写「后端组」,写组名等于没人负责看。

**背景。** 三五段,让不了解项目的同事看懂为什么现在要做。只写和决策有关的背景。AgentOps 网关的背景一句话就够:每个团队各自管 key,上个月一个团队把额度打爆,另外三个团队的线上 Agent 一起收到 429。429 是 HTTP 状态码「请求太多」,你在浏览器 DevTools 的 Network 面板里见过它变红。

**目标和非目标。** 目标要能验证,比如「P95 额外延迟不超过 30 毫秒」。P95 在 [Day 638](/blog/agent-zero/day-638-agentops-load/) 压测时用过,意思是一百个请求排好序,第 95 个的耗时。非目标比目标更重要,它是你提前拒绝掉的范围蔓延,比如「本期不做语义缓存」。评审时一半的争论能靠非目标提前消化。

**现状。** 现在系统长什么样,一张图加几段话。没有现状,读者判断不了你改了多少。

**方案。** 主体。先架构图,再数据流和关键接口,接口写到函数签名或 HTTP 路径这一层就够,别贴代码。

**备选方案和取舍。** 资深和中级的文档差别最大就在这一节,下面专门讲。

**Agent 专属的四节**:评测计划(什么数据集、多少样本、怎么判定比现在好,用 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 的 Wilson 区间和 [Day 550](/blog/agent-zero/day-550-eval-stats-4/) 的样本量算法)、成本估算(请求量 × 平均 token × 单价,上下浮动的假设)、失败模式和降级(供应商挂了、输出格式坏了、Agent 进了循环、工具超时,每种写检测方式和降级动作)、安全和权限(多了什么能力、谁能用、出事怎么审计、不可信输入从哪进来能碰到哪些工具)。

**上线计划。** 灰度比例、观察指标、回滚条件,写成「错误率比直连高 0.5 个百分点就回滚」这种能直接执行的句子。

**开放问题。** 还没想清楚的事直接列出来。很多人觉得写开放问题显得不专业,其实正好相反,评审人最怕作者假装什么都想清楚了。

长度上,Agent 平台类的设计文档我一般写 5 到 8 页,超过 10 页就该拆成主文档加附录。

## 第一步:把取舍写成同一组维度的表

先看一句典型的中级写法:

> 我们选 LiteLLM 做网关,因为它功能全、社区活跃。

这句话在评审会上一定会被追问:功能全指哪些?我们用得上吗?社区活跃对我们意味着什么?它的问题是没有约束、没有比较、没有代价,「全」「活跃」都没法验证。

有说服力的取舍有四个要素:**约束写在前面,用同一组维度比较,承认选中的方案有代价,写出什么情况下推翻**。前两个要素落到纸面上就是一张表。表最容易出的毛病是格子里全是「好」「一般」「很好」,所以我们先写个小脚本,把表打印出来的同时数一数有多少格子是带数字的,再检查延迟这种性能数字有没有标清楚是「预期」还是「实测」。

在 `agent-zero-lab/` 根目录(就是你从 [Day 9](/blog/agent-zero/day-009-editor-setup/) 起一直在用的那个练习仓库)下建 `part10/tradeoff_table.py`。今天的脚本只用标准库,不需要 `uv add` 任何东西。

```python
# agent-zero-lab/part10/tradeoff_table.py
import re

DIMS = ["接入 6 家供应商", "租户级配额", "额外延迟 P95", "第一版上线"]
OPTIONS = {
    "A. LiteLLM Proxy": ["开箱即用", "有,要它的数据库", "10-20ms(预期)", "2 周"],
    "B. 自研轻量网关": ["约 2 人周适配", "按我们的租户模型", "5ms 内(预期)", "5-6 周"],
    "C. 云厂商网关": ["部分支持", "粒度到账号", "很好", "1 周"],
}

def has_number(cell: str) -> bool:
    return re.search(r"\d", cell) is not None

def main() -> None:
    names = list(OPTIONS)
    print("| 维度 | " + " | ".join(names) + " |")
    print("| --- " * (len(names) + 1) + "|")
    for i, dim in enumerate(DIMS):
        row = [OPTIONS[n][i] for n in names]
        print(f"| {dim} | " + " | ".join(row) + " |")
    cells = [c for n in names for c in OPTIONS[n]]
    numeric = sum(has_number(c) for c in cells)
    print(f"\n{numeric}/{len(cells)} 个格子有数字")
    for n in names:
        for dim, cell in zip(DIMS, OPTIONS[n]):
            if "延迟" in dim and not ("预期" in cell or "实测" in cell):
                print(f"警告:{n} 的「{dim}」写的是「{cell}」,没标预期还是实测")

if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import re` `re` 是 Python 自带的正则模块,相当于 JS 里的 `RegExp`。今天第一次正式用它,只用到两个函数:`re.search`(找第一个匹配,相当于 `str.match(/.../)`)和后面的 `re.sub`(替换,相当于 `str.replace(/.../g, ...)`)。
- `DIMS = [` 比较的维度,四个。**所有方案用同一组维度**,这就是取舍表的第一条规矩。维度从约束里来:我们要接 6 家供应商、要租户配额、在意延迟、三个月内要上线。
- `OPTIONS = {` 一个字典(≈ JS 的对象),键是方案名,值是一个列表,顺序和 `DIMS` 一一对应。`OPTIONS["A. LiteLLM Proxy"][2]` 就是 A 方案的延迟那一格,值是 `"10-20ms(预期)"`。
- `"C. 云厂商网关": [` C 方案的延迟故意写成「很好」,一会儿脚本会抓到它。真实文档里这种格子非常常见。
- `def has_number(cell: str) -> bool:` 判断一个格子里有没有数字。
- `return re.search(r"\d", cell) is not None` `r"\d"` 是「任意一个数字」,`r` 前缀让反斜杠不被转义(JS 里写 `/\d/` 就行,Python 要靠 `r"..."`)。找到了返回一个匹配对象,找不到返回 `None`。代入 `"2 周"` 返回匹配对象,`is not None` 得到 `True`;代入 `"很好"` 得到 `False`。
- `names = list(OPTIONS)` 对字典调 `list()` 拿到所有键,相当于 `Object.keys(OPTIONS)`。这里是三个方案名。
- `print("| 维度 | " + " | ".join(names) + " |")` 打印 markdown 表头。`" | ".join(names)` 相当于 JS 的 `names.join(" | ")`,只是 Python 把 `join` 放在分隔符上。
- `print("| --- " * (len(names) + 1) + "|")` 字符串乘整数是重复,`"| --- " * 4` 就是四个 `| --- `,对应「维度」列加三个方案列。
- `for i, dim in enumerate(DIMS):` `enumerate` 同时给下标和值,相当于 `DIMS.forEach((dim, i) => ...)`。第一轮 `i=0, dim="接入 6 家供应商"`。
- `row = [OPTIONS[n][i] for n in names]` 列表推导式,把三个方案在第 `i` 个维度上的格子取出来。`i=2` 时得到 `["10-20ms(预期)", "5ms 内(预期)", "很好"]`。
- `cells = [c for n in names for c in OPTIONS[n]]` 双层推导式,把 3×4 个格子拍平成一个 12 个元素的列表,相当于 `names.flatMap(n => OPTIONS[n])`。
- `numeric = sum(has_number(c) for c in cells)` `True` 在 Python 里当 1 算,所以对一串布尔值求和就是数 `True` 的个数。实跑结果是 6。
- `for dim, cell in zip(DIMS, OPTIONS[n]):` `zip` 把两个列表按位置配对,第一对是 `("接入 6 家供应商", "开箱即用")`。JS 没有内置 zip,相当于 `DIMS.map((d, i) => [d, OPTIONS[n][i]])`。
- `if "延迟" in dim and not ("预期" in cell or "实测" in cell):` 只检查性能类维度:维度名里有「延迟」、格子里既没有「预期」也没有「实测」,就报警。`"延迟" in dim` 是子串判断,相当于 `dim.includes("延迟")`。
- `if __name__ == "__main__":` 直接运行这个文件时才调 `main()`,被别的文件 import 时不跑。[Day 32](/blog/agent-zero/day-032-modules/) 讲过。

</div>

在 `agent-zero-lab/` 根目录运行:

```bash
cd ~/agent-zero-lab        # 换成你自己的练习仓库路径
uv run python -m part10.tradeoff_table
```

实跑输出:

```text
| 维度 | A. LiteLLM Proxy | B. 自研轻量网关 | C. 云厂商网关 |
| --- | --- | --- | --- |
| 接入 6 家供应商 | 开箱即用 | 约 2 人周适配 | 部分支持 |
| 租户级配额 | 有,要它的数据库 | 按我们的租户模型 | 粒度到账号 |
| 额外延迟 P95 | 10-20ms(预期) | 5ms 内(预期) | 很好 |
| 第一版上线 | 2 周 | 5-6 周 | 1 周 |

6/12 个格子有数字
警告:C. 云厂商网关 的「额外延迟 P95」写的是「很好」,没标预期还是实测
```

`python -m part10.tradeoff_table` 的意思是「把 `part10/tradeoff_table.py` 当模块运行」,点号代替斜杠、不带 `.py`。今天所有脚本都这么跑,好处是后面的脚本可以写 `from part10.xxx import ...` 互相引用,也能 import 到根目录下的 `common/`。

12 个格子只有一半带数字,这在第一稿里很正常。我的标准是至少一半,而且凡是性能、成本、工期这类能量化的格子都要有数字或量级。延迟那一行特别要小心:A 和 B 都写了「预期」,说明还没压测,上线计划里就必须有一条压测任务;C 写「很好」,评审时被问一句「多少毫秒?」就答不上来。**设计文档里编数字,是评审会上最容易翻车的地方**,没测过就写预期区间和依据。

## 取舍那段话怎么收住

表只完成了「同一组维度比较」。另外三个要素要靠表下面那段话。拿上面这张表,写得比较好的版本大概是这样:

> 在「三个月内让五个业务团队接入」和「数据不能出境」两个约束下,我们选 A。代价是跟着上游的版本节奏走,升级可能带来破坏性变更;对策是锁定小版本号,CI 里跑网关回归测试,每季度评估一次升级。如果租户数超过 50 个,或者 LiteLLM 的配额模型满足不了按功能归因成本,重新评估 B。C 被排除,是因为它的配额粒度只到云账号,我们的租户是账号下的业务团队。

拆开看这段话做了几件事。第一句先写约束,而且是业务约束(时间、合规),不是「我更喜欢 Python 写的东西」这种技术偏好。第二句承认代价,紧跟对策,读者不用自己去想「那升级出问题怎么办」。第三句是推翻条件,很多人不写这句,但它让读者知道你不是在赌,而是在当前信息下做了一个可以回头的选择,半年后真到了 50 个租户,谁都能拿这句话去启动重新评估,不需要找你本人。最后一句给落选方案一个具体的出局理由,证明它不是稻草人。

稻草人是这一节最常见的病。「方案 B:不做网关,继续各自调用。缺点:很乱。」这种备选方案一看就是凑数的。真正的备选方案,是你认真考虑过、在某些条件下可能更好的方案。判断方法很简单:如果你写不出「在什么情况下 B 会比 A 好」,那 B 就是稻草人,要么换一个,要么承认调研没做够。

你在 [Day 623](/blog/agent-zero/day-623-tech-selection/) 做过打分矩阵和敏感性分析,那是选型报告的写法,给每个维度加权重算总分。设计文档里一般不用加权总分,因为权重本身就很难让所有人同意,评审会容易变成争论「延迟该占 20% 还是 30%」。设计文档更常见的做法就是上面这样:表摆事实,一段话讲在当前约束下哪几个维度起决定作用。

## 第二步:写个小检查器,替评审人先挑一遍

上面那些规矩(缺节、数字没标、取舍没代价没推翻条件)都是能机械检查的。评审人的时间很贵,别让他花在这种事上。我们写一个 `doc_lint.py`,lint 这个词你在前端用 ESLint 时就熟悉了,意思是按规则静态检查一遍。

先准备一份故意写得很差的草稿 `part10/samples/gateway-draft.md`:

```markdown
# AgentOps 模型网关设计

## 背景
每个业务团队各自调模型、各自管 key。上个月一个团队把额度打爆,另外三个团队的线上 Agent 一起 429。

## 目标
- 所有模型调用经过统一网关
- P95 额外延迟不超过 30 毫秒

## 方案
网关放在业务和供应商之间,做路由、限流、租户配额。预计延迟 10 毫秒。

## 备选方案
我们选 LiteLLM,因为它功能全、社区活跃。
```

<div class="line-notes">

- `## 背景` 检查器按 `## ` 开头的行切节,所以每一节必须用二级标题。
- `- P95 额外延迟不超过 30 毫秒` 这是目标,是承诺,不是估计,检查器会跳过「目标」这一节的数字。
- `预计延迟 10 毫秒。` 这是估计,但没写清是预期还是实测。「预计」两个字不算,检查器只认「预期 / 实测 / 假设」三个词,原因是这三个词意思不重叠,「预计」「大概」「估计」混着用,读者分不清你测过没有。
- `我们选 LiteLLM,因为它功能全、社区活跃。` 就是前面那句中级写法,没有代价也没有推翻条件。

</div>

然后是检查器本体 `part10/doc_lint.py`:

```python
# agent-zero-lab/part10/doc_lint.py
import re
import sys
from pathlib import Path

REQUIRED = ["背景", "目标", "非目标", "现状", "方案", "备选方案",
            "评测计划", "成本估算", "失败模式", "安全和权限", "上线计划", "开放问题"]
NUM_WITH_UNIT = re.compile(r"\d+(\.\d+)?\s*(毫秒|ms|%|个百分点|元|¥|QPS|人周|周|天)")
TAGS = ("预期", "实测", "假设")
NO_NUM_CHECK = ("目标", "非目标", "上线计划")  # 这几节的数字是承诺和规则,不是估计

def split_sections(text: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current = ""
    for line in text.splitlines():
        if line.startswith("## "):
            current = line[3:].strip()
            sections[current] = ""
        elif current:
            sections[current] += line + "\n"
    return sections

def lint(path: Path) -> list[str]:
    sections = split_sections(path.read_text(encoding="utf-8"))
    problems: list[str] = []
    for name in REQUIRED:
        if not any(h == name or h.startswith(name) for h in sections):
            problems.append(f"缺少一节:{name}")
    for title, body in sections.items():
        if title.startswith(NO_NUM_CHECK):
            continue
        for line in body.splitlines():
            if NUM_WITH_UNIT.search(line) and not any(t in line for t in TAGS):
                problems.append(f"[{title}] 数字没标预期/实测/假设:{line.strip()[:40]}")
    alt = next((b for h, b in sections.items() if h.startswith("备选方案")), "")
    if alt and "代价" not in alt:
        problems.append("[备选方案] 没写选中方案的代价")
    if alt and not ("推翻" in alt or "重新评估" in alt):
        problems.append("[备选方案] 没写推翻条件")
    return problems

if __name__ == "__main__":
    doc = Path(sys.argv[1])
    found = lint(doc)
    for p in found:
        print("-", p)
    print(f"{doc.name}: {len(found)} 个问题")
    sys.exit(1 if found else 0)
```

<div class="line-notes">

- `import sys` 用到两个东西:`sys.argv` 拿命令行参数(相当于 Node 的 `process.argv`),`sys.exit` 设置退出码(相当于 `process.exit`)。
- `from pathlib import Path` [Day 37](/blog/agent-zero/day-037-pathlib/) 学的路径对象,`Path("a.md").read_text()` 读整个文件。
- `REQUIRED = [` 十二个必须有的节,就是上一节骨架里的那些。「评测计划」「成本估算」「失败模式」「安全和权限」是 Agent 专属的四节,普通后端文档可以删掉它们。
- `NUM_WITH_UNIT = re.compile(` 预先编译一个正则,相当于 JS 里先写好 `const re = /.../`。规则是「数字,可能带小数,可能有空格,后面跟一个单位」。代入 `"预计延迟 10 毫秒。"`,能匹配到 `10 毫秒`;代入 `"5 个团队"` 匹配不到,因为「个」不在单位列表里。
- `TAGS = ("预期", "实测", "假设")` 元组(≈ 只读数组)。一行里出现这三个词之一,就算标过了。
- `NO_NUM_CHECK = (` 目标、非目标、上线计划里的数字是承诺和规则,不需要标预期。我第一版没加这一行,结果「P95 额外延迟不超过 30 毫秒」也被报了,误报太多的检查器没人会用。
- `def split_sections(text: str) -> dict[str, str]:` 把整篇文档按二级标题切成 `{标题: 正文}`。
- `current = ""` 当前在哪一节。一开始是空字符串,一级标题和二级标题之前的内容不归任何一节。
- `if line.startswith("## "):` 遇到二级标题。`startswith` 相当于 JS 的 `startsWith`。
- `current = line[3:].strip()` `line[3:]` 是从第 3 个字符切到末尾(≈ `line.slice(3)`),去掉 `## `。代入 `"## 备选方案"` 得到 `"备选方案"`。
- `elif current:` 不是标题、并且已经进入某一节,就把这行追加进那一节。空字符串在 Python 里是假值,和 JS 一样。
- `sections = split_sections(path.read_text(encoding="utf-8"))` 对草稿来说,得到 `{"背景": ..., "目标": ..., "方案": ..., "备选方案": ...}` 四个键。
- `if not any(h == name or h.startswith(name) for h in sections):` `any(...)` 相当于 JS 的 `array.some(...)`。允许标题比要求的长,比如真实文档里写「备选方案和取舍」也算有「备选方案」这一节。草稿里找不到「非目标」,于是记一条问题。
- `if title.startswith(NO_NUM_CHECK):` `startswith` 可以接一个元组,任意一个前缀匹配就算,相当于 `NO_NUM_CHECK.some(p => title.startsWith(p))`。
- `if NUM_WITH_UNIT.search(line) and not any(t in line for t in TAGS):` 一行里有带单位的数字、又没有标签,就报。代入「方案」节那行,`search` 找到 `10 毫秒`,三个标签都不在,报一条。
- `problems.append(f"[{title}] 数字没标预期/实测/假设:{line.strip()[:40]}")` `[:40]` 截前 40 个字符,免得一整段话塞进报告。
- `alt = next((b for h, b in sections.items() if h.startswith("备选方案")), "")` `next(生成器, 默认值)` 取第一个满足条件的元素,找不到就用默认值 `""`,相当于 `Object.entries(sections).find(...)?.[1] ?? ""`。草稿里拿到的是那句「功能全、社区活跃」。
- `if alt and "代价" not in alt:` 备选方案节存在、但通篇没出现「代价」二字。这是个很粗的检查,写了「代价」不代表写得好,但没写一定不好。
- `if alt and not ("推翻" in alt or "重新评估" in alt):` 推翻条件同理。
- `doc = Path(sys.argv[1])` `sys.argv[0]` 是脚本自己,`[1]` 是第一个参数。
- `sys.exit(1 if found else 0)` 有问题就以退出码 1 结束。这样以后可以把它挂进 CI(你在 [Day 637](/blog/agent-zero/day-637-agentops-sec/) 把 promptfoo 挂进 CI 用的就是同一个机制:退出码非 0,流水线变红)。

</div>

先故意敲错一次文件名,看看报错长什么样:

```bash
uv run python -m part10.doc_lint part10/samples/gateway-drft.md
```

```text
Traceback (most recent call last):
  ...(中间几层省略)
  File ".../lib/python3.12/pathlib.py", line 1013, in open
    return io.open(self, mode, buffering, encoding, errors, newline)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
FileNotFoundError: [Errno 2] No such file or directory: 'part10/samples/gateway-drft.md'
```

Traceback 从下往上读,最后一行就是原因:`draft` 敲成了 `drft`。路径是相对于你当前所在目录算的,所以这类报错还有一个常见原因,是你没在 `agent-zero-lab/` 根目录下运行。改对文件名再跑:

```bash
uv run python -m part10.doc_lint part10/samples/gateway-draft.md; echo "exit=$?"
```

```text
- 缺少一节:非目标
- 缺少一节:现状
- 缺少一节:评测计划
- 缺少一节:成本估算
- 缺少一节:失败模式
- 缺少一节:安全和权限
- 缺少一节:上线计划
- 缺少一节:开放问题
- [方案] 数字没标预期/实测/假设:网关放在业务和供应商之间,做路由、限流、租户配额。预计延迟 10 毫秒。
- [备选方案] 没写选中方案的代价
- [备选方案] 没写推翻条件
gateway-draft.md: 11 个问题
exit=1
```

`echo "exit=$?"` 打印上一条命令的退出码,`$?` 是 shell 的特殊变量。11 个问题,退出码 1。

再写一份认真的 `part10/samples/gateway-v1.md`。这份就是今天的示范设计文档,篇幅压缩过,真实文档每节要写得更长,但该有的东西都在:

```markdown
# AgentOps 模型网关设计

作者:你 | 状态:评审中 | 评审人:王工(平台)、李工(安全) | 2026-10-22

## 背景
每个业务团队各自调模型、各自管 key。上个月一个团队把额度打爆,另外三个团队的线上 Agent 一起 429。

## 目标
- 所有模型调用经过统一网关,直连供应商的调用降到 0
- P95 额外延迟不超过 30 毫秒
- 每个租户每月的模型花费能在看板上按天查到

## 非目标
- 本期不做语义缓存
- 本期不支持自部署模型的自动扩缩容
- 本期不改各团队的提示词

## 现状
5 个团队各自持有供应商 key,共用一个组织额度,没有任何租户级限流。

## 方案
网关放在业务和供应商之间,做路由、令牌桶限流、租户配额和成本记账。额外延迟 5 毫秒以内(预期,上线前压测)。

## 备选方案和取舍
| 维度 | A. LiteLLM Proxy | B. 自研轻量网关 |
| --- | --- | --- |
| 第一版上线 | 2 周(预期) | 5-6 周(预期) |
| 维护人力 | 0.25 人(预期) | 0.5 人(预期) |

在「三个月内让五个团队接入」和「数据不能出境」两个约束下选 A。代价是跟着上游升级,对策是锁版本加网关回归测试。租户超过 50 个或者要按功能归因成本时重新评估 B。

## 评测计划
网关不改模型输出,评测只看两件事:接入前后 SupportPilot 评测集通过率不变(Wilson 区间重叠),压测 P95。

## 成本估算
网关自身 2 台 2 核 4G,每月约 300 元(假设,按当前云厂商报价)。

## 失败模式和降级
供应商 5xx 连续 3 次(规则)切备用供应商;网关自己挂了,业务用紧急直连开关,开关打开要告警。

## 安全和权限
供应商 key 只存在网关里,业务只拿租户 key;审计日志记录租户、模型、token 数,不记录正文。

## 上线计划
先接 SupportPilot 一个团队 1 周,错误率比直连高 0.5 个百分点就回滚。

## 开放问题
- 两个团队要求的配额周期不同(按天还是按月),待平台负责人定
```

<div class="line-notes">

- `作者:你 | 状态:评审中` 元信息一行写完。评审人写了两个具体的人,一个管平台、一个管安全,正好对应这个方案影响最大的两块。
- `直连供应商的调用降到 0` 目标可验证:网关上线后去供应商后台看,非网关 IP 发来的请求数应该是 0。
- `本期不做语义缓存` 非目标。语义缓存是「意思相近的问题返回同一个答案」,一提出来就会有人想加,先挡掉。
- `额外延迟 5 毫秒以内(预期,上线前压测)` 标了预期,并且说了什么时候变成实测。
- `| 第一版上线 | 2 周(预期) | 5-6 周(预期) |` 工期也是估计,也标。
- `在「三个月内让五个团队接入」` 四要素的那段话:约束、代价、对策、推翻条件。
- `Wilson 区间重叠` 两次评测的通过率区间有重叠,就不能说接网关让效果变差了。这是 [Day 547](/blog/agent-zero/day-547-eval-stats-1/) 的东西。
- `每月约 300 元(假设,按当前云厂商报价)` 成本标了假设,并写了依据来源。
- `供应商 5xx 连续 3 次(规则)` 「3 次」不在检查器的单位列表里,其实不会被报。我还是标了「规则」,让读者知道这是定下来的阈值,不是估出来的。同一行后半句「业务用紧急直连开关」是给网关这个单点留的旁路,这一句一会儿会被评审人挑出问题,先留着。
- `不记录正文` 审计日志不存用户对话原文,减少数据泄露面。
- `错误率比直连高 0.5 个百分点就回滚` 可执行的回滚条件。

</div>

```bash
uv run python -m part10.doc_lint part10/samples/gateway-v1.md; echo "exit=$?"
```

```text
gateway-v1.md: 0 个问题
exit=0
```

0 个问题不代表文档写得好,只代表没犯低级错误。检查器能管的是形式,内容好不好还得靠人。下面讲人那一部分之前,先把 ADR 这个工具补上。

## ADR 复习:一条一个决定,只追加不修改

ADR 在 [Day 519](/blog/agent-zero/day-519-senior-map/) 写过第一份,[Day 543](/blog/agent-zero/day-543-design-doc-2/) 又给 AgentOps 运行时写了两份。这里只补一件之前没细讲的事:决定变了怎么办。

设计文档讲一整套方案,定稿以后很少有人回头看。半年后新同事问「网关为什么用 LiteLLM 不自己写」,没人记得当时的约束。ADR 就是为这个问题准备的,Michael Nygard 2011 年那篇《Documenting Architecture Decisions》给的格式到今天还是最常用的:标题、状态、背景、决定、后果。

决定变了的时候,**不改旧的 ADR,写一条新的**。新的状态写「已接受,取代 ADR-0001」,旧的状态改成「已被 ADR-0003 取代」,正文一个字不动。这样翻记录的人能看到决策是怎么演变的,就像 git 历史一样只往后加。

手动维护编号和取代关系很容易出错,npryce 的 adr-tools 是一组 shell 脚本专门干这个(`adr new`、`adr new -s 7`)。我们用 Python 写一个最小版本,顺便练一下文件操作。`part10/adr.py` 第一版:

```python
# agent-zero-lab/part10/adr.py(第一版,有 bug)
import re
import sys
from datetime import date
from pathlib import Path

ADR_DIR = Path("part10/samples/adr")
TEMPLATE = """# ADR-{num:04d}:{title}

- 状态:已接受({today}){extra}

## 背景

## 决定

## 后果
好的:
坏的:
需要重新评估的条件:
"""

def next_number() -> int:
    nums = [int(p.name[:4]) for p in ADR_DIR.glob("[0-9][0-9][0-9][0-9]-*.md")]
    return max(nums, default=0) + 1

def find(num: int) -> Path:
    hits = list(ADR_DIR.glob(f"{num:04d}-*.md"))
    if not hits:
        raise SystemExit(f"找不到 ADR-{num:04d}")
    return hits[0]

def new(title: str, supersedes: int | None = None) -> Path:
    ADR_DIR.mkdir(parents=True, exist_ok=True)
    num = next_number()
    extra = f",取代 ADR-{supersedes:04d}" if supersedes else ""
    slug = re.sub(r"\s+", "-", title)[:30]
    path = ADR_DIR / f"{num:04d}-{slug}.md"
    path.write_text(TEMPLATE.format(num=num, title=title, today=date.today(), extra=extra), encoding="utf-8")
    if supersedes:
        old = find(supersedes)
        text = old.read_text(encoding="utf-8")
        text = re.sub(r"- 状态:.*", f"- 状态:已被 ADR-{num:04d} 取代", text, count=1)
        old.write_text(text, encoding="utf-8")
    return path

if __name__ == "__main__":
    if sys.argv[1] == "new":
        print("新建", new(sys.argv[2]))
    elif sys.argv[1] == "supersede":
        print("新建", new(sys.argv[3], supersedes=int(sys.argv[2])))
```

<div class="line-notes">

- `from datetime import date` `date.today()` 拿今天的日期,打印出来是 `2026-10-22` 这种格式。
- `ADR_DIR = Path("part10/samples/adr")` ADR 放的目录。真实项目里放仓库的 `docs/adr/`,和代码一起走 MR。
- `TEMPLATE = """# ADR-{num:04d}:{title}` 三引号是多行字符串,相当于 JS 的反引号模板,但占位符是 `{}`,要用 `.format()` 填。`{num:04d}` 的意思是整数补零到 4 位,`1` 变成 `0001`。
- `- 状态:已接受({today}){extra}` `extra` 平时是空字符串,取代别人时是「,取代 ADR-0001」。
- `nums = [int(p.name[:4]) for p in ADR_DIR.glob(` `glob` 按通配符找文件,`[0-9]` 是一位数字,四个连着就是「四位数字开头」。`p.name` 是文件名,`[:4]` 取前四个字符,`int()` 转成整数。目录里有 `0001-...` 和 `0002-...` 时,`nums` 是 `[1, 2]`。
- `return max(nums, default=0) + 1` 空目录时 `max([])` 会报错,`default=0` 让它返回 0,所以第一条是 1。
- `hits = list(ADR_DIR.glob(f"{num:04d}-*.md"))` f-string 里也能用 `:04d`,`num=9` 时找的是 `0009-*.md`。
- `raise SystemExit(f"找不到 ADR-{num:04d}")` `SystemExit` 是一种特殊的异常,抛出来不打印 traceback,直接把消息打到终端、退出码设为 1。给命令行工具报用户错误很合适。
- `ADR_DIR.mkdir(parents=True, exist_ok=True)` 建目录,`parents=True` 相当于 `mkdir -p`,`exist_ok=True` 让已存在时不报错。
- `num = next_number()` 先算编号。
- `slug = re.sub(r"\s+", "-", title)[:30]` 把标题里的空白换成连字符做文件名,`\s+` 是一个或多个空白字符。代入「模型网关采用 LiteLLM Proxy」得到「模型网关采用-LiteLLM-Proxy」。
- `path = ADR_DIR / f"{num:04d}-{slug}.md"` `Path` 对象可以用 `/` 拼路径,这是 pathlib 的写法。
- `path.write_text(TEMPLATE.format(` 先写新文件。**bug 就在这一行和下面那个 `if` 的顺序里**,一会儿演示。
- `old = find(supersedes)` 要取代的话,找旧文件。
- `text = re.sub(r"- 状态:.*", f"- 状态:已被 ADR-{num:04d} 取代", text, count=1)` 把旧文件第一行状态整行替换掉。`.*` 匹配到行尾,`count=1` 只替换第一处。
- `if sys.argv[1] == "new":` 两个子命令:`new 标题` 和 `supersede 旧编号 新标题`。

</div>

试一下:新建两条,再让第三条取代第一条。

```bash
rm -rf part10/samples/adr
uv run python -m part10.adr new "模型网关采用 LiteLLM Proxy"
uv run python -m part10.adr new "缓存只做精确匹配"
uv run python -m part10.adr supersede 1 "租户超过 50 个改自研网关"
head -3 part10/samples/adr/0001*; head -3 part10/samples/adr/0003*
```

```text
新建 part10/samples/adr/0001-模型网关采用-LiteLLM-Proxy.md
新建 part10/samples/adr/0002-缓存只做精确匹配.md
新建 part10/samples/adr/0003-租户超过-50-个改自研网关.md
# ADR-0001:模型网关采用 LiteLLM Proxy

- 状态:已被 ADR-0003 取代
# ADR-0003:租户超过 50 个改自研网关

- 状态:已接受(2026-10-22),取代 ADR-0001
```

看起来没问题。现在手滑一下,取代一个不存在的 9 号:

```bash
uv run python -m part10.adr supersede 9 "x"; echo "exit=$?"
ls part10/samples/adr
```

```text
找不到 ADR-0009
exit=1
0001-模型网关采用-LiteLLM-Proxy.md
0002-缓存只做精确匹配.md
0003-租户超过-50-个改自研网关.md
0004-x.md
```

报了错,但 `0004-x.md` 已经被写出来了。这是我第一次写的时候真踩的坑:**先写新文件,再去找旧文件**,旧文件找不到时新文件已经落盘,留下一条半成品 ADR,下次编号还会从 5 开始。修法是把检查挪到写任何东西之前:

```python
# agent-zero-lab/part10/adr.py(修好的 new 函数,其余不变)
def new(title: str, supersedes: int | None = None) -> Path:
    ADR_DIR.mkdir(parents=True, exist_ok=True)
    old = find(supersedes) if supersedes else None  # 先确认旧的存在,再动手写
    num = next_number()
    extra = f",取代 ADR-{supersedes:04d}" if supersedes else ""
    slug = re.sub(r"\s+", "-", title)[:30]
    path = ADR_DIR / f"{num:04d}-{slug}.md"
    path.write_text(TEMPLATE.format(num=num, title=title, today=date.today(), extra=extra), encoding="utf-8")
    if old:
        text = old.read_text(encoding="utf-8")
        text = re.sub(r"- 状态:.*", f"- 状态:已被 ADR-{num:04d} 取代", text, count=1)
        old.write_text(text, encoding="utf-8")
    return path
```

<div class="line-notes">

- `old = find(supersedes) if supersedes else None` 条件表达式,相当于 JS 的 `supersedes ? find(supersedes) : null`。找不到就在这里 `SystemExit`,后面的写文件根本不会执行。
- `if old:` 原来是 `if supersedes:` 再 `find`,现在直接用已经找到的 `old`。

</div>

```bash
rm part10/samples/adr/0004-x.md
uv run python -m part10.adr supersede 9 "x"; echo "exit=$?"
ls part10/samples/adr
```

```text
找不到 ADR-0009
exit=1
0001-模型网关采用-LiteLLM-Proxy.md
0002-缓存只做精确匹配.md
0003-租户超过-50-个改自研网关.md
```

这个 bug 的模式在后端很常见:一个操作分两步写盘,第一步成功第二步失败,系统就停在一个不一致的状态。数据库靠事务解决,文件操作最简单的办法就是「先把所有检查做完,再开始写」。

<figure>
<svg viewBox="0 0 640 200" role="img" aria-label="ADR 只追加不修改,新决定取代旧决定">
<rect x="20" y="60" width="160" height="70" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="100" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">ADR-0001</text>
<text x="100" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">网关用 LiteLLM</text>
<text x="100" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">已被 0003 取代</text>
<rect x="240" y="60" width="160" height="70" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">ADR-0002</text>
<text x="320" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">缓存只做精确匹配</text>
<text x="320" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">已接受</text>
<rect x="460" y="60" width="160" height="70" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="540" y="86" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">ADR-0003</text>
<text x="540" y="104" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">租户超 50 改自研</text>
<text x="540" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">已接受,取代 0001</text>
<path d="M 540 60 C 540 20, 100 20, 100 58" fill="none" stroke="var(--compute)" stroke-width="1.5"/>
<text x="320" y="30" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">取代</text>
<text x="320" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">旧的不删,只改状态;新的写清楚取代了谁</text>
</svg>
<figcaption>刚才脚本跑出来的三条 ADR。一串读下来就是这个系统的决策史,半年后有人问「当初为什么」,翻到编号就行。</figcaption>
</figure>

再补三条经验。一个 ADR 只记一个决定,「网关选型和缓存策略」应该是两条。写得短,一屏能看完,长了说明它其实是一份设计文档。和代码放在一起,放 wiki 里的 ADR 很快就会和代码脱节。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ymjN6YE4Z&autoplay=0&high_quality=1" title="【IT老齐899.59】架构决策记录ADR最佳实践" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐899.59】架构决策记录ADR最佳实践 · 11 分钟,中文讲 ADR 的格式和放在仓库里的做法,和上面的取代规则对照着听。</figcaption>
</figure>

## 第三步:评审,怎么接住质疑

文档写完只完成了一半,另一半在评审。这是今天的第二个新概念:**每条评审意见先分类,再处理**。

先说流程上的两件事。正式评审前,把草稿私下发给两三个最可能反对的人:负责相关系统的同事、安全或合规的人、会受影响的业务团队负责人。私下聊十五分钟,大分歧在这一步解决,到了正式评审会,不应该出现「第一次听说」的反对意见。Tanya Reilly 在《The Staff Engineer's Path》里讲带大项目时反复强调这一点。然后是异步评论为主、会议为辅:文档发出去留三到五个工作日让大家在文档里评论,会议只讨论评论里没解决的分歧。一小时的评审会如果有一半时间在念文档,说明流程有问题。

收到评论以后,我分三类处理:

- **事实错误或遗漏**(「这个接口其实已经有限流了」):当场改,回复「已改」。
- **方案分歧**(「为什么不用消息队列」):备选方案里写过的,指过去;没写过的,补进备选方案并写清为什么不选;对方说得对,就认,改方案。
- **需要升级**(两个团队对优先级看法不同,或者涉及安全基线、合规判断):不在评论里争,记下来,交给能拍板的人,文档里写「待 X 决定」。

没人帮你预审的时候,可以先让模型扮演评审人挑一遍。下面这个脚本让 DeepSeek 分别扮演安全负责人和业务团队负责人,只挑毛病不给改法,每条自己先归类。它用的是 [Day 136](/blog/agent-zero/day-136-llm-client-2/) 写的 `common/llm.py` 里的 `LLMClient`,和 [Day 148](/blog/agent-zero/day-148-structured-2/) 学的 JSON mode。`.env` 里的 `LLM_MODEL` 是 `deepseek-flash`,这个名字是 2026 年 10 月查到的 DeepSeek 当前模型名。

```python
# agent-zero-lab/part10/review_bot.py
import json
import sys
from pathlib import Path

from common.llm import LLMClient

ROLE = {
    "security": "你是公司的安全负责人,只关心密钥、数据出境、审计和 prompt injection。",
    "business": "你是一个要接入网关的业务团队负责人,只关心迁移成本、延迟和出问题时谁负责。",
}
PROMPT = """{role}
下面是一份设计文档草稿。只挑毛病,不给改法,最多 4 条。
每条归一类:事实错误(文档写错或漏了事实)、方案分歧(你认为别的做法更好)、需要升级(超出作者决策权)。
只输出 JSON:{{"comments": [{{"type": "...", "quote": "文档原句", "comment": "一句话"}}]}}

{doc}"""

def review(doc: str, who: str) -> list[dict[str, str]]:
    llm = LLMClient()
    r = llm.chat(
        [{"role": "user", "content": PROMPT.format(role=ROLE[who], doc=doc)}],
        response_format={"type": "json_object"},
        temperature=0,
    )
    print(f"[{who}] 输入 {r.prompt_tokens} / 输出 {r.completion_tokens} tokens,约 ¥{r.cost:.4f}")
    return json.loads(r.content)["comments"]

if __name__ == "__main__":
    doc = Path(sys.argv[1]).read_text(encoding="utf-8")
    for who in ("security", "business"):
        for c in review(doc, who):
            print(f"  {c['type']} | {c['quote'][:24]} | {c['comment']}")
```

<div class="line-notes">

- `from common.llm import LLMClient` 从根目录的 `common/llm.py` 导入。用 `python -m part10.review_bot` 运行时,当前目录(`agent-zero-lab/`)在 import 搜索路径里,所以这行能找到 `common`。
- `ROLE = {` 两个角色,各自只关心自己那一块。角色越窄,挑出来的毛病越具体。我试过一个「你是资深评审人」的通用角色,挑出来的全是「建议补充更多细节」这种废话。
- `只挑毛病,不给改法,最多 4 条。` 不让它给改法,是因为改法应该你自己想;限制条数,是逼它挑最重要的。
- `只输出 JSON:{{"comments": [` 模板里要输出字面的花括号,在 `.format()` 里得写成 `{{` 和 `}}`,不然 Python 会把它当成占位符。这是很容易踩的坑,少写一对会报 `KeyError`。
- `response_format={"type": "json_object"},` JSON mode,让模型保证输出是合法 JSON。DeepSeek 要求提示词里出现「json」字样,上面那行「只输出 JSON」满足了这个要求。
- `temperature=0,` 让结果尽量稳定,方便你改完文档再跑一次做对比。
- `print(f"[{who}] 输入 {r.prompt_tokens}` 实跑 security 那次是输入 699、输出 293 tokens,约 ¥0.0037。
- `return json.loads(r.content)["comments"]` `json.loads` ≈ `JSON.parse`,[Day 39](/blog/agent-zero/day-039-json/) 学过。
- `for who in ("security", "business"):` 两个角色各调一次,两次调用是独立的,互相看不到对方的意见。
- `print(f"  {c['type']} | {c['quote'][:24]} | {c['comment']}")` 引用的原句只打前 24 个字符,够你定位就行。

</div>

```bash
uv run python -m part10.review_bot part10/samples/gateway-v1.md
```

实跑输出(模型的输出每次可能略有不同,下面是我这次的原样):

```text
[security] 输入 699 / 输出 293 tokens,约 ¥0.0037
  事实错误 | 在「三个月内让五个团队接入」和「数据不能出境」两 | 文档未说明 LiteLLM Proxy 的部署位置与供应商端点，无法证明选 A 满足数据不出境，且该约束与选型结论之间缺少事实依据。
  需要升级 | 供应商 key 只存在网关里,业务只拿租户 ke | 密钥集中托管与审计留存策略属于安全基线，超出作者决策权，需安全负责人审批并明确密钥轮换与审计保留期限。
  方案分歧 | 网关自己挂了,业务用紧急直连开关,开关打开要告警 | 紧急直连开关会让业务重新持有供应商 key 并绕过审计与限流，与“直连调用降到 0”目标冲突，应改为网关多活或降级到备用网关。
  事实错误 | 网关不改模型输出,评测只看两件事:接入前后 Su | 评测计划完全未覆盖 prompt injection 与越权调用，网关作为统一入口应验证注入防护和租户隔离，这是安全侧的关键事实缺口。
[business] 输入 703 / 输出 295 tokens,约 ¥0.0038
  需要升级 | 在「三个月内让五个团队接入」和「数据不能出境」两 | 选型结论依赖「数据不能出境」这一合规判断，超出作者决策权，需安全/法务书面确认 LiteLLM 的调用链路是否真的不出境。
  事实错误 | 网关自己挂了,业务用紧急直连开关,开关打开要告警 | 紧急直连开关意味着业务仍持有供应商 key，与「直连供应商的调用降到 0」「key 只存在网关里」直接矛盾，文档未说明 key 如何保留与管控。
  方案分歧 | 额外延迟 5 毫秒以内(预期,上线前压测)。 | 目标写 P95 不超过 30 毫秒，方案却只承诺 5 毫秒且无压测口径（并发、模型、地域），对业务方无法作为迁移承诺。
  需要升级 | 两个团队要求的配额周期不同(按天还是按月),待平 | 配额周期直接决定限流实现和成本看板口径，属于跨团队资源分配，需在评审前升级定夺而非留作开放问题。
```

两次一共 ¥0.0075,算式是 `(699+703) × 2 元/百万 + (293+295) × 8 元/百万 ≈ 0.0028 + 0.0047`(没命中缓存,按 2026 年 10 月 22 日查到的 deepseek-flash 高峰价:输入未命中 2 元、输出 8 元每百万 token)。

这份输出有几个地方值得细看。两个角色都挑中了「紧急直连开关」,这是真问题:目标写「直连降到 0」「key 只在网关里」,降级方案却要业务手里留着供应商 key,文档自己和自己打架。这条我会当成事实错误处理,改方案,比如把紧急旁路改成第二个网关实例,key 依然不出平台。

但模型的分类不能全信。安全角色把「评测计划没覆盖 prompt injection」归成事实错误,我觉得它更像方案分歧:网关本身不处理正文,注入防护在 [Day 628](/blog/agent-zero/day-628-agentops-mcp-1/) 的 MCP 代理那一层,在备选方案或安全那一节指过去就行。业务角色那条「5 毫秒和 30 毫秒对不上」也不完全对,30 是上限承诺,5 是预期值,两者不矛盾,但它点出了一个真缺口:压测口径(多少并发、什么模型、哪个地域)没写。**模型给的分类是参考,最后分到哪一类是你的判断**,这一步不能外包。

最后说评审会上的心态。资深工程师在评审会上最常见的失误是防御心太重,每个问题都要赢。评审是为了让方案更好,不是证明作者聪明。被问到没想过的问题,直接说「这个我没考虑到,记下来,会后补一个分析」,比现场硬编一个答案好得多。定稿以后,实现过程中和设计不一样的地方,回到文档里加一段「实现时的变化」,这就是图里的「回填」。不回填的文档半年后会误导人,比没有文档还糟。

<figure>
<svg viewBox="0 0 640 220" role="img" aria-label="评审意见三类分流">
<rect x="20" y="85" width="130" height="50" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="85" y="108" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">一条评审意见</text>
<text x="85" y="125" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">先分类</text>
<rect x="230" y="20" width="160" height="46" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="310" y="40" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">事实错误/遗漏</text>
<text x="310" y="56" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">直连开关和目标打架</text>
<rect x="230" y="87" width="160" height="46" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="310" y="107" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">方案分歧</text>
<text x="310" y="123" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">注入防护放哪一层</text>
<rect x="230" y="154" width="160" height="46" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="310" y="174" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">需要升级</text>
<text x="310" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">配额周期按天还是按月</text>
<rect x="460" y="20" width="160" height="46" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="540" y="48" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">当场改,回「已改」</text>
<rect x="460" y="87" width="160" height="46" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="540" y="107" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">指向备选方案</text>
<text x="540" y="123" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">没写就补,对就认</text>
<rect x="460" y="154" width="160" height="46" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="540" y="174" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">写「待 X 决定」</text>
<text x="540" y="190" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">交给能拍板的人</text>
<line x1="150" y1="110" x2="230" y2="43" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="150" y1="110" x2="230" y2="110" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="150" y1="110" x2="230" y2="177" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="390" y1="43" x2="460" y2="43" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="390" y1="110" x2="460" y2="110" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="390" y1="177" x2="460" y2="177" stroke="var(--rule)" stroke-width="1.5"/>
</svg>
<figcaption>三类意见三种处理。中间一列的例子都来自上面模型评审的实跑结果,分类是我改过之后的。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV17s4y1J7rG&autoplay=0&high_quality=1" title="阿里工程师带你学技术文档该怎么写" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里技术_AlibabaTech · 阿里工程师带你学技术文档该怎么写 · 30 分钟,重点听技术方案文档怎么组织结构、怎么写给不同读者。</figcaption>
</figure>

## 今天的文件

| 文件 | 干什么 | 花钱吗 |
| --- | --- | --- |
| `part10/tradeoff_table.py` | 打印取舍表,数带数字的格子,抓没标预期/实测的性能格子 | 不花 |
| `part10/doc_lint.py` | 检查设计文档的节、数字标签、代价和推翻条件,有问题退出码 1 | 不花 |
| `part10/adr.py` | 新建 ADR、取代旧 ADR,先检查再写盘 | 不花 |
| `part10/review_bot.py` | 让模型扮演两个评审人挑刺并先分类 | 两次共 ¥0.0075 |
| `part10/samples/` | 草稿、示范设计文档、三条 ADR | 不花 |

## 动手练习

今天的产出物:一份 AgentOps 模型网关(或者你自己项目里任意一个模块)的设计文档、三条 ADR、一份评审记录。下面的题按顺序做。

**练习 1:改写一句取舍。** 把这句话改写成「一张同一组维度的表 + 一段四要素的话」:「我们选择 LangGraph,因为它是目前最流行的 Agent 框架,功能强大,社区活跃。」备选方案至少两个,表至少一半格子带数字或量级。

<details><summary>参考答案</summary>

先想约束。假设场景是 SupportPilot 的退款流程:需要在退款前停下来等人工审批、进程重启后能从断点继续、团队都会 Python、两个月内上线。备选方案挑两个认真考虑过的:自己写循环([Day 520](/blog/agent-zero/day-520-harness-parts/) 讲过 harness 包了哪些东西)、OpenAI Agents SDK。

| 维度 | A. LangGraph | B. 自己写循环 | C. OpenAI Agents SDK |
| --- | --- | --- | --- |
| 人工审批中断 | 内置 interrupt | 约 1 人周自己做 | 有,要配合它的运行方式 |
| 断点续跑 | checkpoint 存 Postgres | 约 2 人周 | 要自己接持久化 |
| 团队上手 | 约 1 周(预期) | 0 | 约 3 天(预期) |
| 依赖升级风险 | 大版本变化快 | 无 | 中等 |

在「两个月内上线」和「退款前必须能停下等人」两个约束下选 A。代价是框架抽象层多,调试要先读懂它的状态图,版本升级有破坏性变更的风险;对策是锁定版本,关键节点写单元测试,把框架调用集中在一个模块里。如果后续只剩线性流程、不再需要中断和续跑,或者升级成本连续两个季度超过 1 人周,重新评估 B。C 没选,是因为它的持久化要我们自己接,而这恰好是 A 现成提供的。

把这段话和表放进一个文件,用今天的检查器验证一下格式:

```bash
cat > part10/samples/ex1.md <<'EOF'
## 备选方案和取舍
| 维度 | A. LangGraph | B. 自己写循环 |
| --- | --- | --- |
| 团队上手 | 约 1 周(预期) | 0 |
在「两个月内上线」和「退款前必须能停下等人」两个约束下选 A。代价是框架抽象层多。升级成本连续两个季度超过 1 人周时重新评估 B。
EOF
uv run python -m part10.doc_lint part10/samples/ex1.md | tail -3
```

<div class="line-notes">

- `cat > part10/samples/ex1.md <<'EOF'` heredoc 写法,把两个 `EOF` 之间的内容写进文件,引号让里面的特殊字符不被 shell 展开。
- `| 团队上手 | 约 1 周(预期) | 0 |` 带单位的数字标了预期,不会被报。
- `升级成本连续两个季度超过 1 人周时重新评估 B。` 「1 人周」是推翻条件里的阈值,我没标,看检查器怎么说。
- `| tail -3` 只看最后三行,前面是一串「缺少一节」,这份只有一节,缺节是意料之中的。

</div>

实跑输出:

```text
- 缺少一节:开放问题
- [备选方案和取舍] 数字没标预期/实测/假设:在「两个月内上线」和「退款前必须能停下等人」两个约束下选 A。代价是框架抽象层多
ex1.md: 12 个问题
```

12 个问题里 11 个是缺节,真正值得看的是第二行:推翻条件里的「1 人周」被当成没标签的估计报了出来(「两个月」没被报,因为「月」不在单位列表里)。这是检查器的误报,推翻条件里的数字是阈值,和目标一样是规则。你可以在那句话后面加「(规则)」,也可以像练习 2 那样继续改检查器。这正好说明检查器只是辅助,规则写死了总会碰到它没想到的写法。

</details>

**练习 2:让检查器数条目。** 给 `doc_lint.py` 加一条规则:「目标」至少 3 条、「非目标」至少 3 条、「开放问题」至少 2 条(以 `- ` 开头的行算一条)。不要改原文件,新建 `part10/doc_lint_count.py`,复用 `lint` 和 `split_sections`。分别对 `gateway-draft.md` 和 `gateway-v1.md` 跑一遍。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/doc_lint_count.py
import sys
from pathlib import Path

from part10.doc_lint import lint, split_sections

MIN_ITEMS = {"目标": 3, "非目标": 3, "开放问题": 2}

def count_items(body: str) -> int:
    return sum(1 for line in body.splitlines() if line.lstrip().startswith("- "))

def lint_more(path: Path) -> list[str]:
    problems = lint(path)
    sections = split_sections(path.read_text(encoding="utf-8"))
    for name, need in MIN_ITEMS.items():
        body = sections.get(name)
        if body is None:
            continue  # 缺整节的情况 lint() 已经报过
        got = count_items(body)
        if got < need:
            problems.append(f"[{name}] 只有 {got} 条,至少要 {need} 条")
    return problems

if __name__ == "__main__":
    for arg in sys.argv[1:]:
        found = lint_more(Path(arg))
        for p in found:
            print("-", p)
        print(f"{Path(arg).name}: {len(found)} 个问题")
```

<div class="line-notes">

- `from part10.doc_lint import lint, split_sections` 复用今天写的两个函数。因为 `doc_lint.py` 的执行代码包在 `if __name__ == "__main__":` 里,import 时不会去读 `sys.argv[1]`。
- `MIN_ITEMS = {"目标": 3, "非目标": 3, "开放问题": 2}` 每节要求的最少条数,放在字典里,以后加规则只改这一行。
- `return sum(1 for line in body.splitlines() if line.lstrip().startswith("- "))` 数以 `- ` 开头的行。`lstrip()` 去掉左边空白,缩进的子条目也算。
- `body = sections.get(name)` `dict.get` 拿不到返回 `None`,不像 `sections[name]` 会抛 `KeyError`。相当于 JS 里访问不存在的属性得到 `undefined`。
- `continue  # 缺整节的情况 lint() 已经报过` 避免同一个问题报两次。草稿里没有「非目标」和「开放问题」,这两项会跳过。
- `for arg in sys.argv[1:]:` 支持一次传多个文件。`[1:]` 跳过脚本名。

</div>

```bash
uv run python -m part10.doc_lint_count part10/samples/gateway-draft.md part10/samples/gateway-v1.md
```

```text
- 缺少一节:非目标
- 缺少一节:现状
- 缺少一节:评测计划
- 缺少一节:成本估算
- 缺少一节:失败模式
- 缺少一节:安全和权限
- 缺少一节:上线计划
- 缺少一节:开放问题
- [方案] 数字没标预期/实测/假设:网关放在业务和供应商之间,做路由、限流、租户配额。预计延迟 10 毫秒。
- [备选方案] 没写选中方案的代价
- [备选方案] 没写推翻条件
- [目标] 只有 2 条,至少要 3 条
gateway-draft.md: 12 个问题
- [开放问题] 只有 1 条,至少要 2 条
gateway-v1.md: 1 个问题
```

示范文档在新规则下多了一个问题:开放问题只写了一条。补一条就行,比如「紧急旁路改成第二个网关实例后,两个实例之间的配额计数怎么同步」,这正好是评审里挑出来的那个问题引出的新问题。

</details>

**练习 3:列出所有 ADR 和状态。** 写 `part10/adr_list.py`,按编号顺序打印每条 ADR 的标题和状态。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/adr_list.py
import re

from part10.adr import ADR_DIR

def main() -> None:
    for path in sorted(ADR_DIR.glob("[0-9][0-9][0-9][0-9]-*.md")):
        text = path.read_text(encoding="utf-8")
        title = text.splitlines()[0].removeprefix("# ")
        m = re.search(r"- 状态:(.*)", text)
        status = m.group(1) if m else "(没写状态)"
        print(f"{title:<32}{status}")

if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from part10.adr import ADR_DIR` 目录常量只定义一处,两个脚本共用,改目录时不会漏改。
- `for path in sorted(ADR_DIR.glob(` `glob` 返回的顺序不保证,`sorted` 按文件名排,四位编号补零后字符串顺序就是数字顺序。这也是编号要补零的原因:不补零的话 `10-xxx` 会排在 `2-xxx` 前面。
- `title = text.splitlines()[0].removeprefix("# ")` 第一行是标题,`removeprefix` 去掉开头的 `# `(Python 3.9 起有)。
- `m = re.search(r"- 状态:(.*)", text)` 括号是捕获组,`m.group(1)` 取括号里匹配到的部分。代入 0003 号,得到「已接受(2026-10-22),取代 ADR-0001」。
- `print(f"{title:<32}{status}")` `:<32` 左对齐补空格到 32 个字符宽。中文字符在终端里占两格,所以对不齐,这里不追求。

</div>

```bash
uv run python -m part10.adr_list
```

```text
ADR-0001:模型网关采用 LiteLLM Proxy   已被 ADR-0003 取代
ADR-0002:缓存只做精确匹配               已接受(2026-10-22)
ADR-0003:租户超过 50 个改自研网关         已接受(2026-10-22),取代 ADR-0001
```

</details>

**练习 4:写你自己的设计文档。** 在 `agentops/` 仓库建 `docs/design/model-gateway.md` 和 `docs/adr/`,按今天的骨架写一份 3 到 8 页的设计文档,再从里面挑三个独立的决定写三条 ADR。要求:目标和非目标各至少 3 条;备选方案至少 2 个、同一组维度、一半以上格子有数字;Agent 专属四节齐全;开放问题至少 2 条。写完用练习 2 的检查器跑到 0 个问题。

<details><summary>参考答案</summary>

示范解法就是正文里的 `gateway-v1.md` 再展开。我自己写的时候,第一版跑练习 2 的检查器是 1 个问题(开放问题只有一条),补上「两个网关实例的配额计数怎么同步」以后变成 0 个。三条 ADR 用 `adr.py` 生成,我挑的三个决定是:

```bash
uv run python -m part10.adr new "模型网关采用 LiteLLM Proxy"
uv run python -m part10.adr new "租户配额用令牌桶,周期按天"
uv run python -m part10.adr new "成本归因在网关外用计费表补齐"
```

第二条和第三条各自一屏以内,背景写约束、决定写一句话、后果写好坏和重新评估条件。比如第二条的「需要重新评估的条件」可以写:「平台负责人对开放问题一的决定是按月时,改用月度额度加日上限两层」。这样开放问题一旦有答案,就知道去改哪条 ADR,而不是在一大份文档里找。

把这些文件从 `part10/samples/` 挪到 `agentops/` 仓库时,记得把 `adr.py` 里的 `ADR_DIR` 改成 `Path("docs/adr")`,在 `agentops/` 根目录下运行。

</details>

**练习 5:处理评审意见。** 把正文里模型给出的 8 条意见,按你自己的判断重新分类,写进 `docs/design/model-gateway-review.md`,每条写处理结论。如果有人能帮你看,再请一个真人提至少 5 条。

<details><summary>参考答案</summary>

| # | 意见要点 | 模型分类 | 我的分类 | 处理 |
| --- | --- | --- | --- | --- |
| 1 | 没说明 LiteLLM 部署在哪,无法证明数据不出境 | 事实错误 | 事实遗漏 | 已改:方案节补一句「部署在公司内网 K8s,只出站到境内供应商端点」 |
| 2 | 密钥托管和审计留存是安全基线 | 需要升级 | 需要升级 | 写「密钥轮换周期和审计保留期限待安全负责人李工决定」 |
| 3 | 紧急直连开关绕过审计,和目标冲突 | 方案分歧 | 事实错误 | 已改:旁路改成第二个网关实例,key 不出平台 |
| 4 | 评测没覆盖 prompt injection | 事实错误 | 方案分歧 | 回复:网关不处理正文,注入防护在 MCP 代理层(Day 628),安全节补一句指过去 |
| 5 | 数据不出境需要法务书面确认 | 需要升级 | 需要升级 | 和第 2 条合并,一起交给安全负责人 |
| 6 | 业务还持有 key | 事实错误 | 事实错误 | 同第 3 条 |
| 7 | 5 毫秒和 30 毫秒,压测口径没写 | 方案分歧 | 事实遗漏 | 已改:上线计划加「在 200 并发、deepseek-flash、同地域条件下压测 P95」 |
| 8 | 配额周期应该在评审前定 | 需要升级 | 需要升级 | 同意升级,但不阻塞评审;写「待平台负责人王工在评审会前决定」 |

八条里我改了三条的分类。1 和 7 模型分成了别的,但它们本质上都是「文档漏写了一个事实」,改起来最快。3 和 6 是同一个问题被两个角色各说了一遍,合并处理。这也是一个常见现象:不同评审人从不同角度戳到同一个洞,说明那个洞是真的。

</details>

**验收标准**:设计文档和三条 ADR 在 `agentops/` 仓库里;练习 2 的检查器对设计文档报 0 个问题;评审记录里每条意见都有你自己的分类和处理结论;请一个没参与的人只读文档,让他用三句话复述「做什么、为什么选 A、什么时候推翻」,复述不出来就改文档。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 设计文档(Design Doc) | 写代码之前,说明打算怎么做、考虑过什么、为什么这么选的文档 |
| RFC | Request for Comments,开源社区的提案文档,性质和设计文档一样,强调公开征求意见 |
| PRD | 产品需求文档,产品经理写,回答「解决谁的什么问题、做到什么程度算成功」 |
| 非目标 | 明确不在本期范围内的事,用来提前拒绝范围蔓延 |
| 取舍四要素 | 约束在前、同一组维度比较、承认代价、写推翻条件 |
| 推翻条件 | 出现什么情况时应该重新评估当前决定,比如「租户超过 50 个」 |
| 稻草人方案 | 为了凑数写的、明显不可能被选的备选方案 |
| 预期 / 实测 / 假设 | 文档里数字的三种标签:还没测的估计、测过的数、计算用的前提 |
| ADR 取代(supersede) | 决定变了时写一条新 ADR 取代旧的,旧的只改状态不改正文 |
| 预审 | 正式评审前私下找最可能反对的两三个人看草稿 |
| 评审意见三分类 | 事实错误/遗漏当场改,方案分歧指向备选方案,需要升级交给能拍板的人 |
| 回填 | 实现完成后,把和设计不一致的地方写回文档 |
| lint | 按规则对文本或代码做静态检查,前端的 ESLint 就是一种 |
| `SystemExit` | Python 里专门用来退出程序的异常,不打印 traceback,退出码默认 1 |

## 常见误区

**把设计文档写成实现说明书。** 通篇是类名、函数名和流程,没有一句讲为什么。读者看完知道你要怎么做,不知道你为什么不那么做。设计文档的价值在「为什么」,实现细节交给代码。

**备选方案写成稻草人。** 「方案 B:不做网关。缺点:很乱。」检验办法是问自己能不能写出「在什么情况下 B 比 A 好」,写不出来就是稻草人。

**数字不标来源。** 正文里那份草稿写「预计延迟 10 毫秒」,检查器报了出来。没压测就写「预期」并在上线计划里排压测,测过就写「实测」并附条件。评审时被问「这个数哪来的」答不上,整份文档的可信度都会掉。

**检查器写得太严,结果没人用。** 我第一版 `doc_lint.py` 没加 `NO_NUM_CHECK`,把目标里的「不超过 30 毫秒」也报成问题。练习 1 里推翻条件的「1 人周」也被误报。误报多了大家会直接无视检查结果,规则宁可少几条,也要每条报出来都是真问题。

**两步写盘,第一步成功第二步失败。** `adr.py` 第一版先写新文件再找旧文件,旧的找不到时留下了 `0004-x.md`。先把所有检查做完再写,是最便宜的修法。

**`.format()` 模板里忘了双写花括号。** 提示词里要输出字面的 `{` 时,在 `.format()` 模板里必须写成 `{{`,否则会报 `KeyError: '"comments"'` 这类看不懂的错。

**全信模型评审的分类。** 正文里 8 条意见,我改了 3 条的分类。模型能帮你找洞,但哪条该当场改、哪条该升级,取决于组织里谁有决策权,这是模型不知道的。

**评审会变成辩论赛。** 作者每个问题都要辩赢,评审人越来越不愿意提意见,评审最后流于形式。被问住了就记下来会后补,比当场赢更能建立信任。

## 学习资料

### 文档与文章

- [Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/):Malte Ubl 写的,讲 Google 设计文档的结构、长度和生命周期,今天的骨架主要参考它,30 分钟。
- [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):Michael Nygard 2011 年提出 ADR 格式的原文,10 分钟。
- [adr.github.io](https://adr.github.io/):ADR 的社区站点,汇总了几种模板和工具。
- [joelparkerhenderson/architecture-decision-record](https://github.com/joelparkerhenderson/architecture-decision-record):ADR 示例和模板大全,看几个真实例子找感觉。
- [Microsoft:Architecture decision record](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record):微软架构框架里讲 ADR 的一页,适合拿去说服团队开始用。
- [Thoughtworks 技术雷达:Lightweight ADRs](https://www.thoughtworks.com/radar/techniques/lightweight-architecture-decision-records):为什么推荐把 ADR 放进代码仓库。
- [The Pragmatic Engineer:RFCs and Design Docs](https://blog.pragmaticengineer.com/rfcs-and-design-docs/):Gergely Orosz 汇总的多家公司设计文档模板和做法,看不同公司各自强调哪几节。
- [Will Larson:Engineering strategy](https://staffeng.com/guides/engineering-strategy/):多份设计文档之上的工程策略怎么写,往 Staff 走时会用到。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1WP4y1B7ym&autoplay=0&high_quality=1" title="程序员的软技能实战-写好设计文档" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>idx_done · 程序员的软技能实战-写好设计文档 · 5 分钟,快速过一遍设计文档的常见结构,适合动笔前看。</figcaption>
</figure>

- 阿里技术_AlibabaTech《阿里工程师带你学技术文档该怎么写》和 IT老齐《架构决策记录ADR最佳实践》已经嵌在正文里。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bgHL41e7vgI" title="What Is A Design Doc In Software Engineering? (full example)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Clément Mihailescu · What Is A Design Doc In Software Engineering? (full example) · 前 Google 和 Facebook 工程师拿一份完整的设计文档逐节讲,重点看他怎么写 Alternatives。</figcaption>
</figure>

### 书籍

- Tanya Reilly,《The Staff Engineer's Path》,O'Reilly,2022。繁体中文版书名《Staff 工程師之路》。读第 5 章「Leading Big Projects」,讲怎么写设计文档、怎么让关键人尽早参与。
- Will Larson,《Staff Engineer: Leadership beyond the management track》,2021,自出版。没查到简体中文版,大部分内容在 [staffeng.com](https://staffeng.com/) 免费公开。

### 开源项目与代码

- [npryce/adr-tools](https://github.com/npryce/adr-tools):命令行管理 ADR 编号和模板,今天的 `adr.py` 就是照它的 `adr new` 和 `adr new -s` 写的最小版。
- [rust-lang/rfcs 的 0000-template.md](https://github.com/rust-lang/rfcs/blob/master/0000-template.md):很好的 RFC 模板,重点看 Drawbacks 和 Rationale and alternatives 两节。
- [kubernetes/enhancements 的 KEP](https://github.com/kubernetes/enhancements/tree/master/keps):KEP 模板里的 Production Readiness Review 一节,可以直接借鉴到 Agent 文档的上线计划。

## 自测

1. 设计文档里已经写了选型,为什么还要单独写 ADR?

<details><summary>答案</summary>

设计文档讲一整套方案,写在实现之前,定稿后很少回头看;ADR 一条只记一个决定,永久保留、只追加。半年后有人问「当初为什么选 LiteLLM」,没人会去翻八页的设计文档,翻 `docs/adr/0001` 一屏就能看到背景、决定、后果和推翻条件。决定变了就写新 ADR 取代旧的,历史不丢。

</details>

2. 有说服力的取舍有哪四个要素?下面这句缺了哪几个:「我们选 A,因为它在延迟上比 B 快 3 倍。」

<details><summary>答案</summary>

四个要素:约束在前、同一组维度比较、承认代价、写推翻条件。这句只有一个维度的比较,缺约束(为什么延迟是这里最重要的维度)、缺代价(A 在别的维度上差在哪)、缺推翻条件。还要追问一句:3 倍是预期还是实测。

</details>

3. `doc_lint.py` 为什么要跳过「目标」「非目标」「上线计划」三节的数字检查?

<details><summary>答案</summary>

这三节的数字是承诺或规则(「P95 不超过 30 毫秒」「高 0.5 个百分点就回滚」),不是对现状或效果的估计,不存在预期还是实测的问题。不跳过的话每份文档都会有一堆误报,误报多了大家就不看检查结果了。

</details>

4. `adr.py` 第一版的 bug 是什么?为什么改成「先 find 再写」就好了?

<details><summary>答案</summary>

第一版先写新 ADR 文件,再去找要取代的旧文件。旧文件不存在时 `find` 抛出 `SystemExit`,但新文件已经落盘,留下一条没有取代任何东西的半成品(实跑时是 `0004-x.md`)。改成在写任何文件之前先 `find`,找不到就直接退出,磁盘上什么都没变。

</details>

5. 评审时有人问「为什么不用消息队列把所有模型调用异步化」,你的文档里没考虑过这个方案。怎么回应?

<details><summary>答案</summary>

不当场硬辩。先确认对方想解决什么(削峰?重试?解耦?)。如果有现成的判断,比如客服场景要同步流式返回、异步化会破坏体验,简短说明;没有就直接说没考虑到,记为待办,会后补一个分析写进备选方案,说清选或不选的理由。对方说得对,就改方案。这条属于「方案分歧」。

</details>

6. 资深面试题:讲一次你推动过的跨团队技术决策。你怎么写文档、怎么让大家对齐、遇到反对怎么处理?

<details><summary>答案</summary>

用 STAR(情境、任务、行动、结果)讲一个真实案例,突出这几件事:写了设计文档,列出了认真考虑过的备选方案和取舍,而不是只有结论;正式评审前做了预审,把最可能反对的人提前拉进来;对反对意见分类处理,事实错误当场改、方案分歧补进备选方案、超出决策权的升级给能拍板的人;决定后用 ADR 记下来并写了推翻条件;上线后用数据(评测分数、成本、事故率)证明决定对了,或者承认哪里错了、怎么改的。面试官想听的是你能在没有直接权力的情况下,让一群人往同一个方向走。没有真实的跨团队经历,就拿 AgentOps 的网关选型讲,讲清楚约束、取舍和你预设的推翻条件。

</details>

## 明天预告

明天是 Day 641 · AI 立项:该不该用 AI,自己做还是买,回本测算。今天的设计文档回答「怎么做」,但它前面还有一个更容易被跳过的问题:这件事值不值得做。老板问「客服能不能上个 Agent」时,你得在一页纸里回答三件事:适不适合用 AI、自己做还是买、多久回本。明天我们用 Python 把回本算一遍,再找出「买比自建便宜」的那个工单量交叉点。
