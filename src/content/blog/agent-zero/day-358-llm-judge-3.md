---
title: 'Day 358 · LLM-as-judge(三):和人工对齐,TPR、TNR 和 kappa'
description: '评分器在自己写的 10 条上全对不算数。今天让模型生成 40 条回复,用终端标注工具亲手标完,按 md5 分成 train/dev/test;再让评分器判一遍,画混淆矩阵,算 TPR、TNR 和 kappa,读判错的样本去改 prompt。最后用 TPR、TNR 修正评分器报出的通过率,并用模拟验证这个公式。'
pubDate: 2026-10-22
regime: none
tags: ['eval', 'llm-as-judge', 'calibration', 'agent-zero']
series: 'agent-zero'
day: 358
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 357](/blog/agent-zero/day-357-llm-judge-2/) 写出了 `part06/llm_judge.py`:一个只判「要点覆盖」的评分器,输出 pass、fail 或 unknown,先写理由再给结论,用 pydantic 校验。它在我写的 h0 到 h9 上 10 条全对。

那天最后说了,这 10 条不算数:回复是我写的,标注是我标的,h6 还和 prompt 里的例子几乎一样。一个没校准过的评分器,就像一个没人检查过的单元测试,它说过了,你不知道是真过了还是测试本身写错了。今天做校准,行话叫**对齐**:拿一批独立来源的回复,人和评分器按同一套标准各判一遍,看两边有多一致。

## 今天要解决的问题

学完今天你应该能:

1. 准备一份对齐数据:40 条模型生成的回复,用终端标注工具亲手标 pass/fail,fail 约占三成,按 md5 分成 train、dev、test 三份。
2. 画出评分器和人的混淆矩阵,算 TPR、TNR 和 Cohen's kappa,说清楚为什么不能只看准确率。
3. 用对齐脚本在 dev 上反复跑、读判错的样本、改 prompt 或改标注,定稿后在 test 上只跑一次。
4. 用 TPR、TNR 把评分器报出的通过率修正成真实通过率的估计,并用模拟验证公式。

今天两个新概念:**对齐集和它的三个指标**(TPR、TNR、kappa),和**修正通过率**。混淆矩阵是承载这两个概念的表格,一起讲。

预计用时 3 小时,其中标注 40 条大约 40 分钟。实跑花费约 0.2 元,算式在最后一节。前置:Day 357 的 `llm_judge.py`;[Day 346](/blog/agent-zero/day-346-error-analysis-2/) 的标注规矩;[Day 353](/blog/agent-zero/day-353-stats-intuition/) 的抽样误差直觉;[Day 354](/blog/agent-zero/day-354-testset-size/) 的 md5 分组。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通,标注那 40 条一定自己标,别抄我的标签;明天合上文章把 `metrics()` 和修正公式默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 第一步:造一批不是你写的回复

对齐数据最好来自真实 trace(Day 345 读过的那些)。为了每个读者都能复现同一份数据,今天用模型生成:4 张工单,每张让模型按 9 种「态度」各写一条回复,其中几种故意让它犯错。生成的回复不是你写的,你标注时不知道哪条有坑,这正是对齐需要的。

```python
# agent-zero-lab/part06/make_align_pool.py
"""造一批待标注的回复:4 种工单 × 每种 9 条,有的让模型认真答,有的让它犯一个具体的错。"""
from __future__ import annotations

import json
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")

TASKS = {
    "cancel-c023": ("我们年付的,下个月起不用了,剩下几个月的钱能退吗?",
                    ["按剩余整月退款", "当月不退", "需要主管审批"]),
    "dup-c007": ("10月8号扣了我两次,两笔都是2392,多扣的退我",
                 ["确认存在重复扣款", "退还重复的那一笔 2392 元", "需要主管审批"]),
    "basic-c009": ("基础版年付,不想用了,剩下的钱能退吗",
                   ["基础版年付不支持中途退款", "取消后可以用到本期结束"]),
    "wrong-c012": ("你们扣了我两次钱!赶紧退!",
                   ["查询后未发现重复扣款", "不需要退款"]),
}
MODES = ["认真、准确地回答", "认真、准确地回答,但写得很简短", "认真回答,语气很热情、写得比较长",
         "回答时漏掉其中一条要点", "回答时把其中一条要点说错(说成相反或另一种算法)",
         "回答时额外承诺一件政策里没有的事", "认真回答", "回答时漏掉其中一条要点", "认真回答,用口语"]

for key, (ticket, facts) in TASKS.items():
    for i, mode in enumerate(MODES):
        prompt = (f"你是云簿 CloudLedger 的客服。客户工单:{ticket}\n"
                  f"正确处理时回复里应该讲到这些点:{facts}\n"
                  f"这次请你{mode}。只输出回复正文,不要解释你做了什么。")
        r = client.chat.completions.create(model=MODEL, temperature=0.9, extra_body=EXTRA,
                                           messages=[{"role": "user", "content": prompt}])
        print(json.dumps({"id": f"{key}-{i + 1:02d}", "ticket": ticket, "facts": facts,
                          "reply": (r.choices[0].message.content or "").strip()}, ensure_ascii=False), flush=True)
```

<div class="line-notes">

- `TASKS = {` 4 张工单,对应 Day 352 那张表里的四类:年付取消(C023)、真重复扣款(C007)、政策边界(C009 基础版)、客户说错了(C012)。每张带上它的要点,也就是 Day 348 用例里的 `expect.facts`。
- `"dup-c007": ("10月8号扣了我两次,两笔都是2392,多扣的退我",` 2392 元是 Day 350 判题器从种子库里算出来的那笔重复扣款。
- `MODES = ["认真、准确地回答", "认真、准确地回答,但写得很简短", "认真回答,语气很热情、写得比较长",` 9 种态度,第 4、5、6、8 种(下标 3、4、5、7)故意让它犯错,其余是正常回答。长短、热情、口语这几种是为了测评分器会不会被长度和语气带偏。
- `for key, (ticket, facts) in TASKS.items():` `items()` 同时拿到 key 和 value,value 是个二元组,直接在 for 里解包。相当于 JS 的 `for (const [key, [ticket, facts]] of Object.entries(TASKS))`。
- `for i, mode in enumerate(MODES):` `enumerate` 同时给下标和元素,相当于 `MODES.forEach((mode, i) => ...)`。
- `f"这次请你{mode}。只输出回复正文,不要解释你做了什么。")` 最后半句防止它写「(这里我故意漏掉了审批)」之类的旁白,那样标注时一眼就看出来了。
- `r = client.chat.completions.create(model=MODEL, temperature=0.9, extra_body=EXTRA,` 温度 0.9,让措辞有变化。
- `print(json.dumps({"id": f"{key}-{i + 1:02d}", "ticket": ticket, "facts": facts,` `{i + 1:02d}` 补零成两位,id 形如 `cancel-c023-01`。`flush=True` 让每条一生成就写出去,跑到一半中断也不白跑。

</div>

```bash
uv run python -m part06.make_align_pool > part06/cases/align_pool.jsonl
wc -l part06/cases/align_pool.jsonl
```

36 次调用,我这边跑了一分多钟,`wc -l` 输出 `36 part06/cases/align_pool.jsonl`。

读完 36 条我发现一件事:**模型经常不听「犯错」的指令**。让它「漏掉一条要点」的 8 条里,好几条其实三条全讲了;让它「额外承诺一件事」的,确实多承诺了送券、送会员,可要点一条没少。所以生成时用的「态度」绝对不能当标签用,标签只能来自你读完以后的判断。

