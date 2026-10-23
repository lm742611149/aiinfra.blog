---
title: 'Day 54 · 小项目:带校验的工单录入工具'
description: '这周学的 pydantic 校验、JSON 存储和环境变量,今天拼成一个真能用的命令行工具:一张一张从键盘录入工单,不合规矩的当场拦下并说清为什么,通过的存进 JSON,被拦的记进一份 JSON Lines 日志。录入 5 条,拦下 1 条,再读回来核对。'
pubDate: 2026-10-23
regime: none
tags: ['python', 'project', 'agent-zero']
series: 'agent-zero'
day: 54
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 53](/blog/agent-zero/day-053-env-secrets/) 把配置这件事立了规矩:key 只放在项目根目录的 `.env` 里,`.gitignore` 拦住它,代码里用 `load_dotenv()` 读、用 `os.environ` 取,缺了变量要在第一行就报错。前面 [Day 51](/blog/agent-zero/day-051-pydantic-1/) 和 [Day 52](/blog/agent-zero/day-052-pydantic-2/) 两天的主线是:外面进来的数据不可信,在门口用 pydantic 模型拦一道,拦不住的都是类型和规则没写全。

三天各自都是一个零件,今天不学新概念,把零件装成一个能一直用下去的小工具。这类「小项目日」的价值在于:你会发现每个零件单独能跑,拼在一起总有几处对不上,比如错误提示怎么展示、编号怎么分配、文件坏了怎么办,这些恰恰是真实工作里最花时间的部分。

## 今天要解决的问题

学完今天,你应该能:

1. 写出命令行工具 `part01/intake.py`:从键盘一张一张读入标题、金额、标签,交给 Day 52 的 `Ticket` 模型校验,通过的存进 JSON 文件,被拦的当场用中文说明原因。
2. 说清这个工具里每一层各管什么:`Ticket` 管规则,`intake_msgs.py` 管翻译,`intake_store.py` 管文件,`intake.py` 管流程,并且工具自己**不写任何一条校验规则**。
3. 处理三种「不是用户输错,是环境出问题」的情况:输入提前结束(`EOFError`)、数据文件被手改坏了、环境变量里的路径写成了相对路径。
4. 录入 5 张工单,其中 1 张被拦,打开 `intake.json` 和 `intake_rejected.jsonl` 核对结果;再运行一次,编号接着往下走。

预计用时:3 小时。前置:[Day 14](/blog/agent-zero/day-014-bool-none/) 的 `input()`、[Day 36](/blog/agent-zero/day-036-exceptions-2/) 的自定义异常、[Day 38](/blog/agent-zero/day-038-files-with/) 和 [Day 39](/blog/agent-zero/day-039-json/) 的文件和 JSON Lines、[Day 44](/blog/agent-zero/day-044-notebook-project/) 的命令行记事本、[Day 51](/blog/agent-zero/day-051-pydantic-1/) 到 [Day 53](/blog/agent-zero/day-053-env-secrets/) 三天的 pydantic 和 `.env`。

学法:先对照文章逐行敲一遍(不要复制粘贴)并跑通;第二天合上文章,把 `intake.py` 里的 `main` 函数的主循环默写出来;再做动手练习,做不出来再展开参考答案,看完关掉自己重写一遍。

命令都在项目根目录 `agent-zero-lab` 里跑,新文件放进 `part01/`。今天不装新依赖,不调 API,花费 0 元。开始前先确认下面这些文件都在,它们是前几天建的:

```bash
ls part01/ticket_types.py part01/ticket_pd.py part01/ticket_form.py part01/data/notebook.json
uv run python part01/ticket_pd.py
```

最后一行就是 Day 52 的 `ticket_pd.py` 演示,应该看到四张工单和「存进去再读回来,一样吗? True」。`notebook.json` 里是 T-1001(已关)、T-1002、T-1004、T-1005 四张,我的 T-1004 金额是 89.5。下面输出里的长路径我缩短了,家目录写成 `/Users/你`。

## 先想清楚:这个工具要做什么

做之前先把流程画出来。用户在终端里敲一张工单要填的东西,工具把它凑成一个字典,交给 `Ticket.model_validate`。通过了就加进列表、整本存盘;没通过就把 `ValidationError` 翻译成中文,打印出来,同时往日志里追加一行。

<figure>
<svg viewBox="0 0 640 270" role="img" aria-label="录入工具的流程:键盘输入标题、金额、标签,凑成字典,加上自动分配的工单号,交给 Ticket.model_validate;通过则追加到列表并整本写回 intake.json,没通过则翻译成中文提示打印出来,并追加一行到 intake_rejected.jsonl">
<rect x="0" y="0" width="640" height="270" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="30" width="120" height="52" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="76" y="52" text-anchor="middle" fill="var(--ink)">键盘输入</text>
<text x="76" y="70" text-anchor="middle" fill="var(--ink-soft)" font-size="11">标题 金额 标签</text>
<line x1="136" y1="56" x2="176" y2="56" stroke="var(--rule)"/>
<rect x="176" y="30" width="130" height="52" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="241" y="52" text-anchor="middle" fill="var(--ink)">凑成字典</text>
<text x="241" y="70" text-anchor="middle" fill="var(--ink-soft)" font-size="11">+ next_id 编号</text>
<line x1="306" y1="56" x2="346" y2="56" stroke="var(--rule)"/>
<rect x="346" y="30" width="150" height="52" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="421" y="52" text-anchor="middle" fill="var(--ink)">Ticket.model_validate</text>
<text x="421" y="70" text-anchor="middle" fill="var(--ink-soft)" font-size="11">规则全在模型里</text>
<line x1="421" y1="82" x2="421" y2="120" stroke="var(--rule)"/>
<text x="431" y="106" fill="var(--ink-faint)" font-size="11">通过</text>
<line x1="421" y1="82" x2="540" y2="120" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="500" y="100" fill="var(--ink-faint)" font-size="11">没通过</text>
<rect x="346" y="120" width="150" height="52" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="421" y="142" text-anchor="middle" fill="var(--ink)">整本存盘</text>
<text x="421" y="160" text-anchor="middle" fill="var(--ink-soft)" font-size="11">intake.json</text>
<rect x="520" y="120" width="104" height="52" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="572" y="142" text-anchor="middle" fill="var(--ink)">中文提示</text>
<text x="572" y="160" text-anchor="middle" fill="var(--ink-soft)" font-size="11">打印给用户</text>
<line x1="572" y1="172" x2="572" y2="206" stroke="var(--rule)"/>
<rect x="446" y="206" width="178" height="48" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="535" y="227" text-anchor="middle" fill="var(--ink)">追加一行日志</text>
<text x="535" y="245" text-anchor="middle" fill="var(--ink-soft)" font-size="11">intake_rejected.jsonl</text>
<text x="16" y="140" fill="var(--ink-faint)" font-size="11">intake_msgs.py</text>
<text x="16" y="156" fill="var(--ink-faint)" font-size="11">翻译在这一层</text>
<text x="16" y="226" fill="var(--ink-faint)" font-size="11">intake_store.py</text>
<text x="16" y="242" fill="var(--ink-faint)" font-size="11">文件在这一层</text>
</g>
</svg>
<figcaption>一张工单从键盘到落盘的路。蓝色是校验和翻译(模型侧),琥珀色是读写文件和键盘(外部侧)。拦下的工单不丢,会留一行日志。</figcaption>
</figure>

有几个决定先说清楚,后面的代码都围着它们转。

**工单号不让用户填。** 用户只填标题、金额、标签,编号由工具分配,取已有工单里的最大号加一。让人手填编号,重复、格式错、跳号都会发生,这是一类根本不该让人犯的错。

**工具自己不写一条校验规则。** 标题能不能空、金额能不能为负,都是 Day 52 的 `Ticket` 说了算。以后改规则(比如金额上限从 10 万改成 5 万)只改模型一处,录入工具、批量导入、API 全部同步生效。这是 pydantic 带来的最大好处,也是今天最想让你体会的一点。工具要做的只有两件事:把键盘上的东西凑成字典交给模型,把模型的拒绝翻译成人话。

**被拦的不丢。** 一张工单被拦,往往是用户当时没填对,但这条记录有价值:哪类错误最常出现,说明表单设计得哪里不清楚。所以每张被拦的工单追加一行进 JSON Lines 日志,[Day 39](/blog/agent-zero/day-039-json/) 说过,要不停往后加的数据用这种格式。

**文件坏了不覆盖。** 数据文件被手改坏、读不出来时,工具直接报错退出,绝不能「读不出来就当空的,然后写回去」,那样等于把用户的数据悄悄清空。

## 第一步:从键盘读一张工单

最小的零件是 `input()`。[Day 14](/blog/agent-zero/day-014-bool-none/) 用它读过金额,拿到的永远是字符串。新建 `part01/ask_one.py`:

```python
# agent-zero-lab/part01/ask_one.py
title = input("标题: ")
amount = input("金额: ")
print("收到:", repr(title), repr(amount))
```

<div class="line-notes">

- `title = input("标题: ")` 打印提示「标题: 」,等用户敲一行字加回车,把这一行(不含回车)当字符串返回。
- `amount = input("金额: ")` 金额也是字符串,哪怕用户敲的是 `66`。转成数字这件事,今天交给 pydantic,不自己写 `float()`。
- `print("收到:", repr(title), repr(amount))` 用 `repr` 打印,字符串带引号,首尾的空格看得清。

</div>

我们不坐在终端前一行行敲,而是用管道(Day 5)把两行字送进去,效果和键盘输入一样:

```bash
printf '发票重开\n66\n' | uv run python part01/ask_one.py
printf '发票重开\n' | uv run python part01/ask_one.py
```

实测输出:

```text
标题: 金额: 收到: '发票重开' '66'
标题: 金额: Traceback (most recent call last):
  File "/Users/你/agent-zero-lab/part01/ask_one.py", line 3, in <module>
    amount = input("金额: ")
             ^^^^^^^^^^^^^^^
EOFError: EOF when reading a line
```

第一次正常。注意输出里「标题: 」后面直接接着「金额: 」,因为管道送进来的字符不会像键盘输入那样回显在屏幕上,屏幕上只有程序自己打印的提示。

第二次只送了一行,第二个 `input()` 就炸了:`EOFError: EOF when reading a line`。EOF 是 End Of File(文件结束)的缩写,意思是「输入已经没有了」。键盘输入时按 `Ctrl + D` 就是主动告诉程序「我不再输入了」,管道里的内容用完了也是一样。**用户中途按 Ctrl + D,或者脚本被喂了不完整的输入,都会触发它,所以只要程序用 `input()`,就要想一想这个异常怎么接。** 我们的工具的做法是:把它当成「输入结束」,正常收尾。

还有一个小问题:管道送进来的输入屏幕上看不见,录好的演示输出会变成一串连在一起的提示,读不懂谁回答了什么。所以我们让工具在「输入不是来自键盘」时把收到的内容回显出来。判断办法是 `sys.stdin.isatty()`:`tty` 是终端设备的意思,这个方法问「标准输入是不是接在一个真终端上」,键盘输入返回 True,管道和 `< 文件` 返回 False。这个函数会在最后的 `ask` 里出现。

## 第二步:把校验错误翻译成人话

Day 51 写过一个 `to_messages`,只认五种错误类型。今天的 `Ticket` 规则多了不少,先看看它到底会产生哪些错误。新建 `part01/err_types.py`,喂它 11 份各有毛病的字典:

```python
# agent-zero-lab/part01/err_types.py
from pydantic import ValidationError

from ticket_pd import Ticket

BAD = [
    {"id": "T-1006", "title": "", "amount": 50},
    {"id": "T-1006", "title": "x" * 31, "amount": 50},
    {"id": "T-1006", "title": "   ", "amount": 50},
    {"id": "T-1006", "title": "退款", "amount": -50},
    {"id": "T-1006", "title": "退款", "amount": 200000},
    {"id": "T-1006", "title": "退款", "amount": 50.123},
    {"id": "T-1006", "title": "退款", "amount": "五十"},
    {"id": "1006", "title": "退款", "amount": 50},
    {"id": "T-1006", "title": "退款", "amount": 50, "status": "pending"},
    {"id": "T-1006", "title": "退款"},
    {"id": "T-1006", "title": "退款", "amount": 50, "tags": "退款"},
]

for raw in BAD:
    try:
        Ticket.model_validate(raw)
    except ValidationError as e:
        for err in e.errors():
            print(err["loc"][0], err["type"], "|", err["msg"], "|", err.get("ctx"))
```

<div class="line-notes">

- `from ticket_pd import Ticket` Day 52 建的 pydantic 版 Ticket,规则全在里面:工单号像 `T-1004`、标题 1 到 30 个字、金额大于 0 小于等于 10 万。
- `BAD = [` 11 份有毛病的数据,每份只坏一处,方便一一对应。
- `{"id": "T-1006", "title": "x" * 31, "amount": 50},` `"x" * 31` 是 31 个 x,比上限 30 多一个(字符串乘整数是重复,Day 15)。
- `{"id": "T-1006", "title": "退款", "amount": 50.123},` 三位小数,Field 拦不住,是 Day 52 那个 `at_most_two_decimals` 校验器拦的。
- `{"id": "T-1006", "title": "退款"},` 少了 amount 字段。
- `{"id": "T-1006", "title": "退款", "amount": 50, "tags": "退款"},` tags 应该是列表,给了字符串。
- `for err in e.errors():` Day 51 的老办法,一份数据可能有几处错,逐条取。
- `print(err["loc"][0], err["type"], "|", err["msg"], "|", err.get("ctx"))` loc 的第一个元素是字段名,type 是错误类型代号,msg 是英文说明,ctx 是这个错误的「上下文」,比如限制是多少。ctx 不是每个错误都有,所以用 `.get`。

</div>

```bash
uv run python part01/err_types.py
```

实测输出:

```text
title string_too_short | String should have at least 1 character | {'min_length': 1}
title string_too_long | String should have at most 30 characters | {'max_length': 30}
title value_error | Value error, 标题不能全是空格 | {'error': ValueError('标题不能全是空格')}
amount greater_than | Input should be greater than 0 | {'gt': 0.0}
amount less_than_equal | Input should be less than or equal to 100000 | {'le': 100000.0}
amount value_error | Value error, 金额最多两位小数,收到 50.123 | {'error': ValueError('金额最多两位小数,收到 50.123')}
amount float_parsing | Input should be a valid number, unable to parse string as a number | None
id string_pattern_mismatch | String should match pattern '^T-\d{4}$' | {'pattern': '^T-\\d{4}$'}
status literal_error | Input should be 'open' or 'closed' | {'expected': "'open' or 'closed'"}
amount missing | Field required | None
tags list_type | Input should be a valid list | None
```

读这张表有三个收获。

第一,每种错误有个固定的 `type` 代号,中文翻译应该挂在代号上,不要对英文 `msg` 做字符串替换。Day 51 说过理由:英文措辞随版本会变,代号不会。

第二,`ctx` 里带着具体的数字,`min_length`、`max_length`、`gt`、`le`。翻译时直接取,「标题最多 30 个字」里的 30 就不用在翻译表里再写一遍。以后模型里把上限改成 50,翻译自动跟着变。

第三,我们自己写的校验器(`title_not_blank`、`at_most_two_decimals`)产生的是 `value_error`,`ctx["error"]` 里装着当时 `raise ValueError(...)` 的那个异常对象,`str()` 一下就是我们写的中文原话。这类错误不用翻译,原话直接用。

现在写翻译模块。它复用 Day 51 `ticket_form.py` 里的 `LABELS`(字段名对中文标签)和 `HINTS`(错误类型对中文提示),再补上新的几种。新建 `part01/intake_msgs.py`:

```python
# agent-zero-lab/part01/intake_msgs.py
from pydantic import ValidationError
from pydantic_core import ErrorDetails

from ticket_form import HINTS as FORM_HINTS
from ticket_form import LABELS as FORM_LABELS

LABELS = {**FORM_LABELS, "tags": "标签"}
HINTS = {
    **FORM_HINTS,
    "string_too_short": "至少要 {min_length} 个字",
    "string_too_long": "最多 {max_length} 个字",
    "greater_than": "要大于 {gt:g}",
    "less_than_equal": "不能超过 {le:g}",
    "string_pattern_mismatch": "格式不对,要像 T-1004",
    "list_type": "要填标签列表",
}


def one_message(err: ErrorDetails) -> str:
    ctx = err.get("ctx", {})
    if err["type"] == "value_error":
        return str(ctx["error"])
    name = str(err["loc"][0])
    label = LABELS.get(name, name)
    template = HINTS.get(err["type"])
    if template is None:
        return f"{label}: {err['msg']}"
    text = f"{label}{template.format(**ctx)}"
    if err["type"] == "missing":
        return text
    return f"{text}(收到 {err['input']!r})"


def to_messages(e: ValidationError) -> list[str]:
    return [one_message(err) for err in e.errors()]
```

<div class="line-notes">

- `from pydantic_core import ErrorDetails` `e.errors()` 里每一条的类型。pydantic_core 是 pydantic 自带的底层包,装 pydantic 时已经装好了。只在给参数写类型标注时用到它,不然检查器会说 `err` 是未知类型。
- `from ticket_form import HINTS as FORM_HINTS` 导入 Day 51 建的 `part01/ticket_form.py` 里的 HINTS,`as` 起个别名,因为本文件里要定义一个新的同名变量。导入时 ticket_form 的演示代码在 main guard 里,不会执行。
- `LABELS = {**FORM_LABELS, "tags": "标签"}` `{**a, "k": v}` 把字典 a 的内容全部展开进来,再加一条。相当于 JS 里的 `{...FORM_LABELS, tags: "标签"}`。Day 51 的对照表只有工单号、标题、金额、状态四项,今天多了标签。
- `**FORM_HINTS,` 同样的展开,先拿 Day 51 的五条(missing、string_type、float_parsing、float_type、literal_error)当底。
- `"string_too_short": "至少要 {min_length} 个字",` 花括号里是占位符,稍后用 ctx 里的值填。`ctx` 是 `{'min_length': 1}`,填完就是「至少要 1 个字」。
- `"greater_than": "要大于 {gt:g}",` ctx 里的 gt 是 `0.0`,直接填会显示「要大于 0.0」。冒号后面的 `g` 是格式说明,意思是「通用格式」,浮点数没有小数部分时不显示小数点,0.0 变成 `0`,100000.0 变成 `100000`。
- `def one_message(err: ErrorDetails) -> str:` 翻译一条错误。
- `ctx = err.get("ctx", {})` 取 ctx,没有就用空字典。`ErrorDetails` 里 ctx 是可选的键,检查器要求这么写。
- `if err["type"] == "value_error":` 自己写的校验器产生的错误。
- `return str(ctx["error"])` 把当初 raise 的那个 ValueError 变回文字:「标题不能全是空格」。这类错误的原话已经是完整的中文句子,不再加标签和「收到」。
- `name = str(err["loc"][0])` loc 的第一个元素是字段名,外面包个 `str` 是因为它的类型可能是字符串或整数。
- `label = LABELS.get(name, name)` 有中文标签就用,没有就用字段名原样。
- `template = HINTS.get(err["type"])` 按错误类型找中文模板,找不到得到 None。
- `return f"{label}: {err['msg']}"` 没翻译过的错误类型退回英文原话,至少不会什么都不显示。
- `text = f"{label}{template.format(**ctx)}"` `str.format` 用字典里的值填占位符,`**ctx` 把字典展开成关键字参数(Day 30)。「标题」加上「最多 30 个字」。
- `if err["type"] == "missing":` 字段缺失时 input 是整个字典,打印出来又长又乱,所以不加「收到」。
- `return f"{text}(收到 {err['input']!r})"` 其余都带上用户填的原值,`!r` 让字符串带引号,空格看得清。
- `def to_messages(e: ValidationError) -> list[str]:` 对外的入口:一个 ValidationError 变成一组中文。
- `return [one_message(err) for err in e.errors()]` 列表推导式(Day 23),逐条翻译。

