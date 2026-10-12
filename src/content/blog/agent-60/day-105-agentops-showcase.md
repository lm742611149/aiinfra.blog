---
title: 'Day 105 · AgentOps(九):包装成资深级作品'
description: 'AgentOps 写完了,今天把它变成招聘方愿意花时间看、看完会想约你聊的东西:一条不需要 API key 和 Docker、几秒钟跑完的演示命令,一份让人三十秒看懂的 README,一组用真实数据说话的报告和 ADR,一个三分钟的演示视频,一篇只讲一个坑的技术博客,以及一份发布前的自查脚本。最后讲面试时怎么用三十秒、三分钟、十五分钟三种长度讲这个项目。'
pubDate: 2026-10-12
regime: none
tags: ['portfolio', 'readme', 'demo', 'career', 'senior', 'agent-60']
series: 'agent-60'
day: 105
lang: 'zh'
---

## 今天要解决的问题

Day 54 给 SupportPilot 做过一次包装。那是中级作品的包装:证明你能把一个 Agent 从零做出来、做完整。AgentOps 要证明的是另一件事:你能在不确定的条件下做取舍,能用数据证明取舍是对的,能把系统做成别人能用、能运维的平台。招聘方看这两类作品,关注点不一样,包装方法也不一样。

今天结束时你应该有:

1. 一条 `uv run python demo/run_demo.py`,评审在自己电脑上不需要 API key、不需要 Docker,几秒钟就能看到平台的核心行为。
2. 一份 README,让一个只给你三十秒的人知道这是什么、做到了什么程度、数字从哪来。
3. 一组 ADR 和四份报告(评测、压测、安全、成本),每个重要决定都能追溯到「当时为什么这么选」和「数据是什么」。
4. 一个发布前的自查脚本,查 README 结构、ADR 编号、断链、疑似密钥和大文件,放进 CI。
5. 一个三分钟演示视频的分镜,一篇技术博客的提纲,几条能写进简历的项目描述。
6. 三种长度的项目讲法,以及面试官最可能深挖的十个问题各自去哪找答案。

预计用时 6–8 小时,大部分时间花在写作上。前置:Day 54(SupportPilot 包装)、Day 56(简历)、Day 96–104 的全部产出。Day 106 会专门讲设计文档和 ADR 怎么写,今天只讲怎么把它们组织进作品里。

## 资深作品和中级作品,评审看的不一样

对照这门课 JD 调研里资深岗位的描述,以及常见的资深面试流程,大致是这样:看中级候选人的作品,评审想确认「他能做完」,所以会看功能是否完整、代码是否整洁、有没有测试。看资深候选人的作品,评审默认你能做完,想知道的是「他做判断的质量」,所以会去找这几样东西:

- **取舍的记录**。为什么选 pool 多租户而不是每租户一个库?为什么把级联放进网关而不是留在应用里?有没有写下考虑过、但放弃的方案?
- **用数据支撑的结论**。压测数据、评测分数、成本账,而且数据有口径、有环境说明,知道自己的数据在哪些地方不可信。
- **失败和局限**。踩过什么坑、怎么发现的、怎么修的;哪些问题现在还没解决、为什么暂时不解决。资深工程师最打动人的往往不是做成了什么,而是知道自己的系统会在哪里出问题。
- **别人能不能用**。不看文档能不能跑起来?出了事能不能查?换一个人接手需要多久?

所以资深作品的包装重点不是把功能列得更多,而是让这四样东西容易被找到。一个评审愿意给你的时间可能只有五分钟,你要让他在五分钟里碰到至少两样。

<figure>
<svg viewBox="0 0 640 250" role="img" aria-label="评审的五分钟:越往右看的人越少,每一层要让人碰到取舍、数据、局限中的至少一样">
<rect x="20" y="40" width="140" height="150" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="90" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">README 第一屏</text>
<text x="90" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">30 秒</text>
<text x="90" y="120" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">是什么</text>
<text x="90" y="138" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">关键数字 + 口径</text>
<text x="90" y="156" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">已知局限</text>
<rect x="175" y="55" width="140" height="120" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="245" y="81" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">一条演示命令</text>
<text x="245" y="103" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">1 分钟</text>
<text x="245" y="133" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">不要 key 不要 Docker</text>
<rect x="330" y="70" width="140" height="90" rx="8" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="400" y="96" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">报告</text>
<text x="400" y="118" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">2 分钟</text>
<text x="400" y="140" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">发现的问题</text>
<rect x="485" y="85" width="135" height="60" rx="8" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="552" y="111" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">ADR</text>
<text x="552" y="131" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">面试时再看</text>
<line x1="20" y1="215" x2="620" y2="215" stroke="var(--rule)" stroke-width="1.5"/>
<text x="20" y="236" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">看的人多</text>
<text x="620" y="236" text-anchor="end" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">看的人少,但看的人在认真考虑你</text>
</svg>
<figcaption>越往右,愿意看的人越少,每一层的高度大致代表还剩多少读者。第一屏就要让人碰到数字和局限,别指望评审翻到 ADR 才发现你的判断力。</figcaption>
</figure>

## 第一件事:让评审五秒钟就能跑起来

很多不错的个人项目,README 第一段是「需要先申请 OpenAI key、安装 Postgres、配置七个环境变量」。评审基本不会照做。他打开的是一个陌生人的仓库,没有理由为它花半小时配环境,更不会把自己的 API key 填进去。

AgentOps 从 Day 96 开始就坚持「单测用 SQLite 内存库和假上游,不花钱、不连网」,这个决定在今天有了第二个回报:可以做一个零依赖的演示。思路是起一个假模型服务(同时扮演 DeepSeek 和自部署的分诊小模型),再起真正的网关进程,然后按剧本发请求,把平台的核心行为一条条打印出来。

假模型服务里,分诊小模型按关键词给类别,并且返回 logprobs,这样级联路由算出来的是真实的置信度,不是写死的结果:

```python
# agentops/demo/fake_models.py
"""演示用的假模型服务:一个进程同时扮演 DeepSeek 和自部署的 triage 小模型。

triage-v1 按工单里的关键词给类别,并返回 logprobs,让级联路由有真实的置信度可算;
其他模型名一律返回一句普通回复。延迟很短,演示几十秒就能跑完。
"""
import asyncio
import json
import math
import random

from fastapi import FastAPI

app = FastAPI()
RULES = [("退款", "refund", 0.97), ("发票", "invoice", 0.96), ("报错", "bug", 0.93), ("密码", "account", 0.72)]


def _triage(text: str) -> tuple[str, float]:
    for kw, label, conf in RULES:
        if kw in text:
            return label, conf
    return "other", 0.55


@app.post("/chat/completions")
async def chat(body: dict):
    await asyncio.sleep(random.uniform(0.05, 0.15))
    text = "".join(m.get("content", "") for m in body.get("messages", []))
    model = body.get("model", "")
    choice = {"index": 0, "finish_reason": "stop", "message": {"role": "assistant"}}
    if model == "triage-v1" or "分类" in text:
        label, conf = _triage(text)
        content = json.dumps({"category": label, "needs_human": False})
        choice["message"]["content"] = content
        if body.get("logprobs"):
            tokens = ['{"', "category", '": "', label, '", "needs_human": false}']
            choice["logprobs"] = {"content": [{"token": t, "logprob": math.log(conf) if t == label else 0.0}
                                              for t in tokens]}
    else:
        choice["message"]["content"] = "好的,已经帮您查到了。"
    return {"id": "demo", "object": "chat.completion", "model": model, "choices": [choice],
            "usage": {"prompt_tokens": 320, "completion_tokens": 20}}
```

演示脚本负责造数据、起服务、按剧本发请求、打印结果,最后把两个进程关掉:

```python
# agentops/demo/run_demo.py
"""给评审看的一键演示:不需要 API key,不需要 Docker,三十秒左右跑完。

  uv run python demo/run_demo.py

起一个假模型服务和真正的网关进程,依次演示:普通路由、级联路由的五种决策、限流、成本汇总。
"""
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="agentops-demo-"))
DB = TMP / "demo.db"
POLICY = TMP / "route.yaml"
POLICY.write_text("model: triage-v1\nthreshold: 0.9\nalways_big: [refund, billing]\nshadow_mode: false\n")
ENV = {**os.environ,
       "AGENTOPS_DATABASE_URL": f"sqlite+pysqlite:///{DB}", "AGENTOPS_KEY_PEPPER": "demo-pepper",
       "AGENTOPS_DEEPSEEK_BASE_URL": "http://127.0.0.1:9311", "AGENTOPS_QWEN_BASE_URL": "http://127.0.0.1:9311",
       "AGENTOPS_VLLM_BASE_URL": "http://127.0.0.1:9311", "AGENTOPS_DEEPSEEK_API_KEY": "demo",
       "AGENTOPS_QWEN_API_KEY": "demo", "AGENTOPS_VLLM_API_KEY": "demo",
       "AGENTOPS_TRIAGE_POLICY_PATH": str(POLICY)}


def seed() -> dict[str, str]:
    sys.path.insert(0, str(ROOT / "src"))
    os.environ.update(ENV)
    from sqlalchemy import insert

    from agentops.db import init_db, make_engine, tenants
    from agentops.tenancy.keys import issue_key
    eng = make_engine(ENV["AGENTOPS_DATABASE_URL"])
    init_db(eng)
    with eng.begin() as c:
        c.execute(insert(tenants), [
            dict(id="t_cloudledger", name="云簿", tier="standard", rpm_limit=600, monthly_budget_cny=500, allowed_models=[]),
            dict(id="t_intern", name="实习生的小工具", tier="free", rpm_limit=5, monthly_budget_cny=5, allowed_models=[]),
        ])
        return {"cloudledger": issue_key(c, "t_cloudledger", "demo", ["gateway"], "demo-pepper"),
                "intern": issue_key(c, "t_intern", "demo", ["gateway"], "demo-pepper")}


def wait(url: str) -> None:
    for _ in range(60):
        try:
            httpx.get(url, timeout=1)
            return
        except httpx.HTTPError:
            time.sleep(0.5)
    raise SystemExit(f"{url} 没起来")


def main() -> None:
    keys = seed()
    procs = [
        subprocess.Popen([sys.executable, "-m", "uvicorn", "--app-dir", str(ROOT / "demo"), "fake_models:app",
                          "--port", "9311", "--log-level", "warning"], env=ENV),
        subprocess.Popen([sys.executable, "-m", "uvicorn", "agentops.main:create_app", "--factory",
                          "--port", "8311", "--log-level", "warning"], env=ENV, cwd=ROOT),
    ]
    try:
        wait("http://127.0.0.1:9311/docs")
        wait("http://127.0.0.1:8311/healthz")
        c = httpx.Client(base_url="http://127.0.0.1:8311", timeout=10)

        def ask(key, model, text, feature="demo"):
            msgs = [{"role": "user", "content": text}]
            if model == "triage":   # 和 Day 79 一样带上分诊的系统提示,大模型回退时也按 JSON 输出
                msgs.insert(0, {"role": "system", "content": "请对客服工单分类,只输出 JSON:{\"category\": ...}"})
            return c.post("/v1/chat/completions", headers={"Authorization": f"Bearer {key}", "X-AgentOps-Feature": feature},
                          json={"model": model, "messages": msgs})

        print("\n① 普通路由:租户只写 fast,背后是哪家由平台决定")
        r = ask(keys["cloudledger"], "fast", "你好")
        print(f"   {r.status_code}  provider={r.headers['X-AgentOps-Provider']}  cost=¥{r.headers['X-AgentOps-Cost-CNY']}")

        print("\n② 级联路由 triage:小模型先判,不够确定或者属于高风险类别就回退大模型")
        for text in ["发票抬头开错了,能重开吗", "登录时报错 500", "忘记密码了怎么办", "我要退款,扣了两次费",
                     "你们产品挺好用的"]:
            r = ask(keys["cloudledger"], "triage", text, "ticket.triage")
            label = json.loads(r.json()["choices"][0]["message"]["content"])["category"]
            print(f"   {text:<16} → {label:<8} 决策={r.headers['X-AgentOps-Route-Decision']}")

        print("\n③ 免费档不能用 triage,也不能刷:每分钟 5 次")
        print(f"   triage → {ask(keys['intern'], 'triage', '发票').status_code}")
        codes = [ask(keys["intern"], "fast", "hi").status_code for _ in range(8)]
        print(f"   连发 8 次 fast → {codes}")

        print("\n④ 成本:按租户和功能节点汇总(数据来自 usage 表)")
        from agentops.db import make_engine
        from agentops.obs.cost import daily_cost
        from agentops.router_model.report import summarize
        eng = make_engine(ENV["AGENTOPS_DATABASE_URL"])
        for row in daily_cost(eng, days=1):
            print(f"   {row['tenant_id']:<14} {row['feature']:<14} {row['calls']} 次  ¥{row['cost_cny']:.5f}")
        s = summarize(eng, "t_cloudledger", days=1)
        print(f"   triage:小模型接住 {s['small_share']:.0%},回退原因 {s['reasons']}")
        print(f"\n演示数据在 {TMP},可以用任何 SQLite 工具打开 demo.db 看 usage、route_decisions 两张表。")
    finally:
        for p in procs:
            p.terminate()


if __name__ == "__main__":
    main()
```

