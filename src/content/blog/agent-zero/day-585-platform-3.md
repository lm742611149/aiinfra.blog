---
title: 'Day 585 · 平台(三):控制面和数据面,中间件放在哪'
description: '平台里有两类东西:管配置的控制面,和每个请求都要走的数据面。今天先用假时钟看清数据面为什么不能每次都问控制面、配置下发慢了会怎样、紧急开关怎么推;再在本机起一个 Valkey,实跑多实例限流计数、任务队列的崩溃重投、分布式锁,并在 pgvector 里复现带租户过滤的向量检索漏行,最后讲大文件放对象存储、上下文里只留引用。'
pubDate: 2026-10-27
regime: none
tags: ['platform', 'control-plane', 'redis', 'queue', 'agent-zero']
series: 'agent-zero'
day: 585
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 584](/blog/agent-zero/day-584-platform-2/) 把租户隔开了:数据、配额、密钥、模型四个维度各设一道门,再用 Postgres 的行级安全让数据库替你加那个 `WHERE tenant_id = ...`。我们写了 `tenant_db.py`,让每条查询都在事务里带着租户走。那一课的重点是「谁能看到什么」。

今天换一个角度看同一个平台:它由哪几块组成,哪些块每秒被打几百次、哪些块一天只被点几十次?这两类东西要不要放在一起,以及 Redis、队列、向量库、对象存储这几样中间件,各自该在平台的哪个位置、什么时候才值得装。

## 今天要解决的问题

学完今天你应该能做到:

1. 说清控制面和数据面分别管什么,并且用 `plane_sync.py` 的实跑结果解释为什么「数据面每个请求都去问控制面」是错的,以及本地快照的代价(配置生效有延迟)怎么用「缩短拉取间隔」和「事件推送」两种办法压下去。
2. 在本机起一个只绑 `127.0.0.1` 的 Valkey,用它跑通三件事:多个网关实例共享一个限流计数(并看到「先读后写」为什么会超发)、任务队列在 worker 崩溃后怎么把任务接回来、一把带过期时间的锁。
3. 说出对象存储、检索库(向量库)、队列、Redis 各自在什么条件下才值得引入,并能在 pgvector 里复现「带租户过滤的向量检索返回行数不够」这个坑,知道两种修法。

预计用时 3 小时。前置:[Day 584](/blog/agent-zero/day-584-platform-2/)(隔离四个维度、RLS)、[Day 583](/blog/agent-zero/day-583-platform-1/)(`tenants.py`)、[Day 383](/blog/agent-zero/day-383-redis-basics/)(Redis 的键值、过期、常用命令)、[Day 387](/blog/agent-zero/day-387-queue-basics/)(队列、生产者和消费者)、[Day 390](/blog/agent-zero/day-390-idempotency/)(至少执行一次和幂等)、[Day 233](/blog/agent-zero/day-233-hnsw/)(HNSW 为什么快、为什么会漏)、[Day 229](/blog/agent-zero/day-229-pgvector-1/)(pgvector)、[Day 228](/blog/agent-zero/day-228-postgres-basics/)(Postgres.app 和 psycopg)。

先说怎么跑的。今天只有一个脚本(`blob_ref.py`)调了 DeepSeek,而且只是为了让接口报出输入 token 数、`max_tokens=1`,模型名 `deepseek-flash`,一次约 0.07 元,算式写在那一节。其余全部在本机跑,不花钱。Redis 的部分我用的是 Valkey 9.0.7(Redis 的 BSD 许可分支,命令和 Redis 兼容,`redis` 这个 Python 客户端能直接连),从源码编译放在自己的临时目录里,只绑 `127.0.0.1`,端口 6389,跑完关掉。你自己的机器上最省事是 `brew install valkey`。

pgvector 的实验在一个新建的库 `agentzero_w585` 里做,不碰你 Day 229 建的库。要装的包:

```bash
cd agent-zero-lab
uv add redis "psycopg[binary]" openai python-dotenv
createdb agentzero_w585
```

代码都放在 `agent-zero-lab/part10/platform/`,和昨天、前天的文件同一个目录。`tenants.py` 是 [Day 583](/blog/agent-zero/day-583-platform-1/) 建的,今天不改它。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章默写核心部分(`plane_sync.py` 的 `CachedGateway`、`shared_counter.py` 的 `allow_incr`、`stream_queue.py` 的 `run_worker`);做练习,做不出再展开参考答案,看完关掉重写一遍。

## 先分两类:控制面和数据面

做前端你肯定见过这种分工:有一个发布后台,运营在里面改 feature flag、改首页配置、下线某个活动;而用户每次打开页面,请求走的是 CDN 和业务接口,它们读的是已经发布出去的那份配置。后台一天被点几十次,哪怕挂五分钟,多半没人察觉;用户那条路一秒钟几百次,停一分钟就是事故。这就是控制面和数据面的分法,换到 Agent 平台上是这样:

<figure>
<svg viewBox="0 0 640 330" role="img" aria-label="控制面和数据面的拆分:控制面管理租户、Agent 定义、工具授权、密钥与预算,把版本化的配置快照下发到数据面;数据面包含模型网关、Agent 运行时、工具调用和用量管道,处理每一个请求">
  <rect x="0" y="0" width="640" height="330" fill="var(--paper-raised)"/>
  <rect x="20" y="16" width="600" height="104" rx="6" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
  <text x="34" y="36" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">控制面:改得少,慢一点没关系,但每次改动要可审计</text>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="34" y="50" width="104" height="52" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="86" y="73" text-anchor="middle" fill="var(--ink)">租户 / 项目</text><text x="86" y="90" text-anchor="middle" fill="var(--ink-soft)">API key</text>
    <rect x="150" y="50" width="104" height="52" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="202" y="73" text-anchor="middle" fill="var(--ink)">Agent 定义</text><text x="202" y="90" text-anchor="middle" fill="var(--ink-soft)">提示词版本</text>
    <rect x="266" y="50" width="104" height="52" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="318" y="73" text-anchor="middle" fill="var(--ink)">工具注册</text><text x="318" y="90" text-anchor="middle" fill="var(--ink-soft)">授权策略</text>
    <rect x="382" y="50" width="104" height="52" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="434" y="73" text-anchor="middle" fill="var(--ink)">密钥</text><text x="434" y="90" text-anchor="middle" fill="var(--ink-soft)">预算 / 配额</text>
    <rect x="498" y="50" width="104" height="52" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="550" y="73" text-anchor="middle" fill="var(--ink)">账单报表</text><text x="550" y="90" text-anchor="middle" fill="var(--ink-soft)">审计日志</text>
  </g>
  <line x1="320" y1="120" x2="320" y2="156" stroke="var(--ink-faint)" stroke-width="1.5"/>
  <polygon points="314,150 326,150 320,160" fill="var(--ink-faint)"/>
  <text x="332" y="144" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">版本化快照下发,数据面存在本地</text>
  <rect x="20" y="166" width="600" height="148" rx="6" fill="none" stroke="var(--rule)"/>
  <text x="34" y="186" font-family="var(--font-mono)" font-size="12" fill="var(--ink-soft)">数据面:每个请求都走,要快,控制面挂了也得继续跑</text>
  <g font-family="var(--font-mono)" font-size="11">
    <rect x="34" y="200" width="130" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="99" y="221" text-anchor="middle" fill="var(--ink)">模型网关</text><text x="99" y="237" text-anchor="middle" fill="var(--ink-soft)">Day 586、588</text>
    <rect x="178" y="200" width="130" height="48" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="243" y="221" text-anchor="middle" fill="var(--ink)">Agent 运行时</text><text x="243" y="237" text-anchor="middle" fill="var(--ink-soft)">worker</text>
    <rect x="322" y="200" width="130" height="48" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="387" y="221" text-anchor="middle" fill="var(--ink)">工具 / MCP</text><text x="387" y="237" text-anchor="middle" fill="var(--ink-soft)">Day 589、590</text>
    <rect x="466" y="200" width="140" height="48" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="536" y="221" text-anchor="middle" fill="var(--ink)">知识库 / 记忆</text><text x="536" y="237" text-anchor="middle" fill="var(--ink-soft)">按租户隔离</text>
    <rect x="34" y="260" width="572" height="40" rx="4" fill="var(--paper-raised)" stroke="var(--ink-faint)"/><text x="320" y="284" text-anchor="middle" fill="var(--ink)">trace / 用量事件 → 异步送回控制面的账单和看板</text>
  </g>
</svg>
<figcaption>控制面把配置做成带版本号的快照推给数据面,数据面存在自己的内存里。控制面短暂不可用时,已有的 Agent 照常服务,只是暂时没法改配置。</figcaption>
</figure>

控制面放的是「配置」:租户和项目的增删改、Agent 的定义和提示词版本、哪个 Agent 能用哪些工具、预算上限、密钥、账单报表。数据面放的是「执行」:模型网关、跑 Agent 循环的 worker、真正去调工具的那一段、把 trace 和用量送出去的管道。

拆开的理由有两个,而且都很具体。一是**可用性要求不一样**:数据面停一分钟,所有 Agent 一起停摆;控制面停一分钟,只是没人能改配置。二是**变化的节奏不一样**:控制面的代码经常发版(加字段、改界面),数据面应该尽量少动。两块混在一个服务里,控制面一次带 bug 的发布就能把数据面一起带走。

## 数据面不能每个请求都问控制面

拆开以后立刻会碰到一个设计问题:数据面处理一个请求,要知道「这个租户被暂停了没有、预算还剩多少、能用哪个模型组」,这些信息在控制面。最直接的写法是每个请求都调一次控制面的接口问一下。这个写法看起来最新鲜,其实是错的:控制面成了数据面的单点,控制面一抖,所有 Agent 跟着抖。

正确的做法是控制面把配置做成一份**版本化的快照**,数据面定期拉一份放在本地内存里,请求路径上只读自己内存里的那份。我们用一个假时钟把两种写法放在一起比较一下。设定:模拟 120 秒,每秒来一个 Maple 的请求;控制面在第 40 秒挂掉、第 100 秒恢复;第 10 秒运维在控制面里把 Maple 暂停(那时控制面是好的)。

```python
# agent-zero-lab/part10/platform/plane_sync.py
"""数据面怎么拿到控制面的配置:每个请求都去问(同步),还是拿一份快照放本地(缓存)。
用一个假时钟模拟 120 秒,每秒来一个请求;控制面在第 40 秒挂掉,第 100 秒恢复。不调任何接口。
用法:uv run python part10/platform/plane_sync.py
"""
from dataclasses import dataclass


class ControlPlaneDown(Exception):
    pass


@dataclass(frozen=True)
class Snapshot:
    version: int
    paused: frozenset[str]          # 被暂停的租户。最小化的配置:只有这一项


class Clock:
    def __init__(self) -> None:
        self.now = 0.0


class ControlPlane:
    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self.version = 1
        self.paused: set[str] = set()

    def is_up(self) -> bool:
        return not (40 <= self.clock.now < 100)       # 第 40 到 99 秒不可用

    def pause(self, tenant: str) -> None:             # 运维在控制台点「暂停」
        self.paused.add(tenant)
        self.version += 1

    def fetch_snapshot(self) -> Snapshot:
        if not self.is_up():
            raise ControlPlaneDown("控制面不可用")
        return Snapshot(self.version, frozenset(self.paused))


class SyncGateway:
    """做法一:每个请求同步问控制面。"""

    def __init__(self, cp: ControlPlane) -> None:
        self.cp = cp

    def handle(self, tenant: str) -> str:
        try:
            snap = self.cp.fetch_snapshot()
        except ControlPlaneDown:
            return "500"
        return "403" if tenant in snap.paused else "200"


class CachedGateway:
    """做法二:本地存一份快照,每 interval 秒后台拉一次;拉不到就继续用旧的。"""

    def __init__(self, cp: ControlPlane, clock: Clock, interval: float) -> None:
        self.cp, self.clock, self.interval = cp, clock, interval
        self.snap = cp.fetch_snapshot()
        self.last_pull = clock.now

    def maybe_refresh(self) -> None:
        if self.clock.now - self.last_pull < self.interval:
            return
        self.last_pull = self.clock.now                # 拉失败也记一次,下一个周期再试
        try:
            self.snap = self.cp.fetch_snapshot()
        except ControlPlaneDown:
            pass

    def handle(self, tenant: str) -> str:
        self.maybe_refresh()
        return "403" if tenant in self.snap.paused else "200"


def run(interval: float) -> None:
    clock = Clock()
    cp = ControlPlane(clock)
    sync, cached = SyncGateway(cp), CachedGateway(cp, clock, interval)
    s_codes: list[str] = []
    c_codes: list[str] = []
    for sec in range(120):
        clock.now = float(sec)
        if sec == 10:
            cp.pause("maple")                           # 第 10 秒运维把 Maple 暂停(控制面当时是好的)
        s_codes.append(sync.handle("maple"))
        c_codes.append(cached.handle("maple"))
    def count(codes: list[str], code: str) -> int:
        return sum(1 for c in codes if c == code)
    first_block = c_codes.index("403") if "403" in c_codes else None
    print(f"拉取间隔 {interval:>4.0f} 秒 | 同步问:200×{count(s_codes, '200')} 403×{count(s_codes, '403')} 500×{count(s_codes, '500')}"
          f" | 本地快照:200×{count(c_codes, '200')} 403×{count(c_codes, '403')} 500×{count(c_codes, '500')},"
          f"暂停后第 {first_block} 秒才真正挡住(晚了 {first_block - 10 if first_block else '-'} 秒)")


if __name__ == "__main__":
    for interval in (30, 8):
        run(interval)
```

