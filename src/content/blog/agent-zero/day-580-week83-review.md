---
title: 'Day 580 · 第 83 周复习:进阶(Day 574–579)'
description: '这一周从把 LoRA 挂回 vLLM 做对比,走到 DPO、蒸馏打标、置信度路由和强化学习。今天把六天串成一张图,逐天一句话回顾,做一个只用本周知识的小项目:级联上线前的体检报告 route_report.py,一次打印阈值、test 区间、逐条配对、按类别的回退率和每月成本,再默写本周三个核心函数并跑通。'
pubDate: 2026-10-22
regime: none
tags: ['review', 'post-training', 'routing', 'python', 'agent-zero']
series: 'agent-zero'
day: 580
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 579](/blog/agent-zero/day-579-rl-1/) 我们换了一种学习信号:不给示范,只给分数。写了一个严格的分诊判分函数 `triage_reward`,这就是可验证奖励;手算了 GRPO 的组内优势,用 DeepSeek 给 16 张工单各采样 4 个回答,看到 `frac_reward_zero_std = 0.19`;最后用 numpy 写的 40 行 GRPO 把三张工单的正确率推到 0.95,却对「合作咨询」毫无办法,因为它的正确答案一次都没被采到过。

这一周六天看起来是六个不相干的话题:对比、DPO 两天、蒸馏两天、强化学习。其实它们是同一个问题的不同侧面:**手上有了一个能跑的小模型,怎么让它变好、怎么证明它变好了、怎么让它安全地接住线上流量**。今天把这条线理一遍,下周 Day 581 继续强化学习的第二部分。

## 今天要解决的问题

学完今天你应该能做到:

1. 不看文章,说出这一周六天各解决了什么问题,四种后训练方法(SFT、DPO、序列级蒸馏、强化学习)各吃什么数据、各在什么时候用。
2. 写出一个「级联上线前体检」脚本 `route_report.py`,只用本周学过的东西,在 dev 上按规则选阈值、在 test 上算 Wilson 区间、和只用大模型逐条配对、按类别看回退率、算每月成本,并给出能不能灰度的结论。
3. 默写本周三个核心函数:DPO 损失、字段置信度、GRPO 组内优势,跑出和文章一致的数字。

预计用时 3.5 小时(复习日可以长一点)。前置:[Day 574](/blog/agent-zero/day-574-finetune-3/) 到 [Day 579](/blog/agent-zero/day-579-rl-1/) 全部。今天不调 API,花费 0 元,不需要 GPU。用到的文件全是这一周建的:`part10/compare_models.py`(Day 574 的 `wilson`)、`part10/sweep.py`(Day 578)、`part10/data/` 下的 `small-dev.jsonl`、`small-test.jsonl`、`big-dev.jsonl`、`big-test.jsonl`(Day 578 实跑生成的)、`part10/dpo_loss_toy.py`(Day 575)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`recall_week83.py` 里的三个函数);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

<figure>
<svg viewBox="0 0 640 320" role="img" aria-label="第 83 周知识地图:怎么比、怎么训、怎么上线三条线">
<text x="20" y="24" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">怎么比:先能量出好坏</text>
<rect x="20" y="34" width="190" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="115" y="56" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">574 挂 LoRA + 对比</text>
<text x="115" y="74" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">逐条配对、Wilson 区间</text>
<text x="115" y="89" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">换说法的 tickets_hard</text>
<text x="20" y="128" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">怎么训:四种信号</text>
<rect x="20" y="138" width="140" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="160" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">575 DPO 数据</text>
<text x="90" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">A 比 B 好</text>
<text x="90" y="193" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">loss 起点 0.693</text>
<rect x="175" y="138" width="140" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="245" y="160" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">576 DPO 训练</text>
<text x="245" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">CPU 手写一遍</text>
<text x="245" y="193" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">回复长了 31%</text>
<rect x="330" y="138" width="140" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="400" y="160" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">577 蒸馏打标</text>
<text x="400" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">三票一致</text>
<text x="400" y="193" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">老师一致地错</text>
<rect x="485" y="138" width="140" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="555" y="160" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">579 RLVR/GRPO</text>
<text x="555" y="178" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">程序打分</text>
<text x="555" y="193" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">组内比较</text>
<text x="20" y="232" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">怎么上线:接住流量</text>
<rect x="330" y="242" width="295" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="477" y="264" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">578 置信度 + 阈值曲线</text>
<text x="477" y="282" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">dev 选 0.85,test 29/30</text>
<text x="477" y="297" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">每千张 1.96 元 → 1.46 元</text>
<g stroke="var(--rule)" stroke-width="1.5" fill="none">
<path d="M 115 98 L 115 138"/>
<path d="M 210 66 C 300 66, 400 100, 400 138"/>
<path d="M 400 202 L 400 242"/>
<path d="M 210 82 C 260 120, 250 230, 330 270"/>
<path d="M 160 170 L 175 170"/>
<path d="M 470 170 L 485 170"/>
</g>
<text x="250" y="112" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">每种训法都要回来比一次</text>
<text x="408" y="226" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">学生训好才谈路由</text>
</svg>
<figcaption>蓝色的四块都是「怎么训」,区别在学习信号:575/576 是偏好,577 是老师的标签,579 是程序打的分。琥珀色的两块是「怎么量」和「怎么上线」,训练前后都要回到 574 的对比方法,上线靠 578 的级联兜底。</figcaption>
</figure>

