---
title: 'Day 657 · 第 94 周复习:作品(Day 651–656)'
description: '把 Loupe 这一周的数据入口线通读一遍:PRD、Run 和 Step、OTel 约定、三个导入器、统一入口、SDK、假数据。画知识地图,每天一句话回顾,写一个只用本周知识的体检脚本 loupe/check.py,默写 normalize 并用脚本自检,最后用变异测试查查本周的测试有没有真的守住东西。'
pubDate: 2026-10-27
regime: none
tags: ['agent-loupe', 'review', 'testing', 'mutation-testing', 'agent-zero']
series: 'agent-zero'
day: 657
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 656](/blog/agent-zero/day-656-loupe-detect/) 把三个导入器接成 `import_any`:只看内容认格式,认不出或解析失败时抛 `ImportFormatError`;用 `loupe_sdk` 给天气 Agent 加了记录,得到一条成功和一条崩溃的真实 trace;写了造数脚本,一万步的合成 trace 导入约 0.7 到 1.3 秒。

今天不学新东西。这一周(Day 651 到 656)有六天,每天都在上一天的基础上加一块,复习日的用处是把它们串成一张图,把踩过的坑集中看一遍,然后用只有这周才有的材料做一件事:检查我们写的东西到底靠不靠得住。

## 今天要解决的问题

学完今天,你应该能做到:

1. 不看文章,画出 Loupe 数据入口线的知识地图:三种来源、导入器、`normalize`、统一入口各管什么,数据在每一步变成什么样。
2. 用一句话说出这周每天的核心,并说得出每个坑是哪天踩的。
3. 写出 `loupe/check.py`:对任意一个 trace 文件做「体检」,查编号、时间、汇总、能不能重跑,并用测试钉住。
4. 默写出 `normalize`,用脚本对照真实实现自检;用变异测试判断一个测试有没有真的守住东西。

预计用时 3.5 小时:读回顾和知识地图 30 分钟,写体检脚本 1 小时,默写和自检 1 小时,变异测试 1 小时。今天不调模型,花费 0。这是复习日,允许比平时长。

前置:[Day 651](/blog/agent-zero/day-651-loupe-prd/) 到 [Day 656](/blog/agent-zero/day-656-loupe-detect/) 全部,尤其是 `models.py`、三个导入器和 `importers/__init__.py`。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `check_trace` 的四条错误规则和 `normalize` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 本周知识地图

先看全貌。这一周做的事情,一张图能放下:

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="Loupe 数据入口线:左边三种来源文件,中间各自的导入器,汇入统一入口 import_any,经过 normalize 得到 Run 和 Step,右边是后面几周要用到它的功能">
<rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<text x="20" y="24" fill="var(--ink-faint)">来源(别人的格式)</text>
<rect x="20" y="34" width="150" height="46" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="30" y="54">OTLP JSON</text><text x="30" y="70" fill="var(--ink-soft)">Day 653-654</text>
<rect x="20" y="96" width="150" height="46" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="30" y="116">Langfuse 导出</text><text x="30" y="132" fill="var(--ink-soft)">Day 655</text>
<rect x="20" y="158" width="150" height="46" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="30" y="178">自研 SDK JSONL</text><text x="30" y="194" fill="var(--ink-soft)">Day 655-656</text>
<text x="200" y="24" fill="var(--ink-faint)">导入器</text>
<rect x="200" y="34" width="120" height="46" fill="none" stroke="var(--rule)"/><text x="208" y="54">otlp.py</text><text x="208" y="70" fill="var(--ink-soft)">+ genai.py</text>
<rect x="200" y="96" width="120" height="46" fill="none" stroke="var(--rule)"/><text x="208" y="116">langfuse.py</text>
<rect x="200" y="158" width="120" height="46" fill="none" stroke="var(--rule)"/><text x="208" y="178">sdk_jsonl.py</text>
<text x="350" y="24" fill="var(--ink-faint)">入口和收尾</text>
<rect x="350" y="34" width="120" height="170" fill="none" stroke="var(--rule)"/><text x="358" y="56">import_any</text><text x="358" y="74" fill="var(--ink-soft)">detect_format</text><text x="358" y="92" fill="var(--ink-soft)">ImportFormat-</text><text x="358" y="108" fill="var(--ink-soft)">Error</text>
<text x="358" y="148">normalize</text><text x="358" y="166" fill="var(--ink-soft)">排序 重编号</text><text x="358" y="182" fill="var(--ink-soft)">补汇总</text>
<text x="500" y="24" fill="var(--ink-faint)">统一模型</text>
<rect x="500" y="34" width="120" height="76" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="508" y="54">Run</text><text x="508" y="72" fill="var(--ink-soft)">状态 token 成本</text><text x="508" y="90" fill="var(--ink-soft)">起止 标签</text>
<rect x="500" y="122" width="120" height="82" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="508" y="142">Step × N</text><text x="508" y="160" fill="var(--ink-soft)">idx parent_idx</text><text x="508" y="178" fill="var(--ink-soft)">kind 五种</text><text x="508" y="194" fill="var(--ink-soft)">UTC 时间</text>
</g>
<g stroke="var(--ink-faint)" fill="none">
<path d="M170 57 H198"/><path d="M170 119 H198"/><path d="M170 181 H198"/><path d="M320 57 H348"/><path d="M320 119 H348"/><path d="M320 181 H348"/><path d="M470 72 H498"/><path d="M470 163 H498"/>
</g>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<text x="20" y="236" fill="var(--ink-faint)">横切的东西</text>
<rect x="20" y="246" width="190" height="64" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/><text x="30" y="266">Day 651 PRD:只认这三种</text><text x="30" y="284">格式(写在非目标里)</text><text x="30" y="300" fill="var(--ink-soft)">Day 651 仓库、里程碑</text>
<rect x="225" y="246" width="190" height="64" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/><text x="235" y="266">测试:手写最小数据</text><text x="235" y="284">+ 真实样例 samples/</text><text x="235" y="300" fill="var(--ink-soft)">每个坑一个测试</text>
<rect x="430" y="246" width="190" height="64" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/><text x="440" y="266">假数据 gen_synthetic</text><text x="440" y="284">给 Day 659-663 的分页</text><text x="440" y="300" fill="var(--ink-soft)">和性能测量备料</text>
</g>
</svg>
<figcaption>琥珀色是别人的东西(来源文件),蓝色是我们自己的(SDK 格式和统一模型)。所有导入器最后都交给同一个 normalize,往后的存储、接口、前端只认 Run 和 Step,不再知道数据从哪来。</figcaption>
</figure>

