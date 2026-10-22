---
title: 'Day 13 · 第 2 周复习:编程地基(Day 7–12)'
description: '这一周从 PATH 讲到装 Python、编辑器红线、uv 两天,再到第一批 Python 代码。今天不学新东西:画一张本周知识地图,默写三段核心内容(一个在哪都能敲的 Python 命令、从空目录重建练习仓库、报价单),只用本周知识做一个「客服速算卡」命令,最后把这一周撞过的报错整理成表。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'review', 'agent-zero']
series: 'agent-zero'
day: 13
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 12](/blog/agent-zero/day-012-numbers/) 正式写了第一批 Python:变量是贴在值上的名字,`times = 1` 只是把标签改贴,不会让用到它的 `charged` 重算;数字分 int 和 float,`/` 永远出 float,`//` 往下取整(`-7 // 2` 是 −4),`%` 取余;`0.1 + 0.2` 得 `0.30000000000000004`,所以钱换成整数分来算。那天最后的 `part01/price_calc.py` 算出了 5 个席位年付的含税合计 2644 元 20 分。

这一周有五天在搭台子,只有最后一天在唱戏:PATH、装 Python、编辑器、uv 两天,都是为了让 Day 12 那十几行代码能顺顺当当跑起来。台子搭得稳不稳,下周写字符串、if 的时候就知道了:一个 `ModuleNotFoundError`、一个找不到的命令,都会把你卡住半天。今天停一天,把这周串起来,确认每块板子都钉牢了。

## 今天要解决的问题

学完今天,你应该能:

1. 合上文章默写出三段:做一个在任何目录都能敲的 Python 命令 `hello-py`(Day 7–8)、从空目录建一个 uv 项目并验证它能原样重建(Day 10–11)、Day 12 的报价单 `price_calc.py`。
2. 只用本周学过的东西做一个小项目:`~/bin/cl-calc` 客服速算卡,在任何目录敲 `cl-calc` 就打印退款、报价、本周模型花费,金额全程用整数分算,过 Ruff 和 basedpyright。
3. 看到本周出现过的每一句报错,不翻文章就能说出病因和改法。

预计用时:3 小时。默写三段各 20 分钟,小项目 1 小时,剩下做练习、自测、整理错题。

前置:[Day 7](/blog/agent-zero/day-007-terminal-4/) 到 [Day 12](/blog/agent-zero/day-012-numbers/) 全部。今天不调任何 API,花费 0 元。

学法提示:先对照文章逐条敲一遍(命令和代码自己敲,不复制粘贴)并对照输出;明天合上文章,把小项目 `cl-calc` 从一个空文件开始默写一遍;做练习时先自己写,做不出再展开参考答案,看完关掉自己重写一遍。

和前几天一样,下面的输出是我 2026-10-23 在 2019 款 Intel MacBook Pro(macOS 14、zsh、uv 0.13)上用一个演示家目录真跑的,家目录显示成 `/Users/你`。演示家目录里 `~/bin` 在 PATH 最前面,`python3` 是 3.12.13(你那边是 Day 8 装的 3.12.10),`~/agent-zero-lab` 是 Day 12 结束时的样子。

## 本周知识地图

左边三天是「让 Python 跑起来」,中间两天是「让项目跑起来」,右边一天才是「写 Python」。每一列都靠前一列:没有 Day 7 的 PATH,就解释不了 Day 8 装完敲 `python3` 为什么还是旧版本;没有 Day 10 的 uv,Day 12 的代码就没有地方放。

<figure>
<svg viewBox="0 0 640 310" role="img" aria-label="第 2 周知识地图:Day 7 PATH、Day 8 Python 解释器、Day 9 编辑器红线是让 Python 跑起来;Day 10 uv 和 Day 11 虚拟环境与 lock 是让项目跑起来;Day 12 变量和数字是第一批 Python;今天的小项目 cl-calc 用到全部">
<rect x="0" y="0" width="640" height="310" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-faint)">让 Python 跑起来</text>
<rect x="20" y="36" width="180" height="54" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="58" fill="var(--ink)">Day 7 PATH</text>
<text x="30" y="78" fill="var(--ink-soft)">which -a  .zshrc  ~/bin</text>
<rect x="20" y="102" width="180" height="54" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="124" fill="var(--ink)">Day 8 解释器</text>
<text x="30" y="144" fill="var(--ink-soft)">python3 ≈ node  shebang</text>
<rect x="20" y="168" width="180" height="54" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="190" fill="var(--ink)">Day 9 编辑器</text>
<text x="30" y="210" fill="var(--ink-soft)">basedpyright + Ruff</text>
<text x="230" y="26" fill="var(--ink-faint)">让项目跑起来</text>
<rect x="230" y="36" width="180" height="54" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="240" y="58" fill="var(--ink)">Day 10 uv</text>
<text x="240" y="78" fill="var(--ink-soft)">init add run ≈ npm</text>
<rect x="230" y="102" width="180" height="54" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="240" y="124" fill="var(--ink)">Day 11 .venv / lock</text>
<text x="240" y="144" fill="var(--ink-soft)">uv sync --locked</text>
<line x1="320" y1="90" x2="320" y2="102" stroke="var(--compute)"/>
<line x1="110" y1="90" x2="110" y2="102" stroke="var(--compute)"/>
<line x1="110" y1="156" x2="110" y2="168" stroke="var(--compute)"/>
<text x="440" y="26" fill="var(--ink-faint)">写 Python</text>
<rect x="440" y="36" width="180" height="54" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="450" y="58" fill="var(--ink)">Day 12 变量和数字</text>
<text x="450" y="78" fill="var(--ink-soft)">int float / // % 分</text>
<rect x="440" y="120" width="180" height="100" rx="6" fill="var(--paper)" stroke="var(--rule)"/>
<text x="450" y="144" fill="var(--ink)">Day 13 小项目</text>
<text x="450" y="166" fill="var(--ink-soft)">~/bin/cl-calc</text>
<text x="450" y="186" fill="var(--ink-soft)">shebang + 整数分</text>
<text x="450" y="206" fill="var(--ink-soft)">+ Ruff + 红线</text>
<line x1="530" y1="90" x2="530" y2="120" stroke="var(--ink-soft)"/>
<line x1="200" y1="129" x2="230" y2="129" stroke="var(--ink-soft)"/>
<line x1="410" y1="129" x2="440" y2="160" stroke="var(--ink-soft)"/>
<line x1="20" y1="252" x2="620" y2="252" stroke="var(--rule)"/>
<text x="20" y="274" fill="var(--ink)">贯穿全周的一件事:你敲的 python3 / python / ruff 到底是哪个文件</text>
<text x="20" y="294" fill="var(--ink-faint)">which -a、uv run、sys.prefix 都是在回答这一个问题</text>
</g>
</svg>
<figcaption>第 2 周知识地图。琥珀色五天搭台子,蓝色一天写代码;今天的小项目把六天都用上。</figcaption>
</figure>

