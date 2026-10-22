---
title: 'Day 604 · Coding Agent 内部(一):五块拆解,SWE-agent 和 mini-swe-agent'
description: '把 Claude Code、Codex 这类能自己改仓库的 Agent 拆成五块,再读两个同一团队做的开源实现:SWE-agent 给模型专门设计工具界面,mini-swe-agent 只给一个 bash。今天亲手写分窗查看、带校验的替换编辑和一个只有 bash 的修 bug Agent,真跑一次。'
pubDate: 2026-10-22
regime: none
tags: ['coding-agent', 'swe-agent', 'mini-swe-agent', 'aci', 'source-reading', 'agent-zero']
series: 'agent-zero'
day: 604
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 603](/blog/agent-zero/day-603-platform-review/) 你把 AgentOps 平台的设计文档拿出来过了一遍评审,讲的是平台怎么搭、谁对什么负责。从今天开始换一个方向,连着几天看几种「形态特殊」的 Agent。第一种是 Coding Agent,也就是 Claude Code、Codex、OpenHands 这类能自己读仓库、改文件、跑测试的东西。你天天在用它们写前端,今天把它们拆开看里面是什么。

## 今天要解决的问题

[Day 170](/blog/agent-zero/day-170-agent-full/) 你写过一个 100 行的 Agent 循环:调模型,模型要调工具就执行,把结果塞回去,再调模型。Claude Code 里面转的也是这个循环,它和你那 100 行的差距不在循环上,在循环外面那一圈:给模型什么工具、工具返回什么格式、命令在哪跑、什么时候停。资深面试里问 Coding Agent,很少问「你用过 Cursor 吗」,更常问「让你设计一个修 bug 的 Agent,文件编辑工具你怎么设计,为什么」。这种题只能靠读过真实实现来答。

学完今天你应该能:

1. 说出 Coding Agent 的五个组成部分,拿到任何一个开源实现都知道按这五块去找代码。
2. 解释 ACI 是什么,并用 SWE-agent 的两个工具(分窗查看、精确替换编辑)举例说清楚「工具接口怎么设计会影响模型干活」。
3. 读懂 mini-swe-agent 的核心循环,自己写一个只有 bash 工具的 Agent,让它真的修好一个 bug。

今天只讲两个新东西:**ACI** 和 **只给 bash 的极简 Agent**。OpenHands、Codex、SWE-bench 和「怎么找到要改的地方」留到明天。

预计用时 2.5 到 3 小时,其中读源码大概 40 分钟。前置:[Day 166](/blog/agent-zero/day-166-agent-min/)(最小 Agent 循环)、[Day 170](/blog/agent-zero/day-170-agent-full/)(完整的 Agent)、[Day 180](/blog/agent-zero/day-180-tool-design-1/)(工具不是 API)、[Day 135](/blog/agent-zero/day-135-llm-client-1/) 起的 `common/llm.py`。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `bash_agent.py` 的 `solve()` 默写出来;做练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 先把 Coding Agent 拆成五块

不管是 Claude Code、Codex 还是开源的 OpenHands,剥掉界面以后都能拆成同样的五块。这张图今天和明天都会用到,建议记下来。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Coding Agent 的五个组成部分">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <rect x="250" y="20" width="140" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="44" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">模型 + 提示词</text>
  <text x="320" y="62" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">循环在这里转</text>
  <rect x="24" y="120" width="170" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="109" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">① 工具集 / ACI</text>
  <text x="109" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">看、搜、改、跑</text>
  <rect x="235" y="120" width="170" height="64" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="320" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">② 上下文管理</text>
  <text x="320" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">找代码 · 压缩历史</text>
  <rect x="446" y="120" width="170" height="64" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="531" y="146" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">③ 执行环境</text>
  <text x="531" y="166" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">容器 · 沙箱 · 权限</text>
  <rect x="130" y="222" width="170" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="215" y="246" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">④ 验证</text>
  <text x="215" y="264" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">复现脚本 · 跑测试</text>
  <rect x="340" y="222" width="170" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="425" y="246" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">⑤ 停止与兜底</text>
  <text x="425" y="264" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">步数 · 花费 · 卡死</text>
  <line x1="290" y1="76" x2="120" y2="120" stroke="var(--rule)"/>
  <line x1="320" y1="76" x2="320" y2="120" stroke="var(--rule)"/>
  <line x1="350" y1="76" x2="520" y2="120" stroke="var(--rule)"/>
  <line x1="300" y1="76" x2="215" y2="222" stroke="var(--rule)"/>
  <line x1="340" y1="76" x2="425" y2="222" stroke="var(--rule)"/>
</svg>
<figcaption>模型在中间转循环,周围五块决定它能不能把活干完。读任何一个 Coding Agent 的源码,都按这五块去找对应文件。</figcaption>
</figure>

拿你熟悉的前端开发打个比方。你自己修一个 bug 的时候,会用编辑器打开文件(看)、全局搜索函数名(搜)、改代码(改)、在终端跑 `npm test`(跑),这四件事就是①工具集。项目几千个文件,你不会全部打开,只看相关的几个,这是②上下文管理。你在自己电脑上跑命令,`rm -rf` 之前会犹豫一下,这是③执行环境和权限。改完以后跑测试、刷新页面看效果,这是④验证。改了两小时还没头绪,你会停下来换个思路或者去问人,这是⑤停止与兜底。

Coding Agent 就是让模型来做这五件事,只是每一件都要由程序显式地给出来。模型自己没有「编辑器」,你给它什么工具它才有什么;它也不会自己觉得「我卡住了」,得有代码去检测。

今天读的两个项目都来自普林斯顿和斯坦福的同一个团队(SWE-bench 也是他们做的),而且在五块里的第①块上做了完全相反的选择。这一对放在一起读特别有意思。

## 准备:一个有 bug 的小仓库

读源码之前,先造一个让 Agent 修的小仓库,后面所有工具都在它身上试。这个仓库是虚构公司云簿 CloudLedger 的发票计算模块,`apply_discount` 里埋了一个 bug。

先在练习仓库里建今天的目录。练习仓库 `agent-zero-lab/` 是一路建下来的,`common/llm.py` 是 [Day 135](/blog/agent-zero/day-135-llm-client-1/) 到 [Day 137](/blog/agent-zero/day-137-llm-client-3/) 写的 LLMClient,`.env` 里是 DeepSeek 的 key。

```bash
cd agent-zero-lab
mkdir -p part10/coding_agent
touch part10/__init__.py part10/coding_agent/__init__.py
```

`__init__.py` 是空文件,作用是让 Python 把这两个目录当成「包」,后面才能用 `python -m part10.coding_agent.xxx` 的方式运行,并且在代码里写 `from common.llm import LLMClient`([Day 72](/blog/agent-zero/day-072-pytest-2/) 讲过包和 pythonpath 的坑)。

然后写一个生成仓库的脚本。为什么不直接手写几个文件?因为一会儿 Agent 会改它,改完你想再跑一次就得还原,用脚本一键重建最省事。

