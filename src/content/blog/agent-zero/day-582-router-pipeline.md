---
title: 'Day 582 · 给 AgentOps 训练路由小模型:流水线、数据卡、模型卡'
description: '从 Day 570 到 581 攒了三十多个实验脚本。今天把分诊路由这条线整理成能一条命令重跑的流水线:数据文件记清单和哈希,Makefile 管依赖,阈值写进配置文件,test 集用锁保证只用一次,最后由脚本从报告里把数字填进数据卡和模型卡。整理的第一步就查出一个泄漏:Day 570 的训练集里混着 53 张后来用来评测的工单。'
pubDate: 2026-10-23
regime: none
tags: ['pipeline', 'makefile', 'model-card', 'data-card', 'routing', 'agent-zero']
series: 'agent-zero'
day: 582
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 581](/blog/agent-zero/day-581-rl-2/) 讲了怎么给 Agent 设计奖励:结果、格式、过程约束、效率四部分,奖励作弊,以及 TRL 的 `GRPOTrainer` 做了什么。再往前五天是微调、DPO、蒸馏打标、置信度路由、强化学习第一课。

这一整段(Day 570 到 581)你写了三十多个脚本:造数据、清洗、打标、训练、对比、扫阈值、奖励函数。每一个单独看都能跑,可是如果明天换一个同事接手,他问三个问题,你多半答不上来:这个模型是用哪份数据训的?评测数字是在哪份评测集上测的?test 集有没有被偷看过?今天不学新算法,把这堆脚本整理成一条**流水线**,再把答案写进一份**数据卡**和一份**模型卡**。这是资深工程师交付一个模型的样子:交的不是模型文件,是一条能重跑的流水线加一套文档。

## 今天要解决的问题

学完今天你应该能做到:

1. 给一批数据文件记**清单**(路径、行数、sha256),并在重跑前核对;能说清「重跑一遍得到同样的文件」靠的是哪几件事(固定种子、固定顺序、清单核对)。
2. 写一个 `Makefile`,把「造数据 → 查泄漏 → 跑小模型和大模型 → 选阈值 → 只用一次的 test」连成一条依赖链,改了某个文件后只重跑受影响的那几步;把阈值、强制回退的类别写进配置文件,而不是代码里。
3. 用脚本把数据卡和模型卡里的每个数字从 `reports/` 填进去,手改或报告变了卡没跟着改时,`make check` 会报错;能说出模型卡里最容易骗人的地方(把替身的数字写在学生名下)。

预计用时 3 小时。前置:[Day 570](/blog/agent-zero/day-570-finetune-1/)(`build_sft_data.py`、`check_leak.py`、`raw_triage.jsonl`)、[Day 574](/blog/agent-zero/day-574-finetune-3/)(`compare_models.py` 里的 `wilson`)、[Day 577](/blog/agent-zero/day-577-distill-1/)(`teacher_guide_v2.txt`)、[Day 578](/blog/agent-zero/day-578-distill-2/)(`sweep.py`、`big_run.py`、`dpo-cpu/student_run.py`、`route_dev.jsonl`、`small-dev.jsonl` 这些结果文件)、[Day 580](/blog/agent-zero/day-580-week83-review/)(`route_report.py` 里「只在 test 上跑一次」的做法)、[Day 71](/blog/agent-zero/day-071-pytest-1/)(pytest)。

先说清楚哪些是真跑的。**今天全部实跑**,但要分清三类东西。数据和评测:我把 Day 570、574、577、578 的脚本重新跑了一遍(种子固定,`route_dev` 的类别分布和 Day 578 一模一样),CPU 替身(Qwen2.5-0.5B-Instruct)判了 80 张,中位数 7.2 秒一张,两轮合计约 13 分钟;DeepSeek V4 Pro 那一路 80 张花了 ¥0.0943 加 ¥0.0578,合计 ¥0.1521,不到两毛钱。其余脚本都是纯本地计算。**没有实跑的是训练本身**:真正的学生(Qwen3-4B-Instruct-2507 加 LoRA)要 GPU,本机没有,所以整条流水线里「评测的那个小模型」仍然是 Day 578 的未训练替身,模型卡会把这一点写在最前面。今天的花费就是上面的 ¥0.1521。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`manifest.py` 的 `describe` 和 `verify`、`final_test.py` 的锁判断、`render_card.py` 的 `render`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先体检:这堆脚本到底有没有问题

动手整理之前,先问一个最朴素的问题:Day 570 造出来的训练集,和后面 Day 574、577、578 的评测集,有没有重叠?当时每一天都只防了「当天要用的那份评测集」:Day 570 的 `build_sft_data.py` 只拿 `tickets_v1.jsonl` 当黑名单,Day 578 的 `route_dev.jsonl` 和 `route_test.jsonl` 是从同一份 `raw_triage.jsonl` 里抽出来的,抽的时候避开了 `tickets_v1`、`tickets_hard`、`unlabeled`,却没有人回头去看训练集里是不是也有它们。

把所有评测文件拼成一份,拿 Day 570 的 `check_leak.py` 对着当时那份 `out/` 查一遍。先把当时的 `out/` 备份成 `out_v0`:

```bash
cd agent-zero-lab
cp -r part10/out part10/out_v0
cat part10/data/tickets_v1.jsonl part10/data/tickets_hard.jsonl part10/data/route_dev.jsonl \
    part10/data/route_test.jsonl part10/data/unlabeled.jsonl > part10/data/eval_all.jsonl
uv run python part10/check_leak.py part10/out_v0 part10/data/eval_all.jsonl
```

```text
train∩eval: 69
val∩eval: 6
train∩val: 0
train 内部重复: 0
```

训练集里有 69 条和某个评测题是同一张工单(指纹一样),验证集里还有 6 条。再分开看是哪一份评测集:

```bash
uv run python part10/check_leak.py part10/out_v0 part10/data/route_dev.jsonl
uv run python part10/check_leak.py part10/out_v0 part10/data/route_test.jsonl
```

```text
# route_dev
train∩eval: 36
val∩eval: 3
# route_test
train∩eval: 17
val∩eval: 2
```

`route_dev` 的 50 张里有 36 张在训练集里,`route_test` 的 30 张里有 17 张在。要是我们真的用这份训练集去训学生,再拿 `route_test` 测,30 张里有 17 张是它背过的原题,测出来的准确率没有任何意义。这次没有出事,是因为 Day 578 用的是**没训练过的替身**,训练集压根没参与。但这个洞是真的:换上学生的那一天,数字会好看得不真实。

这就是为什么要有流水线。靠人记得「训练集还得避开 route_dev 和 route_test」是靠不住的,要让**代码强制**:数据这一步的黑名单必须是所有评测文件的并集,而且训练集一生成就自动查一遍泄漏,查不过就停。

## 目录长什么样

今天把和路由模型相关的东西收进 `part10/triage-router/` 一个目录。Day 624 开 AgentOps 项目时,整个目录会原样搬进 `agentops/models/triage-router/`。脚本本身仍然放在 `part10/` 里(它们互相导入,Day 570 到 581 都是这么放的),这个目录只放「这个模型自己的」东西:配置、报告、清单、两张卡。

```text
part10/
├── build_sft_data.py  check_leak.py  sweep.py  big_run.py ...      Day 570–581 的脚本,不动
├── manifest.py         今天新写:记清单、核对清单
├── pick_dev.py         今天新写:只看 dev 选阈值
├── route_config.py     今天新写:读 route.yaml、校验、按它回放
├── final_test.py       今天新写:test 只跑一次的锁
├── render_card.py      今天新写:从报告里把数字填进两张卡
├── data/               数据文件,包括 eval_all.jsonl(所有评测题拼在一起)
├── out/                build_sft_data.py 的输出:triage_train.jsonl、triage_val.jsonl
└── triage-router/
    ├── Makefile        依赖链:一条命令跑一步
    ├── MANIFEST.json   每个数据文件的行数和 sha256
    ├── README.md       模型卡(脚本生成)
    ├── DATA_CARD.md    数据卡(脚本生成)
    ├── config/         route.yaml(阈值、强制回退的类别)、train.yaml(学生的训练配置)
    ├── reports/        每一步的输出:dataset、leak、sweep、pick、test、test.lock
    └── templates/      两张卡的模板,手写的文字在这里,数字用 {{键}} 占位
```

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="流水线:数据线(原始数据去掉所有评测题、查泄漏、训练集),模型线(小模型和大模型分别跑 dev 和 test),选阈值只看 dev,test 只在锁下跑一次,最后从报告生成两张卡">
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">
<rect x="10" y="20" width="110" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="65" y="44">raw_triage</text>
<rect x="10" y="80" width="110" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="65" y="97">5 份评测文件</text><text x="65" y="111" font-size="10" fill="var(--ink-soft)">→ eval_all</text>
<rect x="160" y="40" width="120" height="50" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="220" y="60">build_sft_data</text><text x="220" y="76" font-size="10" fill="var(--ink-soft)">黑名单=eval_all</text>
<rect x="320" y="40" width="110" height="50" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="375" y="60">check_leak</text><text x="375" y="76" font-size="10" fill="var(--ink-soft)">非 0 就停</text>
<rect x="470" y="40" width="160" height="50" rx="5" fill="var(--paper-raised)" stroke="var(--rule)" stroke-dasharray="4 3"/><text x="550" y="60">Colab 训练学生</text><text x="550" y="76" font-size="10" fill="var(--ink-soft)">没有 GPU,没实跑</text>
<rect x="10" y="160" width="110" height="40" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="65" y="184">route_dev/test</text>
<rect x="160" y="150" width="120" height="26" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="220" y="167">student_run(替身)</text>
<rect x="160" y="184" width="120" height="26" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="220" y="201">big_run(DeepSeek)</text>
<rect x="320" y="150" width="110" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="375" y="172">sweep + pick</text><text x="375" y="188" font-size="10" fill="var(--ink-soft)">只看 dev</text><text x="375" y="202" font-size="10" fill="var(--ink-soft)">→ 阈值</text>
<rect x="470" y="150" width="160" height="60" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="550" y="172">final_test</text><text x="550" y="188" font-size="10" fill="var(--ink-soft)">route.yaml 阈值有出处</text><text x="550" y="202" font-size="10" fill="var(--ink-soft)">test.lock:只跑一次</text>
<rect x="160" y="250" width="470" height="50" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="395" y="272">render_card:reports/ + MANIFEST.json → README.md、DATA_CARD.md</text><text x="395" y="288" font-size="10" fill="var(--ink-soft)">make check:清单对得上、卡没过期</text>
</g>
<g stroke="var(--rule)" stroke-width="1.5" fill="none">
<path d="M 120 40 L 160 60"/><path d="M 120 100 L 160 76"/><path d="M 280 65 L 320 65"/><path d="M 430 65 L 470 65" stroke-dasharray="4 3"/>
<path d="M 120 180 L 160 163"/><path d="M 120 180 L 160 197"/><path d="M 280 163 L 320 175"/><path d="M 280 197 L 320 190"/><path d="M 430 180 L 470 180"/>
<path d="M 375 210 L 375 250"/><path d="M 550 210 L 550 250"/>
</g>
</svg>
<figcaption>上面一条是数据线,下面一条是模型线,两条线最后都落到报告文件,再由 `render_card.py` 生成卡。虚线框是没实跑的训练。琥珀色的是今天靠脚本强制的几道关。</figcaption>
</figure>

先建目录:

```bash
mkdir -p part10/triage-router/config part10/triage-router/reports part10/triage-router/templates
uv add pyyaml
```

## 第一步:数据清单和哈希

流水线的第一个要求是**可追溯**:任何时候你都要能回答「这一步用的是哪份文件」,而且要能证明它没被人悄悄改过。办法是给每个数据文件记三个数:行数、字节数、**sha256**。sha256 是一种哈希函数(明天 [Day 583](/blog/agent-zero/day-583-platform-1/) 里 API key 只存哈希,是同一类东西):不管输入多长,输出都是 64 位十六进制;输入差一个字节,输出就面目全非;从输出倒推不回输入。拿它当文件的指纹最合适:文件对得上,指纹就一样。

新建 `part10/manifest.py`,两个命令:`write` 写清单,`verify` 核对:

```python
# agent-zero-lab/part10/manifest.py
"""给一批文件记清单(路径、行数、字节数、sha256),或者对着清单核对。
用法:uv run python part10/manifest.py write 清单.json 文件1 文件2 ...
      uv run python part10/manifest.py verify 清单.json
清单里的路径是相对「清单所在目录」的路径。核对发现任何文件对不上,退出码是 1。
"""
import hashlib
import json
import os
import sys
from pathlib import Path


def describe(path: Path) -> dict:
    data = path.read_bytes()
    rows = sum(1 for line in data.decode("utf-8").splitlines() if line.strip())
    return {"rows": rows, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def write(manifest: Path, files: list[str]) -> None:
    entries = {}
    for f in files:
        rel = os.path.relpath(Path(f).resolve(), manifest.parent.resolve())
        entries[rel] = describe(Path(f))
    manifest.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"写入 {manifest.name}:{len(entries)} 个文件")


def verify(manifest: Path) -> int:
    entries = json.loads(manifest.read_text(encoding="utf-8"))
    bad = 0
    for rel, old in entries.items():
        path = manifest.parent / rel
        if not path.exists():
            print(f"缺失   {rel}")
            bad += 1
            continue
        new = describe(path)
        if new["sha256"] == old["sha256"]:
            print(f"一致   {rel}  {old['rows']} 行  {old['sha256'][:8]}")
        else:
            print(f"被改过 {rel}  行数 {old['rows']} → {new['rows']}  sha256 {old['sha256'][:8]} → {new['sha256'][:8]}")
            bad += 1
    print("全部一致" if bad == 0 else f"{bad} 个文件对不上")
    return 1 if bad else 0


if __name__ == "__main__":
    cmd, target = sys.argv[1], Path(sys.argv[2])
    if cmd == "write":
        write(target, sys.argv[3:])
    elif cmd == "verify":
        sys.exit(verify(target))
    else:
        sys.exit(f"不认识的命令 {cmd},只有 write 和 verify")
```

<div class="line-notes">