这一周四种训法的区别,用一张表看最清楚:

| 方法 | 吃什么数据 | 学习信号 | 上限 | 本周在哪 |
| --- | --- | --- | --- | --- |
| SFT | 标准答案 | 一个 token 一个 token 地模仿 | 示范的质量 | 上周 Day 572,本周 574 挂上去比 |
| DPO | 一对回答,哪份更好 | 拉开好坏两份的 logp 差 | 偏好数据的质量 | 575 造数据、576 训练 |
| 序列级蒸馏 | 老师打的标签 | 本质上还是 SFT | 老师的水平,含老师的系统性错误 | 577 |
| 强化学习(RLVR) | 只要一个打分程序 | 自己写、拿分数、组内比较 | 有机会超过示范,但学不会从没做对的事 | 579 |

## 每天一句话

- [Day 574 · 微调(四):挂到 vLLM 上和原版对比](/blog/agent-zero/day-574-finetune-3/):LoRA 有两种上线方式(运行时挂载、合并成完整模型),对比要在同一份评测集上逐条配对;顺带发现 Day 570 的 `tickets_v1` 和训练集出自同一套模板,背住模板就能满分,于是手写了换了说法的 `tickets_hard`。
- [Day 575 · DPO(一):从 RLHF 到 DPO,变体,偏好数据从哪来](/blog/agent-zero/day-575-dpo-1/):DPO 把 RLHF 的奖励模型和 PPO 省掉,损失是 `-log sigmoid(margin)`,第 0 步一定是 0.693;用规则和交换位置的 judge 造了 15 对偏好数据,抓到了长度偏差和 judge 判错。
- [Day 576 · DPO(二):用 TRL 跑一次,读指标,回归检查](/blog/agent-zero/day-576-dpo-2/):Intel Mac 装不上新版 TRL,就在 CPU 上手写一遍 DPO 训练循环,真训了 0.5B 模型;按对随机切验证集会泄漏(验证集 loss 0.283 比训练集还好);回归检查发现回复平均长了 31%。
- [Day 577 · 蒸馏(一):三种蒸馏,规模化打标,学生选多大](/blog/agent-zero/day-577-distill-1/):调 API 的团队基本只能做序列级蒸馏;老师三票一致才收,但三票一致的 21 张里错了 7 张,自一致性挡不住系统性错误,要拿有标准答案的样本给老师打分。
- [Day 578 · 蒸馏(二):置信度和阈值曲线,其他路由方式](/blog/agent-zero/day-578-distill-2/):字段值几个 token 的 logprob 相加再取 exp 就是置信度;扫阈值画出先陡后平的曲线;校准表显示最自信的那一桶反而不是最准的;dev 上按规则选出 0.85,test 上 29/30、每千张从 1.96 元降到 1.46 元。
- [Day 579 · 强化学习(一):模仿和试错,RLVR 和 GRPO](/blog/agent-zero/day-579-rl-1/):强化学习只要一个打分程序;GRPO 用组内平均当基准、省掉价值模型,组内全同时优势全 0;它能把「偶尔对」变成「经常对」,教不会「从没对过」。

这六天里有两条线索反复出现。一条是**泄漏和自欺**:574 的评测集和训练集同模板,576 按对切验证集,577 用改口径的那 30 张再给老师打分,578 必须在 dev 上选阈值、test 上只跑一次。每一次都是「拿看过的东西考自己」。另一条是**模型很确定,不代表它对**:577 老师三票一致地错,578 替身以 0.996 的置信度判错、flash 四个字段都 0.99 以上的 12 张一张没全对,579 里 D002、D004、D009 四份回答稳定地错同一个字段。这两条记住了,下周做强化学习的奖励设计时你会反复用到。

## 小项目:级联上线前体检 route_report.py

### 要做什么

假设 Day 578 的级联要拿去给主管看,问题只有一个:能不能先给 10% 的流量灰度?回答这个问题要的东西这一周都学过,散在四五个脚本里:按事先写好的规则在 dev 上选阈值(578);在 test 上只跑一次,并且报区间而不是一个点(574 的 `wilson`);和「只用大模型」逐条配对,看有没有哪张原本对的被级联弄错了(574 的 `paired_diff.py`);按类别看回退率,知道省的钱从哪来(574 的 `per_category.py`);按每天的量算每月花多少钱(577 的 `label_cost.py`)。今天把它们拼成一个脚本,最后一行给结论。

只用 category 判对错,和 Day 578 正文一致。新建 `part10/route_report.py`:

```python
# agent-zero-lab/part10/route_report.py
"""级联上线前的体检报告,只用第 83 周学过的东西:
dev 上按规则选阈值(Day 578)→ test 上只跑一次 → Wilson 区间(Day 574)→ 和只用大模型逐条配对(Day 574)
→ 按类别看回退率(Day 574 的按类别拆)→ 每月成本(Day 577 的算钱)→ 给结论。
用法:uv run python part10/route_report.py [容忍线,默认 0.02] [每天工单数,默认 10000]
"""
import sys
from collections import Counter

from compare_models import wilson
from sweep import DATA, SMALL_COST, load, sweep, view

TOL = float(sys.argv[1]) if len(sys.argv) > 1 else 0.02
PER_DAY = int(sys.argv[2]) if len(sys.argv) > 2 else 10000
GRID = [i / 20 for i in range(20)] + [0.97, 0.99, 1.01]

# 1. dev 上按规则选阈值
dev = view(load(DATA / "small-dev.jsonl"), load(DATA / "big-dev.jsonl"), "category")
dev_big = sum(b for _, _, b, _ in dev) / len(dev)
ok = [r for r in sweep(dev, GRID) if r["acc"] >= dev_big - TOL]
t = min(ok, key=lambda r: (r["cost_1k"], -r["t"]))["t"]

# 2. test 上逐条算出级联的最终答案对不对
small, big = load(DATA / "small-test.jsonl"), load(DATA / "big-test.jsonl")
routed = {}
for i, s in small.items():
    use_small = s["conf"]["category"] >= t
    routed[i] = (s["fields"]["category"] if use_small else big[i]["fields"]["category"], use_small)
n = len(routed)
k_route = sum(ok for ok, _ in routed.values())
k_big = sum(big[i]["fields"]["category"] for i in routed)
lo, hi = wilson(k_route, n)
blo, bhi = wilson(k_big, n)
print(f"容忍线 {TOL:.0%},dev 选出阈值 {t:.2f}")
print(f"test 级联  {k_route}/{n}  区间 [{lo:.0%}, {hi:.0%}]")
print(f"test 大模型 {k_big}/{n}  区间 [{blo:.0%}, {bhi:.0%}]")

# 3. 逐条配对:级联和只用大模型,谁在哪几张上不一样
pair = Counter((routed[i][0], bool(big[i]["fields"]["category"])) for i in routed)
print(f"配对  都对 {pair[(True, True)]}  只有级联对 {pair[(True, False)]}  "
      f"只有大模型对 {pair[(False, True)]}  都错 {pair[(False, False)]}")

# 4. 按标准答案的类别看回退率
cats: dict[str, list[bool]] = {}
for i, s in small.items():
    cats.setdefault(s["expected"]["category"], []).append(not routed[i][1])
print("类别 回退/张数: " + "  ".join(f"{c} {sum(v)}/{len(v)}" for c, v in sorted(cats.items())))

# 5. 每月成本
r = sweep(view(small, big, "category"), [t])[0]
big_1k = 1000 * sum(b["cost"] for b in big.values()) / n
month = PER_DAY * 30 / 1000
print(f"每月({PER_DAY} 张/天)  级联 ¥{r['cost_1k'] * month:.0f}  只用大模型 ¥{big_1k * month:.0f}  "
      f"小模型按每张 ¥{SMALL_COST} 估")

# 6. 结论
verdict = "可以灰度" if pair[(False, True)] == 0 and r["cost_1k"] < big_1k else "先别上"
print(f"结论:{verdict}(test 只有 {n} 张,区间宽 {hi - lo:.0%},上线前把 test 扩到上百张)")
```

<div class="line-notes">

- `from compare_models import wilson` Day 574 的 Wilson 区间函数。导入 `compare_models.py` 会读 `.env` 建 client,但不会发请求,所以今天不花钱。
- `from sweep import DATA, SMALL_COST, load, sweep, view` Day 578 的四件套:数据目录、小模型的假设成本、读结果文件、扫阈值、把两份文件压成四列的表。
- `TOL = float(sys.argv[1]) if len(sys.argv) > 1 else 0.02` 容忍线可以从命令行传,默认 2 个百分点,和 Day 578 的 `pick_threshold.py` 一样。练习 2 会改成 20% 看看会发生什么。
- `PER_DAY = int(sys.argv[2]) if len(sys.argv) > 2 else 10000` 每天多少张工单,用来算每月成本。
- `ok = [r for r in sweep(dev, GRID) if r["acc"] >= dev_big - TOL]` 第一段就是 `pick_threshold.py` 的 `pick`,只是没包成函数。dev 上大模型 0.96,达标线 0.94。
- `t = min(ok, key=lambda r: (r["cost_1k"], -r["t"]))["t"]` 达标的阈值里最便宜的,今天是 0.85。
- `use_small = s["conf"]["category"] >= t` 和 `sweep.py`、`router.py` 同一条判断。
- `routed[i] = (s["fields"]["category"] if use_small else big[i]["fields"]["category"], use_small)` 每张存两样:级联最后对不对、是不是小模型接的。`sweep` 只给汇总数字,配对和按类别看需要逐条的结果,所以这里自己再算一遍。
- `k_route = sum(ok for ok, _ in routed.values())` 级联在 test 上对了几张。注意这里的 `ok` 是循环变量,和上面那个列表 `ok` 重名,Python 的推导式有自己的作用域,不会覆盖外面的列表,但读起来容易混,你自己写时可以换个名字。
- `lo, hi = wilson(k_route, n)` 29/30 的 Wilson 区间。只报 96.7% 一个数会让人以为很准,区间告诉你 30 张能说明的范围有多大。
- `pair = Counter((routed[i][0], bool(big[i]["fields"]["category"])) for i in routed)` 每张变成(级联对不对, 大模型对不对)一对布尔值,数四种组合各几张。和 Day 574 `paired_diff.py` 的 `tally` 是同一个写法。
- `print(f"配对  都对 {pair[(True, True)]}  只有级联对 {pair[(True, False)]}  "` 最要紧的是「只有大模型对」:这些是级联让本来对的变成了错的,每一张都要能解释。
- `cats.setdefault(s["expected"]["category"], []).append(not routed[i][1])` 按标准答案的类别分组,记每张有没有回退。`setdefault` 是「没有这个键就先放一个空列表」,效果和 Day 578 用的 `defaultdict(list)` 一样。
- `r = sweep(view(small, big, "category"), [t])[0]` test 上这个阈值的成本,复用 `sweep`,保证和 Day 578 的算法一致。
- `big_1k = 1000 * sum(b["cost"] for b in big.values()) / n` 只用大模型每千张多少钱,来自 `big_run.py` 记下的真实花费。
- `month = PER_DAY * 30 / 1000` 每月多少个「千张」。
- `verdict = "可以灰度" if pair[(False, True)] == 0 and r["cost_1k"] < big_1k else "先别上"` 两个条件:没有一张被级联弄错,而且确实省钱。这是一个很粗的规则,真实项目里你和主管会一起定,但一定要写成代码,不要每次凭感觉。

