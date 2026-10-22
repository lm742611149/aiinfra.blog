---
title: 'Day 579 · 强化学习(一):模仿和试错,RLVR 和 GRPO'
description: 'SFT、DPO、蒸馏都是在模仿,上限是示范。强化学习换了一种信号:不给示范,只告诉模型结果对不对。今天先写一个严格的分诊判分函数,这就是可验证奖励;再手算 GRPO 的组内优势,用 DeepSeek 给 16 张工单各采样 4 个回答看真实的奖励分布,撞上一次 n 只能等于 1 的报错;最后用 numpy 写一个 40 行的 GRPO,看它怎么在没有标准答案示范的情况下学会,又为什么对「一次都没答对过」的题毫无办法。'
pubDate: 2026-10-22
regime: none
tags: ['reinforcement-learning', 'rlvr', 'grpo', 'python', 'agent-zero']
series: 'agent-zero'
day: 579
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 578](/blog/agent-zero/day-578-distill-2/) 我们从小模型输出的 logprob 里算出了分诊的置信度,在 50 张 dev 工单上扫了一遍阈值,看到「置信度够就用小模型、不够就回退大模型」的取舍曲线,也看到 0.5B 的小模型并不总是「知道自己不知道」:有的错误它很自信。那一课和前面的 SFT、DPO、蒸馏一样,小模型学的东西全都来自别人给的示范:标准答案、好回答、老师的标签。

[Day 577](/blog/agent-zero/day-577-distill-1/) 还留下一个结论:序列级蒸馏的天花板就是老师,老师的系统性错误会被学生原样学走。想让模型超过示范,得换一种学习信号。今天讲的强化学习就是这种信号:不告诉模型「应该怎么写」,只告诉它「这次写得对不对」。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清模仿(SFT、DPO、蒸馏)和试错(强化学习)的学习信号有什么不同,为什么只有后者有机会超过示范,代价又是什么。
2. 知道 RLVR(可验证奖励)是什么,写出一个严格的分诊判分函数 `verifier.py`,能说出哪些任务适合用程序判分。
3. 手算 GRPO 的组内优势,理解它为什么不需要价值模型,读懂 `frac_reward_zero_std` 这个指标,并用一个 numpy 小程序看 GRPO 怎么一步步把答对的概率推高。

预计用时 2.5 小时。前置:[Day 110](/blog/agent-zero/day-110-sampling-1/)(概率分布、softmax、temperature)、[Day 214](/blog/agent-zero/day-214-numpy-basics/)(numpy 数组)、[Day 353](/blog/agent-zero/day-353-stats-intuition/)(平均数和标准差)、[Day 575](/blog/agent-zero/day-575-dpo-1/)(RLHF 三步、PPO、价值模型)、[Day 577](/blog/agent-zero/day-577-distill-1/)(系统性错误)、[Day 578](/blog/agent-zero/day-578-distill-2/)(`confidence.py` 里的 `KEYS`、`route_dev.jsonl`)。

今天的代码全在本机跑,不需要 GPU。调 DeepSeek 的只有采样那一步,两轮一共 128 次调用,按全部没命中缓存算的上限约 0.05 元,算式在验收标准里。真正用 TRL 训练一个模型是 [Day 581](/blog/agent-zero/day-581-rl-2/) 的事,今天先把原理和数字吃透。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`verifier.py` 的 `triage_reward` 和 `grpo_toy.py` 的 `train`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 模仿和试错

先把前几天学过的方法排一排,看它们的学习信号从哪来:

| 方法 | 在哪天学的 | 模型看到的信号 |
| --- | --- | --- |
| SFT | [Day 570](/blog/agent-zero/day-570-finetune-1/)、[Day 572](/blog/agent-zero/day-572-finetune-2/) | 标准答案,一个字一个字照着写 |
| DPO | [Day 575](/blog/agent-zero/day-575-dpo-1/)、[Day 576](/blog/agent-zero/day-576-dpo-2/) | 一对回答里哪份更好 |
| 序列级蒸馏 | [Day 577](/blog/agent-zero/day-577-distill-1/) | 老师写出来的答案 |
| 强化学习 | 今天 | 自己写一份,拿到一个分数 |

前三行有一个共同点:信号来自「正确的样子长什么样」。SFT 照抄答案,DPO 学「这份比那份好」,蒸馏学老师。所以它们的上限是示范本身的质量。Day 577 里老师把「被重复扣款了」的 `needs_human` 一致地标成 false,学生照着学,就一致地错。

**强化学习**(reinforcement learning,RL)换了一种信号。它不给示范,只给结果的好坏:模型自己写一个回答,一个打分程序告诉它这次几分,分高的写法以后多写,分低的少写。打个前端的比方:SFT 像给新同事一份写好的代码让他照着敲;强化学习像只给他一套测试,让他自己写、自己跑测试,红了改、绿了留。

这带来两个模仿给不了的东西。

第一,它能找到示范里没有的做法。DeepSeek 在 R1 的论文里报告:只用「最终答案对不对」加上「格式对不对」两种程序判定的奖励去训练,模型在训练中自己学会了写更长的推理、回头检查、换思路重来,他们把其中一个时刻叫作「aha moment」。这些行为没人示范过。论文里 R1-Zero 在 AIME 2024 上的 pass@1 从 15.6% 涨到了 71.0%(这是他们报告的数字,我没有复现)。

第二,它在自己的分布上学。SFT 的时候模型看到的全是别人写的完美答案,从来没见过「自己写错了一步之后」是什么局面。强化学习里每一份回答都是模型自己写的,包括写歪了的那些,它学到的是「从我自己会犯的错里怎么走回来」。这对多步的 Agent 特别重要,Agent 一步错,后面每一步都在错的基础上走。

代价也很明显。一份回答写完只拿到一个分数,模型不知道是哪个字写对了、哪个字写错了,这叫**稀疏奖励**。信号这么少,就得靠大量尝试来凑:同一道题写很多遍,看哪些写法得分高。所以强化学习比 SFT 贵得多,采样本身就是一大笔算力。Day 577 提到的在线策略蒸馏,就是想保留「在自己的分布上学」,同时让老师给每个 token 打分,把信号变密。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="模仿和试错的学习信号对比">
<rect x="20" y="20" width="290" height="190" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="165" y="44" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">模仿:SFT / DPO / 蒸馏</text>
<rect x="40" y="62" width="110" height="40" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="95" y="87" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">示范答案</text>
<line x1="150" y1="82" x2="180" y2="82" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="180" y="62" width="110" height="40" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="235" y="87" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">模型照着学</text>
<text x="165" y="135" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">每个 token 都有对照,信号密</text>
<text x="165" y="155" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">上限 = 示范的水平</text>
<text x="165" y="175" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">没见过自己犯错后的局面</text>
<rect x="330" y="20" width="290" height="190" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="475" y="44" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">试错:强化学习</text>
<rect x="350" y="62" width="110" height="40" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="405" y="87" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">模型自己写</text>
<line x1="460" y1="82" x2="490" y2="82" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="490" y="62" width="110" height="40" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="545" y="87" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">程序打一个分</text>
<path d="M 545 102 C 545 120, 405 120, 405 104" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="475" y="135" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">整份回答只有一个分数,信号稀疏</text>
<text x="475" y="155" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">能找到示范里没有的做法</text>
<text x="475" y="175" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">要大量采样,贵</text>
</svg>
<figcaption>左边的信号来自「正确的样子」,右边的信号来自「结果的好坏」。虚线表示分数反过来改变模型下一次怎么写。</figcaption>
</figure>

说一句实话:对分诊这种「一张工单一个标准答案」的任务,如果你手上已经有可靠的标签,直接 SFT 通常就够了,强化学习不一定带来更多。强化学习真正占优的,是那种**结果能检查、过程没人示范得出来**的任务:数学题有答案但解法千变万化;Agent 要调三四个工具才能算出退款金额,你能核对最后的金额,却写不出「每一步该调哪个工具」的标准轨迹。今天用分诊做例子,是因为它的判分最容易写,原理是一样的。

## RLVR:能用程序判对错的奖励

强化学习最难的部分是分数从哪来。[Day 575](/blog/agent-zero/day-575-dpo-1/) 讲过 RLHF 的做法:先训练一个**奖励模型**给回答打分。奖励模型本身是学出来的,它会有漏洞,训练久了模型会学会钻漏洞,拿高分却没变好。

