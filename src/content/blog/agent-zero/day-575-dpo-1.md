---
title: 'Day 575 · DPO(一):从 RLHF 到 DPO,变体,偏好数据从哪来'
description: '分诊有标准答案,客服回复没有,只有「这份比那份好」。今天用两个纯 Python 小脚本把 RLHF 和 DPO 的核心算式算一遍,认识 KTO、ORPO、SimPO 这几个变体各吃什么数据,然后真的用 DeepSeek 给 6 张工单各采样 4 份回复草稿,用规则检查和交换位置的 judge 造出 15 对偏好数据,顺带抓到两个不报错的坑。'
pubDate: 2026-10-22
regime: none
tags: ['dpo', 'rlhf', 'preference', 'kto', 'fine-tuning', 'agent-zero']
series: 'agent-zero'
day: 575
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 574](/blog/agent-zero/day-574-finetune-3/) 我们写了 `compare_models.py`,让 DeepSeek、原版 Qwen 和 LoRA 微调版跑同一份评测集,逐条配对比较;又发现 `tickets_v1` 的每道题在训练集里都有同模板的「兄弟」,于是手写了一份换了说法的 `tickets_hard.jsonl`。那几天训练的都是分诊:一张工单进去,一段 JSON 出来,每个字段都有唯一的标准答案,SFT 就是照着标准答案模仿。

可 SupportPilot 还有一个节点没有标准答案:给客户起草回复。同一张退款工单,三句话能写,一段也能写;可以先道歉,也可以先给结论。客服主管看两份草稿,几秒钟就能说出「这份好」,让他写一份唯一正确的标准回复,他写不出来。今天学的就是这种场景下怎么训练模型:不给标准答案,只给「A 比 B 好」。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清 RLHF 的三步各做什么,用一个 20 行的脚本算出 DPO 的损失,讲明白 DPO 为什么能省掉奖励模型和强化学习两步,以及 β 管什么。
2. 知道 DPO、IPO、KTO、ORPO、SimPO 各需要什么形状的数据,看手里的数据选方法。
3. 从三个来源造偏好对(人工修改记录、规则检查、LLM 评审),写出 `build_pref_pairs.py`,读懂它打印的来源统计和长度偏差。

预计用时 2.5 小时。前置:[Day 110](/blog/agent-zero/day-110-sampling-1/)(概率分布和 logprob)、[Day 113](/blog/agent-zero/day-113-training/)(RLHF 一句话版)、[Day 359](/blog/agent-zero/day-359-llm-judge-4/)(judge 的位置偏差)、[Day 372](/blog/agent-zero/day-372-feedback-1/)(点赞、改写这些反馈)、[Day 477](/blog/agent-zero/day-477-eval-rules/)(规则检查)、[Day 570](/blog/agent-zero/day-570-finetune-1/)(训练集整理)。

今天全部在本机跑,不需要 GPU。打 DeepSeek API 的地方一共花了约 0.06 元,算式在验收标准里。真正上卡训练是明天的事。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`dpo_loss_toy.py` 的 `dpo` 函数,`build_pref_pairs.py` 的 `pairs_for` 和 `judged`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 为什么要「A 比 B 好」这种数据

先把 SFT 和今天要学的东西摆在一起看。SFT 的一条样本是「输入 → 标准答案」,训练时模型被要求把标准答案的每一个 token 概率都往上推。分诊这么做没问题,`urgency` 就是 `low`,没得商量。

回复草稿不行。假设你硬要用 SFT,拿客服最终发出去的回复当标准答案,模型学到的是「把这一份一字不差地写出来」。可客服那天写成这样只是其中一种好写法,换个客服换种说法也一样好。SFT 会把这些偶然的措辞也当成要学的东西。更麻烦的是,你手里大量的数据根本不是标准答案,而是比较:客服把 Agent 的草稿改了几句再发出去,改前和改后就是「后者比前者好」;客服点了「不采纳」,就是「这份不行」。

[Day 113](/blog/agent-zero/day-113-training/) 用玩具演过一遍 RLHF:不让人写答案,只让人比较,再按比较结果挪概率。今天把这件事讲细,并且落到 SupportPilot 自己的数据上。

## RLHF 的三步

2022 年 OpenAI 的 InstructGPT 论文把 RLHF(reinforcement learning from human feedback,基于人类反馈的强化学习)的流程定了型,三步:

**第一步 SFT。** 用人写的示范回答微调,让模型先会正常对话。这一步你在 Day 572 做过。

**第二步训练奖励模型。** 同一个问题让模型写几个回答,请人比较哪个好,用这些比较结果训练一个打分模型:输入问题和回答,输出一个分数。这个打分模型叫**奖励模型**(reward model),它学的是「人会喜欢哪个」。

**第三步强化学习。** 用 PPO 算法让模型不断写回答、奖励模型打分、按分数更新模型。为了防止模型为了刷分写出奇怪的东西(奖励模型也有漏洞,模型会去钻),再加一条约束:新模型的输出分布不能离第一步的 SFT 模型太远。衡量「离多远」用的是 KL 散度,你可以先把它理解成「两个概率分布差了多少」的一个数,完全一样时是 0。

这套流程效果好,工程上很重。第三步训练时显存里要同时放四个模型:正在训练的模型、冻结的参考模型(第一步的快照,用来算 KL)、奖励模型、PPO 需要的价值模型。训练还容易不稳定。对一个做应用的团队,这基本做不起。

2023 年的 DPO(Direct Preference Optimization,直接偏好优化)论文给了一个漂亮的结论:在「多拿奖励、同时别离参考模型太远」这个目标下,最优的模型和奖励之间有一个能写出来的关系式。反过来用这个关系式,奖励可以直接用「训练中的模型」和「参考模型」给同一段回答的概率之比来表示,不再需要一个单独的奖励模型,也不需要强化学习那一套,一个分类损失就能训。论文的副标题就叫「你的语言模型其实是一个奖励模型」。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="RLHF 三步流程与 DPO 两步流程的对比">
<text x="20" y="25" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">RLHF(InstructGPT,2022)</text>
<rect x="20" y="38" width="140" height="48" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="60" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">1 · SFT</text>
<text x="90" y="76" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">示范回答</text>
<line x1="160" y1="62" x2="200" y2="62" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="200" y="38" width="170" height="48" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="285" y="60" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">2 · 训练奖励模型</text>
<text x="285" y="76" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">人比较 A、B</text>
<line x1="370" y1="62" x2="410" y2="62" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="410" y="38" width="210" height="48" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="515" y="60" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">3 · PPO 强化学习</text>
<text x="515" y="76" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">显存里放 4 个模型</text>
<text x="20" y="135" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">DPO(2023)</text>
<rect x="20" y="148" width="140" height="48" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="170" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">1 · SFT</text>
<text x="90" y="186" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">示范回答</text>
<line x1="160" y1="172" x2="200" y2="172" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="200" y="148" width="420" height="48" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="410" y="170" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">2 · 直接用偏好对训练(一个分类损失)</text>
<text x="410" y="186" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">训练中的模型 + 冻结的参考模型,没有奖励模型和价值模型</text>
<text x="320" y="235" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">同一份「A 比 B 好」的数据,DPO 把第 2、3 步合成一步</text>
</svg>
<figcaption>蓝色是要训练的语言模型本身,琥珀色是 RLHF 额外需要的组件和过程。DPO 没有扔掉「奖励」这个概念,只是把它换成了模型自己算得出来的东西。</figcaption>
</figure>

公式先不看,我们用两个小脚本把它算出来。

## 第一步:分数差怎么变成「A 比 B 好的概率」

奖励模型给每个回答打一个分。可人给的数据不是分数,是「A 比 B 好」。两者怎么对上?用的是一个 1952 年就有的模型,叫 **Bradley-Terry**:两个选手的实力分差越大,强的那个赢的概率越高,概率等于分差过一下 sigmoid。sigmoid 你可以理解成一个把任意实数压到 0 到 1 之间的函数,0 映射到 0.5,越大越接近 1,越小越接近 0,形状像一个拉长的 S。前端打个比方,它像 CSS 里的 `ease-in-out`:中间变化快,两头平。

新建 `part10/bt_toy.py`(这是 Day 570 起用的 `agent-zero-lab/part10/` 目录,在 `agent-zero-lab` 根目录跑):

```python
# agent-zero-lab/part10/bt_toy.py
"""Bradley-Terry:两个回答的「分数差」怎么变成「A 比 B 好的概率」。不调 API。"""
import math


def sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


for diff in (-4, -2, -1, 0, 0.5, 1, 2, 4):
    p = sigmoid(diff)
    print(f"r(A) - r(B) = {diff:>4}   P(A 比 B 好) = {p:.3f}   -log P = {-math.log(p):.3f}")
```

<div class="line-notes">

- `import math` 标准库的数学函数,`math.exp` 是 e 的几次方,`math.log` 是自然对数,相当于 JS 的 `Math.exp`、`Math.log`。
- `return 1 / (1 + math.exp(-x))` sigmoid 的定义。x=0 时 `exp(0)=1`,结果 1/2=0.5;x=2 时 `exp(-2)≈0.135`,结果 1/1.135≈0.881。
- `for diff in (-4, -2, -1, 0, 0.5, 1, 2, 4):` 挑几个分差试一下,`r(A)` 就是奖励模型给 A 打的分。
- `print(f"r(A) - r(B) = {diff:>4}` `:>4` 右对齐占 4 格,`:.3f` 保留 3 位小数,前面的课一直这么用。最后的 `-log P` 那一列就是训练时的**损失**:人说 A 好,模型给的 P(A 好) 越接近 1,`-log P` 越接近 0;越接近 0,损失越大。这和分诊 SFT 用的交叉熵是同一个思路(Day 572 提过一句)。

