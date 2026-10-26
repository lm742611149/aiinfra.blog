---
title: 'Day 131 · 对话越聊越贵:平方级增长'
description: '先用 20 行不花钱的模拟算出「每轮多发一点,总量涨成平方」的直觉,再让云簿客服真聊 20 轮:每轮输入 token 从 287 涨到 885,累计 11780 个,公式 N×S + T×N(N−1)/2 算出 11720;DeepSeek 的前缀缓存命中 66%,实际账单 0.0115 元,没缓存要 0.0268 元;写一个只留最近 3 轮的 WindowChat,token 省了 39% 但模型忘了第 1 轮说的发票抬头,而且在缓存面前几乎没省钱;最后把实测的 S、T 代进公式,推到 200 轮和每月 5000 个会话的账。'
pubDate: 2026-10-23
regime: none
tags: ['api', 'cost', 'messages', 'cache', 'python', 'agent-zero']
series: 'agent-zero'
day: 131
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 130](/blog/agent-zero/day-130-system-prompt/) 把 system prompt 拆成身份、任务、规则、格式、背景五块,用对照实验看每一块缺了会怎样;规则要写成可执行的动作;机密不放进去;最后讲了「稳定的放前面、变化的放最后」才能命中缓存,用户名放最前面一个 token 都不命中,放最后命中 1920 个。

再往前一天,[Day 129](/blog/agent-zero/day-129-messages/) 留了一个数字:第一轮输入 20 个 token,第二轮 46 个。那时候说「每轮都在为之前的内容再付一次钱,Day 131 用 20 轮的曲线专门量」。今天就是那一天。

## 今天要解决的问题

学完今天,你应该能做到:

1. 不看文章,说出为什么多轮对话的输入 token 总量是「平方级」而不是线性的,并写出 `N × S + T × N(N−1)/2` 这个式子里每个字母的意思。
2. 跑出一条真实的 20 轮成本曲线:每轮输入多少、命中多少缓存、花多少钱,并用实测数字验证公式。
3. 写一个只保留最近几轮的 `WindowChat`(带测试),用实测说出它省了什么、丢了什么,以及为什么在 DeepSeek 的缓存面前它几乎没省钱。
4. 把实测的参数代进公式,估出 100 轮、200 轮,以及一家公司每月的对话账单,知道这笔钱是怎么长出来的。

今天的两个新概念:**累计 token 的平方级增长**和**滑动窗口裁剪**(只发最近几轮)。摘要压缩、按 token 预算做上下文这些更讲究的办法,[Day 262](/blog/agent-zero/day-262-context-budget/) 到 [Day 264](/blog/agent-zero/day-264-memory-short-long/) 才讲,今天只开个头。

预计用时:2.5 小时左右。实跑花费:两次 20 轮对话在 DeepSeek 上各约 0.012 元,练习里硅基流动一次约 0.03 元,全天约 0.07 元,算式在文末。前置:[Day 129](/blog/agent-zero/day-129-messages/) 的 `chat.py`、`chat_util.py`,[Day 130](/blog/agent-zero/day-130-system-prompt/) 的 `system_prompt.py`,[Day 124](/blog/agent-zero/day-124-cost/) 的 `common/cost.py`(`split_input`、`call_cost`),[Day 117](/blog/agent-zero/day-117-moe-kvcache/) 的 KV cache,[Day 50](/blog/agent-zero/day-050-dataclass/) 的 `dataclass` 继承。

学法提示:先对照文章把每个脚本逐行敲一遍(不要复制粘贴)并跑通;明天合上文章,默写 `WindowChat.payload` 和那个求和公式;然后做动手练习,做不出来再展开参考答案,看完关掉,自己重写一遍。

## 先用纸笔算:为什么是平方

回想 Day 129 的 `with_history.py`:第一轮发 1 条消息,第二轮发 3 条(上一轮的问、答,加这一轮的问)。第三轮发 5 条,第四轮 7 条。每一轮都把前面所有的话重发一遍,所以**每一轮发出去的 token 数,都比上一轮多一轮的量**。

记 system prompt 有 S 个 token,每轮新增(一问加一答)平均 T 个 token。那么:

- 第 1 轮输入 ≈ S + 一个问题
- 第 2 轮输入 ≈ S + T + 一个问题
- 第 n 轮输入 ≈ S + (n − 1) × T + 一个问题

把 N 轮加起来(先忽略每轮那个问题,它很小):

```text
总输入 ≈ N × S + T × (0 + 1 + 2 + … + (N−1)) = N × S + T × N(N−1)/2
```

第一项是线性的:system 每轮发一次,N 轮发 N 次。第二项里有 N 乘 N,这就是「平方级」。1 + 2 + … + (N−1) 这个和,你可以想成一个楼梯:第一级 1 块砖,第二级 2 块,一直到第 N−1 级;砖的总数是一个三角形的面积,底边 N、高 N,面积约 N²/2。

<figure>
<svg viewBox="0 0 640 230" role="img" aria-label="楼梯图:每一轮的输入 token 是一根柱子,柱子逐轮变高,所有柱子加起来是一个三角形的面积,三角形面积和轮数的平方成正比">
<rect x="0" y="0" width="640" height="230" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">每轮重发全部历史:第 n 轮 = S + (n−1)×T</text>
<g fill="var(--compute-wash)" stroke="var(--compute)">
<rect x="40" y="170" width="24" height="30"/><rect x="70" y="170" width="24" height="30"/><rect x="100" y="170" width="24" height="30"/><rect x="130" y="170" width="24" height="30"/><rect x="160" y="170" width="24" height="30"/><rect x="190" y="170" width="24" height="30"/><rect x="220" y="170" width="24" height="30"/><rect x="250" y="170" width="24" height="30"/>
</g>
<g fill="var(--mem-wash)" stroke="var(--mem)">
<rect x="70" y="154" width="24" height="16"/>
<rect x="100" y="138" width="24" height="32"/>
<rect x="130" y="122" width="24" height="48"/>
<rect x="160" y="106" width="24" height="64"/>
<rect x="190" y="90" width="24" height="80"/>
<rect x="220" y="74" width="24" height="96"/>
<rect x="250" y="58" width="24" height="112"/>
</g>
<line x1="70" y1="170" x2="274" y2="58" stroke="var(--mem)" stroke-dasharray="4 3"/>
<text x="40" y="218" fill="var(--ink-faint)">第1轮  第2轮  第3轮  第4轮  第5轮  第6轮  第7轮  第8轮</text>
<text x="300" y="60" fill="var(--compute)">琥珀色:system,每轮 S,共 N×S(线性)</text>
<text x="300" y="80" fill="var(--mem)">蓝色:历史,第 n 轮 (n−1)×T</text>
<text x="300" y="100" fill="var(--ink-soft)">蓝色面积 = 三角形 ≈ T × N²/2</text>
<text x="300" y="130" fill="var(--ink-soft)">轮数翻倍 → 蓝色面积约变 4 倍</text>
<text x="300" y="150" fill="var(--ink-soft)">聊得越久,每一轮都比上一轮贵一点,</text>
<text x="300" y="168" fill="var(--ink-soft)">加起来就是平方。</text>
</g>
</svg>
<figcaption>每一根柱子是一轮发出去的输入 token。琥珀色底座是 system prompt,每轮一样;蓝色部分是历史,一轮比一轮高。所有蓝色加起来是一个三角形,面积随轮数的平方增长。</figcaption>
</figure>

先不花钱,用一个 20 行的脚本把这个楼梯算出来。在 `agent-zero-lab` 根目录新建 `part02/quadratic_sim.py`,S 和 T 先随便假设一组数:

```python
# agent-zero-lab/part02/quadratic_sim.py
S = 300  # system prompt 的 token 数(假设)
T = 70  # 每轮新增的 token 数:一问加一答(假设)

total = 0
for n in range(1, 21):
    prompt = S + (n - 1) * T + 15
    total += prompt
    bar = "#" * (prompt // 50)
    print(f"第 {n:>2} 轮 输入 {prompt:>5} 累计 {total:>6} {bar}")

for rounds in (10, 20, 40, 80):
    tokens = sum(S + (n - 1) * T + 15 for n in range(1, rounds + 1))
    print(f"聊 {rounds:>2} 轮, 输入 token 合计 {tokens:>7}, 平均每轮 {tokens // rounds:>5}")
```

<div class="line-notes">

- `S = 300` 假设 system prompt 占 300 个 token。Day 130 的 `build_system` 实际大约 250 个,量级对。
- `T = 70` 假设每轮一问一答共 70 个 token。等会儿实测会发现云簿客服的回答很短,真实值只有 31 左右。
- `total = 0` 累计的输入 token。
- `for n in range(1, 21):` 第 1 轮到第 20 轮。
- `prompt = S + (n - 1) * T + 15` 第 n 轮发出去的 token:system,加前面 n−1 轮的历史,加这一轮 15 个 token 的问题。第 1 轮是 315,第 20 轮是 300 + 19 × 70 + 15 = 1645。
- `total += prompt` 累加。
- `bar = "#" * (prompt // 50)` 每 50 个 token 画一个 `#`,`//` 是整除。字符串乘以整数就是重复,[Day 15](/blog/agent-zero/day-015-strings-1/) 学的。
- `print(f"第 {n:>2} 轮 输入 {prompt:>5} 累计 {total:>6} {bar}")` `:>5` 右对齐、宽 5,柱子才能对齐。
- `for rounds in (10, 20, 40, 80):` 再看轮数翻倍时总量怎么变。
- `tokens = sum(S + (n - 1) * T + 15 for n in range(1, rounds + 1))` 生成器表达式求和,和上面的循环是同一个算式。
- `print(f"聊 {rounds:>2} 轮, 输入 token 合计 {tokens:>7}, 平均每轮 {tokens // rounds:>5}")` 平均每轮的输入也在涨,这是「平方」的另一种看法:平均值随 N 线性涨,总量 = 平均值 × N。

