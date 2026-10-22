---
title: 'Day 583 · 平台(一):什么时候该做平台,平台给什么,租户是谁'
description: 'SupportPilot 上线半年,销售和 HR 也要 Agent。今天先回答三个问题:什么信号出现时才值得做平台,平台到底该给业务团队什么、不该替他们管什么,以及「租户」这个词在 Agent 平台里指的是谁。全部用本机小脚本演示:三份复制来的 LLM 客户端里修复漏了哪几份,一张共用 key 的账单怎么按部门拆,从 API key 认出租户,再故意漏写一次 tenant_id,看 B 公司读到 A 公司的 VIP 客户手机号。'
pubDate: 2026-10-23
regime: none
tags: ['platform', 'multi-tenancy', 'python', 'agent-zero']
series: 'agent-zero'
day: 583
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 582](/blog/agent-zero/day-582-router-pipeline/) 我们把分诊路由小模型从一堆实验脚本整理成了 `part10/triage-router/` 里的一条流水线:数据有清单和哈希,每一步一条 `make` 命令,阈值写在配置文件里,最后交出一份数据卡和一份模型卡。那是「一个模型怎么交付」的问题。

今天往上走一层。等 SupportPilot 和它的路由小模型在公司里跑顺了,别的团队一定会来要同样的东西。接下来几天(Day 583–586)讲的是当好几个团队、好几个 Agent 共用一套基础设施时会出什么事,怎么设计。这些零件最后会在 [Day 624](/blog/agent-zero/day-624-agentops-kickoff-1/) 起拼成进阶毕业项目 AgentOps。

## 今天要解决的问题

学完今天你应该能做到:

1. 说出三个「该考虑做平台了」的信号,并且能用脚本把其中两个量化出来(重复代码里的修复漏了几份、共用 key 的账单拆不拆得开);也能说出平台做早了的代价。
2. 列出一个 Agent 平台该给的七块能力,说清楚哪三样东西必须留在业务团队手里。
3. 分清内部租户和外部租户,知道「租户只能从 API key 认,不能从请求体认」和「每张表、每条查询都要带 `tenant_id`」这两条规矩为什么是底线。

预计用时 2 小时。前置:[Day 82](/blog/agent-zero/day-082-auth-1/)(服务端怎么验 API key)、[Day 85](/blog/agent-zero/day-085-sql-1/)(SQLite、`WHERE`)、[Day 88](/blog/agent-zero/day-088-sql-4/)(按组汇总)、[Day 92](/blog/agent-zero/day-092-python-sqlite-1/)(`?` 占位符)、[Day 50](/blog/agent-zero/day-050-dataclass/)(dataclass)、[Day 124](/blog/agent-zero/day-124-cost/)(从 token 算钱)。

今天全部是本机小脚本,不调任何付费接口,花费 0 元。代码放在 `agent-zero-lab/part10/platform/`,后面 Day 584、585 接着往这个目录里加东西。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`dup_scan.py` 的扫描循环、`tenants.py` 的 `resolve`、`leak_demo.py` 的两个查询);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 一个几乎每家公司都会遇到的场景

假设 SupportPilot 上线半年,客服主管很满意。接下来销售团队想要一个帮他们整理线索的 Agent,HR 想要一个初筛简历的。最省事的做法是把 SupportPilot 的仓库复制两份,各改各的。

三个月后你会看到这些事:三个仓库里有三份 LLM 客户端封装,你在客服那份里修过的超时问题([Day 392](/blog/agent-zero/day-392-timeouts/) 讲过每一层都要有超时),销售那份没有;财务问「上个月模型费用一百块,每个部门各花了多少」,没人答得上来,因为三个团队共用一个供应商 key;安全团队发现手机号脱敏只有客服那份代码里有,HR 的 Agent 把候选人手机号原样写进了日志。

这就是平台化要解决的问题。不过先别急着动手写「通用 Agent 平台」,第一个问题是:**现在真的到时候了吗?**

## 什么时候该做平台

**平台**(platform)在这里指的是:由一个专门的团队维护、给公司里多个业务团队共用的一层基础设施和服务,业务团队在它上面搭自己的 Agent,不用每家从头造一遍。前端同学可以类比公司内部的组件库加 BFF 网关:每个业务线不再各写一套按钮和请求封装,都用同一份,修一处全公司受益。

平台不是越早做越好。我见过一个团队在只有一个 Agent 的时候就开始写「通用 Agent 平台」,抽象了半年,定义了 Agent、Skill、Workflow、Plugin 四层概念,结果第二个业务方来的时候,他们的需求套不进任何一层,最后还是自己从头写了。只有一个用户的时候,你分不清哪些代码是「通用的」,哪些只是「这个业务碰巧这么写」。

比较靠谱的判断方式是看三个信号,出现两个就该认真考虑了。

**第三个团队来要同样的东西。** 第一个团队做的时候你不知道哪些是通用的,第二个团队来的时候开始有感觉,第三个团队来的时候,共同部分才算看清楚。软件工程里有个老说法叫「三次法则」(rule of three):同样的东西写到第三次再抽象。

**同一个修复要改好几遍。** 比如 [Day 403](/blog/agent-zero/day-403-injection-1/) 的注入防护、[Day 367](/blog/agent-zero/day-367-tracing-views/) 的脱敏、供应商换了接口版本,只要这类修复要在多个仓库里各改一遍,就说明这些能力本来就该是共享的。安全类修复尤其危险,漏掉一个仓库就是一个洞。

**有人要按部门分账或者统一管控。** 财务要分摊成本、法务要统一审核数据出境、安全要统一审计谁调了什么工具。这类需求本质上要的是「一个控制点」,分散在各个团队里是做不出来的。

反过来,只有一两个 Agent、团队都在一个组里、成本也不大,那就别做平台,把 SupportPilot 里通用的代码(比如 `common/llm.py`)整理成一个内部 Python 包,让别人 `uv add` 进去,收益已经很大了。

公开的案例也大多是这个节奏。InfoQ 2024 年 9 月报道过 Uber 的 GenAI Gateway(二手转述,原文是 Uber 工程博客):做这个统一网关时,公司内部已经有 60 多个不同的大模型用例,网关集中处理鉴权、缓存、观测和发给外部厂商之前的个人信息脱敏,新用例接入前还要过安全团队的数据审查。先有一大堆重复,再有平台。

信号要能量化才好拿去说服老板。下面用两个小脚本把第二、第三个信号变成数字。

### 量化信号二:修复漏了几份

我们没有三个真团队,就造三个假仓库。先说清楚:这三个目录是脚本生成的,里面的代码是假的,不会去扫你电脑上任何真实仓库。新建 `part10/platform/make_fake_repos.py`:

```python
# agent-zero-lab/part10/platform/make_fake_repos.py
"""造三个假的团队仓库:客服、销售、HR 各自复制了一份 LLM 客户端,然后各改各的。
用法:uv run python part10/platform/make_fake_repos.py
"""
from pathlib import Path

ROOT = Path(__file__).parent / "fake_repos"

BASE = '''import os
from openai import OpenAI

client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])


def chat(messages):
    for attempt in range(3):
        try:
            return client.chat.completions.create(model="deepseek-flash", messages=messages{timeout})
        except Exception:
            if attempt == 2:
                raise
'''
REDACT = '''

def redact(text):
    import re
    return re.sub(r"1[3-9]\\d{9}", "[手机号]", text)
'''
REPOS = {
    "support-agent": {"timeout": ", timeout=30", "redact": True},   # 客服:修过超时 bug,加了脱敏
    "sales-agent": {"timeout": "", "redact": False},               # 销售:复制得早,两样都没有
    "hr-agent": {"timeout": ", timeout=30", "redact": False},      # HR:抄了超时修复,没抄脱敏
}

for name, opt in REPOS.items():
    d = ROOT / name
    d.mkdir(parents=True, exist_ok=True)
    code = BASE.format(timeout=opt["timeout"]) + (REDACT if opt["redact"] else "")
    (d / "llm_client.py").write_text(code, encoding="utf-8")
    print(f"写入 fake_repos/{name}/llm_client.py")
```

<div class="line-notes">

- `ROOT = Path(__file__).parent / "fake_repos"` 假仓库就放在脚本旁边的 `part10/platform/fake_repos/` 下。`Path(__file__).parent` 是脚本所在的目录,和 JS 里的 `__dirname` 一个意思。
- `BASE = '''import os` 三个单引号开头的多行字符串,里面是一份「被复制来复制去」的客户端代码。相当于 JS 的模板字符串,只是这里不带变量插值。
- `return client.chat.completions.create(model="deepseek-flash", messages=messages{timeout})` 唯一的占位符 `{timeout}`,后面用 `.format` 填进去:有的仓库填 `, timeout=30`,有的什么也不填,模拟「超时修复有的仓库有、有的没有」。
- `return re.sub(r"1[3-9]\\d{9}", "[手机号]", text)` 脱敏函数,把 11 位手机号换成占位。这里写两个反斜杠,是因为它在一个普通字符串里,写进文件后会变成一个。
- `"support-agent": {"timeout": ", timeout=30", "redact": True},` 三个仓库各自的「状态」:客服两样都修了,销售两样都没有,HR 只抄了一半。真实情况往往就是这么乱。
- `d.mkdir(parents=True, exist_ok=True)` 建目录,`parents=True` 连上层一起建,`exist_ok=True` 已经存在不报错,跑第二遍也没事。
- `code = BASE.format(timeout=opt["timeout"]) + (REDACT if opt["redact"] else "")` 拼出这个仓库的代码。`A if 条件 else B` 是 Python 的三元表达式,相当于 JS 的 `条件 ? A : B`。

</div>

再写一个扫描脚本,对同名文件算哈希、找修复。新建 `part10/platform/dup_scan.py`:

```python
# agent-zero-lab/part10/platform/dup_scan.py
"""把「重复建设」量化:同名文件有几份、内容有几种、某个修复在哪些仓库里有、哪些没有。
用法:uv run python part10/platform/dup_scan.py part10/platform/fake_repos
"""
import hashlib
import sys
from collections import defaultdict
from pathlib import Path

FIXES = {"超时修复": "timeout=", "手机号脱敏": "def redact"}

root = Path(sys.argv[1])
copies: dict[str, list[Path]] = defaultdict(list)
for p in sorted(root.glob("*/*.py")):
    copies[p.name].append(p)

for name, paths in copies.items():
    hashes = {hashlib.sha256(p.read_bytes()).hexdigest()[:8] for p in paths}
    print(f"{name}: {len(paths)} 份,内容 {len(hashes)} 种")
    for fix, marker in FIXES.items():
        has = [p.parent.name for p in paths if marker in p.read_text(encoding="utf-8")]
        miss = [p.parent.name for p in paths if p.parent.name not in has]
        print(f"  {fix}: 有 {has or '无'}  缺 {miss or '无'}")
```

<div class="line-notes">

- `FIXES = {"超时修复": "timeout=", "手机号脱敏": "def redact"}` 每个修复用一小段「有它就说明修了」的特征文字来认。真实项目里你会用提交号、依赖版本或者一个专门的单元测试来认,这里用字符串够说明问题。
- `copies: dict[str, list[Path]] = defaultdict(list)` `defaultdict(list)` 是「取一个不存在的键时自动给一个空列表」的字典,省掉 `if name not in copies: copies[name] = []` 那一步。JS 里你会写 `(map[k] ??= []).push(p)`。
- `for p in sorted(root.glob("*/*.py")):` `glob("*/*.py")` 找「下一层任意目录里的 .py 文件」,也就是每个仓库根目录下的 Python 文件。`sorted` 让输出顺序固定。
- `copies[p.name].append(p)` 按文件名归组。三个仓库都有 `llm_client.py`,于是这一组有 3 个路径。
- `hashes = {hashlib.sha256(p.read_bytes()).hexdigest()[:8] for p in paths}` 每份文件算一个 SHA-256 指纹,取前 8 位就够区分。外面是花括号,这是**集合推导式**,结果自动去重:三份内容完全一样就只剩 1 个,这里实跑是 3 个,说明三份已经各改各的了。
- `has = [p.parent.name for p in paths if marker in p.read_text(encoding="utf-8")]` 文件内容里包含特征文字的,记下它所在目录的名字(`p.parent.name` 是 `support-agent` 这种)。
- `print(f"  {fix}: 有 {has or '无'}  缺 {miss or '无'}")` `has or '无'`:列表为空时是假值,就打印「无」。和 JS 的 `has.length ? has : '无'` 效果一样。

</div>

```bash
cd agent-zero-lab
mkdir -p part10/platform
uv run python part10/platform/make_fake_repos.py
uv run python part10/platform/dup_scan.py part10/platform/fake_repos
```

实跑输出:

```text
写入 fake_repos/support-agent/llm_client.py
写入 fake_repos/sales-agent/llm_client.py
写入 fake_repos/hr-agent/llm_client.py
llm_client.py: 3 份,内容 3 种
  超时修复: 有 ['hr-agent', 'support-agent']  缺 ['sales-agent']
  手机号脱敏: 有 ['support-agent']  缺 ['hr-agent', 'sales-agent']
```

三份 `llm_client.py`,内容三种,一模一样的复制已经不存在了。超时修复漏了销售一家,脱敏漏了两家。这两行就是你去跟老板说「该把模型调用收到一处了」时能拿出来的证据,比「我觉得代码有点乱」有用得多。更真实的版本里你还会加上「漏了多久」:客服 3 月修的超时,销售 6 月出事故才补上,中间三个月就是风险敞口。

### 量化信号三:共用 key 的账拆不开

第三个信号是分账。下面这个脚本造一个月的调用记录:三个团队共用一个 DeepSeek key,客服调得多但用便宜的 flash,销售调得少但用贵的 v4-pro。价格用的是 [Day 578](/blog/agent-zero/day-578-distill-2/) `big_run.py` 里那张价格表(元/百万 token)。

新建 `part10/platform/bill_split.py`:

```python
# agent-zero-lab/part10/platform/bill_split.py
"""同一个供应商 key 一个月的调用记录:没有租户字段时,财务问「每个部门花了多少」只能猜;
有了租户字段,一行 group by 就答出来。
用法:uv run python part10/platform/bill_split.py
"""
import random
from collections import Counter, defaultdict

PRICE = {"deepseek-flash": (2, 8), "deepseek-v4-pro": (9, 27)}   # 元/百万 token:输入、输出
TEAMS = {"support": ("deepseek-flash", 9000), "sales": ("deepseek-v4-pro", 1500), "hr": ("deepseek-flash", 600)}
random.seed(583)

log = []
for team, (model, calls) in TEAMS.items():
    for _ in range(calls):
        log.append({"tenant": team, "model": model,
                    "in": random.randint(800, 3000), "out": random.randint(100, 600)})
random.shuffle(log)


def cost(row: dict) -> float:
    p_in, p_out = PRICE[row["model"]]
    return (row["in"] * p_in + row["out"] * p_out) / 1e6


total = sum(cost(r) for r in log)
print(f"这个月共 {len(log)} 次调用,账单 ¥{total:.2f}")

calls = Counter(r["tenant"] for r in log)
print("没有租户字段,只能按各团队自报的调用次数平摊:")
for t, n in calls.most_common():
    print(f"  {t:<8} ¥{total * n / len(log):>7.2f}  {n / len(log):.0%}")

by: dict[str, float] = defaultdict(float)
for r in log:
    by[r["tenant"]] += cost(r)
print("每条调用都带租户,按真实花费汇总:")
for t, v in sorted(by.items(), key=lambda kv: -kv[1]):
    print(f"  {t:<8} ¥{v:>7.2f}  {v / total:.0%}")
```

<div class="line-notes">

- `PRICE = {"deepseek-flash": (2, 8), "deepseek-v4-pro": (9, 27)}` 每百万输入、输出 token 多少元,未命中缓存的价格,和 Day 578 的 `big_run.py` 一致。真实账单还要算缓存命中,这里省掉。
- `TEAMS = {"support": ("deepseek-flash", 9000),` 每个团队用哪个模型、一个月调多少次。客服 9000 次占八成,销售 1500 次但用贵模型。数字是编的,用来演示,不代表任何真实公司。
- `random.seed(583)` 固定随机种子,你跑出来的数和文章一样。
- `log.append({"tenant": team, "model": model,` 每条记录都带了 `tenant`。下面「没有租户字段」那一段故意不用它,只用各团队自报的调用次数,模拟「供应商账单上只有一个总数」的处境。
- `random.shuffle(log)` 打乱顺序,真实日志里三个团队的调用是交错的。
- `return (row["in"] * p_in + row["out"] * p_out) / 1e6` [Day 124](/blog/agent-zero/day-124-cost/) 的算钱公式:token 数乘单价,再除以一百万。`1e6` 是一百万的科学计数法写法。
- `calls = Counter(r["tenant"] for r in log)` `Counter` 数每个值出现几次,得到 `{"support": 9000, ...}`。
- `print(f"  {t:<8} ¥{total * n / len(log):>7.2f}  {n / len(log):.0%}")` 按调用次数的比例平摊总账单。`:<8` 左对齐占 8 格,`:>7.2f` 右对齐两位小数,`:.0%` 把 0.81 显示成 81%。
- `by[r["tenant"]] += cost(r)` 带租户字段时,每条调用的真实花费记到它自己团队头上。这一行就是 SQL 里的 `SELECT tenant, SUM(cost) ... GROUP BY tenant`([Day 88](/blog/agent-zero/day-088-sql-4/))。
- `for t, v in sorted(by.items(), key=lambda kv: -kv[1]):` 按花费从大到小排。`-kv[1]` 取负数就是倒序。

</div>

```bash
uv run python part10/platform/bill_split.py
```

```text
这个月共 11100 次调用,账单 ¥103.38
没有租户字段,只能按各团队自报的调用次数平摊:
  support  ¥  83.82  81%
  sales    ¥  13.97  14%
  hr       ¥   5.59  5%
每条调用都带租户,按真实花费汇总:
  support  ¥  59.53  58%
  sales    ¥  39.95  39%
  hr       ¥   3.91  4%
```

按次数平摊,销售只该付 14 块,实际花了 40 块,客服替销售背了二十多块。金额小看不出事,乘以一千倍就是每个月两万多的糊涂账,而且最容易出现的结果是:用贵模型的团队永远觉得模型便宜,没有动力去做 [Day 578](/blog/agent-zero/day-578-distill-2/) 那种路由降本。

拆得开的前提只有一个:**每一条调用都带上「这是谁的」**。这个「谁」就是今天第二个概念,租户。先把平台给什么说完。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CM411f7fs&autoplay=0&high_quality=1" title="什么是平台工程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里云云效 · 什么是平台工程 · 2 分半。从 DevOps 讲到平台工程,一句话理解「平台团队给业务团队提供自助服务」,看完再读下一节的表。</figcaption>
</figure>

## 平台到底给什么

一个常见的误解是「平台就是一个能拖拽搭 Agent 的界面」。界面是可选的,平台真正的价值在于把那些**每个 Agent 都需要、而且做错了代价很大**的东西集中做好。我把它分成七块,右边一列是必须留给业务团队的:

| 能力 | 平台负责 | 业务团队负责 |
| --- | --- | --- |
| 模型访问 | 统一网关、每个团队一个虚拟 key、限流、预算、故障切换、成本归因(Day 586、588) | 选哪类模型、每次调用的参数 |
| 工具 | 工具注册、鉴权、权限审计、MCP 网关 | 自己业务的工具实现 |
| 运行时 | Agent 循环、持久化执行、人工审批、超时与重试(Day 535–541 讲过) | 工作流逻辑、**提示词** |
| 知识与记忆 | 向量库、切块与检索服务、记忆存储,按租户隔离 | 往知识库里放什么文档 |
| 评测 | 评测框架、judge 服务、回归门禁、线上 A/B(Day 562) | **自己的测试集**和判分标准 |
| 可观测 | trace 管道、采样、指标、看板、告警 | 看自己的看板,定自己的 SLO |
| 治理 | 数据分级、留存、审计、合规检查 | 遵守规则,申报新的数据类型 |

注意右边那一列。**提示词、业务工具、测试集**这三样必须留在业务团队手里,因为只有他们懂业务。平台团队如果连提示词都要管,很快就会变成所有 Agent 改动的瓶颈,业务方改一句话要排两周的期,然后他们就会绕开平台自己干,你回到了起点。

回头看上一节的两个脚本:超时和脱敏属于「模型访问」和「治理」,分账属于「模型访问」里的成本归因。所以大多数公司的第一块平台是**模型网关**:接入成本低(业务方改一下 `LLM_BASE_URL` 就接上了),好处立刻看得见(按团队出账单)。Day 586 开始专门讲它。