</div>

```bash
cd agent-zero-lab
uv run python part10/bt_toy.py
```

实跑输出:

```text
r(A) - r(B) =   -4   P(A 比 B 好) = 0.018   -log P = 4.018
r(A) - r(B) =   -2   P(A 比 B 好) = 0.119   -log P = 2.127
r(A) - r(B) =   -1   P(A 比 B 好) = 0.269   -log P = 1.313
r(A) - r(B) =    0   P(A 比 B 好) = 0.500   -log P = 0.693
r(A) - r(B) =  0.5   P(A 比 B 好) = 0.622   -log P = 0.474
r(A) - r(B) =    1   P(A 比 B 好) = 0.731   -log P = 0.313
r(A) - r(B) =    2   P(A 比 B 好) = 0.881   -log P = 0.127
r(A) - r(B) =    4   P(A 比 B 好) = 0.982   -log P = 0.018
```

记住 0.693 这个数。分差为 0 时,模型觉得 A、B 一样好,P=0.5,损失是 `-log 0.5 = 0.693`。明天看 DPO 训练日志,第一步的 loss 就是 0.693 附近,原因就在这里。

训练奖励模型就是:拿一堆「人说 A 比 B 好」的数据,调奖励模型的参数,让每一对的 `-log P` 尽量小。到这里还是 RLHF 第二步的事。

## 第二步:DPO 的损失,手算一遍

DPO 的关键一步,是把上面的 `r(A)` 换成一个不需要奖励模型就能算的东西:

```text
隐式奖励 r(回答) = β × [ log π(回答) - log π_ref(回答) ]
```

π 读作「派」,这里指正在训练的模型,`π(回答)` 是它生成这整段回答的概率;`π_ref` 是参考模型,训练开始那一刻的快照,冻住不动。一整段回答的概率是每个 token 概率的乘积,几十上百个小于 1 的数乘起来小得没法看,所以都取对数,用 **logp**(对数概率)表示,乘法变加法。[Day 110](/blog/agent-zero/day-110-sampling-1/) 里 API 返回的 `logprob` 就是单个 token 的这个值,一段回答的 logp 就是把每个 token 的 logprob 加起来,是个负数,越接近 0 说明模型越愿意这么写。

所以隐式奖励的意思很直白:**训练后的模型比训练前更愿意写这段回答,奖励就是正的**。把它代进 Bradley-Terry,一对数据(好回答记作 chosen,差回答记作 rejected)的损失就是 `-log sigmoid(r(chosen) - r(rejected))`,其中 `r(chosen) - r(rejected)` 叫 **margin**。TRL 文档里的公式写的就是这个。

新建 `part10/dpo_loss_toy.py`,手填几组 logp,看损失怎么变:

```python
# agent-zero-lab/part10/dpo_loss_toy.py
"""手算一对偏好数据的 DPO 损失。logp 是「整段回答的对数概率」,这里手填几组数看损失怎么变。不调 API。"""
import math

REF_CHOSEN, REF_REJECTED = -42.0, -40.0   # 参考模型:训练开始时的模型给两段回答的 logp


def dpo(pol_chosen: float, pol_rejected: float, beta: float = 0.1) -> tuple[float, float, float]:
    r_chosen = beta * (pol_chosen - REF_CHOSEN)        # 隐式奖励:比参考模型多给了多少概率
    r_rejected = beta * (pol_rejected - REF_REJECTED)
    margin = r_chosen - r_rejected
    loss = -math.log(1 / (1 + math.exp(-margin)))      # -log sigmoid(margin)
    return r_chosen, r_rejected, loss


STATES = [
    ("刚开始,策略=参考", -42.0, -40.0),
    ("好回答概率升高", -38.0, -40.0),
    ("差回答概率压低", -42.0, -50.0),
    ("两个都降,差的降更多", -45.0, -60.0),
    ("两个一起升同样多", -41.0, -39.0),
]
for name, pc, pr in STATES:
    rc, rr, loss = dpo(pc, pr)
    print(f"{name:<14} logp 好/差 = {pc:>6}/{pr:>6}  奖励 好 {rc:+.2f} 差 {rr:+.2f}  margin {rc - rr:+.2f}  loss {loss:.3f}")

print("β 的作用:同样是「差回答 logp 降 10」")
for beta in (0.01, 0.1, 0.5):
    print(f"  beta={beta:<5} loss={dpo(-42.0, -50.0, beta)[2]:.3f}")
```

<div class="line-notes">

- `REF_CHOSEN, REF_REJECTED = -42.0, -40.0` 参考模型给好回答的 logp 是 -42,给差回答是 -40。注意差回答的概率反而更高:模型本来就更爱写那份差的,这正是要训练的原因。这两个数是我手填的,真实的值明天从模型里算出来。
- `def dpo(pol_chosen: float, pol_rejected: float, beta: float = 0.1) -> tuple[float, float, float]:` `pol` 是 policy(策略)的缩写,强化学习里把「正在训练的模型」叫策略。β 默认 0.1,和 TRL 的默认值一样。
- `r_chosen = beta * (pol_chosen - REF_CHOSEN)` 隐式奖励。logp 相减就是概率相除再取对数,也就是 `log(π / π_ref)`。第二行状态里 `0.1 × (-38 - (-42)) = 0.1 × 4 = +0.40`。
- `margin = r_chosen - r_rejected` 好回答的奖励比差回答高多少。
- `loss = -math.log(1 / (1 + math.exp(-margin)))` 就是 `bt_toy.py` 里那一列 `-log P`,只是分差换成了 margin。
- `STATES = [` 五个假想的训练进度,每个是(说明, 训练中模型给好回答的 logp, 给差回答的 logp)。
- `("刚开始,策略=参考", -42.0, -40.0),` 训练第 0 步,模型就是参考模型,两个奖励都是 0,loss 是 0.693。
- `("两个都降,差的降更多", -45.0, -60.0),` 这一行最重要,下面单独讲。
- `print(f"{name:<14}` `:<14` 左对齐占 14 格。中文一个字算一格但显示占两格,所以终端里列没完全对齐,不影响读数。
- `print(f"  beta={beta:<5} loss={dpo(-42.0, -50.0, beta)[2]:.3f}")` `[2]` 取返回元组的第三个值 loss。三种 β 下,模型做了同样的改变:差回答的 logp 从 -40 降到 -50。

</div>

```bash
uv run python part10/dpo_loss_toy.py
```

实跑输出:

```text
刚开始,策略=参考      logp 好/差 =  -42.0/ -40.0  奖励 好 +0.00 差 +0.00  margin +0.00  loss 0.693
好回答概率升高        logp 好/差 =  -38.0/ -40.0  奖励 好 +0.40 差 +0.00  margin +0.40  loss 0.513
差回答概率压低        logp 好/差 =  -42.0/ -50.0  奖励 好 +0.00 差 -1.00  margin +1.00  loss 0.313
两个都降,差的降更多     logp 好/差 =  -45.0/ -60.0  奖励 好 -0.30 差 -2.00  margin +1.70  loss 0.168
两个一起升同样多       logp 好/差 =  -41.0/ -39.0  奖励 好 +0.10 差 +0.10  margin +0.00  loss 0.693
β 的作用:同样是「差回答 logp 降 10」
  beta=0.01  loss=0.644
  beta=0.1   loss=0.313
  beta=0.5   loss=0.007
```

逐行读。

第一行,刚开始 loss=0.693,和 `bt_toy.py` 分差为 0 那一行一样。

第二、三行,DPO 只看「好的相对差的」拉开了多少。把好回答抬高 4 和把差回答压低 10,都能降 loss;后者 margin 更大,loss 降得更多。

第四行是最反直觉的一行,也是明天看训练日志时一定会碰到的现象:好回答的 logp 从 -42 掉到 -45,模型其实更不愿意写好回答了,可 loss 反而是五行里最低的,因为差回答掉得更多。DPO 的损失只管差距,不管绝对值。TRL 文档里也写了,DPO 在实践中主要靠压低差回答的概率,而不是抬高好回答的概率。好回答的概率如果掉得太多,模型输出可能变得怪,明天会讲怎么发现和怎么补救。

第五行,两个一起升,margin 还是 0,loss 一点没降。所以 DPO 不会因为「模型整体更爱说话了」就给奖励。

最后三行是 β。同样的改变,β=0.5 时 loss 已经压到 0.007,接近 0,损失几乎不再推动模型;β=0.01 时 loss 还有 0.644,模型还得继续往远处走。β 越大,模型稍微动一点点就满足了,于是离参考模型越近,越保守;β 越小,允许它走得越远。TRL 默认 0.1。

到这里你已经算过 DPO 的全部核心:不需要奖励模型(奖励是模型自己和参考模型的 logp 差),不需要强化学习(一个 `-log sigmoid` 的分类损失,像普通训练一样求导更新就行),只需要两个模型:训练中的那个和冻结的参考。用 LoRA 训练时连参考模型都不用另存,把 LoRA 旁路关掉,剩下的基座就是参考模型,明天会看到。

## 几个变体,区别在数据

DPO 之后出了一大批变体。你不用记公式,要记的是它们各吃什么样的数据,因为手里有什么数据,基本就决定了用哪个:

| 方法 | 需要的数据 | 要参考模型吗 | 解决什么问题 |
| --- | --- | --- | --- |
| DPO | 成对:同一个输入下一好一差 | 要 | 基础方法 |
| IPO | 成对 | 要 | DPO 在偏好很确定时容易过拟合,IPO 换了损失的形状缓解 |
| KTO | 不成对:一条回答 + 好或坏的标签 | 要 | 线上的点赞点踩天然不成对,不用硬凑 |
| ORPO | 成对 | 不要 | 把 SFT 和偏好优化合成一步,连第一步都省了 |
| SimPO | 成对 | 不要 | 用按长度平均的 logp 当奖励,缓解「越长越好」 |

