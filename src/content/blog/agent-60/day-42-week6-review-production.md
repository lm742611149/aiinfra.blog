---
title: 'Day 42 · W6 复习 + 生产化清单:把工单 Agent 部署成公网服务'
description: 'W6 收尾:一张图串起六天的内容,一份按「接口、可靠性、成本、安全、运维」分组的上线检查清单,整合后的完整代码和一个能对公网地址跑的冒烟与压测脚本,一次故障演练,再加本周面试题和踩坑清单。'
pubDate: 2026-10-12
regime: none
tags: ['review', 'production', 'checklist', 'load-test', 'game-day', 'agent-60']
series: 'agent-60'
day: 42
lang: 'zh'
---

## 今天要解决的问题

六天前,工单 Agent 还是一个在终端里跑的脚本。现在它有了流式接口、会话管理、任务队列、幂等的退款工具、成本统计、两层安全加固、Docker 部署和自动化流水线。东西多了,很容易每样都做了一点、哪样都没收尾。

今天不学新东西,做四件事:

1. 用一张图把六天的内容串起来,确认每个模块在请求路径上的位置,讲得出它们之间的依赖。
2. 对照上线检查清单逐项过一遍你的服务,把没做完的补上,或者明确写进「已知限制」。
3. 把这一周散落在各天的代码整合成一个能跑的版本,用冒烟脚本和小规模压测对着公网地址验证。
4. 做一次故障演练:故意弄坏几个组件,看系统的反应是否符合你的设计。

最后过一遍本周的面试题和坑。预计用时 5–7 小时,故障演练那部分别跳过,它是这一周最能暴露问题的环节。

## 一张图看完 W6

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="W6 全景:一条请求从用户进入 Caddy,经 FastAPI 的鉴权、会话锁、脱敏、注入标记,进入 LangGraph,工具调用经过 guard 和幂等,结果经输出净化以 SSE 返回;旁路有任务队列、成本记录、审计日志">
<text x="20" y="22" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">请求路径(从左到右)与每一站对应的 Day</text>
<rect x="20" y="40" width="70" height="56" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="55" y="64" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Caddy</text>
<text x="55" y="82" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">D41 HTTPS</text>
<rect x="100" y="40" width="90" height="56" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="145" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">FastAPI</text>
<text x="145" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">D36 鉴权·锁</text>
<text x="145" y="89" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">超时·SSE</text>
<rect x="200" y="40" width="90" height="56" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="245" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">输入处理</text>
<text x="245" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">D40 脱敏</text>
<text x="245" y="89" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">D39 fence</text>
<rect x="300" y="40" width="110" height="56" rx="5" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="355" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">LangGraph</text>
<text x="355" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">D38 路由·缓存</text>
<text x="355" y="89" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">checkpoint</text>
<rect x="420" y="40" width="100" height="56" rx="5" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="470" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">工具层</text>
<text x="470" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">D40 guard</text>
<text x="470" y="89" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">D37 幂等·超时</text>
<rect x="530" y="40" width="90" height="56" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="575" y="60" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">输出处理</text>
<text x="575" y="76" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">D39 净化</text>
<text x="575" y="89" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">→ SSE</text>
<line x1="90" y1="68" x2="100" y2="68" stroke="var(--ink-soft)"/>
<line x1="190" y1="68" x2="200" y2="68" stroke="var(--ink-soft)"/>
<line x1="290" y1="68" x2="300" y2="68" stroke="var(--ink-soft)"/>
<line x1="410" y1="68" x2="420" y2="68" stroke="var(--ink-soft)"/>
<line x1="520" y1="68" x2="530" y2="68" stroke="var(--ink-soft)"/>
<text x="20" y="136" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">旁路</text>
<rect x="20" y="150" width="180" height="50" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="110" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">webhook → arq 队列</text>
<text x="110" y="189" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">D37 批量·重试·续跑</text>
<rect x="220" y="150" width="180" height="50" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="310" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">成本记录 + Langfuse</text>
<text x="310" y="189" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">D38 · D34</text>
<rect x="420" y="150" width="200" height="50" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="520" y="172" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">审计日志(只追加)</text>
<text x="520" y="189" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">D40</text>
<text x="20" y="236" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">底座</text>
<rect x="20" y="250" width="600" height="50" rx="5" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="320" y="272" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">Docker Compose · 最小权限数据库账号 · 密钥在 .env · CI/CD · 每日备份</text>
<text x="320" y="289" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--ink-faint)">D41 · D40</text>
<text x="20" y="322" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">蓝色 = 模型侧,琥珀 = 外部系统侧;每一站都要能回答「它坏了会怎样」</text>
</svg>
<figcaption>W6 的全部内容放在一条请求路径上。上面一行是每个请求都会经过的,中间是旁路,下面是所有东西运行的底座。复习时对着这张图,随便指一个方框,都应该能说出它解决什么问题、坏了会发生什么。</figcaption>
</figure>