</div>

文件底部我们加一段演示,用刚才那 10 份坏数据(去掉最后一份 tags 的)验证翻译。把下面这段接在 `to_messages` 后面:

```python
if __name__ == "__main__":
    from ticket_pd import Ticket

    bad = [
        {"id": "T-1006", "title": "", "amount": 50},
        {"id": "T-1006", "title": "x" * 31, "amount": 50},
        {"id": "T-1006", "title": "   ", "amount": 50},
        {"id": "T-1006", "title": "退款", "amount": -50},
        {"id": "T-1006", "title": "退款", "amount": 200000},
        {"id": "T-1006", "title": "退款", "amount": 50.123},
        {"id": "T-1006", "title": "退款", "amount": "五十"},
        {"id": "1006", "title": "退款", "amount": 50},
        {"id": "T-1006", "title": "退款", "amount": 50, "status": "pending"},
        {"id": "T-1006", "title": "退款"},
    ]
    for raw in bad:
        try:
            Ticket.model_validate(raw)
        except ValidationError as e:
            for line in to_messages(e):
                print(line)
```

<div class="line-notes">

- `if __name__ == "__main__":` Day 32 的 main guard:直接运行这个文件时才执行下面的演示,被别的文件 import 时不执行。
- `from ticket_pd import Ticket` 放在 guard 里面,因为只有演示用得到它,正常使用时 `intake_msgs` 不需要依赖 Ticket。
- `bad = [` 前面那份列表去掉了最后一条 tags 的,剩 10 份。
- `for line in to_messages(e):` 一份数据可能有几条消息,逐条打印。

</div>

```bash
uv run basedpyright part01/intake_msgs.py
uv run python part01/intake_msgs.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
标题至少要 1 个字(收到 '')
标题最多 30 个字(收到 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
标题不能全是空格
金额要大于 0(收到 -50)
金额不能超过 100000(收到 200000)
金额最多两位小数,收到 50.123
金额要填数字(收到 '五十')
工单号格式不对,要像 T-1004(收到 '1006')
状态只能是 open 或 closed(收到 'pending')
金额必填
```

十条各对上一句中文。注意第 4 条「金额要大于 0」里的 0 和第 5 条「不能超过 100000」里的数字,是从 Day 52 模型的 `Field(gt=0, le=100000)` 里读出来的,翻译表里没有写死。哪天你把模型的上限改成 50000,这句话自己就会变。

## 第三步:编号、读盘、拦下的记账

文件相关的函数放进 `part01/intake_store.py`。先看最容易写错的一个:新工单的编号。

直觉的写法是「已有几张,新的就是几加一」。用 notebook 里的四张试一下。新建 `part01/next_id_demo.py`:

```python
# agent-zero-lab/part01/next_id_demo.py
from intake_store import DATA, load_book, next_id

tickets = load_book(DATA / "notebook.json")
print([t.id for t in tickets])
print("按个数算:", f"T-{len(tickets) + 1}")
print("按最大号算:", next_id(tickets))
print("空记事本:", next_id([]))
```

<div class="line-notes">

- `from intake_store import DATA, load_book, next_id` 这三样等一下在 `intake_store.py` 里写,先看用法。DATA 是 `part01/data` 目录,load_book 读一个 JSON 文件变成 Ticket 列表,next_id 算下一个编号。
- `tickets = load_book(DATA / "notebook.json")` 读 Day 44 的记事本,四张工单。
- `print([t.id for t in tickets])` 先看现有编号。
- `print("按个数算:", f"T-{len(tickets) + 1}")` 反面教材:四张加一。
- `print("按最大号算:", next_id(tickets))` 取最大的编号加一。
- `print("空记事本:", next_id([]))` 一张都没有时从哪开始。

</div>

先把 `intake_store.py` 写出来(整个文件在下面),再运行这个演示。新建 `part01/intake_store.py`:

```python
# agent-zero-lab/part01/intake_store.py
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from intake_msgs import to_messages
from ticket_pd import Ticket

DATA = Path(__file__).resolve().parent / "data"


class BookError(Exception):
    pass


def book_path() -> Path:
    env = os.environ.get("INTAKE_FILE")
    return Path(env) if env else DATA / "intake.json"


def rejected_path(book: Path) -> Path:
    return book.with_name(book.stem + "_rejected.jsonl")


def load_book(path: Path) -> list[Ticket]:
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise BookError(f"{path.name} 不是合法的 JSON({e.msg},第 {e.lineno} 行),我没有动它,请先修好或改名再运行") from e
    if not isinstance(data, list):
        raise BookError(f"{path.name} 最外层应该是一个列表")
    tickets: list[Ticket] = []
    for number, raw in enumerate(data, start=1):
        try:
            tickets.append(Ticket.model_validate(raw))
        except ValidationError as e:
            raise BookError(f"{path.name} 第 {number} 张工单不合规矩:" + ";".join(to_messages(e))) from None
    return tickets


def next_id(tickets: list[Ticket]) -> str:
    biggest = max((int(t.id[2:]) for t in tickets), default=1000)
    return f"T-{biggest + 1}"


def log_rejected(path: Path, form: dict[str, Any], reasons: list[str]) -> None:
    record = {"time": datetime.now().isoformat(timespec="seconds"), "form": form, "reasons": reasons}
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
```

<div class="line-notes">

- `import os` 为了读环境变量 `INTAKE_FILE`,Day 53 的老朋友。
- `from datetime import datetime` 标准库里管日期时间的模块,这里只用 `datetime.now()` 拿「现在几点」。
- `from typing import Any` 日志里的表单字典值类型不一,标 Any(Day 46)。
- `from intake_msgs import to_messages` 刚写的翻译模块,读到坏文件时报错信息也要用中文说明哪张工单哪里不对。
- `DATA = Path(__file__).resolve().parent / "data"` Day 37 的写法:`part01/data` 目录,从哪个目录运行脚本都找得到。
- `class BookError(Exception):` Day 36 的自定义异常。专门表示「数据文件有问题」,`main` 里只接这一种,别的程序 bug 就不会被它吞掉。
- `def book_path() -> Path:` 决定数据文件放哪。
- `env = os.environ.get("INTAKE_FILE")` 这是**可选**配置,没设就用默认位置,所以用 `.get` 而不是方括号(Day 53 讲过两者的分工:缺了不能干活的用 `[]`,可选的用 `.get`)。
- `return Path(env) if env else DATA / "intake.json"` 设了就用它(空字符串也算没设),没设就是 `part01/data/intake.json`。
- `def rejected_path(book: Path) -> Path:` 被拦记录的文件跟着数据文件走。
- `return book.with_name(book.stem + "_rejected.jsonl")` `stem` 是不带扩展名的文件名,`intake.json` 的 stem 是 `intake`,拼出 `intake_rejected.jsonl`,放在同一个目录。`with_name` 是换掉路径最后那一段名字。换个数据文件,日志也跟着换,不会混在一起。
- `if not path.exists():` 文件还不存在(第一次用)就当一本空记事本,返回空列表。文件**存在但读不出来**则是另一回事,下面处理。
- `data = json.loads(path.read_text(encoding="utf-8"))` Day 39 的老写法,读文本再解析。解析失败会抛 `json.JSONDecodeError`。
- `except json.JSONDecodeError as e:` 文件被手改坏了(尾逗号、少括号)。
- `raise BookError(f"{path.name} 不是合法的 JSON({e.msg},第 {e.lineno} 行),我没有动它,请先修好或改名再运行") from e` 把 JSON 的英文报错翻成我们的业务异常,`e.msg` 是原因,`e.lineno` 是出错行号。「我没有动它」这句很重要,让用户放心。
- `if not isinstance(data, list):` JSON 合法但最外层不是列表(比如一个对象),后面按列表遍历就会乱,先拦住。
- `tickets: list[Ticket] = []` 空列表也要标类型(Day 46)。
- `for number, raw in enumerate(data, start=1):` `enumerate` 同时给下标和元素,`start=1` 让下标从 1 开始数,因为人说「第 1 张」不说「第 0 张」。
- `tickets.append(Ticket.model_validate(raw))` 每张都重新过一遍全部规则。文件被手改过的话,这里能抓出来。
- `raise BookError(f"{path.name} 第 {number} 张工单不合规矩:" + ";".join(to_messages(e))) from None` 说清是第几张、什么毛病。`from None` 是 Day 53 讲的:不带那一大段原始报错。
- `biggest = max((int(t.id[2:]) for t in tickets), default=1000)` 逐张取编号的数字部分:`t.id[2:]` 是切片(Day 15),把 `T-1005` 去掉开头两个字符得到 `"1005"`,`int` 转成整数 1005。外层的 `max` 取最大值。括号里这种写法叫生成器表达式,和列表推导式一样的语法,只是不先造出整个列表。`default=1000` 是列表为空时的返回值,因为空序列没有最大值,不给 default 会报 `ValueError`。
- `return f"T-{biggest + 1}"` 最大号加一,拼回 `T-xxxx`。
- `def log_rejected(path: Path, form: dict[str, Any], reasons: list[str]) -> None:` 记一笔被拦的工单。
- `record = {"time": datetime.now().isoformat(timespec="seconds"),` `isoformat` 把时间写成 `2026-10-23T11:20:23` 这种标准格式,`timespec="seconds"` 精确到秒,不要后面的微秒。
- `with path.open("a", encoding="utf-8") as f:` Day 38 的 `with`,`"a"` 是追加模式:不清空文件,从末尾接着写;文件不存在就新建。
- `f.write(json.dumps(record, ensure_ascii=False) + "\n")` 一条记录占一行:`dumps` 变成一行 JSON 文本,`ensure_ascii=False` 让中文原样保存而不是 `金` 这种转义,末尾补换行符。这就是 JSON Lines。

