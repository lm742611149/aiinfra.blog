---
title: 'Day 147 · 结构化输出(一):为什么 Agent 离不开它,三个层次'
description: 'Agent 的输出是给程序用的,不是给人看的。今天让模型从客户随手写的退款工单里抽出套餐、金额、两个日期,交给 Day 145 的 refund() 去算。同一道题用三种做法:随口要 JSON 18 次全部解析失败;把格式写清楚(求它)18 次全对;加上 JSON mode(约束它)保证是合法 JSON,却管不了字段名。最后用一个不调 API 的小模拟看第三层「逼它」的约束解码是怎么回事。'
pubDate: 2026-10-22
regime: none
tags: ['structured-output', 'json', 'agent-zero']
series: 'agent-zero'
day: 147
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 146](/blog/agent-zero/day-146-week21-review/) 复习了这一周的提示词:给定义、few-shot、先想再答、标签分隔、文件化加版本号、对比实验。那一周所有的「解析」都很简单:要么抠一个词(`billing`),要么用 `between()` 抠一个标签里的数字(`1871`)。

[Day 145](/blog/agent-zero/day-145-prompt-lab/) 最后留了一个分工:**模型负责从工单里把字段抽出来,代码负责按规则算钱**。`refund_calc.py` 里的 `parse_ticket()` 只认 `年付,实付 2388 元,2026-09-01 购买,…` 这种固定格式,客户真正写的工单是「我九月一号买的年费会员,花了两千多」。今天就补上中间这一步:让模型把一段随手写的话,变成程序能直接用的数据。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清楚为什么 Agent 的输出要「结构化」:和聊天机器人比,它的读者是谁。
2. 说出让模型输出 JSON 的三个层次(求它、约束它、逼它),每一层保证了什么、不保证什么。
3. 在 DeepSeek 上用前两层跑同一道抽取题,用一个检查函数数出「不是 JSON」「字段不合格」「值抽错」各有几次。
4. 用一个不调 API 的小模拟讲清楚第三层「约束解码」在每一步做了什么。

预计用时:2.5 小时。前置:[Day 39](/blog/agent-zero/day-039-json/)(Python 和 JSON 互转)、[Day 142](/blog/agent-zero/day-142-prompt-4/)(`max_tokens` 截断)、[Day 145](/blog/agent-zero/day-145-prompt-lab/)(`refund_calc.py` 里的 `refund()`)、[Day 106](/blog/agent-zero/day-106-next-token/)(模型一个 token 一个 token 往外猜)。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `json_check.py` 的 `check()` 和 `toy_constrained.py` 的 `decode()`;再做动手练习,做不出再展开参考答案,看完关掉自己重写一遍。

## 输出是给谁看的

聊天机器人的输出是给人看的。模型回一句「好的,根据您的描述,您购买的是年付套餐……」,人读得懂,多一句客气话、换个说法、加点 markdown 加粗都无所谓。

Agent 不一样。它的输出往往是给**下一段程序**用的:抽出来的金额要传给 `refund()`,判断出的类别要用来路由工单,决定调用哪个工具、传什么参数,也要交给代码去执行(第三部分的工具调用,本质上就是让模型输出一段结构化的「调用请求」)。程序不会「大概看懂」,`json.loads` 遇到多一个反引号就直接报错。

前端每天都在过这道坎,只是方向反过来:你 `fetch` 一个接口,后端返回 `{"amount": 2388}` 你才能 `res.json()`;如果后端哪天返回「金额是 2388 元哦」,你的页面就白屏了。你会去找后端吵架,让他们按约定的格式返回。今天要做的,就是让模型像一个守规矩的后端接口:每次都按约定的格式返回。

这件事有个名字,叫**结构化输出**(structured output):让模型的输出符合一个事先约定好的数据结构(通常是 JSON),程序可以直接解析和使用。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="结构化输出在 Agent 里的位置">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="20" y="40" width="150" height="80" rx="4" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="32" y="62" fill="var(--ink)">客户的工单</text>
<text x="32" y="84" fill="var(--ink-soft)">「九月一号买的</text>
<text x="32" y="102" fill="var(--ink-soft)">年费,花了 2388」</text>
<line x1="170" y1="80" x2="200" y2="80" stroke="var(--ink-faint)"/>
<rect x="200" y="40" width="120" height="80" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="212" y="62" fill="var(--ink)">模型</text>
<text x="212" y="84" fill="var(--mem)">抽字段</text>
<line x1="320" y1="80" x2="350" y2="80" stroke="var(--ink-faint)"/>
<rect x="350" y="30" width="150" height="100" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="362" y="52" fill="var(--ink)">{"plan": "年付",</text>
<text x="362" y="72" fill="var(--ink)"> "paid": 2388,</text>
<text x="362" y="92" fill="var(--ink)"> "bought": "…",</text>
<text x="362" y="112" fill="var(--ink)"> "asked": "…"}</text>
<line x1="500" y1="80" x2="530" y2="80" stroke="var(--ink-faint)"/>
<rect x="530" y="40" width="90" height="80" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="542" y="62" fill="var(--ink)">refund()</text>
<text x="542" y="84" fill="var(--compute)">代码算钱</text>
<text x="542" y="106" fill="var(--ink-soft)">→ 1871</text>
<text x="350" y="160" fill="var(--ink-soft)">这里格式错一点,</text>
<text x="350" y="178" fill="var(--ink-soft)">右边的代码就跑不了</text>
<text x="20" y="214" fill="var(--ink-faint)">今天的重点在中间那个 JSON:它是模型和代码之间的接口。</text>
</g>
</svg>
<figcaption>模型和代码之间隔着一个 JSON。模型这一侧要保证每次都按约定的格式写,代码这一侧要检查它真的照做了。</figcaption>
</figure>

## 先准备 6 张随手写的工单

把 Day 142 那 8 道退款题里的 6 道,改写成客户可能真的会这么写的样子:日期格式五花八门,金额有阿拉伯数字也有中文大写,还有「去年」这种要推算的。新建 `part02/messy_tickets.py`:

```python
# agent-zero-lab/part02/messy_tickets.py
# 客户随手写的退款工单,和正确的四个字段(人工整理)
MESSY: list[tuple[str, dict[str, str | int]]] = [
    (
        "我 2026 年 9 月 1 号买的年费会员,花了 2388,今天 10 月 20 号,想退掉",
        {"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2026-10-20"},
    ),
    (
        "月付 199 那个,2026 年 10 月 1 日开的,3 号就不想用了,能退吗",
        {"plan": "月付", "paid": 199, "bought": "2026-10-01", "asked": "2026-10-03"},
    ),
    (
        "2026.03.10 订的年付(1188 元),2026 年 4 月 5 日申请退款",
        {"plan": "年付", "paid": 1188, "bought": "2026-03-10", "asked": "2026-04-05"},
    ),
    (
        "一千七百八十八块钱买的一年的,四月十二号买的,七月十一号来退,都是 2026 年",
        {"plan": "年付", "paid": 1788, "bought": "2026-04-12", "asked": "2026-07-11"},
    ),
    (
        "年付 ¥3,588,购买日期 2026-02-20。我想在 2026-03-25 退款,谢谢",
        {"plan": "年付", "paid": 3588, "bought": "2026-02-20", "asked": "2026-03-25"},
    ),
    (
        "去年 12 月 5 号买的年付 960 元,今年 8 月 28 号要退。(今年是 2026 年)",
        {"plan": "年付", "paid": 960, "bought": "2025-12-05", "asked": "2026-08-28"},
    ),
]
```

<div class="line-notes">

