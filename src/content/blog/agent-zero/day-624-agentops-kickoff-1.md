---
title: 'Day 624 · AgentOps 开题(一):真的需要平台吗,包含什么,控制面数据面'
description: '进阶篇的毕业项目 AgentOps 开工。今天不写业务代码,只做资深工程师开工前一定要做的事:用昨天的打分矩阵回答「真的需要平台吗」(结果是几乎打平,所以要写清楚复盘条件),本机实测多放一个网关会多花几毫秒,把范围写成能自动检查的数据(第一次检查就抓到两条没有数字的验收指标),再把 AgentOps 的路由表分成数据面和控制面,用五条规则抓出「数据面偷偷写控制面的表」这类设计错误。'
pubDate: 2026-10-27
regime: none
tags: ['agentops', 'platform', 'scope', 'control-plane', 'python', 'agent-zero']
series: 'agent-zero'
day: 624
lang: 'zh'
draft: true
---

## 上一课回顾

[Day 623](/blog/agent-zero/day-623-tech-selection/) 学了写选型报告:至少三个选项、一个必须是「不做」,每个分数标明是实测还是估计,用三种敏感性分析看结论脆弱不脆弱,最后用 lint 检查报告有没有「先有结论再凑分数」的毛病。

今天把这套办法用在一个真正要动手的决定上。[Day 583](/blog/agent-zero/day-583-platform-1/) 到 [Day 586](/blog/agent-zero/day-586-gateway-1/) 讲过平台的一堆零件:什么时候该做平台、租户、隔离、控制面和数据面、模型网关。从今天起这些零件开始拼成进阶篇的毕业项目 **AgentOps**:一个给公司里多个团队共用的 Agent 基础设施,包含模型网关、MCP 工具中心、持久化运行时和评测平台。后面十来天(Day 625 到 Day 639)每天往里加一块。

## 今天要解决的问题

学完今天你应该能:

1. 用打分矩阵回答「真的需要做平台吗」,并说清楚为什么结果是「几乎打平」时,报告里最重要的是复盘条件。
2. 把 AgentOps 的范围写成能自动检查的数据:要做的五块、明确不做的五件事(每件带理由和重开条件)、九条带数字的验收指标;并用一个脚本归类「顺便」的需求。
3. 把 AgentOps 的接口分成数据面和控制面,用五条规则检查一张路由表,抓出「数据面路由写了控制面的表」「读了控制面的表却没缓存」这类设计错误。
4. 在本机量出「多放一个网关」到底多花几毫秒,知道这个数在设计文档里该怎么用、不能怎么用。

今天两个新概念:**范围(目标、非目标、验收指标)**和**控制面与数据面在 AgentOps 上怎么落地**。「该不该做平台」是复用 Day 623 的工具,不算新概念。预计用时 3 小时,**不调模型,不花钱**;本机只开 `127.0.0.1` 上的假服务。前置:[Day 623](/blog/agent-zero/day-623-tech-selection/)(今天直接 import 它的 `decision_matrix.py`)、[Day 583](/blog/agent-zero/day-583-platform-1/) 和 [Day 585](/blog/agent-zero/day-585-platform-3/)(三个信号、控制面和数据面)、[Day 610](/blog/agent-zero/day-610-voice-1/)(首 token 延迟 0.7 秒左右,拿来对比)。

学法:先对照逐行敲一遍(不复制粘贴)并跑通;第二天合上文章,默写 `plane_map.py` 里的 `lint` 五条规则;做练习,做不出再展开参考答案,看完关掉重写一遍。

先交代两件事,免得你误会。第一,AgentOps 在课程里是练判断力的项目:设计怎么取舍、怎么写下来、怎么验证。它的第二、第三个租户(财务、销售、运维)是我们在 Day 625 起造出来的演示租户,不是真团队。真公司里如果只有一个团队在用,你应该走「只做共享包」那条路,下面的矩阵会告诉你为什么。第二,今天文件放两个地方:脚本放 `agent-zero-lab/part10/agentops_kickoff/`,产出的文档放 `agentops/docs/`。`agentops/` 仓库在 Day 625 才正式建骨架,但 `agentops/docs/adr/` 在 [Day 519](/blog/agent-zero/day-519-senior-map/) 和 [Day 543](/blog/agent-zero/day-543-design-doc-2/) 就已经放过两份 ADR 了,今天往里加第三份。

```bash
cd agent-zero-lab        # 换成你自己的练习仓库路径
mkdir -p part10/agentops_kickoff && touch part10/agentops_kickoff/__init__.py
ls part10/selection/decision_matrix.py part10/selection/ex623_flip.py
```

```text
part10/selection/decision_matrix.py
part10/selection/ex623_flip.py
```

这两个是 Day 623 建的。没有就回去敲出来。

## 先回答一个问题:真的需要平台吗

平台化是资深工程师最容易犯的错误之一,也是面试官最爱追问的地方。Day 583 给了三个信号:第三个团队来要同样的东西、同一个修复要改好几遍、有人要按部门分账或统一管控,出现两个才值得认真考虑。那一天的数字(三份复制来的客户端内容各不相同,共用 key 的账单按次数平摊和按真实花费差了二十多块)是用脚本造的假仓库得出的,拿它去说服真老板没有用,你得扫自己公司真实的仓库。今天我们假设云簿已经扫过了,三个信号都出现了,现在的问题是:**平台是唯一的解法吗?** 还有一个更便宜的办法,叫共享包(Day 583 末尾提过):把 `common/llm.py` 这类通用代码整理成一个内部 Python 包,各团队 `uv add` 进去,类似前端的公司内部组件库。

所以选项有三个:A 做 AgentOps 平台,B 只做一个共享 Python 包,C 不做、各团队自理。标准和权重(这一次先定好再打分):消除重复和漏修 25%、成本能按团队拆 20%、投入和维护成本 25%、对线上延迟的影响 15%、做错了能退回 15%。

```python
# agent-zero-lab/part10/agentops_kickoff/need_platform.py
"""AgentOps 开题第一问:真的需要平台吗?用 Day 623 的打分矩阵,在「做平台」「只做共享包」「不做」之间选。
云簿是虚构公司,团队数、人力、分数里的估计部分是示例;只有「对线上延迟的影响」那一格来自 hop_overhead.py 的实测。"""
from part10.selection.decision_matrix import (
    Criterion, Score, Scores, cell_flips, measured_share, one_at_a_time, score_jitter, weight_jitter, weighted,
)
from part10.selection.ex623_flip import flip_factors

CRITERIA = [
    Criterion("消除重复和漏修", 0.25),
    Criterion("成本能按团队拆", 0.20),
    Criterion("投入和维护成本", 0.25),
    Criterion("对线上延迟的影响", 0.15),
    Criterion("做错了能退回", 0.15),
]
A, B, C = "A 做 AgentOps 平台", "B 只做一个共享 Python 包", "C 不做,各团队自理"


def est(v: int, why: str) -> Score:
    return Score(v, "estimate", why)


SCORES: Scores = {
    A: {
        "消除重复和漏修": est(5, "模型调用、鉴权、脱敏收到一处,修一次全公司受益"),
        "成本能按团队拆": est(5, "每条调用都带租户和功能名,账单能拆到功能"),
        "投入和维护成本": est(2, "五个子系统,要有人长期维护(示例:2 个人)"),
        "对线上延迟的影响": Score(4, "measured", "hop_overhead.py 本机实测:多一跳网关 P95 约 +1 ms,真实网络再加几毫秒,对比 LLM 首 token 约 700 ms"),
        "做错了能退回": est(3, "租户改回 base_url 就能绕开,但已依赖的功能(预算、审计)会丢"),
    },
    B: {
        "消除重复和漏修": est(3, "修复靠各团队升级包版本,还是会有人没升"),
        "成本能按团队拆": est(3, "只能拆用了这个包的团队,绕开包的看不到"),
        "投入和维护成本": est(4, "一个包,一个人兼着维护"),
        "对线上延迟的影响": est(5, "进程内调用,没有额外一跳"),
        "做错了能退回": est(5, "删掉依赖就行"),
    },
    C: {
        "消除重复和漏修": est(1, "Day 583 的假仓库里三份客户端内容三种,这个状态会继续"),
        "成本能按团队拆": est(1, "共用 key 的账只能按次数平摊"),
        "投入和维护成本": est(5, "没有新投入"),
        "对线上延迟的影响": est(5, "没有变化"),
        "做错了能退回": est(5, "什么都没做"),
    },
}

if __name__ == "__main__":
    print("加权得分:", weighted(SCORES, CRITERIA))
    print("实测占比:", measured_share(SCORES, CRITERIA))
    flips = one_at_a_time(SCORES, CRITERIA)
    print("单因素 ±50%:", *(flips or ["没有任何一个权重能让第一名换人"]), sep="\n  ")
    print("权重一起抖:", weight_jitter(SCORES, CRITERIA))
    print("估计分数 ±1:", score_jitter(SCORES, CRITERIA))
    for name, (down, up) in flip_factors(SCORES, CRITERIA).items():
        d = f"降到 ×{down:.2f}" if down is not None else "怎么降都不翻"
        u = f"升到 ×{up:.2f}" if up is not None else "升到 10 倍也不翻"
        print(f"  {name:<10} {d:<14} {u}")
    cf = cell_flips(SCORES, CRITERIA, 1)
    print("逐格 ±1:", *(cf or ["没有任何一格能单独翻盘"]), sep="\n  ")
```

<div class="line-notes">

- `from part10.selection.ex623_flip import flip_factors` 昨天练习 2 写的「每个权重乘几倍才翻盘」。今天直接拿来用,所以才叫「工具」。
- `CRITERIA = [` 五个标准。注意「投入和维护成本」「对线上延迟的影响」「做错了能退回」都是按「越高越好」打,即成本越低、影响越小、越容易退回,分越高。
- `A, B, C = "A 做 AgentOps 平台", "B 只做一个共享 Python 包", "C 不做,各团队自理"` 三个选项。选项名里不放逗号,下面报告里要用逗号拼接。
- `"消除重复和漏修": est(5, "模型调用、鉴权、脱敏收到一处,修一次全公司受益"),` A 在这一格拿满分,因为所有调用都走同一个入口。
- `"投入和维护成本": est(2, "五个子系统,要有人长期维护(示例:2 个人)"),` A 的最大短板。平台不是写完就完的项目。
- `"对线上延迟的影响": Score(4, "measured", "hop_overhead.py 本机实测` **整张表里唯一一个实测格子**,依据是下一节要写的那个脚本。4 分(不是 5)是因为真实网络还要再加几毫秒。
- `"做错了能退回": est(3, "租户改回 base_url 就能绕开,但已依赖的功能(预算、审计)会丢"),` 租户改一下 `LLM_BASE_URL` 就能绕开网关,所以不是完全不可退回;但预算和审计这些靠平台才有的功能会一起丢。
- `"消除重复和漏修": est(3, "修复靠各团队升级包版本,还是会有人没升"),` B 的短板:共享包解决了「代码重复」,没解决「各团队是不是升了版本」。Day 583 里那个漏修的脱敏就是这么漏的。
- `"消除重复和漏修": est(1, "Day 583 的假仓库里三份客户端内容三种,这个状态会继续"),` C 拿最低分。
- `print("实测占比:", measured_share(SCORES, CRITERIA))` A 只有 15.8% 来自实测。B 和 C 是 0。
- `print("单因素 ±50%:", *(flips or ["没有任何一个权重能让第一名换人"]), sep="\n  ")` 单因素的结果可能有好几条,星号展开后每条占一行。
- `for name, (down, up) in flip_factors(SCORES, CRITERIA).items():` 拆包:`flip_factors` 返回的字典,值是一个二元组,循环变量里直接拆成 `down` 和 `up`。
- `print("逐格 ±1:", *(cf or ["没有任何一格能单独翻盘"]), sep="\n  ")` `cf or [...]` 在 `cf` 为空列表时用后面那个顶上,星号展开成多个参数,每个占一行。

