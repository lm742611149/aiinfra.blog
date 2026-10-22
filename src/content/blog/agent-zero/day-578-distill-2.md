---
title: 'Day 578 · 蒸馏(二):置信度和阈值曲线,其他路由方式'
description: '小模型总有判断不准的工单,怎么知道这一张它拿不准、该交给大模型?今天从逐 token 的 logprob 里算出分诊置信度,让本机 CPU 上的 0.5B 小模型和 DeepSeek V4 Pro 各判 80 张工单,扫一遍阈值画出准确率和成本的取舍曲线,看校准表发现最自信的那一桶反而不是最准的,按事先写好的规则在 dev 上选阈值、到 test 上只验一次,最后看看规则路由和学出来的路由器。'
pubDate: 2026-10-22
regime: none
tags: ['distillation', 'routing', 'cascade', 'logprobs', 'calibration', 'agent-zero']
series: 'agent-zero'
day: 578
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 577](/blog/agent-zero/day-577-distill-1/) 我们让 DeepSeek V4 Pro 当老师,给 30 张工单各打三次标签,三票一致才收,又拿藏起来的标准答案给老师打分,发现老师会「一致地错」:自一致性只挡随机错,挡不住口径没写清造成的系统性错误。最后从 `config.json` 算出了 0.6B、1.7B、4B 三个候选学生的显存和并发账。

学生训出来以后还有一个躲不开的问题:它总会有判断不准的工单。全部交给它,错的那部分直接流到客户面前;全部交给大模型,又白训了。中间的办法是**级联**:小模型先判,它有把握就用它的结果,没把握就交给大模型。今天解决两件事:怎么知道小模型「这一张有没有把握」,以及「有把握」的线画在哪。

## 今天要解决的问题

学完今天你应该能做到:

1. 从模型返回的逐 token logprob 里,算出 JSON 某个字段「取这个值」的概率,当作**置信度**,写出 `confidence.py`;知道 vLLM 和 DeepSeek API 拿 logprob 时各有什么坑。
2. 用同一批工单的小模型结果和大模型结果,离线扫一遍置信度阈值,算出每个阈值下的准确率、成本和回退率,画出取舍曲线;用**校准表**检查置信度靠不靠谱;按事先写好的规则在 dev 上选阈值,在 test 上只验证一次。
3. 说出除了置信度级联,还有哪些路由方式(规则、学出来的路由器),各自的长处和代价。

预计用时 3 小时。前置:[Day 110](/blog/agent-zero/day-110-sampling-1/)(logprob、softmax)、[Day 112](/blog/agent-zero/day-112-sampling-2/)(用 API 拿 logprobs)、[Day 354](/blog/agent-zero/day-354-testset-size/)(开发集和留出集)、[Day 570](/blog/agent-zero/day-570-finetune-1/)(`build_sft_data.py`、`raw_triage.jsonl`)、[Day 574](/blog/agent-zero/day-574-finetune-3/)(对比脚本、`tickets_hard`)、[Day 576](/blog/agent-zero/day-576-dpo-2/)(`part10/dpo-cpu/` 环境)、[Day 577](/blog/agent-zero/day-577-distill-1/)(`teacher_guide_v2.txt`)。

先说清楚哪些是真跑的。蒸馏出来的学生要 GPU 训练,我没有,所以今天的「小模型」是一个**替身**:Day 576 那个本机 CPU 上能跑的 Qwen2.5-0.5B-Instruct,加 Day 574 的 3 个示例和 Day 577 的 v2 口径说明,不做任何训练。它比真正训过的学生差得多,但置信度、阈值、校准这套方法一模一样,换成训好的学生只需要换模型。CPU 上它判一张工单要 13 秒左右(中位数),80 张跑了二十多分钟;在 GPU 上的 vLLM 里这是几十毫秒的事,所以今天的延迟数字不能拿来比。大模型那一路是 DeepSeek V4 Pro,80 张花了约 0.16 元;路由器实跑回退了 4 张,不到 1 分钱;最后一个小实验用 DeepSeek flash 当「线上小模型」试接口,两次按上限算约 0.05 元。全天约 0.22 元,算式在验收标准里。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`confidence.py` 的 `field_confidence` 和 `sweep.py` 的 `sweep`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 置信度从哪来

[Day 110](/blog/agent-zero/day-110-sampling-1/) 讲过,模型每写一个 token,都是先给词表里每个 token 一个概率,再从中挑一个。挑中的那个 token 的概率取对数,就是这个 token 的 **logprob**(对数概率),它总是小于等于 0,越接近 0 越有把握:logprob 是 −0.01 意味着概率 99%,−0.69 意味着概率约 50%。

分诊的输出是一段 JSON,我们关心的不是每个 token,而是「`category` 这个字段取 `invoice`」这件事的概率。字段的值可能被切成好几个 token,它的概率就是这几个 token 的概率相乘;换成对数,就是 logprob 相加,最后取 `exp` 变回概率。这个概率就当作模型对这个字段的**置信度**:它自己觉得这个答案有多大把握。

先看看 Qwen2.5 的分词器把一段分诊 JSON 切成什么样(在 `part10/dpo-cpu/` 里用 `AutoTokenizer` 切的,Day 576 装好的环境):

```text
['{"', 'category', '":', ' "', 'plan', '_change', '",', ' "', 'needs', '_account', '_data', '":', ' true', ',', ' "', 'needs', '_human', '":', ' false', ',', ' "', 'urg', 'ency', '":', ' "', 'normal', '"}']
```

三件事要注意。`plan_change` 被切成了 `plan` 和 `_change` 两个 token,值不一定是一个 token。` true` 前面带着空格,token 和字符不是一一对应的。`'",'` 这种 token 把引号和逗号粘在了一起。所以不能假设「第几个 token 就是 category 的值」,得按**字符位置**去找:先在拼起来的整段文字里找到值的起止位置,再看哪些 token 和这段位置有重叠,把它们的 logprob 加起来。

新建 `part10/confidence.py`:

```python
# agent-zero-lab/part10/confidence.py
"""从逐 token 的 logprob 里算出 JSON 某个字段「取这个值」的概率,当作置信度。
输入的 tokens / logprobs 和 vLLM、OpenAI 兼容接口 logprobs=True 返回的一样:两个等长的列表。
"""
import json
import math
import re

KEYS = ("category", "needs_account_data", "needs_human", "urgency")


def field_confidence(tokens: list[str], logprobs: list[float], field: str) -> float:
    text = "".join(tokens)
    m = re.search(rf'"{field}"\s*:\s*"?([a-z_]+)', text)
    if not m:
        return 0.0
    start, end = m.span(1)
    pos, total = 0, 0.0
    for tok, lp in zip(tokens, logprobs):
        tok_start, tok_end = pos, pos + len(tok)
        if tok_end > start and tok_start < end:
            total += lp
        pos = tok_end
    return math.exp(total)


def triage_confidence(tokens: list[str], logprobs: list[float]) -> dict[str, float]:
    conf = {k: field_confidence(tokens, logprobs, k) for k in KEYS}
    conf["min"] = min(conf.values())
    return conf


def parse_triage(text: str) -> dict | None:
    s = text.strip()
    if s.startswith("`"):
        s = s.strip("`").removeprefix("json").strip()
    try:
        ans = json.loads(s)
    except json.JSONDecodeError:
        return None
    return ans if isinstance(ans, dict) else None


if __name__ == "__main__":
    toks = ['{"', 'category', '":', ' "', 'plan', '_change', '",', ' "', 'urg', 'ency', '":', ' "', 'normal', '"}']
    lps = [0.0, 0.0, 0.0, 0.0, -0.69, -0.01, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -0.22, 0.0]
    print("category:", round(field_confidence(toks, lps, "category"), 3))
    print("urgency: ", round(field_confidence(toks, lps, "urgency"), 3))
    print("api:     ", field_confidence(toks, lps, "api"))