画这张图的目的,是让你在面试时被问「你的 Agent 系统是怎么设计的」时,脑子里有一个清楚的骨架。不要从「我用了 LangGraph」开始讲,而是从「一个请求进来会经过这几站」开始讲,每一站说一句它防的是什么。这样讲五分钟,面试官就知道你做过真东西。

## 上线前检查清单

下面这份清单是我按「如果这一项没做,上线后第一周大概率会出什么事」来排的。每一项后面写了它对应的 Day,忘了怎么做就回去看。逐项过一遍,做了的打勾,没做的要么今天补上,要么写进 README 的「已知限制」。写进已知限制不丢人,面试官看到你清楚地知道系统的边界,反而是加分项。

### 接口与会话

- [ ] 流式接口经过反向代理后仍是逐字输出,在手机 4G 网络下也验证过(Day 36、41)
- [ ] 同一会话并发请求被拒(收到 busy 错误事件);多进程部署时用的是跨进程锁(Day 36)
- [ ] 单轮有超时,超时后前端收到可读的错误事件而不是断连(Day 36)
- [ ] 客户端中途断开不会损坏会话,重新打开能看到已完成的部分(Day 36)
- [ ] 访问别人的会话返回 404,不泄露会话是否存在(Day 36)
- [ ] 用户单条消息有长度上限(Day 36)

### 可靠性

- [ ] webhook 只入队不处理,用工单 id 做 job id 去重(Day 37)
- [ ] 所有写操作工具都有业务幂等键和数据库唯一约束(Day 37)
- [ ] 重试只在 SDK 层和队列层,总次数乘起来有上限,带抖动(Day 37)
- [ ] 模型调用、工具调用、单轮、单任务各有超时,内层短于外层(Day 37)
- [ ] worker 崩溃后任务能从 checkpoint 续跑,`durability` 设对了(Day 37)
- [ ] 重试耗尽的任务进入「需人工」状态并有通知,不会无声消失(Day 37)

### 成本与性能

- [ ] 每次模型调用都记录了 token、缓存命中和花费,能按工单汇总(Day 38)
- [ ] prompt 前缀里没有会变的内容,缓存命中率有监控(Day 38)
- [ ] 每个节点用哪个模型有评测数据支撑(Day 38)
- [ ] 无依赖的步骤并行执行(Day 38)
- [ ] 有全局并发闸门,不会把上游打出大面积 429(Day 36、37)
- [ ] 每客户每日 token 预算和单轮步数上限(Day 40 的 LLM10)
- [ ] 算过 Agent 对比人工的 ROI,知道盈亏平衡的工单量(Day 38)

### 安全

- [ ] 客户身份从登录态注入工具,工具参数里没有可被模型篡改的身份字段(Day 39)
- [ ] 工具分级,L3 不注册,L2 必须人工审批,审批面板展示数据库里的结构化字段(Day 40)
- [ ] 业务规则(退款金额、次数)在工具代码里校验(Day 39)
- [ ] 不可信内容用随机边界标记;回复去掉外部图片和非白名单链接(Day 39)
- [ ] 注入测试集在 CI 里,确定性防御覆盖的用例次次通过(Day 39)
- [ ] 数据库账号最小权限,应用不用超级用户(Day 40)
- [ ] 手机号、身份证、银行卡在进模型前脱敏,trace 里看不到原文(Day 40)
- [ ] 审计日志只追加,包含被拒绝的调用(Day 40)
- [ ] system prompt 里没有任何密钥和敏感规则(Day 39)

### 部署与运维