地图底下那一行是我觉得这周最值得带走的一句话。这一周超过一半的坑,本质上都是「你以为在用 A,其实在用 B」:装了 3.12,敲出来是 3.10;装了 rich,`python3` 却说找不到;shebang 写死了 `/usr/bin/python3`,用的是苹果那个老版本。每次遇到「明明装了却不对」,先问一句「我现在用的到底是哪个」,然后用 `which -a` 或 `uv run python -c "import sys; print(sys.prefix)"` 去查。

## 本周每天一句话

- [Day 7](/blog/agent-zero/day-007-terminal-4/):shell 按 PATH 里目录的顺序找命令,第一个找到的胜出;`which -a` 看所有同名的;改 `.zshrc` 先备份、用 `>>` 追加、`export PATH="新目录:$PATH"`,改完 `source`。
- [Day 8](/blog/agent-zero/day-008-python-vs-node/):`python3` 和 `node` 一样是解释器,有交互模式和跑脚本两种用法;语法错一行都不跑,运行时错跑到出事那行才停;shebang 写 `#!/usr/bin/env python3`。
- [Day 9](/blog/agent-zero/day-009-editor-setup/):红线是语言服务器画的,basedpyright 管名字和类型,Ruff 管规范和格式;类型检查器看不出「值不对」的错,比如除以零。
- [Day 10](/blog/agent-zero/day-010-uv-1/):uv 一个工具管 Python 版本、项目和依赖,`uv init --no-package`、`uv add`、`uv add --dev`、`uv run` 对应 `npm init`、`npm i`、`npm i -D`、`npx`;不加 `uv run` 就用不到项目里装的库。
- [Day 11](/blog/agent-zero/day-011-uv-2/):`.venv` 是 Python 的 `node_modules` 外加一个解释器链接;`pyproject.toml` 写要什么,`uv.lock` 锁装了什么;`.venv` 删了 `uv sync` 恢复,CI 里用 `--locked`。
- [Day 12](/blog/agent-zero/day-012-numbers/):变量是名字标签;int 精确没上限,float 是近似值;`/` 出 float、`//` 往下取整、`%` 跟除数同号;钱用整数分算,先乘后除。

## 默写一:一个在哪都能敲的 Python 命令

这是 Day 7 和 Day 8 的组合。合上文章,从零做出 `~/bin/hello-py`,在 `~/terminal-practice/day13` 里直接敲它的名字能运行。你那边的 `~/bin/hello-py` 在 Day 8 已经做过了,先删掉它再默写(`rm ~/bin/hello-py`)。

```text
$ rm ~/bin/hello-py
$ echo '#!/usr/bin/env python3' > ~/bin/hello-py
$ echo 'print("hello agent, from python")' >> ~/bin/hello-py
$ cat ~/bin/hello-py
#!/usr/bin/env python3
print("hello agent, from python")
$ hello-py
zsh: permission denied: hello-py
$ chmod +x ~/bin/hello-py
$ mkdir -p ~/terminal-practice/day13
$ cd ~/terminal-practice/day13
$ hello-py
hello agent, from python
$ which hello-py
/Users/你/bin/hello-py
```

<div class="line-notes">

- `$ rm ~/bin/hello-py` 先删掉 Day 8 的那个,从空开始默写。
- `$ echo '#!/usr/bin/env python3' > ~/bin/hello-py` 第一行用 `>` 新建,外层单引号(zsh 双引号里的 `!` 会惹事,Day 7)。`/usr/bin/env python3` 的意思是「去 PATH 里找 `python3`」。
- `$ echo 'print("hello agent, from python")' >> ~/bin/hello-py` 第二行用 `>>` 追加。默写时最容易写成 `>`,那样第一行就没了。
- `zsh: permission denied: hello-py` 我故意先跑一次。找到了文件(说明 `~/bin` 在 PATH 里),但没有执行权限。
- `$ chmod +x ~/bin/hello-py` 加上 x。
- `$ cd ~/terminal-practice/day13` 换到一个和 `~/bin` 无关的目录,证明「在哪都能敲」。
- `hello agent, from python` 系统读 shebang,找到 `python3`,用它执行第二行。
- `/Users/你/bin/hello-py` `which` 确认找到的就是我们刚写的这个。

</div>

三个零件缺一不可:shebang(用谁执行)、可执行权限(准不准执行)、所在目录在 PATH 里(找不找得到)。默写时如果哪一步报错,对照下面错题表里 `command not found`、`permission denied`、`env: ... No such file or directory` 三行,一个零件对应一种报错。

## 默写二:从空目录重建一个 uv 项目

Day 10 说过,`~/agent-zero-lab` 弄乱了可以照清单从头建。今天在 `~/terminal-practice/day13/lab-drill` 里默写一遍(不要动正式仓库),再按 Day 11 的方法验证它能原样重建。

```text
$ cd ~/terminal-practice/day13
$ uv init --no-package lab-drill --python 3.12
Initialized project `lab-drill` at `/Users/你/terminal-practice/day13/lab-drill`
$ cd lab-drill
$ uv add rich
Using CPython 3.12.13
Creating virtual environment at: .venv
Resolved 5 packages in 15.94s
Installed 4 packages in 61ms
 + markdown-it-py==4.2.0
 + mdurl==0.1.2
 + pygments==2.21.0
 + rich==15.0.0
$ uv add --dev ruff
Resolved 6 packages in 780ms
Installed 1 package in 13ms
 + ruff==0.17.1
$ uv tree
Resolved 6 packages in 9ms
lab-drill v0.1.0
├── rich v15.0.0
│   ├── markdown-it-py v4.2.0
│   │   └── mdurl v0.1.2
│   └── pygments v2.21.0
└── ruff v0.17.1 (group: dev)
$ rm -rf .venv
$ uv sync --locked
Using CPython 3.12.13
Creating virtual environment at: .venv
Resolved 6 packages in 9ms
Installed 5 packages in 30ms
 + markdown-it-py==4.2.0
 + mdurl==0.1.2
 + pygments==2.21.0
 + rich==15.0.0
 + ruff==0.17.1
$ uv run main.py
Hello from lab-drill!
$ uv lock --check
Resolved 6 packages in 10ms
```

<div class="line-notes">