我本机跑一遍的完整输出(两个服务启动加剧本执行,一共几秒钟):

```text
① 普通路由:租户只写 fast,背后是哪家由平台决定
   200  provider=deepseek  cost=¥0.000800

② 级联路由 triage:小模型先判,不够确定或者属于高风险类别就回退大模型
   发票抬头开错了,能重开吗     → invoice  决策=small:confident
   登录时报错 500        → bug      决策=small:confident
   忘记密码了怎么办         → account  决策=big:low_conf
   我要退款,扣了两次费       → refund   决策=big:always_big
   你们产品挺好用的         → other    决策=big:low_conf

③ 免费档不能用 triage,也不能刷:每分钟 5 次
   triage → 403
   连发 8 次 fast → [200, 200, 200, 200, 200, 429, 429, 429]

④ 成本:按租户和功能节点汇总(数据来自 usage 表)
   t_cloudledger  ticket.triage  8 次  ¥0.01111
   t_intern       demo           5 次  ¥0.00400
   t_cloudledger  demo           1 次  ¥0.00080
   triage:小模型接住 40%,回退原因 {'confident': 2, 'low_conf': 2, 'always_big': 1}
```

`ticket.triage` 那一行是 8 次调用而不是 5 次:五张工单里三张回退到了大模型,每张回退的工单调用了两次上游。这个细节本身就是一个很好的话题,面试时评审问「级联到底省了多少钱」,你可以从这里讲起(Day 101 的那笔账)。

我第一次跑这个演示时,「忘记密码」那一行直接崩了:置信度低于阈值、回退到大模型,假的大模型返回了一句普通的话而不是 JSON。真实场景里分诊请求都带着要求输出 JSON 的系统提示(Day 79 的 `SYSTEM`),演示脚本漏了。这类问题正是演示要尽早暴露的:你自己都跑不通的演示,评审跑的时候一定会出问题。

演示的设计原则就三条:不需要任何外部依赖;几秒钟内跑完,输出一屏能看完;每一段输出都对应一个你想让评审记住的能力。剧本里没有放跨租户隔离,因为它的证据是测试而不是演示,README 里给测试的链接就够了。

## README:三十秒版本放在最上面

README 的读者分三种:只看第一屏就走的人(大多数),会往下翻找某样东西的人,真正要跑起来的人。按这个顺序组织。下面是 AgentOps 的 README,段落名和下一节的自查脚本对应,数字都来自前面几天的实测,并且注明了环境:

````markdown
# AgentOps:多租户 Agent 平台

给公司里多个团队共用的 Agent 基础设施:统一模型网关、MCP 工具中心、持久化运行时、评测平台、全链路可观测。
第一个租户是客服工单 Agent SupportPilot。这是一个个人项目,所有数据都是造的。

```bash
uv run python demo/run_demo.py   # 不需要 API key,不需要 Docker,几秒钟跑完
```

## 它解决什么问题

几个团队各自做 Agent,各自接模型、各自写重试和限流、各自算钱、各自做评测。
AgentOps 把这些收成平台能力:团队只需要把 base_url 指过来,model 填 fast / smart / triage。

## 架构

![架构图](docs/architecture.png)

网关(路由、限流、预算、故障切换、成本归因)· 工具中心(MCP、授权、审批、审计)·
运行时(租约、断点续跑、人工审批)· 评测(配对检验、A/B)· 可观测(OTel、Collector、Prometheus)

## 关键数字

| 项目 | 结果 | 环境与口径 |
| --- | --- | --- |
| 网关自身开销 | 80 并发时 P50 14ms / P95 83ms;单进程约 45 rps 打满一个核,4 进程恢复到 P50 34ms | 2019 款笔记本,SQLite,假上游,见 reports/loadtest.md |
| 多进程限流 | 4 进程时配额失效(放行 113/30),按进程数平分后 28/30 | 同上 |
| 级联路由 | 单次分诊成本约为纯大模型的 1/4(80% 被小模型接住的假设下) | 价格表算出,见 reports/cost.md |
| 安全 | 跨租户隔离测试 + 覆盖门禁;promptfoo 夜间红队 | 见 reports/security.md |
| 测试 | 38 条,全部用 SQLite 内存库和假上游 | `uv run pytest` |

