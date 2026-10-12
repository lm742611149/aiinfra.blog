---
title: 'Day 104 · AgentOps(八):压测、容量规划与上线'
description: '用一个可控延迟的假上游和 Locust 压 AgentOps 网关,把网关自己的开销和上游的耗时分开量。我在本机实测出三件事:单进程五十 rps 左右就把一个核吃满;把连接池调大反而更慢;多进程部署时限流配额会翻几倍。再用利特尔定律和 DeepSeek 的账户并发上限算容量,最后给出 compose 和 K8s 两种部署和一张上线清单。'
pubDate: 2026-10-12
regime: none
tags: ['load-testing', 'locust', 'capacity-planning', 'kubernetes', 'deployment', 'agent-60']
series: 'agent-60'
day: 104
lang: 'zh'
---

## 今天要解决的问题

Day 96 的验收指标里有一条:网关额外延迟 P95 小于 30 毫秒(不含上游)。Day 97 写完网关时,所有测试都在 TestClient 里跑,一次一个请求,这条指标从来没被真正测过。今天把它测出来,顺便回答上线前必须回答的几个问题:

1. 网关自己的开销是多少?怎么在上游动辄一两秒的耗时里把它单独量出来?
2. 一个网关进程能扛多少请求?先到顶的是 CPU、连接池、数据库还是上游?
3. 平台的隔离承诺在压力下还成立吗?特别是 Day 97 自己在风险里写过的那条:多副本时限流会不会失效?
4. 按业务量算,需要几个副本、多大的连接池?真正的天花板在哪?
5. 用 compose 和 K8s 分别怎么部署,上线那天按什么顺序做?

预计用时 6–8 小时,其中压测实验占一半。前置:Day 96–97(平台骨架和网关)、Day 99(运行时 worker)、Day 103(`deploy/compose.yaml` 的 redteam profile 今天补上)。

先交代我的实验环境,后面所有数字都要带着它看:一台 2019 年的 13 寸 MacBook Pro(i7-8569U,4 核 8 线程),网关、假上游、Locust 全跑在同一台机器上,数据库用 SQLite 文件。我本机没装 Docker,所以没有用 compose 起 Postgres。这意味着绝对数字只对这台机器有意义,真正有价值的是几组实验之间的对比和背后的原因。你用 compose 起 Postgres、在云主机上跑,数字会不一样,结论的方向应该一样。

## 压网关不能打真模型

第一个决定:压测时网关的上游换成一个假服务。理由有三个。

一是钱。两百个并发用户跑一分钟,就是几千次模型调用。

二是真实上游会把网关自己的问题盖住。DeepSeek 一次非流式调用一两秒,还会因为它自己的负载忽快忽慢。网关多花 50 毫秒,淹没在上游的抖动里根本看不出来。

三是你需要控制变量。想知道「上游变慢时网关会怎样」,就得能把上游调慢;想知道「上游开始报 503 时故障切换扛不扛得住」,就得能让它报错。真实上游不听你的。

假上游是一个 OpenAI 兼容的 `/chat/completions`,延迟按对数正态分布随机,中位数和长尾都能调。它还在响应里带上自己睡了多久,压测脚本用总耗时减掉这个数,就是网关自己花的时间。这个小技巧是今天整个实验的基础。

```python
# agentops/loadtest/fake_upstream.py
"""压测用的假上游:OpenAI 兼容的 /chat/completions,延迟按对数正态分布随机。

压网关不能打真实模型:一是花钱,二是真实上游的延迟和限流会盖住网关自己的问题。
假上游让「上游有多慢」变成一个你能控制的参数。

  FAKE_P50_MS   延迟中位数,默认 1500(非流式调用一次的量级)
  FAKE_SIGMA    对数正态的 sigma,默认 0.5,越大长尾越重
  FAKE_ERROR_RATE  返回 503 的比例,默认 0
"""
import asyncio
import math
import os
import random

from fastapi import FastAPI
from fastapi.responses import JSONResponse

P50 = float(os.environ.get("FAKE_P50_MS", "1500"))
SIGMA = float(os.environ.get("FAKE_SIGMA", "0.5"))
ERR = float(os.environ.get("FAKE_ERROR_RATE", "0"))

app = FastAPI()


@app.post("/chat/completions")
async def chat(body: dict):
    delay_ms = random.lognormvariate(math.log(P50), SIGMA)
    await asyncio.sleep(delay_ms / 1000)
    if random.random() < ERR:
        return JSONResponse({"error": "overloaded"}, status_code=503)
    return {
        "id": "fake", "object": "chat.completion", "model": body.get("model"),
        "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "ok"}}],
        "usage": {"prompt_tokens": 1200, "completion_tokens": 150, "prompt_tokens_details": {"cached_tokens": 800}},
        "x_fake_delay_ms": round(delay_ms, 1),
    }
```

为什么用对数正态而不是固定延迟或均匀分布?大模型调用的耗时取决于输出长度,大部分请求集中在中位数附近,少数长回答拖出一条长尾,这个形状和对数正态很像。固定延迟会让你看不到长尾对连接池和排队的影响。

再准备三个租户。流量故意不均匀,大客户占六成:

```python
# agentops/loadtest/seed.py
"""给压测建三个租户,把 key 以环境变量的格式打印出来:uv run python loadtest/seed.py > loadtest/.keys"""
import os

from sqlalchemy import delete, insert

from agentops.config import get_settings
from agentops.db import api_keys, init_db, make_engine, tenants
from agentops.tenancy.keys import issue_key

# (租户, 档位, 每分钟请求数, 月预算) —— 压测时预算放大,别让 402 干扰结果
TENANTS = [
    ("t_big", "enterprise", 6000, 1e6),     # 大客户,占流量大头
    ("t_mid", "standard", 3000, 1e6),
    ("t_small", "free", int(os.environ.get("SMALL_RPM", "600")), 1e6),
]

s = get_settings()
engine = make_engine(s.database_url)
init_db(engine)
with engine.begin() as c:
    c.execute(delete(api_keys))
    c.execute(delete(tenants))
    for tid, tier, rpm, budget in TENANTS:
        c.execute(insert(tenants).values(id=tid, name=tid, tier=tier, rpm_limit=rpm,
                                         monthly_budget_cny=budget, allowed_models=[]))
        key = issue_key(c, tid, "loadtest", ["gateway"], s.key_pepper)
        print(f"KEY_{tid.upper()}={key}")
```

然后是 Locust 脚本。每个虚拟用户模拟一个 Agent:发一次模型调用,拿到结果后停零点五到一点五秒(Agent 在执行工具、拼下一轮上下文),再发下一次。三类租户按 6:3:1 的权重分配用户。