**RLVR**(Reinforcement Learning with Verifiable Rewards,可验证奖励的强化学习)这个叫法出自 AI2 在 2024 年 11 月发布的 Tulu 3 论文。想法很朴素:只在能用程序判断对错的任务上训练。数学题对答案,代码跑单元测试,SQL 在数据库里执行看结果,JSON 用解析器检查。程序不会被花言巧语讨好,钻空子的余地小得多。DeepSeek-R1 也是这么做的,论文里明说没用神经网络的奖励模型,用的是规则判定的准确率奖励和格式奖励。

这件事和你学过的东西关系很近。[Day 343](/blog/agent-zero/day-343-eval-pyramid/) 评测金字塔最底下那一层是规则检查,[Day 350](/blog/agent-zero/day-350-judge-code/) 写过判题器。那些检查原封不动就是可验证奖励。会写评测的人,就会写 RLVR 的奖励函数,这也是为什么做过评测的工程师在 Agent 训练相关的岗位上很吃香。

### 写一个分诊判分函数

分诊的输出是一个四字段的 JSON,标准答案有现成的(Day 578 的 `route_dev.jsonl` 每条都带 `expected`)。判分规则定成这样:整段输出必须**正好**是一个 JSON 对象,四个字段一个不多一个不少,不满足直接 0 分;满足的话每对一个字段得 0.25 分。

为什么这么严?因为强化学习里模型会利用你判分规则里的每一点宽松。如果你的解析器会「贴心地」从一段话里把 JSON 抠出来,模型很快就会学会在 JSON 后面附一段客套话,两边都不耽误。奖励怎么设计、怎么防钻空子是 Day 581 的主题,今天先记住一条:判分要严。

新建 `part10/verifier.py`:

````python
# agent-zero-lab/part10/verifier.py
"""分诊的可验证奖励:程序判对错,不用模型打分。
严格:整段输出必须正好是一个 JSON 对象,四个字段一个不多一个不少,否则 0 分。
"""
import json

from confidence import KEYS


def triage_reward(output: str, expected: dict) -> float:
    try:
        ans = json.loads(output)
    except json.JSONDecodeError:
        return 0.0
    if not isinstance(ans, dict) or set(ans) != set(KEYS):
        return 0.0
    return sum(ans[k] == expected[k] for k in KEYS) / len(KEYS)


if __name__ == "__main__":
    gold = {"category": "billing", "needs_account_data": True, "needs_human": True, "urgency": "high"}
    tests = [
        '{"category": "billing", "needs_account_data": true, "needs_human": true, "urgency": "high"}',
        '{"category": "billing", "needs_account_data": true, "needs_human": false, "urgency": "normal"}',
        '{"category": "billing", "needs_account_data": true, "needs_human": true, "urgency": "high"} 已为您核实',
        '```json\n{"category": "billing"}\n```',
        '{"category": "billing", "needs_account_data": true, "needs_human": true, "urgency": "high", "note": "ok"}',
    ]
    for t in tests:
        print(f"{triage_reward(t, gold):.2f}  ...{t[-45:]!r}")
````

<div class="line-notes">

- `from confidence import KEYS` Day 578 的 `confidence.py` 里定义了四个字段名 `("category", "needs_account_data", "needs_human", "urgency")`,这里直接复用,保证判分和置信度用的是同一组字段。
- `ans = json.loads(output)` 不做任何预处理,不去掉代码块标记,不找第一个 `{`。输出不是纯 JSON 就让它在这一行抛错。
- `except json.JSONDecodeError:` 解析失败直接 0 分。
- `if not isinstance(ans, dict) or set(ans) != set(KEYS):` 两道关:解析出来得是对象(`json.loads("[1]")` 会得到列表),而且字段集合必须和 `KEYS` 完全相同。`set(ans)` 取的是字典的键,相当于 JS 的 `new Set(Object.keys(ans))`;两个集合用 `!=` 比的是内容。
- `return sum(ans[k] == expected[k] for k in KEYS) / len(KEYS)` 每个字段比一次,`True` 当 1、`False` 当 0 加起来,再除以 4。四个全对得 1.0,对三个得 0.75。
- `print(f"{triage_reward(t, gold):.2f}  ...{t[-45:]!r}")` 只打印每个输出的最后 45 个字符,差别都在结尾。`!r` 让换行符显示成 `\n`。

</div>

```bash
cd agent-zero-lab
uv run python part10/verifier.py
```

实跑输出:

````text
1.00  ...'true, "needs_human": true, "urgency": "high"}'
0.50  ...'e, "needs_human": false, "urgency": "normal"}'
0.00  ...'"needs_human": true, "urgency": "high"} 已为您核实'
0.00  ...'```json\n{"category": "billing"}\n```'
0.00  ...'uman": true, "urgency": "high", "note": "ok"}'
````

第三条四个字段其实全对,只是后面多了「已为您核实」五个字,照样 0 分。第五条多了一个 `note` 字段,也是 0 分。你可能觉得这太狠了,线上 Day 578 的 `parse_triage` 不是会剥掉代码块标记吗?那是**用**模型输出的时候宽容,能救一条是一条;**训练**模型的时候不能宽容,你宽容什么,模型就学会什么。

### 哪些任务能用 RLVR

一个任务能不能做 RLVR,就看一个问题:**能不能写一个程序,不用人、不用模型,就判出这份输出好不好**。

| 任务 | 能程序判分吗 | 怎么判 |
| --- | --- | --- |
| 分诊四个字段 | 能 | 对标准答案,今天的 `triage_reward` |
| 回复里写的退款金额 | 能 | 按规则算出应退金额,和回复里的数字比(练习 4) |
| 按需求改代码 | 能 | 在沙箱里跑原始测试 |
| Text-to-SQL | 能 | 执行 SQL,比结果集 |
| 回复语气是否得体 | 不能 | 只能人评或 LLM judge,这就回到了奖励模型的老问题 |

最后一行的任务也能做强化学习,只是奖励要靠 judge 或奖励模型,那就不叫 RLVR 了,而且要花大力气防钻空子。

## GRPO:组内比一比,省掉价值模型

有了打分程序,下一步是怎么用分数改模型。最朴素的想法是「分高就多写,分低就少写」。问题是「高」和「低」是相对谁说的?一道简单题人人都拿 0.75,0.75 就不算好;一道难题大家都只拿 0.25,拿到 0.5 就很了不起。所以要有一个**基准**:这道题「平均能拿多少分」。实际得分减去基准叫**优势**(advantage),优势为正说明这次比平均好,该多写;为负就少写。

[Day 575](/blog/agent-zero/day-575-dpo-1/) 讲过的 PPO 用一个**价值模型**来估这个基准,价值模型通常和被训练的模型差不多大,要单独训练,显存翻一倍,还容易不稳定。

**GRPO**(Group Relative Policy Optimization,组相对策略优化)出自 DeepSeek 在 2024 年 2 月发的 DeepSeekMath 论文,后来因为 R1 出了名。它的想法是:不用模型去**估**平均分,直接现场**测**。同一道题让模型写一组(比如 4 份)回答,每份都用打分程序判一次,这一组的平均分就是基准:

```text
同一张工单采样 G 个回答,得分 r1 ... rG
优势 Ai = (ri - 平均(r)) / 标准差(r)
优势为正的回答:提高它的概率;为负的:降低它的概率
```

除以标准差是为了把不同题目的优势拉到差不多的尺度上。先用一个纯 Python 小脚本手算几组,新建 `part10/grpo_by_hand.py`:

```python
# agent-zero-lab/part10/grpo_by_hand.py
"""手算 GRPO 的组内优势:同一张工单的 4 个回答,得分减去组内平均,再除以组内标准差。"""
import statistics

GROUPS = {
    "有高有低": [1.0, 0.5, 1.0, 0.0],
    "只差一个": [1.0, 1.0, 1.0, 0.75],
    "全对":     [1.0, 1.0, 1.0, 1.0],
    "全错":     [0.0, 0.0, 0.0, 0.0],
}
for name, r in GROUPS.items():
    mean = statistics.mean(r)
    std = statistics.pstdev(r)
    adv = [(x - mean) / (std + 1e-4) for x in r]
    print(f"{name:<6} 得分 {r}  平均 {mean:.3f}  标准差 {std:.3f}  优势 {[round(a, 2) for a in adv]}")
```

<div class="line-notes">

