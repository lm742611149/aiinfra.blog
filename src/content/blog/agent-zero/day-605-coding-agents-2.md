---
title: 'Day 605 · Coding Agent 内部(二):OpenHands、Codex、SWE-bench、怎么找到要改的地方'
description: '接着拆 Coding Agent:读 OpenHands 的卡死检测和 Codex 的 apply_patch、两层沙箱,用 SWE-bench 的规则给自己的 Agent 判分,再看仓库大了以后模型靠什么找到要改的那几行。实跑里 Agent 跑出了仓库,于是当场给它加了一层 macOS 沙箱。'
pubDate: 2026-10-22
regime: none
tags: ['coding-agent', 'openhands', 'codex', 'swe-bench', 'sandbox', 'agent-zero']
series: 'agent-zero'
day: 605
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 604](/blog/agent-zero/day-604-coding-agents-1/) 把 Coding Agent 拆成了五块(工具集、上下文、执行环境、验证、停止与兜底),读了 SWE-agent 和 mini-swe-agent 这对「同一个团队、两种相反选择」的项目,自己写了分窗查看、带校验的 `str_replace`,还有一个只有 bash 工具的 `bash_agent.py`,它用 4 步修好了 `apply_discount` 的 bug。那个仓库只有一个源码文件,模型 `grep` 一下就找到了。今天换一个大一点的仓库,并且补上五块里昨天没细讲的两块:⑤卡死了怎么办,②仓库大了怎么找到要改的地方。

## 今天要解决的问题

学完今天你应该能:

1. 讲清 OpenHands 的卡死检测认哪几种模式、阈值多少、为什么先提醒再停,并且自己实现一个能通过测试的简化版。
2. 说出 Codex 在编辑(apply_patch)和执行(系统沙箱加命令策略)上的设计,以及为什么两层都要。
3. 用 SWE-bench 的 FAIL_TO_PASS / PASS_TO_PASS 规则给自己的 Agent 判分,并且能举出一个「目标测试全过但仍然不算解决」的补丁。
4. 比较三种定位代码的办法(agentic search、repo map、向量检索),知道什么时候用哪个,怎么用实验证明。

今天的两个新概念是**卡死检测**和**定位**。SWE-bench 在 [Day 558](/blog/agent-zero/day-558-bench-1/) 拆过,今天只是拿它的判分规则来用;沙箱在 [Day 415](/blog/agent-zero/day-415-sandbox/) 讲过,今天看 Codex 怎么落地,并且因为一次真实翻车,我们会在 macOS 上当场加一层。

预计用时 3 小时,读源码约 50 分钟。前置:[Day 604](/blog/agent-zero/day-604-coding-agents-1/) 的 `bash_agent.py`、`edit_tool.py`;[Day 248](/blog/agent-zero/day-248-code-retrieval/) 的 repo map;[Day 263](/blog/agent-zero/day-263-compaction/) 的上下文压缩。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `stuck_detector.py` 的 `check()` 和 `judge.py` 的判定逻辑默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先造一个大一点的仓库

昨天的 `toy_repo` 只有一个 27 行的文件,今天要讲「找到要改的地方」,得有几个文件让模型挑。新仓库还是云簿 CloudLedger,有套餐、优惠券、税、客户、报表、日期几个模块,bug 藏在 issue 里没提到的地方。

这个 bug 是一个真实世界里很常见的浮点问题。系统内部用「分」存金额(整数),换算用 `int(yuan * 100)`。看着没毛病,但 `19.99 * 100` 在浮点数里是 `1998.9999999999998`,`int()` 直接截掉小数,变成 1998 分,发票上就少了一分钱。JS 里一样有这个坑,`19.99 * 100` 在浏览器控制台里也是 `1998.9999999999998`,`Math.trunc` 之后同样是 1998。

