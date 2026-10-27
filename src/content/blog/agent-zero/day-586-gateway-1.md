---
title: 'Day 586 · 模型网关(一):网关管什么,买还是写,按 token 限流'
description: '所有 Agent 的模型调用先过一道网关:业务方只认虚拟 key,真 key 只在网关里。今天先写一个 40 行的透传网关,看到业务方只改 base_url 和 key;再讲网关该管的十件事、2026 年 10 月 LiteLLM、Portkey、Higress 这些现成方案的现状和选法;最后讲为什么限流要按 token 不按请求数,写令牌桶,处理请求进来时不知道会用多少 token 的预扣和结算。'
pubDate: 2026-10-27
regime: none
tags: ['gateway', 'rate-limit', 'token-bucket', 'litellm', 'agent-zero']
series: 'agent-zero'
day: 586
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 585](/blog/agent-zero/day-585-platform-3/) 把平台拆成控制面和数据面,又给数据面装上了 Valkey、队列、检索库和对象存储。图里有一个框我们只写了名字:**模型网关**,它在数据面的最前面。今天打开它。

网关是平台里最值得第一个做的一块:业务方接入它几乎没有成本(把 `LLM_BASE_URL` 换成网关地址就行),而它带来的好处第二天就能看到。财务终于知道每个部门花了多少钱;某家供应商下午开始大面积 429,请求自动换一家;某个团队的批处理写了个死循环,烧到预算上限就被拦住,而不是第二天早上看到账单。这些好处里,今天只讲前三个问题:网关管什么、买还是自己写、限流为什么要按 token。预算、降级、成本归因和完整的最小网关放在 [Day 588](/blog/agent-zero/day-588-gateway-2/)。

## 今天要解决的问题

学完今天你应该能做到:

1. 画出模型网关在架构里的位置,说出它管的十件事,并说清第一版必须有哪四件。自己写一个 40 行的透传网关,让业务方只改 `base_url` 和 key 就能接进来。
2. 对 LiteLLM、Portkey、Higress 等现成方案,说出各自 2026 年 10 月的现状(我当天查到的),给出「买还是写」的判断依据,并能解释为什么网关的依赖必须锁死版本。
3. 解释为什么限流的主维度是 token 不是请求数,写出令牌桶,处理「请求进来时不知道会用多少 token」的预扣加结算,并用真实接口量一下估算和实际差多少。

预计用时 3 小时。前置:[Day 585](/blog/agent-zero/day-585-platform-3/)(控制面、数据面、Valkey)、[Day 584](/blog/agent-zero/day-584-platform-2/)(配额、密钥隔离)、[Day 128](/blog/agent-zero/day-128-rate-limit/)(RPM/TPM 和并发)、[Day 127](/blog/agent-zero/day-127-retry-backoff/)(429 和退避)、[Day 124](/blog/agent-zero/day-124-cost/)(从 usage 算钱)、[Day 82](/blog/agent-zero/day-082-auth-1/)(服务端怎么验 API key)。

今天调了几次 DeepSeek,模型是 `deepseek-flash`,都是几十到两千个 token 的小请求:透传网关两个请求,每个 `max_tokens=20`;估算那一节 4 个量系数的请求(`max_tokens=1`)加 5 个预扣结算的请求,合计输入 token 约 4,000、输出约 450。按 `.env` 里 `LLM_PRICE` 的价格(未命中 2 元、输出 8 元每百万 token)算,4,000 × 2 ÷ 1,000,000 + 450 × 8 ÷ 1,000,000 ≈ 0.012 元,我两次跑加上网关那几个请求,总共不到 0.05 元。

代码放在 `agent-zero-lab/part10/gateway/`(新目录,Day 588 接着往里加)。要装的包:

```bash
cd agent-zero-lab
uv add fastapi uvicorn httpx openai python-dotenv redis
```

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`passthrough.py` 的 `chat`、`token_bucket.py` 的 `try_take`、`estimate_settle.py` 的预扣结算那几行);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 网关在哪,先看它在做什么

模型网关坐在所有业务 Agent 和所有模型供应商之间。对业务方来说它就是一个「OpenAI 兼容的 API」:地址换成网关的,key 换成平台发的虚拟 key,别的代码一行不改。

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="模型网关的位置:左边是多个团队的 Agent,中间网关依次做鉴权、限流、路由降级、记账,右边是多个模型供应商;业务方只持有虚拟 key,真实 key 只在网关里">
  <rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="16" y="40" width="110" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="71" y="64" text-anchor="middle" fill="var(--ink)">客服 Agent</text>
    <rect x="16" y="100" width="110" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="71" y="124" text-anchor="middle" fill="var(--ink)">销售 Agent</text>
    <rect x="16" y="160" width="110" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="71" y="184" text-anchor="middle" fill="var(--ink)">Dify 应用</text>
    <text x="71" y="230" text-anchor="middle" fill="var(--ink-soft)">只认网关地址</text>
    <text x="71" y="246" text-anchor="middle" fill="var(--ink-soft)">和虚拟 key</text>
    <rect x="170" y="24" width="290" height="250" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="315" y="44" text-anchor="middle" fill="var(--ink)">模型网关</text>
    <rect x="186" y="56" width="258" height="30" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="75" text-anchor="middle" fill="var(--ink)">1 鉴权:虚拟 key → 租户</text>
    <rect x="186" y="94" width="258" height="30" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="113" text-anchor="middle" fill="var(--ink)">2 预算:本月花了多少</text>
    <rect x="186" y="132" width="258" height="30" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="151" text-anchor="middle" fill="var(--ink)">3 限流:按 token 的令牌桶</text>
    <rect x="186" y="170" width="258" height="30" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="189" text-anchor="middle" fill="var(--ink)">4 路由 + 降级 + 熔断</text>
    <rect x="186" y="208" width="258" height="30" rx="3" fill="var(--paper-raised)" stroke="var(--rule)"/><text x="315" y="227" text-anchor="middle" fill="var(--ink)">5 记账:租户 / 项目 / Agent</text>
    <text x="315" y="260" text-anchor="middle" fill="var(--ink-soft)">缓存 · 日志 · 护栏钩子</text>
    <rect x="504" y="50" width="120" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="564" y="74" text-anchor="middle" fill="var(--ink)">DeepSeek</text>
    <rect x="504" y="110" width="120" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="564" y="134" text-anchor="middle" fill="var(--ink)">另一家云</text>
    <rect x="504" y="170" width="120" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="564" y="194" text-anchor="middle" fill="var(--ink)">自部署 vLLM</text>
    <text x="564" y="236" text-anchor="middle" fill="var(--ink-soft)">真实 key 只在这里</text>
  </g>
  <g stroke="var(--ink-faint)" stroke-width="1.2" fill="none">
    <path d="M126 60 L170 100"/><path d="M126 120 L170 130"/><path d="M126 180 L170 160"/>
    <path d="M460 120 L504 70"/><path d="M460 140 L504 130"/><path d="M460 160 L504 190"/>
  </g>
</svg>
<figcaption>请求在网关里依次经过几道关。业务方手里只有平台发的虚拟 key,真实的供应商 key 只存在网关里,这一点本身就是很大的安全收益:业务方的代码、日志、截图里漏出去的,都不是能直接去供应商那里花钱的 key。</figcaption>
</figure>

光看图容易觉得网关很大。其实它的骨架非常小:认出虚拟 key 是谁,换成真 key 转发出去,把用量记下来。我们先写这个骨架,40 行,不含限流、预算、降级。

### 最薄的网关

要装的东西在上面装过了(FastAPI 你在 [Day 79–81](/blog/agent-zero/day-079-fastapi-1/) 学过,httpx 在 HTTP 那几天用过,今天只多一个 `httpx.AsyncClient`,它是 JS 里 `fetch` 的 Python 版,异步)。

```python
# agent-zero-lab/part10/gateway/passthrough.py
"""最薄的模型网关:业务方拿平台发的虚拟 key 来调,网关换成真 key 转发给供应商,顺手记一行用量。
还没有限流、预算、降级(Day 588 再加),只做三件事:认虚拟 key → 换真 key → 记账。只支持非流式。
用法:uv run uvicorn part10.gateway.passthrough:app --host 127.0.0.1 --port 8585
uv add fastapi uvicorn httpx
"""
import os
import time

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

load_dotenv()
UPSTREAM = os.environ["LLM_BASE_URL"].rstrip("/") + "/chat/completions"
REAL_KEY = os.environ["LLM_API_KEY"]                      # 真 key 只存在网关进程里,业务方永远看不到

VIRTUAL_KEYS = {                                          # 虚拟 key → (租户, 项目)。真实系统里在控制面,key 只存哈希
    "vk-support-001": ("yunbu", "support"),
    "vk-sales-002": ("yunbu", "sales"),
}
usage_log: list[dict] = []                                # 今天先放内存里,Day 588 改成账本

app = FastAPI()
client = httpx.AsyncClient(timeout=60)


@app.post("/v1/chat/completions")
async def chat(request: Request, authorization: str = Header(default="")) -> JSONResponse:
    virtual = authorization.removeprefix("Bearer ").strip()
    if virtual not in VIRTUAL_KEYS:
        raise HTTPException(status_code=401, detail="unknown virtual key")
    tenant, project = VIRTUAL_KEYS[virtual]
    body = await request.json()
    t0 = time.perf_counter()
    resp = await client.post(UPSTREAM, json=body, headers={"Authorization": f"Bearer {REAL_KEY}"})
    data = resp.json()
    usage = data.get("usage") or {}
    usage_log.append({"tenant": tenant, "project": project, "model": body.get("model"), "status": resp.status_code,
                      "prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),
                      "ms": round((time.perf_counter() - t0) * 1000)})
    return JSONResponse(data, status_code=resp.status_code)


@app.get("/admin/usage")
async def admin_usage() -> list[dict]:
    return usage_log
```

