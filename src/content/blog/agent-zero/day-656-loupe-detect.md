---
title: 'Day 656 · Loupe(五):统一入口自动识别格式,给 Agent 加记录,造假数据'
description: '把三个导入器接成一个入口:看文件内容(不看扩展名)认出是 OTLP、Langfuse 还是自研 SDK 的 JSONL,认不出时给一句说人话的错误。然后用 loupe_sdk 给 Day 649 的天气 Agent 加记录,真跑一次成功的、一次故意查不存在的城市的失败的,得到两条真实 trace;最后写造数脚本生成一万步的合成 trace,量一下导入要多久。'
pubDate: 2026-10-27
regime: none
tags: ['agent-loupe', 'importer', 'sdk', 'synthetic-data', 'agent-zero']
series: 'agent-zero'
day: 656
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 655](/blog/agent-zero/day-655-loupe-import-langfuse/) 写了第二、第三个导入器:`importers/langfuse.py` 读 Langfuse v2 接口导出的 observation(`input`、`output` 是字符串要再解一次,时间按 `datetime` 排),`loupe_sdk.py` 加 `importers/sdk_jsonl.py` 是我们自己的格式(一步结束写一行 JSONL,被杀时丢掉写了一半的最后一行)。加上 [Day 654](/blog/agent-zero/day-654-loupe-import-otlp/) 的 OTLP,三个导入器都有了,每个都有测试。

可是三个导入器现在还是三个函数,调用方得先知道文件是哪种格式才能选对函数。今天接成一个入口,然后做两件 Day 655 留着的事:用 SDK 给真正的 Agent 加记录,产出一条成功和一条失败的真实 trace;再造一份大数据,为后面的分页和性能做准备。

## 今天要解决的问题

学完今天,你应该能做到:

1. 写出 `importers/__init__.py` 的 `detect_format` 和 `import_any`:只看内容就认出三种格式,认不出或解析失败时给一句说人话的 `ImportFormatError`,而不是一个 `KeyError`。
2. 用 `loupe_sdk` 给 Day 649 的天气 Agent 加上记录,**不改 `weather_agent.py` 一行**,得到一条成功的和一条失败的真实 SDK trace。
3. 对比同一个 Agent 用三种来源导入的差别,说出哪一种能支持 Day 669 的「从某一步重跑」,为什么。
4. 写出造数脚本 `samples/gen_synthetic.py`,生成 30 步和 1 万步的合成 trace,量出导入 1 万步要多久。

预计用时 3 小时。正文真调模型两次:成功那次天气 Agent 约 ¥0.0025(两次模型调用,输入 799、输出 211 tokens),失败那次只有一次模型调用,我估算约 ¥0.001(它在工具里崩了,没来得及打印账本)。全天不到 ¥0.005,模型一直是 `deepseek-flash`。练习不调模型。

前置:[Day 655](/blog/agent-zero/day-655-loupe-import-langfuse/)(三个导入器、`loupe_sdk.py`)、[Day 654](/blog/agent-zero/day-654-loupe-import-otlp/)(`samples/weather_otlp.jsonl`)、[Day 649](/blog/agent-zero/day-649-loupe-why/)(`part11/weather_agent.py`)、[Day 71](/blog/agent-zero/day-071-pytest-1/)(pytest 和 `parametrize`)。

学法提示:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `detect_format` 的四条规则和 `import_any` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 统一入口:认出是哪种格式

先想一个问题:用户把文件拖进 Loupe 的网页(Day 659 才做上传接口,但入口要先准备好),我们怎么知道它是什么?

**别看扩展名。** 三种格式的文件名都没规矩:OTLP 的文件出口写出来是 `.jsonl`,Langfuse 的导出是用户 `curl ... > export.json` 随手起的名字,我们自己的 SDK 默认叫 `runs.jsonl`。OTLP 和 SDK 都是 `.jsonl`,光看后缀根本分不开。要看内容。

三种格式的「指纹」其实很分明:

| 格式 | 整个文件是 | 最外层的指纹 |
| --- | --- | --- |
| OTLP JSON | 一个 JSON,或一行一个 JSON | 有 `resourceSpans` 键 |
| Langfuse 导出 | 一个 JSON(`{"data": [...]}`、数组),或一行一页 | 有 `data`(或 `observations`)数组,每一项有 `traceId` 和 `startTime` |
| SDK 的 JSONL | 一行一条记录 | 每行有 `type`,取值是 `run_start`、`step`、`run_end` 之一 |

做法是:看第一个文档。整个文件能解析成一个 JSON,就看它;不能,就取第一个非空行当 JSON 看。然后按上表判断。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="detect_format 的判断流程:先取第一个文档,再依次看 resourceSpans、type、数据数组,最后给出 otlp、sdk、langfuse 或报错">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<rect x="20" y="20" width="170" height="40" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="30" y="44">取第一个文档</text>
<rect x="230" y="20" width="190" height="40" fill="none" stroke="var(--rule)"/>
<text x="240" y="44">有 resourceSpans ?</text>
<rect x="460" y="20" width="160" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="470" y="44">→ otlp</text>
<rect x="230" y="90" width="190" height="40" fill="none" stroke="var(--rule)"/>
<text x="240" y="114">type 是 run_start/step/run_end ?</text>
<rect x="460" y="90" width="160" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="470" y="114">→ sdk</text>
<rect x="230" y="160" width="190" height="40" fill="none" stroke="var(--rule)"/>
<text x="240" y="184">数组 / data / observations ?</text>
<rect x="460" y="160" width="160" height="40" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="470" y="184">首项有 traceId → langfuse</text>
<rect x="230" y="224" width="390" height="32" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="240" y="245">都不是 → ImportFormatError(说清最外层是什么)</text>
</g>
<g stroke="var(--ink-faint)" fill="none">
<path d="M190 40 H228"/><path d="M420 40 H458"/><path d="M325 60 V88"/><path d="M420 110 H458"/><path d="M325 130 V158"/><path d="M420 180 H458"/><path d="M325 200 V222"/>
</g>
<g font-family="var(--font-mono)" font-size="10" fill="var(--ink-soft)">
<text x="332" y="78">否</text><text x="332" y="148">否</text><text x="332" y="214">否</text>
</g>
</svg>
<figcaption>三道关卡一个出口。顺序有讲究:SDK 的判断放在 Langfuse 前面,因为 Langfuse 的 observation 里也有 type 键,只是取值不在我们那三个词里,不会被误认。</figcaption>
</figure>

### 错误要写给用户看

识别不出来的时候,调用方(以后是上传接口,再以后是网页)要告诉用户**哪里不对**。所以不能让 `KeyError: 'traceId'` 这种东西冒出去。定义一个专门的异常,消息就是给人看的话:

```python
# agent-loupe/server/loupe/importers/__init__.py
import json
from typing import Any, Literal

from pydantic import ValidationError

from loupe.models import Trace

from .langfuse import import_langfuse
from .otlp import import_otlp
from .sdk_jsonl import import_sdk_jsonl

Format = Literal["otlp", "langfuse", "sdk"]
SDK_RECORD_TYPES = ("run_start", "step", "run_end")


class ImportFormatError(ValueError):
    """文件认不出来,或者认出来了但解析失败。消息是写给上传文件的人看的。"""


def first_document(text: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    first_line = next((line for line in text.splitlines() if line.strip()), "")
    try:
        return json.loads(first_line)
    except json.JSONDecodeError:
        raise ImportFormatError("不是 JSON,也不是一行一个 JSON(JSONL)的文件") from None


def looks_like_observation(row: Any) -> bool:
    return isinstance(row, dict) and "traceId" in row and "startTime" in row


def detect_format(text: str) -> Format:
    if not text.strip():
        raise ImportFormatError("文件是空的")
    doc = first_document(text)
    if isinstance(doc, dict) and "resourceSpans" in doc:
        return "otlp"
    if isinstance(doc, dict) and doc.get("type") in SDK_RECORD_TYPES:
        return "sdk"
    rows: Any = None
    if isinstance(doc, list):
        rows = doc
    elif isinstance(doc, dict):
        rows = doc.get("data") or doc.get("observations")
    if isinstance(rows, list) and rows:
        if looks_like_observation(rows[0]):
            return "langfuse"
        raise ImportFormatError("像 Langfuse 导出,但每一项没有 traceId 和 startTime:要的是 observation 列表,不是 trace 列表")
    keys = sorted(doc)[:6] if isinstance(doc, dict) else type(doc).__name__
    raise ImportFormatError(f"认不出格式(最外层是 {keys})。支持:OTLP JSON、Langfuse observation 导出、loupe_sdk 的 JSONL")


def import_any(text: str) -> list[Trace]:
    fmt = detect_format(text)
    importer = {"otlp": import_otlp, "langfuse": import_langfuse, "sdk": import_sdk_jsonl}[fmt]
    try:
        traces = importer(text)
    except (KeyError, TypeError, ValueError, ValidationError) as e:
        raise ImportFormatError(f"按 {fmt} 解析失败:{type(e).__name__}: {str(e)[:200]}") from e
    if not traces:
        raise ImportFormatError(f"识别成 {fmt},但里面一条运行也没有")
    return traces
```