Team Topologies 这本书里有个说法叫「最薄可用平台」(thinnest viable platform):平台应该是能让业务团队加速的最小那一层,有时候甚至只是一份文档加几个共享库。Evan Bottcher 那篇常被引用的文章《What I talk about when I talk about platforms》也是这个意思:平台是一组**自助服务**的 API、工具和知识,目标是让业务团队**少**依赖平台团队,而不是更多。用前端的话说,好的组件库是你自己 `npm install` 就能用、看文档就会用的,不是每用一个按钮都要给组件库团队提需求。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="平台和业务团队的分工:业务团队在上层写提示词、业务工具和测试集,平台在下层提供七块共享能力">
<rect x="20" y="20" width="190" height="80" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="115" y="44" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">客服 SupportPilot</text>
<text x="115" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">提示词 · 退款工具</text>
<text x="115" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">工单测试集</text>
<rect x="225" y="20" width="190" height="80" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="44" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">销售线索 Agent</text>
<text x="320" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">提示词 · CRM 工具</text>
<text x="320" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">线索测试集</text>
<rect x="430" y="20" width="190" height="80" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="525" y="44" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">HR 简历初筛</text>
<text x="525" y="66" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">提示词 · 简历解析</text>
<text x="525" y="84" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">简历测试集</text>
<g stroke="var(--rule)" stroke-width="1.5">
<line x1="115" y1="100" x2="115" y2="130"/><line x1="320" y1="100" x2="320" y2="130"/><line x1="525" y1="100" x2="525" y2="130"/>
</g>
<rect x="20" y="130" width="600" height="110" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="152" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">平台:每个 Agent 都需要、做错代价大的东西</text>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<text x="40" y="180">模型网关</text><text x="150" y="180">工具中心</text><text x="260" y="180">运行时</text><text x="360" y="180">知识与记忆</text>
<text x="40" y="208">评测</text><text x="150" y="208">可观测</text><text x="260" y="208">治理</text>
</g>
<text x="320" y="232" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">每个请求都带着「这是哪个租户的」穿过这一层</text>
<text x="320" y="262" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">上面三块归业务团队,下面一层归平台团队</text>
</svg>
<figcaption>平台是业务团队脚下的那一层。上面的提示词、业务工具、测试集不归平台管;下面七块集中做,修一次所有 Agent 都受益。</figcaption>
</figure>

## 多租户:先想清楚租户是谁

**租户**(tenant)是平台上的一个隔离单位:它的数据、配额、账单都和别的租户分开算。一套系统同时服务多个租户,叫**多租户**(multi-tenancy)。前端同学最熟悉的例子是 Vercel 或 Notion 的 workspace:同一套服务,你看不到别人 workspace 里的项目,账单也是按 workspace 出的。

「租户」这个词在 Agent 平台里有两种完全不同的含义,很多设计混乱就是因为没分清。

**内部租户**:平台服务公司内部的多个业务团队,客服是一个租户,销售是一个租户。租户之间一般不会恶意攻击彼此,主要矛盾是成本分摊、配额争抢和数据权限,比如 HR 的简历数据不该被销售的 Agent 检索到。

**外部租户**:你把 SupportPilot 做成 SaaS 卖给其他公司,每个客户公司是一个租户。这时候隔离就是安全底线了:A 公司知识库里的内容出现在 B 公司的回复里,是能上新闻的事故。

很多真实系统是两层叠在一起的:组织(org,外部客户公司)下面有项目(project,这家公司里的某个团队或某个 Agent),项目下面才是最终用户。开源的 Dify 就是这样:它的 `api/models/account.py` 里有 `Tenant`(工作空间)和 `TenantAccountJoin`(哪个账号属于哪个工作空间),几乎每张业务表都挂着 `tenant_id`。

### 从 API key 认出租户

一个请求进到平台,第一件事是认出它属于哪个租户。认的依据只能是**服务端能验证的东西**,最常见的就是 API key([Day 82](/blog/agent-zero/day-082-auth-1/) 讲过服务端怎么验 key)。新建 `part10/platform/tenants.py`:

```python
# agent-zero-lab/part10/platform/tenants.py
"""租户是谁:外部客户公司(org)下面有项目(project),每个请求进来先从 API key 认出它属于哪个租户。
用法:uv run python part10/platform/tenants.py
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Tenant:
    org: str        # 外部租户:买我们服务的公司
    project: str    # 内部一层:这家公司里的哪个团队、哪个 Agent


KEYS = {            # API key → 租户。真实系统里这张表在数据库,key 只存哈希
    "sk-yunbu-support": Tenant("yunbu", "support"),
    "sk-yunbu-sales": Tenant("yunbu", "sales"),
    "sk-maple-support": Tenant("maple", "support"),
}


class UnknownKey(Exception):
    pass


def resolve(api_key: str) -> Tenant:
    try:
        return KEYS[api_key]
    except KeyError:
        raise UnknownKey("不认识的 API key") from None


if __name__ == "__main__":
    for key in ["sk-yunbu-support", "sk-maple-support", "sk-yunbu-sales", "sk-guess"]:
        try:
            t = resolve(key)
            print(f"{key:<18} → org={t.org:<6} project={t.project}")
        except UnknownKey as e:
            print(f"{key:<18} → 拒绝:{e}")
```

<div class="line-notes">

- `@dataclass(frozen=True)` [Day 50](/blog/agent-zero/day-050-dataclass/) 的 dataclass,`frozen=True` 让它创建后不能改。租户身份一旦认出来就不该在请求处理途中被谁改掉,冻住是一种保险;冻住的对象还能当字典的键用。
- `org: str        # 外部租户:买我们服务的公司` 两层结构的上层。`yunbu` 是我们一直在用的虚构公司「云簿」,`maple` 是另一家虚构客户。
- `project: str    # 内部一层:这家公司里的哪个团队、哪个 Agent` 下层。同一家公司的客服和销售是两个 project,账单可以分开出,数据权限也可以分开。
- `KEYS = {            # API key → 租户。真实系统里这张表在数据库,key 只存哈希` 一个 key 对应一个 (org, project)。真实系统里 key 不明文存,存哈希,验的时候对传进来的 key 算一次哈希再查,和网站存密码一个道理。今天为了看得清楚写成明文字典。
- `class UnknownKey(Exception):` 自定义异常,只用来表达「这个 key 不认识」。调用方可以单独 `except UnknownKey`,和别的错误分开处理,在 HTTP 层就翻译成 401。
- `return KEYS[api_key]` 认得就返回对应的租户。
- `raise UnknownKey("不认识的 API key") from None` 把字典的 `KeyError` 换成我们自己的异常。`from None` 让报错信息里不再附带原来那个 `KeyError`,也就不会在日志里把传进来的 key 原样打印出来。
- `for key in ["sk-yunbu-support", "sk-maple-support", "sk-yunbu-sales", "sk-guess"]:` 三个合法 key 加一个瞎猜的。

</div>

```bash
uv run python part10/platform/tenants.py
```

```text
sk-yunbu-support   → org=yunbu  project=support
sk-maple-support   → org=maple  project=support
sk-yunbu-sales     → org=yunbu  project=sales
sk-guess           → 拒绝:不认识的 API key
```