```python
# agent-zero-lab/part10/coding_agent/make_repo.py
"""造一个有 bug 的小仓库 toy_repo/,每次运行都重新生成,方便反复让 Agent 修。"""
import shutil
from pathlib import Path

ROOT = Path(__file__).parent / "toy_repo"

INVOICE = '''"""云簿 CloudLedger 的发票计算。"""


def subtotal(items):
    """items 是 [(单价, 数量), ...],返回小计。"""
    total = 0
    for price, qty in items:
        total += price * qty
    return round(total, 2)


def apply_discount(amount, percent):
    """打折:percent=20 表示打八折。"""
    if percent < 0 or percent > 100:
        raise ValueError("percent 必须在 0 到 100 之间")
    total = amount * percent / 100
    return round(total, 2)


def add_tax(amount, rate=0.06):
    """加增值税,默认 6%。"""
    total = amount * (1 + rate)
    return round(total, 2)


def invoice_total(items, discount_percent=0):
    return add_tax(apply_discount(subtotal(items), discount_percent))
'''

TESTS = '''from billing.invoice import add_tax, apply_discount, invoice_total, subtotal


def test_subtotal():
    assert subtotal([(99, 2), (10.5, 1)]) == 208.5


def test_discount_20_percent():
    assert apply_discount(100, 20) == 80


def test_no_discount():
    assert apply_discount(100, 0) == 100


def test_tax():
    assert add_tax(100) == 106


def test_invoice_total():
    assert invoice_total([(100, 1)], discount_percent=20) == 84.8
'''


def main() -> None:
    if ROOT.exists():
        shutil.rmtree(ROOT)
    (ROOT / "billing").mkdir(parents=True)
    (ROOT / "tests").mkdir()
    (ROOT / "billing" / "__init__.py").write_text("", encoding="utf-8")
    (ROOT / "billing" / "invoice.py").write_text(INVOICE, encoding="utf-8")
    (ROOT / "tests" / "test_invoice.py").write_text(TESTS, encoding="utf-8")
    (ROOT / "pytest.ini").write_text("[pytest]\npythonpath = .\n", encoding="utf-8")
    print(f"已生成 {ROOT.name}/")
    for f in sorted(ROOT.rglob("*.py")):
        print(" ", f.relative_to(ROOT), len(f.read_text(encoding="utf-8").splitlines()), "行")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `import shutil` 标准库里管「整目录操作」的模块,下面只用它的 `rmtree` 删整个目录,相当于 Node 里的 `fs.rmSync(dir, { recursive: true })`。
- `ROOT = Path(__file__).parent / "toy_repo"` `__file__` 是当前脚本的路径,`.parent` 是它所在的目录,`/` 在 `Path` 上是拼路径。实跑时 `ROOT` 是 `.../agent-zero-lab/part10/coding_agent/toy_repo`。不管你在哪个目录运行脚本,仓库都生成在脚本旁边。
- `INVOICE = '''"""云簿 CloudLedger 的发票计算。"""` 三个单引号开头的多行字符串,里面整段就是 `invoice.py` 的源码。外层用 `'''` 是因为里面的 docstring 用的是 `"""`,两种引号错开才不会提前结束。相当于 JS 的模板字符串 `` `...` ``。
- `def apply_discount(amount, percent):` bug 就在这个函数里。注释说 percent=20 是打八折,也就是付 80%。
- `total = amount * percent / 100` 这行是 bug:它算的是「折掉的那部分」而不是「要付的那部分」。`apply_discount(100, 20)` 会返回 20.0,正确应该是 80。
- `return round(total, 2)` 注意这一行在文件里出现了三次(第 9、17、23 行),后面演示编辑工具的「唯一匹配」时会用到。
- `TESTS = '''from billing.invoice import add_tax, apply_discount, invoice_total, subtotal` 测试文件的源码。五个测试里,`test_discount_20_percent`、`test_no_discount`、`test_invoice_total` 三个会因为这个 bug 失败。
- `assert invoice_total([(100, 1)], discount_percent=20) == 84.8` 100 元打八折是 80,再加 6% 税是 84.8。
- `if ROOT.exists():` 已经有旧仓库就先删掉,保证每次都是一个干净的、有 bug 的版本。
- `(ROOT / "billing").mkdir(parents=True)` `parents=True` 相当于 `mkdir -p`,中间缺的目录一起建。
- `(ROOT / "pytest.ini").write_text("[pytest]\npythonpath = .\n", encoding="utf-8")` 让 pytest 把仓库根目录加进导入路径,测试里 `from billing.invoice import ...` 才找得到。不写这行会报 `ModuleNotFoundError: No module named 'billing'`,[Day 72](/blog/agent-zero/day-072-pytest-2/) 专门讲过这个坑。
- `for f in sorted(ROOT.rglob("*.py")):` `rglob` 递归找所有 `.py` 文件,打印每个文件多少行,方便确认生成对了。

</div>

在 `agent-zero-lab/` 根目录跑,再进仓库跑一下测试,确认 bug 在:

```bash
uv run python part10/coding_agent/make_repo.py
cd part10/coding_agent/toy_repo && uv run pytest -q; cd ../../..
```

真实输出(测试部分只贴最后几行):

```text
已生成 toy_repo/
  billing/__init__.py 0 行
  billing/invoice.py 27 行
  tests/test_invoice.py 21 行
FAILED tests/test_invoice.py::test_discount_20_percent - assert 20.0 == 80
FAILED tests/test_invoice.py::test_no_discount - assert 0.0 == 100
FAILED tests/test_invoice.py::test_invoice_total - assert 21.2 == 84.8
3 failed, 2 passed in 0.07s
```

3 个失败,和预想一致。现在我们有了一个「issue + 仓库 + 判定测试」的最小组合,这正是 SWE-bench 每道题的结构(明天细讲)。

## SWE-agent:给模型专门设计界面

SWE-agent 是这个团队 2024 年的论文和开源项目,论文标题把观点说完了:《SWE-agent: Agent-Computer Interfaces Enable Automated Software Engineering》。论文摘要里写,它在 SWE-bench 上做到了 12.5% 的 pass@1,在当时是最好成绩。12.5% 今天看很低,但它提出的一个概念到现在还在用:ACI。

### ACI 是什么

ACI 是 agent-computer interface 的缩写,中文可以叫「给 Agent 用的人机界面」。[Day 180](/blog/agent-zero/day-180-tool-design-1/) 讲「工具不是 API」时你已经见过这个视角:同一个功能,给人用和给模型用,界面应该不一样。

拿前端打比方最好懂。同样是「看一个文件」,给人用的界面是 VS Code:语法高亮、可以滚动、鼠标悬停看类型。给程序用的界面是 `fs.readFileSync`:一次返回全部内容。那给模型用的界面应该长什么样?SWE-agent 的回答是:模型既不是人也不是普通程序,它有自己的毛病(上下文有限、整个文件塞进去反而找不到重点、改 Python 经常把缩进写错),所以要单独为它设计界面。比如一次只给它看 100 行,带行号;编辑时先检查语法,写错了不让落盘,并且告诉它错在哪。

一句话定义:**ACI 就是 Agent 能用的那组工具,加上每个工具的输入格式、输出格式和报错写法**。工具有哪些只是一半,另一半是「返回给模型的那段字符串长什么样」。

### 去仓库里看

动手前先把仓库拉下来。我是 2026 年 10 月 22 日拉的,SWE-agent 最新提交是 2026-07-16,版本号 1.1.0。

```bash
mkdir -p ~/src && cd ~/src
git clone --depth 1 https://github.com/SWE-agent/SWE-agent.git
cd SWE-agent && ls tools
```

`--depth 1` 只拉最新一次提交,不要完整历史,省时间省空间。真实输出:

```text
diff_state  edit_anthropic  filemap  forfeit  image_tools  multilingual_setup  registry
review_on_submit_m  search  submit  web_browser  windowed  windowed_edit_linting
windowed_edit_replace  windowed_edit_rewrite
```

(原输出是一行一个,这里排在一起。)`tools/` 下每个子目录是一组工具,仓库里管它叫 bundle,每组的配置写在自己的 `config.yaml` 里。今天看四个。

**`tools/windowed/`:分窗查看。** 打开 `tools/windowed/config.yaml`,里面定义了 `open`、`goto`、`scroll_up`、`scroll_down` 这几个命令。`scroll_up` 的说明是 `moves the window up {WINDOW} lines`,`WINDOW` 的默认值在 `tools/windowed/install.sh` 里:

```text
_write_env "WINDOW" "${WINDOW:-100}"
```

`${WINDOW:-100}` 是 shell 语法,意思是「环境变量 WINDOW 有值就用它,没有就用 100」。所以模型每次只看到 100 行。为什么不直接 `cat` 整个文件?论文里的消融实验(把某个设计去掉再跑一遍,看分数掉多少)说得很清楚:整个文件塞进去,模型反而更容易找不到重点。

**`tools/edit_anthropic/bin/str_replace_editor`:精确替换编辑。** 这是现在默认配置用的编辑工具。它的用法是「把文件里唯一出现的一段旧文本 `old_str` 换成新文本 `new_str`」。在文件里搜报错信息,能看到两种拒绝:

```text
No replacement was performed, old_str `{}` did not appear verbatim in {}.
No replacement was performed. Multiple occurrences of old_str `{}` in lines {}. Please ensure it is unique
```

一种是「原文里找不到」,一种是「出现了好几次,请让它唯一」,第二种还会告诉模型在哪几行。这个工具的接口最早来自 Anthropic 的 computer use 演示,后来几乎成了行业标准,Claude Code 的 Edit 工具就是这个形态。你用 Claude Code 时偶尔会看到它报「String to replace not found」然后重新读文件,就是撞上了第一种拒绝。

**`tools/windowed_edit_linting/`:改完先跑 lint。** 这是论文里的老编辑工具,按行号区间替换。打开 `bin/edit`,第 95 行和第 101 行分别在编辑前后跑 `flake8`(Python 的代码检查工具,相当于 ESLint),有新错误就不写入,把错误和改前改后的代码窗口都返回给模型。模型改 Python 最常见的翻车就是缩进,这一条对成绩影响很明显。

**`tools/review_on_submit_m/`:提交前再审一遍。** 模型调用 `submit` 时不直接结束,而是收到一段提醒:改完代码后重新跑一遍复现脚本、删掉复现脚本、把改过的测试文件还原,下面附上你的全部 diff,确认后再 submit 一次。这段话就写在 `config/default.yaml` 的 `SUBMIT_REVIEW_MESSAGES` 里。

同一个 `config/default.yaml` 里还有两处值得看。一处是 `instance_template`,也就是给模型的任务提示,写的流程很朴素:先找到并读相关代码,写个脚本复现错误,改源码,再跑复现脚本确认修好,想想边界情况;另外还有一句「测试文件我已经改好了,你不需要动」。这就是五块里的④验证,简单但有用。另一处是:

```text
    - type: cache_control
      last_n_messages: 2
```

只给最后两条消息打 prompt caching 标记。这是成本优化,[Day 527](/blog/agent-zero/day-527-kv-cache-design/) 讲过前缀缓存为什么能省钱。

最后看一眼 README 开头的提示,这一条很说明问题:

```text
> Most of our current development effort is on [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent/),
> Our general recommendation is to use mini-SWE-agent instead of SWE-agent going forward.
```

作者团队自己说,现在主要精力在 mini-swe-agent 上,推荐大家用它。这个转向是今天后半段的主题。

### 自己写第一件工具:分窗查看

读完配置,自己用 20 行 Python 把分窗查看写出来。它的作用是:给一个文件路径和起始行,返回带行号的一段内容,结尾告诉模型后面还有多少、下一步怎么继续看。

```python
# agent-zero-lab/part10/coding_agent/view_tool.py
"""SWE-agent 式的分窗查看:一次只给模型看一段,带行号,告诉它后面还有多少。"""
from pathlib import Path


def view(path: str, start: int = 1, window: int = 10) -> str:
    p = Path(path)
    if not p.is_file():
        return f"错误:{path} 不存在或不是文件。可以先用 ls 或 grep 找到正确路径。"
    lines = p.read_text(encoding="utf-8").splitlines()
    total = len(lines)
    start = max(1, min(start, total))
    end = min(total, start + window - 1)
    body = "\n".join(f"{i:>4}| {lines[i - 1]}" for i in range(start, end + 1))
    head = f"[{path},共 {total} 行,显示 {start}-{end}]"
    tail = ""
    if end < total:
        tail = f"\n(后面还有 {total - end} 行,继续看用 view(\"{path}\", start={end + 1}))"
    return f"{head}\n{body}{tail}"


if __name__ == "__main__":
    print(view("toy_repo/billing/invoice.py", start=12))
    print("---")
    print(view("toy_repo/billing/invoce.py"))
```

<div class="line-notes">

- `def view(path: str, start: int = 1, window: int = 10) -> str:` 返回值是字符串,因为它是给模型看的,模型只认文字。SWE-agent 默认窗口 100 行,我们的小文件只有 27 行,所以默认设成 10 行好演示。
- `if not p.is_file():` 路径不存在时不抛异常,而是返回一句人话。抛异常的话 Agent 循环里要专门接,而且异常信息(比如 `FileNotFoundError: [Errno 2]...`)对模型没有指导意义。
- `return f"错误:{path} 不存在或不是文件。可以先用 ls 或 grep 找到正确路径。"` 报错里带着「下一步该干什么」,这是 ACI 的要点:报错是写给模型看的操作说明。
- `lines = p.read_text(encoding="utf-8").splitlines()` 读整个文件再按行切成列表,相当于 JS 的 `text.split("\n")`。实跑 `invoice.py` 得到 27 个元素。
- `start = max(1, min(start, total))` 把起始行夹在 1 到总行数之间,传 0 或负数都按 1 算。练习 1 会发现这一行在两种边界情况下行为不对。
- `end = min(total, start + window - 1)` start=12、window=10 时 end=21;如果算出来超过文件长度就取文件长度。
- `body = "\n".join(f"{i:>4}| {lines[i - 1]}" for i in range(start, end + 1))` `{i:>4}` 是把行号右对齐补到 4 个字符宽,相当于 JS 的 `String(i).padStart(4)`。`lines[i - 1]` 是因为行号从 1 开始而列表下标从 0 开始。`range(12, 22)` 生成 12 到 21。
- `head = f"[{path},共 {total} 行,显示 {start}-{end}]"` 头部告诉模型「这是哪个文件、一共多长、你现在看的是哪段」,它就知道自己在文件里的位置。
- `tail = f"\n(后面还有 {total - end} 行,继续看用 view(\"{path}\", start={end + 1}))"` 直接把下一步的调用写出来,模型照抄就行。27-21=6,所以实跑显示「后面还有 6 行」。
- `print(view("toy_repo/billing/invoce.py"))` 故意把 invoice 拼错一个字母,看报错长什么样。

</div>

```bash
cd part10/coding_agent && uv run python view_tool.py; cd ../..
```

真实输出:

```text
[toy_repo/billing/invoice.py,共 27 行,显示 12-21]
  12| def apply_discount(amount, percent):
  13|     """打折:percent=20 表示打八折。"""
  14|     if percent < 0 or percent > 100:
  15|         raise ValueError("percent 必须在 0 到 100 之间")
  16|     total = amount * percent / 100
  17|     return round(total, 2)
  18| 
  19| 
  20| def add_tax(amount, rate=0.06):
  21|     """加增值税,默认 6%。"""
(后面还有 6 行,继续看用 view("toy_repo/billing/invoice.py", start=22))
---
错误:toy_repo/billing/invoce.py 不存在或不是文件。可以先用 ls 或 grep 找到正确路径。
```

对比一下 `cat`:`cat` 不给行号、不说文件多长、读错路径时报 `cat: toy_repo/billing/invoce.py: No such file or directory`。人看这些够用,模型拿到行号以后,下一步说「改第 16 行」就有了依据。

### 自己写第二件工具:带校验的精确替换

第二件是编辑工具,照着 `str_replace_editor` 的思路写,再加上 `windowed_edit_linting` 那条「改坏了不落盘」。

```python
# agent-zero-lab/part10/coding_agent/edit_tool.py
"""SWE-agent / Claude Code 式的精确替换编辑:old 必须在文件里只出现一次,改完先过语法检查再落盘。"""
import ast
from pathlib import Path


def line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def str_replace(path: str, old: str, new: str) -> str:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count == 0:
        return "没改:old 在文件里一处都没找到。多半是缩进或空格不一致,先 view 看准原文再复制。"
    if count > 1:
        lines, pos = [], text.find(old)
        while pos != -1:
            lines.append(str(line_of(text, pos)))
            pos = text.find(old, pos + 1)
        return f"没改:old 出现了 {count} 次(第 {', '.join(lines)} 行)。多带几行上下文,让它只匹配一处。"
    new_text = text.replace(old, new, 1)
    if p.suffix == ".py":
        try:
            ast.parse(new_text)
        except SyntaxError as e:
            return f"拒绝写入:改完后第 {e.lineno} 行有语法错误({e.msg})。文件没动,请改好 new 再试。"
    p.write_text(new_text, encoding="utf-8")
    return f"已修改 {path} 第 {line_of(new_text, text.find(old))} 行附近。"


if __name__ == "__main__":
    f = "toy_repo/billing/invoice.py"
    print("1)", str_replace(f, "total = amount * percent/100", "x"))
    print("2)", str_replace(f, "    return round(total, 2)", "    return total"))
    print("3)", str_replace(f, "def add_tax(amount, rate=0.06):", "def add_tax(amount, rate=0.06)"))
    print("4)", str_replace(f, "total = amount * percent / 100", "total = amount * (100 - percent) / 100"))
```

<div class="line-notes">

- `import ast` 标准库里的 Python 语法解析器,能把源码解析成语法树,写错了会抛 `SyntaxError`。相当于前端的 acorn 或 Babel parser。[Day 248](/blog/agent-zero/day-248-code-retrieval/) 用它切过代码块。
- `return text.count("\n", 0, offset) + 1` 数一数从开头到 offset 之间有几个换行,加 1 就是 offset 所在的行号。offset 是字符位置,比如 `text.find(old)` 的返回值。
- `count = text.count(old)` 数 old 在文件里出现了几次。JS 里没有现成的,要写 `text.split(old).length - 1`。
- `if count == 0:` 找不到。实际使用中最常见的原因是模型凭记忆写 old,空格和原文差一点,所以报错里直接提示「先 view 看准原文再复制」。
- `lines, pos = [], text.find(old)` 同时给两个变量赋值:`lines` 是空列表,`pos` 是第一次出现的位置。`find` 找不到返回 -1,相当于 JS 的 `indexOf`。
- `while pos != -1:` 循环找下一处,把每一处的行号收集起来。
- `pos = text.find(old, pos + 1)` 从上一处的后一个字符开始接着找。
- `return f"没改:old 出现了 {count} 次(第 {', '.join(lines)} 行)。多带几行上下文,让它只匹配一处。"` 实跑第 2 个调用时这里返回「出现了 3 次(第 9, 17, 23 行)」。告诉模型具体行号,它就能去看那几行,挑一处带上更多上下文。
- `new_text = text.replace(old, new, 1)` 第三个参数 1 表示只换第一处。上面已经确认只有一处了,这里写 1 是双保险。注意 Python 的 `replace` 默认替换全部,和 JS 的 `String.prototype.replace` 默认只换第一处正好相反。
- `if p.suffix == ".py":` 只对 Python 文件做语法检查。`suffix` 是扩展名,`invoice.py` 的是 `.py`。
- `ast.parse(new_text)` 关键一步:在内存里解析改完之后的完整文件,还没写到磁盘上。
- `return f"拒绝写入:改完后第 {e.lineno} 行有语法错误({e.msg})。文件没动,请改好 new 再试。"` `e.lineno` 和 `e.msg` 是 SyntaxError 自带的行号和描述。实跑第 3 个调用时返回「第 20 行有语法错误(expected ':')」,因为把函数定义末尾的冒号删了。
- `p.write_text(new_text, encoding="utf-8")` 前面全部通过才落盘。坏代码永远到不了磁盘。
- `print("1)", str_replace(f, "total = amount * percent/100", "x"))` 故意少写两个空格(原文是 `percent / 100`),演示「找不到」。
- `print("4)", str_replace(f, "total = amount * percent / 100", "total = amount * (100 - percent) / 100"))` 正确的修法:付 (100 - 折扣)% 的钱。这一处在文件里唯一,能改成功。

</div>

先重建仓库,再跑,最后跑测试:

```bash
uv run python part10/coding_agent/make_repo.py > /dev/null
cd part10/coding_agent && uv run python edit_tool.py && cd toy_repo && uv run pytest -q | tail -1; cd ../../..
```

真实输出:

```text
1) 没改:old 在文件里一处都没找到。多半是缩进或空格不一致,先 view 看准原文再复制。
2) 没改:old 出现了 3 次(第 9, 17, 23 行)。多带几行上下文,让它只匹配一处。
3) 拒绝写入:改完后第 20 行有语法错误(expected ':')。文件没动,请改好 new 再试。
4) 已修改 toy_repo/billing/invoice.py 第 16 行附近。
5 passed in 0.09s
```

四次调用,三次被拒,一次成功,测试全绿。被拒的三次里文件一个字节都没动,这是这件工具最值钱的地方:模型改出语法错误,如果直接落盘,下一步它看到的就是一个坏掉的文件,很容易在错的基础上越改越乱。挡在写入之前,模型只需要重新生成这一次编辑。

你可能会问,第 2 个调用为什么不干脆三处一起替换?因为模型想改的往往只是其中一处。在这个文件里,把三处 `return round(total, 2)` 全改掉会顺带改坏 `subtotal` 和 `add_tax`。要求唯一匹配,等于逼模型说清楚自己到底要改哪儿。

## mini-swe-agent:只给一个 bash

一年后,同一个团队做了 mini-swe-agent,README 第一段就很挑衅:

```text
We now ask: **What if our agent was 100x simpler, and still worked nearly as well?**
```

如果 Agent 简单 100 倍,还能差不多好用吗?README 里写它在 SWE-bench Verified 上超过 74%(这是项目自己的说法,我没有复现)。它的设计几乎和 SWE-agent 反着来,README 里列了三条:

- 除了 bash 什么工具都没有。没有分窗查看,没有 str_replace,看文件用 `cat` 和 `nl -ba`,改文件用 `sed` 和 `cat <<EOF`。
- 历史完全线性。每一步只往 messages 里追加,轨迹(trajectory,Agent 一次运行留下的完整记录)和发给模型的消息是同一个东西,调试和拿去做训练数据都方便。
- 每个动作用 `subprocess.run` 独立执行,不维持一个长期开着的 shell。要换到容器里跑,把 `subprocess.run` 换成 `docker exec` 就行。

这里出现了一个新词:**subprocess**,子进程。你的 Python 程序是一个进程,它再启动一个新进程去执行 `ls` 或 `pytest`,这个新进程就是子进程。在 Node 里对应的是 `child_process.execSync`。[Day 187](/blog/agent-zero/day-187-codeact-2/) 让模型写的代码在子进程里跑,用的是同一个东西。

### 读它的核心循环

```bash
cd ~/src && git clone --depth 1 https://github.com/SWE-agent/mini-swe-agent.git
cd mini-swe-agent && wc -l src/minisweagent/agents/default.py src/minisweagent/environments/local.py
grep -n "__version__ =" src/minisweagent/__init__.py
```

真实输出(2026-10-22 拉取,最新提交 2026-09-03):

```text
     190 src/minisweagent/agents/default.py
      92 src/minisweagent/environments/local.py
     282 total
src/minisweagent/__init__.py:__version__ = "2.4.6"
```

整个 Agent 类 190 行,执行环境 92 行。打开 `default.py`,第一次读只找三件事:上限有哪些、循环怎么转、怎么退出。

**上限**在 `AgentConfig` 里:

```text
    step_limit: int = 0
    cost_limit: float = 3.0
    wall_time_limit_seconds: int = 0
    max_consecutive_format_errors: int = 3
```

`step_limit` 是最多调几次模型,0 表示不限;`cost_limit` 默认 3 美元;`wall_time_limit_seconds` 是墙钟时间(就是现实里过去了多少秒);`max_consecutive_format_errors` 是模型连续 3 次输出格式不对就退出。这四个就是五块里的⑤停止与兜底。

**循环**在 `run()` 里,核心就是 `while True:` 里不停调 `self.step()`,`step()` 只有一行:`return self.execute_actions(self.query())`,先问模型,再执行模型要的动作。

**退出**的写法很值得学。`query()` 开头检查上限,超了就 `raise LimitsExceeded(...)`,异常里带着一条 role 为 `exit` 的消息。`run()` 里接住异常,把这条消息追加进历史,然后检查 `if self.messages[-1].get("role") == "exit": break`。模型自己说做完了也是同一个路子:`local.py` 的 `_check_finished` 发现命令输出的第一行是 `COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT`,就抛 `Submitted`。所有「该停了」的情况都变成一条 exit 消息,循环只需要看最后一条消息是不是 exit。

**执行**在 `environments/local.py` 的 `execute()`,最终调 `_run()`,用 `subprocess.Popen(command, shell=True, ...)` 跑命令,默认 30 秒超时,超时就把整个进程组杀掉。

还有一个 2026 年读这个仓库要注意的变化。README 说「它甚至不需要模型的 tool calling 接口」,那是 v1 的做法:模型在回复正文里写一个 bash 代码块,程序用正则抠出来。现在的 v2(README 顶部有提示)默认改成了走 tool calling,只注册一个叫 `bash` 的工具,定义在 `src/minisweagent/models/utils/actions_toolcall.py` 的 `BASH_TOOL`;老的文本方式还在,换成 `mini_textbased.yaml` 配置就是,模型要把命令写在一个语言标记为 `mswea_bash_command` 的 markdown 代码块里,程序用正则抠出来(正则写在 `litellm_textbased_model.py` 的 `action_regex`)。也就是说「只有 bash」没变,「不用 tool calling」变成了可选项。

### 自己写一个只有 bash 的 Agent

读懂了就自己写一个,60 行左右。它用 [Day 136](/blog/agent-zero/day-136-llm-client-2/) 的 `LLMClient` 调 DeepSeek,工具只有一个 bash,提示词照着 mini-swe-agent 的 `mini.yaml` 缩写。

```python
# agent-zero-lab/part10/coding_agent/bash_agent.py
"""仿 mini-swe-agent:只有一个 bash 工具,历史线性追加,每条命令独立 subprocess 执行。"""
import json
import subprocess
import sys
from pathlib import Path

from common.llm import LLMClient

DONE = "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT"
BASH_TOOL = {
    "type": "function",
    "function": {
        "name": "bash",
        "description": "Execute a bash command",
        "parameters": {
            "type": "object",
            "properties": {"command": {"type": "string", "description": "The bash command to execute"}},
            "required": ["command"],
        },
    },
}
SYSTEM = "You are a helpful assistant that can interact with a computer."
INSTANCE = """Please solve this issue: {task}

