---
title: 'Day 75 · 选模型是工程决策:闭源、开源、大小模型怎么搭'
description: '榜单第一的模型,放进你的工单流程里不一定第一。今天把选模型当成一次带数据的工程决策来做:先用硬约束砍掉一半候选,再用 SupportPilot 自己的评测集跑一场多模型对比,最后算总拥有成本,定出「哪个节点用哪个模型」的路由表。'
pubDate: 2026-10-12
regime: none
tags: ['model-selection', 'open-weight', 'routing', 'tco', 'evals', 'agent-60']
series: 'agent-60'
day: 75
lang: 'zh'
---

## 今天要解决的问题

W12 这一周换一个视角:前面 70 多天,模型对你来说是一个 `LLM_MODEL` 环境变量,换个字符串就换了模型。从今天起,模型本身变成你要设计、要选、要部署、甚至要训练的东西。资深 Agent 工程师和中级的一个明显区别,就是面对「我们该用哪个模型」这种问题时,能拿出数据和算式,而不是一句「Claude 最强」或者「DeepSeek 便宜」。

学完今天,你应该能做到:

1. 说出选模型的六个维度,并且知道哪些是硬约束(不满足直接淘汰)、哪些是可以权衡的软指标。
2. 用 SupportPilot 的评测集写一个多模型对比脚本,一次跑出每个候选的分类准确率、工具调用成功率、P95 延迟和单工单成本。
3. 说清楚 2026 年 10 月闭源 API 和开源权重模型的大致版图,知道去哪里查最新信息,而不是背一张很快过时的表。
4. 写出总拥有成本(TCO)的算式,能估算「每月多少调用量以上,换模型或自部署才划算」。
5. 给 SupportPilot 产出一张「节点 → 模型」路由表和一页选型决策记录。

预计用时 4–6 小时,其中跑对比实验 1–2 小时(取决于你接了几家 API)。前置:Day 3(多厂商切换)、Day 38 和 Day 52(成本与路由)、Day 50(评测集)。今天不需要 GPU。

## 榜单分数为什么不能直接拿来用

先讲一个很常见的翻车过程。团队看到某个新模型在公开榜单上大涨,换上去,第二天客服主管来问:「怎么最近好多工单分到 other 里去了?」查下来发现,新模型在你的 8 个分类上,对「退款还是账单争议」这种边界工单的判断习惯和旧模型不一样,而你的分类提示词是对着旧模型调出来的。

榜单测的是通用能力,你关心的是「在我的提示词、我的工具、我的数据分布上表现如何」。两者之间至少隔着三层:

第一层是任务分布。公开 benchmark 里数学、代码、常识题占大头,而 SupportPilot 每天处理的是中文客服工单,夹杂错误码、发票术语和情绪化表达。

第二层是交互方式。榜单多数是单轮问答,你的 Agent 要连续调三四次工具,中间还要读几千 token 的工具结果。一个模型单轮回答漂亮,不代表它在第四轮还记得第一轮客户说过「我是年付」。

第三层是格式纪律。Agent 系统对「输出必须是合法 JSON」「工具参数必须符合 schema」的要求比聊天高得多。有的模型能力很强但偶尔在 JSON 后面多吐一句解释,放到你的解析器里就是一次失败。

所以榜单的正确用法是缩小候选范围,决定权交给你自己的评测集。Day 50 你已经有了 `tickets_v1.jsonl`,今天它派上第二个用场。

## 六个维度:先分清硬约束和软指标

选模型时要看的东西可以归成六类。前三类经常是一票否决,后三类才是真正在打分权衡。

| 维度 | 具体看什么 | 通常是 |
| --- | --- | --- |
| 数据合规 | 数据能不能出境、能不能给第三方、是否需要私有化、模型是否完成备案 | 硬约束 |
| 部署形态 | 只能用 API、可以上云 GPU、必须内网离线 | 硬约束 |
| 上下文与模态 | 最长上下文够不够你的工具结果,要不要读图 | 硬约束 |
| 任务能力 | 在你的评测集上的分类准确率、回复质量、工具调用成功率 | 软指标 |
| 延迟 | 首 token 时间、整段输出时间、P95 | 软指标 |
| 成本 | 每张工单的钱,含缓存命中、重试、失败后回退的开销 | 软指标 |