<div class="line-notes">

- `class ControlPlaneDown(Exception):` 自定义一个异常,表示「控制面连不上」。调用方可以单独 `except` 它,和别的错误分开处理。
- `@dataclass(frozen=True)` [Day 50](/blog/agent-zero/day-050-dataclass/) 学过的 dataclass,`frozen=True` 让快照创建后不能被改。快照是「某一个时刻的配置」,数据面拿到以后只读,换新版本就整份替换。
- `paused: frozenset[str]` 被暂停的租户名集合。真实的快照里还有预算、模型组、工具授权等等,今天只留这一项,够说明问题。`frozenset` 是不能修改的集合,和 `frozen=True` 配套。
- `class Clock:` 一个只有一个数字的假时钟。我们不真的等 120 秒,脚本里直接把 `clock.now` 设成第几秒,所有「过了多久」的判断都读它,所以结果每次都一样。
- `return not (40 <= self.clock.now < 100)       # 第 40 到 99 秒不可用` 控制面是否可用由时间决定。第 40 秒返回 `False`,第 99 秒还是 `False`,第 100 秒起恢复。
- `self.paused.add(tenant)` 运维点了「暂停」,集合里加一个租户。
- `self.version += 1` 每改一次配置版本号加一。数据面可以靠版本号判断「我手里的是不是最新的」,下一节的事件推送会用到。
- `raise ControlPlaneDown("控制面不可用")` 控制面不可用时,取快照的接口直接抛异常,模拟连接失败。
- `class SyncGateway:` 做法一,每个请求都问控制面。
- `snap = self.cp.fetch_snapshot()` 请求路径上同步调用。控制面好的时候返回最新快照。
- `return "500"` 控制面挂了,这个请求没法判断该不该放行,只能报错。第 40 到 99 秒共 60 个请求,全部走到这一行。
- `class CachedGateway:` 做法二,本地存一份快照,每 `interval` 秒拉一次。
- `self.snap = cp.fetch_snapshot()` 启动时先拉一份,第 0 秒控制面是好的。
- `if self.clock.now - self.last_pull < self.interval:` 距离上次拉取不到 `interval` 秒就不拉,直接返回。`interval=30` 时,拉取发生在第 30、60、90 秒。
- `self.last_pull = self.clock.now                # 拉失败也记一次,下一个周期再试` 失败了也要把「上次尝试时间」更新,否则控制面挂掉时每个请求都会去重试一遍,又回到了「每个请求都问」。
- `except ControlPlaneDown:` 拉失败就什么都不做,继续用手里那份旧快照。这一行就是「控制面挂了也能继续服务」的全部实现。
- `return "403" if tenant in self.snap.paused else "200"` 本地快照的判断:租户在暂停集合里就拒绝(403),否则放行(200)。
- `if sec == 10:` 第 10 秒运维暂停 Maple。同一秒里,同步的那个做法马上能看到,本地快照的做法要等下一次拉取。
- `first_block = c_codes.index("403") if "403" in c_codes else None` 找到本地快照第一次返回 403 的秒数,也就是暂停真正生效的时刻。
- `for interval in (30, 8):` 比较两种拉取间隔,30 秒和 8 秒。

</div>

```bash
cd agent-zero-lab
uv run python part10/platform/plane_sync.py
```

```text
拉取间隔   30 秒 | 同步问:200×10 403×50 500×60 | 本地快照:200×30 403×90 500×0,暂停后第 30 秒才真正挡住(晚了 20 秒)
拉取间隔    8 秒 | 同步问:200×10 403×50 500×60 | 本地快照:200×16 403×104 500×0,暂停后第 16 秒才真正挡住(晚了 6 秒)
```

先看「同步问」那一列:200 只有 10 个(第 0–9 秒),第 10 秒暂停以后 403,但是第 40–99 秒控制面挂了,60 个请求全是 500。同一个 Maple,控制面一抖,不管它有没有被暂停,所有人都在报错。

再看本地快照:一个 500 都没有。代价在最后那句:`interval=30` 时,运维在第 10 秒点了暂停,数据面第 30 秒拉到才真正挡住,中间 20 个请求本该被拒绝却放行了;把间隔缩到 8 秒,晚了 6 秒。**配置生效有延迟,是这种做法必须接受的代价**,所以下发要有两个配套:延迟要在文档里写清楚(「改完最多 30 秒生效」),真正着急的开关要有另一条路,下一节讲。

还有一个问题:控制面挂了很久,数据面手里的快照越来越旧,该怎么办?全部拒绝太狠,一直用旧的又可能放过已经被暂停的租户。折中的办法是给快照设一个「可接受的陈旧上限」:超过 `WARN_AFTER` 秒没拉成功就告警,超过 `FREEZE_AFTER` 秒就只放行快照里已有的租户,拒绝没见过的。这是练习 1,参考答案里有完整代码。

## 紧急开关:推送加版本号

「某个租户的批处理死循环,正在烧钱」这种事等不了 30 秒。常见做法是在拉取之外再开一条推送的通道:控制面改完配置,除了把整份新快照存好,还往一个频道里发一条「谁变了」的小事件,数据面订阅这个频道,收到就直接改自己内存里的那份。

推送有一个麻烦:消息可能丢。数据面网络断了几秒,期间的事件就没人收了,断线恢复以后它还以为自己是最新的。所以每条事件都带版本号,数据面收到时检查「这一条是不是正好是我本地版本加一」,不是就说明中间丢过,直接放弃增量,整份重拉。这个思路和数据库里的复制日志、前端状态管理里的「乐观更新对账」是一回事。

这个脚本要一个共享的存储来放快照和传事件,我们用 Valkey。先在本机起一个,只绑回环地址,不对外:

```bash
valkey-server --bind 127.0.0.1 --port 6389 --save "" --appendonly no --daemonize yes
valkey-cli -p 6389 ping
```

```text
PONG
```

`--save "" --appendonly no` 是关掉落盘,这是个临时实验用的实例,不需要持久化。如果你是用 `brew install valkey` 装的,命令名一样。

```python
# agent-zero-lab/part10/platform/kill_switch.py
"""紧急开关:控制面除了「存快照」,还往一个频道里推一条变更事件,数据面收到立刻改本地快照。
事件可能丢,所以每条事件带版本号;版本对不上就整份重拉。
先在本机起一个只绑 127.0.0.1 的 Valkey(见文中),端口 6389。
用法:uv run python part10/platform/kill_switch.py
uv add redis
"""
import json
import threading
import time

import redis

r = redis.Redis(host="127.0.0.1", port=6389, decode_responses=True)


def publish(version: int, paused: list[str], changed: str | None) -> None:
    """控制面做的事:先存整份快照,再推一条「谁变了」的事件。"""
    r.set("cp:snapshot", json.dumps({"version": version, "paused": paused}))
    if changed:
        r.publish("cp:events", json.dumps({"version": version, "op": "pause", "tenant": changed}))


class Edge:
    """数据面的一个实例:请求路径上只读自己内存里的 paused,不碰 Valkey。"""

    def __init__(self) -> None:
        self.version = 0
        self.paused: set[str] = set()
        self.log: list[str] = []
        self.pubsub = r.pubsub()

    def pull(self) -> None:
        snap = json.loads(r.get("cp:snapshot") or '{"version": 0, "paused": []}')
        self.version, self.paused = snap["version"], set(snap["paused"])
        self.log.append(f"整份重拉 → 版本 {self.version}, paused={sorted(self.paused)}")

    def on_event(self, ev: dict) -> None:
        if ev["version"] == self.version + 1:
            self.paused.add(ev["tenant"])
            self.version = ev["version"]
            self.log.append(f"收到事件 → 版本 {self.version}, paused={sorted(self.paused)}")
        else:
            self.log.append(f"事件版本 {ev['version']} 跳过了本地的 {self.version},说明丢过消息")
            self.pull()

    def listen(self, pubsub) -> None:
        try:
            pubsub.subscribe("cp:events")
            for msg in pubsub.listen():
                if msg["type"] == "message":
                    self.on_event(json.loads(msg["data"]))
        except (OSError, ValueError, redis.ConnectionError):
            pass                                        # 连接被关掉:线程安静退出,真实系统里这里要重连

    def start(self) -> None:
        self.pubsub = r.pubsub()
        threading.Thread(target=self.listen, args=(self.pubsub,), daemon=True).start()
        time.sleep(0.2)                                 # 等订阅真正建立好

    def stop(self) -> None:
        self.pubsub.close()                             # 模拟网络断了


def wait_until(cond, timeout: float = 2.0) -> float:
    t0 = time.perf_counter()
    while not cond() and time.perf_counter() - t0 < timeout:
        time.sleep(0.0005)
    return (time.perf_counter() - t0) * 1000


if __name__ == "__main__":
    r.delete("cp:snapshot")
    publish(1, [], None)
    edge = Edge()
    edge.pull()
    edge.start()

    print("== 一、正常:推送事件")
    publish(2, ["maple"], "maple")
    ms = wait_until(lambda: "maple" in edge.paused)
    print(f"  暂停 maple 后 {ms:.1f} 毫秒,数据面已经在挡了")

    print("== 二、数据面掉线期间错过了一条事件")
    edge.stop()
    time.sleep(0.2)
    publish(3, ["maple", "acme"], "acme")               # 这条事件没人收
    print(f"  控制面已是版本 3,数据面还停在版本 {edge.version},paused={sorted(edge.paused)}")
    edge.start()                                        # 网络恢复,重新订阅
    publish(4, ["maple", "acme", "globex"], "globex")   # 下一条事件到了:版本 4 ≠ 2+1
    wait_until(lambda: edge.version == 4)
    for line in edge.log:
        print("  ", line)
    print(f"  最终 acme 被挡住了吗:{'acme' in edge.paused}")
```

<div class="line-notes">

- `import threading` 开一个后台线程专门收事件。相当于 JS 里「另起一个 `onmessage` 监听」,只是 Python 里要自己开线程。`redis` 的订阅接口是阻塞的,在主线程里调用会卡住。
- `r = redis.Redis(host="127.0.0.1", port=6389, decode_responses=True)` 连本机的 Valkey。`decode_responses=True` 让返回值是字符串,不是字节串。
- `def publish(version: int, paused: list[str], changed: str | None) -> None:` 控制面做的事,分两步:存快照,再推事件。
- `r.set("cp:snapshot", json.dumps({"version": version, "paused": paused}))` 整份快照存成一个 key。数据面启动或者发现丢消息时,读这个 key 就能拿到完整的最新状态。
- `r.publish("cp:events", json.dumps({"version": version, "op": "pause", "tenant": changed}))` 往 `cp:events` 频道发一条「第几版、暂停了谁」。`publish` 是发完即忘的,当时没人订阅,消息就没了,这一点正是下面要处理的。
- `class Edge:` 数据面的一个实例。「Edge」在这里只是个名字,表示靠近请求的那一侧。
- `self.paused: set[str] = set()` 请求路径上只读这个内存里的集合,不碰 Valkey,所以 Valkey 慢或者短暂不可用都不影响判断。
- `snap = json.loads(r.get("cp:snapshot") or '{"version": 0, "paused": []}')` 整份重拉。`r.get` 在 key 不存在时返回 `None`,`or` 后面给一个空快照兜底。
- `if ev["version"] == self.version + 1:` 只有「正好是下一版」才直接套用。本地是版本 2,收到版本 3 就可以,收到版本 4 就不行。
- `self.paused.add(ev["tenant"])` 增量应用:集合里加一个租户,不用重拉整份。
- `self.log.append(f"事件版本 {ev['version']} 跳过了本地的 {self.version},说明丢过消息")` 版本对不上,记一条日志。实跑时本地是 2,事件是 4,中间的 3 丢了。
- `self.pull()` 对不上就整份重拉,把丢掉的那一版一起补回来。
- `for msg in pubsub.listen():` 阻塞循环,每来一条消息进来一次。订阅刚建立时第一条是 `subscribe` 类型的确认,所以下一行要判断类型。
- `if msg["type"] == "message":` 只处理真正的消息,跳过订阅确认。
- `except (OSError, ValueError, redis.ConnectionError):` 连接被我们主动关掉(模拟断网)时,监听线程会在这里抛出这几种错,捕获后线程安静退出。真实系统在这里要做的是重连,再整份重拉一次。
- `threading.Thread(target=self.listen, args=(self.pubsub,), daemon=True).start()` 开后台线程。`daemon=True` 表示主程序结束时它不会拖着进程不退出。
- `time.sleep(0.2)                                 # 等订阅真正建立好` 订阅是异步建立的。少了这一行,紧接着发的第一条事件可能赶在订阅之前,就丢了。
- `self.pubsub.close()                             # 模拟网络断了` 关掉订阅连接,等于断网。
- `def wait_until(cond, timeout: float = 2.0) -> float:` 不断检查一个条件,直到成立或超时,返回等了多少毫秒。用来量「推送多快生效」。
- `publish(2, ["maple"], "maple")` 第一个实验,版本 1 到 2,正常收到。
- `publish(3, ["maple", "acme"], "acme")               # 这条事件没人收` 断线期间发的版本 3,没有订阅者,事件丢了,但快照已经存进 Valkey。
- `publish(4, ["maple", "acme", "globex"], "globex")   # 下一条事件到了:版本 4 ≠ 2+1` 恢复订阅后到的版本 4,本地是 2,对不上,触发整份重拉,一次拿到版本 4 的全部内容,包括丢掉的 acme。