You can execute bash commands and edit files. Workflow:
1. Find and read relevant files  2. Reproduce the issue  3. Edit the source code
4. Run the tests again to verify  5. Finish by running exactly: echo {done}
Every command runs in a fresh subshell in the repo root. You are on macOS: use sed -i ''.
Do not modify files under tests/."""


def run_bash(command: str, cwd: Path, timeout: int = 30) -> dict:
    try:
        r = subprocess.run(command, shell=True, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return {"returncode": r.returncode, "output": (r.stdout + r.stderr)[-3000:]}
    except subprocess.TimeoutExpired:
        return {"returncode": -1, "output": f"命令超过 {timeout} 秒,已终止。"}


def solve(task: str, repo: Path, step_limit: int = 15, cost_limit: float = 0.2) -> str:
    llm = LLMClient()
    status = "LimitsExceeded:步数用完"
    messages = [{"role": "system", "content": SYSTEM},
                {"role": "user", "content": INSTANCE.format(task=task, done=DONE)}]
    for step in range(1, step_limit + 1):
        if llm.ledger.cost >= cost_limit:
            status = f"LimitsExceeded:花费到了 ¥{llm.ledger.cost:.4f}"
            break
        r = llm.chat(messages, tools=[BASH_TOOL])
        messages.append(r.message)
        if not r.message.get("tool_calls"):
            messages.append({"role": "user", "content": "你必须调用 bash 工具。做完了就执行 echo " + DONE})
            continue
        for call in r.message["tool_calls"]:
            cmd = json.loads(call["function"]["arguments"])["command"]
            out = run_bash(cmd, repo)
            print(f"[{step}] $ {cmd}\n    → rc={out['returncode']} {out['output'][:160]!r}")
            if out["output"].strip().startswith(DONE) and out["returncode"] == 0:
                status = "Submitted"
            messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(out, ensure_ascii=False)})
        if status == "Submitted":
            break
    (Path(__file__).parent / "traj.json").write_text(json.dumps(messages, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n{llm.ledger}")
    return status


if __name__ == "__main__":
    repo = Path(__file__).parent / "toy_repo"
    issue = " ".join(sys.argv[1:]) or "apply_discount(100, 20) 应该返回 80(打八折),现在返回 20。发票总额也跟着错了。"
    print("结果:", solve(issue, repo))
```

<div class="line-notes">

- `import subprocess` 标准库里启动子进程的模块,相当于 Node 的 `child_process`。
- `from common.llm import LLMClient` Day 135 起写的 LLMClient,读 `.env` 里的 `LLM_BASE_URL`、`LLM_MODEL`(这次是 `deepseek-flash`)和价格,`chat()` 返回一个带 `message`、`cost` 的结果,`ledger` 记总账。
- `DONE = "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT"` 和 mini-swe-agent 用同一个暗号。模型执行 `echo` 这串字,程序看到输出就知道它认为做完了。为什么不让模型直接回一句「我做完了」?因为「做完」这个信号要经过执行环境才算数,和其他命令走同一条路,判断起来简单可靠。
- `"name": "bash",` 唯一的工具,名字、描述、参数和 mini-swe-agent 的 `BASH_TOOL` 一字不差。只有一个参数 `command`,一段要执行的 shell 命令。
- `SYSTEM = "You are a helpful assistant that can interact with a computer."` 系统提示词照抄 `mini.yaml`。很短,因为真正的任务说明在第一条 user 消息里。
- `INSTANCE = """Please solve this issue: {task}` 任务模板,`{task}` 和 `{done}` 是占位符,下面用 `.format()` 填进去,相当于 JS 模板字符串里的 `${task}`。提示词用英文是照抄原项目,中文也能用。
- `1. Find and read relevant files  2. Reproduce the issue  3. Edit the source code` 流程和 SWE-agent 的 instance_template 一样:找代码、复现、改、验证。这就是五块里的④验证写进了提示词。
- `Every command runs in a fresh subshell in the repo root. You are on macOS: use sed -i ''.` 两句都是实际踩坑后加的。第一句提醒模型每条命令都是新开的 shell,`cd` 不会保留到下一条(下面会演示)。第二句是 macOS 的 `sed` 和 Linux 的写法不一样,不提醒的话模型多半写 Linux 版然后报错(下面也会演示)。mini-swe-agent 的 `mini.yaml` 里有同样的判断:`{%- if system == "Darwin" -%}`。
- `def run_bash(command: str, cwd: Path, timeout: int = 30) -> dict:` 执行环境,也就是五块里的③。这里只是在本机直接跑,没有任何隔离,所以只能让它碰 `toy_repo` 这种无所谓的目录。真要上生产得放进容器,[Day 415](/blog/agent-zero/day-415-sandbox/) 讲过沙箱。
- `r = subprocess.run(command, shell=True, cwd=cwd, capture_output=True, text=True, timeout=timeout)` 逐个参数看:`shell=True` 让命令交给 shell 解释,这样 `&&`、`|`、`;` 才能用;`cwd=cwd` 在仓库目录里跑;`capture_output=True` 把标准输出和标准错误都收进来,不打印到屏幕;`text=True` 拿到的是字符串而不是字节;`timeout` 超时就抛 `TimeoutExpired`。还有一个隐含的点:我们用 `uv run` 启动这个脚本,子进程会继承虚拟环境的 PATH,所以模型在里面敲 `python -m pytest` 能直接用上 `.venv` 里的 pytest。
- `return {"returncode": r.returncode, "output": (r.stdout + r.stderr)[-3000:]}` 返回码 0 表示成功,非 0 表示失败。输出只保留最后 3000 个字符,防止一个 `cat` 大文件把上下文撑爆。只留尾巴其实有问题,练习 3 会改。
- `except subprocess.TimeoutExpired:` 命令卡住(比如模型启动了一个不会退出的服务器)时走这里,返回一句话给模型,而不是让整个 Agent 跟着卡死。
- `def solve(task: str, repo: Path, step_limit: int = 15, cost_limit: float = 0.2) -> str:` 两个上限:最多 15 步,最多花 0.2 元。返回值是退出状态,和 mini-swe-agent 的 `exit_status` 对应。
- `status = "LimitsExceeded:步数用完"` 先假设最坏情况,循环正常跑完 15 步没有提交,返回的就是这个。
- `messages = [{"role": "system", "content": SYSTEM},` 历史从两条消息开始。之后每一步只往后追加,从不删改,这就是「线性历史」。
- `if llm.ledger.cost >= cost_limit:` 每次调模型之前先看花了多少,超了就停。mini-swe-agent 也是在 `query()` 开头检查。
- `r = llm.chat(messages, tools=[BASH_TOOL])` 调模型,把唯一的工具传进去。`tools` 会原样传给 OpenAI 兼容接口。
- `messages.append(r.message)` 模型的回复(包括 tool_calls)原样追加进历史。[Day 159](/blog/agent-zero/day-159-tool-roundtrip/) 讲过,带 tool_calls 的 assistant 消息必须进历史,后面的 tool 消息才对得上。
- `if not r.message.get("tool_calls"):` 模型没调工具,只回了一段话。mini-swe-agent 把这种情况算格式错误,我们简化成提醒一句再继续。
- `cmd = json.loads(call["function"]["arguments"])["command"]` 工具参数是一段 JSON 字符串,解析出来取 `command`。实跑第 3 步拿到的是 `cd . && sed -i '' 's|total = amount \* percent / 100|total = amount * (100 - percent) / 100|' billing/invoice.py && python -m pytest -q`。
- `print(f"[{step}] $ {cmd}\n    → rc={out['returncode']} {out['output'][:160]!r}")` 打印每一步执行了什么、结果的前 160 个字符。`!r` 是用 `repr` 显示,换行会显示成 `\n`,一行就能看全。
- `if out["output"].strip().startswith(DONE) and out["returncode"] == 0:` 判断模型是不是在提交。条件和 mini-swe-agent 的 `_check_finished` 一样:输出第一行是暗号,并且命令成功。
- `messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps(out, ensure_ascii=False)})` 执行结果作为 tool 消息回给模型,`tool_call_id` 必须和上面那次调用的 id 对上。内容是 JSON,带返回码,模型能分清命令是成功还是失败。`ensure_ascii=False` 让中文原样保留,不转成 `中` 这种。
- `(Path(__file__).parent / "traj.json").write_text(json.dumps(messages, ensure_ascii=False, indent=1), encoding="utf-8")` 把完整历史存成文件。因为历史是线性的,这份文件就是轨迹,出问题时打开它从头读一遍就知道模型每一步看到了什么、做了什么。
- `print(f"\n{llm.ledger}")` 打印这次一共调了几次、多少 token、多少钱。实跑打印 `4 次调用 | 输入 3520 / 输出 327 tokens | 约 ¥0.0051`。
- `issue = " ".join(sys.argv[1:]) or "apply_discount(100, 20) 应该返回 80(打八折),现在返回 20。发票总额也跟着错了。"` 命令行没给 issue 就用默认的。注意 issue 里只描述了现象,没说 bug 在哪一行,Agent 得自己找。

</div>

跑之前先重建仓库,在 `agent-zero-lab/` 根目录用 `-m` 方式运行(这样 `common` 才能被导入):

```bash
uv run python part10/coding_agent/make_repo.py
uv run python -m part10.coding_agent.bash_agent
```

我这次的真实输出:

```text
已生成 toy_repo/
  billing/__init__.py 0 行
  billing/invoice.py 27 行
  tests/test_invoice.py 21 行