<div class="line-notes">

- `from pydantic import ValidationError` pydantic 校验失败时抛的异常。导入器里 `Step.model_validate` 出错就是它,要在入口统一接住。
- `from .langfuse import import_langfuse` 开头的点是**相对导入**:`.` 表示「同一个包里」,这个包是 `loupe.importers`。≈ JS 的 `import x from './langfuse'`。包的 `__init__.py` 在 `import loupe.importers` 时自动执行,所以别的地方写 `from loupe.importers import import_any` 就行。
- `Format = Literal["otlp", "langfuse", "sdk"]` 起一个类型别名,返回值只可能是这三个字符串之一,编辑器能帮你查拼写。
- `SDK_RECORD_TYPES = ("run_start", "step", "run_end")` 我们自己的三种记录类型,放成常量,识别和以后别的地方共用。
- `class ImportFormatError(ValueError):` 继承 `ValueError`,所以 Day 655 里写的 `except ValueError` 仍然接得住;又因为有专属类型,Day 659 的上传接口可以只接它,换成 HTTP 422 返回给用户。
- `def first_document(text: str) -> Any:` 取「第一个文档」。
- `return json.loads(text)` 先试整个文件是不是一个 JSON。Langfuse 的单文件导出、只有一行的 SDK 文件走这里。
- `except json.JSONDecodeError:` 整个文件不是一个 JSON(OTLP 的 JSONL、多行的 SDK 文件会走到这里,因为 `json.loads` 解完第一个对象发现后面还有东西,报 `Extra data`),`pass` 表示「失败了,往下试另一个办法」。
- `first_line = next((line for line in text.splitlines() if line.strip()), "")` 第一个非空行。`next(生成器, 默认值)` 取第一个元素,一个都没有就用 `""`。
- `raise ImportFormatError("不是 JSON,也不是一行一个 JSON(JSONL)的文件") from None` 两种都失败。`from None` 把里面那个 `JSONDecodeError` 藏起来,用户不需要看 Python 内部的异常链。
- `return isinstance(row, dict) and "traceId" in row and "startTime" in row` observation 的指纹:是字典,有 `traceId` 和 `startTime`。
- `if not text.strip():` 空文件或只有空白,单独给一句话。不然会落到 `first_document` 里报「不是 JSON」,用户看了会困惑。
- `if isinstance(doc, dict) and "resourceSpans" in doc:` OTLP 的指纹。
- `doc.get("type") in SDK_RECORD_TYPES` SDK 的指纹:第一行是个有 `type` 的字典,而且取值是我们的三种之一。注意这个判断放在 Langfuse 前面,因为 Langfuse 的 observation 里也有 `type` 键(值是 `GENERATION` 之类),不过它们不在 `SDK_RECORD_TYPES` 里,所以不会误判。
- `rows = doc.get("data") or doc.get("observations")` Langfuse 的指纹:`data` 或 `observations` 里装着行。
- `if looks_like_observation(rows[0]):` 只看第一行,够判断了。
- `raise ImportFormatError("像 Langfuse 导出,但每一项没有 traceId 和 startTime:` 用户拉错了接口,拿到的是 trace 列表(每项是一条 trace,不是一步)。这时不能说「认不出」,要说「像,但不对,要的是什么」。
- `keys = sorted(doc)[:6] if isinstance(doc, dict) else type(doc).__name__` 认不出时,把最外层的键(最多 6 个)告诉用户。他一看 `['hello']` 就知道是不是拿错了文件。
- `importer = {"otlp": import_otlp, "langfuse": import_langfuse, "sdk": import_sdk_jsonl}[fmt]` 字典当分发表,≈ JS 里 `const importers = { otlp: importOtlp, ... }; importers[fmt]`。比一串 `if` 干净。
- `except (KeyError, TypeError, ValueError, ValidationError) as e:` 识别对了,但内容有问题:缺 `traceId`(`KeyError`)、字段类型不对(`TypeError`)、时间格式不对(`ValidationError`)。统一包成给人看的错。注意 `ValidationError` 本身就是 `ValueError` 的子类,但显式写出来,以后换了 pydantic 版本也不会漏。
- `raise ImportFormatError(f"按 {fmt} 解析失败:{type(e).__name__}: {str(e)[:200]}") from e` 带上原始异常的类型名和前 200 个字符,这样排查的人还能看到 `KeyError: 'traceId'`;`from e` 保留异常链,日志里能看到全貌。
- `if not traces:` 识别对了、解析也没报错,但里面一条运行也没有(比如 `{"resourceSpans": []}`),也要告诉用户,不要返回一个空列表让他以为导入成功了。

</div>

用几个坏输入看看它的反应:

```python
# agent-loupe/server/scratch/s19_bad_inputs.py
import json

from loupe.importers import ImportFormatError, import_any

CASES = {
    "空文件": "",
    "网关错误页": "<html><body>502 Bad Gateway</body></html>",
    "不认识的 JSON": '{"hello": 1}',
    "Langfuse trace 列表": json.dumps({"data": [{"id": "trace-1", "name": "weather"}], "meta": {}}),
    "OTLP 缺 traceId": json.dumps({"resourceSpans": [{"scopeSpans": [{"spans": [{"name": "x"}]}]}]}),
    "OTLP 但没有 span": json.dumps({"resourceSpans": []}),
}
for label, text in CASES.items():
    try:
        import_any(text)
    except ImportFormatError as e:
        print(f"{label}:{e}")
```

<div class="line-notes">

- `CASES = {` 一个字典,键是给人看的标签,值是要喂给入口的文本。六种坏法各一个。
- `"网关错误页": "<html><body>502 Bad Gateway</body></html>",` 用户从某个网页上「另存为」时存成了错误页,是真实会发生的事。
- `"Langfuse trace 列表": json.dumps({"data": [{"id": "trace-1", "name": "weather"}], "meta": {}}),` 形状像 Langfuse(有 `data` 数组),但每一项没有 `traceId` 和 `startTime`。
- `for label, text in CASES.items():` 遍历字典的键值对,≈ JS 的 `Object.entries(CASES).forEach(([label, text]) => ...)`。
- `except ImportFormatError as e:` 只接这一种异常。如果哪个坏输入冒出了别的异常(比如裸的 `KeyError`),脚本会直接崩,那说明入口有漏洞。

</div>

```bash
cd /Users/你/agent-loupe/server
uv run python -m scratch.s19_bad_inputs
```

```text
空文件:文件是空的
网关错误页:不是 JSON,也不是一行一个 JSON(JSONL)的文件
不认识的 JSON:认不出格式(最外层是 ['hello'])。支持:OTLP JSON、Langfuse observation 导出、loupe_sdk 的 JSONL
Langfuse trace 列表:像 Langfuse 导出,但每一项没有 traceId 和 startTime:要的是 observation 列表,不是 trace 列表
OTLP 缺 traceId:按 otlp 解析失败:KeyError: 'traceId'
OTLP 但没有 span:识别成 otlp,但里面一条运行也没有
```

六种坏法都落在同一个异常类型里,消息各不相同。第五条是「识别对了但内容缺东西」,保留了 `KeyError: 'traceId'` 这个原始信息,告诉排查的人是哪个字段。

### 测试:先让它红

测试里有一个会用到下一节才产生的 `weather_sdk.jsonl`。我故意先写测试、让它红一次,等下一节做完再变绿。新建 `tests/test_detect.py`:

```python
# agent-loupe/server/tests/test_detect.py
import json
from pathlib import Path

import pytest

from loupe.importers import ImportFormatError, detect_format, import_any

SAMPLES = Path(__file__).parents[2] / "samples"
SPAN = {"traceId": "aa", "spanId": "bb", "name": "invoke_agent x", "startTimeUnixNano": "1792684600000000000",
        "endTimeUnixNano": "1792684601000000000"}
OBS = {"id": "o1", "traceId": "t1", "type": "AGENT", "name": "a", "startTime": "2026-10-27T05:00:00Z",
       "endTime": "2026-10-27T05:00:01Z", "parentObservationId": None}
SDK_START = {"type": "run_start", "id": "r1", "name": "x", "started_at": "2026-10-27T05:00:00+00:00"}


def test_detect_each_shape() -> None:
    otlp = json.dumps({"resourceSpans": [{"scopeSpans": [{"spans": [SPAN]}]}]})
    assert detect_format(otlp) == "otlp"
    assert detect_format(otlp + "\n" + otlp) == "otlp"
    assert detect_format(json.dumps({"data": [OBS], "meta": {}})) == "langfuse"
    assert detect_format(json.dumps([OBS])) == "langfuse"
    assert detect_format(json.dumps({"observations": [OBS]})) == "langfuse"
    assert detect_format(json.dumps(SDK_START)) == "sdk"


def test_real_samples_detected_and_imported() -> None:
    expected = {"weather_otlp.jsonl": "otlp", "weather_langfuse.json": "langfuse", "weather_sdk.jsonl": "sdk"}
    for name, fmt in expected.items():
        text = (SAMPLES / name).read_text(encoding="utf-8")
        assert detect_format(text) == fmt
        [trace] = import_any(text)
        assert [s.kind for s in trace.steps][0] == "agent"
        assert trace.run.total_input_tokens > 0


@pytest.mark.parametrize("text,needle", [
    ("", "空的"),
    ("   \n", "空的"),
    ("<html>502 Bad Gateway</html>", "不是 JSON"),
    ('{"hello": 1}', "认不出格式"),
    ('"just a string"', "认不出格式"),
    ('{"data": [{"id": "trace-1", "name": "t"}]}', "没有 traceId"),
])
def test_unrecognized_input_says_why(text: str, needle: str) -> None:
    with pytest.raises(ImportFormatError, match=needle):
        import_any(text)


def test_recognized_but_broken_is_wrapped() -> None:
    broken = {"resourceSpans": [{"scopeSpans": [{"spans": [{"name": "no ids"}]}]}]}
    with pytest.raises(ImportFormatError, match="按 otlp 解析失败"):
        import_any(json.dumps(broken))


def test_recognized_but_empty_raises() -> None:
    with pytest.raises(ImportFormatError, match="一条运行也没有"):
        import_any(json.dumps({"resourceSpans": []}))
```

<div class="line-notes">

- `SPAN = {"traceId": "aa", "spanId": "bb",` 一个最小的 OTLP span,只有识别和解析要用的字段。`traceId` 写 `"aa"` 这种短字符串也行,`hex_id` 只要它是十六进制。
- `OBS = {"id": "o1", "traceId": "t1", "type": "AGENT",` 一个最小的 Langfuse observation。
- `SDK_START = {"type": "run_start", "id": "r1",` 一个最小的 SDK 记录,只有一行。
- `assert detect_format(otlp + "\n" + otlp) == "otlp"` 两个请求一行一个,整体不是合法 JSON,走「取第一行」那条路。
- `assert detect_format(json.dumps([OBS])) == "langfuse"` 直接是数组的形状。
- `assert detect_format(json.dumps(SDK_START)) == "sdk"` 只有一行的 SDK 文件:整体就是一个合法 JSON,走第一条路,靠 `type` 认出来。
- `expected = {"weather_otlp.jsonl": "otlp",` 三个真实文件各自该被识别成什么。最后一个文件是下一节才有的。
- `assert [s.kind for s in trace.steps][0] == "agent"` 三个来源导入后,第 0 步都应该是 agent 根。
- `@pytest.mark.parametrize("text,needle", [` 参数化:同一个测试函数跑六组数据,≈ jest 的 `test.each`。`text` 是输入,`needle` 是错误消息里应该出现的一小段。
- `with pytest.raises(ImportFormatError, match=needle):` 要同时满足两件事:抛的是这个异常类型,消息里匹配这一小段。
- `broken = {"resourceSpans": [{"scopeSpans": [{"spans": [{"name": "no ids"}]}]}]}` 识别得出是 OTLP,但 span 里没有 `traceId`。

</div>

```bash
uv run pytest tests/test_detect.py -q
```

```text
>       return io.open(self, mode, buffering, encoding, errors, newline)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
E       FileNotFoundError: [Errno 2] No such file or directory: '/Users/你/agent-loupe/samples/weather_sdk.jsonl'
...
FAILED tests/test_detect.py::test_real_samples_detected_and_imported - FileNo...
1 failed, 9 passed in 0.22s
```

九个通过,一个因为缺文件而失败。这就是预期,下一节把那个文件造出来。

## 给 Day 649 的天气 Agent 加上记录

[Day 649](/blog/agent-zero/day-649-loupe-why/) 的天气 Agent(`agent-zero-lab/part11/weather_agent.py`)就是 Loupe 想看的那种东西:调模型、调工具、再调模型。现在要让它写出 SDK 格式的 trace。关键约束是**不改 `weather_agent.py`**:记录是旁路,不该散落在业务代码里。

做法分两处。模型层:`wrap_openai(llm.client)`,给 `LLMClient` 里面那个 openai 客户端打补丁(Day 135 以来 `LLMClient` 一直把客户端放在 `self.client`)。工具层:`weather_agent.run` 在运行时按名字去模块里找 `get_weather`,所以把模块里的 `get_weather` 换成加了记录的版本就行。

先把 SDK 文件复制到练习仓库:

```bash
cp /Users/你/agent-loupe/server/loupe_sdk.py /Users/你/agent-zero-lab/part11/loupe_sdk.py
```

这个「复制一个文件就能用」正是 SDK 做成单文件的原因。然后新建:

```python
# agent-zero-lab/part11/sdk_agent.py
import sys
from typing import Any

from common.llm import LLMClient
from part11 import loupe_sdk as loupe
from part11 import weather_agent
from part11.weather_agent import TASK

OUT = sys.argv[1] if len(sys.argv) > 1 else "part11/runs/weather_sdk.jsonl"
TASK_TEXT = sys.argv[2] if len(sys.argv) > 2 else TASK


@loupe.trace_step(kind="tool", name="get_weather")
def traced_get_weather(city: str) -> dict[str, Any]:
    return raw_get_weather(city)


raw_get_weather = weather_agent.get_weather
weather_agent.get_weather = traced_get_weather  # run() 在运行时按名字找 get_weather,换掉模块里的名字就行

if __name__ == "__main__":
    llm = LLMClient()
    loupe.wrap_openai(llm.client)
    with loupe.run("weather-agent", out=OUT, tags=["weather", "deepseek"]):
        with loupe.step("agent", "weather_agent", input=TASK_TEXT) as rec:
            rec["output"] = weather_agent.run(TASK_TEXT, llm)
    print(f"已写入 {OUT};{llm.ledger}")
```

<div class="line-notes">

- `from part11 import loupe_sdk as loupe` 刚复制过来的那个文件。文章里 SDK 的文档字符串写的是 `import loupe_sdk as loupe`,在练习仓库里换成了带包名的写法,因为我们从 `agent-zero-lab/` 根目录用 `-m` 运行。
- `from part11 import weather_agent` 导入的是**整个模块**,不是里面的某个函数。这一点很关键:要改模块里的名字,必须拿到模块对象。
- `from part11.weather_agent import TASK` 默认的任务文本:「北京、上海、广州现在各多少度?算一下三个城市的平均气温。」
- `OUT = sys.argv[1] if len(sys.argv) > 1 else "part11/runs/weather_sdk.jsonl"` 命令行第一个参数是输出文件,没给就用默认。`sys.argv` ≈ Node 的 `process.argv.slice(2)`。
- `TASK_TEXT = sys.argv[2] if len(sys.argv) > 2 else TASK` 第二个参数换任务,等会儿用它造失败。
- `@loupe.trace_step(kind="tool", name="get_weather")` 装饰器。名字显式写成 `get_weather`,因为被装饰的函数叫 `traced_get_weather`,不想让它出现在 trace 里。
- `def traced_get_weather(city: str) -> dict[str, Any]:` 参数**写成 `city: str`**,不写 `**kwargs`。`trace_step` 靠 `inspect.signature` 把实参按名字对号,`**kwargs` 会被记成 `{"kwargs": {"city": ...}}`,我第一次就这么写的,导入出来是个嵌套的怪样子。
- `return raw_get_weather(city)` 调回原来的函数。`raw_get_weather` 在下面才赋值,但函数体到调用的时候才执行,那时候它已经有值了。
- `raw_get_weather = weather_agent.get_weather` 先把原函数存起来。
- `weather_agent.get_weather = traced_get_weather` 把模块里的 `get_weather` 换掉。`weather_agent.run` 里的 `get_weather(**args)` 在运行时去模块里按名字查,查到的就是新的。这种做法叫猴子补丁(Day 655),别在生产代码里滥用,给调试器用是合适的。
- `if __name__ == "__main__":` 只有直接运行这个文件时才往下执行。
- `loupe.wrap_openai(llm.client)` 模型层补丁。`llm.client` 是 `LLMClient` 里的 `OpenAI` 对象。
- `with loupe.run("weather-agent", out=OUT, tags=["weather", "deepseek"]):` 开始一次运行。
- `with loupe.step("agent", "weather_agent", input=TASK_TEXT) as rec:` 手动开一个 agent 根步骤。模型步和工具步会自动把它当父亲。
- `rec["output"] = weather_agent.run(TASK_TEXT, llm)` 最终回答存到根步骤的 `output`。
- `print(f"已写入 {OUT};{llm.ledger}")` `llm.ledger` 是 Day 136 的账本,打印调用次数、token 和钱。