## 五分钟跑起来

…(本地开发、接真实模型、docker compose 部署三种方式)

## 设计文档

- [设计文档](docs/design.md) · [ADR 目录](docs/adr/) · [报告](reports/)

## 已知局限

- 限流是进程内令牌桶,上 K8s 自动伸缩前必须换成 Redis(ADR-0004)
- 级联的高风险规则判断的是小模型给的类别,小模型很确定地分错时拦不住(reports/cost.md)
- 压测数据来自一台旧笔记本,只能看趋势
````

几个写法上的讲究。

**第一段就说明是个人项目、数据是造的。** 不说的话,评审会自己猜,猜错了比你主动说更伤。资深候选人最怕的不是项目小,而是被发现夸大。

**「关键数字」每一行都带环境和口径。** 「P95 83ms」单独写出来没有意义,写明「80 并发、旧笔记本、SQLite、假上游」,评审就知道你懂这个数字的边界。这一列比数字本身更能体现资深。

**「已知局限」是必须有的一段。** 它告诉评审你知道系统会在哪里出问题。面试时评审很可能直接从这一段开始问,这是你主动选的战场。

**架构图放图片,不放 ASCII。** 第一屏的视觉印象很重要。手画拍照也比 ASCII 好,用 Excalidraw 或者 draw.io 画十分钟就够了。

## ADR 和报告:让每个结论都能追溯

`docs/adr/` 里每个重要决定一份 ADR。怎么写一份好的 ADR 是 Day 106 的主题,今天只看作品里应该有哪几份。下面这张表是我给 AgentOps 整理的,每一份都对应前面某一天的一个真实决定:

| 编号 | 决定 | 依据 |
| --- | --- | --- |
| 0001 | 多租户用 pool 模式(共享表 + tenant_id),不用每租户一库 | Day 96 |
| 0002 | 网关只暴露 OpenAI 兼容接口,model 填逻辑路由名 | Day 96、97 |
| 0003 | 级联路由放在网关里,作为 triage 路由提供;业务相关的回退规则留在应用 | Day 101 |
| 0004 | 单机部署时限流按进程数平分配额;上 K8s 自动伸缩前换 Redis | Day 104 压测数据 |
| 0005 | 指标用 OTLP 推给 Collector,不暴露 /metrics | Day 102 多进程实测 |
| 0006 | 审计日志用按租户的哈希链,链头每小时外置 | Day 103 |

ADR 的价值在面试时最明显。评审问「为什么不用 Redis 做限流」,你不用现场组织语言,ADR-0004 里写着:当时的部署是固定进程数的单机 compose,平分配额实测有效(28/30),引入 Redis 会多一个要运维的组件,所以第一期不引入,并且写明了什么情况下必须换。这个回答里有约束、有数据、有触发条件,正是资深的样子。

`reports/` 里放四份报告,结构都一样:结论一句话、方法和环境、数据表、发现的问题、没解决的问题。

- **eval.md**(Day 100):评测集是什么、各版本的通过率和置信区间、配对检验的结果,以及「50 条用例能检测出多大的差异」这句诚实的话。
- **loadtest.md**(Day 104):五组对比实验的表、CPU 采样、连接池调大反而更慢的分析、多进程限流的复现和修复。
- **security.md**(Day 103):威胁模型图、隔离测试覆盖了哪些接口、红队的插件和结果(真漏洞、误判各多少)、演练复盘。
- **cost.md**(Day 101、102):单次调用的成本拆解、级联的那笔账、自部署值不值的结论、对账结果。

报告里最值钱的往往是「发现的问题」那一节。Day 104 压测发现单进程撑不住、调大连接池反而更慢、多进程限流失效,Day 102 发现两处显式配置盖过环境变量、旧版 HTTP 语义约定会撑爆指标,Day 103 发现路由遍历在新版 FastAPI 上失效导致门禁空转。这些都是真实踩到、并且有数据的坑,比十个顺利实现的功能更能说明你的水平。

## 发布前的自查脚本

作品要公开,发布前有几件事每次都要查:README 该有的段落在不在、ADR 编号连不连续、文档里的相对链接有没有断、有没有把 key 或者 `.env` 提交上去、有没有误提交几百兆的数据文件。人工查一定会漏,写成脚本放进 CI:

```python
# agentops/scripts/portfolio_check.py
"""发布作品前的自查:README 该有的段落、ADR 格式和编号、文档里的相对链接、疑似密钥、大文件。

  uv run python scripts/portfolio_check.py     # 有问题时退出码非 0,可以放进 CI
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

README_SECTIONS = ["它解决什么问题", "架构", "关键数字", "五分钟跑起来", "设计文档", "已知局限"]
ADR_SECTIONS = ["状态", "背景", "决定", "后果"]
REPORTS = ["eval.md", "loadtest.md", "security.md", "cost.md"]
SECRET_PATTERNS = {
    "OpenAI/DeepSeek 风格 key": re.compile(r"\bsk-[A-Za-z0-9]{20,}"),
    "AgentOps 完整 key": re.compile(r"\bak_k_[0-9a-f]{12}\.[A-Za-z0-9_-]{20,}"),
    "AWS key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "私钥": re.compile(r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"),
}
MAX_BYTES = 5 * 1024 * 1024


def tracked_files(root: Path) -> list[Path]:
    """只查会被提交的文件:git 跟踪的 + 未被忽略的新文件。不是 git 仓库时退回到全部文件。"""
    try:
        out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=root,
                             capture_output=True, text=True, check=True).stdout
        return [root / p for p in out.splitlines() if p]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return [p for p in root.rglob("*") if p.is_file() and ".venv" not in p.parts and ".git" not in p.parts]


def headings(md: str) -> list[str]:
    return [h.strip() for h in re.findall(r"^#{2,3}\s+(.+)$", md, re.M)]


def check(root: Path = ROOT) -> list[str]:
    problems: list[str] = []
    readme = root / "README.md"
    if not readme.exists():
        return ["缺 README.md"]
    hs = headings(readme.read_text(encoding="utf-8"))
    for s in README_SECTIONS:
        if not any(h.startswith(s) for h in hs):
            problems.append(f"README 缺少段落「{s}」")

    adrs = sorted((root / "docs" / "adr").glob("[0-9][0-9][0-9][0-9]-*.md"))
    if not adrs:
        problems.append("docs/adr/ 下没有 ADR")
    for i, p in enumerate(adrs, start=1):
        if not p.name.startswith(f"{i:04d}-"):
            problems.append(f"ADR 编号不连续:期望 {i:04d}-*,实际 {p.name}")
        ahs = headings(p.read_text(encoding="utf-8"))
        for s in ADR_SECTIONS:
            if not any(h.startswith(s) for h in ahs):
                problems.append(f"{p.relative_to(root)} 缺少「{s}」")

    for r in REPORTS:
        if not (root / "reports" / r).exists():
            problems.append(f"缺 reports/{r}")

    files = tracked_files(root)
    for p in files:
        if p.suffix == ".md":
            for target in re.findall(r"\]\((?!https?://|#|mailto:)([^)#\s]+)", p.read_text(encoding="utf-8")):
                if not (p.parent / target).exists():
                    problems.append(f"{p.relative_to(root)} 里的链接指向不存在的 {target}")
        if p.name == ".env" or p.name.endswith(".env") and p.name != ".env.example":
            problems.append(f"{p.relative_to(root)} 是环境变量文件,不该提交")
        try:
            size = p.stat().st_size
        except FileNotFoundError:
            continue
        if size > MAX_BYTES:
            problems.append(f"{p.relative_to(root)} 有 {size // 1024 // 1024} MB,大文件放 release 或对象存储")
        if size < MAX_BYTES and p.suffix not in {".png", ".jpg", ".gif", ".mp4", ".db"}:
            text = p.read_text(encoding="utf-8", errors="ignore")
            for name, pat in SECRET_PATTERNS.items():
                if pat.search(text):
                    problems.append(f"{p.relative_to(root)} 疑似包含{name}")
    return problems


if __name__ == "__main__":
    found = check()
    for x in found:
        print("✗", x)
    print("全部通过" if not found else f"\n{len(found)} 个问题")
    sys.exit(1 if found else 0)
```

```python
# agentops/tests/test_portfolio_check.py
from scripts.portfolio_check import check

GOOD_README = "\n".join(f"## {s}\n内容" for s in ["它解决什么问题", "架构", "关键数字", "五分钟跑起来", "设计文档", "已知局限"])
ADR = "# ADR\n## 状态\n已采纳\n## 背景\n…\n## 决定\n…\n## 后果\n…\n"


def make(tmp, readme=GOOD_README, adrs=("0001-pool.md", "0002-gateway.md"), reports=True, extra=None):
    (tmp / "README.md").write_text(readme + "\n见 [设计](docs/design.md)\n", encoding="utf-8")
    (tmp / "docs" / "adr").mkdir(parents=True)
    (tmp / "docs" / "design.md").write_text("# 设计\n", encoding="utf-8")
    for a in adrs:
        (tmp / "docs" / "adr" / a).write_text(ADR, encoding="utf-8")
    if reports:
        (tmp / "reports").mkdir()
        for r in ["eval.md", "loadtest.md", "security.md", "cost.md"]:
            (tmp / "reports" / r).write_text("# r\n", encoding="utf-8")
    for name, text in (extra or {}).items():
        (tmp / name).write_text(text, encoding="utf-8")
    return tmp


def test_clean_repo_passes(tmp_path):
    assert check(make(tmp_path)) == []


def test_catches_problems(tmp_path):
    root = make(tmp_path, readme="## 架构\n", adrs=("0001-a.md", "0003-c.md"), reports=False,
                extra={"notes.md": "调试用 sk-" + "a" * 32 + " 和 [图](img/arch.png)", ".env": "X=1"})
    msgs = "\n".join(check(root))
    for want in ["缺少段落「关键数字」", "ADR 编号不连续", "缺 reports/eval.md", "疑似包含OpenAI/DeepSeek 风格 key",
                 "img/arch.png", ".env 是环境变量文件"]:
        assert want in msgs, want
```

疑似密钥那一项要说明一下:这个脚本只做最粗的正则匹配,目的是在你自己的提交里拦住低级错误。真正发布前再用专门的工具扫一遍历史记录,比如 gitleaks,它能扫整个 git 历史,而不只是当前文件。key 一旦进过某次提交,即使后面删了,在历史里也还在,唯一的补救是立刻在供应商那边作废这把 key。

脚本测试连同前面的,我本机一共 38 条全过。

## 三分钟演示视频

很多评审不会跑你的代码,但会点开一个三分钟的视频。视频不是录屏把功能点一遍,而是讲一个故事。我给 AgentOps 的分镜是这样的:

| 时间 | 画面 | 讲什么 |
| --- | --- | --- |
| 0:00–0:20 | 架构图 | 几个团队各自做 Agent 的问题,AgentOps 是什么(一句话) |
| 0:20–1:00 | 终端跑 `run_demo.py` | 普通路由、级联的几种决策、限流、成本,每段只说一句 |
| 1:00–1:40 | Jaeger 里打开一条回退到大模型的 trace | 小模型那一段很短、大模型那一段很长、span 上写着为什么回退 |
| 1:40–2:20 | loadtest.md 里那张对比表 | 单进程撑不住、调大连接池反而更慢、为什么、怎么修的 |
| 2:20–2:50 | README 的「已知局限」 | 两个还没解决的问题和打算怎么解决 |
| 2:50–3:00 | 仓库地址 | 结束 |