</div>

写完以后,检查并运行 `next_id_demo.py`:

```bash
uv run basedpyright part01/intake_store.py part01/intake_msgs.py
uv run python part01/next_id_demo.py
```

实测输出:

```text
0 errors, 0 warnings, 0 notes
['T-1001', 'T-1002', 'T-1004', 'T-1005']
按个数算: T-5
按最大号算: T-1006
空记事本: T-1001
```

按个数算得到 `T-5`,连格式都不对(模型要求 `T-` 加四位数字),更糟的是,就算格式对,工单 T-1003 早在 Day 44 被删了,编号里有个空洞,个数和最大号早就不是一回事。按最大号算既不会撞已有的编号,也不会依赖有没有空洞。空记事本从 1001 开始,和 `T-\d{4}` 的格式匹配。

这个函数留了一个隐患,你现在就该知道:两个人同时往同一个文件里录,会各自算出同一个「下一个编号」。我们的工具是一个人在一台机器上用的,这个问题等到有数据库、有多个用户时再解决(第三部分之后的服务端课程会讲)。

## 把零件拼起来:intake.py

三层零件都齐了,现在写主流程。新建 `part01/intake.py`:

```python
# agent-zero-lab/part01/intake.py
import sys
from typing import Any

from dotenv import load_dotenv
from pydantic import ValidationError

from intake_msgs import to_messages
from intake_store import BookError, book_path, load_book, log_rejected, next_id, rejected_path
from ticket_pd import Ticket, save

USAGE = "用法: intake.py [list]\n  不带参数: 一张一张录入,标题直接回车结束\n  list: 列出已录入的工单"


def ask(prompt: str) -> str:
    text = input(prompt)
    if not sys.stdin.isatty():
        print(text)
    return text


def split_tags(text: str) -> list[str]:
    text = text.replace("，", ",")
    return [part.strip() for part in text.split(",") if part.strip()]


def ask_form() -> dict[str, Any] | None:
    title = ask("标题(直接回车结束): ")
    if title == "":
        return None
    amount = ask("金额: ")
    tags = split_tags(ask("标签(可空,逗号隔开): "))
    return {"title": title, "amount": amount, "tags": tags}


def main(args: list[str]) -> int:
    load_dotenv()
    book = book_path()
    try:
        tickets = load_book(book)
    except BookError as e:
        print("出错了:", e)
        return 1

    if args == ["list"]:
        for t in tickets:
            tags = f"  标签:{','.join(t.tags)}" if t.tags else ""
            print(f"{t}{tags}")
        print(f"共 {len(tickets)} 张")
        return 0
    if args:
        print(USAGE)
        return 2

    book.parent.mkdir(parents=True, exist_ok=True)
    saved = 0
    rejected = 0
    while True:
        try:
            form = ask_form()
        except EOFError:
            print()
            break
        if form is None:
            break
        try:
            ticket = Ticket.model_validate({**form, "id": next_id(tickets)})
        except ValidationError as e:
            reasons = to_messages(e)
            log_rejected(rejected_path(book), form, reasons)
            rejected += 1
            print("  没录入: " + ";".join(reasons))
            continue
        tickets.append(ticket)
        save(book, tickets)
        saved += 1
        print(f"  已录入 {ticket}")
    print(f"本次录入 {saved} 张,被拦 {rejected} 张,共 {len(tickets)} 张")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

<div class="line-notes">

- `import sys` 要用 `sys.stdin`、`sys.argv`、`sys.exit`(Day 44 的老朋友)。
- `from dotenv import load_dotenv` Day 53 的 python-dotenv。今天它的用处是让你能在 `.env` 里写一行 `INTAKE_FILE=...` 换数据文件。
- `from intake_store import BookError, book_path, load_book, log_rejected, next_id, rejected_path` 第三步写的六样,一次导进来。
- `from ticket_pd import Ticket, save` Day 52 的模型,以及把 Ticket 列表整本写成 JSON 的 `save`。`load` 没导入,因为我们用自己的 `load_book`(它能说清楚坏在第几张)。
- `USAGE = "用法:` 参数不对时打印的提示,和 Day 44 一样的做法。
- `def ask(prompt: str) -> str:` 对 `input` 包一层。
- `text = input(prompt)` 正常读一行。
- `if not sys.stdin.isatty():` 输入不是来自真终端(管道或 `<` 重定向),屏幕上看不到用户「敲」了什么。
- `print(text)` 把收到的内容自己打印出来,这样录好的演示读起来像一次真实的对话。真终端里键盘本身会回显,这一行不执行,避免显示两遍。
- `def split_tags(text: str) -> list[str]:` 把用户敲的「咨询, 套餐」变成列表。
- `text = text.replace("，", ",")` 中文输入法下很容易敲出全角逗号 `，`,先统一成半角逗号。
- `return [part.strip() for part in text.split(",") if part.strip()]` 按逗号切开(Day 16),每段去掉首尾空格,并且丢掉空段(用户敲了两个连续逗号,或者什么都没敲时,`"".split(",")` 会得到 `[""]`,不过滤的话会得到一个空标签)。
- `def ask_form() -> dict[str, Any] | None:` 问一张工单要的三样东西。返回字典,或者 None 表示用户想结束了。
- `title = ask("标题(直接回车结束): ")` 约定:标题直接回车就是不想再录了。
- `if title == "":` 注意判断的是**空字符串**,不是去掉空格以后为空。如果用户敲了三个空格,它不算结束,会走到模型的「标题不能全是空格」那一关,拿到一句明确的提示。
- `amount = ask("金额: ")` 金额保持字符串原样,不在这里转数字。
- `tags = split_tags(ask("标签(可空,逗号隔开): "))` 先问,再切。
- `return {"title": title, "amount": amount, "tags": tags}` 三个键,和 `Ticket` 的字段名一一对应,**不含 id**。
- `def main(args: list[str]) -> int:` 返回值是退出码(Day 44)。
- `load_dotenv()` 读 `.env`。已经在终端里设了的变量不会被覆盖(Day 53),所以命令行里临时写 `INTAKE_FILE=xxx uv run ...` 比 `.env` 里的优先。
- `book = book_path()` 决定数据文件在哪。
- `tickets = load_book(book)` 读出已有的工单。第一次运行文件不存在,得到空列表。
- `except BookError as e:` 文件坏了,只接这一种异常。
- `print("出错了:", e)` 告诉用户哪里坏了,然后 `return 1` 退出,**不继续往下走**。后面的 `save` 根本不会执行,坏文件原封不动。
- `if args == ["list"]:` 命令行只给了 `list` 一个参数,走「列出」分支。`args` 是 `sys.argv[1:]`。
- `tags = f"  标签:{','.join(t.tags)}" if t.tags else ""` 有标签才显示。f-string 的花括号里要用单引号,因为外层已经用了双引号。
- `print(f"{t}{tags}")` `{t}` 调用 Day 52 写的 `__str__`,显示成 `[open] T-1006 发票重开 ¥66.0`。
- `if args:` 到这里 args 不是空的,也不是 `["list"]`,就是不认识的命令,打印用法,退出码 2(Day 48 讲过:2 表示用法错误)。
- `book.parent.mkdir(parents=True, exist_ok=True)` 保证数据文件所在的目录存在(Day 37)。`INTAKE_FILE` 指到一个还没建的目录时,这行会把它建出来,不然第一次 `save` 会报找不到目录。
- `saved = 0` / `rejected = 0` 两个计数器,最后汇报用。
- `while True:` 一直录,直到用户说停(Day 19)。
- `form = ask_form()` 问一张。
- `except EOFError:` 第一步演示过的:输入提前结束。把它当作「到此为止」。
- `print()` 输出空行。管道输入结束时,屏幕上最后一个提示后面没有换行,不加这一行,收尾那句话会接在提示后面。
- `if form is None:` 用户直接回车,正常结束。
- `ticket = Ticket.model_validate({**form, "id": next_id(tickets)})` 先用 `**form` 把三个键展开进新字典,再加一个 `id`。字典交给 `model_validate`:通过就得到一个 `Ticket` 对象,金额字符串自动转成数字。
- `except ValidationError as e:` 没通过。
- `reasons = to_messages(e)` 翻成中文。
- `log_rejected(rejected_path(book), form, reasons)` 记一笔。记的是 `form`,不含编号:这张工单被拦了,它不该占一个号。
- `continue` 回到 while 开头,问下一张。
- `tickets.append(ticket)` 通过了,加进内存里的列表。
- `save(book, tickets)` 每录入一张就**整本写回一次**,不等到最后。这样中途 `Ctrl + C` 退出,前面录好的也都在盘上。`save` 是 Day 52 写的,里面用 `model_dump` 导出。
- `print(f"  已录入 {ticket}")` 反馈一下。
- `print(f"本次录入 {saved} 张,被拦 {rejected} 张,共 {len(tickets)} 张")` 收尾汇报。「共」是文件里一共有几张,不只是这次录的。
- `return 0` 正常结束的退出码。被拦不算工具出错,所以还是 0。
- `sys.exit(main(sys.argv[1:]))` `sys.argv[1:]` 去掉脚本名剩下的参数,main 的返回值变成进程退出码。

