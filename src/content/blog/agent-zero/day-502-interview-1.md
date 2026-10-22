---
title: 'Day 502 · 面试(一):模型、提示词与结构化输出题'
description: '面试基础题的第一套:大模型基础 7 题、模型结构加题 4 道、提示词与结构化输出 6 题。先写一个计时出声答题的小脚本和错题回炉脚本,再用四个几分钱的小实验给答案找真实证据:中英文 token 数、temperature 稳不稳、前缀缓存命中、schema 校验失败后重试。'
pubDate: 2026-10-22
regime: none
tags: ['interview', 'llm-basics', 'prompt', 'structured-output', 'agent-zero']
series: 'agent-zero'
day: 502
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 501](/blog/agent-zero/day-501-resume-4/) 把前三天的零件拼成了一份能投的简历:300 字的代表项目说明,JSON 加 HTML 排一页,Chrome 打成 PDF,`pdf_check` 查页数、链接和机器能不能读出正常汉字;最后看了几个 Agent 认证,出了英文版。

简历投出去,下一步是面试。第一轮技术面基本是两块:基础概念,加上围绕你简历项目的追问。项目追问你这四天准备得已经够多了,每个数字都对过账。今天开始刷基础题,一共四套,今天是第一套,内容全是第二部分学过的东西。

## 今天要解决的问题

学完今天,你应该能做到:

1. 写一个计时自测脚本:随机抽题,你出声答,它记时间、给要点、让你自评,结果存进日志;再写一个脚本从日志里挑出要回炉的题,告诉你回哪一天重看。
2. 跑四个小实验,让「中文费不费 token」「temperature 设 0 稳不稳」「前缀缓存怎么省钱」「JSON 不合规怎么办」这四类题都有你亲手测出来的数字。
3. 把今天 17 道题每道出声答一遍,每道都能在概念之后接一句「我自己测过/在 SupportPilot 里是这样做的」。

预计用时 2.5–3 小时,题目部分建议分两次做完。前置:第二部分(Day 106–155)全部,题目后面都标了对应的 Day,答不上来就回去看;[Day 135](/blog/agent-zero/day-135-llm-client-1/) 的 `common/llm.py`。

学法提示:先对照文章逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,把 `quiz.py` 的 `ask` 和 `weak.py` 默写出来;做练习,做不出再展开参考答案,看完关掉重写一遍。题目部分不要先看答案,先计时出声答。

## 题目怎么选的、怎么答

题目来自旧课的 60 题题库,分布参考站长 2026 年 10 月整理的 880 条 Agent 岗 JD 的技能频次:国内有正文的 334 条里,工具调用、上下文工程、RAG、评测、框架和 Prompt 出现最多。今天这一套是最「基础」的那部分,单看 JD 出现频率不算最高,但几乎每场一面开头都会问两三道,答不上来很减分。另外加了 4 道模型结构题,国内一面问「讲讲 Transformer」的频率比 JD 上写的高得多,尤其是大厂和算法背景的面试官。

答题我推荐一个四步结构,几乎每道题都能套:

<figure>
<svg viewBox="0 0 640 170" role="img" aria-label="基础题的四步答题结构:一句话定义、机制、取舍、我的项目里的例子">
  <rect x="0" y="0" width="640" height="170" fill="var(--paper-raised)"/>
  <rect x="16" y="50" width="134" height="56" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="28" y="74" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">1 一句话定义</text>
  <text x="28" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">先给结论</text>
  <rect x="170" y="50" width="134" height="56" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="182" y="74" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">2 机制</text>
  <text x="182" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">它怎么工作</text>
  <rect x="324" y="50" width="134" height="56" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="336" y="74" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">3 取舍</text>
  <text x="336" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">代价和边界</text>
  <rect x="478" y="50" width="146" height="56" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="490" y="74" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">4 我测过/我做过</text>
  <text x="490" y="92" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">一个具体数字</text>
  <line x1="150" y1="78" x2="170" y2="78" stroke="var(--ink-faint)"/>
  <line x1="304" y1="78" x2="324" y2="78" stroke="var(--ink-faint)"/>
  <line x1="458" y1="78" x2="478" y2="78" stroke="var(--ink-faint)"/>
  <text x="16" y="146" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">前两步证明你懂,后两步证明你做过。背前两步的人很多,能讲后两步的人少</text>
</svg>
<figcaption>一道基础题的答题结构。面试官区分「背过」和「做过」,主要看第 3、4 步。今天的四个小实验,就是给第 4 步准备数字。</figcaption>
</figure>

一道题答一到两分钟。太短显得只背了定义,太长面试官会打断。第 4 步是你的主场:讲完自然会引出项目追问,而项目追问你准备得最充分。

第 4 步最好有一个数字。「我测过,同一句话 DeepSeek 中文 15 个 token、英文 21 个」比「国产模型对中文做了优化」有分量得多,因为前者面试官没法当场反驳,后者谁都能说。所以今天先写工具,再做实验,最后才是题目本身。

## 第一步:把题库写成 JSON

和 Day 501 的简历一样,内容放 JSON,脚本来读。每道题存四样:编号、题目、对应哪几天、几条要点。要点是「答到这几条就算答到了」的提示,不是完整答案,完整答案在文章后面的折叠块里。

```bash
cd agent-zero-lab
mkdir -p part09/interview
touch part09/interview/__init__.py
```

`part09/interview/bank1.json` 是数据,可以直接复制:

```json
[
 {"id": "1", "q": "token 是什么?为什么中文常常比英文更费 token?", "day": [107, 108], "points": ["tokenizer 切出的最小单位", "窗口、计费、延迟都按 token 算", "看目标模型的 usage,别猜"]},
 {"id": "2", "q": "temperature 和 top_p 分别控制什么?Agent 场景一般怎么设?", "day": [110, 112], "points": ["温度改分布平滑度,top_p 截候选", "一般只调一个", "工具调用和评测用低温"]},
 {"id": "3", "q": "大模型为什么会幻觉?工程上有哪些降低手段?", "day": [114], "points": ["预测下一个 token,没有不知道的机制", "RAG + 引用、工具查真数据", "输出核对 + 评测量化"]},
 {"id": "4", "q": "模型支持 128K 上下文,是不是把资料都塞进去就行了?", "day": [109, 526], "points": ["成本和延迟随输入涨", "长了中间的信息用不好", "按任务挑内容,定 token 预算"]},
 {"id": "5", "q": "推理模型和普通模型在 Agent 里怎么选?", "day": [115, 399], "points": ["多步规划、高风险判断用推理", "简单分类抽取用小模型", "路由,用评测数据定"]},
 {"id": "6", "q": "预训练、指令微调、RLHF 分别带来了什么?Agent 工程师为什么要知道?", "day": [113], "points": ["知识 / 听指令 / 偏好", "讨好倾向和注入有关", "工具调用能力靠后训练,要实测"]},
 {"id": "7", "q": "什么时候该考虑微调,而不是继续改 prompt 或加 RAG?", "day": [113, 570], "points": ["缺知识用 RAG", "格式风格稳定、小模型替大模型", "先有评测集"]},
 {"id": "加1", "q": "用两三分钟讲讲 Transformer 的结构。", "day": [116], "points": ["decoder-only,多层注意力 + FFN", "因果遮罩,自回归", "prefill 随长度变贵"]},
 {"id": "加2", "q": "注意力里的 Q、K、V 是什么?多头有什么用?", "day": [116], "points": ["Q 找、K 被比、V 被取", "softmax 权重加权求和", "多头看不同关系"]},
 {"id": "加3", "q": "KV cache 是什么?和 prompt caching、长上下文成本有什么关系?", "day": [117, 397], "points": ["缓存前面 token 的 K、V", "显存随长度和并发涨", "相同前缀跨请求复用,固定部分放前面"]},
 {"id": "加4", "q": "MoE 模型是什么?总参数和激活参数分别决定什么?", "day": [117], "points": ["路由器选少数专家", "激活参数定速度和单 token 成本", "总参数定显存"]},
 {"id": "8", "q": "一个好的 system prompt 一般包含哪些部分?", "day": [130, 143], "points": ["角色任务、输入来源", "输出格式、规则边界、不确定怎么办", "固定部分放前面,进版本管理"]},
 {"id": "9", "q": "few-shot 示例有哪些坑?", "day": [141], "points": ["过度模仿长度语气", "分布单一带偏", "用评测确认收益"]},
 {"id": "10", "q": "推理模型时代,还需要在 prompt 里写「一步一步思考」吗?", "day": [142, 115], "points": ["推理模型收益小", "普通模型复杂任务仍有用", "结构化输出里加 reason 字段"]},
 {"id": "11", "q": "怎么保证模型输出一定是合法、符合 schema 的 JSON?", "day": [147, 148, 149, 150], "points": ["schema 约束 > JSON mode > 只靠 prompt", "pydantic 校验", "错误喂回重试,再不行兜底"]},
 {"id": "12", "q": "prompt 怎么做版本管理?", "day": [144], "points": ["进 git 或平台,有版本号", "改动跑回归评测", "trace 记版本,一次只改一处"]},
 {"id": "13", "q": "改 prompt 修好了 A 类问题,B 类又坏了,怎么办?", "day": [344, 347], "points": ["没有回归评测的症状", "覆盖两类的测试集全量跑", "冲突就路由拆开,先做错误分析"]}
]
```