[1] $ find . -type f -not -path '*/.git/*' | head -100 && grep -rn "apply_discount" . --exclude-dir=.git
    → rc=0 './pytest.ini\n./tests/test_invoice.py\n./billing/__init__.py\n./billing/invoice.py\n./tests/test_invoice.py:1:from billing.invoice import add_tax, apply_discount, i'
[2] $ cat billing/invoice.py; echo ---; cat tests/test_invoice.py; echo ---; cat billing/__init__.py
    → rc=0 '"""云簿 CloudLedger 的发票计算。"""\n\n\ndef subtotal(items):\n    """items 是 [(单价, 数量), ...],返回小计。"""\n    total = 0\n    for price, qty in items:\n        total += price * q'
[3] $ cd . && sed -i '' 's|total = amount \* percent / 100|total = amount * (100 - percent) / 100|' billing/invoice.py && python -m pytest -q
    → rc=0 '.....                                                                    [100%]\n5 passed in 0.06s\n'
[4] $ echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT
    → rc=0 'COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\n'

4 次调用 | 输入 3520 / 输出 327 tokens | 约 ¥0.0051
结果: Submitted
```

4 步修好。第 1 步列文件并 grep 函数名(这就是「找到要改的地方」,明天细讲),第 2 步把源码和测试一次 cat 出来,第 3 步用 `sed` 改一行并且在同一条命令里跑测试,第 4 步提交。它跳过了「写复现脚本」这一步,因为测试本身就是复现脚本。再进仓库自己跑一次测试确认:

```bash
cd part10/coding_agent/toy_repo && uv run pytest -q | tail -1; cd ../../..
```

```text
5 passed in 0.04s
```

**花了多少钱。** 用的是 `deepseek-flash`,2026 年 10 月 22 日在 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)查到的高峰价是:缓存命中输入 0.04 元、未命中输入 2 元、输出 8 元,都是每百万 token。如果 3520 个输入 token 全按未命中算,是 3520 × 2 / 1,000,000 + 327 × 8 / 1,000,000 = 0.00704 + 0.00262 ≈ 0.0097 元。实际账单 0.0051 元更低,因为每一步都把前面的历史原样再发一遍,前缀一样的那部分命中了缓存(按 0.0051 反推,大约 2,300 个 token 命中)。线性历史在这里还有一个好处:前缀从不改动,缓存命中率天然高。

你多跑几次,每次的命令会不一样。我前一次跑用了 5 步,第 3 步多了一次在 Python 里直接调用 `apply_discount(100, 20)` 看返回值,花了 0.0078 元。模型的输出本来就有随机性,所以评测 Coding Agent 一般每题跑好几次。

### 两个坑,当场演示

**坑一:macOS 的 sed。** 提示词里那句「use sed -i ''」不是随手写的。macOS 自带的 `sed` 是 BSD 版,`-i` 后面必须跟一个备份后缀(空字符串表示不备份);Linux 上的 GNU 版不需要。模型训练数据里 Linux 写法多得多,不提醒的话很容易写成 Linux 版。我们手动敲一次 Linux 写法:

```bash
uv run python part10/coding_agent/make_repo.py > /dev/null
cd part10/coding_agent/toy_repo
sed -i 's|percent / 100|(100 - percent) / 100|' billing/invoice.py; echo "rc=$?"
cd ../../..
```

真实输出:

```text
sed: 1: "billing/invoice.py": undefined label 'illing/invoice.py'
rc=1
```

BSD sed 把 `'s|...|'` 当成了备份后缀,把文件名 `billing/invoice.py` 当成了 sed 脚本,`b` 在 sed 里是「跳转到标签」命令,于是报「找不到标签 illing/invoice.py」。报错信息和真实原因差了十万八千里,模型看到这种报错经常会反复换写法重试。这也是 SWE-agent 当年要做专门编辑工具的原因之一:`sed` 对模型来说是一个很难用的界面。

**坑二:每条命令都是新的 shell。** 写一个小脚本试一下 `run_bash`:

```python
# agent-zero-lab/part10/coding_agent/try_run_bash.py
from pathlib import Path