```python
# agentops/loadtest/locustfile.py
"""三个租户的混合流量打网关。用法见 Day 104。

每个虚拟用户模拟一个 Agent:发一次模型调用,拿到结果后「想」一会儿(处理工具结果),再发下一次。
"""
import os
import random

from locust import HttpUser, between, task

KEYS = {
    "t_big": os.environ["KEY_T_BIG"],
    "t_mid": os.environ["KEY_T_MID"],
    "t_small": os.environ["KEY_T_SMALL"],
}
FEATURES = ["ticket.classify", "ticket.draft", "kb.rewrite"]


class AgentUser(HttpUser):
    abstract = True
    wait_time = between(0.5, 1.5)        # 两次模型调用之间 Agent 在跑工具、拼上下文
    tenant = ""

    @task
    def call_model(self):
        body = {"model": "fast", "messages": [{"role": "user", "content": "帮我看看这张工单 " + "x" * random.randint(200, 2000)}]}
        headers = {"Authorization": f"Bearer {KEYS[self.tenant]}", "X-AgentOps-Feature": random.choice(FEATURES)}
        with self.client.post("/v1/chat/completions", json=body, headers=headers,
                              name=f"chat[{self.tenant}]", catch_response=True) as r:
            if r.status_code == 429:
                r.success()                    # 限流是预期行为,单独统计,不算失败
                self.environment.events.request.fire(request_type="LIMIT", name=self.tenant, response_time=0,
                                                     response_length=0, exception=None, context={})
            elif r.status_code == 200:
                # 假上游在响应里带了自己睡了多久,总耗时减掉它,就是网关自己花的时间
                upstream_ms = r.json().get("x_fake_delay_ms", 0)
                overhead = r.elapsed.total_seconds() * 1000 - upstream_ms
                self.environment.events.request.fire(request_type="OVERHEAD", name="gateway", response_time=overhead,
                                                     response_length=0, exception=None, context={})


class BigTenant(AgentUser):
    weight = 6
    tenant = "t_big"


class MidTenant(AgentUser):
    weight = 3
    tenant = "t_mid"


class SmallTenant(AgentUser):
    weight = 1
    tenant = "t_small"
```

两个统计口径要说明。429 被标成成功并单独记一类 `LIMIT`,因为限流是预期行为,把它算成失败会让失败率失去意义。`OVERHEAD` 这一类不是真实请求,是用 Locust 的事件接口额外记录的「网关开销」,这样它会和真实请求一起出现在统计表里,有 P50、P95。

跑起来:

```bash
# 终端 1:假上游
FAKE_P50_MS=1500 uv run uvicorn --app-dir loadtest fake_upstream:app --port 9100

# 终端 2:网关,上游地址指向假上游
export AGENTOPS_DATABASE_URL=sqlite+pysqlite:///lt.db AGENTOPS_KEY_PEPPER=lt-pepper
export AGENTOPS_DEEPSEEK_BASE_URL=http://127.0.0.1:9100 AGENTOPS_QWEN_BASE_URL=http://127.0.0.1:9100
export AGENTOPS_DEEPSEEK_API_KEY=fake AGENTOPS_QWEN_API_KEY=fake
uv run python loadtest/seed.py > loadtest/.keys
uv run uvicorn agentops.main:create_app --factory --port 8080

# 终端 3:压
set -a; . loadtest/.keys; set +a
cd loadtest && uv run locust -f locustfile.py --headless -u 80 -r 20 -t 45s \
  -H http://127.0.0.1:8080 --only-summary --csv /tmp/lt_80
```

## 冒烟:先确认请求真的走到了上游

上面那几个 `API_KEY=fake` 不能省。假上游不校验 key,但网关会:Day 97 在启动时检查每家上游有没有配 key,没配的不注册,启动日志里会有一行 `upstream deepseek disabled: AGENTOPS_DEEPSEEK_API_KEY is not set`,请求打到 fast 路由会直接拿到 503,错误信息指向 `AGENTOPS_*_API_KEY`。

正式压之前先发一个请求、看一眼网关的启动日志,这一步花不了一分钟,但能省掉很多冤枉的压测。压测脚本把非 200 都当失败统计,如果配置漏了,你会看到一张失败率 100% 的报告,然后开始怀疑网关扛不住。冒烟时要确认三件事:状态码是 200;响应头 `X-AgentOps-Provider` 是你以为的那家;`usage` 表里多了一行 `ok`。

这也是 Day 97 把「缺 key」和「本地拼坏的请求」单独处理的原因。没有那两处处理的话,空 key 会拼出 `Authorization: Bearer ` 这样一个非法的请求头,httpx 在本地就抛 `LocalProtocolError`;它是 `TransportError` 的子类,如果按「传输错误都可以重试」处理,网关会从 deepseek 切到 qwen,qwen 的 key 也是空的,最后回一个 `502 all upstreams failed`。生产上这长得和供应商故障一模一样,值班的人会先去翻供应商的状态页。压测和冒烟的价值之一,就是在上线前把这种「报错信息指错方向」的问题逼出来:你故意少配一个变量跑一次,看网关给出的错误能不能让一个不了解系统的人在一分钟内找到原因。做不到,就是错误处理还要改。

## 第一组结果:单进程

假上游中位数 1500 毫秒,网关单进程,用户数从 20 加到 200。

| 并发用户 | 实际吞吐(请求/秒) | 网关开销 P50 | 网关开销 P95 | 端到端 P95 |
| --- | --- | --- | --- | --- |
| 20 | 7.5 | 16 ms | 140 ms | 3.3–4.2 s |
| 80 | 28.6 | 14 ms | 83 ms | 3.2–3.7 s |
| 200 | 41–52 | 900–1800 ms | 1.5–3.2 s | 4.3–5.5 s |

前两行看起来不错,P50 十几毫秒,但 P95 已经是 Day 96 定的 30 毫秒目标的三到五倍。200 用户那一行是崩了:网关开销从十几毫秒涨到一秒以上,吞吐停在四五十。200 用户这一行我跑了好几次,数字在一个范围里晃,所以写的是区间。

怎么判断「崩了」?算一下应该有的吞吐。每个虚拟用户一轮的时间是:上游耗时(对数正态,中位数 1.5 秒,均值约 1.7 秒)加上思考时间(均值 1 秒)加上网关开销。200 个用户,每轮约 2.7 秒,理论上能发出大约 200 ÷ 2.7 ≈ 74 个请求每秒。实际只有四五十,差出来的部分全变成了排队,排队时间算在网关开销里。

谁先到顶?我在 200 用户跑着的时候采了几次各进程的 CPU:

| 进程 | CPU |
| --- | --- |
| 网关(uvicorn,单进程) | 74%–100% |
| 假上游 | 4%–15% |
| Locust | 5%–12% |

网关进程把一个核吃满了,另外两个都很闲。这一步很关键:压测时一定要确认压测工具本身和假上游不是瓶颈,否则你量到的是它们的极限,不是被测系统的。Locust 在自己 CPU 超过 90% 时会打警告,看到了就要用 `--processes` 开多进程,或者换一台机器压。