</div>

```bash
cd agent-zero-lab
uv run python part10/route_report.py
```

```text
容忍线 2%,dev 选出阈值 0.85
test 级联  29/30  区间 [83%, 99%]
test 大模型 29/30  区间 [83%, 99%]
配对  都对 29  只有级联对 0  只有大模型对 0  都错 1
类别 回退/张数: account 0/2  billing 9/9  invoice 0/4  other 0/1  plan_change 2/2  refund 0/4  technical 8/8
每月(10000 张/天)  级联 ¥437  只用大模型 ¥587  小模型按每张 ¥0.0002 估
结论:可以灰度(test 只有 30 张,区间宽 16%,上线前把 test 扩到上百张)
```

### 读输出

阈值 0.85 和 Day 578 的 `pick_threshold.py` 一致。test 上级联和大模型都是 29/30,区间都是 [83%, 99%]:30 张能说的就是「真实准确率大概在八成三到九成九之间」,不能说更多。

配对那一行比总分重要:「只有大模型对」是 0,级联没有弄错任何一张大模型本来能答对的工单;「都错」的 1 张是 T017,又是「有没有发票模板」:替身以 0.996 的置信度判成 invoice 自己接了,大模型也判 invoice,标准答案是 other。Day 578 说过,这一类的口径本身值得商量,两边都错说明该回头改的是口径或标签,不是路由。

按类别那一行告诉你钱是从哪省下来的:billing 9/9、technical 8/8、plan_change 2/2 全部回退,一分钱没省;省钱全靠 account、invoice、refund、other 这几类,替身在这几类上又准又自信。这里有一个值得警惕的地方:**refund 0/4 回退**,4 张退款工单全由替身接了。它们今天都判对了,但退款错了要赔钱,Day 578 的 `router.py` 里写了 `ALWAYS_BIG = {"refund"}` 就是为这个,而这份报告的离线模拟里没有这条规则。练习 3 会把它加上,看看要多花多少。

每月成本:一天一万张,级联每月 437 元,只用大模型 587 元,省 150 元左右。这个数里有一个假设(小模型每张 0.0002 元),Day 578 练习 3 算过,小模型贵到每张 0.00063 元以上,这个级联就不省钱了。拿给主管看的时候,这个假设要写在报告里。

结论是「可以灰度」,但括号里那句话比结论本身重要:区间宽 16 个百分点,30 张的 test 只够证明方法能用。

### 零件和大代码的对照

| 零件 | 在哪学的 | 今天的位置 |
| --- | --- | --- |
| 按事先写好的规则选阈值 | Day 578 `pick_threshold.py` | 第 1 段 |
| test 只跑一次 | Day 578、Day 354 | 第 2 段只用选出的 `t` |
| Wilson 区间 | Day 574 `compare_models.py` | `wilson(k_route, n)` |
| 逐条配对 | Day 574 `paired_diff.py` | 第 3 段 `Counter` |
| 按类别拆开看 | Day 574 `per_category.py` | 第 4 段 |
| 扫阈值、成本算法 | Day 578 `sweep.py` | `sweep(...)` |
| 按量算钱 | Day 577 `label_cost.py` | 第 5 段 |

## 本周错题与坑清单

和上周一样,按「会不会报错」分两类。这一周会报错的坑不多,大部分是不报错、数字却骗了你。

会报错的:

- **Intel Mac 装新版 TRL**:`error: Distribution torch==2.14.1 ... doesn't have a source distribution or wheel for the current platform`。torch 最后一个有 Intel Mac 安装包的版本是 2.2.2,要单独建 `part10/dpo-cpu/` 并钉住 `numpy<2`、`transformers<5`(Day 576)。
- **vLLM 挂 r=32 的适配器**:`--max-lora-rank` 默认 16,要显式写成和训练时一样(Day 574)。
- **DeepSeek 不支持 `n`**:`Invalid n value (currently only n = 1 is supported)`,一组回答要发 G 次请求(Day 579)。
- **dpo-cpu 环境里导入了会读 `.env` 的模块**:`ModuleNotFoundError: No module named 'dotenv'`,要么在那个环境里 `uv add python-dotenv`,要么别导入带副作用的模块(Day 578)。

不报错的:

- **评测集和训练集同模板**:指纹查不出,背模板就能满分(Day 574)。
- **12 条评测集上差一条就下结论**:Wilson 区间宽 40 个百分点(Day 574)。
- **偏好对的长度偏差**:总的「好回答更长」40% 看着平衡,按来源拆开才看出两种偏差互相抵消(Day 575)。
- **judge 只评一次**:6 对里 4 对两次结论不一致(Day 575)。
- **思考模式下的空输出被兜底吞掉**:`or "T"` 让 6 对全丢也不报错(Day 575)。
- **按对随机切验证集**:验证集 loss 0.283 比训练集好,全是泄漏(Day 576)。
- **只看 loss 不看 `rewards/chosen`**:margin 在涨,好回答的奖励却一路往下掉(Day 576)。
- **DPO 后回复变长**:平均长了 31%,违规还多了(Day 576)。
- **老师三票一致地错**:「被重复扣款了」的 `needs_human` 4 次一致地错,口径没写清(Day 577)。
- **扔掉分歧样本**:收下的 23 张里一张 invoice 都没有(Day 577)。
- **用 API 拿置信度开着温度 0**:DeepSeek 的 logprob 全是 0.0,置信度全是 1.0(Day 578)。
- **校准表不单调**:替身最自信的一桶只对 71%,flash 四个字段都 0.99 以上的 12 张一张没全对(Day 578)。
- **全部回退比只用大模型贵**:多付了每张小模型的钱(Day 578)。
- **组内全同,优势全 0**:`frac_reward_zero_std` 一半的采样可能是白花的(Day 579)。
- **采样只跑一次**:同一条命令一次 0.38、一次 0.19(Day 579)。

这张清单本身就是复习材料:合上文章,每一条说出「是什么现象、为什么、怎么修」。说不出的回到那一天重看。

## 动手练习

1. **默写本周三个函数**:合上文章,新建 `part10/recall_week83.py`,写出 `dpo_loss(pol_chosen, pol_rejected, ref_chosen, ref_rejected, beta=0.1)`、`field_confidence(tokens, logprobs, start, end)`(值在整段文字里的起止下标已经给出)、`advantages(rewards)`。验证:DPO 第 0 步是 0.693、「差回答 logp 降 10」是 0.313(和 Day 575 的 `dpo_loss_toy.py` 对上);`plan_change` 那组 logprob 的置信度是 0.497;`[1.0, 0.5, 1.0, 0.0]` 的优势是 `[0.9, -0.3, 0.9, -1.51]`,全对的组优势全 0。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/recall_week83.py
"""第 83 周默写:DPO 损失(Day 575)、字段置信度(Day 578)、GRPO 组内优势(Day 579)。
合上文章写完这三个函数,跑通下面的检查。
用法:uv run python part10/recall_week83.py
"""
import math
import statistics


def dpo_loss(pol_chosen: float, pol_rejected: float, ref_chosen: float, ref_rejected: float,
             beta: float = 0.1) -> float:
    margin = beta * (pol_chosen - ref_chosen) - beta * (pol_rejected - ref_rejected)
    return -math.log(1 / (1 + math.exp(-margin)))


def field_confidence(tokens: list[str], logprobs: list[float], start: int, end: int) -> float:
    pos, total = 0, 0.0
    for tok, lp in zip(tokens, logprobs):
        if pos + len(tok) > start and pos < end:
            total += lp
        pos += len(tok)
    return math.exp(total)


def advantages(rewards: list[float]) -> list[float]:
    mean, std = statistics.mean(rewards), statistics.pstdev(rewards)
    return [(r - mean) / (std + 1e-4) for r in rewards]


if __name__ == "__main__":
    print("DPO 第 0 步:", round(dpo_loss(-42, -40, -42, -40), 3))
    print("DPO 差回答降 10:", round(dpo_loss(-42, -50, -42, -40), 3))
    toks = ['{"', 'category', '":', ' "', 'plan', '_change', '",']
    text = "".join(toks)
    s = text.index("plan_change")
    print("置信度:", round(field_confidence(toks, [0, 0, 0, 0, -0.69, -0.01, 0], s, s + len("plan_change")), 3))
    print("优势:", [round(a, 2) for a in advantages([1.0, 0.5, 1.0, 0.0])])
    print("全对的组:", advantages([1.0, 1.0, 1.0, 1.0]))
