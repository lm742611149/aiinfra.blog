---
title: 'Day 260 · RAG 评估(五):生成评估,让大模型当裁判'
description: '检索层的分数只管资料找没找到,回答好不好要另外判。今天让大模型当裁判,分三件事判:忠实(每句话有没有依据)、完整(要点有没有漏)、拒答(没答案时有没有老实说)。30 道题 86 次调用花了七分钱:忠实 26/26,完整 24/26,拒答 4/4。没判上的两道,一道是检索漏了编码那篇,另一道看着像生成的错,把 k 从 4 加到 8 才发现是写着规则的那一块根本没被检索到。'
pubDate: 2026-10-22
regime: none
tags: ['rag-evaluation', 'llm-as-judge', 'python', 'agent-zero']
series: 'agent-zero'
day: 260
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 259](/blog/agent-zero/day-259-rag-eval-4/) 写了检索评估脚本 `eval_retrieval.py`,26 道有答案的题、四种检索方式一次跑完:hit@1 向量 1.000、混合 0.923、混合加 rerank 0.923、BM25 0.846,BM25 的口语题只有 0.333。还踩了一个不报错的坑:只取 4 块再去重,一句两问的 q26 被冤枉成 recall 0.5。

最后留了一个尾巴:q17「买错了能把钱要回来吗」在混合加 rerank 下 recall 是 1.0,kb-002 确实在前 4 篇里,但写着退款规则的那一块不在。检索层按文章打分,看不见这种情况。今天换到另一头,直接判回答好不好。

## 今天要解决的问题

学完你应该能做到:

1. 说清楚生成层要判哪三件事(忠实、完整、拒答),每件事抓的是哪种错,为什么每件事单独一个裁判、只判是和否。
2. 写出 `part04/eval_generation.py`:每道题检索、生成回答,再调对应的裁判,每道题判完立刻写一行 JSONL,裁判出错的题单独数出来。
3. 拿 30 道题的结果做诊断:判「不完整」的两道题,各是哪一层的问题,用什么实验证明。

预计用时 2.5 小时。API 花费约 ¥0.12:主线 30 道题一次 86 调用 ¥0.070(算式见下文),先跑 3 道试水 ¥0.007,几个小脚本 ¥0.003,练习约 ¥0.041。embedding 和 rerank 是硅基流动的免费模型。价格按 2026 年 10 月 [DeepSeek 定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)的高峰价:deepseek-flash 输入缓存未命中 2 元、命中 0.04 元、输出 8 元每百万 token,北京时间工作日 9–12 点、14–18 点以外是半价。

前置:[Day 255](/blog/agent-zero/day-255-rag-eval-1/) 的两层划分和 `part04/prompts.py`(`SYSTEM`、`build_messages`),以及当时用「查关键词」判生成层的粗办法;[Day 257](/blog/agent-zero/day-257-rag-eval-3/) 评估集里的 `answer_points`;[Day 259](/blog/agent-zero/day-259-rag-eval-4/) 的检索结果;[Day 147](/blog/agent-zero/day-147-structured-1/) 的 JSON 模式 `response_format`;[Day 135](/blog/agent-zero/day-135-llm-client-1/) 的 `common/llm.py`。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写三个裁判提示词和 `ask_judge()`;做练习,做不出再展开参考答案,看完关掉重写一遍。

## 为什么要让大模型当裁判

生成层要判的是一句话的意思。Day 255 用的办法是查关键词:回答里有「没有找到」四个字,就算拒答了。这很粗,Day 255 当时就看到它判错。可是不用关键词,用什么?

最准的是人一条条看。30 道题看一遍要半小时,每改一次提示词就得再看一遍,一天改五次就是两个半小时,坚持不了几天。代码规则又判不了意思。中间这一档,就是让另一个大模型来判,叫 **LLM-as-judge**(大模型当裁判):把问题、资料、回答交给它,问它一个很具体的问题,让它用 JSON 回答。它判得没有人准,但便宜、快,改完提示词一分钟就能重跑。人只抽查,确认裁判和自己的判断大体一致。

今天判三件事,每件事抓一种错:

- **忠实**(faithful):回答里每一个事实,能不能在检索到的资料里找到依据。抓的是**编造**,比如资料说当月不退,回答说按天退。
- **完整**(complete):回答有没有覆盖评估集里标的要点。抓的是**漏答**,比如只说了怎么申请退款,没说能退多少。
- **拒答**(refused):只用在 4 道无答案题上,回答有没有老实说没找到、并且没编具体的规则、数字、电话。

<figure>
<svg viewBox="0 0 640 280" role="img" aria-label="生成评估流程:问题检索出 4 块资料,大模型生成回答;有答案的题把资料和回答交给忠实裁判、把问题要点和回答交给完整裁判;无答案的题把问题和回答交给拒答裁判;每个裁判只输出一个是或否加理由">
<rect x="0" y="0" width="640" height="280" fill="var(--paper-raised)"/>
<defs><marker id="ev260a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-soft)"/></marker></defs>
<g font-family="var(--font-mono)" font-size="12">
<rect x="16" y="24" width="110" height="44" rx="4" fill="none" stroke="var(--rule)"/>
<text x="71" y="50" fill="var(--ink)" text-anchor="middle">评估集一题</text>
<line x1="126" y1="46" x2="156" y2="46" stroke="var(--ink-soft)" marker-end="url(#ev260a)"/>
<rect x="158" y="24" width="120" height="44" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="218" y="44" fill="var(--ink)" text-anchor="middle">检索 4 块</text>
<text x="218" y="60" fill="var(--ink-soft)" text-anchor="middle" font-size="11">hybrid+rerank</text>
<line x1="278" y1="46" x2="308" y2="46" stroke="var(--ink-soft)" marker-end="url(#ev260a)"/>
<rect x="310" y="24" width="120" height="44" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="370" y="44" fill="var(--ink)" text-anchor="middle">生成回答</text>
<text x="370" y="60" fill="var(--ink-soft)" text-anchor="middle" font-size="11">Day 227 提示词</text>
<line x1="370" y1="68" x2="370" y2="96" stroke="var(--ink-soft)" marker-end="url(#ev260a)"/>
<rect x="300" y="98" width="140" height="36" rx="4" fill="none" stroke="var(--rule)"/>
<text x="370" y="121" fill="var(--ink)" text-anchor="middle">有标准文章吗?</text>
<line x1="330" y1="134" x2="130" y2="176" stroke="var(--ink-soft)" marker-end="url(#ev260a)"/>
<line x1="370" y1="134" x2="330" y2="176" stroke="var(--ink-soft)" marker-end="url(#ev260a)"/>
<line x1="410" y1="134" x2="530" y2="176" stroke="var(--ink-soft)" marker-end="url(#ev260a)"/>
<text x="220" y="150" fill="var(--ink-faint)" font-size="11">有</text>
<text x="490" y="150" fill="var(--ink-faint)" font-size="11">没有</text>
<rect x="40" y="178" width="180" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="130" y="198" fill="var(--ink)" text-anchor="middle">忠实裁判</text>
<text x="130" y="216" fill="var(--ink-soft)" text-anchor="middle" font-size="11">看:资料 + 回答</text>
<text x="130" y="234" fill="var(--ink-faint)" text-anchor="middle" font-size="11">抓编造</text>
<rect x="240" y="178" width="180" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="330" y="198" fill="var(--ink)" text-anchor="middle">完整裁判</text>
<text x="330" y="216" fill="var(--ink-soft)" text-anchor="middle" font-size="11">看:问题 + 要点 + 回答</text>
<text x="330" y="234" fill="var(--ink-faint)" text-anchor="middle" font-size="11">抓漏答</text>
<rect x="440" y="178" width="180" height="70" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="530" y="198" fill="var(--ink)" text-anchor="middle">拒答裁判</text>
<text x="530" y="216" fill="var(--ink-soft)" text-anchor="middle" font-size="11">看:问题 + 回答</text>
<text x="530" y="234" fill="var(--ink-faint)" text-anchor="middle" font-size="11">抓没答案时硬编</text>
<text x="320" y="270" fill="var(--ink-soft)" text-anchor="middle" font-size="11">每个裁判只输出一个 true/false 加一句理由,JSON 格式</text>
</g>
</svg>
<figcaption>一道题的生成评估。注意三个裁判看到的材料不一样:忠实裁判不看问题,只管「说的有没有依据」;完整裁判不看资料,只管「要点到没到」;拒答裁判只看问题和回答。</figcaption>
</figure>