</div>

先静态检查,再准备五张工单的输入。新建 `part01/data/intake_demo.txt`,一张工单三行(标题、金额、标签),第 5 张标题前后故意带了空格,标签用了全角逗号:

```text
发票重开
66
发票
退订后还在扣费
89
退款,扣费
多扣了一个月
-99
退款
改发票邮箱
30

  升级咨询  
199.5
咨询， 套餐
```

第 4 张「改发票邮箱」的标签那一行是空的(文件里就是一个空行)。最后没有写结束用的空标题,让输入自己用完,顺便测一下 `EOFError` 那一路。数据文件先从记事本复制一份:

```bash
cp part01/data/notebook.json part01/data/intake.json
uv run basedpyright part01/intake.py
uv run python part01/intake.py < part01/data/intake_demo.txt
```

`<` 是 `>` 的反方向:把右边这个文件的内容接到程序的标准输入上,等于有人替你把文件里的每一行都敲了一遍。

实测输出:

```text
0 errors, 0 warnings, 0 notes
标题(直接回车结束): 发票重开
金额: 66
标签(可空,逗号隔开): 发票
  已录入 [open] T-1006 发票重开 ¥66.0
标题(直接回车结束): 退订后还在扣费
金额: 89
标签(可空,逗号隔开): 退款,扣费
  已录入 [open] T-1007 退订后还在扣费 ¥89.0
标题(直接回车结束): 多扣了一个月
金额: -99
标签(可空,逗号隔开): 退款
  没录入: 金额要大于 0(收到 '-99')
标题(直接回车结束): 改发票邮箱
金额: 30
标签(可空,逗号隔开): 
  已录入 [open] T-1008 改发票邮箱 ¥30.0
标题(直接回车结束):   升级咨询  
金额: 199.5
标签(可空,逗号隔开): 咨询， 套餐
  已录入 [open] T-1009 升级咨询 ¥199.5
标题(直接回车结束): 
本次录入 4 张,被拦 1 张,共 8 张
```

五张工单,四张进了,一张被拦。逐条对一下:

- T-1006 和 T-1007 的金额 `66`、`89` 是字符串,被模型转成了 `66.0` 和 `89.0`。
- 「多扣了一个月」金额 `-99`,被 `gt=0` 拦下,提示里的 0 来自模型,「收到 '-99'」带引号,说明用户给的是字符串。
- 被拦的这张没有占编号:下一张「改发票邮箱」拿到的是 **T-1008**,不是 T-1009。
- 「升级咨询」前后各两个空格,标题校验器 `title_not_blank` 去掉了空格,所以显示的标题是干净的 `升级咨询`;标签 `咨询， 套餐` 用的是全角逗号加一个多余空格,`split_tags` 处理成了两个干净的标签。(这两点在 `list` 里再核对。)
- 输入文件没有写结束用的空标题,最后一个 `input()` 撞上 EOF,工具打印了一个空行,正常收尾,没有 Traceback。

### 核对落盘的结果

屏幕上显示成功不算数,看文件。先看 `intake.json` 的末尾,再看被拦记录:

```bash
tail -22 part01/data/intake.json
cat part01/data/intake_rejected.jsonl
```

实测输出:

```text
      "退款",
      "扣费"
    ]
  },
  {
    "id": "T-1008",
    "title": "改发票邮箱",
    "amount": 30.0,
    "status": "open",
    "tags": []
  },
  {
    "id": "T-1009",
    "title": "升级咨询",
    "amount": 199.5,
    "status": "open",
    "tags": [
      "咨询",
      "套餐"
    ]
  }
]
```

被拦记录那条实测是:

```text
{"time": "2026-10-23T11:20:23", "form": {"title": "多扣了一个月", "amount": "-99", "tags": ["退款"]}, "reasons": ["金额要大于 0(收到 '-99')"]}
```

`time` 是你运行那一刻的时间,和我的不会一样。日志里记的是用户**原始填的东西**(`amount` 还是字符串 `"-99"`),加上翻译好的原因。以后想知道「用户到底敲了什么」,查它。

用 `list` 命令读回来,并且再录一张,看编号是否接着走:

```bash
printf '补一张\n45\n退款\n\n' | uv run python part01/intake.py
uv run python part01/intake.py list
```

实测输出:

```text
标题(直接回车结束): 补一张
金额: 45
标签(可空,逗号隔开): 退款
  已录入 [open] T-1010 补一张 ¥45.0
标题(直接回车结束): 
本次录入 1 张,被拦 0 张,共 9 张
[closed] T-1001 发票抬头开错了 ¥199.0
[open] T-1002 升级套餐 年付 ¥399.0
[open] T-1004 扣费两次 ¥89.5
[open] T-1005 API 调用超额 ¥120.0
[open] T-1006 发票重开 ¥66.0  标签:发票
[open] T-1007 退订后还在扣费 ¥89.0  标签:退款,扣费
[open] T-1008 改发票邮箱 ¥30.0
[open] T-1009 升级咨询 ¥199.5  标签:咨询,套餐
[open] T-1010 补一张 ¥45.0  标签:退款
共 9 张
```

第二次运行是新的一次进程,它从文件里读到九张(原来四张加上次新录的四张),编号接着上次走到 T-1010。这就是「每个会改数据的命令最后都要存盘」(Day 44)的意义:数据在文件里,进程只是临时的。

第一次录入时用的是管道,所以 `ask` 里的 `isatty` 分支走的是「回显」那一路。我另外用 `script` 命令造了一个伪终端把工具跑了一遍,键盘输入只显示一遍、没有重复回显,「不回显」那一路也是通的。如果你在自己的终端里直接运行 `uv run python part01/intake.py`,会看到的是真键盘输入:敲一行回车一次,体验和上面一样。`Ctrl + D` 结束输入。

## 故意搞坏:三种「不是用户的错」

用户输错是预料之中的,模型已经管了。下面三种是环境的毛病,工具要给出能懂的反应。

### 数据文件被手改坏了

想象有人用编辑器改了 `intake.json`,手滑多打了一个逗号。我们用一个临时文件来试,不碰真正的 `intake.json`,方法是用 `INTAKE_FILE` 环境变量指向它(命令前面临时设变量,Day 53):

```bash
printf '[{"id": "T-1001", "title": "发票抬头开错了", "amount": 199,}]' > part01/data/bad.json
INTAKE_FILE=part01/data/bad.json uv run python part01/intake.py
echo "exit=$?"
cat part01/data/bad.json
```

实测输出:

```text
出错了: bad.json 不是合法的 JSON(Expecting property name enclosed in double quotes,第 1 行),我没有动它,请先修好或改名再运行
exit=1
[{"id": "T-1001", "title": "发票抬头开错了", "amount": 199,}]
```

工具说清了是哪个文件、什么毛病、在第几行,退出码是 1,文件**内容原封不动**。这就是上面设计里「读不出来就别覆盖」的效果。如果当初写成 `except json.JSONDecodeError: tickets = []`,这个文件下一次保存时就被一张新工单覆盖,旧数据全没了,而且没有任何提示。

另外两种坏法:JSON 合法但最外层是对象;JSON 合法但里面有张工单违反了规则(比如有人把金额手改成了 -1):

```bash
printf '{"id": "T-1001"}' > part01/data/bad.json
INTAKE_FILE=part01/data/bad.json uv run python part01/intake.py
printf '[{"id": "T-1001", "title": "ok", "amount": 5}, {"id": "T-1002", "title": "bad", "amount": -1}]' > part01/data/bad.json
INTAKE_FILE=part01/data/bad.json uv run python part01/intake.py
rm part01/data/bad.json
```

实测输出:

```text
出错了: bad.json 最外层应该是一个列表
出错了: bad.json 第 2 张工单不合规矩:金额要大于 0(收到 -1)
```

第二条告诉你第 2 张工单有问题。如果直接用 Day 52 `ticket_pd.py` 里的 `load`,同样会抛 `ValidationError`,但报错里看不出是第几张,一千张工单的文件里找一张错的就麻烦了。这就是我们自己写 `load_book` 的原因。

### 输入提前结束

第一步演示过 `ask_one.py` 的 EOFError。在 `intake.py` 里,中途断掉的输入(比如只送了标题和金额,没送标签)是这样的:

```bash
printf '半张\n45\n' | INTAKE_FILE=part01/data/half.json uv run python part01/intake.py
```

实测输出:

```text
标题(直接回车结束): 半张
金额: 45
标签(可空,逗号隔开): 
本次录入 0 张,被拦 0 张,共 0 张
```

没有 Traceback,工具把这张写到一半的工单直接丢掉,汇报「录入 0 张」。这是一个取舍:也可以选择把已经填了的先存下来,但没填完的工单拿去校验,多半又是一条错误,不如不要。真有需要,练习 3 的做法更友好:出错就重问。