- [ ] 镜像非 root 运行,镜像和 git 历史里没有密钥(Day 41)
- [ ] 公网只开 80/443/22,数据库和 Redis 不对外(Day 41)
- [ ] 健康检查检查了数据库,但不调模型 API(Day 41)
- [ ] 数据库迁移在应用启动前自动执行且可重复执行(Day 41)
- [ ] 每日备份,异地存放,做过一次恢复演练(Day 41)
- [ ] 推代码自动测试和部署,知道怎么手动回滚到上一个镜像(Day 41)
- [ ] 公开 demo 有防滥用措施:演示账号、限流、每日额度上限

最后一条前面没细讲,这里补一句。你把 demo 地址放在简历上,就等于公开了一个会花你钱的接口。最简单的保护是三件事:不开放注册,只给几个固定的演示客户账号;按 IP 限流(Caddy 有限流插件,或者在 FastAPI 里用 slowapi 之类的库);全局每日 token 预算,超了就返回「今天的演示额度已用完」。另外在模型厂商后台设置月度消费上限,这是最后一道保险。

## 整合后的代码

一周下来,`w6` 目录大概长这样:

```text
agent-60-lab/
├── compose.yaml
├── Dockerfile
├── .dockerignore
├── .env.example
├── .github/workflows/deploy.yml
├── deploy/Caddyfile
├── w4/ticket_agent.py            # build_graph(checkpointer):W4 的工作流
└── w6/
    ├── app/
    │   ├── config.py             # D36
    │   ├── events.py             # D36
    │   ├── agent_adapter.py      # D36,今天接入脱敏与净化
    │   ├── sessions.py           # D36
    │   ├── main.py               # D36 + D37 + D41
    │   ├── llm.py                # D37 SDK 超时与重试
    │   ├── retry.py              # D37
    │   ├── jobs.py               # D37
    │   ├── tool_guard.py         # D37 工具超时外壳
    │   ├── tools_refund.py       # D37 幂等退款
    │   ├── refund_policy.py      # D39 业务规则
    │   ├── tools_scoped.py       # D39 身份从 config 来
    │   ├── fence.py              # D39
    │   ├── sanitize.py           # D39
    │   ├── cost.py               # D38
    │   ├── routing.py            # D38
    │   ├── parallel_tools.py     # D38
    │   ├── tool_registry.py      # D40
    │   ├── pii.py                # D40
    │   └── sandbox_docker.py     # D40(工单 Agent 用不到,留作工具库)
    ├── sql/001_sessions.sql … 004_audit.sql
    ├── evals/injection_cases.yaml, test_injection.py
    ├── scripts/smoke.py, loadtest.py
    └── static/index.html
```

前几天各自写的模块,有两处需要今天接起来。

第一处是**脱敏和净化接进适配层**。Day 36 的适配层直接把用户消息喂给图、直接把 token 推给前端。现在要在入口脱敏、在出口净化。脱敏的映射表要跟着会话走,存在图的状态里,这样多轮对话里同一个手机号始终是同一个占位符,工具执行时也能还原。

```python
# agent-60-lab/w6/app/agent_adapter.py(在 Day 36 版本上修改的部分)
from .fence import fence
from .pii import Redactor
from .sanitize import sanitize_reply


async def _load_redactor(graph, config) -> Redactor:
    snap = await graph.aget_state(config)
    mapping = (snap.values or {}).get("pii_map", {}) if snap else {}
    r = Redactor()
    r.mapping.update(mapping)
    for tok in mapping:                       # 恢复计数器,避免新占位符和旧的重名
        kind = tok.strip("<>").rsplit("_", 1)[0]
        r._counter[kind] = r._counter.get(kind, 0) + 1
    return r


async def stream_turn(graph, thread_id: str, customer_id: str, text: str):
    config = {"configurable": {"thread_id": thread_id, "customer_id": customer_id}}
    redactor = await _load_redactor(graph, config)
    safe_text = fence(redactor.redact(text), source="customer_message")
    # pii_map 写进状态:W4 的 State 里要加一个 pii_map: dict[str, str] 字段
    graph_input = {"messages": [("user", safe_text)], "pii_map": redactor.mapping}

    buffer: list[str] = []
    async for ev in _drive(graph, graph_input, config):
        if ev.type == "token":
            buffer.append(ev.data["text"])
        if ev.type == "done":
            # 流式已经推出去的 token 无法收回,所以前端也要做同样的过滤(见 Day 39);
            # 这里对完整回复再净化一遍,结果作为 final_text 给前端替换显示,并记录被移除的 URL。
            clean, removed = sanitize_reply("".join(buffer))
            ev.data["final_text"] = clean
            ev.data["removed_urls"] = removed
        yield ev
```

