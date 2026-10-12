---
title: 'Day 30 · 错误分析:读 100 条 trace,给失败分类'
description: '评测的第一步不是写评分器,而是看数据。今天批量生成 100 张工单跑一遍 W4 的 Agent,用一个几十行的 Streamlit 小工具逐条读 trace、写失败笔记,再把笔记归成几类、计数、排优先级,最后决定哪些问题直接修、哪些问题值得写成评测。'
pubDate: 2026-10-12
regime: none
tags: ['eval', 'error-analysis', 'streamlit', 'agent-60']
series: 'agent-60'
day: 30
lang: 'zh'
---

## 今天要解决的问题

昨天你跑了 10 条冒烟用例,看到了一两条失败。那 10 条是你自己想出来的。问题在于,你想得到的情况,往往不是 Agent 真正会出错的情况。

举个具体的。你可能担心 Agent 分不清 `refund` 和 `billing`,于是写了好几条这种用例。可真跑一百张工单下来,你会发现最多的问题是别的东西:比如客户在一张工单里同时问了两件事,Agent 只回了第一件;或者 Agent 查到了发票,却在回复里把发票号念错了一位;或者它对着一个只是来抱怨的客户,主动推荐了升级套餐。这些你坐在那里想,很难想到。

所以评测的第一步是读数据,不是写评分器。这一步叫错误分析(error analysis)。今天结束时你应该能:

1. 批量生成 100 张多样的工单,跑完 Agent,把 trace 存下来。
2. 用一个 Streamlit 小工具逐条读 trace,标 pass/fail 并写一句失败笔记。
3. 把零散的笔记归成 4–8 个失败类别,数出每类有多少条。
4. 按「频率 × 严重程度 × 修复成本」给类别排优先级。
5. 判断每类问题是「直接修」还是「写成评测再修」。

预计用时 5–6 小时,读 trace 本身就要两三个小时,这是正常的。前置:Day 29 的 `adapter.py` 和 `run_eval.py`。

## 为什么不能跳过这一步

Hamel Husain 在他的文章和课程里反复说一句话,大意是:很多团队的评测失败,都是因为一开始就选了通用指标(什么「有用性」「相关性」打分),然后盯着仪表盘看分数涨跌,却从来没有认真读过自己系统的输出。

通用指标的问题是它和你的产品没关系。「有用性 4.2 分」告诉不了你该改哪里。而读完一百条 trace 之后,你会得到这样的结论:「29% 的失败是多问题工单只回答了第一个;18% 是查到了数据但在回复里转述错了;12% 是该转人工的没转。」这种结论直接告诉你下一步干什么。

我自己第一次认真做错误分析时最大的感受是:**我以为的问题和实际的问题,重合度大概只有一半。** 做之前我准备花一周优化检索,做完发现检索导致的失败只占一成多,大头在回复的生成环节。如果没读那一百条,我那一周就白干了。

还有一点,这件事没法外包给大模型,至少第一遍不行。原因是「什么算失败」本身是产品决策。客户问「能不能便宜点」,Agent 回复「目前没有优惠」,这算不算失败?如果你们公司规定客服可以给老客户发 9 折券,那就算。这种标准只有懂业务的人才能定。Hamel 把这个角色叫「仁慈的独裁者」(benevolent dictator):团队里指定一个最懂业务的人做最终裁决,而不是开会投票。在我们这门课里,这个人就是你。

## 整个流程长什么样