</div>

```bash
cd /Users/你/agent-zero-lab
uv run python -m part11.sdk_agent
```

```text
调用 get_weather(Beijing)
调用 get_weather(Shanghai)
调用 get_weather(Guangzhou)
已写入 part11/runs/weather_sdk.jsonl;2 次调用 | 输入 799 / 输出 211 tokens | 约 ¥0.0025
```

终端输出和 Day 649 的一样(那些 `调用 get_weather(...)` 是原来就有的 `print`),业务代码一行没动。文件有 8 行:`run_start`、两次模型调用、三次工具、根步骤、`run_end`。复制到 Loupe 的样例目录并导入:

```bash
cp part11/runs/weather_sdk.jsonl /Users/你/agent-loupe/samples/weather_sdk.jsonl
cd /Users/你/agent-loupe/server
uv run python -m scratch.s17_sdk_import ../samples/weather_sdk.jsonl | cut -c1-110
```

```text
c70cc39b6020 weather-agent ok ['weather', 'deepseek', 'sdk'] 8995.8ms
  0 None agent weather_agent 北京、上海、广州现在各多少度?算一下三个城市的平均气温。 现在三个城市的气温如下：
  1 0 llm chat deepseek-flash {'messages': [{'role': 'system', 'content': '你是天气助手。需要气温时调用 get_weather,不要自己编。'}, {'role': 'user'
  2 0 tool get_weather {'city': 'Beijing'} {'city': 'Beijing', 'temp_c': 13.2}
  3 0 tool get_weather {'city': 'Shanghai'} {'city': 'Shanghai', 'temp_c': 19.9}
  4 0 tool get_weather {'city': 'Guangzhou'} {'city': 'Guangzhou', 'temp_c': 31.2}
  5 0 llm chat deepseek-flash {'messages': [{'role': 'system', 'content': '你是天气助手。需要气温时调用 get_weather,不要自己编。'}, {'role': 'user
```

六步,结构和 Day 654 的 OTLP 样例一模一样:一个 agent 根,下面是 llm、三个 tool、llm。`input` 里是完整的 `messages`,工具参数是 `{'city': 'Beijing'}`。整次运行 9.0 秒,三次工具调用占了六秒多,又是那三个一个接一个的 `get_weather`。你的数字会不一样,天气接口的延迟和网络关系很大。

### 三种来源的差别

现在手里同一个任务有三种来源的文件:OTLP(Day 654)、Langfuse(Day 655,从 OTLP 转出来的)、SDK(刚才)。用统一入口读一遍,比较它们:

```python
# agent-loupe/server/scratch/s20_compare.py
from pathlib import Path

from loupe.importers import detect_format, import_any

SAMPLES = Path("../samples")
for name in ["weather_otlp.jsonl", "weather_langfuse.json", "weather_sdk.jsonl"]:
    text = (SAMPLES / name).read_text(encoding="utf-8")
    [trace] = import_any(text)
    llm = next(s for s in trace.steps if s.kind == "llm")
    has_tools = bool(llm.input and llm.input.get("tools"))
    print(f"{name}: 识别={detect_format(text)} 步数={len(trace.steps)} 运行名={trace.run.name}")
    print(f"    标签={trace.run.tags} 模型步带工具定义={has_tools}")
```

<div class="line-notes">

- `from loupe.importers import detect_format, import_any` 从包里直接导入,说明 `__init__.py` 的接线生效了。
- `for name in [` 三个文件,各走一遍统一入口,调用方不用关心格式。
- `[trace] = import_any(text)` 每个文件恰好一条运行。
- `llm = next(s for s in trace.steps if s.kind == "llm")` 取第一个模型步。
- `has_tools = bool(llm.input and llm.input.get("tools"))` 这个模型步的输入里有没有工具定义。`llm.input` 可能是 `None`(OTLP 没开内容记录时),所以先判断它。

</div>

```text
weather_otlp.jsonl: 识别=otlp 步数=6 运行名=invoke_agent weather_agent
    标签=['otlp', 'weather-agent'] 模型步带工具定义=False
weather_langfuse.json: 识别=langfuse 步数=6 运行名=invoke_agent weather_agent
    标签=['weather', 'langfuse'] 模型步带工具定义=False
weather_sdk.jsonl: 识别=sdk 步数=6 运行名=weather-agent
    标签=['weather', 'deepseek', 'sdk'] 模型步带工具定义=True
```

三个来源的结构一样,**只有 SDK 的模型步带着工具定义**。OTLP 那份是 Day 653 说过的:官方自动埋点不记工具定义(默认 Opt-In,而且我实测 `openai-v2` 这个版本压根没有记)。Langfuse 那份是从 OTLP 转出来的,当然也没有。

这个差别直接决定了 Day 669 的「从某一步重跑」能不能做。重跑要把当时发给模型的 `messages` **和** `tools` 原样再发一遍。没有 `tools`,模型就没法再决定调哪个工具,重跑出来的结果和原来完全不是一回事。所以对 OTLP 和 Langfuse 来的数据,Loupe 要在界面上说清楚「这条 trace 没有记工具定义,不能重跑」(或者让用户手动补一份),而不是点了重跑才发现行为不对。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="三种来源各自带哪些信息的对照表:步骤结构三者都有,消息原文 OTLP 要手动开,工具定义只有 SDK 有,成本只有 Langfuse 可能有">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="11" fill="var(--ink)">
<text x="24" y="34">信息</text><text x="230" y="34">OTLP</text><text x="360" y="34">Langfuse</text><text x="500" y="34">SDK</text>
<text x="24" y="70">步骤树、耗时、token</text><text x="24" y="104">消息原文</text><text x="24" y="138">工具定义</text><text x="24" y="172">成本</text><text x="24" y="206">能重跑?</text>
</g>
<g stroke="var(--rule)"><path d="M16 46 H624"/><path d="M16 82 H624"/><path d="M16 116 H624"/><path d="M16 150 H624"/><path d="M16 184 H624"/></g>
<g font-family="var(--font-mono)" font-size="11">
<rect x="222" y="54" width="100" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="232" y="68" fill="var(--ink)">有</text>
<rect x="352" y="54" width="100" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="362" y="68" fill="var(--ink)">有</text>
<rect x="492" y="54" width="100" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="502" y="68" fill="var(--ink)">有</text>
<rect x="222" y="88" width="100" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="232" y="102" fill="var(--ink)">要开 Opt-In</text>
<rect x="352" y="88" width="100" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="362" y="102" fill="var(--ink)">字符串</text>
<rect x="492" y="88" width="100" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="502" y="102" fill="var(--ink)">完整</text>
<rect x="222" y="122" width="100" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="232" y="136" fill="var(--ink)">没记</text>
<rect x="352" y="122" width="100" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="362" y="136" fill="var(--ink)">没记</text>
<rect x="492" y="122" width="100" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="502" y="136" fill="var(--ink)">有</text>
<rect x="222" y="156" width="100" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="232" y="170" fill="var(--ink)">无</text>
<rect x="352" y="156" width="100" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="362" y="170" fill="var(--ink)">认识模型才有</text>
<rect x="492" y="156" width="100" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="502" y="170" fill="var(--ink)">无(价格表补)</text>
<rect x="222" y="190" width="100" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="232" y="204" fill="var(--ink)">不能</text>
<rect x="352" y="190" width="100" height="20" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="362" y="204" fill="var(--ink)">不能</text>
<rect x="492" y="190" width="100" height="20" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="502" y="204" fill="var(--ink)">能</text>
</g>
</svg>
<figcaption>蓝色是有,琥珀色是缺或有条件。这是我这次手里三份样例的实际情况,不是三种格式的理论上限:OTLP 打开内容记录后可以有消息原文,Langfuse 在认识模型时会有成本。</figcaption>
</figure>

现在测试可以变绿了:

```bash
uv run pytest tests/test_detect.py -q
```

```text
..........                                                               [100%]
10 passed in 0.14s
```

### 造一条失败的真实 trace

调试器最有用的时候是出错的时候,所以要一条失败的真实样例。办法很简单:给 Agent 一个不存在的城市。`weather_agent.get_weather` 里查不到地名时 `geo["results"]` 会 `KeyError`(Day 649 文章里说过,「今天不处理」),而这个 Agent 没有错误处理,会直接崩。我们要看的就是崩的时候 trace 里留了什么:

```bash
cd /Users/你/agent-zero-lab
uv run python -m part11.sdk_agent part11/runs/weather_fail_sdk.jsonl "Nowhereville 现在多少度?"
```

```text
Traceback (most recent call last):
  ...
    return raw_get_weather(city)
  File "/Users/你/agent-zero-lab/part11/weather_agent.py", line 30, in get_weather
    place = geo["results"][0]
            ~~~^^^^^^^^^^^
KeyError: 'results'
调用 get_weather(Nowhereville)
```