前端收到 `done` 事件里的 `final_text` 后,用它替换掉流式拼出来的那段文字。正常回复里两者完全一样,用户感觉不到;出现可疑链接时,链接会在回复结束的瞬间消失。配合前端渲染时本来就不加载外部图片,这条外泄通道就堵上了。

第二处是 **`main.py` 的生命周期**。Day 36 用 `lifespan` 管数据库连接池和 checkpointer,Day 37 为了看得清楚用了 `on_event` 加 arq 连接,Day 41 加了健康检查。合并成一个:

```python
# agent-60-lab/w6/app/main.py(lifespan 合并后)
from arq import create_pool
from arq.connections import RedisSettings


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = AsyncConnectionPool(settings.database_url, open=False, kwargs={"autocommit": True})
    await pool.open()
    app.state.arq = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    async with AsyncPostgresSaver.from_conn_string(settings.database_url) as saver:
        await saver.setup()
        app.state.graph = build_graph(checkpointer=saver)
        app.state.sessions = SessionStore(pool)
        try:
            yield
        finally:
            await app.state.arq.close()
            await pool.close()
```

`config.py` 里补一个 `redis_url: str = "redis://localhost:6379"`。

### 冒烟脚本

每次部署完,跑一个脚本确认核心路径是通的。它对公网地址发起一次完整对话,解析 SSE 事件,检查有没有 `done`:

```python
# agent-60-lab/w6/scripts/smoke.py
"""用法:uv run python w6/scripts/smoke.py https://support.your-domain.com cus_1001"""
import asyncio
import json
import sys
import time

import httpx


async def read_events(resp: httpx.Response):
    buf = ""
    async for chunk in resp.aiter_text():
        buf += chunk
        while "\n\n" in buf:
            raw, buf = buf.split("\n\n", 1)
            ev, data = "message", ""
            for line in raw.splitlines():
                if line.startswith("event:"):
                    ev = line[6:].strip()
                elif line.startswith("data:"):
                    data += line[5:].strip()
            if data:
                yield ev, json.loads(data)


async def one_turn(client: httpx.AsyncClient, base: str, customer: str, text: str) -> dict:
    h = {"X-Demo-Customer": customer}
    sid = (await client.post(f"{base}/api/sessions", headers=h)).json()["session_id"]
    t0 = time.monotonic()
    first_token = None
    kinds: list[str] = []
    async with client.stream("POST", f"{base}/api/sessions/{sid}/messages", headers=h, json={"text": text}) as r:
        r.raise_for_status()
        async for ev, data in read_events(r):
            kinds.append(ev)
            if ev == "token" and first_token is None:
                first_token = time.monotonic() - t0
            if ev in ("done", "error"):
                break
    return {"sid": sid, "ttft": first_token, "total": time.monotonic() - t0, "events": kinds}


async def main():
    base, customer = sys.argv[1].rstrip("/"), sys.argv[2]
    async with httpx.AsyncClient(timeout=httpx.Timeout(10, read=150)) as client:
        assert (await client.get(f"{base}/healthz")).json()["ok"]
        res = await one_turn(client, base, customer, "你们的退款政策是什么?")
    print(json.dumps(res, ensure_ascii=False, indent=2))
    assert "done" in res["events"], "没有收到 done 事件"
    assert "token" in res["events"], "没有收到任何 token,流式可能被缓冲了"
    print("SMOKE OK")


if __name__ == "__main__":
    asyncio.run(main())
```

这个脚本可以直接加到 Day 41 的 GitHub Actions 里,作为部署后的最后一步。部署成功但冒烟失败,就该报警或者回滚。

### 小规模压测

上线前想知道:同时有 20 个人在用,首字延迟会变成多少?会不会出现 429?