`id` 用字符串而不是数字,因为有「加1」这种编号。`day` 是列表,一道题可能对应好几天。

## 第二步:计时自测脚本

为什么要计时?因为面试的时间感和你自己在家想的完全不一样。在家想一道题,你会不知不觉想五分钟,觉得自己答得很好;面试时一两分钟就得说完,而且是出声说。不出声在脑子里过一遍,和真说出来,是两种能力。我第一次出声答「讲讲 Transformer」,说到第三句就卡住了,那些词在脑子里都认识,串不成句子。

脚本做的事:随机抽 n 题,一题一题显示,题目一出来就开始计时,你出声答完按回车,它报用时、显示要点,你给自己打 0、1、2 分,最后追加写进日志。

```python
# agent-zero-lab/part09/quiz.py
import json
import random
import sys
import time
from datetime import datetime
from pathlib import Path

BANK = Path("part09/interview/bank1.json")
LOG = Path("part09/interview/log.jsonl")
LIMIT = 120


def load_bank() -> list[dict]:
    return json.loads(BANK.read_text(encoding="utf-8"))


def ask(item: dict) -> dict:
    print(f"\n【{item['id']}】{item['q']}")
    start = time.perf_counter()
    input("出声答完按回车 > ")
    secs = round(time.perf_counter() - start, 1)
    print(f"用时 {secs} 秒" + (f",超过 {LIMIT} 秒" if secs > LIMIT else ""))
    for p in item["points"]:
        print("  要点:", p)
    score = input("自评 0 没答出 / 1 答了一半 / 2 都答到 > ").strip()
    return {"id": item["id"], "secs": secs, "score": int(score or 0), "at": datetime.now().isoformat(timespec="seconds")}


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    picked = random.sample(load_bank(), n)
    with LOG.open("a", encoding="utf-8") as f:
        for item in picked:
            rec = ask(item)
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"\n已记录 {n} 题到 {LOG}")
```

<div class="line-notes">

- `LOG = Path("part09/interview/log.jsonl")` 日志用 JSONL:每行一个 JSON 对象。好处是可以一直往后追加,不用每次把整个文件读出来再写回去。评测那部分你已经用过这个格式。
- `LIMIT = 120` 一道题两分钟。超过不扣分,只是提醒。
- `def ask(item: dict) -> dict:` 问一道题,返回这道题的记录。
- `start = time.perf_counter()` 题目一打印出来就开始计时。`perf_counter` 是专门用来量时间间隔的高精度计时器,相当于浏览器里的 `performance.now()`,只是单位是秒。
- `input("出声答完按回车 > ")` `input` 会一直停在这里等你按回车,返回你敲的字(这里不关心)。相当于 Node 里 `readline` 的 `rl.question`,但它是同步阻塞的,不用写回调或 await。
- `secs = round(time.perf_counter() - start, 1)` 两次计时相减,保留一位小数。
- `print(f"用时 {secs} 秒" + (f",超过 {LIMIT} 秒" if secs > LIMIT else ""))` 超时才拼上后半句。括号不能省,否则 `+` 和 `if` 的优先级会让整句话在没超时的时候变成空字符串。
- `score = input("自评 0 没答出 / 1 答了一半 / 2 都答到 > ").strip()` `.strip()` 去掉首尾空白,相当于 JS 的 `.trim()`。
- `"score": int(score or 0)` 直接回车时 `score` 是空字符串,`score or 0` 得到 0。这一行有坑,马上演示。同一行最后的 `datetime.now().isoformat(timespec="seconds")` 记下答题时间,格式像 `2026-10-22T13:07:22`,以后能看出你哪天练的。
- `picked = random.sample(load_bank(), n)` 不重复地随机抽 n 道。相当于 lodash 的 `_.sampleSize`。
- `with LOG.open("a", encoding="utf-8") as f:` `"a"` 是追加模式,文件不存在会自动创建。每答完一题马上写一行,中途退出前面的也不会丢。
- `f.write(json.dumps(rec, ensure_ascii=False) + "\n")` 一条记录一行,结尾的换行别忘了,否则下一条会接在同一行,文件就不是 JSONL 了。

</div>

正常用法是在终端里运行 `uv run python -m part09.quiz 5`,然后真的出声答。为了把输出贴进文章,我用管道模拟了三次按键(先等几秒、回车、再输入分数),所以下面的用时只有两三秒:

```bash
( sleep 4; echo; echo 2; sleep 3; echo; echo 1; sleep 2; echo; echo ) | uv run python -m part09.quiz 3
```

```text

【13】改 prompt 修好了 A 类问题,B 类又坏了,怎么办?
出声答完按回车 > 用时 3.9 秒
  要点: 没有回归评测的症状
  要点: 覆盖两类的测试集全量跑
  要点: 冲突就路由拆开,先做错误分析
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
【6】预训练、指令微调、RLHF 分别带来了什么?Agent 工程师为什么要知道?
出声答完按回车 > 用时 3.0 秒
  要点: 知识 / 听指令 / 偏好
  要点: 讨好倾向和注入有关
  要点: 工具调用能力靠后训练,要实测
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
【加2】注意力里的 Q、K、V 是什么?多头有什么用?
出声答完按回车 > 用时 2.0 秒
  要点: Q 找、K 被比、V 被取
  要点: softmax 权重加权求和
  要点: 多头看不同关系
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
已记录 3 题到 part09/interview/log.jsonl
```

`( ...; ... ) | 命令` 是把括号里几条命令的输出接到 Python 的标准输入上,`echo` 输出一个空行就等于按了一次回车,`echo 2` 等于敲 2 再回车。管道喂进去的字不会显示在屏幕上,所以「>」后面是空的。你自己用时不用管这一行。抽到哪几题是随机的,你跑出来大概率和我不一样。

看一眼日志:

```bash
cat part09/interview/log.jsonl
```

```text
{"id": "13", "secs": 3.9, "score": 2, "at": "2026-10-22T13:07:22"}
{"id": "6", "secs": 3.0, "score": 1, "at": "2026-10-22T13:07:25"}
{"id": "加2", "secs": 2.0, "score": 0, "at": "2026-10-22T13:07:27"}
```

第三题我喂的是空行,`score or 0` 记成了 0 分。

### 故意敲错一次

如果自评那里不小心敲了个「两分」:

```bash
( sleep 1; echo; echo 两分 ) | uv run python -m part09.quiz 1
```

```text
  File "/.../agent-zero-lab/part09/quiz.py", line 35, in <module>
    rec = ask(item)
  File "/.../agent-zero-lab/part09/quiz.py", line 27, in ask
    return {"id": item["id"], "secs": secs, "score": int(score or 0), "at": datetime.now().isoformat(timespec="seconds")}
                                                     ~~~^^^^^^^^^^^^
ValueError: invalid literal for int() with base 10: '两分'
```

`int("两分")` 转不了,整个程序崩掉。这一题的记录没写进去,前面答过的题倒是在,因为每题答完就写了一行。JS 里 `parseInt("两分")` 返回 `NaN` 不报错,Python 的 `int` 直接抛异常,这是两边很不一样的地方。

修法是单独写一个读分数的函数,不合法就再问一遍。在 `ask` 上面加:

```python
def read_score() -> int:
    while True:
        s = input("自评 0 没答出 / 1 答了一半 / 2 都答到 > ").strip()
        if s in {"0", "1", "2"}:
            return int(s)
        print("只能输入 0、1、2")
```