</div>

```bash
cd ~/agent-zero-lab
uv run python -m part02.quadratic_sim
```

```text
第  1 轮 输入   315 累计    315 ######
第  2 轮 输入   385 累计    700 #######
第  3 轮 输入   455 累计   1155 #########
第  4 轮 输入   525 累计   1680 ##########
第  5 轮 输入   595 累计   2275 ###########
第  6 轮 输入   665 累计   2940 #############
第  7 轮 输入   735 累计   3675 ##############
第  8 轮 输入   805 累计   4480 ################
第  9 轮 输入   875 累计   5355 #################
第 10 轮 输入   945 累计   6300 ##################
第 11 轮 输入  1015 累计   7315 ####################
第 12 轮 输入  1085 累计   8400 #####################
第 13 轮 输入  1155 累计   9555 #######################
第 14 轮 输入  1225 累计  10780 ########################
第 15 轮 输入  1295 累计  12075 #########################
第 16 轮 输入  1365 累计  13440 ###########################
第 17 轮 输入  1435 累计  14875 ############################
第 18 轮 输入  1505 累计  16380 ##############################
第 19 轮 输入  1575 累计  17955 ###############################
第 20 轮 输入  1645 累计  19600 ################################
聊 10 轮, 输入 token 合计    6300, 平均每轮   630
聊 20 轮, 输入 token 合计   19600, 平均每轮   980
聊 40 轮, 输入 token 合计   67200, 平均每轮  1680
聊 80 轮, 输入 token 合计   246400, 平均每轮  3080
```

看最后四行。10 轮到 20 轮,轮数翻倍,总量从 6300 到 19600,是 3.1 倍;20 到 40 是 3.4 倍;40 到 80 是 3.7 倍。越往后越接近 4 倍,因为线性的那一项(N × S)占比越来越小,平方的那一项越来越占主导。这就是「平方级」在数字上的样子:**轮数翻倍,钱差不多翻四倍**。

用公式验一下第 20 轮:20 × 300 + 70 × 20 × 19 / 2 = 6000 + 13300 = 19300,再加每轮 15 个 token 的问题共 300,正好 19600。

## 真聊 20 轮:每一轮的账

模拟只是算术。现在让 Day 130 的云簿客服真的聊 20 轮,把每一轮的输入 token、缓存命中、花费和耗时都记下来。对话是设计过的:第 1 轮用户报了两条只有他知道的信息(发票抬头、团队人数),中间 17 轮问各种产品问题,第 19、20 轮回头问第 1 轮说过的事。这样同一份对话既能量成本,又能检验「模型还记不记得」,后面裁剪历史时要用。

新建 `part02/cost_curve.py`:

```python
# agent-zero-lab/part02/cost_curve.py
import json
import os
import sys
import time
from datetime import date
from pathlib import Path

from openai.types import CompletionUsage
from openai.types.chat import ChatCompletionMessageParam

from common.cost import call_cost, parse_price, split_input
from part02.chat import Chat
from part02.chat_util import send, text_of
from part02.system_prompt import build_system
from part02.window_chat import WindowChat

PRICE = parse_price(os.environ["LLM_PRICE"])
TURNS = [
    "你好,我是小林。先记一下:我们的发票抬头是「杭州小林科技有限公司」,团队一共 6 个人。",
    "专业版年付多少钱?",
    "含几个成员席位?",
    "我们 6 个人,够用吗?",
    "超出的席位怎么加?",
    "退款政策是怎样的?",
    "我 40 天前买的,现在退能退多少?",
    "要是改成月付可以吗?",
    "发票一般多久能开出来?",
    "能开增值税专用发票吗?",
    "怎么导出上个月的账单?",
    "导出的文件是什么格式?",
    "忘记密码怎么办?",
    "能不能把账号转给同事?",
    "数据会保留多久?",
    "你们有手机 App 吗?",
    "今天几号?",
    "帮我总结一下我们刚才聊了哪些事。",
    "我们公司的发票抬头是什么?",
    "我们团队有几个人?我现在的套餐是什么?",
]


def run(chat: Chat, out: Path) -> None:
    usages: list[CompletionUsage] = []
    latencies: list[float] = []

    def recording_send(messages: list[ChatCompletionMessageParam]) -> tuple[str, int]:
        start = time.monotonic()
        resp = send(messages, max_tokens=150)
        latencies.append(time.monotonic() - start)
        assert resp.usage is not None
        usages.append(resp.usage)
        return text_of(resp), resp.usage.prompt_tokens

    rows: list[dict[str, object]] = []
    total = 0.0
    print(" 轮  发了  输入  命中  未命中  输出    本轮元     累计元   秒")
    for n, question in enumerate(TURNS, start=1):
        sent = len(chat.payload()) + 1
        answer = chat.ask(question, recording_send)
        usage = usages[-1]
        hit, miss = split_input(usage)
        cost = call_cost(usage, PRICE)
        total += cost
        rows.append({"n": n, "sent": sent, "prompt": usage.prompt_tokens, "hit": hit, "miss": miss,
                     "completion": usage.completion_tokens, "cost": cost, "latency": latencies[-1],
                     "question": question, "answer": answer})
        print(f"{n:>3} {sent:>5} {usage.prompt_tokens:>5} {hit:>5} {miss:>7} {usage.completion_tokens:>5} "
              f"{cost:>9.6f} {total:>9.6f} {latencies[-1]:>5.2f}")
    print(f"输入 token 合计 {sum(r['prompt'] for r in rows)}, 输出合计 {sum(r['completion'] for r in rows)}")  # type: ignore[misc]
    print(f"最后两轮的回答:\n  19: {rows[-2]['answer']}\n  20: {rows[-1]['answer']}")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"已存到 {out}")


def main() -> None:
    system = build_system(date(2026, 10, 23), "小林", "专业版年付")
    args = sys.argv[1:]
    keep = int(args[args.index("--window") + 1]) if "--window" in args else None
    default = "data/cost_curve.json" if keep is None else f"data/cost_curve_w{keep}.json"
    out = Path(args[args.index("--out") + 1]) if "--out" in args else Path(default)
    chat = Chat(system=system) if keep is None else WindowChat(system=system, keep_turns=keep)
    run(chat, out)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `from openai.types import CompletionUsage` `usage` 对象的类型,Day 124 用过。
- `from common.cost import call_cost, parse_price, split_input` Day 124 的三个函数:解析价格、拆命中未命中、算一次的钱。
- `from part02.chat import Chat` Day 129 的聊天类,管历史。
- `from part02.chat_util import send, text_of` Day 129 的发送(带 Day 127 的重试)和取文字。
- `from part02.system_prompt import build_system` Day 130 的 system 拼装函数。
- `from part02.window_chat import WindowChat` 今天下一节才写的类。先把这一行写上,等会儿文件建好就能跑;你如果现在就跑会报 `ModuleNotFoundError`,先把下一节的 `window_chat.py` 建好再回来。
- `PRICE = parse_price(os.environ["LLM_PRICE"])` `.env` 里的 `0.04,2,8`(命中、未命中、输出,元每百万 token)。`os.environ` 里有它,是因为 `chat_util` 被 import 时已经 `load_dotenv` 过了。
- `TURNS = [` 20 句用户的话。第 1 句报了发票抬头和团队人数,这两条 system 里没有,只有历史里有。
- `"帮我总结一下我们刚才聊了哪些事。",` 第 18 句故意让它输出长一点,看输出长度对下一轮输入的影响。
- `"我们公司的发票抬头是什么?",` 第 19 句回头考第 1 句的内容。
- `def run(chat: Chat, out: Path) -> None:` 收一个 `Chat`(或者它的子类),跑完 20 轮,把结果存到 `out`。
- `usages: list[CompletionUsage] = []` 每轮的 `usage` 存起来。`Chat.ask` 要的 `send` 只返回(文字,输入 token),拿不到命中数,所以用一个闭包把 `usage` 偷偷记到外面的列表里。
- `def recording_send(messages: list[ChatCompletionMessageParam]) -> tuple[str, int]:` 符合 Day 129 `Send` 类型的函数,多做一件事:记录。
- `start = time.monotonic()` 计时开始。`monotonic` 是只会往前走的钟,量耗时用它,Day 128 用过。
- `resp = send(messages, max_tokens=150)` 真正发请求,最多 150 个输出 token。
- `latencies.append(time.monotonic() - start)` 记下这一轮用了几秒。
- `usages.append(resp.usage)` 记下这一轮的 `usage`。
- `return text_of(resp), resp.usage.prompt_tokens` 按 `Send` 的约定返回。
- `rows: list[dict[str, object]] = []` 每轮一行,最后存成 JSON,练习和下一个脚本要读它。
- `print(" 轮  发了  输入  命中  未命中  输出    本轮元     累计元   秒")` 表头。
- `for n, question in enumerate(TURNS, start=1):` 逐轮。
- `sent = len(chat.payload()) + 1` 这一轮会发几条消息:当前的完整列表加上这一句。先于 `ask` 算,因为 `ask` 之后列表又多了两条。
- `answer = chat.ask(question, recording_send)` 问一句。历史的追加、失败回滚都是 Day 129 写好的。
- `usage = usages[-1]` 刚才那一轮的 `usage`。
- `hit, miss = split_input(usage)` 拆成命中缓存的和没命中的。
- `cost = call_cost(usage, PRICE)` 这一轮的钱。
- `rows.append({"n": n, "sent": sent` 把这一轮的所有数字和问答原文存进字典。
- `print(f"{n:>3} {sent:>5} {usage.prompt_tokens:>5}` 一行一轮。
- `print(f"输入 token 合计 {sum(r['prompt'] for r in rows)}` 20 轮加起来。末尾的 `# type: ignore[misc]` 是告诉类型检查器:字典的值我声明成了 `object`,它不知道 `r['prompt']` 能相加,这里我保证是整数。
- `print(f"最后两轮的回答:\n  19: {rows[-2]['answer']}\n  20: {rows[-1]['answer']}")` 第 19、20 轮的回答打印出来,检查记不记得第 1 轮。
- `out.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")` 存 JSON,[Day 39](/blog/agent-zero/day-039-json/) 的写法。
- `def main() -> None:` 命令行:不带参数是全历史;`--window 3` 是只留最近 3 轮;`--out 路径` 指定存到哪。
- `args = sys.argv[1:]` 命令行参数列表,Day 125 用过。
- `keep = int(args[args.index("--window") + 1]) if "--window" in args else None` 有 `--window` 就取它后面那个数,没有就是 `None`。`list.index` 返回某一项的下标。
- `default = "data/cost_curve.json" if keep is None else f"data/cost_curve_w{keep}.json"` 默认文件名,带窗口的加 `_w3` 这种后缀。
- `chat = Chat(system=system) if keep is None else WindowChat(system=system, keep_turns=keep)` 两种聊天对象,`run` 不关心是哪种,这是继承的好处。
- `if __name__ == "__main__":` 练习里要 `import` 这个文件的 `TURNS`,所以加 main guard。

</div>

先把下一节的 `window_chat.py` 建好(或者暂时把那行 import 和 `main` 里的 `WindowChat` 删掉),然后跑全历史的版本:

```bash
uv run python -m part02.cost_curve
```

实跑输出(10 月 23 日下午,DeepSeek 高峰价):

```text
 轮  发了  输入  命中  未命中  输出    本轮元     累计元   秒
  1     2   287   128     159    46  0.000691  0.000691  1.05
  2     4   343   128     215    17  0.000571  0.001262  0.55
  3     6   369   128     241    10  0.000567  0.001829  0.68
  4     8   393   256     137    24  0.000476  0.002306  0.72
  5    10   427   256     171    15  0.000472  0.002778  0.90
  6    12   450   256     194    56  0.000846  0.003624  0.78
  7    14   524   384     140    18  0.000439  0.004063  0.96
  8    16   553   384     169    19  0.000505  0.004569  0.93
  9    18   583   384     199     8  0.000477  0.005046  0.69
 10    20   602   384     218     8  0.000515  0.005562  0.41
 11    22   620   384     236    15  0.000607  0.006169  0.91
 12    24   645   384     261     8  0.000601  0.006770  0.72
 13    26   661   512     149     8  0.000382  0.007153  0.88
 14    28   680   512     168     8  0.000420  0.007573  0.45
 15    30   697   512     185     8  0.000454  0.008028  0.60
 16    32   716   512     204     8  0.000492  0.008520  0.76
 17    34   732   512     220    15  0.000580  0.009101  0.55
 18    36   761   512     249    81  0.001166  0.010267  1.72
 19    38   852   640     212    19  0.000602  0.010869  0.54
 20    40   885   640     245    15  0.000636  0.011504  0.82
输入 token 合计 11780, 输出合计 406
最后两轮的回答:
  19: 你提供的是「杭州小林科技有限公司」，这条信息我需要转给人工同事确认并记录。
  20: 你团队 6 人，当前套餐是专业版年付。
已存到 data/cost_curve.json
```

一列一列读。

**「发了」列**:2、4、6……40,每轮多 2 条(上一轮的问和答),和 Day 129 一样。

**「输入」列**:287 涨到 885,这是今天的主角。每轮大约多 30 个 token,偶尔跳一下:第 7 轮从 450 跳到 524,是因为第 6 轮的回答有 56 个 token;第 19 轮从 761 跳到 852,是第 18 轮那个「总结」回答了 81 个。**上一轮输出得越多,下一轮输入就越贵**,输出的 token 下一轮就变成了输入。

**「命中」列**:128、256、384、512、640,一级一级地涨。每一轮的开头(system 加历史)和上一轮完全一样,所以上一轮的大部分内容这一轮都命中缓存了。命中数总是 128 的整数倍,Day 124 和 Day 130 都见过。第 1 轮就命中了 128,是因为同一段 system 昨天跑 Day 130 时已经发过很多次,DeepSeek 文档说缓存「不再使用后会自动清空,一般为几个小时到几天」,它还在。

**「未命中」列**:基本在 140 到 260 之间晃,没有随轮数涨。这一列才是真正按贵价(2 元/百万)算的部分,内容是「上一轮的回答 + 这一轮的问题 + 不满 128 的零头」。

**「本轮元」列**:0.0004 到 0.0012 之间,也没有明显涨。原因在上一条:输入里贵的那部分没涨,涨的部分走的是 0.04 元的命中价,是贵价的 1/50。

**「秒」列**:0.4 到 1.7 秒,和轮数关系不大。885 个 token 对模型来说还很短,读输入(预填充)的时间可以忽略,时间主要花在生成输出上。几万 token 的对话才会明显变慢,那是第四部分的事。

**最后两轮**:第 19 轮答出了「杭州小林科技有限公司」,第 20 轮答出了「6 人」「专业版年付」。历史全在,模型就记得。

## 用公式对一下账

`cost_curve.json` 存下了每轮的数字。写 `part02/cost_model.py`,从数据里估出 S 和 T,用公式算一遍和实测比,再算「如果没有缓存要花多少」:

```python
# agent-zero-lab/part02/cost_model.py
import json
import os
from pathlib import Path

from common.cost import parse_price

PRICE = parse_price(os.environ.get("LLM_PRICE", "0.04,2,8"))
rows = json.loads(Path("data/cost_curve.json").read_text(encoding="utf-8"))
prompts = [r["prompt"] for r in rows]
N = len(rows)

S = prompts[0]
T = (prompts[-1] - prompts[0]) / (N - 1)
print(f"实测: 第 1 轮输入 {S} 个 token, 第 {N} 轮 {prompts[-1]} 个, 平均每轮多 {T:.1f} 个")


def formula_total(rounds: int) -> float:
    return rounds * S + T * rounds * (rounds - 1) / 2


measured = sum(prompts)
print(f"{N} 轮输入 token 合计: 实测 {measured}, 公式 N×S + T×N(N−1)/2 = {formula_total(N):.0f}")

hits = sum(r["hit"] for r in rows)
misses = sum(r["miss"] for r in rows)
outs = sum(r["completion"] for r in rows)
with_cache = (hits * PRICE.hit + misses * PRICE.miss + outs * PRICE.out) / 1_000_000
no_cache = ((hits + misses) * PRICE.miss + outs * PRICE.out) / 1_000_000
print(f"命中 {hits} + 未命中 {misses} = 输入 {hits + misses}; 输出 {outs}")
print(f"实际账单 {with_cache:.4f} 元; 假如没有缓存 {no_cache:.4f} 元; 缓存省了 {1 - with_cache / no_cache:.0%}")

print("\n按实测的 S、T 往后推(只算输入 token, 按未命中价 2 元/百万):")
print(" 轮数    输入token合计   平均每轮    无缓存元")
for rounds in (10, 20, 50, 100, 200):
    tokens = formula_total(rounds)
    print(f"{rounds:>4} {tokens:>14.0f} {tokens / rounds:>10.0f} {tokens * PRICE.miss / 1_000_000:>10.4f}")
```

<div class="line-notes">

- `PRICE = parse_price(os.environ.get("LLM_PRICE", "0.04,2,8"))` 这个脚本不发请求,没有 import `chat_util`,所以 `.env` 没被读;给一个默认值,和 `.env` 里一样。
- `rows = json.loads(Path("data/cost_curve.json").read_text(encoding="utf-8"))` 读回 20 行。
- `prompts = [r["prompt"] for r in rows]` 20 个输入 token 数:`[287, 343, …, 885]`。
- `S = prompts[0]` 把第 1 轮的输入当 S。严格说它多了一个问题的 token,但公式里每轮都多这一点,正好抵掉。实测 287。
- `T = (prompts[-1] - prompts[0]) / (N - 1)` 首尾相减除以间隔数,得到平均每轮增加多少:(885 − 287) / 19 = 31.5。
- `def formula_total(rounds: int) -> float:` 就是上面那个式子。
- `return rounds * S + T * rounds * (rounds - 1) / 2` N = 20 时:20 × 287 + 31.5 × 20 × 19 / 2 = 5740 + 5985 = 11725(浮点后显示 11720 左右)。
- `measured = sum(prompts)` 实测合计 11780。
- `hits = sum(r["hit"] for r in rows)` 20 轮命中的总数,7808。
- `misses = sum(r["miss"] for r in rows)` 未命中总数,3972。
- `with_cache = (hits * PRICE.hit + misses * PRICE.miss + outs * PRICE.out) / 1_000_000` Day 124 的算式,三种 token 三个单价:(7808 × 0.04 + 3972 × 2 + 406 × 8) / 1,000,000 = (312 + 7944 + 3248) / 1,000,000 ≈ 0.0115。
- `no_cache = ((hits + misses) * PRICE.miss + outs * PRICE.out) / 1_000_000` 假如厂商没有缓存:全部输入按 2 元算,(11780 × 2 + 406 × 8) / 1,000,000 = 0.0268。
- `print(f"实际账单 {with_cache:.4f} 元; 假如没有缓存 {no_cache:.4f} 元; 缓存省了 {1 - with_cache / no_cache:.0%}")` 1 − 0.0115 / 0.0268 = 57%。
- `for rounds in (10, 20, 50, 100, 200):` 用实测参数往后推。
- `print(f"{rounds:>4} {tokens:>14.0f} {tokens / rounds:>10.0f} {tokens * PRICE.miss / 1_000_000:>10.4f}")` 轮数、总 token、平均每轮、按贵价算的钱。

</div>

```bash
uv run python -m part02.cost_model
```

```text
实测: 第 1 轮输入 287 个 token, 第 20 轮 885 个, 平均每轮多 31.5 个
20 轮输入 token 合计: 实测 11780, 公式 N×S + T×N(N−1)/2 = 11720
命中 7808 + 未命中 3972 = 输入 11780; 输出 406
实际账单 0.0115 元; 假如没有缓存 0.0268 元; 缓存省了 57%

按实测的 S、T 往后推(只算输入 token, 按未命中价 2 元/百万):
 轮数    输入token合计   平均每轮    无缓存元
  10           4286        429     0.0086
  20          11720        586     0.0234
  50          52905       1058     0.1058
 100         184495       1845     0.3690
 200         683726       3419     1.3675
```

三件事。

**公式对得上。** 实测 11780,公式 11720,差 0.5%。差的那点是因为每轮的增量不是正好 31.5(有一轮回答 81 个)。两个参数都是从真实数据里读出来的,不是我拍的。

**缓存把平方变得没那么可怕。** 同样 11780 个输入 token,有缓存 0.0115 元,没缓存 0.0268 元。而且仔细看,命中的 7808 个只花了 0.0003 元,几乎白送;贵的是那 3972 个未命中(0.0079 元)和 406 个输出(0.0032 元)。换句话说,**在 DeepSeek 上,一段多轮对话的钱主要花在「每轮新出现的内容」上,历史重发的部分很便宜**。这是前缀缓存设计出来的效果,不是所有厂商都这样(练习 2 会在硅基流动上看到另一番景象)。

**没有缓存时,平方级真的很吓人。** 看推算表的最后一列:20 轮 0.023 元,200 轮 1.37 元,轮数是 10 倍,钱是 58 倍。一个用户聊 200 轮不常见,但一个 Agent 自己跟自己「聊」200 轮(每调一次工具就是一轮,第三部分讲)很常见。到那时候这张表就是你的账单。

## 只发最近几轮:WindowChat

最直接的办法是别把全部历史都发,只发最近 K 轮,叫**滑动窗口**。Day 129 的 `Chat` 把「这次要发出去的列表」放在 `payload()` 一个方法里,正好只改它。新建 `part02/window_chat.py`:

```python
# agent-zero-lab/part02/window_chat.py
from dataclasses import dataclass

from openai.types.chat import ChatCompletionMessageParam

from part02.chat import Chat


@dataclass
class WindowChat(Chat):
    keep_turns: int = 3

    def payload(self) -> list[ChatCompletionMessageParam]:
        head: list[ChatCompletionMessageParam] = []
        if self.system is not None:
            head.append({"role": "system", "content": self.system})
        tail = self.messages[-(2 * self.keep_turns + 1):]
        if tail and tail[0]["role"] == "assistant":
            tail = tail[1:]
        return head + tail

    def dropped(self) -> int:
        return len(self.messages) - (len(self.payload()) - (1 if self.system is not None else 0))
```

<div class="line-notes">

- `@dataclass` 子类加了新字段,要再写一遍 `@dataclass`,Day 130 练习 5 的 `DynamicChat` 也是这样。
- `class WindowChat(Chat):` 继承 Day 129 的 `Chat`:`ask`、`reset`、失败回滚全都原样拿来,只换 `payload`。
- `keep_turns: int = 3` 保留最近几轮,默认 3。一轮是一条 user 加一条 assistant。
- `def payload(self) -> list[ChatCompletionMessageParam]:` 覆盖父类的方法。`ask` 里调用 `self.payload()` 时会走到这里,这是继承里的「多态」:父类的代码,子类的行为。
- `head: list[ChatCompletionMessageParam] = []` system 永远发,不在窗口的计算范围内。
- `tail = self.messages[-(2 * self.keep_turns + 1):]` 取最后 2K + 1 条。`ask` 调用 `payload` 的时候,刚追加的那条 user 还没有回答,所以列表里是 [u, a, u, a, …, u],2K + 1 条正好是「最近 K 个完整的轮 + 当前这个问题」。K = 3 时是最后 7 条。列表比 7 短时,切片就是整个列表,没有报错。
- `if tail and tail[0]["role"] == "assistant":` 在 `ask` 之外调用 `payload`(比如 Day 129 CLI 的 `/history`),列表长度是偶数,切 7 条会从一条 assistant 开头。Day 129 讲过:**不能把一对消息拆开**,所以要检查。
- `tail = tail[1:]` 掉头那条没有问题的回答。
- `return head + tail` 拼起来。注意 `self.messages` 本身一个字都没删,只是发出去的时候少发。完整历史留着,存盘、撤销、以后做摘要都用得上。
- `def dropped(self) -> int:` 这一次没发的消息有几条,打印用。
- `return len(self.messages) - (len(self.payload()) - (1 if self.system is not None else 0))` 全部减去发出去的(不算 system)。

</div>

写测试钉住它,新建 `tests/test_window_chat.py`:

```python
# agent-zero-lab/tests/test_window_chat.py
from openai.types.chat import ChatCompletionMessageParam

from part02.chat import Send
from part02.window_chat import WindowChat


def make_send(seen: list[list[ChatCompletionMessageParam]]) -> Send:
    def send(messages: list[ChatCompletionMessageParam]) -> tuple[str, int]:
        seen.append(list(messages))
        return f"答{len(seen)}", len(messages)

    return send


def roles(messages: list[ChatCompletionMessageParam]) -> list[str]:
    return [m["role"] for m in messages]


def test_early_turns_are_all_sent() -> None:
    seen: list[list[ChatCompletionMessageParam]] = []
    chat = WindowChat(system="客服", keep_turns=2)
    send = make_send(seen)
    chat.ask("问1", send)
    chat.ask("问2", send)
    chat.ask("问3", send)
    assert roles(seen[2]) == ["system", "user", "assistant", "user", "assistant", "user"]


def test_window_drops_oldest_whole_turns() -> None:
    seen: list[list[ChatCompletionMessageParam]] = []
    chat = WindowChat(system="客服", keep_turns=2)
    send = make_send(seen)
    for i in range(5):
        chat.ask(f"问{i + 1}", send)
    assert roles(seen[4]) == ["system", "user", "assistant", "user", "assistant", "user"]
    assert seen[4][1].get("content") == "问3"
    assert seen[4][-1].get("content") == "问5"
    assert chat.dropped() == 6


def test_payload_never_starts_with_assistant() -> None:
    chat = WindowChat(keep_turns=1)
    send = make_send([])
    chat.ask("问1", send)
    chat.ask("问2", send)
    assert roles(chat.payload()) == ["user", "assistant"]
    assert chat.payload()[0].get("content") == "问2"


def test_full_history_is_still_kept() -> None:
    chat = WindowChat(keep_turns=1)
    send = make_send([])
    for i in range(4):
        chat.ask(f"问{i + 1}", send)
    assert len(chat.messages) == 8
    assert chat.input_tokens == [1, 3, 3, 3]
```

<div class="line-notes">

- `def make_send(seen: list[list[ChatCompletionMessageParam]]) -> Send:` 和 Day 129 测试里一样的假 `send`,把每次收到的列表复制一份记下来,返回的「token 数」就是消息条数,方便断言。
- `def roles(messages: list[ChatCompletionMessageParam]) -> list[str]:` 取出角色列表,下面要比好几次。
- `def test_early_turns_are_all_sent() -> None:` K = 2,聊 3 轮:第 3 轮发的是前 2 轮加当前问题,一条不少。
- `assert roles(seen[2]) == ["system", "user", "assistant", "user", "assistant", "user"]` 第 3 次发送(下标 2)的 6 条。
- `def test_window_drops_oldest_whole_turns() -> None:` 聊 5 轮,第 5 轮应该只带第 3、4 轮。
- `assert seen[4][1].get("content") == "问3"` 第 5 次发送里,system 后面第一条是「问3」,「问1」「问2」被整轮丢掉了。
- `assert chat.dropped() == 6` 5 轮聊完,历史 10 条,`payload` 只带最近 2 轮共 4 条,所以丢了 6 条。
- `def test_payload_never_starts_with_assistant() -> None:` K = 1,聊 2 轮后在 `ask` 之外调 `payload`:切 3 条会从「答1」开头,应该被掉头,只剩第 2 轮。
- `def test_full_history_is_still_kept() -> None:` 窗口只影响发出去的,`messages` 里 8 条都在;`input_tokens` 记录的是每次真正发出去的条数:第 1 轮 1 条,之后每轮 3 条。

</div>

```bash
uv run pytest tests/test_window_chat.py -q
```

```text
....                                                                     [100%]
4 passed in 0.61s
```

我第一次写 `dropped` 的断言时写的是 4,想当然地觉得「5 轮留 2 轮,丢 3 轮里的……」,算错了:5 轮聊完是 10 条,留最近 2 轮是 4 条,丢 6 条。测试红了一次,把我拉回来数了一遍。这种「几条几轮」的边界,靠测试比靠脑子可靠。

现在用同一份 20 轮对话跑窗口版本:

```bash
uv run python -m part02.cost_curve --window 3
```

```text
 轮  发了  输入  命中  未命中  输出    本轮元     累计元   秒
  1     2   287   128     159    53  0.000747  0.000747  0.94
  2     4   350   128     222    17  0.000585  0.001332  0.74
  3     6   376   128     248    10  0.000581  0.001913  0.60
  4     8   400   256     144    37  0.000594  0.002508  0.92
  5     8   364   128     236    27  0.000693  0.003201  0.98
  6     8   372   128     244    48  0.000877  0.004078  0.85
  7     8   419   256     163    45  0.000696  0.004774  0.76
  8     8   424   256     168    30  0.000586  0.005360  0.84
  9     8   428   256     172     7  0.000410  0.005771  0.80
 10     8   390   256     134     7  0.000334  0.006105  0.58
 11     8   344   128     216     7  0.000493  0.006598  0.73
 12     8   320   128     192     7  0.000445  0.007043  0.46
 13     8   317   128     189     7  0.000439  0.007482  0.60
 14     8   317   128     189     7  0.000439  0.007921  0.60
 15     8   316   128     188     7  0.000437  0.008358  0.61
 16     8   317   128     189     7  0.000439  0.008798  0.75
 17     8   317   128     189    18  0.000527  0.009325  1.29
 18     8   331   128     203    48  0.000795  0.010120  0.70
 19     8   373   128     245     7  0.000551  0.010671  0.53
 20     8   376   128     248    30  0.000741  0.011412  0.79
输入 token 合计 7138, 输出合计 426
最后两轮的回答:
  19: 这个问题我需要转给人工同事确认
  20: 您的套餐是专业版年付，含 5 个成员席位。团队实际人数我这边看不到，需要转给人工同事确认。
已存到 data/cost_curve_w3.json
```

和全历史那份并排看:

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="20 轮对话每轮输入 token 的柱状图:全历史的柱子从 287 一路涨到 885,只留最近 3 轮的柱子从第 5 轮起停在 320 到 430 之间">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)" rx="6"/>
<g font-family="var(--font-mono)" font-size="11">
<line x1="55" y1="200" x2="605" y2="200" stroke="var(--rule)"/>
<line x1="55" y1="30" x2="55" y2="200" stroke="var(--rule)"/>
<text x="20" y="44" fill="var(--ink-faint)">900</text>
<text x="20" y="122" fill="var(--ink-faint)">450</text>
<text x="30" y="204" fill="var(--ink-faint)">0</text>
<g fill="var(--mem-wash)" stroke="var(--mem)">
<rect x="60" y="149" width="12" height="51"/><rect x="87" y="139" width="12" height="61"/><rect x="114" y="134" width="12" height="66"/><rect x="141" y="130" width="12" height="70"/><rect x="168" y="124" width="12" height="76"/><rect x="195" y="120" width="12" height="80"/><rect x="222" y="107" width="12" height="93"/><rect x="249" y="102" width="12" height="98"/><rect x="276" y="96" width="12" height="104"/><rect x="303" y="93" width="12" height="107"/><rect x="330" y="90" width="12" height="110"/><rect x="357" y="85" width="12" height="115"/><rect x="384" y="82" width="12" height="118"/><rect x="411" y="79" width="12" height="121"/><rect x="438" y="76" width="12" height="124"/><rect x="465" y="73" width="12" height="127"/><rect x="492" y="70" width="12" height="130"/><rect x="519" y="65" width="12" height="135"/><rect x="546" y="49" width="12" height="151"/><rect x="573" y="43" width="12" height="157"/>
</g>
<g fill="var(--compute-wash)" stroke="var(--compute)">
<rect x="73" y="149" width="12" height="51"/><rect x="100" y="138" width="12" height="62"/><rect x="127" y="133" width="12" height="67"/><rect x="154" y="129" width="12" height="71"/><rect x="181" y="135" width="12" height="65"/><rect x="208" y="134" width="12" height="66"/><rect x="235" y="126" width="12" height="74"/><rect x="262" y="125" width="12" height="75"/><rect x="289" y="124" width="12" height="76"/><rect x="316" y="131" width="12" height="69"/><rect x="343" y="139" width="12" height="61"/><rect x="370" y="143" width="12" height="57"/><rect x="397" y="144" width="12" height="56"/><rect x="424" y="144" width="12" height="56"/><rect x="451" y="144" width="12" height="56"/><rect x="478" y="144" width="12" height="56"/><rect x="505" y="144" width="12" height="56"/><rect x="532" y="141" width="12" height="59"/><rect x="559" y="134" width="12" height="66"/><rect x="586" y="133" width="12" height="67"/>
</g>
<text x="60" y="222" fill="var(--ink-faint)">第1轮</text>
<text x="300" y="222" fill="var(--ink-faint)">第10轮</text>
<text x="560" y="222" fill="var(--ink-faint)">第20轮</text>
<text x="80" y="58" fill="var(--mem)">蓝:全部历史,287 → 885,合计 11780</text>
<text x="80" y="76" fill="var(--compute)">琥珀:只留最近 3 轮,第 5 轮起持平,合计 7138</text>
<text x="80" y="244" fill="var(--ink-faint)">纵轴:每轮输入 token(实测)。第 18 轮的长回答让第 19 轮两边都跳了一下。</text>
</g>
</svg>
<figcaption>同一份 20 轮对话,实测每轮输入 token。蓝柱每轮都比上一轮高,是楼梯;琥珀柱从第 5 轮起就不再涨了,因为发出去的永远只有 system 加最近 3 轮。</figcaption>
</figure>

**省了什么**:输入 token 从 11780 降到 7138,少了 39%。「发了」列从第 4 轮起就定在 8 条,「输入」列在 320 到 430 之间来回,不再涨。聊 200 轮它也还是这么多,平方变成了线性。

**丢了什么**:第 19 轮「发票抬头是什么」,模型答「需要转给人工同事确认」;第 20 轮套餐答对了(因为 system 的背景里写着),团队人数答「看不到」。第 1 轮说的话早被窗口推出去了。**用户会觉得:我刚才明明告诉过你。**这是滑动窗口最大的代价,早期的关键信息(订单号、用户报的事实)会丢。所以真实产品里不会单独用它,而是把这类信息抽出来放进 system 的背景(Day 130 的 `background` 就是干这个的),或者先做摘要再裁(Day 263)。

**钱呢**:全历史 0.0115 元,窗口 0.0114 元,基本没差。这是我跑之前没想到的。原因回到上一节:在 DeepSeek 上,重发的历史几乎都命中缓存,按 0.04 元算,省掉它们省不了几个钱;而窗口版的「未命中」列并没有变小(每轮新出现的内容一样多),输出还多了 20 个 token。**窗口省的是 token 和上下文长度,在有前缀缓存的厂商那里不怎么省钱。**要省钱,先看你的厂商有没有缓存、命中多少。

这个结论在没有缓存、或者缓存不稳定的厂商上就反过来了,练习 2 用硅基流动跑同一份对话,你会看到窗口的钱真的省下来。

## 改动历史,缓存就断

Day 130 结尾说过「历史要原样放回去」。今天有了 20 轮的对话,正好验证一下改动历史会怎样。这段代码放在练习 5,这里先说结论:把第 1 轮助手的回答改一个字,再发同一个问题,命中从 768 掉到 256,只剩 system 那一段还命中。缓存是从头逐字比对的,改动点之后的全部历史都要重新按贵价算。所以「脱敏」「润色历史」「把早期回答换成摘要」这些操作,都要知道它会让那一轮的缓存失效;一次性的还好,每轮都改,缓存就等于没有。

### 零件 → 大代码对照

| 零件 | 在 `cost_curve.py` / `window_chat.py` 的哪一段 |
| --- | --- |
| 楼梯求和公式(`quadratic_sim.py`) | `cost_model.py` 的 `formula_total` |
| 每轮记录 `usage`(闭包) | `cost_curve.run` 里的 `recording_send` 和 `usages` 列表 |
| 拆命中 / 算钱(Day 124) | `split_input(usage)`、`call_cost(usage, PRICE)` |
| 历史管理(Day 129 `Chat`) | `chat.ask(question, recording_send)` |
| 只发最近几轮 | `WindowChat.payload` 的切片和掉头 |
| 不拆开一对消息(Day 129) | `WindowChat.payload` 里的 `if tail[0]["role"] == "assistant"` |
| system 稳定放前面(Day 130) | `build_system` 不变,所以每轮都命中它 |

## 动手练习

**练习 1:把两条曲线画在终端里。** 不调 API,写 `part02/ascii_bars.py`,读 `data/cost_curve.json` 和 `data/cost_curve_w3.json`,每轮一行,左边是全历史的柱子,右边是窗口版的,末尾打印两份的 token 合计和花费合计。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/ascii_bars.py
import json
from pathlib import Path

full = json.loads(Path("data/cost_curve.json").read_text(encoding="utf-8"))
window = json.loads(Path("data/cost_curve_w3.json").read_text(encoding="utf-8"))
SCALE = 20  # 一个 # 代表 20 个 token

print(" 轮  全部历史                                           只留 3 轮")
for a, b in zip(full, window):
    left = "#" * (a["prompt"] // SCALE)
    right = "#" * (b["prompt"] // SCALE)
    print(f"{a['n']:>3}  {left:<46} {a['prompt']:>4} │ {right:<22} {b['prompt']:>4}")
print(f"合计 {sum(r['prompt'] for r in full):>5} 对 {sum(r['prompt'] for r in window):>5} 个输入 token")
print(f"花费 {sum(r['cost'] for r in full):.4f} 对 {sum(r['cost'] for r in window):.4f} 元")
```

<div class="line-notes">

- `full = json.loads(Path("data/cost_curve.json").read_text(encoding="utf-8"))` 读全历史那份。
- `SCALE = 20` 每 20 个 token 一个 `#`,885 个就是 44 个字符,放得下。
- `for a, b in zip(full, window):` `zip` 把两个列表按位置配对,[Day 22](/blog/agent-zero/day-022-tuples-unpack/) 学过。
- `left = "#" * (a["prompt"] // SCALE)` 左边的柱子。
- `print(f"{a['n']:>3}  {left:<46} {a['prompt']:>4} │ {right:<22} {b['prompt']:>4}")` `:<46` 左对齐、宽 46,右边那列才不会歪。

</div>

```bash
uv run python -m part02.ascii_bars
```

```text
 轮  全部历史                                           只留 3 轮
  1  ##############                                  287 │ ##############          287
  2  #################                               343 │ #################       350
  3  ##################                              369 │ ##################      376
  4  ###################                             393 │ ####################    400
  5  #####################                           427 │ ##################      364
  6  ######################                          450 │ ##################      372
  7  ##########################                      524 │ ####################    419
  8  ###########################                     553 │ #####################   424
  9  #############################                   583 │ #####################   428
 10  ##############################                  602 │ ###################     390
 11  ###############################                 620 │ #################       344
 12  ################################                645 │ ################        320
 13  #################################               661 │ ###############         317
 14  ##################################              680 │ ###############         317
 15  ##################################              697 │ ###############         316
 16  ###################################             716 │ ###############         317
 17  ####################################            732 │ ###############         317
 18  ######################################          761 │ ################        331
 19  ##########################################      852 │ ##################      373
 20  ############################################    885 │ ##################      376
合计 11780 对  7138 个输入 token
花费 0.0115 对 0.0114 元
```

左边一路往右长,右边从第 5 轮起停住。最后一行再次确认:token 差 39%,钱几乎不差。

</details>

**练习 2:换一家厂商跑同一份对话。** 用 `ENV_FILE=.env.sf` 在硅基流动上跑 `cost_curve.py`,存到 `data/cost_curve_sf.json`(别覆盖 DeepSeek 那份)。看命中那一列,再比总花费和耗时,想想窗口裁剪在这家会不会省钱。

<details><summary>参考答案</summary>

```bash
ENV_FILE=.env.sf uv run python -m part02.cost_curve --out data/cost_curve_sf.json
```

```text
 轮  发了  输入  命中  未命中  输出    本轮元     累计元   秒
  1     2   286     0     286    55  0.001353  0.001353  1.86
  2     4   351     0     351    30  0.001323  0.002676  1.11
  3     6   390   256     134    10  0.000569  0.003245  1.45
  4     8   414   256     158    40  0.000911  0.004156  1.23
  5    10   464   256     208    25  0.000926  0.005081  1.22
  6    12   497   256     241    45  0.001205  0.006286  1.10
  7    14   560   256     304    38  0.001331  0.007617  3.09
  8    16   609   256     353    35  0.001451  0.009068  1.22
  9    18   655   512     143    15  0.000718  0.009785  0.75
 10    20   681   512     169     8  0.000733  0.010518  0.86
 11    22   699   512     187    30  0.000985  0.011503  1.19
 12    24   739   512     227    27  0.001078  0.012580  1.16
 13    26   774   512     262    30  0.001210  0.013790  4.83
 14    28   815     0     815    25  0.002670  0.016460  0.93
 15    30   849   768      81    15  0.000608  0.017068  0.74
 16    32   875   768     107    27  0.000794  0.017863  1.51
 17    34   910   768     142    19  0.000827  0.018690  0.80
 18    36   943     0     943    68  0.003441  0.022131 12.48
 19    38  1021     0    1021    10  0.003153  0.025284  0.98
 20    40  1045     0    1045    37  0.003468  0.028752  3.23
输入 token 合计 13577, 输出合计 589
最后两轮的回答:
  19: 您登记的发票抬头是「杭州小林科技有限公司」。
  20: 您的团队6人，当前套餐为专业版年付（含5个席位），需增加1个席位。具体方案已提交人工确认，结果以财务核算为准。
已存到 data/cost_curve_sf.json
```

同一个模型(DeepSeek V4 Flash)、同一份对话、同一套代码,硅基流动这边:

- **缓存不稳。** 20 轮里有 6 轮(第 1、2、14、18、19、20 轮)一个都没命中,命中是 256 的整数倍而不是 128,而且时有时无。Day 124 练习 3 见过它「第三次可能一个都不命中」,今天又看到了。
- **贵一倍多。** 0.0288 元对 DeepSeek 的 0.0115 元。单价本来就高一些(未命中 3 元对 2 元,输出 9 对 8),再加上缓存经常不命中,最后几轮每轮 0.003 元,是 DeepSeek 的 5 倍。
- **慢且不稳。** 中位数 1.2 秒,但第 18 轮等了 12.48 秒。Day 128 说过比厂商要看最慢的那次,这就是。

在这家,窗口裁剪就真的省钱了:它每轮的输入会停在 400 左右,而不是 1045,而且未命中的 token 直接按 3 元算。你可以再跑一次 `ENV_FILE=.env.sf uv run python -m part02.cost_curve --window 3 --out data/cost_curve_sf_w3.json` 看数字(我没跑,留给你)。结论:**裁剪省不省钱,取决于厂商的缓存**。这也是 Day 128「选厂商」那张表里「有没有缓存价」那一行的分量。

这一次 20 轮硅基流动约 0.029 元,是今天最贵的一个实验。

</details>

**练习 3:按长度而不是按轮数裁。** 窗口按「轮」切,但有的轮一句话、有的轮贴了一大段。写 `part02/budget_chat.py`,`BudgetChat(Chat)` 带一个 `max_chars`(用字符数代替 token 数,先不引入 tokenizer):从最新的一轮往前数,累计字符不超过预算就保留,超了就停;当前这个问题永远要发;不拆开一对消息。写 4 个测试。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/budget_chat.py
from dataclasses import dataclass

from openai.types.chat import ChatCompletionMessageParam

from part02.chat import Chat


def chars_of(message: ChatCompletionMessageParam) -> int:
    content = message.get("content")
    return len(content) if isinstance(content, str) else 0


@dataclass
class BudgetChat(Chat):
    max_chars: int = 400

    def payload(self) -> list[ChatCompletionMessageParam]:
        head: list[ChatCompletionMessageParam] = []
        if self.system is not None:
            head.append({"role": "system", "content": self.system})
        kept: list[ChatCompletionMessageParam] = []
        used = 0
        i = len(self.messages)
        if i and self.messages[i - 1]["role"] == "user":
            kept.append(self.messages[i - 1])
            used += chars_of(self.messages[i - 1])
            i -= 1
        while i >= 2:
            pair = self.messages[i - 2:i]
            size = chars_of(pair[0]) + chars_of(pair[1])
            if used + size > self.max_chars:
                break
            kept = pair + kept
            used += size
            i -= 2
        return head + kept
```

<div class="line-notes">

- `def chars_of(message: ChatCompletionMessageParam) -> int:` 一条消息多少个字符。`content` 在类型上可能不是字符串(带工具调用的 assistant 消息可以没有它),所以 `isinstance` 判断一下。
- `max_chars: int = 400` 预算,单位是字符。中文大约 1 个字 1 个 token 上下,粗估够用;[Day 107](/blog/agent-zero/day-107-tokens-1/) 讲过为什么字数和 token 数不相等,要精确就换成 tokenizer。
- `i = len(self.messages)` 从末尾往前扫,`i` 是「还没看的部分」的右边界。
- `if i and self.messages[i - 1]["role"] == "user":` 最后一条是刚追加的问题,无条件保留,也计入已用字符。
- `while i >= 2:` 每次看一对(user, assistant)。
- `pair = self.messages[i - 2:i]` 倒数的一对。
- `if used + size > self.max_chars:` 放不下就停,后面更早的也不用看了。
- `kept = pair + kept` 放在已保留的前面,顺序才是从旧到新。
- `i -= 2` 往前挪一对。

</div>

```python
# agent-zero-lab/tests/test_budget_chat.py
from openai.types.chat import ChatCompletionMessageParam

from part02.budget_chat import BudgetChat
from part02.chat import Send


def make_send(seen: list[list[ChatCompletionMessageParam]], reply: str) -> Send:
    def send(messages: list[ChatCompletionMessageParam]) -> tuple[str, int]:
        seen.append(list(messages))
        return reply, len(messages)

    return send


def test_short_history_is_sent_whole() -> None:
    seen: list[list[ChatCompletionMessageParam]] = []
    chat = BudgetChat(system="客服", max_chars=100)
    send = make_send(seen, "好的")
    chat.ask("你好", send)
    chat.ask("再问", send)
    assert [m["role"] for m in seen[1]] == ["system", "user", "assistant", "user"]


def test_long_turns_are_dropped_oldest_first() -> None:
    seen: list[list[ChatCompletionMessageParam]] = []
    chat = BudgetChat(max_chars=30)
    send = make_send(seen, "十个字十个字十个字十")
    chat.ask("第一句话", send)
    chat.ask("第二句话", send)
    chat.ask("第三句话", send)
    assert [m.get("content") for m in seen[2]] == ["第二句话", "十个字十个字十个字十", "第三句话"]


def test_current_question_is_always_sent() -> None:
    seen: list[list[ChatCompletionMessageParam]] = []
    chat = BudgetChat(max_chars=5)
    send = make_send(seen, "回答")
    chat.ask("这句话比预算还长", send)
    chat.ask("再来一句长的", send)
    assert [m.get("content") for m in seen[1]] == ["再来一句长的"]


def test_never_splits_a_pair() -> None:
    chat = BudgetChat(max_chars=12)
    send = make_send([], "答案四个")
    chat.ask("问一", send)
    chat.ask("问二", send)
    roles = [m["role"] for m in chat.payload()]
    assert roles in (["user", "assistant"], ["user", "assistant", "user", "assistant"])
    assert roles[0] == "user"
```

<div class="line-notes">

- `def test_long_turns_are_dropped_oldest_first() -> None:` 预算 30 字,每轮 4 + 10 = 14 字:第 3 轮时当前问题 4 字,再放第 2 轮 14 字共 18,再放第 1 轮会到 32,超了,所以只剩第 2 轮加当前问题。
- `def test_current_question_is_always_sent() -> None:` 预算 5 字,问题本身 6 字:也得发,不然没法问。
- `def test_never_splits_a_pair() -> None:` 预算 12,一对正好 2 + 4 = 6 字,`payload` 里的角色只能是整对,并且 user 开头。

</div>

```bash
uv run pytest tests/test_budget_chat.py -q
```

```text
....                                                                     [100%]
4 passed in 0.58s
```

按字符裁比按轮裁更稳:贴了一大段日志的那一轮会把前面挤出去,而不是让输入突然暴涨。Day 262 会把字符换成真正的 token 数,再加上给工具结果、检索内容各自分配预算。

</details>

**练习 4:算一家公司的月账。** 写 `part02/month_bill.py`,从 `data/cost_curve.json` 读出 S、T、平均每轮输出、缓存命中率,按公式算 5、10、20、40 轮一个会话的钱(有缓存按实测命中率,无缓存全按未命中价),再乘每天 5000 个会话、30 天。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/month_bill.py
import json
from pathlib import Path

from common.cost import Price

PEAK = Price(hit=0.04, miss=2, out=8)
SESSIONS_PER_DAY = 5000
DAYS = 30

rows = json.loads(Path("data/cost_curve.json").read_text(encoding="utf-8"))
S, last = rows[0]["prompt"], rows[-1]["prompt"]
T = (last - S) / (len(rows) - 1)
OUT_PER_TURN = sum(r["completion"] for r in rows) / len(rows)
HIT_RATIO = sum(r["hit"] for r in rows) / sum(r["prompt"] for r in rows)
print(f"实测参数: S={S}, T={T:.1f}, 每轮输出 {OUT_PER_TURN:.1f} 个 token, 缓存命中率 {HIT_RATIO:.0%}")


def session_cost(rounds: int, cached: bool) -> float:
    prompt_total = rounds * S + T * rounds * (rounds - 1) / 2
    hit = prompt_total * HIT_RATIO if cached else 0
    miss = prompt_total - hit
    return (hit * PEAK.hit + miss * PEAK.miss + rounds * OUT_PER_TURN * PEAK.out) / 1_000_000


print(f"{'轮数':>4} {'无缓存/会话':>12} {'有缓存/会话':>12} {'无缓存/月':>10} {'有缓存/月':>10}")
for rounds in (5, 10, 20, 40):
    a, b = session_cost(rounds, False), session_cost(rounds, True)
    print(f"{rounds:>4} {a:>12.5f} {b:>12.5f} {a * SESSIONS_PER_DAY * DAYS:>10.0f} {b * SESSIONS_PER_DAY * DAYS:>10.0f}")
```

<div class="line-notes">

- `PEAK = Price(hit=0.04, miss=2, out=8)` DeepSeek 高峰价,Day 124 的 `Price`。
- `HIT_RATIO = sum(r["hit"] for r in rows) / sum(r["prompt"] for r in rows)` 实测 20 轮的整体命中率:7808 / 11780 = 66%。把它当常数是粗估,实际上轮数越多命中率越高(早期几轮命中少)。
- `def session_cost(rounds: int, cached: bool) -> float:` 一个会话的钱。
- `prompt_total = rounds * S + T * rounds * (rounds - 1) / 2` 今天的公式。
- `hit = prompt_total * HIT_RATIO if cached else 0` 有缓存就按比例拆,没缓存全是未命中。
- `return (hit * PEAK.hit + miss * PEAK.miss + rounds * OUT_PER_TURN * PEAK.out) / 1_000_000` 三种 token 三个单价。
- `print(f"{rounds:>4} {a:>12.5f}` 一行一种轮数,四个数。

</div>

```bash
uv run python -m part02.month_bill
```

```text
实测参数: S=287, T=31.5, 每轮输出 20.3 个 token, 缓存命中率 66%
  轮数       无缓存/会话       有缓存/会话      无缓存/月      有缓存/月
   5      0.00431      0.00204        647        306
  10      0.01020      0.00463       1529        694
  20      0.02669      0.01146       4003       1719
  40      0.07855      0.03175      11783       4762
```

20 轮那一行的「有缓存/会话」是 0.01146 元,和实测的 0.0115 元对上了,说明公式和命中率没算错。往上看:平均 5 轮的产品每月 300 多元,平均 40 轮的产品每月将近 5000 元(有缓存)或 1.2 万(没缓存)。轮数 8 倍,钱 15 倍。而且这里每轮输出只有 20 个 token,客服回答一长,输出那一项还要再翻几倍。看到这张表你就知道,「对话平均多少轮」是一个要盯着的产品指标。

</details>

**练习 5:改一个字,缓存全断。** 写 `part02/edit_history.py`:把 `data/cost_curve.json` 里的 20 轮对话读回一个 `Chat`,先原样问一句「我们团队几个人?」让缓存热起来,等 3 秒;再分别用「原样的历史」和「把第 1 轮助手回答改掉的历史」各问一次,比较命中数。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part02/edit_history.py
import copy
import json
import time
from datetime import date
from pathlib import Path

from openai.types.chat import ChatCompletionMessageParam

from common.cost import split_input
from part02.chat import Chat
from part02.chat_util import send, text_of
from part02.system_prompt import build_system

rows = json.loads(Path("data/cost_curve.json").read_text(encoding="utf-8"))
chat = Chat(system=build_system(date(2026, 10, 23), "小林", "专业版年付"))
for r in rows:
    chat.messages.append({"role": "user", "content": r["question"]})
    chat.messages.append({"role": "assistant", "content": r["answer"]})
print(f"读回 {len(rows)} 轮对话, 历史 {len(chat.messages)} 条, 最后一轮输入 {rows[-1]['prompt']} 个 token")

question: ChatCompletionMessageParam = {"role": "user", "content": "我们团队几个人?"}
resp = send(chat.payload() + [question], max_tokens=60)
assert resp.usage is not None
print(f"先原样问一次, 让缓存热起来: 命中 {split_input(resp.usage)[0]}")
time.sleep(3)

untouched = copy.deepcopy(chat.payload())
edited = copy.deepcopy(chat.payload())
edited[2]["content"] = "你好小林,欢迎使用云簿。"  # 改写第一轮助手的回答

for label, history in (("历史原样放回", untouched), ("改了第一轮的回答", edited)):
    resp = send(history + [question], max_tokens=60)
    assert resp.usage is not None
    hit, miss = split_input(resp.usage)
    print(f"{label}: 输入 {resp.usage.prompt_tokens} = 命中 {hit} + 未命中 {miss}; 回答: {text_of(resp)}")
```

<div class="line-notes">

- `import copy` 要复制嵌套的列表,用 `copy.deepcopy`,[Day 26](/blog/agent-zero/day-026-nested-data/) 讲过浅拷贝和深拷贝。
- `for r in rows:` 把 JSON 里每轮的问和答按顺序塞回 `chat.messages`,重建出 20 轮的历史,不用再花 20 次的钱。
- `resp = send(chat.payload() + [question], max_tokens=60)` 第一次发,让服务器把这 885 个 token 的前缀缓存起来。
- `time.sleep(3)` Day 130 说过,缓存要几秒才「落盘」,马上发可能命不中。
- `untouched = copy.deepcopy(chat.payload())` 原样的一份。
- `edited[2]["content"] = "你好小林,欢迎使用云簿。"` 下标 2 是 system、第 1 轮 user 之后的第 1 轮 assistant。只改这一条。用 `deepcopy` 是因为列表里的字典是共享的,浅拷贝改一份两份都变。
- `for label, history in (("历史原样放回", untouched), ("改了第一轮的回答", edited)):` 两份历史各发一次同样的问题。
- `print(f"{label}: 输入 {resp.usage.prompt_tokens} = 命中 {hit} + 未命中 {miss};` 看命中。

</div>

```bash
uv run python -m part02.edit_history
```

```text
读回 20 轮对话, 历史 40 条, 最后一轮输入 885 个 token
先原样问一次, 让缓存热起来: 命中 768
历史原样放回: 输入 908 = 命中 768 + 未命中 140; 回答: 你们团队 6 人。
改了第一轮的回答: 输入 870 = 命中 256 + 未命中 614; 回答: 你们团队 6 个人。
```

原样放回:908 个输入里命中 768,只有 140 个按贵价。改了第 1 轮的回答:命中掉到 256,只剩 system 那一段(前 256 个 token)还命中,后面 614 个全按贵价。两次的回答一样,用户看不出区别,账单差 4 倍多。改动越靠前,损失越大;改最后一轮几乎没损失。所以要改历史,改最新的,别碰最早的。

</details>

**验收标准:** `quadratic_sim.py` 的 20 轮合计是 19600,10 到 80 轮的倍数从 3.1 涨到 3.7;`cost_curve.py` 全历史版的「输入」列单调上涨、「命中」列按 128 的整数倍上台阶、第 19、20 轮答出抬头和人数;`cost_model.py` 的公式结果和实测相差 1% 以内;`pytest tests/test_window_chat.py tests/test_budget_chat.py` 8 个全过;`--window 3` 跑出来「发了」列从第 4 轮起固定、第 19 轮答不出抬头;练习 2 在硅基流动上能看到至少一轮命中为 0;练习 5 改历史后命中数明显下降(数字会和我的不同)。

今天的花费:DeepSeek 两次 20 轮,0.0115 + 0.0114 元;练习 5 三次长请求约 0.004 元;写文章时我另外试跑过几次短对话,约 0.01 元;硅基流动 20 轮 0.0288 元;合计约 0.07 元。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 平方级增长 | 总量和 N² 成正比:N 翻倍,总量约变 4 倍。多轮对话的累计输入 token 就是 |
| S、T、N | 公式里的三个量:system prompt 的 token 数、每轮新增的 token 数、轮数 |
| 1 + 2 + … + N = N(N+1)/2 | 等差数列求和,今天的楼梯面积。记成「三角形面积 = 底 × 高 / 2」就行 |
| 前缀缓存(prompt cache) | 厂商把请求开头一模一样的部分存起来,下次按便宜价算。Day 124、130 讲过,今天看到它在多轮里的作用 |
| 命中率 | 命中缓存的 token 占全部输入 token 的比例,实测 20 轮 66% |
| 滑动窗口(sliding window) | 只把最近 K 轮历史发给模型,更早的不发。`WindowChat` 实现的就是它 |
| 裁剪(trim) | 发请求前从历史里去掉一部分。按轮、按字符、按 token 都是裁剪的办法 |
| 预填充(prefill) | 模型读完整段输入的那一步。输入几百个 token 时很快,几万个时会明显变慢 |
| 闭包记录 | 在函数里定义一个函数,让它改外层的列表(`usages.append`),用来从只能返回两个值的 `send` 里把 `usage` 带出来 |
| `copy.deepcopy` | 连同里面嵌套的对象一起复制,改副本不影响原件 |
| `list.index(x)` | 返回 `x` 在列表里第一次出现的下标,今天用来找命令行参数的位置 |

## 常见误区

**以为多轮对话的费用是线性的。** 每轮都重发全部历史,第 n 轮的输入是 S + (n−1)×T,累计是平方级。实测 20 轮 11780 个输入 token,推到 200 轮是 68 万,不是 11.8 万。

**只看一次调用的价格。** 一次 0.0006 元看着没什么,一个 40 轮的会话是 0.03 元,每天 5000 个会话一个月 4762 元。要算的是「平均轮数 × 会话数」。

**忘了输出会变成下一轮的输入。** 第 18 轮让模型总结,回答 81 个 token,第 19 轮的输入立刻多了 91。让模型长篇大论,贵的不只是这一轮。

**以为裁剪历史一定省钱。** 在 DeepSeek 上,全历史和只留 3 轮的 20 轮花费是 0.0115 对 0.0114,因为重发的历史几乎都命中了 0.04 元的缓存价。省不省钱取决于厂商有没有缓存、命中多少。

**裁剪时拆开一对消息。** 切出来的列表以 assistant 开头,或者 user 后面没有 assistant,模型会迷糊,带工具调用时还会 400。按轮切,`WindowChat` 里那个 `if tail[0]["role"] == "assistant"` 就是为这个。

**裁掉了关键信息还以为模型记得。** 窗口版第 19 轮「发票抬头是什么」直接转人工。用户第 1 轮报的事实,要么写进 system 的背景,要么做摘要,不能指望它一直留在窗口里。

**在历史里改字。** 改了第 1 轮的回答,命中从 768 掉到 256。要改就改最新的几条,早期的原样放回。

**`dataclass` 子类忘了再写 `@dataclass`。** `keep_turns` 不会变成构造参数,`WindowChat(keep_turns=3)` 报 `TypeError: unexpected keyword argument`。

**把实测的参数当成通用数字。** 今天 T = 31.5 是因为云簿客服被要求两句话以内回答。换一个话痨的 system,T 可能是 300,平方那一项就大 10 倍。参数要从你自己的对话里测。

## 学习资料

### 文档与文章

- [DeepSeek · 多轮对话](https://api-docs.deepseek.com/zh-cn/guides/multi_round_chat):官方示例,每轮把 `messages` 整个发出去,文档里直说「服务端不记录用户请求的上下文」。今天的公式就是从这个事实推出来的。5 分钟。
- [DeepSeek · 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache):讲缓存按「前缀单元」匹配、多轮对话里第二次请求可以复用第一次的前缀、缓存几小时到几天后清空。今天「命中」那一列的来源。
- [DeepSeek · 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing):2026 年 10 月查到,`deepseek-flash` 高峰价命中 0.04、未命中 2、输出 8 元每百万 token,工作日 9–12 点和 14–18 点是高峰,其余时间半价。算账前先核价。
- [OpenAI · Conversation state](https://developers.openai.com/api/docs/guides/conversation-state):讲「让服务器替你串联历史」的 `previous_response_id`,并明确写了之前所有轮次的输入照样计费。平方级增长不会因为换一种 API 就消失。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1QVHt6XEfa&autoplay=0&high_quality=1" title="如何省token/何谓长对话/关于缓存命中/DS过于便宜以致误解/" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>蒂光松飞神 · 如何省 token、何谓长对话、关于缓存命中、DS 过于便宜以致误解 · 3 分钟,2026 年 10 月。Day 129 预告过的那一条,今天正式看:他说的「长对话为什么越来越贵」「缓存命中为什么能救」,对照今天的两张表听。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZdMK6qE77&autoplay=0&high_quality=1" title="多轮对话如何节省token实践" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小工蚁创始人 · 多轮对话如何节省 token 实践 · 3 分半,2026 年 7 月。讲在多轮对话里裁剪和复用的几种做法,对应今天的 `WindowChat` 和练习 3 的 `BudgetChat`。播放量不高,内容是对的。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/3C59cBWD7NA" title="What Is a Context Window in AI? Why ChatGPT Forgets What You Said" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Rajkumar Dake · What Is a Context Window in AI? Why ChatGPT Forgets What You Said · 英文。按标题讲上下文窗口和「为什么 ChatGPT 会忘」,我只核对了标题和能打开,没逐段看过。今天窗口版第 19 轮的「忘了」就是这件事的程序版。</figcaption>
</figure>

### 书籍

- 《AI Engineering: Building Applications with Foundation Models》(Chip Huyen 著,O'Reilly,2025 年;我没查到中文版,这里只写英文原版):第 9 章讲推理优化,里面有成本和延迟的拆解,「输入 token 与输出 token 的价格差」「缓存」都在那一章。今天读第 9 章开头的成本部分就够。

### 开源项目与代码

- [openai/tiktoken](https://github.com/openai/tiktoken):OpenAI 的 tokenizer 库,本地数 token 不用发请求。练习 3 用字符数做预算是粗估,要精确就用它(OpenAI 模型)或 Day 107 下载的 DeepSeek tokenizer 换掉 `chars_of`。

## 自测

1. 为什么多轮对话的累计输入 token 是平方级的?写出公式并说明每个字母。

<details><summary>答案</summary>

因为每一轮都把之前全部历史重发一遍,第 n 轮的输入是 S + (n−1)×T(S 是 system 的 token 数,T 是每轮新增的 token 数)。N 轮相加:N×S + T×(0 + 1 + … + (N−1)) = N×S + T×N(N−1)/2,第二项含 N²。实测 S = 287、T = 31.5,20 轮公式 11720,实测 11780。

</details>

2. 实测 20 轮,「本轮元」这一列为什么没有明显上涨?

<details><summary>答案</summary>

因为 DeepSeek 的前缀缓存:每轮的开头和上一轮相同,大部分历史命中缓存按 0.04 元/百万算(贵价的 1/50);真正按贵价算的「未命中」部分只有上一轮的回答加这一轮的问题,不随轮数涨。命中数 128、256、…、640 逐级上升,未命中一直在 140–260 之间。

</details>

3. `WindowChat` 省了什么、丢了什么?在 DeepSeek 上它省钱吗?

<details><summary>答案</summary>

省了输入 token(11780 → 7138,少 39%)和上下文长度,第 5 轮起每轮输入不再涨。丢了窗口之外的信息:第 19 轮答不出第 1 轮报的发票抬头。在 DeepSeek 上几乎不省钱(0.0115 对 0.0114 元),因为被裁掉的历史本来就命中缓存、几乎不花钱;在缓存不稳的厂商(练习 2 的硅基流动)上才真省钱。

</details>

4. 为什么裁剪要以「轮」为单位?`WindowChat.payload` 里哪一行在保证这件事?

<details><summary>答案</summary>

一轮是一条 user 加一条 assistant,拆开会出现以 assistant 开头、或者 user 没有回答的列表,模型会迷糊,带工具调用的 assistant 消息后面跟着的 tool 消息被拆开还会 400。`payload` 里切 `2K + 1` 条之后,`if tail and tail[0]["role"] == "assistant": tail = tail[1:]` 把开头孤零零的回答去掉。

</details>

5. 把历史里第 1 轮的回答改一个字,再发请求,缓存命中会怎样?

<details><summary>答案</summary>

从改动点起之后的全部内容都不再命中。实测原样放回命中 768,改了第 1 轮的回答命中掉到 256(只剩 system 那一段)。要改历史就改最新的,早期的原样放回。

</details>

6. 面试题:「你们的客服对话平均 15 轮,成本怎么控制?」

<details><summary>答案</summary>

先把账算清:用实测的 S、T 和每轮输出套公式,算出每个会话的钱,再乘会话数,知道钱花在哪三类 token 上。然后分三层:一,利用前缀缓存:system 和历史原样放回、不变的放前面、变化的放最后,实测 DeepSeek 上 20 轮命中 66%,账单从 0.0268 降到 0.0115;二,控制输出长度:输出是下一轮的输入,格式里写死「两句话以内」或字数上限;三,裁剪历史:按轮或按 token 预算做窗口,关键事实(用户报的订单号、套餐)抽出来放进 system 的背景或做摘要,不能靠窗口保留;并说明裁剪省不省钱要看厂商的缓存。最后提两个指标要上监控:平均轮数、每会话成本,两个都要盯着,因为平方级意味着轮数涨一点钱涨很多。

</details>

## 明天预告

[Day 132](/blog/agent-zero/day-132-week19-review/) · 第 19 周复习:大模型与 API(Day 126–131)。这六天讲的是一次请求从发出到记账中间会遇到的所有事:错误分类(126)、重试和退避(127)、限速和并发(128)、messages 就是记忆(129)、system 怎么写(130)、对话越聊越贵(131)。明天把它们画成一张图,逐天一句话回顾,默写本周的核心代码,再写一个小项目:一个扛得住 429、算得清钱、裁得了历史、花到预算就停的客服会话,假服务器和真 DeepSeek 上各跑一遍。