36 条里按「要点覆盖」的标准,我最后只标出 8 条 fail,占 22%。Day 357 说过 fail 太少就没法衡量评分器抓 fail 的能力,我的经验是 fail 至少要占三成左右。补 fail 最省事的办法是**手动改坏**几条:挑正常回复,把关键处改错。我改了 4 条,存成 `part06/cases/align_broken.jsonl`:

```json
{"id": "cancel-c023-m1", "ticket": "我们年付的,下个月起不用了,剩下几个月的钱能退吗?", "facts": ["按剩余整月退款", "当月不退", "需要主管审批"], "reply": "您好，关于年付套餐剩余月份的退款，我们按剩余整月计算退款金额，当月费用不予退还；申请提交后系统自动审核，无需人工审批。"}
{"id": "dup-c007-m1", "ticket": "10月8号扣了我两次,两笔都是2392,多扣的退我", "facts": ["确认存在重复扣款", "退还重复的那一笔 2392 元", "需要主管审批"], "reply": "您好，已核实10月8日确实存在重复扣款，两笔均为2392元。我们会把这两笔都退给您，退款需主管审批后处理，请稍候。"}
{"id": "basic-c009-m1", "ticket": "基础版年付,不想用了,剩下的钱能退吗", "facts": ["基础版年付不支持中途退款", "取消后可以用到本期结束"], "reply": "您好，基础版年付不支持中途退款。您取消订阅后账号会立即停用。"}
{"id": "wrong-c012-m1", "ticket": "你们扣了我两次钱!赶紧退!", "facts": ["查询后未发现重复扣款", "不需要退款"], "reply": "您好，已查询您的账户，未发现重复扣款。不过为了让您放心，我已为您退还其中一笔。"}
```

每条都是在模型生成的正常回复上改了一处:审批改成系统自动审核、退一笔改成两笔都退、能用到本期结束改成立即停用、不用退改成退了一笔。id 带 `-m1` 后缀,以后一眼能认出是手工改的。追加到池子里:

```bash
cat part06/cases/align_broken.jsonl >> part06/cases/align_pool.jsonl
wc -l part06/cases/align_pool.jsonl
```

输出 `40 part06/cases/align_pool.jsonl`。

## 第二步:用终端标注工具标 40 条

Day 346 做过一个 Streamlit 标注页,把它改一改也能用。今天换一个更简单的:一个纯终端的标注工具,一条一条显示,你按 p 或 f,写一句理由,马上存盘。它不用装任何新依赖,中途退出下次接着标。

```python
# agent-zero-lab/part06/label.py
"""终端标注工具。用法: uv run python -m part06.label part06/cases/align_pool.jsonl part06/cases/align_labels.jsonl"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main() -> None:
    pool_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])
    pool = [json.loads(line) for line in pool_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    done = set()
    if out_path.exists():
        done = {json.loads(line)["id"] for line in out_path.read_text(encoding="utf-8").splitlines() if line.strip()}
    todo = [r for r in pool if r["id"] not in done]
    print(f"共 {len(pool)} 条,已标 {len(done)} 条,剩 {len(todo)} 条")

    with out_path.open("a", encoding="utf-8") as f:
        for r in todo:
            print(f"\n[{r['id']}] 工单:{r['ticket']}\n要点:{r['facts']}\n回复:{r['reply']}")
            key = input("p=pass f=fail s=跳过 q=退出 > ").strip().lower()
            if key == "q":
                break
            if key not in ("p", "f"):
                continue
            note = input("一句理由(可空) > ").strip()
            row = {**r, "human": "pass" if key == "p" else "fail", "note": note}
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            f.flush()


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `pool_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])` 两个参数:待标的池子,和标注结果文件。结果单独存一个文件,池子不动。
- `done = set()` 已经标过的 id。`set()` 是空集合,`{}` 是空字典,别写混。
- `if out_path.exists():` 结果文件已存在,说明之前标过一部分。
- `done = {json.loads(line)["id"] for line in out_path.read_text(encoding="utf-8").splitlines() if line.strip()}` 集合推导式,收集所有已标的 id。这就是「中途退出下次接着标」的关键。
- `todo = [r for r in pool if r["id"] not in done]` 只留没标的。`in` 查集合是常数时间,几千条也不慢。
- `with out_path.open("a", encoding="utf-8") as f:` `"a"` 是追加模式(append),写的内容接在文件末尾,不覆盖之前标的。文件不存在会自动创建。
- `key = input("p=pass f=fail s=跳过 q=退出 > ").strip().lower()` `input` 在终端等你输入一行,回车后返回这行字符串(不含换行)。相当于 Node 里 `readline.question`,但它是同步的,程序就停在这儿等。`lower()` 让大写 P 也能用。
- `if key not in ("p", "f"):` 输入 s 或者手滑打错,都当跳过,这条下次还会出现。
- `note = input("一句理由(可空) > ").strip()` 理由很重要,后面评分器和你意见不一致时,你要靠它回忆当时为什么这么判。
- `row = {**r, "human": "pass" if key == "p" else "fail", "note": note}` `{**r, ...}` 是字典展开,相当于 JS 的 `{...r, human: ..., note: ...}`:复制原来的所有字段,再加两个。
- `f.flush()` 每标一条就把缓冲区写进磁盘。不 flush 的话,按 Ctrl+C 退出时最后几条可能丢。

</div>

我先标了两条,第三条按 q 退出,看它长什么样。为了贴出真实输出,我用 `printf` 把按键喂给它,你自己标的时候直接在终端里敲:

```bash
printf 'p\n\np\n\nq\n' | uv run python -m part06.label part06/cases/align_pool.jsonl part06/cases/align_labels.jsonl
```

实测输出(第三条的长回复我截掉了中间):

```text
共 40 条,已标 0 条,剩 40 条