录制用 OBS 或者 macOS 自带的录屏都可以,声音比画面重要,用耳机上的麦克风就行,别用笔记本自带的。先写好逐字稿,录三遍挑最好的一遍,不要剪得太花。第三段和第四段是整个视频的核心:前者证明系统是可观测的,后者证明你会用数据找问题。演示视频里讲一次踩坑,比展示十个功能更有说服力。

## 一篇只讲一个坑的技术博客

技术博客最常见的写法是「我做了一个 XX 平台,用了 A、B、C 技术」,读起来像产品介绍,没人会转发。好的技术博客只讲一件事,而且是一件反直觉的事。AgentOps 里我最推荐写的是 Day 104 那个:

> **题目**:把连接池调大五倍,网关反而慢了一半

1. 背景(一段):多租户 Agent 网关,压测目标是网关自身开销 P95 < 30ms。
2. 现象(一段 + 一张表):200 并发时吞吐卡在四五十,开销从十几毫秒涨到一秒以上。
3. 第一个直觉和它为什么错(两段 + 对比表):调大连接池,结果吞吐掉一半。解释连接池上限其实在当背压。
4. 怎么找到真正的瓶颈(两段):先排除压测工具本身(三个进程的 CPU 采样),再用 cProfile 看一个请求的 CPU 花在哪。
5. 修复和代价(两段):开 4 个进程,吞吐接近理论值;但多进程让限流配额翻了四倍,又是一个新问题。
6. 结论(三句):先找瓶颈再调参数;压测要量压测工具自己;修一个问题时要问它会引入什么新问题。

一千五百到两千五百字,配两张表一张图,所有数字带环境说明。写完发在你自己的博客上,在 README 的设计文档那一段放链接。面试官点开读完,对你的印象会比读十页简历更具体。

## 简历上怎么写

Day 56 讲过项目经历的写法:问题、方案、数据。资深的项目描述再加一条:取舍。几条可以直接改用的写法:

- 设计并实现多租户 Agent 平台 AgentOps(个人项目):OpenAI 兼容的模型网关、MCP 工具中心、持久化运行时、评测与可观测,以客服工单 Agent 为第一个租户。
- 通过压测定位网关瓶颈为单进程 CPU,而非直觉上的连接池;改为多进程后吞吐提升约三成、自身开销 P50 从九百毫秒级降到三十几毫秒;同时发现并修复多进程下限流配额翻倍的问题(测试环境数据)。
- 将级联路由下沉到网关,以 logprobs 置信度决定小模型或回退大模型,设计 shadow 验证流程和「小模型确定时一致率」上线标准;按成本模型测算单次分诊成本约为纯大模型的四分之一。
- 建立跨租户隔离的确定性测试和接口覆盖门禁,接入 promptfoo 夜间红队回归;审计日志采用哈希链并外置链头。

英文版同样的结构,动词用 designed、identified、introduced、established,数字照搬。

两条底线。一是「个人项目」「测试环境数据」这类限定词不能省,资深岗的背调和深挖面试会追问每一个数字的来源,被问穿比项目小严重得多。二是如果你在现在的工作里做过类似的事,优先写工作里的,个人项目放在后面作为补充;个人项目替代不了真实的生产经验,但能证明你在没人要求的情况下也会把事情做到这个程度。

## 面试时怎么讲:三种长度

同一个项目要准备三种讲法。

**三十秒**(自我介绍里带一句):「我做过一个多租户 Agent 平台的个人项目,网关、工具中心、运行时、评测和可观测都有,最有意思的是压测时发现调大连接池反而让网关变慢,最后定位到是单进程 CPU 瓶颈。」一句是什么,一句最亮的点,留一个钩子让面试官问。

**三分钟**(「介绍一下你的项目」):用 README 的结构讲,问题、架构、关键数字、一个踩坑、一个局限。和演示视频的分镜几乎一样。

**十五分钟**(深挖):面试官会顺着某一块往下问。提前准备好下面这十个最可能的问题,每个都知道答案在哪份 ADR 或报告里:

| 可能的问题 | 答案在哪 |
| --- | --- |
| 为什么用共享表做多租户,怎么保证不串数据? | ADR-0001、security.md 的隔离测试和覆盖门禁 |
| 网关挂了怎么办?上游挂了怎么办? | Day 97 故障切换、Day 104 多副本和 PDB |
| 限流在多副本下怎么做? | ADR-0004、loadtest.md |
| 级联的阈值怎么定?怎么证明小模型可以上线? | Day 81 扫阈值、ADR-0003、shadow 和条件一致率 |
| 一个请求慢了,你怎么查? | Day 102 trace、X-Trace-Id、overhead 指标 |
| 成本怎么算的?准不准? | cost.md、usage 表、对账 |
| 怎么防 prompt injection 和越权? | security.md、红队结果 |
| 流量涨五倍扛得住吗? | Day 104 容量规划、DeepSeek 账户并发上限 |
| 如果重新做一次,你会改什么? | 「已知局限」那一段 |
| 这个项目最难的部分是什么? | 选一个你真的卡过很久的坑,讲它的发现过程 |

「如果重新做一次你会改什么」几乎一定会被问到,而且是资深面试里分量很重的一题。答案不能是「没什么要改的」,也不能是一串缺点。好的答案是一两个具体的决定,说清楚当时为什么那样选、后来看到了什么数据、现在会怎么做。比如:「我会更早做压测。网关写完第一版就该压,而不是等功能都写完,那样单进程瓶颈和限流问题会在设计阶段就暴露,ADR-0004 会是另一个样子。」

## 发布清单

| 检查项 | 怎么确认 |
| --- | --- |
| 演示命令能在一台干净的机器上跑通 | 新开一个用户或者容器,只装 uv,照 README 跑 |
| 自查脚本通过 | `uv run python scripts/portfolio_check.py` |
| git 历史里没有密钥 | `gitleaks git`(扫完整历史) |
| 所有数据都是造的 | 搜一遍真实公司名、真实客户名、你现在公司的任何东西 |
| 有 LICENSE | 个人作品用 MIT 就行 |
| 测试在 CI 上是绿的 | README 顶部放 CI 徽章 |
| 提交历史能看 | 不要一个「init」提交塞进全部代码;按天或按功能的小提交更能体现过程 |
| 演示视频和博客的链接放进了 README | 点一遍 |

