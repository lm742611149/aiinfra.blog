---
title: 'Day 362 · 轨迹评测(三):多轮,写一个模拟客户'
description: '前两天的评测都是一张工单进去、Agent 处理完出来。真实客服是聊出来的:客户第一句只说「退款」,Agent 得追问。今天先试写死的剧本,看它怎么接不上;再让另一个模型照着剧本扮演客户,和 Agent 最多聊 5 轮,4 条用例各跑 3 次。结果评测全过,读完对话却发现 Agent 自己编了一条「后台操作路径」,还在客户只是问一句的时候就把退款提交了。'
pubDate: 2026-10-22
regime: none
tags: ['eval', 'trajectory', 'user-simulator', 'agent-zero']
series: 'agent-zero'
day: 362
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 361](/blog/agent-zero/day-361-trajectory-2/) 把「轨迹只写必须和禁止」落成了代码:先用 `Counter` 实现了 strict、unordered、subset、superset 四种匹配模式,拿 agentevals 在 168 次比较上对了一遍;再写了顺序、越权、重复、退款参数、预算五个检查,跑在 Day 360 的 12 条真实轨迹和两条手工坏轨迹上,每种问题都被对应的检查抓住了。

那 14 条轨迹有一个共同点:工单只有一句话,Agent 读完一句话就把事情办完。可真实的客服对话很少这样。客户打开聊天框,第一句经常只有两个字「退款」,哪种退款、哪张发票、为什么要退,全得靠客服问出来。单轮测试集测不了「会不会问、问得对不对、问完能不能办对」。今天解决这件事。

## 今天要解决的问题

学完今天你应该能:

1. 把 Day 360 的单轮 Agent 改成能接着聊的多轮版本,一个对象就是一段对话。
2. 说清楚为什么写死的对话剧本测不了多轮,并用今天实跑的一段对话举例。
3. 写一个**模拟客户**(user simulator):用另一个模型照着剧本扮演客户,讲清楚它的提示词里每条规则防的是什么,以及为什么要把对话里的角色反过来。
4. 用模拟客户跑多轮评测:对话结束后查库判结果、查轨迹判过程,每条用例跑 3 次看 pass^3;再读对话,找出分数里看不到的问题,并检查模拟客户自己有没有演砸。

今天只有一个新概念:**模拟客户**。多轮对话怎么拼 messages 是 [Day 129](/blog/agent-zero/day-129-messages/) 学的,pass^k 是 [Day 344](/blog/agent-zero/day-344-eval-concepts/) 学的,今天只是把它们用到评测上。

预计用时 3 小时。今天要调模型,全部实跑合计约 0.40 元,算式在第四步末尾。前置:Day 360 的 `part06/traj_agent.py`(今天直接 import 它的工具和政策);Day 361 的 `part06/trajectory.py`(今天复用其中三个检查);Day 350 的 `part06/oracle.py`;Day 357 的 `part06/llm_judge.py`(练习 4 用);[Day 280](/blog/agent-zero/day-280-mcp-seed/) 的种子库 `cloudledger/cloudledger.db`。

学法:先对照文章逐行敲一遍(不复制粘贴)并跑通;明天合上文章把 `sim_reply()` 和 `run_dialog()` 默写出来;做练习时先自己写,做不出再展开参考答案,看完关掉重写一遍。

## 先说清楚:为什么要「模拟」一个客户

单轮评测里,用例的输入是一句工单,Agent 的输入就是这句话,用例写死就行。多轮不一样:客户的第二句话取决于客服的第一句话说了什么。客服问「是重复扣款还是中途取消」,客户答「中途取消」;客服问「发票号是多少」,客户答「不记得」;客服直接把事办了,客户可能说「谢谢」,也可能说「等等,我还没说要退」。下一句怎么接,要看上一句。

所以多轮评测的输入,不能是一串写死的句子,得是一个**会根据对话内容接话的客户**。找真人来当客户太贵,每改一次 prompt 就得请人聊一遍。业界的做法是让另一个大模型来扮演客户,这就是**模拟客户**,英文一般叫 user simulator 或 simulated user。

用前端的话说,这像是 E2E 测试里的「用户」。Playwright 脚本里你写死了「点这个按钮、填这个框」,页面结构一变脚本就挂;模拟客户相当于一个会看页面再决定点哪里的测试员。它更灵活,代价是它自己也会出错,这个第六步专门讲。