</div>

```bash
uv run python -m part10.agentops_kickoff.need_platform
```

真实输出:

```text
加权得分: {'A 做 AgentOps 平台': 3.8, 'B 只做一个共享 Python 包': 3.85, 'C 不做,各团队自理': 3.2}
实测占比: {'A 做 AgentOps 平台': 0.158, 'B 只做一个共享 Python 包': 0.0, 'C 不做,各团队自理': 0.0}
单因素 ±50%:
  消除重复和漏修 权重 ×1.5:第一名从「B 只做一个共享 Python 包」变成「A 做 AgentOps 平台」
  成本能按团队拆 权重 ×1.5:第一名从「B 只做一个共享 Python 包」变成「A 做 AgentOps 平台」
  投入和维护成本 权重 ×0.5:第一名从「B 只做一个共享 Python 包」变成「A 做 AgentOps 平台」
  对线上延迟的影响 权重 ×0.5:第一名从「B 只做一个共享 Python 包」变成「A 做 AgentOps 平台」
  做错了能退回 权重 ×0.5:第一名从「B 只做一个共享 Python 包」变成「A 做 AgentOps 平台」
权重一起抖: {'A 做 AgentOps 平台': 0.415, 'B 只做一个共享 Python 包': 0.585, 'C 不做,各团队自理': 0.0}
估计分数 ±1: {'A 做 AgentOps 平台': 0.426, 'B 只做一个共享 Python 包': 0.562, 'C 不做,各团队自理': 0.013}
  消除重复和漏修    怎么降都不翻         升到 ×1.10
  成本能按团队拆    怎么降都不翻         升到 ×1.13
  投入和维护成本    降到 ×0.90       升到 ×3.61
  对线上延迟的影响   降到 ×0.67       升到 10 倍也不翻
  做错了能退回     降到 ×0.83       升到 10 倍也不翻
逐格 ±1:
  「A 做 AgentOps 平台」的「投入和维护成本」从 2 改成 3:第一名变成「A 做 AgentOps 平台」
  「A 做 AgentOps 平台」的「做错了能退回」从 3 改成 4:第一名变成「A 做 AgentOps 平台」
  「B 只做一个共享 Python 包」的「消除重复和漏修」从 3 改成 2:第一名变成「A 做 AgentOps 平台」
  「B 只做一个共享 Python 包」的「成本能按团队拆」从 3 改成 2:第一名变成「A 做 AgentOps 平台」
  「B 只做一个共享 Python 包」的「投入和维护成本」从 4 改成 3:第一名变成「A 做 AgentOps 平台」
  「B 只做一个共享 Python 包」的「对线上延迟的影响」从 5 改成 4:第一名变成「A 做 AgentOps 平台」
  「B 只做一个共享 Python 包」的「做错了能退回」从 5 改成 4:第一名变成「A 做 AgentOps 平台」
```

一格一格读。

**C 明显最差**:3.20,权重抖动里一次都没赢过,估计分数 ±1 下也只赢了 1.3%。三个信号都出现的情况下「不做」不是选项,这一点很清楚。

**A 和 B 几乎打平**:3.80 对 3.85,差 0.05 分。权重一起抖,B 赢 58.5%、A 赢 41.5%;估计分数 ±1,B 56.2%、A 42.6%。单因素也一样,每一个权重单独变一半,第一名都会换人;逐格检查更夸张,B 的每一格单独错 1 分,A 就赢了。翻盘距离那几行也说明了这件事:「消除重复和漏修」的权重只要升到 1.10 倍,A 就赢;升到 1.13 倍「成本能按团队拆」也一样。

这是一个很诚实的结果,也是选型报告最有价值的时候:**两个方案打平,说明这个决定的关键不在打分,在你多看重那两个权重**,即「统一管控」和「少投入」之间怎么取舍。如果报告里只写一句「推荐 A,得分 3.80」,那就是在骗人,因为它连 B 都没赢。

### 多放一个网关到底多花多少毫秒

「对线上延迟的影响」这一格我打了 4 分,标了实测。这个实测在哪?下面这个脚本在本机起三个 HTTP 服务:一个立刻返回的假上游,一个只转发请求的代理,一个除了转发还会查 API key、记一行账本的代理,然后各发 300 个请求,量响应时间。前端同学可以把代理理解成 Vite 开发服务器的 `proxy` 配置:请求先打到它,它再转给真正的后端。

```python
# agent-zero-lab/part10/agentops_kickoff/hop_overhead.py
"""量一量「中间多放一个网关」到底多花多少毫秒。全部在 127.0.0.1 上,上游是个立刻返回的假服务,所以量到的几乎全是网关自己的开销。
三种:A 客户端直连上游;B 经过一个只转发的代理;C 经过一个会查 API key、记一行账本的代理。"""
import http.client
import json
import sqlite3
import statistics
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

N = 300
BODY = json.dumps({"model": "fast", "messages": [{"role": "user", "content": "我上个月被重复扣款了"}]}).encode()
KEYS = {"ak_cloudledger_demo": "t_cloudledger"}  # 假的租户 key


class Quiet(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # 保持连接,不用每次重新握手

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def reply(self, payload: bytes, code: int = 200) -> None:
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class Upstream(Quiet):
    def do_POST(self) -> None:
        self.rfile.read(int(self.headers["Content-Length"]))
        self.reply(json.dumps({"choices": [{"message": {"content": "好的"}}], "usage": {"total_tokens": 42}}).encode())


def make_proxy(upstream_port: int, with_gateway_work: bool) -> type[Quiet]:
    db = sqlite3.connect(":memory:", check_same_thread=False)
    db.execute("CREATE TABLE ledger (tenant TEXT, tokens INT, ts REAL)")
    lock = threading.Lock()

    class Proxy(Quiet):
        def do_POST(self) -> None:
            raw = self.rfile.read(int(self.headers["Content-Length"]))
            tenant = ""
            if with_gateway_work:
                tenant = KEYS.get(self.headers.get("Authorization", "").removeprefix("Bearer "), "")
                if not tenant:
                    self.reply(b'{"error":"bad key"}', 401)
                    return
                json.loads(raw)  # 网关要看一眼请求里的 model 字段
            conn = http.client.HTTPConnection("127.0.0.1", upstream_port)
            conn.request("POST", "/", raw, {"Content-Type": "application/json"})
            resp = conn.getresponse().read()
            conn.close()
            if with_gateway_work:
                tokens = json.loads(resp)["usage"]["total_tokens"]
                with lock:
                    db.execute("INSERT INTO ledger VALUES (?, ?, ?)", (tenant, tokens, time.time()))
                    db.commit()
            self.reply(resp)

    return Proxy


def serve(handler: type[Quiet]) -> ThreadingHTTPServer:
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)  # 端口填 0:让系统挑一个空闲的
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def measure(port: int) -> list[float]:
    conn = http.client.HTTPConnection("127.0.0.1", port)
    headers = {"Content-Type": "application/json", "Authorization": "Bearer ak_cloudledger_demo"}
    for _ in range(20):  # 热身,不计入
        conn.request("POST", "/", BODY, headers)
        conn.getresponse().read()
    out: list[float] = []
    for _ in range(N):
        t0 = time.perf_counter()
        conn.request("POST", "/", BODY, headers)
        conn.getresponse().read()
        out.append((time.perf_counter() - t0) * 1000)
    conn.close()
    return sorted(out)


if __name__ == "__main__":
    up = serve(Upstream)
    up_port = up.server_address[1]
    px_plain = serve(make_proxy(up_port, False))
    px_gw = serve(make_proxy(up_port, True))
    rows = [("A 直连", up_port), ("B 只转发", px_plain.server_address[1]), ("C 查 key+记账", px_gw.server_address[1])]
    base = 0.0
    for name, port in rows:
        ms = measure(port)
        p50, p95 = statistics.median(ms), ms[int(len(ms) * 0.95)]
        if name.startswith("A"):
            base = p95
        print(f"{name:<12} P50 {p50:5.2f} ms   P95 {p95:5.2f} ms   比直连多 {p95 - base:5.2f} ms(P95)")
```

<div class="line-notes">