这段代码简单到不像一节课的内容,但它背后有一条规矩值得单独说:**租户只能从 key 认,不能从请求体认**。如果你的接口允许请求体里写 `"org": "yunbu"`,并且信了它,那任何拿到合法 key 的人都能冒充别家公司。练习 3 会把这个错误写出来跑一遍。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="一个请求如何被认出租户:API key 查表得到 org 和 project,之后每一层都带着这两个值">
<rect x="20" y="85" width="130" height="56" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="85" y="108" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">请求</text>
<text x="85" y="128" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">X-API-Key: sk-maple-…</text>
<line x1="150" y1="113" x2="200" y2="113" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="200" y="85" width="140" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="270" y="108" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">resolve(key)</text>
<text x="270" y="128" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">查表,不信请求体</text>
<line x1="340" y1="113" x2="390" y2="113" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="390" y="85" width="120" height="56" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="450" y="108" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">Tenant</text>
<text x="450" y="128" font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)" text-anchor="middle">maple / support</text>
<g stroke="var(--rule)" stroke-width="1.5">
<line x1="510" y1="113" x2="540" y2="40"/><line x1="510" y1="113" x2="540" y2="95"/><line x1="510" y1="113" x2="540" y2="150"/><line x1="510" y1="113" x2="540" y2="205"/>
</g>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<rect x="540" y="25" width="90" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="585" y="44" text-anchor="middle">检索</text>
<rect x="540" y="80" width="90" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="585" y="99" text-anchor="middle">模型调用</text>
<rect x="540" y="135" width="90" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="585" y="154" text-anchor="middle">trace</text>
<rect x="540" y="190" width="90" height="28" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="585" y="209" text-anchor="middle">账单</text>
</g>
<text x="270" y="190" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">认出一次,往下每一层都带着它</text>
</svg>
<figcaption>租户在入口处从 API key 认出来,之后检索、模型调用、trace、账单每一层都要带着同一个租户。哪一层忘了带,哪一层就是漏洞。</figcaption>
</figure>

### 每张表、每条查询都带 tenant_id

认出租户以后,它得一路带到底。数据库这一层的规矩是:**所有含租户数据的表都有 `tenant_id` 列,哪怕现在只有一个租户**。后补租户字段的迁移是我做过最痛苦的那类迁移之一,因为你得逐个排查每一条查询有没有漏加条件。

光有这一列还不够,每一条查询都得记得用它。下面故意漏一次。新建 `part10/platform/leak_demo.py`:

```python
# agent-zero-lab/part10/platform/leak_demo.py
"""所有表都带 tenant_id 还不够,每一条查询都得记得带上它。故意漏一次,看 B 公司拿到 A 公司的数据。
用法:uv run python part10/platform/leak_demo.py
"""
import sqlite3

conn = sqlite3.connect(":memory:")
conn.execute("CREATE TABLE kb_chunks (tenant_id TEXT NOT NULL, doc_id TEXT, content TEXT)")
conn.executemany("INSERT INTO kb_chunks VALUES (?, ?, ?)", [
    ("yunbu", "kb-002", "云簿退款政策:年付 30 天内可全额退款。VIP 客户张三 13812345678 已特批延长到 60 天。"),
    ("maple", "kb-002", "Maple 退款政策:一律不退,可转为下期抵扣。"),
])


def search_ok(tenant: str, word: str) -> list[str]:
    sql = "SELECT content FROM kb_chunks WHERE tenant_id = ? AND content LIKE ?"
    return [r[0] for r in conn.execute(sql, (tenant, f"%{word}%"))]


def search_forgot(tenant: str, word: str) -> list[str]:
    sql = "SELECT content FROM kb_chunks WHERE content LIKE ?"          # 漏了 tenant_id
    return [r[0] for r in conn.execute(sql, (f"%{word}%",))]


print("maple 问「退款」,带 tenant_id:")
for c in search_ok("maple", "退款"):
    print("  ", c)
print("maple 问「退款」,漏了 tenant_id:")
for c in search_forgot("maple", "退款"):
    print("  ", c)
```

<div class="line-notes">

- `conn = sqlite3.connect(":memory:")` 连一个只存在内存里的 SQLite 库,脚本跑完就没了,不留文件([Day 92](/blog/agent-zero/day-092-python-sqlite-1/))。
- `conn.execute("CREATE TABLE kb_chunks (tenant_id TEXT NOT NULL, doc_id TEXT, content TEXT)")` 知识库的切块表。`tenant_id` 加了 `NOT NULL`,插入时不给租户直接报错,这是建表时能做的第一道保险。
- `("yunbu", "kb-002", "云簿退款政策` 两家公司碰巧都有一篇 `kb-002`,而且云簿那篇里有一句内部备注,带着客户姓名和手机号。全是编的数据,但真实知识库里混进内部备注是很常见的事。
- `sql = "SELECT content FROM kb_chunks WHERE tenant_id = ? AND content LIKE ?"` 正确写法:租户条件和检索条件一起写。`?` 是参数占位符,值从后面的元组按顺序填进去,防 SQL 注入([Day 92](/blog/agent-zero/day-092-python-sqlite-1/))。
- `return [r[0] for r in conn.execute(sql, (tenant, f"%{word}%"))]` `LIKE '%退款%'` 是「包含退款两个字」。每行结果是一个元组,`r[0]` 取第一列 `content`。
- `sql = "SELECT content FROM kb_chunks WHERE content LIKE ?"          # 漏了 tenant_id` 错误写法。函数签名里明明收了 `tenant` 参数,SQL 里却没用。这种 bug 代码评审很难看出来,因为函数名、参数都对。
- `return [r[0] for r in conn.execute(sql, (f"%{word}%",))]` 只剩一个参数时,元组要写成 `(x,)`,那个逗号不能省,否则括号只是普通括号。

</div>

```bash
uv run python part10/platform/leak_demo.py
```

```text
maple 问「退款」,带 tenant_id:
   Maple 退款政策:一律不退,可转为下期抵扣。
maple 问「退款」,漏了 tenant_id:
   云簿退款政策:年付 30 天内可全额退款。VIP 客户张三 13812345678 已特批延长到 60 天。
   Maple 退款政策:一律不退,可转为下期抵扣。
```

漏写一个条件,Maple 的客服 Agent 就把云簿的 VIP 客户手机号检索了出来。放在 RAG 流程里,这段文字会被塞进提示词,模型很可能在回复里提一句「已有客户获得特批延长到 60 天」,还可能带上名字。更糟的是,这个 bug 在只有一个租户的测试环境里永远测不出来。

靠「每个人写 SQL 时都记得」是靠不住的,查询越写越多总会有人漏。明天 [Day 584](/blog/agent-zero/day-584-platform-2/) 讲两件事:隔离不止数据这一个维度,还有配额、密钥、模型;以及怎么在数据库这一层兜底,让「忘了设租户」的结果变成「一行都查不到」而不是「全都查得到」,那就是 Postgres 的行级安全。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1sNAWeBEr6&autoplay=0&high_quality=1" title="【IT老齐708】多租户应用五种架构模式" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐708】多租户应用五种架构模式 · 11 分钟。用传统 SaaS 的例子讲从独立部署到完全共享的几种做法。今天先看前 5 分钟,建立「租户之间共享多少东西」的直觉,剩下的明天讲隔离模型时再看。</figcaption>
</figure>

### 零件和今天的位置

| 零件 | 在哪学的 | 今天的位置 |
| --- | --- | --- |
| 超时、脱敏 | Day 392、Day 367 | `make_fake_repos.py` 里各仓库修了没修的东西 |
| SHA-256 指纹 | Day 582 的数据清单 | `dup_scan.py` 判断三份文件是不是一样 |
| 从 token 算钱 | Day 124 | `bill_split.py` 的 `cost` |
| 按组汇总 | Day 88 | `bill_split.py` 的 `by[r["tenant"]] += cost(r)` |
| 服务端验 API key | Day 82 | `tenants.py` 的 `resolve` |
| dataclass | Day 50 | `Tenant(frozen=True)` |
| 参数化查询 | Day 92 | `leak_demo.py` 的两个查询 |