<figure>
<svg viewBox="0 0 640 210" role="img" aria-label="错误分析流程:生成数据、开放式标注、归类、计数排序、转化为行动">
<rect x="0" y="0" width="640" height="210" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<rect x="14" y="40" width="104" height="56" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="66" y="64" fill="var(--ink)" text-anchor="middle">① 生成并跑</text>
<text x="66" y="82" fill="var(--ink-soft)" text-anchor="middle" font-size="11">100 张工单</text>
<rect x="138" y="40" width="104" height="56" rx="5" fill="none" stroke="var(--compute)"/>
<text x="190" y="64" fill="var(--ink)" text-anchor="middle">② 开放式标注</text>
<text x="190" y="82" fill="var(--ink-soft)" text-anchor="middle" font-size="11">pass/fail+一句话</text>
<rect x="262" y="40" width="104" height="56" rx="5" fill="none" stroke="var(--compute)"/>
<text x="314" y="64" fill="var(--ink)" text-anchor="middle">③ 归类</text>
<text x="314" y="82" fill="var(--ink-soft)" text-anchor="middle" font-size="11">笔记 → 4–8 类</text>
<rect x="386" y="40" width="104" height="56" rx="5" fill="none" stroke="var(--rule)"/>
<text x="438" y="64" fill="var(--ink)" text-anchor="middle">④ 计数排序</text>
<text x="438" y="82" fill="var(--ink-soft)" text-anchor="middle" font-size="11">频率×严重</text>
<rect x="510" y="40" width="116" height="56" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="568" y="64" fill="var(--ink)" text-anchor="middle">⑤ 行动</text>
<text x="568" y="82" fill="var(--ink-soft)" text-anchor="middle" font-size="11">直接修/写评测</text>
<line x1="118" y1="68" x2="138" y2="68" stroke="var(--ink-faint)" marker-end="url(#a30)"/>
<line x1="242" y1="68" x2="262" y2="68" stroke="var(--ink-faint)" marker-end="url(#a30)"/>
<line x1="366" y1="68" x2="386" y2="68" stroke="var(--ink-faint)" marker-end="url(#a30)"/>
<line x1="490" y1="68" x2="510" y2="68" stroke="var(--ink-faint)" marker-end="url(#a30)"/>
<path d="M314 96 Q314 150 190 150 Q170 150 190 100" fill="none" stroke="var(--ink-faint)" stroke-dasharray="4 3" marker-end="url(#a30)"/>
<text x="200" y="172" fill="var(--ink-soft)" font-size="11">归类时发现笔记写得太含糊,回去补</text>
<text x="20" y="196" fill="var(--ink-faint)" font-size="11">蓝色 = 机器做,琥珀 = 你亲自做,灰色 = 一半一半</text>
<defs><marker id="a30" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--ink-faint)"/></marker></defs>
</g>
</svg>
<figcaption>错误分析五步。第 ② ③ 步必须你亲自做,大模型可以帮忙整理,但不能替你判断什么算失败。</figcaption>
</figure>

第 ② 步和第 ③ 步的名字来自社会学里做质性研究的方法,叫扎根理论(grounded theory)。Hamel 和 Shreya 把它搬到了 AI 评测里:

- 开放式编码(open coding):读每条 trace,不预设分类,用自己的话写下看到的问题。比如「客户问了退款和发票两件事,只回了退款」。
- 轴向编码(axial coding):把一堆开放式笔记放在一起看,找出相似的,归成类别。比如上面那条和另外几条归为「多问题工单只处理了一部分」。

为什么不一开始就定好分类再去套?因为预设分类会让你只看见你预设的东西。先开放式写,再归类,类别是从数据里长出来的。

## 第一遍标注的几条规矩

这几条都是我自己踩过坑之后才信的。

只标 pass 或 fail,不打 1–5 分。 打分看起来更精细,实际上「3 分和 4 分有什么区别」你自己都说不清,一百条标下来前后标准还会漂移。二元判断逼你想清楚「这条到底能不能发给客户」。想表达程度,写在笔记里。

笔记写第一个出错的地方。 Agent 的错误经常是连锁的:分类错了,所以检索了错误的文章,所以回复也错了。这时候只记最上游那个:「分类错,把重复扣款分成了 refund」。下游的错误是它的后果,修好上游它们自然消失。如果三个都记,计数时会把同一个问题算三次。

笔记要具体到能复现。 「回复不太好」等于没写。「回复里说年付可以全额退,退款政策写的是按剩余整月退」才是有用的笔记。具体到下次看到同类问题时,你能一眼认出来。

不要边标边修。 读到第 12 条,发现一个明显的 prompt 问题,很想马上去改。忍住,记下来,继续读。边读边修,你后面读的 trace 就是旧版本的了,统计也乱了。全部标完再统一决定。

读到不再有新东西为止。 100 条是一个经验数。更准确的说法是读到饱和:如果连续二三十条都没出现新类型的失败,就可以停了。反过来,如果到第 100 条还在不断冒出新问题,说明系统问题很多或者工单类型很杂,继续读。

## 动手练习

### 第 1 步:生成 100 张工单

正式的测试集构造是明天的内容。今天只需要一批「足够杂」的工单,让 Agent 跑出各种状况。我们用一个简单的办法:定几个维度,随机组合,让大模型按组合写工单。