- `MESSY: list[tuple[str, dict[str, str | int]]] = [` 类型从外往里读:一个列表,每个元素是 (工单原文, 字典) 二元组,字典的键是字符串,值是字符串或整数。相当于 TS 的 `Array<[string, Record<string, string | number>]>`。
- `"我 2026 年 9 月 1 号买的年费会员` 就是 Day 142 第 1 题,只是换了说法。正确退款还是 1871。
- `{"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2026-10-20"},` 这就是今天要模型吐出来的样子:四个固定的英文键,`paid` 是整数,日期是 `YYYY-MM-DD`。键用英文是因为下游的代码要用 `data["paid"]` 去取,中文键也能用,但团队里约定一种就要一直用这一种。
- `"一千七百八十八块钱买的一年的` 中文数字、「一年的」而不是「年付」,看模型能不能对上。
- `"年付 ¥3,588,` 千分位逗号,`int("3,588")` 会报错,模型得自己把它变成 3588。
- `"去年 12 月 5 号买的年付 960 元` 「去年」要结合括号里的「今年是 2026 年」推算成 2025。

</div>

## 第一步:随口要一个 JSON

最省事的写法:system 里说一句「整理成 JSON」。新建 `part02/ask_json.py`:

```python
# agent-zero-lab/part02/ask_json.py
import json

from common.llm import LLMClient
from part02.messy_tickets import MESSY

SYSTEM = "把客户工单里的套餐类型、实付金额、购买日期、申请日期整理成 JSON。"

client = LLMClient()
ticket, gold = MESSY[0]
r = client.chat(
    [{"role": "system", "content": SYSTEM}, {"role": "user", "content": ticket}],
    temperature=0,
    max_tokens=300,
)
print(r.content)
print("-----")
data = json.loads(r.content)
print(data)
```

<div class="line-notes">

- `import json` 标准库,[Day 39](/blog/agent-zero/day-039-json/) 学过。`json.loads` 相当于 `JSON.parse`。
- `SYSTEM = "把客户工单里的套餐类型、实付金额、购买日期、申请日期整理成 JSON。"` 这是很多人第一次写的样子:说了要什么,没说长什么样。
- `ticket, gold = MESSY[0]` 只跑第一张。`gold` 这里先不用。
- `print(r.content)` 先把模型原样的输出打出来,看看它写了什么。
- `data = json.loads(r.content)` 把字符串解析成 Python 字典。实测这一行报错。

</div>

```bash
cd agent-zero-lab
uv run python -m part02.ask_json
```

````text
```json
{
  "套餐类型": "年费会员",
  "实付金额": 2388,
  "购买日期": "2026-09-01",
  "申请日期": "2026-10-20"
}
```
-----
Traceback (most recent call last):
  ...
  File ".../lib/python3.12/json/decoder.py", line 356, in raw_decode
    raise JSONDecodeError("Expecting value", s, err.value) from None
json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
````

`Expecting value: line 1 column 1 (char 0)` 的意思是「第 1 行第 1 个字符就不是 JSON 该有的东西」。第一个字符是反引号:模型把 JSON 包进了 markdown 的代码块里(三个反引号加 `json`)。给人看,这样很贴心,编辑器还会高亮;给程序用,第一个字符就挂了。

就算把反引号去掉,这个结果也用不了:键是中文的「套餐类型」,不是你想要的 `plan`;值是「年费会员」,不是「年付」或「月付」。你没说要什么键、什么值,模型只能自己定。

我又顺手跑了第二张(月付 199 那张),它的输出是这样的(原样,中间省略了一段):

````text
以下是整理后的 JSON：

```json
{
  "套餐类型": "月付 199",
  "实付金额": null,
  ...
}
```

说明：工单中未提及实付金额，因此该项为 `null`。另外，关于能否退款，需要根据具体服务条款判断——……
````

前面一句开场白,后面一段说明,中间的 JSON 里把「199」塞进了套餐类型,金额反而成了 `null`。三个毛病一次全占:**外面多了东西、字段名自己起、值放错了地方**。

## 三个层次

让模型输出 JSON,从靠不住到靠得住,有三个层次。我习惯叫它们「求它」「约束它」「逼它」:

**第一层,求它:在提示词里把格式写清楚。** 告诉模型只输出一个 JSON 对象、不要代码块、不要解释,并且给出每个键的名字和值的格式。这是用这几周学的提示词手段去解决问题,模型大多数时候会照做,但没有任何东西保证它一定照做。

**第二层,约束它:打开 JSON mode。** 请求里加 `response_format={"type": "json_object"}`,厂商的服务端保证返回的是一个**合法的 JSON 对象**,`json.loads` 不会失败。但它只管「是不是 JSON」,不管「是不是你要的 JSON」:键叫什么、值是什么类型,它不拦。

**第三层,逼它:按 JSON Schema 约束解码。** 你把一份结构说明(JSON Schema,Day 148 细讲,先理解成「用 JSON 写的 TS 类型定义」)交给服务端,服务端在模型每生成一个 token 时,都把不符合这份说明的候选直接排除掉。这样出来的结果,键一定是那几个、类型一定对、枚举值一定在范围里。这一步叫**约束解码**(constrained decoding)。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="结构化输出的三个层次">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink-faint)">越往右,服务端保证得越多</text>
<rect x="20" y="150" width="190" height="80" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="32" y="172" fill="var(--ink)">① 求它</text>
<text x="32" y="192" fill="var(--ink-soft)">提示词写清格式</text>
<text x="32" y="212" fill="var(--ink-soft)">保证:没有</text>
<rect x="225" y="100" width="190" height="130" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="237" y="122" fill="var(--ink)">② 约束它</text>
<text x="237" y="142" fill="var(--ink-soft)">JSON mode</text>
<text x="237" y="162" fill="var(--ink-soft)">保证:合法 JSON</text>
<text x="237" y="182" fill="var(--ink-soft)">不管:键名、类型</text>
<rect x="430" y="45" width="190" height="185" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="442" y="67" fill="var(--ink)">③ 逼它</text>
<text x="442" y="87" fill="var(--ink-soft)">JSON Schema</text>
<text x="442" y="107" fill="var(--ink-soft)">+ 约束解码</text>
<text x="442" y="127" fill="var(--ink-soft)">保证:键、类型、枚举</text>
<text x="442" y="147" fill="var(--ink-soft)">不管:值对不对</text>
<text x="442" y="167" fill="var(--ink-soft)">         被截断时</text>
<text x="20" y="56" fill="var(--ink-soft)">三层都要:</text>
<text x="20" y="76" fill="var(--ink-soft)">程序这边再检查一遍</text>
</g>
</svg>
<figcaption>三个层次。每往右一层,服务端多保证一样东西;但没有哪一层保证「值是对的」,所以程序这一侧的检查永远要有。</figcaption>
</figure>

下面在 DeepSeek 上把前两层实际跑一遍,第三层用一个小模拟来看。

## 第二步:先写检查函数

要数清楚每种做法错了几次、错在哪,得先有一把尺子。新建 `part02/json_check.py`,它检查三件事:是不是合法 JSON、是不是一个对象、四个字段在不在、类型和格式对不对。

```python
# agent-zero-lab/part02/json_check.py
import json
from datetime import date
from typing import Any

KEYS = ["plan", "paid", "bought", "asked"]
FENCE = "`" * 3  # 三个反引号,写成这样是为了让文章里的代码块不被它截断


def check(text: str) -> tuple[dict[str, Any] | None, list[str]]:
    """把模型输出解析成字典,并检查四个字段;返回 (字典或 None, 问题列表)。"""
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        return None, [f"不是合法 JSON: {e}"]
    if not isinstance(data, dict):
        return None, [f"不是 JSON 对象,而是 {type(data).__name__}"]
    problems = [f"缺字段 {k}" for k in KEYS if k not in data]
    if "plan" in data and data["plan"] not in ("年付", "月付"):
        problems.append(f"plan 不对: {data['plan']!r}")
    if "paid" in data and type(data["paid"]) is not int:
        problems.append(f"paid 不是整数: {data['paid']!r}")
    for k in ("bought", "asked"):
        try:
            date.fromisoformat(str(data.get(k)))
        except ValueError:
            problems.append(f"{k} 不是 YYYY-MM-DD: {data.get(k)!r}")
    return data, problems


