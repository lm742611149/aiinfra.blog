---
title: 'Day 10 · ReAct 与规划:先想再做,边做边看'
description: '用纯提示词实现一次 2022 年 ReAct 论文里的 Thought/Action/Observation 循环,看清 stop 序列为什么是关键;再看原生 function calling 和推理模型时代 ReAct 变成了什么,最后实现 plan-and-execute 和 Claude Code 式的待办清单规划。'
pubDate: 2026-10-12
regime: none
tags: ['react', 'planning', 'plan-and-execute', 'reflection', 'agent-60']
series: 'agent-60'
day: 10
lang: 'zh'
---

## 今天要解决的问题

昨天的 Agent 能干活,但它像一个不说话的同事:你只看到它调了什么工具,看不到它为什么这么调。遇到复杂一点的任务,它有时候会东一榔头西一棒子,查了一堆用不上的东西;有时候做到一半忘了最初要干什么。

这两个问题,学术界和工业界各有一套说法。学术界叫「推理与行动的结合」,代表作是 2022 年的 ReAct 论文;工业界叫「规划」,代表做法是 plan-and-execute,以及 Claude Code 那种边干边更新待办清单的方式。今天把它们串起来讲。学完你应该能:

1. 讲清楚 ReAct 论文的核心想法,以及它相比「只推理」和「只行动」好在哪。
2. 不用 function calling,只用提示词加正则实现一个 ReAct 循环,并解释 `stop=["Observation:"]` 这一行为什么不能少。
3. 说清楚原生 function calling 和推理模型出现以后,ReAct 的「Thought」去了哪里。
4. 实现 plan-and-execute,并能比较它和 ReAct 在成本、灵活性上的取舍。
5. 给 Agent 加一个待办清单工具,让它在长任务里不迷路。

预计用时 4–5 小时。前置是 Day 9 的 `agent_loop.py` 和 `day09_demo.py`。

## ReAct 论文在说什么

论文全名是《ReAct: Synergizing Reasoning and Acting in Language Models》,作者 Shunyu Yao 等,2022 年 10 月放到 arXiv,后来发表在 ICLR 2023。名字是 **Re**asoning + **Act**ing 的缩写,跟前端那个 React 没有关系。

当时大家手里有两种用模型解题的办法。一种是思维链(Chain-of-Thought):让模型一步步推理,但它只能用自己脑子里的知识,知识不对就一本正经地推出错误答案。另一种是只行动:让模型直接输出搜索、点击之类的动作,但它不解释为什么,动作之间缺乏连贯的计划,走着走着就偏了。

ReAct 的做法是把两者交替起来。模型每一步先写一行 Thought(我现在知道什么、下一步该干嘛),再写一行 Action(调用什么工具),然后系统把工具结果作为 Observation 填回去,模型看完再写下一个 Thought。论文在 HotpotQA(需要多跳检索的问答)、FEVER(事实核查)、ALFWorld(文字版家务游戏)、WebShop(模拟购物)几个任务上测了,结论是交替的版本比单独推理或单独行动都好,而且留下的轨迹人能看懂,出错了也知道错在哪一步。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="ReAct 轨迹示意:Thought、Action、Observation 交替出现">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)" rx="6"/>
  <text x="20" y="28" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">Question: 哈尔滨和广州现在的温差是多少度?</text>
  <rect x="20" y="42" width="600" height="28" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="61" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">Thought: 需要两个城市的气温,先查哈尔滨</text>
  <rect x="20" y="74" width="600" height="28" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="93" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">Action: get_weather[哈尔滨]</text>
  <rect x="20" y="106" width="600" height="28" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="30" y="125" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">Observation: {"temperature": 6.1, ...}   ← 系统填写</text>
  <rect x="20" y="138" width="600" height="28" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="157" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">Thought: 再查广州</text>
  <rect x="20" y="170" width="600" height="28" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="189" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">Action: get_weather[广州]</text>
  <rect x="20" y="202" width="600" height="28" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="30" y="221" font-family="var(--font-mono)" font-size="12" fill="var(--compute)">Observation: {"temperature": 27.3, ...}</text>
  <rect x="20" y="234" width="600" height="28" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="30" y="253" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">Thought: 用计算器算差值 → Action: calculate[27.3-6.1] → …</text>
  <text x="30" y="285" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色由模型生成,琥珀色由你的程序填入(图中温度为示意数字)</text>