```python
# agent-60-lab/w5/gen_tickets.py
"""快速生成一批多样的工单,用于错误分析。明天会讲更正式的做法。
用法: uv run python -m w5.gen_tickets 100 > w5/cases/explore_100.jsonl"""
from __future__ import annotations

import json
import os
import random
import sys

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]

TOPICS = ["退款", "重复扣款", "自动续费", "发票开具", "发票抬头修改", "银行流水导入报错",
          "支付失败", "团队成员权限", "两步验证", "注销账号", "导出报表", "升级降级套餐",
          "优惠码", "多币种", "开放 API 限流", "数据安全"]
PERSONAS = ["着急的个体户", "礼貌的企业财务", "第一次用的新用户", "生气的老客户",
            "表达不清的老年用户", "技术背景的开发者"]
SHAPES = ["一句话很短", "一段话讲来龙去脉", "同时问两件事", "带错误码或订单号",
          "情绪化有抱怨", "问题其实知识库里没有答案"]
CUSTOMERS = [f"C{n:03d}" for n in range(1, 31)]  # Day 23 种子库里的 30 个客户


def one(i: int, rng: random.Random) -> dict:
    topic, persona, shape = rng.choice(TOPICS), rng.choice(PERSONAS), rng.choice(SHAPES)
    prompt = (f"你在给一家叫云簿 CloudLedger 的在线记账 SaaS 写客服工单。\n"
              f"主题:{topic}\n客户类型:{persona}\n写法:{shape}\n"
              "只输出工单正文,不要标题、不要引号、不要解释。像真人在网页客服框里打字。")
    resp = client.chat.completions.create(
        model=MODEL, temperature=1.0,
        messages=[{"role": "user", "content": prompt}])
    return {"id": f"explore-{i:03d}", "ticket": resp.choices[0].message.content.strip(),
            "customer_id": rng.choice(CUSTOMERS),
            "dims": {"topic": topic, "persona": persona, "shape": shape}}


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 100
    rng = random.Random(42)
    for i in range(1, n + 1):
        print(json.dumps(one(i, rng), ensure_ascii=False), flush=True)
```

`dims` 字段记下这张工单是按哪个组合生成的。归类之后你可以回头看:某类失败是不是集中在「同时问两件事」这个写法上?这个信息很值钱。

100 次调用,每次输入一百多 token、输出一两百 token,总共几万 token,花费可以忽略。生成完先肉眼扫一遍,删掉明显不像人话的(比如模型自己加了「工单标题:」),不用追求完美。

### 第 2 步:批量跑,存 trace

```python
# agent-60-lab/w5/batch_run.py
"""用法: uv run python -m w5.batch_run w5/cases/explore_100.jsonl w5/traces/explore-v1.jsonl"""
from __future__ import annotations

import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv

from w5.adapter import run_case

load_dotenv()


def work(case: dict) -> dict:
    run = run_case(case["id"], case["ticket"], case.get("customer_id"))
    return {"case": case, "run": run.to_dict()}


if __name__ == "__main__":
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    cases = [json.loads(l) for l in src.read_text(encoding="utf-8").splitlines() if l.strip()]
    dst.parent.mkdir(parents=True, exist_ok=True)
    # 并发 4 个就够了,太多容易撞厂商的限流(429)
    with ThreadPoolExecutor(max_workers=4) as pool, dst.open("w", encoding="utf-8") as f:
        for i, row in enumerate(pool.map(work, cases), 1):
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            print(f"{i}/{len(cases)} {row['case']['id']} err={row['run']['error']}")
```

这里有个坑。昨天的 adapter 是用环境变量 `CLOUDLEDGER_DB` 告诉 W4 用哪个数据库的,而环境变量是整个进程共享的,多线程并发时,线程 A 刚设好自己的路径,线程 B 就把它改掉了。所以:

- 如果你的 W4 在 `build_graph()` 时就把数据库路径读进去(比如存在闭包或工具对象里),并发是安全的,因为每次 `run_case` 都会新建一个 graph。
- 如果 W4 是每次工具调用时才去读环境变量,并发就会串库。这时把 `max_workers` 改成 1,串行跑。100 条 × 6 秒,10 分钟,喝杯茶的工夫。