所以第一个结论:**这台机器上,网关单进程大约四五十请求每秒就吃满一个核**。Python 的异步能让一个进程同时挂着几百个等上游的请求,但每个请求在网关里实打实要花的 CPU 是省不掉的,一个进程只能用一个核。

## 第二组:把连接池调大,反而更慢

看到吞吐卡住,很多人的第一反应是去调连接池。Day 97 的 `OpenAICompatProvider` 用的是 httpx 默认的连接池,上限 100 个连接(httpx 文档写的默认值,我也在 0.28.1 上确认过)。200 个用户、每个请求在上游待 1.7 秒,同时挂在上游的请求理论上会超过 100,听起来连接池就是瓶颈。

为了排除数据增长的干扰,下面几组每次都删库重建、重新造租户,200 用户跑 50 秒。为了看清 Day 97 把数据库调用放进线程池这个决定到底值多少,A、B、D、E 用的是把数据库调用改回直接写在 async 路由里的对照版本,C 是 Day 97 现在的写法。上面「第一组」的单进程数据也是在对照版本上量的:

| 实验 | 改了什么 | 吞吐 | 网关开销 P50 | 网关开销 P95 |
| --- | --- | --- | --- | --- |
| A | 对照版本,连接池上限 100 | 52 | 900 ms | 1500 ms |
| B | 连接池上限调到 500 | 28.8 | 4300 ms | 7100 ms |
| C | 两次数据库操作在线程池里(Day 97 的写法) | 38.9 | 830 ms | 4600 ms |
| D | 去掉记账(只为定位,不能上线) | 45.6 | 1400 ms | 2200 ms |
| E | 对照版本,4 个 worker 进程 | 67.6 | 34 ms | 550 ms |

B 是最有意思的一组。连接池调大五倍,吞吐掉了一半,开销翻了几倍。原因是连接池上限其实在充当背压:上限 100 时,第 101 个请求在 httpx 里排队等连接,不会去抢事件循环;上限放开以后,两百个请求全部同时在跑,每个都要在已经吃满的那个核上分时间片,大家一起变慢,调度开销还更大。**瓶颈在 CPU,不在连接池,调连接池只是把排队的地方从池子挪到了 CPU 上。**

C 对比的是「同步数据库调用直接写在 async 路由里」和「放进线程池」。Day 97 选了线程池,理由是隔离:同步调用写在事件循环上,一次慢查询会让所有在途请求一起等。压测结果是,在 SQLite 上线程池并没有让吞吐变高,P50 差不多,P95 反而更差。原因是 SQLite 文件库的写入本来就是串行的,多个线程同时写只是在文件锁上排队,线程池也没能多给它一个核。

这个结果不是说线程池选错了,而是说清楚了它买的是什么:它买的是「数据库慢的时候别拖垮整个进程」,不是速度。要看出它的价值,得换一种压法:在数据库那一侧人为加延迟(比如在 `month_spend` 里插一个 200 毫秒的 sleep 模拟锁等待),一边压一边看健康检查 `/healthz` 的延迟。按原理,对照版本里 `/healthz` 应该跟着一起变慢,因为事件循环被同步调用占住了,连分发请求都轮不上;线程池版本里它不该受影响。这组我没有跑,留给你做:把两个版本各压一次,`/healthz` 的 P95 填进你自己的记录里,和这个预期对一对。怀疑「事件循环被卡住」的时候,还有一个更直接的信号:开 `PYTHONASYNCIODEBUG=1`,asyncio 会对执行超过 100 毫秒的回调打警告,能直接告诉你是哪一行卡住了循环。

D 是为了定位:把记账整个去掉,看还剩多少。吞吐和 A 差不多,在噪声范围里。说明在这台机器上,单进程到顶主要不是记账造成的,而是每个请求在 HTTP 解析、鉴权、JSON 编解码、转发上的 CPU 加起来就这么多。

这几组之间 20% 以内的差别我不当回事,同一台机器、同一个配置,连跑两次就能差这么多。能确定的结论只有大的那几条:B 明显更差,E 明显更好。

E 解决了问题:同样是单机,开 4 个进程,吞吐涨到 67.6,接近前面算的理论值 74,开销 P50 回到 34 毫秒。剩下那点差距,一部分是 P95 的 550 毫秒排队,一部分是这台四核机器上还同时跑着 Locust 和假上游。

## 剖析:一个请求的 CPU 花在哪

知道了是 CPU 瓶颈,下一步是看 CPU 花在哪。我用 cProfile 在进程内跑了 1000 次请求(TestClient 加 Day 97 的 `FakeProvider`,SQLite 内存库),只看网关自己的函数:

| 函数 | 每次请求累计 CPU |
| --- | --- |
| `chat_completions` 整个路由函数 | 约 2.3 ms |
| 其中 `ledger.month_spend`(查本月花费) | 约 1.1 ms |
| 其中 `ledger.record`(写 usage) | 约 1.0 ms |
| `deps.tenant` 依赖(解析 key,查库) | 约 1.1 ms |

剖析器本身会让数字偏大,TestClient 的开销也没算进来,所以只看比例:网关自己的代码每个请求三毫秒多一点,其中三次数据库操作占了三分之二。剩下的 CPU 花在框架和 HTTP 上,单进程四五十请求每秒、每个请求二十毫秒出头的 CPU,大头在 uvicorn 解析请求、httpx 发请求和收响应、JSON 序列化这些地方。

这给出了优化的顺序,也给出了不该做什么:

- **key 解析加缓存**。同一把 key 每秒被解析几十次,每次都查库、算 HMAC。缓存 30 秒能省掉绝大部分。代价是吊销一把 key 后,最长 30 秒内还能用。这个代价要写进文档,也可以让吊销操作顺带广播一个失效通知。
- **本月花费改成增量**。Day 97 自己说过这个改法:在内存里维护每个租户本月累计,记账时加上,定期和库对账。多进程下每个进程各记各的会有误差,所以只用它做快速判断,接近预算时再查库确认。
- **usage 批量写**。每个请求写一行改成攒一批再写,能省很多事务开销。代价是进程崩溃会丢最后一批的记账,对一个按 2% 误差对账的系统可能可以接受,也可能不行,要和财务的人一起定。
- **不要急着换 Go 或 Rust**。单进程四五十请求每秒,4 核机器两百左右,对一个内部 Agent 平台可能已经够用好几年(下面算容量时会看到)。在没算清楚需求之前改语言,是用一个确定的大成本去解决一个可能不存在的问题。

这三条优化我今天都不做,原因也写进设计文档:目前的瓶颈靠加进程就能解决,而加进程带来的问题(下一节)比单进程性能更急。

## 第三组:多进程下,限流配额翻了几倍

Day 97 在风险里写过:令牌桶是进程内的,多副本部署时每个副本各有一个桶。刚才为了吞吐开了 4 个进程,这个风险就变成了现实。写个小脚本验证:

```python
# agentops/loadtest/limit_check.py
"""验证限流在多副本下是否还成立:用 t_small 在几秒内连发 N 个请求,数 200 和 429。

  SMALL_RPM=30 uv run python loadtest/seed.py > loadtest/.keys   # 把 t_small 的配额设成每分钟 30
  uv run python loadtest/limit_check.py 120

令牌桶的容量等于每分钟配额,所以单副本时应该放行大约 30 个;N 个副本各有一个桶,会放行大约 30×N 个。
"""
import asyncio
import collections
import os
import sys

import httpx

N = int(sys.argv[1]) if len(sys.argv) > 1 else 120
URL = os.environ.get("AGENTOPS_URL", "http://127.0.0.1:8080")
KEY = os.environ["KEY_T_SMALL"]


async def main() -> None:
    body = {"model": "fast", "messages": [{"role": "user", "content": "hi"}]}
    headers = {"Authorization": f"Bearer {KEY}"}
    async with httpx.AsyncClient(base_url=URL, timeout=30) as c:
        sem = asyncio.Semaphore(20)

        async def one():
            async with sem:
                return (await c.post("/v1/chat/completions", json=body, headers=headers)).status_code

        codes = await asyncio.gather(*[one() for _ in range(N)])
    print(dict(collections.Counter(codes)))


asyncio.run(main())
```

把 `t_small` 的配额设成每分钟 30,假上游调到 50 毫秒,连发 120 个请求,每组之间等一分钟让桶回满:

| 部署 | 第一次 | 第二次 |
| --- | --- | --- |
| 1 个进程 | 放行 30,拒绝 90 | 放行 30,拒绝 90 |
| 4 个进程 | 放行 113,拒绝 7 | 放行 109,拒绝 11 |
| 4 个进程,配额按进程数平分 | 放行 28,拒绝 92 | 放行 28,拒绝 92 |

单进程精确地放行了 30 个。4 个进程放行了一百一十个左右,接近 4 × 30,限流基本失效。这对平台意味着一个租户的 Agent 进了死循环时,打上游的速度是你以为的四倍,其他租户受到的影响也是四倍。

最后一行是最便宜的修法:每个进程只拿 1/N 的配额。改动只有两处:

```python
# agentops/src/agentops/config.py(Settings 里加一行)
    gateway_replicas: int = 1          # 网关进程总数(进程数 × 副本数),限流按它平分配额

# agentops/src/agentops/gateway/app.py(chat_completions 里,原来调 allow 的那一行换成)
    replicas = request.app.state.settings.gateway_replicas
    ok, retry_after = limiter_for(request).allow(ctx.tenant_id, max(1, ctx.rpm_limit // replicas))
```

放行 28 而不是 30,是因为 30 ÷ 4 向下取整是 7,四个进程一共 28。改完我重跑了 Day 97 的网关测试和 Day 103 的安全测试,都还是绿的(默认 `gateway_replicas=1`,行为不变)。

这个办法有两个前提,不满足就会出问题。第一,进程总数是固定的,而且要和配置保持一致,compose 单机部署满足这一点。第二,流量在进程之间大致均匀。如果某个租户的请求因为长连接全落在同一个进程上,它实际只能拿到 1/4 的配额,被误限。

上 K8s 以后第一个前提就没了,HPA 会在 3 到 10 个副本之间自动伸缩,配置里写死的副本数和实际对不上。这时候只能换成共享的限流:Day 97 预留的 Redis 实现(用 Lua 脚本在 Redis 里原子地做令牌桶),或者在网关前面放一层支持全局限流的代理(Envoy 的 ratelimit 服务就是干这个的)。所以今天的部署建议是:**单机 compose 可以用平分配额;要上 K8s 自动伸缩,先把限流换成 Redis,这是上 K8s 的前置条件,不是优化项**。

## 容量规划:用利特尔定律把数字串起来