- `import http.client` 标准库里「自己发 HTTP 请求」的最底层模块。比 `httpx` 原始,但今天要量的是底层开销,所以不用封装多的库。
- `from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer` 标准库里「自己起一个 HTTP 服务」的模块。`ThreadingHTTPServer` 每来一个连接开一个线程处理,相当于 Node 里 `http.createServer` 的多线程版。
- `N = 300` 每种配置发 300 个请求。
- `BODY = json.dumps({"model": "fast", "messages": [{"role": "user", "content": "我上个月被重复扣款了"}]}).encode()` 一个典型的聊天请求体,`.encode()` 把字符串变成字节,HTTP 传的是字节。
- `KEYS = {"ak_cloudledger_demo": "t_cloudledger"}  # 假的租户 key` 假 key 对应假租户,代理里查它来模拟「认出你是谁」。
- `class Quiet(BaseHTTPRequestHandler):` 所有处理器的共同父类。
- `protocol_version = "HTTP/1.1"  # 保持连接,不用每次重新握手` 默认的 `BaseHTTPRequestHandler` 说的是 HTTP/1.0,每个请求完就关连接。改成 1.1 才会保持连接(keep-alive)。DevTools 的 Network 面板里的 `Connection: keep-alive` 就是这个。
- `def log_message(self, format: str, *args: Any) -> None:` 把默认的「每个请求打一行日志到终端」关掉,不然 900 行日志会淹掉输出。函数体是 `pass`:什么都不做。
- `self.send_header("Content-Length", str(len(payload)))` HTTP/1.1 保持连接时必须告诉对方这条消息多长,否则客户端不知道什么时候读完。我第一版漏了这行,客户端一直等,卡住了。
- `class Upstream(Quiet):` 假上游。
- `self.rfile.read(int(self.headers["Content-Length"]))` 把请求体读完再回复。不读完就回复,下一个请求会读到上一个的残渣。`rfile` 是「请求的字节流」,`self.headers[...]` 取请求头,相当于 Express 的 `req.headers`。
- `def make_proxy(upstream_port: int, with_gateway_work: bool) -> type[Quiet]:` 一个返回「类」的函数。`type[Quiet]` 表示返回值本身是个类。这样一个函数就能造出「只转发」和「查 key 加记账」两种代理。
- `db = sqlite3.connect(":memory:", check_same_thread=False)` 内存里的 SQLite 当账本。`check_same_thread=False` 允许多个线程共用这一个连接,下面用锁保护。
- `lock = threading.Lock()` 一把锁,同一时刻只让一个线程写账本。
- `tenant = KEYS.get(self.headers.get("Authorization", "").removeprefix("Bearer "), "")` 从 `Authorization: Bearer ak_...` 里取出 key 去查租户。`removeprefix` 是 3.9 加的,去掉字符串开头的固定前缀。
- `json.loads(raw)  # 网关要看一眼请求里的 model 字段` 解析一次请求体。真实网关要读 `model` 来选路由,这是它的基本动作。
- `conn = http.client.HTTPConnection("127.0.0.1", upstream_port)` **每个请求都新开一条到上游的连接**。这是故意写简单的,练习 3 会改。
- `tokens = json.loads(resp)["usage"]["total_tokens"]` 从上游的响应里取出 token 数,记账要用。
- `db.execute("INSERT INTO ledger VALUES (?, ?, ?)", (tenant, tokens, time.time()))` 往账本插一行。`?` 是占位符,值放在后面的元组里,不拼字符串。
- `srv = ThreadingHTTPServer(("127.0.0.1", 0), handler)  # 端口填 0:让系统挑一个空闲的` 绑定 `127.0.0.1`:只有本机访问得到。端口 0 的意思是「系统随便挑一个没人用的」,免得和你机器上别的服务撞。
- `threading.Thread(target=srv.serve_forever, daemon=True).start()` 在后台线程里跑服务。`daemon=True` 表示主程序结束时它自动跟着结束。
- `for _ in range(20):  # 热身,不计入` 前几个请求要建连接、预热缓存,会偏慢,先发 20 个丢掉。
- `t0 = time.perf_counter()` 高精度计时器,专门用来量时间差。
- `out.append((time.perf_counter() - t0) * 1000)` 一次请求的耗时,换算成毫秒。
- `p50, p95 = statistics.median(ms), ms[int(len(ms) * 0.95)]` P50 是中位数,P95 是排好序后第 95% 的那个数,300 个数里就是第 285 个。
- `print(f"{name:<12} P50 {p50:5.2f} ms` 格式说明符 `5.2f` 是「总宽 5、两位小数」。

</div>

```bash
uv run python -m part10.agentops_kickoff.hop_overhead
```

第一次运行的结果:

```text
A 直连         P50  0.26 ms   P95  0.40 ms   比直连多  0.00 ms(P95)
B 只转发        P50  0.83 ms   P95  1.08 ms   比直连多  0.68 ms(P95)
C 查 key+记账   P50  1.09 ms   P95  1.61 ms   比直连多  1.21 ms(P95)
```

我又跑了两次,B 比直连多的 P95 分别是 0.56 和 0.86 毫秒,C 是 0.74 和 0.92 毫秒,每次都不一样。这些数该怎么读,有三点要小心:

**一,这是本机回环**:没有网络、没有 TLS、上游立刻返回。真实部署里网关和调用方、网关和上游之间都隔着网络,每一跳再加几毫秒到几十毫秒。所以验收指标里写的是「P95 小于 30 毫秒」,不是「小于 1 毫秒」。

**二,它给了一个下限和一个数量级**:网关自己的开销(解析请求、查 key、写账本)是亚毫秒到一毫秒级。和 Day 610、623 量过的 DeepSeek 首 token 延迟(P50 0.7 秒)比,是千分之二的量级。「多一跳网关会让 Agent 变慢」这个担心,在这个量级上不成立。

**三,账本在内存 SQLite**:真实的 Postgres 写入会慢得多。所以 Day 627 要做记账时,会专门量落库的开销,今天这个数不能拿去当最终结论。

花费 0 元。这就是矩阵里那个 4 分的由来:有数据,但只是一个下限,所以不给满分。

### 决定:写一份 ADR

打平的结果怎么办?把它写成 ADR 的「决定」和「复盘条件」,让后来的人知道当时是怎么想的。保存为 `agentops/docs/adr/0003-build-agentops-platform.md`(编号接着你仓库里已有的往后排):

```markdown
# 0003 做 AgentOps 平台,但按最薄可用平台的顺序做

## 背景
云簿有三个团队在各自对接大模型,三个信号都出现了:客户端代码各改各的、同一个修复漏了好几家、
财务要按团队拆模型账单。选项:A 做平台,B 只做共享包,C 不做。

## 决定
做 A,但是按「最薄可用平台」的顺序:先做模型网关和 MCP 工具中心(这两个是租户绕不开的统一入口),
运行时、评测、可观测排在后面,每一块单独验收,任何一块验收不过不开下一块。

## 考虑过的其他方案
- B 共享包:打分 3.85,比 A 的 3.80 还高 0.05。没选它的原因是矩阵里没有体现的一点:
  共享包管不到不用它的团队,而「统一管控」(审计、预算、紧急停用)本来就需要一个绕不开的入口。
  这是判断,不是数字,评审时请挑战它。
- C 不做:3.20,三个信号都出现的情况下不可取。

## 后果
+ 修一次全公司受益;账单能按租户、按功能拆。
- 要有人长期维护,按 2 人估计;多一跳网关,本机实测 P95 约 +1 ms,真实网络要重测。
- A 和 B 几乎打平:结论取决于「统一管控」这个权重,如果评审认为它不重要,应该改走 B。

## 复盘条件(带数字)
- Day 633 评测平台开工前,如果真实在用的租户还是只有 SupportPilot 一个,停下来改走 B。
- 网关额外延迟 P95 超过 30 ms,或者维护人力超过 3 人,重新评估。
- 实测占比(目前 A 只有 15.8%)到 Day 627 还没有提高,说明我们一直在凭感觉做决定,停下来补数据。
```

注意「决定」那一段没有假装 A 赢了:它承认 B 的分数更高,然后写出了没被矩阵捕捉到的理由,并且把它标成「判断,不是数字」。三条复盘条件都带数字,而且第一条直接对应开头说的那件事:课程里的第二、第三个租户是演示用的,真公司里没有真租户,就该走 B。

## AgentOps 包含什么,不包含什么

设计文档里最有价值的一节往往是「非目标」。写清楚不做什么,评审的人才不会在第二周跑来问「能不能顺便支持一下语音」。

<figure>
<svg viewBox="0 0 640 380" role="img" aria-label="AgentOps 架构:租户应用通过网关、工具中心、运行时、评测平台访问模型和业务系统,控制面管理租户、配额、策略">
  <rect x="20" y="20" width="600" height="60" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="40" y="44" font-family="var(--font-mono)" font-size="12" fill="var(--ink-faint)">租户应用</text>
  <rect x="40" y="52" width="130" height="20" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="105" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">SupportPilot</text>
  <rect x="185" y="52" width="130" height="20" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="250" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">财务对账助手</text>
  <rect x="330" y="52" width="130" height="20" rx="4" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="395" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink)">运维告警分诊</text>
  <text x="520" y="66" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">(后两个是演示租户)</text>
  <rect x="20" y="110" width="440" height="160" rx="8" fill="none" stroke="var(--mem)" stroke-dasharray="5 4"/>
  <text x="34" y="130" font-family="var(--font-mono)" font-size="12" fill="var(--mem)">数据面:每个请求都经过</text>
  <rect x="40" y="143" width="190" height="52" rx="6" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="135" y="164" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">模型网关 /v1</text>
  <text x="135" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Day 626-627</text>
  <rect x="250" y="143" width="190" height="52" rx="6" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="345" y="164" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">MCP 工具中心 /mcp</text>
  <text x="345" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Day 628、630</text>
  <rect x="40" y="206" width="190" height="52" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="135" y="227" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">运行时 /runs</text>
  <text x="135" y="245" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Day 631-632</text>
  <rect x="250" y="206" width="190" height="52" rx="6" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="345" y="227" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">评测平台 /evals</text>
  <text x="345" y="245" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">Day 633</text>
  <rect x="480" y="110" width="140" height="160" rx="8" fill="var(--paper-raised)" stroke="var(--rule)"/>
  <text x="550" y="132" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">控制面 /admin</text>
  <text x="550" y="160" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">租户和 key</text>
  <text x="550" y="182" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">配额和路由表</text>
  <text x="550" y="204" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">工具策略</text>
  <text x="550" y="226" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">审计查询</text>
  <text x="550" y="254" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-faint)">改动都要留痕</text>
  <rect x="20" y="300" width="290" height="56" rx="8" fill="var(--mem-wash)" stroke="var(--mem)"/>
  <text x="165" y="324" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">上游模型</text>
  <text x="165" y="344" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">DeepSeek 通义 自部署小模型</text>
  <rect x="330" y="300" width="290" height="56" rx="8" fill="var(--compute-wash)" stroke="var(--compute)"/>
  <text x="475" y="324" text-anchor="middle" font-family="var(--font-mono)" font-size="12" fill="var(--ink)">业务系统的 MCP server</text>
  <text x="475" y="344" text-anchor="middle" font-family="var(--font-mono)" font-size="11" fill="var(--ink-soft)">账单 客户 工单 知识库</text>
  <line x1="200" y1="80" x2="200" y2="110" stroke="var(--rule)" stroke-width="1.5"/>
  <line x1="135" y1="270" x2="135" y2="300" stroke="var(--mem)" stroke-width="1.5"/>
  <line x1="345" y1="270" x2="475" y2="300" stroke="var(--compute)" stroke-width="1.5"/>
  <line x1="460" y1="190" x2="480" y2="190" stroke="var(--rule)" stroke-width="1.5"/>
</svg>
<figcaption>AgentOps 的整体结构。蓝色是模型侧,琥珀色是工具和业务系统侧。虚线框是数据面:每个租户请求都要经过,要快要稳;右边是控制面:只有管理员和配置变更会碰,可以慢一点,但改动要留痕。图里每个子系统下面的 Day 是它被做出来的那天。</figcaption>
</figure>

**要做的五块**:模型网关(OpenAI 兼容接口,按「逻辑路由名」选真正的供应商,限流、配额、故障切换,把每次调用的 token 和成本记到租户和功能名下);MCP 工具中心(业务工具以 MCP server 注册进来,中心负责鉴权、授权、审批标记、审计);持久化运行时(长任务和要等人批准的任务,每一步落库,进程挂了能续);评测平台(离线回归、统计检验、线上 A/B);最后一块是加在前四个之上的功能:路由小模型、可观测、安全加固、压测与部署。

**明确不做的五件事**:可视化编排界面、自己的 Agent 框架、模型训练平台、多区域部署和四个九、管租户的提示词内容。最后一条特别重要,Day 583 说过:提示词、业务工具、测试集必须留在懂业务的团队手里,平台团队连提示词都要管,很快就会变成所有 Agent 改动的瓶颈。

### 把范围写成数据

范围写在一份 Markdown 里,很快就没人看了,而且「验收指标」最容易写成「性能良好」「安全可靠」这种没法验证的话。所以今天把范围写成**数据**,让程序检查它够不够硬,再从数据生成文档。