这些都在 TRL 里。我查了 TRL 1.16.0(2026 年 10 月 15 日发布,PyPI 上的最新版)的 `DPOConfig` 文档,`loss_type` 默认是 `["sigmoid"]`,就是我们刚才手算的那个;写成 `"ipo"` 就是 IPO,写成 `"sigmoid_norm"` 就是 SimPO 那种按 token 数归一化的写法;KTO 有单独的 `KTOTrainer`。`loss_type` 是个列表,可以把几种损失按权重混着用,明天会用到其中一种组合。

选法很朴素。客服在工作台上「改了再发」的记录,改前改后天然是一对,用 DPO。客服只点了「采纳 / 不采纳」,很多工单只有一份草稿,凑不出对,用 KTO。连 SFT 都还没做、想一步到位,可以看 ORPO。偏好数据里好回答系统性更长,怕模型学成话痨,考虑 SimPO。

## 偏好数据从哪来

偏好对的质量比数量重要得多。一对好数据的标准是:**同一个输入,两份回答,差别集中在你想让模型学的那一点上**。如果好回答同时更短、更礼貌、事实更准、还引用了政策编号,模型不知道该学哪一条,很可能学到最容易学的那条,通常是长度。

SupportPilot 有三个地方能挖:

**人工修改记录。** [Day 372](/blog/agent-zero/day-372-feedback-1/) 说过,客服在工作台上改了 Agent 的草稿再发,这是最强的隐式反馈。改之前是 rejected,改之后是 chosen,质量最高。前提是两个版本你都存了。练习 4 会处理它。

**规则检查。** [Day 477](/blog/agent-zero/day-477-eval-rules/) 的规则层:不能承诺还没做的动作、要引用政策编号、不能太长。对同一张工单采样几份草稿,只差一条规则的两份就是一对,差别天然集中在那一条上。全自动,不花人力。

**LLM 评审。** 规则分不出好坏的两份,交给 judge 比。[Day 359](/blog/agent-zero/day-359-llm-judge-4/) 讲过 judge 有位置偏差,所以要交换位置各评一次,两次结论一致才算数。

下面三步把后两个来源走一遍,用的是真实采样出来的草稿。

## 第三步:给每张工单采样 4 份草稿

我们需要「同一张工单的几份不同草稿」。真实项目里,草稿最好由**将要被训练的那个模型**来写,因为 DPO 调的是它自己的输出分布,偏好对里的错误最好正是它自己会犯的错误。今天没有 GPU 跑 Qwen,先用 DeepSeek 演示流程;明天在 Colab 上会讲怎么换成 Qwen 自己采样。

温度设到 1.0,让 4 份草稿有差别([Day 110](/blog/agent-zero/day-110-sampling-1/) 讲过温度越高越随机)。system 说明故意写得很宽松,只说「写一段回复」,不提团队的规矩,模拟一个还没调好的起草节点。

新建 `part10/sample_drafts.py`:

```python
# agent-zero-lab/part10/sample_drafts.py
"""给每张工单采样 4 份回复草稿,存成 drafts.jsonl,后面造偏好对用。
用法:uv run python part10/sample_drafts.py
"""
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from openai.types.chat import ChatCompletionMessageParam

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
SYSTEM = "你是 CloudLedger 的客服,根据工单和查到的资料,给客户写一段中文回复草稿。"
TICKETS = [
    ("R01", "开错版本了想退", "手滑买成了企业版 2376 元,才用了两天,能退吗?",
     "订阅:企业版年付 2376 元,开通 2 天。政策 KB-012:开通 7 天内可全额退款,需人工审批,1-3 个工作日处理。"),
    ("R02", "退款还没到", "上周提交的 199 元退款,银行卡还没收到。",
     "退款单 RF-3381:已审批,10 月 18 日原路退回。政策 KB-013:原路退回到账一般 3-7 个工作日。"),
    ("R03", "被扣了两次", "10 月 3 日同一笔 299 元扣了两次。",
     "扣款记录:10 月 3 日两笔 299 元,间隔 4 秒,疑似重复。政策 KB-021:重复扣款核实后全额退回多扣部分,需人工确认。"),
    ("R04", "能退一半吗", "团队版年付用了五个月,不想用了,能退剩下的钱吗?",
     "订阅:团队版年付 1188 元,已用 5 个月。政策 KB-012:超过 7 天不支持退款,可关闭自动续费。"),
    ("R05", "发票抬头错了", "9 月发票公司名少了「有限公司」。",
     "发票 INV-0921:抬头「青禾餐饮」。政策 KB-031:抬头错误可作废重开,当月内 1 个工作日完成。"),
    ("R06", "降级怎么算钱", "想从团队版降到基础版,差价退吗?",
     "订阅:团队版月付 99 元。政策 KB-041:降级下个账期生效,当期不退差价。"),
]


def prompt_for(subject: str, body: str, facts: str) -> list[ChatCompletionMessageParam]:
    return [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"工单主题:{subject}\n客户原文:{body}\n查到的资料:{facts}"}]


if __name__ == "__main__":
    out = Path(__file__).parent / "data" / "drafts.jsonl"
    tok_in = tok_out = 0
    with open(out, "w", encoding="utf-8") as f:
        for tid, subject, body, facts in TICKETS:
            messages = prompt_for(subject, body, facts)
            drafts = []
            for _ in range(4):
                resp = client.chat.completions.create(model=os.environ["LLM_MODEL"], messages=messages,
                                                      temperature=1.0, max_tokens=400, extra_body=EXTRA)
                drafts.append(resp.choices[0].message.content or "")
                if resp.usage:
                    tok_in, tok_out = tok_in + resp.usage.prompt_tokens, tok_out + resp.usage.completion_tokens
            f.write(json.dumps({"ticket_id": tid, "facts": facts, "prompt": messages, "drafts": drafts},
                               ensure_ascii=False) + "\n")
            print(tid, [len(d) for d in drafts])
    print(f"输入 {tok_in} 输出 {tok_out} token,约 ¥{(tok_in * 2 + tok_out * 8) / 1e6:.4f}")
```

<div class="line-notes">

- `EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` `.env` 里的 `LLM_EXTRA_BODY={"thinking": {"type": "disabled"}}`,关掉 DeepSeek 的思考模式,和 Day 570 起的写法一样。后面会看到忘了关它会出什么事。
- `SYSTEM = "你是 CloudLedger 的客服,根据工单和查到的资料,给客户写一段中文回复草稿。"` 故意只有一句话,没说「要引用政策编号」「别承诺没做的事」。规矩没写进提示词,模型就会时守时不守,这正是我们要的「有好有坏」。
- `TICKETS = [` 6 张工单,每张是(编号, 主题, 客户原文, 工具查到的资料)。资料里那段相当于 SupportPilot 起草节点拿到的检索结果和工具结果,`KB-012` 这种是帮助中心政策文章的编号。
- `"订阅:企业版年付 2376 元,开通 2 天。政策 KB-012:开通 7 天内可全额退款,需人工审批,1-3 个工作日处理。"),` 关键词是「需人工审批」:Agent 自己不能退款,只能提交给人审,所以回复里不能说「已为您退款」。
- `def prompt_for(subject: str, body: str, facts: str) -> list[ChatCompletionMessageParam]:` 拼出起草节点的输入。偏好对里的 `prompt` 字段存的就是它,训练时模型看到的输入必须和线上一样,Day 570 讲过的规矩。
- `for _ in range(4):` 每张工单调 4 次。DeepSeek 不支持一次请求返回多份(OpenAI 的 `n` 参数),只能循环。`_` 表示这个循环变量用不到。
- `temperature=1.0, max_tokens=400, extra_body=EXTRA)` 温度 1.0 让每次写得不一样;400 个 token 足够写一段回复。
- `tok_in, tok_out = tok_in + resp.usage.prompt_tokens, tok_out + resp.usage.completion_tokens` 累计 token 数,最后算钱。
- `f.write(json.dumps({"ticket_id": tid, "facts": facts, "prompt": messages, "drafts": drafts},` 一张工单一行:编号、资料、完整输入、4 份草稿。`facts` 单独存一份,规则检查要用。
- `print(tid, [len(d) for d in drafts])` 打印每份草稿的字数,先对长短有个感觉。`len` 对中文字符串数的是字数,不是字节数。
- `print(f"输入 {tok_in} 输出 {tok_out} token,约 ¥{(tok_in * 2 + tok_out * 8) / 1e6:.4f}")` 价格沿用 Day 570 查的 DeepSeek 高峰价:输入每百万 token 2 元、输出 8 元。

</div>

```bash
uv run python part10/sample_drafts.py
```

实跑输出(2026-10-22,DeepSeek `deepseek-flash`,关闭思考):

```text
R01 [144, 139, 139, 126]
R02 [149, 174, 166, 151]
R03 [148, 202, 143, 134]
R04 [193, 121, 198, 136]
R05 [122, 150, 145, 213]
R06 [178, 140, 128, 135]
输入 2392 输出 2279 token,约 ¥0.0230
```

24 份草稿花了 2 分 3 厘。打开 `part10/data/drafts.jsonl` 读几份,R01 的第 1 份是这样的(原文照抄):

```text
您好，感谢您的联系。经核实，您的企业版订阅（年付 2376 元）于 2 天前开通，符合 KB-012 政策中"开通 7 天内可全额退款"的条件。我们已为您提交退款申请，该申请需人工审批，预计 1-3 个工作日内处理完成……
```