```python
# agent-zero-lab/part10/coding_agent/make_repo2.py
"""造一个大一点的仓库 toy_repo2/:9 个源码文件,bug 藏在 issue 里没提到的文件里。"""
import shutil
from pathlib import Path

ROOT = Path(__file__).parent / "toy_repo2"

FILES = {
    "cloudledger/__init__.py": "",
    "cloudledger/currency.py": '''"""金额换算:系统内部一律用「分」存整数,避免浮点误差。"""


def to_cents(yuan: float) -> int:
    return int(yuan * 100)


def from_cents(cents: int) -> float:
    return cents / 100


def fmt(cents: int) -> str:
    return f"¥{cents / 100:.2f}"
''',
    "cloudledger/plans.py": '''PLANS = {
    "basic": {"name": "基础版", "monthly": 19.99},
    "pro": {"name": "专业版", "monthly": 49.9},
    "team": {"name": "团队版", "monthly": 99.9},
}


def get_plan(plan_id: str) -> dict:
    if plan_id not in PLANS:
        raise KeyError(f"没有这个套餐:{plan_id}")
    return PLANS[plan_id]
''',
    "cloudledger/discount.py": '''COUPONS = {"SAVE10": 10, "HALF": 50}


def apply_coupon(cents: int, code: str) -> int:
    if code not in COUPONS:
        raise ValueError(f"优惠券无效:{code}")
    return cents * (100 - COUPONS[code]) // 100
''',
    "cloudledger/tax.py": '''VAT = 6  # 增值税 6%


def add_tax(cents: int, rate: int = VAT) -> int:
    return cents + cents * rate // 100
''',
    "cloudledger/invoice.py": '''from .currency import to_cents
from .discount import apply_coupon
from .plans import get_plan


def line_total(plan_id: str, months: int) -> int:
    plan = get_plan(plan_id)
    return to_cents(plan["monthly"] * months)


def invoice_total(plan_id: str, months: int, coupon: str | None = None) -> int:
    total = line_total(plan_id, months)
    if coupon:
        total = apply_coupon(total, coupon)
    return total
''',
    "cloudledger/customers.py": '''from dataclasses import dataclass


@dataclass
class Customer:
    id: str
    name: str
    plan_id: str
    months_paid: int = 0


CUSTOMERS = [
    Customer("C001", "星河科技", "pro", 12),
    Customer("C002", "青禾工作室", "basic", 1),
    Customer("C003", "北辰物流", "team", 24),
]


def find_customer(customer_id: str) -> Customer | None:
    return next((c for c in CUSTOMERS if c.id == customer_id), None)
''',
    "cloudledger/reports.py": '''from .currency import fmt
from .customers import CUSTOMERS
from .invoice import invoice_total


def revenue_report() -> str:
    lines, total = [], 0
    for c in CUSTOMERS:
        amount = invoice_total(c.plan_id, c.months_paid)
        total += amount
        lines.append(f"{c.id} {c.name:<6} {fmt(amount):>12}")
    lines.append(f"合计 {fmt(total):>18}")
    return "\\n".join(lines)
''',
    "cloudledger/dates.py": '''import calendar
from datetime import date


def days_in_month(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def next_billing_date(d: date) -> date:
    year, month = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return date(year, month, min(d.day, days_in_month(year, month)))
''',
    "tests/test_currency.py": '''from cloudledger.currency import fmt, from_cents, to_cents


def test_to_cents_rounding():
    assert to_cents(0.29) == 29


def test_from_cents():
    assert from_cents(1999) == 19.99


def test_fmt():
    assert fmt(119880) == "¥1198.80"
''',
    "tests/test_invoice.py": '''import pytest

from cloudledger.invoice import invoice_total


def test_basic_one_month():
    assert invoice_total("basic", 1) == 1999


def test_team_annual():
    assert invoice_total("team", 12) == 119880


def test_coupon():
    assert invoice_total("pro", 2, "SAVE10") == 8982


def test_unknown_coupon():
    with pytest.raises(ValueError):
        invoice_total("pro", 1, "FREE")
''',
    "pytest.ini": "[pytest]\npythonpath = .\n",
}


def main() -> None:
    if ROOT.exists():
        shutil.rmtree(ROOT)
    for rel, body in FILES.items():
        f = ROOT / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(body, encoding="utf-8")
    src = sorted(ROOT.glob("cloudledger/*.py"))
    lines = sum(len(f.read_text(encoding="utf-8").splitlines()) for f in src)
    print(f"已生成 {ROOT.name}/:{len(src)} 个源码文件,共 {lines} 行")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `FILES = {` 一个字典,键是相对路径,值是文件内容。比昨天每个文件写一行 `write_text` 省事,加文件只要加一项。相当于 JS 里 `const FILES = { "a/b.py": "..." }`。
- `def to_cents(yuan: float) -> int:` bug 在这里。`int()` 是向零截断,不是四舍五入。
- `return int(yuan * 100)` 实测 `int(19.99 * 100)` 是 1998,`int(0.29 * 100)` 是 28。但 `int(49.9 * 100)` 是 4990,碰巧是对的,所以这个 bug 只在某些价格上出现,很像真实线上 bug 的样子。
- `"pro": {"name": "专业版", "monthly": 49.9},` 三个套餐的月价,19.99 会触发 bug,49.9 和 99.9 在常见月数下不触发。
- `return cents * (100 - COUPONS[code]) // 100` 优惠券在「分」上算,`//` 是整除。专业版 2 个月 9980 分用 SAVE10:9980 × 90 // 100 = 8982。
- `return to_cents(plan["monthly"] * months)` 发票金额先用元相乘再换算成分,bug 从这里传出去。issue 里用户只会说「发票少了一分钱」,不会说 `currency.py`。
- `CUSTOMERS = [` 几个和 bug 无关的模块(客户、报表、日期),作用是让仓库里有干扰项,模型得自己判断该看哪几个。
- `def test_to_cents_rounding():` 这个测试现在失败(28 ≠ 29),修好后应该通过。
- `def test_team_annual():` 团队版 99.9 元 × 12 个月 = 119880 分。现在是通过的,下面会看到一个「看起来修好了」的补丁把它改挂。
- `def test_unknown_coupon():` 无效优惠券要抛 `ValueError`。`pytest.raises` 相当于 jest 的 `expect(() => ...).toThrow()`。
- `"pytest.ini": "[pytest]\npythonpath = .\n",` 和昨天一样,让测试能导入 `cloudledger`。
- `src = sorted(ROOT.glob("cloudledger/*.py"))` 统计源码文件数和总行数打印出来。

</div>

```bash
cd agent-zero-lab
uv run python part10/coding_agent/make_repo2.py
cd part10/coding_agent/toy_repo2 && uv run pytest -q | tail -3
uv run python -c "from cloudledger.reports import revenue_report; print(revenue_report())"
cd ../../..
```

真实输出:

```text
已生成 toy_repo2/:9 个源码文件,共 95 行
FAILED tests/test_currency.py::test_to_cents_rounding - assert 28 == 29
FAILED tests/test_invoice.py::test_basic_one_month - AssertionError: assert 1...
2 failed, 5 passed in 0.05s
C001 星河科技        ¥598.79
C002 青禾工作室        ¥19.98
C003 北辰物流       ¥2397.60
合计           ¥3016.37
```

报表里星河科技(专业版 12 个月,49.9 × 12 = 598.8)也少了一分,说明 bug 不止出现在 19.99 上。2 个测试失败,5 个通过。这 2 和 5 待会儿判分时要用。

## SWE-bench 怎么判分:先给自己做一个裁判

[Day 558](/blog/agent-zero/day-558-bench-1/) 拆过 SWE-bench:从 12 个热门 Python 仓库收集了 2,294 个真实 issue 和对应的修复 PR,后来 OpenAI 和原作者人工筛出 500 道成了 SWE-bench Verified。每道题判分时跑两组测试。

**FAIL_TO_PASS**:修复前失败、修复后应该通过的测试,证明你修好了。**PASS_TO_PASS**:修复前就通过、修复后也必须通过的测试,证明你没把别的东西改坏。两组全过才算 resolved。

在我们的仓库里,FAIL_TO_PASS 就是刚才失败的那 2 个,PASS_TO_PASS 是通过的那 5 个。写一个裁判脚本,以后每次 Agent 跑完都用它判。

```python
# agent-zero-lab/part10/coding_agent/judge.py
"""照 SWE-bench 的规则判一道题:FAIL_TO_PASS 全过、PASS_TO_PASS 全过,才算解决。"""
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).parent / "toy_repo2"
FAIL_TO_PASS = ["tests/test_currency.py::test_to_cents_rounding",
                "tests/test_invoice.py::test_basic_one_month"]
PASS_TO_PASS = ["tests/test_currency.py::test_from_cents",
                "tests/test_currency.py::test_fmt",
                "tests/test_invoice.py::test_team_annual",
                "tests/test_invoice.py::test_coupon",
                "tests/test_invoice.py::test_unknown_coupon"]


def passed(test_id: str) -> bool:
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", test_id], cwd=REPO, capture_output=True)
    return r.returncode == 0


def judge() -> bool:
    f2p = {t: passed(t) for t in FAIL_TO_PASS}
    p2p = {t: passed(t) for t in PASS_TO_PASS}
    for name, group in (("FAIL_TO_PASS", f2p), ("PASS_TO_PASS", p2p)):
        bad = [t.split("::")[1] for t, ok in group.items() if not ok]
        print(f"{name}: {sum(group.values())}/{len(group)} 通过" + (f",没过:{bad}" if bad else ""))
    resolved = all(f2p.values()) and all(p2p.values())
    print("判定:", "resolved" if resolved else "not resolved")
    return resolved


if __name__ == "__main__":
    judge()
```

<div class="line-notes">

- `FAIL_TO_PASS = ["tests/test_currency.py::test_to_cents_rounding",` 测试 id 的写法是「文件路径::函数名」,pytest 能只跑这一个测试([Day 72](/blog/agent-zero/day-072-pytest-2/) 讲过只跑一个测试)。SWE-bench 的数据集里每道题也是这样存了两个列表。
- `PASS_TO_PASS = ["tests/test_currency.py::test_from_cents",` 修复前就通过的 5 个。
- `r = subprocess.run([sys.executable, "-m", "pytest", "-q", test_id], cwd=REPO, capture_output=True)` 每个测试单独跑一次。`sys.executable` 是当前正在运行的 Python 解释器的路径,用它而不是写死 `python`,保证用的是 `.venv` 里那个有 pytest 的。这里传的是列表而不是字符串,没有 `shell=True`,参数不经过 shell 解释,更安全。
- `return r.returncode == 0` pytest 全部通过时返回码是 0,有失败是 1。
- `f2p = {t: passed(t) for t in FAIL_TO_PASS}` 字典推导式,得到 `{测试id: 是否通过}`,相当于 JS 的 `Object.fromEntries(list.map(t => [t, passed(t)]))`。
- `bad = [t.split("::")[1] for t, ok in group.items() if not ok]` 挑出没过的,只留函数名方便看。
- `print(f"{name}: {sum(group.values())}/{len(group)} 通过" + (f",没过:{bad}" if bad else ""))` `sum` 一组布尔值,True 算 1,所以就是通过的个数。
- `resolved = all(f2p.values()) and all(p2p.values())` 判分规则就这一行:两组都全过。`all` 相当于 JS 的 `Array.prototype.every`。

</div>

先在没修的仓库上跑一次,确认裁判本身是对的:

```bash
cd part10/coding_agent && uv run python judge.py
```

```text
FAIL_TO_PASS: 0/2 通过,没过:['test_to_cents_rounding', 'test_basic_one_month']
PASS_TO_PASS: 5/5 通过
判定: not resolved
```

### 一个「看起来修好了」的补丁

现在演示 PASS_TO_PASS 为什么必须有。假设 Agent 想:截断会少一分,那改成向上取整不就行了?用昨天的 `str_replace` 打这个补丁:

```python
# agent-zero-lab/part10/coding_agent/bad_patch.py
"""一个「看起来修好了」的补丁:把截断改成向上取整。"""
from edit_tool import str_replace

f = "toy_repo2/cloudledger/currency.py"
print(str_replace(f, "def to_cents(yuan: float) -> int:\n    return int(yuan * 100)",
                  "def to_cents(yuan: float) -> int:\n    return math.ceil(yuan * 100)"))
print(str_replace(f, '"""金额换算:系统内部一律用「分」存整数,避免浮点误差。"""\n',
                  '"""金额换算:系统内部一律用「分」存整数,避免浮点误差。"""\nimport math\n'))
```

<div class="line-notes">

- `from edit_tool import str_replace` Day 604 写的带校验的替换工具,在 `part10/coding_agent/` 目录里直接导入。
- `print(str_replace(f, "def to_cents(yuan: float) -> int:\n    return int(yuan * 100)",` old 带上函数定义那一行,保证只匹配一处。`math.ceil` 是向上取整,相当于 JS 的 `Math.ceil`。
- `'"""金额换算:系统内部一律用「分」存整数,避免浮点误差。"""\nimport math\n'))` 第二处改动是在文件开头加 `import math`。注意顺序:先改函数再加 import 也能过,因为 `ast.parse` 只检查语法,不检查 `math` 有没有导入,这是语法检查的边界。

</div>

```bash
uv run python make_repo2.py > /dev/null && uv run python bad_patch.py && uv run python judge.py
```

真实输出:

```text
已修改 toy_repo2/cloudledger/currency.py 第 4 行附近。
已修改 toy_repo2/cloudledger/currency.py 第 1 行附近。
FAIL_TO_PASS: 2/2 通过
PASS_TO_PASS: 4/5 通过,没过:['test_team_annual']
判定: not resolved
```

目标测试全过了,如果只看 FAIL_TO_PASS,这个补丁就是「修好了」。但 `test_team_annual` 挂了:`99.9 * 12 * 100` 在浮点里是 `119880.00000000001`,向上取整变成 119881,团队版年付多收一分钱。从少收一分变成多收一分,客户投诉的方向变了而已。

再换成正确的修法(四舍五入):

```bash
uv run python make_repo2.py > /dev/null
uv run python -c "
from edit_tool import str_replace
print(str_replace('toy_repo2/cloudledger/currency.py', 'return int(yuan * 100)', 'return round(yuan * 100)'))"
uv run python judge.py; cd ../..
```

```text
已修改 toy_repo2/cloudledger/currency.py 第 5 行附近。
FAIL_TO_PASS: 2/2 通过
PASS_TO_PASS: 5/5 通过
判定: resolved
```

这就是 SWE-bench 设两组测试的原因。读榜单时还要记住三件事,Day 558 讲过,这里提一句:题目和答案都是公开的,模型可能见过;榜单分数是「模型加框架」的组合分,同一个模型换框架能差很多,mini-swe-agent 的用处之一就是当统一框架;它只测 Python 修 bug,不代表写新功能和重构的能力。今天的实跑里还能看到一个有意思的痕迹,后面会讲。

## OpenHands:卡死了先提醒,再停

OpenHands(前身 OpenDevin)走的是平台路线。2026 年它的仓库结构变化挺大,先说清楚免得你找不到代码:`OpenHands/OpenHands` 主仓库现在是一个叫 Agent Canvas 的自托管控制台,README 第一行写的是「The self-hosted developer control center for coding agents and automations」,可以跑 OpenHands 自己的 Agent,也可以通过 ACP(Agent Client Protocol)跑 Claude Code、Codex、Gemini CLI 这些第三方 Agent。真正的 Agent 核心在 `OpenHands/software-agent-sdk` 仓库里,读源码去这个。

```bash
cd ~/src && git clone --depth 1 https://github.com/OpenHands/software-agent-sdk.git
cd software-agent-sdk && ls openhands-tools/openhands/tools/
grep -n '^version' openhands-sdk/pyproject.toml
```

我 2026-10-22 拉的(最新提交 2026-10-21),真实输出:

```text
AGENTS.md  __init__.py  apply_patch  ask_oracle  browser_use  child_conversation  delegate
file_editor  gemini  glob  grep  planning_file_editor  preset  py.typed  task  task_tracker
terminal  tom_consult  utils  workflow
version = "1.57.0"
```

和 mini-swe-agent 只有 bash 正好相反,这里每个工具一个目录:`terminal` 是跑命令,`file_editor` 是编辑(str_replace 形态),`grep` 和 `glob` 是独立的搜索工具而不是让模型在终端里敲,`task_tracker` 就是 [Day 177](/blog/agent-zero/day-177-todo-reflection/) 讲过的待办清单,`delegate` 是派子 Agent,`apply_patch` 是兼容 Codex 那种补丁格式。

两个核心设计值得记住。一个是**事件流**(event stream):Agent 的每个动作、每个观察都是一个事件存下来,可以回放、可以从中间恢复、可以拿去做评测,这在 OpenHands 论文(arXiv 2407.16741)里就有,一直保留到现在。另一个是**上下文压缩器**(condenser),在 `openhands-sdk/openhands/sdk/context/condenser/` 下,`llm_summarizing_condenser.py` 里的 `LLMSummarizingCondenser` 默认 `max_size=240`、`keep_first=2`:事件超过 240 个时,保留最前面 2 个,把较早的一段用模型总结成一段摘要。这和 [Day 263](/blog/agent-zero/day-263-compaction/) 你写的压缩是同一个思路,这里是生产实现。

今天要细读的是第三个:**卡死检测**。

### 卡死检测是什么

卡死检测(stuck detection)就是程序在旁边盯着 Agent 的最近几步,发现它在原地打转就干预。为什么需要?模型不会自己意识到「我已经第四次执行同一个命令了」。它每一步只看到「上一个命令报错了,那我再试一次」,在它眼里每次都是合理的。你在前端调试时也见过类似的东西:一个 `useEffect` 依赖写错了导致无限重渲染,React 会报「Maximum update depth exceeded」把它掐断,卡死检测就是 Agent 循环里的这个保险丝。

打开 `openhands-sdk/openhands/sdk/conversation/stuck_detector.py`,开头的类注释列了五种模式:

```text
    1. Repeating action-observation cycles
    2. Repeating action-error cycles
    3. Agent monologue (repeated messages without user input)
    4. Repeating alternating action-observation patterns
    5. Context window errors indicating memory issues
```

依次是:同一个动作得到同一个结果、同一个动作得到同一个报错、模型自言自语(连续说话不干活)、两个动作来回交替、上下文窗口报错。第 5 种我读源码时发现目前是空实现,`_is_stuck_context_window_error` 直接 `return False`,注释写着 `# TODO: blocked by` 一个 issue。注释写了不等于实现了,读源码就是要看到这一层。

阈值在 `conversation/types.py` 的 `StuckDetectionThresholds` 里:

```text
    action_observation: int = Field(default=4, ...
    action_error: int = Field(default=3, ...
    monologue: int = Field(default=3, ...
    alternating_pattern: int = Field(default=6, ...
```

扫描范围在 `stuck_detector.py` 开头:`MAX_EVENTS_TO_SCAN_FOR_STUCK_DETECTION: int = 20`,只看最近 20 个事件,不读全量历史,长对话也不会变慢。

最值得学的是它怎么干预。`conversation/impl/local_conversation.py` 里的 `_check_stuck_or_nudge()` 先调 `get_action_error_nudge()`:同一个报错第一次连续出现 3 次时,插入一条消息提醒模型,原文是「You've called `{tool}` with the same arguments 3 times in a row and gotten the same error each time ... Repeating the exact same call again will not work」,然后继续跑;如果提醒之后还是同样的错(`is_stuck()` 里给报错模式多留了一对,也就是第 4 次),才把状态设成 STUCK 停下来。**先提醒,再停**。很多时候提醒一句模型就会换思路,直接杀掉反而浪费了前面的进度。

### 自己写一个简化版

照着 OpenHands 的阈值写一个 30 行的版本,认三种模式:同结果重复、同报错重复(先提醒后停)、两个动作来回交替。

```python
# agent-zero-lab/part10/coding_agent/stuck_detector.py
"""简化版的 OpenHands StuckDetector:只看最近 20 步,认三种打转模式。阈值和 OpenHands 默认值一致。"""
from dataclasses import dataclass

WINDOW = 20        # 只扫最近多少步(OpenHands: MAX_EVENTS_TO_SCAN_FOR_STUCK_DETECTION = 20)
REPEAT = 4         # 同一动作、同一结果连续几次算卡死(action_observation = 4)
ERROR_NUDGE = 3    # 同一动作、同一报错连续几次先提醒(action_error = 3),再多一次就算卡死
ALTERNATE = 6      # 最近几步呈 A B A B A B 算卡死(alternating_pattern = 6)


@dataclass(frozen=True)
class Step:
    action: str        # 这一步执行的命令,比如 "cat billing/invoce.py"
    observation: str   # 命令输出(截一段就够)
    is_error: bool     # 返回码不是 0


def tail_same(steps: list[Step], n: int) -> bool:
    tail = steps[-n:]
    return len(tail) == n and len({(s.action, s.observation) for s in tail}) == 1


def check(steps: list[Step]) -> str | None:
    """返回 None 表示正常;'nudge:...' 表示该提醒一句;'stuck:...' 表示该停了。"""
    recent = steps[-WINDOW:]
    if tail_same(recent, ERROR_NUDGE + 1) and recent[-1].is_error:
        return f"stuck:同一个命令连续 {ERROR_NUDGE + 1} 次报同样的错"
    if tail_same(recent, REPEAT):
        return f"stuck:同一个命令连续 {REPEAT} 次、结果完全一样"
    if tail_same(recent, ERROR_NUDGE) and recent[-1].is_error:
        return (f"nudge:你已经连续 {ERROR_NUDGE} 次执行 `{recent[-1].action}` 并得到同样的错误。"
                "再重复一样的命令不会有用,先读报错,改参数或者换个办法。")
    tail = recent[-ALTERNATE:]
    if len(tail) == ALTERNATE and tail[0] != tail[1] and all(tail[i] == tail[i + 2] for i in range(ALTERNATE - 2)):
        return f"stuck:在两个命令之间来回切换了 {ALTERNATE // 2} 轮"
    return None
```

<div class="line-notes">

- `WINDOW = 20        # 只扫最近多少步(OpenHands: MAX_EVENTS_TO_SCAN_FOR_STUCK_DETECTION = 20)` 常量全大写是 Python 的约定,相当于 JS 里 `const WINDOW = 20`。每个阈值后面注明 OpenHands 里对应的名字,方便对照源码。
- `ERROR_NUDGE = 3    # 同一动作、同一报错连续几次先提醒(action_error = 3),再多一次就算卡死` 报错这一类有两级:3 次提醒,4 次停。
- `@dataclass(frozen=True)` dataclass 自动生成构造函数和 `==` 比较;`frozen=True` 表示创建后不能改,而且可以放进集合里(下面 `tail_same` 要用)。相当于一个只读的 TS 接口加一个自动的深比较。
- `action: str        # 这一步执行的命令,比如 "cat billing/invoce.py"` 我们的 Agent 只有 bash 一个工具,所以「动作」就是命令字符串。多工具的 Agent 要把工具名和参数一起规范化成字符串。
- `observation: str   # 命令输出(截一段就够)` 只存前 200 个字符,比较时够用,也省内存。
- `tail = steps[-n:]` 取最后 n 个。`[-n:]` 是 Python 的负数切片,相当于 JS 的 `steps.slice(-n)`。
- `return len(tail) == n and len({(s.action, s.observation) for s in tail}) == 1` 把最后 n 步的「(动作, 结果)」放进一个集合,集合会自动去重,去重后只剩 1 个说明 n 步完全一样。不够 n 步直接返回 False。
- `recent = steps[-WINDOW:]` 只看最近 20 步。一个 Agent 在第 3 到 6 步打过转、后来恢复正常了,不该在第 30 步还因为那段历史被判卡死。测试 `test_only_recent_window` 专门测这个。
- `if tail_same(recent, ERROR_NUDGE + 1) and recent[-1].is_error:` 先判最严重的:同一个错 4 次,停。顺序很重要,如果先判 3 次的提醒,第 4 次也会命中提醒,永远停不下来。
- `if tail_same(recent, REPEAT):` 同样的命令、同样的输出连续 4 次,不管是不是报错都停。比如模型一直 `cat` 同一个文件。
- `if tail_same(recent, ERROR_NUDGE) and recent[-1].is_error:` 同一个错 3 次,返回提醒文字。提醒的写法照 OpenHands:点明重复了几次、重复没有用、该怎么办。
- `if len(tail) == ALTERNATE and tail[0] != tail[1] and all(tail[i] == tail[i + 2] for i in range(ALTERNATE - 2)):` 交替模式:第 0 步和第 1 步不同,并且每一步都和隔一步的那步相同,就是 A B A B A B。`tail[0] != tail[1]` 排除了全部相同的情况(那归上面的重复模式管)。
- `return None` 没发现问题。返回值用字符串前缀区分「提醒」和「停」,调用方用 `startswith` 判断,简单直接。

</div>

测试先写好,每种模式一个:

```python
# agent-zero-lab/part10/coding_agent/test_stuck.py
from stuck_detector import Step, check

ERR = Step("cat billing/invoce.py", "cat: billing/invoce.py: No such file or directory", True)
OK = Step("ls", "billing tests", False)


def test_normal_progress():
    steps = [Step(f"sed -n '{i},{i + 9}p' a.py", f"第 {i} 段", False) for i in range(1, 30, 10)]
    assert check(steps) is None


def test_same_error_nudge_then_stuck():
    assert check([OK, ERR, ERR]) is None
    assert (check([OK, ERR, ERR, ERR]) or "").startswith("nudge:")
    assert (check([OK, ERR, ERR, ERR, ERR]) or "").startswith("stuck:同一个命令连续 4 次报同样的错")


def test_same_output_repeated():
    assert check([OK] * 3) is None
    assert check([OK] * 4) == "stuck:同一个命令连续 4 次、结果完全一样"


def test_alternating():
    a, b = Step("cat a.py", "A", False), Step("cat b.py", "B", False)
    assert check([a, b] * 2) is None
    assert check([a, b] * 3) == "stuck:在两个命令之间来回切换了 3 轮"


def test_only_recent_window():
    old_loop = [ERR] * 4
    fresh = [Step(f"cmd {i}", str(i), False) for i in range(20)]
    assert check(old_loop + fresh) is None
```

<div class="line-notes">

- `ERR = Step("cat billing/invoce.py", "cat: billing/invoce.py: No such file or directory", True)` 一个典型的报错步骤:路径拼错了。报错文字是 macOS `cat` 的真实写法。
- `steps = [Step(f"sed -n '{i},{i + 9}p' a.py", f"第 {i} 段", False) for i in range(1, 30, 10)]` 正常推进:分三次看文件的不同段,命令和结果都不同,不该报警。`range(1, 30, 10)` 是 1、11、21。
- `assert check([OK, ERR, ERR]) is None` 同一个错 2 次,还不到阈值。
- `assert (check([OK, ERR, ERR, ERR]) or "").startswith("nudge:")` 3 次,提醒。`check()` 可能返回 None,`or ""` 把 None 换成空串再调 `startswith`,这样类型检查器(basedpyright)不会报「None 没有 startswith」。
- `assert check([OK] * 4) == "stuck:同一个命令连续 4 次、结果完全一样"` `[OK] * 4` 是把列表重复 4 遍,相当于 JS 的 `Array(4).fill(OK)`。
- `assert check([a, b] * 2) is None` A B A B 只有 2 轮,不到 6 步。
- `fresh = [Step(f"cmd {i}", str(i), False) for i in range(20)]` 前面 4 次同错之后又正常走了 20 步,窗口里已经看不到那段打转了。

</div>

```bash
cd part10/coding_agent && uv run pytest -q test_stuck.py; cd ../..
```

```text
.....                                                                    [100%]
5 passed in 0.03s
```

### 接进 Agent,用假模型演示一次

接下来把检测器接进昨天的 Agent,写成 `bash_agent_v2.py`。完整代码放在后面「定位」那一节一起讲,因为它还加了别的东西。这里先用一个不花钱的「假模型」演示卡死检测的效果:这个假模型每次都回同一个命令,而且路径是拼错的。

```python
# agent-zero-lab/part10/coding_agent/fake_llm.py
"""一个不花钱的假模型:每次都回同一个命令,用来演示卡死检测。"""
from dataclasses import dataclass, field
from typing import Any

from common.llm import Ledger


@dataclass
class Reply:
    message: dict[str, Any]


@dataclass
class StubbornLLM:
    command: str
    ledger: Ledger = field(default_factory=Ledger)
    calls: int = 0

    def chat(self, messages: list[dict[str, Any]], **kw: Any) -> Reply:
        self.calls += 1
        call = {"id": f"call_{self.calls}", "type": "function",
                "function": {"name": "bash", "arguments": '{"command": "%s"}' % self.command}}
        return Reply({"role": "assistant", "content": "", "tool_calls": [call]})
```

<div class="line-notes">

- `from common.llm import Ledger` 借用 LLMClient 的账本类,假模型也有 `ledger` 属性,Agent 代码里读 `llm.ledger.cost` 不会出错。花费永远是 0。
- `class Reply:` 只需要 `message` 一个字段,因为 Agent 只用到了 `r.message`。这种「只实现被用到的那部分接口」的假对象,[Day 74](/blog/agent-zero/day-074-pytest-4/) 讲 monkeypatch 时见过。
- `ledger: Ledger = field(default_factory=Ledger)` dataclass 里可变的默认值要用 `default_factory`,否则所有实例会共用同一个账本对象。和 JS 里类字段写 `ledger = new Ledger()` 的效果一样。
- `def chat(self, messages: list[dict[str, Any]], **kw: Any) -> Reply:` 签名和 LLMClient.chat 对齐,`**kw` 接住 `tools=` 之类的参数但不用。
- `"function": {"name": "bash", "arguments": '{"command": "%s"}' % self.command}}` 拼出一个和真模型一样格式的 tool_call。`%s` 是老式字符串格式化,这里用它是因为外层要写 JSON 的花括号,用 f-string 得把花括号写两遍。

</div>

```python
# agent-zero-lab/part10/coding_agent/demo_stuck.py
from pathlib import Path

from part10.coding_agent.bash_agent_v2 import solve
from part10.coding_agent.fake_llm import StubbornLLM

repo = Path(__file__).parent / "toy_repo2"
llm = StubbornLLM("cat cloudledger/currancy.py")
print("结果:", solve("随便什么任务", repo, llm=llm))
print("假模型被调用了", llm.calls, "次")
```

<div class="line-notes">

- `llm = StubbornLLM("cat cloudledger/currancy.py")` currency 故意拼成 currancy,每次都会报「文件不存在」。
- `print("结果:", solve("随便什么任务", repo, llm=llm))` `solve` 接受外部传进来的 llm,传假的就不花钱。这就是把依赖做成参数的好处,[Day 459](/blog/agent-zero/day-459-flow-di/) 讲依赖注入时说过。

</div>

```bash
uv run python -m part10.coding_agent.demo_stuck
```

真实输出:

```text
[1] $ cat cloudledger/currancy.py
    → rc=1 'cat: cloudledger/currancy.py: No such file or directory\n'
[2] $ cat cloudledger/currancy.py
    → rc=1 'cat: cloudledger/currancy.py: No such file or directory\n'
[3] $ cat cloudledger/currancy.py
    → rc=1 'cat: cloudledger/currancy.py: No such file or directory\n'
    !! 提醒模型:你已经连续 3 次执行 `cat cloudledger/currancy.py` 并得到同样的错误。再重复一样的命令不会有用,先读报错,改参数或者换个办法。
[4] $ cat cloudledger/currancy.py
    → rc=1 'cat: cloudledger/currancy.py: No such file or directory\n'
0 次调用 | 输入 0 / 输出 0 tokens | 约 ¥0.0000
结果: Stuck:同一个命令连续 4 次报同样的错
假模型被调用了 4 次
```

第 3 次之后插入提醒,假模型「不听劝」又来了一次,第 4 次停下,返回 `Stuck`。如果没有检测,它会一直跑到 15 步的上限,真模型的话每一步都在花钱。真实的模型在提醒之后大多会换路子,比如先 `ls cloudledger` 看看文件到底叫什么。

## Codex:编辑格式和两层沙箱

OpenAI 的 Codex CLI 用 Rust 写,开源在 `openai/codex`,代码在 `codex-rs/` 下。仓库很大,我 2026-10-22 数了一下是 9,438 个文件,别 clone 全量,用 `--filter=blob:none --no-checkout` 只拉目录结构,要看哪个文件再单独取:

```bash
cd ~/src && git clone --depth 1 --filter=blob:none --no-checkout https://github.com/openai/codex.git
cd codex && git ls-tree -r --name-only HEAD | wc -l
git checkout HEAD -- codex-rs/core/assets/tools/apply_patch.lark codex-rs/execpolicy/README.md
```

Rust 不用会,今天只看两个和 Rust 关系不大的地方。

**编辑怎么做:apply_patch。** Codex 的编辑工具叫 `apply_patch`,在 `codex-rs/core/src/tools/handlers/apply_patch_spec.rs` 里定义成一个 `ToolSpec::Freeform`。freeform(自由格式)工具的意思是:模型不输出 JSON 参数,而是直接输出一段文本,文本格式用一份语法文件约束。语法就在 `codex-rs/core/assets/tools/apply_patch.lark`,全文很短:

```text
start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF
```

不用学语法文件的写法也能看懂大意:一个补丁以 `*** Begin Patch` 开头、`*** End Patch` 结尾,中间是一个或多个 hunk(补丁块),每块是「新增文件」「删除文件」「修改文件」三种之一;修改文件时,用 `@@` 加一行上下文定位,`-` 开头是删掉的行,`+` 开头是加上的行,空格开头是不变的行。和你在 GitHub PR 里看到的 diff 很像,只是头部格式是 Codex 自己定的。

为什么不用 JSON?因为补丁里全是代码,代码里有大量引号、反斜杠和换行,放进 JSON 字符串都要转义,模型写长代码时转义很容易出一个错,整段 JSON 就解析失败了。freeform 加语法约束,模型直接写补丁原文,推理服务按语法约束解码,保证输出一定符合格式。

和昨天的 str_replace 比:str_replace 一次改一处,靠「旧文本唯一」定位;apply_patch 一次可以改多个文件、多处,靠上下文行定位,适合大改动,但格式要求严格。练习 3 会让你手写一个补丁并用这份语法检查。

**命令在哪跑、能碰什么:两层。** 第一层是操作系统级的隔离,在 `codex-rs/sandboxing/src/`:macOS 上用 Seatbelt(`seatbelt.rs`,基础策略在 `seatbelt_base_policy.sbpl`),Linux 上用 Landlock 和 bubblewrap(`landlock.rs`,以及 `codex-rs/linux-sandbox/src/bwrap.rs`)。不管模型执行什么命令,进程都出不了允许的目录和网络范围。`seatbelt_base_policy.sbpl` 开头有一行 `(deny default)`,注释写着「start with closed-by-default」,先全部禁止再一项项放开。

第二层是命令级的审批策略,在 `codex-rs/execpolicy/`。README 里说规则用 `prefix_rule(pattern=[...], decision=...)` 写,decision 有三种:`allow`(直接放行)、`prompt`(问用户)、`forbidden`(禁止)。示例文件 `examples/example.codexpolicy` 里第一条就是:

```text
prefix_rule(
    pattern = ["git", "reset", "--hard"],
    decision = "forbidden",
    justification = "destructive operation",
```

`git reset --hard` 一律禁止,理由是「破坏性操作」;`cp` 是 `prompt`,要问人;`ls`、`cat` 直接放行。规则里还可以写 `match` 和 `not_match` 的例子,加载时会自动验证,相当于给规则写了单元测试。

两层防的东西不一样。系统沙箱防越界:就算模型被骗执行了恶意命令,也出不了工作目录。命令策略防「在允许范围内搞破坏」:`rm -rf .` 没有越界,但你肯定想先被问一句。只有命令黑名单,模型换个写法(`find . -delete`)就绕过去了;只有沙箱,又拦不住它在工作目录里误删。

Codex 里还有两处可以按文件名去找:上下文压缩在 `codex-rs/core/src/compact.rs`,同目录有 `compact_token_budget.rs`、`compact_retained_tool_outputs.rs`,从名字就能看出它关心「压缩给多少 token 预算」「哪些工具输出保留原文」;项目说明在 `codex-rs/core/src/agents_md.rs`,它负责把仓库里的 `AGENTS.md` 读进上下文,和你给 Claude Code 写 `CLAUDE.md` 是同一件事。

## 实跑翻车:Agent 跑出了仓库

讲沙箱讲到这里,说一件我写这篇时真实发生的事,它比任何理论都更能说明为什么要有第一层。

我第一版 `bash_agent_v2.py` 只加了卡死检测,执行还是用昨天的 `run_bash`(直接在本机跑),提示词也还是昨天那句「Every command runs in a fresh subshell in the repo root」,没告诉模型仓库的绝对路径。同一道题跑 3 次,其中一次的前几步是这样的:

```text
[1] $ cd /repo 2>/dev/null || cd ~; pwd; ls -la
[2] $ ls -d /repo /workspace /app /code 2>/dev/null; find / -maxdepth 3 -name ".git" -type d 2>/dev/null | head -20
[3] $ ls ~/Documents ~/Desktop ~/CascadeProjects 2>/dev/null; find ~ -maxdepth 3 -name ".git" -type d 2>/dev/null | head
[4] $ grep -rl "19.99" ~/Documents/*/ ... 2>/dev/null | grep -v node_modules | head -30
    → rc=-1 '命令超过 30 秒,已终止。'
```

第 1 步它先 `cd /repo`,这个目录在我电脑上不存在,于是退到家目录 `~`。第 2、3 步开始在整个硬盘上找 `.git` 目录,第 4 步在 `~/Documents` 下面的所有项目里搜「19.99」。后面 11 步它进了我电脑上别的项目目录,看 `git log`、`git status`,还 `cat` 了一个别的项目的源文件,直到 15 步用完。最后测试当然没修好,花了 0.03 元。我事后检查过,它执行的全是读操作,没有改任何东西,但那些目录列表和文件内容已经作为 tool 消息发给了模型 API。

为什么会 `cd /repo`?SWE-bench 这类评测的 Docker 镜像里,仓库通常放在固定路径下(比如 `/testbed`),很多 Agent 的训练轨迹里都有「先 cd 到固定仓库目录」这一步。模型没被告知仓库在哪,就照着训练时的习惯猜了一个。这也算是前面说的「题目公开、模型见过」的一个侧面:它学到的不只是答案,还有评测环境的样子。

修法是两层一起上,和 Codex 的思路一致。软的一层:提示词里写明仓库的绝对路径,并且说「不要离开」。硬的一层:命令放进沙箱,就算提示词没管住,也读不到家目录、写不了仓库外面、连不了网。macOS 自带 Seatbelt,命令行工具是 `sandbox-exec`(苹果把它标成了不推荐使用,但系统里一直有,Codex 也在用同一套机制)。

```python
# agent-zero-lab/part10/coding_agent/sandbox.py
"""macOS 上用 Seatbelt(sandbox-exec)把命令关起来:不能联网,不能读家目录和 .env,只能写仓库目录。Codex 在 macOS 上用的是同一套机制。"""
import subprocess
from pathlib import Path

PROFILE = """(version 1)
(allow default)
(deny network*)
(deny file-read* (subpath "{home}"))
(allow file-read* (subpath "{home}/.local"))
(allow file-read* (subpath "{lab}/.venv"))
(allow file-read* (subpath "{repo}"))
(deny file-read* (literal "{lab}/.env"))
(deny file-write* (require-not (subpath "{repo}")))
(allow file-write* (literal "/dev/null"))
"""


def run_sandboxed(command: str, cwd: Path, timeout: int = 30) -> dict:
    repo = cwd.resolve()
    lab = Path(__file__).resolve().parents[2]
    profile = PROFILE.format(home=Path.home(), lab=lab, repo=repo)
    try:
        r = subprocess.run(["sandbox-exec", "-p", profile, "bash", "-c", command],
                           cwd=repo, capture_output=True, text=True, timeout=timeout)
        return {"returncode": r.returncode, "output": (r.stdout + r.stderr)[-3000:]}
    except subprocess.TimeoutExpired:
        return {"returncode": -1, "output": f"命令超过 {timeout} 秒,已终止。"}


if __name__ == "__main__":
    repo = Path(__file__).parent / "toy_repo2"
    for cmd in ["ls ~/Documents", "cat ../../../.env", "touch ~/escape.txt", "curl -s -m 5 https://example.com",
                "touch inside.txt && ls inside.txt && rm inside.txt", "python -m pytest -q | tail -1"]:
        out = run_sandboxed(cmd, repo)
        print(f"$ {cmd}\n  rc={out['returncode']} {out['output'].strip()[:90]}")
```

<div class="line-notes">

- `PROFILE = """(version 1)` Seatbelt 的策略文件,语法是括号套括号的 Lisp 风格。`{home}`、`{lab}`、`{repo}` 是 Python 的占位符,下面用 `.format()` 填成真实路径。
- `(allow default)` 默认全部允许,再一条条禁止。这比 Codex 的 `(deny default)` 宽松得多,好处是简单、不容易把 Python 本身搞得跑不起来;代价是没列到的能力都放开了。生产环境应该学 Codex 先全禁再放开。
- `(deny network*)` 禁止一切网络。模型就算想把东西发出去也发不了。代价是 `pip install` 之类的也不能用,依赖要提前装好。
- `(deny file-read* (subpath "{home}"))` 禁止读家目录下的一切。刚才那次翻车就靠这一条挡住。
- `(allow file-read* (subpath "{home}/.local"))` 再放开 `~/.local`,因为 uv 装的 Python 解释器在 `~/.local/share/uv/python/` 下面。Seatbelt 里后写的规则优先,所以这条能覆盖上面的 deny。如果你的 Python 是用 pyenv 装的(在 `~/.pyenv`),要把这一行改成对应目录。
- `(allow file-read* (subpath "{lab}/.venv"))` 放开练习仓库的虚拟环境,pytest 装在这里。
- `(allow file-read* (subpath "{repo}"))` 放开要修的仓库本身。如果你的 `agent-zero-lab` 在家目录下,不加这一条连仓库都读不了。
- `(deny file-read* (literal "{lab}/.env"))` `.env` 里有 API key,单独再禁一次。`literal` 是精确匹配这一个文件。
- `(deny file-write* (require-not (subpath "{repo}")))` 仓库之外一律不能写。`require-not` 是「不满足条件时」。
- `(allow file-write* (literal "/dev/null"))` 很多命令会往 `/dev/null` 写(比如 `2>/dev/null`),要单独放开,否则这些命令全报错。
- `lab = Path(__file__).resolve().parents[2]` 这个文件在 `agent-zero-lab/part10/coding_agent/` 下,`parents[0]` 是 `coding_agent`,`parents[1]` 是 `part10`,`parents[2]` 就是 `agent-zero-lab`。
- `r = subprocess.run(["sandbox-exec", "-p", profile, "bash", "-c", command],` `sandbox-exec -p 策略 程序 参数`:用这份策略启动 `bash -c 命令`。bash 启动的所有子进程都继承同一个沙箱。
- `for cmd in ["ls ~/Documents", "cat ../../../.env", "touch ~/escape.txt", "curl -s -m 5 https://example.com",` 依次测:读家目录、读 .env、写家目录、联网、写仓库内、在仓库里跑测试。前四个应该被拦,后两个应该能用。

</div>

```bash
uv run python part10/coding_agent/make_repo2.py > /dev/null
uv run python -m part10.coding_agent.sandbox
```

真实输出:

```text
$ ls ~/Documents
  rc=1 ls: /Users/你/Documents: Operation not permitted
$ cat ../../../.env
  rc=1 cat: ../../../.env: Operation not permitted
$ touch ~/escape.txt
  rc=1 touch: /Users/你/escape.txt: Operation not permitted
$ curl -s -m 5 https://example.com
  rc=7 
$ touch inside.txt && ls inside.txt && rm inside.txt
  rc=0 inside.txt
$ python -m pytest -q | tail -1
  rc=0 2 failed, 5 passed in 0.31s
```

四个越界操作都是 `Operation not permitted`,`curl` 的返回码 7 是「连不上主机」。仓库里照常能写文件、跑测试(2 failed 是因为 bug 还没修)。这个沙箱只防到文件和网络这一层,CPU、内存、进程数都没限制,要更彻底还是得用容器或虚拟机,Day 415 讲过的那些。另外 Seatbelt 只有 macOS 有,Linux 上对应的是 Codex 用的 Landlock 和 bubblewrap。

## 仓库大了,模型怎么找到要改的地方

这是 Coding Agent 最实际的问题,也是今天第二个新概念:**定位**,就是从 issue 的一句描述出发,找到需要改的文件和行。issue 里说的是现象(「发票少了一分钱」),要改的地方在 `currency.py` 的第 5 行,中间隔着 `invoice.py`。有三种常见做法。

**一、agentic search。** 给模型 `grep`、`find`、`ls` 这类工具(或者直接给 bash),让它像人一样一层层找。昨天的实跑第 1 步就是 `grep -rn "apply_discount"`。OpenHands 把 grep 和 glob 做成独立工具,mini-swe-agent 只给 bash,Claude Code 也主要靠搜索,都是这条路。好处是不用预先建索引,代码刚改完就能搜到最新的;坏处是步数多、费 token,仓库越大越明显。

**二、repo map。** 先用静态分析生成一份精简的仓库目录:每个文件里有哪些函数、类、常量,只要签名不要函数体,放进提示词当地图用。[Day 248](/blog/agent-zero/day-248-code-retrieval/) 讲代码库检索时做过一次,这里用 `ast` 写一个最小版。

**三、向量检索。** 把代码切块做 embedding,按语义找([Day 212](/blog/agent-zero/day-212-why-vectors/) 起讲过)。听起来很合理,在 Coding Agent 里用得反而不多:代码里的函数名、变量名本来就适合精确匹配,语义检索容易召回一堆「看起来相关」的东西;而且代码一直在改,索引的维护成本高。

### 写一个 repo map

```python
# agent-zero-lab/part10/coding_agent/repo_map.py
"""用 ast 给仓库生成一份「目录」:每个文件里有哪些函数、类和常量,只要签名不要函数体。"""
import ast
from pathlib import Path


def file_outline(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            ret = f" -> {ast.unparse(node.returns)}" if node.returns else ""
            out.append(f"  def {node.name}({ast.unparse(node.args)}){ret}")
        elif isinstance(node, ast.ClassDef):
            out.append(f"  class {node.name}")
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            target = node.targets[0] if isinstance(node, ast.Assign) else node.target
            if isinstance(target, ast.Name) and target.id.isupper():
                out.append(f"  {target.id} = ...")
    return out


def repo_map(root: Path, package: str) -> str:
    lines = []
    for f in sorted((root / package).rglob("*.py")):
        outline = file_outline(f)
        if outline:
            lines.append(str(f.relative_to(root)))
            lines.extend(outline)
    return "\n".join(lines)


if __name__ == "__main__":
    text = repo_map(Path(__file__).parent / "toy_repo2", "cloudledger")
    print(text)
    print(f"\n共 {len(text)} 个字符")
```

<div class="line-notes">

- `tree = ast.parse(path.read_text(encoding="utf-8"))` 把源码解析成语法树。Day 604 用 `ast.parse` 只是检查语法,这里要用解析出来的结构。
- `for node in tree.body:` `tree.body` 是文件最外层的语句列表,只看顶层,不进函数内部。类里的方法这一版不列,练习 4 会看到这在真实仓库里不够。
- `if isinstance(node, ast.FunctionDef):` 顶层函数定义。`isinstance` 相当于 JS 的 `instanceof`。
- `ret = f" -> {ast.unparse(node.returns)}" if node.returns else ""` `node.returns` 是返回值类型标注的语法树,`ast.unparse` 把语法树变回源码文字。没有标注就不写。
- `out.append(f"  def {node.name}({ast.unparse(node.args)}){ret}")` 拼出 `def to_cents(yuan: float) -> int` 这样的签名。
- `elif isinstance(node, (ast.Assign, ast.AnnAssign)):` 顶层赋值,普通的 `X = 1` 和带类型标注的 `X: int = 1` 是两种节点。
- `if isinstance(target, ast.Name) and target.id.isupper():` 只列全大写的名字(`PLANS`、`COUPONS`、`VAT`),也就是常量,普通变量不列。
- `if outline:` 空文件(比如 `__init__.py`)不出现在地图里。

</div>

```bash
uv run python part10/coding_agent/repo_map.py
```

真实输出:

```text
cloudledger/currency.py
  def to_cents(yuan: float) -> int
  def from_cents(cents: int) -> float
  def fmt(cents: int) -> str
cloudledger/customers.py
  class Customer
  CUSTOMERS = ...
  def find_customer(customer_id: str) -> Customer | None
cloudledger/dates.py
  def days_in_month(year: int, month: int) -> int
  def next_billing_date(d: date) -> date
cloudledger/discount.py
  COUPONS = ...
  def apply_coupon(cents: int, code: str) -> int
cloudledger/invoice.py
  def line_total(plan_id: str, months: int) -> int
  def invoice_total(plan_id: str, months: int, coupon: str | None=None) -> int
cloudledger/plans.py
  PLANS = ...
  def get_plan(plan_id: str) -> dict
cloudledger/reports.py
  def revenue_report() -> str
cloudledger/tax.py
  VAT = ...
  def add_tax(cents: int, rate: int=VAT) -> int

共 800 个字符
```

看到 `to_cents(yuan: float) -> int`,一个有经验的工程师已经能猜到「元转分」这里有问题了。这就是地图的价值:不用打开文件,先知道每个文件管什么。

### bash_agent_v2:沙箱、卡死检测、可选的地图

现在把今天的东西拼起来。和昨天的 `bash_agent.py` 比,v2 多了三样:命令走沙箱,每步之后做卡死检测,`use_map=True` 时把 repo map 拼进任务提示。

```python
# agent-zero-lab/part10/coding_agent/bash_agent_v2.py
"""在 Day 604 的 bash_agent 上加三样东西:命令关进沙箱、卡死检测(先提醒再停)、可选地把 repo map 放进任务提示。"""
import json
import sys
from pathlib import Path
from typing import Any

from common.llm import LLMClient
from part10.coding_agent.bash_agent import BASH_TOOL, DONE, INSTANCE, SYSTEM
from part10.coding_agent.sandbox import run_sandboxed
from part10.coding_agent.repo_map import repo_map
from part10.coding_agent.stuck_detector import Step, check


def solve(task: str, repo: Path, *, use_map: bool = False, llm: Any = None,
          step_limit: int = 15, cost_limit: float = 0.2) -> str:
    llm = llm or LLMClient()
    prompt = INSTANCE.format(task=task, done=DONE)
    prompt += f"\nThe repository root (your working directory) is {repo.resolve()}. Never leave it."
    prompt += f"\nRun `echo {DONE}` as a separate command. Do not combine it with any other command."
    if use_map:
        prompt += "\n\nRepository map (signatures only):\n" + repo_map(repo, "cloudledger")
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]
    steps: list[Step] = []
    nudged = False
    status = "LimitsExceeded:步数用完"
    for n in range(1, step_limit + 1):
        if llm.ledger.cost >= cost_limit:
            status = "LimitsExceeded:花费超了"
            break
        r = llm.chat(messages, tools=[BASH_TOOL])
        messages.append(r.message)
        if not r.message.get("tool_calls"):
            messages.append({"role": "user", "content": "你必须调用 bash 工具。做完了就单独执行 echo " + DONE})
            continue
        for call in r.message["tool_calls"]:
            cmd = json.loads(call["function"]["arguments"])["command"]
            out = run_sandboxed(cmd, repo)
            print(f"[{n}] $ {cmd}\n    → rc={out['returncode']} {out['output'][:100]!r}")
            if out["output"].strip().startswith(DONE) and out["returncode"] == 0:
                status = "Submitted"
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(out, ensure_ascii=False)})
            steps.append(Step(cmd, out["output"][:200], out["returncode"] != 0))
        if status == "Submitted":
            break
        verdict = check(steps)
        if verdict and verdict.startswith("nudge:") and not nudged:
            print(f"    !! 提醒模型:{verdict[6:]}")
            messages.append({"role": "user", "content": verdict[6:]})
            nudged = True
        elif verdict and verdict.startswith("stuck:"):
            status = f"Stuck:{verdict[6:]}"
            break
    (Path(__file__).parent / "traj_v2.json").write_text(json.dumps(messages, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{llm.ledger}")
    return status


if __name__ == "__main__":
    repo = Path(__file__).parent / "toy_repo2"
    use_map = "--map" in sys.argv
    issue = "基础版套餐每月 19.99 元,客户买 1 个月,发票上显示 19.98 元,少了一分钱。"
    print("结果:", solve(issue, repo, use_map=use_map))
```

<div class="line-notes">

- `from part10.coding_agent.bash_agent import BASH_TOOL, DONE, INSTANCE, SYSTEM` 复用昨天的工具定义和提示词,不复制一份。
- `def solve(task: str, repo: Path, *, use_map: bool = False, llm: Any = None,` 参数列表里那个单独的 `*` 表示后面的参数只能用名字传(`use_map=True`),不能按位置传,防止调用时参数顺序弄混。相当于 JS 里把可选参数收进一个 `options` 对象。
- `llm = llm or LLMClient()` 没传就用真的 LLMClient,传了(比如假模型)就用传进来的。
- `prompt += f"\nThe repository root (your working directory) is {repo.resolve()}. Never leave it."` 翻车之后加的软约束:告诉模型仓库的绝对路径。实跑之后它的命令几乎都以 `cd 这个绝对路径 &&` 开头。
- `prompt += f"\nRun `echo {DONE}` as a separate command. Do not combine it with any other command."` 也是踩坑后加的,下面「两个坑」会讲。mini-swe-agent 的提示词里有同样一句 `Do not combine it with any other command`。
- `prompt += "\n\nRepository map (signatures only):\n" + repo_map(repo, "cloudledger")` 地图拼在任务提示后面,800 个字符,大约两三百 token。
- `steps: list[Step] = []` 给卡死检测用的步骤列表,和 messages 分开存,因为检测只关心「命令和结果」。
- `if not r.message.get("tool_calls"):` 第一版 v2 我漏写了这段(昨天的 `bash_agent.py` 里有),结果吃了亏,见下文。
- `out = run_sandboxed(cmd, repo)` 和昨天唯一的执行差别:`run_bash` 换成 `run_sandboxed`。
- `steps.append(Step(cmd, out["output"][:200], out["returncode"] != 0))` 每执行一条命令记一步。返回码非 0 算报错。
- `verdict = check(steps)` 一轮的工具都执行完以后做一次检测。
- `if verdict and verdict.startswith("nudge:") and not nudged:` 提醒只发一次。`verdict[6:]` 去掉 `nudge:` 这 6 个字符的前缀,把后面的话作为 user 消息塞给模型。
- `elif verdict and verdict.startswith("stuck:"):` 判定卡死就停,状态写成 `Stuck:原因`,和 `Submitted`、`LimitsExceeded` 并列成第三种退出状态。
- `use_map = "--map" in sys.argv` 命令行带 `--map` 就开地图。`sys.argv` 是命令行参数列表,相当于 Node 的 `process.argv`。

</div>

不带地图和带地图各跑一次,每次跑之前重建仓库,跑完用裁判判分。输出里的绝对路径太长,我把 `agent-zero-lab` 之前的部分换成了 `…`,其余是原样:

```bash
uv run python part10/coding_agent/make_repo2.py
uv run python -m part10.coding_agent.bash_agent_v2
(cd part10/coding_agent && uv run python judge.py)
uv run python part10/coding_agent/make_repo2.py
uv run python -m part10.coding_agent.bash_agent_v2 --map
(cd part10/coding_agent && uv run python judge.py)
```

不带地图:

```text
已生成 toy_repo2/:9 个源码文件,共 95 行
[1] $ cd …/agent-zero-lab/part10/coding_agent/toy_repo2 && ls -la && find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | head -100
    → rc=0 'total 8\ndrwxr-xr-x   5 minliu  wheel  160 22 Oct 12:33 .\ndrwxr-xr-x  28 minliu  wheel  896 22 Oct 12'
[2] $ cd …/agent-zero-lab/part10/coding_agent/toy_repo2 && for f in cloudledger/*.py; do echo "===== $f ====="; cat -n "$f"; done
    → rc=0 ' -> str:\n    13\t    return f"¥{cents / 100:.2f}"\n===== cloudledger/customers.py =====\n     1\tfrom da'
[2] $ cd …/agent-zero-lab/part10/coding_agent/toy_repo2 && for f in tests/*.py pytest.ini; do echo "===== $f ====="; cat -n "$f"; done
    → rc=0 '===== tests/test_currency.py =====\n     1\tfrom cloudledger.currency import fmt, from_cents, to_cents'
[3] $ cd …/agent-zero-lab/part10/coding_agent/toy_repo2 && cat -n cloudledger/currency.py && python3 -c "from cloudledger.invoice import invoice_total, line_total; from cloudledger.currency import fmt; print(invoice_total('basic',1), fmt(invoice_total('basic',1)))"
    → rc=0 '     1\t"""金额换算:系统内部一律用「分」存整数,避免浮点误差。"""\n     2\t\n     3\t\n     4\tdef to_cents(yuan: float) -> int:\n   '
[4] $ cd …/agent-zero-lab/part10/coding_agent/toy_repo2 && sed -i '' 's/    return int(yuan \* 100)/    return int(round(yuan * 100))/' cloudledger/currency.py && cat -n cloudledger/currency.py && python3 -c "..."
    → rc=0 '     1\t"""金额换算:系统内部一律用「分」存整数,避免浮点误差。"""\n     2\t\n     3\t\n     4\tdef to_cents(yuan: float) -> int:\n   '
[5] $ cd …/agent-zero-lab/part10/coding_agent/toy_repo2 && python3 -m pytest -q
    → rc=0 '.......                                                                  [100%]\n7 passed in 0.06s\n'
[6] $ cd …/agent-zero-lab/part10/coding_agent/toy_repo2 && python3 -c "from cloudledger.reports import revenue_report; print(revenue_report())"
    → rc=0 'C001 星河科技        ¥598.80\nC002 青禾工作室        ¥19.99\nC003 北辰物流       ¥2397.60\n合计           ¥3016.39\n'
[7] $ echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT
    → rc=0 'COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\n'
7 次调用 | 输入 18091 / 输出 1260 tokens | 约 ¥0.0164
结果: Submitted
FAIL_TO_PASS: 2/2 通过
PASS_TO_PASS: 5/5 通过
判定: resolved
```

(第 4 步末尾的 `python3 -c` 和第 3 步一样,我缩成了 `"..."`。)注意两行 `[2]`:模型在同一次回复里发了两个 tool_call,一个看源码一个看测试,这就是 [Day 162](/blog/agent-zero/day-162-parallel-tools/) 讲的并行工具调用。它的定位过程是:第 2 步把 `cloudledger/` 下所有文件一口气 `cat` 出来,第 3 步盯住 `currency.py` 并复现出 1998,第 4 步修。95 行的仓库,全看一遍是最快的路。

带地图:

```text
已生成 toy_repo2/:9 个源码文件,共 95 行
[1] $ cd …/agent-zero-lab/part10/coding_agent/toy_repo2 && find . -type f -not -path './.git/*' | head -50 && echo '---' && cat cloudledger/currency.py cloudledger/invoice.py cloudledger/plans.py
    → rc=0 './pytest.ini\n./tests/test_currency.py\n./tests/test_invoice.py\n./cloudledger/tax.py\n./cloudledger/__i'
[1] $ cd …/agent-zero-lab/part10/coding_agent/toy_repo2 && cat cloudledger/discount.py cloudledger/tax.py cloudledger/reports.py cloudledger/customers.py cloudledger/dates.py
    → rc=0 'COUPONS = {"SAVE10": 10, "HALF": 50}\n\n\ndef apply_coupon(cents: int, code: str) -> int:\n    if code n'
[2] $ cd …/agent-zero-lab/part10/coding_agent/toy_repo2 && python -c "from cloudledger.invoice import invoice_total; print(invoice_total('basic',1))" && cat tests/test_currency.py tests/test_invoice.py
    → rc=0 '1998\nfrom cloudledger.currency import fmt, from_cents, to_cents\n\n\ndef test_to_cents_rounding():\n    '
[3] $ cd …/agent-zero-lab/part10/coding_agent/toy_repo2 && sed -i '' 's/return int(yuan \* 100)/return int(round(yuan * 100))/' cloudledger/currency.py && sed -i '' 's/return to_cents(plan\["monthly"\] \* months)/return to_cents(plan["monthly"]) * months/' cloudledger/invoice.py && cat cloudledger/currency.py cloudledger/invoice.py && python -c "..." && python -m pytest -q
    → rc=0 '"""金额换算:系统内部一律用「分」存整数,避免浮点误差。"""\n\n\ndef to_cents(yuan: float) -> int:\n    return int(round(yuan * 100'
[4] $ echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT
    → rc=0 'COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\n'
4 次调用 | 输入 8409 / 输出 799 tokens | 约 ¥0.0107
结果: Submitted
FAIL_TO_PASS: 2/2 通过
PASS_TO_PASS: 5/5 通过
判定: resolved
```

有地图时第 1 步就先 cat 了 `currency.py`、`invoice.py`、`plans.py` 三个最相关的文件(地图起了作用),4 次调用修好。但同一次回复里它又把剩下 5 个文件也 cat 了。另外它顺手改了 `invoice.py`,把「先乘月数再换算成分」改成「先换算成分再乘月数」。测试照样全过,可这是 issue 没要求的改动,改变了多月份订单的计算方式。在真实仓库里,这种「顺手改」是代码评审最该拦下的东西。

一次对一次说明不了什么,模型输出本身就有随机性。练习 2 会各跑 3 次。先说结论:在 95 行的小仓库里,地图没有带来可见的好处,因为全部 cat 一遍才 2,000 多个字符。地图的价值在大仓库,练习 4 会在一个真实开源项目上量一下。

我的观点是,做一个面向真实仓库的 Coding Agent,先用 agentic search 加一份轻量的 repo map,向量检索等你有评测数据证明它提高了定位准确率再加。这个判断本身也是面试时可以讲的取舍。

### 两个坑:漏了的提醒和粘在一起的暗号

第一版 v2 我还踩了一个坑。当时没写「没调工具就提醒」那一段,提示词里也没有「暗号要单独执行」。有一次实跑,第 4 步模型这样提交:

命令里的路径和 `python -c` 的内容我缩写了:

```text
[4] $ cd …/toy_repo2 && python -c "...; print(fmt(invoice_total('basic',1)))" && echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT
    → rc=0 '¥19.99\nCOMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\n'
15 次调用 | 输入 40642 / 输出 1254 tokens | 约 ¥0.0201
结果: LimitsExceeded:步数用完
FAIL_TO_PASS: 2/2 通过
PASS_TO_PASS: 5/5 通过
```

暗号和别的命令粘在了一起,输出第一行是 `¥19.99`,程序认不出这是提交。模型自己认为做完了,接下来 11 次调用都只回文字不调工具,而 v2 没有那段提醒,就这样空转到 15 次上限。代码其实修好了(判分全过),但退出状态是 LimitsExceeded,如果只看退出状态统计,这一题会被算成失败,还白花了 11 次调用的钱。所以 mini-swe-agent 的提示词里要专门强调「不要和别的命令合在一起」,而它的 `max_consecutive_format_errors` 就是为这种空转准备的。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="bash_agent_v2 每一步的处理流程">
  <rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)"/>
  <rect x="20" y="30" width="110" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="75" y="57" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">调模型</text>
  <rect x="160" y="30" width="120" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="220" y="50" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">有 tool_call?</text>
  <text x="220" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">没有 → 提醒</text>
  <rect x="310" y="30" width="130" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="375" y="50" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">沙箱里执行</text>
  <text x="375" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">sandbox-exec</text>
  <rect x="470" y="30" width="150" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="545" y="50" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">第一行是暗号?</text>
  <text x="545" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">是 → Submitted</text>
  <rect x="470" y="130" width="150" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="545" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">卡死检测</text>
  <text x="545" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">nudge / stuck / 正常</text>
  <rect x="250" y="130" width="170" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="335" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">nudge:塞一条提醒</text>
  <text x="335" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">只发一次</text>
  <rect x="20" y="130" width="180" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="110" y="152" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">上限:15 步 / ¥0.2</text>
  <text x="110" y="170" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">stuck → 停</text>
  <line x1="130" y1="52" x2="160" y2="52" stroke="var(--rule)"/>
  <line x1="280" y1="52" x2="310" y2="52" stroke="var(--rule)"/>
  <line x1="440" y1="52" x2="470" y2="52" stroke="var(--rule)"/>
  <line x1="545" y1="74" x2="545" y2="130" stroke="var(--rule)"/>
  <line x1="470" y1="158" x2="420" y2="158" stroke="var(--rule)"/>
  <line x1="250" y1="158" x2="200" y2="158" stroke="var(--rule)"/>
  <line x1="75" y1="130" x2="75" y2="74" stroke="var(--rule)"/>
  <text x="85" y="108" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">下一步</text>