<div class="line-notes">

- `while True:` 一直循环,直到 `return` 跳出去。
- `if s in {"0", "1", "2"}:` 先判断是不是这三个字符之一,是才转整数,所以 `int` 永远不会失败。空字符串也不在集合里,直接回车会被再问一遍,不再默认记 0 分。

</div>

`ask` 里原来那两行改成:

```python
    score = read_score()
    return {"id": item["id"], "secs": secs, "score": score, "at": datetime.now().isoformat(timespec="seconds")}
```

再敲错一次试试:

```bash
( sleep 2; echo; echo 两分; echo 2 ) | uv run python -m part09.quiz 1
```

```text
出声答完按回车 > 用时 1.9 秒
  要点: 缺知识用 RAG
  要点: 格式风格稳定、小模型替大模型
  要点: 先有评测集
自评 0 没答出 / 1 答了一半 / 2 都答到 > 只能输入 0、1、2
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
已记录 1 题到 part09/interview/log.jsonl
```

第一次「两分」被拒,第二次的 2 收下了。这次抽到的是第 7 题。

## 第三步:错题回炉

刷题最没用的做法,是每次都从头刷一遍。会的题反复答,不会的题还是不会。日志存下来,就是为了只挑「没答好」的回炉。

```python
# agent-zero-lab/part09/weak.py
import json
from pathlib import Path

from part09.quiz import LIMIT, LOG, load_bank

latest: dict[str, dict] = {}
for line in LOG.read_text(encoding="utf-8").splitlines():
    rec = json.loads(line)
    latest[rec["id"]] = rec

bank = {item["id"]: item for item in load_bank()}
todo = [r for r in latest.values() if r["score"] < 2 or r["secs"] > LIMIT]
print(f"题库 {len(bank)} 题,答过 {len(latest)} 题,要回炉 {len(todo)} 题")
for r in sorted(todo, key=lambda r: r["score"]):
    item = bank[r["id"]]
    days = "、".join(f"Day {d}" for d in item["day"])
    print(f"  [{r['score']}分 {r['secs']}秒] {item['id']}. {item['q'][:20]}… → 回去看 {days}")
never = [i for i in bank if i not in latest]
print(f"还没抽到过:{never}")
```

<div class="line-notes">

- `from part09.quiz import LIMIT, LOG, load_bank` 复用常量和函数。`quiz.py` 有 `if __name__ == "__main__":`,import 时不会开始抽题。
- `for line in LOG.read_text(encoding="utf-8").splitlines():` 一行一条记录。`splitlines()` 按换行切,相当于 JS 的 `.split("\n")`,但不会在末尾多出一个空字符串。
- `latest[rec["id"]] = rec` 同一道题答过多次,后面的覆盖前面的,最后留下的就是最近一次。日志按时间顺序追加,所以「后写的就是新的」。
- `bank = {item["id"]: item for item in load_bank()}` 把题库转成「编号 → 题目」的字典,方便按编号查。
- `todo = [r for r in latest.values() if r["score"] < 2 or r["secs"] > LIMIT]` 回炉的标准:没拿满分,或者超时了。超时也要回炉,因为面试官不会等你三分钟。
- `for r in sorted(todo, key=lambda r: r["score"]):` 0 分的排最前面,先补最差的。
- `days = "、".join(f"Day {d}" for d in item["day"])` 把 `[107, 108]` 拼成「Day 107、Day 108」。
- `print(f"  [{r['score']}分 {r['secs']}秒] {item['id']}. {item['q'][:20]}… → 回去看 {days}")` 题目只显示前 20 个字符,够你认出是哪道。
- `never = [i for i in bank if i not in latest]` 遍历字典得到的是键,也就是题目编号。还没抽到的题也列出来,免得某道题运气好一直没被抽到。

</div>

```bash
uv run python -m part09.weak
```

```text
题库 17 题,答过 4 题,要回炉 2 题
  [0分 2.0秒] 加2. 注意力里的 Q、K、V 是什么?多头有什… → 回去看 Day 116
  [1分 3.0秒] 6. 预训练、指令微调、RLHF 分别带来了什… → 回去看 Day 113
还没抽到过:['1', '2', '3', '4', '5', '加1', '加3', '加4', '8', '9', '10', '11', '12']
```

这就是今天的学习闭环:抽题、出声答、看要点、自评,隔一天跑 `weak.py`,回那一天重看,再答。练习 1 让你给 `quiz.py` 加一个「只抽回炉题」的模式。

## 第四步:给答案找证据

下面四个实验各对应一类题,每个都只花几厘钱。跑完把数字记下来,面试时第 4 步就有东西说。四个脚本都放在 `part09/interview/`,都在 `agent-zero-lab/` 目录下用 `-m` 运行。

### 实验一:中文到底费不费 token(第 1 题)

```python
# agent-zero-lab/part09/interview/evidence_tokens.py
from common.llm import LLMClient

TEXTS = {
    "空": "",
    "中文": "客户说上个月的发票金额不对,要求退款并重新开票。",
    "英文": "The customer says last month's invoice amount is wrong and asks for a refund and a reissued invoice.",
}

llm = LLMClient()
base = 0
for name, text in TEXTS.items():
    r = llm.chat([{"role": "user", "content": text}], max_tokens=1)
    if name == "空":
        base = r.prompt_tokens
    print(f"{name}: {len(text)} 个字符 → prompt_tokens {r.prompt_tokens},去掉固定开销 {r.prompt_tokens - base}")
print(llm.ledger)
```

<div class="line-notes">

- `"空": "",` 先发一条空消息,量出「什么都不说」也要算的 token。每条消息外面都会包一层聊天模板(角色标记之类),这部分要减掉才公平。[Day 121](/blog/agent-zero/day-121-api-request/) 打印请求体时你见过 messages 的结构。
- `"中文": "客户说上个月的发票金额不对,要求退款并重新开票。",` 中英两句意思一样,都是一张典型的 SupportPilot 工单。
- `r = llm.chat([{"role": "user", "content": text}], max_tokens=1)` 只要输入的 token 数,输出 1 个 token 就够了,省钱。
- `base = r.prompt_tokens` 实跑是 4。
- `print(llm.ledger)` `Ledger` 是 Day 135 写的账本,打印出总调用数、总 token 和总花费。

</div>

```bash
uv run python -m part09.interview.evidence_tokens
```

```text
空: 0 个字符 → prompt_tokens 4,去掉固定开销 0
中文: 24 个字符 → prompt_tokens 19,去掉固定开销 15
英文: 100 个字符 → prompt_tokens 25,去掉固定开销 21
3 次调用 | 输入 48 / 输出 3 tokens | 约 ¥0.0001
```

在 DeepSeek 上,同一个意思中文 15 个 token,英文 21 个,中文反而更省。那「中文更费 token」这个说法从哪来?换 OpenAI 的 tokenizer 试试。OpenAI 有一个开源库 tiktoken 能在本地数 token,不调 API、不花钱。我不想把它装进项目,用 `uv run --with` 临时带上:

```bash
uv run --with tiktoken python -c "
import tiktoken
for name in ['cl100k_base','o200k_base']:
    e=tiktoken.get_encoding(name)
    print(name, len(e.encode('客户说上个月的发票金额不对,要求退款并重新开票。')), len(e.encode(\"The customer says last month's invoice amount is wrong and asks for a refund and a reissued invoice.\")))
"
```

```text
cl100k_base 22 21
o200k_base 18 20
```

`uv run --with 包名` 会在一个临时环境里装上这个包再运行,`pyproject.toml` 不会变,相当于 `npx`。tiktoken 第一次用某个编码时要从网上下载编码表,网络不通会卡住。cl100k_base 是 GPT-4 那一代的 tokenizer,o200k_base 是 GPT-4o 以后的。

三家放一起看:老的 cl100k 上中文 22 个、英文 21 个,中文略费;新的 o200k 上中文 18、英文 20;DeepSeek 中文 15、英文 21。所以准确的答法是:**以英文为主训练的老 tokenizer 上中文更费,新一代和国产模型的 tokenizer 给中文分了更多词表,差距小了甚至反过来**。面试时把这三个数说出来,再补一句「所以估成本要看目标模型 API 返回的 usage,不要拿别家的 tokenizer 估」,这道题就答到了第 4 步。