### 相对路径的坑

`INTAKE_FILE` 写的是相对路径时,它是**相对于运行命令时所在的目录**,不是相对于脚本或者项目根目录。这一点 Day 53 提到过 `load_dotenv(".env.test")` 有同样的脾气。故意制造一次:先进到 `part01` 目录里再运行,路径还是照着根目录写:

```bash
cd part01
printf '一\n10\n\n' | INTAKE_FILE=part01/data/fresh.json uv run python intake.py | tail -1
find . -name "fresh*"
cd ..
ls part01/data
```

实测输出:

```text
本次录入 1 张,被拦 0 张,共 1 张
./part01/data/fresh.json
form_submissions.json
intake.json
intake_demo.txt
intake_rejected.jsonl
notebook.json
```

在 `part01` 目录里找到了 `./part01/data/fresh.json`,也就是 `agent-zero-lab/part01/part01/data/fresh.json`,一层多余的 `part01`。而 `ls part01/data` 里什么都没有,你以为存进去的数据去了另一个地方。罪魁祸首之一是我们那行 `mkdir(parents=True, exist_ok=True)`:它好心地把不存在的目录都建出来,结果这个错路径没有报错。为了安全可以只对默认目录这么做;真正的修法是**所有命令都从项目根目录运行**(这门课一直这么要求),或者 `INTAKE_FILE` 写绝对路径。

清理一下这次制造的混乱:

```bash
rm -r part01/part01
```

## 零件对照表

| 零件 | 哪天学的 | 在今天的工具里 |
| --- | --- | --- |
| `input()` 返回字符串 | Day 14 | `ask`,金额不自己转数字 |
| 自定义异常 | Day 36 | `BookError` |
| `Path`、`with`、追加模式 `"a"` | Day 37–38 | `log_rejected`、`book.parent.mkdir` |
| JSON、JSON Lines | Day 39 | `intake.json`、`intake_rejected.jsonl` |
| `sys.argv`、退出码 | Day 44 | `main(args)` 返回 0/1/2 |
| `X \| None`、收窄 | Day 46 | `ask_form` 返回 dict 或 None,`if form is None` |
| `BaseModel`、`ValidationError` | Day 51 | `Ticket.model_validate` 外面的 try |
| `Field`、`field_validator` | Day 52 | 规则全在 `Ticket` 里,工具一条都没写 |
| `model_dump` 存盘 | Day 52 | `save(book, tickets)` |
| `os.environ.get`、`load_dotenv` | Day 53 | `INTAKE_FILE` 可选配置 |

和 Day 44 的 `notebook.py` 对比:同样是命令行记事本,那时校验靠手写的 if 和 `TicketError`,现在换成 pydantic,校验规则不在工具里,反而更严格了(多了标题长度、两位小数、金额上限)。

## 动手练习

### 练习 1:金额里带了逗号和货币符号

真实用户敲金额不会只敲数字,会敲 `1,200`、`¥50`、`50元`。先看今天的工具遇到这些会怎样:新建 `part01/ex54_amount_see.py`,用 `Ticket.model_validate` 试四种写法,打印通过还是被拦。然后写一个 `clean_amount(text)` 函数把这些噪音去掉(逗号包括全角的,货币符号 `¥` 和 `￥`,空格,「元」字),再用它重跑,并且多试一个 `五十` 和空字符串,确认真正的错误还是会被拦下。新建 `part01/ex54_amount.py`。

<details>
<summary>参考答案</summary>

第一步,先看现状。`ex54_amount_see.py`:

```python
# agent-zero-lab/part01/ex54_amount_see.py
from pydantic import ValidationError

from intake_msgs import to_messages
from ticket_pd import Ticket

for text in ["1,200", "¥50", "50元", " 30 "]:
    try:
        t = Ticket.model_validate({"id": "T-1010", "title": "退款", "amount": text})
        print(repr(text), "通过", t.amount)
    except ValidationError as e:
        print(repr(text), "被拦:", to_messages(e)[0])
```

<div class="line-notes">

- `from intake_msgs import to_messages` 用今天的翻译。
- `for text in ["1,200", "¥50", "50元", " 30 "]:` 四种常见写法,最后一个只是首尾带空格。
- `t = Ticket.model_validate({"id": "T-1010", "title": "退款", "amount": text})` 标题、编号随便给合法的,只让金额有变化。
- `print(repr(text), "通过", t.amount)` 通过就打印转出来的数字。
- `print(repr(text), "被拦:", to_messages(e)[0])` 被拦就打印第一条中文提示。

</div>

```text
'1,200' 被拦: 金额要填数字(收到 '1,200')
'¥50' 被拦: 金额要填数字(收到 '¥50')
'50元' 被拦: 金额要填数字(收到 '50元')
' 30 ' 通过 30.0
```

pydantic 的宽松模式认得首尾空格(`' 30 '` 变成 30.0),不认逗号、货币符号和汉字。这些噪音属于「前端表单该帮用户处理的事」,所以处理放在录入工具里,不放在 `Ticket` 里:模型的规则是「金额是个数」,要不要宽容用户的写法是入口的决定。

第二步,清洗函数。`ex54_amount.py`:

```python
# agent-zero-lab/part01/ex54_amount.py
from pydantic import ValidationError

from intake_msgs import to_messages
from ticket_pd import Ticket

NOISE = "¥￥,， 元"


def clean_amount(text: str) -> str:
    for ch in NOISE:
        text = text.replace(ch, "")
    return text


for text in ["1,200", "¥50", "￥ 66.5", "50元", " 30 ", "五十", ""]:
    cleaned = clean_amount(text)
    try:
        t = Ticket.model_validate({"id": "T-1010", "title": "退款", "amount": cleaned})
        print(f"{text!r} -> {cleaned!r} 通过 {t.amount}")
    except ValidationError as e:
        print(f"{text!r} -> {cleaned!r} 被拦: {to_messages(e)[0]}")
```

<div class="line-notes">

- `NOISE = "¥￥,， 元"` 要去掉的字符放进一个字符串:半角和全角的货币符号、半角和全角的逗号、空格、「元」。注意这里面既有 `,` 也有 `，`。
- `def clean_amount(text: str) -> str:` 输入输出都是字符串,不转数字,转换还是交给模型。
- `for ch in NOISE:` 字符串可以直接遍历,一次拿一个字符(Day 18)。
- `text = text.replace(ch, "")` 每种噪音都替换成空,循环结束时全部去掉。
- `for text in ["1,200", "¥50", "￥ 66.5", "50元", " 30 ", "五十", ""]:` 前五个是该通过的,后两个必须仍被拦下。
- `cleaned = clean_amount(text)` 先清洗再校验。
- `print(f"{text!r} -> {cleaned!r} 通过 {t.amount}")` 同时打印清洗前后和结果,方便对照。

</div>

```text
'1,200' -> '1200' 通过 1200.0
'¥50' -> '50' 通过 50.0
'￥ 66.5' -> '66.5' 通过 66.5
'50元' -> '50' 通过 50.0
' 30 ' -> '30' 通过 30.0
'五十' -> '五十' 被拦: 金额要填数字(收到 '五十')
'' -> '' 被拦: 金额要填数字(收到 '')
```

前五个都通过了,`五十` 和空串仍然被拦。清洗函数只去掉噪音,没有「猜」用户的意思,不会把 `五十` 擅自当成 50。要把 `clean_amount` 用进工具,只改 `ask_form` 里一行:`amount = clean_amount(ask("金额: "))`。

</details>

### 练习 2:重复的工单

同一个客户手快录了两遍同样的工单(标题一样,金额一样,而且那一张还没关),应该拦下第二张。这条规则能不能写进 `Ticket` 模型?想一想再动手,新建 `part01/ex54_dup.py`,写 `find_duplicate` 和 `try_add`,用 notebook 里的四张工单试四份表单。

<details>
<summary>参考答案</summary>

先回答问题:**不能写进 `Ticket`**。一个模型实例只知道自己,「和别的工单比较」需要看见整本记事本,所以这种规则放在「加进整本之前」那一步。`ex54_dup.py`:

```python
# agent-zero-lab/part01/ex54_dup.py
from typing import Any

from pydantic import ValidationError

from intake_msgs import to_messages
from intake_store import DATA, load_book, next_id
from ticket_pd import Ticket


def find_duplicate(tickets: list[Ticket], new: Ticket) -> Ticket | None:
    for old in tickets:
        if not old.is_closed and old.title == new.title and old.amount == new.amount:
            return old
    return None


def try_add(tickets: list[Ticket], form: dict[str, Any]) -> tuple[Ticket | None, list[str]]:
    try:
        ticket = Ticket.model_validate({**form, "id": next_id(tickets)})
    except ValidationError as e:
        return None, to_messages(e)
    same = find_duplicate(tickets, ticket)
    if same is not None:
        return None, [f"和 {same.id} 重复了(标题和金额都一样,而且它还没关)"]
    return ticket, []


if __name__ == "__main__":
    tickets = load_book(DATA / "notebook.json")
    forms = [
        {"title": "扣费两次", "amount": 89.5},
        {"title": "扣费两次", "amount": 90},
        {"title": "发票抬头开错了", "amount": 199},
        {"title": " 扣费两次 ", "amount": "89.5"},
    ]
    for form in forms:
        ticket, reasons = try_add(tickets, form)
        print(form, "->", ticket if ticket else reasons)
```

<div class="line-notes">