from part10.coding_agent.bash_agent import run_bash

repo = Path("part10/coding_agent/toy_repo")
print(run_bash("sleep 5", repo, timeout=2))
print(run_bash("cd billing && pwd", repo)["output"][-30:])
print(run_bash("pwd", repo)["output"][-30:])
```

<div class="line-notes">

- `from part10.coding_agent.bash_agent import run_bash` 只导入执行函数,不调模型,不花钱。
- `print(run_bash("sleep 5", repo, timeout=2))` `sleep 5` 会睡 5 秒,超时设成 2 秒,演示超时那条分支。
- `print(run_bash("cd billing && pwd", repo)["output"][-30:])` 同一条命令里先 `cd` 再 `pwd`,能看到进了 billing。只打印最后 30 个字符,前面是很长的临时目录路径。
- `print(run_bash("pwd", repo)["output"][-30:])` 下一条命令再问当前目录。

</div>

```bash
uv run python -m part10.coding_agent.try_run_bash
```

真实输出:

```text
{'returncode': -1, 'output': '命令超过 2 秒,已终止。'}
coding_agent/toy_repo/billing

/part10/coding_agent/toy_repo

```

第二条 `cd billing` 生效了,第三条又回到了仓库根目录。每次 `subprocess.run` 都是一个全新的 shell,上一条的 `cd`、`export` 都不会留下来。这对模型是个约束(想在某个目录干活就得每条命令都带上 `cd xxx &&`),对工程却是好事:每一步互不影响,任何一步都能单独重放,换成 `docker exec` 也不用改逻辑。mini-swe-agent 的 FAQ 专门有一节解释为什么不用长期 shell 会话,README 原话是「Seriously, this is a big deal, trust me」。

## 两种思路放在一起看

| 五块 | SWE-agent | mini-swe-agent |
| --- | --- | --- |
| ① 工具集 | 分窗查看、str_replace、lint 拒写、搜索、提交前复查 | 只有 bash |
| ② 上下文 | 窗口 100 行,历史处理器,只给最后两条打缓存标记 | 线性历史,不压缩,长输出截头尾 |
| ③ 执行环境 | Docker 容器里的长期 shell 会话 | 每条命令独立 subprocess,可换 docker exec |
| ④ 验证 | 提示词里要求复现,submit 时再提醒一次 | 提示词里要求复现 |
| ⑤ 停止 | 步数、花费 | 步数、花费、时间、连续格式错误 |

那 SWE-agent 精心设计的那套 ACI 是不是白做了?我觉得不是,两件事同时成立。2024 年的模型确实需要专门设计的界面才能可靠地查看和编辑代码;到 2025、2026 年,模型在 bash 上已经足够熟练,刚才那次实跑里 `deepseek-flash` 用 `sed` 一次就改对了,专门界面带来的增益变小了,而简单带来的好处(好调试、轨迹能直接拿去训练、任何模型都能跑)变大了。

这对你做技术决策的启发是:**工具接口的价值和模型能力强相关**。换了更强的模型以后,要重新评测之前加的那些工具还值不值得留。很多团队的 Agent 越写越复杂,从来没回头删过东西。怎么评测「这个工具值不值得留」,明天会给一个实验设计。

另外别忘了,Claude Code 和 Codex 这些产品今天仍然带着专门的编辑工具(Claude Code 的 Edit 就是 str_replace 形态,Codex 的 apply_patch 明天讲)。研究基线追求极简,产品追求稳定和省 token,两边选得不一样很正常。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ragGzLE42&autoplay=0&high_quality=1" title="【论文精读】Agent经典论文!秒解Github Issues?软件工程Agent全解析,为Agent打造专属电脑接口" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>大咖讲AI · 【论文精读】Agent经典论文!秒解Github Issues?软件工程Agent全解析,为Agent打造专属电脑接口 · 68 分钟,SWE-agent 论文逐段讲,重点听 ACI 设计原则和消融实验那段。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Vc2jBSEzT&autoplay=0&high_quality=1" title="极简的ai程序员mini-swe-agent" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>敬古开新 · 极简的ai程序员mini-swe-agent · 7 分钟,快速过一遍 mini-swe-agent 怎么装、怎么跑,看完再回头读 default.py 会更顺。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RJ6NN8Y-xok" title="SWE-agent: A deep dive" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Ofir Press · SWE-agent: A deep dive · 20 分钟,作者本人讲为什么要给模型单独设计界面,英文,和论文配合看。</figcaption>
</figure>

## 动手练习

**练习 1:修 `view()` 的两个边界。** 用 `view_tool.py` 分别看空文件 `toy_repo/billing/__init__.py`,以及 `invoice.py` 的 `start=100`,观察返回什么,哪里不对?写一个 `view_safe()` 修好。

<details><summary>参考答案</summary>

先观察。在 `part10/coding_agent/` 目录下跑:

```bash
uv run python -c "
from view_tool import view
print(repr(view('toy_repo/billing/__init__.py')))
print(view('toy_repo/billing/invoice.py', start=100))"
```

真实输出:

```text
'[toy_repo/billing/__init__.py,共 0 行,显示 1-0]\n'
[toy_repo/billing/invoice.py,共 27 行,显示 27-27]
  27|     return add_tax(apply_discount(subtotal(items), discount_percent))