- `import hashlib` 标准库,里面有 `sha256`。
- `def describe(path: Path) -> dict:` 描述一个文件:行数、字节数、sha256。
- `data = path.read_bytes()` 按**字节**读,不按文本读。哈希要对原始字节算,换行符、末尾空行都算数,这样「多了一个空行」这种改动也能发现。
- `rows = sum(1 for line in data.decode("utf-8").splitlines() if line.strip())` 数非空行。生成器表达式每遇到一个非空行就产出一个 1,`sum` 加起来,相当于 JS 里 `lines.filter(l => l.trim()).length`。`raw_triage.jsonl` 有 503 个换行但只有 502 条记录,末尾那个空行不算(Day 570 专门埋过这个空行的坑)。
- `return {"rows": rows, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}` `hexdigest()` 把哈希结果变成 64 个字符的十六进制字符串。
- `rel = os.path.relpath(Path(f).resolve(), manifest.parent.resolve())` 清单里存的路径是**相对清单所在目录**的,这样整个目录搬到别的地方(Day 624 搬进 AgentOps),清单仍然有效。`resolve()` 先把路径变成绝对路径,`relpath` 再算出相对关系,比如 `../data/route_dev.jsonl`。
- `entries[rel] = describe(Path(f))` 键是相对路径,值是上面那三个数。
- `manifest.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")` 写成缩进的 JSON,方便用 git 看改动。
- `entries = json.loads(manifest.read_text(encoding="utf-8"))` `verify` 先读回清单。
- `path = manifest.parent / rel` 把相对路径接回清单所在目录,找到文件。
- `if not path.exists():` 文件没了,单独报「缺失」,和「被改过」区分开。
- `if new["sha256"] == old["sha256"]:` 只比哈希。行数一样但内容变了的情况(改了一个标准答案)只有哈希能发现。
- `print(f"被改过 {rel}  行数 {old['rows']} → {new['rows']}  sha256 {old['sha256'][:8]} → {new['sha256'][:8]}")` 报出新旧行数和哈希前 8 位。前 8 位够人眼对比,不用打印整串。
- `return 1 if bad else 0` 有一个对不上就返回 1。
- `sys.exit(verify(target))` 把返回值当进程退出码。退出码非 0,`make` 和 CI 就知道这一步失败了。
- `sys.exit(f"不认识的命令 {cmd},只有 write 和 verify")` `sys.exit` 传字符串时,会把它打印到标准错误,退出码是 1。

</div>

先别急着记清单,先把数据这一步做对,因为清单要记的是**对的**文件。

## 第二步:Makefile,把一堆脚本连成依赖链

手动一个一个敲命令的问题:你会漏步骤、会按错顺序、会在改了数据之后忘了重跑后面的东西。需要一个工具来管「谁依赖谁、改了谁就重跑谁」。前端同学最熟悉的类比是 `package.json` 里的 `scripts`,再加上一个能力:每条脚本声明自己依赖哪些文件,文件没变就不重跑。这个工具叫 **make**,它读一个叫 `Makefile` 的文件。macOS 自带(我这里是 GNU Make 3.81)。

`Makefile` 的核心语法只有一种,叫**规则**:

```text
目标: 依赖1 依赖2
<Tab>命令
```

意思是:**要得到「目标」这个文件,先保证「依赖」都是最新的,然后执行命令**。make 比较的是文件修改时间:目标不存在,或者比任何一个依赖旧,才会执行命令;目标比所有依赖都新,就打印 `Nothing to be done`,什么都不做。这就是「改了谁就重跑谁」的全部原理。

有一个新手几乎必踩的坑,先故意踩一次。命令那一行**必须以一个 Tab 开头**,不能是空格:

```bash
printf 'hello:\n    echo hi\n' > /tmp/bad.mk
make -f /tmp/bad.mk
```

```text
/tmp/bad.mk:2: *** missing separator.  Stop.
```

`missing separator`(缺分隔符)是 make 对「这一行既不是规则也不是命令」的说法,翻译过来就是「你这行开头应该是 Tab」。编辑器把 Tab 自动换成空格时最容易出这个错。把空格换成 Tab(`printf` 里的 `\t`)就好了:

```bash
printf 'hello:\n\techo hi\n' > /tmp/ok.mk
make -f /tmp/ok.mk
```

```text
echo hi
hi
```

下面是今天的 `Makefile`。它比一般例子长,但每一块只是同一种规则的重复。新建 `part10/triage-router/Makefile`(记得命令行开头是 Tab):

```makefile
# agent-zero-lab/part10/triage-router/Makefile
# 在 part10/triage-router/ 目录里跑:make dataset / make eval / make final / make cards / make check
VERSION := v1
DATA    := ../data
PY      := uv run python
EVALS   := $(DATA)/tickets_v1.jsonl $(DATA)/tickets_hard.jsonl $(DATA)/route_dev.jsonl $(DATA)/route_test.jsonl $(DATA)/unlabeled.jsonl
RESULTS := $(DATA)/small-dev.jsonl $(DATA)/small-test.jsonl $(DATA)/big-dev.jsonl $(DATA)/big-test.jsonl
TRACKED := $(DATA)/raw_triage.jsonl $(EVALS) ../out/triage_train.jsonl ../out/triage_val.jsonl $(RESULTS)

.PHONY: dataset eval pick final cards check
dataset: reports/leak-$(VERSION).txt
eval: reports/sweep-dev-$(VERSION).txt reports/pick-$(VERSION).json
pick: reports/pick-$(VERSION).json

# ---- 数据:原始记录去掉所有评测题 → train/val → 查泄漏 ----
$(DATA)/eval_all.jsonl: $(EVALS)
	cat $(EVALS) > $@

reports/dataset-$(VERSION).log: $(DATA)/raw_triage.jsonl $(DATA)/eval_all.jsonl ../build_sft_data.py
	$(PY) ../build_sft_data.py $(DATA)/raw_triage.jsonl $(DATA)/eval_all.jsonl ../out > $@
	@cat $@

reports/leak-$(VERSION).txt: reports/dataset-$(VERSION).log ../check_leak.py
	$(PY) ../check_leak.py ../out $(DATA)/eval_all.jsonl > $@
	@cat $@
	@grep -q "train∩eval: 0" $@ && grep -q "val∩eval: 0" $@ || { echo "训练集里有评测题,停"; rm $@; exit 1; }

# ---- 小模型、大模型各跑一遍 dev 和 test(小模型那一步在 CPU 上每份要六七分钟) ----
$(DATA)/small-%.jsonl: $(DATA)/route_%.jsonl ../dpo-cpu/student_run.py ../teacher_guide_v2.txt ../confidence.py
	cd ../dpo-cpu && HF_HUB_OFFLINE=1 $(PY) student_run.py ../data/route_$*.jsonl

$(DATA)/big-%.jsonl: $(DATA)/route_%.jsonl ../big_run.py ../teacher_guide_v2.txt
	$(PY) ../big_run.py $(DATA)/route_$*.jsonl

# ---- dev:扫阈值、按规则选阈值 ----
reports/sweep-dev-$(VERSION).txt: $(DATA)/small-dev.jsonl $(DATA)/big-dev.jsonl ../sweep.py
	$(PY) ../sweep.py dev > $@
	@cat $@

reports/pick-$(VERSION).json: $(DATA)/small-dev.jsonl $(DATA)/big-dev.jsonl ../pick_dev.py
	$(PY) ../pick_dev.py $@

# ---- test:只能用一次(final_test.py 里有锁),然后记清单、出卡、检查 ----
final: reports/test-$(VERSION).json

reports/test-$(VERSION).json: reports/pick-$(VERSION).json config/route.yaml $(DATA)/small-test.jsonl $(DATA)/big-test.jsonl ../final_test.py
	$(PY) ../final_test.py .

MANIFEST.json: $(TRACKED)
	$(PY) ../manifest.py write $@ $(TRACKED)

cards: MANIFEST.json reports/dataset-$(VERSION).log reports/pick-$(VERSION).json reports/test-$(VERSION).json
	$(PY) ../render_card.py .

check:
	$(PY) ../manifest.py verify MANIFEST.json
	$(PY) ../render_card.py . --check
```

<div class="line-notes">

- `VERSION := v1` 变量。`:=` 是「现在就算出值」的赋值。报告文件名里带版本号,以后出 v2 只改这一行。引用变量写 `$(VERSION)`。
- `DATA    := ../data` 数据目录。`Makefile` 在 `part10/triage-router/` 里跑,数据在上一级的 `data/`。
- `PY      := uv run python` 把「怎么跑 Python」存成变量。以后换成别的运行方式只改这一处。
- `EVALS   := $(DATA)/tickets_v1.jsonl $(DATA)/tickets_hard.jsonl` 五份评测文件的清单,一个变量,下面多处用。
- `RESULTS := $(DATA)/small-dev.jsonl` 四个模型跑出来的结果文件:替身和大模型各跑 dev 和 test。
- `TRACKED := $(DATA)/raw_triage.jsonl $(EVALS) ../out/triage_train.jsonl` 要记进清单的所有文件:原始数据、评测文件、训练和验证集、四个结果。
- `.PHONY: dataset eval pick final cards check` **伪目标**:这些名字不对应任何文件,只是「一组任务的名字」。不声明的话,哪天目录里恰好有个叫 `check` 的文件,`make check` 就会说「已经是最新的」而不执行。
- `dataset: reports/leak-$(VERSION).txt` 这一条没有命令,只有依赖:做「dataset」就是做出 leak 那份报告,而它的依赖链会把前面的步骤都拉起来。
- `$(DATA)/eval_all.jsonl: $(EVALS)` 第一条真规则:五份评测文件任何一份变了,就重新拼 `eval_all.jsonl`。
- `cat $(EVALS) > $@` `$@` 是「当前目标」,这里就是 `../data/eval_all.jsonl`。`cat a b c > x` 把几个文件首尾相接写进 x。每份 jsonl 都以换行结尾,所以拼起来不会粘在一行。
- `reports/dataset-$(VERSION).log: $(DATA)/raw_triage.jsonl $(DATA)/eval_all.jsonl ../build_sft_data.py` 训练集的规则。依赖里有**脚本本身**:`build_sft_data.py` 改了,训练集也要重造。
- `$(PY) ../build_sft_data.py $(DATA)/raw_triage.jsonl $(DATA)/eval_all.jsonl ../out > $@` 关键改动:黑名单参数从 `tickets_v1.jsonl` 换成 `eval_all.jsonl`。脚本的标准输出(丢弃了几条、各类别多少)重定向进报告文件,后面数据卡要用。
- `@cat $@` 命令前面的 `@` 表示「执行时不要先把这行命令打印出来」。这里只想让你看到报告的内容。
- `reports/leak-$(VERSION).txt: reports/dataset-$(VERSION).log ../check_leak.py` 查泄漏依赖训练集那份日志,所以训练集一重造,泄漏检查必然重跑。
- `@grep -q "train∩eval: 0" $@ && grep -q "val∩eval: 0" $@ || { echo "训练集里有评测题,停"; rm $@; exit 1; }` 这就是「代码强制」:两个交集都是 0 才通过。不通过就打印原因、删掉这份报告、让 make 以失败退出,下游所有东西都不会继续。删报告是为了下次 `make` 不会把一份失败的报告当成「已经做完」。
- `$(DATA)/small-%.jsonl: $(DATA)/route_%.jsonl ../dpo-cpu/student_run.py ../teacher_guide_v2.txt ../confidence.py` **模式规则**:`%` 是通配符。同一条规则同时管 `small-dev.jsonl` 和 `small-test.jsonl`,各自依赖 `route_dev.jsonl` 和 `route_test.jsonl`。依赖里列了替身脚本、口径说明和置信度脚本,改任何一个,小模型就要重跑。
- `cd ../dpo-cpu && HF_HUB_OFFLINE=1 $(PY) student_run.py ../data/route_$*.jsonl` `$*` 是 `%` 匹配到的部分,即 `dev` 或 `test`。`cd` 进 `dpo-cpu` 是因为那个目录有自己独立的 Python 环境([Day 576](/blog/agent-zero/day-576-dpo-2/) 建的)。
- `$(DATA)/big-%.jsonl: $(DATA)/route_%.jsonl ../big_run.py ../teacher_guide_v2.txt` 大模型那一路,同样的模式。
- `reports/sweep-dev-$(VERSION).txt: $(DATA)/small-dev.jsonl $(DATA)/big-dev.jsonl ../sweep.py` 扫阈值只依赖 **dev** 的两份结果。test 的结果文件一个字都没进这条规则,这是在结构上保证选阈值的时候碰不到 test。
- `reports/pick-$(VERSION).json: $(DATA)/small-dev.jsonl $(DATA)/big-dev.jsonl ../pick_dev.py` 选阈值同理,只依赖 dev。
- `final: reports/test-$(VERSION).json` `final` 是伪目标,实际要做的是那份 test 结果文件。
- `reports/test-$(VERSION).json: reports/pick-$(VERSION).json config/route.yaml $(DATA)/small-test.jsonl $(DATA)/big-test.jsonl ../final_test.py` test 的规则依赖 dev 选出的阈值、配置文件、test 的两份结果。配置文件一改,这条规则就会被触发,而 `final_test.py` 里的锁会决定让不让过。
- `MANIFEST.json: $(TRACKED)` 清单依赖所有被追踪的文件,它们任何一个变了,清单就是过期的。
- `cards: MANIFEST.json reports/dataset-$(VERSION).log reports/pick-$(VERSION).json reports/test-$(VERSION).json` 出卡依赖清单和三份报告。
- `$(PY) ../render_card.py . --check` `check` 做两件事:清单核对,以及卡有没有过期。这两行任何一个失败,`make check` 就以失败退出,CI 就会红。

</div>

### 数据这一步,真的跑一遍

先把 `eval_all.jsonl` 和训练集用新的黑名单重造。目录里已经有旧的 `out/`,不用管,`build_sft_data.py` 每次都会覆盖它:

```bash
cd part10/triage-router
make dataset
```

```text
uv run python ../build_sft_data.py ../data/raw_triage.jsonl ../data/eval_all.jsonl ../out > reports/dataset-v1.log
dropped: {'in_eval_set': 120, 'invalid': 6, 'duplicate': 10}
kept before cap: {'invoice': 38, 'billing': 113, 'account': 28, 'technical': 92, 'plan_change': 24, 'refund': 48, 'api': 8, 'other': 15}
after cap: {'technical': 60, 'refund': 48, 'account': 28, 'api': 8, 'plan_change': 24, 'other': 15, 'billing': 60, 'invoice': 38}
sources: {'verified': 140, 'human': 52, 'teacher': 89}
train=253 val=28
WARNING 这些类别少于 30 条,考虑补数据: ['account', 'api', 'other', 'plan_change']
uv run python ../check_leak.py ../out ../data/eval_all.jsonl > reports/leak-v1.txt
train∩eval: 0
val∩eval: 0
train∩val: 0
train 内部重复: 0
```

读这几行。第一行 `dropped` 里 `in_eval_set` 是 120,比 Day 570 的 5 多得多,这就是上面查出来的泄漏被拦住了(120 是行数,包含了换了说法、重复导出的同一张工单)。清洗后训练集 253 条、验证集 28 条,比 Day 570 的 297 和 32 少,少掉的就是和评测集撞车的那部分。最后四个 `train∩eval: 0` 说明泄漏检查过了。注意这里最后一行有个警告:`account`、`api`、`other`、`plan_change` 四个类别不到 30 条,数据卡的「已知偏差」会记下它。

再跑一遍,什么都不会发生:

```bash
make dataset
```