</svg>
<figcaption>bash_agent_v2 一步里依次做的事。今天加的是沙箱、卡死检测和那句「没调工具就提醒」,三处都对应一次真实的翻车或者一个真实项目的做法。</figcaption>
</figure>

## 四个项目横着比一遍

| 五块 | SWE-agent | mini-swe-agent | OpenHands SDK | Codex CLI |
| --- | --- | --- | --- | --- |
| ① 编辑 | str_replace,lint 拒写 | 只有 bash(sed、cat 重定向) | file_editor + apply_patch | apply_patch,语法约束 |
| ① 查看/搜索 | 100 行分窗 | bash | file_editor、grep、glob | 主要靠 shell |
| ② 上下文 | 历史处理器 | 线性历史,不压缩 | LLM 摘要 condenser,可串联 | compact,带 token 预算 |
| ③ 执行 | Docker 里的 shell 会话 | 每步独立 subprocess | Workspace 抽象,本地或远程 | Seatbelt / Landlock 沙箱 + 命令策略 |
| ⑤ 停止 | 步数、花费 | 步数、花费、时间、格式错误 | 卡死检测(先提醒后停)+ 上限 | 用户审批 + 上限 |
| 定位 | 研究,强调 ACI | 研究基线,强调极简 | 平台 / SDK | 产品 |