</svg>
<figcaption>ReAct 轨迹就是一段不断增长的文本。模型负责写 Thought 和 Action,程序负责执行 Action 并把 Observation 接在后面。</figcaption>
</figure>

顺带一提,2024 年有篇论文《On the Brittle Foundations of ReAct Prompting》专门挑战这个结论,发现在他们的实验里,交替推理带来的好处没有原文说的那么大,效果更多取决于示例和问题的相似程度。这不影响 ReAct 作为一种工程模式的价值,但提醒你一件事:论文里的提升数字,换个模型换个任务未必复现。你自己的评测(W5)比任何论文都可靠。

## 不用 function calling,手写一次 ReAct

现在主流模型都有原生工具调用,为什么还要写纯文本版?两个原因。第一,它能让你看清 Agent 循环的本质就是「文本接龙 + 外部填空」,昨天的 tool_calls 只是把这件事结构化了。第二,有些场景你还会碰到它:用一个不支持工具调用的开源小模型,或者面试官问「如果模型没有 function calling 你怎么做」。

```python
# agent-60-lab/w2/react_prompt.py
# 不用 function calling,纯靠提示词和文本解析实现 ReAct,看清它的原始样子
import json
import os
import re

from openai import OpenAI

from calc import calculate
from weather import get_weather

client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
# DeepSeek 默认开思考模式,这里关掉,让「思考」只出现在我们要求的 Thought 行里
EXTRA = {"thinking": {"type": "disabled"}} if "deepseek" in os.environ["LLM_BASE_URL"] else None

TOOLS = {
    "get_weather": lambda arg: get_weather(arg.strip()),
    "calculate": lambda arg: calculate(arg.strip()),
}

PROMPT = """尽你所能回答下面的问题。你可以使用这些工具:

get_weather[城市名]: 查询城市当前天气,返回 JSON
calculate[算式]: 计算数学表达式,只支持数字和 + - * / ** %

严格使用下面的格式:

Question: 需要回答的问题
Thought: 你对下一步该做什么的思考
Action: 工具名[参数]
Observation: 工具返回的结果(这一行由系统填写,你不要自己写)
...(Thought/Action/Observation 可以重复多次)
Thought: 我已经知道最终答案了
Final Answer: 给用户的最终回答

Question: {question}
"""

ACTION_RE = re.compile(r"Action:\s*(\w+)\[(.*?)\]", re.S)


def react(question: str, max_steps: int = 8) -> str:
    transcript = PROMPT.format(question=question)
    for step in range(max_steps):
        out = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "user", "content": transcript}],
            stop=["Observation:"],  # 关键:不让模型自己编造工具结果
            temperature=0,
            extra_body=EXTRA,
        ).choices[0].message.content or ""
        transcript += out
        print(out.strip(), flush=True)
        if "Final Answer:" in out:
            return out.split("Final Answer:", 1)[1].strip()
        m = ACTION_RE.search(out)
        if not m:
            transcript += "\nObservation: 没有找到合法的 Action 行,请按格式输出 Action: 工具名[参数]\n"
            continue
        name, arg = m.group(1), m.group(2)
        result = TOOLS[name](arg) if name in TOOLS else {"error": f"没有工具 {name}"}
        obs = json.dumps(result, ensure_ascii=False)
        print(f"Observation: {obs}")
        transcript += f"\nObservation: {obs}\n"
    return "超过最大步数"


if __name__ == "__main__":
    print("\n答案:", react("哈尔滨和广州现在的温差是多少度?"))
```