这张图里有一个设计决定贯穿六天:**外面的格式只许出现在导入器里**。[Day 653](/blog/agent-zero/day-653-loupe-otel/) 把「懂含义」(`genai.py`)和 [Day 654](/blog/agent-zero/day-654-loupe-import-otlp/) 的「拆包装」(`otlp.py`)分成两层,[Day 655](/blog/agent-zero/day-655-loupe-import-langfuse/) 的两个导入器照同样的形状写,[Day 656](/blog/agent-zero/day-656-loupe-detect/) 在最外面加了一层入口。每一层都只做一件事,所以每一层都能单独测。

## 每天一句话

- [Day 651](/blog/agent-zero/day-651-loupe-prd/):先写 PRD,而且写成脚本能检查的样子:一句话、用户故事标演示日、非目标不许写「以后做」、验收指标目标带数字;再用 uv 和 pnpm 建仓库骨架,Vite 把 `/api` 转给 FastAPI,排出 Day 652 到 676 的里程碑。
- [Day 652](/blog/agent-zero/day-652-loupe-model/):`Run` 和 `Step` 两个模型,字段一个个问「谁要用它」;`kind` 只许五种,时间必须带时区并统一成 UTC;`normalize` 把乱序的步骤排好、重新编号、改好父子指向、补齐汇总,保证父的编号小于子。
- [Day 653](/blog/agent-zero/day-653-loupe-otel/):OTel GenAI 约定的十八种操作名归成五种 kind;消息、工具定义这些是 Opt-In,默认不记;消息是 `parts` 结构,用 `parts_to_openai` 转回 OpenAI 格式;真跑一次自动埋点,看它实际记了什么。
- [Day 654](/blog/agent-zero/day-654-loupe-import-otlp/):OTLP JSON 的三层嵌套和四条编码规则(ID 十六进制、枚举整数、64 位整数和纳秒时间是字符串、属性值包在 AnyValue 里);写 `otlp.py`,按 `traceId` 分组、排序、找根。
- [Day 655](/blog/agent-zero/day-655-loupe-import-langfuse/):Langfuse v2 导出的 `input`、`output` 是要再解一次的字符串,父不在这批数据里就当根;自研 SDK 一步结束写一行 JSONL,被杀时丢掉写了一半的最后一行,`sdk_jsonl.py` 把它读回来。
- [Day 656](/blog/agent-zero/day-656-loupe-detect/):`detect_format` 看内容认格式,错误写给用户看;给天气 Agent 从外面套上 SDK,得到成功和崩溃两条真实 trace,发现只有 SDK 的数据带工具定义、能重跑;造数脚本生成一万步的合成 trace。

## 小项目:给 trace 做体检

只用本周的东西,写一个自查工具:给它一个或几个 trace 文件,它用 `import_any` 读进来,检查 [Day 652](/blog/agent-zero/day-652-loupe-model/) 约定的那些不变量有没有被破坏,再告诉你这条 trace **能不能重跑**。它有三个用处:你自己写新导入器时用它验;以后有人给你一个 trace 说「Loupe 显示不对」,先体检一遍看是数据的问题还是显示的问题;Day 676 的发布前自查可以调它。

要查的规则,每一条都是本周某天踩过的:

| 代码 | 级别 | 检查什么 | 来自哪天 |
| --- | --- | --- | --- |
| E1 | 错误 | 每一步的 `idx` 等于它在列表里的位置(0、1、2……连续) | Day 652 |
| E2 | 错误 | 有父就必须 `0 <= parent_idx < idx` | Day 652 |
| E3 | 错误 | 每一步 `ended_at >= started_at` | Day 654、655 |
| E4 | 错误 | 运行的起止时间盖住所有步骤 | Day 652 |
| W1 | 警告 | 运行的输入 token 合计 = 步骤之和 | Day 652 |
| W2 | 警告 | 模型步没有消息原文(看不到对话) | Day 653 |
| W3 | 警告 | 模型步有消息但没有工具定义(不能原样重跑) | Day 656 |

前四条是「数据坏了」,有就返回非零的退出码;后三条是「数据缺东西」,只提醒。新建 `server/loupe/check.py`:

```python
# agent-loupe/server/loupe/check.py
import sys
from dataclasses import dataclass
from pathlib import Path

from loupe.importers import ImportFormatError, detect_format, import_any
from loupe.models import Trace


@dataclass
class Finding:
    level: str  # "error" 或 "warn"
    code: str
    message: str


def check_trace(trace: Trace) -> list[Finding]:
    found: list[Finding] = []
    run, steps = trace.run, trace.steps
    for pos, s in enumerate(steps):
        if s.idx != pos:
            found.append(Finding("error", "E1", f"第 {pos} 个步骤的 idx 是 {s.idx},编号不连续"))
        if s.parent_idx is not None and not 0 <= s.parent_idx < s.idx:
            found.append(Finding("error", "E2", f"步骤 {s.idx} 的父编号 {s.parent_idx} 不小于它自己"))
        if s.ended_at < s.started_at:
            found.append(Finding("error", "E3", f"步骤 {s.idx} 先结束后开始"))
    if steps and (run.started_at > min(s.started_at for s in steps) or run.ended_at < max(s.ended_at for s in steps)):
        found.append(Finding("error", "E4", "运行的起止时间没有盖住所有步骤"))
    if run.total_input_tokens != sum(s.input_tokens or 0 for s in steps):
        found.append(Finding("warn", "W1", "运行的输入 token 合计和步骤之和对不上"))
    llm = [s for s in steps if s.kind == "llm"]
    no_messages = [s.idx for s in llm if not (s.input and s.input.get("messages"))]
    if no_messages:
        found.append(Finding("warn", "W2", f"步骤 {no_messages} 是模型调用,没有记消息原文:看不到对话"))
    no_tools = [s.idx for s in llm if s.idx not in no_messages and not s.input.get("tools")]
    if no_tools:
        found.append(Finding("warn", "W3", f"步骤 {no_tools} 有消息但没有工具定义:不能原样重跑"))
    return found


def main(paths: list[str]) -> int:
    exit_code = 0
    for p in paths:
        text = Path(p).read_text(encoding="utf-8")
        try:
            fmt = detect_format(text)
            traces = import_any(text)
        except ImportFormatError as e:
            print(f"{p}: 导入失败:{e}")
            exit_code = 1
            continue
        for t in traces:
            findings = check_trace(t)
            errors = sum(f.level == "error" for f in findings)
            print(f"{p}: {fmt},{len(t.steps)} 步,运行状态 {t.run.status},{errors} 个错误,{len(findings) - errors} 个警告")
            for f in findings:
                print(f"    [{f.code}] {f.message}")
            exit_code = max(exit_code, 1 if errors else 0)
    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

<div class="line-notes">

- `from dataclasses import dataclass` 标准库的数据类([Day 50](/blog/agent-zero/day-050-dataclass/)讲过):加一个装饰器,自动生成 `__init__`。这里不用 pydantic,因为 `Finding` 是内部用的小东西,不需要校验。
- `from loupe.importers import ImportFormatError, detect_format, import_any` 用 Day 656 的入口。体检工具不关心文件是什么格式。
- `level: str  # "error" 或 "warn"` 级别只有两种。我没用 `Literal`,因为只在这一个文件里用,够简单。
- `for pos, s in enumerate(steps):` `pos` 是步骤在列表里的位置,`s.idx` 是它自己声称的编号,E1 查的就是两者是否一致。
- `if s.parent_idx is not None and not 0 <= s.parent_idx < s.idx:` 链式比较 `0 <= a < b`,Python 允许这样写,≈ JS 里的 `0 <= a && a < b`。根步骤的 `parent_idx` 是 `None`,先排除掉。
- `if s.ended_at < s.started_at:` 两个都是带 UTC 时区的 `datetime`,可以直接比较。
- `if steps and (run.started_at > min(s.started_at for s in steps)` 运行的窗口必须盖住所有步骤。先判断 `steps` 非空,因为 `min()` 对空序列会报错。
- `if run.total_input_tokens != sum(s.input_tokens or 0 for s in steps):` `input_tokens` 可能是 `None`(工具步没有),`or 0` 当 0 加。注意这是**导入后**的检查,`normalize` 补汇总时用的就是这个和,所以正常数据一定相等;不相等说明来源自己写了运行总数而且和步骤对不上。
- `no_messages = [s.idx for s in llm if not (s.input and s.input.get("messages"))]` 没有 `input`,或者 `input` 里没有 `messages`。OTLP 没开内容记录时就是前一种。
- `no_tools = [s.idx for s in llm if s.idx not in no_messages and not s.input.get("tools")]` 先排除已经算在 W2 里的(没有 `input` 的话 `s.input.get` 会炸),剩下的才查工具定义。`not s.input.get("tools")` 对 `None` 和空列表都成立。
- `exit_code = 1` 导入失败也算失败,继续检查下一个文件,不中断。
- `errors = sum(f.level == "error" for f in findings)` 对布尔值求和,`True` 当 1,得到错误条数。
- `exit_code = max(exit_code, 1 if errors else 0)` 只要有一个文件有错误,最终退出码就是 1。警告不影响退出码。
- `sys.exit(main(sys.argv[1:]))` 把 `main` 的返回值作为进程退出码,Shell 里用 `echo $?` 看,CI 里非零就算失败。

