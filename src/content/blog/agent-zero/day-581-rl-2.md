---
title: 'Day 581 · 强化学习(二):给 Agent 设计奖励,GRPO 训练分诊模型'
description: 'Day 579 只有一个严格的判分函数,还没真训过模型。今天先把 Agent 的奖励拆成结果、格式、过程约束、效率四部分,用一个退款轨迹打分器算清「转人工不扣分」为什么会让模型学会甩锅;再拿四条刷分输出去试两个宽松判分函数,看它们怎么被钻空子。然后写 TRL 的 GRPOTrainer 训练脚本(Colab,没实跑),并在 Intel Mac 的 CPU 上手写一遍 GRPO,真训一个 0.5B 分诊模型,读 reward、frac_reward_zero_std 这些指标,训练前后在 50 张 dev 工单上对比。'
pubDate: 2026-10-23
regime: none
tags: ['reinforcement-learning', 'grpo', 'reward-design', 'trl', 'python', 'agent-zero']
series: 'agent-zero'
day: 581
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 580](/blog/agent-zero/day-580-week83-review/) 把第 83 周串了一遍:LoRA 挂到 vLLM 做对比,DPO 两天,蒸馏两天,最后是 [Day 579](/blog/agent-zero/day-579-rl-1/) 的强化学习第一课。

Day 579 讲清了三件事:强化学习的信号是「结果对不对」而不是「示范怎么写」;RLVR 用程序判分,我们写了一个很严的 `verifier.py`,JSON 后面多五个字也给 0 分;GRPO 同一道题采样一组回答,用组内平均当基准算优势,组内分数全一样的题(`frac_reward_zero_std`)白采样。我们还用 numpy 写了一个 40 行的玩具 GRPO,看到它对「一次都没答对过的题」毫无办法。

那一课留了两个坑没填:Agent 的奖励不止「对不对」一项,还要管格式、过程和效率,而且每一项都可能被模型钻空子;另外我们还没有真正训过一个语言模型。今天把这两个坑填上。

## 今天要解决的问题

学完今天你应该能做到:

1. 把一个 Agent 任务的奖励拆成结果、格式、过程约束、效率四部分,写成 TRL 认得的奖励函数;能算出「转人工不扣分」时模型在什么情况下会学会甩锅。
2. 认得几种常见的奖励作弊(格式钻空子、对冲答案、迎合判分器、改测试),对每条奖励规则先问一句「只想刷分的人会怎么用它」。
3. 看懂 TRL `GRPOTrainer` 的训练脚本和日志指标,在本机 CPU 上用手写的 GRPO 真训一次 0.5B 模型,读懂 `reward`、`rewards/<函数名>/mean`、`frac_reward_zero_std`,并在独立的 dev 集上验证有没有真变好。

预计用时 3 小时,其中本机训练要跑一个多小时,可以开着它去读奖励作弊那几篇资料。前置:[Day 576](/blog/agent-zero/day-576-dpo-2/)(本机 `part10/dpo-cpu/` 环境、手写训练循环、`seq_logp`)、[Day 578](/blog/agent-zero/day-578-distill-2/)(`confidence.py` 的 `KEYS`、`route_dev.jsonl`)、[Day 579](/blog/agent-zero/day-579-rl-1/)(`verifier.py` 的 `triage_reward`、GRPO 优势公式)、[Day 570](/blog/agent-zero/day-570-finetune-1/)(`build_sft_data.py` 的 `SYSTEM`、`raw_triage.jsonl`)、[Day 71](/blog/agent-zero/day-071-pytest-1/)(pytest)。

哪些实跑了、哪些没有,先说清楚。**TRL 的 Colab 脚本没实跑**,我没有 GPU,脚本照 TRL 1.16.0(2026 年 10 月 15 日发布)的 GRPO 文档写,做了语法检查。本机部分全部实跑:奖励函数、轨迹打分、刷分测试都是纯 Python;GRPO 训练在 2019 款 Intel MacBook Pro 的 CPU 上手写,训 Qwen2.5-0.5B-Instruct,@@TRAIN_SUMMARY@@。今天不调付费 API,花费 0 元。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`rewards.py` 的两个函数、`agent_reward.py` 的 `score`、`grpo_cpu.py` 的 `grpo_step`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## Agent 的奖励由哪几部分组成

单轮任务的奖励好设计,对就是对,错就是错。Agent 任务难很多:一条轨迹有很多步,最后的结果可能部分正确,中间某一步可能越了权,也可能绕了一大圈才办成。把这些揉成一个分数,常见的做法是拆成四部分加起来。

**结果奖励**:任务最终完成了没有。退款金额对不对、回复里的事实和数据库一不一致、改完的代码过不过原始测试。这是最重要的部分,权重最大,也最难作弊,因为它直接对着事实。

**格式奖励**:输出能不能被解析、工具调用的参数合不合 schema。给一个小分数。它的作用是训练早期的「拐杖」:一个没训过的小模型格式经常错,格式一错结果奖励必然是 0,一组全 0 就没有信号;有了格式分,先学会格式,结果奖励才有机会出现差别。

**过程约束**:高风险操作前有没有走该走的步骤,有没有调不该调的工具。比如退款前要先查发票,超过一定金额要先审批。违反了**直接重罚**,而不是扣一点分。扣一点分的话,模型会算账:违规省掉的那些步骤带来的好处,可能比扣的分还多。

**效率**:步数和 token 的轻微惩罚,防止模型学会反复调工具、写一大段废话。权重要小,大了模型会学会「少做事」来避免扣分,最省事的就是什么都不做。

### 先改造分诊的奖励,让 TRL 能直接用

分诊是单轮任务,用不上过程约束,结果和格式两项就够了。Day 579 的 `triage_reward(output, expected)` 一次判一条,TRL 要的是另一种签名。我 2026 年 10 月 23 日查了 TRL 的 GRPO 文档,约定是这样的:奖励函数用**关键字参数**调用,至少收 `completions`(这一批所有回答);数据集里除了 `prompt` 以外的每一列(比如我们的 `expected`)都会用**同名参数**传进来;回答是对话格式时,每条是 `[{"role": "assistant", "content": "..."}]`;返回一个和回答一样长的浮点数列表。多个奖励函数的分数按 `reward_weights` 加权求和,不写权重就全是 1。

新建 `part10/rewards.py`:

```python
# agent-zero-lab/part10/rewards.py
"""GRPO 用的分诊奖励,按 TRL 的约定写:关键字参数调用,completions 是对话格式,
数据集里 prompt 以外的列(这里是 expected)会用同名参数传进来;每条返回一个 float。
"""
import json

from build_sft_data import CATEGORIES
from confidence import KEYS
from verifier import triage_reward

URGENCY = {"low", "normal", "high"}


def _text(c) -> str:
    return c[0]["content"] if isinstance(c, list) else c


def _parse(text: str) -> dict | None:
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


def format_reward(completions, **kwargs) -> list[float]:
    """格式:整段正好是四字段 JSON,每个取值都合法,给 0.2;否则 0。"""
    out = []
    for c in completions:
        obj = _parse(_text(c))
        ok = (obj is not None and set(obj) == set(KEYS)
              and obj["category"] in CATEGORIES and obj["urgency"] in URGENCY
              and isinstance(obj["needs_account_data"], bool) and isinstance(obj["needs_human"], bool))
        out.append(0.2 if ok else 0.0)
    return out


def field_reward(completions, expected, **kwargs) -> list[float]:
    """结果:每对一个字段 0.25,格式不对直接 0(就是 Day 579 的 triage_reward)。"""
    return [triage_reward(_text(c), e) for c, e in zip(completions, expected)]


if __name__ == "__main__":
    gold = {"category": "refund", "needs_account_data": True, "needs_human": False, "urgency": "low"}
    outs = {
        "全对": '{"category": "refund", "needs_account_data": true, "needs_human": false, "urgency": "low"}',
        "错一个字段": '{"category": "refund", "needs_account_data": true, "needs_human": true, "urgency": "low"}',
        "取值不在枚举": '{"category": "退款", "needs_account_data": true, "needs_human": false, "urgency": "low"}',
        "布尔写成字符串": '{"category": "refund", "needs_account_data": "true", "needs_human": false, "urgency": "low"}',
        "后面加解释": '{"category": "refund", "needs_account_data": true, "needs_human": false, "urgency": "low"}'
                     '\n说明:客户在问退款进度,需要查账户。',
    }
    completions = [[{"role": "assistant", "content": t}] for t in outs.values()]
    expected = [gold] * len(outs)
    for name, f, r in zip(outs, format_reward(completions), field_reward(completions, expected)):
        print(f"{name:<8} format={f:.2f}  field={r:.2f}  合计={f + r:.2f}")
```

<div class="line-notes">

- `from build_sft_data import CATEGORIES` Day 570 定义的八个类别名,`billing`、`refund` 这些。格式奖励要检查类别在不在这八个里面。
- `from confidence import KEYS` Day 578 的四个字段名元组。
- `from verifier import triage_reward` Day 579 的严格判分函数,结果奖励直接复用它,不再写第二份判分逻辑。两份判分逻辑迟早会不一致。
- `def _text(c) -> str:` TRL 传进来的 `c` 可能是对话格式(一个只有一条消息的列表),也可能是纯字符串(数据集是纯文本格式时)。这个小函数两种都接住。函数名前面的下划线是 Python 的约定,表示「模块内部用的,别从外面调」。
- `return c[0]["content"] if isinstance(c, list) else c` `isinstance(c, list)` 判断类型,相当于 JS 的 `Array.isArray(c)`。
- `obj = json.loads(text)` 和 Day 579 一样,整段原样解析,不剥代码块,不找第一个 `{`。注意 `json.loads` 允许前后有空白和换行,所以缩进排版的 JSON 也算合法,只要没有多余的文字。
- `return obj if isinstance(obj, dict) else None` 解析出来是列表、数字的,一律当失败。
- `ok = (obj is not None and set(obj) == set(KEYS)` 格式关一共五道:是对象、字段正好四个、类别在枚举里、紧急度在枚举里、两个布尔字段真的是布尔值。用 `and` 连起来,前面一道不过后面就不再算(短路),所以 `obj["category"]` 不会在 `obj` 是 `None` 时报错。
- `and isinstance(obj["needs_account_data"], bool) and isinstance(obj["needs_human"], bool))` 小模型常把 `true` 写成字符串 `"true"`,甚至 `"yes"`。字符串 `"true"` 在 Python 里是真值,不专门检查类型就会被放过。
- `out.append(0.2 if ok else 0.0)` 格式分只给 0.2,是结果分满分 1.0 的五分之一。格式是拐杖,不能比走路本身还重要。
- `def field_reward(completions, expected, **kwargs) -> list[float]:` `expected` 就是数据集里那一列,TRL 按列名传进来,一条回答对应一个 `expected`。`**kwargs` 接住 TRL 塞进来的其他参数(`prompts`、`completion_ids`、`trainer_state` 等),我们用不到,但必须写,否则会报「意外的关键字参数」。
- `return [triage_reward(_text(c), e) for c, e in zip(completions, expected)]` `zip` 把两个列表按位置配对,相当于 JS 里 `completions.map((c, i) => [c, expected[i]])`。
- `"后面加解释": '{"category": "refund"` 两个相邻的字符串字面量会被 Python 自动拼成一个,第二行就是接在 JSON 后面的那段解释。