```python
# agent-60-lab/w6/scripts/loadtest.py
"""用法:uv run python w6/scripts/loadtest.py https://support.your-domain.com 20
注意:每个并发会话都会真实调用模型,20 个会话按 Day 38 的估算约花几毛钱人民币。"""
import asyncio
import statistics
import sys

import httpx

from smoke import one_turn   # 同目录

QUESTIONS = ["你们的退款政策是什么?", "怎么导出年度账单?", "发票抬头可以改吗?", "订阅怎么暂停?"]


async def main():
    base, n = sys.argv[1].rstrip("/"), int(sys.argv[2])
    async with httpx.AsyncClient(timeout=httpx.Timeout(10, read=180)) as client:
        tasks = [one_turn(client, base, f"cus_{1001 + i % 5}", QUESTIONS[i % len(QUESTIONS)]) for i in range(n)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
    ok = [r for r in results if isinstance(r, dict) and "done" in r["events"]]
    errors = [r for r in results if not (isinstance(r, dict) and "done" in r["events"])]
    ttfts = sorted(r["ttft"] for r in ok if r["ttft"] is not None)
    totals = sorted(r["total"] for r in ok)

    def p(xs, q):
        return xs[min(len(xs) - 1, int(len(xs) * q))] if xs else float("nan")

    print(f"并发 {n}:成功 {len(ok)},失败 {len(errors)}")
    print(f"首字延迟 P50 {p(ttfts, .5):.2f}s  P95 {p(ttfts, .95):.2f}s")
    print(f"总时长   P50 {p(totals, .5):.2f}s  P95 {p(totals, .95):.2f}s  均值 {statistics.mean(totals) if totals else float('nan'):.2f}s")
    for e in errors[:5]:
        print("  失败样例:", e if isinstance(e, Exception) else e["events"][-3:])


if __name__ == "__main__":
    asyncio.run(main())
```

演示账号用了五个客户轮换,因为同一个客户的会话都是独立的,不会触发会话锁。这不是严格意义上的压测(严格的压测要用 Locust、k6 之类的工具,持续施压并观察系统指标),但对一个个人项目来说,它能回答最关心的问题:并发上来以后体验退化多少、瓶颈在不在自己这边。

如果 P95 首字延迟远高于 P50,通常有三种原因:上游模型 API 排队或 429 重试;你的全局并发闸门在排队;事件循环被某个同步调用阻塞了。分别看模型调用的日志、闸门的等待时间和 asyncio debug 输出,就能分辨出来。

## 故障演练

软件工程里有个说法叫 game day:在可控的时间,故意把系统弄坏,看它的反应是否和设计一致。你这一周写了很多「如果 X 挂了,系统会 Y」,今天去验证。

每一项先写下**你预期会发生什么**,再动手,再记录实际发生了什么。预期和实际不一致的地方,就是你这一周理解有偏差、或者代码有 bug 的地方。

| 演练 | 怎么做 | 预期 | 实际 |
| --- | --- | --- | --- |
| worker 崩溃 | 跑批量任务时 `docker compose kill worker`,再 `up -d worker` | 任务重投,从 checkpoint 续跑,无重复退款 | |
| 数据库短暂不可用 | 对话进行中 `docker compose stop postgres`,30 秒后 `start` | 当前轮报错并返回可读错误;健康检查变红;恢复后新对话正常 | |
| Redis 不可用 | `docker compose stop redis` 后调 webhook | webhook 返回 5xx,工单系统会重发;恢复后正常 | |
| 模型 API key 失效 | 把 `.env` 里的 key 改错,重启 api | 对话返回错误事件,不重试(401 是永久错误);日志有明确报错 | |
| 上游 429 | 把全局并发闸门调到 100,跑 30 并发压测 | 出现 429,SDK 退避重试,部分请求变慢但不雪崩 | |
| 注入攻击 | 用 Day 39 的 8 条用例打公网地址 | 确定性防御的用例全部挡住 | |
| 磁盘写满(可选) | 用 `fallocate` 占满磁盘 | Postgres 写失败,服务报错;清理后恢复 | |

做完以后,把「实际」一列和「预期」不一致的地方整理成一段话,写进项目 README 的「可靠性」一节。比如:「worker 崩溃后任务会在 job_timeout(300 秒)后才重新投递,期间工单处于处理中状态,这是 arq 的设计,已知限制。」这种具体到数字的描述,是面试里最有说服力的素材。