「我们已为您提交退款申请」:起草节点并没有提交任何东西,这句话一发出去,客户就会以为流程已经在走了。R05 的第 1 份也有一句「我们已为您登记处理」。这就是我们想让模型改掉的毛病。

## 第四步:三条规则

把团队的规矩写成代码。新建 `part10/pref_rules.py`:

```python
# agent-zero-lab/part10/pref_rules.py
"""三条规则检查一份回复草稿,返回没通过的规则名。不调 API。"""
import re

FAKE_ACTIONS = ("已为您提交", "已为您登记", "已为您办理", "已为您退款", "已经为您退款")
MAX_CHARS = 180


def check(draft: str, facts: str) -> list[str]:
    failed = []
    if any(p in draft for p in FAKE_ACTIONS):
        failed.append("fake_action")
    codes = re.findall(r"KB-\d+", facts)
    if codes and not any(c in draft for c in codes):
        failed.append("no_policy_id")
    if len(draft) > MAX_CHARS:
        failed.append("too_long")
    return failed


if __name__ == "__main__":
    import json
    import sys
    for line in open(sys.argv[1], encoding="utf-8"):
        row = json.loads(line)
        print(row["ticket_id"], [check(d, row["facts"]) or "ok" for d in row["drafts"]])
```

<div class="line-notes">

- `FAKE_ACTIONS = ("已为您提交", "已为您登记", "已为您办理", "已为您退款", "已经为您退款")` 「承诺了没做的动作」的几种说法。真实项目里这张表是从 badcase 里一条条攒出来的,Day 477 的规则层也是这么来的。
- `MAX_CHARS = 180` 客服主管定的:一段回复别超过 180 字。
- `if any(p in draft for p in FAKE_ACTIONS):` `any` 相当于 JS 的 `some`,有一个短语出现在草稿里就算违规。`in` 对字符串是「包含子串」,相当于 `draft.includes(p)`。
- `codes = re.findall(r"KB-\d+", facts)` 从资料里找出所有政策编号。`r"KB-\d+"` 是正则,`\d+` 是一个或多个数字,R01 的资料里找到 `['KB-012']`。
- `if codes and not any(c in draft for c in codes):` 资料里有政策编号,草稿却一个都没引用,就算违规。资料里没有编号的工单不检查这一条。
- `if len(draft) > MAX_CHARS:` 超过 180 字算太长。
- `print(row["ticket_id"], [check(d, row["facts"]) or "ok" for d in row["drafts"]])` 空列表在 Python 里是「假」,`or "ok"` 让全部通过的显示成 `ok`,好认。

</div>

```bash
uv run python part10/pref_rules.py part10/data/drafts.jsonl
```

```text
R01 [['fake_action'], ['no_policy_id'], ['fake_action'], ['no_policy_id']]
R02 [['no_policy_id'], ['no_policy_id'], ['no_policy_id'], ['no_policy_id']]
R03 [['fake_action', 'no_policy_id'], ['no_policy_id', 'too_long'], ['no_policy_id'], ['no_policy_id']]
R04 [['too_long'], 'ok', ['too_long'], ['no_policy_id']]
R05 [['fake_action', 'no_policy_id'], ['no_policy_id'], ['no_policy_id'], ['no_policy_id']]
R06 [['no_policy_id'], 'ok', ['no_policy_id'], ['no_policy_id']]
```

24 份里只有 2 份全过。最多的问题是不引用政策编号(19 份),这在意料之中,提示词里根本没要求。这一步的输出要停下来想一想:**如果一条规则几乎每份都违反,先改提示词,别急着训练。** 在 system 里加一句「回复要写出依据的政策编号」,大概率就好了一大半,比 DPO 便宜得多。今天留着它不改,是为了有足够的「坏样本」演示造对;练习 5 的答案里会讲到这个判断。

## 第五步:造偏好对

现在把规则结果变成偏好对。规则是这样用的:同一张工单的两份草稿,如果 A 犯的规则是 B 犯的规则的子集,而且 B 只比 A 多犯一条,那 A 好 B 差,差别正好集中在那一条上。比如 R01 的第 0 份犯 `fake_action`,第 1 份犯 `no_policy_id`,两份各犯一条不同的,谁也不比谁好,不成对;R04 的第 1 份全过、第 0 份只犯 `too_long`,成一对,这一对只教「别写太长」。

两份犯的规则完全一样(比如都只犯 `no_policy_id`),规则分不出来,就交给 judge,交换位置评两次。

新建 `part10/build_pref_pairs.py`:

```python
# agent-zero-lab/part10/build_pref_pairs.py
"""从采样的草稿造 DPO 偏好对:规则分得出的直接成对,规则分不出的交给 judge(交换位置评两次)。
用法:uv run python part10/build_pref_pairs.py part10/data/drafts.jsonl part10/data/pairs.jsonl
"""
import json
import os
import statistics
import sys
from collections import Counter
from itertools import combinations

from dotenv import load_dotenv
from openai import OpenAI

from pref_rules import check

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
JUDGE = ("你是客服主管。下面是同一张工单的两份回复草稿 A 和 B。只看哪份更准确、更清楚地回答了客户的问题,"
         "不要因为长短打分。只输出一个字母:A、B,或者分不出就输出 T。")
usage = Counter()


def judge_once(facts: str, question: str, a: str, b: str) -> str:
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"], temperature=0, max_tokens=5, extra_body=EXTRA,
        messages=[{"role": "system", "content": JUDGE},
                  {"role": "user", "content": f"{question}\n资料:{facts}\n\n【A】\n{a}\n\n【B】\n{b}"}])
    if resp.usage:
        usage["in"] += resp.usage.prompt_tokens
        usage["out"] += resp.usage.completion_tokens
    return (resp.choices[0].message.content or "T").strip()[:1]


def judged(facts: str, question: str, x: str, y: str) -> tuple[str, str] | None:
    first, second = judge_once(facts, question, x, y), judge_once(facts, question, y, x)
    usage["judge_pairs"] += 1
    if first == "A" and second == "B":
        return x, y
    if first == "B" and second == "A":
        return y, x
    usage["judge_disagree"] += 1
    return None


def pairs_for(row: dict) -> list[tuple[str, str, str]]:
    facts, question = row["facts"], row["prompt"][1]["content"]
    failed = [set(check(d, facts)) for d in row["drafts"]]
    rule_pairs, ties = [], []
    for i, j in combinations(range(len(row["drafts"])), 2):
        a, b = failed[i], failed[j]
        if a < b and len(b - a) == 1:          # i 比 j 只少犯一条规则
            rule_pairs.append((row["drafts"][i], row["drafts"][j], "rule:" + (b - a).pop()))
        elif b < a and len(a - b) == 1:
            rule_pairs.append((row["drafts"][j], row["drafts"][i], "rule:" + (a - b).pop()))
        elif a == b:
            ties.append((i, j))
    out = rule_pairs[:3]
    for i, j in ties[:1]:                      # 规则分不出的,每张工单最多送一对给 judge
        w = judged(facts, question, row["drafts"][i], row["drafts"][j])
        if w:
            out.append((w[0], w[1], "judge"))
    return out


def main(src: str, dst: str) -> None:
    why, ratios, n = Counter(), [], 0
    with open(dst, "w", encoding="utf-8") as f:
        for line in open(src, encoding="utf-8"):
            row = json.loads(line)
            for chosen, rejected, reason in pairs_for(row):
                f.write(json.dumps({"prompt": row["prompt"],
                                    "chosen": [{"role": "assistant", "content": chosen}],
                                    "rejected": [{"role": "assistant", "content": rejected}],
                                    "why": reason, "ticket_id": row["ticket_id"]}, ensure_ascii=False) + "\n")
                n += 1
                why[reason] += 1
                ratios.append(len(chosen) / len(rejected))
    print(f"pairs={n} 来源={dict(why)}")
    print(f"chosen/rejected 长度比 中位数={statistics.median(ratios):.2f}  "
          f"好回答更长的比例={sum(r > 1 for r in ratios) / len(ratios):.0%}")
    print(f"judge 送审 {usage['judge_pairs']} 对,两次不一致丢掉 {usage['judge_disagree']} 对,"
          f"花费约 ¥{(usage['in'] * 2 + usage['out'] * 8) / 1e6:.4f}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
```

<div class="line-notes">