只有一句话,样本太小,别把 15 对 21 当成普遍比例。练习时换几段长一点的文字自己测。

### 实验二:temperature 设成 0 就稳了吗(第 2 题)

```python
# agent-zero-lab/part09/interview/evidence_temp.py
from collections import Counter

from common.llm import LLMClient

SYSTEM = "把工单分到 billing / technical / account / other 之一,只输出类别名。"
TICKET = "我换了新手机以后登不上了,而且上个月好像被多扣了一次钱。"

llm = LLMClient()
for t in (0, 1.5):
    labels = [
        llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": TICKET}], temperature=t).content.strip()
        for _ in range(5)
    ]
    print(f"temperature={t}: {Counter(labels)}")

poem = "用一句话描述发票,不超过 15 个字。"
for t in (0, 1.5):
    outs = [llm.chat([{"role": "user", "content": poem}], temperature=t).content.strip() for _ in range(3)]
    print(f"temperature={t}: {outs}")
print(llm.ledger)
```

<div class="line-notes">

- `from collections import Counter` 计数器:给它一个列表,它数出每个值出现几次。相当于 JS 里 `reduce` 出一个 `{值: 次数}` 对象。
- `TICKET = "我换了新手机以后登不上了,而且上个月好像被多扣了一次钱。"` 故意挑一张两个问题混在一起的工单:登录(account)和扣费(billing)都沾边。分类模糊的时候,温度的影响最明显。
- `for t in (0, 1.5):` 一低一高两档。DeepSeek 的 temperature 范围是 0 到 2。
- `for _ in range(5)` 同一个请求发 5 次。`_` 表示「这个循环变量我不用」。
- `poem = "用一句话描述发票,不超过 15 个字。"` 第二组是开放式生成,看措辞变不变。

</div>

```bash
uv run python -m part09.interview.evidence_temp
```

```text
temperature=0: Counter({'other': 5})
temperature=1.5: Counter({'billing': 3, 'other': 2})
temperature=0: ['发票是购销商品等业务的收付款凭证。', '发票是购销商品、提供服务的收付款凭证。', '发票是购销商品等业务的收付款凭证。']
temperature=1.5: ['交易凭证，记账报销法定依据。', '记录交易并用于报销的凭证。', '税务机关监制的收付款凭证。']
16 次调用 | 输入 530 / 输出 67 tokens | 约 ¥0.0016
```

两件事值得记住。

**第一,temperature=0 也不是完全确定的。** 第二组三次里有一次措辞不一样(「等业务」变成了「、提供服务」)。原因是服务端的批处理、浮点运算顺序这些东西会让同一个请求的计算结果有微小差别,[Day 112](/blog/agent-zero/day-112-sampling-2/) 讲 seed 和可复现时说过,大多数厂商都不保证逐字一样。所以评测时温度要固定,但同一道题最好还是跑几次看稳定性。

**第二,稳定不等于对。** 温度 0 时 5 次都是 other,很稳,但这张工单明明有账号问题和扣费问题,other 反而是最没用的答案。温度 1.5 时 billing 出现了 3 次。这说明问题不在温度,在类别设计:一张工单多个问题时该怎么分,system prompt 里没说。面试时说出这一层,比只答「工具调用用低温」深一截。

### 实验三:前缀缓存到底省多少(加 3 题)

KV cache 是推理引擎内部的事,你在 API 外面看不到。但它的跨请求版本,也就是 prompt caching(DeepSeek 叫上下文硬盘缓存),你能直接看到账单上的变化。

```python
# agent-zero-lab/part09/interview/evidence_cache.py
import time

from common.llm import LLMClient

RULES = "\n".join(f"规则 {i}:退款金额超过 {i * 100} 元时,必须先确认发票号、付款时间和客户身份,再转人工审批。" for i in range(1, 81))
SYSTEM = f"你是云簿的客服助手。下面是退款规则:\n{RULES}\n只用一句话回答。"

llm = LLMClient()
for q in ["退 350 元要转人工吗?", "退 50 元要转人工吗?", "退 8000 元要转人工吗?"]:
    r = llm.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": q}], max_tokens=40)
    print(f"{q}  输入 {r.prompt_tokens},命中缓存 {r.cache_hit_tokens},耗时 {r.latency:.2f}s,¥{r.cost:.5f}")
    time.sleep(1)
print(llm.ledger)
```

<div class="line-notes">

- `RULES = "\n".join(f"规则 {i}` 造 80 条规则,凑出一个两千多 token 的长 system prompt。内容是凑的,规则之间还互相矛盾,别在意,我们只看缓存。
- `SYSTEM = f"你是云簿的客服助手。下面是退款规则:\n{RULES}\n只用一句话回答。"` 三次请求的 system 一字不差,只有最后的用户问题不同。这就是「固定部分放前面」。
- `max_tokens=40)` 回答限制在 40 个 token 以内,我们不关心它答得对不对。
- `命中缓存 {r.cache_hit_tokens}` `cache_hit_tokens` 是 `LLMClient` 从 DeepSeek 返回的 `prompt_cache_hit_tokens` 里读出来的,Day 135 封装时就留了这个字段。
- `time.sleep(1)` 隔一秒再发。缓存要先写进去才能命中,紧挨着发偶尔会没命中。

</div>

```bash
uv run python -m part09.interview.evidence_cache
```

```text
退 350 元要转人工吗?  输入 2341,命中缓存 0,耗时 0.64s,¥0.00491
退 50 元要转人工吗?  输入 2341,命中缓存 2176,耗时 0.85s,¥0.00054
退 8000 元要转人工吗?  输入 2342,命中缓存 2176,耗时 0.55s,¥0.00061
3 次调用 | 输入 7024 / 输出 67 tokens | 约 ¥0.0061
```

第一次 0 命中,¥0.00491;后两次 2341 个输入 token 里有 2176 个命中缓存,花费降到 ¥0.00054,差不多九分之一。算一下第二次:命中 2176 × 0.04 / 1,000,000 + 未命中 165 × 2 / 1,000,000 + 输出 × 8 / 1,000,000,命中部分的单价只有未命中的五十分之一(deepseek-flash 高峰价,2026 年 10 月查的 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing))。