## 动手练习

1. **把三个信号写成函数**:写一个 `advise(teams_asking, same_fix_repos, needs_central_control)`,三个信号命中两个及以上返回「认真考虑做平台」,命中一个返回「先整理成内部包」,一个都没有返回「不做平台」。用三种场景各跑一次:只有 SupportPilot;销售也要一个(已经发生过一次修复要改两个仓库);HR 也来了、财务要分账。

<details><summary>参考答案</summary>

新建 `part10/platform/should_platform.py`:

```python
# agent-zero-lab/part10/platform/should_platform.py
"""三个信号出现两个,才认真考虑做平台;一个都没有就先整理成共享包。"""


def advise(teams_asking: int, same_fix_repos: int, needs_central_control: bool) -> str:
    signals = {
        "第三个团队来要同样的东西": teams_asking >= 3,
        "同一个修复要改好几个仓库": same_fix_repos >= 2,
        "有人要统一分账或统一管控": needs_central_control,
    }
    hit = [k for k, v in signals.items() if v]
    if len(hit) >= 2:
        verdict = "认真考虑做平台,先做最痛的一块"
    elif hit:
        verdict = "先把共用代码整理成内部包,盯着另外两个信号"
    else:
        verdict = "不做平台"
    return f"命中 {len(hit)} 个:{hit or '无'} → {verdict}"


if __name__ == "__main__":
    print("只有 SupportPilot:   ", advise(1, 0, False))
    print("销售也要一个:         ", advise(2, 2, False))
    print("HR 也来了,财务要分账:", advise(3, 2, True))
```

<div class="line-notes">

- `"第三个团队来要同样的东西": teams_asking >= 3,` 字典的值直接是比较的结果,`True` 或 `False`。用中文做键,打印出来就是可读的理由。
- `"同一个修复要改好几个仓库": same_fix_repos >= 2,` 同一个修复涉及两个及以上仓库就算命中。`dup_scan.py` 的输出可以直接喂进来:脱敏缺了 2 家。
- `hit = [k for k, v in signals.items() if v]` 留下命中的信号名。
- `elif hit:` 非空列表是真值,等于 `len(hit) == 1`(上面已经排除了 2 个及以上)。
- `return f"命中 {len(hit)} 个:{hit or '无'} → {verdict}"` 返回字符串而不是只返回结论,把「为什么」也带上,拿去跟人讨论时有依据。

</div>

```bash
uv run python part10/platform/should_platform.py
```

```text
只有 SupportPilot:    命中 0 个:无 → 不做平台
销售也要一个:          命中 1 个:['同一个修复要改好几个仓库'] → 先把共用代码整理成内部包,盯着另外两个信号
HR 也来了,财务要分账: 命中 3 个:['第三个团队来要同样的东西', '同一个修复要改好几个仓库', '有人要统一分账或统一管控'] → 认真考虑做平台,先做最痛的一块
```

第二种场景最值得琢磨:修复已经要改两处了,但只有两个团队,这时候最划算的是把 `llm_client.py` 抽成内部包,两边都依赖它,修一处两边生效。它不需要专门的团队,也没有新服务要运维。真正的平台(一个独立部署的网关服务)等第三个信号出现再上。

</details>

2. **给 `dup_scan.py` 加一个修复和一个仓库**:在 `make_fake_repos.py` 里加第四个仓库 `finance-agent`(超时和脱敏都有),再在 `dup_scan.py` 的 `FIXES` 里加一项「重试次数为 3」(特征文字 `range(3)`)。重新生成、重新扫描,观察「内容几种」有没有变,解释为什么。

<details><summary>参考答案</summary>

`make_fake_repos.py` 的 `REPOS` 里加一行:

```python
    "finance-agent": {"timeout": ", timeout=30", "redact": True},
```

`dup_scan.py` 的 `FIXES` 改成:

```python
FIXES = {"超时修复": "timeout=", "手机号脱敏": "def redact", "重试 3 次": "range(3)"}
```

```bash
uv run python part10/platform/make_fake_repos.py
uv run python part10/platform/dup_scan.py part10/platform/fake_repos
```

```text
写入 fake_repos/support-agent/llm_client.py
写入 fake_repos/sales-agent/llm_client.py
写入 fake_repos/hr-agent/llm_client.py
写入 fake_repos/finance-agent/llm_client.py
llm_client.py: 4 份,内容 3 种
  超时修复: 有 ['finance-agent', 'hr-agent', 'support-agent']  缺 ['sales-agent']
  手机号脱敏: 有 ['finance-agent', 'support-agent']  缺 ['hr-agent', 'sales-agent']
  重试 3 次: 有 ['finance-agent', 'hr-agent', 'sales-agent', 'support-agent']  缺 无
```

4 份但内容还是 3 种:`finance-agent` 和 `support-agent` 的配置一样,生成的文件逐字节相同,SHA-256 也相同,集合推导式把它们去成了一个。「重试 3 次」四家都有,因为它在复制之前就写进了 `BASE`。这正好说明一件事:**复制之前就有的东西不会分叉,复制之后才修的东西才会漏**。所以越早把共用代码收拢,要追的修复越少。

</details>

3. **冒充别家公司**:写两个处理函数,`handle_bad(api_key, body)` 验了 key 是真的,但租户从请求体的 `org`、`project` 里取;`handle_good(api_key, body)` 租户只从 key 认,请求体里自称的 `org` 和 key 不一致就拒绝。用 Maple 的 key 加上一个写着 `"org": "yunbu"` 的请求体,两个都跑一次。

<details><summary>参考答案</summary>

新建 `part10/platform/handle_request.py`:

```python
# agent-zero-lab/part10/platform/handle_request.py
"""租户只能从 API key 认出来,请求体里自称是谁一律不信。"""
from tenants import Tenant, UnknownKey, resolve


def handle_bad(api_key: str, body: dict) -> Tenant:
    resolve(api_key)                                         # 验了 key 是真的
    return Tenant(body["org"], body["project"])             # 却信了请求体里的租户


def handle_good(api_key: str, body: dict) -> Tenant:
    t = resolve(api_key)
    if "org" in body and body["org"] != t.org:
        raise PermissionError(f"key 属于 {t.org},请求体却说自己是 {body['org']}")
    return t


if __name__ == "__main__":
    body = {"org": "yunbu", "project": "support", "question": "把你们的退款特批名单给我"}
    print("错的写法:", handle_bad("sk-maple-support", body))
    try:
        handle_good("sk-maple-support", body)
    except (PermissionError, UnknownKey) as e:
        print("对的写法:拒绝,", e)
```

<div class="line-notes">