```text
make: Nothing to be done for `dataset'.
```

因为没有任何依赖变新。这就是 make 的价值:**只重跑该重跑的**。一个更有用的试验是用 `-n`(只打印不执行),看看「我改了一份评测集」会触发什么。先 `touch` 一下 `route_dev.jsonl`(把它的修改时间改成现在,内容不变),再看 `make -n eval`:

```bash
touch ../data/route_dev.jsonl
make -n eval
```

```text
cd ../dpo-cpu && HF_HUB_OFFLINE=1 uv run python student_run.py ../data/route_dev.jsonl
uv run python ../big_run.py ../data/route_dev.jsonl
uv run python ../sweep.py dev > reports/sweep-dev-v1.txt
cat reports/sweep-dev-v1.txt
uv run python ../pick_dev.py reports/pick-v1.json
```

一共五步:替身重跑 dev(CPU 上要七分钟)、大模型重跑 dev(花钱)、重新扫阈值、再选阈值。注意没有 test 的任何步骤:`route_dev` 变了和 test 无关。要是你改的是 `route_test.jsonl`,触发的就是 test 那几步。这个预览值得养成习惯:**改完数据先 `make -n` 看看要重跑什么**,别被一个意想不到的十几分钟、几毛钱吓到。(试验完记得用 `make -t eval final` 把时间戳补回去,`-t` 的意思是「标记为最新,不执行」。)

### 清单:记下来,再被检查出来

数据文件现在是对的,记清单。清单依赖所有被追踪的文件,不过结果文件(`small-*`、`big-*`)我们已经有了,直接 `make MANIFEST.json`:

```bash
make MANIFEST.json
```

```text
uv run python ../manifest.py write MANIFEST.json ../data/raw_triage.jsonl ../data/tickets_v1.jsonl ../data/tickets_hard.jsonl ../data/route_dev.jsonl ../data/route_test.jsonl ../data/unlabeled.jsonl ../out/triage_train.jsonl ../out/triage_val.jsonl ../data/small-dev.jsonl ../data/small-test.jsonl ../data/big-dev.jsonl ../data/big-test.jsonl
写入 MANIFEST.json:12 个文件
```

12 个文件,每个都有了行数和 sha256。验证数据线是不是**可重现**:把数据报告删了,强制 `make dataset` 重新造一遍训练集,然后核对清单:

```bash
rm reports/dataset-v1.log
make dataset > /dev/null
uv run python ../manifest.py verify MANIFEST.json | tail -6
```

```text
一致   ../out/triage_val.jsonl  28 行  de6191d4
一致   ../data/small-dev.jsonl  50 行  2328be09
一致   ../data/small-test.jsonl  30 行  443ce809
一致   ../data/big-dev.jsonl  50 行  7c1f7deb
一致   ../data/big-test.jsonl  30 行  279ca0f2
全部一致
```

重造之后,训练集、验证集的哈希和清单里记的**一模一样**。这是「重跑得到同样的文件」的证明:`build_sft_data.py` 里 `random.seed(42)` 固定了打乱和抽样,输入文件顺序固定,输出的 JSON 键顺序固定。三样里少一样,哈希就会变。

再试一次「有人顺手改了一条标准答案」。我把 `route_test.jsonl` 第一条的标准类别改成 `other`(改之前备份了,马上还原):

```bash
uv run python ../manifest.py verify MANIFEST.json | grep -v "^一致"
echo "退出码 ${PIPESTATUS[0]}"
```

```text
被改过 ../data/route_test.jsonl  行数 30 → 30  sha256 29489c9b → 90db0c95
1 个文件对不上
```

行数一点没变,还是 30 行,只有哈希变了,所以只比行数是发现不了的。`verify` 报出了是哪个文件、哈希前后各是什么,退出码是 1。**评测集是流水线里最该被保护的文件**,它被悄悄改一条,所有的对比数字就不能再和以前的比了。

## 第三步:选阈值只看 dev,配置写进文件

Day 578 的 `pick_threshold.py` 有个毛病:它没有 `if __name__ == "__main__":`,一导入就会跑,而且选完阈值立刻去 test 上验证。在流水线里这不行,因为「选阈值」是 dev 阶段的事,test 要留到最后、在锁下跑。所以今天把选阈值单独拆出来,只读 dev,结果写成 JSON。新建 `part10/pick_dev.py`:

```python
# agent-zero-lab/part10/pick_dev.py
"""只看 dev:按事先写好的规则选阈值,结果写成 JSON。不碰 test。
规则和 Day 578 的 pick_threshold.py 一样:准确率不低于「只用大模型」减 TOLERANCE,满足的阈值里选成本最低的。
用法:uv run python part10/pick_dev.py reports/pick-v1.json [category|all]
"""
import json
import sys
from pathlib import Path

from sweep import DATA, load, sweep, view

TOLERANCE = 0.02
GRID = [i / 20 for i in range(20)] + [0.97, 0.99, 1.01]


def pick(rows: list[tuple[bool, float, bool, float]]) -> dict:
    big_acc = sum(b for _, _, b, _ in rows) / len(rows)
    ok = [r for r in sweep(rows, GRID) if r["acc"] >= big_acc - TOLERANCE]
    return min(ok, key=lambda r: (r["cost_1k"], -r["t"]))


if __name__ == "__main__":
    out = Path(sys.argv[1])
    mode = sys.argv[2] if len(sys.argv) > 2 else "category"
    rows = view(load(DATA / "small-dev.jsonl"), load(DATA / "big-dev.jsonl"), mode)
    best = pick(rows)
    big_acc = sum(b for _, _, b, _ in rows) / len(rows)
    result = {"mode": mode, "n": len(rows), "tolerance": TOLERANCE, "big_acc": big_acc,
              "threshold": best["t"], "acc": best["acc"], "cost_1k": best["cost_1k"], "fallback": best["fallback"]}
    out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"dev {len(rows)} 张,只用大模型 {big_acc:.3f};选出阈值 {best['t']:.2f},准确率 {best['acc']:.3f},"
          f"元/千张 {best['cost_1k']:.2f},回退率 {best['fallback']:.0%}")