- `$ uv init --no-package lab-drill --python 3.12` 默写的第一个检查点:`--no-package`。不加的话,uv 0.12 起会建出带 `src/` 的打包项目(Day 10 的坑)。
- `$ uv add rich` 第一次 `uv add` 时 uv 顺手建了 `.venv`。
- `Using CPython 3.12.13` 我这里是 3.12.13,你那边是 Day 10 用 `uv python install` 装的那个 3.12 小版本。
- `Resolved 5 packages in 15.94s` 这次慢,是因为我演示用的 uv 缓存是空的,要联网查 PyPI。你那边 Day 10 下载过,通常几百毫秒。
- `$ uv add --dev ruff` 开发工具进 `dev` 组。
- `└── ruff v0.17.1 (group: dev)` `uv tree` 里能看到它属于 dev 组。
- `$ rm -rf .venv` Day 11 的实验:删掉环境。删 `.venv` 不心疼,里面没有一行你写的东西。
- `$ uv sync --locked` 按 `uv.lock` 原样装回来,而且要求 lock 和 `pyproject.toml` 对得上。
- `Installed 5 packages in 30ms` 第二次走缓存,30 毫秒。
- `Hello from lab-drill!` `uv init` 生成的 `main.py` 能跑,说明环境是好的。
- `$ uv lock --check` 只检查不改。没有 `error`,退出码 0,lock 是最新的。

</div>

默写这一段时你要能说出每条命令改了哪几样东西:`uv add` 改 `pyproject.toml`、`uv.lock` 和 `.venv` 三样;`uv sync` 只动 `.venv`;`uv lock` 只动 `uv.lock`。说不出来的话,回去看 Day 11 那张「pyproject.toml → uv.lock → .venv」的图。

## 默写三:报价单

Day 12 的收尾。在 `~/agent-zero-lab` 里新建 `part01/price_calc_drill.py`,合上文章写出来,跑出和 `price_calc.py` 一样的结果。写不出时只看这一张提示:5 个席位,月付 49 元、年付 468 元,税率 13%,全部换成分。

```python
# agent-zero-lab/part01/price_calc.py
TAX_PERCENT = 13

seats = 5
monthly_fen = 4900
yearly_fen = 46800

pay_monthly_fen = monthly_fen * 12 * seats
pay_yearly_fen = yearly_fen * seats
saved_fen = pay_monthly_fen - pay_yearly_fen
saved_percent = saved_fen / pay_monthly_fen * 100

tax_fen = pay_yearly_fen * TAX_PERCENT // 100
total_fen = pay_yearly_fen + tax_fen

print("席位数:", seats)
print("月付一年:", pay_monthly_fen / 100, "元")
print("年付:", pay_yearly_fen / 100, "元")
print("年付省下:", saved_fen / 100, "元,约", round(saved_percent, 1), "%")
print("税额:", tax_fen / 100, "元")
print("含税合计:", total_fen // 100, "元", total_fen % 100, "分")
```

<div class="line-notes">

- `TAX_PERCENT = 13` 整数百分比,不是 0.13。默写时写成 0.13 就是没记住 Day 12 最重要的那条。
- `monthly_fen = 4900` 带单位的名字,49 元 = 4900 分。
- `saved_percent = saved_fen / pay_monthly_fen * 100` 百分比不是钱,用 `/` 出 float 没关系。
- `tax_fen = pay_yearly_fen * TAX_PERCENT // 100` 先乘后整除,中间一直是 int。
- `print("含税合计:", total_fen // 100, "元", total_fen % 100, "分")` `//` 拆元、`%` 拆分。

</div>

```text
$ cd ~/agent-zero-lab
$ uv run python part01/price_calc.py
席位数: 5
月付一年: 2940.0 元
年付: 2340.0 元
年付省下: 600.0 元,约 20.4 %
税额: 304.2 元
含税合计: 2644 元 20 分
```

<div class="line-notes">

- `$ uv run python part01/price_calc.py` 你默写的那份文件名换成 `part01/price_calc_drill.py`,输出应该一字不差。
- `含税合计: 2644 元 20 分` 这一行对了,说明税和合计都对了。

</div>

对完答案,默写的那份可以删掉(`rm part01/price_calc_drill.py`),正式的 `price_calc.py` 留着。

## 小项目:客服速算卡 cl-calc

假设你是云簿 CloudLedger 的客服组长,每周五要回答三个数:T001 那位被重复扣款的客户该退多少;T003 那个 5 人团队改年付的含税报价;这周客服用的 AI 助手花了多少模型费。你想做一个命令 `cl-calc`,在任何目录敲一下就打印这三个数。

要求:

1. 放在 `~/bin/cl-calc`,在任何目录直接敲 `cl-calc` 能跑(Day 7、Day 8)。
2. 金额全部用整数分算,税和模型费都四舍五入到分(Day 12 和它的练习 3)。
3. 过 Ruff 检查和格式化,basedpyright 零红线(Day 9、Day 10)。

模型费的算法是 Day 2 那个式子:token 数 × 每百万 token 单价 ÷ 1,000,000。单价我假设输入每百万 token 2 元、输出每百万 token 8 元(只是为了练算术的假设数字,真实价格到第二部分调 API 时当场查),这周输入 1,234,567 个 token、输出 345,678 个 token。

### 第一步:写出来,先撞一个错

在 Zed 里新建 `~/bin/cl-calc`(没有扩展名,Zed 不知道它是 Python,右下角语言选成 Python 就有高亮和红线了)。我第一次写的时候,shebang 顺手写成了 `python`:

```python
#!/usr/bin/env python
# ~/bin/cl-calc:云簿客服速算卡
TAX_PERCENT = 13
INPUT_FEN_PER_M = 200
OUTPUT_FEN_PER_M = 800

price_fen = 29900
charged_times = 2
refund_fen = price_fen * charged_times - price_fen

seats = 5
monthly_fen = 4900
yearly_fen = 46800
pay_monthly_fen = monthly_fen * 12 * seats
pay_yearly_fen = yearly_fen * seats
saved_fen = pay_monthly_fen - pay_yearly_fen
tax_fen = (pay_yearly_fen * TAX_PERCENT + 50) // 100
total_fen = pay_yearly_fen + tax_fen

input_tokens = 1_234_567
output_tokens = 345_678
input_cost = input_tokens * INPUT_FEN_PER_M
output_cost = output_tokens * OUTPUT_FEN_PER_M
llm_fen = (input_cost + output_cost + 500_000) // 1_000_000

print("== 云簿客服速算卡 ==")
print("T001 应退:", refund_fen // 100, "元", refund_fen % 100, "分")
print("T003", seats, "席位年付:", pay_yearly_fen // 100, "元,比月付省", saved_fen // 100, "元")
print("T003 含税合计:", total_fen // 100, "元", total_fen % 100, "分")
print("本周模型花费:", llm_fen // 100, "元", llm_fen % 100, "分")
```

<div class="line-notes">