```

<div class="line-notes">

- `margin = beta * (pol_chosen - ref_chosen) - beta * (pol_rejected - ref_rejected)` Day 575 的隐式奖励:训练中的模型比参考模型多给了多少 logp,乘 β。好回答的减去差回答的就是 margin。第 0 步训练中的模型就是参考模型,两项都是 0,margin 是 0。
- `return -math.log(1 / (1 + math.exp(-margin)))` `-log sigmoid(margin)`。margin 为 0 时 sigmoid 是 0.5,−log 0.5 = 0.693。差回答 logp 从 −40 降到 −50 时,margin = 0.1 × 0 − 0.1 × (−10) = 1.0,loss = −log sigmoid(1) ≈ 0.313。
- `def field_confidence(tokens: list[str], logprobs: list[float], start: int, end: int) -> float:` 比 Day 578 的版本少了正则那一步,直接给起止下标,默写时只关心「区间重叠的 token 的 logprob 相加」这个核心。
- `if pos + len(tok) > start and pos < end:` 区间重叠的判断,`pos` 是这个 token 的起点,`pos + len(tok)` 是终点。
- `pos += len(tok)` 每个 token 处理完,起点往后挪它的长度。
- `return [(r - mean) / (std + 1e-4) for r in rewards]` Day 579 的组内优势。分母的 `1e-4` 让全对的组不会除以 0。
- `s = text.index("plan_change")` 在拼起来的文字里找到值的起点,`index` 相当于 JS 的 `indexOf`,找不到会抛错而不是返回 −1。

</div>

```bash
uv run python part10/recall_week83.py
```

```text
DPO 第 0 步: 0.693
DPO 差回答降 10: 0.313
置信度: 0.497
优势: [0.9, -0.3, 0.9, -1.51]
全对的组: [0.0, 0.0, 0.0, 0.0]
```

五个数和 Day 575、578、579 的输出都对得上。如果你的 DPO 是 0.693 但第二个不是 0.313,多半是 margin 里两项的减号写反了;置信度如果是 1.0,说明一个 token 都没加进去(exp(0) = 1),多半是区间重叠的两个条件写反了一个。

</details>

2. **容忍线放宽到 20%**:跑 `uv run python part10/route_report.py 0.2`,阈值、test 结果、配对和成本各变成什么?结论为什么变了?

<details><summary>参考答案</summary>

```bash
uv run python part10/route_report.py 0.2
```

```text
容忍线 20%,dev 选出阈值 0.70
test 级联  23/30  区间 [59%, 88%]
test 大模型 29/30  区间 [83%, 99%]
配对  都对 23  只有级联对 0  只有大模型对 6  都错 1
类别 回退/张数: account 0/2  billing 6/9  invoice 0/4  other 0/1  plan_change 2/2  refund 0/4  technical 5/8
每月(10000 张/天)  级联 ¥318  只用大模型 ¥587  小模型按每张 ¥0.0002 估
结论:先别上(test 只有 30 张,区间宽 29%,上线前把 test 扩到上百张)
```

容忍线放宽,规则就挑了更便宜的 0.70。每月成本从 437 元降到 318 元,但 test 上掉到 23/30,「只有大模型对」变成 6 张:billing 少回退了 3 张、technical 少回退了 3 张,正是替身判 invoice、置信度在 0.7 到 0.85 之间的那些。区间 [59%, 88%] 和大模型的 [83%, 99%] 几乎不重叠了。

一个月省下的 119 元,换来的是每 30 张多错 6 张,一天一万张就是两千张左右分错队列。这种取舍应该由业务方来定,而且要**在看数据之前**定。容忍线 20% 这种数,只有在你事先写下来、又解释得出为什么能接受时才有意义。

</details>

3. **把 refund 规则加进离线模拟**:Day 578 的 `router.py` 里有 `ALWAYS_BIG = {"refund"}`,`route_report.py` 没有。在 test 上比一下阈值 0.85 单独用和加上这条规则,准确率和成本各是多少。

<details><summary>参考答案</summary>

新建 `part10/refund_rule_cost.py`:

```python
# agent-zero-lab/part10/refund_rule_cost.py
"""在 test 上比较:阈值 0.85 单独用,和再加一条「小模型说 refund 就交给大模型」,准确率和成本差多少。"""
from sweep import DATA, SMALL_COST, load

small, big = load(DATA / "small-test.jsonl"), load(DATA / "big-test.jsonl")
T = 0.85
for name, force in (("只用阈值", set()), ("阈值 + refund 规则", {"refund"})):
    correct = cost = fallback = 0.0
    for i, s in small.items():
        cost += SMALL_COST
        if s["pred"].get("category") not in force and s["conf"]["category"] >= T:
            correct += s["fields"]["category"]
        else:
            fallback += 1
            correct += big[i]["fields"]["category"]
            cost += big[i]["cost"]
    n = len(small)
    print(f"{name:<14} 准确率 {correct / n:.3f}  元/千张 {1000 * cost / n:.2f}  回退率 {fallback / n:.0%}")