</div>

对本周的全部样例体检一遍(在 `server/` 目录下;样例文件名按你自己的):

```bash
cd /Users/你/agent-loupe/server
uv run python -m loupe.check ../samples/*.json ../samples/*.jsonl | cut -c1-110
```

```text
../samples/weather_langfuse.json: langfuse,6 步,运行状态 ok,0 个错误,1 个警告
    [W3] 步骤 [1, 5] 有消息但没有工具定义:不能原样重跑
../samples/synthetic_10k.jsonl: sdk,10000 步,运行状态 ok,0 个错误,1 个警告
    [W3] 步骤 [1, 3, 5, 7, 11, 13, 15, 18, 21, 24, 27, 30, 33, 35, 38, 41, 45, 47, 51, 54, 57, 59, 61, 63, 66, 68, 72, 76, 78, 80, 84, 88, 90, 92, 96, 1
../samples/synthetic_small.jsonl: sdk,30 步,运行状态 ok,0 个错误,1 个警告
    [W3] 步骤 [1, 3, 5, 7, 11, 13, 15, 18, 21, 24, 27] 有消息但没有工具定义:不能原样重跑
../samples/weather_fail_sdk.jsonl: sdk,3 步,运行状态 error,0 个错误,0 个警告
../samples/weather_otlp.jsonl: otlp,6 步,运行状态 ok,0 个错误,1 个警告
    [W3] 步骤 [1, 5] 有消息但没有工具定义:不能原样重跑
../samples/weather_sdk.jsonl: sdk,6 步,运行状态 ok,0 个错误,0 个警告
```

(Shell 展开 `*.json` 的顺序按文件名,所以你的输出顺序可能和我的不同。)结果和 Day 656 对比表一致:OTLP 和 Langfuse 的天气样例各有一条 W3,SDK 的是干净的;合成数据的模型步 `tools` 是 `None`,所以也有 W3(造数脚本没记工具定义,这是它的局限,不是 bug);崩溃的那条没有错误,状态 `error` 是它真实的状态。没有一条 E 开头的问题,说明三个导入器加上 `normalize` 做到了它们该保证的事。

传一个认不出的文件,看退出码(这里是在 `scratch/out/` 下随手写了个 `junk.json`):

```bash
echo '{"hello": 1}' > scratch/out/junk.json
uv run python -m loupe.check scratch/out/junk.json; echo "退出码 $?"
```

```text
scratch/out/junk.json: 导入失败:认不出格式(最外层是 ['hello'])。支持:OTLP JSON、Langfuse observation 导出、loupe_sdk 的 JSONL
退出码 1
```

测试里要证明 E 系列真的能查出问题。数据是导入器造出来的,不会有 E 错误,所以我们要**故意造坏数据**。`model_copy` 不做校验(Day 652 的误区之一),正好拿来造:

```python
# agent-loupe/server/tests/test_check.py
from pathlib import Path

from loupe.check import check_trace, main
from loupe.importers import import_any
from loupe.models import Trace

SAMPLES = Path(__file__).parents[2] / "samples"


def load(name: str) -> Trace:
    [trace] = import_any((SAMPLES / name).read_text(encoding="utf-8"))
    return trace


def codes(name: str) -> list[str]:
    return [f.code for f in check_trace(load(name))]


def test_sdk_sample_is_clean() -> None:
    assert codes("weather_sdk.jsonl") == []


def test_otlp_and_langfuse_samples_warn_about_missing_tools() -> None:
    assert codes("weather_otlp.jsonl") == ["W3"]
    assert codes("weather_langfuse.json") == ["W3"]


def test_broken_order_is_reported() -> None:
    trace = load("weather_sdk.jsonl")
    steps = list(trace.steps)
    steps[2] = steps[2].model_copy(update={"parent_idx": 4})  # model_copy 不校验,正好用来造坏数据
    steps[3] = steps[3].model_copy(update={"ended_at": steps[3].started_at.replace(year=2020)})
    bad = trace.model_copy(update={"steps": steps})
    assert [f.code for f in check_trace(bad)] == ["E2", "E3"]


def test_main_exit_code(tmp_path: Path) -> None:
    junk = tmp_path / "junk.json"
    junk.write_text('{"hello": 1}', encoding="utf-8")
    assert main([str(SAMPLES / "weather_sdk.jsonl")]) == 0
    assert main([str(junk)]) == 1
```

<div class="line-notes">