- `#!/usr/bin/env python` 错在这里,下面马上看后果。
- `# ~/bin/cl-calc:云簿客服速算卡` 第二行才是路径注释,第一行必须留给 shebang。
- `INPUT_FEN_PER_M = 200` 输入每百万 token 2 元 = 200 分。单价也存成分,名字里写清「每百万」(per M)。
- `OUTPUT_FEN_PER_M = 800` 输出每百万 token 8 元 = 800 分。
- `price_fen = 29900` T001 的 299 元。
- `refund_fen = price_fen * charged_times - price_fen` 扣了两次,应付一次,差额就是要退的:59800 − 29900 = 29900 分。
- `tax_fen = (pay_yearly_fen * TAX_PERCENT + 50) // 100` 和 Day 12 的 `price_calc.py` 不同,这里用了 Day 12 练习 3 的「先加一半再整除」做四舍五入。这次 234000 × 13 = 3042000 能被 100 整除,加不加 50 结果都是 30420;换成别的席位数就不一定了,练习 3 会看到。
- `input_tokens = 1_234_567` 数字下划线,一眼看出是一百二十多万。
- `input_cost = input_tokens * INPUT_FEN_PER_M` 1234567 × 200 = 246913400。注意这还不是「分」,是「分 × 百万」,下面统一除。
- `output_cost = output_tokens * OUTPUT_FEN_PER_M` 345678 × 800 = 276542400。
- `llm_fen = (input_cost + output_cost + 500_000) // 1_000_000` 两项先加起来再除,只舍入一次:246913400 + 276542400 = 523455800,加上除数的一半 500000 是 523955800,整除一百万得 523 分。精确值是 523.4558 分,四舍五入正好 523。<br>为什么先加后除?如果两项各自舍入再相加,每项最多差半分,两项就可能差一分。**舍入只在最后做一次**,这是算钱的又一条规矩。
- `print("T003", seats, "席位年付:", pay_yearly_fen // 100, "元,比月付省", saved_fen // 100, "元")` 这一行太长了,第三步 Ruff 会处理它。

</div>

```text
$ chmod +x ~/bin/cl-calc
$ cd ~/terminal-practice
$ cl-calc
env: python: No such file or directory
$ echo $?
127
```

<div class="line-notes">

- `$ chmod +x ~/bin/cl-calc` 这回记得先加权限。
- `env: python: No such file or directory` 报错的是 `env`,不是 zsh 也不是 Python。`env` 按 shebang 去 PATH 里找一个叫 `python` 的命令,找不到。Day 7 说过 macOS 上没有 `python`(不带 3)这个命令;Day 11 里激活虚拟环境后才有。
- `127` Day 5 学的退出码。127 在 shell 里的约定是「命令找不到」。

</div>

把第一行改成 `#!/usr/bin/env python3`,再跑:

```text
$ head -1 ~/bin/cl-calc
#!/usr/bin/env python3
$ cl-calc
== 云簿客服速算卡 ==
T001 应退: 299 元 0 分
T003 5 席位年付: 2340 元,比月付省 600 元
T003 含税合计: 2644 元 20 分
本周模型花费: 5 元 23 分
$ which cl-calc
/Users/你/bin/cl-calc
```

<div class="line-notes">

- `$ head -1 ~/bin/cl-calc` 确认第一行改对了。
- `T001 应退: 299 元 0 分` 29900 分拆成 299 元 0 分。
- `T003 5 席位年付: 2340 元,比月付省 600 元` 和 Day 12 的报价单一致。
- `T003 含税合计: 2644 元 20 分` 也一致,说明 `+ 50` 在这个数上确实没影响。
- `本周模型花费: 5 元 23 分` 手算验证:1234567 × 2 ÷ 1000000 = 2.469134 元,345678 × 8 ÷ 1000000 = 2.765424 元,合计 5.234558 元,四舍五入到分是 5.23 元。
- `/Users/你/bin/cl-calc` 从 `~/bin` 找到的。

</div>

### 第二步:为什么这里用 python3 而不是 uv run

你可能会问:这周不是说好一律 `uv run` 吗?`cl-calc` 不在任何 uv 项目里,也没用任何第三方库,只用了 Python 自带的东西,所以系统里那个 `python3` 就够了。shebang 走 `env python3`,和 Day 8 的 `hello-py` 一样。

反过来,要是 `cl-calc` 里写了 `from rich import print`,它就跑不起来了:`python3` 是全局的那个,看不见 `~/agent-zero-lab/.venv` 里的 rich,会报 Day 10 的 `ModuleNotFoundError: No module named 'rich'`。让 `~/bin` 里的脚本用上第三方库有正规的办法(uv 支持在脚本开头写依赖),但那要用到还没学的东西,以后遇到再讲。今天记住分界线:**只用 Python 自带的东西,可以直接 `python3`;用了第三方库,就得在项目里 `uv run`**。

### 第三步:过 Ruff 和红线

Ruff 装在 `~/agent-zero-lab` 的 dev 组里,所以在仓库根目录用 `uv run ruff` 检查 `~/bin` 里的文件:

```text
$ cd ~/agent-zero-lab
$ uv run ruff check ~/bin/cl-calc
All checks passed!
$ uv run ruff format --check ~/bin/cl-calc
unformatted: File would be reformatted
  --> /Users/你/bin/cl-calc:28:7
   |
27 | print("T001 应退:", refund_fen // 100, "元", refund_fen % 100, "分")
   - print("T003", seats, "席位年付:", pay_yearly_fen // 100, "元,比月付省", saved_fen // 100, "元")
28 + print(
29 +     "T003",
30 +     seats,
31 +     "席位年付:",
32 +     pay_yearly_fen // 100,
33 +     "元,比月付省",
34 +     saved_fen // 100,
35 +     "元",
36 + )
37 | print("T003 含税合计:", total_fen // 100, "元", total_fen % 100, "分")
   |

1 file would be reformatted
$ uv run ruff format ~/bin/cl-calc
1 file reformatted
$ cl-calc | tail -3
T003 5 席位年付: 2340 元,比月付省 600 元
T003 含税合计: 2644 元 20 分
本周模型花费: 5 元 23 分
```

<div class="line-notes">

- `$ uv run ruff check ~/bin/cl-calc` 文件没有 `.py` 后缀,但你在命令行明确点了它的名字,Ruff 照样检查。
- `All checks passed!` 没有没用的 import、没有可疑写法。
- `$ uv run ruff format --check ~/bin/cl-calc` 只检查格式,不改。
- `unformatted: File would be reformatted` 有一行不合格式。
- `- print("T003", seats, "席位年付:", pay_yearly_fen // 100, "元,比月付省", saved_fen // 100, "元")` 减号开头是「现在的样子」:这一行超过了 Ruff 默认的每行 88 个字符(中文按两个字符宽算)。
- `28 + print(` 加号开头是「格式化以后的样子」:括号里每个参数一行,最后一个后面也加逗号。这和 Prettier 把超长的 JSX 属性拆成多行是一回事。
- `$ uv run ruff format ~/bin/cl-calc` 去掉 `--check`,真的改。
- `1 file reformatted` 改好了。在 Zed 里打开了保存时格式化的话(Day 9),保存时就已经是这样了。
- `$ cl-calc | tail -3` 格式化只改排版不改意思,输出一样。

</div>