我建议你自己再补一列 Claude Code。它不开源,但 Anthropic 的文档和工程博客写了很多设计,面试时被问「你会怎么设计」,可以直接拿这张表里的取舍来讲。

## 一个实验设计:怎么证明你加的东西有用

今天加了沙箱、卡死检测、repo map,昨天写了 view 和 str_replace。每一样都「听起来有用」,但听起来有用不等于有用。在把它们放进正式的 Agent 之前,要能回答「你怎么证明」。一个最小可行的实验:

**任务集**:从你们自己的仓库(或者一个开源 Python 项目)里挑 20 个已经修复的 bug,用修复前的提交、issue 描述和修复 PR 里的测试,构造成和 SWE-bench 一样的「issue + 仓库 + FAIL_TO_PASS + PASS_TO_PASS」。20 个很少,只是先把流程跑通。

**分组**:A 组是基线(比如只给 bash),B 组加上你要证明的那一样东西,只改这一个变量,模型、提示词、上限全都一样。

**每题跑 3 次**,记录解决率、平均调用次数、平均 token、平均花费、退出状态分布(Submitted / LimitsExceeded / Stuck)。

**看结论时分开看**:解决率涨了多少,花费涨了多少。如果 B 组只多解决了 1 题,花费却多了一倍,这样东西在当前模型上就不值得。把这个实验跑完写成一页报告,比在简历上写「设计了 Coding Agent 的工具集」有说服力得多。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1t2y3BdETP&autoplay=0&high_quality=1" title="OpenHands软件代理SDK:面向生产代理的可组合和可扩展基础" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI论文小小编 · OpenHands软件代理SDK:面向生产代理的可组合和可扩展基础 · 23 分钟,讲 OpenHands SDK 论文的架构,看事件、工具、Workspace 这几个抽象怎么拆。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1eyJp6gES4&autoplay=0&high_quality=1" title="AI小知识·第一集|SWE-bench:大语言模型能修真实项目中的 GitHub Issue 吗?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>港中深人工智能协会 · AI小知识·第一集|SWE-bench:大语言模型能修真实项目中的 GitHub Issue 吗? · 23 分钟,把 SWE-bench 怎么构造、怎么判分讲一遍,和今天的 judge.py 对照着看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/jQ2ft0RKhsY" title="How to Get Started with OpenHands (CLI, Cloud &amp; SDK Explained)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>OpenHands · How to Get Started with OpenHands (CLI, Cloud &amp; SDK Explained) · 24 分钟,英文,看 CLI、Cloud、SDK 三种用法的关系,SDK 部分从 15 分钟左右开始。</figcaption>
</figure>