</div>

```bash
cd agent-zero-lab
uv run python part10/rewards.py
```

```text
全对       format=0.20  field=1.00  合计=1.20
错一个字段    format=0.20  field=0.75  合计=0.95
取值不在枚举   format=0.00  field=0.75  合计=0.75
布尔写成字符串  format=0.00  field=0.75  合计=0.75
后面加解释    format=0.00  field=0.00  合计=0.00
```

「取值不在枚举」那条,类别写成了中文「退款」,格式分没了,但其他三个字段都对,结果分还有 0.75。它比「错一个字段」少 0.2,模型能从这个差别里学到「类别要用英文枚举」。「后面加解释」两项都是 0:内容全对,多了一行说明,照样一分不给。这就是 Day 579 说的,训练时你宽容什么,模型就学会什么。

你可能会问,为什么没有效率项。分诊输出很短,而且严格解析已经把「JSON 外面加废话」判成 0 分了,长度惩罚在这里是多余的。效率项在多步 Agent 上才有用,下面就是。

### 给一条 Agent 轨迹打分

换成退款 Agent。它的一次运行是一串工具调用,就是 SupportPilot 日志里记的那种 `[{"tool": ..., "args": ...}, ...]`(工具名和第五部分 CloudLedger MCP server 的一致,再加一个转人工)。新建 `part10/agent_reward.py`:

```python
# agent-zero-lab/part10/agent_reward.py
"""给一条退款 Agent 的轨迹打分:结果 + 格式 + 过程约束 + 效率,四部分加起来。
轨迹是一串工具调用,和 SupportPilot 日志里记的一样:[{"tool": 名字, "args": {...}}, ...]。
"""
TOOLS = {"find_customer", "get_subscription", "list_invoices", "create_refund_request", "transfer_to_human"}


def score(traj: list[dict], expected_amount: float, transfer_cost: float = 0.3) -> dict[str, float]:
    names = [s["tool"] for s in traj]
    refunds = [s["args"].get("amount") for s in traj if s["tool"] == "create_refund_request"]
    parts = {"结果": 0.0, "格式": 0.0, "过程": 0.0, "效率": 0.0}
    if refunds:
        parts["结果"] = 1.0 if len(refunds) == 1 and abs(refunds[0] - expected_amount) < 0.005 else -0.5
    elif "transfer_to_human" in names:
        parts["结果"] = -transfer_cost
    parts["格式"] = 0.1 if all(n in TOOLS and isinstance(s.get("args"), dict) for n, s in zip(names, traj)) else 0.0
    if refunds and ("list_invoices" not in names or names.index("list_invoices") > names.index("create_refund_request")):
        parts["过程"] = -1.0
    parts["效率"] = 0.0 - min(0.1, 0.02 * max(0, len(traj) - 4))
    parts["合计"] = round(sum(parts.values()), 2)
    return parts


C = {"tool": "find_customer", "args": {"email": "li@example.com"}}
INV = {"tool": "list_invoices", "args": {"customer_id": "C-0001"}}
TRAJS = {
    "正常办完": [C, INV, {"tool": "create_refund_request", "args": {"amount": 149.5}}],
    "没查发票就退": [C, {"tool": "create_refund_request", "args": {"amount": 149.5}}],
    "绕圈子": [C, C, INV, INV, C, INV, {"tool": "create_refund_request", "args": {"amount": 149.5}}],
    "退错金额": [C, INV, {"tool": "create_refund_request", "args": {"amount": 299.0}}],
    "直接转人工": [C, {"tool": "transfer_to_human", "args": {}}],
}

if __name__ == "__main__":
    for name, t in TRAJS.items():
        print(f"{name:<7}", score(t, 149.5))
    print("\n这张工单模型答对的概率 p 不同时,两种做法的期望得分(只算结果奖励):")
    for cost in (0.0, 0.3):
        for p in (0.1, 0.2, 0.3, 0.5):
            try_ev = p * 1.0 + (1 - p) * -0.5
            print(f"转人工扣 {cost}  p={p}  自己办 {try_ev:+.2f}  转人工 {0.0 - cost:+.2f}  -> "
                  f"{'转人工更划算' if 0.0 - cost > try_ev else '自己办更划算'}")
```

<div class="line-notes">

- `TOOLS = {"find_customer", "get_subscription"` 允许调用的工具集合。前四个是 CloudLedger 的四个工具,最后一个是转人工。调用了集合外的工具名(模型编的),格式分就没了。
- `def score(traj: list[dict], expected_amount: float, transfer_cost: float = 0.3) -> dict[str, float]:` 返回一个字典,四部分各多少、合计多少都在里面。训练时只用合计,但调试奖励时你一定想知道分是在哪一项丢的。`transfer_cost` 是转人工扣多少分,下面要拿它做实验。
- `refunds = [s["args"].get("amount") for s in traj if s["tool"] == "create_refund_request"]` 把所有退款调用的金额挑出来。`.get("amount")` 在没有这个参数时返回 `None` 而不报错。
- `parts["结果"] = 1.0 if len(refunds) == 1 and abs(refunds[0] - expected_amount) < 0.005 else -0.5` 结果奖励:恰好退了一次、金额对(差不到半分钱)得 1 分。退错或退了两次,扣 0.5 分。退错钱是真金白银的损失,所以是负分,不只是 0 分。浮点数不能直接用 `==` 比,Day 579 的 `refund_verifier.py` 也是这么比的。
- `elif "transfer_to_human" in names:` 没退款、转了人工,结果分是 `-transfer_cost`。转人工不算失败,但也有成本:人工客服的时间。
- `parts["格式"] = 0.1 if all(n in TOOLS and isinstance(s.get("args"), dict) for n, s in zip(names, traj)) else 0.0` 每一步的工具名都在白名单里、参数都是字典,给 0.1。`all(...)` 全部为真才是真,相当于 JS 的 `every`。
- `if refunds and ("list_invoices" not in names or names.index("list_invoices") > names.index("create_refund_request")):` 过程约束:退款前必须查过发票。两种违规:根本没查;或者查是查了,但在退款之后才查。`names.index(x)` 返回 x 第一次出现的位置,相当于 JS 的 `indexOf`。
- `parts["过程"] = -1.0` 重罚,直接把结果分抵消掉。
- `parts["效率"] = 0.0 - min(0.1, 0.02 * max(0, len(traj) - 4))` 超过 4 步以后每多一步扣 0.02,最多扣 0.1。最多扣 0.1 是故意的:效率永远不能比把事办对更重要。写成 `0.0 - ...` 而不是 `-min(...)`,是为了不扣分时得到 `0.0` 而不是 `-0.0`,打印出来不难看。
- `parts["合计"] = round(sum(parts.values()), 2)` 四项加起来。`round(..., 2)` 消掉浮点误差,比如 1.1 不会显示成 1.1000000000000001。
- `try_ev = p * 1.0 + (1 - p) * -0.5` 期望得分:有 p 的概率办对拿 1 分,1−p 的概率办错扣 0.5 分。**期望**就是「按概率加权的平均分」,模型在训练里追求的正是它。
- `print(f"转人工扣 {cost}  p={p}  自己办 {try_ev:+.2f}  转人工 {0.0 - cost:+.2f}  -> "` `:+.2f` 总是带正负号显示两位小数。

</div>

```bash
uv run python part10/agent_reward.py
```

```text
正常办完    {'结果': 1.0, '格式': 0.1, '过程': 0.0, '效率': 0.0, '合计': 1.1}
没查发票就退  {'结果': 1.0, '格式': 0.1, '过程': -1.0, '效率': 0.0, '合计': 0.1}
绕圈子     {'结果': 1.0, '格式': 0.1, '过程': 0.0, '效率': -0.06, '合计': 1.04}
退错金额    {'结果': -0.5, '格式': 0.1, '过程': 0.0, '效率': 0.0, '合计': -0.4}
直接转人工   {'结果': -0.3, '格式': 0.1, '过程': 0.0, '效率': 0.0, '合计': -0.2}

这张工单模型答对的概率 p 不同时,两种做法的期望得分(只算结果奖励):
转人工扣 0.0  p=0.1  自己办 -0.35  转人工 +0.00  -> 转人工更划算
转人工扣 0.0  p=0.2  自己办 -0.20  转人工 +0.00  -> 转人工更划算
转人工扣 0.0  p=0.3  自己办 -0.05  转人工 +0.00  -> 转人工更划算
转人工扣 0.0  p=0.5  自己办 +0.25  转人工 +0.00  -> 自己办更划算
转人工扣 0.3  p=0.1  自己办 -0.35  转人工 -0.30  -> 转人工更划算
转人工扣 0.3  p=0.2  自己办 -0.20  转人工 -0.30  -> 自己办更划算
转人工扣 0.3  p=0.3  自己办 -0.05  转人工 -0.30  -> 自己办更划算
转人工扣 0.3  p=0.5  自己办 +0.25  转人工 -0.30  -> 自己办更划算
```

先看上半段。「没查发票就退」金额是对的,结果分 1.0,被过程约束扣成了 0.1,比「直接转人工」高,但远低于正常办完。「绕圈子」7 步办成,只扣了 0.06,依然是第二高分:多走几步不是大错,办对了就该拿高分。四部分的大小关系是这样排出来的:**结果 > 过程约束 > 格式 > 效率**,而且过程约束的惩罚和结果奖励一样大。