```

<div class="line-notes">

- `T = 0.85` 用 dev 上选出来的阈值,不在 test 上重新选。
- `for name, force in (("只用阈值", set()), ("阈值 + refund 规则", {"refund"})):` 两种配置放在一个元组里循环。`set()` 是空集合(`{}` 在 Python 里是空字典,不是空集合)。
- `if s["pred"].get("category") not in force and s["conf"]["category"] >= T:` 和 `router.py` 的 `decide` 是同一个逻辑:被规则点名的类别直接回退,其余看置信度。

</div>

```bash
uv run python part10/refund_rule_cost.py
```

```text
只用阈值           准确率 0.967  元/千张 1.46  回退率 63%
阈值 + refund 规则 准确率 0.967  元/千张 1.72  回退率 77%
```

加了规则,准确率不变(那 4 张退款替身本来就判对了),每千张从 1.46 元涨到 1.72 元,回退率 63% 到 77%,一天一万张每月多花约 78 元(0.26 × 10 × 30)。

这 78 元买的是什么?今天 test 上什么都没买到,4 张退款都是对的。它买的是「万一替身哪天把一张该退款的判错了」的保险。refund 错一张的代价(客户投诉、人工返工、可能的赔偿)如果比一个月 78 元高,这条规则就值得留。这种账没法只靠评测集算,要问业务方「一张退款工单分错,代价大概多少」。这也是为什么规则路由和置信度级联通常一起用:置信度管「有没有把握」,规则管「错了赔不赔得起」。

</details>

4. **选方法**(开放题):下面五个场景,各该用这一周的哪种方法(SFT、DPO、序列级蒸馏、置信度级联、强化学习),或者都不用?说出理由。
   - A. 客服回复「太啰嗦」,但没人能写出标准答案,主管只能说「这份比那份好」。
   - B. 线上每天一万张工单在调 V4 Pro 分诊,账单太贵,手上没有人工标签。
   - C. 学生训好了,大部分工单它都对,但偶尔在新类型工单上翻车。
   - D. Agent 要连调三个工具算出应退金额,金额能和账单系统核对,但没人写得出每一步该调什么。
   - E. 分诊的 `urgency` 字段老是错,一查发现是口径说明里没写清「看不懂账单」算什么。

<details><summary>参考答案</summary>

一个示范解法:

| 场景 | 选什么 | 理由 |
| --- | --- | --- |
| A | DPO | 没有标准答案,只有偏好,正是 Day 575 的场景。注意 Day 576 的教训:回复会变长,要做回归检查;偏好对的草稿要让被训练的模型自己采样。 |
| B | 序列级蒸馏 | 让 V4 Pro 当老师打标,三票一致收、分歧送人工,先拿一两百张人工标好的样本给老师打分,再训学生(Day 577)。 |
| C | 置信度级联(加规则) | 学生已经够好,问题是「知道自己什么时候不行」。扫阈值、看校准表,高风险类别加规则;新类型工单打标后补进训练数据(Day 578)。 |
| D | 强化学习(RLVR) | 结果能用程序核对,过程示范不出来,正是 Day 579 说的强化学习占优的场景。前提是模型现在「有时能算对」,否则先 SFT 打底。 |
| E | 都不用,先改口径 | 这是系统性错误,Day 577 里改一句口径说明比换方法有效得多。改完口径,老师重新打标、学生重训,训练方法不用换。 |

E 是最容易被忽略的一类。这一周反复看到,很多看起来是「模型不行」的问题,其实是口径没写清,换更贵的训练方法只会把错误学得更牢。我自己在实跑里也是这样:Day 577 从 v1 口径改到 v2,三票一致的准确率从 14/21 到 19/23,比把老师从 flash 换成 pro 带来的提升大得多。

</details>

验收标准:`route_report.py` 默认参数的 7 行输出和本文一致(它只读 Day 578 存下的结果文件,不调 API,应该一字不差);你能指着输出说出钱是从哪几类省下来的,以及为什么 refund 0/4 回退值得警惕;`recall_week83.py` 合上文章写出来,5 个数全对;练习 4 的五个场景都能说出理由。今天不调 API,花费 0 元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 后训练(post-training) | 预训练之后对模型做的训练的统称,本周的 SFT、DPO、蒸馏、强化学习都属于这一类 |
| 灰度 | 新方案先只接一小部分流量(比如 10%),没问题再逐步放大 |
| 体检报告 | 本周小项目的说法:上线前把选阈值、区间、配对、按类别、成本放在一张报告里 |
| 盈亏平衡点 | 级联刚好不省钱也不亏钱的小模型单价,公式是 `(1 − 回退率) × 大模型单价` |
| 系统性错误 | 模型每次都按同一个错误理解来答,投票、置信度、GRPO 组内比较都发现不了,复习一下 Day 577 |

这一周第一次出现的其他术语(DPO、隐式奖励、偏好对、序列级蒸馏、自一致性、置信度、校准、回退率、RLVR、GRPO、优势、`frac_reward_zero_std` 等)都在各自那天的名词解释里,复习时回去对照。

## 常见误区

**以为四种训法是互相替代的。** 它们吃的数据不同:有标准答案用 SFT,只有偏好用 DPO,没有标签但有强老师用蒸馏,结果能用程序判用强化学习。一个项目里经常先 SFT 打底,再 DPO 或强化学习,最后用级联兜底上线。

**训练完只看训练日志。** Day 576 的 margin 很好看,回复却长了 31%;Day 579 的玩具后期 `frac_reward_zero_std` 升高是因为学会了。每一种训法训完都要回到 Day 574 的方法,在出处隔离的评测集上逐条配对。

**只报一个准确率。** 29/30 听起来是 96.7%,区间是 [83%, 99%]。给别人看的报告里一定带区间和样本数。

**把报告的结论当成决定。** `route_report.py` 最后一行的「可以灰度」是按两个很粗的条件写的。refund 0/4 回退这种事,规则里没写,就要靠人读输出时发现。

**口径问题当成模型问题。** 练习 4 的场景 E:改一句口径说明,比换训练方法有效。先查口径,再谈训练。

**拿看过的数据考自己。** 本周四次:同模板的评测集、按对切的验证集、改完口径用同一批样本打分、看着曲线挑阈值。每次都要问一句:这份数据我之前有没有用来做过决定?

## 学习资料

### 文档与文章

- [Hugging Face LLM Course · Open R1 for Students](https://huggingface.co/learn/llm-course/chapter12/1):官方课程里讲推理模型、GRPO 和后训练的一章,适合当本周的总复习,和 Day 579 对照着看。
- [RLHF Book](https://rlhfbook.com/):Nathan Lambert 写的在线免费书,把 RLHF、DPO、RLVR、GRPO 放在同一个框架里讲,本周四种训法的关系在这里能看得更完整。挑「Direct Alignment」和「Reinforcement Learning」相关章节读。
- [TRL 文档](https://huggingface.co/docs/trl/main/en/index):SFT、DPO、GRPO、蒸馏的 Trainer 都在这里,下周 Day 581 写 GRPO 训练脚本时会用到,今天先浏览目录,知道每个 Trainer 吃什么格式的数据。
- [On Calibration of Modern Neural Networks](https://arxiv.org/abs/1706.04599):Day 578 校准表的理论来源,复习时读第 2 节的 reliability diagram。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1HYBWBaEE3&autoplay=0&high_quality=1" title="20分钟带你快速弄懂SFT、RLHF、DPO!从定义到适用边界全流程解析" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI敲代码的阿Q · 20分钟带你快速弄懂SFT、RLHF、DPO!从定义到适用边界全流程解析 · 约 19 分钟,把 SFT、RLHF、DPO 放在一起比,看完再对照今天那张四种训法的表。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1enQLYKEA5&autoplay=0&high_quality=1" title="DeepSeek-GRPO" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>RethinkFun · DeepSeek-GRPO · 约 18 分钟,从 PPO 讲到 GRPO 为什么不需要价值模型,复习 Day 579 时看,公式部分对照 `grpo_by_hand.py` 的输出。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/o6l6tJQgUg4" title="Post-Training and RLHF Overview | Post-Training Book Course, Lecture 1" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Nathan Lambert · Post-Training and RLHF Overview | Post-Training Book Course, Lecture 1 · 《RLHF Book》作者讲后训练全景,英文,把本周的 SFT、偏好优化、强化学习放在一条时间线上。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 7 章讲微调(什么时候该微调、各种方法的取舍),第 10 章讲路由和网关,正好对应本周「怎么训」和「怎么上线」两条线。
- Nathan Lambert《RLHF Book》:在线免费,见上面的链接。本周看完再读一遍它讲 DPO 和 RLVR 的章节,会比第一次读顺很多。

### 开源项目与代码

- [huggingface/trl](https://github.com/huggingface/trl):`trl/trainer/` 下的 `sft_trainer.py`、`dpo_trainer.py`、`grpo_trainer.py` 并排看,比较三个 Trainer 的输入数据格式,就是今天那张表的代码版。
- [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM):Day 578 说的学出来的路由器,README 里的评测方式和今天的 `route_report.py` 思路一样:在固定的评测集上看「多少比例交给强模型」和「质量掉多少」。

## 自测

1. 这一周的四种训法里,哪一种学到的东西可能超过示范?代价是什么?

<details><summary>答案</summary>

强化学习。它不需要示范,只要一个打分程序,模型自己试、按分数调整,能找到示范里没有的做法。代价是信号稀疏、要大量采样(GRPO 每道题一组 G 个回答),而且只能把「偶尔做对」变成「经常做对」,模型从没做对过的事它教不会,所以通常先 SFT 打底。

</details>

2. `route_report.py` 里,为什么「只有大模型对」这个数比总准确率更重要?

<details><summary>答案</summary>

总准确率一样,不代表在同一批工单上对。「只有大模型对」是级联把本来能答对的工单弄错了的数量,每一张都是上线后会真实发生的退化。今天两边都是 29/30,配对显示错的是同一张,级联没有引入新的错误;容忍线放到 20% 时,这个数变成 6,哪怕成本降了也不该上。

</details>

3. Day 576 的 DPO 和 Day 579 的 GRPO 都有一个叫 `beta` 的参数,它们管的是同一件事吗?

<details><summary>答案</summary>

都和「别离参考模型太远」有关,但用法不同。DPO 的 β 在损失函数里,控制隐式奖励的尺度:β 越大,模型越不敢偏离参考模型。GRPO 的 `beta` 是 KL 惩罚项的系数,TRL 1.16 里默认 0,也就是默认不加 KL、不加载参考模型。名字一样,别混着调。

</details>

4. 一位同事说:「老师三票一致的标签,训出来的学生置信度又高,上线肯定没问题。」这句话错在哪?

<details><summary>答案</summary>

两处都是「确定不等于对」。Day 577:三票一致的 21 张里错了 7 张,口径没写清时老师会一致地错。Day 578:置信度量的是模型和自己的一致程度,替身 0.99 以上那桶只对 71%,flash 四个字段都 0.99 以上的 12 张一张没全对。要用有标准答案的样本给老师打分、用校准表检查置信度,再决定能不能信。

</details>

5. (面试题)你要向技术负责人汇报「用蒸馏出来的小模型替换线上分诊的大模型 API」,报告里必须有哪几样东西?

<details><summary>答案</summary>

数据:老师是谁、口径说明的版本、老师在有标准答案的样本上的准确率、分歧样本怎么处理、训练集和评测集出处隔离的证据。学生:候选尺寸的对比(准确率、JSON 合法率、延迟、按卡费折算的成本),在换了说法的评测集上逐条配对。上线:级联的阈值和选它的规则(事先写下)、dev 和 test 分开、test 结果带 Wilson 区间、和只用大模型的逐条配对(特别是「只有大模型对」)、按类别的回退率、高风险类别的规则、每月成本和其中的假设(小模型单价、盈亏平衡点)。上线后:灰度比例、回退率和人工改判率的监控、回退率涨了怎么办、多久重训一次。还要有一句法务确认过模型输出的使用条款。

</details>

## 明天预告

Day 581 · 强化学习(二):给 Agent 设计奖励,GRPO 训练分诊模型。Day 579 的奖励只有一个严格的判分函数,而且还没真的训练过一个模型。明天讲 Agent 的奖励由哪几部分组成(结果、格式、过程约束、效率),模型会怎么钻每一条规则的空子、怎么防,然后照着 TRL 的 GRPOTrainer 写一个训练分诊模型的脚本。