<div class="line-notes">

- `UPSTREAM = os.environ["LLM_BASE_URL"].rstrip("/") + "/chat/completions"` 转发的目标地址。`.env` 里 `LLM_BASE_URL=https://api.deepseek.com`,`rstrip("/")` 去掉可能多写的末尾斜杠,拼出 `https://api.deepseek.com/chat/completions`。
- `REAL_KEY = os.environ["LLM_API_KEY"]                      # 真 key 只存在网关进程里,业务方永远看不到` 真 key 从环境变量读。网关是整个公司最集中地持有供应商 key 的地方,所以它也是攻击价值最高的地方,下一节会回到这一点。
- `VIRTUAL_KEYS = {` 虚拟 key 到 (租户, 项目) 的映射。`vk-support-001` 是云簿客服项目的,`vk-sales-002` 是销售项目的。真实系统里这张表在控制面,key 只存哈希,和 [Day 583](/blog/agent-zero/day-583-platform-1/) 的 `tenants.py` 同一个思路。
- `usage_log: list[dict] = []                                # 今天先放内存里,Day 588 改成账本` 记账先用一个列表凑合,进程一重启就没了,今天只为了看到记了什么。
- `client = httpx.AsyncClient(timeout=60)` 一个复用连接的异步 HTTP 客户端,整个进程共用一个,超时 60 秒。
- `async def chat(request: Request, authorization: str = Header(default="")) -> JSONResponse:` 处理 `POST /v1/chat/completions`。`authorization: str = Header(...)` 是 FastAPI 的写法:自动从请求头 `Authorization` 里取值,没有就是空串。路径和 OpenAI 一致,这样业务方的 SDK 不用改。
- `virtual = authorization.removeprefix("Bearer ").strip()` 请求头的格式是 `Bearer vk-support-001`,去掉前缀拿到虚拟 key。
- `raise HTTPException(status_code=401, detail="unknown virtual key")` 不认识的 key 直接 401,根本不会走到供应商那里,所以乱猜 key 不花任何钱。实跑里 `vk-guess` 就死在这一行。
- `tenant, project = VIRTUAL_KEYS[virtual]` 认出租户和项目,后面记账要用。
- `body = await request.json()` 读业务方发来的请求体,原样当成 JSON 对象,网关不改它。
- `resp = await client.post(UPSTREAM, json=body, headers={"Authorization": f"Bearer {REAL_KEY}"})` 转发:同一个请求体,换成真 key。这一行就是「虚拟 key 换真 key」的全部。
- `usage = data.get("usage") or {}` 供应商的响应里带 `usage`(输入、输出 token 数),取不到就当空字典,避免出错响应里没有 `usage` 时崩掉。
- `"prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),` 记账的核心数据。实跑里两个请求都是输入 12、输出 20。
- `return JSONResponse(data, status_code=resp.status_code)` 把供应商的响应原样还给业务方,包括状态码。供应商回 429,业务方也看到 429。
- `@app.get("/admin/usage")` 一个查看用量的接口,只为了今天能看到记下来的东西。真正的网关不会把它暴露给业务方。

</div>

先起网关,监听本机 8585 端口,只绑 `127.0.0.1`:

```bash
uv run uvicorn part10.gateway.passthrough:app --host 127.0.0.1 --port 8585
```

另开一个终端跑业务方的脚本。代码一行不改,只把 `base_url` 和 key 换成网关的:

```python
# agent-zero-lab/part10/gateway/try_gateway.py
"""业务方的视角:代码一行不改,只把 base_url 和 key 换成网关的。先在另一个终端起 passthrough.py。
用法:uv run python part10/gateway/try_gateway.py
"""
import json
import os

import httpx
from dotenv import load_dotenv
from openai import AuthenticationError, OpenAI

load_dotenv()
GATEWAY = "http://127.0.0.1:8585/v1"
MODEL = os.environ["LLM_MODEL"]
EXTRA = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))

for vkey in ("vk-support-001", "vk-sales-002", "vk-guess"):
    client = OpenAI(base_url=GATEWAY, api_key=vkey)
    try:
        r = client.chat.completions.create(model=MODEL, max_tokens=20, extra_body=EXTRA,
                                           messages=[{"role": "user", "content": "用一句话说:什么是模型网关?"}])
        print(f"{vkey:<15} → {r.choices[0].message.content!r}")
    except AuthenticationError as e:
        print(f"{vkey:<15} → 被网关拒绝:{e.status_code}")

print("网关记下的用量:")
for row in httpx.get("http://127.0.0.1:8585/admin/usage").json():
    print(" ", row)
```

<div class="line-notes">

- `GATEWAY = "http://127.0.0.1:8585/v1"` 唯一和直连不同的地方:`base_url` 是网关地址。
- `for vkey in ("vk-support-001", "vk-sales-002", "vk-guess"):` 前两个是合法的虚拟 key,第三个是乱编的。
- `client = OpenAI(base_url=GATEWAY, api_key=vkey)` 这就是「业务方只改两样」:`base_url` 换成网关,`api_key` 换成虚拟 key。后面的调用代码和直连供应商完全一样。
- `except AuthenticationError as e:` 网关回 401,openai SDK 把它翻成 `AuthenticationError`。
- `print(f"{vkey:<15} → 被网关拒绝:{e.status_code}")` 打印状态码 401。
- `for row in httpx.get("http://127.0.0.1:8585/admin/usage").json():` 查网关记下的用量。

</div>

```bash
uv run python part10/gateway/try_gateway.py
```

```text
vk-support-001  → '模型网关是一个统一管理、路由和调度多个AI模型API的中间层服务，让应用'
vk-sales-002    → '模型网关是一个统一的中介层，让应用通过单一接口安全、可控地访问和调度'
vk-guess        → 被网关拒绝:401
网关记下的用量:
  {'tenant': 'yunbu', 'project': 'support', 'model': 'deepseek-flash', 'status': 200, 'prompt_tokens': 12, 'completion_tokens': 20, 'ms': 986}
  {'tenant': 'yunbu', 'project': 'sales', 'model': 'deepseek-flash', 'status': 200, 'prompt_tokens': 12, 'completion_tokens': 20, 'ms': 919}
```

两个合法 key 都拿到了回答(回答被 `max_tokens=20` 截断了,这是我故意的,省钱),乱猜的 key 被网关挡在门外,没有走到供应商。网关记下了两行账:哪个租户、哪个项目、用了多少 token、花了多少毫秒。业务方的代码里**没有**出现过真 key。

这个骨架就是 Day 588 要长大的那个东西。接下来先把「它该管什么」想清楚。

## 网关管的十件事,第一版只做四件

网关能做的事很多,大致有十件:统一协议(不管背后是哪家,对外都是同一套接口)、鉴权(虚拟 key)、路由(按模型组选供应商)、限流、配额与预算、降级与故障切换、成本归因、缓存、请求日志与审计、护栏钩子(调用前后做内容检查)。

第一版不需要全做。我的优先级是:**鉴权、成本归因、限流、降级**这四件必须有,它们是平台化的直接收益;预算和日志其次;缓存和护栏可以等真有需求再加。缓存要特别小心:Agent 场景里命中率通常不高,做错了还会串租户的数据(Day 584 的 `cache_leak.py` 就是那个坑)。

我们刚写的透传网关已经有了鉴权和一点点成本归因。今天补上限流,Day 588 补预算、降级和完整的归因。

## 买还是自己写

模型网关这个品类到 2026 年已经很成熟了,你有很多现成选择。下面是我 2026 年 10 月 27 日当天去 GitHub 和各家文档查到的现状,不是印象:

| 方案 | 形态 | 我查到的现状 | 适合谁 |
| --- | --- | --- | --- |
| LiteLLM | Python 写的,核心是 MIT,`enterprise/` 目录另有商业许可;自带虚拟 key、团队和 key 级别的预算与限流、降级、花费日志、管理界面 | 仓库约 6.2 万星,10 月 25 日还在发版(v1.106.4,同一天还给几条旧分支发了补丁版本);2026 年 3 月出过一次 PyPI 供应链投毒(下面单讲) | 大多数从零开始的团队,功能最全、文档最多 |
| Higress | 阿里开源,基于 Envoy 和 Istio 的云原生网关,AI 能力以插件提供:`ai-proxy`、`ai-token-ratelimit`、`ai-quota`、`ai-statistics` 等 | 仓库在 `higress-group` 组织下,Apache-2.0,约 9,600 星,最近发版 v2.2.5(10 月 4 日);token 限流插件基于 Redis,支持按秒、分钟、小时、天计,可以按请求头、URL 参数、客户端 IP、consumer 名分组 | 已经在用 Kubernetes、Envoy 的团队,国内部署友好 |
| Portkey Gateway | 开源网关(仓库 MIT 许可),带治理、可观测、预算 | 2026 年 4 月 30 日 Palo Alto Networks 宣布收购,5 月 29 日完成(官方新闻稿和其 10-K 给的收购对价是 1.17 亿美元);仓库最近一次发版是 2026 年 1 月的 v1.15.2,最后一次推送是 5 月 25 日,收购后到我查的时候没有新动静;PANW 的计划是把它做成 Prisma AIRS 的核心网关 | 想要现成的治理能力、能接受商业公司主导的项目;开源版的走向需要观察 |
| Bifrost | Go 写的网关,Apache-2.0 | 约 9,100 星,10 月 20 日还在发版 | 对延迟和吞吐要求高的场景 |
| Envoy AI Gateway | Envoy 社区的 AI 网关 | 10 月 7 日发了 v1.2.0,10 月 26 日有 v1.2.1 的预发布版本 | 本来就以 Envoy 为数据面的团队。我没细读过它的文档,不评价 |
| 自研薄网关 | 自己写,两三百行起步 | 今天写的就是起点 | 计费、路由或合规有特殊逻辑,现成方案改不动 |