if __name__ == "__main__":
    print(check(FENCE + 'json\n{"plan": "年付"}\n' + FENCE))
    print(check('[1, 2]'))
    print(check('{"plan": "年费会员", "paid": "2388元", "bought": "2026-09-01", "asked": "10月20日"}'))
    print(check('{"plan": "年付", "paid": 2388, "bought": "2026-09-01", "asked": "2026-10-20"}'))
```

<div class="line-notes">

- `from typing import Any` 解析出来的 JSON 里什么类型都可能有,用 `Any` 标注,相当于 TS 的 `any`。
- `KEYS = ["plan", "paid", "bought", "asked"]` 约定好的四个键,只写在这一处。
- `* 3  # 三个反引号,写成这样` 这一行定义 `FENCE`:一个反引号字符串乘以 3,字符串乘整数就是重复几次,得到三个反引号,相当于 JS 里对一个反引号字符串调用 `.repeat(3)`。直接写三个反引号也完全可以,我这么写只是因为文章本身是 markdown,代码里出现三个反引号会和文章的代码块打架。练习 1 会用到它。
- `def check(text: str) -> tuple[dict[str, Any] | None, list[str]]:` 返回一个二元组:第一个是解析出的字典(解析不了就是 `None`),第二个是问题列表(空列表表示全部通过)。不直接抛异常,是因为下面要统计各种问题出现几次。
- `data = json.loads(text)` 实测第一个自测用例在这里失败,因为开头是反引号。
- `except json.JSONDecodeError as e:` 只接住「不是合法 JSON」这一种异常。`e` 打印出来就是上面那句 `Expecting value: line 1 column 1 (char 0)`。
- `if not isinstance(data, dict):` `isinstance(x, 类型)` 判断 x 是不是某种类型,相当于 JS 的 `typeof x === "object" && !Array.isArray(x)` 这类判断。`'[1, 2]'` 是合法 JSON,但它是数组,不是对象,下游用 `data["plan"]` 会报错,所以也算失败。
- `return None, [f"不是 JSON 对象,而是 {type(data).__name__}"]` `type(data).__name__` 取类型的名字,实测是 `list`。
- `problems = [f"缺字段 {k}" for k in KEYS if k not in data]` 列表推导式,把缺的键都列出来。`k not in data` 判断字典里没有这个键,相当于 JS 的 `!(k in data)`。
- `if "plan" in data and data["plan"] not in ("年付", "月付"):` 套餐只能是这两个值之一。实测「年费会员」在这里被拦下。
- `if "paid" in data and type(data["paid"]) is not int:` 为什么不用 `isinstance(data["paid"], int)`?因为 Python 里 `True` 也算 `int` 的一种(`isinstance(True, int)` 是 `True`),模型要是给了 `"paid": true`,`isinstance` 会放过它。`type(x) is int` 只认真正的整数。实测 `"2388元"` 在这里被拦下。
- `date.fromisoformat(str(data.get(k)))` `data.get(k)` 键不存在时返回 `None` 而不是报错,相当于 JS 的 `data[k]`(拿到 `undefined`)。`str(None)` 是 `"None"`,`fromisoformat("None")` 会抛 `ValueError`,这样缺字段和格式错都会被记下。
- `except ValueError:` 实测 `"10月20日"` 在这里被拦下。
- `print(check('{"plan": "年付", "paid": 2388, "bought"` 全部正确的样子,实测问题列表是 `[]`。

</div>

```bash
uv run python -m part02.json_check
```

```text
(None, ['不是合法 JSON: Expecting value: line 1 column 1 (char 0)'])
(None, ['不是 JSON 对象,而是 list'])
({'plan': '年费会员', 'paid': '2388元', 'bought': '2026-09-01', 'asked': '10月20日'}, ["plan 不对: '年费会员'", "paid 不是整数: '2388元'", "asked 不是 YYYY-MM-DD: '10月20日'"])
({'plan': '年付', 'paid': 2388, 'bought': '2026-09-01', 'asked': '2026-10-20'}, [])
```

这个函数是手写的「校验」。Day 149 会用 pydantic 把这些检查写成一个类,一行搞定,今天先手写,看清楚到底要检查什么。

## 第三步:JSON mode 的门槛

第二层要在请求里加 `response_format`。DeepSeek 的 JSON Output 文档(2026-10-22 查)写了一条要求:system 或 user 消息里**必须出现「json」这个词**,并且最好给出期望的 JSON 样例。不写会怎样?故意试一次。新建 `part02/json_mode_error.py`:

```python
# agent-zero-lab/part02/json_mode_error.py
from common.llm import LLMClient

client = LLMClient()
r = client.chat(
    [{"role": "user", "content": "把这句话里的金额抽出来:年付花了 2388 元"}],
    response_format={"type": "json_object"},
    max_tokens=100,
)
print(repr(r.content))
```

<div class="line-notes">

- `[{"role": "user", "content": "把这句话里的金额抽出来:年付花了 2388 元"}],` 消息里故意不出现「json」。
- `response_format={"type": "json_object"},` 打开 JSON mode。`LLMClient.chat()` 把它原样透传给 openai SDK,SDK 放进请求体。
- `print(repr(r.content))` 走不到这一行,上一行就报错了。

</div>

```bash
uv run python -m part02.json_mode_error
```

```text
Traceback (most recent call last):
  ...
openai.BadRequestError: Error code: 400 - {'error': {'message': "Prompt must contain the word 'json' in some form to use 'response_format' of type 'json_object'. (request_id: efb39912-…)", 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

400 是「你的请求有问题」([Day 126](/blog/agent-zero/day-126-error-codes/) 讲过),报错原文说得很直白:用 `json_object` 时提示词里必须出现 json 这个词。OpenAI 的 JSON mode 也有同样的规定。加上就好,我们的两版提示词里都有「JSON」。

再看看满足门槛后,JSON mode 到底给了什么。用第一步那句随口的提示词(里面有「JSON」),加上 JSON mode,新建 `part02/json_mode_demo.py`。这个文件 import 了下一步才写的 `extract_compare.py` 里的 `ASK`,所以先把下一步的文件建好再回来跑它:

```python
# agent-zero-lab/part02/json_mode_demo.py
import json

from common.llm import LLMClient
from part02.extract_compare import ASK
from part02.messy_tickets import MESSY