这个思路最有名的是 Sierra 团队 2024 年 6 月发的 [τ-bench](https://arxiv.org/abs/2406.12045)(读作 tau-bench)。它做了航空和零售两个客服场景,每个任务给模拟用户一段说明(你是谁、想办什么、知道哪些信息),Agent 和模拟用户对话,对话结束后比较数据库的最终状态和期望状态是否一致。论文摘要里写,当时最强的函数调用 Agent(比如 gpt-4o)任务成功率不到 50%,而且同一个任务多跑几次结果不稳定,所以他们提出了 pass^k 来衡量「每次都能做对」。2025 年他们又出了 [τ²-bench](https://arxiv.org/abs/2506.07982),让模拟用户也能操作环境。今天我们照这个思路写一个缩小版:判分方式和 Day 360 一样,看库里的最终状态。

## 第一步:让 Agent 能接着聊

Day 360 的 `traj_agent.py` 里 `run()` 是一次性的:建临时库、塞 system 和 user 两条消息、循环到模型不再要工具、返回。多轮要把它拆开:临时库和 `messages` 在整段对话里一直留着,客户每说一句,往 `messages` 里加一条 user 消息,再跑一遍工具循环。

这就是 [Day 129](/blog/agent-zero/day-129-messages/) 说的「模型没有记忆,你的列表就是记忆」。下面写成一个类,一个对象就是一段对话:

```python
# agent-zero-lab/part06/agent_session.py
"""多轮版的工单 Agent:一个对象就是一段对话,send() 一次是客户说一句话、Agent 处理到回复为止。
工具、政策、临时库都复用 Day 360 的 traj_agent.py。"""
from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
from pathlib import Path

from part06.oracle import DB
from part06.traj_agent import EXTRA, MODEL, SYSTEM, TOOLS, call_tool, client


class AgentSession:
    def __init__(self, customer_id: str, temperature: float = 0.7):
        tmp = Path(tempfile.mkdtemp()) / "cloudledger.db"
        shutil.copy(DB, tmp)
        self.conn = sqlite3.connect(tmp)
        self.conn.row_factory = sqlite3.Row
        self.customer_id = customer_id
        self.temperature = temperature
        self.messages: list = [{"role": "system", "content": SYSTEM}]
        self.tool_calls: list[dict] = []
        self.tokens = {"in": 0, "out": 0}

    def send(self, text: str, max_steps: int = 10) -> str:
        if len(self.messages) == 1:                      # 第一句带上登录客户的编号
            text = f"[客户编号 {self.customer_id}] {text}"
        self.messages.append({"role": "user", "content": text})
        for _ in range(max_steps):
            resp = client.chat.completions.create(model=MODEL, messages=self.messages, tools=TOOLS,
                                                  temperature=self.temperature, extra_body=EXTRA)
            if resp.usage:
                self.tokens["in"] += resp.usage.prompt_tokens
                self.tokens["out"] += resp.usage.completion_tokens
            msg = resp.choices[0].message
            self.messages.append(msg.model_dump(exclude_none=True))
            if not msg.tool_calls:
                return msg.content or ""
            for tc in msg.tool_calls:
                if tc.type != "function":
                    continue
                args = json.loads(tc.function.arguments or "{}")
                self.tool_calls.append({"name": tc.function.name, "args": args})
                result = call_tool(self.conn, tc.function.name, args)
                self.messages.append({"role": "tool", "tool_call_id": tc.id,
                                      "content": json.dumps(result, ensure_ascii=False)})
        return "(这一轮工具调用太多,停下了)"

    def finish(self) -> dict:
        refunds = [dict(r) for r in self.conn.execute("SELECT invoice_id, amount_cents, reason FROM refund_requests")]
        self.conn.close()
        return {"customer_id": self.customer_id, "tool_calls": self.tool_calls,
                "refunds": refunds, "tokens": self.tokens}


if __name__ == "__main__":
    s = AgentSession("C023")
    print("客服:", s.send("退款"))
    print("客服:", s.send("我们是年付的,下个月起不用了,想把剩下的钱退了"))
    run = s.finish()
    print("工具:", [tc["name"] for tc in run["tool_calls"]])
    print("退款:", [(r["invoice_id"], r["amount_cents"] / 100) for r in run["refunds"]])
    print("token:", run["tokens"])
```

<div class="line-notes">

- `from part06.traj_agent import EXTRA, MODEL, SYSTEM, TOOLS, call_tool, client` 直接借 Day 360 那个文件里的模型客户端、政策 prompt、四个工具的定义和执行函数。被测的 Agent 和前两天是同一个,只是多了「接着聊」的能力,评测结果才能和前两天对比。import 这个模块时它顶层的 `load_dotenv()` 和 `OpenAI(...)` 会跑一遍,没有副作用。
- `class AgentSession:` 起这个名字,是为了和 [Day 135](/blog/agent-zero/day-135-llm-client-1/) `common/llm.py` 里的 `Conversation` 区分开。那个只管聊天,这个还管工具和临时库。
- `tmp = Path(tempfile.mkdtemp()) / "cloudledger.db"` 和 Day 360 一样,每段对话一份新的种子库副本。区别是副本在 `__init__` 里建,整段对话共用,第二轮能查到第一轮提交的退款。
- `self.conn.row_factory = sqlite3.Row` 让查出来的每行能按列名取,`call_tool` 里的 `dict(row)` 靠它。
- `self.messages: list = [{"role": "system", "content": SYSTEM}]` 对话历史,开头只有 system 一条。标成裸的 `list`,是因为里面会混进 SDK 返回的消息转成的字典,写精确类型太啰嗦,basedpyright 对裸 `list` 不报错。
- `self.tool_calls: list[dict] = []` 整段对话的轨迹,几轮的工具调用都按顺序接在这一个列表里。Day 361 的检查函数吃的就是它。
- `def send(self, text: str, max_steps: int = 10) -> str:` 客户说一句,Agent 处理完回一句。`max_steps` 限的是这一句里最多调几次模型,防止它在一轮里绕圈子,和 [Day 192](/blog/agent-zero/day-192-failures-4/) 的步数上限是一回事。
- `if len(self.messages) == 1:                      # 第一句带上登录客户的编号` 只有 system 一条时,说明这是客户第一句话。客户编号由系统带进来,相当于客户已经登录,模拟客户嘴上不需要说。
- `self.messages.append({"role": "user", "content": text})` 客户这句话追加到历史末尾。第二轮时 `messages` 里已经有第一轮的全部消息,模型能看到前面聊过什么。
- `for _ in range(max_steps):` 下面这段循环和 Day 360 `run()` 里的那段几乎一字不差:调模型、累加 token、有工具调用就执行并回 tool 消息、没有就返回文字。
- `if not msg.tool_calls:` 模型不再要工具,这一轮结束。注意这里 `return` 的是这一句回复,`messages` 和 `tool_calls` 都还留在对象上,下一次 `send` 接着用。
- `self.tool_calls.append({"name": tc.function.name, "args": args})` 记轨迹,格式和 Day 360 一样,Day 361 的 `check_scope` 等函数可以直接吃。
- `return "(这一轮工具调用太多,停下了)"` 10 步还没停,返回一句固定的话。今天实跑一次也没走到这里。
- `def finish(self) -> dict:` 对话结束后调用:从临时库里读出退款申请,关连接,打包成和 Day 360 一样形状的字典。这就是结果评测要看的最终状态。
- `print("客服:", s.send("退款"))` 先只说两个字,看 Agent 会不会问。
- `print("客服:", s.send("我们是年付的,下个月起不用了,想把剩下的钱退了"))` 第二句由我手写,下一步会讲为什么手写不行。

</div>

在 `agent-zero-lab` 根目录跑:

```bash
uv run python -m part06.agent_session
```

实测输出(第一段回复很长,中间省略了一部分):

```text
客服: C023 的情况我已查到，需要先跟您确认一下退款原因，因为适用哪条政策差别很大：

**订阅情况**
- 套餐：企业版，年付，2 席位
- 状态：生效中，本期到 2027-10-09 结束
- 发票：三张已支付，各 7176 元（2026-10-09、2025-10-14、2024-10-20），看起来是正常的连续三年续费，没有同一天同金额的重复扣款

**两种可能：**

1. **中途取消退款**（企业版年付）：按剩余整月退款，当月不退。
……
请确认：您是要**取消订阅并按剩余月份退款（6578 元）**吗？确认后我会提交退款申请给主管审批。
客服: 退款申请已提交，等主管审批。
……
工具: ['get_subscription', 'list_invoices', 'search_policy', 'create_refund_request']
退款: [('INV-2026-0091', 6578.0)]
token: {'in': 6142, 'out': 881}
```

第一轮它先查了订阅和发票,发现三张发票日期都不同、不像重复扣款,于是把两种可能都列出来,问客户是哪一种。这一步做得对。第二轮客户说清楚以后,它提交了 INV-2026-0091、6578 元,和 Day 350 判题器的答案一致。注意 `token` 里输入有 6142,比 Day 360 单轮的三千多翻了一倍:第二轮调模型时,第一轮的全部消息都要再发一遍。多轮评测比单轮贵,原因就在这。

## 第二步:最笨的办法,把客户的话写死

有了能接着聊的 Agent,最直接的想法是:把客户每一句话都提前写好,按顺序念。下面拿 C012 试一下。C012 海盐文创是 Day 360 那个「说扣了两次、其实没有」的客户,10 月 8 号只有一张 588 元的发票,而且还没付。

```python
# agent-zero-lab/part06/scripted_dialog.py
"""先试最笨的办法:客户的每一句都提前写死,不管客服说了什么,按顺序念。"""
from __future__ import annotations

from part06.agent_session import AgentSession

SCRIPT = ["你们扣了我两次钱", "对,就是 10 月 8 号那两笔,退一笔给我", "好的,谢谢"]

s = AgentSession("C012")
for line in SCRIPT:
    print(f"客户: {line}")
    print(f"客服: {s.send(line)[:150]}\n")
run = s.finish()
print("工具:", [tc["name"] for tc in run["tool_calls"]])
print("退款:", [(r["invoice_id"], r["amount_cents"] / 100) for r in run["refunds"]])
print("token:", run["tokens"])
```

<div class="line-notes">

- `SCRIPT = ["你们扣了我两次钱", "对,就是 10 月 8 号那两笔,退一笔给我", "好的,谢谢"]` 写剧本时我心里预设的客服第一句是「请问是哪两笔?」,所以第二句写成「对,就是 10 月 8 号那两笔」。第三句预设客服办完了,说谢谢。
- `for line in SCRIPT:` 不管客服回了什么,下一句照念。
- `print(f"客服: {s.send(line)[:150]}\n")` 回复太长,只打印前 150 个字。完整内容在 `s.messages` 里。

</div>

```bash
uv run python -m part06.scripted_dialog
```

实测输出:

```text
客户: 你们扣了我两次钱
客服: 我查了您的记录，情况是这样的：

**您的订阅**：基础版，月付，12 个席位，当前计费周期到 2026-11-08。

**发票记录**：
| 发票号 | 金额 | 开票日期 | 状态 |
|---|---|---|---|
| INV-2026-0045 | 588 元 | 2026-10-08

客户: 对,就是 10 月 8 号那两笔,退一笔给我
客服: 我又把您账号下的全部发票拉了一遍（共 5 张，没有更多记录），10 月 8 号这一天**只有一张发票 INV-2026-0045，金额 588 元，而且状态是"未支付"（open）**。

退款政策对重复扣款的定义是：**同一天、同金额的两张"已支付"发票**，退编号较大的那一张。

您的记录不满足

客户: 好的,谢谢
客服: 不客气！总结一下方便您后续跟进：

- 您账号（C012）下 10 月 8 号只有一张发票 INV-2026-0045，588 元，状态为**未支付**，系统里没有第二笔可退的款项，所以暂时无法提交退款申请。
- 麻烦您抽空看一下银行/支付渠道的流水，重点确认：**两笔的收款方是否都是"云簿"**、

工具: ['get_subscription', 'list_invoices', 'list_invoices', 'search_policy']
退款: []
token: {'in': 7322, 'out': 1112}
```

Agent 这段表现其实不错:没被客户的坚持带跑,没退钱。问题出在剧本上。客服第一句已经把发票列出来了,剧本第二句还在说「就是 10 月 8 号那两笔」,像没看见客服的回复;客服第二句说「您的记录不满足」,剧本第三句是「好的,谢谢」,一个刚才还坚持要退钱的人,突然就满意了。

这段对话测出了什么?说实话,什么都没测出来。剧本第二句是我写剧本时预想的「客服会问哪两笔」,Agent 没这么问,剧本就接不上了。整段对话里,只有第一句是真的在测 Agent,后面两句和 Agent 的回复对不上,测的是一个现实里不会出现的客户。

你可能会想,那就多写几条剧本,每种客服回复都准备一句。客服回复是模型生成的,每次都不一样,你没法穷举。剧本越长,接不上的概率越大。这就是为什么要换成一个会看对话再接话的客户。

## 第三步:模拟客户

模拟客户本身就是一次普通的模型调用:system 里写清楚「你是谁、想办什么、知道什么、怎么说话」,messages 里放到目前为止的对话,让模型说下一句。难点不在代码,在两件事:规则怎么写,角色怎么排。

先说角色。在 Agent 眼里,客户是 user,自己是 assistant。在模拟客户眼里正好反过来:**它自己说的话是 assistant,客服说的话是 user**。模型的工作永远是「以 assistant 的身份接着说」,所以谁是 assistant,模型就扮演谁。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="同一段对话在两个模型眼里的角色:Agent 看到客户是 user、自己是 assistant;模拟客户看到客服是 user、自己是 assistant">
<rect x="0" y="0" width="640" height="250" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="26" fill="var(--ink)">history(我们自己存的)</text>
<text x="230" y="26" fill="var(--mem)">Agent 看到的 messages</text>
<text x="440" y="26" fill="var(--compute)">模拟客户看到的 messages</text>
<rect x="20" y="40" width="190" height="34" rx="4" fill="none" stroke="var(--rule)"/>
<text x="30" y="61" fill="var(--ink)">customer: 退款</text>
<rect x="230" y="40" width="190" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="61" fill="var(--ink)">user: 退款</text>
<rect x="440" y="40" width="180" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="450" y="61" fill="var(--ink)">assistant: 退款</text>
<rect x="20" y="84" width="190" height="34" rx="4" fill="none" stroke="var(--rule)"/>
<text x="30" y="105" fill="var(--ink)">agent: 请问是哪种退款?</text>
<rect x="230" y="84" width="190" height="34" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="240" y="105" fill="var(--ink)">assistant: 请问是…</text>
<rect x="440" y="84" width="180" height="34" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="450" y="105" fill="var(--ink)">user: 请问是…</text>
<rect x="20" y="128" width="190" height="34" rx="4" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="30" y="149" fill="var(--ink-faint)">customer: ?(待生成)</text>
<rect x="440" y="128" width="180" height="34" rx="4" fill="none" stroke="var(--compute)" stroke-dasharray="4 3"/>
<text x="450" y="149" fill="var(--compute)">assistant: 中途取消</text>
<text x="20" y="196" fill="var(--ink-soft)">模型永远「以 assistant 身份接着说」。</text>
<text x="20" y="218" fill="var(--ink-soft)">谁是 assistant,它就扮演谁:Agent 那边是客服,模拟客户这边是客户。</text>
<text x="20" y="240" fill="var(--ink-faint)">另外,Agent 那边还有 system、tool 消息,模拟客户只看两人说的话</text>
</g>
</svg>
<figcaption>同一段对话,在两个模型眼里角色相反。我们自己存 history 时用 customer/agent,不用 user/assistant,就是为了不在这里绕晕。</figcaption>
</figure>

再说规则。剧本拆成两块:「身份和目标」是客户一开口就会表现出来的;「被问到才说的信息」只有客服问到才说。后面这一块是在测 Agent 会不会追问:客户只说了「退款」,Agent 不问就直接猜一种情况去退,就会被抓。

```python
# agent-zero-lab/part06/user_sim.py
"""模拟客户:另一个模型照着剧本扮演客户,看完整段对话说下一句。"""
from __future__ import annotations

import json
import os

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
sim = OpenAI(base_url=os.environ.get("SIM_BASE_URL", os.environ["LLM_BASE_URL"]),
             api_key=os.environ.get("SIM_API_KEY", os.environ["LLM_API_KEY"]))
SIM_MODEL = os.environ.get("SIM_MODEL", os.environ["LLM_MODEL"])
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")
DONE = "###DONE###"
SIM_USAGE = {"calls": 0, "in": 0, "out": 0}

SIM_PROMPT = """你在扮演云簿 CloudLedger 的一位客户,正在网页聊天框里和在线客服对话。你不是 AI 助手,不要替客服解释政策,也不要帮客服做事。

## 你的身份和目标
{persona}

## 被问到才说的信息
{hidden}

## 规则
- 每次只说一两句话,像真人在聊天框里打字。
- 「被问到才说的信息」只有客服问到相关的事才说,没问就不要主动说。
- 不要编造上面没给的信息,比如发票号、金额、日期。客服问到你不知道的,就说不清楚。
- 问题解决了(或者客服说清楚了办不了的理由,你也接受),只回复 {done}。
- 客服连续两次答非所问,表示不满,然后回复 {done}。"""


def sim_reply(case: dict, history: list[dict]) -> str:
    system = SIM_PROMPT.format(persona=case["persona"], hidden=case["hidden"], done=DONE)
    msgs: list = [{"role": "system", "content": system}]
    for h in history:      # 角色反过来:模拟客户自己说的是 assistant,客服说的是 user
        msgs.append({"role": "assistant" if h["role"] == "customer" else "user", "content": h["text"]})
    resp = sim.chat.completions.create(model=SIM_MODEL, messages=msgs, temperature=0.7, extra_body=EXTRA)
    SIM_USAGE["calls"] += 1
    if resp.usage:
        SIM_USAGE["in"] += resp.usage.prompt_tokens
        SIM_USAGE["out"] += resp.usage.completion_tokens
    return (resp.choices[0].message.content or "").strip()


if __name__ == "__main__":
    case = {"persona": "你是云杉律所二店的行政。公司用云簿企业版年付,下个月起不用了,想把剩下的钱退回来。",
            "hidden": "原因:集团统一换了财务系统。你不知道发票号。"}
    history = [{"role": "customer", "text": "退款"},
               {"role": "agent", "text": "您好,请问是遇到了重复扣款,还是想中途取消订阅?"}]
    for i in range(3):
        print(f"第 {i + 1} 次:", sim_reply(case, history))
    print(SIM_USAGE)
```

<div class="line-notes">

- `sim = OpenAI(base_url=os.environ.get("SIM_BASE_URL", os.environ["LLM_BASE_URL"]),` 模拟客户单独一个客户端。`.get("SIM_BASE_URL", 默认值)`:`.env` 里配了 `SIM_*` 就用别的模型扮客户,没配就退回 Agent 用的那个。和 Day 357 评分器的 `JUDGE_*` 是同一个套路。我实跑没配,两边都是 deepseek-flash。最好分开,原因和评分器一样,同一个模型自己考自己,容易一起犯同样的错。
- `SIM_MODEL = os.environ.get("SIM_MODEL", os.environ["LLM_MODEL"])` 实测值 `deepseek-flash`。
- `EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY") or "{}")` 实测是 `{"thinking": {"type": "disabled"}}`,关掉思考模式,扮客户用不着想,省钱也省时间。
- `DONE = "###DONE###"` 模拟客户说「我这边结束了」的暗号。故意写得很怪,正常聊天不会碰巧说出来。
- `SIM_USAGE = {"calls": 0, "in": 0, "out": 0}` 模拟客户自己花了多少 token,和 Agent 的分开记,算账时两边都要算。
- `SIM_PROMPT = """你在扮演云簿 CloudLedger 的一位客户,正在网页聊天框里和在线客服对话。你不是 AI 助手,不要替客服解释政策,也不要帮客服做事。` 第一句定身份,第二句防它「出戏」。模型被训练成乐于助人的助手,不提醒的话,它听到客服问问题,很可能开始帮客服分析。
- `{persona}` 身份和目标,每条用例自己填。三个占位符都是单层花括号,`.format` 时替换。
- `{hidden}` 被问到才说的信息。比如「原因是集团换了财务系统」「你不知道发票号」。
- `- 每次只说一两句话,像真人在聊天框里打字。` 不写这条,模型扮的客户会一口气写一大段,条理清楚、礼貌周全,真实客户不是这样说话的。
- `- 「被问到才说的信息」只有客服问到相关的事才说,没问就不要主动说。` 这一条决定了能不能测出 Agent 会不会追问。第六步会演示删掉它会怎样。
- `- 不要编造上面没给的信息,比如发票号、金额、日期。客服问到你不知道的,就说不清楚。` 模型很爱「配合」,客服问发票号,它可能顺手编一个 `INV-2026-0099`,Agent 拿去一查查不到,这次失败就算到 Agent 头上了。
- `- 问题解决了(或者客服说清楚了办不了的理由,你也接受),只回复 {done}。` 结束条件。括号里那半句很重要:C012、C002 这种本来就不该退的客户,客服讲清楚了,对话也该结束,不然它会一直纠缠到最大轮数。
- `- 客服连续两次答非所问,表示不满,然后回复 {done}。` 第二个结束条件,防止 Agent 犯糊涂时对话空转。
- `def sim_reply(case: dict, history: list[dict]) -> str:` 输入用例和到目前为止的对话,输出客户的下一句。
- `system = SIM_PROMPT.format(persona=case["persona"], hidden=case["hidden"], done=DONE)` 剧本填进 system。`{done}` 出现了两次,`.format` 会都替换掉。
- `msgs: list = [{"role": "system", "content": system}]` 标成裸 `list` 的原因和 `AgentSession` 一样:不标的话,basedpyright 把它推断成 `list[dict[str, str]]`,传给 `messages=` 时会报类型不匹配。
- `for h in history:      # 角色反过来:模拟客户自己说的是 assistant,客服说的是 user` 上面那张图的代码版。
- `msgs.append({"role": "assistant" if h["role"] == "customer" else "user", "content": h["text"]})` 条件表达式,相当于 JS 的 `h.role === "customer" ? "assistant" : "user"`。LangChain 的 openevals 库里 `create_llm_simulated_user` 也是这么做的,它源码里把 user 改成 assistant、把不带工具调用的 assistant 改成 user。
- `resp = sim.chat.completions.create(model=SIM_MODEL, messages=msgs, temperature=0.7, extra_body=EXTRA)` 温度 0.7,让同一个剧本每次说法略有不同。客户说法变了 Agent 还能办对,才算稳。
- `return (resp.choices[0].message.content or "").strip()` `content` 类型上可能是 None,`or ""` 兜底;`.strip()` 去掉首尾空白,后面判断暗号时更干净。
- `history = [{"role": "customer", "text": "退款"},` 手工造一段两句的对话,不调 Agent,只看模拟客户怎么接。
- `for i in range(3):` 同一段对话让它接三次,看稳不稳。

</div>

```bash
uv run python -m part06.user_sim
```

实测输出:

```text
第 1 次: 不是重复扣款,是我们下个月起不用了,想把剩下的钱退回来。
第 2 次: 我们下个月起不用了,想把剩下的钱退回来。
第 3 次: 不是重复扣款,是我们下个月起不用了,想把剩下的钱退回来。
{'calls': 3, 'in': 687, 'out': 49}
```

三次都回答了客服的问题,一句话,没主动说「集团换了财务系统」(客服没问原因),也没编发票号。三次调用一共 687 个输入、49 个输出 token,一次不到 0.001 元。模拟客户很便宜,钱主要花在 Agent 那边。

### 角色写反会怎样

很多人第一次写会忘了反转,直接把 history 按「客户 = user,客服 = assistant」塞进去。我故意写反跑了一次:

```python
# agent-zero-lab/part06/sim_wrong_role.py
"""故意写错一次:角色不反过来,看模拟客户会变成什么。"""
from __future__ import annotations

from part06.user_sim import DONE, EXTRA, SIM_MODEL, SIM_PROMPT, sim

case = {"persona": "你是云杉律所二店的行政。公司用云簿企业版年付,下个月起不用了,想把剩下的钱退回来。",
        "hidden": "原因:集团统一换了财务系统。你不知道发票号。"}
history = [{"role": "customer", "text": "退款"},
           {"role": "agent", "text": "您好,请问是遇到了重复扣款,还是想中途取消订阅?"}]
msgs: list = [{"role": "system", "content": SIM_PROMPT.format(persona=case["persona"], hidden=case["hidden"], done=DONE)}]
for h in history:          # 错误写法:客户的话当 user,客服的话当 assistant
    msgs.append({"role": "user" if h["role"] == "customer" else "assistant", "content": h["text"]})
for i in range(3):
    resp = sim.chat.completions.create(model=SIM_MODEL, messages=msgs, temperature=0.7, extra_body=EXTRA)
    print(f"第 {i + 1} 次:", resp.choices[0].message.content)
```

<div class="line-notes">

- `msgs.append({"role": "user" if h["role"] == "customer" else "assistant", "content": h["text"]})` 和 `user_sim.py` 唯一的区别:三元表达式两边对调了。这样 messages 的最后一条是 assistant(客服的问题),模型被要求「接着 assistant 往下说」,等于让它接着客服的话说。

</div>

```bash
uv run python -m part06.sim_wrong_role
```

实测输出:

```text
第 1 次: 我们下个月起不用了,想把剩下的钱退回来。
第 2 次: 我们下个月起不用了,想把剩下的钱退回来。
第 3 次: 我们下个月起不用了,想把剩下的钱退回来。
```

出乎我意料,三次都没出错。system prompt 里「你在扮演客户」写得够清楚,deepseek-flash 硬是从角色错乱的历史里认出了自己该说什么。我又换了一个更短的 system prompt(只有一句「你扮演一位客户」)、更长的四句历史,对的写法和错的写法各跑三次,错的那边也都还在以客户身份说话。

这不说明可以不反转。今天碰巧没出事,是因为对话短、system prompt 强;对话一长,messages 里一半以上是「assistant 在解释退款政策」,模型越来越容易接着解释下去。按对的写法写,不赌它。这也是一个提醒:**「故意制造的错误」没复现出来时,照实记下来**,别为了文章好看去改 prompt 硬凑一个错。

## 第四步:跑起来,5 轮对话、4 条用例、每条 3 次

多轮用例比单轮多三个字段:`opening`(客户第一句)、`persona`(身份和目标)、`hidden`(被问到才说的信息)。`scenario` 还是 Day 350 判题器的场景名,期望的退款由判题器从库里算,不手写。

```bash
mkdir -p part06/cases part06/dialogs
```

```json
{"id": "mt-cancel-c023", "customer_id": "C023", "scenario": "cancel", "opening": "退款", "persona": "你是云杉律所二店的行政。公司用云簿企业版年付,下个月起不用了,想把剩下几个月的钱退回来。", "hidden": "原因:集团统一换了一套财务系统。你不知道发票号,也不记得具体付了多少钱。"}
{"id": "mt-dup-c007", "customer_id": "C007", "scenario": "duplicate", "opening": "你们是不是扣了我两次钱", "persona": "你是半岛咖啡的老板,说话比较急。你在银行 App 上看到 10 月 8 号被云簿扣了两笔一样的钱,想把多扣的那笔要回来。", "hidden": "两笔都是 2392 元,都是 10 月 8 号。你不知道发票号。"}
{"id": "mt-dup-c012", "customer_id": "C012", "scenario": "duplicate", "opening": "你们是不是多扣我钱了", "persona": "你是海盐文创的老板,说话很简略。你记得 10 月好像被云簿扣了两次钱,但没仔细看。", "hidden": "你其实只记得 10 月 8 号前后有两笔扣款,金额记不清。如果客服说明系统里只有一笔、或者那笔还没付款,你就接受,不再坚持。"}
{"id": "mt-monthly-c002", "customer_id": "C002", "scenario": "cancel", "opening": "不想用了,钱退我", "persona": "你是青木设计的负责人,有点着急。你们用的是云簿专业版,这个月刚扣了钱,团队以后不用了,想把这个月的钱退掉。", "hidden": "你们是月付的。如果客服解释了月付不退、说清楚可以用到本期结束,你虽然不太高兴,但接受。"}
```

把这四行存成 `part06/cases/multiturn.jsonl`(一行一条,[Day 348](/blog/agent-zero/day-348-testcase-structure/) 的 JSONL 格式)。四条用例两条该退、两条不该退:

| 用例 | 客户 | 判题器的答案 | 测什么 |
| --- | --- | --- | --- |
| mt-cancel-c023 | 企业版年付 2 席位 | 退 INV-2026-0091,6578 元 | 只说「退款」两个字,Agent 会不会问清是哪种 |
| mt-dup-c007 | 企业版月付 8 席位 | 退 INV-2026-0123,2392 元 | 正常的重复扣款 |
| mt-dup-c012 | 基础版月付 | 不退 | 客户记错了,Agent 会不会被带跑 |
| mt-monthly-c002 | 专业版月付 | 不退 | 月付不退,客户着急,Agent 能不能讲清楚 |

C002 青木设计是今天新用到的客户,专业版月付 2 席位,10 月 11 日刚付了 198 元。按政策第 2 条,月付中途取消不退,判题器 `expected_refund("C002", "cancel")` 返回 `None`。

`hidden` 里写的都是「客户知道但不会主动说」的东西。C007 的 hidden 写了金额和日期,是因为真实客户确实看得到银行流水;但发票号他不知道,写明了,免得模拟客户编一个。

下面是跑多轮评测的脚本。判分复用前两天的东西:结果看库里的退款,轨迹用 Day 361 的三个检查。

```python
# agent-zero-lab/part06/run_multiturn.py
"""多轮评测:模拟客户和 Agent 对话,最多 5 轮;结束后查库判结果、查轨迹判过程。
用法: uv run python -m part06.run_multiturn part06/cases/multiturn.jsonl 3"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from part06.agent_session import AgentSession
from part06.oracle import expected_refund
from part06.trajectory import check_no_repeat, check_order, check_scope
from part06.user_sim import DONE, SIM_USAGE, sim_reply


def run_dialog(case: dict, max_turns: int = 5) -> dict:
    session = AgentSession(case["customer_id"])
    history = [{"role": "customer", "text": case["opening"]}]
    end = "max_turns"
    for _ in range(max_turns):
        history.append({"role": "agent", "text": session.send(history[-1]["text"])})
        said = sim_reply(case, history)
        if DONE in said:
            end = "done"
            break
        history.append({"role": "customer", "text": said})
    run = session.finish()
    return {**run, "case": case["id"], "history": history, "end": end,
            "turns": sum(h["role"] == "agent" for h in history)}


def outcome(case: dict, run: dict) -> tuple[bool, str]:
    want = expected_refund(case["customer_id"], case["scenario"])
    got = [(r["invoice_id"], r["amount_cents"] / 100) for r in run["refunds"]]
    if want is None:
        return (not got), ("" if not got else f"不该退却退了 {got}")
    ok = got == [(want["invoice_id"], want["amount_yuan"])]
    return ok, "" if ok else f"期望 {want['invoice_id']} {want['amount_yuan']},实际 {got}"


def grade(case: dict, run: dict) -> dict[str, tuple[bool, str]]:
    return {"outcome": outcome(case, run), "traj:order": check_order(run),
            "traj:scope": check_scope(run), "traj:no_repeat": check_no_repeat(run),
            "finished": (run["end"] == "done", "" if run["end"] == "done" else "5 轮还没聊完")}


if __name__ == "__main__":
    cases = [json.loads(line) for line in Path(sys.argv[1]).read_text(encoding="utf-8").splitlines() if line.strip()]
    k = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    agent_tokens = {"in": 0, "out": 0}
    for case in cases:
        passed = 0
        for i in range(1, k + 1):
            run = run_dialog(case)
            res = grade(case, run)
            fails = [f"{name}: {why}" for name, (ok, why) in res.items() if not ok]
            passed += not fails
            agent_tokens["in"] += run["tokens"]["in"]
            agent_tokens["out"] += run["tokens"]["out"]
            Path(f"part06/dialogs/{case['id']}-{i}.json").write_text(
                json.dumps({**run, "grades": res}, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"{case['id']}-{i}  {'PASS' if not fails else 'FAIL'}  {run['turns']} 轮  "
                  f"{[tc['name'] for tc in run['tool_calls']]}  {'; '.join(fails)}")
        print(f"   pass^{k} = {'1' if passed == k else '0'}  ({passed}/{k} 次通过)\n")
    print(f"Agent token: {agent_tokens}  模拟客户: {SIM_USAGE}")
```

<div class="line-notes">

- `from part06.trajectory import check_no_repeat, check_order, check_scope` Day 361 的五个检查只拿三个。`check_refund_args` 和 `check_budget` 不拿:前者里的 `SCENARIO` 字典没有 C002,会 `KeyError`;后者的 8000 token 上限是按单轮定的,多轮每轮都要重发历史,token 天然多,直接套会全红。练习里会说多轮的预算该怎么定。
- `def run_dialog(case: dict, max_turns: int = 5) -> dict:` 一段对话最多 5 轮,也就是客服最多说 5 次。两个模型对聊,不设上限可能聊个没完,每多一轮都在花钱。
- `session = AgentSession(case["customer_id"])` 每段对话一个新对象,也就是一份新的临时库。
- `history = [{"role": "customer", "text": case["opening"]}]` 我们自己存的对话记录,角色用 customer 和 agent。第一句来自用例,C023 那条只有「退款」两个字。
- `end = "max_turns"` 先假设是聊到上限才停的,中途收到暗号再改成 `"done"`。
- `history.append({"role": "agent", "text": session.send(history[-1]["text"])})` 把客户最新那句发给 Agent,拿回复追加到记录里。`history[-1]` 是列表最后一项,相当于 JS 的 `history.at(-1)`。
- `said = sim_reply(case, history)` 模拟客户看完整段记录,说下一句。
- `if DONE in said:` 用 `in` 不用 `==`,模型偶尔会在暗号前后多带几个字或一个句号。
- `history.append({"role": "customer", "text": said})` 没结束,记下客户的话,进下一轮。暗号那句不记,它不是客户真说的话。
- `return {**run, "case": case["id"], "history": history, "end": end,` 把 `finish()` 返回的最终状态和轨迹展开,再加上对话记录和结束方式。`**run` 是字典展开,相当于 JS 的 `{...run, case: ...}`。
- `"turns": sum(h["role"] == "agent" for h in history)}` 布尔值求和就是计数,客服说了几次就是几轮。
- `def outcome(case: dict, run: dict) -> tuple[bool, str]:` 和 Day 360 的 `outcome_ok` 一样的逻辑,只是场景从用例里读,不再查 `SCENARIO` 字典。Day 361 说过「正式的测试集里场景是用例字段」,这里就是。
- `want = expected_refund(case["customer_id"], case["scenario"])` C023 得到 `INV-2026-0091`、`6578.0`;C007 得到 `INV-2026-0123`、`2392.0`;C012 和 C002 得到 `None`。
- `ok = got == [(want["invoice_id"], want["amount_yuan"])]` 正好一条,发票号和金额都对。
- `"finished": (run["end"] == "done", "" if run["end"] == "done" else "5 轮还没聊完")}` 第五个判分项:对话是正常结束的,还是聊到上限被掐断的。聊满 5 轮还没结束,通常说明 Agent 在原地打转,或者模拟客户在纠缠,都值得点开看。
- `k = int(sys.argv[2]) if len(sys.argv) > 2 else 1` 第二个命令行参数是每条用例跑几次,不给就跑一次。
- `passed += not fails` `not []` 是 True,True 当 1 加。全过一次就加 1。
- `Path(f"part06/dialogs/{case['id']}-{i}.json").write_text(` 每段对话连同判分结果存一个文件,第五步要读。
- `print(f"   pass^{k} = {'1' if passed == k else '0'}  ({passed}/{k} 次通过)\n")` pass^k 对单条用例来说就是「k 次是不是全过」。Day 344 讲过,面向客户的场景看这个,因为每个客户只会遇到一次。

</div>

```bash
uv run python -m part06.run_multiturn part06/cases/multiturn.jsonl 3
```

实测输出:

```text
mt-cancel-c023-1  PASS  4 轮  ['get_subscription', 'list_invoices', 'search_policy', 'create_refund_request']  
mt-cancel-c023-2  PASS  3 轮  ['get_subscription', 'list_invoices', 'create_refund_request']  
mt-cancel-c023-3  PASS  3 轮  ['get_subscription', 'list_invoices', 'search_policy', 'create_refund_request']  
   pass^3 = 1  (3/3 次通过)

mt-dup-c007-1  PASS  2 轮  ['get_subscription', 'list_invoices', 'search_policy', 'create_refund_request']  
mt-dup-c007-2  PASS  2 轮  ['get_subscription', 'list_invoices', 'create_refund_request']  
mt-dup-c007-3  PASS  3 轮  ['get_subscription', 'list_invoices', 'search_policy', 'create_refund_request']  
   pass^3 = 1  (3/3 次通过)

mt-dup-c012-1  PASS  2 轮  ['get_subscription', 'list_invoices']  
mt-dup-c012-2  PASS  2 轮  ['get_subscription', 'list_invoices', 'list_invoices']  
mt-dup-c012-3  PASS  1 轮  ['get_subscription', 'list_invoices']  
   pass^3 = 1  (3/3 次通过)

mt-monthly-c002-1  PASS  2 轮  ['get_subscription', 'list_invoices']  
mt-monthly-c002-2  PASS  2 轮  ['get_subscription', 'list_invoices']  
mt-monthly-c002-3  PASS  3 轮  ['get_subscription', 'list_invoices']  
   pass^3 = 1  (3/3 次通过)

Agent token: {'in': 62810, 'out': 9127}  模拟客户: {'calls': 29, 'in': 19109, 'out': 381}
```

12 段全过,四条用例 pass^3 都是 1。同一条用例,轮数在 1 到 4 之间变,因为模拟客户温度 0.7,每次说法不同;工具路径也在变,有时多查一次政策,有时不查,Day 361 的规则检查对这些都不管,这正是我们要的。`mt-dup-c012-2` 查了两次 `list_invoices` 也没被 `no_repeat` 判失败,打开 JSON 一看,两次 `limit` 不一样(10 和 20),参数不同不算重复,也符合 Day 361 的定义。

算账,按 [DeepSeek 价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 2026 年 10 月查到的 deepseek-flash 高峰价(未命中缓存的输入 2 元、输出 8 元,每百万 token),输入全按未命中算是上限:

- Agent:62810 × 2 / 100 万 + 9127 × 8 / 100 万 ≈ 0.126 + 0.073 = 0.199 元
- 模拟客户:19109 × 2 / 100 万 + 381 × 8 / 100 万 ≈ 0.038 + 0.003 = 0.041 元

这一轮 0.24 元,一段对话 2 分钱。加上第一到第三步的几次调用(约 0.05 元)、第六步的对照实验(约 0.005 元)、练习 1、3、4(约 0.10 元),今天合计约 0.40 元。注意 Agent 的输入 token 是输出的七倍:每轮都把前面的全部对话重发一遍,轮数越多,前面的消息被重复计费的次数越多。DeepSeek 的缓存会命中一部分前缀,真实账单比这个上限低,Day 359 算过怎么看命中数。

## 第五步:读对话,分数里看不到的东西

12 个 PASS,看着很舒服。但 Day 360 就说过,结果对了不代表过程没问题;多轮对话还多了一样东西:Agent 每一轮说的话。这些话结果评测不看,轨迹检查也不看。我把 12 段对话全打开读了一遍。

先看一段正常的,`part06/dialogs/mt-cancel-c023-2.json`(只摘要点):

```text
customer: 退款
agent:    我查到了 C023 的信息,但需要您确认一下退款原因,因为不同情况适用的规则不同:……
          1. 年付中途取消:……可退 598 × 11 = 6578 元。
          2. 重复扣款:……这里三张发票日期各不相同,不构成重复扣款……
          请确认:您是要办理年付中途取消退款吗?……
customer: 是年付中途取消退款,我们集团统一换财务系统了,下个月起就不用了。
agent:    退款申请已提交,详情如下:……发票号 INV-2026-0091,退款金额 6578 元……
customer: 好的,那我们就等审批结果,麻烦你了。
agent:    好的,没问题!退款申请已提交,状态为待主管审批……
```

客户第一句只有「退款」,Agent 先查、再问,客户答了才提交。模拟客户也守规矩:「集团换财务系统」是 hidden 里的信息,客服问了「退款原因」它才说。这就是多轮评测想看到的东西,单轮测不出「会不会问」。

再看两个问题。

**问题一:Agent 编了一条后台操作路径。** `mt-monthly-c002-1` 第二轮,客户说「那就用到 11 月 11 号,之后别再扣了」,Agent 回:

```text
不过要说明一下：我这边没有直接取消订阅或关闭自动续费的权限，只能提交退款申请。所以「之后别再扣了」这件事，需要您通过以下任一方式处理：

1. **在云簿后台自助取消**：账户设置 → 订阅管理 → 取消自动续费（取消后服务到本期结束，不再扣费）
```

「账户设置 → 订阅管理 → 取消自动续费」这条路径,system prompt 里没有,四个工具也查不到。它是编的。`mt-monthly-c002-2` 编的是另一条:「登录云簿 → 设置 → 订阅与计费 → 关闭自动续费(推荐,立即生效)」,两次编得还不一样。客户照着找,找不到。

这个问题有三个特点:只在多轮里出现(单轮工单「不想用了,钱退我」,Agent 讲完不退就结束了,客户的追问「之后别再扣了」根本不会发生);结果评测满分(不该退,确实没退);轨迹检查满分(只查了本人的订阅和发票)。它就藏在 Agent 说的话里。

**问题二:客户只是问一句,Agent 就把退款提交了。** `mt-dup-c007` 三次都是第一轮就提交了退款。客户第一句是「你们是不是扣了我两次钱」,这是一个问句。`mt-dup-c007-3` 里,模拟客户的反应是:

```text
customer: 你们是不是扣了我两次钱
agent:    已经帮您提交好了 ✅ 退款申请摘要 - 发票号：INV-2026-0123 - 金额：2392.00 元 ……
customer: 等等，你说的发票号我根本不知道，你怎么就提交了？我就想问多扣的那笔什么时候能退回来。
agent:    抱歉，我操作得太快了，应该先跟您确认再提交的。……
```

客户其实是想退的(persona 写了「想把多扣的那笔要回来」),所以结果没错,判 PASS 也说得过去。但 Agent 自己都承认「操作得太快了」。Day 360 讨论过 C023「说了没做」那两次,今天是反过来的「没说就做」。哪种对,是业务方该定的规矩;定了以后,这类规矩只有在多轮里才能测,因为「先确认再提交」至少需要两轮。

这两个问题都没被分数抓住。Day 345 讲错误分析时说过,前几批一定要自己读 trace;多轮对话更是这样,**分数告诉你哪里坏了,对话告诉你还有哪里不对劲**。练习 2 和练习 4 会把这两类问题各写成一个检查。

## 第六步:模拟客户自己也要检查

模拟客户是一个模型,它也会演砸,而且演砸的结果会伪装成 Agent 的失败(或者成功)。常见的有四种:

- 太配合:客服还没问,它就把 hidden 里的信息全说了,测不出 Agent 会不会追问。
- 编信息:剧本没给发票号,它编一个,Agent 查不到,失败算到 Agent 头上。
- 出戏:开始替客服解释政策,或者说话变成客服腔。
- 太早结束或者一直不结束:客服说「我帮您看看」它就输出暗号;或者客服讲清楚了它还在纠缠。

先看规则写得弱会怎样。下面把 `SIM_PROMPT` 里「规则」那一段整个删掉,只留身份和信息,同一段对话各接三次:

```python
# agent-zero-lab/part06/sim_weak.py
"""对照实验:把「规则」那一段删掉,模拟客户会不会主动全说、会不会编发票号。"""
from __future__ import annotations

import json
from pathlib import Path

from part06.user_sim import EXTRA, SIM_MODEL, sim, sim_reply

WEAK = "你在扮演云簿 CloudLedger 的一位客户,正在和在线客服对话。\n{persona}\n{hidden}"
case = json.loads(Path("part06/cases/multiturn.jsonl").read_text(encoding="utf-8").splitlines()[0])
history = [{"role": "customer", "text": "退款"},
           {"role": "agent", "text": "您好,麻烦提供一下要退的发票号和金额,我帮您查。"}]
weak_msgs: list = [{"role": "system", "content": WEAK.format(persona=case["persona"], hidden=case["hidden"])},
             {"role": "assistant", "content": "退款"}, {"role": "user", "content": history[1]["text"]}]
for i in range(1, 4):
    print(f"完整版 {i}:", sim_reply(case, history))
    resp = sim.chat.completions.create(model=SIM_MODEL, messages=weak_msgs, temperature=0.7, extra_body=EXTRA)
    print(f"删规则 {i}:", (resp.choices[0].message.content or "").strip())
```

<div class="line-notes">

- `WEAK = "你在扮演云簿 CloudLedger 的一位客户,正在和在线客服对话。\n{persona}\n{hidden}"` 弱版 prompt:身份和 hidden 都在,但没说 hidden 要被问到才说、没说不许编、没说话要短。
- `case = json.loads(Path("part06/cases/multiturn.jsonl").read_text(encoding="utf-8").splitlines()[0])` 取第一条用例,C023。它的 hidden 是「原因:集团换了财务系统。你不知道发票号,也不记得具体付了多少钱」。
- `{"role": "agent", "text": "您好,麻烦提供一下要退的发票号和金额,我帮您查。"}]` 故意让客服问一个客户答不上来的问题,最容易诱出编造。
- `{"role": "assistant", "content": "退款"}, {"role": "user", "content": history[1]["text"]}]` 弱版的角色也是反过来的,只比规则那一处不同。
- `print(f"完整版 {i}:", sim_reply(case, history))` 完整版直接调 `sim_reply`,同样的历史。

</div>

```bash
uv run python -m part06.sim_weak
```

实测输出:

```text
完整版 1: 发票号我不记得了,金额也不清楚。
删规则 1: 您好。发票号我这边确实找不到了，当时是财务那边处理的。金额我也不太记得具体数，好像是年付的企业版，能不能麻烦您按我们公司名称帮我查一下？
完整版 2: 发票号我不记得了,具体付了多少钱我也不太清楚。
删规则 2: 您好,发票号我这边确实找不到了,金额也记不太清,好像是年付的。能不能用公司名称帮您查一下?
完整版 3: 发票号我不记得了,金额也不清楚,能帮我查一下吗?
删规则 3: 您好，发票号我这边确实找不到了，金额也记不太清，能麻烦您按我们公司名称查一下吗？云杉律所二店，企业版年付。
```

两边都没编发票号,deepseek-flash 在这一点上挺老实。差别在别处:删了规则的版本每次都比完整版长一倍多,还主动交代了「年付的企业版」,第 3 次连公司名和套餐一起报了。客服根本没问套餐。这就是「太配合」:要是 Agent 自己不查订阅,全靠客户说的「企业版年付」去算钱,这条用例也会过,你就测不出它会不会自己去查。规则那几行不是摆设。

读 12 段对话很累,可以先用代码筛一遍。下面三条规则不调模型,扫出可疑的句子再人工看:

```python
# agent-zero-lab/part06/sim_check.py
"""检查模拟客户本身:编没编发票号、有没有说成客服腔、是不是一句话太长。不调模型。"""
from __future__ import annotations

import json
import re
from pathlib import Path

AGENT_WORDS = ["为您", "根据政策", "我帮您查", "请问您", "审批通过后"]


def check_sim(history: list[dict]) -> list[str]:
    problems = []
    agent_said = ""
    for i, h in enumerate(history):
        if h["role"] == "agent":
            agent_said += h["text"]
            continue
        for inv in re.findall(r"INV-\d{4}-\d{4}", h["text"]):
            if inv not in agent_said:
                problems.append(f"第 {i} 句编了发票号 {inv}")
        hit = [w for w in AGENT_WORDS if w in h["text"]]
        if hit:
            problems.append(f"第 {i} 句像客服在说话 {hit}")
        if len(h["text"]) > 80:
            problems.append(f"第 {i} 句太长({len(h['text'])} 字)")
    return problems


if __name__ == "__main__":
    for path in sorted(Path("part06/dialogs").glob("*.json")):
        d = json.loads(path.read_text(encoding="utf-8"))
        probs = check_sim(d["history"])
        lens = [len(h["text"]) for h in d["history"] if h["role"] == "customer"]
        print(f"{path.stem:<20} 客户 {len(lens)} 句,字数 {lens}  {'; '.join(probs) or '没发现问题'}")
```

<div class="line-notes">

- `import re` 正则表达式标准库。`re.findall(模式, 文本)` 返回所有匹配的字符串列表,相当于 JS 的 `text.match(/.../g)`。
- `AGENT_WORDS = ["为您", "根据政策", "我帮您查", "请问您", "审批通过后"]` 客服常用、客户很少说的词。粗糙,但够用来筛。
- `agent_said = ""` 到当前这句为止,客服说过的所有话拼成一个字符串。
- `for i, h in enumerate(history):` `i` 是这句在整段对话里的位置,从 0 开始,0 是客户第一句。
- `agent_said += h["text"]` 客服的话只累加,不检查,`continue` 跳到下一句。
- `for inv in re.findall(r"INV-\d{4}-\d{4}", h["text"]):` 找客户这句话里所有形如 `INV-2026-0123` 的发票号。`r"..."` 是原始字符串,反斜杠不转义,写正则时都这么写。`\d{4}` 是四位数字。
- `if inv not in agent_said:` 客户提到的发票号,客服之前从没说过,那只能是模拟客户编的(剧本里都写了「你不知道发票号」)。
- `if len(h["text"]) > 80:` 规则要求「一两句话」,80 字是我从完整版的输出里看的上限,删规则版那几句都在 70 字以上。
- `lens = [len(h["text"]) for h in d["history"] if h["role"] == "customer"]` 顺便打印客户每句的字数,一眼看出说话风格。

</div>

```bash
uv run python -m part06.sim_check
```

实测输出:

```text
mt-cancel-c023-1     客户 4 句,字数 [2, 15, 11, 18]  没发现问题
mt-cancel-c023-2     客户 3 句,字数 [2, 32, 18]  没发现问题
mt-cancel-c023-3     客户 3 句,字数 [2, 23, 20]  没发现问题
mt-dup-c007-1        客户 2 句,字数 [11, 19]  没发现问题
mt-dup-c007-2        客户 2 句,字数 [11, 33]  没发现问题
mt-dup-c007-3        客户 3 句,字数 [11, 42, 34]  没发现问题
mt-dup-c012-1        客户 2 句,字数 [10, 11]  没发现问题
mt-dup-c012-2        客户 2 句,字数 [10, 25]  没发现问题
mt-dup-c012-3        客户 1 句,字数 [10]  没发现问题
mt-monthly-c002-1    客户 2 句,字数 [8, 35]  没发现问题
mt-monthly-c002-2    客户 2 句,字数 [8, 21]  没发现问题
mt-monthly-c002-3    客户 3 句,字数 [8, 24, 11]  没发现问题
```

12 段都干净,客户每句最长 42 字。代码筛不出来的问题(比如「太早结束」),还是得读。我读下来,唯一可以挑的是 `mt-dup-c012-3`:客户只说了一句,Agent 一回复它就输出了暗号。打开看,Agent 第一轮就把五张发票列出来,说明 10 月 8 号那张还没付、不存在重复扣款,hidden 里写了「客服说明那笔还没付款,你就接受」,所以这次结束是对的。

模拟客户的检查没有标准做法,我的习惯是:新写一个剧本,先跑 3 次全读;改了 `SIM_PROMPT`,先跑 `sim_check.py` 再抽读几段。模拟客户的 prompt 也要像 Day 357 的评分器 prompt 一样记版本号,不然哪天分数变了,你分不清是 Agent 变了还是客户变了。

### 小结

多轮评测的输入不能写死,因为客户的下一句取决于客服的上一句。模拟客户就是一次普通的模型调用,难点在两处:角色反过来(模拟客户自己是 assistant),规则写清楚(被问才说、不许编、话要短、什么时候结束)。判分方式和单轮一样,对话结束后看库、看轨迹;但多轮多了 Agent 每一轮说的话,今天两个问题(编操作路径、没确认就提交)都藏在那里。模拟客户自己也会演砸,要检查,要记版本。

## 动手练习

### 练习 1:加一条容易错的用例

给 C013 长风汽修写一条多轮用例,跑 2 次。先查一下它的数据:专业版年付 1 席位,本期到 2027-10-09,但 2026-10-09 那张 1188 元的年费发票状态是 `open`(还没付)。判题器怎么判?Agent 会不会错?

<details><summary>参考答案</summary>

先看判题器。Day 350 的 `oracle.py` 里,年付取消场景有一条「最新一张发票没付就不退」:

```bash
uv run python -c "from part06.oracle import expected_refund; print(expected_refund('C013', 'cancel'))"
```

<div class="line-notes">

- `uv run python -c "from part06.oracle import expected_refund; print(expected_refund('C013', 'cancel'))"` `-c` 后面直接跟一段 Python 代码,不用建文件。在 `agent-zero-lab` 根目录跑,`part06` 才能被 import。

</div>

实测输出 `None`:不该退。这是一个陷阱:去年那张 INV-2026-0051 是已付的,金额也是 1188 元,Agent 要是没看发票状态,很可能按「年付取消、剩 11 个整月」算出 99 × 11 = 1089 元,拿已付的旧发票去退。

用例存成 `part06/cases/multiturn_ex1.jsonl`(一行):

```json
{"id": "mt-cancel-c013", "customer_id": "C013", "scenario": "cancel", "opening": "年费能退吗", "persona": "你是长风汽修的老板,用的是云簿专业版年付,一个账号。店要关了,想问问剩下的年费能不能退。", "hidden": "你记得去年 10 月付过一次年费。今年 10 月的账单你还没付,因为店要关了。"}
```

```bash
uv run python -m part06.run_multiturn part06/cases/multiturn_ex1.jsonl 2
```

实测输出:

```text
mt-cancel-c013-1  PASS  4 轮  ['get_subscription', 'list_invoices']  
mt-cancel-c013-2  PASS  3 轮  ['get_subscription', 'search_policy', 'list_invoices']  
   pass^2 = 1  (2/2 次通过)

Agent token: {'in': 13740, 'out': 2139}  模拟客户: {'calls': 7, 'in': 6053, 'out': 105}
```

两次都没退款,PASS。可读一下对话,两次的第一轮都说错了。`mt-cancel-c013-2` 第一轮,Agent 只查了订阅就回答:

```text
可以退。 专业版年付中途取消，按剩余整月退款，当月不退：
- 每席位月价 99 元 × 1 席位 = 99 元/月
- 从今天 2026-10-12 到 2027-10-09，扣除当月后剩余整月约为 11 个月……
```

它还没查发票,就承诺了「可以退」。后来客户说「发票我记不清了,你帮我查一下吧」,它才查到本期没付,改口。`mt-cancel-c013-1` 也一样,是模拟客户说了句「我今年 10 月的账单还没付呢,怎么说到 2027 年了?」才把它拉回来。

也就是说,这两次 PASS 有一半功劳是模拟客户的:它按 hidden 的设定提到了「今年还没付」,Agent 才没犯错。换一个不提这茬的客户,Agent 很可能拿着「可以退」一路走下去。这条用例值得留在测试集里,而且该补一条 hidden 里不提「没付」的变体。另外 Day 361 的轨迹规则只要求「退款前查过发票」,这里没退款,规则管不着;「给出退款结论前查过发票」得靠练习 4 那种逐轮检查。

</details>

### 练习 2:把「编操作路径」写成检查

不调模型。扫 `part06/dialogs/` 里所有 Agent 的话,找出提到后台操作路径的句子(带「→」或「后台」的)。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part06/ex362_ui_path.py
"""练习 2:找出 Agent 回复里自己编的「后台操作路径」。不调模型。"""
from __future__ import annotations

import json
import re
from pathlib import Path

PATTERN = re.compile(r"[^。\n]*(?:→|后台)[^。\n]*")

for path in sorted(Path("part06/dialogs").glob("*.json")):
    d = json.loads(path.read_text(encoding="utf-8"))
    for i, h in enumerate(d["history"]):
        if h["role"] != "agent":
            continue
        for m in PATTERN.findall(h["text"]):
            print(f"{path.stem:<20} 第 {i} 句: {m.strip()[:70]}")
```

<div class="line-notes">

- `PATTERN = re.compile(r"[^。\n]*(?:→|后台)[^。\n]*")` 预先编译正则,循环里反复用更快。`[^。\n]*` 是「任意个不是句号、不是换行的字符」,前后各一段,意思是把包含「→」或「后台」的那一整句抠出来。`(?:...|...)` 是不捕获的分组,`|` 是「或」。
- `for m in PATTERN.findall(h["text"]):` 一段回复里可能有好几句命中,逐句打印。
- `print(f"{path.stem:<20} 第 {i} 句: {m.strip()[:70]}")` 只看前 70 字,够判断了。

</div>

```bash
uv run python -m part06.ex362_ui_path
```

实测输出(练习 1 跑完以后,目录里有 14 段对话):

```text
mt-cancel-c013-1     第 7 句: - 关联账单：INV-2026-0050，1188 元，状态未支付 → 请作废，客户不再支付
mt-cancel-c013-2     第 5 句: 1. 登录云簿后台 → 订阅/账单页面 → 找到"取消订阅"入口自助操作；
mt-cancel-c023-1     第 5 句: 订阅的实际取消需要由主管或后台运营同事在审批退款时一并操作
mt-monthly-c002-1    第 3 句: 1. **在云簿后台自助取消**：账户设置 → 订阅管理 → 取消自动续费（取消后服务到本期结束，不再扣费）
mt-monthly-c002-2    第 3 句: 1. **在后台自助操作**：登录云簿 → 设置 → 订阅与计费 → 关闭自动续费（推荐，立即生效）
mt-monthly-c002-2    第 3 句: 2. 如果后台操作不了，可以联系人工客服或您的客户经理帮您关闭
mt-monthly-c002-3    第 3 句: - 在云簿后台的「订阅/计费」页面关闭自动续费；
mt-monthly-c002-3    第 5 句: 好的，那您在后台「订阅/计费」页面关闭自动续费即可，本期可以用到 2026-11-11
```

8 处命中,人工过一遍:真正编了路径的是 `mt-cancel-c013-2` 和 C002 那三段(一共 5 处);`mt-cancel-c013-1` 那条是箭头当连接符用,`mt-cancel-c023-1` 和 C002-2 第二条只是提到「后台同事」「后台操作不了」,没编具体路径。这就是关键词检查的典型样子:召回不错,准确率一般,适合当筛子,不适合直接当分数。

这个问题的根子不在评测,在知识:Agent 手里没有「怎么取消续费」的资料,客户又问了,它就编。修法是给它一篇帮助中心文章(第四部分 RAG 讲过),或者在 system prompt 里写「不知道操作路径就说转人工,不要描述界面」。修完用这个脚本验证命中数降下来。

</details>

### 练习 3:退款是在第几轮提交的

在 `run_dialog` 的基础上记下「退款是第几轮提交的」,拿 `mt-dup-c007` 跑 2 次。客户第一句是问句,Agent 有没有先确认?

<details><summary>参考答案</summary>

`AgentSession` 不记每个工具调用发生在第几轮。不用改它:每轮 `send` 前后各看一眼 `tool_calls` 的长度,新增的那几个就是这一轮的。

```python
# agent-zero-lab/part06/ex362_when_refund.py
"""练习 3:记下退款是在第几轮提交的,客户只是「问一下」时 Agent 有没有先确认。"""
from __future__ import annotations

import json
from pathlib import Path

from part06.agent_session import AgentSession
from part06.user_sim import DONE, sim_reply

case = json.loads(Path("part06/cases/multiturn.jsonl").read_text(encoding="utf-8").splitlines()[1])   # mt-dup-c007
for k in range(1, 3):
    session = AgentSession(case["customer_id"])
    history = [{"role": "customer", "text": case["opening"]}]
    refund_turn = None
    for turn in range(1, 6):
        before = len(session.tool_calls)
        history.append({"role": "agent", "text": session.send(history[-1]["text"])})
        new = [tc["name"] for tc in session.tool_calls[before:]]
        if "create_refund_request" in new and refund_turn is None:
            refund_turn = turn
        said = sim_reply(case, history)
        if DONE in said:
            break
        history.append({"role": "customer", "text": said})
    session.finish()
    print(f"第 {k} 次:退款在第 {refund_turn} 轮提交;客户第 2 句: {history[2]['text'] if len(history) > 2 else '(直接结束)'}")
```

<div class="line-notes">

- `case = json.loads(Path("part06/cases/multiturn.jsonl").read_text(encoding="utf-8").splitlines()[1])   # mt-dup-c007` 第二行是 C007 那条。
- `refund_turn = None` 还没提交过退款。
- `before = len(session.tool_calls)` 这一轮开始前,轨迹里已经有几个调用。
- `new = [tc["name"] for tc in session.tool_calls[before:]]` 切片 `[before:]` 取从 `before` 到末尾的部分,就是这一轮新增的调用。相当于 JS 的 `arr.slice(before)`。
- `if "create_refund_request" in new and refund_turn is None:` 只记第一次提交退款的轮次。
- `print(f"第 {k} 次:退款在第 {refund_turn} 轮提交;客户第 2 句: {history[2]['text'] if len(history) > 2 else '(直接结束)'}")` `history[2]` 是客户第二句(0 是客户第一句,1 是客服第一句)。客户第一轮就满意了的话 history 只有两项,所以先判断长度。

</div>

```bash
uv run python -m part06.ex362_when_refund
```

实测输出:

```text
第 1 次:退款在第 1 轮提交;客户第 2 句: 那这笔钱什么时候能退到账上？
第 2 次:退款在第 1 轮提交;客户第 2 句: 等等，我 10 月 8 号被扣了两笔一样的钱，都是 2392，你们只退一笔对吧？
```

加上正文的 3 次,5 次全是第一轮就提交。客户第一句「你们是不是扣了我两次钱」是问句,Agent 一次都没先确认。如果业务方定的规矩是「退款前先跟客户确认金额」,这个检查就可以写成:`refund_turn == 1` 判失败。单轮评测写不出这条规则,因为单轮只有一轮。

</details>

### 练习 4(开放题):逐轮判客服说的话

练习 1 的两段 C013 对话结果都是 PASS,但第一轮都说了「可以退」。用 Day 357 的 `judge_facts`,对每一轮客服回复判一次,看能不能把那两句抓出来。要点自己写。

<details><summary>参考答案</summary>

一个示范写法。要点写两条:本期没付所以没得退;不能承诺免掉未付账单(读对话时我发现 Agent 在 `mt-cancel-c013-1` 里说了「这笔未付账单您不用支付了」,这是它没有权限做的承诺)。

```python
# agent-zero-lab/part06/ex362_per_turn.py
"""练习 4:结果评测给 C013 两段对话都判了 PASS。用 Day 357 的 judge_facts 逐轮判客服的每一句。"""
from __future__ import annotations

import json
from pathlib import Path

from part06.llm_judge import USAGE, judge_facts

FACTS = ["本期(2026-10-09 那张)年费还没付,没有可退的钱", "不能承诺免除或作废未付账单,只能转交处理"]

for name in ["mt-cancel-c013-1", "mt-cancel-c013-2"]:
    d = json.loads(Path(f"part06/dialogs/{name}.json").read_text(encoding="utf-8"))
    hist = d["history"]
    for i, h in enumerate(hist):
        if h["role"] != "agent":
            continue
        ticket = "\n".join(f"{x['role']}: {x['text']}" for x in hist[:i] if x["role"] == "customer")
        v = judge_facts(ticket, h["text"], FACTS)
        print(f"{name} 第 {i} 句 {v.verdict:<7} {v.critique[:70]}")
print(USAGE)
```

<div class="line-notes">

- `from part06.llm_judge import USAGE, judge_facts` Day 357 的要点覆盖评分器,输入工单、回复、要点列表,输出 `Verdict(critique, verdict)`。
- `FACTS = ["本期(2026-10-09 那张)年费还没付,没有可退的钱", "不能承诺免除或作废未付账单,只能转交处理"]` 第二条其实是一条「禁止」,下面会看到这样写的副作用。
- `ticket = "\n".join(f"{x['role']}: {x['text']}" for x in hist[:i] if x["role"] == "customer")` 把这一句之前客户说过的所有话拼起来当「工单」,评分器才知道客户问到哪了。`hist[:i]` 是第 i 句之前的部分。
- `print(f"{name} 第 {i} 句 {v.verdict:<7} {v.critique[:70]}")` `:<7` 左对齐占 7 格,`pass`、`fail`、`unknown` 能排齐。

</div>

```bash
uv run python -m part06.ex362_per_turn
```

实测输出:

```text
mt-cancel-c013-1 第 1 句 fail    要点1「本期(2026-10-09 那张)年费还没付,没有可退的钱」完全没有表达,回复反而说本期刚续费不久、可以按剩余整月退款,与「还没付、
mt-cancel-c013-1 第 3 句 fail    要点1「本期年费还没付、没有可退的钱」已表达：明确说 INV-2026-0050 未支付、谈不上退款。要点2「不能承诺免除或作废未付账单，只
mt-cancel-c013-1 第 5 句 fail    要点1「本期年费还没付、没有可退的钱」表达了(未付账单不涉及退款);但要点2「不能承诺免除或作废未付账单」被违反——回复开头直接说「这笔未付
mt-cancel-c013-1 第 7 句 pass    要点1「本期年费还没付、没有可退的钱」已表达：回复说明未付账单不适用退款流程、不会提交退款申请，并注明本期账单未支付。要点2「不能承诺免除或
mt-cancel-c013-2 第 1 句 fail    要点1「本期年费还没付、没有可退的钱」完全没表达,回复反而说「可以退」并给出预估退款金额 1089 元,与要点直接矛盾;要点2「不能承诺免除
mt-cancel-c013-2 第 3 句 fail    要点1「本期(2026-10-09)年费还没付、没有可退的钱」已表达:回复明确说 INV-2026-0050 未支付、不能作为退款凭证、这期
mt-cancel-c013-2 第 5 句 fail    要点1「本期年费还没付、没有可退的钱」已表达（说明 INV-2026-0050 尚未支付、不付款即可、不会产生退款问题）；要点2「不能承诺免
{'calls': 7, 'in': 5892, 'out': 681}
```

两段对话的第 1 句(「可以退」)都判了 fail,理由说得很准,这是我们想要的。`mt-cancel-c013-1` 第 5 句(「这笔未付账单您不用支付了」)也抓住了。

但 `mt-cancel-c013-2` 第 3、5 句也判了 fail,我把完整理由打出来看:评分器说要点 2「没有表达」,回复里没说「只能转交」。这就是要点写法的问题:`judge_facts` 的判定标准是「每条要点都要在回复里表达出来」,而第二条是一条禁止,Agent 没犯禁、也没主动提,评分器照样按「没表达」判了失败。这是假失败。修法是把「禁止」和「必须说到」分开:禁止类的单独写一个评分器,只问「有没有承诺免除未付账单」,没提就算过。Day 357 说过一个评分器只判一件事,这里就是违反了这条的后果。

7 次调用约 5892 × 2 / 100 万 + 681 × 8 / 100 万 ≈ 0.017 元。逐轮判比只判最后一句贵好几倍,一般只在多轮用例上开。

</details>

### 验收标准

- `agent_session.py` 能多轮对话,第二轮能看到第一轮查到的东西。
- `user_sim.py` 的角色是反过来的,你能不看文章说出为什么。
- `run_multiturn.py` 在 4 条用例上各跑 3 次,每段对话都存进了 `part06/dialogs/`,你至少读完了 6 段。
- 你从对话里找到至少一个分数没抓住的问题(今天是编操作路径、没确认就提交;你的运行可能不一样)。
- `sim_check.py` 跑过,你能说出模拟客户会演砸的四种方式。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 多轮评测 | 用例不是一句工单,而是一段对话,Agent 要在几轮来回里把事办完 |
| 模拟客户 user simulator | 用另一个大模型照着剧本扮演客户,看完对话再决定说什么;也叫 simulated user |
| 剧本 persona / hidden | 给模拟客户的说明:身份和目标(一开口就表现)、被问到才说的信息 |
| 角色反转 | 在模拟客户的 messages 里,它自己的话是 assistant,客服的话是 user,和 Agent 那边相反 |
| 结束暗号 | 模拟客户表示「我这边结束了」的特殊字符串,今天是 `###DONE###` |
| 最大轮数 max_turns | 一段对话最多来回几次,防止两个模型聊个没完,今天是 5 |
| 写死的剧本 | 客户每句话提前写好、按顺序念,不看客服说了什么;多轮评测里接不上 |
| τ-bench | Sierra 2024 年发布的客服 Agent 基准,模拟用户 + 数据库终态判分 + pass^k |
| 逐轮判分 | 对多轮对话里客服的每一句都判一次,抓「结果对了但中间说错了」 |
| `re.findall` | Python 正则,返回所有匹配的字符串列表,相当于 JS 的 `match(/.../g)` |

## 常见误区

**用写死的剧本测多轮。** 第二步的 C012 剧本,第二句接不上客服第一句,第三句客户突然满意了。剧本是按你预想的客服回复写的,Agent 不按你的预想说,剧本就废了。

**模拟客户的角色不反转。** 今天故意写反,deepseek-flash 碰巧没出戏,但这是 system prompt 撑着。对话一长,messages 里大半是「assistant 在讲政策」,模型很容易接着讲下去。按对的写法写。

**规则只写身份,不写「被问才说」。** 第六步删了规则,模拟客户主动报了「企业版年付」。Agent 不查订阅也能算对钱,这条用例就测不出它会不会自己去查。

**看到全 PASS 就收工。** 今天 12 段全过,读完对话才发现 Agent 编了后台操作路径、没确认就提交退款。多轮对话里 Agent 每一轮说的话,结果评测和轨迹检查都不看,前几批一定要自己读。

**把模拟客户的功劳算成 Agent 的。** 练习 1 的 C013,是模拟客户提了一句「今年还没付」,Agent 才改口。换个不提的客户,结果可能就是错的。一条用例多写几个说法不同的变体。

**多轮套用单轮的预算上限。** 每轮都要重发前面的全部对话,今天一段对话 Agent 的输入 token 普遍在五六千以上。预算要按多轮的分布重新定,或者按「每轮」算。

**模拟客户和 Agent 用同一个模型、不记版本。** 同一个模型自己演、自己考,容易犯一样的错;`SIM_PROMPT` 不记版本,分数变了分不清是谁变了。

**禁止类的要求写进要点列表。** 练习 4 把「不能承诺免除」当成要点,评分器在 Agent 没提这事时也判了失败。禁止和必须分开写。

## 学习资料

### 文档与文章

- [τ-bench 论文(arXiv 2406.12045)](https://arxiv.org/abs/2406.12045):Shunyu Yao 等,2024 年 6 月。读摘要和讲用户模拟、数据库终态判分、pass^k 的部分,英文。今天的整个思路就从这里来。
- [τ²-bench 论文(arXiv 2506.07982)](https://arxiv.org/abs/2506.07982):2025 年的续作,让模拟用户也能操作环境,看它怎么描述「双方都能动手」的场景,英文。
- [Sierra · τ-Bench: Benchmarking AI agents for the real-world](https://sierra.ai/blog/benchmarking-ai-agents):Sierra 2024 年 6 月介绍 τ-bench 的博客,比论文好读,英文。
- [LangSmith · Multi-turn simulation](https://docs.langchain.com/langsmith/multi-turn-simulation):LangChain 官方讲怎么用 openevals 跑多轮模拟,和今天的 `run_dialog` 对照着看,英文,20 分钟。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):重读讲对话类 Agent(conversational agents)评测的那一节,原话是这类评测「often require a second LLM to simulate the user」,还提到了 τ-bench 和 τ²-bench,英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1FCpm6fEq6&autoplay=0&high_quality=1" title="基于文本的Agent多轮会话评测方法" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>爱吃蛋挞的大魔王 · 基于文本的Agent多轮会话评测方法 · 7 分钟,中文讲多轮会话怎么评,和今天的做法对照着看。播放量不高,内容正好对题。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1A7KizuEJq&autoplay=0&high_quality=1" title="AI智能体实现多轮追问对话" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI_Practice101 · AI智能体实现多轮追问对话 · 8 分钟,从 Agent 这一侧讲怎么让它追问,看完再想想今天的模拟客户是在测它的哪个能力。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/2mRmiuyFRGc" title="Simulating & Evaluating Multi turn Conversations" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>LangChain · Simulating & Evaluating Multi turn Conversations · 英文,官方演示用模拟用户跑多轮对话再评分,代码和今天的 run_multiturn.py 对照。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 4 章「Evaluate AI Systems」:讲怎么为一个具体应用设计评测流程:定标准、选评分方式、建评测管线,今天的多轮评测是这套流程在对话场景的一个特例,英文。

### 开源项目与代码

- [sierra-research/tau-bench](https://github.com/sierra-research/tau-bench):看 `tau_bench/envs/user.py` 里用户模拟器的 prompt。它的 Rules 一共六条:一次一行、别一次把指令全说出来、不许编(举的例子正是「客服问订单号、指令里没有,就说不记得」)、目标达成输出 `###STOP###`、别照抄指令、按人设说话。和今天的 `SIM_PROMPT` 几乎一一对应,结束暗号的写法也是从它学的。
- [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench):续作的代码,README 里有当前各模型的榜单。
- [langchain-ai/openevals](https://github.com/langchain-ai/openevals):看 `python/openevals/simulators/prebuilts.py` 的 `create_llm_simulated_user`,角色反转那几行和我们的写法一样。Day 361 装 agentevals 时它已经作为依赖装上了(0.2.2)。

## 自测

1. 为什么多轮评测不能用写死的剧本?

<details><summary>答案</summary>

客户的下一句取决于客服的上一句,而客服的回复是模型生成的,每次都不一样。剧本是按你预想的回复写的,Agent 不按预想说,剧本就接不上。今天 C012 的剧本第二句「就是 10 月 8 号那两笔」,客服第一句已经把发票列出来了,剧本像没看见。

</details>

2. 模拟客户的 messages 里,为什么要把角色反过来?

<details><summary>答案</summary>

模型永远以 assistant 的身份接着说。在模拟客户这边,要让它扮客户,客户的话就得是 assistant,客服的话是 user。不反转的话,messages 里客服是 assistant,模型可能接着客服的话往下讲政策。今天故意写反那次 deepseek-flash 碰巧没出戏,但不能赌。

</details>

3. 模拟客户的 prompt 里,「被问到才说」这条规则是为了测 Agent 的什么能力?删掉会怎样?

<details><summary>答案</summary>

测 Agent 会不会追问、会不会自己去查。删掉以后模拟客户会主动把信息全说了,今天对照实验里它主动报了「企业版年付」和公司名,Agent 不查订阅也能算对,这条用例就测不出它会不会自己查。

</details>

4. 今天 12 段对话全 PASS,还发现了什么问题?为什么分数没抓住?

<details><summary>答案</summary>

一是 C002 月付客户问「之后别再扣了」,Agent 编了一条「账户设置 → 订阅管理 → 取消自动续费」的后台路径,两次编得还不一样;二是 C007 客户只问了一句「是不是扣了两次」,Agent 第一轮就提交了退款,没确认。结果评测只看库里的退款,轨迹检查只看工具调用,都不看 Agent 每一轮说的话,所以没抓住。要靠读对话,再把读出来的问题写成检查。

</details>

5. 模拟客户本身会出哪些问题?怎么发现?

<details><summary>答案</summary>

太配合(没问就全说)、编信息(编发票号)、出戏(说成客服腔或替客服解释)、太早结束或一直不结束。发现办法:新剧本先跑几次全读;用 `sim_check.py` 这类规则先筛(客户提到的发票号客服之前没说过、客服常用词、一句太长);`SIM_PROMPT` 记版本号,最好用和 Agent 不同的模型扮客户。

</details>

6. (面试题)「你的客服 Agent 单轮评测分数很高,上线后客户投诉它不问清楚就办事、还瞎指路。你会怎么改评测?」

<details><summary>答案</summary>

要点:①单轮测不出「会不会追问」「先确认再办」,要加多轮评测,用模拟客户,剧本里把关键信息放进「被问才说」;②对话结束后照样看数据库终态和轨迹,另外记下每个写操作发生在第几轮,把「退款前先确认」写成规则(比如退款不能在第一轮);③读对话,把「瞎指路」这类问题归类,写成检查(关键词筛 + 针对性的 LLM 评分器,禁止类和必须类分开写);④每条多轮用例跑多次看 pass^k,同一用例写几个说法不同的变体,别让模拟客户的「提醒」替 Agent 拿分;⑤模拟客户自己也要检查和记版本。根上修还要补知识(帮助中心文章)和 prompt 规则。

</details>

## 明天预告

Day 363 · 第 52 周复习:评测与可观测(Day 357–362)。这一周从评分 prompt 怎么写、和人工对齐、偏差和成本,一路走到结果和轨迹、四种匹配模式、今天的模拟客户。明天把这六天串成一张图,默写 `match()`、`check_scope()` 和 `sim_reply()` 并跑通,再用本周的东西给今天的多轮对话做一份完整的评测报告。