我的建议是**先用现成的,公司特有的逻辑做成它的插件,或者旁路的服务**。比如成本归因要接公司的财务系统,不需要因此重写一个网关:让网关把用量日志推到队列里,另起一个服务消费就行(Day 585 的队列就是干这个的)。

但今天和后天我们还是要自己写。原因不是自研更好,是只有自己写过一遍,你才知道 LiteLLM 那几百个配置项每一个在防什么;面试被问「你会怎么设计一个 LLM 网关」,才答得出细节。

### 网关是攻击价值最高的地方:LiteLLM 的 2026 年 3 月事件

这件事值得单独说一说,因为它直接关系到「买」的风险。2026 年 3 月 24 日,PyPI 上的 litellm 1.82.7 和 1.82.8 两个版本被植入恶意代码,会把机器上的凭证(SSH key、云凭证、环境变量)发到攻击者那里;1.82.8 还通过一个 `.pth` 文件,让 Python 一启动就执行,甚至不需要 `import litellm`。最后一个干净的版本是 1.82.6。据报道,攻击者是用先前入侵 Trivy(一个安全扫描工具,在 LiteLLM 的发布流水线里用着)拿到的凭证,进到了发布流程。关于有毒版本在线多久,各方说法不一:LiteLLM 自己的说明是约 40 分钟,Snyk 的报告是约三小时。两个说法都指向同样的两个版本。LiteLLM 后来用一条重建过的、环境隔离的流水线发了 v1.83.0。

你不需要记细节,记这一条:**网关是全公司持有供应商 key 最集中的地方,也是攻击价值最高的地方**。所以网关的依赖要锁死精确版本(`uv.lock` 里带哈希),升级先在隔离环境跑,部署网关的机器上不放和网关无关的凭证。这一条对买来的和自己写的一样适用:你自己写的网关依赖的 `httpx`、`fastapi` 同样可能被投毒。

## 限流为什么要按 token

很多人做限流的第一反应是「每个租户每分钟最多 N 个请求」。对普通 API 这没问题,对大模型不行。一个「帮我分类这张工单」的请求可能 1,500 个 token,一个「把这份 80 页的合同总结一下」可能 60,000 个,两者都只算一个请求,对供应商算力和你的钱包的消耗差了 40 倍。

我们把这件事跑一下。同一份流量:云簿客服发来 60 个分类请求(每个 1,500 token),云簿销售发来 6 个长文档总结(每个 60,000 token),都挤在一分钟的开头。分别用「每分钟 60 个请求」和「每分钟 100,000 token」限流:

```python
# agent-zero-lab/part10/gateway/rpm_vs_tpm.py
"""同一份流量,按请求数限流和按 token 限流,放行的结果差多少。一分钟的流量,全部挤在第 0 秒到达,不调接口。
用法:uv run python part10/gateway/rpm_vs_tpm.py
"""
from token_bucket import TokenBucket

# 云簿客服:60 个分类请求,每个 1,500 token;云簿销售:6 个长文档总结,每个 60,000 token
TRAFFIC = [("support", 1_500)] * 60 + [("sales", 60_000)] * 6


def by_requests(limit_per_min: int) -> dict[str, tuple[int, int]]:
    """每个租户每分钟最多 limit_per_min 个请求,不管多大。返回 {租户: (放行个数, 放行的 token 合计)}"""
    out: dict[str, tuple[int, int]] = {}
    count: dict[str, int] = {}
    for tenant, tokens in TRAFFIC:
        count[tenant] = count.get(tenant, 0) + 1
        if count[tenant] <= limit_per_min:
            n, t = out.get(tenant, (0, 0))
            out[tenant] = (n + 1, t + tokens)
    return out


def by_tokens(tpm: int) -> dict[str, tuple[int, int]]:
    """每个租户一个令牌桶,容量 tpm,一分钟补满。"""
    buckets: dict[str, TokenBucket] = {}
    out: dict[str, tuple[int, int]] = {}
    for tenant, tokens in TRAFFIC:
        b = buckets.setdefault(tenant, TokenBucket(capacity=tpm, rate=tpm / 60, clock=lambda: 0.0))
        ok, _ = b.try_take(tokens)
        if ok:
            n, t = out.get(tenant, (0, 0))
            out[tenant] = (n + 1, t + tokens)
    return out


if __name__ == "__main__":
    offered = {"support": (60, 60 * 1_500), "sales": (6, 6 * 60_000)}
    print("发来的:", offered, f"合计 {sum(t for _, t in offered.values()):,} token")
    for label, result in (("每租户每分钟 60 个请求", by_requests(60)), ("每租户每分钟 100,000 token", by_tokens(100_000))):
        total = sum(t for _, t in result.values())
        print(f"{label}:放行 {result},合计 {total:,} token")
```

<div class="line-notes">

- `from token_bucket import TokenBucket` 用后面要写的令牌桶,先看它的结果,原理下一节讲。
- `TRAFFIC = [("support", 1_500)] * 60 + [("sales", 60_000)] * 6` 一个列表放 66 个请求,每个是 (租户, 这个请求的 token 数)。`[x] * 60` 是把列表重复 60 遍。
- `count[tenant] = count.get(tenant, 0) + 1` 按请求数限流:每个租户数自己发来了几个。`dict.get(键, 默认值)` 在键不存在时返回默认值。
- `if count[tenant] <= limit_per_min:` 只要没超过 60 个就放行,不管这个请求多大。
- `b = buckets.setdefault(tenant, TokenBucket(capacity=tpm, rate=tpm / 60, clock=lambda: 0.0))` 按 token 限流:每个租户一个桶,第一次见到这个租户时创建。`setdefault` 的意思是「有就取出来,没有就放进去这个默认值」。`clock=lambda: 0.0` 把时钟固定在第 0 秒,表示这一分钟的请求全是同时到的,桶里不会补充。
- `ok, _ = b.try_take(tokens)` 试着从桶里拿这个请求的 token 数。拿得到才放行。
- `offered = {"support": (60, 60 * 1_500), "sales": (6, 6 * 60_000)}` 发来的总量,拿来和放行的对照。

</div>

```bash
uv run python part10/gateway/rpm_vs_tpm.py
```

```text
发来的: {'support': (60, 90000), 'sales': (6, 360000)} 合计 450,000 token
每租户每分钟 60 个请求:放行 {'support': (60, 90000), 'sales': (6, 360000)},合计 450,000 token
每租户每分钟 100,000 token:放行 {'support': (60, 90000), 'sales': (1, 60000)},合计 150,000 token
```

按请求数限流:66 个请求一个都没被拦,45 万个 token 全放行,其中 36 万是销售那 6 个长请求。换成每个租户每分钟 10 万 token:客服的 60 个小请求照常通过(9 万,没超),销售只放行了 1 个(6 万),剩下 5 个等着。放行的总量从 45 万降到 15 万。**按请求数限流,保护不了你的钱包,也保护不了供应商额度。**

供应商自己也不是按请求数卡你的。Anthropic 的文档里,Messages API 的限制是三个维度:每分钟请求数(RPM)、每分钟输入 token 数(ITPM)、每分钟输出 token 数(OTPM),而且文档明说用的就是令牌桶算法:容量是连续补充的,不是每分钟整点重置。ITPM 里缓存命中读出来的 token 对大多数模型不算数,所以做好 prompt caching,有效吞吐会高很多。DeepSeek 的官方文档(2026 年 10 月看的)则不用 RPM 和 TPM,限制的是**并发**:`deepseek-flash` 的账号级并发上限写的是 2500,超了回 429,和你用哪个 API key 无关。所以你的网关其实有两件事要想清楚:对内按 token 保护预算和公平(今天讲),对外按供应商的限制类型设一个「别撞墙」的并发或速率上限(练习 2 做并发那种)。

## 令牌桶:一个会被匀速加水的桶

按 token 限流最常用的算法是**令牌桶**(token bucket)。名字里的 token 是「令牌」,和模型的 token 碰巧同名,下面我会说「桶里的额度」避免混淆。

想象一个桶,最多装 `capacity` 个单位的额度。有一个水龙头,每秒往里滴 `rate` 个,满了就溢出。请求来了,要先从桶里取走它需要的额度:桶里够就取走放行;不够就拒绝,并告诉调用方「大概要等多久」,等待时间 = 缺口 ÷ rate。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="令牌桶的一个例子:容量 60000,每秒补 1000;t=0 秒先后拿走 1500 和 40000,余额 18500;再要 30000 不够,缺口 11500,需要等 11.5 秒;等到 t=11.5 秒余额补回 30000,取走后余额 0">
  <rect x="0" y="0" width="640" height="260" fill="var(--paper-raised)"/>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="30" y="40" width="120" height="150" rx="4" fill="none" stroke="var(--ink-faint)"/>
    <rect x="31" y="150" width="118" height="39" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="90" y="30" text-anchor="middle" fill="var(--ink)">t = 0 秒</text>
    <text x="90" y="215" text-anchor="middle" fill="var(--ink-soft)">先后取走 1,500 和 40,000</text>
    <text x="90" y="232" text-anchor="middle" fill="var(--ink)">余额 18,500 / 60,000</text>
    <text x="165" y="125" fill="var(--ink-soft)">再要 30,000:</text>
    <text x="165" y="141" fill="var(--ink-soft)">缺口 11,500</text>
    <text x="165" y="157" fill="var(--ink-soft)">÷ 每秒补 1,000</text>
    <text x="165" y="173" fill="var(--compute)">= 等 11.5 秒</text>
    <line x1="270" y1="120" x2="350" y2="120" stroke="var(--ink-faint)" stroke-width="1.5"/>
    <polygon points="346,114 346,126 356,120" fill="var(--ink-faint)"/>
    <rect x="380" y="40" width="120" height="150" rx="4" fill="none" stroke="var(--ink-faint)"/>
    <rect x="381" y="100" width="118" height="89" fill="var(--mem-wash)" stroke="var(--mem)"/>
    <text x="440" y="30" text-anchor="middle" fill="var(--ink)">t = 11.5 秒</text>
    <text x="440" y="215" text-anchor="middle" fill="var(--ink-soft)">补回到 30,000,取走 30,000</text>
    <text x="440" y="232" text-anchor="middle" fill="var(--ink)">余额 0</text>
    <text x="520" y="80" fill="var(--ink-soft)">70,000 比桶还大</text>
    <text x="520" y="96" fill="var(--ink-soft)">永远拿不到,</text>
    <text x="520" y="112" fill="var(--ink-soft)">直接拒绝</text>
  </g>