- `import statistics` 标准库里的统计模块,[Day 353](/blog/agent-zero/day-353-stats-intuition/) 用过它算平均数和标准差。
- `"有高有低": [1.0, 0.5, 1.0, 0.0],` 四个回答分别对了 4、2、4、0 个字段,用的就是上面 `triage_reward` 的打分方式。
- `std = statistics.pstdev(r)` `pstdev` 是总体标准差(除以 n),`stdev` 是样本标准差(除以 n−1)。我读了 TRL 的源码,它的 `nanstd` 用的是除以 n−1 的那种,G=4 时标准差会大 15% 左右(√(4/3) ≈ 1.155),优势相应小一点,正负和排序不变。这里用 `pstdev`,和下面 numpy 的 `.std()` 默认一致。第一组算出来是 0.415。
- `adv = [(x - mean) / (std + 1e-4) for x in r]` 优势公式。分母加 `1e-4` 防止标准差为 0 时除以 0,TRL 源码里加的正好也是 `1e-4`。第一组第一个:(1.0 − 0.625) ÷ 0.4151 ≈ 0.90。
- `print(f"{name:<6} 得分` `round(a, 2)` 只为打印好看,保留两位。

</div>

```bash
uv run python part10/grpo_by_hand.py
```

```text
有高有低   得分 [1.0, 0.5, 1.0, 0.0]  平均 0.625  标准差 0.415  优势 [0.9, -0.3, 0.9, -1.51]
只差一个   得分 [1.0, 1.0, 1.0, 0.75]  平均 0.938  标准差 0.108  优势 [0.58, 0.58, 0.58, -1.73]
全对     得分 [1.0, 1.0, 1.0, 1.0]  平均 1.000  标准差 0.000  优势 [0.0, 0.0, 0.0, 0.0]
全错     得分 [0.0, 0.0, 0.0, 0.0]  平均 0.000  标准差 0.000  优势 [0.0, 0.0, 0.0, 0.0]
```

四组各说明一件事。

「有高有低」:得 0.5 的那份虽然不是最差,也比平均低,优势 −0.3,概率会被压低一点。GRPO 只看组内相对位置,不看绝对分数。

「只差一个」:那份 0.75 只比别人少对一个字段,优势却是 −1.73,比上一组得 0 分的那份(−1.51)还狠。因为这一组的标准差很小(0.108),除完以后差别被放大了。这是除以标准差的副作用:组里大家差不多时,一点点差别也会被当成天大的差别。2025 年的论文《Understanding R1-Zero-Like Training》(提出 Dr. GRPO)专门讨论了这种偏差,建议去掉除以标准差这一步。练习 2 会把两种算法放在真实数据上比一比。

「全对」和「全错」:标准差是 0,优势全是 0。这一组四份回答,对训练**一点贡献都没有**,白采样了。题太简单(模型每次都对)或太难(每次都错)都会这样。TRL 把每批里这种组的比例记成 **`frac_reward_zero_std`**,文档的原话是「生成的这一批里奖励标准差为零的样本比例,说明这道题的回答没有多样性(全对或全错)」。这个数高,训练就在空转。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="GRPO:同一张工单采样一组回答,按组内平均算优势">
<rect x="20" y="100" width="110" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="75" y="120" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">一张工单</text>
<text x="75" y="136" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">prompt</text>
<g stroke="var(--rule)" stroke-width="1.5">
<line x1="130" y1="122" x2="180" y2="42"/><line x1="130" y1="122" x2="180" y2="96"/><line x1="130" y1="122" x2="180" y2="150"/><line x1="130" y1="122" x2="180" y2="204"/>
</g>
<g font-family="var(--font-mono)" font-size="11">
<rect x="180" y="25" width="170" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="190" y="47" fill="var(--ink)">回答 1:四个全对</text>
<rect x="180" y="79" width="170" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="190" y="101" fill="var(--ink)">回答 2:对两个</text>
<rect x="180" y="133" width="170" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="190" y="155" fill="var(--ink)">回答 3:四个全对</text>
<rect x="180" y="187" width="170" height="34" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="190" y="209" fill="var(--ink)">回答 4:后面多了字</text>
<rect x="370" y="25" width="80" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="410" y="47" fill="var(--ink)" text-anchor="middle">1.0</text>
<rect x="370" y="79" width="80" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="410" y="101" fill="var(--ink)" text-anchor="middle">0.5</text>
<rect x="370" y="133" width="80" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="410" y="155" fill="var(--ink)" text-anchor="middle">1.0</text>
<rect x="370" y="187" width="80" height="34" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="410" y="209" fill="var(--ink)" text-anchor="middle">0.0</text>
<text x="470" y="47" fill="var(--ink)">+0.90 多写</text>
<text x="470" y="101" fill="var(--ink-soft)">-0.30 少写</text>
<text x="470" y="155" fill="var(--ink)">+0.90 多写</text>
<text x="470" y="209" fill="var(--ink-soft)">-1.51 少写</text>
</g>
<text x="410" y="242" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">琥珀色是 verifier 打的分,组内平均 0.625 就是基准</text>
</svg>
<figcaption>数字来自 `grpo_by_hand.py` 的第一组。PPO 要一个价值模型来估「这题平均能拿几分」,GRPO 直接用这一组的平均分。</figcaption>
</figure>

GRPO 后来又被改了好几轮。DAPO 论文针对长推理训练改了裁剪范围和损失的平均方式,Dr. GRPO 去掉了长度归一化和标准差归一化。你不用记细节,但读 TRL 文档时要认得出来:我 2026 年 10 月 22 日查 TRL 的 GRPO 文档(当前版本 1.16.0,10 月 15 日发布),`GRPOConfig` 的 `loss_type` 默认是 `"dapo"`,KL 系数 `beta` 默认是 0.0(文档原话:默认不使用 KL 项),每道题采样数 `num_generations` 默认 8,`scale_rewards` 默认 `"group"`(就是按组除以标准差;源码里设成 `"none"` 就是 Dr. GRPO 那种不除,文档的提示里写的是 `False`)。

### 用 DeepSeek 采样一组看看

光看手编的数字不够,看看真实模型的一组回答分数长什么样。这一步就是 GRPO 训练里每一步的前半段:对每道题采样一组,打分,算优势。只是今天不更新模型(DeepSeek 的权重我们也改不了),只看数字。

新建 `part10/sample_groups.py`。第一版我想当然地用了 OpenAI 接口的 `n` 参数,一次请求要 4 个回答:

```python
# agent-zero-lab/part10/sample_groups.py(第一版,会报错)
def sample(case: dict) -> list[str]:
    resp = client.chat.completions.create(
        model="deepseek-flash", temperature=1.0, max_tokens=100, n=G, extra_body=EXTRA,
        messages=[{"role": "system", "content": SYSTEM},
                  {"role": "user", "content": f"主题:{case['subject']}\n正文:{case['body']}"}])
    return [c.message.content or "" for c in resp.choices]
```

<div class="line-notes">

- `model="deepseek-flash", temperature=1.0, max_tokens=100, n=G, extra_body=EXTRA,` `n=G` 是 OpenAI 接口的参数,意思是「对同一个请求给我 G 个独立的回答」,返回的 `choices` 列表会有 G 项。
- `return [c.message.content or "" for c in resp.choices]` 把每个回答的文字取出来。

</div>

跑起来,DeepSeek 直接拒绝:

```text
openai.BadRequestError: Error code: 400 - {'error': {'message': 'Invalid n value (currently only n = 1 is supported) (request_id: 60d9dd0e-9ad1-41d6-87b1-fdd8a5e4a52c)', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

「OpenAI 兼容」不等于每个参数都兼容。DeepSeek 目前只支持 `n = 1`,要 4 个回答就发 4 次请求。vLLM 是支持 `n` 的,而且 TRL 的 GRPO 用 vLLM 采样时就是靠这个一次拿一组,省掉重复算 prompt。改成一次一个,完整的脚本:

```python
# agent-zero-lab/part10/sample_groups.py
"""GRPO 的第一步:同一张工单采样一组(G 个)回答,用 verifier 打分,算组内优势,统计「组内全同」的比例。
用法:uv run python part10/sample_groups.py part10/data/route_dev.jsonl 16
"""
import json
import os
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from build_sft_data import SYSTEM
from verifier import triage_reward

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
G = 4
usage = {"in": 0, "out": 0}


def sample_one(case: dict) -> str:
    resp = client.chat.completions.create(
        model="deepseek-flash", temperature=1.0, max_tokens=100, extra_body=EXTRA,
        messages=[{"role": "system", "content": SYSTEM},
                  {"role": "user", "content": f"主题:{case['subject']}\n正文:{case['body']}"}])
    if resp.usage:
        usage["in"] += resp.usage.prompt_tokens
        usage["out"] += resp.usage.completion_tokens
    return resp.choices[0].message.content or ""