```

<div class="line-notes">

- `from sweep import DATA, load, sweep, view` 全部复用 Day 578 的 `sweep.py`:`load` 读结果文件,`view` 把每张工单变成 `(小模型对不对, 置信度, 大模型对不对, 大模型花费)`,`sweep` 对每个阈值算准确率、成本、回退率。
- `TOLERANCE = 0.02` 选择规则里的容忍线:允许级联比「只用大模型」低 2 个百分点。这个数事先写死,不看了结果再调,[Day 578](/blog/agent-zero/day-578-distill-2/) 讲过。
- `GRID = [i / 20 for i in range(20)] + [0.97, 0.99, 1.01]` 候选阈值:0.00、0.05 一直到 0.95,再加 0.97、0.99、1.01。1.01 表示「谁都不够自信,全部回退」。
- `big_acc = sum(b for _, _, b, _ in rows) / len(rows)` 只用大模型的准确率,当基线。元组里第三项是大模型对不对,布尔值能直接累加。
- `ok = [r for r in sweep(rows, GRID) if r["acc"] >= big_acc - TOLERANCE]` 留下准确率达标的阈值。代入 dev 的数字:大模型 0.96,容忍 0.02,所以要求 `acc >= 0.94`。
- `return min(ok, key=lambda r: (r["cost_1k"], -r["t"]))` 达标的里面选成本最低的;成本一样时选阈值更大的(更保守)。`min` 的 `key` 返回元组,先比第一项再比第二项,相当于 JS 里自己写的两级排序。
- `out = Path(sys.argv[1])` 命令行第一个参数是结果写到哪,Makefile 里传的是 `$@`,也就是 `reports/pick-v1.json`。
- `rows = view(load(DATA / "small-dev.jsonl"), load(DATA / "big-dev.jsonl"), mode)` 只读 `-dev`。整个文件里没有出现过 `test`。
- `result = {"mode": mode, "n": len(rows), "tolerance": TOLERANCE, "big_acc": big_acc,` 把选择规则的参数和结果都写进去,以后有人问「这个 0.85 是怎么来的」,打开这个文件就有答案。
- `out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")` 写成缩进的 JSON。

</div>

先把前面攒下的 dev 结果扫一遍、选出阈值。`make eval` 会依次做这两件事(结果文件已经有了,所以不会重跑模型):

```bash
make eval
```

```text
dev 50 张,看 category
只用小模型: acc=0.420  元/千张=0.20
只用大模型: acc=0.960  元/千张=1.89
    阈值     准确率     元/千张     回退率
  0.00    0.420      0.20       0%
  0.50    0.680      0.76      30%
  0.70    0.700      0.92      38%
  0.80    0.800      1.12      48%
  0.90    0.960      1.50      68%
  0.95    0.960      1.70      78%
  0.99    0.960      1.83      86%
  1.01    0.960      2.09     100%
置信度校准(区间, 张数, 小模型真实准确率):
  [0.00, 0.50)  n=15  acc=0.13
  [0.50, 0.70)  n=4   acc=0.75
  [0.70, 0.90)  n=15  acc=0.13
  [0.90, 0.99)  n=9   acc=1.00
  [0.99, 1.00)  n=7   acc=0.71
```

```text
dev 50 张,只用大模型 0.960;选出阈值 0.85,准确率 0.960,元/千张 1.44,回退率 64%
```

和 Day 578 一模一样(同样的种子、同样的口径)。上面的表要读两处。第一,准确率从阈值 0.80 的 0.800 一下跳到 0.90 的 0.960,而 0.85 不在 `sweep.py` 的格子里,所以选阈值用 `pick_dev.py` 里更细的 `GRID`。第二,最底下的校准表:置信度在 0.99 以上的 7 张里只对了 71%,0.90 到 0.99 的 9 张反而 100% 对。最自信的一档并不是最准的一档,这一条也会原样进模型卡的「已知局限」。

### 配置文件:阈值和强制回退的类别

阈值不该写在 Python 里。改阈值是**运维动作**(上线、灰度、回滚都要改它),不该走一遍「改代码、过评审、发版」。把它放进 `config/route.yaml`。**YAML** 是一种配置文件格式,对前端同学可以类比成「更爱写注释的 JSON」,缩进表示层级。新建 `part10/triage-router/config/route.yaml`:

```yaml
# agent-zero-lab/part10/triage-router/config/route.yaml
model: triage-v1-stand-in   # 路由器当前接的「小模型」:CPU 替身,还不是训好的学生
threshold: 0.85             # 必须等于 reports/pick-v1.json 里的 threshold,final_test.py 会核对
always_big:                 # 这些类别不管置信度多高,一律交给大模型(按风险定,不是按扫阈值定)
  - refund
fallback:
  model: deepseek-v4-pro
  on_parse_error: true      # 小模型输出解析不出来,也交给大模型
shadow_mode: true           # 上线第一阶段:小模型只记录,不决定(Day 634 讲)
```

<div class="line-notes">

- `model: triage-v1-stand-in   # 路由器当前接的「小模型」:CPU 替身,还不是训好的学生` 名字里直接写 `stand-in`(替身)。以后换成训好的学生,改这一行,模型卡会跟着变成别的内容。
- `threshold: 0.85             # 必须等于 reports/pick-v1.json 里的 threshold,final_test.py 会核对` 置信度不到这个数就回退。注释写明了它的出处,而且有脚本核对。
- `always_big:                 # 这些类别不管置信度多高,一律交给大模型(按风险定,不是按扫阈值定)` 一条按**风险**定的规则。退款类的分诊错了,客户的钱可能走错路,所以不管小模型多自信,预测为 `refund` 的一律交给大模型。这不是靠扫阈值扫出来的,是业务判断。
- `  - refund` YAML 的列表,每项前面一个短横线。
- `fallback:` 回退时用谁。
- `model: deepseek-v4-pro` 回退到大模型。
- `on_parse_error: true      # 小模型输出解析不出来,也交给大模型` 小模型吐出一段不是 JSON 的东西时,不要报错,交给大模型。
- `shadow_mode: true           # 上线第一阶段:小模型只记录,不决定(Day 634 讲)` 影子模式:小模型和大模型同时判,线上一直用大模型的结果,小模型的结果只写日志,用来在真实流量上验证。[Day 634](/blog/agent-zero/day-634-agentops-router/) 才讲怎么做,今天只是把开关先放在配置里。

</div>

配置文件放进去以后,要有人读它。读的时候最重要的是**校验**:`threshold: 0.85` 手滑写成 `threshold: 85` 或者类别拼错成 `refudn`,要在加载时就报错,不能等上线后悄悄失效。新建 `part10/route_config.py`,它同时负责读配置、按配置做路由决定、按配置在一批已经跑好的结果上「回放」:

```python
# agent-zero-lab/part10/route_config.py
"""读 route.yaml、校验,并按它把一批已经跑好的小模型/大模型结果「回放」一遍:每张工单该走谁、整体准确率和成本。
用法:uv run python part10/route_config.py triage-router/config/route.yaml dev
"""
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import yaml

from build_sft_data import CATEGORIES
from sweep import DATA, SMALL_COST, load

EXPECTED_KEYS = {"model", "threshold", "always_big", "fallback", "shadow_mode"}


@dataclass(frozen=True)
class RouteConfig:
    model: str
    threshold: float
    always_big: frozenset[str]
    fallback_model: str
    on_parse_error: bool
    shadow_mode: bool


def load_config(path: Path) -> RouteConfig:
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or set(raw) != EXPECTED_KEYS:
        raise ValueError(f"{path.name} 的顶层字段必须正好是 {sorted(EXPECTED_KEYS)},现在是 {sorted(raw) if isinstance(raw, dict) else raw}")
    if not isinstance(raw["threshold"], (int, float)) or not 0 <= raw["threshold"] <= 1.01:
        raise ValueError(f"threshold 必须在 0 到 1.01 之间,现在是 {raw['threshold']!r}")
    unknown = set(raw["always_big"]) - CATEGORIES
    if unknown:
        raise ValueError(f"always_big 里有不认识的类别 {sorted(unknown)},合法的是 {sorted(CATEGORIES)}")
    return RouteConfig(model=raw["model"], threshold=float(raw["threshold"]), always_big=frozenset(raw["always_big"]),
                       fallback_model=raw["fallback"]["model"], on_parse_error=bool(raw["fallback"]["on_parse_error"]),
                       shadow_mode=bool(raw["shadow_mode"]))


def route(cfg: RouteConfig, small: dict) -> tuple[str, str]:
    """返回 (走谁, 原因)。判断只用小模型自己的输出,不能偷看标准答案。"""
    pred = small["pred"]
    if not pred and cfg.on_parse_error:
        return "big", "parse_error"
    if pred.get("category") in cfg.always_big:
        return "big", "always_big"
    if small["conf"]["category"] < cfg.threshold:
        return "big", "low_conf"
    return "small", "confident"


def replay(cfg: RouteConfig, small: dict[str, dict], big: dict[str, dict]) -> dict:
    n = len(small)
    correct = cost = 0.0
    reasons: Counter[str] = Counter()
    for i in sorted(small):
        who, why = route(cfg, small[i])
        reasons[why] += 1
        cost += SMALL_COST
        if who == "small":
            correct += small[i]["fields"]["category"]
        else:
            correct += big[i]["fields"]["category"]
            cost += big[i]["cost"]
    return {"n": n, "correct": int(correct), "acc": correct / n, "cost_1k": 1000 * cost / n,
            "fallback": (n - reasons["confident"]) / n, "reasons": dict(reasons)}


if __name__ == "__main__":
    cfg = load_config(Path(sys.argv[1]))
    split = sys.argv[2]
    res = replay(cfg, load(DATA / f"small-{split}.jsonl"), load(DATA / f"big-{split}.jsonl"))
    print(cfg)
    print(f"{split} 回放:category 对 {res['correct']}/{res['n']}  元/千张 {res['cost_1k']:.2f}  回退率 {res['fallback']:.0%}  原因 {res['reasons']}")
```

<div class="line-notes">

- `import yaml` 刚才 `uv add pyyaml` 装的。
- `from build_sft_data import CATEGORIES` Day 570 定义的八个类别名。校验 `always_big` 里的类别用它,保证配置里的类别和训练时是同一套。
- `from sweep import DATA, SMALL_COST, load` `SMALL_COST` 是 Day 578 假设的小模型每张 ¥0.0002。
- `EXPECTED_KEYS = {"model", "threshold", "always_big", "fallback", "shadow_mode"}` 配置顶层字段必须**正好**是这五个。多一个(拼错了)或少一个都要报错。
- `@dataclass(frozen=True)` [Day 50](/blog/agent-zero/day-050-dataclass/) 的 dataclass。配置加载以后不该再被改,`frozen` 冻住。
- `always_big: frozenset[str]` 不可变的集合。`in` 判断是常数时间,而且不会被某处代码悄悄 `add` 一个进去。
- `raw = yaml.safe_load(path.read_text(encoding="utf-8"))` `safe_load` 把 YAML 变成 Python 的字典和列表。一定用 `safe_load`,不要用 `load`:后者能构造任意 Python 对象,读到恶意文件会执行代码。
- `if not isinstance(raw, dict) or set(raw) != EXPECTED_KEYS:` 先查结构。`set(raw)` 取字典的所有键,和期望的集合比较。
- `raise ValueError(f"{path.name} 的顶层字段必须正好是 {sorted(EXPECTED_KEYS)}` 报错信息里列出期望的和实际的,不用去翻代码。
- `if not isinstance(raw["threshold"], (int, float)) or not 0 <= raw["threshold"] <= 1.01:` 阈值必须是数字,而且在 0 到 1.01 之间。`0 <= x <= 1.01` 是 Python 的链式比较,JS 里要写成两个条件。
- `unknown = set(raw["always_big"]) - CATEGORIES` 集合相减:`always_big` 里有、合法类别里没有的,就是拼错的。代入 `["refudn"]`,得到 `{"refudn"}`。
- `return RouteConfig(model=raw["model"], threshold=float(raw["threshold"]), always_big=frozenset(raw["always_big"]),` 全部校验通过,才构造配置对象。
- `def route(cfg: RouteConfig, small: dict) -> tuple[str, str]:` 一张工单走谁,返回 `("small" 或 "big", 原因)`。**只能用小模型自己的输出**,不能偷看标准答案,因为线上没有标准答案。
- `pred = small["pred"]` 小模型解析出来的 JSON,解析失败是空字典。
- `if not pred and cfg.on_parse_error:` 空字典的布尔值是 `False`,`not pred` 就是「解析失败」。
- `if pred.get("category") in cfg.always_big:` 小模型**预测**的类别在强制回退名单里。注意是预测的类别,不是真实类别,线上只知道预测的。
- `if small["conf"]["category"] < cfg.threshold:` 置信度低于阈值。代入一张预测 billing、置信度 0.84 的工单:`0.84 < 0.85`,回退;置信度 0.85 的,不回退(边界是「不低于」)。
- `def replay(cfg: RouteConfig, small: dict[str, dict], big: dict[str, dict]) -> dict:` 回放:对一批已经有结果的工单,按配置决定每张走谁,再算整体指标。不调用任何模型,所以改配置试验是免费的。
- `reasons: Counter[str] = Counter()` 记每种回退原因各多少张。
- `cost += SMALL_COST` 不管最后用谁,小模型总是要先跑一遍的,所以每张都计小模型的钱。
- `correct += small[i]["fields"]["category"]` 走小模型,就看小模型对不对。`True` 加进浮点数是 1。
- `correct += big[i]["fields"]["category"]` 回退了,就看大模型对不对,并且加上大模型这一张的实际花费。
- `"fallback": (n - reasons["confident"]) / n,` 回退率 = 不是「有把握」的那些张的比例,三种回退原因都算。

</div>

用 dev 回放一下。再做一个对照:把 `always_big` 里的 `refund` 去掉:

```bash
uv run python part10/route_config.py part10/triage-router/config/route.yaml dev
sed 's/^  - refund//; s/^always_big: .*/always_big: []/' part10/triage-router/config/route.yaml > /tmp/route_norefund.yaml
uv run python part10/route_config.py /tmp/route_norefund.yaml dev
```

```text
$ uv run python part10/route_config.py part10/triage-router/config/route.yaml dev
RouteConfig(model='triage-v1-stand-in', threshold=0.85, always_big=frozenset({'refund'}), fallback_model='deepseek-v4-pro', on_parse_error=True, shadow_mode=True)
dev 回放:category 对 48/50  元/千张 1.59  回退率 72%  原因 {'low_conf': 32, 'always_big': 4, 'confident': 14}

$ uv run python part10/route_config.py /tmp/route_norefund.yaml dev
RouteConfig(model='triage-v1-stand-in', threshold=0.85, always_big=frozenset(), fallback_model='deepseek-v4-pro', on_parse_error=True, shadow_mode=True)
dev 回放:category 对 48/50  元/千张 1.44  回退率 64%  原因 {'low_conf': 32, 'confident': 18}
```

两份配置准确率都是 48/50,强制回退 refund 之后,dev 上每千张从 ¥1.44 涨到 ¥1.59,多花 ¥0.15,换来的是「退款类工单一律由大模型判」。dev 里预测为 refund 的有 4 张,它们本来就有些是小模型有把握的(`always_big` 4 张 + `confident` 少了 4 张)。这是一笔**可以算出来**的账,每千张贵一毛五,值不值是业务的决定,今天先把它写进配置。(第一条命令里我偷懒用 `sed` 造了一份临时配置,真实项目里应该放进版本控制的 `config/` 下。)

## 第四步:test 只用一次,用锁保证

[Day 578](/blog/agent-zero/day-578-distill-2/) 和 [Day 580](/blog/agent-zero/day-580-week83-review/) 都说过 test 只能用一次,可那只是一句话。流水线里要把它变成**代码**。思路是一把锁:第一次在 test 上跑的时候,记下当时 `route.yaml` 的哈希,存进 `reports/test.lock`。之后:配置没变再跑,直接给上次的结果(同一份配置跑多少次结果都一样,不算多用);配置变了再跑,拒绝,因为你是看过 test 结果之后又改了配置,这份 test 已经不是「没见过的题」了。除此之外还有一道关:`route.yaml` 的阈值必须等于 dev 上选出来的,阈值要有出处。新建 `part10/final_test.py`:

```python
# agent-zero-lab/part10/final_test.py
"""test 集只能用一次,用代码保证。
流程:读 route.yaml → 核对阈值有出处(必须等于 dev 上选出来的)→ 查锁文件 → 回放 test → 写结果。
锁文件 reports/test.lock 记着第一次跑 test 时 route.yaml 的哈希:
  没有锁:建锁,跑,写 reports/test-v1.json
  有锁、哈希相同:不重跑,直接打印上次的结果(同一份配置跑多少次结果都一样,不算多用一次)
  有锁、哈希不同:拒绝,配置在看过 test 之后又改了,这份 test 已经不干净
用法:uv run python part10/final_test.py triage-router
"""
import hashlib
import json
import sys
from pathlib import Path

from compare_models import wilson
from route_config import load_config, replay
from sweep import DATA, load


def main(model_dir: Path) -> int:
    cfg_path = model_dir / "config" / "route.yaml"
    pick = json.loads((model_dir / "reports" / "pick-v1.json").read_text(encoding="utf-8"))
    cfg = load_config(cfg_path)
    if cfg.threshold != pick["threshold"]:
        print(f"拒绝:route.yaml 的阈值是 {cfg.threshold},dev 上选出来的是 {pick['threshold']}。阈值必须有出处。")
        return 1

    cfg_hash = hashlib.sha256(cfg_path.read_bytes()).hexdigest()
    lock, result_path = model_dir / "reports" / "test.lock", model_dir / "reports" / "test-v1.json"
    if lock.exists():
        old = json.loads(lock.read_text(encoding="utf-8"))
        if old["config_sha256"] != cfg_hash:
            print(f"拒绝:test 在 {old['config_sha256'][:8]} 版配置下跑过了,现在的配置是 {cfg_hash[:8]}。"
                  "看过 test 再改配置,test 就不再是没见过的题了,换一份新的 test 再来。")
            return 1
        print("test 已经用这份配置跑过,直接给上次的结果:")
        print(result_path.read_text(encoding="utf-8"))
        return 0

    small, big = load(DATA / "small-test.jsonl"), load(DATA / "big-test.jsonl")
    res = replay(cfg, small, big)
    lo, hi = wilson(res["correct"], res["n"])
    big_k = sum(big[i]["fields"]["category"] for i in big)
    blo, bhi = wilson(big_k, len(big))
    out = {**res, "ci": [lo, hi], "big_correct": big_k, "big_ci": [blo, bhi],
           "big_cost_1k": 1000 * sum(b["cost"] for b in big.values()) / len(big), "threshold": cfg.threshold}
    result_path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    lock.write_text(json.dumps({"config_sha256": cfg_hash}) + "\n", encoding="utf-8")
    print(f"test {res['n']} 张:级联 {res['correct']}/{res['n']}  区间 [{lo:.0%}, {hi:.0%}]  "
          f"大模型 {big_k}/{len(big)}  元/千张 {res['cost_1k']:.2f}  回退率 {res['fallback']:.0%}")
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
```

<div class="line-notes">

- `from compare_models import wilson` Day 574 的 Wilson 区间函数,30 张的结果要报区间,不报一个点。
- `from route_config import load_config, replay` 复用刚写的配置加载和回放,线上和这里用的是同一段决策逻辑。
- `cfg_path = model_dir / "config" / "route.yaml"` 命令行传进来的是 `triage-router` 目录(Makefile 里是 `.`),所有路径从它出发。
- `pick = json.loads((model_dir / "reports" / "pick-v1.json").read_text(encoding="utf-8"))` 读 dev 阶段写下的选阈值结果。
- `if cfg.threshold != pick["threshold"]:` 第一道关:配置里的阈值和 dev 选出来的不一样,拒绝。代入 `0.90` 对 `0.85`。返回 1 表示失败。
- `print(f"拒绝:route.yaml 的阈值是 {cfg.threshold},dev 上选出来的是 {pick['threshold']}。阈值必须有出处。")` 报错信息把两个数都说出来。
- `cfg_hash = hashlib.sha256(cfg_path.read_bytes()).hexdigest()` 配置文件的哈希。注释、空格改了哈希也会变,所以连改个注释都会触发第二道关。
- `lock, result_path = model_dir / "reports" / "test.lock", model_dir / "reports" / "test-v1.json"` 锁文件和结果文件。
- `if lock.exists():` 锁在,说明 test 已经跑过。
- `if old["config_sha256"] != cfg_hash:` 第二道关:锁里记的配置哈希和现在的不同,说明有人在看过 test 之后改了配置,拒绝。
- `print("test 已经用这份配置跑过,直接给上次的结果:")` 哈希相同,直接打印上次的结果。**不重新计算**,避免任何「再看一眼」的诱惑。
- `small, big = load(DATA / "small-test.jsonl"), load(DATA / "big-test.jsonl")` 整个脚本里第一次碰 test 数据,在两道关都过了之后。
- `res = replay(cfg, small, big)` 按配置回放 test。
- `lo, hi = wilson(res["correct"], res["n"])` 29/30 的 95% 区间。
- `big_k = sum(big[i]["fields"]["category"] for i in big)` 同一份 test 上只用大模型对了几张,做对照。
- `result_path.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")` 先写结果。
- `lock.write_text(json.dumps({"config_sha256": cfg_hash}) + "\n", encoding="utf-8")` **最后**才写锁。如果前面任何一步崩了,锁不会存在,test 还没算用过。
- `sys.exit(main(Path(sys.argv[1])))` `main` 的返回值就是退出码。

</div>

先试几个拒绝的场景。第一个,阈值改成 0.90 但 dev 选的是 0.85(我把配置改了、跑完立即还原):

```bash
make final
```

```text
uv run python ../final_test.py .
拒绝:route.yaml 的阈值是 0.9,dev 上选出来的是 0.85。阈值必须有出处。
make: *** [reports/test-v1.json] Error 1
```

第二个,配置合格,正式跑 test。这是整条流水线里**唯一一次**打开 test 结果:

```bash
make final
```

```text
uv run python ../final_test.py .
test 30 张:级联 29/30  区间 [83%, 99%]  大模型 29/30  元/千张 1.69  回退率 77%
```

级联在 30 张 test 上对了 29 张,区间 [83%, 99%],和只用大模型一样(29/30)。每千张 ¥1.69,只用大模型是 ¥1.93,省了约 12%(含 refund 强制回退)。区间很宽,30 张就是这样,后面的模型卡会把这句写进「已知局限」。锁文件和结果文件现在都有了:

```bash
cat reports/test.lock
```

```text
{"config_sha256": "727bdf0f0093f4658e83d2815b4a8d6e4934ba9f286a719368a85d4db9a09246"}
```

第三个,锁生效之后,我偷偷把 `always_big` 里的 `refund` 去掉(想看看别的配置在 test 上怎么样),再 `make final`(中间等了两秒,保证文件时间比结果新):

```text
uv run python ../final_test.py .
拒绝:test 在 727bdf0f 版配置下跑过了,现在的配置是 8ecfda01。看过 test 再改配置,test 就不再是没见过的题了,换一份新的 test 再来。
make: *** [reports/test-v1.json] Error 1
```

被拒绝了,报错里新旧哈希都有。**用代码拒绝偷看,比用纪律强**:第三次想「再试一下」的人,往往是半夜赶 deadline 的自己。

第四个,配置内容没变、只是文件时间变新了(比如 `touch`,或者 git 切换分支),`make` 会重新触发这一步,但锁里的哈希对得上,所以只是打印上次的结果:

```text
uv run python ../final_test.py .
test 已经用这份配置跑过,直接给上次的结果:
{
  "n": 30,
  "correct": 29,
  "acc": 0.9666666666666667,
  "cost_1k": 1.6937799999999994,
  "fallback": 0.7666666666666667,
  "reasons": {
    "confident": 7,
    "low_conf": 19,
    "always_big": 4
  },
  "ci": [
    0.8332924860304112,
    0.9940915620051425
  ],
  "big_correct": 29,
  "big_ci": [
    0.8332924860304112,
    0.9940915620051425
  ],
  "big_cost_1k": 1.926,
  "threshold": 0.85
}
```

## 第五步:数据卡和模型卡,数字从报告里来

流水线跑完,每一步的输出都躺在 `reports/` 里。最后一件事是把它们变成人能读的文档。**模型卡**(model card)回答:这个模型是什么、用什么训的、在什么数据上测的、不该用在哪。这个做法来自 Mitchell 等人 2018 年的论文《Model Cards for Model Reporting》(发在 2019 年 FAT* 会议),现在 Hugging Face 上每个模型都有一张。**数据卡**(data card)是它的姊妹:数据从哪来、怎么标的、有什么偏差、有没有隐私问题,源头是 Gebru 等人的《Datasheets for Datasets》。

卡最容易出两种毛病。一种是**写成宣传材料**,只有分数没有局限。另一种是**数字和现实对不上**:训练完过两周,报告里的数字变了(重新选了阈值、换了评测集),卡还是旧的。第二种毛病可以靠流程治,办法是**卡里的每个数字都由脚本从报告里填进去**。手写的文字放在模板里,数字用 `{{键}}` 占位。新建 `part10/render_card.py`:

```python
# agent-zero-lab/part10/render_card.py
"""把数据卡、模型卡里的数字从 reports/ 和 MANIFEST.json 里填进去,手写的文字放在模板里。
模板里写 {{键}},填不上就报错;--check 只检查现有的卡和「现在重新填一遍」是否一样,不一样就退出码 1。
用法:uv run python part10/render_card.py triage-router          # 生成 README.md 和 DATA_CARD.md
      uv run python part10/render_card.py triage-router --check  # 报告改了、卡没跟着改,这里会抓到
"""
import ast
import json
import re
import sys
from pathlib import Path

from route_config import load_config, replay
from sweep import DATA, calibration, load, view

CARDS = {"README.md": "README.md.tpl", "DATA_CARD.md": "DATA_CARD.md.tpl"}


def pct(x: float) -> str:
    return f"{x:.0%}"


def collect(model_dir: Path) -> dict[str, str]:
    reports = model_dir / "reports"
    manifest = json.loads((model_dir / "MANIFEST.json").read_text(encoding="utf-8"))
    log = (reports / "dataset-v1.log").read_text(encoding="utf-8")
    dropped = ast.literal_eval(re.search(r"dropped: (\{.*\})", log).group(1))      # type: ignore[union-attr]
    after_cap = ast.literal_eval(re.search(r"after cap: (\{.*\})", log).group(1))  # type: ignore[union-attr]
    sources = ast.literal_eval(re.search(r"sources: (\{.*\})", log).group(1))      # type: ignore[union-attr]
    n_train, n_val = map(int, re.search(r"train=(\d+) val=(\d+)", log).groups())   # type: ignore[union-attr]
    pick = json.loads((reports / "pick-v1.json").read_text(encoding="utf-8"))
    test = json.loads((reports / "test-v1.json").read_text(encoding="utf-8"))

    dev_res = replay(load_config(model_dir / "config" / "route.yaml"), load(DATA / "small-dev.jsonl"), load(DATA / "big-dev.jsonl"))
    dev_big_cost = 1000 * sum(b["cost"] for b in load(DATA / "big-dev.jsonl").values()) / pick["n"]

    def small_acc(split: str, mode: str) -> float:
        rows = view(load(DATA / f"small-{split}.jsonl"), load(DATA / f"big-{split}.jsonl"), mode)
        return sum(r[0] for r in rows) / len(rows)

    cal = {(lo, hi): (n, acc) for lo, hi, n, acc in calibration(view(load(DATA / "small-dev.jsonl"), load(DATA / "big-dev.jsonl"), "category"))}
    top_n, top_acc = cal[(0.99, 1.0001)]
    mid_n, mid_acc = cal[(0.9, 0.99)]

    def sha(name: str) -> str:
        return next(v["sha256"] for k, v in manifest.items() if k.endswith(name))[:12]

    def rows(name: str) -> str:
        return str(next(v["rows"] for k, v in manifest.items() if k.endswith(name)))

    kv = {
        "raw.rows": rows("raw_triage.jsonl"), "raw.sha": sha("raw_triage.jsonl"),
        "drop.invalid": dropped["invalid"], "drop.duplicate": dropped["duplicate"], "drop.in_eval": dropped["in_eval_set"],
        "train.rows": n_train, "val.rows": n_val, "train.sha": sha("triage_train.jsonl"), "val.sha": sha("triage_val.jsonl"),
        "src.verified": sources["verified"], "src.teacher": sources["teacher"], "src.human": sources["human"],
        "src.teacher_pct": pct(sources["teacher"] / sum(sources.values())),
        "cls.api": after_cap["api"], "cls.other": after_cap["other"],
        "cls.max": max(after_cap.values()), "cls.min": min(after_cap.values()),
        "eval.rows": sum(int(rows(f"{n}.jsonl")) for n in ("tickets_v1", "tickets_hard", "route_dev", "route_test", "unlabeled")),
        "dev.n": pick["n"], "test.n": test["n"], "dev.sha": sha("route_dev.jsonl"), "test.sha": sha("route_test.jsonl"),
        "dev.big_acc": pct(pick["big_acc"]), "dev.small_acc": pct(small_acc("dev", "category")),
        "dev.small_acc_all": pct(small_acc("dev", "all")),
        "cal.top_n": top_n, "cal.top_acc": pct(top_acc), "cal.mid_n": mid_n, "cal.mid_acc": pct(mid_acc),
        "tol": pct(pick["tolerance"]), "t": f"{pick['threshold']:.2f}",
        "dev.k": dev_res["correct"], "dev.fallback": pct(dev_res["fallback"]),
        "dev.cost": f"{dev_res['cost_1k']:.2f}", "dev.big_cost": f"{dev_big_cost:.2f}",
        "test.small_acc": pct(small_acc("test", "category")), "test.small_acc_all": pct(small_acc("test", "all")),
        "test.k": test["correct"], "test.lo": pct(test["ci"][0]), "test.hi": pct(test["ci"][1]),
        "test.big_k": test["big_correct"],
        "test.fallback": pct(test["fallback"]), "test.cost": f"{test['cost_1k']:.2f}", "test.big_cost": f"{test['big_cost_1k']:.2f}",
        "test.reasons": "、".join(f"{k} {v} 张" for k, v in sorted(test["reasons"].items())),
    }
    return {k: str(v) for k, v in kv.items()}


def render(template: str, values: dict[str, str]) -> str:
    missing = sorted(set(re.findall(r"\{\{([\w.]+)\}\}", template)) - set(values))
    if missing:
        raise KeyError(f"模板里有 {len(missing)} 个键没有数据来源:{missing}")
    return re.sub(r"\{\{([\w.]+)\}\}", lambda m: values[m.group(1)], template)


if __name__ == "__main__":
    model_dir = Path(sys.argv[1])
    check = "--check" in sys.argv
    values = collect(model_dir)
    stale = 0
    for card, tpl in CARDS.items():
        text = render((model_dir / "templates" / tpl).read_text(encoding="utf-8"), values)
        target = model_dir / card
        if check:
            same = target.exists() and target.read_text(encoding="utf-8") == text
            print(f"{'最新' if same else '过期'}  {card}")
            stale += not same
        else:
            target.write_text(text, encoding="utf-8")
            print(f"写入 {card}({len(text)} 字符)")
    sys.exit(1 if stale else 0)
```

<div class="line-notes">

- `CARDS = {"README.md": "README.md.tpl", "DATA_CARD.md": "DATA_CARD.md.tpl"}` 两张卡:输出文件名对模板文件名。模板放在 `templates/` 里,输出放在目录根下,所以 `README.md` 就是模型卡,GitHub 和 Hugging Face 打开目录第一眼看到的就是它。
- `def pct(x: float) -> str:` 把 0.96 变成 `96%`。`:.0%` 是格式化,先乘 100 再四舍五入到整数,再加百分号。
- `manifest = json.loads((model_dir / "MANIFEST.json").read_text(encoding="utf-8"))` 清单是数字的来源之一:行数、sha256。
- `dropped = ast.literal_eval(re.search(r"dropped: (\{.*\})", log).group(1))` 从 `build_sft_data.py` 打印的日志里把 `dropped: {...}` 这一行抠出来。`re.search(...).group(1)` 取括号里匹配到的那一段,`ast.literal_eval` 把它安全地当成 Python 字面量解析成字典。这个做法**很脆**:`build_sft_data.py` 改一下打印格式,这里就坏了。练习 4 会换成更稳的写法。
- `# type: ignore[union-attr]` 正则可能没匹配到(返回 `None`),类型检查器要求先判断。这里匹配不到就让它直接崩,所以用这个注释告诉检查器「我知道」。
- `n_train, n_val = map(int, re.search(r"train=(\d+) val=(\d+)", log).groups())` 抠出 `train=253 val=28` 两个数。`groups()` 返回所有括号匹配的元组,`map(int, ...)` 转成整数。
- `dev_res = replay(load_config(model_dir / "config" / "route.yaml"), load(DATA / "small-dev.jsonl"), load(DATA / "big-dev.jsonl"))` 卡里 dev 那一列的数字,也是用**同一份 route.yaml** 回放出来的,保证 dev 和 test 两列的口径一样(都含 refund 强制回退)。
- `def small_acc(split: str, mode: str) -> float:` 只用替身的准确率。`mode` 是 `category` 或 `all`(四个字段全对)。
- `cal = {(lo, hi): (n, acc) for lo, hi, n, acc in calibration(` 校准表变成字典,键是区间。
- `top_n, top_acc = cal[(0.99, 1.0001)]` 取置信度 0.99 以上那一档的张数和真实准确率,写进「已知局限」。
- `return next(v["sha256"] for k, v in manifest.items() if k.endswith(name))[:12]` 在清单里按文件名后缀找到那一项,取 sha256 的前 12 位。`next(生成器)` 取第一个匹配,JS 里的 `find`。
- `"drop.invalid": dropped["invalid"], "drop.duplicate": dropped["duplicate"], "drop.in_eval": dropped["in_eval_set"],` 模板里能用的键都在这个字典里,键名用点分隔只是为了好读,和字典嵌套没关系。
- `"src.teacher_pct": pct(sources["teacher"] / sum(sources.values())),` 老师模型打的标签占的比例。
- `"test.reasons": "、".join(f"{k} {v} 张" for k, v in sorted(test["reasons"].items())),` 回退原因拼成一句话。
- `return {k: str(v) for k, v in kv.items()}` 所有值统一成字符串,模板替换只认字符串。
- `missing = sorted(set(re.findall(r"\{\{([\w.]+)\}\}", template)) - set(values))` 找出模板里用到、但 `collect` 没提供的键。`findall` 返回所有 `{{...}}` 里的名字,集合相减得到缺的。
- `raise KeyError(f"模板里有 {len(missing)} 个键没有数据来源:{missing}")` **填不上就报错**,不会悄悄留下一个 `{{xxx}}` 或者空白。
- `return re.sub(r"\{\{([\w.]+)\}\}", lambda m: values[m.group(1)], template)` `re.sub` 把每个 `{{键}}` 换成对应的值,第二个参数可以是函数,对每个匹配调用一次。
- `check = "--check" in sys.argv` 命令行里有没有 `--check`。
- `same = target.exists() and target.read_text(encoding="utf-8") == text` 现在的卡和「现在重新填一遍」是不是逐字相同。
- `print(f"{'最新' if same else '过期'}  {card}")` 报告改了、卡没改的话就是「过期」。
- `sys.exit(1 if stale else 0)` 有过期的卡就返回 1,`make check` 会红。

</div>

### 两份模板

模板里手写的文字,是今天最该认真写的东西。先是模型卡。新建 `part10/triage-router/templates/README.md.tpl`,其中最重要的是第二节:**先交代评测的到底是谁**。

```markdown
# triage-router 模型卡(v1)

## 用途

CloudLedger 客服工单分诊:输入工单的主题和正文,输出 `category`、`needs_account_data`、`needs_human`、`urgency` 四个字段的 JSON。
只用在分诊节点。不用来起草回复,不用来做任何涉及金额的判断。

## 现在接的到底是什么(先读这一节)

- **评测里的「小模型」是替身**:Qwen2.5-0.5B-Instruct 加 3 个示例和口径说明 v2,没有训练,在 CPU 上跑。
- **计划中的学生**:Qwen3-4B-Instruct-2507 加 LoRA SFT(r=16,alpha=16,学习率 2e-4,2 个 epoch,见 `config/train.yaml`),要在 Colab 的 GPU 上训。目前没有训,**下面所有评测数字只属于替身,不能算在学生头上**。
- **回退用的大模型**:deepseek-v4-pro,带同一份口径说明 v2,temperature 0。

## 评测

dev {{dev.n}} 张用来选阈值,test {{test.n}} 张只用一次(`reports/test.lock` 锁着)。评测文件指纹见 `MANIFEST.json`(sha256 前 12 位:dev `{{dev.sha}}`,test `{{test.sha}}`)。下面只看 `category` 一个字段;四个字段全对的比例单独列在表后。

| | dev | test |
| --- | --- | --- |
| 只用替身 | {{dev.small_acc}} | {{test.small_acc}} |
| 只用大模型 | {{dev.big_acc}} | {{test.big_k}}/{{test.n}} |
| 级联(阈值 {{t}},refund 强制回退) | {{dev.k}}/{{dev.n}},回退 {{dev.fallback}} | {{test.k}}/{{test.n}},区间 [{{test.lo}}, {{test.hi}}],回退 {{test.fallback}} |
| 元/千张(级联 / 只用大模型) | {{dev.cost}} / {{dev.big_cost}} | {{test.cost}} / {{test.big_cost}} |

替身四个字段全对的比例:dev {{dev.small_acc_all}},test {{test.small_acc_all}}。小模型成本按每张 0.0002 元估(假设),大模型是实测。

## 路由与阈值的选择规则

规则写在 `part10/pick_dev.py`:dev 上准确率不低于「只用大模型」减 {{tol}},满足的阈值里选成本最低的,选出 {{t}}。`config/route.yaml` 里的阈值必须等于这个值,`final_test.py` 会核对。另有一条按风险定的规则:预测为 refund 的一律交给大模型,不看置信度。test 上的回退原因:{{test.reasons}}。

## 已知局限

- 替身的置信度不可靠:dev 上置信度在 0.99 以上的 {{cal.top_n}} 张里只对了 {{cal.top_acc}},0.90 到 0.99 的 {{cal.mid_n}} 张反而对了 {{cal.mid_acc}}。不能把「置信度高」直接当「大概率对」,阈值要靠 dev 实测选。
- test 只有 {{test.n}} 张,区间宽到 [{{test.lo}}, {{test.hi}}],只够说「没发现问题」,不够说「比大模型好」。上灰度前要把 test 扩到上百张。
- 训练好的学生还没有评测数据;换上学生后,这一页的数字要全部重跑、重新出卡。

## 上线与回滚

- 第一阶段 `shadow_mode: true`:小模型只记录,不决定,线上一直用大模型。
- 回滚:`route.yaml` 的 `threshold` 改成 1.01(全部回退到大模型),不用改代码。
- 数据说明见 `DATA_CARD.md`。这份卡里的数字都由 `render_card.py` 从 `reports/` 填进来,手改会在 `make check` 里被发现。
```

<div class="line-notes">

- `## 现在接的到底是什么(先读这一节)` 这一节放在评测数字**前面**,理由在下一条。
- `- **评测里的「小模型」是替身**:Qwen2.5-0.5B-Instruct 加 3 个示例和口径说明 v2,没有训练,在 CPU 上跑。` 说清楚被测的东西是什么。0.5B 的原版模型加几个示例,不是我们要交付的东西。
- `- **计划中的学生**:Qwen3-4B-Instruct-2507 加 LoRA SFT` 真正要交付的学生,配置在 `config/train.yaml`,写明目前**没有训**。 同一行后半句「下面所有评测数字只属于替身,不能算在学生头上」是全卡最重要的一句话。模型卡最容易骗人的地方,是把替身、旧版本、别的模型的数字,放在新模型的名下。读卡的人先看分数、后看说明,所以这句话要先于分数。
- `dev {{dev.n}} 张用来选阈值,test {{test.n}} 张只用一次` `{{dev.n}}`、`{{test.n}}` 是占位符,渲染时换成 50 和 30。 同一行后面把评测集的指纹也写进卡里:`sha256 前 12 位`是 `{{dev.sha}}`、`{{test.sha}}`。哪天有人说「我在 route_test 上测的怎么不一样」,先对指纹。
- `| 只用替身 | {{dev.small_acc}} | {{test.small_acc}} |` 表格里每一格都是占位符。
- `| 级联(阈值 {{t}},refund 强制回退) | {{dev.k}}/{{dev.n}},回退 {{dev.fallback}} | {{test.k}}/{{test.n}},区间 [{{test.lo}}, {{test.hi}}],回退 {{test.fallback}} |` 级联这一行带了区间。30 张的结果不报区间等于隐瞒不确定性。
- `| 元/千张(级联 / 只用大模型) | {{dev.cost}} / {{dev.big_cost}} | {{test.cost}} / {{test.big_cost}} |` 钱放在表里,但要在表后说明小模型成本是假设值。
- `替身四个字段全对的比例:dev {{dev.small_acc_all}},test {{test.small_acc_all}}。` 四个字段全对的比例才 10% 和 13%,和只看 `category` 的 42% 差很远,模型卡把它们都摆出来。
- `规则写在 `part10/pick_dev.py`:dev 上准确率不低于「只用大模型」减 {{tol}}` 阈值的选择规则、容忍线、选出的值,都能追溯。
- `- 替身的置信度不可靠:dev 上置信度在 0.99 以上的 {{cal.top_n}} 张里只对了 {{cal.top_acc}}` **已知局限**:模型卡里最有价值的一节。数字也是填进去的。
- `- test 只有 {{test.n}} 张,区间宽到 [{{test.lo}}, {{test.hi}}],只够说「没发现问题」,不够说「比大模型好」。` 对结论强度的诚实说明。
- `- 训练好的学生还没有评测数据;换上学生后,这一页的数字要全部重跑、重新出卡。` 告诉后来的人下一步该干什么。
- `- 回滚:`route.yaml` 的 `threshold` 改成 1.01(全部回退到大模型),不用改代码。` 回滚是一个配置开关。1.01 大于任何置信度,所以所有请求都回退。
- `手改会在 `make check` 里被发现。` 提醒读卡的人:这张卡是生成的,别手改,要改改模板。

</div>

然后是数据卡。新建 `part10/triage-router/templates/DATA_CARD.md.tpl`:

```markdown
# triage-router 数据卡(v1)

## 来源

训练数据来自 `part10/make_raw_triage.py` 造的一份「像线上导出来的」分诊记录,**不是真实客户数据**:共 {{raw.rows}} 行(`data/raw_triage.jsonl`,sha256 前 12 位 `{{raw.sha}}`),故意带着重复、坏标签和评测题。客户名、联系人、邮箱、客户号都是随机拼出来的虚构值。真实项目里这一节写导出的时间范围、来自哪个系统。

## 清洗

`build_sft_data.py` 依次丢掉:格式不合法的 {{drop.invalid}} 条、和任何评测题指纹相同的 {{drop.in_eval}} 条、重复的 {{drop.duplicate}} 条;每个类别最多留 60 条;再随机切出 10% 当验证集(种子固定,重跑得到同样的文件)。

## 切分

- 训练集 {{train.rows}} 条,sha256 前 12 位 `{{train.sha}}`。
- 验证集 {{val.rows}} 条,sha256 前 12 位 `{{val.sha}}`。
- 评测集合计 {{eval.rows}} 条(tickets_v1、tickets_hard、route_dev、route_test、unlabeled),全部写进 `data/eval_all.jsonl` 当黑名单,`check_leak.py` 查过训练集和验证集里没有任何一条(见 `reports/leak-v1.txt`)。

## 来源构成(清洗后进入训练和验证的)

人工标注 {{src.human}} 条,验证过的 {{src.verified}} 条,老师模型打的 {{src.teacher}} 条(占 {{src.teacher_pct}})。老师打的标签带着老师的系统性错误,占比越高,越要拿有标准答案的样本给老师打分(Day 577)。

## 已知偏差

- 类别不平衡:每类最多 60 条以后,最大类 {{cls.max}} 条,最小类 {{cls.min}} 条。api 只有 {{cls.api}} 条,other 只有 {{cls.other}} 条,这两类训出来多半不稳。
- 数据由有限几个模板拼出来,说法比真实工单单一。换了说法的 tickets_hard 才是更接近真实的考题(Day 574)。
- 全部是中文工单,没有英文和中英混写。

## 隐私

没有真实个人信息。接真实数据时,打标之前先脱敏:手机号、邮箱、客户号、姓名替换成占位符,脱敏脚本要进流水线,不能手工做。
```

<div class="line-notes">

- `训练数据来自 `part10/make_raw_triage.py` 造的一份「像线上导出来的」分诊记录,**不是真实客户数据**` 第一句就交代数据是造的。真实项目这里写导出时间范围和来自哪个系统。 同一行里的 `共 {{raw.rows}} 行` 和原始数据的 sha256 前缀,让别人能核对拿到的是不是同一份。
- ``build_sft_data.py` 依次丢掉:格式不合法的 {{drop.invalid}} 条、和任何评测题指纹相同的 {{drop.in_eval}} 条、重复的 {{drop.duplicate}} 条` 清洗记录。`in_eval` 这个数不是 0 本身就是值得写下来的信息。
- `- 训练集 {{train.rows}} 条,sha256 前 12 位 `{{train.sha}}`。` 训练集的指纹,别人能核对拿到的是不是同一份。
- `评测集合计 {{eval.rows}} 条(tickets_v1、tickets_hard、route_dev、route_test、unlabeled)` 全部评测文件的总数。
- `老师模型打的 {{src.teacher}} 条(占 {{src.teacher_pct}})` 来源构成。这一行回应的是 Day 577 的教训:老师的标签带着老师的系统性错误。
- `- 类别不平衡:每类最多 60 条以后,最大类 {{cls.max}} 条,最小类 {{cls.min}} 条。` 已知偏差,数字是算出来的。
- `- 数据由有限几个模板拼出来,说法比真实工单单一。` 这一条是手写的判断,没有占位符,模板里就应该有这种句子。
- `没有真实个人信息。接真实数据时,打标之前先脱敏` 隐私一节。造出来的数据可以直接这么说,真实数据要写脱敏怎么做的。

</div>

### 出卡、检查

把整条链路收尾:

```bash
make cards
make check
```

```text
uv run python ../render_card.py .
写入 README.md(1575 字符)
写入 DATA_CARD.md(945 字符)
uv run python ../manifest.py verify MANIFEST.json
一致   ../data/raw_triage.jsonl  502 行  ee363a30
一致   ../data/tickets_v1.jsonl  12 行  e5b205c7
一致   ../data/tickets_hard.jsonl  12 行  21168502
一致   ../data/route_dev.jsonl  50 行  6014622d
一致   ../data/route_test.jsonl  30 行  29489c9b
一致   ../data/unlabeled.jsonl  30 行  975ed87c
一致   ../out/triage_train.jsonl  253 行  800933eb
一致   ../out/triage_val.jsonl  28 行  de6191d4
一致   ../data/small-dev.jsonl  50 行  2328be09
一致   ../data/small-test.jsonl  30 行  443ce809
一致   ../data/big-dev.jsonl  50 行  7c1f7deb
一致   ../data/big-test.jsonl  30 行  279ca0f2
全部一致
uv run python ../render_card.py . --check
最新  README.md
最新  DATA_CARD.md
```

两张卡生成出来了。先看模型卡渲染后的样子:

```markdown
# triage-router 模型卡(v1)

## 用途

CloudLedger 客服工单分诊:输入工单的主题和正文,输出 `category`、`needs_account_data`、`needs_human`、`urgency` 四个字段的 JSON。
只用在分诊节点。不用来起草回复,不用来做任何涉及金额的判断。

## 现在接的到底是什么(先读这一节)

- **评测里的「小模型」是替身**:Qwen2.5-0.5B-Instruct 加 3 个示例和口径说明 v2,没有训练,在 CPU 上跑。
- **计划中的学生**:Qwen3-4B-Instruct-2507 加 LoRA SFT(r=16,alpha=16,学习率 2e-4,2 个 epoch,见 `config/train.yaml`),要在 Colab 的 GPU 上训。目前没有训,**下面所有评测数字只属于替身,不能算在学生头上**。
- **回退用的大模型**:deepseek-v4-pro,带同一份口径说明 v2,temperature 0。

## 评测

dev 50 张用来选阈值,test 30 张只用一次(`reports/test.lock` 锁着)。评测文件指纹见 `MANIFEST.json`(sha256 前 12 位:dev `6014622ddb0e`,test `29489c9b2c6b`)。下面只看 `category` 一个字段;四个字段全对的比例单独列在表后。

| | dev | test |
| --- | --- | --- |
| 只用替身 | 42% | 47% |
| 只用大模型 | 96% | 29/30 |
| 级联(阈值 0.85,refund 强制回退) | 48/50,回退 72% | 29/30,区间 [83%, 99%],回退 77% |
| 元/千张(级联 / 只用大模型) | 1.59 / 1.89 | 1.69 / 1.93 |

替身四个字段全对的比例:dev 10%,test 13%。小模型成本按每张 0.0002 元估(假设),大模型是实测。

## 路由与阈值的选择规则

规则写在 `part10/pick_dev.py`:dev 上准确率不低于「只用大模型」减 2%,满足的阈值里选成本最低的,选出 0.85。`config/route.yaml` 里的阈值必须等于这个值,`final_test.py` 会核对。另有一条按风险定的规则:预测为 refund 的一律交给大模型,不看置信度。test 上的回退原因:always_big 4 张、confident 7 张、low_conf 19 张。

## 已知局限

- 替身的置信度不可靠:dev 上置信度在 0.99 以上的 7 张里只对了 71%,0.90 到 0.99 的 9 张反而对了 100%。不能把「置信度高」直接当「大概率对」,阈值要靠 dev 实测选。
- test 只有 30 张,区间宽到 [83%, 99%],只够说「没发现问题」,不够说「比大模型好」。上灰度前要把 test 扩到上百张。
- 训练好的学生还没有评测数据;换上学生后,这一页的数字要全部重跑、重新出卡。

## 上线与回滚

- 第一阶段 `shadow_mode: true`:小模型只记录,不决定,线上一直用大模型。
- 回滚:`route.yaml` 的 `threshold` 改成 1.01(全部回退到大模型),不用改代码。
- 数据说明见 `DATA_CARD.md`。这份卡里的数字都由 `render_card.py` 从 `reports/` 填进来,手改会在 `make check` 里被发现。
```

再看数据卡:

```markdown
# triage-router 数据卡(v1)

## 来源

训练数据来自 `part10/make_raw_triage.py` 造的一份「像线上导出来的」分诊记录,**不是真实客户数据**:共 502 行(`data/raw_triage.jsonl`,sha256 前 12 位 `ee363a30cbf6`),故意带着重复、坏标签和评测题。客户名、联系人、邮箱、客户号都是随机拼出来的虚构值。真实项目里这一节写导出的时间范围、来自哪个系统。

## 清洗

`build_sft_data.py` 依次丢掉:格式不合法的 6 条、和任何评测题指纹相同的 120 条、重复的 10 条;每个类别最多留 60 条;再随机切出 10% 当验证集(种子固定,重跑得到同样的文件)。

## 切分

- 训练集 253 条,sha256 前 12 位 `800933ebf5a2`。
- 验证集 28 条,sha256 前 12 位 `de6191d4d3f3`。
- 评测集合计 134 条(tickets_v1、tickets_hard、route_dev、route_test、unlabeled),全部写进 `data/eval_all.jsonl` 当黑名单,`check_leak.py` 查过训练集和验证集里没有任何一条(见 `reports/leak-v1.txt`)。

## 来源构成(清洗后进入训练和验证的)

人工标注 52 条,验证过的 140 条,老师模型打的 89 条(占 32%)。老师打的标签带着老师的系统性错误,占比越高,越要拿有标准答案的样本给老师打分(Day 577)。

## 已知偏差

- 类别不平衡:每类最多 60 条以后,最大类 60 条,最小类 8 条。api 只有 8 条,other 只有 15 条,这两类训出来多半不稳。
- 数据由有限几个模板拼出来,说法比真实工单单一。换了说法的 tickets_hard 才是更接近真实的考题(Day 574)。
- 全部是中文工单,没有英文和中英混写。

## 隐私

没有真实个人信息。接真实数据时,打标之前先脱敏:手机号、邮箱、客户号、姓名替换成占位符,脱敏脚本要进流水线,不能手工做。
```

两张卡里的每个数字,都能在 `reports/` 或 `MANIFEST.json` 里找到出处,没有一个是我手敲的。试三种出问题的情况。第一种,有人手改了模型卡里的一个数(把「只用替身」dev 的 42% 改成 52%),`make check` 里的第二行会抓到:

```text
过期  README.md
最新  DATA_CARD.md
```

(退出码是 1,`make check` 会失败。我改完马上还原了。)第二种,模板里写了一个没有数据来源的键:

```text
    raise KeyError(f"模板里有 {len(missing)} 个键没有数据来源:{missing}")
KeyError: "模板里有 2 个键没有数据来源:['dev.recall', 'test.f1']"
```

第三种就是上面清单那一节演示过的:数据文件被改,`manifest.py verify` 报「被改过」。把这三道关(清单、锁、卡的新鲜度)都放进 CI,「模型是用什么训的、在什么上测的」就不会再靠记性。

最后把整条链路的命令列一遍,换一台新机器照着跑,就是交付:

```bash
cd part10/triage-router
make dataset      # 数据:去掉所有评测题,查泄漏
make eval         # 替身和大模型各跑 dev,扫阈值,选阈值(第一次要十几分钟)
make final        # test,锁下只跑一次
make MANIFEST.json cards
make check        # 清单对得上,卡没过期
```

### 零件和今天的位置

| 零件 | 在哪学的 | 今天的位置 |
| --- | --- | --- |
| 指纹去重、评测集黑名单 | Day 570 | `build_sft_data.py` 的黑名单换成 `eval_all.jsonl` |
| 泄漏检查 | Day 570 | `check_leak.py` 进了 `make dataset`,不过就停 |
| Wilson 区间 | Day 574 | `final_test.py` 的 `wilson` |
| 老师的口径说明 v2 | Day 577 | `teacher_guide_v2.txt` 是小模型和大模型规则的依赖 |
| 置信度、阈值曲线、校准表 | Day 578 | `sweep.py`、`pick_dev.py`、模型卡的「已知局限」 |
| 只在 test 上跑一次 | Day 578、Day 580 | `final_test.py` 的锁 |
| sha256 | 今天新学 | `manifest.py` 的清单 |
| dataclass | Day 50 | `RouteConfig(frozen=True)` |

## 动手练习

练习都在 `agent-zero-lab` 根目录运行。

1. **给配置加载写测试。** 用 pytest 给 `route_config.py` 写测试:阈值超范围、`always_big` 里有拼错的类别、少了字段,三种坏配置各要抛 `ValueError`;再用参数化测试把 `route()` 的五种情况(有把握、没把握、刚好等于阈值、强制回退类别、解析失败)各测一遍。

<details><summary>参考答案</summary>

测试文件在 `tests/` 里,但被测的 `route_config.py` 在 `part10/`,所以先在 `pyproject.toml` 里告诉 pytest 多去哪找模块([Day 71](/blog/agent-zero/day-071-pytest-1/) 讲过 pytest 的配置)。常见报错是:`ModuleNotFoundError: No module named 'route_config'`,原因是 pytest 只把 `tests/` 放进了导入路径。加上:

```toml
[tool.pytest.ini_options]
pythonpath = ["part10"]
```

新建 `tests/test_route_config.py`:

```python
# agent-zero-lab/tests/test_route_config.py
from pathlib import Path

import pytest
import yaml

from route_config import RouteConfig, load_config, route

GOOD = {"model": "m", "threshold": 0.85, "always_big": ["refund"],
        "fallback": {"model": "big", "on_parse_error": True}, "shadow_mode": True}


def write(tmp_path: Path, **changes: object) -> Path:
    p = tmp_path / "route.yaml"
    p.write_text(yaml.safe_dump({**GOOD, **changes}), encoding="utf-8")
    return p


def small(category: str | None, conf: float) -> dict:
    pred = {"category": category} if category else {}
    return {"pred": pred, "conf": {"category": conf}}


@pytest.fixture
def cfg(tmp_path: Path) -> RouteConfig:
    return load_config(write(tmp_path))


def test_bad_threshold_rejected(tmp_path: Path):
    with pytest.raises(ValueError, match="threshold"):
        load_config(write(tmp_path, threshold=1.5))


def test_unknown_category_rejected(tmp_path: Path):
    with pytest.raises(ValueError, match="always_big"):
        load_config(write(tmp_path, always_big=["refudn"]))


def test_missing_field_rejected(tmp_path: Path):
    p = write(tmp_path)
    p.write_text(p.read_text(encoding="utf-8").replace("shadow_mode: true\n", ""), encoding="utf-8")
    with pytest.raises(ValueError, match="顶层字段"):
        load_config(p)


@pytest.mark.parametrize("category, conf, expected", [
    ("billing", 0.95, ("small", "confident")),
    ("billing", 0.84, ("big", "low_conf")),
    ("billing", 0.85, ("small", "confident")),
    ("refund", 0.999, ("big", "always_big")),
    (None, 0.99, ("big", "parse_error")),
])
def test_route(cfg: RouteConfig, category: str | None, conf: float, expected: tuple[str, str]):
    assert route(cfg, small(category, conf)) == expected
```

<div class="line-notes">

- `import yaml` 测试里要自己造配置文件。
- `GOOD = {"model": "m", "threshold": 0.85, "always_big": ["refund"],` 一份合法配置的字典,每个测试在它的基础上改一处。
- `def write(tmp_path: Path, **changes: object) -> Path:` `tmp_path` 是 pytest 自带的**夹具**(fixture),每个测试得到一个干净的临时目录,测完自动删。`**changes` 接住任意多个关键字参数,用来覆盖 `GOOD` 里的字段。
- `p.write_text(yaml.safe_dump({**GOOD, **changes}), encoding="utf-8")` `{**GOOD, **changes}` 把两个字典合并,后面的覆盖前面的,相当于 JS 的 `{...GOOD, ...changes}`。`safe_dump` 把字典写成 YAML 文本。
- `def small(category: str | None, conf: float) -> dict:` 造一条小模型的输出:预测的类别和置信度。`category` 传 `None` 表示解析失败(空字典)。
- `@pytest.fixture` 把下面这个函数登记成夹具。
- `def cfg(tmp_path: Path) -> RouteConfig:` 夹具可以依赖别的夹具。测试函数的参数里写 `cfg`,pytest 就会调用它并把返回值传进来。
- `with pytest.raises(ValueError, match="threshold"):` 里面的代码必须抛 `ValueError`,而且错误信息里要有 `threshold`。`match` 是正则搜索,防止「因为别的原因抛了同一种异常」也算通过。
- `load_config(write(tmp_path, threshold=1.5))` 阈值 1.5 超过了 1.01 的上限。
- `load_config(write(tmp_path, always_big=["refudn"]))` 类别拼错。
- `p.write_text(p.read_text(encoding="utf-8").replace("shadow_mode: true\n", ""), encoding="utf-8")` 先写一份合法的,再把 `shadow_mode` 那一行删掉,造出「少了字段」。
- `@pytest.mark.parametrize("category, conf, expected", [` **参数化**:同一个测试函数,按下面五组参数跑五次,报告里每组各算一个测试。相当于 jest 的 `test.each`。
- `("billing", 0.85, ("small", "confident")),` 刚好等于阈值,不回退。这条锁住了边界的方向:`<` 而不是 `<=`,以后谁改成 `<=`,这条会变红。
- `("refund", 0.999, ("big", "always_big")),` 置信度再高,强制回退的类别也要走大模型。
- `(None, 0.99, ("big", "parse_error")),` 解析失败的,置信度写多少都没意义,走大模型。

</div>

```bash
uv run pytest tests/test_route_config.py -q
```

```text
........                                                                 [100%]
8 passed in 0.06s
```

八个测试都过。其中那条「刚好等于阈值」是最值得留下的:边界上的 `<` 和 `<=` 是配置类代码最爱出的 bug,线上换阈值时很难察觉,有了这个测试,谁改了方向就会红。

</details>

2. **换阈值,在 dev 上回放。** 保持 `refund` 强制回退,把阈值换成 0.70、0.80、0.85、0.90、0.95、0.99,在 dev 上各回放一遍,列成表。再回答:为什么这张表里 0.90 到 0.99 的准确率完全一样,我们仍然选 0.85?

<details><summary>参考答案</summary>

新建 `part10/replay_sweep.py`:

```python
# agent-zero-lab/part10/replay_sweep.py
"""练习 2:拿 route.yaml 的配置(含 refund 强制回退),只把阈值换成别的,在 dev 上回放,看成本和回退率怎么变。
用法:uv run python part10/replay_sweep.py part10/triage-router/config/route.yaml
"""
import sys
from dataclasses import replace
from pathlib import Path

from route_config import load_config, replay
from sweep import DATA, load

cfg = load_config(Path(sys.argv[1]))
small, big = load(DATA / "small-dev.jsonl"), load(DATA / "big-dev.jsonl")
print(f"{'阈值':>6} {'category 对':>12} {'元/千张':>8} {'回退率':>6}")
for t in (0.70, 0.80, 0.85, 0.90, 0.95, 0.99):
    r = replay(replace(cfg, threshold=t), small, big)
    print(f"{t:>6.2f} {r['correct']:>8}/{r['n']:<3} {r['cost_1k']:>8.2f} {r['fallback']:>6.0%}")
```

<div class="line-notes">

- `from dataclasses import replace` `replace(对象, 字段=新值)` 复制一份 dataclass,只改指定字段。因为 `RouteConfig` 是 frozen 的,不能直接改,只能复制一份新的,这就是 `frozen` 的用法。
- `cfg = load_config(Path(sys.argv[1]))` 读真正的配置,所以 `refund` 强制回退一直在。
- `small, big = load(DATA / "small-dev.jsonl"), load(DATA / "big-dev.jsonl")` 只读 dev。
- `for t in (0.70, 0.80, 0.85, 0.90, 0.95, 0.99):` 六个阈值。
- `r = replay(replace(cfg, threshold=t), small, big)` 每个阈值各回放一遍,不调任何模型。
- `print(f"{t:>6.2f} {r['correct']:>8}/{r['n']:<3} {r['cost_1k']:>8.2f} {r['fallback']:>6.0%}")` `>8` 右对齐占 8 格,`<3` 左对齐占 3 格,`.0%` 百分数不留小数。

</div>

```bash
uv run python part10/replay_sweep.py part10/triage-router/config/route.yaml
```

```text
    阈值   category 对     元/千张    回退率
  0.70       35/50      1.08    46%
  0.80       40/50      1.28    56%
  0.85       48/50      1.59    72%
  0.90       48/50      1.66    76%
  0.95       48/50      1.74    80%
  0.99       48/50      1.83    86%
```

从 0.80 到 0.85,对的张数从 40 跳到 48,是一个陡坡;0.85 之后一直是 48,不再涨,成本却每一档都在涨(1.59、1.66、1.74、1.83)。所以 0.85 是**能拿到全部好处的最低阈值**,往上走只是多花钱。这就是「选阈值」的规则「达标里面选成本最低的」的含义。要提醒的是,50 张的 dev 上的这个「陡坡」落在 0.80 到 0.85 之间,这个位置本身带着抽样的随机性,换一份 dev 可能落在别处。所以上灰度之后要用真实流量重新核对,而不是把 0.85 当成真理。

</details>

3. **加一道锁的检查。** 写 `part10/lock_check.py`:`reports/test.lock` 必须存在,而且里面记的配置哈希必须等于现在的 `route.yaml`,否则退出码非 0。它防的是有人把锁删了重跑 test。分别在正常、改了配置、锁被删三种情况下各跑一次。

<details><summary>参考答案</summary>

新建 `part10/lock_check.py`:

```python
# agent-zero-lab/part10/lock_check.py
"""检查 test 的锁还在,并且锁里记的配置哈希就是现在这份 route.yaml。有人删了锁重跑 test、或者看过 test 又改了配置,这里会报。
用法:uv run python part10/lock_check.py triage-router
"""
import hashlib
import json
import sys
from pathlib import Path

model_dir = Path(sys.argv[1])
lock = model_dir / "reports" / "test.lock"
if not lock.exists():
    sys.exit("锁不见了:要么 test 还没跑过,要么有人删了锁。后者等于这份 test 可以被再用一次。")
recorded = json.loads(lock.read_text(encoding="utf-8"))["config_sha256"]
current = hashlib.sha256((model_dir / "config" / "route.yaml").read_bytes()).hexdigest()
if recorded != current:
    sys.exit(f"route.yaml 在 test 跑完之后改过:锁里 {recorded[:8]},现在 {current[:8]}。")
print(f"锁在,配置哈希一致({current[:8]})")
```

<div class="line-notes">

- `model_dir = Path(sys.argv[1])` 和 `final_test.py` 一样,传 `triage-router` 目录。
- `if not lock.exists():` 锁不存在有两种可能:test 还没跑过(正常),或者有人删了。这个脚本不区分,所以放在 `make check` 里意味着「要出卡就必须先跑过 test」。
- `sys.exit("锁不见了:` `sys.exit` 传字符串:把它打印到标准错误,退出码 1。
- `recorded = json.loads(lock.read_text(encoding="utf-8"))["config_sha256"]` 锁里记的是 test 第一次跑时的配置哈希。
- `current = hashlib.sha256((model_dir / "config" / "route.yaml").read_bytes()).hexdigest()` 现在配置的哈希。算法和 `final_test.py` 里一样,必须一样,否则永远对不上。
- `if recorded != current:` 不一样就说明配置在 test 跑完之后动过。

</div>

```bash
uv run python part10/lock_check.py part10/triage-router
```

三种情况的实跑输出(第二、三次我分别把阈值改成 0.86、把锁文件挪走,跑完还原):

```text
锁在,配置哈希一致(727bdf0f)
```

```text
route.yaml 在 test 跑完之后改过:锁里 727bdf0f,现在 efcabb3a。
```

```text
锁不见了:要么 test 还没跑过,要么有人删了锁。后者等于这份 test 可以被再用一次。
```

要用的话,在 `Makefile` 的 `check` 里再加一行 `$(PY) ../lock_check.py .`。`final_test.py` 管的是「跑的时候拒绝」,`lock_check.py` 管的是「事后审计」,删锁这种事只有事后审计能抓到。

</details>

4. **别解析日志,直接数。** `render_card.py` 靠正则从 `dataset-v1.log` 里抠 `dropped`、`after cap` 这些数,日志格式一变就坏。写 `part10/dataset_stats.py`,用 `build_sft_data.py` 里的 `fingerprint`、`load_eval_blacklist`、`valid`,直接从原始数据和 `out/` 里把同样的数算出来,并和日志里解析的结果对一下,确认一致。

<details><summary>参考答案</summary>

新建 `part10/dataset_stats.py`:

```python
# agent-zero-lab/part10/dataset_stats.py
"""不去解析 build_sft_data.py 打印出来的文字,直接从 train/val 文件和原始数据里数出同样的数字,写成 JSON。
用法:uv run python part10/dataset_stats.py part10/data/raw_triage.jsonl part10/data/eval_all.jsonl part10/out
"""
import ast
import json
import re
import sys
from collections import Counter
from pathlib import Path

from build_sft_data import fingerprint, load_eval_blacklist, valid


def stats(raw: Path, eval_all: Path, out_dir: Path) -> dict:
    black = load_eval_blacklist(eval_all)
    seen: set[str] = set()
    dropped: Counter[str] = Counter()
    for line in raw.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        fp = fingerprint(rec["subject"], rec["body"])
        if not valid(rec):
            dropped["invalid"] += 1
        elif fp in black:
            dropped["in_eval_set"] += 1
        elif fp in seen:
            dropped["duplicate"] += 1
        else:
            seen.add(fp)
    kept: list[dict] = []
    for name in ("train", "val"):
        kept += [json.loads(x) for x in (out_dir / f"triage_{name}.jsonl").read_text(encoding="utf-8").splitlines()]
    return {"dropped": dict(dropped),
            "after_cap": dict(Counter(json.loads(r["messages"][2]["content"])["category"] for r in kept)),
            "sources": dict(Counter(r["source"] for r in kept)),
            "train": sum(1 for _ in (out_dir / "triage_train.jsonl").open(encoding="utf-8")),
            "val": sum(1 for _ in (out_dir / "triage_val.jsonl").open(encoding="utf-8"))}


if __name__ == "__main__":
    s = stats(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
    log = (Path(__file__).parent / "triage-router" / "reports" / "dataset-v1.log").read_text(encoding="utf-8")
    from_log = {
        "dropped": ast.literal_eval(re.search(r"dropped: (\{.*\})", log).group(1)),      # type: ignore[union-attr]
        "after_cap": ast.literal_eval(re.search(r"after cap: (\{.*\})", log).group(1)),  # type: ignore[union-attr]
        "sources": ast.literal_eval(re.search(r"sources: (\{.*\})", log).group(1)),      # type: ignore[union-attr]
    }
    print(json.dumps(s, ensure_ascii=False))
    print("和日志里解析出来的一致:", all(s[k] == from_log[k] for k in from_log))
```

<div class="line-notes">

- `from build_sft_data import fingerprint, load_eval_blacklist, valid` 复用 Day 570 的三个函数。判定「不合法、撞评测集、重复」的口径必须和 `build_sft_data.py` 完全一样,所以不另写一份。
- `black = load_eval_blacklist(eval_all)` 所有评测题的指纹集合。
- `dropped: Counter[str] = Counter()` 每种丢弃原因各多少条。
- `if not valid(rec):` 判断的**顺序**和 `build_sft_data.py` 一样:先不合法,再撞评测集,再重复。顺序不同,同一条记录归到哪一类就会不同,总数对不上。
- `kept += [json.loads(x) for x in (out_dir / f"triage_{name}.jsonl").read_text(encoding="utf-8").splitlines()]` 把 train 和 val 两个文件里的记录读进来。`+=` 对列表是就地追加。
- `"after_cap": dict(Counter(json.loads(r["messages"][2]["content"])["category"] for r in kept)),` 每条样本的第三条消息(assistant)的内容是一段 JSON 字符串,先 `json.loads` 再取类别,数每个类别各多少。
- `"sources": dict(Counter(r["source"] for r in kept)),` 来源构成。训练文件里每行带着 `source` 字段(Day 570 的 `to_messages` 留下的)。
- `"train": sum(1 for _ in (out_dir / "triage_train.jsonl").open(encoding="utf-8")),` 数行数。变量名用下划线表示「不关心每一行的内容」。
- `log = (Path(__file__).parent / "triage-router" / "reports" / "dataset-v1.log").read_text(encoding="utf-8")` 日志文件,按脚本自己的位置找,和当前目录无关。
- `"dropped": ast.literal_eval(re.search(r"dropped: (\{.*\})", log).group(1)),      # type: ignore[union-attr]` 和 `render_card.py` 里一样的解析,用来对照。
- `print("和日志里解析出来的一致:", all(s[k] == from_log[k] for k in from_log))` 三项(丢弃、类别分布、来源)全一致才是 `True`。

</div>

```bash
uv run python part10/dataset_stats.py part10/data/raw_triage.jsonl part10/data/eval_all.jsonl part10/out
```

```text
{"dropped": {"in_eval_set": 120, "invalid": 6, "duplicate": 10}, "after_cap": {"refund": 48, "invoice": 38, "billing": 60, "account": 28, "technical": 60, "api": 8, "other": 15, "plan_change": 24}, "sources": {"teacher": 89, "verified": 140, "human": 52}, "train": 253, "val": 28}
和日志里解析出来的一致: True
```

两边完全一致,所以在这份数据上,正则解析和直接数是同一件事。拿到了这个函数,`render_card.py` 就可以改成直接调 `stats()`,不再依赖日志的排版:以后谁给 `build_sft_data.py` 加了一行打印,卡不会无声地坏。改的时候别忘了在 `Makefile` 里给 `dataset_stats.py` 加依赖。

</details>

5. **开放题:换上训好的学生,要改什么、要重跑什么?** 假设你在 Colab 上训出了一个学生,LoRA 适配器放在手上。只用文字回答:哪些文件要改,哪些命令要重跑,哪些数字会变,哪一步最不能偷懒。

<details><summary>参考答案</summary>

这一题没有实跑,因为本机没有 GPU。答案是推演。

要改的:`config/route.yaml` 的 `model`(改成学生的名字)。`student_run.py` 里加载的是替身,要换成加载「基座加 LoRA」,并且推理时用的**聊天模板和训练时一模一样**(Day 571)、去掉 3 个示例和口径说明(学生已经在训练数据里学过口径了,Day 578 说过)。`config/train.yaml` 的实际训练参数如果和 Colab 里不一致,要同步。

要重跑的:`make dataset`(训练集不变,会直接 `Nothing to be done`,这是好事);`student_run.py` 在 dev 和 test 上重新跑学生(`make` 会因为脚本变了而自动重跑);`make eval` 重新扫阈值、重新选阈值(阈值一定会变,学生的置信度分布和替身完全不同);`make final` 在 test 上用新配置跑,这里有一个问题:test 已经被替身的评测用过一次,锁里的哈希对不上了,`final_test.py` 会拒绝。**这时候对的做法是换一份新的 test**,而不是删锁。

会变的数字:模型卡里所有评测数字、阈值、回退率、成本。数据卡基本不变(除非你补了数据)。

最不能偷懒的一步:换新 test。学生训练时用的 `triage_train.jsonl` 虽然已经避开了所有评测文件,但你在 dev 上看过它的表现、调过阈值,dev 已经被用熟了;而 test 如果还是同一份,它在替身那一轮里已经被「用掉」。新 test 要比这一份大,至少上百张,而且要用 `eval_all.jsonl` 的黑名单重新抽、并重新跑 `make dataset`(黑名单变了,训练集可能要再删几条)。

</details>

验收标准:`make check` 通过(清单全部一致、两张卡都是「最新」);`tests/test_route_config.py` 八个测试全绿;`final_test.py` 在配置变了之后会拒绝;你能不看文章解释清楚:为什么模型卡里「现在接的到底是什么」那一节要放在评测数字前面。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 流水线(pipeline) | 把一串步骤按依赖连起来,每步的输入输出都是文件,重跑一条命令搞定。例:`make dataset` 到 `make check` |
| 清单(manifest) | 记着每个数据文件的路径、行数、sha256 的文件,用来证明文件没被悄悄改过 |
| sha256 | 一种哈希函数,任何输入都得到 64 位十六进制,差一个字节结果完全不同,不能倒推。常用来当文件的指纹 |
| Makefile / make | 用「目标: 依赖」规则描述怎么生成文件的工具,文件没变就不重跑。像带缓存的 npm scripts |
| 目标 / 依赖 / 命令 | Makefile 规则的三部分:要生成的文件、它依赖的文件、生成它的命令(必须以 Tab 开头) |
| 伪目标(`.PHONY`) | 不对应真实文件、只是一组任务名字的目标,如 `check` |
| 模式规则 | 用 `%` 通配的规则,一条规则管 `small-dev.jsonl` 和 `small-test.jsonl` |
| 黑名单(评测集指纹) | 所有评测题的指纹集合。构造训练集时丢掉指纹在名单里的记录,防止评测题进训练集 |
| 泄漏 | 评测集里的题出现在训练集里,测出来的分数虚高。今天实测训练集里混了 69 条 |
| 配置文件(YAML) | 把阈值这类运维参数从代码里拿出来的文件。YAML 用缩进表示层级,可以写注释 |
| 回放(replay) | 对一批已经有结果的数据,按某份配置重新模拟一遍决策。不调模型,试配置是免费的 |
| 锁文件 | 记着「test 已经用过、当时配置的哈希是什么」的文件,配置变了再跑就拒绝 |
| 模型卡(model card) | 说明一个模型是什么、怎么训的、在什么上测的、有什么局限的文档 |
| 数据卡(data card) | 说明训练数据的来源、清洗、构成、偏差和隐私处理的文档 |
| 夹具(fixture) | pytest 里为测试准备环境的函数,如 `tmp_path` 给每个测试一个临时目录 |
| 参数化测试 | 同一个测试函数用多组参数各跑一次,jest 里的 `test.each` |

## 常见误区

**以为评测集和训练集「从来没混过」。** 我们的流水线以前是靠每天各防各的:Day 570 防 `tickets_v1`,Day 578 防另外几份,没有人回头检查训练集里有没有后来才造的评测题。实测 `route_dev` 的 50 张里有 36 张、`route_test` 的 30 张里有 17 张在训练集里。要让**一份黑名单管所有评测文件**,而且生成训练集的下一步自动查泄漏、不过就停。

**Makefile 的命令行用空格缩进。** 报错是 `missing separator.  Stop.`,看起来像语法错,其实就是少了一个 Tab。很多编辑器会把 Tab 悄悄换成空格,在 `Makefile` 里要关掉这个行为。

**用改文件时间代替改内容。** make 只看修改时间,不看内容。`touch`、`git checkout` 切分支、`cp` 还原备份,都会让文件变「新」,触发重跑。重跑本身无害(靠哈希判断的步骤会发现没变),但可能触发一个十几分钟、要花钱的步骤。改之前先用 `make -n` 预览;预览不对,用 `make -t` 把时间戳补回去。

**数字手抄进文档。** 报告里的数一变,文档就成了历史。让脚本从报告里把数填进去,填不上就报错,再加一个 `--check` 在 CI 里抓「过期」。

**模型卡里把替身、旧版本的数字算在新模型头上。** 今天评测的是没训练过的 0.5B 替身加 3 个示例,不是 4B 的学生。卡里要在分数之前写清楚被测的是什么,否则读卡的人只会记住「96%」。

**阈值写进代码、选阈值时碰了 test。** 阈值是运维参数,放配置文件;选阈值只依赖 dev 的文件(`Makefile` 里 `pick` 的依赖里没有任何 test 字样,这是结构上的保证);test 在锁下只跑一次。

## 学习资料

### 文档与文章

- [Model Cards for Model Reporting](https://arxiv.org/abs/1810.03993):模型卡的原始论文,看第 4 节的模板,约 30 分钟。
- [Datasheets for Datasets](https://arxiv.org/abs/1803.09010):数据卡的源头,列了一整套该问数据集的问题,当作数据卡的检查清单很好用。
- [Hugging Face · Model Cards](https://huggingface.co/docs/hub/model-cards) 和 [Dataset Cards](https://huggingface.co/docs/hub/datasets-cards):业内实际在用的卡的格式和元数据字段。
- [GNU Make 手册](https://www.gnu.org/software/make/manual/make.html):权威的文档,有点长,看前两章(规则、写 Makefile)就够。这个站对爬虫返回 403,需要在浏览器里打开。
- [十分钟入门 MakeFile](https://juejin.cn/post/7158286880675463175):中文的入门文章,覆盖规则、默认目标、伪目标和变量。
- [DVC · Data Pipelines](https://dvc.org/doc/start/data-pipelines/data-pipelines):专门做数据版本和流水线的开源工具,思路和今天一样(按内容哈希而不是修改时间判断要不要重跑),项目大了以后可以换它。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1MRMnz1EGW&autoplay=0&high_quality=1" title="LLaMA Factory 微调教程:如何构建高质量数据集?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>code秘密花园 · LLaMA Factory 微调教程:如何构建高质量数据集? · 25 分钟。讲数据集的格式、清洗和质量,对照今天数据卡里「清洗」「来源构成」「已知偏差」三节该写什么。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/FfG-QqRK4cY" title="Makefiles, but in English" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>801Labs · Makefiles, but in English · 用大白话讲 Makefile 的目标、依赖和命令怎么对应,先看这个再看 GNU Make 手册会轻松很多。</figcaption>
</figure>

### 书籍

- Chip Huyen《Designing Machine Learning Systems》(O'Reilly, 2022):讲机器学习系统怎么从实验走到可维护的生产系统,数据版本、可重现性和监控都有专门的章节,和今天的主题最近。
- Chip Huyen《AI Engineering》(O'Reilly, 2025):评测和数据集工程的部分,对照今天的「评测集不能进训练集」和「test 只用一次」。

### 开源项目与代码

- [iterative/dvc](https://github.com/iterative/dvc):数据版本和流水线工具,`dvc.yaml` 描述每一步的输入输出和命令,和今天的 `Makefile` 做的是同一件事。
- [huggingface/huggingface_hub](https://github.com/huggingface/huggingface_hub):里面有生成和读取模型卡的代码(`ModelCard`、`ModelCardData`),想看卡的结构化元数据长什么样,可以读它。

## 自测

1. 为什么清单里要记 sha256,只记行数不行吗?

<details><summary>答案</summary>

行数只能发现多了或少了几行,发现不了「行数不变、内容被改」。今天的实验里,把 `route_test.jsonl` 的一条标准答案改掉,行数仍然是 30,只有 sha256 变了。对评测集来说,悄悄改一条标准答案是最危险的一类改动,所以必须用内容哈希。

</details>

2. `make` 怎么决定一个目标要不要重跑?如果我 `touch` 了一个依赖文件,会发生什么?

<details><summary>答案</summary>

make 比较修改时间:目标不存在,或者比任何一个依赖旧,就执行命令;否则不执行。`touch` 只改修改时间不改内容,依赖变「新」了,下游的目标就会被认为过期而重跑,哪怕内容一个字没变。所以改之前用 `make -n` 预览会重跑什么;预览不对,用 `make -t` 标记为最新。

</details>

3. test 集为什么要靠锁而不是靠自觉?今天的锁具体拒绝哪两种情况?

<details><summary>答案</summary>

自觉在 deadline 前会失灵,「再看一眼」的诱惑太强。锁是代码,不看人的心情。今天的 `final_test.py` 拒绝两种情况:一,`route.yaml` 的阈值和 dev 上选出来的不一致(阈值没有出处);二,锁已经存在、而且锁里记的配置哈希和现在的不同(看过 test 之后又改了配置)。配置没变时重复运行不算多用,直接给上次的结果。

</details>

4. 模型卡里为什么要把「现在接的到底是什么」放在评测数字前面?

<details><summary>答案</summary>

读卡的人先看分数,后看说明。今天评测的是未训练的 0.5B 替身,不是 4B 的学生,如果分数在前、说明在后,「96%」会被记成学生的成绩。把被测对象和「数字只属于替身」放在最前面,是对读者的诚实,也能在出事故时说清楚责任。

</details>

5. (面试题)你交付了一个模型,三个月后线上效果变差,同事要复盘:这个模型是用什么数据训的、评测集是哪份、阈值怎么来的、测试集有没有被偷看。你的流水线怎么让这四个问题的答案都能在十分钟内查到?

<details><summary>答案</summary>

数据:`MANIFEST.json` 记着每个数据文件的行数和 sha256,训练集由固定种子的脚本生成,重跑得到同样的哈希,所以能证明「训练的就是这一份」;数据卡记着来源、清洗掉了多少、来源构成和已知偏差。评测集:同样在清单里有指纹,模型卡里写着评测文件的指纹前缀,并且黑名单是所有评测文件的并集、训练集生成后自动查泄漏。阈值:选阈值的规则写在脚本里、参数和结果写进 `pick-v1.json`,`route.yaml` 的阈值必须等于它,有脚本核对。测试集有没有被偷看:`test.lock` 记着第一次跑 test 时配置的哈希,配置变了再跑会被拒绝,事后还能用 `lock_check.py` 审计锁在不在、哈希对不对。另外两张卡的数字都由脚本从报告里填,`make check` 保证卡没过期,所以复盘时翻卡看到的就是当时的数字。

</details>

## 明天预告

Day 583 · 平台(一):什么时候该做平台,平台给什么,租户是谁。今天我们把一个模型的交付整理成了流水线和两张卡。等 SupportPilot 和这个路由小模型在公司里跑顺了,别的团队一定会来要同样的东西,而这些团队共用同一套基础设施时会出问题:修复要改好几份、账单拆不开、数据串租户。明天从「现在真的到时候了吗」讲起。