- `from intake_store import DATA, load_book, next_id` 复用今天的读盘和编号函数。
- `def find_duplicate(tickets: list[Ticket], new: Ticket) -> Ticket | None:` 找得到就返回那张旧的,找不到返回 None(Day 46)。
- `if not old.is_closed and old.title == new.title and old.amount == new.amount:` 三个条件都满足才算重复:没关、标题一样、金额一样。`is_closed` 是 Day 50 起一直带着的 property。已经关掉的同名同金额工单(比如客户半年后又遇到同样的问题)不算重复。
- `return old` 返回旧的那一张,提示里要说「和谁重复」。
- `def try_add(tickets: list[Ticket], form: dict[str, Any]) -> tuple[Ticket | None, list[str]]:` 和 Day 51 的 `check_form` 一个思路:返回(对象或 None, 原因列表),调用方不用写 try。
- `ticket = Ticket.model_validate({**form, "id": next_id(tickets)})` 先过模型。注意**先校验、后查重**:标题清洗(去掉首尾空格)发生在模型里,没清洗过的标题去比较会漏掉 `" 扣费两次 "`。
- `same = find_duplicate(tickets, ticket)` 用校验后的对象去比。
- `return None, [f"和 {same.id} 重复了(标题和金额都一样,而且它还没关)"]` 重复也是一种被拦,和模型的拒绝走同一种返回形状。
- `{"title": " 扣费两次 ", "amount": "89.5"},` 第四份故意带空格、金额是字符串。

</div>

```text
{'title': '扣费两次', 'amount': 89.5} -> ['和 T-1004 重复了(标题和金额都一样,而且它还没关)']
{'title': '扣费两次', 'amount': 90} -> [open] T-1006 扣费两次 ¥90.0
{'title': '发票抬头开错了', 'amount': 199} -> [open] T-1006 发票抬头开错了 ¥199.0
{'title': ' 扣费两次 ', 'amount': '89.5'} -> ['和 T-1004 重复了(标题和金额都一样,而且它还没关)']
```

第一份和第四份被拦,第四份的标题带空格、金额是字符串,清洗和转换之后照样认出了是 T-1004 的重复。第二份金额不同,通过。第三份「发票抬头开错了」和 T-1001 完全一样,但 T-1001 已经关闭,所以放行。四次都显示 `T-1006` 是因为演示里没有把通过的加回 `tickets`。要放进主工具,把 `intake.py` 里的 `Ticket.model_validate(...)` 那一段换成 `try_add(tickets, form)` 即可。

</details>

### 练习 3:出错就重问,最多三次

现在一张工单被拦就只能下一张重来。改成:被拦了立刻重新问这一张,最多问三次,三次都错就放弃。新建 `part01/ex54_retry.py`,函数叫 `ask_until_ok(tickets)`,用管道喂两张工单的输入验证:第一张前两次错、第三次对;第二张连错三次。

<details>
<summary>参考答案</summary>

`ex54_retry.py`:

```python
# agent-zero-lab/part01/ex54_retry.py
from pydantic import ValidationError

from intake import ask_form
from intake_msgs import to_messages
from intake_store import DATA, load_book, next_id
from ticket_pd import Ticket

MAX_TRIES = 3


def ask_until_ok(tickets: list[Ticket]) -> Ticket | None:
    for attempt in range(1, MAX_TRIES + 1):
        form = ask_form()
        if form is None:
            return None
        try:
            return Ticket.model_validate({**form, "id": next_id(tickets)})
        except ValidationError as e:
            print(f"  第 {attempt} 次没通过: " + ";".join(to_messages(e)))
    print(f"  连错 {MAX_TRIES} 次,这张不录了")
    return None


if __name__ == "__main__":
    tickets = load_book(DATA / "notebook.json")
    for round_number in (1, 2):
        print(f"--- 第 {round_number} 张 ---")
        ticket = ask_until_ok(tickets)
        print("结果:", ticket)
```

<div class="line-notes">

- `from intake import ask_form` 直接复用主工具的 `ask_form`。`intake.py` 的演示和主流程在 `if __name__ == "__main__":` 下面,导入不会执行。
- `MAX_TRIES = 3` 常量放在最上面,改次数只改这一处。
- `for attempt in range(1, MAX_TRIES + 1):` `range(1, 4)` 产生 1、2、3,正好是「第几次」。
- `form = ask_form()` 每次重问整张(标题、金额、标签),不是只问错的那一项。
- `if form is None:` 用户在重问时直接回车,说明不想录了。
- `return Ticket.model_validate({**form, "id": next_id(tickets)})` 通过就把 Ticket 对象返回,循环到此结束。
- `print(f"  第 {attempt} 次没通过: " + ";".join(to_messages(e)))` 没通过就打印是第几次、为什么。
- `print(f"  连错 {MAX_TRIES} 次,这张不录了")` for 循环自然跑完(没有 return)才会走到这里。
- `for round_number in (1, 2):` 演示里连续录两张。

</div>

```bash
printf '退款\n五十\n\n退款\n-5\n\n退款\n50\n\nx\n-1\n\nx\n-2\n\nx\n-3\n\n' | uv run python part01/ex54_retry.py
```

```text
--- 第 1 张 ---
标题(直接回车结束): 退款
金额: 五十
标签(可空,逗号隔开): 
  第 1 次没通过: 金额要填数字(收到 '五十')
标题(直接回车结束): 退款
金额: -5
标签(可空,逗号隔开): 
  第 2 次没通过: 金额要大于 0(收到 '-5')
标题(直接回车结束): 退款
金额: 50
标签(可空,逗号隔开): 
结果: [open] T-1006 退款 ¥50.0
--- 第 2 张 ---
标题(直接回车结束): x
金额: -1
标签(可空,逗号隔开): 
  第 1 次没通过: 金额要大于 0(收到 '-1')
标题(直接回车结束): x
金额: -2
标签(可空,逗号隔开): 
  第 2 次没通过: 金额要大于 0(收到 '-2')
标题(直接回车结束): x
金额: -3
标签(可空,逗号隔开): 
  第 3 次没通过: 金额要大于 0(收到 '-3')
  连错 3 次,这张不录了
结果: None
```

第一张:第一次金额写了「五十」被拦,第二次 -5 被拦,第三次 50 通过,拿到 T-1006。第二张:`-1`、`-2`、`-3` 连错三次,放弃,结果是 None。

留一个思考:重问整张对用户很烦,只重问出错的那一项更好。要做到这点,需要知道**哪个字段错了**,答案在 `e.errors()` 每条的 `loc[0]` 里。你可以试着改一版,只对出错的字段重新 `ask`。

</details>

### 练习 4:被拦记录里哪类错最多

被拦的工单日志是 JSON Lines。写一个脚本 `part01/ex54_stats.py`,读一份日志文件(路径从命令行参数拿),统计每一类问题被拦了几次,按次数从多到少打印。「类」就用提示的前两个字区分(`金额`、`标题`)。先建一份样本 `part01/data/sample_rejected.jsonl`,内容如下(6 行,其中一行有两条原因):

```text
{"time": "2026-10-20T09:01:12", "form": {"title": "退款", "amount": "五十", "tags": []}, "reasons": ["金额要填数字(收到 '五十')"]}
{"time": "2026-10-20T09:03:40", "form": {"title": "   ", "amount": "20", "tags": []}, "reasons": ["标题不能全是空格"]}
{"time": "2026-10-20T09:05:02", "form": {"title": "多扣", "amount": "-5", "tags": []}, "reasons": ["金额要大于 0(收到 '-5')"]}
{"time": "2026-10-21T14:10:33", "form": {"title": "退订", "amount": "0", "tags": []}, "reasons": ["金额要大于 0(收到 '0')"]}
{"time": "2026-10-21T14:12:07", "form": {"title": "", "amount": "", "tags": []}, "reasons": ["标题至少要 1 个字(收到 '')", "金额要填数字(收到 '')"]}
{"time": "2026-10-22T16:40:51", "form": {"title": "扣费", "amount": "1.234", "tags": []}, "reasons": ["金额最多两位小数,收到 1.234"]}
```

<details>
<summary>参考答案</summary>

`ex54_stats.py`:

```python
# agent-zero-lab/part01/ex54_stats.py
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
counts: dict[str, int] = {}
for line in path.read_text(encoding="utf-8").splitlines():
    record = json.loads(line)
    for reason in record["reasons"]:
        field = reason[:2]
        counts[field] = counts.get(field, 0) + 1

for field, n in sorted(counts.items(), key=lambda item: item[1], reverse=True):
    print(field, n)
```

<div class="line-notes">

- `import json` / `import sys` 解析每行 JSON,读命令行参数。
- `path = Path(sys.argv[1])` 第一个参数是日志文件路径。不给参数会 `IndexError`,练习里先不处理。
- `counts: dict[str, int] = {}` 计数字典,键是「金额」「标题」,值是次数。空字典要标类型(Day 46)。
- `for line in path.read_text(encoding="utf-8").splitlines():` 读整个文件按行切开,每行是一条记录(Day 39)。
- `record = json.loads(line)` 一行一个 JSON 对象。
- `for reason in record["reasons"]:` 一条记录可能有好几条原因,每一条都要计数。第 5 行就有两条。
- `field = reason[:2]` 取提示的前两个字,切片(Day 15)。
- `counts[field] = counts.get(field, 0) + 1` Day 24 的计数套路:没有就当 0,加一。
- `sorted(counts.items(), key=lambda item: item[1], reverse=True)` 按次数排:`items()` 给出(键, 值)对,`key` 指定拿第二个元素比较,`reverse=True` 从大到小。
- `print(field, n)` 打印类别和次数。