另外还有一个经常被忽略的维度:可控性。包括能不能固定版本(模型名后面带日期,还是一个会被悄悄升级的别名)、厂商多久下线旧版本、能不能拿到 logprobs 做置信度、能不能微调。Day 79 要用 logprobs 做路由的置信度,如果你选的 API 不给 logprobs,那条路就走不通。

硬约束要最先确认,因为它们往往不由工程师决定。我见过团队花两周把三个模型比得清清楚楚,最后法务一句「客户合同里写了数据不出中国大陆」,海外 API 全部出局,两周白干。所以开工前先拿一张清单去问清楚:客户合同、行业监管、公司安全策略分别对模型有什么要求。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="选型漏斗:从候选池经过硬约束过滤、自有评测、成本延迟,最后形成路由组合">
<rect x="20" y="20" width="600" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="47" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">候选池:榜单前列 + 团队已在用 + 能私有化的开源模型(10–15 个)</text>
<rect x="70" y="84" width="500" height="44" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="320" y="111" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">硬约束过滤:合规 / 部署形态 / 上下文长度(剩 4–6 个)</text>
<rect x="120" y="148" width="400" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="175" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">自有评测集:准确率 + 工具调用成功率(剩 2–3 个)</text>
<rect x="170" y="212" width="300" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="320" y="239" font-family="var(--font-mono)" font-size="13" fill="var(--ink)" text-anchor="middle">成本 × 延迟 × 可控性</text>
<text x="320" y="285" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)" text-anchor="middle">输出不是「一个模型」,而是一张「节点 → 模型」路由表</text>
</svg>
<figcaption>选型像一个漏斗。前两层基本是查资料和问人,第三层才需要跑实验。最后的产出通常是一个组合,而不是一个赢家。</figcaption>
</figure>

## 2026 年 10 月的模型版图,以及怎么自己查

写这一节有点尴尬,因为模型更新太快,任何一张表三个月后都会过时。所以我只给你一个大致轮廓,加上一套自己查证的方法。

闭源 API 这边,国内常用的是 DeepSeek、阿里云百炼(通义千问)、Kimi、智谱等,海外是 OpenAI、Anthropic、Google。前面几周课程默认用的是 DeepSeek 的 `deepseek-flash` 和 `deepseek-v4-pro`,价格在 Day 38 和 Day 52 里算过。闭源的好处是省心:不用管 GPU、不用管扩容、模型升级厂商负责。坏处是版本不完全受你控制,数据要出你的网络。

开源权重这边,我在 2026 年 10 月 12 日用 Hugging Face 的接口查了几家主要厂商最近发布的仓库,挑几个有代表性的放在下面。参数量取自仓库的 safetensors 统计,MoE 模型的总参数远大于每个 token 实际激活的参数,激活参数要去模型卡里看:

| 仓库 | 发布日期(HF 创建) | 总参数(约) | 许可证 |
| --- | --- | --- | --- |
| `Qwen/Qwen3.8-27B-FP8` | 2026-08-13 | 27.8B | Apache-2.0 |
| `Qwen/Qwen3.6-35B-A3B` | 2026-04-15 | 36B(MoE) | Apache-2.0 |
| `deepseek-ai/DeepSeek-V4.1-Flash` | 2026-09-10 | 763B(MoE) | MIT |
| `zai-org/GLM-5.3-Flash` | 2026-08-25 | 321B(MoE) | MIT |
| `moonshotai/Kimi-K3` | 2026-06-13 | 2.78T(MoE) | 自定义许可 |
| `openai/gpt-oss-20b` | 2025-08-04 | 20.9B | Apache-2.0 |
| `Qwen/Qwen3-4B-Instruct-2507` | 2025 年 | 4.0B | Apache-2.0 |

几个读法。第一,真正能在一张 24GB 卡上跑起来的,基本是 30B 以下的稠密模型或者激活参数很小的 MoE,几百 B 的旗舰开源模型自部署要多卡甚至多机,这对大部分应用团队不现实,用它们的托管 API 更合理。第二,许可证要认真看,「自定义许可」可能对商用规模、所在地区有额外条款,上线前让法务看一眼。第三,Meta 的 Llama 系列在这张表里没出现,不是遗漏,是它在 2025 年 4 月之后没有新的主力开源发布(以我查到的 HF 仓库为准)。

想自己查,最省事的办法是用 Hugging Face 的公开接口按创建时间排序列出某个组织的模型:

```bash
# 列出某个组织最近发布的 8 个模型仓库(不需要登录)
curl -s "https://huggingface.co/api/models?author=Qwen&sort=createdAt&direction=-1&limit=8" \
  | python3 -c "import json,sys; [print(m['id'], m['createdAt'][:10]) for m in json.load(sys.stdin)]"
```

国内网络访问 Hugging Face 不稳定的话,ModelScope(魔搭)上大部分国产模型都有镜像。看能力的第三方参考,我常用的是 Artificial Analysis(能同时看质量、速度、价格)和 LMArena(人类偏好投票),工具调用专项可以看伯克利的 BFCL 榜单。这些都只用来缩小范围。

## 用自己的评测集跑一场对比

这一节是今天的核心。我们写一个 `bakeoff.py`,对每个候选模型做两件事:

一是分类。用 Day 47 的分诊提示词,让模型给 Day 50 评测集 dev 部分的每条工单输出分诊 JSON,和标准答案的 `expect.category` 比对。这件事每张工单都要做,所以它的准确率和成本最敏感。

二是工具调用。给模型几个工具定义和一条需要查账单的工单,看它能不能一次就产生参数合法的 `tool_calls`。这测的是格式纪律。

候选模型写在一个配置文件里,每个模型带上自己的 API 地址和 key 所在的环境变量名,以及价格。地址和 key 都放环境变量,配置文件可以放心提交到仓库。价格单位统一成「元/百万 token」,数字请你自己去官方页面填,下面是按 Day 52 里查到的 DeepSeek 高峰价填的示例,其他两行留空等你填:

```yaml
# agentops-lab/w12/models.yaml
candidates:
  - name: deepseek-flash
    base_url_env: DEEPSEEK_BASE_URL     # 值是 DeepSeek 文档里的 API 地址
    key_env: DEEPSEEK_API_KEY
    model: deepseek-flash
    price: {in: 2.0, cached: 0.04, out: 8.0}      # 元/百万 token,高峰价,2026-10 查
  - name: deepseek-v4-pro
    base_url_env: DEEPSEEK_BASE_URL
    key_env: DEEPSEEK_API_KEY
    model: deepseek-v4-pro
    price: {in: 9.0, cached: 0.30, out: 27.0}
  - name: qwen-bailian
    base_url_env: DASHSCOPE_BASE_URL    # 百炼 OpenAI 兼容模式的地址,见百炼文档
    key_env: DASHSCOPE_API_KEY
    model: ""            # 填你在百炼控制台看到的模型名
    price: {in: 0, cached: 0, out: 0}   # 去百炼价格页填
```

脚本本身:

```python
# agentops-lab/w12/bakeoff.py
"""多模型对比:分类准确率 + 工具调用成功率 + 延迟 + 成本。
用法:uv run python w12/bakeoff.py --dataset ../supportpilot/evals/datasets/tickets_v1.jsonl --split dev
依赖:uv add openai pyyaml
"""
import argparse
import json
import os
import statistics
import time
from pathlib import Path

import yaml
from openai import OpenAI

TRIAGE_SYSTEM = (
    "你是 CloudLedger 客服分诊员。只输出一个 JSON 对象,字段:"
    'category(billing/refund/invoice/account/technical/plan_change/api/other 之一)、'
    "needs_account_data(布尔)、needs_human(布尔)、urgency(low/normal/high)。不要输出其他文字。"
)

TOOLS = [
    {"type": "function", "function": {
        "name": "list_invoices",
        "description": "按客户邮箱列出最近的发票,返回发票号、金额、状态、日期",
        "parameters": {"type": "object", "properties": {
            "email": {"type": "string"},
            "months": {"type": "integer", "minimum": 1, "maximum": 12}},
            "required": ["email"]}}},
    {"type": "function", "function": {
        "name": "search_kb",
        "description": "在帮助中心检索文章",
        "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
]
TOOL_PROBE = "我是 li@example.com,上个月好像被扣了两次年费,帮我看看最近两个月的账单。"


def client_for(c):
    return OpenAI(base_url=os.environ[c["base_url_env"]], api_key=os.environ[c["key_env"]])


def cost_yuan(usage, price):
    cached = getattr(getattr(usage, "prompt_tokens_details", None), "cached_tokens", 0) or 0
    miss = usage.prompt_tokens - cached
    return (miss * price["in"] + cached * price["cached"] + usage.completion_tokens * price["out"]) / 1e6


def run_triage(cli, c, case):
    ticket = f"主题:{case['subject']}\n正文:{case['body']}"
    t0 = time.perf_counter()
    resp = cli.chat.completions.create(
        model=c["model"], temperature=0,
        messages=[{"role": "system", "content": TRIAGE_SYSTEM}, {"role": "user", "content": ticket}])
    latency = time.perf_counter() - t0
    text = resp.choices[0].message.content or ""
    s = text.strip()
    if s.startswith("`"):                      # 有的模型会把 JSON 包在代码块标记里
        s = s.strip("`").removeprefix("json").strip()
    try:
        got = json.loads(s)
        ok_json = True
    except json.JSONDecodeError:
        got, ok_json = {}, False
    correct = got.get("category") in case["expect"]["category"]
    return {"correct": correct, "json_ok": ok_json, "latency": latency, "cost": cost_yuan(resp.usage, c["price"])}