def sample(case: dict) -> list[str]:
    return [sample_one(case) for _ in range(G)]


def advantages(rewards: list[float]) -> list[float]:
    mean, std = statistics.mean(rewards), statistics.pstdev(rewards)
    return [(r - mean) / (std + 1e-4) for r in rewards]


if __name__ == "__main__":
    cases = [json.loads(x) for x in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() if x.strip()]
    cases = cases[: int(sys.argv[2])]
    with ThreadPoolExecutor(max_workers=8) as pool:
        groups = list(pool.map(sample, cases))
    zero = 0
    saved = []
    for case, outs in zip(cases, groups):
        rewards = [triage_reward(o, case["expected"]) for o in outs]
        adv = advantages(rewards)
        zero += statistics.pstdev(rewards) == 0
        saved.append({"id": case["id"], "subject": case["subject"], "outputs": outs, "rewards": rewards})
        print(f"{case['id']} {case['subject']:<10} 奖励 {rewards}  优势 {[round(a, 2) for a in adv]}")
    print(f"frac_reward_zero_std = {zero}/{len(cases)} = {zero / len(cases):.2f}")
    print(f"输入 {usage['in']} 输出 {usage['out']} token")
    out = Path(sys.argv[1]).parent / "groups.jsonl"
    out.write_text("".join(json.dumps(g, ensure_ascii=False) + "\n" for g in saved), encoding="utf-8")
```

<div class="line-notes">

- `from build_sft_data import SYSTEM` Day 570 那段分诊 system,只写了字段和取值,没有 Day 577 的口径说明。这里故意不给口径,让模型有拿不准的地方,组内分数才会有高有低。
- `from verifier import triage_reward` 刚写的严格判分函数。
- `G = 4` 每张工单采样 4 个。TRL 默认是 8,今天为了省钱用 4。
- `model="deepseek-flash", temperature=1.0, max_tokens=100, extra_body=EXTRA,` 温度 1.0,按模型原始的概率分布采样([Day 110](/blog/agent-zero/day-110-sampling-1/) 讲过)。强化学习采样要的就是模型「本来会怎么写」,温度太低一组 4 份全一样,优势全是 0。没有开 JSON mode,因为格式对不对本身也是要考的。
- `if resp.usage:` 记 token 数算钱。多个线程会同时加,和 Day 577 一样,这个量级下不精确计费可以接受。
- `return [sample_one(case) for _ in range(G)]` 同一张工单串行发 4 次。外面的线程池让 8 张工单同时进行。
- `def advantages(rewards: list[float]) -> list[float]:` 和 `grpo_by_hand.py` 里是同一个公式,包成函数。
- `cases = cases[: int(sys.argv[2])]` 只取前 16 张,`[:16]` 是切片,相当于 JS 的 `slice(0, 16)`。
- `zero += statistics.pstdev(rewards) == 0` 比较的结果是布尔值,加到整数上 `True` 算 1。数的就是「组内全同」的题有几道。
- `out.write_text("".join(json.dumps(g, ensure_ascii=False) + "\n" for g in saved), encoding="utf-8")` 把每组的回答和分数存成 `part10/data/groups.jsonl`,练习 2 要用。

</div>

```bash
uv run python part10/sample_groups.py part10/data/route_dev.jsonl 16
```

实跑输出(2026-10-22,`deepseek-flash`,关闭思考):

```text
D001 页面打不开      奖励 [0.75, 0.5, 0.5, 0.5]  优势 [1.73, -0.58, -0.58, -0.58]
D002 退款多久到账     奖励 [0.75, 0.75, 0.75, 0.75]  优势 [0.0, 0.0, 0.0, 0.0]
D003 发票抬头写错了    奖励 [0.75, 0.75, 1.0, 0.75]  优势 [-0.58, -0.58, 1.73, -0.58]
D004 账单金额看不懂    奖励 [0.75, 0.75, 0.75, 0.75]  优势 [0.0, 0.0, 0.0, 0.0]
D005 同步银行流水失败   奖励 [0.75, 0.75, 1.0, 1.0]  优势 [-1.0, -1.0, 1.0, 1.0]
D006 这个月扣费不对    奖励 [0.75, 0.5, 1.0, 1.0]  优势 [-0.3, -1.51, 0.9, 0.9]
D007 账单金额看不懂    奖励 [0.75, 0.75, 0.5, 0.75]  优势 [0.58, 0.58, -1.73, 0.58]
D008 同步银行流水失败   奖励 [0.75, 0.75, 0.75, 1.0]  优势 [-0.58, -0.58, -0.58, 1.73]
D009 账单金额看不懂    奖励 [0.75, 0.75, 0.75, 0.75]  优势 [0.0, 0.0, 0.0, 0.0]
D010 这个月扣费不对    奖励 [1.0, 1.0, 1.0, 0.75]  优势 [0.58, 0.58, 0.58, -1.73]
D011 合作咨询       奖励 [0.5, 0.5, 0.75, 0.5]  优势 [-0.58, -0.58, 1.73, -0.58]
D012 页面打不开      奖励 [0.5, 0.5, 0.75, 0.5]  优势 [-0.58, -0.58, 1.73, -0.58]
D013 这个月扣费不对    奖励 [0.75, 1.0, 0.75, 1.0]  优势 [-1.0, 1.0, -1.0, 1.0]
D014 登录不了       奖励 [0.75, 1.0, 1.0, 1.0]  优势 [-1.73, 0.58, 0.58, 0.58]
D015 这个月扣费不对    奖励 [0.75, 1.0, 0.75, 1.0]  优势 [-1.0, 1.0, -1.0, 1.0]
D016 导出报表一直转圈   奖励 [0.75, 0.75, 0.5, 0.25]  优势 [0.9, 0.9, -0.3, -1.51]
frac_reward_zero_std = 3/16 = 0.19
输入 7360 输出 1504 token
```

几件值得看的事。

64 个回答里一个 0 分都没有。没有开 JSON mode,DeepSeek 照样每次都只输出了一个干净的 JSON。格式这一关对大模型太简单了;换成一个没训过的 0.5B 小模型,格式错会是最常见的 0 分来源,这就是为什么很多 GRPO 配方会单独加一个格式奖励,Day 581 再讲。

D002、D004、D009 三张,四份回答分数一模一样,优势全是 0。`frac_reward_zero_std` 是 0.19,也就是这一批里将近五分之一的采样是白花的钱。注意它们全是 0.75:模型每次都**稳定地错同一个字段**。这和 Day 577 的系统性错误是同一回事,只不过这次是从训练的角度看:模型对这道题很确定,组内没有差别,GRPO 就没有信号去纠正它。

还有一个事实要说:我前一次跑同样的命令,得到的是 `frac_reward_zero_std = 6/16 = 0.38`。温度 1.0 采样有随机性,G 只有 4 时,一组四份恰好一样的概率不小。G 越大,组内出现差别的机会越多,这也是 TRL 默认采 8 个的原因之一,代价是每一步的采样钱翻倍。

钱:两轮各 64 次调用,输入 7,360、输出约 1,500 token。按 flash 未命中价算上限:每轮 (7360 × 2 + 1504 × 8) ÷ 100 万 ≈ 0.027 元,两轮约 0.05 元。

## 一个 40 行的 GRPO

现在把后半段补上:拿到优势以后,怎么改模型?真模型有几亿个参数,太大看不清。我们把「模型」缩成一张分数表:4 张工单,每张对 3 个 urgency 选项各有一个分数(就是 logit),过 softmax 变成概率,按概率采样一个答案。训练就是改这张表里的数。

改法是这样的:一个选项的优势为正,就把它的分数往上推,推多少和优势成正比;为负就往下压。数学上,「让选项 i 的 log 概率变大」的方向,对 3 个分数分别是 `onehot(i) − p`(选中的那个 +1 再减它现在的概率,其他的减各自的概率)。乘上优势、加起来、乘学习率,就是一步更新。这就是策略梯度,GRPO 在它外面套了「组内比较」的基准。

新建 `part10/grpo_toy.py`:

```python
# agent-zero-lab/part10/grpo_toy.py
"""最小的 GRPO:「模型」只是 4 张工单 × 3 个 urgency 选项的一张分数表。每一步对每张工单采样一组答案,
程序判对错给奖励,组内比较算优势,按优势改分数。没有示范答案,也没有价值模型。
用法:uv run python part10/grpo_toy.py [每组几个,默认 4]
"""
import sys