- `def load(name: str) -> Trace:` 读一个样例并导入,要求恰好一条运行。返回类型写 `Trace`,编辑器才不会把后面的 `.steps` 当成未知类型。
- `def codes(name: str) -> list[str]:` 只要问题代码列表,断言写起来短。
- `assert codes("weather_sdk.jsonl") == []` SDK 样例是干净的:有消息、有工具定义、编号连续。
- `assert codes("weather_otlp.jsonl") == ["W3"]` 刚好一个 W3,不多不少。这个断言很严,将来导入器改了行为,它会第一个红。
- `steps[2] = steps[2].model_copy(update={"parent_idx": 4})` 第 2 步的父亲改成 4,比自己的编号还大。`model_copy` 跳过校验,所以能造出「不合法」的数据。
- `steps[3].started_at.replace(year=2020)` 把第 3 步的结束时间改成 2020 年,早于开始时间。`datetime.replace` 返回换了一个字段的新对象。
- `assert [f.code for f in check_trace(bad)] == ["E2", "E3"]` 恰好报出这两个,而且顺序是按步骤的先后(第 2 步在第 3 步前)。
- `assert main([str(SAMPLES / "weather_sdk.jsonl")]) == 0` 干净文件退出码 0。
- `assert main([str(junk)]) == 1` 认不出的文件退出码 1。

</div>

```bash
uv run pytest tests/test_check.py -q
```

```text
....                                                                     [100%]
4 passed in 0.13s
```

## 动手练习

**练习 1:默写 `normalize`,用脚本自检。** 合上文章,把 [Day 652](/blog/agent-zero/day-652-loupe-model/) 的 `normalize` 默写到 `scratch/recall.py`,函数名叫 `my_normalize`。然后跑下面的自检脚本,它会把真实样例的步骤**随机打乱顺序、再随机换掉编号**(模拟来源给的编号和时间毫无关系),分别交给你的和真实的 `normalize`,比较结果。

```python
# agent-loupe/server/scratch/recall_check.py
import json
import random
from pathlib import Path

from loupe.importers.sdk_jsonl import record_to_step
from loupe.models import Run, Step, normalize
from scratch.recall import my_normalize


def load(name: str) -> tuple[Run, list[Step]]:
    records = [json.loads(line) for line in (Path("../samples") / name).read_text(encoding="utf-8").splitlines()]
    steps = [record_to_step(r) for r in records if r["type"] == "step"]
    start = next(r for r in records if r["type"] == "run_start")
    run = Run.model_validate({"id": start["id"], "name": start["name"], "started_at": start["started_at"],
                              "ended_at": start["started_at"]})
    return run, steps


def scramble(steps: list[Step], seed: int) -> list[Step]:
    """洗牌顺序,并且把 idx 也随机换号(父指向跟着换),模拟「来源给的编号和时间顺序毫无关系」。"""
    rnd = random.Random(seed)
    labels = rnd.sample(range(100, 100 + len(steps)), len(steps))
    new_label = {s.idx: labels[i] for i, s in enumerate(steps)}
    out = [s.model_copy(update={"idx": new_label[s.idx],
                                "parent_idx": new_label.get(s.parent_idx) if s.parent_idx is not None else None})
           for s in steps]
    rnd.shuffle(out)
    return out


bad = 0
for name in ("weather_sdk.jsonl", "synthetic_small.jsonl"):
    run, steps = load(name)
    for seed in range(5):
        shuffled = scramble(steps, seed)
        if my_normalize(run, shuffled).model_dump() != normalize(run, shuffled).model_dump():
            bad += 1
            print(f"不一致:{name},洗牌种子 {seed}")
print("10 组随机顺序全部一致" if bad == 0 else f"{bad} 组不一致")
```

<div class="line-notes">

- `from loupe.importers.sdk_jsonl import record_to_step` 借 Day 655 的函数,把 JSONL 里的 `step` 记录变成 `Step`,省得自己拼。
- `from scratch.recall import my_normalize` 你默写的那个文件,放在 `scratch/recall.py`。
- `records = [json.loads(line) for line in` 一行一个 JSON,整个文件读成字典列表。
- `steps = [record_to_step(r) for r in records if r["type"] == "step"]` 只留 `step` 记录。
- `start = next(r for r in records if r["type"] == "run_start")` 取 `run_start` 当运行的底子。
- `"ended_at": start["started_at"]})` 故意把结束时间写成和开始一样:这样 `normalize` 必须自己根据步骤把它撑开,才算做对。
- `labels = rnd.sample(range(100, 100 + len(steps)), len(steps))` 从 100 起取 `len(steps)` 个不重复的数字当新编号。从 100 起,是为了让新编号和原来的 0、1、2 完全无关。
- `new_label = {s.idx: labels[i] for i, s in enumerate(steps)}` 旧编号到新编号的表。
- `"parent_idx": new_label.get(s.parent_idx) if s.parent_idx is not None else None})` 父指向跟着换:根的父亲还是 `None`,其他的查表。
- `rnd.shuffle(out)` 列表顺序也打乱。现在编号、顺序都和时间无关,`normalize` 要全靠开始时间排序、自己重新编号。
- `.model_dump() != normalize(run, shuffled).model_dump()` 转成普通字典再比,两个 `Trace` 的所有字段(包括汇总数字、父子指向)都要一模一样。

</div>

```bash
uv run python -m scratch.recall_check
```

```text
10 组随机顺序全部一致
```

<details><summary>参考答案</summary>

`scratch/recall.py` 的内容就是 Day 652 的 `normalize` 换了个名字:

```python
# agent-loupe/server/scratch/recall.py
from collections import Counter
from typing import Any

from loupe.models import Run, Step, Trace


def my_normalize(run: Run, steps: list[Step]) -> Trace:
    ordered = sorted(steps, key=lambda s: (s.started_at, s.idx))
    new_idx = {s.idx: i for i, s in enumerate(ordered)}
    fixed: list[Step] = []
    for i, s in enumerate(ordered):
        parent = new_idx.get(s.parent_idx) if s.parent_idx is not None else None
        fixed.append(s.model_copy(update={"idx": i, "parent_idx": parent, "run_id": run.id}))

    models = [s.model for s in fixed if s.kind == "llm" and s.model]
    update: dict[str, Any] = {
        "total_input_tokens": run.total_input_tokens or sum(s.input_tokens or 0 for s in fixed),
        "total_output_tokens": run.total_output_tokens or sum(s.output_tokens or 0 for s in fixed),
        "total_cost_usd": run.total_cost_usd or round(sum(s.cost_usd or 0 for s in fixed), 6),
        "model": run.model or (Counter(models).most_common(1)[0][0] if models else None),
    }
    if fixed:
        update["started_at"] = min(run.started_at, fixed[0].started_at)
        update["ended_at"] = max(run.ended_at, max(s.ended_at for s in fixed))
    return Trace(run=run.model_copy(update=update), steps=fixed)
```

<div class="line-notes">