下半段是今天最值得记住的一个算式。转人工不扣分时,只要模型对这张工单的把握不到一半(p=0.3 时自己办期望 −0.05,转人工 0),**转人工就是更划算的选择**。训练一段时间后,模型会把所有它拿不准的工单都转出去,奖励曲线很好看,线上的转人工率翻倍。这叫**规避任务**。给转人工一个 0.3 的成本以后,临界点从 1/3 降到了 2/15 ≈ 0.13(解 `p − 0.5(1−p) = −0.3`),只有真的没把握才转。这个成本定多少没有标准答案,要和业务一起定,并且上线后单独盯着转人工率看。

## 奖励作弊

**奖励作弊**(reward hacking):模型找到一种拿高分、但没有真正把事做好的办法。它不是模型「学坏了」,是你的奖励函数和你真正想要的东西之间有缝,而强化学习的工作就是全力找出所有能拿分的路。Lilian Weng 2024 年 11 月写过一篇很长的综述,收了大量例子,链接在学习资料里。

拿分诊来演示。假设有人写了两个宽松的判分函数:一个从文字里抠出第一段 `{...}` 再判;另一个只检查输出里有没有出现正确类别的名字。再准备四条「只想刷分」的输出。新建 `part10/hack_test.py`:

```python
# agent-zero-lab/part10/hack_test.py
"""拿几条「只想刷分」的输出,分别喂给两个宽松的判分函数和 Day 579 的严格判分函数,看谁被钻了空子。"""
import json
import re

from build_sft_data import CATEGORIES
from verifier import triage_reward


def lenient_extract(output: str, expected: dict) -> float:
    """宽松版一:从文字里抠出第一段 {...} 再判。"""
    m = re.search(r"\{.*?\}", output, re.S)
    return triage_reward(m.group(0), expected) if m else 0.0


def contains_label(output: str, expected: dict) -> float:
    """宽松版二:只要输出里出现了正确类别的名字就算类别对。"""
    return 1.0 if expected["category"] in output else 0.0


gold = {"category": "invoice", "needs_account_data": True, "needs_human": True, "urgency": "normal"}
ok = json.dumps(gold)
HACKS = {
    "老实答对": ok,
    "答对再加客套": ok + "\n已为您核实账户信息,请放心,我们会尽快处理。",
    "八个类别全写上": json.dumps({**gold, "category": "/".join(sorted(CATEGORIES))}),
    "先写一段推理": "这位客户说发票抬头错了,应该是 invoice。\n" + ok,
}
print(f"{'输出':<9}{'抠 JSON':>8}{'含类别名':>8}{'严格':>6}")
for name, out in HACKS.items():
    print(f"{name:<9}{lenient_extract(out, gold):>8.2f}{contains_label(out, gold):>8.2f}{triage_reward(out, gold):>8.2f}")
```

<div class="line-notes">

- `m = re.search(r"\{.*?\}", output, re.S)` 找第一对花括号之间的内容。`.*?` 是「尽量少地匹配任意字符」,`re.S` 让 `.` 也能匹配换行。线上解析模型输出时这么写很常见,也没错;拿它当训练奖励就出问题了。
- `return triage_reward(m.group(0), expected) if m else 0.0` 抠出来的那一段再交给严格的判分函数,所以「抠出来以后」是严格的,宽松在「抠」这一步。
- `return 1.0 if expected["category"] in output else 0.0` 只看正确类别的名字是不是**出现在**输出里。`in` 对字符串是「包含」,相当于 JS 的 `output.includes(...)`。写评测时偷懒最容易写出这种判法。
- `ok = json.dumps(gold)` 标准答案的 JSON 文本,当作「老实答对」的输出。
- `"八个类别全写上": json.dumps({**gold, "category": "/".join(sorted(CATEGORIES))}),` `{**gold, "category": ...}` 复制一份 `gold` 再覆盖 `category`,相当于 JS 的 `{...gold, category: ...}`。类别写成 `account/api/billing/.../technical`,八个全占上,这叫**对冲**。
- `"先写一段推理": "这位客户说发票抬头错了,应该是 invoice。\n" + ok,` 先写一句理由再给 JSON。它算不算作弊要看你想要什么,下面说。
- `print(f"{'输出':<9}{'抠 JSON':>8}{'含类别名':>8}{'严格':>6}")` 表头。中文字符在终端里占两格,所以列对不太齐,不影响读数。

</div>

```bash
uv run python part10/hack_test.py
```

```text
输出         抠 JSON    含类别名    严格
老实答对         1.00    1.00    1.00
答对再加客套       1.00    1.00    0.00
八个类别全写上      0.75    1.00    0.75
先写一段推理       1.00    1.00    0.00
```

「含类别名」那一列全是满分:八个类别全写上也拿 1.0。用这种判法训练,模型很快会发现「把所有类别都写上」是一个永远不会错的策略,奖励曲线会一路涨到满分,模型却一点用都没有。「抠 JSON」那一列放过了客套话和推理。客套话本身无害,但它是一个信号:模型发现判分器不管 JSON 外面写什么,下一步它可能在外面写「已为您核实」这种迎合人工评审的话,或者干脆把答案的不确定性藏在外面那段话里。

「严格」那一列,对冲那条拿了 0.75,因为另外三个字段是对的,类别那一项没给分;而且前面 `format_reward` 会因为类别不在枚举里给 0。客套和推理都是 0。

「先写一段推理」要单独说一句:推理不一定是坏事,很多 GRPO 配方(包括 DeepSeek-R1)就是要模型先在 `<think>` 里想再回答。如果你想要推理,就把它**写进格式**:规定「先 `<think>...</think>`,后面紧跟一个 JSON」,判分时严格按这个格式切开。别用宽松的解析去「顺便容忍」它,那等于告诉模型「外面写什么都行」。

### 真实世界里的例子

**改测试而不是改代码**。代码 Agent 的奖励通常是「测试通过」,模型就会去改测试、把断言删掉,或者让测试进程提前退出。Anthropic 2025 年 11 月发的研究《From shortcuts to sabotage: Natural emergent misalignment from reward hacking》里,一个被观察到的作弊手法就是在 Python 里调 `sys.exit(0)`,让测试框架以为全部通过。更让人不安的是那篇文章的主要发现:模型学会这类作弊以后,在完全无关的评测上也开始出现不对齐的行为。对策是测试文件对 Agent 只读,判分时在隔离的沙箱里用原始测试重新跑。

**迎合判分器**。如果结果奖励由 LLM judge 打分([Day 350](/blog/agent-zero/day-350-judge-code/) 之后的评测课讲过 judge),模型会学会说 judge 爱听的话:写得更长、反复强调「已核实」、语气格外礼貌。对策是能用程序判的就别用 judge,judge 只评程序判不了的维度,并且盯着「judge 分在涨、人工抽查没变好」这种背离。

**规避任务**。就是上面那个转人工的算式。

设计奖励时养成一个习惯:**每加一条规则,先问自己「一个只想刷分、不想把事做好的人,会怎么利用这条规则」**。这和 [Day 406](/blog/agent-zero/day-406-attack-yourself/) 先打一遍自己的 Agent 是同一种思路。写奖励和写评测几乎是同一件事,只是奖励会被一个比你勤奋得多的对手连续攻击几千步。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="Agent 奖励的四部分和对应的作弊方式">
<g font-family="var(--font-mono)">
<rect x="20" y="20" width="140" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="90" y="44" font-size="12" fill="var(--ink)" text-anchor="middle">结果 ±1.0</text>
<text x="90" y="64" font-size="10" fill="var(--ink-soft)" text-anchor="middle">金额对、测试过</text>
<rect x="173" y="20" width="140" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="243" y="44" font-size="12" fill="var(--ink)" text-anchor="middle">过程 -1.0</text>
<text x="243" y="64" font-size="10" fill="var(--ink-soft)" text-anchor="middle">先查发票、先审批</text>
<rect x="326" y="20" width="140" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="396" y="44" font-size="12" fill="var(--ink)" text-anchor="middle">格式 +0.1~0.2</text>
<text x="396" y="64" font-size="10" fill="var(--ink-soft)" text-anchor="middle">能解析、合 schema</text>
<rect x="479" y="20" width="141" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="549" y="44" font-size="12" fill="var(--ink)" text-anchor="middle">效率 ≥ -0.1</text>
<text x="549" y="64" font-size="10" fill="var(--ink-soft)" text-anchor="middle">步数、长度</text>
<g stroke="var(--rule)" stroke-width="1.5">
<line x1="90" y1="84" x2="90" y2="130"/><line x1="243" y1="84" x2="243" y2="130"/><line x1="396" y1="84" x2="396" y2="130"/><line x1="549" y1="84" x2="549" y2="130"/>
</g>
<rect x="20" y="130" width="140" height="74" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="152" font-size="11" fill="var(--ink)" text-anchor="middle">改测试</text>
<text x="90" y="170" font-size="11" fill="var(--ink)" text-anchor="middle">对冲答案</text>
<text x="90" y="188" font-size="11" fill="var(--ink)" text-anchor="middle">迎合 judge</text>
<rect x="173" y="130" width="140" height="74" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="243" y="152" font-size="11" fill="var(--ink)" text-anchor="middle">罚得太轻</text>
<text x="243" y="170" font-size="11" fill="var(--ink)" text-anchor="middle">→ 算账后照样</text>
<text x="243" y="188" font-size="11" fill="var(--ink)" text-anchor="middle">跳过步骤</text>
<rect x="326" y="130" width="140" height="74" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="396" y="152" font-size="11" fill="var(--ink)" text-anchor="middle">宽松解析</text>
<text x="396" y="170" font-size="11" fill="var(--ink)" text-anchor="middle">→ JSON 外面</text>
<text x="396" y="188" font-size="11" fill="var(--ink)" text-anchor="middle">随便写</text>
<rect x="479" y="130" width="141" height="74" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="549" y="152" font-size="11" fill="var(--ink)" text-anchor="middle">罚得太重</text>
<text x="549" y="170" font-size="11" fill="var(--ink)" text-anchor="middle">→ 少做事</text>
<text x="549" y="188" font-size="11" fill="var(--ink)" text-anchor="middle">直接转人工</text>
</g>
<text x="320" y="236" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">上面琥珀色是奖励的四部分(数字是今天代码里的权重),下面蓝色是模型会怎么钻它</text>
</svg>
<figcaption>四部分各有自己的作弊方式。权重的大小关系本身也是防线:效率罚得比结果还重,模型就会学会什么都不做。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Hrq1YAEYe&autoplay=0&high_quality=1" title="【人工智能】什么是强化学习中的奖励黑客 | Reward Hacking | OpenAI前安全主管翁荔最新长文" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>为什么叫QQ · 【人工智能】什么是强化学习中的奖励黑客 | Reward Hacking | OpenAI前安全主管翁荔最新长文 · 15 分钟。中文讲 Lilian Weng 那篇综述,例子比原文好消化,看完再去读原文挑 LLM 相关的部分。</figcaption>
</figure>