我自己第一次做这类演练时,发现的问题几乎都不在我以为的地方。印象最深的一次是数据库恢复以后,连接池里还留着断掉的旧连接,接下来几分钟的请求随机失败。解决办法是给连接池配上连接检查(psycopg_pool 的 `check` 参数可以在借出连接前验证它是否可用)。这种问题不做演练是发现不了的。

## W6 面试题汇总

下面是这一周可能被问到的问题,按主题分组。每题先自己用一两分钟口头回答,再回到对应的 Day 对照。自测部分挑了 6 道带参考答案的,其余的答案要点都在对应的正文里。

**服务化**:为什么 Agent 接口用 SSE?流式接口在 Nginx 后面变成一次性返回怎么排查?同一个会话并发请求怎么处理?用户关掉页面时服务端发生了什么?一个 FastAPI 进程能同时挂多少个流式连接,瓶颈在哪?

**可靠性**:什么样的任务要放进队列?至少执行一次和恰好执行一次的区别?幂等键怎么设计,为什么不能用随机 uuid?重试应该放在哪一层?worker 崩溃后怎么续跑?Temporal 和任务队列的区别?

**成本**:一张工单的成本怎么算?prompt caching 的原理和让它命中的条件?怎么决定一个节点用哪个模型?语义缓存适合客服场景吗?Agent 对比人工的 ROI 怎么算,哪个变量最敏感?

**安全**:什么是间接注入,举一个你系统里的例子?致命三要素是什么?你的四层防御里哪层是确定性的?工具权限怎么分级?模型生成的代码怎么安全执行?海外模型和个人信息出境?

**部署**:Dockerfile 怎么写才能构建快?密钥怎么管理?国内部署要注意什么?CI/CD 流程是怎样的?什么时候值得自部署开源模型?

能把这 25 个问题都答上来,W6 就算过关了。答不上来的,记在下面的坑清单里,下周复习时再看一遍。

## 本周坑清单

这是我自己和身边人在做这类系统时真实踩过的坑,按出现频率排:

1. **流式在本地好好的,上线后变成一次性输出。** 罪魁祸首是代理缓冲或 gzip 中间件。用 `curl -N` 分别直连应用和经过代理测一遍,马上定位。
2. **在 async 函数里调用了同步库。** `requests`、同步数据库驱动、`time.sleep`。单个请求测不出来,并发一上来所有请求一起卡。
3. **工具里的写操作没有幂等。** 平时没事,一次网络抖动加重试,客户收到两封邮件或者两笔退款。
4. **三层重试叠加。** 上游一出问题,自己的服务把它打得更死。
5. **system prompt 开头有时间戳。** 缓存命中率接近零,账单翻倍,还不知道为什么。
6. **工具参数里有 customer_id。** 最常见也最危险的越权漏洞。
7. **Postgres 端口映射到了公网。** 弱密码加公网端口,几小时就会被扫。
8. **`.env` 被打进镜像或提交到 git。** 删文件没用,要作废 key。
9. **健康检查只返回 200。** 数据库挂了它还说健康,负载均衡继续往坏实例上打流量。
10. **从没恢复过备份。** 要用的时候才发现备份脚本几个月前就在报错。

## 动手练习

1. 打印上面的检查清单,逐项过你的服务。没做的项,要么补上,要么写进 README 的「已知限制」并说明原因。
2. 按「整合后的代码」一节,把脱敏、净化接进适配层,合并 `lifespan`。重新部署。
3. 对公网地址跑 `smoke.py`,通过后把它加进 GitHub Actions 的部署步骤后面。
4. 分别用 5、10、20 并发跑 `loadtest.py`,填下表。
5. 做故障演练表里至少前 6 项,先写预期再动手。
6. 口头回答面试题汇总里的 25 个问题,录音或者讲给朋友听。答不流畅的标出来。

| 并发 | 成功/总数 | 首字 P50 | 首字 P95 | 总时长 P50 | 总时长 P95 | 429 次数 |
| --- | --- | --- | --- | --- | --- | --- |
| 5 | | | | | | |
| 10 | | | | | | |
| 20 | | | | | | |