client = LLMClient()
ticket, _ = MESSY[0]
r = client.chat(
    [{"role": "system", "content": ASK}, {"role": "user", "content": ticket}],
    temperature=0,
    max_tokens=300,
    response_format={"type": "json_object"},
)
print(repr(r.content))
print(json.loads(r.content))
```

<div class="line-notes">

- `from part02.extract_compare import ASK` `ASK` 和第一步的 `SYSTEM` 是同一句话,下一步统一放在 `extract_compare.py` 里。
- `response_format={"type": "json_object"},` 和第一步唯一的区别。
- `print(repr(r.content))` 实测开头直接是 `{`,没有反引号了。
- `print(json.loads(r.content))` 这次解析成功。

</div>

```bash
uv run python -m part02.json_mode_demo
```

```text
'{"套餐类型": "年费会员", "实付金额": 2388, "购买日期": "2026-09-01", "申请日期": "2026-10-20"}'
{'套餐类型': '年费会员', '实付金额': 2388, '购买日期': '2026-09-01', '申请日期': '2026-10-20'}
```

代码块和开场白都没了,`json.loads` 成功。但键还是中文的「套餐类型」,值还是「年费会员」。**JSON mode 解决了「是不是 JSON」,没解决「是不是你要的 JSON」。**

## 第四步:同一道题,四种做法一起比

现在把两个提示词和开关 JSON mode 组合起来,一共四种:

| 做法 | 提示词 | JSON mode |
| --- | --- | --- |
| 随口要 | 「整理成 JSON」 | 关 |
| 随口要 + JSON mode | 「整理成 JSON」 | 开 |
| 求它 | 写清键名、类型、格式,不要代码块 | 关 |
| 求它 + JSON mode | 同上 | 开 |

每种在 6 张工单上跑 3 轮,每次的输出过一遍 `check()`;通过了再交给 Day 145 的 `refund()` 算钱,和用正确字段算出来的比,一样才算「能用」。新建 `part02/extract_compare.py`:

```python
# agent-zero-lab/part02/extract_compare.py
from datetime import date
from typing import Any

from common.llm import LLMClient
from part02.json_check import check
from part02.messy_tickets import MESSY
from part02.refund_calc import refund

ASK = "把客户工单里的套餐类型、实付金额、购买日期、申请日期整理成 JSON。"
SPEC = """从客户的退款工单里抽出四个字段,只输出一个 JSON 对象,不要 markdown 代码块,不要任何解释。格式:
{"plan": "年付" 或 "月付", "paid": 实付金额(整数,单位元), "bought": "购买日期 YYYY-MM-DD", "asked": "申请日期 YYYY-MM-DD"}"""

MODES: dict[str, tuple[str, dict[str, Any]]] = {
    "随口要": (ASK, {}),
    "随口要+JSON mode": (ASK, {"response_format": {"type": "json_object"}}),
    "求它": (SPEC, {}),
    "求它+JSON mode": (SPEC, {"response_format": {"type": "json_object"}}),
}
ROUNDS = 3


def to_refund(data: dict[str, Any]) -> int:
    return refund(data["plan"], data["paid"], date.fromisoformat(data["bought"]), date.fromisoformat(data["asked"]))


def main() -> None:
    client = LLMClient()
    for name, (system, extra) in MODES.items():
        before = client.ledger.cost
        bad_json = bad_fields = wrong_value = ok = 0
        seen: dict[str, int] = {}
        for _ in range(ROUNDS):
            for ticket, gold in MESSY:
                r = client.chat(
                    [{"role": "system", "content": system}, {"role": "user", "content": ticket}],
                    temperature=0,
                    max_tokens=300,
                    **extra,
                )
                data, problems = check(r.content)
                if data is None:
                    bad_json += 1
                elif problems:
                    bad_fields += 1
                    seen[problems[0]] = seen.get(problems[0], 0) + 1
                elif to_refund(data) != to_refund(gold):
                    wrong_value += 1
                    seen[f"抽错了: {data}"] = seen.get(f"抽错了: {data}", 0) + 1
                else:
                    ok += 1
        n = ROUNDS * len(MESSY)
        for problem, count in seen.items():
            print(f"  [{name}] {problem} ×{count}")
        print(f"{name}: 能用 {ok}/{n}  不是 JSON {bad_json}  字段不合格 {bad_fields}  值抽错 {wrong_value}  ¥{client.ledger.cost - before:.4f}")
    print("合计:", client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from part02.refund_calc import refund` Day 145 写的退款计算,已经改成用 `Decimal` 四舍五入的那一版。今天模型只管抽字段,钱由它算。
- `SPEC = """从客户的退款工单里抽出四个字段` 「求它」的提示词。和 `ASK` 比多了三样:只要一个 JSON 对象、不要代码块和解释、每个键的名字和值的格式。
- `{"plan": "年付" 或 "月付", "paid": 实付金额(整数,单位元)` 这一行是给模型看的「样子」,它本身不是合法 JSON(`或`、中文说明都不是 JSON 语法)。这么写模型看得懂,而且 DeepSeek 文档也建议给出样例。
- `MODES: dict[str, tuple[str, dict[str, Any]]] = {` 和 Day 142 `cot_compare.py` 里的 `MODES` 一个套路:名字 → (提示词, 额外请求参数)。
- `"随口要+JSON mode": (ASK, {"response_format": {"type": "json_object"}}),` 额外参数是一个字典,下面用 `**extra` 展开成 `response_format=...` 传给 `chat()`。
- `def to_refund(data: dict[str, Any]) -> int:` 把四个字段交给 `refund()`。两个日期是字符串,先用 `date.fromisoformat` 变成 `date`。
- `seen: dict[str, int] = {}` 每种问题出现了几次。同一个问题 18 次都打印出来太占地方,只记次数。
- `**extra,` 空字典展开后什么都没有,所以「随口要」和「求它」不带 `response_format`。
- `data, problems = check(r.content)` 用上一步的尺子量。
- `if data is None:` 连 JSON 都解析不了,算「不是 JSON」。
- `elif problems:` 是 JSON,但字段有问题。
- `seen[problems[0]] = seen.get(problems[0], 0) + 1` 只记第一个问题。`seen.get(键, 0)` 键不存在时返回 0,相当于 JS 的 `(seen[k] ?? 0) + 1`。
- `elif to_refund(data) != to_refund(gold):` 格式全对,再比算出来的钱。为什么比钱而不是直接比字典?比如模型把 `"bought"` 写成 `"2026-9-1"` 会在上面被拦下,而格式对但日期抽错(9 月 1 日抽成 9 月 10 日),算出来的钱多半不同,这才是真正会让客户多退少退的错。
- `print(f"{name}: 能用 {ok}/{n}` 每种做法一行,实测四行见下面。
- `print("合计:", client.ledger)` 实测 `72 次调用 | 输入 7206 / 输出 3085 tokens | 约 ¥0.0391`。

</div>

```bash
uv run python -m part02.extract_compare
```

我的输出(2026-10-22,deepseek-flash,关思考):

```text
随口要: 能用 0/18  不是 JSON 18  字段不合格 0  值抽错 0  ¥0.0107
  [随口要+JSON mode] 缺字段 plan ×18
随口要+JSON mode: 能用 0/18  不是 JSON 0  字段不合格 18  值抽错 0  ¥0.0084
求它: 能用 18/18  不是 JSON 0  字段不合格 0  值抽错 0  ¥0.0096
求它+JSON mode: 能用 18/18  不是 JSON 0  字段不合格 0  值抽错 0  ¥0.0104
合计: 72 次调用 | 输入 7206 / 输出 3085 tokens | 约 ¥0.0391
```

(我在改成「按问题计数」之前也跑过一遍,各项计数完全一样,花费差几厘钱。)

四行读下来很清楚:

- **随口要**:18 次全部「不是 JSON」,每次都包了代码块。
- **随口要 + JSON mode**:「不是 JSON」变成了 0,但 18 次全部「缺字段 plan」,因为键是中文的。这就是第二层的边界:它把问题从「解析失败」挪到了「字段不对」,没有消灭问题。
- **求它**:18 次全对。DeepSeek 这一代模型,只要你把格式说清楚,它在这 6 张工单上就照做了,包括中文大写金额、千分位逗号和「去年」的推算。
- **求它 + JSON mode**:也是 18 次全对,多花了一点点钱(¥0.0104 对 ¥0.0096,在 3 轮的误差范围里)。

那 JSON mode 是不是没用?不是。「求它」这 18 次全对,是在这 6 张工单、这一个模型上量出来的,没有任何机制保证第 19 次不包代码块。JSON mode 把「一定是合法 JSON」从概率变成了保证,而开启它几乎不花钱。我的习惯是:厂商支持就打开,但提示词照样写清楚格式,程序照样检查。

## 第五步:前两层都挡不住的两种错

上面 18 次全对,不等于万事大吉。再造两张更难的工单,新建 `part02/extract_edge.py`:

```python
# agent-zero-lab/part02/extract_edge.py
from common.llm import LLMClient
from part02.extract_compare import MODES
from part02.json_check import check

EDGE = [
    ("忘了金额", "年付的,2026-09-01 买的,2026-10-20 想退,多少钱我忘了", 300),
    ("被截断", "我 2026 年 9 月 1 号买的年费会员,花了 2388,今天 10 月 20 号,想退掉", 12),
]

if __name__ == "__main__":
    client = LLMClient()
    for label, ticket, max_tokens in EDGE:
        for name in ("求它", "求它+JSON mode"):
            system, extra = MODES[name]
            r = client.chat(
                [{"role": "system", "content": system}, {"role": "user", "content": ticket}],
                temperature=0,
                max_tokens=max_tokens,
                **extra,
            )
            data, problems = check(r.content)
            print(f"{label} [{name}] finish={r.finish_reason} 输出={r.content!r}")
            print(f"    → {problems or '通过'}")
    print(client.ledger)
```

<div class="line-notes">

- `("忘了金额", "年付的,2026-09-01 买的,2026-10-20 想退,多少钱我忘了", 300),` 工单里根本没有金额。`SPEC` 要求 `paid` 是整数,模型会怎么办?
- `("被截断",` 第三个元素是 `max_tokens`。故意只给 12 个 token,一个完整的 JSON 至少要三四十个。
- `if __name__ == "__main__":` 把实际调用放进这里,练习 2 要 import 这个文件里的 `EDGE`,import 的时候不能顺带跑一遍 API。
- `print(f"{label} [{name}] finish={r.finish_reason}` `finish_reason`([Day 122](/blog/agent-zero/day-122-api-response/) 讲过)是 `stop` 表示模型自己写完了,`length` 表示被 `max_tokens` 掐断。
- `print(f"    → {problems or '通过'}")` 空列表在 `or` 里算假,所以没问题时打印「通过」。

</div>

```bash
uv run python -m part02.extract_edge
```

```text
忘了金额 [求它] finish=stop 输出='{"plan": "年付", "paid": 0, "bought": "2026-09-01", "asked": "2026-10-20"}'
    → 通过
忘了金额 [求它+JSON mode] finish=stop 输出='{"plan": "年付", "paid": 0, "bought": "2026-09-01", "asked": "2026-10-20"}'
    → 通过
被截断 [求它] finish=length 输出='{"plan": "年付", "paid": 238'
    → ["不是合法 JSON: Expecting ',' delimiter: line 1 column 27 (char 26)"]
被截断 [求它+JSON mode] finish=length 输出='{"plan": "年付", "paid": 238'
    → ["不是合法 JSON: Expecting ',' delimiter: line 1 column 27 (char 26)"]
4 次调用 | 输入 524 / 输出 96 tokens | 约 ¥0.0018
```

**「忘了金额」是今天最危险的一个结果。** 工单里没有金额,我们的格式要求 `paid` 是整数,模型就填了一个 0。格式完全合法,`check()` 判「通过」,交给 `refund()` 算出来退 0 元。没有任何地方报错,客户收到「您的退款金额为 0 元」。这个错和格式无关,第三层的约束解码也拦不住:0 是一个合法的整数。办法是在格式里**允许「不知道」**(比如允许 `null`),并在代码里处理这种情况,练习 2 会做。

**「被截断」两种做法一样坏。** `finish=length`,输出停在 `"paid": 238` 这里,后面的 `8,` 和另外两个字段都没来得及写。JSON mode 保证的是「模型写完时是合法 JSON」,被 `max_tokens` 掐断时它也无能为力,DeepSeek 文档里也专门提醒要合理设置 `max_tokens`。这一点和 Day 142 「答案抠不出来先查是不是截断了」是同一个坑,检查 `finish_reason` 是不是 `length` 应该成为习惯。

## 第三层:约束解码在每一步做了什么

### DeepSeek 的 `response_format` 只到第二层

OpenAI 的 `response_format` 支持第三种类型 `json_schema`,直接把一份 JSON Schema 交给服务端。DeepSeek 用同样的写法会怎样?新建 `part02/json_schema_try.py` 试一下:

```python
# agent-zero-lab/part02/json_schema_try.py
from common.llm import LLMClient

client = LLMClient()
schema = {
    "type": "object",
    "properties": {"paid": {"type": "integer"}},
    "required": ["paid"],
    "additionalProperties": False,
}
r = client.chat(
    [{"role": "user", "content": "把金额抽成 JSON:年付花了 2388 元"}],
    response_format={"type": "json_schema", "json_schema": {"name": "refund", "strict": True, "schema": schema}},
    max_tokens=100,
)
print(repr(r.content))
```

<div class="line-notes">

- `schema = {` 一份最小的 JSON Schema:一个对象,只有一个整数字段 `paid`,必须有,不许有别的字段。每个键的意思 Day 148 逐个讲,今天只看厂商收不收。
- `"additionalProperties": False,` JSON 里是 `false`,Python 里写 `False`,openai SDK 发请求时会转换。
- `response_format={"type": "json_schema", "json_schema": {"name": "refund", "strict": True, "schema": schema}},` 这是 OpenAI 文档里第三层的写法:类型是 `json_schema`,`strict: True` 表示严格按 schema 约束解码。

</div>

```bash
uv run python -m part02.json_schema_try
```

```text
Traceback (most recent call last):
  ...
openai.BadRequestError: Error code: 400 - {'error': {'message': 'This response_format type is unavailable now (request_id: 88e08cca-…)', 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

「这种 response_format 类型现在不可用」。和 DeepSeek 文档一致:它的 JSON Output 只有 `json_object` 一种。我查到的 2026 年 10 月各家情况:

| 厂商 | 第二层 JSON mode | 第三层 schema 约束 | 说明 |
| --- | --- | --- | --- |
| DeepSeek | `response_format={"type": "json_object"}`,提示词里要有 json | `response_format` 不支持;工具调用有 `strict` 模式(Beta,要把 `base_url` 换成 `/beta`) | 文档写了 JSON Output 有概率返回空 content |
| OpenAI | 支持 `json_object` | `response_format` 传 `json_schema` 并设 `strict: true` | |
| Claude | 没有单独的 JSON mode | `output_config.format` 传 JSON Schema;工具也有 strict 模式 | 文档写了 SDK 会把不支持的约束(如 `minimum`)挪进字段说明 |

表里 DeepSeek 那一行来自它的 JSON Output 和 Tool Calls 两页文档,OpenAI 和 Claude 来自各自的结构化输出文档,都是 2026-10-22 查的。DeepSeek 工具调用的 `strict` 模式要等第三部分学了工具调用再用。Day 148 会挑一个支持第三层的方式实际跑一遍。

### 用一个假模型看约束解码

服务端到底怎么「保证」输出符合 schema?回到 [Day 106](/blog/agent-zero/day-106-next-token/):模型每一步给出下一个 token 的概率分布,然后从里面挑一个。约束解码就是在挑之前,**把会导致不合格结果的候选划掉**,剩下的重新算比例,再挑。

真模型的词表有十几万个 token,看不清楚。我写一个假模型,只有几个候选,概率是我编的,只为演示这个过程。规则是:输出只能是 `{"plan": "年付"}` 或 `{"plan": "月付"}` 这两种之一。新建 `part02/toy_constrained.py`(不调 API,不花钱):

```python
# agent-zero-lab/part02/toy_constrained.py
F = "`" * 3  # 三个反引号

# 一个假的「模型」:给定已经写出的文字,返回下一个 token 的概率。数字是我编的,只为演示
FAKE: dict[str, dict[str, float]] = {
    "": {F + "json\n": 0.55, "{": 0.35, "以下是": 0.10},
    F + "json\n": {"{": 1.0},
    F + "json\n{": {'"套餐类型": "': 0.6, '"plan": "': 0.4},
    F + 'json\n{"套餐类型": "': {"年费会员": 0.7, "年付": 0.3},
    F + 'json\n{"套餐类型": "年费会员': {'"}\n' + F: 1.0},
    "{": {'"套餐类型": "': 0.55, '"plan": "': 0.45},
    '{"plan": "': {"年费会员": 0.45, "年付": 0.35, "包年": 0.12, "月付": 0.08},
    '{"plan": "年付': {'"}': 0.8, '会员"}': 0.2},
}

ALLOWED = ['{"plan": "年付"}', '{"plan": "月付"}']


def decode(constrained: bool) -> str:
    text = ""
    while text in FAKE:
        probs = FAKE[text]
        if constrained:
            probs = {t: p for t, p in probs.items() if any(a.startswith(text + t) for a in ALLOWED)}
            total = sum(probs.values())
            probs = {t: p / total for t, p in probs.items()}
        token = max(probs, key=lambda t: probs[t])
        print(f"  已写 {text!r:<26} 候选 {', '.join(f'{t!r}:{p:.2f}' for t, p in probs.items())} → 选 {token!r}")
        text += token
    return text


if __name__ == "__main__":
    print("不约束:")
    print("结果:", repr(decode(constrained=False)))
    print("约束解码:")
    print("结果:", repr(decode(constrained=True)))
```

<div class="line-notes">

- `* 3  # 三个反引号` 这一行定义 `F`,三个反引号,和 `json_check.py` 里的 `FENCE` 一个意思。`F + "json\n"` 就是代码块的开头那一行。
- `FAKE: dict[str, dict[str, float]] = {` 一个字典:键是「已经写出来的文字」,值是「下一个 token 的候选和概率」。真模型是算出来的,这里是查表。
- `"": {F + "json\n": 0.55, "{": 0.35, "以下是": 0.10},` 什么都还没写时,这个假模型最想先写代码块的开头,和第一步真模型的表现一样。
- `'{"plan": "': {"年费会员": 0.45, "年付": 0.35, "包年": 0.12, "月付": 0.08},` 写到值的位置,它最想写「年费会员」,这也是第一步真模型写过的。
- `ALLOWED = ['{"plan": "年付"}', '{"plan": "月付"}']` 合格的完整输出只有这两种。真实的约束解码不会列出所有合格的结果(schema 允许的结果可能有无穷多),而是把 schema 编译成一套「下一步允许哪些字符」的规则,道理一样。
- `while text in FAKE:` 只要表里还有「接下来写什么」,就继续生成。查不到说明写完了,相当于真模型输出了结束符。
- `probs = {t: p for t, p in probs.items() if any(a.startswith(text + t) for a in ALLOWED)}` 今天的核心一行。字典推导式,只留下满足条件的候选:把这个候选接在已写文字后面,还能不能成为某个合格结果的开头?`any(...)` 相当于 JS 的 `ALLOWED.some(a => a.startsWith(text + t))`。第一步时 `"```json\n"` 不是任何合格结果的开头,被划掉;`"{"` 是,留下。
- `total = sum(probs.values())` 剩下的候选概率加起来。第一步只剩 `{`,`total = 0.35`。
- `probs = {t: p / total for t, p in probs.items()}` 重新按比例分配,让它们加起来等于 1。`{` 从 0.35 变成 1.00。到值的位置时,「年付」0.35 和「月付」0.08 留下,分别变成 0.81 和 0.19。
- `token = max(probs, key=lambda t: probs[t])` 挑概率最大的那个(相当于 `temperature=0`)。`lambda t: probs[t]` 是一个没有名字的小函数,相当于 JS 的箭头函数 `t => probs[t]`;`max` 用它的返回值来比大小。
- `print(f"  已写 {text!r:<26} 候选` 每一步打印已写的文字、候选和概率、选了谁。
- `text += token` 选中的 token 接到后面,进入下一步。

</div>

```bash
uv run python -m part02.toy_constrained
```

```text
不约束:
  已写 ''                         候选 '```json\n':0.55, '{':0.35, '以下是':0.10 → 选 '```json\n'
  已写 '```json\n'                候选 '{':1.00 → 选 '{'
  已写 '```json\n{'               候选 '"套餐类型": "':0.60, '"plan": "':0.40 → 选 '"套餐类型": "'
  已写 '```json\n{"套餐类型": "'      候选 '年费会员':0.70, '年付':0.30 → 选 '年费会员'
  已写 '```json\n{"套餐类型": "年费会员'  候选 '"}\n```':1.00 → 选 '"}\n```'
结果: '```json\n{"套餐类型": "年费会员"}\n```'
约束解码:
  已写 ''                         候选 '{':1.00 → 选 '{'
  已写 '{'                        候选 '"plan": "':1.00 → 选 '"plan": "'
  已写 '{"plan": "'               候选 '年付':0.81, '月付':0.19 → 选 '年付'
  已写 '{"plan": "年付'             候选 '"}':1.00 → 选 '"}'
结果: '{"plan": "年付"}'
```

不约束时,每一步都选了最想写的,结果正好重现了第一步真模型的三个毛病:代码块、中文键、「年费会员」。约束解码时,每一步不合格的候选都被划掉,最后的结果一定在 `ALLOWED` 里。

注意第三步:约束解码选了「年付」,不是因为它「判断出」客户买的是年付,而是因为「年费会员」被划掉以后,「年付」在剩下的里面概率最高。如果这张工单其实是月付,而模型因为别的原因更偏向「年付」,约束解码照样会给你一个格式完美的「年付」。**它保证格式,不保证内容。**这和「忘了金额」填 0 是同一个道理。

真实的实现比这个复杂得多(要处理十几万个 token、把 schema 变成状态机、还要算得快),开源的 [outlines](https://github.com/dottxt-ai/outlines)、[llguidance](https://github.com/guidance-ai/llguidance) 就是做这件事的库,自己部署模型时会用到。但核心就是上面那一行:挑之前,先划掉不合格的。

## 三层怎么选

今天跑下来,我的做法是这样:

- **提示词永远写清格式**(第一层)。不管厂商支持到哪一层,模型知道你要什么,结果的内容才会好。今天「求它」一层就做到了 18/18。
- **厂商支持 JSON mode 就打开**(第二层)。成本几乎为零,把「不是 JSON」从偶尔会发生变成不会发生。记得提示词里要有 json 这个词。
- **厂商支持 schema 约束就用**(第三层)。字段名、类型、枚举交给服务端保证,Day 148 细讲。
- **不管用到哪一层,程序这边都要检查**。截断、编造、值抽错,三层都挡不住。检查还要包括 `finish_reason`。Day 149 用 pydantic 把检查写得更省事,Day 150 写「检查失败把错误喂回去重试」。

## 动手练习

练习 1、3 不调 API;练习 2 调 6 次,不到半分钱。

**练习 1:把代码块剥掉能不能救回来?** 写一个 `strip_fence(text)`,去掉开头的 ```` ```json ```` 和结尾的 ```` ``` ````,再交给 `check()`。用第一步真模型的两种输出测一下,并说说为什么我不建议靠它。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex147_fence.py
from part02.json_check import FENCE, check


def strip_fence(text: str) -> str:
    """去掉开头的三个反引号加 json 和结尾的三个反引号;没有就原样返回。"""
    text = text.strip()
    if text.startswith(FENCE):
        text = text.split("\n", 1)[1] if "\n" in text else ""
        text = text.removesuffix(FENCE).strip()
    return text


samples = [
    FENCE + 'json\n{\n  "plan": "年付",\n  "paid": 2388,\n  "bought": "2026-09-01",\n  "asked": "2026-10-20"\n}\n' + FENCE,
    '以下是整理后的 JSON：\n\n' + FENCE + 'json\n{"plan": "月付", "paid": 199, "bought": "2026-10-01", "asked": "2026-10-03"}\n' + FENCE + '\n\n说明：……',
]
for s in samples:
    print(check(strip_fence(s))[1] or "通过")
```

<div class="line-notes">

- `text = text.strip()` 先去掉首尾空白,不然开头有个换行 `startswith` 就判断不出来。
- `if text.startswith(FENCE):` 只有以三个反引号开头才处理。
- `text = text.split("\n", 1)[1] if "\n" in text else ""` `split("\n", 1)` 只在第一个换行处切一刀,`[1]` 取后半段,把 ```` ```json ```` 这一整行去掉。先判断有没有换行,没有的话 `[1]` 会越界(Day 142 踩过的 `IndexError`)。
- `text = text.removesuffix(FENCE).strip()` 去掉结尾的三个反引号。
- `samples = [` 第一个样本是第一步真模型那种格式(我把键换成了英文),第二个样本模仿了「开场白 + 代码块 + 说明」那种输出。
- `print(check(strip_fence(s))[1] or "通过")` `[1]` 取问题列表。实测第一个「通过」,第二个还是「不是合法 JSON」。

</div>

```bash
uv run python -m part02.ex147_fence
```

```text
通过
['不是合法 JSON: Expecting value: line 1 column 1 (char 0)']
```

第一种救回来了,第二种没有:开头是「以下是整理后的 JSON:」,不是反引号。你可以继续加规则(找第一个 `{` 和最后一个 `}`),但模型的花样是无穷的,规则会越写越长,而且越宽松越容易「救」出一个错的东西,和 Day 145 说的「解析写得太宽松」是同一个坑。正确的方向是让模型一开始就不写这些:提示词写清楚(第一层),再加 JSON mode(第二层)。剥代码块可以当最后一道保险,不能当主要手段。

</details>

**练习 2:让「忘了金额」不再编造。** 把 `SPEC` 里 `paid` 的说明改成「工单里没写金额就填 null,不要猜」,对「忘了金额」那张工单,原版和新版各跑 3 次(开 JSON mode),打印 `paid` 的值。再想一想,`check()` 和 `refund()` 要怎么跟着改。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex147_null.py
import json

from common.llm import LLMClient
from part02.extract_compare import SPEC
from part02.extract_edge import EDGE

SPEC_NULL = SPEC.replace("实付金额(整数,单位元)", "实付金额(整数,单位元;工单里没写金额就填 null,不要猜)")
assert SPEC_NULL != SPEC, "replace 没生效,检查原文"
ticket = EDGE[0][1]

client = LLMClient()
for name, system in (("原版", SPEC), ("允许 null", SPEC_NULL)):
    for _ in range(3):
        r = client.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": ticket}],
            temperature=0,
            max_tokens=300,
            response_format={"type": "json_object"},
        )
        print(f"{name}: paid = {json.loads(r.content)['paid']!r}")
print(client.ledger)
```

<div class="line-notes">

- `SPEC_NULL = SPEC.replace(` 在原提示词的基础上只改 `paid` 的说明,其他一字不动。
- `assert SPEC_NULL != SPEC, "replace 没生效,检查原文"` `assert 条件, 消息` 条件为假时直接报错并显示消息,相当于 JS 里 `if (!cond) throw new Error(msg)`。`replace` 找不到旧文字时什么也不做、也不报错(Day 145 提过这种静默失败),加这一行防的就是它。
- `ticket = EDGE[0][1]` 从 `extract_edge.py` 拿「忘了金额」那张工单。因为那个文件的调用放在了 `if __name__` 下面,这里 import 不会跑 API。
- `response_format={"type": "json_object"},` 开着 JSON mode,保证 `json.loads` 不会失败。
- `print(f"{name}: paid = {json.loads(r.content)['paid']!r}")` JSON 里的 `null` 解析成 Python 的 `None`。

</div>

```bash
uv run python -m part02.ex147_null
```

```text
原版: paid = 0
原版: paid = 0
原版: paid = 0
允许 null: paid = None
允许 null: paid = None
允许 null: paid = None
6 次调用 | 输入 861 / 输出 213 tokens | 约 ¥0.0034
```

给了模型一个说「不知道」的位置,它就不再编了。代码要跟着改两处:`check()` 里 `paid` 的检查要允许 `None`(现在的写法会报「paid 不是整数: None」);拿到 `None` 时不能交给 `refund()`,应该转人工或者回复客户问金额。在 TS 里这就是把 `paid: number` 改成 `paid: number | null`,然后编译器逼你处理 `null` 的分支。Day 149 用 pydantic 写 `paid: int | None` 就是这个意思。

**抽取任务最大的风险不是格式错,而是模型编一个看起来合理的值。**格式错会报错,编造不会。

</details>

**练习 3:约束解码遇到「没有合格候选」会怎样?** 在不改 `toy_constrained.py` 的前提下,把假模型在 `'{"plan": "'` 之后的候选改成只有「年费会员」和「包年」两个,再跑约束解码,看会发生什么。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ex147_empty.py
from part02 import toy_constrained as toy

toy.FAKE['{"plan": "'] = {"年费会员": 0.7, "包年": 0.3}
try:
    toy.decode(constrained=True)
except ValueError as e:
    print("ValueError:", e)
```

<div class="line-notes">

- `from part02 import toy_constrained as toy` `as toy` 起个短名字,相当于 JS 的 `import * as toy from ...`。因为 `toy_constrained.py` 的打印在 `if __name__` 下面,import 时不会跑那两段演示。
- `toy.FAKE['{"plan": "'] = {"年费会员": 0.7, "包年": 0.3}` 直接改模块里的字典。字典是可变的,`decode()` 里读的就是改过的这一份。只在练习里这样做,正式代码里别去改别的模块的全局变量。
- `except ValueError as e:` 先猜一下会是什么错,再看下面的输出。

</div>

```bash
uv run python -m part02.ex147_empty
```

```text
  已写 ''                         候选 '{':1.00 → 选 '{'
  已写 '{'                        候选 '"plan": "':1.00 → 选 '"plan": "'
ValueError: max() iterable argument is empty
```

到第三步,两个候选都不是合格结果的开头,全被划掉,`probs` 变成空字典,`sum` 得 0(空字典推导式里的除法一次都没执行,所以没有除以零),`max` 在空字典上报 `ValueError`。

真实的模型不会走到这一步:词表里每个 token 都有一点点概率(哪怕是 0.0001),合格的 token 总是存在的。但这恰好说明了一个真实的风险:如果模型本来很想写的东西全被 schema 禁止了,约束解码会逼它从剩下的、它本来觉得很不可能的 token 里挑一个,结果格式完美,内容可能很离谱。schema 写得太死、和任务不匹配时(比如枚举里漏了一个真实存在的套餐类型),就会这样。

</details>

**验收标准:** `extract_compare.py` 跑出四行结果,能解释每一行为什么是这个数;能说出 JSON mode 保证什么、不保证什么;`extract_edge.py` 里的两个错能说清楚为什么前两层都挡不住;`toy_constrained.py` 能讲清楚约束解码那一行字典推导式在做什么;知道 DeepSeek 的 `response_format` 只支持 `json_object`。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 结构化输出(structured output) | 让模型的输出符合一个约定好的数据结构(通常是 JSON),程序能直接解析使用。例:`{"plan": "年付", "paid": 2388, ...}` |
| JSON mode | 请求里加 `response_format={"type": "json_object"}`,服务端保证返回合法的 JSON 对象,但不管键名和类型 |
| JSON Schema | 用 JSON 写的「数据结构说明」,规定有哪些字段、什么类型、哪些必填,可以理解成用 JSON 写的 TS 类型定义,Day 148 细讲 |
| 约束解码(constrained decoding) | 模型每生成一个 token 前,先把会导致不符合 schema 的候选划掉,只在合格的里面挑 |
| 代码块围栏(fence) | markdown 里包代码用的三个反引号,模型常把 JSON 包在 ```` ```json ```` 和 ```` ``` ```` 之间,`json.loads` 会因此失败 |
| `JSONDecodeError` | `json.loads` 解析失败时抛的异常,例:`Expecting value: line 1 column 1 (char 0)` |
| `isinstance(x, T)` | 判断 x 是不是 T 类型(或它的子类型),注意 `isinstance(True, int)` 是 `True` |
| `lambda` | Python 的匿名小函数,`lambda t: probs[t]` 相当于 JS 的 `t => probs[t]` |
| `assert` | `assert 条件, 消息`,条件为假时直接报错,用来防止「以为成功了其实没成功」 |

## 常见误区

**以为开了 JSON mode 就万事大吉。** 今天「随口要 + JSON mode」18 次全是合法 JSON,也 18 次全部缺字段。JSON mode 只保证是 JSON。

**提示词里没有「json」这个词就开 JSON mode。** DeepSeek 直接返回 400:`Prompt must contain the word 'json' in some form`。

**只给字段名,不给值的格式。** 只说「要 plan 字段」,模型可能填「年费会员」;要写清楚只能是「年付」或「月付」。日期也一样,不写 `YYYY-MM-DD`,你会收到「9月1日」。

**不给模型说「不知道」的位置。** 格式要求金额是整数,工单里没金额,模型就填 0,格式检查全过,客户被退了 0 元。必填但可能缺的信息,要允许 `null`,并在代码里处理。

**忘了看 `finish_reason`。** `max_tokens` 给小了,输出停在 `"paid": 238`,三层都救不了。看到 `length` 先加大 `max_tokens`。

**解析失败就写正则去「抢救」。** 剥代码块、找第一个 `{`,规则越加越多,越宽松越容易救出错的东西。从源头让模型不写多余的东西。

**以为约束解码能保证答案对。** 它只在合格的候选里挑概率最高的。工单其实是月付、模型偏向年付,约束解码照样给你一个格式完美的「年付」。

**拿 OpenAI 的写法直接套 DeepSeek。** `response_format` 的 `json_schema` 类型在 DeepSeek 上返回 `This response_format type is unavailable now`。用一家的高级功能前先看那一家的文档。

## 学习资料

### 文档与文章

- [DeepSeek:JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode):中文,一页纸。重点看三条注意事项:提示词要有 json 字样并给样例、合理设置 `max_tokens`、有概率返回空 content。
- [DeepSeek:Tool Calls](https://api-docs.deepseek.com/zh-cn/guides/tool_calls):中文,往下翻到 strict 模式一节,看它对 schema 的要求(所有属性都要列进 `required`、`additionalProperties` 要是 `false`)。第三部分学工具调用时会用到,今天先知道有这么回事。
- [OpenAI:Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs):英文,讲 `json_schema` + `strict: true` 的用法,以及它和 JSON mode 的区别。
- [Claude:Structured outputs](https://docs.claude.com/en/docs/build-with-claude/structured-outputs):英文,看 `output_config.format` 的例子和「SDK 会把不支持的约束挪进字段说明」那一段。
- [Python 文档:json](https://docs.python.org/zh-cn/3.12/library/json.html):中文,复习 `json.loads` / `json.dumps` 和 `JSONDecodeError`。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1M7Jp6fE3E&autoplay=0&high_quality=1" title="Agent开发中如何让大模型稳定输出结构，15分钟讲清楚！" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大模型元元 · Agent开发中如何让大模型稳定输出结构,15分钟讲清楚! · 16 分钟,2026 年 6 月,从 Agent 开发的角度讲为什么要结构化输出、有哪几种做法,和今天的三个层次对得上。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1JRuA6vEeF&autoplay=0&high_quality=1" title="社区说｜大语言模型的结构化输出与约束解码" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>GDG开发者社区 · 社区说|大语言模型的结构化输出与约束解码 · 34 分钟,2026 年 8 月的技术分享,讲约束解码在模型生成时具体怎么划掉不合格的 token。看完再回头看 toy_constrained.py 那一行,会更清楚真实实现多了哪些东西。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/xpvFinvqRCA" title="Structured Output from LLMs: Grammars, Regex, and State Machines" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Efficient NLP · Structured Output from LLMs: Grammars, Regex, and State Machines · 17 分钟,英文。讲约束解码怎么把格式要求变成状态机,在每一步算出「下一个允许哪些 token」,是今天那个假模型的真实版本。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/vEF-nuf_zRM" title="Working with LLMs: JSON Mode vs Structured Generation" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>dottxt · Working with LLMs: JSON Mode vs Structured Generation · 10 分钟,英文,outlines 背后的团队讲 JSON mode 和按结构生成的区别,正好对应今天的第二层和第三层。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 2 章:在讲采样的部分有一节专门讲结构化输出,从提示词、后处理、约束采样到微调,几种做法的取舍讲得很清楚。没查到简体中文版。

### 开源项目与代码

- [dottxt-ai/outlines](https://github.com/dottxt-ai/outlines):约束解码的开源实现,给自部署的模型用,可以按 JSON Schema、正则、选项列表约束输出。
- [guidance-ai/llguidance](https://github.com/guidance-ai/llguidance):另一个约束解码引擎,强调速度,一些推理框架在用它。
- [567-labs/instructor](https://github.com/567-labs/instructor):在各家 SDK 外面包一层,用 pydantic 定义结构、自动校验和重试。Day 151 会讲,今天先看 README 里的第一个例子。

## 自测

1. 聊天机器人和 Agent 对模型输出的要求有什么不同?为什么 Agent 离不开结构化输出?

<details><summary>答案</summary>

聊天机器人的输出给人看,格式随意一点没关系;Agent 的输出要交给程序用(传参数、调工具、路由、算钱),程序只认约定好的格式,多一个反引号 `json.loads` 就失败,字段名不对代码就取不到值。所以要让模型每次都按约定的结构输出,并在程序里检查。

</details>

2. 三个层次分别是什么?各自保证了什么?

<details><summary>答案</summary>

求它:在提示词里写清格式,什么都不保证,只是让模型大概率照做。约束它:JSON mode,保证返回合法 JSON 对象,不保证键名和类型。逼它:按 JSON Schema 约束解码,保证键、类型、枚举都符合 schema。三层都不保证值是对的,被 `max_tokens` 截断时也都可能不合格。

</details>

3. 今天「随口要 + JSON mode」为什么 18 次全部失败?失败的原因和「随口要」一样吗?

<details><summary>答案</summary>

不一样。「随口要」18 次全是「不是 JSON」,模型把 JSON 包进了代码块。「随口要 + JSON mode」没有代码块了,全是合法 JSON,但提示词没说键名,模型用了中文键「套餐类型」,`check()` 报「缺字段 plan」。JSON mode 把问题从解析失败挪成了字段不对。

</details>

4. 「多少钱我忘了」那张工单,模型输出 `"paid": 0`,`check()` 判通过。问题出在哪?怎么修?

<details><summary>答案</summary>

格式要求 `paid` 必须是整数,工单里没有金额,模型只能编一个,编了 0。格式完全合法,任何一层都拦不住。修法是在格式里允许「不知道」(`null`),提示词里说明「没写就填 null,不要猜」,代码里检查到 `None` 时转人工或追问客户,不能交给 `refund()`。

</details>

5. 面试题:「怎么保证 Agent 稳定输出结构化数据?」

<details><summary>答案</summary>

分层做。提示词里写清每个字段的名字、类型、取值范围和缺失时怎么填;厂商支持就开 JSON mode,支持 schema 约束(OpenAI 的 `json_schema` strict、Claude 的 `output_config.format`、工具调用的 strict 模式)就用 schema;程序这边无论如何都要用 schema(比如 pydantic)再校验一次,并检查 `finish_reason` 是不是被截断;校验失败把错误信息喂回模型重试,有上限,超过就降级或转人工。还要防编造:可能缺失的字段允许 null,并在业务代码里处理。约束解码只保证格式,不保证内容对。

</details>

6. 约束解码在每一步做了什么?用 `toy_constrained.py` 里的例子说。

<details><summary>答案</summary>

每一步先拿到模型给的候选和概率,把「接上以后不可能成为合格结果」的候选划掉,剩下的重新按比例分配到加起来等于 1,再从里面挑。例子里写到值的位置时,「年费会员」0.45 和「包年」0.12 被划掉,「年付」0.35 和「月付」0.08 留下,变成 0.81 和 0.19,于是选了「年付」。它选年付是因为剩下的里面年付概率最高,不是因为它判断对了。

</details>

## 明天预告

Day 148 · 结构化输出(二):JSON mode 和 JSON Schema 约束。今天第二层只用了一行 `response_format`,第三层只在假模型上看了原理。明天逐个字段读懂一份 JSON Schema(`type`、`properties`、`required`、`enum`、`additionalProperties`),把今天的四个字段写成 schema,看各家对 schema 的支持差在哪,并实际跑一次第三层。