</div>

```bash
uv run python part10/platform/kill_switch.py
```

```text
== 一、正常:推送事件
  暂停 maple 后 0.0 毫秒,数据面已经在挡了
== 二、数据面掉线期间错过了一条事件
  控制面已是版本 3,数据面还停在版本 2,paused=['maple']
   整份重拉 → 版本 1, paused=[]
   收到事件 → 版本 2, paused=['maple']
   事件版本 4 跳过了本地的 2,说明丢过消息
   整份重拉 → 版本 4, paused=['acme', 'globex', 'maple']
  最终 acme 被挡住了吗:True
```

第一部分里,暂停 Maple 以后数据面马上就生效了。我跑了几次,量出来是 0.0 到 2.4 毫秒不等(本机回环,所以快得夸张,跨机房会是几毫秒到几十毫秒)。对比一下刚才 `interval=30` 的最坏 30 秒,差了四五个数量级。

第二部分故意断开订阅:控制面已经是版本 3,数据面还停在 2,这时 acme 被暂停了数据面却不知道。下一条事件(版本 4)到来时,版本号对不上,数据面整份重拉,版本 3 的内容也补回来了,最后 acme 被挡住。**事件推送只负责「快」,拉取和版本号负责「不丢」**,两条路缺一不可;生产里通常还会保留一个低频的定时拉取(比如一分钟一次)当最后的保险。

## 中间件:每一样都对应一个具体的问题

国内的 JD 里经常一口气列「熟悉 Redis、Kafka、Milvus、ES」,第一次看会以为 Agent 平台要把这些全装上。其实每一样都是在回答一个问题,问题没出现就不用引入。到现在为止我们的 SupportPilot 只用了 Postgres 一个库(加 pgvector),单租户、几十个并发完全够。平台把规模往上推,会有四样东西陆续进来。先看它们在哪个位置:

<figure>
<svg viewBox="0 0 640 300" role="img" aria-label="Agent 平台里的中间件位置:请求经过网关和运行时,Redis 管限流计数、会话和锁;队列连接 API 和后台 worker;检索库服务知识库和记忆;对象存储放文件和大载荷;请求路径上的是网关、运行时、Redis、检索库和 Postgres,队列和对象存储在异步一侧">
<rect x="0" y="0" width="640" height="300" fill="var(--paper-raised)"/>
<g font-family="var(--font-mono)" font-size="11">
<rect x="20" y="30" width="110" height="40" rx="4" fill="none" stroke="var(--rule)"/><text x="75" y="55" text-anchor="middle" fill="var(--ink)">客户端 / 渠道</text>
<line x1="130" y1="50" x2="170" y2="50" stroke="var(--ink-faint)"/>
<rect x="170" y="30" width="120" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="230" y="55" text-anchor="middle" fill="var(--ink)">API / 模型网关</text>
<line x1="290" y1="50" x2="330" y2="50" stroke="var(--ink-faint)"/>
<rect x="330" y="30" width="130" height="40" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/><text x="395" y="55" text-anchor="middle" fill="var(--ink)">运行时 worker</text>
<line x1="460" y1="50" x2="500" y2="50" stroke="var(--ink-faint)"/>
<rect x="500" y="30" width="120" height="40" rx="4" fill="var(--compute-wash)" stroke="var(--compute)"/><text x="560" y="55" text-anchor="middle" fill="var(--ink)">工具 / MCP</text>
<rect x="170" y="110" width="120" height="50" rx="4" fill="none" stroke="var(--ink-faint)"/><text x="230" y="131" text-anchor="middle" fill="var(--ink)">Redis / Valkey</text><text x="230" y="148" text-anchor="middle" fill="var(--ink-soft)">计数 锁 缓存</text>
<line x1="230" y1="70" x2="230" y2="110" stroke="var(--rule)"/>
<rect x="20" y="110" width="130" height="50" rx="4" fill="none" stroke="var(--ink-faint)"/><text x="85" y="131" text-anchor="middle" fill="var(--ink)">队列</text><text x="85" y="148" text-anchor="middle" fill="var(--ink-soft)">Stream / SQS</text>
<path d="M170 62 Q120 85 100 110" fill="none" stroke="var(--rule)"/>
<path d="M150 135 Q260 95 360 70" fill="none" stroke="var(--rule)" stroke-dasharray="4 3"/>
<rect x="330" y="110" width="130" height="50" rx="4" fill="none" stroke="var(--ink-faint)"/><text x="395" y="131" text-anchor="middle" fill="var(--ink)">检索库</text><text x="395" y="148" text-anchor="middle" fill="var(--ink-soft)">pgvector 起步</text>
<line x1="395" y1="70" x2="395" y2="110" stroke="var(--rule)"/>
<rect x="490" y="110" width="130" height="50" rx="4" fill="none" stroke="var(--ink-faint)"/><text x="555" y="131" text-anchor="middle" fill="var(--ink)">Postgres</text><text x="555" y="148" text-anchor="middle" fill="var(--ink-soft)">业务 配置 检查点</text>
<line x1="440" y1="70" x2="520" y2="110" stroke="var(--rule)"/>
<rect x="20" y="210" width="290" height="50" rx="4" fill="none" stroke="var(--ink-faint)"/><text x="165" y="231" text-anchor="middle" fill="var(--ink)">对象存储(S3 / OSS)</text><text x="165" y="248" text-anchor="middle" fill="var(--ink-soft)">上传文件 大工具结果 原始事件</text>
<rect x="330" y="210" width="290" height="50" rx="4" fill="none" stroke="var(--ink-faint)"/><text x="475" y="231" text-anchor="middle" fill="var(--ink)">分析库(ClickHouse 等)</text><text x="475" y="248" text-anchor="middle" fill="var(--ink-soft)">trace 分析 成本看板</text>
<line x1="85" y1="160" x2="85" y2="210" stroke="var(--rule)" stroke-dasharray="4 3"/>
<line x1="150" y1="150" x2="400" y2="210" stroke="var(--rule)" stroke-dasharray="4 3"/>
<text x="20" y="288" fill="var(--ink-faint)">实线:请求路径上同步调用;虚线:异步事件流</text>
</g>
</svg>
<figcaption>Agent 平台里常见中间件的位置。请求路径上同步用到的只有网关、运行时、Redis、检索库和 Postgres;队列、对象存储和分析库都在异步那一侧,它们慢了或者挂了,不该直接卡住用户的请求。</figcaption>
</figure>

| 中间件 | 回答的问题 | 什么时候引入 |
| --- | --- | --- |
| Redis(或 Valkey) | 多个实例要共享一个数字或一把锁:限流计数、预算累计、同一张工单只让一个 worker 处理、会话缓存 | 有了第二个应用实例就该上。单实例时内存里计数就够,多实例各数各的,限流形同虚设 |
| 队列 | 活太长,不能让用户的请求等着;或者一个事件要被多个下游消费 | 有跑超过几十秒的任务,或者事件要同时送给计费、看板、告警几个下游。规模没到每秒几千条之前,Redis 的 Stream 或云上托管队列比 Kafka 省事得多 |
| 检索库 | 知识库、长期记忆要按语义检索 | 先用 pgvector,和业务数据一个库,还能用昨天的 RLS 做隔离。量级到千万、检索 QPS 很高,或者要按租户分别扩容,再考虑独立的向量库。门槛以你自己的压测为准,别照搬别人的数字 |
| 对象存储 | 大文件放哪:用户上传的 PDF、超大的工具结果、trace 的原始事件 | 一开始就该有。大文件塞进 Postgres 或者上下文,库和账单都会很快膨胀 |

下面四样各跑一个最小实验,先从 Redis 说起。

### Redis:多个实例,共享一个计数

[Day 128](/blog/agent-zero/day-128-rate-limit/) 讲过供应商的限速,[Day 584](/blog/agent-zero/day-584-platform-2/) 的 `noisy_neighbor.py` 里,平台自己给每个租户设了「每分钟最多 60 个」。那个脚本是单进程里数个数。真实的网关会起好几个实例,负载均衡把请求轮流发过去。每个实例各数各的,会怎样?我们直接跑:

```python
# agent-zero-lab/part10/platform/shared_counter.py
"""多实例以后,限流计数放哪:每个实例各数各的 / 共享的 Valkey 里先读后写 / 共享的 Valkey 里 INCR。
规则:每个租户每分钟最多放行 60 个请求。网关起了 3 个实例,负载均衡把请求轮流发给它们。
用法:uv run python part10/platform/shared_counter.py
uv add redis
"""
import threading
from collections import Counter

import redis

LIMIT = 60
r = redis.Redis(host="127.0.0.1", port=6389, decode_responses=True)


class LocalCounter:
    """每个实例自己的内存计数。"""

    def __init__(self) -> None:
        self.n: Counter[str] = Counter()

    def allow(self, tenant: str) -> bool:
        self.n[tenant] += 1
        return self.n[tenant] <= LIMIT


def allow_racy(tenant: str) -> bool:
    """共享了,但是先读、再判断、再写:两步之间别的实例可能插进来。"""
    key = f"rl:racy:{tenant}"
    n = int(r.get(key) or 0)
    if n >= LIMIT:
        return False
    r.set(key, n + 1)
    return True


def allow_incr(tenant: str) -> bool:
    """INCR 是服务端一条原子命令:加一并返回加完的值,没有「读」和「写」之间的空档。"""
    key = f"rl:incr:{tenant}"
    n = r.incr(key)
    if n == 1:
        r.expire(key, 60)               # 第一次出现这个 key 时给它 60 秒寿命,窗口到点自动清零
    return n <= LIMIT


def fire(allow_fns, total: int) -> int:
    """串行发 total 个请求,第 i 个交给第 i % 实例数 个实例,返回放行了几个。"""
    return sum(allow_fns[i % len(allow_fns)]("maple") for i in range(total))


def fire_concurrent(allow, total: int, workers: int) -> int:
    passed = []
    lock = threading.Lock()

    def work() -> None:
        for _ in range(total // workers):
            ok = allow("maple")
            with lock:
                passed.append(ok)

    ts = [threading.Thread(target=work) for _ in range(workers)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return sum(passed)


if __name__ == "__main__":
    r.delete("rl:racy:maple", "rl:incr:maple")

    locals_ = [LocalCounter() for _ in range(3)]
    print(f"一、三个实例各数各的:90 个请求,放行 {fire([c.allow for c in locals_], 90)} 个(上限 {LIMIT})")

    print(f"二、共享 Valkey,先读后写:串行 90 个,放行 {fire([allow_racy] * 3, 90)} 个")
    r.delete("rl:racy:maple")
    print(f"   同一规则,8 个线程同时发 160 个,放行 {fire_concurrent(allow_racy, 160, 8)} 个,"
          f"事后 Valkey 里的计数是 {r.get('rl:racy:maple')}(应该是 160)")

    print(f"三、共享 Valkey,INCR:串行 90 个,放行 {fire([allow_incr] * 3, 90)} 个")
    r.delete("rl:incr:maple")
    print(f"   同一规则,8 个线程同时发 160 个,放行 {fire_concurrent(allow_incr, 160, 8)} 个")
    print("   key 剩余寿命(秒):", r.ttl("rl:incr:maple"))
```

<div class="line-notes">

- `LIMIT = 60` 规则:每个租户每分钟最多放行 60 个请求。
- `class LocalCounter:` 每个实例自己的内存计数,三个实例就是三个独立的对象。
- `self.n[tenant] += 1` 计数加一。`Counter` 是 [Day 584](/blog/agent-zero/day-584-platform-2/) 用过的「数个数」字典,缺的键默认是 0。
- `return self.n[tenant] <= LIMIT` 加完以后还不超过 60 就放行。每个实例看到的最多是 30 个,永远到不了 60,所以全放行。
- `def allow_racy(tenant: str) -> bool:` 共享了,但写成了三步:读、判断、写。
- `n = int(r.get(key) or 0)` 第一步读。key 不存在时 `r.get` 返回 `None`,当成 0。
- `r.set(key, n + 1)` 第三步写。读和写之间是两次网络往返,别的实例可以插进来:两个实例同时读到 35,各自写回 36,实际来了两个请求计数却只加了一。
- `n = r.incr(key)` `INCR` 是 Valkey 里的一条原子命令:在服务端把数字加一并返回加完以后的值,中间不会被别的客户端打断。判断用的是它返回的值,不再有「读」和「写」之间的空档。
- `r.expire(key, 60)               # 第一次出现这个 key 时给它 60 秒寿命,窗口到点自动清零` 只在 `n == 1`(这个窗口里的第一个请求)时设置过期,60 秒后 key 自己消失,下一个请求又从 1 开始。这就是「每分钟」窗口的实现。
- `return sum(allow_fns[i % len(allow_fns)]("maple") for i in range(total))` 串行模拟轮询:第 i 个请求交给第 `i % 3` 个实例。`True` 加起来当 1,所以 `sum` 就是放行的个数。
- `def fire_concurrent(allow, total: int, workers: int) -> int:` 另开 8 个线程同时发请求,模拟多个实例真的同时在跑。
- `with lock:` 线程之间共用 `passed` 这个列表,往里追加时加一把本地锁。这把锁只保护脚本自己的统计,和被测的限流逻辑无关。
- `fire_concurrent(allow_racy, 160, 8)` 8 个线程各发 20 个,总共 160 个。
- `r.ttl("rl:incr:maple")` 查 key 的剩余寿命,刚设置完是 60 秒。