(终端里先出现的是 Python 的报错,最后一行 `调用 ...` 是标准输出,两个流的显示顺序不一定。)进程崩了,但文件已经写完整:`with` 块的 `finally` 照样写了 `run_end`。复制过去再导入:

```bash
cp part11/runs/weather_fail_sdk.jsonl /Users/你/agent-loupe/samples/
cd /Users/你/agent-loupe/server
```

```python
# agent-loupe/server/scratch/s21_fail_trace.py
import sys
from pathlib import Path

from loupe.importers import import_any

[trace] = import_any(Path(sys.argv[1]).read_text(encoding="utf-8"))
print(trace.run.status, [(s.idx, s.kind, s.name) for s in trace.steps])
for s in trace.steps:
    if s.error:
        print("报错步骤", s.idx, s.name, "->", s.error)
```

<div class="line-notes">

- `[trace] = import_any(` 一个文件一条运行。
- `print(trace.run.status, [(s.idx, s.kind, s.name) for s in trace.steps])` 运行状态,以及每一步的序号、类型、名字。
- `if s.error:` 只挑出有报错的步骤。
- `print("报错步骤", s.idx, s.name, "->", s.error)` 打印是哪一步、报了什么。

</div>

```bash
uv run python -m scratch.s21_fail_trace ../samples/weather_fail_sdk.jsonl
```

```text
error [(0, 'agent', 'weather_agent'), (1, 'llm', 'chat deepseek-flash'), (2, 'tool', 'get_weather')]
报错步骤 0 weather_agent -> KeyError: 'results'
报错步骤 2 get_weather -> KeyError: 'results'
```

三步:agent、一次模型调用、一次工具调用。运行状态 `error`,因为异常一路冒出了 `with loupe.run(...)`。报错出现在两个地方:工具步(`KeyError: 'results'`,源头)和 agent 根步(异常往外飞的时候经过它,也被记了一笔)。这条样例会一直用到 Day 663 的性能测量之外,Day 666 的「报错步骤高亮」和 Day 672 的「失败步骤存成评测用例」都要拿它试。

注意这和 Day 654 的 `weather_fail.jsonl`(OTLP 版的失败样例)不是同一类失败:那个是「工具报错、Agent 照常给出回答」,运行是 ok;这个是「异常没人接,运行崩了」,运行是 error。两种失败调试器都得会显示。

## 造假数据

真实 trace 只有六七步,测不了性能。后面三件事要大数据:Day 659 的游标分页要有几百条运行才看得出分页,Day 660 的分段加载要有一条上千步的 trace,Day 663 的时间轴虚拟滚动要一万步。所以写一个造数脚本,生成任意步数的合成 trace,格式和 SDK 写出来的一样。

它只用标准库,不装任何包,系统自带的 Python 3 就能跑(我故意用 `timezone.utc` 而不是 3.11 才有的 `UTC`):

```python
# agent-loupe/samples/gen_synthetic.py
"""造合成 trace(loupe_sdk 的 JSONL 格式),不调任何 API,只用标准库。

    python3 samples/gen_synthetic.py --steps 30 --out samples/synthetic_small.jsonl
    python3 samples/gen_synthetic.py --steps 10000 --out samples/synthetic_10k.jsonl

内容是假的(城市、温度、耗时都是随机数),只用来测界面和性能,不代表任何模型的真实行为。
"""
import argparse
import json
import random
from datetime import datetime, timedelta, timezone
from typing import Any

CITIES = ["北京", "上海", "广州", "深圳", "杭州", "成都", "武汉", "西安", "哈尔滨", "昆明"]
SYSTEM = "你是天气助手。需要气温时调用 get_weather,不要自己编。"
MAX_MESSAGES = 40


def iso(t: datetime) -> str:
    return t.isoformat()


def make_run(run_id: str, target_steps: int, seed: int = 7) -> list[dict[str, Any]]:
    rnd = random.Random(seed)
    t = datetime(2026, 10, 27, 2, 0, tzinfo=timezone.utc)
    records: list[dict[str, Any]] = [{"type": "run_start", "id": run_id, "name": f"synthetic-{target_steps}",
                                      "started_at": iso(t), "tags": ["synthetic"]}]
    messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM},
                                      {"role": "user", "content": "把这几个城市的气温都查一遍,算平均值。"}]
    root: dict[str, Any] = {"type": "step", "run_id": run_id, "idx": 0, "parent_idx": None, "kind": "agent",
                            "name": "weather_agent", "started_at": iso(t), "input": messages[1]["content"]}
    idx = 1
    while idx < target_steps:
        dur = timedelta(milliseconds=rnd.randint(600, 2500))
        calls: list[dict[str, Any]] = [{"id": f"call_{idx}_{k}", "type": "function",
                  "function": {"name": "get_weather",
                               "arguments": json.dumps({"city": rnd.choice(CITIES)}, ensure_ascii=False)}}
                 for k in range(rnd.randint(1, 3))]
        in_tokens = sum(len(json.dumps(m, ensure_ascii=False)) for m in messages) // 2
        reply: dict[str, Any] = {"role": "assistant", "content": None, "tool_calls": calls}
        records.append({"type": "step", "run_id": run_id, "idx": idx, "parent_idx": 0, "kind": "llm",
                        "name": "chat deepseek-flash", "model": "deepseek-flash",
                        "started_at": iso(t), "ended_at": iso(t + dur),
                        "input": {"messages": list(messages), "tools": None}, "output": reply,
                        "input_tokens": in_tokens, "output_tokens": 20 * len(calls) + rnd.randint(5, 40)})
        messages.append(reply)
        t += dur
        idx += 1
        for call in calls:
            if idx >= target_steps:
                break
            tool_dur = timedelta(milliseconds=rnd.randint(80, 900))
            failed = rnd.random() < 0.03
            result = {"error": "ConnectTimeout"} if failed else {"temp_c": round(rnd.uniform(-5, 30), 1)}
            records.append({"type": "step", "run_id": run_id, "idx": idx, "parent_idx": 0, "kind": "tool",
                            "name": "get_weather", "started_at": iso(t), "ended_at": iso(t + tool_dur),
                            "input": json.loads(call["function"]["arguments"]), "output": result,
                            **({"error": "ConnectTimeout"} if failed else {})})
            messages.append({"role": "tool", "tool_call_id": call["id"],
                             "content": json.dumps(result, ensure_ascii=False)})
            t += tool_dur
            idx += 1
        if len(messages) > MAX_MESSAGES:  # 真实 Agent 会截断上下文;不截的话一万步的文件会有几个 GB
            messages = messages[:2] + messages[-20:]
    root["ended_at"] = iso(t)
    root["output"] = "完成"
    records.insert(1, root)
    records.append({"type": "run_end", "id": run_id, "ended_at": iso(t), "status": "ok"})
    return records


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--out", default="samples/synthetic_small.jsonl")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    recs = make_run(f"syn{args.steps}", args.steps, args.seed)
    with open(args.out, "w", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"写入 {args.out}:{sum(r['type'] == 'step' for r in recs)} 个步骤")
```

<div class="line-notes">