- `from itertools import combinations` `combinations(range(4), 2)` 生成 4 份里任取 2 份的所有组合:(0,1)(0,2)(0,3)(1,2)(1,3)(2,3),共 6 种。JS 里要自己写两层循环。
- `from pref_rules import check` 上一步的规则函数。脚本在 `part10/` 里,Python 会把脚本所在目录加进导入路径,所以能直接 `import` 同目录的文件,Day 574 一直这么用。
- `JUDGE = ("你是客服主管。` judge 的说明。专门写了「不要因为长短打分」,Day 359 讲过 judge 偏爱长回答。只让它输出一个字母,便宜又好解析。
- `usage = Counter()` 模块级的计数器,记 token 数和 judge 的统计。`Counter` 是 Day 570 用过的那个计数字典。
- `model=os.environ["LLM_MODEL"], temperature=0, max_tokens=5, extra_body=EXTRA,` 只要一个字母,`max_tokens=5` 足够。这一行和 `EXTRA` 配合,下面「踩坑」那一节会出事。
- `{"role": "user", "content": f"{question}\n资料:{facts}\n\n【A】\n{a}\n\n【B】\n{b}"}])` 把工单、资料、两份草稿拼给 judge。资料一定要给,不然 judge 没法判断「准确」。
- `return (resp.choices[0].message.content or "T").strip()[:1]` content 是 None 时当成 T(分不出);`[:1]` 只取第一个字符,防止它多说一句。
- `first, second = judge_once(facts, question, x, y), judge_once(facts, question, y, x)` 正着评一次(x 在 A 位置),反着评一次(x 在 B 位置)。
- `if first == "A" and second == "B":` 两次都选了 x(第一次 x 是 A,第二次 x 是 B),采信,x 是 chosen。
- `if first == "B" and second == "A":` 两次都选了 y。其他情况(两次都选 A、都选 B、出现 T)都算不一致,丢掉。
- `failed = [set(check(d, facts)) for d in row["drafts"]]` 每份草稿犯了哪些规则,转成集合,方便下面做集合运算。
- `if a < b and len(b - a) == 1:          # i 比 j 只少犯一条规则` 集合的 `<` 是「真子集」:a 里的规则 b 都有,而且 b 还多了别的。`b - a` 是差集,多出来的规则;长度为 1 才算「差别集中在一点」。比如 a 是空集、b 是 `{'too_long'}`,成对。
- `rule_pairs.append((row["drafts"][i], row["drafts"][j], "rule:" + (b - a).pop()))` 记下(好, 差, 原因)。`.pop()` 从只有一个元素的集合里取出那个元素,原因记成 `rule:too_long` 这样,后面统计要用。
- `elif a == b:` 犯的规则一模一样,规则分不出,先记下来留给 judge。
- `out = rule_pairs[:3]` 每张工单最多 3 对规则对,避免某一张工单占太多。真实项目里几百张工单时,这个上限能防止数据被少数工单主导。
- `for i, j in ties[:1]:                      # 规则分不出的,每张工单最多送一对给 judge` judge 要花钱、而且噪声大,每张只送一对。
- `ratios.append(len(chosen) / len(rejected))` 每对的长度比。大于 1 说明好回答更长。
- `print(f"chosen/rejected 长度比 中位数={statistics.median(ratios):.2f}  "` 长度偏差的体检,下面细说。

</div>

```bash
uv run python part10/build_pref_pairs.py part10/data/drafts.jsonl part10/data/pairs.jsonl
```

实跑输出:

```text
pairs=15 来源={'judge': 3, 'rule:fake_action': 4, 'rule:too_long': 4, 'rule:no_policy_id': 4}
chosen/rejected 长度比 中位数=0.97  好回答更长的比例=40%
judge 送审 6 对,两次不一致丢掉 3 对,花费约 ¥0.0089
```

15 对,12 对来自规则(三条规则各 4 对),3 对来自 judge。judge 送审 6 对,一半因为两次结论不一致被丢掉了,这个比例比你想的高,练习 3 会把它拆开看。

`pairs.jsonl` 的每一行长这样(prompt 省略):

```json
{"prompt": [{"role": "system", ...}, {"role": "user", ...}],
 "chosen": [{"role": "assistant", "content": "您好,感谢您的咨询。关于您团队版年付订阅的退款问题,我们理解您的想法,但根据订阅政策(KB-012)……"}],
 "rejected": [{"role": "assistant", "content": "您好,感谢您的咨询。\n\n关于您团队版年付订阅的退款问题,经核实……"}],
 "why": "rule:too_long", "ticket_id": "R04"}
```

这就是 TRL 文档里的「对话格式、显式 prompt」:`prompt` 是消息列表,`chosen` 和 `rejected` 各是一条 assistant 消息。明天的训练脚本直接吃这个文件。`why` 和 `ticket_id` 是我们自己加的,训练时会删掉,但统计和排查时离不开它们。

### 读长度偏差

总的看,好回答更长的比例是 40%,中位数 0.97,好像很平衡。按来源拆开看就不是这样了。新建 `part10/pair_stats.py`:

```python
# agent-zero-lab/part10/pair_stats.py
"""按来源看偏好对的长度偏差:每种来源里,好回答比差回答长还是短。
用法:uv run python part10/pair_stats.py part10/data/pairs.jsonl
"""
import json
import statistics
import sys
from collections import defaultdict

by_why: dict[str, list[float]] = defaultdict(list)
for line in open(sys.argv[1], encoding="utf-8"):
    p = json.loads(line)
    by_why[p["why"]].append(len(p["chosen"][0]["content"]) / len(p["rejected"][0]["content"]))

for why, ratios in sorted(by_why.items()):
    longer = sum(r > 1 for r in ratios)
    print(f"{why:<20} {len(ratios)} 对  长度比中位数 {statistics.median(ratios):.2f}  好回答更长 {longer}/{len(ratios)}")
```

<div class="line-notes">

- `by_why: dict[str, list[float]] = defaultdict(list)` 按来源分组,每组一个长度比的列表。`defaultdict(list)` 访问不存在的键时自动放一个空列表,Day 574 练习 2 用过。
- `by_why[p["why"]].append(len(p["chosen"][0]["content"]) / len(p["rejected"][0]["content"]))` `chosen` 是只有一条消息的列表,`[0]["content"]` 取出文字。
- `for why, ratios in sorted(by_why.items()):` 按来源名排序打印,每次输出顺序一样。

</div>

```bash
uv run python part10/pair_stats.py part10/data/pairs.jsonl
```

```text
judge                3 对  长度比中位数 1.04  好回答更长 2/3
rule:fake_action     4 对  长度比中位数 1.08  好回答更长 2/4
rule:no_policy_id    4 对  长度比中位数 0.96  好回答更长 2/4
rule:too_long        4 对  长度比中位数 0.67  好回答更长 0/4
```

`too_long` 这 4 对,好回答全都更短,中位数只有差回答的三分之二。这很合理,规则本身就是按长度判的。问题是它会把「短」直接教给模型。如果某天你的规则对占了大头、其中又是 `too_long` 居多,训练出来的模型可能学成「越短越好」,连该写清楚的步骤都省了。反过来,很多团队的 judge 偏爱长回答,数据里好回答系统性更长,模型就学成话痨,这是 DPO 最常见的副作用。

所以长度统计要**按来源看**,只看总数会被互相抵消的两种偏差骗过去。处理办法有几种:控制每种来源的配比;补一些「好回答更短但信息一样」的对来抵消;或者用 SimPO 那种按长度归一化的损失(TRL 的 `sigmoid_norm`)。

### 抽查 judge 选的那几对

judge 采信了 3 对,我打开 `pairs.jsonl` 把 `why` 是 `judge` 的读了一遍,R03 这一对有问题:

```text
chosen:   ……经核实,您 10 月 3 日的 299 元扣款确实出现了两笔,间隔仅 4 秒,属于重复扣款。……确认后会尽快将多扣的 299 元原路退回。
rejected: ……经查询,10 月 3 日确实有两笔 299 元的扣款记录,间隔仅 4 秒,疑似重复扣款。……目前该笔款项需由人工进一步确认,我们会尽快为您跟进处理。
```

资料里写的是「疑似重复」「需人工确认」。chosen 直接说「属于重复扣款」,把还没确认的事说成了结论;rejected 的「疑似」才是对的。judge 两次都选了 chosen,交换位置也没救回来,因为它不是位置偏差,是 judge 本身判错了(它大概觉得肯定的说法「更清楚」)。这一对进了训练集,就是在教模型「把疑似说成确定」。

R01 那一对也值得一看:judge 比的两份都犯了 `fake_action`,不管选谁,chosen 里都写着「已为您提交」。规则分不出、judge 选一个,结果把一份违规的草稿当成了「好回答」。更稳的做法是只把**都通过规则**的草稿送给 judge,两份都违规的不送。练习 5 会改这一处。

这两个问题脚本都查不出来。和 Day 570 那句「训练前一定要随手抽十几条读一读」一样,偏好数据也得人看。规则对比较可靠,judge 对要抽查,抽查出错的比例高,就整批不用。

### 故意踩一次坑:忘了关思考模式

把 `.env` 里的 `LLM_EXTRA_BODY` 临时换成空的,模拟「忘了关 DeepSeek 的思考模式」,再跑一次,输出写到 `/dev/null`(一个丢弃一切的特殊文件,不覆盖刚才的 `pairs.jsonl`):

```bash
LLM_EXTRA_BODY='{}' uv run python part10/build_pref_pairs.py part10/data/drafts.jsonl /dev/null
```

```text
pairs=12 来源={'rule:fake_action': 4, 'rule:too_long': 4, 'rule:no_policy_id': 4}
chosen/rejected 长度比 中位数=0.90  好回答更长的比例=33%
judge 送审 6 对,两次不一致丢掉 6 对,花费约 ¥0.0098
```

没有任何报错,judge 却 6 对全部「不一致」。(命令前面写 `变量=值`,只对这一条命令生效;`load_dotenv` 默认不覆盖已经存在的环境变量,所以 `.env` 里那行没起作用。)原因我单独调了一次看到了:打开思考模式后,模型先写推理过程,`max_tokens=5` 全被推理用掉了,返回的 `content` 是空字符串,`finish_reason` 是 `length`,`usage` 里 `reasoning_tokens=5`。空字符串经过 `or "T"` 变成了 T,于是每一票都是「分不出」。

这种坑最阴险:脚本跑完、数字看着正常、钱也花了,数据却少了一个来源。防法是在 `judge_once` 里检查 `finish_reason`,不是 `stop` 就报错或者计数打印出来,别让兜底的 `or "T"` 把异常吞掉。我的代码里故意没加,你在练习 5 里加上。

### 零件和大代码的对照