```python
# agent-zero-lab/part10/agentops_kickoff/scope.py
"""AgentOps 的范围,写成数据:子系统和里程碑、非目标、验收指标。设计文档里的表格由它生成,不手抄。"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Subsystem:
    id: str
    name: str
    days: tuple[int, ...]  # 在哪几天做
    owns: tuple[str, ...]  # 这个子系统负责的事(用来给需求归类)


@dataclass(frozen=True)
class NonGoal:
    id: str
    text: str
    why: str
    revisit_when: str
    keywords: tuple[str, ...]


@dataclass(frozen=True)
class Metric:
    id: str
    subsystem: str
    target: str  # 必须带数字
    how: str  # 怎么测
    day: int  # 哪一天第一次测


SUBSYSTEMS = [
    Subsystem("gateway", "模型网关", (626, 627), ("账单", "限流", "配额", "路由", "故障切换", "成本归因", "虚拟 key")),
    Subsystem("mcphub", "MCP 工具中心", (628, 630), ("工具授权", "审批", "审计", "工具注册")),
    Subsystem("runtime", "持久化运行时", (631, 632), ("断点续跑", "长任务", "人工审批", "重试")),
    Subsystem("evals", "评测平台", (633,), ("评测", "回归", "A/B", "数据集")),
    Subsystem("addons", "加在前四个之上的功能", (634, 635, 637, 638, 639), ("路由小模型", "看板", "红队", "压测", "部署")),
]

NON_GOALS = [
    NonGoal("ng1", "不做可视化编排界面", "我们的用户是写代码的团队;拖拽搭 Agent 是 Dify、Coze 的领域",
            "出现三个以上不会写代码的团队来要", ("拖拽", "可视化", "低代码", "画流程")),
    NonGoal("ng2", "不做自己的 Agent 框架", "租户可以用 LangGraph,也可以手写循环,平台只给运行时和基础设施",
            "出现第二套重复的框架胶水代码,三个团队都在写", ("统一写法", "统一成一种", "自己的框架")),
    NonGoal("ng3", "不做模型训练平台", "训练留在 Day 570 起的脚本里,平台只接已经训好的模型",
            "有两个以上团队每月都要训模型", ("训练平台", "微调", "GPU")),
    NonGoal("ng4", "不做多区域部署和四个九", "单区域单 Postgres,压测目标写在验收指标里",
            "出现有 SLA 赔付条款的客户", ("多区域", "异地", "双活", "四个九")),
    NonGoal("ng5", "不管租户的提示词内容", "提示词、业务工具、测试集必须留在懂业务的团队手里",
            "平台层出现统一的合规文案要求,并且有法务书面要求", ("提示词管理", "改提示词", "审核提示词")),
]

METRICS = [
    Metric("m1", "gateway", "用 A 租户的 key 读 B 租户的任何数据,100% 失败", "隔离测试套件", 626),
    Metric("m2", "gateway", "网关额外延迟 P95 小于 30 ms(不含上游)", "假上游加压测", 627),
    Metric("m3", "gateway", "主供应商返回 5xx 时,切到备用后租户请求成功率不低于 99%", "故障注入测试", 627),
    Metric("m4", "gateway", "租户超出每分钟配额后返回 429,其他租户的成功率不受影响", "并发测试", 627),
    Metric("m5", "gateway", "按租户和功能汇总的成本,与上游账单误差小于 2%", "对账脚本", 627),
    Metric("m6", "mcphub", "未授权的工具在 tools/list 里出现 0 次,被拒的调用 100% 有一条审计记录", "单测加审计查询", 628),
    Metric("m7", "runtime", "任务执行中杀掉 worker,重启后从断点继续,已完成的步骤执行次数为 1", "故障注入测试", 632),
    Metric("m8", "evals", "两个版本比较时同时给出 95% 置信区间和 p 值,p 小于 0.05 才写「有差异」", "单测加示例报告", 633),
    Metric("m9", "addons", "注入和越权红队用例 100% 被拦截,并进 CI", "CI", 637),
]

REVIEW_DAYS = {629, 636}  # 复习日,不排产出
FIRST_DAY, LAST_DAY = 626, 639
```

<div class="line-notes">

- `class Subsystem:` 一个子系统:编号、名字、哪几天做、负责什么。`days` 是元组,`(626, 627)` 表示 Day 626 和 627。
- `owns: tuple[str, ...]  # 这个子系统负责的事(用来给需求归类)` `tuple[str, ...]` 是「任意长度的字符串元组」,`...` 就表示长度不限。一会儿 `triage` 函数用它来给一句需求找归属。
- `class NonGoal:` 一件明确不做的事。三个字段缺一不可:`why` 为什么不做,`revisit_when` 什么条件下重新考虑,`keywords` 用来识别「这个需求是不是在要这件事」。
- `class Metric:` 一条验收指标,`target` 是目标,`how` 是怎么测,`day` 是哪一天第一次测。
- `Subsystem("gateway", "模型网关", (626, 627),` 网关排在 Day 626 和 627 两天,和文章开头的结构图一致。
- `Subsystem("addons", "加在前四个之上的功能", (634, 635, 637, 638, 639),` 路由小模型、看板、安全、压测、包装作品,每个占一天。
- `NonGoal("ng1", "不做可视化编排界面",` 第一条非目标。理由是用户是写代码的团队。
- `"出现三个以上不会写代码的团队来要"` 重开条件,有数字:三个以上,不是「以后再说」。
- `Metric("m2", "gateway", "网关额外延迟 P95 小于 30 ms(不含上游)", "假上游加压测", 627),` 对应今天实测的那个数。今天本机量到 1 毫秒左右,Day 627 会在带记账的完整网关上重量。
- `REVIEW_DAYS = {629, 636}  # 复习日,不排产出` 花括号里放逗号分隔的值是集合。这两天是复习日。
- `FIRST_DAY, LAST_DAY = 626, 639` 项目产出的第一天和最后一天。

</div>

```python
# agent-zero-lab/part10/agentops_kickoff/check_scope.py
"""检查范围写得够不够硬:指标有没有数字、非目标有没有理由和重开条件、里程碑有没有漏天;再给一批「顺便」的需求归类。"""
import re

from part10.agentops_kickoff.scope import (
    FIRST_DAY, LAST_DAY, METRICS, NON_GOALS, REVIEW_DAYS, SUBSYSTEMS, Metric, NonGoal, Subsystem,
)


def check(subsystems: list[Subsystem], non_goals: list[NonGoal], metrics: list[Metric]) -> list[str]:
    problems: list[str] = []
    for m in metrics:
        if not re.search(r"\d", m.target):
            problems.append(f"{m.id} 的目标里没有数字:{m.target}")
        if not m.how.strip():
            problems.append(f"{m.id} 没写怎么测")
        if not FIRST_DAY <= m.day <= LAST_DAY or m.day in REVIEW_DAYS:
            problems.append(f"{m.id} 排在 Day {m.day},不在 {FIRST_DAY} 到 {LAST_DAY} 的产出日里")
    ids = {s.id for s in subsystems}
    for s in subsystems:
        if not any(m.subsystem == s.id for m in metrics):
            problems.append(f"子系统「{s.name}」没有任何验收指标")
    for m in metrics:
        if m.subsystem not in ids:
            problems.append(f"{m.id} 属于不存在的子系统 {m.subsystem}")
    for g in non_goals:
        if len(g.why) < 8:
            problems.append(f"{g.id}「{g.text}」没有写清为什么不做")
        if not g.revisit_when.strip():
            problems.append(f"{g.id}「{g.text}」没写什么条件下重新考虑")
    planned = {d for s in subsystems for d in s.days}
    for d in range(FIRST_DAY, LAST_DAY + 1):
        if d not in planned and d not in REVIEW_DAYS:
            problems.append(f"Day {d} 没有分配给任何子系统")
    return problems


def triage(request: str) -> str:
    """把一条「顺便」的需求归到:范围内 / 非目标 / 先写 ADR / 需要人判断。关键词匹配很粗,只是演示这个动作。"""
    hit_ng = [g for g in NON_GOALS if any(k in request for k in g.keywords)]
    hit_sub = [s for s in SUBSYSTEMS if any(k in request for k in s.owns)]
    if len(hit_ng) + len(hit_sub) > 1:
        names = [g.id for g in hit_ng] + [s.id for s in hit_sub]
        return f"需要人判断:同时像 {names}"
    if hit_ng:
        g = hit_ng[0]
        return f"非目标 {g.id}:{g.text}。重开条件:{g.revisit_when}"
    if hit_sub:
        return f"范围内:{hit_sub[0].name}"
    return "不在范围表里:先写一页 ADR 评估,再决定要不要改范围"


REQUESTS = [
    "能不能顺便做个拖拽界面,让运营自己搭 Agent",
    "财务想每月自动出各团队的模型账单",
    "销售想用 LangGraph 写,平台要不要统一成一种写法",
    "能不能顺便支持语音通话",
    "运维想要异地双活,两个机房",
    "HR 想让平台帮他们微调一个简历模型",
    "给所有客服的提示词统一加一段免责声明,在平台层做",
    "长任务跑到一半 worker 挂了要能接着跑",
]

if __name__ == "__main__":
    issues = check(SUBSYSTEMS, NON_GOALS, METRICS)
    print("范围检查:", "通过" if not issues else "")
    for p in issues:
        print(" -", p)
    for r in REQUESTS:
        print(f"{r}\n    -> {triage(r)}")
```

<div class="line-notes">

- `def check(subsystems: list[Subsystem], non_goals: list[NonGoal], metrics: list[Metric]) -> list[str]:` 三份数据当参数传进来,而不是函数里直接用全局的。这样测试可以传改坏的版本。返回一串问题描述,空列表就是通过。
- `if not re.search(r"\d", m.target):` 正则 `\d` 匹配一个数字字符。目标里一个数字都没有,就是写得不够硬。
- `if not FIRST_DAY <= m.day <= LAST_DAY or m.day in REVIEW_DAYS:` 链式比较 `a <= x <= b` 加一个复习日检查:指标不能排在项目之外,也不能排在复习日。
- `ids = {s.id for s in subsystems}` 集合推导式:所有子系统的编号。
- `if not any(m.subsystem == s.id for m in metrics):` 每个子系统至少要有一条验收指标,没有说明这块做完了没法判断做没做好。
- `if len(g.why) < 8:` 理由少于八个字,基本是敷衍。八是随手定的下限。
- `planned = {d for s in subsystems for d in s.days}` 双层推导式:所有子系统占用的天数,摊成一个集合。
- `if d not in planned and d not in REVIEW_DAYS:` Day 626 到 639 里,不是复习日又没分配给任何子系统的,就是漏天。
- `def triage(request: str) -> str:` 把一句「顺便」的需求归类。
- `hit_ng = [g for g in NON_GOALS if any(k in request for k in g.keywords)]` 需求文字里出现了某条非目标的任何一个关键词,就算命中。`k in request` 在字符串上是「子串包含」,相当于 JS 的 `request.includes(k)`。
- `if len(hit_ng) + len(hit_sub) > 1:` 同时命中好几条,机器分不清,交给人。
- `return "不在范围表里:先写一页 ADR 评估,再决定要不要改范围"` 一条都没命中的默认处理:不是直接拒绝,也不是直接答应,先写一页 ADR。
- `"给所有客服的提示词统一加一段免责声明,在平台层做",` 这一条和其他几条不同,注意它最后会被归到哪里,下面讲。