**验收标准**:检查清单每一项要么打勾、要么在已知限制里有说明;冒烟脚本在 CI 里自动运行;压测表填满,能解释 P95 和 P50 的差距从哪来;故障演练至少 6 项有预期和实际的对比,不一致的已经修复或写进 README。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 冒烟测试 | 部署后对最核心路径做的快速验证,确认系统「没冒烟」 |
| 压测 | 在并发压力下测量系统的延迟、吞吐和错误率 |
| P50 / P95 | 第 50 / 第 95 百分位数,P95 反映最慢那 5% 用户的体验 |
| game day(故障演练) | 在可控时间故意制造故障,验证系统行为和应急流程 |
| 已知限制 | 明确写出系统目前不处理的情况和原因,是成熟工程文档的一部分 |
| 回滚 | 发现新版本有问题时,快速切回上一个可用版本 |
| 连接池健康检查 | 从池里借出连接前验证它是否还可用,避免数据库重启后旧连接导致的随机失败 |

## 常见误区

**清单上的每一项都必须做完才能上线。** 个人项目和早期产品要权衡,关键是知道自己没做什么。把未做项写进已知限制,比假装都做了诚实也更专业。

**压测结果好看就说明系统没问题。** 20 并发和 2,000 并发是不同的问题;冒烟和压测都只覆盖了你想到的路径。它们能发现问题,不能证明没有问题。

**故障演练不写预期,直接动手。** 不写预期,任何结果都显得「合理」,你就失去了发现理解偏差的机会。

**demo 地址直接挂在简历上,不加任何防护。** 有人刷一晚上,账单就是你的。限流、额度、厂商后台消费上限三件事都要做。

**复习时重新读一遍文章就算复习了。** 能脱稿把一个请求从进入 Caddy 到返回 `done` 的每一站讲清楚,才算复习完。

## 学习资料

### 文档与文章