- `ordered = sorted(steps, key=lambda s: (s.started_at, s.idx))` 先按开始时间排,时间相同按旧编号。元组当排序键,先比第一个元素,相等再比第二个。
- `new_idx = {s.idx: i for i, s in enumerate(ordered)}` 旧编号到新编号的表。这就是「排序以后建一张表,父的指向查表翻译」。
- `parent = new_idx.get(s.parent_idx) if s.parent_idx is not None else None` 根步骤保持 `None`;其他的查表。表里查不到(父不存在,比如进程被杀时根没写出来)也得 `None`,Day 655 那个「树丢了」就是这里。
- `s.model_copy(update={"idx": i, "parent_idx": parent, "run_id": run.id})` 复制一份,换上新编号、新父指向、运行 id。不修改传进来的对象。
- `models = [s.model for s in fixed if s.kind == "llm" and s.model]` 所有模型步用的模型名,没记模型的跳过。
- `"total_input_tokens": run.total_input_tokens or sum(` 来源自己写了运行总数就信它(非 0),没写(0)才用步骤之和。`or` 在这里利用「0 是假值」。
- `"total_cost_usd": run.total_cost_usd or round(` 成本累加,保留 6 位小数,避免 `0.1 + 0.2` 那种浮点尾巴。
- `"model": run.model or (Counter(models).most_common(1)[0][0] if models else None),` 来源没写主要模型,就取出现次数最多的那个。`most_common(1)` 返回 `[(名字, 次数)]`,所以取 `[0][0]`。
- `update["started_at"] = min(run.started_at, fixed[0].started_at)` 运行的开始取两者较早的。`fixed[0]` 是排序后最早的步骤。
- `update["ended_at"] = max(run.ended_at, max(s.ended_at for s in fixed))` 结束取较晚的:最晚结束的步骤可能不是最后一个开始的。
- `return Trace(run=run.model_copy(update=update), steps=fixed)` 运行本身也复制一份,换上汇总。

</div>

我顺便验证了这个自检脚本**真的能抓到错**:把 `parent = new_idx.get(...)` 那一行改成 `parent = s.parent_idx`(忘了把父指向翻译成新编号),再跑:

```text
不一致:weather_sdk.jsonl,洗牌种子 0
不一致:weather_sdk.jsonl,洗牌种子 1
不一致:weather_sdk.jsonl,洗牌种子 2
不一致:weather_sdk.jsonl,洗牌种子 3
```

(只截了前四行,后面还有。)这里有个教训:**我第一版自检脚本只打乱了顺序、没换编号,这个错版本居然也通过了**,因为打乱顺序以后,按开始时间排回来,新旧编号碰巧一致,翻译表是空操作。加上随机换编号才抓得到。自检脚本本身也要验:拿一个已知错的版本跑一遍,看它红不红。

</details>

**练习 2:变异测试,看测试守没守住。** 这周的测试(我本地算上 Day 652 到 654 的一共 46 个)都是绿的。绿不等于守住了东西:一个测试可能碰巧在代码改坏以后照样通过。**变异测试**的做法是故意把代码改坏一处(叫一个「变异」),跑测试:红了,说明这处被守住了(变异被「抓到」);还是绿,说明没人守(变异「漏过」)。

写 `scratch/ex657_mutate.py`:列出八个变异,每个都复制一份干净的仓库、改一处、跑 pytest,打印抓到还是漏过。

```python
# agent-loupe/server/scratch/ex657_mutate.py
import shutil
import subprocess
import tempfile
from pathlib import Path

SERVER = Path.cwd()
MUTANTS = [
    ("langfuse 按字符串排序", "loupe/importers/langfuse.py",
     'obs.sort(key=lambda o: datetime.fromisoformat(o["startTime"]))', 'obs.sort(key=lambda o: o["startTime"])'),
    ("sdk 导入器不再容忍半截最后一行", "loupe/importers/sdk_jsonl.py", "if pos == len(lines) - 1:", "if False:"),
    ("otlp 的 intValue 不转 int", "loupe/importers/otlp.py", 'return int(v["intValue"])', 'return v["intValue"]'),
    ("时间不再要求带时区", "loupe/models.py", "Annotated[AwareDatetime, AfterValidator(_to_utc)]", "Annotated[datetime, AfterValidator(_to_utc)]"),
    ("没有 run_end 也算 ok", "loupe/importers/sdk_jsonl.py", 'end["status"] if end else "error"', 'end["status"] if end else "ok"'),
    ("sdk 不再深拷贝 input", "loupe_sdk.py", '"input": _snapshot(input)', '"input": input'),
    ("langfuse 类型名不转大写", "loupe/importers/langfuse.py", 'str(o.get("type", "")).upper()', 'str(o.get("type", ""))'),
    ("识别 Langfuse 不看 traceId", "loupe/importers/__init__.py", '"traceId" in row and "startTime" in row', '"startTime" in row'),
]

for label, rel, old, new in MUTANTS:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "agent-loupe"
        shutil.copytree(SERVER, root / "server", ignore=shutil.ignore_patterns(".venv", "__pycache__", "scratch", ".pytest_cache"))
        shutil.copytree(SERVER.parent / "samples", root / "samples", ignore=shutil.ignore_patterns("synthetic_10k.jsonl"))
        target = root / "server" / rel
        source = target.read_text(encoding="utf-8")
        assert old in source, f"{rel} 里找不到要改的那一行:{old}"
        target.write_text(source.replace(old, new), encoding="utf-8")
        result = subprocess.run(["uv", "run", "--project", str(SERVER), "python", "-m", "pytest", "-q", "-x", "-p", "no:cacheprovider"],
                                cwd=root / "server", capture_output=True, text=True)
        failed = [line.split("::")[1].split(" ")[0] for line in result.stdout.splitlines() if line.startswith("FAILED")]
        print(f"{'抓到' if result.returncode else '漏过'}  {label}" + (f"  ← {failed[0]}" if failed else ""))
```

<div class="line-notes">