</div>

```bash
uv run python -m part10.agentops_kickoff.check_scope
```

我第一次写数据的时候,验收指标 m6 是「未授权的工具不出现在 tools/list,调用被拒且有一条审计记录」,m8 是「两个版本比较时给出差值的置信区间和 p 值」。第一次运行:

```text
范围检查:
 - m6 的目标里没有数字:未授权的工具不出现在 tools/list,调用被拒且有一条审计记录
 - m8 的目标里没有数字:两个版本比较时给出差值的置信区间和 p 值
```

这两句话读起来都没毛病,可是「怎么算做到了」没有答案。m6 改成「未授权的工具在 tools/list 里出现 0 次,被拒的调用 100% 有一条审计记录」,m8 改成「同时给出 95% 置信区间和 p 值,p 小于 0.05 才写『有差异』」,都变成了能写成测试断言的话。改完再跑:

```text
范围检查: 通过
能不能顺便做个拖拽界面,让运营自己搭 Agent
    -> 非目标 ng1:不做可视化编排界面。重开条件:出现三个以上不会写代码的团队来要
财务想每月自动出各团队的模型账单
    -> 范围内:模型网关
销售想用 LangGraph 写,平台要不要统一成一种写法
    -> 非目标 ng2:不做自己的 Agent 框架。重开条件:出现第二套重复的框架胶水代码,三个团队都在写
能不能顺便支持语音通话
    -> 不在范围表里:先写一页 ADR 评估,再决定要不要改范围
运维想要异地双活,两个机房
    -> 非目标 ng4:不做多区域部署和四个九。重开条件:出现有 SLA 赔付条款的客户
HR 想让平台帮他们微调一个简历模型
    -> 非目标 ng3:不做模型训练平台。重开条件:有两个以上团队每月都要训模型
给所有客服的提示词统一加一段免责声明,在平台层做
    -> 不在范围表里:先写一页 ADR 评估,再决定要不要改范围
长任务跑到一半 worker 挂了要能接着跑
    -> 范围内:持久化运行时
```

后半截是归类结果。8 条「顺便」的需求,6 条归得合理:拖拽界面归 ng1,LangGraph 归 ng2,异地双活归 ng4,微调归 ng3,账单归网关,worker 挂了归运行时。语音通话「不在范围表里」,这是对的,也是最有意思的一种:它不是非目标也不是范围内,需要先写一页 ADR 评估,而不是随口答应。

第七条「给客服提示词统一加免责声明」漏了:它明明很像 ng5(不管租户的提示词内容),但 ng5 的关键词是「提示词管理」「改提示词」「审核提示词」,这句话里是「提示词统一加」,一个也没中,结果落到了「先写 ADR」。关键词归类很粗,会漏也会误伤。保守的默认值(拿不准就写 ADR)让它漏了也不危险,但如果你让它自动回复需求方「这个不在范围内」,漏报会让人误以为我们答应了。练习 1 修这个。

再把它渲染成设计文档里要放的范围页:

```python
# agent-zero-lab/part10/agentops_kickoff/render_scope.py
"""把 scope.py 里的数据渲染成 agentops/docs/scope.md。用法:uv run python -m part10.agentops_kickoff.render_scope 输出路径"""
import sys
from pathlib import Path

from part10.agentops_kickoff.check_scope import check
from part10.agentops_kickoff.scope import METRICS, NON_GOALS, SUBSYSTEMS


def render() -> str:
    lines = ["# AgentOps 范围", "", "## 要做的子系统和里程碑", "", "| 子系统 | 在哪几天做 | 负责什么 |", "| --- | --- | --- |"]
    for s in SUBSYSTEMS:
        lines.append(f"| {s.name} | Day {'、'.join(str(d) for d in s.days)} | {'、'.join(s.owns)} |")
    lines += ["", "## 明确不做的", "", "| 非目标 | 为什么 | 什么条件下重新考虑 |", "| --- | --- | --- |"]
    lines += [f"| {g.text} | {g.why} | {g.revisit_when} |" for g in NON_GOALS]
    lines += ["", "## 验收指标", "", "| 编号 | 指标 | 怎么测 | 第一次测 |", "| --- | --- | --- | --- |"]
    lines += [f"| {m.id} | {m.target} | {m.how} | Day {m.day} |" for m in METRICS]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    problems = check(SUBSYSTEMS, NON_GOALS, METRICS)
    if problems:
        raise SystemExit("范围还有问题,先改:\n" + "\n".join(problems))
    text = render()
    if len(sys.argv) > 1:
        Path(sys.argv[1]).parent.mkdir(parents=True, exist_ok=True)
        Path(sys.argv[1]).write_text(text)
        print(f"写入 {sys.argv[1]}({len(text.splitlines())} 行)")
    else:
        print(text)
```

<div class="line-notes">

- `lines = ["# AgentOps 范围", "", "## 要做的子系统和里程碑", "", "| 子系统 | 在哪几天做 | 负责什么 |", "| --- | --- | --- |"]` Markdown 表格的表头和分隔行。一行一个列表元素,最后 `"\n".join(...)`。
- `lines.append(f"| {s.name} | Day {'、'.join(str(d) for d in s.days)} | {'、'.join(s.owns)} |")` `'、'.join(...)` 用顿号把一串东西接起来。`str(d) for d in s.days` 把数字天数转成字符串,`join` 只接受字符串。
- `lines += [f"| {g.text} | {g.why} | {g.revisit_when} |" for g in NON_GOALS]` 非目标表,三列:不做什么、为什么、什么条件下重开。
- `problems = check(SUBSYSTEMS, NON_GOALS, METRICS)` 渲染之前先检查。
- `raise SystemExit("范围还有问题,先改:\n" + "\n".join(problems))` 有问题就中止,不生成文档。`SystemExit` 里传字符串,程序会把它打印到错误输出并以非零退出码结束。
- `Path(sys.argv[1]).parent.mkdir(parents=True, exist_ok=True)` 输出目录不存在就先建,存在也不报错。

</div>

```bash
uv run python -m part10.agentops_kickoff.render_scope ../agentops/docs/scope.md
```

```text
写入 ../agentops/docs/scope.md(35 行)
```

打开那份文件,三张表:五个子系统和它们的日期,五条非目标(每条带理由和重开条件),九条验收指标(每条带数字、测法和第一次测的日子)。后面十天,每天结束时你都可以回到这张表,问「今天这块对应的指标测了吗」。

写完看一下为什么这样做比手写文档好:数据改了(比如把某条指标从 Day 627 挪到 628),文档自动跟着变,检查自动重跑;而且「没数字的指标」这种毛病在开工第一天就被抓住了,不是做到第五天才发现「性能良好」没法验收。

测试放在最后一并给(`test_kickoff.py`,控制面那部分也在里面)。

## 控制面和数据面:在 AgentOps 上怎么落地

两个词来自网络和 Kubernetes,[Day 585](/blog/agent-zero/day-585-platform-3/) 讲过原理(数据面不能每个请求都问控制面、配置版本号和紧急开关)。前端同学可以这样对应:一个有后台管理系统的网站,管理员在后台改配置(控制面),用户在前台浏览(数据面);后台挂了,前台还得能打开。今天不再讲原理,只做一件事:**把 AgentOps 要做的每一条接口,标上它属于哪个面,再用规则检查标得对不对。**

分的原则:数据面是真正处理业务流量的部分,每次模型调用、每次工具调用、每一步运行时的执行,要的是低延迟和高可用;控制面是管理这些流量的规则,谁是租户、每个租户每分钟能发多少请求、`fast` 这个逻辑名背后是哪个模型、哪个角色能调退款工具,要的是正确和可追溯,所以每次变更都要记录是谁改的。两边的关键差别是**写**:数据面的写是业务数据(账本、运行记录),控制面的写是配置,而且**数据面不应该写控制面的表**。

为什么?想象一个很自然的实现:网关处理一个请求时,顺手把租户的「剩余配额」从 `quotas` 表里减一。看起来没毛病。但 `quotas` 是控制面的配置表,管理员改配额也写它,于是每一个租户请求都要写一次控制面的表,控制面的表成了热点,控制面一慢全员变慢,而且管理员改的配额可能被数据面的减一覆盖掉。正确的做法是配额的**上限**在控制面(`quotas`),**已用量**在数据面(`usage_counters`),Day 585 的共享计数器就是这么做的。

```python
# agent-zero-lab/part10/agentops_kickoff/plane_map.py
"""AgentOps 的路由表草稿(Day 625 定稿接口),每条路由标明属于数据面还是控制面,读写哪些表。再用五条规则检查。"""
from dataclasses import dataclass, replace

CONTROL_TABLES = {"tenants", "api_keys", "routes", "quotas", "tool_policies", "admin_audit"}


@dataclass(frozen=True)
class Route:
    method: str
    path: str
    plane: str  # "data" 或 "control",空串表示忘了标
    reads: tuple[str, ...] = ()
    writes: tuple[str, ...] = ()
    audited: bool = False  # 写操作有没有进 admin_audit
    hot: bool = False  # 每个租户请求都会走到吗
    cache: str = ""  # 数据面读控制面的表时,怎么缓存


ROUTES = [
    Route("POST", "/v1/chat/completions", "data", reads=("api_keys", "routes", "quotas"), writes=("ledger", "usage_counters"),
          hot=True, cache="进程内缓存 30 秒,控制面推送新版本号时立刻失效"),
    Route("POST", "/mcp/{server_id}", "data", reads=("api_keys", "tool_policies"), writes=("tool_audit",),
          hot=True, cache="进程内缓存 30 秒,控制面推送新版本号时立刻失效"),
    Route("POST", "/runs", "data", reads=("api_keys",), writes=("runs", "run_steps"), hot=True, cache="进程内缓存 30 秒"),
    Route("GET", "/runs/{id}", "data", reads=("api_keys", "runs"), cache="进程内缓存 30 秒"),
    Route("POST", "/runs/{id}/approve", "data", reads=("api_keys", "runs"), writes=("runs", "run_steps"), cache="进程内缓存 30 秒"),
    Route("POST", "/evals/runs", "data", reads=("api_keys",), writes=("eval_results",), cache="进程内缓存 30 秒"),
    Route("POST", "/admin/tenants", "control", writes=("tenants", "admin_audit"), audited=True),
    Route("POST", "/admin/tenants/{id}/keys", "control", writes=("api_keys", "admin_audit"), audited=True),
    Route("PUT", "/admin/routes", "control", writes=("routes", "admin_audit"), audited=True),
    Route("PUT", "/admin/quotas", "control", writes=("quotas", "admin_audit"), audited=True),
    Route("PUT", "/admin/tool-policies", "control", writes=("tool_policies", "admin_audit"), audited=True),
    Route("GET", "/admin/audit", "control", reads=("admin_audit",)),
    Route("POST", "/admin/tenants/{id}/disable", "control", writes=("tenants", "admin_audit"), audited=True),
]


def lint(routes: list[Route]) -> list[str]:
    out: list[str] = []
    for r in routes:
        name = f"{r.method} {r.path}"
        if r.plane not in ("data", "control"):
            out.append(f"R1 {name}:没标属于哪个面")
            continue
        wrote_control = [t for t in r.writes if t in CONTROL_TABLES]
        if r.plane == "data" and wrote_control:
            out.append(f"R2 {name}:数据面路由写了控制面的表 {wrote_control}")
        if r.plane == "control":
            if wrote_control and not r.audited:
                out.append(f"R3 {name}:控制面写操作没有进审计")
            if r.audited and "admin_audit" not in r.writes:
                out.append(f"R3 {name}:声明了审计,却没写 admin_audit")
            if r.hot:
                out.append(f"R4 {name}:控制面路由出现在热路径上")
        if r.plane == "data":
            read_control = [t for t in r.reads if t in CONTROL_TABLES]
            if read_control and not r.cache:
                out.append(f"R5 {name}:每个请求都要读控制面的表 {read_control},却没有缓存")
    return out


def show(routes: list[Route]) -> None:
    for plane in ("data", "control"):
        rows = [r for r in routes if r.plane == plane]
        print(f"[{plane}] {len(rows)} 条")
        for r in rows:
            print(f"  {r.method:<4} {r.path:<28} 读 {','.join(r.reads) or '-':<28} 写 {','.join(r.writes) or '-'}")


if __name__ == "__main__":
    show(ROUTES)
    print("检查:", lint(ROUTES) or "五条规则都通过")
    broken = [
        replace(ROUTES[0], writes=("ledger", "quotas")),  # 把配额计数直接减在控制面的 quotas 表里
        replace(ROUTES[1], cache=""),
        replace(ROUTES[8], audited=False),
        replace(ROUTES[10], plane=""),
        replace(ROUTES[11], hot=True),
    ]
    print("故意改坏五处以后:")
    for line in lint(broken):
        print(" ", line)
```