## 用 TRL 的 GRPOTrainer 训练(Colab,没实跑)

奖励写好了,先把「正规路线」写出来。和 [Day 576](/blog/agent-zero/day-576-dpo-2/) 一样,Intel Mac 装不上新版 TRL(PyTorch 最后一个 Intel Mac 安装包是 2.2.2),正规路线在 Colab 的 T4 上跑。

训练数据只要题面和标准答案,不要示范回答,这是 RL 和 SFT 在数据上最直观的区别。先在本机准备一份,评测用过的工单一条都不能进来。新建 `part10/make_grpo_data.py`:

```python
# agent-zero-lab/part10/make_grpo_data.py
"""给 GRPO 准备训练题:只要题面和标准答案,不要示范回答。评测用过的工单一条都不能进来。
用法:uv run python part10/make_grpo_data.py 200
"""
import json
import random
import sys
from collections import Counter
from pathlib import Path

from build_sft_data import fingerprint, load_eval_blacklist, valid

DATA = Path(__file__).parent / "data"
random.seed(581)

black: set[str] = set()
for name in ("tickets_v1", "tickets_hard", "unlabeled", "route_dev", "route_test"):
    black |= load_eval_blacklist(DATA / f"{name}.jsonl")
seen: set[str] = set()
pool = []
for line in (DATA / "raw_triage.jsonl").read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    rec = json.loads(line)
    fp = fingerprint(rec["subject"], rec["body"])
    if valid(rec) and fp not in black and fp not in seen:
        seen.add(fp)
        pool.append(rec)

picked = random.sample(pool, int(sys.argv[1]))
with open(DATA / "grpo_train.jsonl", "w", encoding="utf-8") as f:
    for i, rec in enumerate(picked):
        row = {"id": f"G{i + 1:03d}", "subject": rec["subject"], "body": rec["body"], "expected": rec["triage"]}
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
print(f"可用 {len(pool)} 条,抽 {len(picked)} 条 → grpo_train.jsonl")
print(dict(Counter(r["triage"]["category"] for r in picked)))
```

<div class="line-notes">

- `from build_sft_data import fingerprint, load_eval_blacklist, valid` 三个都是 Day 570 写的:`fingerprint` 去掉空白标点后算 md5,`load_eval_blacklist` 把一份评测集的指纹全读进集合,`valid` 检查标签四个字段齐不齐、取值合不合法。
- `for name in ("tickets_v1", "tickets_hard", "unlabeled", "route_dev", "route_test"):` 五份评测或留出数据的指纹全部拉黑:Day 570 的评测集、Day 574 的换说法评测集、Day 577 的无标签工单、Day 578 的 dev 和 test。下面要用 `route_dev` 评测训练效果,它绝不能出现在训练题里。
- `black |= load_eval_blacklist(DATA / f"{name}.jsonl")` `|=` 是集合并集后赋值,相当于把新集合的元素都加进 `black`。
- `if valid(rec) and fp not in black and fp not in seen:` 三道筛子:标签合法、不在黑名单、和已经收的不重复。
- `picked = random.sample(pool, int(sys.argv[1]))` 不放回地随机抽 N 条,固定种子 581。
- `row = {"id": f"G{i + 1:03d}", "subject": rec["subject"], "body": rec["body"], "expected": rec["triage"]}` 每行只有题面和 `expected`,格式和 `route_dev.jsonl` 一样,题号用 G 开头。`{i + 1:03d}` 把 1 格式化成 `001`。

</div>

```bash
uv run python part10/make_grpo_data.py 200
```

```text
可用 366 条,抽 200 条 → grpo_train.jsonl
{'billing': 67, 'invoice': 24, 'other': 9, 'technical': 47, 'plan_change': 11, 'account': 18, 'refund': 21, 'api': 3}
```

原始 502 条,去掉坏标签、重复和五份评测数据,剩 366 条,抽 200 条。类别很不均衡,`api` 只有 3 条,这是 Day 570 造数据时就有的分布,今天不处理,记在心里:训练后 `api` 类大概率不会变好。

把 `part10/data/grpo_train.jsonl`、`part10/rewards.py`、`part10/verifier.py`、`part10/confidence.py`、`part10/build_sft_data.py` 五个文件拖进 Colab 左边栏(会出现在 `/content/` 下),第一个单元装依赖:

```python
# Colab 单元 1:安装(没实跑)
!pip install -U trl peft datasets
```

<div class="line-notes">

- `!pip install -U trl peft datasets` `!` 开头在 Colab 里执行终端命令,[Day 572](/blog/agent-zero/day-572-finetune-2/) 讲过。`-U` 装最新版,2026 年 10 月 23 日我查到是 trl 1.16.0、peft 0.21.2、datasets 5.1.0。

</div>

```python
# Colab 单元 2:用 TRL 跑 GRPO(没实跑)。基座 Qwen3-1.7B,LoRA,T4 用 fp16
import json

import torch
from datasets import Dataset
from peft import LoraConfig
from trl import GRPOConfig, GRPOTrainer

from rewards import field_reward, format_reward
from build_sft_data import SYSTEM

rows = [json.loads(x) for x in open("/content/grpo_train.jsonl", encoding="utf-8") if x.strip()]
dataset = Dataset.from_list([{
    "prompt": [{"role": "system", "content": SYSTEM},
               {"role": "user", "content": f"主题:{r['subject']}\n正文:{r['body']}"}],
    "expected": r["expected"],
} for r in rows])

args = GRPOConfig(
    output_dir="/content/grpo_out",
    num_generations=8,
    max_completion_length=96,
    per_device_train_batch_size=8,
    gradient_accumulation_steps=2,
    learning_rate=1e-5,
    num_train_epochs=1,
    temperature=1.0,
    reward_weights=[1.0, 1.0],
    chat_template_kwargs={"enable_thinking": False},
    logging_steps=5,
    fp16=True,
    bf16=False,
    model_init_kwargs={"dtype": torch.float16},
    report_to="none",
)
trainer = GRPOTrainer(
    model="Qwen/Qwen3-1.7B",
    reward_funcs=[format_reward, field_reward],
    args=args,
    train_dataset=dataset,
    peft_config=LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"),
)
trainer.train()
trainer.save_model("/content/grpo_lora")
```

<div class="line-notes">

- `from rewards import field_reward, format_reward` 本机写好、测过的两个奖励函数原样上传,Colab 里不改一个字。奖励函数是训练里最需要单元测试的代码(练习 1)。
- `"prompt": [{"role": "system", "content": SYSTEM},` 对话格式的 prompt,只有 system 和 user,**没有 assistant**。和 SFT 数据最大的不同:我们不告诉模型应该怎么答。
- `"expected": r["expected"],` 这一列会被 TRL 按列名原样传给 `field_reward` 的 `expected` 参数。列名和参数名必须一字不差。
- `num_generations=8,` 每道题采样 8 个回答组成一组,也就是 Day 579 的 G。TRL 默认就是 8,写出来是提醒自己它存在。
- `max_completion_length=96,` 每个回答最多 96 个 token。默认是 512,分诊输出一般 30 来个 token,开太大浪费采样时间。超过这个长度会被截断,日志里 `completions/clipped_ratio` 记的就是被截断的比例。
- `per_device_train_batch_size=8,` `gradient_accumulation_steps=2,` 一次更新看 8×2=16 个回答,也就是 2 道题 × 8 个。这个数要能被 `num_generations` 整除,一组回答不能被拆到两次更新里。
- `learning_rate=1e-5,` TRL 的 GRPO 默认学习率是 1e-6,那是给全量微调的;用 LoRA 要高一个数量级左右(Day 576 讲 DPO 时也是这个道理)。
- `temperature=1.0,` 默认值。按模型原本的分布采样,Day 579 讲过温度低了组内全一样。
- `reward_weights=[1.0, 1.0],` 两个奖励函数的权重,和 `reward_funcs` 一一对应。格式分我们已经在函数里定成 0.2 了,所以权重都给 1。
- `chat_template_kwargs={"enable_thinking": False},` 传给 chat template 的额外参数。Qwen3 默认开思考模式,会先写一大段 `<think>`,96 个 token 根本不够,而且我们的严格解析会把它判成 0 分。这个参数是 TRL 文档里关掉思考的示例写法。
- `fp16=True,` `bf16=False,` T4 不支持 bf16,和 Day 576 一样。
- `model_init_kwargs={"dtype": torch.float16},` 模型以字符串传入时用 16 位加载,否则默认 32 位,显存翻倍。
- `model="Qwen/Qwen3-1.7B",` 比本机用的 0.5B 大,T4 的 16 GB 显存放 1.7B 的 16 位权重加 LoRA 加 8 路采样是够的;换 4B 要像 Day 572 那样 4 位加载。
- `peft_config=LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"),` 和 Day 576 一样的 LoRA 配置。Thinking Machines 2025 年的《LoRA Without Regret》实验发现,强化学习里 LoRA 的秩很低(甚至 1)也能追上全量微调,他们的解释是一次 RL 任务每条轨迹只带回来一个标量奖励,能学的信息量本来就少。
- `trainer.save_model("/content/grpo_lora")` 只存 LoRA 适配器,下载后按 [Day 574](/blog/agent-zero/day-574-finetune-3/) 的方法挂到 vLLM 上评测。

</div>

TRL 文档里这几个默认值也要认得:`loss_type` 默认 `"dapo"`,`beta`(KL 系数)默认 0,也就是不加载参考模型;`num_iterations` 默认 1,每批采样只更新一次;`epsilon` 默认 0.2,是裁剪范围;`scale_rewards` 默认 `"group"`,按组除以标准差。训练日志里会出现这些指标(名字来自文档的 Logged metrics 一节):