## 动手练习

**练习 1:实现第三种模式「自言自语」。** OpenHands 的 monologue 模式是:模型连续 3 条消息只说话、不调工具,中间也没有用户的新输入。写一个 `is_monologue(messages)`。注意 v2 自动塞进去的「你必须调用 bash 工具」不算用户的新输入。

<details><summary>参考答案</summary>

思路和 OpenHands 的 `_is_stuck_monologue` 一样:从最后一条往前数,碰到不带工具调用的 assistant 消息就加 1,碰到程序自动插的提醒就跳过,碰到别的(工具结果、真人消息)就停。为了区分「程序自动插的」和「真人说的」,给自动插入的消息加一个 `auto` 标记。

```python
# agent-zero-lab/part10/coding_agent/ex605_monologue.py
"""练习 1 参考答案:OpenHands 的第三种模式「自言自语」:模型连续 3 次只说话、不调工具,中间也没有新的用户输入。"""
from typing import Any

MONOLOGUE = 3  # OpenHands 默认 monologue = 3


def is_monologue(messages: list[dict[str, Any]], threshold: int = MONOLOGUE) -> bool:
    count = 0
    for m in reversed(messages):
        if m["role"] == "assistant" and not m.get("tool_calls"):
            count += 1
        elif m["role"] == "user" and m.get("auto"):
            continue
        else:
            break
    return count >= threshold


if __name__ == "__main__":
    say = {"role": "assistant", "content": "我觉得问题在 currency.py。"}
    nag = {"role": "user", "content": "你必须调用 bash 工具。", "auto": True}
    act = {"role": "assistant", "content": "", "tool_calls": [{"id": "c1"}]}
    real_user = {"role": "user", "content": "先别改,告诉我原因"}
    print("说了 2 次:", is_monologue([act, say, nag, say]))
    print("说了 3 次:", is_monologue([act, say, nag, say, nag, say]))
    print("中间有真人插话:", is_monologue([say, say, real_user, say]))
```