这段代码里最重要的一行是 `stop=["Observation:"]`。不加它会怎样?模型写完 `Action: get_weather[哈尔滨]` 以后,会顺手接着写 `Observation: {"temperature": 3.5}`,自己编一个结果出来,然后基于这个编出来的数继续推理,最后给你一个看上去很合理的错误答案。这个坑很多人第一次写都会踩:模型「查」到的温度和天气网站对不上,排查半天才发现工具根本没被调用过。

stop 序列的作用是:模型一旦要生成 `Observation:` 这几个字,生成立刻停止,控制权回到你的程序。程序执行工具,把真实结果接上去,再让模型继续。这个机制和原生 function calling 里「模型输出 tool_calls 后请求就结束」是一回事,只是那边由服务端替你做了。

还有两处细节。一是找不到 Action 行时,我没有直接报错,而是在 Observation 里告诉模型格式错了。纯文本协议比结构化协议脆弱得多,模型经常写成 `Action: get_weather(哈尔滨)` 或者 `Action：get_weather[哈尔滨]`(全角冒号),你的正则要么宽容一点,要么给出能让它自我纠正的提示。二是我关掉了 DeepSeek 的思考模式。开着的话,模型会先在 `reasoning_content` 里想一大段,再在 content 里写 Thought,等于想了两遍,浪费 token。

## Thought 去哪了:原生工具调用和推理模型

回到原生 function calling。你会发现 Day 9 的日志里没有 Thought,模型直接给 tool_calls。ReAct 的「推理」是不是丢了?没丢,它搬家了,而且搬去了好几个地方。

第一个地方是 `content`。很多模型在给出 tool_calls 的同时,content 里会有一句「我先查一下哈尔滨的天气」。这就是 Thought,只是不再需要固定格式。如果你想让它更稳定地出现,在 system prompt 里加一句「调用工具前先用一两句话说明你的理由」即可。

第二个地方是推理模型的思维链。DeepSeek 的思考模式、OpenAI 的 o 系列和 GPT-5 的推理、Claude 的 extended thinking,都会在给出工具调用之前先想一段。这段思考比 ReAct 的单行 Thought 长得多,也更有效,因为模型是专门为此训练的。Claude 还支持 interleaved thinking(交错思考),每次拿到工具结果后都能再想一段,这几乎就是 ReAct 的原生实现。

第三个地方是你的代码。显式的规划步骤(下面马上讲)把「想」从模型内部搬到了系统架构里。

所以在 2026 年,ReAct 更多是一个**思想**而不是一个要照抄的提示词格式:推理和行动交替进行,每一步都基于真实的观察结果。原生工具调用加推理模型,已经把它内化了。你仍然需要知道它,因为面试会问,因为它是理解所有 Agent 框架的钥匙,也因为你调试 Agent 时最有用的习惯就是让它把理由说出来。

## Plan-and-Execute:先列计划再动手

ReAct 是走一步看一步。另一种思路是先把整个计划想好,再一步一步执行。这就是 plan-and-execute,学术上的前身是 2023 年的 Plan-and-Solve 论文,LangChain 早期也有同名实现。

它解决的是 ReAct 在长任务上的两个毛病。一是**迷路**:走了十几步以后,上下文里堆满了工具结果,模型忘了最初的目标。二是**贵**:每一步都用最强的模型来决定下一步做什么,而很多步其实很机械。plan-and-execute 把「想」和「做」拆开,规划器只调用一次,执行器可以用便宜的模型,每一步的上下文也只包含当前步骤需要的信息。