倒数第二条容易被忽略。评审会翻提交历史,一个提交里几万行代码,看起来像是从别处搬来的。如果你是一路按天做下来的,提交历史本身就是最好的过程证明,不要为了「整洁」把它压成一个。

还有一条不在表里,但最重要:**作品里不能有任何你现在公司的东西**。代码、数据、架构图、内部系统的名字、截图里的内部网址,一样都不能有。哪怕你觉得已经改得面目全非,也不要冒这个险。AgentOps 和 SupportPilot 从第一天起就用虚构的「云簿 CloudLedger」,就是为了这一天能放心公开。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1334y1q72q&autoplay=0&high_quality=1" title="程序员写技术博客新手指南" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>技术胖 · 程序员写技术博客新手指南 | 程序员为什么要写博客?| 我写了四年博客收获了什么 | 有那些技巧? · 9 分钟。写博客的动机和坚持的方法,配合上面那份提纲看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/YODPgBadj80" title="How to write technical blog posts - talk by Quincy Larson" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>freeCodeCamp Talks · How to write technical blog posts - talk by Quincy Larson · 16 分钟。freeCodeCamp 创始人讲技术文章怎么写才有人读,核心观点是一篇只讲一件事、标题要说清楚读者能得到什么。</figcaption>
</figure>

## 动手练习

**目标**:AgentOps 仓库达到可以公开、可以放进简历的状态。

1. 写 `demo/fake_models.py` 和 `demo/run_demo.py`,在一台干净的机器上跑通,输出和你预期的一致。
2. 按「README」一节重写 README,关键数字全部换成你自己的实测值和环境说明,写好「已知局限」。
3. 整理 `docs/adr/` 下的六份 ADR(怎么写见 Day 106)和 `reports/` 下的四份报告。
4. 写 `scripts/portfolio_check.py` 和它的测试,放进 CI;再用 gitleaks 扫一遍完整历史。
5. 按分镜录一个三分钟的演示视频,传到 B 站或者 YouTube,链接放进 README。
6. 写一篇只讲一个坑的技术博客,一千五百字以上,数字带环境。
7. 改简历上的项目描述;找一个朋友扮演面试官,分别听你讲三十秒、三分钟、十五分钟的版本。

**验收标准**:

- 一个从没见过这个项目的人,只看 README 第一屏,能说出它是什么、最亮的一个点是什么。
- 演示命令在干净机器上一次跑通,不需要任何 key。
- 自查脚本和 gitleaks 都通过。
- 十个深挖问题,每个都能在一分钟内指出答案在哪份文档里,并口头讲清楚。
- 「如果重新做一次你会改什么」有一个具体的、带数据的答案。

记录表:

| 项目 | 完成情况 |
| --- | --- |
| 演示命令在干净机器上的耗时 | |
| README 第一屏测试:朋友的复述 | |
| ADR 数量 / 报告数量 | |
| 自查脚本问题数(第一次 / 修完) | |
| gitleaks 结果 | |
| 视频时长和链接 | |
| 博客题目和字数 | |
| 模拟面试里卡住的问题 | |

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 零依赖演示 | 不需要外部账号、服务和密钥就能跑通的演示,通常靠假服务实现 |
| ADR | Architecture Decision Record,记录一个架构决定的背景、选项、决定和后果 |
| 口径 | 一个数字是在什么环境、什么条件下、用什么方法得出的 |
| 已知局限 | 主动写明的系统问题和边界,告诉读者你知道它会在哪里出问题 |
| 背压 | 下游处理不过来时让上游排队或拒绝,Day 104 连接池那个坑的关键 |
| gitleaks | 扫描 git 仓库及其完整历史里有没有密钥的开源工具 |
| 分镜 | 视频每一段的时间、画面和要讲的内容 |
| 深挖面试 | 面试官顺着你的项目一层层往下问,检验你是不是真的做过、懂到什么程度 |

## 常见误区

**演示要先配环境。** 评审不会为一个陌生人的仓库配半小时环境。做不到零依赖,至少做到一条命令加一个免费的 key。

**README 第一屏是安装步骤。** 第一屏应该回答「这是什么、做到了什么程度」。安装步骤放后面。

**数字不写口径。** 「P95 83ms」没有环境说明,懂行的评审会直接怀疑。口径那一列比数字本身更能体现资深。

**不写局限。** 不写不代表没有,评审会自己找,找到了比你主动说更伤。

**功能越多越好。** 资深作品的价值在判断的质量。三个有取舍记录、有数据、有踩坑过程的模块,胜过十个只有代码的模块。

**把提交历史压成一个。** 评审会看提交历史,一个提交几万行像是搬来的。按天的小提交是过程的证据。

**删了文件就以为密钥安全了。** key 进过 git 历史就一直在。扫完整历史,泄露了就立刻作废。

**作品里混进现在公司的东西。** 改得再彻底也不要冒险。从第一天起就用虚构数据。

## 学习资料

### 文档与文章