</div>

```bash
uv run python part01/ex54_stats.py part01/data/sample_rejected.jsonl
```

```text
金额 5
标题 2
```

6 条记录一共 7 条原因:金额 5 条(五十、-5、0、空、三位小数),标题 2 条(全空格、空标题)。结论很直接:金额栏最容易填错,表单上应该给金额一个更明显的格式提示。这就是把被拦的记录留下来的用处。

</details>

验收标准:`intake.py` 的演示输入录入后,`intake.json` 里有 8 张工单(原来 4 张加 4 张),`intake_rejected.jsonl` 里有 1 行;再运行一次编号接着往下;坏文件的三种报错和文中一致,而且文件内容不变;四个练习的输出和参考答案一致;`uv run basedpyright part01/` 对今天写的文件 0 errors。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| EOF(End Of File) | 输入已经没有了。键盘上按 `Ctrl + D`、管道里的内容读完,都会让 `input()` 抛 `EOFError` |
| tty / `isatty()` | tty 是终端设备。`sys.stdin.isatty()` 问「标准输入是不是接在真终端上」,键盘输入是 True,管道和 `<` 重定向是 False |
| `<`(输入重定向) | `程序 < 文件` 把文件内容接到程序的标准输入,和 `>` 方向相反 |
| 落盘 | 把内存里的数据写到磁盘文件里,程序退出后还在 |
| 日志(这里指被拦记录) | 程序运行时留下的一行行记录,供以后查问题。今天是 JSON Lines 格式 |
| `{**a, **b}` | 字典展开:把 a 和 b 的键值对合并进一个新字典,相同的键后面的覆盖前面的。≈ JS 的 `{...a, ...b}` |
| `str.format(**ctx)` | 用字典里的值填字符串里的 `{名字}` 占位符;`{gt:g}` 里冒号后面是格式说明 |
| `ErrorDetails` | pydantic 里 `e.errors()` 每一条的类型,带 `type`、`loc`、`msg`、`input`,有的带 `ctx` |
| `ctx` | 错误的上下文,装着触发这个错误的具体限制,比如 `{'max_length': 30}` |
| 生成器表达式 | 写法像列表推导式但用圆括号,逐个产出元素而不先造出整个列表,常用来喂给 `max`、`sum` |
| `datetime.now().isoformat()` | 取现在的时间并写成 `2026-10-23T11:20:23` 这种标准格式,`timespec="seconds"` 精确到秒 |
| `enumerate(data, start=1)` | 遍历时同时拿到序号和元素,`start` 指定序号从几开始 |
| `Path.with_name(...)` | 保持目录不变,把路径最后一段换成别的名字 |

## 常见误区

**把校验写两遍。** 工具里自己 `if amount <= 0` 一遍,模型里又 `gt=0` 一遍,两处迟早不一致。今天的做法是工具里一条规则都不写,出了错只负责翻译。

**读不出来就当空的。** `try: load() except: tickets = []` 看上去很稳,实际上下一次存盘会把坏文件覆盖成只有一张新工单。数据读不出来,最安全的反应是停下来告诉人。

**输入提前结束没处理。** 管道里的内容不够、用户按了 Ctrl + D,`input()` 都会抛 `EOFError`。裸用 `input()` 的脚本在这里会甩出一屏 Traceback。

**编号用「个数加一」。** 删过一张,或者有人手改过文件,个数和最大号就对不上。从数据里取最大号再加一,要注意空列表要给 `default`。

**路径相对于脚本,以为相对于项目。** `INTAKE_FILE=part01/data/x.json` 是相对于**运行命令时所在的目录**。在 `part01` 里运行就会存到 `part01/part01/data/` 里,而且 `mkdir(parents=True)` 会让这个错误悄无声息。命令从项目根目录运行,或者写绝对路径。

**把被拦的工单也算进编号。** 编号在校验时才临时算出来,没通过就没占用。如果在校验前就把「下一个编号」加一存起来,每被拦一张就会跳一号。

## 学习资料

### 文档与文章

- [pydantic 文档 · Validators](https://docs.pydantic.dev/latest/concepts/validators/):今天 `value_error` 那一路用到的自定义校验器,官方写法和注意事项在这里。
- [pydantic 文档 · Validation Errors](https://docs.pydantic.dev/latest/errors/validation_errors/):所有错误类型代号的清单,每个都带一个会触发它的例子。翻译表漏了哪种,就来这里查它的 `type` 和 `ctx`。
- [Python 官方文档 · 内置函数 input](https://docs.python.org/zh-cn/3.12/library/functions.html):页内搜 `input`,看它什么时候抛 `EOFError`。
- [Python 官方教程 · 输入与输出(中文)](https://docs.python.org/zh-cn/3.12/tutorial/inputoutput.html):格式化输出和读写文件,Day 38 的加深。
- [JSON Lines 规范](https://jsonlines.org/):三条规则的小站点,今天被拦记录用的就是它。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV124m8YXEbt&autoplay=0&high_quality=1" title="10.Pydantic" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>霍格沃兹软件测试测吧 · 10.Pydantic · 约 17 分钟,2024 年。讲 BaseModel、校验和报错,把 Day 51–52 的内容再过一遍,看今天 `Ticket` 模型的写法能不能一一对上。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Cty7BAEwH&autoplay=0&high_quality=1" title="Python的.env文件用法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>Yoyo本慢 · Python的.env文件用法 · 约 2 分钟,2025 年。对着 Day 53 和今天的 `INTAKE_FILE` 再看一遍 `load_dotenv` 的用法。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Vj-iU-8_xLs" title="Do We Still Need Dataclasses? // PYDANTIC Tutorial" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>ArjanCodes · Do We Still Need Dataclasses? // PYDANTIC Tutorial · 英文。把 dataclass 和 pydantic 放在一起比较,正好对应 Day 50 到 Day 52 三天,有英文字幕可以开。</figcaption>
</figure>

### 书籍

- 《Python 编程:从入门到实践(第 3 版)》,Eric Matthes 著,袁国忠译,人民邮电出版社。第 10 章「文件和异常」讲读写文件、`json` 保存数据和异常处理,正好是今天 `intake_store.py` 的背景,可以当成补习。

### 开源项目与代码

- [pydantic](https://github.com/pydantic/pydantic):今天用到的校验库本体。想知道 `ErrorDetails` 长什么样,去源码里搜 `ErrorDetails`。
- [pydantic-core](https://github.com/pydantic/pydantic-core):pydantic 的底层(用 Rust 写的),`pydantic_core` 这个导入名就来自它。读不懂 Rust 没关系,看 README 里「这个包是干什么的」那一段就够。

## 自测

1. 为什么 `intake.py` 不自己判断金额是否大于 0?这条规则改了,要改几个地方?

<details><summary>答案</summary>

规则全在 `Ticket` 的 `Field(gt=0)` 里,工具只负责交给模型、翻译拒绝。改规则只改模型一处,翻译表里的数字来自 `ctx`,也会自动跟着变。

</details>

2. `printf '半张\n45\n' | uv run python part01/intake.py` 为什么不会出现 Traceback?

<details><summary>答案</summary>

第三个 `input()` 读不到内容,抛 `EOFError`,被 `main` 里 `except EOFError:` 接住,当成「输入结束」处理,打印一个空行后 `break`。没有填完的那张工单被丢掉。

</details>

3. `load_book` 在文件内容不是合法 JSON 时为什么抛 `BookError` 而不是返回空列表?

<details><summary>答案</summary>

返回空列表的话,工具会当成一本空记事本继续运行,下一张工单存盘时会把原来的坏文件整个覆盖,用户的旧数据全没了而且没有提示。抛异常让 `main` 打印原因并退出,文件原封不动。

</details>

4. 新工单的编号为什么用「最大号加一」,不用「个数加一」?被拦的工单会占编号吗?

<details><summary>答案</summary>

个数加一在有删除、有空洞时会撞号或格式不对(演示里 4 张得到 `T-5`)。最大号加一不受空洞影响。被拦的工单不占编号,因为编号是在校验那一刻临时算出来的,没通过就没存,下次算出来的还是同一个号。

</details>

5. (面试题)一个命令行录入工具,你怎么保证「数据文件被人手改坏之后,不会被工具悄悄覆盖」?

<details><summary>答案</summary>

读文件时区分三种情况:文件不存在(当空本子,正常)、文件存在但解析失败或内容不合规矩(报错退出,不写回)、文件正常。只有第一种和第三种会走到写文件的代码。报错信息说清是哪个文件、哪一行或哪一张工单有问题,并明说「没有动它」。如果要更保险,每次写之前先把旧文件复制成备份,或者先写到临时文件再改名替换。

</details>

6. `INTAKE_FILE=data/x.json` 在项目根目录运行和在 `part01` 目录运行,各存到哪里?

<details><summary>答案</summary>

相对路径总是相对于运行命令时所在的目录。在根目录运行,存到 `agent-zero-lab/data/x.json`;在 `part01` 里运行,存到 `agent-zero-lab/part01/data/x.json`。两个位置都可能不是你想要的,所以要么总是从项目根目录运行,要么写绝对路径。

</details>

## 明天预告

明天是 [Day 55 · 第 8 周复习:编程地基(Day 49–54)](/blog/agent-zero/day-055-week08-review/)。这一周学了 Protocol 和 TypeVar、dataclass、pydantic 两天、环境变量和今天的小项目。明天停一天,先画知识地图,再默写三段核心代码,然后只用这一周的知识拼一个「批量导入客户」的小工具,最后把这周实测过的报错整理成一张错题表。