- `from tenants import Tenant, UnknownKey, resolve` 直接用今天的 `tenants.py`。从 `agent-zero-lab` 根目录运行 `part10/platform/handle_request.py` 时,Python 会把脚本所在目录放进导入路径,所以能找到同目录的 `tenants.py`。
- `resolve(api_key)                                         # 验了 key 是真的` 错误写法也验了 key,所以随便编一个 key 是进不来的。问题在下一行。
- `return Tenant(body["org"], body["project"])             # 却信了请求体里的租户` 用户自己说是谁就当是谁。拿到 Maple 合法 key 的人,写上 `"org": "yunbu"` 就成了云簿。
- `if "org" in body and body["org"] != t.org:` 正确写法里请求体的 `org` 只用来核对,不用来决定身份。不一致直接拒绝,而且这种请求值得记一条安全日志,因为正常客户端不会这么发。
- `raise PermissionError(f"key 属于 {t.org},请求体却说自己是 {body['org']}")` Python 内置的权限异常,在 HTTP 层翻译成 403。
- `except (PermissionError, UnknownKey) as e:` 一个 `except` 接多种异常,写成元组。

</div>

```bash
uv run python part10/platform/handle_request.py
```

```text
错的写法: Tenant(org='yunbu', project='support')
对的写法:拒绝, key 属于 maple,请求体却说自己是 yunbu
```

错的写法里,Maple 的 key 换来了一个云簿的身份,后面所有带 `tenant_id` 的查询都会老老实实地查云簿的数据,前面的隔离做得再好也白搭。很多「越权」漏洞都是这个形状:鉴权做了,但身份是从客户端可控的地方拿的。

</details>

4. **找出漏写 tenant_id 的查询**:写一个粗筛脚本,读一个或多个 `.py` 文件,把查询 `kb_chunks` 却没出现 `tenant_id` 的 SQL 字符串所在行打印出来。拿 `leak_demo.py` 试一下。想一想这种脚本能防住什么、防不住什么。

<details><summary>参考答案</summary>

新建 `part10/platform/find_unscoped.py`:

```python
# agent-zero-lab/part10/platform/find_unscoped.py
"""粗筛:把 .py 文件里查 kb_chunks 却没写 tenant_id 的 SQL 找出来。只是个提醒,不能替代数据库层的兜底。
用法:uv run python part10/platform/find_unscoped.py part10/platform/leak_demo.py
"""
import re
import sys
from pathlib import Path

TABLES = ("kb_chunks",)
for path in sys.argv[1:]:
    for no, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        m = re.search(r'"((?:SELECT|UPDATE|DELETE)[^"]*)"', line)
        if m and any(t in m.group(1) for t in TABLES) and "tenant_id" not in m.group(1):
            print(f"{path}:{no}: {m.group(1)}")
```

<div class="line-notes">

- `TABLES = ("kb_chunks",)` 含租户数据的表名清单。真实项目里这个清单要和建表脚本放在一起维护,新加一张表忘了登记,检查就漏了。
- `for no, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):` `enumerate(..., 1)` 同时给出行号和内容,行号从 1 开始,和编辑器里看到的一致。
- `m = re.search(r'"((?:SELECT|UPDATE|DELETE)[^"]*)"', line)` 找一对双引号里以 SELECT、UPDATE、DELETE 开头的字符串。`(?:...)` 是只分组不捕获,`[^"]*` 是「直到下一个双引号之前的所有字符」。INSERT 不查,因为插入时漏租户会被 `NOT NULL` 拦住。
- `if m and any(t in m.group(1) for t in TABLES) and "tenant_id" not in m.group(1):` 三个条件:找到了 SQL、SQL 里提到了含租户的表、SQL 里没有 `tenant_id`。
- `print(f"{path}:{no}: {m.group(1)}")` 按「文件:行号」的格式打印,在 Zed 或 VS Code 的终端里可以直接点击跳过去。

</div>

```bash
uv run python part10/platform/find_unscoped.py part10/platform/leak_demo.py
```

```text
part10/platform/leak_demo.py:21: SELECT content FROM kb_chunks WHERE content LIKE ?
```

找到了 `search_forgot` 里那一条,`search_ok` 那条没报。它能防住最常见的「整句忘了写」,可以放进 pre-commit 或 CI 当一道提醒。防不住的更多:SQL 跨多行写、用 f-string 拼出来、用 ORM 生成、写了 `tenant_id` 却写成 `tenant_id = tenant_id`(恒成立)、或者 `OR` 把条件绕开了。所以这种文本扫描只能当提醒,真正的兜底要放在数据库这一层,明天讲。

</details>

验收标准:`dup_scan.py`、`bill_split.py`、`tenants.py`、`leak_demo.py` 四个脚本的输出和本文一致(都固定了种子或不含随机数);练习 2 里你能解释为什么 4 份文件只有 3 种内容;练习 3 里你能说出错误写法的问题不在鉴权,在「身份从哪拿」;能不看文章说出平台七块能力里哪三样必须留给业务团队,以及理由。今天花费 0 元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 平台(platform) | 由专门团队维护、给多个业务团队共用的一层基础设施和服务,业务团队在上面搭自己的 Agent |
| 三次法则(rule of three) | 同样的东西写到第三次再抽象成共用的,前两次先复制 |
| 最薄可用平台(thinnest viable platform) | Team Topologies 的说法,平台只做能让业务团队加速的最小那一层,有时只是文档加共享库 |
| 自助服务 | 业务团队看文档就能接入和使用,不需要给平台团队提需求排期 |
| 租户(tenant) | 平台上的一个隔离单位,数据、配额、账单和别的租户分开;内部平台通常是业务团队,外部 SaaS 通常是客户公司 |
| 多租户(multi-tenancy) | 一套系统同时服务多个相互隔离的租户 |
| 内部租户 / 外部租户 | 公司内部的团队 / 购买服务的客户公司;后者的隔离是安全底线 |
| org / project | 常见的两层租户结构:外层是组织(客户公司),里层是项目(团队或某个 Agent) |
| `tenant_id` | 每张含租户数据的表上标明「这行属于谁」的列,每条查询都要按它过滤 |
| 成本归因 | 把总账单按租户、按 Agent 拆开,前提是每条调用都记了租户 |

## 常见误区

**只有一个 Agent 时就开始做「通用平台」。** 这时候你分不清哪些代码是通用的,抽象出来的概念大概率套不进第二个业务。先把共用代码整理成内部包,第三个需求出现、又有统一管控的需求时再抽象。

**把平台理解成拖拽搭 Agent 的界面。** 界面是可选的。平台的价值在下面那层:网关、工具鉴权、隔离、可观测、治理。很多公司的第一版平台只有一个模型网关,没有任何界面。

**平台团队把提示词也收过去管。** 提示词、业务工具、测试集只有业务团队懂。收过去的结果是平台成了瓶颈,业务方绕开平台自己干。平台管「怎么调」,业务管「调什么」。

**租户从请求体或查询参数里取。** 鉴权验了 key,身份却信了客户端写的 `org`,这是越权漏洞的经典形状。租户只能从服务端能验证的凭据(API key、登录态)里认出来。

**现在只有一个租户,`tenant_id` 以后再加。** 后补这一列意味着逐条排查所有查询,而且只有一个租户的环境测不出漏写。建表第一天就加,哪怕值永远是 `default`。

**以为加了 `tenant_id` 列就隔离了。** 列只是前提,漏写一个 `WHERE` 条件照样串数据,今天的 `leak_demo.py` 就是这样。还要有数据库层的兜底(Day 584)。