<div class="line-notes">

- `CONTROL_TABLES = {"tenants", "api_keys", "routes", "quotas", "tool_policies", "admin_audit"}` 哪些表属于控制面,一共六张。表名是 Day 625 要设计的数据模型的草稿。
- `class Route:` 一条路由。`frozen=True` 之后字段不能改,要改只能用 `replace` 复制一份,下面「故意改坏」就用这个办法。
- `plane: str  # "data" 或 "control",空串表示忘了标` 不用枚举,字符串够用。留一个「空串=忘了标」是为了让规则 R1 能抓到。
- `audited: bool = False  # 写操作有没有进 admin_audit` 控制面的写操作要不要留痕的标记。
- `hot: bool = False  # 每个租户请求都会走到吗` 是不是热路径。
- `cache: str = ""  # 数据面读控制面的表时,怎么缓存` 一句话写明缓存方式,空串表示没缓存。
- `Route("POST", "/v1/chat/completions", "data", reads=("api_keys", "routes", "quotas"), writes=("ledger", "usage_counters"),` 网关的主路由:读三张控制面的表(认 key、查路由、查配额上限),写两张数据面的表(账本和已用量)。
- `cache="进程内缓存 30 秒,控制面推送新版本号时立刻失效"` 读控制面的表就必须有缓存,并且写明怎么失效。这是 Day 585 的结论直接变成了一个字段。
- `Route("POST", "/admin/tenants", "control", writes=("tenants", "admin_audit"), audited=True),` 控制面的写操作:写 `tenants`,同时写 `admin_audit`,`audited=True`。
- `Route("GET", "/admin/audit", "control", reads=("admin_audit",)),` 读审计日志,只读,不需要 `audited`。
- `if r.plane not in ("data", "control"):` R1:没标面的,报错,并且 `continue` 跳过后面的检查(不知道属于哪个面,后面的规则没法判断)。
- `wrote_control = [t for t in r.writes if t in CONTROL_TABLES]` 这条路由写的表里,有哪几张是控制面的。
- `if r.plane == "data" and wrote_control:` **R2:数据面路由不能写控制面的表。** 也就是上面「减配额」那个错。
- `if wrote_control and not r.audited:` R3 前半:控制面改了配置,必须标明进了审计。
- `if r.audited and "admin_audit" not in r.writes:` R3 后半:嘴上说审计了,`writes` 里却没有 `admin_audit`,是自相矛盾。
- `if r.hot:` R4:控制面的路由不该出现在热路径上。
- `if read_control and not r.cache:` R5:数据面读控制面的表却没缓存,意味着每个租户请求都要问一次控制面。
- `replace(ROUTES[0], writes=("ledger", "quotas")),  # 把配额计数直接减在控制面的 quotas 表里` 故意改坏的第一处,就是上面那个「顺手减配额」。`replace` 复制一份新的路由,只改 `writes`。
- `replace(ROUTES[10], plane=""),` 忘了标。
- `replace(ROUTES[11], hot=True),` 一个只读审计的管理接口被标成了热路径,R4 会抓。

</div>

```bash
uv run python -m part10.agentops_kickoff.plane_map
```

真实输出:

```text
[data] 6 条
  POST /v1/chat/completions         读 api_keys,routes,quotas       写 ledger,usage_counters
  POST /mcp/{server_id}             读 api_keys,tool_policies       写 tool_audit
  POST /runs                        读 api_keys                     写 runs,run_steps
  GET  /runs/{id}                   读 api_keys,runs                写 -
  POST /runs/{id}/approve           读 api_keys,runs                写 runs,run_steps
  POST /evals/runs                  读 api_keys                     写 eval_results
[control] 7 条
  POST /admin/tenants               读 -                            写 tenants,admin_audit
  POST /admin/tenants/{id}/keys     读 -                            写 api_keys,admin_audit
  PUT  /admin/routes                读 -                            写 routes,admin_audit
  PUT  /admin/quotas                读 -                            写 quotas,admin_audit
  PUT  /admin/tool-policies         读 -                            写 tool_policies,admin_audit
  GET  /admin/audit                 读 admin_audit                  写 -
  POST /admin/tenants/{id}/disable  读 -                            写 tenants,admin_audit
检查: 五条规则都通过
故意改坏五处以后:
  R2 POST /v1/chat/completions:数据面路由写了控制面的表 ['quotas']
  R5 POST /mcp/{server_id}:每个请求都要读控制面的表 ['api_keys', 'tool_policies'],却没有缓存
  R3 PUT /admin/routes:控制面写操作没有进审计
  R1 PUT /admin/tool-policies:没标属于哪个面
  R4 GET /admin/audit:控制面路由出现在热路径上
```

前半是路由表一览:数据面 6 条,控制面 7 条,规则全部通过。后半是故意改坏五处,每一处被对应的规则抓出来:改坏的网关路由写了 `quotas`(R2)、工具中心没缓存(R5)、`PUT /admin/routes` 没审计(R3)、一条路由忘了标面(R1)、读审计的接口被标成热路径(R4)。

这张表还有一处值得留意:`api_keys` 是控制面的表,但**每个数据面路由都要读它**(要认出你是哪个租户),所以每条数据面路由的 `cache` 字段都不能空。这也解释了为什么后面「API key」那一天要同时考虑缓存和吊销:吊销一个 key 是控制面的写,数据面要多久才知道?缓存 30 秒意味着最长 30 秒,除非控制面推送新版本号。这个取舍现在写在路由表里,Day 625 接口约定时会正式定下来。

最后把今天所有检查装进测试:

```python
# agent-zero-lab/part10/agentops_kickoff/test_kickoff.py
from dataclasses import replace

from part10.agentops_kickoff.check_scope import check, triage
from part10.agentops_kickoff.plane_map import ROUTES, lint
from part10.agentops_kickoff.scope import METRICS, NON_GOALS, SUBSYSTEMS


def test_scope_passes_as_written() -> None:
    assert check(SUBSYSTEMS, NON_GOALS, METRICS) == []


def test_metric_without_a_number_is_caught() -> None:
    soft = [replace(METRICS[0], target="性能良好")] + METRICS[1:]
    assert any("没有数字" in p for p in check(SUBSYSTEMS, NON_GOALS, soft))


def test_review_day_cannot_hold_a_deliverable() -> None:
    moved = [replace(METRICS[1], day=629)] + METRICS[:1] + METRICS[2:]
    assert any("629" in p for p in check(SUBSYSTEMS, NON_GOALS, moved))


def test_non_goal_needs_a_revisit_condition() -> None:
    lazy = [replace(NON_GOALS[0], revisit_when="")] + NON_GOALS[1:]
    assert any("重新考虑" in p for p in check(SUBSYSTEMS, lazy, METRICS))


def test_triage() -> None:
    assert triage("做个拖拽界面").startswith("非目标 ng1")
    assert triage("月底出账单").startswith("范围内")
    assert triage("支持语音").startswith("不在范围表里")


def test_routes_pass_and_each_rule_fires() -> None:
    assert lint(ROUTES) == []
    assert any(p.startswith("R2") for p in lint([replace(ROUTES[0], writes=("quotas",))]))
    assert any(p.startswith("R5") for p in lint([replace(ROUTES[1], cache="")]))
    assert any(p.startswith("R3") for p in lint([replace(ROUTES[8], audited=False)]))
    assert any(p.startswith("R1") for p in lint([replace(ROUTES[10], plane="")]))
    assert any(p.startswith("R4") for p in lint([replace(ROUTES[11], hot=True)]))
```

<div class="line-notes">

- `def test_scope_passes_as_written() -> None:` 第一条:范围数据本身必须通过检查。
- `soft = [replace(METRICS[0], target="性能良好")] + METRICS[1:]` 把第一条指标的目标换成「性能良好」,其余不变。`replace` 对 dataclass 是「复制并改字段」,和 JS 的 `{...m, target: "性能良好"}` 一样。
- `moved = [replace(METRICS[1], day=629)] + METRICS[:1] + METRICS[2:]` 把第二条指标挪到 Day 629(复习日),并保证其余指标都在。检查里的错误信息应该提到「629」。
- `lazy = [replace(NON_GOALS[0], revisit_when="")] + NON_GOALS[1:]` 一条非目标没写重开条件。
- `assert triage("做个拖拽界面").startswith("非目标 ng1")` 归类函数的三种典型结果各测一条。`startswith` 只看开头,不在乎后面的重开条件文字,以后改了措辞测试不会跟着红。
- `assert lint(ROUTES) == []` 路由表本身必须通过五条规则。
- `assert any(p.startswith("R2") for p in lint([replace(ROUTES[0], writes=("quotas",))]))` 每条规则各一个反例,证明它们真的会叫。只测「通过」的测试,规则被误删了也发现不了。

</div>

```bash
uv run pytest part10/agentops_kickoff -q
```

```text
......                                                                   [100%]
6 passed in 0.02s
```

### 里程碑