- `SERVER = Path.cwd()` 当前目录,要求你在 `agent-loupe/server/` 下运行。
- `MUTANTS = [` 每个变异是四元组:标签、要改的文件、原文、改成什么。原文必须在文件里**恰好**能找到,脚本用 `assert` 检查,找不到就说明那行代码你改过,变异要跟着调整。
- `("langfuse 按字符串排序",` 第一个变异,就是 Day 655 里说的那个坑。
- `"if pos == len(lines) - 1:", "if False:"` 把「最后一行容错」这个判断永远关掉。
- `"Annotated[AwareDatetime, AfterValidator(_to_utc)]", "Annotated[datetime, AfterValidator(_to_utc)]"` 把 Day 652 的「必须带时区」降级成「随便什么时间」。
- `'"input": _snapshot(input)', '"input": input'` SDK 不拷贝,存引用。
- `with tempfile.TemporaryDirectory() as tmp:` 建一个临时目录,`with` 结束自动删除。变异只改临时副本里的文件,不碰你的真实代码。
- `shutil.copytree(SERVER, root / "server",` 把整个 `server/` 复制过去,跳过虚拟环境和缓存。`shutil.copytree` ≈ `cp -R`。
- `shutil.copytree(SERVER.parent / "samples", root / "samples", ignore=shutil.ignore_patterns("synthetic_10k.jsonl"))` 样例也要复制(测试会读),跳过 18 MB 的那个。测试里的路径是从测试文件往上两层找 `samples/`,所以临时目录的结构要和真实的一样。
- `target.write_text(source.replace(old, new), encoding="utf-8")` 在副本里做变异。
- `result = subprocess.run(["uv", "run", "--project", str(SERVER),` 用你真实仓库的虚拟环境(`--project`)、在副本目录里跑 pytest。`-x` 遇到第一个失败就停,不必跑完。`-p no:cacheprovider` 不写 `.pytest_cache`。
- `capture_output=True, text=True` 把输出抓下来当字符串,不打印到终端。
- `failed = [line.split("::")[1]` 从 `FAILED tests/test_x.py::test_name - ...` 这样的行里取出测试名。
- `'抓到' if result.returncode else '漏过'` 返回码非零(有测试红了)就是抓到;零就是漏过。

</div>

```bash
cd /Users/你/agent-loupe/server
uv run python -m scratch.ex657_mutate
```

我在补测试之前的结果,八个里漏过两个:

```text
抓到  langfuse 按字符串排序  ← test_equal_start_in_different_offsets_keeps_parent_first
抓到  sdk 导入器不再容忍半截最后一行  ← test_half_written_last_line_is_dropped_but_middle_garbage_is_an_error
抓到  otlp 的 intValue 不转 int  ← test_otlp_and_langfuse_samples_warn_about_missing_tools
抓到  时间不再要求带时区  ← test_naive_time_rejected_and_offset_converted_to_utc
抓到  没有 run_end 也算 ok  ← test_no_run_end_means_crashed
抓到  sdk 不再深拷贝 input  ← test_input_is_copied_before_the_function_mutates_it
漏过  langfuse 类型名不转大写
漏过  识别 Langfuse 不看 traceId
```

回答:哪两个漏过了?它们各自说明了什么?箭头后面是「第一个红的测试」,因为用了 `-x`,所以并不一定是最该红的那个。看第三行:`otlp 的 intValue 不转 int` 先红的居然是 `test_check.py` 里的测试,不是 Day 654 的 `test_any_value_types`。这说明什么?

<details><summary>参考答案</summary>

**漏过的两个**:

1. 「langfuse 类型名不转大写」:`observation_to_step` 里的 `.upper()` 是我写的防御(万一导出工具把 `GENERATION` 写成小写),但**没有任何测试喂过小写类型**,所以把它删了谁也不知道。要么补一个测试证明这个防御是需要的,要么承认它是没依据的猜测、删掉它。我选前者(见练习 3)。
2. 「识别 Langfuse 不看 traceId」:`looks_like_observation` 要求同时有 `traceId` 和 `startTime`。我的坏输入测试里那个 trace 列表**两个都没有**,所以只查 `startTime` 它也照样被拒绝。要让这个变异现形,得有一行**有 `startTime` 但没有 `traceId`** 的数据。

它们说明的是同一件事:测试数据太「干净」,只覆盖了典型的错,没有覆盖「只错一半」。

**第三行**:`otlp 的 intValue 不转 int` 时先红的是 `test_check.py` 而不是 `test_any_value_types`,只是因为 pytest 按文件名字母顺序跑、`-x` 遇到第一个失败就停:`test_check.py` 排在 `test_otlp.py` 前面。变异被抓到了,没问题;但这也提醒我,一个变异可能同时让好几个测试红,**「哪个测试先红」不等于「哪个测试在守这件事」**。把 `-x` 去掉才能看全。

这个脚本在我写 Day 655 的时候也救了我:最初的 `test_offsets_compare_as_times_not_strings`(两个不同偏移的时间,一早一晚)在「按字符串排序」的变异下**照样绿**,因为 `normalize` 会再按 `datetime` 排一遍,导入器里排错了看不出来。我把它换成现在的「同一时刻、不同写法」版本才抓到。当时还发现 Day 655 的深拷贝测试也有同样的问题(它在步骤结束之后才往列表里追加,删掉 `_snapshot` 照样绿)。这两个测试我自己写完都觉得没问题,只有变异测试才暴露它们是「摆设」。

</details>

**练习 3:补两个测试,杀死两个幸存的变异。** 在 `tests/test_langfuse.py` 和 `tests/test_detect.py` 各加一个测试,让练习 2 里漏过的两个变异被抓到。然后重跑 `ex657_mutate`,八个应该全部抓到。

<details><summary>参考答案</summary>

追加到 `tests/test_langfuse.py` 末尾:

```python
# 追加到 agent-loupe/server/tests/test_langfuse.py 末尾
def test_lowercase_type_names_still_map() -> None:
    rows = [obs("g", "generation", "2026-10-27T05:00:00Z", "2026-10-27T05:00:01Z")]
    [trace] = import_langfuse(json.dumps(rows))
    assert trace.steps[0].kind == "llm"
```

<div class="line-notes">

- `rows = [obs("g", "generation",` 用这个文件里已有的 `obs` 小工厂造一行,类型故意写成小写 `generation`。
- `assert trace.steps[0].kind == "llm"` 小写也认得出是模型调用。没有 `.upper()` 的话它会落到 `other`,这个断言就红。

</div>

追加到 `tests/test_detect.py` 末尾:

```python
# 追加到 agent-loupe/server/tests/test_detect.py 末尾
def test_rows_with_start_time_but_no_trace_id_are_not_observations() -> None:
    rows = {"data": [{"id": "x", "name": "n", "startTime": "2026-10-27T05:00:00Z"}]}
    with pytest.raises(ImportFormatError, match="没有 traceId"):
        import_any(json.dumps(rows))
```

<div class="line-notes">

- `rows = {"data": [{"id": "x", "name": "n", "startTime": "2026-10-27T05:00:00Z"}]}` 一行有 `startTime`、没有 `traceId`。这是原来的测试数据没覆盖的「只错一半」。
- `with pytest.raises(ImportFormatError, match="没有 traceId"):` 必须被拒绝,而且错误消息要说清是缺 `traceId`。只查 `startTime` 的变异会把它当成合法的 Langfuse 导出,于是不抛异常,测试红。

</div>

```bash
uv run pytest -q
uv run python -m scratch.ex657_mutate | tail -3
```