import numpy as np

OPTIONS = ["low", "normal", "high"]
TICKETS = {                # 工单: (正确答案, 训练前三个选项的分数)
    "被重复扣款了":     ("high",   [0.0, 1.5, 0.5]),
    "退款多久到账":     ("low",    [0.5, 1.0, 0.0]),
    "导出报表一直转圈": ("normal", [0.0, 0.2, 1.8]),
    "合作咨询":         ("low",    [-6.0, 3.0, 0.0]),
}
LR = 0.5


def softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max())
    return e / e.sum()


def reward(ticket: str, answer: str) -> float:
    return 1.0 if answer == TICKETS[ticket][0] else 0.0


def train(g: int, steps: int = 30, seed: int = 0) -> None:
    rng = np.random.default_rng(seed)
    logits = {t: np.array(init, dtype=float) for t, (_, init) in TICKETS.items()}
    for step in range(1, steps + 1):
        zero_std = 0
        for t in TICKETS:
            p = softmax(logits[t])
            picks = rng.choice(3, size=g, p=p)
            r = np.array([reward(t, OPTIONS[i]) for i in picks])
            if r.std() == 0:
                zero_std += 1
                continue
            adv = (r - r.mean()) / (r.std() + 1e-4)
            grad = np.zeros(3)
            for i, a in zip(picks, adv):
                grad += a * (np.eye(3)[i] - p)
            logits[t] += LR * grad / g
        if step in (1, 5, 10, 20, 30):
            probs = "  ".join(f"{t}:{softmax(logits[t])[OPTIONS.index(TICKETS[t][0])]:.2f}" for t in TICKETS)
            print(f"第 {step:>2} 步  答对的概率 {probs}  组内全同 {zero_std}/{len(TICKETS)}")


if __name__ == "__main__":
    first = {t: softmax(np.array(init))[OPTIONS.index(ans)] for t, (ans, init) in TICKETS.items()}
    print("训练前  答对的概率 " + "  ".join(f"{t}:{p:.2f}" for t, p in first.items()))
    train(int(sys.argv[1]) if len(sys.argv) > 1 else 4)
```

<div class="line-notes">

- `"被重复扣款了":     ("high",   [0.0, 1.5, 0.5]),` 正确答案是 high,但训练前 normal 的分数最高。这模拟 Day 577 那种「模型一开始倾向于答错」的局面。注意整张表里**没有任何一条示范**,正确答案只在 `reward` 里用来判分。
- `"合作咨询":         ("low",    [-6.0, 3.0, 0.0]),` 正确答案 low 的分数是 −6,过 softmax 以后概率约万分之一。这张是专门留着看「模型从来答不对的题」会怎样。
- `LR = 0.5` 学习率,每一步沿着优势方向挪多远。玩具问题用大一点的值,几十步就能看出效果。
- `e = np.exp(x - x.max())` softmax 先减最大值再取 exp,结果不变但不会溢出。[Day 110](/blog/agent-zero/day-110-sampling-1/) 讲过 softmax,这里是 numpy 写法,`np.exp` 对数组里每个数取 exp。
- `return 1.0 if answer == TICKETS[ticket][0] else 0.0` 可验证奖励:答案对上就 1 分,否则 0 分。
- `rng = np.random.default_rng(seed)` 固定种子的随机数生成器,每次运行结果一样,方便你对照文章的输出。
- `logits = {t: np.array(init, dtype=float) for t, (_, init) in TICKETS.items()}` 每次 `train` 都从表里的初始分数重新开始。`(_, init)` 解构元组,`_` 表示正确答案这一位这里不用。
- `p = softmax(logits[t])` 这张工单现在三个选项的概率。
- `picks = rng.choice(3, size=g, p=p)` 按概率 `p` 从 0、1、2 里抽 `g` 次,得到这一组的 `g` 个答案(下标)。
- `r = np.array([reward(t, OPTIONS[i]) for i in picks])` 每个答案判一次分。
- `if r.std() == 0:` 组内全同,优势全 0,跳过这张工单,并记一次。这就是 `frac_reward_zero_std` 的分子。
- `adv = (r - r.mean()) / (r.std() + 1e-4)` numpy 数组可以整体做减法除法,一行算完整组的优势,和 `grpo_by_hand.py` 里的列表推导式是同一个公式。
- `grad += a * (np.eye(3)[i] - p)` `np.eye(3)[i]` 是第 i 位为 1 的向量(one-hot)。`onehot − p` 是「让选项 i 的 log 概率变大」时三个分数各该怎么动:选中的那个往上,其他的往下。乘上优势 `a`:优势为负时方向反过来,把这个选项往下压。
- `logits[t] += LR * grad / g` 除以 `g` 是对一组取平均,再乘学习率,完成一步更新。真实的 GRPO 在这一步还有裁剪(`epsilon`)和可选的 KL 项,玩具里省掉了。
- `if step in (1, 5, 10, 20, 30):` 只在这几步打印,看趋势。
- `probs = "  ".join(f"{t}:{softmax(logits[t])[OPTIONS.index(TICKETS[t][0])]:.2f}" for t in TICKETS)` 每张工单「正确答案的概率」,`OPTIONS.index("high")` 是 2。
- `train(int(sys.argv[1]) if len(sys.argv) > 1 else 4)` 命令行可以传组大小,不传就是 4。

</div>

```bash
uv run python part10/grpo_toy.py
```

```text
训练前  答对的概率 被重复扣款了:0.23  退款多久到账:0.31  导出报表一直转圈:0.15  合作咨询:0.00
第  1 步  答对的概率 被重复扣款了:0.23  退款多久到账:0.31  导出报表一直转圈:0.15  合作咨询:0.00  组内全同 4/4
第  5 步  答对的概率 被重复扣款了:0.59  退款多久到账:0.64  导出报表一直转圈:0.20  合作咨询:0.00  组内全同 2/4
第 10 步  答对的概率 被重复扣款了:0.84  退款多久到账:0.85  导出报表一直转圈:0.53  合作咨询:0.00  组内全同 2/4
第 20 步  答对的概率 被重复扣款了:0.94  退款多久到账:0.95  导出报表一直转圈:0.91  合作咨询:0.00  组内全同 3/4
第 30 步  答对的概率 被重复扣款了:0.95  退款多久到账:0.96  导出报表一直转圈:0.95  合作咨询:0.00  组内全同 4/4
```

从上往下读。

第 1 步什么都没变,因为 4 张工单 4 组全同:第一步运气不好,前三张的 4 次采样一次都没抽中正确答案,全 0 分,没有信号。从第 5 步开始,前三张的正确率一路往上,30 步后都到了 0.95 左右。整个过程里没有任何人告诉模型「这张该填 high」,它只是被打了分。

「导出报表一直转圈」起步最慢(0.15),前 5 步只从 0.15 涨到 0.20。正确率低时,一组 4 个很少能抽中正确答案,大多数步是组内全错,没有信号。一旦偶尔抽中,它的优势就很大(组里唯一一个 1 分),之后就快了。

到第 20、30 步,「组内全同」又回到 3/4、4/4,这次是因为题变**太简单**了:正确率 0.95 时,4 次全对的概率是 0.95⁴ ≈ 0.81。训练后期 `frac_reward_zero_std` 升高、`reward` 不再涨,是正常的「学会了」;训练前期就很高,是「太难了」。看这个指标要结合 `reward` 一起看。

最后看「合作咨询」:30 步一动不动,始终是 0.00。它正确答案的初始概率约万分之一,30 步 × 4 次 = 120 次采样里一次都没抽中 low,每一组都是全 0,优势永远是 0。**强化学习教不了模型一次都没做对过的事。**它只能把「偶尔做对」变成「经常做对」。这就是为什么 R1 之后几乎所有配方都是先 SFT 打底(哪怕只用少量数据,让模型至少有时能对),再上强化学习。练习 3 会给「合作咨询」先打个底再训一次。

### 零件和大代码的对照

| 零件 | 在哪学的 | 今天的位置 |
| --- | --- | --- |
| 规则检查当判题器 | Day 343、Day 350 | `verifier.py` 的 `triage_reward` |
| 平均数、标准差 | Day 353 | `grpo_by_hand.py`、`advantages` |
| temperature 和按概率采样 | Day 110 | `sample_groups.py` 的 `temperature=1.0`、`grpo_toy.py` 的 `rng.choice` |
| softmax | Day 110 | `grpo_toy.py` 的 `softmax` |
| numpy 数组整体运算 | Day 214 | `grpo_toy.py` 的 `adv = (r - r.mean()) / ...` |
| 线程池并发 | Day 577 | `sample_groups.py` 的 `ThreadPoolExecutor` |
| 价值模型、KL | Day 575 | GRPO 省掉的就是它;`beta` 默认 0 就是不加 KL |

## 动手练习

1. **改组大小**:用 `grpo_toy.py` 分别跑 G=2 和 G=8,和 G=4 比:第 10 步时三张能学会的工单各到了多少?「组内全同」有什么变化?

<details><summary>参考答案</summary>

不用改代码,命令行传组大小:

```bash
uv run python part10/grpo_toy.py 2
uv run python part10/grpo_toy.py 8
```

G=2 的输出:

```text
训练前  答对的概率 被重复扣款了:0.23  退款多久到账:0.31  导出报表一直转圈:0.15  合作咨询:0.00
第  1 步  答对的概率 被重复扣款了:0.23  退款多久到账:0.31  导出报表一直转圈:0.15  合作咨询:0.00  组内全同 4/4
第  5 步  答对的概率 被重复扣款了:0.61  退款多久到账:0.59  导出报表一直转圈:0.19  合作咨询:0.00  组内全同 2/4
第 10 步  答对的概率 被重复扣款了:0.77  退款多久到账:0.82  导出报表一直转圈:0.27  合作咨询:0.00  组内全同 4/4
第 20 步  答对的概率 被重复扣款了:0.94  退款多久到账:0.94  导出报表一直转圈:0.59  合作咨询:0.00  组内全同 2/4
第 30 步  答对的概率 被重复扣款了:0.94  退款多久到账:0.98  导出报表一直转圈:0.87  合作咨询:0.00  组内全同 4/4
```

G=8 的输出:

```text
训练前  答对的概率 被重复扣款了:0.23  退款多久到账:0.31  导出报表一直转圈:0.15  合作咨询:0.00
第  1 步  答对的概率 被重复扣款了:0.30  退款多久到账:0.39  导出报表一直转圈:0.19  合作咨询:0.00  组内全同 1/4
第  5 步  答对的概率 被重复扣款了:0.69  退款多久到账:0.74  导出报表一直转圈:0.30  合作咨询:0.00  组内全同 1/4
第 10 步  答对的概率 被重复扣款了:0.91  退款多久到账:0.90  导出报表一直转圈:0.75  合作咨询:0.00  组内全同 1/4
第 20 步  答对的概率 被重复扣款了:0.94  退款多久到账:0.94  导出报表一直转圈:0.93  合作咨询:0.00  组内全同 3/4
第 30 步  答对的概率 被重复扣款了:0.98  退款多久到账:0.97  导出报表一直转圈:0.97  合作咨询:0.00  组内全同 3/4
```

| 第 10 步 | 被重复扣款了 | 退款多久到账 | 导出报表一直转圈 | 组内全同 |
| --- | --- | --- | --- | --- |
| G=2 | 0.77 | 0.82 | 0.27 | 4/4 |
| G=4 | 0.84 | 0.85 | 0.53 | 2/4 |
| G=8 | 0.91 | 0.90 | 0.75 | 1/4 |

组越大学得越快,差别最大的是起点最低的「导出报表一直转圈」:G=2 时第 10 步才 0.27,G=8 已经 0.75。原因就在「组内全同」:正确率 0.15 时,2 次全错的概率是 0.85² ≈ 0.72,8 次全错是 0.85⁸ ≈ 0.27,组大了更容易抽中一次正确答案,有了它才有信号。G=8 第 1 步就动了,G=2、G=4 第 1 步全组全同。代价是每一步的采样量:G=8 是 G=2 的 4 倍。注意三个跑法用的是同一个种子,但组大小不同,抽出来的随机数序列就不同,所以每一行都不能逐个比较,只看趋势。另外「合作咨询」三种组大小都学不会,组大一点也救不了万分之一的概率。

</details>

2. **按难度筛题,再比两种优势算法**:读 `part10/data/groups.jsonl`,去掉组内全同的题,看剩下几道;对剩下的前 4 道,同时打印「除以标准差」和「不除」两种优势。

<details><summary>参考答案</summary>

新建 `part10/filter_groups.py`:

```python
# agent-zero-lab/part10/filter_groups.py
"""按难度筛题:组内得分全一样的题对 GRPO 没用,去掉;剩下的题再对比两种优势算法。
用法:uv run python part10/filter_groups.py part10/data/groups.jsonl
"""
import json
import statistics
import sys