```

两处都不对。空文件显示「1-0」,模型看不懂;`start=100` 被 `min(start, total)` 悄悄夹成了 27,模型以为自己看到的是第 100 行附近,其实是最后一行。悄悄纠正参数是 ACI 里很危险的做法,模型不知道自己的请求被改了。修法是这两种情况都明确告诉它:

```python
# agent-zero-lab/part10/coding_agent/ex604_view.py
"""练习 1 参考答案:空文件和 start 越界都给出明确提示,而不是悄悄显示别的行。"""
from pathlib import Path

from view_tool import view


def view_safe(path: str, start: int = 1, window: int = 10) -> str:
    p = Path(path)
    if p.is_file():
        total = len(p.read_text(encoding="utf-8").splitlines())
        if total == 0:
            return f"[{path} 是空文件,0 行]"
        if start > total:
            return f"错误:{path} 只有 {total} 行,start={start} 超出范围。想看结尾用 view(\"{path}\", start={max(1, total - window + 1)})"
    return view(path, start, window)


if __name__ == "__main__":
    print(view_safe("toy_repo/billing/__init__.py"))
    print(view_safe("toy_repo/billing/invoice.py", start=100))
    print(view_safe("toy_repo/billing/invoice.py", start=26))
```

<div class="line-notes">

- `from view_tool import view` 在 `part10/coding_agent/` 目录里直接运行,同目录的文件可以这样导入。
- `if p.is_file():` 文件存在才检查边界,不存在就交给原来的 `view` 返回那句「不存在」。
- `if total == 0:` 空文件单独说清楚。`__init__.py` 走这条。
- `if start > total:` 越界不再悄悄夹住,而是报错,并且直接给出「看结尾」的正确调用。27 - 10 + 1 = 18,所以建议 `start=18`。
- `return view(path, start, window)` 正常情况复用原函数,不重复写。
- `print(view_safe("toy_repo/billing/invoice.py", start=26))` 正常的边界:从倒数第二行开始看,应该显示 26-27。

</div>

```bash
uv run python ex604_view.py
```

真实输出:

```text
[toy_repo/billing/__init__.py 是空文件,0 行]
错误:toy_repo/billing/invoice.py 只有 27 行,start=100 超出范围。想看结尾用 view("toy_repo/billing/invoice.py", start=18)
[toy_repo/billing/invoice.py,共 27 行,显示 26-27]
  26| def invoice_total(items, discount_percent=0):
  27|     return add_tax(apply_discount(subtotal(items), discount_percent))
```

</details>

**练习 2:改成功后回显上下文。** SWE-agent 和 Claude Code 的编辑工具改成功后,都会把改动附近几行带行号回给模型,模型不用再 view 一次就能确认改对了。给 `str_replace` 包一层 `str_replace_echo()`,成功时回显改动处上下 3 行。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/coding_agent/ex604_edit.py
"""练习 2 参考答案:改成功后把改动处上下 3 行带行号回显,模型不用再 view 一次就能确认。"""
from edit_tool import str_replace


def str_replace_echo(path: str, old: str, new: str, context: int = 3) -> str:
    before = open(path, encoding="utf-8").read()
    msg = str_replace(path, old, new)
    if not msg.startswith("已修改"):
        return msg
    first = before[: before.find(old)].count("\n") + 1
    last = first + new.count("\n")
    lines = open(path, encoding="utf-8").read().splitlines()
    a, b = max(1, first - context), min(len(lines), last + context)
    snippet = "\n".join(f"{i:>4}| {lines[i - 1]}" for i in range(a, b + 1))
    return f"{msg}改动附近现在是:\n{snippet}"


if __name__ == "__main__":
    print(str_replace_echo("toy_repo/billing/invoice.py",
                           "total = amount * percent / 100",
                           "total = amount * (100 - percent) / 100"))
```