- `import argparse` 标准库的命令行参数解析器,≈ Node 里的 `commander` 或 `yargs`。
- `from datetime import datetime, timedelta, timezone` `timezone.utc` 在所有 Python 3 版本里都有;`UTC` 常量要 3.11+。这个脚本想让任何人的系统 Python 都能跑,所以用老写法。
- `MAX_MESSAGES = 40` 上下文长度的上限,等会儿「截断」那一段用。
- `rnd = random.Random(seed)` 自己的随机数发生器,种子固定就能**每次生成一模一样的文件**。造数据要可重复,不然测试里的数字会飘。用全局 `random.seed` 也行,但会影响别的代码。
- `t = datetime(2026, 10, 27, 2, 0, tzinfo=timezone.utc)` 起点时间,带时区。这个变量会一路往后推进。
- `records: list[dict[str, Any]] = [{"type": "run_start",` 第一条记录。
- `messages: list[dict[str, Any]] = [` 当前的对话历史。每轮模型调用把**当时的完整历史**记成这一步的输入,这就是真实 Agent 里「上下文越来越长」的由来。
- `root: dict[str, Any] = {"type": "step",` 根步骤,编号 0。它的结束时间要等循环跑完才知道,所以先只填开始部分。
- `idx = 1` 从 1 开始,0 留给根。
- `while idx < target_steps:` 编号用到目标步数就停。
- `dur = timedelta(milliseconds=rnd.randint(600, 2500))` 一次模型调用 0.6 到 2.5 秒,随机。
- `for k in range(rnd.randint(1, 3))]` 每轮模型回复里随机要求调 1 到 3 个工具(并行工具调用,Day 162)。
- `in_tokens = sum(len(json.dumps(m, ensure_ascii=False)) for m in messages) // 2` 估算输入 token:所有消息的字符数除以 2。是**估的**,不是真的分词,够用来画上下文增长。`//` 是整除。
- `"input": {"messages": list(messages), "tools": None}, "output": reply,` `list(messages)` 拷一份浅拷贝,下一行 `messages.append` 就不会改到已记录的这一步(这是 Day 655 那个拷贝问题的脚本版,这里只需要拷列表本身,里面的消息字典之后不会被改)。
- `messages.append(reply)` 把这次回复加进历史,下一轮模型调用的输入就更长了。
- `t += dur` 时间推进。模型调用和后面的工具是**顺序**的,每一步的开始就是上一步的结束,贴近 Day 649 看到的串行。
- `for call in calls:` 这一轮要求的每个工具各出一步。
- `if idx >= target_steps:` 循环中途到了目标步数就停,保证总步数恰好是目标值。
- `failed = rnd.random() < 0.03` 3% 的工具调用失败,用来测「报错步骤」的显示。
- `**({"error": "ConnectTimeout"} if failed else {})})` 失败时往记录里并入一个 `error` 键,没失败就并入空字典。`**` 展开 ≈ JS 的 `...`。
- `if len(messages) > MAX_MESSAGES:` 消息超过 40 条就截断。
- `messages = messages[:2] + messages[-20:]` 保留开头两条(system 和 user)加最近 20 条。注释里说了原因:不截断,每一步都带着前面所有的消息,一万步的文件要几个 GB。
- `records.insert(1, root)` 根步骤放在 `run_start` 后面。真实 SDK 写出来的根是最后一个,这里放前面也无所谓,导入器会重排,顺便又测了一次「顺序不重要」。
- `ap.add_argument("--steps", type=int, default=30)` 命令行参数 `--steps`,`type=int` 自动转整数。
- `recs = make_run(f"syn{args.steps}", args.steps, args.seed)` 运行 id 是 `syn30`、`syn10000` 这样,好认。
- `f.write(json.dumps(r, ensure_ascii=False) + "\n")` 一条记录一行,这就是 JSONL。

</div>

```bash
cd /Users/你/agent-loupe
python3 samples/gen_synthetic.py --steps 30 --out samples/synthetic_small.jsonl
python3 samples/gen_synthetic.py --steps 10000 --out samples/synthetic_10k.jsonl
ls -la samples/synthetic_*
```

```text
写入 samples/synthetic_small.jsonl:30 个步骤
写入 samples/synthetic_10k.jsonl:10000 个步骤
-rw-r--r--  1 minliu  wheel  18695042 27 Oct 13:10 samples/synthetic_10k.jsonl
-rw-r--r--  1 minliu  wheel     32195 27 Oct 13:10 samples/synthetic_small.jsonl
```

一万步的文件约 18.7 MB。这个文件不要提交进 git:后面 `.gitignore` 里加一行 `samples/synthetic_10k.jsonl`,谁要谁自己跑脚本生成(种子固定,生成的完全一样)。

### 量一下导入要多久

写一个量时间的脚本:

```python
# agent-loupe/server/scratch/s18_import_big.py
import sys
import time
from pathlib import Path

from loupe.importers import detect_format, import_any

text = Path(sys.argv[1]).read_text(encoding="utf-8")
t0 = time.perf_counter()
fmt = detect_format(text)
t1 = time.perf_counter()
[trace] = import_any(text)
t2 = time.perf_counter()
print(f"{len(text) / 1e6:.1f} MB;识别 {fmt} 用了 {(t1 - t0) * 1000:.0f} ms;完整导入用了 {t2 - t1:.2f} s")
r = trace.run
print(len(trace.steps), "步", r.total_input_tokens, r.total_output_tokens, r.status)
errors = [s.idx for s in trace.steps if s.error]
print(len(errors), "个报错步骤", errors[:5])
```

<div class="line-notes">

- `t0 = time.perf_counter()` 高精度计时器,≈ 前端的 `performance.now()`。
- `fmt = detect_format(text)` 单独量识别。
- `[trace] = import_any(text)` 完整导入(里面会再识别一次,所以第二个耗时里包含识别)。
- `print(f"{len(text) / 1e6:.1f} MB;` 字符数除以一百万,近似文件大小。
- `errors = [s.idx for s in trace.steps if s.error]` 找出所有有报错的步骤。

</div>

```bash
cd server
uv run python -m scratch.s18_import_big ../samples/synthetic_small.jsonl
uv run python -m scratch.s18_import_big ../samples/synthetic_10k.jsonl
```

```text
0.0 MB;识别 sdk 用了 0 ms;完整导入用了 0.00 s
30 步 9615 623 ok
0 个报错步骤 []
18.1 MB;识别 sdk 用了 53 ms;完整导入用了 0.83 s
10000 步 7065603 209217 ok
211 个报错步骤 [94, 122, 148, 178, 186]
```

一万步导入约 0.8 秒(我这台 2019 年的 Intel MacBook 上多次测在 0.7 到 1.3 秒之间浮动)。识别只要 50 多毫秒:整个文件当 JSON 解析会在第二行就失败(`Extra data`),很快就转去读第一行。

两个数字值得停一下。第一,总输入 token 是 7,065,603,而 30 步那条只有 9,615。一万步的 trace「总输入」七百万,是因为每一次模型调用都带着当时的全部历史(截断到最多 40 条消息),这和真实 Agent 一样:上下文成本是**平方级增长**的,Day 666 的上下文增长图要画的就是它。第二,**211 个报错步骤,运行状态却是 `ok`**:3% 的工具调用失败,但 `run_end` 写的是 ok。这是 Day 652 和 Day 654 的原则:`status` 只回答「有没有正常结束」,报错的步数单独统计。

测试里也用一下合成数据:

```python
# 追加到 agent-loupe/server/tests/test_sdk.py 末尾
def test_synthetic_small_sample_imports() -> None:
    from pathlib import Path as P

    from loupe.importers import detect_format, import_any

    text = (P(__file__).parents[2] / "samples" / "synthetic_small.jsonl").read_text(encoding="utf-8")
    assert detect_format(text) == "sdk"
    [trace] = import_any(text)
    assert len(trace.steps) == 30
    assert trace.steps[0].kind == "agent"
    assert all(s.parent_idx == 0 for s in trace.steps[1:])
```

<div class="line-notes">

- `from pathlib import Path as P` 函数里临时起个短别名,避免和文件开头已有的 `Path` 重复。放函数里是为了这一小段能整块粘贴,你也可以挪到文件开头统一导入。
- `text = (P(__file__).parents[2] / "samples" / "synthetic_small.jsonl").read_text(encoding="utf-8")` 路径的拼法和别的测试一样:从测试文件往上两层是仓库根。
- `assert len(trace.steps) == 30` 脚本说生成 30 步,导入后就该是 30 步,一步不多一步不少。
- `assert all(s.parent_idx == 0 for s in trace.steps[1:])` 合成数据里所有非根步骤的父亲都是根,导入后 `normalize` 重排了序号,但根仍然是第 0 个,这个关系应该保持。

</div>

```bash
uv run pytest -q
```

```text
........................................                                 [100%]
40 passed in 0.20s
```

(上面是我本地全部测试的数量,包含 Day 652–655 的。加上合成样例这个测试,你的数字会按你前几天的进度不同。)

## 今天的文件

| 文件 | 干什么 | 新建还是修改 | 花费 |
| --- | --- | --- | --- |
| `agent-loupe/server/loupe/importers/__init__.py` | `detect_format`、`import_any`、`ImportFormatError` | 修改(原来是空文件) | 不花 |
| `agent-loupe/server/tests/test_detect.py` | 10 个测试(其中一个参数化跑 6 组数据) | 新建 | 不花 |
| `agent-zero-lab/part11/sdk_agent.py`、`part11/loupe_sdk.py` | 给天气 Agent 加记录;SDK 的副本 | 新建 | 成功 ¥0.0025 + 失败约 ¥0.001 |
| `agent-loupe/samples/weather_sdk.jsonl`、`weather_fail_sdk.jsonl` | 真实 SDK 样例(成功、崩溃) | 新建 | 含在上一行 |
| `agent-loupe/samples/gen_synthetic.py` | 造数脚本 | 新建 | 不花 |
| `agent-loupe/samples/synthetic_small.jsonl`、`synthetic_10k.jsonl` | 合成样例,后者加进 `.gitignore` | 生成 | 不花 |
| `agent-loupe/server/scratch/s18` 到 `s21`、`ex656_*.py` | 演示和练习 | 新建,不提交 | 不花 |

## 动手练习

**练习 1:截断的文件。** 写 `scratch/ex656_truncate.py`:把三个真实样例各砍掉后三分之一(`text[: len(text) * 2 // 3]`),用 `detect_format` 和 `import_any` 处理,打印每一个的结果或错误。预测一下哪个能导入成功,为什么。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex656_truncate.py
from pathlib import Path