```python
# agent-60-lab/w2/plan_execute.py
import json
import os

from openai import OpenAI
from pydantic import BaseModel, ValidationError

from agent_loop import Agent
from day09_demo import reg  # 复用 Day 9 注册好的 get_weather / calculate / read_file

client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]


class Plan(BaseModel):
    goal: str
    steps: list[str]


PLANNER = """你是任务规划器。把用户的任务拆成 2-6 个可以独立执行的步骤,每步一句话,写清楚要做什么、产出什么。
可用的能力:读取 workspace 里的文件、查询城市天气、做数学计算。
只输出 JSON,格式:{"goal": "...", "steps": ["...", "..."]}"""


def make_plan(task: str, retries: int = 2) -> Plan:
    messages = [{"role": "system", "content": PLANNER}, {"role": "user", "content": task}]
    for _ in range(retries + 1):
        raw = client.chat.completions.create(
            model=MODEL, messages=messages, response_format={"type": "json_object"}
        ).choices[0].message.content
        try:
            return Plan.model_validate_json(raw)
        except ValidationError as e:  # Day 6 的套路:校验失败就把错误喂回去重试
            messages += [{"role": "assistant", "content": raw},
                         {"role": "user", "content": f"JSON 不符合格式要求:{e}。请重新输出。"}]
    raise RuntimeError("规划失败")


def plan_and_execute(task: str) -> str:
    plan = make_plan(task)
    print("计划:", json.dumps(plan.model_dump(), ensure_ascii=False, indent=2))
    notes: list[str] = []
    for i, step in enumerate(plan.steps, 1):
        executor = Agent(reg, system="你是执行者,只完成交给你的这一个步骤,简洁地报告结果。", max_steps=6)
        context = "\n".join(notes) or "(还没有)"
        result = executor.run(f"总目标:{plan.goal}\n之前步骤的结果:\n{context}\n\n现在只做第 {i} 步:{step}")
        notes.append(f"第 {i} 步「{step}」的结果:{result}")
    # 最后一步:根据所有中间结果写最终回答,不再调工具
    final = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": f"任务:{task}\n\n执行记录:\n" + "\n".join(notes) + "\n\n请给出最终回答。"}],
    )
    return final.choices[0].message.content


if __name__ == "__main__":
    print(plan_and_execute("读 cities.txt,查每个城市的气温,算出平均气温,并建议这周出差带什么衣服。"))
```

规划器用了 Day 6 学的 JSON 输出加 pydantic 校验加失败重试,这套组合拳你以后会用无数次。DeepSeek 的 JSON 模式要求提示词里出现「json」这个词,PLANNER 里写了大写的 JSON,满足要求。

执行器每一步都新建一个 `Agent`,只给它「总目标、之前的结果、当前这一步」。这是一个有意的设计:**执行器之间上下文隔离**,第 3 步不会看到第 1 步调用工具的全部细节,只看到第 1 步的结论。这让每一步的输入都很短,也让你可以给执行器换一个更便宜的模型。Day 26 讲多 Agent 时,上下文隔离会成为一个核心话题。

跑起来,计划部分大致会打印成这样(内容由模型生成,每次不同):

```text
计划: {
  "goal": "根据出差城市的天气给出穿衣建议",
  "steps": [
    "读取 cities.txt,得到城市列表",
    "查询每个城市当前气温",
    "计算平均气温",
    "根据气温给出穿衣建议"
  ]
}
```

plan-and-execute 的代价也很明显:**计划是死的**。如果第 1 步发现 cities.txt 不存在,后面三步还会照计划执行,做一堆无用功。所以完整的实现会加一个 replan 步骤:每执行完一步,让规划器看看结果,决定继续、修改计划,还是提前结束。我在练习里留给你做。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="ReAct 与 Plan-and-Execute 的结构对比">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)" rx="6"/>
  <text x="160" y="28" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">ReAct:走一步看一步</text>
  <text x="480" y="28" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">Plan-and-Execute:先想后做</text>
  <line x1="320" y1="15" x2="320" y2="245" stroke="var(--rule)"/>
  <rect x="60" y="50" width="200" height="34" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="160" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">强模型:想 + 选工具</text>
  <rect x="60" y="100" width="200" height="30" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="160" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">执行工具</text>
  <path d="M260 115 Q295 90 260 67" fill="none" stroke="var(--ink-soft)"/>
  <text x="160" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">每步都带完整历史</text>
  <text x="160" y="180" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">灵活,能随时改主意</text>
  <text x="160" y="200" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">长任务易迷路、贵</text>
  <rect x="380" y="50" width="200" height="34" fill="var(--mem-wash)" stroke="var(--mem)" rx="4"/>
  <text x="480" y="72" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--mem)">规划器:一次列出全部步骤</text>
  <rect x="350" y="100" width="80" height="30" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="390" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">步骤 1</text>
  <rect x="440" y="100" width="80" height="30" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="480" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">步骤 2</text>
  <rect x="530" y="100" width="80" height="30" fill="var(--compute-wash)" stroke="var(--compute)" rx="4"/>
  <text x="570" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--compute)">步骤 3</text>
  <text x="480" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">执行器上下文隔离,可用小模型</text>
  <text x="480" y="180" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">目标清晰,不易迷路</text>
  <text x="480" y="200" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">计划僵硬,需要 replan</text>