</svg>
<figcaption>令牌桶的一个例子,数字和下面 token_bucket.py 的实跑输出一致。允许突发(桶满时可以一次放一个大请求),但长期的平均速率不会超过每秒补充的量。</figcaption>
</figure>

令牌桶和我们昨天练习 2 的固定窗口(`window_burst.py`)比有个本质区别:固定窗口到点整体清零,窗口交界处能放过两倍的突发;令牌桶的额度是**连续**补充的,任意一段时间里放行的总量都不会超过「桶容量 + 这段时间补充的量」。

```python
# agent-zero-lab/part10/gateway/token_bucket.py
"""按 token 计的令牌桶。桶大小 capacity,每秒补 rate 个。时钟可以注入,所以测试和演示不用真的等。
Day 588 的最小网关会直接 import 这个文件。
用法:uv run python part10/gateway/token_bucket.py
"""
import time
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class TokenBucket:
    capacity: float
    rate: float                                   # 每秒补充多少
    clock: Callable[[], float] = time.monotonic
    tokens: float = field(init=False)
    updated: float = field(init=False)

    def __post_init__(self) -> None:
        self.tokens = self.capacity               # 刚创建时桶是满的
        self.updated = self.clock()

    def _refill(self) -> None:
        now = self.clock()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now

    def try_take(self, n: float) -> tuple[bool, float]:
        """拿 n 个。成功返回 (True, 0);失败返回 (False, 还要等几秒)。"""
        self._refill()
        if n > self.capacity:
            return False, float("inf")            # 比整个桶还大,等多久都拿不到
        if self.tokens >= n:
            self.tokens -= n
            return True, 0.0
        return False, (n - self.tokens) / self.rate

    def give_back(self, n: float) -> None:
        """预扣多了,事后还回去。"""
        self._refill()
        self.tokens = min(self.capacity, self.tokens + n)

    def take_anyway(self, n: float) -> None:
        """预扣少了,事后补扣。允许余额变成负数,后面的请求要等它补回来。"""
        self._refill()
        self.tokens -= n


if __name__ == "__main__":
    now = [0.0]                                   # 假时钟:用一个列表装着,好让下面的 lambda 能读到最新值
    b = TokenBucket(capacity=60_000, rate=1_000, clock=lambda: now[0])   # 相当于「每分钟 6 万 token」

    def show(label: str, result: tuple[bool, float]) -> None:
        ok, wait = result
        verdict = "放行" if ok else f"拒绝,要等 {wait:.1f} 秒"
        print(f"t={now[0]:>4.1f}s | {label} → {verdict} | 余额 {b.tokens:.0f}")

    show("小请求 1,500", b.try_take(1_500))
    show("大请求 40,000", b.try_take(40_000))
    show("再来 30,000(余额不够)", b.try_take(30_000))
    now[0] = 11.5
    show("等 11.5 秒后重试 30,000", b.try_take(30_000))
    show("比桶还大的 70,000", b.try_take(70_000))
    b.give_back(20_000)
    print(f"t={now[0]:>4.1f}s | 预扣多了,还回 20,000 | 余额 {b.tokens:.0f}")
    b.take_anyway(25_000)
    print(f"t={now[0]:>4.1f}s | 预扣少了,补扣 25,000 | 余额 {b.tokens:.0f}")
    show("再来 1,000(欠着账)", b.try_take(1_000))
```

<div class="line-notes">

- `class TokenBucket:` 一个 dataclass([Day 50](/blog/agent-zero/day-050-dataclass/))。`capacity` 是桶的大小,`rate` 是每秒补多少。
- `clock: Callable[[], float] = time.monotonic` 时钟是一个「调用它就返回当前秒数」的函数,默认用真实的单调时钟。测试和演示时换成一个假的,就不用真的等 11.5 秒。`monotonic` 是只增不减的时钟,不受系统改时间的影响,算时间差用它。
- `tokens: float = field(init=False)` 当前余额。`init=False` 表示它不是构造函数的参数,而是创建后在 `__post_init__` 里自己算。
- `self.tokens = self.capacity               # 刚创建时桶是满的` 一开始是满的,所以刚开始能马上处理一次大请求。
- `self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)` 补水:距离上次过了多少秒,乘以每秒补的量,加到余额上,但不超过桶容量。我们不起一个后台线程每秒加水,而是**用到的时候才算**:这一行在每次操作前被调用,代入 11.5 秒后的情形:余额 18,500 + 11.5 × 1,000 = 30,000。
- `if n > self.capacity:` 一个请求比整个桶还大。
- `return False, float("inf")            # 比整个桶还大,等多久都拿不到` 无限等。实跑里的 70,000 就是这种,要等 inf 秒。调用方得到的信号是「别重试了,这个请求本身就超了」,而不是「过几秒再来」。
- `return True, 0.0` 余额够就扣掉并放行。
- `return False, (n - self.tokens) / self.rate` 不够就拒绝,告诉调用方要等多久。代入 t=0 时的第三个请求:缺口 30,000 − 18,500 = 11,500,÷ 1,000 = 11.5 秒。这个数字应该放进 HTTP 响应的 `Retry-After` 头里。
- `def give_back(self, n: float) -> None:` 预扣多了还回去,下一节用。
- `def take_anyway(self, n: float) -> None:` 预扣少了补扣,允许余额变成负数。
- `self.tokens -= n` 没有「不够就拒绝」的判断,直接减。这笔 token 供应商已经替你烧掉了,没办法收回,只能记账并让后面的请求等。
- `now = [0.0]                                   # 假时钟:用一个列表装着,好让下面的 lambda 能读到最新值` Python 里 lambda 能读外层变量,但不能给外层变量重新赋值;把时间放进列表,下面 `now[0] = 11.5` 就是改列表里的内容,lambda 每次调用都读到最新值。
- `b = TokenBucket(capacity=60_000, rate=1_000, clock=lambda: now[0])   # 相当于「每分钟 6 万 token」` 容量 6 万,每秒补 1,000,正好一分钟补满。
- `b.try_take(1_500)` 第一个请求,余额 60,000 → 58,500。
- `b.try_take(40_000)` 第二个,58,500 → 18,500。
- `now[0] = 11.5` 假装过了 11.5 秒,下一次操作时 `_refill` 会补上 11,500。

</div>

```bash
uv run python part10/gateway/token_bucket.py
```

```text
t= 0.0s | 小请求 1,500 → 放行 | 余额 58500
t= 0.0s | 大请求 40,000 → 放行 | 余额 18500
t= 0.0s | 再来 30,000(余额不够) → 拒绝,要等 11.5 秒 | 余额 18500
t=11.5s | 等 11.5 秒后重试 30,000 → 放行 | 余额 0
t=11.5s | 比桶还大的 70,000 → 拒绝,要等 inf 秒 | 余额 0
t=11.5s | 预扣多了,还回 20,000 | 余额 20000
t=11.5s | 预扣少了,补扣 25,000 | 余额 -5000
t=11.5s | 再来 1,000(欠着账) → 拒绝,要等 6.0 秒 | 余额 -5000
```

从上往下对着图看。前两个请求拿走 41,500,余额 18,500;第三个要 30,000,不够,算出来要等 11.5 秒。等到 11.5 秒再试,桶里补回到 30,000,放行,余额变成 0。70,000 比桶还大,等 inf 秒。最后两行是预扣加结算会用到的:预扣多了还回 20,000,余额回到 20,000;预扣少了补扣 25,000,余额变成负的 -5,000,下一个 1,000 要等 6.0 秒((1,000 + 5,000) ÷ 1,000)。**欠了账,后面的请求就要先等它还清。**

## 请求进来时不知道会花多少 token

令牌桶需要请求「要拿多少」。但是大模型有个麻烦:请求进来的时候,你不知道它会消耗多少 token。输入部分可以估(数字符,或者真的跑一遍 tokenizer),输出部分完全不知道,模型想说多少说多少,只被 `max_tokens` 封顶。

常见的做法叫**预扣加结算**:

- **预扣**:先按估算值从桶里拿一笔,估算值 = 估的输入 token 数 + `max_tokens`(调用方声明的输出上限)。`max_tokens` 不填的话,网关应该给一个默认值,甚至强制调用方填,不然一个请求能预扣到天花板。
- **结算**:拿到响应后,用 `usage` 里的真实数字:预扣多了就把差额还回桶里(`give_back`),预扣少了就补扣(`take_anyway`),余额可以变负数。

估算要偏宽还是偏紧?我倾向于偏宽一点。预扣太多只是暂时占着桶的额度,结算时会还;预扣太少,请求已经放行了,补扣只能欠账。但是偏宽也有代价:太宽的话桶的有效容量变小,正常请求会被误拒。