| 零件 | 在哪学的 | 今天的位置 |
| --- | --- | --- |
| sigmoid 和 `-log P` | 今天 `bt_toy.py` | DPO 损失的最后一步 |
| logp、参考模型、隐式奖励 | Day 110、今天 `dpo_loss_toy.py` | 明天 TRL 日志里的 `rewards/*` |
| 温度采样 | Day 110 | `sample_drafts.py` 的 `temperature=1.0` |
| 规则检查 | Day 477 | `pref_rules.py` 的 `check` |
| 交换位置的 judge | Day 359 | `build_pref_pairs.py` 的 `judged` |
| 集合运算 | Day 25 | `pairs_for` 里的 `a < b`、`b - a` |
| 计数和分组 | Day 570、Day 574 | `Counter`、`defaultdict` |

## 动手练习

1. **反过来算**:人说 A 比 B 好,如果要让 P(A 比 B 好) 达到 0.6、0.75、0.9、0.99,分差各要多大?在 β=0.1 时,对应的 logp 差要拉开多少?

<details><summary>参考答案</summary>

sigmoid 的反函数是 `log(p / (1 - p))`,叫 logit。新建 `part10/bt_inverse.py`:

```python
# agent-zero-lab/part10/bt_inverse.py
"""反过来算:想让 P(A 比 B 好) 达到某个值,分数差要多大。"""
import math

for p in (0.6, 0.75, 0.9, 0.99):
    diff = math.log(p / (1 - p))
    print(f"P = {p:<5} 需要 r(A) - r(B) = {diff:.2f}   换成 DPO 的 margin,beta=0.1 时 logp 差要拉开 {diff / 0.1:.1f}")
```

<div class="line-notes">

- `diff = math.log(p / (1 - p))` p=0.9 时 `0.9 / 0.1 = 9`,`log 9 ≈ 2.20`。代回 `bt_toy.py`,分差 2 时 P=0.881,和这里对得上。
- `print(f"P = {p:<5} 需要 r(A) - r(B) = {diff:.2f}   换成 DPO 的 margin,beta=0.1 时 logp 差要拉开 {diff / 0.1:.1f}")` margin = β × (logp 的相对变化之差),所以 logp 差 = margin ÷ β。

</div>

```bash
uv run python part10/bt_inverse.py
```

```text
P = 0.6   需要 r(A) - r(B) = 0.41   换成 DPO 的 margin,beta=0.1 时 logp 差要拉开 4.1
P = 0.75  需要 r(A) - r(B) = 1.10   换成 DPO 的 margin,beta=0.1 时 logp 差要拉开 11.0
P = 0.9   需要 r(A) - r(B) = 2.20   换成 DPO 的 margin,beta=0.1 时 logp 差要拉开 22.0
P = 0.99  需要 r(A) - r(B) = 4.60   换成 DPO 的 margin,beta=0.1 时 logp 差要拉开 46.0
```

从 0.9 到 0.99 要多拉开一倍多。这说明越往后越难推:loss 已经很小的那些对,给模型的推力也很小,训练的力气会自动花在还没学会的对上。另一方面,如果一个偏好对特别好区分(比如差回答满篇违规),模型很快就把它推到 0.99,之后它对训练几乎没贡献。

</details>

2. **拆成 KTO 格式**:把 `pairs.jsonl` 拆成 KTO 要的不成对格式,每行 `{"prompt", "completion", "label"}`,同一份草稿只写一次。数一数好、坏各几条。注意一份草稿会不会在一对里是好的、在另一对里是坏的?

<details><summary>参考答案</summary>

新建 `part10/to_kto.py`:

```python
# agent-zero-lab/part10/to_kto.py
"""把成对的偏好数据拆成 KTO 要的不成对格式:一条回答 + 一个好/坏标签。
用法:uv run python part10/to_kto.py part10/data/pairs.jsonl part10/data/kto.jsonl
"""
import json
import sys
from collections import Counter

label_of: dict[tuple[str, str], bool] = {}
prompt_of: dict[str, list] = {}
conflict: set[tuple[str, str]] = set()
for line in open(sys.argv[1], encoding="utf-8"):
    p = json.loads(line)
    prompt_of[p["ticket_id"]] = p["prompt"]
    for key, label in (("chosen", True), ("rejected", False)):
        k = (p["ticket_id"], p[key][0]["content"])
        if k in label_of and label_of[k] != label:
            conflict.add(k)
        label_of[k] = label

counts: Counter[bool] = Counter()
with open(sys.argv[2], "w", encoding="utf-8") as out:
    for (tid, text), label in label_of.items():
        if (tid, text) in conflict:
            continue
        out.write(json.dumps({"prompt": prompt_of[tid], "completion": [{"role": "assistant", "content": text}],
                             "label": label}, ensure_ascii=False) + "\n")
        counts[label] += 1
print(f"好 {counts[True]} 条,坏 {counts[False]} 条,两边都出现过、丢掉 {len(conflict)} 条")
```

<div class="line-notes">

- `label_of: dict[tuple[str, str], bool] = {}` 键是(工单号, 草稿原文),值是好还是坏。元组能当字典的键,JS 的对象键只能是字符串,要自己拼。
- `for key, label in (("chosen", True), ("rejected", False)):` 每对拆成两条:chosen 标 True,rejected 标 False。
- `if k in label_of and label_of[k] != label:` 同一份草稿之前出现过,而且标签不一样,记为冲突。
- `if (tid, text) in conflict:` 冲突的不写,两边都不要。
- `out.write(json.dumps({"prompt": prompt_of[tid], "completion": [{"role": "assistant", "content": text}],` TRL 文档里不成对偏好的对话格式:`prompt`、`completion`、`label` 三个字段。

</div>

```bash
uv run python part10/to_kto.py part10/data/pairs.jsonl part10/data/kto.jsonl
```

```text
好 5 条,坏 11 条,两边都出现过、丢掉 2 条
```

真有冲突:2 份草稿在一对里是好的、在另一对里是坏的。比如一份只犯 `no_policy_id` 的草稿,和犯了两条的比,它是好的;和全过的比,它是坏的。这正是成对和不成对数据的本质区别:DPO 的标签是**相对**的,「比那份好」;KTO 的标签是**绝对**的,「这份行」。从成对数据拆 KTO 会遇到这种矛盾,反过来,真正的 KTO 数据(点赞点踩)也拼不出可靠的对。所以先看你的数据是什么形状,再选方法。

另外好 5 条、坏 11 条很不平衡,KTO 的论文和 TRL 文档都提到好坏比例会影响效果,`KTOTrainer` 有 `desirable_weight` 和 `undesirable_weight` 两个参数用来调权重。

</details>

3. **judge 到底在投谁**:把每张工单送给 judge 的那一对单独拿出来,打印正着评、反着评各投了什么,看位置偏差有多大。

<details><summary>参考答案</summary>

复用 `build_pref_pairs.py` 里的 `judge_once` 和 `usage`。新建 `part10/judge_votes.py`:

```python
# agent-zero-lab/part10/judge_votes.py
"""把送给 judge 的那几对单独拿出来,打印正着评、反着评各投了谁,看位置偏差有多大。
用法:uv run python part10/judge_votes.py part10/data/drafts.jsonl
"""
import json
import sys
from itertools import combinations

from build_pref_pairs import judge_once, usage
from pref_rules import check

for line in open(sys.argv[1], encoding="utf-8"):
    row = json.loads(line)
    facts, question, drafts = row["facts"], row["prompt"][1]["content"], row["drafts"]
    failed = [set(check(d, facts)) for d in drafts]
    tie = next(((i, j) for i, j in combinations(range(len(drafts)), 2) if failed[i] == failed[j]), None)
    if tie is None:
        continue
    i, j = tie
    first = judge_once(facts, question, drafts[i], drafts[j])
    second = judge_once(facts, question, drafts[j], drafts[i])
    pick1 = {"A": i, "B": j}.get(first, "-")
    pick2 = {"A": j, "B": i}.get(second, "-")
    verdict = "一致" if pick1 == pick2 and pick1 != "-" else "不一致"
    print(f"{row['ticket_id']} 草稿{i} vs 草稿{j}  正着评={first} 反着评={second}  → 选 {pick1} / {pick2}  {verdict}")
print(f"花费约 ¥{(usage['in'] * 2 + usage['out'] * 8) / 1e6:.4f}")
```

<div class="line-notes">

- `from build_pref_pairs import judge_once, usage` 导入会执行 `build_pref_pairs.py` 顶层的代码(读 `.env`、建 client),调模型的部分在 `if __name__ == "__main__":` 里,不会被执行。
- `tie = next(((i, j) for i, j in combinations(range(len(drafts)), 2) if failed[i] == failed[j]), None)` 找第一对「犯的规则一样」的草稿,和 `pairs_for` 选的是同一对。`next(生成器, None)` 取第一个,一个都没有就返回 None,相当于 JS 的 `arr.find(...) ?? null`。
- `pick1 = {"A": i, "B": j}.get(first, "-")` 把字母翻译回草稿编号:第一次 i 在 A 位置。投了 T 就是 `-`。
- `pick2 = {"A": j, "B": i}.get(second, "-")` 第二次位置换了,j 在 A。

</div>

```bash
uv run python part10/judge_votes.py part10/data/drafts.jsonl
```

```text
R01 草稿0 vs 草稿2  正着评=A 反着评=B  → 选 0 / 0  一致
R02 草稿0 vs 草稿1  正着评=B 反着评=B  → 选 1 / 0  不一致
R03 草稿2 vs 草稿3  正着评=A 反着评=B  → 选 2 / 2  一致
R04 草稿0 vs 草稿2  正着评=B 反着评=B  → 选 2 / 0  不一致
R05 草稿1 vs 草稿2  正着评=A 反着评=A  → 选 1 / 2  不一致
R06 草稿0 vs 草稿2  正着评=B 反着评=B  → 选 2 / 0  不一致
花费约 ¥0.0089
```