basedpyright 那边,Zed 里打开 `~/bin/cl-calc` 没有任何红线。我在命令行用 basedpyright 1.40.2(standard 档,和 Zed 默认一样)检查,结果是 `0 errors, 0 warnings, 0 notes`。

| 本周的零件 | 在小项目里是哪一步 |
| --- | --- |
| PATH、`~/bin`(Day 7) | 在 `~/terminal-practice` 里直接敲 `cl-calc` |
| shebang、`chmod +x`(Day 7、Day 8) | 第一行、加权限 |
| macOS 没有 `python` 命令(Day 7、Day 8) | `env: python: No such file or directory` |
| 退出码(Day 5) | `echo $?` 得 127 |
| Ruff 检查和格式化(Day 9) | `ruff check`、`ruff format --check` |
| `uv run` 用项目里的工具(Day 10) | 在仓库根目录 `uv run ruff` |
| 只用自带的就 `python3`,用第三方库要项目环境(Day 10、Day 11) | 第二步那条分界线 |
| 变量、整数分、`//` 和 `%`(Day 12) | 全部金额计算 |
| 先加一半再整除、舍入只做一次(Day 12 练习 3) | `tax_fen`、`llm_fen` |

## 本周错题与坑清单

把这一周真实见过的报错放在一张表里。左边一列是你会在屏幕上看到的原文,看到它就来这张表里查。Day 6 那张表建议你抄在笔记里,今天把这张接在后面。

| 你看到的 | 病因 | 改法 | 出处 |
| --- | --- | --- | --- |
| `zsh: command not found: hello-agent` | 命令所在目录不在 PATH 里 | `export PATH="$HOME/bin:$PATH"` 写进 `.zshrc` 再 `source` | Day 7 |
| `zsh: permission denied: ...` | 文件没有执行权限 | `chmod +x` | Day 7 |
| `env: node: No such file or directory` / `env: python: ...` | shebang 要找的解释器不在 PATH 里,或名字写错(macOS 没有 `python`) | 修 PATH;shebang 写 `python3` | Day 7、Day 13 |
| `ls` 都 `command not found` | `export PATH=~/bin` 把 PATH 整个覆盖了 | 开新窗口;永远写 `新目录:$PATH` | Day 7 |
| 改了 `.zshrc` / 装了新版本,还是旧的 | 已开的窗口不会重读配置 | `source ~/.zshrc` 或开新窗口;`which -a` 查顺序 | Day 7、Day 8 |
| `SyntaxError: invalid character '“' (U+201C)` | 中文引号 | 切英文标点 | Day 8 |
| `IndentationError: unexpected indent` | 最外层代码前面多了空格 | 删掉空格 | Day 8 |
| `NameError: name 'console' is not defined` | 前端手感写了 `console.log` | 写 `print` | Day 8 |
| `SyntaxError: Missing parentheses in call to 'print'` | 照抄了 Python 2 的老教程 | 加括号,换一篇新教程 | Day 8 |
| `can't open file '.../hello.py'` | 站的目录不对 | `pwd` 看一眼,或写完整路径 | Day 8 |
| 一个文件十几条红线 | 一个语法错带出一串连锁红线 | 从最上面那条修起 | Day 9 |
| `TypeError: unsupported operand type(s) for -: 'str' and 'int'` | 把字符串当数字算 | 去掉引号,或转换类型(Day 14) | Day 9 |
| `NameError: name 'reveal_type' is not defined` | `reveal_type` 只给类型检查器看 | 看完就删 | Day 9 |
| `ZeroDivisionError: division by zero` | 除数是 0,红线看不出来 | 运行前确认除数;以后用 if 或异常处理 | Day 9、Day 12 |
| `error: No pyproject.toml found in current directory or any parent directory` | 不在 uv 项目里 | `cd` 进项目,或先 `uv init --no-package` | Day 10 |
| `ModuleNotFoundError: No module named 'rich'` | 没装;或装了但用的是全局 `python3` | `uv add`;前面加 `uv run` | Day 10 |
| `uv init` 出来一个 `src/` | uv 0.12 起默认打包项目 | `uv init --no-package` | Day 10 |
| `No module named pip` | uv 建的环境默认不带 pip | 用 `uv add` | Day 11 |
| `error: The lockfile at uv.lock needs to be updated, but --locked was provided.` | 手改了 `pyproject.toml`,lock 过期 | `uv lock` | Day 11 |
| `zsh: no such file or directory: 15` | `uv add rich<15` 没加引号,`<` 被当成重定向 | 版本约束加引号 | Day 11 |
| `... incompatible with the project's Python requirement: >=3.12` | `.python-version` 超出 `requires-python` 范围 | 改回 3.12 | Day 11 |
| `NameError: name 'refund_ammount' is not defined. Did you mean: ...` | 变量名拼错 | 照它猜的改 | Day 12 |
| `SyntaxError: invalid syntax`(指着 `count++`) | Python 没有 `++` | `count += 1` | Day 12 |
| `SyntaxError: invalid decimal literal` | 变量名以数字开头 | 换个名字 | Day 12 |
| `0.30000000000000004`、`1998.9999999999998` | 浮点误差 | 比较用 `math.isclose`;钱用整数分;元转分用 `round` | Day 12 |
| `round(8.5)` 得 8 | Python 的 `round` 遇到 .5 取偶数 | 需要「五入」时用整数「先加一半再整除」 | Day 12 |
| `-7 // 2` 得 −4 | `//` 往下取整,不是砍掉小数 | 负数先在交互模式里试 | Day 12 |

一个规律:这张表里 Day 7 到 Day 11 的报错,几乎都发生在「代码还没开始跑」的阶段,是环境和工具的问题;Day 12 的才是代码本身的问题。前者让你卡住,后者让你算错。卡住至少你知道,算错了不报错,更要小心,这是 Day 12 花那么多篇幅讲 0.1 + 0.2 的原因。

## 动手练习

### 练习 1:一个文件里的五个坑

在 `~/agent-zero-lab/part01/` 新建 `week02_bugs.py`,原样敲进去(错是故意的)。先不跑,在 Zed 里看红线,说出每一处错在哪、为什么;再跑一次,看 Python 先报哪一个;最后改到能跑、零红线。改的时候保留原意:第 4 行是想让扣款次数加一。

```python
# agent-zero-lab/part01/week02_bugs.py
price_fen = 29900  // 单价
times = 2
times++
total_fen = price_fen * times
console.log("合计:", total_fen / 100)
print("合计分:", totl_fen)
```

<div class="line-notes">

- `price_fen = 29900  // 单价` 前端手感的注释。
- `times++` 前端手感的自增。
- `console.log("合计:", total_fen / 100)` 前端手感的打印。
- `print("合计分:", totl_fen)` 拼错的名字。

</div>

<details><summary>参考答案</summary>

basedpyright(standard 档)看到的:

```text
part01/week02_bugs.py:2:23 - error: "单价" is not defined (reportUndefinedVariable)
part01/week02_bugs.py:4:1 - warning: Expression value is unused (reportUnusedExpression)
part01/week02_bugs.py:4:8 - error: Expected expression
part01/week02_bugs.py:6:1 - error: "console" is not defined (reportUndefinedVariable)
part01/week02_bugs.py:7:15 - error: "totl_fen" is not defined (reportUndefinedVariable)
4 errors, 1 warning, 0 notes
```

<div class="line-notes">

- `part01/week02_bugs.py:2:23 - error: "单价" is not defined` 最有意思的一条。`//` 在 Python 里是整除,所以这一行被读成「29900 整除一个叫 `单价` 的变量」,Day 12 说过中文变量名是合法的,于是语法没错,只是这个名字没定义。不是语法错,反而更隐蔽。
- `part01/week02_bugs.py:4:8 - error: Expected expression` `times++` 被读成 `times + +` 后面缺了东西。
- `part01/week02_bugs.py:6:1 - error: "console" is not defined` Day 8 的老朋友。
- `part01/week02_bugs.py:7:15 - error: "totl_fen" is not defined` 拼错,少了一个 a。

</div>

跑一下:

```text
$ uv run python part01/week02_bugs.py
  File "/Users/你/agent-zero-lab/part01/week02_bugs.py", line 4
    times++
           ^
SyntaxError: invalid syntax
```

<div class="line-notes">

- `line 4` 红线有四处,Python 只报第 4 行。因为语法错在**运行之前**就被发现,整个文件一行都不跑(Day 8),第 2 行那个 `NameError` 根本轮不到。
- `SyntaxError: invalid syntax` 所以靠「跑一次修一个」要跑四次;看红线一次就能看全。这就是 Day 9 装编辑器插件的意义。

</div>

改好的版本:

```python
# agent-zero-lab/part01/week02_bugs.py
price_fen = 29900  # 单价
times = 2
times += 1
total_fen = price_fen * times
print("合计:", total_fen / 100)
print("合计分:", total_fen)
```

<div class="line-notes">

- `price_fen = 29900  # 单价` 注释用 `#`,代码和 `#` 之间至少两个空格是 PEP 8 的规矩,Ruff 格式化也会这么排。
- `times += 1` 增量赋值,变成 3。
- `print("合计:", total_fen / 100)` `console.log` 换成 `print`。
- `print("合计分:", total_fen)` 名字改对。

</div>

```text
$ uv run python part01/week02_bugs.py
合计: 897.0
合计分: 89700
$ uv run ruff check part01/week02_bugs.py
All checks passed!
```

<div class="line-notes">

- `合计: 897.0` 29900 × 3 = 89700 分,除以 100 是 897.0 元(`/` 出 float)。
- `All checks passed!` basedpyright 那边也是 `0 errors, 0 warnings, 0 notes`。

</div>

</details>

### 练习 2:同一台电脑,两个答案

在 `~/agent-zero-lab` 里依次敲下面五条,先猜每条的结果,再解释为什么前两条一个报错一个不报错、第三和第四条的路径不同、最后一条为什么失败。

```text
python3 -c "import rich"
uv run python -c "import rich; print(rich.__file__)"
python3 -c "import sys; print(sys.prefix)"
uv run python -c "import sys; print(sys.prefix)"
cd ~ && uv add rich
```

<details><summary>参考答案</summary>

```text
$ cd ~/agent-zero-lab
$ python3 -c "import rich"
Traceback (most recent call last):
  File "<string>", line 1, in <module>
ModuleNotFoundError: No module named 'rich'
$ uv run python -c "import rich; print(rich.__file__)"
/Users/你/agent-zero-lab/.venv/lib/python3.12/site-packages/rich/__init__.py
$ python3 -c "import sys; print(sys.prefix)"
/Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none
$ uv run python -c "import sys; print(sys.prefix)"
/Users/你/agent-zero-lab/.venv
$ cd ~ && uv add rich
error: No `pyproject.toml` found in current directory or any parent directory
```

<div class="line-notes">

- `ModuleNotFoundError: No module named 'rich'` 就算站在项目目录里,`python3` 也是 PATH 里那个全局的,它不看 `.venv`。站在哪不重要,用的是哪个解释器才重要。
- `/Users/你/agent-zero-lab/.venv/lib/python3.12/site-packages/rich/__init__.py` `uv run` 用项目的环境,rich 就在它的 `site-packages` 里(Day 11)。
- `/Users/你/.local/share/uv/python/cpython-3.12.13-macos-x86_64-none` 全局 `python3` 的根目录。这是我演示家目录里的;你那边是 `/Library/Frameworks/Python.framework/Versions/3.12`,Day 8 装的。
- `/Users/你/agent-zero-lab/.venv` 项目环境的根目录。两个 `sys.prefix` 不同,就是第一条和第二条结果不同的原因。
- `error: No `pyproject.toml` found in current directory or any parent directory` 家目录不是 uv 项目。uv 和 npm 不一样,不会在随便一个目录里替你装东西(Day 10)。

</div>

</details>

### 练习 3:8 个席位

T003 的团队又加了 3 个人,变成 8 个席位。把 `~/bin/cl-calc` 复制一份到 `~/terminal-practice/day13/cl-calc-8`,在 Zed 里把 `seats = 5` 改成 `seats = 8`,用 `./cl-calc-8` 运行。先手算:年付多少、比月付省多少、税额精确到几位小数、含税合计多少;这次 `+ 50` 有没有起作用?

<details><summary>参考答案</summary>

```text
$ cp ~/bin/cl-calc ~/terminal-practice/day13/cl-calc-8
$ cd ~/terminal-practice/day13
$ grep -n "^seats" cl-calc-8
11:seats = 8
$ ./cl-calc-8
== 云簿客服速算卡 ==
T001 应退: 299 元 0 分
T003 8 席位年付: 3744 元,比月付省 960 元
T003 含税合计: 4230 元 72 分
本周模型花费: 5 元 23 分
```

<div class="line-notes">

- `$ cp ~/bin/cl-calc ~/terminal-practice/day13/cl-calc-8` 复制一份来改,不动正式的(Day 4 的习惯)。`cp` 会保留执行权限,所以副本也能直接运行。
- `$ grep -n "^seats" cl-calc-8` 确认改对了。`^` 是「行首」,只找以 `seats` 开头的行,不会匹配到 `pay_yearly_fen = yearly_fen * seats` 那几行。这个 `^` 本周没讲,`grep` 的模式写法以后会细讲,今天先用。
- `$ ./cl-calc-8` 不在 PATH 里的脚本,用 `./` 指明「当前目录下这个」(Day 7:带 `/` 的命令名不查 PATH)。
- `T003 8 席位年付: 3744 元,比月付省 960 元` 468 × 8 = 3744;49 × 12 × 8 = 4704,差 960。
- `T003 含税合计: 4230 元 72 分` 税额:374400 × 13 = 4867200,除以 100 是 48672 分,正好整除,486.72 元;合计 3744 + 486.72 = 4230.72 元。