老办法是把整个 `messages` 转成 JSON 字符串,字符数除以 2。这个系数是怎么来的?我们先别信,量一下。下面的脚本第一部分,对四种文本各发一个 `max_tokens=1` 的请求,只为了让接口报出真实的输入 token 数:

```python
# agent-zero-lab/part10/gateway/estimate_settle.py
"""请求进来时不知道会用多少 token:先按估算预扣,拿到响应后按真实 usage 结算(多了还、少了补)。
第一部分用真实接口量一下「几个字符大约一个 token」,第二部分跑预扣加结算。花费约 0.03 元。
用法:uv run python part10/gateway/estimate_settle.py
"""
import json
import os
import random
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from token_bucket import TokenBucket

load_dotenv()
client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
MODEL = os.environ["LLM_MODEL"]
EXTRA: dict[str, Any] = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))


def sample_invoices_json(n: int) -> str:
    random.seed(586)
    rows = [{"invoice_id": f"INV-{20000 + i}", "customer": f"客户{random.randint(1, 300):03d}",
             "amount_cny": round(random.uniform(200, 20000), 2), "status": random.choice(["paid", "overdue", "open"])}
            for i in range(n)]
    return json.dumps(rows, ensure_ascii=False)


def estimate_input(messages: list[dict[str, str]]) -> int:
    """粗估输入 token:把整个 messages 转成 JSON 字符串,字符数除以 2。"""
    return len(json.dumps(messages, ensure_ascii=False)) // 2


def call(messages: list[dict[str, str]], max_tokens: int) -> tuple[int, int, str]:
    r = client.chat.completions.create(model=MODEL, messages=messages, max_tokens=max_tokens, extra_body=EXTRA)  # type: ignore[arg-type]
    assert r.usage is not None
    return r.usage.prompt_tokens, r.usage.completion_tokens, r.choices[0].message.content or ""


def measure_ratio() -> None:
    texts = {
        "中文工单": "客户反馈本月账单里多出了一笔 300 元的席位费用,希望核实并说明原因。" * 60,
        "英文工单": "The customer reports an unexpected seat charge of 300 CNY on this month's invoice and asks us to verify it. " * 20,
        "JSON 发票": sample_invoices_json(25),
        "Python 代码": "def total(rows):\n    return sum(r['amount'] for r in rows if r['status'] == 'paid')\n\n" * 25,
    }
    print(f"{'文本':<10}{'字符数':>8}{'真实输入 token':>16}{'字符/token':>12}{'字符数//2':>12}")
    for name, text in texts.items():
        prompt_tokens, _, _ = call([{"role": "user", "content": text}], max_tokens=1)
        est = len(text) // 2
        print(f"{name:<10}{len(text):>8}{prompt_tokens:>16}{len(text) / prompt_tokens:>12.2f}{est:>12}")


def settle_demo() -> None:
    now = [0.0]
    bucket = TokenBucket(capacity=20_000, rate=0, clock=lambda: now[0])     # rate=0:不补充,看清每一笔
    questions = ["列出退款申请要核对的三件事。", "用两句话解释什么是预付费点数。", "Write one sentence on why invoices get disputed.",
                 "云簿的席位计费和用量计费有什么区别?简要回答。", "给「账单金额不对」这类工单起三个分类标签。"]
    max_tokens = 300
    total_reserved = total_actual = 0
    print(f"{'问题':<8}{'预扣':>7}{'实际':>7}{'预扣后余额':>12}{'结算后余额':>12}")
    for i, q in enumerate(questions, 1):
        messages = [{"role": "user", "content": q}]
        reserve = estimate_input(messages) + max_tokens
        ok, _ = bucket.try_take(reserve)
        assert ok
        after_reserve = bucket.tokens
        p, c, _ = call(messages, max_tokens)
        actual = p + c
        if actual < reserve:
            bucket.give_back(reserve - actual)
        else:
            bucket.take_anyway(actual - reserve)
        total_reserved += reserve
        total_actual += actual
        print(f"第 {i} 个{reserve:>9}{actual:>7}{after_reserve:>12.0f}{bucket.tokens:>12.0f}")
    print(f"合计预扣 {total_reserved},实际 {total_actual};不结算桶里只剩 {20_000 - total_reserved},结算后剩 {bucket.tokens:.0f}(应为 {20_000 - total_actual})")


if __name__ == "__main__":
    measure_ratio()
    print()
    settle_demo()
```

<div class="line-notes">

- `client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])` 直连 DeepSeek,没走我们的网关,只是为了量 token。
- `EXTRA: dict[str, Any] = json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` `.env` 里 `{"thinking": {"type": "disabled"}}`,让模型不开思考,否则输出里会多出思考 token。
- `def sample_invoices_json(n: int) -> str:` 造 25 条假发票的 JSON 字符串,当「JSON 样本」。`random.seed(586)` 固定种子。
- `return len(json.dumps(messages, ensure_ascii=False)) // 2` 老估算:整个 `messages` 转字符串,字符数整除 2。`ensure_ascii=False` 让中文保持原样不转成 `\u` 转义,不然字符数会虚高。
- `r = client.chat.completions.create(model=MODEL, messages=messages, max_tokens=max_tokens, extra_body=EXTRA)  # type: ignore[arg-type]` 发一次请求。`type: ignore` 是给类型检查器看的,因为 openai SDK 的 `messages` 类型比我们简单的 `list[dict[str, str]]` 严格,运行时没有区别。
- `assert r.usage is not None` 响应里一定有 `usage`,这行同时让类型检查器放心。
- `texts = {` 四种文本,每种约 2,100 到 2,300 个字符。中文和英文各一段,一段 JSON,一段 Python 代码。
- `"中文工单": "客户反馈本月账单里多出了一笔 300 元的席位费用,希望核实并说明原因。" * 60,` 一句话重复 60 遍。BPE 分词只看局部,重复不影响每个字符平均花多少 token,所以这样量是可以的。
- `prompt_tokens, _, _ = call([{"role": "user", "content": text}], max_tokens=1)` `max_tokens=1` 只让模型生成一个 token,只为拿 `usage`。返回的是 `(输入 token, 输出 token, 文本)` 三元组,后两项用不上,用 `_` 丢掉。
- `print(f"{name:<10}{len(text):>8}{prompt_tokens:>16}{len(text) / prompt_tokens:>12.2f}{est:>12}")` 每行:字符数、真实输入 token、每 token 多少个字符、老估算的值。
- `bucket = TokenBucket(capacity=20_000, rate=0, clock=lambda: now[0])     # rate=0:不补充,看清每一笔` 结算演示用的桶:容量 2 万,不补水,这样每次余额的变化只来自我们的预扣和结算。
- `max_tokens = 300` 每个请求声明输出上限 300。
- `reserve = estimate_input(messages) + max_tokens` 预扣额 = 估的输入 + `max_tokens`。第 1 个问题估的输入 23,所以预扣 323。
- `ok, _ = bucket.try_take(reserve)` 先从桶里拿预扣额。
- `after_reserve = bucket.tokens` 记下预扣后的余额,第 1 个是 20,000 − 323 = 19,677。
- `p, c, _ = call(messages, max_tokens)` 真的调模型,拿到真实的输入 token `p` 和输出 token `c`。
- `actual = p + c` 实际用量,第 1 个是 184。
- `bucket.give_back(reserve - actual)` 预扣 323、实际 184,还回 139。余额从 19,677 变成 19,816。
- `bucket.take_anyway(actual - reserve)` 反过来,实际比预扣多时补扣。我们这 5 个请求都没走到这一支,因为 `max_tokens=300` 的预留比实际输出宽得多。
- `print(f"合计预扣 {total_reserved},实际 {total_actual};不结算桶里只剩 {20_000 - total_reserved},结算后剩 {bucket.tokens:.0f}(应为 {20_000 - total_actual})")` 最后对账:结算后的余额应该恰好等于容量减去实际用量。

</div>

```bash
uv run python part10/gateway/estimate_settle.py
```

```text
文本             字符数      真实输入 token    字符/token      字符数//2
中文工单          2160            1264        1.71        1080
英文工单          2160             465        4.65        1080
JSON 发票       2305             887        2.60        1152
Python 代码     2125             629        3.38        1062

问题           预扣     实际       预扣后余额       结算后余额
第 1 个      323    184       19677       19816
第 2 个      324     62       19492       19754
第 3 个      340     58       19414       19696
第 4 个      328     88       19368       19608
第 5 个      327     39       19281       19569
合计预扣 1642,实际 431;不结算桶里只剩 18358,结算后剩 19569(应为 19569)
```

先看第一张表。老办法「字符数除以 2」:

- **中文**:真实 1,264,估 1,080,**少估了 15%**。中文大约 1.71 个字符一个 token(这里的字符数包括标点和数字),除以 2 偏小。
- **英文**:真实 465,估 1,080,**多估了 132%**。英文大约 4.65 个字符一个 token,除以 2 太保守。
- JSON 多估 30%、代码多估 69%。

这个现象很有用:你的租户如果用英文,按字符数除以 2 预扣,桶会被白白占掉一倍还多;如果是中文,少估的部分要靠结算补扣。所以估算最好按字符类型分别算(练习 1),或者直接接 tokenizer。DeepSeek 等厂商都发布了离线的 tokenizer 文件,放在网关里能跑出几乎精确的输入数。

第二张表是预扣加结算。五个问题,每个预扣 323 到 340(23 到 40 的输入估算加 300 的输出预留),实际只用了 39 到 184。五个加起来预扣 1,642,实际 431。**如果不结算,桶里只剩 18,358,实际应该剩 19,569**,也就是 1,211 个额度被白白占着。如果每个请求都这样,桶的有效容量就缩水了三分之二以上,正常请求会被莫名其妙地拒掉,这就是结算那一步存在的理由。