6 对里 4 对不一致,而且其中 3 对是「两次都投 B」:不管草稿内容,放在后面的那份就赢。这就是 Day 359 讲的位置偏差,在两份草稿质量接近时特别明显。还有一点:R05 在正文那次跑是一致的(选了草稿 2),这次变成了不一致,温度 0 也在抖。所以 judge 造的对本来就该少而精,不一致的直接丢,不要想办法「救」回来。

</details>

4. **从修改记录造对**:工作台存下了 5 条「Agent 草稿 → 客服改完发出的版本」。改得太少的(只改了标点)不值得学,改得面目全非的可能是客服换了话题。用 `difflib` 的相似度过滤,看阈值怎么定。

<details><summary>参考答案</summary>

新建 `part10/edits_to_pairs.py`:

```python
# agent-zero-lab/part10/edits_to_pairs.py
"""工作台的修改记录 → 偏好对:Agent 的草稿是 rejected,客服改完发出去的是 chosen。
改得太少(只动了标点)和改得面目全非的都不要。不调 API。
"""
import difflib
import sys

HIGH, LOW = (float(x) for x in sys.argv[1:3]) if len(sys.argv) > 2 else (0.95, 0.3)

EDITS = [
    ("E1", "您好,已为您提交退款申请,1-3 个工作日到账。",
     "您好,符合 KB-012 的 7 天全额退款,需要人工审批,审批通过后 1-3 个工作日处理。"),
    ("E2", "您好,发票会在 1 个工作日内重开。", "您好,发票会在 1 个工作日内重开!"),
    ("E3", "您好,降级下个账期生效。", "王先生您好,上周电话里说的那个折扣我们申请下来了,您看什么时候方便聊一下续约。"),
    ("E4", "您好,重复扣款属于系统问题,299 元会马上退回。",
     "您好,10 月 3 日两笔 299 元疑似重复扣款,按 KB-021 需要人工核实,核实后退回多扣的一笔。"),
    ("E5", "您好,按 KB-013,退款原路退回一般 3-7 个工作日到账。",
     "您好,按 KB-013,退款原路退回一般 3-7 个工作日到账,超过 7 天还没到请回复这张工单。"),
]

for eid, draft, sent in EDITS:
    ratio = difflib.SequenceMatcher(None, draft, sent).ratio()
    if ratio > HIGH:
        verdict = "丢掉:只改了标点或错字"
    elif ratio < LOW:
        verdict = "丢掉:几乎重写,可能换了话题,人工看"
    else:
        verdict = "留下:成对"
    print(f"{eid} 相似度 {ratio:.2f}  {verdict}")
```

<div class="line-notes">

- `import difflib` 标准库,比较两段文字有多像。Git 的 diff 也是这个思路。
- `HIGH, LOW = (float(x) for x in sys.argv[1:3]) if len(sys.argv) > 2 else (0.95, 0.3)` 两个阈值可以从命令行传,不传就用 0.95 和 0.3。`sys.argv[1:3]` 取第 2、3 个参数。
- `("E3", "您好,降级下个账期生效。"` 客服把回复整个换成了另一件事(续约折扣)。这一对的差别不是「写得更好」,不能用。
- `ratio = difflib.SequenceMatcher(None, draft, sent).ratio()` 0 到 1 的相似度,1 是完全一样。按字符比,对中文也能用。

</div>

```bash
uv run python part10/edits_to_pairs.py
uv run python part10/edits_to_pairs.py 0.9 0.25
```

```text
E1 相似度 0.42  留下:成对
E2 相似度 0.94  留下:成对
E3 相似度 0.20  丢掉:几乎重写,可能换了话题,人工看
E4 相似度 0.28  丢掉:几乎重写,可能换了话题,人工看
E5 相似度 0.79  留下:成对

E1 相似度 0.42  留下:成对
E2 相似度 0.94  丢掉:只改了标点或错字
E3 相似度 0.20  丢掉:几乎重写,可能换了话题,人工看
E4 相似度 0.28  留下:成对
E5 相似度 0.79  留下:成对
```

默认阈值错了两条:E2 只把句号改成感叹号,相似度 0.94,没被拦住;E4 是一次很有价值的修改(把「属于、马上退回」改成「疑似、需人工核实」,正好是今天 R03 那个问题),却因为改动大被当成换话题丢了。换成 0.9 和 0.25 以后这 5 条都对了。

但别高兴太早,这是拿 5 条数据调出来的阈值,换一批数据很可能又错。字符相似度只是个粗筛,真实项目里常见的做法是:粗筛之后把「改动很大」的那一档拿出来人看,或者让 judge 判断「改动是在修同一个问题,还是换了话题」。另外注意 E5:客服是在后面**加了一句**,chosen 更长,这一类修改多了,数据又会偏向长回答。

</details>

5. **修两处问题**(开放题):把 `build_pref_pairs.py` 复制成 `build_pref_pairs_v2.py`,改两处:只把**都通过全部规则**的草稿送给 judge;`judge_once` 遇到 `finish_reason` 不是 `stop` 时计数并打印。再想一想:`no_policy_id` 违反了 19 份,该用 DPO 还是改提示词?

<details><summary>参考答案</summary>

`pairs_for` 里把送 judge 的条件从 `a == b` 改成 `a == b == set()`(两份都是空集,都没犯规):

```python
        elif a == b == set():                  # 都通过全部规则,规则真的分不出,才送 judge
            ties.append((i, j))
```

<div class="line-notes">

- `elif a == b == set():                  # 都通过全部规则,规则真的分不出,才送 judge` Python 的连续比较,等于 `a == b and b == set()`。`set()` 是空集合;注意不能写 `{}`,那是空字典。

</div>

`judge_once` 里返回之前加一段:

```python
    if resp.choices[0].finish_reason != "stop":
        usage["judge_truncated"] += 1
        print("judge 输出被截断:", resp.choices[0].finish_reason, repr(resp.choices[0].message.content))
```

<div class="line-notes">

- `if resp.choices[0].finish_reason != "stop":` 正常说完是 `stop`;`length` 表示被 `max_tokens` 截断。思考模式没关时就是 `length`。
- `print("judge 输出被截断:", resp.choices[0].finish_reason, repr(resp.choices[0].message.content))` `repr` 把空字符串显示成 `''`,一眼看出是空的。

</div>

`main` 最后那行 `print` 里加上 `截断 {usage['judge_truncated']} 次`。改完跑:

```bash
uv run python part10/build_pref_pairs_v2.py part10/data/drafts.jsonl part10/data/pairs_v2.jsonl
```

```text
pairs=12 来源={'rule:fake_action': 4, 'rule:too_long': 4, 'rule:no_policy_id': 4}
chosen/rejected 长度比 中位数=0.90  好回答更长的比例=33%
judge 送审 0 对,两次不一致丢掉 0 对,截断 0 次,花费约 ¥0.0000
```

judge 一对都没送。按今天的规则结果,24 份里只有 R04 和 R06 各有 1 份全过,没有任何一张工单有两份都全过。这不是坏事:宁可少几对,也别让 judge 在两份违规草稿里硬挑一个。等提示词改好、全过的草稿多了,judge 才有用武之地。

截断检查这次没机会触发,单独验证一下,在 `part10/` 目录里关掉思考模式的开关、直接调一次 `judge_once`:

```bash
cd part10
LLM_EXTRA_BODY='{}' uv run python -c "
from build_pref_pairs_v2 import judge_once, usage
print(judge_once('政策 KB-041:降级下个账期生效。','想降级','您好,下个账期生效。','您好,按 KB-041,降级下个账期生效。'), dict(usage))"
cd ..
```

```text
judge 输出被截断: length ''
T {'in': 129, 'out': 5, 'judge_truncated': 1}
```

这次没有静悄悄地变成 T,屏幕上直接告诉你 `length`、内容是空的。

关于 `no_policy_id`:19/24 违反,这是提示词没写的规矩,不是模型学不会的口径。按 [Day 570](/blog/agent-zero/day-570-finetune-1/) 的顺序,先在 system 里加一句「回复中写出依据的政策编号,如 KB-012」,重新采样看违反率降到多少。降到个位数了,剩下的偶发违规再考虑交给 DPO。偏好优化适合的是「说不清但看得出」的东西,比如语气、详略、先说结论还是先道歉;一句话能写清的规矩,写进提示词更便宜也更可控。

</details>

验收标准:`dpo_loss_toy.py` 的输出和本文一致(不调 API,应该一字不差);你能不看文章说出「两个都降、差的降更多时 loss 反而最低」的原因,以及 β 大小对应保守还是激进;`build_pref_pairs.py` 跑出十几对偏好对,你能按来源读出长度偏差,并且至少抽查了 judge 对里的一对。今天实跑花费约 0.06 元:采样 24 份草稿 0.023 元,造对时 judge 0.009 元,故意不关思考模式那一遍 0.010 元,练习 3 的 judge 0.009 元,加上调试时单独调的几次不到 0.01 元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 偏好优化 | 用「A 比 B 好」这种相对信号训练模型,而不是给标准答案 |
| RLHF | 基于人类反馈的强化学习:SFT、训练奖励模型、PPO 三步 |
| 奖励模型 | 输入问题和回答、输出一个分数的模型,学的是「人会喜欢哪个」 |
| PPO | RLHF 第三步常用的强化学习算法,还需要一个价值模型 |
| KL 散度 | 衡量两个概率分布差多少的一个数,一样时为 0;RLHF 用它约束模型别跑太远 |
| Bradley-Terry | 把两个分数之差过 sigmoid 变成「A 胜 B 的概率」的模型 |
| sigmoid | 把任意实数压到 0 到 1 之间的 S 形函数,0 对应 0.5 |
| DPO | 直接偏好优化:不要奖励模型和强化学习,用偏好对和一个分类损失直接训练 |
| 参考模型(π_ref) | 训练开始时的模型快照,冻住不动,用来算隐式奖励 |
| 策略(policy) | 强化学习里对「正在训练的模型」的叫法 |
| logp | 一段文字的对数概率,等于每个 token 的 logprob 之和,越接近 0 越可能 |
| 隐式奖励 | β × (训练中模型的 logp − 参考模型的 logp),DPO 里用它代替奖励模型的分数 |
| margin | 好回答的隐式奖励减差回答的隐式奖励 |
| β | 控制离参考模型多远的系数,越大越保守,TRL 默认 0.1 |
| chosen / rejected | 偏好对里的好回答 / 差回答 |
| IPO / KTO / ORPO / SimPO | DPO 的变体;KTO 吃不成对的好坏标签,ORPO 和 SimPO 不需要参考模型 |
| 长度偏差 | 偏好数据里好回答系统性更长(或更短),模型学到的是长短而不是质量 |