from loupe.importers import ImportFormatError, detect_format, import_any

for name in ["weather_otlp.jsonl", "weather_langfuse.json", "weather_sdk.jsonl"]:
    text = (Path("../samples") / name).read_text(encoding="utf-8")
    cut = text[: len(text) * 2 // 3]
    try:
        fmt = detect_format(cut)
        traces = import_any(cut)
        print(f"{name}: 识别 {fmt},导入 {len(traces)} 条,{len(traces[0].steps)} 步,状态 {traces[0].run.status}")
    except ImportFormatError as e:
        print(f"{name}: {e}")
```

<div class="line-notes">

- `cut = text[: len(text) * 2 // 3]` 字符串切片取前三分之二,`//` 整除。砍的位置是随便的,多半落在某一行中间。
- `fmt = detect_format(cut)` 先单独认格式,能认出来说明开头完整。
- `traces = import_any(cut)` 再完整导入。
- `except ImportFormatError as e:` 只接我们自己定义的异常。如果别的异常冒出来,脚本会崩,说明入口有漏洞。

</div>

```text
weather_otlp.jsonl: 按 otlp 解析失败:JSONDecodeError: Unterminated string starting at: line 1 column 2557 (char 2556)
weather_langfuse.json: 不是 JSON,也不是一行一个 JSON(JSONL)的文件
weather_sdk.jsonl: 识别 sdk,导入 1 条,4 步,状态 error
```

只有 SDK 的能导入:JSONL 一行一条记录,最后一行半截时 Day 655 的 `read_records` 丢掉它,前面完整的行都能用,运行状态按「没有 `run_end`」记成 error。OTLP 的文件出口每行是一个完整请求,**一行里装着好几个 span**,被砍在行内就整行解析不了,而它不是最后一行的特例(`read_documents` 没有这个容错),所以整个导入失败,但错误消息说清楚了是哪种格式、什么错。Langfuse 是一个大 JSON,砍掉就不是合法 JSON,连格式都认不出。

这给了一个启示:追加写的 JSONL 天然抗截断,单个大 JSON 最脆弱。要不要让 OTLP 导入器也丢弃半截的最后一行?可以做,但那是「悄悄丢数据」,对一份大概率是用户操作失误(下载到一半)的文件,我更倾向让它报错、让用户重新导出。SDK 的文件是我们自己写的,崩溃是它正常的使用场景,所以才特殊对待。

</details>

**练习 2:一个文件里放多次运行。** SDK 是追加写,同一个 `runs.jsonl` 会积累很多次运行。给 `gen_synthetic.py` 加一个 `--runs N` 参数,在一个文件里写 N 次运行(每次种子不同,运行 id 不同),然后用 `import_any` 读,确认得到 N 条 trace。

<details><summary>参考答案</summary>

只改 `__main__` 部分:

```python
# agent-loupe/samples/gen_synthetic.py(只替换 __main__ 部分)
if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--out", default="samples/synthetic_small.jsonl")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    with open(args.out, "w", encoding="utf-8") as f:
        for n in range(args.runs):
            for r in make_run(f"syn{args.steps}-{n}", args.steps, args.seed + n):
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"写入 {args.out}:{args.runs} 次运行,每次 {args.steps} 步")
```

<div class="line-notes">

- `ap.add_argument("--runs", type=int, default=1)` 新参数,默认 1 次,和原来的行为兼容。
- `for n in range(args.runs):` 外层循环:一次一次地造运行。
- `make_run(f"syn{args.steps}-{n}", args.steps, args.seed + n)` 运行 id 带上序号(`syn30-0`、`syn30-1`),种子也各不相同,所以三次运行的内容(城市、耗时)不一样。
- `f.write(` 同一个文件句柄一路写下去,三次运行的记录一条接一条,正是 SDK 多次追加后文件的样子。

</div>

```bash
python3 samples/gen_synthetic.py --runs 3 --steps 30 --out samples/synthetic_runs.jsonl
cd server
uv run python -c "
from pathlib import Path
from loupe.importers import detect_format, import_any
t = Path('../samples/synthetic_runs.jsonl').read_text(encoding='utf-8')
print(detect_format(t), [(x.run.id, len(x.steps)) for x in import_any(t)])
"
```

```text
写入 samples/synthetic_runs.jsonl:3 次运行,每次 30 步
sdk [('syn30-0', 30), ('syn30-1', 30), ('syn30-2', 30)]
```

三次运行各自 30 步,被 `import_sdk_jsonl` 按 `run_id` 分开。这也说明了为什么每个 `step` 记录里要带 `run_id`:一个文件里有多次运行时,靠它才知道一步属于哪次。

</details>

**练习 3:导入耗时随步数怎么变化?** 写 `scratch/ex656_scale.py`:生成 1000、3000、10000 步的文件(用子进程调 `gen_synthetic.py`),分别量导入耗时,算出每步耗时。判断是线性增长还是更糟。

<details><summary>参考答案</summary>

```python
# agent-loupe/server/scratch/ex656_scale.py
import subprocess
import sys
import time
from pathlib import Path

from loupe.importers import import_any

print("步数    文件大小    导入耗时    每步")
for n in (1000, 3000, 10000):
    out = Path(f"scratch/out/syn{n}.jsonl")
    subprocess.run([sys.executable, "../samples/gen_synthetic.py", "--steps", str(n), "--out", str(out)],
                   check=True, capture_output=True)
    text = out.read_text(encoding="utf-8")
    t0 = time.perf_counter()
    import_any(text)
    secs = time.perf_counter() - t0
    print(f"{n:<8}{len(text) / 1e6:>6.1f} MB{secs:>9.2f} s{secs / n * 1000:>8.3f} ms")
```

<div class="line-notes">

- `for n in (1000, 3000, 10000):` 三个规模,大约每次三倍。
- `out = Path(f"scratch/out/syn{n}.jsonl")` 输出放 `scratch/out/`,不提交。
- `subprocess.run([sys.executable, "../samples/gen_synthetic.py",` 用**当前这个 Python 解释器**跑造数脚本。`sys.executable` 是当前解释器的路径,≈ Node 里的 `process.execPath`。`check=True` 脚本失败就抛异常;`capture_output=True` 吞掉它的打印,不干扰我们的表格。
- `t0 = time.perf_counter()` 只量 `import_any` 这一段,不含读文件和造数据。
- `f"{n:<8}{len(text) / 1e6:>6.1f} MB{secs:>9.2f} s{secs / n * 1000:>8.3f} ms"` `:<8` 左对齐宽 8,`:>6.1f` 右对齐宽 6 保留一位小数,拼成一张对齐的表。

</div>

```text
步数    文件大小    导入耗时    每步
1000       1.8 MB     0.05 s   0.052 ms
3000       5.4 MB     0.16 s   0.054 ms
10000     18.1 MB     0.71 s   0.071 ms
```

每步耗时从 0.052 毫秒涨到 0.071 毫秒,基本线性,没有平方级的恶化。一万步时略贵一点,多半是内存分配和垃圾回收的开销。我前面单独量一万步得到过 0.83 秒和 1.27 秒,可见这种数字有好几十个百分点的抖动,**别根据一次测量下结论**,至少多测几次看范围。这一版导入器不是后面的瓶颈:真正要小心的是把 18 MB 的 trace 一次全发给浏览器(Day 660 的分段加载要解决的)。

</details>

**验收标准**:`uv run pytest -q` 全部通过;`samples/` 里有三个真实样例(`weather_otlp.jsonl`、`weather_langfuse.json`、`weather_sdk.jsonl`)加失败样例 `weather_fail_sdk.jsonl` 和两份合成样例;`import_any` 对三种格式各返回一条 trace,对 `s19` 里六种坏输入都只抛 `ImportFormatError`。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 格式识别(sniffing) | 不看文件名,看内容的开头判断它是哪种格式 |
| 指纹 | 一种格式独有的、别的格式没有的特征,比如 OTLP 的 `resourceSpans` 键 |
| 相对导入 | `from .langfuse import ...` 里开头的点,表示「同一个包里的」,≈ JS 的 `./` |
| 分发表 | 用字典把名字映射到函数,代替一长串 `if`,≈ JS 的 `handlers[type](...)` |
| parametrize | pytest 的参数化:同一个测试函数用多组数据各跑一次,≈ jest 的 `test.each` |
| 猴子补丁 | 运行时替换模块或对象里已有的名字。`weather_agent.get_weather = ...` 就是 |
| 合成数据 | 脚本造出来的假数据,用来测界面和性能,不代表真实行为 |
| 固定种子 | 随机数发生器给定同一个种子,每次产生同样的序列,让造的数据可重复 |
| 上下文增长 | Agent 每一轮都要带上前面所有消息,输入 token 一轮比一轮多,总成本接近平方级增长 |
| `ImportFormatError` | 我们自定义的异常:文件认不出或解析失败,消息写给上传文件的人看 |

## 常见误区

**用扩展名判断格式。** OTLP 和 SDK 都是 `.jsonl`,Langfuse 的导出名字是用户随手起的。看内容开头。

**让 `KeyError` 直接冒到用户面前。** 用户看到 `KeyError: 'traceId'` 不知道该怎么办。入口统一包成「按 otlp 解析失败」,并带上原始异常的类型和信息,既友好又不丢排查线索。

**认不出时只说「格式错误」。** 要说清楚**认出了什么、缺什么**。拿到 Langfuse 的 trace 列表而不是 observation 列表,是很常见的拉错接口,一句「像 Langfuse 导出,但每一项没有 traceId」能省用户十分钟。

**成功导入了零条运行却不吭声。** `{"resourceSpans": []}` 不会抛任何异常,返回空列表。调用方以为导入成功了,界面上却什么都没有。空结果也要说一句话。

**给 Agent 加记录时改业务代码。** 把 `loupe.step` 散落在 `weather_agent.py` 里,以后想关掉记录就要改一堆地方。从外面套:包客户端、换模块里的名字。业务代码一行不动。

**`**kwargs` 的参数被 `trace_step` 记成嵌套字典。** `inspect.signature().bind` 会把 `**kwargs` 收成 `{"kwargs": {...}}`。被装饰的函数把参数名一个一个写出来(`city: str`)。

**拿一次测量的耗时下结论。** 同一个一万步文件,我测过 0.71、0.83、1.27 秒。多测几次看范围,别写一个数字进 README 当承诺。

**合成数据不加说明就当真数据用。** 文件里写明「内容是假的」,别人拿到时才不会拿它去评价模型的行为。合成 trace 里的温度、耗时、失败率全是随机数。

**没有 `run_end` 却把状态记成 ok。** 一个没写完的文件多半是进程被杀了,运行状态应该是 error,而不是默默当成功。

## 学习资料

### 文档与文章

- [Python 文档:argparse 教程](https://docs.python.org/3/howto/argparse.html):造数脚本用的命令行参数解析,读前半篇的「Concepts」和「The basics」,15 分钟。
- [pytest 文档:参数化](https://docs.pytest.org/en/stable/how-to/parametrize.html):`@pytest.mark.parametrize` 的写法,今天的坏输入测试用它,10 分钟。
- [Python 文档:random.Random](https://docs.python.org/3/library/random.html):固定种子让随机数可重复,读开头几段,5 分钟。
- [Langfuse 公开 API](https://langfuse.com/docs/api-and-data-platform/features/public-api):复习 Day 655,注意文档里 trace 和 observation 两种读法的区别,这是 `detect_format` 里那句「不是 trace 列表」的来源,10 分钟。
- [OpenTelemetry:OTLP 规范](https://opentelemetry.io/docs/specs/otlp/):文件里 `resourceSpans` 是顶层键的出处,5 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1NwNVemEyE&autoplay=0&high_quality=1" title="【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐695】OpenTelemetry日志、指标、链路一站解决方案 · 23 分钟。短,讲 trace、span 和上下文传播。看「子 span 自动认当前 span 做父亲」这一段,对照 SDK 里 `stack` 的作用和练习 3 的 ContextVar。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/GpqAQxH1Afc" title="Next-Level Concurrent Programming In Python With Asyncio" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · Next-Level Concurrent Programming In Python With Asyncio · 英文。讲 asyncio 里任务并发是怎么回事,Day 655 练习 3 的 `gather` 就是它,看完更容易理解为什么共享栈会乱。</figcaption>
</figure>

### 书籍

- **Observability Engineering**,Charity Majors、Liz Fong-Jones、George Miranda,O'Reilly,2022。第 6 章讲怎么把一次请求的事件串成 trace,第 7 章讲埋点,对应今天「给 Agent 从外面套上记录」的思路,约 1 小时。
- **Designing Data-Intensive Applications**,Martin Kleppmann,O'Reilly,2017。第 4 章「Encoding and Evolution」讲各种数据编码格式和兼容,对应今天识别三种格式的思路,读前半章,约 40 分钟。

### 开源项目与代码

- [langfuse/langfuse-python](https://github.com/langfuse/langfuse-python):Langfuse 的 Python SDK,看它的集成层怎么「从外面套」一个 OpenAI 客户端来记录调用,和 `wrap_openai` 对照。
- [open-telemetry/opentelemetry-python-contrib](https://github.com/open-telemetry/opentelemetry-python-contrib/tree/main/instrumentation-genai/opentelemetry-instrumentation-openai-v2):官方的 OpenAI 自动埋点,也是给客户端打补丁的做法,看它为什么不记工具定义(`tools` 参数没被捕获)。

## 自测

1. 为什么识别格式不能看扩展名?`detect_format` 看的是什么?

<details><summary>答案</summary>

OTLP 的文件出口和我们的 SDK 都写 `.jsonl`,Langfuse 的导出文件名是用户随手起的,扩展名区分不了。`detect_format` 取文件的第一个文档(整体能解析成 JSON 就看整体,否则看第一个非空行),然后看最外层的特征:有 `resourceSpans` 是 OTLP;有 `type` 且取值是 `run_start`/`step`/`run_end` 是 SDK;是数组或有 `data`/`observations`,而且每一项有 `traceId` 和 `startTime`,是 Langfuse。

</details>

2. `import_any` 为什么要把 `KeyError`、`ValidationError` 都换成 `ImportFormatError`?

<details><summary>答案</summary>

用户上传文件出错时需要知道「哪里不对、该怎么办」,裸的 `KeyError: 'traceId'` 是内部实现的细节。统一成一种异常,调用方(Day 659 的上传接口)只需要接这一个,返回 HTTP 422 和一句人话;而消息里仍然带着原始异常的类型和前 200 个字符,排查的人不丢线索,`from e` 还保留了异常链。

</details>

3. 同一个天气任务,用三种来源导入后,为什么只有 SDK 那份能支持「从某一步重跑」?

<details><summary>答案</summary>

重跑要把当时发给模型的 messages 和 tools 完整地再发一遍。SDK 的 `wrap_openai` 把两者都记下来了;OTLP 官方自动埋点默认不记消息和工具定义(Opt-In),我实测的版本没有记 `tools`;Langfuse 那份又是从 OTLP 转来的。没有 tools,模型无法重新决定调哪个工具,结果和原来对不上。所以 Loupe 对没有工具定义的 trace 要在界面上说明不能重跑。

</details>

4. 失败样例里,工具步和 agent 根步都有 `error`,运行状态也是 error。这和 Day 654 的 OTLP 失败样例(工具报错但运行是 ok)有什么不同?

<details><summary>答案</summary>

Day 654 那个是工具报错、Agent 接住了错误并给出了回答,异常没有冒出最外层,运行正常结束,所以 ok。今天这个是 `get_weather` 里的 `KeyError` 没人接,一路冒出 `with loupe.run(...)`,SDK 在 `run()` 的 `except` 里把状态记成 error 并重新抛出,进程崩溃。两种失败调试器都要能显示:前者要能在时间轴上找到那个报错的工具步,后者要看到整次运行的失败。

</details>

5. 造数脚本里为什么要截断消息历史?不截会怎样?

<details><summary>答案</summary>

每一次模型调用的 `input.messages` 都是当时完整的历史,不截断的话第 N 步带着前 N 步的所有消息,文件大小随步数平方级增长,一万步会有几个 GB。真实的 Agent 也会做上下文截断或压缩(第四部分讲过),所以这样做并不脱离真实。保留开头两条(system 和 user)加最近 20 条,是常见的一种简单策略。

</details>

6. 面试题:有人说「我的系统要支持用户上传三种格式的 trace,我就让用户在界面上选格式,不做自动识别」。你怎么看?

<details><summary>答案</summary>

让用户选可以,而且实现最简单,但会把错误推给用户:选错了得到的是一个莫名其妙的解析错误,而用户常常并不知道自己手里的文件算哪种格式(比如不清楚 Langfuse 导出的是 trace 还是 observation 列表)。自动识别的成本很低(看第一个文档的最外层键),识别不出时又能给出「像什么、缺什么」的具体提示,体验好得多。折中:自动识别为主,界面上同时提供「格式不对?手动指定」的兜底。关键是不论哪种方式,识别和解析失败都要变成用户看得懂的错误,不是堆栈。

</details>

## 明天预告

明天是 Day 657,第 94 周复习:作品(Day 651–656)。这一周的 Loupe 已经有了从 PRD 到数据模型、OTel 约定、三个导入器、统一入口、SDK 和假数据的整条数据入口线。明天把 Day 651 到 Day 656 通读一遍,画一张知识地图,每天一句话回顾,然后做一个只用本周知识的小项目:自己写一个新的导入器,接进统一入口,看看这条流水线是不是真的撑得住第四种格式;最后整理本周踩过的坑。