这里有两个设计,都是做过的人反复强调的经验。

**每个裁判只判一件事。** 把忠实、完整放进一个提示词让模型一次判完,省一次调用,可它判 A 的时候会被 B 带偏,判错了你也分不清是哪一项出的问题。一件事一个裁判,出了问题看理由一眼就知道。

**只判是和否,不打 1 到 10 分。** 让模型打分,同一个回答这次 7 分下次 8 分,你也说不清 7 分和 8 分差在哪。是和否稳定得多,也好和人工对齐:你自己看一遍,同意还是不同意,一目了然。Hamel Husain 那篇讲 LLM 裁判的文章(学习资料里有)把这条放在最前面。打分制什么时候用、裁判怎么和人对齐,第六部分 [Day 355](/blog/agent-zero/day-355-llm-judge-1/) 到 [Day 359](/blog/agent-zero/day-359-llm-judge-4/) 会花五天细讲,今天先用起来。

## 第一步:最小版,一个裁判判两个回答

先不接检索,手写一段资料、两个回答,一个照着资料答,一个编了一句,看裁判分不分得清。新建 `part04/judge_one.py`:

```python
# agent-zero-lab/part04/judge_one.py  最小版裁判:给一段资料和两个回答,让大模型判「每句话有没有依据」
import json

from common.llm import LLMClient

client = LLMClient()

JUDGE = """你是严格的审核员。下面有一段【资料】和一个客服【回答】。
逐句检查回答中的事实性陈述(规则、数字、步骤、时限),判断它们是否都能在资料中找到明确依据。
只输出 JSON:{"faithful": true 或 false, "unsupported": ["没有依据的陈述", ...]}"""

context = "月付套餐不支持中途退款。取消订阅后,当期结束时停止服务,不再续费,当期费用不退。"
ANSWERS = {
    "照着资料答": "不能。月付套餐不支持中途退款,取消后当期结束停止服务。",
    "编了一句": "可以。月付套餐按剩余天数退款,3 个工作日到账。",
}
if __name__ == "__main__":
    for name, answer in ANSWERS.items():
        r = client.chat(
            [{"role": "system", "content": JUDGE}, {"role": "user", "content": f"【资料】\n{context}\n\n【回答】\n{answer}"}],
            temperature=0,
            response_format={"type": "json_object"},
        )
        print(name, json.loads(r.content))
    print("---", client.ledger)
```

<div class="line-notes">

- `from common.llm import LLMClient` Day 135 写的客户端,裁判和生成用同一个,`client.ledger` 记账。
- `JUDGE = """你是严格的审核员。` 裁判的规矩全写在 system 里。「严格」两个字是有用的,不写的话模型倾向于说好话。
- `逐句检查回答中的事实性陈述(规则、数字、步骤、时限)` 告诉它什么算「事实」。括号里四类正是客服回答里最容易编的东西。
- `只输出 JSON:{"faithful": true 或 false, "unsupported": ["没有依据的陈述", ...]}` 规定输出的形状。除了是和否,还要它列出哪几句没依据,`unsupported` 是给人看的,判否的时候一眼就知道是哪句。
- `context = "月付套餐不支持中途退款。` 直接抄 kb-002 讲月付的那一块,不接检索,先把裁判单独验证一下。
- `"编了一句": "可以。月付套餐按剩余天数退款,3 个工作日到账。",` 两处编造:按天退款、3 个工作日到账,资料里都没有。
- `if __name__ == "__main__":` 下面第二个脚本要 import 这里的 `JUDGE` 和 `context`,放进 main guard,import 时就不会把这两次调用也跑一遍。我第一版没写,第二个脚本一运行就多花了两次调用的钱。
- `[{"role": "system", "content": JUDGE}, {"role": "user", "content": f"【资料】\n{context}\n\n【回答】\n{answer}"}],` 裁判规矩放 system,待判的材料放 user,用【】标出两段,模型不容易把资料和回答搞混。
- `temperature=0,` 同一份材料尽量每次判得一样。不保证完全一样,练习 2 会测。
- `response_format={"type": "json_object"},` JSON 模式,[Day 147](/blog/agent-zero/day-147-structured-1/) 讲过:接口保证返回的是合法 JSON。下一节会看到它有个前提。
- `print(name, json.loads(r.content))` `r.content` 是字符串,`json.loads` 转成字典。

</div>

```bash
uv run python -m part04.judge_one
```

```text
照着资料答 {'faithful': True, 'unsupported': []}
编了一句 {'faithful': False, 'unsupported': ['月付套餐按剩余天数退款', '3 个工作日到账']}
--- 2 次调用 | 输入 285 / 输出 40 tokens | 约 ¥0.0009
```

两个都判对了,编的两句也都点出来了。开头那个「可以」没被列进去,严格说它也是错的结论,不过它没有具体的规则和数字,裁判没把它当成事实陈述。这是第一个提醒:裁判判的是你在提示词里定义的东西,你没定义的,它不一定管。

## 故意踩坑:开了 JSON 模式,提示词里却没写 JSON

我第一次写裁判提示词时,觉得「输出一个对象,字段 faithful 取 true 或 false」已经说得很清楚了,没写「JSON」这个词。新建 `part04/judge_nojson.py` 试一下:

```python
# agent-zero-lab/part04/judge_nojson.py  坑:开了 JSON 模式,提示词里却没写「JSON」这个词
from common.llm import LLMClient
from part04.judge_one import context

client = LLMClient()
NO_WORD = """你是严格的审核员。判断【回答】里的每句事实是否都能在【资料】里找到依据。
输出一个对象,字段 faithful 取 true 或 false。"""
r = client.chat(
    [{"role": "system", "content": NO_WORD}, {"role": "user", "content": f"【资料】\n{context}\n\n【回答】\n月付可以按天退款。"}],
    temperature=0,
    response_format={"type": "json_object"},
)
print(r.content)
```

<div class="line-notes">

- `from part04.judge_one import context` 复用同一段资料。因为 `judge_one.py` 有 main guard,这一行不会触发那边的两次调用。
- `输出一个对象,字段 faithful 取 true 或 false。"""` 意思和上面一样,只是没出现「JSON」这几个字母。
- `response_format={"type": "json_object"},` JSON 模式照样开着。

</div>

```bash
uv run python -m part04.judge_nojson
```

只贴报错的最后一行:

```text
openai.BadRequestError: Error code: 400 - {'error': {'message': "Prompt must contain the word 'json' in some form to use 'response_format' of type 'json_object'. (request_id: b48f237e-b7c9-4e70-893e-0edadd6d2260)", 'type': 'invalid_request_error', 'param': None, 'code': 'invalid_request_error'}}
```