利特尔定律(Little's Law)一句话:系统里平均同时存在的请求数,等于到达速率乘以每个请求的平均停留时间,L = λ × W。它不依赖任何分布假设,所以在容量规划里特别好用。

<figure>
<svg viewBox="0 0 640 260" role="img" aria-label="容量规划的四个约束:网关 CPU、到上游的连接数、上游账户并发上限、数据库连接">
<rect x="20" y="30" width="130" height="70" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="85" y="58" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">业务峰值</text>
<text x="85" y="80" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">λ 请求/秒</text>
<line x1="150" y1="65" x2="200" y2="65" stroke="var(--ink-faint)" stroke-width="1.5"/>
<rect x="200" y="20" width="190" height="90" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="295" y="46" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">网关</text>
<text x="295" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">进程数 ≥ λ ÷ 单进程上限</text>
<text x="295" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">本机实测单进程约 45 rps</text>
<line x1="390" y1="65" x2="440" y2="65" stroke="var(--ink-faint)" stroke-width="1.5"/>
<rect x="440" y="20" width="180" height="90" rx="8" fill="var(--compute-wash)" stroke="var(--compute)"/>
<text x="530" y="46" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">上游账户</text>
<text x="530" y="68" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">在途 = λ × 上游耗时</text>
<text x="530" y="88" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">≤ 账户并发上限</text>
<rect x="200" y="150" width="190" height="80" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
<text x="295" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">连接池(每进程)</text>
<text x="295" y="198" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">在途 ÷ 进程数 × 1.5</text>
<rect x="440" y="150" width="180" height="80" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
<text x="530" y="176" text-anchor="middle" font-family="var(--font-mono)" font-size="13" fill="var(--ink)">数据库连接</text>
<text x="530" y="198" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">λ × 每请求库耗时,很小</text>
<line x1="295" y1="110" x2="295" y2="150" stroke="var(--ink-faint)" stroke-width="1.5"/>
<line x1="390" y1="190" x2="440" y2="190" stroke="var(--ink-faint)" stroke-width="1.5"/>
</svg>
<figcaption>同一个 λ 穿过四个环节,每个环节用 L = λ × W 算出要多少「同时在用的东西」。哪个环节先超出上限,哪个就是天花板。</figcaption>
</figure>

拿 SupportPilot 算一遍。假设 CloudLedger 每天两万张工单,每张平均调 6 次模型(分类、改写检索词、起草、自检,外加几次追问),一天就是 12 万次模型调用。客服流量集中在白天,假设最忙的那一小时占全天的 15%,那一小时是 1.8 万次,平均每秒 5 次。再乘一个 3 倍的突发系数(Agent 的调用是一阵一阵的),峰值按每秒 15 次设计。

**网关进程数**。单进程四五十(这台旧笔记本上,云主机的单核通常更快),15 rps 一个进程就够。但你不会只部署一个:一个进程挂了全平台不可用,发布时也要滚动重启。所以副本数由可用性决定,不是由吞吐决定,最少 3 个,K8s 的 PodDisruptionBudget 保证任何时候至少 2 个在服务。这是容量规划里很常见的情况,值得在面试里讲:很多内部系统的副本数是被可用性和发布方式定下来的,吞吐需求远远没到。

**到上游的连接数**。fast 路由的上游耗时按 1.7 秒算,在途请求 L = 15 × 1.7 ≈ 26。分到 3 个进程上每个不到 10 个,httpx 默认的 100 绰绰有余。smart 路由如果每次要 8 秒,在途就是 15 × 8 = 120,这时候每进程 40 个,还在默认值以内,但要开始盯了。

**上游账户的并发上限**,这才是真正的天花板。DeepSeek 当前的限流文档写的是按账户算并发:deepseek-flash 2500,deepseek-v4-pro 500,一个请求从发出到响应完成算一个并发,超了返回 429,需要更高可以申请扩容。注意是按账户算,不管你用几把 API key。整个平台所有租户共用一个账户,smart 路由 500 个并发,按每次 8 秒算,整个平台每秒最多 500 ÷ 8 ≈ 62 次 smart 调用。哪个租户的 Agent 进了死循环疯狂调 smart,吃掉的是所有租户共用的这 500 个名额。这就是为什么 Day 97 的按租户限流和 Day 103 的按钱熔断,本质上是在分配一个全平台共享的稀缺资源。

同一份文档里还有一个对平台很有用的参数:请求体里可以带 `user_id`,DeepSeek 会按它做内容安全、KV cache 和调度上的隔离;申请了更高并发配额的账户,还会对每个 `user_id` 单独限并发。网关调 DeepSeek 时把租户 ID 带上,正好对应我们的租户模型:

```python
# agentops/src/agentops/gateway/app.py(调 DeepSeek 之前;别家不认这个字段,只对 deepseek 加)
            req = {**body, "user_id": ctx.tenant_id} if target.provider == "deepseek" else body
            resp = await prov.complete(target.model, req)
```

租户 ID 形如 `t_cloudledger`,符合文档要求的字符集。这一段我没有对真实 DeepSeek 验证过,上线前用一个测试请求确认它不会报参数错误。

**数据库连接**。每个请求三次很快的数据库操作,加起来几毫秒,在途 L = 15 × 0.005 ≈ 0.1,几乎为零。SQLAlchemy 默认每个进程 5 个连接加 10 个溢出,完全够。真正要算的是 Postgres 那一侧:`max_connections` 默认 100,网关 10 个副本、每个最多 15 个连接,再加上 worker,就可能撞上。副本数上限乘以每副本连接上限,要小于数据库的连接上限,留出余量。

**运行时 worker**。它们大部分时间在等模型返回,CPU 很低,所以不能按 CPU 扩。按利特尔定律,需要的并发任务槽 = 任务到达速率 × 平均任务时长。两万张工单集中在白天十小时,峰值按每秒 2 张、每张 20 秒算,需要 40 个并发槽。每个 worker 开 10 个并发,4 个 worker。K8s 上按队列深度扩,KEDA 可以直接读 Postgres 里 `runs` 表的排队数来驱动扩容。

## 部署:compose 和 K8s

先说镜像。两阶段构建:第一阶段用 uv 装依赖,第二阶段只拷虚拟环境和代码,最终镜像里没有 uv 和编译工具,用非 root 用户跑。

```dockerfile
# agentops/deploy/Dockerfile
# 两阶段:第一阶段用 uv 装依赖,第二阶段只拷虚拟环境和代码,镜像里没有 uv、没有编译工具
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY scripts ./scripts
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
RUN useradd --create-home --uid 10001 app
WORKDIR /app
COPY --from=build --chown=app:app /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER app
EXPOSE 8080
# 一个容器一个进程,扩容交给 compose 的副本数或 K8s;WEB_CONCURRENCY 只在单机部署时调
CMD ["sh", "-c", "uvicorn agentops.main:create_app --factory --host 0.0.0.0 --port 8080 --workers ${WEB_CONCURRENCY:-1} --proxy-headers"]
```

要连 Postgres,先 `uv add "psycopg[binary]"`。Day 99 的 worker 还没有命令行入口,把它动手练习步骤 2 写的启动脚本(`Worker(...).serve()`,llm_fn 接网关、tool_fn 接工具中心)放到 `scripts/run_worker.py`,下面的 compose 和 K8s 都用它启动。

**单机 compose**。第一期平台的量,一台 4 核 8G 的云主机就够了。网关一个容器开 4 个进程,`AGENTOPS_GATEWAY_REPLICAS` 和进程数保持一致;worker 两个副本;假上游和 SupportPilot 分别放在 `loadtest`、`redteam` 两个 profile 里,平时不起,Day 103 夜间红队用的就是 `redteam` 这个 profile。

```yaml
# agentops/deploy/compose.yaml
# 单机部署:一台 4 核 8G 的云主机足够第一期。用法:
#   cp .env.example deploy/.env  # 填好密钥
#   docker compose -f deploy/compose.yaml up -d --build
#   docker compose -f deploy/compose.yaml --profile loadtest up -d   # 压测时再起假上游
name: agentops

services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: agentops
      POSTGRES_USER: agentops
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in deploy/.env}
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agentops"]
      interval: 5s
      retries: 10

  gateway:
    build: {context: .., dockerfile: deploy/Dockerfile}
    env_file: .env
    environment:
      AGENTOPS_DATABASE_URL: postgresql+psycopg://agentops:${POSTGRES_PASSWORD}@postgres:5432/agentops
      WEB_CONCURRENCY: "4"                 # Day 104 压测:单进程约 50 rps 就打满一个核
      AGENTOPS_GATEWAY_REPLICAS: "4"       # 进程内令牌桶:每个进程分到 1/4 配额,和上一行保持一致
      AGENTOPS_OTEL_ENABLED: "true"        # Day 102
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_SERVICE_NAME: agentops-gateway
      OTEL_SEMCONV_STABILITY_OPT_IN: http  # 用 http.route 而不是带 ID 的原始路径做标签,见 Day 102
    ports: ["8080:8080"]
    depends_on:
      postgres: {condition: service_healthy}
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/healthz')"]
      interval: 10s
      retries: 3
    restart: unless-stopped

  worker:
    build: {context: .., dockerfile: deploy/Dockerfile}
    command: ["python", "scripts/run_worker.py"]   # Day 99 动手练习里写的 worker 启动脚本
    env_file: .env
    environment:
      AGENTOPS_DATABASE_URL: postgresql+psycopg://agentops:${POSTGRES_PASSWORD}@postgres:5432/agentops
      AGENTOPS_OTEL_ENABLED: "true"
      OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
      OTEL_SERVICE_NAME: agentops-worker
    depends_on:
      postgres: {condition: service_healthy}
    deploy: {replicas: 2}
    restart: unless-stopped

  otel-collector:                          # Day 102:trace 和指标都先到这里,配置见 obs/otelcol.yaml
    image: otel/opentelemetry-collector-contrib:0.162.0
    command: ["--config=/etc/otelcol/config.yaml"]
    volumes: [../obs/otelcol.yaml:/etc/otelcol/config.yaml:ro]
    restart: unless-stopped

  fake-upstream:
    profiles: [loadtest]
    build: {context: .., dockerfile: deploy/Dockerfile}
    command: ["uvicorn", "--app-dir", "loadtest", "fake_upstream:app", "--host", "0.0.0.0", "--port", "9100"]
    environment: {FAKE_P50_MS: "1500"}
    volumes: [../loadtest:/app/loadtest:ro]

  supportpilot:
    profiles: [redteam]
    build: {context: ../../supportpilot}    # 另一个仓库,Day 53 的 Dockerfile
    env_file: .env.supportpilot             # 里面的 LLM_BASE_URL 指向 http://gateway:8080/v1
    ports: ["8000:8000"]
    depends_on: [gateway]

volumes:
  pgdata:
```

**K8s**。网关是无状态的,一个 Pod 一个进程,按 CPU 扩(压测已经证明它是 CPU 先满);worker 单独一个 Deployment,按队列深度扩。

```yaml
# agentops/deploy/k8s/gateway.yaml
# 网关:无状态,水平扩。注意 HPA 会改副本数,进程内令牌桶的「按副本数平分配额」在这里失效,
# 上 K8s 之前先把限流换成 Redis 实现(见 Day 104 正文)。
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentops-gateway
  labels: {app: agentops, component: gateway}
spec:
  replicas: 3
  selector:
    matchLabels: {app: agentops, component: gateway}
  template:
    metadata:
      labels: {app: agentops, component: gateway}
    spec:
      securityContext: {runAsNonRoot: true, runAsUser: 10001}
      containers:
        - name: gateway
          image: registry.example.com/agentops:1.0.0   # 换成你的镜像仓库和版本号,不要用 latest
          ports: [{containerPort: 8080}]
          env:
            - {name: WEB_CONCURRENCY, value: "1"}       # K8s 里一个 Pod 一个进程,扩容靠副本
          envFrom:
            - configMapRef: {name: agentops-config}
            - secretRef: {name: agentops-secrets}       # 数据库密码、上游 API key、key_pepper
          resources:
            requests: {cpu: "500m", memory: "512Mi"}
            limits: {cpu: "1", memory: "1Gi"}
          readinessProbe:
            httpGet: {path: /healthz, port: 8080}
            periodSeconds: 5
          livenessProbe:
            httpGet: {path: /healthz, port: 8080}
            periodSeconds: 10
            failureThreshold: 3
      terminationGracePeriodSeconds: 60   # 让手上的上游调用(可能几十秒)有时间做完
---
apiVersion: v1
kind: Service
metadata:
  name: agentops-gateway
spec:
  selector: {app: agentops, component: gateway}
  ports: [{port: 80, targetPort: 8080}]
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: agentops-gateway
spec:
  scaleTargetRef: {apiVersion: apps/v1, kind: Deployment, name: agentops-gateway}
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: {type: Utilization, averageUtilization: 60}   # 压测显示网关是 CPU 先满
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300    # 缩容慢一点,Agent 流量本来就是一阵一阵的
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: agentops-gateway
spec:
  minAvailable: 2
  selector:
    matchLabels: {app: agentops, component: gateway}
```

```yaml
# agentops/deploy/k8s/worker.yaml
# 运行时 worker:按队列深度扩,而不是按 CPU。worker 大部分时间在等模型返回,CPU 很低,
# 按 CPU 扩会出现「队列堆了几百个任务,HPA 却觉得一切正常」。
apiVersion: apps/v1
kind: Deployment
metadata:
  name: agentops-worker
  labels: {app: agentops, component: worker}
spec:
  replicas: 2
  selector:
    matchLabels: {app: agentops, component: worker}
  template:
    metadata:
      labels: {app: agentops, component: worker}
    spec:
      securityContext: {runAsNonRoot: true, runAsUser: 10001}
      containers:
        - name: worker
          image: registry.example.com/agentops:1.0.0
          command: ["python", "scripts/run_worker.py"]   # Day 99 动手练习里写的启动脚本
          envFrom:
            - configMapRef: {name: agentops-config}
            - secretRef: {name: agentops-secrets}
          resources:
            requests: {cpu: "250m", memory: "512Mi"}
            limits: {cpu: "1", memory: "1Gi"}
      # worker 被杀时,Day 99 的租约机制保证任务会被别的 worker 接走;宽限期给当前步骤收尾
      terminationGracePeriodSeconds: 120
```

几个值得说的设置。`terminationGracePeriodSeconds` 网关给 60 秒、worker 给 120 秒:K8s 缩容或者滚动发布时会先发 SIGTERM,手上正在等上游返回的请求可能还要几十秒,宽限期太短,这些请求会被硬杀,租户看到的是连接被重置。HPA 的缩容稳定窗口设成 5 分钟,因为 Agent 流量是一阵一阵的,缩得太快会在下一阵流量来时重新扩,反复抖动。镜像标签写具体版本号,不用 `latest`,否则回滚时你都说不清线上跑的是哪个版本。

这三个文件我在本机只做了 YAML 解析检查(compose 一份、K8s 五个对象都能正确解析),没有真正构建镜像和部署,因为这台机器没有 Docker 和集群。你部署时有问题,以 `docker compose config` 和 `kubectl apply --dry-run=server` 的报错为准。

## 上线清单

上线那天按这个顺序做。每一步都要能回答「出了问题怎么回退」。

| 顺序 | 做什么 | 怎么确认 | 回退 |
| --- | --- | --- | --- |
| 1 | 跑数据库迁移(加列、加表,只加不删) | 迁移脚本退出码 0,新旧代码都能读新表结构 | 迁移只做向后兼容的改动,回退代码不用回退库 |
| 2 | 部署新版本,先不给流量 | 就绪探针通过;启动日志里没有配置缺失 | 删掉新版本 |
| 3 | 用内部测试租户跑冒烟:网关、工具中心、运行时各一条 | 三条都成功;usage、audit_log 都有记录 | 同上 |
| 4 | 灰度:只把流量最小的租户切过来 | 观察 30 分钟:错误率、P95、fallback 比例、成本和昨天同时段比 | 把这个租户切回旧版本 |
| 5 | 逐步切其他租户,大客户最后 | 每切一个看 15 分钟 | 逐个切回 |
| 6 | 全量后观察一个业务高峰 | Day 102 看板上没有新告警 | 整体回滚到上一个镜像版本 |
| 7 | 外部保存一份审计链头(Day 103) | `export_heads` 的结果写到了外部存储 | 不需要 |

第 1 步的原则单独强调一下:**迁移和代码分开发布,迁移永远向后兼容**。今天如果要删一列,先发一个不再读这一列的代码版本,稳定一周后再发删列的迁移。这样任何时候回滚代码,库都不用动。数据库回滚是上线事故里最难处理的一类,能不碰就不碰。

第 4 步为什么从最小的租户开始?因为灰度的目的是用最小的代价发现问题。还有一个更实际的理由:小租户通常是内部团队,出了问题打个电话就能沟通;大客户出问题是要写事故报告的。

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1N7CTBTEQK&autoplay=0&high_quality=1" title="一小时Locust从入门到实战,2025最新的性能测试实战教程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>测试界的天才 · 一小时Locust从入门到实战,2025最新的性能测试实战教程 · 82 分钟。没用过 Locust 的话先看前半小时的脚本结构和 Web 界面,分布式压测那部分在你单机压不动时再回来看。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/G03B4ZM93bs" title="Load testing with Python and Locust by Lars Holmberg" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>PyCon Sweden · Load testing with Python and Locust by Lars Holmberg · 30 分钟。讲者是 Locust 的维护者,讲了很多「压测结果为什么不可信」的坑,比如压测机自己先满了。</figcaption>
</figure>

## 动手练习

**目标**:在你自己的环境里重现今天的几组实验,用数据回答「网关需要几个进程」和「限流在多进程下是否成立」,再把 AgentOps 部署起来。

1. 把 `loadtest/` 下的四个文件放进仓库,`uv add --dev locust`。按「压网关不能打真模型」一节的命令跑通 20 用户。
2. 依次跑 80、200 用户,填下面的记录表。跑 200 用户时用 `ps` 或活动监视器看网关、假上游、Locust 三个进程的 CPU,确认被测的是网关而不是压测工具。
3. 重做「连接池调大」和「4 个进程」两组对比,每组都先删库重建。用你的数据解释为什么调大连接池没用。
4. 用 `limit_check.py` 验证多进程下的限流问题,再加上按进程数平分配额的改动,确认放行数回到配额附近。改完跑一遍全部测试。
5. 用你自己业务的数字(或者沿用 SupportPilot 的假设)算一遍容量:网关进程数、每进程连接池、上游在途并发、数据库连接总数、worker 数。写进设计文档。
6. 有 Docker 的话,用 `deploy/compose.yaml` 起 Postgres 和网关,再跑一次 200 用户,看换成 Postgres 后单进程的数字变了多少。

**验收标准**:

- 记录表填满,每组都注明机器配置和数据库类型。
- 能用数据说明你的环境里先到顶的是哪个环节,并且排除了压测工具本身是瓶颈。
- 多进程限流问题能复现,修复后放行数在配额的 ±10% 以内。
- 容量计算里每个数字都写了公式和输入假设,并且指出了整个平台真正的天花板在哪。

记录表:

| 实验 | 机器 / 数据库 | 用户数 | 吞吐 | 网关开销 P50 | 网关开销 P95 | 网关 CPU |
| --- | --- | --- | --- | --- | --- | --- |
| 单进程 | | 20 | | | | |
| 单进程 | | 80 | | | | |
| 单进程 | | 200 | | | | |
| 连接池 500 | | 200 | | | | |
| 4 进程 | | 200 | | | | |
| 限流:1 进程 / 4 进程 / 4 进程平分 | | — | 放行数: | | | |

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 假上游 | 压测时代替真实模型服务的假服务,延迟和错误率可控 |
| 网关开销 | 请求在网关里花的时间,等于总耗时减去上游耗时 |
| 对数正态分布 | 取对数后服从正态分布,形状是大部分集中、右边拖一条长尾,适合模拟调用耗时 |
| 背压 | backpressure,下游处理不过来时让上游等待或拒绝,防止压力一路传下去把系统压垮 |
| 利特尔定律 | L = λ × W,平均在途请求数等于到达速率乘以平均停留时间 |
| 在途请求 | in-flight,已经发出、还没收到响应的请求 |
| 账户并发上限 | 上游供应商按账户限制的同时在途请求数,DeepSeek 超了返回 429 |
| 突发系数 | 峰值除以平均值,用来把平均流量放大成设计容量 |
| HPA | Horizontal Pod Autoscaler,K8s 按指标自动调整副本数 |
| PDB | PodDisruptionBudget,限制主动驱逐时最少保留几个 Pod |
| KEDA | 让 K8s 按队列长度、数据库查询结果这类外部指标扩缩容的组件 |
| 优雅终止 | 收到 SIGTERM 后停止接新请求,把手上的请求做完再退出 |
| 灰度发布 | 新版本先只接一小部分流量,确认没问题再逐步放开 |
| 向后兼容的迁移 | 只加不删、新旧代码都能用的数据库变更,回滚代码时不用回滚库 |

## 常见误区

**拿真实模型压网关。** 花钱不说,上游的抖动会把网关的问题盖住,你也没法控制上游变慢或报错。

**不看压测工具自己的 CPU。** 压测机先满了,量到的就是压测机的极限。每次压都要看一眼三个进程的 CPU。

**吞吐上不去就调大连接池。** 我的实验里连接池调大五倍,吞吐掉了一半。先找到真正的瓶颈,CPU 满了就加进程,别把排队的地方从池子挪到 CPU 上。

**只看平均值和 P50。** 80 用户时开销 P50 是 14 毫秒,看着很好,P95 却是 83 毫秒,是目标的近三倍。验收指标定 P95 是有原因的。

**数据库不重建就做对比实验。** usage 表每跑一轮都在长,按月汇总的查询越来越慢,后面的实验天然吃亏。对比实验要控制变量。

**多副本部署前不检查进程内状态。** 令牌桶、缓存、计数器,凡是放在进程内存里的东西,多副本时都会变成 N 份。上线前把代码里所有进程级状态列一遍。

**副本数只按吞吐算。** 内部平台的副本数往往是可用性和滚动发布决定的,最少三个,哪怕一个就扛得住。

**数据库迁移和代码一起回滚。** 迁移要向后兼容,删东西分两次发,回滚只动代码。

## 学习资料

### 文档与文章

- [Locust 快速上手](https://docs.locust.io/en/stable/quickstart.html)和[分布式压测](https://docs.locust.io/en/stable/running-distributed.html):单机压不动时用 master/worker 模式,`--processes` 是最省事的写法。
- [httpx:Resource Limits](https://www.python-httpx.org/advanced/resource-limits/):连接池的三个参数和默认值。
- [FastAPI:Concurrency and async / await](https://fastapi.tiangolo.com/async/):什么时候用 `async def`、什么时候用普通 `def`,今天实验 C 的背景知识。
- [DeepSeek API:Rate Limit & Isolation(中文版)](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit):账户并发上限和 `user_id` 隔离,数字以官方当前页为准。
- [Google SRE Book:Handling Overload](https://sre.google/sre-book/handling-overload/)和[Addressing Cascading Failures](https://sre.google/sre-book/addressing-cascading-failures/):过载时怎么拒绝请求、怎么避免一个环节慢拖垮全链路,和今天的背压、限流直接相关,各 30 分钟。
- [Brendan Gregg:The USE Method](https://www.brendangregg.com/usemethod.html):对每个资源看使用率、饱和度、错误,压测时找瓶颈的检查清单。
- [Kubernetes:Horizontal Pod Autoscaling](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/)和[配置 PDB](https://kubernetes.io/docs/tasks/run-application/configure-pdb/)。
- [uv:在 Docker 里使用](https://docs.astral.sh/uv/guides/integration/docker/):今天 Dockerfile 的写法来源,讲了缓存层怎么分。
- [Little's law(维基百科)](https://en.wikipedia.org/wiki/Little%27s_law):定律本身和几个例子。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV12h4y1S7QZ&autoplay=0&high_quality=1" title="【IT老齐386】K8S动态扩缩容之HPA实战" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>IT老齐 · 【IT老齐386】K8S动态扩缩容之HPA实战 · 14 分钟。HPA 的工作方式和配置,看完再回来读今天的 gateway.yaml。</figcaption>
</figure>

- 「AIGC科技官 · vLLM:并发压测及监控实战」(BV1NwddYLEw1,19 分钟):如果你的上游是 Day 76 自部署的 vLLM,压上游时看这个,思路和今天压网关一样:先确认压测机不是瓶颈,再看吞吐在哪里变平。

### 其他经典视频

- Nicolai Gram Bredesgaard 的「Load Testing in Python with locust.io」系列(YouTube,第一集 8 分钟):比上面 PyCon 那场更入门,一集讲一个功能点。

### 书籍

- Martin Kleppmann,《Designing Data-Intensive Applications》,O'Reilly;中译本《数据密集型应用系统设计》,中国电力出版社。读第 1 章讲负载参数、响应时间分位数和「为什么要看 P99」的部分,今天所有指标的定义都在那里。
- Betsy Beyer 等,《Site Reliability Engineering》,O'Reilly,2016;[官方免费在线版](https://sre.google/sre-book/table-of-contents/);中译本《SRE:Google 运维解密》,电子工业出版社。读第 21、22 章(过载处理和级联故障)。

### 开源项目与代码

- [locustio/locust](https://github.com/locustio/locust):今天用的压测工具。
- [grafana/k6](https://github.com/grafana/k6):用 JavaScript 写脚本的压测工具,脚本可以直接进 CI,和 Locust 二选一。
- [vllm-project/guidellm](https://github.com/vllm-project/guidellm):专门压大模型推理服务的工具,会报 TTFT、每 token 延迟这些推理特有的指标,压自部署的 vLLM 时用。
- [kedacore/keda](https://github.com/kedacore/keda):按队列深度扩 worker。
- [envoyproxy/ratelimit](https://github.com/envoyproxy/ratelimit):全局限流服务,多副本网关共享配额的一种做法。

## 自测

1. 你用 Locust 压网关,发现吞吐卡在 50,网关开销 P95 两秒。在动手优化之前,你要先确认哪两件事?

<details><summary>答案</summary>

第一,压测工具和假上游不是瓶颈:看三个进程的 CPU,Locust 如果自己接近 100%,量到的是它的极限。第二,吞吐真的「卡住」了:用用户数和每轮时间算出应有的吞吐(用户数 ÷(上游耗时 + 思考时间)),实际明显低于它,差额才是排队。两件事都确认了,再去找网关里是哪个资源满了。

</details>

2. 为什么把 httpx 连接池上限从 100 调到 500,吞吐反而下降?

<details><summary>答案</summary>

真正的瓶颈是网关进程的 CPU,不是连接数。连接池上限在这里充当背压,超出的请求在池子里排队,不占用事件循环。放开上限以后,几百个请求同时在跑,都在抢同一个已经吃满的核,每个请求都变慢,调度开销还更大。排队的地方从连接池挪到了 CPU 上,情况更糟。

</details>

3. 网关从 1 个进程改成 4 个进程后,某租户每分钟 30 次的配额实际放行了一百一十次左右。原因是什么?compose 单机部署和 K8s 自动伸缩下分别怎么修?

<details><summary>答案</summary>

令牌桶在进程内存里,4 个进程各有一个装满 30 个令牌的桶,总共放行接近 120。compose 单机部署时进程数固定,可以让每个进程只拿 1/N 的配额,代价是流量在进程间不均匀时会误限。K8s 上 HPA 会动态改副本数,写死的 N 对不上,必须换成共享状态的限流,比如 Redis 里用 Lua 脚本原子实现的令牌桶,或者网关前面的全局限流服务。

</details>

4. 峰值每秒 15 次模型调用,上游平均耗时 8 秒,同时在途的上游请求大约多少?3 个网关进程时每个进程的连接池至少要多大?

<details><summary>答案</summary>

利特尔定律:L = λ × W = 15 × 8 = 120 个在途请求。平均分到 3 个进程,每个约 40 个。再留 50% 余量应对突发和不均匀,每进程至少 60 个连接,httpx 默认的 100 够用。如果副本因为故障减到 2 个,每个要扛 60 个在途,也还在 100 以内。

</details>

5. 为什么 worker 不能像网关一样按 CPU 自动扩容?

<details><summary>答案</summary>

worker 大部分时间在等模型返回,CPU 很低。任务在队列里堆了几百个,worker 的 CPU 可能还是 10%,按 CPU 扩的 HPA 会认为一切正常。worker 的负载应该用队列深度或者排队时长衡量,用 KEDA 之类的组件按 `runs` 表里排队的任务数扩容。

</details>

6. **资深面试题**:业务方说「下个月要接一个大客户,流量会是现在的五倍,平台扛得住吗?」你怎么回答?

<details><summary>答案</summary>

不直接回答「扛得住」或「扛不住」,而是把问题拆到每个环节,用 L = λ × W 逐个算。先把「五倍」翻译成数字:现在的峰值请求每秒多少,smart 和 fast 各占多少,新客户的调用模式是否一样(他的 Agent 每张工单调几次模型、用不用 smart)。然后逐个环节对照上限。网关:单进程实测上限多少,五倍峰值需要几个进程,现有副本加 HPA 上限够不够。上游账户:在途并发 = 峰值 × 平均耗时,对比供应商的账户并发上限,这通常是最先撞线的,smart 路由尤其如此,如果撞线要提前申请扩容,或者给这个客户配专门的账户。数据库:副本上限乘每副本连接数,对比 Postgres 的连接上限。worker:任务到达速率 × 任务时长,对比并发槽。最后给出结论和行动项:哪些环节有余量,哪个环节会先撞线、什么时候撞、要提前做什么(申请上游扩容、把限流换成 Redis、加 worker),以及用今天的压测脚本按五倍流量验证一次。回答里要有公式、实测数据和明确的天花板,而不是凭感觉。

</details>

## 明天预告

Day 105 · AgentOps(九):包装成资深级作品。AgentOps 写完了,明天把它变成招聘方愿意花时间看的东西:设计文档和 ADR 怎么整理,评测报告、压测报告、成本分析各放什么,三分钟演示视频拍什么,技术博客写哪个点。还会讲招聘方看资深作品和看中级作品,关注点有什么不一样。