<div class="line-notes">

- `for m in reversed(messages):` 从最新的消息往前看。`reversed` 不复制列表,只是倒着遍历。
- `if m["role"] == "assistant" and not m.get("tool_calls"):` 只说话不干活的一条。`m.get("tool_calls")` 键不存在时返回 None,不会报错,相当于 JS 的 `m.tool_calls`(可选链之前的写法)。
- `elif m["role"] == "user" and m.get("auto"):` 程序自动插的提醒,跳过,不打断计数。OpenHands 里对应的是 condensation 事件「不打断」monologue 的那个分支。
- `else:` 工具调用、工具结果、真人消息都会打断。真人插话说明对话还在正常进行。
- `print("说了 3 次:", is_monologue([act, say, nag, say, nag, say]))` 刚才那次「暗号粘在一起」的翻车,就是这个形状重复了 11 次。

</div>

```bash
cd part10/coding_agent && uv run python ex605_monologue.py; cd ../..
```

```text
说了 2 次: False
说了 3 次: True
中间有真人插话: False
```

接进 v2 时要注意:`auto` 是我们自己加的字段,发给模型 API 之前要去掉,有的服务对不认识的字段会报 400。简单做法是另存一个「这条是自动插的」索引集合,不往消息里加字段。

</details>

**练习 2:各跑 3 次,看地图有没有用。** 写一个脚本,不带地图和带地图各跑 3 次,每次重建仓库、判分,打印解决率、平均调用次数和总花费。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/coding_agent/ex605_many.py
"""练习 2 参考答案:同一道题,不给 repo map 和给 repo map 各跑 3 次,比较解决率、调用次数和花费。"""
import contextlib
import io
from pathlib import Path