[cancel-c023-01] 工单:我们年付的,下个月起不用了,剩下几个月的钱能退吗?
要点:['按剩余整月退款', '当月不退', '需要主管审批']
回复:您好，关于年付套餐剩余月份的退款，我们按剩余整月计算退款金额，当月费用不予退还，且退款需提交主管审批后方可办理。请您确认是否继续申请，我将为您提交。
p=pass f=fail s=跳过 q=退出 > 一句理由(可空) > 
[cancel-c023-02] 工单:我们年付的,下个月起不用了,剩下几个月的钱能退吗?
要点:['按剩余整月退款', '当月不退', '需要主管审批']
回复:您好，年付订单提前终止时，剩余费用按剩余整月计算退款，当月费用不退；退款需提交主管审批后办理。
p=pass f=fail s=跳过 q=退出 > 一句理由(可空) > 
[cancel-c023-03] 工单:我们年付的,下个月起不用了,剩下几个月的钱能退吗?
要点:['按剩余整月退款', '当月不退', '需要主管审批']
回复:您好呀！非常感谢您联系我们云簿 CloudLedger 客服，也很高兴收到您的工单～ ……
p=pass f=fail s=跳过 q=退出 >
```

再运行一次同样的命令,开头会变成 `共 40 条,已标 2 条,剩 38 条`,从第三条接着来。剩下 38 条我也是用这个工具标完的。

标注时守住两条规矩。一是**只按评分器的那套判定标准判**:今天判的是「要点覆盖」,回复多承诺了送券,那是另一个评分器(有没有编造政策)的事,这里照样判 pass。我标的时候在理由里写了「额外送券不在本评分器管」,提醒自己别越界。二是**拿不准的写下理由**。我有两条犹豫了很久:

- `cancel-c023-04`:「退款按剩余整月计算,当月已使用的部分不予退还」。「当月已使用的部分不退」是不是在暗示「当月没用完的部分会退」?我判了 fail,理由写的就是这句。
- `cancel-c023-08`:「当月已产生的服务费用不支持退还」。我觉得「当月已产生的费用」就是指当月这笔钱,判了 pass。

这两条后面还会出场。40 条标完,统计一下:

```bash
uv run python -c "
import json, collections
rows = [json.loads(l) for l in open('part06/cases/align_labels.jsonl')]
print(collections.Counter(r['human'] for r in rows))"
```

实测 `Counter({'pass': 28, 'fail': 12})`。fail 占 30%,够用了。

## 第三步:分成三份

标好的 40 条不能全拿来调 prompt。和 Day 354 测试集分 dev/test 一个道理,你对着哪批数据改 prompt,评分器就会在哪批数据上看起来很好。这里要分三份:

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="对齐数据分三份:train 只用来挑例子,dev 用来反复调 prompt,test 定稿后只跑一次">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="28" fill="var(--ink-soft)">40 条人工标注(fail 12 条)</text>
<rect x="20" y="42" width="110" height="50" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="75" y="64" fill="var(--ink)" text-anchor="middle">train 7</text>
<text x="75" y="82" fill="var(--ink-soft)" text-anchor="middle" font-size="11">只挑例子</text>
<rect x="130" y="42" width="230" height="50" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="245" y="64" fill="var(--ink)" text-anchor="middle">dev 15</text>
<text x="245" y="82" fill="var(--ink-soft)" text-anchor="middle" font-size="11">反复跑、读错例、改 prompt</text>
<rect x="360" y="42" width="260" height="50" fill="none" stroke="var(--ink-soft)"/>
<text x="490" y="64" fill="var(--ink)" text-anchor="middle">test 18</text>
<text x="490" y="82" fill="var(--ink-soft)" text-anchor="middle" font-size="11">定稿后只跑一次</text>
<text x="20" y="124" fill="var(--ink)">循环:改 prompt → 跑 dev → 看 TPR/TNR → 读判错的 → 再改</text>
<text x="20" y="148" fill="var(--ink)">dev 过线后跑一次 test,对外报 test 上的数</text>
<text x="20" y="180" fill="var(--ink-faint)" font-size="11">md5(id) % 100:0–19 进 train,20–59 进 dev,60–99 进 test</text>
</g>
</svg>
<figcaption>对齐数据三分法。比例大约 2:4:4,数据少时 train 只要够挑两三个例子就行。最容易犯的错是从 dev 或 test 里挑例子,评分器等于提前看过答案。</figcaption>
</figure>

为什么 train 要单独一份?Day 357 的例子是我凭空写的,结果第二个例子和 h6 几乎同一句话,h6 就白测了。以后要往评分 prompt 里加例子,只能从 train 里挑,这样 dev 和 test 上的分数才干净。

```python
# agent-zero-lab/part06/split_align.py
"""给标注好的对齐数据分三份:train / dev / test。用法: uv run python -m part06.split_align part06/cases/align_labels.jsonl"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path


def split_of(row_id: str) -> str:
    h = int(hashlib.md5(row_id.encode()).hexdigest(), 16) % 100
    if h < 20:
        return "train"
    return "dev" if h < 60 else "test"


path = Path(sys.argv[1])
rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
for r in rows:
    r["split"] = split_of(r["id"])
path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")

c = Counter((r["split"], r["human"]) for r in rows)
for s in ["train", "dev", "test"]:
    print(f"{s:<5} pass {c[(s, 'pass')]:>2}  fail {c[(s, 'fail')]:>2}")
```

<div class="line-notes">

- `def split_of(row_id: str) -> str:` 和 Day 354 的 `split_of` 一样用 md5,只是分三份。
- `h = int(hashlib.md5(row_id.encode()).hexdigest(), 16) % 100` 实测 `basic-c009-05` 是 11,`cancel-c023-04` 是 43,`wrong-c012-04` 是 82。
- `if h < 20:` 0 到 19 进 train。`basic-c009-05`(11)进了 train。
- `return "dev" if h < 60 else "test"` 20 到 59 进 dev,其余进 test。`cancel-c023-04`(43)进 dev,`wrong-c012-04`(82)进 test。
- `path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")` 把 split 字段写回原文件。每行末尾都带换行,下次 label.py 追加时不会粘在最后一行后面。
- `c = Counter((r["split"], r["human"]) for r in rows)` 数出每份里 pass、fail 各几条。

</div>

```bash
uv run python -m part06.split_align part06/cases/align_labels.jsonl
```

实测输出:

```text
train pass  5  fail  2
dev   pass 10  fail  5
test  pass 13  fail  5
```

三份里都有 fail,dev 和 test 各 5 条。比例没有刚好 20/40/40(train 7 条、dev 15 条、test 18 条),40 条用哈希分组这很正常。

## 第四步:混淆矩阵、TPR、TNR 和 kappa

在跑评分器之前,先把「怎么比」想清楚。每条样本有两个判断,人的和评分器的,各是 pass 或 fail,组合起来只有四种。把四种情况各数一数,排成一张 2×2 的表,就是**混淆矩阵**(confusion matrix)。它的名字来自「评分器在哪里和人搞混了」。

四个格子各有名字。这里把 pass 当「正」(positive),fail 当「负」(negative):

- **TP**(true positive):人说 pass,评分器也说 pass。
- **FN**(false negative):人说 pass,评分器说 fail。评分器冤枉了好回复。
- **FP**(false positive):人说 fail,评分器说 pass。评分器放过了坏回复。
- **TN**(true negative):人说 fail,评分器也说 fail。

T 和 F 说的是评分器判得对不对,P 和 N 说的是评分器给的结论。前端里你见过类似的东西:单元测试「测试说过了、代码其实有 bug」就是一个 FP。

### 为什么不能只看准确率

最直观的指标是准确率:四格里对角线那两格(TP + TN)占总数的比例。可它会被类别比例骗。拿我们刚分好的 dev 来说,15 条里 11 条 pass(这是后面改过一条标注之后的数),一个**永远说 pass** 的「评分器」,准确率是 11/15 = 0.733。它一条 fail 都抓不到,却有七成多的准确率。练习 1 会实跑这个。

所以要分开看两个比例:

- **TPR**(true positive rate,真正率)= TP / (TP + FN):人判 pass 的里面,评分器也判 pass 的比例。低了说明评分器太严,冤枉好回复。
- **TNR**(true negative rate,真负率)= TN / (TN + FP):人判 fail 的里面,评分器也判 fail 的比例。低了说明评分器太松,放过坏回复。

评测里我们最在意的往往是 TNR,因为放过的坏回复你根本看不见。我的经验目标是两个都在 0.9 以上。

### kappa:扣掉碰巧一致

还有一个常用指标叫 **Cohen's kappa**。它回答的问题是:人和评分器的一致,有多少是真一致,有多少只是碰巧?

想象两个人都在瞎猜,一个 73% 的时候说 pass,另一个也 73% 的时候说 pass,他俩碰巧一致的概率也不低。kappa 就是把这部分碰巧扣掉:

- 观察一致率 po = (TP + TN) / n,就是准确率。
- 碰巧一致率 pe = P(人说 pass) × P(评分器说 pass) + P(人说 fail) × P(评分器说 fail)。
- kappa = (po − pe) / (1 − pe)。

kappa 等于 1 是完全一致,等于 0 是和瞎猜没区别,小于 0 是比瞎猜还差。一般认为 0.6 到 0.8 算较好,0.8 以上很好。刚才那个永远说 pass 的评分器,po = 0.733,pe 也是 0.733(它说 pass 的比例是 1,所以 pe = 0.733 × 1 + 0.267 × 0),kappa 正好是 0。准确率 73%,kappa 0,一下就露馅了。

kappa 也用来衡量**人和人之间**的一致。找一位同事按同一套标准独立标同一批数据,算你们俩的 kappa。如果人和人之间都只有 0.6,说明判定标准本身写得不清楚,这时候怪评分器没用,先把标准改清楚。

## 第五步:对齐脚本

现在写脚本:读标注、只取指定的一份、让评分器判、打印不一致的样本、算四个指标。

```python
# agent-zero-lab/part06/align.py
"""评分器对齐。用法: uv run python -m part06.align part06/cases/align_labels.jsonl dev"""
from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from part06.llm_judge import JUDGE_MODEL, JUDGE_VERSION, USAGE, judge_facts


def metrics(pairs: list[tuple[str, str]]) -> dict[str, float]:
    tp = sum(h == "pass" and j == "pass" for h, j in pairs)
    fn = sum(h == "pass" and j == "fail" for h, j in pairs)
    fp = sum(h == "fail" and j == "pass" for h, j in pairs)
    tn = sum(h == "fail" and j == "fail" for h, j in pairs)
    n = tp + fn + fp + tn
    tpr = tp / (tp + fn) if tp + fn else float("nan")
    tnr = tn / (tn + fp) if tn + fp else float("nan")
    po = (tp + tn) / n
    pe = ((tp + fn) / n) * ((tp + fp) / n) + ((fp + tn) / n) * ((fn + tn) / n)
    kappa = (po - pe) / (1 - pe) if pe < 1 else float("nan")
    return {"n": n, "tp": tp, "fn": fn, "fp": fp, "tn": tn,
            "tpr": tpr, "tnr": tnr, "acc": po, "pe": pe, "kappa": kappa}


def main() -> None:
    path, split = Path(sys.argv[1]), sys.argv[2]
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    rows = [r for r in rows if r["split"] == split]

    with ThreadPoolExecutor(max_workers=4) as pool:
        verdicts = list(pool.map(lambda r: judge_facts(r["ticket"], r["reply"], r["facts"]), rows))

    pairs: list[tuple[str, str]] = []
    unknown = 0
    for r, v in zip(rows, verdicts):
        if v.verdict == "unknown":
            unknown += 1
            continue
        pairs.append((r["human"], v.verdict))
        if r["human"] != v.verdict:
            print(f"\n[{r['id']}] 人:{r['human']}  评分器:{v.verdict}\n  回复: {r['reply'][:80]}\n  人的理由: {r['note']}\n  评分器理由: {v.critique}")

    m = metrics(pairs)
    print(f"\n{JUDGE_VERSION} · {JUDGE_MODEL} · split={split} · 共 {len(rows)} 条 · unknown={unknown}")
    print(f"TP {m['tp']}  FN {m['fn']}  FP {m['fp']}  TN {m['tn']}")
    print(f"TPR {m['tpr']:.3f}  TNR {m['tnr']:.3f}  准确率 {m['acc']:.3f}  kappa {m['kappa']:.3f}")
    print(f"调用 {USAGE['calls']} 次 · 输入 {USAGE['in']} token · 输出 {USAGE['out']} token")


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from concurrent.futures import ThreadPoolExecutor` 线程池。15 次评分互不依赖,4 个一起发能快好几倍。等调模型的时间都花在网络上,用线程就够了。
- `from part06.llm_judge import JUDGE_MODEL, JUDGE_VERSION, USAGE, judge_facts` 对齐测的就是你要真正拿去用的那一个评分器,直接导入,不复制。
- `def metrics(pairs: list[tuple[str, str]]) -> dict[str, float]:` 输入是 `(人的判断, 评分器的判断)` 二元组的列表。
- `tp = sum(h == "pass" and j == "pass" for h, j in pairs)` 布尔值求和就是计数,Day 356 抛硬币时用过同样的写法。第一轮 dev 上实测 tp = 10。
- `fn = sum(h == "pass" and j == "fail" for h, j in pairs)` 人 pass、评分器 fail,第一轮是 0。
- `fp = sum(h == "fail" and j == "pass" for h, j in pairs)` 人 fail、评分器 pass,第一轮是 1,就是下面那条 `cancel-c023-04`。
- `tn = sum(h == "fail" and j == "fail" for h, j in pairs)` 第一轮是 4。
- `tpr = tp / (tp + fn) if tp + fn else float("nan")` 10 / 10 = 1.0。分母为 0(一条人判 pass 的都没有)时返回 `nan`(not a number),不抛 `ZeroDivisionError`。
- `tnr = tn / (tn + fp) if tn + fp else float("nan")` 4 / 5 = 0.8。
- `po = (tp + tn) / n` 14 / 15 = 0.933。
- `pe = ((tp + fn) / n) * ((tp + fp) / n) + ((fp + tn) / n) * ((fn + tn) / n)` 人说 pass 的比例 10/15 乘评分器说 pass 的比例 11/15,加上人说 fail 的比例 5/15 乘评分器说 fail 的比例 4/15:0.489 + 0.089 = 0.578。
- `kappa = (po - pe) / (1 - pe) if pe < 1 else float("nan")` (0.933 − 0.578) / 0.422 = 0.842。两边都 100% 说 pass 时 pe = 1,分母为 0,返回 nan。
- `rows = [r for r in rows if r["split"] == split]` 只取指定的一份,dev 是 15 条。
- `verdicts = list(pool.map(lambda r: judge_facts(r["ticket"], r["reply"], r["facts"]), rows))` `pool.map` 按输入顺序返回结果,下面才能用 `zip` 一一配对。`lambda` 是匿名函数,相当于 JS 的箭头函数 `r => judgeFacts(...)`。
- `if v.verdict == "unknown":` unknown 不进混淆矩阵,单独数。今天 dev 和 test 上都是 0 条。
- `if r["human"] != v.verdict:` 只打印不一致的,带上你当时写的理由和评分器的理由,两边对着看。
- `print(f"\n{JUDGE_VERSION} · {JUDGE_MODEL} · split={split} · 共 {len(rows)} 条 · unknown={unknown}")` 第一行记下评分器版本和模型名,以后翻记录知道这个数是谁给的。
- `print(f"调用 {USAGE['calls']} 次 · 输入 {USAGE['in']} token · 输出 {USAGE['out']} token")` `USAGE` 是 `llm_judge.py` 里的计数器,4 个线程同时 `+=` 理论上可能少记一两次,算钱够用了。

</div>

### 在 dev 上跑第一轮

```bash
uv run python -m part06.align part06/cases/align_labels.jsonl dev
```

实测输出:

```text
[cancel-c023-04] 人:fail  评分器:pass
  回复: 您好，关于年付套餐中途停止使用的退款，我们需要先说明：退款按剩余整月计算，当月已使用的部分不予退还。您的具体情况需要提交主管审批后才能确认可退金额，建议您提供账
  人的理由: 「当月已使用的部分不退」暗示当月没用的部分会退,和当月不退矛盾
  评分器理由: 三条要点都表达了：按剩余整月退款、当月不退、需要主管审批，且没有矛盾说法。

facts-v1 · deepseek-flash · split=dev · 共 15 条 · unknown=0
TP 10  FN 0  FP 1  TN 4
TPR 1.000  TNR 0.800  准确率 0.933  kappa 0.842
调用 15 次 · 输入 9130 token · 输出 643 token
```

准确率 93%,kappa 0.84,看起来不错。但 TNR 只有 0.8:我判 fail 的 5 条里,它放过了 1 条。放过的正是我标注时犹豫了很久的 `cancel-c023-04`。

### 改 prompt,改了两版都没用

第一反应是改 prompt。我在判定标准里加了一句(版本号改成 facts-v2):

```text
要点里的限定词要逐字对照:比如要点是「当月不退」,回复说「当月已使用的部分不退」,等于暗示当月没用完的部分会退,算矛盾。
```

<div class="line-notes">

- `要点里的限定词要逐字对照:` 想让评分器在「当月不退」和「当月已使用的部分不退」之间较真。注意这句几乎是照着那条 dev 样本写的,这本身就有对 dev 过拟合的风险。

</div>

再跑 dev,结果一个数没变,还是 `TP 10  FN 0  FP 1  TN 4`,评分器理由变成了「当月已使用部分不退……没有矛盾说法」,它读到了我的新规则,但不认为这条回复属于这种情况。

第二版(facts-v3)我又加了一个例子,用的是一句不同的话「这个月已经用掉的那几天不退」,判 fail。再跑,还是 `TP 10  FN 0  FP 1  TN 4`,理由是「当月已使用部分不予退还(即当月不退)」。它坚持认为这句话就是在说「当月不退」。这两轮一共花了 2 万多输入 token,一点用都没有。

### 回头读自己的标注

这时候该停下来想一下:是评分器错了,还是我错了?

回去重读这条回复:「退款按剩余整月计算,当月已使用的部分不予退还」。前半句已经白纸黑字写了「按剩余整月计算」,一个普通客户读完,不会以为这个月剩下的天数能退钱。我当时标 fail,是在字面上较真,而我给评分器的判定标准里并没有要求这么较真。再对比 `cancel-c023-08`(「当月已产生的服务费用不支持退还」),那条我判了 pass,两条的意思其实差不多,我自己的标准都不一致。

所以我改了标注:`cancel-c023-04` 从 fail 改成 pass,note 写成「改标(原 fail):前半句已写明按剩余整月算,客户不会以为当月能退;原标准太严」。prompt 退回 facts-v1,加的那句规则和例子都撤掉,它们没解决问题,还让 prompt 变长了。

改标注必须守一条底线:**只有当你不看评分器的结论、重新独立判断也会这么判时,才改**,并且写下原因。如果你是为了让分数好看而改,那就成了悄悄改期望值让测试变绿。Hamel 和 Shreya 的研究里专门讲过这个现象:人在看过一批样本之后,对标准的理解本来就会变,这叫标准漂移(criteria drift)。漂移不可怕,可怕的是不记录。

改完再跑一次 dev:

```text
facts-v1 · deepseek-flash · split=dev · 共 15 条 · unknown=0
TP 11  FN 0  FP 0  TN 4
TPR 1.000  TNR 1.000  准确率 1.000  kappa 1.000
调用 15 次 · 输入 9130 token · 输出 646 token
```

dev 全部一致。到这里 prompt 定稿,该去 test 上验收了。

### 在 test 上只跑一次

```bash
uv run python -m part06.align part06/cases/align_labels.jsonl test
```

实测输出:

```text
[wrong-c012-04] 人:pass  评分器:fail
  回复: 您好，非常抱歉给您带来困扰！关于您反馈的扣款问题，我们已第一时间为您核实。查询后未发现重复扣款，您的账户扣款记录正常。如您仍有疑问，欢迎随时联系我们进一步核查，
  人的理由: 没逐字说不需要退款,但记录正常已传达
  评分器理由: 回复明确表达了「查询后未发现重复扣款」；但没有表达「不需要退款」，只说记录正常、有疑问可再联系，未说明无需退款。

facts-v1 · deepseek-flash · split=test · 共 18 条 · unknown=0
TP 12  FN 1  FP 0  TN 5
TPR 0.923  TNR 1.000  准确率 0.944  kappa 0.870
调用 18 次 · 输入 10901 token · 输出 781 token
```

把这四个数放进混淆矩阵:

<figure>
<svg viewBox="0 0 640 240" role="img" aria-label="评分器 facts-v1 在 test 集 18 条上和人工标注的混淆矩阵:TP 12、FN 1、FP 0、TN 5">
<rect x="0" y="0" width="640" height="240" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="250" y="28" fill="var(--ink-soft)" text-anchor="middle">评分器说 pass</text>
<text x="390" y="28" fill="var(--ink-soft)" text-anchor="middle">评分器说 fail</text>
<text x="160" y="74" fill="var(--ink-soft)" text-anchor="end">人说 pass(13)</text>
<text x="160" y="144" fill="var(--ink-soft)" text-anchor="end">人说 fail(5)</text>
<rect x="180" y="44" width="140" height="56" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="250" y="70" fill="var(--ink)" text-anchor="middle">TP 12</text>
<text x="250" y="88" fill="var(--ink-soft)" text-anchor="middle" font-size="11">都说 pass</text>
<rect x="320" y="44" width="140" height="56" fill="none" stroke="var(--rule)"/>
<text x="390" y="70" fill="var(--ink)" text-anchor="middle">FN 1</text>
<text x="390" y="88" fill="var(--ink-soft)" text-anchor="middle" font-size="11">冤枉了好回复</text>
<rect x="180" y="114" width="140" height="56" fill="none" stroke="var(--rule)"/>
<text x="250" y="140" fill="var(--ink)" text-anchor="middle">FP 0</text>
<text x="250" y="158" fill="var(--ink-soft)" text-anchor="middle" font-size="11">放过了坏回复</text>
<rect x="320" y="114" width="140" height="56" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="390" y="140" fill="var(--ink)" text-anchor="middle">TN 5</text>
<text x="390" y="158" fill="var(--ink-soft)" text-anchor="middle" font-size="11">都说 fail</text>
<text x="480" y="74" fill="var(--ink)">TPR 12/13 = 0.923</text>
<text x="480" y="144" fill="var(--ink)">TNR 5/5 = 1.000</text>
<text x="180" y="200" fill="var(--ink-soft)">准确率 17/18 = 0.944 · pe = 0.574 · kappa = 0.870</text>
<text x="180" y="222" fill="var(--ink-faint)" font-size="11">facts-v1 · deepseek-flash · test 集实测</text>
</g>
</svg>
<figcaption>test 集上的混淆矩阵,全是实测数字。唯一的不一致在右上角:人判 pass、评分器判 fail,评分器偏严。</figcaption>
</figure>

kappa 手算一遍:po = 17/18 = 0.944;人说 pass 的比例 13/18,评分器说 pass 的比例 12/18,pe = (13/18)(12/18) + (5/18)(6/18) = 0.481 + 0.093 = 0.574;kappa = (0.944 − 0.574) / (1 − 0.574) = 0.870,和脚本一致。

这次判错的方向反过来了:评分器冤枉了一条好回复。`wrong-c012-04` 只说了「未发现重复扣款,记录正常」,没逐字说「不需要退款」。有意思的是,prompt 里第三个例子讲的正是这种情况(「没逐字说不需要退款,但意思已经传达」),评分器还是判了 fail。

**这条不能拿来改 prompt。** test 是验收用的,你一旦读了 test 上的错例去改 prompt,test 就变成了第二个 dev,下次的分数又不干净了。正确的做法是把这个发现记进笔记:「facts-v1 在 test 上 TPR 0.923,漏判一条『意思到了没逐字说』的 pass」;下一轮收集新的标注时,有意多收几条这类回复放进 train 和 dev,再迭代。

还有一个要诚实面对的问题:TNR 1.000 是从 5 条 fail 上算出来的。按 [Day 353](/blog/agent-zero/day-353-stats-intuition/) 的思路想,就算评分器真实的 TNR 只有 0.6,它在 5 条 fail 上全判对的概率也有 0.6 的 5 次方 = 7.8%,并不罕见。所以这个 1.000 的意思是「目前没发现它放过坏回复」,不是「它不会放过」。要把 TNR 测准,fail 样本得有几十条。

## 第六步:用 TPR 和 TNR 修正通过率

评分器校准好了,接下来拿它去判 Agent 的回复。假设它报告说测试集上 80% 的回复 pass。真实通过率是 80% 吗?不完全是,因为评分器自己有误差:有些真 pass 被它冤枉成了 fail,有些真 fail 被它放过成了 pass。

可以把这两股误差算回去。设真实通过率是 θ,评分器报出来的通过率 p_obs 由两部分组成:

- 真 pass 被判 pass:θ × TPR
- 真 fail 被误判成 pass:(1 − θ) × (1 − TNR)

所以 p_obs = θ × TPR + (1 − θ) × (1 − TNR)。这是一个关于 θ 的一次方程,解出来:

θ = (p_obs + TNR − 1) / (TPR + TNR − 1)

公式是推出来的,我更想让你亲眼看到它成立。下面这个脚本先假装知道真实通过率,模拟一个有误差的评分器去判 1 万条回复,再用公式从报出来的数倒推回去,看能不能还原。

```python
# agent-zero-lab/part06/correct_rate.py
"""用 TPR/TNR 修正评分器报出来的通过率,再用模拟验证公式。"""
from __future__ import annotations

import random


def corrected(p_obs: float, tpr: float, tnr: float) -> float:
    return (p_obs + tnr - 1) / (tpr + tnr - 1)


TRUE_RATE, TPR, TNR, N = 0.70, 0.95, 0.80, 10_000
rng = random.Random(358)

judged_pass = 0
for _ in range(N):
    really_pass = rng.random() < TRUE_RATE
    if really_pass:
        judged_pass += rng.random() < TPR
    else:
        judged_pass += rng.random() < 1 - TNR

p_obs = judged_pass / N
print(f"真实通过率 {TRUE_RATE:.2f},评分器报出 {p_obs:.4f}")
print(f"修正后 {corrected(p_obs, TPR, TNR):.4f}")
print(f"公式手算: 0.70×0.95 + 0.30×0.20 = {0.70 * 0.95 + 0.30 * 0.20:.3f}")
```

<div class="line-notes">

- `def corrected(p_obs: float, tpr: float, tnr: float) -> float:` 修正公式,一行。
- `return (p_obs + tnr - 1) / (tpr + tnr - 1)` 分母 TPR + TNR − 1 衡量评分器比瞎猜强多少:瞎猜的评分器 TPR + TNR 约等于 1,分母接近 0,公式就失效了(练习 3 会看到)。
- `TRUE_RATE, TPR, TNR, N = 0.70, 0.95, 0.80, 10_000` 假设 Agent 真实通过率 70%,评分器 TPR 0.95、TNR 0.80(偏松),判 1 万条。`10_000` 里的下划线只是为了好读,和 JS 的 `10_000` 一样。
- `really_pass = rng.random() < TRUE_RATE` 这条回复「真的」合格吗?70% 的概率是。现实里你不知道这个,模拟里我们是上帝视角。
- `judged_pass += rng.random() < TPR` 真合格的,评分器有 95% 的概率判 pass。布尔值加到整数上,True 算 1。
- `judged_pass += rng.random() < 1 - TNR` 真不合格的,评分器有 1 − 0.8 = 20% 的概率误判成 pass。
- `p_obs = judged_pass / N` 评分器报出来的通过率。实测 0.7255。
- `print(f"修正后 {corrected(p_obs, TPR, TNR):.4f}")` (0.7255 + 0.8 − 1) / (0.95 + 0.8 − 1) = 0.5255 / 0.75 = 0.7007,还原回了 0.70。
- `print(f"公式手算: 0.70×0.95 + 0.30×0.20 = {0.70 * 0.95 + 0.30 * 0.20:.3f}")` 不模拟、直接用上面的两部分相加,评分器「应该」报 0.725,模拟出来的 0.7255 和它只差一点抽样误差。

</div>

```bash
uv run python -m part06.correct_rate
```

实测输出:

```text
真实通过率 0.70,评分器报出 0.7255
修正后 0.7007
公式手算: 0.70×0.95 + 0.30×0.20 = 0.725
```

一个偏松的评分器(TNR 0.8)把 70% 报成了 72.5%,公式把它修回了 70.07%。

拿我们今天的真实数字试试。假设 facts-v1 判 Agent 的回复报出 80%,用 test 上的 TPR 0.923、TNR 1.0 修正:(0.80 + 1.0 − 1) / (0.923 + 1.0 − 1) = 0.80 / 0.923 = 0.867。因为这个评分器偏严(会冤枉好回复,不会放过坏回复),真实通过率反而比它报的高。不过刚才说了,TNR 1.0 只来自 5 条 fail,这个修正值本身也带着不小的误差。

汇报时这样写最稳妥:「评分器 facts-v1 报 80%;它在 18 条留出标注上 TPR 0.923、TNR 1.0(fail 样本只有 5 条),修正后约 87%」。比单报一个 80% 诚实得多,读的人也知道这个数能信到什么程度。

## 动手练习

### 练习 1:永远说 pass 的评分器

不调模型,用 `align.py` 里的 `metrics()` 算一个「永远说 pass」的评分器在 dev 和 test 上的准确率、TPR、TNR、kappa。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex358_always_pass.py
"""练习 1:一个永远说 pass 的「评分器」,在 dev 和 test 上分别拿多少分?不调模型。"""
from __future__ import annotations

import json
from pathlib import Path

from part06.align import metrics

rows = [json.loads(line) for line in Path("part06/cases/align_labels.jsonl").read_text(encoding="utf-8").splitlines()]
for split in ["dev", "test"]:
    pairs = [(r["human"], "pass") for r in rows if r["split"] == split]
    m = metrics(pairs)
    print(f"{split}: 准确率 {m['acc']:.3f}  TPR {m['tpr']:.3f}  TNR {m['tnr']:.3f}  kappa {m['kappa']:.3f}")
```

<div class="line-notes">

- `from part06.align import metrics` 只导入函数。`align.py` 的主逻辑在 `if __name__ == "__main__":` 里,导入时不会去调模型。
- `pairs = [(r["human"], "pass") for r in rows if r["split"] == split]` 评分器那一边永远填 `"pass"`。
- `m = metrics(pairs)` dev 上 tp = 11、fp = 4,fn、tn 都是 0。

</div>

```bash
uv run python -m part06.ex358_always_pass
```

实测输出:

```text
dev: 准确率 0.733  TPR 1.000  TNR 0.000  kappa 0.000
test: 准确率 0.722  TPR 1.000  TNR 0.000  kappa 0.000
```

准确率七成多,TPR 满分,但 TNR 和 kappa 都是 0。只看准确率或只看 TPR,你会以为它不错。

</details>

### 练习 2:手算 kappa

一个评分器在 60 条对齐数据上:TP 37、FN 3、FP 5、TN 15。先手算准确率、TPR、TNR、pe 和 kappa,再用 `metrics()` 核对。

<details><summary>参考答案</summary>

手算:n = 60;准确率 = 52/60 = 0.867;TPR = 37/40 = 0.925;TNR = 15/20 = 0.75;人说 pass 的比例 40/60,评分器说 pass 的比例 (37+5)/60 = 42/60,pe = (40/60)(42/60) + (20/60)(18/60) = 0.467 + 0.100 = 0.567;kappa = (0.867 − 0.567) / (1 − 0.567) = 0.692。

```python
# agent-zero-lab/part06/ex358_kappa.py
"""练习 2:手算一张混淆矩阵的 kappa,再用 metrics() 核对。"""
from __future__ import annotations

from part06.align import metrics

pairs = ([("pass", "pass")] * 37 + [("pass", "fail")] * 3
         + [("fail", "pass")] * 5 + [("fail", "fail")] * 15)
m = metrics(pairs)
print({k: round(v, 4) for k, v in m.items()})
```

<div class="line-notes">

- `pairs = ([("pass", "pass")] * 37 + [("pass", "fail")] * 3` 列表乘整数是重复,`[x] * 37` 得到 37 个 x 的列表,相当于 JS 的 `Array(37).fill(x)`。按四格的数字拼出 60 对。
- `print({k: round(v, 4) for k, v in m.items()})` 字典推导式,每个值保留 4 位小数。

</div>

```bash
uv run python -m part06.ex358_kappa
```

实测输出:

```text
{'n': 60, 'tp': 37, 'fn': 3, 'fp': 5, 'tn': 15, 'tpr': 0.925, 'tnr': 0.75, 'acc': 0.8667, 'pe': 0.5667, 'kappa': 0.6923}
```

和手算一致。准确率 87% 看着不错,TNR 只有 0.75:人判 fail 的 20 条里放过了 5 条,这个评分器下一步该去读那 5 条。

</details>

### 练习 3:公式什么时候失效

用 `corrected()` 算三组:p_obs = 0.80 时,(TPR 0.95, TNR 0.90)、(TPR 0.923, TNR 1.0)、(TPR 0.60, TNR 0.45)。最后一组的结果说明什么?

<details><summary>参考答案</summary>

```bash
uv run python -c "
from part06.correct_rate import corrected
print(round(corrected(0.80,0.95,0.90),4), round(corrected(0.80,0.923,1.0),4), round(corrected(0.80,0.6,0.45),4))"
```

<div class="line-notes">

- `from part06.correct_rate import corrected` 注意 `correct_rate.py` 的模拟部分没包进 `if __name__ == "__main__":`,导入时会先把模拟跑一遍、打印三行,最后一行才是这里的结果。和 Day 356 练习 4 是同一个坑。

</div>

实测最后一行:

```text
0.8235 0.8667 5.0
```

前两组正常:82.35% 和 86.67%。第三组算出 5.0,也就是 500%,一个不可能的通过率。原因是分母 TPR + TNR − 1 = 0.05,几乎为 0:这个评分器和瞎猜差不多(瞎猜时 TPR + TNR 约等于 1),报出来的数里几乎不含真实通过率的信息,公式就把一点点误差放大成了荒谬的结果。遇到这种评分器,该做的是重写它,而不是修正它的数。

</details>

### 练习 4(开放题):你和自己的一致性

隔一天,不看昨天的标签,用 `label.py` 把 dev 的 15 条重新标一遍,输出到另一个文件,用 `metrics()` 算两次标注之间的 kappa。

<details><summary>参考答案</summary>

这道题我没法替你实跑:我的「第二次标注」是同一个人隔几小时标的,而且我已经知道答案,结果不说明问题。给出做法和我的预期:

```bash
uv run python -c "
import json
rows = [json.loads(l) for l in open('part06/cases/align_labels.jsonl')]
dev = [{k: r[k] for k in ('id', 'ticket', 'facts', 'reply')} for r in rows if r['split'] == 'dev']
open('part06/cases/dev_pool.jsonl', 'w').write(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in dev))"
uv run python -m part06.label part06/cases/dev_pool.jsonl part06/cases/dev_relabel.jsonl
```

<div class="line-notes">

- `dev = [{k: r[k] for k in ('id', 'ticket', 'facts', 'reply')} for r in rows if r['split'] == 'dev']` 只保留回复本身,去掉 `human` 和 `note`,第二次标注时看不到第一次的结论。
- `uv run python -m part06.label part06/cases/dev_pool.jsonl part06/cases/dev_relabel.jsonl` 用同一个标注工具,输出到新文件。

</div>

标完后把两个文件按 id 配对,`(第一次, 第二次)` 喂给 `metrics()`。我的预期是 kappa 在 0.8 以上,不一致集中在 `cancel-c023-04` 这种字面和意思有出入的回复上。如果你和自己都只有 0.6,先回去把判定标准写清楚,再谈对齐评分器。

</details>

### 验收标准

- `align_labels.jsonl` 有 40 条你自己标的数据,fail 不少于 10 条,三份里都有 fail。
- `align.py` 在 dev 上跑过至少两轮,你读过每一条不一致的样本,并写下了每一轮改了什么(prompt 还是标注)以及原因。
- prompt 定稿后在 test 上只跑了一次,TPR、TNR、kappa、评分器版本号、模型名都记进了 `part06/notes.md`。
- 你能用 `correct_rate.py` 的模拟说明修正公式为什么成立,并说出它什么时候失效。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 对齐 alignment | 拿人工标注检验评分器,看它和人的判断有多一致,并据此调整评分器或标准 |
| 对齐集 | 用来对齐的人工标注数据,今天是 40 条,分 train/dev/test |
| train / dev / test(对齐集里) | train 只用来挑 prompt 里的例子;dev 反复跑、调 prompt;test 定稿后只跑一次 |
| 混淆矩阵 confusion matrix | 人和评分器的判断两两组合的 2×2 计数表,四格是 TP、FN、FP、TN |
| TP / FN / FP / TN | 人 pass 评分器 pass / 人 pass 评分器 fail / 人 fail 评分器 pass / 人 fail 评分器 fail |
| TPR 真正率 | TP / (TP + FN),人判 pass 的里评分器也判 pass 的比例,低了说明太严 |
| TNR 真负率 | TN / (TN + FP),人判 fail 的里评分器也判 fail 的比例,低了说明太松 |
| 准确率 accuracy | (TP + TN) / n,会被类别比例骗 |
| Cohen's kappa | 扣掉碰巧一致之后的一致程度,1 完全一致,0 等于瞎猜 |
| 碰巧一致率 pe | 两边各按自己的比例随便判时,碰巧一致的概率 |
| 修正通过率 | 用 TPR、TNR 把评分器报的通过率换算成真实通过率的估计,θ = (p_obs + TNR − 1) / (TPR + TNR − 1) |
| 标准漂移 criteria drift | 人看过一批样本后,对判定标准的理解发生变化。要记录,不要藏 |
| 标注工具 annotation tool | 帮人一条条看样本、记判断的小程序,今天是终端版的 `label.py` |
| `input()` | Python 内置函数,在终端等用户输入一行并返回字符串 |

## 常见误区

**只看准确率。** dev 上永远说 pass 的「评分器」准确率 73%,kappa 是 0。分开看 TPR 和 TNR,再看 kappa。

**fail 样本太少。** 36 条模型生成的回复里,按标准只有 8 条 fail。fail 太少时 TNR 根本测不准,今天 test 上 5 条 fail 全对,真实 TNR 仍可能低到 0.6。手动改坏几条补上,fail 至少占三成。

**把生成时的「态度」当标签。** 让模型「漏掉一条要点」,它经常不漏。标签只能来自人读完之后的判断。

**例子从 dev 或 test 里挑。** 评分器等于提前看过答案,对齐的数字虚高。例子只从 train 里挑,Day 357 的 h6 就是反面教材。

**评分器一和你不一致就改 prompt。** 今天 `cancel-c023-04` 改了两版 prompt 都没用,最后发现是我的标注太严、前后不一致。先读评分器的理由,再重读自己的理由,两边都可能错。

**为了分数好看改标注。** 改标注的唯一理由是「不看评分器结论,我重新判也会这么判」,而且要在 note 里写清楚原来是什么、为什么改。

**在 test 上调 prompt。** 读了 test 的错例去改,test 就变成了第二个 dev。test 上发现的问题记下来,下一轮用新数据解决。

**对齐一次管终身。** 改了评分 prompt、换了评分模型、Agent 的说话风格大变,都要重新在 test 上跑一次。所以 `JUDGE_VERSION` 和模型名每次都要打印、要记录。

## 学习资料

### 文档与文章

- [Hamel Husain · Using LLM-as-a-Judge For Evaluation: A Complete Guide](https://hamel.dev/blog/posts/llm-judge/):今天的三分法、读不一致样本迭代、和领域专家对齐都出自这篇,英文,今天读后半部分讲对齐的内容。
- [Who Validates the Validators?](https://arxiv.org/abs/2404.12272):Shreya Shankar 等人的论文,标准漂移(criteria drift)这个说法的出处,讲人在定标准时也会边看边变,所以对齐要迭代。读摘要和引言。
- [Eugene Yan · Evaluating the Effectiveness of LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/):里面比较了 kappa、相关系数等衡量评分器和人一致程度的指标,读讲指标的那一节。
- [维基百科 · 混淆矩阵](https://zh.wikipedia.org/wiki/%E6%B7%B7%E6%B7%86%E7%9F%A9%E9%98%B5):中文,看开头的表格和 TPR、TNR(也叫灵敏度、特异度)的定义。
- [Wikipedia · Cohen's kappa](https://en.wikipedia.org/wiki/Cohen%27s_kappa):英文,看「Calculation」那一节的例子,和练习 2 对照。
- [Langfuse · LLM-as-a-Judge](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge):Day 365 接入 Langfuse 后,标注可以挪到它的网页里做,评分器也能直接挂到线上 trace 上,先看看它的设计。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1wf4y1P7Mi&autoplay=0&high_quality=1" title="32.Kappa一致性检验" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>统计小菜鸟 · 32.Kappa一致性检验 · 4 分钟。用统计课的方式讲 kappa 是什么、怎么算、多少算好,正好配今天第四步。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV19h41157v4&autoplay=0&high_quality=1" title="Cohen's Kappa系数检验" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>自由未知量a · Cohen's Kappa系数检验 · 15 分钟。更详细地推一遍 kappa 的公式和例子,第一个视频看完还不踏实就看这个。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Kdsp6soqA7o" title="Machine Learning Fundamentals: The Confusion Matrix" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>StatQuest with Josh Starmer · Machine Learning Fundamentals: The Confusion Matrix · 英文,画图讲混淆矩阵四个格子,适合第一次见这张表的人。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/vP06aMoz4v8" title="Machine Learning Fundamentals: Sensitivity and Specificity" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>StatQuest with Josh Starmer · Machine Learning Fundamentals: Sensitivity and Specificity · 英文。Sensitivity 就是 TPR,Specificity 就是 TNR,统计和医学里用这两个名字。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 3 章「AI as a Judge」一节里讲评分器局限和怎么验证它的部分,英文。
- Shreya Shankar、Hamel Husain《Evals for AI Engineers》(O'Reilly,2026 年 10 月):讲评分器对齐和标注的章节是今天的延伸。

### 开源项目与代码

- [hamelsmu/evals-skills](https://github.com/hamelsmu/evals-skills):Hamel 整理的评测 skill 文件,里面有评分器对齐的步骤说明,和今天的流程对照看。
- [langchain-ai/openevals](https://github.com/langchain-ai/openevals):现成评分器 prompt 合集。拿一个它的要点类评分器,用今天的 `align.py` 在你的 dev 上跑一遍,你会更明白为什么通用评分器要先对齐才能用。

## 自测

1. 评分器在对齐集上准确率 90%,你能说它很好吗?还需要什么信息?

<details><summary>答案</summary>

不能。要看类别比例和混淆矩阵:如果 90% 的样本都是 pass,永远说 pass 也有 90% 的准确率,TNR 却是 0。要分别看 TPR、TNR,再看 kappa;还要看 fail 样本有多少条,条数少时 TNR 本身就测不准。

</details>

2. 为什么对齐数据要分 train、dev、test 三份?prompt 里的例子从哪份挑?

<details><summary>答案</summary>

dev 用来反复调 prompt,调着调着评分器就会对 dev 过拟合,所以要留一份 test 只在定稿后跑一次,对外报 test 上的数。例子只能从 train 挑,从 dev 或 test 挑的话,评分器等于提前看过答案,分数虚高。

</details>

3. 今天 `cancel-c023-04` 上评分器和人不一致,改了两版 prompt 都没用,最后改了标注。什么情况下可以改标注?

<details><summary>答案</summary>

只有当你不看评分器的结论、重新独立判断也会这么判时才改,并且在 note 里写清原来的标签、改的原因。今天改是因为重读后发现这条和 `cancel-c023-08` 意思差不多,我却一个判 fail 一个判 pass,是我自己的标准前后不一致。为了让分数好看去改标注,等于悄悄改期望值让测试变绿。

</details>

4. 评分器 TPR = 0.9、TNR = 0.8,它报测试集通过率 70%。修正后大约是多少?

<details><summary>答案</summary>

θ = (0.70 + 0.80 − 1) / (0.90 + 0.80 − 1) = 0.50 / 0.70 ≈ 0.714,约 71%。

</details>

5. test 上评分器 TNR 是 1.000,但只来自 5 条 fail。这个数可信吗?

<details><summary>答案</summary>

只能说明「目前没发现它放过坏回复」。就算真实 TNR 只有 0.6,5 条全判对的概率也有 0.6⁵ ≈ 7.8%。要把 TNR 测准,需要几十条 fail 样本;汇报时要写明 fail 样本数。

</details>

6. (面试题)「你用 LLM 做评估,怎么证明评估结果可信?」

<details><summary>答案</summary>

要点:准备领域专家的人工标注作为对齐集,fail 样本要足够(至少三成,不够就手动改坏补);按标准分成 train(挑 few-shot)、dev(迭代 prompt)、test(定稿后只跑一次);在 test 上报 TPR、TNR 和 kappa,而不是准确率,并写明样本数;迭代时读每一条人和评分器不一致的样本,两边都可能错,改标注要有记录(标准漂移);评分器有版本号,改 prompt、换模型后重新对齐;汇报通过率时用 TPR、TNR 修正,并说明修正值的不确定性;评分器最好和被测 Agent 用不同厂商的模型。

</details>

## 明天预告

Day 359 · LLM-as-judge(四):偏差和成本。今天的对齐里,评分器对长回复、热情回复、短回复都没有明显偏心,但这只是「单条判定」的情况。一旦让评分器比较两条回复哪条更好,它会偏向放在前面的那条,还会偏向更长的那条。明天做一个交换顺序的实验,亲眼看位置偏差,再算一笔账:一轮全量评分要花多少钱,怎么省。