</div>

```bash
uv run python part10/platform/shared_counter.py
```

```text
一、三个实例各数各的:90 个请求,放行 90 个(上限 60)
二、共享 Valkey,先读后写:串行 90 个,放行 60 个
   同一规则,8 个线程同时发 160 个,放行 160 个,事后 Valkey 里的计数是 38(应该是 160)
三、共享 Valkey,INCR:串行 90 个,放行 60 个
   同一规则,8 个线程同时发 160 个,放行 60 个
   key 剩余寿命(秒): 60
```

一、三个实例各数各的:90 个请求全部放行,上限是 60。实例越多,实际放行的越多,这就是 [Day 584](/blog/agent-zero/day-584-platform-2/) 说的「限流形同虚设」。

二、共享 Valkey 但先读后写:串行时没问题(60 个),换成 8 个线程同时发,160 个全放行,事后一看 Valkey 里的计数只有 36。160 次加一,丢了 124 次。这个现象叫**竞态**(race condition):结果取决于几个操作谁先谁后。前端里你可能见过:两个 `setState(count + 1)` 同时执行,只加了一次。

三、用 `INCR`:串行 60 个,并发还是 60 个。原子命令把「读、加、写」压成了服务端的一步。

LiteLLM 的文档里有两句话值得对照着看:`tpm`、`rpm` 这些计数器放在 Redis 里,这样每个实例执行同一个限制;Redis 连不上时,各实例退回到自己内存里的计数,继续服务,所以一个 key 的实际上限会乘以实例数(想要 Redis 挂了就拒绝,要打开 `fail_closed_rate_limit_enforcement`)。这正是我们刚才跑出来的第一种情况,它不是 bug,是它在可用性和精确性之间做的取舍。你的网关也要想清楚:Redis 挂了,是放过还是拒绝。

### 队列:长任务不让用户等,worker 崩了任务不丢

用户发来一份要总结的几十页文档,总结要跑两分钟。让用户的 HTTP 请求等两分钟是不行的(前端那头早就超时了)。做法是 API 把任务丢进队列,立刻返回一个任务 id,后台 worker 慢慢取、慢慢做,前端用 [Day 133](/blog/agent-zero/day-133-sse-principle/) 那类事件流或轮询来取结果。队列的基本概念 [Day 387](/blog/agent-zero/day-387-queue-basics/) 讲过,今天用 Valkey 自带的 **Stream** 数据结构实际跑一遍,重点看一件事:worker 取走任务、还没做完就崩了,这个任务会不会丢?

Stream 里的几个词先解释一下。`XADD` 往队列末尾追加一条消息,返回一个 id(形如 `1793082462652-0`,前半是毫秒时间戳)。**消费者组**(consumer group)是一群 worker 共同消费同一个队列,每条消息只会交给组里的一个 worker。worker 用 `XREADGROUP` 取消息,处理完用 `XACK` 确认;**取走了但没确认**的消息会留在一个叫「待确认列表」的地方,别的 worker 可以用 `XAUTOCLAIM` 把闲置太久的接过来。

```python
# agent-zero-lab/part10/platform/stream_queue.py
"""用 Valkey/Redis 的 Stream 当任务队列:API 把长任务丢进去马上返回,后台 worker 取了处理、处理完确认。
演示 worker 取了任务没确认就崩了,另一个 worker 怎么把它接回来,以及为什么处理逻辑必须能重复执行。
用法:uv run python part10/platform/stream_queue.py
uv add redis
"""
import json
import time
from typing import Any, cast

import redis

r = redis.Redis(host="127.0.0.1", port=6389, decode_responses=True)
STREAM, GROUP = "jobs:summarize", "workers"


def enqueue(tenant: str, ticket: str) -> str:
    """API 进程做的事:把任务写进队列,拿到一个任务 id 就返回,不等处理。"""
    return str(r.xadd(STREAM, {"payload": json.dumps({"tenant": tenant, "ticket": ticket})}))


def process(job_id: str, payload: dict, worker: str) -> None:
    """真正干活。结果写进 result:{ticket};用 SET NX 保证同一张工单只落一次结果(幂等)。"""
    wrote = r.set(f"result:{payload['ticket']}", f"{worker} 处理的 {job_id}", nx=True)
    print(f"  [{worker}] 处理 {payload['ticket']}(任务 {job_id}),{'写入结果' if wrote else '结果已存在,跳过'}")


def run_worker(name: str, count: int, crash_before_ack_on: str | None = None) -> None:
    got = cast(list[Any], r.xreadgroup(GROUP, name, {STREAM: ">"}, count=count, block=200))
    for _stream, messages in got:
        for job_id, fields in messages:
            payload = json.loads(fields["payload"])
            process(job_id, payload, name)
            if payload["ticket"] == crash_before_ack_on:
                print(f"  [{name}] 在确认前崩溃了!任务 {job_id} 留在待确认列表里")
                return
            r.xack(STREAM, GROUP, job_id)


if __name__ == "__main__":
    r.delete(STREAM, *r.keys("result:*"))
    r.xgroup_create(STREAM, GROUP, id="0", mkstream=True)

    ids = [enqueue("yunbu", f"T-{100 + i}") for i in range(5)]
    print(f"API 丢进去 5 个任务,队列长度 {r.xlen(STREAM)},第一个任务 id = {ids[0]}")

    print("worker-A 取 3 个,处理到 T-101 时崩溃:")
    run_worker("worker-A", 3, crash_before_ack_on="T-101")
    pending = r.xpending(STREAM, GROUP)
    print(f"  待确认(取走但没 ack)的任务数:{pending['pending']}")

    time.sleep(0.6)                                    # 等这些任务「闲置」超过 0.5 秒
    print("worker-B 先接手超时没确认的任务,再取新任务:")
    claimed = r.xautoclaim(STREAM, GROUP, "worker-B", min_idle_time=500, start_id="0")
    for job_id, fields in claimed[1]:
        process(job_id, json.loads(fields["payload"]), "worker-B")
        r.xack(STREAM, GROUP, job_id)
    run_worker("worker-B", 10)

    print(f"最后:待确认 {r.xpending(STREAM, GROUP)['pending']} 个,已有结果的工单 {sorted(k[7:] for k in r.keys('result:*'))}")
    for k in sorted(r.keys("result:*")):
        print(f"  {k} = {r.get(k)}")
```

<div class="line-notes">

- `STREAM, GROUP = "jobs:summarize", "workers"` 队列的名字(一个 key)和消费者组的名字。
- `def enqueue(tenant: str, ticket: str) -> str:` API 进程做的事:写进队列,拿到消息 id 就返回,不等处理。
- `return str(r.xadd(STREAM, {"payload": json.dumps({"tenant": tenant, "ticket": ticket})}))` `XADD` 追加一条消息,内容是字段加值,这里只放一个 `payload` 字段,里面是 JSON 字符串。租户一定要放进消息里,worker 不能靠「当前请求」认租户,因为它根本没有请求。
- `wrote = r.set(f"result:{payload['ticket']}", f"{worker} 处理的 {job_id}", nx=True)` 模拟「处理」:把结果写进 `result:T-101` 这种 key。`nx=True` 表示只有这个 key 不存在才写,返回 `True` 或 `None`。这是**幂等**的关键,下面解释。
- `{'写入结果' if wrote else '结果已存在,跳过'}` 第二次处理同一张工单时 `wrote` 是 `None`,打印「跳过」。
- `got = cast(list[Any], r.xreadgroup(GROUP, name, {STREAM: ">"}, count=count, block=200))` 以 `name` 这个 worker 的身份从组里取最多 `count` 条消息。`">"` 的意思是「还没分给过任何 worker 的新消息」。`block=200` 最多等 200 毫秒。`cast` 只是告诉类型检查器返回值的形状,运行时什么都不做。
- `if payload["ticket"] == crash_before_ack_on:` 模拟崩溃:处理到指定的工单时,直接 `return`,不执行后面的 `xack`。
- `r.xack(STREAM, GROUP, job_id)` 确认这条消息处理完了,它才会从待确认列表里移除。
- `r.xgroup_create(STREAM, GROUP, id="0", mkstream=True)` 建消费者组,`id="0"` 从队列最开头读,`mkstream=True` 队列不存在就顺便建。
- `ids = [enqueue("yunbu", f"T-{100 + i}") for i in range(5)]` 丢 5 个任务,工单号 T-100 到 T-104。
- `run_worker("worker-A", 3, crash_before_ack_on="T-101")` worker-A 一次取 3 条(T-100、T-101、T-102),处理 T-100 并确认,处理 T-101 以后崩溃,T-102 取走了但没来得及开始。所以待确认里有 2 条。
- `pending = r.xpending(STREAM, GROUP)` 查待确认列表,`pending['pending']` 是条数,实跑是 2。
- `time.sleep(0.6)                                    # 等这些任务「闲置」超过 0.5 秒` 接管有个前提:消息闲置时间超过阈值,不然会把别的 worker 正在处理的任务抢走。
- `claimed = r.xautoclaim(STREAM, GROUP, "worker-B", min_idle_time=500, start_id="0")` worker-B 把闲置超过 500 毫秒的待确认消息接过来。返回值的第二项是消息列表,所以下面用 `claimed[1]`。
- `process(job_id, json.loads(fields["payload"]), "worker-B")` 接管的任务重新处理一遍。T-101 在 worker-A 崩溃前其实已经写过结果,所以这里打印「结果已存在,跳过」。

</div>

```bash
uv run python part10/platform/stream_queue.py
```

```text
API 丢进去 5 个任务,队列长度 5,第一个任务 id = 1793082462652-0
worker-A 取 3 个,处理到 T-101 时崩溃:
  [worker-A] 处理 T-100(任务 1793082462652-0),写入结果
  [worker-A] 处理 T-101(任务 1793082462652-1),写入结果
  [worker-A] 在确认前崩溃了!任务 1793082462652-1 留在待确认列表里
  待确认(取走但没 ack)的任务数:2
worker-B 先接手超时没确认的任务,再取新任务:
  [worker-B] 处理 T-101(任务 1793082462652-1),结果已存在,跳过
  [worker-B] 处理 T-102(任务 1793082462653-0),写入结果
  [worker-B] 处理 T-103(任务 1793082462653-1),写入结果
  [worker-B] 处理 T-104(任务 1793082462654-0),写入结果
最后:待确认 0 个,已有结果的工单 ['T-100', 'T-101', 'T-102', 'T-103', 'T-104']
  result:T-100 = worker-A 处理的 1793082462652-0
  result:T-101 = worker-A 处理的 1793082462652-1
  result:T-102 = worker-B 处理的 1793082462653-0
  result:T-103 = worker-B 处理的 1793082462653-1
  result:T-104 = worker-B 处理的 1793082462654-0
```

(消息 id 里的时间戳每次运行都不一样,别的内容应该和这里一致。)

worker-A 取走 3 条,处理了 T-100、T-101 就崩了,待确认里留着 2 条(T-101 做了一半、T-102 还没开始)。worker-B 接管这两条,再取剩下的新任务,最后 5 张工单都有结果,待确认清零。**没有任务丢**。

但是注意 T-101:它被处理了**两次**,一次在崩溃的 worker-A 手里(结果已经写了),一次在接管的 worker-B 手里。这是「至少执行一次」(at-least-once)队列的基本性质,[Day 390](/blog/agent-zero/day-390-idempotency/) 讲过。队列只能保证不丢,没法保证只做一次,因为「做完了」和「确认了」是两个动作,中间崩溃就会重复。所以**处理逻辑必须能重复执行而不出事**。我们这里靠 `SET NX` 保证同一张工单只落一次结果。练习 3 会把它换成「每次都扣一个点数」,看账怎么算错。

Kafka 比 Stream 的优势是可以让很多个消费者各自独立地读同一份数据、可以回放历史、吞吐高,代价是运维重得多。事件量没到每秒几千条,又没有「同一个事件要被十个下游各消费一遍」的需求,Stream 或者云上托管的队列(比如 AWS 的 SQS)更省事。面试被问「你为什么用了 Kafka」,最好的回答是说出那个让你不得不用它的问题;最差的是「大家都用」。

### 同一张工单不能被两个 worker 同时处理:一把带过期的锁

队列保证每条消息只交给一个 worker,但上游可能把同一张工单发了两次(用户点了两下、webhook 重试)。变成两条消息,两个 worker 同时处理,就会重复退款。这类问题用一把**分布式锁**挡住:谁先拿到 `lock:T-200`,谁处理,拿不到的跳过。