</svg>
<figcaption>两种规划方式的取舍。实际项目里常见的是混合:先粗列计划,执行中允许修改。</figcaption>
</figure>

## 待办清单:Claude Code 的做法

如果你用过 Claude Code,应该见过它在开始一个大任务前列出一个 todo list,做完一项勾一项。这是第三种规划方式,也是我目前最喜欢的:**把计划做成一个工具**,让 Agent 在 ReAct 式的循环里自己维护它。

它兼得了前两种的好处。计划是显式的,写在上下文里,模型每一轮都能看到「还剩什么没做」,不容易迷路。计划又是活的,模型发现情况变了可以随时改清单。而且它不需要任何特殊架构,在 Day 9 的循环上加一个工具就行:

```python
# agent-60-lab/w2/todo_agent.py
# 像 Claude Code 那样:给 Agent 一个「待办清单」工具,让它自己维护计划
from typing import Annotated

from agent_loop import Agent
from day09_demo import reg

TODOS: list[str] = []


@reg.tool
def update_todos(todos: Annotated[str, "完整的待办清单,每行一项,以 '[ ] ' 或 '[x] ' 开头"]) -> dict:
    """覆盖式更新你的待办清单。开始多步任务前先写清单,每完成一项就把它标成 [x] 再继续。"""
    TODOS[:] = [line.strip() for line in todos.splitlines() if line.strip()]
    left = [t for t in TODOS if t.startswith("[ ]")]
    return {"saved": len(TODOS), "remaining": len(left), "next": left[0] if left else "全部完成"}


SYSTEM = """你是一个做事有条理的助手。
遇到需要 3 步以上的任务:先调用 update_todos 写下计划;每完成一项就更新清单;全部完成后再回答。
任务简单时直接做,不需要清单。"""

if __name__ == "__main__":
    agent = Agent(reg, system=SYSTEM, max_steps=15)
    print(agent.run("读 cities.txt,查每个城市的气温,找出最冷和最热的城市,并算出它们的温差。"))
    print("最终清单:", TODOS)
```

`update_todos` 的实现简单到有点可笑:把清单存进一个列表,返回剩几项、下一项是什么。它真正的作用不在于存储,而在于**让模型把计划写出来**。写出来的计划会作为工具调用的参数留在对话历史里,每次更新都会再写一遍最新版本,于是模型在任何时候都能在最近的上下文里看到完整的进度。这是用最小的代价对抗「长任务迷路」。

返回值里的 `next` 字段也是有意的:直接告诉模型下一步该干什么。工具的返回值不只是数据,也可以是对模型的引导,Day 11 会展开讲这个思路。

## 反思:做完了再检查一遍

最后简单提一下规划的另一个方向:反思(Reflection)。吴恩达在 2024 年那场红杉资本的演讲里,把 Agent 的设计模式归纳成四个:反思、工具使用、规划、多智能体协作。反思就是让模型(或者另一个模型)检查自己的输出,发现问题后重做。

2023 年的 Reflexion 论文把这个想法做得更系统:Agent 失败后写一段「我为什么失败、下次应该怎么做」的文字反思,存进记忆,下一次尝试时带上。在代码题这类有明确对错信号的任务上效果很明显。