groups = [json.loads(x) for x in open(sys.argv[1], encoding="utf-8") if x.strip()]
keep = [g for g in groups if statistics.pstdev(g["rewards"]) > 0]
print(f"共 {len(groups)} 题,组内有高有低的 {len(keep)} 题,去掉 {len(groups) - len(keep)} 题:"
      + "、".join(g["id"] for g in groups if g not in keep))
for g in keep[:4]:
    r = g["rewards"]
    mean, std = statistics.mean(r), statistics.pstdev(r)
    grpo = [round((x - mean) / (std + 1e-4), 2) for x in r]
    no_std = [round(x - mean, 2) for x in r]
    print(f"{g['id']} 奖励 {r}  除以标准差 {grpo}  不除 {no_std}")
```

<div class="line-notes">

- `keep = [g for g in groups if statistics.pstdev(g["rewards"]) > 0]` 只留组内有差别的题。真实做法是训练前用模型对每道题采样几次,按正确率筛,这里直接复用 `sample_groups.py` 存下的结果。
- `"、".join(g["id"] for g in groups if g not in keep)` 被去掉的题号。`g not in keep` 比较字典内容,这里每个字典都不同,所以能用。
- `no_std = [round(x - mean, 2) for x in r]` Dr. GRPO 的做法:只减平均,不除标准差。在 TRL 里对应 `scale_rewards="none"`。

</div>

```bash
uv run python part10/filter_groups.py part10/data/groups.jsonl
```

```text
共 16 题,组内有高有低的 13 题,去掉 3 题:D002、D004、D009
D001 奖励 [0.75, 0.5, 0.5, 0.5]  除以标准差 [1.73, -0.58, -0.58, -0.58]  不除 [0.19, -0.06, -0.06, -0.06]
D003 奖励 [0.75, 0.75, 1.0, 0.75]  除以标准差 [-0.58, -0.58, 1.73, -0.58]  不除 [-0.06, -0.06, 0.19, -0.06]
D005 奖励 [0.75, 0.75, 1.0, 1.0]  除以标准差 [-1.0, -1.0, 1.0, 1.0]  不除 [-0.12, -0.12, 0.12, 0.12]
D006 奖励 [0.75, 0.5, 1.0, 1.0]  除以标准差 [-0.3, -1.51, 0.9, 0.9]  不除 [-0.06, -0.31, 0.19, 0.19]
```

去掉 3 道,剩 13 道,和 `frac_reward_zero_std = 0.19` 对得上。

两种算法的差别看 D001 和 D005。D001 是 0.75 对三个 0.5,D005 是两个 1.0 对两个 0.75,分差都是 0.25。除以标准差后,D001 的那份 0.75 拿到 1.73,D005 的 1.0 只拿到 1.0;不除的话,两组里多对一个字段的那份分别是 +0.19 和 +0.12,差不多。除以标准差让「一组里只有一个人突出」的情况信号特别强,不管它突出了多少。Dr. GRPO 认为这会让训练偏向那些组内差别很小的题;不除标准差,优势就只反映分数实际差了多少。哪个更好要看任务,TRL 两种都支持,知道 `scale_rewards` 这个开关管的是这件事就够了。

</details>

3. **先打底,再强化**:「合作咨询」学不会,因为正确答案几乎从不被采到。假设你先做了一点 SFT,把它 low 的分数从 −6 抬到 1.5(其他不变),再跑一遍 GRPO,看它能不能学会。

<details><summary>参考答案</summary>

新建 `part10/grpo_toy_warm.py`,改掉表里那一行再调 `train`:

```python
# agent-zero-lab/part10/grpo_toy_warm.py
"""「合作咨询」先用 SFT 打个底(把 low 的分数抬到 1.5),再跑同样的 GRPO。"""
import grpo_toy