from common.llm import LLMClient
from part10.coding_agent import judge, make_repo2
from part10.coding_agent.bash_agent_v2 import solve

ISSUE = "基础版套餐每月 19.99 元,客户买 1 个月,发票上显示 19.98 元,少了一分钱。"

for use_map in (False, True):
    solved, calls, cost = 0, 0, 0.0
    for i in range(1, 4):
        with contextlib.redirect_stdout(io.StringIO()):
            make_repo2.main()
            llm = LLMClient()
            status = solve(ISSUE, Path(make_repo2.ROOT), use_map=use_map, llm=llm)
            ok = judge.judge()
        solved += ok
        calls += llm.ledger.calls
        cost += llm.ledger.cost
        print(f"map={use_map!s:<5} 第 {i} 次:{status:<10} resolved={ok!s:<5} 调用 {llm.ledger.calls:>2} 次 ¥{llm.ledger.cost:.4f}")
    print(f"map={use_map}:解决 {solved}/3,平均 {calls / 3:.1f} 次调用,共 ¥{cost:.4f}\n")
```

<div class="line-notes">

- `import contextlib` 和 `import io` 一起用来「吞掉」中间的打印,只留最后的汇总,不然 6 次运行的日志会刷满屏幕。
- `from part10.coding_agent import judge, make_repo2` 直接导入两个模块,调用它们的 `main()` 和 `judge()`,不用再起子进程。
- `with contextlib.redirect_stdout(io.StringIO()):` 这个 with 块里所有 `print` 都写进一个内存里的字符串,不显示。相当于临时把 `console.log` 换成空函数。
- `llm = LLMClient()` 每次新建一个客户端,账本从 0 开始,才能分别统计每次的调用和花费。
- `ok = judge.judge()` 判分。`solved += ok` 里 True 算 1。
- `print(f"map={use_map!s:<5} 第 {i} 次:{status:<10} resolved={ok!s:<5} 调用 {llm.ledger.calls:>2} 次 ¥{llm.ledger.cost:.4f}")` `!s` 先把布尔值转成字符串,`:<5` 左对齐补到 5 个字符,`:>2` 右对齐补到 2 个字符,排出来是整齐的表。

</div>

```bash
uv run python -m part10.coding_agent.ex605_many
```

真实输出:

```text
map=False 第 1 次:Submitted  resolved=True  调用  6 次 ¥0.0173
map=False 第 2 次:Submitted  resolved=True  调用  6 次 ¥0.0107
map=False 第 3 次:Submitted  resolved=True  调用  4 次 ¥0.0082
map=False:解决 3/3,平均 5.3 次调用,共 ¥0.0362

map=True  第 1 次:Submitted  resolved=True  调用  8 次 ¥0.0124
map=True  第 2 次:Submitted  resolved=True  调用  5 次 ¥0.0090
map=True  第 3 次:Submitted  resolved=True  调用  7 次 ¥0.0156
map=True:解决 3/3,平均 6.7 次调用,共 ¥0.0370
```

6 次全部解决,带地图的平均调用次数反而多了 1.4 次,总花费几乎一样。我不会据此说「地图没用」,两个原因:3 次的样本太小,调用次数从 4 到 8 都有,随机波动比两组的差距还大;仓库只有 95 行,全部 cat 一遍比读地图还直接。能下的结论只有一个:**在这么小的仓库上,地图不值得加**。要证明它在大仓库上有用,得换大仓库、多跑几题,这就是上一节实验设计要做的事。

这 6 次的过程日志被 `redirect_stdout` 吞掉了,我没有逐条检查它们有没有试图离开仓库;不过加了沙箱之后,就算试了也读不到家目录、写不了仓库外面。想看过程,把 `with` 那一行去掉再跑。

</details>

**练习 3:手写一个 apply_patch 补丁。** 按 Codex 的 `apply_patch.lark` 语法,把 `to_cents` 的修复写成补丁文本,再故意写一个漏掉结尾的,用 Python 的 `lark` 库加载 Codex 的语法文件检查两份补丁。

<details><summary>参考答案</summary>

先装 lark(2026 年 10 月 22 日 PyPI 上是 1.3.1),把 Codex 仓库里的语法文件复制过来:

```bash
uv add lark
mkdir -p part10/coding_agent/codex
cp ~/src/codex/codex-rs/core/assets/tools/apply_patch.lark part10/coding_agent/codex/
```

我第一次直接加载 Codex 的语法文件,报了这个错:

```text
lark.exceptions.GrammarError: ("Dynamic Earley doesn't allow zero-width regexps", TerminalDef('__ANON_6', '(.*)'))
```

意思是语法里的 `/(.*)/` 能匹配空字符串(零宽度),Python 的 lark 不允许。OpenAI 服务端的约束解码器能处理这种写法,Python 这边不行。换 `parser="lalr"` 或 `lexer="basic"` 也一样报 `Lexer does not allow zero-width terminals`。解决办法是把 `/(.*)/` 换成 `/.+/?`,也就是「一段非空文字,可以没有」,能匹配的东西完全一样。

```python
# agent-zero-lab/part10/coding_agent/ex605_patch.py
"""练习 3 参考答案:按 Codex 的 apply_patch.lark 语法手写一个补丁,用 lark 检查格式对不对。"""
from pathlib import Path

from lark import Lark, LarkError

GRAMMAR = (Path(__file__).parent / "codex" / "apply_patch.lark").read_text(encoding="utf-8")
# Python 的 lark 不接受能匹配空串的 /(.*)/,换成「可选的非空一行」,意思不变
GRAMMAR = GRAMMAR.replace("/(.*)/", "/.+/?")
parser = Lark(GRAMMAR, start="start")

GOOD = """*** Begin Patch
*** Update File: cloudledger/currency.py
@@ def to_cents(yuan: float) -> int:
-    return int(yuan * 100)
+    return round(yuan * 100)
*** End Patch
"""

BAD = """*** Begin Patch
*** Update File: cloudledger/currency.py
-    return int(yuan * 100)
+    return round(yuan * 100)
"""

for name, patch in (("GOOD", GOOD), ("BAD", BAD)):
    try:
        tree = parser.parse(patch)
        hunks = [t for t in tree.iter_subtrees() if t.data == "update_hunk"]
        print(name, "格式正确,update_hunk 个数:", len(hunks))
    except LarkError as e:
        print(name, "格式错误:", str(e).splitlines()[0])