工程上,反思最常见的落地形式是 Day 13 要讲的 evaluator-optimizer 模式:一个模型生成,另一个模型按标准打分并给修改意见,循环直到达标。毕业项目里的「起草回复后自检」节点也是它。今天先知道有这么回事就行。

## 什么时候需要显式规划

推理模型越来越强,你可能会问:还需要这些规划技巧吗?我的经验是看任务长度和可预测性。

- **3 步以内的任务**:不需要任何显式规划,原生工具调用加一个好的 system prompt 足够。加了规划反而多花钱多花时间。
- **5–20 步、路径不确定的任务**(调研、排查问题):用待办清单工具。让模型自己列、自己改。
- **步骤固定、可预测的流程**(处理一张工单永远是分类、检索、起草、审核):别让模型规划,直接用代码写死流程。这就是 Day 13 要讲的 workflow,比任何 Agent 都稳。
- **很长、能拆成独立子任务的工作**:plan-and-execute,或者 Day 26 的 orchestrator-worker 多 Agent 模式。

这个判断本身就是面试常考题。能说出「我先判断任务路径是否可预测,可预测用 workflow,不可预测再考虑 Agent 和规划」,比背出五种规划算法有用得多。

## 动手练习

**练习 1:纯文本 ReAct。** 运行 `react_prompt.py`。然后删掉 `stop=["Observation:"]` 再跑一次,把模型编造的 Observation 和真实天气对比,截图记下来。这是你亲手制造的一次「幻觉」,印象会很深。

**练习 2:让 Thought 回来。** 在 Day 9 的 Agent 里,system prompt 加一句「每次调用工具前,先用一句话说明为什么」,并在日志里打印 `msg.content`。对比加之前和加之后的日志可读性。

**练习 3:给 plan-and-execute 加 replan。** 每执行完一步,把「计划、已完成步骤和结果」发给规划器,让它输出 `{"action": "continue" | "revise" | "finish", "steps": [...]}`。测试方法:删掉 cities.txt,看规划器能不能在第 1 步失败后修改计划(比如改成告诉用户文件不存在)。

**练习 4:三种方式对比。** 用同一个任务(「读 cities.txt,找出最冷和最热的城市并算温差」)分别跑 Day 9 原版、`plan_execute.py`、`todo_agent.py`,各跑 3 次,记录到下面这张表(空表,填你自己的实测):

| 方式 | 平均步数(模型调用次数) | 平均 token 总数 | 答案是否正确(3 次) | 你的观察 |
| --- | --- | --- | --- | --- |
| Day 9 原版 | | | | |
| Plan-and-Execute | | | | |
| 待办清单 | | | | |

**验收标准:** 练习 1 能复现并解释编造的 Observation;练习 3 删掉文件后程序不会执行无意义的后续步骤;练习 4 的表格填满,并能用两三句话说出在这个任务上你会选哪种方式、为什么。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| ReAct | Reasoning + Acting,让模型交替输出思考(Thought)和动作(Action),系统填入观察结果(Observation) |
| Chain-of-Thought(思维链) | 让模型先写推理过程再给答案的提示方法 |
| stop 序列 | 模型生成到指定字符串就停止的参数,ReAct 里用来防止模型编造工具结果 |
| 推理模型 / 思考模式 | 回答前先生成一段内部思维链的模型,如 DeepSeek 思考模式、OpenAI o 系列、Claude extended thinking |
| interleaved thinking | 每次拿到工具结果后都能再思考一段,Claude 支持的特性 |
| Plan-and-Execute | 先由规划器列出全部步骤,再由执行器逐步完成的模式 |
| replan | 执行过程中根据结果修改计划 |
| 待办清单工具 | 让 Agent 把计划作为工具参数写出并持续更新的做法,Claude Code 的 TodoWrite 是代表 |
| Reflection / Reflexion | 让模型检查、批评自己的输出并改进;Reflexion 是把失败反思存进记忆的论文方法 |
| 上下文隔离 | 子任务只拿到必要信息,不共享完整历史 |