## 常见误区

**拿 SFT 的思路做回复训练。** 把客服发出去的版本当标准答案,模型会去背措辞。回复这种没有唯一答案的任务,先想有没有偏好数据。

**偏好对的差别太多维。** 好回答同时更短、更准、还引用了政策,模型不知道该学哪一条。今天 `pairs_for` 只收「只差一条规则」的对,每对都记 `why`,就是为了把差别压到一点上。

**只看总的长度比。** 今天总的「好回答更长」是 40%,看着很平衡;拆开看 `too_long` 来源 0/4,judge 来源 2/3,两种偏差互相抵消了。长度统计要按来源看。

**judge 只评一次。** 练习 3 实测 6 对里 4 对两次结论不一致,其中 3 对是放在后面的那份赢。不交换位置评两次,数据里会混进一半噪声。

**相信 judge 选出来的就是对的。** R03 那一对 judge 两次都选了把「疑似」说成「属于」的草稿。交换位置只能去掉位置偏差,去不掉 judge 本身的判断错误,要人抽查。

**用 DPO 补提示词没写的规矩。** `no_policy_id` 24 份里违反 19 份,是因为提示词没提。一句话能写清的规矩先写进提示词,DPO 留给「说不清但看得出」的东西。

**兜底代码吞掉了异常。** `or "T"` 让思考模式下的空输出静悄悄变成「分不出」,6 对全丢也没报错。凡是解析模型输出的地方,都检查一下 `finish_reason`。

## 学习资料

### 文档与文章

- [DPO 论文](https://arxiv.org/abs/2305.18290):Rafailov 等,2023。读摘要、第 1 节和第 4 节的结论,理解「语言模型就是奖励模型」这句话。推导第一遍看不懂没关系,今天的 `dpo_loss_toy.py` 已经把要用的部分算过了。
- [InstructGPT 论文](https://arxiv.org/abs/2203.02155):RLHF 三步流程的出处,读第 3 节方法部分的那张流程图就够了。
- [TRL · DPO Trainer](https://huggingface.co/docs/trl/main/dpo_trainer):今天的数据格式、`loss_type` 全表、`beta` 的默认值都来自这一页,明天还要用。
- [TRL · Dataset formats](https://huggingface.co/docs/trl/main/dataset_formats):成对偏好和不成对偏好两种格式的样子,练习 2 的 KTO 格式照这里写。
- [Hugging Face 博客 · Illustrating RLHF](https://huggingface.co/blog/rlhf):图解 RLHF 三步,配图很清楚,20 分钟。
- [Hugging Face 博客 · Preference Tuning LLMs with Direct Preference Optimization Methods](https://huggingface.co/blog/pref-tuning):把 DPO、IPO、KTO 在同一批数据上对比的实验报告,看看变体之间的差别到底有多大。
- [KTO 论文](https://arxiv.org/abs/2402.01306)、[ORPO 论文](https://arxiv.org/abs/2403.07691)、[SimPO 论文](https://arxiv.org/abs/2405.14734)、[IPO 论文](https://arxiv.org/abs/2310.12036):四个变体,各读摘要和方法图。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HYBWBaEE3&autoplay=0&high_quality=1" title="20分钟带你快速弄懂SFT、RLHF、DPO!从定义到适用边界全流程解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI敲代码的阿Q · 20分钟带你快速弄懂SFT、RLHF、DPO!从定义到适用边界全流程解析 · 约 19 分钟,把三者的关系和各自适用的边界串起来,适合先看建立全景,对应今天「为什么要 A 比 B 好」和 RLHF 三步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14z1WYeEo3&autoplay=0&high_quality=1" title="DPO直接偏好优化算法(动画讲解)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>数源创域 · DPO直接偏好优化算法(动画讲解) · 约 21 分钟,用动画讲 DPO 损失的推导和直觉。看完再回头跑一遍 dpo_loss_toy.py,对照它说的「隐式奖励」。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/hvGa5Mba4c8" title="Direct Preference Optimization (DPO) explained: Bradley-Terry model, log probabilities, math" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Umar Jamil · Direct Preference Optimization (DPO) explained: Bradley-Terry model, log probabilities, math · 从 Bradley-Terry 一路推到 DPO 损失,今天两个玩具脚本背后的数学都在这里。英文,想把公式弄明白的看。</figcaption>
</figure>

### 书籍

- Nathan Lambert《Reinforcement Learning from Human Feedback》(Manning, 2026):RLHF 和后训练讲得最系统的一本,偏好数据、奖励模型、直接对齐算法(DPO)各有一章。纸书 2026 年出版,网页版 [rlhfbook.com](https://rlhfbook.com) 免费在线读。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024):第 12 章后半讲偏好微调和 DPO,有代码。中文版《图解大模型》。

### 开源项目与代码

- [huggingface/trl](https://github.com/huggingface/trl):DPO 的实现在 `trl/trainer/dpo_trainer.py`,找计算 `sigmoid` 损失的那几行,和今天的 `dpo` 函数对照。
- [huggingface/smol-course](https://github.com/huggingface/smol-course):Hugging Face 的免费小课,偏好对齐那一章有 DPO 和 ORPO 的练习笔记本。
- [trl-lib/ultrafeedback_binarized](https://huggingface.co/datasets/trl-lib/ultrafeedback_binarized):TRL 文档里用的公开偏好数据集,打开网页上的数据预览看看真实的偏好对长什么样。

## 自测

1. RLHF 第三步训练时显存里要放哪四个模型?DPO 为什么只需要两个?

<details><summary>答案</summary>

正在训练的模型、冻结的参考模型、奖励模型、PPO 的价值模型。DPO 把奖励写成「训练中模型的 logp 减参考模型的 logp,再乘 β」,奖励直接从这两个模型算出来,不需要单独的奖励模型;损失是一个普通的分类损失,不需要强化学习,也就不需要价值模型。用 LoRA 时,参考模型就是关掉 LoRA 的基座,连第二份权重都不用存。

</details>

2. 训练第 0 步,DPO 的 loss 是多少?为什么?

<details><summary>答案</summary>

约 0.693。第 0 步训练中的模型和参考模型一模一样,两个隐式奖励都是 0,margin 是 0,`-log sigmoid(0) = -log 0.5 ≈ 0.693`。明天的训练日志第一步如果不在这附近,要怀疑参考模型没设对。

</details>

3. DPO 训练一段时间后,好回答的 logp 反而下降了,loss 却一直在降。这正常吗?要注意什么?

<details><summary>答案</summary>

在一定范围内正常。DPO 只管 margin,好回答降、差回答降得更多,margin 照样变大、loss 照样降,`dpo_loss_toy.py` 第四行就是这种情况。要注意的是好回答的 logp 降得太多:模型连好回答都越来越不愿意写,输出可能变得奇怪。补救办法有调大 β、在损失里混一点 SFT 损失,明天会讲。

</details>

4. 你手里只有客服对草稿点「采纳 / 不采纳」的记录,该用 DPO 还是 KTO?

<details><summary>答案</summary>

KTO。点赞点踩是不成对的,一份草稿一个好坏标签,很多工单只有一份草稿,凑不出对。硬凑会浪费大部分数据,而且练习 2 演示过,同一份草稿的「好坏」在成对数据里是相对的,和绝对标签对不上。

</details>

5. (面试题)让你给客服 Agent 的回复做偏好优化,你从哪几个地方拿偏好数据?怎么保证数据质量?

<details><summary>答案</summary>

三个来源。一是工作台的修改记录,Agent 草稿是 rejected、客服发出的版本是 chosen,质量最高,用相似度过滤掉只改标点的和整个换话题的,中间那档人看。二是规则检查,同一张工单采样多份草稿,只差一条规则的两份成对,差别集中在那一条上,全自动。三是 LLM 评审,只把规则全过的草稿两两送审,交换位置评两次、一致才收。质量上:每对记录来源和原因,按来源统计长度比防长度偏差,控制每张工单的对数上限,judge 对要人抽查,用于采样的工单和评测集隔离。另外先判断问题该不该用 DPO 解决:一句话能写清的规矩先改提示词,DPO 留给语气、详略这种说不清但看得出的东西。

</details>

## 明天预告

Day 576 · DPO(二):用 TRL 跑一次,读指标,回归检查。今天造好了 `pairs.jsonl`,明天把它喂给 TRL 的 `DPOTrainer`:Colab 上用 LoRA 训 Qwen 的完整脚本,本机 CPU 上用一个 0.5B 的小模型真跑几十步,看 `rewards/margins`、`rewards/accuracies`、`logps/chosen` 这些指标在训练中怎么变,对上今天手算的那几行;训完再查模型有没有学到你不想要的东西,比如回复越写越短。