```

<div class="line-notes">

- `from lark import Lark, LarkError` lark 是 Python 的语法解析库,Codex 的语法文件就是 lark 格式。
- `GRAMMAR = GRAMMAR.replace("/(.*)/", "/.+/?")` 绕开零宽度的限制。原文件里 `add_line` 和 `change_line` 两处用了 `/(.*)/`,这一行把两处都换掉。
- `parser = Lark(GRAMMAR, start="start")` 从 `start` 规则开始解析,默认用 Earley 算法,能处理有歧义的语法。
- `@@ def to_cents(yuan: float) -> int:` 一个 `change_context`:用函数定义那一行定位改动位置,作用和 str_replace 里「多带几行上下文」一样。
- `-    return int(yuan * 100)` 删掉的行以 `-` 开头,`-` 后面紧跟原来的缩进。
- `BAD = """*** Begin Patch` 故意漏掉 `@@` 定位行和 `*** End Patch` 结尾。
- `hunks = [t for t in tree.iter_subtrees() if t.data == "update_hunk"]` 遍历语法树,数一数有几个修改文件的补丁块。

</div>

```bash
cd part10/coding_agent && uv run python ex605_patch.py; cd ../..
```

```text
GOOD 格式正确,update_hunk 个数: 1
BAD 格式错误: Unexpected end-of-input. Expected one of: 
```

BAD 缺了 `*** End Patch`,解析到末尾还在等结尾标记,报「意外的输入结束」。没有 `@@` 那行其实语法上是允许的(`change` 里 `change_context` 是可选的),真正致命的是结尾。在 Codex 里,这种格式错误根本不会出现,因为服务端按语法约束解码,模型写不出不合语法的补丁;我们这里是事后检查,只能发现,不能阻止。

</details>

**练习 4:在真实仓库上量一下 repo map。** 用 `repo_map.py` 给昨天拉下来的 mini-swe-agent 源码(包名 `minisweagent`)生成地图,比较地图和全部源码的大小。地图里漏了什么?

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/coding_agent/ex605_bigmap.py
"""练习 4 参考答案:给一个真实仓库(mini-swe-agent 的源码)生成 repo map,比较它和全部源码的大小。"""
import sys
from pathlib import Path

from part10.coding_agent.repo_map import repo_map

root = Path(sys.argv[1]).expanduser() / "src"
text = repo_map(root, "minisweagent")
source = sum(len(f.read_text(encoding="utf-8")) for f in (root / "minisweagent").rglob("*.py"))
files = len(list((root / "minisweagent").rglob("*.py")))
print("\n".join(text.splitlines()[:12]))
print("...")
print(f"{files} 个 .py 文件,源码共 {source} 个字符;repo map {len(text)} 个字符,约是源码的 {len(text) / source:.1%}")
```

<div class="line-notes">

- `root = Path(sys.argv[1]).expanduser() / "src"` 从命令行拿仓库路径。`expanduser()` 把 `~` 展开成家目录。mini-swe-agent 的代码在 `src/minisweagent/` 下。
- `source = sum(len(f.read_text(encoding="utf-8")) for f in (root / "minisweagent").rglob("*.py"))` 所有 `.py` 文件的字符数加起来,也就是「全部 cat 一遍」要塞进上下文的量。
- `print(f"{files} 个 .py 文件,源码共 {source} 个字符;repo map {len(text)} 个字符,约是源码的 {len(text) / source:.1%}")` `:.1%` 把小数格式化成保留一位的百分数,0.071 显示为 7.1%。

</div>

```bash
uv run python -m part10.coding_agent.ex605_bigmap ~/src/mini-swe-agent
```

真实输出:

```text
minisweagent/__init__.py
  class Model
  class Environment
  class Agent
minisweagent/agents/__init__.py
  _AGENT_MAPPING = ...
  def get_agent_class(spec: str) -> type[Agent]
  def get_agent(model: Model, env: Environment, config: dict, *, default_type: str='') -> Agent
minisweagent/agents/default.py
  class AgentConfig
  class DefaultAgent
minisweagent/agents/interactive.py
...
59 个 .py 文件,源码共 215190 个字符;repo map 15374 个字符,约是源码的 7.1%
```

21 万多字符的源码,地图只有 1.5 万字符,约 7%。到了这个规模,「全部 cat 一遍」已经不现实,地图开始有意义。

漏了什么:`class DefaultAgent` 下面什么都没有,`run`、`step`、`query` 这些方法全没列出来,因为我们只遍历了 `tree.body` 顶层。对这个仓库来说,最重要的逻辑都在类的方法里,所以这份地图帮助有限。改进办法是对 `ast.ClassDef` 再遍历一层 `node.body`,把方法签名缩进列在类名下面;更进一步可以像 Aider 的 repo map 那样,按「被引用次数」给符号排序,只列最重要的一部分,控制在固定的 token 预算内。

</details>

**验收标准**:`test_stuck.py` 5 个测试通过;`demo_stuck.py` 在第 3 步打出提醒、第 4 步以 `Stuck` 退出;`sandbox.py` 的前四个命令都被拦下;`bash_agent_v2.py` 在重建的 `toy_repo2` 上跑出 `Submitted`,`judge.py` 判 resolved;能说出 `bad_patch.py` 为什么 FAIL_TO_PASS 全过却不算解决;写出一份「怎么证明你加的东西有用」的实验方案,哪怕暂时没跑。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 卡死检测(stuck detection) | 程序盯着 Agent 的最近几步,发现它原地打转(重复同一动作、同一报错、来回切换、只说不做)就提醒或停止 |
| nudge(提醒) | 检测到苗头时往对话里塞一条消息提醒模型换思路,先提醒再停是 OpenHands 的做法 |
| 定位(localization) | 从 issue 的描述出发,找到需要修改的文件和行 |
| agentic search | 让模型用 grep、find 这类工具自己一步步找代码,不预先建索引 |
| repo map | 用静态分析生成的仓库目录,列出每个文件的函数、类、常量签名,不含函数体 |
| FAIL_TO_PASS / PASS_TO_PASS | SWE-bench 的两组判定测试:修复后应该变通过的,和本来就该一直通过的 |
| resolved | SWE-bench 里一道题算解决:两组测试全部通过 |
| 事件流(event stream) | OpenHands 的核心设计:Agent 的每个动作和观察都存成事件,可回放、可恢复 |
| condenser | OpenHands 里负责压缩上下文的组件,默认超过 240 个事件就把较早的部分总结掉 |
| ACP(Agent Client Protocol) | 控制台或编辑器和 Coding Agent 之间通信的协议,OpenHands Agent Canvas 用它接第三方 Agent |
| apply_patch | Codex 的编辑工具,模型输出一段固定格式的补丁文本,一次可以改多个文件多处 |
| freeform 工具 | 不走 JSON 参数、直接接收自由文本的工具,用语法文件约束格式 |
| 约束解码 | 模型生成每个 token 时只允许选符合语法的那些,保证输出一定合法 |
| Seatbelt / sandbox-exec | macOS 的进程沙箱机制和它的命令行工具,用策略文件限制进程能读写哪些文件、能不能联网 |
| Landlock / bubblewrap | Linux 上的两种进程隔离机制,Codex 在 Linux 上用它们 |
| execpolicy | Codex 的命令级审批策略,每条规则按命令前缀匹配,决定 allow、prompt 或 forbidden |

## 常见误区

**卡死了直接杀掉。** 很多时候提醒一句模型就能换思路,直接杀掉浪费了前面的进度。先提醒,再终止,并且把被终止的轨迹存下来做错误分析。

**判卡死的顺序写反。** 先判「3 次提醒」再判「4 次停止」的话,第 4 次也会命中提醒,永远停不下来。从严重到轻依次判。

**只看 FAIL_TO_PASS。** 目标测试全过不代表修好了。`math.ceil` 那个补丁让少收一分变成多收一分,只有 PASS_TO_PASS 能抓住。

**以为提示词能管住 Agent 的活动范围。** 提示词里写了「在仓库根目录」,模型照样 `cd /repo || cd ~` 跑到了家目录。软约束要有,但一定要有一层硬隔离(沙箱、容器),它不依赖模型听不听话。

**沙箱把 .env 留在可读范围里。** 练习仓库根目录的 `.env` 里有 API key。沙箱放开了 `.venv` 和仓库,但 `.env` 要单独禁掉,否则一条 `cat ../../../.env` 就能读到。

**提交暗号和别的命令粘在一起。** `... && echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT` 的输出第一行不是暗号,程序认不出提交,模型却以为做完了,开始空转。提示词里要写明单独执行,循环里要处理「不调工具」的情况。

**一上来就做向量检索定位代码。** 函数名和变量名精确匹配更准,代码改了索引还得重建。先 agentic search 加轻量 repo map,有评测数据证明不够再加。

**拿 3 次实跑下结论。** 练习 2 里调用次数从 4 到 8 都有,随机波动比两组差距还大。小样本只能说明「流程跑通了」,不能说明谁更好。

## 学习资料

### 文档与文章

- [OpenHands 论文(arXiv 2407.16741)](https://arxiv.org/abs/2407.16741):事件流架构和沙箱设计,读第 2 节,40 分钟。英文。
- [OpenHands Software Agent SDK 论文(arXiv 2511.03690)](https://arxiv.org/abs/2511.03690):SDK 怎么拆成 Agent、工具、Workspace 几层,配合读 `software-agent-sdk` 源码,40 分钟。英文。
- [OpenHands SDK 文档](https://docs.openhands.dev/sdk):看 Conversation 和 Condenser 两部分,30 分钟。英文。
- [SWE-bench 论文(arXiv 2310.06770)](https://arxiv.org/abs/2310.06770):基准怎么构造、怎么判定,读第 2 节,30 分钟。英文。
- [SWE-bench 官网](https://www.swebench.com/):Verified、bash only 等几个榜单,看「同模型不同框架」的分数差距,15 分钟。
- [Codex 文档](https://developers.openai.com/codex):看沙箱和审批模式(sandbox / approvals)那几页,对照今天读的 `sandboxing` 和 `execpolicy`,30 分钟。英文。
- [Aider:Building a better repository map with tree sitter](https://aider.chat/2023/10/22/repomap.html):repo map 按引用关系排序、控制在 token 预算内的做法,练习 4 的改进方向,20 分钟。英文。

### B 站视频

- AI论文小小编《OpenHands软件代理SDK:面向生产代理的可组合和可扩展基础》:已嵌入正文,23 分钟。
- 港中深人工智能协会《AI小知识·第一集|SWE-bench:大语言模型能修真实项目中的 GitHub Issue 吗?》:已嵌入正文,23 分钟。

### 其他经典视频

- OpenHands 官方《How to Get Started with OpenHands (CLI, Cloud & SDK Explained)》:已嵌入正文,24 分钟。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章 Agent 部分讲失败模式和评测,和今天的卡死检测、实验设计对应,1 小时。英文原版。

### 开源项目与代码

- [OpenHands/software-agent-sdk](https://github.com/OpenHands/software-agent-sdk):读 `openhands-sdk/openhands/sdk/conversation/stuck_detector.py` 全文、`conversation/types.py` 的 `StuckDetectionThresholds`、`conversation/impl/local_conversation.py` 的 `_check_stuck_or_nudge`、`context/condenser/llm_summarizing_condenser.py`。
- [openai/codex](https://github.com/openai/codex):读 `codex-rs/core/assets/tools/apply_patch.lark`、`codex-rs/core/src/tools/handlers/apply_patch_spec.rs`、`codex-rs/sandboxing/src/seatbelt_base_policy.sbpl` 开头 30 行、`codex-rs/execpolicy/README.md` 和 `examples/example.codexpolicy`。
- [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands):看 README 了解 Agent Canvas 和 ACP 接第三方 Agent 的方式,不用读代码。

## 自测

**1. OpenHands 的卡死检测认哪几种模式?默认阈值多少?为什么只扫最近 20 个事件?**

<details><summary>答案</summary>

注释里列了五种:同一动作同一结果(默认 4 次)、同一动作同一报错(3 次先提醒,再多一次判卡死)、自言自语(连续 3 条只说话不干活)、两个动作来回交替(6 个动作呈 ABABAB)、上下文窗口报错(目前是空实现,`return False` 加 TODO)。只扫最近 20 个是因为卡死是「现在」的状态,早先打过转后来恢复了的不该再算;另外长对话的事件可能很多而且存在文件里,全量读会慢。

</details>

**2. `math.ceil` 那个补丁为什么 FAIL_TO_PASS 全过却不算解决?换成 JS,你能写出同样的坑吗?**

<details><summary>答案</summary>

因为它把 `test_team_annual` 改挂了:`99.9 * 12 * 100` 是 `119880.00000000001`,向上取整得 119881,团队版年付多收一分钱。PASS_TO_PASS 要求修复前通过的测试修复后也通过,这一条没满足,所以 not resolved。JS 里完全一样:`Math.ceil(99.9 * 12 * 100)` 也是 119881,`Math.trunc(19.99 * 100)` 也是 1998,正确做法是 `Math.round`,或者从一开始就用整数「分」存价格。

</details>

**3. Codex 为什么把系统沙箱和命令策略分成两层?今天的实跑里哪一层起了作用?**

<details><summary>答案</summary>

两层防的东西不一样。系统沙箱(macOS Seatbelt、Linux Landlock/bubblewrap)保证进程不管执行什么,都出不了允许的目录和网络,防越界;命令策略(execpolicy 的 allow/prompt/forbidden)按命令语义判断,防在允许范围内的破坏性操作,比如 `git reset --hard`。只有黑名单容易被换写法绕过,只有沙箱拦不住工作目录里的误删。今天的实跑里,第一版没有沙箱,Agent 跑到家目录翻了别的项目;加上 Seatbelt 之后 `ls ~/Documents` 直接 `Operation not permitted`,这是系统沙箱那一层。

</details>

**4. 定位代码的三种做法各有什么优缺点?今天的实验能证明 repo map 有用吗?**

<details><summary>答案</summary>

agentic search 不用建索引、永远是最新代码,但步数多、费 token;repo map 用很少的 token 给出全局结构,但要维护生成逻辑,只列顶层时会漏掉类方法;向量检索能按语义找,但代码里精确匹配更准,索引维护成本高。今天的实验不能证明 repo map 有用:仓库只有 95 行,全部 cat 一遍更直接;每组只跑 3 次,调用次数的波动比两组差距还大。它只能说明在这么小的仓库上不值得加。

</details>

**5. 面试题:让你给公司内部一个两百万行的 Java 单体仓库设计一个修 bug 的 Coding Agent,工具集、定位策略、执行环境和停止条件你会怎么定?怎么证明你的设计是对的?**

<details><summary>答案</summary>

先说约束:仓库大、Java、构建慢,「跑测试」本身就很贵。工具集:受限的代码搜索(grep 加按模块过滤,结果截断并提示缩小范围)、分窗查看、带单文件编译检查的精确替换编辑(写入前只检查这一个文件,避免每次全量编译)、只跑相关模块测试的测试工具、git diff。定位:预先生成一份 repo map(模块、包、类和公共方法签名,按引用次数排序,控制在固定 token 预算内)放进提示词,具体位置靠 agentic search,先不做向量索引。执行环境:容器里跑,依赖缓存只读挂载,网络默认关闭,仓库外不可写,再加一层命令策略(`git push`、删除目录要审批)。停止条件:步数、花费、墙钟时间,加卡死检测,先提醒后停。

证明方式:从仓库历史里挑几十个已修复的 bug,按 SWE-bench 的格式构造成「issue + 修复前提交 + FAIL_TO_PASS + PASS_TO_PASS」,对比只给 bash 的基线和我的设计,每次只加一样东西,每题多跑几次,看解决率、步数、花费和退出状态分布,并做统计检验。某样东西在评测上没有带来明显提升就去掉。上线后再看真实使用中的采纳率和回滚率。

</details>

## 明天预告

Day 606 讲 Computer Use(一):三条路线,2026 年的接口。今天和昨天的 Agent 操作的都是文本,代码和命令;明天它要去操作图形界面:看截图点坐标、读页面结构按编号点、或者干脆写一段 Playwright 脚本。我们会比较这三条路线,看 2026 年 Claude 和 OpenAI 的 computer use 接口长什么样,然后用 Playwright 搭一个浏览器 Agent 真跑一次。今天给 bash 加的沙箱和白名单,明天在浏览器里会换一种形式再出现。