## 常见误区

**以为 ReAct 是一种需要照抄的提示词格式。** 在原生工具调用时代,ReAct 是一种思想:推理和行动交替、每步基于真实观察。照抄 Thought/Action 文本格式只在模型不支持工具调用时才有必要。

**纯文本 ReAct 不加 stop 序列。** 模型会自己编 Observation,然后基于假数据推理。这是最隐蔽的一类幻觉,因为轨迹看起来完全正常。

**所有任务都上规划。** 简单任务加规划只会更慢更贵。先判断任务路径是否可预测,可预测的用代码写死流程,不可预测才交给 Agent。

**计划列完就不改。** plan-and-execute 没有 replan,遇到意外会一条道走到黑。要么加 replan,要么用待办清单这种「活计划」。

**把推理模型的思维链当成可靠的解释。** 思维链能帮助模型做得更好,但它不保证忠实反映模型的「真实原因」。调试时把它当线索,别当证据。

## 学习资料

### 文档与文章

- [ReAct 论文](https://arxiv.org/abs/2210.03629) 和 [项目主页](https://react-lm.github.io/):读摘要、图 1 和第 2 节就够,看论文里那张 HotpotQA 的对比轨迹,40 分钟。
- [Prompting Guide · ReAct(中文)](https://www.promptingguide.ai/zh/techniques/react):中文讲解加 LangChain 示例,15 分钟。
- [Plan-and-Solve 论文](https://arxiv.org/abs/2305.04091):plan-and-execute 的学术前身,读摘要即可,10 分钟。
- [Reflexion 论文](https://arxiv.org/abs/2303.11366):反思模式的代表作,读摘要和图 1,15 分钟。
- [On the Brittle Foundations of ReAct Prompting](https://arxiv.org/abs/2405.13966):唱反调的论文,读摘要,建立对论文数字的健康怀疑,10 分钟。
- [Chip Huyen · Agents](https://huyenchip.com/2025/01/07/agents.html):《AI Engineering》第 6 章 Agents 部分的免费公开版,今天重点读「Planning」一节,1 小时。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1iuAUzHErP&autoplay=0&high_quality=1" title="ReAct Agent是什么?我用21分钟给你讲清楚!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>AI大模型元元 · ReAct Agent是什么?我用21分钟给你讲清楚! · 21 分钟,从论文到代码,适合在写练习 1 之前看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1aaxyz8ELY&p=26&autoplay=0&high_quality=1" title="吴恩达《Agentic AI》中英双语 · 模块5 规划工作流" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>吴恩达机器学习(搬运)· (中英双语!)吴恩达最新《Agentic AI》大佬亲授智能体教程 · 看第 26–28 P(模块 5「规划工作流」「创建和执行 LLM 计划」「结合代码执行的规划」),约 16 分钟;反思部分在第 9–13 P,有空也看。</figcaption>
</figure>

- AI技术星球QAQ《别只会 ReAct!7 种主流 Agent 架构一次性讲全》(BV1nQ8Y6rE92,3 个半小时):很长,当工具书,用到哪种架构查哪段。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/sal78ACtGTc" title="What's next for AI agentic workflows ft. Andrew Ng of AI Fund" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Sequoia Capital · What's next for AI agentic workflows ft. Andrew Ng of AI Fund · 吴恩达讲反思、工具使用、规划、多智能体四种设计模式的那场著名演讲,值得完整看。</figcaption>
</figure>

- Arize AI《Keys to Understanding ReAct: Synergizing Reasoning and Acting in Language Models》(YouTube `QX-p-vsDoiQ`):论文精读形式,想深挖论文实验细节时看。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 6 章「Planning」一节(原书约 281–298 页),讲计划的生成、验证、反思和「什么时候该让人类介入」,是今天最好的延伸阅读。上面的免费博文是它的公开版本。
- 黄佳《大模型应用开发 动手做AI Agent》(人民邮电出版社, 2024):书里有 ReAct 和 Plan-and-Execute 两个实战项目,配套代码见下方仓库的 06、07 目录。

### 开源项目与代码

- [datawhalechina/hello-agents · 第四章 智能体经典范式构建](https://github.com/datawhalechina/hello-agents/tree/main/docs/chapter4):中文,手把手实现 ReAct、Plan-and-Solve、Reflection 三种范式,和今天的内容高度对应,1–2 小时。
- [huangjia2019/ai-agents · 06-ReAct-agent](https://github.com/huangjia2019/ai-agents/tree/main/06-ReAct-agent) 和 [07-Plan-n-Execute-agent](https://github.com/huangjia2019/ai-agents/tree/main/07-Plan-n-Execute-agent):黄佳书的配套代码。
- [ysymyth/ReAct](https://github.com/ysymyth/ReAct):论文作者的原始代码和提示词,看看 2022 年的 few-shot 示例长什么样。

## 自测

1. ReAct 相比纯 Chain-of-Thought 和纯 Act 分别好在哪?

<details><summary>答案</summary>

相比纯 CoT:能通过工具拿到真实外部信息,不会只靠模型记忆推理出错误事实。相比纯 Act:每个动作前有显式的思考,动作之间更连贯,能根据观察结果调整计划,轨迹也更容易被人理解和调试。

</details>

2. 纯文本 ReAct 实现里,`stop=["Observation:"]` 去掉会发生什么?

<details><summary>答案</summary>

模型写完 Action 后会继续生成 Observation,自己编造一个工具结果,然后基于假数据继续推理,最终给出看似合理但错误的答案。stop 序列让生成在 Observation 前停下,把控制权交还给程序执行真实的工具。

</details>

3. 原生 function calling 的日志里看不到 Thought,ReAct 的推理去哪了?

<details><summary>答案</summary>

搬到了几个地方:模型在 tool_calls 同时输出的 content 文字;推理模型内部的思维链(如 DeepSeek 的 reasoning_content、Claude 的 thinking);以及系统架构里的显式规划步骤。原生工具调用加推理模型已经把「推理和行动交替」内化了。

</details>

4. Plan-and-Execute 的执行器为什么每步新建 Agent、只给当前步骤的信息?这有什么好处和风险?

<details><summary>答案</summary>

好处:上下文短,成本低,可以用便宜模型;每一步专注,不会被前面大量工具结果干扰。风险:执行器看不到完整细节,如果前一步的结论总结得不好,信息会丢失;计划本身如果错了,执行器无法发现,需要 replan 机制兜底。

</details>

5. (面试题)「你会怎么让一个 Agent 在 20 步以上的长任务里不迷路?」

<details><summary>答案</summary>

几个层次:先判断任务能否拆成固定流程,能就用 workflow 写死;不能的话给 Agent 一个待办清单工具,让它显式写下并持续更新计划,每轮都能看到剩余任务;对很长的任务用 plan-and-execute 或 orchestrator-worker,子任务上下文隔离;配合上下文压缩(摘要旧的工具结果);设置步数和预算上限;关键节点加反思或人工检查。最好能结合自己做过的项目说出具体数字。

</details>

6. 一个「处理退款工单」的流程永远是:查订单、核对退款政策、起草回复、人工审批。你会用 ReAct、plan-and-execute 还是别的?

<details><summary>答案</summary>

都不用,直接用代码写死的 workflow(prompt chaining)。路径固定可预测,不需要模型决定下一步,写死更稳定、更便宜、更容易测试。只在其中某个环节(比如起草回复)用模型。这正是明后天要讲的「Workflow 还是 Agent」的判断。

</details>

## 明天预告

这三天你写了好几个工具,也看到了模型会因为一句描述、一个 enum 而表现得完全不同。明天(Day 11)专门讲 **好工具怎么设计**:命名、描述、参数、返回值和报错信息。我们会对照 Anthropic 那篇《Writing effective tools for agents》,把一组「能用但难用」的工具一个个改造成模型用起来顺手的样子。