```text
46 passed in 0.22s
抓到  sdk 不再深拷贝 input  ← test_input_is_copied_before_the_function_mutates_it
抓到  langfuse 类型名不转大写  ← test_lowercase_type_names_still_map
抓到  识别 Langfuse 不看 traceId  ← test_rows_with_start_time_but_no_trace_id_are_not_observations
```

八个全抓到(上面只列了最后三行)。变异测试不是要你每次都做:它慢(每个变异跑一遍测试),而且变异要手工挑。适合在一个模块写完、觉得测试够了的时候,挑最关键的五到十个点,验一遍。挑变异的诀窍是看代码里的**判断和常量**:每一个 `if`、每一个比较符、每一个默认值,问一句「改了它,会有测试红吗」。

</details>

**验收标准**:`uv run pytest -q` 全部通过;`uv run python -m loupe.check ../samples/*.jsonl ../samples/*.json` 没有任何 `E` 开头的问题;`recall_check` 输出「10 组随机顺序全部一致」;`ex657_mutate` 八个变异全部抓到。

## 本周错题与坑

把六天里踩过的坑集中看一遍。每一个都是真的踩过(写文章时、跑代码时,或者读别人的数据时)。

| 天 | 坑 | 一句话修法 |
| --- | --- | --- |
| 651 | 依赖追最新版,当天发的包被包管理器拦下 | 写死发布满两周的版本;新发布的版本是供应链攻击的窗口 |
| 651 | pytest 报 `No module named 'loupe'` | 不是 import 写错,配 `[tool.pytest] pythonpath = ["."]` |
| 651 | Vite 代理 502,终端里 `ECONNREFUSED` | 先看后端起没起,`curl` 后端本身 |
| 652 | 时间字段只写 `datetime`,混进不带时区的 | 用 `AwareDatetime` 在门口拦,进来统一转 UTC |
| 652 | `model_copy` 以为会校验 | 它不校验;只用它改自己算出来的值(它也因此能拿来造坏数据) |
| 652 | 一步报错就把运行标成失败 | `status` 只回答「有没有正常结束」,报错步数单独统计 |
| 653 | 以为 trace 里一定有对话内容 | 消息、工具定义都是 Opt-In,默认不记,拿到别人的 trace 先看有没有 |
| 653 | `gen_ai.input.messages` 当列表遍历 | Python 里它是 JSON 字符串,先 `maybe_json` |
| 654 | `intValue` 不转 int | 在最底层的 `any_value` 里转,进了 pydantic 字段会被宽松转好,看着没事 |
| 654 | 忘了 `provider.shutdown()` | 批处理器攒着的 span 没写出去,根 span 常常就是丢的那个 |
| 654 | 整个文件只 `json.loads` 一次 | JSONL 会报 `Extra data`,两种都试 |
| 655 | Langfuse 的 `input`、`output` 当对象用 | v2 接口一律是字符串,导入时解开 |
| 655 | `fields` 参数不点名 `io`、`usage` | 默认只给 core 和 basic,整个字段不出现 |
| 655 | 测试写了但根本没守住东西 | 把代码改坏看测试红不红;`normalize` 会二次排序,导入器里排错看不出来 |
| 655 | SDK 的拷贝测试在步骤结束后才追加 | 要在函数体**里面**改参数才测得到 |
| 656 | `**kwargs` 的参数被记成嵌套字典 | 被装饰的函数把参数名一个个写出来 |
| 656 | `KeyError` 直接冒到用户面前 | 入口统一包成 `ImportFormatError`,带上原始异常类型 |
| 656 | 空结果不吭声 | `{"resourceSpans": []}` 不抛异常,返回空列表,要主动说「一条运行也没有」 |
| 656 | 拿一次测量的耗时下结论 | 同一个文件我测过 0.71、0.83、1.27 秒,多测几次看范围 |

这一周还有一个没写进表格的总结:**每一次「我觉得没问题」后面都是一个测试没守住的地方**。Day 655 的两个测试、Day 656 的自检脚本、今天的变异测试,都是同一个教训的不同面孔:自己写的东西,要有办法证明它会在该红的时候红。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 体检脚本 | 对一份数据检查一组不变量,报告哪些被破坏,类似 lint,但检查的是数据不是代码 |
| 不变量(invariant) | 无论怎么操作都应该保持成立的条件,比如「父的编号小于子」 |
| 变异测试(mutation testing) | 故意把代码改坏一处,看测试红不红;红了叫「抓到」,没红叫「漏过」 |
| 变异(mutant) | 改坏了一处的代码副本 |
| 幸存的变异 | 改坏以后测试仍然全绿的变异,说明那处没有测试守着 |
| 默写自检 | 默写完一个函数,拿脚本和标准实现对照,不一致就能复现 |
| 退出码(exit code) | 进程结束时返回给 Shell 的数字,0 是成功,非 0 是失败,CI 靠它判断 |
| `dataclass` | 标准库里的数据类装饰器,自动生成 `__init__` 等方法 |

## 常见误区

**以为测试全绿就守住了。** 绿只说明「这些测试没发现问题」。一个测试如果在代码被改坏以后照样绿,它就是摆设。重要的判断和边界,至少试一次「改坏看红不红」。

**默写完就当会了。** 默写以后要拿脚本和标准实现对照,而且对照用的数据要能暴露错误。我第一版自检只打乱顺序,一个忘了翻译父指向的错版本照样通过。

**体检脚本里只查「导入器造得出来的错」。** 导入器和 `normalize` 本来就保证编号连续、父小于子,正常数据一条 E 都不会有,这样的检查永远是绿的,看不出它有没有用。要用 `model_copy` 故意造坏数据,证明检查会红。

**把警告当错误。** W 系列(没有消息原文、没有工具定义)是「数据缺东西」,不是「数据坏了」。OTLP 默认不记内容是规范允许的,不该让文件导入失败。区分级别,只有真正的不一致才影响退出码。

**一个变异只看第一个红的测试。** `-x` 加上按文件名排序,让第一个红的不一定是最相关的。只想知道抓没抓到可以用 `-x`;想知道谁在守这件事,去掉 `-x` 看全。

**复习日只回顾不动手。** 一周的东西只读一遍,两天后忘一半。默写、体检、变异三件事每一件都是在逼你把代码再过一遍。

## 学习资料

### 文档与文章