这里还有一个值得提醒的现象:`max_tokens` 就是你给网关的「预扣单」。调用方如果习惯性地写 `max_tokens=4096`,每个请求先占 4,096,桶很快就空了。网关通常会有一个「最大允许的 `max_tokens`」,超过就改写或拒绝。

## 多实例怎么办

今天的令牌桶都在进程内存里。回想 [Day 585](/blog/agent-zero/day-585-platform-3/) 的 `shared_counter.py`:三个网关实例各数各的,放行 90 个而上限是 60。令牌桶也一样。多实例要把桶的状态放进 Valkey,并且「补水、判断、扣减」要在服务端一步完成,不然就是 Day 585 里那个先读后写的竞态。这是练习 3,参考答案里是一段 Lua 脚本。LiteLLM 的文档里写得很明白:它的 `tpm`、`rpm` 计数器就在 Redis 里,这样每个实例执行同一个限制;Redis 连不上时各实例退回自己的内存计数,所以一个 key 的实际上限会乘以实例数,可以打开 `fail_closed_rate_limit_enforcement` 让它在 Redis 挂了时直接 503。

## 动手练习

**练习 1(改代码)**:上面「中文少估、英文多估」。写一个更准的 `estimate(text)`:中文字符(含中文标点)按文中实测的 1.7 字符/token,其他字符按一个偏保守的值。用文中四段文本的真实 token 数(1264、465、887、629)评价新旧两种估算的偏差。

<details><summary>参考答案</summary>

新建 `part10/gateway/better_estimate.py`:

```python
# agent-zero-lab/part10/gateway/better_estimate.py
"""练习 1 参考答案:按字符类型分别估 token。系数来自文中 estimate_settle.py 的实测表,不调接口。
用法:uv run python part10/gateway/better_estimate.py
"""
import random

# 文中实测(真实输入 token):中文工单 1264、英文工单 465、JSON 发票 887、Python 代码 629
MEASURED = {"中文工单": 1264, "英文工单": 465, "JSON 发票": 887, "Python 代码": 629}


def is_cjk(ch: str) -> bool:
    return "一" <= ch <= "鿿" or ch in "，。！？；：、（）「」"


def estimate(text: str) -> int:
    cjk = sum(1 for ch in text if is_cjk(ch))
    other = len(text) - cjk
    return round(cjk / 1.7 + other / 3.0)       # 中文约 1.7 字符/token(实测);其他字符取偏保守的 3.0


def old_estimate(text: str) -> int:
    return len(text) // 2


def sample_invoices_json(n: int) -> str:
    import json
    random.seed(586)
    rows = [{"invoice_id": f"INV-{20000 + i}", "customer": f"客户{random.randint(1, 300):03d}",
             "amount_cny": round(random.uniform(200, 20000), 2), "status": random.choice(["paid", "overdue", "open"])}
            for i in range(n)]
    return json.dumps(rows, ensure_ascii=False)


if __name__ == "__main__":
    texts = {
        "中文工单": "客户反馈本月账单里多出了一笔 300 元的席位费用,希望核实并说明原因。" * 60,
        "英文工单": "The customer reports an unexpected seat charge of 300 CNY on this month's invoice and asks us to verify it. " * 20,
        "JSON 发票": sample_invoices_json(25),
        "Python 代码": "def total(rows):\n    return sum(r['amount'] for r in rows if r['status'] == 'paid')\n\n" * 25,
    }
    print(f"{'文本':<10}{'真实':>6}{'旧(//2)':>9}{'偏差':>8}{'新':>7}{'偏差':>8}")
    for name, text in texts.items():
        real, old, new = MEASURED[name], old_estimate(text), estimate(text)
        print(f"{name:<10}{real:>6}{old:>9}{(old - real) / real:>+8.0%}{new:>7}{(new - real) / real:>+8.0%}")
```

<div class="line-notes">

- `MEASURED = {"中文工单": 1264, "英文工单": 465, "JSON 发票": 887, "Python 代码": 629}` 直接抄文中 `estimate_settle.py` 的实测结果,所以这个脚本不调接口。
- `return "一" <= ch <= "鿿" or ch in "，。！？；：、（）「」"` 判断一个字符是不是中文:范围 `一` 到 `鿿` 覆盖常用汉字,再加上中文标点。Python 里字符串可以直接比较大小,按 Unicode 码点比。
- `cjk = sum(1 for ch in text if is_cjk(ch))` 数中文字符。`sum` 里的生成器每遇到一个中文字符产出一个 1。
- `other = len(text) - cjk` 其余字符数。
- `return round(cjk / 1.7 + other / 3.0)       # 中文约 1.7 字符/token(实测);其他字符取偏保守的 3.0` 中文按 1.7;其他字符用 3.0,比英文实测的 4.65 小,也就是会多估,宁可偏宽。
- `def old_estimate(text: str) -> int:` 老算法留着对比。
- `print(f"{name:<10}{real:>6}{old:>9}{(old - real) / real:>+8.0%}{new:>7}{(new - real) / real:>+8.0%}")` `:>+8.0%` 是把小数按百分比打印并带正负号。

</div>

```bash
uv run python part10/gateway/better_estimate.py
```

```text
文本            真实   旧(//2)      偏差      新      偏差
中文工单        1264     1080    -15%   1179     -7%
英文工单         465     1080   +132%    720    +55%
JSON 发票      887     1152    +30%    781    -12%
Python 代码    629     1062    +69%    708    +13%
```

中文从 −15% 变成 −7%,英文从 +132% 变成 +55%,JSON 从 +30% 变成 −12%,代码从 +69% 变成 +13%。整体偏差缩小了,但没有消失:中文仍然少估 7%,JSON 少估了 12%。用「其他字符 3.0」一个系数处理英文、JSON 和代码是粗糙的,JSON 里大量的数字和符号的分词和英文单词不一样。想要更准,别调系数,直接用 tokenizer。这个练习要你体会的是:估算永远有偏差,所以结算那一步不是可选项。

</details>

**练习 2(改代码)**:DeepSeek 限的是并发。写一个按并发限流的小脚本:40 个「模型调用」同时到达,每个占着 0.2 秒,不限制时最高并发是多少、总共多久做完;给每个租户设最多 8 个并发,又是多少?拿不到并发位的请求是排队还是拒绝,你怎么选?

<details><summary>参考答案</summary>

新建 `part10/gateway/concurrency_limit.py`:

```python
# agent-zero-lab/part10/gateway/concurrency_limit.py
"""练习 2 参考答案:按并发数限流。DeepSeek 官方限的就是账号级并发(不是 RPM/TPM),网关也可以给每个租户设同样的限制。
用 asyncio.Semaphore,不调接口,每个「模型调用」用 sleep(0.2) 代替。
用法:uv run python part10/gateway/concurrency_limit.py
"""
import asyncio
import time


class Gauge:
    def __init__(self) -> None:
        self.now = 0
        self.peak = 0

    def enter(self) -> None:
        self.now += 1
        self.peak = max(self.peak, self.now)

    def leave(self) -> None:
        self.now -= 1


async def fake_call(gauge: Gauge) -> None:
    gauge.enter()
    await asyncio.sleep(0.2)                    # 一次「模型调用」占着一个并发位 0.2 秒
    gauge.leave()


async def run(limit: int | None, total: int = 40) -> tuple[int, float]:
    gauge = Gauge()
    sem = asyncio.Semaphore(limit) if limit else None

    async def one() -> None:
        if sem is None:
            await fake_call(gauge)
        else:
            async with sem:                     # 拿不到并发位就在这里排队,不是报错
                await fake_call(gauge)

    t0 = time.perf_counter()
    await asyncio.gather(*(one() for _ in range(total)))
    return gauge.peak, time.perf_counter() - t0


if __name__ == "__main__":
    for limit in (None, 8):
        peak, secs = asyncio.run(run(limit))
        print(f"并发上限 {limit or '无':>2}:40 个请求同时到达,最高并发 {peak},全部做完用了 {secs:.2f} 秒")
```

<div class="line-notes">

- `class Gauge:` 一个小计数器,记当前并发数和历史峰值。
- `self.peak = max(self.peak, self.now)` 每次进入时更新峰值。
- `await asyncio.sleep(0.2)                    # 一次「模型调用」占着一个并发位 0.2 秒` 用 `sleep` 代替真正的模型调用。`await` 把控制权交出去,别的任务可以同时跑,和 JS 里 `await new Promise(r => setTimeout(r, 200))` 是同一回事。
- `sem = asyncio.Semaphore(limit) if limit else None` 信号量:一个装着 `limit` 个许可的容器。同时最多 `limit` 个任务拿得到许可,其余的在 `async with` 那里等。`limit` 为空表示不限。
- `async with sem:                     # 拿不到并发位就在这里排队,不是报错` 进入时拿一个许可,退出时自动还回去。这是「排队」的写法。如果想「拒绝」,把它换成 `if sem.locked(): 返回 429`。
- `await asyncio.gather(*(one() for _ in range(total)))` 同时启动 `total` 个任务并等它们全部结束,相当于 JS 的 `Promise.all`。
- `for limit in (None, 8):` 先不限,再限 8。

</div>

```bash
uv run python part10/gateway/concurrency_limit.py
```

```text
并发上限  无:40 个请求同时到达,最高并发 40,全部做完用了 0.20 秒
并发上限  8:40 个请求同时到达,最高并发 8,全部做完用了 1.01 秒
```

不限制:40 个同时在跑,0.23 秒全做完。限制 8 个:同时最多 8 个,分五批,每批 0.2 秒,共约 1.01 秒。