不确定的话就用 1。错误分析不着急,数据干净比快重要。Day 35 会讲怎么彻底解决这个问题(给 `build_graph` 传参,而不是靠环境变量)。

### 第 3 步:标注小工具

你当然可以直接在编辑器里打开 JSONL 读。但一条 trace 里有工单、分类、五六次工具调用、回复,挤在一行 JSON 里很难看。花 20 分钟写一个标注界面,接下来几个小时会轻松很多。Hamel 也一直建议团队自己做一个专门的数据查看工具,哪怕很简陋。

```python
# agent-60-lab/w5/label_app.py
"""用法: uv run streamlit run w5/label_app.py -- w5/traces/explore-v1.jsonl"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import streamlit as st

TRACES = Path(sys.argv[1])
LABELS = TRACES.with_suffix(".labels.jsonl")

rows = [json.loads(l) for l in TRACES.read_text(encoding="utf-8").splitlines() if l.strip()]
labels: dict[str, dict] = {}
if LABELS.exists():
    for l in LABELS.read_text(encoding="utf-8").splitlines():
        d = json.loads(l)
        labels[d["id"]] = d

if "i" not in st.session_state:
    # 从第一条没标过的开始
    st.session_state.i = next((k for k, r in enumerate(rows) if r["case"]["id"] not in labels), 0)

i = st.session_state.i
case, run = rows[i]["case"], rows[i]["run"]
cid = case["id"]

st.caption(f"{i + 1} / {len(rows)} · 已标 {len(labels)} · fail {sum(1 for v in labels.values() if v['verdict'] == 'fail')}")
st.subheader(cid)
st.info(case["ticket"])
st.write(f"客户 `{case.get('customer_id')}` · 分类 `{run['category']}` · "
         f"等待审批 `{run['pending_approval']}` · {run['latency_s']}s · 维度 {case.get('dims')}")
if run["error"]:
    st.error(run["error"])

with st.expander("完整 transcript", expanded=True):
    for m in run["transcript"]:
        if m.get("tool_calls"):
            for tc in m["tool_calls"]:
                st.code(f"→ {tc['name']}({json.dumps(tc['args'], ensure_ascii=False)})", language="text")
        elif m["role"] == "tool":
            st.code(f"← {m.get('name')}: {m['content'][:800]}", language="text")
        elif m["role"] in ("ai", "human", "system"):
            st.markdown(f"**{m['role']}**: {m['content']}")

st.markdown("**最终回复**")
st.success(run["reply"] or "(空)")

old = labels.get(cid, {})
verdict = st.radio("能直接发给客户吗?", ["pass", "fail"],
                   index=0 if old.get("verdict", "pass") == "pass" else 1, horizontal=True)
note = st.text_area("失败笔记:写第一个出错的地方,具体到能复现", value=old.get("note", ""))

c1, c2, c3 = st.columns(3)
if c1.button("← 上一条") and i > 0:
    st.session_state.i -= 1
    st.rerun()
if c2.button("保存并下一条", type="primary"):
    labels[cid] = {"id": cid, "verdict": verdict, "note": note.strip()}
    LABELS.write_text("\n".join(json.dumps(v, ensure_ascii=False) for v in labels.values()),
                      encoding="utf-8")
    st.session_state.i = min(i + 1, len(rows) - 1)
    st.rerun()
if c3.button("跳过 →"):
    st.session_state.i = min(i + 1, len(rows) - 1)
    st.rerun()
```

```bash
uv add streamlit
uv run streamlit run w5/label_app.py -- w5/traces/explore-v1.jsonl
```

注意命令里的 `--`,它后面的参数才会传给你的脚本,前面的是给 streamlit 自己的。浏览器会自动打开 `localhost:8501`。

标注界面里我特意把「能直接发给客户吗?」作为问题,而不是「这条好不好」。前者逼你用真实标准判断。你想象自己是 CloudLedger 的客服主管,这条回复要是发出去,你会不会被投诉。

### 第 4 步:标注

开始读。给你一些标注时的参考,不是固定答案,你的 Agent 出的问题会不一样:

- 「C005 年付中途不用了,政策是按剩余整月退,回复却说可以全额退」
- 「客户同时问发票抬头和导出报表,只回答了发票」
- 「工单只是抱怨扣款失败,没要求退款,Agent 却调用了 create_refund_request」
- 「回复里出现了 [kb-010#2] 这种原始引用标记,客户看不懂」
- 「C002 是月付用户,回复里按年付规则解释,说可以退剩余月份」
- 「工单问的事知识库里没有,Agent 编了一个处理流程」
- 「分类成 other,其实是 bug(E1043 编码错误)」

标的时候你会发现,前 20 条最慢,因为你还在建立标准;过了 50 条会明显变快。全部标完大概两三个小时。如果中间想到了某类失败的更好描述,可以回头改之前的笔记,标注工具支持「上一条」就是为了这个。

### 第 5 步:归类和计数

全部标完后,把所有 fail 的笔记拿出来归类。条数不多的话(三四十条),手动在纸上或表格里归就行,这是最可靠的。也可以让大模型先给一个草稿,你再改。

```python
# agent-60-lab/w5/axial.py
"""用法:
  第一步 提议类别: uv run python -m w5.axial propose w5/traces/explore-v1.labels.jsonl
  第二步 你编辑 w5/taxonomy.json 后,逐条归类并计数:
         uv run python -m w5.axial assign w5/traces/explore-v1.labels.jsonl"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
TAXONOMY = Path("w5/taxonomy.json")


def ask_json(prompt: str) -> dict:
    resp = client.chat.completions.create(
        model=MODEL, temperature=0,
        response_format={"type": "json_object"},
        messages=[{"role": "user", "content": prompt}])
    return json.loads(resp.choices[0].message.content)


def load_fails(path: Path) -> list[dict]:
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    return [r for r in rows if r["verdict"] == "fail"]


def propose(fails: list[dict]) -> None:
    notes = "\n".join(f"- [{r['id']}] {r['note']}" for r in fails)
    out = ask_json(
        "下面是一个客服工单 Agent 的失败笔记。请把它们归成 4 到 8 个失败类别。"
        "类别要具体、互不重叠,名字用中文短语,每类给一句定义。"
        '输出 JSON: {"categories": [{"name": "...", "definition": "..."}]}\n\n' + notes)
    TAXONOMY.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已写入 {TAXONOMY},请人工检查、合并、改名后再运行 assign")


def assign(fails: list[dict]) -> None:
    cats = json.loads(TAXONOMY.read_text(encoding="utf-8"))["categories"]
    menu = "\n".join(f"{c['name']}: {c['definition']}" for c in cats)
    counter: Counter[str] = Counter()
    out_rows = []
    for r in fails:
        got = ask_json(f"失败类别:\n{menu}\n其他: 都不符合\n\n"
                       f"笔记: {r['note']}\n"
                       '这条笔记属于哪一类?输出 JSON: {"category": "类别名"}')
        cat = got.get("category", "其他")
        counter[cat] += 1
        out_rows.append({**r, "category": cat})
    Path("w5/fails_categorized.jsonl").write_text(
        "\n".join(json.dumps(x, ensure_ascii=False) for x in out_rows), encoding="utf-8")
    total = sum(counter.values())
    print(f"{'类别':<24}{'条数':>6}{'占比':>8}")
    for cat, n in counter.most_common():
        print(f"{cat:<24}{n:>6}{n / total:>8.0%}")


if __name__ == "__main__":
    cmd, path = sys.argv[1], Path(sys.argv[2])
    fails = load_fails(path)
    {"propose": propose, "assign": assign}[cmd](fails)
```

`propose` 只是起草。拿到 `taxonomy.json` 后,一定要自己读一遍:有没有两类其实是一回事?有没有一类太宽(比如「回复质量差」),应该拆开?模型给的类别名常常很抽象,改成你一看就知道指什么的说法。`assign` 跑完后,打开 `fails_categorized.jsonl` 抽查十条,看归得对不对。归错多的话,说明类别定义不够清楚,改定义再跑。

最后得到一张表,大致像这样(**示例数据**,你的会完全不同):

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="示例:失败类别计数的水平条形图">
<rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="12">
<text x="20" y="24" fill="var(--ink-faint)" font-size="11">示例数据 · 100 条中 34 条 fail</text>
<text x="20" y="54" fill="var(--ink)">多问题只答一半</text>
<rect x="200" y="42" width="200" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="410" y="55" fill="var(--ink-soft)">10 · 29%</text>
<text x="20" y="84" fill="var(--ink)">转述数据出错</text>
<rect x="200" y="72" width="120" height="16" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="330" y="85" fill="var(--ink-soft)">6 · 18%</text>
<text x="20" y="114" fill="var(--ink)">退款规则用错</text>
<rect x="200" y="102" width="100" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="310" y="115" fill="var(--ink-soft)">5 · 15%  ← 严重</text>
<text x="20" y="144" fill="var(--ink)">该转人工没转</text>
<rect x="200" y="132" width="80" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="290" y="145" fill="var(--ink-soft)">4 · 12%  ← 严重</text>
<text x="20" y="174" fill="var(--ink)">分类错误</text>
<rect x="200" y="162" width="80" height="16" fill="none" stroke="var(--rule)"/>
<text x="290" y="175" fill="var(--ink-soft)">4 · 12%</text>
<text x="20" y="204" fill="var(--ink)">引用标记外露</text>
<rect x="200" y="192" width="60" height="16" fill="none" stroke="var(--rule)"/>
<text x="270" y="205" fill="var(--ink-soft)">3 · 9%</text>
<text x="20" y="234" fill="var(--ink)">知识库没有却编造</text>
<rect x="200" y="222" width="40" height="16" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="250" y="235" fill="var(--ink-soft)">2 · 6%  ← 严重</text>
</g>
</svg>
<figcaption>示例:归类之后的计数。蓝色标的是严重类别(会造成钱或信任上的损失),它们哪怕条数少,优先级也可能排在前面。</figcaption>
</figure>

### 第 6 步:排优先级,决定怎么处理

拿到这张表,别直接从第一行开始修。每一类问自己三个问题:

1. 频率:占失败的百分之多少?
2. 严重程度:发出去会怎样?说错退款期限,可能直接造成资损和投诉;引用标记外露,只是难看。
3. 修复成本:改一句 prompt 就好,还是要改工作流结构?

然后对每一类做一个关键判断,这是 Hamel 和 Shreya 课程里我觉得最有用的区分:

规格问题(specification failure):你根本没告诉它。 比如引用标记外露,很可能是因为你的起草 prompt 里从来没说过「引用标记只给内部看,回复客户时改写成文章标题」。这种问题直接改 prompt 就行,改完看一眼就知道好没好,**不值得专门写评测**。很多人把这类问题也写成 LLM 评分器,纯属浪费。

泛化问题(generalization failure):你说清楚了,它还是做不好。 比如 prompt 里明明写了「多个问题要逐一回答」,但工单写得绕一点它还是会漏。这种问题改一次 prompt 不能保证解决,需要一个评测来持续盯着:先写评测,确认它能抓到这个问题(当前版本是红的),然后再修,修到绿。

拿示例数据来说,我会这样排:

| 类别 | 判断 | 处理 |
| --- | --- | --- |
| 退款规则用错 | 泛化问题,严重 | 写评测:L1 用库里的订阅数据算出该退多少,和退款申请金额比对 + L2 对照退款政策判断回复 |
| 该转人工没转 | 一半规格一半泛化 | 先在 prompt 里写清转人工的条件,再写 L1 断言盯着 |
| 多问题只答一半 | 泛化问题,最多 | 写评测:L2 评分器判断是否回答了所有问题 |
| 转述数据出错 | 泛化问题 | 写评测:L1 检查回复中的发票号、金额是否出现在工具返回里 |
| 分类错误 | 已有 L1 | 把失败的那 4 条加进测试集 |
| 引用标记外露 | 规格问题 | 直接改 prompt,不写评测(顶多一个正则断言) |
| 知识库没有却编造 | 泛化问题,严重 | 写评测:L2 判断回复是否有依据 |

这张表就是你接下来几天的工作清单。明天把这些变成测试集,后天写 L2 评分器。

### 验收标准

- `w5/traces/explore-v1.jsonl` 有 100 条 trace,`explore-v1.labels.jsonl` 有 100 条标注(或者你读到饱和停下的数量,但不少于 60)。
- 每条 fail 都有一句具体到能复现的笔记。
- `w5/taxonomy.json` 是你人工改过的版本,4–8 类。
- 有一张计数表,和一张像上面那样的「判断 + 处理」表,存进 `w5/notes.md`。
- 至少有一类被你判断为「规格问题」并已经直接改掉了 W4 的 prompt。改完重跑那几条,确认它们变成 pass。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 错误分析 error analysis | 系统地阅读系统输出、标注并归类失败,找出最主要的问题 |
| trace | 一次运行的完整记录,本课里和 transcript 混用 |
| 开放式编码 open coding | 不预设类别,读一条写一条自己的观察 |
| 轴向编码 axial coding | 把开放式笔记归并成类别 |
| 理论饱和 theoretical saturation | 继续读也不再出现新类型问题的状态,是停止标注的信号 |
| 仁慈的独裁者 benevolent dictator | 团队里拍板「什么算失败」的那个懂业务的人 |
| 上游错误 first upstream failure | 一串连锁错误里最早出现的那个 |
| 规格问题 specification failure | 因为指令没写清楚导致的失败,改 prompt 即可 |
| 泛化问题 generalization failure | 指令写清楚了仍然做不好,需要评测持续盯 |
| 失败分类 failure taxonomy | 归类后得到的类别清单及其定义 |

## 常见误区

**让大模型替你做第一遍标注。** 大模型可以帮你整理笔记、起草类别,但「这条算不算失败」必须你自己判断。它不知道你们公司的退款底线,也不知道哪种语气会被客户投诉。第一遍你亲自读,后面有了标注数据,才能训练和校准一个 LLM 评分器(Day 32)。

**一开始就拿通用指标打分。** 「有用性」「相关性」「流畅度」这类指标,在错误分析之前就上,只会给你一堆和产品无关的数字。指标应该从你的失败类别里长出来,比如「是否回答了工单中的所有问题」。

**每条失败都想写评测。** 规格问题直接修,修完看一眼就行。评测有维护成本,尤其是 L2 评分器,每个都要校准。只给泛化问题、而且是重要的泛化问题写评测。

**边读边修。** 读到一半就去改 prompt,后面读的就不是同一个版本了,计数也没意义。先读完。

**只读失败的。** pass 的也要读,而且要读得和 fail 一样认真。你经常会在 pass 里发现「其实也不太对,只是我前面标松了」。另外,pass 的样本告诉你哪些地方已经做得好,改的时候别碰坏。

**读完不留记录。** 标注数据、类别表、处理决策都要存进仓库。三周后你会想知道「当时为什么决定不管引用标记的问题」,也会想拿这批标注来校准评分器。

## 学习资料

### 文档与文章

- [Hamel Husain · A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/):错误分析、自建数据查看器、仁慈的独裁者,这几个今天的核心概念都在这篇里,40 分钟,今天必读。
- [Hamel Husain & Shreya Shankar · AI Evals FAQ](https://hamel.dev/blog/posts/evals-faq/):在页面里搜 error analysis、open coding、how many traces,看他们对「读多少条」「谁来标」的回答。
- [Shreya Shankar · AI engineering flywheel](https://www.sh-reya.com/blog/ai-engineering-flywheel/):讲「看数据、写评测、改系统」这个循环为什么转得起来,15 分钟。
- [Anthropic · Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):重读「reading transcripts」那一节,讲为什么分数可信之前必须有人读过 transcript。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1SFq8BsEMT&autoplay=0&high_quality=1" title="为什么 AI 评估是产品从业者必备的热门新技能 | Hamel Husain & Shreya Shankar" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>通用人工智障 · 为什么 AI 评估是产品从业者必备的热门新技能 | Hamel Husain &amp; Shreya Shankar · 约 1 小时 43 分钟,Lenny's Podcast 的中文搬运。中间有一大段两人现场演示开放式编码和轴向编码,拿一个真实产品的 trace 一条条读,今天最该看的就是这段。</figcaption>
</figure>

- 同一期节目的另一个搬运:Web3天空之城《为什么AI评估是产品构建者最热门的新技能 | Hamel Husain & Shreya Shankar [附文稿]》(BV1WPnuzPEzD),附了中文文稿,适合边看边对照。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/ZEvXvyY17Ys" title="LLM Eval Office Hours #3: The Importance Of Starting With Error Analysis" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Hamel Husain · LLM Eval Office Hours #3: The Importance Of Starting With Error Analysis · 24 分钟,专讲为什么评测要从错误分析开始,问答形式,很接地气。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/BsWxPI9UM4c" title="Why AI evals are the hottest new skill for product builders | Hamel Husain & Shreya Shankar" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Lenny's Podcast · Why AI evals are the hottest new skill for product builders | Hamel Husain &amp; Shreya Shankar · 上面 B 站搬运的原版,英文好的看这个,画质更好。</figcaption>
</figure>

- Peter Yang《AI Evaluations Clearly Explained in 50 Minutes (Real Example) | Hamel Husain》(YouTube ID `uiza7wp1KrE`):昨天看了前 20 分钟,今天把后半段看完,里面有完整的标注演示。

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly,2025)第 4 章「Evaluate AI Systems」:讲怎么为你的应用定义评估标准、设计评估流程。今天读讲评估标准的部分,约 1 小时。
- Shreya Shankar、Hamel Husain《Evals for AI Engineers》(O'Reilly,2026):书的第二部分就叫「The Analyze Phase」,专讲错误分析。能看到的话读这一部分。

### 开源项目与代码

- [streamlit/streamlit](https://github.com/streamlit/streamlit):今天标注工具用的库。只需要看文档里 `st.session_state` 和 `st.rerun` 两个概念,就足够写各种内部小工具。
- [langfuse/langfuse](https://github.com/langfuse/langfuse):Day 34 会接入,它自带标注队列(annotation queue)功能,团队协作标注时比自己写的小工具方便。今天先知道有这么个东西。

## 自测

1. 为什么错误分析要先做开放式编码,而不是先定好类别再去套?

<details><summary>答案</summary>

预设类别会让你只看见你预设的问题,而 Agent 真正的问题经常在你想不到的地方。先不带框架地写下每条观察,再从这些观察里归纳类别,类别才真实反映你系统的失败分布。

</details>

2. 一条 trace 里,Agent 把「重复扣款」分成了 refund,于是检索了退款政策,最后回复客户「可以为您办理退款」。笔记应该怎么写?为什么?

<details><summary>答案</summary>

只记最上游的错误:「分类错,把重复扣款分成了 refund」。检索错和回复错是它的后果。如果三个都记,计数时同一个根因会被算三次,让你误以为检索和生成也有很多问题。

</details>

3. 「回复里出现了 [kb-010#2] 这样的引用标记」这类问题,需要写一个 LLM 评分器来盯着吗?

<details><summary>答案</summary>

不需要。这多半是规格问题:prompt 里没说清楚引用标记不给客户看。直接改 prompt,改完看几条确认即可。顶多加一个零成本的正则断言防回退,不值得写 LLM 评分器。

</details>

4. 标到第 70 条时,连续 25 条都没出现新类型的失败,你该怎么做?

<details><summary>答案</summary>

可以停了,这说明已经接近理论饱和,再读主要是在给已有类别加计数。把剩下的时间用在归类和排优先级上更值。如果后面系统有大改动,再重新做一轮。

</details>

5. 为什么标注时只用 pass/fail,而不是 1–5 分?

<details><summary>答案</summary>

1–5 分的边界说不清,同一个人前后标准会漂移,不同人之间更难一致;二元判断逼你回答一个明确的问题:这条能不能发给客户。程度上的差别写在笔记里就行。二元标签也更方便后面拿来校准 LLM 评分器,算一致率很直接。

</details>

6. (面试题)「你们 Agent 上线后效果不好,你会怎么排查和改进?」

<details><summary>答案</summary>

先不急着改,先看数据:从线上抽一两百条 trace(如果有用户点踩或转人工的,优先抽这些,但也要抽正常的),自己或业务专家逐条读,标 pass/fail 并写下第一个出错的地方;读到饱和后把笔记归成几类,计数,结合严重程度和修复成本排优先级;对每类判断是规格问题还是泛化问题,规格问题直接改 prompt 或流程,泛化问题先写评测抓住它,再改,改完跑全量回归;最后把这批失败样本加进离线测试集,并对线上持续抽样。最好能举一个你做过的例子,说明错误分析发现的主要问题和你原来以为的不一样。

</details>

## 明天预告

Day 31 · 建测试集:黄金集、合成数据、边界用例。今天的 100 条工单是随手生成的,标注也只有 pass/fail。明天要把它变成一份正式的测试集:每条用例有明确的期望(分类、该调什么工具、不该调什么、回复必须提到什么),用「维度组合 → 自然语言」两步法批量合成,补上边界和对抗用例,并算一算测试集要多大,才能区分 85% 和 90%。