</div>

这次 `+ 50` 还是没起作用:年付价是整元(468 元的整数倍),乘 13 再除以 100 总能整除。要让它起作用,价格得带角和分,比如 Day 12 练习 3 的 19.99 元。真实系统里价格是整元还是带分,往往不是你能决定的,所以四舍五入的写法要一开始就写对,不能等出了零头再补。

</details>

### 练习 4:先猜,再跑

在 `~/agent-zero-lab` 里,五条命令每条先写下猜的结果,再跑:

1. `uv run python -c "print(10 // 3, 10 % 3, -10 // 3)"`
2. `uv run python -c "print(round(0.5), round(1.5), round(2.5))"`
3. `uv run python -c "print(1_000 * 3, 2 ** -1, 4 ** 0.5)"`
4. `uv run python -c "print(0.1 * 3 == 0.3, 0.5 * 3 == 1.5)"`
5. `uv run python -c "print(9007199254740993 + 0.0)"`

<details><summary>参考答案</summary>

```text
$ uv run python -c "print(10 // 3, 10 % 3, -10 // 3)"
3 1 -4
$ uv run python -c "print(round(0.5), round(1.5), round(2.5))"
0 2 2
$ uv run python -c "print(1_000 * 3, 2 ** -1, 4 ** 0.5)"
3000 0.5 2.0
$ uv run python -c "print(0.1 * 3 == 0.3, 0.5 * 3 == 1.5)"
False True
$ uv run python -c "print(9007199254740993 + 0.0)"
9007199254740992.0
```

<div class="line-notes">

- `3 1 -4` −10 ÷ 3 = −3.33…,往下取整是 −4,不是 −3。
- `0 2 2` 三个都是「正好一半」,都取最近的偶数:0.5 → 0,1.5 → 2,2.5 → 2。
- `3000 0.5 2.0` 负数次方是倒数,2 的 −1 次方是 0.5;0.5 次方是开平方,4 开方是 2,但指数是 float,结果也是 float。
- `False True` 0.1 存不准,乘 3 误差露出来;0.5 在二进制里是精确的,乘 3 得精确的 1.5。
- `9007199254740992.0` 一个 int 加上 float 0.0,结果变成 float。int 能精确表示 2^53 + 1,float 不能,于是变成了 2^53,少了 1,和 Day 12 里 JS 的结果一样。int 和 float 混着算,精度听 float 的。

</div>

五条全对,这周的数字就过关了。错了的那条,回 Day 12 对应的小节再敲一遍。

</details>

验收标准:三段默写不看文章能写出来并跑通(`hello-py` 在 `day13` 目录能敲,`lab-drill` 里 `uv sync --locked` 和 `uv lock --check` 都不报错,报价单含税合计 2644 元 20 分);`cl-calc` 在任何目录能敲,输出和文中一致,`ruff check`、`ruff format --check` 都通过;错题表里每一句报错,能不看右边几列说出病因。做完把 `~/terminal-practice/day13/lab-drill` 删掉(`rm -rf`,删之前 `pwd` 确认自己站在哪),它只是默写用的。

## 名词解释

今天没有新的技术名词。复习日只列学习方法上的两个词,外加本周最容易混的几组,放在一起对比。

| 名词 | 意思 |
| --- | --- |
| 默写 | 合上文章,凭记忆把核心命令或代码写出来再跑。写不出的地方就是还没真懂的地方 |
| 错题表 | 把真实见过的报错原文、病因、改法、出处整理成表,遇到报错先查表 |
| `python3` 和 `uv run python` | 前者是 PATH 里全局的那个解释器([Day 8](/blog/agent-zero/day-008-python-vs-node/)),后者是项目 `.venv` 里的([Day 10](/blog/agent-zero/day-010-uv-1/)),装的库只有后者看得见 |
| `uv add`、`uv sync`、`uv lock` | `add` 三样一起改;`sync` 只让 `.venv` 跟上 lock;`lock` 只更新 lock([Day 11](/blog/agent-zero/day-011-uv-2/)) |
| 红线和报错 | 红线是编辑器在运行前提醒([Day 9](/blog/agent-zero/day-009-editor-setup/)),报错是真跑时出事;红线不拦着你跑 |
| `/` 和 `//` | `/` 真除法,结果一律 float;`//` 往下取整([Day 12](/blog/agent-zero/day-012-numbers/)) |
| shebang 里的 `python3` 和 `python` | macOS 只有 `python3`;`python` 只在激活的虚拟环境里才有([Day 7](/blog/agent-zero/day-007-terminal-4/)、[Day 11](/blog/agent-zero/day-011-uv-2/)) |
| 舍入只做一次 | 几项金额先用整数加起来,最后统一舍入到分,不要每项各舍一次(今天的小项目) |

## 常见误区

**复习日只看不敲。** 这周大部分内容是命令和配置,看的时候都觉得「对对对」,合上文章写的时候才发现记不清 `--no-package` 放在哪、第二行是 `>` 还是 `>>`、税率写 13 还是 0.13。不敲一遍,你不会知道自己哪里只是眼熟。

**站在项目目录里就以为用的是项目的 Python。** 练习 2 演示了:在 `~/agent-zero-lab` 里敲 `python3`,用的照样是全局的那个。决定用哪个环境的是 `uv run`,不是你站在哪。

**`~/bin` 里的脚本 import 第三方库。** `cl-calc` 能用 `python3` 跑,是因为它只用了自带的东西。一旦加上 `from rich import ...`,就是 `ModuleNotFoundError`。用第三方库的代码放进 uv 项目,用 `uv run` 跑。

**shebang 写 `python`。** macOS 上没有这个命令,报 `env: python: No such file or directory`。写 `python3`。

**格式化报错当成代码错。** `ruff format --check` 说 `would be reformatted`,只是排版不合规矩,代码本身没错,跑起来结果一样。`ruff format` 一下就好,或者打开 Zed 的保存时格式化。

**每一项金额各自四舍五入再相加。** 小项目里输入和输出两项模型费,如果各舍各的,合计可能差一分。先用整数加起来,最后舍一次。

**默写用的目录不删。** `lab-drill` 也是一个完整的 uv 项目,留着容易和正式仓库搞混,在错的目录里 `uv add` 了半天还找不到原因。练习完就删。

## 学习资料

### 文档与文章