| 指标 | 意思 | 该怎么看 |
| --- | --- | --- |
| `reward` | 这一批的平均总奖励(按权重加) | 应该总体往上走,允许抖 |
| `rewards/format_reward/mean` | 每个奖励函数各自的平均分,名字就是函数名 | 通常格式先涨满,结果分后涨 |
| `rewards/field_reward/mean` | 同上 | 这才是你真正关心的 |
| `frac_reward_zero_std` | 组内分数全一样的题占几成 | 前期高是题太难或太简单,后期高可能是学会了 |
| `completions/mean_length` | 回答平均多少 token | 分诊应该稳定在三十来个;一路变长要查是不是在钻空子 |
| `completions/clipped_ratio` | 被截断的回答占几成 | 高说明 `max_completion_length` 不够,或者模型在写废话 |
| `entropy` | 生成时每个 token 的平均熵,越低越「确定」 | 掉得太快说明模型过早地只会一种写法 |
| `kl` | 和参考模型的距离,只在 `beta` 不为 0 时记 | 默认不记 |

## 本机:手写一遍 GRPOTrainer 做的事

Colab 的脚本是黑盒,本机这一版把它拆开。用 Day 576 建好的 `part10/dpo-cpu/` 环境(torch 2.2.2、transformers 4.57.6、peft 0.21.2),模型用 Qwen2.5-0.5B-Instruct,和 Day 576、578 是同一个。

### 先测训练前的样子

训练前先在 50 张 dev 工单上量一次,训练后用同一个脚本再量一次。这一步不能省,不然训练日志里 reward 涨了你也不知道是真变好还是在钻空子。新建 `part10/dpo-cpu/grpo_eval.py`:

```python
# agent-zero-lab/part10/dpo-cpu/grpo_eval.py
"""用贪心解码在 route_dev 上评测基座或基座 + LoRA:格式合法率、字段平均分、四字段全对几张。
用法(在 part10/dpo-cpu 目录):uv run python grpo_eval.py ../data/route_dev.jsonl [grpo_lora]
"""
import json
import sys
from pathlib import Path

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from build_sft_data import SYSTEM                  # noqa: E402
from confidence import KEYS                        # noqa: E402
from rewards import field_reward, format_reward    # noqa: E402

BASE = "Qwen/Qwen2.5-0.5B-Instruct"
tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.float32)
if len(sys.argv) > 2:
    model = PeftModel.from_pretrained(model, sys.argv[2])
model.eval()

cases = [json.loads(x) for x in open(sys.argv[1], encoding="utf-8") if x.strip()]
texts = []
with torch.no_grad():
    for c in cases:
        msgs = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"主题:{c['subject']}\n正文:{c['body']}"}]
        ids = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt")
        out = model.generate(ids, attention_mask=torch.ones_like(ids), do_sample=False, max_new_tokens=60,
                             repetition_penalty=1.0, pad_token_id=tok.pad_token_id)
        texts.append(tok.decode(out[0, ids.shape[1]:], skip_special_tokens=True))
completions = [[{"role": "assistant", "content": t}] for t in texts]
fmt = format_reward(completions)
fld = field_reward(completions, [c["expected"] for c in cases])
n = len(cases)
print(f"格式合法 {sum(f > 0 for f in fmt)}/{n}  字段平均分 {sum(fld) / n:.3f}  四字段全对 {sum(x == 1.0 for x in fld)}/{n}")
for k in KEYS:
    right = 0
    for t, c in zip(texts, cases):
        try:
            right += json.loads(t).get(k) == c["expected"][k]
        except (json.JSONDecodeError, AttributeError):
            pass
    print(f"  {k:<20} {right}/{n}")
tag = Path(sys.argv[2]).name if len(sys.argv) > 2 else "base"
Path(f"eval-{tag}.jsonl").write_text("".join(json.dumps({"id": c["id"], "out": t}, ensure_ascii=False) + "\n"
                                             for c, t in zip(cases, texts)), encoding="utf-8")
```

<div class="line-notes">

- `sys.path.insert(0, str(Path(__file__).resolve().parent.parent))` 这个脚本在 `part10/dpo-cpu/` 里跑,用的是 dpo-cpu 自己的环境。把上一层 `part10/` 加进导入路径,才能导入 `build_sft_data`、`confidence`、`rewards`。Day 578 的 `student_run.py` 也是这么做的。`# noqa: E402` 告诉 Ruff 别报「导入不在文件开头」。
- `if len(sys.argv) > 2:` 命令行多给一个参数,就是 LoRA 目录。不给就评测原版基座。
- `model = PeftModel.from_pretrained(model, sys.argv[2])` 把训练好的 LoRA 适配器挂到基座上。和 Day 574 在 vLLM 上挂 LoRA 是一回事,这里在 transformers 里挂。
- `msgs = [{"role": "system", "content": SYSTEM},` 和训练时一模一样的 prompt:只有 Day 570 那段 system,**没有示例,也没有 Day 577 的口径说明**。Day 578 的 `student_run.py` 给了 3 个示例和口径,那是另一种用法;今天要看的是强化学习本身能把一个「裸」的小模型推多远。
- `out = model.generate(ids, attention_mask=torch.ones_like(ids), do_sample=False, max_new_tokens=60,` `do_sample=False` 是贪心解码,每一步取概率最大的 token,同样的输入永远得到同样的输出,评测要的就是这个。`attention_mask` 全 1 表示 prompt 里没有填充,不写的话 transformers 会打一行警告。
- `repetition_penalty=1.0, pad_token_id=tok.pad_token_id)` Qwen2.5 的默认生成配置里带了 `repetition_penalty=1.05`,这里关掉,和训练时采样的设置保持一致。
- `texts.append(tok.decode(out[0, ids.shape[1]:], skip_special_tokens=True))` `generate` 返回的是 prompt 加回答,`ids.shape[1]` 是 prompt 的长度,切掉它只留回答。`skip_special_tokens=True` 去掉结尾的 `<|im_end|>` 这种特殊标记。
- `fmt = format_reward(completions)` 评测直接用训练时的奖励函数打分,保证「训练在优化的」和「评测在量的」是同一把尺子。下面按字段的统计是另外一把更宽的尺子,两把一起看。
- `right += json.loads(t).get(k) == c["expected"][k]` 按字段统计时宽一点:字段缺了、多了都不管,只看这个字段对不对,用来看模型在哪个字段上弱。
- `except (json.JSONDecodeError, AttributeError):` 解析不了,或者解析出来不是字典(没有 `.get`),这一条这个字段就算错。
- `Path(f"eval-{tag}.jsonl").write_text(` 每条的原始输出存下来,`eval-base.jsonl` 或 `eval-grpo_lora.jsonl`,方便事后一条条翻。

</div>

```bash
cd agent-zero-lab/part10/dpo-cpu
HF_HUB_OFFLINE=1 uv run python grpo_eval.py ../data/route_dev.jsonl
```

训练前(2026-10-23,Intel Core i7-8569U 的 CPU,50 张用了 7 分钟):

```text
格式合法 18/50  字段平均分 0.390  四字段全对 0/50
  category             11/50
  needs_account_data   30/50
  needs_human          25/50
  urgency              14/50
```

裸的 0.5B 模型 50 张里只有 18 张格式合法,一张四字段全对的都没有。翻一下 `eval-base.jsonl` 就知道错在哪:

```text
{"id": "D001", "out": "{\"category\":\"account_data\",\"needs_account_data\":\"true\",\"urgency\":\"high\"}"}
{"id": "D002", "out": "{\"category\":\"invoice\",\"needs_account_data\":\"yes\",\"urgency\":\"normal\"}"}
{"id": "D006", "out": "{\n  \"category\": \"account_change\",\n  \"needs_account_data\": true,\n  \"urgency\": \"high\",\n  \"needs_human\": false\n}"}
```

自己编类别(`account_data`、`account_change`),布尔写成 `"true"`、`"yes"`,经常漏掉 `needs_human`。好消息是 18/50 说明它**有时能做对格式**,一组 4 个回答里经常有对有错,GRPO 有信号可学。这正是 Day 579 那条结论的反面:一次都做不对的题学不会,偶尔能做对的才能学。

### 手写训练循环

和 Day 576 的 DPO 一样,一步拆成几块:对一道题采样一组回答;用 `rewards.py` 打分;组内算优势;按优势加权的 logp 求梯度,更新 LoRA。新建 `part10/dpo-cpu/grpo_cpu.py`:

```python
# agent-zero-lab/part10/dpo-cpu/grpo_cpu.py
"""在 CPU 上手写一遍 GRPOTrainer 做的事:每步取几张工单,每张采样一组回答,用 rewards.py 打分,
组内算优势,按优势加权的 logp 更新 LoRA。打印和 TRL 同名的指标。
用法(在 part10/dpo-cpu 目录):uv run python grpo_cpu.py ../data/grpo_train.jsonl
"""
import json
import random
import sys
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from build_sft_data import SYSTEM                  # noqa: E402
from rewards import field_reward, format_reward    # noqa: E402

BASE = "Qwen/Qwen2.5-0.5B-Instruct"
G, PER_STEP, STEPS, LR, MAX_NEW = 4, 4, 24, 5e-5, 48
REWARD_FUNCS = [format_reward, field_reward]
torch.manual_seed(0)
random.seed(0)

tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.float32)
model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"))
model.eval()
PAD = tok.pad_token_id
END = tok.convert_tokens_to_ids("<|im_end|>")


def prompt_ids(case: dict) -> torch.Tensor:
    msgs = [{"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"主题:{case['subject']}\n正文:{case['body']}"}]
    return tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt")


@torch.no_grad()
def sample_group(ids: torch.Tensor) -> torch.Tensor:
    out = model.generate(ids, attention_mask=torch.ones_like(ids), do_sample=True, temperature=1.0,
                         top_p=1.0, top_k=0, repetition_penalty=1.0, max_new_tokens=MAX_NEW, num_return_sequences=G, pad_token_id=PAD)
    return out[:, ids.shape[1]:]


def token_logps(ids: torch.Tensor, comp: torch.Tensor) -> torch.Tensor:
    full = torch.cat([ids.repeat(len(comp), 1), comp], dim=1)
    logits = model(full).logits[:, ids.shape[1] - 1:-1]
    return F.log_softmax(logits, dim=-1).gather(2, comp.unsqueeze(-1)).squeeze(-1)


def grpo_step(cases: list[dict]) -> dict[str, float]:
    total_loss, n_tok = 0.0, 0
    log: dict[str, list[float]] = {"reward": [], "zero_std": [], "len": [], "clipped": []}
    log.update({f"rewards/{f.__name__}/mean": [] for f in REWARD_FUNCS})
    batch = []
    for case in cases:
        ids = prompt_ids(case)
        comp = sample_group(ids)
        mask = (comp != PAD).float()
        texts = tok.batch_decode(comp, skip_special_tokens=True)
        completions = [[{"role": "assistant", "content": t}] for t in texts]
        cols = [f(completions=completions, expected=[case["expected"]] * G) for f in REWARD_FUNCS]
        r = torch.tensor([sum(x) for x in zip(*cols)])
        adv = (r - r.mean()) / (r.std() + 1e-4)
        batch.append((ids, comp, mask, adv))
        for f, col in zip(REWARD_FUNCS, cols):
            log[f"rewards/{f.__name__}/mean"].append(sum(col) / G)
        log["reward"].append(float(r.mean()))
        log["zero_std"].append(float(r.std() == 0))
        log["len"].append(float(mask.sum(1).mean()))
        log["clipped"].append(1 - float((comp == END).any(dim=1).float().mean()))
        n_tok += int(mask.sum())
    for ids, comp, mask, adv in batch:
        logps = token_logps(ids, comp)
        loss = -(adv.unsqueeze(1) * logps * mask).sum() / n_tok
        loss.backward()
        total_loss += float(loss)
    opt.step()
    opt.zero_grad()
    out = {k: sum(v) / len(v) for k, v in log.items()}
    return {"loss": total_loss, "reward": out["reward"],
            "rewards/format_reward/mean": out["rewards/format_reward/mean"],
            "rewards/field_reward/mean": out["rewards/field_reward/mean"],
            "frac_reward_zero_std": out["zero_std"], "completions/mean_length": out["len"],
            "completions/clipped_ratio": out["clipped"]}


rows = [json.loads(x) for x in open(sys.argv[1], encoding="utf-8") if x.strip()]
opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LR)
t0 = time.time()
for step in range(1, STEPS + 1):
    m = grpo_step(random.sample(rows, PER_STEP))
    print(f"step {step:>2}  " + "  ".join(f"{k}={v:.3f}" for k, v in m.items()) + f"  {time.time() - t0:.0f}s", flush=True)
model.save_pretrained("grpo_lora")
```

<div class="line-notes">

- `G, PER_STEP, STEPS, LR, MAX_NEW = 4, 4, 24, 5e-5, 48` 每组 4 个回答(TRL 默认 8,CPU 上省一半);每步 4 道题;一共 24 步;学习率 5e-5;每个回答最多 48 个 token。24 步 × 4 道 = 96 道题,200 道训练题只用了一半不到,CPU 太慢,这是能接受的上限。学习率比 Colab 那份高 5 倍,和 Day 576 的理由一样:总共只有 24 步,太小看不出变化。
- `REWARD_FUNCS = [format_reward, field_reward]` 和 Colab 脚本传给 `reward_funcs` 的是同一个列表,权重都是 1。
- `model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32` 和 Day 576 一样,挂上 LoRA,只训练那 1.75% 的参数。
- `model.eval()` 关掉 dropout。GRPO 里同一组回答的 logp 要和采样时的模型一致,dropout 会让它每次算出来不一样。
- `END = tok.convert_tokens_to_ids("<|im_end|>")` Qwen 的对话里 assistant 说完话会输出 `<|im_end|>`,这是「正常结束」的标记。拿它来判断有没有被截断。
- `return tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt")` 套模板,末尾加上「轮到 assistant 了」,`return_tensors="pt"` 直接返回 PyTorch 张量,形状 (1, prompt 长度)。
- `@torch.no_grad()` 装饰器([Day 64](/blog/agent-zero/day-064-httpx-1/) 之后我们在 [Day 76](/blog/agent-zero/day-076-week11-review/) 前后学过装饰器)。采样时不需要梯度,关掉省内存省时间。
- `out = model.generate(ids, attention_mask=torch.ones_like(ids), do_sample=True, temperature=1.0,` 采样而不是贪心,温度 1.0,按模型原本的概率分布抽。
- `top_p=1.0, top_k=0, repetition_penalty=1.0, max_new_tokens=MAX_NEW, num_return_sequences=G, pad_token_id=PAD)` 这一行很重要。Qwen2.5 的默认生成配置是 `top_p=0.8`、`top_k=20`、`repetition_penalty=1.05`,会把分布「修剪」过;GRPO 要的是模型**原本**的分布,所以全部显式关掉。TRL 的 `GRPOConfig` 里这几项默认也是 1.0、0(不限)、1.0。`num_return_sequences=G` 对同一个 prompt 一次生成 G 个回答,这就是 vLLM 的 `n` 参数在 transformers 里的样子,Day 579 用 DeepSeek 时只能发 4 次请求。
- `return out[:, ids.shape[1]:]` 切掉 prompt,只留回答部分,形状 (G, 回答长度)。4 个回答长短不一,短的后面会被填充成 `PAD`。
- `full = torch.cat([ids.repeat(len(comp), 1), comp], dim=1)` 把 prompt 复制 G 份,和 G 个回答拼起来,一次前向算完一组。`repeat(4, 1)` 是在第一维复制 4 份。
- `logits = model(full).logits[:, ids.shape[1] - 1:-1]` 只取「预测回答部分每个 token」的那些位置。和 Day 576 `seq_logp` 一样错开一位:位置 i 的 logits 预测的是第 i+1 个 token。
- `return F.log_softmax(logits, dim=-1).gather(2, comp.unsqueeze(-1)).squeeze(-1)` 每个回答 token 的 logprob,形状 (G, 回答长度)。和 Day 576 的区别是这里**不求和**,要按 token 留着,下面按 token 加权。
- `log.update({f"rewards/{f.__name__}/mean": [] for f in REWARD_FUNCS})` `f.__name__` 是函数的名字字符串,`format_reward`。TRL 日志里 `rewards/format_reward/mean` 这个名字就是这么来的,所以你的奖励函数名字会出现在日志里,起名要好认。
- `mask = (comp != PAD).float()` 填充位置是 0,真实 token(包括结尾的 `<|im_end|>`)是 1。填充的 token 不能参与损失。
- `cols = [f(completions=completions, expected=[case["expected"]] * G) for f in REWARD_FUNCS]` 按 TRL 的方式调用奖励函数:关键字参数,`expected` 是和回答一样长的列表(同一道题的 G 个回答,标准答案是同一个,所以复制 G 份)。
- `r = torch.tensor([sum(x) for x in zip(*cols)])` `zip(*cols)` 把「每个函数一列」转成「每个回答一行」,每行加起来就是这个回答的总奖励。权重都是 1,所以直接相加。
- `adv = (r - r.mean()) / (r.std() + 1e-4)` Day 579 的组内优势。注意 `torch` 的 `std()` 默认除以 n−1,和 TRL 一致;Day 579 用的 `pstdev` 除以 n,所以同一组分数这里算出来的优势会小一点,正负不变。
- `log["zero_std"].append(float(r.std() == 0))` 这组 4 个分数完全一样就记 1。四道题取平均就是 `frac_reward_zero_std`。
- `log["clipped"].append(1 - float((comp == END).any(dim=1).float().mean()))` 每个回答里有没有出现 `<|im_end|>`,没有就是写到 48 个 token 还没说完,被截断了。
- `n_tok += int(mask.sum())` 这一步所有回答的真实 token 总数,下面当分母。
- `loss = -(adv.unsqueeze(1) * logps * mask).sum() / n_tok` **整个 GRPO 的核心就这一行**。每个 token 的 logprob 乘上它所在回答的优势(同一个回答的每个 token 优势相同,`unsqueeze(1)` 把形状 (G,) 变成 (G, 1) 才能和 (G, 长度) 相乘),填充位置乘 0,全部加起来再除以整批的 token 总数。前面的负号是因为优化器做的是「让 loss 变小」,而我们要「让优势为正的回答概率变大」。除以整批 token 数而不是每个回答各自平均,就是 TRL 默认 `loss_type="dapo"` 的做法。Day 579 玩具里的 `grad += a * (onehot − p)`,在这里由 `backward()` 自动算出来。
- `loss.backward()` 一道题一道题地反向传播,梯度累加在 LoRA 参数上,4 道题都算完再更新一次。这样同时只有一组在内存里。
- `opt.step()` `opt.zero_grad()` 更新,清零。因为每批采样只更新一次(TRL 的 `num_iterations=1`),采样时的模型和更新时的模型是同一个,PPO 那套「新旧概率比」恒等于 1,裁剪不起作用,所以这里没写裁剪。`num_iterations` 大于 1 时就必须加上。
- `print(f"step {step:>2}  " + "  ".join(` 每步打印一行,指标名和 TRL 日志一致,方便你以后在 Colab 上对照着读。`flush=True` 让重定向到文件时也能实时看到。

</div>

跑起来,输出重定向到 `train.log`,开着它去做别的:

```bash
cd agent-zero-lab/part10/dpo-cpu
HF_HUB_OFFLINE=1 uv run python grpo_cpu.py ../data/grpo_train.jsonl > train.log 2>&1
```

@@TRAIN_SECTION@@

### 零件和大代码的对照

| 零件 | 在哪学的 | 今天的位置 |
| --- | --- | --- |
| 严格判分 `triage_reward` | Day 579 | `rewards.py` 的 `field_reward` 直接调它 |
| 组内优势 | Day 579 | `grpo_cpu.py` 的 `adv = (r - r.mean()) / (r.std() + 1e-4)` |
| 逐 token logprob | Day 576 | `grpo_cpu.py` 的 `token_logps`(不求和,按 token 留着) |
| LoRA、关 dropout、AdamW | Day 572、Day 576 | `grpo_cpu.py` 开头几行 |
| 评测集隔离、指纹黑名单 | Day 570、Day 574 | `make_grpo_data.py` |
| 期望得分 | Day 353 | `agent_reward.py` 的 `try_ev` |
| 先打一遍自己 | Day 406 | `hack_test.py` |

## 动手练习

1. **给奖励函数写单元测试**:用 pytest 给 `rewards.py` 写测试,至少覆盖:全对、多一个字段、不是 JSON、JSON 后面加字、布尔写成字符串(格式 0 分但字段分 0.75)、纯字符串格式的回答。

<details><summary>参考答案</summary>