命中的是 2176 而不是全部 2341,因为 DeepSeek 按一定的 token 间隔把前缀切成「缓存前缀单元」,只有完整的单元才能命中,末尾不满一个单元的那截和用户问题都算未命中([DeepSeek 上下文硬盘缓存文档](https://api-docs.deepseek.com/zh-cn/guides/kv_cache))。

耗时没有明显变化,0.64、0.85、0.55 秒,不要据此说「缓存让延迟降了多少」。两千多 token 的 prefill 本来就很快,差别被网络抖动盖住了。上下文到几万 token 时首 token 延迟的差别才明显。面试时只说你测到的:**成本降到约九分之一,延迟在这个长度上看不出差别**。说一个你没测出来的「延迟降低 80%」,面试官追问一句你就露馅。

### 实验四:JSON 不合规怎么办(第 11 题)

这道题的答案你在 [Day 150](/blog/agent-zero/day-150-structured-4/) 写过:校验失败,把错误喂回去让模型改。今天只做一件事,把 pydantic 的报错原文和一次真实的重试记下来。

```python
# agent-zero-lab/part09/interview/evidence_schema.py
from typing import Literal

from pydantic import BaseModel, ValidationError

from common.llm import LLMClient


class Ticket(BaseModel):
    category: Literal["billing", "technical", "account", "other"]
    priority: Literal["low", "high"]


SYSTEM = '从工单里抽字段,只输出 JSON:{"category": "...", "priority": "..."}'
TICKET = "我们公司的发票已经错了三次,财务今天必须拿到正确的!"
bad = '{"category": "billing", "priority": "urgent"}'
error = ""

try:
    Ticket.model_validate_json(bad)
except ValidationError as e:
    error = str(e)
    print(error)

llm = LLMClient()
r = llm.chat(
    [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": TICKET},
        {"role": "assistant", "content": bad},
        {"role": "user", "content": f"你的输出没通过校验,错误如下,请改正后只输出 JSON:\n{error}"},
    ],
    response_format={"type": "json_object"},
    temperature=0,
)
print("重试后:", Ticket.model_validate_json(r.content), f"| ¥{r.cost:.5f}")
```

<div class="line-notes">

- `priority: Literal["low", "high"]` 优先级只许两个值。真实项目里模型最常犯的错就是自己发明一个值,比如 urgent、medium、P0。
- `SYSTEM = '从工单里抽字段,只输出 JSON:{"category": "...", "priority": "..."}'` 故意没在 prompt 里写 priority 能取哪些值,模拟一个写得不够好的 prompt。
- `bad = '{"category": "billing", "priority": "urgent"}'` 这是一份「模型第一次的输出」。为了每次都能稳定复现,我直接写死,不真去调模型碰运气。
- `error = ""` 先给个初值。不写的话,类型检查器会提示 `error` 可能没定义(如果 `try` 里没抛异常,`except` 那段不会执行)。
- `except ValidationError as e:` 只接 pydantic 的校验错误,别的错误照常抛出。
- `{"role": "assistant", "content": bad},` 把模型「上一次的输出」作为 assistant 消息放回历史,再追加一条 user 消息附上报错原文。模型看得到自己错在哪。
- `response_format={"type": "json_object"},` JSON mode 保证输出是合法 JSON,但保证不了取值对,所以后面还要再校验一次。
- `print("重试后:", Ticket.model_validate_json(r.content)` 如果第二次还错,这里会抛异常。真实代码里要设最多重试几次,然后走兜底。

</div>

```bash
uv run python -m part09.interview.evidence_schema
```

```text
1 validation error for Ticket
priority
  Input should be 'low' or 'high' [type=literal_error, input_value='urgent', input_type=str]
    For further information visit https://errors.pydantic.dev/2.14/v/literal_error
重试后: category='billing' priority='high' | ¥0.00041
```

pydantic 的报错写得很清楚:哪个字段、允许哪些值、你给了什么。这几行原样喂回去,模型一次就改成了 high。面试时可以讲这个顺序:能用 schema 约束解码就用,DeepSeek 的 JSON Output 文档里只有 `json_object` 这一种(而且要求 prompt 里出现 json 这个词),所以合法 JSON 由 JSON mode 保证、取值由 pydantic 校验、错了带着报错重试一两次、再错就兜底(默认值或转人工)。而第一道防线其实是 prompt:把 priority 的取值写进 system prompt,大多数时候根本不需要重试。

四个实验加起来花了约 ¥0.0082(0.0001 + 0.0016 + 0.0061 + 0.0004),都按高峰价记账。

## 题库(一):模型、提示词与结构化输出

下面 17 道题,每道先计时出声答,再展开看要点。答案是要点,不是标准答案,用你自己的话和你自己的例子讲。题目后面的 Day 是答不上来时该回去看的那一天。

### 大模型基础

**1. token 是什么?为什么中文常常比英文更费 token?([Day 107](/blog/agent-zero/day-107-tokens-1/)、[Day 108](/blog/agent-zero/day-108-tokens-2/))**

<details><summary>答案</summary>

token 是模型处理文本的最小单位,由 tokenizer(多数是 BPE 一类的子词算法)把文本切出来。上下文窗口、计费、延迟都按 token 算。以英文为主训练的 tokenizer 词表里中文词少,一个汉字可能被切成一个甚至多个 token,所以中文更费;新一代和国产模型给中文分了更多词表,差距小了甚至反过来。第 4 步用今天实验一的数:同一句工单,GPT-4 时代的 cl100k 中文 22、英文 21,o200k 中文 18、英文 20,DeepSeek 中文 15、英文 21。结论是估成本看目标模型 API 返回的 usage。

</details>

**2. temperature 和 top_p 分别控制什么?Agent 场景一般怎么设?([Day 110](/blog/agent-zero/day-110-sampling-1/)、[Day 112](/blog/agent-zero/day-112-sampling-2/))**

<details><summary>答案</summary>

两者都控制采样的随机性。temperature 改变概率分布的平滑程度,越低越倾向于选概率最高的 token;top_p 只在累计概率达到 p 的那批候选里采样。一般只调一个。工具调用、分类、结构化抽取要稳定,用低温;起草回复可以稍高。评测时温度要固定。补两点实测:温度 0 也不保证逐字一样(实验二三次里一次措辞不同);稳定不等于对,模糊工单温度 0 时稳定地分错,要改的是类别定义而不是温度。部分推理模型不允许改这些参数,以官方文档为准。

</details>

**3. 大模型为什么会幻觉?工程上有哪些降低手段?([Day 114](/blog/agent-zero/day-114-hallucination/))**

<details><summary>答案</summary>

模型本质是根据上下文预测下一个 token,它没有「不知道」的内在机制,缺知识时也会生成看起来合理的内容。工程手段:用 RAG 提供依据并要求引用出处;用工具查真实数据而不是让模型记;提示词里允许「不知道」并给转人工的路径;对输出做结构化校验和事实核对;用评测集量化幻觉率。SupportPilot 的例子:回复里的金额和发票号必须能在工具结果里找到,找不到就判不通过。

</details>

**4. 模型支持 128K 上下文,是不是把资料都塞进去就行了?([Day 109](/blog/agent-zero/day-109-context-window/),进阶篇 [Day 526](/blog/agent-zero/day-526-context-rot/) 会展开)**

<details><summary>答案</summary>

不是。一是成本和延迟随输入增长;二是上下文长了以后,模型对中间位置的信息利用变差(lost in the middle),无关内容越多越容易答偏,这个现象常被叫作 context rot;三是噪音会干扰工具选择。做法是按任务挑最相关的内容,给每一块定 token 预算。取舍是挑的那一步可能漏掉关键资料,所以检索要单独评召回。

</details>

**5. 推理模型和普通模型在 Agent 里怎么选?([Day 115](/blog/agent-zero/day-115-reasoning-models/)、[Day 399](/blog/agent-zero/day-399-model-routing/))**

<details><summary>答案</summary>

推理模型在多步规划、复杂判断、需要严谨推导的任务上更好,代价是延迟高、token 多、贵。简单的分类、抽取、格式转换用普通模型或小模型就够。常见做法是模型路由:规划或高风险判断走推理模型,其余走便宜的。选择要有评测数据支持。SupportPilot 里按难度路由大小模型是单工单成本从 ¥0.021 降到 ¥0.009 的原因之一,这个数在你简历上。

</details>

**6. 预训练、指令微调、RLHF 分别带来了什么?Agent 工程师为什么要知道这些?([Day 113](/blog/agent-zero/day-113-training/))**

<details><summary>答案</summary>

预训练让模型学到语言和世界知识;指令微调(SFT)让它学会按指令回答、按格式输出、调用工具;基于人类或 AI 反馈的强化学习让它更符合偏好,更有帮助、更愿意拒绝有害请求。工程上的意义:模型「尽量满足用户」的倾向来自后训练,这正是 prompt injection 容易成功的原因之一;工具调用能力的强弱也主要取决于后训练,所以不同模型的工具调用可靠性差别很大,要实测,不能看排行榜。

</details>

**7. 什么时候该考虑微调,而不是继续改 prompt 或加 RAG?([Day 113](/blog/agent-zero/day-113-training/),进阶篇 [Day 570](/blog/agent-zero/day-570-finetune-1/) 起专门讲)**

<details><summary>答案</summary>

缺知识用 RAG,知识会更新的更要用 RAG。微调适合:需要稳定的特定输出格式或风格;想让小模型在窄任务上替代大模型以降低成本和延迟;prompt 已经很长且仍不稳定。前提是先有评测集,能量化微调前后的差异,并且说得清训练数据从哪来。轻量方式通常是 LoRA。国内约两成 Agent 岗 JD 提到微调,Day 498 那份智联的岗位就要求「独立完成过至少一次开源模型的轻量微调」。你还没做过,就诚实说「原理知道,进阶篇在学」。

</details>

### 加题:模型结构(Transformer、注意力、MoE)

这 4 道 Agent 岗不会让你推公式,但答不上来很减分。底子在 Day 116 和 Day 117。

**加 1. 用两三分钟讲讲 Transformer 的结构。([Day 116](/blog/agent-zero/day-116-attention/))**

<details><summary>答案</summary>

现在的大模型基本都是 decoder-only Transformer:输入的 token 先变成向量,经过几十个结构相同的层,每层先做自注意力(每个 token 按相关度从前面的 token 取信息),再过前馈网络(FFN,每个 token 单独做非线性变换),层与层之间有残差连接和归一化;最后一层的输出经过一个线性层和 softmax,得到下一个 token 的概率分布。生成时加因果遮罩,每个位置只能看前面,所以要一个 token 一个 token 地自回归输出。位置信息靠位置编码,现在多用 RoPE。能主动补一句「所以长输入的 prefill 计算量随长度近似平方增长,首 token 延迟会变长」,把结构和工程现象连起来,会加分。

</details>

**加 2. 注意力机制里的 Q、K、V 是什么?多头注意力有什么用?([Day 116](/blog/agent-zero/day-116-attention/))**

<details><summary>答案</summary>

每个 token 的向量分别乘三个矩阵得到查询(Q)、键(K)、值(V)。当前 token 用自己的 Q 去和前面每个 token 的 K 算相似度,softmax 后当权重,再对这些 token 的 V 加权求和,得到它这一层的新表示。直觉上 Q 是「我在找什么」,K 是「我有什么」,V 是「我能给出的内容」。前端可以这样类比:Q 是搜索词,K 是每条记录的标签,V 是记录本身,只是这里不是选一条,而是按匹配度把所有记录按比例混起来。多头就是并行做多组这样的计算,每组用不同的矩阵,能同时关注不同类型的关系,最后拼起来。

</details>

**加 3. KV cache 是什么?它和 prompt caching、长上下文成本有什么关系?([Day 117](/blog/agent-zero/day-117-moe-kvcache/)、[Day 397](/blog/agent-zero/day-397-prompt-caching/))**

<details><summary>答案</summary>

生成第 n 个 token 时,前面 n-1 个 token 的 K、V 不会再变,推理引擎把它们缓存在显存里,每步只算新 token 的 Q、K、V,不用重算整段,这就是 KV cache。代价是显存占用随上下文长度和并发数线性增长,长上下文会降低一张卡能同时服务的请求数。prompt caching 是把相同前缀的 KV 跨请求存下来,命中时省掉这段的 prefill,所以缓存读便宜。实验三的数:2341 个输入 token 命中 2176 个,单次花费从 ¥0.00491 降到 ¥0.00054;在这个长度上延迟看不出差别。所以 system prompt 和工具定义要放最前面且保持不变,前面插一个时间戳就全部失效(练习 2)。

</details>

**加 4. MoE 模型是什么?总参数和激活参数分别决定什么?([Day 117](/blog/agent-zero/day-117-moe-kvcache/))**

<details><summary>答案</summary>

MoE(混合专家)把每层的 FFN 换成很多个专家网络加一个路由器,每个 token 只交给得分最高的少数几个专家计算。激活参数决定每个 token 的计算量,也就决定了速度和单 token 成本;总参数决定显存占用,因为所有专家都要加载。例子:DeepSeek-V3 总 671B、激活约 37B,API 便宜,但自部署仍要多卡。可能的追问是「MoE 的难点」:路由负载不均衡,有的专家被挤爆、有的闲着,训练时要加负载均衡;推理时专家分布在多张卡上,带来通信开销。

</details>

### 提示词与结构化输出

**8. 一个好的 system prompt 一般包含哪些部分?([Day 130](/blog/agent-zero/day-130-system-prompt/)、[Day 143](/blog/agent-zero/day-143-prompt-5/))**

<details><summary>答案</summary>

角色和任务目标;输入是什么、来自哪里(哪些内容是不可信数据);输出格式和长度;明确的规则与边界(能做什么、不能做什么、不确定时怎么办);必要的示例;工具的使用说明。写法上清晰直接,用 XML 标签或标题分隔不同部分,固定部分放前面以便缓存。改动进版本管理并跑回归评测。实验二就是一个反例:system prompt 没写「一张工单有多个问题时怎么分」,模型就稳定地给出最没用的 other。

</details>

**9. few-shot 示例有哪些坑?([Day 141](/blog/agent-zero/day-141-prompt-3/))**

<details><summary>答案</summary>

模型会过度模仿示例的长度、语气,甚至具体内容;示例分布单一会带偏,比如示例全是退款,分类就偏向退款;示例里的错误会被学走;示例占 token。做法是示例覆盖不同类别和边界情况,数量够用即可,并用评测确认加示例确实有收益。

</details>

**10. 推理模型时代,还需要在 prompt 里写「请一步一步思考」吗?([Day 142](/blog/agent-zero/day-142-prompt-4/)、[Day 115](/blog/agent-zero/day-115-reasoning-models/))**

<details><summary>答案</summary>

对推理模型,显式要求逐步思考收益通常很小,甚至可能干扰,它本来就会先想。对普通模型在复杂任务上仍有帮助。工程上更有用的做法是在结构化输出里加一个理由字段,比如分类时同时输出 reason,方便排查,也方便 judge 评估,代价是多一些输出 token。

</details>

**11. 怎么保证模型输出一定是合法、符合 schema 的 JSON?([Day 147](/blog/agent-zero/day-147-structured-1/) 到 [Day 150](/blog/agent-zero/day-150-structured-4/))**

<details><summary>答案</summary>

分层保证:能用 Structured Outputs(按 JSON Schema 约束解码)的就用;只有 JSON mode 的至少保证合法 JSON;应用层用 pydantic 校验字段和取值;校验失败把错误信息回传让模型重试一两次;仍失败就兜底(默认值、转人工)。不能只靠 prompt 里写「请输出 JSON」。实验四:priority 给了 urgent,pydantic 报 `Input should be 'low' or 'high'`,原文喂回去一次改对,花了 ¥0.00041。更好的是把取值直接写进 prompt,从源头减少重试。

</details>

**12. prompt 怎么做版本管理?([Day 144](/blog/agent-zero/day-144-prompt-6/))**

<details><summary>答案</summary>

prompt 和代码一样进 git(或进 prompt 管理平台,但要有版本号),每次改动跑回归评测集并记录分数;线上 trace 里记下每次调用用的是哪个版本,方便定位问题和回滚。一次只改一处,便于归因。

</details>

**13. 改 prompt 修好了 A 类问题,B 类又坏了,怎么办?([Day 344](/blog/agent-zero/day-344-eval-concepts/)、[Day 347](/blog/agent-zero/day-347-error-analysis-3/))**

<details><summary>答案</summary>

这是没有回归评测的典型症状。先建覆盖 A、B 两类的测试集,每次改动全量跑;两类需求真的冲突,就考虑路由拆开,让不同类别走不同的 prompt 或节点;不要追着单个失败样本改 prompt,先做错误分析,按失败类别的数量排优先级。SupportPilot 迭代 4 轮、test 集只跑一次,就是为了防这件事。

</details>

## 动手练习

**练习 1:只抽回炉题。** `quiz.py` 每次都是随机抽。写一个新脚本,只抽 `weak.py` 认定要回炉的题(最近一次没满分或超时),答完照样追加进日志。不要改 `quiz.py`,复用它的 `ask`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex502_weak_quiz.py
import json

from part09.quiz import LIMIT, LOG, ask, load_bank

latest: dict[str, dict] = {}
for line in LOG.read_text(encoding="utf-8").splitlines():
    rec = json.loads(line)
    latest[rec["id"]] = rec

weak_ids = {i for i, r in latest.items() if r["score"] < 2 or r["secs"] > LIMIT}
items = [it for it in load_bank() if it["id"] in weak_ids]
print(f"回炉 {len(items)} 题:{[it['id'] for it in items]}")
with LOG.open("a", encoding="utf-8") as f:
    for it in items:
        f.write(json.dumps(ask(it), ensure_ascii=False) + "\n")
```

<div class="line-notes">

- `from part09.quiz import LIMIT, LOG, ask, load_bank` `ask` 里已经用的是修好的 `read_score`。
- `weak_ids = {i for i, r in latest.items() if r["score"] < 2 or r["secs"] > LIMIT}` 集合推导式,和 `weak.py` 的判断一模一样。两处写同一个条件不太好,练完可以把它抽成 `quiz.py` 里的一个函数。
- `items = [it for it in load_bank() if it["id"] in weak_ids]` 按题库顺序排,不随机。回炉时顺序不重要。
- `f.write(json.dumps(ask(it), ensure_ascii=False) + "\n")` 答完一题写一行,和 `quiz.py` 一样。

</div>

```bash
( sleep 2; echo; echo 2; sleep 2; echo; echo 1 ) | uv run python -m part09.ex.ex502_weak_quiz
uv run python -m part09.weak
```

```text
回炉 2 题:['6', '加2']

【6】预训练、指令微调、RLHF 分别带来了什么?Agent 工程师为什么要知道?
出声答完按回车 > 用时 1.9 秒
  要点: 知识 / 听指令 / 偏好
  要点: 讨好倾向和注入有关
  要点: 工具调用能力靠后训练,要实测
自评 0 没答出 / 1 答了一半 / 2 都答到 > 
【加2】注意力里的 Q、K、V 是什么?多头有什么用?
出声答完按回车 > 用时 2.0 秒
  要点: Q 找、K 被比、V 被取
  要点: softmax 权重加权求和
  要点: 多头看不同关系
自评 0 没答出 / 1 答了一半 / 2 都答到 > 题库 17 题,答过 4 题,要回炉 1 题
  [1分 2.0秒] 加2. 注意力里的 Q、K、V 是什么?多头有什… → 回去看 Day 116
还没抽到过:['1', '2', '3', '4', '5', '加1', '加3', '加4', '8', '9', '10', '11', '12']
```

第 6 题这次拿了 2 分,从回炉清单里出去了;加 2 从 0 分升到 1 分,还在。最后一行粘在一起,是因为 `ask` 结尾那个 `input` 的提示没有换行,而管道喂进去的回车不显示,你自己在终端里敲不会这样。

</details>

**练习 2:观察题。在 system prompt 最前面加一个时间戳,缓存还命中吗?** 很多人喜欢在 system prompt 开头写「当前时间 xx:xx」,让模型知道今天几号。复制实验三,把时间(精确到微秒)放在 system 最前面,连发两次,看命中多少。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex502_cache_break.py
import time
from datetime import datetime

from common.llm import LLMClient

RULES = "\n".join(f"规则 {i}:退款金额超过 {i * 100} 元时,必须先确认发票号、付款时间和客户身份,再转人工审批。" for i in range(1, 81))

llm = LLMClient()
for q in ["退 350 元要转人工吗?", "退 50 元要转人工吗?"]:
    now = datetime.now().strftime("%H:%M:%S.%f")
    system = f"当前时间 {now}。你是云簿的客服助手。下面是退款规则:\n{RULES}\n只用一句话回答。"
    r = llm.chat([{"role": "system", "content": system}, {"role": "user", "content": q}], max_tokens=40)
    print(f"{q}  输入 {r.prompt_tokens},命中缓存 {r.cache_hit_tokens},¥{r.cost:.5f}")
    time.sleep(1)
```

<div class="line-notes">

- `RULES = "\n".join(` 和实验三一样的 80 条规则。我没有写 `from part09.interview.evidence_cache import RULES`,因为 `evidence_cache.py` 没有 `if __name__ == "__main__":` 保护,一 import 就会把它的三次请求也发一遍,白花钱。
- `now = datetime.now().strftime("%H:%M:%S.%f")` `%f` 是微秒。每次请求的时间都不同,所以 system 的开头每次都不一样。
- `system = f"当前时间 {now}。你是云簿的客服助手。` 时间放在最前面。后面两千多 token 和实验三的内容几乎一样,只是整体往后挪了几个字。

</div>

```bash
uv run python -m part09.ex.ex502_cache_break
```

```text
退 350 元要转人工吗?  输入 2353,命中缓存 0,¥0.00491
退 50 元要转人工吗?  输入 2353,命中缓存 0,¥0.00483
```

两次都是 0。前缀缓存是从第一个 token 开始逐块比的,开头变了一个字,后面两千多个 token 哪怕一模一样也全部作废。每次多花九倍的钱,只换来模型知道现在几点几分。要给时间,放在最后的 user 消息里,而且只精确到日期。这正是加 3 题答案里那句「固定部分放最前面且保持不变」的真实代价。

</details>

**练习 3:开放题。让模型扮面试官追问你。** 自己答题最大的问题是没人追问。写一个脚本:给模型题目和你的回答,让它按四步结构指出你缺了哪几步,再提一个它最想追问的问题。拿第 4 题的两种回答测试:一种只背定义,一种四步都有。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part09/ex/ex502_followup.py
import json

from pydantic import BaseModel

from common.llm import LLMClient


class Review(BaseModel):
    missing_steps: list[str]
    follow_up: str


SYSTEM = (
    "你是 AI Agent 工程师岗位的技术面试官。候选人答了一道基础题。"
    "按四步检查他的回答:定义、机制、取舍、项目里的例子,列出缺了哪几步;"
    "再提一个你最想追问的问题,一句话。"
    '只输出 JSON:{"missing_steps": ["..."], "follow_up": "..."}'
)
Q = "模型支持 128K 上下文,是不是把资料都塞进去就行了?"
ANSWERS = {
    "只背定义": "不是。上下文太长模型会注意力分散,出现 lost in the middle,所以不能全塞。",
    "四步都有": (
        "不是。一是成本和延迟随输入涨;二是长了以后中间的信息模型用得不好,无关内容越多越容易答偏。"
        "所以要按任务挑内容、给每块定 token 预算,代价是挑的那一步可能漏掉关键资料,要用评测看召回。"
        "SupportPilot 里我把帮助中心检索结果限制在 5 段,客户画像只放最近 3 张工单。"
    ),
}

llm = LLMClient()
for name, ans in ANSWERS.items():
    r = llm.chat(
        [{"role": "system", "content": SYSTEM}, {"role": "user", "content": f"题目:{Q}\n回答:{ans}"}],
        response_format={"type": "json_object"},
        temperature=0,
    )
    rv = Review.model_validate(json.loads(r.content))
    print(f"{name}: 缺 {rv.missing_steps}\n  追问:{rv.follow_up}")
print(llm.ledger)
```

<div class="line-notes">

- `class Review(BaseModel):` 两个字段:缺了哪几步、追问一句。
- `"按四步检查他的回答:定义、机制、取舍、项目里的例子,列出缺了哪几步;"` 把今天的四步结构直接写进面试官的规则里。
- `"四步都有": (` 括号里几个字符串挨着写会自动拼成一个,相当于 JS 里用 `+` 连起来,长字符串这样写好读。「5 段」「3 张工单」是示范数字,换成你项目里真实的配置。
- `temperature=0,` 评判类任务用低温,今天实验二说过它也不是完全稳定的。

</div>

```bash
uv run python -m part09.ex.ex502_followup
```

```text
只背定义: 缺 ['机制', '取舍', '项目里的例子']
  追问:你在项目里具体怎么切分和排序资料，来缓解 lost in the middle？
四步都有: 缺 ['机制（未解释长上下文下中间信息利用率下降、注意力稀释的具体机制）', '取舍（只提了漏召回风险，未展开与成本/延迟/准确率之间的权衡量化）']
  追问:你们用评测看召回时，具体用什么指标和阈值来判断“挑内容”这一步是否漏掉了关键资料？
2 次调用 | 输入 335 / 输出 117 tokens | 约 ¥0.0016
```

只背定义那版,三步全缺,判得准。四步都有那版,它还是挑出了两处「缺」,这其实是让模型当评委的老毛病:你让它找问题,它总能找出问题,[Day 359](/blog/agent-zero/day-359-llm-judge-4/) 讲 judge 偏差时说过。所以「缺了哪几步」这一栏只能参考,真正有用的是追问那一句:第二个追问「用什么指标和阈值判断挑内容漏没漏」是一个很真实的面试追问,你的记录表里有没有这个数?没有就去补。

</details>

**验收标准**

- `quiz.py` 和 `weak.py` 能跑,日志里至少有 17 条记录,每道题都至少答过一次。
- 四个实验你都自己跑过,记下了自己的数字(和我的不一样很正常)。
- `weak.py` 的回炉清单清空,或者剩下的每一题你都回对应那天重看过。
- 随便抽一道题,你能在两分钟内出声答完四步,第 4 步有一个你自己测出来或项目里的数字。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 四步答题法 | 一句话定义、机制、取舍、我测过或我做过的例子,前两步证明懂,后两步证明做过 |
| 回炉 | 只挑最近一次没答好或超时的题重新练,不从头刷 |
| JSONL | 每行一个 JSON 对象的文本格式,适合一直往后追加记录 |
| `input()` | Python 读一行键盘输入的函数,会停住等回车,返回敲的字符串 |
| `perf_counter` | Python 的高精度计时器,用来量时间间隔,相当于 `performance.now()` |
| tiktoken | OpenAI 开源的 tokenizer 库,本地数 token,不调 API |
| `uv run --with` | 临时带上一个包运行命令,不改 `pyproject.toml`,类似 `npx` |
| 缓存前缀单元 | DeepSeek 按固定 token 间隔切出的前缀块,只有完整的块能命中缓存 |
| 模型当评委的偏差 | 让模型找问题,它倾向于总能找出问题,所以它的扣分只能参考 |

## 常见误区

**只在脑子里过一遍就算答过了。** 脑子里认识每个词,不等于能连成两分钟的话。一定要出声,最好录下来听一遍。

**背了一个流行说法就当事实讲。** 「中文比英文费 token」在 DeepSeek 上实测是反过来的(15 对 21)。面试官很可能也知道这一点,你说错了比不说还糟。

**说自己没测过的数字。** 实验三里缓存把成本降到九分之一,但延迟看不出差别。面试时只说测到的那部分,「延迟也降了很多」这种话一追问就穿。

**temperature 设 0 就万事大吉。** 温度 0 也会有措辞差异,而且会稳定地给出同一个错答案。稳定性问题和正确性问题要分开看。

**在 system prompt 开头放时间戳或请求 ID。** 前缀缓存从第一个 token 开始比,开头每次不一样,后面再长也全部失效,练习 2 两次都是 0 命中。

**刷题每次都从头刷。** 会的反复答,不会的还是不会。记日志,只回炉没答好的。

**`int(input())` 不处理非法输入。** Python 的 `int("两分")` 直接抛 `ValueError`,不像 JS 的 `parseInt` 返回 `NaN`。读用户输入要先校验再转。

## 学习资料

### 文档与文章

- [DeepSeek · 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):实验三背后的机制,「缓存前缀单元」和命中规则看这里,15 分钟。
- [DeepSeek · JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode):JSON mode 的用法和注意事项,第 11 题用。
- [OpenAI · Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs):按 schema 约束解码是什么样,和 JSON mode 的区别,第 11 题的「第一层」。
- [Anthropic · Prompt engineering overview](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview):第 8 到 10 题的底子,面试前把目录过一遍。
- [Lost in the Middle](https://arxiv.org/abs/2307.03172) 和 [Chroma · Context Rot](https://research.trychroma.com/context-rot):第 4 题两个说法的出处,读摘要和图表即可。
- [Pydantic · Validation Errors](https://docs.pydantic.dev/latest/errors/validation_errors/):实验四里 `literal_error` 这类错误类型的完整列表。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1TZ421j7Ke&autoplay=0&high_quality=1" title="【官方双语】直观解释注意力机制,Transformer的核心 | 【深度学习第6章】" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>3Blue1Brown · 【官方双语】直观解释注意力机制,Transformer的核心 · 26 分钟,加 1、加 2 两题答不顺的,看完再答一遍。Q、K、V 那段动画比任何文字都清楚。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fcaN6fENi&autoplay=0&high_quality=1" title="到底什么是KV Cache,为啥不是QKV Cache,一个动画彻底搞懂!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>轩辕的编程宇宙 · 到底什么是KV Cache,为啥不是QKV Cache,一个动画彻底搞懂! · 13 分钟,2026 年发布,讲为什么只缓存 K 和 V 不缓存 Q,加 3 题最常见的追问。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ASuU6iEyH&autoplay=0&high_quality=1" title="腾讯AIAgent暑期实习一面" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>不转到大模型不改名 · 腾讯AIAgent暑期实习一面 · 约 38 分钟,2026 年 8 月发布的面试实录。边看边暂停,先自己答再听候选人怎么答;今天这套题之外的题,记下来留给后面三天。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7xTGNNLPyMI" title="Deep Dive into LLMs like ChatGPT" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · Deep Dive into LLMs like ChatGPT · 三个多小时,今天不用全看。tokenization、预训练、后训练、幻觉四段正好对应第 1、3、6 题,挑着看。</figcaption>
</figure>

### 书籍

- Jay Alammar、Maarten Grootendorst《Hands-On Large Language Models》(O'Reilly,2024):第 2 章 Tokens and Embeddings 补第 1 题,第 3 章讲 Transformer 内部,图多,加题部分的好材料。
- Sebastian Raschka《Build a Large Language Model (From Scratch)》(Manning,2024;中文版《从零构建大模型》,人民邮电出版社,2025):第 3 章从零写注意力,想把加 2 题答得更深的读这一章。
- Chip Huyen《AI Engineering》(O'Reilly,2025):第 2 章讲采样和结构化输出,第 5 章讲提示工程,对应今天第 2、8 到 11 题。

### 开源项目与代码

- [openai/tiktoken](https://github.com/openai/tiktoken):实验一用的 tokenizer 库,README 里有各个编码对应哪些模型。
- [karpathy/minbpe](https://github.com/karpathy/minbpe):几百行代码实现 BPE,想真正弄懂第 1 题「子词切分」的读它。
- [datawhalechina/happy-llm](https://github.com/datawhalechina/happy-llm):Datawhale 的中文大模型原理教程,Transformer 和预训练部分可以当加题的中文复习材料。

## 自测

1. 实验一里为什么要先发一条空消息?不减掉会怎样?

<details><summary>答案</summary>

每条消息外面都有聊天模板的固定开销(角色标记等),实测空消息也有 4 个 prompt_tokens。不减掉,中文 19 对英文 25 也能看出方向,但短句子里固定开销占比大,比例会失真,句子越短越明显。

</details>

2. 温度设成 0,同一个请求发 3 次,输出一定一样吗?实验二说明了什么?

<details><summary>答案</summary>

不一定。实验二三次里有一次措辞不同,服务端批处理和浮点计算顺序会带来微小差异,多数厂商不保证逐字复现。另外,温度 0 时模糊工单 5 次都分成 other,说明稳定和正确是两回事,要改的是类别定义。

</details>

3. 实验三里第二次请求为什么只命中 2176 个 token,而不是全部 2341 个?

<details><summary>答案</summary>

DeepSeek 按固定 token 间隔把前缀切成缓存前缀单元,只有完整的单元能命中。最后不满一个单元的那截 system 和每次不同的用户问题都算未命中。

</details>

4. 有人在 system prompt 第一行写「当前时间:2026-10-22 13:05:33」。这样做的代价是什么?怎么改?

<details><summary>答案</summary>

前缀缓存从第一个 token 开始逐块比对,开头每次都不同,后面再长也一个 token 都命中不了,练习 2 实测两次都是 0 命中,单次成本是命中时的九倍左右。改法是把时间放到最后的 user 消息里,只精确到需要的粒度(通常是日期)。

</details>

5. (面试题)「你们的 Agent 偶尔输出的 JSON 字段取值不对,你怎么处理?」用四步结构答。

<details><summary>答案</summary>

定义:这是结构化输出的取值合规问题,不是 JSON 格式问题。机制:分层处理,能用 schema 约束解码就用,否则 JSON mode 保证格式、pydantic 校验取值,失败把报错原文作为一条消息喂回去重试一两次,再失败走兜底。取舍:重试增加延迟和成本,所以先在 prompt 里写清楚允许的取值,从源头减少;兜底要选对业务安全的默认值,比如转人工。例子:我测过 priority 给成 urgent,pydantic 报 `Input should be 'low' or 'high'`,原文喂回去一次改对,一次重试花 ¥0.0004。

</details>

6. (面试题)「讲讲 KV cache。」面试官追问:「那为什么不缓存 Q?」

<details><summary>答案</summary>

生成新 token 时,只有新 token 需要用自己的 Q 去和前面所有 token 的 K 算相似度、再加权它们的 V。前面 token 的 Q 只在它们自己被生成的那一步用过,之后再也用不到,所以没必要缓存;而前面所有 token 的 K 和 V 每一步都要用,缓存它们才能省掉重算。

</details>

## 明天预告

Day 503 · 第 72 周复习:求职(Day 497–502)。这一周从代码审查 Agent 一路走到简历和第一套面试题,明天不加新东西,画一张本周知识地图,默写关键词计数、数字对账和门槛判断三段核心代码,再把它们拼成一个「投递前体检」小脚本:给一份简历和一份 JD,一次查完关键词覆盖、要点数字、门槛和 PDF。