排队还是拒绝,取决于调用方:交互式的聊天,等一两秒可以接受,排队;后台批处理,排队时间不设上限会把内存里堆满等待的任务,最好限制队列长度,超了就回 429 加 `Retry-After`,让调用方自己退避。这和 [Day 127](/blog/agent-zero/day-127-retry-backoff/) 的重试是一对:网关告诉你等多久,调用方按这个时间退避。

</details>

**练习 3(改代码)**:把令牌桶放进 Valkey,让多个网关实例共享。要求:「补水、判断、扣减」在服务端一步做完;8 个线程共发 160 个 1,000 token 的请求,桶容量 6 万、不补充,应该正好放行 60 个。先照 [Day 585](/blog/agent-zero/day-585-platform-3/) 的命令起 Valkey(端口 6389)。

<details><summary>参考答案</summary>

新建 `part10/gateway/redis_bucket.py`:

```python
# agent-zero-lab/part10/gateway/redis_bucket.py
"""练习 3 参考答案:多实例共享的令牌桶。桶的状态放在 Valkey 里,「补充 + 判断 + 扣减」写成一段 Lua,在服务端一步做完。
先在本机起 Valkey(Day 585 的命令,端口 6389)。
用法:uv run python part10/gateway/redis_bucket.py
uv add redis
"""
import threading
import time

import redis

r = redis.Redis(host="127.0.0.1", port=6389, decode_responses=True)

LUA = """
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local want = tonumber(ARGV[3])
local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000
local state = redis.call('HMGET', key, 'tokens', 'updated')
local tokens = tonumber(state[1])
local updated = tonumber(state[2])
if tokens == nil then
  tokens = capacity
  updated = now
end
tokens = math.min(capacity, tokens + (now - updated) * rate)
local ok = 0
if tokens >= want then
  tokens = tokens - want
  ok = 1
end
redis.call('HSET', key, 'tokens', tostring(tokens), 'updated', tostring(now))
redis.call('EXPIRE', key, 3600)
return ok
"""
take = r.register_script(LUA)


def try_take(key: str, capacity: int, rate: float, want: int) -> bool:
    return bool(take(keys=[key], args=[capacity, rate, want]))


def hammer(key: str, rate: float, total: int = 160, workers: int = 8, want: int = 1_000) -> int:
    passed: list[bool] = []
    lock = threading.Lock()

    def work() -> None:
        for _ in range(total // workers):
            ok = try_take(key, 60_000, rate, want)
            with lock:
                passed.append(ok)

    ts = [threading.Thread(target=work) for _ in range(workers)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return sum(passed)


if __name__ == "__main__":
    r.delete("tb:maple")
    n = hammer("tb:maple", rate=0)
    print(f"桶 6 万 token,8 个线程共发 160 个 1,000 token 的请求(不补充):放行 {n} 个")
    time.sleep(2)
    n2 = hammer("tb:maple", rate=1_000, total=16, workers=2)
    print(f"过了约 2 秒、每秒补 1,000:再发 16 个,放行 {n2} 个")
    r.delete("tb:maple")
```

<div class="line-notes">

- `LUA = """` 一段 Lua 脚本,Valkey 会把整段当成一个不可打断的操作执行。`KEYS` 是脚本要读写的 key 列表,`ARGV` 是别的参数。
- `local t = redis.call('TIME')` 用 Valkey 服务器的时钟,不用客户端的:几个网关实例的本地时钟可能差几百毫秒,桶的补水必须只看一个时钟。返回 `{秒, 微秒}`。
- `local state = redis.call('HMGET', key, 'tokens', 'updated')` 桶的状态存成一个哈希:当前余额和上次更新的时间。一次读出两个字段。
- `if tokens == nil then` 第一次见到这个桶(key 不存在),建满的。
- `tokens = math.min(capacity, tokens + (now - updated) * rate)` 补水,和 Python 版 `_refill` 是同一个公式。
- `if tokens >= want then` 够就扣并标记放行,不够不扣。
- `redis.call('HSET', key, 'tokens', tostring(tokens), 'updated', tostring(now))` 写回。无论放行与否都写回:补水的结果和更新时间也要保存。
- `redis.call('EXPIRE', key, 3600)` 一小时没人用,这个桶自己消失,避免租户越来越多时留下一堆死 key。
- `take = r.register_script(LUA)` 把脚本注册给 Valkey,以后只发脚本的哈希值(`EVALSHA`),不用每次传整段文本。
- `return bool(take(keys=[key], args=[capacity, rate, want]))` 调用脚本,返回 1 或 0,转成布尔值。
- `n = hammer("tb:maple", rate=0)` 8 个线程并发发 160 个请求,桶不补充。
- `time.sleep(2)` 等 2 秒。
- `hammer("tb:maple", rate=1_000, total=16, workers=2)` 现在每秒补 1,000,2 秒大约补了 2,000,再发 16 个 1,000 token 的请求。

</div>

```bash
uv run python part10/gateway/redis_bucket.py
```

```text
桶 6 万 token,8 个线程共发 160 个 1,000 token 的请求(不补充):放行 60 个
过了约 2 秒、每秒补 1,000:再发 16 个,放行 2 个
```

并发的 160 个请求,正好放行 60 个,多线程之间没有竞态。等 2 秒后再发 16 个,放行 2 个,和「每秒补 1,000」对得上。

对比一下 Day 585 的「先读后写」,区别是:Lua 脚本在服务端一步做完,中间没有别的客户端能插进来。代价是这段脚本在 Valkey 里执行期间,别的命令都要等,所以脚本必须短。

</details>

**练习 4(开放题)**:给三个团队选网关。①五个人的创业团队,Agent 都是 Python,没有 Kubernetes;②一家有 Envoy 和 Istio、全部服务跑在 K8s 上的公司,要在国内部署;③一家做金融合规的公司,模型和计费的规则很特殊,现成方案都改不动。各选一个方案,写出理由和你最担心的一件事。

<details><summary>参考答案</summary>

没有标准答案,下面是我的选择:

| 团队 | 选 | 理由 | 最担心 |
| --- | --- | --- | --- |
| ① 五人创业团队 | LiteLLM | 功能最全,一个 Python 进程加一个 Postgres 就能跑,虚拟 key、预算、降级都现成;不用为网关养人 | 供应链安全:锁精确版本、升级前隔离验证,网关机器上不放别的凭证 |
| ② K8s 加 Envoy 的公司 | Higress(或 Envoy AI Gateway) | 数据面本来就是 Envoy,AI 能力以插件接入,token 限流、配额、统计都有,国内部署和文档友好 | 限流依赖 Redis,Redis 的高可用和失败策略(挂了是放过还是拒绝)要自己想清楚 |
| ③ 金融合规 | 自研薄网关,但依赖选成熟的库,并保留「换现成方案」的口子 | 规则特殊,现成的改不动,硬魔改反而背着别人的技术债 | 所有边界情况(流式降级、熔断、对账)都要自己踩一遍,所以要先写测试,Day 588 会演示 |

评价标准:不是选哪个对,而是理由里有没有具体的约束(语言、基础设施、定制程度),以及担心的是不是一件具体的、能检查的事。

</details>

**验收标准**:`try_gateway.py` 里两个合法 key 都得到回答、`vk-guess` 得到 401,且业务方代码里没有出现过真 key;`rpm_vs_tpm.py` 放行总量从 45 万降到 15 万;`token_bucket.py` 的输出和图里的数字一致;`estimate_settle.py` 里能说清「不结算会少算多少」;`redis_bucket.py` 并发下正好放行 60 个。并且能不看文章回答:为什么按请求数限流保护不了预算。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 模型网关 | 坐在所有 Agent 和所有模型供应商之间的一层服务,统一做鉴权、限流、路由、降级、记账 |
| 虚拟 key | 平台发给业务方的 key,只在网关里有效;真实的供应商 key 只存在网关里 |
| 透传 | 网关把请求原样转给供应商、把响应原样还回来,不改内容 |
| 路由 | 按规则决定一个请求发给哪家供应商、哪个模型 |
| RPM / TPM | 每分钟请求数 / 每分钟 token 数,两种常见的限流维度 |
| ITPM / OTPM | 每分钟输入 token 数 / 每分钟输出 token 数,Anthropic 把 TPM 拆成了两个 |
| 并发限制 | 同一时刻最多有多少个请求在途,DeepSeek 官方限制的就是这个 |
| 令牌桶(token bucket) | 一个按固定速率补充额度的桶,请求先拿额度才能通过;允许突发,长期平均速率受限 |
| 预扣 / 结算 | 请求进来时先按估算扣额度,拿到响应后按真实用量多退少补 |
| `Retry-After` | HTTP 响应头,告诉调用方多少秒以后再来 |
| 供应链攻击 | 攻击者不攻击你的代码,而是污染你依赖的软件包或发布流程 |
| 熔断 | 某个下游连续失败后,暂时不再请求它,直接走备用,冷却后再试探(Day 588 详讲) |
| 信号量(Semaphore) | 一个装着固定个数许可的容器,同时只有这么多任务能拿到许可,用来限制并发 |
| `asyncio.gather` | 同时启动多个异步任务并等它们全部结束,相当于 JS 的 `Promise.all` |

## 常见误区

**按请求数限流。** 我们的实测:66 个请求一个都没被拦,45 万 token 全放行,其中 36 万来自 6 个长请求。供应商本身也是按 token 或并发限制你的。

**预扣之后忘了结算。** 5 个请求预扣 1,642,实际用了 431,不结算桶里少了 1,211 个额度,正常请求会被莫名其妙地拒掉。

**用字符数除以 2 估 token 并且当成真的。** 实测中文少估 15%、英文多估 132%。估算只是为了先占位,最后以接口报回来的 `usage` 为准,有条件就用 tokenizer。

**不限制 `max_tokens`。** 它直接决定预扣多少。调用方习惯性写 4096,每个请求先占 4,096,桶很快空了。网关要有一个最大允许值,或者给一个默认值。