- [mutmut 文档](https://mutmut.readthedocs.io/):Python 里最常用的变异测试工具之一,自动挑变异、自动跑测试。读「Getting started」,看它是怎么报告幸存变异的,今天的手写脚本就是它的缩小版,15 分钟。
- [pytest 文档:退出码](https://docs.pytest.org/en/stable/reference/exit-codes.html):pytest 各种退出码的含义,`ex657_mutate` 靠返回码判断抓没抓到,5 分钟。
- [Python 文档:dataclasses](https://docs.python.org/3/library/dataclasses.html):读开头的例子,10 分钟。
- [OpenTelemetry GenAI 约定:Spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md):复习 Day 653,对照 `KIND_BY_OPERATION` 看规范里的操作名有没有新增,20 分钟。
- [Pydantic 文档:Validators](https://docs.pydantic.dev/latest/concepts/validators/):复习 `AfterValidator` 和 `AwareDatetime` 那几行是怎么起作用的,15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1w3HrePENj&autoplay=0&high_quality=1" title="基于 Opentelemetry 的大模型应用可观测丨阿里云云原生研发工程师李艳红(彦鸿)发表主题演讲" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里云云原生 · 基于 Opentelemetry 的大模型应用可观测 · 19 分钟。复习这周的 OTel 部分:一线团队怎么设计大模型应用的 span、哪些属性默认记、哪些要打开。2024 年的演讲,属性名以 Day 653 读的规范为准。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JKmeY9ED2&autoplay=0&high_quality=1" title="[Python] Pydantic 让数据结构与验证融为一体" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>隔壁的程序员老王 · [Python] Pydantic 让数据结构与验证融为一体 · 10 分钟。复习 Day 652 的 Run 和 Step 为什么用 pydantic:数据进门时就校验,写错了当场报错。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/RNaa_48LWBY" title="Making GenAI Observable with OpenTelemetry" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>wiggitywhitney · Making GenAI Observable with OpenTelemetry · 16 分钟,英文。演示 GenAI span 在实际工具里长什么样,对照这周导入器处理的那些字段。</figcaption>
</figure>

### 书籍

- **Observability Engineering**,Charity Majors、Liz Fong-Jones、George Miranda,O'Reilly,2022。这周的主题就是「怎么把运行时的事件记下来、串起来、看懂」,复习时挑第 5 章到第 7 章再读一遍,约 1.5 小时。
- **Software Engineering at Google**,Titus Winters、Tom Manshreck、Hyrum Wright,O'Reilly,2020。第 11、12 章讲测试的目的和单元测试怎么写,「测试要能抓到真的错误」那几页对应今天的变异测试,约 1 小时。
- **Python Testing with pytest**(第 2 版),Brian Okken,Pragmatic Bookshelf,2022。参数化、fixture、`tmp_path` 这周都用了,翻到对应章节补细节,按需读。

### 开源项目与代码

- [boxed/mutmut](https://github.com/boxed/mutmut):Python 的变异测试工具,看它支持哪些种类的变异(改比较符、改常量、删语句),想想今天的手写变异属于哪一类。
- [Arize-ai/openinference](https://github.com/Arize-ai/openinference):另一套大模型 trace 的约定和埋点库,和 GenAI 约定并存,体会「同一件事两套命名」时,为什么导入器要和内部模型隔开。

## 自测

1. 说出 Loupe 数据入口线上每一层的职责:来源、导入器、`normalize`、统一入口。为什么外面的格式只许出现在导入器里?

<details><summary>答案</summary>

来源是别人的文件(OTLP、Langfuse 导出)或我们自己 SDK 的文件;导入器负责「拆包装」并把含义转成我们的 `Step` 和 `Run`;`normalize` 负责排序、重新编号、改父指向、补汇总,保证统一模型的不变量;统一入口 `import_any` 负责认格式、选导入器、把各种失败变成给用户看的错误。外面的格式只在导入器里出现,是因为格式会变(GenAI 约定还在 Development 状态),把变化隔在一层里,后面的存储、接口、前端、对比、重跑全都只依赖稳定的内部模型,规范变了只改一个导入器。

</details>

2. 体检脚本的 E 系列和 W 系列有什么区别?为什么只有 E 影响退出码?

<details><summary>答案</summary>

E 是「数据坏了」:编号不连续、父不小于子、先结束后开始、运行窗口没盖住步骤,这些违反了统一模型的不变量,后面的代码(分页、时间轴、对比)会基于不变量写,数据一坏就会出莫名其妙的错。W 是「数据缺东西」:没有消息原文、没有工具定义,是来源本身的限制(OTLP 默认不记内容是规范允许的),文件仍然是合法的、能显示,只是不能做某些事(重跑)。所以 W 只提醒,E 才让退出码非零、让 CI 失败。

</details>

3. 为什么拿一个正常导入出来的 trace 测体检脚本的 E 规则是不够的?怎么办?

<details><summary>答案</summary>

导入器和 `normalize` 本来就保证了这些不变量,正常数据不会触发任何 E,测试永远是绿的,证明不了规则会在该红的时候红。要故意造坏数据:用 `model_copy` 跳过校验,把父编号改大、把结束时间改到开始之前,断言恰好报出对应的 E 代码。

</details>

4. 什么是「幸存的变异」?练习 2 里漏过的两个说明了什么?

<details><summary>答案</summary>

变异测试里,把代码故意改坏一处后,测试仍然全绿,这个变异就「幸存」了,说明被改的那一处没有任何测试守着。练习 2 里「不转大写」幸存,是因为没有测试喂过小写的类型名,那处防御没有依据;「不看 traceId」幸存,是因为坏输入测试里的数据两个字段都缺,只缺一个的情况没覆盖。共同原因是测试数据太典型,没有覆盖「只错一半」。

</details>

5. 默写 `normalize` 时,为什么自检脚本要把编号也随机换掉,只打乱顺序不够?

<details><summary>答案</summary>

只打乱列表顺序、不改编号的话,按开始时间排回来以后,新编号恰好等于旧编号,「把父指向翻译成新编号」这一步成了空操作,一个忘了翻译的错版本也会通过。把旧编号随机换成和时间无关的数(比如 100 起的乱序数),`normalize` 就必须真的建旧到新的对照表并翻译父指向,漏掉的版本才会暴露。自检脚本本身也要用一个已知错的版本验证它会红。

</details>

6. 面试题:你写了一批测试,全绿。怎么向同事证明这些测试不是摆设?

<details><summary>答案</summary>

先看覆盖率,知道哪些代码没被执行过,但覆盖率只说明「跑过」,不说明「守住」。更直接的是变异测试:挑最关键的判断、比较符、常量,故意改坏,看测试会不会红;红了说明在守,不红就补测试。可以用 mutmut 这类工具自动做,也可以手工挑十个点。另外在写测试时就用「先让它红」的习惯:先写测试、确认它在功能缺失时红,再让它变绿。测试数据要覆盖典型错误之外的「只错一半」和边界(空、同一时刻、缺一个字段)。

</details>

## 明天预告

明天是 Day 658,Loupe(六):先定接口再定表,表设计。这一周的数据入口已经把三种来源变成了统一的 `Run` 和 `Step`,但它们现在只活在内存里,服务一重启就没了。下周开始存下来:明天先问「前端要哪几个接口」,再倒推需要哪几张 SQLite 表、哪些列、建哪些索引,建出表来,用 Day 656 的合成数据和真实样例试写一遍。