```python
# agent-zero-lab/part10/platform/ticket_lock.py
"""同一张工单不能被两个 worker 同时处理:用 SET key value NX PX 做一把带过期时间的锁。
用法:uv run python part10/platform/ticket_lock.py
uv add redis
"""
import threading
import time
import uuid

import redis

r = redis.Redis(host="127.0.0.1", port=6389, decode_responses=True)

# 释放锁:只有锁还是自己的才删(值对得上才删)。写成 Lua 是为了「比较 + 删除」在服务端一步做完。
RELEASE = """
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end
"""


def handle_ticket(worker: str, ticket: str, work_seconds: float, lock_ms: int) -> None:
    token = uuid.uuid4().hex                            # 每次拿锁一个随机值,证明「这把锁是我拿的」
    if not r.set(f"lock:{ticket}", token, nx=True, px=lock_ms):
        print(f"  [{worker}] {ticket} 已经有人在处理,跳过")
        return
    print(f"  [{worker}] 拿到 {ticket} 的锁,开始处理")
    time.sleep(work_seconds)
    freed = r.eval(RELEASE, 1, f"lock:{ticket}", token)
    print(f"  [{worker}] 处理完,释放锁:{'成功' if freed else '失败(锁早已过期,可能被别人拿走了)'}")


if __name__ == "__main__":
    r.delete("lock:T-200")
    print("一、两个 worker 同时抢 T-200,处理要 0.5 秒,锁寿命 2 秒:")
    ts = [threading.Thread(target=handle_ticket, args=(w, "T-200", 0.5, 2000)) for w in ("worker-A", "worker-B")]
    [t.start() for t in ts]
    [t.join() for t in ts]

    print("二、处理比锁寿命长(1 秒 vs 0.3 秒),worker-A 还在干活时锁过期了:")
    a = threading.Thread(target=handle_ticket, args=("worker-A", "T-201", 1.0, 300))
    a.start()
    time.sleep(0.5)
    handle_ticket("worker-B", "T-201", 0.1, 300)        # 锁已过期,B 拿到了,A 和 B 同时在处理
    a.join()
```

<div class="line-notes">

- `RELEASE = """` 释放锁用的一小段 Lua 脚本,Valkey 允许把脚本发到服务端一次性执行,执行期间不会被别的命令打断。
- `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end` 先看锁的值是不是我拿锁时放的那个随机值,是才删。为什么不直接 `DEL`:如果我的锁已经过期、被别人拿走了,我一个 `DEL` 就把别人的锁删了。
- `token = uuid.uuid4().hex                            # 每次拿锁一个随机值,证明「这把锁是我拿的」` `uuid4` 生成一个随机串,`.hex` 转成 32 位十六进制字符串。
- `if not r.set(f"lock:{ticket}", token, nx=True, px=lock_ms):` 一条命令里同时做两件事:key 不存在才写(`nx=True`),并且设置 `lock_ms` 毫秒后自动过期(`px`)。写成功返回 `True`,key 已存在返回 `None`。拿不到锁就跳过。
- `freed = r.eval(RELEASE, 1, f"lock:{ticket}", token)` 执行上面那段 Lua。`1` 表示后面跟着 1 个 key,其余是参数。返回 1 表示删掉了,0 表示锁已经不是我的。
- `handle_ticket, args=(w, "T-200", 0.5, 2000)` 实验一:处理要 0.5 秒,锁寿命 2 秒,够用。
- `threading.Thread(target=handle_ticket, args=("worker-A", "T-201", 1.0, 300))` 实验二:处理要 1 秒,锁只有 0.3 秒寿命。
- `time.sleep(0.5)` 等 0.5 秒,此时 worker-A 的锁已经过期(0.3 秒),但它还在干活。
- `handle_ticket("worker-B", "T-201", 0.1, 300)        # 锁已过期,B 拿到了,A 和 B 同时在处理` B 顺利拿到了锁。

</div>

```bash
uv run python part10/platform/ticket_lock.py
```

```text
一、两个 worker 同时抢 T-200,处理要 0.5 秒,锁寿命 2 秒:
  [worker-A] 拿到 T-200 的锁,开始处理
  [worker-B] T-200 已经有人在处理,跳过
  [worker-A] 处理完,释放锁:成功
二、处理比锁寿命长(1 秒 vs 0.3 秒),worker-A 还在干活时锁过期了:
  [worker-A] 拿到 T-201 的锁,开始处理
  [worker-B] 拿到 T-201 的锁,开始处理
  [worker-B] 处理完,释放锁:成功
  [worker-A] 处理完,释放锁:失败(锁早已过期,可能被别人拿走了)
```

实验一没问题:B 拿不到锁,跳过。实验二暴露了锁的固有缺陷:**锁一定要有过期时间**(不然拿锁的 worker 崩了,锁永远不释放,这张工单永远没人处理),**而过期时间又意味着,干活比锁寿命长的时候,锁会在你还没干完时失效**。A 释放时发现「失败,锁早已过期」,但 A 和 B 已经重叠处理了一段时间。

所以锁只能当「大多数情况下避免重复」的优化,不能当最后一道防线。最后一道防线还是幂等:`result:T-101` 的 `SET NX`,或者数据库里的唯一约束。Martin Kleppmann 有一篇经典文章专门讲这一点(链接在学习资料里),Redis 官方文档里的 Redlock 算法也被他批评过。你只要记住:要用锁,先想好锁失效了会怎样。

### 检索库:pgvector 起步,但要知道带租户过滤的坑

向量检索的基本原理 [Day 233](/blog/agent-zero/day-233-hnsw/) 讲过:HNSW 索引是一张分层的近邻图,查询从图里「爬」出一批候选再排序,代价是近似,有时会漏。多租户平台把知识库放在同一张表里,每条查询要加 `WHERE tenant_id = '...'`。问题来了:**HNSW 是先在图里找出一批近邻候选(默认 `hnsw.ef_search = 40` 个),再按 `WHERE` 过滤**。如果这个租户只占全表的 2%,那 40 个候选里平均只有不到 1 个是它的。结果是你要 10 条,只返回 0 到 1 条,而且没有任何报错。

pgvector 的 README 里对这点写得很直白(举的例子是一个条件匹配 10% 的行,默认设置下平均只能拿到约 4 条)。下面我们复现它:一张 5 万行的表,云簿 49,000 行、Maple 1,000 行(2%),向量是随机的 16 维。

```python
# agent-zero-lab/part10/platform/vector_filter.py
"""pgvector 里「带租户过滤的向量检索」:HNSW 索引先找近邻、再过滤租户,小租户可能一行都剩不下。
在自己新建的库 agentzero_w585 里做(先 createdb agentzero_w585),不碰别的库。
用法:uv run python part10/platform/vector_filter.py
uv add "psycopg[binary]"
"""
import random
import time

import psycopg

DSN = "host=localhost dbname=agentzero_w585"
K = 10


def setup(conn: psycopg.Connection) -> None:
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    conn.execute("DROP TABLE IF EXISTS chunks")
    conn.execute("CREATE TABLE chunks (id serial PRIMARY KEY, tenant_id text NOT NULL, emb vector(16))")
    # 向量用 random() 造:云簿 49000 条,Maple 1000 条(占 2%)
    for tenant, n in (("yunbu", 49000), ("maple", 1000)):
        conn.execute(
            "INSERT INTO chunks (tenant_id, emb) "
            "SELECT %s, (SELECT array_agg(random()) FROM generate_series(1, 16) WHERE g = g)::vector "
            "FROM generate_series(1, %s) g", (tenant, n))
    t0 = time.perf_counter()
    conn.execute("CREATE INDEX chunks_hnsw ON chunks USING hnsw (emb vector_l2_ops)")
    print(f"HNSW 索引建好,{time.perf_counter() - t0:.1f} 秒")
    conn.execute("ANALYZE chunks")


def search(conn: psycopg.Connection, q: str, tenant: str) -> list[int]:
    rows = conn.execute(
        "SELECT id FROM chunks WHERE tenant_id = %s ORDER BY emb <-> %s::vector LIMIT %s", (tenant, q, K)).fetchall()
    return [r[0] for r in rows]


def exact(conn: psycopg.Connection, q: str, tenant: str) -> list[int]:
    """标准答案:关掉索引,全表精确排序。"""
    with conn.transaction():
        conn.execute("SET LOCAL enable_indexscan = off")
        return search(conn, q, tenant)


if __name__ == "__main__":
    with psycopg.connect(DSN, autocommit=True) as conn:
        have = conn.execute("SELECT to_regclass('chunks')").fetchone()
        if not (have and have[0]):                      # 表已经建好就不重建,建 HNSW 索引要将近一分钟
            setup(conn)
        conn.execute("DROP INDEX IF EXISTS chunks_maple")   # 重跑时先去掉后面才建的局部索引
        random.seed(585)
        queries = ["[" + ",".join(f"{random.random():.4f}" for _ in range(16)) + "]" for _ in range(20)]
        for label, setting in (("默认(ef_search=40)", None),
                               ("开迭代扫描 hnsw.iterative_scan=relaxed_order", "relaxed_order")):
            if setting:
                conn.execute("SELECT set_config('hnsw.iterative_scan', %s, false)", (setting,))
            counts, hits = [], 0
            for q in queries:
                got, truth = search(conn, q, "maple"), exact(conn, q, "maple")
                counts.append(len(got))
                hits += len(set(got) & set(truth))
            print(f"{label}:20 次查询,每次返回的行数 {counts}")
            print(f"   和精确结果的重合:{hits}/{K * len(queries)}")
        conn.execute("RESET hnsw.iterative_scan")

        conn.execute("CREATE INDEX chunks_maple ON chunks USING hnsw (emb vector_l2_ops) WHERE tenant_id = 'maple'")
        plan = conn.execute("EXPLAIN SELECT id FROM chunks WHERE tenant_id = 'maple' ORDER BY emb <-> %s::vector LIMIT 10",
                            (queries[0],)).fetchall()
        print("给 maple 单建局部索引后的计划:", plan[1][0].strip())
        counts = [len(search(conn, q, "maple")) for q in queries]
        print(f"   局部索引,每次返回的行数 {counts}")
```

<div class="line-notes">

- `DSN = "host=localhost dbname=agentzero_w585"` 连自己新建的库。用户名不写,默认是你的系统用户名(Postgres.app 下无密码)。
- `K = 10` 每次要 10 条。
- `conn.execute("CREATE EXTENSION IF NOT EXISTS vector")` 启用 pgvector,这是 [Day 229](/blog/agent-zero/day-229-pgvector-1/) 做过的事,在这个新库里要再做一次。
- `conn.execute("CREATE TABLE chunks (id serial PRIMARY KEY, tenant_id text NOT NULL, emb vector(16))")` `emb vector(16)` 是 16 维的向量列。为了实验跑得快,只用 16 维。
- `("yunbu", 49000), ("maple", 1000)` 两个租户的行数。Maple 占 2%。
- `"SELECT %s, (SELECT array_agg(random()) FROM generate_series(1, 16) WHERE g = g)::vector "` 造数据:对每一行(`g` 是外层 `generate_series` 的行号),里面的子查询生成 16 个随机数聚成数组,再转成 `vector`。`WHERE g = g` 看起来没意义,作用是让子查询依赖外层的 `g`,于是每一行都重新算一遍,不然 Postgres 会算一次、所有行共用同一个向量。
- `CREATE INDEX chunks_hnsw ON chunks USING hnsw (emb vector_l2_ops)` 建 HNSW 索引,按 L2 距离。5 万行 16 维在我这台 2019 年的笔记本上花了 57.7 秒,建完才有后面的结果。
- `ORDER BY emb <-> %s::vector LIMIT %s` `<->` 是 L2 距离运算符,按离查询向量近到远排,取前 K 条。`WHERE tenant_id = %s` 在它前面。
- `conn.execute("SET LOCAL enable_indexscan = off")` 关掉索引扫描,强迫 Postgres 全表算距离再排序。这样得到的是精确的标准答案,用来给近似结果算「重合度」。`SET LOCAL` 只在当前事务内有效。
- `have = conn.execute("SELECT to_regclass('chunks')").fetchone()` 表是否已经存在,存在就不重建,免得每次重跑都等一分钟建索引。
- `conn.execute("DROP INDEX IF EXISTS chunks_maple")   # 重跑时先去掉后面才建的局部索引` 脚本最后会给 Maple 建局部索引,重跑时要先删掉,否则默认那一组也会走局部索引,看不到问题。
- `queries = ["[" + ",".join(f"{random.random():.4f}" for _ in range(16)) + "]" for _ in range(20)]` 20 个随机查询向量,写成 pgvector 认的文本格式 `[0.1,0.2,...]`。
- `"SELECT set_config('hnsw.iterative_scan', %s, false)"` 打开**迭代扫描**:索引扫完第一批候选发现过滤后不够 K 条,就接着往下扫,直到够为止。这是 pgvector 0.8.0 加的功能,`relaxed_order` 允许结果顺序略有出入以换取召回。
- `CREATE INDEX chunks_maple ON chunks USING hnsw (emb vector_l2_ops) WHERE tenant_id = 'maple'` 第二种修法:只给 Maple 的行单建一个**局部索引**,查 Maple 时索引里只有它自己的 1,000 行,没有过滤丢行的问题。
- `plan[1][0].strip()` `EXPLAIN` 返回的第二行,能看到是不是用了 `chunks_maple` 这个索引。

</div>