grpo_toy.TICKETS["合作咨询"] = ("low", [1.5, 3.0, 0.0])
grpo_toy.train(4)
```

<div class="line-notes">

- `import grpo_toy` 导入整个模块。`grpo_toy.py` 有 `if __name__ == "__main__":` 保护,导入时不会自己跑一遍。
- `grpo_toy.TICKETS["合作咨询"] = ("low", [1.5, 3.0, 0.0])` 改的是模块里那个字典本身。`train` 每次运行时才去读 `TICKETS`,所以会用上新值。这种「改别的模块的全局变量」只适合做实验,正式代码里应该把初始分数当参数传进去。
- `grpo_toy.train(4)` 组大小 4,种子默认 0,和正文的跑法一样。

</div>

```bash
uv run python part10/grpo_toy_warm.py
```

```text
第  1 步  答对的概率 被重复扣款了:0.23  退款多久到账:0.31  导出报表一直转圈:0.15  合作咨询:0.24  组内全同 3/4
第  5 步  答对的概率 被重复扣款了:0.59  退款多久到账:0.64  导出报表一直转圈:0.20  合作咨询:0.44  组内全同 2/4
第 10 步  答对的概率 被重复扣款了:0.84  退款多久到账:0.85  导出报表一直转圈:0.53  合作咨询:0.86  组内全同 1/4
第 20 步  答对的概率 被重复扣款了:0.94  退款多久到账:0.95  导出报表一直转圈:0.91  合作咨询:0.96  组内全同 3/4
第 30 步  答对的概率 被重复扣款了:0.95  退款多久到账:0.96  导出报表一直转圈:0.95  合作咨询:0.98  组内全同 4/4
```

打底以后 low 的初始概率是 softmax([1.5, 3, 0]) 里的第一个数,约 0.175,第 1 步更新后已经是 0.24,30 步后到了 0.98,比另外三张还快。前三张的数字和正文完全一样:每张工单每一步都抽 4 个随机数,不管概率是多少,所以改了最后一张不影响前面三张抽到的随机数。

这个小实验就是「先 SFT 再 RL」的道理:SFT 负责让模型「有时能对」,RL 负责把「有时」变成「几乎总是」。只有 RL 没有 SFT,模型没见过的答案永远采不到。

</details>

4. **再写一个可验证奖励**(开放题):客服回复里会写退款金额。写一个 `refund_reward(reply, expected)`:回复里**恰好**写了一个「退款 X 元」并且 X 等于应退金额才给 1 分,写了两个金额、没写金额、写错金额都是 0 分。用 4 条回复测一下。

<details><summary>参考答案</summary>

新建 `part10/refund_verifier.py`:

```python
# agent-zero-lab/part10/refund_verifier.py
"""另一种可验证奖励:客服回复里写的退款金额,和按规则算出来的金额一致才给分。"""
import re


def refund_reward(reply: str, expected: float) -> float:
    amounts = re.findall(r"退款?\s*(\d+(?:\.\d+)?)\s*元", reply)
    if len(amounts) != 1:
        return 0.0
    return 1.0 if abs(float(amounts[0]) - expected) < 0.005 else 0.0


if __name__ == "__main__":
    expected = 149.5
    for reply in ["已为您申请退款 149.5 元,3 个工作日内到账。",
                  "已为您申请退款 150 元。",
                  "可以退 149.5 元,也可能退 299 元,以审核为准。",
                  "已为您申请退款,金额以系统为准。"]:
        print(refund_reward(reply, expected), reply)