- [Python 官方教程](https://docs.python.org/zh-cn/3.12/tutorial/index.html):中文目录页。这周读过第 3.1.1 节(数字)、第 12 章(虚拟环境)、第 15 章(浮点算术)。今天把这三节对照这周的文章再扫一遍,看看有没有当时跳过的段落。
- [uv 文档](https://docs.astral.sh/uv/):英文首页。今天只看左边目录「Concepts → Projects」下的几篇标题,对一下哪些这周用过(init、add、run、sync、lock),哪些还没见过(workspaces、build),心里有个数。
- [计算机教育中缺失的一课 · 课程概览与 shell](https://missing-semester-cn.github.io/2020/course-shell/):中文,Day 6 读过。里面讲 PATH 和 `which` 的那几段,对照 Day 7 再看一次。
- [The Floating-Point Guide](https://floating-point-gui.de/):英文,Day 12 推荐过。复习时看「Basic Answers」那一页里的「Why don't my numbers add up?」,用自己的话给一个前端同事解释一遍 `0.1 + 0.2`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV15JtEz8Eqr&autoplay=0&high_quality=1" title="uv的基础使用：python环境管理" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>a171232886 · uv的基础使用:python环境管理 · 23 分钟,2025 年 8 月。从装 Python 版本讲到建项目、装依赖、虚拟环境,正好把 Day 10、Day 11 串着过一遍。看的时候留意他用的命令和我们的有没有不同(比如有没有加 --no-package),想一想为什么。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Kr421M7gu&autoplay=0&high_quality=1" title="0.1加0.2不等于0.3，计算机算错数不如小学生，小数到底怎么存？" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>炸模型猫君 · 0.1加0.2不等于0.3,计算机算错数不如小学生,小数到底怎么存? · 3 分钟,2024 年 7 月,播放 34 万。用动画讲二进制小数怎么存,比 Day 12 那张图更直观,三分钟复习一遍浮点误差。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/qh98qOND6MI" title="This Tool Replaces pip, Poetry, pyenv, and More (It’s Fast)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · This Tool Replaces pip, Poetry, pyenv, and More (It's Fast) · 英文,可开自动字幕。Arjan 是讲 Python 工程实践很有名的频道,这期讲 uv 替代了哪些老工具、为什么快。复习日看它,是为了知道这周学的 uv 在整个 Python 工具链里站在哪。</figcaption>
</figure>

### 书籍

- Claudio Jolowicz《Hypermodern Python Tooling》,O'Reilly,2024。Day 10、Day 11 推荐过。复习日读第 2 章(Python 环境),和这周的 PATH、`sys.prefix`、虚拟环境对照,书里讲的就是「你用的到底是哪个 Python」这件事。
- Eric Matthes《Python Crash Course》第 3 版(中译《Python编程:从入门到实践》),第 1、2 章:搭环境和变量、数字。Day 12 推荐过第 2 章,今天把第 1 章也翻一下,看看书里怎么教装 Python,和我们这周的做法比一比。

### 开源项目与代码

- [astral-sh/ruff](https://github.com/astral-sh/ruff):这周 `ruff check` 和 `ruff format` 的源码仓库。今天不读代码,看 README 里的「Configuration」一节,知道 88 字符的行宽、规则开关以后在 `pyproject.toml` 的哪里改。
- [DetachHead/basedpyright](https://github.com/DetachHead/basedpyright):Zed 里画红线的那个程序。README 开头一段讲它和微软 pyright 的区别,两分钟读完。

## 自测

1. 你写了 `~/bin/report`,第一行 `#!/usr/bin/env python3`,也 `chmod +x` 了,在别的目录敲 `report` 报 `zsh: command not found: report`。可能是哪里出了问题?怎么查?

<details><summary>答案</summary>

文件找不到,说明 `~/bin` 不在当前窗口的 PATH 里。可能是没把 `export PATH="$HOME/bin:$PATH"` 写进 `.zshrc`,或者写了但这个窗口是写之前开的、没 `source`。查法:`echo $PATH | tr ':' '\n'` 看有没有 `~/bin`;`ls -l ~/bin/report` 确认文件确实在、名字没拼错。如果报的是 `permission denied`,那才是权限问题;报 `env: python3: No such file or directory`,是 shebang 要的解释器找不到。三种报错对应三个零件。

</details>

2. 同事把你的项目拷过去,`uv run python part01/hello_rich.py` 能跑,`python3 part01/hello_rich.py` 报 `ModuleNotFoundError`。他问是不是 rich 没装好,你怎么解释?

<details><summary>答案</summary>

rich 装好了,装在项目的 `.venv` 里。`uv run` 用的是 `.venv` 里的解释器,能看到 `site-packages` 里的 rich;`python3` 是 PATH 里全局的解释器,它的库目录里没有 rich。不是没装好,是用错了 Python。这门课里一律 `uv run`。

</details>

3. `cl-calc` 里为什么把模型费写成 `(input_cost + output_cost + 500_000) // 1_000_000`,而不是各自算成分再相加?

<details><summary>答案</summary>

每一项单独整除时都会舍掉零头,两项各舍一次,合计可能比精确值多或少一分。先把两项的「分 × 百万」整数加起来,最后只做一次「先加一半再整除」,结果就是精确值四舍五入到分。舍入只做一次。

</details>

4. 这周哪几种错误,basedpyright 不跑就能标出来?哪几种只有跑了才知道?各举两个。

<details><summary>答案</summary>

不跑就能标出来的:名字没定义(`console`、`totl_fen`、`refund_ammount`)、语法错(`count++`、多余缩进)、类型用错(`"299" - 299`)。只有跑了才知道的:除以零(`ZeroDivisionError`)、浮点误差(`0.1 + 0.2` 不等于 0.3)、四舍五入规则(`round(2.5)` 是 2)、`ModuleNotFoundError`(编辑器选错 Python 时红线也可能不准)。类型检查器管「这种东西能不能这么用」,不管「这个值对不对」。

</details>

5. 面试题:新同事 clone 了一个 Python 项目,跑不起来。你会让他按什么顺序排查?

<details><summary>答案</summary>

先确认解释器:`uv run python --version`(或 `which -a python3`)看用的是不是项目要求的版本,和 `pyproject.toml` 的 `requires-python`、`.python-version` 对得上。再确认依赖:`uv sync --locked`,如果报 lock 过期,说明提交的人改了依赖没提交新的 lock;装好后 `uv tree` 看版本。再确认运行方式:是不是在项目根目录、是不是用了 `uv run` 而不是全局 `python3`,`sys.prefix` 应该指向项目的 `.venv`。最后才看代码本身的报错:语法错一行都不跑,运行时错看 traceback 最后一行。顺序是从环境到代码,因为大部分「跑不起来」都是环境问题。

</details>

## 明天预告

Day 14 · 布尔、None 和类型转换。这周两次碰到它们:Day 9 的 `299 == None` 类型是 `bool`,Day 12 的 `0.1 + 0.2 == 0.3` 得到 `False`;Day 9 还说 `int("abc")` 会报 `ValueError`,「Day 14 讲」。明天讲 `True` 和 `False`、比较运算、Python 的 `None` 和 JS 的 `null`/`undefined` 有什么不同,再学 `int()`、`float()`、`str()` 把用户输入的字符串变成能算的数字。今天的速算卡里数字都是写死的,明天开始让它从输入里读。