400 是请求本身不合格,服务端直接拒了,没花钱。报错写得很直白:用 `json_object` 时,提示词里必须以某种形式出现 json 这个词。原因是 JSON 模式只保证「语法合法」,模型得从提示词里知道你想要 JSON。OpenAI 的文档对同一条限制的解释是:不说清楚的话,模型可能一直输出空白直到 token 用完,所以厂商干脆在入口就挡住。[DeepSeek 的 JSON Output 文档](https://api-docs.deepseek.com/zh-cn/guides/json_mode)列了四条注意事项:提示词里要有 json 字样并给出样例、`max_tokens` 要设够防止被截断、还有一定概率返回空的 content。修法很简单,提示词里写上「只输出 JSON」,再给一个示例对象,就像 `judge_one.py` 那样。空 content 交给 `json.loads` 会报 `JSONDecodeError`,下面的正式脚本会接住它。

## 第二步:礼貌用语算不算事实

客服回答经常带一句「建议转人工客服」「还有问题随时咨询」。这些话资料里没有,严格的裁判会不会把它们也判成没依据?写旧课的时候我遇到过:裁判把「建议您联系客服」判成无依据,忠实率低得离谱,一看明细全是这种误判。所以裁判提示词里要补一句「礼貌用语和建议转人工不算事实陈述」。

这次我想复现一下,新建 `part04/judge_polite.py`,两个回答都带客服用语,第一个还多编了一句工作时间:

```python
# agent-zero-lab/part04/judge_polite.py  坑:裁判把「建议转人工」当成没依据的事实
import json

from common.llm import LLMClient
from part04.judge_one import JUDGE, context

client = LLMClient()
FIXED = JUDGE.replace("只输出 JSON", "礼貌用语和「建议转人工」这类话不算事实陈述。\n只输出 JSON")

answers = [
    "不能。月付套餐不支持中途退款,当期费用不退。如果还有疑问,建议联系人工客服,工作日 9 点到 18 点在线。",
    "月付不能中途退款。还有其他问题欢迎随时咨询,也可以转人工客服处理。",
]
for name, system in [("原版裁判", JUDGE), ("加一句的裁判", FIXED)]:
    for a in answers:
        r = client.chat(
            [{"role": "system", "content": system}, {"role": "user", "content": f"【资料】\n{context}\n\n【回答】\n{a}"}],
            temperature=0,
            response_format={"type": "json_object"},
        )
        print(name, json.loads(r.content))
print("---", client.ledger)
```

<div class="line-notes">

- `FIXED = JUDGE.replace("只输出 JSON", "礼貌用语和「建议转人工」这类话不算事实陈述。\n只输出 JSON")` 用字符串替换在「只输出 JSON」前面插一句,其他一字不改,两版裁判只差这一句。`replace` 相当于 JS 的 `str.replace`,不过 Python 默认替换所有出现的地方。
- `建议联系人工客服,工作日 9 点到 18 点在线。",` 前半句是客服用语,后半句「9 点到 18 点」是编的具体时间。好的裁判应该放过前半句、抓住后半句。
- `"月付不能中途退款。还有其他问题欢迎随时咨询,也可以转人工客服处理。",` 只有客服用语,没有编造,应该判忠实。
- `for name, system in [("原版裁判", JUDGE), ("加一句的裁判", FIXED)]:` 两版裁判各判两个回答,一共 4 次调用。

</div>

```bash
uv run python -m part04.judge_polite
```

```text
原版裁判 {'faithful': False, 'unsupported': ['工作日 9 点到 18 点在线']}
原版裁判 {'faithful': True, 'unsupported': []}
加一句的裁判 {'faithful': False, 'unsupported': ['工作日 9 点到 18 点在线']}
加一句的裁判 {'faithful': True, 'unsupported': []}
--- 4 次调用 | 输入 634 / 输出 70 tokens | 约 ¥0.0018
```

旧坑这次**没复现**:原版裁判也没把「建议转人工」当成事实。换了模型、换了版本,它的「默认判断」就可能不一样,这本身就是一个要记住的事:裁判的行为会随模型变,换模型后要重新抽查。

那这一句还留不留?我留。它花不了几个 token,换个更死板的模型时能防住那个误判。更要紧的是确认它没有副作用:加了这一句以后,裁判有没有因此对「工作日 9 点到 18 点在线」这种夹在客服用语里的编造网开一面?上面第三行说没有,照样抓住了。改裁判提示词时,要像改代码一样同时测「该放过的放过了」和「该抓的还抓着」。

## 第三步:三个裁判接上整条 RAG

现在把三个裁判、检索、生成接起来,跑整个评估集。新建 `part04/eval_generation.py`:

```python
# agent-zero-lab/part04/eval_generation.py  生成评估:跑完整 RAG,再让大模型当裁判,判忠实、完整、拒答三件事
"""用法(在 agent-zero-lab/ 下):
  uv run python -m part04.eval_generation                    hybrid+rerank,k=4,30 道全跑
  uv run python -m part04.eval_generation vector 4 3         只跑前 3 道,先试一下
"""
import json
import sys

from common.llm import LLMClient
from part04.eval_set import EVAL_PATH, load_eval_set
from part04.prompts import SYSTEM, build_messages
from part04.retrieve import retrieve

OUT = EVAL_PATH.parent / "generation_results.jsonl"
client = LLMClient()

JUDGE_FAITHFUL = """你是严格的审核员。下面有一段【资料】和一个客服【回答】。
逐句检查回答中的事实性陈述(规则、数字、步骤、时限),判断它们是否都能在资料中找到明确依据。
礼貌用语和「建议转人工」这类话不算事实陈述。
只输出 JSON:{"faithful": true 或 false, "unsupported": ["没有依据的陈述", ...]}"""

JUDGE_COMPLETE = """你是严格的审核员。下面有一个用户【问题】、一份【必须包含的要点】和客服【回答】。
判断回答是否覆盖了每一个要点(意思一致即可,不要求字面相同)。
只输出 JSON:{"complete": true 或 false, "missing": ["缺失的要点", ...]}"""

JUDGE_REFUSED = """下面是用户【问题】和客服【回答】。帮助中心里其实没有这个问题的答案。
判断回答是否老实表示没有找到相关信息或建议转人工,并且没有编造具体的规则、数字或联系方式。
只输出 JSON:{"refused": true 或 false, "reason": "一句话理由"}"""


def ask_judge(system: str, user: str) -> dict:
    r = client.chat(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=0,
        response_format={"type": "json_object"},
    )
    try:
        return json.loads(r.content)
    except json.JSONDecodeError:
        return {"error": r.content[:200]}


def run_one(row: dict, mode: str, k: int, system: str = SYSTEM) -> dict:
    chunks = [c for c, _ in retrieve(row["question"], k=k, mode=mode)]
    answer = client.chat(build_messages(row["question"], chunks, system), temperature=0).content
    r = {"id": row["id"], "type": row["type"], "question": row["question"],
         "answerable": bool(row["expected_docs"]), "chunks": [c.id for c in chunks], "answer": answer}
    if r["answerable"]:
        context = "\n\n".join(c.text for c in chunks)
        r |= ask_judge(JUDGE_FAITHFUL, f"【资料】\n{context}\n\n【回答】\n{answer}")
        r |= ask_judge(JUDGE_COMPLETE, f"【问题】{row['question']}\n【必须包含的要点】{row['answer_points']}\n\n【回答】\n{answer}")
    else:
        r |= ask_judge(JUDGE_REFUSED, f"【问题】{row['question']}\n\n【回答】\n{answer}")
    return r


def rate(rs: list[dict], key: str) -> str:
    if not rs:
        return "无题"
    n = sum(bool(r.get(key)) for r in rs)
    return f"{n}/{len(rs)} = {n / len(rs):.0%}"


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "hybrid+rerank"
    k = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    limit = int(sys.argv[3]) if len(sys.argv) > 3 else None
    rows = load_eval_set()[:limit]
    OUT.write_text("", encoding="utf-8")
    results = []
    for row in rows:
        r = run_one(row, mode, k)
        with OUT.open("a", encoding="utf-8") as f:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
        results.append(r)
        flags = " ".join(f"{key}={r[key]}" for key in ("faithful", "complete", "refused") if key in r)
        print(f"{r['id']} {flags}{'  裁判出错' if 'error' in r else ''}  {row['question']}")

    errors = [r for r in results if "error" in r]
    judged = [r for r in results if "error" not in r]
    answerable = [r for r in judged if r["answerable"]]
    unanswerable = [r for r in judged if not r["answerable"]]
    print(f"\n{mode} k={k}  忠实 {rate(answerable, 'faithful')}  完整 {rate(answerable, 'complete')}"
          f"  拒答 {rate(unanswerable, 'refused')}")
    if errors:
        print(f"裁判出错 {len(errors)} 题,没算进上面的比率:" + " ".join(r["id"] for r in errors))
    print("明细:", OUT)
    print("---", client.ledger)


if __name__ == "__main__":
    main()
```

<div class="line-notes">

- `"""用法(在 agent-zero-lab/ 下):` 第三个参数是「只跑前几道」。花钱的脚本先用 3 道试一下,确认流程通了再全跑。
- `from part04.prompts import SYSTEM, build_messages` 和 Day 255 用的同一份回答提示词。评估用的提示词要和线上一模一样,不然分数说明不了线上。
- `OUT = EVAL_PATH.parent / "generation_results.jsonl"` 明细写到 `data/eval/` 下,和评估集放一起。
- `JUDGE_FAITHFUL = """你是严格的审核员。` 忠实裁判,就是上一步加了一句的 `FIXED`。它只拿资料和回答,**不看问题**,答没答到点子上不归它管。
- `JUDGE_COMPLETE = """你是严格的审核员。` 完整裁判,拿问题、要点和回答,不看资料。
- `判断回答是否覆盖了每一个要点(意思一致即可,不要求字面相同)。` 这句很重要。要点写「月付不支持退款」,回答写「月付套餐不支持中途退款」,不加这句,死板的裁判会判漏答。Day 257 标要点不标全文,就是为了让这里能按意思判。
- `JUDGE_REFUSED = """下面是用户【问题】和客服【回答】。帮助中心里其实没有这个问题的答案。` 拒答裁判直接告诉它「这题本来就没答案」,它只需要判回答老不老实。
- `并且没有编造具体的规则、数字或联系方式。` 光说「没找到」还不够,后面又补一句「客服电话是 400-xxx」照样不及格。两个条件都要满足。
- `def ask_judge(system: str, user: str) -> dict:` 三个裁判共用,区别只在 system 提示词。
- `except json.JSONDecodeError:` JSON 模式下很少发生,但输出被截断时(比如 `max_tokens` 太小)会出现。不抛异常,让 30 道题能跑完。
- `return {"error": r.content[:200]}` 留前 200 个字方便排查。合并进结果后,这道题就多了 `error` 键,下面会单独数出来。
- `def run_one(row: dict, mode: str, k: int, system: str = SYSTEM) -> dict:` 一道题的「检索 → 生成 → 裁判」。拆成函数,练习里可以换提示词、换 k 单独跑一道。
- `chunks = [c for c, _ in retrieve(row["question"], k=k, mode=mode)]` 这里取的就是 k 块,不像 Day 259 要多取。线上真的就是把这 k 块塞给模型,评估要和线上一样。
- `answer = client.chat(build_messages(row["question"], chunks, system), temperature=0).content` 生成回答。q02 实跑的回答是 `不能。月付套餐不支持中途退款；取消订阅后，当期结束时停止服务，不再续费，当期费用不退。[kb-002#2]`。
- `"answerable": bool(row["expected_docs"]), "chunks": [c.id for c in chunks], "answer": answer}` 「有没有答案」直接记成一个字段,后面分组靠它。`chunks` 记下这道题塞给模型的是哪几块,诊断时离不开它。
- `context = "\n\n".join(c.text for c in chunks)` 给忠实裁判的资料只要原文,不要 `<doc>` 标签。
- `r |= ask_judge(JUDGE_FAITHFUL, f"【资料】\n{context}\n\n【回答】\n{answer}")` `|=` 是字典原地合并,把裁判返回的 `faithful`、`unsupported` 两个键并进 `r`,相当于 JS 的 `Object.assign(r, result)`。[Day 253](/blog/agent-zero/day-253-graphrag-local/) 用过集合的 `|=`,字典也能这么写。
- `r |= ask_judge(JUDGE_COMPLETE, f"【问题】{row['question']}\n【必须包含的要点】{row['answer_points']}\n\n【回答】\n{answer}")` 要点列表直接转成字符串塞进去,带方括号和引号,模型照样看得懂。
- `r |= ask_judge(JUDGE_REFUSED, f"【问题】{row['question']}\n\n【回答】\n{answer}")` 无答案题只判这一项。
- `def rate(rs: list[dict], key: str) -> str:` 算比率,返回 `24/26 = 92%` 这样的字符串,分子分母都带上,比只给百分比好核对。
- `if not rs:` 没有题时返回「无题」,不去除以 0。只跑前 3 道时没有无答案题,就会走到这里。
- `n = sum(bool(r.get(key)) for r in rs)` `r.get(key)` 没有这个键时返回 `None`,`bool(None)` 是 False;`sum` 一串布尔值时 True 当 1。
- `limit = int(sys.argv[3]) if len(sys.argv) > 3 else None` 不传就是 `None`,下一行 `[:None]` 等于整个列表。
- `OUT.write_text("", encoding="utf-8")` 先清空上一次的明细,下面逐行追加。
- `with OUT.open("a", encoding="utf-8") as f:` 每道题判完**立刻**追加一行,`"a"` 是追加模式。跑到一半断网,前面已经花钱判完的题都还在文件里。我旧课第一版是全部跑完才一次写,中途崩了一行都没留下。
- `flags = " ".join(f"{key}={r[key]}" for key in ("faithful", "complete", "refused") if key in r)` 只挑这道题实际有的那几项打印。q02 是 `faithful=True complete=True`,q27 只有 `refused=True`。
- `errors = [r for r in results if "error" in r]` 有任何一个裁判出错,整道题先拿出来。
- `judged = [r for r in results if "error" not in r]` 只用裁判都正常给了结论的题算比率。为什么要这么麻烦,练习 3 会演示不这么做的后果。
- `answerable = [r for r in judged if r["answerable"]]` 有答案的题,算忠实和完整。
- `if errors:` 有出错的题就多打一行,告诉你分母里少了谁。

</div>

先跑 3 道试水:

```bash
uv run python -W ignore -m part04.eval_generation hybrid+rerank 4 3
```

```text
q01 faithful=True complete=True  年付专业版用了两个月,想退款可以吗
q02 faithful=True complete=True  月付的能退钱吗
q03 faithful=True complete=True  这个月被扣了两次钱

hybrid+rerank k=4  忠实 3/3 = 100%  完整 3/3 = 100%  拒答 无题
明细: /Users/你/agent-zero-lab/data/eval/generation_results.jsonl
--- 9 次调用 | 输入 3091 / 输出 307 tokens | 约 ¥0.0071
```

3 道题 9 次调用,每道题一次生成加两次裁判。流程通了,30 道全跑:

```bash
uv run python -W ignore -m part04.eval_generation
```

```text
q01 faithful=True complete=True  年付专业版用了两个月,想退款可以吗
q02 faithful=True complete=True  月付的能退钱吗
q03 faithful=True complete=True  这个月被扣了两次钱
q04 faithful=True complete=True  退款多久到账
q05 faithful=True complete=True  怎么申请退款
q06 faithful=True complete=True  已经开了发票还能退款吗
q07 faithful=True complete=True  自动扣款失败了会怎样
q08 faithful=True complete=True  降级以后多出来的账本会被删吗
q09 faithful=True complete=True  能开增值税专用发票吗
q10 faithful=True complete=True  优惠码能和别的优惠一起用吗
q11 faithful=True complete=True  导入流水报 E1042
q12 faithful=True complete=True  E1043 怎么解决
q13 faithful=True complete=True  上传发票提示 E2017
q14 faithful=True complete=True  付款时出现 E3001
q15 faithful=True complete=True  API 返回 E4029
q16 faithful=True complete=True  连续付款失败被锁了,多久能再付
q17 faithful=True complete=False  买错了能把钱要回来吗
q18 faithful=True complete=True  Excel 存的 csv 传上去说格式不对,好像是乱码
q19 faithful=True complete=True  老板想看所有账但不能让他改
q20 faithful=True complete=True  换了手机号,收不到验证码登不上
q21 faithful=True complete=True  不想用了,怎么把账号删掉
q22 faithful=True complete=True  外币的账怎么记
q23 faithful=True complete=True  发票抬头写错了,而且我想退款
q24 faithful=True complete=True  免费版能建几个账本,一天能导出几次
q25 faithful=True complete=True  扣款失败数据会丢吗,降级后账本还能用吗
q26 faithful=True complete=False  导入流水支持哪些银行,文件编码有要求吗
q27 refused=True  你们支持微信支付吗
q28 refused=True  有没有手机 App
q29 refused=True  有学生优惠吗
q30 refused=True  客服电话是多少

hybrid+rerank k=4  忠实 26/26 = 100%  完整 24/26 = 92%  拒答 4/4 = 100%
明细: /Users/你/agent-zero-lab/data/eval/generation_results.jsonl
--- 86 次调用 | 输入 29878 / 输出 3422 tokens | 约 ¥0.0701
```

用了 1 分 34 秒。86 次调用是 30 次生成、26 道有答案题各两次裁判、4 道无答案题各一次裁判:30 + 52 + 4 = 86。钱按全部没命中缓存的高峰价算是 29878 × 2 / 10⁶ + 3422 × 8 / 10⁶ ≈ ¥0.087;三个裁判的 system 提示词每次都一样,DeepSeek 自动缓存了相同的开头,命中部分按 0.04 元算,`LLMClient` 记下的实际是 ¥0.0701。一次完整的生成评估七分钱,改一次提示词就能重跑一次。

## 读结果:两道「不完整」各是谁的锅

总分很好看:忠实 100%、完整 92%、拒答 100%。先别高兴,打开明细看判否的两道题。明细是 JSONL,一行一道,可以用 [Day 39](/blog/agent-zero/day-039-json/) 学过的办法读,也可以直接在编辑器里搜 `"complete": false`。

**q26「导入流水支持哪些银行,文件编码有要求吗」。** 明细里这一行:

```text
"chunks": ["kb-009#1", "kb-009#2", "kb-010#1", "kb-010#2"]
"answer": "关于银行：工商银行、招商银行、建设银行网银导出的流水文件可以自动识别格式，其他银行请使用模板 [kb-009#1]。\n\n关于文件编码：帮助中心里没有找到这个问题的说明，建议转人工客服。"
"faithful": true, "complete": false, "missing": ["需要 UTF-8 编码"]
```

模型拿到的 4 块里没有一块讲编码(kb-011 是 Day 259 那道被 rerank 挤出前 10 的),它老老实实说了「关于文件编码没找到」。忠实是对的,完整是错的。这是**检索层的问题**,和 Day 259 的失败清单对得上。改提示词没用,要改检索。

**q17「买错了能把钱要回来吗」。** 明细:

```text
"chunks": ["kb-003#1", "kb-002#4", "kb-002#3", "kb-003#2"]
"answer": "可以申请退款，但需要客服主管审批，审批通过后才会原路退回。[kb-003#1][kb-002#4]\n\n条件和步骤：\n1. 进入「设置 → 订阅 → 申请退款」… (后面还有审批时限、到账时间、先红冲发票、重复扣款)"
"faithful": true, "complete": false, "missing": ["年付按剩余整月比例退款,当月不退", "月付不退当期"]
```

回答很长,讲了怎么申请、谁审批、几天到账,却没说最关键的「能退多少」。第一眼看,这像生成层的问题:用户问「能不能退」,模型答成了「怎么退」。我写旧课时就是这么下的结论,建议去改提示词。

再看 `chunks`:kb-003 两块(怎么申请、发票红冲)、kb-002 第 3 块(重复扣款)、kb-002 第 4 块(审批与到账)。写着「年付按剩余整月比例退」的 kb-002#1 和「月付不退」的 kb-002#2 **都不在里面**。模型手里根本没有这两条规则,它照着手上的资料答,一句没编,所以忠实是 True。这其实是**检索层的问题**,只不过发生在块这一级:Day 259 按文章打分,kb-002 在前 4 篇里,recall 是 1.0,看不出来。

怎么证明?换 k 再判一次。如果是检索的锅,给它更多块,规则块进来了,就该判完整;如果是生成的锅,规则块进来了它还是答「怎么退」。这就是练习 4,先说结果:k=4 时没有规则块、判不完整;k=6 时进来了月付那块,还漏年付;k=8 时两块都在,判完整。

所以两道「不完整」**都是检索的问题**,一道在文章级,一道在块级。这个结论和我旧课里的判断不一样,差别就在于这次把 `chunks` 也记进了明细。生成评估判出「不完整」以后,第一件事是看模型手里到底有什么,再决定怪谁。

**忠实 100% 也别全信。** 我抽了几条看。q19「老板想看所有账但不能让他改」,回答说「建议分配只读成员角色……设置入口和具体操作步骤,帮助中心里没有找到」,资料里确实没写步骤,裁判判忠实、完整都对。q09 的专票回答把「付款后 90 天内申请、1 到 2 个工作日开出」都对着资料写了,裁判也是对的。几条看下来没发现裁判判错,但 26 道题、一次运行,只能说「没发现问题」,不能说「裁判可靠」。裁判和人工对不对得上,要专门标一批题算一致率,那是 [Day 358](/blog/agent-zero/day-358-llm-judge-3/) 的事。

**同一个模型自己判自己。** 今天生成和裁判用的都是 deepseek-flash。自己判自己容易手软,正式项目里裁判最好用更强的、或者至少不同家的模型。我们这里先图便宜,知道有这个风险就行。

## 今天的文件

| 文件 | 干什么 | 谁会用 |
| --- | --- | --- |
| `part04/eval_generation.py` | 生成评估主脚本:`ask_judge`、`run_one`、`rate`、三个裁判提示词 | Day 261 的实验,练习里 import |
| `data/eval/generation_results.jsonl` | 每道题一行:回答、用了哪几块、三个裁判的结论和理由 | 人工抽查、诊断 |
| `part04/judge_one.py` | 最小版裁判,`JUDGE`、`context` | 今天另外两个小脚本 import |
| `part04/judge_nojson.py`、`judge_polite.py` | 演示两个坑 | 只今天 |

## 动手练习

**练习 1:宽松提示词下的拒答。** Day 255 有一版宽松提示词 `LOOSE`(在 `part04/two_layers.py` 里),不要求「没找到就说没找到」。用 `run_one` 在 4 道无答案题上分别跑严格版 `SYSTEM` 和 `LOOSE`,同时用 Day 255 那种「回答里有没有『没有找到』」的关键词办法判一次,和裁判比。写 `part04/ex260_1.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex260_1.py  练习 1:换成 Day 255 的宽松提示词,只跑 4 道无答案题,看拒答率
from part04.eval_generation import client, run_one
from part04.eval_set import load_eval_set
from part04.prompts import SYSTEM
from part04.two_layers import LOOSE

rows = [r for r in load_eval_set() if not r["expected_docs"]]
for name, system in [("严格", SYSTEM), ("宽松", LOOSE)]:
    ok = kw = 0
    for row in rows:
        r = run_one(row, "hybrid+rerank", 4, system)
        ok += bool(r.get("refused"))
        kw += "没有找到" in r["answer"]
        print(f"  {name} {r['id']} 裁判={r.get('refused')} 关键词={'没有找到' in r['answer']}  {r['answer'][:40]!r}")
    print(f"{name}提示词:裁判判拒答 {ok}/{len(rows)},查关键词判拒答 {kw}/{len(rows)}")
print("---", client.ledger)
```

<div class="line-notes">

- `from part04.two_layers import LOOSE` Day 255 的宽松提示词:「参考资料回答用户问题,语气热情,尽量给用户一个明确的答案」。
- `rows = [r for r in load_eval_set() if not r["expected_docs"]]` 只要 q27 到 q30 四道无答案题。
- `ok = kw = 0` 连等赋值,两个计数器都从 0 开始。
- `r = run_one(row, "hybrid+rerank", 4, system)` 第四个参数换提示词,这就是 `run_one` 留 `system` 参数的用处。
- `kw += "没有找到" in r["answer"]` `in` 判断子串,得到布尔值,加到整数上 True 当 1。
- `{r['answer'][:40]!r}` `!r` 用 `repr()` 显示,换行会显示成 `\n`,一行打得下。

</div>

```text
  严格 q27 裁判=True 关键词=True  '帮助中心里没有找到这个问题的说明,建议转人工客服。'
  严格 q28 裁判=True 关键词=True  '帮助中心里没有找到这个问题的说明,建议转人工客服。'
  严格 q29 裁判=True 关键词=True  '帮助中心里没有找到这个问题的说明,建议转人工客服。'
  严格 q30 裁判=True 关键词=True  '帮助中心里没有找到这个问题的说明,建议转人工客服。'
严格提示词:裁判判拒答 4/4,查关键词判拒答 4/4
  宽松 q27 裁判=True 关键词=False  '您好！关于支付方式的问题，我这边资料里暂时没有明确说明是否支持微信支付，所以没法'
  宽松 q28 裁判=True 关键词=False  '您好！关于手机 App 的问题，我这边资料里暂时没有明确提到云簿是否有独立的手机'
  宽松 q29 裁判=True 关键词=False  '您好!关于学生优惠,我查了一下目前的资料,暂时没有看到 CloudLedger '
  宽松 q30 裁判=True 关键词=False  '您好!非常感谢您的咨询~ 不过很抱歉,我这边暂时没有查到客服电话的具体信息,资料'
宽松提示词:裁判判拒答 4/4,查关键词判拒答 0/4
--- 16 次调用 | 输入 4194 / 输出 681 tokens | 约 ¥0.0116
```

这次宽松提示词下模型也没编,四道都老实说了没有,只是说法五花八门:「没有明确说明」「没有看到」「没有查到」。关键词办法 0/4 全判错,裁判 4/4 都认出来了。这就是今天换掉关键词的理由:一旦回答不用固定话术,查关键词就失灵。

另外,Day 255 用宽松提示词时模型在一道题上编了「公司位于杭州」,今天这 4 道没编。同一个提示词,这次没出事不代表下次不出事,无答案题要一直留在评估集里。

</details>

**练习 2:裁判稳不稳。** 从明细里取出 q17 的回答,让完整裁判连判 5 次;再手写一个换了说法但要点都有的好回答,判一次,看「意思一致即可」那句管不管用。写 `part04/ex260_2.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex260_2.py  练习 2:裁判稳不稳?同一个回答让完整裁判判 5 次;再换个说法的好回答判一次
import json

from part04.eval_generation import JUDGE_COMPLETE, OUT, ask_judge, client

saved = {r["id"]: r for r in map(json.loads, OUT.read_text(encoding="utf-8").splitlines())}
q17 = saved["q17"]
points = ["年付按剩余整月比例退款,当月不退", "月付不退当期"]
user = f"【问题】{q17['question']}\n【必须包含的要点】{points}\n\n【回答】\n{q17['answer']}"
print("q17 原回答判 5 次:", [ask_judge(JUDGE_COMPLETE, user)["complete"] for _ in range(5)])

good = "能退一部分。年付的话,用过的月份和这个月不退,剩下的整月按比例退给你;月付的这一期不退,取消后用到期末。"
user2 = f"【问题】{q17['question']}\n【必须包含的要点】{points}\n\n【回答】\n{good}"
print("换说法的好回答:", ask_judge(JUDGE_COMPLETE, user2))
print("---", client.ledger)
```

<div class="line-notes">

- `saved = {r["id"]: r for r in map(json.loads, OUT.read_text(encoding="utf-8").splitlines())}` 从里往外读:读整个明细文件、按行切开、每行 `json.loads`,再用字典推导式按 id 建索引。`map(f, list)` 相当于 JS 的 `list.map(f)`,不过返回的是一个惰性的迭代器。要先跑过一次主脚本,明细里才有 q17。
- `points = ["年付按剩余整月比例退款,当月不退", "月付不退当期"]` 和评估集里 q17 的要点一样。
- `[ask_judge(JUDGE_COMPLETE, user)["complete"] for _ in range(5)]` 同一份材料判 5 次,只收 `complete` 的值。`_` 表示循环变量用不上。
- `good = "能退一部分。年付的话` 和要点的字面几乎没有重合:要点写「按剩余整月比例退款」,这里写「剩下的整月按比例退给你」。

</div>

```text
q17 原回答判 5 次: [False, False, False, False, False]
换说法的好回答: {'complete': True, 'missing': []}
--- 6 次调用 | 输入 1892 / 输出 150 tokens | 约 ¥0.0037
```

5 次都一样,换了说法的好回答也判对了。这次很稳,因为 q17 的回答确实一个字都没提退多少钱,不存在模棱两可。真正会摇摆的是边界情况,比如回答说了「按比例退」但没说「当月不退」,这种题多判几次可能有真有假。Day 357 写裁判提示词时会专门讲怎么用例子把边界定死。

</details>

**练习 3:裁判出错的题悄悄消失。** 不调接口,手写 4 条假结果:q01 正常、q02 的忠实裁判输出被截断(只有 `error`)、q03 正常但不完整、q27 是无答案题。先用「有 `faithful` 键的才算有答案题」这种写法算忠实率和完整率,再用 `eval_generation.py` 现在的写法算,比较两种输出。写 `part04/ex260_3.py`。

<details><summary>参考答案</summary>

```python
# agent-zero-lab/part04/ex260_3.py  练习 3:裁判出错的题悄悄从分母里消失,数字会怎样
from part04.eval_generation import rate

results = [
    {"id": "q01", "answerable": True, "faithful": True, "complete": True},
    {"id": "q02", "answerable": True, "complete": False, "error": "{\"faithful\": tr"},  # 忠实裁判输出被截断
    {"id": "q03", "answerable": True, "faithful": True, "complete": False},
    {"id": "q27", "answerable": False, "refused": True},
]

naive = [r for r in results if "faithful" in r]  # 第一版:有 faithful 键的才算有答案题
print("第一版 忠实", rate(naive, "faithful"), " 完整", rate(naive, "complete"))

judged = [r for r in results if "error" not in r]
answerable = [r for r in judged if r["answerable"]]
errors = [r["id"] for r in results if "error" in r]
print("现在的写法 忠实", rate(answerable, "faithful"), " 完整", rate(answerable, "complete"), " 裁判出错:", errors)
```

<div class="line-notes">

- `from part04.eval_generation import rate` 只 import 算比率的函数。`eval_generation.py` 顶上会建 `LLMClient`、连 Postgres,但不会调接口,所以这个练习不花钱。
- `{"id": "q02", "answerable": True, "complete": False, "error": "{\"faithful\": tr"},` 模拟忠实裁判的输出被截断:`json.loads` 失败,`ask_judge` 返回 `{"error": ...}`,所以这道题没有 `faithful` 键,但完整裁判正常,有 `complete`。
- `naive = [r for r in results if "faithful" in r]` 旧课第一版就是这么分组的:有 faithful 键就当有答案题。q02 因为裁判出错少了这个键,被悄悄当成了「不是有答案题」。
- `judged = [r for r in results if "error" not in r]` 现在的写法:先把出错的题整道拿出来。
- `errors = [r["id"] for r in results if "error" in r]` 记下是谁出错了。

</div>

```text
第一版 忠实 2/2 = 100%  完整 1/2 = 50%
现在的写法 忠实 2/2 = 100%  完整 1/2 = 50%  裁判出错: ['q02']
```

两种写法算出来的比率一模一样,区别只在最后那几个字。第一版里 q02 从分母里消失了,你看到「2 道题」,却不知道本来是 3 道;现在的写法明明白白告诉你 q02 没判上,去明细里看它的 `error`。比率本身骗不了人,骗人的是它不告诉你分母少了谁。30 道题少一两道看不出来,出错的往往还是回答特别长、特别难判的那几道,恰好是你最该看的。

</details>

**练习 4(开放题):q17 到底是谁的锅?** 正文说 q17 的「不完整」其实是块级检索的问题。设计一个实验证明它:只跑 q17,k 取 4、6、8,每次打印规则块 kb-002#1、kb-002#2 在不在塞给模型的块里,以及完整裁判的结论。写 `part04/ex260_4.py`。

<details><summary>参考答案</summary>

示范解法:只改 k,其他都不动。如果规则块一进来就判完整,说明模型会用,锅在检索。

```python
# agent-zero-lab/part04/ex260_4.py  练习 4:q17 到底是检索的锅还是生成的锅?k 从 4 换到 6、8 再判一次
from part04.eval_generation import client, run_one
from part04.eval_set import load_eval_set

row = next(r for r in load_eval_set() if r["id"] == "q17")
for k in (4, 6, 8):
    r = run_one(row, "hybrid+rerank", k)
    has_rule = [c for c in r["chunks"] if c in ("kb-002#1", "kb-002#2")]
    print(f"k={k} 规则块 {has_rule}  complete={r['complete']}  missing={r['missing']}")
print("---", client.ledger)
```

<div class="line-notes">

- `row = next(r for r in load_eval_set() if r["id"] == "q17")` `next(生成器)` 取第一个满足条件的元素,相当于 JS 的 `rows.find(r => r.id === "q17")`。
- `for k in (4, 6, 8):` 只改 k 这一个变量,一次实验只改一个东西,结果变了才知道是谁的功劳。
- `has_rule = [c for c in r["chunks"] if c in ("kb-002#1", "kb-002#2")]` kb-002#1 写年付规则,kb-002#2 写月付规则。`run_one` 把块 id 记进了结果,这里才查得到。

</div>

```text
k=4 规则块 []  complete=False  missing=['年付按剩余整月比例退款,当月不退', '月付不退当期']
k=6 规则块 ['kb-002#2']  complete=False  missing=['年付按剩余整月比例退款,当月不退']
k=8 规则块 ['kb-002#2', 'kb-002#1']  complete=True  missing=[]
--- 9 次调用 | 输入 4950 / 输出 875 tokens | 约 ¥0.0134
```

规则块进来几条,模型就答出几条:k=6 只进来月付那块,漏的就只剩年付那条;k=8 两块都在,判完整。模型一直在好好用资料,锅在检索没把规则块排进前 4。

那修法是不是把 k 改成 8?不一定。k 越大,塞给模型的废料越多,别的题可能变差,输入 token 也翻倍。更对症的办法有几个:让 rerank 前的候选池更大、改写口语问题再检索、或者在切块时给每块加上文章标题和小节名,让「买错了能退吗」更容易匹配到「年付套餐退款」那块。哪个有效,得在全部 30 道题上用两个评估脚本一起量,这正是 Day 261 要做的实验。

</details>

**验收标准:** `eval_generation.py` 30 道全跑通,明细文件每行有 `chunks` 和裁判理由;能说出三个裁判各看什么材料、为什么不看其他材料;能用明细里的 `chunks` 解释 q17 和 q26 的「不完整」各错在哪一层,而不是只看裁判的结论。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 生成评估 | 判 RAG 最后的回答好不好,和检索评估分开做。今天判忠实、完整、拒答三件事 |
| LLM-as-judge(大模型当裁判) | 让一个大模型按你写的标准去判另一个模型的输出,输出结构化的结论和理由。比人快、比规则懂意思,但自己也会错 |
| 忠实(faithful) | 回答里每个事实都能在给它的资料里找到依据。不忠实就是编造,也叫幻觉 |
| 完整(complete) | 回答覆盖了评估集标注的每一个要点。不完整就是漏答 |
| 拒答(refused) | 资料里没有答案时,老实说没找到或建议转人工,并且不编具体的规则、数字、联系方式 |
| 二元判断 | 只判是和否,不打分。比 1 到 10 分稳定,也好和人工对齐 |
| 明细(per-item results) | 每道题一行的完整记录,包括回答、用了哪些块、裁判理由。看分数之后一定要看它 |
| 自我偏好 | 裁判和被评的是同一个模型时,倾向于判自己的输出好。正式项目里裁判最好换一个模型 |

## 常见误区

**开了 JSON 模式,提示词里不写 JSON。** DeepSeek 直接 400:`Prompt must contain the word 'json' in some form`。写上「只输出 JSON」,再给一个示例对象。

**一个裁判判好几件事。** 省一次调用,可判错了分不清是哪一项。今天三件事三个裁判,`unsupported`、`missing`、`reason` 各自指向问题在哪。

**让裁判打 1 到 10 分。** 分数不稳定,你也说不清 7 分和 8 分差在哪。先用是和否,确实需要细分再说。

**判出「不完整」就去改提示词。** q17 看着像模型答非所问,打开 `chunks` 才知道规则块根本没进来,k 加到 8 立刻判完整。先看模型手里有什么,再决定怪检索还是怪生成。

**明细里不记用了哪几块。** 不记 `chunks`,q17 就只能凭感觉猜。评估结果多记几个字段不花钱,诊断时全靠它们。

**裁判出错的题不单独数。** 比率照样算得出来,只是分母悄悄少了几道,你看不出来。

**忠实率 100% 就当裁判可靠。** 一次运行、26 道题、裁判和被评模型是同一个,只能说「抽查没发现问题」。和人工对齐要专门做。

**还用查关键词判拒答。** 练习 1 里宽松提示词说法一变,关键词办法 0/4 全判错,裁判 4/4。

**以为补的那句提示词「没用」就删掉。** 「礼貌用语不算事实」这句这次没复现旧坑,但换个模型可能就要用;关键是测过它没让裁判放过真正的编造。

## 学习资料

### 文档与文章

- [Hamel Husain · Creating a LLM-as-a-Judge That Drives Business Results](https://hamel.dev/blog/posts/llm-judge/):讲为什么用是和否而不是打分、为什么要先让领域专家判一遍再写裁判,今天两个设计的出处,1 小时。
- [Eugene Yan · Evaluating the Effectiveness of LLM-Evaluators](https://eugeneyan.com/writing/llm-evaluators/):把各种 LLM 裁判的研究整理成一篇,看「直接打分 vs 两两比较」和「裁判的偏差」两节。
- [RAGAS 文档 · Faithfulness](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/faithfulness/):RAGAS 的忠实度是先把回答拆成一条条陈述,再逐条判能不能从资料推出,比我们「整段一次判」细,对照着看,Day 261 会用。
- [TruLens · The RAG Triad](https://www.trulens.org/getting_started/core_concepts/rag_triad/):把 RAG 评估拆成上下文相关性、忠实度、回答相关性三项,和我们的拆法对照,看看各管哪一段。
- [DeepSeek API 文档 · JSON Output](https://api-docs.deepseek.com/zh-cn/guides/json_mode):中文,今天那个 400 报错的出处,写了用 JSON 模式的几条注意事项。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1rAbp66Eyi&autoplay=0&high_quality=1" title="怎样设计LLM-as-Judge才能让评分可信" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>酌沧 · 怎样设计LLM-as-Judge才能让评分可信 · 8 分钟,讲判定标准怎么写、为什么要拆成小问题,和今天三个裁判的设计对照。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1L14y127ye&autoplay=0&high_quality=1" title="【10分钟论文】使用LLM作为裁判 Judging LLM-as-a-judge with MT-Bench and Chatbot Arena" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>ranchlai · 【10分钟论文】使用LLM作为裁判 · 11 分钟,讲 LLM 裁判最早那篇系统研究的论文,重点听位置偏差、长度偏差、自我偏好三种偏差。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/trfUBIDeI1Y" title="LLM as a Judge: Scaling AI Evaluation Strategies" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · LLM as a Judge: Scaling AI Evaluation Strategies · 英文短讲,把直接判断、两两比较、参考答案对照几种裁判方式讲清楚,开自动字幕。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/7_LTU0LA374" title="RAG Evaluation: Precision, Recall, Faithfulness, RAGAS Explained Clearly" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Logical Lenses · RAG Evaluation: Precision, Recall, Faithfulness, RAGAS Explained Clearly · 英文,把 Day 259 的检索指标和今天的忠实度放在一起讲,正好串起这两天。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 3 章「Evaluation Methodology」里「AI as a Judge」一节:裁判怎么用、有哪些局限、成本怎么算,讲得最系统的一本。

### 开源项目与代码

- [explodinggradients/ragas](https://github.com/explodinggradients/ragas):看 faithfulness 指标的源码,对照它的「先拆陈述再逐条判」和我们的「整段一次判」。
- [confident-ai/deepeval](https://github.com/confident-ai/deepeval):另一个评估框架,README 里 `FaithfulnessMetric`、`AnswerRelevancyMetric` 的示例几行代码就能跑,知道有这个东西,Day 261 比框架时会用到。
- [Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena(arXiv 2306.05685)](https://arxiv.org/abs/2306.05685):LLM 裁判的经典论文,代码在 lm-sys/FastChat 仓库的 `fastchat/llm_judge` 目录,先读论文第 3 节讲偏差的部分。

## 自测

**1. 三个裁判各看哪些材料?忠实裁判为什么不给它看问题?**

<details><summary>答案</summary>

忠实裁判看资料和回答,完整裁判看问题、要点和回答,拒答裁判看问题和回答。忠实裁判只管「说的每句话有没有依据」,给它看问题,它容易顺带去判「答没答到点子上」,两件事搅在一起;答没答到点子上归完整裁判管。

</details>

**2. 用 `response_format={"type": "json_object"}` 时 DeepSeek 返回 400,报错说 `Prompt must contain the word 'json'`,怎么修,为什么会有这条限制?**

<details><summary>答案</summary>

在提示词里写上「只输出 JSON」,最好给一个示例对象。JSON 模式只保证输出语法合法,模型要从提示词里知道你要 JSON,否则可能一直输出空白直到用完 token,厂商就在入口直接拒绝这种请求。

</details>

**3. q17 判「忠实 True、完整 False」,你怎么判断是检索的问题还是生成的问题?**

<details><summary>答案</summary>

先看明细里的 `chunks`:写着答案要点的那几块在不在模型手里。q17 的规则块 kb-002#1、kb-002#2 都不在,模型照着手上的资料答,所以忠实但不完整,锅在检索(块级)。再用实验确认:只改 k,k=8 时两块都进来,立刻判完整,说明模型会用资料。如果规则块在手里还漏答,才是生成的问题,那时候去改提示词。

</details>

**4. 为什么每道题判完要立刻追加写一行,而不是全部跑完再写文件?**

<details><summary>答案</summary>

评估要调几十次接口,中途可能断网、超时或者被限流。每题判完就追加,崩了也只丢当前这一道,前面花钱判完的都在文件里,还能接着看。全部跑完再写,中途崩了一行都没有。

</details>

**5.(面试题)你的 RAG 生成评估显示忠实率 100%、完整率 92%,产品经理问「那幻觉问题是不是解决了」,你怎么回答?**

<details><summary>答案</summary>

不能这么说。第一,忠实率是 LLM 裁判判的,裁判和被评的还是同一个模型,我只抽查了几条没发现误判,还没做过和人工标注的一致率,所以 100% 的意思是「裁判没发现编造」,不是「没有编造」。第二,样本只有 26 道有答案的题、一次运行,一道题就是 3.8 个点。第三,我们的提示词要求只按资料回答、没找到就说没找到,今天的 4 道无答案题都拒答了,但换成宽松提示词、换题、换模型,结果都可能变。下一步我会人工标一批题算裁判和人的一致率,扩大评估集,多跑几次看分布,并且换一个不同的模型当裁判复核。至于那 8% 不完整,两道题我查过都是检索没把关键块拿到,不是模型编造,修法在检索那边。

</details>

## 明天预告

Day 261 · RAG 评估(六):用评估集做实验,RAGAS 和其他框架。现在手里有两个评估脚本,一个量检索、一个量生成,今天还发现 q17 那种「文章对了、块没拿到」的问题要两个脚本一起看才看得出来。明天就拿它们做第一次正式实验:一次只改一个变量,记实验日志,看分数和失败清单怎么变;最后对照 RAGAS 这些框架,看它们的指标和我们自己写的有什么不同。