<div class="line-notes">

- `before = open(path, encoding="utf-8").read()` 改之前先读一份原文,用来算 old 在第几行。`open(...).read()` 和 `Path(path).read_text()` 效果一样。
- `msg = str_replace(path, old, new)` 复用原来的工具,所有校验都还在。
- `if not msg.startswith("已修改"):` 被拒了就原样返回拒绝原因,不回显。
- `first = before[: before.find(old)].count("\n") + 1` old 开始的位置之前有几个换行,加 1 是起始行号。这里是第 16 行。
- `last = first + new.count("\n")` new 如果有多行,结束行要往后推。这次 new 是单行,所以 last 也是 16。
- `a, b = max(1, first - context), min(len(lines), last + context)` 往上往下各扩 3 行,不越过文件头尾:13 到 19。

</div>

先重建仓库,在 `part10/coding_agent/` 下跑:

```bash
uv run python make_repo.py > /dev/null && uv run python ex604_edit.py
```

真实输出:

```text
已修改 toy_repo/billing/invoice.py 第 16 行附近。改动附近现在是:
  13|     """打折:percent=20 表示打八折。"""
  14|     if percent < 0 or percent > 100:
  15|         raise ValueError("percent 必须在 0 到 100 之间")
  16|     total = amount * (100 - percent) / 100
  17|     return round(total, 2)
  18| 
  19| 
```

</details>

**练习 3:长输出保留头和尾。** `run_bash` 现在只保留输出的最后 3000 个字符。先观察 `seq 1 3000`(打印 1 到 3000,每个数一行)的结果开头是什么,再参考 mini-swe-agent 的 `observation_template`(超过 10000 字符时给前 5000 和后 5000,中间写省略了多少),写一个 `run_bash_v2`。

<details><summary>参考答案</summary>

先观察,在 `agent-zero-lab/` 根目录跑:

```bash
uv run python -c "
from pathlib import Path
from part10.coding_agent.bash_agent import run_bash
o = run_bash('seq 1 3000', Path('.'))['output']; print(len(o), repr(o[:10]))"
```

```text
3000 '2401\n2402\n'
```

完整输出是 13,893 个字符,只留尾巴以后开头变成了 2401,模型完全不知道前面还有东西被扔了。如果报错信息在开头(Python 的 traceback 一般在最后,但很多构建工具的第一条错误在开头),就丢了最关键的那句。我第一次写这个练习时还碰到另一个坑:在 `part10/coding_agent/` 目录里直接 `uv run python ex604_truncate.py`,而文件里写的是 `from bash_agent import run_bash`,结果报:

```text
  File ".../part10/coding_agent/bash_agent.py", line 8, in <module>
    from common.llm import LLMClient
ModuleNotFoundError: No module named 'common'
```

原因是 `bash_agent.py` 要从 `agent-zero-lab/` 根目录导入 `common`,而在子目录运行时根目录不在导入路径里。所以下面的答案不导入 `bash_agent`,自己写一份执行函数。

```python
# agent-zero-lab/part10/coding_agent/ex604_truncate.py
"""练习 3 参考答案:输出太长时保留头和尾,中间告诉模型省略了多少(学 mini-swe-agent 的 observation_template)。"""
import subprocess
from pathlib import Path


def shorten(output: str, limit: int = 2000) -> str:
    if len(output) <= limit:
        return output
    half = limit // 2
    return (output[:half]
            + f"\n...[中间省略 {len(output) - limit} 个字符,请用 head、tail 或 grep 缩小范围]...\n"
            + output[-half:])


def run_bash_v2(command: str, cwd: Path, timeout: int = 30, limit: int = 2000) -> dict:
    try:
        r = subprocess.run(command, shell=True, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return {"returncode": r.returncode, "output": shorten(r.stdout + r.stderr, limit)}
    except subprocess.TimeoutExpired:
        return {"returncode": -1, "output": f"命令超过 {timeout} 秒,已终止。"}


if __name__ == "__main__":
    here = Path(__file__).parent
    out = run_bash_v2("seq 1 3000", here, limit=40)
    print(out["output"])
```

<div class="line-notes">

- `def shorten(output: str, limit: int = 2000) -> str:` 单独一个函数,方便测试,也方便以后换策略。
- `half = limit // 2` `//` 是整除,相当于 JS 的 `Math.floor(limit / 2)`。limit=40 时 half=20。
- `+ f"\n...[中间省略 {len(output) - limit} 个字符,请用 head、tail 或 grep 缩小范围]...\n"` 明确告诉模型省略了多少,并且给出缩小范围的办法。13,893 - 40 = 13,853。
- `return {"returncode": r.returncode, "output": shorten(r.stdout + r.stderr, limit)}` 和原版唯一的区别:`[-3000:]` 换成了 `shorten(...)`。
- `out = run_bash_v2("seq 1 3000", here, limit=40)` 演示时 limit 设成 40,输出短一点好看。

</div>

```bash
uv run python -m part10.coding_agent.ex604_truncate
```

真实输出:

```text
1
2
3
4
5
6
7
8
9
10
...[中间省略 13853 个字符,请用 head、tail 或 grep 缩小范围]...
2997
2998
2999
3000

```

前 20 个字符正好是 1 到 10:`1\n` 到 `9\n` 各 2 个字符共 18 个,再加 `10` 两个字符,10 后面的换行没进来,换行来自省略提示开头的 `\n`。最后 20 个字符是 `2997\n` 到 `3000\n`,每个 5 个字符,末尾那个换行加上 `print` 自己的换行,所以输出最后多了一个空行。

</details>

**练习 4:步数用完会怎样。** 把 `step_limit` 设成 2 再跑一次,观察 Agent 怎么退出,仓库里的测试是什么状态。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part10/coding_agent/ex604_limit.py
"""练习 4 参考答案:把步数上限压到 2,看 Agent 在没干完时怎么退出。"""
from pathlib import Path

from part10.coding_agent.bash_agent import solve

repo = Path(__file__).parent / "toy_repo"
print("结果:", solve("apply_discount(100, 20) 应该返回 80(打八折),现在返回 20。", repo, step_limit=2))
```

<div class="line-notes">

- `from part10.coding_agent.bash_agent import solve` 复用主程序的 `solve`,只改参数。
- `print("结果:", solve("apply_discount(100, 20) 应该返回 80(打八折),现在返回 20。", repo, step_limit=2))` 只给 2 步,按刚才的实跑,至少需要 4 步。

</div>

```bash
uv run python part10/coding_agent/make_repo.py > /dev/null
uv run python -m part10.coding_agent.ex604_limit
cd part10/coding_agent/toy_repo && uv run pytest -q | tail -1; cd ../../..
```

真实输出:

```text
[1] $ ls -la && grep -rn "apply_discount" --include="*.py" . | head -50
    → rc=0 'total 8\ndrwxr-xr-x   5 minliu  wheel  160 22 Oct 12:04 .\ndrwxr-xr-x  13 minliu  wheel  416 22 Oct 12:04 ..\ndrwxr-xr-x   4 minliu  wheel  128 22 Oct 12:04 billin'
[2] $ cat billing/invoice.py && echo "---TESTS---" && cat tests/test_invoice.py
    → rc=0 '"""云簿 CloudLedger 的发票计算。"""\n\n\ndef subtotal(items):\n    """items 是 [(单价, 数量), ...],返回小计。"""\n    total = 0\n    for price, qty in items:\n        total += price * q'

2 次调用 | 输入 1164 / 输出 126 tokens | 约 ¥0.0023
结果: LimitsExceeded:步数用完
3 failed, 2 passed in 0.09s
```

两步都花在了「看」上,还没来得及改就停了,测试还是 3 个失败。返回值 `LimitsExceeded` 让调用方能区分「做完了」和「被掐断了」,这很重要:评测时被掐断的应该算失败,并且要把轨迹留下来分析是步数给少了还是模型绕了远路。这次的 `traj.json` 里只有 6 条消息(system、user,加两轮 assistant 和 tool)。

</details>

**练习 5:读源码回答一个问题。** 在 mini-swe-agent 的 `src/minisweagent/agents/default.py` 里找到「连续格式错误」的计数器。它在哪里加 1,在哪里清零?为什么要在那里清零?

<details><summary>参考答案</summary>

```bash
cd ~/src/mini-swe-agent && grep -n "n_consecutive_format_errors" src/minisweagent/agents/default.py
```

在 `run()` 的循环里:`self.step()` 正常返回后紧接着一行 `self.n_consecutive_format_errors = 0  # reset on any clean step`,也就是任何一步只要干净地执行完就清零;`except FormatError as e:` 分支里 `self.n_consecutive_format_errors += 1`,然后判断 `if 0 < self.config.max_consecutive_format_errors <= self.n_consecutive_format_errors:`,到 3 就追加一条 `RepeatedFormatError` 的 exit 消息退出。

为什么在成功的一步之后清零:这个上限要抓的是「模型彻底不会用这个格式了」,比如它一直在正文里写代码而不调工具。偶尔错一次、下一步改对了,说明它还能干活,不该被累计惩罚。如果不清零,一个跑了 50 步的长任务中间零星错过 3 次就会被误杀。同一个 `except` 分支里还有一行 `self.cost += e.messages[0].get("extra", {}).get("cost", 0.0)`,注释写着这次调用在解析失败前已经计过费,所以格式错误的那次调用也要记进花费,否则 `cost_limit` 会被低估。