**把网关当成安全的、不用管依赖。** 它是全公司持有供应商 key 最集中的地方。2026 年 3 月 LiteLLM 的 PyPI 包被投毒,有毒版本把机器上的凭证外传。锁精确版本、升级前隔离验证。

**多个网关实例各用各的内存计数。** 三个实例,每个限 60,实际放行 90。共享的计数要放在 Valkey 里,并且用一步完成的原子操作(`INCR` 或 Lua),不能先读后写。

**限流返回 429 却不给 `Retry-After`。** 调用方不知道等多久,只会盲目重试,把网关打得更狠。令牌桶算得出等多久,应该把它告诉调用方。

**看到一个现成网关就直接上,不看维护状态。** 一个开源网关被收购、路线转向,或者发版停了几个月,都不是第二天就会炸的事,但半年后你会在一个没人修 bug 的东西上跑着全公司的流量。上之前看一眼最近的发版和提交。

## 学习资料

### 文档与文章

- [Anthropic · Rate limits](https://platform.claude.com/docs/en/api/rate-limits):RPM、ITPM、OTPM 三个维度,令牌桶,缓存命中的 token 不计入 ITPM,以及响应头里的剩余额度。读一遍就知道「按 token 限流」在一个大厂是怎么做的。
- [DeepSeek · 限速](https://api-docs.deepseek.com/quick_start/rate_limit):另一种思路,限的是并发而不是速率。只有几段,2 分钟读完。
- [LiteLLM · 虚拟 key、团队与限流](https://docs.litellm.ai/docs/proxy/users):`tpm_limit`、`rpm_limit`、`max_parallel_requests` 怎么设,Redis 里的计数器,Redis 挂了怎么办。[生产环境建议](https://docs.litellm.ai/docs/proxy/prod) 那一页也值得翻一翻。
- [Higress · AI Token 限流插件](https://higress.cn/en/docs/latest/plugins/ai/api-consumer/ai-token-ratelimit/):另一家网关怎么做同一件事,配置项里能看出按 consumer、按请求头、按 IP 分组。
- [Stripe · Scaling your API with rate limiters](https://stripe.com/blog/rate-limiters):令牌桶和另外几种限流器的经典文章,讲了为什么要做多层限流。
- [Wikipedia · Token bucket](https://en.wikipedia.org/wiki/Token_bucket):算法的标准描述。
- [PyPI 投毒事件的一份分析(futuresearch.ai)](https://futuresearch.ai/blog/litellm-pypi-supply-chain-attack/):2026 年 3 月 LiteLLM 事件的时间线,读它是为了学「出事的时候怎么排查」。
- [Palo Alto Networks 官方新闻稿](https://www.paloaltonetworks.com/company/press/2026/palo-alto-networks-completes-acquisition-of-portkey-to-secure-ai-agents):Portkey 被收购完成的公告。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1T99DBoE9j&autoplay=0&high_quality=1" title="大模型API网关,Token限流与计费怎么设计?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>图灵程序员诸葛 · 大模型API网关,Token限流与计费怎么设计? · 约 3 分钟。一个短的概述,和今天后半的内容对得上,先看这个。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV14NyrBTEeB&autoplay=0&high_quality=1" title="什么是 AI 网关?大厂 AI 开发神器有多强?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员鱼皮 · 什么是 AI 网关?大厂 AI 开发神器有多强? · 约 6 分半。从零解释 AI 网关是什么、为什么需要,对照「网关管的十件事」看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1BH4y1g7ad&autoplay=0&high_quality=1" title="动画学Redis分布式限流算法,面试必考,令牌桶、漏桶、计数器、滑动窗口你学会了吗?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>熊老板i · 动画学 Redis 分布式限流算法,令牌桶、漏桶、计数器、滑动窗口 · 约 9 分半。用动画讲几种限流算法的区别,配合昨天练习 2 的固定窗口突发看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Nk7qDiLHyuU" title="LiteLLM AI Gateway: Routing, API Keys, Budgets, and Guardrails for Local and Cloud Models" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Paul Zuradzki · LiteLLM AI Gateway: Routing, API Keys, Budgets, and Guardrails for Local and Cloud Models · 英文,演示 LiteLLM 里虚拟 key、预算、路由怎么配,对照我们写的透传网关想「它多做了什么」。</figcaption>
</figure>

### 书籍

- Alex Xu《System Design Interview: An Insider's Guide》(Byte Code LLC, 2020):第 4 章「Design a Rate Limiter」,把令牌桶、漏桶、固定窗口、滑动窗口各算法放在一起比较,还讲了分布式环境下的竞态。读完今天的内容,这一章很快。

### 开源项目与代码

- [BerriAI/litellm](https://github.com/BerriAI/litellm):最流行的开源模型网关。别急着读代码,先看它的 `proxy/` 目录结构,对照我们的 `passthrough.py` 想一想它多出来的那些文件分别在管什么。
- [higress-group/higress](https://github.com/higress-group/higress):云原生网关加 AI 插件,`plugins/wasm-go/extensions/` 下以 `ai-` 开头的目录就是各个 AI 插件。
- [Portkey-AI/gateway](https://github.com/Portkey-AI/gateway):被收购的那个开源网关。
- [maximhq/bifrost](https://github.com/maximhq/bifrost):Go 写的高性能网关。
- [envoyproxy/ai-gateway](https://github.com/envoyproxy/ai-gateway):Envoy 社区的 AI 网关。
- [agentgateway/agentgateway](https://github.com/agentgateway/agentgateway):面向 Agent 和 MCP 的网关,明后天讲 MCP 网关时会用到。

## 自测

1. 说出模型网关管的至少六件事,以及第一版必须有哪四件。

<details><summary>答案</summary>

统一协议、鉴权(虚拟 key)、路由、限流、配额与预算、降级与故障切换、成本归因、缓存、请求日志与审计、护栏钩子,共十件。第一版必须有四件:鉴权、成本归因、限流、降级。预算和日志其次;缓存和护栏等真有需求再加,缓存在 Agent 场景里命中率不高,而且做错了会串租户数据。

</details>

2. 为什么业务方只拿虚拟 key,不拿真 key?

<details><summary>答案</summary>

真 key 只存在网关里,业务方的代码、日志、截图里漏出去的都不是能直接去供应商那里花钱的 key;虚拟 key 可以按租户和项目发放、单独撤销、单独限额和计费;乱猜的虚拟 key 在网关就被 401 挡掉,不会走到供应商,不花钱。代价是网关成了持有真 key 最集中的地方,要重点防护。

</details>

3. 实测里,按「每分钟 60 个请求」和「每分钟 10 万 token」限流,同一份流量放行了多少?说明什么?

<details><summary>答案</summary>

流量是 60 个 1,500 token 的小请求加 6 个 60,000 token 的长请求。按请求数限流全部放行,合计 45 万 token;按 token 限流,小请求全放行(9 万),长请求只放行 1 个(6 万),合计 15 万。说明请求数不反映真实的成本和算力消耗,一个长请求可能抵 40 个小请求,保护预算和供应商额度要按 token。

</details>

4. 令牌桶里,一个请求比整个桶还大会怎样?欠了账(余额为负)会怎样?

<details><summary>答案</summary>

比整个桶还大的请求,`try_take` 返回「等 inf 秒」,表示无论等多久都拿不到,应该直接拒绝并告诉调用方这个请求本身超限,不是稍后重试的问题。余额为负表示预扣少了、事后补扣造成的欠账,后面的请求要先等欠账还清:余额 −5,000、每秒补 1,000 时,再要 1,000 要等 (1,000 + 5,000) ÷ 1,000 = 6 秒。

</details>

5. 预扣加结算是怎么做的?为什么估算宁可偏宽,以及偏宽的代价?

<details><summary>答案</summary>

请求进来时按「估的输入 token + `max_tokens`」从桶里预扣;拿到响应后按 `usage` 的真实值结算,多了还回去,少了补扣(余额可以变负)。偏宽是因为预扣多了结算时会还,预扣少了请求已经放行,补扣只能欠账。代价是预扣太宽时桶的有效容量变小,正常请求会被误拒。实测 5 个请求预扣 1,642、实际 431,不结算桶里会少 1,211。

</details>

6. (面试题)让你设计一个公司内部的 LLM 网关,你会先做哪些?买还是写?限流具体怎么做?

<details><summary>答案</summary>

先做鉴权(虚拟 key)、成本归因、限流、降级这四件,因为它们是平台化的直接收益。买还是写:先用现成的(比如 LiteLLM 这类),把公司特有的逻辑做成插件或旁路服务,比如让网关把用量事件推到队列,另一个服务消费后对接财务;除非计费、路由、合规的规则现成方案改不动才自研。选之前看最近的发版和维护状态,锁精确版本,网关机器上不放无关凭证。限流:主维度按 token,用令牌桶,请求进来时按「估算输入 + `max_tokens`」预扣,响应后按真实 `usage` 结算;多实例时桶的状态放 Redis,补水判断扣减用一段 Lua 在服务端一步完成;限流回 429 带 `Retry-After`;同时对供应商那一侧的限制类型(RPM、TPM、并发)设自己的「别撞墙」上限;Redis 挂了的行为(放过还是拒绝)要明确写下来。

</details>

## 明天预告

明天是 Day 587 · 第 84 周复习:进阶(Day 581–586)。这一周从给 Agent 设计奖励、训练分诊小模型,走到平台的租户、隔离、控制面数据面,再到今天的模型网关。复习日会把六天的知识放进一张地图,把踩过的坑列成一张清单,再做一个只用本周知识的小练习。Day 588 回来继续把今天的透传网关长成一个带预算、降级、成本归因的最小网关,并且给它写测试。