## 学习资料

### 文档与文章

- [Evan Bottcher · What I talk about when I talk about platforms](https://martinfowler.com/articles/talk-about-platforms.html):平台工程最常被引用的短文,讲清平台是「自助服务的 API、工具和知识」,目标是减少业务团队对平台团队的依赖。15 分钟,英文。
- [InfoQ · Uber 的 GenAI Gateway](https://www.infoq.com/news/2024/09/uber-genai-gateway-llm-openai/):Uber 在 60 多个大模型用例之后做统一网关,网关管了鉴权、缓存、观测、发给外部厂商前的脱敏。15 分钟,英文。原文在 Uber 工程博客,对脚本返回 406,需浏览器打开,搜「Navigating the LLM Landscape: Uber's Innovation with GenAI Gateway」。
- [ByteByteGo · The Evolution of LinkedIn's Generative AI Tech Stack](https://blog.bytebytego.com/p/the-evolution-of-linkedins-generative):LinkedIn 从各团队各搭脚手架,收敛到共享的编排、提示词、工具、记忆几块。30 分钟,英文。
- [Microsoft · Architectural approaches for AI and ML in multitenant solutions](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/ai-ml):微软架构中心讲多租户 AI 系统,包括模型共不共享、租户数据能不能拿去训练。先读开头和「Tenant isolation」部分,30 分钟,有中文机翻版可切换。
- [Microsoft · Architect multitenant solutions on Azure](https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/overview):多租户系列的总目录,「What is a tenant」那一篇把内部租户和外部租户、租户的层级讲得很清楚。20 分钟。
- [Team Topologies · Key Concepts](https://teamtopologies.com/key-concepts):四种团队类型里的 platform team 和「最薄可用平台」,官网一页纸的版本。10 分钟,英文。

### B 站视频

- 阿里云云效 · [什么是平台工程](https://www.bilibili.com/video/BV1CM411f7fs):正文已嵌入,2 分半。
- IT老齐 · [【IT老齐708】多租户应用五种架构模式](https://www.bilibili.com/video/BV1sNAWeBEr6):正文已嵌入,11 分钟,今天看前半,明天看后半。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/n9rjuBuShko" title="Building LinkedIn's GenAI Platform — Xiaofeng Wang" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · Building LinkedIn's GenAI Platform — Xiaofeng Wang · 18 分钟,英文。LinkedIn 讲他们怎么从每个产品团队各搭一套,收敛成几块共享能力。对照今天「平台给什么」那张表看,注意他们哪些东西收了、哪些留给了产品团队。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/05_Mz08LWIY" title="What I talk about when I talk about 'Platforms' - Evan Bottcher" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CTO School Brisbane · What I talk about when I talk about 'Platforms' - Evan Bottcher · 上面那篇文章作者本人的演讲版,英文。读过文章可以只看前 15 分钟,听他讲「平台做成了没人用」的几个例子。</figcaption>
</figure>

### 书籍

- Matthew Skelton、Manuel Pais《Team Topologies》(IT Revolution,2019;简体中文版书名《高效能团队模式》):讲平台团队、「最薄可用平台」和平台团队怎么跟业务团队协作的那几章。想清楚平台团队的边界,比选什么技术更重要。1.5 小时。
- Tod Golding《Building Multi-Tenant SaaS Architectures》(O'Reilly,2024):作者是 AWS 的 SaaS 技术负责人。今天先读第 1、2 章,建立租户、控制面、租户上下文这些概念;明天讲部署模型时读第 3 章。2 小时,英文。

### 开源项目与代码

- [langgenius/dify](https://github.com/langgenius/dify):打开 `api/models/account.py` 看 `Tenant` 和 `TenantAccountJoin` 两个类,再随便打开一个业务表的模型文件,数一数有多少张表挂着 `tenant_id`。看一个真实开源平台怎么在数据模型里处理多租户,1 小时。

## 自测

1. 说出三个「该考虑做平台了」的信号。为什么只有一个 Agent 时不建议做平台?

<details><summary>答案</summary>

信号:第三个团队来要同样的东西;同一个修复(尤其安全类)要在多个仓库里各改一遍;出现按部门分账、统一审计、统一数据出境审核这类要「单一控制点」的需求。只有一个 Agent 时分不清哪些代码是通用的,抽象出来的概念大概率不适合下一个业务;先把共用代码整理成内部包,收益更高、风险更低。

</details>

2. `bill_split.py` 里按调用次数平摊,销售只付 14 元;按真实花费是 40 元。为什么差这么多?这种偏差长期存在会造成什么后果?

<details><summary>答案</summary>

销售调用次数少(14%),但用的是单价贵好几倍的 v4-pro,每次花费远高于客服的 flash 调用。按次数平摊就让客服替销售付了钱。长期后果是用贵模型的团队感觉不到成本,没有动力做路由、换小模型、压缩上下文这类降本;而认真降本的团队反而在替别人买单。

</details>

3. 平台七块能力里,哪三样必须留给业务团队?如果平台团队把提示词也收过去管,会发生什么?

<details><summary>答案</summary>

提示词、业务工具的实现、测试集(和判分标准)。只有业务团队懂业务。收过去的话,业务方每改一句提示词都要找平台团队排期,平台变成瓶颈,业务方会绕开平台自己搭,重复建设又回来了。

</details>

4. 内部租户和外部租户各是什么?两者在隔离上的主要矛盾有什么不同?

<details><summary>答案</summary>

内部租户是公司里的业务团队,外部租户是购买服务的客户公司。内部租户之间一般不恶意攻击,主要矛盾是成本分摊、配额争抢、数据权限(HR 数据不给销售看);外部租户之间的数据隔离是安全底线,串了就是事故,还要考虑合同和合规要求。很多系统两层都有:org 是外部租户,project 是 org 内部的团队。

</details>

5. (面试题)你的系统里每张表都有 `tenant_id`,接口也验了 API key。安全审计还是找出一个越权漏洞:用 A 公司的 key 能读到 B 公司的数据。可能是哪些原因?各怎么查?

<details><summary>答案</summary>

至少两类。第一类,身份来源错了:租户是从请求体、查询参数或者客户端可改的 header 里取的,而不是从 key 查出来的;查法是搜所有读取 `org`、`tenant` 的地方,确认只有鉴权中间件在设置它。第二类,某条查询漏了 `tenant_id` 条件(或者条件写成了恒成立、被 `OR` 绕开);查法是用文本扫描先粗筛,再看慢查询日志或数据库审计里有没有不带租户条件的查询,长期方案是在数据库层加行级安全,让漏写的查询返回空。另外要检查缓存、搜索索引、trace 这些不在主库里的地方,它们也存租户数据,也可能漏了租户维度。

</details>

## 明天预告

Day 584 · 平台(二):隔离四维度,silo/pool/bridge,行级安全。今天的 `leak_demo.py` 说明光靠每条查询自觉写 `tenant_id` 靠不住。明天先把隔离从「数据」扩到配额、密钥、模型四个维度,再讲三种部署模型怎么取舍,最后在 Postgres 里打开行级安全,让「忘了设租户」的查询一行都拿不到。