def run_tool_probe(cli, c, n=5):
    ok = 0
    for _ in range(n):
        resp = cli.chat.completions.create(
            model=c["model"], temperature=0, tools=TOOLS,
            messages=[{"role": "user", "content": TOOL_PROBE}])
        calls = resp.choices[0].message.tool_calls or []
        for call in calls:
            if call.function.name == "list_invoices":
                try:
                    args = json.loads(call.function.arguments)
                    if args.get("email") == "li@example.com":
                        ok += 1
                        break
                except json.JSONDecodeError:
                    pass
    return ok / n


def p95(xs):
    xs = sorted(xs)
    return xs[max(0, int(round(0.95 * len(xs))) - 1)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--split", default="dev")
    ap.add_argument("--models", default=str(Path(__file__).with_name("models.yaml")))
    args = ap.parse_args()

    cases = [json.loads(l) for l in Path(args.dataset).read_text(encoding="utf-8").splitlines() if l.strip()]
    cases = [c for c in cases if c.get("split") == args.split]
    cands = [c for c in yaml.safe_load(Path(args.models).read_text())["candidates"] if c["model"]]

    rows = []
    for c in cands:
        cli = client_for(c)
        res = [run_triage(cli, c, case) for case in cases]
        rows.append({
            "model": c["name"],
            "n": len(res),
            "acc": sum(r["correct"] for r in res) / len(res),
            "json_ok": sum(r["json_ok"] for r in res) / len(res),
            "tool_ok": run_tool_probe(cli, c),
            "lat_p50": statistics.median(r["latency"] for r in res),
            "lat_p95": p95([r["latency"] for r in res]),
            "cost_per_1k": 1000 * statistics.mean(r["cost"] for r in res),
        })
    print(f"{'model':<18}{'n':>4}{'acc':>7}{'json':>7}{'tool':>7}{'p50 s':>8}{'p95 s':>8}{'元/千次':>10}")
    for r in rows:
        print(f"{r['model']:<18}{r['n']:>4}{r['acc']:>7.2f}{r['json_ok']:>7.2f}{r['tool_ok']:>7.2f}"
              f"{r['lat_p50']:>8.2f}{r['lat_p95']:>8.2f}{r['cost_per_1k']:>10.2f}")
    Path("bakeoff_result.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
```

这里有几个刻意的设计,值得你在面试里讲。`temperature=0` 是为了让同一条用例两次跑结果尽量一致,对比时少一个变量。成本按 `usage` 里的真实 token 算,而不是按字数估,因为不同模型的 tokenizer 对中文的切分差别很大,同一段工单在两个模型里可能差出 30% 的 token。工具调用只测了 5 次,这是一个很粗的探针,真要比工具调用能力,应该拿 Day 33 的轨迹评测跑完整流程。

跑出来的结果请填进下面这张表(我没有替你跑,数字留空):

| 模型 | dev 条数 | 分类准确率 | JSON 合法率 | 工具调用成功率 | P50 延迟 | P95 延迟 | 元/千次分类 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| deepseek-flash | | | | | | | |
| deepseek-v4-pro | | | | | | | |
| 你的第三个候选 | | | | | | | |

读这张表时要克制一个冲动:看到两个模型准确率差 2 个百分点就下结论。dev 集如果只有六七十条,2 个点就是一两条工单,完全可能是噪声。Day 69 会专门讲怎么算置信区间。今天先记住一个粗略的经验:条数少于两三百条时,小于 5 个点的差距不要当真,去看具体错在哪几条,错得有没有规律。

## 不选一个,选一组:多模型路由

跑完对比你大概率会发现,没有哪个模型在所有维度上都赢。大模型准,但贵且慢;小模型便宜快,但在边界工单上会犯错。资深的做法是按节点和难度把它们组合起来。常见的路由方式有四种,复杂度依次递增:

按节点路由。最简单也最常用,Day 52 你已经做过:分类、自检这种短输出、判断型的节点用便宜模型,起草客户回复这种对质量最敏感的节点用强模型。

按风险路由。同一个节点,高风险类别走强模型。比如 SupportPilot 里 refund 和 billing 的工单涉及钱,起草时即使已经路由到便宜模型,这两类也强制走强模型。

级联(cascade)。先让便宜模型试,检查它的输出(置信度、格式、自检分数),不过关再交给强模型重做。FrugalGPT 那篇论文系统研究过这种做法。好处是大部分简单请求在第一级就解决了,坏处是失败的请求延迟变长、要付两次钱。

学出来的路由器。训练一个小分类器,预测「这条请求便宜模型能不能搞定」,RouteLLM 是这个方向的代表。Day 79 我们会做一个简化版:用小模型输出类别时的概率当置信度。

还有一种不在这四种里的分工,叫顾问模式(Advisor)。它不是在两个模型之间选一个,而是便宜模型做完全程,只在拿不准的判断点请教一次强模型,拿回几百 token 的建议接着干。Anthropic 2026 年把它做成了 beta 的 advisor tool,Pydantic AI 有跨厂商的实现,Day 38 的「另一种分工:Advisor 模式」有用 DeepSeek 两个模型跑的例子。放进选型框架里看,它改变的是成本结构:顾问模型按自己的价格计费,但只为那段短建议付钱,所以评估「强模型值不值」时,别只拿它和便宜模型整单对比,还要算「只在关键点用它」这种用法的成本和质量。它适合难度集中在少数判断点的长任务;如果难的是整张工单,按风险路由或级联更直接。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="SupportPilot 路由:分类走小模型,低置信度回退大模型,起草按风险分流">
<rect x="20" y="105" width="90" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="65" y="132" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">工单</text>
<line x1="110" y1="127" x2="150" y2="127" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="150" y="105" width="120" height="44" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="210" y="124" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">分类</text>
<text x="210" y="140" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">小模型</text>
<line x1="270" y1="127" x2="310" y2="127" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="310" y="105" width="110" height="44" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="365" y="132" font-family="var(--font-mono)" font-size="12" fill="var(--ink)" text-anchor="middle">置信度?</text>
<line x1="365" y1="105" x2="365" y2="60" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="300" y="20" width="130" height="40" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="365" y="45" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">低:大模型重分</text>
<line x1="420" y1="127" x2="460" y2="127" stroke="var(--rule)" stroke-width="1.5"/>
<rect x="460" y="70" width="160" height="40" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="540" y="95" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">refund/billing:大模型起草</text>
<rect x="460" y="145" width="160" height="40" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="540" y="170" font-family="var(--font-mono)" font-size="11" fill="var(--ink)" text-anchor="middle">其余:小模型起草</text>
<line x1="540" y1="185" x2="540" y2="210" stroke="var(--rule)" stroke-width="1.5"/>
<text x="540" y="230" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)" text-anchor="middle">自检不过 → 大模型重写</text>
</svg>
<figcaption>今天定的路由表落到 SupportPilot 上大概是这个样子。蓝色是强模型,琥珀色是便宜模型。每一个分叉条件都要有评测数据支撑。</figcaption>
</figure>

路由带来的一个副作用是测试矩阵变大了。原来一个模型跑一遍评测,现在要按路由后的真实组合跑,还要单独看「被回退的那部分请求」的质量。别只看平均分。

## 总拥有成本:算到人和机器上

API 价格只是成本的一部分。资深工程师谈成本,要能写出一个完整的算式。月度总拥有成本可以拆成这几项:

```text
月 TCO = 模型调用费 + 基础设施费 + 人力维护费 + 失败成本

模型调用费   = Σ(节点) 调用次数 × [未命中输入 × 单价 + 命中输入 × 缓存单价 + 输出 × 单价]
基础设施费   = (自部署时)GPU 小时价 × 运行小时 × 卡数 + 存储 + 带宽
人力维护费   = 维护模型服务、升级、排障的人天 × 人天成本
失败成本     = 错误率 × 每次错误的业务损失(转人工的人工成本、赔偿、客户流失)
```

最后一项最容易被忽略,但它往往决定了「便宜模型到底便不便宜」。举个只用来演示算法的例子(数字是假设,不是测量):每月 10 万张工单,便宜模型分类单次 0.004 元,强模型 0.02 元,便宜模型错误率比强模型高 3 个百分点,每次分错导致多一次转人工,一次人工处理成本按 5 元算。

```text
便宜模型:100,000 × 0.004 = 400 元调用费,多出的错误 3,000 次 × 5 元 = 15,000 元
强模型:  100,000 × 0.020 = 2,000 元调用费
```

在这组假设下,看起来省钱的便宜模型每月反而多花一万多。当然反过来,如果分错只是让工单多在自检环节被纠正一次,失败成本接近零,便宜模型就赢。所以「失败的代价」要和业务方一起估,不是工程师拍脑袋。

自部署的账留到明天细算,今天先记住结论的形状:自部署的成本基本是固定的(卡租了就在计费),API 的成本随调用量线性涨,两条线有一个交点。调用量远低于交点时用 API,远高于交点、又有合规需求时才认真考虑自部署。

## 动手练习

今天的产出物是一份选型决策记录,加上一次真实的多模型对比数据。

1. 硬约束清单。给 SupportPilot 写一页「模型硬约束」:数据能不能出境、能不能用海外 API、需不需要私有化、最长上下文要多少(去 Langfuse 里找你见过的最长一次调用的输入 token 数,乘以 1.5 作为余量)。
2. 接入至少三个候选。三个里至少有一个是不同厂商的,建议 deepseek-flash、deepseek-v4-pro,再加一个百炼上的千问或 Kimi。把价格填进 `models.yaml`,注明查价日期。
3. 跑 `bakeoff.py`,把结果填进上面的表格。再挑每个模型分错的工单各 5 条,看错误有没有共同点。
4. 写路由表。格式如下,每一行写一句理由,理由要引用你表格里的数字:

```text
节点        默认模型          例外规则                               理由
classify    deepseek-flash   低置信度回退 v4-pro                    flash 分类准确率 __,与 pro 差 __
self_check  deepseek-flash   —                                      ...
draft       deepseek-flash   refund / billing 强制 v4-pro          ...
```

5. 算一次 TCO。用你 Day 52 账本里的真实月调用量(没有就按每天 3,000 张工单估),算出当前路由和「全部用强模型」两种方案的月调用费,再写一段话估计失败成本。

验收标准:`bakeoff_result.json` 里至少有三个模型的完整数据;路由表每一行都能引用一个具体数字;TCO 里有一条你和「业务方」(可以是你自己扮演)对过的失败成本假设,并写明它是假设。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 开源权重(open-weight) | 模型参数可以下载自己部署,但训练数据和训练代码不一定开源,所以更准确的叫法是开放权重 |
| MoE(混合专家) | 模型由很多「专家」子网络组成,每个 token 只激活其中一部分,所以总参数很大但单次计算量小 |
| 激活参数 | MoE 模型处理一个 token 时实际参与计算的参数量,决定推理速度;总参数决定显存占用 |
| 硬约束 | 不满足就直接淘汰的条件,比如数据不能出境 |
| 级联(cascade) | 先用便宜模型处理,不达标再交给贵模型的路由方式 |
| TCO | 总拥有成本,包含调用费、基础设施、人力维护和失败造成的损失 |
| 模型别名 | 像 `deepseek-flash` 这种不带日期的名字,背后的具体版本可能被厂商更新 |
| logprobs | 模型对每个输出 token 给出的对数概率,可以用来估计置信度 |
| 顾问模式(Advisor) | 便宜模型执行全程、只在关键判断点请教强模型一次的组合方式 |

## 常见误区

**看榜单选模型。** 榜单只能帮你缩小候选范围。真正决定的是你的评测集,而且要在你自己的提示词下测,别人的提示词调出来的分数对你没有意义。

**只比准确率。** Agent 系统里 JSON 合法率和工具调用成功率经常比准确率更早成为瓶颈。一个准确率高 2 个点、但每 50 次有 1 次 JSON 坏掉的模型,线上体验可能更差。

**用小样本的差距下结论。** 70 条用例上 2 个点的差距就是一两条工单。先看错在哪,再看统计显著性(Day 69 会讲)。

**以为换模型只是改一个字符串。** 换模型通常意味着要重调提示词、重跑全部评测、重新确认缓存命中率,还要看新模型的 tokenizer 让你的 token 数变了多少。按两到三天的工作量估,而不是十分钟。

**把别名当成固定版本。** 厂商可能在你不知情时更新别名背后的模型。生产环境要尽量用带日期的版本号,或者至少在每次评测报告里记下当时的模型标识和日期,出问题时能对上。

## 学习资料

### 文档与文章

- [Anthropic · Choosing a model](https://docs.claude.com/en/docs/about-claude/models/choosing-a-model):官方给了两种起步方式:效率优先(先用小模型,不够再升级)和能力优先(先用最强模型跑通,再往便宜模型优化),后面还有「组合多个模型」一节,和今天的路由思路一致,10 分钟。
- [OpenAI · Model selection](https://developers.openai.com/api/docs/guides/model-selection):OpenAI 的选型指南,讲怎么在准确率、延迟、成本三者之间权衡,和 Anthropic 那篇对照着读,15 分钟。
- [FrugalGPT 论文](https://arxiv.org/abs/2305.05176):系统研究级联和组合多个 LLM 降成本,读摘要和第 3 节的级联部分,30 分钟。
- [RouteLLM 论文](https://arxiv.org/abs/2406.18665)和 [LMSYS 博客介绍](https://lmsys.org/blog/2024-07-01-routellm/):用偏好数据训练路由器,先读博客,Day 79 前再回来看论文。
- [Anthropic · Advisor tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool):看「执行模型和顾问模型的兼容表」和计费那一节,理解「强模型只在关键点用」的成本结构。15 分钟。
- [Artificial Analysis](https://artificialanalysis.ai/):同时看质量、速度、价格的第三方对比,用来缩小候选范围。
- [LMArena](https://lmarena.ai/) 和 [BFCL 函数调用榜单](https://gorilla.cs.berkeley.edu/leaderboard.html):前者是人类偏好投票,后者专测工具调用,后者对 Agent 更有参考价值。
- [阿里云百炼模型列表](https://help.aliyun.com/zh/model-studio/models):国内另一大 API 供应方的模型和价格入口,填 `models.yaml` 时用。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1emKb6sE93&autoplay=0&high_quality=1" title="2026本地大模型横评:13款开源模型,4000元丐版硬件本地部署实战!Qwen3.6、Gemma 4、Ornith 1.0 全部上场!" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>碳基生物退役指南 · 2026本地大模型横评:13款开源模型,4000元丐版硬件本地部署实战 · 19 分钟,2026 年 7 月。看他怎么设计测试题、怎么记录速度和显存,方法比结论更值得学,结论放到你的任务上不一定成立。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1L6Hy6gEGb&autoplay=0&high_quality=1" title="小模型评测:9 款 4B 以下开源模型本地实测,中文写作 / 代码 / 推理全跑一遍" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>小施院长 · 小模型评测:9 款 4B 以下开源模型本地实测 · 4 分钟,2026 年 10 月。Day 79 要选一个小模型做路由,这里先对 4B 以下这一档有个印象。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/pYax2rupKEY" title="How to Choose Large Language Models: A Developer's Guide to LLMs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>IBM Technology · How to Choose Large Language Models: A Developer's Guide to LLMs · 十分钟左右,讲用自己的数据评测、开源和闭源的取舍,适合当今天的开场。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/EWvNQjAaOHw" title="How I use LLMs" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Andrej Karpathy · How I use LLMs · 两个多小时,今天只看前半段他怎么在不同模型、不同档位之间切换,体会「按任务选模型」的习惯。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025):第 4 章 Evaluate AI Systems 里「Model Selection」一节,讲选型流程和公开榜单的局限,1 小时。中文版我没有查证到,以英文原版为准。

### 开源项目与代码

- [lm-sys/RouteLLM](https://github.com/lm-sys/RouteLLM):路由器的参考实现,今天只看 README 里的几种路由器类型,知道有这条路。
- [Qwen3 技术报告](https://arxiv.org/abs/2505.09388):想了解一个开源模型家族怎么从 0.6B 排到几百 B、各尺寸怎么定位,读第 1、2 节就够。

## 自测

1. 列出选模型的六个维度,并说明哪三个通常是硬约束,为什么要先确认它们。

<details><summary>答案</summary>

数据合规、部署形态、上下文与模态通常是硬约束;任务能力、延迟、成本是软指标,另外还要看可控性(版本固定、logprobs、能否微调)。硬约束要先确认,因为它们往往由合同、监管和安全策略决定,不满足就一票否决,先比能力再发现被法务否掉,前面的实验全部白做。

</details>

2. 两个模型在 70 条 dev 用例上的分类准确率是 0.86 和 0.84,你会怎么解读?

<details><summary>答案</summary>

差距是 2 个百分点,也就是一两条工单,样本量这么小时完全可能是噪声,不能说前者更好。应该先看两边各自错了哪些工单、错误有没有规律(比如都集中在 refund 和 billing 的边界),再考虑扩大样本或者做配对比较、算置信区间。

</details>

3. 为什么 `bakeoff.py` 用 `usage` 里的 token 数算成本,而不是用工单字数乘一个系数?

<details><summary>答案</summary>

不同模型的 tokenizer 对中文的切分不一样,同一段文字在不同模型里的 token 数可能差很多;缓存命中的 token 价格也不同。只有用每次调用返回的真实 usage(含 cached_tokens)才能算准。

</details>

4. 用文中的算式解释:为什么「便宜模型」在某些业务里反而更贵?

<details><summary>答案</summary>

TCO 里除了调用费还有失败成本。如果便宜模型错误率更高,而每次错误都会导致一次转人工(或者更严重的业务损失),错误数 × 单次损失可能远大于省下的调用费。所以要和业务方一起估「失败的代价」,再决定路由。

</details>

5. (资深面试题)你们团队现在全量用一个强闭源模型,老板想把成本降一半,让你出方案。你会怎么做,怎么证明方案没有把质量搞坏?

<details><summary>答案</summary>

先用账本和 trace 把成本拆到节点,找出花钱最多的环节(通常是长输入的起草节点和每单都要跑的分类)。然后确认硬约束(能否用别家 API、能否自部署),在自有评测集上跑多模型对比,得到每个节点上候选模型的准确率、JSON/工具调用成功率、延迟和成本。方案通常是组合拳:稳定前缀吃缓存、按节点路由、高风险类别保留强模型、低置信度级联回退。证明质量的方式是同一个评测集上新旧方案的配对比较,加上关键指标的护栏(分类准确率、转人工率、退款类工单的人工审批通过率),上线时先灰度一小部分流量做 A/B,对比线上的转人工率和客户重问率。最后要说清楚取舍:哪些类别为了质量没有降本,预计节省多少,数据来自哪张表。

</details>

6. 你选的 API 不返回 logprobs,对后面的路由设计有什么影响?有什么替代办法?

<details><summary>答案</summary>

没法用「类别概率」直接当置信度做级联回退。替代办法有:让模型同时输出一个自评的置信度字段(不太可靠,需要校准);对同一条输入采样多次看结果是否一致(自一致性,成本翻倍);或者训练一个独立的小分类器/路由器;再或者换成能返回 logprobs 的模型或自部署模型(vLLM 支持返回 logprobs)。

</details>

7. 你在做选型对比时,发现强模型整单使用比便宜模型贵 6 倍,质量只高 4 个点。还有什么组合方式值得测,怎么测?

<details><summary>答案</summary>

除了按节点、按风险路由和级联,还可以测顾问模式:便宜模型执行,只在规则冲突、是否升级这类判断点请教强模型。测法是同一评测集上跑三组(全便宜、全强、顾问模式),比较质量、单均成本(顾问用量要单独加上)和 P95 延迟;再单独统计执行模型「该问没问」的比例,如果很高就在提示词里写明必须请教的情形后重测。

</details>

## 明天预告

Day 76 · 自部署推理:vLLM / SGLang 上线一个开源模型。今天的 TCO 算式里,自部署那一项还是空的。明天在 Colab 或一张租来的 GPU 上用 vLLM 把 Qwen3 跑起来,接成 OpenAI 兼容接口让 SupportPilot 直接调用,再用压测工具量出它的吞吐和延迟,把成本拐点算清楚。