范围页里「在哪几天做」那一列,就是里程碑。再拿出来说一遍,因为后面每天你都会回来看:

| Day | 产出 | 对应的验收指标 |
| --- | --- | --- |
| 624、625 | 开题:范围、ADR、控制面数据面;隔离、仓库骨架、接口约定、数据模型、API key | 设计文档评审通过 |
| 626、627 | 模型网关:供应商和价格表;路由表、令牌桶、记账预算、十个场景测试 | m1、m2、m3、m4、m5 |
| 628、630 | MCP 工具中心:注册和默认拒绝;审计、一次性审批、HTTP 前端 | m6 |
| 631、632 | 持久化运行时:数据层和租约;RunContext、worker、任务 API、接 SupportPilot | m7 |
| 633 | 评测平台:数据集指纹、统计工具、A/B | m8 |
| 634、635 | 级联路由进网关和 shadow;可观测和成本看板 | 补充 m2、m5 |
| 637 | 安全加固 | m9 |
| 638、639 | 压测、容量规划、部署;包装成作品 | 重测 m2 |

Day 629、636 是复习日,不排产出。

## 动手练习

### 练习 1:修好归类漏报

`triage` 把「给所有客服的提示词统一加一段免责声明,在平台层做」归成了「不在范围表里」,其实它很像非目标 ng5。给 ng5 补关键词,让它命中,并且让结果带上重开条件,逼提需求的人回答「有没有法务书面要求」。同时检查别的需求有没有被带歪。

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part10/agentops_kickoff/ex624_triage.py
"""练习 1:「给所有客服的提示词统一加一段免责声明」被归成「不在范围表里」,其实它很像非目标 ng5。补关键词,并让结果带上重开条件,逼人去问那个关键问题。"""
from dataclasses import replace

from part10.agentops_kickoff import check_scope
from part10.agentops_kickoff.scope import NON_GOALS

REQ = "给所有客服的提示词统一加一段免责声明,在平台层做"
print("改之前:", check_scope.triage(REQ))

check_scope.NON_GOALS[:] = [replace(g, keywords=g.keywords + ("提示词",)) if g.id == "ng5" else g for g in NON_GOALS]
print("改之后:", check_scope.triage(REQ))
print("别的需求有没有被带歪:")
for r in check_scope.REQUESTS:
    print("  ", r[:18], "->", check_scope.triage(r).split(":")[0])