```

<div class="line-notes">

- `KEYS = ("category", "needs_account_data", "needs_human", "urgency")` 分诊的四个字段,和 Day 570 `build_sft_data.py` 里的一样。放在这里是因为下面几个脚本都要用,而 dpo-cpu 那个环境里不方便导入别的东西。
- `text = "".join(tokens)` 把所有 token 拼回完整的输出文字,`"".join` 相当于 JS 的 `tokens.join("")`。
- `m = re.search(rf'"{field}"\s*:\s*"?([a-z_]+)', text)` `rf''` 是同时带 `r`(反斜杠不转义)和 `f`(能插变量)的字符串。正则找 `"category"` 加冒号,后面可能有引号(布尔值没有),再捕获一串小写字母和下划线,就是值。代入 `field="category"`,在上面的文字里捕获到 `plan_change`。
- `start, end = m.span(1)` 第 1 个捕获组在整段文字里的起止下标(含头不含尾)。`{"category": "plan_change"` 里 `plan_change` 从第 14 个字符开始、第 25 个结束。
- `pos, total = 0, 0.0` `pos` 记录当前 token 在整段文字里的起点,`total` 累加 logprob。
- `tok_start, tok_end = pos, pos + len(tok)` 这个 token 占的字符区间。
- `if tok_end > start and tok_start < end:` 两个区间有重叠的标准写法。`plan`(14–18)和 `_change`(18–25)都重叠;`'",'`(25–27)从 25 开始,不算重叠,所以引号的 logprob 不会混进来。
- `return math.exp(total)` logprob 相加再取 exp,等于这几个 token 的概率相乘。演示数据里 −0.69 + (−0.01) = −0.70,exp(−0.70) ≈ 0.497。
- `conf["min"] = min(conf.values())` 四个字段里最低的那个。要「四个字段都对」才算对时,最没把握的那个字段决定了整张工单有多可靠。
- `def parse_triage(text: str) -> dict | None:` 把模型输出解析成字典。有的模型会套一层 ```` ```json ```` 代码块,先剥掉。线上用的时候宽容一点,能救一条是一条。
- `return ans if isinstance(ans, dict) else None` 解析出列表或数字也当失败处理。
- `print("api:     ", field_confidence(toks, lps, "api"))` 输出里没有这个字段,正则找不到,返回 0.0。找不到字段就当完全没把握,这样后面的路由会把它交给大模型。

</div>

```bash
cd agent-zero-lab
uv run python part10/confidence.py
```

```text
category: 0.497
urgency:  0.803
api:      0.0
```

`plan_change` 两个 token 的概率分别是 exp(−0.69) ≈ 0.50 和 exp(−0.01) ≈ 0.99,乘起来 0.497。值的第一个 token 几乎决定了一切,后面的 token 往往接近 1:模型一旦写下 `plan`,后面接 `_change` 就没什么悬念了。

## 第一步:准备 dev 和 test

扫阈值要一批有标准答案的工单,而且要分成两份:**dev**(开发集)用来扫阈值、选工作点,**test**(留出集)只在最后用一次,报告最终效果。[Day 354](/blog/agent-zero/day-354-testset-size/) 讲过为什么:拿同一份数据既选参数又报结果,数字一定偏乐观。

数据还是从 Day 570 的 `raw_triage.jsonl` 里抽,要避开两份评测集,也要避开 Day 577 给老师打分用过的那 30 张。新建 `part10/make_route_eval.py`:

```python
# agent-zero-lab/part10/make_route_eval.py
"""给路由实验抽一份带标准答案的工单:50 张 dev(用来选阈值)、30 张 test(最后只用一次)。
用法:uv run python part10/make_route_eval.py
"""
import json
import random
from collections import Counter
from pathlib import Path

from build_sft_data import fingerprint, load_eval_blacklist, valid

DATA = Path(__file__).parent / "data"
random.seed(578)

black = load_eval_blacklist(DATA / "tickets_v1.jsonl") | load_eval_blacklist(DATA / "tickets_hard.jsonl")
black |= load_eval_blacklist(DATA / "unlabeled.jsonl")
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

picked = random.sample(pool, 80)
for name, prefix, part in (("route_dev", "D", picked[:50]), ("route_test", "T", picked[50:])):
    with open(DATA / f"{name}.jsonl", "w", encoding="utf-8") as f:
        for i, rec in enumerate(part):
            row = {"id": f"{prefix}{i + 1:03d}", "subject": rec["subject"],
                   "body": rec["body"], "expected": rec["triage"]}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(name, len(part), dict(Counter(r["triage"]["category"] for r in part)))
```

<div class="line-notes">

- `from build_sft_data import fingerprint, load_eval_blacklist, valid` 三个都是 Day 570 写的,Day 577 的 `make_unlabeled.py` 用法一样。
- `random.seed(578)` 固定种子,你跑出来的 80 张和我的一样。
- `black |= load_eval_blacklist(DATA / "unlabeled.jsonl")` `|=` 是「并进来」,相当于 `black = black | ...`。`load_eval_blacklist` 只读 `subject` 和 `body`,所以 Day 577 那份没标签的文件也能直接当黑名单。
- `picked = random.sample(pool, 80)` 不重复地抽 80 张,前 50 当 dev,后 30 当 test。
- `for name, prefix, part in (("route_dev", "D", picked[:50]), ("route_test", "T", picked[50:])):` 一次循环写一个文件。`picked[:50]` 和 `picked[50:]` 是切片,相当于 JS 的 `slice(0, 50)` 和 `slice(50)`。
- `row = {"id": f"{prefix}{i + 1:03d}", "subject": rec["subject"],` 编号 D001…D050、T001…T030。`:03d` 补零到三位。
- `"body": rec["body"], "expected": rec["triage"]}` 标准答案放在 `expected` 里,格式和 Day 574 的 `tickets_hard.jsonl` 一样。
- `print(name, len(part), dict(Counter(r["triage"]["category"] for r in part)))` 看每份里各类别有几张,太偏的话阈值选出来不可靠。

</div>

```bash
uv run python part10/make_route_eval.py
```

```text
route_dev 50 {'technical': 13, 'refund': 4, 'invoice': 5, 'billing': 14, 'other': 4, 'account': 5, 'plan_change': 3, 'api': 2}
route_test 30 {'invoice': 4, 'technical': 8, 'billing': 9, 'account': 2, 'refund': 4, 'other': 1, 'plan_change': 2}
```

test 里没有 api,refund 和 plan_change 也只有个位数。30 张的 test 只够看一个大概,[Day 574](/blog/agent-zero/day-574-finetune-3/) 算过 30 张的区间有多宽,真实项目里这两份都该上百张。

## 第二步:两路各跑一遍

级联要的数据是:同一张工单,小模型判成什么、置信度多少、对不对;大模型判成什么、对不对、花了多少钱。两路**各自对每一张都跑一遍**,存下来,之后改阈值就是纯计算,不用再调模型。

### 小模型那一路

小模型在 Day 576 建的 `part10/dpo-cpu/` 里跑,那个环境装了 torch 2.2.2 和 transformers。新建 `part10/dpo-cpu/student_run.py`:

```python
# agent-zero-lab/part10/dpo-cpu/student_run.py
"""学生替身:本机 CPU 上的 Qwen2.5-0.5B-Instruct 加 3 个示例做分诊,逐条记下答案、每个 token 的 logprob、置信度和对错。
用法(在 part10/dpo-cpu 目录):uv run python student_run.py ../data/route_dev.jsonl
"""
import json
import sys
import time
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from build_sft_data import SYSTEM                      # noqa: E402
from confidence import KEYS, parse_triage, triage_confidence  # noqa: E402

BASE = "Qwen/Qwen2.5-0.5B-Instruct"
SHOTS = [   # 和 Day 574 prompt_first.py 里的 3 个示例一样
    ("被重复扣款了", "同一笔 199 元扣了两次。",
     {"category": "billing", "needs_account_data": True, "needs_human": True, "urgency": "high"}),
    ("怎么加子账号", "想给财务同事开一个只读的子账号。",
     {"category": "account", "needs_account_data": False, "needs_human": False, "urgency": "low"}),
    ("退款多久到账", "上周申请的退款还没到账。",
     {"category": "refund", "needs_account_data": True, "needs_human": False, "urgency": "low"}),
]
GUIDE = (Path(__file__).resolve().parent.parent / "teacher_guide_v2.txt").read_text(encoding="utf-8")
torch.manual_seed(0)
tok = AutoTokenizer.from_pretrained(BASE)
model = AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.float32)
model.eval()


def messages(subject: str, body: str) -> list[dict]:
    msgs = [{"role": "system", "content": SYSTEM + GUIDE}]
    for s, b, ans in SHOTS:
        msgs.append({"role": "user", "content": f"主题:{s}\n正文:{b}"})
        msgs.append({"role": "assistant", "content": json.dumps(ans, ensure_ascii=False)})
    msgs.append({"role": "user", "content": f"主题:{subject}\n正文:{body}"})
    return msgs


@torch.no_grad()
def run(case: dict) -> dict:
    t0 = time.perf_counter()
    prompt = tok.apply_chat_template(messages(case["subject"], case["body"]), tokenize=False, add_generation_prompt=True)
    ids = tok(prompt, return_tensors="pt")
    out = model.generate(**ids, max_new_tokens=60, do_sample=False,
                         output_scores=True, return_dict_in_generate=True)
    new = out.sequences[0, ids["input_ids"].shape[1]:]
    lps = model.compute_transition_scores(out.sequences, out.scores, normalize_logits=True)[0]
    tokens = [tok.decode([int(t)]) for t in new]
    logprobs = [float(x) for x in lps]
    pred = parse_triage(tok.decode(new, skip_special_tokens=True)) or {}
    conf = triage_confidence(tokens, logprobs)
    fields = {k: pred.get(k) == case["expected"][k] for k in KEYS}
    return {"id": case["id"], "subject": case["subject"], "pred": pred, "expected": case["expected"],
            "fields": fields, "correct": all(fields.values()), "conf": conf,
            "tokens": tokens, "logprobs": logprobs, "ms": round((time.perf_counter() - t0) * 1000)}


if __name__ == "__main__":
    src = Path(sys.argv[1])
    cases = [json.loads(x) for x in src.read_text(encoding="utf-8").splitlines() if x.strip()]
    dst = src.parent / f"small-{src.stem.removeprefix('route_')}.jsonl"
    with open(dst, "w", encoding="utf-8") as f:
        for c in cases:
            r = run(c)
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            print(f"{r['id']} {r['subject']:<10} {'对' if r['correct'] else '错'}  min={r['conf']['min']:.3f}  "
                  f"cat={r['conf']['category']:.3f}  {r['ms']}ms")
    print("写入", dst)
```

<div class="line-notes">

- `sys.path.insert(0, str(Path(__file__).resolve().parent.parent))` 把上一级 `part10/` 放进导入路径,才能导入 `build_sft_data.py` 和 `confidence.py`。Day 576 的 `regress_check.py` 用过同一招。
- `from build_sft_data import SYSTEM                      # noqa: E402` 和学生训练、老师打标用的同一段 system。`# noqa: E402` 告诉代码检查工具「导入写在了别的语句后面,我是故意的」。
- `SHOTS = [   # 和 Day 574 prompt_first.py 里的 3 个示例一样` 没有直接从 `prompt_first.py` 导入,因为那个文件一导入就会去读 `.env`、建 OpenAI client,而 dpo-cpu 环境当时没装 `python-dotenv`,第一次跑时我就撞上了 `ModuleNotFoundError: No module named 'dotenv'`。
- `GUIDE = (Path(__file__).resolve().parent.parent / "teacher_guide_v2.txt").read_text(encoding="utf-8")` Day 577 的 v2 口径说明。替身没训练过,不给口径它连类别边界都不知道。真正训好的学生不需要这段,口径已经在训练数据里了。
- `model = AutoModelForCausalLM.from_pretrained(BASE, dtype=torch.float32)` CPU 上用 32 位浮点,和 Day 576 一样。第一次跑会用 Day 576 下载好的权重。
- `@torch.no_grad()` 装饰器([Day 51](/blog/agent-zero/day-051-decorators/) 学过装饰器):这个函数里不记录梯度,只推理不训练,省内存也快一点。
- `prompt = tok.apply_chat_template(messages(case["subject"], case["body"]), tokenize=False, add_generation_prompt=True)` 按 Qwen 的对话模板把消息拼成一段文字,结尾加上「轮到 assistant 说话」的标记。
- `out = model.generate(**ids, max_new_tokens=60, do_sample=False,` `do_sample=False` 是贪心解码,每一步都挑概率最高的 token,和线上 `temperature=0` 一个意思。
- `output_scores=True, return_dict_in_generate=True)` 让 `generate` 把每一步的打分也带回来,不加这两个参数只返回 token 编号。
- `new = out.sequences[0, ids["input_ids"].shape[1]:]` 返回的序列包括输入,切掉前面输入那么长的部分,剩下的才是新生成的。
- `lps = model.compute_transition_scores(out.sequences, out.scores, normalize_logits=True)[0]` 把每一步的分数换成「被选中的那个 token 的 logprob」。`normalize_logits=True` 先做 log-softmax,保证得到的是对数概率。这一行做的事,就是 vLLM 或 API 里 `logprobs=True` 替你做的事。
- `tokens = [tok.decode([int(t)]) for t in new]` 每个 token 单独解码成文字,得到和 API 返回一样格式的 token 列表。
- `pred = parse_triage(tok.decode(new, skip_special_tokens=True)) or {}` 整段解码、解析。解析失败给空字典,后面每个字段都算错。
- `conf = triage_confidence(tokens, logprobs)` 四个字段各自的置信度加上 `min`。
- `fields = {k: pred.get(k) == case["expected"][k] for k in KEYS}` 逐字段对不对。
- `"tokens": tokens, "logprobs": logprobs, "ms": round((time.perf_counter() - t0) * 1000)}` 原始的 token 和 logprob 也存下来,以后想换一种置信度算法(比如四个字段相乘而不是取最小)不用重跑模型。
- `dst = src.parent / f"small-{src.stem.removeprefix('route_')}.jsonl"` `route_dev.jsonl` 的结果写到 `small-dev.jsonl`。`removeprefix` 去掉开头的 `route_`。

</div>

```bash
cd part10/dpo-cpu
HF_HUB_OFFLINE=1 uv run python student_run.py ../data/route_dev.jsonl
HF_HUB_OFFLINE=1 uv run python student_run.py ../data/route_test.jsonl
cd ../..
```

`HF_HUB_OFFLINE=1` 是 Day 576 讲过的:权重已经下载过,别再联网检查。实跑输出的开头几行(dev):

```text
The following generation flags are not valid and may be ignored: ['temperature', 'top_p', 'top_k']. Set `TRANSFORMERS_VERBOSITY=info` for more details.
D001 页面打不开      错  min=0.220  cat=0.220  29058ms
D002 退款多久到账     错  min=0.766  cat=0.945  34234ms
D003 发票抬头写错了    错  min=0.516  cat=0.998  32198ms
D004 账单金额看不懂    错  min=0.518  cat=0.799  26324ms
D005 同步银行流水失败   错  min=0.582  cat=0.704  9266ms
```

第一行警告是因为 Qwen 的 `generation_config.json` 里写了默认的 temperature、top_p、top_k,而我们用贪心解码,这些参数用不上,可以忽略。中间的「对/错」看的是四个字段全对,`cat=` 是 category 的置信度。前几张一张 30 秒左右,是因为我跑的时候机器上还有别的进程在抢 CPU,后面稳定在 10 秒上下;dev 50 张的中位数是 13.3 秒。

挑一张看清楚置信度是怎么来的。D004「账单金额看不懂」,标准答案 billing,替身判成了 invoice。它生成的 token 和 logprob(从 `small-dev.jsonl` 里取出来,保留三位):

```text
('{"', -0.001), ('category', -0.001), ('":', -0.0), (' "', -0.005), ('invoice', -0.224), ('",', -0.004), ...
(' false', -0.519), ... (' true', -0.658), ... ('normal', -0.19), ('"}', -0.003), ('<|im_end|>', -0.0)
```

`invoice` 是一个 token,logprob −0.224,exp(−0.224) ≈ 0.799,就是上面那行的 `cat=0.799`。它有八成把握,但判错了。`needs_human` 的 ` true` 是 −0.658,概率 0.518,四个字段里最低,所以 `min=0.518`。

### 大模型那一路

新建 `part10/big_run.py`,在主项目里跑:

```python
# agent-zero-lab/part10/big_run.py
"""大模型那一路:同一份工单交给 DeepSeek(带 v2 口径说明),逐条记下答案、对错、花了多少钱。
用法:uv run python part10/big_run.py part10/data/route_dev.jsonl
"""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from build_sft_data import SYSTEM
from confidence import KEYS, parse_triage

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))
MODEL = os.environ.get("BIG_MODEL", "deepseek-v4-pro")
PRICE = {"deepseek-v4-pro": (0.3, 9, 27), "deepseek-flash": (0.04, 2, 8)}[MODEL]
GUIDE = (Path(__file__).parent / "teacher_guide_v2.txt").read_text(encoding="utf-8")


def run(case: dict) -> dict:
    t0 = time.perf_counter()
    resp = client.chat.completions.create(
        model=MODEL, temperature=0, max_tokens=100, extra_body=EXTRA,
        response_format={"type": "json_object"},
        messages=[{"role": "system", "content": SYSTEM + GUIDE},
                  {"role": "user", "content": f"主题:{case['subject']}\n正文:{case['body']}"}])
    u = resp.usage
    assert u is not None
    hit = getattr(u, "prompt_cache_hit_tokens", 0) or 0
    cost = (hit * PRICE[0] + (u.prompt_tokens - hit) * PRICE[1] + u.completion_tokens * PRICE[2]) / 1e6
    pred = parse_triage(resp.choices[0].message.content or "") or {}
    fields = {k: pred.get(k) == case["expected"][k] for k in KEYS}
    return {"id": case["id"], "pred": pred, "fields": fields, "correct": all(fields.values()),
            "cost": cost, "ms": round((time.perf_counter() - t0) * 1000)}


if __name__ == "__main__":
    src = Path(sys.argv[1])
    cases = [json.loads(x) for x in src.read_text(encoding="utf-8").splitlines() if x.strip()]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(run, cases))
    dst = src.parent / f"big-{src.stem.removeprefix('route_')}.jsonl"
    dst.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in results), encoding="utf-8")
    cat = sum(r["fields"]["category"] for r in results)
    exact = sum(r["correct"] for r in results)
    total = sum(r["cost"] for r in results)
    print(f"{MODEL}: category 对 {cat}/{len(results)},四字段全对 {exact}/{len(results)},"
          f"共 ¥{total:.4f},每张 ¥{total / len(results):.5f}")
```

<div class="line-notes">

- `MODEL = os.environ.get("BIG_MODEL", "deepseek-v4-pro")` 大模型默认用 Day 577 的老师。线上的大模型通常就是你本来在用的那个,级联是在它前面加一层小模型。
- `PRICE = {"deepseek-v4-pro": (0.3, 9, 27), "deepseek-flash": (0.04, 2, 8)}[MODEL]` 和 Day 577 一样的高峰价,元每百万 token:命中、未命中、输出。
- `GUIDE = (Path(__file__).parent / "teacher_guide_v2.txt").read_text(encoding="utf-8")` 大模型也给 v2 口径。两路的口径要一样,否则比的不是模型而是说明书。
- `model=MODEL, temperature=0, max_tokens=100, extra_body=EXTRA,` 线上分诊用温度 0,要稳定。`EXTRA` 关掉思考模式。
- `response_format={"type": "json_object"},` 大模型开 JSON mode,我们只关心它判得对不对。
- `hit = getattr(u, "prompt_cache_hit_tokens", 0) or 0` DeepSeek 额外返回的缓存命中 token 数,Day 577 讲过。
- `cost = (hit * PRICE[0] + (u.prompt_tokens - hit) * PRICE[1] + u.completion_tokens * PRICE[2]) / 1e6` 这一张实际花了多少钱,级联省多少钱就是从这里算出来的。
- `return {"id": case["id"], "pred": pred, "fields": fields, "correct": all(fields.values()),` 字段名和 `student_run.py` 的输出对齐,后面的 `sweep.py` 两边用同一套键。

</div>

```bash
uv run python part10/big_run.py part10/data/route_dev.jsonl
uv run python part10/big_run.py part10/data/route_test.jsonl
```

```text
deepseek-v4-pro: category 对 48/50,四字段全对 33/50,共 ¥0.0979,每张 ¥0.00196
deepseek-v4-pro: category 对 29/30,四字段全对 19/30,共 ¥0.0587,每张 ¥0.00196
```

category 50 张对 48 张,四字段全对只有 33 张。四字段全对太难了,今天的实验**只看 category**:分诊里最要紧的是「这张工单该进哪个队列」,这一步错了后面全错。四个字段的版本放在练习 1,你会看到为什么在一个没训过的替身上做不下去。

## 第三步:扫阈值,画取舍曲线

规则很简单:置信度不低于阈值 t,用小模型的答案;低于 t,回退大模型。对每个候选的 t,在 dev 上把 50 张都过一遍,算三个数:

- **准确率**:最终答案对的比例;
- **成本**:每张都要先付一次小模型的钱,回退的再付一次大模型的钱;
- **回退率**:被交给大模型的比例。

小模型的钱怎么算?自部署的学生按卡费摊,和你的机器、吞吐有关,今天我没有真实的卡可测,先**假设**每张 0.0002 元(大模型的十分之一左右),写成一个常量,练习 3 会改它看结论怎么变。

新建 `part10/sweep.py`:

```python
# agent-zero-lab/part10/sweep.py
"""扫置信度阈值:「小模型先判,置信度不够就回退大模型」在每个阈值下的准确率、成本、回退率。
纯离线计算,改阈值不用重新调模型。
用法:uv run python part10/sweep.py dev            # 只看 category
      uv run python part10/sweep.py dev all        # 四个字段全对才算对,置信度取四个字段里最低的
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).parent / "data"
SMALL_COST = 0.0002     # 假设:自部署学生每张 ¥0.0002,换成你自己的卡费
THRESHOLDS = [0.0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1.01]


def load(path: Path) -> dict[str, dict]:
    return {r["id"]: r for r in map(json.loads, path.read_text(encoding="utf-8").splitlines())}


def view(small: dict, big: dict, mode: str) -> list[tuple[bool, float, bool, float]]:
    """每张工单变成 (小模型对不对, 小模型置信度, 大模型对不对, 大模型花费)。"""
    rows = []
    for i in sorted(small):
        s, b = small[i], big[i]
        if mode == "all":
            rows.append((s["correct"], s["conf"]["min"], b["correct"], b["cost"]))
        else:
            rows.append((s["fields"]["category"], s["conf"]["category"], b["fields"]["category"], b["cost"]))
    return rows


def sweep(rows: list[tuple[bool, float, bool, float]], thresholds: list[float]) -> list[dict]:
    out = []
    for t in thresholds:
        correct = cost = fallback = 0.0
        for s_ok, conf, b_ok, b_cost in rows:
            cost += SMALL_COST
            if conf >= t:
                correct += s_ok
            else:
                fallback += 1
                correct += b_ok
                cost += b_cost
        n = len(rows)
        out.append({"t": t, "acc": correct / n, "cost_1k": 1000 * cost / n, "fallback": fallback / n})
    return out


def calibration(rows: list[tuple[bool, float, bool, float]],
                bins: tuple[float, ...] = (0.0, 0.5, 0.7, 0.9, 0.99, 1.0001)) -> list[tuple[float, float, int, float]]:
    out = []
    for lo, hi in zip(bins, bins[1:]):
        xs = [(ok, c) for ok, c, _, _ in rows if lo <= c < hi]
        if xs:
            out.append((lo, hi, len(xs), sum(ok for ok, _ in xs) / len(xs)))
    return out


if __name__ == "__main__":
    split = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "category"
    rows = view(load(DATA / f"small-{split}.jsonl"), load(DATA / f"big-{split}.jsonl"), mode)
    n = len(rows)
    big_acc = sum(b for _, _, b, _ in rows) / n
    big_cost = 1000 * sum(c for *_, c in rows) / n
    print(f"{split} {n} 张,看 {mode}")
    print(f"只用小模型: acc={sum(s for s, *_ in rows) / n:.3f}  元/千张={1000 * SMALL_COST:.2f}")
    print(f"只用大模型: acc={big_acc:.3f}  元/千张={big_cost:.2f}")
    print(f"{'阈值':>6}{'准确率':>8}{'元/千张':>9}{'回退率':>8}")
    for r in sweep(rows, THRESHOLDS):
        print(f"{r['t']:>6.2f}{r['acc']:>9.3f}{r['cost_1k']:>10.2f}{r['fallback']:>9.0%}")
    print("置信度校准(区间, 张数, 小模型真实准确率):")
    for lo, hi, k, acc in calibration(rows):
        print(f"  [{lo:.2f}, {min(hi, 1.0):.2f})  n={k:<3} acc={acc:.2f}")
```

<div class="line-notes">

- `SMALL_COST = 0.0002     # 假设:自部署学生每张 ¥0.0002,换成你自己的卡费` 这是今天唯一一个拍的数,明确写成假设。别的数字全来自实跑文件。
- `THRESHOLDS = [0.0, 0.5, 0.7, 0.8, 0.9, 0.95, 0.99, 1.01]` 阈值 0 等于全用小模型(置信度总是 ≥ 0);1.01 等于全部回退(置信度不可能 ≥ 1.01)。两头放进来,曲线的两个端点就有了。
- `return {r["id"]: r for r in map(json.loads, path.read_text(encoding="utf-8").splitlines())}` 读 JSONL,按编号建字典,两路结果靠编号对齐。
- `def view(small: dict, big: dict, mode: str) -> list[tuple[bool, float, bool, float]]:` 把两份文件压成一张四列的表,后面的函数只认这四列,不管它是看 category 还是看四个字段。
- `for i in sorted(small):` 按编号顺序遍历,输出稳定。
- `rows.append((s["fields"]["category"], s["conf"]["category"], b["fields"]["category"], b["cost"]))` 默认模式:对错只看 category,置信度用 category 的。
- `cost += SMALL_COST` 每一张都先跑小模型,不管后面回不回退,这份钱都要付。
- `if conf >= t:` 置信度够,用小模型的答案,它对就加 1。`correct += s_ok` 布尔值加到浮点数上,`True` 算 1。
- `cost += b_cost` 回退的这张再付一次大模型的钱。所以「全部回退」比「只用大模型」还贵一点:多付了每张小模型的钱。
- `out.append({"t": t, "acc": correct / n, "cost_1k": 1000 * cost / n, "fallback": fallback / n})` 成本换算成「每千张多少元」,数字好读。
- `def calibration(rows: list[tuple[bool, float, bool, float]],` 校准表:按置信度分桶,看每个桶里小模型的真实准确率。
- `bins: tuple[float, ...] = (0.0, 0.5, 0.7, 0.9, 0.99, 1.0001)) -> list[tuple[float, float, int, float]]:` 桶的边界。最后一个写 1.0001,是为了让置信度正好等于 1.0 的也能落进最后一桶(区间是左闭右开)。
- `for lo, hi in zip(bins, bins[1:]):` 相邻两个边界配成一对:(0, 0.5)、(0.5, 0.7)……`zip` 相当于把两个数组按位置拉链式配对。
- `xs = [(ok, c) for ok, c, _, _ in rows if lo <= c < hi]` 落在这个桶里的那些行。`lo <= c < hi` 是 Python 的连写比较,等于 `lo <= c and c < hi`。
- `big_cost = 1000 * sum(c for *_, c in rows) / n` `*_, c` 是「前面的都不要,只取最后一个」,相当于 JS 的 `row.at(-1)`。
- `print(f"  [{lo:.2f}, {min(hi, 1.0):.2f})  n={k:<3} acc={acc:.2f}")` 打印时把 1.0001 显示成 1.00。

</div>

```bash
uv run python part10/sweep.py dev
```

实跑输出:

```text
dev 50 张,看 category
只用小模型: acc=0.480  元/千张=0.20
只用大模型: acc=0.960  元/千张=1.96
    阈值     准确率     元/千张     回退率
  0.00    0.480      0.20       0%
  0.50    0.680      0.91      36%
  0.70    0.780      1.11      46%
  0.80    0.820      1.19      50%
  0.90    0.960      1.54      68%
  0.95    0.960      1.74      78%
  0.99    0.960      1.89      86%
  1.01    0.960      2.16     100%
置信度校准(区间, 张数, 小模型真实准确率):
  [0.00, 0.50)  n=18  acc=0.44
  [0.50, 0.70)  n=5   acc=0.00
  [0.70, 0.90)  n=11  acc=0.18
  [0.90, 0.99)  n=9   acc=1.00
  [0.99, 1.00)  n=7   acc=0.71
```

先看两头:替身单独用只有 48% 的 category 对,大模型单独用 96%。替身确实很差,这在意料之中,它没训过。

再看中间。阈值从 0 提到 0.9,准确率从 0.48 一路涨到 0.96,追平了大模型,成本从每千张 0.20 元涨到 1.54 元,比只用大模型的 1.96 元便宜 21%。再往上提,准确率不再涨,只是越来越贵,到 1.01(全部回退)是 2.16 元,比只用大模型还贵 0.20 元,这 0.20 元就是白付的小模型钱。

把这 8 个点画出来:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="dev 上实测的成本与准确率取舍曲线,8 个阈值点">
<line x1="70" y1="250" x2="610" y2="250" stroke="var(--rule)" stroke-width="1.5"/>
<line x1="70" y1="250" x2="70" y2="30" stroke="var(--rule)" stroke-width="1.5"/>
<text x="340" y="285" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="middle">每千张成本(元)→  0 到 2.2</text>
<text x="28" y="140" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="middle" transform="rotate(-90 28 140)">category 准确率 0.4 到 1.0</text>
<line x1="70" y1="61" x2="610" y2="61" stroke="var(--compute)" stroke-dasharray="4 4"/>
<text x="605" y="76" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="end">容忍线 0.94</text>
<polyline points="117,222 285,152 332,117 351,103 434,54 481,54 517,54 581,54" fill="none" stroke="var(--mem)" stroke-width="2"/>
<g fill="var(--mem)">
<circle cx="117" cy="222" r="4"/><circle cx="285" cy="152" r="4"/><circle cx="332" cy="117" r="4"/><circle cx="351" cy="103" r="4"/>
<circle cx="481" cy="54" r="4"/><circle cx="517" cy="54" r="4"/><circle cx="581" cy="54" r="4"/>
</g>
<circle cx="434" cy="54" r="7" fill="var(--compute)"/>
<rect x="528" y="49" width="10" height="10" fill="none" stroke="var(--ink)"/>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<text x="125" y="238">t=0  0.48 / 0.20</text>
<text x="293" y="168">t=0.5</text>
<text x="300" y="112">t=0.7</text>
<text x="360" y="118">t=0.8</text>
<text x="380" y="40">t=0.9  0.96 / 1.54</text>
<text x="545" y="40">只用大模型</text>
<text x="560" y="96" text-anchor="middle">t=1.01</text>
</g>
</svg>
<figcaption>`sweep.py dev` 的实测数据。蓝点是各个阈值,琥珀色大点是 t=0.9,方框是「只用大模型」(0.96,1.96 元)。曲线先陡后平:前半段多付一点钱换来大幅提升,过了 0.9 就是只花钱不涨分。</figcaption>
</figure>

这条线的形状就是级联要的东西:**先陡后平**。前半段每多回退一些工单,准确率涨得飞快;过了拐点,再多回退只是在付钱。工作点就选在拐点附近。但今天这个拐点有一个让人不太舒服的地方:回退率 68%,三分之二的工单还是交给了大模型。原因就在下面的校准表里。

## 第四步:校准表,置信度靠得住吗

阈值能起作用,前提是「置信度高的更可能是对的」。**校准**说的就是这件事:如果模型说「我有 90% 把握」的那些判断,真的大约 90% 是对的,它就是校准良好的。检查办法就是 `calibration()` 打印的那张表:按置信度分桶,看每个桶里的真实准确率。理想情况下,准确率应该随着置信度一桶比一桶高。

再看一遍实测的表:

```text
  [0.00, 0.50)  n=18  acc=0.44
  [0.50, 0.70)  n=5   acc=0.00
  [0.70, 0.90)  n=11  acc=0.18
  [0.90, 0.99)  n=9   acc=1.00
  [0.99, 1.00)  n=7   acc=0.71
```

它一点都不单调。置信度最低的那一桶(0 到 0.5)对了 44%,反而比 0.5 到 0.9 的两桶好得多;最自信的那一桶(0.99 以上)只对 71%,不如 0.9 到 0.99 那一桶的 100%。

把每张按「替身说的类别」拆开看,原因就清楚了(这是练习 2 脚本的前半段输出):

```text
小模型说的类别  说了几次  其中对的
  invoice         28       5
  account          8       5
  refund           4       4
  technical        3       3
  plan_change      3       3
  api              2       2
  billing          2       2
```

50 张里替身说了 28 次 invoice,只对了 5 次。它对 invoice 有一种偏好,把很多 billing 和 technical 都塞了进去,而且塞的时候常常有七八成把握。0.7 到 0.9 那一桶里几乎全是这种「自信的 invoice」。反过来,它说 technical 和 api 的时候置信度只有 0.2 到 0.36,却每次都对:它在这几类上很犹豫,但答案是对的。

最自信那一桶里错的两张是 D033 和 D050,都是「有没有发票模板」,替身判 invoice,置信度 0.996,标准答案是 other。这两张 DeepSeek V4 Pro 也判成了 invoice,标准答案的口径本身值得商量(问模板算不算开票?),不过这正是 Day 577 说的系统性错误:模型很确定,只是和你的口径不一样。置信度量的是模型自己有多确定,它不知道你的口径。

所以校准表要告诉你两件事。第一,阈值能不能用:今天在 0.9 这个位置,上面两桶加起来 16 张对了 14 张,下面的桶都很差,在 0.9 切一刀确实把好的和坏的分开了,只是代价是 68% 的回退。第二,问题出在哪:不是「小模型总体不行」,是「它在 invoice 上自信地犯错」。这就指向了改进方向,要么把 invoice 相关的样本补进训练数据重训,要么像练习 2 那样加一条规则。

微调过的小模型过度自信很常见。常见的对策有两个:一是**温度缩放**(temperature scaling),在一份验证集上拟合一个温度 T,把所有 logit 除以 T 再算概率,让概率整体变得没那么极端,Guo 等人 2017 年的论文《On Calibration of Modern Neural Networks》就是讲这个的;二是不信置信度的绝对数值,只拿它来排序,阈值完全按扫描结果定,今天就是这么做的。温度缩放只能把概率整体拉伸或压缩,改变不了排序,所以「invoice 自信地错」这种问题它治不了。

## 第五步:按规则选阈值,test 上只验一次

看了曲线,很容易「顺手」挑一个好看的点。正确的做法是**先写下选择规则,再看数据**,否则你总能给看中的那个点编出理由。今天的规则:

> 准确率不低于「只用大模型」减 2 个百分点,满足的阈值里选成本最低的。

这里的 2 个百分点是你和业务方事先商量的**容忍线**:愿意为了省钱让准确率最多掉多少。规则在 dev 上执行,选出来的阈值拿到 test 上跑**一次**,报告 test 的数字。新建 `part10/pick_threshold.py`:

```python
# agent-zero-lab/part10/pick_threshold.py
"""按事先写好的规则在 dev 上选阈值,再到 test 上只验证一次。
规则:准确率不低于「只用大模型」减 TOLERANCE,满足的阈值里选成本最低的。
用法:uv run python part10/pick_threshold.py [category|all]
"""
import sys

from sweep import DATA, load, sweep, view

TOLERANCE = 0.02
GRID = [i / 20 for i in range(20)] + [0.97, 0.99, 1.01]


def pick(rows: list[tuple[bool, float, bool, float]]) -> dict:
    big_acc = sum(b for _, _, b, _ in rows) / len(rows)
    ok = [r for r in sweep(rows, GRID) if r["acc"] >= big_acc - TOLERANCE]
    return min(ok, key=lambda r: (r["cost_1k"], -r["t"]))


mode = sys.argv[1] if len(sys.argv) > 1 else "category"
dev = view(load(DATA / "small-dev.jsonl"), load(DATA / "big-dev.jsonl"), mode)
test = view(load(DATA / "small-test.jsonl"), load(DATA / "big-test.jsonl"), mode)
best = pick(dev)
print(f"dev 选出: 阈值 {best['t']:.2f}  准确率 {best['acc']:.3f}  元/千张 {best['cost_1k']:.2f}  回退率 {best['fallback']:.0%}")
r = sweep(test, [best["t"]])[0]
big_acc = sum(b for _, _, b, _ in test) / len(test)
print(f"test 验证: 阈值 {r['t']:.2f}  准确率 {r['acc']:.3f}(只用大模型 {big_acc:.3f})  "
      f"元/千张 {r['cost_1k']:.2f}  回退率 {r['fallback']:.0%}")
```

<div class="line-notes">

- `from sweep import DATA, load, sweep, view` 直接复用 `sweep.py` 的函数。`sweep.py` 的主程序在 `if __name__ == "__main__":` 里,导入时不会执行。
- `TOLERANCE = 0.02` 容忍线:最多比只用大模型低 2 个百分点。这个数写在代码最上面,是「事先写好」的意思,不是看完结果再调。
- `GRID = [i / 20 for i in range(20)] + [0.97, 0.99, 1.01]` 比 `sweep.py` 更密的网格:0、0.05、0.10……0.95,再加几个高位的点。列表用 `+` 拼接,相当于 JS 的 `[...a, ...b]`。
- `ok = [r for r in sweep(rows, GRID) if r["acc"] >= big_acc - TOLERANCE]` 先筛出所有达标的阈值。1.01(全部回退)的准确率就等于大模型,所以 `ok` 至少有一个元素,不会是空的。
- `return min(ok, key=lambda r: (r["cost_1k"], -r["t"]))` 达标的里面挑成本最低的。`key` 返回一个元组,先比成本,成本一样时 `-r["t"]` 让阈值高的优先(更保守)。[Day 30](/blog/agent-zero/day-030-lambda/) 学过 `lambda`。
- `test = view(load(DATA / "small-test.jsonl"), load(DATA / "big-test.jsonl"), mode)` test 的数据读进来,但下面只用一次,只跑选出来的那一个阈值。
- `r = sweep(test, [best["t"]])[0]` 在 test 上只评估这一个阈值,不扫,不挑。

</div>

```bash
uv run python part10/pick_threshold.py
```

```text
dev 选出: 阈值 0.85  准确率 0.960  元/千张 1.46  回退率 64%
test 验证: 阈值 0.85  准确率 0.967(只用大模型 0.967)  元/千张 1.46  回退率 63%
```

网格更密以后,规则在 dev 上选中的是 0.85,不是上面表里的 0.9:0.85 的准确率同样是 0.96,每千张便宜 0.08 元。拿到 test 上跑一次,准确率 0.967,和只用大模型一样(30 张里错的都是同一张),成本每千张 1.46 元,比只用大模型的 1.96 元省 26%,回退率 63%,和 dev 上的 64% 很接近。

dev 和 test 对得上,说明这个阈值不是碰巧在 dev 上好看。但别忘了 test 只有 30 张,0.967 和 0.933 之间只差一张。这个数够你判断「方法能用」,不够你向业务方承诺「准确率不会掉」;真要上线,test 要上百张,[Day 574](/blog/agent-zero/day-574-finetune-3/) 的 `how_many_cases.py` 算过要多少。

## 接进线上:路由器

离线扫完阈值,线上的路由器就是把那条规则写成代码。为了今天能真跑,我把它放在 `part10/dpo-cpu/` 里,直接调替身和 `big_run.py`;线上换成 vLLM 只需要把 `student_run.run` 换成一次 HTTP 请求(下一小节)。

`big_run.py` 要用 `openai` 和 `python-dotenv`,dpo-cpu 环境里还没有,先装上:

```bash
cd part10/dpo-cpu
uv add openai python-dotenv
```

新建 `part10/dpo-cpu/router.py`:

```python
# agent-zero-lab/part10/dpo-cpu/router.py
"""分诊路由:小模型先判,category 置信度够就用它的结果,不够就回退大模型;refund 一律交给大模型。
用法(在 part10/dpo-cpu 目录):uv run python router.py ../data/route_test.jsonl 6
"""
import json
import os
import sys
import time
from pathlib import Path

import student_run
from big_run import run as big_run     # student_run 已经把 part10/ 加进了导入路径

THRESHOLD = float(os.environ.get("TRIAGE_THRESHOLD", "0.85"))
ALWAYS_BIG = {"refund"}
SMALL_COST = 0.0002


def decide(category: str | None, conf: float, threshold: float) -> str:
    if category is None or category in ALWAYS_BIG:
        return "big"
    return "small" if conf >= threshold else "big"


def triage(case: dict) -> dict:
    t0 = time.perf_counter()
    s = student_run.run(case)
    route = decide(s["pred"].get("category"), s["conf"]["category"], THRESHOLD)
    if route == "small":
        result, cost = s["pred"], SMALL_COST
    else:
        b = big_run(case)
        result, cost = b["pred"], SMALL_COST + b["cost"]
    ok = result.get("category") == case["expected"]["category"]
    return {"id": case["id"], "route": route, "conf": round(s["conf"]["category"], 3),
            "small_says": s["pred"].get("category"), "final": result.get("category"), "ok": ok,
            "cost": cost, "ms": round((time.perf_counter() - t0) * 1000)}


if __name__ == "__main__":
    cases = [json.loads(x) for x in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() if x.strip()]
    for case in cases[: int(sys.argv[2])]:
        print(json.dumps(triage(case), ensure_ascii=False))
```

<div class="line-notes">

- `import student_run` 导入时会加载 0.5B 模型(模块顶层那几行),要十几秒。
- `from big_run import run as big_run     # student_run 已经把 part10/ 加进了导入路径` `student_run.py` 第一件事就是 `sys.path.insert` 上一级目录,所以这里能导入 `part10/big_run.py`。`as` 起个别名,免得和本文件的名字混。
- `THRESHOLD = float(os.environ.get("TRIAGE_THRESHOLD", "0.85"))` 阈值从环境变量读,上线后调阈值不用改代码。默认 0.85 就是上一步按规则在 dev 上选出来的。
- `ALWAYS_BIG = {"refund"}` 一条规则:小模型说是 refund 的,不管多有把握,一律交给大模型。退款错了要赔钱,这种高风险类别宁可多花一点。这就是下面要讲的「规则路由」,和置信度叠在一起用。
- `if category is None or category in ALWAYS_BIG:` 小模型没给出类别(输出坏了)也回退。
- `return "small" if conf >= threshold else "big"` 和 `sweep.py` 里的判断一模一样。离线模拟和线上代码用同一条规则,离线算出来的回退率才能在线上复现。
- `result, cost = b["pred"], SMALL_COST + b["cost"]` 回退的那张付两次钱。
- `return {"id": case["id"], "route": route, "conf": round(s["conf"]["category"], 3),` `route` 和 `conf` 一定要记下来,真实系统里要写进 trace([Day 365](/blog/agent-zero/day-365-langfuse-1/) 的 Langfuse metadata),上线后才能统计回退率和回退的都是哪类工单。

</div>

```bash
HF_HUB_OFFLINE=1 uv run python router.py ../data/route_test.jsonl 6
```

```text
{"id": "T001", "route": "small", "conf": 0.998, "small_says": "invoice", "final": "invoice", "ok": true, "cost": 0.0002, "ms": 18405}
{"id": "T002", "route": "big", "conf": 0.695, "small_says": "invoice", "final": "technical", "ok": true, "cost": 0.0021848, "ms": 15676}
{"id": "T003", "route": "big", "conf": 0.819, "small_says": "invoice", "final": "billing", "ok": true, "cost": 0.0021758, "ms": 11484}
{"id": "T004", "route": "big", "conf": 0.23, "small_says": "technical", "final": "technical", "ok": true, "cost": 0.0021218, "ms": 22606}
{"id": "T005", "route": "big", "conf": 0.698, "small_says": "invoice", "final": "technical", "ok": true, "cost": 0.0021848, "ms": 11021}
{"id": "T006", "route": "small", "conf": 0.985, "small_says": "account", "final": "account", "ok": true, "cost": 0.0002, "ms": 14451}
```

(第一行之前还有一行 transformers 关于 generation flags 的警告,和上面一样,这里省掉了。)

6 张里 2 张留给了小模型,4 张回退,最后 6 张全对。T002、T003、T005 是校准表里说的那种情况:替身判 invoice,置信度 0.7 到 0.8,被阈值挡下,大模型改判成 technical 和 billing。T004 替身其实判对了(technical),只是置信度 0.23 太低,也回退了,这一张的大模型钱是「替身不够自信」的代价。

`ms` 那一列全是十几秒,几乎都是 CPU 上替身花的时间;回退那几张多出来的大模型调用只占一秒左右。

### 线上的小模型:logprobs=True 和一个坑

线上的学生跑在 vLLM 里,置信度要从接口拿。OpenAI 兼容接口的写法是在请求里加 `logprobs=True`,返回的 `choices[0].logprobs.content` 是一个列表,每项有 `token` 和 `logprob`,正好是 `triage_confidence` 要的两个列表。新建 `part10/small_api.py`(在主项目里):

```python
# agent-zero-lab/part10/small_api.py
"""小模型那一路的「线上版」:走 OpenAI 兼容接口,打开 logprobs=True,拿回逐 token 的 logprob 算置信度。
接 vLLM 就把 SMALL_BASE_URL 指向 vLLM(如 http://localhost:8000/v1),SMALL_MODEL 写挂上去的 LoRA 名。
用法:SMALL_BASE_URL=https://api.deepseek.com SMALL_MODEL=deepseek-flash uv run python part10/small_api.py part10/data/route_dev.jsonl
"""
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

from build_sft_data import SYSTEM
from confidence import KEYS, parse_triage, triage_confidence

load_dotenv()
SMALL = OpenAI(base_url=os.environ["SMALL_BASE_URL"], api_key=os.environ.get("SMALL_API_KEY", os.environ["LLM_API_KEY"]))
SMALL_MODEL = os.environ["SMALL_MODEL"]
TEMPERATURE = float(os.environ.get("SMALL_TEMPERATURE", "0"))
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))


def small(case: dict) -> dict:
    t0 = time.perf_counter()
    resp = SMALL.chat.completions.create(
        model=SMALL_MODEL, temperature=TEMPERATURE, max_tokens=100, logprobs=True, extra_body=EXTRA,
        messages=[{"role": "system", "content": SYSTEM},
                  {"role": "user", "content": f"主题:{case['subject']}\n正文:{case['body']}"}])
    choice = resp.choices[0]
    content = choice.logprobs.content if choice.logprobs and choice.logprobs.content else []
    tokens = [c.token for c in content]
    logprobs = [c.logprob for c in content]
    pred = parse_triage(choice.message.content or "") or {}
    fields = {k: pred.get(k) == case["expected"][k] for k in KEYS}
    return {"id": case["id"], "subject": case["subject"], "pred": pred, "expected": case["expected"],
            "fields": fields, "correct": all(fields.values()), "conf": triage_confidence(tokens, logprobs),
            "tokens": tokens, "logprobs": logprobs, "ms": round((time.perf_counter() - t0) * 1000)}


if __name__ == "__main__":
    src = Path(sys.argv[1])
    cases = [json.loads(x) for x in src.read_text(encoding="utf-8").splitlines() if x.strip()]
    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(small, cases))
    dst = src.parent / f"small-{SMALL_MODEL}-{src.stem.removeprefix('route_')}.jsonl"
    dst.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
    ok = sum(r["fields"]["category"] for r in rows)
    confs = sorted(round(r["conf"]["category"], 3) for r in rows)
    print(f"{SMALL_MODEL}: category 对 {ok}/{len(rows)},置信度最低的 5 个 {confs[:5]},写入 {dst.name}")
```

<div class="line-notes">

- `SMALL = OpenAI(base_url=os.environ["SMALL_BASE_URL"], api_key=os.environ.get("SMALL_API_KEY", os.environ["LLM_API_KEY"]))` 小模型和大模型是两个 client,地址不同。vLLM 一般不要 key 或用自己设的 key;今天指向 DeepSeek 做实验,没设 `SMALL_API_KEY` 就借用大模型的。
- `TEMPERATURE = float(os.environ.get("SMALL_TEMPERATURE", "0"))` 温度可以从外面改,下面的坑就是它。
- `model=SMALL_MODEL, temperature=TEMPERATURE, max_tokens=100, logprobs=True, extra_body=EXTRA,` 关键是 `logprobs=True`。不需要 `top_logprobs`,我们只要被选中的那个 token 的概率。
- `content = choice.logprobs.content if choice.logprobs and choice.logprobs.content else []` 没开 logprobs 或服务端不支持时,`choice.logprobs` 是 `None`,给空列表兜底,置信度就全是 0,所有工单都会回退,不会出错但会很贵。
- `tokens = [c.token for c in content]` 和 `student_run.py` 产出的格式完全一样,所以 `triage_confidence` 两边通用。
- `dst = src.parent / f"small-{SMALL_MODEL}-{src.stem.removeprefix('route_')}.jsonl"` 文件名带上模型名,不会覆盖替身的 `small-dev.jsonl`。

</div>

我手上没有 vLLM 服务,这个脚本没有对 vLLM 实跑。但它走的是 OpenAI 兼容接口,我把它指向 DeepSeek,拿 flash 当「小模型」试了一下:

```bash
SMALL_BASE_URL=https://api.deepseek.com SMALL_MODEL=deepseek-flash uv run python part10/small_api.py part10/data/route_dev.jsonl
```

```text
deepseek-flash: category 对 48/50,置信度最低的 5 个 [1.0, 1.0, 1.0, 1.0, 1.0],写入 small-deepseek-flash-dev.jsonl
```

50 张的置信度全是 1.0。打开文件看第一张的 logprob:

```text
['{"', 'category', '":"', 'technical', '","', 'ne', 'eds', '_account', '_data', '":', 'true', ',"'] [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
```

每个 token 的 logprob 都是 0.0。原因是 `temperature=0`:DeepSeek 返回的 logprob 是按**用了温度之后**的分布算的,温度 0 等于贪心,被选中的 token 概率是 1,logprob 当然是 0。[Day 577](/blog/agent-zero/day-577-distill-1/) 的 `soft_labels.py` 用 1.0 温度,就是为了拿到原始的概率。改成温度 1.0 再跑:

```bash
SMALL_TEMPERATURE=1 SMALL_BASE_URL=https://api.deepseek.com SMALL_MODEL=deepseek-flash uv run python part10/small_api.py part10/data/route_dev.jsonl
```

```text
deepseek-flash: category 对 48/50,置信度最低的 5 个 [0.945, 0.947, 0.983, 0.997, 0.998],写入 small-deepseek-flash-dev.jsonl
```

这回有数了,但还是挤在 0.95 以上,错的那两张(又是 D033 和 D050,「有没有发票模板」)category 置信度都是 1.0。大模型的分布太尖,在 category 上几乎不犹豫,用它的置信度做级联没什么区分度。练习 4 会看它四个字段的校准。

vLLM 这边不用担心温度 0 的问题。我查了 vLLM 文档,它有一个 `logprobs_mode` 配置,默认是 `"raw_logprobs"`,文档写明 raw 指的是「在任何 logit 处理之前」的值,温度、top_k、top_p 都算处理。也就是说 vLLM 默认返回的是原始概率,`temperature=0` 生成、同时拿原始 logprob,两不耽误;不放心的话,上线前像今天这样打印几条看看是不是全 0。另外 vLLM 的 `max_logprobs` 默认是 20,只影响 `top_logprobs` 最多要几个,今天用不到。

## 其他路由方式

用小模型自己的置信度做级联是最简单的一种,但不是唯一的。资料里你还会看到两类。

**规则路由**。按工单本身的特征写规则:提到退款或扣款的、金额超过一定数目的、大客户的、带附件的,直接走大模型。听起来土,很多线上系统第一版就是这样,好处是可解释、好调试,出了问题一眼能看出为什么走了这条路。今天 `router.py` 里的 `ALWAYS_BIG = {"refund"}` 就是一条规则,只不过它看的是小模型的输出而不是工单原文。校准表里发现替身在 invoice 上自信地犯错,也可以写成一条规则:「小模型说 invoice 就回退」,练习 2 会量一量它值不值。

**学出来的路由器**。单独训练一个很小的分类器,输入是请求,输出是「小模型能不能搞定这一单」的概率,超过阈值就交给小模型。它的好处是不需要先跑一遍小模型,判断很快;坏处是要多维护一个模型和它的训练数据,而且训练数据本身就要靠今天这种「两路都跑一遍、看谁对」的实验来造。LMSYS 在 2024 年的 RouteLLM 论文里用人类偏好数据(Chatbot Arena 的对战结果)训练了几种这样的路由器,在强弱两个模型之间分流,开源在 `lm-sys/RouteLLM`。更早的 FrugalGPT 论文(2023)讲的是另一种级联:依次调用由便宜到贵的模型,每次用一个打分模型判断这个回答够不够好,够好就停。

工程里通常是组合着用:规则先拦住明确的高风险情况,剩下的走置信度级联,上线后盯着两个数,回退率和人工改判率。回退率突然涨了,多半是来了一批新类型的工单(新功能上线、促销活动),这时候该做的是把这批工单打标、补进训练数据重训学生,而不是调阈值。

### 零件和大代码的对照

| 零件 | 在哪学的 | 今天的位置 |
| --- | --- | --- |
| logprob 和 softmax | Day 110 | `confidence.py` 的 `math.exp(total)` |
| API 的 `logprobs`、温度对 logprob 的影响 | Day 112、Day 577 | `small_api.py`、温度 0 那个坑 |
| 正则捕获组和 `span` | Day 26 | `field_confidence` 的 `re.search`、`m.span(1)` |
| 指纹去重、评测集黑名单 | Day 570 | `make_route_eval.py` |
| CPU 上跑 0.5B 模型 | Day 576 | `student_run.py` |
| 线程池并发调 API | Day 577 | `big_run.py`、`small_api.py` |
| 开发集和留出集 | Day 354 | `pick_threshold.py` 只在 test 上跑一次 |
| 按类别拆开看 | Day 574 | 校准表之后的「小模型说的类别」统计 |

## 动手练习

1. **四个字段全对才算对**:跑 `uv run python part10/sweep.py dev all`,和只看 category 的结果比,说说为什么曲线几乎没法用。

<details><summary>参考答案</summary>

```bash
uv run python part10/sweep.py dev all
```

```text
dev 50 张,看 all
只用小模型: acc=0.100  元/千张=0.20
只用大模型: acc=0.660  元/千张=1.96
    阈值     准确率     元/千张     回退率
  0.00    0.100      0.20       0%
  0.50    0.420      0.95      38%
  0.70    0.580      2.00      92%
  0.80    0.660      2.16     100%
  0.90    0.660      2.16     100%
  0.95    0.660      2.16     100%
  0.99    0.660      2.16     100%
  1.01    0.660      2.16     100%
置信度校准(区间, 张数, 小模型真实准确率):
  [0.00, 0.50)  n=19  acc=0.00
  [0.50, 0.70)  n=27  acc=0.19
  [0.70, 0.90)  n=4   acc=0.00
```

替身四个字段全对只有 10%(5 张),大模型也只有 66%。置信度取四个字段的最小值,50 张里没有一张超过 0.9,阈值到 0.8 就已经全部回退了。到 0.7 时回退了 92%,成本 2.00 元,已经比只用大模型(1.96 元)还贵,准确率却低了 8 个百分点。整条曲线上没有一个点既比大模型便宜、又达到容忍线。

原因有两层。一是替身没训过,四个口径字段它基本靠猜;二是「取最小值」会被最没把握的那个字段拖累,而布尔字段(`needs_human`、`needs_account_data`)在替身那里常常只有五六成把握。这说明今天的方法在一个没训过的模型上只能做到 category 这一层。真实项目里,学生要先用老师的标签训到四个字段都有像样的准确率,级联才有意义。如果训好了仍然是四个字段里某一个特别拖后腿,可以只拿关键字段的置信度做路由,其他字段接受学生的答案,这是一个产品上的取舍。

</details>

2. **规则加置信度**:按「小模型说的类别」统计它对了几次;再加一条规则「小模型说 invoice 就回退」,和纯阈值比一比。

<details><summary>参考答案</summary>

新建 `part10/rule_sweep.py`:

```python
# agent-zero-lab/part10/rule_sweep.py
"""规则 + 置信度:先看小模型按「它说的类别」分组准不准,再加一条规则「小模型说 invoice 就回退」重新扫阈值。
用法:uv run python part10/rule_sweep.py dev
"""
import sys
from collections import defaultdict

from sweep import DATA, SMALL_COST, load

split = sys.argv[1]
small, big = load(DATA / f"small-{split}.jsonl"), load(DATA / f"big-{split}.jsonl")

by_pred: dict[str, list[bool]] = defaultdict(list)
for s in small.values():
    by_pred[str(s["pred"].get("category"))].append(s["fields"]["category"])
print("小模型说的类别  说了几次  其中对的")
for cat, oks in sorted(by_pred.items(), key=lambda kv: -len(kv[1])):
    print(f"  {cat:<12}{len(oks):>6}{sum(oks):>8}")

FORCE_BIG = {"invoice"}
for t in (0.0, 0.5, 0.8, 0.9):
    correct = cost = fallback = 0.0
    for i, s in small.items():
        cost += SMALL_COST
        if s["pred"].get("category") not in FORCE_BIG and s["conf"]["category"] >= t:
            correct += s["fields"]["category"]
        else:
            fallback += 1
            correct += big[i]["fields"]["category"]
            cost += big[i]["cost"]
    n = len(small)
    print(f"规则+阈值 {t:.2f}: 准确率 {correct / n:.3f}  元/千张 {1000 * cost / n:.2f}  回退率 {fallback / n:.0%}")
```

<div class="line-notes">

- `by_pred: dict[str, list[bool]] = defaultdict(list)` 按「小模型说的类别」分组,每组存一串对错。`defaultdict(list)` 访问不存在的键时自动建一个空列表。
- `by_pred[str(s["pred"].get("category"))].append(s["fields"]["category"])` `str(...)` 是为了把解析失败时的 `None` 也变成字符串当键。今天 50 张都解析成功了。
- `for cat, oks in sorted(by_pred.items(), key=lambda kv: -len(kv[1])):` 按说的次数从多到少排。
- `if s["pred"].get("category") not in FORCE_BIG and s["conf"]["category"] >= t:` 两个条件都满足才用小模型:不是被规则拦下的类别,而且置信度够。

</div>

```bash
uv run python part10/rule_sweep.py dev
```

```text
小模型说的类别  说了几次  其中对的
  invoice         28       5
  account          8       5
  refund           4       4
  technical        3       3
  plan_change      3       3
  api              2       2
  billing          2       2
规则+阈值 0.00: 准确率 0.900  元/千张 1.31  回退率 56%
规则+阈值 0.50: 准确率 0.960  元/千张 1.73  回退率 78%
规则+阈值 0.80: 准确率 0.960  元/千张 1.73  回退率 78%
规则+阈值 0.90: 准确率 0.960  元/千张 1.81  回退率 82%
```

结果和我预想的不一样。规则加上以后,准确率达到 0.96 的最便宜的点是 1.73 元,比纯阈值 0.9 的 1.54 元还贵。原因是纯阈值 0.9 已经把绝大多数 invoice 挡掉了(它们的置信度大多在 0.4 到 0.83),规则多拦下来的是那 7 张置信度 0.996 以上的 invoice,其中 5 张是对的,拦下它们只是多花钱。

规则真正有用的是阈值 0 那一行:不看置信度,只按规则拦 invoice,准确率 0.90、每千张 1.31 元,这是纯阈值曲线上没有的一个点(纯阈值在 1.19 元时只有 0.82)。如果业务能接受 0.90,这比任何纯阈值的选择都划算。

这个练习的教训是:规则要和阈值一起评估,不能看到一个问题就加一条规则。规则也要过一遍同样的离线扫描,用数字决定留不留。

</details>

3. **小模型没那么便宜时**:把 `SMALL_COST` 改成每张 0.001 元(比如你的卡很贵、或者流量不够把卡用满),阈值 0.9 那一行和「全部回退」各变成多少?级联还划算吗?

<details><summary>参考答案</summary>

不用改 `sweep.py`,在另一个脚本里改它的模块变量。新建 `part10/cost_what_if.py`:

```python
# agent-zero-lab/part10/cost_what_if.py
"""假如小模型没那么便宜:把每张的成本从 ¥0.0002 改成 ¥0.001,看阈值 0.9 那一行怎么变。"""
import sweep

rows = sweep.view(sweep.load(sweep.DATA / "small-dev.jsonl"), sweep.load(sweep.DATA / "big-dev.jsonl"), "category")
for c in (0.0002, 0.001):
    sweep.SMALL_COST = c
    r = sweep.sweep(rows, [0.9, 1.01])
    print(f"小模型每张 ¥{c}: 阈值 0.90 元/千张 {r[0]['cost_1k']:.2f},全回退 {r[1]['cost_1k']:.2f}")
```

<div class="line-notes">

- `import sweep` 导入整个模块,而不是 `from sweep import SMALL_COST`。`from ... import` 会把值复制一份到本文件,改了不影响 `sweep.sweep` 里用的那个;`sweep.SMALL_COST = c` 改的才是模块里那个变量。
- `r = sweep.sweep(rows, [0.9, 1.01])` 只算两个阈值:今天选的工作点和全部回退。

</div>

```bash
uv run python part10/cost_what_if.py
```

```text
小模型每张 ¥0.0002: 阈值 0.90 元/千张 1.54,全回退 2.16
小模型每张 ¥0.001: 阈值 0.90 元/千张 2.34,全回退 2.96
```

小模型每张 0.001 元时,阈值 0.9 每千张 2.34 元,比只用大模型的 1.96 元贵了两成,级联不但不省钱还亏钱。原因是 68% 的回退率:每张都要先付小模型的钱,回退的三分之二还要再付大模型的钱。

算一下盈亏平衡:级联的成本是 `小模型 + 回退率 × 大模型`,要比 `大模型` 便宜,需要 `小模型 < (1 − 回退率) × 大模型`。回退率 68% 时,小模型每张要低于 0.32 × 0.00196 ≈ 0.00063 元才划算。所以回退率高的级联对小模型的成本非常敏感,这也是为什么回退率是比准确率更早要盯的指标:回退率降不下来,先改进学生。

</details>

4. **大模型当小模型的校准**:用 `small-deepseek-flash-dev.jsonl`(温度 1.0 那次的结果),分别按 category 置信度和四个字段的最小置信度画校准表。

<details><summary>参考答案</summary>

新建 `part10/flash_calibration.py`:

```python
# agent-zero-lab/part10/flash_calibration.py
"""DeepSeek flash 当「小模型」时,它的置信度靠不靠谱:用 sweep.py 的 calibration 看一遍。"""
from sweep import DATA, calibration, load

small = load(DATA / "small-deepseek-flash-dev.jsonl")
for field in ("category", "min"):
    key = "category" if field == "category" else None
    rows = [(s["fields"]["category"] if key else s["correct"], s["conf"][field], False, 0.0) for s in small.values()]
    print(f"看 {field}:")
    for lo, hi, n, acc in calibration(rows, bins=(0.0, 0.5, 0.9, 0.99, 1.0001)):
        print(f"  [{lo:.2f}, {min(hi, 1.0):.2f})  n={n:<3} acc={acc:.2f}")
```

<div class="line-notes">

- `rows = [(s["fields"]["category"] if key else s["correct"], s["conf"][field], False, 0.0) for s in small.values()]` 拼成 `calibration` 要的四列格式。后两列(大模型对错和花费)校准表用不上,随便填。看 category 时对错看 category,看 min 时对错看四个字段全对。
- `for lo, hi, n, acc in calibration(rows, bins=(0.0, 0.5, 0.9, 0.99, 1.0001)):` 换一组粗一点的桶,50 张分不了太细。

</div>

```bash
uv run python part10/flash_calibration.py
```

```text
看 category:
  [0.90, 0.99)  n=3   acc=1.00
  [0.99, 1.00)  n=47  acc=0.96
看 min:
  [0.00, 0.50)  n=13  acc=0.38
  [0.50, 0.90)  n=17  acc=0.47
  [0.90, 0.99)  n=8   acc=0.25
  [0.99, 1.00)  n=12  acc=0.00
```

category 那张表只有两个桶,47 张挤在 0.99 以上,没有区分度。四个字段的那张更离谱:最自信的 12 张(四个字段都 0.99 以上)全对的一张都没有,反而是最不自信的那桶对了 38%。

这是 Day 577 系统性错误的另一个面孔:模型越确定的地方,往往是它按自己的理解答、而你的口径和它不一样的地方。它对「看不懂账单算 low 还是 normal」非常确定,只是确定的答案和标准答案不同。置信度衡量的是模型和它自己的一致程度,不是和你的口径的一致程度。所以训练好的学生要用你的标签训出来,它的置信度才可能和「对不对」挂上钩;拿一个没按你口径训练过的模型的置信度做路由,先看校准表。

</details>

验收标准:`confidence.py` 的三行演示输出和本文一致;`student_run.py` 和 `big_run.py` 在 dev 和 test 上各跑完,生成 4 个结果文件;`sweep.py dev` 打印出 8 个阈值和校准表(你的大模型结果可能有一两张出入,替身的结果在同样的机器和版本下应该一致);`pick_threshold.py` 在 dev 上选出阈值并在 test 上只跑了一次;你能指着校准表说出替身在哪类上自信地犯错。今天实跑花费约 0.22 元:`big_run.py` dev 0.0979 元 + test 0.0587 元,`small_api.py` 用 flash 跑了两次 dev,每次约 50 × 150 = 7,500 输入、50 × 30 = 1,500 输出 token,按 flash 未命中价算上限 (7500 × 2 + 1500 × 8) ÷ 100 万 ≈ 0.027 元,两次约 0.05 元,`router.py` 回退的 4 张约 0.009 元。替身在本机 CPU 上跑,不花钱。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 级联(cascade) | 先用便宜的模型,它没把握再交给贵的模型 |
| 路由(routing) | 决定一个请求交给哪个模型处理,级联是其中一种 |
| logprob | 被选中的 token 的对数概率,≤ 0,越接近 0 越有把握 |
| 置信度 | 模型对某个判断的把握,今天用字段值那几个 token 的 logprob 相加再取 exp |
| 阈值 | 置信度不低于它就用小模型,低于它就回退 |
| 回退(fallback)/ 回退率 | 交给大模型 / 被交给大模型的请求比例 |
| 取舍曲线 | 不同阈值下「成本 vs 准确率」画成的线,通常先陡后平 |
| 工作点 | 按事先定好的规则在取舍曲线上选出的那个阈值 |
| 容忍线 | 和业务方事先约定的「准确率最多掉多少」 |
| 校准(calibration) | 置信度和真实准确率相符的程度,说 90% 把握的大约 90% 是对的才算校准好 |
| 校准表 | 按置信度分桶,看每个桶的真实准确率 |
| 过度自信 | 置信度高于真实准确率,微调过的小模型很常见 |
| 温度缩放 | 一种校准方法,在验证集上拟合一个温度,把 logit 除以它再算概率 |
| 规则路由 | 按请求特征或小模型的输出写规则决定走哪个模型 |
| 学出来的路由器 | 单独训练的小分类器,预测「小模型能不能搞定这一单」,如 RouteLLM |
| `logprobs_mode` | vLLM 的配置,默认 `raw_logprobs`,返回温度等处理之前的原始概率 |

## 常见误区

**用 API 拿置信度时开着 `temperature=0`。** 今天 DeepSeek flash 在温度 0 时 50 张的 logprob 全是 0.0,置信度全是 1.0。DeepSeek 返回的是用了温度之后的分布。要么用温度 1.0,要么用 vLLM(默认返回原始 logprob)。上线前打印几条看看是不是全 0。

**以为置信度高就一定对。** 今天替身最自信的那一桶(0.99 以上)只对了 71%,flash 四个字段都 0.99 以上的 12 张一张全对的都没有。先看校准表,再决定能不能拿置信度做路由。

**看了曲线再挑工作点。** 先写下规则(今天是「不低于大模型减 2 个百分点、选最便宜的」),在 dev 上执行,test 只跑一次。看着曲线挑,总能给好看的点编出理由。

**只看准确率,不看回退率。** 阈值 0.9 的准确率追平了大模型,但回退率 68%。练习 3 算过,小模型每张贵到 0.001 元时这个级联就亏钱了。回退率降不下来,该回头改进学生,不是调阈值。

**忘了全部回退比只用大模型还贵。** 每张都先付了一次小模型的钱。今天全部回退是每千张 2.16 元,只用大模型 1.96 元。

**看到一个问题就加一条规则。** 练习 2 里「invoice 一律回退」在高阈值下只是多花钱,只在阈值 0 时才提供了一个新的取舍点。规则也要过离线扫描。

**离线模拟和线上代码用两套判断。** `router.py` 的 `decide` 和 `sweep.py` 里是同一条 `conf >= t`。两边写得不一样,离线算出来的回退率在线上就对不上。

**把替身的延迟当成学生的延迟。** 今天 CPU 上一张 13 秒,是 Intel CPU 跑 32 位浮点的结果,GPU 上的 vLLM 是几十毫秒。延迟要在真实部署上测。

## 学习资料

### 文档与文章

- [On Calibration of Modern Neural Networks](https://arxiv.org/abs/1706.04599):Guo 等,2017,讲现代神经网络为什么过度自信和温度缩放怎么做,读第 1、2 节和第 4.2 节,理解校准表(论文里叫 reliability diagram)。
- [RouteLLM 论文](https://arxiv.org/abs/2406.18665):LMSYS 用偏好数据训练路由器,读方法部分,看它怎么定义「强模型和弱模型之间的取舍」。
- [FrugalGPT 论文](https://arxiv.org/abs/2305.05176):由便宜到贵的模型级联,读第 3 节。
- [vLLM 文档 · ModelConfig](https://docs.vllm.ai/en/latest/api/vllm/config/model.html):搜 `logprobs_mode` 和 `max_logprobs`,今天关于 vLLM 返回原始 logprob 的说法来自这里。
- [DeepSeek API · 对话补全](https://api-docs.deepseek.com/zh-cn/api/create-chat-completion):`logprobs` 参数的说明,用之前再核对一次哪些参数支持。
- [Hugging Face Transformers · Generation](https://huggingface.co/docs/transformers/main/en/main_classes/text_generation):`generate` 的 `output_scores`、`return_dict_in_generate` 和 `compute_transition_scores`,`student_run.py` 用到的三样都在这页。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV18hqLYtE8W&autoplay=0&high_quality=1" title="[OpenAI API] logprobs 与 top_logprobs 模型输出的置信度与困惑度" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>五道口纳什 · [OpenAI API] logprobs 与 top_logprobs 模型输出的置信度(confidence)与困惑度(PPL) · 约 19 分钟,边写代码边讲怎么从 logprobs 算置信度,对应今天「置信度从哪来」那一节。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1qDLf6TENj&autoplay=0&high_quality=1" title="LiteLLM 路由策略详解:让大模型 API 更稳定、更快、更省钱" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员暮闲 · LiteLLM 路由策略详解:让大模型 API 更稳定、更快、更省钱 · 约 17 分钟,讲网关层的几种路由策略(按负载、按延迟、按成本、失败回退),和今天按置信度路由是互补的两层。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/V_K6PCmdtRg" title="What is an LLM Router?" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sam Witteveen · What is an LLM Router? · 讲 RouteLLM 的思路和几种路由器,对应今天「其他路由方式」那一节,英文。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 10 章讲 AI 应用的架构,其中一步就是在模型前面加路由器和网关,和今天的级联放在一起读。
- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly, 2024):第 4 章文本分类,用小的分类模型和生成式大模型做同一件事,对「什么时候小模型够用」会有直觉。中文版《图解大模型》。

### 开源项目与代码

- [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM):学出来的路由器,README 里有几种路由器的对比和怎么用阈值控制「多少比例交给强模型」。
- [huggingface/transformers](https://github.com/huggingface/transformers):搜 `compute_transition_scores` 看它怎么把每一步的分数换成被选中 token 的 logprob。

## 自测

1. 一个字段的值被切成了 `plan` 和 `_change` 两个 token,logprob 分别是 −0.69 和 −0.01。这个字段的置信度是多少?为什么不能只看第一个 token?

<details><summary>答案</summary>

exp(−0.69 − 0.01) = exp(−0.70) ≈ 0.497。字段值的概率是几个 token 概率的乘积,对数相加。多数时候第一个 token 决定了大部分(后面的接近 1),但不能假设:有的值前几个 token 是共用的(比如 `plan` 后面既可能接 `_change` 也可能接别的),这时后面的 token 才是分歧所在。按字符区间找重叠的 token 全部加上最稳。

</details>

2. 阈值 1.01 时为什么成本比「只用大模型」还高?今天高了多少?

<details><summary>答案</summary>

阈值 1.01 等于每张都回退,但每张都已经先跑了一次小模型,等于每张付了两次钱。今天全部回退每千张 2.16 元,只用大模型 1.96 元,多出的 0.20 元正好是 1,000 张 × 0.0002 元的小模型钱。

</details>

3. 校准表里置信度 [0.99, 1.00) 那一桶准确率 0.71,[0.90, 0.99) 那一桶 1.00。这对路由意味着什么?

<details><summary>答案</summary>

置信度没有校准好,最自信的那一桶反而不是最准的,说明有「自信地犯错」的情况(今天是替身对「有没有发票模板」以 0.996 判成 invoice)。阈值切在 0.9 仍然能把大部分错的挡掉,但提高阈值并不能挡住最自信的那些错。要按类别拆开看是哪类在自信地错,针对它补训练数据,或者对这类加规则;温度缩放只能整体拉伸概率,改不了排序,治不了这种问题。

</details>

4. 为什么阈值要在 dev 上选,在 test 上只跑一次?

<details><summary>答案</summary>

在哪份数据上挑阈值,挑出来的阈值就带着那份数据的偶然性,在它上面的成绩一定偏好。test 不参与任何决策,它上面的数字才接近上线后的真实表现。如果在 test 上看了结果又回去改规则、改阈值,test 就变成了第二份 dev,需要再留一份新的。

</details>

5. (面试题)你给分诊做了「小模型 + 置信度回退」,离线评测回退率 20%。上线两周后回退率涨到 45%,准确率没掉。你怎么分析、怎么处理?

<details><summary>答案</summary>

准确率没掉说明回退兜住了质量,问题在成本。先按维度拆开回退的请求:按小模型判的类别、渠道、时间、工单长度、关键词,看是不是某一批新类型的工单在拉高回退,这通常是线上分布漂移(新功能、新错误码、促销活动)。再看校准表在新数据上有没有变:是新工单置信度整体偏低,还是老类型也变低了(后者要查模型或服务有没有变,比如换了 vLLM 版本、`logprobs_mode`、模板)。短期保持回退兜底,算一算现在的成本是否已经接近或超过只用大模型(练习 3 的盈亏平衡式);长期把这批新工单用老师打标加人工复核,补进训练集重训学生,并加进评测集。回退率要做成监控和告警,定期重训,而不是等它涨了才发现。

</details>

6. vLLM 和 DeepSeek API 都支持 `logprobs=True`,为什么今天用 DeepSeek 拿置信度要把温度设成 1.0,而 vLLM 用温度 0 就行?

<details><summary>答案</summary>

DeepSeek 返回的 logprob 是按用了温度之后的分布算的,温度 0 等于贪心,被选中的 token 概率总是 1,logprob 全是 0。vLLM 的 `logprobs_mode` 默认是 `raw_logprobs`,返回的是温度等处理之前的原始概率,所以温度 0 生成时也能拿到有用的置信度。换任何一个服务,都先打印几条 logprob 看看。

</details>

## 明天预告

Day 579 · 强化学习(一):模仿和试错,RLVR 和 GRPO。这两天的蒸馏和路由,小模型学到的东西全来自老师的示范,上限就是老师。明天换一种学习信号:不给示范,只告诉模型结果对不对,让它自己试。先写一个严格的判分函数,再手算 GRPO 的组内优势,最后用 numpy 写一个最小的 GRPO 看它怎么学会,又为什么学不会「从没做对过」的题。