- [GitHub:About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes):README 在仓库页面怎么展示、相对链接和图片的规则。
- [Make a README](https://www.makeareadme.com/):README 常见段落的清单和示例,5 分钟。
- [MADR](https://adr.github.io/madr/):一种常用的 ADR 模板,Day 106 会细讲,今天先看它的段落结构。
- [Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/):设计文档在资深工程师工作里的位置,配合 Day 106 读。
- [StaffEng:Staff archetypes](https://staffeng.com/guides/staff-archetypes/):Will Larson 总结的几类 Staff 工程师,帮你想清楚自己的作品要突出哪种能力。
- [Dan Luu:Writing non-advice](https://danluu.com/writing-non-advice/):一个写了很多年技术博客的工程师对写作的看法,读起来不像建议,但很有用。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1ZyFNzoEPi&autoplay=0&high_quality=1" title="技术博客怎么写才能吸引大厂面试官兴趣" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员牛肉 · 技术博客怎么写才能吸引大厂面试官兴趣 · 3 分钟。站在面试官的角度说博客里什么内容会被注意到,和今天「只讲一个坑」的建议一致。</figcaption>
</figure>

- 「服役蛋饭 · 如何写好 github 的 readme?【简单/高效】」(BV1qp411f7aA,9 分钟):README 的基本结构,比较老但不过时。

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/z8UPAVTh2aE" title="How To Make Your GitHub Stand Out (Gets You Hired!)" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Miraya · How To Make Your GitHub Stand Out (Gets You Hired!) · 8 分钟。GitHub 主页和置顶仓库怎么整理,偏入门,资深候选人主要看「置顶什么、README 第一屏放什么」那部分。</figcaption>
</figure>

- Book Overflow「Discussing Staff Engineer by Will Larson」(YouTube,1 小时 19 分):两个工程师逐章讨论《Staff Engineer》这本书,通勤时听。

### 书籍

- Will Larson,《Staff Engineer: Leadership Beyond the Management Track》,2021;[StaffEng 网站](https://staffeng.com/)上能免费读到书里的很多内容。读讲「工作被看见」和写作的部分。
- Tanya Reilly,《The Staff Engineer's Path》,O'Reilly,2022;有繁体中文版《Staff 工程師之路》,简体中文版没有查证到。读第 8 章(Good Influence at Scale),讲怎么让自己的工作被更多人看见和采用,和今天的包装直接相关。

### 开源项目与代码

- [gitleaks/gitleaks](https://github.com/gitleaks/gitleaks):扫描 git 历史里的密钥,发布前必跑。
- [OBS Studio](https://obsproject.com/):录演示视频,免费开源。

## 自测

1. 资深作品和中级作品,评审关注点最大的区别是什么?

<details><summary>答案</summary>

中级作品评审想确认「他能做完」,看功能完整、代码整洁、有测试。资深作品评审默认你能做完,想看判断的质量:有没有取舍的记录(考虑过、放弃的方案),结论有没有数据支撑并说明口径,有没有写失败和局限,别人能不能用、能不能运维。包装的重点是让这些容易被找到,而不是把功能列得更多。

</details>

2. 为什么演示要做成不需要 API key 和 Docker?AgentOps 是怎么做到的?

<details><summary>答案</summary>

评审不会为一个陌生人的仓库花半小时配环境,更不会填自己的 API key,门槛高的演示等于没有演示。AgentOps 能做到,是因为从 Day 96 开始就坚持测试用 SQLite 和假上游:演示脚本起一个假模型服务(返回带 logprobs 的分类结果,让级联算出真实置信度),再起真正的网关进程,按剧本发请求打印结果,几秒钟跑完。

</details>

3. README 的「关键数字」为什么要有「环境与口径」那一列?

<details><summary>答案</summary>

脱离环境的数字没有意义,懂行的评审看到「P95 83ms」会立刻问是什么并发、什么机器、上游是真是假。主动写明口径说明你知道这个数字的边界,这本身就是资深的体现;不写的话,评审要么怀疑你在夸大,要么在面试里追问到你答不上来。

</details>

4. 简历上写「通过压测把网关开销从九百毫秒降到三十几毫秒」,为什么一定要加「测试环境数据」?

<details><summary>答案</summary>

资深岗的深挖面试和背调会追问每个数字的来源。这个数字来自一台旧笔记本上、用假上游、SQLite 的压测,不是生产数据。不加限定词,被追问时你要么现场改口,要么被认为夸大,后果比项目小严重得多。加上限定词,数字依然有价值,而且体现了你对数据边界的诚实。

</details>

5. 面试官问「如果重新做一次,你会改什么」,什么样的回答是好的?

<details><summary>答案</summary>

不能说「没什么要改的」,也不能罗列一串缺点。好的回答是一两个具体的决定:当时为什么那样选、后来看到了什么数据、现在会怎么做。比如「会更早做压测,网关第一版写完就压,单进程瓶颈和多进程限流问题会在设计阶段暴露,限流的 ADR 会直接选共享状态的方案」。它说明你会从数据里学习,并且能把经验变成具体的做法。

</details>

6. **资深面试题**:你的作品是个人项目,面试官说「个人项目和生产系统差得很远,你怎么证明你能处理真实的生产问题?」你怎么回答?

<details><summary>答案</summary>

先承认差距是真的:没有真实流量、没有真实用户、没有凌晨三点的事故。然后说明这个项目刻意模拟了生产里最难的那部分,并拿证据:多租户隔离用确定性测试加覆盖门禁守住;压测用假上游控制变量、排除压测工具本身的瓶颈,发现了单进程 CPU 和多进程限流失效两个问题;可观测接上真实的 Collector 验证过,发现了配置被代码覆盖、旧版语义约定撑爆指标这类只有部署时才会碰到的坑;安全做了红队回归和事故演练。最后把话题引回真实经验:如果你在现在的工作里处理过线上问题,讲一个具体的事故,说明你在项目里做的这些事,正是从那次事故里学到要提前做的。个人项目不能替代生产经验,但它能证明你知道生产系统会在哪里出问题,并且会在没人要求的时候提前做准备。

</details>

## 明天预告

Day 106 · 写设计文档和 ADR:资深工程师的主要产出。今天把 ADR 和报告放进了作品,明天讲怎么把它们写好:设计文档每一节写什么,Agent 系统要比普通系统多写哪几节,取舍怎么写才有说服力,评审时怎么接住质疑。会拿 AgentOps 的模型网关当例子,从头写一份。