- [Anthropic · Building effective agents](https://www.anthropic.com/engineering/building-effective-agents):Day 13 读过。生产化一周之后再读一遍,你会对「先用最简单的方案,只在需要时增加复杂度」有完全不同的体会。30 分钟。
- [OWASP Top 10 for LLM Applications](https://genai.owasp.org/llm-top-10/):对照 Day 40 的自查表,把「状态」一列更新到最新。20 分钟。
- [psycopg_pool 文档](https://www.psycopg.org/psycopg3/docs/api/pool.html):看 `check` 参数和连接池的配置项,故障演练里数据库重启那一项会用到。15 分钟。
- [k6 文档](https://grafana.com/docs/k6/latest/):想做更正式的压测时看,它支持 SSE 等流式协议的测试脚本。了解即可。15 分钟。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1fkps6FE2m&autoplay=0&high_quality=1" title="AI Agent 生产落地实战：用可观测性与自动化评估闭环修复系统缺陷 | AI Engineer" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>量子菠萝_ · AI Agent 生产落地实战:用可观测性与自动化评估闭环修复系统缺陷 · AI Engineer 大会演讲的中文搬运,42 分钟。用一个购物 Agent 的例子演示 trace、评测和自动修复怎么形成闭环,正好把 W5 和 W6 串起来,适合复习日看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/D7_ipDqhtwk" title="How We Build Effective Agents: Barry Zhang, Anthropic" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>AI Engineer · How We Build Effective Agents: Barry Zhang, Anthropic · 15 分钟。《Building effective agents》作者之一的现场演讲,讲什么时候不该做 Agent、怎么保持简单、怎么站在模型的角度思考。做完一周生产化再听,感受会很不一样。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · 18 分钟,Anthropic 几位工程师的圆桌,聊 Agent 在生产中的常见错误和他们自己的做法。轻松的对谈形式,适合当作一周的收尾。</figcaption>
</figure>

### 书籍

- Chip Huyen《AI Engineering》(O'Reilly, 2025)第 10 章「AI Engineering Architecture and User Feedback」:Day 36 开始读的那一章,今天读完。它的架构演进顺序(上下文增强、护栏、路由与网关、缓存、Agent 模式、监控)几乎就是这一周的目录,读完你会发现自己已经把书里的架构亲手搭了一遍。1 小时。
- Betsy Beyer 等《Site Reliability Engineering》(O'Reilly, 2016,Google SRE 书,官网可免费在线阅读):挑「Testing for Reliability」和「Managing Incidents」两章。故障演练和事故处理的思路源头。中文版《SRE:Google 运维解密》(电子工业出版社)。1.5 小时。

### 开源项目与代码

- [grafana/k6](https://github.com/grafana/k6):开源压测工具,用 JavaScript 写脚本,能模拟成千上万的并发用户。
- [langchain-ai/langgraph](https://github.com/langchain-ai/langgraph) 的 examples 目录:看看官方示例里的生产化写法和你自己的有什么不同。

## 自测

1. 从用户在浏览器点「发送」到收到 `done` 事件,请求依次经过哪些组件?每一个组件防的是什么问题?

<details><summary>答案</summary>

Caddy(HTTPS、反向代理、SSE 不缓冲)→ FastAPI 路由(鉴权、会话归属检查、会话锁防并发、消息长度限制)→ 输入处理(PII 脱敏防个人信息进模型和 trace,随机边界标记不可信内容)→ LangGraph(按节点路由模型控成本,checkpoint 持久化状态防崩溃丢进度)→ 工具层(guard 做权限分级和频率限制,身份从 config 注入防越权,幂等键防重复写,超时外壳防工具卡死)→ 输出处理(净化外部链接和图片防数据外泄)→ SSE 推回前端,单轮超时保证不会无限等待。旁路记录成本和审计日志。

</details>

2. 压测时 20 并发的首字延迟 P50 是 2 秒,P95 是 14 秒。你会怎么排查?

<details><summary>答案</summary>

先看慢请求的 trace,确认时间花在哪一段。常见原因三个:上游模型 API 返回 429 后 SDK 退避重试(看模型调用日志里的状态码和重试次数);自己的全局并发闸门在排队(看闸门等待时间);事件循环被同步调用阻塞(开 asyncio debug 看慢回调)。如果是上游限流,要么降低并发、要么申请提额、要么错峰;如果是闸门,评估是否能调高;如果是阻塞,找到同步调用改成异步或放进线程。

</details>

3. 故障演练中,你停掉 Postgres 30 秒再启动,之后几分钟里请求随机失败。最可能的原因和修法?

<details><summary>答案</summary>

连接池里还保留着数据库重启前建立的连接,这些连接已经失效,借出来用就会报错,直到被逐个淘汰。修法:给连接池配置借出前的连接检查(psycopg_pool 的 `check` 参数,比如使用它提供的 `check_connection`),或者设置连接最大存活时间;同时确保应用层对这类错误返回可读的错误事件,而不是让请求挂住。

</details>

4. 为什么要在故障演练前先写下「预期」?

<details><summary>答案</summary>

不写预期,无论系统表现如何你都容易觉得「合理」,失去了检验理解的机会。先写预期,实际结果和预期不一致的地方,恰好暴露了你对系统理解的偏差或者代码里的 bug。这些不一致是演练最有价值的产出。

</details>

5. (面试题)「你这个项目上线了吗?怎么保证它稳定?」请用两分钟回答。

<details><summary>答案</summary>

参考答法:上线了,地址在简历上,单机 Docker Compose 部署,前面是 Caddy 做 HTTPS。稳定性分三块讲。一是可靠性设计:webhook 入队去重,写操作工具有业务幂等键加唯一约束,重试只在 SDK 和队列两层,LangGraph checkpoint 用同步持久化,worker 崩溃后从断点续跑,重试耗尽转人工。二是验证:部署后自动跑冒烟脚本,做过 20 并发压测,首字 P50 和 P95 分别是多少(报你的真实数字);做过故障演练,停数据库、杀 worker、作废 API key、打注入用例,发现过连接池旧连接的问题并修了。三是边界:已知限制写在 README 里,比如单机没有高可用、worker 崩溃后任务要等 job_timeout 才重投。

</details>

6. (面试题)你的公开 demo 怎么防止被人刷爆账单?

<details><summary>答案</summary>

不开放注册,只提供几个固定的演示账号;按 IP 限流;每客户每日 token 预算和单轮步数上限;全局每日 token 预算,超了返回额度用完的提示;在模型厂商后台设置月度消费上限作为最后一道保险;监控每日花费,异常时告警。

</details>

## 明天预告

Day 43 · 毕业项目开题。六周的积木都齐了:LLM 客户端、Agent 循环、RAG、MCP 工具、LangGraph 工作流、评测体系、生产化。从明天开始的 12 天,把它们组装成一个完整、可以写进简历的作品 SupportPilot。第一天先不写代码:想清楚为什么选这个题目、需求文档怎么写、架构图怎么画、12 天怎么排期、用什么指标判断做得好不好。