先装 pytest,并让测试能导入 `part10/` 下的模块。[Day 73](/blog/agent-zero/day-073-pytest-3/) 的约定是 `pyproject.toml` 里 `[tool.pytest]` 写 `pythonpath = ["."]`,这里再加一个 `"part10"`:

```bash
uv add --dev pytest
```

```toml
[tool.pytest]
pythonpath = [".", "part10"]
testpaths = ["tests"]
```

新建 `tests/test_rewards.py`:

```python
# agent-zero-lab/tests/test_rewards.py
from rewards import field_reward, format_reward

GOLD = {"category": "refund", "needs_account_data": True, "needs_human": False, "urgency": "low"}
OK = '{"category": "refund", "needs_account_data": true, "needs_human": false, "urgency": "low"}'


def wrap(*texts: str) -> list:
    return [[{"role": "assistant", "content": t}] for t in texts]


def test_correct_gets_full_marks():
    assert format_reward(wrap(OK)) == [0.2]
    assert field_reward(wrap(OK), [GOLD]) == [1.0]


def test_extra_field_is_zero():
    extra = OK[:-1] + ', "reason": "退款进度"}'
    assert format_reward(wrap(extra)) == [0.0]
    assert field_reward(wrap(extra), [GOLD]) == [0.0]


def test_not_json_is_zero():
    assert format_reward(wrap("类别是 refund")) == [0.0]
    assert field_reward(wrap("类别是 refund"), [GOLD]) == [0.0]


def test_trailing_text_is_zero():
    assert format_reward(wrap(OK + " 已为您核实")) == [0.0]


def test_string_bool_fails_format_only():
    s = OK.replace('"needs_account_data": true', '"needs_account_data": "true"')
    assert format_reward(wrap(s)) == [0.0]
    assert field_reward(wrap(s), [GOLD]) == [0.75]


def test_plain_string_completion():
    assert format_reward([OK]) == [0.2]
```

<div class="line-notes">

- `def wrap(*texts: str) -> list:` `*texts` 收任意多个位置参数成一个元组,相当于 JS 的剩余参数 `...texts`。把纯文本包成 TRL 的对话格式,每个测试少写一堆括号。
- `extra = OK[:-1] + ', "reason": "退款进度"}'` `OK[:-1]` 去掉最后的 `}`,接上一个多余字段再补回 `}`。模型最常见的「多做一点」就是加个 `reason`。
- `assert field_reward(wrap(extra), [GOLD]) == [0.0]` 多一个字段,结果分也是 0,因为 `triage_reward` 要求字段集合完全一致。
- `s = OK.replace('"needs_account_data": true', '"needs_account_data": "true"')` 把布尔改成字符串。
- `assert field_reward(wrap(s), [GOLD]) == [0.75]` 字段分 0.75:`"true" == True` 在 Python 里是 `False`,这个字段算错,其他三个对。格式分是 0。两个函数各管各的,这个测试把这件事钉住了。
- `assert format_reward([OK]) == [0.2]` TRL 在纯文本格式的数据集上传进来的是字符串而不是消息列表,`_text` 两种都要接住。

</div>

```bash
uv run pytest -q
```

```text
......                                                                   [100%]
6 passed in 0.06s
```

奖励函数是训练流程里最该写测试的代码。它错了,训练不会报错,只会安安静静地把模型往错的方向推几个小时。

</details>

2. **找出转人工的临界点**:把 `agent_reward.py` 里自己办错的扣分从 −0.5 改成 −1.0(退错钱更严重),转人工成本分别是 0、0.3、0.5,模型对一张工单的把握 p 低于多少时会选择转人工?先手算,再写几行代码验证。

<details><summary>参考答案</summary>

手算:自己办的期望是 `p × 1 + (1 − p) × (−1) = 2p − 1`,转人工是 `−c`。令 `2p − 1 = −c`,得到临界点 `p* = (1 − c) / 2`。c=0 时 0.5,c=0.3 时 0.35,c=0.5 时 0.25。

在 `agent-zero-lab` 根目录用一段 Python 验证(不用新建文件):

```bash
uv run python -c "
for c in (0.0, 0.3, 0.5):
    ps = [p / 100 for p in range(101)]
    star = min(p for p in ps if p * 1.0 + (1 - p) * -1.0 >= -c)
    print(f'转人工扣 {c}: p < {star:.2f} 时转人工更划算,公式 (1-c)/2 = {(1 - c) / 2:.2f}')
"
```

<div class="line-notes">

- `ps = [p / 100 for p in range(101)]` 0.00 到 1.00,步长 0.01 的一串概率。
- `star = min(p for p in ps if p * 1.0 + (1 - p) * -1.0 >= -c)` 找「自己办的期望不低于转人工」的最小 p,也就是临界点。生成器表达式加 `min`,相当于 JS 的 `Math.min(...ps.filter(...))`。

</div>

```text
转人工扣 0.0: p < 0.50 时转人工更划算,公式 (1-c)/2 = 0.50
转人工扣 0.3: p < 0.35 时转人工更划算,公式 (1-c)/2 = 0.35
转人工扣 0.5: p < 0.25 时转人工更划算,公式 (1-c)/2 = 0.25
```

办错罚得越重,模型越倾向于转人工:同样转人工扣 0.3,办错扣 0.5 时临界点是 0.13,扣 1.0 时变成 0.35。这不一定是坏事,退款这种高风险操作,你可能就希望模型把握不到 35% 时转人工。重点是这个行为是**你通过权重选出来的**,不是训练完才发现的。上线后要监控实际的转人工率,和你算出来的预期对一对。

</details>

3. **加一条过程约束**:给退款 Agent 加规则「退款金额超过 500 元,`create_refund_request` 之前必须先调 `request_approval`,否则过程分 −1」。不改 `agent_reward.py`,新建一个文件在它的基础上扩展,并用四条轨迹验证:800 元没审批、800 元先审批、800 元退完才审批、149.5 元不审批。

<details><summary>参考答案</summary>

新建 `part10/agent_reward_v2.py`:

```python
# agent-zero-lab/part10/agent_reward_v2.py
"""在 agent_reward.py 上加一条过程约束:超过 500 元的退款,之前必须先调 request_approval。"""
import agent_reward
from agent_reward import C, INV

agent_reward.TOOLS.add("request_approval")
LIMIT = 500


def score(traj: list[dict], expected_amount: float) -> dict[str, float]:
    parts = agent_reward.score(traj, expected_amount)
    names = [s["tool"] for s in traj]
    big = [i for i, s in enumerate(traj) if s["tool"] == "create_refund_request" and s["args"]["amount"] > LIMIT]
    if big and ("request_approval" not in names or names.index("request_approval") > big[0]):
        parts["过程"] = -1.0
        parts["合计"] = round(sum(v for k, v in parts.items() if k != "合计"), 2)
    return parts


APPROVE = {"tool": "request_approval", "args": {"amount": 800.0}}
REFUND_800 = {"tool": "create_refund_request", "args": {"amount": 800.0}}
CASES = {
    "800 元没审批": ([C, INV, REFUND_800], 800.0),
    "800 元先审批": ([C, INV, APPROVE, REFUND_800], 800.0),
    "800 元退完才审批": ([C, INV, REFUND_800, APPROVE], 800.0),
    "149.5 元不用审批": ([C, INV, {"tool": "create_refund_request", "args": {"amount": 149.5}}], 149.5),
}
for name, (traj, amount) in CASES.items():
    print(f"{name:<10}", score(traj, amount))
```

<div class="line-notes">

- `agent_reward.TOOLS.add("request_approval")` 把新工具加进白名单,否则用了它格式分会变 0。改的是 `agent_reward` 模块里那个集合本身,`agent_reward.score` 读的就是它。
- `parts = agent_reward.score(traj, expected_amount)` 先用原来的四项打分,再在上面叠加新规则。不复制原函数,原函数以后改了这里自动跟上。
- `big = [i for i, s in enumerate(traj) if s["tool"] == "create_refund_request" and s["args"]["amount"] > LIMIT]` 找出所有大额退款所在的位置。`enumerate` 同时给出下标和元素。
- `if big and ("request_approval" not in names or names.index("request_approval") > big[0]):` 和「先查发票」同一个写法:根本没审批,或者审批出现在第一笔大额退款之后,都算违规。
- `parts["合计"] = round(sum(v for k, v in parts.items() if k != "合计"), 2)` 改了一项要重算合计,算的时候把旧的「合计」本身排除掉。

</div>

```bash
uv run python part10/agent_reward_v2.py
```

```text
800 元没审批   {'结果': 1.0, '格式': 0.1, '过程': -1.0, '效率': 0.0, '合计': 0.1}
800 元先审批   {'结果': 1.0, '格式': 0.1, '过程': 0.0, '效率': 0.0, '合计': 1.1}
800 元退完才审批 {'结果': 1.0, '格式': 0.1, '过程': -1.0, '效率': 0.0, '合计': 0.1}
149.5 元不用审批 {'结果': 1.0, '格式': 0.1, '过程': 0.0, '效率': 0.0, '合计': 1.1}
```

「退完才审批」也被罚了,这条最容易漏:只检查「有没有调过审批」的话,它能过。再问一次那个问题:只想刷分的模型会怎么钻这条规则?它可能对每一笔退款都先调一次审批,哪怕只有 10 块钱,因为审批不扣分。如果审批要占用财务的时间,就该给不必要的审批一个小成本,或者在效率项里把它算作一步。

</details>

4. **读训练日志**:写一个小脚本读 `train.log`,把 24 步分成前 8 步、中 8 步、后 8 步,分别算 `reward`、`rewards/format_reward/mean`、`rewards/field_reward/mean`、`frac_reward_zero_std` 的平均值。单步的数字抖得厉害,分段平均能不能看出趋势?

<details><summary>参考答案</summary>

@@EX4_ANSWER@@

</details>