```bash
uv run python part10/platform/vector_filter.py
```

```text
默认(ef_search=40):20 次查询,每次返回的行数 [1, 1, 1, 1, 0, 1, 1, 0, 0, 4, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]
   和精确结果的重合:14/200
开迭代扫描 hnsw.iterative_scan=relaxed_order:20 次查询,每次返回的行数 [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
   和精确结果的重合:200/200
给 maple 单建局部索引后的计划: ->  Index Scan using chunks_maple on chunks  (cost=77.76..2487.96 rows=998 width=12)
   局部索引,每次返回的行数 [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]
```

默认设置下 20 次查询,每次只返回 0 到 4 行(最多的一次 4 行),应该有 10 行;和精确结果一对,200 个应该命中的,命中了 14 个。没有报错,没有警告,只是少了,用户感受到的是「这个租户的知识库怎么什么都搜不到」。

打开迭代扫描以后,每次都是 10 行,和精确结果完全重合(200/200)。给 Maple 单建局部索引也是 10 行,计划里显示用了 `chunks_maple`。

两种修法各有取舍:迭代扫描一行配置就好,但小租户占比越小,索引要多扫的越多,查询变慢;局部索引查得又快又准,但每个租户一个索引,租户几千个以后管不过来。折中的做法是:大租户一个局部索引或一个分区,小租户共用大表加迭代扫描。再往上,到独立的向量库,每家的做法(按租户分 collection、分片)不同,但同样的问题 [Day 233](/blog/agent-zero/day-233-hnsw/) 的「为什么会漏」都要重新问一遍。

什么时候该离开 pgvector,没有标准答案。常见的信号有:向量量级到了千万以上、检索的并发把主库拖慢了、或者检索负载和业务读写需要分别扩容。门槛请用你自己的数据和压测来定,不要抄别人文章里的数字。

### 对象存储:大东西放外面,上下文里只留引用

最后一个。Agent 调了一个「列出所有发票」的工具,返回 600 条,每条是一个 JSON 对象。直接把它塞进上下文,既贵又会把模型淹没;塞进 Postgres 或 trace 里,库会很快膨胀。常见做法是**把原文放进对象存储,上下文里只放一段摘要加一个引用**,需要细节时再让模型调一个读取工具按行取。这个思路 [Day 528](/blog/agent-zero/day-528-layered-compaction/) 讲上下文压缩时会再碰到。

对象存储(AWS 的 S3、阿里云 OSS、自建的 S3 兼容服务)是按 key 存取整个文件的服务,便宜、容量几乎无限,但不适合频繁小改。我这台机器没有 S3 也没有 MinIO,所以用本地一个 `blobs/` 目录充当它:接口只有 `put`(存进去拿 key)和 `get`(用 key 取出来),换成真的 S3 只改这两个函数。

```python
# agent-zero-lab/part10/platform/blob_ref.py
"""大工具结果别塞进上下文:原文放进「对象存储」,给模型一段摘要加一个引用。
没有 S3/MinIO,所以用一个本地目录当对象存储:接口只有 put(拿 key)和 get(用 key 取),换成真的 S3 只改这两个函数。
用法:uv run python part10/platform/blob_ref.py
"""
import hashlib
import json
import os
import random
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

STORE = Path("blobs")           # 在 agent-zero-lab 根目录下的 blobs/ 目录,模拟一个 bucket


def put(tenant: str, data: bytes) -> str:
    """key = 租户前缀 + 内容哈希。租户在 key 里,换成 S3 时就是 bucket 里的前缀,权限策略可以按前缀写。"""
    key = f"{tenant}/{hashlib.sha256(data).hexdigest()[:16]}"
    path = STORE / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return key


def get(tenant: str, key: str) -> bytes:
    if not key.startswith(f"{tenant}/") or ".." in key:
        raise PermissionError(f"租户 {tenant} 不能读 {key}")
    return (STORE / key).read_bytes()


def fake_list_invoices(n: int) -> list[dict]:
    random.seed(585)
    return [{"invoice_id": f"INV-{20000 + i}", "customer": f"客户{random.randint(1, 300):03d}",
             "amount_cny": round(random.uniform(200, 20000), 2),
             "status": random.choice(["paid", "paid", "paid", "overdue", "open"]),
             "note": "按月订阅费,含 3 个席位和 1 个 API 项目"} for i in range(n)]


def summarize(rows: list[dict]) -> str:
    overdue = [r for r in rows if r["status"] == "overdue"]
    return (f"共 {len(rows)} 张发票,逾期 {len(overdue)} 张,逾期金额合计 "
            f"{sum(r['amount_cny'] for r in overdue):.2f} 元。")


def prompt_tokens(client: OpenAI, content: str) -> int:
    resp = client.chat.completions.create(
        model=os.environ["LLM_MODEL"], max_tokens=1,
        messages=[{"role": "user", "content": content}],
        extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}")))
    return resp.usage.prompt_tokens if resp.usage else -1


if __name__ == "__main__":
    load_dotenv()
    rows = fake_list_invoices(600)
    raw = json.dumps(rows, ensure_ascii=False)
    key = put("yunbu", raw.encode())
    ref_text = f"{summarize(rows)} 完整明细在 blob://{key}(需要时用 read_blob 工具按行读取)。"

    print(f"原文 {len(raw)} 字符;给模型的引用文本 {len(ref_text)} 字符")
    print("引用文本:", ref_text)
    print("存下来的 key:", key, "| 磁盘文件大小:", (STORE / key).stat().st_size, "字节")
    try:
        get("maple", key)
    except PermissionError as e:
        print("别的租户来取:", e)

    client = OpenAI(base_url=os.environ["LLM_BASE_URL"], api_key=os.environ["LLM_API_KEY"])
    a = prompt_tokens(client, raw)
    b = prompt_tokens(client, ref_text)
    print(f"DeepSeek 报的输入 token:原文 {a},引用 {b}")
    price_miss = float(os.environ["LLM_PRICE"].split(",")[1])        # 元/百万 token,未命中缓存价
    print(f"每多放进上下文一次原文,按未命中价 {price_miss} 元/百万 token 算 ≈ {a * price_miss / 1e6:.4f} 元,引用 ≈ {b * price_miss / 1e6:.6f} 元")
```

<div class="line-notes">

- `STORE = Path("blobs")           # 在 agent-zero-lab 根目录下的 blobs/ 目录,模拟一个 bucket` bucket 是 S3 里「存放对象的容器」的叫法,这里一个目录就是一个 bucket。
- `key = f"{tenant}/{hashlib.sha256(data).hexdigest()[:16]}"` key 由租户前缀加内容哈希的前 16 位组成,实跑是 `yunbu/348b64b437dace11`。内容相同,key 相同,重复存同一份数据不会占两份空间。租户放在前缀里,换成 S3 时权限策略可以按前缀写「只允许这个租户读 `yunbu/*`」。
- `path.parent.mkdir(parents=True, exist_ok=True)` 租户目录不存在就先建。
- `if not key.startswith(f"{tenant}/") or ".." in key:` 取之前检查两件事:key 必须以自己租户开头;key 里不能有 `..`(防止 `yunbu/../maple/xxx` 这种跳出目录的写法)。
- `raise PermissionError(f"租户 {tenant} 不能读 {key}")` 不该读的直接拒绝。实跑里 Maple 去取云簿的 key,被挡在这一行。
- `random.seed(585)` 固定随机种子,你跑出来的发票和我的一样。
- `"note": "按月订阅费,含 3 个席位和 1 个 API 项目"` 每条发票带一段固定的备注,让每条的长度接近真实工具返回。
- `overdue = [r for r in rows if r["status"] == "overdue"]` 逾期的发票,实跑是 124 张。
- `max_tokens=1,` 这个调用只是为了拿 `usage` 里的输入 token 数,模型回什么不重要,所以只让它生成 1 个 token,省钱。
- `extra_body=json.loads(os.environ.get("LLM_EXTRA_BODY", "{}"))` 把 `.env` 里的额外参数(关掉思考)透传出去。
- `return resp.usage.prompt_tokens if resp.usage else -1` 接口报出的输入 token 数。
- `raw = json.dumps(rows, ensure_ascii=False)` 600 条发票转成一个 JSON 字符串,77,398 个字符。
- `ref_text = f"{summarize(rows)} 完整明细在 blob://{key}(需要时用 read_blob 工具按行读取)。"` 给模型的版本:一句话摘要加引用,99 个字符。
- `price_miss = float(os.environ["LLM_PRICE"].split(",")[1])` `.env` 里的 `LLM_PRICE` 是「缓存命中, 未命中, 输出」三个数(元/百万 token),取第二个,即 2.0。

</div>

```bash
uv run python part10/platform/blob_ref.py
```

```text
原文 77398 字符;给模型的引用文本 99 字符
引用文本: 共 600 张发票,逾期 124 张,逾期金额合计 1328145.47 元。 完整明细在 blob://yunbu/348b64b437dace11(需要时用 read_blob 工具按行读取)。
存下来的 key: yunbu/348b64b437dace11 | 磁盘文件大小: 95398 字节
别的租户来取: 租户 maple 不能读 yunbu/348b64b437dace11
DeepSeek 报的输入 token:原文 34914,引用 59
每多放进上下文一次原文,按未命中价 2.0 元/百万 token 算 ≈ 0.0698 元,引用 ≈ 0.000118 元
```

原文 77,398 个字符,换成引用只有 99 个;DeepSeek 报的输入 token 从 34,914 降到 59。按我们 `.env` 里 `LLM_PRICE` 的未命中价 2 元每百万 token 算:34,914 × 2 ÷ 1,000,000 ≈ 0.0698 元。一次也就七分钱,但 Agent 循环里这份原文会在后面每一轮都被重新送一遍(除非走上了缓存),累积起来才是大头。我为了写这一节把脚本跑了三次,加起来约 0.21 元,是今天唯一的花费。

别的租户去取这个 key 会被拒绝。这也是把租户写进 key 前缀的原因:权限检查可以做得又笨又牢靠。

## 对照一个真实系统:Langfuse 自托管

上面这四样,拼在一起是什么样子?一个现成的参照是 Langfuse(后面的可观测那几天会接它)的自托管架构(2026 年 10 月看到的是 v4 文档):Web 服务管界面和接口,Worker 异步处理事件;Postgres 放事务数据,ClickHouse 放 trace、observation 和评分,Redis 或 Valkey 兼做缓存和任务队列,S3 一类的对象存储放进来的原始事件、多模态附件和大导出。它没有用 Kafka。

放进今天的框架里看:Web 是控制面加一部分数据面,Worker 是纯数据面;Redis 在它这里同时当缓存和队列,说明一样东西往往身兼数职;进来的原始事件先落对象存储,队列里只放引用,数据本身在对象里,这和我们 `blob_ref.py` 的思路一样。

## 动手练习

**练习 1(改代码)**:控制面挂了很久,数据面手里的快照越来越旧。在 `plane_sync.py` 的 `CachedGateway` 基础上写一个子类:超过 20 秒没拉成功,每个请求记一次告警;超过 45 秒,拒绝快照里没见过的租户(返回 `503`),老租户照常服务。用同一个 120 秒的时间线跑,汇报老租户、新租户各被拒了多少个、一共产生多少条告警。

<details><summary>参考答案</summary>

新建 `part10/platform/stale_guard.py`:

```python
# agent-zero-lab/part10/platform/stale_guard.py
"""练习 1 参考答案:快照太旧时数据面该怎么办。在 plane_sync.py 的 CachedGateway 上加两道规矩:
超过 WARN_AFTER 秒没拉成功,每个请求都记一条告警;超过 FREEZE_AFTER 秒,拒绝「新租户」(快照里没见过的),老租户照常服务。
用法:uv run python part10/platform/stale_guard.py
"""
from plane_sync import CachedGateway, Clock, ControlPlane, ControlPlaneDown

WARN_AFTER = 20.0
FREEZE_AFTER = 45.0


class GuardedGateway(CachedGateway):
    def __init__(self, cp: ControlPlane, clock: Clock, interval: float, known: set[str]) -> None:
        super().__init__(cp, clock, interval)
        self.known = known                          # 快照里见过的租户;真实系统里它就是快照的一部分
        self.last_ok = clock.now
        self.warnings = 0

    def maybe_refresh(self) -> None:
        if self.clock.now - self.last_pull < self.interval:
            return
        self.last_pull = self.clock.now
        try:
            self.snap = self.cp.fetch_snapshot()
            self.last_ok = self.clock.now           # 只有真正拉成功了才更新「上次成功时间」
        except ControlPlaneDown:
            pass

    def handle(self, tenant: str) -> str:
        self.maybe_refresh()
        age = self.clock.now - self.last_ok
        if age > WARN_AFTER:
            self.warnings += 1
        if age > FREEZE_AFTER and tenant not in self.known:
            return "503"                            # 快照太旧,不认识的租户先别放行
        return "403" if tenant in self.snap.paused else "200"


if __name__ == "__main__":
    clock = Clock()
    cp = ControlPlane(clock)
    gw = GuardedGateway(cp, clock, interval=8, known={"maple", "yunbu"})
    seen: dict[str, list[str]] = {"maple": [], "newco": []}
    for sec in range(120):
        clock.now = float(sec)
        for t in seen:
            seen[t].append(gw.handle(t))
    print("maple(老租户)  第 100 秒前后:", seen["maple"][98:103], "全程 503 个数:", seen["maple"].count("503"))
    print("newco(新租户)  第 40 到 100 秒里被拒的秒数:", [i for i, c in enumerate(seen["newco"]) if c == "503"][:1], "…",
          [i for i, c in enumerate(seen["newco"]) if c == "503"][-1:], f"共 {seen['newco'].count('503')} 个")
    print("告警条数(每个请求一条,两个租户合计):", gw.warnings)
```