```

<div class="line-notes">

- `from part10.agentops_kickoff import check_scope` 导入模块本身,而不是模块里的函数。这样下面能直接改 `check_scope.NON_GOALS`,`triage` 用的就是改过的。
- `print("改之前:", check_scope.triage(REQ))` 先看原来的结果,「不在范围表里」。
- `check_scope.NON_GOALS[:] = [` 切片赋值:`[:]` 表示「整个列表的内容」,右边是新内容。这样列表对象本身没换,原地改了内容,所有引用它的地方都看到新的。右边的推导式只给 ng5 加一个关键词「提示词」(元组相加就是拼接),其他非目标原样放回。
- `for r in check_scope.REQUESTS:` 把八条需求全重新归一遍,看有没有被带歪。
- `r[:18], "->", check_scope.triage(r).split(":")[0]` 只打印每条需求的前 18 个字符和结果的前半截(冒号之前),让输出短一点。

</div>

```bash
uv run python -m part10.agentops_kickoff.ex624_triage
```

```text
改之前: 不在范围表里:先写一页 ADR 评估,再决定要不要改范围
改之后: 非目标 ng5:不管租户的提示词内容。重开条件:平台层出现统一的合规文案要求,并且有法务书面要求
别的需求有没有被带歪:
   能不能顺便做个拖拽界面,让运营自己搭 -> 非目标 ng1
   财务想每月自动出各团队的模型账单 -> 范围内
   销售想用 LangGraph 写,平 -> 非目标 ng2
   能不能顺便支持语音通话 -> 不在范围表里
   运维想要异地双活,两个机房 -> 非目标 ng4
   HR 想让平台帮他们微调一个简历模型 -> 非目标 ng3
   给所有客服的提示词统一加一段免责声明 -> 非目标 ng5
   长任务跑到一半 worker 挂了要 -> 范围内
```

补完以后,那条需求归到了 ng5,而且结果里带着重开条件「平台层出现统一的合规文案要求,并且有法务书面要求」。其他七条的归类没变。

但这里要提醒自己:加了关键词「提示词」以后,**任何**含「提示词」的需求都会被归成 ng5,包括「想看一下某个租户的提示词里有没有泄露密钥」这种其实是安全审计、应该属于范围内的需求。关键词归类是个演示动作,真正的归类要靠人读需求。它的价值是让「不做」有章可循、需求方能看到重开条件,不是替人判断。

</details>

### 练习 2:加一条规则 R6,让「推送新版本号」变成硬要求

Day 585 讲过,数据面缓存了控制面的配置以后,控制面改配置时要推送一个新版本号,不然数据面要等缓存过期才知道。给路由加一个 `pushes` 字段,写一条新规则:控制面改了数据面缓存的表,必须 `pushes=True`。对现在的路由表跑一次,看哪几条路由要补。

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part10/agentops_kickoff/ex624_push.py
"""练习 2:新增规则 R6:控制面改了「数据面会缓存」的表,必须同时推送新版本号,否则数据面要等缓存过期(30 秒)才知道。"""
from dataclasses import dataclass, replace

from part10.agentops_kickoff.plane_map import ROUTES, Route, lint

CACHED_BY_DATA_PLANE = {"api_keys", "routes", "quotas", "tool_policies", "tenants"}


@dataclass(frozen=True)
class PushRoute(Route):
    pushes: bool = False  # 改完以后会不会推送新版本号


def lint6(routes: list[PushRoute]) -> list[str]:
    out = lint(list(routes))
    for r in routes:
        touched = [t for t in r.writes if t in CACHED_BY_DATA_PLANE]
        if r.plane == "control" and touched and not r.pushes:
            out.append(f"R6 {r.method} {r.path}:改了数据面缓存的表 {touched},却没有推送新版本号")
    return out


if __name__ == "__main__":
    routes = [PushRoute(**{**r.__dict__}) for r in ROUTES]
    print("加 R6 之前每条路由都没标 pushes:")
    for line in lint6(routes):
        print(" ", line)
    fixed = [replace(r, pushes=True) if r.plane == "control" and any(t in CACHED_BY_DATA_PLANE for t in r.writes) else r for r in routes]
    print("补上 pushes 之后:", lint6(fixed) or "六条规则都通过")
```

<div class="line-notes">

- `CACHED_BY_DATA_PLANE = {"api_keys", "routes", "quotas", "tool_policies", "tenants"}` 数据面会缓存的五张表。`admin_audit` 不在里面,因为数据面不读它。
- `class PushRoute(Route):` 继承 `Route` 再加一个字段。dataclass 可以继承,子类的字段接在父类后面。
- `pushes: bool = False  # 改完以后会不会推送新版本号` 新字段,默认 False。
- `out = lint(list(routes))` 先跑原来的五条规则。`list(routes)` 是因为 `lint` 的参数类型是 `list[Route]`,`list[PushRoute]` 在类型检查器眼里不是同一个类型。
- `touched = [t for t in r.writes if t in CACHED_BY_DATA_PLANE]` 这条路由改了哪几张被缓存的表。
- `if r.plane == "control" and touched and not r.pushes:` R6:控制面、改了被缓存的表、却没有 `pushes`。
- `routes = [PushRoute(**{**r.__dict__}) for r in ROUTES]` 把原来的路由表逐条转成 `PushRoute`。`r.__dict__` 是对象的字段字典,`**` 展开成关键字参数,相当于 JS 的 `new PushRoute({...r})`。
- `fixed = [replace(r, pushes=True)` 把该推送的几条路由标上 `pushes=True`,其余不动。

</div>

```bash
uv run python -m part10.agentops_kickoff.ex624_push
```

```text
加 R6 之前每条路由都没标 pushes:
  R6 POST /admin/tenants:改了数据面缓存的表 ['tenants'],却没有推送新版本号
  R6 POST /admin/tenants/{id}/keys:改了数据面缓存的表 ['api_keys'],却没有推送新版本号
  R6 PUT /admin/routes:改了数据面缓存的表 ['routes'],却没有推送新版本号
  R6 PUT /admin/quotas:改了数据面缓存的表 ['quotas'],却没有推送新版本号
  R6 PUT /admin/tool-policies:改了数据面缓存的表 ['tool_policies'],却没有推送新版本号
  R6 POST /admin/tenants/{id}/disable:改了数据面缓存的表 ['tenants'],却没有推送新版本号
补上 pushes 之后: 六条规则都通过
```

六条路由要补。其中最重要的是最后一条:`POST /admin/tenants/{id}/disable`,**紧急停用一个租户**。它写的是 `tenants` 表,数据面缓存了这张表。如果它不推送新版本号,紧急停用在最坏情况下要 30 秒后才生效,这 30 秒里那个租户还在照常花钱。所以紧急开关的 `pushes` 不是锦上添花,是它能称为「紧急」的前提。创建租户(`POST /admin/tenants`)严格说不需要推送,新租户本来就不在缓存里,我让规则对它也报一次,是为了规则简单,代价是有一条多余的误报,你可以自己把它改精确。

</details>

### 练习 3:连接复用能省多少?

`hop_overhead.py` 里的代理对每个请求都新开一条到上游的连接。改成每个线程复用一条,再量一遍,比较「每次新开」和「复用」的开销。

<details>
<summary>参考答案</summary>

```python
# agent-zero-lab/part10/agentops_kickoff/ex624_pool.py
"""练习 3:代理每次都新开一条到上游的连接,这占了多少开销?改成每个线程复用一条连接,再量一遍。"""
import http.client
import statistics
import threading

from part10.agentops_kickoff.hop_overhead import Quiet, Upstream, make_proxy, measure, serve


def make_pooled_proxy(upstream_port: int) -> type[Quiet]:
    local = threading.local()  # 每个线程一份,线程之间不共用连接

    class Proxy(Quiet):
        def do_POST(self) -> None:
            raw = self.rfile.read(int(self.headers["Content-Length"]))
            conn: http.client.HTTPConnection | None = getattr(local, "conn", None)
            if conn is None:
                conn = local.conn = http.client.HTTPConnection("127.0.0.1", upstream_port)
            conn.request("POST", "/", raw, {"Content-Type": "application/json"})
            self.reply(conn.getresponse().read())

    return Proxy


if __name__ == "__main__":
    up = serve(Upstream)
    port = up.server_address[1]
    rows = [("A 直连", port), ("B 每次新开连接", serve(make_proxy(port, False)).server_address[1]),
            ("B2 复用连接", serve(make_pooled_proxy(port)).server_address[1])]
    base = 0.0
    for name, p in rows:
        ms = measure(p)
        p50, p95 = statistics.median(ms), ms[int(len(ms) * 0.95)]
        base = p95 if name.startswith("A") else base
        print(f"{name:<14} P50 {p50:5.2f} ms   P95 {p95:5.2f} ms   比直连多 {p95 - base:5.2f} ms(P95)")
```

<div class="line-notes">

- `from part10.agentops_kickoff.hop_overhead import Quiet, Upstream, make_proxy, measure, serve` 把今天正文里写好的类和函数直接借来,只新写一个「复用连接」的代理。
- `local = threading.local()  # 每个线程一份,线程之间不共用连接` `threading.local()` 是一个特殊对象:每个线程读写它的属性,看到的都是自己的那一份。HTTP 连接不是线程安全的,所以每个线程自己拿一条。
- `conn: http.client.HTTPConnection | None = getattr(local, "conn", None)` 取这个线程自己的连接,还没有就是 `None`。`getattr(对象, 名字, 默认值)` 是「取属性,没有就用默认值」。
- `conn = local.conn = http.client.HTTPConnection("127.0.0.1", upstream_port)` 第一次进来才建,并且存到 `local` 上。一次赋值同时给两个变量。
- `conn.request("POST", "/", raw, {"Content-Type": "application/json"})` 之后每次都用这条已经建好的连接发。
- `("B 每次新开连接", serve(make_proxy(port, False)).server_address[1])` 今天正文里那个只转发的代理。
- `("B2 复用连接", serve(make_pooled_proxy(port)).server_address[1])` 新写的。
- `base = p95 if name.startswith("A") else base` 直连那一行记下基准,其他行不改基准。

</div>

```bash
uv run python -m part10.agentops_kickoff.ex624_pool
```

```text
A 直连           P50  0.29 ms   P95  0.45 ms   比直连多  0.00 ms(P95)
B 每次新开连接       P50  1.19 ms   P95  3.82 ms   比直连多  3.37 ms(P95)
B2 复用连接        P50  0.54 ms   P95  0.78 ms   比直连多  0.33 ms(P95)
```

我跑了两次,比直连多的 P95:每次新开连接是 3.37 和 1.48 毫秒,复用是 0.33 和 0.43 毫秒。数字抖得厉害(这台机器是 2019 年的 Intel 笔记本,线程调度本来就不稳),但方向每次一致:**复用连接把网关的开销压到三分之一到五分之一**。所以 Day 626 写网关访问上游的代码时,上游那条连接一定要复用,不能每个请求新开。

</details>

**验收标准:** `pytest part10/agentops_kickoff` 六条全绿;`render_scope` 能写出 `agentops/docs/scope.md`;你能不看文章说出 `lint` 的五条规则各抓什么;能回答「为什么数据面不该直接减 `quotas` 表里的配额」。

## 名词解释

| 名词 | 意思 |
| --- | --- |
| 平台(platform) | 由专门团队维护、给公司里多个业务团队共用的一层基础设施。前端类比:公司内部组件库加 BFF 网关 |
| AgentOps | 本课毕业项目的名字:一个给多个团队共用的 Agent 基础设施,含网关、工具中心、运行时、评测 |
| 最薄可用平台 | 能让业务团队加速的最小那一层,不求大而全(Day 583 引过) |
| 非目标 | 明确不做的事。写清楚理由和什么条件下重新考虑,比目标更能防止范围蔓延 |
| 验收指标 | 带数字、能写成测试的完成标准。「性能良好」不是验收指标 |
| 控制面 | 管规则和配置的部分:谁是租户、配额多少、路由表、工具策略。要正确、要留痕 |
| 数据面 | 真正处理业务流量的部分:每次模型调用、工具调用、运行时一步。要快、要稳 |
| 网关额外延迟 | 在调用方和上游之间多放一个网关,请求多花的时间,不含上游自己的处理 |
| keep-alive(保持连接) | HTTP/1.1 让同一条 TCP 连接连续处理多个请求,不用每次重新握手 |
| 热路径 | 每个用户请求都会走到的代码路径,改它的性能影响所有人 |

## 常见误区

**平台越早做越好。** 只有一个用户时分不清哪些代码是通用的。三个信号至少出现两个再动手,否则做出来的抽象全是猜的。

**打分结果几乎打平时,硬挑一个说「推荐」。** 今天 A 比 B 低 0.05 分,诚实的写法是承认打平,写清楚决定依据的是矩阵之外的哪条判断,再写下复盘条件。

**验收指标写成「性能良好」。** 没有数字就没法验收。今天第一次检查就抓到两条,都是读起来没毛病的句子。

**非目标只写「不做 X」,不写为什么、什么条件下重新考虑。** 没有重开条件的非目标,下一次有人提需求时只能靠嗓门大。

**拿本机回环量到的 1 毫秒当网关的最终开销。** 它是一个下限和数量级,真实网络和落库的开销要在 Day 627、638 重量。

**让数据面顺手写控制面的表。** 「处理请求时把配额减一」听起来合理,但会让控制面的表成为热点,还可能覆盖管理员的修改。上限放控制面,已用量放数据面。

**数据面每个请求都去问控制面。** 控制面一慢,所有租户全慢。要缓存,并且要想清楚改了配置之后多久生效,紧急停用要能推送。

**代理对每个请求新开一条上游连接。** 练习 3 里开销是复用的三到五倍。

**用关键词归类需求,就让它自动回复「不在范围内」。** 漏报会让需求方以为你们答应了。机器归类只负责「提醒」,不负责「拒绝」。

## 学习资料

### 文档与文章

- [Team Topologies 的 Thinnest Viable Platform](https://teamtopologies.com/key-concepts-content/what-is-a-thinnest-viable-platform-tvp):「最薄可用平台」的出处,一页纸,10 分钟。英文。
- [What I talk about when I talk about platforms(Evan Bottcher)](https://martinfowler.com/articles/talk-about-platforms.html):平台是自助服务的一组能力,目标是让业务团队少依赖平台团队,20 分钟。英文。
- [Design docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/):Google 工程师讲设计文档里「目标、非目标、考虑过的其他方案」为什么最重要,15 分钟。英文。
- [Documenting Architecture Decisions(Michael Nygard)](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions):ADR 的出处,昨天提过,今天写了第三份,回头再读一遍,10 分钟。英文。
- [Control plane(维基百科)](https://en.wikipedia.org/wiki/Control_plane):网络里「控制面和数据面」的原始含义,先读开头,10 分钟。英文。
- [Python 文档:http.server](https://docs.python.org/3/library/http.server.html):今天本机服务用到的模块,看开头的几个类和「protocol_version」,15 分钟。英文。

### B 站视频

<figure class="video">
<div class="video-frame"><iframe src="https://player.bilibili.com/player.html?bvid=BV1CM411f7fs&autoplay=0&high_quality=1" title="什么是平台工程" loading="lazy" scrolling="no" allowfullscreen></iframe></div>
<figcaption>阿里云云效 · 什么是平台工程 · 2 分半。从 DevOps 讲到平台工程,一句话理解「平台团队给业务团队提供自助服务」。</figcaption>
</figure>

### 其他经典视频

<figure class="video">
<div class="video-frame"><iframe src="https://www.youtube-nocookie.com/embed/LP5OCa20Zpg" title="Tips for building AI agents" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
<figcaption>Anthropic · Tips for building AI agents · 18 分钟,昨天推荐过。今天回头看,留意他们讲「先从简单的开始、有证据再加复杂度」的部分,和「最薄可用平台」是同一个思路。英文。</figcaption>
</figure>

### 书籍

- Matthew Skelton、Manuel Pais《Team Topologies》(IT Revolution, 2019):「最薄可用平台」和平台团队怎么服务业务团队的出处。英文原版。
- Neal Ford 等《Software Architecture: The Hard Parts》(O'Reilly, 2021):昨天推荐过,讲怎么把架构权衡写下来,和今天的 ADR 对着看。英文原版。

### 开源项目与代码

- [BerriAI/litellm](https://github.com/BerriAI/litellm):现成的模型网关,先看 README 的功能列表,对照今天范围里「模型网关」一块,想一想哪些是我们要自己做的(Day 586 讲过买还是写)。
- [Portkey-AI/gateway](https://github.com/Portkey-AI/gateway):另一个开源 AI 网关,看它怎么处理路由和失败重试。

## 自测

1. 今天 A 做平台 3.80、B 共享包 3.85,A 反而更低,为什么 ADR 还是决定做 A?这样写诚实吗?
2. 为什么验收指标「未授权的工具不出现在 tools/list,调用被拒且有一条审计记录」不合格?怎么改?
3. 本机实测网关多一跳 P95 约 +1 毫秒,验收指标却写 30 毫秒,这中间的差在哪?
4. 为什么「处理请求时顺手把 quotas 表里的配额减一」是错的?正确的拆法是什么?
5. 面试题:你们有三个团队各自在用大模型,老板问你要不要做一个统一平台。你怎么回答?

<details>
<summary>答案</summary>

1. 打分结果几乎打平(A 和 B 差 0.05 分,权重抖动下 B 只赢 58.5%),矩阵本身没法分出胜负。ADR 里把没被矩阵捕捉的理由写出来(共享包管不到不用它的团队,而统一管控需要一个绕不开的入口),明确标成「判断,不是数字」,同时写了三条带数字的复盘条件。诚实在于:承认 B 的分更高、说清决定凭什么、让别人能挑战它。不诚实的写法是只贴一个 3.80 然后说「推荐 A」。
2. 因为没有数字,没法写成测试断言。改成「未授权的工具在 tools/list 里出现 0 次,被拒的调用 100% 有一条审计记录」,两个数字都能在测试里直接断言。
3. 本机回环没有网络、没有 TLS、账本是内存 SQLite。真实部署里调用方到网关、网关到上游都隔着网络,落库用 Postgres,每一样都会多花时间。30 毫秒是给这些留出的预算。本机 1 毫秒只是下限和数量级,Day 627、638 要在完整网关上重量。
4. `quotas` 是控制面的配置表,管理员改配额也写它。数据面每个请求都去写它,会让它成为热点,控制面一慢全员变慢,而且管理员刚改的上限可能被数据面的减一覆盖。拆法:`quotas` 里只放上限(控制面写),已用量放 `usage_counters`(数据面写),数据面拿缓存的上限和自己的已用量比较。
5. 参考骨架:先问「三个信号出现了几个」(第三个团队来要、同一个修复改好几遍、要按团队分账)并用数据说话;选项至少三个(做平台、只做共享包、不做),定标准和权重,能实测的先实测(比如多一跳网关的延迟);打分后做敏感性分析,如果打平就写清楚判断依据和复盘条件;如果决定做,按「最薄可用平台」的顺序,先做租户绕不开的统一入口(网关、工具中心),每一块单独验收;范围里写清非目标和重开条件,验收指标全部带数字。

</details>

## 明天预告

[Day 625](/blog/agent-zero/day-625-agentops-kickoff-2/) · AgentOps 开题(二):隔离、仓库结构、接口约定、数据模型、API key。今天把「做不做、做什么、不做什么、数据面和控制面怎么分」定下来了,路由表里的表名都还是草稿。明天把它们落成真的东西:租户隔离选哪种模式,仓库目录怎么排,五个对外接口的约定写成文,所有表放进一个文件,API key 怎么签发和只存哈希,最后把仓库骨架搭起来,让第一批测试变绿。