```

<div class="line-notes">

- `amounts = re.findall(r"退款?\s*(\d+(?:\.\d+)?)\s*元", reply)` 正则:「退」后面可以有「款」(`款?`),然后是数字(可带小数,`(?:...)` 是不捕获的分组),最后是「元」。`findall` 返回所有匹配的捕获组,相当于 JS 的 `[...reply.matchAll(re)].map(m => m[1])`。
- `if len(amounts) != 1:` 必须恰好一个金额。写两个金额是典型的「两头押」:如果奖励只检查「回复里有没有出现正确金额」,模型很快会学会把几个可能的数都写上。
- `return 1.0 if abs(float(amounts[0]) - expected) < 0.005 else 0.0` 浮点数不能直接 `==`,差在半分钱以内就算对。`expected` 是按退款规则算出来的应退金额,在真实系统里来自 Day 350 那种判题器。

</div>

```bash
uv run python part10/refund_verifier.py
```

```text
1.0 已为您申请退款 149.5 元,3 个工作日内到账。
0.0 已为您申请退款 150 元。
0.0 可以退 149.5 元,也可能退 299 元,以审核为准。
0.0 已为您申请退款,金额以系统为准。
```

第三条里确实出现了正确金额 149.5,但同时写了 299,判 0 分;第四条一个数字都不写,也是 0 分,这堵住了「什么都不承诺就不会错」的路。这个函数只管金额,回复好不好读、语气对不对它管不了,真实的奖励要和别的检查组合起来,这正是 Day 581 的内容。

</details>

验收标准:`verifier.py` 的 5 行输出和本文一致;`grpo_by_hand.py` 的四组优势你能手算出第一组的第一个数(0.90);`sample_groups.py` 跑通并能解释 `frac_reward_zero_std` 是怎么数出来的(你的数字会因为随机性和我不同);`grpo_toy.py` 三种组大小的输出和本文一致(固定了种子),并能说出「合作咨询」为什么学不会。今天实跑花费:`sample_groups.py` 两轮共 128 次调用,每轮输入 7,360、输出约 1,500 token,按 flash 未命中价算上限 (7360 × 2 + 1519 × 8 + 7360 × 2 + 1504 × 8) ÷ 100 万 ≈ 0.054 元;第一次 `n=4` 的请求被拒,不收费;其余脚本不调 API。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 强化学习(RL) | 模型自己尝试,根据结果的分数调整行为,不需要示范答案 |
| 稀疏奖励 | 一整段回答只得到一个分数,不知道是哪一步做对或做错 |
| 奖励函数 | 给一份输出打分的函数或模型,强化学习的全部信号都来自它 |
| RLVR | 可验证奖励的强化学习,分数由程序判定(对答案、跑测试、查格式),不用奖励模型 |
| 可验证奖励 | 不用人、不用模型,一个程序就能判出好坏的奖励,今天的 `triage_reward` |
| GRPO | 组相对策略优化:同一个 prompt 采样一组回答,用组内平均当基准算优势,不需要价值模型 |
| 优势(advantage) | 这次的分数比基准高多少,为正就提高这份回答的概率 |
| 基准(baseline) | 「这道题平均能拿多少分」,PPO 用价值模型估,GRPO 用组内平均 |
| 组(group) | GRPO 里同一个 prompt 采样出的 G 个回答,TRL 默认 G=8(`num_generations`) |
| frac_reward_zero_std | 一批里组内分数完全相同的组所占比例,高说明题太简单或太难,学习信号少 |
| 策略梯度 | 按「优势 × 让这个答案概率变大的方向」更新模型的方法,GRPO 在它外面加了组内基准 |
| Dr. GRPO | 一种 GRPO 改进,去掉除以标准差(和长度归一化),TRL 里对应 `scale_rewards="none"` |
| aha moment | DeepSeek-R1 论文里描述的现象:只用结果奖励训练,模型自己学会了回头检查 |

## 常见误区

**以为强化学习能教会模型一次都没做对过的事。** 今天「合作咨询」正确答案的概率约万分之一,30 步 120 次采样一次没抽中,组组全 0,30 步纹丝不动。强化学习把「偶尔做对」变成「经常做对」,要先让模型有时能对,所以通常先 SFT 再 RL。

**判分函数写得宽松。** 线上解析模型输出可以宽容(剥代码块、找第一个 `{`),训练时的奖励不行,你宽容什么模型就学什么。今天的 `triage_reward` 对「JSON 后面多五个字」和「多一个字段」都给 0 分。

**以为 OpenAI 兼容接口的参数都能用。** 第一版 `sample_groups.py` 用 `n=4`,DeepSeek 返回 400:`Invalid n value (currently only n = 1 is supported)`。要一组回答就发 G 次请求;自部署的 vLLM 支持 `n`。

**采样温度设得很低。** 温度低时一组 G 个回答几乎一样,优势全 0,`frac_reward_zero_std` 会很高。GRPO 采样要用模型本来的分布,今天用 1.0。

**看到 `frac_reward_zero_std` 高就以为出了问题。** 训练前期高是题太难,要筛题或先 SFT;训练后期高往往是学会了(今天 G=4 的玩具第 30 步是 4/4,正确率都在 0.95 左右)。要和 `reward` 曲线一起看。

**只跑一次就下结论。** 同一条 `sample_groups.py` 命令,我跑了两次,`frac_reward_zero_std` 一次 0.38、一次 0.19。G 越小,随机性越大。

**把强化学习当成分诊的首选。** 有可靠标签的单步分类任务,SFT 通常就够了。强化学习适合结果能检查、过程示范不出来的任务,比如多步工具调用算退款金额。

## 学习资料

### 文档与文章

- [DeepSeekMath 论文](https://arxiv.org/abs/2402.03300):GRPO 的出处,读第 4 节「Reinforcement Learning」,对照今天的 `grpo_by_hand.py` 看公式,约 1 小时。
- [DeepSeek-R1 论文](https://arxiv.org/abs/2501.12948):读 R1-Zero 那部分,看他们用了哪两种规则奖励、aha moment 长什么样。
- [Tulu 3 论文](https://arxiv.org/abs/2411.15124):RLVR 这个叫法的出处,找讲 RLVR 的那一节读。
- [Understanding R1-Zero-Like Training](https://arxiv.org/abs/2503.20783):提出 Dr. GRPO,讲除以标准差和长度归一化带来的偏差,读摘要和第 3 节,和练习 2 对照。
- [DAPO 论文](https://arxiv.org/abs/2503.14476):TRL 里 `loss_type="dapo"` 的来源,读摘要知道它改了什么就行。
- [TRL · GRPO Trainer](https://huggingface.co/docs/trl/main/en/grpo_trainer):`num_generations`、`beta`、`scale_rewards`、`loss_type` 的默认值和 `frac_reward_zero_std` 的定义都在这里,Day 581 会照着它写训练脚本。
- [Hugging Face LLM Course · Open R1 for Students](https://huggingface.co/learn/llm-course/chapter12/1):官方课程里讲推理模型和 GRPO 的一章,有图有代码,适合当今天的复习材料。
- [OpenAI Spinning Up · Key Concepts in RL](https://spinningup.openai.com/en/latest/spinningup/rl_intro.html):强化学习基本概念(策略、奖励、回报)的英文入门,读第一部分就够。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rooaYVEk8&autoplay=0&high_quality=1" title="【大白话03】一文理清强化学习RL基本原理" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吃花椒的麦 · 【大白话03】一文理清强化学习RL基本原理 | 原理图解+公式推导 · 约 36 分钟,从零讲策略、奖励、价值,前 15 分钟对应今天「模仿和试错」那一节,公式推导部分可以先跳过。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1EEP6zTEWu&autoplay=0&high_quality=1" title="【GRPO】零基础也能看懂的GRPO算法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>东川路第一可爱猫猫虫 · 【GRPO】零基础也能看懂的GRPO算法 · 约 17 分钟,2026 年 3 月,讲组内采样和相对优势,看完再回头读 `grpo_by_hand.py` 的输出。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/mg-iU-WxiNs" title="GRPO: The RL Trick Behind DeepSeek-R1's Reasoning" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Jia-Bin Huang · GRPO: The RL Trick Behind DeepSeek-R1's Reasoning · 动画讲 PPO 的价值模型和 GRPO 怎么用组内平均替代它,英文,和今天那张 GRPO 图对照看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/bAWV_yrqx4w" title="[GRPO Explained] DeepSeekMath" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Yannic Kilcher · [GRPO Explained] DeepSeekMath: Pushing the Limits of Mathematical Reasoning in Open Language Models · 逐段读 DeepSeekMath 论文,GRPO 在后半段,英文,适合想啃论文的时候看。</figcaption>
</figure>

### 书籍

- Richard S. Sutton、Andrew G. Barto《Reinforcement Learning: An Introduction》第 2 版(MIT Press, 2018):强化学习的经典教材,作者在 [incompleteideas.net](http://incompleteideas.net/book/the-book-2nd.html) 免费放出全书。今天只需要读第 1 章建立概念,第 13 章是策略梯度,学完 Day 581 再看。
- Nathan Lambert《RLHF Book》:讲 RLHF 和大模型后训练的书,在线免费读 [rlhfbook.com](https://rlhfbook.com/),里面有专门讲 RLVR 和 GRPO 的章节。

### 开源项目与代码

- [huggingface/trl](https://github.com/huggingface/trl):`trl/trainer/grpo_trainer.py` 里搜 `advantages`,能找到和今天 `grpo_by_hand.py` 同一个公式的实现。
- [huggingface/open-r1](https://github.com/huggingface/open-r1):Hugging Face 复现 R1 的开源项目,看 README 里的训练流程(先 SFT 再 GRPO)和奖励函数是怎么写的。

## 自测

1. SFT、DPO、蒸馏、强化学习的学习信号分别是什么?为什么只有强化学习有机会超过示范?

<details><summary>答案</summary>

SFT 是标准答案,DPO 是「这份比那份好」,蒸馏是老师的输出,三者都是模仿,上限是示范的质量。强化学习的信号是自己写的回答拿到的分数,不需要示范,所以能发现示范里没有的做法(R1 自己学会了回头检查);而且它在自己生成的回答上学,能学到从自己会犯的错里走回来。代价是信号稀疏,要大量采样。

</details>

2. 一组 4 个回答的分数是 [0.75, 0.75, 0.75, 0.75],GRPO 的优势是多少?今天的实跑里这种组说明了什么?

<details><summary>答案</summary>

平均 0.75,标准差 0,优势全是 0(分母加了 1e-4,不会除以 0),这组对训练没有贡献。今天 D002、D004、D009 就是这样,而且全是 0.75:模型每次都稳定地错同一个字段。组内没有差别,GRPO 就没有信号去纠正这种系统性错误。

</details>

3. GRPO 和 PPO 最大的区别是什么?省掉了什么,换来了什么代价?

<details><summary>答案</summary>

PPO 用一个价值模型估计「这道题平均能拿几分」作为基准,GRPO 对同一个 prompt 采样一组回答,用组内平均当基准。省掉了价值模型(它通常和策略模型差不多大,要单独训练、占显存、不稳定)。代价是每道题要采样 G 个回答,采样算力成倍增加;组内全同时完全没有信号。

</details>

4. 为什么今天的 `triage_reward` 对「四个字段全对但后面多了五个字」也给 0 分?线上解析时为什么又可以宽容?

<details><summary>答案</summary>

训练时模型会利用判分规则里的每一点宽松:如果多余文字不扣分,模型就可能学会在 JSON 后面加客套话,线上下游的解析就可能出问题。所以奖励要严格,格式不对就是 0。线上使用时目的是尽量把一条输出用起来,宽容解析能少丢一些请求,而且不会反过来影响模型怎么学。

</details>

5. (面试题)产品经理说:「我们的客服 Agent 回答质量一般,用 GRPO 训一下吧。」你会先问哪些问题?

<details><summary>答案</summary>

第一,有没有可验证的奖励:「质量」里哪些部分能用程序判(退款金额对不对、该调的工具调没调、事实和数据库是否一致、格式是否合法),哪些只能靠人或 judge。只能靠 judge 的部分要先想清楚怎么防模型讨好 judge。第二,模型现在在这些任务上「有时能对」吗?如果某类任务一次都做不对,RL 学不到,要先 SFT 或改提示词。第三,SFT、更好的提示词、更好的工具是不是已经到顶了,有没有基线可比。第四,算力和人:GRPO 每道题要采样一组,需要 GPU 和懂训练不稳定的人。第五,评测:训练奖励之外,要有一份独立的评测集和不同的检查方式,防止奖励涨了质量没涨。

</details>

6. 训练前你用模型对每道题采样 8 次,发现一半的题 8 次全对、三成的题 8 次全错。直接开训会怎样?该怎么处理?

<details><summary>答案</summary>

全对和全错的组优势都是 0,`frac_reward_zero_std` 一开始就在 0.8 左右,大部分采样白花,训练几乎在空转。处理:去掉大部分全对的题(太简单);全错的题要么也去掉,要么先用 SFT 或改提示词让模型「有时能对」再放回来;保留正确率在中间区间的题。训练过程中模型变强,原来的中等题会变成全对,要定期重新筛。

</details>

## 明天预告

Day 580 · 第 83 周复习:进阶(Day 574–579)。这一周从把 LoRA 挂到 vLLM 上做对比,走到 DPO、蒸馏、置信度路由,再到今天的强化学习,是一整条「模型层后训练」的线。明天把六天串成一张图,把这一周的坑和面试题过一遍,再做一个只用本周知识的小项目,然后才进入 Day 581 的奖励设计和 GRPO 训练。