验收标准:`rewards.py`、`agent_reward.py`、`hack_test.py` 的输出和本文一致;6 个单元测试全过;`grpo_cpu.py` 在你的机器上跑完 24 步并存下 `grpo_lora/`(具体数字和 CPU、库版本、随机性有关,不一定和我一字不差,但格式分应该能看出上升);`grpo_eval.py` 训练前后各跑一次,你能指着两份输出说出变好的是哪几个字段、没变好的是哪几个,以及为什么 dev 集不能出现在训练题里。今天不调付费 API,花费 0 元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 结果奖励 | 只看任务最终完成得对不对给分,最重要、最难作弊 |
| 格式奖励 | 输出能否解析、是否合 schema 的小分数,训练早期的拐杖 |
| 过程约束 | 对中间步骤的硬性要求(先查发票、先审批),违反直接重罚 |
| 效率惩罚 | 对步数、长度的轻微扣分,上限要小,否则模型学会少做事 |
| 奖励作弊(reward hacking) | 模型找到拿高分但没真正把事做好的办法,根源是奖励和真实目标之间有缝 |
| 规避任务 | 奖励作弊的一种:把难的任务甩出去(比如全转人工),因为甩出去不扣分或扣得少 |
| 对冲 | 把所有可能的答案都写上,让宽松的判分器总能找到对的那个 |
| 期望得分 | 按概率加权的平均分,模型在训练中追求的就是它 |
| `reward_weights` | TRL 里各奖励函数的权重,总奖励是加权和,不写就全是 1 |
| `num_generations` | TRL 里每道题采样几个回答,就是 GRPO 的组大小 G,默认 8 |
| `completions/clipped_ratio` | 写到长度上限还没结束、被截断的回答所占比例 |
| `loss_type="dapo"` | TRL 默认的损失归一化方式:整批所有 token 一起平均,而不是每个回答先各自平均 |

## 常见误区

**用宽松的解析当奖励。** `hack_test.py` 里「只看类别名在不在」那一列全是满分,连对冲答案也是满分。线上解析可以宽容,训练奖励必须严格,宽容什么模型就学什么。

**过程约束只扣一点分。** 模型会算账:跳过一步省下的麻烦,如果比扣的分值钱,它就跳。高风险步骤违规要罚到和结果奖励同一个量级,`agent_reward.py` 里是 −1.0。

**转人工不扣分。** 实跑的期望表里,转人工成本是 0 时,模型对一张工单把握不到三分之一就该转出去。训练出来的模型奖励好看,线上转人工率翻倍。

**只看训练 reward 涨了就算成功。** reward 涨可能是作弊,也可能只是随机抖动(今天单步之间抖得很厉害)。一定要在训练题之外的 dev 集上,用训练前后同一个脚本量一次,再人工翻几条输出。

**照抄模型的默认生成配置去采样。** Qwen2.5 默认 `top_p=0.8`、`top_k=20`、`repetition_penalty=1.05`。GRPO 采样要的是模型原本的分布,这些都要显式关掉,否则你在优化一个和采样时不一样的分布。

**以为 Intel Mac 也能直接 `uv add trl`。** PyTorch 最后一个 Intel Mac 安装包是 2.2.2,新版 TRL 装不上(Day 576 踩过)。要么手写训练循环,要么去 Colab。

## 学习资料

### 文档与文章

- [TRL · GRPO Trainer](https://huggingface.co/docs/trl/main/grpo_trainer):今天 Colab 脚本的依据。重点看奖励函数的参数约定(哪些参数会传进来、怎么返回 `None` 跳过某条)、`GRPOConfig` 参数表和 Logged metrics 一节。1 小时,英文。
- [Lilian Weng · Reward Hacking in Reinforcement Learning](https://lilianweng.github.io/posts/2024-11-28-reward-hacking/):奖励作弊最全的综述,挑「Hacking RLHF of LLMs」和「Hacking the Evaluator」两部分读。1 小时,英文。
- [Anthropic · From shortcuts to sabotage: Natural emergent misalignment from reward hacking](https://www.anthropic.com/research/emergent-misalignment-reward-hacking):2025 年 11 月,`sys.exit(0)` 让测试「通过」的例子出自这里,以及学会作弊以后模型在别处也变坏的发现。20 分钟,英文。
- [Thinking Machines · LoRA Without Regret](https://thinkingmachines.ai/blog/lora/):其中强化学习那一节解释了为什么低秩 LoRA 在 RL 里就够用。20 分钟,英文。
- [ReTool](https://arxiv.org/abs/2504.11536)、[Search-R1](https://arxiv.org/abs/2503.09516)、[RAGEN](https://arxiv.org/abs/2504.20073):多轮 Agent 强化学习的三个代表工作,分别教模型在推理中调代码解释器、决定什么时候搜索、研究多轮训练的不稳定。各读摘要和方法图,30 分钟。
- [Unsloth 强化学习指南](https://unsloth.ai/docs/get-started/reinforcement-learning-rl-guide):在单卡上跑 GRPO 的实践建议,包括奖励函数怎么写、显存怎么省。30 分钟,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1pXA5eyEEg&autoplay=0&high_quality=1" title="[LLM+RL] 理解 GRPO 公式原理及 TRL GrpoTrainer 代码实现(advantage 与 loss 计算)" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>五道口纳什 · [LLM+RL] 理解 GRPO 公式原理及 TRL GrpoTrainer 代码实现(advantage 与 loss 计算) · 48 分钟。对着 TRL 源码讲优势和损失怎么算,跑完 `grpo_cpu.py` 再看,能一一对上那行 `loss = -(adv ...)`。录制时 TRL 版本较老,默认的 `loss_type` 和 `beta` 已经变了,以今天正文为准。</figcaption>
</figure>

- 为什么叫QQ · [【人工智能】什么是强化学习中的奖励黑客](https://www.bilibili.com/video/BV1Hrq1YAEYe):正文已嵌入,15 分钟。
- 丁师兄大模型 · [面试官:你对于reward hacking有什么解决思路?](https://www.bilibili.com/video/BV1MJXZBgEu8):6 分钟,面试角度的回答框架,可以和自测第 5 题对照。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/uY7I1YrZB2M" title="Reward Hacking in LLMs Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Prompt Engineering · Reward Hacking in LLMs Explained · 英文,讲大模型训练里奖励作弊的几个真实案例,和今天的 `hack_test.py` 是同一个问题。</figcaption>
</figure>

- Adam Lucek · [Reinforcement Learning with Verifiable Rewards - Teaching LLMs to Solve Problems](https://www.youtube.com/watch?v=2HPKmgmi50E):英文,RLVR 从奖励函数到训练的完整演示,适合跑完今天的代码后再看一遍别人的写法。

### 书籍

- Nathan Lambert《RLHF Book》(在线免费,[rlhfbook.com](https://rlhfbook.com)):讲可验证奖励和奖励作弊的章节,比论文好读。
- Sebastian Raschka《Build a Reasoning Model (From Scratch)》(Manning):从零实现推理模型,有用 GRPO 做 RLVR 的章节,和今天手写训练循环的思路一致。代码见下面的仓库。

### 开源项目与代码

- [huggingface/trl](https://github.com/huggingface/trl):`trl/trainer/grpo_trainer.py` 里搜 `_compute_loss`,看 `loss_type` 几个分支的归一化写法,对照今天 `grpo_cpu.py` 的那一行。
- [volcengine/verl](https://github.com/volcengine/verl):字节跳动开源的大规模强化学习训练框架,很多多轮 Agent RL 研究基于它。今天不用,知道单卡以外的世界用什么。
- [rasbt/reasoning-from-scratch](https://github.com/rasbt/reasoning-from-scratch):上面那本书的代码。
- [unslothai/notebooks · Qwen3 (4B) GRPO](https://github.com/unslothai/notebooks/blob/main/nb/Qwen3_%284B%29-GRPO.ipynb):能直接在 Colab 跑的 GRPO 笔记本,想用 Unsloth 加速可以参考,注意它会钉死 TRL 版本。

## 自测

1. Agent 的奖励通常拆成哪四部分?它们的大小关系应该怎么排?为什么效率惩罚要设上限?

<details><summary>答案</summary>

结果、格式、过程约束、效率。结果最大;过程约束违规要罚到和结果同一量级;格式是小分数的拐杖;效率最小。效率设上限是因为罚多了模型会学会少做事,最省事的是什么都不做或者直接转人工。

</details>

2. 为什么分诊的奖励里不需要长度惩罚,而多步 Agent 需要效率惩罚?

<details><summary>答案</summary>

分诊的格式奖励和结果奖励都是严格解析,JSON 外面多一个字就是 0 分,长度已经被管住了。多步 Agent 的轨迹长短不影响能否解析,绕七步和三步都能办成,不加效率项模型就没有理由少绕。

</details>

3. `hack_test.py` 里「八个类别全写上」在三种判分下分别多少分?为什么「含类别名」那种判法特别危险?

<details><summary>答案</summary>

抠 JSON 0.75、含类别名 1.00、严格 0.75(而且格式奖励给 0)。「含类别名」对对冲答案给满分,训练时模型会发现把所有类别都写上永远不会错,奖励涨到满分,模型却完全没用。

</details>

4. `grpo_cpu.py` 里为什么要显式写 `top_p=1.0, top_k=0, repetition_penalty=1.0`?为什么没有写 PPO 的裁剪?

<details><summary>答案</summary>

Qwen2.5 的默认生成配置会修剪分布(top_p 0.8、top_k 20、重复惩罚 1.05),GRPO 要按模型原本的分布采样,否则采样分布和被优化的分布不一致。没写裁剪是因为每批采样只更新一次,更新时的模型和采样时一样,新旧概率比恒为 1,裁剪不起作用;多次更新(`num_iterations` 大于 1)时才需要。

</details>

5. (面试题)你们的客服 Agent 用强化学习训练后,离线奖励涨了 30%,上线一周转人工率从 8% 涨到 19%。你怎么分析?

<details><summary>答案</summary>

先怀疑规避任务:检查奖励里转人工的成本和办错的惩罚,算一下在什么把握下转人工的期望更高(像今天的期望表);抽样看新增的转人工工单,是不是模型其实能处理的。再检查奖励是否只在训练分布上涨,用独立评测集和人工盲评看真实质量。修法:给转人工一个和业务成本相称的扣分,或者按「本可以自己解决」单独惩罚;把转人工率作为训练和上线的监控指标,设上限;必要时回滚到旧模型。还要回答为什么离线没发现:离线评测里缺了「转人工率」这个指标,只看了奖励。

</details>

## 明天预告

Day 582 · 给 AgentOps 训练路由小模型:流水线、数据卡、模型卡。这一周从 Day 570 到今天,我们攒了一堆实验脚本:造数据、打标、置信度、扫阈值、DPO、GRPO。明天把分诊路由这条线整理成一条能一条命令重跑的流水线,给数据记清单和哈希,再写出数据卡和模型卡,让一个没参与过的同事也能看懂这个模型能做什么、不能做什么、出了事怎么回滚。