</details>

**验收标准**:`bash_agent.py` 在重建后的 `toy_repo` 上跑出 `Submitted`,之后 `pytest` 显示 `5 passed`;`edit_tool.py` 的四个调用输出和文中一致;四个练习脚本都能跑出和参考答案同类的结果;能不看文章说出 mini-swe-agent 的四个上限和它怎么用异常把「该停了」带出循环。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| Coding Agent | 能自己读代码、改文件、跑命令和测试来完成编程任务的 Agent,比如 Claude Code、Codex、OpenHands |
| ACI(agent-computer interface) | 给 Agent 用的人机界面:有哪些工具,每个工具的输入输出长什么样,报错怎么写。SWE-agent 论文提出 |
| SWE-agent | 普林斯顿团队 2024 年的 Coding Agent,强调专门设计的工具界面,论文里 SWE-bench pass@1 12.5% |
| mini-swe-agent | 同一团队后来做的极简版,只有 bash 一个工具,Agent 类约 190 行,作者现在推荐用它 |
| bundle | SWE-agent 里的一组工具,`tools/` 下一个子目录就是一组,配置在各自的 `config.yaml` |
| 分窗查看 | 一次只给模型看文件的一段(SWE-agent 默认 100 行),带行号和「后面还有多少」 |
| str_replace 编辑 | 把文件里唯一出现的一段旧文本换成新文本,旧文本找不到或出现多次都拒绝 |
| lint | 代码检查,比如 Python 的 flake8、前端的 ESLint。SWE-agent 用它在编辑后拒绝写入坏代码 |
| subprocess(子进程) | 程序启动的另一个进程,用来执行命令。Python 的 `subprocess.run` 相当于 Node 的 `child_process.execSync` |
| 返回码(returncode) | 命令结束时给出的数字,0 表示成功,非 0 表示失败,shell 里用 `$?` 看 |
| 轨迹(trajectory) | Agent 一次运行留下的完整记录:每一步看到了什么、做了什么。线性历史下就等于 messages 本身 |
| 线性历史 | 每一步只往对话末尾追加,从不删改或压缩 |
| 消融实验 | 去掉系统里的某一个设计再跑一遍,看效果掉多少,用来证明这个设计有没有用 |
| BSD sed / GNU sed | macOS 和 Linux 上两个不同版本的 sed,`-i` 参数写法不一样 |

## 常见误区

**以为工具越多越好。** 每加一个工具,模型就多一种选错的可能,工具说明还要占上下文。mini-swe-agent 只有 bash 也能打出高分,说明一个工具值不值得加,要用实验证明,不能默认。

**编辑工具不做校验,坏代码直接落盘。** 模型改出语法错误,下一步再看时文件已经坏了,常常越改越乱。写入前用 `ast.parse` 这类解析器检查一遍、拒绝写入并说明哪一行什么错,是成本最低、收益最高的一条。

**参数越界时悄悄纠正。** 练习 1 里 `start=100` 被悄悄改成 27,模型以为自己看的是第 100 行。给模型的工具宁可报错,也不要偷偷改参数。

**以为 `cd` 会保留到下一条命令。** 每条命令都是新 shell,模型(和你)经常以为上一步已经进了某个目录。提示词里要写清楚,或者像我们这样把 `cwd` 固定成仓库根目录。

**在 macOS 上照抄 Linux 的 `sed -i`。** 会报 `undefined label` 这种看不懂的错。提示词里注明操作系统,或者干脆给模型一个不依赖 sed 的编辑工具。

**只看最后几千个字符。** 输出截断只留尾巴,开头的关键报错就丢了,模型还不知道丢了东西。截断要留头留尾,并且明说省略了多少。

## 学习资料

### 文档与文章

- [SWE-agent 论文(arXiv 2405.15793)](https://arxiv.org/abs/2405.15793):ACI 概念的出处,先读摘要和第 1 节,再看第 3 节的接口设计和消融表,1 小时。英文。
- [mini-swe-agent 文档](https://mini-swe-agent.com/latest/):看「FAQ」里为什么不用 shell 会话、「control flow」那一页的流程图,30 分钟。英文。
- [minimal-agent.com](https://minimal-agent.com/):mini-swe-agent 作者写的「从零写一个最小 Agent」教程,和今天的 `bash_agent.py` 是同一个思路,40 分钟。英文。
- [Anthropic:Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):工具设计的通用原则,和 ACI 是一个思路,可以对照 Day 180 的内容读,30 分钟。英文。
- [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):今天算花费用的价格页,高峰和低谷价格不一样,5 分钟。

### B 站视频

- 大咖讲AI《【论文精读】Agent经典论文!秒解Github Issues?软件工程Agent全解析,为Agent打造专属电脑接口》:已嵌入正文,68 分钟。
- 敬古开新《极简的ai程序员mini-swe-agent》:已嵌入正文,7 分钟。
- AIGCLINK《SWE-agent:将大模型转变为软件工程师Agent,可以修复 GitHub 项目中的错误和问题》:[BV1Wm42177u3](https://www.bilibili.com/video/BV1Wm42177u3/),18 分钟,2024 年 4 月的介绍视频,讲得浅一些,适合先建立印象。

### 其他经典视频

- Ofir Press《SWE-agent: A deep dive》:已嵌入正文,20 分钟,SWE-agent 作者之一。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章「RAG and Agents」里 Agent 部分讲工具、规划和失败模式,当作今天的理论底子,1.5 小时。英文原版。

### 开源项目与代码

- [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent):读 `tools/windowed/config.yaml`、`tools/edit_anthropic/bin/str_replace_editor`(搜 `No replacement was performed`)、`tools/windowed_edit_linting/bin/edit` 第 90 到 120 行、`config/default.yaml`。
- [SWE-agent/mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent):读 `src/minisweagent/agents/default.py` 全文、`src/minisweagent/environments/local.py`、`src/minisweagent/config/mini.yaml`,半小时能读完。

## 自测

**1. Coding Agent 的五个组成部分是什么?各举 SWE-agent 里的一个例子。**

<details><summary>答案</summary>

①工具集/ACI:分窗查看、str_replace 编辑。②上下文管理:窗口只给 100 行,历史处理器只给最后两条消息打缓存标记。③执行环境:Docker 容器里的 shell。④验证:提示词要求先写复现脚本,改完再跑;submit 时提醒重跑复现脚本。⑤停止与兜底:步数和花费上限。

</details>

**2. `str_replace` 为什么要求 old 在文件里只出现一次?在今天的 `invoice.py` 里举个例子。**

<details><summary>答案</summary>

模型想改的通常只是其中一处。`return round(total, 2)` 在第 9、17、23 行出现了三次,如果允许全部替换,改 `apply_discount` 的时候会顺带改掉 `subtotal` 和 `add_tax`。要求唯一,等于逼模型带上足够的上下文说清楚到底改哪一处,出现多次时返回行号,让它知道去哪儿看。

</details>

**3. mini-swe-agent 用什么方式让循环停下来?步数到了和模型说做完了,是不是两套逻辑?**

<details><summary>答案</summary>

是同一套。超过上限时 `query()` 抛 `LimitsExceeded`,模型执行 `echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT` 时执行环境抛 `Submitted`,两种异常里都带一条 role 为 `exit` 的消息。`run()` 接住异常,把消息追加进历史,循环每次只检查最后一条消息的 role 是不是 `exit`。所有停止原因都走这一条路,退出状态写在 `extra.exit_status` 里。

</details>

**4. 每条命令用独立 subprocess 执行,有什么好处和代价?**

<details><summary>答案</summary>

好处:每一步互不影响,任何一步都能单独重放;换成在容器里执行只要把 `subprocess.run` 换成 `docker exec`;不用维护一个长期 shell 的状态,也不会因为某条命令把 shell 搞坏而影响后面。代价:`cd`、`export` 不会保留,模型每条命令都得带上 `cd xxx &&`,提示词里要说清楚;一些需要交互或长期运行的程序没法用。

</details>

**5. 面试题:mini-swe-agent 只给 bash 就能在 SWE-bench Verified 上超过 74%,这是不是说明 SWE-agent 的 ACI 没用?你在自己团队里怎么决定要不要做专门的编辑工具?**

<details><summary>答案</summary>

不能这么说。ACI 的价值和模型能力相关:2024 年的模型需要专门界面才能可靠地看和改代码,2025 年以后的模型在 bash 上已经很熟练,专门界面的增益变小了,而极简在调试、训练数据、兼容任意模型上的好处变大了。另外 74% 是项目自己报的数,而且 SWE-bench 只测 Python 修 bug,不代表所有任务。

在自己团队里我会用评测来决定:挑一批已修复的真实 bug,同一个模型、同样的提示词和上限,一组只给 bash,一组加上带校验的编辑工具,每题跑几次,比较解决率、平均步数和花费。专门工具只有在解决率明显提高、或者在成本相近时减少了步数,才值得留。换了新模型以后再跑一遍,增益没了就删掉。

</details>

## 明天预告

Day 605 讲 Coding Agent 内部(二):OpenHands、Codex、SWE-bench、怎么找到要改的地方。今天只读了同一个团队的两个研究项目,明天读两个更偏产品和平台的实现:OpenHands 怎么检测 Agent 卡死,Codex 的 apply_patch 和两层沙箱怎么设计。然后回头看 SWE-bench 的判分方式,并解决一个今天被一句 `grep` 轻轻带过的问题:仓库一大,模型怎么找到要改的那几行。