<div class="line-notes">

- `from plane_sync import CachedGateway, Clock, ControlPlane, ControlPlaneDown` 直接复用上面 `plane_sync.py` 里的类。
- `WARN_AFTER = 20.0` 超过 20 秒没拉成功开始告警。
- `FREEZE_AFTER = 45.0` 超过 45 秒进入「冻结」:不认识的租户不放行。
- `class GuardedGateway(CachedGateway):` 继承 `CachedGateway`,只改刷新和处理两个方法。
- `self.known = known                          # 快照里见过的租户;真实系统里它就是快照的一部分` 这里为了简单直接传入一个集合。
- `self.last_ok = clock.now` 上次**拉取成功**的时间。注意和父类的 `last_pull`(上次**尝试**的时间)不是一回事,失败的尝试不能更新它。
- `self.last_ok = self.clock.now           # 只有真正拉成功了才更新「上次成功时间」` 这行放在 `fetch_snapshot()` 成功之后,抛了异常就走不到。
- `age = self.clock.now - self.last_ok` 快照的「年龄」。
- `if age > WARN_AFTER:` 超过 20 秒,`self.warnings += 1`。
- `if age > FREEZE_AFTER and tenant not in self.known:` 又过期、又不认识,才返回 503。
- `gw = GuardedGateway(cp, clock, interval=8, known={"maple", "yunbu"})` 拉取间隔 8 秒。控制面第 40 秒起不可用,最后一次拉成功是第 32 秒。
- `seen: dict[str, list[str]] = {"maple": [], "newco": []}` 两个租户每秒各一个请求,`maple` 是老租户,`newco` 是快照里没见过的。
- `[i for i, c in enumerate(seen["newco"]) if c == "503"][:1]` 找出第一次被拒的秒数。

</div>

```bash
uv run python part10/platform/stale_guard.py
```

```text
maple(老租户)  第 100 秒前后: ['200', '200', '200', '200', '200'] 全程 503 个数: 0
newco(新租户)  第 40 到 100 秒里被拒的秒数: [78] … [103] 共 26 个
告警条数(每个请求一条,两个租户合计): 102
```

最后一次成功拉取是第 32 秒,32 + 45 = 77,所以新租户从第 78 秒起被拒。控制面第 100 秒恢复,但下一次拉取要等到第 104 秒,所以第 78 到 103 秒共 26 个请求被拒。老租户一个 503 都没有,服务没有受影响。告警条数是 102,两个租户每秒各一个请求,从第 53 秒(32 + 20 之后)到第 103 秒。

这个版本有个取舍你可以想一想:冻结以后连「被暂停」的变更也不知道了。如果想更保守,冻结时可以连老租户一起降级(比如只放行只读的请求)。

</details>

**练习 2(观察会发生什么)**:`shared_counter.py` 里用的是**固定窗口**计数:每分钟一个 key,到点自动清零。规则是「每分钟最多 60 个」。如果一个租户在第 59 秒发了 60 个,第 60 秒又发了 60 个,会发生什么?写一个不连 Valkey 的小脚本,用假时间验证,然后说说这对下一课的限流算法有什么启发。

<details><summary>参考答案</summary>

新建 `part10/platform/window_burst.py`:

```python
# agent-zero-lab/part10/platform/window_burst.py
"""练习 2 参考答案:固定窗口计数的边界突发。规则「每分钟 60 个」,窗口按整分钟切。用假时间,不连 Valkey。
用法:uv run python part10/platform/window_burst.py
"""
from collections import Counter

LIMIT = 60


def run(arrivals: list[float]) -> list[float]:
    """返回被放行的请求的到达时间。窗口编号 = 第几分钟 = int(t // 60)。"""
    counts: Counter[int] = Counter()
    passed: list[float] = []
    for t in sorted(arrivals):
        window = int(t // 60)
        counts[window] += 1
        if counts[window] <= LIMIT:
            passed.append(t)
    return passed


if __name__ == "__main__":
    # 第 59.0–59.9 秒集中来 60 个,第 60.0–60.9 秒又集中来 60 个
    arrivals = [59 + i / 100 for i in range(60)] + [60 + i / 100 for i in range(60)]
    passed = run(arrivals)
    print(f"发了 {len(arrivals)} 个,放行 {len(passed)} 个")
    span = max(passed) - min(passed)
    print(f"这 {len(passed)} 个放行的请求,最早 {min(passed):.2f} 秒,最晚 {max(passed):.2f} 秒,挤在 {span:.2f} 秒里")
    in_any_minute = max(sum(1 for p in passed if s <= p < s + 60) for s in [x for x in passed])
    print(f"任意连续 60 秒里最多放行 {in_any_minute} 个(规则本意是 60)")
```

<div class="line-notes">

- `counts: Counter[int] = Counter()` 每个窗口各自一个计数,键是窗口编号。
- `window = int(t // 60)` 窗口编号 = 第几分钟。`59.5 // 60` 是 0,`60.2 // 60` 是 1。`//` 是整除(向下取整)。
- `if counts[window] <= LIMIT:` 这个窗口里的前 60 个放行。
- `arrivals = [59 + i / 100 for i in range(60)] + [60 + i / 100 for i in range(60)]` 第 59.00 到 59.59 秒来 60 个,第 60.00 到 60.59 秒又来 60 个,中间只隔一个窗口边界。
- `span = max(passed) - min(passed)` 放行的请求最早和最晚相差多少秒。
- `in_any_minute = max(sum(1 for p in passed if s <= p < s + 60) for s in [x for x in passed])` 以每个放行请求的时刻为起点,数它之后 60 秒里放行了多少个,取最大值,就是「任意连续 60 秒」里实际放行的上限。

</div>

```bash
uv run python part10/platform/window_burst.py
```

```text
发了 120 个,放行 120 个
这 120 个放行的请求,最早 59.00 秒,最晚 60.59 秒,挤在 1.59 秒里
任意连续 60 秒里最多放行 120 个(规则本意是 60)
```

120 个全部放行,挤在 1.59 秒里。每个窗口各自看都没超 60,但横跨窗口边界的任意 60 秒里,放行了 120 个,是规则本意的两倍。固定窗口的「每分钟 60 个」只在窗口内成立,不保证滑动的任意一分钟成立。对供应商那边的限流,这种两倍的突发就足够触发 429。下一课的令牌桶用「桶里的余额随时间连续补充」代替「到点清零」,就是为了去掉这个边界。

</details>

**练习 3(观察会发生什么)**:把 `stream_queue.py` 里的处理逻辑换成「每处理一次就给云簿的用量加一」(`INCR credits_used:yunbu`),同样让 worker-A 在 T-301 上崩溃、worker-B 接管,最后用量是多少?再把它改成幂等的,对比。

<details><summary>参考答案</summary>

新建 `part10/platform/exercise_dup.py`,复用 `stream_queue.py` 里的 `enqueue`、`run_worker` 等,只替换处理函数:

```python
# agent-zero-lab/part10/platform/exercise_dup.py
"""练习 3 参考答案:把幂等的处理逻辑换成「每次都加一」,看 worker 崩溃重投以后会怎样。
用法:uv run python part10/platform/exercise_dup.py
"""
import json
import time

import stream_queue as q


def process_not_idempotent(job_id: str, payload: dict, worker: str) -> None:
    n = q.r.incr(f"credits_used:{payload['tenant']}")        # 每处理一次就扣一个点数
    print(f"  [{worker}] 处理 {payload['ticket']},yunbu 已用点数 = {n}")


def process_idempotent(job_id: str, payload: dict, worker: str) -> None:
    first = q.r.set(f"done:{payload['ticket']}", job_id, nx=True)   # 这张工单第一次处理才扣
    if first:
        n = q.r.incr(f"credits_used:{payload['tenant']}")
        print(f"  [{worker}] 处理 {payload['ticket']},yunbu 已用点数 = {n}")
    else:
        print(f"  [{worker}] {payload['ticket']} 已处理过,跳过")


def scenario(process) -> None:
    q.process = process                                   # 把队列里的处理函数换掉
    q.r.delete(q.STREAM, "credits_used:yunbu", *q.r.keys("done:*"))
    q.r.xgroup_create(q.STREAM, q.GROUP, id="0", mkstream=True)
    for i in range(3):
        q.enqueue("yunbu", f"T-{300 + i}")
    q.run_worker("worker-A", 3, crash_before_ack_on="T-301")
    time.sleep(0.6)
    for job_id, fields in q.r.xautoclaim(q.STREAM, q.GROUP, "worker-B", min_idle_time=500, start_id="0")[1]:
        process(job_id, json.loads(fields["payload"]), "worker-B")
        q.r.xack(q.STREAM, q.GROUP, job_id)
    q.r.xgroup_destroy(q.STREAM, q.GROUP)
    print(f"  最终点数 = {q.r.get('credits_used:yunbu')}(3 张工单,应该是 3)")


if __name__ == "__main__":
    print("== 不幂等")
    scenario(process_not_idempotent)
    print("== 幂等")
    scenario(process_idempotent)
```

<div class="line-notes">

- `import stream_queue as q` 把上面的 `stream_queue.py` 当模块导入。它的主程序在 `if __name__ == "__main__":` 里,导入时不会执行。
- `n = q.r.incr(f"credits_used:{payload['tenant']}")        # 每处理一次就扣一个点数` 不幂等的版本:处理一次加一,不管这张工单有没有处理过。
- `first = q.r.set(f"done:{payload['ticket']}", job_id, nx=True)   # 这张工单第一次处理才扣` 幂等的版本:先用 `SET NX` 抢「这张工单已处理」的标记,抢到的才扣点数。
- `q.process = process                                   # 把队列里的处理函数换掉` 给 `stream_queue` 模块里的 `process` 换成我们的版本。`run_worker` 在调用时才去找 `process` 这个名字,所以替换生效。
- `q.run_worker("worker-A", 3, crash_before_ack_on="T-301")` 这次丢 3 个任务(T-300、T-301、T-302),worker-A 把 3 个都取走,处理 T-300、T-301 后在 T-301 上崩溃。
- `q.r.xgroup_destroy(q.STREAM, q.GROUP)` 用完把消费者组删掉,下一轮实验重新建。

</div>

```bash
uv run python part10/platform/exercise_dup.py
```

```text
== 不幂等
  [worker-A] 处理 T-300,yunbu 已用点数 = 1
  [worker-A] 处理 T-301,yunbu 已用点数 = 2
  [worker-A] 在确认前崩溃了!任务 1793082466699-0 留在待确认列表里
  [worker-B] 处理 T-301,yunbu 已用点数 = 3
  [worker-B] 处理 T-302,yunbu 已用点数 = 4
  最终点数 = 4(3 张工单,应该是 3)
== 幂等
  [worker-A] 处理 T-300,yunbu 已用点数 = 1
  [worker-A] 处理 T-301,yunbu 已用点数 = 2
  [worker-A] 在确认前崩溃了!任务 1793082467305-0 留在待确认列表里
  [worker-B] T-301 已处理过,跳过
  [worker-B] 处理 T-302,yunbu 已用点数 = 3
  最终点数 = 3(3 张工单,应该是 3)
```

不幂等的版本:3 张工单,最后点数是 4,T-301 被重复扣了一次,而且没有任何报错,账平不了。幂等的版本:第二次遇到 T-301 打印「已处理过,跳过」,点数是 3。(任务 id 里的时间戳每次不同。)

注意幂等版本在 worker-A 崩溃时的细节:它在 `SET NX` 成功之后、`INCR` 之前如果崩了,这张工单就永远不会被扣点数了。要完全正确,「标记已处理」和「扣点数」要放进同一个事务里,或者让结果本身带着去重键(比如数据库里 `UNIQUE(ticket)`)。这个题给的是最小版本。

</details>

**练习 4(开放题)**:你的平台有 3 个租户、网关 4 个实例。下面 8 样东西,各应该放在 Postgres、Valkey、对象存储、队列里的哪一个?写出你的选择和一句理由:①租户配置快照 ②每分钟限流计数 ③用户上传的 PDF ④一次 Agent 运行的 checkpoint ⑤要总结的长文档任务 ⑥工具返回的 8 万字符 JSON ⑦知识库切片和向量 ⑧每次模型调用的用量记录。

<details><summary>参考答案</summary>

没有唯一答案,下面是我的选择:

| 东西 | 放哪 | 理由 |
| --- | --- | --- |
| ① 租户配置快照 | Postgres 是真相源,数据面本地内存是缓存,可选 Valkey 做分发 | 配置要可审计、有版本;数据面只读自己的内存,不在请求路径上问任何人 |
| ② 每分钟限流计数 | Valkey | 多实例共享的计数,要原子 `INCR` 加自动过期,数据丢了影响一分钟 |
| ③ 用户上传的 PDF | 对象存储 | 大文件,不会被频繁小改;数据库里只存 key |
| ④ Agent 运行的 checkpoint | Postgres | 要事务、要和运行记录一起查,丢了就不能续跑 |
| ⑤ 长文档总结任务 | 队列 | 活太长,不能让用户的请求等;消息里放租户和文档的 key,不放正文 |
| ⑥ 工具返回的 8 万字符 JSON | 对象存储,上下文里放摘要加引用 | 和 `blob_ref.py` 同一个思路 |
| ⑦ 知识库切片和向量 | Postgres + pgvector(量级小时) | 和业务数据一个库,能用 RLS 隔离;注意带租户过滤的召回 |
| ⑧ 每次模型调用的用量记录 | 先进队列异步落库,量大以后进分析库 | 写入量大、只追加,不能拖慢请求路径;账要对得上,所以不能丢,队列要有确认 |

评价标准:①②⑥的答案最容易错。②如果答了 Postgres,每次请求一次写库,限流本身就成了瓶颈;⑥如果答了 Postgres 或「直接放上下文」,就没理解今天最后一节。

</details>

**验收标准**:`plane_sync.py` 的两列结果能和文章对上(500 的个数、暂停生效的时刻);`shared_counter.py` 三种做法的放行数分别是 90、60(串行)/160(并发先读后写)、60;`stream_queue.py` 最后待确认为 0、5 张工单都有结果;`vector_filter.py` 默认设置下返回行数明显少于 10,打开迭代扫描后全是 10。四个练习做完,能不看文章讲清「为什么数据面不能同步问控制面」和「为什么队列要配幂等」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 控制面(control plane) | 管「配置」的那部分:租户、Agent 定义、授权、预算、密钥。改得少,可以慢,要可审计 |
| 数据面(data plane) | 管「每个请求怎么执行」的那部分:网关、运行时、工具调用、用量管道。要快,控制面挂了也得继续跑 |
| 配置快照 | 控制面把当前配置打包成带版本号的只读副本,下发给数据面,数据面存在本地内存里 |
| 版本号 | 每改一次配置加一。数据面用它判断自己手里的是不是最新的、中间有没有丢消息 |
| 推送(pub/sub) | 发布订阅:一方往频道里发消息,所有订阅了这个频道的接收方立刻收到。发完即忘,订阅者不在就丢 |
| Valkey | Redis 的一个 BSD 许可分支,命令兼容,Python 的 `redis` 库可以直接连 |
| 竞态(race condition) | 结果取决于几个操作谁先谁后。先读再写两步之间别人插进来,就会丢更新 |
| 原子操作 | 在服务端一步做完、中间不会被别的客户端打断的操作,如 `INCR` |
| 固定窗口 | 把时间按整分钟切开,每个窗口各自计数,到点清零。简单,但窗口边界处可能放过两倍的突发 |
| Stream | Valkey/Redis 里的一种追加日志式数据结构,可以当队列用 |
| 消费者组 | 一群 worker 共同消费同一个队列,每条消息只交给组里一个 worker |
| 待确认列表 | 被取走但还没确认处理完的消息。worker 崩溃时,这些消息留在这里等别人接管 |
| `XACK` / `XAUTOCLAIM` | 前者是「这条处理完了」的确认,后者是把闲置太久的待确认消息接到自己名下 |
| 至少执行一次(at-least-once) | 队列保证消息不丢,但可能投递多次。处理逻辑必须能重复执行而不出事 |
| 分布式锁 | 多个进程之间互斥的一把锁,通常是一个带过期时间的 key。过期了就失效,所以不能当最后防线 |
| 迭代扫描 | pgvector 0.8.0 起的功能:带过滤的向量查询,第一批候选不够数时,索引接着往下扫 |
| 局部索引 | 只给满足某个条件的行建的索引,如只给 `tenant_id = 'maple'` 的行 |
| 对象存储 | S3、OSS 这类按 key 存取整个文件的服务,便宜、容量几乎无限,不适合频繁小改 |
| bucket | 对象存储里存放对象的容器,类似一个顶层目录 |

## 常见误区

**数据面每个请求都同步问控制面。** 我们的实测是控制面挂 60 秒,60 个请求全部 500。配置要做成快照,数据面本地缓存,请求路径上只读自己内存里的。

**只靠推送,不留拉取。** 事件会丢。断线 20 秒、几条消息没收到,数据面就一直活在旧版本里,而且自己不知道。推送要带版本号,对不上就整份重拉,再留一个低频的定时拉取当保险。

**多实例的限流计数各放各的,或者「先读后写」放在共享存储里。** 前者三个实例放行 90 个(上限 60),后者 8 个线程并发时 160 个全放行,Valkey 里的计数只有 36。共享的计数必须用原子命令(`INCR`)。

**以为队列保证「只做一次」。** 它只保证不丢。worker 在确认前崩溃,任务会被别的 worker 再做一遍。我们的账在不幂等的版本里多扣了一个点数。处理逻辑要么幂等,要么靠唯一约束去重。

**把分布式锁当成最后一道防线。** 锁有过期时间,干活比锁寿命长的时候,锁会失效,两个 worker 重叠处理。锁只用来「大多数时候避免重复」,真正的正确性还是靠幂等。

**带租户过滤的向量检索不检查返回行数。** HNSW 先找近邻再过滤,小租户只占 2% 时默认设置下平均只能拿到不到 1 条,20 次查询里最多 4 条,没有任何报错。上线前就该写一个测试:给每个租户跑一批查询,断言返回行数等于 K。

**为了「看起来完整」一上来就装满 Redis、Kafka、Milvus、ES。** 每一样都对应一个具体的问题。没有第二个实例就不需要共享计数,事件量没到每秒几千条就用不着 Kafka。装了就要运维,每多一样,凌晨三点多一个能挂的地方。

**大工具结果直接塞进上下文。** 600 张发票 34,914 个输入 token,约 0.07 元一轮,而且每一轮都会被重新送一遍。原文放对象存储,上下文里放摘要和引用。

## 学习资料

### 文档与文章

- [Kubernetes 文档 · 组件](https://kubernetes.io/docs/concepts/architecture/):控制面(API server、调度器等)和节点上跑业务的那一侧,是最经典的控制面数据面分工实例。可以对照今天的图看一遍,不用读细节,约 20 分钟。
- [Istio · 架构](https://istio.io/latest/docs/ops/deployment/architecture/):服务网格里数据面是一堆代理、控制面负责下发配置。重点看「控制面挂了数据面还能工作」这个设计取舍。
- [Valkey · Streams 介绍](https://valkey.io/topics/streams-intro/):消费者组、待确认列表、`XAUTOCLAIM` 的一手说明,和 [Redis 文档](https://redis.io/docs/latest/develop/data-types/streams/) 基本相通。
- [Valkey · XAUTOCLAIM](https://valkey.io/commands/xautoclaim/) 和 [INCR](https://valkey.io/commands/incr/):今天用到的两个命令的参考页,`INCR` 页面末尾还有用它做限流的几种模式。
- [Martin Kleppmann · How to do distributed locking](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html):为什么带过期时间的锁不能保证互斥,以及 fencing token 的做法。对照今天的实验二读。
- [pgvector README · Filtering](https://github.com/pgvector/pgvector):今天复现的那个坑的出处,讲了 `ef_search`、迭代扫描、局部索引和分区。
- [Langfuse · 自托管架构](https://langfuse.com/self-hosting):一个真实的 LLM 工程平台用了哪几样中间件、各干什么。
- [LiteLLM · 虚拟 key、团队与限流](https://docs.litellm.ai/docs/proxy/users):`tpm`、`rpm` 计数器放在 Redis 里,以及 Redis 不可用时的两种行为。下一课会继续用到。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV193hyzrEuE&autoplay=0&high_quality=1" title="怎么保证消息的幂等性?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>程序员回家养猪 · 怎么保证消息的幂等性? · 2 分 24 秒。队列至少投递一次以后,消费端怎么去重,对照练习 3。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1Pk8M6rEhm&autoplay=0&high_quality=1" title="有了 PostgreSQL,为什么还要 pgvector?" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>计算机大白话 · 有了 PostgreSQL,为什么还要 pgvector? · 约 4 分钟。pgvector 解决什么问题,配合今天「先用 pgvector 起步」那一节看。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/WN8mmHU2HOU" title="Panel: Control Plane vs Data Plane: Untangling the Tenets of Multitenancy" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>CNCF · Panel: Control Plane vs Data Plane: Untangling the Tenets of Multitenancy · 英文座谈,讲多租户系统里控制面和数据面怎么分、隔离怎么落,和昨天今天两课对得上,听个大意即可。</figcaption>
</figure>

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/Z8qcpXyMAiA" title="Redis Streams Explained" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Redis · Redis Streams Explained · 官方频道对 Stream、消费者组的讲解,对照 `stream_queue.py` 看。</figcaption>
</figure>

### 书籍

- Martin Kleppmann《Designing Data-Intensive Applications》(O'Reilly, 2017):第 11 章 Stream Processing 讲消息队列、至少一次投递和幂等,第 8 章讲分布式系统里的时间和锁。两章合起来读,正好对应今天的队列和锁。

### 开源项目与代码

- [valkey-io/valkey](https://github.com/valkey-io/valkey):今天用的 Valkey 本体,BSD 许可,源码编译只需要 `make`。
- [pgvector/pgvector](https://github.com/pgvector/pgvector):今天复现的向量检索坑的所在,README 很短,值得完整读一遍。

## 自测

1. 控制面和数据面各管什么?为什么「数据面每个请求都同步问控制面」是错的?

<details><summary>答案</summary>

控制面管配置(租户、Agent 定义、授权、预算、密钥),改得少、可以慢;数据面管每个请求的执行(网关、运行时、工具调用),要快。同步问会让控制面成为数据面的单点:我们实跑的结果是控制面挂 60 秒,60 个请求全是 500。做法是控制面下发版本化快照,数据面本地缓存,请求路径上只读本地。

</details>

2. 本地快照有什么代价?给出两种压低这个代价的办法。

<details><summary>答案</summary>

配置生效有延迟:实跑里拉取间隔 30 秒时,暂停 Maple 晚了 20 秒才真正生效。办法一是缩短拉取间隔(8 秒时晚 6 秒),代价是控制面被拉得更频繁;办法二是事件推送,控制面改完立刻推一条带版本号的事件,实测毫秒级生效,版本对不上时整份重拉,同时保留低频拉取当保险。

</details>

3. 三个网关实例各数各的,每分钟限 60,为什么会放行 90?共享 Valkey 但「先读后写」为什么并发时也会超发?

<details><summary>答案</summary>

各数各的:90 个请求轮流分给 3 个实例,每个看到 30 个,没一个到 60,于是全放行。先读后写:读和写之间是两次网络往返,并发的线程可能读到同一个旧值,各自写回旧值加一,丢更新,实测 160 次加一最后计数只有 36,所以全部放行。用 `INCR` 这种服务端原子命令才对。

</details>

4. worker 取了任务、没确认就崩了,任务会丢吗?会重复吗?怎么办?

<details><summary>答案</summary>

不会丢,任务留在待确认列表里,别的 worker 用 `XAUTOCLAIM` 接管。会重复:崩溃前可能已经做了一部分,接管的 worker 又做一遍。队列只保证至少执行一次,所以处理逻辑要幂等,比如用 `SET NX` 记一个「这张工单已处理」的标记,或者数据库里用唯一约束去重。

</details>

5. (面试题)你们的知识库放在 pgvector,有个小租户反馈「什么都搜不到」,日志里没有报错。给出至少两种可能的原因和你的排查办法。

<details><summary>答案</summary>

一、HNSW 先找近邻再按 `tenant_id` 过滤,小租户占比小,默认 `ef_search = 40` 的候选里几乎没有它的行,返回行数不够。排查:给这个租户跑一批查询看返回行数是否小于 K;对比关掉索引的精确结果。修法:打开 `hnsw.iterative_scan`,或者给它建局部索引、按租户分区。二、数据本身没进去:入库时租户 id 写错或者 embedding 任务在队列里失败了没有重试,查表里这个租户的行数。三、RLS 策略或会话变量没设,查询被过滤成 0 行(昨天的坑),查事务里有没有 `set_config`。四、嵌入模型换了版本但这个租户的数据还是旧向量,检索距离整体偏大,查入库时用的模型版本。

</details>

6. 为什么锁一定要有过期时间,而过期时间又会带来什么问题?

<details><summary>答案</summary>

没有过期时间,拿锁的 worker 崩了,锁永远不释放,这张工单永远没人处理。有了过期时间,干活比锁寿命长的时候锁会提前失效,别人拿到锁,两个 worker 重叠处理。我们的实验二里 A 释放时发现「锁早已过期」,B 已经同时在处理。所以锁只是减少重复的优化,最后的正确性靠幂等。

</details>

## 明天预告

Day 586 · 模型网关(一):网关管什么,买还是写,按 token 限流。今天图里「模型网关」那个框一直只是个名字。明天打开它:所有 Agent 的模型调用都经过它,它到底管哪十件事、LiteLLM 和 Portkey 这些现成的该怎么选、自己写值不值,以及今天练习 2 留下的问题:限流为什么要按 token 数而不是请求数,令牌桶怎么在「请求进来时还不知道会用多少 token」的情况下工作。
